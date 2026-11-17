-- =====================================================================================
-- RUN-ME-063: WHERE DOES A DISB DATE LATER THAN TODAY STILL LIVE? EVERY TABLE THAT HOLDS ONE. READ-ONLY: changes nothing.
--
--   "I mean there could be future dates e.g into December 2026 than today's 17th Nov 2026" -- the owner, 17 Nov 2026
--
-- WHY THIS EXISTS. db/RUN-ME-062 looked at one table, the register behind the Defaulters Followup tab, and found no Disb date later than today
-- on the tab (docs/HANDOFF.md Part 91). The same date is stored in FOUR tables, and the old importer's mistake (day and month swapped
-- wherever both numbers were twelve or under: 12 Jan 2026 stored as 1 Dec 2026) went into every one of them from early August to 16 Nov:
--   * followup_status       the Defaulters Followup tab (and the 64 rows it does not list, which keep the date their last write held);
--   * defaulter_snapshots   the stored decks: Expected Defaulters, the Exp.Def Report by day, week and month, the phone's Exp.Def lists, the
--                           dashboard card. db/RUN-ME-060 puts them right a few days at a time; nothing has touched the days before 10 Nov;
--   * repayment_snapshots   the Expected sheet: the customer page shows "Last payment" from it (handbook Part 91);
--   * loans                 the loan pipeline's Disbursed column.
--
-- WHAT IT ANSWERS, one table at a time. How many Disb dates are later than today (the East Africa date), and how many of those a swap of day and
-- month would put in the past (the old importer's mark). For the decks, week by week (the Monday of the deck's week), which tells you how far back
-- RUN-ME-060 still has to reach. And the question the Expected Defaulters tab turns on:
--   CUSTOMERS WHOSE LAST-KNOWN DECK ROW HAS A DISB DATE LATER THAN TODAY. The tab shows a customer who dropped off the deck as CLEARED, with the
--   Disb date of their newest current row (handbook Part 71, db/RUN-ME-055: the same rule). A customer is counted here when their newest current
--   row is such a row and is older than the latest current deck: nobody else has a newer row to put it right. These are the December 2026 dates on
--   that tab. Each such row is also placed on the wrong cycle day and the wrong leader, since the cycle is read off the Disb date.
--
-- WHAT A CLEAN ANSWER DOES NOT PROVE. A swapped 2026 date reaches the future only when its real day is the 12th, and no 2024 or 2025 date ever does.
-- Every swapped date that stayed in the past looks fine and is wrong all the same, and there are many more of them than the ones counted here.
-- The tests that see those are the pattern tests: db/RUN-ME-061 for the decks, db/RUN-ME-062 for the Defaulters Followup tab.
--
-- THE DAYS. The first lines name the first deck day to read (2026-08-01: the whole history) and how many days of the Expected sheet to read (28).
-- COST. It reads the decks table once from end to end (about two million rows), the register and the Expected sheet's last 28 days. Nothing is
-- written and nothing waits for it. It asks for ONE process (no parallel workers), a 45-second ceiling, and no lock beyond a read. Run it when no upload
-- is running: it is a read of the largest table in the book. To read less, change the first date.
-- =====================================================================================
set local jit = off;
set local statement_timeout = '45s';
set local max_parallel_workers_per_gather = 0;

