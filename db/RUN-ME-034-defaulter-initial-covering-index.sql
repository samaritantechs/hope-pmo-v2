-- =====================================================================================
-- RUN-ME-034 -- A COVERING INDEX FOR THE INITIAL SIDE OF recovery_standing
-- =====================================================================================
--
--   "canceling statement due to statement timeout" / "dashboard is taking a century to load"
--
-- v6 (RUN-ME-032) fixed the SHAPE of the query -- rank each customer's rows once, over the
-- union of every period's lookback, instead of once per period -- and it worked: the same
-- 7-period trend call that spilled 818MB to disk and took 27.9 seconds under v5 came back in
-- 9.99 seconds after v6 went in. Still too slow. The follow-up EXPLAIN said why:
--
--     Buffers: shared hit=17996 read=69267
--
-- Eighty percent of the pages this query touched were NOT in cache -- real, uncached disk
-- reads. The columns it needs (ref, team, arrears, created_at, upload_batch) are not narrow;
-- they just are not IN the index it used (idx_def_snap_date_type, which only carries
-- snapshot_date and snapshot_type). So for every row in the union window, Postgres had to leave
-- the index and fetch the actual table row to read them -- a scattered disk read per row, on a
-- table whose physical order has nothing to do with snapshot_date any more after months of
-- interleaved daily uploads across forty-plus teams landing wherever there was free space.
--
-- THE FIX IS NOT A FASTER QUERY -- v6 already IS that. It is giving the query everything it
-- needs WITHOUT leaving the index: a partial index, scoped to snapshot_type = 'initial' (the
-- side this cost lives on), carrying every column ini_ranked reads as an INCLUDE. Verified
-- against a 2.4-million-row, 200-day fixture built to match the real book's shape (a 45-day
-- lookback is a SMALL slice of a table with months of history, not most of it, the way a
-- freshly generated test table would be): with this index, and RUN-ME-032's two companion
-- planner hints, the same scan drops to
--
--     Index Only Scan using idx_def_snap_initial_covering ... Heap Fetches: 0
--     Buffers: shared hit=102 read=4944
--
-- -- about a fourteenth of the disk reads the un-indexed scan needed, and it costs the planner
-- nothing to reach for even at low selectivity, because it never has to guess: RUN-ME-032 turns
-- the other two paths off for this function specifically. See that file's own note.
--
-- WHY THIS COLUMN SET, EXACTLY: ref, team, arrears, created_at, upload_batch is everything
-- ini_ranked in recovery_standing reads. (defaulterInitialRows, RUN-ME-033, returns every
-- column of defaulter_snapshots for its winning rows and so cannot be served by an index-only
-- scan regardless of what this index carries -- it is a different, already-narrower cost, and
-- not the one that was timing out.)
--
-- THE COST, STATED PLAINLY: every INITIAL-type row a deck upload writes now updates one more
-- index -- a few extra microseconds per row, on the write side, alongside the five indexes this
-- table already carries. That is the trade this file makes, on purpose, to stop the read side
-- timing out.
--
-- *** RUN THIS IN THE EVENING, OR BEFORE THE MORNING COLLECTION ROUND -- NOT DURING IT. ***
-- A plain `create index` (not CONCURRENTLY -- see the note below) takes a brief lock that pauses
-- WRITES to defaulter_snapshots while it builds; reads carry on.
--
-- WHY NOT CREATE INDEX CONCURRENTLY: the Supabase SQL editor wraps every paste in a
-- transaction, and CONCURRENTLY refuses to run inside one -- "cannot run inside a transaction
-- block" -- no matter how carefully this is pasted. RUN-ME-2026-08-14b hit the same wall and
-- made the same trade; see its own note for the full story.
--
-- RUN THIS FILE AND RUN-ME-032'S UPDATE TOGETHER -- order between them does not matter, but
-- the fix is not complete until both are in: this index without RUN-ME-032's planner hints
-- still leaves the choice to the planner's cost estimate, which is what missed it the first
-- time.
--
-- Paste the whole file at once. SAFE TO RE-RUN -- `if not exists` means a second attempt
-- changes nothing, and this clears any INVALID leftover from an interrupted attempt first.
-- =====================================================================================

-- Clear any invalid leftover from an earlier interrupted attempt.
do $$
begin
  if exists (select 1 from pg_class c join pg_index i on i.indexrelid = c.oid
             where c.relname = 'idx_def_snap_initial_covering' and not i.indisvalid) then
    execute 'drop index public.idx_def_snap_initial_covering';
  end if;
end $$;

create index if not exists idx_def_snap_initial_covering
  on public.defaulter_snapshots(snapshot_date)
  include (ref, team, arrears, created_at, upload_batch)
  where snapshot_type = 'initial';

analyze public.defaulter_snapshots;

-- ================================== DID IT LAND? =====================================
select c.relname as index_name,
       case when i.indisvalid then 'YES' else 'NO -- run this file again' end as installed
from pg_class c
join pg_index i on i.indexrelid = c.oid
where c.relname = 'idx_def_snap_initial_covering';
