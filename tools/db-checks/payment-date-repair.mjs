/* THE RECEIVED PAYMENTS READ THE WRONG WAY ROUND, PUT RIGHT BY THE UPLOAD'S OWN TIME -- db/RUN-ME-065, run for real on a PostgreSQL.

     "Repair everything that's wrong brother ... we have transactions dates at received" -- the owner, 17 Nov 2026

   db/RUN-ME-065-repair-swapped-payment-dates.sql changes `paid_at` of received_payments, and of the copies of those payments in
   notice_payment_ledger, where the upload's own time proves the day and the month were exchanged. It writes to the book, so it is not believed on a reading:
   this check runs it on the WHOLE of db/schema.sql (the real tables, the real types) with every case the rule has to tell apart, and compares the
   outcome ROW BY ROW with a model of the rule written again in JavaScript.

   The uploads it builds: a day's file of `11/10/2026` read day-first (stored 11 October) in two slices written in different minutes; a right file; a right file with a
   late payment in it and with a row that would fit the other way round (it carries evidence, so it was read right); a one-row swapped file whose stored date is in the FUTURE
   (12 November stored as 11 December); a swapped file with three rows whose day and month are the same; a file with rows that fit as stored AND rows that fit only the other
   way round (inconsistent: left alone); a swapped file whose other reading is nowhere near the upload day; an upload written at 01:00 East Africa time that is the day
   before in UTC; a stored date with a day of exactly twelve; the edges of both windows; rows with no date; and forty random uploads, right and swapped. The ledger has copies
   of repaired payments, a copy whose date somebody already corrected by hand, a copy of a payment that was pruned, and a copy of a payment that was right.

   It passes only when: every payment's `paid_at` after the run equals the model's, and only `paid_at` changed; the ledger's copies equal the model's; the answer's numbers
   equal the model's (put right now, put right in all, still outside the fortnight, the eight examples in order); a second run changes nothing; the file's own undo puts every
   row back (byte for byte); a book WITHOUT the ledger table is repaired all the same; and EVERY one of a list of deliberate breaks of the file (a window moved, a condition dropped,
   the date in the wrong time zone, the uploads not told apart, the log not kept) changes the outcome or makes the file fail -- a check that cannot fail when the file is broken
   proves nothing, and says so.

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/payment-date-repair.mjs

   NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-065-repair-swapped-payment-dates.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
const SEP = '\x1f', DAY = 86400000;
const psql = sql => {
  try { return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', SEP, '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error('psql failed: ' + String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 3).join(' | ')); }
};
let seed = 20261117;                                               // mulberry32
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const D = s => Date.parse(s + 'T00:00:00Z');
const iso = t => (t == null ? null : new Date(t).toISOString().slice(0, 10));
const swap = t => { if (t == null) return t; const d = new Date(t), m = d.getUTCMonth() + 1, dd = d.getUTCDate(); return (dd <= 12 && m !== dd) ? Date.UTC(d.getUTCFullYear(), dd - 1, m) : t; };
const eatDay = ms => { const d = new Date(ms + 3 * 3600000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const uid = n => String(n).padStart(8, '0') + '-0000-4000-8000-000000000000';          // the counter first: the answer shows the first eight characters of an id

// ---- the book: payments, with the upload each was written by (created_at), and the ledger's copies
function book() {
  const pay = [], led = []; let n = 0;
  const add = (created, paid, extra = {}) => { pay.push({ id: uid(++n), createdMs: Date.parse(created), created, paid: paid == null ? null : D(paid), ...extra }); return n; };
  const many = (created, paid, k) => Array.from({ length: k }, () => add(created, paid));
  // a day's file of 11/10/2026 read day-first, in two slices written in different minutes (the nulls are in the first one)
  const g1 = many('2026-11-10 08:00:30+03', '2026-10-11', 50); add('2026-11-10 08:00:30+03', null); add('2026-11-10 08:00:30+03', null);
  many('2026-11-10 08:01:10+03', '2026-10-11', 20);
  // a right file, with the edges of the fortnight (the 14th day before the upload, the day after it)
  const g2 = many('2026-11-12 08:00:10+03', '2026-11-12', 30); many('2026-11-12 08:00:10+03', '2026-11-11', 10); many('2026-11-12 08:00:10+03', '2026-10-29', 1); many('2026-11-12 08:00:10+03', '2026-11-13', 1);
  // a right file that has a late payment, and a row that would fit the other way round: it has rows with a day over twelve, so it was read by its order
  many('2026-11-13 09:00:10+03', '2026-11-13', 10); many('2026-11-13 09:00:10+03', '2026-10-12', 1); many('2026-11-13 09:00:10+03', '2026-10-11', 1);
  many('2026-11-14 10:00:00+03', '2026-12-11', 1);                                           // 12 November stored as 11 December: in the future
  many('2026-11-11 12:00:05+03', '2026-10-11', 5); many('2026-11-11 12:00:05+03', '2026-11-11', 3);   // three rows whose day and month are the same
  many('2026-11-15 11:00:05+03', '2026-11-09', 4); many('2026-11-15 11:00:05+03', '2026-10-11', 4);   // inconsistent: rows that fit as stored and rows that fit only the other way
  many('2026-11-16 08:00:00+03', '2026-04-05', 3);                                           // the other reading is nowhere near the upload day
  many('2026-10-10 22:00:00+00', '2026-11-10', 2);                                           // written at 01:00 East Africa time on the 11th: the day before in UTC
  many('2026-12-10 09:00:00+03', '2026-10-12', 2);                                           // a stored day of exactly twelve (10 December stored as 12 October)
  many('2026-11-17 08:00:00+03', '2026-10-11', 1); many('2026-11-17 08:00:00+03', '2026-09-11', 1);   // the other reading exactly 7 days before the upload, and 8
  many('2026-11-12 18:00:00+03', '2026-12-11', 1);                                           // the other reading exactly on the upload day
  many('2026-11-17 14:00:00+03', '2026-11-07', 1); many('2026-11-17 14:00:00+03', '2026-10-11', 1);     // a row 10 days old that fits as stored (so the upload was read right) and one that would fit the other way
  many('2026-11-09 08:00:00+03', '2026-11-10', 1); many('2026-11-09 08:00:00+03', '2026-09-11', 1);       // a row the day AFTER the upload fits as stored, and one that fits the other way on the upload day
  many('2026-11-09 12:00:00+03', '2026-08-11', 2); many('2026-11-09 12:00:00+03', '2026-10-11', 1);       // swapped rows, and a row whose other reading is the day AFTER the upload (not repaired)
  // forty uploads, right and swapped, each in a minute of its own
  for (let u = 0; u < 40; u++) {
    const upMs = D('2026-10-20') + Math.floor(rnd() * 28) * DAY, created = new Date(upMs + (3 * 3600 + u * 120) * 1000).toISOString().replace('T', ' ').replace('.000Z', '+00');
    const upDay = new Date(upMs + 3 * 3600000).getUTCDate(), k = 3 + Math.floor(rnd() * 12);
    const swapped = rnd() < 0.4 && upDay <= 12 && upDay > 1;
    for (let i = 0; i < k; i++) {
      const back = swapped ? (upDay > 2 && rnd() < 0.5 ? 1 : 0) : Math.floor(rnd() * 5);
      const real = eatDay(upMs) - back * DAY;
      add(created, iso(swapped ? swap(real) : real));
    }
  }
  // the ledger: copies of payments, each with the date it was copied with
  for (const id of g1.slice(0, 3)) led.push({ ref: 'L' + id, since: '2026-10-01', payment_id: uid(id), paid: D('2026-10-11') });              // copied with the swapped date: put right
  led.push({ ref: 'LX1', since: '2026-10-01', payment_id: uid(g1[3]), paid: D('2026-11-05') });                                              // already corrected by hand: left alone
  led.push({ ref: 'LX2', since: '2026-10-01', payment_id: uid(9999), paid: D('2026-10-11') });                                               // a payment that was pruned: left alone
  led.push({ ref: 'LX3', since: '2026-10-01', payment_id: uid(g2[0]), paid: D('2026-11-12') });                                              // a payment that was right
  return { pay, led };
}

// ---- the rule, written again (not the SQL): the model
function model(b) {
  const rows = b.pay.filter(r => r.paid != null).map(r => {
    const up = eatDay(r.createdMs), d = r.paid, dsw = swap(d), amb = d !== dsw;
    return { ...r, d, up, dsw, amb, unamb: new Date(d).getUTCDate() > 12, grp: Math.floor(r.createdMs / 60000),
             fits: d >= up - 14 * DAY && d <= up + DAY, fitsSw: amb && dsw >= up - 7 * DAY && dsw <= up };
  });
  const g = new Map();
  for (const r of rows) { const o = g.get(r.grp) || { unamb: 0, ambFit: 0, sw: 0 }; if (r.unamb) o.unamb++; if (r.amb && r.fits) o.ambFit++; if (r.amb && !r.fits && r.fitsSw) o.sw++; g.set(r.grp, o); }
  const take = rows.filter(r => { const o = g.get(r.grp); return o.unamb === 0 && o.ambFit === 0 && o.sw >= 1 && r.amb && !r.fits && r.fitsSw; });
  const fixed = new Map(take.map(r => [r.id, r]));
  const after = new Map(b.pay.map(r => [r.id, fixed.has(r.id) ? fixed.get(r.id).dsw : r.paid]));
  const ledAfter = b.led.map(l => { const t = fixed.get(l.payment_id); return t && l.paid === t.d ? t.dsw : l.paid; });
  const outside = [...after.entries()].filter(([id, p]) => { if (p == null) return false; const r = b.pay.find(x => x.id === id), up = eatDay(r.createdMs); return !(p >= up - 14 * DAY && p <= up + DAY); }).length;
  const ledChanged = b.led.filter((l, i) => ledAfter[i] !== l.paid).length;
  const examples = take.slice().sort((a, c) => c.up - a.up || (a.id < c.id ? -1 : 1)).slice(0, 8).map(r => ({ id: r.id, old: iso(r.d), now: iso(r.dsw), up: iso(r.up) }));
  return { take, after, ledAfter, outside, ledChanged, examples, total: rows.length };
}

// ---- the database
const SQL_IDS = b => b.pay.map(r => `('${r.id}', ${r.paid == null ? 'null' : `date '${iso(r.paid)}'`}, 'T1', ${100 + ((r.id.slice(0, 8) | 0) % 900)}, timestamptz '${r.created}')`).join(',\n');
const SETUP = (b, { ledger = true } = {}) => `begin;
${SCHEMA}
insert into public.teams (team) values ('T1');
insert into public.received_payments (id, paid_at, team, amount_paid, created_at) values
${SQL_IDS(b)};
${ledger ? `insert into public.notice_payment_ledger (ref, since, payment_id, paid_at, amount) values
${b.led.map(l => `('${l.ref}', date '${l.since}', '${l.payment_id}', date '${iso(l.paid)}', 1000)`).join(',\n')};` : 'drop table public.notice_payment_ledger;'}
`;
const STATE = (ledger = true) => `select 'P' || chr(31) || id || chr(31) || coalesce(paid_at::text, '') from public.received_payments order by id;
select 'O' || chr(31) || md5(coalesce(string_agg(id::text || coalesce(team, '') || coalesce(amount_paid::text, '') || created_at::text, '|' order by id), '')) from public.received_payments;
${ledger ? `select 'L' || chr(31) || ref || chr(31) || coalesce(paid_at::text, '') from public.notice_payment_ledger order by ref;
select 'M' || chr(31) || md5(coalesce(string_agg(ref || since::text || payment_id::text || amount::text, '|' order by ref), '')) from public.notice_payment_ledger;` : ''}
select 'G' || chr(31) || count(*) from public.payment_date_repair_log where false;
`;
const undoOf = file => file.split('\n').filter(l => /^-- (update public\.received_payments|update public\.notice_payment_ledger)/.test(l)).map(l => l.replace(/^-- /, '')).join('\n');
function run(file, b, { ledger = true, twice = false, undo = false } = {}) {
  const logCount = `select 'C' || chr(31) || count(*) from public.payment_date_repair_log;\n`;
  const out = psql(SETUP(b, { ledger }) + STATE(ledger).replace(/select 'G'[^\n]*\n/, '') + file + '\n' + logCount + STATE(ledger).replace(/select 'G'[^\n]*\n/, '')
    + (twice ? file + '\n' + logCount + STATE(ledger).replace(/select 'G'[^\n]*\n/, '') : '')
    + (undo ? undoOf(file) + '\n' + STATE(ledger).replace(/select 'G'[^\n]*\n/, '') : '') + 'rollback;\n').trim().split('\n');
  const take = tag => out.filter(l => l.startsWith(tag + SEP)).map(l => l.split(SEP).slice(1));
  const P = take('P'), O = take('O'), Lr = take('L'), M = take('M'), C = take('C');
  const grid = out.filter(l => !/^[POLMCG]\x1f/.test(l) && l.includes(SEP)).map(l => { const i = l.indexOf(SEP); return [l.slice(0, i), l.slice(i + 1)]; });
  const np = b.pay.length, nl = ledger ? b.led.length : 0;
  const pick = (arr, k, size) => arr.slice(k * size, (k + 1) * size);
  return { grid, P0: pick(P, 0, np), P1: pick(P, 1, np), P2: twice ? pick(P, 2, np) : null, P3: undo ? pick(P, twice ? 3 : 2, np) : null,
           O: O.map(x => x[0]), L0: pick(Lr, 0, nl), L1: pick(Lr, 1, nl), L3: undo ? pick(Lr, twice ? 3 : 2, nl) : null, M: M.map(x => x[0]), C: C.map(x => Number(x[0])) };
}
const nums = s => (s.match(/\d[\d,]*/g) || []).map(x => Number(x.replace(/,/g, '')));
const line = (grid, prefix) => { const g = grid.find(([w]) => w.startsWith(prefix)); return g ? g[1] : null; };
const fails = [];
const check = (name, ok, extra) => { if (!ok) fails.push(name + (extra ? ' -- ' + extra : '')); console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok || !extra ? '' : ' -- ' + extra)); };

