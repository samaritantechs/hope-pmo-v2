/* WHERE DOES A DISB DATE LATER THAN TODAY STILL LIVE -- db/RUN-ME-063, run for real on a PostgreSQL.

     "I mean there could be future dates e.g into December 2026 than today's 17th Nov 2026" -- the owner, 17 Nov 2026

   db/RUN-ME-063-future-disb-dates-everywhere-read-only.sql reads the four tables that hold a Disb date (the register behind the Defaulters
   Followup tab, the stored decks, the Expected sheet, the loan pipeline) and says how many are later than today, week by week for the decks,
   and how many customers' LAST-KNOWN deck row is one (the dates a CLEARED customer shows on Expected Defaulters). It is not believed on a reading.

   THE TABLES ARE THE REAL ONES (RUN-ME-061 stopped on the owner's keyboard because a fixture declared a column the book does not have): this
   check runs the create table blocks of teams, loans (with its enum), repayment_snapshots, defaulter_snapshots and followup_status out of
   db/schema.sql, and the indexes the book has on the decks and the Expected sheet (plus idx_def_snap_team_ref of db/RUN-ME-055), then fills them
   the way the importers left them: the old importer's swap (every date whose two numbers were twelve or under) on every deck before 16 Nov except
   three days that db/RUN-ME-060 put right, and dates read right from 16 Nov on, with customers who dropped off the deck (ghosts), a customer
   with a newer row that is right, a later upload of the same day that replaced a swapped one, a customer with no team, a customer whose newest
   row is on the latest deck, an initial-only row, a row before the window, boundary days (today, tomorrow), and tie dates.

   It passes only when: every line the file prints equals the count made in JavaScript from the same rows (counts, dates, the weeks, the
   examples in order); the verdict reads right in a swapped book and in a clean one; the book is byte-for-byte unchanged afterwards (it is
   read-only); the file as pasted (its own East Africa expression) prints the East Africa date; and EVERY one of a list of deliberate breaks of
   the file (a boundary moved, a filter dropped, a join loosened, the window removed, the swap not made) changes the answer or makes it fail --
   a check that cannot fail when the file is broken proves nothing, and says so.

   It needs a PostgreSQL it can reach with psql and none of those tables in it: they are created inside one transaction and rolled back:

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/future-disb-dates-audit.mjs
       (LOANS=1500 customers by default.  SCALE=1 builds a book of the live book's size with generate_series inside the transaction, times the
        file on it and stops: SCALE=1 DECKS=2300000 node tools/db-checks/future-disb-dates-audit.mjs)

   NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-063-future-disb-dates-everywhere-read-only.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
const LOANS = Number(process.env.LOANS || 1500);
const SEP = '\x1f', DAY = 86400000, TODAY = '2026-11-17', FIX = '2026-11-16', LATEST_CUR = '2026-11-16', LATEST_INI = '2026-11-17';
const psql = sql => {
  try { return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', SEP, '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error('psql failed: ' + String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 3).join(' | ')); }
};

// ---- the real DDL, out of db/schema.sql
const block = name => {
  const m = SCHEMA.match(new RegExp('create table if not exists ' + name + ' \\([\\s\\S]*?\\n\\);'));
  if (!m) throw new Error('db/schema.sql has no create table block for ' + name);
  return m[0];
};
const ENUM = (SCHEMA.match(/do \$\$ begin\s+create type loan_stage as enum[\s\S]*?end \$\$;/) || [])[0];
if (!ENUM) throw new Error('db/schema.sql has no loan_stage enum block');
const INDEXES = (SCHEMA.match(/create index if not exists idx_(?:def|repay)_snap_[a-z_]+ on [^;]+;/g) || []).concat(['create index if not exists idx_def_snap_team_ref on defaulter_snapshots(team, ref);']);
const DDL = [block('teams'), ENUM, block('loans'), block('repayment_snapshots'), block('defaulter_snapshots'), block('followup_status'), ...INDEXES].join('\n');

let seed = 20261117;                                               // mulberry32: every draw uses all 32 bits
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const D = s => Date.parse(s + 'T00:00:00Z');
const iso = t => (t == null ? '' : new Date(t).toISOString().slice(0, 10));
const swap = t => { if (t == null) return t; const d = new Date(t), m = d.getUTCMonth() + 1, dd = d.getUTCDate(); return (dd <= 12 && m !== dd) ? Date.UTC(d.getUTCFullYear(), dd - 1, m) : t; };
const monday = t => t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
const TODAY_MS = D(TODAY), FROM = D('2026-08-01');

// ---- the book. clean = every date as the loan system wrote it
function book({ clean = false, specials = true, plus = null } = {}) {
  const dk = [], rp = [], fu = [], ln = [], teams = new Set();
  const route = day => (clean || day >= D(FIX) || (day >= D('2026-11-10') && day <= D('2026-11-12'))) ? 'R' : 'X';      // 10 to 12 Nov: put right by RUN-ME-060
  const stored = (day, real) => (real == null ? null : route(day) === 'X' ? swap(real) : real);
  const addDk = r => { dk.push({ team: 'TEAM ' + (dk.length % 7), lt: null, ...r }); teams.add(dk[dk.length - 1].team); };
  const created = (kind, day, extra = '') => iso(day) + (kind === 'initial' ? ' 01:30:00' : extra || ' 19:40:00') + '+00';
  for (let i = 0; i < LOANS; i++) {
    const L = D('2024-01-01') + Math.floor(rnd() * ((D('2026-08-05') - D('2024-01-01')) / DAY)) * DAY;
    const onLatest = rnd() < 0.4;
    const end = onLatest ? D(LATEST_CUR) : D('2026-08-01') + Math.floor(rnd() * 100) * DAY;               // 1 Aug to 8 Nov, or the latest deck
    const start = Math.max(D('2026-08-01'), end - (3 + Math.floor(rnd() * 38)) * DAY);
    const team = i % 53 === 0 ? null : 'TEAM ' + (i % 7);
    if (team) teams.add(team);
    for (let day = start; day <= end; day += DAY) {
      const LTr = day - (1 + Math.floor(rnd() * 60)) * DAY;
      for (const kind of ['initial', 'current']) {
        if (kind === 'current' && rnd() < 0.08) continue;
        addDk({ ref: 'C' + String(i).padStart(6, '0'), team, kind, day, d: stored(day, L), lt: stored(day, LTr), created: created(kind, day) });
      }
    }
    if (onLatest) addDk({ ref: 'C' + String(i).padStart(6, '0'), team, kind: 'initial', day: D(LATEST_INI), d: L, lt: null, created: created('initial', D(LATEST_INI)) });
  }
  if (specials) {
    const T = 'TEAM 1', dayOf = s => D(s);
    const add = (ref, kind, day, d, extra = {}) => addDk({ ref, team: T, kind, day: dayOf(day), d: d == null ? null : D(d), created: created(kind, dayOf(day), extra.at), ...extra });
    if (!clean) {
      add('G01', 'current', '2026-10-03', '2026-12-01'); add('G01', 'initial', '2026-10-03', '2026-12-01');      // a ghost whose last-known date is 12 Jan stored as 1 Dec
      add('G02', 'current', '2026-10-03', '2026-12-02'); add('G02', 'current', LATEST_CUR, '2026-02-12');           // newer row is right: not a ghost
      add('G03', 'current', '2026-10-05', '2026-12-03'); add('G03', 'current', '2026-10-05', '2026-03-12', { at: ' 21:00:00' });   // a later upload of the same day replaced it
      add('G04', 'initial', '2026-10-06', '2026-12-04');                                                                // initial only
      addDk({ ref: 'G05', team: null, kind: 'current', day: D('2026-10-07'), d: D('2026-12-05'), created: created('current', D('2026-10-07')) });          // no team
      addDk({ ref: 'G05B', team: null, kind: 'current', day: D('2026-10-07'), d: D('2026-12-06'), created: created('current', D('2026-10-07')) });
      addDk({ ref: 'G05B', team: null, kind: 'current', day: D(LATEST_CUR), d: D('2026-06-12'), created: created('current', D(LATEST_CUR)) });            // ... with a newer right row
      add('G06', 'current', LATEST_CUR, '2026-12-25');                                                                  // on the latest deck, no swap explains it
      add('G11', 'current', LATEST_CUR, '2026-12-10');                                                                  // on the latest deck, a swap explains it
      add('G07', 'current', '2026-07-20', '2026-12-07');                                                                // before the window
      add('G12', 'current', '2026-08-01', '2026-12-08');                                                                // the first day of the window
      add('G08A', 'current', '2026-10-08', TODAY);                                                                      // today is not later than today
      add('G08B', 'current', '2026-10-08', '2026-11-18');                                                               // tomorrow: no swap explains it
      add('G10A', 'current', '2026-10-09', '2026-12-09'); add('G10B', 'current', '2026-10-09', '2026-12-09');            // a tie on the date
      add('G09', 'current', '2026-10-10', '2026-05-05', { lt: TODAY_MS }); add('G09B', 'current', '2026-10-10', '2026-05-06', { lt: TODAY_MS + DAY });
    }
    // the Expected sheet
    const kinds = ['today', 'tomorrow', 'yesterday', 'initial'];
    for (let i = 0; i < Math.max(300, LOANS); i++) {
      const day = TODAY_MS - Math.floor(rnd() * 40) * DAY, real = D('2024-01-01') + Math.floor(rnd() * 900) * DAY;
      const sw = clean || day >= D(FIX) ? false : true, team = 'TEAM ' + (i % 7);
      rp.push({ ref: 'E' + String(i).padStart(5, '0'), team, kind: kinds[i % 4], day, d: sw ? swap(real) : real, lt: sw ? swap(day - 5 * DAY) : day - 5 * DAY });
    }
    if (!clean) {
      rp.push({ ref: 'E90001', team: T, kind: 'today', day: TODAY_MS - 28 * DAY, d: D('2026-12-02'), lt: D('2026-12-03') });         // the oldest day inside the window
      rp.push({ ref: 'E90002', team: T, kind: 'today', day: TODAY_MS - 29 * DAY, d: D('2026-12-04'), lt: D('2026-12-05') });         // one day outside it
      rp.push({ ref: 'E90003', team: T, kind: 'initial', day: TODAY_MS - 3 * DAY, d: TODAY_MS, lt: TODAY_MS });                     // today
    }
    // the register behind the Defaulters Followup tab
    for (let i = 0; i < 400; i++) {
      const real = D('2024-04-01') + Math.floor(rnd() * 950) * DAY, hidden = i % 6 === 0, sw = !clean && rnd() < 0.5;
      fu.push({ ref: 'F' + String(i).padStart(5, '0'), team: 'TEAM ' + (i % 7), status: hidden ? null : 'CHRONIC', arrears: hidden ? null : 1000 + i, d: sw ? swap(real) : real, lt: real });
    }
    if (!clean) {
      fu.push({ ref: 'F90001', team: T, status: 'CHRONIC', arrears: 5, d: TODAY_MS + DAY, lt: TODAY_MS });
      fu.push({ ref: 'F90002', team: T, status: null, arrears: 7, d: TODAY_MS, lt: null });
      fu.push({ ref: 'F90003', team: T, status: null, arrears: null, d: D('2026-12-04'), lt: null });
      fu.push({ ref: 'F90004', team: T, status: 'EXPIRED', arrears: null, d: D('2026-12-06'), lt: null });
      fu.push({ ref: 'F90005', team: T, status: null, arrears: null, d: D('2026-12-11'), lt: null });
    }
    // the loan pipeline
    for (let i = 0; i < 20; i++) ln.push({ name: 'LOAN ' + i, d: i % 4 === 0 ? null : TODAY_MS - (30 + i) * DAY });
    if (!clean) { ln.push({ name: 'LOAN F1', d: TODAY_MS + DAY }); ln.push({ name: 'LOAN F2', d: TODAY_MS }); }
    teams.add(T);
  }
  // a clean book plus one row that is later than today, in the one table named: only a verdict that reads that table can see it
  if (plus === 'rp') rp.push({ ref: 'P00001', team: 'TEAM 1', kind: 'today', day: TODAY_MS - 2 * DAY, d: D('2026-12-12'), lt: null });
  if (plus === 'ln') ln.push({ name: 'LOAN P', d: D('2026-12-13') });
  if (plus === 'rgHidden') fu.push({ ref: 'P00002', team: 'TEAM 1', status: null, arrears: null, d: D('2026-12-14'), lt: null });
  if (plus === 'rgShown') fu.push({ ref: 'P00003', team: 'TEAM 1', status: 'CHRONIC', arrears: 5, d: D('2026-12-15'), lt: null });
  if (plus === 'dk') dk.push({ ref: 'P00004', team: 'TEAM 1', kind: 'current', day: D('2026-10-20'), d: D('2026-12-16'), lt: null, created: '2026-10-20 19:40:00+00' });
  teams.add('TEAM 1');
  return { dk, rp, fu, ln, teams: [...teams] };
}

// ---- what the file must print, counted in JavaScript from the stored rows (not from the SQL)
const fmt = n => n.toLocaleString('en-US');
function expectOf(b) {
  const e = { dRows: 0, nD: 0, nDIni: 0, nDCur: 0, nDSw: 0, nLt: 0, dMax: null, ghosts: 0, examples: [], weeks: [], shown: 0, shownDated: 0, shownFut: 0, shownMax: null, hidden: 0, hiddenFut: 0, rpRows: 0, rpD: 0, rpLt: 0, lnDated: 0, lnD: 0, latestCur: null };
  const inWin = b.dk.filter(r => r.day >= FROM);
  e.dRows = inWin.length;
  e.latestCur = Math.max(...inWin.filter(r => r.kind === 'current').map(r => r.day));
  const wk = new Map();
  for (const r of inWin) {
    const k = monday(r.day), o = wk.get(k) || { n: { initial: 0, current: 0 }, d: { initial: 0, current: 0 }, l: { initial: 0, current: 0 } };
    o.n[r.kind]++; if (r.d != null && r.d > TODAY_MS) o.d[r.kind]++; if (r.lt != null && r.lt > TODAY_MS) o.l[r.kind]++; wk.set(k, o);
    if (r.d != null && r.d > TODAY_MS) { e.nD++; if (r.kind === 'initial') e.nDIni++; else e.nDCur++; if (swap(r.d) <= TODAY_MS) e.nDSw++; if (e.dMax == null || r.d > e.dMax) e.dMax = r.d; }
    if (r.lt != null && r.lt > TODAY_MS) e.nLt++;
  }
  e.weeks = [...wk.entries()].sort((a, b) => b[0] - a[0]).map(([k, o]) => ({ wk: iso(k), ...o }));
  // the newest current row of each customer (team and ref, a null team being a team), over the whole table
  const newest = new Map();
  for (const r of b.dk) {
    if (r.kind !== 'current') continue;
    const key = r.ref + '|' + (r.team == null ? '\u0000null' : r.team), cur = newest.get(key);
    const rank = r.day * 1e3 + Date.parse(r.created.replace(' ', 'T').replace('+00', 'Z')) / 1e9;                  // day first, then the upload's time
    if (!cur || r.day > cur.r.day || (r.day === cur.r.day && Date.parse(r.created.replace(' ', 'T').replace('+00', 'Z')) > Date.parse(cur.r.created.replace(' ', 'T').replace('+00', 'Z')))) newest.set(key, { r, rank });
  }
  const gh = [];
  for (const { r } of newest.values()) if (r.day >= FROM && r.d != null && r.d > TODAY_MS && r.day < e.latestCur) gh.push(r);
  e.ghosts = gh.length;
  e.examples = gh.sort((a, b) => b.d - a.d || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)).slice(0, 8).map(r => r.ref);
  const shown = r => r.status != null || r.arrears != null;
  for (const r of b.fu) {
    if (shown(r)) { e.shown++; if (r.d != null) { e.shownDated++; if (e.shownMax == null || r.d > e.shownMax) e.shownMax = r.d; } if (r.d != null && r.d > TODAY_MS) e.shownFut++; }
    else { e.hidden++; if (r.d != null && r.d > TODAY_MS) e.hiddenFut++; }
  }
  for (const r of b.rp) if (r.day >= TODAY_MS - 28 * DAY) { e.rpRows++; if (r.d != null && r.d > TODAY_MS) e.rpD++; if (r.lt != null && r.lt > TODAY_MS) e.rpLt++; }
  for (const r of b.ln) { if (r.d != null) e.lnDated++; if (r.d != null && r.d > TODAY_MS) e.lnD++; }
  return e;
}

// ---- the database
const csvLine = a => a.map(v => (v == null ? '' : String(v))).join(',');
const copy = (table, cols, rows) => (rows.length ? `copy public.${table} (${cols}) from stdin with (format csv, null '');\n${rows.join('\n')}\n\\.\n` : '');
const setup = b => {
  const teamRows = b.teams.map(t => `('${t}')`).join(', ');
  return `begin;
${DDL}
insert into public.teams (team) values ${teamRows};
${copy('defaulter_snapshots', 'ref, team, snapshot_type, snapshot_date, disb_date, last_trans_date, created_at', b.dk.map(r => csvLine([r.ref, r.team, r.kind, iso(r.day), iso(r.d), iso(r.lt), r.created])))}${copy('repayment_snapshots', 'ref, team, snapshot_type, snapshot_date, disb_date, last_trans_date', b.rp.map(r => csvLine([r.ref, r.team, r.kind, iso(r.day), iso(r.d), iso(r.lt)])))}${copy('followup_status', 'ref, team, status, arrears, disb_date, last_trans', b.fu.map(r => csvLine([r.ref, r.team, r.status, r.arrears, iso(r.d), iso(r.lt)])))}${copy('loans', 'full_name, disb_date', b.ln.map(r => csvLine([r.name, iso(r.d)])))}analyze public.defaulter_snapshots; analyze public.repayment_snapshots; analyze public.followup_status; analyze public.loans;
`;
};
const SUM = `select md5(coalesce((select string_agg(to_jsonb(a)::text, '|' order by id) from public.defaulter_snapshots a), '') || coalesce((select string_agg(to_jsonb(b)::text, '|' order by id) from public.repayment_snapshots b), '') || coalesce((select string_agg(to_jsonb(c)::text, '|' order by ref) from public.followup_status c), '') || coalesce((select string_agg(to_jsonb(d)::text, '|' order by id) from public.loans d), '')), (select count(*) from public.defaulter_snapshots);`;
const withToday = file => file.replace(/\(now\(\) at time zone 'Africa\/Dar_es_Salaam'\)::date as today/, `date '${TODAY}' as today`);
const run = (file, b) => {
  const STAMP = `select 'T' || chr(31) || extract(epoch from clock_timestamp());\n`;
  const out = psql(setup(b) + SUM + '\n' + STAMP + file + '\n' + STAMP + SUM + '\nrollback;\n').trim().split('\n');
  const stamps = out.filter(l => l.startsWith('T' + SEP)).map(l => Number(l.split(SEP)[1]));
  const sums = out.filter(l => /^[0-9a-f]{32}/.test(l));
  const grid = out.filter(l => !l.startsWith('T' + SEP) && !/^[0-9a-f]{32}/.test(l) && l.includes(SEP)).map(l => { const i = l.indexOf(SEP); return [l.slice(0, i), l.slice(i + 1)]; });
  return { grid, ms: Math.round((stamps[1] - stamps[0]) * 1000), same: sums.length === 2 && sums[0] === sums[1] };
};
const line = (grid, prefix) => { const g = grid.find(([w]) => w.startsWith(prefix)); return g ? g[1] : null; };
const nums = s => (s.match(/\d[\d,]*/g) || []).map(x => Number(x.replace(/,/g, '')));
const first = s => (s == null ? NaN : nums(s)[0]);
const fails = [];
const check = (name, ok, extra) => { if (!ok) fails.push(name + (extra ? ' -- ' + extra : '')); console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok || !extra ? '' : ' -- ' + extra)); };

