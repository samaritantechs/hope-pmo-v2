// db/RUN-ME-077 (called_phones_today: the day's called numbers as one small database answer) and the call app's use of it, pinned.
//
// "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026. The call app's
// whole-day read of call_logs was the heaviest statement in pg_stat_statements (a quarter of the twelve heaviest together), and it sits under
// EVERY officer's list: CLAUDE.md section 1, the call app never goes down and never slows down. The file runs on the owner's book by hand;
// the app trusts its answer to tick customers; so what the file says, what the app asks and what the check measures are held together here.
// The answers, the pages and the privileges are measured by tools/db-checks/called-phones.mjs on a real PostgreSQL (run by hand; it needs
// one); the app's behaviour is in test/call.test.mjs; this file is what `npm test` can hold without a database.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const F077 = read('db/RUN-ME-077-called-phones-today.sql');
const CHECK = read('tools/db-checks/called-phones.mjs');
const CORE = read('api/_lib/call-core.js');
const MOCK = read('test/snapshot-totals-rpc.mjs');
const norm = s => s.replace(/\s+/g, ' ').trim();
const sqlCode = text => text.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
const jsCode = text => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const FN = norm(sqlCode(F077));
const APP = jsCode(CORE);

test('RUN-ME-077 is a block the owner can paste: small, flush-left, plain text, with its END line', () => {
  assert.ok(F077.length < 10000, 'under 10,000 characters: ' + F077.length);
  assert.ok(!F077.split('\n').some(l => /^\s/.test(l)), 'no line starts with a blank: nothing for an editor\'s indentation to pile up on');
  assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(F077), 'plain ASCII');
  assert.match(F077.split('\n').filter(Boolean).pop(), /^-- END OF THE SCRIPT:/, 'it ends with the line the owner looks for');
});

test('RUN-ME-077 answers ONE value {"phones": [...]} of the day\'s distinct numbers, longer than the threshold, never null', () => {
  assert.match(FN, /^create or replace function called_phones_today\(p_day date, p_min integer\) returns jsonb language sql stable as \$\$/,
    'the name, the two arguments (the app asks for them by name) and a single jsonb value: one row, so no row cap and no paging');
  assert.match(FN, /select jsonb_build_object\('phones', coalesce\(jsonb_agg\(distinct c\.phone\), '\[\]'::jsonb\)\) from call_logs c where c\.call_date = p_day and c\.duration > p_min and c\.phone <> '';/,
    'a distinct list under the key phones, an empty LIST (never null) for a quiet day, this day only, longer than the threshold (not "at least"), no empty number');
  assert.ok(!/\bset statement_timeout\b/i.test(FN), 'no limit of its own: the role\'s limit applies. A tighter one would make a slow database cost the app the failed call AND the old read');
  assert.ok(!/\border by\b/i.test(FN), 'no ORDER BY: the app never needs an order, and a sort of the whole day is what the old read paid three times');
});

test('RUN-ME-077 reads call_logs and changes nothing; only service_role may call it; the undo is written and commented', () => {
  const code = sqlCode(F077);
  assert.ok(!/\b(delete|truncate|alter|insert|update|drop)\b/i.test(code), 'no statement that changes a row, a table or a function outside a comment');
  assert.match(code, /revoke execute on function called_phones_today\(date, integer\) from public, anon, authenticated;/, 'the numbers are customers\' phones: not public, not anon, not authenticated (Supabase grants a new function to the API roles by default)');
  assert.match(code, /grant execute on function called_phones_today\(date, integer\) to service_role;/);
  assert.match(F077, /^-- UNDO, alone: drop function if exists called_phones_today\(date, integer\);$/m, 'the undo, commented, names the function and its arguments');
  assert.match(code, /select jsonb_array_length\(called_phones_today\(current_date, 5\)->'phones'\) as numbers_called_today;/, 'the line that says it landed answers one number');
});

test('RUN-ME-077 says what it saves, how it was measured, what is not known, and what it costs the call app and the upload', () => {
  assert.match(F077, /272,573 times/, 'the statement it replaces, in the owner\'s own numbers');
  assert.match(F077, /MEASURED by tools\/db-checks\/called-phones\.mjs/);
  assert.match(F077, /buffers touched/, 'pages are counted, not only milliseconds');
  assert.match(F077, /The live seconds are NOT known/, 'what was not measured is said');
  assert.match(F077, /WHAT IT COSTS: nothing/);
  assert.match(F077, /REPLACES the read: one call where there were three or more\. Nothing is added to \/api\/upload\./, 'CLAUDE.md section 1: the reads added to /api/call and /api/upload are counted and written beside the change');
  assert.match(F077, /UNTIL IT IS RUN the app reads the day page by page exactly as it always did/, 'a code path that depends on a migration works without it');
});

