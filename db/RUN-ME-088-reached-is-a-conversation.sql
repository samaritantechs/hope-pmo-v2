-- RUN-ME-088: REACHED MEANS SPOKEN TO. 23 Nov 2026 (handbook Part 137). ONE paste, in a NEW tab. Safe to run again.
-- "At calls slide in presentation "REACHED %" Should be percentage of connected calls against calls not just dialled b/se some ring
-- but dont get connected" -- the owner, 23 Nov 2026.
-- WHAT WAS WRONG: a phone has no word for "it rang and nobody took it", so every dial that was not MISSED, REJECTED or BLOCKED
-- counted as reached and Reached % sat near 100.
-- WHAT THIS DOES: a dial is CONNECTED only when it lasted LONGER than the setting "Minimum seconds to count a call" (CALL_MIN_SECS,
-- 5 unless you changed it: the rule that already ticks a customer "Amepigiwa leo"); a dial that rang out or ended inside it is
-- NO ANSWER; a number is REACHED on a day when one of its dials was CONNECTED. It replaces TWO functions IN PLACE (same names, same
-- arguments, same columns: call_report_rollup behind Ripoti, the Calls tab and the phone's report; call_board_rollup behind the
-- Presentation's calls slide) and adds one small one, call_min_secs(), which reads the setting. Each answer now says which minimum
-- it was counted by (the board: "min"; the report: 'MIN:5' on its number rows).
-- UNTIL IT IS RUN the screens show a dash for Reached and Reached % and name this file: never the old figure.
-- WHAT IT COSTS: nothing to /api/upload; on /api/call nothing is read that was not read (the same two functions, one more cell of
-- the settings table inside them). It reads call_logs and settings and changes no row. Checked by tools/db-checks/reached-rule.mjs.
-- UNDO: run db/RUN-ME-042 and then db/RUN-ME-078 again (they put the two functions back as they were).
-- THE ANSWER it prints: the minimum, the numbers rung in the last 7 days, how many were reached, and how many dials only rang.
create or replace function call_min_secs()
returns integer
language sql
stable
set search_path = public, pg_catalog
as $$
select least(coalesce(nullif(regexp_replace(coalesce((select s.value from public.settings s where s.key = 'CALL_MIN_SECS'), ''), '[^0-9]', '', 'g'), '')::numeric, 5), 2000000000)::integer;
$$;
create or replace function call_report_rollup(p_from date, p_to date, p_teams text[] default null)
returns table (kind text, day date, user_id text, team text, category text, outcome text,
portfolio boolean, calls bigint, dur bigint, uniq bigint)
language sql
stable
set search_path = public, pg_catalog
as $$
with m as materialized (select call_min_secs() as min),
scoped as (
select call_date, user_id::text as user_id, team::text as team,
coalesce(phone, '') as phone, coalesce(ref, '') as ref,
coalesce(duration, 0) as duration, coalesce(portfolio, false) as portfolio,
case when not coalesce(portfolio, false) then 'OTHER'
when upper(btrim(coalesce(category, ''))) in ('EXPECTED', 'DEFAULTER') then upper(btrim(category))
else 'UNCATEGORIZED' end as category,
case when upper(btrim(coalesce(outcome, ''))) in ('MISSED', 'REJECTED', 'BLOCKED') then upper(btrim(outcome))
when coalesce(duration, 0) > m.min then 'CONNECTED'
else 'NO ANSWER' end as outcome
from public.call_logs cross join m
where call_date >= p_from and call_date <= p_to
and (p_teams is null or upper(team) = any (select upper(t) from unnest(p_teams) t))
)
select 'g'::text, call_date, user_id, team, category, outcome, portfolio,
count(*)::bigint, sum(duration)::bigint, null::bigint
from scoped
group by 2, 3, 4, 5, 6, 7
union all
select 'd'::text, call_date, user_id, team, category, 'MIN:' || (select min from m), portfolio,
count(distinct phone)::bigint, sum(duration)::bigint,
(count(distinct phone) filter (where outcome = 'CONNECTED'))::bigint
from scoped
group by 2, 3, 4, 5, 7
union all
select 'u'::text, null, user_id, null, null, null, null,
0::bigint, 0::bigint,
count(distinct coalesce(nullif(ref, ''), phone))::bigint
from scoped
where portfolio
group by user_id
$$;
create or replace function call_board_rollup(p_from date, p_to date, p_day date, p_teams text[] default null)
returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $$
with p as (select E' \t\n\r\f\x0b\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff' as ws),
m as materialized (select call_min_secs() as min),
base as (
select c.id, c.call_date,
coalesce(nullif(btrim(c.officer, p.ws), ''), '(unknown)') as officer,
c.team as raw_team, coalesce(c.team, '') as team,
coalesce(c.phone, '') as phone, coalesce(c.ref, '') as ref,
coalesce(c.duration, 0) as duration, coalesce(c.portfolio, false) as portfolio,
upper(btrim(coalesce(c.outcome, ''), p.ws)) not in ('MISSED', 'REJECTED', 'BLOCKED') and coalesce(c.duration, 0) > m.min as connected
from public.call_logs c cross join p cross join m
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
't', coalesce((select jsonb_agg(j order by first_id) from rowsj where scope = 't'), '[]'::jsonb),
'min', (select min from m));
$$;
revoke execute on function call_board_rollup(date, date, date, text[]) from public, anon, authenticated;
grant execute on function call_board_rollup(date, date, date, text[]) to service_role;
with r as materialized (select * from call_report_rollup(current_date - 6, current_date, null))
select x.what, x.answer from (
select 1 as k, 'minimum seconds (the setting)' as what, call_min_secs()::text as answer
union all select 2, 'numbers rung in the last 7 days', coalesce(sum(calls), 0)::text from r where kind = 'd'
union all select 3, 'of them REACHED (spoken to for longer than the minimum)', coalesce(sum(uniq), 0)::text from r where kind = 'd'
union all select 4, 'reached %', coalesce(round(100.0 * sum(uniq) / nullif(sum(calls), 0), 1)::text, 'n/a') from r where kind = 'd'
union all select 5, 'dials that were a conversation (CONNECTED)', coalesce(sum(calls), 0)::text from r where kind = 'g' and outcome = 'CONNECTED'
union all select 6, 'dials that only rang or ended inside the minimum (NO ANSWER)', coalesce(sum(calls), 0)::text from r where kind = 'g' and outcome = 'NO ANSWER'
union all select 7, 'the calls slide answers with its minimum', coalesce(call_board_rollup(current_date, current_date, current_date, null)->>'min', 'MISSING')
) x order by x.k;
-- END OF RUN-ME-088
