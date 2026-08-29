-- =====================================================================================
-- FIX NOW -- UNBLOCK THE DATABASE.
--
-- WHAT HAPPENED. RUN-ME-011 builds 41 indexes and runs ANALYZE, and the Supabase SQL
-- editor wraps a paste in ONE transaction. While that transaction is open it holds locks
-- on the big tables, so every upload and every write queues behind it; the queued
-- requests then use up the connection pool, and once the pool is gone even a tiny read
-- like signing in cannot get through -- which is the 504 you are seeing. My paste was too
-- big to run in one go on a live system. That is on me.
--
-- NOTHING IS LOST AND NOTHING IS CORRUPTED. An unfinished transaction rolls back cleanly;
-- your data is exactly as it was.
--
-- IF THIS SQL EDITOR ITSELF WILL NOT RUN (spins, times out), go instead to:
--     Supabase Dashboard -> Project Settings -> General -> Restart project
-- That clears every stuck session in about a minute and is completely safe. Then come
-- back and run STEP 1 to confirm it is clear.
-- =====================================================================================

-- ---------------------------------------------------------------- STEP 1: WHAT IS STUCK
-- Run this FIRST, on its own. Anything with a long "running" time, or a state of
-- 'idle in transaction', is what is holding the system down.
select pid,
       state,
       wait_event_type,
       wait_event,
       now() - xact_start           as transaction_open_for,
       now() - query_start          as query_running_for,
       left(regexp_replace(query, '\s+', ' ', 'g'), 90) as what_it_is_doing
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
  and state is distinct from 'idle'
order by xact_start nulls last;

-- ------------------------------------------------------- STEP 2: LET THE SYSTEM BREATHE
-- Terminates ONLY sessions that are stuck: an index build or ANALYZE still running after
-- two minutes, or a transaction left open and idle. It never touches ordinary app traffic
-- (those queries last milliseconds), and it never touches this session.
--
-- Terminating a half-finished index build simply rolls it back -- no data is affected.
select pg_terminate_backend(pid) as terminated,
       state,
       left(regexp_replace(query, '\s+', ' ', 'g'), 60) as was_doing
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
  and (
        state = 'idle in transaction'
     or (state = 'active' and now() - query_start > interval '2 minutes')
      );

-- ------------------------------------------------------------- STEP 3: CONFIRM IT IS CLEAR
-- Expect zero rows, or only quick app queries a few milliseconds old.
select count(*) as still_stuck
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
  and (state = 'idle in transaction'
       or (state = 'active' and now() - query_start > interval '2 minutes'));

-- The door itself: this is the exact question signing in asks. It must answer instantly.
select count(*) as access_codes_readable from access_codes;

-- ---------------------------------------------------- STEP 4: DID ANY INDEX HALF-BUILD?
-- A cancelled build can leave an INVALID index behind. It does no harm to reads, but it
-- wastes space and never gets used, so drop any that appear here.
-- Expect ZERO rows. If you get rows, send me the names.
select c.relname as invalid_index, t.relname as on_table
from pg_index i
join pg_class c on c.oid = i.indexrelid
join pg_class t on t.oid = i.indrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not i.indisvalid;

-- ------------------------------------------------------------ STEP 5: HOW MUCH ROOM IS LEFT
-- Index building uses disk. If the database has grown close to your plan's limit, that is
-- a second, separate problem -- send me this number.
select pg_size_pretty(pg_database_size(current_database())) as database_size;
