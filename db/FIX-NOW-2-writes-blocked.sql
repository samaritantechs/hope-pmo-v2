-- =====================================================================================
-- FIX NOW 2 -- READS WORK, WRITES DO NOT.
--
-- Signing in works, pages load, but uploading defaulters sits at 0/5 and the phones blink
-- yellow. Everything that READS is fine and everything that WRITES is refused. That is one
-- of exactly two things, and STEP 1 says which in one word. Do not guess -- run STEP 1 and
-- read the verdict.
-- =====================================================================================

-- ------------------------------------------------------------------ STEP 1: THE VERDICT
-- read_only_mode = 'on'  -> the database itself is refusing all writes (size/disk limit).
--                           Go to STEP 3.
-- read_only_mode = 'off' -> writes are allowed and something is BLOCKING them. Go to STEP 2.
show default_transaction_read_only;

-- How big it is, and how much of that is the indexes.
select pg_size_pretty(pg_database_size(current_database())) as database_size;

-- The ten biggest things on disk, table data and its indexes separately. If one index is
-- huge and new, that is where the room went.
select relname                                     as object,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       pg_size_pretty(pg_indexes_size(c.oid))        as of_which_indexes
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc
limit 10;

-- ----------------------------------------------------- STEP 2: WHO IS BLOCKING THE WRITES
-- Only if STEP 1 said 'off'. Any row here is a query stuck waiting, and blocked_by names
-- the session holding it up.
select w.pid                                as waiting_query,
       now() - w.query_start                as waiting_for,
       left(regexp_replace(w.query, '\s+', ' ', 'g'), 70) as trying_to_do,
       w.wait_event_type, w.wait_event,
       pg_blocking_pids(w.pid)              as blocked_by
from pg_stat_activity w
where w.datname = current_database()
  and w.state = 'active'
  and cardinality(pg_blocking_pids(w.pid)) > 0;

-- Free them: terminates ONLY the sessions named in blocked_by above, plus anything left
-- idle in a transaction. Ordinary app queries last milliseconds and are never touched.
select pg_terminate_backend(pid) as terminated, state,
       left(regexp_replace(query, '\s+', ' ', 'g'), 60) as was_doing
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
  and (state = 'idle in transaction'
       or pid in (select unnest(pg_blocking_pids(pid)) from pg_stat_activity
                  where datname = current_database() and state = 'active'));

-- --------------------------------------------- STEP 3: ONLY IF STEP 1 SAID 'on' (read-only)
-- The database has hit its plan's storage limit and Supabase has locked writes to protect
-- it. Nothing is damaged; it needs room. This makes THIS SESSION able to write so you can
-- make room -- it does not change the project setting, and it lasts only for this tab.
set session characteristics as transaction read write;

-- Then tell me the STEP 1 numbers before running anything below. The right way to make room
-- depends on where the space actually went, and deleting the wrong thing loses history you
-- cannot get back. There are three roads and I will tell you which one is yours:
--   a) drop the indexes my paste added back      -- instant, reversible, no data lost
--   b) purge snapshot dates older than N months  -- large win, and it is YOUR history
--   c) raise the plan's storage limit            -- instant, costs money, loses nothing
--
-- (a) is the one that is always safe, so it is written out here ready to run. These eight
-- indexes did not exist before last night; dropping them puts the database back exactly
-- where it was and costs nothing but a little speed on screens that were fine before.
-- The two snapshot date indexes are deliberately NOT in this list: they are what stops the
-- "canceling statement due to statement timeout" errors, and they are small.
--
--   drop index if exists idx_followup_team_arrears;
--   drop index if exists idx_followup_fu_status;
--   drop index if exists idx_followup_promise;
--   drop index if exists idx_complaint_log_cid;
--   drop index if exists idx_restructures_ref;
--   drop index if exists idx_call_users_phone;
--   drop index if exists idx_call_users_team;
--   drop index if exists idx_access_codes_role;
--   vacuum;
