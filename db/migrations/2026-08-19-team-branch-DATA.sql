-- =====================================================================================
-- REGION, BRANCH AND ZONE, FROM THE ATTACHED TEAMS & STAFF SHEET.
-- =====================================================================================
-- Run 2026-08-19-team-branch.sql first (adds the branch column). This file only sets values.
--
-- SUPERSEDES THE FIRST VERSION OF THIS FILE, which set branch only, transcribed from a chat
-- message. This version is drawn from the owner's own downloaded-and-edited teams_and_staff
-- sheet -- "my final thought of the teams and staff table" -- which carries REGION and ZONE
-- alongside BRANCH for the first time, for every team that has them filled in today. Running
-- this after the first version is safe; a team already branched keeps its branch unless this
-- sheet gives a NEWER one, and nothing here can blank a field the sheet leaves empty (see below).
--
-- "please check the imports of correct team names changing nothing" -- same rule as before.
-- Nothing here renames a team; TUNDURU / Tunduru match on both sides normalised exactly as
-- normTeam() already does (trim, collapse whitespace, uppercase).
--
-- A BLANK CELL IN THE SHEET LEAVES THE EXISTING VALUE ALONE. The first version of this file
-- could assume every branch it named was correct because the message it came from had no
-- blanks. This sheet does -- MSAMVU's branch cell is empty here though it was set by the first
-- run of this migration, and roughly a third of the 85 rows have no region yet. `coalesce`
-- keeps whatever is already stored when the sheet says nothing, so re-running this later with
-- a MORE complete sheet only ever fills gaps, never erases a field a blanker sheet did not
-- mention.
--
-- SAFE TO RE-RUN, for the same reason: every value is an UPDATE by exact (normalised) match,
-- and `coalesce` makes a second run idempotent even where the sheet is unchanged.
-- =====================================================================================

update teams t set
  region = coalesce(v.region, t.region),
  branch = coalesce(v.branch, t.branch),
  zone = coalesce(v.zone, t.zone),
  updated_at = now()
