-- =====================================================================================
-- RUN-ME-032 -- RECOVERY OVER A PERIOD: THE INITIAL DECK AT ITS START, THE CURRENT DECK AT ITS END
-- =====================================================================================
--
--   "recovery is initial and current only from latest uploads - everywhere"
--   "The rule must be the latest uploaded file on type of report ... latest file by date picked"
--
-- WHAT THE BOOK LOOKS LIKE (measured 2026-09-22): the WHOLE BOOK -- about 9,300 defaulters,
-- every team -- goes up as the INITIAL file every morning, and it is the previous evening's
-- CURRENT file (Sunday's initial is row for row Saturday's current). The CURRENT file goes up
-- every evening, often twice. So "latest initial minus latest current" is one day's movement
-- and can never be a week; and adding the days up counts the morning re-upload's corrections
-- as recovery. What a period's recovery IS: where each customer stood on the morning the
-- period began, less where they stand on the latest evening file.
--
-- WHAT THIS ANSWERS, for each (from, as_of) period asked and a team scope:
--
--   INITIAL   per team, the latest INITIAL deck dated on or before FROM (within the lookback),
--             the latest upload on it -- the batch rule every reader uses -- one row per customer
--   CURRENT   the latest CURRENT deck the company holds on or before AS_OF (latest picked date,
--             latest upload per team on it), one row per customer; a customer not on it owes
--             nothing; a team missing from it owes nothing
--   RECOVERED initial minus current, per team, plus the headcounts and how many customers on
--             the initial side are no longer on the current side ("cleared")
--
--   A day's card asks (d, d): this morning's file against this evening's. The week asks
--   (Monday, its end): Monday morning against the latest evening. The month asks (the 1st,
--   today). A repair is an upload with the date picked -- the latest upload on that date wins.
--
-- WHY IN THE DATABASE: this is a per-customer question over up to 45 days of decks. Asking
-- the web server for those rows on every dashboard, every commission board and every phone
-- summary is the read this system was rebuilt to stop making (RUN-ME-022). Answered here it
-- is one call per screen, and the answer is cached per scope for a minute on the server.
-- Each deck that any period needs is read ONCE, straight off the index; JIT is off for the
-- function (the compile alone cost over a second on a query this wide); `materialized` keeps
-- the planner from inlining the small sets and guessing one row each.
--
-- Paste the whole file into the SQL editor and run it once. Safe to re-run (it replaces the
-- earlier recovery_standing(date[], text[], int) as well). Until it is run, every screen keeps
-- the day-pairing rule it had and says which file to run; if the function fails, the note
-- carries the database's own words, and the dashboard's diagnosis card times it on its own.
-- =====================================================================================

drop function if exists public.recovery_standing(date[], text[], int);
drop function if exists public.recovery_standing(date[], date[], text[], int);

