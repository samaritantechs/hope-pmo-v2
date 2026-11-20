// db/RUN-ME-075 (the ghost-rows function, cheaper in CPU) and db/RUN-ME-076 (the partial index that cuts its pages), pinned.
//
// The owner ran RUN-ME-075 by hand on 20 Nov 2026 and pasted its last line; RUN-ME-076 is offered with its measured cost. The
// files change a live function and add an index to the table /api/upload writes, so what ran is kept as it ran and what is offered
// says what it costs. The answers, the pages and the cost are measured by tools/db-checks/ghost-rows-cheaper.mjs on a real
// PostgreSQL (run by hand; it needs one); this file is what `npm test` can hold without a database.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const F075 = read('db/RUN-ME-075-defaulter-ghost-rows-cheaper.sql');
const F076 = read('db/RUN-ME-076-defaulter-snapshots-current-last-index.sql');
const F055 = read('db/RUN-ME-055-defaulter-ghosts.sql');
const CHECK = read('tools/db-checks/ghost-rows-cheaper.mjs');
const norm = s => s.replace(/\s+/g, ' ').trim();
const fnOf = text => { const i = text.indexOf('create or replace function defaulter_ghost_rows('); const j = text.indexOf('$$;', text.indexOf('$$', i + 200)) + 3; return text.slice(i, j); };
const codeOf = text => text.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
const FN075 = norm(fnOf(codeOf(F075)));

/* THE TEXT THAT RAN. The owner ran this function on the live book; a later edit of the file must not make the repository say it ran something it did not.
   Comments may change (the header was corrected the same day: counted in pages it reads the same pages as the first text); the function may not, without a
   new file and a new hash here. */
test('RUN-ME-075: the function that ran on the live book is the function kept', () => {
  assert.equal(crypto.createHash('sha256').update(FN075).digest('hex'), '3a5876322211872d2e6724aac2bf84f8f9f6b2b7f2b681b40da7b4f7ee3f93d5',
    'the function text of db/RUN-ME-075 changed: it is not what the owner ran at about 12:50 East Africa time on 20 Nov 2026; make a new file (RUN-ME-0NN) and a new hash');
});

test('RUN-ME-075 answers with the same name, arguments and columns as the first text, so the app, which asks for it by name, needs no change', () => {
  const cols = t => norm((t.match(/returns table\(([^)]*)\)/) || [])[1] || '');
  assert.ok(cols(F055).length > 100 && cols(F055).includes('snapshot_date date'), 'the first text\'s column list is found');
  assert.equal(cols(F075), cols(fnOf(F055)), 'the columns, in order');
  assert.match(FN075, /^create or replace function defaulter_ghost_rows\(p_teams text\[\], p_known_refs text\[\]\)/);
});

test('RUN-ME-075 keeps the lines that make it what it is', () => {
  assert.match(FN075, /language plpgsql stable set statement_timeout = '800ms' set enable_bitmapscan = off as \$\$/, 'stable, the 800 ms setting, and no bitmap scan (a bitmap scan collects every row of a customer)');
  assert.match(FN075, /foreach v_team in array p_teams loop/, 'one team at a time');
  assert.match(FN075, /and not exists \(select 1 from unnest\(p_known_refs\) k\(r\) where k\.r = wk\.ref\)/, 'the known refs are a hashed anti-join');
  assert.ok(!/<> ?all/.test(FN075), 'and never the array compared one by one again (ref <> all (array))');
  assert.match(FN075, /cross join lateral \(/, 'each candidate\'s newest row is asked for on its own');
  assert.match(FN075, /where d\.ref = c\.ref and d\.team = v_team and d\.snapshot_type = 'current' order by d\.snapshot_date desc, d\.created_at desc limit 1\) l/,
    'the customer, in this team, a CURRENT row, the newest first (the later upload of a day first), one row');
  assert.match(FN075, /with recursive walk as \(/, 'the walk over a team\'s refs by the (team, ref) index');
});

for (const [name, text] of [['RUN-ME-075', F075], ['RUN-ME-076', F076]]) {
  test(name + ' is a block the owner can paste: small, flush-left, plain text, with its END line', () => {
    assert.ok(text.length < 10000, 'under 10,000 characters: ' + text.length);
    assert.ok(!text.split('\n').some(l => /^\s/.test(l)), 'no line starts with a blank: nothing for an editor\'s indentation to pile up on');
    assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(text), 'plain ASCII');
    assert.match(text.split('\n').filter(Boolean).pop(), /^-- END OF THE (SCRIPT|FILE):/, 'it ends with the line the owner looks for');
  });
}

