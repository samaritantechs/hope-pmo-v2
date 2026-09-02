-- =====================================================================================
-- RUN-ME-018 -- WHAT IS SLOW RIGHT NOW.   READ-ONLY.   Run while the dashboard is failing.
--
--   "dashboard [Imeshindikana / Could not load. Seva haijibu ndani ya sekunde 45]"
--   "Uchunguzi nao haukujibu / the diagnosis itself did not answer"
--
-- When even the diagnosis cannot answer, nearly every read is past its cap, and that is not
-- one bad query -- it is the database itself being slow or BLOCKED. This file asks Postgres
-- directly. Run each section in the Supabase SQL editor and send the output. Nothing here
-- changes anything; the one section that would (cancelling a query) is commented out and is
-- yours to decide on.
--
-- Sections 1-3 are the ones that matter on a bad morning. Start there.
-- =====================================================================================


-- 1. WHAT IS RUNNING RIGHT NOW, OLDEST FIRST.
--    A query older than a few seconds is the suspect; a query older than a minute is the
--    answer. `wait_event` says what it is waiting on (a lock, IO, a client).
select pid,
       now() - query_start                 as age,
       state,
       wait_event_type,
       wait_event,
       usename,
       application_name,
       left(regexp_replace(query, '\s+', ' ', 'g'), 160) as query
from pg_stat_activity
where state <> 'idle'
  and pid <> pg_backend_pid()
order by query_start nulls last
limit 40;


-- 2. WHO IS BLOCKING WHOM.
--    An upload that holds a lock while it inserts 9,000 rows blocks every read that needs
--    the same table. If this returns rows, the blocking pid in the left column is the one.
select blocking.pid                                   as blocking_pid,
       now() - blocking.query_start                   as blocking_age,
       left(regexp_replace(blocking.query, '\s+', ' ', 'g'), 120) as blocking_query,
       blocked.pid                                    as blocked_pid,
       now() - blocked.query_start                    as blocked_age,
       left(regexp_replace(blocked.query, '\s+', ' ', 'g'), 120)  as blocked_query
from pg_stat_activity blocked
join lateral unnest(pg_blocking_pids(blocked.pid)) as b(pid) on true
join pg_stat_activity blocking on blocking.pid = b.pid
order by blocking.query_start;


-- 3. CONNECTIONS, BY STATE.
--    A Small instance has a modest connection ceiling. Many "idle in transaction" rows mean
--    something opened a transaction and walked away; many "active" rows mean a pile-up.
select state, wait_event_type, count(*)
from pg_stat_activity
where pid <> pg_backend_pid()
group by 1, 2
order by 3 desc;


-- 4. VACUUM / ANALYZE, IN PROGRESS AND LAST DONE, ON THE HOT TABLES.
--    An autovacuum on repayment_snapshots during the morning uploads is normal and slow;
--    a table that has NEVER been analysed after a big upload gives the planner bad numbers.
select relname,
       n_live_tup, n_dead_tup,
       last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
from pg_stat_user_tables
where relname in ('repayment_snapshots', 'defaulter_snapshots', 'received_payments', 'loans',
                  'followup_status', 'followup_comments', 'call_logs', 'settings', 'snapshot_summaries')
order by n_dead_tup desc;

select pid, now() - query_start as age, phase, heap_blks_scanned, heap_blks_total
from pg_stat_progress_vacuum;


-- 5. THE INDEXES THE DASHBOARD'S READS DEPEND ON.
--    Every read below should find an index on the column it filters by. A missing one is a
--    full scan of the table on every dashboard load.
select tablename, indexname, indexdef
from pg_indexes
where tablename in ('repayment_snapshots', 'defaulter_snapshots', 'received_payments', 'loans', 'abnormal_payments')
order by tablename, indexname;


-- 6. TIME THE DASHBOARD'S OWN WEEK AGGREGATE.
--    This is the read the dashboard makes first. On a healthy instance it answers in well
--    under a second. If THIS is slow while section 1 shows nothing old, the instance is
--    starved (CPU / IO), not blocked.
explain (analyze, buffers, timing)
select * from expected_snapshot_totals(
  (date_trunc('week', current_date))::date,
  (date_trunc('week', current_date) + interval '6 days')::date,
  'today', null);

explain (analyze, buffers, timing)
select * from defaulter_snapshot_totals(
  (date_trunc('week', current_date))::date,
  (date_trunc('week', current_date) + interval '6 days')::date,
  null, null, null);


-- 7. THE TWO WINDOWED TABLE READS THE DASHBOARD MAKES.
explain (analyze, buffers, timing)
select team, amount_paid, transaction_id
from received_payments
where paid_at >= current_date - 14 and paid_at <= current_date;

explain (analyze, buffers, timing)
select id, stage, team, created_at, upload_date, approved_date
from loans
where created_at   >= (date_trunc('month', current_date))::date
   or approved_date >= (date_trunc('month', current_date))::date
   or upload_date   >= (date_trunc('month', current_date))::date;


-- 8. SIZES, so a table that has quietly doubled is visible.
select relname,
       pg_size_pretty(pg_total_relation_size(relid)) as total,
       pg_size_pretty(pg_relation_size(relid))       as table_only
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 12;


-- 9. IF SECTION 1 OR 2 SHOWS A QUERY THAT HAS BEEN RUNNING FOR MINUTES -- and you have
--    decided it should stop -- cancel it by pid. pg_cancel_backend asks it politely;
--    pg_terminate_backend ends the connection. Uncomment ONE line and put the pid in.
-- select pg_cancel_backend(12345);
-- select pg_terminate_backend(12345);
