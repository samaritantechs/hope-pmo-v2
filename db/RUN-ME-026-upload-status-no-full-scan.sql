-- =====================================================================================
-- RUN-ME-026 -- THE UPLOAD STATUS PANEL STOPS READING THE WHOLE BOOK.  ONE FUNCTION.
--
-- WHAT THIS IS. The panel on the upload page that says which reports are in for today. It
-- calls upload_status_summary(p_day), and that function has been doing this on every load:
--
--     select snapshot_type, max(snapshot_date), COUNT(*) from repayment_snapshots group by 1
--     select snapshot_type, weekday, max(snapshot_date), COUNT(*) from defaulter_snapshots ...
--     select COUNT(*) from received_payments
--     select COUNT(*) from call_logs
--
-- FOUR COUNT(*) OVER FOUR WHOLE TABLES. There is no index that answers count(*) -- Postgres
-- has to visit every row to count it, whatever indexes exist -- so that is a full scan of
-- 1.4 million repayment rows, 1.4 million defaulter rows, every payment and every call, every
-- time somebody opens the upload page. On this instance, where adding up three million
-- integers takes fourteen seconds, that is not a panel. That is the upload page reading the
-- entire book to fill in a column nobody acts on.
--
-- It also evicts the cache: a sequential scan of 2.8 million rows pushes everything else out
-- of a 2 GB shared buffer on its way past, so the NEXT query is slow too, and the one after
-- that. That is what "slow everywhere at once" looks like from the inside.
--
-- WORSE, IT IS ON THE UPLOAD PATH. Rule 1 in CLAUDE.md: uploading never goes down and never
-- slows down. The page calls this on load and again after every upload lands.
--
-- WHAT THE PANEL IS ACTUALLY FOR: "is today's file in?" That is `latest`, `today` and
-- `uploads` -- all of them narrow, all of them indexed, all of them about ONE DAY. The
-- lifetime `total` column is a curiosity, and it is the only part that costs anything.
--
-- SO IT IS GONE. `total` comes back NULL, and the page already knows what to do with that: it
-- has a `lifetime` flag and has always been able to say "totals unavailable, showing this day"
-- -- that path was written for a deployment that had not run the migration, and it is exactly
-- the right behaviour here too. Nothing else about the panel changes.
--
-- AND TWO max()s THAT COULD NOT USE THEIR INDEX EITHER. `max(paid_at::date)` casts the column
-- before the aggregate, so the planner cannot walk the index and scans instead; `max(paid_at)`
-- can, and casting the ANSWER gives the identical date. Same for call_date. Two more full
-- scans, removed by moving a bracket.
--
-- SAFE TO RE-RUN. Same name, same arguments, same returned columns -- only the body changes,
-- so nothing that calls it needs to know. Reversible: the old body is in
-- db/RUN-ME-012-postgres-ww4.sql if it is ever wanted back.
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
  /* THE KINDS THAT EXIST, AND THE NEWEST DAY OF EACH -- and nothing more.
     max(snapshot_date) grouped by snapshot_type walks idx_repay_snap_lookup
     (snapshot_type, snapshot_date, team); count(*) walked the table. */
  rep_all as (
    select snapshot_type::text as kind, max(snapshot_date) as latest
    from repayment_snapshots group by 1
  ),
  def_day as (
    select snapshot_type::text as kind, coalesce(weekday::text, '') as wd,
           coalesce(upload_batch::text, 'legacy') as batch, count(*) as n
    from defaulter_snapshots where snapshot_date = p_day group by 1, 2, 3
  ), def_all as (
    select snapshot_type::text as kind, coalesce(weekday::text, '') as wd,
           max(snapshot_date) as latest
    from defaulter_snapshots group by 1, 2
  )
  select 'expected'::text, a.kind, ''::text, a.latest,
         null::bigint,                                     -- see the header: this was the cost
         coalesce((select max(d.n) from rep_day d where d.kind = a.kind), 0),
         coalesce((select count(*) from rep_day d where d.kind = a.kind), 0)
  from rep_all a
  union all
  select 'defaulters'::text, a.kind, a.wd, a.latest,
         null::bigint,
         coalesce((select max(d.n) from def_day d where d.kind = a.kind and d.wd = a.wd), 0),
         coalesce((select count(*) from def_day d where d.kind = a.kind and d.wd = a.wd), 0)
  from def_all a
  union all
  /* max(paid_at)::date, NOT max(paid_at::date) -- the first walks the index, the second scans
     the table to cast every row before aggregating. Same answer, one bracket. */
  select 'received'::text, ''::text, ''::text,
         (select max(paid_at) from received_payments)::date,
         null::bigint,
         (select count(*) from received_payments where paid_at >= p_day and paid_at < p_day + 1),
         0::bigint
  union all
  select 'calls'::text, ''::text, ''::text,
         (select max(call_date) from call_logs)::date,
         null::bigint,
         (select count(*) from call_logs where call_date = p_day),
         0::bigint
$$;

grant execute on function upload_status_summary(date) to anon, authenticated, service_role;


-- PROOF. Both should now be milliseconds, and neither should say "Seq Scan" on a snapshot
-- table. Before this change the same call read every row of four tables.
explain (analyze, buffers, timing)
select * from upload_status_summary(current_date);
