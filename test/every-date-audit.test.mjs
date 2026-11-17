/* db/RUN-ME-064-every-date-in-the-book-read-only.sql -- the lines that make it safe and true, pinned (docs/HANDOFF.md Part 92).

     "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026

   The query finds every date and timestamp column of the book from the catalogue and reports, for each, how many values are later than today and how many
   are before 2020. Node cannot run SQL: the check that does (tools/db-checks/every-date-audit.mjs, run by hand on a PostgreSQL, over the WHOLE of db/schema.sql
   and compared column by column with direct queries) is the proof; this is the guard that a later edit does not quietly make it write, name a table
   (the point is that it does not have to be told where to look), read another schema, or lose the way a normal later date is told from a wrong one. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILE = readFileSync(new URL('../db/RUN-ME-064-every-date-in-the-book-read-only.sql', import.meta.url), 'utf8');
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const CHECK = readFileSync(new URL('../tools/db-checks/every-date-audit.mjs', import.meta.url), 'utf8');
const code = f => f.split('\n').map(l => {
  if (/^\s*--/.test(l)) return '';
  let q = false;
  for (let i = 0; i < l.length; i++) { if (l[i] === "'") q = !q; else if (!q && l[i] === '-' && l[i + 1] === '-') return l.slice(0, i); }
  return l;
}).join('\n');
const CODE = code(FILE);
const noStrings = s => s.replace(/'(?:[^']|'')*'/g, "''");

test('it is read-only: not one statement that writes, creates, drops or grants; one process, a ceiling on how long it may run', () => {
  assert.doesNotMatch(noStrings(CODE), /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|vacuum|copy|reindex|lock)\b/i, 'a read-only scan contains no statement that changes anything');
  assert.match(CODE, /^\s*set local jit = off;/m);
  assert.match(CODE, /^\s*set local statement_timeout = '45s';/m, 'a scan of every table has a ceiling');
  assert.match(CODE, /^\s*set local max_parallel_workers_per_gather = 0;/m, 'one process: gentle on a book people are working on');
  assert.match(FILE, /READ-ONLY: changes nothing/);
  // the dynamic queries it builds are selects over the one schema, nothing else
  assert.match(CODE, /'select count\(\*\) as n, '/);
  assert.match(CODE, /format\(' from public\.%I', table_name\)/);
});

test('it finds the tables and the columns from the catalogue, so a table made by a migration is in it: it names no table of the book', () => {
  const tables = [...SCHEMA.matchAll(/create table if not exists ([a-z_]+) \(/g)].map(m => m[1]);
  assert.ok(tables.length >= 25, 'db/schema.sql has the tables: ' + tables.length);
  for (const t of tables) assert.doesNotMatch(noStrings(CODE), new RegExp('\\b' + t + '\\b'), 'the file does not name ' + t + ': it asks the catalogue');
  assert.match(CODE, /information_schema\.columns/);
  assert.match(CODE, /table_type = 'BASE TABLE'/, 'a view is not a table of the book');
  assert.match(CODE, /table_schema = 'public'/);
  assert.match(CODE, /data_type in \('date', 'timestamp with time zone', 'timestamp without time zone'\)/);
});

test('"today" is the East Africa date for a date, and a day ahead of now for a moment; the old line is 2020', () => {
  assert.match(FILE, /\(now\(\) at time zone ''Africa\/Dar_es_Salaam''\)::date/);
  assert.match(FILE, /\(now\(\) \+ interval ''1 day''\)/);
  assert.match(FILE, /< date ''2020-01-01''/);
});

test('a later date is normal in an expiry, a promise, a due date, a schedule, a start or end, tomorrow\'s sheet; a birth date from the past is normal; nothing else is', () => {
  const m = CODE.match(/column_name ~\* '\(([^)]+)\)'\) +as future_ok/);
  assert.ok(m, 'the future_ok rule is there');
  const words = m[1].split('|').sort();
  for (const w of ['expire', 'chronic', 'due', 'promise', 'schedule', 'start', 'end', 'until', 'next', 'deadline', 'valid', 'retire', 'snapshot_date']) assert.ok(words.includes(w), w + ' is a column where a later date is normal');
  for (const w of ['paid', 'disb', 'last_trans', 'created', 'comment', 'approved', 'decided', 'updated', 'registered']) assert.ok(!words.some(x => w.includes(x)), w + ' is NOT a column where a later date is normal');
  assert.match(CODE, /\(cols\.column_name ~\* '\(birth\|dob\)'\)/);
  // every date column of the real schema that carries "later is normal" in its name is one the owner's own data says so for
  const dateCols = [...SCHEMA.matchAll(/^\s{2}([a-z_]+) (date|timestamptz)\b/gm)].map(x => x[1]);
  const normal = dateCols.filter(c => new RegExp('(' + m[1] + ')', 'i').test(c));
  assert.ok(normal.length >= 5 && normal.every(c => /expire|chronic|due|promise|schedule|start|end|until|next|deadline|valid|retire|snapshot_date|ended|started/i.test(c)), normal.join(','));
});

test('the answer says which columns have a later date that is not normal, which have an old one, and puts them first', () => {
  assert.match(CODE, /case when n_fut > 0 and not future_ok then 'FUTURE\?' when n_old > 0 and not birth then 'OLD\?' else '' end as flag/);
  assert.match(CODE, /order by case g\.flag when 'FUTURE\?' then 0 when 'OLD\?' then 1 else 2 end, g\.table_name, g\.k/);
  assert.match(CODE, /\(select count\(\*\) from g where flag = 'FUTURE\?'\)/);
  assert.match(CODE, /\(select count\(\*\) from g where flag = 'OLD\?'\)/);
  assert.match(FILE, /A flagged line is a place to look, not a proof/);
});

test('the kept check runs the whole real db/schema.sql, compares EVERY column with a direct query and breaks the file on purpose', () => {
  assert.match(CHECK, /readFileSync\(path\.join\(ROOT, 'db\/schema\.sql'\)/);
  assert.doesNotMatch(CHECK.replace(/\/\*[\s\S]*?\*\//, ''), /create table[^\n]*(received_payments|defaulter_snapshots|repayment_snapshots|followup_status|loans)\b/i, 'a fixture declared by hand once passed on a table that was not the book\'s (RUN-ME-061)');
  assert.match(CHECK, /cat\.length === 82/);
  assert.match(CHECK, /BROKEN ON PURPOSE/);
  assert.ok((CHECK.match(/^\s+\['[^\n]+',\s+all\(/gm) || []).length >= 17, 'seventeen deliberate breaks, each of which must change the answer');
  // and the real schema still has as many date columns as the check says
  const n = [...SCHEMA.matchAll(/(?:^|[\s,(])([a-z_]+) (?:date|timestamptz)\b/gm)].length;
  assert.ok(n >= 60, 'db/schema.sql: date and timestamp columns found by a plain read: ' + n + ' (the check counts 82 from the catalogue)');
});
