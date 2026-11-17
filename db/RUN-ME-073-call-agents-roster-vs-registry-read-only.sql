-- =====================================================================================
-- THE CALL-AGENTS ROSTER AGAINST THE STAFF REGISTRY: WHOSE SALARY ADVANCE REQUEST PRINTS NO ACCOUNT BECAUSE THE NAME IS SPELLED ANOTHER WAY (READ-ONLY: changes nothing)
--
--   "the missing account numbers at advance salary tabs automatically fill themselves? ... finance manager is pulling that report and needs the column filled" -- the owner, 17 Nov 2026
--
-- HOW A CUSTOMER SERVICE REQUEST FINDS ITS ACCOUNT. The request tab offers the names of the call-agents roster (Settings, Call agents), and gives a name its registry row, and so its staff ID, ONLY WHEN
-- THE ROSTER'S NAME AND AN ACTIVE REGISTRY NAME ARE THE SAME LETTERS AND BLANKS (capitals do not matter; a different spelling, one more name, or two blanks where the other has one, does).
-- Otherwise the request is filed with no staff ID, and the Advance report cannot reach the registry for it: its account prints blank, however well the registry knows the person.
-- WHAT COMES BACK. One row for each name on the roster (a roster row holds one or several names, separated by commas or semicolons), the names that are NOT found first:
--   * the tab FINDS it: the registry's staff ID, and whether the registry has a real account and a bank for them.
--   * the tab does NOT find it: the Active registry records that carry EVERY WORD of the name (the same person under a longer or differently ordered name, or with different blanks), and the Active
--     records of the customer service department that share ONE word with it (a different spelling). Nobody is chosen: the owner says which is the same person.
--   * how many requests are filed under this name with no staff ID (every month, every state).
-- COST. The roster (dozens of names) against the registry (thousands of rows, once for each name) and the requests by name: a fraction of a second. A 20-second ceiling.
-- =====================================================================================
set local statement_timeout = '20s';
set local jit = off;

with roster as (
  select distinct upper(btrim(n, E' \t\r\n')) as raw
  from public.call_agents c, regexp_split_to_table(coalesce(c.names, ''), '[,;]') n
  where btrim(n, E' \t\r\n') <> ''
),
reg as (
  select r.id, r.name, r.role, r.zone, (coalesce(r.account, '') ~ '[1-9]') as has_acc, (btrim(coalesce(r.bank, '')) <> '') as has_bank,
         upper(btrim(r.name, E' \t\r\n')) as k,
         upper(btrim(regexp_replace(r.name, '\s+', ' ', 'g'))) as nm,
         regexp_split_to_array(upper(btrim(regexp_replace(r.name, '\s+', ' ', 'g'))), ' ') as w
  from public.staff_registry r
  where upper(btrim(coalesce(r.status, ''))) <> 'INACTIVE'
),
x as (
  select ro.raw, upper(ro.raw) as k, upper(btrim(regexp_replace(ro.raw, '\s+', ' ', 'g'))) as nm,
         regexp_split_to_array(upper(btrim(regexp_replace(ro.raw, '\s+', ' ', 'g'))), ' ') as w,
         (select count(*) from public.advance_requests a where a.staff_id is null and upper(btrim(regexp_replace(a.staff_name, '\s+', ' ', 'g'))) = upper(btrim(regexp_replace(ro.raw, '\s+', ' ', 'g')))) as req_no_id
  from roster ro
),
hit as (                                    -- the tab's own test: the same letters and blanks, capitals and the ends of the cell aside
  select x.raw, g.id, g.has_acc, g.has_bank
  from x join reg g on g.k = x.k
),
every as (                                  -- not found: the Active records that carry every word of the roster's name
  select x.raw, g.id, g.nm, g.role, g.zone, g.has_acc, (g.nm = x.nm) as same_words
  from x join reg g on not exists (select 1 from unnest(x.w) y where strpos(g.nm, y) = 0)
  where not exists (select 1 from hit h where h.raw = x.raw)
),
dept as (                                   -- not found: the Active records of the customer service department that share one word of it
  select x.raw, g.id, g.nm
  from x join reg g on upper(coalesce(g.zone, '')) like '%CUSTOMER%'
                   and exists (select 1 from unnest(g.w) a join unnest(x.w) b on a = b)
  where not exists (select 1 from hit h where h.raw = x.raw)
    and not exists (select 1 from every e where e.raw = x.raw and e.id = g.id)
)
select x.nm                                                        as roster_name,
       case when h.raw is not null then 'YES: the tab finds it' else 'NO: the request is filed with no staff ID' end as the_tab,
       x.req_no_id                                                 as requests_with_no_staff_id,
       case when h.raw is not null
              then (select string_agg(h2.id || ' [' || case when h2.has_acc then 'a real account' else 'NO ACCOUNT' end || ', ' || case when h2.has_bank then 'a bank name' else 'no bank name' end || ']', ' ; ' order by h2.id) from hit h2 where h2.raw = x.raw)
            else coalesce((select string_agg(e.id || ' [' || coalesce(e.role, '-') || ', ' || coalesce(e.zone, '-') || ', ' || case when e.has_acc then 'a real account' else 'NO ACCOUNT' end || '] is "' || e.nm || '"' || case when e.same_words then ' (the same words: only the blanks differ)' else '' end, ' ; ' order by e.id) from every e where e.raw = x.raw),
                          'no Active record carries every word of it')
                 || coalesce((select ' || SAME DEPARTMENT, ONE WORD IN COMMON: ' || string_agg(d.id || ' "' || d.nm || '"', ' ; ' order by d.id) from dept d where d.raw = x.raw), '')
       end                                                         as registry
from x
left join (select distinct raw from hit) h on h.raw = x.raw
order by (h.raw is not null), x.nm collate "C", x.raw collate "C";
