-- =====================================================================================
-- RUN-ME-024 -- THE POSTGRES WAR THAT MEASURES FIRST.   READ-ONLY UNTIL SECTION 7.
--
--   "the postgress war should check efficiency in all navs existing"
--   "Slow speed is almost everywhere thats why i said all navs"
--
-- SLOW EVERYWHERE IS A DIFFERENT FAULT FROM ONE SLOW SCREEN, and it needs a different answer.
-- One slow screen is a bad query. Everything slow at once is the machine underneath, and we
-- already measured that:
--
--   select sum(i) from generate_series(1,3000000) i;      ->  10,535 ms
--
-- No table, no index, no lock, no disk -- pure arithmetic, and a healthy small instance does it
-- in well under a second. That is why the 84-row `teams` table and the EMPTY abnormal_payments
-- table both took over four seconds on the diagnosis card.
--
-- SO MORE INDEXES ARE NOT THE ANSWER, AND THIS FILE DOES NOT ADD ANY. Five index wars have
-- already run (RUN-ME-008, 010, 011, 012, 019) and the plan you sent proved the point: the
-- index IS used, every buffer was already in memory, and the time went on ADDING. There is
-- nothing left to index.
--
-- WHAT IS ACTUALLY LEFT, IN ORDER OF SIZE:
--
--   1. The decks, added up once instead of on every read.  RUN-ME-022. Already deployed in the
--      code; section 3 below says whether the backfill ever finished. This is the big one.
--   2. Indexes nobody reads.  Every one of them is rebuilt on every INSERT, so an unused index
--      is a tax on UPLOADING and on nothing else. Section 4 finds them.
--   3. Dead rows.  A table that is mostly dead tuples is read page by page through the corpses.
--      Section 5 finds them; section 7 has the one safe, non-blocking fix.
--
-- SECTIONS 1-6 CHANGE NOTHING AT ALL. Run them, send me what they say, and section 7 becomes a
-- short list of things worth doing rather than a guess. Nothing here locks a table, blocks an
-- upload, or interrupts the call app.
-- =====================================================================================
set statement_timeout = '120s';


-- 1. IS IT STILL THE CPU? The same arithmetic as before, with nothing behind it.
--    Under 1,000 ms   the instance recovered; the rest of this file is where the answer is.
--    Over 5,000 ms    it is still throttled, and NO query change will make the portal quick.
explain (analyze, timing)
select sum(i), count(*) from generate_series(1, 3000000) i;


-- 2. WHAT THE DATABASE IS ACTUALLY BUSY WITH, if pg_stat_statements is on. This is the whole
--    "all navs" question answered by the database instead of by me reading code: the top rows
--    ARE the slow screens, whichever they turn out to be. If it errors, the extension is not
--    installed and section 6 is the fallback.
select substr(regexp_replace(query, '\s+', ' ', 'g'), 1, 110) as query,
       calls,
       round(total_exec_time)::bigint            as total_ms,
       round(mean_exec_time)::bigint             as mean_ms,
       round(100 * total_exec_time
             / nullif(sum(total_exec_time) over (), 0))::int as pct_of_all
from pg_stat_statements
order by total_exec_time desc
limit 20;


-- 3. DID THE DECK-TOTALS BACKFILL EVER FINISH? This is the largest lever already built and it
--    only pays once every day is built -- a range serves from the cache only when EVERY day in
--    it is built, so a half-finished backfill is worth almost nothing.
--    days_left 0  ->  done. Anything else -> run RUN-ME-022 section 4 again until it is 0.
select coalesce((select count(*)
                   from generate_series(current_date - 120, current_date, interval '1 day') d
                   cross join (values ('expected'), ('defaulter')) as k(kind)
                   left join public.deck_totals_days b
                          on b.kind = k.kind and b.snapshot_date = d::date
                  where b.snapshot_date is null), -1) as days_left,
       (select count(*) from public.deck_totals_days) as days_built,
       (select count(*) from public.deck_totals)      as rows_cached;


-- 4. INDEXES NOBODY HAS EVER USED -- the tax on uploading.
--    Every index on a table is written on every INSERT. Five index wars have run over this
--    book; anything with idx_scan = 0 is pure cost on the one path that must never slow down.
--    READ-ONLY: this only lists them. Dropping is section 7, one line at a time, by choice.
select s.relname                as table_name,
       s.indexrelname           as index_name,
       s.idx_scan               as times_used,
       pg_size_pretty(pg_relation_size(s.indexrelid)) as size,
       i.indisunique            as is_unique
from pg_stat_user_indexes s
join pg_index i on i.indexrelid = s.indexrelid
where s.schemaname = 'public'
  and s.idx_scan = 0
  and not i.indisunique          -- never touch a uniqueness constraint; it is a rule, not a speed-up
  and not i.indisprimary
order by pg_relation_size(s.indexrelid) desc;


-- 5. DEAD ROWS AND STALE PLANS. A table that is half dead tuples is read through the corpses,
--    which on a throttled CPU is felt everywhere at once. n_dead_tup much above 20% of
--    n_live_tup on a big table is worth section 7's VACUUM.
select relname                                   as table_name,
       n_live_tup                                as live_rows,
       n_dead_tup                                as dead_rows,
       case when n_live_tup > 0
            then round(100.0 * n_dead_tup / n_live_tup)::int end as dead_pct,
       pg_size_pretty(pg_total_relation_size(relid))              as total_size,
       last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
