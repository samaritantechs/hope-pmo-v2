-- =====================================================================================
-- RUN-ME-2026-11-11 -- A TIP: WHERE THE ZONE BESIDE A NAME COMES FROM.
--
--   "GMOs must see ther zone names infront of their name in login e.g  MARK II - "LAKE ZONE""
--   "in short after switching in system everyone must see their zone"
--
-- The portal now writes each person's zone beside their name (docs/HANDOFF.md Part 46). The
-- zone is read off Teams & Staff, so the one thing somebody would otherwise have to discover
-- is where to fix it when it is missing or wrong. This adds that tip to the Teams & Staff tab.
--
-- OPTIONAL. The zone shows with or without this file; only the tip waits on it.
-- ADDITIVE ONLY, one short statement, nothing slow in it. Uploading a Hints sheet through the
-- app replaces the whole table, so this row lives until the next such upload, like any tip.
-- Safe to run more than once: the second run adds nothing.
-- =====================================================================================
insert into hints (tab, message, sw_message)
select 'teams',
       '📍 The zone beside a name (MARK II - "LAKE ZONE") is the ZONE of the teams that name that person here, in any role column. Named nowhere: the zone of the teams their code holds, or ALL ZONES for a code over every team. NO ZONE SET means the ZONE cell of their teams is empty. Wrong? Fix the ZONE column, or the spelling of the name.',
       '📍 Zone inayoonekana kando ya jina (MARK II - "LAKE ZONE") ni ZONE ya timu zinazomtaja mtu huyo hapa, kwenye safu yoyote ya wadhifa. Asipotajwa popote: zone ya timu ambazo msimbo wake unashika, au ALL ZONES kwa msimbo wa timu zote. NO ZONE SET maana yake safu ya ZONE ya timu zake iko tupu. Si sahihi? Rekebisha safu ya ZONE, au herufi za jina.'
where not exists (select 1 from hints where tab = 'teams' and message like '%The zone beside a name%');
