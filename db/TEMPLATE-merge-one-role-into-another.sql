-- ONE ROLE MERGED INTO ANOTHER, THEN ITS ROW ON ROLES & ACCESS REMOVED. 24 Nov 2026 (handbook Part 144).
-- As it is (the word COUNT) it CHANGES NOTHING and prints where the first role's NAME is used and what a move would do.
-- Then change COUNT to MOVE on the line marked CHANGE and run it again. Any other word changes nothing.
-- MOVE renames the first role to the second on access codes, phones, the staff registry (the role before " - TEAM"),
-- other roles' approver and Pending requests, then deletes the first role's row. Lines 9 to 13 are NOT moved: yours.
-- Every change is kept in public.role_merge_log; the UNDO is the last comment line. A second MOVE changes nothing.
set local statement_timeout = '30s';
set local lock_timeout = '3s';
create table if not exists public.role_merge_log (id bigint generated always as identity primary key, at timestamptz not null default now(),
label text not null, tbl text not null, k text not null, old text, new text);
alter table public.role_merge_log enable row level security;
revoke all on public.role_merge_log from anon, authenticated;
with p as (select upper(btrim('COLLECTION')) as a, -- THE ROLE TO REMOVE
upper(btrim('PMO COLLECTION')) as b, -- THE ROLE THAT STAYS
upper(btrim('COUNT')) as m), -- CHANGE: COUNT changes nothing; MOVE writes
ra as (select r.* from public.roles r, p where upper(btrim(r.role)) = p.a),
rb as (select r.* from public.roles r, p where upper(btrim(r.role)) = p.b limit 1),
ok as (select (select m = 'MOVE' and a <> b and a not in ('', 'ADMIN') from p) and exists (select 1 from rb) as go),
lb as (select 'ROLE MERGE: ' || a || ' > ' || b as label, (select role from rb) as nb,
'^[^A-Za-z0-9]*' || regexp_replace(a, '[^A-Z0-9]+', '[^A-Za-z0-9]+', 'g') || '(?![A-Za-z0-9])' as re from p),
c0 as (select c.code as k, c.role as old, c.name from public.access_codes c, p where upper(btrim(c.role)) = p.a),
u0 as (select u.user_id as k, u.role as old from public.call_users u, p where upper(btrim(u.role)) = p.a),
s0 as (select s.id as k, s.role as old, regexp_replace(s.role, lb.re, lb.nb, 'i') as new, s.status from public.staff_registry s, lb where s.role ~* lb.re),
r0 as (select r.role as k, r.approver_role as old from public.roles r, p where upper(btrim(r.approver_role)) = p.a and upper(btrim(r.role)) <> p.a),
a0 as (select q.id::text as k, q.req_role as old from public.advance_requests q, p where upper(btrim(q.req_role)) = p.a and q.approval = 'Pending'),
l0 as (select q.id::text as k, q.req_role as old from public.leave_requests q, p where upper(btrim(q.req_role)) = p.a and q.approval = 'Pending'),
c1 as (update public.access_codes c set role = lb.nb from c0, lb where c.code = c0.k and (select go from ok) returning 1),
u1 as (update public.call_users u set role = lb.nb from u0, lb where u.user_id = u0.k and (select go from ok) returning 1),
s1 as (update public.staff_registry s set role = s0.new from s0 where s.id = s0.k and (select go from ok) returning 1),
r1 as (update public.roles r set approver_role = lb.nb from r0, lb where r.role = r0.k and (select go from ok) returning 1),
a1 as (update public.advance_requests q set req_role = lb.nb from a0, lb where q.id::text = a0.k and (select go from ok) returning 1),
l1 as (update public.leave_requests q set req_role = lb.nb from l0, lb where q.id::text = l0.k and (select go from ok) returning 1),
d1 as (delete from public.roles r using ra where r.role = ra.role and (select go from ok) returning 1),
lg as (insert into public.role_merge_log (label, tbl, k, old, new)
select lb.label, x.tbl, x.k, x.old, x.new from lb, (
select 'access_codes' as tbl, k, old, (select nb from lb) as new from c0
union all select 'call_users', k, old, (select nb from lb) from u0
union all select 'staff_registry', k, old, new from s0
union all select 'roles.approver_role', k, old, (select nb from lb) from r0
union all select 'advance_requests', k, old, (select nb from lb) from a0
union all select 'leave_requests', k, old, (select nb from lb) from l0
union all select 'roles.row', role, to_jsonb(ra)::text, null from ra) x where (select go from ok) returning 1),
plan as (select coalesce((select value::jsonb -> 'roles' from public.settings where key = 'DAILY_CHECKLIST'), '{}'::jsonb) as j),
tasks as (select (select count(*) from jsonb_each(coalesce(plan.j -> p.a, '{}'::jsonb)) d, jsonb_array_elements(d.value)) as na,
(select count(*) from jsonb_each(coalesce(plan.j -> p.b, '{}'::jsonb)) d, jsonb_array_elements(d.value)) as nb from plan, p)
select x.n, x.what, x.answer from (
select 1 as n, 'the word on the CHANGE line' as what, (select m || case when m = 'MOVE' and (select go from ok) then ': MOVED'
when m = 'MOVE' then ': NOT MOVED, see line 2' when m = 'COUNT' then ': nothing was changed; below is what MOVE would do' else ': not COUNT or MOVE, nothing was changed' end from p) as answer
union all select 2, 'the two roles on Roles & access', (select a || case when exists (select 1 from ra) then ': has a row' else ': HAS NO ROW (nothing to delete)' end
|| ' / ' || b || case when exists (select 1 from rb) then ': has a row' else ': HAS NO ROW, so nothing can be moved to it' end
|| case when a = b or a in ('', 'ADMIN') then ' / THIS ROLE IS NEVER REMOVED' else '' end from p)
union all select 3, 'access codes on the first role: moved', (select count(*) || coalesce(': ' || string_agg(name, ', ' order by name), '') from c0)
union all select 4, 'phones registered under it: moved', (select count(*)::text from u0)
union all select 5, 'staff registry roles that begin with it (Active / all): renamed, team kept', (select count(*) filter (where status = 'Active') || ' / ' || count(*) from s0)
union all select 6, 'roles approved by the first role: pointed at the second', (select count(*) || coalesce(': ' || string_agg(k, ', ' order by k), '') from r0)
union all select 7, 'Pending requests filed under it (advance / leave): moved', (select (select count(*) from a0) || ' / ' || (select count(*) from l0))
union all select 8, 'the first role''s row on Roles & access: deleted', (select case when exists (select 1 from ra) then 'yes' else 'there is none' end)
union all select 9, 'NOT MOVED: tabs only the first role has (tick them on the second if wanted)', (select coalesce(string_agg(t, ', ' order by t), 'none')
from (select unnest(coalesce((select tabs from ra limit 1), '{}')) as t except select unnest(coalesce((select tabs from rb), '{}'))) q)
union all select 10, 'NOT MOVED: approver of advances and leave, first / second role', (select coalesce((select coalesce(approver_role, '') || case when approver_code is not null then ' + a named person' else '' end from ra limit 1), '-')
|| ' / ' || coalesce((select coalesce(approver_role, '') || case when approver_code is not null then ' + a named person' else '' end from rb), '-'))
union all select 11, 'NOT MOVED: daily checklist tasks, first / second role', (select na || ' / ' || nb from tasks)
union all select 12, 'NOT MOVED: imprest accommodation rate, first / second role', (select coalesce((select accommodation_per_day::text from public.imprest_roles i, p where upper(btrim(i.role)) = p.a limit 1), 'no rate')
|| ' / ' || coalesce((select accommodation_per_day::text from public.imprest_roles i, p where upper(btrim(i.role)) = p.b limit 1), 'no rate'))
union all select 13, 'NOT MOVED: settings that name the first role', (select coalesce(string_agg(s.key, ', ' order by s.key), 'none')
from public.settings s, p where s.key <> 'DAILY_CHECKLIST' and position(p.a in replace(upper(s.value), p.b, '')) > 0)
union all select 14, 'role names on access codes read as collection officers', (select coalesce(string_agg(r || ': ' || c, ', ' order by r), 'none')
from (select upper(btrim(role)) as r, count(*) as c from public.access_codes where upper(role) ~ '(^|[^A-Z0-9])(COLLECTION|COLLECTOR)($|[^A-Z0-9])' group by 1) q)
union all select 15, 'WRITTEN BY THIS RUN: rows changed / role row deleted', (select ((select count(*) from c1) + (select count(*) from u1) + (select count(*) from s1)
+ (select count(*) from r1) + (select count(*) from a1) + (select count(*) from l1)) || ' / ' || (select count(*) from d1) || ' (log rows: ' || (select count(*) from lg) || ')')
) x order by x.n;
-- UNDO, as one statement, alone (it puts back only what is still as this script left it):
-- with l as (select * from public.role_merge_log where label = 'ROLE MERGE: COLLECTION > PMO COLLECTION'), a as (update public.access_codes t set role = l.old from l where l.tbl = 'access_codes' and t.code = l.k and t.role = l.new returning 1), b as (update public.call_users t set role = l.old from l where l.tbl = 'call_users' and t.user_id = l.k and t.role = l.new returning 1), c as (update public.staff_registry t set role = l.old from l where l.tbl = 'staff_registry' and t.id = l.k and t.role = l.new returning 1), d as (update public.roles t set approver_role = l.old from l where l.tbl = 'roles.approver_role' and t.role = l.k and t.approver_role = l.new returning 1), e as (update public.advance_requests t set req_role = l.old from l where l.tbl = 'advance_requests' and t.id::text = l.k and t.req_role = l.new returning 1), f as (update public.leave_requests t set req_role = l.old from l where l.tbl = 'leave_requests' and t.id::text = l.k and t.req_role = l.new returning 1), g as (insert into public.roles select (jsonb_populate_record(null::public.roles, l.old::jsonb)).* from l where l.tbl = 'roles.row' on conflict (role) do nothing returning 1), z as (delete from public.role_merge_log where label = 'ROLE MERGE: COLLECTION > PMO COLLECTION' returning 1) select (select count(*) from a) + (select count(*) from b) + (select count(*) from c) + (select count(*) from d) + (select count(*) from e) + (select count(*) from f) as rows_put_back, (select count(*) from g) as role_rows_restored, (select count(*) from z) as log_rows_cleared;
-- END OF THE ROLE MERGE
