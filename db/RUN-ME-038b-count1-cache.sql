-- =====================================================================================
-- RUN-ME-038b  "COUNT 1" -- PART B OF THREE: the cache (RUN-ME-022) learns the column.
--              Run A first. Whole file: new query, paste, Ctrl+A, Run. Under 100 lines on purpose.
--
-- The slides read deck_totals, filled when a deck lands. B adds ds1_owing_n to it, drops the
-- two earlier Count 1 columns (ds1_left_n, ds1_n -- nothing reads them any more), re-creates
-- the build so it fills the new column, and marks the last two weeks "not built" so they are
-- rebuilt with it (part C). Until C runs, those days are read live: correct, slower, and every
-- upload rebuilds a few of them on its own anyway. Guarded: a database that never ran
-- RUN-ME-022 is left exactly as it is. Nothing is deleted from any deck. SAFE TO RE-RUN.
-- UNTIL THIS IS RUN nothing breaks: the slide shows a dash in the column and names RUN-ME-038.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

-- 1. THE COLUMN. Dropping the old two is safe at any moment: the code that read them asks again
--    without a column the table refuses, and the slide shows a dash until the next deploy.
do $$
begin
  if to_regclass('public.deck_totals') is not null then
    execute 'alter table public.deck_totals add column if not exists ds1_owing_n bigint';
    execute 'alter table public.deck_totals drop column if exists ds1_left_n';
    execute 'alter table public.deck_totals drop column if exists ds1_n';
  end if;
end $$;

-- 2. THE BUILD, filling it.
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

-- 3. THE DAYS ALREADY BUILT HAVE NO COUNT 1 IN THEM: mark the last two weeks "not built".
do $$
begin
  if to_regclass('public.deck_totals_days') is not null then
    execute $q$ delete from public.deck_totals_days
                 where kind = 'expected' and snapshot_date >= current_date - 14 $q$;
  end if;
end $$;

-- 4. PROOF, off the function the slides read: per team, Count 1 beside the headcount, for the
--    next initial sheets. The figure must equal the UNDERPAID + UNPAID rows at NC 1 -- part C
--    lists those by status so it can be checked by eye.
select team, customers, paid_n + over_n as paid_over, customers - paid_n - over_n as remaining,
       ds1_owing_n as count1
from public.expected_snapshot_totals(current_date, current_date + 3, 'initial', null)
order by team;
