-- =====================================================================================
--  LOCATION HISTORY -- a fake pin must not be able to erase the real one.
-- =====================================================================================
--
--    "Someone fraudulent could update real location into fake, so if there is more than one
--     location, open location history once the button is clicked."
--
--  Pinning a customer or guarantor again REPLACES the point on the row. That is exactly what
--  somebody hiding the real door would do. From now on the row also keeps every point it
--  replaced (who pinned it, when, how accurate the phone said it was), oldest first, in one new
--  column. When a person has more than one location the Map icon opens that history instead of
--  going straight to the latest point, so the real one can be told from the fake.
--
--  Paste the whole file into the Supabase SQL editor and run it once. Safe to re-run
--  (`add column if not exists`). One column with a constant default on a small table is a
--  metadata change only -- nothing is rewritten, so it is instant whatever the hour. Points
--  already pinned get an empty history; their history starts with the next replacement.
--
--  UNTIL THIS RUNS, NOTHING BREAKS: pinning and Map work exactly as before; what a pin replaces
--  is simply not recorded, and the history is empty.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

alter table public.customer_locations
  add column if not exists hist jsonb not null default '[]'::jsonb;   -- [{lat, lng, acc, by, at}], oldest first

-- =====================================================================================
--  DID IT LAND?  (after one customer has been pinned twice)
--
--    select ref, party, saved_by, saved_at, jsonb_array_length(hist) as earlier_points, hist
--      from public.customer_locations where jsonb_array_length(hist) > 0 order by saved_at desc limit 20;
-- =====================================================================================
