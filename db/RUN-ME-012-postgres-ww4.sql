-- =====================================================================================
-- RUN-ME-012 -- POSTGRES WW4. The same war as WW3, fought the way it should have been.
--
-- WHAT WENT WRONG LAST TIME, in one sentence: the Supabase SQL editor runs a paste as ONE
-- transaction, so 41 index builds queued up as one long lock on the busiest tables, the
-- queue ate the connection pool, and even signing in 504'd.
--
-- WHAT IS DIFFERENT NOW -- three rules, and they are the whole point of this file:
--
--   1. DOSES. Each numbered dose is one small paste: one table's indexes, or one group of
--      functions. Seconds of work. You run a dose, you see it finish, you take the next.
--
--   2. ARMOR. Every dose begins with two lines:
--          set lock_timeout = '5s';
--          set statement_timeout = '2min';
--      The first means: if a table is busy, the dose GIVES UP after five seconds instead
--      of queueing -- and a dose that gives up blocks nobody, because it was never holding
--      anything. The second means no statement can run away for an hour. A dose that
--      fails with "canceling statement due to lock timeout" has done NO damage: run the
--      same dose again at a quieter moment. That error is the armor working, not a fault.
--
--   3. TRIAGE FIRST. DOSE 0 changes nothing and tells you exactly what the database has
--      and has not got -- including everything WW3 left behind -- so you only run the
--      doses that are actually missing.
--
-- WHEN: run doses when nobody is uploading (early morning, evening). One dose per paste.
-- If any dose takes more than ~30 seconds, stop for the day; finishing tomorrow is free.
--
-- SAFE TO RE-RUN: every statement is IF NOT EXISTS / CREATE OR REPLACE. Running a dose
-- twice does nothing the second time.
--
-- NOT TOUCHED, ON PURPOSE: the HOPE LOAN book (db/hopeloan/RUN-ME series) lives apart.
-- =====================================================================================


-- ================================ DOSE 0 -- TRIAGE (reads only, run any time) =========
-- Paste this whole dose. It changes nothing. It answers, in order:
--   A. anything stuck right now?          expect zero rows
--   B. any half-built (INVALID) indexes?  expect zero rows; drop any that appear
--   C. which of the war's indexes are MISSING?   each row here names a dose to run
--   D. are the counting functions in?     expect 4 of 4, and 2 of 2
--   E. how big is the database, and where the space is

-- A. Stuck sessions. A row here means run db/FIX-NOW-unblock-database.sql first.
select pid, state, now() - query_start as running_for,
       left(regexp_replace(query, '\s+', ' ', 'g'), 70) as doing
from pg_stat_activity
where datname = current_database() and pid <> pg_backend_pid()
  and (state = 'idle in transaction'
       or (state = 'active' and now() - query_start > interval '1 minute'));

-- B. Invalid indexes: a cancelled build can leave one. Harmless to reads, wasted space,
--    never used. Drop any named here (drop index if exists <name>;) and re-run its dose.
select c.relname as invalid_index, t.relname as on_table
from pg_index i
join pg_class c on c.oid = i.indexrelid
join pg_class t on t.oid = i.indrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not i.indisvalid;