/* The three places that must agree on the two argument names: the SQL, the app's rpc call, and the mock every test reads. */
test('the SQL, the app and the test mock use the same function name and the same two argument names', () => {
  assert.match(APP, /const CALLED_FN = 'called_phones_today';/);
  assert.match(APP, /db\.rpc\(CALLED_FN, \{ p_day: day, p_min: min \}\)/, 'the app asks for the day and the threshold by the names the SQL declares');
  assert.match(MOCK, /called_phones_today: \(store, a = \{\}\) =>/);
  assert.match(MOCK, /a\.p_day\b/);
  assert.match(MOCK, /a\.p_min\b/);
  assert.match(MOCK, /CALLED_PHONES_RPC/);
});

test('the app keeps the old read as the fall-back, remembers a failure for five minutes, and asks the database for the answer in one place', () => {
  assert.match(APP, /const CALLED_FN_PAUSE_MS = 5 \* 60 \* 1000;/);
  assert.match(APP, /if \(failed && \(Date\.now\(\) - failed\) < CALLED_FN_PAUSE_MS\) return null;/, 'a function that failed (or is not installed) is not asked again for five minutes');
  assert.match(APP, /calledFnFailed\.set\(db, Date\.now\(\)\);\n {2}return null;/, 'every failure path (an error, a thrown call, an answer that is not {phones: [...]}) is remembered and falls back');
  assert.match(APP, /if \(!error && data && Array\.isArray\(data\.phones\)\) return data\.phones;/, 'an answer is trusted only when it is the shape the function makes');
  assert.match(APP, /const rows = await fetchAll\(\(\) => db\.from\('call_logs'\)\.select\('phone, duration'\)\.eq\('call_date', day\)\);/, 'the old read, unchanged');
  assert.match(APP, /if \(num\(r\.duration\) <= min\) continue;/, 'and its threshold, unchanged: not "at least"');
  assert.equal((APP.match(/db\.rpc\(CALLED_FN/g) || []).length, 1, 'the function is asked for in exactly one place');
  assert.equal((APP.match(/from\('call_logs'\)\.select\('phone, duration'\)/g) || []).length, 1, 'and the day\'s rows are read in exactly one place (one definition of "called today")');
  assert.match(APP, /for \(const p of phones\) \{ const d = pnorm\(p\); if \(d\) set\[d\] = 1; \}/, 'the numbers come back as stored and pnorm, here, is what decides what a number is (the SQL never normalises)');
});

test('the kept check holds the file to what it says and breaks it on purpose', () => {
  assert.match(CHECK, /db\/RUN-ME-077-called-phones-today\.sql/);
  assert.match(CHECK, /CALLED_PHONES_RPC/, 'the answer is compared with the mock the tests read');
  assert.match(CHECK, /oldRead\(/, 'and with what the old page-by-page read built');
  assert.match(CHECK, /const \{ pnorm \} = await import\('\.\.\/\.\.\/api\/_lib\/call-core\.js'\);/, 'both through pnorm, the app\'s own definition of a number, imported from the app and never written again');
  assert.match(CHECK, /order by id asc limit 10000 offset/, 'the old read is measured in the shape the app sent it: the table\'s key as ORDER BY, ten thousand rows a page');
  assert.match(CHECK, /Buffers: shared/, 'the pages are counted, not only the milliseconds');
  assert.match(CHECK, /'random'/, 'in the worst layout a table can have, as well as the one calls really have');
  assert.match(CHECK, /alter default privileges in schema public grant all on functions to anon, authenticated, service_role/, 'with Supabase\'s default grants, so the revoke is what is tested');
  assert.match(CHECK, /has_function_privilege/, 'who may call it is read from the catalogue');
  const m = CHECK.match(/const BREAKS = \[([\s\S]*?)\n\];/);
  assert.ok(m, 'the list of deliberate breaks is found');
  assert.ok((m[1].match(/^  \[/gm) || []).length >= 11, 'deliberate breaks of the file: ' + (m[1].match(/^  \[/gm) || []).length);
});

test('the handbook and CHAT.md record RUN-ME-077 with its numbers and what is not claimed', () => {
  const h = read('docs/HANDOFF.md'), c = read('CHAT.md');
  assert.match(h, /Part 115/);
  assert.match(h, /RUN-ME-077/);
  assert.match(c, /RUN-ME-077/);
  assert.match(c, /called_phones_today/);
});
