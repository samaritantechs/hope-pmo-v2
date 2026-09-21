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
-- =====================================================================================

create or replace function public.recovery_standing(p_dates date[], p_teams text[] default null, p_lookback int default 45)
returns table (
  as_of date, team text, initial numeric, current numeric, recovered numeric,
  initial_customers int, current_customers int, cleared int, initial_dates text, current_deck date
)
language sql stable as $$
with d as (
  select distinct unnest(p_dates) as as_of
),
-- 1. the latest INITIAL deck per team-and-weekday as of each date, within the lookback
ini_decks as (
  select d.as_of, s.team, s.weekday, max(s.snapshot_date) as deck_date
  from d
  join public.defaulter_snapshots s
    on s.snapshot_type = 'initial'
   and s.snapshot_date <= d.as_of
   and s.snapshot_date >= d.as_of - p_lookback
  where p_teams is null or s.team = any(p_teams)
  group by d.as_of, s.team, s.weekday
),
-- 2. the upload that won on that date for that deck: newest created_at, then batch id
ini_batch as (
  select k.as_of, k.team, k.weekday, k.deck_date,
         (array_agg(s.upload_batch order by s.created_at desc nulls last, s.upload_batch desc nulls last))[1] as batch
  from ini_decks k
  join public.defaulter_snapshots s
    on s.snapshot_type = 'initial'
   and s.team = k.team
   and s.weekday is not distinct from k.weekday
   and s.snapshot_date = k.deck_date
  group by k.as_of, k.team, k.weekday, k.deck_date
),
-- 3. one row per customer across those decks: their newest initial row
ini_rows as (
  select distinct on (b.as_of, s.ref)
         b.as_of, s.ref, s.team, s.arrears, s.snapshot_date
  from ini_batch b
  join public.defaulter_snapshots s
    on s.snapshot_type = 'initial'
   and s.team = b.team
   and s.weekday is not distinct from b.weekday
   and s.snapshot_date = b.deck_date
   and s.upload_batch is not distinct from b.batch
  order by b.as_of, s.ref, s.snapshot_date desc, s.created_at desc nulls last
),
-- 4. the latest CURRENT deck the company holds as of each date (not narrowed by team: the
--    file is the whole book, and a team missing from it owes nothing on it). No lookback on
--    this side, exactly as the upload page's export reads it: "the latest current defaulter
--    file is to live until the next one, no limit" (defaulterBook, portal-core.js)
cur_date as (
  select d.as_of, max(s.snapshot_date) as deck_date
  from d
  left join public.defaulter_snapshots s
    on s.snapshot_type = 'current'
   and s.snapshot_date <= d.as_of
  group by d.as_of
),
cur_batch as (
  select c.as_of, c.deck_date, s.team, s.weekday,
         (array_agg(s.upload_batch order by s.created_at desc nulls last, s.upload_batch desc nulls last))[1] as batch
  from cur_date c
  join public.defaulter_snapshots s
    on s.snapshot_type = 'current'
   and s.snapshot_date = c.deck_date
  where c.deck_date is not null
    and (p_teams is null or s.team = any(p_teams))
  group by c.as_of, c.deck_date, s.team, s.weekday
),
cur_rows as (
  select distinct on (b.as_of, s.ref)
         b.as_of, s.ref, s.team, s.arrears
  from cur_batch b
  join public.defaulter_snapshots s
    on s.snapshot_type = 'current'
   and s.team = b.team
   and s.weekday is not distinct from b.weekday
   and s.snapshot_date = b.deck_date
   and s.upload_batch is not distinct from b.batch
  order by b.as_of, s.ref, s.created_at desc nulls last
),
-- 5. initial minus current, per customer, then per team
per_customer as (
  select coalesce(i.as_of, c.as_of) as as_of,
         coalesce(i.ref, c.ref) as ref,
         coalesce(i.team, c.team) as team,
         coalesce(i.arrears, 0) as initial,
         coalesce(c.arrears, 0) as current,
         (i.ref is not null) as on_initial,
         (c.ref is not null) as on_current,
         i.snapshot_date as ini_date
  from ini_rows i
  full outer join cur_rows c on c.as_of = i.as_of and c.ref = i.ref
)
select p.as_of, p.team,
       sum(p.initial)::numeric as initial,
       sum(p.current)::numeric as current,
       (sum(p.initial) - sum(p.current))::numeric as recovered,
       (count(*) filter (where p.on_initial))::int as initial_customers,
       (count(*) filter (where p.on_current))::int as current_customers,
       (count(*) filter (where p.on_initial and not p.on_current))::int as cleared,
       string_agg(distinct p.ini_date::text, ', ') as initial_dates,
       (select cd.deck_date from cur_date cd where cd.as_of = p.as_of) as current_deck
from per_customer p
-- a date with no current deck at all is not measured -- no rows, never "everything recovered"
where exists (select 1 from cur_date cd where cd.as_of = p.as_of and cd.deck_date is not null)
-- and a team with no initial deck within the lookback is not measured either -- its current
-- rows alone would read as a negative recovery against an initial nobody uploaded
  and exists (select 1 from ini_decks k where k.as_of = p.as_of and k.team = p.team)
group by p.as_of, p.team
order by p.as_of, p.team;
$$;

grant execute on function public.recovery_standing(date[], text[], int) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
