/* THE SWAPPED DATES OF EACH CUSTOMER'S LAST-KNOWN DECK ROW, PUT RIGHT IN PLACE, TEAM BY TEAM -- db/RUN-ME-071, run for real on a PostgreSQL.

     "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026
     "071 / Error: SQL query ran into an upstream timeout" -- the owner, on the first form of the file (one statement over the whole range: docs/HANDOFF.md Part 106)
     "Days still to do is reducing 2 or 3 per run.. Ill go for to long bro" -- the owner, on the second form (day by day: a day cost about 3 seconds on the live book: Part 108)

   db/RUN-ME-071-repair-swapped-last-known-deck-dates.sql changes dates in the hottest table of the book, on RUN-ME-060's rule, in a choice of rows that is new: a customer's LAST-KNOWN row, the
   newest CURRENT row of the same team and loan number. The rule was checked by tools/db-checks/deck-date-repair.mjs; what is checked here is WHICH rows, in what window, in what order, what is left
   alone, THAT A RUN'S WORK IS BOUNDED (it does the teams its clock allows and writes each finished team down, so the next run carries on) and THAT THE WORK IS SMALL: for each loan number of a
   team, one look at the newest row, never a read of a day. The first form was checked on answers and a cached book and timed out live; the second counted pages on a book whose days lay together and
   was 35 runs long live, because a day's rows are not together on the live book. So the pages are counted here on a book laid out the WORST way (one row to a page), per loan number, on the whole
   book and on half of it, and the two settings and the one expression that keep the file to those pages are broken on purpose.

   THE BOOK IS THE REAL ONE: the WHOLE of db/schema.sql in a scratch database, the teams the table's own foreign key asks for (six, and rows that name none), and decks made the way the old importer
   left them: every loan has a real disbursement, expiry and chronic date, and a day's upload stores them swapped wherever the day and the month were both twelve or under, except the uploads that
   came right (a share of the days, and every upload from 16 Nov). It has customers who stayed to the last day, customers who left on every day of the window (their last day with a current row, or
   with only an INITIAL row: the current file dropped them that evening), customers who LEFT AND CAME BACK, days uploaded twice (the later batch is the newest), the same loan number in two teams,
   rows with no team, moved loans (an expiry moved by the days a swap moves a disbursement, 17 or 45 days), loans whose DAYS ELAPSED says nothing true, no chronic date, no DAYS ELAPSED.

   It passes only when: every row of the table equals a MODEL of the rule written again in JavaScript after each scenario (the row, and not only the answer); every row that is not a last-known row in
   the window is byte-identical; the answer's numbers, and the numbers it writes down for each team, equal the model's; a second run does nothing and says FINISHED; runs of ONE team each (a clock of
   zero) end where one big run ends; a window narrower than the one a team was done for does not skip it; a run cut off by the clock, with a database made slow on purpose, finishes the team in hand
   and the next run carries on to the same end; a run cut off by the database's own limit changes NOTHING; a book without the (team, loan number) index is refused with a plain message and nothing
   changed; a count changes nothing and writes nothing down; the file's own undo puts every row back, byte for byte; a customer who is still on the latest deck is never touched; and EVERY ONE of a
   list of deliberate breaks of the file changes the outcome -- a check that cannot fail when the file is broken proves nothing, and says so.

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/last-known-repair.mjs

   TIMING_DAYS=40 makes the timing book smaller (about 100 seconds shorter). It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the file did what it
   says, and failed when broken. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-071-repair-swapped-last-known-deck-dates.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
const CUSTOMERS = Number(process.env.CUSTOMERS || 700), TIMING_DAYS = Number(process.env.TIMING_DAYS || 107);
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
const TEAMS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'], NOTEAM = '(NO TEAM)', UNITS = TEAMS.concat([NOTEAM]);   // the file visits the teams of the teams table in order, and then the rows that name none
const FIRST = D('2026-09-01'), LAST = D('2026-11-16'), FIX = D('2026-11-16');       // the upload read right from 16 Nov
const days = []; for (let t = FIRST; t <= LAST; t += DAY) days.push(t);
const rightDay = new Map(days.map(t => [t, t >= FIX || rnd() < 0.2]));                // an upload that came right
const byShift = new Map();
for (let t = D('2024-01-01'); t <= D('2026-08-01'); t += DAY) { const sh = Math.round((swap(t) - t) / DAY); if (sh !== 0) { if (!byShift.has(sh)) byShift.set(sh, []); byShift.get(sh).push(t); } }
const SHIFTS = [29, 30, 31, 59, 60, 61].filter(sh => (byShift.get(sh) || []).length > 0);
const customers = [];
for (let i = 0; i < CUSTOMERS; i++) {
  const comesBack = i % 16 === 5;                                                     // left and came back
  let d = D('2024-01-01') + Math.floor(rnd() * ((D('2026-08-01') - D('2024-01-01')) / DAY)) * DAY;
  if (comesBack || i % 35 === 7) while (swap(d) === d) d += DAY;                      // a date that a swap can move
  let e = d + 91 * DAY, kind = 'normal'; const x = rnd();
  if (!comesBack && i % 35 !== 7) {
    if (x < 0.05) { kind = 'moved'; if (rnd() < 0.7) { const sh = pick(SHIFTS), pool = byShift.get(sh); d = pick(pool); e = d + (91 + sh) * DAY; } else e += pick([17, 45]) * DAY; }
    else if (x < 0.09) kind = 'baddays'; else if (x < 0.11) kind = 'nochronic'; else if (x < 0.13) kind = 'nodays';
  }
  const si = Math.floor(rnd() * 20), start = days[si];
  const stays = rnd() < 0.3, end = stays ? days[days.length - 1] : days[Math.floor(rnd() * (days.length - 1))];
  const c = { ref: 'R' + String(i).padStart(6, '0'), team: i % 35 === 7 ? null : pick(TEAMS), d, e, c: kind === 'nochronic' ? null : e + 14 * DAY, kind, i, start, end: Math.max(start, end), stays,
    lastOnlyInitial: !stays && rnd() < 0.15, gap: null };
  if (comesBack && (c.end - c.start) / DAY >= 12) { const g0 = days[days.indexOf(c.start) + 3], len = 1 + (i % 3); c.gap = [g0, days[days.indexOf(g0) + len - 1]]; }
  customers.push(c);
}
// the same loan number in two teams: each is its own customer (the team is part of the key)
const twins = customers.filter(c => c.i % 25 === 3).map(c => ({ ...c, team: c.team === 'T1' ? 'T2' : 'T1', i: c.i + 100000, end: Math.min(LAST, c.end + DAY * 3) }));
customers.push(...twins);
const rows = []; let n = 0;
for (const c of customers) {
  for (const day of days) {
    if (day < c.start || day > c.end) continue;
    if (c.gap && day >= c.gap[0] && day <= c.gap[1]) continue;                        // away from the decks for a few days
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
  moved: customers.filter(c => c.kind === 'moved').length, baddays: customers.filter(c => c.kind === 'baddays').length, comeBack: customers.filter(c => c.gap).length, noTeam: customers.filter(c => c.team == null).length };
for (const [k, min] of [['left', 200], ['stays', 100], ['onlyInitial', 10], ['twins', 10], ['moved', 15], ['baddays', 15], ['comeBack', 15], ['noTeam', 15]]) if (kinds[k] < min) { console.error('too few ' + k + ' drawn (' + kinds[k] + '): raise CUSTOMERS'); process.exit(2); }

// ---- the model of the rule, written again
const unitOf = r => (r.team == null ? NOTEAM : r.team);
const keyOf = r => (r.team == null ? '(none)' : r.team) + '|' + r.ref;
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
for (const r of rows) if (r.type === 'current') { const k = keyOf(r), o = newest.get(k); if (!o || r.day > o.day || (r.day === o.day && r.at > o.at)) newest.set(k, r); }
const isLastKnown = r => r.type === 'current' && newest.get(keyOf(r)) === r;
const loansOf = new Map(UNITS.map(u => [u, new Set()]));              // every loan number a team has ever had (an index entry is an entry whatever the row's type)
for (const r of rows) loansOf.get(unitOf(r)).add(r.ref);
const expectFor = (from, to) => {                                     // the book after the file ran over the whole window: Map id -> {d, e, c}; the answer; and the numbers of each team
  const inWin = rows.filter(r => isLastKnown(r) && r.day >= D(from) && r.day <= D(to));
  const cand = inWin.filter(r => r.d != null && r.e != null && r.c != null && r.de != null && !fits(r));
  const one = cand.map(r => ({ r, n: modelNew(r) })).filter(x => x.n);
  const byUnit = new Map(UNITS.map(u => [u, { loans: loansOf.get(u).size, lk: 0, cand: 0, one: 0 }]));
  inWin.forEach(r => byUnit.get(unitOf(r)).lk++); cand.forEach(r => byUnit.get(unitOf(r)).cand++); one.forEach(x => byUnit.get(unitOf(x.r)).one++);
  return { m: new Map(one.map(x => [x.r.id, x.n])), ans: { loans: UNITS.reduce((s, u) => s + loansOf.get(u).size, 0), lk: inWin.length, cand: cand.length, one: one.length, left: cand.length - one.length }, byUnit };
};
const W = ['2026-09-01', '2026-11-15'], NW = ['2026-10-05', '2026-10-11'];
const hasWork = expectFor(...W).m.size;
if (hasWork < 100) { console.error('only ' + hasWork + ' rows to repair were drawn'); process.exit(2); }
// the rows the lookup has to get right: repairable, and not the newest current row of their customer
const trapsBack = rows.filter(r => r.type === 'current' && !isLastKnown(r) && modelNew(r) && r.day >= D(W[0]) && r.day <= D(W[1]) && r.cust.gap && r.day < r.cust.gap[0]).length;
const trapsTwice = rows.filter(r => r.type === 'current' && !isLastKnown(r) && modelNew(r) && r.day >= D(W[0]) && r.day <= D(W[1]) && rows.some(o => o !== r && o.type === 'current' && o.ref === r.ref && o.team === r.team && o.day === r.day && o.at > r.at)).length;
const twinRepairs = rows.filter(r => isLastKnown(r) && modelNew(r) && r.day >= D(W[0]) && r.day <= D(W[1]) && twins.some(t => t.ref === r.ref)).length;
const noTeamRepairs = rows.filter(r => r.team == null && isLastKnown(r) && modelNew(r) && r.day >= D(W[0]) && r.day <= D(W[1])).length;
const onlyInitialLast = rows.filter(r => r.type === 'current' && isLastKnown(r) && modelNew(r) && r.cust.lastOnlyInitial && r.day >= D(W[0]) && r.day <= D(W[1])).length;
for (const [k, v, min] of [['rows of customers who came back that are repairable and are not their newest', trapsBack, 8], ['older rows of a day uploaded twice', trapsTwice, 5], ['repairs of a loan number that is in two teams', twinRepairs, 3],
    ['repairs of rows that name no team', noTeamRepairs, 3], ['repairs of the day before a customer\'s INITIAL-only last day', onlyInitialLast, 3]])
  if (v < min) { console.error('the book holds only ' + v + ' of ' + k + ' (needs ' + min + '): the breaks of this check need them; raise CUSTOMERS'); process.exit(2); }

// ---- the database
const copy = `copy public.defaulter_snapshots (id, ref, team, snapshot_type, snapshot_date, weekday, disb_date, expire_date, chronic_date, days_elapsed, created_at) from stdin with (format csv, null '');\n`
  + rows.map(r => [r.id, r.ref, r.team, r.type, iso(r.day), '', iso(r.d), iso(r.e), iso(r.c), r.de == null ? '' : r.de, new Date(r.at).toISOString()].join(',')).join('\n') + '\n\\.\n';
const LIVE_INDEXES = `create index idx_def_snap_date on public.defaulter_snapshots(snapshot_date);\ncreate index idx_def_snap_date_type on public.defaulter_snapshots(snapshot_date, snapshot_type);\ncreate index idx_def_snap_team_ref on public.defaulter_snapshots(team, ref);\n`;
const fresh = () => {
  try { execFileSync('psql', ['-X', '-q', '-At', '-d', 'postgres', '-c', `drop database if exists ${DB}`], { stdio: 'pipe' }); } catch (e) { /* none yet */ }
  execFileSync('psql', ['-X', '-q', '-At', '-d', 'postgres', '-c', `create database ${DB}`], { stdio: 'pipe' });
  psql(SCHEMA);
  psql(`insert into public.teams (team) values ${TEAMS.map(t => `('${t}')`).join(', ')};\n` + copy + LIVE_INDEXES + `analyze public.defaulter_snapshots;`);
};
const drop = () => { try { execFileSync('psql', ['-X', '-q', '-At', '-d', 'postgres', '-c', `drop database if exists ${DB}`], { stdio: 'pipe' }); } catch (e) { /* ok */ } };
const ALL = `select id, to_char(disb_date, 'YYYY-MM-DD'), to_char(expire_date, 'YYYY-MM-DD'), to_char(chronic_date, 'YYYY-MM-DD') from public.defaulter_snapshots order by id`;
const MD5 = `select md5(string_agg(id::text || coalesce(disb_date::text, '') || coalesce(expire_date::text, '') || coalesce(chronic_date::text, '') || coalesce(days_elapsed::text, '') || ref || snapshot_type || snapshot_date::text, '|' order by id)) from public.defaulter_snapshots`;
const state = () => new Map(psql(ALL).trim().split('\n').map(l => { const p = l.split(SEP); return [p[0], { d: p[1], e: p[2], c: p[3] }]; }));
const script = (f, from, to, secs, apply) => f.replace("set local hope.lk_from_day = '2026-08-01'", `set local hope.lk_from_day = '${from}'`).replace("set local hope.lk_to_day = '2026-11-15'", `set local hope.lk_to_day = '${to}'`)
  .replace("set local hope.lk_seconds = '15'", `set local hope.lk_seconds = '${secs}'`).replace("set local hope.lk_apply = 'yes'", `set local hope.lk_apply = '${apply}'`)
  .split("date '2026-08-01'").join(`date '${from}'`).split("date '2026-11-15'").join(`date '${to}'`);
