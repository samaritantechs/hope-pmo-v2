/* THE SWAPPED DATES OF EACH CUSTOMER'S LAST-KNOWN DECK ROW, PUT RIGHT IN PLACE -- db/RUN-ME-071, run for real on a PostgreSQL.

     "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026

   db/RUN-ME-071-repair-swapped-last-known-deck-dates.sql changes dates in the hottest table of the book, on RUN-ME-060's rule, in a choice of rows that is new: a customer's LAST-KNOWN row, the
   newest CURRENT row of the same team and loan number. The rule was checked by tools/db-checks/deck-date-repair.mjs; what is new, and what is not believed on a reading, is WHICH rows, in what
   window, in what order, and what is left alone.

   THE BOOK IS THE REAL ONE: the WHOLE of db/schema.sql in a scratch database, the teams the table's own foreign key asks for, and decks made the way the old importer left them: every loan has a
   real disbursement, expiry and chronic date, and a day's upload stores them swapped wherever the day and the month were both twelve or under, except the uploads that came right (a share of the
   days, and every upload from 16 Nov). It has customers who stayed to the last day, customers who left on every day of the window (their last day with a current row, or with only an INITIAL row:
   the current file dropped them that evening), days uploaded twice (the later batch is the newest), the same loan number in two teams, moved loans (an expiry moved by the days a swap moves a
   disbursement, 17 or 45 days), loans whose DAYS ELAPSED says nothing true, no chronic date, no DAYS ELAPSED.

   It passes only when: every row of the table equals a MODEL of the rule written again in JavaScript after each scenario (the row, and not only the answer); every row that is not a last-known
   row in the window is byte-identical; the answer's numbers equal the model's; a second run changes nothing; small runs end where one big run ends; a narrow window changes only the days it names;
   a count (max_rows 0) changes nothing and says the same numbers; the file's own undo puts every row back, byte for byte; a customer who is still on the latest deck is never touched; and EVERY ONE
   of a list of deliberate breaks of the file (the newest test dropped, the team ignored, the type ignored, the tie broken wrongly, a bound moved, the pattern's witness dropped, the log not kept,
   the limit not kept) changes the outcome -- a check that cannot fail when the file is broken proves nothing, and says so. It then times one month on a book of two million rows.

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/last-known-repair.mjs

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-071-repair-swapped-last-known-deck-dates.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
const CUSTOMERS = Number(process.env.CUSTOMERS || 700);
const SEP = '\x1f', DAY = 86400000, DB = 'hope_lk_check';
const psql = (sql, db = DB) => {
  try { return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', SEP, '-d', db, '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 29, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { const err = new Error('psql failed: ' + String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 4).join(' | ')); err.psql = String(e.stderr || ''); throw err; }
};
let seed = 20261117;                                               // mulberry32
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const D = s => Date.parse(s + 'T00:00:00Z');
const iso = t => (t == null ? '' : new Date(t).toISOString().slice(0, 10));
const swap = t => { if (t == null) return t; const d = new Date(t), m = d.getUTCMonth() + 1, dd = d.getUTCDate(); return (dd <= 12 && m !== dd) ? Date.UTC(d.getUTCFullYear(), dd - 1, m) : t; };
const uuid = n => 'a' + n.toString(16).padStart(7, '0') + '-0000-4000-8000-000000000000';
const pick = a => a[Math.floor(rnd() * a.length)];

// ---- the book: the truth, and what each upload stored
const FIRST = D('2026-09-01'), LAST = D('2026-11-16'), FIX = D('2026-11-16');       // the upload read right from 16 Nov
const days = []; for (let t = FIRST; t <= LAST; t += DAY) days.push(t);
const rightDay = new Map(days.map(t => [t, t >= FIX || rnd() < 0.2]));                // an upload that came right
const byShift = new Map();
for (let t = D('2024-01-01'); t <= D('2026-08-01'); t += DAY) { const sh = Math.round((swap(t) - t) / DAY); if (sh !== 0) { if (!byShift.has(sh)) byShift.set(sh, []); byShift.get(sh).push(t); } }
const SHIFTS = [29, 30, 31, 59, 60, 61].filter(sh => (byShift.get(sh) || []).length > 0);
const customers = [];
for (let i = 0; i < CUSTOMERS; i++) {
  let d = D('2024-01-01') + Math.floor(rnd() * ((D('2026-08-01') - D('2024-01-01')) / DAY)) * DAY;
  let e = d + 91 * DAY, kind = 'normal'; const x = rnd();
  if (x < 0.05) { kind = 'moved'; if (rnd() < 0.7) { const sh = pick(SHIFTS), pool = byShift.get(sh); d = pick(pool); e = d + (91 + sh) * DAY; } else e += pick([17, 45]) * DAY; }
  else if (x < 0.09) kind = 'baddays'; else if (x < 0.11) kind = 'nochronic'; else if (x < 0.13) kind = 'nodays';
  const start = days[Math.floor(rnd() * 20)];
  const stays = rnd() < 0.3, end = stays ? LAST : days[Math.floor(rnd() * (days.length - 1)) ];
  customers.push({ ref: 'R' + String(i).padStart(6, '0'), team: pick(['T1', 'T2', 'T3']), d, e, c: kind === 'nochronic' ? null : e + 14 * DAY, kind, i, start, end: Math.max(start, end), stays,
    lastOnlyInitial: !stays && rnd() < 0.15 });
}
// the same loan number in two teams: each is its own customer (the team is part of the key)
const twins = customers.filter(c => c.i % 25 === 3).map(c => ({ ...c, team: c.team === 'T1' ? 'T2' : 'T1', i: c.i + 100000, end: Math.min(LAST, c.end + DAY * 3) }));
customers.push(...twins);
const rows = []; let n = 0;
for (const c of customers) {
  for (const day of days) {
    if (day < c.start || day > c.end) continue;
    const right = rightDay.get(day);
    const base = { d: right ? c.d : swap(c.d), e: right ? c.e : swap(c.e), c: c.c == null ? null : (right ? c.c : swap(c.c)) };
    const mkRow = (type, hour, offset) => {
      let de = Math.round((day - c.d) / DAY) - offset; if (c.kind === 'baddays') de += 5 + (c.i % 55);
      rows.push({ id: uuid(++n), ref: c.ref, team: c.team, type, day, d: base.d, e: base.e, c: base.c, de: c.kind === 'nodays' ? null : de, at: day + hour * 3600000, cust: c });
    };
    const lastDayOnlyInitial = c.lastOnlyInitial && day === c.end;
    mkRow('initial', 4, 2);                                           // 07:00 East Africa
    if (!lastDayOnlyInitial) { mkRow('current', 15, 1); if (rnd() < 0.15) mkRow('current', 17, 1); }     // 18:00 and, on some days, a second upload at 20:00
  }
}
const kinds = { left: customers.filter(c => !c.stays).length, stays: customers.filter(c => c.stays).length, onlyInitial: customers.filter(c => c.lastOnlyInitial).length, twins: twins.length,
  moved: customers.filter(c => c.kind === 'moved').length, baddays: customers.filter(c => c.kind === 'baddays').length };
for (const [k, min] of [['left', 200], ['stays', 100], ['onlyInitial', 10], ['twins', 10], ['moved', 15], ['baddays', 15]]) if (kinds[k] < min) { console.error('too few ' + k + ' drawn (' + kinds[k] + '): raise CUSTOMERS'); process.exit(2); }

// ---- the model of the rule, written again
const fits = r => r.e - r.d === 91 * DAY && r.c - r.e === 14 * DAY && (r.day - r.d) / DAY - r.de >= 0 && (r.day - r.d) / DAY - r.de <= 3;
const modelNew = r => {                                               // the dates a row ends with when the file is run on it (the row as stored); null = unchanged
  if (r.d == null || r.e == null || r.c == null || r.de == null) return null;
  if (fits(r)) return null;
  const found = new Set();
  for (const d of [r.d, swap(r.d)]) for (const e of [r.e, swap(r.e)]) for (const c of [r.c, swap(r.c)]) if (e - d === 91 * DAY && c - e === 14 * DAY) { const k = (r.day - d) / DAY - r.de; if (k >= 0 && k <= 3) found.add(d + '|' + e + '|' + c); }
  if (found.size !== 1) return null;
  const [d, e, c] = [...found][0].split('|').map(Number); return { d, e, c };
};
const newest = new Map();                                             // (team, ref) -> its newest current row
for (const r of rows) if (r.type === 'current') { const k = r.team + '|' + r.ref, o = newest.get(k); if (!o || r.day > o.day || (r.day === o.day && r.at > o.at)) newest.set(k, r); }
const isLastKnown = r => r.type === 'current' && newest.get(r.team + '|' + r.ref) === r;
const expectFor = (from, to, limit = Infinity) => {                   // the book after one run over the window: Map id -> {d, e, c}; and the answer
  const inWin = rows.filter(r => isLastKnown(r) && r.day >= D(from) && r.day <= D(to));
  const cand = inWin.filter(r => r.d != null && r.e != null && r.c != null && r.de != null && !fits(r));
  const one = cand.map(r => ({ r, n: modelNew(r) })).filter(x => x.n).sort((a, b) => a.r.day - b.r.day || (a.r.id < b.r.id ? -1 : 1));
  const take = one.slice(0, limit), m = new Map(take.map(x => [x.r.id, x.n]));
  return { m, ans: [inWin.length, cand.length, one.length, take.length, one.length - take.length, cand.length - one.length] };
};
const hasWork = expectFor('2026-09-01', '2026-11-15').m.size;
if (hasWork < 100) { console.error('only ' + hasWork + ' rows to repair were drawn'); process.exit(2); }

// ---- the database
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const copy = `copy public.defaulter_snapshots (id, ref, team, snapshot_type, snapshot_date, weekday, disb_date, expire_date, chronic_date, days_elapsed, created_at) from stdin with (format csv, null '');\n`
  + rows.map(r => [r.id, r.ref, r.team, r.type, iso(r.day), '', iso(r.d), iso(r.e), iso(r.c), r.de == null ? '' : r.de, new Date(r.at).toISOString()].join(',')).join('\n') + '\n\\.\n';
const fresh = () => {
  try { execFileSync('psql', ['-X', '-q', '-At', '-d', 'postgres', '-c', `drop database if exists ${DB}`], { stdio: 'pipe' }); } catch (e) { /* none yet */ }
  execFileSync('psql', ['-X', '-q', '-At', '-d', 'postgres', '-c', `create database ${DB}`], { stdio: 'pipe' });
  psql(SCHEMA);
  psql(`insert into public.teams (team) values ('T1'), ('T2'), ('T3');\n` + copy + 'analyze public.defaulter_snapshots;');
};
const drop = () => { try { execFileSync('psql', ['-X', '-q', '-At', '-d', 'postgres', '-c', `drop database if exists ${DB}`], { stdio: 'pipe' }); } catch (e) { /* ok */ } };
const ALL = `select id, to_char(disb_date, 'YYYY-MM-DD'), to_char(expire_date, 'YYYY-MM-DD'), to_char(chronic_date, 'YYYY-MM-DD') from public.defaulter_snapshots order by id`;
const MD5 = `select md5(string_agg(id::text || coalesce(disb_date::text, '') || coalesce(expire_date::text, '') || coalesce(chronic_date::text, '') || coalesce(days_elapsed::text, '') || ref || snapshot_type || snapshot_date::text, '|' order by id)) from public.defaulter_snapshots`;
const state = () => new Map(psql(ALL).trim().split('\n').map(l => { const p = l.split(SEP); return [p[0], { d: p[1], e: p[2], c: p[3] }]; }));
const script = (f, from, to, max) => f.replace("date '2026-08-01' as from_day", `date '${from}' as from_day`).replace("date '2026-11-15' as to_day", `date '${to}' as to_day`)
  .replace('50000 as max_rows', `${max} as max_rows`).replace("between date '2026-08-01' and date '2026-11-15'", `between date '${from}' and date '${to}'`);
