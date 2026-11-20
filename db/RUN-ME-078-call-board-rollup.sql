-- RUN-ME-078  THE CALL BOARD OF THE DASHBOARD AND THE PRESENTATION, AS ONE SMALL ANSWER (20 Nov 2026). DB only: no screen changes, nothing is deployed with it.
-- "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner. pg_stat_statements put this read second in the whole book: select officer, team, duration, portfolio ... from call_logs for the whole week ran 121,746 times, 577 ms on average, 7,654 ms at worst, 70,285 seconds in all (22% of the twelve heaviest statements put together).
-- WHAT THE BOARD NEEDS is one line of figures per officer, for the week and for today. Until now the app downloaded EVERY call of the week (all teams for an admin), in pages of ten thousand, each page running the whole query again and sorting the whole week by id again, and added them up in JavaScript (callRollupRows in api/_lib/call-core.js: a number rung is one call per day however many times it was dialled; talk time is portfolio talk time; the dials ride beside).
-- This function does that adding up inside the database and answers ONE value: {"w": [...the week...], "t": [...today...]}, one object per officer NAME (the board is drawn by the name each call was filed under, not by user_id), in the order the officers first appear, with the same eight figures callTotals gives and the first team they were filed under. No paging, no row cap.
-- IT IS EXACTLY THE BOARD'S OWN RULE, NOT RUN-ME-042's: the board's query never selected the category column, so every portfolio call has always been counted as one kind. This function ignores category too, so no figure on the board changes when it is switched on. (The Calls tab and Ripoti count by user_id and category with call_report_rollup: untouched.)
-- MEASURED by tools/db-checks/call-board-rollup.mjs on a PostgreSQL made from the real schema, 800,000 call-log rows (forty days of 20,000, 300 officers), the old read's fifteen statements against this one, in buffers touched (hits and reads together), warm, on the test machine:
--   rows of a day together on the table:   old 279,451 pages, 2.5 s, 20.9 MB  ->  this 3,236 pages, 0.68 s, 104 KB
--   every row in a random place (worst):   old 2,436,420 pages, 3.8 s, 20.9 MB  ->  this 14,616 pages, 0.66 s, 104 KB
--   That is 86 to 167 times fewer pages, 3.7 to 5.8 times less database time and 205 times fewer bytes. The live seconds are NOT known: the live table is bigger and on disk. The check compares the answer with the app's own adding-up (boardRowsFromLogs) on 150 random books and breaks this file on purpose: every break is caught.
-- WHAT IT COSTS: nothing to /api/upload or /api/call (a portal screen). It reads one week of call_logs through the existing date index and changes no row; no index is added (call_logs is written by the phones' sync: the sacred path).
-- UNTIL IT IS RUN the app reads the week page by page exactly as it always did and asks for the function again every five minutes. If the function ever fails the same happens: never a failed board, never heavier than before. Safe to run again (create or replace). Only service_role may call it.
-- HOW TO RUN: paste all of it into a NEW SQL editor tab and press Run. The last line before the END line answers two numbers.
create or replace function call_board_rollup(p_from date, p_to date, p_day date, p_teams text[] default null)
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
with p as (select E' \t\n\r\f\x0b\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff' as ws),
base as (
select c.id, c.call_date,
coalesce(nullif(btrim(c.officer, p.ws), ''), '(unknown)') as officer,
c.team as raw_team, coalesce(c.team, '') as team,
coalesce(c.phone, '') as phone, coalesce(c.ref, '') as ref,
coalesce(c.duration, 0) as duration, coalesce(c.portfolio, false) as portfolio,
upper(btrim(coalesce(c.outcome, ''), p.ws)) not in ('MISSED', 'REJECTED', 'BLOCKED') as connected
from public.call_logs c cross join p
where c.call_date >= p_from and c.call_date <= p_to
and (p_teams is null or c.team = any (p_teams))
),
byphone as (
select officer, call_date, team, portfolio, phone, sum(duration) as dur, bool_or(connected) as connected
from base
group by officer, call_date, team, portfolio, phone
),
dg as (
select officer, call_date, team, portfolio, count(*) as n, sum(dur) as dur, count(*) filter (where connected) as reached
from byphone
group by officer, call_date, team, portfolio
),
dsum as (
select 'w'::text as scope, officer,
sum(n)::bigint as calls,
coalesce(sum(n) filter (where portfolio), 0)::bigint as portfolio,
coalesce(sum(n) filter (where not portfolio), 0)::bigint as non_portfolio,
coalesce(sum(dur) filter (where portfolio), 0)::bigint as duration,
coalesce(sum(dur) filter (where not portfolio), 0)::bigint as other_duration,
sum(reached)::bigint as connected
from dg
group by officer
union all
select 't'::text, officer,
sum(n)::bigint,
coalesce(sum(n) filter (where portfolio), 0)::bigint,
coalesce(sum(n) filter (where not portfolio), 0)::bigint,
coalesce(sum(dur) filter (where portfolio), 0)::bigint,
coalesce(sum(dur) filter (where not portfolio), 0)::bigint,
sum(reached)::bigint
from dg
where call_date = p_day
group by officer
),
meta as (
select 'w'::text as scope, officer, count(*)::bigint as dials, min(id) as first_id,
coalesce((array_agg(raw_team order by id) filter (where coalesce(raw_team, '') <> ''))[1], '') as team,
(count(distinct coalesce(nullif(ref, ''), phone)) filter (where portfolio))::bigint as customers
from base
group by officer
union all
select 't'::text, officer, count(*)::bigint, min(id),
coalesce((array_agg(raw_team order by id) filter (where coalesce(raw_team, '') <> ''))[1], ''),
(count(distinct coalesce(nullif(ref, ''), phone)) filter (where portfolio))::bigint
from base
where call_date = p_day
group by officer
),
rowsj as (
select m.scope, m.first_id,
jsonb_build_object('name', m.officer, 'team', m.team, 'dials', m.dials, 'calls', d.calls,
'duration', d.duration, 'otherDuration', d.other_duration, 'portfolio', d.portfolio,
'nonPortfolio', d.non_portfolio, 'connected', d.connected, 'customers', m.customers) as j
from meta m join dsum d on d.scope = m.scope and d.officer = m.officer
)
select jsonb_build_object(
'w', coalesce((select jsonb_agg(j order by first_id) from rowsj where scope = 'w'), '[]'::jsonb),
't', coalesce((select jsonb_agg(j order by first_id) from rowsj where scope = 't'), '[]'::jsonb));
$$;
revoke execute on function call_board_rollup(date, date, date, text[]) from public, anon, authenticated;
grant execute on function call_board_rollup(date, date, date, text[]) to service_role;
-- DID IT LAND? One row: how many officers have calls this week, and how many today (the database's own date: UTC, the week from Monday).
select jsonb_array_length(r->'w') as officers_this_week, jsonb_array_length(r->'t') as officers_today
from (select call_board_rollup(date_trunc('week', current_date)::date, date_trunc('week', current_date)::date + 6, current_date, null) as r) x;
-- UNDO, alone: drop function if exists call_board_rollup(date, date, date, text[]);
-- END OF THE SCRIPT: if the editor shows this line, the whole text arrived.
