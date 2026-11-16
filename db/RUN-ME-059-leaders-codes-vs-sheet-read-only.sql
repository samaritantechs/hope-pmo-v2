-- RUN-ME-059 -- WHO THE ROTATION CREDITS, AND WHAT THEIR OWN CODE CAN SEE. READ-ONLY: changes nothing.
--
--   "gmo or opm is seeing expected defaulters of gmo or manager where that manager in their code
--    ain't seeing them, they getting just a little like two yet a Manager's gmo sees the manager has
--    many ... so make sure the distribution is okay" -- the owner, 16 Nov 2026
--
-- The rotation hands a defaulter to the GMO, the MANAGER or the BIKE officer that TEAMS & STAFF names on
-- the customer's team. A person who signs in sees what their own ACCESS CODE's teams hold ("the teams i
-- set in access codes are the ones correct": the code decides, the sheet never widens it). When the two
-- lists disagree, the report credits a manager with customers their own screen cannot show.
-- This lists every such person, in one answer, off the live book -- so they can be put right one by one.
--
-- WHAT EACH ROW OF THE ANSWER IS (the first column, "what"):
--   1 CODE LACKS TEAMS     the person's own code does not hold teams the sheet names them on. THESE are the
--                          managers who "get just a little". `teams_missing_from_code` says which.
--   2 CODE HAS EXTRA TEAMS the person's code holds teams the sheet does not name them on (under GMO, MANAGER
--                          or BIKE). They see those teams; the rotation hands the customers to somebody else.
--   3 NO CODE BY THIS NAME the sheet names the person but no access code carries that name. Either they work
--                          from a TEAM code (nothing to fix: the phone widens a team-code handset to the teams
--                          the sheet gives them) or the name is spelt another way on the code -- see
--                          `similar_codes`, which lists codes sharing a word with it, for a person to judge.
--   4 TWO CODES, ONE NAME  more than one access code carries the name; nobody can tell which is theirs.
--
-- WHICH LIST IS RIGHT IS THE OWNER'S TO SAY, PERSON BY PERSON: if the code is right, the sheet is edited on
-- Teams & Staff (the rotation then moves their customers to whoever the sheet names); if the sheet is right,
-- the teams are added to their code under Settings -> Roles & access. Nothing here guesses.
-- Names are compared in capitals with runs of blanks as one, as the portal compares them; a cell that holds
-- a dash, N/A, NONE, NIL, HAKUNA or a bare 0 names nobody. No access code is printed: only names and roles.
--
-- Small tables (the teams sheet, the access codes), one statement, a fraction of a second. SAFE TO RE-RUN.

with sheet as (            -- every (team, role, person) the sheet names
  select upper(btrim(regexp_replace(t.team, '\s+', ' ', 'g'))) as team_k,
         r.role,
         upper(btrim(regexp_replace(r.cell, '\s+', ' ', 'g'))) as person
  from public.teams t
  cross join lateral (values ('GMO', t.gmo), ('MANAGER', t.manager), ('BIKE', t.bike)) as r(role, cell)
  where nullif(btrim(r.cell), '') is not null
    and btrim(r.cell) !~* '^([-_.]+|n/?a|none|nil|null|hakuna|0)$'
),
people as (
  select person,
         string_agg(distinct role, ', ') as roles,
         array_agg(distinct team_k) as sheet_teams
  from sheet
  group by person
),
codes as (                 -- every access code that carries a name, teams as the code stores them
  select c.name, c.role,
         upper(btrim(regexp_replace(c.name, '\s+', ' ', 'g'))) as person,
         array(select distinct upper(btrim(regexp_replace(x, '\s+', ' ', 'g')))
               from unnest(c.teams) as x where nullif(btrim(x), '') is not null) as code_teams
  from public.access_codes c
  where nullif(btrim(c.name), '') is not null
),
matched as (
  select p.person, p.roles, p.sheet_teams,
         (select count(*) from codes c where c.person = p.person) as n_codes,
         (select c.name from codes c where c.person = p.person limit 1) as code_name,
         (select c.role from codes c where c.person = p.person limit 1) as code_role,
         (select c.code_teams from codes c where c.person = p.person limit 1) as code_teams
  from people p
)
select * from (
  select '1 CODE LACKS TEAMS' as what, m.person, m.roles as sheet_roles,
         cardinality(m.sheet_teams) as teams_on_sheet,
         cardinality(m.code_teams) as teams_on_code,
         m.code_role,
         array_to_string(array(select unnest(m.sheet_teams) except select unnest(m.code_teams) order by 1), ', ') as teams_missing_from_code,
         null::text as teams_on_code_not_sheet,
         null::text as similar_codes
  from matched m
  where m.n_codes = 1 and cardinality(m.code_teams) > 0
    and exists (select unnest(m.sheet_teams) except select unnest(m.code_teams))

  union all
  select '2 CODE HAS EXTRA TEAMS', m.person, m.roles,
         cardinality(m.sheet_teams), cardinality(m.code_teams), m.code_role,
         null,
         array_to_string(array(select unnest(m.code_teams) except select unnest(m.sheet_teams) order by 1), ', '),
         null
  from matched m
  where m.n_codes = 1 and cardinality(m.code_teams) > 0
    and exists (select unnest(m.code_teams) except select unnest(m.sheet_teams))

  union all
  select '3 NO CODE BY THIS NAME', m.person, m.roles,
         cardinality(m.sheet_teams), null, null,
         null, null,
         (select string_agg(z.label, '; ' order by z.label)
            from (select c.name || ' (' || coalesce(c.role, '') || ')' as label
                    from codes c
                   where exists (select 1 from unnest(string_to_array(c.person, ' ')) w
                                  where length(w) >= 3 and w = any(string_to_array(m.person, ' ')))
                   order by 1 limit 5) z)
  from matched m
  where m.n_codes = 0

  union all
  select '4 TWO CODES, ONE NAME', m.person, m.roles,
         cardinality(m.sheet_teams), null, null,
         null, null,
         m.n_codes || ' codes carry this name'
  from matched m
  where m.n_codes >= 2
) x
order by x.what, x.person;