const run = (f, from, to, max) => psql('begin;\n' + script(f, from, to, max) + '\ncommit;').trim().split('\n').pop().split(SEP).map(Number);       // one transaction, as the SQL editor sends it: `set local` works
const undoOf = (f, from, to) => script(f, from, to, 0).slice(f.indexOf('-- UNDO:')).split('\n').filter(l => l.startsWith('-- ') && !l.startsWith('-- UNDO')).map(l => l.slice(3)).join('\n') + ';';

const fails = [], need = (ok, what) => { if (!ok) fails.push(what); };
const compare = (label, from, to, limit, got, ans, wantRuns = 1) => {   // every row of the book against the model; the answer against the model's
  const e = expectFor(from, to, limit); let bad = 0, firstBad = '';
  for (const r of rows) {
    const g = got.get(r.id), w = e.m.get(r.id), want = w ? { d: iso(w.d), e: iso(w.e), c: iso(w.c) } : { d: iso(r.d), e: iso(r.e), c: iso(r.c) };
    if (!g || g.d !== want.d || g.e !== want.e || g.c !== want.c) { bad++; if (!firstBad) firstBad = r.id + ' ' + r.ref + ' ' + r.type + ' ' + iso(r.day) + ' got ' + JSON.stringify(g) + ' want ' + JSON.stringify(want); }
  }
  need(bad === 0, label + ': ' + bad + ' rows do not equal the model (first: ' + firstBad + ')');
  if (ans) need(JSON.stringify(ans) === JSON.stringify(e.ans), label + ': the answer ' + JSON.stringify(ans) + ' is not the model\'s ' + JSON.stringify(e.ans));
  return e;
};

