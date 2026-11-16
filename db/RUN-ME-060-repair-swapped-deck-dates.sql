-- =====================================================================================
-- RUN-ME-060: THE SWAPPED DATES ON THE DEFAULTER DECKS, PUT RIGHT IN PLACE (no re-upload)
--
--   "we cant re-upload now - i hope the system autoupdates whats right brother" -- the owner, 16 Nov 2026
--
-- WHAT IT DOES. Until 16 Nov 2026 the upload read the loan system's month-first dates day-first
-- (docs/HANDOFF.md Part 84): wherever both numbers of a date were twelve or under, the day and the
-- month were stored swapped. Files uploaded now are read right; this puts right what was stored
-- before. It changes DISB DATE, EXPIRE DATE and CHRONIC DATE of defaulter deck rows, and nothing else.
--
-- HOW IT KNOWS. Two things the date bug never touched, and the loan system's own pattern:
--   * DAYS ELAPSED is a plain number. On the real defaulters file of 16 Nov 2026, the days from the
--     disbursement date to the deck's day, minus DAYS ELAPSED, is exactly 2 for 10,372 of 10,372
--     loans (1 or 2 on the other decks of the loan the owner asked about). So it names the real
--     disbursement date to within a few days, while a swapped date is at least 27 days away from it.
--   * A loan expires 91 days after it was disbursed and turns chronic 14 days after it expires: also
--     10,372 of 10,372, disbursed from April 2024 to November 2026.
-- A row is changed ONLY WHEN
--   (1) its three dates, as stored, do NOT fit all of that, and
--   (2) exactly ONE reading of them fits all of it (each date as stored, or with its day and month
--       exchanged), the disbursement date being 0 to 3 days from what DAYS ELAPSED says.
-- Everything else is left exactly as it is: a restructured loan whose expiry was moved, a row with a
-- missing date or no DAYS ELAPSED, a row where no reading fits or two do. Nothing is guessed.
-- Tried on what the old importer stored for that real file: 8,296 loans had a wrong date; all 8,296
-- were put right to what the file says, none was changed wrongly, and the 2,076 whose dates were
-- already right were left alone. Tried on loans made to break the pattern: none was changed wrongly.
--
-- WHAT IT CANNOT DO. LAST TRANS DATE was swapped the same way and has no pattern to check it
-- against, so it is NOT repaired here. The Current file uploaded each evening, and every file from
-- now on, carries it right (and refreshes the Follow-up list).
--
-- THE DAYS. The first lines of the query name the days to repair (today, to begin with) and how many
-- rows one run may change. To repair the week before, change the first date and run again. RUN AGAIN
-- UNTIL "still_to_do_run_again" SAYS 0. A day is about 20,000 rows. SAFE TO RUN AGAIN: a repaired row
-- fits the pattern and is never touched twice.
--
-- UNDO. Every row changed is written to defaulter_date_repair_log with its old and new dates. The
-- undo is at the bottom, commented out.
--
-- COST. It reads the deck rows of the days named (through the snapshot_date index) and writes only the
-- rows it changes. Nothing on uploads, nothing on HOPE Calls: no code reads the log table, and no
-- code waits for this script. The run is cut off after 50 seconds and rolls back whole if it is.
-- (docs/HANDOFF.md Part 86.)
-- =====================================================================================
set local lock_timeout = '3s';
set local statement_timeout = '50s';
set local jit = off;

create table if not exists public.defaulter_date_repair_log (
  id uuid primary key,                       -- the deck row that was changed
  repaired_at timestamptz not null default now(),
  snapshot_date date, snapshot_type text, ref text,
  disb_old date, expire_old date, chronic_old date,
  disb_new date, expire_new date, chronic_new date
);
alter table public.defaulter_date_repair_log enable row level security;

with win as (
  select date '2026-11-16' as from_day,      -- CHANGE: the first day to repair
         date '2026-11-16' as to_day,        -- CHANGE: the last day to repair
         20000 as max_rows                   -- one run changes at most this many rows
),
cand as (   -- the deck rows of those days whose three dates, as stored, do not fit the pattern; and each date with day and month exchanged
  select s.id, s.ref, s.snapshot_date, s.snapshot_type, s.days_elapsed as de, s.disb_date as d, s.expire_date as e, s.chronic_date as c, sw.d_s, sw.e_s, sw.c_s
  from public.defaulter_snapshots s
  cross join win
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
  where s.snapshot_date between win.from_day and win.to_day
    and s.disb_date is not null and s.expire_date is not null and s.chronic_date is not null and s.days_elapsed is not null
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
  insert into public.defaulter_date_repair_log (id, snapshot_date, snapshot_type, ref, disb_old, expire_old, chronic_old, disb_new, expire_new, chronic_new)
  select t.id, t.snapshot_date, t.snapshot_type, t.ref, t.d, t.e, t.c, t.d2, t.e2, t.c2 from take t
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
select (select count(*) from cand)                                   as not_fitting_in_these_days,
       (select count(*) from one)                                    as one_reading_fits,
       (select count(*) from upd)                                    as repaired_now,
       (select count(*) from one) - (select count(*) from upd)       as still_to_do_run_again,
       (select count(*) from cand) - (select count(*) from one)      as left_alone_no_single_reading;

-- UNDO: take the two dashes off the three lines below, run them, and every row the log names goes back to the dates it was uploaded with.
-- update public.defaulter_snapshots s set disb_date = l.disb_old, expire_date = l.expire_old, chronic_date = l.chronic_old
--   from public.defaulter_date_repair_log l
--  where s.id = l.id and l.snapshot_date between date '2026-11-16' and date '2026-11-16';
