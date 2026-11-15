-- =====================================================================================
-- RUN-ME-057 -- "EXPECTED DEFAULTERS RECOVERY" ON THE DASHBOARD: EACH DAY'S OWN LIST ONLY
-- =====================================================================================
--
--   "i dont think all the amount we recover per day is of expected defaulters only"
--   "whole company recovery being equal to expected defaulters recovery is abnormal"
--   "This cant be okay" ... "recovered amounts of full cant equal of owed expected defs"
--       -- the owner, 14 and 15 Nov 2026, with the two dashboard cards side by side: Monday
--          9,286,335 on "Weekly recovery trend" and 9,286,335 on "Expected Defaulters
--          recovery"; Tuesday 13,911,553 on both; Friday 11,913,273 on both.
--
-- THE OWNER WAS RIGHT AND THE CARD WAS WRONG. RUN-ME-056's function (expdf_recovery_totals)
-- counted EVERY customer on a day's initial file. That is the whole defaulter book -- the same
-- population "Weekly recovery trend" reads -- so the two cards could only ever differ by the
-- few shillings of a customer whose arrears grew. An Expected Defaulter OF A DAY has had one
-- definition in this system all along, and it is not "everyone in the file":
--
--     "Every defaulter is visited twice a week and the two days are derived from the loan
--      itself: the weekday it was disbursed on (Day 1) and three days later (Day 2)"
--          -- expectedDefaulters, api/_lib/portal-core.js: the Mon..Sun pills on the Expected
--             Defaulters tab, and the daily list of the Exp.Def Report (periodRows_ in
--             api/_lib/expdf.js: "on a daily reading, the customers whose cycle day it is").
--
-- RUN-ME-056 ported the report's test for "is this customer in the file" and left out the test
-- for "is today their day". This file is that second test, and nothing else is new:
--
--   WHO COUNTS ON DAY D   a customer on day D's OWN INITIAL file ("the lists per day must come
--                         from initial files") whose Day 1 or Day 2 is D's weekday. Day 1 is
--                         the weekday of the loan's disbursement date; Day 2 is three days
--                         later, wrapping the week -- the one formula buildRows_, the Expected
--                         Defaulters tab and the Exp.Def week already share, Monday = 1 to
--                         Sunday = 7 (handbook Part 60: Sunday is a day of its own).
--   WHAT THEY RECOVERED   their arrears on that day's initial file less their arrears on the
--                         SAME day's current file, per customer, never negative; a customer the
--                         current file no longer names is recovered in full. Unchanged from
--                         RUN-ME-056.
--   THE PERCENTAGE        recovered over the initial arrears of that day's own list -- "opnly
--                         expeef is against total arrea of the day given".
--
-- THE DISBURSEMENT DATE is read off the customer's row on the day's initial file; where that
-- row carries none, off the same customer's row on the same day's current file. It is one fact
-- about one loan, on whichever of the day's two rows has it.
--
-- A CUSTOMER WITH NO DISBURSEMENT DATE ON EITHER ROW has no day. The week of the Exp.Def Report
-- already says what happens to such a customer (handbook Part 54: "a real defaulter is never
-- silently absent"): they are counted ONCE for the week, on the last day their team's file
-- still carried them, and never once per day. The same here, over the dates one call asks for:
-- once, on the latest of those dates that carried them undated, and not at all if the same
-- customer was counted on a real cycle day in those dates. `undated` says how many of a day's
-- customers were counted that way, so the card can say so.
--
-- A TEAM-DAY WITH A FILE AND NOBODY ON CYCLE comes back as a row of zeros, not as no row: the
-- card reads "not uploaded yet" from an absent row, and a file that was uploaded must never
-- read as one that was not.
--
-- A NEW NAME, NOT A NEW BODY UNDER THE OLD ONE. The page asks for expdf_cycle_recovery_totals.
-- Until this file is run that function does not exist, the read answers nothing, and the card
-- says "no answer yet" on every day and names this file -- rather than going on showing the
-- whole book's recovery under the Expected Defaulters' name. The old function is dropped below:
-- nothing calls it any more, and two definitions of one figure is the thing this repository is
-- built not to have.
--
-- WHAT IT COSTS. The same two files a day that RUN-ME-056 read, the same way (the winning
-- upload per team on that exact date and weekday), one more column of them (disb_date), and a
-- pass over the week's own rows in memory to settle the cycle day. MEASURED, old function and
-- new on the same machine in the same minute, on a book of 2,267,118 rows (42 teams, 150 days,
-- two files a day, 180 customers a team a day, every customer with a disbursement date of
-- their own spread over the seven weekdays): a full week for every team -- the most an
-- unrestricted admin's dashboard asks for -- 294 rows in 300 to 365 ms, where RUN-ME-056's
-- function took 220 to 265 ms; one team's week, 45 ms for either. Checked there against a
-- query written a second way (the same 294 rows, to the shilling), and day for day against the
-- old function: Thursday's own list was 2,139 of the 7,560 customers on the file, 736,977
-- recovered where the whole book showed 2,931,516. The planner settings and the two-second
-- ceiling are RUN-ME-056's own; `work_mem = 8MB` for this function alone keeps the week's rows
-- in memory (without it they went to temporary files and the same read took about 365 ms).
--
-- tools/db-checks/expdf-cycle-recovery-parity.mjs reads random weeks of decks through this
-- function and through the mirror the tests use (test/snapshot-totals-rpc.mjs) and fails on
-- the first difference; it was run on 500 weeks, and on eight deliberate breaks of the rule.
--
-- Nothing on /api/upload or /api/call reads this. Paste the whole file and run it once.
-- SAFE TO RE-RUN.
-- =====================================================================================

drop function if exists public.expdf_recovery_totals(date[], text[], text[]);
drop function if exists public.expdf_cycle_recovery_totals(date[], text[], text[]);

create or replace function public.expdf_cycle_recovery_totals(p_dates date[], p_weekdays text[], p_teams text[] default null)
returns table (snapshot_date date, team text, initial numeric, current numeric, recovered numeric,
               customers integer, undated integer)
language sql stable set jit = off set enable_bitmapscan = off set enable_seqscan = off
  set statement_timeout = '2000ms' set work_mem = '8MB' as $$
with p as materialized (
  -- One row per distinct (date, weekday) asked for, and the date's own weekday as a number:
  -- Monday 1 to Sunday 7, the scale the cycle days below are on.
  select distinct u.d as snapshot_date, upper(u.wd) as weekday, extract(isodow from u.d)::int as dow
  from unnest(p_dates, p_weekdays) as u(d, wd)
  where u.d is not null and u.wd is not null
),
-- THE DRIVING TABLE: the day's own initial file, the winning upload per team on that exact
-- date and weekday -- RUN-ME-056's own read, with the disbursement date beside the arrears.
ini as materialized (
  select p.snapshot_date, p.dow, x.ref, x.team, x.arrears, x.disb_date
  from p
  cross join lateral (
    select distinct on (y.ref) y.ref, y.team, y.arrears, y.disb_date
    from (
      select s.ref, s.team, s.arrears, s.disb_date, s.upload_batch, s.created_at,
             first_value(s.upload_batch) over (partition by s.team
               order by s.created_at desc nulls last, s.upload_batch desc nulls last) as win_batch
      from public.defaulter_snapshots s
      where s.snapshot_type = 'initial' and s.snapshot_date = p.snapshot_date and s.weekday = p.weekday
        and (p_teams is null or s.team = any(p_teams))
    ) y
    where y.upload_batch is not distinct from y.win_batch
    order by y.ref, y.created_at desc nulls last
  ) x
),
-- The same day's current file, looked UP by the driving table and never walked on its own: a
-- customer the initial file did not name is not that day's to count, whatever the current says.
cur as materialized (
  select p.snapshot_date, x.ref, x.arrears, x.disb_date
  from p
  cross join lateral (
    select distinct on (y.ref) y.ref, y.arrears, y.disb_date
    from (
      select s.ref, s.team, s.arrears, s.disb_date, s.upload_batch, s.created_at,
             first_value(s.upload_batch) over (partition by s.team
               order by s.created_at desc nulls last, s.upload_batch desc nulls last) as win_batch
      from public.defaulter_snapshots s
      where s.snapshot_type = 'current' and s.snapshot_date = p.snapshot_date and s.weekday = p.weekday
        and (p_teams is null or s.team = any(p_teams))
    ) y
    where y.upload_batch is not distinct from y.win_batch
    order by y.ref, y.created_at desc nulls last
  ) x
),
-- Each customer of each day: what the current file says of them (nothing = 0, recovered in
-- full); Day 1 of their cycle, the weekday of the disbursement date (0 when neither of the
-- day's two rows carries one); and IS TODAY THEIR DAY -- Day 1, or Day 2 three days later.
-- The formula is buildRows_'s, to the character: secondary = ((primary - 1 + 3) % 7) + 1.
k as materialized (
  select j.snapshot_date, j.team, j.ref, j.ini_arrears, j.cur_arrears, j.d1,
         (j.d1 <> 0 and (j.d1 = j.dow or ((j.d1 - 1 + 3) % 7) + 1 = j.dow)) as on_day
  from (
    select i.snapshot_date, i.dow, i.team, i.ref, i.arrears as ini_arrears,
           coalesce(c.arrears, 0) as cur_arrears,
           coalesce(extract(isodow from coalesce(i.disb_date, c.disb_date))::int, 0) as d1
    from ini i
    left join cur c on c.snapshot_date = i.snapshot_date and c.ref = i.ref
  ) j
),
-- The undated, once: the latest date asked for that carried the customer with no date -- and
-- no row at all for a customer that some date asked for counted on a real cycle day.
und as materialized (
  select u.ref, max(u.snapshot_date) as last_undated
  from k u
  where u.d1 = 0
    and not exists (select 1 from k d where d.ref = u.ref and d.on_day)
  group by u.ref
)
-- Every team-day that HAS an initial file answers, with zeros when nobody on it is on cycle.
select n.snapshot_date, n.team,
       coalesce(sum(n.ini_arrears) filter (where n.keep), 0)::numeric as initial,
       coalesce(sum(n.cur_arrears) filter (where n.keep), 0)::numeric as current,
       -- PER-CUSTOMER CLAMP, THEN SUM -- the Exp.Def rule (buildRows_), unchanged from RUN-ME-056.
       coalesce(sum(greatest(n.ini_arrears - n.cur_arrears, 0)) filter (where n.keep), 0)::numeric as recovered,
       (count(*) filter (where n.keep))::int as customers,
       (count(*) filter (where n.keep and not n.on_day))::int as undated
from (
  select k.*, (k.on_day or (k.d1 = 0 and u.last_undated = k.snapshot_date)) as keep
  from k
  left join und u on k.d1 = 0 and u.ref = k.ref
) n
group by n.snapshot_date, n.team;
$$;

grant execute on function public.expdf_cycle_recovery_totals(date[], text[], text[]) to anon, authenticated, service_role;
notify pgrst, 'reload schema';

-- Confirms the function exists. Read-only.
select proname from pg_proc where proname = 'expdf_cycle_recovery_totals';