test('RUN-ME-075 changes only that function: nothing is dropped, deleted or altered', () => {
  const code = codeOf(F075);
  assert.ok(!/\b(drop|delete|truncate|alter|insert|update)\b/i.test(code), 'no destructive statement outside a comment');
  assert.match(F075, /UNDO: run section 3 of db\/RUN-ME-055/, 'and the way back is written');
});

test('RUN-ME-076: the statement is the index the check builds, alone, CONCURRENTLY, partial', () => {
  const stmts = codeOf(F076).split('\n').filter(l => /^create index/i.test(l));
  assert.equal(stmts.length, 1, 'one statement that makes anything');
  assert.equal(stmts[0], "create index concurrently if not exists idx_def_snap_current_last on defaulter_snapshots (team, ref, snapshot_date desc, created_at desc) where snapshot_type = 'current';");
  assert.match(F076, /-- SECTION 1 -- RUN ALONE\.\ncreate index concurrently/, 'section 1 says to run alone and is the next line');
});

test('RUN-ME-076 changes no row and drops nothing; its undo is written, commented, and names the index', () => {
  const code = codeOf(F076);
  assert.ok(!/\b(drop|delete|truncate|alter|insert|update)\b/i.test(code), 'no destructive statement outside a comment');
  assert.match(F076, /^-- drop index concurrently if exists idx_def_snap_current_last;$/m, 'the undo, commented');
  assert.match(code, /indisvalid/, 'section 2 reads whether the index is valid');
});

/* The file says what the index costs the upload, because /api/upload writes this table (CLAUDE.md section 1: a reason written down beside anything the upload pays for). */
test('RUN-ME-076 says what it costs the upload, what it saves, and how it was measured', () => {
  assert.match(F076, /WHAT IT COSTS/);
  assert.match(F076, /\/api\/upload/);
  assert.match(F076, /microseconds for each current row/);
  assert.match(F076, /\+119 ms/);
  assert.match(F076, /PAGES/);
  assert.match(F076, /6 to 6\.4 times fewer pages/);
  assert.match(F076, /CONCURRENTLY does not block \/api\/upload's\n-- writes while it builds/, 'building it does not stop the upload');
});

test('the kept check holds both files to what they say, and breaks them on purpose', () => {
  assert.match(CHECK, /db\/RUN-ME-075-defaulter-ghost-rows-cheaper\.sql/);
  assert.match(CHECK, /db\/RUN-ME-076-defaulter-snapshots-current-last-index\.sql/);
  assert.match(CHECK, /section3Of055/, 'the first text is the one RUN-ME-055 carries, installed beside the new one');
  const count = name => { const m = CHECK.match(new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\n\\];')); return m ? (m[1].match(/^  \[/gm) || []).length : 0; };
  assert.ok(count('BREAKS_075') >= 14, 'deliberate breaks of the function: ' + count('BREAKS_075'));
  assert.ok(count('BREAKS_076') >= 7, 'deliberate breaks of the index file: ' + count('BREAKS_076'));
  assert.match(CHECK, /pg_get_indexdef/, 'the index is held to the definition the file says');
  assert.match(CHECK, /Buffers: shared/, 'the pages are counted, not only the milliseconds');
  assert.match(CHECK, /two inputs the app never sends/i, 'the NULL known list is pinned to what it does');
});

test('the handbook and CHAT.md record RUN-ME-076 with its numbers and what is not claimed', () => {
  const h = read('docs/HANDOFF.md'), c = read('CHAT.md');
  assert.match(h, /RUN-ME-076/);
  assert.match(c, /RUN-ME-076/);
  assert.match(h, /not run|NOT RUN/i, 'it is offered, not run');
});