// ---- SCALE=1: a book of the live book's size, built inside the transaction, the file timed on it
if (process.env.SCALE) {
  const N = Number(process.env.DECKS || 2300000), E = Number(process.env.EXPECTED || 900000), F = Number(process.env.REGISTER || 60000);
  const sql = `begin;
${DDL}
insert into public.teams select 'TEAM ' || g from generate_series(1, 42) g;
insert into public.defaulter_snapshots (ref, team, snapshot_type, snapshot_date, disb_date, last_trans_date, status, ds, full_name, contact, guarantor_name, guarantor_contact, arrears, balance, created_at)
select 'C' || (g % 25000), 'TEAM ' || (1 + (g % 25000) % 42), case when g % 3 = 0 then 'initial' else 'current' end, date '2026-08-01' + (g % 109),
       case when g % 80 = 0 then date '2026-12-01' + (g % 10) else date '2024-04-01' + ((g * 7) % 950) end,           -- about 1.2% of the rows carry a swapped date in the future
       case when g % 70 = 0 then date '2026-12-01' + (g % 10) else date '2026-06-01' + (g % 170) end, 'CHRONIC', '7-12', 'NAME OF A CUSTOMER NUMBER ' || g, '0755' || g, 'GUARANTOR NAME ' || g, '0654' || g, 1000 + g % 90000, 5000 + g % 200000,
       timestamptz '2026-08-01 19:40+00' + ((g % 109) || ' days')::interval
from generate_series(1, ${N}) g;
insert into public.repayment_snapshots (ref, team, snapshot_type, snapshot_date, disb_date, last_trans_date, full_name, contact)
select 'C' || (g % 40000), 'TEAM ' || (1 + g % 42), (array['today','tomorrow','yesterday','initial'])[1 + g % 4], date '2026-10-01' + (g % 48),
       case when g % 90 = 0 then date '2026-12-01' + (g % 10) else date '2024-04-01' + ((g * 7) % 950) end, date '2026-10-01' + (g % 48), 'NAME ' || g, '0755' || g
from generate_series(1, ${E}) g;
insert into public.followup_status (ref, team, status, arrears, disb_date, last_trans, full_name, contact)
select 'C' || g, 'TEAM ' || (1 + g % 42), case when g % 6 = 0 then null else 'CHRONIC' end, case when g % 6 = 0 then null else 1000 + g end,
       case when g % 100 = 0 then date '2026-12-01' + (g % 10) else date '2024-04-01' + ((g * 7) % 950) end, date '2026-10-01' + (g % 48), 'NAME ' || g, '0755' || g
from generate_series(1, ${F}) g;
analyze;
select 'rows', (select count(*) from public.defaulter_snapshots), pg_size_pretty(pg_total_relation_size('public.defaulter_snapshots'));
select 'T' || chr(31) || extract(epoch from clock_timestamp());
${FILE}
select 'T' || chr(31) || extract(epoch from clock_timestamp());
rollback;`;
  const out = psql(sql).trim().split('\n');
  const t = out.filter(l => l.startsWith('T' + SEP)).map(l => Number(l.split(SEP)[1]));
  console.log(out.find(l => l.startsWith('rows')).replace(/\x1f/g, ' '));
  console.log('the file took ' + Math.round((t[1] - t[0]) * 1000) + ' ms');
  for (const l of out.filter(l => l.includes(SEP) && !l.startsWith('T') && !l.startsWith('rows')).slice(0, 12)) console.log('  ' + l.replace(SEP, ' | ').slice(0, 170));
  process.exit(0);
}

