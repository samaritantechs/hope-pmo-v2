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
-- switch that officer's account off in Settings -> Field officer accounts.
--
-- SAFE TO RE-RUN. The first version of this file was wrong: it generated the code in an
-- UNCORRELATED subquery, so Postgres evaluated it once and handed EVERY team the same code,
-- and the unique index below then refused to build. This version derives the code from the
-- row (t.team), so it is computed per row, and it repairs any duplicates a previous run
-- left behind before creating the index.
-- =====================================================================================

alter table teams add column if not exists team_code text;

-- 1. Clear any code that is shared by more than one team, including the identical codes the
--    broken first version wrote. These have to go before a unique index can exist.
update teams
set team_code = null
where team_code is not null
  and upper(btrim(team_code)) in (
    select upper(btrim(team_code)) from teams
    where team_code is not null and btrim(team_code) <> ''
    group by upper(btrim(team_code)) having count(*) > 1
  );

-- 2. Give every team without a code a unique random one.
--
--    Uniqueness is STRUCTURAL, not a matter of luck: the last two characters encode the row's
--    position in base 31, so no two rows can collide no matter what the random prefix does
--    (good for 961 teams). The first four come from md5 over the team name plus random() and
--    clock_timestamp(), so the code is not predictable from the team name.
--
--    The alphabet has no 0/O or 1/I/L. These codes get read aloud over the phone, and a
--    misread character becomes a support call -- which gets "solved" by sharing a colleague's
--    working code, which is the whole thing this is trying to prevent.
with numbered as (
  select team, row_number() over (order by team) - 1 as rn
  from teams
  where team_code is null or btrim(team_code) = ''
)
update teams t
set team_code =
      upper(translate(substr(md5(n.team || random()::text || clock_timestamp()::text), 1, 4),
                      '0123456789abcdef', '23456789ABCDEFGH'))
   || substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + (n.rn / 31)::int % 31, 1)
   || substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', 1 + (n.rn % 31)::int, 1)
from numbered n
where t.team = n.team;

-- 3. Two teams sharing a code would silently put officers on the wrong book.
create unique index if not exists idx_teams_code on teams(upper(btrim(team_code)))
  where team_code is not null and btrim(team_code) <> '';
