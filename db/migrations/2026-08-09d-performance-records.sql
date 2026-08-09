-- =====================================================================================
-- WHO WAS BEST, AND WHEN -- WRITTEN DOWN AT THE TIME.
--
--   "By using Sales, Collection and Recovery, the system needs to always keep record of best
--    team and leaders weekly, monthly and yearly progress regardless of future leader table
--    alterations."
--
-- THE LAST FIVE WORDS ARE THE WHOLE DESIGN.
--
-- Every report in this system resolves a leader by looking them up in the teams table NOW.
-- That is right for today's work -- move a GMO onto ten new teams and every board re-points
-- with them, which is what makes a reassignment a one-field edit. But it means the past is
-- rewritten every time somebody is moved: last March's best recovery officer becomes whoever
-- holds those teams today, and the person who actually earned it disappears from their own
-- record.
--
-- So this table stores the leader's NAME AND POSITION AS TEXT, copied at the moment the period
-- was recorded. It is a photograph, not a pointer. Move them tomorrow, rename a team, delete a
-- role -- last March still says what last March said, which is the only thing that makes a
-- year's records worth keeping.
--
-- WHAT IT RECORDS
--   period   'week' | 'month' | 'year', with the date it starts on
--   metric   'sales' | 'collection' | 'recovery' -- the three the question named
--   scope    'team' | 'leader'
--   name     the team, or the person, as they were called then
--   position the role they held then ('RECOVERY', 'GMO'...) -- blank for a team row
--   value    the money, and `basis` the denominator where the metric is a percentage
--
-- ONE ROW PER (period, period_start, metric, scope, name), so re-recording a period in progress
-- updates rather than accumulating. A week is written many times while it is running and
-- settles on its final figures when it ends -- which is exactly how a record of "this week"
-- should behave.
--
-- OPTIONAL, LIKE EVERY MIGRATION HERE. Until it is run nothing is recorded and nothing breaks;
-- the tab says which file to run.
--
-- SAFE TO RE-RUN. INSTANT.
-- =====================================================================================

create table if not exists performance_records (
  id uuid primary key default gen_random_uuid(),

  period text not null check (period in ('week', 'month', 'year')),
  period_start date not null,

  metric text not null check (metric in ('sales', 'collection', 'recovery')),
  scope text not null check (scope in ('team', 'leader')),

  -- AS TEXT, ON PURPOSE. Not a reference to teams(team) either: a team that is renamed or
  -- deleted next year must not take its own history with it.
  name text not null,
  position text,

  value numeric(18,2) not null default 0,
  basis numeric(18,2),                 -- the denominator, where the metric is a percentage
  pct numeric(6,2),

  recorded_at timestamptz not null default now()
);

-- One row per period per metric per name -- so a period in progress is UPDATED as it runs
-- rather than written again every time somebody opens the report.
create unique index if not exists uq_perf_record
  on performance_records(period, period_start, metric, scope, name);

-- How it is read: a period at a time, best first.
create index if not exists idx_perf_period on performance_records(period, period_start, metric, value desc);

grant select, insert, update on table performance_records to anon, authenticated, service_role;

-- DID IT LAND?
-- select period, period_start, metric, scope, name, value from performance_records
-- order by period_start desc, metric limit 20;