-- C. The war's indexes, present or missing -- each missing row names its dose.
with wanted(idx, dose) as (values
  ('idx_rep_snap_date', 1), ('idx_repay_snap_date_type', 1), ('idx_repay_snap_lookup', 1),
  ('idx_repay_snap_batch', 1), ('idx_repay_snap_ref', 1),
  ('idx_def_snap_date', 2), ('idx_def_snap_date_type', 2), ('idx_def_snap_lookup', 2),
  ('idx_def_snap_batch', 2), ('idx_def_snap_ref', 2),
  ('idx_loans_stage', 3), ('idx_loans_team', 3), ('loans_stage_team_idx', 3),
  ('idx_loans_created_at', 3), ('idx_loans_approved_date', 3), ('idx_loans_docket', 3),
  ('idx_loans_created_by', 3),
  ('idx_followup_team', 4), ('idx_followup_team_arrears', 4), ('idx_followup_fu_status', 4),
  ('idx_followup_promise', 4), ('idx_fu_status_updated', 4),
  ('idx_fu_comments_ref', 5), ('idx_fu_comments_created', 5), ('idx_fu_comments_batch', 5),
  ('idx_fu_comments_new_number', 5),
  ('idx_complaints_ref', 6), ('idx_complaints_created', 6), ('idx_complaints_team', 6),
  ('idx_complaints_batch', 6), ('idx_complaint_log_cid', 6),
  ('idx_restructures_ref', 7), ('idx_restructures_team', 7), ('idx_restructures_made', 7),
  ('idx_restructures_batch', 7), ('idx_demand_notices_ref', 7), ('idx_demand_notices_team', 7),
  ('idx_demand_notices_made', 7), ('idx_demand_notices_batch', 7),
  ('idx_received_paid_at', 8), ('idx_received_ref', 8), ('idx_abnormal_team', 8),
  ('idx_abnormal_made', 8),
  ('idx_call_logs_user', 9), ('idx_call_logs_user_date', 9), ('idx_call_logs_date_team', 9),
  ('idx_call_users_phone', 9), ('idx_call_users_team', 9), ('idx_access_codes_role', 9))
select w.idx,
       case when i.indexname is null then 'MISSING -> run DOSE ' || w.dose else 'installed' end as state
from wanted w
left join pg_indexes i on i.schemaname = 'public' and i.indexname = w.idx
order by (i.indexname is null) desc, w.dose, w.idx;

-- D. The counting functions (DOSE 11 and 12) and the team-day totals pair.
select 'counting functions (want 4)' as piece, count(*) || ' of 4' as result
from pg_proc where proname in ('loan_stage_counts','call_counts_by_user','storage_usage_by_date','upload_status_summary');
select 'totals functions (want 2, from the 2026-08-09 migration)' as piece, count(*) || ' of 2' as result
from pg_proc where proname in ('expected_snapshot_totals','defaulter_snapshot_totals');

-- E. Size, and the ten biggest things on disk.
select pg_size_pretty(pg_database_size(current_database())) as database_size;
select relname as object,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       pg_size_pretty(pg_indexes_size(c.oid)) as of_which_indexes
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc
limit 10;


-- ================================ DOSE 1 -- repayment snapshots ======================
-- The backbone of every dashboard and weekly report. The two date/type indexes here are
-- the ones that ended the "canceling statement due to statement timeout" era -- if DOSE 0
-- says they are installed, this dose finishes instantly.
set lock_timeout = '5s';
set statement_timeout = '2min';
create index if not exists idx_rep_snap_date        on repayment_snapshots(snapshot_date);
create index if not exists idx_repay_snap_date_type on repayment_snapshots(snapshot_date, snapshot_type);
create index if not exists idx_repay_snap_lookup    on repayment_snapshots(snapshot_type, snapshot_date, team);
create index if not exists idx_repay_snap_batch     on repayment_snapshots(snapshot_type, snapshot_date, upload_batch);
create index if not exists idx_repay_snap_ref       on repayment_snapshots(ref, snapshot_date);

-- ================================ DOSE 2 -- defaulter snapshots ======================
set lock_timeout = '5s';
set statement_timeout = '2min';
create index if not exists idx_def_snap_date       on defaulter_snapshots(snapshot_date);
create index if not exists idx_def_snap_date_type  on defaulter_snapshots(snapshot_date, snapshot_type);
create index if not exists idx_def_snap_lookup     on defaulter_snapshots(snapshot_type, weekday, snapshot_date, team);
create index if not exists idx_def_snap_batch      on defaulter_snapshots(snapshot_type, weekday, snapshot_date, upload_batch);
create index if not exists idx_def_snap_ref        on defaulter_snapshots(ref, snapshot_date);

