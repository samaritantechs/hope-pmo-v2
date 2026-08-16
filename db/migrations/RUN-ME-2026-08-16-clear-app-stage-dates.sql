-- =====================================================================================
--  RUN ME.  One paste, safe to re-run.
--
--  Clears the stray date stamps that earlier application-stage uploads copied in from the
--  register's own columns ("uploading unassigned and assigned apps should adhere to the
--  chosen date at uploads not the date inside sheet data"). The importer no longer brings
--  those columns in -- but it also, by design, never clears a column it does not mention,
--  so the rows already stamped keep their stray dates until this removes them.
--
--  SAFE BY DEFINITION: a loan in a pre-approval stage has not been approved or disbursed,
--  so any approved/disbursement date on such a row is sheet noise, never a real fact. A
--  loan that genuinely was approved carries stage 'approved' or later and is not touched.
--  The count at the bottom says how many rows were cleaned.
-- =====================================================================================

with cleaned as (
  update loans
     set approved_date = null,
         disb_date = null
   where stage in ('unassigned', 'unassessed', 'assessed', 'assigned', 'pending_approval')
     and (approved_date is not null or disb_date is not null)
  returning 1
)
select count(*) as rows_cleaned from cleaned;
