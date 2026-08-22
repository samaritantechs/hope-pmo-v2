/* THE SAME LINE, FOR THE SAME REASON. Not optional -- see RUN-ME-001's own note on this. */
set search_path = hopeloan, public;

do $$
begin
  if to_regclass('hopeloan.loans') is null then
    raise exception
      'STOP: the hopeloan schema has no origination tables yet. Run '
      'db/hopeloan/RUN-ME-001-origination.sql first, then this file again.';
  end if;
end $$;

/* =====================================================================================
   HOPE LOAN -- ONBOARDING: the multi-loan top-up gate, the signature/fingerprint capture,
   and comments that follow the CUSTOMER rather than any one loan.
   =====================================================================================

   WHY IT EXTENDS RATHER THAN DUPLICATES, same rule as RUN-ME-001 itself: every statement
   below is unqualified and resolves against `hopeloan` because of the search_path line above
   -- nothing here can land in `public`, and nothing here needs a second file the day this
   sandbox becomes the live pipeline.

   1. TOP-UP ELIGIBILITY, AT REGISTRATION.
      creditApprove already deducts a typed-in `previous_balance` from disbursement without
      touching the new loan's own instalment schedule -- the top-up maths this system asked
      for already exists, one desk later than asked. What was missing is the GATE: "topup
      their loans only when they request loans and get registered with not more than two
      installments left" is a REGISTRATION-time policy, not an approval-time one. These two
      columns are what customer_service_supervisor reads off the customer's real book and
      types in at csRegister -- the sandbox has no repayment tracking of its own yet (see
      loan-core.js's own note on the boundary "deliberately not crossed" past funding), so
      this is entered, the same trust model previous_balance already uses, not derived.
   */
alter table loans add column if not exists topup_installments_left integer;
alter table loans add column if not exists topup_arrears numeric(14,2);

/* 2. SIGNATURE / FINGERPRINT -- a sixth assessment section, alongside personal / recommendation
      / guarantor / residence / business. "at our Hope loan assessment - customer could digital
      sign their contact copy, sign and biometrics inclusive on a single signatory split
      screen" -- this is assessment, where KYC already lives ("KYC is captured by the team at
      assessment", app.html's own note on the registration form), not registration.

      Stored as data URIs -- no object storage is configured for this deployment; same
      pattern the settings-held company stamp already uses on demand notices in HOPE PMO.
      WORTH REVISITING if these start costing real row size at volume. No native biometric API
      exists in a plain browser/WebView, so the "fingerprint" is captured the same way the
      signature is, on a canvas pad -- the pragmatic v1, not a real fingerprint reader. */
alter table assessments add column if not exists customer_signature text;
alter table assessments add column if not exists customer_fingerprint text;
alter table assessments add column if not exists guarantor_signature text;
alter table assessments add column if not exists signed_by text;
alter table assessments add column if not exists signed_at timestamptz;
alter table assessments add column if not exists done_signature boolean;

/* 3. COMMENTS, BY CUSTOMER -- not by docket, and not by loan. HOPE PMO's followup_comments
      carries docket_no but nothing ever read by it, because the docket changes every track
      and HOPE PMO has no single persistent customer row to key off instead. HOPE Loan does:
      `customers.id` is exactly the entity "no matter the current track no" was asking for, so
      a comment here needs no chain-walking at all -- every loan a customer has ever had shares
      one comment history by construction. */
create table if not exists loan_comments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  loan_id uuid references loans(id),
  docket text,
  comment text not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_loan_comments_customer on loan_comments(customer_id, created_at desc);

/* DID IT LAND?
   select column_name from information_schema.columns
   where table_schema = 'hopeloan' and table_name = 'loans' and column_name like 'topup_%';
   select column_name from information_schema.columns
   where table_schema = 'hopeloan' and table_name = 'assessments' and column_name like '%signature%';
   select count(*) from hopeloan.loan_comments; */
