-- =====================================================================================
-- RUN-ME-058 -- "EXPECTED DEFAULTERS RECOVERY" ON THE DASHBOARD: THE SAME ANSWER FOR EVERYONE, AND A PLAN THAT CANNOT GO WRONG
-- =====================================================================================
--
-- THIS REPLACES RUN-ME-057. Run this file whether or not 057 was run: it drops 057's function
-- (and 056's) and the page asks only for this one.
--
-- THE RULE IS 057's, AND IT IS THE RULE OF EVERY "RECOVERED" FIGURE IN THIS SYSTEM:
--
--   WHO COUNTS ON DAY D   a customer on day D's OWN INITIAL file ("the lists per day must come
--                         from initial files") whose Day 1 or Day 2 is D's weekday. Day 1 is
--                         the weekday of the loan's disbursement date; Day 2 is three days
--                         later, wrapping the week -- the one formula buildRows_, the Expected
--                         Defaulters tab and the Exp.Def week share, Monday = 1 to Sunday = 7.
--   WHAT THEY RECOVERED   their arrears on that day's initial file less their arrears on the
--                         SAME day's current file, per customer, never negative.
--   GONE FROM THE CURRENT FILE = CLEARED, recovered in full. The current file is the whole
--                         book -- "one file, all weekdays together, every time" -- so a
--                         customer it does not name has left the book, and so has a whole team
--                         it does not name: "a team missing from it owes nothing on it, full
--                         stop", the trade made after "i bulked paid clients, many of them
--                         brother!" (db/RUN-ME-032 v8; defaulterBook in portal-core.js).
--   A DAY WITH NO CURRENT FILE AT ALL is not measured: a file that does not exist yet says
--                         nothing about anybody.
--   THE PERCENTAGE        recovered over the initial arrears of that day's own list -- "opnly
--                         expeef is against total arrea of the day given".
--   NO DISBURSEMENT DATE  counted ONCE among the dates one call asks for, on the latest of
--                         them that carried the customer undated, and not at all if the same
--                         customer was counted on a real cycle day (handbook Part 54).
--   NOBODY ON CYCLE       a team with an initial file on a measured day answers zeros, not no row.
--
-- WHAT THIS FILE CHANGES, found by a second reader the morning after 057 was handed over:
--
-- 1. "IS THERE A CURRENT FILE FOR THIS DAY" IS ASKED OF THE COMPANY, NOT OF THE CALLER'S TEAMS.
--    057 asked it of the teams the caller may see. So when a team was missing from a day's
--    current file, the admin read that team as cleared (the rule above) and the team's own
--    viewer read "not uploaded yet": one team, one day, two answers. recovery_standing has
--    always asked the whole book ("not narrowed by team"); this does now, with one index
--    probe a day. Everyone who can see a team reads the same thing about it.
--
-- 2. THE JOIN METHOD IS PINNED. The planner cannot know how many rows a day's file holds (it
--    guesses ten or twenty where fifteen thousand arrive), and on a guess that small three
--    join methods cost the same on paper. Two of them are ruinous here: timed on a test book,
--    057's text took 19.5 s when the planner was denied hash joins, and a merge join that
--    matched a day's two files on the DATE alone took 142 s -- against a two-second ceiling,
--    that is a card that never answers. `enable_nestloop = off` and `enable_mergejoin = off`
--    leave the hash join as the only choice for the joins between the week's rows (the read
--    of each day's file is not such a join and is not affected). With them the answer came
--    back in the same time whatever else the planner was denied (hash aggregates, sorts).
--
-- 3. WHEN A CUSTOMER'S TWO ROWS OF A DAY CARRY DIFFERENT DISBURSEMENT DATES the current row's
--    is the one read, as buildRows_ reads it; the initial row's is used when the current row
--    has none. (057 read them the other way round.)
--
-- A row that names no team is filed under the team '' -- one team, like any other.
--
-- WHAT WAS PROPOSED AND IS NOT DONE. The same reader read a team missing from a day's current
-- file as a team whose file had not arrived, and proposed "not measured" for it. That is the
-- other side of the trade quoted above, and this card does not get a rule of its own: it
-- follows the one "Weekly recovery trend" reads beside it. What the trade costs IF a current
-- file ever arrives without a team that still owes, measured on a test book: six of
-- eighty-four teams absent from a Thursday's current file read 9,282,638 recovered for the
-- day, where the teams present recovered 1,567,018. The owner's to change, and for every
-- recovery figure together.
--
-- WHAT IT COSTS. The same two files a day that 057 and 056 read, the same way, and seven
-- index probes. MEASURED on the same machine in the same hour: on a book of 2,267,118 rows (42
-- teams, 150 days, 180 customers a team a day) a full week for every team -- the most an
-- unrestricted admin's dashboard asks for -- 0.29 to 0.33 s (057: 0.29 to 0.35 s); one team's
-- week about 40 ms. On a harder book (84 teams, two uploads kept of every deck, one customer
-- in fifty with no disbursement date) 0.91 to 1.0 s (057: 0.81 to 0.95 s), one team 0.13 s.
-- On a book where EVERY customer has no disbursement date, 0.36 s. The two-second ceiling is
-- 056's own.
--
-- tools/db-checks/expdf-cycle-recovery-parity.mjs reads random weeks of decks through this
-- function and through the mirror the tests use (test/snapshot-totals-rpc.mjs) and fails on
-- the first difference.
--
-- Nothing on /api/upload or /api/call reads this. Paste the whole file and run it once.
-- SAFE TO RE-RUN.
-- =====================================================================================

