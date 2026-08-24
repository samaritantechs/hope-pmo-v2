-- =====================================================================================
-- THE HINT TABLE, KEPT UP TO DATE -- "forever rule" (see the other 2026-08-22 hints file).
-- One line, for one change: District moved off Customer Service registration onto the
-- team's assessment form, and Disbursement mode now sits right beside Mobile.
-- ADDITIVE ONLY, safe to re-run -- run once.
-- =====================================================================================

insert into hints (tab, message, sw_message) values
  ('ln_cs',
   'District is no longer asked here -- it moved to the team''s assessment form (Personal details), alongside DOB and NIDA. Disbursement mode now sits right next to Mobile.',
   'Wilaya haiulizwi hapa tena -- imehamia kwenye fomu ya tathmini ya timu (Taarifa binafsi), pamoja na Tarehe ya kuzaliwa na NIDA. Njia ya malipo sasa iko karibu na Namba ya simu.');
