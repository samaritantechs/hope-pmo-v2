-- =====================================================================================
-- RUN-ME-032 -- RECOVERY IS THE LATEST INITIAL DECK MINUS THE LATEST CURRENT DECK. EVERYWHERE.
-- =====================================================================================
--
--   "recovery is initial and current only from latest uploads - everywhere"
--   "The rule must be the latest uploaded file on type of report ... latest file by date picked"
--
-- WHAT THIS ANSWERS, for a date D and a team scope, exactly as the upload page's export does:
--
--   INITIAL   every customer's newest row on the latest INITIAL deck of each team-and-weekday
--             (the deck's latest picked date within the lookback, the latest upload on that
--             date per team -- the batch rule every reader uses), one row per customer
--   CURRENT   the latest CURRENT deck the company holds as of D (latest picked date, latest
--             upload per team on it), one row per customer; a customer not on it owes nothing
--   RECOVERED initial minus current, per team, plus the headcounts and how many customers on
--             the initial side are no longer on the current side ("cleared")
--
-- WHY IN THE DATABASE: this is a per-customer question over up to 45 days of decks. Asking
-- the web server for those rows on every dashboard, every commission board and every phone
-- summary is the read this system was rebuilt to stop making (RUN-ME-022). Answered here it
-- is one call per screen, and the answer is cached per scope for a minute on the server.
--
-- Paste the whole file into the SQL editor and run it once. Safe to re-run. Until it is run,
-- every screen keeps the day-pairing rule it has today and says which file to run.
--
-- v2 (2026-09-22): the first cut walked the whole 45-day window of initial rows ONCE PER DATE
-- ASKED (nine dates on the dashboard: nine scans of over a million rows) and timed out on the
-- live book, and the screen read that timeout as "not installed". This one:
--   - lists the decks in the window once (a few thousand rows, off the (type, weekday, date,
--     team) index) and picks the winning date per team-and-weekday per date from that list;
--   - reads each deck that won ONCE, straight off the index -- its winning upload, then one
--     row per customer on it -- and works each (initial deck, current deck) pair out once,
--     so dates that share decks share the answer instead of repeating it per customer;
--   - asks the index for one current-deck date per as-of.
--   A customer who sits on two weekday decks of a team is counted on each, exactly as the
--   export lists them. Measured on a synthetic book of 1.1m initial and 5.2m current rows
--   (five times the live current deck), nine dates at once: 14.3 s before, 3.7 s after;
--   0.9 s on an eight-team scope, 0.2 s for one date and two teams. JIT is off for it: the
--   compile alone cost over a second on a query this wide.
--   `materialized` keeps the planner from inlining the small sets and guessing one row each.
-- If a screen still shows the note, the dashboard's diagnosis card ("Imeshindikana") now
-- times this function on its own and prints what the database said.
-- =====================================================================================

