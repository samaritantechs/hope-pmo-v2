-- =====================================================================================
-- RUN-ME-066: THE LAST TRANS DATE OF THE DECKS, PUT RIGHT IN THE UPLOADS THAT WERE READ THE WRONG WAY ROUND (no re-upload)
--
--   "... we have last trans date column ..." -- the owner, 17 Nov 2026 (docs/HANDOFF.md Part 92: the dates, one matter at a time)
--
-- WHAT WAS WRONG. Until 16 Nov 2026 the defaulters upload read every date of a deck day-first, and the loan system writes them month-first
-- (docs/HANDOFF.md Part 84): wherever both numbers of a date were twelve or under, the day and the month were stored swapped. RUN-ME-060 puts
-- DISB DATE, EXPIRE DATE and CHRONIC DATE right, row by row, by the loan system's own pattern (91 days, 14 days, DAYS ELAPSED). LAST TRANS DATE
-- came in the same file, read the same way, and has no pattern of its own to be checked against, so RUN-ME-060 leaves it. This puts it right, and
-- ONLY where the upload itself proves that it was wrong. Nothing is guessed.
--
-- HOW IT KNOWS. An upload is every row written under one upload number, for one day and one kind of deck. The old reader decided for a whole
-- file, so an upload is swapped all through or right all through. An upload is changed ONLY WHEN IT HAS BOTH OF THESE PROOFS:
--   1. RUN-ME-060 put right at least three of its rows, and they are at least half of the rows of the upload that fit the loan system's pattern
--      (a real swapped file: about 80%). A few repaired rows in a file that was otherwise read right do not make it a swapped file.
--      This is why RUN-ME-060 is run first, for the same days: its log (defaulter_date_repair_log) is read here.
--   2. At least three of its rows carry a LAST TRANS DATE that is impossible as stored (before the loan was disbursed, or after the deck's own
--      day) and possible with day and month exchanged. The column itself shows the exchange; a file read right has no such date.
-- AND A ROW IS CHANGED ONLY WHEN its loan's three dates fit the pattern (so its DISB DATE is right), its LAST TRANS DATE has another reading
-- (day twelve or under, and not the same as the month), and that other reading lies between the DISB DATE and the deck's day. Left exactly as
-- they are: a row with no LAST TRANS DATE, a date with a day over twelve (it was read right), a day and month the same, a loan RUN-ME-060 could
-- not fix, and every row of an upload with no upload number. The answer counts each of those and lists EVERY upload with its verdict, so a row
-- that was left alone is never left alone in silence.
--
-- WHAT IT CHANGES: last_trans_date of defaulter_snapshots, and nothing else. EVERY ROW CHANGED is written to defaulter_last_trans_repair_log with
-- its old and new date; the undo is at the bottom, commented out. A changed row is in that log and is never changed twice, so this is SAFE TO RUN
-- AGAIN, and a run that stopped at the row limit is finished by running it again: RUN AGAIN UNTIL "still to do" SAYS 0. (A row's proof is read
-- from the date as it was uploaded, so what an earlier run changed does not take a proof away from the rest of its upload.)
--
-- THE DAYS. The first lines of the query name the days (the first, the last) and how many rows one run may change: the same days as the same
-- lines of db/RUN-ME-060, which is run first. A day is about 20,000 rows. After the undo, the rows stay in the log and are not changed again.
--
-- COST. It reads the deck rows of the days named (through the snapshot_date index) and both logs, and writes only the rows it changes. Nothing
-- on uploads, nothing on HOPE Calls: no code reads or waits for the log table. The run is cut off after 50 seconds and rolls back whole if it
-- is, and a 3-second lock limit keeps it from waiting behind an upload.
-- =====================================================================================
set local lock_timeout = '3s';
set local statement_timeout = '50s';
set local jit = off;

do $$
begin
  if to_regclass('public.defaulter_date_repair_log') is null then
    raise exception 'Run db/RUN-ME-060 first, for the same days: this file reads its log to know which uploads were read the wrong way round. Nothing was changed.';
  end if;
end $$;

create table if not exists public.defaulter_last_trans_repair_log (
  id uuid primary key,                       -- the deck row that was changed
  repaired_at timestamptz not null default now(),
  snapshot_date date, snapshot_type text, ref text, upload_batch uuid,
  last_trans_old date, last_trans_new date
);
alter table public.defaulter_last_trans_repair_log enable row level security;

