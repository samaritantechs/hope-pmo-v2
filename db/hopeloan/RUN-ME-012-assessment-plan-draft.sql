/* =====================================================================================
   RUN-ME-012 -- THE ASSESSMENT PLAN CARRIES A DRAFT OF THE RECOMMENDATION.
   =====================================================================================
   HOPE Loan lives in the `hopeloan` schema of the SAME Supabase project as HOPE PMO. Paste
   this whole file into the SQL editor and run it once. Safe to re-run.

   "We allow our customers to double loans when they reach 10+ installments. Now it happens
    a team has a customer at 9, they visit this customer later the customer pays the 10th so
    as to get assigned (customer service never register under 10) so assessment plan should
    (can add customers regardless the counts, and allow the pre-fillable info of loan
    recommendation at assessment plan and saving only - submitting will only happen at
    recommendation) so if assigned no = assessment plan number, merge both for the single
    customer into recommendation"

   The team's field visit happens BEFORE customer service can register the customer. What
   the officer captures on that visit -- personal details, business, residence, guarantor,
   the recommendation itself, and every photo -- is saved on the plan as a draft, keyed by
   the same five sections the recommendation form saves. The moment a manager assigns a loan
   whose phone number matches a plan, the draft is written into that loan's assessment
   (mergePlanIntoLoan_ in api/_lib/loan-core.js) and the plan is removed: one customer, one
   recommendation, nothing typed twice. Submitting still only happens at Team ·
   Recommendation.

   Photos captured on a plan are stored under kyc-photos/plans/<plan id>/ and their paths
   are carried across at merge -- the objects themselves never move.

   Without this column: plans still work as before (name, phone, date), the draft save
   reports that this file has not been run, and nothing merges.
   ===================================================================================== */

/* THE SAME LINE, FOR THE SAME REASON. Not optional -- see RUN-ME-001's own note on this. */
set search_path = hopeloan, public;

alter table assessment_plans add column if not exists draft jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
