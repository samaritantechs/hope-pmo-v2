-- =====================================================================================
-- RUN-ME-070: THE IMPORTED NOTICES WHOSE DATE IS THEIR NUMBER'S DAY EXCHANGED AND A DAY EARLY, PUT BACK TO THE DAY THEIR OWN NUMBER SAYS
--
--   "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026
--   (docs/HANDOFF.md Part 100: the answer of RUN-ME-068 read, and this repair. Run RUN-ME-068 first: this file reads its log.)
--
-- WHAT RUN-ME-068 SHOWED ON THE LIVE BOOK. It put back 28 notices dated after the day they were uploaded (a register sent on 12 Oct cannot hold a notice dated 9 Dec), and printed what
-- was left: 252 imported notices whose date still is not the day their own number says. 190 of them are that day with day and month EXCHANGED AND A DAY EARLY, exactly the shape of the 28
-- (number 10 Dec 2025 -> stored 11 Oct 2025); 61 are ONE DAY EARLY and cannot be exchanged (the eight printed were all number 10/10/2026 -> stored 9 Oct); 1 is something else. Not one of the 566 imported
-- notices that match their number, and not one of the 248 made in the app, shows it: a notice number is TEXT, written when the notice was made, and no date reader ever touched it. The
-- 28 were repaired because their stored date was IMPOSSIBLE; these 251 have stored dates that are only WRONG, in the past, and the same shape is the proof.
--
-- WHAT THIS CHANGES, AND ONLY THIS. Nothing is guessed: a notice is changed ONLY WHEN ALL FOUR HOLD.
--   (1) It is IMPORTED (its upload date is set) and its notice date is not the day its number says. The number is HMCL/<initials>/<dd>/<mm>/<yyyy>, a day that exists, not later than the upload day.
--   (2) Its UPLOAD IS PROVEN to carry the shift: RUN-ME-068 put right at least three notices of that very upload because they were dated after the day it was uploaded
--       (read from its log, demand_notice_date_repair_log). Without that proof, nothing of the upload is touched.
--   (3) Its stored date is EXACTLY what the shift makes of its number, and nothing else: the number's day with day and month exchanged (a day twelve or under, not the month), less one
--       day; or, where the day and the month of the number are the SAME (10/10/2026), the number's day less one day. A day over twelve cannot be exchanged, so a notice with such a number is NEVER
--       repaired here, even a day early: the answer counts them (line 16), so that what they are can be said from the book and not guessed.
--   (4) It was not changed by an earlier run (this file's log, or RUN-ME-068's).
-- The notice date is written back as the number's day. Its STAMP (created_at) moves with it ONLY IF the stamp's day in East Africa is the same wrong day the notice date carried: it goes to the
-- number's day at the same time of day. The notice's recoveries kept in notice_payment_ledger (RUN-ME-041a, by notice date) move with the date, so they stay on the notice, unless ANOTHER
-- notice of the same loan carries the old or the new date (then they cannot be told apart and stay where they are, and the answer counts them); a ledger row that would meet the same payment
-- already kept at the new date stays where it is. Every ledger row moved is written to notice_ledger_shift_move_log, so the undo puts back exactly those and no other.
--
-- LEFT EXACTLY AS THEY ARE, AND COUNTED: every other imported notice that differs from its number (the answer describes them: how far, which way, how often, which number days, with
-- examples), every notice of an upload that is not proven, every notice with no usable number, and every notice made in the app.
--
-- EVERY ROW CHANGED is written to demand_notice_shift_repair_log / notice_ledger_shift_move_log with its old and new values; the undo is at the foot, commented out. A row in a log is
-- never changed again, so this is SAFE TO RUN AGAIN (a second run changes nothing and says so), and an undone row stays undone.
--
-- WHAT THE LEDGER MAY HOLD AFTER A MOVE TO A LATER DAY: a payment made on the day BEFORE the corrected notice date was counted as a recovery after the notice. The answer counts such rows. They are
-- not deleted: a payment is never deleted here.
--
-- COST. About 1,100 rows read, a few hundred written: a fraction of a second (every step that reads a number is MATERIALIZED, as in RUN-ME-067 and 068). A 3-second lock limit keeps it from
-- waiting behind anything, a 30-second ceiling rolls it all back whole. Nothing on /api/upload or /api/call.
-- PRINTS: counts, dates and the first eight characters of a row id. NO NAME, NO LOAN NUMBER, NO NOTICE NUMBER, no amount.
-- =====================================================================================
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local jit = off;

