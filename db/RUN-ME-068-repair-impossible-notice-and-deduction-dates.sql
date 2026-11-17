-- =====================================================================================
-- RUN-ME-068: THE NOTICE DATES THAT CANNOT BE REAL, PUT BACK TO THE DAY THEIR OWN NUMBER SAYS, AND THE DEDUCTION DISCOVERY DATES THAT ARE AFTER THE CASE WAS SUBMITTED
--
--   "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026
--   (docs/HANDOFF.md Part 98: the answer of RUN-ME-067 read, and this repair)
--
-- WHAT RUN-ME-067 SHOWED ON THE LIVE BOOK. Of 1,094 demand notices none carried its number's day with day and month exchanged, and 280 imported ones match neither
-- their number nor an exchange of it: all 12 notice dates later than today are among them, and every one of the twelve is the number's day with day and month
-- EXCHANGED AND A DAY EARLY (number 12 Oct -> stored 9 Dec; number 12 Jun -> stored 5 Dec). Seven deductions are out of order: two discovered after the case was submitted
-- (one case), five discovered before the money was received (one case).
--
-- WHAT THIS CHANGES, AND ONLY THIS. Nothing is guessed: a row is changed only when the row itself proves the repair.
--   * A NOTICE (imported: its upload date is set) is changed ONLY WHEN ALL THREE HOLD: (1) its notice date is LATER THAN THE DAY IT WAS UPLOADED (a register sent on 12 Oct
--     cannot hold a notice dated 9 Dec: the date is wrong); (2) its number (HMCL/<initials>/<dd>/<mm>/<yyyy>, TEXT, which no date reader ever touched) carries a real day that
--     is not later than the upload day; (3) the stored date IS that day with day and month exchanged, or exchanged and a day early: an exact relation between two stored
--     values, the shape of all twelve. The notice date is written back as the number's day. Its stamp (created_at) moves with it ONLY IF the stamp's own day is also later than
--     the upload day and is that same exchange: it goes to the number's day at the same time of day in East Africa. The notice's recoveries kept in notice_payment_ledger
--     (RUN-ME-041a, by notice date) move with the date, so they stay on the notice; a ledger row that would meet the same payment already kept at the new date stays where
--     it is. Every ledger row moved is written to notice_ledger_date_move_log, so the undo puts back exactly those and no other.
--   * A DEDUCTION's discovery date is changed ONLY WHEN ALL HOLD: it is LATER THAN THE DAY THE CASE WAS SUBMITTED (impossible); the submission day itself cannot be read two
--     ways (its day is over twelve, or the same as its month); the discovery date has another reading (day twelve or under, and not the month); that reading is not after the
--     submission day, and not before the money was received under EITHER reading of the received date. ONE reading fits, so it is written. A deduction discovered BEFORE the
--     money was received is NOT changed: exchanging the discovery date, or the received date, or both, can each put the dates in order, and the file cannot say which one was
--     read the wrong way round. The answer prints each such case with the readings that fit, so the right dates can be said once, from the register.
--
-- LEFT EXACTLY AS THEY ARE, AND COUNTED: every notice dated after its upload day that fails one of the three tests; every imported notice whose date merely differs from its
-- number (the answer describes them: how far, which way, how often, with examples: the next step is built from that and nothing else); every app-made notice; every deduction not
-- in the list above.
--
-- EVERY ROW CHANGED is written to demand_notice_date_repair_log / pmo_deduction_date_repair_log / notice_ledger_date_move_log with its old and new values; the undo is at the foot, commented out. A row in a
-- log is never changed again, so this is SAFE TO RUN AGAIN (a second run changes nothing and says so), and an undone row stays undone.
--
-- COST. About 1,200 rows read, a few written: a fraction of a second (every step that reads a number is MATERIALIZED, as in RUN-ME-067). A 3-second lock limit keeps it from
-- waiting behind anything, a 30-second ceiling rolls it all back whole. Nothing on /api/upload or /api/call.
-- PRINTS: counts, dates and the first eight characters of a row id. NO NAME, NO LOAN NUMBER, NO NOTICE NUMBER, no amount.
-- =====================================================================================
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local jit = off;

do $$
begin
  if to_regclass('public.notice_payment_ledger') is null then
    raise exception 'Run db/RUN-ME-041a first: the recoveries of a notice are kept in notice_payment_ledger by the notice date, and this file moves them with the date. Nothing was changed.';
  end if;
end $$;

create table if not exists public.demand_notice_date_repair_log (
  id uuid primary key,                       -- the notice that was changed
  repaired_at timestamptz not null default now(),
  notice_old date, notice_new date,
  stamp_old timestamptz, stamp_new timestamptz
);
alter table public.demand_notice_date_repair_log enable row level security;