create or replace function public.recovery_standing(p_from date[], p_to date[], p_teams text[] default null, p_lookback int default 45)
returns table (
  from_date date, as_of date, team text, initial numeric, current numeric, recovered numeric,
  initial_customers int, current_customers int, cleared int, initial_dates text, current_deck date
)
language sql stable set jit = off as $$
with p as materialized (
  select distinct u.f as from_date, u.t as as_of
  from unnest(p_from, p_to) as u(f, t)
  where u.f is not null and u.t is not null
),
span as materialized (
  select min(from_date) - p_lookback as lo, max(from_date) as hi from p
),
-- 1. every INITIAL deck date per team-and-weekday in the window, listed once (index-only,
--    a few thousand rows off idx_def_snap_lookup).
ini_dates as materialized (
  select distinct s.team, s.weekday, s.snapshot_date
  from public.defaulter_snapshots s, span
  where s.snapshot_type = 'initial'
    and s.snapshot_date >= span.lo
    and s.snapshot_date <= span.hi
    and (p_teams is null or s.team = any(p_teams))
),
-- 2. per period START and team-and-weekday: the latest deck on or before it, within the
--    lookback -- the same grouping defaulterBook's export reading uses, so a team whose
--    Thursday deck has not been re-uploaded since still carries it.
ini_deck as materialized (
  select p.from_date, k.team, k.weekday, max(k.snapshot_date) as deck_date
  from p
  join ini_dates k
    on k.snapshot_date <= p.from_date
   and k.snapshot_date >= p.from_date - p_lookback
  group by p.from_date, k.team, k.weekday
),
-- 3. each initial deck that won, read ONCE off the index (lateral: one index lookup per
--    deck): the upload that won on it (newest created_at, then batch id -- the batch rule
--    every reader uses), then one row per customer on that upload
ini_win as materialized (
  select distinct team, weekday, deck_date from ini_deck
),
ini_cust as materialized (
  select w.team, w.weekday, w.deck_date, x.ref, x.arrears, x.created_at
  from ini_win w
  cross join lateral (
    select distinct on (y.ref) y.ref, y.arrears, y.created_at
    from (
      select s.ref, s.arrears, s.upload_batch, s.created_at,
             first_value(s.upload_batch) over (order by s.created_at desc nulls last, s.upload_batch desc nulls last) as win_batch
      from public.defaulter_snapshots s
      where s.snapshot_type = 'initial'
        and s.snapshot_date = w.deck_date
        and s.team = w.team
        and ((w.weekday is not null and s.weekday = w.weekday) or (w.weekday is null and s.weekday is null))
    ) y
    where y.upload_batch is not distinct from y.win_batch
    order by y.ref, y.created_at desc nulls last
  ) x
),
-- 4. per period start: ONE ROW PER CUSTOMER across the team-and-weekday decks picked for it
--    -- their newest. A customer on more than one of those decks (their own team re-uploaded
--    on two different weekdays) counts once.
ini_rows as materialized (
  select k.from_date, c.ref,
         (array_agg(c.team    order by c.deck_date desc, c.created_at desc nulls last))[1] as team,
         (array_agg(c.arrears order by c.deck_date desc, c.created_at desc nulls last))[1] as arrears,
         max(c.deck_date) as snapshot_date
  from ini_deck k
  join ini_cust c
    on c.team = k.team
   and c.weekday is not distinct from k.weekday
   and c.deck_date = k.deck_date
  group by k.from_date, c.ref
),
-- 5. the latest CURRENT deck the company holds on or before each period END (not narrowed by
--    team: the file is the whole book, and a team missing from it owes nothing on it). No
--    lookback on this side: "the latest current defaulter file is to live until the next one,
--    no limit" (defaulterBook, portal-core.js). One max() per date, then each deck read ONCE,
--    the winning upload picked per team-and-weekday on it (the batch rule, not the deck pick).
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
-- 6. per period and team: what the initial decks' customers owed, and how many of them are
--    gone from the current deck the period's end reads (an end with no current deck at all
--    is not measured: no rows)
ini_agg as materialized (
  select p.from_date, p.as_of, i.team,
         sum(i.arrears) as initial,
         count(*) as initial_customers,
         count(*) filter (where cc.ref is null) as cleared,
         string_agg(distinct i.snapshot_date::text, ', ') as initial_dates
  from p
  join ini_rows i on i.from_date = p.from_date
  join cur_date c on c.as_of = p.as_of and c.deck_date is not null
  left join cur_cust cc on cc.deck_date = c.deck_date and cc.ref = i.ref
  group by p.from_date, p.as_of, i.team
),
-- 7. what each team owes on each current deck: everyone on it, new customers included
cur_team as materialized (
  select deck_date, team, sum(arrears) as current, count(*) as current_customers
  from cur_cust
  group by deck_date, team
)
-- 8. per period and team: initial less current. A team with no initial deck on or before the
--    period's start (within the lookback) is not here at all -- its current rows alone would
--    read as a negative recovery against an initial nobody uploaded.
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
