-- =====================================================================================
-- THE HINT TABLE, KEPT UP TO DATE -- "You can always update the hint table in background:
-- this is also a forever rule b/se am making a lot updates."
-- =====================================================================================
-- Recorded permanently in ARCHITECTURE.md alongside the Postgres-cost rule: every session
-- that ships a feature a person would have to discover on their own adds a tip for it here,
-- without being asked each time.
--
-- A handful of tips for what shipped this session -- the branch column, the region-then-branch
-- picker at registration, the four new Settings cards, and the disbursement-mode dropdown.
--
-- ADDITIVE ONLY. Uploading a Hints sheet through the app REPLACES the whole table (see
-- TYPE_BEHAVIOUR in upload.js) -- these rows survive until the next such upload, exactly like
-- any tip typed in by hand. Safe to run more than once; it only ever adds rows, so re-running
-- doubles these particular tips rather than erasing anything -- run it once.
-- =====================================================================================

insert into hints (tab, message, sw_message) values
  ('settings',
   'Sales targets, recycling rotation, restructuring and other thresholds are now their own cards on this page -- scroll down past Tips timing.',
   'Malengo ya mauzo, mzunguko wa kufuatilia, masharti ya marekebisho na vigezo vingine sasa vina kadi zake hapa -- tembeza chini ya Muda wa vidokezo.'),
  ('ln_cs',
   'New customer: pick a Region, then a Branch narrowed to it. Disbursement mode is a Momo/Bank choice now, not typed.',
   'Mteja mpya: chagua Mkoa, kisha Tawi litakalopunguzwa kulingana nao. Njia ya malipo sasa ni chaguo la Momo/Benki, si kuandika.'),
  ('teams',
   'BRANCH and a staff ID beside every role are on the sheet now -- download it fresh to see them, or add them here directly.',
   'TAWI na namba ya mfanyakazi kwa kila wadhifa sasa vipo kwenye laha -- pakua upya kuviona, au ongeza hapa moja kwa moja.');
