-- =====================================================================================
-- THE UPLOAD STAMP -- "which report is this row part of", for the tables that accumulate.
--
-- The snapshot tables already answer this: every Expected and Defaulters upload carries a
-- snapshot_date and a batch, so re-uploading a date supersedes it. The accumulating tables --
-- loan applications, received payments, the registers -- had no such handle. Their rows only
-- carried the DATES INSIDE the file, and those are not the same thing at all: a loan
-- applications report pulled on 27 July legitimately contains applications dated in June.
--
-- What matters operationally is WHICH REPORT a row arrived in, so that a report pulled on the
-- wrong day, or pulled short, can be replaced wholesale without touching any other day's.
--
--   upload_date   the day the report is FOR, chosen by the person uploading (not the file's
--                 own dates, and not necessarily today -- yesterday's report can be re-done)
--   upload_batch  one uuid per upload, so a single upload can be identified exactly
--
-- Existing rows are backfilled from when they were written, which is the best available
-- answer for data that arrived before anyone was asked.
--
-- SAFE TO RE-RUN.
-- =====================================================================================

do $$
declare t text;
begin
  foreach t in array ARRAY['loans', 'received_payments', 'abnormal_payments', 'complaints',
                           'restructures', 'demand_notices', 'followup_comments']
  loop
    execute format('alter table %I add column if not exists upload_date date', t);
    execute format('alter table %I add column if not exists upload_batch uuid', t);
    -- Best available answer for rows that predate the stamp: the day they were written.
    execute format('update %I set upload_date = created_at::date where upload_date is null', t);
    execute format('create index if not exists idx_%s_upload_date on %I(upload_date)', t, t);
  end loop;
end $$;
