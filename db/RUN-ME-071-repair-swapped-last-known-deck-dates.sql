-- =====================================================================================
-- RUN-ME-071: THE SWAPPED DATES OF EACH CUSTOMER'S LAST-KNOWN DECK ROW, PUT RIGHT IN PLACE -- ONE DAY AT A TIME, WITH THE CLOCK ON
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
-- HOW IT RUNS. THE FIRST VERSION OF THIS FILE TIMED OUT ON THE LIVE BOOK ("upstream timeout", 17 Nov): it asked for the whole range in ONE statement, so the database had to
-- look at every deck row since August at once; that took 4 seconds on a test copy held in memory and it ran past what the SQL editor waits for on the live book
-- (docs/HANDOFF.md Part 106). THIS VERSION DOES ONE DAY AT A TIME, NEWEST DAY FIRST (the customers cleared lately are the ones the tab shows first), AND STOPS STARTING NEW
-- DAYS ONCE lk_seconds (10) HAVE PASSED. A day is its own ~11,000 current rows, read from one place, and about 500 lookups in the loan-number index: the work of a run is
-- the days it did, never the size of the book (a one-day run touches 3,000 to 6,000 pages of a 2.3-million-row book of 84,000 pages; the whole-range statement touched 172,000).
-- EVERY DAY IT FINISHES IS WRITTEN DOWN (defaulter_last_known_repair_days): the next run carries on from there.
--   >>> RUN THE SAME TEXT AGAIN, WITHOUT CHANGING ANYTHING, UNTIL THE ANSWER SAYS "FINISHED". <<<
-- A run always finishes the day it is on, so one run is a few seconds past lk_seconds at most. If a run is cut off ("canceling statement due to statement timeout", or the
-- editor gives up) it changed NOTHING of the day in hand and nothing after the last full run: run it again. If a run says it did many days and took only a few seconds, raise
-- lk_seconds (20 is safe for most books); if the editor ever gives up on a run, lower it (3).
--
-- THE FIRST LINES. lk_from_day and lk_to_day name the days of the LAST-KNOWN rows to repair (the whole range since August, to begin with); lk_apply 'no' COUNTS without
-- changing anything and without writing anything down (it looks at the same days each time: it is for seeing the first days, not the whole range).
-- NEVER AT THE SAME MOMENT AS RUN-ME-060 OR RUN-ME-066, or while an upload is being written: they write the same table.
--
-- UNDO. Every row changed is written to defaulter_last_known_repair_log with its old and new dates (a log of its own: RUN-ME-066 reads RUN-ME-060's, and rows put right
-- here are not days put right). The undo is at the bottom, commented out.
--
-- COST. A day reads the current rows of that day, the keys of the next deck day (the customers who are on it are not the last-known row: no lookup for them), and, for the
-- few hundred customers who are not, one look into the (loan number, day) index for each; it writes only the rows it changes. Nothing on uploads, nothing on HOPE Calls: no
-- code reads the two small tables this file makes, and no code waits for it. The whole script is cut off after 30 seconds and rolls back whole if it is.
-- =====================================================================================
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local jit = off;
set local plan_cache_mode = 'force_custom_plan';        -- every day is planned for its own two dates
set local enable_seqscan = off;                         -- a day is read through the day index, never by reading the whole table
set local hope.lk_from_day = '2026-08-01';              -- CHANGE: the first day of the last-known rows to repair (the whole range since August, to begin with)
set local hope.lk_to_day = '2026-11-15';                -- CHANGE: the last day (the uploads from 16 Nov were read right)
set local hope.lk_seconds = '10';                       -- CHANGE: a run starts no new day after this many seconds
set local hope.lk_apply = 'yes';                        -- CHANGE: 'no' counts only: nothing is changed and nothing is written down

create table if not exists public.defaulter_last_known_repair_log (
  id uuid primary key,                       -- the deck row that was changed
  repaired_at timestamptz not null default now(),
  snapshot_date date, snapshot_type text, ref text, team text,
  disb_old date, expire_old date, chronic_old date,
  disb_new date, expire_new date, chronic_new date
);
alter table public.defaulter_last_known_repair_log enable row level security;
create table if not exists public.defaulter_last_known_repair_days (
  day date primary key,                      -- a day whose last-known rows have been looked at (and put right where one reading fits)
  done_at timestamptz not null default now(),
  last_known integer not null, not_fitting integer not null, one_reading integer not null, repaired integer not null
);
alter table public.defaulter_last_known_repair_days enable row level security;
create temp table lk_run (day date, last_known integer, not_fitting integer, one_reading integer, repaired integer) on commit drop;

do $lk$
declare
  v_from date := current_setting('hope.lk_from_day')::date;
  v_to date := current_setting('hope.lk_to_day')::date;
  v_secs numeric := current_setting('hope.lk_seconds')::numeric;
  v_apply boolean := lower(btrim(current_setting('hope.lk_apply'))) in ('yes', 'on', 'true', '1');
  v_start timestamptz := clock_timestamp();
  v_day date;
  v_next date;
  v_lk bigint; v_cand bigint; v_one bigint; v_upd bigint;
