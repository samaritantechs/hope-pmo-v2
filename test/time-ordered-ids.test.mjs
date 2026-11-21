// db/RUN-ME-085 (new rows of the deck table get a time-ordered id: UUID version 7), pinned. OFFERED, NOT RUN: the owner decides.
//
// "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026; CLAUDE.md section 1: the upload never slows down.
// The upload's insert into defaulter_snapshots took 1.3 s a statement over its last 88 runs (0.45 s over its life); on a scratch copy of the table, the primary key's
// random uuid is about half of every 1,000-row chunk's page reads, and a time-ordered id cuts one day's two decks from 22,988 to 14,471 pages read. The file changes the
// DEFAULT of one column of the table the upload writes, on the live book, by hand, in a tool that runs a script as one transaction: so what it touches, how long it may wait
// for a lock, that it rewrites no row, and that it can be undone are held here. What it DOES (ids that are version 7 and never go back, the API role writing by default, old
// rows untouched, the lock timeout, the break list) is run on a real PostgreSQL by tools/db-checks/time-ordered-ids.mjs (by hand; it needs one), and the saving in page reads
// by tools/db-checks/upload-index-cost/ (by hand; it needs a cluster of its own, and a book bigger than memory).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const F = read('db/RUN-ME-085-time-ordered-ids-for-the-deck-table.sql');
const code = F.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
const statements = code.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);

test('RUN-ME-085 is a block the owner can paste: small, flush-left, plain text, five statements, with its END line', () => {
  assert.ok(F.length < 10000, 'under 10,000 characters: ' + F.length);
  assert.ok(!F.split('\n').some(l => /^\s/.test(l)), 'no line starts with a blank: nothing for an editor\'s indentation to pile up on');
  assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(F), 'plain ASCII');
  assert.match(F.split('\n').filter(Boolean).pop(), /^-- END OF RUN-ME-085$/, 'it ends with the line the owner looks for');
  assert.ok(F.split('\n').every(l => l.length <= 230), 'no line longer than the function\'s own, which the kept check runs as it stands');
  assert.equal(statements.length, 5, 'the lock timeout, the function, the grant, the default, the answer: ' + statements.length);
  assert.ok(!/^\s*(begin|commit|start transaction)\b/im.test(code), 'no transaction statement of its own: the SQL editor runs a script as one transaction (every earlier RUN-ME file relies on it for set local), and an explicit one is the form no earlier file used');
});

test('RUN-ME-085 waits at most half a second for the table and rewrites nothing', () => {
  assert.match(statements[0], /^set local lock_timeout = '(\d+)ms'$/, 'its first statement is the lock timeout, before anything that could wait');
  assert.ok(Number(/'(\d+)ms'/.exec(statements[0])[1]) <= 1000, 'a second at most: a query that arrives while it waits for the lock waits behind it for that long: ' + statements[0]);
  const bare = code.replace(/\$\$[\s\S]*?\$\$/g, '$$$$');                                  // outside the function's body
  assert.ok(!/\b(update|delete|insert|truncate|vacuum|reindex|cluster|refresh|copy|drop|create (unique )?index|alter index)\b/i.test(bare), 'no word that rewrites a row, an index or a table, or drops anything');
  assert.deepEqual([...bare.matchAll(/\balter table ([a-z_.]+)/gi)].map(m => m[1].toLowerCase()), ['public.defaulter_snapshots'], 'it alters one table, the one the upload writes, and only once');
  assert.match(code, /alter table public\.defaulter_snapshots alter column id set default public\.hope_uuid_time_ordered\(\)/, 'and only the default of its id');
  assert.ok(!/\b(not null|type|drop default|set data type|add column|drop column|add constraint|primary key)\b/i.test(bare.replace(/select column_default[^\n]*\n?/i, '')), 'nothing about its type, its constraints or its key changes');
});

