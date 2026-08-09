-- =====================================================================================
-- "WHAT HAS ALREADY BEEN UPLOADED TODAY?" -- ASKED OF THE DATABASE, NOT OF THE WIRE.
--
--   "i can't even upload report appdates we get delay errors and so on"
--
-- The upload page opens with a panel listing every report and whether it is in yet. To fill
-- it, the server read FOUR WHOLE TABLES with no date filter at all:
--
--     repayment_snapshots      every expected row ever uploaded
--     defaulter_snapshots      every defaulter row ever uploaded
--     received_payments        every payment ever recorded
--     call_logs                every call ever made
--
-- ...to answer a question about ONE DAY. On a book of a million snapshot rows that is over a
-- thousand round trips and hundreds of megabytes, on the page whose whole job is to accept an
-- upload -- so the upload sat behind it and timed out. The panel that exists to say "your
-- report is missing" was itself the reason the report could not be loaded.
--
-- NOT ONE OF THOSE ROWS WAS EVER SHOWN. Every figure on that panel is a COUNT or a MAXIMUM:
--
--     latest    the newest snapshot_date for that report          max()
--     total     how many rows it holds altogether                 count()
--     today     the live count for the chosen day                 count() of the newest batch
--     uploads   how many times it was loaded that day             count(distinct upload_batch)
--
-- Every one of those is a question a database answers without moving a row. This function
-- returns about twenty summary rows and nothing else.
--
-- WHY `today` IS THE MAX OF THE BATCHES AND NOT THE SUM. Snapshots are append-only: a
-- corrected re-upload leaves BOTH copies on disk while every read resolves to the latest
-- batch. Adding them would report double after a re-upload and make it look as though the data
-- had doubled -- which is exactly what it used to do. So `today` counts what a READ would
-- actually see (the largest single batch of that day) and `uploads` says separately how many
-- are stacked underneath.
--
-- OPTIONAL, LIKE EVERY MIGRATION HERE. Without it the page falls back to reading only the
-- chosen DAY's rows -- still bounded, still fast, just without the lifetime totals, and it
-- says so on screen.
--
-- SAFE TO RE-RUN. INSTANT.
-- =====================================================================================

create or replace function upload_status_summary(p_day date)
returns table (
  source text,        -- 'expected' | 'defaulters' | 'received' | 'calls'
  kind text,          -- snapshot_type, or '' where the table has none
  weekday text,       -- defaulters only, else ''
  latest date,
  total bigint,
  today bigint,       -- the live count: the largest single batch of p_day
  uploads bigint      -- how many batches were loaded on p_day
)
language sql
stable
as $$
  -- ---- Expected repayment: grouped by snapshot_type ----
  with rep_day as (
    select snapshot_type::text as kind,
           coalesce(upload_batch::text, 'legacy') as batch,
           count(*) as n
    from repayment_snapshots
    where snapshot_date = p_day
    group by 1, 2
  ), rep_all as (
    select snapshot_type::text as kind, max(snapshot_date) as latest, count(*) as total
    from repayment_snapshots group by 1
  ),
  -- ---- Defaulters: grouped by snapshot_type AND weekday ----
  def_day as (
    select snapshot_type::text as kind, coalesce(weekday::text, '') as wd,
           coalesce(upload_batch::text, 'legacy') as batch,
           count(*) as n
    from defaulter_snapshots
    where snapshot_date = p_day
    group by 1, 2, 3
  ), def_all as (
    select snapshot_type::text as kind, coalesce(weekday::text, '') as wd,
           max(snapshot_date) as latest, count(*) as total
    from defaulter_snapshots group by 1, 2
  )
  select 'expected'::text, a.kind, ''::text, a.latest, a.total,
         coalesce((select max(d.n) from rep_day d where d.kind = a.kind), 0),
         coalesce((select count(*) from rep_day d where d.kind = a.kind), 0)
  from rep_all a
  union all
  select 'defaulters'::text, a.kind, a.wd, a.latest, a.total,
         coalesce((select max(d.n) from def_day d where d.kind = a.kind and d.wd = a.wd), 0),
         coalesce((select count(*) from def_day d where d.kind = a.kind and d.wd = a.wd), 0)
  from def_all a
  union all
  -- ---- The two that have no type at all: one row each ----
  select 'received'::text, ''::text, ''::text,
         (select max(paid_at::date) from received_payments),
         (select count(*) from received_payments),
         (select count(*) from received_payments where paid_at::date = p_day),
         0::bigint
  union all
  select 'calls'::text, ''::text, ''::text,
         (select max(call_date::date) from call_logs),
         (select count(*) from call_logs),
         (select count(*) from call_logs where call_date::date = p_day),
         0::bigint
$$;

grant execute on function upload_status_summary(date) to anon, authenticated, service_role;

-- The indexes these counts lean on. Both are almost certainly already present from
-- 2026-07-28-speed-indexes.sql / 2026-08-05b; `if not exists` makes saying so free.
create index if not exists idx_rep_snap_date on repayment_snapshots(snapshot_date);
create index if not exists idx_def_snap_date on defaulter_snapshots(snapshot_date);

-- =====================================================================================
-- CALLS PER OFFICER -- the other whole-table read, and the one that never stops growing.
--
-- Two admin screens showed "how many calls has each officer made", and to get it they read
-- EVERY ROW OF call_logs and counted them in JavaScript. Three hundred officers making fifty
-- calls a day is fifteen thousand rows a day, five and a half million a year -- read in full,
-- every time an admin opened Teams & Staff.
--
-- It is a GROUP BY. It belongs here.
-- =====================================================================================

create or replace function call_counts_by_user()
returns table (user_id text, calls bigint)
language sql
stable
as $$
  select user_id::text, count(*) from call_logs where user_id is not null group by 1
$$;

grant execute on function call_counts_by_user() to anon, authenticated, service_role;

create index if not exists idx_call_logs_user on call_logs(user_id);

-- DID IT LAND?
-- select * from upload_status_summary(current_date) order by source, kind, weekday;
-- select * from call_counts_by_user() order by calls desc limit 10;
