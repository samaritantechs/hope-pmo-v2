-- =====================================================================================
--  MOVE THE PENDING IMPREST REQUESTS OF GMOs AND MANAGERS TO THEIR OPMs -- once.
-- =====================================================================================
--
--    "so all pending imprests of GMOs and managers are at OPM now, not GM, unless the OPM
--     verifies?"  ->  "yes, move the pending ones to their OPMs"
--
--  The OPM step (RUN-ME-2026-11-05-imprest-opm-step.sql) routes NEW requests only: a request is
--  sent the way the route says at the moment it is made, so what was already pending with the GM
--  stayed with the GM. This moves those, once. After it, each one is exactly what a new request
--  from that person would have been: waiting for their OPM, in the OPM's Requests tab, out of the
--  GM's pending list and counts, and it reaches the GM again only when the OPM confirms it (the
--  OPM may lower the amount, with a comment). The GM can still Release any of them.
--
--  BEFORE YOU RUN IT, both of these must be true (the script stops with a plain message if not):
--    1. RUN-ME-2026-11-05-imprest-opm-step.sql has been run.
--    2. The route is saved: Imprest approvals tab -> "Who requests pass through before the GM"
--       -> tick GMO and Manager, choose OPM, Save. The roles this moves are the ones in that route,
--       and "OPM" below is whichever role you chose there.
--
--  HOW TO USE IT -- it LOOKS first and moves nothing until you say so:
--    a. Run the whole file as it is. It is in 'preview' mode: the table it shows says, for every
--       pending request of a routed role, WHO it would go to, or why it would stay with the GM.
--    b. Happy? Change the word 'preview' to 'move' on the line marked  <<<  and run it again.
--    c. Running it a second time moves nothing more (what moved is no longer waiting at the GM).
--
--  HOW THE OPM IS FOUND -- the same rule the app uses for a new request:
--    the teams the requester holds in Teams & Staff (their name in the GMO / Manager / Credit column;
--    where that finds none, the teams on their access code), and the OPM named on each of those
--    teams. A request moves only if the OPM role has a sign-in for it: one whose name matches the OPM
--    named, or one that holds one of those teams. Otherwise it STAYS with the GM and the table says why
--    (usually: no team found for the requester, or the OPM on the team has no sign-in). Names are
--    matched as the app matches them: the same name, or all the words of the shorter one in the longer.
--
--  WHAT IT DOES NOT DO: it sends no email and no phone alert (SQL cannot). The OPMs will find the
--  requests in their Requests tab; tell them. The GM's old emailed "Decide now" links for these will
--  say the request is waiting for the OPM, which is true.
--
--  SAFE TO RE-RUN. Touches only imprest_requests rows that are pending and still with the GM.
--  Small and fast: a handful of rows.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

drop table if exists _mode;
create temp table _mode as select 'preview'::text as mode;      -- <<< change 'preview' to 'move' to actually move them

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'imprest_requests' and column_name = 'stage') then
    raise exception 'Run db/RUN-ME-2026-11-05-imprest-opm-step.sql first: it adds the columns this needs. Nothing was changed.';
  end if;
  if not exists (select 1 from public.settings
                 where key = 'IMPREST_ROUTES' and coalesce(btrim(value), '') not in ('', '[]')) then
    raise exception 'No route is saved yet. On the Imprest approvals tab tick GMO and Manager, choose OPM, press Save, then run this again. Nothing was changed.';
  end if;
end $$;

-- The app's own name matching (sameName in api/_lib/expdf.js): the same words in the same order, or every
-- word of the shorter name (two or more) found in the longer.
create or replace function pg_temp.words_(s text) returns text[] language sql immutable as $$
  select coalesce(array_agg(w), '{}'::text[])
  from regexp_split_to_table(btrim(regexp_replace(upper(coalesce(s, '')), '[^A-Z0-9 ]+', ' ', 'g')), '\s+') as w
  where w <> ''
$$;
create or replace function pg_temp.same_name(a text, b text) returns boolean language sql immutable as $$
  select case
    when cardinality(pg_temp.words_(a)) = 0 or cardinality(pg_temp.words_(b)) = 0 then false
    when pg_temp.words_(a) = pg_temp.words_(b) then true
    when least(cardinality(pg_temp.words_(a)), cardinality(pg_temp.words_(b))) < 2 then false
    when cardinality(pg_temp.words_(a)) <= cardinality(pg_temp.words_(b)) then pg_temp.words_(a) <@ pg_temp.words_(b)
    else pg_temp.words_(b) <@ pg_temp.words_(a)
  end
$$;