const parse = line => { const p = line.split(SEP); return { teams: Number(p[0]), last: p[1], loans: Number(p[2]), lk: Number(p[3]), cand: Number(p[4]), one: Number(p[5]), rep: Number(p[6]), left: Number(p[7]), still: Number(p[8]), secs: Number(p[9]), next: p[10] }; };
const run = (f, from, to, secs = 3600, apply = 'yes') => parse(psql('begin;\n' + script(f, from, to, secs, apply) + '\ncommit;').trim().split('\n').pop());     // one transaction, as the SQL editor sends it: `set local` works
const undoOf = (f, from, to) => { const t = script(f, from, to, 0, 'yes'); return t.slice(t.indexOf('-- UNDO:')).split('\n').filter(l => l.startsWith('-- ') && !l.startsWith('-- UNDO')).map(l => l.slice(3)).join('\n'); };
const slow = (f, s) => f.replace("    -- the team in hand is finished; start another only while the clock is inside the run's time", m => '    perform pg_sleep(' + s + ');\n' + m);       // a database made slow on purpose: s seconds a team
const LOG = `select count(*), coalesce(sum(extract(day from disb_new)), 0) from public.defaulter_last_known_repair_log`, TEAMSN = `select count(*), coalesce(sum(repaired), 0) from public.defaulter_last_known_repair_teams`;

