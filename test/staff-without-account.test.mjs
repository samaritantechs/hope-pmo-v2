/* db/RUN-ME-069-staff-without-bank-account-read-only.sql -- the lines that make it safe and true, pinned (docs/HANDOFF.md Part 99).

     "I also need a list of all staff without bank account numbers / 3 columns - by zone (1st and primary), team, staff name /
      So that I send it and demand them in Whatsapp group / Include even those with no zone" -- the owner, 17 Nov 2026

   The file is a read-only list the owner SENDS to a WhatsApp group and demands answers of: a name that should not be on it (a staff who has an account, one who left) or one missing from it
   (a placeholder in the ACCOUNTS cell, a staff with no zone) is somebody wrongly demanded or never asked. Node cannot run SQL: the check that does (tools/db-checks/staff-without-account.mjs,
   run by hand on a PostgreSQL over the WHOLE of db/schema.sql, in a database that sorts like C and one that ignores spaces and punctuation as the live book's en_US order does, row by row against
   a model written again, with a registry a hundred times the live one and a list of deliberate breaks) is the proof; this is the guard that a later edit does not make it write, print an
   account, a phone or a NIDA, drop the staff with no zone, lose the explicit order, or part company with the registry's columns. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const FILE = rd('db/RUN-ME-069-staff-without-bank-account-read-only.sql');
const SCHEMA = rd('db/schema.sql');
const CHECK = rd('tools/db-checks/staff-without-account.mjs');
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

test('it reads one table and changes nothing: no statement that writes, and no table but the staff registry', () => {
  assert.doesNotMatch(noStrings(CODE), /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|vacuum|copy|call|do)\b/i);
  const tables = [...new Set([...noStrings(CODE).matchAll(/\b(?:from|join)\s+public\.([a-z_]+)/gi)].map(m => m[1].toLowerCase()))];
  assert.deepEqual(tables, ['staff_registry']);
  assert.match(CODE, /^\s*set local statement_timeout = '30s';/m);
  assert.match(CODE, /^\s*set local jit = off;/m);
});

test('it prints three columns and nothing else: ZONE, TEAM, STAFF NAME. No account, no phone, no NIDA, no bank, no ID', () => {
  const out = squash(CODE.slice(CODE.lastIndexOf('select coalesce(nullif(s.zone0')));
  const cols = [...out.matchAll(/\bas "([A-Z ]+)"/g)].map(m => m[1]);
  assert.deepEqual(cols, ['ZONE', 'TEAM', 'STAFF NAME']);
  assert.match(out, /^select coalesce\(nullif\(s\.zone0, ''\), 'NO ZONE'\) as "ZONE", coalesce\(nullif\(s\.team0, ''\), '-'\) as "TEAM", s\.name0 as "STAFF NAME" from s order by /);
  assert.doesNotMatch(noStrings(out), /\b(account|phone|phone2|nida|tin|nssf|bank|id|birth_date|guarantor1|guarantor2|residence)\b/i, 'the part that prints names none of them');
  // the account is read once, in the filter, and never selected; nothing else that identifies or reaches a person is even read
  assert.equal((noStrings(CODE).match(/\baccount\b/g) || []).length, 1);
  assert.doesNotMatch(noStrings(CODE), /\b(phone|phone2|nida|tin|nssf|bank|birth_date|guarantor1|guarantor1_phone|guarantor2|guarantor2_phone|residence|created_by|updated_by)\b/i, 'the file does not read them at all');
});

test('NO ACCOUNT NUMBER means: empty, blank, no digit in it, or only zeros; an account with digits is given (the live rule, in one place)', () => {
  const c = squash(CODE);
  assert.match(c, /and regexp_replace\(coalesce\(r\.account, ''\), '\\D', '', 'g'\) ~ '\^0\*\$'/);
  // the same words in the header, so the owner reads what the file does
  assert.match(FILE, /or has no digit in it \("N\/A", "NONE", "ON PROCESS", "-", "HAINA"\), or its digits are all\s*--\s*zeros\. An account with digits in it counts as given, however short it looks\./);
});

test('ACTIVE STAFF ONLY by default, with one switch to list the Inactive too; the status is read as the portal reads it (capitals, blanks off)', () => {
  const c = squash(CODE);
  assert.match(c, /with cfg as \( select true as active_only/);
  assert.match(c, /where \(not cfg\.active_only or upper\(btrim\(coalesce\(r\.status, ''\)\)\) <> 'INACTIVE'\)/);
  assert.match(FILE, /CHANGE: false lists the staff switched to Inactive too/);
});

test('a staff with NO ZONE is listed (as "NO ZONE", after the last zone) and a staff with no team shows a dash: nobody is dropped by a join or a filter', () => {
  const c = squash(CODE);
  assert.doesNotMatch(c, /\b(join|where)\b[^;]*\bzone0 <> ''/, 'no filter on the zone');
  assert.doesNotMatch(noStrings(CODE).replace(/\bcross join cfg\b/g, ''), /\bjoin\b/i, 'no join but the one-row switch: a join to the teams table once dropped everybody it could not match');
  assert.match(c, /coalesce\(nullif\(s\.zone0, ''\), 'NO ZONE'\) as "ZONE"/);
  assert.match(c, /order by \(s\.zone0 = ''\), s\.zone0 collate "C", \(s\.team0 = ''\), s\.team0 collate "C", s\.name0 collate "C";\s*$/);
});

test('the order is explicit (collate "C"): the list is the same in a database whose default order ignores spaces and punctuation', () => {
  const order = squash(CODE.slice(CODE.lastIndexOf('order by')));
  assert.equal((order.match(/collate "C"/g) || []).length, 3, 'zone, team and name each carry it');
  assert.match(CHECK, /locale_provider icu icu_locale 'en-u-ka-shifted'/);
  assert.match(CHECK, /the SAME list, row for row, in the database whose default order ignores spaces and punctuation/);
});

test('the zone, the team and the name are read the way the registry writes them: runs of blanks as one, capitals; the team is what follows the role after its first " - "', () => {
  const c = squash(CODE);
  assert.match(c, /upper\(btrim\(regexp_replace\(coalesce\(r\.zone, ''\), '\\s\+', ' ', 'g'\)\)\) as zone0/);
  assert.match(c, /upper\(btrim\(regexp_replace\(coalesce\(substring\(r\.role from '\\s\+-\\s\+\(\.\*\)\$'\), ''\), '\\s\+', ' ', 'g'\)\)\) as team0/);
  assert.match(c, /upper\(btrim\(regexp_replace\(r\.name, '\\s\+', ' ', 'g'\)\)\) as name0/);
  // the template that files staff splits a role at the same " - " (db/TEMPLATE-staff-changes-from-gmo.sql: role_word - team_text)
  assert.match(rd('db/TEMPLATE-staff-changes-from-gmo.sql'), /regexp_replace\(coalesce\(r\.role, ''\), '\\s\+-\\s\+\.\*\$', ''\)/);
});

test('every column it reads is one the real staff registry has, as text: name, role, zone, account, status (and no team column exists: the team is in the role)', () => {
  for (const c of ['name', 'role', 'zone', 'account', 'status']) assert.equal(typeOf('staff_registry', c), 'text', c);
  assert.doesNotMatch(ddl('staff_registry'), /\bteam\b/, 'the registry keeps no team column: a team read from one would be a column that is not there');
});

test('the kept check runs the whole real schema, compares the list with a model row by row in two databases, tests the other switch, an empty registry and a registry of a hundred times the live one, and breaks the file on purpose', () => {
  assert.match(CHECK, /readFileSync\(path\.join\(ROOT, 'db\/schema\.sql'\)/);
  assert.doesNotMatch(CHECK.replace(/\/\*[\s\S]*?\*\//, ''), /create table[^\n]*staff_registry\b/i, 'the table is the real one, never declared by hand (RUN-ME-061)');
  assert.match(CHECK, /the registry is byte-identical afterwards/);
  assert.match(CHECK, /an empty registry gives no row and no error/);
  assert.match(CHECK, /generate_series\(1, 100000\)/);
  assert.match(CHECK, /BROKEN ON PURPOSE/);
  assert.ok((CHECK.match(/^\s+\['[^\n]+',\s+rep\(/gm) || []).length >= 22, 'twenty-two deliberate breaks or more, each of which must change the list');
});