-- ================================ DOSE 3 -- the loans pipeline =======================
set lock_timeout = '5s';
set statement_timeout = '2min';
create index if not exists idx_loans_stage         on loans(stage);
create index if not exists idx_loans_team          on loans(team);
create index if not exists loans_stage_team_idx    on loans(stage, team);
create index if not exists idx_loans_created_at    on loans(created_at);
create index if not exists idx_loans_approved_date on loans(approved_date);
create index if not exists idx_loans_docket        on loans(docket_no);
create index if not exists idx_loans_created_by    on loans(created_by) where created_by is not null;

-- ================================ DOSE 4 -- the followup book ========================
-- The most-read table in the API: the officers' live working list.
set lock_timeout = '5s';
set statement_timeout = '2min';
create index if not exists idx_followup_team          on followup_status(team);
create index if not exists idx_followup_team_arrears  on followup_status(team, arrears desc);
create index if not exists idx_followup_fu_status     on followup_status(fu_status);
create index if not exists idx_followup_promise       on followup_status(promise_date)
  where promise_date is not null;
create index if not exists idx_fu_status_updated      on followup_status(updated_at);

-- ================================ DOSE 5 -- the comments log =========================
set lock_timeout = '5s';
set statement_timeout = '2min';
create index if not exists idx_fu_comments_ref        on followup_comments(ref, created_at desc);
create index if not exists idx_fu_comments_created    on followup_comments(created_at desc);
create index if not exists idx_fu_comments_batch      on followup_comments(upload_batch);
create index if not exists idx_fu_comments_new_number on followup_comments(new_number)
  where new_number is not null and new_number <> '';

-- ================================ DOSE 6 -- complaints ===============================
set lock_timeout = '5s';
set statement_timeout = '2min';
create index if not exists idx_complaints_ref       on complaints(ref, created_at desc);
create index if not exists idx_complaints_created   on complaints(created_at desc);
create index if not exists idx_complaints_team      on complaints(team);
create index if not exists idx_complaints_batch     on complaints(upload_batch);
create index if not exists idx_complaint_log_cid    on complaint_log(complaint_id, created_at);

-- ================================ DOSE 7 -- restructures & demand notices ============
set lock_timeout = '5s';
set statement_timeout = '2min';
create index if not exists idx_restructures_ref     on restructures(ref, created_at desc);
create index if not exists idx_restructures_team    on restructures(team);
create index if not exists idx_restructures_made    on restructures(created_at);
create index if not exists idx_restructures_batch   on restructures(upload_batch);
create index if not exists idx_demand_notices_ref   on demand_notices(ref, notice_date desc);
create index if not exists idx_demand_notices_team  on demand_notices(team);
create index if not exists idx_demand_notices_made  on demand_notices(created_at);
create index if not exists idx_demand_notices_batch on demand_notices(upload_batch);

-- ================================ DOSE 8 -- payments =================================
set lock_timeout = '5s';
set statement_timeout = '2min';
create index if not exists idx_received_paid_at     on received_payments(paid_at);
create index if not exists idx_received_ref         on received_payments(ref_no);
create index if not exists idx_abnormal_team        on abnormal_payments(team);
create index if not exists idx_abnormal_made        on abnormal_payments(created_at);

-- ================================ DOSE 9 -- the people ===============================
set lock_timeout = '5s';
set statement_timeout = '2min';
create index if not exists idx_call_logs_user       on call_logs(user_id);
create index if not exists idx_call_logs_user_date  on call_logs(user_id, call_date);
create index if not exists idx_call_logs_date_team  on call_logs(call_date, team);
create index if not exists idx_call_users_phone     on call_users(phone);
create index if not exists idx_call_users_team      on call_users(team);
create index if not exists idx_access_codes_role    on access_codes(role);

