/* db/RUN-ME-068-repair-impossible-notice-and-deduction-dates.sql -- the lines that make it safe and true, pinned (docs/HANDOFF.md Part 98).

     "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026

   The file CHANGES DATA on the live book: it writes back to a notice the day its own number says (when the notice is dated after the day it was uploaded and the stored date is that
   day exchanged, exactly or a day early), moves the stamp and the notice's recoveries with it, and puts right a deduction's discovery date when it is after the submission and one
   reading fits. Node cannot run SQL: the check that does (tools/db-checks/notice-date-repair.mjs, run by hand on a PostgreSQL over the WHOLE of db/schema.sql, the two migrations and
   the real RUN-ME-041a, row by row against a model written again, the undo byte for byte, a book a hundred times the live one, and a list of deliberate breaks) is the proof; this is
   the guard that a later edit does not make it write somewhere else, print a name, lose its limits or its logs, widen its proof, or part company with RUN-ME-067 on what a number says. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const FILE = rd('db/RUN-ME-068-repair-impossible-notice-and-deduction-dates.sql');
const F067 = rd('db/RUN-ME-067-notice-and-deduction-dates-read-only.sql');
const R060 = rd('db/RUN-ME-060-repair-swapped-deck-dates.sql');
const SCHEMA = rd('db/schema.sql');
const MIG_ID = rd('db/migrations/2026-07-26-demand-notice-id.sql');
const MIG_STAMP = rd('db/migrations/2026-07-28-upload-stamp.sql');
const LEDGER = rd('db/RUN-ME-041a-notice-payment-ledger.sql');
const CHECK = rd('tools/db-checks/notice-date-repair.mjs');
const code = f => f.split('\n').map(l => {
  if (/^\s*--/.test(l)) return '';
  let q = false;
  for (let i = 0; i < l.length; i++) { if (l[i] === "'") q = !q; else if (!q && l[i] === '-' && l[i + 1] === '-') return l.slice(0, i); }
  return l;
}).join('\n');
const CODE = code(FILE);
const noStrings = s => s.replace(/'(?:[^']|'')*'/g, "''");
const squash = s => s.replace(/\s+/g, ' ');
const ddl = name => { const i = SCHEMA.indexOf('create table if not exists ' + name + ' ('); return SCHEMA.slice(i, SCHEMA.indexOf('\n);', i)); };
const typeOf = (t, c) => ((ddl(t).match(new RegExp('(?:^|[\\s,(])' + c + '\\s+([a-z]+)')) || [])[1]);
const names = (re, s) => [...new Set([...noStrings(s).matchAll(re)].map(m => m[1].toLowerCase()))].sort();

test('it writes to exactly six tables: it updates the three registers it repairs and inserts only into its own three logs; it deletes, drops and grants nothing', () => {
  assert.deepEqual(names(/\bupdate\s+public\.([a-z_]+)/gi, CODE), ['demand_notices', 'notice_payment_ledger', 'pmo_deductions']);
  assert.deepEqual(names(/\binsert\s+into\s+public\.([a-z_]+)/gi, CODE), ['demand_notice_date_repair_log', 'notice_ledger_date_move_log', 'pmo_deduction_date_repair_log']);
  assert.deepEqual(names(/\bcreate\s+table\s+if\s+not\s+exists\s+public\.([a-z_]+)/gi, CODE), ['demand_notice_date_repair_log', 'notice_ledger_date_move_log', 'pmo_deduction_date_repair_log']);
  assert.deepEqual(names(/\balter\s+table\s+public\.([a-z_]+)\s+enable\s+row\s+level\s+security/gi, CODE), ['demand_notice_date_repair_log', 'notice_ledger_date_move_log', 'pmo_deduction_date_repair_log'], 'a log is never readable through the public API');
  assert.doesNotMatch(noStrings(CODE), /\b(delete|drop|truncate|grant|revoke|vacuum|copy|call)\b/i);
  assert.equal((noStrings(CODE).match(/\bupdate\s+public\./gi) || []).length, 3, 'three updates: the notice, the ledger, the deduction and nothing else');
  const reads = names(/\b(?:from|join)\s+public\.([a-z_]+)/gi, CODE);
  assert.deepEqual(reads, ['demand_notice_date_repair_log', 'demand_notices', 'notice_payment_ledger', 'pmo_deduction_date_repair_log', 'pmo_deductions']);
});

test('it can never run long or wait behind an upload: a 3-second lock limit, a 30-second ceiling that rolls it all back, the compiler off; and a book without the ledger is refused before anything is made', () => {
  assert.match(CODE, /^\s*set local lock_timeout = '3s';/m);
  assert.match(CODE, /^\s*set local statement_timeout = '30s';/m);
  assert.match(CODE, /^\s*set local jit = off;/m);
  const guard = CODE.indexOf("to_regclass('public.notice_payment_ledger') is null");
  assert.ok(guard > 0 && guard < CODE.indexOf('create table if not exists'), 'the guard comes before the first table the file makes');
  assert.match(CODE, /raise exception 'Run db\/RUN-ME-041a first: [^']+ Nothing was changed\.'/);
});

test('it prints no name, no loan number, no notice number, no case id and no amount: counts, dates and the first eight characters of a row id', () => {
  assert.equal((noStrings(CODE).match(/\bnotice_id\b/g) || []).length, 1, 'the notice number is READ once (to take the day out of it) and never printed');
  assert.match(CODE, /regexp_match\(n\.notice_id, /);
  const out = CODE.slice(CODE.indexOf('select z.what, z.answer from ('));
  assert.doesNotMatch(noStrings(out), /\b(ref|notice_id|case_id|cid|full_name|contact|team|customer|staff|reporter|issued_by|amount_taken|deduction|to_pay|deducted|remaining|total_demand|arrears_at_notice|fine|letter)\b/i, 'the printed part names none of them');
  assert.match(CODE, /'    e\.g\. notice ' \|\| left\(e\.id::text, 8\)/);
  assert.doesNotMatch(noStrings(CODE), /\b(full_name|contact|customer|staff|reporter|issued_by|amount_taken|to_pay|deducted|total_demand|arrears_at_notice|letter)\b/i, 'the file does not even read them');
});

test('THE PROOF for a notice is all three, in one place: dated after its OWN upload day, the number\'s day possible, the stored date that day exchanged (exactly or a day early); a row an earlier run changed is never changed again', () => {
  const c = squash(CODE);
  assert.match(c, /cand as \( select w\.\* from w where w\.ud is not null and w\.nd is not null and w\.nd > w\.ud and not w\.was_fixed \)/);
  assert.match(c, /where c\.idd is not null and c\.idd <= c\.ud and c\.isw is not null and c\.nd in \(c\.isw, c\.isw - 1\) \)/);
  assert.match(c, /set notice_date = o\.idd, created_at = o\.ca_new from ok o where n\.id = o\.id and n\.notice_date = o\.nd/);
  assert.match(c, /insert into public\.demand_notice_date_repair_log \(id, notice_old, notice_new, stamp_old, stamp_new\) select o\.id, o\.nd, o\.idd, o\.ca, o\.ca_new from ok o on conflict \(id\) do nothing returning id/);
  assert.match(c, /left join public\.demand_notice_date_repair_log l on l\.id = v\.id/);
  assert.equal((c.match(/c\.nd in \(c\.isw, c\.isw - 1\)/g) || []).length, 2, 'once in the proof and once in the count the answer gives of what is left alone');
});

test('THE STAMP moves only when ITS OWN day is after the upload day and is that same exchange, to the number\'s day at the same time of day in East Africa', () => {
  const c = squash(CODE);
  assert.match(c, /case when c\.cd > c\.ud and c\.cd in \(c\.isw, c\.isw - 1\) then \(\(c\.idd \+ c\.cl::time\) at time zone 'Africa\/Dar_es_Salaam'\) else c\.ca end as ca_new/);
  assert.match(c, /\(n\.created_at at time zone 'Africa\/Dar_es_Salaam'\) as cl/);
  assert.match(c, /v\.cl::date as cd/);
  assert.doesNotMatch(CODE, /at time zone 'UTC'|current_date/i);
  assert.equal((CODE.match(/\bnow\(\)/g) || []).length, (CODE.match(/\bdefault now\(\)/g) || []).length, 'no clock of the server is read but the moment each log line is written: the repair is the same on any day');
});

test('the ledger follows the notice: only the rows at its old date, never onto a row already there, every move logged, and the undo restores exactly those', () => {
  const c = squash(CODE);
  assert.match(c, /update public\.notice_payment_ledger l set since = o\.idd from ok o where l\.ref = o\.ref and l\.since = o\.nd and not exists \(select 1 from public\.notice_payment_ledger x where x\.ref = l\.ref and x\.since = o\.idd and x\.payment_id = l\.payment_id\) returning l\.ref, l\.payment_id, o\.nd as since_old, o\.idd as since_new/);
  assert.match(c, /insert into public\.notice_ledger_date_move_log \(ref, payment_id, since_old, since_new\) select e\.ref, e\.payment_id, e\.since_old, e\.since_new from led e on conflict do nothing returning ref/);
  const undo = FILE.split('\n').filter(l => /^-- update /.test(l));
  assert.equal(undo.length, 3, 'three lines of undo: the ledger, the notices, the deductions');
  assert.match(undo[0], /update public\.notice_payment_ledger l set since = m\.since_old from public\.notice_ledger_date_move_log m where l\.ref = m\.ref and l\.payment_id = m\.payment_id and l\.since = m\.since_new and not exists \(/);
  assert.match(undo[1], /update public\.demand_notices n set notice_date = g\.notice_old, created_at = g\.stamp_old from public\.demand_notice_date_repair_log g where n\.id = g\.id and n\.notice_date = g\.notice_new;/);
  assert.match(undo[2], /update public\.pmo_deductions p set discovery_date = g\.discovery_old from public\.pmo_deduction_date_repair_log g where p\.id = g\.id and p\.discovery_date = g\.discovery_new;/);
});

test('THE PROOF for a deduction: discovered after the day the case was submitted, the submission day readable one way, ONE reading of the discovery fits (not after the submission, not before the money under either reading of it); one discovered BEFORE the money is not changed', () => {
  const c = squash(CODE);
  assert.match(c, /pl as \( select pe\.\* from pe where pe\.dc is not null and pe\.dc > pe\.sd and not pe\.was_fixed \)/);
  assert.match(c, /where pl\.ssw is null and pl\.dsw is not null and pl\.dsw <= pl\.sd and \(pl\.rd is null or \(pl\.rd <= pl\.dsw and \(pl\.rsw is null or pl\.rsw <= pl\.dsw\)\)\) \)/);
  assert.match(c, /insert into public\.pmo_deduction_date_repair_log \(id, discovery_old, discovery_new\) select o\.id, o\.dc, o\.dsw from pok o on conflict \(id\) do nothing returning id/);
  assert.match(c, /update public\.pmo_deductions p set discovery_date = o\.dsw from pok o where p\.id = o\.id and p\.discovery_date = o\.dc/);
  assert.match(c, /from pe where pe\.dc is not null and pe\.rd is not null and pe\.rd > pe\.dc and not pe\.was_fixed group by pe\.cid, pe\.rd, pe\.dc, pe\.sd/, 'the early ones are only listed, one line to each date triple of a case, never written');
  assert.doesNotMatch(c, /update public\.pmo_deductions p set (?!discovery_date = o\.dsw)/, 'the only column written is the discovery date');
  assert.match(c, /\(p\.submitted_at at time zone 'Africa\/Dar_es_Salaam'\)::date as sd/);
});

test('what a number says is read exactly as RUN-ME-067 reads it (one definition), and the exchange is the one RUN-ME-060 writes: day twelve or under, and not the month', () => {
  const pattern = f => (f.match(/regexp_match\(n\.notice_id, '([^']+)'\)/) || [])[1];
  assert.ok(pattern(FILE) && pattern(FILE) === pattern(F067), 'the same pattern in both files');
  const block = f => squash(f.slice(f.indexOf('case when m.p is null then null else'), f.indexOf('as idd')));
  assert.ok(block(FILE).length > 200 && block(FILE) === block(F067), 'the same day-that-exists guard (a nested CASE: the planner reorders the parts of an AND, never the branches of a CASE) in both files');
  const ex = squash(CODE).match(/extract\(day from [\w.]+\) <= 12 and extract\(day from [\w.]+\) <> extract\(month from [\w.]+\)/g) || [];
  assert.equal(ex.length, 4, 'the exchange is written for the number\'s day, the discovery, the received date and the submission day');
  assert.match(R060, /extract\(day from s\.disb_date\) <= 12 and extract\(day from s\.disb_date\) <> extract\(month from s\.disb_date\)/);
});

test('every step that reads a number or a date is MATERIALIZED (left to be inlined, the planner repeated the number\'s pattern match about fifty times a row: RUN-ME-067)', () => {
  for (const cte of ['m', 'v', 'w', 'pd', 'pe']) assert.match(CODE, new RegExp('\\b' + cte + ' as materialized \\('), 'the step ' + cte);
});

test('every column it touches is one the real book has, with the type its arithmetic needs; the logs it makes hold what it inserts', () => {
  assert.equal(typeOf('demand_notices', 'notice_date'), 'date');
  assert.equal(typeOf('demand_notices', 'created_at'), 'timestamptz');
  assert.equal(typeOf('demand_notices', 'id'), 'uuid');
  assert.match(MIG_ID, /alter table demand_notices add column if not exists notice_id text;/);
  assert.match(MIG_STAMP, /alter table %I add column if not exists upload_date date/);
  assert.match(MIG_STAMP, /'restructures', 'demand_notices', 'followup_comments'/);
  assert.equal(typeOf('pmo_deductions', 'submitted_at'), 'timestamptz');
  assert.equal(typeOf('pmo_deductions', 'received_date'), 'date');
  assert.equal(typeOf('pmo_deductions', 'discovery_date'), 'date');
  assert.equal(typeOf('pmo_deductions', 'case_id'), 'text');
  assert.equal(typeOf('pmo_deductions', 'id'), 'uuid');
  assert.match(LEDGER, /ref\s+text not null,\s+since\s+date not null,[^\n]*\n\s+payment_id\s+uuid not null,[\s\S]*primary key \(ref, since, payment_id\)/);
  const log = name => squash((FILE.match(new RegExp('create table if not exists public\\.' + name + ' \\(([\\s\\S]*?)\\n\\);')) || [])[1] || '');
  assert.match(log('demand_notice_date_repair_log'), /id uuid primary key.*notice_old date, notice_new date, stamp_old timestamptz, stamp_new timestamptz/);
  assert.match(log('pmo_deduction_date_repair_log'), /id uuid primary key.*discovery_old date, discovery_new date/);
  assert.match(log('notice_ledger_date_move_log'), /ref text not null, payment_id uuid not null.*since_old date not null, since_new date not null.*primary key \(ref, payment_id, since_new\)/);
});

test('the answer is honest about what it left: it says "nothing was changed" only when nothing was found, and the header says what it does not do', () => {
  assert.match(squash(CODE), /when \(select count\(\*\) from cand\) \+ \(select count\(\*\) from pl\) = 0 then 'no imported notice is dated after the day it was uploaded and no deduction was discovered after it was submitted: nothing was changed'/);
  assert.match(FILE, /LEFT EXACTLY AS THEY ARE, AND COUNTED/);
  assert.match(FILE, /the file cannot say which one was\s*--\s*read the wrong way round/);
  assert.match(FILE, /A row in a\s*-- log is never changed again, so this is SAFE TO RUN AGAIN/);
});

test('the kept check runs the whole real schema, both migrations and the real ledger migration, takes the log tables from the file itself, compares every row with a model, tests the undo, a second run and a book without the ledger, times a book a hundred times the live one, and breaks the file on purpose', () => {
  assert.match(CHECK, /readFileSync\(path\.join\(ROOT, 'db\/schema\.sql'\)/);
  assert.match(CHECK, /2026-07-26-demand-notice-id\.sql/);
  assert.match(CHECK, /2026-07-28-upload-stamp\.sql/);
  assert.match(CHECK, /RUN-ME-041a-notice-payment-ledger\.sql/);
  assert.match(CHECK, /const ddl = name =>/, 'the three log tables are made from the file\'s own DDL, never declared by hand (a fixture declared by hand once passed on a table that was not the book\'s: RUN-ME-061)');
  assert.doesNotMatch(CHECK.replace(/\/\*[\s\S]*?\*\//, ''), /create table[^\n]*(demand_notices|pmo_deductions|notice_payment_ledger)\b/i);
  assert.match(CHECK, /byte for byte/);
  assert.match(CHECK, /a row undone stays undone/);
  assert.match(CHECK, /a book without the ledger is refused/);
  assert.match(CHECK, /a second run changes nothing/);
  assert.match(CHECK, /generate_series\(1, 95000\)/);
  assert.match(CHECK, /BROKEN ON PURPOSE/);
  assert.ok((CHECK.match(/^\s+\['[^\n]+',\s+rep\(/gm) || []).length >= 40, 'forty deliberate breaks or more, each of which must change the outcome');
});
