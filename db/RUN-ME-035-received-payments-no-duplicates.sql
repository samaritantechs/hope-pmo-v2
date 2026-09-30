-- =====================================================================================
-- RUN-ME-035 -- RECEIVED PAYMENTS: ONE ROW PER PAYMENT, AND THE DATABASE KEEPS IT SO.
--
--   "i randomly upload received payments, so sometimes they are duplicate we shouldnt store
--    duplicates"
--
-- From this build the uploader keys every payment on its OWN identity (api/_lib/importers.js
-- paymentIdentity): the carrier's TRANSACTION ID where the sheet has one, otherwise the date,
-- the customer's ref, the amount, the paying phone and the sender together. That identity IS
-- the row's primary key, and the write is ON CONFLICT DO NOTHING -- so a payment uploaded
-- twice is stored once, by the database, whoever uploads it and however many times.
--
-- WHAT THIS FILE DOES, for the rows stored BEFORE that existed (their ids are random):
--   1. deletes the duplicates already in the book, keeping the EARLIEST stored copy of each;
--   2. re-keys every row to md5(identity)::uuid -- the identical value the uploader computes --
--      so the next upload of a sheet already in the book is recognised row by row.
--
-- WITHOUT IT nothing breaks: new uploads stop duplicating each other from today. Only the
-- copies already stored, and duplicates of rows stored before today, need this.
--
-- SAFE TO RE-RUN (a second run finds nothing to delete and nothing to re-key).
-- ~56,000 rows (RUN-ME-028 keeps the book to a fortnight): seconds. The SQL editor sends the
-- whole file as ONE statement, so a timeout anywhere rolls back all of it -- run it whole.
-- =====================================================================================
set statement_timeout = '120s';

-- THE ONE DEFINITION OF A PAYMENT'S IDENTITY IN SQL. Mirrors paymentIdentity() exactly:
--   upper(trim(x))            <->  String(x).trim().toUpperCase()
--   amount with no trailing   <->  String(Number(amount) || 0)   ("5000.00" and 5000 are one)
--   zeros or point
--   concat_ws('|', ...)       <->  [...].join('|')   (every part coalesced to '' first, so a
--                                                     NULL does not shorten the list)
create or replace function received_payment_identity(
  p_transaction_id text, p_paid_at date, p_ref_no text, p_amount numeric,
  p_payment_no text, p_sender_name text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(upper(trim(p_transaction_id)), ''),
    concat_ws('|',
      coalesce(p_paid_at::text, ''),
      upper(coalesce(trim(p_ref_no), '')),
      rtrim(rtrim(coalesce(p_amount, 0)::text, '0'), '.'),
      upper(coalesce(trim(p_payment_no), '')),
      upper(coalesce(trim(p_sender_name), ''))))
$$;

-- 1. THE DUPLICATES ALREADY STORED. The earliest copy of each payment stays; every later copy
--    of the same identity goes. This is the step that puts the money figures right.
with keyed as (
  select id,
         row_number() over (
           partition by received_payment_identity(transaction_id, paid_at, ref_no, amount_paid, payment_no, sender_name)
           order by created_at, id) as rn
  from received_payments
)
delete from received_payments r
using keyed k
where r.id = k.id and k.rn > 1;

-- 2. RE-KEY what is left to the identity the uploader computes, so tomorrow's upload of a
--    sheet already in the book is refused row by row instead of merely not doubling itself.
--    Identities are unique after step 1, so no two rows can want the same id.
update received_payments
set id = md5(received_payment_identity(transaction_id, paid_at, ref_no, amount_paid, payment_no, sender_name))::uuid
where id <> md5(received_payment_identity(transaction_id, paid_at, ref_no, amount_paid, payment_no, sender_name))::uuid;

-- DID IT LAND? Both should be 0 -- no identity held twice, no row off its key.
-- select count(*) - count(distinct received_payment_identity(transaction_id, paid_at, ref_no, amount_paid, payment_no, sender_name)) as duplicates_left,
--        count(*) filter (where id <> md5(received_payment_identity(transaction_id, paid_at, ref_no, amount_paid, payment_no, sender_name))::uuid) as rows_off_key
-- from received_payments;
