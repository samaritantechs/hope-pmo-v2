/* db/RUN-ME-065-repair-swapped-payment-dates.sql -- the lines that make it safe and true, pinned (docs/HANDOFF.md Part 93).

     "Repair everything that's wrong brother ... we have transactions dates at received" -- the owner, 17 Nov 2026

   The file changes `paid_at` of received_payments, and of the copies of those payments in notice_payment_ledger, where the upload's own time proves the day and
   the month were exchanged. Node cannot run SQL: the check that does (tools/db-checks/payment-date-repair.mjs, run by hand on a PostgreSQL over the WHOLE of db/schema.sql
   and compared row by row with a model of the rule written again, with the file's undo, a second run, a book without the ledger and eighteen deliberate breaks) is the
   proof; this is the guard that a later edit does not quietly change a column it should not, print a name, read a table it should not, lose its undo or its limits, or part
   company with the reader that stops the damage at the source. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILE = readFileSync(new URL('../db/RUN-ME-065-repair-swapped-payment-dates.sql', import.meta.url), 'utf8');
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const CHECK = readFileSync(new URL('../tools/db-checks/payment-date-repair.mjs', import.meta.url), 'utf8');
const IMPORTERS = readFileSync(new URL('../api/_lib/importers.js', import.meta.url), 'utf8');
const UPLOAD = readFileSync(new URL('../api/upload.js', import.meta.url), 'utf8');
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
const typeOf = (t, c) => ((ddl(t).match(new RegExp('^\\s+' + c + '\\s+([a-z]+)', 'm')) || [])[1]);

test('it writes ONE column of two tables, and nothing else of the book: paid_at', () => {
  const sets = [...noStrings(CODE).matchAll(/\bset\s+([a-z_]+)\s*=/gi)].map(m => m[1].toLowerCase()).filter(c => !['lock_timeout', 'statement_timeout', 'jit'].includes(c));
  assert.deepEqual([...new Set(sets)], ['paid_at'], 'every update sets paid_at and only paid_at');
  assert.deepEqual([...noStrings(CODE).matchAll(/\bupdate\s+public\.([a-z_]+)/gi)].map(m => m[1]).sort(), ['notice_payment_ledger', 'received_payments']);
  assert.doesNotMatch(noStrings(CODE), /\b(delete|drop|truncate|alter\s+table\s+public\.(?!payment_date_repair_log)|grant|revoke|vacuum)\b/i);
  const tables = [...new Set([...noStrings(CODE).matchAll(/\bpublic\.([a-z_]+)/gi)].map(m => m[1].toLowerCase()))].sort();
  assert.deepEqual(tables, ['notice_payment_ledger', 'payment_date_repair_log', 'received_payments']);
});

test('it has its limits, its log, its undo and its safe re-run', () => {
  assert.match(CODE, /^\s*set local lock_timeout = '3s';/m);
  assert.match(CODE, /^\s*set local statement_timeout = '50s';/m);
  assert.match(CODE, /^\s*set local jit = off;/m);
  assert.match(CODE, /create table if not exists public\.payment_date_repair_log/);
  assert.match(CODE, /alter table public\.payment_date_repair_log enable row level security/);
  assert.equal((CODE.match(/on conflict \(source, row_key\) do nothing/g) || []).length, 2, 'the payments\' log lines and the ledger\'s: a row\'s first log line keeps the date it was uploaded with, and a second run adds nothing');
  assert.match(FILE, /^-- update public\.received_payments r set paid_at = g\.paid_old from public\.payment_date_repair_log g where g\.source = 'payment'/m, 'the undo of the payments');
  assert.match(FILE, /^-- update public\.notice_payment_ledger l set paid_at = g\.paid_old from public\.payment_date_repair_log g where g\.source = 'ledger'/m, 'the undo of the ledger copies');
});

test('the ledger step is skipped on a book without the ledger: the migration that makes it is run by hand', () => {
  assert.match(CODE, /if to_regclass\('public\.notice_payment_ledger'\) is not null then/);
  // and the ledger is only ever named inside that block
  const outside = noStrings(CODE).replace(/do \$\$[\s\S]*?end \$\$;/, '');
  assert.doesNotMatch(outside, /notice_payment_ledger/);
});

test('the witness is the upload\'s own time, in East Africa, with the two windows written once', () => {
  assert.match(CODE, /\(r\.created_at at time zone 'Africa\/Dar_es_Salaam'\)::date as up/);
  assert.match(CODE, /date_trunc\('minute', r\.created_at\) as grp/, 'the rows written in the same minute are one upload');
  assert.match(CODE, /\(p\.d between p\.up - 14 and p\.up \+ 1\)/, 'as stored: from a fortnight before the upload to the day after it');
  assert.match(CODE, /\(p\.d <> p\.d_sw and p\.d_sw between p\.up - 7 and p\.up\)/, 'the other reading: a week before the upload to the upload day');
  assert.match(CODE, /g\.n_unamb = 0 and g\.n_amb_fit = 0 and g\.n_sw >= 1/, 'a swapped upload: no evidence in it, no ambiguous row that fits, one that fits the other way');
  // the exchange of day and month is the one the repair of the decks writes
  const sw = f => [...f.matchAll(/case when extract\(day from ([\w.]+)\) <= 12 and extract\(day from \1\) <> extract\(month from \1\)\s+then make_date\(extract\(year from \1\)::int, extract\(day from \1\)::int, extract\(month from \1\)::int\)\s+else \1 end/g)].length;
  assert.equal(sw(CODE), 1);
  assert.ok(sw(code(REPAIR60)) >= 3);
});

test('every column it reads or writes is one the real tables have, with the type its arithmetic needs', () => {
  assert.equal(typeOf('received_payments', 'id'), 'uuid');
  assert.equal(typeOf('received_payments', 'paid_at'), 'date');
  assert.equal(typeOf('received_payments', 'created_at'), 'timestamptz');
  for (const [c, t] of [['ref', 'text'], ['since', 'date'], ['payment_id', 'uuid'], ['paid_at', 'date']]) assert.equal(typeOf('notice_payment_ledger', c), t, 'notice_payment_ledger.' + c);
  assert.match(ddl('notice_payment_ledger'), /primary key \(ref, since, payment_id\)/, 'the log\'s key for a ledger copy is that key');
});

test('every column of the two tables that the file names is one the real table has', () => {
  const cols = (alias, table) => [...new Set([...noStrings(CODE).matchAll(new RegExp('\\b' + alias + '\\.([a-z_]+)', 'g'))].map(m => m[1]))];
  const r = cols('r'), l = cols('l');
  assert.ok(r.length >= 3 && l.length >= 3, 'the file reads the payments through r.<column> and the ledger through l.<column>: ' + r + ' / ' + l);
  for (const c of r) assert.ok(typeOf('received_payments', c), 'db/schema.sql has no column ' + c + ' on received_payments');
  for (const c of l) assert.ok(typeOf('notice_payment_ledger', c), 'db/schema.sql has no column ' + c + ' on notice_payment_ledger');
});

test('it prints no name and no number of a customer: the first part of a payment\'s id, and dates', () => {
  assert.doesNotMatch(noStrings(CODE), /\b(customer_name|customer_no|sender_name|payment_no|transaction_id|ref_no|team)\b/i);
  assert.match(CODE, /'    e\.g\. payment ' \|\| left\(g\.row_key, 8\)/);
});

test('the reader that stops the damage at the source is wired: the payments file is read with the day it is uploaded', () => {
  assert.match(IMPORTERS, /export function paymentsDateOrder\(csvRows, nearDate\)/);
  assert.match(IMPORTERS, /const near = nearDate \? nearestToDayIsDayFirst\(vals, nearDate\) : null;/);
  assert.match(UPLOAD, /sheetOrder = paymentsDateOrder\(rows, uploadDayKey_\(meta\)\);/);
  assert.match(UPLOAD, /records = importReceivedPayments\(rows, \{ dateOrder: sheetOrder \}\);/);
});

test('the kept check runs the whole real db/schema.sql, compares row by row with a model, tries the undo, a second run and a book without the ledger, and breaks the file on purpose', () => {
  assert.match(CHECK, /readFileSync\(path\.join\(ROOT, 'db\/schema\.sql'\)/);
  assert.doesNotMatch(CHECK.replace(/\/\*[\s\S]*?\*\//, ''), /create table[^\n]*(received_payments|notice_payment_ledger)\b/i, 'a fixture declared by hand once passed on a table that was not the book\'s (RUN-ME-061)');
  assert.match(CHECK, /undoOf\(file\)/);
  assert.match(CHECK, /twice: true, undo: true/);
  assert.match(CHECK, /ledger: false/);
  assert.match(CHECK, /BROKEN ON PURPOSE/);
  assert.ok((CHECK.match(/^\s+\['[^\n]+',\s+all\(/gm) || []).length >= 17, 'seventeen deliberate breaks, each of which must change the outcome');
});
