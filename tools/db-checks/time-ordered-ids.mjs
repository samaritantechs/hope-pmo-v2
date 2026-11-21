/* THE TIME-ORDERED ID OF THE DECK TABLE -- db/RUN-ME-085, run for real on a PostgreSQL.

     "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026

   db/RUN-ME-085 gives the new rows of defaulter_snapshots (the table /api/upload writes) a time-ordered id (UUID version 7) instead of a random one, so that the rows
   of an upload land at one moving edge of the primary key's index. It is pasted by hand into the live book's SQL editor and runs as ONE transaction there. It passes only when:
     1. THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database, with rows already in the table (their ids are random and must come out of this untouched), and a plain
        role standing for the API's own (the default is evaluated with ITS rights), from which PUBLIC's right to run new functions has been taken away, as a locked-down book may have it.
     2. THE FILE RUNS as one transaction (psql -1, as the editor does) and answers ONE row: the new default, hope_uuid_time_ordered() (the catalogue prints it without the schema).
     3. THE ID IS A VERSION 7 UUID: version nibble 7, variant 8 to b, a millisecond clock first (within seconds of now), never going backwards across 20,000 ids made in one statement and
        across statements, and 200,000 of them are all different.
     4. NEW ROWS GET IT, the way PostgREST writes them (an insert that names its columns, from json_populate_recordset, run AS the plain role): the ids are version 7, 5,000 rows at once
        do not collide, and they sit together in key space (1,000 consecutive ids share their first sixteen bits; random ones share almost nothing). EXISTING ROWS KEEP THEIR IDS: the same
        ids before and after, byte for byte, and nothing else of the table, its indexes or its constraints changed.
     5. IT NEVER WAITS LONG: with a reader holding the table (an open transaction that has read it) the file gives up inside two seconds with "lock timeout", and then CHANGES NOTHING: the
        function does not exist and the default is the old one.
     6. IT CAN BE RUN AGAIN and the undo line restores gen_random_uuid().
     7. EVERY ONE of a list of deliberate breaks of the file makes a check fail.
   What it does NOT show is the saving in page reads: that needs a cold cache and a book bigger than memory, and is measured by tools/db-checks/upload-index-cost/ (by hand, on a cluster of its own).

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/time-ordered-ids.mjs

   It makes, uses and drops its own scratch database and its role. NEVER point it at the live book. Exit code 0 = the file did what it says. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rd = p => fs.readFileSync(ROOT + '/' + p, 'utf8');
const FILE = rd('db/RUN-ME-085-time-ordered-ids-for-the-deck-table.sql');
const DB = 'hope_tsid';
const env = process.env;
const run = (sql, db, one = false) => execFileSync('psql', ['-X', '-q', '-At', '-F', ' | ', '-v', 'ON_ERROR_STOP=1', ...(one ? ['-1'] : []), '-d', db, '-f', '-'], { input: sql, env, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['pipe', 'pipe', 'pipe'] });
let failed = 0;
const check = (ok, what) => { if (!ok) { failed++; console.log('FAIL  ' + what); } else console.log('ok    ' + what); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tryRun = (sql, db, one = true) => { try { return { out: run(sql, db, one) }; } catch (e) { return { err: String(e.stderr || e.message) }; } };
const had = run("select count(*) from pg_roles where rolname = 'hope_app'", 'postgres').trim() === '1';

run('drop database if exists ' + DB, 'postgres'); run('create database ' + DB, 'postgres');
if (!had) run('create role hope_app nologin', 'postgres');
try {
  run(rd('db/schema.sql'), DB);
  // a locked-down book: new functions are NOT runnable by everybody unless the file says so (a GLOBAL default: a schema's own default privileges can only add to the system's, never take PUBLIC's right away)
  run(`alter default privileges revoke execute on functions from public;
revoke all on schema public from hope_app; grant usage on schema public to hope_app;
grant select, insert on public.defaulter_snapshots to hope_app;
insert into teams(team) values ('T1') on conflict do nothing;
insert into defaulter_snapshots (ref, team, snapshot_type, snapshot_date) select (4000000000 + g)::text, 'T1', case when g % 2 = 0 then 'initial' else 'current' end, date '2026-11-20' from generate_series(1, 3000) g;`, DB);
  const snapshot = () => run(`select (select md5(string_agg(id::text || ref || snapshot_type, ',' order by ref, snapshot_type)) from public.defaulter_snapshots) || ' ' || (select count(*) from pg_index where indrelid = 'public.defaulter_snapshots'::regclass) || ' ' || (select count(*) from pg_constraint where conrelid = 'public.defaulter_snapshots'::regclass) || ' ' || (select count(*) from pg_attribute where attrelid = 'public.defaulter_snapshots'::regclass and attnum > 0 and not attisdropped)`, DB).trim();
  const defaultOf = () => run("select coalesce(column_default, 'none') from information_schema.columns where table_schema = 'public' and table_name = 'defaulter_snapshots' and column_name = 'id'", DB).trim();
  const before = snapshot();
  check(defaultOf() === 'gen_random_uuid()', 'the book starts as the real schema has it: id defaults to gen_random_uuid()');
  // 5. never waits long, and changes nothing when it gives up (BEFORE the file has run once)
  const holdThenRun = async text => {
    const holder = spawn('psql', ['-X', '-q', '-At', '-d', DB], { env, stdio: ['pipe', 'ignore', 'ignore'] });
    holder.stdin.end('begin; select count(*) from public.defaulter_snapshots; select pg_sleep(6); rollback;');
    await sleep(1200);                                                          // the reader has its lock
    const t0 = Date.now(); const r = tryRun(text, DB); const secs = (Date.now() - t0) / 1000;
    holder.kill('SIGKILL');
    run("select pg_terminate_backend(pid) from pg_stat_activity where datname = '" + DB + "' and pid <> pg_backend_pid() and query like '%pg_sleep%'", 'postgres');   // the server side of the reader goes on sleeping, lock and all, until it is told to stop
    await sleep(500);
    return { ...r, secs };
  };
  const held = await holdThenRun(FILE);
  check(!!held.err && /lock timeout/i.test(held.err) && held.secs < 2.5, 'with a reader holding the table the file gives up with "lock timeout" inside two seconds: ' + (held.err ? held.secs.toFixed(1) + ' s' : 'it did not fail'));
  check(run("select count(*) from pg_proc where proname = 'hope_uuid_time_ordered'", DB).trim() === '0' && defaultOf() === 'gen_random_uuid()', 'and then CHANGES NOTHING: no function, the old default');
  check(snapshot() === before, 'and the table is as it was');
  // 2. the file runs as one transaction, and answers one row
  const first = tryRun(FILE, DB);
  check(!first.err && first.out.trim() === 'hope_uuid_time_ordered()', 'run as one transaction it answers one row, the new default: ' + (first.err ? first.err.slice(0, 120) : first.out.trim()));
  check(defaultOf() === 'hope_uuid_time_ordered()', 'and the catalogue says so');
  // 3. the id
  const ids = run(`with g as materialized (select n, public.hope_uuid_time_ordered() as id from generate_series(1, 20000) n) select
    count(*) filter (where substr(id::text, 15, 1) <> '7') || ' ' || count(*) filter (where substr(id::text, 20, 1) not in ('8', '9', 'a', 'b')) || ' ' ||
    count(*) filter (where abs(extract(epoch from now()) * 1000 - ('x' || lpad(substr(id::text, 1, 8) || substr(id::text, 10, 4), 16, '0'))::bit(64)::bigint) > 10000) || ' ' ||
    (select count(*) from (select substr(id::text, 1, 8) || substr(id::text, 10, 4) as ts, lag(substr(id::text, 1, 8) || substr(id::text, 10, 4)) over (order by n) as prev from g) x where ts < prev) || ' ' || count(distinct id)
    from g`, DB).trim().split(' ').map(Number);
  check(ids[0] === 0, 'every id has version nibble 7 (' + ids[0] + ' that do not)');
  check(ids[1] === 0, 'and variant 8 to b (' + ids[1] + ' that do not)');
  check(ids[2] === 0, 'and a millisecond clock within ten seconds of now (' + ids[2] + ' that are not)');
  check(ids[3] === 0, 'and the clock never goes backwards across 20,000 ids made in one statement (' + ids[3] + ' steps back)');
  check(ids[4] === 20000, 'and all 20,000 are different');
  const many = run("select count(distinct public.hope_uuid_time_ordered()) from generate_series(1, 200000)", DB).trim();
  check(many === '200000', '200,000 ids are 200,000 different ids: ' + many);
  const a = run('select public.hope_uuid_time_ordered()', DB).trim(); await sleep(15); const b = run('select public.hope_uuid_time_ordered()', DB).trim();
  check(a.slice(0, 13).replace('-', '') < b.slice(0, 13).replace('-', '') || a.slice(0, 13) === b.slice(0, 13), 'and across statements, a later id has a later or equal clock: ' + a.slice(0, 13) + ' then ' + b.slice(0, 13));
  // 4. new rows get it, the way PostgREST writes them, as the plain role
  const rowsJson = JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ ref: '5' + String(i).padStart(9, '0'), team: 'T1', snapshot_type: 'current', snapshot_date: '2026-11-21' })));
  const ins = tryRun(`set role hope_app;\ninsert into public.defaulter_snapshots (ref, team, snapshot_type, snapshot_date) select ref, team, snapshot_type, snapshot_date from json_populate_recordset(null::public.defaulter_snapshots, '${rowsJson}');`, DB, false);
  check(!ins.err, 'the API role (no right to run functions but the one the file granted) writes 5,000 rows by default: ' + (ins.err || '').slice(0, 150));
  const newRows = run("select count(*) || ' ' || count(*) filter (where substr(id::text, 15, 1) = '7') || ' ' || count(distinct id) from public.defaulter_snapshots where ref like '5%'", DB).trim();
  check(newRows === '5000 5000 5000', 'all 5,000 are version 7 and all different: ' + newRows);
  const cluster = run(`select (select count(distinct substr(id::text, 1, 4)) from (select id from public.defaulter_snapshots where ref like '5%' order by ctid limit 1000) a) || ' ' || (select count(distinct substr(id::text, 1, 4)) from (select id from public.defaulter_snapshots where ref not like '5%' order by ctid limit 1000) b)`, DB).trim().split(' ').map(Number);
  check(cluster[0] <= 2, 'they sit together in key space: 1,000 consecutive new ids share their first sixteen bits (' + cluster[0] + ' distinct)');
  check(cluster[1] >= 800, 'while the old random ones do not (' + cluster[1] + ' distinct of 1,000): the check can tell them apart');
  const after = run(`select (select md5(string_agg(id::text || ref || snapshot_type, ',' order by ref, snapshot_type)) from public.defaulter_snapshots where ref not like '5%') || ' ' || (select count(*) from pg_index where indrelid = 'public.defaulter_snapshots'::regclass) || ' ' || (select count(*) from pg_constraint where conrelid = 'public.defaulter_snapshots'::regclass) || ' ' || (select count(*) from pg_attribute where attrelid = 'public.defaulter_snapshots'::regclass and attnum > 0 and not attisdropped)`, DB).trim();
  check(after === before, 'the 3,000 old rows keep their ids byte for byte, and the table has the same indexes, constraints and columns: ' + after.slice(0, 40) + '...');
  // 6. again, and the undo
  const second = tryRun(FILE, DB);
  check(!second.err && second.out.trim() === 'hope_uuid_time_ordered()', 'run again, it is harmless and answers the same');
  run('alter table public.defaulter_snapshots alter column id set default gen_random_uuid();', DB);
  check(defaultOf() === 'gen_random_uuid()', 'the undo line puts gen_random_uuid() back');
  // 7. breaks: each against a fresh copy of the pre-file state
  const reset = () => run('alter table public.defaulter_snapshots alter column id set default gen_random_uuid(); alter table public.repayment_snapshots alter column id set default gen_random_uuid(); drop function if exists public.hope_uuid_time_ordered(); delete from public.defaulter_snapshots where ref not like \'4%\'', DB);
  const verdict = async (text) => {
    reset();
    const r = tryRun(text, DB);
    if (r.err) return 'the file fails: ' + r.err.slice(0, 80);
    if (r.out.trim() !== 'hope_uuid_time_ordered()') return 'the answer is ' + JSON.stringify(r.out.trim()).slice(0, 60);
    if (defaultOf() !== 'hope_uuid_time_ordered()') return 'the default of the deck table is ' + defaultOf();
    const vr = tryRun("select count(*) filter (where substr(public.hope_uuid_time_ordered()::text, 15, 1) <> '7') || ' ' || count(distinct public.hope_uuid_time_ordered()) || ' ' || count(distinct substr(public.hope_uuid_time_ordered()::text, 1, 4)) from generate_series(1, 2000)", DB, false);
    if (vr.err) return 'the function fails: ' + vr.err.slice(0, 80);
    const v = vr.out.trim().split(' ').map(Number);
    if (v[0] !== 0) return 'the version is wrong';
    if (v[1] !== 2000) return 'ids collide';
    if (v[2] > 2) return 'the clock is not first';
    const w = tryRun(`set role hope_app;\ninsert into public.defaulter_snapshots (ref, team, snapshot_type, snapshot_date) select (6000000000 + g)::text, 'T1', 'current', date '2026-11-21' from generate_series(1, 3000) g;`, DB, false);
    if (w.err) return 'the API role cannot write: ' + w.err.slice(0, 80);
    const c = run("select count(distinct id) from public.defaulter_snapshots where ref like '6%'", DB).trim();
    if (c !== '3000') return 'a multi-row insert collides';
    return null;
  };
  const lockedDown = (() => { reset(); run('create or replace function public.hope_uuid_time_ordered() returns uuid language sql volatile as $$ select gen_random_uuid() $$; alter table public.defaulter_snapshots alter column id set default public.hope_uuid_time_ordered();', DB); const w = tryRun("set role hope_app;\ninsert into public.defaulter_snapshots (ref, team, snapshot_type, snapshot_date) values ('7000000001', 'T1', 'current', date '2026-11-21');", DB, false); return w.err || ''; })();
  check(/permission denied for function hope_uuid_time_ordered/.test(lockedDown), 'the fixture IS locked down: a function made without the explicit grant cannot be run by the API role (' + lockedDown.trim().split('\n')[0].slice(0, 80) + ')');
  check(await verdict(FILE) === null, 'the file as written passes every one of those tests on a fresh book (the yardstick of the breaks)');
  const BREAKS = [
    ['the default never switched', FILE.replace(/alter table public\.defaulter_snapshots alter column id set default public\.hope_uuid_time_ordered\(\);\n/, '')],
    ['the wrong table switched', FILE.replace(/^alter table public\.defaulter_snapshots alter column/m, 'alter table public.repayment_snapshots alter column')],       // the statement, not the undo line in the comment above it
    ['the version bits not set', FILE.replace(', 52, 1), 53, 1)', ', 53, 1)').replace('set_bit(set_bit(', 'set_bit(')],
    ['the clock left out (a random id again)', FILE.replace(/overlay\(uuid_send\(gen_random_uuid\(\)\) placing substring\(int8send\(floor\(extract\(epoch from clock_timestamp\(\)\) \* 1000\)::bigint\) from 3\) from 1 for 6\)/, 'uuid_send(gen_random_uuid())')],
    // (the clock read once for a statement, statement_timestamp() for clock_timestamp(), is NOT a break: every row of a chunk then shares one millisecond and sits even closer together)
    ['the function declared immutable (one id for the whole insert)', FILE.replace('language sql volatile', 'language sql immutable')],
    ['the explicit grant taken out (the API role cannot run it)', FILE.replace('grant execute on function public.hope_uuid_time_ordered() to public;\n', '')],
    ['the answer left out', FILE.replace(/select column_default as id_default_now[^\n]*\n/, '')],
    ['the first six bytes taken from the wrong place', FILE.replace('from 3) from 1 for 6)', 'from 1) from 1 for 6)')],
  ];
  for (const [name, text] of BREAKS) {
    if (text === FILE) { failed++; console.log('FAIL  the break "' + name + '" did not change the file'); continue; }
    const v = await verdict(text);
    check(v !== null, 'a deliberate break is caught: ' + name + (v ? ' (' + v + ')' : ''));
  }
  // the one break that is about time: no lock_timeout, so the reader makes it wait
  reset();
  const noTimeout = await holdThenRun(FILE.replace("set local lock_timeout = '500ms';\n", ''));
  check(noTimeout.secs > 3, 'a deliberate break is caught: no lock_timeout (it waited ' + noTimeout.secs.toFixed(1) + ' s behind the reader)');
  reset();
} finally {
  run('drop database if exists ' + DB, 'postgres');
  if (!had) run('drop role if exists hope_app', 'postgres');
}
console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nall checks passed');
process.exit(failed ? 1 : 0);
