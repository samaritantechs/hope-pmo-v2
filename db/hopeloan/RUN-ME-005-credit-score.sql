/* THE SAME LINE, FOR THE SAME REASON. Not optional -- see RUN-ME-001's own note on this. */
set search_path = hopeloan, public;

/* =====================================================================================
   CREDIT SCORE ON THE TEAM RECOMMENDATION.
   =====================================================================================
   "recommendation kyc should go with team name, track no and credit score" -- team name and
   track no already exist (loans.team, loans.track_no); this is the one genuinely new field --
   the officer's own scoring of the customer, entered alongside the recommended amount in
   section 4 and carried into the copied KYC text for credit to see up front. Safe to re-run. */
alter table assessments add column if not exists credit_score numeric(5,2);
