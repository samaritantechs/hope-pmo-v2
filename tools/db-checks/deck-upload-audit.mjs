/* THE PER-UPLOAD DATE AUDIT -- db/RUN-ME-061, run for real on a PostgreSQL.

     "They might be in different orders per file so check starting with the defaulters one I sent" -- the owner, 16 Nov 2026

   db/RUN-ME-061-deck-uploads-date-audit-read-only.sql reads the book and says, for every upload of the defaulter
   decks, how many customers' dates fit the loan system's own pattern as stored, how many fit only with day and month
   exchanged, and how the D.S column came out. It is not believed on a reading. This check builds a book the way the
   three kinds of upload left it (the loan system's Excel file read day-first by the old importer: every date whose two
   numbers were twelve or under swapped; a CSV on the old page: dates right, D.S spoilt into a date; an upload read
   right), with loans meant to make it say something wrong (a restructured loan, a loan with no DAYS ELAPSED, a loan with
   no chronic date), runs THE FILE ITSELF (read from db/, with its window set), and compares every line of its answer with a
   count made in JavaScript from the same rows.

   It passes only when: every upload's row, fit, swapped, neither, missing and D.S counts equal the count made in JavaScript;
   the days outside the window are not in the answer; the book is byte-for-byte unchanged afterwards (it is read-only);
   and the file with the DAYS ELAPSED witness taken out of its pattern gives a different answer (a check that cannot fail
   when the file is broken proves nothing, and says so).

   It needs a PostgreSQL it can reach with psql and NO public.defaulter_snapshots in it: the table is created inside one
   transaction and the whole case is rolled back. psql's own variables say which:

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/deck-upload-audit.mjs
       (LOANS=2000 by default; LOANS=30000 times the audit on a book of the live book's size)

   NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-061-deck-uploads-date-audit-read-only.sql'), 'utf8');
const LOANS = Number(process.env.LOANS || 2000);
const SEP = '\x1f', DAY = 86400000;
const psql = sql => execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', SEP, '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28 });

let seed = 20261116;                                              // mulberry32: every draw uses all 32 bits
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const iso = t => new Date(t).toISOString().slice(0, 10);
const swap = t => { const d = new Date(t), m = d.getUTCMonth() + 1, dd = d.getUTCDate(); return (dd <= 12 && m !== dd) ? Date.UTC(d.getUTCFullYear(), dd - 1, m) : t; };   // what the old importer stored for a date

// ---- the book
const loans = [];
for (let i = 0; i < LOANS; i++) {
  const d = Date.UTC(2024, 0, 1) + Math.floor(rnd() * ((Date.UTC(2026, 10, 10) - Date.UTC(2024, 0, 1)) / DAY)) * DAY;     // a whole day
  let e = d + 91 * DAY, kind = 'normal'; const x = rnd();
  if (x < 0.04) { kind = 'moved'; e += [17, 45, 30][Math.floor(rnd() * 3)] * DAY; }       // a restructured loan: its expiry was moved on purpose
  else if (x < 0.06) kind = 'nodays';
  else if (x < 0.07) kind = 'nochronic';
  loans.push({ ref: 'L' + String(i).padStart(6, '0'), d, e, c: kind === 'nochronic' ? null : e + 14 * DAY, kind, k: i });
}
// the uploads: Excel files read day-first (X), a CSV on the old page (C), an upload read right (R)
const days = []; for (let k = 8; k <= 17; k++) days.push('2026-11-' + String(k).padStart(2, '0'));
const ROUTE = { initial: ['X', 'C', 'X', 'R', 'C', 'X', 'C', 'X', 'R', 'X'], current: ['X', 'X', 'X', 'X', 'X', 'X', 'X', 'X', 'R', 'X'] };
const uploads = [];
const uuid = n => n.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000000';           // upload_batch is a uuid on the real table (db/schema.sql): a text there failed on the live book
const label = b => (b ? b.slice(0, 8) : 'legacy');                                                // the audit shows a batch as its first eight characters, and a row with none as "legacy"
days.forEach((day, di) => ['initial', 'current'].forEach(type => uploads.push({ day, type, route: ROUTE[type][di], batch: uuid(uploads.length + 1), at: type === 'initial' ? '04:30' : '22:40' })));
uploads.push({ day: '2026-11-14', type: 'current', route: 'X', batch: uuid(0xffff), at: '20:05' });          // an earlier upload of a day that a later one replaced: still in the book until swept
uploads.push({ day: '2026-11-09', type: 'initial', route: 'X', batch: '', at: '04:00' });                  // rows with no batch at all (the book's oldest): shown as "legacy"
const rows = []; const expect = new Map();
const blank = () => ({ rows: 0, fit: 0, swapped: 0, neither: 0, missing: 0, pair: 0, datelike: 0, other: 0 });
for (const u of uploads) {
  const snap = Date.parse(u.day + 'T00:00:00Z'), off = u.type === 'initial' ? 2 : 1, ex = blank(); expect.set(u.day + '|' + u.type + '|' + u.batch, ex);
  for (const l of loans) {
    if (u.type === 'current' && l.k % 11 === 0) continue;
    const st = u.route === 'X' ? { d: swap(l.d), e: swap(l.e), c: l.c == null ? null : swap(l.c) } : { d: l.d, e: l.e, c: l.c };
    const de = l.kind === 'nodays' ? null : Math.round((snap - l.d) / DAY) - off;
    const pair = ((l.k % 12) + 1) + '-' + (((l.k * 7) % 12) + 1);
    const ds = u.route === 'C' ? pair.replace('-', '/') + '/01' : pair;
    rows.push([l.ref, u.type, u.day, iso(st.d), iso(st.e), st.c == null ? '' : iso(st.c), de == null ? '' : de, ds, u.batch, u.day + ' ' + u.at + ':00+03'].join(','));
    // the same counts, made in JavaScript from the stored values (not from the SQL)
    ex.rows++;
    const complete = de != null && st.c != null;
    const fits = (a, b, c) => complete && (b - a) / DAY === 91 && (c - b) / DAY === 14 && (snap - a) / DAY - de >= 0 && (snap - a) / DAY - de <= 3;
    const f1 = complete && fits(st.d, st.e, st.c), f2 = complete && fits(swap(st.d), swap(st.e), swap(st.c));
    if (!complete) ex.missing++; else if (f1) ex.fit++; else if (f2) ex.swapped++; else ex.neither++;
    if (/^\d{1,2}\s*[-/]\s*\d{1,2}$/.test(ds)) ex.pair++; else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(ds)) ex.datelike++; else ex.other++;
  }
}
const SETUP = `begin;
create table public.defaulter_snapshots (id uuid primary key default gen_random_uuid(), ref text not null, snapshot_type text not null check (snapshot_type in ('initial','current')),
  snapshot_date date not null, disb_date date, expire_date date, chronic_date date, days_elapsed integer, ds text, upload_batch uuid, created_at timestamptz not null default now());
create index on public.defaulter_snapshots (snapshot_date);
copy public.defaulter_snapshots (ref, snapshot_type, snapshot_date, disb_date, expire_date, chronic_date, days_elapsed, ds, upload_batch, created_at) from stdin with (format csv, null '');
${rows.join('\n')}
\\.
analyze public.defaulter_snapshots;
`;
const SUM = `select md5(string_agg(id::text || coalesce(disb_date::text, '') || coalesce(expire_date::text, '') || coalesce(chronic_date::text, '') || coalesce(ds, '') || coalesce(upload_batch::text, ''), '|' order by id)), count(*) from public.defaulter_snapshots;`;
const run = (file, from, to) => {
  const f = file.replace(/date '2026-11-10' as from_day/, `date '${from}' as from_day`).replace(/date '2026-11-16' as to_day/, `date '${to}' as to_day`);
  if (f === file && (from !== '2026-11-10' || to !== '2026-11-16')) throw new Error('could not set the window in the file: its first lines changed');
  const t0 = Date.now();
  const STAMP = `select 'T' || chr(31) || extract(epoch from clock_timestamp());\n`;
  const out = psql(SETUP + SUM + '\n' + STAMP + f + '\n' + STAMP + SUM + '\nrollback;\n').trim().split('\n');
  const ms = Date.now() - t0;
  const stamps = out.filter(l => l.startsWith('T' + SEP)).map(l => Number(l.split(SEP)[1]));
  const sums = out.filter(l => /^[0-9a-f]{32}/.test(l)), table = out.filter(l => /^\d{4}-\d\d-\d\d /.test(l)).map(l => l.split(SEP));
  return { table, ms, auditMs: Math.round((stamps[1] - stamps[0]) * 1000), same: sums.length === 2 && sums[0] === sums[1] };
};
const fails = [];
const check = (name, ok, extra) => { if (!ok) fails.push(name + (extra ? ' -- ' + extra : '')); console.log((ok ? 'ok    ' : 'FAIL  ') + name + (extra && !ok ? ' -- ' + extra : '')); };

// 1. the whole window: every upload's line equals the count made in JavaScript
{
  const { table, ms, auditMs, same } = run(FILE, '2026-11-08', '2026-11-17');
  check('the audit left the book exactly as it was (read-only)', same);
  const want = uploads.length;
  check('one line per upload (' + want + ')', table.length === want, 'got ' + table.length);
  let bad = 0, seen = new Set();
  for (const t of table) {
    const [day, kind, , batch, n, fit, swapped, neither, missing, pair, datelike, other] = t, key = day.slice(0, 10) + '|' + kind + '|' + batch;
    // the batch is shown as its first eight characters
    const full = [...expect.keys()].find(k => k.startsWith(key.slice(0, key.lastIndexOf('|') + 1)) && label(k.split('|')[2]) === batch && !seen.has(k));
    const ex = full && expect.get(full); if (full) seen.add(full);
    const got = [n, fit, swapped, neither, missing, pair, datelike, other].map(Number), exp = ex && [ex.rows, ex.fit, ex.swapped, ex.neither, ex.missing, ex.pair, ex.datelike, ex.other];
    if (!ex || got.join() !== exp.join()) { bad++; if (bad <= 3) console.log('   line ' + key + ' got ' + got.join(',') + ' want ' + (exp ? exp.join(',') : 'no such upload')); }
  }
  check('every upload line equals the count made in JavaScript from the same rows', bad === 0, bad + ' of ' + table.length + ' lines differ');
  // what the three kinds of upload must look like, said once in plain terms
  const byRoute = r => table.filter(t => { const u = uploads.find(x => x.day === t[0].slice(0, 10) && x.type === t[1] && label(x.batch) === t[3]); return u && u.route === r; });
  const frac = (t, i) => Number(t[i]) / Number(t[4]);
  check('an Excel file read day-first shows its customers as fit-only-if-swapped (the loans with a swappable date)', byRoute('X').every(t => frac(t, 6) > 0.45 && frac(t, 6) < 0.9 && Number(t[10]) === 0), byRoute('X').length + ' uploads');
  check('a CSV on the old page shows its dates fitting as stored and its D.S spoilt', byRoute('C').every(t => frac(t, 5) > 0.85 && frac(t, 10) > 0.99), byRoute('C').length + ' uploads');
  check('an upload read right shows its dates fitting as stored and its D.S as pairs', byRoute('R').every(t => frac(t, 5) > 0.85 && frac(t, 9) > 0.99 && Number(t[10]) === 0), byRoute('R').length + ' uploads');
  check('a restructured loan is neither; a loan with no DAYS ELAPSED or no chronic date is "missing"', table.every(t => Number(t[7]) > 0 && Number(t[8]) > 0), '');
  console.log('      ' + rows.length.toLocaleString('en-US') + ' deck rows in the book; the audit itself took ' + auditMs + ' ms (' + ms + ' ms with building the book)');
}
// 2. the window works: two days only
{
  const { table } = run(FILE, '2026-11-12', '2026-11-13');
  check('the window names the days: two days, four uploads', table.length === 4 && table.every(t => t[0] >= '2026-11-12' && t[0] < '2026-11-14'), 'got ' + table.map(t => t[0].slice(0, 10)).join(' '));
}
// 3. broken on purpose: without the DAYS ELAPSED witness the audit must say something else
{
  const broken = FILE.replace(/ and r\.snapshot_date - r\.d - r\.days_elapsed between 0 and 3/, '').replace(/ and r\.snapshot_date - r\.d_s - r\.days_elapsed between 0 and 3/, '');
  check('(the file with its DAYS ELAPSED witness taken out is not the file: the break was applied)', broken !== FILE);
  const a = run(FILE, '2026-11-08', '2026-11-17').table.map(t => t.slice(4).join()).join('|');
  const b = run(broken, '2026-11-08', '2026-11-17').table.map(t => t.slice(4).join()).join('|');
  check('WITH THE DAYS ELAPSED WITNESS TAKEN OUT THE ANSWER CHANGES (a check that cannot fail proves nothing)', a !== b);
}
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
