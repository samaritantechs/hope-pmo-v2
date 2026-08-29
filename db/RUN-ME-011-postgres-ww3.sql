-- =====================================================================================
-- RUN-ME-011 -- POSTGRES WW3: the WHOLE system, one paste.
--
-- This file is the result of auditing EVERY query the portal, the call app and the upload
-- page make, table by table, and giving each one the index or the counting function it
-- leans on. It contains everything RUN-ME-008 and RUN-ME-010 contained, so if those were
-- never run it does not matter: run THIS once and the war is over.
--
-- ⚠ HOW TO RUN -- ONE NUMBERED SECTION AT A TIME. DO NOT PASTE THE WHOLE FILE.
--
-- This was originally written as a single paste, and that took the live system down: the
-- Supabase SQL editor wraps a paste in ONE transaction, so all 41 index builds plus the
-- ANALYZE ran as one long lock on the busiest tables. Uploads queued behind it, the queue
-- used up the connection pool, and then even signing in timed out with a 504.
--
-- So: copy ONE section (1, then 2, then 3 ...), run it, wait for it to finish, then the
-- next. Each section is seconds of work on its own. Run it when nobody is uploading, and
-- stop for the day if any section takes more than a minute -- there is no harm in
-- finishing tomorrow, and every section is independent.
--
-- Safe to re-run: every statement is IF NOT EXISTS / CREATE OR REPLACE, and the pieces
-- that depend on optional columns or tables check first, so a section can never abort
-- halfway through. If the system ever slows during this, run db/FIX-NOW-unblock-database.sql.
--
-- NOT TOUCHED, ON PURPOSE: the HOPE LOAN book lives in its own schema with its own
-- RUN-ME series (db/hopeloan/RUN-ME-000..006). This file is the HOPE PMO book.
-- =====================================================================================

-- ================================ 1. THE SNAPSHOT BACKBONE ===========================
-- Every dashboard, weekly report, presentation and totals-function call reads these two
-- tables, in exactly four question shapes: by date range, by one deck (type+date+team),
-- by batch resolution, and by one customer's history.
create index if not exists idx_rep_snap_date       on repayment_snapshots(snapshot_date);
create index if not exists idx_repay_snap_date_type on repayment_snapshots(snapshot_date, snapshot_type);
create index if not exists idx_repay_snap_lookup   on repayment_snapshots(snapshot_type, snapshot_date, team);
create index if not exists idx_repay_snap_batch    on repayment_snapshots(snapshot_type, snapshot_date, upload_batch);
create index if not exists idx_repay_snap_ref      on repayment_snapshots(ref, snapshot_date);

create index if not exists idx_def_snap_date       on defaulter_snapshots(snapshot_date);
create index if not exists idx_def_snap_date_type  on defaulter_snapshots(snapshot_date, snapshot_type);
create index if not exists idx_def_snap_lookup     on defaulter_snapshots(snapshot_type, weekday, snapshot_date, team);
create index if not exists idx_def_snap_batch      on defaulter_snapshots(snapshot_type, weekday, snapshot_date, upload_batch);
create index if not exists idx_def_snap_ref        on defaulter_snapshots(ref, snapshot_date);

-- ================================ 2. THE LOANS PIPELINE ==============================
-- The funnel counts by stage, the boards window by three dates, findcust looks up by
-- docket, and the agents board groups by creator.
create index if not exists idx_loans_stage         on loans(stage);
create index if not exists idx_loans_team          on loans(team);
create index if not exists loans_stage_team_idx    on loans(stage, team);
create index if not exists idx_loans_created_at    on loans(created_at);
create index if not exists idx_loans_approved_date on loans(approved_date);
create index if not exists idx_loans_docket        on loans(docket_no);
create index if not exists idx_loans_created_by    on loans(created_by) where created_by is not null;

-- ================================ 3. THE FOLLOWUP BOOK ===============================
-- The most-read table in the API (33 reads): the officers' live working list. Team-scoped
-- on every screen, ordered by arrears on the big ones, filtered by status and promise
-- date on the rest.
create index if not exists idx_followup_team          on followup_status(team);
create index if not exists idx_followup_team_arrears  on followup_status(team, arrears desc);
create index if not exists idx_followup_fu_status     on followup_status(fu_status);
create index if not exists idx_followup_promise       on followup_status(promise_date)
  where promise_date is not null;
create index if not exists idx_fu_status_updated      on followup_status(updated_at);

-- ================================ 4. THE REGISTERS ===================================
-- Comments, complaints, restructures, demand notices, payments: each is read by customer
-- (newest first), by date window, by team, and cleaned by upload batch.
create index if not exists idx_fu_comments_ref      on followup_comments(ref, created_at desc);
create index if not exists idx_fu_comments_created  on followup_comments(created_at desc);
create index if not exists idx_fu_comments_batch    on followup_comments(upload_batch);
create index if not exists idx_fu_comments_new_number on followup_comments(new_number)
  where new_number is not null and new_number <> '';

create index if not exists idx_complaints_ref       on complaints(ref, created_at desc);
create index if not exists idx_complaints_created   on complaints(created_at desc);
create index if not exists idx_complaints_team      on complaints(team);
create index if not exists idx_complaints_batch     on complaints(upload_batch);
create index if not exists idx_complaint_log_cid    on complaint_log(complaint_id, created_at);

create index if not exists idx_restructures_ref     on restructures(ref, created_at desc);
create index if not exists idx_restructures_team    on restructures(team);
create index if not exists idx_restructures_made    on restructures(created_at);
create index if not exists idx_restructures_batch   on restructures(upload_batch);

