-- =====================================================================================
-- THE INDEXES FOR THE TEAM-DAY TOTALS -- THE HALF THAT TAKES TIME.
--
-- RUN THE OTHER FILE FIRST: 2026-08-05-snapshot-totals.sql. That one creates the two
-- functions, is instant, and is the half that actually makes the screens cheap. This one only
-- makes them faster still.
--
-- =====================================================================================
-- READ THIS BEFORE PASTING ANYTHING
--
--   *** RUN ONE LINE AT A TIME. NOT THE WHOLE FILE. ***
--
-- Two reasons, and both of them produce a confusing failure rather than a clear one:
--
-- 1. Postgres refuses CREATE INDEX CONCURRENTLY inside a transaction, and the Supabase SQL
--    editor wraps everything you paste into one. Paste both lines together and you get
--    "CREATE INDEX CONCURRENTLY cannot run inside a transaction block", which sounds like a
--    fault in this file and is in fact a fault in how it was run.
--
-- 2. Building an index on a live table takes minutes, and the editor's connection gives up
--    first:
--        Failed to run sql query: Connection terminated due to connection timeout
--    That is what happened when these two lines were at the bottom of the other file. Because
--    the editor sends a whole script as ONE statement, the timeout rolled back the FUNCTIONS
--    as well -- so nothing at all was created, and the message named neither the statement nor
--    the table.
--
-- CONCURRENTLY is what makes this safe to do during the working day: it builds the index
-- without blocking uploads or reads. It is slower than the ordinary kind, and that is the
-- whole point -- an index build that locks the snapshot tables would stop a defaulter deck
-- going in while two hundred officers are working from it.
--
-- IF THE CONNECTION STILL TIMES OUT: the build usually carries on in the database after the
-- editor has given up, because it is the CLIENT that timed out, not Postgres. Wait a couple of
-- minutes and run the check at the bottom of this file. If it says the index is invalid, drop
-- it (also at the bottom) and try again when the system is quieter.
--
-- SAFE TO RE-RUN. `if not exists` means a second attempt on an index that is already there
-- does nothing at all.
-- =====================================================================================


-- ------------------------------------------------------------------------------------
-- LINE 1 of 2 -- run this on its own, wait for it to finish, then run line 2.
--
-- WHY IT HELPS. Both functions filter on a RANGE of snapshot_date -- a week at a time -- and
-- the existing indexes lead on snapshot_type and weekday, which is the right shape for "give
-- me one particular deck" and the wrong shape for "give me a week of them". Leading on the
-- date puts the week's rows next to each other on disk.
--
-- AND WHY IT IS ONLY A REFINEMENT. idx_repay_snap_lookup already leads on
-- (snapshot_type, snapshot_date, team), which serves the Expected reads well because they
-- always name a type -- equality on the first column, range on the second is exactly what a
-- composite index is for. The defaulter reads are the ones that gain here: the weekly report
-- and the deck ask for BOTH types at once, so they cannot use an index that leads on type.
-- ------------------------------------------------------------------------------------
create index concurrently if not exists idx_repay_snap_date_type
  on public.repayment_snapshots(snapshot_date, snapshot_type);


-- ------------------------------------------------------------------------------------
-- LINE 2 of 2 -- run this on its own, after line 1 has finished.
-- ------------------------------------------------------------------------------------
create index concurrently if not exists idx_def_snap_date_type
  on public.defaulter_snapshots(snapshot_date, snapshot_type);


-- ------------------------------------------------------------------------------------
-- DID THEY LAND? Run this whenever you want to know. It reads nothing but the catalogue.
--
-- `valid = true` means the index is built and in use. A CONCURRENTLY build that was
-- interrupted leaves an INVALID index behind -- it is not used for anything and it is not
-- doing any harm, but it will never become valid on its own. Drop it and build it again.
-- ------------------------------------------------------------------------------------
-- select c.relname as index_name, i.indisvalid as valid
-- from pg_class c
-- join pg_index i on i.indexrelid = c.oid
-- where c.relname in ('idx_repay_snap_date_type', 'idx_def_snap_date_type');

-- If either came back valid = false, drop it (one line at a time, same as above) and re-run:
-- drop index concurrently if exists idx_repay_snap_date_type;
-- drop index concurrently if exists idx_def_snap_date_type;
