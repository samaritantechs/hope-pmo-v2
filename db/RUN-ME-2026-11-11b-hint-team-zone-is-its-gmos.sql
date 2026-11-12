-- =====================================================================================
-- RUN-ME-2026-11-11b -- TWO TIPS: WHERE A ZONE COMES FROM, AND A TEAM WITH AN EMPTY ZONE.
--
--   "If an officer has team - zone is automatic of the GMO's" ... "to the respective team's gmo"
--   "So even manager - must have gmo of one of his team and auto match gmo and zone"
--
-- The portal and the staff-change scripts read a team whose ZONE cell is empty as sitting in
-- the zone its GMO's other teams carry, when they all carry the same one (docs/HANDOFF.md
-- Parts 50 and 52). What somebody would otherwise have to discover is why a team shows a zone
-- nobody typed on it, why another reads NO ZONE SET although its GMO is named, and what to
-- change when a zone is wrong. Both tips go on the Teams & Staff tab.
--
-- WHAT IT DOES, four short statements, nothing slow in any of them:
--   1. The first tip ("The zone beside a name") is reworded where a book holds it in an
--      earlier wording: the ONE row, nothing else in the table.
--   2. Where a book does not hold the first tip at all, it is added.
--   3. The second tip ("A team with an empty ZONE ...") is reworded where a book holds it in
--      its earlier wording, which said "the zone most of that GMO's other teams carry". The
--      rule no longer chooses among a GMO's zones.
--   4. Where a book does not hold the second tip, it is added.
-- So this one file brings a book up to date whatever was run before, and the earlier file
-- (RUN-ME-2026-11-11-hint-zone-beside-name.sql) need not be run.
--
-- OPTIONAL. The rule works with or without this file; only the tips wait on it.
-- Uploading a Hints sheet through the app replaces the whole table, so these rows live until
-- the next such upload, like any tip (docs/hints-v2.tsv carries both).
-- Safe to run more than once: the second run changes nothing.
-- =====================================================================================
update hints
   set message = '📍 The zone beside a name (MARK II - "LAKE ZONE") is the ZONE of the teams that name that person here, in any role column. Named nowhere: the zone of the teams their code holds, or ALL ZONES for a code over every team. NO ZONE SET means the ZONE cell of their teams is empty and their GMO''s teams do not all carry one zone. Wrong? Fix the ZONE column, the GMO column, or the spelling of the name.',
       sw_message = '📍 Zone inayoonekana kando ya jina (MARK II - "LAKE ZONE") ni ZONE ya timu zinazomtaja mtu huyo hapa, kwenye safu yoyote ya wadhifa. Asipotajwa popote: zone ya timu ambazo msimbo wake unashika, au ALL ZONES kwa msimbo wa timu zote. NO ZONE SET maana yake safu ya ZONE ya timu zake iko tupu, na timu za GMO wake haziko zote kwenye zone moja. Si sahihi? Rekebisha safu ya ZONE, safu ya GMO, au herufi za jina.'
 where tab = 'teams' and message like '%The zone beside a name%'
   and message <> '📍 The zone beside a name (MARK II - "LAKE ZONE") is the ZONE of the teams that name that person here, in any role column. Named nowhere: the zone of the teams their code holds, or ALL ZONES for a code over every team. NO ZONE SET means the ZONE cell of their teams is empty and their GMO''s teams do not all carry one zone. Wrong? Fix the ZONE column, the GMO column, or the spelling of the name.';

insert into hints (tab, message, sw_message)
select 'teams',
       '📍 The zone beside a name (MARK II - "LAKE ZONE") is the ZONE of the teams that name that person here, in any role column. Named nowhere: the zone of the teams their code holds, or ALL ZONES for a code over every team. NO ZONE SET means the ZONE cell of their teams is empty and their GMO''s teams do not all carry one zone. Wrong? Fix the ZONE column, the GMO column, or the spelling of the name.',
       '📍 Zone inayoonekana kando ya jina (MARK II - "LAKE ZONE") ni ZONE ya timu zinazomtaja mtu huyo hapa, kwenye safu yoyote ya wadhifa. Asipotajwa popote: zone ya timu ambazo msimbo wake unashika, au ALL ZONES kwa msimbo wa timu zote. NO ZONE SET maana yake safu ya ZONE ya timu zake iko tupu, na timu za GMO wake haziko zote kwenye zone moja. Si sahihi? Rekebisha safu ya ZONE, safu ya GMO, au herufi za jina.'
where not exists (select 1 from hints where tab = 'teams' and message like '%The zone beside a name%');

update hints
   set message = '📍 A team with an empty ZONE is in its GMO''s zone: the zone that GMO''s other teams carry, when they all carry the same one. Nobody has to fill it for its officers to be listed. Type a ZONE on the team to say otherwise. No GMO on the team, a GMO with no team that carries a zone, or a GMO named on teams of more than one zone: NO ZONE SET.',
       sw_message = '📍 Timu isiyo na ZONE iko kwenye zone ya GMO wake: zone ambayo timu nyingine za GMO huyo zinayo, zikiwa zote kwenye zone moja. Hakuna haja ya kuijaza ili maafisa wake waonekane. Andika ZONE kwenye timu ukitaka iwe tofauti. Timu bila GMO, GMO ambaye timu zake hazina zone, au GMO mwenye timu kwenye zone zaidi ya moja: NO ZONE SET.'
 where tab = 'teams' and message like '%A team with an empty ZONE is in its GMO%'
   and message <> '📍 A team with an empty ZONE is in its GMO''s zone: the zone that GMO''s other teams carry, when they all carry the same one. Nobody has to fill it for its officers to be listed. Type a ZONE on the team to say otherwise. No GMO on the team, a GMO with no team that carries a zone, or a GMO named on teams of more than one zone: NO ZONE SET.';

insert into hints (tab, message, sw_message)
select 'teams',
       '📍 A team with an empty ZONE is in its GMO''s zone: the zone that GMO''s other teams carry, when they all carry the same one. Nobody has to fill it for its officers to be listed. Type a ZONE on the team to say otherwise. No GMO on the team, a GMO with no team that carries a zone, or a GMO named on teams of more than one zone: NO ZONE SET.',
       '📍 Timu isiyo na ZONE iko kwenye zone ya GMO wake: zone ambayo timu nyingine za GMO huyo zinayo, zikiwa zote kwenye zone moja. Hakuna haja ya kuijaza ili maafisa wake waonekane. Andika ZONE kwenye timu ukitaka iwe tofauti. Timu bila GMO, GMO ambaye timu zake hazina zone, au GMO mwenye timu kwenye zone zaidi ya moja: NO ZONE SET.'
where not exists (select 1 from hints where tab = 'teams' and message like '%A team with an empty ZONE is in its GMO%');
