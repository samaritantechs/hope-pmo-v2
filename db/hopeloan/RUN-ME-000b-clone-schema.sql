/* =====================================================================================
   HOPE LOAN -- BUILD THE SANDBOX SCHEMA BY CLONING THE LIVE ONE.
   =====================================================================================

   USE THIS INSTEAD OF PASTING db/schema.sql. Run it after RUN-ME-000-create-schema.sql and
   before RUN-ME-001-origination.sql.

   WHY IT EXISTS. The step it replaces was "paste `set search_path = hopeloan, public;` and
   then the whole of db/schema.sql into one query" -- and that step has now gone wrong once,
   sending every table into `public` instead. The instruction was the weak point: it lived in
   a comment, and a comment is a thing to remember.

   NOTHING HERE DEPENDS ON A SEARCH PATH. Every statement names both schemas outright --
   `hopeloan.teams` from `public.teams` -- so there is no default to get wrong, nothing to
   paste in the right order, and no way for this file to write to the live schema. It cannot
   land in the wrong place because it never asks where it is.

   AND IT CANNOT DRIFT. A second copy of schema.sql would go stale the first time a column was
   added to the real one. This does not copy a FILE; it copies the LIVE SCHEMA, whatever shape
   that is on the day it runs. The sandbox is therefore structurally identical to production by
   construction rather than by anyone keeping two files in step.

   WHAT `including all` BRINGS: column types, defaults, not-null and check constraints,
   primary keys, unique constraints, indexes, identity, storage settings and comments.

   WHAT IT DOES NOT BRING: FOREIGN KEYS. Postgres deliberately leaves those out, because a
   copied foreign key would still point at the ORIGINAL table -- a sandbox row referencing a
   live one, which is the exact mixing this whole design exists to prevent. So the sandbox has
   the same shape with looser referential integrity between its own tables. For a sandbox that
   is the right trade: every table is present and correct, and no row here can ever point at a
   row over there.
   ===================================================================================== */

create schema if not exists hopeloan;

do $$
declare
  t record;
  made int := 0;
begin
  /* Every base table in the live schema, cloned into the sandbox. `if not exists` so this is
     safe to run twice -- a table already made is left exactly as it is rather than rebuilt,
     which matters once the sandbox has data in it. */
  for t in
    select tablename from pg_tables where schemaname = 'public' order by tablename
  loop
    execute format(
      'create table if not exists hopeloan.%I (like public.%I including all)',
      t.tablename, t.tablename);
    made := made + 1;
  end loop;

  raise notice 'hopeloan: % table(s) present.', made;

  /* THE ONE THING WORTH FAILING LOUDLY OVER. If `teams` is missing the clone did not happen,
     and RUN-ME-001 would go on to add origination tables to a half-built schema. Better to
     stop here, where the cause is one line away, than there, where it is not. */
  if to_regclass('hopeloan.teams') is null then
    raise exception 'hopeloan.teams was not created -- the clone did not run. Check that the '
      'public schema really holds the HOPE PMO tables, and that this role may create tables '
      'in the hopeloan schema.';
  end if;
end $$;


/* -------------------------------------------------------------------------------------
   VERIFY -- read this before moving on. The two counts should MATCH.
   ------------------------------------------------------------------------------------- */
select
  (select count(*) from pg_tables where schemaname = 'public')   as live_tables,
  (select count(*) from pg_tables where schemaname = 'hopeloan') as sandbox_tables;

/* NEXT: run db/hopeloan/RUN-ME-001-origination.sql. It carries its own search_path line and
   will refuse to run if this file has not done its job, so there is nothing left to remember. */
