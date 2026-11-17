-- =====================================================================================
-- RUN-ME-071: THE SWAPPED DATES OF EACH CUSTOMER'S LAST-KNOWN DECK ROW, PUT RIGHT IN PLACE (no re-upload, no day-by-day repair)
--
--   "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong ... When we finish disb dates ..." -- the owner, 17 Nov 2026
--   "Don't clean owner role, recycling leader & cycle for 'cleared' customers at expected defaulters because the disb date still gives us where to place them
--    for the 3 columns - we need those 3 filled for followup purposes" -- the owner, 16 Nov 2026
--
-- WHAT IS WRONG. Until 16 Nov 2026 the upload read the loan system's month-first dates day-first (docs/HANDOFF.md Part 84), so four deck rows in five carry a
-- Disb, Expire and Chronic date with the day and the month swapped (RUN-ME-060). A customer who is no longer on any deck is shown on the Expected Defaulters tab as
-- CLEARED from THEIR LAST-KNOWN ROW (RUN-ME-055, Part 71: the newest current row of the customer), and that row's Disb date is what places them on a cycle day, a
-- recycling leader and a week. Those rows are spread over every day since August: putting them right the day-by-day way (RUN-ME-060 over every day, about two million
-- rows, dozens of runs) is the long road to the same place.
--
-- WHAT IT DOES. It changes DISB DATE, EXPIRE DATE and CHRONIC DATE of THE LAST-KNOWN ROW OF EACH CUSTOMER AND OF NO OTHER ROW, by exactly RUN-ME-060's rule:
--   * a row is the LAST-KNOWN row when it is a CURRENT row and no newer current row of the same customer (the same team and loan number) exists, on any day (a row of
--     the same day counts as newer when it was written later: a day uploaded twice). The same choice RUN-ME-055's function makes.
--   * the rule is RUN-ME-060's, word for word: DAYS ELAPSED and the loan system's own pattern (a loan expires 91 days after it was disbursed and turns chronic 14 days
--     after it expires; DAYS ELAPSED is the days from the disbursement to the deck's day, less 0 to 3). A row is changed ONLY WHEN its three dates as stored do NOT fit
--     that and EXACTLY ONE reading of them (each date as stored, or with its day and month exchanged) fits all of it. A restructured loan, a row with a date or DAYS
--     ELAPSED missing, a row where no reading fits or two do: left as it is. Nothing is guessed.
-- It does not touch an INITIAL row, a row that is not its customer's newest, LAST TRANS DATE or anything else. A customer still on the latest deck has a newest row that
-- was written right: nothing to do for them.
--
-- THE DAYS. The first lines of the query name the days of the LAST-KNOWN rows to repair (the whole range since August, to begin with) and how many rows one run may change.
-- A run reads the current rows of those days (through the snapshot_date index) and asks of each whether a newer one of the same customer exists (through the (ref,
-- snapshot_date) index): on a test book of 2.4 million rows the whole range took 2 seconds. If a run is cut off ("canceling statement due to statement timeout") it has
-- changed NOTHING and a shorter window (a month) is the answer. RUN AGAIN UNTIL
-- "still_to_do_run_again" SAYS 0. SET max_rows TO 0 TO COUNT WITHOUT CHANGING ANYTHING. SAFE TO RUN AGAIN: a repaired row fits the pattern and is never touched twice.
-- NEVER AT THE SAME MOMENT AS RUN-ME-060 OR RUN-ME-066, or while an upload is being written: they write the same table.
--
-- UNDO. Every row changed is written to defaulter_last_known_repair_log with its old and new dates (a log of its own: RUN-ME-066 reads RUN-ME-060's, and rows put right
-- here are not days put right). The undo is at the bottom, commented out.
--
-- COST. It reads the current rows of the days named and probes the index once for each row that does not fit; it writes only the rows it changes (a small part of
-- them: the customers who left). Nothing on uploads, nothing on HOPE Calls: no code reads the log, and no code waits for this script. The run is cut off after 50
-- seconds and rolls back whole if it is. (docs/HANDOFF.md Part 104.)
-- =====================================================================================
set local lock_timeout = '3s';
set local statement_timeout = '50s';
set local jit = off;

create table if not exists public.defaulter_last_known_repair_log (
  id uuid primary key,                       -- the deck row that was changed
  repaired_at timestamptz not null default now(),
  snapshot_date date, snapshot_type text, ref text, team text,
  disb_old date, expire_old date, chronic_old date,
  disb_new date, expire_new date, chronic_new date
);
alter table public.defaulter_last_known_repair_log enable row level security;

with win as (
  select date '2026-08-01' as from_day,      -- CHANGE: the first day of the last-known rows to repair (the whole range since August, to begin with)
         date '2026-11-15' as to_day,        -- CHANGE: the last day (the uploads from 16 Nov were read right)
         50000 as max_rows                   -- one run changes at most this many rows (0: count, change nothing)
),
lk as (   -- the CURRENT rows of those days that are the last-known row of their customer: no newer current row of the same team and loan number
  select s.id, s.ref, s.team, s.snapshot_date, s.snapshot_type, s.days_elapsed, s.disb_date, s.expire_date, s.chronic_date
  from public.defaulter_snapshots s
  cross join win
  where s.snapshot_type = 'current' and s.snapshot_date between win.from_day and win.to_day
    and not exists (select 1 from public.defaulter_snapshots n
                     where n.ref = s.ref and n.team is not distinct from s.team and n.snapshot_type = 'current'
                       and (n.snapshot_date > s.snapshot_date or (n.snapshot_date = s.snapshot_date and n.created_at > s.created_at)))
),
cand as (   -- those whose three dates, as stored, do not fit the pattern; and each date with day and month exchanged
  select s.id, s.ref, s.team, s.snapshot_date, s.snapshot_type, s.days_elapsed as de, s.disb_date as d, s.expire_date as e, s.chronic_date as c, sw.d_s, sw.e_s, sw.c_s
  from lk s
  cross join lateral (
    select case when extract(day from s.disb_date) <= 12 and extract(day from s.disb_date) <> extract(month from s.disb_date)
                then make_date(extract(year from s.disb_date)::int, extract(day from s.disb_date)::int, extract(month from s.disb_date)::int)
                else s.disb_date end as d_s,
           case when extract(day from s.expire_date) <= 12 and extract(day from s.expire_date) <> extract(month from s.expire_date)
                then make_date(extract(year from s.expire_date)::int, extract(day from s.expire_date)::int, extract(month from s.expire_date)::int)
                else s.expire_date end as e_s,
           case when extract(day from s.chronic_date) <= 12 and extract(day from s.chronic_date) <> extract(month from s.chronic_date)
                then make_date(extract(year from s.chronic_date)::int, extract(day from s.chronic_date)::int, extract(month from s.chronic_date)::int)
                else s.chronic_date end as c_s
  ) sw
  where s.disb_date is not null and s.expire_date is not null and s.chronic_date is not null and s.days_elapsed is not null
    and not (s.expire_date - s.disb_date = 91 and s.chronic_date - s.expire_date = 14
             and s.snapshot_date - s.disb_date - s.days_elapsed between 0 and 3)
),
one as (    -- the one reading that fits, for the rows where exactly one does
  select c.id, min(f.d) as d2, min(f.e) as e2, min(f.c) as c2
  from cand c
  cross join lateral (
    select distinct x.d, y.e, z.c
    from (values (c.d), (c.d_s)) x(d), (values (c.e), (c.e_s)) y(e), (values (c.c), (c.c_s)) z(c)
    where y.e - x.d = 91 and z.c - y.e = 14 and c.snapshot_date - x.d - c.de between 0 and 3
  ) f
  group by c.id
  having count(*) = 1
),
take as (   -- this run's rows
  select c.*, o.d2, o.e2, o.c2
  from cand c join one o on o.id = c.id
  order by c.snapshot_date, c.id
  limit (select max_rows from win)
),
lg as (
  insert into public.defaulter_last_known_repair_log (id, snapshot_date, snapshot_type, ref, team, disb_old, expire_old, chronic_old, disb_new, expire_new, chronic_new)
  select t.id, t.snapshot_date, t.snapshot_type, t.ref, t.team, t.d, t.e, t.c, t.d2, t.e2, t.c2 from take t
  on conflict (id) do nothing                -- a row's FIRST log line keeps the dates it was uploaded with
  returning id
),
upd as (
  update public.defaulter_snapshots s
     set disb_date = t.d2, expire_date = t.e2, chronic_date = t.c2
    from take t
   where s.id = t.id and s.disb_date = t.d and s.expire_date = t.e and s.chronic_date = t.c
  returning s.id
)
select (select count(*) from lk)                                     as last_known_rows_in_these_days,
       (select count(*) from cand)                                   as of_them_not_fitting,
       (select count(*) from one)                                    as one_reading_fits,
       (select count(*) from upd)                                    as repaired_now,
       (select count(*) from one) - (select count(*) from upd)       as still_to_do_run_again,
       (select count(*) from cand) - (select count(*) from one)      as left_alone_no_single_reading;

-- UNDO: take the two dashes off the three lines below, run them, and every row the log names goes back to the dates it was uploaded with.
-- update public.defaulter_snapshots s set disb_date = l.disb_old, expire_date = l.expire_old, chronic_date = l.chronic_old
--   from public.defaulter_last_known_repair_log l
--  where s.id = l.id and l.snapshot_date between date '2026-08-01' and date '2026-11-15';