-- ====================== DOSE 10 -- pieces that depend on optional migrations =========
-- Each block checks its column or table exists first, so an older database sails through.
set lock_timeout = '5s';
set statement_timeout = '2min';
do $do$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'loans' and column_name = 'upload_date') then
    execute 'create index if not exists idx_loans_upload_date on loans(upload_date)';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'followup_status' and column_name = 'deck_date') then
    execute 'create index if not exists idx_fu_status_deck_date on followup_status(deck_date)';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'demand_notices' and column_name = 'notice_id') then
    execute 'create unique index if not exists idx_demand_notice_id on demand_notices(notice_id) '
         || 'where notice_id is not null';
  end if;
  if to_regclass('public.audit_log') is not null then
    execute 'create index if not exists idx_audit_at on audit_log(at desc)';
    execute 'create index if not exists idx_audit_actor on audit_log(actor_code, at desc)';
  end if;
  if to_regclass('public.performance_records') is not null then
    execute 'create index if not exists idx_perf_period on performance_records(period, period_start, metric, value desc)';
  end if;
  if to_regclass('public.snapshot_summaries') is not null then
    execute 'create index if not exists idx_snap_summ_range on snapshot_summaries(kind, snapshot_date, snapshot_type)';
    execute 'create index if not exists idx_snap_summ_team on snapshot_summaries(team, snapshot_date)';
  end if;
end $do$;

-- ====================== DOSE 11 -- THE SETTINGS TAB'S COUNTING FUNCTION ==============
-- Run this one EARLY if the Settings page is slow: without it the tab has only totals and
-- no day-by-day board (the app now refuses to download whole tables to build it). Function
-- creation takes no table locks worth speaking of -- this dose is instant.
set lock_timeout = '5s';
set statement_timeout = '2min';
create or replace function storage_usage_by_date()
returns table (source text, day date, n bigint)
language sql
stable
set search_path = public, pg_catalog
as $$
  select 'expected'::text,       snapshot_date::date, count(*) from public.repayment_snapshots group by 2
  union all
  select 'defaulters'::text,     snapshot_date::date, count(*) from public.defaulter_snapshots group by 2
  union all
  select 'received'::text,       paid_at::date,       count(*) from public.received_payments   group by 2
  union all
  select 'abnormal'::text,       created_at::date,    count(*) from public.abnormal_payments   group by 2
  union all
  select 'calls'::text,          call_date::date,     count(*) from public.call_logs           group by 2
  union all
  -- upload_date, not created_at: the storage panel deletes loans by the day the admin
  -- CHOSE for the report, so it must count them by the same day.
  select 'loans'::text,          upload_date::date,   count(*) from public.loans               group by 2
  union all
  select 'comments'::text,       created_at::date,    count(*) from public.followup_comments   group by 2
  union all
  select 'complaints'::text,     created_at::date,    count(*) from public.complaints          group by 2
  union all
  select 'restructures'::text,   created_at::date,    count(*) from public.restructures        group by 2
  union all
  select 'demand_notices'::text, created_at::date,    count(*) from public.demand_notices      group by 2
  union all
  select 'followup'::text,       updated_at::date,    count(*) from public.followup_status     group by 2
$$;
grant execute on function storage_usage_by_date() to anon, authenticated, service_role;

-- ====================== DOSE 12 -- the other three counting functions ================
set lock_timeout = '5s';
set statement_timeout = '2min';

-- The pipeline funnel: eight stage counts in one journey (dashboard, every load).
create or replace function loan_stage_counts(p_teams text[] default null)
returns table (stage text, n bigint)
language sql
stable
as $$
  select l.stage::text, count(*)::bigint
  from loans l
  where p_teams is null or upper(l.team) = any (select upper(t) from unnest(p_teams) t)
  group by l.stage
$$;
grant execute on function loan_stage_counts(text[]) to service_role;

-- Calls per officer: a GROUP BY instead of every call ever made (Teams & Staff).
create or replace function call_counts_by_user()
returns table (user_id text, calls bigint)
language sql
stable
as $$
  select user_id::text, count(*) from call_logs where user_id is not null group by 1
$$;
grant execute on function call_counts_by_user() to anon, authenticated, service_role;

