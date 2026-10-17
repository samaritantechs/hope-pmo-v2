-- =====================================================================================
--  WHERE EACH CALL-APP OFFICER LAST WAS.
-- =====================================================================================
--
--    "A field officer has run with 567k today ... no any field officer appearing there in
--     300+ company handsets" / "Not using lock app but callapp"
--
--  The Officer locations screen (Settings) listed only portal access codes that reported
--  from the Android shell. The officers who work HOPE Calls all day are CALL USERS, and
--  nothing recorded where they were. HOPE Calls now sends the phone's last-known position
--  while the app is open (api_callBeat in api/_lib/call-core.js) and stores it here -- the
--  same four columns, with the same meaning, as devices and access_codes already carry.
--
--  Paste the whole file into the Supabase SQL editor and run it once. Safe to re-run:
--  every statement is `add column if not exists`. Four columns on one small table; nothing
--  is read, rewritten or locked beyond that, so it is quick whatever the hour.
--
--  UNTIL THIS RUNS, NOTHING BREAKS: the app's report is accepted and dropped (the answer
--  says pending: MIGRATION), the page stops sending for that session, and the Officer
--  locations screen shows the access codes alone and says this file has not been run.
-- =====================================================================================

alter table call_users add column if not exists last_lat      double precision;
alter table call_users add column if not exists last_lng      double precision;
alter table call_users add column if not exists last_loc_acc  integer;       -- metres, as the handset reported
alter table call_users add column if not exists last_loc_at   timestamptz;   -- when the FIX was taken, not when it was sent

-- =====================================================================================
--  DID IT LAND?  (a few minutes after officers open the app)
--
--    select name, team, phone, last_loc_acc, last_loc_at
--      from call_users where last_lat is not null order by last_loc_at desc limit 20;
-- =====================================================================================
