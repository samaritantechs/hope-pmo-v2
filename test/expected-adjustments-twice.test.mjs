/* PINS FOR db/RUN-ME-086 (the Iliyonasia entries filed twice, once against each expected book) and its kept check.
   The check itself (tools/db-checks/expected-adjustments-twice.mjs) needs a PostgreSQL and runs by hand; these pins run
   in npm test and fail if the file or the check drifts from what handbook Part 132 says of them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(new URL('../db/RUN-ME-086-expected-adjustments-filed-twice-read-only.sql', import.meta.url), 'utf8');
const CHECK = readFileSync(new URL('../tools/db-checks/expected-adjustments-twice.mjs', import.meta.url), 'utf8');
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
const body = SQL.split('\n').filter(l => !l.startsWith('--')).join('\n');

test('RUN-ME-086 is one read-only statement a paste cannot cut: flush-left, under 10,000 characters, with its END line', () => {
  assert.ok(SQL.length < 10000, 'under 10,000 characters (CHAT.md section 7)');
  assert.ok(SQL.split('\n').every(l => !/^\s/.test(l)), 'no line starts with a blank');
  assert.equal(SQL.trimEnd().split('\n').pop(), '-- END OF RUN-ME-086');
  assert.equal((body.match(/;/g) || []).length, 1, 'one statement');
  assert.ok(!/\b(insert|update|delete|alter|drop|create|truncate|grant)\b/i.test(body), 'reads only');
  assert.ok(/^with pairs as \(/m.test(body) && /from pairs\n\) p\n/.test(body), 'the pairs are found once, in a CTE both branches read');
});

test('RUN-ME-086 pairs an entry with one of the OTHER expected book on the day, the team, the ref and the amount, and counts the entries', () => {
  assert.match(body, /a\.target in \('expected-initial', 'expected-current'\)/);
  assert.match(body, /b\.target in \('expected-initial', 'expected-current'\) and b\.target <> a\.target/);
  assert.match(body, /where b\.id <> a\.id/);
  assert.match(body, /and b\.adj_date = a\.adj_date/);
  assert.match(body, /coalesce\(upper\(btrim\(b\.team\)\), ''\) = coalesce\(upper\(btrim\(a\.team\)\), ''\)/, 'a team in another case or with a blank is one team; no team is no team');
  assert.match(body, /coalesce\(btrim\(b\.ref\), ''\) = coalesce\(btrim\(a\.ref\), ''\)/);
  assert.match(body, /and b\.amount = a\.amount/);
  assert.ok(!/defaulter-/.test(body), 'the arrears books are never looked at');
  assert.match(body, /select 'COUNT', null, null, null, count\(\*\)::numeric, 'entries listed'/);
  assert.match(body, /order by \(p\.kind = 'COUNT'\), p\.adj_date desc, coalesce\(upper\(btrim\(p\.team\)\), ''\) collate "C"/, 'newest day first, then the team in plain code-point order on any collation');
  assert.match(body, /left\(coalesce\(p\.reason, ''\), 60\) as reason/, "the register's own words, cut at 60");
});

test('the kept check builds the register from db/schema.sql, models the file again, runs it twice and breaks it on purpose', () => {
  assert.match(CHECK, /RUN-ME-086-expected-adjustments-filed-twice-read-only\.sql/);
  assert.match(CHECK, /create table if not exists pmo_adjustments \\\(/, 'the table is the real one');
  assert.match(SCHEMA, /create table if not exists pmo_adjustments \(/);
  assert.match(CHECK, /function model\(rows\)/);
  assert.match(CHECK, /the table is byte-identical afterwards/);
  assert.match(CHECK, /a text cut at any line is refused or answers whole/);
  assert.match(CHECK, /a book without the register is refused/);
  // every deliberate break names a piece of the file that is there exactly once, so each break is live
  const m = /const BREAKS = (\[[\s\S]*?\n\]);/.exec(CHECK);
  assert.ok(m, 'the breaks list');
  const BREAKS = new Function('return ' + m[1])();
  assert.ok(BREAKS.length >= 10, BREAKS.length + ' breaks');
  for (const [name, from] of BREAKS) assert.equal(SQL.split(from).length, 2, 'break "' + name + '" names text that is in the file once');
  assert.match(CHECK, /need\(caught === BREAKS\.length/);
});
