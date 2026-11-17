-- =====================================================================================
-- RUN-ME-065: THE RECEIVED PAYMENTS READ THE WRONG WAY ROUND, PUT RIGHT BY THE UPLOAD'S OWN TIME (no re-upload)
--
--   "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong. When we finish disb dates,
--    we have transactions dates at received ..." -- the owner, 17 Nov 2026
--
-- WHAT WAS WRONG. The payments reader decided day or month from the file's own dates alone (docs/HANDOFF.md Part 93). A payments file of ONE
-- day from the 1st to the 12th of a month has no date with a part over twelve, so nothing decided it, and it was read day-first: the loan system
-- writes the month first, and `11/10/2026` (10 November) was stored as 11 October, for every payment of the file. Each stored date is a valid
-- date, a month early. A file of 12 November was stored as 11 December: in the future. The reader is fixed from today; this puts right what is stored.
--
-- HOW IT KNOWS. The witness is the upload's own time. A payment is uploaded the day it is made or within days, so its date lies a day before
-- the upload at most and no more than a fortnight behind it (received payments are pruned at two weeks). The two readings of an ambiguous date
-- (the day and the month exchanged) are at least 27 days apart, so at most one of them can lie in that stretch. The rows of ONE UPLOAD (the rows
-- written in the same minute) are judged together, because the old reader decided for a whole file:
--   * a row is a candidate when its stored date is NOT in [upload day - 14, upload day + 1] and the other reading IS in [upload day - 7, upload day];
--   * its upload is a SWAPPED upload only when it has no row with a day over twelve (such a row is evidence the file was read by its order, so it was read
--     right), no ambiguous row that fits as stored, and at least one candidate;
--   * only the candidates of a swapped upload are changed. A late payment in a file that was read right is left alone, so is a row with no reading
--     that fits, so is a date whose day and month are the same.
-- THE ONE CASE THIS CANNOT TELL APART: a file uploaded a month late whose dates, read the other way round, land on the upload day to the day. It is
-- repaired as if it were a swapped one. A payments file of a single day, uploaded a month late, on exactly that coincidence.
--
-- THE LEDGER. notice_payment_ledger keeps a copy of a payment made after a notice, for good, with its date (RUN-ME-041a). The copies of the payments
-- repaired here (and of every payment repaired by an earlier run) are put right too, by the payment's id. A book without that table is repaired all
-- the same (the second step is skipped). A copy whose payment was already pruned cannot be put right here and is left as it is.
--
-- WHAT IT CHANGES: `paid_at` of received_payments and of the ledger copy, and nothing else. EVERY ROW CHANGED is written to payment_date_repair_log
-- with its old and new date; the undo is at the bottom, commented out. SAFE TO RUN AGAIN: a repaired row fits as stored and is never a candidate
-- again. The answer says how many were repaired, what was left alone, and shows up to eight of them (the first part of the id, no name).
--
-- COST. received_payments holds two weeks of payments: a few thousand rows. One read, a write of the rows it changes, a 50-second statement limit
-- and a 3-second lock limit, so a run that is cut off changes nothing. Nothing on /api/upload or /api/call reads or waits for the log table.
-- =====================================================================================
set local lock_timeout = '3s';
set local statement_timeout = '50s';
set local jit = off;

create table if not exists public.payment_date_repair_log (
  source      text not null,                 -- 'payment' (received_payments) or 'ledger' (notice_payment_ledger)
  row_key     text not null,                 -- the payment's id; a ledger copy: ref | notice date | payment id
  repaired_at timestamptz not null default now(),
  paid_old    date, paid_new date, upload_day date,
  primary key (source, row_key)
);
alter table public.payment_date_repair_log enable row level security;

