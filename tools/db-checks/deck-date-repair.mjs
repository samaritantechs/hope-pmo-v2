/* THE SWAPPED DATES ON THE DEFAULTER DECKS, PUT RIGHT IN PLACE -- db/RUN-ME-060, run for real on a PostgreSQL.

     "we cant re-upload now - i hope the system autoupdates whats right brother" -- the owner, 16 Nov 2026

   db/RUN-ME-060-repair-swapped-deck-dates.sql changes dates in the hottest table of the book. A
   script like that is not believed on a reading: this check builds a book the way the old importer
   left it (every date whose two numbers were twelve or under stored with day and month swapped; a
   few whole uploads that came right), with the loans that are meant to fool it, runs THE FILE ITSELF
   (read from db/, with its window and its limit set), and compares every row with the truth.

   What it draws: loans disbursed from 2024 to November 2026 (a loan expires 91 days after it is
   disbursed and turns chronic 14 days after; DAYS ELAPSED is the days from disbursement to the
   deck's day, less 1 or 2); and, to fool the repair, loans whose expiry was moved by the very number of
   days a day-and-month swap moves their disbursement date (about 30 or 60: the swapped date then lands
   exactly on the pattern, and did, in the first form of the repair), and by 17 or 45, loans whose DAYS ELAPSED says nothing true, a loan with no chronic date, a loan with no
   DAYS ELAPSED.

   It passes only when: every ordinary loan ends equal to the truth; no row was changed to anything
   but the truth; no right date was made wrong; the log holds exactly the rows changed; a run after
   the last one changes nothing (and a run with a SMALL limit, again and again, ends where one big
   run did); and the undo in the file's own last lines puts back every row exactly. It also refuses to
   pass when too few of the hard cases were drawn.

   IT IS THEN BROKEN ON PURPOSE, which is the only reason to believe it: the same file with the
   DAYS ELAPSED witness taken out must come back with rows changed to something that is not the truth
   (it did: 150 of them in the first form of this check). If it does not, this check proves nothing
   and says so.

   It needs a PostgreSQL it can reach with psql and NO public.defaulter_snapshots in it: the tables
   are created inside one transaction and the whole case is rolled back. psql's own variables say which:

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/deck-date-repair.mjs
       (LOANS=3000 by default)

   NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-060-repair-swapped-deck-dates.sql'), 'utf8');
const LOANS = Number(process.env.LOANS || 3000);
const SEP = '\x1f', DAY = 86400000;
const psql = sql => execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', SEP, '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28 });

// mulberry32: every draw uses all 32 bits
let seed = 20261116;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const iso = t => new Date(t).toISOString().slice(0, 10);
const swap = t => { const d = new Date(t), m = d.getUTCMonth() + 1, dd = d.getUTCDate(); return (dd <= 12 && m !== dd) ? Date.UTC(d.getUTCFullYear(), dd - 1, m) : t; };   // what the old importer stored for an ambiguous date

// ---- the book
// the dates a swap moves by exactly 29 to 31 or 59 to 61 days: a loan whose expiry was moved by that many days fits the
// 91-and-14 pattern under a SWAPPED disbursement date. Without DAYS ELAPSED the repair cannot tell it from a swapped loan.
const byShift = new Map();
for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2026, 10, 10); t += DAY) { const sh = Math.round((swap(t) - t) / DAY); if (sh !== 0) { if (!byShift.has(sh)) byShift.set(sh, []); byShift.get(sh).push(t); } }
const SHIFTS = [29, 30, 31, 59, 60, 61].filter(sh => (byShift.get(sh) || []).length > 0);
const loans = [];
for (let i = 0; i < LOANS; i++) {
  let d = Date.UTC(2024, 0, 1) + Math.floor(rnd() * (Date.UTC(2026, 10, 10) - Date.UTC(2024, 0, 1)));
  let e = d + 91 * DAY, kind = 'normal'; const x = rnd();
  if (x < 0.04) {
    kind = 'moved';
    if (rnd() < 0.7) { const sh = SHIFTS[Math.floor(rnd() * SHIFTS.length)], pool = byShift.get(sh); d = pool[Math.floor(rnd() * pool.length)]; e = d + (91 + sh) * DAY; }   // the coincidence, on purpose
    else e += [17, 45][Math.floor(rnd() * 2)] * DAY;
  }
  else if (x < 0.07) kind = 'baddays';
  else if (x < 0.08) kind = 'nochronic';
  else if (x < 0.09) kind = 'nodays';
  loans.push({ ref: 'L' + String(i).padStart(6, '0'), d, e, c: kind === 'nochronic' ? null : e + 14 * DAY, kind, k: i });
}
const days = []; for (let k = 2; k <= 16; k++) days.push('2026-11-' + String(k).padStart(2, '0'));
const rows = []; let uploads = 0;
for (const day of days) for (const type of ['initial', 'current']) {
  const right = rnd() < 0.3, snap = Date.parse(day + 'T00:00:00Z'), off = type === 'initial' ? 2 : 1; uploads++;
  for (const l of loans) {
    if (type === 'current' && l.k % 11 === 0) continue;
    const s = right ? { d: l.d, e: l.e, c: l.c } : { d: swap(l.d), e: swap(l.e), c: l.c == null ? null : swap(l.c) };
    let de = Math.round((snap - l.d) / DAY) - off;
    if (l.kind === 'baddays') de += 5 + (l.k % 55);
    rows.push([l.ref, type, day, iso(s.d), iso(s.e), s.c == null ? '' : iso(s.c), l.kind === 'nodays' ? '' : de].join(','));
  }
}
const hard = loans.filter(l => l.kind !== 'normal').length;
if (hard < 60) { console.error('too few hard cases drawn (' + hard + '): raise LOANS'); process.exit(2); }

const SETUP = `begin;
create table public.defaulter_snapshots (id uuid primary key default gen_random_uuid(), ref text not null, snapshot_type text not null,
  snapshot_date date not null, disb_date date, expire_date date, chronic_date date, days_elapsed integer);
create index on public.defaulter_snapshots (snapshot_date);
create temp table truth (ref text primary key, d date, e date, c date, kind text) on commit drop;
copy truth from stdin with (format csv, null '');
${loans.map(l => [l.ref, iso(l.d), iso(l.e), l.c == null ? '' : iso(l.c), l.kind].join(',')).join('\n')}
\\.
copy public.defaulter_snapshots (ref, snapshot_type, snapshot_date, disb_date, expire_date, chronic_date, days_elapsed) from stdin with (format csv, null '');
${rows.join('\n')}
\\.
analyze public.defaulter_snapshots;
`;
const SUM = `select md5(string_agg(id::text || coalesce(disb_date::text, '') || coalesce(expire_date::text, '') || coalesce(chronic_date::text, ''), '|' order by id)) from public.defaulter_snapshots;`;
const VERIFY = `
select 'ordinary_loans_not_equal_to_truth' || chr(31) || count(*) from public.defaulter_snapshots s join truth t using (ref) where t.kind = 'normal' and (s.disb_date, s.expire_date, s.chronic_date) is distinct from (t.d, t.e, t.c);
select 'changed_to_something_that_is_not_the_truth' || chr(31) || count(*) from public.defaulter_snapshots s join truth t using (ref) join public.defaulter_date_repair_log l on l.id = s.id where (s.disb_date, s.expire_date, s.chronic_date) is distinct from (t.d, t.e, t.c);
select 'a_right_date_made_wrong' || chr(31) || count(*) from public.defaulter_snapshots s join truth t using (ref) join public.defaulter_date_repair_log l on l.id = s.id
  where (l.disb_old = t.d and s.disb_date <> t.d) or (l.expire_old = t.e and s.expire_date <> t.e) or (l.chronic_old = t.c and s.chronic_date <> t.c);
select 'log_rows' || chr(31) || count(*) from public.defaulter_date_repair_log;
select 'hard_rows_still_wrong' || chr(31) || count(*) from public.defaulter_snapshots s join truth t using (ref) where t.kind <> 'normal' and (s.disb_date, s.expire_date, s.chronic_date) is distinct from (t.d, t.e, t.c);
`;
const script = (max, from = '2026-11-02', to = '2026-11-16', f = FILE) => f
  .replace("date '2026-11-16' as from_day", `date '${from}' as from_day`).replace("date '2026-11-16' as to_day", `date '${to}' as to_day`).replace('20000 as max_rows', `${max} as max_rows`);
const runs = (n, max, f) => Array.from({ length: n }, () => script(max, undefined, undefined, f)).join('\n');
const parse = out => { const m = {}; const runsOut = []; for (const l of out.trim().split('\n').filter(Boolean)) { const p = l.split(SEP); if (p.length === 5) runsOut.push(p.map(Number)); else if (p.length === 2 && /^[a-z_]+$/.test(p[0])) m[p[0]] = Number(p[1]); else if (p.length === 1 && /^[0-9a-f]{32}$/.test(p[0])) (m.md5s = m.md5s || []).push(p[0]); } return { m, runsOut }; };

function whole(f, label) {
  // one big run over the whole window, then the file again (must change nothing), verification, the file's own undo, the book as it was
  const undo = f.slice(f.indexOf('-- UNDO:')).split('\n').filter(l => l.startsWith('-- ') && !l.startsWith('-- UNDO')).map(l => l.slice(3)).join('\n')
    .replace(/date '2026-11-16' and date '2026-11-16'/, `date '2026-11-02' and date '2026-11-16'`);
  const out = psql(SETUP + SUM + '\n' + runs(2, 1000000, f) + VERIFY + undo + ';\n' + SUM + '\nrollback;\n');
  return parse(out);
}

// ---- 1. the file as it is
const A = whole(FILE);
const [first, again] = A.runsOut;
const fails = [];
const need = (ok, what) => { if (!ok) fails.push(what); };
need(first && first[2] > 0 && first[3] === 0, 'the first run repaired nothing, or left work undone');
need(again && again[2] === 0, 'the file run AGAIN changed ' + (again && again[2]) + ' rows: it must change nothing');
need(A.m.ordinary_loans_not_equal_to_truth === 0, A.m.ordinary_loans_not_equal_to_truth + ' ordinary loans do not equal the truth after the repair');
need(A.m.changed_to_something_that_is_not_the_truth === 0, A.m.changed_to_something_that_is_not_the_truth + ' rows were changed to something that is not the truth');
need(A.m.a_right_date_made_wrong === 0, A.m.a_right_date_made_wrong + ' right dates were made wrong');
need(first && A.m.log_rows === first[2], 'the log holds ' + A.m.log_rows + ' rows but ' + (first && first[2]) + ' were changed');
need(A.m.md5s && A.m.md5s[0] === A.m.md5s[1], 'the undo did not put back every row exactly');
need(A.m.hard_rows_still_wrong > 0, 'no hard row was left wrong: the hard cases were not drawn');

// ---- 2. a small limit, again and again, ends where one big run did
const smallOut = psql(SETUP + runs(40, 3000, FILE) + VERIFY + 'rollback;\n');
const S = parse(smallOut), last = S.runsOut[S.runsOut.length - 1];
need(last[3] === 0 && last[2] === 0, 'forty runs of 3,000 rows did not finish the work');
need(S.m.log_rows === A.m.log_rows, 'small runs changed ' + S.m.log_rows + ' rows, one big run ' + A.m.log_rows);
need(S.m.changed_to_something_that_is_not_the_truth === 0 && S.m.ordinary_loans_not_equal_to_truth === 0, 'small runs ended in a wrong state');

// ---- 3. broken on purpose: without the DAYS ELAPSED witness, rows ARE changed to something that is not the truth
const broken = FILE.replace(/\n\s+and s\.snapshot_date - s\.disb_date - s\.days_elapsed between 0 and 3\)/, ')').replace(/ and c\.snapshot_date - x\.d - c\.de between 0 and 3/, '');
need(broken !== FILE, 'the check could not find the DAYS ELAPSED lines of the file to break');
const B = whole(broken);
need(B.m.changed_to_something_that_is_not_the_truth > 0, 'WITH THE DAYS ELAPSED WITNESS TAKEN OUT NOTHING WAS CHANGED WRONGLY: this check does not prove the witness is needed');

console.log(`loans ${LOANS} (hard ${hard}), deck rows ${rows.length} over ${days.length} days, ${uploads} uploads`);
console.log(`the file: first run repaired ${first[2]} of ${first[0]} not fitting (${first[4]} left alone), the run after changed ${again[2]}; log ${A.m.log_rows}; wrongly changed ${A.m.changed_to_something_that_is_not_the_truth}; right made wrong ${A.m.a_right_date_made_wrong}`);
console.log(`small runs: ${S.runsOut.length} runs, ${S.m.log_rows} rows changed (one big run: ${A.m.log_rows})`);
console.log(`broken on purpose (no DAYS ELAPSED witness): ${B.m.changed_to_something_that_is_not_the_truth} rows changed to something that is not the truth`);
if (fails.length) { console.error('\nFAILED:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('\nOK: the repair does what its file says, undoes exactly, and the check fails when the repair is broken.');
