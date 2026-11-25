/* THE KNOWLEDGE CARDS FIND WHAT STAFF ASK (handbook Part 159, addendum 1).

     "So I believe Claudian-PMO has both knowledge from this chat and db to know how we really deal with everything well"   -- the owner, 25 Nov 2026

   The cards are only worth what the keys find. A key is a TRIGGER: one that only one card has brings that card by itself, so a key that is too loose fills the model's
   few lines with a card nobody needed and a key that is too narrow leaves the question to the model's own guess. This file holds the measured state of the keys on
   test/fixtures/claudian-cards-questions.json, with the REAL picker (pickFrom) and the real cards:

     SUITE  160 questions written by agents that had never seen a card, with the independent judges' label of which card answers each. The keys were NOT drawn from them:
            this is the honest measure (about two questions in three that have a card find it; before the widening it was three in five).
     OWN    864 questions (twelve for each card) written by agents that saw only the cards. The keys were drawn from them, so a card finding its own questions says the
            keys are consistent, and a WRONG card put first says a key is too loose: it is not a measure of how strangers are served.
     NOT ABOUT HOPE  a recipe, football, a greeting: how many still get a card.

   The floors sit a few questions under what was measured, so that a change to a key that costs a few questions is seen and one that costs many fails. If a floor has to
   move, the reason goes in the same commit (CHAT.md section 7). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const K = await import('../api/_lib/claudian-cards.js');
const FX = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'claudian-cards-questions.json'), 'utf8'));
const FAQ = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'claudian-faq-questions.json'), 'utf8'));

const LEADER_TABS = ['dashboard', 'defexp', 'expdfrep', 'weekly', 'reports', 'assignments', 'followup', 'promises', 'calls', 'perf', 'fureport', 'expected', 'apps', 'commission', 'bonusplan', 'checklist', 'advreq', 'leavereq', 'impreq', 'par'];
const ADMIN = { source: 'portal', allTabs: true, tabs: [], leader: false };
const PHONE_LEADER = { source: 'call', allTabs: false, tabs: [], leader: true };
const PHONE_OFFICER = { source: 'call', allTabs: false, tabs: [], leader: false };
const PORTAL_LEADER = { source: 'portal', allTabs: false, tabs: LEADER_TABS, leader: false };
/** Who asked, by the group the question was written for (the same people the independent judges were told). */
const subjectOf = (group, q) => {
  if (group === 'officers') return PHONE_OFFICER;
  if (group === 'leaders') return q.phone ? PHONE_LEADER : PORTAL_LEADER;
  return ADMIN;
};
const ids = (subject, q) => K.pickCards(subject, q).map(c => c.id);
const byId = new Map(K.CARDS.map(c => [c.id, c]));

/** The measures, worked out once. */
const M = (() => {
  let judged = 0, hit = 0;
  const missed = [];
  for (const r of FX.suite) {
    if (!r.best || r.gap || !byId.has(r.best)) continue;
    judged++;
    if (ids(subjectOf(r.group, r), r.q).includes(r.best)) hit++; else missed.push(r.q);
  }
  let own = 0, self = 0, first = 0, wrongFirst = 0, none = 0;
  const perCard = {};
  for (const [id, qs] of Object.entries(FX.own)) {
    const c = byId.get(id);
    const subject = c && c.where === 'phone' ? PHONE_LEADER : ADMIN;   // the person who may be sent the card; the admin is sent every card, so every other card can compete
    perCard[id] = 0;
    for (const q of qs) {
      own++;
      const got = ids(subject, q);
      if (got.includes(id)) { self++; perCard[id]++; }
      if (got[0] === id) first++; else if (got.length) wrongFirst++;
      if (!got.length) none++;
    }
  }
  const off = [];
  for (const r of FX.suite) if (['offtopic', 'other', 'action'].includes(r.area)) off.push({ q: r.q, subject: subjectOf(r.group, r) });
  for (const q of FAQ.offtopic) off.push({ q, subject: ADMIN });
  const offHits = off.filter(o => ids(o.subject, o.q).length);
  return { judged, hit, missed, own, self, first, wrongFirst, none, perCard, off: off.length, offHits: offHits.length };
})();

test('THE FIXTURE IS WHOLE: 160 judged questions, twelve questions for each of the cards, every label a card that exists, and no personal name or long number', () => {
  assert.equal(FX.suite.length, 160);
  assert.deepEqual(Object.keys(FX.own).sort(), K.CARDS.map(c => c.id).sort(), 'the cards and the fixture must name the same cards: a new card gets its twelve questions');
  for (const [id, qs] of Object.entries(FX.own)) assert.equal(qs.length, 12, id + ' has ' + qs.length + ' questions');
  for (const r of FX.suite) {
    assert.ok(typeof r.q === 'string' && r.q.trim().length > 3, 'a question');
    if (r.best) assert.ok(byId.has(r.best), 'the judges named a card that does not exist: ' + r.best);
  }
  const text = JSON.stringify(FX);
  for (const name of ['Asha', 'Rehema', 'Neema', 'Mrisho', 'Kisanga', 'Mwakyusa']) assert.ok(!text.includes(name), 'a personal name is in the fixture: ' + name);
  assert.ok(!/\d{9,}/.test(text), 'a long run of digits (a phone, an account, a national ID) is in the fixture');
  assert.ok(M.judged >= 100, 'only ' + M.judged + ' of the 160 have a card the judges named');
});

