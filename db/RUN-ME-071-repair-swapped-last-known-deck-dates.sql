-- =====================================================================================
-- RUN-ME-071: THE SWAPPED DATES OF EACH CUSTOMER'S LAST-KNOWN DECK ROW, PUT RIGHT IN PLACE -- TEAM BY TEAM, LOOKING ONLY AT EACH LOAN NUMBER'S NEWEST ROW
--
--   "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong ... When we finish disb dates ..." -- the owner, 17 Nov 2026
--   "Don't clean owner role, recycling leader & cycle for 'cleared' customers at expected defaulters because the disb date still gives us where to place them
--    for the 3 columns - we need those 3 filled for followup purposes" -- the owner, 16 Nov 2026
--   "Days still to do is reducing 2 or 3 per run.. Ill go for to long bro" -- the owner, 17 Nov 2026, on the day-by-day form
--
-- WHAT IS WRONG. Until 16 Nov 2026 the upload read the loan system's month-first dates day-first (docs/HANDOFF.md Part 84), so four deck rows in five carry a
-- Disb, Expire and Chronic date with the day and the month swapped (RUN-ME-060). A customer who is no longer on any deck is shown on the Expected Defaulters tab as
-- CLEARED from THEIR LAST-KNOWN ROW (RUN-ME-055, Part 71: the newest current row of the customer), and that row's Disb date is what places them on a cycle day, a
-- recycling leader and a week. Those rows are spread over every day since August: putting them right the day-by-day way (RUN-ME-060 over every day, about two million
-- rows, dozens of runs) is the long road to the same place.
--
-- WHAT IT DOES. It changes DISB DATE, EXPIRE DATE and CHRONIC DATE of THE LAST-KNOWN ROW OF EACH CUSTOMER AND OF NO OTHER ROW, by exactly RUN-ME-060's rule:
--   * a row is the LAST-KNOWN row when it is the NEWEST CURRENT row of its customer (the same team and loan number): the newest day, and on that day the one written
--     last. The same choice RUN-ME-055's function makes.
--   * the rule is RUN-ME-060's, word for word: DAYS ELAPSED and the loan system's own pattern (a loan expires 91 days after it was disbursed and turns chronic 14 days
--     after it expires; DAYS ELAPSED is the days from the disbursement to the deck's day, less 0 to 3). A row is changed ONLY WHEN its three dates as stored do NOT fit
--     that and EXACTLY ONE reading of them (each date as stored, or with its day and month exchanged) fits all of it. A restructured loan, a row with a date or DAYS
--     ELAPSED missing, a row where no reading fits or two do: left as it is. Nothing is guessed.
-- It does not touch an INITIAL row, a row that is not its customer's newest, LAST TRANS DATE or anything else. A customer still on the latest deck has a newest row that
-- was written right: nothing to do for them.
--
-- HOW IT RUNS. THE FIRST FORM OF THIS FILE TIMED OUT ON THE LIVE BOOK ("upstream timeout", 17 Nov): one statement over the whole range, a pass over the deck table
-- (docs/HANDOFF.md Part 106). THE SECOND FORM WENT DAY BY DAY: it ran, but a day cost about 3 seconds on the live book (a day's rows are not together on disk), so a run
-- of 10 seconds did 3 days and 104 were to do (Part 108). THIS FORM GOES TEAM BY TEAM AND NEVER READS A DAY: for each team it walks that team's loan numbers through the
-- (team, loan number) index, which reads no rows at all, and for each loan number it asks the (loan number, day) index for the newest current row, which is one or two
-- rows. The work is the loan numbers of a team (a few hundred) and not the 10,000 rows of a day: on a test book of 2.27 million rows laid out WORST (one row to a page,
-- the way a day's rows may lie on the live book) the day-by-day form fetched 2.16 million table pages for the whole window and this form 0.15 million, and cold it took
-- 4.5 s where the day-by-day form took 14.9 s on the same machine. How long it is on the live book is NOT KNOWN: THE ANSWER SAYS HOW MANY SECONDS THE RUN TOOK.
-- A run starts no new team once lk_seconds (15) have passed, and EVERY TEAM IT FINISHES IS WRITTEN DOWN (defaulter_last_known_repair_teams), so the next run carries on.
--   >>> RUN THE SAME TEXT AGAIN, WITHOUT CHANGING ANYTHING, UNTIL THE ANSWER SAYS "FINISHED". <<<
-- A run always finishes the team it is on, so one run is a few seconds past lk_seconds at most. If a run is cut off ("canceling statement due to statement timeout", or the
-- editor gives up) it changed NOTHING of the team in hand and nothing after the last full run: run it again. If the answer says it took far less than lk_seconds and
-- teams are still to do, raise lk_seconds (25 is safe for most books); if the editor ever gives up on a run, lower it (8).
--
-- THE FIRST LINES. lk_from_day and lk_to_day name the days of the LAST-KNOWN rows to repair (the whole range since August, to begin with); lk_apply 'no' COUNTS without
-- changing anything and without writing anything down (it looks at the same teams each time: it is for seeing the first teams, not the whole book).
-- NEEDS idx_def_snap_team_ref (RUN-ME-055, run on 14 Nov): the file stops with a plain message, changing nothing, when it is missing.
-- NEVER AT THE SAME MOMENT AS RUN-ME-060 OR RUN-ME-066, or while an upload is being written: they write the same table.
--
-- UNDO. Every row changed is written to defaulter_last_known_repair_log with its old and new dates (a log of its own: RUN-ME-066 reads RUN-ME-060's, and rows put right
-- here are not days put right). The undo is at the bottom, commented out. (The table of days the second form made, defaulter_last_known_repair_days, is no longer
-- used; it holds three rows and is harmless.)
--
-- COST. For each team: one walk of its loan numbers in the (team, loan number) index, and one look into the (loan number, day) index for each, which reads the loan
-- number's newest current row; it writes only the rows it changes. Nothing on uploads, nothing on HOPE Calls: no code reads the two small tables this file makes,
-- and no code waits for it. The whole script is cut off after 30 seconds and rolls back whole if it is.
-- =====================================================================================
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local jit = off;
set local plan_cache_mode = 'force_custom_plan';        -- every team is planned for its own name
set local enable_seqscan = off;                         -- the deck table is read through its indexes, never end to end
set local enable_bitmapscan = off;                      -- a loan number's newest row is found by walking its index entries backward, never by collecting all of them (53 rows a loan number)
set local hope.lk_from_day = '2026-08-01';              -- CHANGE: the first day of the last-known rows to repair (the whole range since August, to begin with)
set local hope.lk_to_day = '2026-11-15';                -- CHANGE: the last day (the uploads from 16 Nov were read right)
set local hope.lk_seconds = '15';                       -- CHANGE: a run starts no new team after this many seconds
set local hope.lk_apply = 'yes';                        -- CHANGE: 'no' counts only: nothing is changed and nothing is written down

create table if not exists public.defaulter_last_known_repair_log (
  id uuid primary key,                       -- the deck row that was changed
  repaired_at timestamptz not null default now(),
  snapshot_date date, snapshot_type text, ref text, team text,
  disb_old date, expire_old date, chronic_old date,
  disb_new date, expire_new date, chronic_new date
);
alter table public.defaulter_last_known_repair_log enable row level security;
create table if not exists public.defaulter_last_known_repair_teams (
  team text primary key,                     -- a team whose loan numbers' newest rows have been looked at ('(NO TEAM)': the rows that name none)
  done_at timestamptz not null default now(),
  from_day date not null, to_day date not null,
  loan_numbers integer not null, last_known integer not null, not_fitting integer not null, one_reading integer not null, repaired integer not null
);
alter table public.defaulter_last_known_repair_teams enable row level security;
create temp table lk_run (n integer, team text, loan_numbers integer, last_known integer, not_fitting integer, one_reading integer, repaired integer, seconds numeric) on commit drop;
create temp table lk_rows (id uuid, ref text, team text, snapshot_date date, snapshot_type text, days_elapsed integer, disb_date date, expire_date date, chronic_date date) on commit drop;

do $lk$
declare
  v_from date := current_setting('hope.lk_from_day')::date;
  v_to date := current_setting('hope.lk_to_day')::date;
  v_secs numeric := current_setting('hope.lk_seconds')::numeric;
  v_apply boolean := lower(btrim(current_setting('hope.lk_apply'))) in ('yes', 'on', 'true', '1');
  v_start timestamptz := clock_timestamp();
  v_team text;
  v_t0 timestamptz;
  v_refs bigint; v_lk bigint; v_cand bigint; v_one bigint; v_upd bigint;
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'defaulter_snapshots' and indexname = 'idx_def_snap_team_ref') then
    raise exception 'idx_def_snap_team_ref is missing: run RUN-ME-055 (its section 2, alone) first. Nothing was changed.';
  end if;
  for v_team in select t.team from public.teams t union all select null::text order by 1 loop
    continue when exists (select 1 from public.defaulter_last_known_repair_teams p
                           where p.team = coalesce(v_team, '(NO TEAM)') and p.from_day <= v_from and p.to_day >= v_to);
    v_t0 := clock_timestamp();
    delete from lk_rows;
    -- THE TEAM'S LOAN NUMBERS, one at a time through the (team, loan number) index (no row is read), and for each the NEWEST CURRENT ROW of that customer: one look into the
    -- (loan number, day) index, newest day first and on that day the row written last. The team is compared as `s.team || ''` so that the look cannot choose the
    -- (team, loan number) index and read every row of the loan number to sort them.
    if v_team is not null then
      with recursive walk as (
        (select d.ref from public.defaulter_snapshots d where d.team = v_team order by d.ref limit 1)
        union all
        select (select d2.ref from public.defaulter_snapshots d2 where d2.team = v_team and d2.ref > w.ref order by d2.ref limit 1)
        from walk w where w.ref is not null
      ),
      got as (
        select n.id, n.ref, n.team, n.snapshot_date, n.snapshot_type, n.days_elapsed, n.disb_date, n.expire_date, n.chronic_date
        from walk w
        cross join lateral (
          select s.id, s.ref, s.team, s.snapshot_date, s.snapshot_type, s.days_elapsed, s.disb_date, s.expire_date, s.chronic_date
          from public.defaulter_snapshots s
          where s.ref = w.ref and (s.team || '') = v_team and s.snapshot_type = 'current'
          order by s.snapshot_date desc, s.created_at desc
          limit 1
        ) n
        where w.ref is not null
      ),
      ins as (insert into lk_rows select * from got returning 1)
      select (select count(*) from walk where ref is not null), (select count(*) from ins) into v_refs, v_lk;
    else
      with recursive walk as (
        (select d.ref from public.defaulter_snapshots d where d.team is null order by d.ref limit 1)
        union all
        select (select d2.ref from public.defaulter_snapshots d2 where d2.team is null and d2.ref > w.ref order by d2.ref limit 1)
        from walk w where w.ref is not null
      ),
      got as (
        select n.id, n.ref, n.team, n.snapshot_date, n.snapshot_type, n.days_elapsed, n.disb_date, n.expire_date, n.chronic_date
        from walk w
        cross join lateral (
          select s.id, s.ref, s.team, s.snapshot_date, s.snapshot_type, s.days_elapsed, s.disb_date, s.expire_date, s.chronic_date
          from public.defaulter_snapshots s
          where s.ref = w.ref and s.team is null and s.snapshot_type = 'current'
          order by s.snapshot_date desc, s.created_at desc
          limit 1
        ) n
        where w.ref is not null
      ),
      ins as (insert into lk_rows select * from got returning 1)
      select (select count(*) from walk where ref is not null), (select count(*) from ins) into v_refs, v_lk;
    end if;
with lk as (   -- the LAST-KNOWN rows of this team that lie in the window: the newest current row of a customer, when it is on a day of the window
  select r.id, r.ref, r.team, r.snapshot_date, r.snapshot_type, r.days_elapsed, r.disb_date, r.expire_date, r.chronic_date
  from lk_rows r
  where r.snapshot_date between v_from and v_to
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
take as (   -- this team's rows (none when only counting)
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
    insert into lk_run values ((select count(*) + 1 from lk_run), coalesce(v_team, '(NO TEAM)'), v_refs, v_lk, v_cand, v_one, v_upd, extract(epoch from clock_timestamp() - v_t0));
    if v_apply then
      insert into public.defaulter_last_known_repair_teams (team, from_day, to_day, loan_numbers, last_known, not_fitting, one_reading, repaired)
      values (coalesce(v_team, '(NO TEAM)'), v_from, v_to, v_refs, v_lk, v_cand, v_one, v_upd)
      on conflict (team) do update set done_at = now(), from_day = excluded.from_day, to_day = excluded.to_day, loan_numbers = excluded.loan_numbers,
        last_known = excluded.last_known, not_fitting = excluded.not_fitting, one_reading = excluded.one_reading, repaired = excluded.repaired;
    end if;
    -- the team in hand is finished; start another only while the clock is inside the run's time
    exit when clock_timestamp() - v_start > make_interval(secs => v_secs);
  end loop;
end
$lk$;

select (select count(*) from lk_run)                                                                              as teams_done_in_this_run,
       (select r.team from lk_run r order by r.n desc limit 1)                                                    as last_team_done,
       (select coalesce(sum(loan_numbers), 0) from lk_run)                                                        as loan_numbers_looked_at,
       (select coalesce(sum(last_known), 0) from lk_run)                                                          as last_known_rows,
       (select coalesce(sum(not_fitting), 0) from lk_run)                                                         as of_them_not_fitting,
       (select coalesce(sum(one_reading), 0) from lk_run)                                                         as one_reading_fits,
       (select coalesce(sum(repaired), 0) from lk_run)                                                            as repaired_now,
       (select coalesce(sum(not_fitting - one_reading), 0) from lk_run)                                           as left_alone_no_single_reading,
       (select count(*) from (select t.team from public.teams t union all select null::text) u
         where not exists (select 1 from public.defaulter_last_known_repair_teams p
                            where p.team = coalesce(u.team, '(NO TEAM)')
                              and p.from_day <= current_setting('hope.lk_from_day')::date and p.to_day >= current_setting('hope.lk_to_day')::date))   as teams_still_to_do,
       (select round(coalesce(sum(seconds), 0), 1) from lk_run)                                                   as seconds_this_run,
       case when lower(btrim(current_setting('hope.lk_apply'))) not in ('yes', 'on', 'true', '1')
              then 'COUNT ONLY: nothing was changed or written down'
            when not exists (select 1 from (select t.team from public.teams t union all select null::text) u
                              where not exists (select 1 from public.defaulter_last_known_repair_teams p
                                                 where p.team = coalesce(u.team, '(NO TEAM)')
                                                   and p.from_day <= current_setting('hope.lk_from_day')::date and p.to_day >= current_setting('hope.lk_to_day')::date))
              then 'FINISHED: every team is done'
            else 'RUN THE SAME TEXT AGAIN' end                                                                    as what_next;

-- UNDO: take the two dashes off the lines below, run them, and every row the log names goes back to the dates it was uploaded with; the last line makes a later run look at every team again.
-- update public.defaulter_snapshots s set disb_date = l.disb_old, expire_date = l.expire_old, chronic_date = l.chronic_old
--   from public.defaulter_last_known_repair_log l
--  where s.id = l.id and l.snapshot_date between date '2026-08-01' and date '2026-11-15';
-- delete from public.defaulter_last_known_repair_teams;
