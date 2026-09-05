-- =====================================================================================
-- RUN-ME-027 -- TWO THINGS. THE STATUS PANEL, PROPERLY THIS TIME; AND CALL LOG RETENTION.
--
-- PART 1 IS A CORRECTION OF MINE. RUN-ME-026 removed four COUNT(*) from
-- upload_status_summary and I said that was the cost. The plan afterwards:
--
--   Execution Time: 16755.570 ms
--     ->  HashAggregate (actual time=14380.827 rows=14)
--           Group Key: defaulter_snapshots.snapshot_type, COALESCE(weekday, '')
--           ->  Index Only Scan using idx_def_snap_batch
--                 (actual time=15.443..5749.595 ROWS=1434689)
--
-- Still sixteen seconds. `max(snapshot_date) GROUP BY snapshot_type, weekday` reads EVERY ROW
-- of the table -- 1,434,689 of them -- because POSTGRES HAS NO SKIP SCAN: to find the largest
-- date in each group it walks the whole index rather than jumping to the end of each group.
-- I wrote "count(*) walked the table, max walks the index" as though the second were free. It
-- is the same walk. Removing the count halved the work and left the other half in place.
--
-- WHAT MAKES IT INSTANT is asking for the groups BY NAME. `max(snapshot_date) where
-- snapshot_type = 'today'` is an equality on the leading column of idx_repay_snap_lookup, so
-- the planner walks that index BACKWARDS and stops at the first row. Eighteen of those, one
-- per group, instead of one walk of 1.4 million.
--
-- And the groups are known: the panel itself draws a fixed list -- four Expected types, two
-- Defaulter types times seven weekdays -- and looks each up by key. It never needed the
-- function to DISCOVER them, which is the only reason they were being grouped at all.
--
-- PART 2 IS CALL LOG RETENTION.
--
--   "please always autodelete call logs by keeping only last week and current [2]"
--
-- call_logs is 977,616 rows after one month and it is the fastest-growing table in the book:
-- three hundred officers, every call, every day.
--
-- I PREDICTED THIS WOULD LEAVE "roughly forty thousand rows, a table one twenty-fifth the
-- size". IT DID NOT, AND THE REASON MATTERS. Measured on 5 Sep 2026 with the cut at 24 Aug:
--
--   977,616 before  ->  about 685,000 after.  292,000 rows removed, thirty per cent, not
--   ninety-six. The table is not spread evenly across the month: early August ran about
--   14,000 calls a day, the last fortnight about 53,000. Call volume roughly quadrupled as
--   officers came onto the app, so nearly all of the table IS the two weeks being kept.
--
-- The prune is still worth having -- it caps the table instead of letting it run at twenty
-- million rows a year -- but the honest steady state is around 700,000 rows and climbing with
-- headcount, not forty thousand. Anyone sizing the disk off this file should use that figure.
--
-- WHAT THIS COSTS, said before it is run: the calls report on the phone lets a leader pick ANY
-- date range. Ranges reaching before last Monday will come back empty from now on. That is the
-- trade being asked for, and api/_lib/call-core.js now says so on the report rather than
-- showing an honest-looking zero.
--
-- IT DELETES IN BOUNDED SLICES, never one enormous statement. A single DELETE of nine hundred
-- thousand rows holds one transaction open for minutes, writes that much WAL, and leaves the
-- table full of dead tuples with autovacuum starting from behind. Section 2b is the first
-- clean-out and is meant to be run several times until it reports 0.
-- =====================================================================================
set statement_timeout = '120s';


