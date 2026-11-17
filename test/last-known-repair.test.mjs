/* db/RUN-ME-071-repair-swapped-last-known-deck-dates.sql -- THE SWAPPED DATES OF EACH CUSTOMER'S LAST-KNOWN DECK ROW, TEAM BY TEAM (docs/HANDOFF.md Parts 104, 106 and 108)
 *
 *   "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026
 *   "071 / Error: SQL query ran into an upstream timeout" -- the owner, on the first form of the file (one statement over the whole range)
 *   "Days still to do is reducing 2 or 3 per run.. Ill go for to long bro" -- the owner, on the second form (one day at a time: about 3 seconds a day on the live book)
 *
 * The file changes dates in the hottest table of the book, on RUN-ME-060's rule, in a choice of rows that is new. What makes it safe is pinned: it changes the three dates of a row and nothing else,
 * only a CURRENT row that is the newest of its customer (the same team and loan number: the choice RUN-ME-055's function makes), only in the window it names, by RUN-ME-060's rule word for word
 * (two copies of one rule drift: the text of the two is compared), with a log of its own and an undo from it. What makes it NOT TIME OUT and NOT TAKE FORTY RUNS is pinned too: the work of a run is
 * the LOAN NUMBERS of the teams it does (a walk through the (team, loan number) index, which reads no row, and one look for each loan number in the (loan number, day) index), never a day's rows;
 * two settings and one expression keep the look to a row or two (without them it read all 53 rows of a loan number and took nine times the pages); the run stops starting teams when its clock says
 * so, every finished team is written down, and the whole script is cut off by the database well inside what the SQL editor waits for. Node cannot run SQL: the check that does
 * (tools/db-checks/last-known-repair.mjs, run by hand on a PostgreSQL over the WHOLE of db/schema.sql, every row against a model written again, a database made slow on purpose, the pages a run
 * touches counted on a book whose rows lie in random places, and a list of deliberate breaks) is the proof; this is the guard that a later edit does not part company with it. */
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

