-- =====================================================================================
-- TEMPLATE: STAFF DETAILS UPDATED FROM A FORM, BY STAFF ID -- THE DETAILS SENT ARE THE LATEST
--
--   "some info should be filled into their columns if missing or replace if existing since the provided is latest" -- the owner, 17 Nov 2026
--   (docs/HANDOFF.md Part 101)
--
-- WHEN. A staff is already in the registry and the owner brings their own details (a form, or an account and a name from a GMO) and says they are the latest. TEMPLATE-staff-changes-from-gmo.sql
-- PLACE fills only what is EMPTY; this REPLACES what the registry holds. Copy this file, fill the list, and hand the owner the copy: new query, paste, Run. NO STAFF NAME, NUMBER OR ACCOUNT IS EVER
-- COMMITTED: this repository is public. The filled copy goes to the owner.
--
-- ONE ROW OF THE LIST FOR EACH PERSON, found by STAFF ID (the answer of the PLACE or MOVE script printed it) AND by the name the registry carries now, so a mistyped ID cannot update somebody else:
--   n, id, cur_name (the name the registry has now), new_name (the name sent: null keeps it), phone, phone2, bank, account, nida, tin, nssf,
--   birth (the date on the form: used only when the NIDA gives none), residence, started (the day they started work: the registry's REG-DATE),
--   kin1, kin1_phone, kin2, kin2_phone (the two people a form names, each as 'NAME (MAMA)': the registry's JINA LA MDHAMINI and JINA LA MDHAMINI 2)
--
-- WHAT A ROW DOES. A box the row GIVES is written: FILLED if it was empty, REPLACED if it held something else, and "same" if it already holds it (a phone with or without its leading zero, a NIDA with or
-- without dashes, capitals or not: the same number is the same). A box the row leaves null is NEVER touched or emptied (write null for "nil", "on process", "--", "hana": they are no value).
--   * The NAME is replaced too when the row gives one. A name sent for a person is theirs, and the registry's spelling is the one that was typed first.
--   * The ROLE, ZONE and STATUS are never touched here: that is the MOVE / PLACE script's work, and a role the registry already holds in more detail than a form's "PMO HQ" stays.
--   * A NIDA that is not twenty digits is NEVER written (it could replace a good one): the row says so. The birth date is the NIDA's (its first eight digits, as the staff form reads it), else the form's;
--     and a date is never set beside a NIDA number it was not read from: if the registry's own NIDA gives another date than the form's, the form's date is NOT written and the row says so.
--   * A guarantor's number is written beside the name it came with. If the name is replaced by ANOTHER person and no number comes with it, the old number (the other person's) is cleared, and the row says so.
--
-- BEFORE ANYTHING IS CHANGED each staff row about to change is copied to staff_registry_update_before (the columns this file can change), under the label on the line marked CHANGE. The undo at the foot
-- puts every one of them back from that copy. Use a NEW label for a new batch. SAFE TO RUN AGAIN: the second run changes nothing and says so.
-- PRINTS, for each person: what was done, and which boxes were filled, replaced, cleared or already the same, by NAME OF THE BOX. NO PHONE, ACCOUNT, NIDA OR OTHER VALUE IS PRINTED.
-- COST. Reads and writes the staff registry only (a few thousand rows; the list is a few dozen). Nothing on uploads, nothing on HOPE Calls.
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
  select 'GMO ZONE NAME UPDATE (SQL)'::text as label          -- CHANGE: a new label for a new batch; written beside every row changed, and on its copy for the undo
),
want(n, id, cur_name, new_name, phone, phone2, bank, account, nida, tin, nssf, birth, residence, started, kin1, kin1_phone, kin2, kin2_phone) as (values
  (1, 'ABC/0001/2026', 'FIRST MIDDLE LAST', 'FIRST MIDDLE LAST', '0700000000', null::text, 'BANK', '0000000000', null::text, null::text, null::text, null::date, null::text, null::date, null::text, null::text, null::text, null::text)
),
a as (   -- each row as it is compared: names in capitals with single spaces, numbers as the staff form stores them
  select w.*,
         regexp_replace(upper(btrim(w.cur_name)), '\s+', ' ', 'g') as cur_key,
         nullif(regexp_replace(upper(btrim(w.new_name)), '\s+', ' ', 'g'), '') as new_key,
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
  select b.*, (b.sid is not null and b.s_key in (b.cur_key, coalesce(b.new_key, b.cur_key))) as ok,
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
)
select c.n as "#", c.id as staff_id,
       case when c.sid is null  then 'NO STAFF WITH THAT ID: nothing changed'
            when not c.ok       then 'THAT ID CARRIES ANOTHER NAME (' || c.s_name || '): nothing changed'
            when p.changed > 0  then 'UPDATED'
            else                     'NOTHING TO CHANGE: the registry already holds all of it' end as done,
       case when c.ok and c.new_key is not null and c.new_key <> c.s_key then c.s_name end as name_was,
       case when c.ok then coalesce(c.new_key, c.s_name) end as name_now,
       case when c.ok then p.filled end as filled, case when c.ok then p.replaced end as replaced, case when c.ok then p.cleared end as cleared, case when c.ok then p.same end as same_already,
       nullif(concat_ws(' | ',
         case when c.ok and c.nida_raw is not null and c.nida_d is null then 'NIDA NOT written: it has ' || length(c.nida_raw) || ' digits and a NIDA has 20' end,
         case when c.ok and c.nida_d is null and c.birth_w is not null and c.o_birth_nida is not null and c.o_birth_nida <> c.birth_w
              then 'the birth date on the form (' || to_char(c.birth_w, 'DD/MM/YYYY') || ') is not the one in the NIDA number the registry holds (' || to_char(c.o_birth_nida, 'DD/MM/YYYY') || '): NOT written' end,
         case when c.ok and c.birth_nida is not null and c.birth is not null and c.birth_nida <> c.birth
              then 'the birth date on the form (' || to_char(c.birth, 'DD/MM/YYYY') || ') is not the one in the NIDA number (' || to_char(c.birth_nida, 'DD/MM/YYYY') || '): the NIDA''s is written' end,
         case when c.ok and c.new_key is not null and c.new_key <> c.s_key
               and exists (select 1 from staff_registry x where x.id <> c.sid and regexp_replace(upper(btrim(x.name)), '\s+', ' ', 'g') = c.new_key)
              then 'LOOK: another staff already carries the name sent: ' || (select string_agg(x.id || ' [' || x.status || ']', '; ' order by x.id) from staff_registry x
                                                                       where x.id <> c.sid and regexp_replace(upper(btrim(x.name)), '\s+', ' ', 'g') = c.new_key) end,
         case when c.ok and p.cleared is not null then 'a guarantor''s old number was cleared: another person is named there now and no number came with them' end,
         case when c.ok and c.bank is null and c.account_w is not null and c.o_bank is null then 'the account has no bank name on the row or in the registry' end,
         case when c.ok and ((c.phone is not null and c.phone9 is null) or (c.phone2 is not null and c.phone2_9 is null) or (c.kin1_phone is not null and c.kin1_phone9 is null) or (c.kin2_phone is not null and c.kin2_phone9 is null))
              then 'a phone sent is not a nine-digit number (with or without 0 or 255): that phone was NOT written' end), '') as note
from c left join per p on p.n = c.n and p.id = c.id
order by c.n;

-- UNDO: take the two dashes off the three lines below, run them, and every staff the label names goes back to the columns it was copied with. The copies stay, so this can be run again.
-- update public.staff_registry s set name = b.name, phone = b.phone, phone2 = b.phone2, bank = b.bank, account = b.account, nida = b.nida, tin = b.tin, nssf = b.nssf, birth_date = b.birth_date, residence = b.residence, reg_date = b.reg_date,
--   guarantor1 = b.guarantor1, guarantor1_phone = b.guarantor1_phone, guarantor2 = b.guarantor2, guarantor2_phone = b.guarantor2_phone, updated_by = b.updated_by, updated_at = b.updated_at
--   from public.staff_registry_update_before b where b.id = s.id and b.label = 'GMO ZONE NAME UPDATE (SQL)';
