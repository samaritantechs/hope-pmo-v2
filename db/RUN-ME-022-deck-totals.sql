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
-- RUN SECTIONS 1-3 NOW (they are instant), THEN SECTION 4 REPEATEDLY UNTIL IT SAYS 0.
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


-- 3. THE BACKFILL, A FEW DAYS AT A TIME, NEWEST FIRST.
--    Newest first because the newest days are the ones every screen reads. Bounded so one run
--    cannot sit past a timeout on a slow instance, and resumable: it only ever picks days that
--    are not built yet, so running it again simply carries on.
create or replace function public.build_deck_totals_recent(p_days int default 6, p_back int default 120)
returns table (kind text, day date, rows_built bigint, days_left bigint)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare r record; n bigint;
begin
  for r in
    with have as (
      select 'expected'::text as k, s.snapshot_date as d
        from public.repayment_snapshots s
       where s.snapshot_date >= current_date - p_back
       group by s.snapshot_date
      union all
      select 'defaulter'::text, s.snapshot_date
        from public.defaulter_snapshots s
       where s.snapshot_date >= current_date - p_back
       group by s.snapshot_date
    )
    select h.k, h.d
      from have h
      left join public.deck_totals_days b on b.kind = h.k and b.snapshot_date = h.d
     where b.snapshot_date is null
     order by h.d desc, h.k
     limit p_days
  loop
    n := public.build_deck_totals(r.k, r.d, r.d);
    kind := r.k; day := r.d; rows_built := n;
    days_left := (
      with have as (
        select 'expected'::text as k, s.snapshot_date as d
          from public.repayment_snapshots s
         where s.snapshot_date >= current_date - p_back
         group by s.snapshot_date
        union all
        select 'defaulter'::text, s.snapshot_date
          from public.defaulter_snapshots s
         where s.snapshot_date >= current_date - p_back
         group by s.snapshot_date
      )
      select count(*) from have h
        left join public.deck_totals_days b on b.kind = h.k and b.snapshot_date = h.d
       where b.snapshot_date is null);
    return next;
  end loop;
end;
$$;


-- 4. RUN THIS, THEN RUN IT AGAIN, UNTIL days_left IS 0.
--    Each call builds six days. On this instance expect roughly ten to thirty seconds a call.
--    Nothing is broken while it runs: a day not yet built is simply read the old way.
select * from public.build_deck_totals_recent(6);


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
