-- =====================================================================================
-- RUN-ME-009 -- restore each team's real bike officer from their access codes.
-- Paste into the Supabase SQL editor and run. Safe to re-run: a second pass finds
-- nothing left to change.
--
-- WHAT HAPPENED. A bike SUPERVISOR was created through Teams & Staff with every team
-- ticked -- and that screen writes the given name into teams.bike for every ticked team.
-- One save overwrote the real bike officer's name on every team at once. Renaming the
-- supervisor's role afterwards changed nothing: the names were already gone from the
-- teams table, and the customers' screens read that table.
--
-- THE RECOVERY. Every real bike officer still has an access code: role BIKE, their own
-- name, their own team list. Statement 1 writes those names back into teams.bike,
-- team by team. Phone numbers need no recovery -- the portal always overlays numbers
-- from the call app registrations BY NAME (a number from the app beats a number from
-- the sheet), so the moment the names are right, the numbers follow on their own.
-- Screens pick the repaired names up within a minute (the teams cache).
-- =====================================================================================

-- 1) Each bike access code's name goes back onto its own teams.
--    The guard on cardinality means a code with NO team list (= ALL teams -- the very
--    shape that caused the accident) writes nothing, so this can never repeat it.
with bike_codes as (
  select ac.name, upper(btrim(t)) as team
  from access_codes ac
  cross join lateral unnest(ac.teams) as t
  where upper(coalesce(ac.role, '')) like '%BIKE%'
    and ac.teams is not null and cardinality(ac.teams) > 0
    and coalesce(btrim(ac.name), '') <> ''
)
update teams tm
set bike = bc.name, updated_at = now()
from bike_codes bc
where upper(btrim(tm.team)) = bc.team
  and tm.bike is distinct from bc.name;

-- 2) OPTIONAL CLEANUP -- teams that have no bike access code are still wearing the
--    supervisor's name after statement 1. To clear those, put his EXACT name between
--    the quotes below and remove the leading "-- " from the two lines. Left commented
--    out on purpose: only you know the name, and nulling by guesswork is how this kind
--    of accident happens in the first place.
--
-- update teams set bike = null, updated_at = now()
--   where upper(btrim(coalesce(bike, ''))) = upper(btrim('SUPERVISOR NAME HERE'));

-- 3) See the result at a glance before closing the editor.
select team, bike from teams order by team;
