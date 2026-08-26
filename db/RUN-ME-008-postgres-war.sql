-- =====================================================================================
-- RUN-ME-008 -- the Postgres war: indexes for the reads that still walk whole tables.
-- Paste into the Supabase SQL editor and run. Safe to re-run (IF NOT EXISTS throughout).
--
-- Every one of these turns a sequential scan of a growing table into a keyed lookup.
-- The tables below only ever grow (uploads append; nothing overwrites), so these reads
-- get slower every single day until they are indexed -- the same slope that once turned
-- the database red under the phones' sync traffic.
-- =====================================================================================

-- 1) RECEIVED PAYMENTS BY DATE. The money table is read by paid_at range on every
--    dashboard weekly strip, the Received Payments export, the abnormal-payments screen
--    and the upload duplicate check -- and its only index was ref_no. Every one of those
--    was a full scan of every payment ever recorded.
create index if not exists idx_received_paid_at
  on received_payments (paid_at);

-- 2) COMPLAINTS BY CUSTOMER. The calls app reads a customer's complaints EVERY time an
--    officer opens a customer card -- the officer must see an open complaint before
--    dialling -- and the portal's follow-up screens read them by ref too. With no index
--    on ref, the hottest tap in the field app paid a full scan of the complaints table.
create index if not exists idx_complaints_ref
  on complaints (ref, created_at desc);

-- 3) REPLACEMENT NUMBERS. The phone index that classifies synced calls rebuilds by
--    asking followup_comments for the few hundred rows carrying a new_number -- out of
--    every comment ever written, hundreds of thousands after the v1 import. The partial
--    index holds ONLY the rows with a number, so the rebuild stops leafing through the
--    whole comment history. The predicate matches the query's own filters exactly
--    (is not null AND <> ''), which is what lets the planner use it.
create index if not exists idx_fu_comments_new_number
  on followup_comments (new_number)
  where new_number is not null and new_number <> '';

-- Fresh statistics so the planner starts using the new indexes immediately rather than
-- after the next autovacuum pass.
analyze received_payments;
analyze complaints;
analyze followup_comments;
