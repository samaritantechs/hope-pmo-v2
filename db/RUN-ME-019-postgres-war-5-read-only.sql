-- =====================================================================================
-- RUN-ME-019 -- POSTGRES WAR 5.   READ-ONLY, EXCEPT TWO ADDITIVE LINES AT THE END.
--
--   "go postgress war when you finish everthing but not a destructive one"
--
-- Nothing in this file drops, deletes, truncates, alters or rewrites anything. Sections 1-8
-- only READ the database's own statistics. Section 9 refreshes the planner's statistics
-- (ANALYZE -- reads the tables, writes nothing to them). Section 10 ADDS one index, and
-- only if a check in section 5 says it is needed. That is the whole of what this file can do.
--
-- RUN ONE SECTION AT A TIME: select the section's text and press Run. The editor shows only
-- the LAST statement's result of what was selected. Send me the tables from 1, 2, 3 and 5.
--
-- WHAT THE WEEK TAUGHT, so this file asks the right questions. The morning the dashboard
-- would not load, pg_stat_activity showed no lock and no old query -- 27 short aggregate
-- calls at once, the phone fleet re-asking for its strip after every upload. The indexes the
-- reads walk were already there (RUN-ME-011/013). The cost was VOLUME x REQUESTS, and the
-- request count is what the strip throttle (#353) cut. So this war measures where the
-- database actually spends its time, rather than adding indexes on a hunch.
-- =====================================================================================


-- 1. WHERE THE TIME GOES -- the twenty-five statements that cost the most, all time.
--    This is the one table that says what to fix next. `calls` x `avg_ms` is the load.
--    (pg_stat_statements is on by default on Supabase; if this errors, skip to section 2.)
select calls,
       round(total_exec_time)::bigint            as total_ms,
       round(mean_exec_time)::bigint             as avg_ms,
       round(max_exec_time)::bigint              as worst_ms,
       rows,
       round(100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0), 1) as cache_hit_pct,
       left(regexp_replace(query, '\s+', ' ', 'g'), 130) as query
from pg_stat_statements
where query not ilike '%pg_stat%'
order by total_exec_time desc
limit 25;


-- 2. THE SAME, BY AVERAGE -- the statements that are slow EACH TIME, however rarely they run.
select calls,
       round(mean_exec_time)::bigint             as avg_ms,
       round(max_exec_time)::bigint              as worst_ms,
       rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 130) as query
from pg_stat_statements
where calls >= 5 and query not ilike '%pg_stat%'
order by mean_exec_time desc
limit 15;


-- 3. CACHE HIT RATIO. Above 99% means the working set fits in memory; well below it means
--    the instance is reading from disk for ordinary questions, and a bigger instance (RAM)
--    would help more than any code change.
select sum(heap_blks_hit)                                                   as from_memory,
       sum(heap_blks_read)                                                  as from_disk,
       round(100.0 * sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2) as hit_pct
from pg_statio_user_tables;

select relname,
       heap_blks_hit, heap_blks_read,
       round(100.0 * heap_blks_hit / nullif(heap_blks_hit + heap_blks_read, 0), 1) as hit_pct
from pg_statio_user_tables
where relname in ('repayment_snapshots', 'defaulter_snapshots', 'received_payments', 'loans',
                  'followup_status', 'followup_comments', 'call_logs')
order by heap_blks_read desc;


-- 4. SEQUENTIAL SCANS vs INDEX SCANS on the hot tables. A big table with a high seq_scan count
--    is being read whole by something -- the query in section 1 that names it.
select relname,
       seq_scan, seq_tup_read,
       idx_scan, idx_tup_fetch,
       n_live_tup, n_dead_tup,
       last_autovacuum, last_autoanalyze
from pg_stat_user_tables
where relname in ('repayment_snapshots', 'defaulter_snapshots', 'received_payments', 'loans',
                  'followup_status', 'followup_comments', 'call_logs', 'snapshot_summaries', 'settings')
order by seq_tup_read desc;


-- 5. THE ONE INDEX WHOSE DEFINITION IS IN DOUBT.
--    2026-07-28-loan-identity.sql created idx_loans_approved_date as a PARTIAL index
--    (where stage = 'approved'); RUN-ME-011 later asked for a full one under the SAME NAME,
--    and `if not exists` compares names only -- so the partial one may have stayed. Every
--    sales read filters stage in (approved, pending_disb, disbursed, funded, closed), which a
--    partial index on 'approved' alone cannot serve. If the row below shows "WHERE (stage =
--    'approved')", run section 10.
select indexname, indexdef
from pg_indexes
where tablename = 'loans' and indexname like '%approved%';


-- 6. EVERY INDEX ON THE HOT TABLES, WITH HOW OFTEN IT IS USED. Report only -- an index that
--    shows 0 scans is a candidate to discuss, never something this file removes.
select t.relname                              as table_name,
       i.indexrelname                         as index_name,
       i.idx_scan                             as scans,
       pg_size_pretty(pg_relation_size(i.indexrelid)) as size
from pg_stat_user_indexes i
join pg_stat_user_tables t on t.relid = i.relid
where t.relname in ('repayment_snapshots', 'defaulter_snapshots', 'received_payments', 'loans',
                    'followup_status', 'followup_comments', 'call_logs')
order by t.relname, i.idx_scan desc;


-- 7. TIME THE THREE FUNCTIONS THE WHOLE SYSTEM LEANS ON, over this week.
--    Healthy: each well under a second when the instance is quiet. Under load these were the
--    calls past four seconds on the diagnosis card.
explain (analyze, buffers, timing)
select * from expected_snapshot_totals(
  (date_trunc('week', current_date))::date,
  (date_trunc('week', current_date) + interval '6 days')::date, 'today', null);

explain (analyze, buffers, timing)
select * from defaulter_snapshot_totals(
  (date_trunc('week', current_date))::date,
  (date_trunc('week', current_date) + interval '6 days')::date, null, null, null);

explain (analyze, buffers, timing)
select count(*) from expected_phone_window((current_date - 13)::date);


-- 8. CONNECTIONS AND SETTINGS THAT BOUND THE INSTANCE. max_connections and work_mem are what
--    a Small instance gives; if section 3 is poor and these are small, that is the ceiling.
select name, setting, unit
from pg_settings
where name in ('max_connections', 'shared_buffers', 'work_mem', 'effective_cache_size',
               'statement_timeout', 'idle_in_transaction_session_timeout', 'autovacuum_naptime');


-- 9. FRESH PLANNER STATISTICS. Reads the tables, writes nothing to them; takes seconds.
--    After a week of uploads this is the cheapest thing that can make every plan better.
analyze repayment_snapshots;
analyze defaulter_snapshots;
analyze received_payments;
analyze loans;
analyze followup_status;


-- 10. THE ONE ADDITION -- ONLY IF SECTION 5 SHOWED A PARTIAL INDEX. A full index on
--     approved_date under a NEW name, so nothing existing is touched. loans is 6 MB; this
--     takes well under a second and blocks nothing anybody will notice.
-- create index if not exists idx_loans_approved_date_all on loans(approved_date);