test('RUN-ME-085 makes a version 7 UUID: the millisecond clock first, random bits after, never the same twice', () => {
  const fn = /create or replace function public\.hope_uuid_time_ordered\(\) returns uuid language sql volatile as \$\$\n([\s\S]*?)\n\$\$;/.exec(code);
  assert.ok(fn, 'the function is the one named, returns uuid, and is VOLATILE (an immutable one would be evaluated once and give a whole insert one id)');
  const body = fn[1];
  assert.match(body, /gen_random_uuid\(\)/, 'its random bits are the database\'s own');
  assert.match(body, /clock_timestamp\(\)/, 'its clock is read for every row');
  assert.match(body, /floor\(extract\(epoch from clock_timestamp\(\)\) \* 1000\)::bigint/, 'in milliseconds');
  assert.match(body, /placing substring\(int8send\(floor\(extract\(epoch from clock_timestamp\(\)\) \* 1000\)::bigint\) from 3\) from 1 for 6\)/, 'the low six bytes of that number (48 bits) are the first six bytes of the id');
  assert.match(body, /set_bit\(set_bit\(overlay\(/, 'and the version bits are set on the result');
  assert.match(body, /, 52, 1\), 53, 1\)/, 'bits 52 and 53 turn the version nibble of a version 4 id into 7');
  assert.match(body, /'hex'\)::uuid/, 'and the answer is a uuid');
  assert.ok(!/\b(immutable|stable|security definer)\b/i.test(code), 'not immutable, not stable, not security definer');
  assert.match(code, /grant execute on function public\.hope_uuid_time_ordered\(\) to public;/, 'it may be run by the API role even on a book that takes new functions away from PUBLIC');
  assert.match(code, /^select column_default as id_default_now from information_schema\.columns where table_schema = 'public' and table_name = 'defaulter_snapshots' and column_name = 'id';$/m, 'and it answers the new default, read from the catalogue');
});

test('RUN-ME-085 says what it is for, what it measured, what it costs and how to undo it', () => {
  assert.match(F, /the primary key is about half\n-- of every chunk's reads once the cache is warm/);
  assert.match(F, /initial deck 14,323 to 8,198,\n-- current deck 8,665 to 6,273, together 22,988 to 14,471 \(37% fewer\), and 168 to 118 MB of write-ahead log/, 'the numbers of the scratch measurement');
  assert.match(F, /An existing row keeps its id: nothing is rewritten/);
  assert.match(F, /Run it in a quiet minute, not during an upload, and run it again if it says "lock timeout"/);
  assert.match(F, /NOTHING \(the SQL editor runs a script as one transaction, so the function is not made either\)/);
  assert.match(F, /-- UNDO, alone, in a new tab: alter table public\.defaulter_snapshots alter column id set default gen_random_uuid\(\);/, 'the undo is one line');
  assert.match(F, /offered, NOT run/);
});

test('the app sends no id of its own to the deck table, so every new row asks the default', () => {
  const imp = read('api/_lib/importers.js');
  const body = /export function importDefaulters\([\s\S]*?\n\}\n/.exec(imp);
  assert.ok(body, 'importDefaulters is where it was');
  assert.ok(!/\bid\s*:/.test(body[0]), 'the deck importer builds no id');
  const up = read('api/upload.js');
  assert.match(up, /table = 'defaulter_snapshots';/, 'the defaulters upload writes the deck table');
  const map = /const upsertTables = \{([\s\S]*?)\n  \};/.exec(up);
  assert.ok(map, 'the upload keeps one map of the tables it upserts');
  assert.ok(!/\bdefaulter_snapshots\b/.test(map[1]), 'and the deck table is not in it: its rows are plain inserts, never keyed on an id of the app\'s making');
  assert.match(up, /writeInChunks\(supabase, table, records, upsertTables\[table\] \|\| null, keepFirst, droppedCols\)/, 'written by the one chunked writer, as a plain insert (onConflict null)');
});

test('the handbook and CHAT.md record RUN-ME-085 and the measurement behind it', () => {
  const doc = read('docs/HANDOFF.md'), chat = read('CHAT.md');
  assert.match(doc, /RUN-ME-085/);
  assert.match(doc, /Part 127, addendum 4/);
  assert.match(doc, /22,988/);
  assert.match(doc, /upload-index-cost/);
  assert.match(chat, /RUN-ME-085/);
  assert.match(chat, /#774/);
});
