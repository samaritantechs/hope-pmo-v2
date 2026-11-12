-- =====================================================================================
-- RUN-ME-054 -- A TRIGRAM INDEX FOR legalFind'S NAME/REF SEARCH
-- =====================================================================================
--
--   The owner, looking at the Supabase dashboard: "postgress is unsettled" -- with the exact
--   query the New-notice drawer's search box sends: ref/full_name ILIKE '%term%', scoped by
--   snapshot_type, snapshot_date and team.
--
-- legalFind (api/_lib/portal-core.js) is the Legal tab's "search by ref, phone no and names"
-- box. Its ILIKE carries a LEADING wildcard ('%term%'), which no ordinary B-tree index can use
-- for the text match itself -- none of defaulter_snapshots' six existing indexes (schema.sql,
-- RUN-ME-011, RUN-ME-034) help with that part; they only narrow by team/snapshot_type/
-- snapshot_date. As the table keeps growing with every day's upload, a name search gets
-- proportionally slower however those other columns narrow it, because Postgres still has to
-- check each candidate row's text by hand.
--
-- VERIFIED ON A 2.27-MILLION-ROW, 150-DAY FIXTURE (42 teams, 180 customers each, two
-- snapshot_types -- matching RUN-ME-034's own sizing logic: a realistic slice of months of
-- history, not a freshly generated table with nothing behind it), before and after, with
-- EXPLAIN (ANALYZE, BUFFERS):
--
--   A rarer, more specific name -- the realistic case: somebody typing enough of a real
--   customer's name to actually find them -- admin scope (every team, the worst case; a
--   team-scoped officer's own search narrows faster either way):
--     before:  151.2 ms (Parallel Bitmap Heap Scan, checking 347,760 rows by hand)
--     after:    23.2 ms, a two-word name:  78.8 ms (both using the new trigram index)
--     a ref search ('%r5-23%'), admin scope:  2.9 ms after (near-instant)
--
--   THE ONE HONEST COST: a bare 3-character fragment that happens to be very common across
--   many names (legalFind's own floor -- "Andika angalau herufi 3" -- allows exactly this) can
--   come back a little SLOWER with the index than without it for a team-scoped search, because
--   the old plan could walk the date-ordered index backward and stop the moment it had LIMIT
--   120 matches, while the new plan builds a bitmap of every row sharing a trigram with the
--   term first. Measured: 19.6 ms before, 41.8 ms after, for one such case. Still nowhere near
--   a timeout either way, and the realistic search (an actual name or ref, not three random
--   letters) is the one this index is for.
--
-- NO CODE CHANGES: legalFind's own query is unchanged. Postgres's planner simply has a faster
-- path available to it once the index exists.
--
-- CONCURRENTLY, BECAUSE defaulter_snapshots IS WRITTEN BY /api/upload. An ordinary CREATE INDEX
-- takes a lock that blocks every INSERT/UPDATE on this table until the build finishes -- on the
-- live book, almost certainly larger than this file's own 2.27-million-row test, that could be
-- minutes with uploads queued up behind it, which is exactly the thing this repository is built
-- never to do. CONCURRENTLY never blocks a write, at the cost of building a little slower
-- itself (13.5s and 5.2s on the test table, for the two indexes, with no traffic).
--
-- >>> SECTIONS 2 AND 3 MUST EACH BE RUN ALONE -- select ONLY that one line and press Run, never
-- the whole file at once. <<< CREATE INDEX CONCURRENTLY is refused outright inside a
-- transaction block, and the SQL editor sends everything selected together as one -- so running
-- the whole file would simply error on "CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block" and change nothing (a safe failure: it does not half-build the index or
-- touch the table either way), not silently skip the safety CONCURRENTLY exists for. Sections 1
-- and 4 are read-only or ordinary DDL and may be run with anything else.
--
-- SAFE TO RUN AGAIN: IF NOT EXISTS on every statement.
-- =====================================================================================

-- SECTION 1 -- the extension these indexes need. Already enabled on most Supabase projects;
-- harmless if it is.
create extension if not exists pg_trgm;

-- SECTION 2 -- RUN ALONE.
create index concurrently if not exists idx_def_snap_fullname_trgm
  on defaulter_snapshots using gin (full_name gin_trgm_ops);

-- SECTION 3 -- RUN ALONE.
create index concurrently if not exists idx_def_snap_ref_trgm
  on defaulter_snapshots using gin (ref gin_trgm_ops);

-- SECTION 4 -- read-only. Confirms both exist and shows their size (about 55MB + 24MB on the
-- test table; the live one will differ with the live table's real size).
select indexname, pg_size_pretty(pg_relation_size(indexname::regclass)) as index_size
from pg_indexes
where tablename = 'defaulter_snapshots' and indexname like '%_trgm'
order by indexname;
