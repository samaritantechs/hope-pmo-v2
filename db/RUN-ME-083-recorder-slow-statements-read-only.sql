-- RUN-ME-083: THE STATEMENTS THAT RAN LONGER THAN 3 SECONDS, MOST OFTEN FIRST -- read-only, from the recorder (RUN-ME-081). 20 Nov 2026.
-- "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner.
-- WHAT IT PRINTS (twenty rows at most, one for each statement shape the app sent): the table or function it reads or writes; how many times
-- it ran longer than 3 seconds (one row of the recorder is one run); how many of those runs were still going after 7 seconds (a statement is
-- cancelled at 8: these are the ones about to be, or just under); the longest it was seen running, in seconds; what it was usually waiting for
-- (IO = reading the disk; Lock = waiting for another statement; ClientRead = waiting for the app; running = working); the hours of the day it
-- was seen (East Africa time); and the first 260 characters of its text as Postgres holds it (the values are $1, $2: no customer name, number
-- or amount). Statements you ran yourself in the SQL editor are never recorded.
-- HOW TO READ IT: a shape with many runs past 7 seconds is a statement that is being cancelled; the same shape seen three times in a few
-- seconds is a retry. Compare with RUN-ME-082: the hours in which requests failed.
-- WHAT IT COSTS: it reads one small table of the recorder; it changes nothing.
select target,
count(*) as long_runs,
count(*) filter (where running_for > interval '7 seconds') as runs_past_7s,
round(max(extract(epoch from running_for))::numeric, 1) as longest_s,
mode() within group (order by coalesce(wait_event, 'running')) as usually_waiting_for,
to_char(min(first_seen at time zone 'Africa/Dar_es_Salaam'), 'MM-DD HH24:MI') as first_seen_eat,
to_char(max(first_seen at time zone 'Africa/Dar_es_Salaam'), 'MM-DD HH24:MI') as last_seen_eat,
left(min(query), 260) as example
from ops.db_slow_samples
group by target, md5(query)
order by long_runs desc, longest_s desc
limit 20;
-- END OF THE READ
