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
