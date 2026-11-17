/* db/RUN-ME-063-future-disb-dates-everywhere-read-only.sql -- the lines that make it safe and true, pinned (docs/HANDOFF.md Part 91, addendum).

     "I mean there could be future dates e.g into December 2026 than today's 17th Nov 2026" -- the owner, 17 Nov 2026

   The query reads the four tables that hold a Disb date and says how many are later than today, week by week for the stored decks, and how many
   customers' last-known deck row is one (the dates a CLEARED customer shows on Expected Defaulters). Node cannot run SQL: the check that does
   (tools/db-checks/future-disb-dates-audit.mjs, run by hand on a PostgreSQL, on the REAL table definitions out of db/schema.sql and with a list of
   deliberate breaks) is the proof; this is the guard that a later edit does not quietly make it write, name a customer, read a table it should not,
   lean on a column the book does not have, or part company with the rule the ghost rows are read by. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILE = readFileSync(new URL('../db/RUN-ME-063-future-disb-dates-everywhere-read-only.sql', import.meta.url), 'utf8');
const GHOSTS = readFileSync(new URL('../db/RUN-ME-055-defaulter-ghosts.sql', import.meta.url), 'utf8');
const REPAIR = readFileSync(new URL('../db/RUN-ME-060-repair-swapped-deck-dates.sql', import.meta.url), 'utf8');
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const CHECK = readFileSync(new URL('../tools/db-checks/future-disb-dates-audit.mjs', import.meta.url), 'utf8');
// the comments out, but not a ' -- ' that sits inside a quoted string
const code = f => f.split('\n').map(l => {
  if (/^\s*--/.test(l)) return '';
  let q = false;
  for (let i = 0; i < l.length; i++) { if (l[i] === "'") q = !q; else if (!q && l[i] === '-' && l[i + 1] === '-') return l.slice(0, i); }
  return l;
}).join('\n');
const CODE = code(FILE);
const noStrings = s => s.replace(/'(?:[^']|'')*'/g, "''");
const ddl = name => { const i = SCHEMA.indexOf('create table if not exists ' + name + ' ('); return SCHEMA.slice(i, SCHEMA.indexOf('\n);', i)); };
const typeOf = (table, col) => ((ddl(table).match(new RegExp('^\\s{2}' + col + ' ([a-z]+)', 'm')) || [])[1]);

test('it is read-only: not one statement that writes, creates, drops or grants; one process, a ceiling on how long it may run', () => {
  assert.doesNotMatch(CODE, /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|vacuum|copy|reindex|lock)\b/i, 'a read-only scan contains no statement that changes anything');
  assert.match(CODE, /^\s*set local jit = off;/m, 'the compiler is off');
  assert.match(CODE, /^\s*set local statement_timeout = '45s';/m, 'a read of the largest table has a ceiling');
  assert.match(CODE, /^\s*set local max_parallel_workers_per_gather = 0;/m, 'one process: gentle on a book people are working on');
  assert.match(FILE, /READ-ONLY: changes nothing/);
});

test('it reads exactly the four tables that hold a Disb date, and no other', () => {
  const tables = [...new Set([...noStrings(CODE).matchAll(/\bpublic\.([a-z_]+)/gi)].map(m => m[1].toLowerCase()))].sort();
  assert.deepEqual(tables, ['defaulter_snapshots', 'followup_status', 'loans', 'repayment_snapshots']);
  for (const t of tables) assert.match(ddl(t), /\n\s+disb_date date,/, 'db/schema.sql: ' + t + ' has a disb_date date column');
  // and those are all of them: no other table of the book has a disb_date column
  const holders = [...SCHEMA.matchAll(/create table if not exists ([a-z_]+) \(([\s\S]*?)\n\);/g)].filter(m => /\n\s+disb_date date/.test(m[2])).map(m => m[1]).sort();
  assert.deepEqual(holders, tables, 'a new table with a disbursement date has to be read here too');
});

test('"today" is the East Africa date, the same clock the portal reads', () => {
  assert.match(CODE, /\(now\(\) at time zone 'Africa\/Dar_es_Salaam'\)::date as today/);
});

test('it prints no name and no number of a customer: a loan number and a team only', () => {
  assert.doesNotMatch(noStrings(CODE), /\b(full_name|contact|guarantor_name|guarantor_contact|docket_no|momo|account_no)\b/i);
  assert.match(CODE, /'    e\.g\. ' \|\| e\.ref \|\| ' \(team '/, 'the examples are the loan number and the team');
});

test('every column it reads is one the real table has, with the type its arithmetic needs', () => {
  for (const c of ['ref', 'team', 'snapshot_type', 'snapshot_date', 'disb_date', 'last_trans_date', 'created_at']) assert.ok(typeOf('defaulter_snapshots', c), 'defaulter_snapshots.' + c);
  for (const c of ['snapshot_date', 'disb_date', 'last_trans_date']) assert.ok(typeOf('repayment_snapshots', c), 'repayment_snapshots.' + c);
  for (const c of ['status', 'arrears', 'disb_date']) assert.ok(typeOf('followup_status', c), 'followup_status.' + c);
  assert.ok(typeOf('loans', 'disb_date'));
  for (const [t, c] of [['defaulter_snapshots', 'disb_date'], ['defaulter_snapshots', 'last_trans_date'], ['defaulter_snapshots', 'snapshot_date'], ['repayment_snapshots', 'disb_date'], ['repayment_snapshots', 'last_trans_date'], ['repayment_snapshots', 'snapshot_date'], ['followup_status', 'disb_date'], ['loans', 'disb_date']]) assert.equal(typeOf(t, c), 'date', t + '.' + c + ' is a date');
  assert.equal(typeOf('defaulter_snapshots', 'created_at'), 'timestamptz');
  // every s.<column> of the decks the file names
  const read = [...new Set([...noStrings(CODE).matchAll(/\bs\.([a-z_]+)/g)].map(m => m[1]))];
  assert.ok(read.length >= 5);
  for (const c of read) assert.ok(typeOf('defaulter_snapshots', c), 'db/schema.sql has no column ' + c + ' on defaulter_snapshots');
});

test('"the last-known row" is the rule the ghost rows are read by: the newest current row of a customer in a team, by day and then by upload', () => {
  // RUN-ME-055's function, written once there: current rows only, newest snapshot_date, then newest created_at, per (team, ref)
  assert.match(GHOSTS, /d\.snapshot_type = 'current'\s+order by d\.ref, d\.snapshot_date desc, d\.created_at desc/);
  assert.match(CODE, /n\.snapshot_type = 'current'/);
  assert.match(CODE, /\(n\.snapshot_date, n\.created_at\) > \(f\.day, f\.created_at\)/, 'a row is the newest when no current row has a later day, or the same day and a later upload');
  assert.match(CODE, /n\.ref = f\.ref and n\.team is not distinct from f\.team/, 'a customer is a ref in a team, and a customer with no team is still one');
  assert.match(CODE, /f\.day < \(select latest_cur from dall\)/, 'and a customer on the latest current deck is not a ghost: the deck is read right');
  assert.match(CODE, /max\(day\) filter \(where kind = 'current'\) as latest_cur/);
});

test('it exchanges day and month the way the repair and the other audits do: one definition of the rule', () => {
  const sw = f => [...f.matchAll(/case when extract\(day from ([\w.]+)\) <= 12 and extract\(day from \1\) <> extract\(month from \1\)\s+then make_date\(extract\(year from \1\)::int, extract\(day from \1\)::int, extract\(month from \1\)::int\)\s+else \1 end/g)].length;
  assert.equal(sw(CODE), 1);
  assert.ok(sw(code(REPAIR)) >= 3);
});

test('the verdict says "no Disb date" only when every one of the four tables is empty of a later date, and says that this is not proof', () => {
  const answer = CODE.slice(CODE.indexOf("select 1, 'ANSWER'"), CODE.indexOf("select 2, 'Defaulters Followup tab"));
  assert.match(answer, /\(select n_shown_fut \+ n_hidden_fut from rg\) \+ \(select n_d from dsum\) \+ \(select n_d from rp\) \+ \(select n_d from ln\) = 0/);
  assert.match(FILE, /not proof the dates are right: a swapped date reaches the future only when its real day is the 12th/);
});

test('the kept check runs the real DDL out of db/schema.sql (the enum and the indexes too) and does not declare a table itself', () => {
  assert.match(CHECK, /db\/schema\.sql/);
  assert.match(CHECK, /loan_stage/);
  assert.match(CHECK, /idx_def_snap_team_ref/);
  assert.doesNotMatch(CHECK.replace(/\/\*[\s\S]*?\*\//, ''), /create table[^\n]*(followup_status|defaulter_snapshots|repayment_snapshots|loans)\b/i, 'a fixture declared by hand once passed on a table that was not the book\'s (RUN-ME-061, upload_batch)');
  assert.match(CHECK, /BROKEN ON PURPOSE/);
  assert.ok((CHECK.match(/^\s+\['[^\n]+',\s+(?:all\(|src =>)/gm) || []).length >= 22, 'twenty-two deliberate breaks, each of which must change the answer');
});
