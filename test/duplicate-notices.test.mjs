/* db/RUN-ME-074-remove-duplicate-demand-notices.sql -- the lines that make it safe and true, pinned (docs/HANDOFF.md Part 112).

     "SQL to delete duplicate demand notices by ref no" -- the owner, 20 Nov 2026

   The file DELETES notices from the live book (a legal register): it keeps one notice for each ref (the first issued), copies every other one whole to demand_notices_removed and deletes it, in ONE
   statement, with an undo that puts them back. Node cannot run SQL: the check that does (tools/db-checks/duplicate-notices.mjs, run by hand on a PostgreSQL over the WHOLE of db/schema.sql and the two
   migrations that add notice_id and the upload stamp, against a model written again, the undo byte for byte, cut texts, a book a hundred times the live one, and a list of deliberate breaks) is the proof;
   this is the guard that a later edit does not make it touch another table, lose its limits or its copy, delete without the copy in the same statement, widen what DAY removes, or stop being a text that
   can be pasted whole. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const FILE = rd('db/RUN-ME-074-remove-duplicate-demand-notices.sql');
const CHECK = rd('tools/db-checks/duplicate-notices.mjs');
const SCHEMA = rd('db/schema.sql');
const code = f => f.split('\n').map(l => {
  if (/^\s*--/.test(l)) return '';
  let q = false;
  for (let i = 0; i < l.length; i++) { if (l[i] === "'") q = !q; else if (!q && l[i] === '-' && l[i + 1] === '-') return l.slice(0, i); }
  return l;
}).join('\n');
const CODE = code(FILE);
const noStrings = s => s.replace(/'(?:[^']|'')*'/g, "''");
const squash = s => s.replace(/\s+/g, ' ');
const names = (re, s) => [...new Set([...noStrings(s).matchAll(re)].map(m => m[1].toLowerCase()))].sort();
const ddl = name => { const i = SCHEMA.indexOf('create table if not exists ' + name + ' ('); return SCHEMA.slice(i, SCHEMA.indexOf('\n);', i)); };
const typeOf = (t, c) => ((ddl(t).match(new RegExp('(?:^|[\\s,(])' + c + '\\s+([a-z]+)')) || [])[1]);
const LABEL = "'DUPLICATE NOTICES 20 NOV (SQL)'";

test('it is a text that can be pasted whole: under 10,000 characters, no line starting with a blank, plain ASCII, ending with its END line (CHAT.md section 7)', () => {
  assert.ok(FILE.length < 10000, 'the paste route has cut a text at 20,000 characters once: a block stays under half of that (' + FILE.length + ')');
  assert.ok(!/^[ \t]/m.test(FILE), 'no line starts with a blank: nothing for an indentation to pile up on');
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(FILE), 'plain ASCII');
  assert.ok(FILE.trimEnd().split('\n').pop().startsWith('-- END OF THE SCRIPT'), 'the last line is the one the owner looks for in the editor');
});

test('it deletes only from demand_notices, copies only into its own private table, makes nothing else, and reads no table but those two', () => {
  assert.deepEqual(names(/\bdelete\s+from\s+public\.([a-z_]+)/gi, CODE), ['demand_notices']);
  assert.deepEqual(names(/\binsert\s+into\s+public\.([a-z_]+)/gi, CODE), ['demand_notices_removed']);
  assert.deepEqual(names(/\bcreate\s+table\s+if\s+not\s+exists\s+public\.([a-z_]+)/gi, CODE), ['demand_notices_removed']);
  assert.deepEqual(names(/\balter\s+table\s+public\.([a-z_]+)\s+enable\s+row\s+level\s+security/gi, CODE), ['demand_notices_removed'], 'the copy is never readable through the public API');
  assert.doesNotMatch(noStrings(CODE), /\b(update|drop|truncate|grant|revoke|vacuum|copy|call)\b/i, 'it deletes the repeats and nothing else');
  assert.deepEqual(names(/\bpublic\.([a-z_]+)/gi, CODE), ['demand_notices', 'demand_notices_removed'], 'no payment, no ledger, no deck: those are not this file\'s business');
  assert.equal((noStrings(CODE).match(/\bdelete\s+from\b/gi) || []).length, 1);
});

test('it can never run long or wait behind an upload: a 5-second lock limit, a 60-second ceiling, the compiler off', () => {
  assert.match(CODE, /^set local lock_timeout = '5s';/m);
  assert.match(CODE, /^set local statement_timeout = '60s';/m);
  assert.match(CODE, /^set local jit = off;/m);
});

test('the copy and the delete are CTEs of ONE statement, so a notice is never deleted without its copy (or copied and kept): all of it or none', () => {
  const statements = CODE.split(';').map(s => s.trim()).filter(Boolean);
  const withs = statements.filter(s => /^with\b/i.test(s));
  assert.equal(withs.length, 1, 'one statement does the work');
  const w = squash(withs[0]);
  assert.match(w, /\bsaved as \( insert into public\.demand_notices_removed \(label, kept_id, notice\) select /);
  assert.match(w, /\bgone as \( delete from public\.demand_notices d using doomed x where d\.id = x\.id returning d\.id \)/);
  assert.match(w, /\bsaved as \(.*\), gone as \(/, 'both inside the one WITH');
  assert.equal(statements.length, 6, 'three set lines, the table, its row-level security, and the statement: a cut text can only fail or finish');
});

test('the rule: one notice stays for each ref (blanks trimmed, any case), the first issued; DAY keeps a ref\'s other days, REF does not; a blank ref is never grouped; any other word removes nothing', () => {
  const w = squash(CODE);
  assert.match(w, /upper\(btrim\(d\.ref\)\) as rk/);
  assert.match(w, /where nullif\(btrim\(d\.ref\), ''\) is not null/);
  assert.match(w, /partition by s\.rk, case when c\.mode = 'DAY' then s\.notice_date::text end order by s\.notice_date, s\.created_at, \(s\.notice_id is null\), s\.id/);
  assert.match(w, /row_number\(\) over w as rn, first_value\(s\.id\) over w as keep_id/);
  assert.match(w, /where r\.rn > 1 and r\.mode in \('DAY', 'REF'\)/);
  assert.equal((CODE.match(/'DAY'::text as mode/g) || []).length, 1, 'the word is typed once, and DAY is what is sent');
  const lines = FILE.split('\n');
  const at = lines.findIndex(l => /'DAY'::text as mode/.test(l));
  assert.match(lines[at - 1], /^-- CHANGE:/, 'the line above it says it is the one to change');
  assert.match(FILE, /NOTHING DONE: the word on the CHANGE line must be DAY or REF/);
});

test('the copy is the WHOLE row as jsonb, and the undo reads it back with the table\'s own type, under the same label, and never fails on a row that is already back', () => {
  assert.match(squash(CODE), /select 'DUPLICATE NOTICES 20 NOV \(SQL\)', x\.keep_id, to_jsonb\(d\) from doomed x join public\.demand_notices d on d\.id = x\.id returning kept_id \)/, 'every doomed notice is copied, with nothing narrowing it');
  assert.equal((FILE.match(new RegExp(LABEL.replace(/[()]/g, '\\$&'), 'g')) || []).length, 2, 'the label is written in the copy and in the undo, and nowhere else');
  const undo = FILE.split('\n').filter(l => /^-- insert into/.test(l));
  assert.equal(undo.length, 1);
  assert.match(undo[0], /^-- insert into public\.demand_notices select \(jsonb_populate_record\(null::public\.demand_notices, x\.notice\)\)\.\* from public\.demand_notices_removed x where x\.label = 'DUPLICATE NOTICES 20 NOV \(SQL\)' on conflict do nothing;$/);
  assert.match(FILE, /^-- UNDO: /m);
});

test('the answer is one row of seven columns the check models, and it says what was left on other days', () => {
  const sel = squash(CODE.slice(CODE.lastIndexOf('select c.mode')));
  const cols = [...sel.matchAll(/\bas ([a-z_]+)\b/g)].map(m => m[1]);
  assert.deepEqual(cols, ['result', 'notices_with_a_ref', 'refs_with_repeats', 'notices_removed', 'notices_left', 'refs_served_on_more_than_one_day']);
  assert.match(sel, /^select c\.mode, case when/, 'the first column is the word the run used');
  assert.match(FILE, /THE WORD ON THE LINE MARKED CHANGE/);
  assert.match(FILE, /Nothing else is touched: no payment, no recoveries ledger, no deck\. A second run finds nothing to remove\./);
});

test('every column it touches is one the real book has, with the type its ordering needs', () => {
  assert.equal(typeOf('demand_notices', 'id'), 'uuid');
  assert.equal(typeOf('demand_notices', 'ref'), 'text');
  assert.equal(typeOf('demand_notices', 'notice_date'), 'date');
  assert.equal(typeOf('demand_notices', 'created_at'), 'timestamptz');
  assert.match(rd('db/migrations/2026-07-26-demand-notice-id.sql'), /alter table demand_notices add column if not exists notice_id text;/);
  assert.match(FILE, /create table if not exists public\.demand_notices_removed \(\nremoved_at timestamptz not null default now\(\), label text not null, kept_id uuid, notice jsonb not null\n\);/);
});

test('the kept check runs the whole real schema and both migrations, compares every notice with a model, tests the undo byte for byte, the cut texts, a second run and a refused word, and breaks the file on purpose -- and every break it makes is a line the file still has once', () => {
  assert.match(CHECK, /readFileSync\(ROOT \+ '\/db\/schema\.sql'/);
  assert.match(CHECK, /2026-07-26-demand-notice-id\.sql/);
  assert.match(CHECK, /2026-07-28-upload-stamp\.sql/);
  assert.match(CHECK, /byte for byte/);
  assert.match(CHECK, /a second run: nothing to remove, nothing written/);
  assert.match(CHECK, /cut points/);
  assert.match(CHECK, /a word that is neither DAY nor REF/);
  assert.match(CHECK, /BROKEN ON PURPOSE/);
  assert.doesNotMatch(CHECK.replace(/\/\*[\s\S]*?\*\//, ''), /create table[^\n]*demand_notices\b/i, 'the table is the real one, never declared by hand');
  const block = CHECK.slice(CHECK.indexOf('const ORDER = '), CHECK.indexOf('\nconst MUT = '));
  const BREAKS = new Function(block.replace('const BREAKS', 'var BREAKS') + '\nreturn BREAKS;')();
  assert.ok(BREAKS.length >= 20, 'twenty deliberate breaks or more (' + BREAKS.length + ')');
  for (const [name, from, to] of BREAKS) {
    assert.equal(FILE.split(from).length, 2, 'the break "' + name + '" names a line the file has exactly once');
    assert.notEqual(from, to);
  }
});
