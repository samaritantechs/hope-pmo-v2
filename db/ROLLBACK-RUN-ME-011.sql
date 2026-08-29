-- =====================================================================================
-- ROLLBACK RUN-ME-011 -- put the database back exactly where it was before last night.
--
-- WHAT RUN-ME-011 ACTUALLY LEFT BEHIND. Three kinds of thing, and only one of them can
-- still be affecting you:
--
--   1. INDEXES.  The only lasting change. Most were `if not exists` over indexes you
--                already had, so they did nothing. EIGHT were genuinely new. Those eight
--                are dropped below, which returns the database to its previous shape and
--                gives back the disk they took.
--   2. FUNCTIONS. Four were replaced with definitions identical to the ones already in
--                your migrations, so there is nothing to undo -- replacing them again
--                with the same text changes nothing.
--   3. ANALYZE.  Statistics only. It stores no data and cannot be "undone" because there
--                is nothing there to remove.
--
-- So this file is the complete rollback. Nothing else from that paste persists.
--
-- NO DATA IS TOUCHED. An index is a lookup aid, not the information itself. Dropping one
-- can never lose a customer, a payment, a snapshot or a comment -- at worst a screen that
-- got faster last night goes back to the speed it had yesterday morning.
-- =====================================================================================

-- STEP 1 -- if the database is refusing writes, this lets THIS TAB work so you can clean
-- up. It affects only this session and changes no project setting. Harmless if writes are
-- already allowed.
set session characteristics as transaction read write;

-- STEP 2 -- how big it is before.
select pg_size_pretty(pg_database_size(current_database())) as size_before;

-- STEP 3 -- the eight indexes that did not exist before last night.
-- Run these one line at a time if the editor is struggling; each is independent.
drop index if exists idx_followup_team_arrears;
drop index if exists idx_followup_fu_status;
drop index if exists idx_followup_promise;
drop index if exists idx_complaint_log_cid;
drop index if exists idx_restructures_ref;
drop index if exists idx_call_users_phone;
drop index if exists idx_call_users_team;
drop index if exists idx_access_codes_role;

-- STEP 4 -- how big it is after. Send me both numbers.
select pg_size_pretty(pg_database_size(current_database())) as size_after;

-- STEP 5 -- is anything still stuck? Expect zero rows.
select pid, state, now() - query_start as running_for,
       left(regexp_replace(query, '\s+', ' ', 'g'), 70) as doing
from pg_stat_activity
where datname = current_database() and pid <> pg_backend_pid()
  and (state = 'idle in transaction'
       or (state = 'active' and now() - query_start > interval '1 minute'));

-- =====================================================================================
-- DELIBERATELY NOT DROPPED, and you should not drop them:
--
--   idx_repay_snap_date_type    These two are what stop the "canceling statement due to
--   idx_def_snap_date_type      statement timeout" errors you were getting BEFORE any of
--                               this. They are small, they came from a migration written
--                               two weeks ago, and removing them brings that fault back.
--
-- ALSO NOT DONE HERE: VACUUM FULL. It would reclaim more space, but it needs room to work
-- and takes an exclusive lock on the table while it runs -- exactly the wrong medicine if
-- the problem is that the database is short of space. Do not run it.
-- =====================================================================================
