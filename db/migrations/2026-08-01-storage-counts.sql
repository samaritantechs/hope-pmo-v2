-- =====================================================================================
-- COUNTING WITHOUT DOWNLOADING, and one security warning closed.
--
-- WHY
-- The Settings tab shows what is stored, broken down by date and report type. To build that
-- table it was downloading EVERY ROW of five tables -- every repayment snapshot, every
-- defaulter snapshot, every received payment, every abnormal payment, every call log -- one
-- table after another, and then counting them in JavaScript.
--
-- With thirty thousand customers and a snapshot every day, that is millions of rows pulled
-- across the internet to work out a number Postgres already knows. It is why the Settings tab
-- took so long to open, and it was quietly a large part of the data-transfer bill.
--
-- Counting is Postgres's job. This does it in one query, over indexes, and sends back a few
-- hundred rows instead of a few million.
--
-- SAFE TO RE-RUN. Creates no tables and touches no data.
-- =====================================================================================

-- One row per (report type, day) with its count. Anything with no date of its own is grouped
-- under a NULL day and ignored by the caller, the same as before.
create or replace function storage_usage_by_date()
returns table (source text, day date, n bigint)
language sql
stable
-- A function with no search_path of its own resolves table names against whatever the caller
-- happens to have set, which is what Supabase's advisor flags as "Function Search Path
-- Mutable". Pinning it means this function always reads the tables it was written for.
set search_path = public, pg_catalog
as $$
  select 'expected'::text,   snapshot_date::date, count(*) from public.repayment_snapshots group by 2
  union all
  select 'defaulters'::text, snapshot_date::date, count(*) from public.defaulter_snapshots group by 2
  union all
  select 'received'::text,   paid_at::date,       count(*) from public.received_payments   group by 2
  union all
  select 'abnormal'::text,   created_at::date,    count(*) from public.abnormal_payments   group by 2
  union all
  select 'calls'::text,      call_date::date,     count(*) from public.call_logs           group by 2
$$;

-- The app reads through PostgREST as an authenticated service role; make sure it may call this.
grant execute on function storage_usage_by_date() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------
-- The same warning, on the function that already existed.
--
-- Supabase's advisor reported: "public.loan_identity_text has a role mutable search_path".
-- Same fix, same reason. The body is unchanged -- this only pins where it looks things up.
-- It stays IMMUTABLE because it still depends on nothing but its arguments, which is what
-- lets the loans table key an index off it.
-- ---------------------------------------------------------------------------------------
create or replace function loan_identity_text(
  p_loan_id text, p_docket_no text, p_track_no text, p_full_name text, p_contact text
) returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select coalesce(
    nullif(upper(btrim(coalesce(p_loan_id, ''))), ''),
    nullif(upper(btrim(coalesce(p_docket_no, ''))), ''),
    array_to_string(array_remove(ARRAY[
      nullif(upper(btrim(coalesce(p_track_no, ''))), ''),
      nullif(upper(btrim(coalesce(p_full_name, ''))), ''),
      nullif(upper(btrim(coalesce(p_contact, ''))), '')
    ], NULL), '|')
  );
$$;

-- Indexes on the columns being grouped, so the counting is a scan of the index rather than of
-- the whole table. IF NOT EXISTS everywhere: several of these already exist.
create index if not exists idx_rep_snap_date  on public.repayment_snapshots(snapshot_date);
create index if not exists idx_def_snap_date  on public.defaulter_snapshots(snapshot_date);
create index if not exists idx_received_paid  on public.received_payments(paid_at);
create index if not exists idx_abnormal_made  on public.abnormal_payments(created_at);
create index if not exists idx_call_logs_date on public.call_logs(call_date);