test('A STRANGER\'S QUESTION FINDS ITS CARD: of the judged questions that have a card, two in three are given it (the keys were not drawn from these questions)', () => {
  assert.ok(M.hit >= 68, M.hit + ' of ' + M.judged + ' found the judges\' card (measured 71; before the widening 64 of 108); missed: ' + JSON.stringify(M.missed.slice(0, 5)));
});

test('THE CARDS FIND THEIR OWN QUESTIONS, AND ANOTHER CARD IS NOT PUT FIRST TOO OFTEN: the keys are consistent (in-sample for the keys, so this is a check, not a promise)', () => {
  assert.ok(M.self >= 622, M.self + ' of ' + M.own + ' questions found their own card (measured 657 = 76%; before 537 = 62%)');
  assert.ok(M.first >= 515, M.first + ' had their own card FIRST (measured 546; before 427)');
  assert.ok(M.wrongFirst <= 292, M.wrongFirst + ' had another card first (measured 264; before 336)');
  assert.ok(M.none <= 70, M.none + ' found no card at all (measured 54; before 101)');
  const weak = Object.entries(M.perCard).filter(([, n]) => n < 3);
  assert.deepEqual(weak, [], 'a card that finds fewer than three of its own twelve questions has keys nobody types: ' + JSON.stringify(weak));
});

test('A QUESTION THAT IS NOT ABOUT HOPE DOES NOT BRING A CARD: a recipe, football, a greeting (one of the 88 gets a card by an ordinary word; before the widening, 25)', () => {
  assert.ok(M.offHits <= 24, M.offHits + ' of ' + M.off + ' got a card (measured 21; before 25)');
  // the two accidents the keys had: "naomba" (please) holds the stem "omba" (to ask), and "chapati" holds the stem "chap" (to print)
  assert.deepEqual(ids(ADMIN, 'naomba mapishi ya pilau'), []);
  assert.deepEqual(ids(ADMIN, 'give me a recipe for chapati'), []);
  assert.deepEqual(ids(ADMIN, 'naomba kujua mapishi ya chai'), []);
});

test('A KEY THAT BRINGS A CARD BY ITSELF IS A TOPIC, NOT A FUNCTION WORD: a key only one card has touches at most 7% of all the questions in the fixtures ("nini", "what", "how" would touch 8 to 13%)', () => {
  const flat = o => (Array.isArray(o) ? o.flatMap(flat) : (o && typeof o === 'object' ? Object.values(o).flatMap(flat) : (typeof o === 'string' ? [o] : [])));
  const pool = [...FX.suite.map(r => r.q), ...Object.values(FX.own).flat(), ...flat(FAQ.entries), ...flat(FAQ.uncovered), ...flat(FAQ.offtopic)].map(q => K.wordsOf(q));
  assert.ok(pool.length >= 1500, 'the pool of questions is ' + pool.length);
  const df = new Map();
  for (const c of K.CARDS) for (const k of new Set(c.keys)) df.set(k, (df.get(k) || 0) + 1);
  const loose = [];
  for (const [k, d] of df) {
    if (d !== 1 || K.COMMON_WORDS.has(k)) continue;
    const n = pool.filter(t => K.keyHit(t, k, true)).length;
    if (n > 0.07 * pool.length) loose.push(k + ' touches ' + n + ' of ' + pool.length);
  }
  assert.deepEqual(loose, [], 'a key only one card has is enough to bring that card; these touch too many questions to be a topic');
});

test('THE WORDS A PERSON REALLY TYPES FIND THE CARD: ten of the 160, kept by their exact text, so that a key edit that loses one is seen by name', () => {
  const KEPT = [
    ['Mteja ameandikwa Amepigiwa leo ila mimi sijampigia hata mara moja, imekuaje?', 'calls-tick-amepigiwa-leo'],
    ['Mteja amelipa deni lote lkn bado yupo kwenye Exp.Def, kwanini hajatoka?', 'defaulters-cleared-stay-on-list'],
    ['Mimi ni bike officer, kwa nini Leo na Kesho hazipo kwenye app yangu? Naona Exp.Def, Def, Exp na Chr tu.', 'defaulters-bike-officer-phone'],
    ['What does Early Col mean?', 'reports-dash-collection'],
    ['How is the fine on a demand notice worked out, and is there a grace period?', 'legal-fine'],
    ['imprest request not submitting', 'hr-imprest-request'],
    ['advnce yangu ya mwezi uliopita inasema Expired nifanyeje sasa', 'hr-advance-closed'],
    ['As the auditor, where do I see who changed a setting and when?', 'admin-audit-log'],
    ['uplod ya pili ya siku ileile inajumlisha au inabadilisha ya kwanza?', 'admin-upload-redo'],
    ['On PMO Deduction, what is the difference between Proposed and Deducted?', 'deduct-cards-hr'],
  ];
  const lost = [];
  for (const [q, id] of KEPT) {
    const row = FX.suite.find(r => r.q === q);
    assert.ok(row, 'the fixture no longer holds the question: ' + q);
    assert.equal(row.best, id, 'the judges\' card for the question changed: ' + q);
    const got = ids(subjectOf(row.group, row), q);
    if (!got.includes(id)) lost.push(q + ' -> ' + (got.join(',') || '(no card)') + ' (wanted ' + id + ')');
  }
  assert.deepEqual(lost, [], 'a question that found its card no longer does');
});