// every number, date and example the file prints, against the count made in JavaScript
function compare(label, grid, b) {
  const e = expectOf(b), bad = [];
  const eq = (what, got, want) => { if (got !== want) bad.push(what + ': got ' + got + ', want ' + want); };
  eq('today', line(grid, 'today'), '2026-11-17 Tue');
  const tab = line(grid, 'Defaulters Followup tab (customers listed)');
  eq('tab future', first(tab), e.shownFut); eq('tab dated', nums(tab)[1], e.shownDated); eq('tab latest', (tab.match(/is (\d{4}-\d\d-\d\d)/) || [])[1], e.shownMax == null ? undefined : iso(e.shownMax));
  const hid = line(grid, 'Defaulters Followup, register rows the tab does NOT list');
  eq('hidden future', first(hid), e.hiddenFut); eq('hidden of', nums(hid)[1], e.hidden);
  eq('deck rows read', first(line(grid, 'Stored decks from')), e.dRows);
  const dd = line(grid, 'Stored decks: Disb date later than today');
  eq('deck future', first(dd), e.nD); eq('deck future initial', nums(dd)[1], e.nDIni); eq('deck future current', nums(dd)[2], e.nDCur);
  if (e.nD) { eq('deck swap explains', nums(dd)[3], e.nDSw); eq('deck latest', (dd.match(/the latest is (\d{4}-\d\d-\d\d)/) || [])[1], iso(e.dMax)); }
  eq('deck last trans', first(line(grid, 'Stored decks: Last trans')), e.nLt);
  eq('ghost customers', first(line(grid, 'CUSTOMERS whose LAST-KNOWN')), e.ghosts);
  eq('latest current deck named', (line(grid, 'CUSTOMERS whose LAST-KNOWN') === null ? '' : (grid.find(([w]) => w.startsWith('CUSTOMERS whose LAST-KNOWN'))[0].match(/\((\d{4}-\d\d-\d\d)\)/) || [])[1]), iso(e.latestCur));
  const ex = line(grid, 'Expected sheet');
  eq('expected disb', nums(ex)[0], e.rpD); eq('expected last trans', nums(ex)[1], e.rpLt); eq('expected rows', nums(ex)[2], e.rpRows);
  const ln = line(grid, 'Loans'); eq('loans future', first(ln), e.lnD); eq('loans dated', nums(ln)[1], e.lnDated);
  const weeks = grid.filter(([w]) => w.startsWith('    deck week of '));
  eq('weeks listed', weeks.length, e.weeks.length);
  e.weeks.forEach((w, i) => {
    const g = weeks[i]; if (!g) return;
    eq('week ' + i, g[0].slice(17, 27), w.wk);
    eq('week ' + w.wk + ' counts', nums(g[1]).join(), [w.n.initial, w.d.initial, w.l.initial, w.n.current, w.d.current, w.l.current].join());
  });
  const exs = grid.filter(([w]) => w.startsWith('    e.g. ')).map(([w]) => w.slice(9).split(' ')[0]);
  eq('examples (farthest first)', exs.join(), e.examples.join());
  check(label + ': every line the file prints equals the count made in JavaScript', bad.length === 0, bad.slice(0, 4).join(' | '));
  check(label + ': no name of a customer is printed', !grid.some(([w, a]) => /NAME|GUARANTOR|0755/.test(w + a)));
  return e;
}

