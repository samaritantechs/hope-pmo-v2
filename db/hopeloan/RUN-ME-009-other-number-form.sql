/* THE SAME LINE, FOR THE SAME REASON. Not optional -- see RUN-ME-001's own note on this. */
set search_path = hopeloan, public;

/* =====================================================================================
   THE CONSENT FORM, WHEN THE MONEY GOES TO SOMEONE ELSE'S NUMBER.
   =====================================================================================
   "The assessments always have a nida form filled for customers who receive money with
   nos that ain't under their registration so there our camera has to take 2 photos, of
   the doc and the 2nd the customer holding it." -- HOPE's own paper form ("FOMU YA
   MAKUBALIANO NA UIDHINISHAJI JUU YA MALIPO YA MKOPO KUPITIA NAMBA YA SIMU YA MTU
   MWINGINE"): filled and signed by hand -- the customer's own signature AND thumbprint
   on the PAPER, then three officers and the zone manager -- whenever the receiving
   mobile money number is registered to somebody other than the borrower. That paper
   thumbprint is not this app's digital capture (removed, see RUN-ME-008) and does not
   conflict with it: a printed form is photographed here, not drawn on a canvas.

   Two photos, both of the SAME paper form: the filled/signed document itself, and the
   customer holding it up. Lives on the loan, not the customer -- which number a given
   loan actually disburses to is a fact about THAT loan, not a permanent fact about the
   person. */
alter table loans add column if not exists other_number_form_url text;
alter table loans add column if not exists other_number_form_holder_url text;
