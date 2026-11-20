/* HOW THE DATABASE IS DOING -- db/RUN-ME-079, run for real on a PostgreSQL.

     "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026

   The file reads Postgres's own counters and the catalogue and is pasted by hand into the SQL editor. It passes only when:
     1. IT RUNS WHOLE AS ONE TEXT and answers the rows the reading promises, in the order they are given: 'now' first, the database and memory
        lines, the failed-request count, the cache hit percent, the role limits (a role given a statement_timeout shows it), and the biggest
        tables by size, biggest first, no more than eight, each with a size and two percentages.
     2. THE COUNTERS MOVE THE WAY THEY SAY: a transaction that fails is a rollback more, a transaction that commits is a commit more.
     3. IT CHANGES NOTHING: the rows of a table of the scratch book and the number of objects in the catalogue are the same before and after.
     4. EVERY ONE of a list of deliberate breaks of the file changes the answer or makes it fail.

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/database-health.mjs

   It makes, uses and drops its own scratch database, and the two roles only if they were not there. NEVER point it at the live book. Exit code 0 = the file did what it says. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(ROOT + '/db/RUN-ME-079-database-health-read-only.sql', 'utf8');
const DB = 'hope_health';
const env = process.env;
const sh = (sql, db, args = []) => execFileSync('psql', ['-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-d', db, ...args, '-f', '-'], { input: sql, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
let failed = 0;
const check = (ok, what) => { if (!ok) { failed++; console.log('FAIL  ' + what); } else console.log('ok    ' + what); };
const rows = out => out.trim().split('\n').filter(Boolean).map(l => { const i = l.indexOf('|'); return [l.slice(0, i), l.slice(i + 1)]; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FILE80_BREAK_ = (text, a, b) => { if (!text.includes(a)) throw new Error('break text not found'); return text.replace(a, b); };

sh('drop database if exists ' + DB, 'postgres'); sh('create database ' + DB, 'postgres');
const had = sh("select rolname from pg_roles where rolname in ('authenticator', 'service_role')", 'postgres').trim().split('\n').filter(Boolean);   // a role another scratch book uses is left alone
sh(`do $$ begin
 if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator nologin; end if;
 if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
alter role authenticator set statement_timeout = '8s';`, 'postgres');
const book = `create table public.t_big as select g as id, md5(g::text) as v from generate_series(1, 60000) g;
create index on public.t_big (v);
create table public.t_mid as select g as id, md5(g::text) as v from generate_series(1, 20000) g;
${Array.from({ length: 10 }, (_, i) => `create table public.t_small_${i} as select g as id from generate_series(1, ${100 + i}) g;`).join('\n')}`;
try {
  sh(book, DB);
  const run = text => rows(sh(text, DB));
  const a = run(FILE);
  const labels = a.map(r => r[0]);
  check(labels[0] === 'now' && labels[1] === 'counting since' && labels[2] === 'database size', 'it starts with now, counting since, database size');
  check(['shared_buffers (about a quarter of the compute RAM)', 'effective_cache_size', 'max_connections', 'connections open now', 'statements running now (not this one)',
    'transactions committed', 'transactions rolled back (failed requests, mostly)', 'rolled back, percent of all', 'deadlocks'].every(l => labels.includes(l)), 'the database, memory and counter lines are all there');
  const val = l => (a.find(r => r[0] === l) || [])[1];
  const hit = Number(val('cache hit percent, whole database (well below 99 = reading the disk)'));
  check(hit >= 0 && hit <= 100, 'the cache hit percent is a percentage: ' + hit);
  check(/statement_timeout=8s/.test(val('role authenticator limits') || ''), 'a role with a statement_timeout shows it');
  check(val('role anon limits') === undefined || val('role anon limits') === 'none', 'a role with no limit says none');
  const tables = a.filter(r => r[0].startsWith('table '));
  check(tables.length === 8, 'the eight biggest tables and no more, of twelve: ' + tables.length);
  check(tables[0][0] === 'table t_big' && tables[1][0] === 'table t_mid', 'biggest first');
  check(tables.every(r => /^\d+ \w+ \| table pages from cache (\d+(\.\d)?%|n\/a) \| index pages from cache (\d+(\.\d)?%|n\/a)$/.test(r[1])), 'each has a size and two percentages');
  check(val('statements running now (not this one)') === '0', 'the statement that runs it is not counted as running');
  // 2. the counters move
  const rb0 = Number(val('transactions rolled back (failed requests, mostly)')), cm0 = Number(val('transactions committed'));
  try { sh('select 1/0', DB); } catch (e) { /* the point */ }
  sh('select 1', DB);
  await sleep(2500);
  const b = run(FILE), vb = l => (b.find(r => r[0] === l) || [])[1];
  check(Number(vb('transactions rolled back (failed requests, mostly)')) > rb0, 'a failed statement is a rollback more');
  check(Number(vb('transactions committed')) > cm0, 'a statement that committed is a commit more');
  // 3. it changes nothing
  const snap = () => sh(`select (select md5(string_agg(v, ',' order by id)) from public.t_mid) || ' ' || (select count(*) from pg_class) || ' ' || (select count(*) from pg_namespace) || ' ' || (select count(*) from pg_proc where pronamespace = 'public'::regnamespace)`, DB).trim();
  const before = snap(); run(FILE); run(FILE);
  check(snap() === before, 'the rows of a table and the objects in the catalogue are the same after two runs');
  // 3b. RUN-ME-080, when this server loads pg_stat_statements (a statement that spills must show with what it wrote to temp; a DO block must not show)
  const F80 = fs.readFileSync(ROOT + '/db/RUN-ME-080-statements-that-spill-read-only.sql', 'utf8');
  let haveStatements = true;
  try { sh('create extension if not exists pg_stat_statements', DB); sh('select pg_stat_statements_reset()', DB); } catch (e) { haveStatements = false; }
  if (!haveStatements) console.log('skip  RUN-ME-080: pg_stat_statements is not loaded on this server (shared_preload_libraries)');
  else {
    sh("set work_mem = '64kB'; select count(*) from (select * from public.t_big order by id desc limit 50000) x; do $$ begin perform 'SECRET NAME TYPED IN A DO BLOCK'; end $$;", DB);
    const c = run(F80);
    const spill = c.find(r => r[0] === 'writes to disk most');
    check(!!spill && /order by id desc limit \$1/.test(spill[1]), 'RUN-ME-080 names the statement that spilled, with its values as $1');
    check(!!spill && /^\d+ (kB|MB|GB)$/.test(spill[1].split('|')[4]), 'and what it wrote to temp: not nothing');
    check(!c.some(r => /SECRET NAME/.test(r[1])), 'a DO block (the owner\'s own script) is left out, whatever was typed in it');
    check(c.filter(r => r[0] === 'writes to disk most').length <= 10 && c.filter(r => r[0] === 'reads the disk most').length <= 10, 'ten rows at most in each ranking');
    check(JSON.stringify(run(FILE80_BREAK_(F80, "where temp_blks_written > 0 and query !~*", "where temp_blks_written > 0 and query ~*"))) !== JSON.stringify(c), 'a break that keeps ONLY the owner\'s scripts changes the answer');
  }
  // 4. breaks
  const BREAKS = [
    ['a view that does not exist', FILE.replace('pg_stat_database', 'pg_stat_databasee')],
    ['no limit on the tables', FILE.replace('limit 8', 'limit 80')],
    ['the statement itself counted as running', FILE.replace(" and pid <> pg_backend_pid()", '')],
    ['no table of the book', FILE.replace("where schemaname = 'public'", "where schemaname = 'nope'")],
    ['one role fewer', FILE.replace("'service_role', 'postgres'", "'service_role'")],
    ['the smallest tables first', FILE.replace('order by pg_total_relation_size(relid) desc', 'order by pg_total_relation_size(relid) asc')],
  ];
  const baseline = JSON.stringify(a.map(r => r[0]));
  for (const [name, text] of BREAKS) {
    if (text === FILE) { failed++; console.log('FAIL  the break "' + name + '" did not change the file'); continue; }
    let caught = false;
    try { const c = run(text); const lc = c.map(r => r[0]); caught = JSON.stringify(lc) !== baseline || c.find(r => r[0].startsWith('statements running'))[1] !== '0' || (c.find(r => r[0] === 'table t_big') === undefined) || c.filter(r => r[0].startsWith('table ')).length !== 8; } catch (e) { caught = true; }
    check(caught, 'a deliberate break is caught: ' + name);
  }
} finally {
  sh('drop database if exists ' + DB, 'postgres');
  for (const r of ['authenticator', 'service_role']) sh(had.includes(r) ? `alter role ${r} reset statement_timeout` : `drop role if exists ${r}`, 'postgres');
}
console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nall checks passed');
process.exit(failed ? 1 : 0);
