-- =====================================================================================
-- COUNT EVERY REPORT, NOT JUST FIVE.
--
-- WHY
-- The Settings tab lets an admin see what is stored by date and let old dates go. It only ever
-- knew about five reports -- Expected, Defaulters, Received Payments, Abnormal Payments and
-- Call Logs -- which left the owner able to clean five things and stuck with everything else.
--
-- This adds the other five that accumulate: the loan pipeline, the comments log, complaints,
-- restructures and demand notices.
--
-- YOU DO NOT HAVE TO RUN THIS FOR THE NEW REPORTS TO APPEAR. The app counts anything this
-- function does not answer for the old way, table by table. Running it just makes those five
-- as fast as the rest.
--
-- Not included, on purpose: followup_status. It is not a report and has no date dimension --
-- one row per customer, rebuilt from each Current deck, carrying the officers' live working
-- list with their promises and comments on it. "Delete a date" has no meaning there, and the
-- nearest thing it could mean would wipe the book everybody is working from.
--
-- SAFE TO RE-RUN. Creates no tables and touches no data.
-- =====================================================================================

create or replace function storage_usage_by_date()
returns table (source text, day date, n bigint)
language sql
stable
-- Pinned for the same reason as before: a function with no search_path of its own resolves
-- table names against whatever the caller happens to have set, which is what Supabase's
-- advisor flags as "Function Search Path Mutable".
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

-- Indexes on the columns being grouped and deleted by, so both the counting and the cleanup
-- read an index rather than the whole table. IF NOT EXISTS everywhere: several already exist.
create index if not exists idx_loans_upload_date   on public.loans(upload_date);
create index if not exists idx_fu_comments_made    on public.followup_comments(created_at);
create index if not exists idx_complaints_made     on public.complaints(created_at);
create index if not exists idx_restructures_made   on public.restructures(created_at);
create index if not exists idx_demand_notices_made on public.demand_notices(created_at);

-- Cleaning one of the four registers people also type into only ever takes rows that arrived
-- in an upload, so the delete filters on upload_batch as well as the date.
create index if not exists idx_fu_comments_batch    on public.followup_comments(upload_batch);
create index if not exists idx_complaints_batch     on public.complaints(upload_batch);
create index if not exists idx_restructures_batch   on public.restructures(upload_batch);
create index if not exists idx_demand_notices_batch on public.demand_notices(upload_batch);
