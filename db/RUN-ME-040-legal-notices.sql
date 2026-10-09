-- =====================================================================================
-- RUN-ME-040  DEMAND NOTICES: the letter is kept with its register row, and payments made
--             after a notice count as recoveries.
--
--   "Demand notice from hope pmo portal should perfectly match the one from Google sheets ...
--    Its time for the legal unit to shift"
--   "i had a weakness of not recording the collected recovered amount in the previous demand
--    notice production., cover it ... the payments within notice are all recoveries"
--
-- Whole file: new query, paste, Ctrl+A, Run. Under 100 lines on purpose. SAFE TO RE-RUN.
--
--   letter            every figure and name a notice was printed with, as JSON, so "tap a row
--                     to reprint" prints the SAME letter a year later -- never recomputed
--                     against a deck that has moved on. Notices issued before this column have
--                     none; those reprint off the customer's current deck row while they are
--                     still on it, and the screen says so.
--   notice_payments   for each notice (its customer, its date): what the received-payments
--                     book holds for that customer ON OR AFTER the notice date -- how much, how
--                     many payments, the last one. One call for the whole register; the
--                     database adds them up and the screen never downloads the payments book.
--
-- UNTIL THIS IS RUN nothing breaks: a notice still issues (without its stored letter), and
-- the Legal screen says payments after a notice are not read yet and names this file.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

-- 1. THE LETTER, BESIDE ITS ROW.
alter table public.demand_notices add column if not exists letter jsonb;

-- 2. PAYMENTS SINCE EACH NOTICE. ref_no is matched exactly, as the index on it is built
--    (idx_received_ref); both books write the customer's reference as plain digits.
create or replace function public.notice_payments(p_refs text[], p_dates date[])
returns table (ref text, since date, paid numeric, n bigint, last_paid date)
language sql
stable
set search_path = public, pg_catalog
as $$
  with want as (
    select btrim(u.ref) as ref, u.since
    from unnest(p_refs, p_dates) as u(ref, since)
  )
  select w.ref, w.since,
         coalesce(sum(r.amount_paid), 0) as paid,
         count(r.id)                     as n,
         max(r.paid_at)                  as last_paid
  from want w
  left join public.received_payments r
         on r.ref_no = w.ref and r.paid_at >= w.since
  group by w.ref, w.since
$$;

grant execute on function public.notice_payments(text[], date[]) to anon, authenticated, service_role;

-- 3. PROOF: the newest fifty notices with what has been paid since each was served.
select n.notice_id, n.ref, n.notice_date, n.arrears_at_notice,
       p.paid as paid_since, p.n as payments, p.last_paid,
       (n.letter is not null) as letter_kept
from public.demand_notices n
left join lateral public.notice_payments(array[n.ref], array[n.notice_date]) p on true
order by n.notice_date desc, n.notice_id
limit 50;
