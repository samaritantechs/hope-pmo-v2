// db/RUN-ME-084 (what the tables the upload and the call app write carry: every index, with its size, its use, how much of it is served from memory and
// whether it is valid; a read-only look at Postgres's own statistics and the catalogue), pinned.
//
// "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026. The second RUN-ME-080 table (21 Nov) showed the
// upload's own write, the insert into defaulter_snapshots, at 1.3 seconds a statement over its last 88 runs against 0.45 s over its whole life. Every index
// of that table is written for every row a deck puts in, so this lists them. The owner pastes it by hand into a tool that cut an earlier paste at 20,000
// characters (CHAT.md section 7) and the file touches the tables the two things that never slow down use, so its form, its read-only-ness and the
// functions it does NOT use (each of which waits behind a lock on a table: found by the kept check, whose first form of this file used one) are held here.
// What it PRINTS is run on a real PostgreSQL, on the real schema and the live book's hand-made indexes, by tools/db-checks/write-path-indexes.mjs (by hand;
// it needs one).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const F = read('db/RUN-ME-084-write-path-tables-and-indexes-read-only.sql');
const code = F.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
const bare = code.replace(/'[^']*'/g, "''");                                // the words inside the quoted labels are not tables or functions

test('RUN-ME-084 is a block the owner can paste: small, flush-left, plain text, ONE statement, with its END line', () => {
  assert.ok(F.length < 10000, 'under 10,000 characters: ' + F.length);
  assert.ok(!F.split('\n').some(l => /^\s/.test(l)), 'no line starts with a blank: nothing for an editor\'s indentation to pile up on');
  assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(F), 'plain ASCII');
  assert.match(F.split('\n').filter(Boolean).pop(), /^-- END OF THE READ$/, 'it ends with the line the owner looks for');
  assert.equal((code.match(/;/g) || []).length, 1, 'one statement, ended by its one semicolon');
  assert.match(code.trim(), /^select tbl, kind, name, size, asked, from_memory, detail from \(/, 'it starts at its first word');
});

test('RUN-ME-084 reads only Postgres\'s own statistics and the catalogue, changes nothing, and names no table of the book but the four', () => {
  assert.ok(!/\b(insert|update|delete|drop|create|alter|truncate|grant|revoke|vacuum|analyze|copy|reset|listen|notify|lock|refresh|set)\b/i.test(bare), 'no word that writes or locks');
  const from = new Set([...bare.matchAll(/\b(?:from|join)\s+([a-z_]+)/gi)].map(m => m[1].toLowerCase()));
  const allowed = new Set(['pg_class', 'pg_stat_user_tables', 'pg_statio_user_tables', 'pg_stat_user_indexes', 'pg_statio_user_indexes', 'pg_index', 'pg_am', 'pg_attribute', 'unnest']);
  assert.deepEqual([...from].filter(n => !allowed.has(n)), [], 'it reads nothing else: ' + [...from].join(','));
  assert.ok(!/\bpublic\.[a-z_]+/i.test(code), 'and names no table of the book as a table');
  const tables = [...code.matchAll(/in \(('defaulter_snapshots'[^)]*)\)/g)].map(m => m[1]);
  assert.equal(tables.length, 2, 'the same four tables are asked of in both halves');
  for (const t of tables) assert.equal(t, "'defaulter_snapshots', 'repayment_snapshots', 'call_logs', 'followup_status'", 'the four tables the two paths use, and no other');
});