with p as (   -- every payment with a date: its upload's day (East Africa), its upload (the minute it was written) and its date read the other way round
  select r.id, r.paid_at as d, (r.created_at at time zone 'Africa/Dar_es_Salaam')::date as up, date_trunc('minute', r.created_at) as grp,
         case when extract(day from r.paid_at) <= 12 and extract(day from r.paid_at) <> extract(month from r.paid_at)
              then make_date(extract(year from r.paid_at)::int, extract(day from r.paid_at)::int, extract(month from r.paid_at)::int)
              else r.paid_at end as d_sw
  from public.received_payments r
  where r.paid_at is not null
),
f as (
  select p.*,
         (p.d <> p.d_sw)                                           as amb,       -- both parts twelve or under, and not the same: the order could not be told
         (extract(day from p.d) > 12)                              as unamb,     -- a day over twelve: evidence, the file was read by its order
         (p.d between p.up - 14 and p.up + 1)                      as fits,
         (p.d <> p.d_sw and p.d_sw between p.up - 7 and p.up)      as fits_sw
  from p
),
g as (        -- one upload: does it carry evidence, does an ambiguous row fit as stored, and how many rows fit only the other way round
  select grp,
         count(*) filter (where unamb)                         as n_unamb,
         count(*) filter (where amb and fits)                  as n_amb_fit,
         count(*) filter (where amb and not fits and fits_sw)  as n_sw
  from f group by grp
),
take as (     -- the rows of the swapped uploads that fit only the other way round
  select f.* from f join g on g.grp = f.grp
  where g.n_unamb = 0 and g.n_amb_fit = 0 and g.n_sw >= 1 and f.amb and not f.fits and f.fits_sw
),
lg as (
  insert into public.payment_date_repair_log (source, row_key, paid_old, paid_new, upload_day)
  select 'payment', t.id::text, t.d, t.d_sw, t.up from take t
  on conflict (source, row_key) do nothing                  -- a row's FIRST log line keeps the date it was uploaded with
  returning 1
),
upd as (
  update public.received_payments r set paid_at = t.d_sw
    from take t
   where r.id = t.id and r.paid_at = t.d
  returning r.id
)
select (select count(*) from upd) as payments_put_right_now, (select count(*) from lg) as logged_now;

do $$
begin       -- the ledger's copies of every payment this table has put right (skipped on a book without the ledger)
  if to_regclass('public.notice_payment_ledger') is not null then
    insert into public.payment_date_repair_log (source, row_key, paid_old, paid_new, upload_day)
    select 'ledger', l.ref || '|' || l.since || '|' || l.payment_id, l.paid_at, g.paid_new, g.upload_day
      from public.notice_payment_ledger l
      join public.payment_date_repair_log g on g.source = 'payment' and g.row_key = l.payment_id::text
     where l.paid_at = g.paid_old and g.paid_old <> g.paid_new
    on conflict (source, row_key) do nothing;
    update public.notice_payment_ledger l set paid_at = g.paid_new
      from public.payment_date_repair_log g
     where g.source = 'payment' and g.row_key = l.payment_id::text and l.paid_at = g.paid_old and g.paid_old <> g.paid_new;
  end if;
end $$;

select z.what, z.answer from (
  select 1 as ord, 'payments in the book (with a date)' as what, to_char((select count(*) from public.received_payments where paid_at is not null), 'FM999,999,999') as answer
  union all
  select 2, 'put right by THIS run: payments / ledger copies',
         to_char((select count(*) from public.payment_date_repair_log where source = 'payment' and repaired_at = now()), 'FM999,999,999') || ' / '
         || to_char((select count(*) from public.payment_date_repair_log where source = 'ledger' and repaired_at = now()), 'FM999,999,999')
  union all
  select 3, 'put right by all runs so far: payments / ledger copies',
         to_char((select count(*) from public.payment_date_repair_log where source = 'payment'), 'FM999,999,999') || ' / '
         || to_char((select count(*) from public.payment_date_repair_log where source = 'ledger'), 'FM999,999,999')
  union all
  select 4, 'payments still dated outside their upload''s fortnight (late payments, or no reading fits: left alone)',
         to_char((select count(*) from public.received_payments r where r.paid_at is not null
                    and r.paid_at not between (r.created_at at time zone 'Africa/Dar_es_Salaam')::date - 14 and (r.created_at at time zone 'Africa/Dar_es_Salaam')::date + 1), 'FM999,999,999')
  union all
  select 10 + row_number() over (order by g.upload_day desc, g.row_key)::int, '    e.g. payment ' || left(g.row_key, 8),
         g.paid_old || ' -> ' || g.paid_new || ' (uploaded ' || g.upload_day || ')'
  from (select * from public.payment_date_repair_log where source = 'payment' and repaired_at = now() order by upload_day desc, row_key limit 8) g
) z
order by z.ord;

-- UNDO: take the two dashes off the two statements below, run them, and every row the log names goes back to the date it was uploaded with.
-- update public.received_payments r set paid_at = g.paid_old from public.payment_date_repair_log g where g.source = 'payment' and g.row_key = r.id::text and r.paid_at = g.paid_new;
-- update public.notice_payment_ledger l set paid_at = g.paid_old from public.payment_date_repair_log g where g.source = 'ledger' and g.row_key = l.ref || '|' || l.since || '|' || l.payment_id and l.paid_at = g.paid_new;
