-- =====================================================================================
-- RUN-ME-047 -- ALL-TIME PAR: the total loan ever lent, per team, summed by the database.
--
--   "the todays defaulter is already the alltime defaulter so comparing it to total loan
--    (principle+interest) by all team and grand total is alltime par per team and company"
--
-- Today's defaulter deck is every defaulter there is, whenever they borrowed. Set each team's
-- arrears against the TOTAL LOAN (principal + interest, the LOAN AMT column) of everything that
-- team was ever lent, and the ratio is the team's all-time PAR; the grand total is the
-- company's. The sales history from 17 April 2024 is in the loans table (SALES-HISTORY parts,
-- 2026-10-30), so the denominator now exists.
--
-- ONE JOURNEY, ONE ROW PER TEAM. Without this function the Portfolio at Risk tab reads every
-- sale's team and amount and adds them up itself -- tens of thousands of rows for sixty
-- numbers -- and says so on the screen. With it, the database adds and the tab receives the
-- sixty numbers. The stages that count as a sale are handed in by the caller (SALES_STAGES in
-- api/_lib/dashboard-core.js), so that rule keeps living in one place.
--
-- TEAM SCOPING STAYS AT THE DATABASE: p_teams null means every team; a scoped code gets its
-- own teams summed and never a total that includes somebody else's. Compared upper-cased and
-- trimmed, the way loan_stage_counts does, because the registry's spellings vary.
--
-- SAFE TO RE-RUN, and OPTIONAL like every migration here: the tab works without it.
-- =====================================================================================

create or replace function loan_totals_by_team(p_teams text[] default null, p_stages text[] default null)
returns table (team text, loans bigint, loan_amt numeric, first_day date)
language sql
stable
as $$
  select l.team,
         count(*)::bigint,
         coalesce(sum(l.loan_amt), 0)::numeric,
         min(coalesce(l.disb_date, l.approved_date))
  from loans l
  where (p_stages is null or l.stage::text = any (p_stages))
    and (p_teams is null or upper(btrim(coalesce(l.team, ''))) = any (select upper(btrim(t)) from unnest(p_teams) t))
  group by l.team
$$;

grant execute on function loan_totals_by_team(text[], text[]) to service_role;

-- The filter is on stage and the grouping on team: the index loan_stage_counts already asked for.
create index if not exists loans_stage_team_idx on loans (stage, team);

select 'loan_totals_by_team' as piece, count(*) as present
from pg_proc where proname = 'loan_totals_by_team';
