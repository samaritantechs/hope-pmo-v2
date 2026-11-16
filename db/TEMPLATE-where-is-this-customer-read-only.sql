-- WHERE IS THIS CUSTOMER ON A DAY'S FILES? READ-ONLY: changes nothing. One statement, a few milliseconds.
-- A TEMPLATE, like the staff scripts: the loan number below is a placeholder and no customer is named here.
-- Edit the two values in the line that starts "with q as" (the loan number and the day) and press Run.
--
--   "Was 2209966593 on initial file of today 16th nov 2026 & expected defaulters? is it still in the expected
--    defaulter reports for the recovered amounts?" -- the owner, 16 Nov 2026
--
-- What the answer means, state by state (docs/HANDOFF.md Part 84):
--   A on both files       counted everywhere: the Exp.Def Report, the Expected Defaulters tab, the phone, the dashboard card.
--   B left the current file  (on that day's initial file, absent from its current file, seen on an earlier current file)
--                         the dashboard card counts it recovered IN FULL; the Exp.Def Report, the tab and the phone list it
--                         CLEARED with recovered 0 (the last known arrears stay on the row). See Part 84, "Not done".
--   C initial file only   the Exp.Def Report (day) and the phone do not list it; the tab and the card count it in full.
-- Q2b matters: a loan that carries two different disbursement dates (a day/month swap) is on the wrong days in the portal.
--
--
-- Q1 was the customer on that day's INITIAL file?   Q2 which day is theirs (the date the portal reads, and every
-- other date this loan has carried)?   Q3 are they on that day's CURRENT file?   Q4 which of three states,
-- Q5 what they recovered by the rule the dashboard card uses.   Under the answers: every row of theirs from the
-- 14 days up to that day, with the dates on the row, and whether the upload holding it is the one that counts.
-- The upload that counts for a team, a type and a day is the NEWEST ONE AS A WHOLE (all its rows, however many
-- pieces it was written in), the rule the portal reads; an older upload of the same day is marked REPLACED.

with q as (select '0000000000'::text as ref, date '2026-11-16' as day),
mine as (
  select d.snapshot_date, d.weekday, d.snapshot_type as typ, d.team, d.status, d.arrears, d.days_elapsed,
         d.disb_date, d.expire_date, d.due_date, d.chronic_date, d.upload_batch, d.created_at
  from public.defaulter_snapshots d
  where d.ref = (select ref from q)
),
keys as (
  select distinct typ, weekday, snapshot_date, team
  from mine where snapshot_date between (select day from q) - 14 and (select day from q)
),
win as (   -- for each team, type and day: the batch of the newest row, and how many rows and when
  select k.typ, k.weekday, k.snapshot_date, k.team, b.upload_batch as win_batch, b.created_at as win_at,
         (select count(*) from public.defaulter_snapshots w
           where w.snapshot_type = k.typ and w.weekday = k.weekday and w.snapshot_date = k.snapshot_date
             and w.team = k.team and w.upload_batch is not distinct from b.upload_batch) as win_rows
  from keys k
  cross join lateral (
    select w.upload_batch, w.created_at from public.defaulter_snapshots w
     where w.snapshot_type = k.typ and w.weekday = k.weekday and w.snapshot_date = k.snapshot_date and w.team = k.team
     order by w.created_at desc, w.upload_batch desc limit 1) b
),
cur as (
  select m.*, w.win_at, w.win_rows,
         (m.upload_batch is not distinct from w.win_batch) as counts
  from mine m
  join win w on w.typ = m.typ and w.weekday is not distinct from m.weekday
            and w.snapshot_date = m.snapshot_date and w.team is not distinct from m.team
),
ini as (select * from cur where typ = 'initial' and snapshot_date = (select day from q) and counts order by created_at desc limit 1),
cc  as (select * from cur where typ = 'current' and snapshot_date = (select day from q) and counts order by created_at desc limit 1),
any_ini as (select * from cur where typ = 'initial' and snapshot_date = (select day from q) order by created_at desc limit 1),
filed as (select exists (select 1 from public.defaulter_snapshots w
                          where w.snapshot_type = 'current' and w.snapshot_date = (select day from q)) as yes),
