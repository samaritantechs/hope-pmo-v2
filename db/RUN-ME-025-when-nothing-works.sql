-- =====================================================================================
-- RUN-ME-025 -- WHEN NOTHING WORKS.  TRIAGE, IN ORDER.  READ-ONLY UNTIL SECTION 8.
--
--   "Am receining a load of field calls the callapp aint working fine"
--   "even uploading aint working so check everything"
--   [Supabase: STATUS Unhealthy - CPU 33% - Disk 73% - RAM 83% - 35/90 conns]
--
-- UPLOADING AND THE CALL APP ARE DOWN AT THE SAME TIME. That is not a screen with a bad
-- query in it; those two share almost no code. What they share is the database, and the
-- database is reporting itself Unhealthy. So this file does not look at any report. It asks
-- the six questions that separate "the machine is out of room" from "something is holding a
-- lock" from "something is leaking connections" -- which need three completely different
-- answers, and guessing between them wastes a morning.
--
-- WHAT I ALREADY RULED OUT, so you do not have to wonder:
--   api/upload.js, api/call.js, importers.js and snapshot-totals.js have NOT BEEN TOUCHED by
--   anything deployed in the last two days (#380, #381, #382, #383). The diff over those
--   files is empty. The one shared file that changed is api/_lib/supabase.js, and that change
--   is behaviour-identical for every table except the two deck-totals ones. Upload's own code
--   is exactly what it was on the day it last worked.
--
-- RUN SECTIONS 1-7 AND SEND ME WHAT THEY SAY. Nothing here locks a table, blocks an upload,
-- or interrupts the call app. Section 8 is the short list of things worth doing, and it does
-- nothing unless you uncomment it.
-- =====================================================================================
set statement_timeout = '120s';


-- 1. WHAT IS RUNNING RIGHT NOW, OLDEST FIRST.  ** START HERE. **
--    If uploading and the phone are both stuck, something is very likely sitting in this list
--    and has been for minutes. Read three columns: `waiting_on` (blank = it is working, a
--    value = it is BLOCKED), `ran_for`, and the query itself.
--      Nothing older than a few seconds     -> the database is keeping up; go to section 2.
--      One old query, everything else short -> that one query is the problem; section 8a.
--      Many blocked on one blocker          -> a lock. Section 3 names the blocker.
select pid,
       state,
       now() - query_start                      as ran_for,
       now() - state_change                     as in_this_state,
       wait_event_type || ':' || wait_event     as waiting_on,
       left(regexp_replace(query, '\s+', ' ', 'g'), 120) as query
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
  and state <> 'idle'
order by query_start nulls last
limit 30;


-- 2. CONNECTIONS, BY STATE. 35 of 90 is not full, but WHICH 35 matters enormously.
--    idle                     fine. A pooled connection waiting for work.
--    idle in transaction      NOT fine in any number. Something opened a transaction and
--                             walked away; it holds its locks and pins the oldest snapshot,
--                             which stops vacuum cleaning ANYTHING newer. A handful of these
--                             will take a small instance down on their own.
--    active                   working. Many active at once on a throttled CPU is a queue.
select state,
       count(*)                        as conns,
       max(now() - state_change)       as oldest_in_state
from pg_stat_activity
where datname = current_database()
group by state
order by conns desc;


-- 3. IS ANYTHING BLOCKED, AND BY WHOM. Empty is the answer you want.
--    A row here means the `blocked` query cannot proceed until `blocker` finishes or is
--    cancelled. On this book the usual cause is an upload writing while something long-running
--    reads the same table.
select b.pid                                     as blocked,
       left(regexp_replace(b.query, '\s+', ' ', 'g'), 80)  as blocked_query,
       now() - b.query_start                     as blocked_for,
       a.pid                                     as blocker,
       left(regexp_replace(a.query, '\s+', ' ', 'g'), 80)  as blocker_query,
       a.state                                   as blocker_state
from pg_stat_activity b
join lateral unnest(pg_blocking_pids(b.pid)) as bp(pid) on true
join pg_stat_activity a on a.pid = bp.pid
where b.datname = current_database();


-- 4. IS IT THE CPU, STILL? The same arithmetic as RUN-ME-024 section 1, with no table behind
--    it at all. This is the control: if pure addition is slow, nothing about any query is the
--    problem and no query I write will fix it.
--      under 1,000 ms   the instance is healthy; the fault is in sections 1-3.
--      over 5,000 ms    the machine is throttled and everything else here is a symptom.
explain (analyze, timing)
select sum(i), count(*) from generate_series(1, 3000000) i;


-- 5. IS IT MEMORY? RAM at 83% is what the dashboard shows; this is what it MEANS.
--    `cache_hit_pct` is the share of reads served from memory instead of disk. Above 99% is
--    healthy on a book this size. Below ~95% means the working set no longer fits in RAM, and
--    every read that misses goes to disk -- which on a small instance is exactly what "slow
--    everywhere, all at once" feels like from the outside.
select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) as cache_hit_pct,
       sum(blks_read)                          as disk_reads,
       sum(blks_hit)                           as memory_reads,
       sum(xact_rollback)                      as rollbacks,
       sum(deadlocks)                          as deadlocks,
       pg_size_pretty(pg_database_size(current_database())) as db_size
