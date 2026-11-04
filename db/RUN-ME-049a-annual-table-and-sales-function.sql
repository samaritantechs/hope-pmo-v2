-- RUN-ME-049a -- THE ANNUAL REPORT, part 1 of 5: the table and the sales function.
-- Run 049a, then b, c, d, e, one at a time. Each is safe to re-run; only 049e is slow.
--
-- team_months holds the collection and recovery of the months the system never saw (2025 and
-- January-July 2026), stamped from the annual workbooks by 049b-049d. ym is 'YYYY-MM' for a month
-- and 'YYYY' for a figure only a whole year measured (2025). Sales are never stamped: the Annual
-- tab sums them from the loans table.
create table if not exists team_months (
  team text not null,
  ym text not null,
  source text not null default 'sheet',
  expected numeric(14,2),
  collected numeric(14,2),
  uncollected numeric(14,2),
  ecol_pct numeric(7,2),
  recovered numeric(14,2),
  col_pct numeric(7,2),
  total_def numeric(14,2),
  par_pct numeric(7,2),
  opm text, pmo text, credit text, manager text, gmo text, legal text,
  region text, zone text, bike text, early_col text,
  note text,
  stamped_at timestamptz not null default now(),
  primary key (team, ym)
);

-- The year's sales summed by the database: one row per team per month of approval (TRK1 = a
-- first-time customer, track number 1). Same scoping as loan_totals_by_team (RUN-ME-047).
create or replace function loan_month_totals_by_team(p_from date, p_to date, p_teams text[] default null, p_stages text[] default null)
returns table (team text, ym text, loans bigint, trk1 bigint, principal numeric, loan_amt numeric)
language sql
stable
as $$
  select l.team,
         to_char(l.approved_date, 'YYYY-MM'),
         count(*)::bigint,
         (count(*) filter (where btrim(coalesce(l.track_no, '')) ~ '^0*1(\.0+)?$'))::bigint,
         coalesce(sum(coalesce(l.principal_amt, l.loan_amt, 0)), 0)::numeric,
         coalesce(sum(coalesce(l.loan_amt, coalesce(l.principal_amt, 0) + coalesce(l.interest_amt, 0))), 0)::numeric
  from loans l
  where l.approved_date >= p_from and l.approved_date <= p_to
    and (p_stages is null or l.stage::text = any (p_stages))
    and (p_teams is null or upper(btrim(coalesce(l.team, ''))) = any (select upper(btrim(t)) from unnest(p_teams) t))
  group by l.team, to_char(l.approved_date, 'YYYY-MM')
$$;

grant execute on function loan_month_totals_by_team(date, date, text[], text[]) to service_role;

select 'team_months' as piece, count(*) as rows from team_months
union all
select 'loan_month_totals_by_team', count(*) from pg_proc where proname = 'loan_month_totals_by_team';
