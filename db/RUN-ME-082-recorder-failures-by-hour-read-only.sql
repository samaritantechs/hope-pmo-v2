-- RUN-ME-082: FAILED REQUESTS, TEMP SPILL AND HOW BUSY, HOUR BY HOUR (East Africa time) -- read-only, from the recorder (RUN-ME-081). 20 Nov 2026.
-- "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner.
-- WHAT IT PRINTS (one row for each hour, newest first, 72 at most): the transactions committed and rolled back in that hour (a request that
-- fails is rolled back), the rolled-back percent, the temp files and bytes written (statements that sorted or hashed more than their working
-- memory), the most connections open and the most statements running at once, and how many of the hour's minutes were recorded (60 is all).
-- No customer name, number or amount: only counters.
-- HOW TO READ IT: compare the hours of a working day with the hours of the night. A hour in which the rolled-back percent jumps is an hour in
-- which requests failed; RUN-ME-083 says which statements ran long in it.
-- WHAT IT COSTS: it reads one small table of the recorder; it changes nothing.
with s as (
select at,
greatest(xact_commit - lag(xact_commit) over w, 0) as committed,
greatest(xact_rollback - lag(xact_rollback) over w, 0) as rolled_back,
greatest(temp_bytes - lag(temp_bytes) over w, 0) as temp_bytes,
greatest(temp_files - lag(temp_files) over w, 0) as temp_files,
connections, active_statements
from ops.db_health_samples
window w as (order by at)
)
select to_char(date_trunc('hour', at at time zone 'Africa/Dar_es_Salaam'), 'MM-DD HH24:00') as hour_eat,
sum(committed) as committed, sum(rolled_back) as rolled_back,
round(100.0 * sum(rolled_back) / nullif(sum(committed) + sum(rolled_back), 0), 3) as rolled_back_pct,
pg_size_pretty(sum(temp_bytes)::bigint) as temp_written, sum(temp_files) as temp_files,
max(connections) as most_connections, max(active_statements) as most_running_at_once,
count(*) as minutes_recorded
from s
where committed is not null
group by date_trunc('hour', at at time zone 'Africa/Dar_es_Salaam')
order by date_trunc('hour', at at time zone 'Africa/Dar_es_Salaam') desc
limit 72;
-- END OF THE READ
