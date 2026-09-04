-- =====================================================================================
-- RUN-ME-022 -- ADD THEM UP ONCE, WHEN THE DECK IS UPLOADED.
--
--   "The cure is to add them up ONCE -- when the deck is uploaded -- (THEN DO IT)"
--
-- WHY, IN ONE LINE FROM YOUR OWN DATABASE:
--
--   select sum(i) from generate_series(1,3000000) i;      ->  10,535 ms
--
-- That touches no table, no index, no lock and no disk. It is pure arithmetic, and a healthy
-- small instance does it in well under a second. Yours took ten and a half. Every read on the
-- diagnosis card -- the 84-row teams table, the empty abnormal_payments table -- is slow for
-- the same reason: this CPU is running at a fraction of its speed, so the only thing that
-- helps is ASKING IT TO DO LESS.
--
-- Today the dashboard asks it to add up 109,603 deck rows to produce 878 team-day totals, and
-- asks again on the next load, and again for every other screen. This file makes it add them
-- up once, when the deck lands, and keeps the answer.
--
--     before   109,603 rows aggregated, per read, several reads per screen
--     after        878 rows read straight out of a small table
--
-- SAFE BY CONSTRUCTION:
--   * Two NEW tables. Nothing existing is altered, dropped or rewritten.
--   * The arithmetic is not reimplemented. The build calls the SAME functions the dashboard
--     calls today, so a total in the cache and a total computed live cannot disagree.
--   * A day that has not been built is read the old way, automatically. Until you run the
--     backfill in section 4, every screen behaves EXACTLY as it does now.
--   * To go back: "drop table deck_totals, deck_totals_days;" and the code falls through to
--     the live path on its next request. Nothing else to undo.
--
-- RUN SECTIONS 1-3 NOW (they are instant), THEN SECTION 4 ON ITS OWN, REPEATEDLY, UNTIL
-- days_left IS 0. Select section 4's one line by itself rather than running the whole file
-- again: the SQL editor sends a script as ONE statement, so a timeout anywhere inside it rolls
-- back everything in it -- which is how the first totals migration was lost once already.
--
-- THE CODE IS ALREADY DEPLOYED AND ALREADY LOOKING FOR THESE TABLES. Until you run this it
-- finds nothing and reads everything live, exactly as it does today. There is no moment in
-- between where anything is half done.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '5min';


-- 1. THE TWO TABLES.
--    deck_totals      one row per team per day per upload batch -- what the functions return.
--    deck_totals_days which days have been built. A day that is not in here is read live, so
--                     "not built yet" and "built and empty" are never confused.
create table if not exists public.deck_totals (
  kind             text        not null,          -- 'expected' | 'defaulter'
  snapshot_date    date        not null,
  snapshot_type    text,
  weekday          text,
  team             text,
  upload_batch     uuid,
  created_at       timestamptz,
  customers        bigint,
  expected_amt     numeric,
  collected_amt    numeric,
  uncollected_amt  numeric,
  paid_n           bigint,
  over_n           bigint,
  arrears_amt      numeric
);

create index if not exists idx_deck_totals_read
  on public.deck_totals (kind, snapshot_date, snapshot_type);

create table if not exists public.deck_totals_days (
  kind           text not null,
  snapshot_date  date not null,
  built_at       timestamptz not null default now(),
  rows_in        bigint,
  primary key (kind, snapshot_date)
);


-- 2. THE BUILD, FOR ONE KIND OVER ONE RANGE.
--    It calls expected_snapshot_totals / defaulter_snapshot_totals -- the very functions the
--    screens call -- so there is one definition of the arithmetic in this system, not two.
--    Deleting the range first makes it safe to re-run over a day that was re-uploaded.
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
                                    created_at, customers, expected_amt, collected_amt, uncollected_amt, paid_n, over_n)
    select 'expected', t.snapshot_date, t.snapshot_type, null, t.team, t.upload_batch,
           t.created_at, t.customers, t.expected_amt, t.collected_amt, t.uncollected_amt, t.paid_n, t.over_n
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

  -- Every day in the range is marked built, including the days that turned out empty: an
  -- empty day that is not marked would be read live for ever, which is the slow path we came
  -- here to leave.
  delete from public.deck_totals_days
   where kind = p_kind and snapshot_date between p_from and p_to;
  insert into public.deck_totals_days (kind, snapshot_date, built_at, rows_in)
  select p_kind, d::date, now(),
         (select count(*) from public.deck_totals x where x.kind = p_kind and x.snapshot_date = d::date)
    from generate_series(p_from, p_to, interval '1 day') d;

  return n;
end;
$$;


