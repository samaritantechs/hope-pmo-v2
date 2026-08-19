-- =====================================================================================
-- SET EVERY TEAM'S BRANCH -- the mapping given directly, matched WITHOUT renaming anything.
-- =====================================================================================
-- Run 2026-08-19-team-branch.sql first (adds the column). This file only sets values.
--
-- "some teams in the original system were named with a space after like tengeru and msamvu
--  ... just like Tunduru misbehaved ... please check the imports of correct team names
--  changing nothing"
--
-- NOTHING HERE RENAMES A TEAM. The list below is typed exactly as given -- including
-- "Tunduru" in mixed case and the trailing spaces after "GONGOLAMBOTO " and "MSAMVU " --
-- because retyping them "corrected" is exactly the kind of quiet edit that caused the Tunduru
-- mismatch before. Instead, the MATCH is normalised on both sides, the same way the app's own
-- normTeam() already does for every upload: trim, collapse internal whitespace, uppercase.
-- "Tunduru" and "TUNDURU " and "TUNDURU" all normalise to the same key, so the match finds
-- your live row whatever exact shape it is stored in today, and writes to THAT row -- your
-- team's name is not touched, only its new branch column.
--
-- WHAT THIS DOES NOT DO. Two teams in the list were given with no branch (ILEMELA B, RUNZEWE)
-- and are deliberately left out of the VALUES below, so their branch stays NULL rather than
-- being set to an empty string -- the same "absent means unknown" rule the rest of this system
-- already lives by.
--
-- SAFE TO RE-RUN. Every row is an UPDATE by exact (normalised) match; running it twice sets
-- the same values twice, nothing doubles.
-- =====================================================================================

update teams t set branch = v.branch, updated_at = now()
from (values
  ('BABATI','MANYARA'), ('BARIADI','BARIADI'), ('BOMA NGOMBE','BOMA-SANYA'),
  ('BUKOBA A','BUKOBA'), ('BUKOBA B','BUKOBA'), ('BUNDA','BUNDA'),
  ('BUZWAGI A','KAHAMA'), ('BUZWAGI B','KAHAMA'), ('CHALINZE','CHALINZE'),
  ('CHAMWINO','DODOMA'), ('CHANIKA','CHANIKA'), ('DODOMA CBD','DODOMA'),
  ('GEITA','GEITA BRANCH'), ('GOBA','GOBA-TEGETA'),
  ('GONGOLAMBOTO ','TEMEKE-GONGOLAMBOTO '),
  ('ILEMELA A','ILEMELA'), ('IPURI','TABORA'), ('IRINGA A','IRINGA'), ('IRINGA B','IRINGA'),
  ('KABWE','MBEYA CENTER '), ('KARATU','KARATU- MTO WA MBU'), ('KASULU','KASULU'),
  ('KATORO A','KATORO BRANCH'), ('KATORO B','KATORO BRANCH'),
  ('KIGAMBONI A','KIGAMBONI'), ('KIGAMBONI B','KIGAMBONI'), ('KIGOMA','KIGOMA'),
  ('KIHONDA A','KIHONDA '), ('KIHONDA B','KIHONDA '),
  ('KIJENGE-NJIRO','ARUSHA CENTER'), ('KIJICHI','MBAGALA KIJICHI'), ('KIMARA','MBEZI KIMARA'),
  ('KONGOWE','KIBAHA-KONGOWE'), ('KYELA','KYELA'), ('MABIBO','DAR EAST'), ('MAFIA','MAFIA'),
  ('MAFINGA','MAFINGA'), ('MAJENGO','ARUSHA CENTER'), ('MAKAMBAKO A','MAKAMBAKO'),
  ('MASASI','MASASI'), ('MASWA','MASWA'), ('MBAGALA','MBAGALA KIJICHI'),
  ('MBALIZI','MBEYA CENTER '), ('MBARALI','MBARALI'), ('MBEZI','MBEZI KIMARA'),
  ('MBINGA','MBINGA'), ('MOROMBOO','MOROMBOO'), ('MPANDA A','MPANDA'), ('MPANDA B','MPANDA'),
  ('MSAMVU ','MSAMVU'), ('MTWARA TOWN','MTWARA'), ('MULEBA','MULEBA'), ('MUSOMA','MUSOMA'),
  ('MWINYI','TABORA'), ('NJOMBE','NJOMBE'), ('NYAMAGANA A','NYAMAGANA A'),
  ('NYAMAGANA B','NYAMAGANA B'), ('NZEGA','NZEGA'), ('SEGEREA','TABATA-SEGEREA'),
  ('SENGEREMA','SENGEREMA'), ('SERENGETI','SERENGETI'), ('SHINYANGA','SHINYANGA'),
  ('SINGIDA','SINGIDA'), ('SINZA','DAR EAST'), ('SONGEA','SONGEA'), ('SUA','MSAMVU'),
  ('SUMBAWANGA','SUMBAWANGA'), ('TABATA','TABATA-SEGEREA'), ('TABORA TOWN','TABORA'),
  ('TARIME','TARIME'), ('TEGETA','GOBA-TEGETA'), ('TEMEKE','TEMEKE-GONGOLAMBOTO '),
  ('TENGERU- USARIVER ','MERU'), ('TUNDUMA','TUNDUMA'), ('Tunduru','TUNDURU'),
  ('VIKINDU','MBAGALA KIJICHI'), ('VWAWA','TUNDUMA')
) as v(team_key, branch)
where upper(regexp_replace(trim(t.team), '\s+', ' ', 'g'))
    = upper(regexp_replace(trim(v.team_key), '\s+', ' ', 'g'));

