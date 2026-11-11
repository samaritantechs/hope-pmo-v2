-- =====================================================================================
-- RUN-ME-2026-11-11b -- TWO TIPS: WHERE A ZONE COMES FROM, AND A TEAM WITH AN EMPTY ZONE.
--
--   "If an officer has team - zone is automatic of the GMO's" ... "to the respective team's gmo"
--   "So even manager - must have gmo of one of his team and auto match gmo and zone"
--
-- The portal and the staff-change scripts now read a team whose ZONE cell is empty as sitting
-- in the zone its GMO's other teams carry (docs/HANDOFF.md Part 50). What somebody would
-- otherwise have to discover is why a team shows a zone nobody typed on it, and what to change
-- when that zone is wrong. Both tips go on the Teams & Staff tab.
--
-- WHAT IT DOES, three short statements, nothing slow in any of them:
--   1. The first tip (RUN-ME-2026-11-11-hint-zone-beside-name.sql, "The zone beside a name")
--      said NO ZONE SET means the ZONE cell is empty. That is no longer the whole of it. Where
--      a book holds that tip in its earlier wording, the ONE row is reworded. Nothing else in
--      the table is touched.
--   2. Where a book does not hold the first tip at all, it is added, so the earlier file need
--      not be run.
--   3. The new tip is added.
--
-- OPTIONAL. The rule works with or without this file; only the tips wait on it.
-- Uploading a Hints sheet through the app replaces the whole table, so these rows live until
-- the next such upload, like any tip (docs/hints-v2.tsv carries both).
-- Safe to run more than once: the second run changes nothing.
-- =====================================================================================
update hints
   set message = '📍 The zone beside a name (MARK II - "LAKE ZONE") is the ZONE of the teams that name that person here, in any role column. Named nowhere: the zone of the teams their code holds, or ALL ZONES for a code over every team. NO ZONE SET means the ZONE cell of their teams is empty and their GMO''s teams carry none. Wrong? Fix the ZONE column, the GMO column, or the spelling of the name.',
       sw_message = '📍 Zone inayoonekana kando ya jina (MARK II - "LAKE ZONE") ni ZONE ya timu zinazomtaja mtu huyo hapa, kwenye safu yoyote ya wadhifa. Asipotajwa popote: zone ya timu ambazo msimbo wake unashika, au ALL ZONES kwa msimbo wa timu zote. NO ZONE SET maana yake safu ya ZONE ya timu zake iko tupu, na timu za GMO wake hazina zone. Si sahihi? Rekebisha safu ya ZONE, safu ya GMO, au herufi za jina.'
 where tab = 'teams' and message like '%The zone beside a name%' and message not like '%GMO column%';

insert into hints (tab, message, sw_message)
select 'teams',
       '📍 The zone beside a name (MARK II - "LAKE ZONE") is the ZONE of the teams that name that person here, in any role column. Named nowhere: the zone of the teams their code holds, or ALL ZONES for a code over every team. NO ZONE SET means the ZONE cell of their teams is empty and their GMO''s teams carry none. Wrong? Fix the ZONE column, the GMO column, or the spelling of the name.',
       '📍 Zone inayoonekana kando ya jina (MARK II - "LAKE ZONE") ni ZONE ya timu zinazomtaja mtu huyo hapa, kwenye safu yoyote ya wadhifa. Asipotajwa popote: zone ya timu ambazo msimbo wake unashika, au ALL ZONES kwa msimbo wa timu zote. NO ZONE SET maana yake safu ya ZONE ya timu zake iko tupu, na timu za GMO wake hazina zone. Si sahihi? Rekebisha safu ya ZONE, safu ya GMO, au herufi za jina.'
where not exists (select 1 from hints where tab = 'teams' and message like '%The zone beside a name%');

insert into hints (tab, message, sw_message)
select 'teams',
       '📍 A team with an empty ZONE is in its GMO''s zone: the zone most of that GMO''s other teams carry. Nobody has to fill it for its officers to be listed. Type a ZONE on the team to say otherwise. No GMO on the team, or a GMO with no team that carries a zone: NO ZONE SET.',
       '📍 Timu isiyo na ZONE iko kwenye zone ya GMO wake: zone ambayo timu nyingi za GMO huyo zinayo. Hakuna haja ya kuijaza ili maafisa wake waonekane. Andika ZONE kwenye timu ukitaka iwe tofauti. Timu bila GMO, au GMO ambaye timu zake hazina zone: NO ZONE SET.'
where not exists (select 1 from hints where tab = 'teams' and message like '%A team with an empty ZONE is in its GMO%');