create or replace function public.recovery_standing(p_dates date[], p_teams text[] default null, p_lookback int default 45)
returns table (
  as_of date, team text, initial numeric, current numeric, recovered numeric,
  initial_customers int, current_customers int, cleared int, initial_dates text, current_deck date
)
language sql stable set jit = off as $$
with d as materialized (
  select distinct unnest(p_dates) as as_of
),
span as materialized (
  select min(as_of) - p_lookback as lo, max(as_of) as hi from d
),
-- 1. every INITIAL deck in the window, listed once: team, weekday, date. Index-only off
--    idx_def_snap_lookup (snapshot_type, weekday, snapshot_date, team); a few thousand rows.
decks as materialized (
  select distinct s.team, s.weekday, s.snapshot_date
  from public.defaulter_snapshots s, span
  where s.snapshot_type = 'initial'
    and s.snapshot_date >= span.lo
    and s.snapshot_date <= span.hi
    and (p_teams is null or s.team = any(p_teams))
),
-- 2. the latest deck per team-and-weekday as of each date, within the lookback, off that list
ini_decks as materialized (
  select d.as_of, k.team, k.weekday, max(k.snapshot_date) as deck_date
  from d
  join decks k
    on k.snapshot_date <= d.as_of
   and k.snapshot_date >= d.as_of - p_lookback
  group by d.as_of, k.team, k.weekday
),
-- 3. each deck that won, read ONCE, straight off the index (lateral: one index lookup per
--    deck, never a scan of the table): the upload that won on it (newest created_at, then
--    batch id -- the batch rule every reader uses), then one row per customer on that upload
ini_win as materialized (
  select distinct team, weekday, deck_date from ini_decks
),
ini_cust as materialized (
  select w.team, w.weekday, w.deck_date, x.ref, x.arrears
  from ini_win w
  cross join lateral (
    select distinct on (y.ref) y.ref, y.arrears
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
-- 4. the latest CURRENT deck the company holds as of each date (not narrowed by team: the
--    file is the whole book, and a team missing from it owes nothing on it). No lookback on
--    this side, exactly as the upload page's export reads it: "the latest current defaulter
--    file is to live until the next one, no limit" (defaulterBook, portal-core.js). One
--    max() per date, answered off idx_def_snap_date_type; then each deck read ONCE, as above,
--    the winning upload picked per team-and-weekday on it.
cur_date as materialized (
  select d.as_of,
         (select max(s.snapshot_date) from public.defaulter_snapshots s
           where s.snapshot_type = 'current' and s.snapshot_date <= d.as_of) as deck_date
  from d
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
-- 5. each (initial deck, current deck) pair that any date needs, worked out ONCE: the deck's
--    arrears and headcount, and how many of its customers are gone from that current deck.
--    Two dates that share the same decks share the same answer instead of repeating it.
pair as materialized (
  select distinct k.team, k.weekday, k.deck_date, c.deck_date as cur_deck
  from ini_decks k
  join cur_date c on c.as_of = k.as_of
  where c.deck_date is not null
),
pair_agg as materialized (
  select p.team, p.weekday, p.deck_date, p.cur_deck,
         sum(i.arrears) as initial,
         count(*) as initial_customers,
         count(*) filter (where cc.ref is null) as cleared
  from pair p
  join ini_cust i
    on i.team = p.team
   and i.weekday is not distinct from p.weekday
   and i.deck_date = p.deck_date
  left join cur_cust cc
    on cc.deck_date = p.cur_deck
   and cc.ref = i.ref
  group by p.team, p.weekday, p.deck_date, p.cur_deck
),
-- 6. what each team owes on each current deck: everyone on it, new customers included
cur_team as materialized (
  select deck_date, team, sum(arrears) as current, count(*) as current_customers
  from cur_cust
  group by deck_date, team
)
-- 7. per date and team: the decks picked, added; less the team's current; the headcounts
select k.as_of, k.team,
       sum(pa.initial)::numeric as initial,
       coalesce(max(ct.current), 0)::numeric as current,
       (sum(pa.initial) - coalesce(max(ct.current), 0))::numeric as recovered,
       sum(pa.initial_customers)::int as initial_customers,
       coalesce(max(ct.current_customers), 0)::int as current_customers,
       sum(pa.cleared)::int as cleared,
       string_agg(distinct k.deck_date::text, ', ') as initial_dates,
       c.deck_date as current_deck
from ini_decks k
-- a date with no current deck at all is not measured -- no rows, never "everything recovered";
-- and a team with no initial deck within the lookback is not measured either (it is not in
-- ini_decks) -- its current rows alone would read as a negative recovery against nothing
join cur_date c on c.as_of = k.as_of and c.deck_date is not null
join pair_agg pa
  on pa.team = k.team
 and pa.weekday is not distinct from k.weekday
 and pa.deck_date = k.deck_date
 and pa.cur_deck = c.deck_date
left join cur_team ct on ct.deck_date = c.deck_date and ct.team = k.team
group by k.as_of, k.team, c.deck_date
order by k.as_of, k.team;
$$;

grant execute on function public.recovery_standing(date[], text[], int) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
