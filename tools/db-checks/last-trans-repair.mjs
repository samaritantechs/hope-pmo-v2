/* THE LAST TRANS DATE OF THE DECKS, PUT RIGHT IN THE UPLOADS THAT WERE READ THE WRONG WAY ROUND -- db/RUN-ME-066, run for real on a PostgreSQL.

     "... we have last trans date column ..." -- the owner, 17 Nov 2026

   db/RUN-ME-066-repair-swapped-last-trans-dates.sql exchanges the day and the month of LAST TRANS DATE in the deck rows of an upload that has TWO proofs of its own (RUN-ME-060 put right at least
   three of its rows, and at least half of the rows that fit the pattern; at least three of its rows carry a date that is impossible as stored and possible the other way round), and only
   where the other reading lies between the loan's disbursement and the deck's day. LAST TRANS DATE has no pattern of its own, so this writes to the book on witnesses that are not the order
   rule, and it is not believed on a reading.

   THE BOOK IS THE REAL ONE: the WHOLE of db/schema.sql in a scratch database, then the real db/RUN-ME-060 over the same days (it makes the log the proof is read from), then the file.
   The fixture knows the truth: every loan has a real disbursement date, a real last transaction, and each upload stores them as the old importer did (swapped wherever both numbers were
   twelve or under) or as an upload read right does. It has: swapped uploads, right uploads, a right upload on the SAME day and kind as a swapped one, and one upload made to stand on
   each line of the rule and fall just short of it: exactly three repaired rows, two, a swapped slice in an upload that was read right, an upload whose own dates show no exchange, rows with no
   upload number, an upload whose rows are changed across several runs; restructured loans, loans with no DAYS ELAPSED, loans whose DAYS ELAPSED does not fit, a last transaction before the
   disbursement and one after the deck's day, rows with no last transaction, and last transactions whose day and month are the same.

   It passes only when: every row's LAST TRANS DATE equals a MODEL of the rule written again in JavaScript after each run, and every row the file changed now equals the REAL date it was
   stored from; no right upload and no other column was touched; the answer's numbers (and the verdict of every upload) equal the model's; a second run changes nothing; small runs end where one
   big run ends; a narrow window changes only the days it names; a book where RUN-ME-060 was never run says so and changes nothing; the file's own undo puts every row back, byte for byte;
   and EVERY ONE of a list of deliberate breaks of the file (a proof moved or dropped, a condition dropped, the uploads not told apart, a bound dropped, the log not kept) changes the outcome
   -- a check that cannot fail when the file is broken proves nothing, and says so.

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/last-trans-repair.mjs

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-066-repair-swapped-last-trans-dates.sql'), 'utf8');
const F060 = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-060-repair-swapped-deck-dates.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
const LOANS = Number(process.env.LOANS || 500);
const SEP = '\x1f', DAY = 86400000, PROOF = 3, DB = 'hope_lt_check';
const psql = (sql, db = DB) => {
  try { return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', SEP, '-d', db, '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 29, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { const err = new Error('psql failed: ' + String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 4).join(' | ')); err.psql = String(e.stderr || ''); throw err; }
};
let seed = 20261117;                                               // mulberry32
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const D = s => Date.parse(s + 'T00:00:00Z');
const iso = t => (t == null ? '' : new Date(t).toISOString().slice(0, 10));
const swap = t => { if (t == null) return t; const d = new Date(t), m = d.getUTCMonth() + 1, dd = d.getUTCDate(); return (dd <= 12 && m !== dd) ? Date.UTC(d.getUTCFullYear(), dd - 1, m) : t; };
const ambiguous = t => t != null && swap(t) !== t;
const uuid = (p, n) => p + n.toString(16).padStart(7, '0') + '-0000-4000-8000-000000000000';       // the first eight characters tell the upload apart, as a real upload number does
const between = (t, a, b) => t != null && a != null && b != null && t >= a && t <= b;

// ---- the loans: the truth
const mk = (ref, d, kind, i) => { let e = d + 91 * DAY; if (kind === 'moved') e += 17 * DAY; return { ref, d, e, c: kind === 'nochronic' ? null : e + 14 * DAY, kind, i }; };
const loans = [];
for (let i = 0; i < LOANS; i++) {
  const d = D('2024-01-01') + Math.floor(rnd() * ((D('2026-08-05') - D('2024-01-01')) / DAY)) * DAY, x = rnd();
  const kind = x < 0.04 ? 'moved' : x < 0.06 ? 'nodays' : x < 0.07 ? 'nochronic' : x < 0.085 ? 'baddays' : x < 0.095 ? 'contradiction' : x < 0.105 ? 'late' : 'normal';
  loans.push(mk('L' + String(i).padStart(6, '0'), d, kind, i));
}
// the hand-picked loans of the special uploads. AMB: the disbursement date can be misread (day twelve or under, and not the month), so RUN-ME-060 has a date to put right.
// PLAIN: no date of the loan can be misread (the day is over twelve in all three), so the upload leaves it as it is.
const special = (n, test, label, kind = 'normal') => {
  const days = []; for (let d = D('2024-06-01'); d <= D('2026-07-15'); d += DAY) if (test(d)) days.push(d);
  if (days.length < n) throw new Error('only ' + days.length + ' ' + label + ' days, ' + n + ' needed');
  for (let i = days.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [days[i], days[j]] = [days[j], days[i]]; }
  return days.slice(0, n).map((d, k) => mk(label + String(k).padStart(5, '0'), d, kind, 100000 + k));
};
const dom = t => new Date(t).getUTCDate();
const plainDays = d => dom(d) > 12 && dom(d + 91 * DAY) > 12 && dom(d + 105 * DAY) > 12;
const AMB = special(40, d => ambiguous(d), 'A'), PLAIN = special(40, plainDays, 'P');
// a last transaction five days before the loan was disbursed, that can be misread (so a swapped upload stores another date); and DAYS ELAPSED eleven days off, on loans whose three dates can not be misread
loans.push(...special(8, d => ambiguous(d - 5 * DAY), 'C', 'contradiction'), ...special(8, plainDays, 'B', 'baddays'));
// a last transaction for a loan on a deck day, of a given kind (the real one: what the loan system holds)
//   wit  : the stored date (the real one, exchanged) lies OUTSIDE the loan's days and the real date inside them: the exchange shows in the column itself
//   both : ambiguous, and both readings lie between the Disb date and the deck's day: nothing in the column shows the exchange
//   rand : any date between the two
function realLt(loan, snap, kind) {
  for (let g = 0; g < 20000; g++) {
    const span = Math.max(2, Math.round((snap - loan.d) / DAY));
    const t = loan.d + Math.floor(rnd() * span) * DAY;
    if (!between(t, loan.d, snap)) continue;
    const s = swap(t);
    if (kind === 'rand') return t;
    if (kind === 'wit' && s !== t && !between(s, loan.d, snap)) return t;
    if (kind === 'both' && s !== t && between(s, loan.d, snap)) return t;
  }
  throw new Error('no last transaction of kind ' + kind + ' for ' + loan.ref + ' on ' + iso(snap));
}
// ---- the uploads: one batch each
const days = []; for (let k = 2; k <= 16; k++) days.push('2026-11-' + String(k).padStart(2, '0'));
const uploads = []; let b = 0;
const up = o => { uploads.push({ batch: o.nullBatch ? null : uuid('b', ++b), ...o }); return uploads[uploads.length - 1]; };
for (const day of days) for (const type of ['initial', 'current']) up({ day, type, route: rnd() < 0.7 ? 'X' : 'R', name: 'regular' });
uploads.find(u => u.day === '2026-11-09' && u.type === 'current').route = 'X';
up({ day: '2026-11-09', type: 'current', route: 'R', name: 'right, on the same day and kind as a swapped one', loans: loans.filter(l => l.i % 5 === 0) });
// each special upload: [loan, kind of last transaction, route of the row (X = stored the old way, R = stored right)]
const S = {};
S.three = up({ day: '2026-11-10', type: 'initial', route: 'X', name: 'exactly three rows repaired (the line)', rows: AMB.slice(0, 3).map(l => [l, 'wit']) });
S.two = up({ day: '2026-11-11', type: 'initial', route: 'X', name: 'two rows repaired, three show the exchange', rows: [[AMB[3], 'wit'], [AMB[4], 'wit'], [PLAIN[0], 'wit']] });
S.slice = up({ day: '2026-11-12', type: 'initial', route: 'M', name: 'read right but for a slice of five', rows: [...PLAIN.slice(1, 31).map(l => [l, 'both', 'R']), ...AMB.slice(5, 10).map(l => [l, 'wit', 'X'])] });
S.nowit = up({ day: '2026-11-13', type: 'initial', route: 'X', name: 'swapped, but its own dates show no exchange', rows: AMB.slice(10, 16).map(l => [l, 'both']) });
S.nobatch = up({ day: '2026-11-14', type: 'current', route: 'X', nullBatch: true, name: 'swapped rows with no upload number', rows: AMB.slice(16, 26).map(l => [l, 'wit']) });
S.split = up({ day: '2026-11-01', type: 'initial', route: 'X', name: 'three rows, changed one run at a time', rows: AMB.slice(26, 29).map(l => [l, 'wit']) });
// the rows
const rows = []; let rowId = 0;
for (const u of uploads) {
  const snap = D(u.day), off = u.type === 'initial' ? 2 : 1;
  const list = u.rows || (u.loans || loans).filter(l => !(u.name === 'regular' && u.type === 'current' && l.i % 11 === 0)).map(l => [l, null]);
  for (const [l, ltKind, forced] of list) {
    const route = forced || u.route;
    const st = route === 'X' ? { d: swap(l.d), e: swap(l.e), c: l.c == null ? null : swap(l.c) } : { d: l.d, e: l.e, c: l.c };
    const de = l.kind === 'nodays' ? null : Math.round((snap - l.d) / DAY) - off + (l.kind === 'baddays' ? (l.i % 2 ? -11 : 11) : 0);
    let ltr;
    if (l.kind === 'contradiction') ltr = l.d - 5 * DAY;                                                      // a last transaction before the disbursement
    else if (l.kind === 'late') ltr = snap + 2 * DAY;                                                         // and one after the deck's own day
    else ltr = realLt(l, snap, ltKind || 'rand');
    if (!ltKind && rnd() < 0.03) ltr = null;
    rows.push({ id: uuid('a', ++rowId), ref: l.ref, up: u, route, loan: l, snap, de, st, ltr, lt: ltr == null ? null : (route === 'X' ? swap(ltr) : ltr) });
  }
}
const byId = new Map(rows.map(r => [r.id, r]));

// ---- the MODEL: RUN-ME-060 and the rule, written again
const fitsP = (d, e, c, de, snap) => d != null && e != null && c != null && de != null && (e - d) / DAY === 91 && (c - e) / DAY === 14 && (snap - d) / DAY - de >= 0 && (snap - d) / DAY - de <= 3;
function model060(r) {                                                                                  // the dates RUN-ME-060 leaves a row with
  const s = r.st;
  if (s.d == null || s.e == null || s.c == null || r.de == null || fitsP(s.d, s.e, s.c, r.de, r.snap)) return { ...s, repaired: false };
  const fit = new Set();
  for (const d of [s.d, swap(s.d)]) for (const e of [s.e, swap(s.e)]) for (const c of [s.c, swap(s.c)]) if (fitsP(d, e, c, r.de, r.snap)) fit.add(d + ',' + e + ',' + c);
  if (fit.size !== 1) return { ...s, repaired: false };
  const [d, e, c] = [...fit][0].split(',').map(Number);
  return { d, e, c, repaired: true };
}
for (const r of rows) {
  r.after = model060(r);
  r.fits = fitsP(r.after.d, r.after.e, r.after.c, r.de, r.snap);
  r.sw = swap(r.lt);
  r.amb = r.lt != null && r.sw !== r.lt;
  r.wit = r.fits && r.amb && !between(r.lt, r.after.d, r.snap) && between(r.sw, r.after.d, r.snap);
  r.possible = r.fits && r.amb && between(r.sw, r.after.d, r.snap);
}
const keyOf = r => (r.up.batch || 'null') + '|' + r.up.day + '|' + r.up.type;
function verdicts(win) {                                                                                // one entry per upload of the window
  const g = new Map();
  for (const r of rows) {
    if (r.up.day < win.from || r.up.day > win.to) continue;
    const u = g.get(keyOf(r)) || { batch: r.up.batch, day: r.up.day, type: r.up.type, n: 0, nRep: 0, nFit: 0, nWit: 0 };
    u.n++; if (r.after.repaired) u.nRep++; if (r.fits) u.nFit++; if (r.wit) u.nWit++; g.set(keyOf(r), u);
  }
  for (const u of g.values()) u.swapped = u.batch != null && u.nRep >= PROOF && 2 * u.nRep >= u.nFit && u.nWit >= PROOF;
  return g;
}
function simulate(win, max, times) {                                                                    // the answer of every run, and the Last trans date of every row after it
  const g = verdicts(win), changed = new Set(), out = [];
  const inWin = rows.filter(r => r.up.day >= win.from && r.up.day <= win.to);
  for (let t = 0; t < times; t++) {
    const cand = inWin.filter(r => g.get(keyOf(r)).swapped && r.amb && !changed.has(r.id));
    const ok = cand.filter(r => r.possible).sort((a, b) => (a.up.day < b.up.day ? -1 : a.up.day > b.up.day ? 1 : (a.id < b.id ? -1 : 1)));
    const take = ok.slice(0, max);
    for (const r of take) changed.add(r.id);
    out.push({
      deckRows: inWin.length, swapped: [...g.values()].filter(u => u.swapped).length, left: [...g.values()].filter(u => !u.swapped).length,
      cand: cand.length, ok: ok.length, changed: take.length, still: ok.length - take.length,
      notFit: cand.filter(r => !r.fits).length, notPossible: cand.filter(r => r.fits && !between(r.sw, r.after.d, r.snap)).length,
      ambLeft: inWin.filter(r => !g.get(keyOf(r)).swapped && r.amb && !changed.has(r.id)).length,
      final: new Map(rows.map(r => [r.id, changed.has(r.id) ? r.sw : r.lt])),
    });
  }
  return { runs: out, g, changed };
}
const verdictWords = u => u.batch == null ? 'LEFT ALONE, no upload number on these rows' : u.swapped ? 'SWAPPED' : u.nRep === 0 ? 'left alone, RUN-ME-060 put right none of it (read right, or not run for this day)'
  : (u.nRep < PROOF || 2 * u.nRep < u.nFit) ? 'left alone, RUN-ME-060 put right too few of its rows to be sure of the whole upload' : 'left alone, no Last trans date of it shows the exchange';

// ---- the database
const FIRST = '2026-11-01', LAST = '2026-11-16';
const SETUP = `${SCHEMA}
copy public.defaulter_snapshots (id, ref, snapshot_type, snapshot_date, disb_date, expire_date, chronic_date, days_elapsed, last_trans_date, upload_batch) from stdin with (format csv, null '');
${rows.map(r => [r.id, r.ref, r.up.type, r.up.day, iso(r.st.d), iso(r.st.e), r.st.c == null ? '' : iso(r.st.c), r.de == null ? '' : r.de, r.lt == null ? '' : iso(r.lt), r.up.batch || ''].join(',')).join('\n')}
\\.
analyze public.defaulter_snapshots;
`;
const sub = (src, re, to, what) => { const n = (src.match(new RegExp(re.source, 'g')) || []).length; if (n !== 1) throw new Error('the file has ' + n + ' of "' + what + '", the check needs exactly one'); return src.replace(re, to); };
const win = (f, from, to, max) => sub(sub(sub(f, /date '2026-11-16' as from_day/, `date '${from}' as from_day`, 'from_day'), /date '2026-11-16' as to_day/, `date '${to}' as to_day`, 'to_day'), /\b\d+ as max_rows/, `${max} as max_rows`, 'max_rows');
const S060 = win(F060, FIRST, LAST, 1000000);
const undoOf = (f, from, to) => { const ls = f.split('\n'); const i = ls.findIndex(l => l.startsWith('-- UNDO')); return ls.slice(i + 1).filter(l => l.startsWith('--')).map(l => l.slice(2)).join('\n').replace("between date '2026-11-16' and date '2026-11-16'", `between date '${from}' and date '${to}'`); };
const STATE = (tag, full) => (full ? `select 'S${tag}' || chr(31) || id || chr(31) || coalesce(last_trans_date::text, '') from public.defaulter_snapshots order by id;\n` : '')
  + `select 'O${tag}' || chr(31) || md5(coalesce(string_agg(id::text || ref || snapshot_type || snapshot_date::text || coalesce(disb_date::text, '') || coalesce(expire_date::text, '') || coalesce(chronic_date::text, '') || coalesce(days_elapsed::text, '') || coalesce(upload_batch::text, ''), '|' order by id), '')) from public.defaulter_snapshots;
select 'M${tag}' || chr(31) || md5(coalesce(string_agg(id::text || coalesce(last_trans_date::text, ''), '|' order by id), '')) from public.defaulter_snapshots;
select 'L${tag}' || chr(31) || case when to_regclass('public.defaulter_last_trans_repair_log') is null then 'no log' else md5(query_to_xml('select id, last_trans_old, last_trans_new from public.defaulter_last_trans_repair_log order by id', false, false, '')::text) end;
`;
// one session: the file N times, each between two markers, each followed by the state; optionally the undo; then everything is rolled back
function run(file, { from = FIRST, to = LAST, max = 1000000, times = 1, undo = false, full = true } = {}) {
  const f = win(file, from, to, max);
  let sql = 'begin;\n' + STATE('A', full);
  for (let i = 0; i < times; i++) sql += `select 'B${i}';\n${f}\nselect 'E${i}';\n` + STATE('R' + i, full);
  if (undo) sql += undoOf(f, from, to) + '\n' + STATE('U', full);
  const out = psql(sql + 'rollback;\n').split('\n').filter(l => l !== '');
  const tagged = t => out.filter(l => l.startsWith(t + SEP)).map(l => l.slice(t.length + 1));
  const stateOf = t => new Map(tagged('S' + t).map(l => { const [id, v] = l.split(SEP); return [id, v]; }));
  const res = { runs: [], A: { map: full ? stateOf('A') : null, O: tagged('OA')[0], M: tagged('MA')[0] } };
  for (let i = 0; i < times; i++) {
    const a = out.indexOf('B' + i), z = out.indexOf('E' + i);
    res.runs.push({ lines: out.slice(a + 1, z).map(l => l.split(SEP)), map: full ? stateOf('R' + i) : null, O: tagged('OR' + i)[0], M: tagged('MR' + i)[0], L: tagged('LR' + i)[0] });
  }
  if (undo) res.U = { map: full ? stateOf('U') : null, M: tagged('MU')[0] };
  return res;
}
const num = s => Number(String(s).replace(/,/g, ''));
const parse = lines => {                                                                                 // the answer: nine lines, and one per upload
  const sum = lines.slice(0, 9), per = lines.slice(9);                                                   // the nine lines come first (ord 1 to 9), then one per upload
  const nums = a => (a.match(/\d[\d,]*/g) || []).map(num);
  return {
    deckRows: num(sum[0][1]), swapped: nums(sum[1][1])[0], left: nums(sum[1][1])[1], cand: num(sum[2][1]), ok: num(sum[3][1]), changed: num(sum[4][1]), still: num(sum[5][1]),
    notFit: num(sum[6][1]), notPossible: num(sum[7][1]), ambLeft: num(sum[8][1]),
    per: per.map(([w, a]) => { const [, day, typ, batch] = w.trim().match(/^(\S+) (\S+) (.*)$/); const m = a.match(/^([\d,]+) rows; RUN-ME-060 put right ([\d,]+); ([\d,]+) show the exchange: (.*)$/); return { day, typ, batch, n: num(m[1]), nRep: num(m[2]), nWit: num(m[3]), verdict: m[4] }; }),
  };
};
// ---- SCALE=1: the file, timed on a book of the live book's size (2.3 million deck rows, the live table's indexes, a window of six days as the owner will run it). Nothing else runs.
if (process.env.SCALE) {
  const SDB = 'hope_lt_scale', admin0 = process.env.PGDATABASE || 'postgres';
  const sw = 'pg_temp.sw';
  const q = (sql, db = SDB) => psql(sql, db);
  const timed = (label, f) => { const t = Date.now(); const r = f(); console.log(label + ': ' + ((Date.now() - t) / 1000).toFixed(1) + ' s'); return r; };
  const win0 = (f, from, to, max) => f.replace(/date '2026-11-16' as from_day/, `date '${from}' as from_day`).replace(/date '2026-11-16' as to_day/, `date '${to}' as to_day`).replace(/\b\d+ as max_rows/, `${max} as max_rows`);
  try { psql('drop database if exists ' + SDB, admin0); } catch { /* none */ }
  psql('create database ' + SDB, admin0);
  let code = 1;
  try {
    q(SCHEMA);
    q('create extension if not exists pg_trgm;');
    timed('book made (12,000 loans on 108 days, initial and current: the old reader\'s dates)', () => q(`
create function pg_temp.sw(d date) returns date language sql immutable as $$
  select case when extract(day from d) <= 12 and extract(day from d) <> extract(month from d)
              then make_date(extract(year from d)::int, extract(day from d)::int, extract(month from d)::int) else d end $$;
insert into public.defaulter_snapshots (ref, full_name, disb_date, expire_date, chronic_date, last_trans_date, days_elapsed, snapshot_type, weekday, snapshot_date, upload_batch)
select 'L' || lpad(l::text, 6, '0'), 'CUSTOMER ' || md5(l::text), pg_temp.sw(y.disb), pg_temp.sw(y.disb + 91), pg_temp.sw(y.disb + 105),
       pg_temp.sw(x.d - ((l * 13 + extract(day from x.d)::int * 7) % 50)), (x.d - y.disb) - t.off, t.typ,
       (array['MON','TUE','WED','THU','FRI','SAT','SUN'])[extract(isodow from x.d)::int], x.d, md5(x.d::text || t.typ)::uuid
from generate_series(date '2026-08-01', date '2026-11-16', interval '1 day') g(dd)
cross join lateral (select g.dd::date as d) x
cross join (values ('initial', 2), ('current', 1)) t(typ, off)
cross join generate_series(0, 11999) l
cross join lateral (select date '2024-04-01' + ((l * 37) % 800) as disb) y
where not (t.typ = 'current' and l % 5 = 0);`));
    timed('the live table\'s indexes made', () => q(`
create index idx_def_snap_date on public.defaulter_snapshots(snapshot_date);
create index idx_def_snap_date_type on public.defaulter_snapshots(snapshot_date, snapshot_type);
create index idx_def_snap_team_ref on public.defaulter_snapshots(team, ref);
create index idx_def_snap_fullname_trgm on public.defaulter_snapshots using gin (full_name gin_trgm_ops);
create index idx_def_snap_ref_trgm on public.defaulter_snapshots using gin (ref gin_trgm_ops);
analyze public.defaulter_snapshots;`));
    console.log(q('select count(*) || \' deck rows, \' || pg_size_pretty(pg_total_relation_size(\'public.defaulter_snapshots\')) || \' with its indexes\' from public.defaulter_snapshots').trim());
    const W = ['2026-11-10', '2026-11-15'];
    const outside = () => q(`select count(*) || ' rows, ' || md5(string_agg(id::text || coalesce(last_trans_date::text, '') || coalesce(disb_date::text, '') || coalesce(expire_date::text, '') || coalesce(chronic_date::text, ''), '|' order by id)) from public.defaulter_snapshots where snapshot_date not between date '${W[0]}' and date '${W[1]}'`).trim();
    const outsideBefore = outside();
    let left = 1, n = 0;
    while (left > 0 && n++ < 12) {                                                                     // RUN-ME-060 as the owner runs it: again until it says 0
      const out = timed('RUN-ME-060 ' + W.join(' to ') + ' (run ' + n + ', 50,000 rows at most)', () => q('begin;\n' + win0(F060, W[0], W[1], 50000) + '\ncommit;\n')).trim().split(SEP).map(Number);
      left = out[3]; console.log('      repaired ' + out[2] + ', still to do ' + out[3]);
    }
    left = 1; n = 0; let total = 0, slowest = 0;
    while (left !== 0 && n++ < 12) {                                                                   // this file, the same way
      const t = Date.now();
      const out = q('begin;\n' + win0(FILE, W[0], W[1], 50000) + '\ncommit;\n').trim().split('\n').map(l => l.split(SEP));
      const secs = (Date.now() - t) / 1000; slowest = Math.max(slowest, secs);
      const p = parse(out); total += p.changed; left = p.still;
      console.log('RUN-ME-066 ' + W.join(' to ') + ' (run ' + n + '): ' + secs.toFixed(1) + ' s; deck rows ' + p.deckRows + ', uploads found swapped ' + p.swapped + ', changed ' + p.changed + ', still to do ' + p.still);
      if (n === 1) console.log(out.slice(0, 9).map(l => '      ' + l.join(' | ')).join('\n') + '\n      (+ ' + (out.length - 9) + ' lines, one per upload)');
    }
    const verify = q(`select count(*) filter (where last_trans_date <> snapshot_date - ((substring(ref from 2)::int * 13 + extract(day from snapshot_date)::int * 7) % 50)) || ' wrong, ' || count(*) || ' rows' from public.defaulter_snapshots where snapshot_date between date '${W[0]}' and date '${W[1]}'`).trim();
    console.log('after the runs, rows of the six days whose Last trans date is not the real one: ' + verify);
    const outsideAfter = outside();
    console.log('the days outside the window, before: ' + outsideBefore + '\n                                   after:  ' + outsideAfter + (outsideBefore === outsideAfter ? '  (the same: not one row of them was touched)' : '  (DIFFERENT)'));
    timed('a run with nothing left to do', () => q('begin;\n' + win0(FILE, W[0], W[1], 50000) + '\ncommit;\n'));
    console.log('slowest run ' + slowest.toFixed(1) + ' s against the 50-second limit; ' + total + ' rows changed');
    code = /^0 wrong/.test(verify) && slowest < 25 && outsideBefore === outsideAfter ? 0 : 1;
    console.log(code === 0 ? 'scale: passed' : 'scale: FAILED');
  } finally { try { psql('drop database if exists ' + SDB, admin0); } catch { /* leave it */ } }
  process.exit(code);
}

