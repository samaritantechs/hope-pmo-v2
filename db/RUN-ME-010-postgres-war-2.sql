-- =====================================================================================
-- RUN-ME-010 -- the whole outstanding Postgres war, in ONE editor-safe paste.
-- Paste the WHOLE file into the Supabase SQL editor and run once. Safe to re-run: every
-- statement is IF NOT EXISTS / CREATE OR REPLACE.
--
-- WHY NOW. "canceling statement due to statement timeout" -- the team-day totals functions
-- went in today, but their supporting indexes lived in a separate file that was never run.
-- A function without its indexes reads the whole table on every call, and on this book that
-- crosses the database's own statement time limit -- sometimes, which is why it worked and
-- then did not. Everything below is plain CREATE INDEX (no CONCURRENTLY -- this editor wraps
-- a paste in a transaction and refuses it): a brief pause on writes, seconds at this size,
-- best run when nobody is uploading.
-- =====================================================================================

-- 1) THE TOTALS FUNCTIONS' OWN INDEXES (from RUN-ME-2026-08-14b, the piece that was missing).
--    Both functions filter a RANGE of snapshot_date; the existing indexes lead on type and
--    weekday -- right for "one deck", wrong for "a week of them". Leading on the date puts a
--    week's rows next to each other on disk, which is what keeps a call off the timeout.
create index if not exists idx_repay_snap_date_type
  on repayment_snapshots (snapshot_date, snapshot_type);
create index if not exists idx_def_snap_date_type
  on defaulter_snapshots (snapshot_date, snapshot_type);

-- 2) THE FUNNEL COUNTED IN ONE JOURNEY (from 2026-08-11). Without this function the dashboard
--    counts loans one stage at a time -- eight sequential trips on every load.
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
create index if not exists loans_stage_team_idx on loans (stage, team);

-- 3) THE FIRST WAR'S INDEXES (RUN-ME-008), repeated here so one paste covers everything:
--    the money table by date, complaints by customer, replacement numbers alone.
create index if not exists idx_received_paid_at on received_payments (paid_at);
create index if not exists idx_complaints_ref on complaints (ref, created_at desc);
create index if not exists idx_fu_comments_new_number on followup_comments (new_number)
  where new_number is not null and new_number <> '';

-- 4) THE DASHBOARD'S REMAINING SCANS. The loans window filters on three dates (created,
--    approved, upload-stamp) and the abnormal tile scopes by team -- none of them indexed.
create index if not exists idx_loans_created_at on loans (created_at);
create index if not exists idx_loans_approved_date on loans (approved_date);
create index if not exists idx_loans_upload_date on loans (upload_date);
create index if not exists idx_abnormal_team on abnormal_payments (team);

-- 5) Fresh statistics so the planner uses all of the above immediately.
analyze repayment_snapshots;
analyze defaulter_snapshots;
analyze loans;
analyze received_payments;
analyze complaints;
analyze followup_comments;
analyze abnormal_payments;

-- 6) PROOF, NOT HOPE. The first row of each pair says the piece is there; the timed selects
--    exercise the two totals functions over a real week -- they should answer in well under
--    a second now. If either still crawls, say so with the number it printed.
select 'Totals date indexes' as piece,
       case when count(*) = 2 then 'YES' else 'MISSING' end as installed
from pg_indexes where indexname in ('idx_repay_snap_date_type', 'idx_def_snap_date_type');
select 'Funnel counter (loan_stage_counts)' as piece,
       case when count(*) = 1 then 'YES' else 'MISSING' end as installed
from pg_proc where proname = 'loan_stage_counts';
select 'War indexes (payments/complaints/numbers/loans/abnormal)' as piece,
       count(*) || ' of 7' as installed
from pg_indexes where indexname in ('idx_received_paid_at', 'idx_complaints_ref',
  'idx_fu_comments_new_number', 'idx_loans_created_at', 'idx_loans_approved_date',
  'idx_loans_upload_date', 'idx_abnormal_team');
select 'Expected totals, one week' as probe, count(*) || ' team-day rows' as answered
from expected_snapshot_totals(current_date - 7, current_date, 'today', null);
select 'Defaulter totals, one week' as probe, count(*) || ' deck rows' as answered
from defaulter_snapshot_totals(current_date - 7, current_date, null, null, null);
