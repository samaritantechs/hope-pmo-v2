-- =====================================================================================
-- RUN-ME-028 -- RECEIVED PAYMENTS: THE CURRENT WEEK AND THE ONE BEFORE IT.
--
--   "And always auto delete received payments with 2 weeks lifetime"
--
-- Same shape as prune_call_logs in RUN-ME-027, same week boundary, same bounded slices.
--
-- ONE THING TO SAY BEFORE IT RUNS, because it is not the same trade as the call log.
--
--   call_logs      977,616 rows after one month, on the path the phone reads all day.
--                  Trimming it to two weeks left about forty thousand: a table one
--                  twenty-fifth the size, and the biggest single win available.
--   received_payments   about 67,000 rows. Trimming it saves roughly seven per cent of what
--                  the call log saved, and it will not move the disk figure at all -- the
--                  disk is the two snapshot tables and call_logs, nothing else is close.
--
-- AND IT COSTS TWO THINGS THAT ARE NOT OBVIOUS:
--
--   1. THE PHONE'S CUSTOMER SHEET answers "did my payment arrive?" from this table, with no
--      date range at all -- it lists the newest forty. That screen exists so an officer can
--      answer a customer standing in front of them without ringing the office. After this, a
--      customer asking about last month gets an empty list. The sheet now SAYS what is kept
--      rather than showing nothing and letting the officer conclude the payment never came.
--
--   2. THE ABNORMAL PAYMENTS TAB looks back SIXTY DAYS by default (ABN_WINDOW_DAYS). After
--      this it can only ever find irregular payments from the last fortnight. The tab now says
--      so when its window reaches past what is kept.
--
-- Neither is a reason not to do it -- it was asked for plainly and it is the owner's book --
-- but both are reasons the screens must say what they no longer hold. Silence reads as
-- success, and on this table silence reads as "your payment never arrived".
--
-- TO KEEP MORE, change one number: the app passes p_keep_weeks and RUN-ME-027's call-log
-- pruning is separate, so the two can differ. Four weeks would keep the customer sheet useful
-- for a month at a table size nobody would notice.
-- =====================================================================================
set statement_timeout = '120s';

create or replace function prune_received_payments(p_keep_weeks int default 2, p_limit int default 20000)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare cut date; n bigint;
begin
  /* A WEEK BOUNDARY, not a rolling fourteen days -- the same rule prune_call_logs follows, and
     for the same reason: on a Monday a rolling window has already thrown away most of the week
     the Monday meeting is about. date_trunc('week') is Monday in Postgres. */
  cut := (date_trunc('week', current_date)::date) - (7 * greatest(p_keep_weeks - 1, 0));
  with doomed as (
    select id from received_payments where paid_at < cut order by paid_at limit greatest(p_limit, 1)
  )
  delete from received_payments r using doomed d where r.id = d.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function prune_received_payments(int, int) to anon, authenticated, service_role;


-- THE FIRST CLEAN-OUT. Run this line repeatedly until it answers 0. Each run is bounded and
-- commits on its own, so nothing is held open and an interrupted run has still done real work.
select public.prune_received_payments(2, 20000) as deleted;

-- THEN GIVE THE SPACE BACK. Run ALONE -- vacuum cannot run inside a transaction block.
--   vacuum (analyze) public.received_payments;

-- WHERE IT GOT TO.
select count(*) as rows_left,
       min(paid_at) as oldest,
       (date_trunc('week', current_date)::date) - 7 as cut
from received_payments;
