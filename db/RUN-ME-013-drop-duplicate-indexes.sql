-- =====================================================================================
-- RUN-ME-013 -- REMOVE THE DUPLICATE INDEXES WW4 CREATED.
--
-- MY MISTAKE, AND WHAT IT COST. `create index if not exists` compares the NAME, never the
-- columns. This database already had idx_rep_snap_lookup; WW4 asked for
-- idx_repay_snap_lookup over the same three columns, saw no index of THAT name, and built a
-- second copy. The planner then went on using the older one -- it has the history -- and mine
-- sat at zero scans.
--
-- A duplicate index is not harmless. It is never read, and it must still be UPDATED on every
-- single insert. Uploads here write tens of thousands of rows at a time into exactly the
-- tables this happened on, so the cost lands on the slowest, heaviest thing the system does.
-- WW4 made your uploads slower in exchange for nothing.
--
-- pg_stat_user_indexes proved it, on the live book:
--     idx_rep_snap_batch   4,939 scans     idx_repay_snap_batch     0
--     idx_rep_snap_lookup  3,234 scans     idx_repay_snap_lookup    0
--     idx_received_paid    1,456 scans     idx_received_paid_at     0
--     idx_fu_comments_made 4,648 scans     idx_fu_comments_created  0
--
-- STEP 1 finds them by DEFINITION rather than by name, so it cannot be fooled the way the
-- `if not exists` check was, and it has no blind spot for names that do not begin with idx_.
-- =====================================================================================

-- ------------------------------------------------- STEP 1: THE TRUE DUPLICATES (read-only)
-- Groups every index by the table and the exact columns it covers, ignoring its name. Any
-- group with more than one member is the same index built twice. `times_used` decides which
-- copy to keep: keep the one being used, drop the other.
--
-- Primary keys and unique constraints are excluded -- those enforce a rule, not just speed,
-- and must never be dropped even when a plain index covers the same columns.
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
         -- the definition with the index's own name stripped out: same text = same index
         regexp_replace(pg_get_indexdef(i.indexrelid), '^CREATE INDEX \S+ ', '')
having count(*) > 1
order by sum(pg_relation_size(i.indexrelid)) desc;


-- ------------------------------------------- STEP 2: WHAT EACH COPY ACTUALLY COSTS TO KEEP
-- Every index named in STEP 1, with its size. This is disk you get back, and write work every
-- upload stops doing.
select c.relname                                as index_name,
       t.relname                                as table_name,
       coalesce(s.idx_scan, 0)                  as times_used,
       pg_size_pretty(pg_relation_size(i.indexrelid)) as size
from pg_index i
join pg_class c     on c.oid = i.indexrelid
join pg_class t     on t.oid = i.indrelid
join pg_namespace n on n.oid = t.relnamespace
left join pg_stat_user_indexes s on s.indexrelid = i.indexrelid
where n.nspname = 'public'
  and c.relname in ('idx_repay_snap_lookup', 'idx_repay_snap_batch', 'idx_repay_snap_ref',
                    'idx_received_paid_at', 'idx_fu_comments_created')
order by pg_relation_size(i.indexrelid) desc;


-- ------------------------------------------------------- STEP 3: DROP THE UNUSED COPIES
-- ⚠ RUN STEP 1 FIRST AND READ IT. Only drop a name STEP 1 lists as a duplicate AND that
-- STEP 2 shows at 0 scans. If a name below does NOT appear in your STEP 1 output, leave it --
-- it is not a duplicate on your database and dropping it would cost you a real index.
--
-- Dropping an index never touches data. The worst case is a screen going back to the speed it
-- had before, and the twin that IS being used stays exactly where it is.
--
-- Armored like every WW4 dose: if a table is busy this gives up in five seconds rather than
-- queueing behind it. A "lock timeout" error means nothing happened -- run it again later.
set lock_timeout = '5s';
set statement_timeout = '2min';

drop index if exists idx_repay_snap_lookup;    -- twin of idx_rep_snap_lookup (3,234 scans)
drop index if exists idx_repay_snap_batch;     -- twin of idx_rep_snap_batch  (4,939 scans)
drop index if exists idx_repay_snap_ref;       -- twin of idx_rep_snap_ref
drop index if exists idx_received_paid_at;     -- twin of idx_received_paid   (1,456 scans)
drop index if exists idx_fu_comments_created;  -- twin of idx_fu_comments_made (4,648 scans)

-- NOT DROPPED, ON PURPOSE:
--   idx_repay_snap_date_type / idx_def_snap_date_type -- these lead on snapshot_date, which no
--     other index does. They are the pair that ended the "canceling statement due to statement
--     timeout" era. Low scan counts because they serve the weekly and monthly reads, which run
--     far less often than the daily ones -- rare is not the same as useless.
--   Anything on complaints, demand_notices, restructures, audit_log, performance_records.
--     Zero scans there means the FEATURE is quiet, not that the index is wrong; those tables
--     are small, so the indexes cost almost nothing and are there for the day somebody opens
--     the tab. Judge them again in a month, not today.


-- ------------------------------------------------------------------ STEP 4: CONFIRM
-- Re-run STEP 1. Expect no rows, or only groups you deliberately chose to keep.
-- Then the sizes, to see what came back.
select pg_size_pretty(pg_database_size(current_database())) as database_size;

-- =====================================================================================
-- THE LESSON, WRITTEN DOWN SO THE NEXT WAR DOES NOT REPEAT IT: `if not exists` protects
-- against running the same FILE twice. It does not protect against building an index this
-- database already has under a different name. Before adding an index, check what covers
-- those columns already -- STEP 1 above is that check, and it should be run BEFORE any
-- future index dose, not after.
-- =====================================================================================