let exitCode = 1, timing = '';
try {
  // ---- 1. the file as it is: one big run over the whole window, every row against the model
  fresh();
  const pristine = psql(MD5).trim();
  const W = ['2026-09-01', '2026-11-15'];
  const ans1 = run(FILE, ...W, 1000000); const got1 = state();
  const E1 = compare('one run over the window', ...W, Infinity, got1, ans1);
  const after1 = psql(MD5).trim();
  need(E1.m.size >= 100 && E1.ans[0] > E1.m.size, 'the window held too little for the run to mean anything: ' + E1.m.size + ' repaired of ' + E1.ans[0] + ' last-known rows');
  const ans1b = run(FILE, ...W, 1000000);
  need(ans1b[3] === 0 && psql(MD5).trim() === after1, 'a second run changed ' + ans1b[3] + ' rows: it must change nothing');
  need(psql(`select count(*) from public.defaulter_last_known_repair_log`).trim() === String(E1.m.size), 'the log holds ' + psql(`select count(*) from public.defaulter_last_known_repair_log`).trim() + ' rows but the model repaired ' + E1.m.size);
  // a customer still on the latest deck is never touched, and no initial row, no row that is not its customer's newest
  const touchedIds = new Set(psql(`select id from public.defaulter_last_known_repair_log`).trim().split('\n').filter(Boolean));
  need([...touchedIds].every(id => { const r = rows.find(x => x.id === id); return r.type === 'current' && isLastKnown(r) && !r.cust.stays; }), 'a row that is not a left customer\'s last-known current row was changed');
  need(rows.filter(r => r.cust.stays && touchedIds.has(r.id)).length === 0, 'a customer still on the latest deck was touched');
  // the undo at the foot, over the same window: every row back, byte for byte, and the log stays
  psql('begin;\n' + undoOf(FILE, ...W) + '\ncommit;');
  need(psql(MD5).trim() === pristine, 'the undo did not put every row back exactly');
  need(psql(`select count(*) from public.defaulter_last_known_repair_log`).trim() === String(E1.m.size), 'the log did not stay after the undo');

  // ---- 2. a count changes nothing and says the same numbers; a small limit, again and again, ends where one big run did; a narrow window changes only its days
  const cnt = run(FILE, ...W, 0); need(psql(MD5).trim() === pristine, 'a count (max_rows 0) changed the book');
  need(cnt[3] === 0 && cnt[4] === E1.ans[2] && cnt[0] === E1.ans[0] && cnt[1] === E1.ans[1], 'the count says ' + JSON.stringify(cnt) + ', not the model\'s numbers');
  let last; for (let i = 0; i < 80; i++) { last = run(FILE, ...W, 40); if (last[3] === 0) break; }
  need(last[3] === 0 && last[4] === 0, 'small runs did not finish the work');
  compare('small runs', ...W, Infinity, state(), null);
  fresh();
  const NW = ['2026-10-05', '2026-10-11']; run(FILE, ...NW, 1000000);
  compare('a narrow window', ...NW, Infinity, state(), expectFor(...NW).ans);

  // ---- 3. broken on purpose: each of these must change the outcome (the book after the file ran on the whole window, the log, and the count)
  const sig = f => { fresh(); const a7 = run(f, ...W, 7), m7 = psql(MD5).trim(); const a = run(f, ...W, 1000000); const c = run(f, ...W, 0); return JSON.stringify([a7, m7, a, c, psql(MD5).trim(), psql(`select count(*), coalesce(sum(extract(day from disb_new)), 0) from public.defaulter_last_known_repair_log`).trim()]); };
  const base = sig(FILE);
  const sub = (re, to, what) => src => { const m = src.match(new RegExp(re.source, 'g')) || []; if (m.length !== 1) throw new Error('the file has ' + m.length + ' of "' + what + '", the check needs exactly one'); return src.replace(re, () => to); };
  const breaks = [
    ['no test that a newer row exists: every current row of the window is a candidate',               sub(/and not exists \(select 1 from public\.defaulter_snapshots n/, 'and exists (select 1 from public.defaulter_snapshots n', 'the not exists')],
    ['an INITIAL row counts as a newer row (the type of the newer row is not asked)',                  sub(/ and n\.snapshot_type = 'current'\n/, '\n', 'the type of the newer row')],
    ['the type of the candidate is not asked: an initial row is a candidate',                           sub(/where s\.snapshot_type = 'current' and s\.snapshot_date between/, 'where s.snapshot_date between', 'the type of the candidate')],
    ['the team is not part of the customer (the same loan number in two teams is one customer)',       sub(/n\.ref = s\.ref and n\.team is not distinct from s\.team and/, 'n.ref = s.ref and', 'the team')],
    ['a row of the same day is never newer (a day uploaded twice: both are last-known)',                sub(/ or \(n\.snapshot_date = s\.snapshot_date and n\.created_at > s\.created_at\)/, '', 'the tie')],
    ['a row of the same day is always newer (a day uploaded once: nobody is last-known on it)',         sub(/n\.snapshot_date > s\.snapshot_date or \(n\.snapshot_date = s\.snapshot_date and n\.created_at > s\.created_at\)/, 'n.snapshot_date >= s.snapshot_date', 'the order')],
    ['the older row is the newer one (the order reversed)',                                             sub(/n\.snapshot_date > s\.snapshot_date or \(n\.snapshot_date = s\.snapshot_date and n\.created_at > s\.created_at\)/, 'n.snapshot_date < s.snapshot_date or (n.snapshot_date = s.snapshot_date and n.created_at < s.created_at)', 'the order')],
    ['the window ends where it starts',                                                                 sub(/between win\.from_day and win\.to_day/, 'between win.from_day and win.from_day', 'the window')],
    ['the window is not asked at all',                                                                  sub(/ and s\.snapshot_date between win\.from_day and win\.to_day/, '', 'the window')],
    ['DAYS ELAPSED is not a witness of the reading (one date alone decides)',                           f => sub(/\n\s+and s\.snapshot_date - s\.disb_date - s\.days_elapsed between 0 and 3\)/, ')', 'the fit witness')(sub(/ and c\.snapshot_date - x\.d - c\.de between 0 and 3/, '', 'the reading witness')(f))],
    ['the twelfth of a month is not a day that can be swapped',                                         sub(/extract\(day from s\.disb_date\) <= 12 and/, 'extract(day from s.disb_date) <= 11 and', 'the twelve')],
    ['the limit is not kept',                                                                           sub(/limit \(select max_rows from win\)/, '', 'the limit')],
    ['the log is not kept',                                                                             sub(/from take t\n  on conflict \(id\) do nothing/, 'from take t where false\n  on conflict (id) do nothing', 'the log')],
    ['the chronic date is not exchanged with the others',                                               sub(/set disb_date = t\.d2, expire_date = t\.e2, chronic_date = t\.c2/, 'set disb_date = t.d2, expire_date = t.e2', 'the three dates')],
  ];
  /* NOT LISTED: `having count(*) = 1` -> `>= 1`. With DAYS ELAPSED as a witness two DIFFERENT readings cannot both fit (a swap moves a date by at least 27 days and the witness allows 3), so that mutation changes nothing
     a book can show: it is an equivalent mutant, and the one reading is guarded by the break of the witness above (without it, two readings do fit). */
  let uncaught = 0;
  for (const [name, fn] of breaks) {
    let broken, why = '', ok = false;
    try { broken = fn(FILE); } catch (err) { why = err.message; }
    if (broken) { try { ok = sig(broken) !== base; why = 'the outcome is the same as the file\'s'; } catch (err) { why = 'the broken file does not run: ' + err.message.slice(0, 200); } }
    if (!ok) { uncaught++; need(false, 'BROKEN ON PURPOSE and not caught: ' + name + ' (' + why + ')'); }
  }

  // ---- 4. the timing the owner will see: one month on a book of about two million rows, with the real table's indexes
  fresh();
  psql(`truncate public.defaulter_snapshots;
    create or replace function pg_temp.sw(d date) returns date language sql immutable as $$ select case when extract(day from d) <= 12 and extract(day from d) <> extract(month from d) then make_date(extract(year from d)::int, extract(day from d)::int, extract(month from d)::int) else d end $$;
    insert into public.defaulter_snapshots (ref, team, snapshot_type, snapshot_date, disb_date, expire_date, chronic_date, days_elapsed, created_at)
    select 'B' || lpad(c::text, 6, '0'), 'T' || (1 + c % 3), t.type, day::date,
           pg_temp.sw(base), pg_temp.sw(base + 91), pg_temp.sw(base + 105), (day::date - base) - t.off, day::date + time '18:00'
    from (select c, date '2026-03-01' + (c * 7 % 150) as base, date '2026-08-03' + (c * 5 % 60) as s, date '2026-08-03' + 60 + (c * 11 % 66) as e from generate_series(1, 20000) c) cu
    cross join lateral generate_series(cu.s, cu.e, interval '1 day') day
    cross join (values ('initial', 2), ('current', 1)) t(type, off);
    analyze public.defaulter_snapshots;`);
  const total = Number(psql('select count(*) from public.defaulter_snapshots').trim());
  const t0 = Date.now(); const big = run(FILE, '2026-10-01', '2026-10-31', 50000); const sec = (Date.now() - t0) / 1000;
  const t1 = Date.now(); const bigAll = run(FILE, '2026-08-03', '2026-11-15', 0); const secAll = (Date.now() - t1) / 1000;
  need(sec < 30, 'one month on ' + total + ' rows took ' + sec.toFixed(1) + ' s: over the 30 seconds this check allows (the file stops at 50)');
  need(big[0] > 0 && big[1] > 0, 'the timing book had no last-known rows in the month');
  timing = `a book of ${total.toLocaleString('en')} rows: one month (${big[0].toLocaleString('en')} last-known rows, ${big[3].toLocaleString('en')} repaired) in ${sec.toFixed(1)} s; the whole range counted (max_rows 0: ${bigAll[0].toLocaleString('en')} last-known rows, ${bigAll[2].toLocaleString('en')} to repair) in ${secAll.toFixed(1)} s`;

  console.log(`customers ${customers.length} (left ${kinds.left}, still there ${kinds.stays}, last day initial-only ${kinds.onlyInitial}, same loan in two teams ${kinds.twins}), deck rows ${rows.length}, ${days.length} days`);
  console.log(`one run over the window: ${E1.m.size} rows repaired of ${E1.ans[0]} last-known rows (${E1.ans[1]} not fitting, ${E1.ans[1] - E1.ans[2]} left alone: no single reading)`);
  console.log(`${breaks.length} deliberate breaks, ${breaks.length - uncaught} change the outcome`);
  console.log(timing);
  if (fails.length) { console.error('\nFAILED:\n - ' + fails.join('\n - ')); exitCode = 1; }
  else { console.log('\nOK: the repair puts right the last-known rows and nothing else, undoes exactly, and fails when broken.'); exitCode = 0; }
} finally { drop(); }
process.exit(exitCode);
