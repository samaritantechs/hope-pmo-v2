-- =====================================================================================
--  MOVE PENDING IMPREST REQUESTS BACK TO AN OPM YOU NAME -- by hand, no matching.
-- =====================================================================================
--
--  The companion of RUN-ME-2026-11-05b-imprest-move-pending-to-opm.sql, for the requests that one cannot place
--  on its own: usually because the name on the requester's access code is not the name in the Teams & Staff
--  sheet ("DITRICK" on the code, "DITRICK MUFURUKI" in the GMO column), so no team is found by name.
--  Here YOU write down who each request goes to; nothing is guessed.
--
--  1. Fill the list (requester as it shows on the request -> the OPM's name, exactly as on the OPM's access code).
--     To see the OPM names:  select name, teams from public.access_codes where upper(btrim(role)) = 'OPM';
--  2. Run it as it is ('preview': looks, changes nothing); then change 'preview' to 'move' and run it again.
--
--  It stops, changing nothing, if the migration is not run, if a placeholder is left in the list, or if a name
--  written is not an OPM sign-in (nobody could confirm the request). Moves only requests that are pending and still
--  with the GM, so a second run moves nothing more. The OPMs find them in their Requests tab -- which needs the route
--  saved on the Imprest approvals tab (that is what tells their tab to look). No email or phone alert is sent.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

-- 1. WRITE THE LIST: the requester's name exactly as it shows on the request, and the OPM who should confirm it.
drop table if exists _pick;
create temp table _pick (requester text, opm text);
insert into _pick (requester, opm) values
  ('DITRICK',        'WRITE THE OPM NAME HERE'),
  ('DIWANI',         'WRITE THE OPM NAME HERE'),
  ('MFAUME KINDOLE', 'WRITE THE OPM NAME HERE');

-- 2. LEAVE 'preview' to only look; change it to 'move' to move them.      <<<
drop table if exists _mode;
create temp table _mode as select 'preview'::text as mode;

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

do $$
declare bad text;
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'imprest_requests' and column_name = 'stage') then
    raise exception 'Run db/RUN-ME-2026-11-05-imprest-opm-step.sql first. Nothing was changed.';
  end if;
  if exists (select 1 from _pick where opm ilike '%WRITE THE OPM%') then
    raise exception 'Replace WRITE THE OPM NAME HERE with the OPM''s name in every line of the list. Nothing was changed.';
  end if;
  -- an OPM written here must be a real OPM sign-in, or nobody could confirm the request
  select string_agg(p.opm, ', ') into bad from _pick p
   where not exists (select 1 from public.access_codes c
                      where upper(btrim(c.role)) = 'OPM'
                        and (upper(btrim(c.name)) = upper(btrim(p.opm)) or pg_temp.same_name(c.name, p.opm)));
  if bad is not null then
    raise exception 'No OPM sign-in is named: %. Write the name exactly as it is on the OPM''s access code. Nothing was changed.', bad;
  end if;
end $$;

update public.imprest_requests q
   set stage = 'opm', routed_via = 'OPM', routed_names = p.opm, routed_teams = null,
       routed_note = 'Imehamishiwa kwa OPM na GM. / Moved back to the OPM by the GM.', updated_at = now()
  from _pick p
 where upper(btrim(q.staff_name)) = upper(btrim(p.requester))
   and q.status = 'pending' and coalesce(q.stage, 'gm') = 'gm'
   and (select mode from _mode) = 'move';

select p.requester, p.opm,
       (select count(*) from public.imprest_requests q
         where upper(btrim(q.staff_name)) = upper(btrim(p.requester)) and q.status = 'pending'
           and coalesce(q.stage, 'gm') = case when (select mode from _mode) = 'move' then 'opm' else 'gm' end) as requests,
       case when (select count(*) from public.imprest_requests q
                   where upper(btrim(q.staff_name)) = upper(btrim(p.requester)) and q.status = 'pending'
                     and coalesce(q.stage, 'gm') = case when (select mode from _mode) = 'move' then 'opm' else 'gm' end) = 0
            then 'NOT FOUND: no pending request under that name (check the spelling as shown on the request)'
            when (select mode from _mode) = 'move' then 'MOVED to ' || p.opm else 'WOULD MOVE to ' || p.opm end as outcome
from _pick p order by p.requester;
