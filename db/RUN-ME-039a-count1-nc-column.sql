-- =====================================================================================
-- RUN-ME-039a  "COUNT 1" IS THE SHEET'S OWN N.C COLUMN -- PART A OF THREE.
--
--   "Uploaded this file expecting the dc single count are 171, but its 14 on presentation"
--
-- The Expected sheet carries N.C beside DUE SUMMARY, and the two are not the same thing: the
-- 171 customers at N.C 1 on today's third upload read 4-5, 11-12, 7-8 under DUE SUMMARY. The
-- earlier cut (RUN-ME-038) counted "DUE SUMMARY starts with 1", a different 244 customers. So:
--   nc           a new column on repayment_snapshots: the sheet's N.C, filled by every upload
--                from now on. Older uploads have none, and their Count 1 reads as unknown.
--   nc1_owing_n  on the totals: rows with nc = 1 AND status UNDERPAID or UNPAID -- "sum of nc 1
--                of underpaid and unpaid per pmo". NULL for an upload that carried no N.C at
--                all, so the slide shows a dash and names this file, never a nought.
-- RUN A, THEN B, THEN C, each as a whole file (new query, paste, Ctrl+A, Run), each under 100
-- lines because the copy arrives cut at line 100. SAFE TO RE-RUN. The sheets uploaded before
-- this was run carry no N.C: after A and B, upload today's Expected sheet once more.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

-- 1. THE COLUMN. Instant: no default, no table rewrite.
alter table public.repayment_snapshots add column if not exists nc integer;

-- 2. THE TOTALS FUNCTION. Dropped by signature first: create or replace cannot change RETURNS.
--    build_deck_totals (part B) calls it by name at run time, so nothing depends on it.
drop function if exists public.expected_snapshot_totals(date, date, text, text[]);
create function public.expected_snapshot_totals(p_from date, p_to date, p_type text default null, p_teams text[] default null)
returns table (snapshot_date date, snapshot_type text, team text, upload_batch uuid, created_at timestamptz,
               customers bigint, expected_amt numeric, collected_amt numeric, uncollected_amt numeric,
               paid_n bigint, over_n bigint, nc1_owing_n bigint)
language sql stable set search_path = public, pg_catalog as $$
  with rows_ as (
    select s.snapshot_date, s.snapshot_type, s.team, s.upload_batch, s.created_at, s.nc,
      coalesce(s.payment_expected, 0)               as e,
      upper(btrim(coalesce(s.todays_status, '')))   as st,
      coalesce(s.arrears, 0)                        as a
    from public.repayment_snapshots s
    where s.snapshot_date >= p_from and s.snapshot_date <= p_to
      and (p_type  is null or s.snapshot_type = p_type)
      and (p_teams is null or s.team = any (p_teams))
  ), collected_ as (
    select r.*,
      case when r.st in ('PAID', 'OVERPAID') then r.e
           -- least(greatest(...)) in this order, not the other way round: it is the exact
           -- order collectedOf() clamps in, and the two differ when `expected` is negative.
           when r.st = 'UNDERPAID' then least(greatest(r.e - r.a, 0), r.e)
           else 0 end as col
    from rows_ r
  )
  select c.snapshot_date, c.snapshot_type, c.team, c.upload_batch,
    max(c.created_at)                                 as created_at,
    count(*)::bigint                                  as customers,
    sum(c.e)                                          as expected_amt,
    sum(c.col)                                        as collected_amt,
    sum(greatest(c.e - c.col, 0))                     as uncollected_amt,
    count(*) filter (where c.st = 'PAID')::bigint     as paid_n,
    count(*) filter (where c.st = 'OVERPAID')::bigint as over_n,
    -- COUNT 1: N.C = 1 and still owing (UNDERPAID or UNPAID). NULL when no row carried N.C.
    (case when bool_or(c.nc is not null)
          then count(*) filter (where c.nc = 1 and c.st in ('UNDERPAID', 'UNPAID'))
          else null end)::bigint                      as nc1_owing_n
  from collected_ c
  group by c.snapshot_date, c.snapshot_type, c.team, c.upload_batch
$$;
grant execute on function public.expected_snapshot_totals(date, date, text, text[]) to anon, authenticated, service_role;

-- 3. PROOF: the column is there, and the function returns nc1_owing_n. Expect true, true.
select exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'repayment_snapshots' and column_name = 'nc') as has_nc,
       pg_get_function_result(p.oid) ~ 'nc1_owing_n' as has_count1
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'expected_snapshot_totals';
