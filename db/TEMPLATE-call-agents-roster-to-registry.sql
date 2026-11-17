-- =====================================================================================
-- TEMPLATE: THE CALL-AGENTS ROSTER (SETTINGS, CALL AGENTS), ITS NAMES TYPED AS THE REGISTRY SPELLS THEM. Undo at the foot. (docs/HANDOFF.md Parts 109 and 110)
--
--   "the missing account numbers at advance salary tabs automatically fill themselves? ... finance manager is pulling that report and needs the column filled" -- the owner, 17 Nov 2026
--
-- WHEN. RUN-ME-073 shows roster names the request tab cannot find in the registry. Copy this file, fill the list, hand the owner the copy. NO STAFF NAME IS EVER COMMITTED: this repository is public.
--
-- WHY. The request tab gives a roster name its registry row, and so the staff ID and the account, only when the roster's name and the registry's name are the same letters and blanks. A request filed
-- from a roster name the registry spells another way has no staff ID, and the Advance report cannot print its account.
-- ONE ROW FOR EACH NAME: the name as the roster has it now, and the name the registry carries. The roster name is replaced, wherever it stands in a roster row (a row holds one or several names,
-- separated by commas or semicolons), by THE REGISTRY'S OWN SPELLING, and ONLY IF the registry carries exactly one ACTIVE record named exactly so (capitals, blanks and marks such as an apostrophe aside).
-- Nothing else in a roster row changes: the user_id (the CREATED BY the loans are counted by), the other names, nothing is added or removed. A row is rewritten only if one of its names was replaced.
-- BEFORE ANYTHING IS CHANGED each roster row about to change is copied to public.call_agents_names_before (a copy nothing reads) under the label below; the undo at the foot puts every one back.
-- A second run changes nothing. COST. The roster (dozens of rows) and the registry, once. Nothing on uploads or HOPE Calls.
-- =====================================================================================
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local jit = off;

create table if not exists public.call_agents_names_before (
  user_id text not null, label text not null, saved_at timestamptz not null default now(), names text, updated_at timestamptz
);
alter table public.call_agents_names_before enable row level security;

with cfg as (select 'CALL AGENTS ROSTER (SQL)'::text as label),          -- CHANGE: a new label for a new batch
want(n, old_name, new_name) as (values
  (1,  'FIRST SURNAME',  'FIRST MIDDLE SURNAME'),        -- CHANGE: the name as the roster has it, and the name the registry carries
  (2,  'SECOND SURNAME', 'SECOND MIDDLE SURNAME')
),
w as (
  select n, old_name, new_name,
         regexp_replace(upper(btrim(old_name, E' \t\r\n')), '\s+', ' ', 'g') as ok_,
         btrim(regexp_replace(translate(upper(new_name), '''`' || chr(8217), ''), '[^A-Z0-9]+', ' ', 'g')) as nk
  from want
),
reg as (
  select s.id, s.name, btrim(regexp_replace(translate(upper(s.name), '''`' || chr(8217), ''), '[^A-Z0-9]+', ' ', 'g')) as k
  from public.staff_registry s where upper(btrim(coalesce(s.status, ''))) <> 'INACTIVE'
),
tgt as (   -- the registry's spelling of each new name: only if exactly one Active record carries it
  select w.n, w.old_name, count(r.id) as cnt, min(btrim(r.name)) as spelled
  from w left join reg r on r.k = w.nk
  group by w.n, w.old_name
),
parts as (   -- every name of every roster row, in order
  select c.user_id, c.names, p.ord, btrim(p.part, E' \t\r\n') as part
  from public.call_agents c
  cross join lateral regexp_split_to_table(coalesce(c.names, ''), '[,;]') with ordinality as p(part, ord)
  where btrim(p.part, E' \t\r\n') <> ''
),
mapped as (   -- each name: what it becomes (the registry's spelling) when it is one of the names above and the registry has exactly one Active record of the new name
  select pa.user_id, pa.names, pa.ord, pa.part,
         coalesce((select t.spelled from tgt t join w on w.n = t.n where regexp_replace(upper(pa.part), '\s+', ' ', 'g') = w.ok_ and t.cnt = 1 limit 1), pa.part) as new_part
  from parts pa
),
rows_ as (
  select m.user_id, m.names as old_names, string_agg(m.new_part, ', ' order by m.ord) as new_names, bool_or(m.new_part <> m.part) as changes
  from mapped m group by m.user_id, m.names
),
todo as (select r.* from rows_ r where r.changes),
snap as (
  insert into public.call_agents_names_before (user_id, label, names, updated_at)
  select c.user_id, (select label from cfg), c.names, c.updated_at
  from public.call_agents c join todo t on t.user_id = c.user_id
  where not exists (select 1 from public.call_agents_names_before z where z.user_id = c.user_id and z.label = (select label from cfg))
  returning user_id
),
upd as (
  update public.call_agents c set names = t.new_names, updated_at = now()
    from todo t where c.user_id = t.user_id and c.names is not distinct from t.old_names
  returning c.user_id
)
select w.n as "#", w.old_name as roster_name, w.new_name as registry_name, case when t.cnt = 1 then t.spelled end as registry_spelling,
       case when t.cnt = 0 then 'NOT CHANGED: no Active record is named exactly so'
            when t.cnt >= 2 then 'NOT CHANGED: ' || t.cnt || ' Active records are named exactly so'
            when exists (select 1 from mapped m where regexp_replace(upper(m.part), '\s+', ' ', 'g') = w.ok_) then 'REPLACED on ' || (select count(distinct m.user_id) from mapped m where regexp_replace(upper(m.part), '\s+', ' ', 'g') = w.ok_) || ' roster row(s)'
            else 'NOT ON THE ROSTER (or already written as the registry spells it)' end as done
from w join tgt t on t.n = w.n
order by w.n;

-- UNDO: take the two dashes off the three lines below and run them: every roster row this script changed goes back to the names it had. The copies stay.
-- update public.call_agents c set names = b.names, updated_at = b.updated_at
--   from public.call_agents_names_before b
--   where b.user_id = c.user_id and b.label = 'CALL AGENTS ROSTER (SQL)';
