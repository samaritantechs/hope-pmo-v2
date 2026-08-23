/* THE SAME LINE, FOR THE SAME REASON. Not optional -- see RUN-ME-001's own note on this. */
set search_path = hopeloan, public;

/* =====================================================================================
   CLOSING THE REMAINING CRB / CONTRACT GAPS.
   =====================================================================================
   "are all information captured enough for the future creditinfo crb report?" -- most of the
   answer turned out to already be schema that nothing on any screen ever wrote to: customers
   already carries first_name/marital_status/occupation/daily_sales/block_number/etc (RUN-ME-001,
   "Every one of these is a CreditInfo Individual column"), and loans already carries
   collateral_type/collateral_value. This file adds only the handful of columns that genuinely
   did not exist anywhere yet -- everything else below is app.html and loan-core.js writing to
   columns that were already there. Safe to re-run.

   The application fee and the two local-government letters both come straight out of the
   actual loan contract (MKATABA WA MKOPO), not a guess:
     "ADA YA MKOPO (APPLICATION FEES) ... asilimia tano (5%) ya kiasi cha msingi na haitakuwa
      chini ya Shilingi ................." -- a 5%-of-principal fee, deducted from what is
      actually disbursed (the contract's own "Barua ya Ahadi ya Mkopo" is explicit: the amount
      promised is principal MINUS this fee). The minimum-shillings floor is a blank in the
      template itself -- nobody has told this system what it is -- so it is NOT hard-coded; the
      5% is only ever a suggestion credit can raise by hand until that figure exists.
     "Barua ya Utambulisho ya Mdhamini kutoka kwa Serikali ya Mtaa" (Kiambatanisho Na. 2) and
     "Barua ya utambulisho wa makazi na biashara ya Mkopaji kutoka Serikali ya Mtaa"
      (Kiambatanisho Na. 3) -- two required attachments, one per side, distinct from the live
      verification photos (those show the officer AT the place; these are a photograph of an
      actual letter issued by the local government). */
alter table loans add column if not exists application_fee numeric(14,2);
alter table customers add column if not exists local_govt_letter_url text;
alter table guarantors add column if not exists local_govt_letter_url text;
