/* db/RUN-ME-071-repair-swapped-last-known-deck-dates.sql -- THE SWAPPED DATES OF EACH CUSTOMER'S LAST-KNOWN DECK ROW (docs/HANDOFF.md Part 104)
 *
 *   "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026
 *
 * The file changes dates in the hottest table of the book, on RUN-ME-060's rule, in a choice of rows that is new. What makes it safe is pinned: it changes the three dates of a row and nothing else,
 * only a CURRENT row that is the newest of its customer (the same team and loan number: the choice RUN-ME-055's function makes), only in the window it names, by RUN-ME-060's rule word for word (two
 * copies of one rule drift: the text of the two is compared here), at most the limit a run names, with a log of its own and an undo from it. Node cannot run SQL: the check that does
 * (tools/db-checks/last-known-repair.mjs, run by hand on a PostgreSQL over the WHOLE of db/schema.sql, every row against a model written again, the undo byte for byte, and a list of deliberate breaks)
 * is the proof; this is the guard that a later edit does not part company with it. */
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
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, 'missing: ' + a.slice(0, 60)); const j = s.indexOf(b, i + a.length); assert.ok(j >= 0, 'missing: ' + b.slice(0, 60)); return s.slice(i, j + b.length); };

test('it writes the three dates of a deck row and nothing else, and one log of its own: no delete, drop, grant, or other table', () => {
  const c = noStrings(CODE);
  assert.deepEqual([...new Set([...c.matchAll(/\bupdate\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))], ['defaulter_snapshots']);
  assert.deepEqual([...new Set([...c.matchAll(/\binsert\s+into\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))], ['defaulter_last_known_repair_log']);
  assert.deepEqual([...new Set([...c.matchAll(/\bcreate\s+table\s+if\s+not\s+exists\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))], ['defaulter_last_known_repair_log']);
  assert.match(c, /alter table public\.defaulter_last_known_repair_log enable row level security;/, 'the log is never readable through the public API');
  assert.doesNotMatch(c, /\b(delete|drop|truncate|grant|revoke|vacuum|copy|call)\b/i);
  assert.match(squash(CODE), /update public\.defaulter_snapshots s set disb_date = t\.d2, expire_date = t\.e2, chronic_date = t\.c2 from take t where s\.id = t\.id and s\.disb_date = t\.d and s\.expire_date = t\.e and s\.chronic_date = t\.c returning s\.id/,
    'exactly the three dates, and only where the row still holds what it held when it was read');
  assert.deepEqual([...new Set([...c.matchAll(/\b(?:from|join)\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))].filter(t => !['win', 'lk', 'cand', 'one', 'take', 'f', 'x', 'y', 'z', 'sw', 'c', 'o', 't', 's', 'upd', 'values', 'lateral'].includes(t)).sort(), ['defaulter_snapshots']);
});

test('its limits: a 3-second lock, a 50-second ceiling, no compiler; a window and a limit named in the first lines; a count with max_rows 0; the undo names the same window', () => {
  assert.match(CODE, /^\s*set local lock_timeout = '3s';/m);
  assert.match(CODE, /^\s*set local statement_timeout = '50s';/m);
  assert.match(CODE, /^\s*set local jit = off;/m);
  const win = between(CODE, 'with win as (', '),\nlk as (');
  assert.deepEqual([...win.matchAll(/ as (from_day|to_day|max_rows)\b/g)].map(m => m[1]), ['from_day', 'to_day', 'max_rows']);
  assert.match(win, /date '2026-08-01' as from_day/); assert.match(win, /date '2026-11-15' as to_day/); assert.match(win, /50000 as max_rows/);
  assert.match(squash(CODE), /order by c\.snapshot_date, c\.id limit \(select max_rows from win\)/, 'the limit is the one the run names (0 counts and changes nothing)');
  const undo = FILE.slice(FILE.indexOf('-- UNDO:')).split('\n').filter(l => l.startsWith('-- ') && !l.startsWith('-- UNDO')).map(l => l.slice(3)).join(' ');
  assert.match(squash(undo), /update public\.defaulter_snapshots s set disb_date = l\.disb_old, expire_date = l\.expire_old, chronic_date = l\.chronic_old from public\.defaulter_last_known_repair_log l where s\.id = l\.id and l\.snapshot_date between date '2026-08-01' and date '2026-11-15'/);
  assert.match(FILE, /NEVER AT THE SAME MOMENT AS RUN-ME-060 OR RUN-ME-066/);
});

test('a row is a LAST-KNOWN row when it is a CURRENT row of the window and no newer current row of the same team and loan number exists (a row of the same day counts when it was written later): the choice RUN-ME-055 makes', () => {
  const lk = squash(between(CODE, 'lk as (', '),\ncand as ('));
  assert.match(lk, /where s\.snapshot_type = 'current' and s\.snapshot_date between win\.from_day and win\.to_day and not exists \(select 1 from public\.defaulter_snapshots n where n\.ref = s\.ref and n\.team is not distinct from s\.team and n\.snapshot_type = 'current' and \(n\.snapshot_date > s\.snapshot_date or \(n\.snapshot_date = s\.snapshot_date and n\.created_at > s\.created_at\)\)\)/);
  // RUN-ME-055's function: the newest CURRENT row of a team's loan number, by day and then by the time it was written
  assert.match(squash(F055), /d\.ref = c\.ref and d\.team = v_team and d\.snapshot_type = 'current' order by d\.ref, d\.snapshot_date desc, d\.created_at desc/);
});

test('the rule is RUN-ME-060\'s, word for word: the exchange of a date, the pattern a row must fit, the one reading that fits, the guard of the write (two copies of one rule drift)', () => {
  const sw = f => squash(between(f, 'cross join lateral (\n    select case when extract(day from s.disb_date)', ') sw'));
  assert.equal(sw(CODE), sw(C060), 'the exchange of a date');
  const fit = f => squash(between(f, 'and s.disb_date is not null and s.expire_date is not null', 'between 0 and 3)\n'));
  assert.equal(fit(CODE.replace('  where s.disb_date is not null', '    and s.disb_date is not null')), fit(C060), 'the rows that do not fit the pattern');
  const one = f => squash(between(f, 'one as (', 'having count(*) = 1\n)'));
  assert.equal(one(CODE), one(C060), 'the one reading that fits');
  const upd = f => squash(between(f, 'upd as (', 'returning s.id\n)'));
  assert.equal(upd(CODE), upd(C060), 'the write');
  assert.equal(squash(between(CODE, 'lg as (', 'returning id\n)')).replace(/defaulter_last_known_repair_log \(id, snapshot_date, snapshot_type, ref, team, disb_old/, 'LOG (id, snapshot_date, snapshot_type, ref, disb_old').replace(/t\.ref, t\.team, t\.d/, 't.ref, t.d'),
    squash(between(C060, 'lg as (', 'returning id\n)')).replace(/defaulter_date_repair_log \(id, snapshot_date, snapshot_type, ref, disb_old/, 'LOG (id, snapshot_date, snapshot_type, ref, disb_old'), 'the log line: a row\'s first line keeps the dates it was uploaded with');
});

test('the answer says what it found and what it left: the last-known rows, those that do not fit, those with one reading, those repaired, those still to do, those left alone', () => {
  const out = squash(CODE.slice(CODE.lastIndexOf('select (select count(*) from lk)')));
  assert.deepEqual([...out.matchAll(/\bas ([a-z_]+)/g)].map(m => m[1]), ['last_known_rows_in_these_days', 'of_them_not_fitting', 'one_reading_fits', 'repaired_now', 'still_to_do_run_again', 'left_alone_no_single_reading']);
  assert.match(out, /\(select count\(\*\) from one\) - \(select count\(\*\) from upd\) as still_to_do_run_again/);
});

test('the kept check runs the whole real schema, models the rule again, compares every row, tests a second run, a count, small runs, a narrow window and the undo, times two million rows, and breaks the file on purpose', () => {
  assert.match(CHECK, /readFileSync\(path\.join\(ROOT, 'db\/RUN-ME-071-repair-swapped-last-known-deck-dates\.sql'\)/);
  assert.match(CHECK, /readFileSync\(path\.join\(ROOT, 'db\/schema\.sql'\)/);
  assert.doesNotMatch(CHECK.replace(/\/\*[\s\S]*?\*\//, ''), /create table[^\n]*defaulter_snapshots/i, 'the table is the real one, never declared by hand (RUN-ME-061)');
  for (const s of ['every row of the table equals a MODEL', 'a second run changed', 'a count (max_rows 0) changed the book', 'small runs did not finish', 'the undo did not put every row back exactly', 'a customer still on the latest deck was touched', 'BROKEN ON PURPOSE']) assert.ok(CHECK.includes(s) || CHECK.includes(s.replace('every row of the table equals a MODEL', 'do not equal the model')), s);
  assert.match(CHECK, /generate_series\(1, 20000\) c/);
  assert.ok((CHECK.match(/^\s+\['[^\n]+',\s+(?:sub\(|f => sub\()/gm) || []).length >= 14, 'fourteen deliberate breaks or more, each of which must change the outcome');
});
