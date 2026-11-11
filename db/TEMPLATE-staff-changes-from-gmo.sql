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
-- Parts 48 to 50.)
-- NO STAFF NAME IS EVER COMMITTED: this repository is public. The filled copy goes to the owner.
--
-- ONE ROW OF THE LIST FOR EACH PERSON:
--   n, list (whose message), what is asked, the name as written, then, where they apply:
--   role_word   'Manager', 'Field Officer', 'Bike Recovery' ...  (MOVE: null keeps the role they have)
--   team_text   the team as it should read after "ROLE - "
--   zone_teams  array of team names whose zone the person takes: the first one that has a zone, its own or its GMO's
--   zone_else   the sender's word for the zone: used only if a zone of that name is already filed
--   zone_like   array of names of colleagues already in the registry: their zone, as a last resort
--   account, phone, bank, nida, tin, nssf    (an account also FINDS a person whose name is spelt differently)
--   why         for ASK: what is missing
--
-- OFF    left, terminated or deactivated: switched to Inactive (off every request list, history
--        kept, nothing deleted).
-- MOVE   transferred: the role and team follow the transfer, and the zone becomes the zone of
--        the new team (its own ZONE on Teams & Staff, else its GMO's). The person stays, or
--        becomes, Active.
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
-- changed. A person nobody could be is then answered NAME BY NAME: for each of their names,
-- who in the whole registry carries it (the same word, or one letter apart), the names nobody
-- carries first, the sender's own zone first among the carriers, three shown and the rest
-- counted. A surname on nobody says the person was never registered. When the answer shows
-- the person (two names the same, the third spelt another way), ask for them in the next
-- script in the REGISTRY'S OWN SPELLING, or settle them by staff ID
-- (TEMPLATE-staff-changes-by-id.sql). For a NEW staff only the name, the account and the phone
-- are compared.
--
-- THE ZONE of a moved or new staff IS THE ZONE OF THEIR TEAM'S GMO (docs/HANDOFF.md Part 50):
--   "If an officer has team - zone is automatic of the GMO's" ... "to the respective team's gmo"
--   "So even manager - must have gmo of one of his team and auto match gmo and zone"
-- The team's own ZONE cell on Teams & Staff; where that is empty, the zone most of its GMO's
-- other teams carry (a tie goes to the first in A-to-Z order). A cell that holds a dash, N/A,
-- NONE or "NO GMO" names nobody: two teams whose GMO cell says "-" are not one GMO's teams.
-- The portal reads a team the same way: teamsZoned in api/_lib/zone.js is this rule in
-- JavaScript, and tm / gz / tz below are it in SQL. KEEP THE TWO ALIKE
-- (tools/db-checks/gmo-zone-parity.mjs reads random team tables both ways). A manager over
-- several teams takes the first of his teams that has a zone. Teams & Staff is the only place
-- a GMO's zone is read from: the zone on a GMO's own row in the registry is NOT used (a GMO
-- who was moved would take with him every officer later sent to the teams that still name
-- him, and a second run would not agree with the first). Only where Teams & Staff cannot say
-- does the script look further, in this order: the one zone of the teams whose names begin
-- with the team's name; the sender's word, only if a zone of that name is already filed; the
-- zone of the staff already on that team; (new staff) the zone of the colleagues named in
-- zone_like. A moved staff for whom none of these says keeps the old zone, and the row says
-- which is missing: name the GMO on the team, or type the ZONE on one of that GMO's teams, on
-- Teams & Staff and run the script again. Whenever a zone is not the team's own cell the row
-- says where it came from, and when a GMO's teams carry more than one zone it lists them.
--
-- SAFE TO RUN AGAIN: the second run changes nothing and says so.
-- It reads and writes the staff registry and reads the teams table. Nothing on uploads,
-- nothing on HOPE Calls. On a registry of 5,000 staff a list of forty takes under two seconds,
-- even one on which nobody is found, WITH `set local jit = off` below: without it, a PostgreSQL
-- that compiles long queries spent eight seconds compiling this one before it ran it.
-- NOT DONE BY IT: the role columns of Teams & Staff (a manager who left or moved is still named
-- there until that tab is changed).
-- =====================================================================================
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local jit = off;   -- a long query: without this the database can spend seconds compiling it before it runs it

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
         regexp_replace(upper(coalesce(s.zone, '')), '[^A-Z0-9]', '', 'g') as zkey,
         (select case when length(d.x) = 9 then d.x end
            from (select right(regexp_replace(regexp_replace(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), '^255', ''), '^0+', ''), 9) as x) d) as phone9,
         string_to_array(regexp_replace(upper(btrim(s.name)), '\s+', ' ', 'g'), ' ') as w
  from staff_registry s
),
regw as (   -- every word (of four letters or more) of every name in the registry. Read only for somebody who was not found.
  select distinct r.id, y.w
  from reg r cross join lateral unnest(r.w) as y(w)
  where length(y.w) >= 4
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
zones as (   -- every zone name already filed, on Teams & Staff first, then in the registry. A cell with no letter or digit
             -- in it (a dash, a dot, a stray tab) is not a zone's name: it would otherwise answer for every row of the
             -- list that gives no word for its zone.
  select distinct on (regexp_replace(upper(q.zone), '[^A-Z0-9]', '', 'g'))
         upper(btrim(q.zone)) as zone, regexp_replace(upper(q.zone), '[^A-Z0-9]', '', 'g') as key
  from (select zone, 1 as src from teams union all select zone, 2 from staff_registry) q
  where regexp_replace(upper(coalesce(q.zone, '')), '[^A-Z0-9]', '', 'g') <> ''
  order by regexp_replace(upper(q.zone), '[^A-Z0-9]', '', 'g'), q.src
),
tm as (   -- Teams & Staff as it stands: each team, its own ZONE cell, its GMO. A cell is read as the portal reads it
          -- (teamsZoned in api/_lib/zone.js): blanks at its ends dropped, a no-break space or a tab counting as a blank
          -- (cells pasted from Excel or WhatsApp carry them); in capitals; a GMO's name with runs of blanks as one.
          -- A DASH IS NOT A PERSON, AND NOT A ZONE: a cell holding only dashes, N/A, NONE, NIL, HAKUNA, 0, "NO ..." or
          -- "(unassigned)" names nobody (nameOrNull in api/_lib/parse.js), so two teams whose GMO cell says "-" are not
          -- one GMO's teams.
  select t.team, regexp_replace(upper(t.team), '[^A-Z0-9]', '', 'g') as tkey,
         case when c.g_named then c.g end as gmo,
         case when c.g_named then upper(regexp_replace(c.g, sp.blank || '+', ' ', 'g')) end as gkey,
         case when c.z_named then upper(c.z) end as own
  from teams t
  cross join (select '[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]'::text as blank,
                     '^([-\u2010-\u2015_.\u00B7]+|n/?a|none|nil|null|hakuna|0|no[ -].*|\(unassigned\).*)$'::text as nobody) sp
  cross join lateral (select regexp_replace(coalesce(t.gmo, ''), '^' || sp.blank || '+|' || sp.blank || '+$', '', 'g') as g,
                             regexp_replace(coalesce(t.zone, ''), '^' || sp.blank || '+|' || sp.blank || '+$', '', 'g') as z) c0
  cross join lateral (select c0.g, c0.z, c0.g <> '' and c0.g !~* sp.nobody as g_named, c0.z <> '' and c0.z !~* sp.nobody as z_named) c
),
gz as (   -- A GMO'S ZONE: the one most of their teams carry on Teams & Staff (a tie goes to the first in A-to-Z order).
          -- The same reading the portal makes (teamsZoned in api/_lib/zone.js): one rule, written twice, kept alike.
  select g.gkey, (array_agg(g.zone order by g.teams desc, g.zone collate "C"))[1] as zone, count(*) as zones_n,
         string_agg(g.zone || ' on ' || g.teams, ', ' order by g.teams desc, g.zone collate "C") as spread
  from (select m.gkey, m.own as zone, count(*) as teams from tm m where m.gkey is not null and m.own is not null group by m.gkey, m.own) g
  group by g.gkey
),
tz as (   -- A TEAM'S ZONE IS ITS GMO'S -- "If an officer has team - zone is automatic of the GMO's" / "to the respective
          -- team's gmo" / "So even manager - must have gmo of one of his team and auto match gmo and zone".
          -- The team's own ZONE cell on Teams & Staff; where that is empty, its GMO's zone (gz). Teams & Staff is the only
          -- source: the zone on a GMO's own row in the registry is NOT read (a GMO who was moved would take with him every
          -- officer later sent to the teams that still name him, and a second run would not agree with the first).
  select m.team, m.tkey, m.gmo, coalesce(m.own, gz.zone) as zone,
         case when m.own is not null then 'team' when gz.zone is not null then 'gmo' end as how,
         case when m.own is null and gz.zones_n > 1 then gz.spread end as spread
  from tm m
  left join gz on gz.gkey = m.gkey
),
z as (   -- the zone for a row: its team's GMO's (tz); else the one zone of the teams whose names begin with it; else the
         -- sender's word if such a zone is filed; else the zone of the staff already on that team; else its colleagues'
  select a.n, tf.team as team_filed, tf.gmo as team_gmo, tf.spread as gmo_spread, coalesce(tf.zone, tl.zone) as z_team,
         case when tf.zone is not null then tf.how when tl.zone is not null then 'like' end as z_how,
         (select zz.zone from zones zz
           where zz.key = nullif(regexp_replace(upper(coalesce(a.zone_else, '')), '[^A-Z0-9]', '', 'g'), '')) as z_else,
         (select mode() within group (order by upper(btrim(r.zone))) from reg r
           where r.nkey = any (select regexp_replace(upper(btrim(x)), '\s+', ' ', 'g') from unnest(a.zone_like) x)
             and r.zkey <> '') as z_like,
         (select mode() within group (order by upper(btrim(r.zone))) from reg r
           where a.team_text is not null and r.live and r.zkey <> '' and r.role ~ '\S\s+-\s+\S'
             and regexp_replace(upper(regexp_replace(r.role, '^.*?\s+-\s+', '')), '[^A-Z0-9]', '', 'g')
                 like regexp_replace(upper(a.team_text), '[^A-Z0-9]', '', 'g') || '%'
             and r.nkey not in (select x.nkey from a2 x)) as z_peers
  from a2 a
  left join lateral (   -- the team as Teams & Staff names it: the first of zone_teams found, one with a zone first. Two
                        -- teams can differ only by a mark or by capitals ("TEAM-1", "Team 1"): then the one written as the
                        -- list wrote it, then the one whose ZONE is typed on it, then A to Z: never whichever came first.
    select t.team, t.gmo, t.zone, t.how, t.spread
    from unnest(a.zone_teams) with ordinality as zt(name, pos)
    join tz t on t.tkey = regexp_replace(upper(zt.name), '[^A-Z0-9]', '', 'g')
    order by (t.zone is null), zt.pos, (upper(btrim(t.team)) <> upper(btrim(zt.name))), (t.how is distinct from 'team'), t.team collate "C"
    limit 1
  ) tf on true
  left join lateral (   -- no team of that very name: the teams whose names begin with it, if they all sit in one zone
    select min(t.zone) as zone
    from unnest(a.zone_teams) as zt(name)
    join tz t on length(regexp_replace(upper(zt.name), '[^A-Z0-9]', '', 'g')) >= 4
             and t.tkey like regexp_replace(upper(zt.name), '[^A-Z0-9]', '', 'g') || '%'
    where t.zone is not null
    having count(distinct t.zone) = 1
  ) tl on true
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
         case when a.nth = 1 and a.act in ('MOVE', 'PLACE', 'NEW') and (t.id is not null or i.id is not null) and z.z_how = 'gmo'
              then 'the team has no ZONE on Teams & Staff: zone is its GMO''s' || coalesce(' (' || z.team_gmo || ')', '')
                   || coalesce('; that GMO''s teams carry more than one zone (' || z.gmo_spread || '): the one most of them carry was taken', '')
              when a.nth = 1 and a.act in ('MOVE', 'PLACE', 'NEW') and (t.id is not null or i.id is not null) and z.z_how = 'like'
              then case when z.team_filed is null then 'no team of that very name on Teams & Staff'
                        when z.team_gmo is null then 'the team has no ZONE on Teams & Staff and no GMO is named on it'
                        else 'the team has no ZONE on Teams & Staff, and its GMO (' || z.team_gmo || ') has no team with a zone' end
                   || ': zone is the one zone of the teams whose names begin with it' end,
         case when a.nth = 1 and a.act in ('MOVE', 'PLACE', 'NEW') and (t.id is not null or i.id is not null) and z.z_team is null
              then case when coalesce(cardinality(a.zone_teams), 0) = 0 then 'no team was given'
                        when z.team_filed is null then 'no team of that name on Teams & Staff'
                        when z.team_gmo is null then 'the team has no ZONE on Teams & Staff and no GMO is named on it'
                        else 'the team has no ZONE on Teams & Staff, and its GMO (' || z.team_gmo || ') has no team with a zone' end
                   || case when z.z_else is not null then ': zone taken from the sender''s word'
                           when z.z_peers is not null then ': zone taken from the staff already on that team'
                           when a.act = 'MOVE' then ': zone left as it was'
                           else ': zone taken from colleagues on the same list' end end,
         case when a.nth = 1 and a.act <> 'ASK' and t.id is null and t.all_n is not null then 'they are: ' || t.ids end,
         case when a.nth = 1 and a.act in ('OFF', 'MOVE') and t.all_n is null then 'nearest names: ' || coalesce((
                select string_agg(q.name_as_filed || ' [' || q.id || ', ' || coalesce(q.zone, 'no zone') || ', ' || q.status || ']', '; ')
                  from (select r2.* from reg r2
                         where r2.w && a.w
                           and (select count(distinct x) from unnest(a.w) x where length(x) > 1 and x = any (r2.w)) >= 2
                         order by (r2.zkey = regexp_replace(upper(coalesce(a.grp, '')), '[^A-Z0-9]', '', 'g')) desc, r2.nkey limit 4) q),
                -- nobody shares two words: each of the person's names in turn, and who in the whole registry carries it (the
                -- same word, or one letter apart). The names nobody carries come first: a surname on nobody says the person
                -- is not in the registry, whatever a first name hundreds carry may show. The sender's own zone first.
                (select 'none with two of these words; who carries a name like each of these: '
                        || string_agg(x.x || ': ' || coalesce(m.shown || case when m.n > 3 then ' (and ' || (m.n - 3) || ' more)' else '' end, 'nobody'),
                                      ' · ' order by m.n, x.pos)
                  from (select u.x, min(u.pos) as pos from unnest(a.w) with ordinality as u(x, pos) where length(u.x) >= 4 group by u.x) x
                  cross join lateral (
                    select count(*) as n, string_agg(c.label, '; ' order by c.rn) filter (where c.rn <= 3) as shown
                    from (select r2.name_as_filed || ' [' || r2.id || ', ' || coalesce(r2.zone, 'no zone') || ', ' || r2.status || ']' as label,
                                 row_number() over (order by (r2.zkey is distinct from regexp_replace(upper(coalesce(a.grp, '')), '[^A-Z0-9]', '', 'g'))::int,
                                                             r2.nkey, r2.id) as rn
                            from reg r2
                           where r2.id in (select g.id from regw g
                                            where abs(length(x.x) - length(g.w)) <= 1
                                              and (left(x.x, 1) = left(g.w, 1) or right(x.x, 1) = right(g.w, 1))
                                              and (x.x = g.w
                                                or (select max(i) from generate_series(0, least(length(x.x), length(g.w))) i where left(x.x, i) = left(g.w, i))
                                                 + (select max(i) from generate_series(0, least(length(x.x), length(g.w))) i where right(x.x, i) = right(g.w, i))
                                                 >= greatest(length(x.x), length(g.w)) - 1))) c
                  ) m),
                'none with a word like any of these') end,
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