from pg_stat_database
where datname = current_database();


-- 6. IS IT DISK? 73% used is the dashboard's figure for the volume. This says where it went.
--    A table far larger than its live rows deserve is bloat -- see RUN-ME-024 section 7b for
--    why autovacuum was never reaching these.
select relname                                        as table_name,
       pg_size_pretty(pg_total_relation_size(relid))   as total,
       pg_size_pretty(pg_relation_size(relid))         as heap,
       pg_size_pretty(pg_indexes_size(relid))          as indexes,
       n_live_tup                                      as live_rows,
       n_dead_tup                                      as dead_rows,
       last_autovacuum
from pg_stat_user_tables
where schemaname = 'public'
order by pg_total_relation_size(relid) desc
limit 12;


-- 7. THE TWO WRITES THAT MUST NEVER FAIL, TIMED. These are the exact shapes /api/upload and
--    /api/call put on the database. If sections 1-6 look fine and these are slow, the fault
--    is narrower than the machine and I want to see these plans.
explain (analyze, buffers, timing)
select count(*) from public.repayment_snapshots where snapshot_date = current_date;

explain (analyze, buffers, timing)
select count(*) from public.defaulter_snapshots where snapshot_date = current_date;

explain (analyze, buffers, timing)
select ref from public.followup_status
where status is not null or arrears is not null
limit 1000;


-- =====================================================================================
-- 8. THE ACTIONS. NOTHING BELOW RUNS UNLESS YOU UNCOMMENT IT.
-- =====================================================================================

-- 8a. CANCEL ONE STUCK QUERY, by the pid section 1 or 3 named.
--     pg_cancel_backend asks it to stop and is the polite one -- ALWAYS TRY THIS FIRST.
--     pg_terminate_backend kills the connection outright; a write in flight is rolled back,
--     which is safe (nothing half-lands) but an upload in progress will report failure and
--     have to be re-run.
--     NEVER cancel a pid whose query is an INSERT into repayment_snapshots or
--     defaulter_snapshots unless you know that upload is being re-run: that is somebody's deck.
--
--   select pg_cancel_backend(<pid>);
--   select pg_terminate_backend(<pid>);

-- 8b. RELEASE EVERY CONNECTION LEFT IDLE INSIDE A TRANSACTION for more than five minutes.
--     If section 2 shows any of these, this is the highest-value line in the file: each one
--     holds locks and pins the oldest snapshot, so vacuum cannot clean anything newer than it
--     and the table grows under you. Nothing is lost -- a transaction idle for five minutes
--     has already been abandoned by whatever opened it.
--
--   select pg_terminate_backend(pid), now() - state_change as idle_for,
--          left(regexp_replace(query, '\s+', ' ', 'g'), 80) as last_query
--   from pg_stat_activity
--   where datname = current_database()
--     and state = 'idle in transaction'
--     and now() - state_change > interval '5 minutes';

-- 8c. AND THE ONE THAT IS NOT A QUERY.
--     If section 4 says five or ten seconds for arithmetic with nothing behind it, and
--     section 5 says the cache hit rate has fallen, then the working set no longer fits the
--     machine. 1.39 million rows in defaulter_snapshots, as many again in repayment_snapshots,
--     a year of comments, on a t3a.small.
--
--     No query I write changes that, and I am not going to keep trimming around the edge of it
--     while three hundred officers cannot work. The compute size is one setting in
--     Supabase -> Settings -> Compute and Disk, it takes a few minutes, and it is reversible.
--     Small -> Medium doubles the memory.
--
--     Do it in the EVENING, never during the morning collection round: the instance restarts.
-- =====================================================================================
