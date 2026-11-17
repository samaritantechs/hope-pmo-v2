/* db/RUN-ME-070-repair-notice-dates-shifted-by-the-import.sql -- the lines that make it safe and true, pinned (docs/HANDOFF.md Part 100).

     "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026

   The file CHANGES DATA on the live book: in an upload that RUN-ME-068 proved to carry the shift, it writes back to an imported notice the day its own number says, when the stored date is
   EXACTLY what the shift makes of that number (the number's day exchanged and a day early; or, where day and month are the same, a day early), moves the stamp when it carries the same wrong
   day, and moves the notice's recoveries in notice_payment_ledger with it unless another notice of the loan makes them ambiguous. Node cannot run SQL: the check that does
   (tools/db-checks/notice-shift-repair.mjs, run by hand on a PostgreSQL over the WHOLE of db/schema.sql, the two migrations, the real RUN-ME-041a and THE REAL RUN-ME-068 run first, row by row
   against a model written again, the undo byte for byte, a book a hundred times the live one, and a list of deliberate breaks) is the proof; this is the guard that a later edit does not make
   it write somewhere else, print a name, lose its limits or its logs, widen its proof, or part company with RUN-ME-067 and 068 on what a number says. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const FILE = rd('db/RUN-ME-070-repair-notice-dates-shifted-by-the-import.sql');
const F068 = rd('db/RUN-ME-068-repair-impossible-notice-and-deduction-dates.sql');
const F067 = rd('db/RUN-ME-067-notice-and-deduction-dates-read-only.sql');
const R060 = rd('db/RUN-ME-060-repair-swapped-deck-dates.sql');
const SCHEMA = rd('db/schema.sql');
const MIG_ID = rd('db/migrations/2026-07-26-demand-notice-id.sql');
const MIG_STAMP = rd('db/migrations/2026-07-28-upload-stamp.sql');
const LEDGER = rd('db/RUN-ME-041a-notice-payment-ledger.sql');
const CHECK = rd('tools/db-checks/notice-shift-repair.mjs');
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

test('it writes to exactly four tables: it updates the notices and their recoveries and inserts only into its own two logs; it deletes, drops and grants nothing', () => {
  assert.deepEqual(names(/\bupdate\s+public\.([a-z_]+)/gi, CODE), ['demand_notices', 'notice_payment_ledger']);
  assert.deepEqual(names(/\binsert\s+into\s+public\.([a-z_]+)/gi, CODE), ['demand_notice_shift_repair_log', 'notice_ledger_shift_move_log']);
  assert.deepEqual(names(/\bcreate\s+table\s+if\s+not\s+exists\s+public\.([a-z_]+)/gi, CODE), ['demand_notice_shift_repair_log', 'notice_ledger_shift_move_log']);
  assert.deepEqual(names(/\balter\s+table\s+public\.([a-z_]+)\s+enable\s+row\s+level\s+security/gi, CODE), ['demand_notice_shift_repair_log', 'notice_ledger_shift_move_log'], 'a log is never readable through the public API');
  assert.doesNotMatch(noStrings(CODE), /\b(delete|drop|truncate|grant|revoke|vacuum|copy|call)\b/i);
  assert.equal((noStrings(CODE).match(/\bupdate\s+public\./gi) || []).length, 2, 'two updates: the notice and the ledger, and nothing else');
  const reads = names(/\b(?:from|join)\s+public\.([a-z_]+)/gi, CODE);
  assert.deepEqual(reads, ['demand_notice_date_repair_log', 'demand_notice_shift_repair_log', 'demand_notices', 'notice_payment_ledger']);
  assert.doesNotMatch(noStrings(CODE), /\bpmo_deductions\b/i, 'the deductions are not this file\'s business');
});

test('it can never run long or wait behind an upload: a 3-second lock limit, a 30-second ceiling that rolls it all back, the compiler off; a book without 068\'s log, or without the ledger, is refused before anything is made', () => {
  assert.match(CODE, /^\s*set local lock_timeout = '3s';/m);
  assert.match(CODE, /^\s*set local statement_timeout = '30s';/m);
  assert.match(CODE, /^\s*set local jit = off;/m);
  const g068 = CODE.indexOf("to_regclass('public.demand_notice_date_repair_log') is null"), gLed = CODE.indexOf("to_regclass('public.notice_payment_ledger') is null");
  assert.ok(g068 > 0 && gLed > 0 && g068 < CODE.indexOf('create table if not exists') && gLed < CODE.indexOf('create table if not exists'), 'both guards come before the first table the file makes');
  assert.match(CODE, /raise exception 'Run db\/RUN-ME-068 first: [^']+ Nothing was changed\.'/);
  assert.match(CODE, /raise exception 'Run db\/RUN-ME-041a first: [^']+ Nothing was changed\.'/);
});

test('it prints no name, no loan number, no notice number and no amount: counts, dates and the first eight characters of a row id', () => {
  assert.equal((noStrings(CODE).match(/\bnotice_id\b/g) || []).length, 1, 'the notice number is READ once (to take the day out of it) and never printed');
  assert.match(CODE, /regexp_match\(n\.notice_id, /);
  const out = CODE.slice(CODE.indexOf('select z.what, z.answer from ('));
  assert.doesNotMatch(noStrings(out), /\b(ref|notice_id|case_id|full_name|contact|team|customer|issued_by|total_demand|arrears_at_notice|fine|letter|amount)\b/i, 'the printed part names none of them');
  assert.match(CODE, /'    e\.g\. notice ' \|\| left\(e\.id::text, 8\)/);
  assert.doesNotMatch(noStrings(CODE), /\b(full_name|contact|customer|issued_by|total_demand|arrears_at_notice|letter)\b/i, 'the file does not even read them');
});

test('THE PROOF, all four in one place: the row\'s own upload is proven by RUN-ME-068 (three notices dated after the upload day), the number\'s day is possible and not after the upload, the stored date is exactly the shift\'s shape, and nothing was changed before', () => {
  const c = squash(CODE);
  assert.match(c, /pr as materialized \( select n\.upload_date as ud, count\(\*\) as n_proved from public\.demand_notice_date_repair_log g join public\.demand_notices n on n\.id = g\.id where n\.upload_date is not null and g\.notice_old > n\.upload_date group by n\.upload_date \)/);
  assert.match(c, /x as materialized \( select w\.\*, \(w\.ud is not null and coalesce\(pr\.n_proved, 0\) >= 3\) as proved_up from w left join pr on pr\.ud = w\.ud \)/);
  assert.match(c, /cand as \( select x\.\* from x where x\.proved_up and x\.nd is not null and x\.idd is not null and x\.nd <> x\.idd and not x\.was_fixed \)/);
  assert.match(c, /where c\.idd <= c\.ud and \(\(c\.isw is not null and c\.nd = c\.isw - 1\) or \(c\.isw is null and c\.dm and c\.nd = c\.idd - 1\)\) \)/);
  assert.match(c, /\(l\.id is not null or l2\.id is not null\) as was_fixed from v left join public\.demand_notice_date_repair_log l on l\.id = v\.id left join public\.demand_notice_shift_repair_log l2 on l2\.id = v\.id/);
  assert.match(c, /update public\.demand_notices n set notice_date = o\.idd, created_at = o\.ca_new from ok o where n\.id = o\.id and n\.notice_date = o\.nd/);
  assert.match(c, /insert into public\.demand_notice_shift_repair_log \(id, notice_old, notice_new, stamp_old, stamp_new\) select o\.id, o\.nd, o\.idd, o\.ca, o\.ca_new from ok o on conflict \(id\) do nothing returning id/);
  assert.equal((c.match(/c\.isw is not null and c\.nd = c\.isw - 1/g) || []).length, 1, 'the exchanged shape is written once: exactly a day early, never the exact exchange, never a day late');
  assert.doesNotMatch(c, /c\.nd in \(c\.isw/, 'no "exchange or a day early": the exact exchange has no independent proof in the past');
  assert.match(c, /\(v\.idd is not null and extract\(day from v\.idd\) = extract\(month from v\.idd\)\) as dm/);
});

test('THE STAMP moves only when ITS OWN East Africa day is the same wrong day the notice date carried, to the number\'s day at the same time of day', () => {
  const c = squash(CODE);
  assert.match(c, /case when c\.cd = c\.nd then \(\(c\.idd \+ c\.cl::time\) at time zone 'Africa\/Dar_es_Salaam'\) else c\.ca end as ca_new/);
  assert.match(c, /\(n\.created_at at time zone 'Africa\/Dar_es_Salaam'\) as cl/);
  assert.match(c, /v\.cl::date as cd/);
  assert.doesNotMatch(CODE, /at time zone 'UTC'|current_date/i);
  assert.equal((CODE.match(/\bnow\(\)/g) || []).length, (CODE.match(/\bdefault now\(\)/g) || []).length, 'no clock of the server is read but the moment each log line is written: the repair is the same on any day');
});

test('the ledger follows the notice: only the rows at its old date, never onto a row already there, never when another notice of the loan carries the old or the new date, every move logged, and the undo restores exactly those', () => {
  const c = squash(CODE);
  assert.match(c, /update public\.notice_payment_ledger l set since = o\.idd from ok o where l\.ref = o\.ref and l\.since = o\.nd and not exists \(select 1 from public\.notice_payment_ledger y where y\.ref = l\.ref and y\.since = o\.idd and y\.payment_id = l\.payment_id\) and not exists \(select 1 from x z where z\.ref = o\.ref and z\.id <> o\.id and z\.nd in \(o\.nd, o\.idd\)\) returning/);
  assert.match(c, /insert into public\.notice_ledger_shift_move_log \(ref, payment_id, since_old, since_new\) select e\.ref, e\.payment_id, e\.since_old, e\.since_new from led e on conflict do nothing returning ref/);
  const undo = FILE.split('\n').filter(l => /^-- update /.test(l));
  assert.equal(undo.length, 2, 'two lines of undo: the ledger, the notices');
  assert.match(undo[0], /update public\.notice_payment_ledger l set since = m\.since_old from public\.notice_ledger_shift_move_log m where l\.ref = m\.ref and l\.payment_id = m\.payment_id and l\.since = m\.since_new and not exists \(/);
  assert.match(undo[1], /update public\.demand_notices n set notice_date = g\.notice_old, created_at = g\.stamp_old from public\.demand_notice_shift_repair_log g where n\.id = g\.id and n\.notice_date = g\.notice_new;/);
});

test('what a number says is read exactly as RUN-ME-067 and 068 read it (one definition), and the exchange is the one RUN-ME-060 writes: day twelve or under, and not the month', () => {
  const pattern = f => (f.match(/regexp_match\(n\.notice_id, '([^']+)'\)/) || [])[1];
  assert.ok(pattern(FILE) && pattern(FILE) === pattern(F067) && pattern(FILE) === pattern(F068), 'the same pattern in the three files');
  const block = f => squash(f.slice(f.indexOf('case when m.p is null then null else'), f.indexOf('as idd')));
  assert.ok(block(FILE).length > 200 && block(FILE) === block(F067) && block(FILE) === block(F068), 'the same day-that-exists guard (a nested CASE: the planner reorders the parts of an AND, never the branches of a CASE) in the three files');
  const ex = squash(CODE).match(/extract\(day from [\w.]+\) <= 12 and extract\(day from [\w.]+\) <> extract\(month from [\w.]+\)/g) || [];
  assert.equal(ex.length, 1, 'the exchange is written once, for the number\'s day');
  assert.match(R060, /extract\(day from s\.disb_date\) <= 12 and extract\(day from s\.disb_date\) <> extract\(month from s\.disb_date\)/);
  assert.match(F068, /extract\(day from v\.idd\) <= 12 and extract\(day from v\.idd\) <> extract\(month from v\.idd\)/);
});

test('every step that reads a number or a date is MATERIALIZED (left to be inlined, the planner repeated the number\'s pattern match about fifty times a row: RUN-ME-067)', () => {
  for (const cte of ['m', 'v', 'w', 'pr', 'x']) assert.match(CODE, new RegExp('\\b' + cte + ' as materialized \\('), 'the step ' + cte);
});

test('every column it touches is one the real book has, with the type its arithmetic needs; the logs it makes hold what it inserts and RUN-ME-068\'s log is the one it reads', () => {
  assert.equal(typeOf('demand_notices', 'notice_date'), 'date');
  assert.equal(typeOf('demand_notices', 'created_at'), 'timestamptz');
  assert.equal(typeOf('demand_notices', 'id'), 'uuid');
  assert.match(MIG_ID, /alter table demand_notices add column if not exists notice_id text;/);
  assert.match(MIG_STAMP, /alter table %I add column if not exists upload_date date/);
  assert.match(MIG_STAMP, /'restructures', 'demand_notices', 'followup_comments'/);
  assert.match(LEDGER, /ref\s+text not null,\s+since\s+date not null,[^\n]*\n\s+payment_id\s+uuid not null,[^\n]*\n\s+paid_at\s+date,[\s\S]*primary key \(ref, since, payment_id\)/);
  const log = (src, name) => squash((src.match(new RegExp('create table if not exists public\\.' + name + ' \\(([\\s\\S]*?)\\n\\);')) || [])[1] || '');
  assert.match(log(FILE, 'demand_notice_shift_repair_log'), /id uuid primary key.*notice_old date, notice_new date, stamp_old timestamptz, stamp_new timestamptz/);
  assert.match(log(FILE, 'notice_ledger_shift_move_log'), /ref text not null, payment_id uuid not null.*since_old date not null, since_new date not null.*primary key \(ref, payment_id, since_new\)/);
  assert.match(log(F068, 'demand_notice_date_repair_log'), /id uuid primary key.*notice_old date, notice_new date, stamp_old timestamptz, stamp_new timestamptz/, 'the log this file reads has the columns it reads');
  assert.notEqual(log(FILE, 'notice_ledger_shift_move_log'), '', 'its own move log, apart from 068\'s, so that each file has an undo of its own');
});

test('the answer is honest about what it left: it says "nothing was changed" only when no upload is proven, counts what it left by every relation, and the header says what it does not do', () => {
  assert.match(squash(CODE), /when \(select count\(\*\) from fin where proved_up\) = 0 then 'no upload is proved to carry the shift \(RUN-ME-068 put right fewer than three notices dated after the day they were uploaded, in every upload\): nothing was changed'/);
  assert.match(FILE, /LEFT EXACTLY AS THEY ARE, AND COUNTED/);
  assert.match(FILE, /NEVER\s*--\s*repaired here, even a day early/);
  assert.match(FILE, /a payment is never deleted here/);
  assert.match(FILE, /A row in a log is\s*--\s*never changed again, so this is SAFE TO RUN AGAIN/);
  const lines = [...CODE.matchAll(/^\s*(?:select|union all\s+select)\s+(\d+)\s*,/gm)].map(m => +m[1]);
  assert.deepEqual(lines, [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19], 'the lines the answer prints, in the order the check models them (0 is the ANSWER, 20 and up the examples)');
});

test('the kept check runs the whole real schema, both migrations, the real ledger migration AND THE REAL RUN-ME-068 FIRST, takes the log tables from the files themselves, compares every row with a model, tests the undo, a second run, a refused book and a book with no proof, times a book a hundred times the live one, and breaks the file on purpose', () => {
  assert.match(CHECK, /readFileSync\(path\.join\(ROOT, 'db\/schema\.sql'\)/);
  assert.match(CHECK, /2026-07-26-demand-notice-id\.sql/);
  assert.match(CHECK, /2026-07-28-upload-stamp\.sql/);
  assert.match(CHECK, /RUN-ME-041a-notice-payment-ledger\.sql/);
  assert.match(CHECK, /RUN-ME-068-repair-impossible-notice-and-deduction-dates\.sql/);
  assert.match(CHECK, /psql\('begin;\\n' \+ F068 \+ '\\ncommit;\\n', TPL\)/, 'the real 068 is run on the fixture before the model reads its state');
  assert.match(CHECK, /const ddl = \(file, name\) =>/, 'the log tables are made from the files\' own DDL, never declared by hand (a fixture declared by hand once passed on a table that was not the book\'s: RUN-ME-061)');
  assert.doesNotMatch(CHECK.replace(/\/\*[\s\S]*?\*\//, ''), /create table[^\n]*(demand_notices|notice_payment_ledger)\b/i);
  assert.match(CHECK, /byte for byte/);
  assert.match(CHECK, /a row undone stays undone/);
  assert.match(CHECK, /a book without RUN-ME-068's log is refused/);
  assert.match(CHECK, /a book where no upload is proved says so and changes nothing/);
  assert.match(CHECK, /a second run changes nothing/);
  assert.match(CHECK, /generate_series\(1, 95000\)/);
  assert.match(CHECK, /BROKEN ON PURPOSE/);
  assert.ok((CHECK.match(/^\s+\['[^\n]+',\s+rep\(/gm) || []).length >= 50, 'fifty deliberate breaks or more, each of which must change the outcome');
});
