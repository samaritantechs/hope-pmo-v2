-- =====================================================================================
-- RUN-ME-036 -- ABNORMAL PAYMENTS: ONE ROW PER PAYMENT, AND TWO WEEKS OF THEM.
--
--   "The abnormal table too.. and it contains duplicates too"
--
-- The same two rules RUN-ME-028 and RUN-ME-035 gave the received-payments book, on the sheet
-- of irregular payments (abnormal_payments):
--
--   1. ONE ROW PER PAYMENT. From this build the uploader keys every abnormal row on its own
--      identity (api/_lib/importers.js abnormalIdentity): the carrier's TRANSACTION ID, else
--      its REF ID, else the customer's ref, the amount, the paying phone and the sender
--      together. That identity IS the row's primary key and the write is ON CONFLICT DO
--      NOTHING, so a row uploaded twice is stored once. This file deletes the duplicates
--      already stored (keeping the earliest copy) and re-keys every row to the identical
--      md5(identity)::uuid so a sheet already in the book is refused row by row.
--
--   2. TWO WEEKS. prune_abnormal_payments -- the same shape, the same week boundary and the
--      same bounded slices as prune_received_payments -- trims rows whose upload stamp
--      (created_at) is older than last week's Monday. The upload calls it at the very end of
--      its clock after the other two trims; until this file is run it simply is not there and
--      nothing is trimmed. The Abnormal Payments tab already says the window only reaches
--      back two weeks (prunedNote in portal-core.js), so the screen and the book agree.
--
-- WITHOUT IT nothing breaks: new uploads stop duplicating each other from today.
-- SAFE TO RE-RUN. A small table: seconds. The SQL editor sends the whole file as ONE
-- statement, so a timeout anywhere rolls back all of it -- run it whole.
-- =====================================================================================
set statement_timeout = '120s';

-- THE ONE DEFINITION OF AN ABNORMAL ROW'S IDENTITY IN SQL. Mirrors abnormalIdentity() exactly:
--   upper(trim(x))                 <->  String(x).trim().toUpperCase()
--   amount with no trailing zeros  <->  String(Number(paid) || 0)   ("5000.00" and 5000 are one)
--   concat_ws('|', ...)            <->  [...].join('|')  (every part coalesced to '' first)
create or replace function abnormal_payment_identity(
  p_transaction_id text, p_ref_id text, p_ref_no text, p_paid numeric,
  p_phone_number text, p_sender_name text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(upper(trim(p_transaction_id)), ''),
    nullif(upper(trim(p_ref_id)), ''),
    concat_ws('|',
      upper(coalesce(trim(p_ref_no), '')),
      rtrim(rtrim(coalesce(p_paid, 0)::text, '0'), '.'),
      upper(coalesce(trim(p_phone_number), '')),
      upper(coalesce(trim(p_sender_name), ''))))
$$;

-- 1a. THE DUPLICATES ALREADY STORED. The earliest copy of each stays; every later copy goes.
with keyed as (
  select id,
         row_number() over (
           partition by abnormal_payment_identity(transaction_id, ref_id, ref_no, paid, phone_number, sender_name)
           order by created_at, id) as rn
  from abnormal_payments
)
delete from abnormal_payments a
using keyed k
where a.id = k.id and k.rn > 1;

-- 1b. RE-KEY what is left to the identity the uploader computes. Identities are unique after
--     1a, so no two rows can want the same id.
update abnormal_payments
set id = md5(abnormal_payment_identity(transaction_id, ref_id, ref_no, paid, phone_number, sender_name))::uuid
where id <> md5(abnormal_payment_identity(transaction_id, ref_id, ref_no, paid, phone_number, sender_name))::uuid;

-- 2. TWO WEEKS. Same shape as prune_received_payments (RUN-ME-028): a week boundary, not a
--    rolling fortnight, so a Monday morning still has the week the meeting is about; bounded
--    slices, each its own committed statement. The upload calls it with (2, <limit>).
create or replace function prune_abnormal_payments(p_keep_weeks int default 2, p_limit int default 20000)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare cut date; n bigint;
begin
  cut := (date_trunc('week', current_date)::date) - (7 * greatest(p_keep_weeks - 1, 0));
  with doomed as (
    select id from abnormal_payments where created_at::date < cut order by created_at limit greatest(p_limit, 1)
  )
  delete from abnormal_payments a using doomed d where a.id = d.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function prune_abnormal_payments(int, int) to anon, authenticated, service_role;

-- THE FIRST CLEAN-OUT. Run this line repeatedly until it answers 0.
select public.prune_abnormal_payments(2, 20000) as deleted;

-- DID IT LAND? Both should be 0 -- no identity held twice, no row off its key.
-- select count(*) - count(distinct abnormal_payment_identity(transaction_id, ref_id, ref_no, paid, phone_number, sender_name)) as duplicates_left,
--        count(*) filter (where id <> md5(abnormal_payment_identity(transaction_id, ref_id, ref_no, paid, phone_number, sender_name))::uuid) as rows_off_key
-- from abnormal_payments;
