/* THE FOLLOW-UP LIST'S DATES -- db/RUN-ME-062, run for real on a PostgreSQL.

     "In the defaulter followup nav, try check if there exists any future date than today in the disb date
      column to confirm all dates are okay" -- the owner, 16 Nov 2026

   db/RUN-ME-062-followup-list-dates-read-only.sql reads the register behind the Follow-up tab (followup_status) and says how many
   Disb dates are later than today, whether a swap of day and month explains them, and -- the test that confirms -- how many
   rows' Disb date fit their own DAYS ELAPSED on the day of the deck that wrote them. It is not believed on a reading.

   THE TABLE IS THE REAL ONE. The check does not declare a table of its own (RUN-ME-061 stopped on the owner's keyboard because
   the check's `upload_batch` was text and the real column is a uuid): it runs the create table blocks of `teams` and
   `followup_status` out of db/schema.sql, and the optional migration that adds deck_date (db/migrations/2026-08-04-followup-
   deck-date.sql) exactly as they stand, then fills the table the way the importers left it: a Current deck's rows read day-first
   by the old importer (every date whose two numbers were twelve or under swapped), rows read right, and rows meant to fool the
   file (a day that is today, a day that is tomorrow, a date no swap explains, a placeholder with a future date, a row with no
   stamp, no date, no DAYS ELAPSED, an offset just inside and just outside the 0-to-3 window, a status with no arrears and
   arrears with no status).

   It passes only when: every line the file prints equals the count made in JavaScript from the same rows (the numbers, the
   dates, the examples in order, the days of the decks); the verdict says what it must in a swapped book, in a swapped book with
   no future date, in a clean book, and on a book without the deck_date column; no name or number of a customer is printed; the
   book is byte-for-byte unchanged afterwards (it is read-only); the file with its own today expression runs; and EVERY one of a
   list of deliberate breaks of the file (a boundary moved, a filter dropped, a window widened) changes the answer -- a check
   that cannot fail when the file is broken proves nothing, and says so.

   It needs a PostgreSQL it can reach with psql and no public.followup_status or public.teams in it: the tables are created inside
   one transaction and the whole case is rolled back:

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/followup-dates-audit.mjs
       (LOANS=3000 by default; LOANS=60000 TIME_ONLY=1 times the file on a register of the live book's size and stops after the first
        register; SHOW=1 prints what the owner would see)

   NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-062-followup-list-dates-read-only.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'db/migrations/2026-08-04-followup-deck-date.sql'), 'utf8');
const LOANS = Number(process.env.LOANS || 3000);
const SEP = '\x1f', DAY = 86400000, TODAY = '2026-11-17';
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
const DDL_TEAMS = block('teams'), DDL_FOLLOWUP = block('followup_status');

let seed = 20261117;                                               // mulberry32: every draw uses all 32 bits
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const D = s => Date.parse(s + 'T00:00:00Z');
const iso = t => (t == null ? '' : new Date(t).toISOString().slice(0, 10));
const swap = t => { if (t == null) return t; const d = new Date(t), m = d.getUTCMonth() + 1, dd = d.getUTCDate(); return (dd <= 12 && m !== dd) ? Date.UTC(d.getUTCFullYear(), dd - 1, m) : t; };   // what the old importer stored for a date
const TODAY_MS = D(TODAY);

// ---- the book. A row is what the register holds: the importers' output, not the truth.
//      opts.swapped: the old importer read the file day-first for 80% of rows (the loan system's Excel files); opts.future: the rows
//      that land in the future are kept; opts.specials: the hand-made rows meant to fool the file
function book({ swapped = true, future = true, specials = true } = {}) {
  const rows = [];
  const add = r => rows.push({ team: 'TEAM ' + (rows.length % 7), status: 'CHRONIC', arrears: 50000, n: null, lt: null, stamp: null, d: null, ...r, ref: r.ref });
  for (let i = 0; i < LOANS; i++) {
    let L = D('2024-01-01') + Math.floor(rnd() * ((D('2026-08-05') - D('2024-01-01')) / DAY)) * DAY;
    if (!future && new Date(L).getUTCDate() === 12) L += DAY;                              // the 12th is the one day whose swap lands in the future
    const stamp = D('2026-11-05') + Math.floor(rnd() * 12) * DAY;                           // twelve deck days: only the newest ten are listed
    const off = 1 + Math.floor(rnd() * 2);
    const route = swapped && rnd() < 0.8 ? 'X' : 'R';
    const LTr = stamp - (1 + Math.floor(rnd() * 60)) * DAY;
    let n = Math.round((stamp - L) / DAY) - off, kind = 'normal'; const x = rnd();
    if (x < 0.02) { kind = 'neither'; n += 100; }
    else if (x < 0.04) kind = 'nostamp';
    else if (x < 0.05) kind = 'nodate';
    else if (x < 0.06) kind = 'nodays';
    else if (x < 0.08) kind = 'hidden';                                                     // a placeholder: no status and no arrears
    const row = { ref: 'R' + String(i).padStart(6, '0'), d: route === 'X' ? swap(L) : L, lt: route === 'X' ? swap(LTr) : LTr, n, stamp };
    if (!future && row.lt != null && row.lt > TODAY_MS) row.lt = LTr;
    if (kind === 'nostamp') row.stamp = null;
    if (kind === 'nodate') row.d = null;
    if (kind === 'nodays') row.n = null;
    if (kind === 'hidden') { row.status = null; row.arrears = null; }
    else if (i % 97 === 0) row.status = null;                                              // arrears, no status: still shown by the tab
    else if (i % 89 === 0) row.arrears = null;                                             // status, no arrears: still shown
    add(row);
  }
  if (specials) {
    const S = D('2026-11-16');
    const off = (L, o) => Math.round((S - L) / DAY) - o;
    if (future) {
      add({ ref: 'S01', d: swap(D('2026-01-12')), n: off(D('2026-01-12'), 1), stamp: S });  // 12 Jan stored as 1 Dec: future, a swap explains it
      add({ ref: 'S02', d: D('2026-12-25'), n: 120, stamp: S });                             // the day is over 12: no swap
      add({ ref: 'S03', d: D('2026-12-12'), n: 120, stamp: S });                             // day = month: the swap is the same date
      add({ ref: 'S04', d: D('2027-03-05'), n: 120, stamp: S });                             // the swap is future too
      add({ ref: 'S06', d: TODAY_MS + DAY, n: 120, stamp: S });                              // tomorrow
      add({ ref: 'S07', d: swap(D('2026-02-12')), status: null, arrears: null, n: 100, stamp: S });   // a placeholder: not on the tab
      add({ ref: 'S08', d: D('2026-12-30'), n: null, stamp: null });                          // future and not testable
      add({ ref: 'S09', d: D('2025-05-05'), lt: TODAY_MS + DAY, n: off(D('2025-05-05'), 1), stamp: S });  // last trans tomorrow
      add({ ref: 'S10', d: D('2025-05-06'), lt: TODAY_MS + 5 * DAY, status: null, arrears: null, n: 1, stamp: S });
    }
    add({ ref: 'S05', d: TODAY_MS, n: 120, stamp: S });                                     // today is not later than today
    add({ ref: 'S11', d: D('2025-05-07'), lt: TODAY_MS, n: off(D('2025-05-07'), 1), stamp: S });   // last trans today is not later
    for (const o of [-1, 0, 1, 2, 3, 4]) add({ ref: 'W' + (o + 1), d: D('2025-06-20'), n: off(D('2025-06-20'), o), stamp: S });   // the window's edges (the 20th: no swap)
  }
  return rows;
}

// ---- what the file must print, counted in JavaScript from the stored rows (not from the SQL)
const fmt = n => n.toLocaleString('en-US');
function expectOf(rows) {
  const shown = r => r.status != null || r.arrears != null;
  const sh = rows.filter(shown), dated = sh.filter(r => r.d != null);
  const e = { shown: sh.length, dated: dated.length, dmin: null, dmax: null, future: 0, fmin: null, fmax: null, futureSwap: 0, lt: 0, ltFuture: 0, hiddenFuture: 0, tested: 0, fit: 0, swapped: 0, neither: 0, untested: 0, days: [], examples: [] };
  for (const r of dated) { if (e.dmin == null || r.d < e.dmin) e.dmin = r.d; if (e.dmax == null || r.d > e.dmax) e.dmax = r.d; }
  const fut = dated.filter(r => r.d > TODAY_MS);
  e.future = fut.length;
  for (const r of fut) { if (e.fmin == null || r.d < e.fmin) e.fmin = r.d; if (e.fmax == null || r.d > e.fmax) e.fmax = r.d; if (swap(r.d) <= TODAY_MS) e.futureSwap++; }
  e.lt = sh.filter(r => r.lt != null).length; e.ltFuture = sh.filter(r => r.lt != null && r.lt > TODAY_MS).length;
  e.hiddenFuture = rows.filter(r => !shown(r) && r.d != null && r.d > TODAY_MS).length;
  const byDay = new Map();
  for (const r of sh) {
    if (!(r.stamp != null && r.d != null && r.n != null)) { e.untested++; continue; }
    e.tested++;
    const fits = x => { const v = Math.round((r.stamp - x) / DAY) - r.n; return v >= 0 && v <= 3; };
    const kind = fits(r.d) ? 'fit' : fits(swap(r.d)) ? 'swapped' : 'neither';
    e[kind]++;
    const o = byDay.get(r.stamp) || { rows: 0, fit: 0, swapped: 0, neither: 0 }; o.rows++; o[kind]++; byDay.set(r.stamp, o);
  }
  e.days = [...byDay.entries()].sort((a, b) => b[0] - a[0]).slice(0, 10).map(([s, o]) => ({ day: iso(s), ...o }));
  e.examples = fut.slice().sort((a, b) => b.d - a.d || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)).slice(0, 8).map(r => r.ref);
  return e;
}

// ---- the database
const setup = (rows, { stamp = true } = {}) => {
  const teams = [...new Set(rows.map(r => r.team))];
  const cols = ['ref', 'team', 'full_name', 'status', 'arrears', 'disb_date', 'last_trans', 'days_elapsed'].concat(stamp ? ['deck_date'] : []);
  const csv = rows.map(r => [r.ref, r.team, 'NAME-' + r.ref, r.status == null ? '' : r.status, r.arrears == null ? '' : r.arrears, iso(r.d), iso(r.lt), r.n == null ? '' : r.n].concat(stamp ? [iso(r.stamp)] : []).join(',')).join('\n');
  return `begin;
${DDL_TEAMS}
${DDL_FOLLOWUP}
${stamp ? MIGRATION : ''}
insert into public.teams (team) values ${teams.map(t => `('${t}')`).join(', ')};
copy public.followup_status (${cols.join(', ')}) from stdin with (format csv, null '');
${csv}
\\.
analyze public.followup_status;
`;
};
const SUM = `select md5(coalesce(string_agg(to_jsonb(f)::text, '|' order by ref), '')), count(*) from public.followup_status f;`;
const withToday = file => file.replace(/\(now\(\) at time zone 'Africa\/Dar_es_Salaam'\)::date as today/, `date '${TODAY}' as today`);
const run = (file, rows, opts) => {
  const STAMP = `select 'T' || chr(31) || extract(epoch from clock_timestamp());\n`;
  const out = psql(setup(rows, opts) + SUM + '\n' + STAMP + file + '\n' + STAMP + SUM + '\nrollback;\n').trim().split('\n');
  const stamps = out.filter(l => l.startsWith('T' + SEP)).map(l => Number(l.split(SEP)[1]));
  const sums = out.filter(l => /^[0-9a-f]{32}/.test(l));
  const grid = out.filter(l => !l.startsWith('T' + SEP) && !/^[0-9a-f]{32}/.test(l) && l.includes(SEP)).map(l => { const i = l.indexOf(SEP); return [l.slice(0, i), l.slice(i + 1)]; });
  return { grid, ms: Math.round((stamps[1] - stamps[0]) * 1000), same: sums.length === 2 && sums[0] === sums[1] };
};
const line = (grid, prefix) => { const g = grid.find(([w]) => w.startsWith(prefix)); return g ? g[1] : null; };
const first = s => (s == null ? NaN : Number((s.match(/^[\d,]+/) || ['NaN'])[0].replace(/,/g, '')));
const nums = s => (s.match(/\d[\d,]*/g) || []).map(x => Number(x.replace(/,/g, '')));