drop function if exists public.expdf_recovery_totals(date[], text[], text[]);
drop function if exists public.expdf_cycle_recovery_totals(date[], text[], text[]);
drop function if exists public.expdf_team_day_recovery_totals(date[], text[], text[]);

create or replace function public.expdf_team_day_recovery_totals(p_dates date[], p_weekdays text[], p_teams text[] default null)
returns table (snapshot_date date, team text, initial numeric, current numeric, recovered numeric,
               customers integer, undated integer)
language sql stable set jit = off set enable_bitmapscan = off set enable_seqscan = off set enable_nestloop = off set enable_mergejoin = off
  set statement_timeout = '2000ms' set work_mem = '8MB' as $$
with p as materialized (
  -- One row per distinct (date, weekday) asked for, and the date's own weekday as a number:
  -- Monday 1 to Sunday 7, the scale the cycle days below are on.
  select distinct u.d as snapshot_date, upper(u.wd) as weekday, extract(isodow from u.d)::int as dow
  from unnest(p_dates, p_weekdays) as u(d, wd)
  where u.d is not null and u.wd is not null
),
-- THE DRIVING TABLE: the day's own initial file, the winning upload per team on that exact
-- date and weekday, with the disbursement date beside the arrears. A row that names no team
-- is filed under the team '' (one team, not nobody's).
ini as materialized (
  select p.snapshot_date, p.dow, x.ref, x.team, x.arrears, x.disb_date
  from p
  cross join lateral (
    select distinct on (y.ref) y.ref, y.team, y.arrears, y.disb_date
    from (
      select s.ref, coalesce(s.team, '') as team, s.arrears, s.disb_date, s.upload_batch, s.created_at,
             first_value(s.upload_batch) over (partition by coalesce(s.team, '')
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
  select p.snapshot_date, x.ref, x.team, x.arrears, x.disb_date
  from p
  cross join lateral (
    select distinct on (y.ref) y.ref, y.team, y.arrears, y.disb_date
    from (
      select s.ref, coalesce(s.team, '') as team, s.arrears, s.disb_date, s.upload_batch, s.created_at,
             first_value(s.upload_batch) over (partition by coalesce(s.team, '')
               order by s.created_at desc nulls last, s.upload_batch desc nulls last) as win_batch
      from public.defaulter_snapshots s
      where s.snapshot_type = 'current' and s.snapshot_date = p.snapshot_date and s.weekday = p.weekday
        and (p_teams is null or s.team = any(p_teams))
    ) y
    where y.upload_batch is not distinct from y.win_batch
    order by y.ref, y.created_at desc nulls last
  ) x
),
-- THE DAYS THAT COUNT: the ones for which THE COMPANY holds a current file -- asked of the
-- whole book, never of the teams the caller may see ("the single latest date the WHOLE COMPANY
-- holds a deck ... a team missing from it owes nothing on it, full stop": the rule every
-- "recovered" figure here reads, RUN-ME-032 v8). A day with an initial file and no current file
-- at all is not measured; a team missing from a current file that EXISTS has cleared -- for the
-- admin and for that team's own viewer alike. One index probe a day; a scalar sub-select, so it
-- stays a probe whatever the join settings above say.
filed as materialized (
  select q.snapshot_date
  from (
    select p.snapshot_date,
           (select 1 from public.defaulter_snapshots s
             where s.snapshot_type = 'current' and s.snapshot_date = p.snapshot_date and s.weekday = p.weekday
             limit 1) as has_current
    from p
  ) q
  where q.has_current is not null
),
-- Each customer of each measured day: what the current file says of them (nothing = 0,
-- recovered in full); Day 1 of their cycle, the weekday of the disbursement date -- the
-- current row's where it carries one, as the Exp.Def Report reads it, else the initial row's
-- (0 when neither does); and IS TODAY THEIR DAY -- Day 1, or Day 2 three days later. The
-- formula is buildRows_'s, to the character: secondary = ((primary - 1 + 3) % 7) + 1.
k as materialized (
  select j.snapshot_date, j.team, j.ref, j.ini_arrears, j.cur_arrears, j.d1,
         (j.d1 <> 0 and (j.d1 = j.dow or ((j.d1 - 1 + 3) % 7) + 1 = j.dow)) as on_day
  from (
    select i.snapshot_date, i.dow, i.team, i.ref, i.arrears as ini_arrears,
           coalesce(c.arrears, 0) as cur_arrears,
           coalesce(extract(isodow from coalesce(c.disb_date, i.disb_date))::int, 0) as d1
    from ini i
    join filed f on f.snapshot_date = i.snapshot_date
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
-- Every team with an initial file on a measured day answers, with zeros when nobody is on cycle.
select n.snapshot_date, n.team,
       coalesce(sum(n.ini_arrears) filter (where n.keep), 0)::numeric as initial,
       coalesce(sum(n.cur_arrears) filter (where n.keep), 0)::numeric as current,
       -- PER-CUSTOMER CLAMP, THEN SUM -- the Exp.Def rule (buildRows_).
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

grant execute on function public.expdf_team_day_recovery_totals(date[], text[], text[]) to anon, authenticated, service_role;
notify pgrst, 'reload schema';

-- Confirms the function exists. Read-only.
select proname from pg_proc where proname = 'expdf_team_day_recovery_totals';