do $$
begin
  if to_regclass('public.demand_notice_date_repair_log') is null then
    raise exception 'Run db/RUN-ME-068 first: it proves which upload carries the shift, and this file reads its log. Nothing was changed.';
  end if;
  if to_regclass('public.notice_payment_ledger') is null then
    raise exception 'Run db/RUN-ME-041a first: the recoveries of a notice are kept in notice_payment_ledger by the notice date, and this file moves them with the date. Nothing was changed.';
  end if;
end $$;

create table if not exists public.demand_notice_shift_repair_log (
  id uuid primary key,                       -- the notice that was changed
  repaired_at timestamptz not null default now(),
  notice_old date, notice_new date,
  stamp_old timestamptz, stamp_new timestamptz
);
alter table public.demand_notice_shift_repair_log enable row level security;

create table if not exists public.notice_ledger_shift_move_log (
  ref text not null, payment_id uuid not null,     -- the ledger row that was moved to its notice's corrected date
  since_old date not null, since_new date not null,
  moved_at timestamptz not null default now(),
  primary key (ref, payment_id, since_new)
);
alter table public.notice_ledger_shift_move_log enable row level security;

with m as materialized (    -- every notice: its date, its stamp as the wall clock in East Africa, the upload day, and the parts of its number
  select n.id, n.ref, n.notice_date as nd, n.created_at as ca, n.upload_date as ud,
         (n.created_at at time zone 'Africa/Dar_es_Salaam') as cl,
         regexp_match(n.notice_id, '^HMCL/[^/]+/(\d{2})/(\d{2})/(\d{4})(?:-\d+)?$') as p
  from public.demand_notices n
),
v as materialized (         -- the day the number carries, when it is a day that exists (a number is typed: 31/04 is no day)
  select m.*,
         case when m.p is null then null else
           case when (m.p)[2]::int between 1 and 12 and (m.p)[3]::int between 2000 and 2100 then
             case when (m.p)[1]::int between 1 and extract(day from (make_date((m.p)[3]::int, (m.p)[2]::int, 1) + interval '1 month' - interval '1 day'))::int
                  then make_date((m.p)[3]::int, (m.p)[2]::int, (m.p)[1]::int) end end end as idd
  from m
),
w as materialized (         -- the same day with its day and month exchanged, the stamp's day, and whether an earlier run changed the row
  select v.*,
         case when v.idd is not null and extract(day from v.idd) <= 12 and extract(day from v.idd) <> extract(month from v.idd)
              then make_date(extract(year from v.idd)::int, extract(day from v.idd)::int, extract(month from v.idd)::int) end as isw,
         (v.idd is not null and extract(day from v.idd) = extract(month from v.idd)) as dm,
         v.cl::date as cd,
         (l.id is not null or l2.id is not null) as was_fixed
  from v
  left join public.demand_notice_date_repair_log l on l.id = v.id
  left join public.demand_notice_shift_repair_log l2 on l2.id = v.id
),
pr as materialized (        -- the uploads PROVEN to carry the shift: RUN-ME-068 put right three or more notices of the upload because they were dated after the day it was uploaded
  select n.upload_date as ud, count(*) as n_proved
  from public.demand_notice_date_repair_log g
  join public.demand_notices n on n.id = g.id
  where n.upload_date is not null and g.notice_old > n.upload_date
  group by n.upload_date
),
x as materialized (         -- every notice with its upload's verdict
  select w.*, (w.ud is not null and coalesce(pr.n_proved, 0) >= 3) as proved_up
  from w left join pr on pr.ud = w.ud
),
cand as (     -- imported notices of a proven upload that are not their number's day, not changed before
  select x.* from x
  where x.proved_up and x.nd is not null and x.idd is not null and x.nd <> x.idd and not x.was_fixed
),
ok as (       -- the proof: the number's day is not after the upload, and the stored date is exactly what the shift makes of it
  select c.*,
         case when c.isw is not null then 'A' else 'B' end as kind,
         case when c.cd = c.nd then ((c.idd + c.cl::time) at time zone 'Africa/Dar_es_Salaam') else c.ca end as ca_new
  from cand c
  where c.idd <= c.ud
    and ((c.isw is not null and c.nd = c.isw - 1)
         or (c.isw is null and c.dm and c.nd = c.idd - 1))
),
lg as (
  insert into public.demand_notice_shift_repair_log (id, notice_old, notice_new, stamp_old, stamp_new)
  select o.id, o.nd, o.idd, o.ca, o.ca_new from ok o
  on conflict (id) do nothing
  returning id
),
upd as (
  update public.demand_notices n set notice_date = o.idd, created_at = o.ca_new
    from ok o
   where n.id = o.id and n.notice_date = o.nd
  returning n.id
),
led as (      -- the recoveries kept for the notice follow its date, unless another notice of the same loan carries the old or the new date, or the same payment is already at the new date
  update public.notice_payment_ledger l set since = o.idd
    from ok o
   where l.ref = o.ref and l.since = o.nd
     and not exists (select 1 from public.notice_payment_ledger y where y.ref = l.ref and y.since = o.idd and y.payment_id = l.payment_id)
     and not exists (select 1 from x z where z.ref = o.ref and z.id <> o.id and z.nd in (o.nd, o.idd))
  returning l.ref, l.payment_id, o.nd as since_old, o.idd as since_new, l.paid_at
),
llg as (
  insert into public.notice_ledger_shift_move_log (ref, payment_id, since_old, since_new)
  select e.ref, e.payment_id, e.since_old, e.since_new from led e
  on conflict do nothing
  returning ref
),
held as (     -- ledger rows of the notices put back that stayed where they were
  select count(*) as n
  from public.notice_payment_ledger l join ok o on l.ref = o.ref and l.since = o.nd
),
fin as (      -- every imported notice as it stands after this run: its notice date, and the East Africa day of its stamp
  select x.*, (o.id is not null) as put_back, case when o.id is not null then x.idd else x.nd end as nd2,
         case when o.id is not null then (o.ca_new at time zone 'Africa/Dar_es_Salaam')::date else x.cd end as cd2
  from x left join ok o on o.id = x.id
  where x.ud is not null
),
rest as (     -- the imported notices whose date still is not the day their number says, after this run
  select f.* from fin f where f.nd is not null and f.idd is not null and f.nd2 <> f.idd
),
ex as (       -- up to eight of them, the latest dates first
  select r.*, row_number() over (order by r.nd2 desc, r.id) as rn from rest r
),
offs as (     -- the most common differences (stored date minus the number's day, in days)
  select t.dif, t.n, row_number() over (order by t.n desc, t.dif) as rk
  from (select (r.nd2 - r.idd) as dif, count(*) as n from rest r group by 1) t
)
select z.what, z.answer from (
  select 0 as ord, 'ANSWER' as what,
         case when (select count(*) from fin where proved_up) = 0
              then 'no upload is proved to carry the shift (RUN-ME-068 put right fewer than three notices dated after the day they were uploaded, in every upload): nothing was changed'
              else to_char((select count(*) from upd), 'FM999,999,999') || ' notice date(s) put back to the day their number says (' || to_char((select count(*) from ok where ca_new <> ca), 'FM999,999,999')
                   || ' stamp(s) with them, ' || to_char((select count(*) from led), 'FM999,999,999') || ' ledger row(s) moved with the date); '
                   || to_char((select count(*) from rest), 'FM999,999,999') || ' imported notice(s) still differ from their number and were left alone (described below)' end as answer
  union all
  select 1, 'uploads of imported notices: proved to carry the shift (RUN-ME-068 put right three or more of its notices dated after its upload day) / not proved',
         to_char((select count(distinct ud) from fin where proved_up), 'FM999,999,999') || ' / ' || to_char((select count(distinct ud) from fin where not proved_up), 'FM999,999,999')
  union all
  select 2, 'imported notices (upload date set): all / in a proved upload / of those, not their number''s day and not changed before',
         to_char((select count(*) from fin), 'FM999,999,999') || ' / ' || to_char((select count(*) from fin where proved_up), 'FM999,999,999') || ' / ' || to_char((select count(*) from cand), 'FM999,999,999')
  union all
  select 3, '    put back by THIS run: the number''s day exchanged and a day early / the number''s day, a day early (day and month the same)',
         to_char((select count(*) from ok where kind = 'A'), 'FM999,999,999') || ' / ' || to_char((select count(*) from ok where kind = 'B'), 'FM999,999,999')
  union all
  select 4, '    stamps moved with them (the stamp carried the same wrong day) / their stamp left (it carries another day) / ledger rows moved with the date / ledger rows left where they are',
         to_char((select count(*) from ok where ca_new <> ca), 'FM999,999,999') || ' / ' || to_char((select count(*) from ok where ca_new = ca), 'FM999,999,999') || ' / '
         || to_char((select count(*) from led), 'FM999,999,999') || ' / ' || to_char((select n from held) - (select count(*) from led), 'FM999,999,999')
  union all
  select 5, '    ledger rows now dated before the notice they belong to (a payment the day before the corrected date: counted, not deleted)',
         to_char((select count(*) from led where paid_at < since_new), 'FM999,999,999')
  union all
  select 6, '    the clock of the stamps of the notices put back, in East Africa: 12:00 (a date with no clock) / 21:00 / any other time',
         to_char((select count(*) from ok where cl::time = time '12:00'), 'FM999,999,999') || ' / ' || to_char((select count(*) from ok where cl::time = time '21:00'), 'FM999,999,999') || ' / '
         || to_char((select count(*) from ok where cl::time not in (time '12:00', time '21:00')), 'FM999,999,999')
  union all
  select 7, 'imported notices whose stamp (created_at) day is not their notice date, after this run: all / the stamp is the number''s day exchanged and a day early (the shape) / any other day',
         to_char((select count(*) from fin where cd2 is distinct from nd2), 'FM999,999,999') || ' / '
         || to_char((select count(*) from fin where cd2 is distinct from nd2 and ((isw is not null and cd2 = isw - 1) or (isw is null and dm and cd2 = idd - 1))), 'FM999,999,999') || ' / '
         || to_char((select count(*) from fin where cd2 is distinct from nd2 and not ((isw is not null and cd2 = isw - 1) or (isw is null and dm and cd2 = idd - 1))), 'FM999,999,999')
  union all
  select 10, 'imported notices whose date still is not the day their number says (after this run): all / of them dated after the upload day',
         to_char((select count(*) from rest), 'FM999,999,999') || ' / ' || to_char((select count(*) from rest where nd2 > ud), 'FM999,999,999')
  union all
  select 11, 'imported notices by the day their number carries, after this run. Twelve or under and not the month (can be exchanged): all / the number''s day / not',
         to_char((select count(*) from fin where isw is not null), 'FM999,999,999') || ' / ' || to_char((select count(*) from fin where isw is not null and nd2 = idd), 'FM999,999,999') || ' / '
         || to_char((select count(*) from fin where isw is not null and nd2 is distinct from idd), 'FM999,999,999')
  union all
  select 12, '    the day equal to the month: all / the number''s day / not',
         to_char((select count(*) from fin where dm), 'FM999,999,999') || ' / ' || to_char((select count(*) from fin where dm and nd2 = idd), 'FM999,999,999') || ' / '
         || to_char((select count(*) from fin where dm and nd2 is distinct from idd), 'FM999,999,999')
  union all
  select 13, '    a day over twelve: all / the number''s day / not',
         to_char((select count(*) from fin where idd is not null and extract(day from idd) > 12), 'FM999,999,999') || ' / '
         || to_char((select count(*) from fin where idd is not null and extract(day from idd) > 12 and nd2 = idd), 'FM999,999,999') || ' / '
         || to_char((select count(*) from fin where idd is not null and extract(day from idd) > 12 and nd2 is distinct from idd), 'FM999,999,999')
  union all
  select 14, '    no usable number (not a day that exists): all',
         to_char((select count(*) from fin where idd is null), 'FM999,999,999')
  union all
  select 15, 'still not the number''s day: stored minus the number''s day: one day early / one day late / within a week / further',
         to_char((select count(*) from rest where nd2 - idd = -1), 'FM999,999,999') || ' / ' || to_char((select count(*) from rest where nd2 - idd = 1), 'FM999,999,999') || ' / '
         || to_char((select count(*) from rest where abs(nd2 - idd) between 2 and 7), 'FM999,999,999') || ' / ' || to_char((select count(*) from rest where abs(nd2 - idd) > 7), 'FM999,999,999')
  union all
  select 16, '    of the one day early: a day over twelve (no exchange) / the day equal to the month / twelve or under and not the month',
         to_char((select count(*) from rest where nd2 - idd = -1 and extract(day from idd) > 12), 'FM999,999,999') || ' / ' || to_char((select count(*) from rest where nd2 - idd = -1 and dm), 'FM999,999,999') || ' / '
         || to_char((select count(*) from rest where nd2 - idd = -1 and isw is not null), 'FM999,999,999')
  union all
  select 17, '    stored date against the number''s day EXCHANGED: exactly / a day early / a day late / other / cannot be exchanged',
         to_char((select count(*) from rest where nd2 = isw), 'FM999,999,999') || ' / ' || to_char((select count(*) from rest where nd2 = isw - 1), 'FM999,999,999') || ' / '
         || to_char((select count(*) from rest where nd2 = isw + 1), 'FM999,999,999') || ' / '
         || to_char((select count(*) from rest where isw is not null and nd2 not in (isw, isw - 1, isw + 1)), 'FM999,999,999') || ' / ' || to_char((select count(*) from rest where isw is null), 'FM999,999,999')
  union all
  select 18, '    the most common differences, stored minus number''s day in days (days: how many; the eight most common)',
         coalesce((select string_agg(t.dif::text || ': ' || t.n::text, ', ' order by t.rk) from offs t where t.rk <= 8), 'none')
  union all
  select 19, '    stamp (created_at) day against the stored date / against the number''s day / against neither',
         to_char((select count(*) from rest where cd = nd2), 'FM999,999,999') || ' / ' || to_char((select count(*) from rest where cd = idd and cd <> nd2), 'FM999,999,999') || ' / '
         || to_char((select count(*) from rest where cd <> nd2 and cd <> idd), 'FM999,999,999')
  union all
  select 20 + e.rn::int, '    e.g. notice ' || left(e.id::text, 8),
         'stored ' || e.nd2::text || ', number says ' || e.idd::text || ' (stored minus number: ' || (e.nd2 - e.idd)::text || ' days)'
         || case when e.isw is not null then ', exchanged ' || e.isw::text || ' (stored minus exchanged: ' || (e.nd2 - e.isw)::text || ')' else ', cannot be exchanged' end
         || ', stamp ' || e.cd::text || ', uploaded ' || e.ud::text || case when e.proved_up then '' else ' (upload not proved)' end
  from ex e where e.rn <= 8
) z
order by z.ord;

-- UNDO: take the two dashes off the lines below, run them, and every row the logs name goes back to what it was. The logs keep their rows, so a row undone is not changed again.
-- update public.notice_payment_ledger l set since = m.since_old from public.notice_ledger_shift_move_log m where l.ref = m.ref and l.payment_id = m.payment_id and l.since = m.since_new and not exists (select 1 from public.notice_payment_ledger x where x.ref = m.ref and x.payment_id = m.payment_id and x.since = m.since_old);
-- update public.demand_notices n set notice_date = g.notice_old, created_at = g.stamp_old from public.demand_notice_shift_repair_log g where n.id = g.id and n.notice_date = g.notice_new;