const fails = [];
const check = (name, ok, extra) => { if (!ok) fails.push(name + (extra ? ' -- ' + extra : '')); console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok || !extra ? '' : ' -- ' + extra)); };

// every number, date and example the file prints, against the count made in JavaScript
function compare(label, grid, rows, { stamped = true } = {}) {
  const e = expectOf(rows), bad = [];
  const eq = (what, got, want) => { if (got !== want) bad.push(what + ': got ' + got + ', want ' + want); };
  eq('today', line(grid, 'today'), '2026-11-17 Tue');
  const l2 = line(grid, 'the list the tab shows');
  eq('shown', first(l2), e.shown); eq('dated', nums(l2)[1], e.dated);
  eq('dates run', (l2.match(/from (\d{4}-\d\d-\d\d) to (\d{4}-\d\d-\d\d)/) || []).slice(1).join(' '), e.dated ? iso(e.dmin) + ' ' + iso(e.dmax) : '');
  const q1 = line(grid, 'Q1');
  eq('Q1 later than today', first(q1), e.future);
  if (e.future) eq('Q1 earliest/latest', (q1.match(/earliest (\S+), latest (\S+)\)/) || []).slice(1).join(' '), iso(e.fmin) + ' ' + iso(e.fmax));
  eq('swap explains', first(line(grid, '    of those: a swap')), e.futureSwap);
  eq('no swap explains', first(line(grid, '    of those: no swap')), e.future - e.futureSwap);
  const lt = line(grid, 'Last trans'); eq('last trans later', first(lt), e.ltFuture); eq('last trans of', nums(lt)[1], e.lt);
  eq('hidden future', first(line(grid, 'rows the tab does NOT list')), e.hiddenFuture);
  eq('has the stamp column', line(grid, 'the register has the deck stamp').startsWith('yes'), stamped);
  eq('tested', first(line(grid, 'Q2')), e.tested);
  eq('fit as stored', first(line(grid, '    fit as stored')), e.fit);
  eq('fit only swapped', first(line(grid, '    fit ONLY')), e.swapped);
  eq('fit neither', first(line(grid, '    fit neither')), e.neither);
  eq('not tested', first(line(grid, '    not tested')), e.untested);
  const days = grid.filter(([w]) => w.startsWith('    deck of '));
  eq('deck days listed', days.length, e.days.length);
  e.days.forEach((d, i) => {
    const g = days[i]; if (!g) return;
    eq('deck day ' + i, g[0].slice(12, 22), d.day); eq('deck day ' + d.day + ' counts', nums(g[1]).join(), [d.rows, d.fit, d.swapped, d.neither].join());
  });
  const ex = grid.filter(([w]) => w.startsWith('    e.g. ')).map(([w]) => w.slice(9).split(' ')[0]);
  eq('examples (farthest first)', ex.join(), e.examples.join());
  check(label + ': every line the file prints equals the count made in JavaScript', bad.length === 0, bad.slice(0, 4).join(' | '));
  check(label + ': no name of a customer is printed', !grid.some(([w, a]) => /NAME-/.test(w + a)));
  return e;
}

