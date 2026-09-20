-- =====================================================================================
--  WHERE AN OFFICER'S OWN PHONE LAST WAS -- NO LOCK APP REQUIRED.
-- =====================================================================================
--
--    "For the officers with no hopelock app but allowed location, gm asked, can we track
--     were they are by the devices without lockapp ... officers have become many and
--     managing them has been like kids ... some even dare escape with our phones and
--     fraud demands of customer installments"
--
--  The company phone register (RUN-ME-2026-09-11-devices.sql /
--  RUN-ME-2026-09-11b-device-location.sql) already does exactly this for handsets running
--  the lock app -- last_lat/last_lng/last_loc_acc/last_loc_at on `devices`, reported on
--  every beat. This is the SAME four columns, the SAME reasoning, on access_codes instead:
--  every officer signed into the ordinary HOPE Calls app, not just the ones enrolled with
--  a lock app of their own.
--
--  Paste the whole file into the Supabase SQL editor and run it once; safe to re-run --
--  every statement is `add column if not exists`. UNTIL THIS RUNS, NOTHING BREAKS: the app
--  reporting a position against a register without these columns has the report accepted
--  anyway, minus the position (see officerBeat's own fallback in api/_lib/portal-core.js).
-- =====================================================================================

alter table access_codes add column if not exists last_lat      double precision;
alter table access_codes add column if not exists last_lng      double precision;
alter table access_codes add column if not exists last_loc_acc  integer;       -- metres, as the handset reported
alter table access_codes add column if not exists last_loc_at   timestamptz;   -- when the FIX was taken, not when it was sent

-- =====================================================================================
--  DID IT LAND?
-- =====================================================================================
-- select code, name, role, last_lat, last_lng, last_loc_acc, last_loc_at from access_codes
--  where last_lat is not null order by last_loc_at desc limit 20;
