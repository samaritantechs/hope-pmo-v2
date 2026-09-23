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
--   INITIAL   per customer, their own latest INITIAL row dated on or before FROM (within the
--             lookback), the latest upload on it -- the batch rule every reader uses -- one
--             row per customer, whichever team and whatever weekday tag it carries
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
-- WEEKDAY IS NOT A STABLE FACT ABOUT A CUSTOMER, AND v4 TREATED IT AS ONE. v1-v4 grouped
-- decks by (team, weekday) and picked ONE shared "winning" date for the whole group, on the
-- theory that a customer's weekday tag was a fixed thing about them, the way it genuinely is
-- on the Expected Repayment sheet. It is not, here: the real book re-uploads most defaulters
-- daily, and the tag on each row is just whichever day of the week that particular upload
-- landed on -- so the same customer cycles through all seven tags as the calendar rolls
-- forward. Grouping by weekday meant a customer who simply was not in the file on their
-- team's one shared "peak" date for a tag fell out of the total entirely, even with a
-- perfectly good, recent file sitting inside the lookback under a different date. Measured on
-- the real book (2026-09-22): the group-wise total read 3,438,384,681; every customer's own
-- true latest, resolved person by person, was 3,511,832,777 -- 73 million of real, recent
-- arrears silently falling through the gap. v5 resolved the initial side per customer instead;
-- weekday is still stored and still read, but no longer decides which row wins.
--
-- v5 RESOLVED THE RIGHT ANSWER, ONE PERIOD AT A TIME, TOO SLOWLY FOR SEVERAL AT ONCE. It
-- ranked each customer's rows fresh for every period asked, by joining the periods against
-- defaulter_snapshots on a per-row range condition. A single day's card asks one period and
-- that cost about three seconds on the real book -- tolerable. The dashboard's weekly trend
-- asks for SEVEN, one per day, each carrying its own overlapping 45-day lookback, in one call
-- -- and v5 rescanned and re-sorted nearly the same six-week window seven times over to answer
-- them. Measured on the real book: 27.9 seconds, 818MB spilled to a temp file, long enough to
-- hit the role's statement_timeout and fall the whole reading back to the old day-pairing rule
-- -- "canceling statement due to statement timeout" -- exactly the "choosing nothing" v5 was
-- meant to end, just arriving as a timeout instead of a wrong number.
--
-- v6 RANKS EVERY CUSTOMER'S ROWS ONCE, over the union of every period's lookback window, not
-- once per period. That ranking becomes a validity INTERVAL per row -- lag() finds the date of
-- the next NEWER row for the same customer, so this row is the true answer for any from_date
-- from its own date up to (but not including) that newer row's date. This is the standard
-- as-of-join shape: several query points against one sorted timeline, answered from ONE pass
-- over it rather than one pass per point. ini_rows then joins the (few) periods asked against
-- these (few, one-per-customer-per-distinct-date) intervals -- cheap, because there is nothing
-- left to sort. The batch rule (an upload that stops naming somebody IS the correction) falls
-- out of the same interval for free: two rows sharing one snapshot_date rank back to back, so
-- the older batch's interval ends the day it began -- valid_to = valid_from - 1 -- and it can
-- never be anyone's answer, the same as it never reached rn = 1 under v5.
--
-- WHY IN THE DATABASE: this is a per-customer question over up to 45 days of decks. Asking
-- the web server for those rows on every dashboard, every commission board and every phone
-- summary is the read this system was rebuilt to stop making (RUN-ME-022). Answered here it
-- is one call per screen, and the answer is cached per scope for a minute on the server. JIT
-- is off for the function (the compile alone cost over a second on a query this wide);
-- `materialized` keeps the planner from inlining the small sets and guessing one row each.
--
-- Paste the whole file into the SQL editor and run it once. Safe to re-run (it replaces every
-- earlier signature of recovery_standing too). Until it is run, every screen keeps the
-- day-pairing rule it had and says which file to run; if the function fails, the note carries
-- the database's own words, and the dashboard's diagnosis card times it on its own.
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
-- 1. THE UNION WINDOW -- every period's own [from_date - lookback, from_date] is a sub-range of
--    this one, so one scan bounded by it covers every period asked, however many there are.
bounds as materialized (
  select min(from_date) - p_lookback as lo, max(from_date) as hi from p
),
-- 2-3. EVERY CUSTOMER'S OWN INITIAL ROWS IN THE UNION WINDOW, RANKED ONCE -- not per period,
--    never per team-and-weekday group (see the v4->v5 note above). Partitioned by ref ALONE,
--    not team-and-ref: a customer moved between teams counts once, under whichever team their
--    own single latest row actually names. idx_def_snap_date_type (snapshot_date, snapshot_type)
--    carries the type+range filter; weekday is read but never decides which row wins.
--
--    lag() looks BACKWARD along "newest first" (date desc) -- so for row i it returns the date
--    of the row immediately before it in that ordering, which is the NEXT NEWER row for the
--    same customer, or null when row i already is the newest. That is exactly the boundary a
--    validity interval needs (see ini_intervals below).
ini_ranked as materialized (
  select s.ref, s.team, s.arrears, s.snapshot_date,
         lag(s.snapshot_date) over (
           partition by s.ref
           order by s.snapshot_date desc, s.created_at desc nulls last, s.upload_batch desc nulls last
         ) as next_newer_date
  from bounds b
  join public.defaulter_snapshots s
    on s.snapshot_type = 'initial'
   and s.snapshot_date between b.lo and b.hi
   and (p_teams is null or s.team = any(p_teams))
),
-- 4. EACH ROW'S VALIDITY INTERVAL: the answer for any from_date from its own date up to (but
--    not including) the next newer row's date -- unbounded above when it IS the newest. Two
--    rows sharing one snapshot_date (a same-day correction) rank back to back, so the older
--    batch's next_newer_date equals its OWN date and its interval collapses to nothing
--    (valid_to = valid_from - 1): it can never win a from_date, the batch rule enforced by the
--    ranking itself rather than a separate filter.
ini_intervals as materialized (
  select ref, team, arrears, snapshot_date as valid_from,
         coalesce(next_newer_date - 1, 'infinity'::date) as valid_to
  from ini_ranked
),
-- 5. EACH PERIOD AGAINST THOSE INTERVALS -- cheap: one row per customer per distinct date, a
--    small set next to the raw table, and nothing left to sort. The lookback still applies per
--    PERIOD (least(...) below), because a row can be "the newest so far" and still be older
--    than this particular period's own 45-day window allows.
ini_rows as materialized (
  select p.from_date, ii.team, ii.ref, ii.arrears, ii.valid_from as snapshot_date
  from p
  join ini_intervals ii
    on p.from_date >= ii.valid_from
   and p.from_date <= least(ii.valid_to, ii.valid_from + p_lookback)
),
-- 6. the latest CURRENT deck the company holds on or before each period END (not narrowed by
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
-- 7. per period and team: what the initial decks' customers owed, and how many of them are
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
-- 8. what each team owes on each current deck: everyone on it, new customers included
cur_team as materialized (
  select deck_date, team, sum(arrears) as current, count(*) as current_customers
  from cur_cust
  group by deck_date, team
)
-- 9. per period and team: initial less current. A team with no initial deck on or before the
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