earlier as (select max(snapshot_date) as last_current from mine where typ = 'current' and snapshot_date < (select day from q)),
cyc as (   -- the date the portal reads: the current row's, else the initial row's (of that day)
  select disb,
         extract(isodow from disb)::int as d1,
         ((extract(isodow from disb)::int - 1 + 3) % 7) + 1 as d2,
         extract(isodow from (select day from q))::int as today
  from (select coalesce((select disb_date from cc), (select disb_date from ini), (select disb_date from any_ini)) as disb) z
),
dn as (select array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] as n),
dates as (   -- every disbursement date this loan has carried in the window, and on how many rows
  select disb_date, count(*) as n_rows, count(*) filter (where typ = 'initial') as n_ini, count(*) filter (where typ = 'current') as n_cur
  from cur where disb_date is not null group by disb_date
)
select x.what, x.answer from (
  select 1 as ord, 'Q1  on the INITIAL file of ' || (select day from q) || '?' as what,
         case when exists (select 1 from ini)
              then 'YES -- in the upload that counts. Team ' || coalesce((select team from ini), '?') || ', status ' || coalesce((select status from ini), '-')
                   || ', arrears ' || coalesce((select arrears::text from ini), '-') || ', days in default ' || coalesce((select days_elapsed::text from ini), '-')
              when exists (select 1 from any_ini)
              then 'NO -- it is on an upload of that day that a LATER upload of the team replaced (that one holds '
                   || (select win_rows from any_ini) || ' rows of the team and does not hold this loan)'
              else 'NO -- no row of this loan number on any initial upload of that day' end as answer
  union all
  select 2, 'Q2  the day it falls on, by the date the portal reads (the current row''s, else the initial row''s)',
         case when (select disb from cyc) is null then 'NO DISBURSEMENT DATE on the rows: the system lists such a customer every day'
              else 'disbursed ' || (select disb from cyc) || ' (' || (select n from dn)[(select d1 from cyc)] || '): Day 1 = ' || (select n from dn)[(select d1 from cyc)]
                   || ', Day 2 = ' || (select n from dn)[(select d2 from cyc)] || '; that day is a ' || (select n from dn)[(select today from cyc)]
                   || ' -> ' || case when (select today from cyc) in ((select d1 from cyc), (select d2 from cyc)) then 'YES, it is their day' else 'NO, not their day' end end
  union all
  select 3, 'Q2b every disbursement date this loan carries on the rows below',
         coalesce((select string_agg(to_char(disb_date, 'YYYY-MM-DD') || ' (' || to_char(disb_date, 'Dy') || ': Day 1 ' || to_char(disb_date, 'Dy')
                                     || ', Day 2 ' || to_char(disb_date + 3, 'Dy') || ') on ' || n_rows || ' rows (' || n_ini || ' initial, ' || n_cur || ' current)', '  |  ' order by disb_date)
                     from dates), 'none')
  union all
  select 4, 'Q3  on the CURRENT file of that day?',
         case when exists (select 1 from cc)
              then 'YES -- status ' || coalesce((select status from cc), '-') || ', arrears ' || coalesce((select arrears::text from cc), '-')
              else 'NO -- not on the current file that counts for that day' end
         || '  (a current file for that day is ' || case when (select yes from filed) then 'filed)' else 'NOT filed yet)' end
  union all
  select 5, 'Q4  state',
         case when not exists (select 1 from ini) then 'not on that day''s initial file that counts, so not an expected defaulter of that day'
              when exists (select 1 from cc) then 'A: on both files'
              when (select last_current from earlier) is not null
                   then 'B: on the initial file, NOT on the current file; last seen on a current file on ' || (select last_current from earlier)
              else 'C: on the initial file ONLY -- never on any current file' end
  union all
  select 6, 'Q5  recovered by the dashboard card''s rule (initial - current; absent from the current file = cleared in full)',
         case when not exists (select 1 from ini) then '-'
              else (select arrears from ini)::text || ' - ' || coalesce((select arrears from cc), 0)::text || ' = '
                   || greatest(0, coalesce((select arrears from ini), 0) - coalesce((select arrears from cc), 0))::text
                   || case when (select disb from cyc) is not null and (select today from cyc) not in ((select d1 from cyc), (select d2 from cyc))
                           then '   (but that day is NOT their day by the date above, so the card does not count them)' else '' end end
  union all
  select 100 + row_number() over (order by r.snapshot_date desc, r.typ, r.created_at desc)::int,
         to_char(r.snapshot_date, 'YYYY-MM-DD Dy') || '  ' || r.typ,
         'team ' || coalesce(r.team, '?') || ', status ' || coalesce(r.status, '-') || ', arrears ' || coalesce(r.arrears::text, '-')
           || ', days ' || coalesce(r.days_elapsed::text, '-')
           || ', disbursed ' || coalesce(r.disb_date::text, '-') || ', expires ' || coalesce(r.expire_date::text, '-') || ', due ' || coalesce(r.due_date::text, '-')
           || ', uploaded ' || to_char(r.created_at at time zone 'Africa/Dar_es_Salaam', 'HH24:MI')
           || case when r.counts then '  [the upload that counts]'
                   else '  [REPLACED by a later upload at ' || to_char(r.win_at at time zone 'Africa/Dar_es_Salaam', 'HH24:MI') || ' holding ' || r.win_rows || ' rows of the team]' end
  from cur r
) x
order by x.ord;
