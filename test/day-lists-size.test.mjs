// db/RUN-ME-087: HOW BIG WAS IT, AND WHEN DO THE DAY'S TWO FILES ARRIVE (handbook Part 136). A read-only look the owner runs in
// the SQL editor. These are pins of the file as a text: that it changes nothing, that it fits one paste, and that it counts
// what Part 136 says it counts. It was run by hand on a 3-million-row test book (two independent counts agreed with it:
// 14,868 on the newest later file and 252 who had left earlier; 0.6 seconds) -- that run is not repeated here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILE = readFileSync(new URL('../db/RUN-ME-087-day-lists-size-and-file-times-read-only.sql', import.meta.url), 'utf8');
const code = FILE.split('\n').filter(l => !l.startsWith('--')).join('\n');

test('RUN-ME-087 changes nothing: one ceiling and one select, and no word that writes', () => {
  const statements = code.split(';').map(s => s.trim()).filter(Boolean);
  assert.equal(statements.length, 2, 'a ceiling and the read');
  assert.equal(statements[0], "set local statement_timeout = '20s'", 'the ceiling is the first statement, local to the run');
  assert.match(statements[1], /^with q as \(/);
  for (const word of ['insert', 'update', 'delete', 'truncate', 'alter', 'create', 'drop', 'grant', 'revoke', 'vacuum', 'lock', 'copy', 'call', 'do ']) {
    assert.ok(!new RegExp('(^|[^a-z_])' + word.trim() + '([^a-z_]|$)', 'i').test(code.replace(/'[^']*'/g, "''")), 'no "' + word.trim() + '" outside a quoted word');
  }
});

test('RUN-ME-087 fits one paste: under 10,000 characters, every line at the left edge, plain text, and an END line to look for', () => {
  assert.ok(FILE.length < 10000, FILE.length + ' characters');
  for (const [i, l] of FILE.split('\n').entries()) assert.ok(!/^\s/.test(l) || l.trim() === '', 'line ' + (i + 1) + ' starts at the left edge');
  assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(FILE), 'plain ASCII');
  assert.equal(FILE.trimEnd().split('\n').pop(), '-- END OF RUN-ME-087');
});

test('RUN-ME-087 counts what Part 136 says: the customers ever on a later file of their team against the newest later file, and each day\'s own upload times', () => {
  assert.match(code, /ever as \(\s*select d\.team, d\.ref, max\(d\.snapshot_date\) as last_day\s+from public\.defaulter_snapshots d\s+where d\.snapshot_type = 'current'\s+group by d\.team, d\.ref\s*\)/,
    'who was ever on a later file: by team and loan number, the last day they were on one');
  assert.match(code, /latest as \(select max\(snapshot_date\) as d from public\.defaulter_snapshots where snapshot_type = 'current' and snapshot_date <= \(select today from q\)\)/);
  assert.match(code, /count\(\*\) filter \(where last_day = \(select d from latest\)\) as on_file/);
  assert.match(code, /count\(\*\) filter \(where last_day < \(select d from latest\)\) as gone,/);
  assert.match(code, /\(now\(\) at time zone 'Africa\/Dar_es_Salaam'\)::date as today/, 'today is the East Africa date');
  assert.match(code, /where d\.snapshot_date >= \(select today from q\) - 8 and d\.snapshot_date <= \(select today from q\)/, 'the last nine days, by date');
  assert.match(code, /min\(first_at\) filter \(where snapshot_type = 'initial'\) as ini_at/);
  assert.ok(!/full_name|contact|arrears|balance/.test(code), 'no name, number or amount is read');
});