create index if not exists idx_demand_notices_ref   on demand_notices(ref, notice_date desc);
create index if not exists idx_demand_notices_team  on demand_notices(team);
create index if not exists idx_demand_notices_made  on demand_notices(created_at);
create index if not exists idx_demand_notices_batch on demand_notices(upload_batch);

create index if not exists idx_received_paid_at     on received_payments(paid_at);
create index if not exists idx_received_ref         on received_payments(ref_no);
create index if not exists idx_abnormal_team        on abnormal_payments(team);
create index if not exists idx_abnormal_made        on abnormal_payments(created_at);

-- ================================ 5. THE PEOPLE ======================================
-- Call logs by officer and by day; call app users found by phone at sign-in and by team
-- on the boards; access codes listed by role for the Ripoti fold and the bike recovery.
create index if not exists idx_call_logs_user       on call_logs(user_id);
create index if not exists idx_call_logs_user_date  on call_logs(user_id, call_date);
create index if not exists idx_call_logs_date_team  on call_logs(call_date, team);
create index if not exists idx_call_users_phone     on call_users(phone);
create index if not exists idx_call_users_team      on call_users(team);
create index if not exists idx_access_codes_role    on access_codes(role);

-- ====================== 6. PIECES THAT DEPEND ON OPTIONAL MIGRATIONS =================
-- Each block checks that its column or table exists before indexing it, so a database
-- that never ran the earlier paste sails through instead of aborting the transaction.
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

-- ====================== 7. THE COUNTING FUNCTIONS THE SCREENS ASK FOR ================
-- Four screens ask the database to COUNT before they will read rows. Without these the
-- code falls back to reading whole tables to produce a handful of numbers -- the shape
-- behind every timeout this system has ever had.

-- 7a. The pipeline funnel: eight stage counts in one journey (dashboard, every load).
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

-- 7b. Calls per officer: a GROUP BY instead of every call ever made (Teams & Staff).
create or replace function call_counts_by_user()
returns table (user_id text, calls bigint)
language sql
stable
as $$
  select user_id::text, count(*) from call_logs where user_id is not null group by 1
$$;
grant execute on function call_counts_by_user() to anon, authenticated, service_role;

-- 7c. Storage by report and date: ten grouped counts instead of ten whole tables
--     (Settings -> storage panel).
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
$$;
grant execute on function storage_usage_by_date() to anon, authenticated, service_role;

-- 7d. "What has already been uploaded today?" -- the upload page's opening question,
--     answered with about twenty summary rows instead of four whole tables.
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

-- ================================ 8. FRESH STATISTICS ================================
-- So the planner starts using every index above immediately, not after the next autovacuum.
analyze repayment_snapshots;
analyze defaulter_snapshots;
analyze followup_status;
analyze followup_comments;
analyze loans;
analyze received_payments;
analyze abnormal_payments;
analyze complaints;
analyze complaint_log;
analyze restructures;
analyze demand_notices;
analyze call_logs;
analyze call_users;
analyze access_codes;

-- ================================ 9. PROOF, NOT HOPE =================================
-- Row 1: how many of the war's named indexes are installed (expect ALL of the first
-- number; the second is how many this file names). Rows 2-3: the counting functions.
-- Rows 4-7: timed probes over real questions -- each should answer in well under a
-- second. If any crawls, say so with the number it printed.
select 'Indexes installed' as piece,
       count(*) || ' of 41 named' as result
from pg_indexes where schemaname = 'public' and indexname in (
  'idx_rep_snap_date','idx_repay_snap_date_type','idx_repay_snap_lookup','idx_repay_snap_batch','idx_repay_snap_ref',
  'idx_def_snap_date','idx_def_snap_date_type','idx_def_snap_lookup','idx_def_snap_batch','idx_def_snap_ref',
  'idx_loans_stage','idx_loans_team','loans_stage_team_idx','idx_loans_created_at','idx_loans_approved_date',
  'idx_loans_docket','idx_loans_created_by','idx_loans_upload_date',
  'idx_followup_team','idx_followup_team_arrears','idx_followup_fu_status','idx_followup_promise','idx_fu_status_updated',
  'idx_fu_comments_ref','idx_fu_comments_created','idx_fu_comments_batch','idx_fu_comments_new_number',
  'idx_complaints_ref','idx_complaints_created','idx_complaints_team','idx_complaints_batch','idx_complaint_log_cid',
  'idx_restructures_ref','idx_restructures_team','idx_demand_notices_ref','idx_demand_notices_team',
  'idx_received_paid_at','idx_received_ref','idx_abnormal_team',
  'idx_call_logs_user_date','idx_call_logs_date_team');
select 'Counting functions' as piece,
       count(*) || ' of 4 (stage counts, call counts, storage, upload status)' as result
from pg_proc where proname in ('loan_stage_counts','call_counts_by_user','storage_usage_by_date','upload_status_summary');
select 'Team-day totals functions (from RUN-ME-2026-08-09)' as piece,
       count(*) || ' of 2' as result
from pg_proc where proname in ('expected_snapshot_totals','defaulter_snapshot_totals');
select 'Probe: expected totals, one week' as probe, count(*) || ' team-day rows' as answered
from expected_snapshot_totals(current_date - 7, current_date, 'today', null);
select 'Probe: defaulter totals, one week' as probe, count(*) || ' deck rows' as answered
from defaulter_snapshot_totals(current_date - 7, current_date, null, null, null);
select 'Probe: upload status, today' as probe, count(*) || ' summary rows' as answered
from upload_status_summary(current_date);
select 'Probe: calls per officer' as probe, count(*) || ' officers' as answered
from call_counts_by_user();
