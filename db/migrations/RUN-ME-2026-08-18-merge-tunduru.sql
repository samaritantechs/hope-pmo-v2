-- =====================================================================================
--  RUN ME.  Merge TUNDURU into Tunduru -- EVERYWHERE, in one paste.
--
--    "if merged find nothing like TUNDURU nowhere else, overwrite it everywhere a team
--     name seats in the DB"
--
--  Every spelling variant of the name -- TUNDURU, Tunduru with a trailing space, any mix
--  of case -- is rewritten to the one canonical spelling 'Tunduru', in every table that
--  carries a team column, and inside the two ARRAY columns (a collection officer's teams
--  on their access code, a leader's scope on their handset). The teams row for the
--  variant is deleted LAST, after its code and officers have been carried onto the
--  canonical row wherever the canonical row had blanks.
--
--  SAFE TO RE-RUN: a second run finds nothing left to move and changes nothing.
--  The checks at the bottom must both come back clean.
-- =====================================================================================

-- The canonical row must exist before anything points at it.
insert into teams (team)
select 'Tunduru' where not exists (select 1 from teams where team = 'Tunduru');

-- Carry the variant row's facts onto the canonical row, but ONLY into blanks -- the
-- canonical row's own code and officers always win.
update teams a set
  team_code  = coalesce(a.team_code,  b.team_code),
  region     = coalesce(a.region,     b.region),
  zone       = coalesce(a.zone,       b.zone),
  opm        = coalesce(a.opm,        b.opm),
  recovery   = coalesce(a.recovery,   b.recovery),
  gmo        = coalesce(a.gmo,        b.gmo),
  manager    = coalesce(a.manager,    b.manager),
  credit     = coalesce(a.credit,     b.credit),
  expected   = coalesce(a.expected,   b.expected),
  bike       = coalesce(a.bike,       b.bike)
from teams b
where a.team = 'Tunduru'
  and upper(trim(b.team)) = 'TUNDURU' and b.team <> 'Tunduru';

-- Every table with a team column, rewritten. Checked against the catalog first, so a
-- table a migration has not created yet is skipped rather than failing the whole paste.
do $$
declare
  t text; n bigint;
begin
  foreach t in array array[
    'repayment_snapshots', 'defaulter_snapshots', 'followup_status', 'followup_comments',
    'loans', 'received_payments', 'abnormal_payments', 'complaints', 'complaint_log',
    'restructures', 'demand_notices', 'call_logs', 'call_users', 'snapshot_summaries',
    'audit_log', 'performance_records'
  ] loop
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = t and column_name = 'team') then
      execute format(
        'update public.%I set team = ''Tunduru'' where upper(trim(team)) = ''TUNDURU'' and team <> ''Tunduru''', t);
      get diagnostics n = row_count;
      raise notice '%: % row(s) re-filed', t, n;
    end if;
  end loop;
end $$;

-- The two array columns. distinct collapses a list that held BOTH spellings into one.
update access_codes set teams = (
  select array_agg(distinct case when upper(trim(x)) = 'TUNDURU' then 'Tunduru' else x end)
  from unnest(teams) as x)
where teams is not null
  and exists (select 1 from unnest(teams) x where upper(trim(x)) = 'TUNDURU' and x <> 'Tunduru');

update call_users set leader_teams = (
  select array_agg(distinct case when upper(trim(x)) = 'TUNDURU' then 'Tunduru' else x end)
  from unnest(leader_teams) as x)
where leader_teams is not null
  and exists (select 1 from unnest(leader_teams) x where upper(trim(x)) = 'TUNDURU' and x <> 'Tunduru');

-- Only now, with nothing pointing at it, the variant team row goes.
delete from teams where upper(trim(team)) = 'TUNDURU' and team <> 'Tunduru';

-- ================================== DID IT LAND? =====================================
-- FIRST CHECK: must return ZERO rows -- no variant spelling survives anywhere.
select 'teams' as place, team as value from teams where upper(trim(team)) = 'TUNDURU' and team <> 'Tunduru'
union all select 'followup_status', team from followup_status where upper(trim(team)) = 'TUNDURU' and team <> 'Tunduru'
union all select 'defaulter_snapshots', team from defaulter_snapshots where upper(trim(team)) = 'TUNDURU' and team <> 'Tunduru'
union all select 'repayment_snapshots', team from repayment_snapshots where upper(trim(team)) = 'TUNDURU' and team <> 'Tunduru'
union all select 'access_codes array', code from access_codes
  where teams is not null and exists (select 1 from unnest(teams) x where upper(trim(x)) = 'TUNDURU' and x <> 'Tunduru')
union all select 'leader_teams array', user_id from call_users
  where leader_teams is not null and exists (select 1 from unnest(leader_teams) x where upper(trim(x)) = 'TUNDURU' and x <> 'Tunduru')
limit 20;

-- SECOND CHECK: the canonical team, with everything now filed under it.
select (select count(*) from teams where team = 'Tunduru')                       as team_row,
       (select count(*) from followup_status where team = 'Tunduru')             as followups,
       (select count(*) from defaulter_snapshots where team = 'Tunduru')         as deck_rows,
       (select count(*) from snapshot_summaries where team = 'Tunduru')          as summary_rows;
