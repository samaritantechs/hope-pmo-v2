-- RUN-ME-079: HOW THE DATABASE IS DOING -- read-only, one small table, no customer name, number or amount in it. 20 Nov 2026.
-- "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner.
-- WHY: pg_stat_statements lists only the statements that FINISHED. A statement cancelled at the role's limit is in none of its figures,
-- and the two Logs Explorer queries handed over to name those statements went into the SQL editor three times: they only exist in
-- Supabase's Logs Explorer. This is the part of the picture the SQL editor CAN show, from Postgres's own counters.
-- WHAT IT PRINTS (about 25 rows, two columns): the database size and the memory settings (shared_buffers is about a quarter of the
-- compute's RAM); the connections now; how many transactions committed and how many were rolled back (a request that fails is rolled back,
-- so this is the failed-request count: compare two runs); the cache hit percent (well below 99 = the database is reading the disk because
-- its memory is too small: the lever is then the compute size, the owner's decision, not a code change); temp files (statements that spilled
-- to disk) and deadlocks; the limits each API role carries (the statement timeout that applies); and the eight biggest tables with how much
-- of each is served from memory. Only table names and counters: never a row of any table.
-- HOW TO USE: run it now, and again in an hour or the next time you look. The difference between two runs is what happened in between.
-- WHAT IT COSTS: it reads Postgres's own counters and the catalogue; it changes nothing and touches no table of the book.
with d as (
select * from pg_stat_database where datname = current_database()
), t as (
select relname, pg_total_relation_size(relid) as bytes, heap_blks_read, heap_blks_hit, idx_blks_read, idx_blks_hit
from pg_statio_user_tables
where schemaname = 'public'
order by pg_total_relation_size(relid) desc
limit 8
)
select what, value from (
select 1 as ord, 'now' as what, now()::text as value
union all select 2, 'counting since', coalesce(d.stats_reset::text, 'n/a') from d
union all select 3, 'database size', pg_size_pretty(pg_database_size(current_database()))
union all select 4, 'shared_buffers (about a quarter of the compute RAM)', current_setting('shared_buffers')
union all select 5, 'effective_cache_size', current_setting('effective_cache_size')
union all select 6, 'max_connections', current_setting('max_connections')
union all select 7, 'connections open now', count(*)::text from pg_stat_activity where datname = current_database()
union all select 8, 'statements running now (not this one)', count(*)::text from pg_stat_activity where datname = current_database() and state = 'active' and pid <> pg_backend_pid()
union all select 9, 'transactions committed', d.xact_commit::text from d
union all select 10, 'transactions rolled back (failed requests, mostly)', d.xact_rollback::text from d
union all select 11, 'rolled back, percent of all', round(100.0 * d.xact_rollback / nullif(d.xact_commit + d.xact_rollback, 0), 3)::text from d
union all select 12, 'cache hit percent, whole database (well below 99 = reading the disk)', round(100.0 * d.blks_hit / nullif(d.blks_hit + d.blks_read, 0), 2)::text from d
union all select 13, 'temp files written (statements that spilled to disk)', d.temp_files::text || ', ' || pg_size_pretty(d.temp_bytes) from d
union all select 14, 'deadlocks', d.deadlocks::text from d
union all select 20 + row_number() over (order by r.rolname), 'role ' || r.rolname || ' limits', coalesce(array_to_string(r.rolconfig, ', '), 'none') from pg_roles r where r.rolname in ('authenticator', 'anon', 'authenticated', 'service_role', 'postgres')
union all select 40 + row_number() over (order by t.bytes desc), 'table ' || t.relname, pg_size_pretty(t.bytes) || ' | table pages from cache ' || coalesce(round(100.0 * t.heap_blks_hit / nullif(t.heap_blks_hit + t.heap_blks_read, 0), 1)::text || '%', 'n/a') || ' | index pages from cache ' || coalesce(round(100.0 * t.idx_blks_hit / nullif(t.idx_blks_hit + t.idx_blks_read, 0), 1)::text || '%', 'n/a') from t
) x
order by ord;
-- END OF THE READ
