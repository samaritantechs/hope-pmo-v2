-- =====================================================================================
-- RUN-ME-061: EVERY UPLOAD OF THE DEFAULTER DECKS, AND HOW ITS DATES CAME OUT. READ-ONLY: changes nothing.
--
--   "They might be in different orders per file so check starting with the defaulters one I sent" -- the owner, 16 Nov 2026
--
-- WHAT IT ANSWERS. The probe for one loan showed it stored with its disbursement date one way on some
-- days' decks (7 September) and the other way on others (9 July). The loan system writes every file
-- month-first, so the files do not differ in order; they differ in HOW THEY ARRIVED (docs/HANDOFF.md
-- Part 90). This reads the book itself, one row per upload (a day, a kind, and the batch its rows
-- were written under), and says for each how many of its customers' dates fit the loan system's own
-- pattern as stored, and how the D.S column came out. The pattern is RUN-ME-060's, word for word: a loan
-- expires 91 days after it was disbursed, turns chronic 14 days after that, and DAYS ELAPSED is
-- the days from disbursement to the deck's day less 1 or 2 (0 to 3 allowed).
--
-- HOW TO READ A ROW (the three kinds of upload there are in the book):
--   fit_as_stored about all, ds_datelike 0         read right: uploaded after the fix, or the book was repaired.
--   fit_only_if_swapped about all                   the loan system's Excel file, read day-first by the old
--                                                   importer: day and month stored swapped. db/RUN-ME-060 puts it right.
--   fit_as_stored about all, ds_datelike about all  a CSV on the old page: the page's own reader turned the text
--                                                   into dates month-first (right, by luck) and spoilt D.S into a
--                                                   date ("7-12" became "7/12/01"). The dates are right; D.S is not.
--   neither                                         restructured loans (their dates were moved on purpose), rows with a
--                                                   missing date or DAYS ELAPSED: left alone by RUN-ME-060 too.
--   On the real file of 16 Nov 2026 (10,372 loans) read the old way, fit_as_stored comes out 2,076 and
--   fit_only_if_swapped 8,296 for the 16 Nov initial upload, if all its rows are in the book.
--
-- THE DAYS. The first lines name the days (the last seven, to begin with). Change the two dates for more:
-- a day is some 20,000 rows per upload kind, read through the snapshot_date index, so two weeks is a few seconds.
-- COST. A read of the deck rows of those days; nothing is written, nothing waits for it, nothing on uploads or on HOPE Calls.
-- =====================================================================================
set local jit = off;

with win as (
  select date '2026-11-10' as from_day,      -- CHANGE: the first day to look at
         date '2026-11-16' as to_day         -- CHANGE: the last day to look at
),
r as (      -- every deck row of those days, with each of its three dates also read with day and month exchanged
  select s.snapshot_date, s.snapshot_type, s.upload_batch, s.created_at, s.ds, s.days_elapsed,
         s.disb_date as d, s.expire_date as e, s.chronic_date as c, sw.d_s, sw.e_s, sw.c_s
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
),
f as (      -- each row: does it fit the pattern as stored, or only with its dates exchanged?
  select r.*,
         (r.d is not null and r.e is not null and r.c is not null and r.days_elapsed is not null) as complete,
         (r.e - r.d = 91 and r.c - r.e = 14 and r.snapshot_date - r.d - r.days_elapsed between 0 and 3) as fits,
         (r.e_s - r.d_s = 91 and r.c_s - r.e_s = 14 and r.snapshot_date - r.d_s - r.days_elapsed between 0 and 3) as fits_swapped
  from r
)
select to_char(snapshot_date, 'YYYY-MM-DD Dy')                                                     as day,
       snapshot_type                                                                               as kind,
       to_char(min(created_at) at time zone 'Africa/Dar_es_Salaam', 'HH24:MI')                     as uploaded,
       left(coalesce(upload_batch, 'legacy'), 8)                                                   as batch,
       count(*)                                                                                    as rows,
       count(*) filter (where fits)                                                                as fit_as_stored,
       count(*) filter (where complete and not fits and fits_swapped)                              as fit_only_if_swapped,
       count(*) filter (where complete and not fits and not fits_swapped)                          as neither,
       count(*) filter (where not complete)                                                        as missing_a_date_or_days,
       count(*) filter (where ds ~ '^\d{1,2}\s*[-/]\s*\d{1,2}$')                                   as ds_pair,
       count(*) filter (where ds ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$')                              as ds_datelike,
       count(*) filter (where ds is not null and ds !~ '^\d{1,2}\s*[-/]\s*\d{1,2}(\s*[-/]\s*\d{2,4})?$') as ds_other
from f
group by snapshot_date, snapshot_type, upload_batch
order by snapshot_date desc, snapshot_type, min(created_at) desc;
