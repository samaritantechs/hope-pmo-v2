-- =====================================================================================
--  RUN ME.  The two migrations still outstanding, in one paste.
-- =====================================================================================
--
--  WHAT THIS IS
--  Two features on your screens are waiting for columns your database has not got:
--
--    1. "Manage call app users" -- switching an officer off, issuing passcodes -- fails on
--       every save, because call_users has no `active` or passcode columns. The screen can
--       read but not write, and until now the error it gave named a "schema cache" instead
--       of this file.
--
--    2. CREDIT ID on the teams & leaders sheet uploads cleanly and then never appears,
--       because teams has no `credit_id` column and the upload drops what the database
--       cannot hold. (Since 14 Aug the upload SAYS it dropped it, and names this file.)
--
--  Both were written long ago (26 Jul and 4 Aug) but neither was in RUN-ME-2026-08-09.sql,
--  so a database that ran that one paste is still missing these.
--
--  HOW TO RUN IT
--    1. Supabase dashboard -> SQL Editor -> New query
--    2. Paste this whole file
--    3. Run
--    4. Read the table it prints at the bottom. Every row should say YES.
--
--  IT IS SAFE TO RUN TWICE. Every statement is `if not exists`. Running it again on a
--  database that already has everything changes nothing.
--
--  IT IS INSTANT. Adding a nullable column is a catalogue change; the one index is partial
--  and call_users is a few hundred rows.
-- =====================================================================================


-- ============================== 1. FIELD OFFICER ACCOUNTS ============================
-- (verbatim from db/migrations/2026-07-26-officer-accounts.sql)
--
-- An account must be CREATED BY AN ADMIN before anyone can sign in with it, and it
-- carries a passcode the admin can change or switch off at any moment. Passcodes are
-- stored as scrypt hashes with a per-row salt, never in clear text: the admin sees a
-- passcode exactly once -- at the moment it is generated -- and can only replace it
-- afterwards, not read it back.

alter table call_users add column if not exists passcode_hash text;
alter table call_users add column if not exists passcode_salt text;
alter table call_users add column if not exists passcode_set_at timestamptz;
alter table call_users add column if not exists created_by text;

-- Existing registrations predate passcodes. They stay ACTIVE so nobody is locked out by
-- this paste itself, but every one of them has a NULL passcode_hash, which the admin
-- screen flags as "no passcode set" -- issue one and the old self-registered access dies.
alter table call_users add column if not exists active boolean not null default true;

-- Revocation has to be answerable in one indexed lookup on every request.
create index if not exists idx_call_users_active on call_users(device_id) where active;


-- ============================== 2. THE CREDIT ANALYST'S ID ===========================
-- (verbatim from db/migrations/2026-08-04-credit-analyst-id.sql)
--
-- The sale-approvals report names the credit analyst by an ID; the system names them by
-- the name in the teams table. Nothing can guess the mapping -- it is a fact only the
-- office knows, so it needs somewhere to be written down: one column beside the analyst's
-- name, on the team they work.

alter table teams add column if not exists credit_id text;

comment on column teams.credit_id is
  'The ID this team''s credit analyst appears under in the sale-approvals report. Set in the '
  'Teams panel or the leaders sheet. NULL means unmapped, and the boards then show the raw ID '
  'rather than guessing.';


-- ==================== THE SLOW QUERY IN YOUR SUPABASE LOGS ===========================
--
-- "I had some errors like: WITH pgrst_source AS (SELECT ... defaulter_snapshot_totals ..."
--
-- That is not a fault. It is the dashboard's team-day totals function appearing in the
-- SLOW QUERY log -- the function exists and answers, but it is scanning the snapshot
-- tables without the two indexes that were written for it. When it runs too slowly the
-- screens quietly fall back to the old raw-row reads, which is why nothing looks broken
-- and why Postgres works harder than it should on every dashboard open.
--
-- The cure is db/migrations/2026-08-05b-snapshot-totals-indexes.sql. It is NOT pasted
-- into this file on purpose: CREATE INDEX CONCURRENTLY refuses to run inside a
-- transaction, and this editor wraps a whole paste into one. Open that file and run its
-- two `create index` lines ONE AT A TIME, each on its own, waiting for each to finish.
-- The file explains the two failure shapes to expect and how to check the result.
-- After both are valid, that SQL disappears from the slow-query log.


-- ================================== DID IT LAND? =====================================
-- Every row should say YES. A NO means that statement did not run -- paste this file again.

select 'Officer accounts: active switch (call_users.active)' as piece,
       case when exists (select 1 from information_schema.columns
                         where table_name = 'call_users' and column_name = 'active')
            then 'YES' else 'NO' end as installed
union all
select 'Officer accounts: passcodes (call_users.passcode_hash)',
       case when exists (select 1 from information_schema.columns
                         where table_name = 'call_users' and column_name = 'passcode_hash')
            then 'YES' else 'NO' end
union all
select 'Credit analyst ID (teams.credit_id)',
       case when exists (select 1 from information_schema.columns
                         where table_name = 'teams' and column_name = 'credit_id')
            then 'YES' else 'NO' end
order by piece;
