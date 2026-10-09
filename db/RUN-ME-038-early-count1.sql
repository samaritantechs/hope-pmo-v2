-- =====================================================================================
-- RUN-ME-038  "COUNT 1" ON THE EARLY-COLLECTION SLIDE: of the customers still to pay, how
--             many are on their second instalment (DUE SUMMARY reads 1/N).
--
--   "Btn remaining and customers columns in early collection pmo slide add Count1 (to show
--    the remaining count DS 1 among the all left ones) - auto add that column into the
--    ongoing presentation"
--
-- The early slide reads TEAM-DAY TOTALS, summed by the database (2026-08-05-snapshot-totals)
-- and kept in deck_totals when a deck lands (RUN-ME-022). So the new figure is one more column
-- of those totals: ds1_left_n -- rows whose status is not PAID and not OVERPAID and whose
-- DUE SUMMARY is exactly "1/<n>" (spaces around the slash allowed). The same reading of the
-- D.S cell as paidCount() in the web server, and the fallback fold in api/_lib/snapshot-totals.js
-- counts the identical rule, so a database with this file run and one without agree.
--
-- UNTIL THIS IS RUN nothing breaks: the slide shows a dash in the column and a caption naming
-- this file. The code already asks for the column and steps back when the table has not got it.
--
-- SAFE TO RE-RUN. Nothing is deleted from any deck; section 3 only re-marks days as "not
-- built" so the cache rebuilds them with the new column, and an unbuilt day is read live.
--
-- RUN SECTIONS 1 TO 3 TOGETHER (instant), THEN SECTION 4 ON ITS OWN, until days_left is 0.
-- Section 4 is the slow part. The SQL editor sends a script as ONE statement, so a timeout in
-- it would roll back the function too -- keep it on its own line, as RUN-ME-022 says.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';


-- 1. THE TOTALS FUNCTION, WITH THE NEW COLUMN.
--    `create or replace` cannot change what a function RETURNS, so the old one is dropped by
--    its exact signature first. Nothing references it by dependency: build_deck_totals calls it
--    by name at run time, and that is re-created in section 2.
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
  ds1_left_n bigint
)
language sql
stable
set search_path = public, pg_catalog
as $$
  with rows_ as (
    select
      s.snapshot_date,
      s.snapshot_type,
      s.team,
      s.upload_batch,
      s.created_at,
      coalesce(s.payment_expected, 0)               as e,
      upper(btrim(coalesce(s.todays_status, '')))   as st,
      coalesce(s.arrears, 0)                        as a,
      -- "1/N", spaces around the slash allowed, nothing else: one instalment paid.
      (btrim(coalesce(s.due_summary, '')) ~ '^1\s*/\s*\d+$') as ds1
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
    c.snapshot_date,
    c.snapshot_type,
    c.team,
    c.upload_batch,
    max(c.created_at)                                     as created_at,
    count(*)::bigint                                      as customers,
    sum(c.e)                                              as expected_amt,
    sum(c.col)                                            as collected_amt,
    sum(greatest(c.e - c.col, 0))                         as uncollected_amt,
    count(*) filter (where c.st = 'PAID')::bigint         as paid_n,
    count(*) filter (where c.st = 'OVERPAID')::bigint     as over_n,
    count(*) filter (where c.st not in ('PAID', 'OVERPAID') and c.ds1)::bigint as ds1_left_n
  from collected_ c
  group by c.snapshot_date, c.snapshot_type, c.team, c.upload_batch
$$;

grant execute on function public.expected_snapshot_totals(date, date, text, text[])
  to anon, authenticated, service_role;


-- 2. THE CACHE (RUN-ME-022), IF IT IS THERE: one more column, and a build that fills it.
--    Guarded, so a database that never ran RUN-ME-022 is left exactly as it is.
do $$
begin
  if to_regclass('public.deck_totals') is not null then
    execute 'alter table public.deck_totals add column if not exists ds1_left_n bigint';
  end if;
end $$;

create or replace function public.build_deck_totals(p_kind text, p_from date, p_to date)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare n bigint;
begin
  delete from public.deck_totals
   where kind = p_kind and snapshot_date between p_from and p_to;

  if p_kind = 'expected' then
    insert into public.deck_totals (kind, snapshot_date, snapshot_type, weekday, team, upload_batch,
                                    created_at, customers, expected_amt, collected_amt, uncollected_amt, paid_n, over_n,
                                    ds1_left_n)
    select 'expected', t.snapshot_date, t.snapshot_type, null, t.team, t.upload_batch,
           t.created_at, t.customers, t.expected_amt, t.collected_amt, t.uncollected_amt, t.paid_n, t.over_n,
           t.ds1_left_n
      from public.expected_snapshot_totals(p_from, p_to, null, null) t;
  elsif p_kind = 'defaulter' then
    insert into public.deck_totals (kind, snapshot_date, snapshot_type, weekday, team, upload_batch,
                                    created_at, customers, arrears_amt)
    select 'defaulter', t.snapshot_date, t.snapshot_type, t.weekday, t.team, t.upload_batch,
           t.created_at, t.customers, t.arrears_amt
      from public.defaulter_snapshot_totals(p_from, p_to, null, null, null) t;
  else
    raise exception 'build_deck_totals: kind must be expected or defaulter, got %', p_kind;
  end if;

  get diagnostics n = row_count;

  delete from public.deck_totals_days
   where kind = p_kind and snapshot_date between p_from and p_to;
  insert into public.deck_totals_days (kind, snapshot_date, built_at, rows_in)
  select p_kind, d::date, now(),
         (select count(*) from public.deck_totals x where x.kind = p_kind and x.snapshot_date = d::date)
    from generate_series(p_from, p_to, interval '1 day') d;

  return n;
end;
$$;


-- 3. THE DAYS ALREADY BUILT HAVE NO COUNT 1 IN THEM. Mark the last two weeks of expected
--    sheets "not built" so they are rebuilt with the new column; until the rebuild, those days
--    are read live (correct, slower), and the next upload tops the window up on its own.
do $$
begin
  if to_regclass('public.deck_totals_days') is not null then
    execute $q$ delete from public.deck_totals_days
                 where kind = 'expected' and snapshot_date >= current_date - 14 $q$;
  end if;
end $$;


-- 4. RUN THIS ON ITS OWN, THEN AGAIN, UNTIL days_left IS 0. About twenty seconds a go.
--    Select the line by itself. If RUN-ME-022 was never run it does not exist -- skip it.
select * from public.build_deck_totals_recent();


-- 5. PROOF. Tomorrow's early list, per team, with Count 1 beside the headcount.
select team, customers, paid_n + over_n as paid_over, customers - paid_n - over_n as remaining, ds1_left_n as count1
from public.expected_snapshot_totals(current_date, current_date + 3, 'initial', null)
order by team;
