/* =====================================================================================
   HOPE LOAN -- STEP 0: create the sandbox schema and open the door to it, and only that door.
   =====================================================================================

   Run this FIRST, before db/schema.sql and before RUN-ME-001-origination.sql. It works
   whether HOPE Loan ends up living in this same Supabase project (the free path -- see
   HOPELOAN_ENABLED in api/_lib/workspace.js) or in a second project later (the paid path):
   either way, the schema inside is called `hopeloan`, so every file after this one is
   identical in both modes.

   EXCEL TERMS, since that is how this was described: this is not a filtered view of the same
   sheet where a wrong pivot could show live rows. This makes a SEPARATE SHEET in the same
   workbook -- its own tables, reachable only by a client that was deliberately pointed at it.
   Nothing that reads `public.teams` can see `hopeloan.customers`, and nothing that reads
   `hopeloan.customers` can see `public.teams`, any more than two different spreadsheets can. */

create schema if not exists hopeloan;

/* =====================================================================================
   AND THE SCHEMA MUST BE GRANTED TO THE API ROLES, WHICH IS NOT AUTOMATIC.
   =====================================================================================
   Creating a schema gives NOBODY the right to use it. Supabase's API connects as one of
   `anon`, `authenticated` or `service_role`, and without USAGE on the schema every request
   comes back:

       permission denied for schema hopeloan

   That is exactly what happened: the schema existed, it was ticked under Exposed schemas, the
   tables were all present and correct -- and the switch still would not appear, because the
   role reading it had no right to look. Creating and exposing a schema are two steps; granting
   it is a third, and it is the one with no visible control in the dashboard.

   ALTER DEFAULT PRIVILEGES covers what comes NEXT -- the tables RUN-ME-000b clones and
   RUN-ME-001 creates -- so those arrive already granted rather than needing a fourth step. */
grant usage on schema hopeloan to postgres, anon, authenticated, service_role;

alter default privileges in schema hopeloan
  grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema hopeloan
  grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges in schema hopeloan
  grant all on functions to postgres, anon, authenticated, service_role;

/* PostgREST -- the layer Supabase's API sits on -- only answers for schemas it has been told
   to expose. `public` is exposed by default; `hopeloan` is not, until this line runs. Without
   it, every request this system makes to the sandbox would fail with "not found" even though
   the schema and its tables exist -- so this is not optional housekeeping, it is the other
   half of turning the switch on.

   This runs as the `postgres` role in Supabase's SQL editor, which holds the right to alter
   the `authenticator` role on a Supabase-managed project. If it errors with a permissions
   message, the same change is made by hand: Dashboard -> Project Settings -> API ->
   "Exposed schemas" -> add hopeloan to the list -> Save. Either way this is a ONE-TIME step;
   it does not need repeating when tables are added to the schema later. */
alter role authenticator set pgrst.db_schemas = 'public, hopeloan';
notify pgrst, 'reload config';

/* NOW RUN, IN ORDER, EACH WITH THIS LINE PASTED FIRST:

     set search_path = hopeloan, public;

   1. db/schema.sql               -- unmodified. Every table portal-core.js touches, so a
                                      loan built here can flow all the way to expected,
                                      defaulters and decks exactly as it will once merged.
   2. db/hopeloan/RUN-ME-001-origination.sql   -- the origination additions.

   `search_path` decides where an UNQUALIFIED name (CREATE TABLE teams, not
   CREATE TABLE hopeloan.teams) lands, for that one SQL editor run. Pasting it first each time
   means schema.sql and the origination file never need their own copies rewritten with
   `hopeloan.` in front of every table name -- they run as they are, and simply land somewhere
   else because of the one line placed above them. */