test('RUN-ME-084 never takes a lock on a table: no size function, no definition function (each waits behind a lock held on the table)', () => {
  assert.ok(!/pg_total_relation_size|pg_relation_size|pg_table_size|pg_indexes_size|pg_database_size/.test(code), 'no size function');
  assert.ok(!/pg_get_indexdef|pg_get_expr|pg_get_constraintdef|pg_get_viewdef|pg_get_triggerdef|::regclass|to_regclass|pg_stat_file|pg_locks/.test(code), 'no definition function and no regclass cast: the first form of this file used pg_get_indexdef and the kept check\'s probe found it waiting behind an ACCESS EXCLUSIVE lock');
  assert.match(code, /c\.relpages \+ coalesce\(tt\.relpages, 0\)/, 'a table, with its TOAST: pages, not a function');
  assert.match(code, /ic\.relpages::bigint \* 8192/, 'an index: pages, not a function');
  assert.match(code, /unnest\(ix\.indkey::int2\[\]\) with ordinality as k\(attnum, n\) left join pg_attribute a on a\.attrelid = ix\.indrelid and a\.attnum = k\.attnum/, 'an index\'s columns from the catalogue\'s own list, of that index\'s own table');
  assert.match(F, /WITHOUT a lock on any table/, 'and the file says so');
});

test('RUN-ME-084 prints what the reading in the chat promises', () => {
  assert.match(code, /^select tbl, kind, name, size, asked, from_memory, detail from \(/m);
  assert.match(code, /'TABLE' as kind/);
  assert.match(code, /'index', si\.indexrelname/);
  assert.match(code, /'inserts ' \|\| st\.n_tup_ins \|\| ', updates ' \|\| st\.n_tup_upd \|\| ', deletes ' \|\| st\.n_tup_del \|\| ', whole-table reads ' \|\| st\.seq_scan \|\| ' \(' \|\| st\.seq_tup_read \|\| ' rows\), by index '/, 'what has been asked of a table: writes, whole-table reads, index reads');
  assert.match(code, /'live about ' \|\| st\.n_live_tup \|\| ', dead about ' \|\| st\.n_dead_tup/, 'the dead weight');
  assert.match(code, /greatest\(st\.last_vacuum, st\.last_autovacuum\)/, 'the last vacuum, by hand or by the database');
  assert.match(code, /greatest\(st\.last_analyze, st\.last_autoanalyze\)/, 'the last analyze');
  assert.match(code, /'scans ' \|\| si\.idx_scan \|\| ', rows read ' \|\| si\.idx_tup_read/, 'what has been asked of an index: nothing at all reads as scans 0');
  assert.match(code, /io\.idx_blks_hit \/ nullif\(io\.idx_blks_hit \+ io\.idx_blks_read, 0\)/, 'how much of an index came from memory');
  assert.match(code, /when not ix\.indisvalid then 'INVALID \(writes pay for it, nothing reads it\) ' when ix\.indisprimary then 'PRIMARY KEY ' when ix\.indisunique then 'UNIQUE '/, 'an invalid index, the primary key and a unique index say so');
  assert.match(code, /case when ix\.indpred is not null then ' partial \(only some rows\)'/, 'a partial index says so');
  assert.match(code, /order by tbl, k, bytes desc, name;\s*$/, 'a table, then its indexes biggest first');
  assert.ok(!/\bfull_name\b|\bcontact\b|\bguarantor|\barrears\b|\bref\b\s*(,|from)/i.test(bare.replace(/\ba\.attname\b/g, '')), 'no column of a customer is read, so no customer can be in the answer');
});

test('RUN-ME-084 says what it is for, what it prints, what a size is and what it costs', () => {
  assert.match(F, /no customer name, number or amount in it/);
  assert.match(F, /1\.3 seconds a statement over its\n-- last 88 runs against 0\.45 s on average over its whole life/);
  assert.match(F, /Only names, definitions and counters: never a row of any table/);
  assert.match(F, /the catalogue's own page counts \(as of the last vacuum or analyze: about\)/);
  assert.match(F, /it changes nothing and touches no table of the book/);
});

test('the handbook and CHAT.md record RUN-ME-084 and what the second RUN-ME-080 table showed', () => {
  const doc = read('docs/HANDOFF.md'), chat = read('CHAT.md');
  assert.match(doc, /RUN-ME-084/);
  assert.match(doc, /Part 127, addendum 3/);
  assert.match(doc, /the upload's insert[^\n]*1,279 ms|1,279 ms[^\n]*upload/i, 'the upload\'s 1.28 seconds a statement is in the Part');
  assert.match(chat, /RUN-ME-084/);
  assert.match(chat, /#773/);
});
