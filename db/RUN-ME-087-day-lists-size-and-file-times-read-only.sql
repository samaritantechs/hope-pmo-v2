-- RUN-ME-087 (READ-ONLY): HOW BIG WAS IT, AND WHEN DO THE DAY'S TWO FILES ARRIVE. 23 Nov 2026. Changes nothing.
-- "How comes staff are seeing expected defaultes with cleared like 62561111341 who are not even in the initial file of today" ...
-- "not just dropping but analyzing how that robust problem happens" -- the owner (handbook Part 136).
-- WHAT IT PRINTS, with no customer name, number or amount:
-- the FILES rows, one for each of the last nine days: at what time (East Africa) that day's morning (initial) file and its later
-- (current) files were uploaded, and how many hours the day had its morning file alone. Until Part 136 the phone listed LAST
-- WEEK's file for all of those hours; now it lists that morning's file.
-- the LISTS row: how many customers are on the newest later file, and how many others were ever on a later file of their team
-- and have since left (the cleared customers of earlier dates that every list was carrying until Part 136), with how long ago
-- they left. The last figure is what they were of the list: 40 means four rows in ten were people who had already cleared.
-- WHAT IT COSTS: two reads by index (the last nine days by date; one pass over the index of the current rows). A 20-second
-- ceiling: if it is ever reached the answer is an error and nothing has changed.
set local statement_timeout = '20s';
with q as (select (now() at time zone 'Africa/Dar_es_Salaam')::date as today),
f as (
select d.snapshot_date, d.snapshot_type, min(d.created_at) as first_at, max(d.created_at) as last_at
from public.defaulter_snapshots d
where d.snapshot_date >= (select today from q) - 8 and d.snapshot_date <= (select today from q)
group by d.snapshot_date, d.snapshot_type
),
days as (
select snapshot_date,
min(first_at) filter (where snapshot_type = 'initial') as ini_at,
min(first_at) filter (where snapshot_type = 'current') as cur_first,
max(last_at) filter (where snapshot_type = 'current') as cur_last
from f group by snapshot_date
),
latest as (select max(snapshot_date) as d from public.defaulter_snapshots where snapshot_type = 'current' and snapshot_date <= (select today from q)),
ever as (
select d.team, d.ref, max(d.snapshot_date) as last_day
from public.defaulter_snapshots d
where d.snapshot_type = 'current'
group by d.team, d.ref
),
tot as (
select count(*) filter (where last_day = (select d from latest)) as on_file,
count(*) filter (where last_day < (select d from latest)) as gone,
count(*) filter (where last_day < (select d from latest) and last_day >= (select d from latest) - 7) as gone_week,
count(*) filter (where last_day < (select d from latest) - 7 and last_day >= (select d from latest) - 30) as gone_month,
count(*) filter (where last_day < (select d from latest) - 30) as gone_older
from ever
)
select x.what, x.day, x.morning_file_in, x.later_file_first_in, x.later_file_last_in, x.hours_morning_file_alone, x.note from (
select 1 as k, snapshot_date as sd, 'FILES' as what, to_char(snapshot_date, 'Dy DD Mon') as day,
coalesce(to_char(ini_at at time zone 'Africa/Dar_es_Salaam', 'HH24:MI'), 'none') as morning_file_in,
coalesce(to_char(cur_first at time zone 'Africa/Dar_es_Salaam', 'HH24:MI'), 'none') as later_file_first_in,
coalesce(to_char(cur_last at time zone 'Africa/Dar_es_Salaam', 'HH24:MI'), 'none') as later_file_last_in,
case when ini_at is null or cur_first is null then 'n/a' else round(extract(epoch from (cur_first - ini_at)) / 3600.0, 1)::text end as hours_morning_file_alone,
case when ini_at is null then 'no morning file that day' when cur_first is null then 'no later file that day' when cur_first < ini_at then 'the later file came BEFORE the morning file' else '' end as note
from days
union all
select 2, null, 'LISTS', to_char((select d from latest), 'Dy DD Mon'),
'on the newest later file: ' || on_file,
'left earlier, were still listed: ' || gone,
'left in the 7 days before: ' || gone_week || ', 8 to 30 days: ' || gone_month || ', longer: ' || gone_older,
case when on_file + gone > 0 then round(100.0 * gone / (on_file + gone), 1)::text else 'n/a' end,
'the last column is the share of listed customers who had already left (percent)'
from tot
) x
order by x.k, x.sd desc;
-- END OF RUN-ME-087
