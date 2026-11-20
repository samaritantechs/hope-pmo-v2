/* THE RECORDER -- db/RUN-ME-081, 082 and 083, run for real on a PostgreSQL that has pg_cron.

     "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026

   The recorder runs on the owner's live book on their paste: pg_cron writes, every 5 seconds, the statements the app sent that have run longer than
   3 seconds, and every minute the failed-request counters, into two tables of a schema the API does not expose. It passes only when:
     1. THE SETUP runs whole as one text, makes three jobs with the schedules it says, and a second run is harmless (the same three jobs).
     2. WHAT IT RECORDS: statements built the way PostgREST builds them (a select, an insert, an rpc) that run past 3 seconds are recorded ONCE each, as
        one row kept up to date while the statement runs (samples 2 or more, the longest running_for), with their table or function named; a plain
        select, and a DO block with words typed in it, are NEVER recorded.
     3. THE HEALTH ROWS arrive, a minute apart.
     4. THE TWO READS (082 by the hour, 083 by statement shape) answer on what was recorded.
     5. THE NIGHTLY CLEANUP removes rows older than 14 days and keeps the rest.
     6. A SETUP IN A DATABASE THAT CANNOT SCHEDULE (pg_cron lives in one database only) fails and creates nothing; the undo removes everything.
     7. EVERY ONE of a list of deliberate breaks of the setup makes a check fail.

   It needs a server started with   shared_preload_libraries = 'pg_stat_statements,pg_cron'   cron.database_name = '<a database that exists>'
   cron.use_background_workers = on   and it uses that database. NEVER point it at the live book. Takes about five minutes (it waits for the clock).

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/recorder.mjs

   Exit code 0 = the recorder did what it says, and failed when broken; 2 = this server cannot run the check. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const F81 = fs.readFileSync(ROOT + '/db/RUN-ME-081-recorder-of-slow-statements-and-failures.sql', 'utf8');
const F82 = fs.readFileSync(ROOT + '/db/RUN-ME-082-recorder-failures-by-hour-read-only.sql', 'utf8');
const F83 = fs.readFileSync(ROOT + '/db/RUN-ME-083-recorder-slow-statements-read-only.sql', 'utf8');
const env = process.env;
const psql = (sql, db, tolerate) => {
  try { return execFileSync('psql', ['-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: sql, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { if (tolerate) return 'ERROR: ' + String(e.stderr || e.message).trim(); throw e; }
};
const rows = out => out.trim().split('\n').filter(Boolean).map(l => l.split('|'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { if (!ok) { failed++; console.log('FAIL  ' + what); } else console.log('ok    ' + what); };

let DB;
try { DB = psql('show cron.database_name', 'postgres').trim(); } catch (e) { console.log('cannot run: this server does not load pg_cron (see the top of this file)'); process.exit(2); }
try { psql('select 1', DB); } catch (e) { console.log('cannot run: the database named by cron.database_name (' + DB + ') does not exist'); process.exit(2); }
const OTHER = 'hope_recorder_other';
const JOBS = ['ops-health-sample', 'ops-slow-sample', 'ops-retention'];
const undo = () => psql(`select cron.unschedule(jobname) from cron.job where jobname in ('${JOBS.join("','")}'); drop schema if exists ops cascade;`, DB);
const BOOK = `create table if not exists public.t_x (a int); create table if not exists public.t_y (a int);
truncate public.t_x; insert into public.t_x values (1);                  -- the first statement sleeps only if there is a row to sleep for: the check must not depend on what an earlier run left behind
create or replace function public.some_fn() returns int language sql as 'select 1 from (select pg_sleep(14)) s';`;
const STATEMENTS = [
  'WITH pgrst_source AS (SELECT pg_sleep(14) FROM "public"."t_x") SELECT * FROM pgrst_source',
  'WITH pgrst_source AS (INSERT INTO "public"."t_y"(a) SELECT 1 FROM (SELECT pg_sleep(14)) s RETURNING 1) SELECT * FROM pgrst_source',
  'WITH pgrst_source AS (SELECT "pgrst_call".* FROM (SELECT 1 AS json_data) pgrst_payload, LATERAL "public"."some_fn"() pgrst_call) SELECT * FROM pgrst_source',
  'select pg_sleep(14)',
  'do $$ begin perform pg_sleep(14); /* SECRET NAME TYPED IN A DO BLOCK */ end $$',
];
const launch = () => { for (const q of STATEMENTS) spawn('psql', ['-X', '-q', '-d', DB, '-c', q], { env, detached: true, stdio: 'ignore' }).unref(); };
const slow = () => rows(psql('select coalesce(target, \'-\'), samples, round(extract(epoch from running_for))::int, query from ops.db_slow_samples order by target', DB));