from (values
  ('MSAMVU', 'MOROGORO', NULL, 'MSAMVU'),
  ('TABATA', 'DAR ES SALAAM', 'TABATA-SEGEREA', 'TABATA'),
  ('SEGEREA', 'DAR ES SALAAM', 'TABATA-SEGEREA', 'TABATA'),
  ('KONGOWE', 'PWANI', 'KIBAHA-KONGOWE', 'KIMARA'),
  ('MBEZI', 'DAR ES SALAAM', 'MBEZI KIMARA', 'KIMARA'),
  ('KIMARA', 'DAR ES SALAAM', 'MBEZI KIMARA', 'KIMARA'),
  ('CHALINZE', 'PWANI', 'CHALINZE', 'CHALINZE'),
  ('TABORA TOWN', 'TABORA', 'TABORA', 'TABORA'),
  ('IPURI', 'TABORA', 'TABORA', 'TABORA'),
  ('MWINYI', 'TABORA', 'TABORA', 'TABORA'),
  ('NZEGA', 'TABORA', 'NZEGA', NULL),
  ('SINGIDA', 'SINGIDA', 'SINGIDA', 'SINGIDA'),
  ('KIGOMA', 'KIGOMA', 'KIGOMA', NULL),
  ('SENGEREMA', 'MWANZA', 'SENGEREMA', 'MWANZA'),
  ('GEITA', 'GEITA', 'GEITA BRANCH', 'GEITA'),
  ('ILEMELA A', NULL, 'ILEMELA', NULL),
  ('NYAMAGANA A', NULL, 'NYAMAGANA A', NULL),
  ('NYAMAGANA B', NULL, 'NYAMAGANA B', NULL),
  ('MBALIZI', 'MBEYA', 'MBEYA CENTER', 'MBEYA'),
  ('KABWE', 'MBEYA', 'MBEYA CENTER', 'MBEYA'),
  ('TUNDUMA', 'SONGWE', 'TUNDUMA', 'MOMBA'),
  ('VWAWA', 'SONGWE', 'TUNDUMA', 'MOMBA'),
  ('SUMBAWANGA', 'RUKWA', 'SUMBAWANGA', NULL),
  ('MBARALI', 'MBEYA', 'MBARALI', NULL),
  ('KYELA', 'MBEYA', 'KYELA', 'MBEYA'),
  ('SERENGETI', 'MARA', 'SERENGETI', NULL),
  ('MUSOMA', 'MARA', 'MUSOMA', 'MUSOMA'),
  ('BUNDA', 'MARA', 'BUNDA', NULL),
  ('TARIME', 'MARA', 'TARIME', 'MUSOMA'),
  ('MAFINGA', 'IRINGA', 'MAFINGA', 'IRINGA'),
  ('NJOMBE', 'NJOMBE', 'NJOMBE', 'NJOMBE'),
  ('IRINGA A', 'IRINGA', 'IRINGA', 'IRINGA'),
  ('IRINGA B', 'IRINGA', 'IRINGA', 'IRINGA'),
  ('MAKAMBAKO A', 'NJOMBE', 'MAKAMBAKO', 'NJOMBE'),
  ('KIJENGE-NJIRO', 'ARUSHA', 'ARUSHA CENTER', 'KIJENGE'),
  ('MAJENGO', 'ARUSHA', 'ARUSHA CENTER', 'MAJENGO'),
  ('MOROMBOO', 'ARUSHA', 'MOROMBOO', 'MAJENGO'),
  ('KARATU', 'MANYARA', 'KARATU- MTO WA MBU', 'KIJENGE'),
  ('BABATI', 'MANYARA', 'MANYARA', 'KIJENGE'),
  ('TENGERU- USARIVER', 'ARUSHA', NULL, 'ARUMERU'),
  ('BOMA NGOMBE', 'KILIMANJARO', 'BOMA-SANYA', 'ARUMERU'),
  ('CHAMWINO', 'DODOMA', 'DODOMA', 'DODOMA'),
  ('DODOMA CBD', 'DODOMA', 'DODOMA', 'DODOMA'),
  ('SUA', 'MOROGORO', 'MSAMVU', 'MSAMVU'),
  ('KIHONDA A', 'MOROGORO', 'KIHONDA', 'KIHONDA'),
  ('KIHONDA B', 'MOROGORO', 'KIHONDA', 'KIHONDA'),
  ('TEMEKE', 'DAR ES SALAAM', 'TEMEKE-GONGOLAMBOTO', 'DAR CENTER'),
  ('KIJICHI', 'DAR ES SALAAM', 'MBAGALA KIJICHI', 'DAR CENTER'),
  ('MBAGALA', 'DAR ES SALAAM', 'MBAGALA KIJICHI', 'DAR CENTER'),
  ('GONGOLAMBOTO', 'DAR ES SALAAM', NULL, 'DAR CENTER'),
  ('CHANIKA', 'DAR ES SALAAM', 'CHANIKA', 'KIGAMBONI'),
  ('VIKINDU', 'PWANI', 'MBAGALA KIJICHI', 'DAR CENTER'),
  ('TEGETA', 'DAR ES SALAAM', 'GOBA-TEGETA', 'DAR EAST'),
  ('GOBA', 'DAR ES SALAAM', 'GOBA-TEGETA', 'DAR EAST'),
  ('MABIBO', 'DAR ES SALAAM', 'DAR EAST', 'DAR EAST'),
  ('SINZA', 'DAR ES SALAAM', 'DAR EAST', 'DAR EAST'),
  ('KIGAMBONI B', 'DAR ES SALAAM', 'KIGAMBONI', 'KIGAMBONI'),
  ('KIGAMBONI A', 'DAR ES SALAAM', 'KIGAMBONI', 'KIGAMBONI'),
  ('MBINGA', 'RUVUMA', 'MBINGA', NULL),
  ('SONGEA', 'RUVUMA', 'SONGEA', 'SONGEA'),
  ('Tunduru', 'RUVUMA', 'TUNDURU', NULL),
  ('MTWARA TOWN', 'MTWARA', 'MTWARA', 'MTWARA'),
  ('MASASI', 'MTWARA', 'MASASI', 'MTWARA'),
  ('SHINYANGA', 'SHINYANGA', 'SHINYANGA', NULL),
  ('BUZWAGI A', 'KAHAMA', 'KAHAMA', 'KAHAMA'),
  ('BUZWAGI B', 'KAHAMA', 'KAHAMA', 'KAHAMA'),
  ('KATORO B', 'GEITA', 'KATORO BRANCH', 'GEITA'),
  ('KATORO A', 'GEITA', 'KATORO BRANCH', 'GEITA'),
  ('KASULU', NULL, 'KASULU', NULL),
  ('MPANDA B', NULL, 'MPANDA', NULL),
  ('MPANDA A', NULL, 'MPANDA', NULL),
  ('MAFIA', NULL, 'MAFIA', NULL),
  ('MULEBA', NULL, 'MULEBA', NULL),
  ('BUKOBA B', NULL, 'BUKOBA', NULL),
  ('BUKOBA A', NULL, 'BUKOBA', NULL),
  ('BARIADI', NULL, 'BARIADI', NULL),
  ('MASWA', NULL, 'MASWA', NULL)
) as v(team_key, region, branch, zone)
where upper(regexp_replace(trim(t.team), '\s+', ' ', 'g'))
    = upper(regexp_replace(trim(v.team_key), '\s+', ' ', 'g'));

-- =====================================================================================
-- VERIFY -- run after the update above. Neither changes anything.
-- =====================================================================================

-- 1. Teams in your live table still missing a branch after this -- either genuinely
--    unmapped (BAGAMOYO, HIMO, KALIUA, KOROGWE, TANDAHIMBA, TANGA MJINI, ILEMELA B, RUNZEWE
--    all had blank branch cells in the sheet too) or this list has a name that does not match:
select team, region, branch, zone from teams where branch is null order by team;

-- 2. Teams still missing a REGION -- a smaller, separate gap; branch is set for several of
--    these (KASULU, the MPANDA/BUKOBA/etc. group) but the sheet never filled in their region:
select team, region, branch from teams where region is null and branch is not null order by team;