const fails = [], need = (ok, what) => { if (!ok) fails.push(what); };
const compare = (label, from, to, got, ans) => {   // every row of the book against the model; the answer against the model's
  const e = expectFor(from, to); let bad = 0, firstBad = '';
  for (const r of rows) {
    const g = got.get(r.id), w = e.m.get(r.id), want = w ? { d: iso(w.d), e: iso(w.e), c: iso(w.c) } : { d: iso(r.d), e: iso(r.e), c: iso(r.c) };
    if (!g || g.d !== want.d || g.e !== want.e || g.c !== want.c) { bad++; if (!firstBad) firstBad = r.id + ' ' + r.ref + ' ' + r.type + ' ' + iso(r.day) + ' got ' + JSON.stringify(g) + ' want ' + JSON.stringify(want); }
  }
  need(bad === 0, label + ': ' + bad + ' rows do not equal the model (first: ' + firstBad + ')');
  if (ans) need(ans.lk === e.ans.lk && ans.cand === e.ans.cand && ans.one === e.ans.one && ans.left === e.ans.left && ans.loans === e.ans.loans, label + ': the answer ' + JSON.stringify(ans) + ' is not the model\'s ' + JSON.stringify(e.ans));
  return e;
};
const teamsTable = () => new Map(psql(`select team, loan_numbers, last_known, not_fitting, one_reading, repaired from public.defaulter_last_known_repair_teams order by team`).trim().split('\n').filter(Boolean).map(l => { const p = l.split(SEP); return [p[0], { loans: +p[1], lk: +p[2], cand: +p[3], one: +p[4], rep: +p[5] }]; }));