create table if not exists public.pmo_deduction_date_repair_log (
  id uuid primary key,                       -- the deduction that was changed
  repaired_at timestamptz not null default now(),
  discovery_old date, discovery_new date
);
alter table public.pmo_deduction_date_repair_log enable row level security;

create table if not exists public.notice_ledger_date_move_log (
  ref text not null, payment_id uuid not null,     -- the ledger row that was moved to its notice's corrected date
  since_old date not null, since_new date not null,
  moved_at timestamptz not null default now(),
  primary key (ref, payment_id, since_new)
);
alter table public.notice_ledger_date_move_log enable row level security;

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
         v.cl::date as cd,
         (l.id is not null) as was_fixed
  from v left join public.demand_notice_date_repair_log l on l.id = v.id
),
cand as (     -- imported notices dated after the day they were uploaded, not changed before
  select w.* from w where w.ud is not null and w.nd is not null and w.nd > w.ud and not w.was_fixed
),
ok as (       -- the proof: the number carries a day that is possible, and the stored date is that day exchanged, exactly or a day early
  select c.*,
         case when c.cd > c.ud and c.cd in (c.isw, c.isw - 1)
              then ((c.idd + c.cl::time) at time zone 'Africa/Dar_es_Salaam') else c.ca end as ca_new
  from cand c
  where c.idd is not null and c.idd <= c.ud and c.isw is not null and c.nd in (c.isw, c.isw - 1)
),
lg as (
  insert into public.demand_notice_date_repair_log (id, notice_old, notice_new, stamp_old, stamp_new)
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
led as (      -- the recoveries kept for the notice follow its date (a row that would meet one already there stays where it is)
  update public.notice_payment_ledger l set since = o.idd
    from ok o
   where l.ref = o.ref and l.since = o.nd
     and not exists (select 1 from public.notice_payment_ledger x where x.ref = l.ref and x.since = o.idd and x.payment_id = l.payment_id)
  returning l.ref, l.payment_id, o.nd as since_old, o.idd as since_new
),
llg as (
  insert into public.notice_ledger_date_move_log (ref, payment_id, since_old, since_new)
  select e.ref, e.payment_id, e.since_old, e.since_new from led e
  on conflict do nothing
  returning ref
),
rest as (     -- the imported notices whose date is still not the day their number says, after this run
  select w.* from w
  where w.ud is not null and w.nd is not null and w.idd is not null and w.nd <> w.idd
    and not exists (select 1 from ok where ok.id = w.id)
),
ex as (       -- up to eight of them, the latest dates first
  select r.*, row_number() over (order by r.nd desc, r.id) as rn from rest r
),
offs as (     -- the most common differences (stored date minus the number's day, in days)
  select t.dif, t.n, row_number() over (order by t.n desc, t.dif) as rk
  from (select (r.nd - r.idd) as dif, count(*) as n from rest r group by 1) t
),
pd as materialized (        -- every PMO deduction: its case, the day it was submitted (East Africa), the money received, the discovery
  select p.id, coalesce(p.case_id, p.id::text) as cid, (p.submitted_at at time zone 'Africa/Dar_es_Salaam')::date as sd,
         p.received_date as rd, p.discovery_date as dc
  from public.pmo_deductions p
),
pe as materialized (        -- each of the three dates read the other way round (only a day twelve or under, and not the month, has another reading)
  select pd.*,
         case when pd.dc is not null and extract(day from pd.dc) <= 12 and extract(day from pd.dc) <> extract(month from pd.dc)
              then make_date(extract(year from pd.dc)::int, extract(day from pd.dc)::int, extract(month from pd.dc)::int) end as dsw,
         case when pd.rd is not null and extract(day from pd.rd) <= 12 and extract(day from pd.rd) <> extract(month from pd.rd)
              then make_date(extract(year from pd.rd)::int, extract(day from pd.rd)::int, extract(month from pd.rd)::int) end as rsw,
         case when extract(day from pd.sd) <= 12 and extract(day from pd.sd) <> extract(month from pd.sd)
              then make_date(extract(year from pd.sd)::int, extract(day from pd.sd)::int, extract(month from pd.sd)::int) end as ssw,
         (l.id is not null) as was_fixed
  from pd left join public.pmo_deduction_date_repair_log l on l.id = pd.id
),
pl as (       -- discovered after the day the case was submitted, not changed before
  select pe.* from pe where pe.dc is not null and pe.dc > pe.sd and not pe.was_fixed
),
pok as (      -- ONE reading fits: the submission day cannot be read two ways, and the other reading of the discovery is not after it nor before the money (either reading of it)
  select pl.* from pl
  where pl.ssw is null and pl.dsw is not null and pl.dsw <= pl.sd
    and (pl.rd is null or (pl.rd <= pl.dsw and (pl.rsw is null or pl.rsw <= pl.dsw)))
),
dlg as (
  insert into public.pmo_deduction_date_repair_log (id, discovery_old, discovery_new)
  select o.id, o.dc, o.dsw from pok o
  on conflict (id) do nothing
  returning id
),
dupd as (
  update public.pmo_deductions p set discovery_date = o.dsw
    from pok o
   where p.id = o.id and p.discovery_date = o.dc
  returning p.id
),
pb as (       -- discovered before the money was received: cases, and which readings put the three dates in order
  select pe.cid, pe.rd, pe.dc, pe.sd, count(*) as n, min(pe.dsw) as dsw, min(pe.rsw) as rsw,
         (min(pe.dsw) is not null and min(pe.dsw) >= pe.rd and min(pe.dsw) <= pe.sd) as ok_d,
         (min(pe.rsw) is not null and min(pe.rsw) <= pe.dc and pe.dc <= pe.sd) as ok_r,
         (min(pe.rsw) is not null and min(pe.dsw) is not null and min(pe.rsw) <= min(pe.dsw) and min(pe.dsw) <= pe.sd) as ok_b
  from pe where pe.dc is not null and pe.rd is not null and pe.rd > pe.dc and not pe.was_fixed
  group by pe.cid, pe.rd, pe.dc, pe.sd
),
pbn as (select pb.*, row_number() over (order by pb.sd desc, pb.rd, pb.dc, pb.cid) as rn from pb)
select z.what, z.answer from (
  select 0 as ord, 'ANSWER' as what,
         case when (select count(*) from cand) + (select count(*) from pl) = 0
              then 'no imported notice is dated after the day it was uploaded and no deduction was discovered after it was submitted: nothing was changed'
              else to_char((select count(*) from upd), 'FM999,999,999') || ' notice date(s) put back to the day their number says (' || to_char((select count(*) from ok where ca_new <> ca), 'FM999,999,999')
                   || ' stamp(s) with them, ' || to_char((select count(*) from led), 'FM999,999,999') || ' ledger row(s) moved); ' || to_char((select count(*) from cand) - (select count(*) from ok), 'FM999,999,999')
                   || ' notice(s) dated after their upload day left alone; ' || to_char((select count(*) from dupd), 'FM999,999,999') || ' deduction discovery date(s) put right; '
                   || to_char((select count(*) from pl) - (select count(*) from pok), 'FM999,999,999') || ' discovered after the submission and left alone' end as answer
  union all
  select 1, 'imported notices (upload date set): all / dated after the day they were uploaded (not changed before)',
         to_char((select count(*) from w where ud is not null), 'FM999,999,999') || ' / ' || to_char((select count(*) from cand), 'FM999,999,999')
  union all
  select 2, '    of those, proved: the number carries a day not later than the upload day AND the stored date is that day exchanged (exactly or a day early)',
         to_char((select count(*) from ok), 'FM999,999,999')
  union all
  select 3, 'notice dates written back to the number''s day: by THIS run / by earlier runs',
         to_char((select count(*) from upd), 'FM999,999,999') || ' / ' || to_char((select count(*) from w where was_fixed), 'FM999,999,999')
  union all
  select 4, '    stamps (created_at) that carried the same impossible day, moved with them / ledger rows moved with the date',
         to_char((select count(*) from ok where ca_new <> ca), 'FM999,999,999') || ' / ' || to_char((select count(*) from led), 'FM999,999,999')
  union all
  select 5, 'dated after the upload day and LEFT ALONE: the number carries no possible day, or a day later than the upload / the stored date is not that day exchanged',
         to_char((select count(*) from cand c where not (c.idd is not null and c.idd <= c.ud)), 'FM999,999,999') || ' / '
         || to_char((select count(*) from cand c where c.idd is not null and c.idd <= c.ud and not (c.isw is not null and c.nd in (c.isw, c.isw - 1))), 'FM999,999,999')
  union all
  select 10, 'imported notices whose date still is not the day their number says (after this run): all / of them dated after the upload day',
         to_char((select count(*) from rest), 'FM999,999,999') || ' / ' || to_char((select count(*) from rest where nd > ud), 'FM999,999,999')
  union all
  select 11, '    stored date minus the number''s day: one day early / one day late / within a week / further',
         to_char((select count(*) from rest where nd - idd = -1), 'FM999,999,999') || ' / ' || to_char((select count(*) from rest where nd - idd = 1), 'FM999,999,999') || ' / '
         || to_char((select count(*) from rest where abs(nd - idd) between 2 and 7), 'FM999,999,999') || ' / ' || to_char((select count(*) from rest where abs(nd - idd) > 7), 'FM999,999,999')
  union all
  select 12, '    stored date against the number''s day EXCHANGED: exactly / a day early / a day late / other / the number''s day cannot be exchanged',
         to_char((select count(*) from rest where nd = isw), 'FM999,999,999') || ' / ' || to_char((select count(*) from rest where nd = isw - 1), 'FM999,999,999') || ' / '
         || to_char((select count(*) from rest where nd = isw + 1), 'FM999,999,999') || ' / '
         || to_char((select count(*) from rest where isw is not null and nd not in (isw, isw - 1, isw + 1)), 'FM999,999,999') || ' / ' || to_char((select count(*) from rest where isw is null), 'FM999,999,999')
  union all
  select 13, '    the most common differences, stored minus number''s day in days (days: how many; the eight most common)',
         coalesce((select string_agg(t.dif::text || ': ' || t.n::text, ', ' order by t.rk) from offs t where t.rk <= 8), 'none')
  union all
  select 14, '    stamp (created_at) day against the stored date / against the number''s day / against neither',
         to_char((select count(*) from rest where cd = nd), 'FM999,999,999') || ' / ' || to_char((select count(*) from rest where cd = idd and cd <> nd), 'FM999,999,999') || ' / '
         || to_char((select count(*) from rest where cd <> nd and cd <> idd), 'FM999,999,999')
  union all
  select 20 + e.rn::int, '    e.g. notice ' || left(e.id::text, 8),
         'stored ' || e.nd::text || ', number says ' || e.idd::text || ' (stored minus number: ' || (e.nd - e.idd)::text || ' days)'
         || case when e.isw is not null then ', exchanged ' || e.isw::text || ' (stored minus exchanged: ' || (e.nd - e.isw)::text || ')' else ', cannot be exchanged' end
         || ', stamp ' || e.cd::text || ', uploaded ' || e.ud::text
  from ex e where e.rn <= 8
  union all
  select 40, 'PMO deductions: all / discovered after the day the case was submitted (not changed before) / put right by THIS run / by earlier runs',
         to_char((select count(*) from pe), 'FM999,999,999') || ' / ' || to_char((select count(*) from pl), 'FM999,999,999') || ' / ' || to_char((select count(*) from dupd), 'FM999,999,999')
         || ' / ' || to_char((select count(*) from pe where was_fixed), 'FM999,999,999')
  union all
  select 41, '    discovered after the submission and LEFT ALONE (the submission day can be read two ways, or no single reading puts the dates in order)',
         to_char((select count(*) from pl) - (select count(*) from pok), 'FM999,999,999')
  union all
  select 42, 'discovered BEFORE the money was received, left alone (the file cannot tell which date was read the wrong way round): rows / cases',
         to_char((select coalesce(sum(n), 0) from pb), 'FM999,999,999') || ' / ' || to_char((select count(*) from pb), 'FM999,999,999')
  union all
  select 50 + b.rn::int, '    case of ' || b.n::text || ' row(s)',
         'money received ' || b.rd::text || ', discovered ' || b.dc::text || ', submitted ' || b.sd::text || '; in order if ONLY the discovery is exchanged: '
         || case when b.ok_d then 'yes (' || b.dsw::text || ')' else 'no' end || '; ONLY the received date: ' || case when b.ok_r then 'yes (' || b.rsw::text || ')' else 'no' end
         || '; BOTH: ' || case when b.ok_b then 'yes (' || b.rsw::text || ' / ' || b.dsw::text || ')' else 'no' end
  from pbn b where b.rn <= 6
) z
order by z.ord;

-- UNDO: take the two dashes off the lines below, run them, and every row the logs name goes back to what it was uploaded with. The logs keep their rows, so a row undone is not changed again.
-- update public.notice_payment_ledger l set since = m.since_old from public.notice_ledger_date_move_log m where l.ref = m.ref and l.payment_id = m.payment_id and l.since = m.since_new and not exists (select 1 from public.notice_payment_ledger x where x.ref = m.ref and x.payment_id = m.payment_id and x.since = m.since_old);
-- update public.demand_notices n set notice_date = g.notice_old, created_at = g.stamp_old from public.demand_notice_date_repair_log g where n.id = g.id and n.notice_date = g.notice_new;
-- update public.pmo_deductions p set discovery_date = g.discovery_old from public.pmo_deduction_date_repair_log g where p.id = g.id and p.discovery_date = g.discovery_new;
