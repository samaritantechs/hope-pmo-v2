/* db/RUN-ME-062-followup-list-dates-read-only.sql -- the lines that make it safe and true, pinned (docs/HANDOFF.md Part 91).

     "In the defaulter followup nav, try check if there exists any future date than today in the disb date column to confirm all dates
      are okay" -- the owner, 16 Nov 2026

   The query reads the register behind the Follow-up tab (followup_status) and says how many Disb dates are later than today and, the
   test that confirms, how many fit their own DAYS ELAPSED on the day of the deck that wrote them. Node cannot run SQL: the check that
   does (tools/db-checks/followup-dates-audit.mjs, run by hand on a PostgreSQL, on the REAL table definitions out of db/schema.sql and
   with seventeen deliberate breaks) is the proof; this is the guard that a later edit does not quietly make it write, name a
   customer, lean on a column the book may not have, part company with the table, or part company with the rule db/RUN-ME-060 uses. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILE = readFileSync(new URL('../db/RUN-ME-062-followup-list-dates-read-only.sql', import.meta.url), 'utf8');
const REPAIR = readFileSync(new URL('../db/RUN-ME-060-repair-swapped-deck-dates.sql', import.meta.url), 'utf8');
const AUDIT = readFileSync(new URL('../db/RUN-ME-061-deck-uploads-date-audit-read-only.sql', import.meta.url), 'utf8');
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const CHECK = readFileSync(new URL('../tools/db-checks/followup-dates-audit.mjs', import.meta.url), 'utf8');
// the comments out, but not a ' -- ' that sits inside a quoted string (the answer line says "-- the column is NOT all right")
const code = f => f.split('\n').map(l => {
  if (/^\s*--/.test(l)) return '';
  let q = false;
  for (let i = 0; i < l.length; i++) { if (l[i] === "'") q = !q; else if (!q && l[i] === '-' && l[i + 1] === '-') return l.slice(0, i); }
  return l;
}).join('\n');
const CODE = code(FILE);
const noStrings = s => s.replace(/'(?:[^']|'')*'/g, "''");
const DDL = (() => { const i = SCHEMA.indexOf('create table if not exists followup_status ('); return SCHEMA.slice(i, SCHEMA.indexOf('\n);', i)); })();
const colsOf = ddl => [...ddl.matchAll(/^\s{2}([a-z_]+) ([a-z]+)/gm)].map(m => [m[1], m[2]]);
const typeOf = col => (colsOf(DDL).find(([c]) => c === col) || [])[1];

test('it is read-only: not one statement that writes, creates, drops or grants, and a ceiling on how long it may run', () => {
  assert.doesNotMatch(CODE, /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|vacuum|copy|reindex|lock)\b/i, 'a read-only check contains no statement that changes anything');
  assert.match(CODE, /^\s*set local jit = off;/m, 'the compiler is off (the staff script once spent eight seconds compiling in the SQL editor)');
  assert.match(CODE, /^\s*set local statement_timeout = '30s';/m, 'a read has a ceiling, in case the register is far larger than it was on the test machine');
  assert.match(FILE, /READ-ONLY: changes nothing/);
  assert.equal((CODE.match(/\bfrom\s+public\.followup_status\b/gi) || []).length, 1, 'one table, read once; nothing else is touched');
  const tables = [...noStrings(CODE).matchAll(/\b(?:public|information_schema)\.([a-z_]+)/gi)].map(m => m[0].toLowerCase());
  assert.deepEqual([...new Set(tables)].sort(), ['information_schema.columns', 'public.followup_status'], 'no other table of the book is read, joined or listed');
});

test('"today" is the East Africa date, the same clock the portal reads', () => {
  assert.match(CODE, /\(now\(\) at time zone 'Africa\/Dar_es_Salaam'\)::date as today/);
});

test('the deck stamp is read in a way that works on a book without that optional column, and only that way', () => {
  assert.match(CODE, /nullif\(to_jsonb\(r\) ->> 'deck_date', ''\)::date/, 'read through to_jsonb: a missing column is a null, not an error');
  assert.doesNotMatch(noStrings(CODE), /deck_date/, 'deck_date is never named as a column: db/migrations/2026-08-04-followup-deck-date.sql is optional and run by hand');
  assert.match(CODE, /column_name = 'deck_date'/, 'and the answer says whether the column is there');
});

test('it prints no name and no number of a customer: a loan number and a team only', () => {
  assert.doesNotMatch(noStrings(CODE), /\b(full_name|contact|guarantor_name|guarantor_contact|last_comment|comment_by)\b/i);
  assert.match(CODE, /'    e\.g\. ' \|\| e\.ref \|\| ' \(team '/, 'the examples are the loan number and the team');
});

test('every column it reads is one the real table has, with the type its arithmetic needs', () => {
  const read = [...new Set([...noStrings(CODE).matchAll(/\br\.([a-z_]+)/g)].map(m => m[1]))].filter(c => c !== 'deck_date');
  assert.ok(read.length >= 6, 'the file reads the register through r.<column>: ' + read.join(', '));
  for (const c of read) assert.ok(typeOf(c), 'db/schema.sql has no column ' + c + ' on followup_status');
  assert.equal(typeOf('disb_date'), 'date');
  assert.equal(typeOf('last_trans'), 'date');
  assert.equal(typeOf('days_elapsed'), 'integer');
  assert.ok(typeOf('status') && typeOf('arrears') && typeOf('ref') && typeOf('team'));
});

test('it judges by the same window as the repair and the per-upload audit do: one definition of the rule', () => {
  assert.equal((CODE.match(/between 0 and 3/g) || []).length, 2, 'as stored and as exchanged');
  assert.match(code(REPAIR), /c\.snapshot_date - x\.d - c\.de between 0 and 3/);
  assert.match(code(AUDIT), /r\.snapshot_date - r\.d - r\.days_elapsed between 0 and 3/);
  // the exchange of day and month, the same expression the other two write for each of their dates
  const sw = f => [...f.matchAll(/case when extract\(day from ([\w.]+)\) <= 12 and extract\(day from \1\) <> extract\(month from \1\)\s+then make_date\(extract\(year from \1\)::int, extract\(day from \1\)::int, extract\(month from \1\)::int\)\s+else \1 end/g)].length;
  assert.equal(sw(CODE), 1);
  assert.ok(sw(code(AUDIT)) >= 3, 'the same shape as the per-upload audit');
});

test('the answer line says "all right" only when nothing is later than today AND the second test found no swapped date', () => {
  const answer = CODE.slice(CODE.indexOf("select 1, 'ANSWER'"), CODE.indexOf("select 2, 'the list the tab shows"));
  const order = [...answer.matchAll(/when \(select (n_future|n_swapped|n_tested) from p\) (>|=) 0/g)].map(m => m[1]);
  assert.deepEqual(order, ['n_future', 'n_swapped', 'n_tested'], 'later than today first, then a swapped date, then "no test could be made", and only then "all right"');
  assert.match(answer, /the column is all right' end/);
  assert.match(answer, /could not be tested/, 'and it says how many rows the second test could not judge');
});

test('the kept check runs the real DDL out of db/schema.sql and the real migration, and does not declare the table itself', () => {
  assert.match(CHECK, /db\/schema\.sql/);
  assert.match(CHECK, /db\/migrations\/2026-08-04-followup-deck-date\.sql/);
  assert.doesNotMatch(CHECK, /create table[^\n]*followup_status/i, 'a fixture declared by hand once passed on a table that was not the book\'s (RUN-ME-061, upload_batch)');
  assert.match(CHECK, /BROKEN ON PURPOSE/);
  assert.ok((CHECK.match(/^\s+\['[^\n]+',\s+\/.+\/g?, '.*'\],?$/gm) || []).length >= 17, 'seventeen deliberate breaks, each of which must change the answer');
  // the real table has the columns the check fills
  for (const c of ['ref', 'team', 'full_name', 'status', 'arrears', 'disb_date', 'last_trans', 'days_elapsed']) assert.ok(typeOf(c), 'the check fills ' + c + ', which the real table no longer has');
});