from pg_stat_user_tables
where schemaname = 'public'
order by n_dead_tup desc
limit 20;


-- 6. THE FIVE READS EVERY NAV IS BUILT ON, TIMED ON THIS INSTANCE. If section 2 could not run,
--    this is the fallback: the shapes behind the dashboard, the weekly report, the follow-up
--    tabs and the phone. Compare the Execution Times against each other, not against a target.
explain (analyze, buffers, timing)
select count(*) from public.teams;                                       -- the 84-row baseline

explain (analyze, buffers, timing)
select s.snapshot_date, s.team, count(*), sum(coalesce(s.arrears,0))
from public.defaulter_snapshots s
where s.snapshot_date >= current_date - 7
group by s.snapshot_date, s.team;                                        -- the deck aggregate

explain (analyze, buffers, timing)
select s.snapshot_date, s.team, count(*), sum(coalesce(s.payment_expected,0))
from public.repayment_snapshots s
where s.snapshot_date >= current_date - 7
group by s.snapshot_date, s.team;                                        -- the expected aggregate

explain (analyze, buffers, timing)
select count(*) from public.followup_status where status is not null or arrears is not null;

explain (analyze, buffers, timing)
select count(*) from public.followup_comments where created_at >= current_date - 7;


-- =====================================================================================
-- 7. THE ACTIONS. NOTHING BELOW RUNS UNLESS YOU UNCOMMENT IT, and each is reversible.
--    Send me sections 1-6 first; then only the lines that the measurements actually justify.
-- =====================================================================================

-- 7a. FRESH PLANS. Safe, non-blocking, takes seconds, and worth doing whatever else is true:
--     a planner working from stale statistics picks bad plans on every nav at once. This is
--     the one line here I would run without waiting for anything.
--
--   analyze public.defaulter_snapshots;
--   analyze public.repayment_snapshots;
--   analyze public.followup_status;
--   analyze public.followup_comments;
--   analyze public.loans;

-- 7b. RECLAIM DEAD ROWS -- AND THEN STOP HAVING TO.
--
--     WHAT SECTION 5 FOUND ON THIS BOOK: `last_autovacuum` was NULL on every table but one.
--     defaulter_snapshots -- 1.39 million live rows, 211,000 dead -- had never been vacuumed at
--     all. That is why an "Index Only Scan" in section 6 still showed `Heap Fetches: 1774`:
--     without a vacuum the VISIBILITY MAP is never built, so an index-only scan has to go to
--     the heap anyway. Every read, on every nav, doing work it should not have to.
--
--     AND IT WAS NOT A BROKEN AUTOVACUUM. It is ON, with the default
--     autovacuum_vacuum_scale_factor = 0.2 -- twenty per cent. Twenty per cent of 1.39 million
--     rows is 278,000 dead tuples before it will even start. The table sat at 211,000, under
--     the line, for ever. The default is written for small tables; on a big one it means the
--     table permanently carries a quarter of a million corpses.
--
--     SO THE DURABLE FIX IS THE THRESHOLD, not a vacuum somebody has to remember to run.
--     ALTER TABLE ... SET (autovacuum_*) takes SHARE UPDATE EXCLUSIVE: it does NOT block reads
--     or writes, so uploading and the call app are untouched. Two per cent of 1.39 million is
--     27,800 -- often enough to keep the map warm, rarely enough to cost nothing noticeable.
--
--   alter table public.defaulter_snapshots
--     set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
--   alter table public.repayment_snapshots
--     set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
--   alter table public.call_logs
--     set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
--
--     THEN ONE VACUUM BY HAND to clear what has already built up and build the visibility map
--     for the first time. VACUUM (not FULL) does NOT lock the table -- reads and writes carry
--     on. VACUUM FULL does lock it and rewrite it, and it is deliberately NOT in this file.
--
--     VACUUM CANNOT RUN INSIDE A TRANSACTION BLOCK, and the SQL editor wraps a multi-statement
--     script in one:  ERROR: 25001: VACUUM cannot run inside a transaction block.
--     So each of these is selected and run ENTIRELY ALONE -- one line, nothing else
--     highlighted, not even a `set` beside it.
--
--   vacuum (analyze) public.defaulter_snapshots;
--   vacuum (analyze) public.repayment_snapshots;
--   vacuum (analyze) public.call_logs;
--   vacuum (analyze) public.loans;

-- 7c. DROP AN INDEX NOBODY READS, from section 4's list, ONE AT A TIME.
--     CONCURRENTLY so nothing is locked and no upload waits. Every drop makes every INSERT on
--     that table cheaper, which is the one path that must never slow down.
--     Take them from the section 4 output -- do not guess a name.
--     TO PUT ONE BACK: the CREATE INDEX for every one of them is in db/RUN-ME-008 / 010 / 011 /
--     012 / 019, so nothing here is a one-way door.
--
--   drop index concurrently if exists public.<name from section 4>;

-- 7d. AND THE ONE THAT IS NOT A DATABASE CHANGE AT ALL.
--     If section 1 still reports five or ten seconds for arithmetic with no table behind it,
--     the instance is throttled and everything above is trimming around the edge of that. The
--     honest sentence is that the machine is too small for this book, and no query I write
--     changes it. I am not going to keep implying otherwise while you pay for both sides.
-- =====================================================================================
