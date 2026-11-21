-- RUN-ME-084: WHAT THE TABLES THE UPLOAD AND THE CALL APP WRITE CARRY -- read-only, one table of rows, no customer name, number or amount in it. 21 Nov 2026.
-- "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner.
-- WHY: the second RUN-ME-080 table (21 Nov) shows the upload's own write, the insert into defaulter_snapshots, at 1.3 seconds a statement over its
-- last 88 runs against 0.45 s on average over its whole life, and each run reads about 23 MB from the disk. Every row a deck puts in is also written
-- into EVERY index of that table, and an index whose key lands in a random place (the table's own id is a random uuid; a loan number sits among its
-- own history) costs a page read for each row on a cold cache. This lists the four tables the two paths use and every index each carries, so what an
-- index costs the write can be set against what it is used for: its size, how many times anything has read it since it was made (0 = nothing ever
-- did), how much of it is served from memory, and whether it is valid. A table's row says how much dead weight it carries (rows deleted or replaced and
-- not yet vacuumed), when it was last vacuumed, and how often it has been read whole.
-- WHAT IT PRINTS: one row for the table and one for each of its indexes, for defaulter_snapshots, repayment_snapshots, call_logs and followup_status:
-- the table, what the row is, its size, what has been asked of it, how much of it came from memory, and what it is (an index's kind and columns, and whether it
-- covers only some rows: never a value).
-- Only names, definitions and counters: never a row of any table. Counters run since the database began, or since the index was made.
-- SIZES AND COLUMNS: the catalogue's own page counts (as of the last vacuum or analyze: about) and its own lists of columns, taken WITHOUT a lock on any table
-- (the size functions, pg_get_indexdef and pg_get_expr each take one and wait behind anybody who holds a stronger one, so none of them is used).
-- WHAT IT COSTS: it reads Postgres's own statistics views and the catalogue; it changes nothing and touches no table of the book.
select tbl, kind, name, size, asked, from_memory, detail from (
select c.relname as tbl, 0 as k, 0::bigint as bytes, 'TABLE' as kind, c.relname as name,
pg_size_pretty((c.relpages + coalesce(tt.relpages, 0))::bigint * 8192) as size,
'inserts ' || st.n_tup_ins || ', updates ' || st.n_tup_upd || ', deletes ' || st.n_tup_del || ', whole-table reads ' || st.seq_scan || ' (' || st.seq_tup_read || ' rows), by index ' || coalesce(st.idx_scan, 0) as asked,
coalesce(round(100.0 * io.heap_blks_hit / nullif(io.heap_blks_hit + io.heap_blks_read, 0), 1)::text || '%', 'n/a') as from_memory,
'live about ' || st.n_live_tup || ', dead about ' || st.n_dead_tup || ' (' || coalesce(round(100.0 * st.n_dead_tup / nullif(st.n_live_tup + st.n_dead_tup, 0), 1)::text, '0') || '%), last vacuum ' || coalesce(to_char(greatest(st.last_vacuum, st.last_autovacuum), 'YYYY-MM-DD HH24:MI'), 'never') || ', last analyze ' || coalesce(to_char(greatest(st.last_analyze, st.last_autoanalyze), 'YYYY-MM-DD HH24:MI'), 'never') as detail
from pg_class c
join pg_stat_user_tables st on st.relid = c.oid
join pg_statio_user_tables io on io.relid = c.oid
left join pg_class tt on tt.oid = c.reltoastrelid
where st.schemaname = 'public' and st.relname in ('defaulter_snapshots', 'repayment_snapshots', 'call_logs', 'followup_status')
union all
select si.relname, 1, ic.relpages::bigint * 8192, 'index', si.indexrelname,
pg_size_pretty(ic.relpages::bigint * 8192),
'scans ' || si.idx_scan || ', rows read ' || si.idx_tup_read,
coalesce(round(100.0 * io.idx_blks_hit / nullif(io.idx_blks_hit + io.idx_blks_read, 0), 1)::text || '%', 'n/a'),
case when not ix.indisvalid then 'INVALID (writes pay for it, nothing reads it) ' when ix.indisprimary then 'PRIMARY KEY ' when ix.indisunique then 'UNIQUE ' else '' end
|| am.amname || ' (' || (select string_agg(coalesce(a.attname, '(expression)'), ', ' order by k.n) from unnest(ix.indkey::int2[]) with ordinality as k(attnum, n) left join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = k.attnum) || ')'
|| case when ix.indpred is not null then ' partial (only some rows)' else '' end
from pg_stat_user_indexes si
join pg_statio_user_indexes io on io.indexrelid = si.indexrelid
join pg_index ix on ix.indexrelid = si.indexrelid
join pg_class ic on ic.oid = si.indexrelid
join pg_am am on am.oid = ic.relam
where si.schemaname = 'public' and si.relname in ('defaulter_snapshots', 'repayment_snapshots', 'call_logs', 'followup_status')
) x
order by tbl, k, bytes desc, name;
-- END OF THE READ
