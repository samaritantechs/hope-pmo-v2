-- =====================================================================================
-- TEMPLATE: TWO STAFF RECORDS, ONE NAME -- WHICH ONE STAYS? (READ-ONLY: changes nothing)
--
--   An update (db/TEMPLATE-staff-update-by-id.sql) prints "LOOK: another staff already carries the name sent: <ID> [status]" when the name it
--   writes is already on ANOTHER staff record. A script never merges two staff records on a name alone (docs/HANDOFF.md Part 101), so this
--   puts the two side by side and the owner says which one stays; the other is switched to Inactive (TEMPLATE-staff-changes-by-id.sql, OFF).
--   NO STAFF NAME, NUMBER OR ACCOUNT IS EVER COMMITTED: this repository is public. Copy this file, put the pairs' staff IDs in the list, hand the
--   owner the copy. It prints NO PHONE, ACCOUNT, NIDA OR ADDRESS: for each box only whether the two records agree.
--
-- ONE ROW OF THE LIST FOR EACH PAIR: n, a_id, b_id (the two staff IDs).
-- ONE ROW COMES BACK FOR EACH PAIR: the status, role, zone, start date and who created or last changed each record, for each box whether the two
--   records hold the same thing ("same"), different things ("DIFFERENT"), only one of them ("only A", "only B") or neither ("-"), and how many salary
--   advance requests each record has (a request is kept against a staff ID: switching a record off does not move them).
-- COST. Two staff rows and their requests for each pair. Nothing on uploads, nothing on HOPE Calls.
-- =====================================================================================
set local statement_timeout = '15s';
set local jit = off;

with pairs(n, a_id, b_id) as (values
  (1, 'ABC/0001/2026', 'XYZ/0002/2026')
),
x as (   -- each side's record, every box read the way the staff form reads it, so the same number written another way is the same
  select p.n, p.a_id, p.b_id,
         a.status as a_status, b.status as b_status, a.role as a_role, b.role as b_role, a.zone as a_zone, b.zone as b_zone,
         a.reg_date as a_start, b.reg_date as b_start, a.created_by as a_by, b.created_by as b_by, a.created_at::date as a_made, b.created_at::date as b_made,
         a.updated_by as a_upd, b.updated_by as b_upd,
         regexp_replace(upper(btrim(a.name)), '\s+', ' ', 'g') as a_name, regexp_replace(upper(btrim(b.name)), '\s+', ' ', 'g') as b_name,
         (a.id is not null) as a_found, (b.id is not null) as b_found,
         jsonb_build_object(
           'phone',     array[right(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), 9), right(regexp_replace(coalesce(b.phone, ''), '\D', '', 'g'), 9)],
           'bank',      array[upper(coalesce(btrim(a.bank), '')), upper(coalesce(btrim(b.bank), ''))],
           'account',   array[upper(regexp_replace(coalesce(a.account, ''), '[\s.-]', '', 'g')), upper(regexp_replace(coalesce(b.account, ''), '[\s.-]', '', 'g'))],
           'nida',      array[regexp_replace(coalesce(a.nida, ''), '\D', '', 'g'), regexp_replace(coalesce(b.nida, ''), '\D', '', 'g')],
           'tin',       array[regexp_replace(coalesce(a.tin, ''), '\D', '', 'g'), regexp_replace(coalesce(b.tin, ''), '\D', '', 'g')],
           'nssf',      array[regexp_replace(coalesce(a.nssf, ''), '\D', '', 'g'), regexp_replace(coalesce(b.nssf, ''), '\D', '', 'g')],
           'birth',     array[coalesce(a.birth_date::text, ''), coalesce(b.birth_date::text, '')],
           'residence', array[regexp_replace(upper(btrim(coalesce(a.residence, ''))), '\s+', ' ', 'g'), regexp_replace(upper(btrim(coalesce(b.residence, ''))), '\s+', ' ', 'g')]
         ) as boxes,
         (select count(*) from advance_requests q where q.staff_id = p.a_id) as a_requests,
         (select count(*) from advance_requests q where q.staff_id = p.b_id) as b_requests,
         (select max(q.submitted_at)::date from advance_requests q where q.staff_id = p.a_id) as a_last_request,
         (select max(q.submitted_at)::date from advance_requests q where q.staff_id = p.b_id) as b_last_request
  from pairs p left join staff_registry a on a.id = p.a_id left join staff_registry b on b.id = p.b_id
)
select x.n as "#", x.a_id, x.b_id,
       case when not x.a_found and not x.b_found then 'NEITHER ID IS IN THE REGISTRY' when not x.a_found then 'A IS NOT IN THE REGISTRY' when not x.b_found then 'B IS NOT IN THE REGISTRY'
            when x.a_name = x.b_name then 'the same name' else 'DIFFERENT NAMES' end as names,
       x.a_status, x.b_status, x.a_role, x.b_role, x.a_zone, x.b_zone, x.a_start, x.b_start,
       x.a_by, x.b_by, x.a_made, x.b_made, x.a_upd, x.b_upd,
       x.a_requests, x.b_requests, x.a_last_request, x.b_last_request,
       (select string_agg(k || ': ' || case when btrim(v->>0) = '' and btrim(v->>1) = '' then '-' when btrim(v->>0) = '' then 'only B' when btrim(v->>1) = '' then 'only A'
                                            when v->>0 = v->>1 then 'same' else 'DIFFERENT' end, ' | ' order by k)
          from jsonb_each(x.boxes) e(k, v)) as boxes
from x
order by x.n;
