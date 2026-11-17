/* db/RUN-ME-071-repair-swapped-last-known-deck-dates.sql -- THE SWAPPED DATES OF EACH CUSTOMER'S LAST-KNOWN DECK ROW, ONE DAY AT A TIME (docs/HANDOFF.md Parts 104 and 106)
 *
 *   "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026
 *   "071 / Error: SQL query ran into an upstream timeout" -- the owner, 17 Nov 2026, on the first form of the file (one statement over the whole range)
 *
 * The file changes dates in the hottest table of the book, on RUN-ME-060's rule, in a choice of rows that is new. What makes it safe is pinned: it changes the three dates of a row and nothing else,
 * only a CURRENT row that is the newest of its customer (the same team and loan number: the choice RUN-ME-055's function makes), only in the window it names, by RUN-ME-060's rule word for word (two
 * copies of one rule drift: the text of the two is compared here), with a log of its own and an undo from it. What makes it NOT TIME OUT is pinned too, because the first form of the file did exactly
 * that on the live book: the work of a run is the DAYS it does (a day is read through the day index, the customers on the next deck are spared the lookup, the rest are looked up one at a time in the
 * (loan number, day) index), the run stops starting days when its clock says so, every finished day is written down, and the whole script is cut off by the database well inside what the SQL editor
 * waits for. Node cannot run SQL: the check that does (tools/db-checks/last-known-repair.mjs, run by hand on a PostgreSQL over the WHOLE of db/schema.sql, every row against a model written again,
 * a database made slow on purpose, the pages a run touches counted, and a list of deliberate breaks) is the proof; this is the guard that a later edit does not part company with it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const F = 'db/RUN-ME-071-repair-swapped-last-known-deck-dates.sql';
const FILE = rd(F), F060 = rd('db/RUN-ME-060-repair-swapped-deck-dates.sql'), CHECK = rd('tools/db-checks/last-known-repair.mjs'), F055 = rd('db/RUN-ME-055-defaulter-ghosts.sql');
const code = f => f.split('\n').map(l => { if (/^\s*--/.test(l)) return ''; let q = false; for (let i = 0; i < l.length; i++) { if (l[i] === "'") q = !q; else if (!q && l[i] === '-' && l[i + 1] === '-') return l.slice(0, i); } return l; }).join('\n');
const CODE = code(FILE), C060 = code(F060);
const squash = s => s.replace(/\s+/g, ' ').trim();
const noStrings = s => s.replace(/'(?:[^']|'')*'/g, "''");
const SQ = squash(CODE), S060 = squash(C060);
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, 'missing: ' + a.slice(0, 70)); const j = s.indexOf(b, i + a.length); assert.ok(j >= 0, 'missing: ' + b.slice(0, 70)); return s.slice(i, j + b.length); };
const HEADER = FILE.slice(0, FILE.indexOf('set local lock_timeout'));

test('it writes the three dates of a deck row and nothing else, and two small tables of its own: no delete, drop, grant, or other table', () => {
  const c = noStrings(CODE);
  assert.deepEqual([...new Set([...c.matchAll(/\bupdate\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))], ['defaulter_snapshots']);
  assert.deepEqual([...new Set([...c.matchAll(/\binsert\s+into\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))].sort(), ['defaulter_last_known_repair_days', 'defaulter_last_known_repair_log', 'lk_run']);
  assert.deepEqual([...c.matchAll(/\bcreate\s+(?:temp\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()).sort(), ['defaulter_last_known_repair_days', 'defaulter_last_known_repair_log', 'lk_run']);
  for (const t of ['defaulter_last_known_repair_log', 'defaulter_last_known_repair_days']) assert.match(c, new RegExp('alter table public\\.' + t + ' enable row level security;'), t + ' is never readable through the public API');
  assert.match(squash(c), /create temp table lk_run \([^)]*\) on commit drop;/, 'the run\'s own numbers live in a temporary table that goes with the transaction');
  assert.doesNotMatch(c.replace(/on commit drop/g, ''), /\b(delete|drop|truncate|grant|revoke|vacuum|copy|call|perform)\b/i);
  assert.doesNotMatch(c, /^set (?!local)/m, 'every setting is a `set local`: nothing outlasts the script');
  assert.match(SQ, /update public\.defaulter_snapshots s set disb_date = t\.d2, expire_date = t\.e2, chronic_date = t\.c2 from take t where s\.id = t\.id and s\.disb_date = t\.d and s\.expire_date = t\.e and s\.chronic_date = t\.c returning s\.id/,
    'exactly the three dates, and only where the row still holds what it held when it was read');
  assert.deepEqual([...new Set([...c.matchAll(/\b(?:from|join)\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))].filter(t => !['cand', 'g', 'gone', 'lateral', 'lk', 'nx', 'one', 's', 'take', 'upd'].includes(t)).sort(),
    ['defaulter_last_known_repair_days', 'defaulter_snapshots', 'generate_series', 'lk_run']);
});

test('NO READ OF THE DECK TABLE IS UNBOUNDED: five places name it (the next deck day, the next deck, the day, the lookup, the write) and each is bounded by a day or a loan number', () => {
  assert.equal([...CODE.matchAll(/public\.defaulter_snapshots/g)].length, 5, 'a sixth place that names the deck table must be bounded by a day or a loan number, and be pinned here with the reason: the first form of this file read the whole table and timed out');
  assert.match(SQ, /select min\(s\.snapshot_date\) into v_next from public\.defaulter_snapshots s where s\.snapshot_type = 'current' and s\.snapshot_date > v_day;/);
  assert.match(SQ, /with nx as materialized \( select x\.ref, x\.team from public\.defaulter_snapshots x where x\.snapshot_type = 'current' and x\.snapshot_date = v_next \),/);
  assert.match(SQ, /gone as materialized \( select s\.id, s\.ref, s\.team, s\.snapshot_date, s\.snapshot_type, s\.days_elapsed, s\.disb_date, s\.expire_date, s\.chronic_date, s\.created_at from public\.defaulter_snapshots s where s\.snapshot_type = 'current' and s\.snapshot_date = v_day and not exists/);
  assert.match(SQ, /from public\.defaulter_snapshots n where n\.ref = g\.ref and n\.snapshot_date >= g\.snapshot_date and/, 'the lookup is bounded by the loan number AND the day, the two columns of the (loan number, day) index');
  assert.match(SQ, /limit 1 \) h on true where h\.newer is null/, 'one newer row is enough: the lookup stops at the first');
  assert.match(CODE, /^set local plan_cache_mode = 'force_custom_plan';/m, 'every day is planned for its own two dates, never by a plan made for another');
  assert.match(CODE, /^set local enable_seqscan = off;/m, 'a day is read through the day index; the table is never read end to end');
});

test('its limits: a 3-second lock, a script cut off by the database at 30 seconds or less, no compiler; the clock, the days, the count and the undo', () => {
  assert.match(CODE, /^set local lock_timeout = '3s';/m);
  const st = CODE.match(/^set local statement_timeout = '(\d+)s';/m); assert.ok(st && Number(st[1]) <= 30, 'the database cuts the script off by itself well inside what the SQL editor waits for (the first form had 50 and the editor gave up first)');
  assert.match(CODE, /^set local jit = off;/m);
  for (const [k, v] of [['lk_from_day', '2026-08-01'], ['lk_to_day', '2026-11-15'], ['lk_seconds', '10'], ['lk_apply', 'yes']]) assert.match(CODE, new RegExp("^set local hope\\." + k + " = '" + v + "';", 'm'), 'the first lines name ' + k);
  assert.ok(CODE.indexOf("set local hope.lk_apply") < CODE.indexOf('create table'), 'the settings come first: the owner changes the first lines and nothing below them');
  assert.match(SQ, /create table if not exists public\.defaulter_last_known_repair_days \( day date primary key, done_at timestamptz not null default now\(\), last_known integer not null, not_fitting integer not null, one_reading integer not null, repaired integer not null \);/, 'a day is written once: the primary key is what makes two runs at the same moment safe (the second fails whole)');
  assert.match(SQ, /v_apply boolean := lower\(btrim\(current_setting\('hope\.lk_apply'\)\)\) in \('yes', 'on', 'true', '1'\);/);
  assert.match(SQ, /from cand c join one o on o\.id = c\.id where v_apply \),/, 'a count takes no row, so it writes nothing');
  assert.match(SQ, /if v_apply then insert into public\.defaulter_last_known_repair_days \(day, last_known, not_fitting, one_reading, repaired\) values \(v_day, v_lk, v_cand, v_one, v_upd\); end if;/, 'a day is written down only when its rows were written');
  assert.match(SQ, /generate_series\(v_from::timestamp, v_to::timestamp, interval '1 day'\) g order by 1 desc loop/, 'the days of the window, the NEWEST first (the customers cleared lately are the ones the tab shows)');
  assert.match(SQ, /continue when exists \(select 1 from public\.defaulter_last_known_repair_days p where p\.day = v_day\);/, 'a day that is done is not done again');
  const body = SQ.slice(SQ.indexOf('begin for v_day'), SQ.indexOf('end loop;'));
  assert.ok(body.indexOf('insert into lk_run') > 0 && body.indexOf('insert into public.defaulter_last_known_repair_days') > body.indexOf('insert into lk_run'), 'the day is written down before the clock is read');
  assert.match(SQ, /end if; exit when clock_timestamp\(\) - v_start > make_interval\(secs => v_secs\); end loop;/, 'THE CLOCK: after a day is finished, another is started only while the run\'s time has not passed (a run always finishes the day it is on, so it always does at least one)');
  const undo = FILE.slice(FILE.indexOf('-- UNDO:')).split('\n').filter(l => l.startsWith('-- ') && !l.startsWith('-- UNDO')).map(l => l.slice(3)).join(' ');
  assert.match(squash(undo), /update public\.defaulter_snapshots s set disb_date = l\.disb_old, expire_date = l\.expire_old, chronic_date = l\.chronic_old from public\.defaulter_last_known_repair_log l where s\.id = l\.id and l\.snapshot_date between date '2026-08-01' and date '2026-11-15'/);
  assert.match(squash(undo), /delete from public\.defaulter_last_known_repair_days where day between date '2026-08-01' and date '2026-11-15'/, 'the undo makes the days be looked at again');
  assert.match(FILE, /NEVER AT THE SAME MOMENT AS RUN-ME-060 OR RUN-ME-066/);
  assert.match(HEADER, /RUN THE SAME TEXT AGAIN, WITHOUT CHANGING ANYTHING, UNTIL THE ANSWER SAYS "FINISHED"/);
});

test('the header does not promise what the first form promised: no claim that the whole range took two seconds, and the timeout is owned', () => {
  assert.doesNotMatch(HEADER, /took 2 seconds|the whole range took/i);
  assert.match(HEADER, /TIMED OUT ON THE LIVE BOOK \("upstream timeout", 17 Nov\)/);
  assert.match(HEADER, /docs\/HANDOFF\.md Part 106/);
  assert.match(HEADER, /a one-day run touches 3,000 to 6,000 pages of a 2\.3-million-row book of 84,000 pages; the whole-range statement touched 172,000/);
});

test('a row is a LAST-KNOWN row when it is a CURRENT row of the day and no newer current row of the same team and loan number exists (a row of the same day counts when it was written later): the choice RUN-ME-055 makes', () => {
  const gone = between(SQ, 'gone as materialized (', '),');
  assert.match(gone, /and not exists \(select 1 from nx where nx\.ref = s\.ref and nx\.team is not distinct from s\.team\)/, 'the cheap test: a customer on the next deck is not at the end of their run, team and loan number together');
  const lk = between(SQ, 'lk as (', ') h on true where h.newer is null )');
  assert.match(lk, /from gone g left join lateral \( select 1 as newer from public\.defaulter_snapshots n where n\.ref = g\.ref and n\.snapshot_date >= g\.snapshot_date and n\.snapshot_type = 'current' and n\.team is not distinct from g\.team and \(n\.snapshot_date > g\.snapshot_date or n\.created_at > g\.created_at\) limit 1/);
  // RUN-ME-055's function: the newest CURRENT row of a team's loan number, by day and then by the time it was written
  assert.match(squash(F055), /d\.ref = c\.ref and d\.team = v_team and d\.snapshot_type = 'current' order by d\.ref, d\.snapshot_date desc, d\.created_at desc/);
  assert.match(SQ, /cand as \( select s\.id, s\.ref, s\.team, s\.snapshot_date, s\.snapshot_type, s\.days_elapsed as de, s\.disb_date as d, s\.expire_date as e, s\.chronic_date as c, sw\.d_s, sw\.e_s, sw\.c_s from lk s cross join lateral/, 'the rule reads the last-known rows and no others');
});

test('the rule is RUN-ME-060\'s, word for word: the exchange of a date, the pattern a row must fit, the one reading that fits, the guard of the write (two copies of one rule drift)', () => {
  const sw = s => between(s, 'cross join lateral ( select case when extract(day from s.disb_date)', ') sw');
  assert.equal(sw(SQ), sw(S060), 'the exchange of a date');
  const fit = s => between(s.replace('where s.disb_date is not null', 'and s.disb_date is not null'), 'and s.disb_date is not null and s.expire_date is not null', 'between 0 and 3)');
  assert.equal(fit(SQ), fit(S060), 'the rows that do not fit the pattern');
  const one = s => between(s, 'one as (', 'having count(*) = 1 )');
  assert.equal(one(SQ), one(S060), 'the one reading that fits');
  const upd = s => between(s, 'upd as (', 'returning s.id )');
  assert.equal(upd(SQ), upd(S060), 'the write');
  assert.equal(between(SQ, 'lg as (', 'returning id )').replace(/defaulter_last_known_repair_log \(id, snapshot_date, snapshot_type, ref, team, disb_old/, 'LOG (id, snapshot_date, snapshot_type, ref, disb_old').replace(/t\.ref, t\.team, t\.d/, 't.ref, t.d'),
    between(S060, 'lg as (', 'returning id )').replace(/defaulter_date_repair_log \(id, snapshot_date, snapshot_type, ref, disb_old/, 'LOG (id, snapshot_date, snapshot_type, ref, disb_old'), 'the log line: a row\'s first line keeps the dates it was uploaded with');
});

test('the answer says what the run did and what is left: the days done, the oldest, the last-known rows, those that do not fit, those with one reading, those repaired, those left, the days still to do, and what to do next', () => {
  const out = squash(CODE.slice(CODE.lastIndexOf('select (select count(*) from lk_run)')));
  assert.deepEqual([...out.matchAll(/\bas ([a-z_]+)/g)].map(m => m[1]), ['days_done_in_this_run', 'oldest_day_done', 'last_known_rows', 'of_them_not_fitting', 'one_reading_fits', 'repaired_now', 'left_alone_no_single_reading', 'days_still_to_do', 'what_next']);
  for (const w of ["'COUNT ONLY: nothing was changed or written down'", "'FINISHED: every day of the window is done'", "'RUN THE SAME TEXT AGAIN'"]) assert.ok(out.includes(w), w);
});

const CHECKC = CHECK.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');   // the check without its comments: a comment that names a thing is not the thing
test('the kept check runs the whole real schema, models the rule again, compares every row, runs one day at a time, makes the database slow on purpose, counts the pages a run touches on a book laid out the way uploads lay it out, and breaks the file on purpose', () => {
  assert.match(CHECKC, /readFileSync\(path\.join\(ROOT, 'db\/RUN-ME-071-repair-swapped-last-known-deck-dates\.sql'\)/);
  assert.match(CHECKC, /readFileSync\(path\.join\(ROOT, 'db\/schema\.sql'\)/);
  assert.doesNotMatch(CHECKC, /create table[^\n]*defaulter_snapshots/i, 'the table is the real one, never declared by hand (RUN-ME-061)');
  for (const s of ['do not equal the model', 'a second run did something', 'a count changed the book', 'a count wrote something down', 'runs of one day each', 'the clock of 0.2 s', 'a run cut off by the database\\\'s own limit left something behind',
    'the undo did not put every row back exactly', 'a customer still on the latest deck was touched', 'BROKEN ON PURPOSE', 'pg_stat_get_xact_blocks_fetched', 'a one-day run touched', 'on half the book', 'TIMING_DAYS', 'perform pg_sleep'])
    assert.ok(CHECKC.includes(s), s);
  assert.match(CHECKC, /returners\\' rows the exact lookup must stop/, 'the book holds customers who left and came back, and the check refuses to pass without them');
  assert.match(CHECKC, /iso\(r\.day\) === iso\(days\[days\.indexOf\(r\.cust\.gap\[0\]\) - 1\]\)/);
  assert.ok((CHECKC.match(/^\s+\['[^\n]+',\s+(?:sub\(|f => sub\()/gm) || []).length >= 21, 'twenty-one deliberate breaks or more, each of which must change the outcome');
  assert.match(CHECKC, /new Date\(t\)\.getUTCDay\(\) !== 0/, 'the book has Sundays with no deck');
  assert.match(CHECKC, /const T3GAP = D\('2026-10-14'\)/, 'the book has a day on which a whole team is missing');
  assert.match(CHECKC, /if \(c\.team === 'T3' && day === T3GAP\) continue;/);
  assert.match(CHECKC, /const half = runBlocks\(FILE, TD, TD, 0, 'no'\)/, 'the same one-day run on half the book');
  assert.match(CHECKC, /half\.blocks > oneDay\.blocks \* 0\.75 && half\.blocks < oneDay\.blocks \* 1\.25/, 'its pages must not depend on the size of the book');
  assert.match(CHECKC, /oneDay\.blocks < 10000 && oneDay\.blocks < tablePages \* 0\.1/, 'a one-day run touches a few thousand pages, a tenth of the table at most');
  assert.match(CHECKC, /noPre\.blocks > oneDay\.blocks \* 3/, 'without the test of the next deck the pages of a run are many times more');
  assert.ok((CHECKC.match(/pg_stat_get_xact_blocks_fetched/g) || []).length >= 2, 'the pages of the table and of its indexes are both counted');
  assert.match(CHECKC, /const slow = \(f, s\) => f\.replace\('insert into lk_run values \(v_day, v_lk, v_cand, v_one, v_upd\);'/, 'the slow database is made by a sleep after each day');
  assert.match(CHECKC, /need\(rNoClock\.days === WDAYS/, 'without the clock a slow run does every day');
});
