/* EVERY COLUMN THE CODE ASKS FOR MUST EXIST.
 *
 * The bell asked complaints for `created_by`. That table records who logged a complaint as
 * `logged_by` -- the comment log is the one that uses `created_by`, and the two simply name it
 * differently. PostgREST does not return the other columns and skip the unknown one: it fails
 * the WHOLE read. So the bell said "could not load" and no amount of looking at the bell
 * explained why.
 *
 * A test can know this. The schema is in the repository and so is every select, so the two are
 * compared here and the mistake becomes a red `npm test` instead of a message on a phone in
 * the field.
 *
 * IT ONLY CHECKS WHAT IT CAN SEE. A table with no CREATE TABLE in this repository is skipped
 * rather than guessed at, and `select('*')` is nothing to check.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every column the database actually has, from schema.sql plus every migration. */
function schemaColumns() {
  const cols = {};
  const files = [fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8')]
    .concat(fs.readdirSync(path.join(ROOT, 'db/migrations')).sort()
      .map(f => fs.readFileSync(path.join(ROOT, 'db/migrations', f), 'utf8')));
  const sql = files.join('\n');

  /* CREATE TABLE. Several columns share a line -- "ref text, team text," -- so each line is
     split on commas rather than read as one column, which is exactly the shortcut that made an
     earlier version of this report seven false alarms. */
  for (const m of sql.matchAll(/create table if not exists (?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    const set = cols[m[1]] = cols[m[1]] || new Set();
    for (const line of m[2].split('\n')) {
      const bare = line.replace(/--.*$/, '').trim();
      if (!bare) continue;
      for (const part of bare.split(',')) {
        /* Column name, then its type -- and the type may be one this schema DEFINED, such as
           the loan_stage enum, so it cannot be a fixed list of built-ins. Anything that starts
           with a table constraint instead of a column is skipped. */
        const c = part.trim().match(/^([a-z_]+)\s+([a-z_]+)/i);
        if (!c) continue;
        if (/^(primary|foreign|unique|check|constraint|exclude|like)$/i.test(c[1])) continue;
        set.add(c[1]);
      }
    }
  }
  // ALTER TABLE ... ADD COLUMN, written plainly.
  for (const m of sql.matchAll(/alter table (?:public\.)?(\w+)\s+add column (?:if not exists )?(\w+)/gi)) {
    (cols[m[1]] = cols[m[1]] || new Set()).add(m[2]);
  }
  /* And the one migration that adds columns to a LIST of tables through a loop. Ignoring it
     reported upload_date as missing from every table that has it. */
  for (const m of sql.matchAll(/foreach\s+\w+\s+in\s+array\s+(?:ARRAY)?\s*\[([^\]]+)\][\s\S]*?loop([\s\S]*?)end loop/gi)) {
    const tables = [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
    const added = [...m[2].matchAll(/add column if not exists (\w+)/g)].map(x => x[1]);
    for (const t of tables) for (const c of added) (cols[t] = cols[t] || new Set()).add(c);
  }
  return cols;
}

/** Every `.from('table').select('a, b, c')` in the server code. */
function selects() {
  const out = [];
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d)) {
      const p = path.join(d, e);
      if (fs.statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p); }
      else if (e.endsWith('.js')) files.push(p);
    }
  })(path.join(ROOT, 'api'));

  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/from\(\s*'(\w+)'\s*\)\s*\n?\s*\.?\s*select\(\s*'([^']*)'/g)) {
      out.push({ file: path.relative(ROOT, f), table: m[1], list: m[2] });
    }
  }
  return out;
}

test('every column the server asks for exists in the schema', () => {
  const cols = schemaColumns();
  const missing = [];
  let checked = 0;

  for (const { file, table, list } of selects()) {
    if (!cols[table]) continue;                       // no CREATE TABLE here to check against
    if (list.trim() === '*' || list.includes('(')) continue;
    for (const raw of list.split(',')) {
      const c = raw.trim();
      if (!c) continue;
      checked++;
      if (!cols[table].has(c)) missing.push(`${table}.${c}  (${file})`);
    }
  }

  assert.ok(checked > 150, `only ${checked} column references found -- the scan is not working`);
  assert.deepEqual(missing, [],
    'These columns are asked for but do not exist. PostgREST fails the WHOLE read when one\n' +
    'column is unknown, so this is not a missing field -- it is a screen that does not load:\n  '
    + missing.join('\n  '));
});

test('the schema scan actually found the tables it needs to check', () => {
  /* A scan that silently stops finding tables would make the test above pass for ever while
     checking nothing. These are the tables the whole system is built on. */
  const cols = schemaColumns();
  for (const t of ['teams', 'access_codes', 'followup_status', 'followup_comments', 'complaints',
                   'repayment_snapshots', 'defaulter_snapshots', 'loans', 'call_logs', 'call_users']) {
    assert.ok(cols[t] && cols[t].size > 2, t + ' was not read from the schema');
  }
  // The specific pairs that caused trouble, so a rename cannot quietly undo the fix.
  assert.ok(cols.complaints.has('logged_by'), 'complaints records who logged it as logged_by');
  assert.equal(cols.complaints.has('created_by'), false, 'and NOT as created_by');
  assert.ok(cols.followup_comments.has('created_by'), 'the comment log does use created_by');
  // Columns added by migrations, including the looped one.
  assert.ok(cols.followup_status.has('deck_date'), 'a plainly written ALTER TABLE was read');
  assert.ok(cols.loans.has('upload_date'), 'and the migration that loops over a list of tables');
  assert.ok(cols.call_users.has('active'), 'and the officer-accounts migration');
});