-- "What has already been uploaded today?" -- the upload page's opening question.
create or replace function upload_status_summary(p_day date)
returns table (
  source text, kind text, weekday text,
  latest date, total bigint, today bigint, uploads bigint
)
language sql
stable
as $$
  with rep_day as (
    select snapshot_type::text as kind,
           coalesce(upload_batch::text, 'legacy') as batch, count(*) as n
    from repayment_snapshots where snapshot_date = p_day group by 1, 2
  ), rep_all as (
    select snapshot_type::text as kind, max(snapshot_date) as latest, count(*) as total
    from repayment_snapshots group by 1
  ),
  def_day as (
    select snapshot_type::text as kind, coalesce(weekday::text, '') as wd,
           coalesce(upload_batch::text, 'legacy') as batch, count(*) as n
    from defaulter_snapshots where snapshot_date = p_day group by 1, 2, 3
  ), def_all as (
    select snapshot_type::text as kind, coalesce(weekday::text, '') as wd,
           max(snapshot_date) as latest, count(*) as total
    from defaulter_snapshots group by 1, 2
  )
  select 'expected'::text, a.kind, ''::text, a.latest, a.total,
         coalesce((select max(d.n) from rep_day d where d.kind = a.kind), 0),
         coalesce((select count(*) from rep_day d where d.kind = a.kind), 0)
  from rep_all a
  union all
  select 'defaulters'::text, a.kind, a.wd, a.latest, a.total,
         coalesce((select max(d.n) from def_day d where d.kind = a.kind and d.wd = a.wd), 0),
         coalesce((select count(*) from def_day d where d.kind = a.kind and d.wd = a.wd), 0)
  from def_all a
  union all
  select 'received'::text, ''::text, ''::text,
         (select max(paid_at::date) from received_payments),
         (select count(*) from received_payments),
         (select count(*) from received_payments where paid_at::date = p_day),
         0::bigint
  union all
  select 'calls'::text, ''::text, ''::text,
         (select max(call_date::date) from call_logs),
         (select count(*) from call_logs),
         (select count(*) from call_logs where call_date::date = p_day),
         0::bigint
$$;
grant execute on function upload_status_summary(date) to anon, authenticated, service_role;

-- ====================== DOSE 13 -- fresh statistics (three pastes inside) ============
-- ANALYZE is quick and takes only a light lock, but on the biggest tables it is still
-- politest one at a time. Run 13a, then 13b, then 13c as separate pastes.

-- 13a. The two big snapshot tables.
set lock_timeout = '5s';
set statement_timeout = '2min';
analyze repayment_snapshots;
analyze defaulter_snapshots;

-- 13b. The working list and its registers.
set lock_timeout = '5s';
set statement_timeout = '2min';
analyze followup_status;
analyze followup_comments;
analyze loans;
analyze received_payments;
analyze abnormal_payments;

-- 13c. The small tables.
set lock_timeout = '5s';
set statement_timeout = '2min';
analyze complaints;
analyze complaint_log;
analyze restructures;
analyze demand_notices;
analyze call_logs;
analyze call_users;
analyze access_codes;

-- ================================ DOSE 14 -- PROOF, NOT HOPE =========================
-- Reads only. Re-run DOSE 0 part C to see every index installed, then time these probes:
-- each should answer well under a second. If one crawls, say so with its number.
set statement_timeout = '1min';
select 'Probe: expected totals, one week' as probe, count(*) || ' team-day rows' as answered
from expected_snapshot_totals(current_date - 7, current_date, 'today', null);
select 'Probe: defaulter totals, one week' as probe, count(*) || ' deck rows' as answered
from defaulter_snapshot_totals(current_date - 7, current_date, null, null, null);
select 'Probe: upload status, today' as probe, count(*) || ' summary rows' as answered
from upload_status_summary(current_date);
select 'Probe: storage by date' as probe, count(*) || ' day rows' as answered
from storage_usage_by_date();
select 'Probe: calls per officer' as probe, count(*) || ' officers' as answered
from call_counts_by_user();