const fails = [];
const check = (name, ok, extra) => { if (!ok) fails.push(name + (extra ? ' -- ' + extra : '')); console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok || !extra ? '' : ' -- ' + extra)); };

// ---- the scratch database: the real schema, the data as the old importer stored it, and the real RUN-ME-060
const admin = process.env.PGDATABASE || 'postgres';
try { psql('drop database if exists ' + DB, admin); } catch { /* none */ }
psql('create database ' + DB, admin);
let exitCode = 1;
try {
  psql(SETUP);
  psql('begin;\n' + S060 + '\ncommit;\n');
  const ids060 = new Set(psql('select id from public.defaulter_date_repair_log').split('\n').filter(Boolean));
  const modelRep = new Set(rows.filter(r => r.after.repaired).map(r => r.id));
  check('RUN-ME-060, run for real, repaired exactly the rows the model says (' + modelRep.size + ' rows in ' + new Set(rows.filter(r => r.after.repaired).map(keyOf)).size + ' uploads): the proof is what it was built on',
    ids060.size === modelRep.size && [...modelRep].every(i => ids060.has(i)), ids060.size + ' in its log, ' + modelRep.size + ' in the model');
  const dates = new Map(psql('select id, disb_date, expire_date, chronic_date from public.defaulter_snapshots').split('\n').filter(Boolean).map(l => { const [id, d, e, c] = l.split(SEP); return [id, d + '|' + e + '|' + c]; }));
  check('and it left every row with the dates the model says (the loan\'s dates, right wherever RUN-ME-060 could put them right)', rows.every(r => dates.get(r.id) === iso(r.after.d) + '|' + iso(r.after.e) + '|' + iso(r.after.c)));
  const all = { from: FIRST, to: LAST };
  const nAll = simulate(all, 1e9, 1).changed.size, TIMES = Math.ceil(nAll / 1500) + 1;

  // ---- A: the whole window, in runs of at most 1,500 rows (one more than it takes), then the undo
  const A = run(FILE, { max: 1500, times: TIMES, undo: true });
  const mA = simulate(all, 1500, TIMES);
  const last = TIMES - 1;
  const want = (m, k) => rows.every(r => (A.runs[k].map.get(r.id) || '') === iso(m.runs[k].final.get(r.id)));
  const nChanged = mA.changed.size;
  check('after every one of ' + TIMES + ' runs of at most 1,500 rows, every row\'s LAST TRANS DATE equals the model\'s (' + rows.length.toLocaleString('en-US') + ' deck rows, ' + nChanged + ' changed)', mA.runs.every((_, k) => want(mA, k)));
  check('every row the file changed equals the REAL last transaction it was stored from', [...mA.changed].every(i => A.runs[last].map.get(i) === iso(byId.get(i).ltr)));
  check('no row stored right was changed, and no row that has no other reading', rows.filter(r => r.route === 'R' || !r.amb).every(r => A.runs[last].map.get(r.id) === iso(r.lt)));
  check('only last_trans_date changed', A.runs.every(r => r.O === A.A.O));
  const ans = A.runs.map(r => parse(r.lines));
  const same = (a, m) => ['deckRows', 'swapped', 'left', 'cand', 'ok', 'changed', 'still', 'notFit', 'notPossible', 'ambLeft'].every(k => a[k] === m[k]);
  check('the answer of every run says what the model says: rows, uploads found swapped / left alone, can be changed, changed now, still to do, left alone (three kinds)', mA.runs.every((m, k) => same(ans[k], m)),
    JSON.stringify(ans[0]).slice(0, 200) + ' vs ' + JSON.stringify({ ...mA.runs[0], final: undefined }));
  check('the run that hit the limit says how many are still to do, the last runs say 0 and change nothing', ans[0].still === mA.runs[0].still && ans[0].still > 0 && ans[last].still === 0 && ans[last].changed === 0 && A.runs[last].M === A.runs[last - 1].M, ans.map(a => a.changed + '/' + a.still).join(' '));
  const perM = [...mA.g.values()];
  check('every upload is listed with its rows, the rows RUN-ME-060 put right, the rows that show the exchange, and the model\'s verdict (' + perM.length + ' uploads, ' + perM.filter(u => u.swapped).length + ' swapped)',
    ans[0].per.length === perM.length && perM.every(u => ans[0].per.some(p => p.day === u.day && p.typ === u.type && p.batch === (u.batch ? u.batch.slice(0, 8) : 'no upload number') && p.n === u.n && p.nRep === u.nRep && p.nWit === u.nWit && p.verdict === verdictWords(u))));
  const sp = n => mA.g.get(keyOf(rows.find(r => r.up === S[n])));
  check('the uploads made to stand on each line of the rule land where the rule puts them: three repaired rows = swapped, two = not, a swapped slice, no exchange shown, no upload number, the split one',
    sp('three').swapped && sp('three').nRep === 3 && !sp('two').swapped && sp('two').nRep === 2 && sp('two').nWit === 3 && !sp('slice').swapped && sp('slice').nRep === 5 && sp('slice').nWit >= 3 && 2 * sp('slice').nRep < sp('slice').nFit
      && !sp('nowit').swapped && sp('nowit').nRep >= 3 && sp('nowit').nWit === 0 && !sp('nobatch').swapped && sp('nobatch').nRep >= 3 && sp('nobatch').nWit >= 3 && sp('split').swapped && sp('split').nRep === 3,
    ['three', 'two', 'slice', 'nowit', 'nobatch', 'split'].map(n => n + ':' + JSON.stringify(sp(n))).join(' '));
  const swappedRows = rows.filter(r => mA.g.get(keyOf(r)).swapped && r.amb);                                  // the rows of the swapped uploads that have another reading
  const kinds = {
    'other reading before the Disb date': swappedRows.filter(r => r.fits && r.sw < r.after.d).length,
    'other reading after the deck\'s day': swappedRows.filter(r => r.fits && r.sw > r.snap).length,
    'DAYS ELAPSED too small for the pattern (the days from the Disb date over it by 3 to 30)': swappedRows.filter(r => !r.fits && r.after.e - r.after.d === 91 * DAY && r.after.c - r.after.e === 14 * DAY && r.de != null && (r.snap - r.after.d) / DAY - r.de > 3 && (r.snap - r.after.d) / DAY - r.de <= 30).length,
    'DAYS ELAPSED too large for the pattern (the days from the Disb date under it by 1 to 30)': swappedRows.filter(r => !r.fits && r.after.e - r.after.d === 91 * DAY && r.after.c - r.after.e === 14 * DAY && r.de != null && (r.snap - r.after.d) / DAY - r.de < 0 && (r.snap - r.after.d) / DAY - r.de >= -30).length,
    'loan restructured / no DAYS ELAPSED / no chronic date': swappedRows.filter(r => !r.fits && ['moved', 'nodays', 'nochronic'].includes(r.loan.kind)).length,
    'rows of the uploads left alone with another reading': mA.runs[0].ambLeft,
  };
  check('the fixture holds every kind of row the rule leaves alone, in numbers that a break can show: ' + Object.entries(kinds).map(([k, v]) => k + ' ' + v).join('; '), Object.values(kinds).every(v => v >= 3) && mA.runs[0].notPossible >= 10 && mA.runs[0].notFit >= 10, JSON.stringify(kinds));
  check('the file\'s own undo puts every row back, byte for byte', A.U.M === A.A.M && rows.every(r => (A.U.map.get(r.id) || '') === (A.A.map.get(r.id) || '')));
  console.log('      ' + rows.length.toLocaleString('en-US') + ' deck rows in ' + uploads.length + ' uploads; ' + perM.filter(u => u.swapped).length + ' found swapped; ' + nChanged + ' Last trans dates exchanged');

  // ---- B: a narrow window changes only the days it names, and a second run changes nothing
  const WB = { from: '2026-11-10', to: '2026-11-12' };
  const B = run(FILE, { ...WB, times: 2 }), mB = simulate(WB, 1000000, 2);
  check('a narrow window (10 to 12 Nov) changes exactly the rows the model says, and no row of another day', rows.every(r => (B.runs[1].map.get(r.id) || '') === iso(mB.runs[1].final.get(r.id))) && mB.changed.size > 0 && mB.changed.size < nChanged);
  check('a second run of the same window changes nothing, and says so', B.runs[1].M === B.runs[0].M && parse(B.runs[1].lines).changed === 0 && parse(B.runs[1].lines).ok === 0 && parse(B.runs[0].lines).changed === mB.changed.size);
  // ---- C: the proof of an upload is not taken away by what an earlier run changed
  const WC = { from: FIRST, to: FIRST };
  const C = run(FILE, { ...WC, max: 2, times: 3 }), mC = simulate(WC, 2, 3);
  check('an upload changed across several runs (two rows, then the third) is changed whole: its proof is read from the date as it was uploaded', mC.changed.size === 3 && rows.every(r => (C.runs[2].map.get(r.id) || '') === iso(mC.runs[2].final.get(r.id))) && parse(C.runs[0].lines).changed === 2 && parse(C.runs[1].lines).changed === 1);
  // ---- D: small runs end where one big run ends
  const big = run(FILE, { times: 1, full: false }), n100 = Math.ceil(nChanged / 100) + 1, small = run(FILE, { max: 100, times: n100, full: false }), mS = simulate(all, 100, n100);
  check('small runs (a hundred rows each, ' + n100 + ' of them) end where one big run ends, run by run as the model says', small.runs[n100 - 1].M === big.runs[0].M && small.runs.every((r, k) => parse(r.lines).changed === mS.runs[k].changed && parse(r.lines).still === mS.runs[k].still) && parse(small.runs[n100 - 1].lines).still === 0);
  // ---- E: a day with no upload, and a book that never ran RUN-ME-060
  const E = run(FILE, { from: '2026-12-01', to: '2026-12-02', times: 1, full: false });
  check('a window with no upload in it answers zero everywhere and changes nothing', parse(E.runs[0].lines).deckRows === 0 && parse(E.runs[0].lines).changed === 0 && E.runs[0].M === E.A.M);
  let errText = '';
  try { psql('begin;\ndrop table public.defaulter_date_repair_log;\n' + win(FILE, FIRST, LAST, 100) + '\nrollback;\n'); } catch (e) { errText = e.psql || e.message; }
  check('a book where RUN-ME-060 never ran: the file says so in plain words and changes nothing', /Run db\/RUN-ME-060 first/.test(errText) && !/does not exist/.test(errText), errText.slice(0, 200));

  // ---- broken on purpose: every break must run, and must change the outcome of at least one scenario
  const sigOf = file => [{ max: 1500, times: TIMES, undo: true }, { ...WB, times: 2 }, { ...WC, max: 2, times: 3 }].map(o => {
    const r = run(file, { ...o, full: false });
    return r.runs.map(x => x.M + x.O + x.L + x.lines.map(l => l.join('|')).join('~')).join('#') + (r.U ? r.U.M : '');
  }).join('@@');
  const base = sigOf(FILE);
  const rep = (re, to) => src => sub(src, re, to, String(re));
  const breaks = [
    ['a single repaired row proves an upload (proof 3 -> 1)',                                   rep(/\b3 as proof_rows/, '1 as proof_rows')],
    ['fifty repaired rows are needed to prove an upload (proof 3 -> 50)',                       rep(/\b3 as proof_rows/, '50 as proof_rows')],
    ['it does not matter how few of the upload\'s rows RUN-ME-060 put right (the half dropped)', rep(/\n\s+and 2 \* u\.n_rep >= u\.n_fit/, '')],
    ['the half is a twentieth',                                                                  rep(/2 \* u\.n_rep >= u\.n_fit/, '20 * u.n_rep >= u.n_fit')],
    ['the upload\'s own dates need not show the exchange (the second proof dropped)',            rep(/\n\s+and u\.n_wit >= \(select proof_rows from win\)\)/, ')')],
    ['a date shows the exchange whatever it was as stored (impossible-as-stored dropped)',       rep(/\n\s+and not \(d\.lt0 between d\.dd and d\.day\) and d\.lt0_sw between d\.dd and d\.day\)/, '\n          and d.lt0_sw between d.dd and d.day)')],
    ['a date shows the exchange though the other reading is not possible',                       rep(/ and not \(d\.lt0 between d\.dd and d\.day\) and d\.lt0_sw between d\.dd and d\.day\)/, ' and not (d.lt0 between d.dd and d.day))')],
    ['the second proof does not need the loan\'s dates to fit',                                  rep(/\(d\.fits and d\.lt0 is not null and d\.lt0_sw <> d\.lt0/, '(d.lt0 is not null and d.lt0_sw <> d.lt0')],
    ['rows with no upload number are judged together as one upload',                             rep(/\(u\.batch is not null\n\s+and u\.n_rep/, '(u.n_rep')],
    ['the uploads are told apart by day and kind, not by upload number',                         rep(/v\.batch is not distinct from x\.batch and /, '')],
    ['a row whose loan\'s dates do not fit may be changed',                                      rep(/select c\.\* from cand c where c\.fits and c\.lt0_sw/, 'select c.* from cand c where c.lt0_sw')],
    ['the other reading may be before the Disb date',                                            rep(/c\.lt0_sw between c\.dd and c\.day\n\),/, 'c.lt0_sw <= c.day\n),')],
    ['the other reading may be after the deck\'s day',                                           rep(/c\.lt0_sw between c\.dd and c\.day\n\),/, 'c.lt0_sw >= c.dd\n),')],
    ['a date with no other reading is a candidate',                                              rep(/xv\.swapped and xv\.amb and not xv\.changed/, 'xv.swapped and not xv.changed')],
    ['a changed row can be changed again',                                                       rep(/xv\.swapped and xv\.amb and not xv\.changed/, 'xv.swapped and xv.amb')],
    ['the proof is read from the date as it is NOW, not as it was uploaded',                     rep(/coalesce\(g\.last_trans_old, s\.last_trans_date\) as lt0/, 's.last_trans_date as lt0')],
    ['the day and the month are not exchanged',                                                  rep(/make_date\(extract\(year from z\.lt0\)::int, extract\(day from z\.lt0\)::int, extract\(month from z\.lt0\)::int\)/, 'make_date(extract(year from z.lt0)::int, extract(month from z.lt0)::int, extract(day from z.lt0)::int)')],
    ['a day of twelve is not exchanged',                                                         rep(/extract\(day from z\.lt0\) <= 12 and/, 'extract(day from z.lt0) <= 11 and')],
    ['the days from the Disb date may exceed DAYS ELAPSED by thirty',                            rep(/- s\.days_elapsed between 0 and 3\)/, '- s.days_elapsed between 0 and 30)')],
    ['the days from the Disb date may fall short of DAYS ELAPSED by thirty',                     rep(/- s\.days_elapsed between 0 and 3\)/, '- s.days_elapsed between -30 and 3)')],
    ['the repaired rows are not read from RUN-ME-060\'s log (every row counts as repaired)',     rep(/\(l\.id is not null\) as repaired/, 'true as repaired')],
    ['the rows are not limited',                                                                 rep(/limit \(select max_rows from win\)/, 'limit 100000000')],
    ['the window is ignored',                                                                    rep(/where s\.snapshot_date between win\.from_day and win\.to_day/, 'where true')],
    ['the log keeps nothing',                                                                    rep(/select t\.id, t\.day, t\.typ, t\.ref, t\.batch, t\.lt0, t\.lt0_sw from take t/, 'select t.id, t.day, t.typ, t.ref, t.batch, t.lt0, t.lt0_sw from take t where false')],
    ['the log keeps the new date where the old one belongs',                                     rep(/t\.batch, t\.lt0, t\.lt0_sw from take t/, 't.batch, t.lt0_sw, t.lt0 from take t')],
    ['the change is made to the wrong column',                                                   rep(/update public\.defaulter_snapshots s set last_trans_date = t\.lt0_sw/, 'update public.defaulter_snapshots s set expire_date = t.lt0_sw')],
    ['the answer counts the wrong rows as still to do',                                          rep(/to_char\(\(select count\(\*\) from ok\) - \(select count\(\*\) from upd\), 'FM999,999,999'\)/, "to_char((select count(*) from ok), 'FM999,999,999')")],
    ['the answer\'s verdict of an upload is not the rule\'s',                                    rep(/when v\.swapped then 'SWAPPED'/, "when v.n_rep >= 0 then 'SWAPPED'")],
  ];
  let notCaught = 0;
  for (const [name, fn] of breaks) {
    let broken = null, why = '';
    try { broken = fn(FILE); } catch (err) { why = err.message; }
    let sig = null;
    if (broken !== null) { try { sig = sigOf(broken); } catch (err) { why = 'the broken file does not run: ' + err.message.slice(0, 200); } }
    const ok = sig !== null && sig !== base;
    if (!ok) notCaught++;
    check('BROKEN ON PURPOSE, the outcome changes: ' + name, ok, why || 'the outcome is the same as the file\'s');
  }
  console.log('\n' + (fails.length ? fails.length + ' FAILED' : 'all passed') + ' (' + breaks.length + ' breaks, ' + (breaks.length - notCaught) + ' caught)');
  exitCode = fails.length ? 1 : 0;
} finally {
  try { psql('drop database if exists ' + DB, admin); } catch { /* leave it */ }
}
process.exit(exitCode);