with win as (
  select date '2026-11-16' as from_day,      -- CHANGE: the first day to repair (the same as RUN-ME-060)
         date '2026-11-16' as to_day,        -- CHANGE: the last day to repair (the same as RUN-ME-060)
         50000 as max_rows,                  -- one run changes at most this many rows
         3 as proof_rows                     -- how many rows prove an upload, in each of the two proofs
),
d as (    -- the deck rows of those days, with the Last trans date as the upload stored it (a row this file changed keeps its old date in the log) and the same date read the other way round
  select s.id, s.ref, s.snapshot_date as day, s.snapshot_type as typ, s.upload_batch as batch, s.disb_date as dd,
         z.lt0, (g.id is not null) as changed, (l.id is not null) as repaired,
         (s.disb_date is not null and s.expire_date is not null and s.chronic_date is not null and s.days_elapsed is not null
          and s.expire_date - s.disb_date = 91 and s.chronic_date - s.expire_date = 14
          and s.snapshot_date - s.disb_date - s.days_elapsed between 0 and 3) as fits,
         case when extract(day from z.lt0) <= 12 and extract(day from z.lt0) <> extract(month from z.lt0)
              then make_date(extract(year from z.lt0)::int, extract(day from z.lt0)::int, extract(month from z.lt0)::int)
              else z.lt0 end as lt0_sw
  from public.defaulter_snapshots s
  cross join win
  left join public.defaulter_date_repair_log l on l.id = s.id
  left join public.defaulter_last_trans_repair_log g on g.id = s.id
  cross join lateral (select coalesce(g.last_trans_old, s.last_trans_date) as lt0) z
  where s.snapshot_date between win.from_day and win.to_day
),
x as (    -- amb: the date has another reading. wit: its loan's dates fit, the date is impossible as stored, and possible the other way round (proof 2)
  select d.*, (d.lt0 is not null and d.lt0_sw <> d.lt0) as amb,
         (d.fits and d.lt0 is not null and d.lt0_sw <> d.lt0
          and not (d.lt0 between d.dd and d.day) and d.lt0_sw between d.dd and d.day) as wit
  from d
),
v as (    -- the uploads, and which of them are proven swapped
  select u.*, (u.batch is not null
               and u.n_rep >= (select proof_rows from win)
               and 2 * u.n_rep >= u.n_fit
               and u.n_wit >= (select proof_rows from win)) as swapped
  from (select batch, day, typ, count(*) as n,
               count(*) filter (where repaired) as n_rep,
               count(*) filter (where fits) as n_fit,
               count(*) filter (where wit) as n_wit
        from x group by batch, day, typ) u
),
xv as (select x.*, v.swapped from x join v on v.batch is not distinct from x.batch and v.day = x.day and v.typ = x.typ),
cand as ( -- the rows of the swapped uploads that have another reading and were not changed before
  select xv.* from xv where xv.swapped and xv.amb and not xv.changed
),
ok as (   -- the rows that can be changed: the loan's dates fit, and the other reading lies between the Disb date and the deck's day
  select c.* from cand c where c.fits and c.lt0_sw between c.dd and c.day
),
take as (select o.* from ok o order by o.day, o.id limit (select max_rows from win)),
lg as (
  insert into public.defaulter_last_trans_repair_log (id, snapshot_date, snapshot_type, ref, upload_batch, last_trans_old, last_trans_new)
  select t.id, t.day, t.typ, t.ref, t.batch, t.lt0, t.lt0_sw from take t
  on conflict (id) do nothing                -- a row's FIRST log line keeps the date it was uploaded with
  returning id
),
upd as (
  update public.defaulter_snapshots s set last_trans_date = t.lt0_sw
    from take t
   where s.id = t.id and s.last_trans_date = t.lt0
  returning s.id
)
select z.what, z.answer from (
  select 1 as ord, 'deck rows in these days' as what, to_char((select count(*) from x), 'FM999,999,999') as answer
  union all
  select 2, 'uploads in these days: found swapped / left alone',
         to_char((select count(*) from v where swapped), 'FM999,999,999') || ' / ' || to_char((select count(*) from v where not swapped), 'FM999,999,999')
  union all
  select 3, 'rows of the swapped uploads whose Last trans date has another reading, not changed yet', to_char((select count(*) from cand), 'FM999,999,999')
  union all
  select 4, '    of them, safe to change: the loan''s dates fit and the other reading lies between its Disb date and the deck''s day', to_char((select count(*) from ok), 'FM999,999,999')
  union all
  select 5, 'changed by THIS run', to_char((select count(*) from upd), 'FM999,999,999')
  union all
  select 6, 'still to do: run this file again until this says 0', to_char((select count(*) from ok) - (select count(*) from upd), 'FM999,999,999')
  union all
  select 7, 'left alone: the loan''s dates do not fit the pattern (restructured, no DAYS ELAPSED, or RUN-ME-060 not finished: run it again first)',
         to_char((select count(*) from cand where not fits), 'FM999,999,999')
  union all
  select 8, 'left alone: the other reading is not possible (before the Disb date or after the deck''s day)',
         to_char((select count(*) from cand where fits and not (lt0_sw between dd and day)), 'FM999,999,999')
  union all
  select 9, 'left alone: rows with another reading in uploads NOT found swapped (the list below says why)',
         to_char((select count(*) from xv where not swapped and amb and not changed), 'FM999,999,999')
  union all
  select 20 + row_number() over (order by v.day, v.typ::text, v.n desc, v.batch)::int,
         '    ' || v.day::text || ' ' || v.typ::text || ' ' || coalesce(left(v.batch::text, 8), 'no upload number'),
         to_char(v.n, 'FM999,999,999') || ' rows; RUN-ME-060 put right ' || to_char(v.n_rep, 'FM999,999,999') || '; '
         || to_char(v.n_wit, 'FM999,999,999') || ' show the exchange: '
         || case when v.batch is null then 'LEFT ALONE, no upload number on these rows'
                 when v.swapped then 'SWAPPED'
                 when v.n_rep = 0 then 'left alone, RUN-ME-060 put right none of it (read right, or not run for this day)'
                 when v.n_rep < (select proof_rows from win) or 2 * v.n_rep < v.n_fit then 'left alone, RUN-ME-060 put right too few of its rows to be sure of the whole upload'
                 else 'left alone, no Last trans date of it shows the exchange' end
  from v
) z
order by z.ord;

-- UNDO: take the two dashes off the three lines below, run them, and every row the log names goes back to the date it was uploaded with.
-- update public.defaulter_snapshots s set last_trans_date = l.last_trans_old
--   from public.defaulter_last_trans_repair_log l
--  where s.id = l.id and s.last_trans_date = l.last_trans_new and l.snapshot_date between date '2026-11-16' and date '2026-11-16';
