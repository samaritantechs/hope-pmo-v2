-- =====================================================================================
-- THE ADVANCE REPORT'S BLANK ACCOUNTS: WHO STILL PRINTS NO ACCOUNT NUMBER, BY ZONE, TEAM, STAFF NAME (READ-ONLY: changes nothing, prints no account, phone or NIDA)
--
--   "the missing account numbers at advance salary tabs automatically fill themselves? This was one of my objective since finance manager is pulling that report and needs the column filled" -- the owner, 17 Nov 2026
--
-- WHAT COMES BACK. One row for each person whose request, in the window below, the Advance report prints with NO account number, with how many of their requests and how much money.
-- The report prints the request's own copy of the account when it is a real account, else the registry's real account (docs/HANDOFF.md Part 102): so a request prints blank only when
-- BOTH are not an account. "Not an account" is the owner's one definition (RUN-ME-069): empty, blank, no digit in it ("N/A", "ON PROCESS"), or only zeros.
-- COLUMNS 1 TO 3 are the demand list for the WhatsApp group, in RUN-ME-069's form (zone, team, staff name; sorted the same way). The last three say how much is waiting and WHY.
--   * WHY "the registry has no account for this staff": ask the staff for it. When HR's registry holds it, the report fills itself, with no step.
--   * WHY "the request has no staff ID": a Customer Service request whose name is not, spelled exactly so, in the registry: the report cannot reach the registry for it. RUN-ME-073 shows
--     who on the call-agents roster is in that state and which registry records are close; the request is linked by a script, and the roster spelled as the registry has it.
--   * WHY "the staff ID on the request is in no registry record": the ID was mistyped or the record was deleted.
-- THE FIRST LINES. hope.from_day and hope.to_day are the days the request was SUBMITTED (the report's own window, UTC days); hope.approval is Approved, as the report's default, or ALL, or
-- one state (Pending, Disapproved, Expired).
-- COST. One pass over the requests of the window (a few hundred) and a lookup of each staff ID in the registry's primary key. A fraction of a second. A 20-second ceiling.
-- =====================================================================================
set local statement_timeout = '20s';
set local jit = off;
set local hope.from_day = '2026-11-01';        -- CHANGE: the first day of the window
set local hope.to_day = '2026-11-30';          -- CHANGE: the last day of the window
set local hope.approval = 'Approved';          -- CHANGE: ALL, or Pending, Disapproved, Expired

with cfg as (
  select (current_setting('hope.from_day') || 'T00:00:00Z')::timestamptz as t1,
         (current_setting('hope.to_day') || 'T23:59:59.999Z')::timestamptz as t2,
         upper(btrim(current_setting('hope.approval'))) as ap
),
q as (                                      -- the requests of the window, as the report reads them
  select a.id, a.staff_id, a.staff_name, a.account as copy_, a.amount
  from public.advance_requests a cross join cfg
  where a.submitted_at >= cfg.t1 and a.submitted_at <= cfg.t2
    and (cfg.ap = 'ALL' or upper(btrim(a.approval)) = cfg.ap)
),
b as (                                      -- those the report prints blank: the request's own copy is not an account, and neither is the registry's
  select q.id, q.amount, q.staff_name, q.staff_id, r.id as rid, r.name as rname, r.role as rrole, r.zone as rzone, r.status as rstatus
  from q
  left join public.staff_registry r on upper(btrim(r.id)) = upper(btrim(q.staff_id))
  where coalesce(q.copy_, '') !~ '[1-9]' and coalesce(r.account, '') !~ '[1-9]'
),
p as (                                      -- one row for each person
  select case when b.rid is not null then 'R:' || b.rid
              when b.staff_id is not null then 'I:' || upper(btrim(b.staff_id))
              else 'N:' || upper(btrim(regexp_replace(b.staff_name, '\s+', ' ', 'g'))) end as pkey,
         max(b.rid) as rid,
         max(upper(btrim(regexp_replace(coalesce(b.rname, b.staff_name), '\s+', ' ', 'g')))) as name0,
         max(upper(btrim(regexp_replace(coalesce(b.rzone, ''), '\s+', ' ', 'g')))) as zone0,
         max(upper(btrim(regexp_replace(coalesce(substring(b.rrole from '\s+-\s+(.*)$'), ''), '\s+', ' ', 'g')))) as team0,
         bool_or(upper(btrim(coalesce(b.rstatus, ''))) = 'INACTIVE') as inactive,
         count(*) as requests, sum(b.amount) as amount
  from b
  group by 1
)
select case when p.rid is not null then coalesce(nullif(p.zone0, ''), 'NO ZONE')
            when p.pkey like 'N:%' then 'NO STAFF ID ON THE REQUEST'
            else 'STAFF ID NOT IN THE REGISTRY' end                                       as "ZONE",
       coalesce(nullif(p.team0, ''), '-')                                                 as "TEAM",
       p.name0                                                                            as "STAFF NAME",
       p.requests                                                                         as "REQUESTS",
       p.amount                                                                           as "TZS",
       case when p.rid is not null and p.inactive then 'the registry has no account for this staff, and the registry says INACTIVE'
            when p.rid is not null then 'the registry has no account for this staff: ask them for it'
            when p.pkey like 'N:%' then 'the request has no staff ID: its name is not in the registry spelled exactly so (RUN-ME-073)'
            else 'the staff ID on the request is in no registry record' end              as "WHY"
from p
order by (p.rid is null), p.zone0 = '', p.zone0 collate "C", p.pkey like 'N:%', (p.team0 = ''), p.team0 collate "C", p.name0 collate "C", p.pkey collate "C";
