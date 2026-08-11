-- =====================================================================================
-- EIGHT ROUND TRIPS TO COUNT ONE COLUMN.
--
-- The dashboard's pipeline funnel needs the number of loans at each stage. It asked for them
-- ONE STAGE AT A TIME:
--
--     select count(*) from loans where stage = 'unassigned'
--     select count(*) from loans where stage = 'assigned'
--     ... eight times, sequentially, on every dashboard load
--
-- Sequential is right -- a wave of concurrent requests took this system down once and the note
-- in api/_lib/supabase.js is there so nobody tries it again -- but eight journeys is eight
-- journeys, and this is the screen the directors open. Measured on a forty-team book: the
-- dashboard made 19 round trips, and NINE of them were this table.
--
-- A count grouped by a column is the oldest thing a database does. One journey, eight integers,
-- no rows on the wire.
--
-- TEAM SCOPING STAYS AT THE DATABASE. p_teams null means every team, matching the access-code
-- convention used everywhere else in this system; a scoped officer gets their own teams counted
-- and never sees a total that includes somebody else's.
--
-- SAFE TO RE-RUN. Like every migration here, and OPTIONAL like every migration here: without it
-- the dashboard falls back to the eight counts it has always made, and nothing breaks.
-- =====================================================================================

create or replace function loan_stage_counts(p_teams text[] default null)
returns table (stage text, n bigint)
language sql
stable
as $$
  select l.stage::text, count(*)::bigint
  from loans l
  where p_teams is null or upper(l.team) = any (select upper(t) from unnest(p_teams) t)
  group by l.stage
$$;

-- The funnel filters on stage and scopes on team, so that is the index it wants.
create index if not exists loans_stage_team_idx on loans (stage, team);
