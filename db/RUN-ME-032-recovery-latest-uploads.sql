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
--     row per customer on it -- and only then joins those per-deck sets to the dates asked;
--   - asks the index for one current-deck date per as-of.
--   JIT is off for it: the compile alone cost over a second on a query this wide.
-- v3 (2026-09-22): "initials aint reading well! Current arrears 3,412,547,121 / initial
-- upload: 23,760,795,812". The initial file carries the whole book and is uploaded on every
-- weekday's date, so a customer sits on all seven of the decks picked; v2 added the decks and
-- counted every customer seven times. ONE ROW PER CUSTOMER, their newest, as v1 had it and
-- as a per-customer lookup on the two exported files finds -- and as the customer list reads.
--   Checked row for row against the transcription on Postgres 16. Timed on a synthetic book
--   in the live shape (the whole book of 20,000 customers uploaded as the initial deck AND as
--   the current deck every working day for 60 days: 2.1m rows), the dashboard's nine dates at
--   once, all teams: 3.0 s; one date on a two-team scope: 0.2 s. Cached per scope per minute.
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
-- 5. per date: ONE ROW PER CUSTOMER across the decks picked for it -- their newest. The
--    initial file is uploaded again and again (every weekday's date carries the customers
--    it carries), so a customer is on several of the decks picked; adding the decks would
--    count them once per deck -- 23.7bn of "initial" against a 3.4bn book. Their newest row
--    is what they owed when last listed, and it is what a per-customer lookup on the two
--    exported files finds.
ini_rows as materialized (
  select k.as_of, c.ref,
         (array_agg(c.team    order by c.deck_date desc, c.created_at desc nulls last))[1] as team,
         (array_agg(c.arrears order by c.deck_date desc, c.created_at desc nulls last))[1] as arrears,
         max(c.deck_date) as snapshot_date
  from ini_decks k
  join ini_cust c
    on c.team = k.team
   and c.weekday is not distinct from k.weekday
   and c.deck_date = k.deck_date
  group by k.as_of, c.ref
),
-- 6. per date and team: what those customers owed, and how many are gone from the current
--    deck the date reads (a date with no current deck is not measured: no rows)
ini_agg as materialized (
  select i.as_of, i.team,
         sum(i.arrears) as initial,
         count(*) as initial_customers,
         count(*) filter (where cc.ref is null) as cleared,
         string_agg(distinct i.snapshot_date::text, ', ') as initial_dates
  from ini_rows i
  join cur_date c on c.as_of = i.as_of and c.deck_date is not null
  left join cur_cust cc on cc.deck_date = c.deck_date and cc.ref = i.ref
  group by i.as_of, i.team
),
-- 7. what each team owes on each current deck: everyone on it, new customers included
cur_team as materialized (
  select deck_date, team, sum(arrears) as current, count(*) as current_customers
  from cur_cust
  group by deck_date, team
)
-- 8. per date and team: initial less current. A team with no initial deck within the
--    lookback is not here at all -- its current rows alone would read as a negative
--    recovery against an initial nobody uploaded.
select a.as_of, a.team,
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
order by a.as_of, a.team;
$$;

grant execute on function public.recovery_standing(date[], text[], int) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