begin
  for v_day in select g::date from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') g order by 1 desc loop
    continue when exists (select 1 from public.defaulter_last_known_repair_days p where p.day = v_day);
    -- the next day that has a current deck at all: a customer on it is not at the end of their run
    select min(s.snapshot_date) into v_next from public.defaulter_snapshots s where s.snapshot_type = 'current' and s.snapshot_date > v_day;
with nx as materialized (   -- who is on the next deck
  select x.ref, x.team
  from public.defaulter_snapshots x
  where x.snapshot_type = 'current' and x.snapshot_date = v_next
),
gone as materialized (   -- the day's current rows of customers who are NOT on the next deck: the only ones that can be the last
  select s.id, s.ref, s.team, s.snapshot_date, s.snapshot_type, s.days_elapsed, s.disb_date, s.expire_date, s.chronic_date, s.created_at
  from public.defaulter_snapshots s
  where s.snapshot_type = 'current' and s.snapshot_date = v_day
    and not exists (select 1 from nx where nx.ref = s.ref and nx.team is not distinct from s.team)
),
lk as (   -- the LAST-KNOWN rows: no newer current row of the same team and loan number, on a later day or the same day written later (one look into the (loan number, day) index for each row)
  select g.id, g.ref, g.team, g.snapshot_date, g.snapshot_type, g.days_elapsed, g.disb_date, g.expire_date, g.chronic_date
  from gone g
  left join lateral (
    select 1 as newer
    from public.defaulter_snapshots n
    where n.ref = g.ref and n.snapshot_date >= g.snapshot_date and n.snapshot_type = 'current' and n.team is not distinct from g.team
      and (n.snapshot_date > g.snapshot_date or n.created_at > g.created_at)
    limit 1
  ) h on true
  where h.newer is null
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
take as (   -- this day's rows (none when only counting)
  select c.*, o.d2, o.e2, o.c2
  from cand c join one o on o.id = c.id
  where v_apply
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
select (select count(*) from lk), (select count(*) from cand), (select count(*) from one), (select count(*) from upd)
  into v_lk, v_cand, v_one, v_upd;
    insert into lk_run values (v_day, v_lk, v_cand, v_one, v_upd);
    if v_apply then
      insert into public.defaulter_last_known_repair_days (day, last_known, not_fitting, one_reading, repaired) values (v_day, v_lk, v_cand, v_one, v_upd);
    end if;
    -- the day in hand is finished; start another only while the clock is inside the run's time
    exit when clock_timestamp() - v_start > make_interval(secs => v_secs);
  end loop;
end
$lk$;

select (select count(*) from lk_run)                                                                              as days_done_in_this_run,
       (select min(day) from lk_run)                                                                              as oldest_day_done,
       (select coalesce(sum(last_known), 0) from lk_run)                                                          as last_known_rows,
       (select coalesce(sum(not_fitting), 0) from lk_run)                                                         as of_them_not_fitting,
       (select coalesce(sum(one_reading), 0) from lk_run)                                                         as one_reading_fits,
       (select coalesce(sum(repaired), 0) from lk_run)                                                            as repaired_now,
       (select coalesce(sum(not_fitting - one_reading), 0) from lk_run)                                           as left_alone_no_single_reading,
       (current_setting('hope.lk_to_day')::date - current_setting('hope.lk_from_day')::date + 1)
         - (select count(*) from public.defaulter_last_known_repair_days d
             where d.day between current_setting('hope.lk_from_day')::date and current_setting('hope.lk_to_day')::date)  as days_still_to_do,
       case when lower(btrim(current_setting('hope.lk_apply'))) not in ('yes', 'on', 'true', '1')
              then 'COUNT ONLY: nothing was changed or written down'
            when (current_setting('hope.lk_to_day')::date - current_setting('hope.lk_from_day')::date + 1)
                 = (select count(*) from public.defaulter_last_known_repair_days d
                     where d.day between current_setting('hope.lk_from_day')::date and current_setting('hope.lk_to_day')::date)
              then 'FINISHED: every day of the window is done'
            else 'RUN THE SAME TEXT AGAIN' end                                                                    as what_next;

-- UNDO: take the two dashes off the lines below, run them, and every row the log names goes back to the dates it was uploaded with; the last line makes a later run look at every day again.
-- update public.defaulter_snapshots s set disb_date = l.disb_old, expire_date = l.expire_old, chronic_date = l.chronic_old
--   from public.defaulter_last_known_repair_log l
--  where s.id = l.id and l.snapshot_date between date '2026-08-01' and date '2026-11-15';
-- delete from public.defaulter_last_known_repair_days where day between date '2026-08-01' and date '2026-11-15';
