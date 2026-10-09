-- =====================================================================================
-- RUN-ME-038  "COUNT 1" (NC = 1) ON THE EARLY-COLLECTION AND PMO COLLECTION SLIDES: per
--             officer, the sum over their teams of customers at NC 1 -- DUE SUMMARY reads 1-N --
--             whose status on the sheet is UNDERPAID or UNPAID.
--
--   "Btn remaining and customers columns in early collection pmo slide add Count1"
--   "sum of nc 1 of underpaid and unpaid per pmo"
--
-- The slides read TEAM-DAY TOTALS, summed by the database (2026-08-05-snapshot-totals) and kept
-- in deck_totals when a deck lands (RUN-ME-022). So the figure is one more column of those
-- totals, ds1_owing_n: rows whose DUE SUMMARY is exactly "1-<n>" or "1/<n>" (spaces allowed)
-- AND whose TODAYS STATUS is UNDERPAID or UNPAID. PAID and OVERPAID do not count, and neither
-- does a row with a blank or any other status -- "underpaid and unpaid" is the rule, said in
-- full. The slide adds the column over the officer's teams, which is the "per pmo".
-- THE SHEET WRITES IT WITH A DASH: the live book's shapes are 9-99, 99-99 and 9-9, ninety
-- thousand rows and not one slash. The fallback fold in api/_lib/snapshot-totals.js (dsOne)
-- counts the identical rule, so a database with this file run and one without agree.
--
-- RAN AN EARLIER VERSION ALREADY? Run this whole file again: section 1 replaces the function
-- with the one column, section 2 swaps the cache's column for it, section 3 re-marks the days.
-- The earlier columns (ds1_left_n, ds1_n) are dropped: nothing reads them any more, and a
-- column with a definition nobody uses is a figure waiting to be misread.
--
-- UNTIL THIS IS RUN nothing breaks: the slide shows a dash in the column and a caption naming
-- this file. The code already asks for the column and steps back when the table has not got it.
--
-- SAFE TO RE-RUN. Nothing is deleted from any deck; section 3 only re-marks days as "not
-- built" so the cache rebuilds them with the new column, and an unbuilt day is read live.
--
-- HOW TO RUN IT -- THE WHOLE FILE, THEN ONE LINE:
--   1. In a NEW query: paste this entire file, press Ctrl+A so nothing is half-selected, Run.
--      Instant. (The SQL editor runs only the highlighted text when some is highlighted -- a
--      selection that ends part-way through the function is what "unterminated dollar-quoted
--      string" means, and nothing at all ran.)
--   2. In the same query, replace everything with this one line and Run it, again and again,
--      until days_left reads 0 (about twenty seconds a go):
--        select * from public.build_deck_totals_recent();
--      It is NOT in the body of this file on purpose: the editor sends a script as ONE
--      statement, so a slow rebuild timing out would roll the function back with it. Until it
--      is run, the re-marked days are read live -- correct, slower -- and every upload rebuilds
--      a few of them on its own anyway. If RUN-ME-022 was never run the function does not
--      exist: skip it.
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
  ds1_owing_n bigint
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
    -- COUNT 1: NC 1 and still owing -- UNDERPAID or UNPAID, those two statuses and no other.
    count(*) filter (where c.ds1 and c.st in ('UNDERPAID', 'UNPAID'))::bigint as ds1_owing_n
  from collected_ c
  group by c.snapshot_date, c.snapshot_type, c.team, c.upload_batch
$$;

grant execute on function public.expected_snapshot_totals(date, date, text, text[])
  to anon, authenticated, service_role;


-- 2. THE CACHE (RUN-ME-022), IF IT IS THERE: the new column in, the earlier two out, and a
--    build that fills it. Guarded, so a database that never ran RUN-ME-022 is left as it is.
--    Dropping the old columns is safe at any moment: the code that read them asks again
--    without a column the table refuses, and the slide shows a dash until the next deploy.
do $$
begin
  if to_regclass('public.deck_totals') is not null then
    execute 'alter table public.deck_totals add column if not exists ds1_owing_n bigint';
    execute 'alter table public.deck_totals drop column if exists ds1_left_n';
    execute 'alter table public.deck_totals drop column if exists ds1_n';
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
                                    ds1_owing_n)
    select 'expected', t.snapshot_date, t.snapshot_type, null, t.team, t.upload_batch,
           t.created_at, t.customers, t.expected_amt, t.collected_amt, t.uncollected_amt, t.paid_n, t.over_n,
           t.ds1_owing_n
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
--    The rebuild itself is the ONE LINE in the header, run on its own after this file.
do $$
begin
  if to_regclass('public.deck_totals_days') is not null then
    execute $q$ delete from public.deck_totals_days
                 where kind = 'expected' and snapshot_date >= current_date - 14 $q$;
  end if;
end $$;


-- 4. PROOF, TWO WAYS.
--    (a) Per team off the function the slides read: Count 1 beside the headcount.
select team, customers, paid_n + over_n as paid_over, customers - paid_n - over_n as remaining,
       ds1_owing_n as count1
from public.expected_snapshot_totals(current_date, current_date + 3, 'initial', null)
order by team;

--    (b) The same sheets, NC 1 rows only, by status -- so the figure can be checked against the
--        rule by eye: count1 must equal underpaid + unpaid, and nothing else.
select s.snapshot_date, upper(btrim(coalesce(s.todays_status, ''))) as status, count(*) as nc1_rows
from public.repayment_snapshots s
where s.snapshot_type = 'initial'
  and s.snapshot_date between current_date and current_date + 3
  and btrim(coalesce(s.due_summary, '')) ~ '^1\s*[-/]\s*\d+$'
group by 1, 2
order by 1, 2;
