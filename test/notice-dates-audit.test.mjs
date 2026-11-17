/* db/RUN-ME-067-notice-and-deduction-dates-read-only.sql -- the lines that make it safe and true, pinned (docs/HANDOFF.md Part 97).

     "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026
     (the scan of RUN-ME-064 flagged demand_notices.notice_date / created_at and pmo_deductions.discovery_date: dates later than today)

   The file changes nothing: it reads each demand notice's date against the day its own number carries and each PMO deduction's discovery date against the order
   money received -> discovered -> case submitted, and it decides whether anything is repaired, and what. Node cannot run SQL: the check that does (tools/db-checks/notice-dates-audit.mjs,
   run by hand on a PostgreSQL over the WHOLE of db/schema.sql and the two migrations that add notice_id and upload_date, compared line by line with a model written again, with a book a hundred
   times the live one and twenty-six deliberate breaks) is the proof; this is the guard that a later edit does not make it write, print a name or a number, read another table, lose its
   limits, or part company with the format of the number the app makes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILE = readFileSync(new URL('../db/RUN-ME-067-notice-and-deduction-dates-read-only.sql', import.meta.url), 'utf8');
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const MIG_ID = readFileSync(new URL('../db/migrations/2026-07-26-demand-notice-id.sql', import.meta.url), 'utf8');
const MIG_STAMP = readFileSync(new URL('../db/migrations/2026-07-28-upload-stamp.sql', import.meta.url), 'utf8');
const CHECK = readFileSync(new URL('../tools/db-checks/notice-dates-audit.mjs', import.meta.url), 'utf8');
const PORTAL = readFileSync(new URL('../api/_lib/portal-core.js', import.meta.url), 'utf8');
const REPAIR60 = readFileSync(new URL('../db/RUN-ME-060-repair-swapped-deck-dates.sql', import.meta.url), 'utf8');
const code = f => f.split('\n').map(l => {
  if (/^\s*--/.test(l)) return '';
  let q = false;
  for (let i = 0; i < l.length; i++) { if (l[i] === "'") q = !q; else if (!q && l[i] === '-' && l[i + 1] === '-') return l.slice(0, i); }
  return l;
}).join('\n');
const CODE = code(FILE);
const noStrings = s => s.replace(/'(?:[^']|'')*'/g, "''");
const ddl = name => { const i = SCHEMA.indexOf('create table if not exists ' + name + ' ('); return SCHEMA.slice(i, SCHEMA.indexOf('\n);', i)); };
const typeOf = (t, c) => ((ddl(t).match(new RegExp('(?:^|[\\s,(])' + c + '\\s+([a-z]+)')) || [])[1]);       // a table's DDL may hold several columns on one line

test('it changes nothing: no statement that writes or alters, and no table but the two it reads', () => {
  assert.doesNotMatch(noStrings(CODE), /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|vacuum|copy|call|do)\b/i);
  const tables = [...new Set([...noStrings(CODE).matchAll(/\b(?:public|information_schema)\.([a-z_]+)/gi)].map(m => m[1].toLowerCase()))].sort();
  assert.deepEqual(tables, ['demand_notices', 'pmo_deductions']);
  assert.match(CODE, /^\s*set local jit = off;/m);
  assert.match(CODE, /^\s*set local statement_timeout = '30s';/m);
});

test('it prints no name, no loan number, no notice number and no amount: counts, dates and the first eight characters of a row id', () => {
  // the notice number is READ once (to take the day out of it) and never printed
  assert.equal((noStrings(CODE).match(/\bnotice_id\b/g) || []).length, 1);
  assert.match(CODE, /regexp_match\(n\.notice_id, /);
  assert.doesNotMatch(noStrings(CODE), /\b(ref|full_name|contact|team|customer|staff|reporter|issued_by|dept|hr_notes|hr_by|amount_taken|deduction|to_pay|deducted|remaining|total_demand|arrears_at_notice|fine|letter|case_id)\b/i);
  assert.match(CODE, /'    e\.g\. notice ' \|\| left\(e\.id::text, 8\)/);
  assert.match(CODE, /'    e\.g\. deduction ' \|\| left\(d\.id::text, 8\)/);
});

test('every step is MATERIALIZED: left to be inlined, the planner repeated the number\'s pattern match about fifty times a row (10 s for 5,000 notices; 0.26 s now)', () => {
  for (const cte of ['m', 'v', 'w', 'pd']) assert.match(CODE, new RegExp('\\b' + cte + ' as materialized \\('), 'the step ' + cte);
});

test('the day is the day in East Africa, in each of the three places that ask for one: the notice stamp, the deduction\'s submission and "today"', () => {
  assert.match(CODE, /\(n\.created_at at time zone 'Africa\/Dar_es_Salaam'\)::date as cd/);
  assert.match(CODE, /\(p\.submitted_at at time zone 'Africa\/Dar_es_Salaam'\)::date as sd/);
  assert.match(CODE, /\(now\(\) at time zone 'Africa\/Dar_es_Salaam'\)::date as d/);
  assert.doesNotMatch(CODE, /at time zone 'UTC'|current_date/i);
});

test('the number\'s pattern is the format the app makes: HMCL/<initials>/<dd>/<mm>/<yyyy>, with -2, -3 for a repeat; and a day that does not exist is not a day', () => {
  // the app's own template and suffix (nextNoticeId)
  assert.match(PORTAL, /const base = `HMCL\/\$\{initials\}\/\$\{dd\}\/\$\{m\}\/\$\{y\}`;/);
  assert.match(PORTAL, /`\$\{base\}-\$\{Math\.max\(\.\.\.used\) \+ 1\}`/);
  const pat = new RegExp((FILE.match(/regexp_match\(n\.notice_id, '([^']+)'\)/) || [])[1]);
  for (const ok of ['HMCL/AB/09/12/2026', 'HMCL/XYZ/31/01/2026', 'HMCL/AB/05/06/2026-2', 'HMCL/AB/05/06/2026-12']) assert.match(ok, pat, ok);
  for (const no of ['hmcl/ab/09/12/2026', 'HMCL/AB/9/12/2026', 'HMCL/AB/09/12/26', 'HMCL//09/12/2026', 'HMCL/AB/09/12/2026-', 'HMCL/AB/09/12/2026 ', 'XHMCL/AB/09/12/2026', '']) assert.doesNotMatch(no, pat, JSON.stringify(no));
  // a typed number is no day unless it exists: the guard is a nested CASE (the planner may reorder the parts of one AND, never the branches of a CASE)
  assert.match(CODE, /case when m\.p is null then null else\s+case when \(m\.p\)\[2\]::int between 1 and 12 and \(m\.p\)\[3\]::int between 2000 and 2100 then\s+case when \(m\.p\)\[1\]::int between 1 and extract\(day from \(make_date\(\(m\.p\)\[3\]::int, \(m\.p\)\[2\]::int, 1\) \+ interval '1 month' - interval '1 day'\)\)::int\s+then make_date\(/);
});

test('the exchange of day and month is the one the date repairs write (RUN-ME-060): twelve or under, and not the month', () => {
  const sw = f => [...f.matchAll(/case when (?:v\.idd|p\.discovery_date) is not null and extract\(day from ([\w.]+)\) <= 12 and extract\(day from \1\) <> extract\(month from \1\)\s+then make_date\(extract\(year from \1\)::int, extract\(day from \1\)::int, extract\(month from \1\)::int\) end/g)].length;
  assert.equal(sw(CODE), 2, 'once for the number\'s day, once for the discovery date');
  assert.match(REPAIR60, /extract\(day from s\.disb_date\) <= 12 and extract\(day from s\.disb_date\) <> extract\(month from s\.disb_date\)/, 'RUN-ME-060 writes the same rule');
});

test('every column it reads is one the real tables have, with the type its arithmetic needs', () => {
  assert.equal(typeOf('demand_notices', 'notice_date'), 'date');
  assert.equal(typeOf('demand_notices', 'created_at'), 'timestamptz');
  assert.match(MIG_ID, /alter table demand_notices add column if not exists notice_id text;/);
  assert.match(MIG_STAMP, /alter table %I add column if not exists upload_date date/);
  assert.match(MIG_STAMP, /'restructures', 'demand_notices', 'followup_comments'/, 'the stamp migration puts upload_date on demand_notices');
  assert.equal(typeOf('pmo_deductions', 'submitted_at'), 'timestamptz');
  assert.equal(typeOf('pmo_deductions', 'received_date'), 'date');
  assert.equal(typeOf('pmo_deductions', 'discovery_date'), 'date');
  for (const c of ['id']) { assert.equal(typeOf('demand_notices', c), 'uuid'); assert.equal(typeOf('pmo_deductions', c), 'uuid'); }
});

test('the answer is a verdict and its own caveat: a clean answer says "nothing to repair", and the header says what a clean answer does not prove', () => {
  assert.match(CODE, /then 'every notice with a dated number agrees with its notice date, and no deduction was discovered out of order: nothing to repair here'/);
  assert.match(FILE, /WHAT A CLEAN ANSWER DOES NOT PROVE/);
  assert.match(CODE, /\(select count\(\*\) from k where kn in \('swapped', 'neither'\)\) = 0 and \(select count\(\*\) from pk where late_dc or early_dc\) = 0/, 'clean only when BOTH registers are');
});

test('the kept check runs the whole real schema and both migrations, compares every printed line with a model, shows the book is unchanged, times a book a hundred times the live one, and breaks the file on purpose', () => {
  assert.match(CHECK, /readFileSync\(path\.join\(ROOT, 'db\/schema\.sql'\)/);
  assert.match(CHECK, /2026-07-26-demand-notice-id\.sql/);
  assert.match(CHECK, /2026-07-28-upload-stamp\.sql/);
  assert.doesNotMatch(CHECK.replace(/\/\*[\s\S]*?\*\//, ''), /create table[^\n]*(demand_notices|pmo_deductions)\b/i, 'a fixture declared by hand once passed on a table that was not the book\'s (RUN-ME-061)');
  assert.match(CHECK, /byte-identical afterwards/);
  assert.match(CHECK, /generate_series\(1, 100000\)/);
  assert.match(CHECK, /BROKEN ON PURPOSE/);
  assert.ok((CHECK.match(/^\s+\['[^\n]+',\s+rep\(/gm) || []).length >= 24, 'twenty-four deliberate breaks or more, each of which must change the answer');
});