-- =====================================================================================
-- 1. THE STATUS PANEL, ASKING FOR ITS GROUPS BY NAME.
--    Same function name, same arguments, same returned columns. Nothing that calls it changes.
-- =====================================================================================
create or replace function upload_status_summary(p_day date)
returns table (
  source text, kind text, weekday text,
  latest date, total bigint, today bigint, uploads bigint
)
language sql
stable
as $$
  with rep_day as (
    select snapshot_type::text as kind,
           coalesce(upload_batch::text, 'legacy') as batch, count(*) as n
    from repayment_snapshots where snapshot_date = p_day group by 1, 2
  ),
  def_day as (
    select snapshot_type::text as kind, coalesce(weekday::text, '') as wd,
           coalesce(upload_batch::text, 'legacy') as batch, count(*) as n
    from defaulter_snapshots where snapshot_date = p_day group by 1, 2, 3
  )
  /* THE FOUR EXPECTED BOOKS, BY NAME. Each max() is an equality on the leading column of
     idx_repay_snap_lookup (snapshot_type, snapshot_date, team), so it is an index scan
     backwards that stops at the first row. */
  select 'expected'::text, k.kind, ''::text,
         (select max(r.snapshot_date) from repayment_snapshots r where r.snapshot_type = k.kind),
         null::bigint,                                   -- see RUN-ME-026: never counted again
         coalesce((select max(d.n) from rep_day d where d.kind = k.kind), 0),
         coalesce((select count(*) from rep_day d where d.kind = k.kind), 0)
  from (values ('today'), ('tomorrow'), ('yesterday'), ('initial')) as k(kind)
  union all
  /* THE FOURTEEN DEFAULTER DECKS, BY NAME -- two types across seven weekdays, which is exactly
     what the panel draws. idx_def_snap_lookup leads (snapshot_type, weekday, snapshot_date). */
  select 'defaulters'::text, k.kind, k.wd,
         (select max(d.snapshot_date) from defaulter_snapshots d
           where d.snapshot_type = k.kind and d.weekday = k.wd),
         null::bigint,
         coalesce((select max(x.n) from def_day x where x.kind = k.kind and x.wd = k.wd), 0),
         coalesce((select count(*) from def_day x where x.kind = k.kind and x.wd = k.wd), 0)
  from (select t.kind, w.wd
          from (values ('current'), ('initial')) as t(kind)
          cross join (values ('MON'), ('TUE'), ('WED'), ('THU'), ('FRI'), ('SAT'), ('SUN')) as w(wd)) k
  union all
  select 'received'::text, ''::text, ''::text,
         (select max(paid_at) from received_payments)::date,
         null::bigint,
         (select count(*) from received_payments where paid_at >= p_day and paid_at < p_day + 1),
         0::bigint
  union all
  select 'calls'::text, ''::text, ''::text,
         (select max(call_date) from call_logs),
         null::bigint,
         (select count(*) from call_logs where call_date = p_day),
         0::bigint
$$;

grant execute on function upload_status_summary(date) to anon, authenticated, service_role;

-- PROOF. Should now be milliseconds, and no line should say `rows=1434689`.
explain (analyze, buffers, timing)
select * from upload_status_summary(current_date);


-- =====================================================================================
-- 2. CALL LOG RETENTION -- the current week and the one before it.
-- =====================================================================================

-- 2a. THE FUNCTION. Deletes at most p_limit rows older than the cut and returns how many went,
--     so a caller can keep going until it answers 0. Bounded on purpose: see the header.
--
--     THE CUT IS A WEEK BOUNDARY, not a rolling fourteen days -- "last week and current" is
--     what was asked for, and on a Monday a rolling window would already have thrown away
--     most of the week the Monday meeting is about. date_trunc('week') is Monday in Postgres.
create or replace function prune_call_logs(p_keep_weeks int default 2, p_limit int default 20000)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare cut date; n bigint;
begin
  cut := (date_trunc('week', current_date)::date) - (7 * greatest(p_keep_weeks - 1, 0));
  with doomed as (
    select id from call_logs where call_date < cut order by call_date limit greatest(p_limit, 1)
  )
  delete from call_logs c using doomed d where c.id = d.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function prune_call_logs(int, int) to anon, authenticated, service_role;

-- 2b. THE FIRST CLEAN-OUT. About nine hundred thousand rows on this book, so it is done in
--     slices: RUN THIS LINE REPEATEDLY until it answers 0. Each run is bounded and commits on
--     its own, so nothing is held open and an interrupted run has still done real work.
--     Not during the morning collection round.
select public.prune_call_logs(2, 20000) as deleted;

-- 2c. AND THEN GIVE THE SPACE BACK. Deleting rows does not shrink a table; VACUUM marks the
--     space reusable so the next month of calls goes into it instead of growing the file.
--     Run ALONE, nothing else highlighted -- vacuum cannot run inside a transaction block.
--   vacuum (analyze) public.call_logs;

-- 2d. WHERE IT GOT TO.
select count(*) as rows_left,
       min(call_date) as oldest,
       (date_trunc('week', current_date)::date) - 7 as cut
from call_logs;
