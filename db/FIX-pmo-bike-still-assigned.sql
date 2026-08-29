-- =====================================================================================
-- ASHIRAFU IS STILL BEING ASSIGNED CUSTOMERS AS A BIKE OFFICER.
--
-- WHY IT IS HAPPENING, exactly. The recycling rotation does NOT read anybody's access code
-- to decide who owns a defaulter. It picks a ROLE (BIKE / MANAGER / GMO) and then reads the
-- name out of the TEAMS TABLE's matching column -- teams.bike for a BIKE turn.
--
-- Saving an access code whose role is BIKE copies that person's name INTO teams.bike for
-- every team on the code (syncStaffFromCode, api/_lib/portal-core.js). Renaming the role
-- afterwards to PMO-BIKE does NOT undo it: PMO-BIKE matches no teams-table column, so the
-- sync decides it has nothing to do and returns before touching anything. ASHIRAFU's name
-- stays written in teams.bike, and the rotation keeps handing him bike customers.
--
-- So the repair is in the TEAMS table, not on his access code. Changing his role again, or
-- his teams, will not do it -- the row that is speaking has his name written inside it.
--
-- ⚠ READ STEP 2 BEFORE RUNNING STEP 3. If his name went across ALL teams, it OVERWROTE
-- whoever was the real bike officer on each of them, and those names are NOT recoverable
-- from the database -- clearing him leaves those teams with no bike officer at all. STEP 2
-- lists exactly which teams that is, so you can put the right people back in Teams & Staff.
-- Blanking is still correct: an empty bike column assigns nobody, which is visibly wrong on
-- screen, while his name assigns the wrong man silently.
--
-- HOW TO RUN: one step at a time, in order. Steps 0, 1, 2 change nothing.
-- =====================================================================================

-- ------------------------------------------------ STEP 0: WHERE HIS NAME APPEARS AT ALL
-- Matched loosely (contains ASHIRAFU), because the name may be stored with a surname or
-- extra spacing. Read the exact spelling in the results -- it should be the same person on
-- every row. If a DIFFERENT person's name also contains ASHIRAFU, stop and tell me: the
-- update below would catch them too and that needs a narrower rule.
select team, opm, recovery, gmo, manager, credit, expected, bike
from teams
where upper(coalesce(bike,     '')) like '%ASHIRAFU%'
   or upper(coalesce(manager,  '')) like '%ASHIRAFU%'
   or upper(coalesce(gmo,      '')) like '%ASHIRAFU%'
   or upper(coalesce(recovery, '')) like '%ASHIRAFU%'
   or upper(coalesce(opm,      '')) like '%ASHIRAFU%'
   or upper(coalesce(credit,   '')) like '%ASHIRAFU%'
   or upper(coalesce(expected, '')) like '%ASHIRAFU%'
order by team;

-- His access code, for the record. This is NOT what is assigning him -- it is only so you
-- can confirm the role really does read PMO-BIKE now.
select code, name, role, teams from access_codes where upper(name) like '%ASHIRAFU%';


-- ----------------------------------------- STEP 1: EVERY TEAM ROLE HE CURRENTLY HOLDS
-- One row per team-and-role he is written into. bike is the one causing the assignments;
-- if manager or gmo also appear, he is in those rotation turns as well (see STEP 4).
select t.team, 'bike' as role_column, t.bike as holder from teams t where upper(coalesce(t.bike,     '')) like '%ASHIRAFU%'
union all select t.team, 'manager',  t.manager  from teams t where upper(coalesce(t.manager,  '')) like '%ASHIRAFU%'
union all select t.team, 'gmo',      t.gmo      from teams t where upper(coalesce(t.gmo,      '')) like '%ASHIRAFU%'
union all select t.team, 'recovery', t.recovery from teams t where upper(coalesce(t.recovery, '')) like '%ASHIRAFU%'
union all select t.team, 'opm',      t.opm      from teams t where upper(coalesce(t.opm,      '')) like '%ASHIRAFU%'
union all select t.team, 'credit',   t.credit   from teams t where upper(coalesce(t.credit,   '')) like '%ASHIRAFU%'
union all select t.team, 'expected', t.expected from teams t where upper(coalesce(t.expected, '')) like '%ASHIRAFU%'
order by role_column, team;


