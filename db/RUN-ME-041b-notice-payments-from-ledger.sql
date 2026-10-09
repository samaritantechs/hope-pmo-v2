-- =====================================================================================
-- RUN-ME-041b  NOTICE RECOVERIES, RECORDED FOR GOOD -- part b: the two functions switch over.
--              RUN AFTER RUN-ME-041a (the ledger and the fold must exist).
--
--   notice_payments         folds what the book holds now, then answers from the ledger -- so
--                           the Legal tab's "Paid since notice" no longer forgets a payment
--                           once the two-week prune has taken it, and counts the ones matched
--                           by phone. The answer gains n_phone, which is how the screen tells
--                           this version from RUN-ME-040's live one and stops naming this file.
--   prune_received_payments RUN-ME-028's function, same signature, same bounded delete; the
--                           one new line folds the rows about to go BEFORE deleting them, so
--                           nothing leaves the book unrecorded. Nothing in the upload request
--                           changes: the prune it already calls simply folds first.
--
-- Whole file: new query, paste, Ctrl+A, Run. Under 100 lines on purpose. SAFE TO RE-RUN.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

-- 1. PAYMENTS SINCE EACH NOTICE, from the ledger. The return shape changes (n_phone), and
--    Postgres will not alter a function's shape in place, hence the drop.
drop function if exists public.notice_payments(text[], date[]);
create function public.notice_payments(p_refs text[], p_dates date[])
returns table (ref text, since date, paid numeric, n bigint, last_paid date, n_phone bigint)
language plpgsql volatile security definer set search_path = public, pg_catalog as $$
#variable_conflict use_column
begin
  perform public.fold_notice_payments(null);
  return query
    with want as (select btrim(u.ref) as ref, u.since from unnest(p_refs, p_dates) as u(ref, since))
    select w.ref, w.since, coalesce(sum(l.amount), 0)::numeric, count(l.payment_id), max(l.paid_at),
           count(l.payment_id) filter (where l.matched_by = 'phone')
    from want w left join notice_payment_ledger l on l.ref = w.ref and l.since = w.since
    group by w.ref, w.since;
end $$;
grant execute on function public.notice_payments(text[], date[]) to anon, authenticated, service_role;

-- 2. THE PRUNE FOLDS FIRST.
create or replace function public.prune_received_payments(p_keep_weeks int default 2, p_limit int default 20000)
returns bigint language plpgsql security definer set search_path = public, pg_catalog as $$
declare cut date; n bigint;
begin
  /* A WEEK BOUNDARY, not a rolling fourteen days -- RUN-ME-028's rule, unchanged. */
  cut := (date_trunc('week', current_date)::date) - (7 * greatest(p_keep_weeks - 1, 0));
  perform public.fold_notice_payments(cut);
  with doomed as (
    select id from received_payments where paid_at < cut order by paid_at limit greatest(p_limit, 1)
  )
  delete from received_payments r using doomed d where r.id = d.id;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.prune_received_payments(int, int) to anon, authenticated, service_role;

-- 3. PROOF: every notice with what the ledger holds for it, through the function the screen
--    calls (one call for the whole register).
with reg as (select array_agg(ref) as refs, array_agg(notice_date) as dates
             from public.demand_notices where ref is not null and notice_date is not null)
select n.notice_id, n.ref, n.contact, n.notice_date, n.arrears_at_notice,
       p.paid as paid_since, p.n as payments, p.n_phone as by_phone, p.last_paid
from reg, public.notice_payments(reg.refs, reg.dates) p
join public.demand_notices n on n.ref = p.ref and n.notice_date = p.since
order by n.notice_date desc, n.notice_id limit 50;
