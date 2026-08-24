-- =====================================================================================
-- THE HINT TABLE, KEPT UP TO DATE -- "You can always update the hint table in background:
-- this is also a forever rule b/se am making a lot updates."
-- =====================================================================================
-- Two tips for what shipped this session -- the GMO/OPM review split into Manager Review and
-- GMO Review (both mandatory now, at new thresholds), and the SMS export's own corrections
-- (arrears rounded to 500, a same-day corrected re-upload no longer resurrecting a customer).
--
-- ADDITIVE ONLY. Uploading a Hints sheet through the app REPLACES the whole table (see
-- TYPE_BEHAVIOUR in upload.js) -- these rows survive until the next such upload, exactly like
-- any tip typed in by hand. Safe to run more than once; it only ever adds rows, so re-running
-- doubles these particular tips rather than erasing anything -- run it once.
-- =====================================================================================

insert into hints (tab, message, sw_message) values
  ('ln_manager_review',
   'Mandatory for every loan 1,000,000+ now, not optional -- a loan of 6,000,000+ also needs GMO Review, both required, neither instead of the other.',
   'Ni lazima kwa mkopo wowote wa 1,000,000+ sasa, si hiari -- mkopo wa 6,000,000+ unahitaji pia GMO Review, zote mbili zinahitajika, si moja badala ya nyingine.'),
  ('ln_gmo_review',
   'Threshold moved from 3M to 6,000,000+ and it is alongside Manager Review now, not a separate MAY -- both are required at this amount.',
   'Kiwango kimehamishwa kutoka 3M kwenda 6,000,000+ na sasa inaenda pamoja na Manager Review, si hiari tena -- zote mbili zinahitajika kwa kiasi hiki.'),
  ('upload',
   'SMS export: arrears round up to the nearest 500 now (45,333 reads 45,500), and the file downloads as a real .xlsx with the worksheet named Sheet1.',
   'Kupakua SMS: deni sasa linazungushwa juu hadi 500 iliyokaribiana (45,333 inasomeka 45,500), na faili linapakuliwa kama .xlsx halisi na laha yenye jina Sheet1.');
