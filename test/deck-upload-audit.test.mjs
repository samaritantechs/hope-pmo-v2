/* db/RUN-ME-061-deck-uploads-date-audit-read-only.sql -- the lines that make it safe and true, pinned (docs/HANDOFF.md Part 90).

     "They might be in different orders per file so check starting with the defaulters one I sent" -- the owner, 16 Nov 2026

   The query reads the book and says, for every upload of the defaulter decks, how many customers' dates fit the loan system's
   own pattern as stored, how many fit only with day and month exchanged, and how the D.S column came out. Node cannot run SQL:
   the check that does (tools/db-checks/deck-upload-audit.mjs, run by hand on a PostgreSQL) is the proof; this is the guard that
   a later edit does not quietly make it write, drop the window, or part company with the rule db/RUN-ME-060 repairs by. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const AUDIT = readFileSync(new URL('../db/RUN-ME-061-deck-uploads-date-audit-read-only.sql', import.meta.url), 'utf8');
const REPAIR = readFileSync(new URL('../db/RUN-ME-060-repair-swapped-deck-dates.sql', import.meta.url), 'utf8');
const code = f => f.split('\n').filter(l => !/^\s*--/.test(l)).map(l => l.replace(/--.*$/, '')).join('\n');
const CODE = code(AUDIT);

test('it is read-only: not one statement that writes, creates, drops or grants', () => {
  assert.doesNotMatch(CODE, /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|vacuum|copy)\b/i, 'a read-only audit contains no statement that changes anything');
  assert.match(CODE, /^\s*set local jit = off;/m, 'the compiler is off (a long statement spent eight seconds compiling in the SQL editor once)');
  assert.equal((CODE.match(/\bselect\b/gi) || []).length >= 3, true);
  assert.match(AUDIT, /READ-ONLY: changes nothing/);
});

test('it judges by the same pattern and the same swap as the repair does: one definition of the rule', () => {
  // the three swapped dates (the CASE of each), word for word
  const cases = f => [...f.matchAll(/case when extract\(day from s\.(disb|expire|chronic)_date\) <= 12[\s\S]*?end as [dec]_s/g)].map(m => m[0].replace(/\s+/g, ' '));
  assert.equal(cases(code(REPAIR)).length, 3);
  assert.deepEqual(cases(CODE), cases(code(REPAIR)), 'the swap of a date is written once and the audit repeats it exactly');
  // the pattern: 91, 14 and DAYS ELAPSED 0 to 3, as stored and as exchanged
  assert.match(CODE, /r\.e - r\.d = 91 and r\.c - r\.e = 14 and r\.snapshot_date - r\.d - r\.days_elapsed between 0 and 3/);
  assert.match(CODE, /r\.e_s - r\.d_s = 91 and r\.c_s - r\.e_s = 14 and r\.snapshot_date - r\.d_s - r\.days_elapsed between 0 and 3/);
  assert.match(code(REPAIR), /y\.e - x\.d = 91 and z\.c - y\.e = 14 and c\.snapshot_date - x\.d - c\.de between 0 and 3/, 'and the repair still says the same');
});

/* THE FIRST RUN ON THE LIVE BOOK FAILED: `invalid input syntax for type uuid: "legacy"`. The query coalesced upload_batch with the
   text 'legacy', and on the real table upload_batch is a uuid (db/schema.sql); the kept check's fixture had declared it text, so the
   check passed on a table that is not the book's. A fixture is built from the real schema's column types, and this is the guard
   that keeps the two from parting company again: every column the audit reads has the type the schema gives it, in the fixture too. */
test('the audit reads upload_batch as the uuid it is, and the kept check builds its table from the real schema\'s types', () => {
  assert.match(CODE, /coalesce\(upload_batch::text, 'legacy'\)/, 'a uuid is turned to text before it meets a word');
  assert.doesNotMatch(CODE, /coalesce\(upload_batch,/, 'never coalesce the uuid itself with a text');
  const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
  const real = schema.slice(schema.indexOf('create table if not exists defaulter_snapshots ('));
  const realBlock = real.slice(0, real.indexOf('\n);'));
  const chk = readFileSync(new URL('../tools/db-checks/deck-upload-audit.mjs', import.meta.url), 'utf8');
  const fx = chk.slice(chk.indexOf('create table public.defaulter_snapshots ('));
  const fixBlock = fx.slice(0, fx.indexOf(');') + 2);
  const typeOf = (src, col) => (src.match(new RegExp('(?:^|[\\s,(])' + col + '\\s+([a-z]+)', 'm')) || [])[1];
  for (const col of ['snapshot_type', 'snapshot_date', 'disb_date', 'expire_date', 'chronic_date', 'days_elapsed', 'ds', 'upload_batch', 'created_at']) {
    assert.ok(typeOf(realBlock, col), 'db/schema.sql no longer declares ' + col + ' on defaulter_snapshots');
    assert.equal(typeOf(fixBlock, col), typeOf(realBlock, col), col + ': the fixture\'s type is not the book\'s');
  }
  assert.equal(typeOf(realBlock, 'upload_batch'), 'uuid', 'the book\'s upload_batch is a uuid');
  assert.match(chk, /route: 'X', batch: '', at:/, 'and the fixture has rows with no batch at all, which the audit shows as legacy');
});

test('it reads the days its first lines name, through the snapshot_date index, and says how a line is counted', () => {
  assert.match(AUDIT, /date '\d{4}-\d\d-\d\d' as from_day[^\n]*\n\s+date '\d{4}-\d\d-\d\d' as to_day/);
  assert.match(CODE, /s\.snapshot_date between win\.from_day and win\.to_day/);
  assert.match(CODE, /group by snapshot_date, snapshot_type, upload_batch/, 'one line per upload');
  for (const col of ['fit_as_stored', 'fit_only_if_swapped', 'neither', 'missing_a_date_or_days', 'ds_pair', 'ds_datelike', 'ds_other']) assert.match(CODE, new RegExp('as ' + col + '\\b'), col);
  assert.match(AUDIT, /2,076 and\s+--\s+fit_only_if_swapped 8,296/, 'the numbers the real file of 16 Nov reads as when stored the old way are written beside the query, to compare with');
});

test('the kept check runs the file itself on a PostgreSQL and breaks it on purpose', () => {
  const chk = readFileSync(new URL('../tools/db-checks/deck-upload-audit.mjs', import.meta.url), 'utf8');
  assert.match(chk, /db\/RUN-ME-061-deck-uploads-date-audit-read-only\.sql/);
  assert.match(chk, /WITH THE DAYS ELAPSED WITNESS TAKEN OUT THE ANSWER CHANGES/, 'a check that cannot fail when the file is broken proves nothing');
  assert.match(chk, /the audit left the book exactly as it was/, 'and that the audit changes nothing');
});
