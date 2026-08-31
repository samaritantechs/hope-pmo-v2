-- =====================================================================================
-- RUN-ME-016 -- THE INTEGRATION-DAY HEALTH CHECK. READ-ONLY: nothing here changes a row,
-- an index, or a setting. Paste the whole file; read the result of each numbered section
-- against the EXPECT note beside it. Anything that does not match its EXPECT is the thing
-- to fix BEFORE the demo, and the earlier RUN-ME that fixes it is named in place.
-- =====================================================================================

-- ---------------------------------------------------------------- 1. THE INSTALLED PIECES
-- EXPECT: every row says 'INSTALLED'. A 'MISSING' names the RUN-ME to paste.
select 'pmo_adjustments table (RUN-ME-015)' as piece,
       case when to_regclass('public.pmo_adjustments') is null then 'MISSING' else 'INSTALLED' end as status
union all
select 'call_report_rollup fn (RUN-ME-014)',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = 'call_report_rollup')
            then 'INSTALLED' else 'MISSING' end
union all
select 'expected_snapshot_totals fn (RUN-ME-012 DOSE 1)',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = 'expected_snapshot_totals')
            then 'INSTALLED' else 'MISSING' end
union all
select 'defaulter_snapshot_totals fn (RUN-ME-012 DOSE 1)',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = 'defaulter_snapshot_totals')
            then 'INSTALLED' else 'MISSING' end;

-- ------------------------------------------------------------------- 2. THE TUNDURU CHECK
-- EXPECT: zero rows. Any row means the merge (RUN-ME-2026-08-18-merge-tunduru.sql) has not
-- landed, or something re-created a variant since -- run the merge again; it is safe to re-run.
select 'teams' as place, team as value from teams where upper(trim(team)) = 'TUNDURU' and team <> 'Tunduru'
union all select 'access_codes array', code from access_codes
  where teams is not null and exists (select 1 from unnest(teams) x where upper(trim(x)) = 'TUNDURU' and x <> 'Tunduru')
union all select 'leader_teams array', user_id from call_users
  where leader_teams is not null and exists (select 1 from unnest(leader_teams) x where upper(trim(x)) = 'TUNDURU' and x <> 'Tunduru')
limit 20;

-- -------------------------------------------------------------- 3. DUPLICATE INDEXES LEFT
-- The definition-based finder from RUN-ME-013 STEP 1: same table, same columns, two names.
-- EXPECT: zero rows once RUN-ME-013 STEP 3 has been run. Rows here are write-work every
-- upload pays for nothing -- run RUN-ME-013 (STEP 1 first, read it, then STEP 3).
select t.relname                                             as table_name,
       count(*)                                              as copies,
       string_agg(c.relname || '  (used ' || coalesce(s.idx_scan, 0)::text || ')',
                  '   |   ' order by coalesce(s.idx_scan, 0) desc)  as keep_the_busiest,
       pg_size_pretty(sum(pg_relation_size(i.indexrelid)))   as disk_for_all_copies
from pg_index i
join pg_class c      on c.oid = i.indexrelid
join pg_class t      on t.oid = i.indrelid
join pg_namespace n  on n.oid = t.relnamespace
left join pg_stat_user_indexes s on s.indexrelid = i.indexrelid
where n.nspname = 'public'
  and not i.indisprimary
  and not i.indisunique
group by t.relname,
         regexp_replace(pg_get_indexdef(i.indexrelid), '^CREATE INDEX \S+ ', '')
having count(*) > 1
order by sum(pg_relation_size(i.indexrelid)) desc;

-- ------------------------------------------------------- 4. SEQ-SCAN PRESSURE ON BIG TABLES
-- Whether the planner is actually USING the indexes on the tables that matter.
-- EXPECT: on the snapshot tables and followup tables, idx_scan should dwarf seq_scan.
-- A big table with seq_scan climbing and idx_scan near zero is a query shape without an
-- index -- note which table and say so, with this output.
select relname as table_name,
       seq_scan, idx_scan,
       n_live_tup as live_rows,
       pg_size_pretty(pg_total_relation_size(relid)) as total_size
from pg_stat_user_tables
where schemaname = 'public'
order by pg_total_relation_size(relid) desc
limit 15;

-- --------------------------------------------------------------- 5. DEAD ROWS AND VACUUM
-- EXPECT: n_dead_tup well below n_live_tup on every big table, and last_autovacuum within
-- the last day or two on the tables that take daily uploads. A table with dead rows rivaling
-- live ones bloats reads; Supabase autovacuum usually handles it -- surfacing it here is
-- so a stall is seen TODAY, not discovered as slowness next week.
select relname as table_name, n_live_tup, n_dead_tup,
       greatest(last_autovacuum, last_vacuum) as last_vacuumed
from pg_stat_user_tables
where schemaname = 'public' and n_live_tup + n_dead_tup > 10000
order by n_dead_tup desc
limit 15;

-- ------------------------------------------------------------------- 6. CACHE HIT RATIO
-- EXPECT: heap_hit_pct at 99%+ . Meaning: reads are answered from memory. A number in the
-- low 90s or below means the working set has outgrown memory and the biggest tables in
-- section 4 are why -- old snapshot dates are the usual culprit (Settings has the cleaner).
select round(100.0 * sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2)
         as heap_hit_pct
from pg_statio_user_tables;

-- ---------------------------------------------------------- 7. WHAT IS RUNNING RIGHT NOW
-- EXPECT: nothing older than a minute or two besides this query itself. A row minutes old
-- holding 'active' is the query to investigate (its text is right there); one stuck in
-- 'idle in transaction' is a client holding locks open -- the WW4 pattern was to terminate
-- it by pid, but LOOK first.
select pid, state,
       now() - query_start as running_for,
       left(query, 90) as query_start_of
from pg_stat_activity
where datname = current_database()
  and state <> 'idle'
  and pid <> pg_backend_pid()
order by query_start
limit 10;

-- ------------------------------------------------------------------ 8. DATABASE SIZE
-- EXPECT: comfortably inside the plan (Free 500 MB, Pro 8 GB). The Settings screen shows
-- the same figure with the per-day growth beside it.
select pg_size_pretty(pg_database_size(current_database())) as database_size;
