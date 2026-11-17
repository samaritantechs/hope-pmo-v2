-- =====================================================================================
-- RUN-ME-067: THE DATES ON THE DEMAND NOTICES AND THE PMO DEDUCTIONS, AGAINST WHAT EACH ONE SAYS OF ITSELF. READ-ONLY: changes nothing.
--
--   "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026
--   (the scan of db/RUN-ME-064 flagged demand_notices.notice_date, demand_notices.created_at and pmo_deductions.discovery_date: dates later than today)
--
-- WHAT IT ASKS. Two small registers came in as Google Sheets exports, and the importers of that time read an ambiguous date (both parts twelve
-- or under) day-first where the sheets write it month-first (docs/HANDOFF.md Parts 84 and 89). A date can be checked without guessing when the
-- row itself says what it must be:
--   * A DEMAND NOTICE'S NUMBER CARRIES ITS DAY: HMCL/<initials>/<dd>/<mm>/<yyyy>, with -2, -3 for a repeat (made in the app from the notice's own
--     date, or by the sheet's script from its NoticeDate). The number is TEXT: the date bug never touched it. So a notice date that is the number's
--     date with day and month EXCHANGED is a swapped one; one that is the number's date is right; one that is neither is something else.
--     The notice's created_at (the register's TIMESTAMP) is asked the same way: the same day as the number, within a week of it, exchanged, other.
--   * A PMO DEDUCTION'S DATES MUST RUN IN ORDER: money received, then discovered, then the case submitted. A discovery date after the day the
--     case was submitted, or before the money was received, is impossible; if the same date with day and month exchanged puts the dates in order,
--     it is a swapped one. (Not proof: only the rows that break the order are seen.)
--
-- WHAT IT PRINTS. Counts, dates and the first eight characters of a row's id. NO NAME, NO LOAN NUMBER, NO NOTICE NUMBER, no amount.
-- WHAT IT CHANGES. Nothing: it reads demand_notices and pmo_deductions and nothing else. COST: about 1,200 rows, a fraction of a second (each step is MATERIALIZED:
-- left to be inlined, the planner repeated the number's pattern match about fifty times a row); a 30-second ceiling.
-- WHAT A CLEAN ANSWER DOES NOT PROVE. A notice whose number carries no date (typed another way) cannot be checked here, and a deduction whose dates
-- are in order is not shown right, only not shown wrong. A repair is built only from what this prints, and only for the rows it proves.
-- =====================================================================================
set local jit = off;
set local statement_timeout = '30s';

with m as materialized (    -- every notice: its date, its stamp's day (East Africa), whether it was imported (upload date set) or made in the app, and the parts of its number
  select n.id, n.notice_date as nd, (n.created_at at time zone 'Africa/Dar_es_Salaam')::date as cd, (n.upload_date is not null) as imp,
         regexp_match(n.notice_id, '^HMCL/[^/]+/(\d{2})/(\d{2})/(\d{4})(?:-\d+)?$') as p
  from public.demand_notices n
),
v as materialized (         -- the day the number carries, when it is a day that exists (a number is typed: 31/04 is no day)
  select m.*,
         case when m.p is null then null else
           case when (m.p)[2]::int between 1 and 12 and (m.p)[3]::int between 2000 and 2100 then
             case when (m.p)[1]::int between 1 and extract(day from (make_date((m.p)[3]::int, (m.p)[2]::int, 1) + interval '1 month' - interval '1 day'))::int
                  then make_date((m.p)[3]::int, (m.p)[2]::int, (m.p)[1]::int) end end end as idd
  from m
),
w as materialized (         -- the same day with its day and month exchanged (only a day twelve or under, and not the month, has another reading)
  select v.*,
         case when v.idd is not null and extract(day from v.idd) <= 12 and extract(day from v.idd) <> extract(month from v.idd)
              then make_date(extract(year from v.idd)::int, extract(day from v.idd)::int, extract(month from v.idd)::int) end as isw
  from v
),
k as (
  select w.*,
         case when w.nd is null then 'nodate' when w.idd is null then 'nonumber' when w.nd = w.idd then 'same'
              when w.isw is not null and w.nd = w.isw then 'swapped' else 'neither' end as kn,
         case when w.idd is null then 'nonumber' when w.cd = w.idd then 'same' when abs(w.cd - w.idd) <= 7 then 'near'
              when w.isw is not null and w.cd = w.isw then 'swapped' else 'other' end as kc
  from w
),
pd as materialized (        -- every PMO deduction: the day it was submitted (East Africa), the money received, the discovery, and the discovery with day and month exchanged
  select p.id, (p.submitted_at at time zone 'Africa/Dar_es_Salaam')::date as sd, p.received_date as rd, p.discovery_date as dc,
         case when p.discovery_date is not null and extract(day from p.discovery_date) <= 12 and extract(day from p.discovery_date) <> extract(month from p.discovery_date)
              then make_date(extract(year from p.discovery_date)::int, extract(day from p.discovery_date)::int, extract(month from p.discovery_date)::int) end as dsw
  from public.pmo_deductions p
),
pk as (
  select pd.*, (pd.dc is not null and pd.dc > pd.sd) as late_dc,                                   -- discovered after the case was submitted
         (pd.dc is not null and pd.rd is not null and pd.rd > pd.dc) as early_dc,                  -- discovered before the money was received
         (pd.dsw is not null and (pd.dc > pd.sd or (pd.rd is not null and pd.rd > pd.dc)) and pd.dsw <= pd.sd and (pd.rd is null or pd.rd <= pd.dsw)) as fixable
  from pd
),
today as (select (now() at time zone 'Africa/Dar_es_Salaam')::date as d),
ex as (        -- up to twelve notices to look at: the exchanged, the neither, and any dated later than today, the latest dates first (so the ones later than today lead)
  select k.id, k.nd, k.idd, k.cd, k.imp, k.kn, row_number() over (order by k.nd desc nulls last, k.id) as rn
  from k where k.kn in ('swapped', 'neither') or k.nd > (select d from today)
),
dx as (        -- up to ten deductions that break the order
  select pk.*, row_number() over (order by pk.sd desc, pk.id) as rn from pk where pk.late_dc or pk.early_dc
)
select z.what, z.answer from (
  select 0 as ord, 'ANSWER' as what,
         case when (select count(*) from k where kn in ('swapped', 'neither')) = 0 and (select count(*) from pk where late_dc or early_dc) = 0
              then 'every notice with a dated number agrees with its notice date, and no deduction was discovered out of order: nothing to repair here'
              else to_char((select count(*) from k where kn = 'swapped'), 'FM999,999,999') || ' notice date(s) are their number''s date with day and month EXCHANGED ('
                   || to_char((select count(*) from k where kn = 'swapped' and imp), 'FM999,999,999') || ' imported, ' || to_char((select count(*) from k where kn = 'swapped' and not imp), 'FM999,999,999')
                   || ' made in the app); ' || to_char((select count(*) from k where kn = 'neither'), 'FM999,999,999') || ' match neither; '
                   || to_char((select count(*) from pk where late_dc or early_dc), 'FM999,999,999') || ' deduction(s) have a discovery date out of order, '
                   || to_char((select count(*) from pk where fixable), 'FM999,999,999') || ' of them put in order by exchanging its day and month' end as answer
  union all
  select 1, 'demand notices in the book: all / imported (upload date set) / made in the app',
         to_char((select count(*) from k), 'FM999,999,999') || ' / ' || to_char((select count(*) from k where imp), 'FM999,999,999') || ' / ' || to_char((select count(*) from k where not imp), 'FM999,999,999')
  union all
  select 2, 'with a number that carries a day that exists: all / imported / made in the app',
         to_char((select count(*) from k where idd is not null), 'FM999,999,999') || ' / ' || to_char((select count(*) from k where idd is not null and imp), 'FM999,999,999') || ' / ' || to_char((select count(*) from k where idd is not null and not imp), 'FM999,999,999')
  union all
  select 3, '    notice date = the number''s day (right): all / imported / made in the app',
         to_char((select count(*) from k where kn = 'same'), 'FM999,999,999') || ' / ' || to_char((select count(*) from k where kn = 'same' and imp), 'FM999,999,999') || ' / ' || to_char((select count(*) from k where kn = 'same' and not imp), 'FM999,999,999')
  union all
  select 4, '    notice date = the number''s day with day and month EXCHANGED (swapped): all / imported / made in the app',
         to_char((select count(*) from k where kn = 'swapped'), 'FM999,999,999') || ' / ' || to_char((select count(*) from k where kn = 'swapped' and imp), 'FM999,999,999') || ' / ' || to_char((select count(*) from k where kn = 'swapped' and not imp), 'FM999,999,999')
  union all
  select 5, '    notice date matches neither: all / imported / made in the app',
         to_char((select count(*) from k where kn = 'neither'), 'FM999,999,999') || ' / ' || to_char((select count(*) from k where kn = 'neither' and imp), 'FM999,999,999') || ' / ' || to_char((select count(*) from k where kn = 'neither' and not imp), 'FM999,999,999')
  union all
  select 6, 'notices with no notice date / with no number that carries a day',
         to_char((select count(*) from k where kn = 'nodate'), 'FM999,999,999') || ' / ' || to_char((select count(*) from k where idd is null), 'FM999,999,999')
  union all
  select 7, 'notice date later than today: all / of them the number''s day is NOT later (so the date is swapped)',
         to_char((select count(*) from k where nd > (select d from today)), 'FM999,999,999') || ' / ' || to_char((select count(*) from k where nd > (select d from today) and idd is not null and idd <= (select d from today)), 'FM999,999,999')
  union all
  select 8, 'stamp (created_at) against the number''s day, of the notices that have one: same day / within 7 days / EXCHANGED / other',
         to_char((select count(*) from k where kc = 'same'), 'FM999,999,999') || ' / ' || to_char((select count(*) from k where kc = 'near'), 'FM999,999,999') || ' / '
         || to_char((select count(*) from k where kc = 'swapped'), 'FM999,999,999') || ' / ' || to_char((select count(*) from k where kc = 'other'), 'FM999,999,999')
  union all
  select 10 + e.rn::int, '    e.g. notice ' || left(e.id::text, 8),
         'notice date ' || coalesce(e.nd::text, 'none') || ', number says ' || coalesce(e.idd::text, 'no day') || ', stamp ' || e.cd::text || ', ' || case when e.imp then 'imported' else 'made in the app' end || ': ' || e.kn
  from ex e where e.rn <= 12
  union all
  select 30, 'PMO deductions in the book: all / with a discovery date',
         to_char((select count(*) from pk), 'FM999,999,999') || ' / ' || to_char((select count(*) from pk where dc is not null), 'FM999,999,999')
  union all
  select 31, '    discovery date after the day the case was submitted / before the money was received',
         to_char((select count(*) from pk where late_dc), 'FM999,999,999') || ' / ' || to_char((select count(*) from pk where early_dc), 'FM999,999,999')
  union all
  select 32, '    of the rows out of order: put in order by exchanging day and month of the discovery date',
         to_char((select count(*) from pk where fixable), 'FM999,999,999') || ' of ' || to_char((select count(*) from pk where late_dc or early_dc), 'FM999,999,999')
  union all
  select 40 + d.rn::int, '    e.g. deduction ' || left(d.id::text, 8),
         'money received ' || coalesce(d.rd::text, 'none') || ', discovered ' || coalesce(d.dc::text, 'none') || ', submitted ' || d.sd::text
         || case when d.fixable then ', in order with the discovery exchanged (' || d.dsw::text || ')' else ', not put in order by exchanging it' end
  from dx d where d.rn <= 10
) z
order by z.ord;
