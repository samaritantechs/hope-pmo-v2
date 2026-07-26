-- =====================================================================================
-- TEAM CODES -- the everyday sign-in for field officers.
--
-- A per-officer passcode is the tightest control, but it does not match how this operation
-- actually runs: officers join, leave and swap teams constantly, and the PMO needs to hand
-- someone a working code on the spot without opening an admin screen first.
--
-- So each TEAM carries a code. An officer signs in with their phone number, their name and
-- their team's code. The code says WHICH TEAM they may see; the phone says WHO THEY ARE, so
-- call attribution, watermarks and per-officer reports all keep working exactly as before --
-- a shared code does not mean a shared identity.
--
-- Unlike officer passcodes, a team code is stored in CLEAR TEXT and shown in Teams & Staff.
-- That is deliberate and it is the point: the PMO has to be able to read a code out over the
-- phone, and change it the moment one leaks. A hashed code could be rotated but never read,
-- which would make it useless for the job it is doing here. The tradeoff is that anyone who
-- can see the Teams & Staff screen can see every team code -- that screen already requires
-- the settings permission, and already lists every supervisor by name.
--
-- Rotating a code releases every handset on that team, which is exactly what "someone left,
-- change the code" has to mean. To cut ONE person without disturbing their colleagues,
-- switch that officer's account off instead (Settings -> Field officer accounts).
-- =====================================================================================

alter table teams add column if not exists team_code text;

-- Every existing team gets a random starting code so no team is left open after the deploy.
-- No 0/O or 1/I/L: these get read aloud over the phone and misread characters become
-- support calls, and support calls get "solved" by sharing a colleague's working code.
update teams
set team_code = (
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ',
                           1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 6)
)
where team_code is null or btrim(team_code) = '';

-- Two teams sharing a code would silently put officers on the wrong book.
create unique index if not exists idx_teams_code on teams(upper(btrim(team_code)))
  where team_code is not null and btrim(team_code) <> '';
