-- RUN-ME-091  REMOVE THE REPEATED PMO DEDUCTION CASES (the owner, 25 Nov 2026: one case was saved sixteen times by repeated presses of Save; "delete all [the repeated rows] in the existing deductions ... and prevent such an issue in the future". The portal no longer lets a repeat in: the same submission is now the same case).
-- A CASE is one submission (its case_id); its lines are the accused staff. Two cases are REPEATS of each other when every line says the same thing: reporter, team, customer, REF NO, accused staff, amount taken, the two dates, the decision, the deduction and the amount to pay (blanks at the ends aside). The time it was saved, the case id and HR's columns are not compared.
-- In a group of repeats ONE case stays: the one HR has recorded on (notes or a deduction), else the one saved first. A case HR has recorded on is NEVER removed, whatever else is true; the answer counts those.
-- THE WORD ON THE LINE MARKED CHANGE: PRESS (as sent) removes the repeats saved within 30 minutes of the case that stays, the double press. ANY removes every repeat, whatever the time. COUNT changes nothing and says what PRESS and ANY would remove.
-- Every removed case is first copied whole (each line, as JSON) to pmo_deductions_removed. A second run finds nothing to remove. One answer row. The undo is at the foot.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local jit = off;
create table if not exists public.pmo_deductions_removed (
removed_at timestamptz not null default now(), label text not null, kept_case text, line jsonb not null
);
alter table public.pmo_deductions_removed enable row level security;
-- CHANGE: the word between the quotes on the next line is PRESS, ANY or COUNT.
with cfg as (select 'PRESS'::text as mode),
lines as (
select d.id, coalesce(d.case_id, d.id::text) as ck, d.submitted_at,
concat_ws(chr(31), btrim(coalesce(d.reporter, '')), btrim(coalesce(d.team, '')), btrim(coalesce(d.customer, '')), btrim(coalesce(d.ref, '')), btrim(coalesce(d.staff, '')), coalesce(d.amount_taken::text, ''), coalesce(d.received_date::text, ''), coalesce(d.discovery_date::text, ''), btrim(coalesce(d.decision, '')), coalesce(d.deduction::text, ''), coalesce(d.to_pay::text, '')) as txt,
(d.hr_at is not null or d.hr_by is not null or coalesce(d.deducted, 0) <> 0 or coalesce(d.remaining, 0) <> 0 or nullif(btrim(coalesce(d.hr_notes, '')), '') is not null) as hr
from public.pmo_deductions d
),
cases as (
select l.ck, min(l.submitted_at) as at, bool_or(l.hr) as hr, md5(string_agg(l.txt, chr(30) order by l.txt)) as sig
from lines l group by l.ck
),
ranked as (
select c.ck, c.at, c.hr, row_number() over w as rn, first_value(c.ck) over w as keep_ck, first_value(c.at) over w as keep_at
from cases c
window w as (partition by c.sig order by c.hr desc, c.at, c.ck)
),
repeats as (
select r.ck, r.keep_ck, r.hr, abs(extract(epoch from (r.at - r.keep_at))) <= 1800 as press
from ranked r where r.rn > 1
),
doomed as (
select f.ck, f.keep_ck from repeats f cross join cfg c
where not f.hr and ((c.mode = 'PRESS' and f.press) or c.mode = 'ANY')
),
saved as (
insert into public.pmo_deductions_removed (label, kept_case, line)
select 'REPEATED DEDUCTION CASES 25 NOV (SQL)', x.keep_ck, to_jsonb(d)
from doomed x join public.pmo_deductions d on coalesce(d.case_id, d.id::text) = x.ck
returning kept_case
),
gone as (
delete from public.pmo_deductions d using doomed x where coalesce(d.case_id, d.id::text) = x.ck returning d.id
)
select c.mode,
case when c.mode = 'COUNT' then 'COUNTED: nothing was changed' when c.mode in ('PRESS', 'ANY') then 'DONE' else 'NOTHING DONE: the word on the CHANGE line must be PRESS, ANY or COUNT' end as result,
(select count(*) from cases) as cases,
(select count(*) from repeats) as repeat_cases,
(select count(*) from repeats where not hr and press) as press_removes,
(select count(*) from repeats where not hr) as any_removes,
(select count(*) from repeats where hr) as kept_because_hr_recorded,
(select count(*) from doomed) as cases_removed,
(select count(*) from gone) as lines_removed,
(select count(*) from lines) - (select count(*) from gone) as lines_left
from cfg c;
-- UNDO: take the two dashes off the line below and run it; every line this script removed is put back as it was (the copy stays).
-- insert into public.pmo_deductions select (jsonb_populate_record(null::public.pmo_deductions, x.line)).* from public.pmo_deductions_removed x where x.label = 'REPEATED DEDUCTION CASES 25 NOV (SQL)' on conflict do nothing;
-- END OF THE SCRIPT: if the editor shows this line, the whole text arrived.
