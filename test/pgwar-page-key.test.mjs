/* THE GAP THAT test/speed.test.mjs COULD NOT SEE.

   A table with no `id` column costs a doomed round trip on every single fetchAll() page,
   forever, until it is added to PAGE_KEY (api/_lib/supabase.js) with its real key -- see that
   map's own comment for the mechanism. `devices` and `imprest_roles` were found and fixed
   that way once (the map's own comment says so); what had not been checked was every OTHER
   table this codebase actually pages.

   test/fake-db.mjs is deliberately schema-agnostic (it knows a fixture's ROWS, never a table's
   true column set), so it has no way to fail an ORDER BY on a column that flatly does not
   exist -- that is a different question from a missing-migration check, which models a
   migration not yet run. Every trip-count test in this repo, including every ceiling in
   speed.test.mjs, is blind to this whole class of cost, the same blind spot this exact pattern
   found and fixed on hoop-pmo (that repo's own copy of this file, and its PAGE_KEY, both
   descend from this one).

   This file is the guard that replaces "wait for someone to paste a slow query": it reads the
   REAL schema straight from every `create table` this repo ships -- db/schema.sql,
   db/migrations/*.sql, every db/RUN-ME-*.sql at the db/ root (devices and imprest both arrived
   that way, outside db/migrations/, which is why that location is read too), AND
   db/hopeloan/*.sql (a separate Postgres schema, but paged through the identical schema-blind
   PAGE_KEY mechanism -- see realSchema()'s own comment below) -- and checks every table this
   codebase ever pages against it. A table is safe when either it has a genuine `id` column
   (PAGE_KEY's default needs no entry), or it is listed in PAGE_KEY under a column -- or tuple
   of columns -- that table genuinely has. Add a table with neither and this fails before
   `npm test` does, not after a query log does. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { PAGE_KEY } = await import('../api/_lib/supabase.js');

const ROOT = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, ROOT), 'utf8');

/** Every `create table` this repo ships to the live `public` schema, real column names only --
    comments and constraint lines (primary key / unique / check / foreign key / a bare `--`)
    dropped. Idempotent CREATE TABLE IF NOT EXISTS is safe to parse more than once: whichever
    file is read first for a given name wins, and later re-declarations (schema.sql vs. the
    RUN-ME that first shipped a table, e.g. imprest_roles) are ignored, same as Postgres would
    treat them.

    db/hopeloan/* is a SEPARATE Postgres schema (see db/hopeloan/WHERE-AM-I.sql and
    api/_lib/workspace.js), reached through its own client scoped to `db: { schema: 'hopeloan' }`
    -- but api/_lib/loan-core.js pages that client's tables (customers, assessments, loans, ...)
    through the exact same fetchAll()/PAGE_KEY mechanism as every `public` table, and PAGE_KEY
    itself is schema-blind (it keys purely off the table name in the URL -- see tableOf() in
    api/_lib/supabase.js), so a hopeloan table missing an `id` column pays the identical doomed
    round trip forever. It is read here for exactly that reason. RUN-ME-000b-clone-schema.sql
    clones every `public` table into `hopeloan` with `like ... including all` -- byte-identical
    columns -- so a name shared between the two schemas (teams, complaints, loans, ...) cannot
    disagree about its columns; only db/hopeloan/*.sql's OWN tables (customers, assessments,
    guarantors, loan_events, reversals, disbursement_windows, carriers, payment_imports,
    manual_adjustments, kyc_captures, assessment_plans) add anything new to check. */
function realSchema() {
  const dbRootSql = readdirSync(new URL('db', ROOT)).filter(f => f.endsWith('.sql')).map(f => 'db/' + f);
  const migrationSql = readdirSync(new URL('db/migrations', ROOT)).filter(f => f.endsWith('.sql'))
    .map(f => 'db/migrations/' + f);
  const hopeloanSql = readdirSync(new URL('db/hopeloan', ROOT)).filter(f => f.endsWith('.sql'))
    .map(f => 'db/hopeloan/' + f);
  const files = ['db/schema.sql', ...dbRootSql.filter(f => f !== 'db/schema.sql'), ...migrationSql, ...hopeloanSql];
  const tables = new Map();
  for (const f of files) {
    const sql = read(f);
    for (const m of sql.matchAll(/create table(?: if not exists)?\s+"?(\w+)"?\s*\(([\s\S]*?)\n\);/gi)) {
      const [, name, body] = m;
      if (tables.has(name)) continue;
      const cols = new Set();
      const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '');
      for (let line of stripped.split('\n')) {
        line = line.replace(/--.*$/, '').trim();
        if (!line || /^(primary key|unique|check|constraint|foreign key)\b/i.test(line)) continue;
        const col = line.split(/\s+/)[0].replace(/,$/, '').replace(/^"|"$/g, '');
        if (col) cols.add(col);
      }
      tables.set(name, cols);
    }
  }
  return tables;
}

/** Every table name this codebase ever calls `db.from('...')` on, anywhere under api/. A
    literal string only -- a table name built at runtime would not page-key correctly either,
    and there are none today (grepped by hand when this file was written). */
function tablesReferenced() {
  const files = readdirSync(new URL('api', ROOT)).filter(f => f.endsWith('.js')).map(f => 'api/' + f)
    .concat(readdirSync(new URL('api/_lib', ROOT)).filter(f => f.endsWith('.js')).map(f => 'api/_lib/' + f));
  const tables = new Set();
  for (const f of files) {
    for (const m of read(f).matchAll(/\.from\(['"]([a-z_]+)['"]\)/g)) tables.add(m[1]);
  }
  return tables;
}

test('every table this codebase pages either has a real id column, or PAGE_KEY names one it actually has', () => {
  const schema = realSchema();
  const referenced = tablesReferenced();
  const bad = [];
  for (const table of referenced) {
    const cols = schema.get(table);
    if (!cols) continue;   // not a table this schema creates (a view, or read via an rpc) -- out of scope here
    const keyed = Object.prototype.hasOwnProperty.call(PAGE_KEY, table) ? PAGE_KEY[table] : 'id';
    const keys = Array.isArray(keyed) ? keyed : [keyed];
    const missing = keys.filter(k => !cols.has(k));
    if (missing.length) {
      bad.push(`${table}: pages ordered by ${JSON.stringify(keyed)}, which ${missing.length > 1 ? 'columns' : 'a column'} `
        + `(${missing.join(', ')}) ${table} does not have (real columns: ${[...cols].join(', ')}) `
        + `-- add PAGE_KEY['${table}'] = '<the real key>' in api/_lib/supabase.js`);
    }
  }
  assert.deepEqual(bad, []);
});

test('every PAGE_KEY entry still names real column(s) of a real table', () => {
  const schema = realSchema();
  const bad = [];
  for (const [table, key] of Object.entries(PAGE_KEY)) {
    const cols = schema.get(table);
    if (!cols) continue;   // not a table this schema creates today -- nothing to check
    const keys = Array.isArray(key) ? key : [key];
    const missing = keys.filter(k => !cols.has(k));
    if (missing.length) bad.push(`PAGE_KEY['${table}'] = ${JSON.stringify(key)}, but ${table} has no column '${missing.join("', '")}'`);
  }
  assert.deepEqual(bad, []);
});