try {
  undo(); psql(BOOK, DB);
  // 1. the setup
  psql(F81, DB);
  const jobs = rows(psql('select jobname, schedule from cron.job order by jobid', DB));
  check(JSON.stringify(jobs) === JSON.stringify([['ops-health-sample', '* * * * *'], ['ops-slow-sample', '5 seconds'], ['ops-retention', '17 3 * * *']]), 'the setup makes the three jobs with the schedules it says');
  const ids = psql('select string_agg(jobid::text, \',\' order by jobid) from cron.job', DB).trim();
  psql(F81, DB);
  check(psql('select string_agg(jobid::text, \',\' order by jobid) from cron.job', DB).trim() === ids, 'a second run of the setup is harmless: the same three jobs');
  // 2. what it records
  launch(); await sleep(21000);
  const s = slow();
  check(s.length === 3 && s.map(r => r[0]).join() === 'some_fn,t_x,t_y', 'exactly three runs are recorded, named by their function or table: ' + s.map(r => r[0]).join());
  check(s.every(r => Number(r[1]) >= 2 && Number(r[2]) >= 8), 'each is ONE row kept up to date while it runs (two samples or more, running 8 seconds or more)');
  check(!s.some(r => /SECRET|^select pg_sleep|^do /i.test(r[3])), 'a plain select and a DO block with words typed in it are never recorded');
  // 3. the health rows
  for (let i = 0; i < 30 && Number(psql('select count(*) from ops.db_health_samples', DB)) < 2; i++) await sleep(5000);
  const h = rows(psql('select at, xact_commit, connections from ops.db_health_samples order by at', DB));
  check(h.length >= 2 && h.every(r => Number(r[1]) > 0 && Number(r[2]) > 0), 'the health rows arrive: ' + h.length);
  // 4. the two reads
  const r82 = rows(psql(F82, DB)), r83 = rows(psql(F83, DB));
  check(r82.length >= 1 && Number(r82[0][8]) >= 1, 'RUN-ME-082 answers an hour with minutes recorded');
  check(r83.map(r => r[0]).sort().join() === 'some_fn,t_x,t_y' && r83.every(r => r[1] === '1' && r[2] === '1' && Number(r[3]) >= 8), 'RUN-ME-083 answers one row for each statement shape, one run each, past 7 seconds, the longest 8 seconds or more');
  // 5. the nightly cleanup
  psql(`insert into ops.db_health_samples select now() - interval '20 days', 1,1,1,1,1,1,1,1,1; insert into ops.db_health_samples select now() - interval '5 days', 1,1,1,1,1,1,1,1,1;
        insert into ops.db_slow_samples values (1, now() - interval '20 days', now() - interval '20 days', now() - interval '20 days', interval '9 seconds', 'active', null, null, 1, null, 'old', 'x');
        insert into ops.db_slow_samples values (2, now() - interval '5 days', now() - interval '5 days', now() - interval '5 days', interval '9 seconds', 'active', null, null, 1, null, 'recent', 'x');`, DB);
  const before = Number(psql('select count(*) from ops.db_slow_samples', DB));
  psql('select ' + "1" + ';', DB);
  const cmd = psql("select command from cron.job where jobname = 'ops-retention'", DB).trim();
  psql(cmd, DB);
  const left = rows(psql("select target from ops.db_slow_samples where target in ('old', 'recent') order by 1", DB)).map(r => r[0]).join();
  check(left === 'recent' && Number(psql('select count(*) from ops.db_slow_samples', DB)) === before - 1 && Number(psql("select count(*) from ops.db_health_samples where at < now() - interval '14 days'", DB)) === 0 && Number(psql("select count(*) from ops.db_health_samples where at < now() - interval '4 days'", DB)) >= 1, 'the nightly cleanup removes what is older than 14 days and keeps the rest');
  // 6. a database that cannot schedule; the undo
  psql('drop database if exists ' + OTHER, 'postgres'); psql('create database ' + OTHER, 'postgres');
  const bad = psql(F81, OTHER, true);
  check(/^ERROR:/.test(bad) && psql("select count(*) from pg_namespace where nspname = 'ops'", OTHER).trim() === '0', 'a setup in a database that cannot schedule fails and creates nothing');
  psql('drop database ' + OTHER, 'postgres');
  undo();
  check(psql(`select count(*) from cron.job where jobname in ('${JOBS.join("','")}')`, DB).trim() === '0' && psql("select count(*) from pg_namespace where nspname = 'ops'", DB).trim() === '0', 'the undo removes the three jobs and the schema');
  // 7. breaks
  const BREAKS = [
    ['the filter that records only what the app sent is gone', F81.replace(" and a.query ~* '^\\s*with pgrst_source as'", ''), s2 => s2.some(r => /^select pg_sleep|^do /i.test(r[3]))],
    ['three seconds become sixty', F81.replace("interval '3 seconds'", "interval '60 seconds'"), s2 => s2.length === 0],
    ['the table is not named', F81.replace(`'FROM "public"\\."([a-z_0-9]+)"'`, `'FROM "pubXic"\\."([a-z_0-9]+)"'`), s2 => s2.some(r => r[0] === '?')],
    ['a run is no longer kept up to date', F81.replace(/ on conflict \(pid, query_start\) do update set [^$]*samples = t\.samples \+ 1/, ' on conflict (pid, query_start) do nothing'), s2 => s2.every(r => Number(r[1]) < 2)],
  ];
  for (const [name, text, caught] of BREAKS) {
    if (text === F81) { failed++; console.log('FAIL  the break "' + name + '" did not change the file'); continue; }
    undo(); psql(text, DB); launch(); await sleep(21000);
    check(caught(slow()), 'a deliberate break is caught: ' + name);
  }
  undo(); psql(F81, DB);
  const RET = F81.replace("interval '14 days'; delete from ops.db_slow_samples where first_seen < now() - interval '14 days'", "interval '1 minute'; delete from ops.db_slow_samples where first_seen < now() - interval '1 minute'");
  if (RET === F81) { failed++; console.log('FAIL  the retention break did not change the file'); }
  else {
    undo(); psql(RET, DB);
    psql(`insert into ops.db_health_samples select now() - interval '5 days', 1,1,1,1,1,1,1,1,1;`, DB);
    psql(psql("select command from cron.job where jobname = 'ops-retention'", DB).trim(), DB);
    check(Number(psql("select count(*) from ops.db_health_samples where at < now() - interval '4 days'", DB)) === 0, 'a deliberate break is caught: a cleanup that keeps one minute instead of fourteen days');
  }
} finally {
  try { undo(); } catch (e) { /* nothing to undo */ }
  try { psql('drop function if exists public.some_fn(); drop table if exists public.t_x, public.t_y;', DB); } catch (e) { /* nothing */ }
  try { psql('drop database if exists ' + OTHER, 'postgres'); } catch (e) { /* nothing */ }
}
console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nall checks passed');
process.exit(failed ? 1 : 0);
