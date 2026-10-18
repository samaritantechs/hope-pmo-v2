-- =====================================================================================
--  WHERE EACH CUSTOMER IS -- the Location and Map buttons on the HOPE Calls customer card.
-- =====================================================================================
--
--    "We need to add two buttons in customer cards: Location and Map. An officer can
--     pinpoint coordinates of the customer during visitation, and pressing map later will
--     open maps app in phone or browser to direct us towards that customer."
--
--  One row per customer REF NO: the point the officer pinned while standing at the
--  customer's door, who pinned it, how accurate the phone said it was, and when. Pinning
--  again REPLACES the row (the phone asks the officer first, and says how far the old pin is).
--
--  Paste the whole file into the Supabase SQL editor and run it once. Safe to re-run.
--  A new, empty table with its primary key: nothing existing is read, rewritten or locked,
--  so it is quick whatever the hour.
--
--  UNTIL THIS RUNS, NOTHING BREAKS: the customer card loads exactly as before, Location tells
--  the officer the office has not switched the feature on yet, and Map says no point is saved.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

create table if not exists public.customer_locations (
  ref        text primary key,                       -- the customer's REF NO, as the card shows it
  team       text,                                   -- the team the officer pinned it under
  full_name  text,
  lat        double precision not null,
  lng        double precision not null,
  acc        integer,                                -- metres, as the handset reported it
  saved_by   text,                                   -- the officer's name on their HOPE Calls account
  saved_at   timestamptz not null default now()
);

-- =====================================================================================
--  DID IT LAND?  (after the first officer has pinned a customer)
--
--    select ref, full_name, team, lat, lng, acc, saved_by, saved_at
--      from public.customer_locations order by saved_at desc limit 20;
-- =====================================================================================