-- =====================================================================================
-- VERIFY -- run these two after the update above. Neither changes anything.
-- =====================================================================================

-- 1. Names given above that matched NOTHING in your live teams table (typo on either side,
--    or the team does not exist yet -- check spelling against Teams & Staff before assuming
--    the mapping is wrong):
select v.team_key as "not found in teams"
from (values
  ('BABATI'),('BARIADI'),('BOMA NGOMBE'),('BUKOBA A'),('BUKOBA B'),('BUNDA'),('BUZWAGI A'),
  ('BUZWAGI B'),('CHALINZE'),('CHAMWINO'),('CHANIKA'),('DODOMA CBD'),('GEITA'),('GOBA'),
  ('GONGOLAMBOTO '),('ILEMELA A'),('ILEMELA B'),('IPURI'),('IRINGA A'),('IRINGA B'),('KABWE'),
  ('KARATU'),('KASULU'),('KATORO A'),('KATORO B'),('KIGAMBONI A'),('KIGAMBONI B'),('KIGOMA'),
  ('KIHONDA A'),('KIHONDA B'),('KIJENGE-NJIRO'),('KIJICHI'),('KIMARA'),('KONGOWE'),('KYELA'),
  ('MABIBO'),('MAFIA'),('MAFINGA'),('MAJENGO'),('MAKAMBAKO A'),('MASASI'),('MASWA'),
  ('MBAGALA'),('MBALIZI'),('MBARALI'),('MBEZI'),('MBINGA'),('MOROMBOO'),('MPANDA A'),
  ('MPANDA B'),('MSAMVU '),('MTWARA TOWN'),('MULEBA'),('MUSOMA'),('MWINYI'),('NJOMBE'),
  ('NYAMAGANA A'),('NYAMAGANA B'),('NZEGA'),('RUNZEWE'),('SEGEREA'),('SENGEREMA'),
  ('SERENGETI'),('SHINYANGA'),('SINGIDA'),('SINZA'),('SONGEA'),('SUA'),('SUMBAWANGA'),
  ('TABATA'),('TABORA TOWN'),('TARIME'),('TEGETA'),('TEMEKE'),('TENGERU- USARIVER '),
  ('TUNDUMA'),('Tunduru'),('VIKINDU'),('VWAWA')
) as v(team_key)
left join teams t
  on upper(regexp_replace(trim(t.team), '\s+', ' ', 'g'))
   = upper(regexp_replace(trim(v.team_key), '\s+', ' ', 'g'))
where t.team is null;

-- 2. Teams in your live table that STILL have no branch after the update -- either ILEMELA B /
--    RUNZEWE (given with no branch on purpose) or a team this list never mentioned at all:
select team, branch from teams where branch is null order by team;