// 1. a register as the old importer left it: swapped dates, with future dates among them
const A = book();
const runA = run(withToday(FILE), A);
{
  check('the file left the register exactly as it was (read-only)', runA.same);
  const e = compare('a swapped register', runA.grid, A);
  const ans = line(runA.grid, 'ANSWER');
  check('a swapped register with future dates is answered "LATER THAN TODAY ... NOT all right"', /LATER THAN TODAY/.test(ans) && /NOT all right/.test(ans) && first(ans) === e.future, ans);
  check('the hand-made future rows are there to be found (a swap explains some, none explains others)', e.futureSwap > 0 && e.future - e.futureSwap >= 4 && e.hiddenFuture >= 1 && e.ltFuture >= 1 && e.neither > 0 && e.untested > 0 && e.days.length === 10, JSON.stringify({ f: e.future, s: e.futureSwap, h: e.hiddenFuture, l: e.ltFuture, n: e.neither, u: e.untested, d: e.days.length }));
  console.log('      ' + A.length.toLocaleString('en-US') + ' register rows; the file itself took ' + runA.ms + ' ms');
  if (process.env.SHOW) { console.log(); for (const [w, a] of runA.grid) console.log((w + '                                                                                                   ').slice(0, 100) + ' | ' + a); console.log(); }
  if (process.env.TIME_ONLY) { console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nfirst register only (TIME_ONLY): passed'); process.exit(fails.length ? 1 : 0); }
}
// 2. swapped, but with nothing in the future: only the second test sees it
{
  const B = book({ future: false, specials: false });
  const { grid } = run(withToday(FILE), B), e = compare('a swapped register with no future date', grid, B);
  const ans = line(grid, 'ANSWER');
  check('with no date in the future the second test still says the column is NOT all right', e.future === 0 && e.swapped > 0 && /^no Disb date is later than today, BUT/.test(ans) && /NOT all right/.test(ans), ans);
}
// 3. a clean register
{
  const C = book({ swapped: false, future: false });
  const { grid } = run(withToday(FILE), C), e = compare('a clean register', grid, C);
  const ans = line(grid, 'ANSWER');
  check('a clean register is answered "all right"', e.future === 0 && e.swapped === 0 && e.tested > 0 && /the column is all right$/.test(ans) && !/NOT/.test(ans), ans);
}
// 4. a book that never had the deck_date migration: the file runs, the first test is made, the second says it cannot be
{
  const E = book();
  const { grid } = run(withToday(FILE), E, { stamp: false });
  const e = expectOf(E.map(r => ({ ...r, stamp: null })));
  compare('a register without the deck_date column', grid, E.map(r => ({ ...r, stamp: null })), { stamped: false });
  const ans = line(grid, 'ANSWER');
  check('without the stamp column the answer says the second test could not be made (when nothing is in the future)', /LATER THAN TODAY/.test(ans) || /could not be made/.test(ans), ans);
  const F = book({ future: false, specials: false }).map(r => ({ ...r, stamp: null })), r2 = run(withToday(FILE), F, { stamp: false });
  check('...and a book without the column and with no future date says "could not be made", never "all right"', /could not be made/.test(line(r2.grid, 'ANSWER')) && !/is all right/.test(line(r2.grid, 'ANSWER')), line(r2.grid, 'ANSWER'));
}
// 5. the file's own "today" expression runs, and is the East Africa date
{
  const out = psql(`select to_char((now() at time zone 'Africa/Dar_es_Salaam')::date, 'YYYY-MM-DD Dy');`).trim();
  const r = run(FILE, book({ swapped: false, future: false, specials: false }));
  check('the file as pasted (its own today expression) prints the East Africa date', line(r.grid, 'today') === out, line(r.grid, 'today') + ' vs ' + out);
}
// 6. broken on purpose: every break must change the answer of at least one of four registers (or make the file fail)
{
  const regs = [
    { rows: A }, { rows: book({ future: false, specials: false }) }, { rows: book({ swapped: false, future: false }) },
    { rows: book({ future: false, specials: false }).map(r => ({ ...r, stamp: null })), opts: { stamp: false } },   // no deck_date column, nothing in the future
  ];
  const show = g => g.map(x => x.join('|')).join('\n');
  const base = regs.map(r => show(run(withToday(FILE), r.rows, r.opts).grid));
  const breaks = [
    ['a date TODAY counts as later than today',                       /count\(\*\) filter \(where shown and d > today\)  /, 'count(*) filter (where shown and d >= today) '],
    ['a placeholder (no status, no arrears) counts as shown',         /\(r\.status is not null or r\.arrears is not null\)/, '(r.status is not null or r.arrears is null)'],
    ['the window is 0 to 6 days',                                     /between 0 and 3/g, 'between 0 and 6'],
    ['the window starts at 1',                                        /between 0 and 3/g, 'between 1 and 3'],
    ['a row that fits as stored also counts as swapped',              /testable and not fits and fits_sw/, 'testable and fits_sw'],
    ['the second test is made for rows with no stamp',                /x\.shown and x\.stamp is not null and /, 'x.shown and '],
    ['the second test is made for placeholders',                      /\(x\.shown and x\.stamp/, '(x.stamp'],
    ['Last trans TODAY counts as later than today',                   /where shown and lt > today/, 'where shown and lt >= today'],
    ['the hidden count includes the rows the tab shows',              /where not shown and d > today/, 'where d > today'],
    ['the examples run nearest-first',                                /order by d desc, ref/, 'order by d, ref'],
    ['only three deck days are listed',                               /d\.rn <= 10/, 'd.rn <= 3'],
    ['the swap is not made',                                          /make_date\(extract\(year from d\)::int, extract\(day from d\)::int, extract\(month from d\)::int\)/, 'd'],
    ['a swap that is still in the future "explains" it',              /d > today and d_sw <= today/, 'd > today and d_sw is not null'],
    ['the answer line forgets the second test',                       /when \(select n_swapped from p\) > 0/, 'when false'],
    ['the answer line is "all right" with no test made',              /when \(select n_tested from p\) = 0/, 'when false'],
    ['the answer line calls a clean register NOT all right',          /when \(select n_future from p\) > 0/, 'when (select n_future from p) >= 0'],
    ['the deck stamp is read from the column directly (fails on a book without it)', /nullif\(to_jsonb\(r\) ->> 'deck_date', ''\)::date/, 'r.deck_date'],
  ];
  for (const [name, re, to] of breaks) {
    const src = withToday(FILE), broken = src.replace(re, to);
    if (broken === src) { check('(break "' + name + '" was applied)', false, 'the pattern is not in the file any more'); continue; }
    let differs = false;
    for (let i = 0; i < regs.length && !differs; i++) {
      try { differs = show(run(broken, regs[i].rows, regs[i].opts).grid) !== base[i]; } catch (err) { differs = true; }   // a break that makes the file fail is caught too
    }
    check('BROKEN ON PURPOSE, the answer changes: ' + name, differs);
  }
  // the East Africa date is the one thing here that depends on the clock: the server's own date equals it for most of the day, so a
  // break of it cannot be seen at every hour. test/followup-dates-audit.test.mjs pins the expression in the file.
}
console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
process.exit(fails.length ? 1 : 0);
