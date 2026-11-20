-- RUN-ME-074  REMOVE DUPLICATE DEMAND NOTICES BY REF NO ("SQL to delete duplicate demand notices by ref no", the owner, 20 Nov 2026).
-- A notice belongs to its customer's ref (blanks trimmed, any case). In each group ONE notice stays: the one issued first (earliest notice date, then earliest issue time). Every other notice of the group is copied whole to public.demand_notices_removed and then deleted, in one statement: all of it or none.
-- THE WORD ON THE LINE MARKED CHANGE: DAY (as sent) removes a repeat served on the SAME DAY as an earlier notice of that ref, the officer pressing Issue again. REF removes every later notice of the ref, whatever its day: a customer served again a week later loses that second notice too.
-- Nothing else is touched: no payment, no recoveries ledger, no deck. A second run finds nothing to remove. The answer is one row; the undo is at the foot.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local jit = off;
create table if not exists public.demand_notices_removed (
removed_at timestamptz not null default now(), label text not null, kept_id uuid, notice jsonb not null
);
alter table public.demand_notices_removed enable row level security;
-- CHANGE: the word between the quotes on the next line is DAY or REF.
with cfg as (select 'DAY'::text as mode),
src as (
select d.id, d.notice_id, d.notice_date, d.created_at, upper(btrim(d.ref)) as rk
from public.demand_notices d
where nullif(btrim(d.ref), '') is not null
),
ranked as (
select s.id, s.rk, s.notice_date, c.mode,
row_number() over w as rn, first_value(s.id) over w as keep_id
from src s cross join cfg c
window w as (partition by s.rk, case when c.mode = 'DAY' then s.notice_date::text end order by s.notice_date, s.created_at, (s.notice_id is null), s.id)
),
doomed as (
select r.id, r.keep_id from ranked r where r.rn > 1 and r.mode in ('DAY', 'REF')
),
saved as (
insert into public.demand_notices_removed (label, kept_id, notice)
select 'DUPLICATE NOTICES 20 NOV (SQL)', x.keep_id, to_jsonb(d)
from doomed x join public.demand_notices d on d.id = x.id
returning kept_id
),
gone as (
delete from public.demand_notices d using doomed x where d.id = x.id returning d.id
)
select c.mode,
case when c.mode in ('DAY', 'REF') then 'DONE' else 'NOTHING DONE: the word on the CHANGE line must be DAY or REF' end as result,
(select count(*) from src) as notices_with_a_ref,
(select count(distinct rk) from ranked where rn > 1) as refs_with_repeats,
(select count(*) from gone) as notices_removed,
(select count(*) from src) - (select count(*) from gone) as notices_left,
(select count(*) from (select rk from src group by rk having count(distinct notice_date) > 1) q) as refs_served_on_more_than_one_day
from cfg c;
-- UNDO: take the two dashes off the line below and run it; every notice this script removed is put back as it was (the copy stays).
-- insert into public.demand_notices select (jsonb_populate_record(null::public.demand_notices, x.notice)).* from public.demand_notices_removed x where x.label = 'DUPLICATE NOTICES 20 NOV (SQL)' on conflict do nothing;
-- END OF THE SCRIPT: if the editor shows this line, the whole text arrived.
