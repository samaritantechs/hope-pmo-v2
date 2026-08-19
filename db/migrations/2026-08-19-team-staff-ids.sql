-- =====================================================================================
-- A STAFF ID BESIDE EVERY ROLE -- "my final thought of the teams and staff table."
--
-- The attached teams_and_staff.xlsx carries a column of its own for every role except OPM:
-- EARLY COL ID, COL ID, REC ID, CREDIT ID, GMO ID, MANAGER ID, BIKE ID, LEGAL ID -- small
-- numbers (402, 403, 404...) that read as a payroll/staff reference number, one per person,
-- not per role assignment.
--
-- CREDIT_ID ALREADY EXISTS -- added 2026-08-04, for a narrower purpose that was later retired:
-- mapping the credit analyst's number IN THE SALE-APPROVALS REPORT back to their name, so a
-- board could show a name instead of "ID 4471". That mapping was replaced with matching by
-- name directly ("dont use IDs in the approved report"), and nothing reads teams.credit_id for
-- that purpose any more -- this file does not change that. What is added here is the same
-- column's PLAIN STORAGE, restored for round-tripping the sheet, exactly like every sibling ID
-- below. Nothing in this codebase reads any of these eight columns for a calculation; they are
-- reference information, the same as region or a phone number.
--
-- OPTIONAL, LIKE EVERY MIGRATION HERE. Until it is run, saveTeam and importTeams drop these
-- fields rather than sending them, so Teams & Staff keeps saving everything else and nothing
-- breaks by this being late.
--
-- SAFE TO RE-RUN. `if not exists` on every line.
-- INSTANT. A nullable column with no default is a catalogue change, not a rewrite.
-- =====================================================================================

alter table teams add column if not exists credit_id text;    -- already exists since 2026-08-04; here for completeness if this runs on a database that somehow does not have it
alter table teams add column if not exists early_col_id text;
alter table teams add column if not exists collection_id text;
alter table teams add column if not exists recovery_id text;
alter table teams add column if not exists gmo_id text;
alter table teams add column if not exists manager_id text;
alter table teams add column if not exists bike_id text;
alter table teams add column if not exists legal_id text;

comment on column teams.credit_id is
  'A staff reference number, round-tripped through the Teams & Staff sheet. Not read for any '
  'calculation -- the sale-approvals board matches the credit analyst by NAME.';

-- DID IT LAND?
-- select column_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'teams' and column_name like '%_id'
-- order by column_name;
