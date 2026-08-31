-- =====================================================================================
-- RUN-ME-014 -- THE CALL REPORT'S COUNTING, DONE BY THE DATABASE.
--
-- "call reports in site is failing to load - Imeshindikana / Could not load.
--  Seva haijibu ndani ya sekunde 45 / the server did not answer within 45 seconds"
--
-- The report reads EVERY CALL ROW in its window and adds them up in JavaScript. It was
-- narrowed to ten columns once before, for this same symptom, and that bought time -- but
-- 321 officers calling all week is six figures of rows, and no column diet survives that.
-- Every number on the report is a COUNT or a SUM grouped by day, officer, category and
-- outcome, which is the oldest thing a database does.
--
-- This function does that grouping where the rows live. A week that used to cross the wire
-- as ~100,000 call rows comes back as a few thousand grouped ones. The app tries this first
-- and falls back to reading rows if the function is not there yet -- so run this once and
-- the Call Reports tab starts answering; skip it and the tab keeps limping exactly as it
-- does today.
--
-- ONE PASTE, seconds. Armored like every dose: a busy moment makes it fail fast and
-- harmless, and running it again later costs nothing.
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
  -- 'g' rows: one per (day, officer, category, outcome, portfolio) with its count and talk
  -- time. The category and outcome rules are transcribed from the app (categoryOf/outcomeOf
  -- in api/_lib/call-core.js): a non-portfolio call is OTHER; a portfolio call is its
  -- category or UNCATEGORIZED; an outcome that is not MISSED/REJECTED/BLOCKED is CONNECTED.
  select 'g'::text,
         call_date,
         user_id::text,
         team::text,
         case when not coalesce(portfolio, false) then 'OTHER'
              when upper(btrim(coalesce(category, ''))) in ('EXPECTED', 'DEFAULTER')
                   then upper(btrim(category))
              else 'UNCATEGORIZED' end,
         case when upper(btrim(coalesce(outcome, ''))) in ('MISSED', 'REJECTED', 'BLOCKED')
                   then upper(btrim(outcome))
              else 'CONNECTED' end,
         coalesce(portfolio, false),
         count(*)::bigint,
         coalesce(sum(duration), 0)::bigint,
         null::bigint
  from public.call_logs
  where call_date >= p_from and call_date <= p_to
    and (p_teams is null or upper(team) = any (select upper(t) from unnest(p_teams) t))
  group by 2, 3, 4, 5, 6, 7

  union all

  -- 'u' rows: each officer's DISTINCT portfolio customers in the window. Kept separate
  -- because a distinct count cannot be summed out of the grouped rows above -- the same
  -- customer rung on Monday and on Thursday must count once, not twice.
  select 'u'::text, null, user_id::text, null, null, null, null,
         0::bigint, 0::bigint,
         count(distinct coalesce(nullif(ref, ''), coalesce(phone, '')))::bigint
  from public.call_logs
  where call_date >= p_from and call_date <= p_to
    and coalesce(portfolio, false)
    and (p_teams is null or upper(team) = any (select upper(t) from unnest(p_teams) t))
  group by user_id
$$;
grant execute on function call_report_rollup(date, date, text[]) to anon, authenticated, service_role;

-- Proof: a week's rollup, grouped rows only. Should answer in well under a second.
select kind, count(*) as rows_returned
from call_report_rollup(current_date - 7, current_date, null)
group by kind;