drop table if exists _plan;
create temp table _plan as
with routes as (                      -- the saved route: which roles go through which
  select upper(btrim(f)) as role, upper(btrim(r ->> 'via')) as via
  from public.settings s,
       jsonb_array_elements(s.value::jsonb) r,
       jsonb_array_elements_text(coalesce(r -> 'from', '[]'::jsonb)) f
  where s.key = 'IMPREST_ROUTES'
),
asked as (                            -- pending, still with the GM, from a routed role
  select q.id, q.requested_at, q.full_name, q.staff_name, q.total_amount, q.destination, ac.teams as code_teams,
         coalesce(nullif(upper(btrim(q.staff_role)), ''), upper(btrim(ac.role))) as role
  from public.imprest_requests q
  left join public.access_codes ac on ac.code = q.staff_code
  where q.status = 'pending' and coalesce(q.stage, 'gm') = 'gm'
),
r as (select a.*, ro.via from asked a join routes ro on ro.role = a.role),
held as (                             -- the teams they hold: their name in the role's own column
  select r.id, t.team, t.opm
  from r
  join public.teams t on true
  cross join lateral (select case r.role when 'GMO' then t.gmo when 'MANAGER' then t.manager
                                          when 'CREDIT' then t.credit when 'OPM' then t.opm end as cell) h
  where btrim(coalesce(h.cell, '')) <> ''
    and (upper(btrim(h.cell)) = upper(btrim(r.staff_name)) or pg_temp.same_name(h.cell, r.staff_name))
),
mine as (                             -- ...and, where that finds none, the teams on their access code
  select id, team, opm from held
  union all
  select r.id, t.team, t.opm
  from r
  join public.teams t on upper(btrim(t.team)) in (select upper(btrim(x)) from unnest(coalesce(r.code_teams, '{}'::text[])) x)
  where not exists (select 1 from held h where h.id = r.id)
),
names as (
  select id,
         array_agg(distinct btrim(team)) as teams,
         array_agg(distinct upper(btrim(team))) as team_keys,
         coalesce(array_agg(distinct btrim(opm)) filter (
           where btrim(coalesce(opm, '')) <> '' and btrim(opm) !~* '^(NO[ -]|NONE$|N/A$|-$|\(UNASSIGNED\))'), '{}'::text[]) as opm_names
  from mine group by id
),
conf as (                             -- the OPM sign-ins that may confirm it
  select n.id, count(distinct c.code) as sign_ins
  from names n
  join r on r.id = n.id
  join public.access_codes c on upper(btrim(c.role)) = r.via
  where exists (select 1 from unnest(n.opm_names) nm where upper(btrim(c.name)) = upper(btrim(nm)) or pg_temp.same_name(c.name, nm))
     or (coalesce(cardinality(c.teams), 0) > 0
         and exists (select 1 from unnest(c.teams) ct where upper(btrim(ct)) = any (n.team_keys)))
  group by n.id
)
select r.id, r.requested_at, r.full_name, r.role, r.via, r.total_amount, r.destination,
       coalesce(n.teams, '{}'::text[]) as teams, coalesce(n.opm_names, '{}'::text[]) as opm_names,
       coalesce(cf.sign_ins, 0) as sign_ins,
       (n.id is not null and coalesce(cf.sign_ins, 0) > 0) as movable,
       case when n.id is null then 'no team found for the requester in Teams & Staff'
            when coalesce(cf.sign_ins, 0) = 0 and cardinality(n.opm_names) > 0 then 'no ' || r.via || ' sign-in matches ' || array_to_string(n.opm_names, ', ')
            when coalesce(cf.sign_ins, 0) = 0 then 'no ' || r.via || ' is named on their teams'
            else '' end as why_not
from r
left join names n on n.id = r.id
left join conf cf on cf.id = r.id;

update public.imprest_requests q
   set stage = 'opm',
       routed_via = p.via,
       routed_names = nullif(array_to_string(p.opm_names, ', '), ''),
       routed_teams = nullif(array_to_string(p.teams, ', '), ''),
       routed_note = 'Imehamishiwa kwa OPM baada ya njia kuwekwa. / Moved to the OPM when the route was set.',
       updated_at = now()
  from _plan p
 where p.id = q.id and p.movable
   and q.status = 'pending' and coalesce(q.stage, 'gm') = 'gm'
   and (select mode from _mode) = 'move';

-- What happened (or would): one line per pending request of a routed role, and where it goes.
select outcome, requester, role, total_amount, destination, asked, teams
from (
  select case when movable
              then (case when (select mode from _mode) = 'move' then 'MOVED to ' else 'WOULD MOVE to ' end)
                   || coalesce(nullif(array_to_string(opm_names, ', '), ''), 'the ' || via || ' sign-ins of those teams')
              else 'STAYS with the GM: ' || why_not end as outcome,
         full_name as requester, role, total_amount, destination, to_char(requested_at, 'YYYY-MM-DD') as asked,
         array_to_string(teams, ', ') as teams, movable, requested_at
  from _plan
  union all
  select 'NOTHING TO MOVE: no pending request of a routed role is still with the GM.', null, null, null, null, null, null, true, now()
  where not exists (select 1 from _plan)
) x
order by movable desc, requested_at;
