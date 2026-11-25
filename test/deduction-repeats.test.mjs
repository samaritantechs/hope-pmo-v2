/* db/RUN-ME-091-remove-repeated-deduction-cases.sql -- the lines that make it safe and true, pinned (docs/HANDOFF.md Part 164).

     "[a reporter] pressed multiple times at submitting deduction case and deductions went so many (16) so we must delete all unique rows in the
      existing deductions bro and prevent such an issue in the future" -- the owner, 25 Nov 2026 (the reporter's name is the owner's word; none is kept in the repository)

   The file DELETES lines from the live register HR deducts salaries by and the reporters are paid per case by: it keeps one case of each group of repeats (the one HR recorded on, else the first saved), NEVER
   removes a case HR has recorded on, copies every removed line whole to pmo_deductions_removed and deletes it, in ONE statement, with an undo that puts them back. Node cannot run SQL: the check that does
   (tools/db-checks/deduction-repeats.mjs, run by hand on a PostgreSQL over the WHOLE of db/schema.sql, against a model written again, the undo byte for byte, cut texts, a book of 90,000 lines and a list of
   deliberate breaks) is the proof; this is the guard that a later edit does not make it touch another table, lose its limits or its copy, delete without the copy in the same statement, stop protecting
   HR's lines, compare less than the whole line, widen what PRESS removes, or stop being a text that can be pasted whole. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rd = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const FILE = rd('db/RUN-ME-091-remove-repeated-deduction-cases.sql');
const CHECK = rd('tools/db-checks/deduction-repeats.mjs');
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
const LABEL = "'REPEATED DEDUCTION CASES 25 NOV (SQL)'";

test('it is a text that can be pasted whole: under 10,000 characters, no line starting with a blank, plain ASCII, ending with its END line (CHAT.md section 7)', () => {
  assert.ok(FILE.length < 10000, 'the paste route has cut a text at 20,000 characters once: a block stays under half of that (' + FILE.length + ')');
  assert.ok(!/^[ \t]/m.test(FILE), 'no line starts with a blank: nothing for an indentation to pile up on');
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(FILE), 'plain ASCII');
  assert.ok(FILE.trimEnd().split('\n').pop().startsWith('-- END OF THE SCRIPT'), 'the last line is the one the owner looks for in the editor');
});

test('it deletes only from pmo_deductions, copies only into its own private table, makes nothing else, and reads no table but those two', () => {
  assert.deepEqual(names(/\bdelete\s+from\s+public\.([a-z_]+)/gi, CODE), ['pmo_deductions']);
  assert.deepEqual(names(/\binsert\s+into\s+public\.([a-z_]+)/gi, CODE), ['pmo_deductions_removed']);
  assert.deepEqual(names(/\bcreate\s+table\s+if\s+not\s+exists\s+public\.([a-z_]+)/gi, CODE), ['pmo_deductions_removed']);
  assert.deepEqual(names(/\balter\s+table\s+public\.([a-z_]+)\s+enable\s+row\s+level\s+security/gi, CODE), ['pmo_deductions_removed'], 'the copy is never readable through the public API');
  assert.doesNotMatch(noStrings(CODE), /\b(update|drop|truncate|grant|revoke|vacuum|copy|call)\b/i, 'it deletes the repeats and nothing else');
  assert.deepEqual(names(/\bpublic\.([a-z_]+)/gi, CODE), ['pmo_deductions', 'pmo_deductions_removed'], 'no ledger, no payment, no deck: those are not this file\'s business');
  assert.equal((noStrings(CODE).match(/\bdelete\s+from\b/gi) || []).length, 1);
});

test('it can never run long or wait behind an upload: a 5-second lock limit, a 60-second ceiling, the compiler off', () => {
  assert.match(CODE, /^set local lock_timeout = '5s';/m);
  assert.match(CODE, /^set local statement_timeout = '60s';/m);
  assert.match(CODE, /^set local jit = off;/m);
});

test('the copy and the delete are CTEs of ONE statement, so a line is never deleted without its copy (or copied and kept): all of it or none', () => {
  const statements = CODE.split(';').map(s => s.trim()).filter(Boolean);
  const withs = statements.filter(s => /^with\b/i.test(s));
  assert.equal(withs.length, 1, 'one statement does the work');
  const w = squash(withs[0]);
  assert.match(w, /\bsaved as \( insert into public\.pmo_deductions_removed \(label, kept_case, line\) select /);
  assert.match(w, /\bgone as \( delete from public\.pmo_deductions d using doomed x where coalesce\(d\.case_id, d\.id::text\) = x\.ck returning d\.id \)/);
  assert.match(w, /\bsaved as \(.*\), gone as \(/, 'both inside the one WITH');
  assert.equal(statements.length, 6, 'three set lines, the table, its row-level security, and the statement: a cut text can only fail or finish');
});

test('the comparison is the WHOLE line, in the order the table has it: reporter, team, customer, REF NO, staff, amount taken, the two dates, decision, deduction, amount to pay -- nothing of when it was saved or of HR', () => {
  const w = squash(CODE);
  assert.match(w, /concat_ws\(chr\(31\), btrim\(coalesce\(d\.reporter, ''\)\), btrim\(coalesce\(d\.team, ''\)\), btrim\(coalesce\(d\.customer, ''\)\), btrim\(coalesce\(d\.ref, ''\)\), btrim\(coalesce\(d\.staff, ''\)\), coalesce\(d\.amount_taken::text, ''\), coalesce\(d\.received_date::text, ''\), coalesce\(d\.discovery_date::text, ''\), btrim\(coalesce\(d\.decision, ''\)\), coalesce\(d\.deduction::text, ''\), coalesce\(d\.to_pay::text, ''\)\) as txt/);
  const compared = w.slice(w.indexOf('concat_ws('), w.indexOf(') as txt'));
  for (const left of ['submitted_at', 'created_at', 'case_id', 'hr_notes', 'deducted', 'remaining', 'hr_by', 'hr_at', 'dept', 'created_by', 'upload_batch']) {
    assert.ok(!compared.includes(left), left + ' is not part of what makes two cases repeats');
  }
  // a case is its lines compared as a set (sorted), so the order the lines were saved in does not matter, and the same staff twice is two lines
  assert.match(w, /md5\(string_agg\(l\.txt, chr\(30\) order by l\.txt\)\) as sig/);
  assert.match(w, /coalesce\(d\.case_id, d\.id::text\) as ck/, 'a line with no case id (the sheet\'s register) is its own case');
  // every column it compares is a column of the real table, of the type it is cast from
  for (const c of ['reporter', 'team', 'customer', 'ref', 'staff', 'decision', 'hr_notes', 'hr_by', 'case_id']) assert.equal(typeOf('pmo_deductions', c), 'text', c);
  for (const c of ['amount_taken', 'deduction', 'to_pay', 'deducted', 'remaining']) assert.equal(typeOf('pmo_deductions', c), 'numeric', c);
  for (const c of ['received_date', 'discovery_date']) assert.equal(typeOf('pmo_deductions', c), 'date', c);
  for (const c of ['submitted_at', 'hr_at']) assert.equal(typeOf('pmo_deductions', c), 'timestamptz', c);
});

test('HR\'S LINES ARE NEVER REMOVED: any of the five HR columns marks a case as recorded on, it ranks first, and it is never in what is removed', () => {
  const w = squash(CODE);
  assert.match(w, /\(d\.hr_at is not null or d\.hr_by is not null or coalesce\(d\.deducted, 0\) <> 0 or coalesce\(d\.remaining, 0\) <> 0 or nullif\(btrim\(coalesce\(d\.hr_notes, ''\)\), ''\) is not null\) as hr/);
  assert.match(w, /bool_or\(l\.hr\) as hr/, 'one HR line makes the whole case HR\'s');
  assert.match(w, /window w as \(partition by c\.sig order by c\.hr desc, c\.at, c\.ck\)/, 'the HR case stays in preference to an earlier plain one; else the first saved; the case id breaks a tie');
  assert.match(w, /where not f\.hr and \(\(c\.mode = 'PRESS' and f\.press\) or c\.mode = 'ANY'\)/, 'nothing HR recorded on is ever in the removed set, in either mode');
});

test('the rule: PRESS (as sent) removes only repeats saved within 30 minutes of the case that stays; ANY every repeat; COUNT nothing; any other word nothing', () => {
  const w = squash(CODE);
  assert.match(w, /abs\(extract\(epoch from \(r\.at - r\.keep_at\)\)\) <= 1800 as press/);
  assert.match(w, /from ranked r where r\.rn > 1/, 'the case that stays is never one of the repeats');
  assert.equal((CODE.match(/'PRESS'::text as mode/g) || []).length, 1, 'the word is typed once, and PRESS is what is sent');
  const lines = FILE.split('\n');
  const at = lines.findIndex(l => /'PRESS'::text as mode/.test(l));
  assert.match(lines[at - 1], /^-- CHANGE:/, 'the line above it says it is the one to change');
  assert.match(FILE, /NOTHING DONE: the word on the CHANGE line must be PRESS, ANY or COUNT/);
  assert.match(w, /when c\.mode = 'COUNT' then 'COUNTED: nothing was changed' when c\.mode in \('PRESS', 'ANY'\) then 'DONE'/);
});

test('the copy is the WHOLE line as jsonb, and the undo reads it back with the table\'s own type, under the same label, and never fails on a line that is already back', () => {
  assert.match(squash(CODE), /select 'REPEATED DEDUCTION CASES 25 NOV \(SQL\)', x\.keep_ck, to_jsonb\(d\) from doomed x join public\.pmo_deductions d on coalesce\(d\.case_id, d\.id::text\) = x\.ck returning kept_case \)/);
  assert.equal((FILE.match(new RegExp(LABEL.replace(/[()]/g, '\\$&'), 'g')) || []).length, 2, 'the label is written in the copy and in the undo, and nowhere else');
  const undo = FILE.split('\n').filter(l => /^-- insert into/.test(l));
  assert.equal(undo.length, 1);
  assert.match(undo[0], /^-- insert into public\.pmo_deductions select \(jsonb_populate_record\(null::public\.pmo_deductions, x\.line\)\)\.\* from public\.pmo_deductions_removed x where x\.label = 'REPEATED DEDUCTION CASES 25 NOV \(SQL\)' on conflict do nothing;$/);
  assert.match(FILE, /^-- UNDO: /m);
});

test('the answer is one row of ten columns the check models: what PRESS and ANY would remove, what HR\'s recording kept, what was removed and what is left', () => {
  const sel = squash(CODE.slice(CODE.lastIndexOf('select c.mode')));
  const cols = [...sel.matchAll(/\bas ([a-z_]+)\b/g)].map(m => m[1]);
  assert.deepEqual(cols, ['result', 'cases', 'repeat_cases', 'press_removes', 'any_removes', 'kept_because_hr_recorded', 'cases_removed', 'lines_removed', 'lines_left']);
});

test('the kept check is the real one: a PostgreSQL made from the whole schema, a model, the undo, cut texts, the big book, and a break for each line of the rule', () => {
  assert.match(CHECK, /psqlTo\(fs\.readFileSync\(ROOT \+ '\/db\/schema\.sql', 'utf8'\), DB\)/, 'the book is the real schema');
  assert.match(CHECK, /const model = \(rows, mode\) =>/);
  assert.match(CHECK, /byte for byte/);
  assert.match(CHECK, /cut texts/);
  assert.match(CHECK, /90000 lines|BIG\.length \+ ' lines/);
  for (const break_ of ['the reporter is not compared', 'the team is not compared', 'the customer is not compared', 'the REF NO is not compared', 'the accused staff is not compared',
    'the amount taken is not compared', 'the two dates are not compared', 'the decision is not compared', 'the deduction is not compared', 'the amount to pay is not compared',
    'a case HR recorded on can be removed', 'the double-press window is two days', 'COUNT removes like ANY', 'no copy is taken', 'every line of the book is deleted (no join)',
    'HR is recognised by hr_at alone', 'the LAST saved case stays instead of the first']) {
    assert.ok(CHECK.includes("'" + break_ + "'"), 'the check breaks the file on purpose: ' + break_);
  }
  // every break names text the file holds exactly once (the check itself refuses one that is not found once: BAD BREAK)
  const breaks = [...CHECK.matchAll(/^  \['[^\n]+', (.+), (.+)\],$/gm)];
  assert.ok(breaks.length >= 39, 'at least 39 deliberate breaks (' + breaks.length + ')');
});
