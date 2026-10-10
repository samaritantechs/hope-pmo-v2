-- =====================================================================================
-- RUN-ME-042 -- THE CALL COUNTING RULE: NUMBERS, NOT DIALS; PORTFOLIO TALK TIME ONLY.
--
-- "there is a spreading rumor that's real ... when a staff finds an unreachable contact they
--  redial that contact too much then find their one portfolio or non portfolio call to talk
--  for so long to balance the counts and duration ... counting duration of portfolio calls
--  only since we emphasize portfolio calls ... our objective is to reach more customers and
--  guarantors."
--
-- Same function, same columns, one more kind of row. call_report_rollup (RUN-ME-014) kept
-- 'g' rows (every dial, grouped) and 'u' rows (distinct customers). It now also returns
-- 'd' rows, one per (day, officer, team, category):
--     calls = DISTINCT NUMBERS rung that day   (five redials of one customer = one call)
--     dur   = talk time of those calls         (the app adds up portfolio categories only)
--     uniq  = distinct numbers that CONNECTED at least once
-- The app reads 'd' rows for every figure it scores and shows the 'g' dials beside them.
-- Until this is pasted the Calls tab and Ripoti say so and keep counting dials.
--
-- ONE PASTE, seconds. Safe to run again. Under 100 lines on purpose.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

create or replace function call_report_rollup(p_from date, p_to date, p_teams text[] default null)
returns table (kind text, day date, user_id text, team text, category text, outcome text,
               portfolio boolean, calls bigint, dur bigint, uniq bigint)
language sql
stable
set search_path = public, pg_catalog
as $$
  -- The rules transcribed from the app (categoryOf/outcomeOf in api/_lib/call-core.js):
  -- a non-portfolio call is OTHER; a portfolio call is its category or UNCATEGORIZED; an
  -- outcome that is not MISSED/REJECTED/BLOCKED is CONNECTED. A number with no digits
  -- counts as one number ('' in both worlds), never as nothing.
  with scoped as (
    select call_date, user_id::text as user_id, team::text as team,
           coalesce(phone, '') as phone, coalesce(ref, '') as ref,
           coalesce(duration, 0) as duration, coalesce(portfolio, false) as portfolio,
           case when not coalesce(portfolio, false) then 'OTHER'
                when upper(btrim(coalesce(category, ''))) in ('EXPECTED', 'DEFAULTER')
                     then upper(btrim(category))
                else 'UNCATEGORIZED' end as category,
           case when upper(btrim(coalesce(outcome, ''))) in ('MISSED', 'REJECTED', 'BLOCKED')
                     then upper(btrim(outcome))
                else 'CONNECTED' end as outcome
    from public.call_logs
    where call_date >= p_from and call_date <= p_to
      and (p_teams is null or upper(team) = any (select upper(t) from unnest(p_teams) t))
  )
  -- 'g' rows: every DIAL, grouped. Shown, never scored.
  select 'g'::text, call_date, user_id, team, category, outcome, portfolio,
         count(*)::bigint, sum(duration)::bigint, null::bigint
  from scoped
  group by 2, 3, 4, 5, 6, 7

  union all

  -- 'd' rows: DISTINCT NUMBERS per officer-day and category, their talk time, and how many
  -- of those numbers were reached. This is what every figure is scored on.
  select 'd'::text, call_date, user_id, team, category, null, portfolio,
         count(distinct phone)::bigint, sum(duration)::bigint,
         (count(distinct phone) filter (where outcome = 'CONNECTED'))::bigint
  from scoped
  group by 2, 3, 4, 5, 7

  union all

  -- 'u' rows: each officer's distinct portfolio CUSTOMERS over the whole window, unchanged.
  select 'u'::text, null, user_id, null, null, null, null,
         0::bigint, 0::bigint,
         count(distinct coalesce(nullif(ref, ''), phone))::bigint
  from scoped
  where portfolio
  group by user_id
$$;
grant execute on function call_report_rollup(date, date, text[]) to anon, authenticated, service_role;

-- Proof 1: three kinds of row come back for this week.
select kind, count(*) as rows_returned
from call_report_rollup(current_date - 7, current_date, null)
group by kind order by kind;

-- Proof 2: the rumour, in numbers. Today's ten officers whose dials run furthest past the
-- numbers they actually rang, with portfolio talk time beside the other talk.
select * from (
  select u.name, r.team,
         sum(r.calls) filter (where r.kind = 'g')                       as dials,
         sum(r.calls) filter (where r.kind = 'd')                       as numbers_called,
         sum(r.dur)   filter (where r.kind = 'd' and r.portfolio)       as portfolio_talk_sec,
         sum(r.dur)   filter (where r.kind = 'd' and not r.portfolio)   as other_talk_sec
  from call_report_rollup(current_date, current_date, null) r
  left join public.call_users u on u.user_id = r.user_id
  where r.kind in ('g', 'd')
  group by u.name, r.team) x
order by dials - numbers_called desc nulls last
limit 10;
