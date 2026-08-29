-- =====================================================================================
-- "LEO" IS SHOWING THE WRONG CUSTOMERS, AND THE BANNER HAS DISAPPEARED.
--
-- WHAT THE MISSING BANNER PROVES. The phone works out Leo like this (call-core.js, list()):
--
--     wantDate = today
--     snap     = the latest 'today' Expected snapshot dated ON OR BEFORE today
--     stale    = snap.date <> wantDate     <-- this is the banner
--
-- So on a Saturday, with no Saturday sheet, it finds FRIDAY, stale is true, and the banner
-- says "of 28 Aug". That is what you saw this morning, and it is correct.
--
-- The banner can only vanish if snap.date EQUALS today -- which means there IS now a
-- repayment_snapshots row of type 'today' carrying TODAY'S date (Saturday). The phone is not
-- falling back any more, because as far as it can tell, today's sheet has arrived. And the
-- customers in it are June's.
--
-- Nothing in the code stamps a date by itself -- an Expected upload REFUSES to run without a
-- date the person picked ("date is required for an Expected upload"). So this is a real row,
-- written with the wrong date on it: an old file uploaded under today's date.
--
-- STEP 1 and 2 change nothing. Read them before STEP 3.
-- =====================================================================================

-- ------------------------------------------- STEP 1: WHAT WAS WRITTEN, AND UNDER WHAT DATE
-- THE DECIDING QUERY. Every Expected batch of the last ten days: the date it CLAIMS, and the
-- moment it was actually uploaded. A row whose snapshot_date is today (Saturday) is the fault
-- -- there is no Saturday Expected sheet in this business.
select snapshot_date,
       snapshot_type,
       upload_batch,
       count(*)          as rows,
       min(created_at)   as uploaded_at
from repayment_snapshots
where snapshot_type = 'today'
  and snapshot_date >= current_date - 10
group by 1, 2, 3
order by snapshot_date desc, uploaded_at desc;

-- Anything at all written into Expected TODAY, whatever date it claims to be. This catches an
-- old file loaded under the wrong date in EITHER direction.
select snapshot_date, snapshot_type, upload_batch,
       count(*) as rows, min(created_at) as uploaded_at
from repayment_snapshots
where created_at >= current_date
group by 1, 2, 3
order by min(created_at) desc;


-- ------------------------------------------------- STEP 2: THE CUSTOMER YOU ACTUALLY SAW
-- PAULO RICHARD MIHAYO. Every Expected row he appears in, newest first. If he shows up under
-- today's date, that row is the one putting him on the Leo list.
select snapshot_date, snapshot_type, upload_batch, team, full_name, payment_expected,
       todays_status, created_at
from repayment_snapshots
where ref = '5215609147'
   or upper(coalesce(full_name, '')) like '%PAULO RICHARD MIHAYO%'
order by snapshot_date desc, created_at desc
limit 20;


-- --------------------------------- STEP 3: REMOVE THE MIS-DATED SHEET (count first)
-- ⚠ ONLY if STEP 1 showed an Expected 'today' batch dated TODAY that should not exist.
-- If the rows dated today are a sheet somebody genuinely meant to load, do NOT delete --
-- re-upload it under its correct date instead and it will supersede itself.
--
-- 3a. How many rows would go. Read this number before running 3b.
select count(*) as rows_dated_today, count(distinct upload_batch) as batches
from repayment_snapshots
where snapshot_type = 'today' and snapshot_date = current_date;

-- 3b. Remove them. Nothing else is touched: only Expected-today rows carrying TODAY'S date.
-- With those gone, Leo falls back to Friday exactly as it did this morning, and the banner
-- comes back saying which day it is showing.
delete from repayment_snapshots
where snapshot_type = 'today' and snapshot_date = current_date;

-- 3c. Confirm. The newest Expected 'today' date should now be FRIDAY, not today.
select max(snapshot_date) as newest_expected_today
from repayment_snapshots
where snapshot_type = 'today';


-- ---------------------------------------------------------------- STEP 4: MAKE THE PHONES SEE IT
-- The phones hold their lists until the data version moves. Bumping it throws away every
-- cached list on every handset at the next sync, which is what makes this visible in the field
-- rather than after the next upload.
insert into settings (key, value)
values ('DATA_VERSION', to_char(now(), 'YYYYMMDDHH24MISS'))
on conflict (key) do update set value = to_char(now(), 'YYYYMMDDHH24MISS');

-- =====================================================================================
-- AFTERWARDS, on a phone: close HOPE Calls fully and reopen it, then open Leo. It should
-- show Friday's list again WITH the banner naming 28 Aug.
--
-- WORTH KNOWING: the business rule "no Expected sheet on Saturday or Sunday" is not written
-- down anywhere in the code -- the phone simply falls back to the newest sheet on or before
-- today, whatever date it carries. That is why one sheet loaded under a weekend date was
-- enough to silently replace the whole Leo list AND remove the banner that would have
-- explained it. Refusing a weekend date at upload time would have made this impossible.
-- =====================================================================================
