// db/RUN-ME-079 (how the database is doing: a read-only look at Postgres's own counters), pinned.
//
// "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026. pg_stat_statements lists only the
// statements that FINISHED, and the two Logs Explorer queries handed over to name the cancelled ones went into the SQL editor three times, so
// this file is the part of the picture the SQL editor CAN show. The owner pastes it by hand into a tool that cut an earlier paste at 20,000
// characters (CHAT.md section 7), and it must be able to do no harm: so its form, its read-only-ness and what it touches are held here.
// What it PRINTS is run on a real PostgreSQL by tools/db-checks/database-health.mjs (by hand; it needs one).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const F = read('db/RUN-ME-079-database-health-read-only.sql');
const code = F.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
const norm = s => s.replace(/\s+/g, ' ').trim();

test('RUN-ME-079 is a block the owner can paste: small, flush-left, plain text, ONE statement, with its END line', () => {
  assert.ok(F.length < 10000, 'under 10,000 characters: ' + F.length);
  assert.ok(!F.split('\n').some(l => /^\s/.test(l)), 'no line starts with a blank: nothing for an editor\'s indentation to pile up on');
  assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(F), 'plain ASCII');
  assert.match(F.split('\n').filter(Boolean).pop(), /^-- END OF THE READ$/, 'it ends with the line the owner looks for');
  assert.equal((code.match(/;/g) || []).length, 1, 'one statement, ended by its one semicolon');
  assert.match(norm(code), /^with d as \(/, 'it starts at its first word');
});

test('RUN-ME-079 reads only Postgres\'s own counters and the catalogue, and changes nothing', () => {
  assert.ok(!/\b(insert|update|delete|drop|create|alter|truncate|grant|revoke|vacuum|analyze|copy|reset|listen|notify|lock|refresh)\b/i.test(code), 'no word that writes or locks');
  const bare = code.replace(/'[^']*'/g, "''");                              // the words inside the quoted labels are not tables
  const from = new Set([...bare.matchAll(/\bfrom\s+([a-z_]+)/gi)].map(m => m[1].toLowerCase()));
  const allowed = new Set(['pg_stat_database', 'pg_statio_user_tables', 'pg_stat_activity', 'pg_roles', 'd', 't', 'x']);
  assert.deepEqual([...from].filter(n => !allowed.has(n)), [], 'it reads nothing else: no table of the book, so no customer can be in it: ' + [...from].join(','));
  assert.ok(!/\bpublic\.[a-z_]+/i.test(code), 'and names no table of the book');
  assert.match(code, /where schemaname = 'public'\norder by pg_total_relation_size\(relid\) desc\nlimit 8/, 'the eight biggest tables, by name and counters only');
});

test('RUN-ME-079 prints what the reading in the chat promises, in this order', () => {
  const labels = ['now', 'counting since', 'database size', 'shared_buffers', 'effective_cache_size', 'max_connections', 'connections open now',
    'statements running now', 'transactions committed', 'transactions rolled back', 'rolled back, percent of all', 'cache hit percent',
    'temp files written', 'deadlocks', "' limits'", "'table '"];
  let at = -1;
  for (const l of labels) { const i = code.indexOf(l, at + 1); assert.ok(i > at, 'the label "' + l + '" comes after the one before it'); at = i; }
  assert.match(code, /pid <> pg_backend_pid\(\)/, 'the statement running now is not counted as one that is running');
  assert.match(code, /'authenticator', 'anon', 'authenticated', 'service_role', 'postgres'/, 'the limits of the roles the book is reached with');
  assert.match(code, /\) x\norder by ord;\s*$/, 'in the order of the numbers it gives each row');
});

test('RUN-ME-079 says what it is for, what it prints, how to read it and what it costs', () => {
  assert.match(F, /no customer name, number or amount in it/);
  assert.match(F, /a statement cancelled at the role's limit is in none of its figures/i);
  assert.match(F, /the lever is then the compute size, the owner's decision, not a code change/);
  assert.match(F, /the difference between two runs is what happened in between/i);
  assert.match(F, /it changes nothing and touches no table of the book/);
});

test('the handbook and CHAT.md record RUN-ME-079 and what the Logs Explorer queries did', () => {
  const doc = read('docs/HANDOFF.md'), chat = read('CHAT.md');
  assert.match(doc, /RUN-ME-079/);
  assert.match(doc, /the Logs Explorer queries went into the SQL editor three times/i);
  assert.match(chat, /RUN-ME-079/);
  assert.match(chat, /Logs Explorer[^.]*(DROPPED|dropped)/);
});

/* RUN-ME-080: the statements that write to disk and the ones that read the disk most, from pg_stat_statements. */
const F80 = read('db/RUN-ME-080-statements-that-spill-read-only.sql');
const code80 = F80.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
test('RUN-ME-080 is a block the owner can paste: small, flush-left, plain text, ONE statement, with its END line', () => {
  assert.ok(F80.length < 10000, 'under 10,000 characters: ' + F80.length);
  assert.ok(!F80.split('\n').some(l => /^\s/.test(l)), 'no line starts with a blank');
  assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(F80), 'plain ASCII');
  assert.match(F80.split('\n').filter(Boolean).pop(), /^-- END OF THE READ$/);
  assert.equal((code80.match(/;/g) || []).length, 1, 'one statement, ended by its one semicolon');
});
test('RUN-ME-080 reads one view of Postgres\'s own counters, changes nothing, and leaves the owner\'s own scripts out', () => {
  assert.ok(!/\b(insert|update|delete|drop|alter|truncate|grant|revoke|vacuum|analyze|copy|reset|listen|notify|lock|refresh)\b/i.test(code80.replace(/'[^']*'/g, "''").replace(/\(do\|create\|alter\|drop\|grant\|revoke\|copy\|set\|show\|begin\|commit\|truncate\|vacuum\)/g, '')), 'no word that writes or locks (outside the list of statements it leaves out)');
  const from = new Set([...code80.replace(/'[^']*'/g, "''").matchAll(/\bfrom\s+([a-z_]+)/gi)].map(m => m[1].toLowerCase()));
  assert.deepEqual([...from], ['pg_stat_statements'], 'it reads nothing else');
  assert.equal((code80.match(/query !~\* '\^\\s\*\(do\|create\|alter\|drop\|grant\|revoke\|copy\|set\|show\|begin\|commit\|truncate\|vacuum\)\\y'/g) || []).length, 2, 'both rankings leave out DO blocks and utility statements, whose text can carry what was typed');
  assert.match(code80, /left\(regexp_replace\(query, '\\s\+', ' ', 'g'\), 150\)/, 'the text is cut at 150 characters, runs of blanks as one');
  assert.match(code80, /order by temp_blks_written desc\nlimit 10\)/);
  assert.match(code80, /order by shared_blks_read desc\nlimit 10\)/);
  assert.match(F80, /LIMIT, said once: pg_stat_statements counts only statements that FINISHED/);
});