-- ------------------------------- STEP 2: WHAT WILL BE LEFT WITHOUT A BIKE OFFICER ⚠
-- THE ONE TO ACTUALLY READ. Every team here has ASHIRAFU as its bike officer, which means
-- whoever was there before was overwritten and is gone. After STEP 3 these teams have NO
-- bike officer until you set the right person in Teams & Staff.
select t.team, t.bike as bike_now, '-> will become empty' as after_step_3
from teams t
where upper(coalesce(t.bike, '')) like '%ASHIRAFU%'
order by t.team;

-- How many that is, against the whole company.
select (select count(*) from teams where upper(coalesce(bike, '')) like '%ASHIRAFU%') as teams_he_holds_as_bike,
       (select count(*) from teams) as teams_in_total;


-- --------------------------------------------------------- STEP 3: TAKE HIM OFF BIKE
-- Only the bike column, and only rows that are him. Every other officer on every team is
-- untouched, and a team where somebody else holds bike is not affected at all.
-- Returns the rows it changed, so you can check it did exactly what STEP 2 predicted.
update teams
   set bike = null, updated_at = now()
 where upper(coalesce(bike, '')) like '%ASHIRAFU%'
returning team, bike as bike_after;


-- ------------------------- STEP 4: ONLY IF STEP 1 SHOWED HIM UNDER manager OR gmo TOO
-- He supervises bike officers, so bike is the expected one. If STEP 1 listed him under
-- manager or gmo as well, he is in those rotation turns too and the same repair applies.
-- Run ONLY the block for a column STEP 1 actually listed -- never run these blind.
--
-- update teams set manager = null, updated_at = now()
--  where upper(coalesce(manager, '')) like '%ASHIRAFU%' returning team;
--
-- update teams set gmo = null, updated_at = now()
--  where upper(coalesce(gmo, '')) like '%ASHIRAFU%' returning team;


-- ------------------------------------------------------------------ STEP 5: CONFIRM
-- Expect ZERO rows: he holds no team role any more, so the rotation cannot reach him.
select t.team, 'bike' as still_held from teams t where upper(coalesce(t.bike,     '')) like '%ASHIRAFU%'
union all select t.team, 'manager'  from teams t where upper(coalesce(t.manager,  '')) like '%ASHIRAFU%'
union all select t.team, 'gmo'      from teams t where upper(coalesce(t.gmo,      '')) like '%ASHIRAFU%'
union all select t.team, 'recovery' from teams t where upper(coalesce(t.recovery, '')) like '%ASHIRAFU%'
union all select t.team, 'opm'      from teams t where upper(coalesce(t.opm,      '')) like '%ASHIRAFU%'
union all select t.team, 'credit'   from teams t where upper(coalesce(t.credit,   '')) like '%ASHIRAFU%'
union all select t.team, 'expected' from teams t where upper(coalesce(t.expected, '')) like '%ASHIRAFU%';

-- Which teams now have no bike officer -- the list to work through in Teams & Staff.
select team from teams where coalesce(btrim(bike), '') = '' order by team;

-- =====================================================================================
-- AFTERWARDS. His access code keeps role PMO-BIKE and all-teams access, so he still SEES
-- everything he supervises -- that comes from the CODE, not from the teams table. What he
-- stops getting is a share of the bike rotation, which was never his job.
--
-- THE DEFECT THAT CAUSED THIS IS STILL IN THE CODE: renaming a code's role from one that
-- HAS a teams column (BIKE) to one that has none (PMO-BIKE) leaves the old name behind in
-- that column instead of clearing it. Rename any other role the same way -- MANAGER to
-- PMO-MANAGER, GMO to SENIOR-GMO -- and the same silent fault happens again.
-- =====================================================================================
