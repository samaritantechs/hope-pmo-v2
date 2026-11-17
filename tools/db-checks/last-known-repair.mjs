/* THE SWAPPED DATES OF EACH CUSTOMER'S LAST-KNOWN DECK ROW, PUT RIGHT IN PLACE, ONE DAY AT A TIME -- db/RUN-ME-071, run for real on a PostgreSQL.

     "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026
     "071 / Error: SQL query ran into an upstream timeout" -- the owner, 17 Nov 2026, on the first form of the file (one statement over the whole range: docs/HANDOFF.md Part 106)

   db/RUN-ME-071-repair-swapped-last-known-deck-dates.sql changes dates in the hottest table of the book, on RUN-ME-060's rule, in a choice of rows that is new: a customer's LAST-KNOWN row, the
   newest CURRENT row of the same team and loan number. The rule was checked by tools/db-checks/deck-date-repair.mjs; what is checked here is WHICH rows, in what window, in what order, what is
   left alone, and -- since the first form of the file timed out on the live book -- THAT A RUN'S WORK IS BOUNDED: it does the days its clock allows and writes each finished day down, so the next run
   carries on, and a run's cost is the days it did, never the size of the book. A check that ran on a book held in memory and counted only the answer let the first form through; this one counts the
   PAGES a run touches (a number that does not depend on what is cached), on a book laid out the way uploads lay it out (day after day, not customer after customer).

   THE BOOK IS THE REAL ONE: the WHOLE of db/schema.sql in a scratch database, the teams the table's own foreign key asks for, and decks made the way the old importer left them: every loan has a
   real disbursement, expiry and chronic date, and a day's upload stores them swapped wherever the day and the month were both twelve or under, except the uploads that came right (a share of the
   days, and every upload from 16 Nov). It has customers who stayed to the last day, customers who left on every day of the window (their last day with a current row, or with only an INITIAL row:
   the current file dropped them that evening), customers who LEFT AND CAME BACK (a gap of one to three deck days: their row before the gap is not the last, and the next deck does not name them),
   a day on which a whole team is missing from the decks, Sundays with no deck at all, days uploaded twice (the later batch is the newest), the same loan number in two teams, moved loans (an expiry
   moved by the days a swap moves a disbursement, 17 or 45 days), loans whose DAYS ELAPSED says nothing true, no chronic date, no DAYS ELAPSED.

   It passes only when: every row of the table equals a MODEL of the rule written again in JavaScript after each scenario (the row, and not only the answer); every row that is not a last-known
   row in the window is byte-identical; the answer's numbers, and the numbers it writes down for each day, equal the model's; a second run does nothing and says FINISHED; runs of ONE day each
   (a clock of zero), newest day first, end where one big run ends; a run cut off by the clock, with a database made slow on purpose, finishes the day in hand and the next run carries on to the
   same end; a run cut off by the database's own limit changes NOTHING; a count changes nothing and writes nothing down; a narrow window changes only the days it names; the file's own undo puts every
   row back, byte for byte; a customer who is still on the latest deck is never touched; and EVERY ONE of a list of deliberate breaks of the file changes the outcome -- a check that cannot fail when
   the file is broken proves nothing, and says so. It then lays a book of two million rows the way uploads do and measures the pages of a one-day run (and the same run on half the book, and with
   the lookup that spares the others taken out).

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/last-known-repair.mjs

   TIMING_DAYS=40 makes the timing book smaller (about 100 seconds shorter). It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the file did what it says,
   and failed when broken. */
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
const FIRST = D('2026-09-01'), LAST = D('2026-11-16'), FIX = D('2026-11-16');       // the upload read right from 16 Nov
const T3GAP = D('2026-10-14');                                                       // team T3 is missing from the decks of this day, and back the next
const days = []; for (let t = FIRST; t <= LAST; t += DAY) if (new Date(t).getUTCDay() !== 0) days.push(t);   // no deck on a Sunday
const rightDay = new Map(days.map(t => [t, t >= FIX || rnd() < 0.2]));                // an upload that came right
const byShift = new Map();
for (let t = D('2024-01-01'); t <= D('2026-08-01'); t += DAY) { const sh = Math.round((swap(t) - t) / DAY); if (sh !== 0) { if (!byShift.has(sh)) byShift.set(sh, []); byShift.get(sh).push(t); } }
const SHIFTS = [29, 30, 31, 59, 60, 61].filter(sh => (byShift.get(sh) || []).length > 0);
const customers = [];
for (let i = 0; i < CUSTOMERS; i++) {
  const comesBack = i % 16 === 5;                                                     // left and came back
  let d = D('2024-01-01') + Math.floor(rnd() * ((D('2026-08-01') - D('2024-01-01')) / DAY)) * DAY;
  if (comesBack) while (swap(d) === d) d += DAY;                                      // a date that a swap can move
  let e = d + 91 * DAY, kind = 'normal'; const x = rnd();
  if (!comesBack) {
    if (x < 0.05) { kind = 'moved'; if (rnd() < 0.7) { const sh = pick(SHIFTS), pool = byShift.get(sh); d = pick(pool); e = d + (91 + sh) * DAY; } else e += pick([17, 45]) * DAY; }
    else if (x < 0.09) kind = 'baddays'; else if (x < 0.11) kind = 'nochronic'; else if (x < 0.13) kind = 'nodays';
  }
  const si = Math.floor(rnd() * 20), start = days[si];
  const stays = rnd() < 0.3, end = stays ? days[days.length - 1] : days[Math.floor(rnd() * (days.length - 1))];
  const c = { ref: 'R' + String(i).padStart(6, '0'), team: pick(['T1', 'T2', 'T3']), d, e, c: kind === 'nochronic' ? null : e + 14 * DAY, kind, i, start, end: Math.max(start, end), stays,
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
    if (c.team === 'T3' && day === T3GAP) continue;                                    // the team's decks are missing that day
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
  moved: customers.filter(c => c.kind === 'moved').length, baddays: customers.filter(c => c.kind === 'baddays').length, comeBack: customers.filter(c => c.gap).length };
for (const [k, min] of [['left', 200], ['stays', 100], ['onlyInitial', 10], ['twins', 10], ['moved', 15], ['baddays', 15], ['comeBack', 15]]) if (kinds[k] < min) { console.error('too few ' + k + ' drawn (' + kinds[k] + '): raise CUSTOMERS'); process.exit(2); }

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
const calDays = (from, to) => { const out = []; for (let t = D(from); t <= D(to); t += DAY) out.push(iso(t)); return out; };
const expectFor = (from, to) => {                                     // the book after the file ran over the whole window: Map id -> {d, e, c}; the answer; and the numbers of each day
  const inWin = rows.filter(r => isLastKnown(r) && r.day >= D(from) && r.day <= D(to));
  const cand = inWin.filter(r => r.d != null && r.e != null && r.c != null && r.de != null && !fits(r));
  const one = cand.map(r => ({ r, n: modelNew(r) })).filter(x => x.n);
  const byDay = new Map(calDays(from, to).map(k => [k, { lk: 0, cand: 0, one: 0 }]));
  inWin.forEach(r => byDay.get(iso(r.day)).lk++); cand.forEach(r => byDay.get(iso(r.day)).cand++); one.forEach(x => byDay.get(iso(x.r.day)).one++);
  return { m: new Map(one.map(x => [x.r.id, x.n])), ans: { lk: inWin.length, cand: cand.length, one: one.length, left: cand.length - one.length }, byDay };
};
const W = ['2026-09-01', '2026-11-15'], WDAYS = calDays(...W).length;
const hasWork = expectFor(...W).m.size;
if (hasWork < 100) { console.error('only ' + hasWork + ' rows to repair were drawn'); process.exit(2); }
// the rows the lookup has to turn away: repairable, not the last, and not named by the next deck either (the cheap test lets them through; only the exact lookup stops them)
const deckDays = [...new Set(rows.filter(r => r.type === 'current').map(r => r.day))].sort((a, b) => a - b);
const nextDeck = new Map(deckDays.map((t, i) => [t, deckDays[i + 1]]));
const onDeck = new Set(rows.filter(r => r.type === 'current').map(r => r.day + '|' + r.team + '|' + r.ref));
const lets = r => nextDeck.get(r.day) === undefined || !onDeck.has(nextDeck.get(r.day) + '|' + r.team + '|' + r.ref);
const trapsBack = rows.filter(r => r.type === 'current' && !isLastKnown(r) && lets(r) && modelNew(r) && r.day >= D(W[0]) && r.day <= D(W[1]) && r.cust.gap && iso(r.day) === iso(days[days.indexOf(r.cust.gap[0]) - 1])).length;
const trapsTwice = rows.filter(r => r.type === 'current' && !isLastKnown(r) && lets(r) && modelNew(r) && r.day >= D(W[0]) && r.day <= D(W[1]) && rows.some(o => o !== r && o.type === 'current' && o.ref === r.ref && o.team === r.team && o.day === r.day && o.at > r.at)).length;
const twinRepairs = rows.filter(r => isLastKnown(r) && modelNew(r) && r.day >= D(W[0]) && r.day <= D(W[1]) && twins.some(t => t.ref === r.ref)).length;
const teamGapEdge = rows.filter(r => r.type === 'current' && r.team === 'T3' && r.day === days[days.indexOf(T3GAP) - 1] && !isLastKnown(r) && lets(r) && modelNew(r)).length;
for (const [k, v, min] of [['returners\' rows the exact lookup must stop', trapsBack, 8], ['older rows of a day uploaded twice', trapsTwice, 5], ['repairs of a loan number that is in two teams', twinRepairs, 3], ['rows of the day before a team goes missing, to be turned away by the lookup', teamGapEdge, 5]])
  if (v < min) { console.error('the book holds only ' + v + ' of ' + k + ' (needs ' + min + '): the breaks of this check need them; raise CUSTOMERS'); process.exit(2); }

// ---- the database
const copy = `copy public.defaulter_snapshots (id, ref, team, snapshot_type, snapshot_date, weekday, disb_date, expire_date, chronic_date, days_elapsed, created_at) from stdin with (format csv, null '');\n`
  + rows.map(r => [r.id, r.ref, r.team, r.type, iso(r.day), '', iso(r.d), iso(r.e), iso(r.c), r.de == null ? '' : r.de, new Date(r.at).toISOString()].join(',')).join('\n') + '\n\\.\n';
const fresh = () => {
  try { execFileSync('psql', ['-X', '-q', '-At', '-d', 'postgres', '-c', `drop database if exists ${DB}`], { stdio: 'pipe' }); } catch (e) { /* none yet */ }
  execFileSync('psql', ['-X', '-q', '-At', '-d', 'postgres', '-c', `create database ${DB}`], { stdio: 'pipe' });
  psql(SCHEMA);
  psql(`insert into public.teams (team) values ('T1'), ('T2'), ('T3');\n` + copy + `create index idx_def_snap_date on public.defaulter_snapshots(snapshot_date);\ncreate index idx_def_snap_date_type on public.defaulter_snapshots(snapshot_date, snapshot_type);\nanalyze public.defaulter_snapshots;`);
};
const drop = () => { try { execFileSync('psql', ['-X', '-q', '-At', '-d', 'postgres', '-c', `drop database if exists ${DB}`], { stdio: 'pipe' }); } catch (e) { /* ok */ } };
const ALL = `select id, to_char(disb_date, 'YYYY-MM-DD'), to_char(expire_date, 'YYYY-MM-DD'), to_char(chronic_date, 'YYYY-MM-DD') from public.defaulter_snapshots order by id`;
const MD5 = `select md5(string_agg(id::text || coalesce(disb_date::text, '') || coalesce(expire_date::text, '') || coalesce(chronic_date::text, '') || coalesce(days_elapsed::text, '') || ref || snapshot_type || snapshot_date::text, '|' order by id)) from public.defaulter_snapshots`;
const state = () => new Map(psql(ALL).trim().split('\n').map(l => { const p = l.split(SEP); return [p[0], { d: p[1], e: p[2], c: p[3] }]; }));
const script = (f, from, to, secs, apply) => f.replace("set local hope.lk_from_day = '2026-08-01'", `set local hope.lk_from_day = '${from}'`).replace("set local hope.lk_to_day = '2026-11-15'", `set local hope.lk_to_day = '${to}'`)
  .replace("set local hope.lk_seconds = '10'", `set local hope.lk_seconds = '${secs}'`).replace("set local hope.lk_apply = 'yes'", `set local hope.lk_apply = '${apply}'`)
  .split("date '2026-08-01'").join(`date '${from}'`).split("date '2026-11-15'").join(`date '${to}'`);
const parse = line => { const p = line.split(SEP); return { days: Number(p[0]), oldest: p[1], lk: Number(p[2]), cand: Number(p[3]), one: Number(p[4]), rep: Number(p[5]), left: Number(p[6]), still: Number(p[7]), next: p[8] }; };
const run = (f, from, to, secs = 3600, apply = 'yes') => parse(psql('begin;\n' + script(f, from, to, secs, apply) + '\ncommit;').trim().split('\n').pop());     // one transaction, as the SQL editor sends it: `set local` works
const undoOf = (f, from, to) => { const t = script(f, from, to, 0, 'yes'); return t.slice(t.indexOf('-- UNDO:')).split('\n').filter(l => l.startsWith('-- ') && !l.startsWith('-- UNDO')).map(l => l.slice(3)).join('\n'); };
const slow = (f, s) => f.replace('insert into lk_run values (v_day, v_lk, v_cand, v_one, v_upd);', m => m + '\n    perform pg_sleep(' + s + ');');       // a database made slow on purpose: s seconds a day
const LOG = `select count(*), coalesce(sum(extract(day from disb_new)), 0) from public.defaulter_last_known_repair_log`, DAYSN = `select count(*), coalesce(sum(repaired), 0) from public.defaulter_last_known_repair_days`;

const fails = [], need = (ok, what) => { if (!ok) fails.push(what); };
const compare = (label, from, to, got, ans) => {   // every row of the book against the model; the answer against the model's
  const e = expectFor(from, to); let bad = 0, firstBad = '';
  for (const r of rows) {
    const g = got.get(r.id), w = e.m.get(r.id), want = w ? { d: iso(w.d), e: iso(w.e), c: iso(w.c) } : { d: iso(r.d), e: iso(r.e), c: iso(r.c) };
    if (!g || g.d !== want.d || g.e !== want.e || g.c !== want.c) { bad++; if (!firstBad) firstBad = r.id + ' ' + r.ref + ' ' + r.type + ' ' + iso(r.day) + ' got ' + JSON.stringify(g) + ' want ' + JSON.stringify(want); }
  }
  need(bad === 0, label + ': ' + bad + ' rows do not equal the model (first: ' + firstBad + ')');
  if (ans) need(ans.lk === e.ans.lk && ans.cand === e.ans.cand && ans.one === e.ans.one && ans.left === e.ans.left, label + ': the answer ' + JSON.stringify(ans) + ' is not the model\'s ' + JSON.stringify(e.ans));
  return e;
};
const daysTable = () => new Map(psql(`select day, last_known, not_fitting, one_reading, repaired from public.defaulter_last_known_repair_days order by day`).trim().split('\n').filter(Boolean).map(l => { const p = l.split(SEP); return [p[0], { lk: +p[1], cand: +p[2], one: +p[3], rep: +p[4] }]; }));

let exitCode = 1, timing = '';
try {
  // ---- 1. the file as it is: one big run over the whole window (a clock of an hour), every row against the model, and the numbers written down for each day
  fresh();
  const pristine = psql(MD5).trim();
  const a1 = run(FILE, ...W); const got1 = state();
  const E1 = compare('one run over the window', ...W, got1, a1);
  const after1 = psql(MD5).trim();
  need(E1.m.size >= 100 && E1.ans.lk > E1.m.size, 'the window held too little for the run to mean anything: ' + E1.m.size + ' repaired of ' + E1.ans.lk + ' last-known rows');
  need(a1.days === WDAYS && a1.rep === E1.m.size && a1.still === 0 && a1.next.startsWith('FINISHED') && a1.oldest === W[0], 'the answer of the big run (' + JSON.stringify(a1) + ') does not say that every one of the ' + WDAYS + ' days was done and ' + E1.m.size + ' rows repaired');
  const dt = daysTable();
  need(dt.size === WDAYS && [...E1.byDay].every(([k, v]) => { const g = dt.get(k); return g && g.lk === v.lk && g.cand === v.cand && g.one === v.one && g.rep === v.one; }), 'the numbers written down for each day are not the model\'s (' + dt.size + ' days written, ' + WDAYS + ' in the window)');
  const a1b = run(FILE, ...W);
  need(a1b.days === 0 && a1b.rep === 0 && a1b.still === 0 && a1b.next.startsWith('FINISHED') && psql(MD5).trim() === after1, 'a second run did something (' + JSON.stringify(a1b) + '): it must do no day, change nothing and say FINISHED');
  need(psql(LOG).trim().split(SEP)[0] === String(E1.m.size), 'the log holds ' + psql(LOG).trim().split(SEP)[0] + ' rows but the model repaired ' + E1.m.size);
  // a customer still on the latest deck is never touched, and no initial row, no row that is not its customer's newest
  const touchedIds = new Set(psql(`select id from public.defaulter_last_known_repair_log`).trim().split('\n').filter(Boolean));
  const byId = new Map(rows.map(r => [r.id, r]));
  need([...touchedIds].every(id => { const r = byId.get(id); return r.type === 'current' && isLastKnown(r) && !r.cust.stays; }), 'a row that is not a left customer\'s last-known current row was changed');
  need(rows.filter(r => r.cust.stays && touchedIds.has(r.id)).length === 0, 'a customer still on the latest deck was touched');
  // the undo at the foot, over the same window: every row back, byte for byte, the log stays, and the days are looked at again
  psql('begin;\n' + undoOf(FILE, ...W) + '\ncommit;');
  need(psql(MD5).trim() === pristine, 'the undo did not put every row back exactly');
  need(psql(LOG).trim().split(SEP)[0] === String(E1.m.size), 'the log did not stay after the undo');
  need(psql(DAYSN).trim().split(SEP)[0] === '0', 'the undo did not make the days be looked at again');
  const a1c = run(FILE, ...W); compare('a run after the undo', ...W, state(), a1c);

  // ---- 2. a count changes nothing and writes nothing down, and says the model's numbers; runs of ONE day each (a clock of zero), newest day first, end where one big run did; a narrow window changes only its days
  fresh();
  const cnt = run(FILE, ...W, 3600, 'no'); need(psql(MD5).trim() === pristine, 'a count changed the book');
  need(psql(LOG).trim().split(SEP)[0] === '0' && psql(DAYSN).trim().split(SEP)[0] === '0', 'a count wrote something down');
  need(cnt.rep === 0 && cnt.lk === E1.ans.lk && cnt.cand === E1.ans.cand && cnt.one === E1.ans.one && cnt.days === WDAYS && cnt.next.startsWith('COUNT ONLY') && cnt.still === WDAYS, 'the count says ' + JSON.stringify(cnt) + ', not the model\'s numbers');
  const seen = []; let lastRun = null;
  for (let i = 0; i < WDAYS + 2; i++) {
    lastRun = run(FILE, ...W, 0);
    if (lastRun.days === 0) break;
    const want = iso(D(W[1]) - i * DAY), m = E1.byDay.get(want);
    need(lastRun.days === 1 && lastRun.oldest === want && lastRun.lk === m.lk && lastRun.cand === m.cand && lastRun.one === m.one && lastRun.rep === m.one && lastRun.still === WDAYS - 1 - i,
      'run ' + (i + 1) + ' of one day each says ' + JSON.stringify(lastRun) + ' where the model says day ' + want + ' ' + JSON.stringify(m) + ' and ' + (WDAYS - 1 - i) + ' left');
    seen.push(lastRun.oldest);
  }
  need(seen.length === WDAYS && lastRun.days === 0 && lastRun.next.startsWith('FINISHED'), 'runs of one day each did ' + seen.length + ' days and ended with ' + JSON.stringify(lastRun) + ', not ' + WDAYS + ' days and FINISHED');
  compare('runs of one day each', ...W, state(), null);
  fresh();
  const NW = ['2026-10-05', '2026-10-11']; const aN = run(FILE, ...NW);
  compare('a narrow window', ...NW, state(), aN);
  need(daysTable().size === 7, 'a narrow window wrote ' + daysTable().size + ' days down, not 7');

  // ---- 3. the clock: a database made slow on purpose (a third of a second a day) with a clock of one second does a few days, finishes the day in hand, says to run again, and the next run carries on to the same end
  fresh();
  const slowRun = run(slow(FILE, 0.3), ...W, 1);
  need(slowRun.days >= 2 && slowRun.days <= 6 && slowRun.oldest === iso(D(W[1]) - (slowRun.days - 1) * DAY) && slowRun.next === 'RUN THE SAME TEXT AGAIN' && slowRun.still === WDAYS - slowRun.days,
    'a run with a clock of 1 s on a database that takes 0.3 s a day says ' + JSON.stringify(slowRun) + ': it must do 2 to 6 days, the newest first, and say to run again');
  const restAfterSlow = run(FILE, ...W);
  need(restAfterSlow.days === WDAYS - slowRun.days && restAfterSlow.next.startsWith('FINISHED'), 'the run after a run cut off by the clock did ' + restAfterSlow.days + ' days, not the ' + (WDAYS - slowRun.days) + ' that were left');
  compare('the end of a run cut off by the clock and the next one', ...W, state(), null);
  // a run cut off by the database's own limit changes NOTHING (the whole script is one transaction)
  fresh();
  psql('begin;\n' + script(FILE, ...W, 3600, 'yes') + '\ncommit;');       // everything done once, then the same days once more would do nothing: so cut off a run on a book where the days are still to do
  psql('begin;\n' + undoOf(FILE, ...W) + '\ncommit;');
  const before = psql(MD5).trim(), beforeLog = psql(LOG).trim();
  let cutOff = '';
  try { psql('begin;\n' + script(slow(FILE, 1), ...W, 3600, 'yes').replace("set local statement_timeout = '30s'", "set local statement_timeout = '2500ms'") + '\ncommit;'); } catch (err) { cutOff = err.message; }
  need(/statement timeout/.test(cutOff), 'the run made slow on purpose with a limit of 2.5 s was not cut off by the database: ' + cutOff.slice(0, 160));
  need(psql(MD5).trim() === before && psql(LOG).trim() === beforeLog && psql(DAYSN).trim().split(SEP)[0] === '0', 'a run cut off by the database\'s own limit left something behind');

  // ---- 4. broken on purpose: each of these must change the outcome (a one-day run, a big run, a second run, a count; the book, the log and the days written down after them)
  const sig = f => { fresh(); const tryRun = (...a) => { try { return JSON.stringify(run(f, ...a)); } catch (err) { return 'ERROR ' + err.message.slice(0, 100); } };
    const d = tryRun(...W, 3600, 'no'), mc = psql(MD5).trim();     // a count FIRST, on the book as it was uploaded: once the days are done there is nothing left for a count to change
    if (d.startsWith('ERROR')) throw new Error('the broken file does not run: ' + d);
    const a = tryRun(...W, 0);
    const b = tryRun(...W, 3600), c = tryRun(...W, 3600);
    return JSON.stringify([d, mc, a, b, c, psql(MD5).trim(), psql(LOG).trim(), psql(DAYSN).trim()]); };
  const base = sig(FILE);
  const sub = (re, to, what) => src => { const m = src.match(new RegExp(re.source, 'g')) || []; if (m.length !== 1) throw new Error('the file has ' + m.length + ' of "' + what + '", the check needs exactly one'); return src.replace(re, () => to); };
  const breaks = [
    ['no test that a newer row exists: every row of a customer who is not on the next deck is a candidate',  sub(/\n  where h\.newer is null\n/, '\n', 'the test of the newer row')],
    ['the newer row must NOT exist is turned round: the rows that have a newer row are the candidates',      sub(/where h\.newer is null/, 'where h.newer is not null', 'the test of the newer row')],
    ['an INITIAL row counts as a newer row (the type of the newer row is not asked)',                        sub(/ and n\.snapshot_type = 'current' and n\.team is not distinct from g\.team/, ' and n.team is not distinct from g.team', 'the type of the newer row')],
    ['the type of the candidate is not asked: an initial row is a candidate',                                 sub(/where s\.snapshot_type = 'current' and s\.snapshot_date = v_day/, 'where s.snapshot_date = v_day', 'the type of the candidate')],
    ['the team is not part of the customer in the lookup (the same loan number in two teams is one customer)', sub(/ and n\.team is not distinct from g\.team/, '', 'the team of the lookup')],
    ['the team is not part of the customer in the test of the next deck',                                      sub(/nx\.ref = s\.ref and nx\.team is not distinct from s\.team/, 'nx.ref = s.ref', 'the team of the next deck')],
    ['a row of the same day is never newer (a day uploaded twice: both are last-known)',                      sub(/\(n\.snapshot_date > g\.snapshot_date or n\.created_at > g\.created_at\)/, '(n.snapshot_date > g.snapshot_date)', 'the tie')],
    ['a row of the same day is always newer (a row is newer than itself: nobody is last-known)',              sub(/\(n\.snapshot_date > g\.snapshot_date or n\.created_at > g\.created_at\)/, '(n.snapshot_date >= g.snapshot_date)', 'the order')],
    ['the older row of the same day is the newer one (the order reversed)',                                   sub(/n\.created_at > g\.created_at/, 'n.created_at < g.created_at', 'the order')],
    ['the next deck is the day itself: everybody is "still on it" and nobody is last-known',                  sub(/x\.snapshot_date = v_next/, 'x.snapshot_date = v_day', 'the next deck')],
    ['the customers who are on the next deck are the candidates (the test of the next deck turned round)',    sub(/and not exists \(select 1 from nx where/, 'and exists (select 1 from nx where', 'the test of the next deck')],
    ['the window ends where it starts',                                                                       sub(/generate_series\(v_from::timestamp, v_to::timestamp,/, 'generate_series(v_from::timestamp, v_from::timestamp,', 'the window')],
    ['the window is not asked at all (every day of the year)',                                                sub(/generate_series\(v_from::timestamp, v_to::timestamp,/, "generate_series(date '2026-01-01'::timestamp, date '2026-12-31'::timestamp,", 'the window')],
    ['the oldest day first (the clock stops the run before the customers cleared lately)',                    sub(/ order by 1 desc loop/, ' order by 1 loop', 'the order of the days')],
    ['a day that is done is looked at again (the days written down are not read)',                            sub(/    continue when exists \(select 1 from public\.defaulter_last_known_repair_days p where p\.day = v_day\);\n/, '', 'the days done')],
    ['the days are not written down',                                                                         sub(/    if v_apply then\n/, '    if false then\n', 'the days written down')],
    ['a count changes the book (the count is not kept from the write)',                                       sub(/\n  where v_apply\n/, '\n', 'the test of the count')],
    ['DAYS ELAPSED is not a witness of the reading (one date alone decides)',                                  f => sub(/\n\s+and s\.snapshot_date - s\.disb_date - s\.days_elapsed between 0 and 3\)/, ')', 'the fit witness')(sub(/ and c\.snapshot_date - x\.d - c\.de between 0 and 3/, '', 'the reading witness')(f))],
    ['the twelfth of a month is not a day that can be swapped',                                               sub(/extract\(day from s\.disb_date\) <= 12 and/, 'extract(day from s.disb_date) <= 11 and', 'the twelve')],
    ['the log is not kept',                                                                                   sub(/from take t\n  on conflict \(id\) do nothing/, 'from take t where false\n  on conflict (id) do nothing', 'the log')],
    ['the chronic date is not exchanged with the others',                                                     sub(/set disb_date = t\.d2, expire_date = t\.e2, chronic_date = t\.c2/, 'set disb_date = t.d2, expire_date = t.e2', 'the three dates')],
  ];
  /* NOT LISTED, and why: (1) `having count(*) = 1` -> `>= 1`. With DAYS ELAPSED as a witness two DIFFERENT readings cannot both fit (a swap moves a date by at least 27 days and the witness allows 3), so
     that mutation changes nothing a book can show: an equivalent mutant, and the one reading is guarded by the break of the witness above. (2) The lookup's `limit 1` and the test of the next deck are
     there to bound the WORK, not to choose the rows: a lookup that reads every later row of the loan number, or a next deck that is not read, give the same rows. They are guarded below by the pages a
     one-day run touches, which the timing section breaks the same way. (3) The clock's `exit when`: guarded by the run made slow on purpose above (a clock that does not stop the run does all the days). */
  let uncaught = 0;
  for (const [name, fn] of breaks) {
    let broken, why = '', ok = false;
    try { broken = fn(FILE); } catch (err) { why = err.message; }
    if (broken) { try { ok = sig(broken) !== base; why = 'the outcome is the same as the file\'s'; } catch (err) { why = err.message.slice(0, 200); } }
    if (!ok) { uncaught++; need(false, 'BROKEN ON PURPOSE and not caught: ' + name + ' (' + why + ')'); }
  }
  // the clock: without the `exit when` a run made slow on purpose does every day
  const noClock = sub(/\n    exit when clock_timestamp\(\) - v_start > make_interval\(secs => v_secs\);/, '', 'the clock');
  fresh(); const rNoClock = run(slow(noClock(FILE), 0.05), ...W, 0.2);
  need(rNoClock.days === WDAYS, 'BROKEN ON PURPOSE and not caught: the clock removed: a run with a clock of 0.2 s did ' + rNoClock.days + ' days, not all ' + WDAYS);
  fresh(); const rClock = run(slow(FILE, 0.05), ...W, 0.2);
  need(rClock.days >= 1 && rClock.days < WDAYS, 'the clock of 0.2 s on a database that takes 0.05 s a day did ' + rClock.days + ' days of ' + WDAYS);
  const nBreaks = breaks.length + 1;

  // ---- 5. the work of a run, in PAGES (a number that does not depend on what is cached), on a book laid out the way uploads lay it out: day after day, with the real table's other indexes
  fresh();
  psql(`truncate public.defaulter_snapshots;
    drop table if exists public.defaulter_last_known_repair_log, public.defaulter_last_known_repair_days;
    drop index if exists public.idx_def_snap_date, public.idx_def_snap_date_type;       -- made again after the load, as the live table's were
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
    create index idx_def_snap_date on public.defaulter_snapshots(snapshot_date);
    create index idx_def_snap_date_type on public.defaulter_snapshots(snapshot_date, snapshot_type);
    create index idx_def_snap_team_ref on public.defaulter_snapshots(team, ref);
    vacuum analyze public.defaulter_snapshots;`);
  const total = Number(psql('select count(*) from public.defaulter_snapshots').trim());
  const pages = () => Number(psql(`select relpages from pg_class where oid = 'public.defaulter_snapshots'::regclass`).trim());
  const BLOCKS = `select pg_stat_get_xact_blocks_fetched('public.defaulter_snapshots'::regclass) + (select coalesce(sum(pg_stat_get_xact_blocks_fetched(i.indexrelid)), 0) from pg_index i where i.indrelid = 'public.defaulter_snapshots'::regclass)`;
  const runBlocks = (f, from, to, secs, apply) => { const out = psql('begin;\n' + script(f, from, to, secs, apply) + '\n' + BLOCKS + ';\nrollback;').trim().split('\n'); return { ans: parse(out[out.length - 2]), blocks: Number(out[out.length - 1]) }; };
  const ALLD = ['2026-08-01', '2026-11-15'];
  const TD = psql(`select d.snapshot_date from public.defaulter_snapshots d where d.snapshot_type = 'current' and d.snapshot_date between date '2026-11-17' - ${Math.floor(TIMING_DAYS * 0.45)} and date '2026-11-17' - ${Math.floor(TIMING_DAYS * 0.15)}
      and not exists (select 1 from public.defaulter_snapshots n where n.snapshot_type = 'current' and n.snapshot_date = d.snapshot_date + 1 and n.ref = d.ref) group by 1 order by count(*) desc, 1 limit 1`).trim();
  const tablePages = pages();
  const oneDay = runBlocks(FILE, TD, TD, 0, 'no');
  need(oneDay.ans.days === 1 && oneDay.ans.lk > 100, 'the timing book has no last-known rows on ' + TD);
  need(oneDay.blocks < 10000 && oneDay.blocks < tablePages * 0.1, 'a one-day run touched ' + oneDay.blocks + ' pages of a table of ' + tablePages + ': a run\'s work must be a few thousand pages, a tenth of the table at most');
  const oneDayApply = runBlocks(FILE, TD, TD, 0, 'yes');
  need(oneDayApply.ans.rep > 100 && oneDayApply.blocks < 40000, 'a one-day run that writes touched ' + oneDayApply.blocks + ' pages and repaired ' + oneDayApply.ans.rep);
  const noPre = runBlocks(sub(/x\.snapshot_date = v_next/, 'false', 'the next deck')(FILE), TD, TD, 0, 'no');
  need(noPre.blocks > oneDay.blocks * 3 && noPre.ans.lk === oneDay.ans.lk, 'BROKEN ON PURPOSE and not caught: without the test of the next deck a one-day run touched ' + noPre.blocks + ' pages against ' + oneDay.blocks + ' (it must be more than three times as many, for the same rows)');
  const noLimit = runBlocks(sub(/\n    limit 1\n/, '\n', 'the limit of the lookup')(FILE), TD, TD, 0, 'no');
  need(noLimit.ans.lk === oneDay.ans.lk, 'a lookup without its limit finds other rows (' + noLimit.ans.lk + ' against ' + oneDay.ans.lk + ')');
  const t0 = Date.now(); const bigCount = run(FILE, ...ALLD, 3600, 'no'); const secCount = (Date.now() - t0) / 1000;
  need(bigCount.days === 107 && bigCount.lk > 150 * TIMING_DAYS, 'the whole range counted on the timing book says ' + JSON.stringify(bigCount));
  // the same one-day run on HALF the table: the work does not depend on the size of the book
  psql(`delete from public.defaulter_snapshots where snapshot_date < date '2026-11-17' - ${Math.floor(TIMING_DAYS / 2)}; vacuum full analyze public.defaulter_snapshots;`);
  const half = runBlocks(FILE, TD, TD, 0, 'no'), pagesHalf = pages();
  need(pagesHalf < tablePages * 0.7 && half.ans.lk === oneDay.ans.lk && half.blocks > oneDay.blocks * 0.75 && half.blocks < oneDay.blocks * 1.25, 'a one-day run on half the book touched ' + half.blocks + ' pages (' + pagesHalf + ' in the table) where it touched ' + oneDay.blocks + ' on the whole (' + tablePages + '): the work must not depend on the size of the book');
  timing = `a book of ${total.toLocaleString('en')} rows laid out day after day (${tablePages.toLocaleString('en')} table pages, 60 teams, 10,600 customers a day): a one-day run touches ${oneDay.blocks.toLocaleString('en')} pages (${oneDayApply.blocks.toLocaleString('en')} when it writes ${oneDayApply.ans.rep}), `
    + `${(oneDay.blocks / tablePages * 100).toFixed(1)}% of the table, and ${half.blocks.toLocaleString('en')} on half the book; with the test of the next deck taken out ${noPre.blocks.toLocaleString('en')}; the whole range counted day by day in ${secCount.toFixed(1)} s on this machine (cached)`;

  console.log(`customers ${customers.length} (left ${kinds.left}, still there ${kinds.stays}, came back ${kinds.comeBack}, last day initial-only ${kinds.onlyInitial}, same loan in two teams ${kinds.twins}), deck rows ${rows.length}, ${days.length} deck days, ${WDAYS} days in the window`);
  console.log(`one run over the window: ${E1.m.size} rows repaired of ${E1.ans.lk} last-known rows (${E1.ans.cand} not fitting, ${E1.ans.left} left alone: no single reading); traps drawn: ${trapsBack} returners' rows, ${trapsTwice} older rows of a day uploaded twice, ${twinRepairs} twin repairs`);
  console.log(`${nBreaks} deliberate breaks, ${nBreaks - uncaught} change the outcome (and one the pages of a run)`);
  console.log(timing);
  if (fails.length) { console.error('\nFAILED:\n - ' + fails.join('\n - ')); exitCode = 1; }
  else { console.log('\nOK: the repair puts right the last-known rows and nothing else, a run does its days and no more, it undoes exactly, and it fails when broken.'); exitCode = 0; }
} finally { drop(); }
process.exit(exitCode);
