-- =====================================================================================
-- RUN-ME-020 -- THE defaulter_snapshot_totals CALL THAT IS ERRORING.   READ-ONLY.
--
-- You sent me the statement, not the error line:
--
--   WITH pgrst_source AS (SELECT "pgrst_call".* ... "public"."defaulter_snapshot_totals"(...)
--
-- That is PostgREST's wrapper around ONE call to the team-day totals function -- the read the
-- dashboard, the leader reports and the commission screen all make. Which of the handful of
-- things that can go wrong it actually is changes the fix completely, and the error text is
-- the only thing that says:
--
--   "canceling statement due to statement timeout"   too slow. Section 2 and 3 below.
--   "canceling statement due to user request"        the CLIENT gave up at 45s; the query was
--                                                    still running. Same cure as a timeout.
--   "function public.defaulter_snapshot_totals(...) does not exist"
--                                                    the migration is not installed on this
--                                                    database, or its argument list changed.
--                                                    Section 1 says which.
--   "out of memory" / "temporary file size exceeds"  work_mem (5 MB here) is too small for the
--                                                    sort. Section 3's plan will show a
--                                                    "Sort Method: external merge" line.
--   "permission denied"                              the anon/service role lost EXECUTE.
--
-- Run sections 1, 2 and 3 and send me the output WITH the error line, and the next change is
-- a targeted one instead of a guess. Nothing here alters anything; section 4 is an additive
-- index, commented out, to be run only if section 3 says it is the answer.
--
-- RUN ONE SECTION AT A TIME: the editor shows only the last statement's result.
-- =====================================================================================


-- 1. DOES THE FUNCTION EXIST HERE, AND WITH WHICH ARGUMENTS?
--    The call passes p_from, p_to, p_type, p_teams, p_weekday -- five, in that order. A
--    function with a different signature is invisible to PostgREST and reads as "does not
--    exist" even though something of that name is right there.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.provolatile as volatility,
       has_function_privilege('authenticator', p.oid, 'EXECUTE') as authenticator_may_run
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('defaulter_snapshot_totals', 'expected_snapshot_totals');


-- 2. HOW LONG DOES THE EXACT CALL TAKE? This is the week the dashboard asks for, with the
--    same five arguments the failing statement carries.
explain (analyze, buffers, timing)
select * from public.defaulter_snapshot_totals(
  (date_trunc('week', current_date))::date,
  (date_trunc('week', current_date) + interval '6 days')::date,
  null, null, null);


-- 3. THE SAME QUESTION AS PLAIN SQL, so the plan is readable rather than hidden inside a
--    function call. Look for three things in the output:
--      * "Seq Scan on defaulter_snapshots"     the date index is not being used
--      * "Heap Fetches: <a big number>"        the index is used but every row is still
--                                              fetched from the 449 MB table -- section 4
--      * "Sort Method: external merge  Disk:"  work_mem too small for the grouping
explain (analyze, buffers, timing)
select s.snapshot_date, s.snapshot_type, s.weekday, s.team, s.upload_batch,
       max(s.created_at) as created_at,
       count(*)::bigint as customers,
       sum(coalesce(s.arrears, 0)) as arrears_amt
from public.defaulter_snapshots s
where s.snapshot_date >= (date_trunc('week', current_date))::date
  and s.snapshot_date <= (date_trunc('week', current_date) + interval '6 days')::date
group by s.snapshot_date, s.snapshot_type, s.weekday, s.team, s.upload_batch;


-- 4. THE ONE ADDITION, AND ONLY IF SECTION 3 SHOWED A SEQ SCAN OR A LARGE "Heap Fetches".
--
--    WHAT IT IS. An index carrying the exact columns this aggregate groups by and sums, so a
--    week can be answered from the index alone instead of visiting the 449 MB table row by
--    row. That is the difference between reading ~60,000 scattered heap pages and reading a
--    few hundred index pages.
--
--    WHAT IT COSTS, said plainly rather than discovered later:
--      * roughly 120-180 MB of disk on today's 617 MB table
--      * every defaulter upload writes this index too, so an upload gets a little slower
--      * building it locks the table against writes for the duration. On this table that is
--        seconds, not minutes -- but run it when nobody is uploading.
--
--    IT REPLACES NOTHING. New name, so idx_def_snap_date and idx_def_snap_lookup stay exactly
--    as they are and the planner simply gains a better option. If it turns out not to help,
--    "drop index idx_def_snap_totals" puts the database back precisely where it was.
--
--    Uncomment BOTH lines to run it.
-- set lock_timeout = '5s';
-- create index if not exists idx_def_snap_totals
--   on public.defaulter_snapshots (snapshot_date, snapshot_type, weekday, team, upload_batch)
--   include (arrears, created_at);

-- After creating it, re-run section 3. "Heap Fetches: 0" with an Index Only Scan is the win.
-- analyze public.defaulter_snapshots;
