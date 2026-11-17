-- =====================================================================================
-- TEMPLATE: THE REQUESTS FILED WITH NO STAFF ID, LINKED TO THE REGISTRY RECORD OF THE PERSON THE OWNER NAMES. Undo at the foot. (docs/HANDOFF.md Parts 109 and 110)
--
--   "the missing account numbers at advance salary tabs automatically fill themselves? ... finance manager is pulling that report and needs the column filled" -- the owner, 17 Nov 2026
--
-- WHEN. A call agent picked from the roster was filed with no staff ID (the roster spells the name another way than the registry), and the owner has named the person (their own list gives the full name).
-- Where the registry record is known by its staff ID, TEMPLATE-link-advance-requests-to-staff.sql is the stricter file (the record must carry EVERY word of the roster's name). Copy this file, fill the list,
-- hand the owner the copy. NO STAFF NAME IS EVER COMMITTED: this repository is public.
--
-- ONE ROW FOR EACH PERSON: the name the request carries (as the call-agents roster spelled it) and the name the registry carries now. The person is the only ACTIVE record of the registry whose name is
-- exactly that (capitals, blanks and marks such as an apostrophe aside), and at least ONE word of the request's name must be the same as, or one letter apart from, a word of that name (a guard against a slip
-- of the typing: the pair itself is the owner's word).
-- WHAT IT DOES. It writes the STAFF ID, and nothing else, on the requests of that name that have none. The amount, the state, the zone and every other column stay. Every request changed is written to
-- public.advance_requests_link_log with the staff ID it had. A second run changes nothing. Then the Advance report prints the registry's account, bank and phone for those requests.
-- COST. A few hundred requests and the registry, once. Nothing on uploads or HOPE Calls.
-- =====================================================================================
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local jit = off;

create table if not exists public.advance_requests_link_log (
  id uuid primary key,
  linked_at timestamptz not null default now(),
  staff_name text, staff_id_before text, staff_id_new text not null
);
alter table public.advance_requests_link_log enable row level security;

with want(n, request_name, registry_name) as (values
  (1, 'FIRST SURNAME', 'FIRST MIDDLE SURNAME'),        -- CHANGE: the name on the requests, and the name the registry carries now
  (2, 'SECOND SURNAME', 'SECOND MIDDLE SURNAME')
),
w as (
  select n, request_name, registry_name,
         upper(btrim(regexp_replace(request_name, '\s+', ' ', 'g'))) as rkey,
         btrim(regexp_replace(translate(upper(registry_name), '''`' || chr(8217), ''), '[^A-Z0-9]+', ' ', 'g')) as gk,
         string_to_array(btrim(regexp_replace(translate(upper(request_name), '''`' || chr(8217), ''), '[^A-Z0-9]+', ' ', 'g')), ' ') as rw
  from want
),
reg as (
  select s.id, s.name, upper(btrim(coalesce(s.status, ''))) <> 'INACTIVE' as live,
         btrim(regexp_replace(translate(upper(s.name), '''`' || chr(8217), ''), '[^A-Z0-9]+', ' ', 'g')) as k
  from public.staff_registry s
),
pick as (   -- the only Active record of the name written, and whether a word of the request's name is in it
  select w.n, count(*) filter (where r.live) as live_n, min(r.id) filter (where r.live) as rid, min(r.name) filter (where r.live) as rname,
         bool_or(r.live and exists (select 1 from unnest(w.rw) x, unnest(string_to_array(r.k, ' ')) y
                                     where length(x) >= 3 and length(y) >= 3 and abs(length(x) - length(y)) <= 1
                                       and (select max(g) from generate_series(0, least(length(x), length(y))) g where left(x, g) = left(y, g))
                                         + (select max(g) from generate_series(0, least(length(x), length(y))) g where right(x, g) = right(y, g))
                                         >= greatest(length(x), length(y)) - 1)) as word_ok
  from w left join reg r on r.k = w.gk
  group by w.n
),
ok as (select n, rid from pick where live_n = 1 and word_ok),
todo as (
  select a.id, a.staff_name, a.staff_id as staff_id_was, ok.rid, ok.n
  from public.advance_requests a
  join w on upper(btrim(regexp_replace(a.staff_name, '\s+', ' ', 'g'))) = w.rkey
  join ok on ok.n = w.n
  where a.staff_id is null or btrim(a.staff_id) = ''
),
lg as (
  insert into public.advance_requests_link_log (id, staff_name, staff_id_before, staff_id_new)
  select t.id, t.staff_name, t.staff_id_was, t.rid from todo t
  on conflict (id) do nothing
  returning id
),
upd as (
  update public.advance_requests a set staff_id = t.rid
    from todo t
   where a.id = t.id and (a.staff_id is null or btrim(a.staff_id) = '')
  returning a.id, t.n
)
select w.request_name, w.registry_name, case when p.live_n = 1 then p.rid end as staff_id, case when p.live_n = 1 then p.rname end as registry_spelling,
       case when (select count(*) from upd u where u.n = w.n) > 0 then 'LINKED ' || (select count(*) from upd u where u.n = w.n) || ' REQUEST(S)'
            when p.live_n = 1 and p.word_ok then 'NOTHING TO LINK: no request of this name is without a staff ID'
            when p.live_n = 0 then 'NOT LINKED: no Active record is named exactly so (add the person first, or write the name as the registry spells it)'
            when p.live_n >= 2 then 'NOT LINKED: ' || p.live_n || ' Active records are named exactly so; the script never chooses'
            else 'NOT LINKED: no word of the request''s name is in the registry name (nothing changed)' end as done
from w join pick p on p.n = w.n
order by w.n;

-- UNDO: take the two dashes off the line below and run it: every request this script linked goes back to the staff ID it had (the log is kept).
-- update public.advance_requests a set staff_id = l.staff_id_before from public.advance_requests_link_log l where a.id = l.id and a.staff_id = l.staff_id_new;
