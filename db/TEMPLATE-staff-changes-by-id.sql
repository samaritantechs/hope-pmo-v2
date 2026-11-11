-- =====================================================================================
-- TEMPLATE: STAFF SWITCHED TO INACTIVE BY STAFF ID
--
-- The second step of TEMPLATE-staff-changes-from-gmo.sql. A name the GMO wrote that the
-- registry spells differently comes back "NOT FOUND" with the nearest names beside it. Once the
-- right person is clear, they are switched off HERE, by staff ID, and the registry's spelling
-- is KEPT ("dont correct names using the gmo data i bring unless its new staff").
--
-- Each row is changed only if the ID still carries the name written beside it, so a mistyped
-- ID cannot switch off somebody else. One row comes back for each ID, saying what was done.
-- Safe to run again. NO STAFF NAME IS EVER COMMITTED: the filled copy goes to the owner.
-- =====================================================================================
set local lock_timeout = '5s';
set local statement_timeout = '30s';

with want(id, name) as (values                 -- the staff ID, and the name the REGISTRY has on it (capitals, single spaces)
  ('ABC/0001/2026', 'FIRST MIDDLE LAST'),
  ('DEF/0002/2026', 'FIRST MIDDLE LAST')
),
was as (   -- each ID as it stands before anything is changed
  select w.id as want_id, w.name as want_name, s.id, s.name, s.zone, s.role, s.status,
         regexp_replace(upper(btrim(s.name)), '\s+', ' ', 'g') = w.name as same_name
  from want w left join staff_registry s on s.id = w.id
),
off as (
  update staff_registry s
     set status = 'Inactive', updated_by = 'GMO ZONE NAME (SQL)', updated_at = now()
    from was
   where s.id = was.id and was.same_name and upper(btrim(was.status)) <> 'INACTIVE'
  returning s.id
)
select was.want_id as staff_id, coalesce(was.name, was.want_name) as name_in_registry, was.zone, was.role,
       case when o.id is not null        then 'MADE INACTIVE'
            when was.id is null          then 'NO STAFF WITH THAT ID: nothing changed'
            when not was.same_name       then 'THAT ID NOW CARRIES ANOTHER NAME: nothing changed'
            else                              'ALREADY INACTIVE: nothing changed'
       end as done
from was left join off o on o.id = was.id
order by was.want_id;
