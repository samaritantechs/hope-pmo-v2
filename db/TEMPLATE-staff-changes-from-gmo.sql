-- =====================================================================================
-- TEMPLATE: STAFF CHANGES CONFIRMED BY A GMO  (the staff registry, HR's staff database)
--
--   "Ill be comming with staff db updates simce GMOs comfirm of changes in my whatsapp group"
--   "dont correct names using the gmo data i bring unless its new staff"
--   "so provide sql to add staff as we always did"
--
-- A GMO sends a list, team by team: who is to be removed, who is to be added. Copy this file,
-- fill the two CHANGE lines and the list, and hand the owner the copy: new query, paste, Run.
-- It answers with one row for each name, saying what was done. (docs/HANDOFF.md Part 48.)
-- NO STAFF NAME IS EVER COMMITTED: this repository is public. The filled copy goes to the owner.
--
-- A NAME IS MATCHED EXACTLY (capitals, single spaces) AND NEVER RE-SPELT. A name the GMO spelt
-- differently from the registry comes back NOT FOUND with the nearest names beside it; once
-- the right person is clear they are settled by staff ID (TEMPLATE-staff-changes-by-id.sql).
--
-- REMOVE  the staff is switched to Inactive, exactly as the HR staff data tab does it: off every
--         request list, history kept, nothing deleted. Only when EXACTLY ONE staff who is not
--         already Inactive carries that name; none, or two, and nothing is changed.
-- ADD     nobody of that name in the registry: a new row, the name as the GMO wrote it, Active,
--           the next staff ID in the usual form (initials / number / year), role
--           FIELD OFFICER - <team>, and the zone of that team on Teams & Staff (a GMO's word
--           for a zone is not always the one filed there). If the zone already holds a name
--           like it, the row says "look": it may be the same person under another spelling.
--         exactly one staff of that name already: a move between teams, or a return. They are
--           switched on, and the team part of their "ROLE - TEAM" and their zone follow the new
--           team; the role word is kept. A role with no team part is left alone, zone too.
--         two or more of that name: nothing is changed.
-- BOTH    a name listed to remove AND to add is a move: only the ADD acts.
--
-- SAFE TO RUN AGAIN: the second run changes nothing and says so.
-- It reads and writes the staff registry and reads the teams table: two small tables, nothing
-- on uploads, nothing on HOPE Calls. An earlier form of it ran on the live book on 11 November
-- 2026; this form was run on a test database with the repository's schema.
-- NOT DONE BY IT: the role columns of Teams & Staff (a manager who left is still named there),
-- and a new staff who is not a field officer (set the role on the HR staff data tab).
-- =====================================================================================
set local lock_timeout = '5s';
set local statement_timeout = '30s';

with cfg as (
  select 'ZONE NAME'::text           as zone_if_team_unknown,     -- CHANGE: used only when the team has no zone on Teams & Staff
         'GMO ZONE NAME (SQL)'::text  as done_by                   -- CHANGE: written beside every row this touches
),
ask(n, team, act, name) as (values                                 -- the GMO's list, as written
  (1, 'TEAM ONE', 'REMOVE', 'FIRST MIDDLE LAST'),
  (2, 'TEAM ONE', 'ADD',    'ANOTHER MIDDLE LAST'),
  (3, 'TEAM TWO', 'ADD',    'THIRD MIDDLE LAST')
),
a as (   -- each name as it is compared (capitals, single spaces), its team as Teams & Staff knows it,
         -- and whether the list names it twice or both to remove and to add
  select k.n, k.team, k.act, x.name,
         t.team as team_as_filed, nullif(upper(btrim(t.zone)), '') as team_zone,
         row_number() over (partition by x.name, k.act order by k.n)        as nth,
         min(k.n) filter (where k.act = 'ADD') over (partition by x.name)   as add_n
  from ask k
  cross join lateral (select regexp_replace(upper(btrim(k.name)), '\s+', ' ', 'g') as name) x
  left join lateral (
    select tm.team, tm.zone from teams tm
    where regexp_replace(upper(tm.team), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(k.team), '[^A-Z0-9]', '', 'g')
    limit 1
  ) t on true
),
reg as (   -- the registry as it stands, each name as it is compared
  select s.id, s.status, s.zone, s.role, s.name as name_as_filed,
         regexp_replace(upper(btrim(s.name)), '\s+', ' ', 'g') as name,
         upper(btrim(s.status)) <> 'INACTIVE' as live
  from staff_registry s
),
hit as (   -- for each asked name: who carries exactly that name
  select a.n,
         count(r.id)                             as all_n,
         count(r.id) filter (where r.live)       as live_n,
         string_agg(r.id || ' (' || coalesce(r.zone, 'no zone') || ', ' || r.status || ')', '; ' order by r.id) as who,
         min(r.id) filter (where r.live)         as live_id,
         min(r.id)                               as any_id
  from a left join reg r on r.name = a.name
  group by a.n
),
off as (   -- REMOVE: exactly one staff of that name who is not already Inactive (and not also listed to add)
  update staff_registry s
     set status = 'Inactive', updated_by = (select done_by from cfg), updated_at = now()
    from a join hit h on h.n = a.n
   where a.act = 'REMOVE' and a.add_n is null and a.nth = 1 and h.live_n = 1 and s.id = h.live_id
  returning s.id, s.zone, s.role
),
mov as (   -- ADD of somebody the registry already holds (exactly one of that name): a move between
           -- teams, or a return. Switched on; the team part of "ROLE - TEAM" and the zone follow
           -- the new team. A role with no team part is left as it is, and so is its zone.
  update staff_registry s
     set status = 'Active',
         role = case when s.role ~ '\S\s+-\s+\S' then regexp_replace(s.role, '\s+-\s+.*$', '') || ' - ' || coalesce(a.team_as_filed, a.team) else s.role end,
         zone = case when s.role ~ '\S\s+-\s+\S' then coalesce(a.team_zone, s.zone) else s.zone end,
         updated_by = (select done_by from cfg), updated_at = now()
    from a join hit h on h.n = a.n
   where a.act = 'ADD' and a.nth = 1 and h.all_n = 1 and s.id = h.any_id
     and (upper(btrim(s.status)) = 'INACTIVE'
          or (s.role ~ '\S\s+-\s+\S' and (s.role is distinct from regexp_replace(s.role, '\s+-\s+.*$', '') || ' - ' || coalesce(a.team_as_filed, a.team)
                                         or s.zone is distinct from coalesce(a.team_zone, s.zone))))
  returning s.id, s.zone, s.role
),
num as (   -- where the staff numbers stand: past every number in use, and past the count of rows
  select greatest(count(*), coalesce(max(case when split_part(id, '/', 2) ~ '^\d{1,6}$' then split_part(id, '/', 2)::int end), 0)) as top
  from staff_registry
),
new as (   -- ADD: a name the registry does not hold at all
  select a.n, a.name,
         (select string_agg(left(w.word, 1), '' order by w.pos)
            from (select regexp_replace(x.raw, '[^A-Z]', '', 'g') as word, x.pos
                    from regexp_split_to_table(a.name, ' ') with ordinality as x(raw, pos)
                   where regexp_replace(x.raw, '[^A-Z]', '', 'g') <> ''
                   order by x.pos limit 3) w) as initials,
         (select top from num) + row_number() over (order by a.n) as serial,
         'FIELD OFFICER - ' || coalesce(a.team_as_filed, a.team) as role,
         coalesce(a.team_zone, (select zone_if_team_unknown from cfg)) as zone
  from a join hit h on h.n = a.n
  where a.act = 'ADD' and a.nth = 1 and h.all_n = 0
),
newid as (
  select n.*, coalesce(nullif(n.initials, ''), 'STF') || '/' || case when n.serial < 1000 then lpad(n.serial::text, 3, '0') else n.serial::text end
              || '/' || to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY') as id
  from new n
),
ins as (
  insert into staff_registry (id, reg_date, name, role, zone, status, created_by, updated_by, updated_at)
  select n.id, (now() at time zone 'Africa/Dar_es_Salaam')::date, n.name, n.role, n.zone, 'Active',
         (select done_by from cfg), (select done_by from cfg), now()
  from newid n
  returning id
)
select a.n as "#", a.team, a.act as asked, a.name,
       case
         when a.nth > 1                                  then 'LISTED TWICE: see the first'
         when a.act = 'REMOVE' and a.add_n is not null   then 'LISTED TO ADD AS WELL: a move, see #' || a.add_n
         when a.act = 'REMOVE' and o.id is not null      then 'MADE INACTIVE'
         when a.act = 'REMOVE' and h.all_n = 0           then 'NOT FOUND: nothing changed'
         when a.act = 'REMOVE' and h.live_n = 0          then 'ALREADY INACTIVE: nothing changed'
         when a.act = 'REMOVE'                           then 'TWO OR MORE OF THAT NAME: nothing changed'
         when i.id is not null                           then 'ADDED'
         when m.id is not null and not was.live          then 'ALREADY STAFF: SWITCHED BACK ON'
         when m.id is not null                           then 'ALREADY STAFF: MOVED TO THIS TEAM'
         when h.all_n = 1                                then 'ALREADY STAFF: nothing changed'
         else                                                 'TWO OR MORE OF THAT NAME: nothing changed'
       end as done,
       coalesce(o.id, i.id, m.id, case when a.act = 'ADD' and h.all_n = 1 then h.any_id end) as staff_id,
       coalesce(o.zone, nw.zone, m.zone, was.zone) as zone,
       coalesce(o.role, nw.role, m.role, was.role) as role,
       nullif(concat_ws(' · ',
         case when a.nth = 1 and a.act = 'REMOVE' and a.add_n is null and h.all_n = 0 then 'nearest names: ' || coalesce((
                select string_agg(r.name_as_filed || ' [' || r.id || ', ' || coalesce(r.zone, 'no zone') || ', ' || r.status || ']', '; ')
                  from (select r2.* from reg r2
                         where (select count(distinct w) from regexp_split_to_table(a.name, ' ') w
                                 where length(w) > 1 and (' ' || r2.name || ' ') like ('% ' || w || ' %')) >= 2
                         order by r2.name limit 4) r), 'none with two of these words') end,
         case when a.nth = 1 and a.add_n is null and a.act = 'REMOVE' and o.id is null and h.all_n > 0 then h.who end,
         case when a.nth = 1 and a.act = 'ADD' and h.all_n > 1 then h.who end,
         case when a.nth = 1 and a.act = 'ADD' and h.all_n = 1 then 'was: ' || coalesce(was.role, 'no role') || ', ' || coalesce(was.zone, 'no zone') || ', ' || was.status
                || case when was.role !~ '\S\s+-\s+\S' then ' (the role has no team part: role and zone left as they are)' else '' end end,
         case when i.id is not null then (
                select 'look: a name like it is already in this zone: ' || string_agg(r.name_as_filed || ' [' || r.id || ', ' || r.status || ']', '; ')
                  from (select r2.* from reg r2
                         where upper(btrim(coalesce(r2.zone, ''))) = nw.zone
                           and (select count(distinct w) from regexp_split_to_table(a.name, ' ') w
                                 where length(w) > 1 and (' ' || r2.name || ' ') like ('% ' || w || ' %')) >= 2
                         order by r2.name limit 3) r) end,
         case when a.nth = 1 and a.act = 'ADD' and a.team_as_filed is null then 'team not found on Teams & Staff under that spelling'
                || case when i.id is not null then ': zone taken as ' || (select zone_if_team_unknown from cfg) else '' end
              when a.nth = 1 and a.act = 'ADD' and a.team_zone is null then 'that team has no zone on Teams & Staff'
                || case when i.id is not null then ': zone taken as ' || (select zone_if_team_unknown from cfg) else '' end end
       ), '') as note
from a
join hit h on h.n = a.n
left join off o    on a.act = 'REMOVE' and a.add_n is null and a.nth = 1 and o.id = h.live_id
left join newid nw on nw.n = a.n
left join ins i    on i.id = nw.id
left join mov m    on a.act = 'ADD' and a.nth = 1 and h.all_n = 1 and m.id = h.any_id
left join reg was  on a.act = 'ADD' and h.all_n = 1 and was.id = h.any_id
order by a.n;