test('it writes the three dates of a deck row and nothing else, and two small tables of its own: no delete but its own temporary table, no drop, grant, or other table', () => {
  const c = noStrings(CODE);
  assert.deepEqual([...new Set([...c.matchAll(/\bupdate\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))].filter(t => t !== 'set'), ['defaulter_snapshots']);
  assert.deepEqual([...new Set([...c.matchAll(/\binsert\s+into\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))].sort(), ['defaulter_last_known_repair_log', 'defaulter_last_known_repair_teams', 'lk_rows', 'lk_run']);
  assert.deepEqual([...c.matchAll(/\bcreate\s+(?:temp\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()).sort(), ['defaulter_last_known_repair_log', 'defaulter_last_known_repair_teams', 'lk_rows', 'lk_run']);
  for (const t of ['defaulter_last_known_repair_log', 'defaulter_last_known_repair_teams']) assert.match(c, new RegExp('alter table public\\.' + t + ' enable row level security;'), t + ' is never readable through the public API');
  assert.match(squash(c), /create temp table lk_run \([^)]*\) on commit drop;/, 'the run\'s own numbers live in a temporary table that goes with the transaction');
  assert.match(squash(c), /create temp table lk_rows \([^)]*\) on commit drop;/, 'the newest rows found live in a temporary table that goes with the transaction');
  assert.equal([...c.matchAll(/\bdelete\b/gi)].length, 1, 'one delete: the temporary table of the team in hand');
  assert.match(c, /\n    delete from lk_rows;\n/);
  assert.doesNotMatch(c.replace(/on commit drop/g, '').replace(/delete from lk_rows/g, ''), /\b(delete|drop|truncate|grant|revoke|vacuum|copy|call|perform)\b/i);
  assert.doesNotMatch(c, /^set (?!local)/m, 'every setting is a `set local`: nothing outlasts the script');
  assert.match(SQ, /update public\.defaulter_snapshots s set disb_date = t\.d2, expire_date = t\.e2, chronic_date = t\.c2 from take t where s\.id = t\.id and s\.disb_date = t\.d and s\.expire_date = t\.e and s\.chronic_date = t\.c returning s\.id/,
    'exactly the three dates, and only where the row still holds what it held when it was read');
  assert.deepEqual([...new Set([...c.matchAll(/\b(?:from|join)\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))].filter(t => !['cand', 'clock_timestamp', 'got', 'ins', 'lateral', 'lk', 'one', 's', 'take', 'upd', 'walk'].includes(t)).sort(),
    ['defaulter_last_known_repair_teams', 'defaulter_snapshots', 'lk_rows', 'lk_run', 'pg_indexes', 'teams']);
});

test('THE DECK TABLE IS NEVER READ BY A DAY: seven places name it (the walk and the lookup for a team and for no team, and the write), each bounded by a team and a loan number', () => {
  assert.equal([...CODE.matchAll(/public\.defaulter_snapshots/g)].length, 7, 'another place that names the deck table must be bounded by a team and a loan number, and be pinned here with the reason: the first form of this file read the whole table and timed out, the second read a day (10,000 rows, 3 seconds live)');
  for (const [cond, bound] of [['d.team = v_team', 'd2.team = v_team and d2.ref > w.ref'], ['d.team is null', 'd2.team is null and d2.ref > w.ref']])
    assert.ok(SQ.includes('with recursive walk as ( (select d.ref from public.defaulter_snapshots d where ' + cond + ' order by d.ref limit 1) union all select (select d2.ref from public.defaulter_snapshots d2 where ' + bound + ' order by d2.ref limit 1) from walk w where w.ref is not null ),'),
      'the walk through the (team, loan number) index, one loan number at a time: ' + cond);
  assert.ok(SQ.includes("from walk w cross join lateral ( select s.id, s.ref, s.team, s.snapshot_date, s.snapshot_type, s.days_elapsed, s.disb_date, s.expire_date, s.chronic_date from public.defaulter_snapshots s where s.ref = w.ref and (s.team || '') = v_team and s.snapshot_type = 'current' order by s.snapshot_date desc, s.created_at desc limit 1 ) n where w.ref is not null"),
    'the look for a team: the newest current row of the loan number, newest day first and on that day the row written last; the team is compared as an expression so that the look cannot choose the (team, loan number) index and read every row of the loan number');
  assert.ok(SQ.includes("from walk w cross join lateral ( select s.id, s.ref, s.team, s.snapshot_date, s.snapshot_type, s.days_elapsed, s.disb_date, s.expire_date, s.chronic_date from public.defaulter_snapshots s where s.ref = w.ref and s.team is null and s.snapshot_type = 'current' order by s.snapshot_date desc, s.created_at desc limit 1 ) n where w.ref is not null"),
    'the look for the rows that name no team');
  assert.equal([...SQ.matchAll(/ins as \(insert into lk_rows select \* from got returning 1\) select \(select count\(\*\) from walk where ref is not null\), \(select count\(\*\) from ins\) into v_refs, v_lk;/g)].length, 2, 'the loan numbers walked and the rows found are counted for each of the two');
  assert.match(CODE, /^set local plan_cache_mode = 'force_custom_plan';/m, 'every team is planned for its own name, never by a plan made for another');
  assert.match(CODE, /^set local enable_seqscan = off;/m, 'the table is read through its indexes, never end to end');
  assert.match(CODE, /^set local enable_bitmapscan = off;/m, 'a loan number\'s newest row is found by walking its index entries backward: with bitmap scans the run touched nine times the pages (it collected all 53 rows of each loan number)');
  assert.match(SQ, /if not exists \(select 1 from pg_indexes where schemaname = 'public' and tablename = 'defaulter_snapshots' and indexname = 'idx_def_snap_team_ref'\) then raise exception 'idx_def_snap_team_ref is missing: run RUN-ME-055 \(its section 2, alone\) first\. Nothing was changed\.'; end if;/,
    'the walk needs the (team, loan number) index (RUN-ME-055): without it the file stops with a plain message and changes nothing');
  assert.match(F055, /create index concurrently if not exists idx_def_snap_team_ref on defaulter_snapshots\(team, ref\);/, 'RUN-ME-055 is what makes that index');
});

test('its limits: a 3-second lock, a script cut off by the database at 30 seconds or less, no compiler; the clock, the teams, the count and the undo', () => {
  assert.match(CODE, /^set local lock_timeout = '3s';/m);
  const st = CODE.match(/^set local statement_timeout = '(\d+)s';/m); assert.ok(st && Number(st[1]) <= 30, 'the database cuts the script off by itself well inside what the SQL editor waits for (the first form had 50 and the editor gave up first)');
  assert.match(CODE, /^set local jit = off;/m);
  for (const [k, v] of [['lk_from_day', '2026-08-01'], ['lk_to_day', '2026-11-15'], ['lk_seconds', '15'], ['lk_apply', 'yes']]) assert.match(CODE, new RegExp("^set local hope\\." + k + " = '" + v + "';", 'm'), 'the first lines name ' + k);
  assert.ok(CODE.indexOf("set local hope.lk_apply") < CODE.indexOf('create table'), 'the settings come first: the owner changes the first lines and nothing below them');
  assert.match(SQ, /v_apply boolean := lower\(btrim\(current_setting\('hope\.lk_apply'\)\)\) in \('yes', 'on', 'true', '1'\);/);
  assert.match(SQ, /from cand c join one o on o\.id = c\.id where v_apply \),/, 'a count takes no row, so it writes nothing');
  assert.match(SQ, /create table if not exists public\.defaulter_last_known_repair_teams \( team text primary key, done_at timestamptz not null default now\(\), from_day date not null, to_day date not null, loan_numbers integer not null, last_known integer not null, not_fitting integer not null, one_reading integer not null, repaired integer not null \);/,
    'a team is written once: the primary key is what makes two runs at the same moment safe (the second fails whole), and the window it was done for is written beside it');
  assert.match(SQ, /if v_apply then insert into public\.defaulter_last_known_repair_teams \(team, from_day, to_day, loan_numbers, last_known, not_fitting, one_reading, repaired\) values \(coalesce\(v_team, '\(NO TEAM\)'\), v_from, v_to, v_refs, v_lk, v_cand, v_one, v_upd\) on conflict \(team\) do update set done_at = now\(\), from_day = excluded\.from_day, to_day = excluded\.to_day, loan_numbers = excluded\.loan_numbers, last_known = excluded\.last_known, not_fitting = excluded\.not_fitting, one_reading = excluded\.one_reading, repaired = excluded\.repaired; end if;/,
    'a team is written down only when its rows were written, with the window it was done for; done again for a wider window it is written again');
  assert.match(SQ, /for v_team in select t\.team from public\.teams t union all select null::text order by 1 loop continue when exists \(select 1 from public\.defaulter_last_known_repair_teams p where p\.team = coalesce\(v_team, '\(NO TEAM\)'\) and p\.from_day <= v_from and p\.to_day >= v_to\);/,
    'the teams of the teams table in order, and then the rows that name none; a team done for a window that covers this one is not done again (a team done for a narrower one is)');
  const body = SQ.slice(SQ.indexOf('begin if not exists'), SQ.indexOf('end loop;'));
  assert.ok(body.indexOf('insert into lk_run') > 0 && body.indexOf('insert into public.defaulter_last_known_repair_teams') > body.indexOf('insert into lk_run'), 'the team is written down before the clock is read');
  assert.match(SQ, /end if; exit when clock_timestamp\(\) - v_start > make_interval\(secs => v_secs\); end loop;/, 'THE CLOCK: after a team is finished, another is started only while the run\'s time has not passed (a run always finishes the team it is on, so it always does at least one)');
  const undo = FILE.slice(FILE.indexOf('-- UNDO:')).split('\n').filter(l => l.startsWith('-- ') && !l.startsWith('-- UNDO')).map(l => l.slice(3)).join(' ');
  assert.match(squash(undo), /update public\.defaulter_snapshots s set disb_date = l\.disb_old, expire_date = l\.expire_old, chronic_date = l\.chronic_old from public\.defaulter_last_known_repair_log l where s\.id = l\.id and l\.snapshot_date between date '2026-08-01' and date '2026-11-15'/);
  assert.match(squash(undo), /delete from public\.defaulter_last_known_repair_teams;/, 'the undo makes the teams be looked at again');
  assert.match(FILE, /NEVER AT THE SAME MOMENT AS RUN-ME-060 OR RUN-ME-066/);
  assert.match(HEADER, /RUN THE SAME TEXT AGAIN, WITHOUT CHANGING ANYTHING, UNTIL THE ANSWER SAYS "FINISHED"/);
});

test('the header owns the two forms that came before it: the timeout, the three seconds a day, no claim of a time it did not measure', () => {
  assert.doesNotMatch(HEADER, /took 2 seconds|the whole range took/i);
  assert.match(HEADER, /THE FIRST FORM OF THIS FILE TIMED OUT ON THE LIVE BOOK \("upstream timeout", 17 Nov\)/);
  assert.match(HEADER, /docs\/HANDOFF\.md Part 106/);
  assert.match(HEADER, /THE SECOND FORM WENT DAY BY DAY: it ran, but a day cost about 3 seconds on the live book/);
  assert.match(HEADER, /of 10 seconds did 3 days and 104 were to do \(Part 108\)/);
  assert.match(HEADER, /THE ANSWER SAYS HOW MANY SECONDS THE RUN TOOK/, 'the live time is not known, and the answer says it');
  assert.match(HEADER, /fetched 2\.16 million table pages for the whole window and this form 0\.15 million/);
});

test('a row is a LAST-KNOWN row when it is the NEWEST CURRENT row of its customer (the same team and loan number: newest day, and on that day the row written last): the choice RUN-ME-055 makes', () => {
  // RUN-ME-055's function: the newest CURRENT row of a team's loan number, by day and then by the time it was written
  assert.match(squash(F055), /d\.ref = c\.ref and d\.team = v_team and d\.snapshot_type = 'current' order by d\.ref, d\.snapshot_date desc, d\.created_at desc/);
  assert.match(SQ, /with lk as \( select r\.id, r\.ref, r\.team, r\.snapshot_date, r\.snapshot_type, r\.days_elapsed, r\.disb_date, r\.expire_date, r\.chronic_date from lk_rows r where r\.snapshot_date between v_from and v_to \),/,
    'the rule reads the newest rows that lie in the window, and no others');
  assert.match(SQ, /cand as \( select s\.id, s\.ref, s\.team, s\.snapshot_date, s\.snapshot_type, s\.days_elapsed as de, s\.disb_date as d, s\.expire_date as e, s\.chronic_date as c, sw\.d_s, sw\.e_s, sw\.c_s from lk s cross join lateral/);
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

test('the answer says what the run did and what is left: the teams done, the last, the loan numbers looked at, the last-known rows, those that do not fit, those with one reading, those repaired, those left, the teams still to do, the seconds, and what to do next', () => {
  const out = squash(CODE.slice(CODE.lastIndexOf('select (select count(*) from lk_run)')));
  assert.deepEqual([...out.matchAll(/\bas ([a-z_]+)/g)].map(m => m[1]), ['teams_done_in_this_run', 'last_team_done', 'loan_numbers_looked_at', 'last_known_rows', 'of_them_not_fitting', 'one_reading_fits', 'repaired_now', 'left_alone_no_single_reading', 'teams_still_to_do', 'seconds_this_run', 'what_next']);
  for (const w of ["'COUNT ONLY: nothing was changed or written down'", "'FINISHED: every team is done'", "'RUN THE SAME TEXT AGAIN'", 'order by r.n desc limit 1', 'round(coalesce(sum(seconds), 0), 1)']) assert.ok(out.includes(w), w);
  assert.match(SQ, /insert into lk_run values \(\(select count\(\*\) \+ 1 from lk_run\), coalesce\(v_team, '\(NO TEAM\)'\), v_refs, v_lk, v_cand, v_one, v_upd, extract\(epoch from clock_timestamp\(\) - v_t0\)\);/,
    'the seconds of each team are written: the live time of a team is not known, and the answer says it');
});

const CHECKC = CHECK.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');   // the check without its comments: a comment that names a thing is not the thing
test('the kept check runs the whole real schema, models the rule again, compares every row, runs one team at a time, makes the database slow on purpose, counts the pages a run touches on a book whose rows lie in random places, and breaks the file on purpose', () => {
  assert.match(CHECKC, /readFileSync\(path\.join\(ROOT, 'db\/RUN-ME-071-repair-swapped-last-known-deck-dates\.sql'\)/);
  assert.match(CHECKC, /readFileSync\(path\.join\(ROOT, 'db\/schema\.sql'\)/);
  assert.doesNotMatch(CHECKC, /create table (?:if not exists )?(?:public\.)?defaulter_snapshots\s*\(/i, 'the table is the real one, never declared by hand (RUN-ME-061): the timing book copies it with its real types, in a random order');
  for (const s of ['do not equal the model', 'a second run did something', 'a count changed the book', 'a count wrote something down', 'runs of one team each', 'the numbers written down for each team are not the model\\\'s', 'a run cut off by the database\\\'s own limit left something behind',
    'the undo did not put every row back exactly', 'a customer still on the latest deck was touched', 'BROKEN ON PURPOSE', 'pg_stat_get_xact_blocks_fetched', 'a team done for seven days is not done for the whole window', 'was not refused with a plain message', 'perform pg_sleep', 'TIMING_DAYS'])
    assert.ok(CHECKC.includes(s), s);
  assert.ok((CHECKC.match(/^\s+\['[^\n]+',\s+(?:sub\(|f => sub\()/gm) || []).length >= 18, 'eighteen deliberate breaks or more, each of which must change the outcome');
  assert.match(CHECKC, /const TEAMS = \['T1', 'T2', 'T3', 'T4', 'T5', 'T6'\], NOTEAM = '\(NO TEAM\)', UNITS = TEAMS\.concat\(\[NOTEAM\]\)/, 'six teams and the rows that name none');
  assert.match(CHECKC, /team: i % 35 === 7 \? null : pick\(TEAMS\)/, 'the book has customers whose rows name no team');
  assert.match(CHECKC, /rows of customers who came back that are repairable and are not their newest/, 'the book holds customers who left and came back, and the check refuses to pass without them');
  assert.match(CHECKC, /create table public\.ds2 as select \* from public\.defaulter_snapshots order by md5\(id::text\);/, 'the timing book has every row in a random place: a day\'s rows are not together (the second form read a day)');
  assert.match(CHECKC, /perLoan <= 6 && whole\.table < tablePages \* 3/, 'a loan number costs a row or two: six table pages at most, per loan number, whatever the size of the book');
  assert.match(CHECKC, /perLoan < perLoanHalf \* 1\.35 && perLoanHalf <= 6/, 'a loan number costs no more on the whole book than on half of it');
  assert.match(CHECKC, /noBitmap\.table > whole\.table \* 4/, 'with bitmap scans allowed the pages of a run are many times more');
  assert.match(CHECKC, /noTrick\.table > whole\.table \* 4/, 'with the team compared plainly the pages of a run are many times more');
  assert.ok((CHECKC.match(/pg_stat_get_xact_blocks_fetched/g) || []).length >= 2, 'the pages of the table and of its indexes are both counted');
  assert.match(CHECKC, /const slow = \(f, s\) => f\.replace\("    -- the team in hand is finished; start another only while the clock is inside the run's time"/, 'the slow database is made by a sleep after each team');
  assert.match(CHECKC, /need\(rNoClock\.teams === UNITS\.length/, 'without the clock a slow run does every team');
  assert.match(CHECKC, /drop index public\.idx_def_snap_team_ref;/, 'a book without the index is refused');
  assert.match(CHECKC, /delete from public\.teams;/, 'the timing book has the sixty teams of its own and not also the six of the small book (a team with no loan number would be the "one team" it measures)');
  assert.match(CHECKC, /need\(aNW\.rep === E1\.m\.size - expectFor\(\.\.\.NW\)\.m\.size/, 'the wide window after the narrow one repairs exactly what the narrow one left');
});