// 1. a book as the old importer left it
const A = book();
const runA = run(withToday(FILE), A);
{
  check('the file left every table exactly as it was (read-only)', runA.same);
  const e = compare('a swapped book', runA.grid, A);
  const ans = line(runA.grid, 'ANSWER');
  check('a swapped book is answered with the counts, not with "no Disb date"', /^Disb dates later than today: Defaulters Followup tab/.test(ans) && !/^no Disb date/.test(ans), ans);
  check('the hand-made rows are there to be found', e.ghosts >= 6 && e.nDSw > 0 && e.nD - e.nDSw >= 2 && e.hiddenFut >= 2 && e.rpD >= 2 && e.lnD >= 1 && e.weeks.length >= 14 && e.nDIni >= 1,
    JSON.stringify({ g: e.ghosts, s: e.nDSw, n: e.nD, h: e.hiddenFut, r: e.rpD, l: e.lnD, w: e.weeks.length, i: e.nDIni }));
  console.log('      ' + A.dk.length.toLocaleString('en-US') + ' deck rows; the file itself took ' + runA.ms + ' ms');
  if (process.env.SHOW) { console.log(); for (const [w, a] of runA.grid.slice(0, 40)) console.log((w + ' '.repeat(120)).slice(0, 120) + ' | ' + a); console.log(); }
}
// 2. a clean book: nothing later than today anywhere
{
  const C = book({ clean: true });
  const { grid } = run(withToday(FILE), C), e = compare('a clean book', grid, C);
  const ans = line(grid, 'ANSWER');
  check('a clean book is answered "no Disb date later than today ... not proof"', e.nD === 0 && e.shownFut + e.hiddenFut === 0 && e.rpD === 0 && e.lnD === 0 && /^no Disb date later than today in any of the four tables/.test(ans) && /not proof/.test(ans), ans);
}
// 2b. a clean book with ONE later date, in one table: the verdict must see it, whichever table it is in
for (const [plus, word] of [['rp', 'Expected sheet 1'], ['ln', 'loans 1'], ['rgHidden', 'register rows the tab does not list 1'], ['rgShown', 'Defaulters Followup tab 1'], ['dk', 'stored decks 1 rows']]) {
  const P = book({ clean: true, plus }), { grid } = run(withToday(FILE), P), e = compare('a clean book with one later date (' + plus + ')', grid, P);
  const ans = line(grid, 'ANSWER');
  check('a clean book with one later date in ' + plus + ' is answered with that table\'s count', ans.includes(word) && !/^no Disb date/.test(ans), ans);
}
// 3. the file's own "today" expression runs, and is the East Africa date
{
  const out = psql(`select to_char((now() at time zone 'Africa/Dar_es_Salaam')::date, 'YYYY-MM-DD Dy');`).trim();
  const r = run(FILE, book({ clean: true, specials: false }));
  check('the file as pasted (its own today expression) prints the East Africa date', line(r.grid, 'today') === out, line(r.grid, 'today') + ' vs ' + out);
}
// 4. broken on purpose: every break must change the answer of at least one book (or make the file fail)
{
  const regs = [A, book({ clean: true }), book({ clean: true, plus: 'rp' }), book({ clean: true, plus: 'ln' }), book({ clean: true, plus: 'rgHidden' }), book({ clean: true, plus: 'rgShown' }), book({ clean: true, plus: 'dk' })];
  const show = g => g.map(x => x.join('|')).join('\n');
  const base = regs.map(r => show(run(withToday(FILE), r).grid));
  const all = (re, to) => src => src.replace(re, to);                                  // every place the rule is written
  const breaks = [
    ['a Disb date TODAY counts as later than today (every test of it in the decks)', src => src.replace(/(s\.disb_date|\bd) > \(select today from t\)/g, '$1 >= (select today from t)')],
    ['a Last trans date TODAY counts as later than today (every test of it in the decks)', src => src.replace(/(s\.last_trans_date|\blt) > \(select today from t\)/g, '$1 >= (select today from t)')],
    ['a customer on the LATEST deck is called a ghost',                  all(/and f\.day < \(select latest_cur from dall\)/, 'and f.day <= (select latest_cur from dall)')],
    ['a row counts as newer than itself',                                all(/\(n\.snapshot_date, n\.created_at\) > \(f\.day, f\.created_at\)/, '(n.snapshot_date, n.created_at) >= (f.day, f.created_at)')],
    ['a newer row of a customer with NO team is not seen',               all(/n\.team is not distinct from f\.team/, 'n.team = f.team')],
    ['an initial deck row counts as a last-known row',                   all(/where f\.kind = 'current' and f\.d > /, 'where f.d > ')],
    ['the window is dropped (rows before the first day are read)',       all(/s\.snapshot_date >= \(select from_day from t\)\n    and \(s\.disb_date/, "s.snapshot_date >= date '2000-01-01'\n    and (s.disb_date")],
    ['the first day of the window is left out',                          all(/s\.snapshot_date >= \(select from_day from t\)\n    and \(s\.disb_date/, 's.snapshot_date > (select from_day from t)\n    and (s.disb_date')],
    ['the weeks are months',                                             all(/date_trunc\('week', day\)::date as wk,\n               sum\(n\)/, "date_trunc('month', day)::date as wk,\n               sum(n)")],
    ['the examples run nearest-first',                                   all(/order by d desc, ref\) as rn from gh/, 'order by d, ref) as rn from gh')],
    ['only three examples are listed',                                   all(/where e\.rn <= 8/, 'where e.rn <= 3')],
    ['a customer with a status OR arrears is not listed on the tab (every place it is written)', all(/\(status is not null or arrears is not null\)/g, '(status is not null and arrears is not null)')],
    ['the hidden rows include the listed ones',                          all(/count\(\*\) filter \(where status is null and arrears is null and disb_date > /, 'count(*) filter (where disb_date > ')],
    ['the Expected sheet is read without its window',                    all(/where snapshot_date >= \(select today from t\) - \(select expected_days from t\)/, "where snapshot_date >= date '2000-01-01'")],
    ['a loan disbursed TODAY counts as later than today',                all(/count\(\*\) filter \(where disb_date > \(select today from t\)\)                         as n_d\n  from public\.loans/, 'count(*) filter (where disb_date >= (select today from t))                         as n_d\n  from public.loans')],
    ['the swap is not made',                                             all(/make_date\(extract\(year from s\.disb_date\)::int, extract\(day from s\.disb_date\)::int, extract\(month from s\.disb_date\)::int\)/, 's.disb_date')],
    ['the verdict forgets the Expected sheet',                           all(/\+ \(select n_d from rp\) \+ \(select n_d from ln\) = 0/, '+ (select n_d from ln) = 0')],
    ['the verdict forgets the loans',                                    all(/\+ \(select n_d from rp\) \+ \(select n_d from ln\) = 0/, '+ (select n_d from rp) = 0')],
    ['the verdict forgets the register rows the tab does not list',      all(/\(select n_shown_fut \+ n_hidden_fut from rg\)/, '(select n_shown_fut from rg)')],
    ['the verdict forgets the stored decks',                             all(/\(select n_shown_fut \+ n_hidden_fut from rg\) \+ \(select n_d from dsum\)/, '(select n_shown_fut + n_hidden_fut from rg)')],
    ['the verdict says "none" when there are some',                      all(/= 0\n                then 'no Disb date later than today/, ">= 0\n                then 'no Disb date later than today")],
    ['the latest current deck is read from the initial decks',           all(/max\(day\) filter \(where kind = 'current'\) as latest_cur/, "max(day) filter (where kind = 'initial') as latest_cur")],
  ];
  for (const [name, fn] of breaks) {
    const src = withToday(FILE), broken = fn(src);
    if (broken === src) { check('(break "' + name + '" was applied)', false, 'the pattern is not in the file any more'); continue; }
    let differs = false;
    for (let i = 0; i < regs.length && !differs; i++) {
      try { differs = show(run(broken, regs[i]).grid) !== base[i]; } catch (err) { differs = true; }       // a break that makes the file fail is caught too
    }
    check('BROKEN ON PURPOSE, the answer changes: ' + name, differs);
  }
  // the East Africa date is the one thing here that depends on the clock; test/future-disb-dates-audit.test.mjs pins the expression in the file.
}
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
