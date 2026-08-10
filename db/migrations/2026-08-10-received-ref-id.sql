-- =====================================================================================
-- REF ID ON RECEIVED PAYMENTS.
--
-- The received-payments report carries a REF ID beside the transaction id -- the same pairing
-- the abnormal-payments report uses. It is the id that reconciles a payment against the
-- carrier's own record, which is exactly the question asked when an amount looks wrong, and
-- there was nowhere to put it.
--
-- OPTIONAL, LIKE EVERY MIGRATION HERE. Until it is run the uploader simply drops the column
-- before sending (api/upload.js probes the table first), so payments keep loading either way
-- and nothing breaks waiting for somebody to open the SQL editor.
--
-- SAFE TO RE-RUN. INSTANT.
-- =====================================================================================

alter table received_payments add column if not exists ref_id text;

-- DID IT LAND?
-- select paid_at, customer_name, amount_paid, transaction_id, ref_id
-- from received_payments order by paid_at desc limit 5;
