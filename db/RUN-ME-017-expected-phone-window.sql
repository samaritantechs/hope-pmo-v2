-- =====================================================================================
-- RUN-ME-017 -- THE TWO-WEEK PHONE WINDOW, AS ONE DATABASE TRIP.
--
-- WHY THIS EXISTS. "any customer number within these 2 weeks is portfolio call" shipped
-- first as a raw REST read of fourteen days of expected sheets -- thirty-plus pages per
-- phone-index rebuild, per warm lambda. With three hundred handsets syncing, that put
-- enough read load on this database to slow SIGN-IN for everybody within the hour
-- (the Postgres error spike on the Supabase dashboard, Aug 31 ~12pm, is that storm).
--
-- The window is really DISTINCT CUSTOMERS, and collapsing fourteen days of repeats into
-- one row each is the database's job. This function does that server-side: a few thousand
-- rows out instead of tens of thousands, one or two pages instead of thirty.
--
-- Until this is pasted, the app runs on the narrower coverage it always had (today,
-- tomorrow, the followup register) -- safe, just without the two-week reach. Paste this
-- and the reach comes back at almost no cost.
--
-- SAFE TO RE-RUN: create or replace.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

create or replace function expected_phone_window(p_from date)
returns table (
  ref text, full_name text, contact text,
  guarantor_name text, guarantor_contact text, team text
)
language sql
stable
as $$
  select distinct r.ref, r.full_name, r.contact, r.guarantor_name, r.guarantor_contact, r.team
  from repayment_snapshots r
  where r.snapshot_type in ('today', 'tomorrow')
    and r.snapshot_date >= p_from;
$$;

-- ================================== DID IT LAND? =====================================
-- EXPECT: one row, counting the distinct customers on the last two weeks of expected
-- sheets -- a few thousand, not tens of thousands. If this errors, the function did not
-- install; paste the whole file again.
select count(*) as distinct_customers_in_window
from expected_phone_window((current_date - 13)::date);
