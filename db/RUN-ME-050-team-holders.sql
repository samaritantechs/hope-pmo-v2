-- RUN-ME-050 -- WHO HELD EACH TEAM, WHEN: the table behind the Annual Rep tab's leader boards.
--
--   "backfill the leaders, then from the current ones whenever I change a name of code holder,
--    trigger to save the previous one only if the new saved name is different"
--
-- One row per team, per role, per stretch of days one person held it. Nothing is typed in here:
--   * The workbooks' leaders (2025, and January-October 2026 month by month) are loaded by the
--     app itself, once, the first time an admin opens the Annual Rep tab. No data to paste.
--   * From then on the app writes a row only when a Teams & Staff save changes who holds a role
--     (a code's name or teams, a team's roles, a staff form). Editing a phone number or anything
--     else writes nothing.
-- role is the Teams & Staff column: gmo, manager, opm, collection (the PMO), credit, expected
-- (early collection), recovery, bike, legal. name '' means nobody held it. A stretch that is
-- still running ends on 9999-12-31, so every read is one plain range query.
--
-- SAFE TO RE-RUN, and OPTIONAL like every migration here: without this table the Annual Rep tab
-- judges every month on whoever holds the team today, exactly as before, and says so.
-- Small and fast: no data, no index on a big table.

create table if not exists team_holders (
  team text not null,                        -- trimmed and upper-case, like every stamped row
  role text not null,
  name text not null default '',
  from_date date not null,
  to_date date not null default '9999-12-31',
  source text not null default 'app',        -- 'workbook' (loaded from the annual workbooks) or 'app'
  stamped_at timestamptz not null default now(),
  primary key (team, role, from_date)
);

select 'team_holders' as piece, count(*) as rows from team_holders;
