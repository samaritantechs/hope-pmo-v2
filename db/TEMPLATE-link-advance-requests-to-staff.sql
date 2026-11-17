-- =====================================================================================
-- TEMPLATE: SALARY ADVANCE REQUESTS FILED WITH NO STAFF ID, LINKED TO THE REGISTRY RECORD THAT CARRIES THE NAME. Undo at the foot. (docs/HANDOFF.md Part 109)
--
-- HOW TO USE IT. In the VALUES list below, one row for each person: the name as the call-agents roster spells it (the name on their requests), and the staff ID of the registry record you say is
-- the same person (RUN-ME-073 prints the candidates: the Active records that carry every word of the roster's name). The two sample rows name nobody: they answer "NOT LINKED". No name and no staff
-- ID of a real person is written in the repository.
--
--   "the missing account numbers at advance salary tabs automatically fill themselves? ... finance manager is pulling that report and needs the column filled" -- the owner, 17 Nov 2026
--
-- WHAT IS WRONG. The request tab gives a roster name its staff ID only when the roster and the registry spell the name the same way. When they do not (the registry's name has one more word, or
-- a letter differs), the request is filed with no staff ID. A request filed with no
-- staff ID cannot be matched to the registry by the Advance report, so its account, bank and phone print blank.
-- WHAT IT DOES. It writes the STAFF ID, and nothing else, on the requests of each name below that have none. The amount, the state, the zone and every other column of a request stay as they are.
-- A request is changed ONLY WHEN ALL FOUR HOLD: (1) its staff ID is empty; (2) its name is the roster name written below (capitals and blanks aside); (3) the staff ID written beside the name is an
-- ACTIVE record of the registry that carries EVERY WORD of that name; (4) it is the ONLY Active record that does (the script never chooses between two people).
-- The answer says, for each name, what it did and the registry's own spelling of the name, so that you can see who was linked. Every request changed is written to
-- public.advance_requests_link_log (a log nothing reads). A second run changes nothing.
-- AFTER IT. The report prints their account, bank and phone from the registry. A NEXT request from the same name is filed with no staff ID again, until the roster (Settings, Call agents) spells the
-- name as the registry does: the answer prints that spelling. THE PERSON IS THE OWNER'S TO SAY: the script checks that the record carries every word of the name and is the only Active one that does;
-- it cannot know that they are the same human being.
-- COST. A few hundred requests and the registry, once. A fraction of a second. Nothing on uploads or HOPE Calls.
-- =====================================================================================
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local jit = off;

create table if not exists public.advance_requests_link_log (
  id uuid primary key,                       -- the request that was linked
  linked_at timestamptz not null default now(),
  staff_name text, staff_id_before text, staff_id_new text not null
);
alter table public.advance_requests_link_log enable row level security;

with want(n, roster_name, staff_id) as (values
  (1, 'FIRST SURNAME', 'AAA/0000/2026'),        -- CHANGE: the name on the requests, and the staff ID of the registry record that is the same person
  (2, 'SECOND SURNAME', 'AAA/0001/2026')        -- CHANGE (or delete this row and the comma above it)
),
w as (
  select n, roster_name, upper(btrim(staff_id)) as staff_id,
         upper(btrim(regexp_replace(roster_name, '\s+', ' ', 'g'))) as key,
         regexp_split_to_array(upper(btrim(regexp_replace(roster_name, '\s+', ' ', 'g'))), ' ') as words
  from want
),
cand as (                                   -- every Active record that carries every word of the name
  select w.n, r.id, r.name, r.role, r.zone
  from w
  join public.staff_registry r on upper(btrim(coalesce(r.status, ''))) <> 'INACTIVE'
                              and not exists (select 1 from unnest(w.words) x where strpos(upper(r.name), x) = 0)
),
chk as (
  select w.n, w.roster_name, w.staff_id,
         (select count(*) from cand c where c.n = w.n) as n_carrying,
         (select count(*) from cand c where c.n = w.n and c.id = w.staff_id) as is_it
  from w
),
ok as (select n, staff_id from chk where n_carrying = 1 and is_it = 1),
todo as (                                   -- the requests of the name that have no staff ID
  select a.id, a.staff_name, a.staff_id as staff_id_was, ok.staff_id, ok.n
  from public.advance_requests a
  join w on upper(btrim(regexp_replace(a.staff_name, '\s+', ' ', 'g'))) = w.key
  join ok on ok.n = w.n
  where a.staff_id is null or btrim(a.staff_id) = ''
),
lg as (
  insert into public.advance_requests_link_log (id, staff_name, staff_id_before, staff_id_new)
  select t.id, t.staff_name, t.staff_id_was, t.staff_id from todo t
  on conflict (id) do nothing
  returning id
),
upd as (
  update public.advance_requests a set staff_id = t.staff_id
    from todo t
   where a.id = t.id and (a.staff_id is null or btrim(a.staff_id) = '')
  returning a.id, t.n
)
select w.roster_name, w.staff_id,
       (select upper(regexp_replace(btrim(r.name), '\s+', ' ', 'g')) from public.staff_registry r where r.id = w.staff_id)  as registry_spelling,
       case when (select count(*) from upd u where u.n = w.n) > 0
              then 'LINKED ' || (select count(*) from upd u where u.n = w.n) || ' REQUEST(S)'
            when c.n_carrying = 1 and c.is_it = 1
              then 'NOTHING TO LINK: no request of this name is without a staff ID'
            when c.n_carrying = 0
              then 'NOT LINKED: no Active record carries every word of this name (nothing changed)'
            when c.is_it = 0
              then 'NOT LINKED: that staff ID is not an Active record carrying every word of the name (nothing changed)'
            else 'NOT LINKED: ' || c.n_carrying || ' Active records carry every word of this name; the script never chooses (nothing changed)'
       end as done
from w join chk c on c.n = w.n
order by w.n;

-- UNDO: take the two dashes off the lines below and run them: every request this script linked goes back to the staff ID it had (the log is kept).
-- update public.advance_requests a set staff_id = l.staff_id_before from public.advance_requests_link_log l where a.id = l.id and a.staff_id = l.staff_id_new;
