-- =====================================================================================
-- RUN-ME-038a  "COUNT 1" ON THE EARLY-COLLECTION AND PMO COLLECTION SLIDES -- PART A OF THREE.
--              "sum of nc 1 of underpaid and unpaid per pmo"
--
-- RUN A, THEN B, THEN C, each one as a whole file: new query, paste, Ctrl+A, Run. Each part is
-- under 100 lines ON PURPOSE -- the one-file version arrived at the database cut off at line
-- 100, twice, and "unterminated dollar-quoted string" was the result. Keep them short.
--
-- A replaces the totals function (2026-08-05-snapshot-totals) with one more column:
--   ds1_owing_n  rows whose DUE SUMMARY is "1-<n>" or "1/<n>" (spaces allowed; the sheet
--                writes a dash) AND whose TODAYS STATUS is UNDERPAID or UNPAID -- those two and
--                no other. PAID, OVERPAID and a blank status do not count.
-- The slide adds it over the officer's teams: that is the "per pmo". The fallback fold in
-- api/_lib/snapshot-totals.js (dsOne) counts the identical rule. SAFE TO RE-RUN.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

-- `create or replace` cannot change what a function RETURNS, so the old one is dropped by its
-- exact signature first. build_deck_totals calls it by name at run time (re-created in B).
drop function if exists public.expected_snapshot_totals(date, date, text, text[]);

create function public.expected_snapshot_totals(
  p_from date,
  p_to date,
  p_type text default null,
  p_teams text[] default null
) returns table (
  snapshot_date date,
  snapshot_type text,
  team text,
  upload_batch uuid,
  created_at timestamptz,
  customers bigint,
  expected_amt numeric,
  collected_amt numeric,
  uncollected_amt numeric,
  paid_n bigint,
  over_n bigint,
  ds1_owing_n bigint
)
language sql
stable
set search_path = public, pg_catalog
as $$
  with rows_ as (
    select
      s.snapshot_date, s.snapshot_type, s.team, s.upload_batch, s.created_at,
      coalesce(s.payment_expected, 0)               as e,
      upper(btrim(coalesce(s.todays_status, '')))   as st,
      coalesce(s.arrears, 0)                        as a,
      -- "1-N" or "1/N", spaces around the separator allowed, nothing else: one instalment paid.
      (btrim(coalesce(s.due_summary, '')) ~ '^1\s*[-/]\s*\d+$') as ds1
    from public.repayment_snapshots s
    where s.snapshot_date >= p_from
      and s.snapshot_date <= p_to
      and (p_type  is null or s.snapshot_type = p_type)
      and (p_teams is null or s.team = any (p_teams))
  ), collected_ as (
    select
      r.*,
      case
        when r.st in ('PAID', 'OVERPAID') then r.e
        -- least(greatest(...)) in this order, not the other way round: it is the exact order
        -- collectedOf() clamps in, and the two orders differ when `expected` is negative.
        when r.st = 'UNDERPAID'           then least(greatest(r.e - r.a, 0), r.e)
        else 0
      end as col
    from rows_ r
  )
  select
    c.snapshot_date, c.snapshot_type, c.team, c.upload_batch,
    max(c.created_at)                                     as created_at,
    count(*)::bigint                                      as customers,
    sum(c.e)                                              as expected_amt,
    sum(c.col)                                            as collected_amt,
    sum(greatest(c.e - c.col, 0))                         as uncollected_amt,
    count(*) filter (where c.st = 'PAID')::bigint         as paid_n,
    count(*) filter (where c.st = 'OVERPAID')::bigint     as over_n,
    -- COUNT 1: NC 1 and still owing -- UNDERPAID or UNPAID, those two statuses and no other.
    count(*) filter (where c.ds1 and c.st in ('UNDERPAID', 'UNPAID'))::bigint as ds1_owing_n
  from collected_ c
  group by c.snapshot_date, c.snapshot_type, c.team, c.upload_batch
$$;

grant execute on function public.expected_snapshot_totals(date, date, text, text[])
  to anon, authenticated, service_role;

-- Proof that A is in: the function now has the column. Expect one row reading ds1_owing_n.
select p.proname, pg_get_function_result(p.oid) ~ 'ds1_owing_n' as has_count1
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'expected_snapshot_totals';
