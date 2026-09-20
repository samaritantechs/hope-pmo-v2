/* THE SAME LINE, FOR THE SAME REASON. Not optional -- see RUN-ME-001's own note on this. */
set search_path = hopeloan, public;

/* =====================================================================================
   THE FIELD OFFICER'S OWN NAME AND SIGNATURE, AT RECOMMENDATION.
   =====================================================================================
   "Remove the fingerprint capture, only remain with signature and at field officer name
   filling and signature at recommendation" -- fingerprint/thumbprint capture is gone (it
   was never a hardware reader, only a drawn smear standing in for one, and it was judged
   more trouble than it was worth). What replaces it here is not the customer's or
   guarantor's own attestation -- those already have their own signature_url columns
   (RUN-ME-004) -- but the FIELD OFFICER'S: their name, typed, and their own signature,
   drawn the same way, taken once at the point they submit the recommendation. The
   existing `officer` column on assessments is who the loan was ASSIGNED to; this is the
   officer actually attesting to the visit, which is not guaranteed to be the same person
   and is worth recording as its own fact. */
alter table assessments add column if not exists officer_name text;
alter table assessments add column if not exists officer_signature_url text;
