-- =====================================================================================
--  RUN ME, AFTER RUN-ME-2026-09-11-devices.sql.  WHERE A HANDSET LAST WAS.
-- =====================================================================================
--
--    "add location tracking too, GM will want it."
--
--  Four columns on the register. Paste the whole file into the Supabase SQL editor and run
--  it once; safe to re-run, and it cannot disturb a register that already holds phones --
--  every statement is `add column if not exists`.
--
--  UNTIL THIS RUNS, NOTHING BREAKS. A handset reporting a position against a register
--  without these columns has its beat accepted anyway, minus the position: the beat matters
--  more than the map. A phone that cannot report its state is a phone the office has lost;
--  one that cannot report where it was is merely one somebody cannot go and find.
--
--  WHY THE TIME OF THE FIX IS ITS OWN COLUMN, and this is the whole care in the feature.
--  -------------------------------------------------------------------------------------
--  The phone reports its LAST KNOWN position rather than waking the GPS every beat, so the
--  fix can be hours older than the beat carrying it. Collapse the two and the register
--  starts claiming a handset is somewhere it left on Tuesday -- which is worse than having
--  no position at all, because somebody drives there.
-- =====================================================================================

alter table devices add column if not exists last_lat      double precision;
alter table devices add column if not exists last_lng      double precision;
alter table devices add column if not exists last_loc_acc  integer;       -- metres, as the handset reported
alter table devices add column if not exists last_loc_at   timestamptz;   -- when the FIX was taken, not when it was sent

-- =====================================================================================
--  DID IT LAND?
-- =====================================================================================
-- select imei, holder, last_lat, last_lng, last_loc_acc, last_loc_at from devices
--  where last_lat is not null order by last_loc_at desc limit 20;
