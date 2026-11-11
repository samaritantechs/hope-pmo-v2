-- =====================================================================================
-- TEMPLATE: STAFF CHANGES CONFIRMED BY A GMO  (the staff registry, HR's staff database)
--
--   "Ill be comming with staff db updates simce GMOs comfirm of changes in my whatsapp group"
--   "dont correct names using the gmo data i bring unless its new staff"
--   "so provide sql to add staff as we always did"
--
-- GMOs and managers send their changes to the owner's WhatsApp group: who left, who was
-- transferred where, who is new (often with phone, account, NIDA, TIN, NSSF), who they cannot
-- see on their list. Copy this file, fill the list, and hand the owner the copy: new query,
-- paste, Run. ONE ROW COMES BACK FOR EACH PERSON, saying what was done. (docs/HANDOFF.md
-- Parts 48 and 49.)
-- NO STAFF NAME IS EVER COMMITTED: this repository is public. The filled copy goes to the owner.
--
-- ONE ROW OF THE LIST FOR EACH PERSON:
--   n, list (whose message), what is asked, the name as written, then, where they apply:
--   role_word   'Manager', 'Field Officer', 'Bike Recovery' ...  (MOVE: null keeps the role they have)
--   team_text   the team as it should read after "ROLE - "
--   zone_teams  array of team names whose zone on Teams & Staff the person takes (first one found)
--   zone_else   the sender's word for the zone: used only if a zone of that name is already filed
--   zone_like   array of names of colleagues already in the registry: their zone, as a last resort
--   account, phone, bank, nida, tin, nssf    (an account also FINDS a person whose name is spelt differently)
--   why         for ASK: what is missing
--
-- OFF    left, terminated or deactivated: switched to Inactive (off every request list, history
--        kept, nothing deleted).
-- MOVE   transferred: the role and team follow the transfer, and the zone becomes the zone of
--        the new team on Teams & Staff. The person stays, or becomes, Active.
-- PLACE  an officer a GMO cannot see on their list: if the registry holds them they are moved to
--        the team and their EMPTY details are filled in; if it does not, they are added.
-- NEW    a new officer: added with the details sent, Active, with the next staff ID (initials /
--        number / year, past every number in use). Not added if the registry already holds the
--        name or the account, or if no zone can be found for them.
-- ASK    nothing is changed: the row says what is missing.
--
-- WHO IS MEANT, in this order: the same name; the same bank account; the same phone (with a
-- word of the name the same or one letter apart: a phone can pass to somebody else); the same
-- name but for one letter of one word; the same words where the registry has one name more;
-- the same name but for one letter in more than one word. Only when exactly ONE staff fits
-- (the only live one, else the only one). The row says how they were found and shows the
-- registry's own spelling, which is NEVER changed. Nobody fits, or several do: nothing is
-- changed, and the row shows the nearest names. Those are then settled by staff ID
-- (TEMPLATE-staff-changes-by-id.sql). For a NEW staff only the name, the account and the phone
-- are compared.
--
-- THE ZONE of a moved or new staff: the zone of their team on Teams & Staff; else the sender's
-- word, only if a zone of that name is already filed; else the zone of the staff already on
-- that team; else (new staff) the zone of the colleagues named in zone_like. A moved staff
-- whose new team has no zone anywhere keeps the old zone, and the row says so: fill the team's
-- ZONE on Teams & Staff and run the script again.
--
-- SAFE TO RUN AGAIN: the second run changes nothing and says so.
-- It reads and writes the staff registry and reads the teams table. Nothing on uploads,
-- nothing on HOPE Calls. On a registry of 5,000 staff a list of forty takes about a second.
-- NOT DONE BY IT: the role columns of Teams & Staff (a manager who left or moved is still named
-- there until that tab is changed).
-- =====================================================================================
set local lock_timeout = '5s';
set local statement_timeout = '60s';

with cfg as (
  select 'GMO ZONE NAME (SQL)'::text as done_by                    -- CHANGE: written beside every row this touches
),
ask(n, grp, act, name, role_word, team_text, zone_teams, zone_else, zone_like, account, phone, bank, nida, tin, nssf, why) as (values
  (1, 'ZONE NAME', 'OFF', 'FIRST MIDDLE LAST', null::text, null::text, null::text[], null::text, null::text[], null::text, null::text, null::text, null::text, null::text, null::text, null::text),
  (2, 'ZONE NAME', 'MOVE', 'ANOTHER MIDDLE LAST', 'Manager', 'Team One', array['TEAM ONE'], null, null, null, null, null, null, null, null, null),
  (3, 'ZONE NAME', 'NEW', 'THIRD MIDDLE LAST', 'Field Officer', 'Team Two', array['TEAM TWO'], 'ZONE NAME', array['FIRST MIDDLE LAST'], '0000000000', '0700000000', 'BANK', null, null, null, null),
  (4, 'ZONE NAME', 'PLACE', 'FOURTH MIDDLE LAST', 'Field Officer', 'Team Two', array['TEAM TWO'], 'ZONE NAME', array['FIRST MIDDLE LAST'], null, null, null, null, null, null, null),
  (5, 'ZONE NAME', 'ASK', 'FIFTH MIDDLE LAST', null, null, null, null, null, null, null, null, null, null, null, 'what is missing')
),
a as (   -- each row as it is compared: the name in capitals with single spaces, the account without marks
  select k.*,
         regexp_replace(upper(btrim(k.name)), '\s+', ' ', 'g') as nkey,
         ltrim(regexp_replace(upper(coalesce(k.account, '')), '[^A-Z0-9]', '', 'g'), '0') as akey,
         (select case when length(d.x) = 9 then d.x end
            from (select right(regexp_replace(regexp_replace(regexp_replace(coalesce(k.phone, ''), '\D', '', 'g'), '^255', ''), '^0+', ''), 9) as x) d) as phone9,
         nullif(regexp_replace(coalesce(k.nida, ''), '\D', '', 'g'), '') as nida_d,
         nullif(regexp_replace(coalesce(k.tin, ''), '\D', '', 'g'), '') as tin_d,
         nullif(regexp_replace(coalesce(k.nssf, ''), '\D', '', 'g'), '') as nssf_d
  from ask k
),
a2 as (
  select a.*, row_number() over (partition by a.nkey order by a.n) as nth, string_to_array(a.nkey, ' ') as w,
         case when a.nida_d ~ '^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])' then to_date(left(a.nida_d, 8), 'YYYYMMDD') end as birth
  from a
),
reg as (   -- the registry as it stands
  select s.id, s.name as name_as_filed, s.status, s.zone, s.role,
         regexp_replace(upper(btrim(s.name)), '\s+', ' ', 'g') as nkey,
         ltrim(regexp_replace(upper(coalesce(s.account, '')), '[^A-Z0-9]', '', 'g'), '0') as akey,
         upper(btrim(s.status)) <> 'INACTIVE' as live,
         (select case when length(d.x) = 9 then d.x end
            from (select right(regexp_replace(regexp_replace(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), '^255', ''), '^0+', ''), 9) as x) d) as phone9,
         string_to_array(regexp_replace(upper(btrim(s.name)), '\s+', ' ', 'g'), ' ') as w
  from staff_registry s
),
exact as (   -- the rows whose name is in the registry as written: the looser ways of finding are not tried for them
  select distinct a.n from a2 a join reg r on r.nkey = a.nkey
),
c as (   -- who in the registry each row could be: 1 the same name and account, 2 the same name, 3 the same account,
         -- 4 the same phone, 5 the same name but for one letter of one word, 6 the same words with a name more in
         -- the registry, 7 the same name but for one letter in more than one word
  select a.n, r.id, r.live, case when length(a.akey) >= 8 and r.akey = a.akey then 1 else 2 end as rk
    from a2 a join reg r on r.nkey = a.nkey
   where a.act <> 'ASK'
  union all
  select a.n, r.id, r.live, 3
    from a2 a join reg r on length(a.akey) >= 8 and r.akey = a.akey and r.nkey <> a.nkey
   where a.act <> 'ASK'
  union all
  select a.n, r.id, r.live, 4
    from a2 a join reg r on a.phone9 is not null and r.phone9 = a.phone9 and r.nkey <> a.nkey
     -- a phone can pass to somebody else: it counts only with a word of the name that is the same, or one letter apart
     and exists (select 1 from unnest(a.w) x, unnest(r.w) y
                  where length(x) >= 4 and length(y) >= 4
                    and (x = y or (abs(length(x) - length(y)) <= 1
                      and (select max(g) from generate_series(0, least(length(x), length(y))) g where left(x, g) = left(y, g))
                        + (select max(g) from generate_series(0, least(length(x), length(y))) g where right(x, g) = right(y, g))
                        >= greatest(length(x), length(y)) - 1)))
   where a.act <> 'ASK'
  union all
  select a.n, r.id, r.live, 5
    from a2 a
    join reg r on r.w && a.w and cardinality(r.w) = cardinality(a.w) and r.nkey <> a.nkey
    cross join lateral (
      select count(*) filter (where u.x = u.y) as same, count(*) as words,
             min(u.x) filter (where u.x <> u.y) as x, min(u.y) filter (where u.x <> u.y) as y
      from unnest(a.w, r.w) as u(x, y)
    ) d
   where a.act in ('OFF', 'MOVE', 'PLACE') and a.n not in (select n from exact)
     and case when d.words >= 2 and d.same = d.words - 1 and length(d.x) >= 3 and length(d.y) >= 3 and abs(length(d.x) - length(d.y)) <= 1
              then (select max(g) from generate_series(0, least(length(d.x), length(d.y))) g where left(d.x, g) = left(d.y, g))
                 + (select max(g) from generate_series(0, least(length(d.x), length(d.y))) g where right(d.x, g) = right(d.y, g))
                 >= greatest(length(d.x), length(d.y)) - 1
              else false end
  union all
  select a.n, r.id, r.live, 6
    from a2 a
    join reg r on r.w @> a.w and cardinality(r.w) > cardinality(a.w)
   where a.act in ('OFF', 'MOVE', 'PLACE') and a.n not in (select n from exact) and cardinality(a.w) >= 2
  union all
  select a.n, r.id, r.live, 7
    from a2 a
    join reg r on r.w && a.w and cardinality(r.w) = cardinality(a.w) and r.nkey <> a.nkey
    cross join lateral (
      select count(*) filter (where u.x = u.y) as same, count(*) as words,
             bool_and(u.x = u.y or (length(u.x) >= 3 and length(u.y) >= 3 and abs(length(u.x) - length(u.y)) <= 1
               and (select max(g) from generate_series(0, least(length(u.x), length(u.y))) g where left(u.x, g) = left(u.y, g))
                 + (select max(g) from generate_series(0, least(length(u.x), length(u.y))) g where right(u.x, g) = right(u.y, g))
                 >= greatest(length(u.x), length(u.y)) - 1)) as close
      from unnest(a.w, r.w) as u(x, y)
    ) e
   where a.act in ('OFF', 'MOVE', 'PLACE') and a.n not in (select n from exact)
     and e.words >= 3 and e.same >= 1 and e.same <= e.words - 2 and e.close
),
pick as (   -- the strongest kind of match a row has, and how many carry it
  select b.n, b.rk,
         count(*) filter (where c.live) as live_n, count(*) as all_n,
         min(c.id) filter (where c.live) as live_id, min(c.id) as any_id,
         string_agg(c.id, '; ' order by c.id) as ids
  from (select n, min(rk) as rk from c group by n) b
  join c on c.n = b.n and c.rk = b.rk
  group by b.n, b.rk
),
tgt0 as (   -- the one staff a row means: the only live one, else the only one
  select a.n, p.rk, p.all_n, p.ids,
         case when p.live_n = 1 then p.live_id when p.live_n = 0 and p.all_n = 1 then p.any_id end as id
  from a2 a left join pick p on p.n = a.n
),
tgt as (
  select t.*, case when t.id is not null then row_number() over (partition by t.id order by t.n) end as use_nth
  from tgt0 t
),
zones as (   -- every zone name already filed, on Teams & Staff first, then in the registry
  select distinct on (regexp_replace(upper(q.zone), '[^A-Z0-9]', '', 'g'))
         upper(btrim(q.zone)) as zone, regexp_replace(upper(q.zone), '[^A-Z0-9]', '', 'g') as key
  from (select zone, 1 as src from teams union all select zone, 2 from staff_registry) q
  where btrim(coalesce(q.zone, '')) <> ''
  order by regexp_replace(upper(q.zone), '[^A-Z0-9]', '', 'g'), q.src
),
z as (   -- the zone for a row: its team's on Teams & Staff; else the sender's word if such a zone is filed; else the zone of
         -- the staff already on that team; else its colleagues' on the same list
  select a.n, tf.team as team_filed, tf.zone as z_team,
         (select zz.zone from zones zz where zz.key = regexp_replace(upper(coalesce(a.zone_else, '')), '[^A-Z0-9]', '', 'g')) as z_else,
         (select mode() within group (order by upper(btrim(r.zone))) from reg r
           where r.nkey = any (select regexp_replace(upper(btrim(x)), '\s+', ' ', 'g') from unnest(a.zone_like) x)
             and btrim(coalesce(r.zone, '')) <> '') as z_like,
         (select mode() within group (order by upper(btrim(r.zone))) from reg r
           where a.team_text is not null and r.live and btrim(coalesce(r.zone, '')) <> '' and r.role ~ '\S\s+-\s+\S'
             and regexp_replace(upper(regexp_replace(r.role, '^.*?\s+-\s+', '')), '[^A-Z0-9]', '', 'g')
                 like regexp_replace(upper(a.team_text), '[^A-Z0-9]', '', 'g') || '%'
             and r.nkey not in (select x.nkey from a2 x)) as z_peers
  from a2 a
  left join lateral (
    select t.team, nullif(upper(btrim(t.zone)), '') as zone
    from unnest(a.zone_teams) with ordinality as zt(name, pos)
    join teams t on regexp_replace(upper(t.team), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(zt.name), '[^A-Z0-9]', '', 'g')
    order by (nullif(btrim(t.zone), '') is null), zt.pos
    limit 1
  ) tf on true
),
plan as (   -- what a row asks of the staff it means
  select t.n, t.id, a.act, a.phone9, a.bank, a.account, a.nida_d, a.tin_d, a.nssf_d, a.birth,
         case when a.act = 'OFF' then 'Inactive' else 'Active' end as new_status,
         case when a.act = 'OFF' then r.role
              else coalesce(a.role_word, nullif(btrim(regexp_replace(coalesce(r.role, ''), '\s+-\s+.*$', '')), ''), 'Field Officer')
                   || coalesce(' - ' || case when cardinality(a.zone_teams) = 1 and z.team_filed is not null then z.team_filed else a.team_text end, '')
         end as new_role,
         case when a.act = 'OFF' then r.zone
              when a.act = 'MOVE' then coalesce(z.z_team, z.z_else, z.z_peers, r.zone)
              else coalesce(z.z_team, z.z_else, z.z_peers, z.z_like, r.zone) end as new_zone
  from tgt t
  join a2 a on a.n = t.n
  join reg r on r.id = t.id
  join z on z.n = t.n
  where t.use_nth = 1 and a.nth = 1 and a.act in ('OFF', 'MOVE', 'PLACE')
),
upd as (
  update staff_registry s
     set status = p.new_status, role = p.new_role, zone = p.new_zone,
         phone      = case when p.act = 'PLACE' then coalesce(nullif(btrim(s.phone), ''), p.phone9) else s.phone end,
         bank       = case when p.act = 'PLACE' then coalesce(nullif(btrim(s.bank), ''), p.bank) else s.bank end,
         account    = case when p.act = 'PLACE' then coalesce(nullif(btrim(s.account), ''), p.account) else s.account end,
         nida       = case when p.act = 'PLACE' then coalesce(nullif(btrim(s.nida), ''), p.nida_d) else s.nida end,
         tin        = case when p.act = 'PLACE' then coalesce(nullif(btrim(s.tin), ''), p.tin_d) else s.tin end,
         nssf       = case when p.act = 'PLACE' then coalesce(nullif(btrim(s.nssf), ''), p.nssf_d) else s.nssf end,
         birth_date = case when p.act = 'PLACE' then coalesce(s.birth_date, p.birth) else s.birth_date end,
         updated_by = (select done_by from cfg), updated_at = now()
    from plan p
   where s.id = p.id
     and (upper(btrim(s.status)) is distinct from upper(p.new_status)
          or s.role is distinct from p.new_role
          or s.zone is distinct from p.new_zone
          or (p.act = 'PLACE' and ((coalesce(btrim(s.phone), '') = '' and p.phone9 is not null)
               or (coalesce(btrim(s.bank), '') = '' and p.bank is not null)
               or (coalesce(btrim(s.account), '') = '' and p.account is not null)
               or (coalesce(btrim(s.nida), '') = '' and p.nida_d is not null)
               or (coalesce(btrim(s.tin), '') = '' and p.tin_d is not null)
               or (coalesce(btrim(s.nssf), '') = '' and p.nssf_d is not null))))
  returning s.id
),
num as (   -- where the staff numbers stand: past every number in use, and past the count of rows
  select greatest(count(*), coalesce(max(case when split_part(id, '/', 2) ~ '^\d{1,6}$' then split_part(id, '/', 2)::int end), 0)) as top
  from staff_registry
),
newrows as (   -- a new staff: nobody in the registry could be them, and a zone is known
  select a.n, a.nkey as name, a.phone9, a.bank, a.account, a.nida_d, a.tin_d, a.nssf_d, a.birth,
         coalesce(a.role_word, 'Field Officer')
           || coalesce(' - ' || case when cardinality(a.zone_teams) = 1 and z.team_filed is not null then z.team_filed else a.team_text end, '') as role,
         coalesce(z.z_team, z.z_else, z.z_peers, z.z_like) as zone,
         (select top from num) + row_number() over (order by a.n) as serial,
         (select string_agg(left(w.word, 1), '' order by w.pos)
            from (select regexp_replace(x.raw, '[^A-Z]', '', 'g') as word, x.pos
                    from regexp_split_to_table(a.nkey, ' ') with ordinality as x(raw, pos)
                   where regexp_replace(x.raw, '[^A-Z]', '', 'g') <> ''
                   order by x.pos limit 3) w) as initials
  from a2 a
  join tgt t on t.n = a.n
  join z on z.n = a.n
  where a.nth = 1 and a.act in ('NEW', 'PLACE') and t.all_n is null
    and coalesce(z.z_team, z.z_else, z.z_peers, z.z_like) is not null
),
newid as (
  select n.*, coalesce(nullif(n.initials, ''), 'STF') || '/' || case when n.serial < 1000 then lpad(n.serial::text, 3, '0') else n.serial::text end
              || '/' || to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY') as id
  from newrows n
),
ins as (
  insert into staff_registry (id, reg_date, name, phone, role, bank, account, zone, nida, birth_date, tin, nssf, status, created_by, updated_by, updated_at)
  select n.id, (now() at time zone 'Africa/Dar_es_Salaam')::date, n.name, n.phone9, n.role, n.bank, n.account, n.zone, n.nida_d, n.birth, n.tin_d, n.nssf_d,
         'Active', (select done_by from cfg), (select done_by from cfg), now()
  from newid n
  returning id
)
select a.n as "#", a.grp as list, a.act as asked, a.nkey as name,
       case
         when a.act = 'ASK'                                              then 'NOT CHANGED: ' || a.why
         when a.nth > 1                                                  then 'LISTED TWICE: see the first'
         when t.id is not null and t.use_nth > 1                         then 'THE SAME STAFF AS AN EARLIER ROW: nothing changed'
         when a.act = 'OFF' and u.id is not null                         then 'MADE INACTIVE'
         when a.act = 'OFF' and t.id is not null                         then 'ALREADY INACTIVE: nothing changed'
         when a.act in ('MOVE', 'PLACE') and u.id is not null and not r.live then 'SWITCHED BACK ON AND MOVED'
         when a.act in ('MOVE', 'PLACE') and u.id is not null and (r.role is distinct from p.new_role or r.zone is distinct from p.new_zone) then 'MOVED'
         when a.act = 'PLACE' and u.id is not null                       then 'ALREADY THERE: details filled in'
         when a.act in ('MOVE', 'PLACE') and t.id is not null            then 'ALREADY THERE: nothing changed'
         when i.id is not null                                           then 'ADDED'
         when a.act = 'NEW' and t.id is not null                         then 'ALREADY IN THE REGISTRY: not added'
         when t.all_n is not null                                        then 'SEVERAL COULD BE MEANT: nothing changed'
         when a.act in ('NEW', 'PLACE')                                  then 'NOT ADDED: no zone could be found for them'
         else                                                                 'NOT FOUND: nothing changed'
       end as done,
       coalesce(t.id, i.id) as staff_id,
       case when t.id is not null and r.nkey <> a.nkey then r.name_as_filed end as name_in_registry,
       coalesce(case when u.id is not null then p.new_zone end, r.zone, nw.zone) as zone,
       coalesce(case when u.id is not null then p.new_role end, r.role, nw.role) as role,
       nullif(concat_ws(' · ',
         case when t.id is not null and t.rk = 3 then 'found by the account number'
              when t.id is not null and t.rk = 4 then 'found by the phone number'
              when t.id is not null and t.rk = 5 then 'found one letter apart'
              when t.id is not null and t.rk = 6 then 'found by the shorter form of the name'
              when t.id is not null and t.rk = 7 then 'found one letter apart in more than one word' end,
         case when u.id is not null and a.act in ('MOVE', 'PLACE') and (r.role is distinct from p.new_role or r.zone is distinct from p.new_zone or not r.live)
              then 'was: ' || coalesce(r.role, 'no role') || ', ' || coalesce(r.zone, 'no zone') || ', ' || r.status end,
         case when a.nth = 1 and a.act in ('MOVE', 'PLACE', 'NEW') and (t.id is not null or i.id is not null) and z.z_team is null
              then case when z.z_else is not null then 'the team has no zone on Teams & Staff: zone taken from the sender''s word'
                        when z.z_peers is not null then 'the team has no zone on Teams & Staff: zone taken from the staff already on that team'
                        when a.act = 'MOVE' then 'the team has no zone on Teams & Staff: zone left as it was'
                        else 'the team has no zone on Teams & Staff: zone taken from colleagues on the same list' end end,
         case when a.nth = 1 and a.act <> 'ASK' and t.id is null and t.all_n is not null then 'they are: ' || t.ids end,
         case when a.nth = 1 and a.act in ('OFF', 'MOVE') and t.all_n is null then 'nearest names: ' || coalesce((
                select string_agg(q.name_as_filed || ' [' || q.id || ', ' || coalesce(q.zone, 'no zone') || ', ' || q.status || ']', '; ')
                  from (select r2.* from reg r2
                         where r2.w && a.w
                           and (select count(distinct x) from unnest(a.w) x where length(x) > 1 and x = any (r2.w)) >= 2
                         order by r2.nkey limit 4) q),
                (select 'none with two of these words; sharing one: ' || string_agg(q.name_as_filed || ' [' || q.id || ', ' || coalesce(q.zone, 'no zone') || ', ' || q.status || ']', '; ')
                  from (select r2.* from reg r2
                         where exists (select 1 from unnest(a.w) x where length(x) >= 5 and x = any (r2.w))
                         order by r2.nkey limit 8) q),
                'none with any of these words') end,
         case when i.id is not null then (
                select 'look: a name like it is already in this zone: ' || string_agg(q.name_as_filed || ' [' || q.id || ', ' || q.status || ']', '; ')
                  from (select r2.* from reg r2
                         where upper(btrim(coalesce(r2.zone, ''))) = nw.zone and r2.w && a.w
                           and (select count(distinct x) from unnest(a.w) x where length(x) > 1 and x = any (r2.w)) >= 2
                         order by r2.nkey limit 3) q) end
       ), '') as note
from a2 a
join tgt t        on t.n = a.n
join z            on z.n = a.n
left join reg r   on r.id = t.id
left join plan p  on p.n = a.n
left join upd u   on u.id = p.id
left join newid nw on nw.n = a.n
left join ins i   on i.id = nw.id
order by a.n;