-- 3. THE BACKFILL: AS MANY DAYS AS FIT IN A TIME BUDGET, NEWEST FIRST.
--
--    IT BUILDS FORWARD AS WELL AS BACK, AND THAT IS NOT AN OPTIMISATION -- IT IS THE BUG.
--    This walked from p_back days ago up to TODAY, and stopped. But the dashboard reads its week
--    as MONDAY TO SUNDAY, and a range is served from the cache only when EVERY day of it is
--    built -- so on any day except Sunday the week contained unbuilt future days, the all-or-
--    nothing rule refused it, and the dashboard fell through to the live aggregate EVERY TIME.
--    The cache was being filled and the screen that needed it most never touched it.
--    A future day costs nothing to build: there is no deck, the index range is empty, and an
--    upload dated into the future unmarks its own day on the way in. Fourteen days ahead covers
--    any week, month or fortnight a screen can ask for.
--
--    EVERY CALENDAR DAY IS BUILT, INCLUDING THE ONES WITH NOTHING IN THEM. That is not waste,
--    it is the point. The code serves a range from the cache only when EVERY day of it is
--    built -- so that a week can never come back with four days in it and no sign that three
--    are missing. A Sunday nobody uploads is a day of the week, so if "no deck" meant "never
--    built", no week would ever be complete and the cache would never answer anything. A day
--    with nothing in it costs almost nothing to build: the index range is empty.
--
--    NEWEST FIRST, because the newest days are the ones every screen reads.
--
--    BOUNDED BY A CLOCK, NOT BY A COUNT. A fixed number of days is the wrong bound when the
--    same six days take two seconds on a good morning and two minutes on a bad one. This
--    stops when the budget is spent, whatever it has managed -- so one paste is always safe
--    to run, and on a fast day it does far more of the work than a fixed count would.
--
--    RESUMABLE. It only ever picks days that are not built, so running it again carries on
--    from where it stopped. Nothing is broken in between: a day not yet built is read the old
--    way, exactly as every day is read today.
/* ADDING AN ARGUMENT MAKES A SECOND FUNCTION, NOT A REPLACEMENT.
   "create or replace" matches on the whole signature, so growing p_ahead onto a two-argument
   function left BOTH versions in the database, and calling it with no arguments then failed:

     ERROR: 42725: function public.build_deck_totals_recent() is not unique

   Both had defaults for every parameter, so neither was a better candidate than the other.
   The old shape is dropped by name FIRST -- explicitly, so re-running this file is safe -- and
   only then is the new one created. */
drop function if exists public.build_deck_totals_recent(int, int);

create or replace function public.build_deck_totals_recent(
  p_budget_ms int default 20000,
  p_back int default 120,
  p_ahead int default 14)
returns table (kind text, day date, rows_built bigint, days_left bigint)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare r record; n bigint; started timestamptz := clock_timestamp();
begin
  for r in
    select k.kind as k, d::date as d
      from generate_series(current_date - p_back, current_date + p_ahead, interval '1 day') d
      cross join (values ('expected'), ('defaulter')) as k(kind)
      left join public.deck_totals_days b on b.kind = k.kind and b.snapshot_date = d::date
     where b.snapshot_date is null
     order by d desc, k.kind
  loop
    exit when extract(epoch from (clock_timestamp() - started)) * 1000 > p_budget_ms;
    n := public.build_deck_totals(r.k, r.d, r.d);
    kind := r.k; day := r.d; rows_built := n;
    days_left := (
      select count(*)
        from generate_series(current_date - p_back, current_date + p_ahead, interval '1 day') d
        cross join (values ('expected'), ('defaulter')) as kk(kind)
        left join public.deck_totals_days b on b.kind = kk.kind and b.snapshot_date = d::date
       where b.snapshot_date is null);
    return next;
  end loop;
end;
$$;


-- 4. RUN THIS ON ITS OWN, THEN RUN IT AGAIN, UNTIL days_left IS 0.
--
--    RUN IT BY ITSELF -- select this line alone, not the whole file. The SQL editor sends a
--    script as ONE statement, so a timeout anywhere in it rolls back everything in it, and
--    that is how the first totals migration was lost once already.
--
--    Each call works for about twenty seconds and reports how many day-builds are still to do.
--    Nothing is broken while it runs and nothing is broken if you stop half way: an unbuilt
--    day is read exactly as every day is read today.
select * from public.build_deck_totals_recent();


-- 5. WHERE IT HAS GOT TO. Run any time.
select kind, count(*) as days_built, min(snapshot_date) as oldest, max(snapshot_date) as newest,
       sum(rows_in) as total_rows
from public.deck_totals_days
group by kind
order by kind;


-- 6. PROOF IT IS WORTH IT. The first is what the dashboard does today; the second is what it
--    will do once the days are built. Compare the two Execution Times.
explain (analyze, buffers, timing)
select * from public.defaulter_snapshot_totals(
  (date_trunc('week', current_date))::date,
  (date_trunc('week', current_date) + interval '6 days')::date, null, null, null);

explain (analyze, buffers, timing)
select * from public.deck_totals
 where kind = 'defaulter'
   and snapshot_date >= (date_trunc('week', current_date))::date
   and snapshot_date <= (date_trunc('week', current_date) + interval '6 days')::date;


-- =====================================================================================
-- TO GO BACK, IF IT EVER MISBEHAVES. The code checks for these tables on every read and
-- falls through to the live aggregate when they are not there, so this is the whole undo:
--
--   drop table if exists public.deck_totals, public.deck_totals_days;
--   drop function if exists public.build_deck_totals_recent(int, int);
--   drop function if exists public.build_deck_totals(text, date, date);
-- =====================================================================================
