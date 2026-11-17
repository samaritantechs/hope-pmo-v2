-- =====================================================================================
-- TEMPLATE: STAFF ACCOUNTS AND BANKS BROUGHT BY THE OWNER -- THE DETAILS SENT ARE THE LATEST. Found by staff ID, or by EXACT NAME; added if nobody is close; listed if somebody is.
--
--   "Customer service staff accounts" -- the owner, 17 Nov 2026 (twelve people with their bank and account)
--   "some info should be filled into their columns if missing or replace if existing since the provided is latest" -- the owner, 17 Nov 2026 (docs/HANDOFF.md Parts 101 and 110)
--
-- WHEN. The owner brings names with their accounts (and sometimes more of a form) and the registry's staff IDs are not known. Copy this file, fill the list, hand the owner the copy: new query,
-- paste, Run (the comments may be stripped for the paste: the answer is the same). NO STAFF NAME, NUMBER OR ACCOUNT IS EVER COMMITTED: this repository is public. The filled copy goes to the owner.
--
-- ONE ROW OF THE LIST FOR EACH PERSON (the columns are those of TEMPLATE-staff-update-by-id.sql). With a staff ID (which the owner's own answers printed) the person is found by that ID AND by the name the
-- registry carries now, so a mistyped ID cannot update somebody else. With NO staff ID the person is found by their name, and only when exactly ONE ACTIVE record of the registry carries exactly that name
-- (capitals, blanks and marks such as an apostrophe aside).
-- THEN, as TEMPLATE-staff-update-by-id.sql does it: a box the row GIVES is written, FILLED if it was empty, REPLACED if it held something else, "same" if it already holds it; a box the row leaves null is
-- never touched. The ROLE, ZONE and STATUS are never touched. A NIDA that is not twenty digits is never written. The NAME is replaced only on a row that gives a new_name.
-- A PERSON WHO IS NOT FOUND is never guessed at. If the registry holds somebody CLOSE (the same account on another record, or two words of the name the same or one letter apart), the row says
-- NOT FOUND and LISTS them, with their staff ID and the registry's own spelling, and changes nothing: say which is the person and they are asked again by staff ID. If NOBODY is close and a zone named
-- as written on the line marked CHANGE is already filed, the person is ADDED: Active, with the role on that line, the next staff ID (initials / number / year, past every number in use) and the details sent.
-- Two Active records with the same name, or an Inactive record alone, are never touched: the row says so. A BANK IS NEVER GUESSED FROM AN ACCOUNT NUMBER: a row with no bank leaves the bank as it is.
-- WHY NOT TEMPLATE-staff-changes-from-gmo.sql FOR THIS: its PLACE, on a row with no role, writes back the FIRST WORDS of the role of a person it finds ("CALL AGENT - ASSISTANT SUPERVISOR" becomes
-- "CALL AGENT"). This file never touches a role.
-- BEFORE ANYTHING IS CHANGED each staff row about to change is copied to staff_registry_update_before under the label on the line marked CHANGE. The undo at the foot puts every one of them back, and
-- removes the staff this run added. SAFE TO RUN AGAIN: the second run changes nothing and says so.
-- PRINTS, for each person: what was done, the staff ID, which boxes were filled, replaced or already the same, by NAME OF THE BOX. NO PHONE, ACCOUNT, NIDA OR OTHER VALUE IS PRINTED.
-- COST. Reads and writes the staff registry only (a few thousand rows; the list is a dozen): 0.3 s at 5,000 staff on the test machine (not measured on the live book). Nothing on uploads, nothing on HOPE Calls.
-- =====================================================================================
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local jit = off;

create table if not exists public.staff_registry_update_before (
  id text not null, label text not null, saved_at timestamptz not null default now(),
  name text, phone text, phone2 text, bank text, account text, nida text, tin text, nssf text, birth_date date, residence text, reg_date date,
  guarantor1 text, guarantor1_phone text, guarantor2 text, guarantor2_phone text, updated_by text, updated_at timestamptz
);
alter table public.staff_registry_update_before enable row level security;

with cfg as (
  select 'STAFF ACCOUNTS (SQL)'::text as label,          -- CHANGE: a new label for a new batch; written beside every row changed or added, and on its copy for the undo
         'CALL AGENT'::text as new_role,                        -- CHANGE: the role of a staff ADDED here, as the registry spells it for the people already there
         'HQ - CUSTOMER SERVICE'::text as new_zone              -- CHANGE: the department, as the registry files it: a staff is added only if a zone of this name is already filed
),
ask(n, id, cur_name, new_name, phone, phone2, bank, account, nida, tin, nssf, birth, residence, started, kin1, kin1_phone, kin2, kin2_phone) as (values
  (1,  null::text, 'FIRST MIDDLE LAST', null::text, null::text, null::text, 'BANK', '0000000000', null::text, null::text, null::text, null::date, null::text, null::date, null::text, null::text, null::text, null::text),
  (2,  'ABC/0001/2026', 'SECOND MIDDLE LAST', null, null, null, null, '0000000001', null, null, null, null, null, null, null, null, null, null),
  (3,  'ABC/0002/2026', 'OLD NAME AS FILED', 'NAME AS SENT', '0700000000', null, 'BANK', '0000000002', null, null, null, null, null, null, null, null, null, null)
),
ak0 as (   -- each row's name as ONE comparable key: capitals, an apostrophe dropped, any other mark a blank, runs of blanks as one
  select s.*, btrim(regexp_replace(translate(upper(s.cur_name), '''`' || chr(8217), ''), '[^A-Z0-9]+', ' ', 'g')) as k
  from ask s
),
ak as (    -- ... and whether the same person is listed twice (the first row is the one that counts)
  select s.*, row_number() over (partition by coalesce(upper(btrim(s.id)), s.k) order by s.n) as nth
  from ak0 s
),
rg as (    -- the registry as it stands
  select s.id, s.name, s.status, s.role, s.zone,
         btrim(regexp_replace(translate(upper(s.name), '''`' || chr(8217), ''), '[^A-Z0-9]+', ' ', 'g')) as k,
         upper(btrim(coalesce(s.status, ''))) <> 'INACTIVE' as live,
         ltrim(regexp_replace(upper(coalesce(s.account, '')), '[^A-Z0-9]', '', 'g'), '0') as akey
  from staff_registry s
),
res as (   -- the staff a row with no ID means: the only ACTIVE record that carries exactly this name
  select a.n, count(*) filter (where r.live) as live_n, count(r.id) as all_n,
         min(r.id) filter (where r.live) as live_id,
         string_agg(r.id || ' [' || r.status || ']', '; ' order by r.id collate "C") as ids
  from ak a left join rg r on a.id is null and r.k = a.k
  group by a.n
),
want as (  -- the list as the update below reads it: the staff ID typed, or the one the exact name gave
  select a.n, case when a.nth > 1 then null else coalesce(upper(btrim(a.id)), case when r.live_n = 1 then r.live_id end) end as id,
         a.cur_name, a.new_name, a.phone, a.phone2, a.bank, a.account, a.nida, a.tin, a.nssf, a.birth, a.residence, a.started, a.kin1, a.kin1_phone, a.kin2, a.kin2_phone
  from ak a join res r on r.n = a.n
),
a as (   -- each row as it is compared: names in capitals with single spaces, numbers as the staff form stores them
  select w.*,
         regexp_replace(upper(btrim(w.cur_name)), '\s+', ' ', 'g') as cur_key,
         nullif(regexp_replace(upper(btrim(w.new_name)), '\s+', ' ', 'g'), '') as new_key,
         btrim(regexp_replace(translate(upper(w.cur_name), '''`' || chr(8217), ''), '[^A-Z0-9]+', ' ', 'g')) as cur_k,
         nullif(btrim(regexp_replace(translate(upper(coalesce(w.new_name, '')), '''`' || chr(8217), ''), '[^A-Z0-9]+', ' ', 'g')), '') as new_k,
         (select case when length(d.x) = 9 then d.x end from (select right(regexp_replace(regexp_replace(regexp_replace(coalesce(w.phone, ''), '\D', '', 'g'), '^255', ''), '^0+', ''), 9) as x) d) as phone9,
         (select case when length(d.x) = 9 then d.x end from (select right(regexp_replace(regexp_replace(regexp_replace(coalesce(w.phone2, ''), '\D', '', 'g'), '^255', ''), '^0+', ''), 9) as x) d) as phone2_9,
         (select case when length(d.x) = 9 then d.x end from (select right(regexp_replace(regexp_replace(regexp_replace(coalesce(w.kin1_phone, ''), '\D', '', 'g'), '^255', ''), '^0+', ''), 9) as x) d) as kin1_phone9,
         (select case when length(d.x) = 9 then d.x end from (select right(regexp_replace(regexp_replace(regexp_replace(coalesce(w.kin2_phone, ''), '\D', '', 'g'), '^255', ''), '^0+', ''), 9) as x) d) as kin2_phone9,
         -- the account as it is WRITTEN, the way the staff form saves one: its digits (leading zeros kept) when it is digits, blanks, dots and dashes, else the text as it is: some banks write letters
         case when coalesce(w.account, '') ~ '^[\d.\s-]+$' then nullif(regexp_replace(w.account, '\D', '', 'g'), '') else nullif(btrim(w.account), '') end as account_w,
         nullif(regexp_replace(coalesce(w.tin, ''), '\D', '', 'g'), '') as tin_d,
         nullif(regexp_replace(coalesce(w.nssf, ''), '\D', '', 'g'), '') as nssf_d,
         nullif(regexp_replace(coalesce(w.nida, ''), '\D', '', 'g'), '') as nida_raw,
         nullif(regexp_replace(upper(btrim(w.kin1)), '\s+', ' ', 'g'), '') as kin1_key,
         nullif(regexp_replace(upper(btrim(w.kin2)), '\s+', ' ', 'g'), '') as kin2_key
  from want w
),
a2 as (   -- a NIDA is written only if it has twenty digits; the birth date is read off it (its first eight digits) when it is a day of the calendar, else the form's
  select a.*, case when length(a.nida_raw) = 20 then a.nida_raw end as nida_d,
         case when length(a.nida_raw) = 20 and a.nida_raw ~ '^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])'
              then case when substr(a.nida_raw, 7, 2)::int <= extract(day from make_date(substr(a.nida_raw, 1, 4)::int, substr(a.nida_raw, 5, 2)::int, 1) + interval '1 month' - interval '1 day')::int
                        then make_date(substr(a.nida_raw, 1, 4)::int, substr(a.nida_raw, 5, 2)::int, substr(a.nida_raw, 7, 2)::int) end
         end as birth_nida
  from a
),
b as (    -- the registry as it stands, for the staff named by ID whose name is the one written (before or after the rename), and each box as the staff form would read it
  select a.*, s.id as sid, s.name as s_name,
         regexp_replace(upper(btrim(s.name)), '\s+', ' ', 'g') as s_key,
         btrim(regexp_replace(translate(upper(s.name), '''`' || chr(8217), ''), '[^A-Z0-9]+', ' ', 'g')) as s_k,
         coalesce(a.birth_nida, a.birth) as birth_w,
         (select case when length(d.x) = 9 then d.x end from (select right(regexp_replace(regexp_replace(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), '^255', ''), '^0+', ''), 9) as x) d) as o_phone,
         (select case when length(d.x) = 9 then d.x end from (select right(regexp_replace(regexp_replace(regexp_replace(coalesce(s.phone2, ''), '\D', '', 'g'), '^255', ''), '^0+', ''), 9) as x) d) as o_phone2,
         upper(nullif(btrim(s.bank), '')) as o_bank, upper(nullif(btrim(s.account), '')) as o_account,
         nullif(regexp_replace(coalesce(s.nida, ''), '\D', '', 'g'), '') as o_nida, nullif(regexp_replace(coalesce(s.tin, ''), '\D', '', 'g'), '') as o_tin, nullif(regexp_replace(coalesce(s.nssf, ''), '\D', '', 'g'), '') as o_nssf,
         case when length(nullif(regexp_replace(coalesce(s.nida, ''), '\D', '', 'g'), '')) = 20 and regexp_replace(s.nida, '\D', '', 'g') ~ '^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])'
              then case when substr(regexp_replace(s.nida, '\D', '', 'g'), 7, 2)::int <= extract(day from make_date(substr(regexp_replace(s.nida, '\D', '', 'g'), 1, 4)::int, substr(regexp_replace(s.nida, '\D', '', 'g'), 5, 2)::int, 1) + interval '1 month' - interval '1 day')::int
                        then make_date(substr(regexp_replace(s.nida, '\D', '', 'g'), 1, 4)::int, substr(regexp_replace(s.nida, '\D', '', 'g'), 5, 2)::int, substr(regexp_replace(s.nida, '\D', '', 'g'), 7, 2)::int) end
         end as o_birth_nida,
         s.birth_date as o_birth, nullif(regexp_replace(upper(btrim(s.residence)), '\s+', ' ', 'g'), '') as o_res, s.reg_date as o_start,
         nullif(regexp_replace(upper(btrim(s.guarantor1)), '\s+', ' ', 'g'), '') as o_g1, nullif(regexp_replace(upper(btrim(s.guarantor2)), '\s+', ' ', 'g'), '') as o_g2,
         (select case when length(d.x) = 9 then d.x end from (select right(regexp_replace(regexp_replace(regexp_replace(coalesce(s.guarantor1_phone, ''), '\D', '', 'g'), '^255', ''), '^0+', ''), 9) as x) d) as o_g1p,
         (select case when length(d.x) = 9 then d.x end from (select right(regexp_replace(regexp_replace(regexp_replace(coalesce(s.guarantor2_phone, ''), '\D', '', 'g'), '^255', ''), '^0+', ''), 9) as x) d) as o_g2p
  from a2 a left join staff_registry s on s.id = a.id
),
c as (    -- the guard, and a guarantor's number: written beside the name it came with; the old number stays only beside the SAME person
  select b.*, (b.sid is not null and b.s_k in (b.cur_k, coalesce(b.new_k, b.cur_k))) as ok,
         case when b.kin1_key is null then null when b.kin1_phone9 is not null then b.kin1_phone9 when b.kin1_key is not distinct from b.o_g1 then b.o_g1p end as g1p_new,
         case when b.kin2_key is null then null when b.kin2_phone9 is not null then b.kin2_phone9 when b.kin2_key is not distinct from b.o_g2 then b.o_g2p end as g2p_new
  from b
),
cols as (   -- every box of every person: what the registry holds, what the row gives, and what that makes of it (none: nothing given, nothing touched)
  select c.n, c.id, v.ord, v.label,
         case when not c.ok then 'skip' when v.given is false then 'none'
              when v.old is null and v.new is not null then 'filled' when v.old is not null and v.new is null then 'cleared'
              when v.old is distinct from v.new then 'replaced' else 'same' end as kind
  from c cross join lateral (values
    (1,  'name',            c.s_key,                       c.new_key,                  c.new_key is not null),
    (2,  'phone',           c.o_phone,                     c.phone9,                   c.phone9 is not null),
    (3,  'second phone',    c.o_phone2,                    c.phone2_9,                 c.phone2_9 is not null),
    (4,  'bank',            c.o_bank,                      upper(nullif(btrim(c.bank), '')), nullif(btrim(c.bank), '') is not null),
    (5,  'account',         c.o_account,                   upper(c.account_w),         c.account_w is not null),
    (6,  'NIDA',            c.o_nida,                      c.nida_d,                   c.nida_d is not null),
    (7,  'TIN',             c.o_tin,                       c.tin_d,                    c.tin_d is not null),
    (8,  'NSSF',            c.o_nssf,                      c.nssf_d,                   c.nssf_d is not null),
    (9,  'birth date',      c.o_birth::text,               c.birth_w::text,            c.birth_w is not null and (c.nida_d is not null or c.o_birth_nida is null or c.o_birth_nida = c.birth_w)),
    (10, 'residence',       c.o_res,                       nullif(regexp_replace(upper(btrim(c.residence)), '\s+', ' ', 'g'), ''), nullif(btrim(c.residence), '') is not null),
    (11, 'start date',      c.o_start::text,               c.started::text,            c.started is not null),
    (12, 'guarantor 1',     c.o_g1,                        c.kin1_key,                 c.kin1_key is not null),
    (13, 'guarantor 1 phone', c.o_g1p,                     c.g1p_new,                  c.kin1_key is not null),
    (14, 'guarantor 2',     c.o_g2,                        c.kin2_key,                 c.kin2_key is not null),
    (15, 'guarantor 2 phone', c.o_g2p,                     c.g2p_new,                  c.kin2_key is not null)
  ) v(ord, label, old, new, given)
),
per as (   -- one line for each person
  select cl.n, cl.id,
         count(*) filter (where cl.kind in ('filled', 'replaced', 'cleared')) as changed,
         string_agg(cl.label, ', ' order by cl.ord) filter (where cl.kind = 'filled') as filled,
         string_agg(cl.label, ', ' order by cl.ord) filter (where cl.kind = 'replaced') as replaced,
         string_agg(cl.label, ', ' order by cl.ord) filter (where cl.kind = 'cleared') as cleared,
         string_agg(cl.label, ', ' order by cl.ord) filter (where cl.kind = 'same') as same,
         jsonb_object_agg(cl.label, cl.kind) as k
  from cols cl group by cl.n, cl.id
),
todo as (select c.*, p.k from c join per p on p.n = c.n and p.id = c.id where c.ok and p.changed > 0),
snap as (   -- the row as it was, before anything is changed: what the undo puts back
  insert into public.staff_registry_update_before (id, label, name, phone, phone2, bank, account, nida, tin, nssf, birth_date, residence, reg_date,
                                                   guarantor1, guarantor1_phone, guarantor2, guarantor2_phone, updated_by, updated_at)
  select s.id, (select label from cfg), s.name, s.phone, s.phone2, s.bank, s.account, s.nida, s.tin, s.nssf, s.birth_date, s.residence, s.reg_date,
         s.guarantor1, s.guarantor1_phone, s.guarantor2, s.guarantor2_phone, s.updated_by, s.updated_at
  from staff_registry s join todo t on t.sid = s.id
  where not exists (select 1 from public.staff_registry_update_before z where z.id = s.id and z.label = (select label from cfg))
  returning id
),
upd as (   -- a box is written only where the row gave it AND it was filled, replaced or cleared: a box that is already the same, or that the row leaves null, is not touched
  update staff_registry s
     set name       = case when t.k->>'name' in ('filled', 'replaced') then t.new_key else s.name end,
         phone      = case when t.k->>'phone' in ('filled', 'replaced') then t.phone9 else s.phone end,
         phone2     = case when t.k->>'second phone' in ('filled', 'replaced') then t.phone2_9 else s.phone2 end,
         bank       = case when t.k->>'bank' in ('filled', 'replaced') then btrim(t.bank) else s.bank end,
         account    = case when t.k->>'account' in ('filled', 'replaced') then t.account_w else s.account end,
         nida       = case when t.k->>'NIDA' in ('filled', 'replaced') then t.nida_d else s.nida end,
         tin        = case when t.k->>'TIN' in ('filled', 'replaced') then t.tin_d else s.tin end,
         nssf       = case when t.k->>'NSSF' in ('filled', 'replaced') then t.nssf_d else s.nssf end,
         birth_date = case when t.k->>'birth date' in ('filled', 'replaced') then t.birth_w else s.birth_date end,
         residence  = case when t.k->>'residence' in ('filled', 'replaced') then btrim(t.residence) else s.residence end,
         reg_date   = case when t.k->>'start date' in ('filled', 'replaced') then t.started else s.reg_date end,
         guarantor1 = case when t.k->>'guarantor 1' in ('filled', 'replaced') then btrim(t.kin1) else s.guarantor1 end,
         guarantor1_phone = case when t.k->>'guarantor 1 phone' in ('filled', 'replaced', 'cleared') then t.g1p_new else s.guarantor1_phone end,
         guarantor2 = case when t.k->>'guarantor 2' in ('filled', 'replaced') then btrim(t.kin2) else s.guarantor2 end,
         guarantor2_phone = case when t.k->>'guarantor 2 phone' in ('filled', 'replaced', 'cleared') then t.g2p_new else s.guarantor2_phone end,
         updated_by = (select label from cfg), updated_at = now()
    from todo t
   where s.id = t.sid
  returning s.id
),
aw as (    -- the words (three letters or more) of each row that names nobody yet: no ID typed, and not found by its exact name
  select a.n, x.w, x.pos
  from ak a join res r on r.n = a.n
  cross join lateral unnest(string_to_array(a.k, ' ')) with ordinality as x(w, pos)
  where a.id is null and a.nth = 1 and r.all_n = 0 and length(x.w) >= 3
),
rw as (    -- ... against the words (three letters or more) of every name in the registry
  select r.id, y.w from rg r cross join lateral unnest(string_to_array(r.k, ' ')) as y(w) where length(y.w) >= 3
),
nw as (    -- how many words of a row a registry name carries: the same, or one letter apart
  select aw.n, rw.id, count(distinct aw.pos) as near_n
  from aw join rw on aw.w = rw.w
                  or (abs(length(aw.w) - length(rw.w)) <= 1 and (left(aw.w, 1) = left(rw.w, 1) or right(aw.w, 1) = right(rw.w, 1))
                      and (select max(g) from generate_series(0, least(length(aw.w), length(rw.w))) g where left(aw.w, g) = left(rw.w, g))
                        + (select max(g) from generate_series(0, least(length(aw.w), length(rw.w))) g where right(aw.w, g) = right(rw.w, g))
                        >= greatest(length(aw.w), length(rw.w)) - 1)
  group by aw.n, rw.id
),
cands as (   -- who in the registry could be a row nobody was found for: the same account on another record, or two words of the name the same or one letter apart
  select distinct on (x.n, x.id) x.n, x.id, x.rank, x.near_n, x.how
  from (select nw.n, nw.id, 2 as rank, nw.near_n, nw.near_n || ' of its words the same or one letter apart' as how from nw where nw.near_n >= 2
        union all
        select a.n, r.id, 1, 0, 'the same account'
          from ak a join res rs on rs.n = a.n
          join rg r on length(ltrim(regexp_replace(upper(coalesce(a.account, '')), '[^A-Z0-9]', '', 'g'), '0')) >= 8
                   and r.akey = ltrim(regexp_replace(upper(coalesce(a.account, '')), '[^A-Z0-9]', '', 'g'), '0')
         where a.id is null and a.nth = 1 and rs.all_n = 0) x
  order by x.n, x.id, x.rank
),
look as (    -- the first four, the strongest first, and how many more
  select q.n, count(*) as cnt,
         string_agg(r.id || ' [' || coalesce(r.status, '-') || ', ' || coalesce(r.role, '-') || ', ' || coalesce(r.zone, '-') || '] "' || upper(btrim(regexp_replace(r.name, '\s+', ' ', 'g'))) || '" (' || q.how || ')',
                    ' ; ' order by q.rn) filter (where q.rn <= 4) as shown
  from (select c0.*, row_number() over (partition by c0.n order by c0.rank, c0.near_n desc, c0.id collate "C") as rn from cands c0) q
  join rg r on r.id = q.id
  group by q.n
),
zones as (   -- every zone name already filed, on Teams & Staff first, then in the registry
  select distinct on (regexp_replace(upper(q.zone), '[^A-Z0-9]', '', 'g'))
         upper(btrim(q.zone)) as zone, regexp_replace(upper(q.zone), '[^A-Z0-9]', '', 'g') as key
  from (select zone, 1 as src from teams union all select zone, 2 from staff_registry) q
  where regexp_replace(upper(coalesce(q.zone, '')), '[^A-Z0-9]', '', 'g') <> ''
  order by regexp_replace(upper(q.zone), '[^A-Z0-9]', '', 'g'), q.src
),
num as (   -- where the staff numbers stand: past every number in use, and past the count of rows
  select greatest(count(*), coalesce(max(case when split_part(id, '/', 2) ~ '^\d{1,6}$' then split_part(id, '/', 2)::int end), 0)) as top
  from staff_registry
),
newrows as (   -- a new staff: no ID typed, no ACTIVE or Inactive record of this exact name, nobody close, and the department's zone is filed
  select a.n, a.cur_key as name, a.phone9, a.phone2_9, a.bank, a.account_w as account, a.nida_d, a.tin_d, a.nssf_d, coalesce(a.birth_nida, a.birth) as birth,
         a.residence, a.started, a.kin1, a.kin1_phone9, a.kin2, a.kin2_phone9,
         (select z.zone from zones z where z.key = regexp_replace(upper((select new_zone from cfg)), '[^A-Z0-9]', '', 'g')) as zone,
         (select string_agg(left(w.word, 1), '' order by w.pos)
            from (select regexp_replace(x.raw, '[^A-Z]', '', 'g') as word, x.pos
                    from regexp_split_to_table(a.cur_key, ' ') with ordinality as x(raw, pos)
                   where regexp_replace(x.raw, '[^A-Z]', '', 'g') <> ''
                   order by x.pos limit 3) w) as initials
  from a2 a
  join ak k on k.n = a.n
  join res r on r.n = a.n
  where k.id is null and k.nth = 1 and r.all_n = 0 and not exists (select 1 from cands cd where cd.n = a.n)
),
newid as (
  select n.*, coalesce(nullif(n.initials, ''), 'STF') || '/' || case when (select top from num) + row_number() over (order by n.n) < 1000
                                                                      then lpad(((select top from num) + row_number() over (order by n.n))::text, 3, '0')
                                                                      else ((select top from num) + row_number() over (order by n.n))::text end
              || '/' || to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY') as id
  from newrows n
  where n.zone is not null
),
ins as (
  insert into staff_registry (id, reg_date, name, phone, phone2, role, residence, bank, account, zone, nida, birth_date,
                              guarantor1, guarantor1_phone, guarantor2, guarantor2_phone, tin, nssf, status, created_by, updated_by, updated_at)
  select n.id, coalesce(n.started, (now() at time zone 'Africa/Dar_es_Salaam')::date), n.name, n.phone9, n.phone2_9, (select new_role from cfg), n.residence, btrim(n.bank), n.account, n.zone,
         n.nida_d, n.birth, n.kin1, n.kin1_phone9, n.kin2, n.kin2_phone9, n.tin_d, n.nssf_d,
         'Active', (select label from cfg), (select label from cfg), now()
  from newid n
  returning id
)
select a.n as "#", a.cur_key as name_sent,
       case when k.nth > 1 then 'LISTED TWICE: this row repeats an earlier one: nothing changed'
            when k.id is not null and c.sid is null then 'NO STAFF WITH THAT ID: nothing changed'
            when k.id is not null and not c.ok then 'THAT ID CARRIES ANOTHER NAME (' || c.s_name || '): nothing changed'
            when c.ok and p.changed > 0 then 'UPDATED'
            when c.ok then 'NOTHING TO CHANGE: the registry already holds all of it'
            when r.live_n >= 2 then 'NOT CHANGED: ' || r.live_n || ' ACTIVE RECORDS CARRY THIS NAME (' || r.ids || ')'
            when r.all_n >= 1 then 'NOT CHANGED: THE ONLY RECORD WITH THIS NAME IS INACTIVE (' || r.ids || ')'
            when l.cnt > 0 then 'NOT CHANGED: NOT FOUND UNDER THIS NAME; THE CLOSE RECORDS ARE LISTED'
            when ni.id is not null then 'ADDED'
            else 'NOT ADDED: no zone named ' || (select new_zone from cfg) || ' is filed' end as done,
       coalesce(case when c.ok then c.sid end, ni.id) as staff_id,
       case when c.ok then coalesce(c.new_key, c.s_name) when ni.id is not null then ni.name end as name_in_registry,
       case when c.ok then p.filled when ni.id is not null then 'a new staff: name, role, zone' || case when ni.account is not null then ', account' else '' end || case when ni.bank is not null then ', bank' else '' end end as filled,
       case when c.ok then p.replaced end as replaced, case when c.ok then p.same end as same_already,
       nullif(concat_ws(' | ',
         case when c.ok and c.nida_raw is not null and c.nida_d is null then 'NIDA NOT written: it has ' || length(c.nida_raw) || ' digits and a NIDA has 20' end,
         case when c.ok and c.nida_d is null and c.birth_w is not null and c.o_birth_nida is not null and c.o_birth_nida <> c.birth_w
              then 'the birth date on the form (' || to_char(c.birth_w, 'DD/MM/YYYY') || ') is not the one in the NIDA number the registry holds (' || to_char(c.o_birth_nida, 'DD/MM/YYYY') || '): NOT written' end,
         case when c.ok and c.new_key is not null and c.new_key <> c.s_key then 'the name was "' || c.s_name || '" and is now "' || c.new_key || '"' end,
         case when c.ok and c.new_key is not null and c.new_key <> c.s_key
               and exists (select 1 from staff_registry x where x.id <> c.sid and regexp_replace(upper(btrim(x.name)), '\s+', ' ', 'g') = c.new_key)
              then 'LOOK: another staff already carries the name sent: ' || (select string_agg(x.id || ' [' || x.status || ']', '; ' order by x.id) from staff_registry x
                                                                       where x.id <> c.sid and regexp_replace(upper(btrim(x.name)), '\s+', ' ', 'g') = c.new_key) end,
         case when c.ok and c.bank is null and c.account_w is not null and c.o_bank is null then 'the account has no bank name on the row or in the registry' end,
         case when ni.id is not null and ni.bank is null and ni.account is not null then 'the account has no bank name on the row' end,
         case when c.ok and ((c.phone is not null and c.phone9 is null) or (c.kin1_phone is not null and c.kin1_phone9 is null) or (c.kin2_phone is not null and c.kin2_phone9 is null))
              then 'a phone sent is not a nine-digit number (with or without 0 or 255): that phone was NOT written' end), '') as note,
       case when k.nth = 1 and k.id is null and r.all_n = 0 then l.shown end as look
from a2 a
join ak k on k.n = a.n
join res r on r.n = a.n
left join c on c.n = a.n
left join per p on p.n = c.n and p.id = c.id
left join look l on l.n = a.n
left join newid ni on ni.n = a.n and exists (select 1 from ins where ins.id = ni.id)
order by a.n;

-- UNDO: take the two dashes off the lines below, run them, and every staff the label names goes back to the columns it was copied with, and the staff this run ADDED are removed. The copies stay.
-- update public.staff_registry s set name = b.name, phone = b.phone, phone2 = b.phone2, bank = b.bank, account = b.account, nida = b.nida, tin = b.tin, nssf = b.nssf, birth_date = b.birth_date, residence = b.residence, reg_date = b.reg_date,
--   guarantor1 = b.guarantor1, guarantor1_phone = b.guarantor1_phone, guarantor2 = b.guarantor2, guarantor2_phone = b.guarantor2_phone, updated_by = b.updated_by, updated_at = b.updated_at
--   from public.staff_registry_update_before b where b.id = s.id and b.label = 'STAFF ACCOUNTS (SQL)';
-- delete from public.staff_registry where created_by = 'STAFF ACCOUNTS (SQL)';