with t as (
  select (now() at time zone 'Africa/Dar_es_Salaam')::date as today,
         date '2026-08-01' as from_day,          -- CHANGE: the first deck day to read (the old importer's fault began in early August)
         28 as expected_days                     -- CHANGE: how many days of the Expected sheet to read
),
dtot as (   -- deck rows per day and kind: counted from the index where the database can, so the table is not read twice
  select s.snapshot_type as kind, s.snapshot_date as day, count(*) as n
  from public.defaulter_snapshots s
  where s.snapshot_date >= (select from_day from t)
  group by s.snapshot_type, s.snapshot_date
),
dfut as (   -- the deck rows whose Disb date or Last trans date is later than today; each Disb date also read with day and month exchanged
  select s.ref, s.team, s.snapshot_type as kind, s.snapshot_date as day, s.created_at,
         s.disb_date as d, s.last_trans_date as lt,
         case when extract(day from s.disb_date) <= 12 and extract(day from s.disb_date) <> extract(month from s.disb_date)
              then make_date(extract(year from s.disb_date)::int, extract(day from s.disb_date)::int, extract(month from s.disb_date)::int)
              else s.disb_date end as d_sw
  from public.defaulter_snapshots s
  where s.snapshot_date >= (select from_day from t)
    and (s.disb_date > (select today from t) or s.last_trans_date > (select today from t))
),
dsum as (
  select count(*) filter (where d > (select today from t))                                                      as n_d,
         count(*) filter (where d > (select today from t) and kind = 'initial')                                  as n_d_ini,
         count(*) filter (where d > (select today from t) and kind = 'current')                                  as n_d_cur,
         count(*) filter (where d > (select today from t) and d_sw <= (select today from t))                     as n_d_sw,
         count(*) filter (where lt > (select today from t))                                                      as n_lt,
         max(d) filter (where d > (select today from t))                                                         as d_max
  from dfut
),
dall as (select coalesce(sum(n), 0) as n_rows, max(day) filter (where kind = 'current') as latest_cur from dtot),
gh as (     -- the last-known row of a customer: their newest current row, if it is one of those and is older than the latest current deck
  select distinct on (f.ref, f.team) f.ref, f.team, f.day, f.d, f.d_sw
  from dfut f
  where f.kind = 'current' and f.d > (select today from t)
    and f.day < (select latest_cur from dall)
    and not exists (select 1 from public.defaulter_snapshots n
                     where n.ref = f.ref and n.team is not distinct from f.team and n.snapshot_type = 'current'
                       and (n.snapshot_date, n.created_at) > (f.day, f.created_at))
  order by f.ref, f.team, f.day desc, f.created_at desc
),
ex as (     -- the farthest-future last-known dates first
  select gh.*, row_number() over (order by d desc, ref) as rn from gh
),
wk as (     -- week by week (the Monday of the deck's week): rows, and rows with a Disb date / Last trans later than today
  select coalesce(a.wk, b.wk) as wk,
         coalesce(a.n_ini, 0) as n_ini, coalesce(a.n_cur, 0) as n_cur,
         coalesce(b.d_ini, 0) as d_ini, coalesce(b.d_cur, 0) as d_cur, coalesce(b.l_ini, 0) as l_ini, coalesce(b.l_cur, 0) as l_cur
  from (select date_trunc('week', day)::date as wk,
               sum(n) filter (where kind = 'initial') as n_ini, sum(n) filter (where kind = 'current') as n_cur
          from dtot group by 1) a
  full join (select date_trunc('week', day)::date as wk,
               count(*) filter (where kind = 'initial' and d > (select today from t)) as d_ini,
               count(*) filter (where kind = 'current' and d > (select today from t)) as d_cur,
               count(*) filter (where kind = 'initial' and lt > (select today from t)) as l_ini,
               count(*) filter (where kind = 'current' and lt > (select today from t)) as l_cur
          from dfut group by 1) b on a.wk = b.wk
),
rg as (     -- the register behind the Defaulters Followup tab: the tab lists a customer with a status or arrears
  select count(*) filter (where (status is not null or arrears is not null) and disb_date is not null)                 as n_shown_dated,
         count(*) filter (where (status is not null or arrears is not null) and disb_date > (select today from t))     as n_shown_fut,
         max(disb_date) filter (where status is not null or arrears is not null)                                       as d_max,
         count(*) filter (where status is null and arrears is null)                                                    as n_hidden,
         count(*) filter (where status is null and arrears is null and disb_date > (select today from t))              as n_hidden_fut
  from public.followup_status
),
rp as (     -- the Expected sheet, the last days of it
  select count(*)                                                                         as n_rows,
         count(*) filter (where disb_date > (select today from t))                        as n_d,
         count(*) filter (where last_trans_date > (select today from t))                  as n_lt
  from public.repayment_snapshots
  where snapshot_date >= (select today from t) - (select expected_days from t)
),
ln as (     -- the loan pipeline
  select count(*) filter (where disb_date is not null)                                     as n_dated,
         count(*) filter (where disb_date > (select today from t))                         as n_d
  from public.loans
)
select z.what, z.answer from (
  select 0 as ord, 'today (East Africa time)' as what, to_char((select today from t), 'YYYY-MM-DD Dy') as answer
  union all
  select 1, 'ANSWER',
         case when (select n_shown_fut + n_hidden_fut from rg) + (select n_d from dsum) + (select n_d from rp) + (select n_d from ln) = 0
                then 'no Disb date later than today in any of the four tables (this is not proof the dates are right: a swapped date reaches the future only when its real day is the 12th)'
              else 'Disb dates later than today: Defaulters Followup tab ' || to_char((select n_shown_fut from rg), 'FM999,999,999')
                   || ', register rows the tab does not list ' || to_char((select n_hidden_fut from rg), 'FM999,999,999')
                   || ', stored decks ' || to_char((select n_d from dsum), 'FM999,999,999') || ' rows (' || to_char((select count(*) from gh), 'FM999,999,999')
                   || ' customers whose last-known row is one), Expected sheet ' || to_char((select n_d from rp), 'FM999,999,999')
                   || ', loans ' || to_char((select n_d from ln), 'FM999,999,999') end
  union all
  select 2, 'Defaulters Followup tab (customers listed): Disb date later than today',
         to_char((select n_shown_fut from rg), 'FM999,999,999') || ' of ' || to_char((select n_shown_dated from rg), 'FM999,999,999')
         || coalesce('; the latest Disb date on the tab is ' || (select d_max from rg), '')
  union all
  select 3, 'Defaulters Followup, register rows the tab does NOT list (no status, no arrears): Disb date later than today',
         to_char((select n_hidden_fut from rg), 'FM999,999,999') || ' of ' || to_char((select n_hidden from rg), 'FM999,999,999')
  union all
  select 4, 'Stored decks from ' || (select from_day from t) || ' (the table behind Expected Defaulters, the Exp.Def Report, the phone): rows read',
         to_char((select n_rows from dall), 'FM999,999,999')
  union all
  select 5, 'Stored decks: Disb date later than today',
         to_char((select n_d from dsum), 'FM999,999,999') || ' rows (' || to_char((select n_d_ini from dsum), 'FM999,999,999') || ' initial, '
         || to_char((select n_d_cur from dsum), 'FM999,999,999') || ' current)'
         || case when (select n_d from dsum) > 0 then '; a swap of day and month puts ' || to_char((select n_d_sw from dsum), 'FM999,999,999') || ' of them in the past (the old importer''s mark); the latest is ' || (select d_max from dsum) else '' end
  union all
  select 6, 'Stored decks: Last trans date later than today (db/RUN-ME-060 does not repair it)', to_char((select n_lt from dsum), 'FM999,999,999') || ' rows'
  union all
  select 7, 'CUSTOMERS whose LAST-KNOWN current deck row has a Disb date later than today and is older than the latest current deck (' || coalesce((select latest_cur::text from dall), '-') || ')',
         to_char((select count(*) from gh), 'FM999,999,999') || ' customers   <- the December dates a CLEARED customer shows on Expected Defaulters'
  union all
  select 8, 'Expected sheet, last ' || (select expected_days from t) || ' days: Disb date later than today / Last trans date later than today (the customer page shows Last payment)',
         to_char((select n_d from rp), 'FM999,999,999') || ' / ' || to_char((select n_lt from rp), 'FM999,999,999') || ' of ' || to_char((select n_rows from rp), 'FM999,999,999') || ' rows'
  union all
  select 9, 'Loans (the loan pipeline): Disb date later than today', to_char((select n_d from ln), 'FM999,999,999') || ' of ' || to_char((select n_dated from ln), 'FM999,999,999')
  union all
  select 100 + row_number() over (order by w.wk desc)::int, '    deck week of ' || to_char(w.wk, 'YYYY-MM-DD') || ' (Mon)',
         'initial ' || to_char(w.n_ini, 'FM999,999,999') || ' rows: ' || to_char(w.d_ini, 'FM999,999,999') || ' Disb / ' || to_char(w.l_ini, 'FM999,999,999')
         || ' Last trans later than today;  current ' || to_char(w.n_cur, 'FM999,999,999') || ' rows: ' || to_char(w.d_cur, 'FM999,999,999') || ' / ' || to_char(w.l_cur, 'FM999,999,999')
  from wk w
  union all
  select 300 + e.rn::int, '    e.g. ' || e.ref || ' (team ' || coalesce(e.team, '?') || ')',
         'Disb date ' || e.d || case when e.d_sw <> e.d then ' (day and month exchanged: ' || e.d_sw || ')' else '' end || ', last seen on the deck of ' || e.day
  from ex e where e.rn <= 8
) z
order by z.ord;
