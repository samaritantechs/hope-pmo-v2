/* db/TEMPLATE-staff-compare-pairs-read-only.sql -- TWO STAFF RECORDS, ONE NAME: WHICH ONE STAYS? (docs/HANDOFF.md Part 103)
 *
 * The staff update (Part 101) prints "LOOK: another staff already carries the name sent" and never merges two records on a name alone.
 * This puts the two side by side so the owner can say which one stays. It is a template: no name, ID, number or account is in the repository,
 * it reads and changes nothing, and it prints no value, only whether the two records agree. Node cannot run SQL; the file was run on a PostgreSQL
 * built from the real schema and the real RUN-ME-044 table with pairs of every kind (the same person written another way, different accounts, a
 * record that is not there) and read back by eye; this keeps a later edit from putting a value, or a write, into it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const F = 'db/TEMPLATE-staff-compare-pairs-read-only.sql';
const FILE = readFileSync(new URL('../' + F, import.meta.url), 'utf8');
const code = FILE.split('\n').map(l => { if (/^\s*--/.test(l)) return ''; let q = false; for (let i = 0; i < l.length; i++) { if (l[i] === "'") q = !q; else if (!q && l[i] === '-' && l[i + 1] === '-') return l.slice(0, i); } return l; }).join('\n');
const noStrings = s => s.replace(/'(?:[^']|'')*'/g, "''");
const HOW = '. The repository is public: hand the filled copy to the owner and commit the template as it was (docs/HANDOFF.md Part 48).';

test('the template names nobody: one example pair of placeholder IDs, nothing else that could be a person', () => {
  const pairs = code.slice(code.indexOf('pairs(n, a_id, b_id) as (values'), code.indexOf('),\nx as ('));
  assert.deepEqual([...pairs.matchAll(/'([^']*)'/g)].map(m => m[1]), ['ABC/0001/2026', 'XYZ/0002/2026'], F + ' carries something that could be a person' + HOW);
  assert.equal((pairs.match(/^\s*\(\d+,/gm) || []).length, 1, 'one example pair');
  assert.match(FILE, /NO STAFF NAME, NUMBER OR ACCOUNT IS EVER COMMITTED/);
});

test('it reads and changes nothing: one select, no insert, update, delete, drop, create, alter, grant, copy or call', () => {
  const c = noStrings(code);
  assert.doesNotMatch(c, /\b(insert|update|delete|drop|create|alter|grant|revoke|truncate|vacuum|copy|call|do)\b/i);
  assert.match(code, /^\s*set local statement_timeout = '15s';/m);
  assert.match(code, /^\s*set local jit = off;/m);
  assert.deepEqual([...new Set([...c.matchAll(/\b(?:from|join)\s+(?:public\.)?([a-z_]+)/gi)].map(m => m[1].toLowerCase()))].filter(t => !['pairs', 'x', 'e', 'jsonb_each'].includes(t)).sort(), ['advance_requests', 'staff_registry']);
});

test('it prints no value: the final select shows the status, role, zone, dates, who made each record and counts, and each box only as agree or not', () => {
  const out = code.slice(code.lastIndexOf('select x.n as "#"'));
  // nothing of a box (phone, bank, account, NIDA, TIN, NSSF, birth date, residence, name) is selected: they only pass through the comparison
  assert.doesNotMatch(noStrings(out), /\bx\.(a|b)_(phone|bank|account|nida|tin|nssf|birth|residence|name)\b\s+as\b/, 'a value is printed');
  assert.deepEqual([...out.matchAll(/\bas ("?[#a-z_]+"?)/g)].map(m => m[1].replace(/"/g, '')), ['#', 'names', 'boxes'], 'only three computed columns: the rest are the records\' own status, role, zone, dates, who made them, and counts');
  for (const w of ["'same'", "'DIFFERENT'", "'only A'", "'only B'", "'the same name'", "'DIFFERENT NAMES'", "'NEITHER ID IS IN THE REGISTRY'"]) assert.ok(out.includes(w), w);
  // the comparison reads each box the way the staff form reads it, so the same number written another way is the same
  assert.match(code, /'phone',\s+array\[right\(regexp_replace\(coalesce\(a\.phone, ''\), '\\D', '', 'g'\), 9\)/);
  assert.match(code, /'account',\s+array\[upper\(regexp_replace\(coalesce\(a\.account, ''\), '\[\\s\.-\]', '', 'g'\)\)/);
  assert.match(code, /'nida',\s+array\[regexp_replace\(coalesce\(a\.nida, ''\), '\\D', '', 'g'\)/);
});
