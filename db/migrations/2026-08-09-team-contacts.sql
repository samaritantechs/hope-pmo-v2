-- =====================================================================================
-- THE TEAMS TABLE LEARNS PHONE NUMBERS, AND WHERE THE TEAM IS.
--
-- WHY
-- Two things asked for at once, and they turn out to be the same thing.
--
-- 1. The Teams & Staff screen is meant to match the offline sheet the PMO already keeps:
--       SN · region · zone · TEAM · OPM · OPM No · RECOVERY · GMO · GMO No · MANAGER ·
--       Manager No · CREDIT · C. ANALYST · EXPECTED · Expected no · bike · Bike No ·
--       legal · Legal No · Collection · Col No
--    Every second column on that sheet is a phone number, and this table had none of them --
--    so the sheet could not be typed in here, and it went on living in a spreadsheet where
--    nothing else in the system can read it.
--
-- 2. The demand-message button needs a number to print:
--       "Kwa maelezo Zaidi piga <number>"
--    A demand notice telling a customer to ring a number nobody answers is worse than no
--    notice at all, so the number has to be the one belonging to whoever is actually chasing
--    them -- which is exactly the column this sheet has always carried and the database
--    never did.
--
-- WHAT IT ADDS -- nothing but columns, all nullable, no defaults, no data touched.
--
--   region, zone          where the team is. The sheet's first two columns.
--   *_no                  one phone number per role that already has a name column here.
--   legal, legal_no       the legal officer, who had no column at all.
--   collection, collection_no
--                         the collection officer's NAME is normally on their access code --
--                         one person holds thirty teams, so it is a list on the person rather
--                         than their name repeated thirty times. These two are here so the
--                         offline sheet can be typed in whole, and so a team whose collection
--                         officer is not an app user still has a number to print.
--
-- OPTIONAL, LIKE EVERY MIGRATION HERE. Until it is run, saveTeam drops these fields rather
-- than sending them -- the same guard credit_id has had since 2026-08-04 -- so the screen
-- keeps saving everything else and nothing breaks by this being late. Run it and the fields
-- start saving on the next request. Nothing has to be re-deployed.
--
-- SAFE TO RE-RUN. `if not exists` on every line.
--
-- INSTANT. Adding a nullable column with no default rewrites nothing in Postgres -- it is a
-- catalogue change. Unlike the index migration, this one can go in as a single paste.
-- =====================================================================================

alter table teams add column if not exists region text;
alter table teams add column if not exists zone text;

alter table teams add column if not exists opm_no text;
alter table teams add column if not exists recovery_no text;
alter table teams add column if not exists gmo_no text;
alter table teams add column if not exists manager_no text;
alter table teams add column if not exists credit_no text;
alter table teams add column if not exists expected_no text;
alter table teams add column if not exists bike_no text;

alter table teams add column if not exists legal text;
alter table teams add column if not exists legal_no text;

alter table teams add column if not exists collection text;
alter table teams add column if not exists collection_no text;

-- DID IT LAND? Reads the catalogue only, takes no locks, answers instantly.
--
-- select column_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'teams'
-- order by ordinal_position;
--
-- Expect the seven columns that were always there (team, opm, recovery, gmo, manager, credit,
-- expected, bike, updated_at), plus team_code and credit_id from earlier migrations, plus the
-- thirteen above.
