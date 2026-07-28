-- =====================================================================================
-- LOANS: ONE ROW PER LOAN, THE WAY THE TABLE WAS ALWAYS MEANT TO WORK.
--
-- The whole point of consolidating eight pipeline sheets into one table was that a loan is
-- ONE row whose `stage` moves through it. But the upload was a plain insert with a random
-- id, so nothing recognised a loan it had already seen:
--
--   * uploading Unassigned, then Assigned, then Approved for the same loan made THREE rows;
--   * re-uploading the Approved file DOUBLED the sales figure, silently -- sales is the sum
--     of principal_amt over approved loans, and every copy counted again;
--   * the pipeline funnel counted the same loan at several stages at once.
--
-- The fix is to give the row a primary key derived from the LOAN'S OWN IDENTITY, so the
-- database itself refuses the duplicate. Identity is the loan's number where the export
-- carries one, and the customer plus their loan sequence where it does not:
--
--     LOAN ID, else DOCKET#, else TRACK#|FULLNAME|CONTACT#
--
-- Deliberately NOT stage and NOT any amount: a loan that advances a stage, or whose amount is
-- corrected, is still the same loan and must land on the same row.
--
-- md5 here is a fingerprint, never security. api/_lib/importers.js computes the identical
-- value in JavaScript, so rows re-keyed by this file and rows written by future uploads agree.
--
-- SAFE TO RE-RUN.
-- =====================================================================================

-- The identity of an existing row, exactly as loanIdentity() computes it.
create or replace function loan_identity_text(
  p_loan_id text, p_docket_no text, p_track_no text, p_full_name text, p_contact text
) returns text language sql immutable as $$
  select coalesce(
    nullif(upper(btrim(coalesce(p_loan_id, ''))), ''),
    nullif(upper(btrim(coalesce(p_docket_no, ''))), ''),
    array_to_string(array_remove(ARRAY[
      nullif(upper(btrim(coalesce(p_track_no, ''))), ''),
      nullif(upper(btrim(coalesce(p_full_name, ''))), ''),
      nullif(upper(btrim(coalesce(p_contact, ''))), '')
    ], NULL), '|')
  );
$$;

-- ---------------------------------------------------------------------------------------
-- 1. Collapse the duplicates already in the table.
--
-- The NEWEST row wins: later uploads carry later stages and corrected figures, so the most
-- recent copy is the truest one. Everything older for the same loan goes.
-- ---------------------------------------------------------------------------------------
with ranked as (
  select id,
         row_number() over (
           partition by loan_identity_text(loan_id, docket_no, track_no, full_name, contact)
           order by created_at desc nulls last, updated_at desc nulls last, id
         ) as rn
  from loans
)
delete from loans l using ranked r where l.id = r.id and r.rn > 1;

-- ---------------------------------------------------------------------------------------
-- 2. Re-key the survivors so a future upload of the same loan lands on the SAME row rather
--    than beside it. Nothing references loans(id), so changing it is safe.
-- ---------------------------------------------------------------------------------------
update loans
   set id = md5(loan_identity_text(loan_id, docket_no, track_no, full_name, contact))::uuid
 where id is distinct from
       md5(loan_identity_text(loan_id, docket_no, track_no, full_name, contact))::uuid;

-- The pipeline funnel and the credit board both group by stage; the sales figure filters on
-- stage + approved_date. Worth the index once a season of applications is in.
create index if not exists idx_loans_approved_date on loans(approved_date) where stage = 'approved';
