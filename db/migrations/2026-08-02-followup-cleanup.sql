-- THE FOLLOW-UP LIST JOINS THE CLEANABLE REPORTS.
--
-- followup_status was the one register that only ever grew. It is upserted per customer, so a
-- re-upload corrects rather than duplicates -- but a customer who leaves the deck KEEPS their
-- row, deliberately, because their history is still worth reading. Nothing ever removed one.
-- Importing a year of v1 comments adds a placeholder for every customer mentioned as well.
--
-- OPTIONAL, like every migration here. Without it the Settings tab still counts the follow-up
-- list and still cleans it -- just the slow way, by reading the column rather than an index.
-- Nothing breaks if this is never run.

create or replace function storage_usage_by_date()
returns table (source text, day date, n bigint)
language sql stable as $$
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
  union all
  select 'followup'::text,       updated_at::date,    count(*) from public.followup_status     group by 2
$$;

grant execute on function storage_usage_by_date() to anon, authenticated, service_role;

-- Both the counting above and the delete read this.
create index if not exists idx_fu_status_updated on public.followup_status(updated_at);

-- Cleaning the follow-up list cascades into followup_comments (the foreign key is
-- ON DELETE CASCADE, which is exactly why the app counts and reports the comments that would
-- go BEFORE taking anything). This index is what keeps that cascade from being a table scan.
create index if not exists idx_fu_comments_ref_only on public.followup_comments(ref);
