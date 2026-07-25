-- =====================================================================================
-- Upload-batch dedup -- run ONCE on an EXISTING database:
--   Supabase Dashboard -> SQL Editor -> paste this file -> Run.
-- Fresh installs do NOT need this; db/schema.sql already includes everything below.
--
-- Why: snapshot tables are append-only by design, but reads fetched every row for the
-- latest snapshot_date -- so re-uploading a corrected file for the same day stacked BOTH
-- copies into every KPI. Every upload now stamps one upload_batch uuid across its rows
-- (api/upload.js and migrate/run.js), and every read resolves latest date -> latest batch
-- within it (api/lib/snapshots.js).
--
-- Existing rows keep NULL and resolve as one 'legacy' batch -- no backfill needed, and a
-- stamped re-upload of the same date still supersedes them. History stays fully
-- append-only underneath.
--
-- Idempotent: safe to re-run.
-- =====================================================================================

alter table repayment_snapshots add column if not exists upload_batch uuid;
alter table defaulter_snapshots add column if not exists upload_batch uuid;

create index if not exists idx_repay_snap_batch on repayment_snapshots(snapshot_type, snapshot_date, upload_batch);
create index if not exists idx_def_snap_batch on defaulter_snapshots(snapshot_type, weekday, snapshot_date, upload_batch);
