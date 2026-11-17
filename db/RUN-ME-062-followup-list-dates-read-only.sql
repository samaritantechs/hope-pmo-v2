-- =====================================================================================
-- RUN-ME-062: THE FOLLOW-UP LIST'S DATES. IS ANY "DISB DATE" LATER THAN TODAY? READ-ONLY: changes nothing.
--
--   "In the defaulter followup nav, try check if there exists any future date than today in the disb date
--    column to confirm all dates are okay" -- the owner, 16 Nov 2026
--
-- WHAT IT READS. One table: followup_status, the register behind the Follow-up tab (and the phone's Defaulters
-- list). The tab lists a customer with a status or arrears; the rest are placeholders and settled customers
-- the tab never shows (api/_lib/portal-core.js, followup()). The register is a COPY: every Current defaulters
-- deck writes its customers' Disb date, Last trans and DAYS ELAPSED into it as the file stood at upload, and
-- stamps the row with the deck's day (deck_date). db/RUN-ME-060 put the decks' rows right and does not reach
-- this copy (docs/HANDOFF.md Part 91).
--
-- THE FIRST TEST (what was asked). A loan is not disbursed tomorrow, so a Disb date later than today is wrong.
-- The old importer read the loan system's month-first dates day-first, so 12 Jan 2026 was stored as 1 Dec 2026.
-- It lists how many there are, the earliest and latest, whether a swap of day and month puts them in the past,
-- and a few examples (the loan number and team, no names).
--
-- WHY IT IS NOT ENOUGH ON ITS OWN. Of a swapped 2026 date only the 12th of a month lands in the future, and
-- no 2024 or 2025 date ever does; the other swapped dates stay in the past and look fine. "None later than today"
-- therefore does not prove the column is right.
--
-- THE SECOND TEST (the one that confirms). The row carries three facts that must agree: the day of the deck that
-- wrote it, the Disb date, and the loan system's own DAYS ELAPSED. The loan system computes DAYS ELAPSED from the real
-- disbursement date, so  deck day - Disb date - DAYS ELAPSED  is 0 to 3 for a right date (RUN-ME-060's witness) and at least
-- 27 days off for a swapped one. Each row is sorted into: fits as stored / fits ONLY with day and month exchanged
-- (a swapped date) / fits neither (a restructured loan, or a row the Followup sheet wrote last). It is made for rows stamped by a deck only.
--
-- LAST TRANS gets the first test as well (a payment cannot be later than today): not asked, but the same mistake sits in
-- that column and nothing repairs it by pattern.
--
-- THE ANSWER LINE says "all right" only when no date is later than today AND the second test found no swapped date.
--
-- THE DECK STAMP column (deck_date) came from an optional migration (db/migrations/2026-08-04-followup-deck-date.sql).
-- It is read through to_jsonb(), so this file runs on a book with it and on a book without it; on the second the
-- second test says it could not be made. "Today" is the East Africa date.
--
-- COST. One pass over the register: about two seconds for 60,000 rows on the test machine (most of it is reading the optional
-- deck_date column in a way that cannot fail), nothing written, no lock beyond a read, a 30-second ceiling; nothing on uploads
-- or on HOPE Calls.
-- =====================================================================================
set local jit = off;
set local statement_timeout = '30s';

with t as (
  select (now() at time zone 'Africa/Dar_es_Salaam')::date as today,
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'followup_status' and column_name = 'deck_date') as has_stamp
),
f as (      -- every row of the register, the deck stamp read in a way that works with or without the column
  select r.ref, r.team, r.disb_date as d, r.last_trans as lt, r.days_elapsed as n,
         nullif(to_jsonb(r) ->> 'deck_date', '')::date as stamp,
         (r.status is not null or r.arrears is not null) as shown      -- the tab lists a customer with a status or arrears
  from public.followup_status r
),
x as (      -- each Disb date also read with day and month exchanged (the old importer's mistake), where that is possible at all
  select f.*, t.today,
         case when extract(day from d) <= 12 and extract(day from d) <> extract(month from d)
              then make_date(extract(year from d)::int, extract(day from d)::int, extract(month from d)::int)
              else d end as d_sw
  from f cross join t
),
c as (      -- the second test: the deck's day, the Disb date and DAYS ELAPSED agree (0 to 3), as stored or with day and month exchanged
  select x.*,
         (x.shown and x.stamp is not null and x.d is not null and x.n is not null) as testable,
         (x.stamp - x.d - x.n between 0 and 3)    as fits,
         (x.stamp - x.d_sw - x.n between 0 and 3) as fits_sw
  from x
),
p as (
  select count(*) filter (where shown)                                                   as n_shown,
         count(*) filter (where shown and d is not null)                                 as n_dated,
         min(d) filter (where shown)                                                     as d_min,
         max(d) filter (where shown)                                                     as d_max,
         count(*) filter (where shown and d > today)                                     as n_future,
         min(d) filter (where shown and d > today)                                       as f_min,
         max(d) filter (where shown and d > today)                                       as f_max,
         count(*) filter (where shown and d > today and d_sw <= today)                   as n_future_swap,
         count(*) filter (where shown and lt is not null)                                as n_lt,
         count(*) filter (where shown and lt > today)                                    as n_lt_future,
         count(*) filter (where not shown and d > today)                                 as n_hidden_future,
         count(*) filter (where testable)                                                as n_tested,
         count(*) filter (where testable and fits)                                       as n_fit,
         count(*) filter (where testable and not fits and fits_sw)                       as n_swapped,
         count(*) filter (where testable and not fits and not fits_sw)                   as n_neither,
         count(*) filter (where shown and not testable)                                  as n_untested
  from c
),
days as (   -- the second test, by the day of the deck that wrote the rows (the newest ten days)
  select stamp, count(*) as rows_,
         count(*) filter (where fits) as fit,
         count(*) filter (where not fits and fits_sw) as sw,
         count(*) filter (where not fits and not fits_sw) as nei,
         row_number() over (order by stamp desc) as rn
  from c where testable group by stamp
),
ex as (     -- the farthest-future Disb dates first
  select c.*, row_number() over (order by d desc, ref) as rn
  from c where shown and d > today
)
select z.what, z.answer from (
  select 0 as ord, 'today (East Africa time)' as what, to_char((select today from t), 'YYYY-MM-DD Dy') as answer
  union all
  select 1, 'ANSWER',
         case when (select n_future from p) > 0
                then to_char((select n_future from p), 'FM999,999,999') || ' of ' || to_char((select n_dated from p), 'FM999,999,999') || ' Disb dates on the Follow-up list are LATER THAN TODAY -- the column is NOT all right'
              when (select n_swapped from p) > 0
                then 'no Disb date is later than today, BUT ' || to_char((select n_swapped from p), 'FM999,999,999') || ' of the ' || to_char((select n_tested from p), 'FM999,999,999')
                     || ' dates tested fit only with day and month exchanged -- the column is NOT all right'
              when (select n_tested from p) = 0
                then 'no Disb date is later than today; the second test could not be made (no deck stamp on the rows), so this alone does not prove the column right'
              else 'no Disb date is later than today and all ' || to_char((select n_tested from p), 'FM999,999,999') || ' dates tested fit their own DAYS ELAPSED'
                   || case when (select n_untested from p) > 0 then ' (' || to_char((select n_untested from p), 'FM999,999,999') || ' rows could not be tested)' else '' end
                   || ' -- the column is all right' end
  union all
  select 2, 'the list the tab shows: customers (a status or arrears) / with a Disb date',
         to_char((select n_shown from p), 'FM999,999,999') || ' / ' || to_char((select n_dated from p), 'FM999,999,999')
         || coalesce('; Disb dates run from ' || (select d_min from p) || ' to ' || (select d_max from p), '')
  union all
  select 3, 'Q1  Disb date LATER THAN TODAY',
         to_char((select n_future from p), 'FM999,999,999') || ' of ' || to_char((select n_dated from p), 'FM999,999,999')
         || case when (select n_future from p) > 0 then ' (earliest ' || (select f_min from p) || ', latest ' || (select f_max from p) || ')' else '' end
  union all
  select 4, '    of those: a swap of day and month puts the date in the past', to_char((select n_future_swap from p), 'FM999,999,999') || '   <- the old importer''s mark'
  union all
  select 5, '    of those: no swap explains it (the day is over 12, or day = month)', to_char((select n_future - n_future_swap from p), 'FM999,999,999')
  union all
  select 6, 'Last trans LATER THAN TODAY (the same mistake in the other date column; not repaired by RUN-ME-060)',
         to_char((select n_lt_future from p), 'FM999,999,999') || ' of ' || to_char((select n_lt from p), 'FM999,999,999')
  union all
  select 7, 'rows the tab does NOT list (no status, no arrears) with a Disb date later than today', to_char((select n_hidden_future from p), 'FM999,999,999')
  union all
  select 8, 'the register has the deck stamp column (deck_date)', case when (select has_stamp from t) then 'yes' else 'NO -- the second test cannot be made on this book' end
  union all
  select 9, 'Q2  second test: rows with a deck stamp, a Disb date and DAYS ELAPSED', to_char((select n_tested from p), 'FM999,999,999')
  union all
  select 10, '    fit as stored (the date agrees with the row''s own DAYS ELAPSED)', to_char((select n_fit from p), 'FM999,999,999')
  union all
  select 11, '    fit ONLY with day and month exchanged (a swapped date)', to_char((select n_swapped from p), 'FM999,999,999')
  union all
  select 12, '    fit neither (e.g. a restructured loan, or a row the Followup sheet wrote last)', to_char((select n_neither from p), 'FM999,999,999')
  union all
  select 13, '    not tested (no deck stamp, no Disb date or no DAYS ELAPSED)', to_char((select n_untested from p), 'FM999,999,999')
  union all
  select 100 + d.rn::int, '    deck of ' || to_char(d.stamp, 'YYYY-MM-DD Dy'),
         to_char(d.rows_, 'FM999,999,999') || ' rows: ' || to_char(d.fit, 'FM999,999,999') || ' fit as stored, ' || to_char(d.sw, 'FM999,999,999')
         || ' only if swapped, ' || to_char(d.nei, 'FM999,999,999') || ' neither'
  from days d where d.rn <= 10
  union all
  select 200 + e.rn::int, '    e.g. ' || e.ref || ' (team ' || coalesce(e.team, '?') || ')',
         'Disb date ' || e.d || case when e.d_sw <> e.d then ' (day and month exchanged: ' || e.d_sw || ')' else '' end
         || ', DAYS ELAPSED ' || coalesce(e.n::text, '-') || ', written by the deck of ' || coalesce(e.stamp::text, '(no stamp)')
  from ex e where e.rn <= 8
) z
order by z.ord;
