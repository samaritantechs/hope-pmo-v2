-- =====================================================================================
-- RUN-ME-032 -- RECOVERY: THE LATEST INITIAL UPLOAD, MINUS THE LATEST CURRENT UPLOAD
-- =====================================================================================
--
--   "recovery is initial and current only from latest uploads - everywhere"
--   "The rule must be the latest uploaded file on type of report ... latest file by date picked"
--   "recovered is just initial - current of latest uploads of those files"
--
-- v5 THROUGH v7 CHASED A DIFFERENT, MORE COMPLICATED QUESTION THAN THE ONE ASKED. They
-- resolved the initial side PER CUSTOMER, reaching up to 45 days back for anyone missing from
-- a specific day's own file -- built to answer "how much does the company currently owe",
-- where reaching back is right: a customer's baseline should not vanish because their team's
-- upload rotation happened to skip a day. But recovery_standing answers a DIFFERENT question --
-- "what did ONE upload say, minus what did the NEXT one say" -- and reaching back for THAT
-- question is exactly wrong: a customer absent from today's file, whose own last row was from
-- 12 days ago, is not "recovered today" -- if they also do not appear in today's current file,
-- that customer's real clearing happened SOMETIME IN THOSE 12 DAYS, and crediting the whole
-- amount to today counts up to six weeks of clearings as one day's number.
--
-- MEASURED ON THE REAL BOOK (2026-09-24): for Monday 2026-09-21 alone, the per-customer
-- lookback pulled in 11,480 "initial" customers where Monday's own file held 9,331 -- 2,149
-- reached back from other days. 2,223 of them read as "cleared" that one day, when a direct
-- count of who is actually missing from the current book found only 74. The gap is almost
-- exactly the reached-back count: stale baselines, misattributed whole to a single day. A
-- number that had always read 7-18 million a day read 90-107 million for exactly as long as
-- this reach-back was in the query -- confirmed by the person who reads this figure daily,
-- against their own memory of every day before it.
--
-- v8 DROPS THE LOOKBACK. INITIAL now reads exactly the way CURRENT already did (see the
-- current side's own note below, unchanged since it was built): the single latest date the
-- WHOLE COMPANY holds an initial file for, on or before FROM -- not per team, not per
-- customer, not reached back. A team whose own file has not landed yet for that date owes
-- nothing on it, the same trade already accepted on the current side after "i bulked paid
-- clients, many of them brother!". Both sides are now the same rule, applied twice: the latest
-- upload of each type, subtracted. p_lookback is kept as a parameter (existing callers pass
-- it) but no longer used by either side -- nothing reaches back any more.
--
-- WEEKDAY IS STILL NOT A STABLE FACT ABOUT A CUSTOMER (see v4->v5's own history, kept because
-- the reasoning still matters even though the fix has changed shape): batch resolution is
-- per (team, weekday) on whichever ONE date wins, never per weekday-grouped DATE choice --
-- there is only one date now, company-wide, so that particular failure mode cannot recur.
--
-- WHY IN THE DATABASE: this is still a whole-company question read by every dashboard, every
-- commission board and every phone summary. Answered here it is one call per screen, cached
-- per scope for a minute on the server.
--
-- Paste the whole file into the SQL editor and run it once, and RUN-ME-034 too (either order;
-- RUN-ME-034's covering index still helps the current side's own scan, though the initial side
-- no longer needs it the way the lookback version did). Safe to re-run. Until it is run, every
-- screen keeps the day-pairing rule it had and says which file to run; if the function fails,
-- the note carries the database's own words, and the dashboard's diagnosis card times it on
-- its own.
-- =====================================================================================

drop function if exists public.recovery_standing(date[], text[], int);
drop function if exists public.recovery_standing(date[], date[], text[], int);

create or replace function public.recovery_standing(p_from date[], p_to date[], p_teams text[] default null, p_lookback int default 45)
returns table (
  from_date date, as_of date, team text, initial numeric, current numeric, recovered numeric,
  initial_customers int, current_customers int, cleared int, initial_dates text, current_deck date
)
language sql stable set jit = off set enable_bitmapscan = off set enable_seqscan = off as $$
with p as materialized (
  select distinct u.f as from_date, u.t as as_of
  from unnest(p_from, p_to) as u(f, t)
  where u.f is not null and u.t is not null
),
-- 1. the latest INITIAL deck the company holds on or before each period START (not narrowed
--    by team: the file is the whole book, and a team missing from it owes nothing on it, the
--    same rule the current side already used). One max() per date, then each deck read ONCE,
--    the winning upload picked per team-and-weekday on it (the batch rule, not the deck pick).
ini_date as materialized (
  select distinct p.from_date,
         (select max(s.snapshot_date) from public.defaulter_snapshots s
           where s.snapshot_type = 'initial' and s.snapshot_date <= p.from_date) as deck_date
  from p
),
ini_win as materialized (
  select distinct deck_date from ini_date where deck_date is not null
),
ini_cust as materialized (
  select w.deck_date, x.ref, x.team, x.arrears
  from ini_win w
  cross join lateral (
    select distinct on (y.ref) y.ref, y.team, y.arrears
    from (
      select s.ref, s.team, s.arrears, s.upload_batch, s.created_at,
             first_value(s.upload_batch) over (partition by s.team, s.weekday
               order by s.created_at desc nulls last, s.upload_batch desc nulls last) as win_batch
      from public.defaulter_snapshots s
      where s.snapshot_type = 'initial'
        and s.snapshot_date = w.deck_date
        and (p_teams is null or s.team = any(p_teams))
    ) y
    where y.upload_batch is not distinct from y.win_batch
    order by y.ref, y.created_at desc nulls last
  ) x
),
-- 2. the latest CURRENT deck the company holds on or before each period END -- unchanged from
--    every earlier version: "the latest current defaulter file is to live until the next one,
--    no limit" (defaulterBook, portal-core.js).
cur_date as materialized (
  select distinct p.as_of,
         (select max(s.snapshot_date) from public.defaulter_snapshots s
           where s.snapshot_type = 'current' and s.snapshot_date <= p.as_of) as deck_date
  from p
),
cur_win as materialized (
  select distinct deck_date from cur_date where deck_date is not null
),
cur_cust as materialized (
  select w.deck_date, x.ref, x.team, x.arrears
  from cur_win w
  cross join lateral (
    select distinct on (y.ref) y.ref, y.team, y.arrears
    from (
      select s.ref, s.team, s.arrears, s.upload_batch, s.created_at,
             first_value(s.upload_batch) over (partition by s.team, s.weekday
               order by s.created_at desc nulls last, s.upload_batch desc nulls last) as win_batch
      from public.defaulter_snapshots s
      where s.snapshot_type = 'current'
        and s.snapshot_date = w.deck_date
        and (p_teams is null or s.team = any(p_teams))
    ) y
    where y.upload_batch is not distinct from y.win_batch
    order by y.ref, y.created_at desc nulls last
  ) x
),
-- 3. per period and team: what the initial deck's customers owed, and how many of them are
--    gone from the current deck the period's end reads (an end with no current deck at all,
--    or a start with no initial deck at all, is not measured: no rows)
ini_agg as materialized (
  select p.from_date, p.as_of, ic.team,
         sum(ic.arrears) as initial,
         count(*) as initial_customers,
         count(*) filter (where cc.ref is null) as cleared,
         id.deck_date::text as initial_dates
  from p
  join ini_date id on id.from_date = p.from_date and id.deck_date is not null
  join ini_cust ic on ic.deck_date = id.deck_date
  join cur_date c on c.as_of = p.as_of and c.deck_date is not null
  left join cur_cust cc on cc.deck_date = c.deck_date and cc.ref = ic.ref
  group by p.from_date, p.as_of, ic.team, id.deck_date
),
-- 4. what each team owes on each current deck: everyone on it, new customers included
cur_team as materialized (
  select deck_date, team, sum(arrears) as current, count(*) as current_customers
  from cur_cust
  group by deck_date, team
)
-- 5. per period and team: initial less current. A team with no initial deck on or before the
--    period's start is not here at all -- its current rows alone would read as a negative
--    recovery against an initial nobody uploaded.
select a.from_date, a.as_of, a.team,
       a.initial::numeric as initial,
       coalesce(ct.current, 0)::numeric as current,
       (a.initial - coalesce(ct.current, 0))::numeric as recovered,
       a.initial_customers::int as initial_customers,
       coalesce(ct.current_customers, 0)::int as current_customers,
       a.cleared::int as cleared,
       a.initial_dates,
       c.deck_date as current_deck
from ini_agg a
join cur_date c on c.as_of = a.as_of
left join cur_team ct on ct.deck_date = c.deck_date and ct.team = a.team
order by a.from_date, a.as_of, a.team;
$$;

grant execute on function public.recovery_standing(date[], date[], text[], int) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
