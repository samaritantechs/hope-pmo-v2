/* THE SAME LINE, FOR THE SAME REASON. Not optional -- see RUN-ME-001's own note on this. */
set search_path = hopeloan, public;

do $$
begin
  if to_regclass('hopeloan.teams') is null then
    raise exception
      'STOP: the hopeloan schema has no tables yet. Run '
      'db/hopeloan/RUN-ME-000b-clone-schema.sql first, then this file again.';
  end if;
end $$;

/* =====================================================================================
   HOPE LOAN -- THE TEAMS TABLE LEARNS ITS BRANCH, AND ITS ROWS FOR THE FIRST TIME.
   =====================================================================================

   WHY THE SANDBOX'S teams TABLE IS EMPTY. RUN-ME-000b clones STRUCTURE -- `like public.teams
   including all` -- deliberately not data, for the same reason it does not carry foreign
   keys: a sandbox row that pointed back at the live table would be exactly the mixing this
   whole design exists to prevent. So `hopeloan.teams` has always existed with zero rows, and
   nothing in this system has ever put any in it.

   THAT WAS FINE UNTIL NOW. Origination did not need a real roster: a loan could sit at
   "unassigned" with a typed team name and nobody checked it against anything. Branch-based
   registration does need one -- customer service has to SELECT a branch, which means the
   sandbox needs to know what branches exist, which means it needs the teams.

   THIS IS A SNAPSHOT COPY, NOT A LIVE LINK. It reads `public.teams` ONCE, when you run this,
   and writes a copy into `hopeloan.teams`. No foreign key, no ongoing sync, no path back --
   exactly the same boundary RUN-ME-000b already drew, extended to data instead of structure.
   Team NAMES, roles and now branches are reference information, not customer data: copying
   them once so the sandbox has real teams to assign loans to is not the mixing the owner asked
   to be guarded against -- see the caution this whole HOPE Loan build was built under:

     "you must guarantee me all systems will get updated and you wont mixup the data until the
      day we discuss merges"

   No customer, loan or transaction row is touched by this file. Only the team roster.

   THE COLUMN LIST IS READ FROM THE CATALOGUE, NOT WRITTEN OUT BY HAND. Every migration in
   this system is optional and run by hand, so public.teams and hopeloan.teams can each be
   missing columns the other has -- 2026-08-09-team-contacts.sql's region/zone/phone columns,
   this file's own `branch`, whatever comes next. A column list typed out here would fail at
   PARSE TIME the moment it named one column that happens not to exist yet on this database --
   the same trap `case`-wrapped table references fall into, and the same fix: build the
   statement as TEXT, from information_schema, and EXECUTE it, so it only ever asks for
   columns actually present on BOTH sides today.

   OPTIONAL, LIKE EVERY MIGRATION HERE, AND SAFE TO RE-RUN. `on conflict (team) do update` --
   running it again refreshes the sandbox's teams from whatever `public.teams` looks like
   today (new branch values included), never duplicates a row. Skip it entirely and HOPE
   Loan's team dropdowns are simply empty until you do run it. */

alter table teams add column if not exists branch text;

do $$
declare
  cols text;
  updates text;
begin
  select string_agg(quote_ident(c.column_name), ', ' order by c.column_name)
    into cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'teams'
    and c.column_name <> 'team'
    and exists (
      select 1 from information_schema.columns h
      where h.table_schema = 'hopeloan' and h.table_name = 'teams'
        and h.column_name = c.column_name
    );

  select string_agg(quote_ident(c.column_name) || ' = excluded.' || quote_ident(c.column_name), ', ' order by c.column_name)
    into updates
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'teams'
    and c.column_name <> 'team'
    and exists (
      select 1 from information_schema.columns h
      where h.table_schema = 'hopeloan' and h.table_name = 'teams'
        and h.column_name = c.column_name
    );

  if cols is null then
    raise exception 'No columns in common between public.teams and hopeloan.teams besides team -- nothing to copy.';
  end if;

  execute format(
    'insert into hopeloan.teams (team, %1$s) select team, %1$s from public.teams on conflict (team) do update set %2$s',
    cols, updates);
end $$;

-- DID IT LAND? Reads the catalogue and the table only, takes no locks.
--
-- select count(*) from hopeloan.teams;
-- select team, branch from hopeloan.teams order by team;
