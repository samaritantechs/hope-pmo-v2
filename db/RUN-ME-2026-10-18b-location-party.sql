-- =====================================================================================
--  CUSTOMER AND GUARANTOR LOCATIONS -- both tied to the REF NO.
-- =====================================================================================
--
--    "Add them as two icons on the right side of name and team+refno ... we should have the
--     two rows map icons for both customer and guarantor. All tied to ref no."
--
--  The customer card now has Location and Map icons for the CUSTOMER and a second pair for the
--  GUARANTOR. A loan has one REF NO and two places to go to, so the point is now keyed by
--  (ref, party): party 'C' = the customer, 'G' = the guarantor.
--
--  RUN THIS ONE WHETHER OR NOT YOU RAN RUN-ME-2026-10-18-customer-locations.sql:
--    - table not there yet  -> it is created in its final shape;
--    - table already there  -> the `party` column is added (every point already pinned becomes
--      the customer's, party 'C') and the key widens from (ref) to (ref, party). The key is
--      only touched when it is still the one-column key, so a re-run changes nothing.
--  Safe to re-run. A tiny table, so it is quick whatever the hour.
--
--  UNTIL THIS RUNS, NOTHING BREAKS: the card opens as before; Location tells the officer the
--  office has not switched it on yet, and Map says no point is saved.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

create table if not exists public.customer_locations (
  ref        text not null,                          -- the loan's REF NO, as the card shows it
  party      text not null default 'C' check (party in ('C', 'G')),   -- C = customer, G = guarantor
  team       text,                                   -- the team the officer pinned it under
  full_name  text,                                   -- the customer's or the guarantor's name
  lat        double precision not null,
  lng        double precision not null,
  acc        integer,                                -- metres, as the handset reported it
  saved_by   text,                                   -- the officer's name on their HOPE Calls account
  saved_at   timestamptz not null default now(),
  primary key (ref, party)
);

-- The table came from the first file: add the column, then widen the key (only if still one column).
alter table public.customer_locations
  add column if not exists party text not null default 'C' check (party in ('C', 'G'));

do $$
begin
  if exists (select 1 from pg_index i
              where i.indrelid = 'public.customer_locations'::regclass
                and i.indisprimary and i.indnatts = 1) then
    alter table public.customer_locations drop constraint customer_locations_pkey;
    alter table public.customer_locations add primary key (ref, party);
  end if;
end $$;

-- =====================================================================================
--  DID IT LAND?
--
--    select ref, party, full_name, lat, lng, acc, saved_by, saved_at
--      from public.customer_locations order by saved_at desc limit 20;
-- =====================================================================================
