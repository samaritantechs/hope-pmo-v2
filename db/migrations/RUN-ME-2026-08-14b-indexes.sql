-- =====================================================================================
--  RUN ME.  The two speed indexes, in ONE paste this time.
-- =====================================================================================
--
--  WHAT HAPPENED TO THE OTHER FILE
--
--    "Error: Failed to run sql query: ERROR: 25001: CREATE INDEX CONCURRENTLY cannot
--     run inside a transaction block"
--
--  That error is the SQL EDITOR, not the database and not you. The editor wraps whatever
--  is pasted into a transaction, and CONCURRENTLY refuses to run inside one by design --
--  on this editor even a single pasted line gets wrapped, so that file cannot be run from
--  here at all.
--
--  THE TRADE THIS FILE MAKES, SAID PLAINLY. CONCURRENTLY existed to avoid locking the
--  tables during the working day. A PLAIN index build takes a lock that pauses WRITES on
--  that table -- uploads and phone sync wait; reads carry on -- and at this database's
--  size the build is SECONDS, not minutes. So:
--
--      *** RUN THIS WHEN NOBODY IS UPLOADING -- evening, or before the morning rush. ***
--
--  Paste the whole file at once. The editor's transaction is fine for everything here.
--
--  SAFE TO RE-RUN. `if not exists` means a second attempt changes nothing. And if an
--  earlier CONCURRENTLY attempt died half-way it leaves an INVALID index behind -- never
--  used, never healing on its own, and `if not exists` would walk straight past it -- so
--  this file clears any invalid leftovers first.
--
--  WHY THESE TWO AT ALL: the team-day totals functions filter on a RANGE of snapshot_date
--  (a week at a time), and the existing indexes lead on snapshot_type/weekday -- right for
--  "one particular deck", wrong for "a week of them". Leading on the date puts a week's
--  rows next to each other on disk. This is what takes defaulter_snapshot_totals out of
--  the slow-query log.
-- =====================================================================================

-- Clear any invalid leftovers from interrupted CONCURRENTLY attempts.
do $$
begin
  if exists (select 1 from pg_class c join pg_index i on i.indexrelid = c.oid
             where c.relname = 'idx_repay_snap_date_type' and not i.indisvalid) then
    execute 'drop index public.idx_repay_snap_date_type';
  end if;
  if exists (select 1 from pg_class c join pg_index i on i.indexrelid = c.oid
             where c.relname = 'idx_def_snap_date_type' and not i.indisvalid) then
    execute 'drop index public.idx_def_snap_date_type';
  end if;
end $$;

create index if not exists idx_repay_snap_date_type
  on public.repayment_snapshots(snapshot_date, snapshot_type);

create index if not exists idx_def_snap_date_type
  on public.defaulter_snapshots(snapshot_date, snapshot_type);

analyze public.repayment_snapshots;
analyze public.defaulter_snapshots;

-- ================================== DID IT LAND? =====================================
-- Both rows should say YES. (valid = the index is built and in use.)

select c.relname as index_name,
       case when i.indisvalid then 'YES' else 'NO — run this file again' end as installed
from pg_class c
join pg_index i on i.indexrelid = c.oid
where c.relname in ('idx_repay_snap_date_type', 'idx_def_snap_date_type')
order by c.relname;
