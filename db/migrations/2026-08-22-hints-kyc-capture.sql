-- =====================================================================================
-- THE HINT TABLE, KEPT UP TO DATE -- "forever rule" (see the other 2026-08-22 hints files).
-- What shipped this session: gender and ID type are now a choice not typed text, signature/
-- thumbprint/photo capture, GPS + a verification photo for the customer's residence, the
-- business, and the guarantor's residence, five extra close-contact guarantors, a WhatsApp KYC
-- copy button, and credit's reject reason is now a picked one, not typed.
-- ADDITIVE ONLY, safe to re-run -- run once.
-- =====================================================================================

insert into hints (tab, message, sw_message) values
  ('ln_team',
   'Gender and ID type are now a choice, not typed. New: signature, thumbprint press and a photo -- for the customer AND the guarantor. GPS + a verification photo for the residence, the business, and the guarantor''s residence. Five extra close contacts (name, phone, relationship) under Guarantor. Once a recommended amount is in, a Copy KYC button appears for pasting the whole file into WhatsApp, GPS pins included as map links.',
   'Jinsia na aina ya kitambulisho sasa ni chaguo, si kuandika. Mpya: sahihi, alama ya kidole gumba na picha -- kwa mteja NA mdhamini. GPS + picha ya uthibitisho kwa makazi ya mteja, biashara, na makazi ya mdhamini. Wadhamini wa ziada watano wa karibu (jina, simu, uhusiano) chini ya Mdhamini. Kiasi kikishaingizwa, kitufe cha Nakili KYC kinatokea kwa kubandika faili zima WhatsApp, alama za GPS zikiwa viungo vya ramani.'),
  ('ln_credit',
   'Reject is now Return for refilling -- pick a reason (missing signature, missing photo, GPS not captured, etc.) instead of typing one, with room for a short note.',
   'Kukataa sasa ni Kurudisha kwa kujaza tena -- chagua sababu (sahihi haipo, picha haipo, GPS haijachukuliwa, n.k.) badala ya kuandika, na nafasi ya maelezo mafupi.');
