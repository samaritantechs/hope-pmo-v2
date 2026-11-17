/* db/RUN-ME-066-repair-swapped-last-trans-dates.sql -- the lines that make it safe and true, pinned (docs/HANDOFF.md Part 94).

     "... we have last trans date column ..." -- the owner, 17 Nov 2026

   The file changes `last_trans_date` of the deck rows, in the uploads that carry two proofs of their own that they were read day-first, and nothing else. Node cannot run SQL: the check
   that does (tools/db-checks/last-trans-repair.mjs, run by hand on a PostgreSQL over the WHOLE of db/schema.sql and the real db/RUN-ME-060, compared row by row with a model of the rule
   written again, with the file's undo, its runs one after another, a narrow window, a book that never ran RUN-ME-060, a book of the live book's size, and twenty-eight deliberate breaks)
   is the proof; this is the guard that a later edit does not quietly change a column it should not, print a name, read a table it should not, lose its undo, its limits or either of
   its two proofs, or part company with the pattern RUN-ME-060 reads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILE = readFileSync(new URL('../db/RUN-ME-066-repair-swapped-last-trans-dates.sql', import.meta.url), 'utf8');
const REPAIR60 = readFileSync(new URL('../db/RUN-ME-060-repair-swapped-deck-dates.sql', import.meta.url), 'utf8');
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const CHECK = readFileSync(new URL('../tools/db-checks/last-trans-repair.mjs', import.meta.url), 'utf8');
const code = f => f.split('\n').map(l => {
  if (/^\s*--/.test(l)) return '';
  let q = false;
  for (let i = 0; i < l.length; i++) { if (l[i] === "'") q = !q; else if (!q && l[i] === '-' && l[i + 1] === '-') return l.slice(0, i); }
  return l;
}).join('\n');
const CODE = code(FILE), CODE60 = code(REPAIR60);
const noStrings = s => s.replace(/'(?:[^']|'')*'/g, "''");
const ddl = name => { const i = SCHEMA.indexOf('create table if not exists ' + name + ' ('); return SCHEMA.slice(i, SCHEMA.indexOf('\n);', i)); };
const typeOf = (t, c) => ((ddl(t).match(new RegExp('^\\s+' + c + '\\s+([a-z]+)', 'm')) || [])[1]);

test('it writes ONE column of ONE table of the book: last_trans_date of the deck rows', () => {
  const sets = [...noStrings(CODE).matchAll(/\bset\s+([a-z_]+)\s*=/gi)].map(m => m[1].toLowerCase()).filter(c => !['lock_timeout', 'statement_timeout', 'jit'].includes(c));
  assert.deepEqual([...new Set(sets)], ['last_trans_date'], 'every update sets last_trans_date and only last_trans_date');
  assert.deepEqual([...noStrings(CODE).matchAll(/\bupdate\s+public\.([a-z_]+)/gi)].map(m => m[1]), ['defaulter_snapshots'], 'one update, of the deck rows');
  assert.doesNotMatch(noStrings(CODE), /\b(delete|drop|truncate|alter\s+table\s+public\.(?!defaulter_last_trans_repair_log)|grant|revoke|vacuum)\b/i);
  const tables = [...new Set([...noStrings(CODE).matchAll(/\bpublic\.([a-z_]+)/gi)].map(m => m[1].toLowerCase()))].sort();
  assert.deepEqual(tables, ['defaulter_date_repair_log', 'defaulter_last_trans_repair_log', 'defaulter_snapshots'], 'the deck rows, RUN-ME-060\'s log (read) and its own log');
  assert.doesNotMatch(noStrings(CODE), /\binsert\s+into\s+public\.(?!defaulter_last_trans_repair_log)/i, 'it writes to no table but its own log');
});

test('it has its limits, its log, its undo and its safe re-run', () => {
  assert.match(CODE, /^\s*set local lock_timeout = '3s';/m);
  assert.match(CODE, /^\s*set local statement_timeout = '50s';/m);
  assert.match(CODE, /^\s*set local jit = off;/m);
  assert.match(CODE, /create table if not exists public\.defaulter_last_trans_repair_log/);
  assert.match(CODE, /alter table public\.defaulter_last_trans_repair_log enable row level security/);
  assert.equal((CODE.match(/on conflict \(id\) do nothing/g) || []).length, 1, 'a row\'s first log line keeps the date it was uploaded with, and a second run adds nothing');
  assert.match(CODE, /limit \(select max_rows from win\)/, 'one run changes at most max_rows');
  assert.match(CODE, /where s\.id = t\.id and s\.last_trans_date = t\.lt0/, 'a row is only changed if it still holds the date that was read');
  const undo = FILE.slice(FILE.indexOf('-- UNDO'));
  assert.match(undo, /^-- update public\.defaulter_snapshots s set last_trans_date = l\.last_trans_old$/m, 'the undo');
  assert.match(undo, /^--  where s\.id = l\.id and s\.last_trans_date = l\.last_trans_new and l\.snapshot_date between date '2026-11-16' and date '2026-11-16';$/m, 'the undo only puts back what this file wrote');
  assert.match(FILE, /\b50000 as max_rows/, 'the same row limit the owner ran RUN-ME-060 with');
});

test('a book where RUN-ME-060 was never run is told so in plain words, before anything is made or changed', () => {
  const guard = CODE.indexOf("to_regclass('public.defaulter_date_repair_log') is null");
  assert.ok(guard > 0, 'the guard reads whether RUN-ME-060\'s log exists');
  assert.match(CODE, /raise exception 'Run db\/RUN-ME-060 first/);
  assert.ok(guard < CODE.indexOf('create table if not exists public.defaulter_last_trans_repair_log'), 'before its own log is made');
  assert.ok(guard < CODE.indexOf('update public.defaulter_snapshots'), 'before any row is changed');
});

test('an upload is changed only with BOTH proofs, each written once, and the three numbers are one', () => {
  assert.equal((CODE.match(/\b3 as proof_rows/g) || []).length, 1, 'the number of rows that prove an upload is written once');
  assert.equal((CODE.match(/\(select proof_rows from win\)/g) || []).length, 3, 'the two proofs and the verdict\'s words read it');
  assert.match(CODE, /\(u\.batch is not null\s+and u\.n_rep >= \(select proof_rows from win\)\s+and 2 \* u\.n_rep >= u\.n_fit\s+and u\.n_wit >= \(select proof_rows from win\)\) as swapped/,
    'an upload has an upload number, RUN-ME-060 put right at least the proof rows of it and at least half of its rows that fit, and at least the proof rows of it show the exchange');
  assert.match(CODE, /count\(\*\) filter \(where repaired\) as n_rep/);
  assert.match(CODE, /count\(\*\) filter \(where fits\) as n_fit/);
  assert.match(CODE, /count\(\*\) filter \(where wit\) as n_wit/);
  assert.match(CODE, /\(l\.id is not null\) as repaired/, 'repaired is read from RUN-ME-060\'s log, never decided here');
  assert.match(CODE, /left join public\.defaulter_date_repair_log l on l\.id = s\.id/);
});

test('the second proof is: the loan\'s dates fit, the date is impossible as stored and possible the other way round', () => {
  assert.match(CODE, /\(d\.fits and d\.lt0 is not null and d\.lt0_sw <> d\.lt0\s+and not \(d\.lt0 between d\.dd and d\.day\) and d\.lt0_sw between d\.dd and d\.day\) as wit/);
});

test('a row is changed only when the loan\'s dates fit and the other reading lies between the Disb date and the deck\'s day', () => {
  assert.match(CODE, /select c\.\* from cand c where c\.fits and c\.lt0_sw between c\.dd and c\.day/);
  assert.match(CODE, /select xv\.\* from xv where xv\.swapped and xv\.amb and not xv\.changed/, 'a swapped upload, a date with another reading, and not changed before');
  assert.match(CODE, /\(d\.lt0 is not null and d\.lt0_sw <> d\.lt0\) as amb/);
});

test('the proof is read from the date as it was uploaded, so what an earlier run changed does not take it away from the rest of its upload', () => {
  assert.match(CODE, /coalesce\(g\.last_trans_old, s\.last_trans_date\) as lt0/);
  assert.match(CODE, /left join public\.defaulter_last_trans_repair_log g on g\.id = s\.id/);
  assert.match(CODE, /select t\.id, t\.day, t\.typ, t\.ref, t\.batch, t\.lt0, t\.lt0_sw from take t/, 'the log keeps the date as it was uploaded');
});

test('the loan system\'s pattern is the one RUN-ME-060 reads: 91 days, 14 days, DAYS ELAPSED 0 to 3, and the same exchange of day and month', () => {
  const pat = f => (f.match(/expire_date - s\.disb_date = 91 and s\.chronic_date - s\.expire_date = 14\s+and s\.snapshot_date - s\.disb_date - s\.days_elapsed between 0 and 3/g) || []).length;
  assert.equal(pat(CODE), 1);
  assert.ok(pat(CODE60) >= 1, 'RUN-ME-060 states the same pattern');
  const sw = f => [...f.matchAll(/case when extract\(day from ([\w.]+)\) <= 12 and extract\(day from \1\) <> extract\(month from \1\)\s+then make_date\(extract\(year from \1\)::int, extract\(day from \1\)::int, extract\(month from \1\)::int\)\s+else \1 end/g)].length;
  assert.equal(sw(CODE), 1, 'the exchange is written once');
  assert.ok(sw(CODE60) >= 3, 'RUN-ME-060 writes the same one');
});

test('every column it reads or writes is one the real tables have, with the type its arithmetic needs', () => {
  for (const [c, t] of [['id', 'uuid'], ['ref', 'text'], ['snapshot_date', 'date'], ['snapshot_type', 'text'], ['upload_batch', 'uuid'], ['disb_date', 'date'], ['expire_date', 'date'], ['chronic_date', 'date'], ['days_elapsed', 'integer'], ['last_trans_date', 'date']]) {
    assert.equal(typeOf('defaulter_snapshots', c), t, 'defaulter_snapshots.' + c);
  }
  // its own log carries the types of the columns it copies
  const log = CODE.slice(CODE.indexOf('create table if not exists public.defaulter_last_trans_repair_log'), CODE.indexOf('enable row level security'));
  assert.match(log, /id uuid primary key/);
  assert.match(log, /snapshot_date date, snapshot_type text, ref text, upload_batch uuid/);
  assert.match(log, /last_trans_old date, last_trans_new date/);
  // RUN-ME-060's log has the column the proof joins on, typed as the deck row's id
  assert.match(REPAIR60, /create table if not exists public\.defaulter_date_repair_log \(\s+id uuid primary key/);
  // the columns the file reads through its alias of the deck rows are real ones
  const cols = [...new Set([...noStrings(CODE).matchAll(/\bs\.([a-z_]+)/g)].map(m => m[1]))];
  assert.ok(cols.length >= 8, 'the file reads the deck rows through s.<column>: ' + cols);
  for (const c of cols) assert.ok(typeOf('defaulter_snapshots', c), 'db/schema.sql has no column ' + c + ' on defaulter_snapshots');
});

test('it prints no name and no number of a customer: dates, the day and kind of an upload, and the first part of its number', () => {
  assert.doesNotMatch(noStrings(CODE), /\b(full_name|contact|guarantor_name|guarantor_contact|docket_no|nearest_landmark|branch|team|zone|arrears|balance)\b/i);
  assert.match(CODE, /coalesce\(left\(v\.batch::text, 8\), 'no upload number'\)/);
  assert.doesNotMatch(noStrings(CODE.slice(CODE.indexOf('select z.what, z.answer'))), /\bref\b/i, 'the answer names no loan number');
});

test('the answer counts every kind of row it leaves alone and lists every upload, so nothing is left alone in silence', () => {
  for (const words of ["'changed by THIS run'", "'still to do: run this file again until this says 0'", "'left alone: the loan''s dates do not fit the pattern", "'left alone: the other reading is not possible", "'left alone: rows with another reading in uploads NOT found swapped"]) {
    assert.ok(FILE.includes(words), 'the answer says ' + words);
  }
  for (const words of ['LEFT ALONE, no upload number on these rows', "then 'SWAPPED'", 'left alone, RUN-ME-060 put right none of it', 'left alone, RUN-ME-060 put right too few of its rows', 'left alone, no Last trans date of it shows the exchange']) {
    assert.ok(FILE.includes(words), 'an upload\'s verdict can be ' + words);
  }
});

test('the kept check runs the whole real db/schema.sql and the real RUN-ME-060, compares row by row with a model, tries the undo, the runs one after another, a narrow window, a book without RUN-ME-060, a book of the live size, and breaks the file on purpose', () => {
  assert.match(CHECK, /readFileSync\(path\.join\(ROOT, 'db\/schema\.sql'\)/);
  assert.match(CHECK, /readFileSync\(path\.join\(ROOT, 'db\/RUN-ME-060-repair-swapped-deck-dates\.sql'\)/);
  assert.doesNotMatch(CHECK.replace(/\/\*[\s\S]*?\*\//, ''), /create table[^\n]*defaulter_snapshots\b/i, 'a fixture declared by hand once passed on a table that was not the book\'s (RUN-ME-061)');
  assert.match(CHECK, /undo: true/);
  assert.match(CHECK, /Run db\\\/RUN-ME-060 first/);
  assert.match(CHECK, /process\.env\.SCALE/);
  assert.match(CHECK, /BROKEN ON PURPOSE/);
  assert.ok((CHECK.match(/^\s+\['[^\n]+',\s+rep\(/gm) || []).length >= 26, 'twenty-six deliberate breaks or more, each of which must change the outcome');
});
