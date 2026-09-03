-- =====================================================================================
-- RUN-ME-021 -- WHAT YOUR PLAN SAID, AND THE ONE CHEAP THING TO TRY.   ADDITIVE ONLY.
--
-- You ran section 3 of RUN-ME-020 and sent the plan. It rules out almost everything I would
-- otherwise have guessed at, so here is the reading, in full:
--
--   Index Scan using idx_def_snap_date        the index IS being used. No sequential scan,
--                                             nothing missing. RUN-ME-020's section 4 index
--                                             would NOT have helped; do not run it.
--   Buffers: shared hit=4446   (read=0)       every page came from memory. No disk, so the
--                                             instance's RAM is not the problem either.
--   rows=109,603  ->  rows=878                a hundred and ten thousand deck rows are read
--                                             to produce eight hundred and seventy-eight
--                                             team-day totals. THAT is the cost.
--   Index Scan  actual time 0.037..511.149    half a second to find and read the rows,
--   Execution Time: 3343.341 ms               and 2.8 seconds to add them up.
--
-- So the query is not badly written and no index is missing. It reads the whole week of both
-- decks, from memory, and spends its time adding. 3.3 seconds for ONE of these, several per
-- dashboard load, on a morning when three hundred phones are asking too, is how a 45-second
-- client deadline gets passed -- which is why the error you pasted is almost certainly
-- "canceling statement due to user request": the browser gave up, the query kept running.
--
-- ONE ODDITY WORTH ONE CHEAP FIX, in section 1 below. Everything here is additive and
-- reversible in one line. Nothing is dropped, altered or deleted.
-- =====================================================================================


-- 1. THE PLANNER IS BADLY WRONG ABOUT THIS GROUPING, AND THAT IS FIXABLE.
--
--    Your plan:   HashAggregate (cost=... rows=77834 ...) (actual ... rows=878 ...)
--                 Planned Partitions: 4   Batches: 1   Memory Usage: 1297kB
--
--    Postgres expected 77,834 groups and got 878 -- an eighty-nine-fold overestimate. It
--    guesses by multiplying how many distinct values each grouping column has, which assumes
--    they are independent. Here they are anything but: `weekday` is a function of
--    `snapshot_date`, and `upload_batch` decides date, type and weekday all three. So the
--    guess is enormous, and Postgres sets up a four-partition spill-capable aggregate for a
--    result that turns out to fit in 1.3 MB.
--
--    CREATE STATISTICS teaches it the real number. It is a few kilobytes, it is read at plan
--    time only, it adds nothing to any upload, and "drop statistics def_snap_group_stats"
--    removes it completely.
--
--    HONEST ABOUT THE SIZE OF THE PRIZE: the partitioning setup is overhead, not the bulk of
--    the 2.8 seconds -- "Batches: 1" means it never actually spilled. I expect this to help,
--    not to cure. Run section 2 before and after and we will know rather than assume.

create statistics if not exists def_snap_group_stats (ndistinct)
  on snapshot_date, snapshot_type, weekday, team, upload_batch
  from public.defaulter_snapshots;

analyze public.defaulter_snapshots;

-- The same for the expected side, which is asked the same shape of question all day.
create statistics if not exists rep_snap_group_stats (ndistinct)
  on snapshot_date, snapshot_type, team, upload_batch
  from public.repayment_snapshots;

analyze public.repayment_snapshots;


-- 2. THE SAME PLAN AGAIN. Compare "rows=" on the HashAggregate line against the 77834 above,
--    and the Execution Time against 3343 ms.
explain (analyze, buffers, timing)
select s.snapshot_date, s.snapshot_type, s.weekday, s.team, s.upload_batch,
       max(s.created_at) as created_at,
       count(*)::bigint as customers,
       sum(coalesce(s.arrears, 0)) as arrears_amt
from public.defaulter_snapshots s
where s.snapshot_date >= (date_trunc('week', current_date))::date
  and s.snapshot_date <= (date_trunc('week', current_date) + interval '6 days')::date
group by s.snapshot_date, s.snapshot_type, s.weekday, s.team, s.upload_batch;


-- 3. IS THE INSTANCE ITSELF SLOW? Adding 110,000 rows into 878 groups is work Postgres
--    normally does in a few hundred milliseconds. Taking 2.8 seconds, entirely from memory,
--    points at CPU rather than at the query. This times pure arithmetic with no table behind
--    it at all: on a healthy small instance it lands well under a second.
explain (analyze, timing)
select sum(i), count(*) from generate_series(1, 3000000) i;


-- =====================================================================================
-- THE REAL FIX, WHICH IS A CODE CHANGE AND NEEDS YOUR GO-AHEAD, NOT A PASTE.
--
-- Nothing above changes the shape of the problem: the dashboard asks a hundred and ten
-- thousand rows to be added up, several times, every time somebody opens it. The cure is to
-- add them up ONCE -- when the deck is uploaded -- into a small table of per-team-per-day
-- totals, and have these functions read that instead. Eight hundred and seventy-eight rows a
-- week rather than a hundred and ten thousand.
--
-- It is additive by design: the table fills as uploads happen, the functions fall back to
-- today's live aggregate for any day not in it, and if it ever disagrees the fallback is one
-- setting away. It is the change I flagged as "for a quiet evening", and it is the one that
-- takes the heavy morning off this database for good.
--
-- I am not writing it without you saying so. Say the word and it goes in behind a switch,
-- with the old path still there and one command to go back to it.
-- =====================================================================================
