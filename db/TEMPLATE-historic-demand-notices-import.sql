-- TEMPLATE: THE DEMAND NOTICES ISSUED BEFORE THE SYSTEM BEGAN, IMPORTED FROM THE LEGAL TEAM'S SHEET. 23 Nov 2026 (handbook Part 138).
-- "We have our system demands from mid-May 2026, but the notices were supplied since 2025 so am sending you the file so that you
-- extract all those that don't exist in the system and add their respective columns that fit into the system by sql - so that we
-- capture all the demands' recovery in current and past weeks data inclusive" ... "So if we have a ref no never exist from our
-- systems first upload of 2026, it was 'CLEARED' by default of one month after issued date." -- the owner, 23 Nov 2026.
-- A FILLED COPY CARRIES CUSTOMERS' NAMES: IT IS PASTED IN THE CHAT AND NEVER COMMITTED. This file holds made-up lines only.
-- TWO KINDS OF BLOCK, each pasted alone in a NEW tab, each under 10,000 characters, flush-left, ending with its END line:
-- (1) DATA BLOCKS (the next block, as many as the sheet needs): they fill a private list, public.demand_import_2025, one row for
-- each row of the sheet that has a loan number. They change no notice and can be run again (a line run again is replaced).
-- A BLOCK CARRIES THE FINGERPRINT OF ITS OWN LINES (md5 of the lines, blanks at their ends and empty lines aside): a block that was
-- cut, or in which one character differs, writes NOTHING and its answer says so. The engine in turn writes nothing unless the list
-- holds exactly the number of rows it was built for, so a block left out cannot become half an import.
-- A line is: sheet row|officer code|customer|loan number|team|principal|total loan|total paid|arrears at notice|date YYMMDD|how|cell
-- "how" says how the date was read: T text, day first; C text, corrected (the cell follows); X a date cell with day and month
-- exchanged (as stored it is outside the sheet's period); x exchanged because that officer's sheet exchanges; S a date cell as
-- stored; s as stored because that officer's sheet reads dates right; U nobody can read it (no date; the cell follows).
-- (2) THE ENGINE (the last block): it counts, and with the word IMPORT it writes. See its own header.
-- ===== DATA BLOCK 1 OF 1 =====
create table if not exists public.demand_import_2025 (
line integer primary key, issued_by text, name text, ref text not null, team text,
principal numeric(14,2), total_loan numeric(14,2), total_paid numeric(14,2), arrears numeric(14,2),
notice_date date, how text, cell text, staged_at timestamptz not null default now());
alter table public.demand_import_2025 enable row level security;
revoke all on public.demand_import_2025 from anon, authenticated;
with b as materialized (select $d$
2|A|CUSTOMER ONE|9900000001|TEAM ONE|700000|952000|587000|365000|251015|T|
3|B|CUSTOMER TWO|9900000002|TEAM TWO|500000|680000||387500|260107|X|
4|A|CUSTOMER THREE|9900000003|TEAM ONE||||||U|31/04/2026
$d$::text as t),
ln as materialized (select btrim(replace(x.l, chr(13), '')) as l, x.n from b, regexp_split_to_table(b.t, E'\n') with ordinality as x(l, n)),
ok as materialized (select coalesce(md5(string_agg(l, E'\n' order by n)), '') = '309098f36b91f239a0c683f94cee8ebe' as ok from ln where l <> ''), -- the lines' own fingerprint
ins as (insert into public.demand_import_2025 (line, issued_by, name, ref, team, principal, total_loan, total_paid, arrears, notice_date, how, cell)
select split_part(l, '|', 1)::integer,
case split_part(l, '|', 2) when 'A' then 'OFFICER ONE' when 'B' then 'OFFICER TWO' else split_part(l, '|', 2) end,
split_part(l, '|', 3), split_part(l, '|', 4), split_part(l, '|', 5),
nullif(split_part(l, '|', 6), '')::numeric, nullif(split_part(l, '|', 7), '')::numeric,
nullif(split_part(l, '|', 8), '')::numeric, nullif(split_part(l, '|', 9), '')::numeric,
to_date(nullif(split_part(l, '|', 10), ''), 'YYMMDD'), split_part(l, '|', 11), nullif(split_part(l, '|', 12), '')
from ln where l <> '' and (select ok from ok)
on conflict (line) do update set issued_by = excluded.issued_by, name = excluded.name, ref = excluded.ref, team = excluded.team,
principal = excluded.principal, total_loan = excluded.total_loan, total_paid = excluded.total_paid, arrears = excluded.arrears,
notice_date = excluded.notice_date, how = excluded.how, cell = excluded.cell, staged_at = now() returning line),
n as (select (select count(*) from public.demand_import_2025 s where s.line not in (select line from ins)) + (select count(*) from ins) as c)
select case when not (select ok from ok) then 'DATA BLOCK 1 OF 1 DID NOT ARRIVE WHOLE: NOTHING WAS WRITTEN. Paste it again, all of it, in a NEW tab'
when (select c from n) < 3 then 'data block 1 of 1 is in, BUT A BLOCK BEFORE IT IS MISSING: run the blocks in order'
else 'data block 1 of 1: OK' end as block, (select c from n) as rows_in_the_list_now, 3 as rows_there_should_be_after_this_block;
-- END OF DATA BLOCK 1 OF 1
-- ===== THE ENGINE =====
-- HISTORIC DEMAND NOTICES: COUNT, THEN IMPORT. Run it AFTER every data block. ONE statement: all of it or none of it.
-- WITH THE WORD COUNT (as it is) IT CHANGES NOTHING and prints what an import would do. Read the answer; then change the word on
-- the line marked CHANGE to IMPORT and run it again. Any other word changes nothing. A second IMPORT writes 0. It writes ONLY
-- when the list holds the number of rows on the line under the CHANGE line (a missing or damaged data block: nothing is written).
-- WHAT IT IMPORTS: one notice for each row of the list whose date was read, once (a notice written twice in the sheet is one),
-- that the system does not hold: it holds a notice when it has one of that loan number within seven days of the sheet's date.
-- Columns: loan number, team, customer, notice date, arrears at notice, issued by; stamped at noon of its day. The phone is the
-- follow-up register's when the system holds that loan. Principal, total loan and total paid stay in the list (no column).
-- CLEARED BY DEFAULT: a customer whose loan number was never on a file of the system (the defaulters decks, the follow-up
-- register, and the expected sheets when they have an index by loan number) is recorded as having cleared ONE MONTH AFTER THEIR
-- LAST NOTICE of the sheet: one line in notice_payment_ledger for the arrears at that notice, marked 'default', under each of
-- their notices. With no arrears figure nothing is recorded.
-- WHAT IT COSTS: nothing to /api/upload or /api/call. The decks are asked through the (team, loan number) index, never read
-- end to end; a 45-second ceiling: if it is reached the answer is an error and nothing changed.
-- UNDO (the two lines at the foot, as one statement, alone).
set local statement_timeout = '45s';
set local lock_timeout = '3s';
set local enable_seqscan = off;
set local enable_hashjoin = off;
set local enable_mergejoin = off;
with recursive mode as (select upper(btrim('COUNT')) as m), -- CHANGE: COUNT changes nothing; IMPORT writes
whole as (select (select count(*) from public.demand_import_2025) = 3 as ok), -- ROWS THE LIST MUST HOLD: on any other count nothing is written
st as (select s.*, upper(btrim(s.ref)) as kref from public.demand_import_2025 s),
uniq as (select distinct on (kref, notice_date) * from st where notice_date is not null order by kref, notice_date, line),
mine as (select md5('notice|import2025|' || u.kref || '|' || u.notice_date)::uuid as id, u.* from uniq u),
alln as (select n.id, upper(btrim(n.ref)) as kref, n.notice_date, n.arrears_at_notice from public.demand_notices n where n.ref is not null and n.notice_date is not null),
cand as (select m.*, exists (select 1 from alln x where x.kref = m.kref and abs(x.notice_date - m.notice_date) <= 7) as in_system from mine m),
todo as (select * from cand where not in_system),
refs as (select distinct kref, ref from todo),
tm(team) as ((select d.team from public.defaulter_snapshots d order by d.team limit 1)
union all select (select d.team from public.defaulter_snapshots d where d.team > tm.team order by d.team limit 1) from tm where tm.team is not null),
hasidx as (select exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'repayment_snapshots' and indexdef ~* '\(ref\M') as ok),
known as (
select r.kref from refs r where exists (select 1 from public.followup_status f where f.ref = r.ref)
union select r.kref from refs r where exists (select 1 from tm where exists (select 1 from public.defaulter_snapshots d where d.team = tm.team and d.ref = r.ref))
union select r.kref from refs r where exists (select 1 from public.defaulter_snapshots d where d.team is null and d.ref = r.ref)
union select r.kref from refs r where (select ok from hasidx) and exists (select 1 from public.repayment_snapshots e where e.ref = r.ref)
),
lastn as (select distinct on (t.kref) t.kref, t.notice_date, t.arrears from todo t where t.kref not in (select kref from known) order by t.kref, t.notice_date desc),
clr as (select t.ref, t.notice_date as since, md5('cleared|import2025|' || l.kref)::uuid as payment_id, (l.notice_date + interval '1 month')::date as paid_at, l.arrears as amount
from lastn l join todo t on t.kref = l.kref where coalesce(l.arrears, 0) > 0),
ins as (insert into public.demand_notices (id, ref, team, full_name, contact, notice_date, arrears_at_notice, issued_by, created_at)
select t.id, t.ref, nullif(btrim(t.team), ''), t.name, (select f.contact from public.followup_status f where f.ref = t.ref limit 1), t.notice_date, t.arrears, t.issued_by,
(t.notice_date::timestamp + interval '9 hours') at time zone 'UTC'
from todo t where (select m from mode) = 'IMPORT' and (select ok from whole) on conflict (id) do nothing returning id),
led as (insert into public.notice_payment_ledger (ref, since, payment_id, paid_at, amount, matched_by)
select c.ref, c.since, c.payment_id, c.paid_at, c.amount, 'default' from clr c where (select m from mode) = 'IMPORT' and (select ok from whole) on conflict do nothing returning 1),
aft as (select kref, notice_date, arrears_at_notice from alln union all select kref, notice_date, arrears from todo t where t.id not in (select id from alln)),
own as (select 'now' as w, count(*) as c, coalesce(sum(a), 0) as o from (select distinct on (kref) kref, arrears_at_notice as a from alln order by kref, notice_date desc) q
union all select 'after', count(*), coalesce(sum(a), 0) from (select distinct on (kref) kref, arrears_at_notice as a from aft order by kref, notice_date desc) q)
select x.what, x.answer from (
select 1 as k, 'the word on the CHANGE line' as what, (select m || case when m = 'IMPORT' and not (select ok from whole) then ': NOT WRITTEN, the list is not whole (next line)' when m = 'IMPORT' then ': WRITTEN (see the last line)' when m = 'COUNT' then ': nothing was changed' else ': not COUNT or IMPORT, nothing was changed' end from mode) as answer
union all select 2, 'rows in the list (rows of the sheet with a loan number)', (select count(*) || case when (select ok from whole) then '' else ': NOT THE ROWS THIS ENGINE WAS BUILT FOR. A data block is missing or damaged: NOTHING IS WRITTEN' end from st)
union all select 3, 'of them with a date nobody can read: left out (their rows of the sheet)', (select count(*) || coalesce(': ' || string_agg(line::text, ', ' order by line), '') from st where notice_date is null)
union all select 4, 'a notice written twice in the sheet: counted once', (select (count(*) - (select count(*) from uniq))::text from st where notice_date is not null)
union all select 5, 'already in the system (a notice of that loan number within seven days): not imported', (select count(*)::text from cand where in_system)
union all select 6, 'NOTICES TO IMPORT / customers / arrears at notice TZS', (select count(*) || ' / ' || count(distinct kref) || ' / ' || to_char(coalesce(sum(arrears), 0), 'FM999,999,999,999,990') from todo)
union all select 7, 'by month of the notice', (select coalesce(string_agg(ym || ': ' || n, ', ' order by ym), 'none') from (select to_char(notice_date, 'YYYY-MM') as ym, count(*) as n from todo group by 1) q)
union all select 8, 'of them with no arrears figure (imported with it blank)', (select count(*)::text from todo where arrears is null)
union all select 9, 'customers never on a file of the system: CLEARED BY DEFAULT one month after their last notice / TZS', (select count(*) || ' / ' || to_char(coalesce(sum(arrears), 0), 'FM999,999,999,999,990') from lastn where coalesce(arrears, 0) > 0)
union all select 10, 'customers never on a file of the system with no arrears figure: nothing to record', (select count(*)::text from lastn where coalesce(arrears, 0) <= 0)
union all select 11, 'customers the system holds or has held: read from its own files from here on', (select count(*)::text from refs where kref in (select kref from known))
union all select 12, 'teams of the sheet that are not on Teams & Staff', (select coalesce(string_agg(distinct t.team, ', '), 'none') from todo t where coalesce(btrim(t.team), '') <> '' and not exists (select 1 from public.teams m where upper(btrim(m.team)) = upper(btrim(t.team))))
union all select 13, 'noticed customers: now -> after', (select max(c) filter (where w = 'now') || ' -> ' || max(c) filter (where w = 'after') from own)
union all select 14, 'owed at each customer''s latest notice TZS: now -> after', (select to_char(max(o) filter (where w = 'now'), 'FM999,999,999,999,990') || ' -> ' || to_char(max(o) filter (where w = 'after'), 'FM999,999,999,999,990') from own)
union all select 15, 'the expected sheets were asked too', (select case when ok then 'yes' else 'no: they have no index by loan number (the decks and the follow-up register were asked)' end from hasidx)
union all select 16, 'WRITTEN BY THIS RUN: notices / default clearances', (select count(*) from ins) || ' / ' || (select count(*) from led)
) x order by x.k;
-- UNDO, as one statement, alone (it removes what the import wrote and nothing else; the list stays):
-- with st as (select upper(btrim(ref)) as kref, notice_date from public.demand_import_2025 where notice_date is not null), a as (delete from public.notice_payment_ledger where matched_by = 'default' and payment_id in (select md5('cleared|import2025|' || kref)::uuid from st) returning 1), b as (delete from public.demand_notices where id in (select md5('notice|import2025|' || kref || '|' || notice_date)::uuid from st) returning 1) select (select count(*) from a) as clearances_removed, (select count(*) from b) as notices_removed;
-- END OF THE ENGINE