let exitCode = 1, timing = '';
try {
  // ---- 1. the file as it is: one big run over the whole window (a clock of an hour), every row against the model, and the numbers written down for each team
  fresh();
  const pristine = psql(MD5).trim();
  const a1 = run(FILE, ...W); const got1 = state();
  const E1 = compare('one run over the window', ...W, got1, a1);
  const after1 = psql(MD5).trim();
  need(E1.m.size >= 100 && E1.ans.lk > E1.m.size, 'the window held too little for the run to mean anything: ' + E1.m.size + ' repaired of ' + E1.ans.lk + ' last-known rows');
  need(a1.teams === UNITS.length && a1.rep === E1.m.size && a1.still === 0 && a1.next.startsWith('FINISHED') && a1.last === NOTEAM, 'the answer of the big run (' + JSON.stringify(a1) + ') does not say that every one of the ' + UNITS.length + ' teams was done, the last the rows with no team, and ' + E1.m.size + ' rows repaired');
  const tt = teamsTable();
  need(tt.size === UNITS.length && [...E1.byUnit].every(([k, v]) => { const g = tt.get(k); return g && g.loans === v.loans && g.lk === v.lk && g.cand === v.cand && g.one === v.one && g.rep === v.one; }), 'the numbers written down for each team are not the model\'s (' + tt.size + ' teams written, ' + UNITS.length + ' to do)');
  const a1b = run(FILE, ...W);
  need(a1b.teams === 0 && a1b.rep === 0 && a1b.still === 0 && a1b.next.startsWith('FINISHED') && psql(MD5).trim() === after1, 'a second run did something (' + JSON.stringify(a1b) + '): it must do no team, change nothing and say FINISHED');
  need(psql(LOG).trim().split(SEP)[0] === String(E1.m.size), 'the log holds ' + psql(LOG).trim().split(SEP)[0] + ' rows but the model repaired ' + E1.m.size);
  // a customer still on the latest deck is never touched, and no initial row, no row that is not its customer's newest
  const touchedIds = new Set(psql(`select id from public.defaulter_last_known_repair_log`).trim().split('\n').filter(Boolean));
  const byId = new Map(rows.map(r => [r.id, r]));
  need([...touchedIds].every(id => { const r = byId.get(id); return r.type === 'current' && isLastKnown(r) && !r.cust.stays; }), 'a row that is not a left customer\'s last-known current row was changed');
  need(rows.filter(r => r.cust.stays && touchedIds.has(r.id)).length === 0, 'a customer still on the latest deck was touched');
  // the undo at the foot, over the same window: every row back, byte for byte, the log stays, and the teams are looked at again
  psql('begin;\n' + undoOf(FILE, ...W) + '\ncommit;');
  need(psql(MD5).trim() === pristine, 'the undo did not put every row back exactly');
  need(psql(LOG).trim().split(SEP)[0] === String(E1.m.size), 'the log did not stay after the undo');
  need(psql(TEAMSN).trim().split(SEP)[0] === '0', 'the undo did not make the teams be looked at again');
  const a1c = run(FILE, ...W); compare('a run after the undo', ...W, state(), a1c);

  // ---- 2. a count changes nothing and writes nothing down, and says the model's numbers; runs of ONE team each (a clock of zero) end where one big run did; a narrower window does not skip a team done for a wider
  fresh();
  const cnt = run(FILE, ...W, 3600, 'no'); need(psql(MD5).trim() === pristine, 'a count changed the book');
  need(psql(LOG).trim().split(SEP)[0] === '0' && psql(TEAMSN).trim().split(SEP)[0] === '0', 'a count wrote something down');
  need(cnt.rep === 0 && cnt.lk === E1.ans.lk && cnt.cand === E1.ans.cand && cnt.one === E1.ans.one && cnt.loans === E1.ans.loans && cnt.teams === UNITS.length && cnt.next.startsWith('COUNT ONLY') && cnt.still === UNITS.length, 'the count says ' + JSON.stringify(cnt) + ', not the model\'s numbers');
  let lastRun = null, doneN = 0;
  for (let i = 0; i < UNITS.length + 2; i++) {
    lastRun = run(FILE, ...W, 0);
    if (lastRun.teams === 0) break;
    const u = UNITS[i], m = E1.byUnit.get(u);
    need(lastRun.teams === 1 && lastRun.last === u && lastRun.loans === m.loans && lastRun.lk === m.lk && lastRun.cand === m.cand && lastRun.one === m.one && lastRun.rep === m.one && lastRun.still === UNITS.length - 1 - i,
      'run ' + (i + 1) + ' of one team each says ' + JSON.stringify(lastRun) + ' where the model says team ' + u + ' ' + JSON.stringify(m) + ' and ' + (UNITS.length - 1 - i) + ' left');
    doneN++;
  }
  need(doneN === UNITS.length && lastRun.teams === 0 && lastRun.next.startsWith('FINISHED'), 'runs of one team each did ' + doneN + ' teams and ended with ' + JSON.stringify(lastRun) + ', not ' + UNITS.length + ' teams and FINISHED');
  compare('runs of one team each', ...W, state(), null);
  fresh();
  const aN = run(FILE, ...NW);
  compare('a narrow window', ...NW, state(), aN);
  need(teamsTable().size === UNITS.length, 'a narrow window wrote ' + teamsTable().size + ' teams down, not ' + UNITS.length);
  const aNW = run(FILE, ...W);
  need(aNW.teams === UNITS.length && aNW.still === 0, 'after a narrow window the wide one skipped teams: ' + JSON.stringify(aNW) + ' (a team done for seven days is not done for the whole window)');
  compare('the wide window after the narrow one', ...W, state(), null);
  need(aNW.rep === E1.m.size - expectFor(...NW).m.size, 'the wide window after the narrow one repaired ' + aNW.rep + ' rows, not the ' + (E1.m.size - expectFor(...NW).m.size) + ' that were left (the narrow one had repaired ' + expectFor(...NW).m.size + ')');
  const aNW2 = run(FILE, ...W); need(aNW2.teams === 0, 'a third run did ' + aNW2.teams + ' teams');

  // ---- 3. the clock: a database made slow on purpose (a third of a second a team) with a clock of one second does a few teams, finishes the team in hand, says to run again, and the next run carries on to the same end
  fresh();
  const slowRun = run(slow(FILE, 0.3), ...W, 1);
  need(slowRun.teams >= 2 && slowRun.teams <= UNITS.length - 1 && slowRun.last === UNITS[slowRun.teams - 1] && slowRun.next === 'RUN THE SAME TEXT AGAIN' && slowRun.still === UNITS.length - slowRun.teams,
    'a run with a clock of 1 s on a database that takes 0.3 s a team says ' + JSON.stringify(slowRun) + ': it must do 2 to ' + (UNITS.length - 1) + ' teams, in order, and say to run again');
  const restAfterSlow = run(FILE, ...W);
  need(restAfterSlow.teams === UNITS.length - slowRun.teams && restAfterSlow.next.startsWith('FINISHED'), 'the run after a run cut off by the clock did ' + restAfterSlow.teams + ' teams, not the ' + (UNITS.length - slowRun.teams) + ' that were left');
  compare('the end of a run cut off by the clock and the next one', ...W, state(), null);
  // a run cut off by the database's own limit changes NOTHING (the whole script is one transaction)
  fresh();
  psql('begin;\n' + script(FILE, ...W, 3600, 'yes') + '\ncommit;');       // everything done once, then undone, so that the teams are still to do and the log and the tables exist
  psql('begin;\n' + undoOf(FILE, ...W) + '\ncommit;');
  const before = psql(MD5).trim(), beforeLog = psql(LOG).trim();
  let cutOff = '';
  try { psql('begin;\n' + script(slow(FILE, 1), ...W, 3600, 'yes').replace("set local statement_timeout = '30s'", "set local statement_timeout = '2500ms'") + '\ncommit;'); } catch (err) { cutOff = err.message; }
  need(/statement timeout/.test(cutOff), 'the run made slow on purpose with a limit of 2.5 s was not cut off by the database: ' + cutOff.slice(0, 160));
  need(psql(MD5).trim() === before && psql(LOG).trim() === beforeLog && psql(TEAMSN).trim().split(SEP)[0] === '0', 'a run cut off by the database\'s own limit left something behind');
  // a book without the (team, loan number) index is refused, with a plain message, and nothing changes
  fresh(); psql('drop index public.idx_def_snap_team_ref;');
  const noIdxBefore = psql(MD5).trim(); let noIdx = '';
  try { run(FILE, ...W); } catch (err) { noIdx = err.message; }
  need(/idx_def_snap_team_ref is missing/.test(noIdx) && psql(MD5).trim() === noIdxBefore, 'a book without idx_def_snap_team_ref was not refused with a plain message and left as it was: ' + noIdx.slice(0, 160));

  // ---- 4. broken on purpose: each of these must change the outcome (a count, a run of one team, a narrow window and then the wide one, a second run; the book, the log and the teams written down after them)
  const sig = f => { fresh(); const tryRun = (...a) => { try { return JSON.stringify(run(f, ...a)); } catch (err) { return 'ERROR ' + err.message.slice(0, 100); } };
    const d = tryRun(...W, 3600, 'no'), mc = psql(MD5).trim();     // a count FIRST, on the book as it was uploaded: once the teams are done there is nothing left for a count to change
    if (d.startsWith('ERROR')) throw new Error('the broken file does not run: ' + d);
    const a = tryRun(...W, 0), b = tryRun(...NW, 3600), c = tryRun(...W, 3600), e = tryRun(...W, 3600);
    return JSON.stringify([d, mc, a, b, c, e, psql(MD5).trim(), psql(LOG).trim(), psql(TEAMSN).trim()]); };
  const base = sig(FILE);
  const sub = (re, to, what, times = 1) => src => { const m = src.match(new RegExp(re.source, 'g')) || []; if (m.length !== times) throw new Error('the file has ' + m.length + ' of "' + what + '", the check needs exactly ' + times); return src.replace(new RegExp(re.source, 'g'), () => to); };
  const breaks = [
    ['the oldest current row of a customer is taken, not the newest (the order reversed)',                  sub(/order by s\.snapshot_date desc, s\.created_at desc/, 'order by s.snapshot_date asc, s.created_at asc', 'the order of the lookup', 2)],
    ['of two rows of the newest day the OLDER is taken (the tie broken the other way)',                     sub(/order by s\.snapshot_date desc, s\.created_at desc/, 'order by s.snapshot_date desc, s.created_at asc', 'the tie of the lookup', 2)],
    ['the tie of a day uploaded twice is not broken (any row of the newest day)',                           sub(/order by s\.snapshot_date desc, s\.created_at desc/, 'order by s.snapshot_date desc', 'the tie of the lookup', 2)],
    ['an INITIAL row can be the newest row (the type of the lookup is not asked)',                          sub(/ and s\.snapshot_type = 'current'\n/, '\n', 'the type of the lookup', 2)],
    ['the team is not part of the customer in the lookup (the same loan number in two teams is one customer)', sub(/ and \(s\.team \|\| ''\) = v_team/, '', 'the team of the lookup')],
    ['the rows that name no team are never visited',                                                         sub(/ union all select null::text order by 1 loop/, ' order by 1 loop', 'the no-team unit')],
    ['the window is not asked at all',                                                                      sub(/\n  where r\.snapshot_date between v_from and v_to\n/, '\n', 'the window')],
    ['the window ends where it starts',                                                                     sub(/between v_from and v_to\n/, 'between v_from and v_from\n', 'the window')],
    ['a team done for a narrow window is taken as done for any (the window written down is not read)',      sub(/ and p\.from_day <= v_from and p\.to_day >= v_to\);\n/, ');\n', 'the window of the teams done')],
    ['a team that is done is looked at again (the teams written down are not read)',                        sub(/    continue when exists \(select 1 from public\.defaulter_last_known_repair_teams p\n[^\n]*\n/, '', 'the teams done')],
    ['the teams are not written down',                                                                      sub(/    if v_apply then\n/, '    if false then\n', 'the teams written down')],
    ['the loan numbers counted are the rows found (the walk is not counted)',                               sub(/\(select count\(\*\) from walk where ref is not null\), \(select count\(\*\) from ins\) into v_refs, v_lk;/, '(select count(*) from ins), (select count(*) from ins) into v_refs, v_lk;', 'the loan numbers', 2)],
    ['a count changes the book (the count is not kept from the write)',                                     sub(/\n  where v_apply\n/, '\n', 'the test of the count')],
    ['DAYS ELAPSED is not a witness of the reading (one date alone decides)',                                f => sub(/\n\s+and s\.snapshot_date - s\.disb_date - s\.days_elapsed between 0 and 3\)/, ')', 'the fit witness')(sub(/ and c\.snapshot_date - x\.d - c\.de between 0 and 3/, '', 'the reading witness')(f))],
    ['the twelfth of a month is not a day that can be swapped',                                             sub(/extract\(day from s\.disb_date\) <= 12 and/, 'extract(day from s.disb_date) <= 11 and', 'the twelve')],
    ['the log is not kept',                                                                                 sub(/from take t\n  on conflict \(id\) do nothing/, 'from take t where false\n  on conflict (id) do nothing', 'the log')],
    ['the chronic date is not exchanged with the others',                                                   sub(/set disb_date = t\.d2, expire_date = t\.e2, chronic_date = t\.c2/, 'set disb_date = t.d2, expire_date = t.e2', 'the three dates')],
    ['the no-team unit is written down as a team called NULL',                                              sub(/values \(coalesce\(v_team, '\(NO TEAM\)'\), v_from/, 'values (v_team, v_from', 'the name of the no-team unit')],
  ];
  /* NOT LISTED, and why: (1) `having count(*) = 1` -> `>= 1`. With DAYS ELAPSED as a witness two DIFFERENT readings cannot both fit (a swap moves a date by at least 27 days and the witness allows 3), so
     that mutation changes nothing a book can show: an equivalent mutant, and the one reading is guarded by the break of the witness above. (2) The two settings and the expression that keep the lookup to one
     or two rows (`enable_bitmapscan = off`, `(s.team || '')`) and the clock's `exit when`: they bound the WORK, not the rows. They are guarded below by the pages a run touches (timing section) and by the run
     made slow on purpose. */
  let uncaught = 0;
  for (const [name, fn] of breaks) {
    let broken, why = '', ok = false;
    try { broken = fn(FILE); } catch (err) { why = err.message; }
    if (broken) { try { ok = sig(broken) !== base; why = 'the outcome is the same as the file\'s'; } catch (err) { why = err.message.slice(0, 200); } }
    if (!ok) { uncaught++; need(false, 'BROKEN ON PURPOSE and not caught: ' + name + ' (' + why + ')'); }
  }
  // the clock: without the `exit when` a run made slow on purpose does every team
  const noClock = sub(/\n    exit when clock_timestamp\(\) - v_start > make_interval\(secs => v_secs\);/, '', 'the clock');
  fresh(); const rNoClock = run(slow(noClock(FILE), 0.05), ...W, 0.1);
  need(rNoClock.teams === UNITS.length, 'BROKEN ON PURPOSE and not caught: the clock removed: a run with a clock of 0.1 s did ' + rNoClock.teams + ' teams, not all ' + UNITS.length);
  fresh(); const rClock = run(slow(FILE, 0.05), ...W, 0.1);
  need(rClock.teams >= 1 && rClock.teams < UNITS.length, 'the clock of 0.1 s on a database that takes 0.05 s a team did ' + rClock.teams + ' teams of ' + UNITS.length);
  const nBreaks = breaks.length + 1;

  // ---- 5. the work of a run, in PAGES (a number that does not depend on what is cached), on a book laid out the WORST way: day after day with real churn, then every row moved to a place at random,
  //         so that a day's rows are NOT together (the second form of the file read a day: about 3 seconds a day live), with the real table's other indexes
  fresh();
  psql(`truncate public.defaulter_snapshots;
    drop table if exists public.defaulter_last_known_repair_log, public.defaulter_last_known_repair_teams;
    drop index if exists public.idx_def_snap_date, public.idx_def_snap_date_type, public.idx_def_snap_team_ref;       -- made again after the load, as the live table's were
    delete from public.teams;                                            -- the six of the small book go: the timing book has its own sixty
    insert into public.teams (team) select 't' || g from generate_series(1, 60) g;
    create or replace function pg_temp.sw(d date) returns date language sql immutable as $$ select case when extract(day from d) <= 12 and extract(day from d) <> extract(month from d) then make_date(extract(year from d)::int, extract(day from d)::int, extract(month from d)::int) else d end $$;
    -- 300 customers arrive on every day from ${TIMING_DAYS + 69} days before the end; each stays 1 to 70 days (mean 35): about 10,600 on a deck on any day
    create table cu as select c, 'R' || lpad(c::text, 7, '0') as ref, 't' || ((c % 60) + 1) as team, (date '2026-11-17' - ${TIMING_DAYS + 69} + ((c - 1) % ${TIMING_DAYS + 69}))::date as s,
           least((date '2026-11-17' - ${TIMING_DAYS + 69} + ((c - 1) % ${TIMING_DAYS + 69}) + (((hashint8(c)::bigint & 2147483647) % 70)::int))::date, date '2026-11-17') as e,
           ((date '2026-11-17' - ${TIMING_DAYS + 69} + ((c - 1) % ${TIMING_DAYS + 69})) - (1 + (c * 7 % 120)))::date as base
      from generate_series(1, ${(TIMING_DAYS + 69) * 300}) c;
    delete from cu where e < date '2026-11-17' - ${TIMING_DAYS - 1};
    do $$ declare d date; b uuid; begin
      for d in select g::date from generate_series(date '2026-11-17' - ${TIMING_DAYS - 1}, date '2026-11-17', interval '1 day') g loop
        b := gen_random_uuid();
        insert into public.defaulter_snapshots (ref, docket_no, full_name, contact, guarantor_name, guarantor_contact, disb_date, expire_date, chronic_date, due_date, last_trans_date, status, ds, dc, days_elapsed, initial_inst, other_inst, payment_exp, t_payment, arrears, balance, branch, team, zone, nearest_landmark, snapshot_type, weekday, snapshot_date, upload_batch, created_at)
        select cu.ref, 'D' || cu.c, 'CUSTOMER NUMBER ' || cu.c || ' OF TEAM', '0712' || lpad(cu.c::text, 6, '0'), 'GUARANTOR OF ' || cu.c, '0755' || lpad(cu.c::text, 6, '0'),
               case when d < date '2026-11-16' and (d - date '2026-08-03') % 5 <> 0 then pg_temp.sw(cu.base) else cu.base end, case when d < date '2026-11-16' and (d - date '2026-08-03') % 5 <> 0 then pg_temp.sw(cu.base + 91) else cu.base + 91 end,
               case when d < date '2026-11-16' and (d - date '2026-08-03') % 5 <> 0 then pg_temp.sw(cu.base + 105) else cu.base + 105 end, d + 3, d - 4, 'Defaulter', '3/6', 3, (d - cu.base) - 2, 50000, 0, 12000, 3000, 9000 + cu.c % 500, 120000,
               'BRANCH ' || (cu.c % 60), cu.team, 'ZONE ' || (cu.c % 8), 'NEAR THE MARKET OF WARD ' || (cu.c % 90), 'initial', upper(to_char(d, 'DY')), d, b, d + time '07:00' from cu where d between cu.s and cu.e order by cu.c;
        b := gen_random_uuid();
        insert into public.defaulter_snapshots (ref, docket_no, full_name, contact, guarantor_name, guarantor_contact, disb_date, expire_date, chronic_date, due_date, last_trans_date, status, ds, dc, days_elapsed, initial_inst, other_inst, payment_exp, t_payment, arrears, balance, branch, team, zone, nearest_landmark, snapshot_type, weekday, snapshot_date, upload_batch, created_at)
        select cu.ref, 'D' || cu.c, 'CUSTOMER NUMBER ' || cu.c || ' OF TEAM', '0712' || lpad(cu.c::text, 6, '0'), 'GUARANTOR OF ' || cu.c, '0755' || lpad(cu.c::text, 6, '0'),
               case when d < date '2026-11-16' and (d - date '2026-08-03') % 5 <> 0 then pg_temp.sw(cu.base) else cu.base end, case when d < date '2026-11-16' and (d - date '2026-08-03') % 5 <> 0 then pg_temp.sw(cu.base + 91) else cu.base + 91 end,
               case when d < date '2026-11-16' and (d - date '2026-08-03') % 5 <> 0 then pg_temp.sw(cu.base + 105) else cu.base + 105 end, d + 3, d - 4, 'Defaulter', '3/6', 3, (d - cu.base) - 1, 50000, 0, 12000, 3000, 9000 + cu.c % 500, 120000,
               'BRANCH ' || (cu.c % 60), cu.team, 'ZONE ' || (cu.c % 8), 'NEAR THE MARKET OF WARD ' || (cu.c % 90), 'current', upper(to_char(d, 'DY')), d, b, d + time '18:00'
          from cu where d between cu.s and cu.e and not (cu.e = d and cu.e < date '2026-11-17' and cu.c % 7 = 0) order by cu.c;
      end loop; end $$;
    drop table cu;
    -- the worst layout: every row in a random place
    create table public.ds2 as select * from public.defaulter_snapshots order by md5(id::text);
    drop table public.defaulter_snapshots;
    alter table public.ds2 rename to defaulter_snapshots;
    alter table public.defaulter_snapshots add primary key (id);
    alter table public.defaulter_snapshots add constraint defaulter_snapshots_team_fkey foreign key (team) references public.teams(team);
    alter table public.defaulter_snapshots alter column created_at set default now();
    alter table public.defaulter_snapshots alter column id set default gen_random_uuid();
    create index idx_def_snap_lookup on public.defaulter_snapshots(snapshot_type, weekday, snapshot_date, team);
    create index idx_def_snap_ref on public.defaulter_snapshots(ref, snapshot_date);
    create index idx_def_snap_batch on public.defaulter_snapshots(snapshot_type, weekday, snapshot_date, upload_batch);
    ${LIVE_INDEXES}
    vacuum analyze public.defaulter_snapshots;`);
  const total = Number(psql('select count(*) from public.defaulter_snapshots').trim());
  const pages = () => Number(psql(`select relpages from pg_class where oid = 'public.defaulter_snapshots'::regclass`).trim());
  const tablePages = pages(), onADay = psql(`select count(distinct (ctid::text::point)[0]::bigint) || ' pages for ' || count(*) || ' rows' from public.defaulter_snapshots where snapshot_type = 'current' and snapshot_date = date '2026-11-10'`).trim();
  const BLOCKS = `select pg_stat_get_xact_blocks_fetched('public.defaulter_snapshots'::regclass) || '${SEP}' || (select coalesce(sum(pg_stat_get_xact_blocks_fetched(i.indexrelid)), 0) from pg_index i where i.indrelid = 'public.defaulter_snapshots'::regclass)`;
  const runBlocks = (f, from, to, secs, apply) => { const out = psql('begin;\n' + script(f, from, to, secs, apply) + '\n' + BLOCKS + ';\nrollback;').trim().split('\n'); const b = out[out.length - 1].split(SEP).map(Number); return { ans: parse(out[out.length - 2]), table: b[0], index: b[1] }; };
  const ALLW = ['2026-08-01', '2026-11-15'];
  const whole = runBlocks(FILE, ...ALLW, 3600, 'no');
  const perLoan = whole.table / whole.ans.loans;
  need(whole.ans.teams === 61 && whole.ans.loans > 150 * TIMING_DAYS && whole.ans.lk > 100 * TIMING_DAYS, 'the whole window counted on the timing book says ' + JSON.stringify(whole.ans));
  need(perLoan <= 6 && whole.table < tablePages * 3, 'the whole window touched ' + whole.table + ' table pages for ' + whole.ans.loans + ' loan numbers (' + perLoan.toFixed(1) + ' each) on a table of ' + tablePages + ': a loan number must cost one or two rows, six pages at most');
  const noBitmap = runBlocks(sub(/set local enable_bitmapscan = off;[^\n]*\n/, '', 'the bitmap setting')(FILE), ...ALLW, 3600, 'no');
  need(noBitmap.table > whole.table * 4 && noBitmap.ans.lk === whole.ans.lk, 'BROKEN ON PURPOSE and not caught: with bitmap scans allowed the run touched ' + noBitmap.table + ' table pages against ' + whole.table + ' (it must be more than four times as many, for the same rows)');
  const noTrick = runBlocks(sub(/ and \(s\.team \|\| ''\) = v_team/, ' and s.team = v_team', 'the team expression')(FILE), ...ALLW, 3600, 'no');
  need(noTrick.table > whole.table * 4 && noTrick.ans.lk === whole.ans.lk, 'BROKEN ON PURPOSE and not caught: with the team compared plainly the run touched ' + noTrick.table + ' table pages against ' + whole.table + ' (it must be more than four times as many, for the same rows)');
  const oneTeam = runBlocks(FILE, ...ALLW, 0, 'no');
  need(oneTeam.ans.teams === 1 && oneTeam.table < 6 * oneTeam.ans.loans, 'one team touched ' + oneTeam.table + ' table pages for ' + oneTeam.ans.loans + ' loan numbers');
  const writes = runBlocks(FILE, ...ALLW, 0, 'yes');
  need(writes.ans.rep > 50 && writes.table < 12 * writes.ans.loans, 'a team that writes touched ' + writes.table + ' table pages for ' + writes.ans.loans + ' loan numbers and repaired ' + writes.ans.rep);
  const t0 = Date.now(); const bigApply = run(FILE, ...ALLW, 3600, 'yes'); const secApply = (Date.now() - t0) / 1000;
  need(bigApply.teams === 61 && bigApply.next.startsWith('FINISHED'), 'the whole window applied on the timing book says ' + JSON.stringify(bigApply));
  // the same on HALF the book: what a loan number costs does not depend on the size of the book
  psql(`delete from public.defaulter_snapshots where snapshot_date < date '2026-11-17' - ${Math.floor(TIMING_DAYS / 2)}; drop table if exists public.defaulter_last_known_repair_teams; vacuum full analyze public.defaulter_snapshots;`);
  const half = runBlocks(FILE, ...ALLW, 3600, 'no'), pagesHalf = pages(), perLoanHalf = half.table / half.ans.loans;
  need(pagesHalf < tablePages * 0.7 && perLoan < perLoanHalf * 1.35 && perLoanHalf <= 6, 'on half the book a loan number cost ' + perLoanHalf.toFixed(2) + ' table pages (' + pagesHalf + ' in the table) where it cost ' + perLoan.toFixed(2) + ' on the whole (' + tablePages + '): it must not grow with the size of the book');
  timing = `a book of ${total.toLocaleString('en')} rows with every row in a random place (${tablePages.toLocaleString('en')} table pages; one day's ${onADay}): the whole window touches ${whole.table.toLocaleString('en')} table pages and ${whole.index.toLocaleString('en')} index pages for `
    + `${whole.ans.loans.toLocaleString('en')} loan numbers (${perLoan.toFixed(1)} table pages each; ${perLoanHalf.toFixed(1)} on half the book); one team ${oneTeam.table.toLocaleString('en')} for ${oneTeam.ans.loans}; with bitmap scans allowed ${noBitmap.table.toLocaleString('en')}, with the team compared plainly ${noTrick.table.toLocaleString('en')}; `
    + `${whole.ans.lk.toLocaleString('en')} last-known rows counted, and all ${bigApply.rep.toLocaleString('en')} repairs written, in ${secApply.toFixed(1)} s on this machine (cached)`;

  console.log(`customers ${customers.length} (left ${kinds.left}, still there ${kinds.stays}, came back ${kinds.comeBack}, last day initial-only ${kinds.onlyInitial}, same loan in two teams ${kinds.twins}, no team ${kinds.noTeam}), deck rows ${rows.length}, ${UNITS.length} teams`);
  console.log(`one run over the window: ${E1.m.size} rows repaired of ${E1.ans.lk} last-known rows (${E1.ans.cand} not fitting, ${E1.ans.left} left alone: no single reading); traps drawn: ${trapsBack} rows left behind by customers who came back, ${trapsTwice} older rows of a day uploaded twice, ${twinRepairs} twin repairs, ${noTeamRepairs} no-team repairs`);
  console.log(`${nBreaks} deliberate breaks, ${nBreaks - uncaught} change the outcome (and two the pages of a run)`);
  console.log(timing);
  if (fails.length) { console.error('\nFAILED:\n - ' + fails.join('\n - ')); exitCode = 1; }
  else { console.log('\nOK: the repair puts right the last-known rows and nothing else, a run does its teams and no more, a loan number costs a row or two, it undoes exactly, and it fails when broken.'); exitCode = 0; }
} finally { drop(); }
process.exit(exitCode);