const B = book(), W = model(B);
const A = run(FILE, B, { twice: true, undo: true });
{
  const afterDb = new Map(A.P1.map(([id, p]) => [id, p]));
  let bad = 0, shown = 0;
  for (const r of B.pay) { const want = iso(W.after.get(r.id)) || '', got = afterDb.get(r.id); if (got !== want) { bad++; if (shown++ < 3) console.log('   ' + r.id.slice(-4) + ' got ' + got + ' want ' + want); } }
  check('every payment\'s date after the run equals the model\'s (' + B.pay.length + ' payments, ' + W.take.length + ' put right)', bad === 0, bad + ' differ');
  check('the hand-made uploads are all there to be found', W.take.length >= 100 && W.after.size === B.pay.length && W.examples.length === 8 && W.outside >= 8, JSON.stringify({ take: W.take.length, out: W.outside }));
  check('only paid_at changed on the payments', A.O.length >= 3 && A.O[0] === A.O[1], '');
  const ledDb = new Map(A.L1.map(([ref, p]) => [ref, p]));
  check('the ledger\'s copies equal the model\'s (' + W.ledChanged + ' put right; one corrected by hand, one pruned, one right left alone)', B.led.every((l, i) => ledDb.get(l.ref) === iso(W.ledAfter[i])) && W.ledChanged === 3, A.L1.map(x => x.join(':')).join(' '));
  check('and nothing but their date changed in the ledger', A.M.length >= 3 && A.M[0] === A.M[1], '');
  const a2 = line(A.grid, 'put right by THIS run');
  check('the answer says how many were put right by this run: payments / ledger copies', nums(a2)[0] === W.take.length && nums(a2)[1] === W.ledChanged, a2);
  check('the answer says how many are still outside their upload\'s fortnight', nums(line(A.grid, 'payments still dated outside'))[0] === W.outside, line(A.grid, 'payments still dated outside'));
  check('the answer counts the payments with a date', nums(line(A.grid, 'payments in the book'))[0] === W.total, '');
  const ex = A.grid.filter(([w]) => w.startsWith('    e.g. payment ')).map(([w, a]) => [w.slice(17), a]).slice(0, 8);         // the first run's report (the grid holds the second run's too)
  check('the eight examples are the latest uploads first, with the date they had and the date they have', ex.length === 8 && ex.every(([k, a], i) => k === W.examples[i].id.slice(0, 8) && a === `${W.examples[i].old} -> ${W.examples[i].now} (uploaded ${W.examples[i].up})`), 'db: ' + ex.map(x => x.join(' ')).slice(0, 3).join(' | ') + '  model: ' + W.examples.slice(0, 3).map(e => e.id.slice(0, 8) + ' ' + e.old + ' -> ' + e.now + ' (uploaded ' + e.up + ')').join(' | '));
  check('a second run changes nothing (a repaired row fits as stored and is never a candidate again)', A.P2.map(x => x.join()).join() === A.P1.map(x => x.join()).join() && A.C[0] === A.C[1], A.C.join());
  check('the log has one line for each payment and each ledger copy put right', A.C[0] === W.take.length + W.ledChanged, A.C[0] + ' vs ' + (W.take.length + W.ledChanged));
  check('the file\'s own undo puts every payment and every ledger copy back, byte for byte', A.P3.map(x => x.join()).join() === A.P0.map(x => x.join()).join() && A.L3.map(x => x.join()).join() === A.L0.map(x => x.join()).join(), '');
  console.log('      ' + B.pay.length + ' payments in ' + new Set(B.pay.map(r => Math.floor(r.createdMs / 60000))).size + ' uploads');
}
{ // a book without the ledger table is repaired all the same
  const r = run(FILE, B, { ledger: false });
  const afterDb = new Map(r.P1.map(([id, p]) => [id, p]));
  check('a book WITHOUT notice_payment_ledger is repaired all the same (the ledger step is skipped)', B.pay.every(x => afterDb.get(x.id) === (iso(W.after.get(x.id)) || '')) && nums(line(r.grid, 'put right by THIS run'))[0] === W.take.length && nums(line(r.grid, 'put right by THIS run'))[1] === 0, '');
}
// ---- broken on purpose
{
  const sig = r => r.P1.map(x => x.join()).join('|') + '#' + r.L1.map(x => x.join()).join('|') + '#' + r.C.join() + '#' + r.grid.map(x => x.join()).join('|') + '#' + (r.P2 || []).map(x => x.join()).join('|');
  const base = sig(A);
  const all = (re, to) => src => src.replace(re, to);
  const breaks = [
    ['the fortnight behind the upload is a week',                        all(/p\.d between p\.up - 14 and p\.up \+ 1/, 'p.d between p.up - 7 and p.up + 1')],
    ['a payment a day after the upload is not as stored',                all(/p\.d between p\.up - 14 and p\.up \+ 1/, 'p.d between p.up - 14 and p.up')],
    ['the other reading may be a fortnight behind the upload',           all(/p\.d_sw between p\.up - 7 and p\.up\)/, 'p.d_sw between p.up - 14 and p.up)')],
    ['the other reading may be on the day after the upload',             all(/p\.d_sw between p\.up - 7 and p\.up\)/, 'p.d_sw between p.up - 7 and p.up + 1)')],
    ['the other reading may not be on the upload day itself',            all(/p\.d_sw between p\.up - 7 and p\.up\)/, 'p.d_sw between p.up - 7 and p.up - 1)')],
    ['an upload with a day over twelve in it may be a swapped one',      all(/g\.n_unamb = 0 and /, '')],
    ['an upload with an ambiguous row that fits as stored may be a swapped one', all(/g\.n_amb_fit = 0 and /, '')],
    ['an upload needs two rows that fit the other way round',            all(/g\.n_sw >= 1/, 'g.n_sw >= 2')],
    ['the uploads are told apart by the day, not the minute',            all(/date_trunc\('minute', r\.created_at\)/, "date_trunc('day', r.created_at)")],
    ['the upload\'s day is the UTC day',                                 all(/\(r\.created_at at time zone 'Africa\/Dar_es_Salaam'\)::date as up/, '(r.created_at at time zone \'UTC\')::date as up')],
    ['a stored day of twelve is not swapped',                            all(/extract\(day from r\.paid_at\) <= 12 and/, 'extract(day from r.paid_at) <= 11 and')],
    ['the date is not exchanged',                                        all(/make_date\(extract\(year from r\.paid_at\)::int, extract\(day from r\.paid_at\)::int, extract\(month from r\.paid_at\)::int\)/, 'r.paid_at')],
    ['a row whose day and month are the same counts as ambiguous',       all(/\(p\.d <> p\.d_sw\)\s+as amb/, '(true) as amb')],
    ['the log is not kept',                                              all(/on conflict \(source, row_key\) do nothing                  -- a row's FIRST log line keeps the date it was uploaded with\n  returning 1/, 'on conflict (source, row_key) do nothing\n  returning 1 offset 1000000')],
    ['the ledger is not put right',                                      all(/update public\.notice_payment_ledger l set paid_at = g\.paid_new/, 'update public.notice_payment_ledger l set paid_at = l.paid_at')],
    ['the ledger copy corrected by hand is overwritten',                 all(/ and l\.paid_at = g\.paid_old and g\.paid_old <> g\.paid_new;/, ' and g.paid_old <> g.paid_new;')],
    ['the ledger step fails when the ledger is missing',                 all(/if to_regclass\('public\.notice_payment_ledger'\) is not null then/, 'if true then')],
    ['the answer counts the wrong source',                               all(/where source = 'ledger' and repaired_at = now\(\)\), 'FM999,999,999'\)/, "where source = 'payment' and repaired_at = now()), 'FM999,999,999')")],
  ];
  for (const [name, fn] of breaks) {
    const broken = fn(FILE);
    if (broken === FILE) { check('(break "' + name + '" was applied)', false, 'the pattern is not in the file any more'); continue; }
    let differs = false;
    try { differs = sig(run(broken, B, { twice: true })) !== base; } catch (err) { differs = true; }
    if (!differs) { try { const noLedger = run(broken, B, { ledger: false }); differs = !B.pay.every(x => new Map(noLedger.P1.map(([id, p]) => [id, p])).get(x.id) === (iso(W.after.get(x.id)) || '')); } catch (err) { differs = true; } }
    check('BROKEN ON PURPOSE, the outcome changes: ' + name, differs);
  }
}
// Not breakable, and not broken here on purpose: `f.amb` in the last line of `take` (fits_sw already needs it), and the guard `r.paid_at = t.d` of the update (it only matters when a
// payment is changed by somebody else between the read and the write: one statement, one snapshot).
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
