/* db/RUN-ME-060-repair-swapped-deck-dates.sql -- the lines that make it safe, pinned (docs/HANDOFF.md Part 86).

     "we cant re-upload now - i hope the system autoupdates whats right brother" -- the owner, 16 Nov 2026

   The script changes dates in the book's hottest table, so what protects the book is written down here
   in a form `npm test` can read: Node cannot run SQL, and the check that does
   (tools/db-checks/deck-date-repair.mjs, run by hand on a PostgreSQL) is the proof; this is the guard
   that a later edit of the file does not quietly take a safety out. The first form of the rule had the
   91-and-14 pattern alone and was wrong (a loan whose expiry was moved by the number of days a swap
   moves its disbursement date fits it under a swapped date): the DAYS ELAPSED lines are the reason. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILE = readFileSync(new URL('../db/RUN-ME-060-repair-swapped-deck-dates.sql', import.meta.url), 'utf8');
const CODE = FILE.split('\n').filter(l => !/^\s*--/.test(l)).map(l => l.replace(/--.*$/, '')).join('\n');   // the statements, without a comment

test('a row is changed only when exactly one reading fits the loan system\'s pattern AND DAYS ELAPSED agrees', () => {
  assert.match(CODE, /having count\(\*\) = 1/, 'exactly one fitting reading, never the first of several');
  assert.match(CODE, /y\.e - x\.d = 91 and z\.c - y\.e = 14/, 'the pattern a reading must fit: 91 days to expiry, 14 more to chronic');
  assert.equal((CODE.match(/between 0 and 3/g) || []).length, 2, 'the DAYS ELAPSED witness: in the filter of what is already right AND in what a reading must fit');
  assert.match(CODE, /s\.snapshot_date - s\.disb_date - s\.days_elapsed between 0 and 3/);
  assert.match(CODE, /c\.snapshot_date - x\.d - c\.de between 0 and 3/);
  assert.match(CODE, /s\.days_elapsed is not null/, 'a row with no DAYS ELAPSED has no second witness and is left alone');
  assert.match(CODE, /not \(s\.expire_date - s\.disb_date = 91 and s\.chronic_date - s\.expire_date = 14/, 'a row whose dates already fit is never touched');
});

test('it begins with today only and a bounded run, and gives up rather than hold the book', () => {
  assert.match(FILE, /date '(\d{4}-\d\d-\d\d)' as from_day[^\n]*\n\s+date '\1' as to_day/, 'the first and the last day start the same: one day');
  const max = Number((FILE.match(/(\d+) as max_rows/) || [])[1]);
  assert.ok(max > 0 && max <= 30000, 'a run changes at most 30,000 rows (' + max + ')');
  assert.match(CODE, /set local lock_timeout = '3s'/);
  assert.match(CODE, /set local statement_timeout = '50s'/);
  assert.match(CODE, /limit \(select max_rows from win\)/);
});

test('every row it changes is logged with its old dates, and the undo is in the file', () => {
  assert.match(CODE, /insert into public\.defaulter_date_repair_log/);
  assert.match(CODE, /on conflict \(id\) do nothing/, 'a row\'s first log line keeps the dates it was uploaded with');
  assert.match(CODE, /alter table public\.defaulter_date_repair_log enable row level security/);
  assert.match(FILE, /-- UNDO:/);
  assert.match(FILE, /-- update public\.defaulter_snapshots s set disb_date = l\.disb_old, expire_date = l\.expire_old, chronic_date = l\.chronic_old/);
});

test('it writes the three dates of the deck table and nothing else, and deletes nothing', () => {
  const upd = CODE.slice(CODE.indexOf('update public.defaulter_snapshots'));
  assert.match(upd, /set disb_date = t\.d2, expire_date = t\.e2, chronic_date = t\.c2\s+from take t/);
  assert.doesNotMatch(upd.slice(0, upd.indexOf('returning')), /last_trans_date|due_date|status|arrears|team/, 'no column but the three dates is written');
  assert.match(CODE, /s\.disb_date = t\.d and s\.expire_date = t\.e and s\.chronic_date = t\.c/, 'a row changed since it was read is not overwritten');
  assert.doesNotMatch(CODE, /\b(delete|drop|truncate)\b/i, 'it removes nothing');
  assert.equal((CODE.match(/\bupdate\b/gi) || []).length, 1, 'one update, of the deck table');
});

test('the kept check runs the file itself and breaks it on purpose', () => {
  const chk = readFileSync(new URL('../tools/db-checks/deck-date-repair.mjs', import.meta.url), 'utf8');
  assert.match(chk, /db\/RUN-ME-060-repair-swapped-deck-dates\.sql/);
  assert.match(chk, /WITH THE DAYS ELAPSED WITNESS TAKEN OUT NOTHING WAS CHANGED WRONGLY/, 'a check that cannot fail when the file is broken proves nothing');
});
