-- =====================================================================================
-- RUN-ME-041a  NOTICE RECOVERIES, RECORDED FOR GOOD -- and matched by the customer's PHONE.
--              Part a: the ledger and the fold. Part b (RUN-ME-041b) switches the two
--              functions over to it. RUN a THEN b, each as its own query.
--
--   "remember received autodeletes so i dont know how we'll forever record notice recoverey
--    hardcoded"
--
-- Two facts the check query made plain: (1) received_payments is trimmed to two weeks
-- (RUN-ME-028), so "paid since the notice" read live off the book forgets anything older than a
-- fortnight; (2) the book's REF NO is not the deck's REF# -- none of the notified customers
-- matched by ref, but their payments DID match by CUSTOMER NO / PAYMENT NO, the phone.
--
-- So: notice_payment_ledger keeps one row per (notice, payment) for good, and
-- fold_notice_payments copies into it every payment the book holds for a notified customer
-- from the notice date on, matched by ref OR by the last nine digits of the phone.
--
-- Whole file: new query, paste, Ctrl+A, Run. Under 100 lines on purpose. SAFE TO RE-RUN.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

-- 1. THE LEDGER. A payment under two notices to one customer is two rows, one per notice; the
--    screen adds each customer up once.
create table if not exists public.notice_payment_ledger (
  ref         text not null,
  since       date not null,                 -- the notice date
  payment_id  uuid not null,                 -- received_payments.id, which outlives that row
  paid_at     date,
  amount      numeric(14,2) not null default 0,
  matched_by  text,                          -- 'ref' or 'phone'
  recorded_at timestamptz not null default now(),
  primary key (ref, since, payment_id)
);

-- 2. THE FOLD. p_before limits it to the rows a prune is about to delete; null folds the book.
--    Three equality joins rather than one OR, so each is a hash join over the fortnight's rows.
create or replace function public.fold_notice_payments(p_before date default null)
returns bigint language plpgsql security definer set search_path = public, pg_catalog as $$
declare n bigint;
begin
  with want as (
    select ref, notice_date as since,
           case when length(regexp_replace(coalesce(contact, ''), '\D', '', 'g')) >= 9
                then right(regexp_replace(contact, '\D', '', 'g'), 9) end as ph
    from demand_notices where ref is not null and notice_date is not null
  ), book as (
    select id, paid_at, coalesce(amount_paid, 0) as amount, btrim(ref_no) as ref_no,
           right(regexp_replace(coalesce(customer_no, ''), '\D', '', 'g'), 9) as c9,
           right(regexp_replace(coalesce(payment_no, ''), '\D', '', 'g'), 9) as p9
    from received_payments
    where paid_at >= (select min(notice_date) from demand_notices)
      and (p_before is null or paid_at < p_before)
  ), hit as (
    select w.ref, w.since, b.id, b.paid_at, b.amount, 'ref' as how
      from want w join book b on b.ref_no = w.ref and b.paid_at >= w.since
    union all
    select w.ref, w.since, b.id, b.paid_at, b.amount, 'phone'
      from want w join book b on b.c9 = w.ph and b.paid_at >= w.since
    union all
    select w.ref, w.since, b.id, b.paid_at, b.amount, 'phone'
      from want w join book b on b.p9 = w.ph and b.paid_at >= w.since
  )
  insert into notice_payment_ledger (ref, since, payment_id, paid_at, amount, matched_by)
  select ref, since, id, paid_at, amount, min(how) from hit
  group by ref, since, id, paid_at, amount
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.fold_notice_payments(date) to anon, authenticated, service_role;

-- 3. PROOF: the first fold, and what it recorded.
select public.fold_notice_payments(null) as folded_now;
select ref, since, count(*) as payments, sum(amount) as paid,
       count(*) filter (where matched_by = 'phone') as by_phone, max(paid_at) as last_paid
from public.notice_payment_ledger group by ref, since order by since desc, ref limit 50;
