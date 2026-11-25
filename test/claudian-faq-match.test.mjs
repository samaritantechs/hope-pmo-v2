/* THE READY-ANSWER MATCHER (handbook Part 163) -- what a typed question finds when the AI is off.

     "People ain't seeing the keypad to ask agent.. there are only opts"                       -- the owner, 25 Nov 2026

   The typing box is shown to everybody; with no model to answer it, a typed question is matched in memory to the ready answers the person may be offered. What is held:
   the engine's decisions on made-up entries (one key that only one entry has answers; two entries that weigh alike are not guessed between; two ordinary words together
   answer and one alone does not; a percent sign is a word); the catalogue's keys (every entry has them, in the engine's own alphabet, none so common that it touches most
   questions); every ready question finds ITSELF from its own words in both languages; a person is never answered from, or offered, a screen they do not hold; and
   test/fixtures/claudian-faq-questions.json -- questions written by people who had not seen the keys, in everyday Swahili and English -- is answered right, listed or
   left alone at the rates the keys were measured at. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = await import('../api/_lib/claudian-match.js');
const { FAQ, faqAllowed, faqLabel } = await import('../api/_lib/claudian-faq.js');
const { wordsOf, keyHit } = await import('../api/_lib/claudian-cards.js');

const ADMIN = { source: 'portal', allTabs: true, tabs: [], leader: false };
const portal = tabs => ({ source: 'portal', allTabs: false, tabs, leader: false });
const LEAD = { source: 'call', allTabs: false, tabs: [], leader: true };
const OFFICER = { source: 'call', allTabs: false, tabs: [], leader: false };
const subjectFor = e => (e.call ? (e.call === 'leader' ? LEAD : OFFICER) : ADMIN);

/* ---------------- the engine, on made-up entries ---------------- */
const E = (id, keys) => ({ id, keys });
const ALL = () => true;
const LIST = [E('a', ['zebra', 'zebra_crossing', 'stripes']), E('b', ['zebra', 'horse']), E('c', ['giraffe', 'neck']), E('d', ['change', 'request']), E('e', ['change', 'record']), E('f', ['moto'])];

test('A KEY ONLY ONE ENTRY HAS ANSWERS; a key two entries share does not, alone: the person is shown both', () => {
  const r = M.matchFrom(LIST, ALL, 'tell me about a giraffe');
  assert.equal(r.best.id, 'c'); assert.ok(r.best.score >= M.MATCH_MIN);
  const s = M.matchFrom(LIST, ALL, 'is it a zebra');
  assert.equal(s.best, null, 'a key two entries share weighs less than one only one has: not enough alone');
  assert.deepEqual(s.near.map(n => n.id), ['a', 'b'], 'both are offered, the first listed first');
  assert.equal(s.tie, false);
});

test('TWO ORDINARY WORDS TOGETHER ANSWER, ONE ALONE DOES NOT: an ordinary word of the two languages weighs half', () => {
  const FQ = new Set(M.FAQ_COMMON);
  const l = [E('p', ['alpha', 'omba']), E('q', ['beta'])];
  assert.ok(FQ.has('omba') && FQ.has('change'), 'the list of ordinary words has the words these entries rely on');
  // 'omba' is an ordinary word (weighs half): alone it is below the line, with a second key of the entry it is over it
  assert.equal(M.matchFrom(l, ALL, 'naomba nini').best, null);
  assert.equal(M.matchFrom(l, ALL, 'naomba alpha').best.id, 'p');
  assert.equal(M.FAQ_COMMON_FACTOR, 0.5);
});

test('TWO ENTRIES THAT WEIGH ALIKE ARE NOT GUESSED BETWEEN: the best must outweigh the next by a quarter, or the person chooses', () => {
  const l = [E('x', ['moon', 'sun']), E('y', ['moon', 'sun']), E('z', ['moon', 'star'])];
  const r = M.matchFrom(l, ALL, 'moon and sun');
  assert.equal(r.best, null); assert.equal(r.tie, true, 'two entries over the line and level: a tie, said so');
  assert.deepEqual(r.near.map(n => n.id).sort(), ['x', 'y', 'z'].sort().filter(i => r.near.some(n => n.id === i)));
  const clear = M.matchFrom([E('x', ['moon', 'sun', 'wind']), E('y', ['moon'])], ALL, 'moon sun wind');
  assert.equal(clear.best.id, 'x'); assert.deepEqual(clear.near.map(n => n.id), ['y'], 'the answer comes with the next nearest as a choice');
  assert.ok(M.CLEAR_RATIO >= 1.2 && M.CLEAR_RATIO <= 1.5);
});

test('NOTHING TOUCHED IS NOTHING: no answer and no choice; and at most three choices without an answer, two with one', () => {
  const l = [E('a', ['one']), E('b', ['one']), E('c', ['one']), E('d', ['one']), E('e', ['two']), E('f', ['three']), E('g', ['four']), E('h', ['five'])];
  assert.deepEqual(M.matchFrom(l, ALL, 'will it rain tomorrow'), { best: null, near: [], tie: false, tokens: 4 });
  assert.deepEqual(M.matchFrom(l, ALL, ''), { best: null, near: [], tie: false, tokens: 0 });
  assert.deepEqual(M.matchFrom(l, ALL, null), { best: null, near: [], tie: false, tokens: 0 });
  const four = M.matchFrom(l, ALL, 'one');
  assert.equal(four.best, null, 'a key four entries share is not enough for any of them'); assert.equal(four.near.length, 3, 'four are over the nearest line and three are shown');
  const w = M.matchFrom([E('a', ['alpha', 'beta']), E('b', ['alpha']), E('c', ['alpha']), E('d', ['alpha']), E('e', ['gamma']), E('f', ['delta']), E('g', ['epsilon'])], ALL, 'alpha beta');
  assert.equal(w.best.id, 'a'); assert.equal(w.near.length, 2);
  assert.equal(M.matchFrom('not a list', ALL, 'x').best, null, 'a list that is not a list finds nothing and does not throw');
});

test('A KEY THAT MOST ENTRIES SHARE TELLS THEM APART FROM NOTHING: it is not even offered as a choice', () => {
  // six of eight entries carry the key: it weighs under the line for a choice, so a question that holds only it finds nothing
  const l = [E('a', ['common']), E('b', ['common']), E('c', ['common']), E('d', ['common']), E('e', ['common']), E('f', ['common']), E('g', ['rare']), E('h', ['seldom'])];
  assert.deepEqual(M.matchFrom(l, ALL, 'common').near, [], 'a key six entries of eight share is not a reason to show any of them');
  assert.equal(M.matchFrom(l, ALL, 'rare').best.id, 'g');
});

test('A QUESTION THAT ASKS FOR THE PERSON\'S OWN FIGURE IS NEVER ANSWERED FROM A RULE: a ready answer defines a term and cannot state a number of anybody\'s, so the nearest are offered and nothing is answered', () => {
  for (const q of ['reached % yangu ya leo ni ngapi', 'how many portfolio calls did i make today', 'makusanyo % ya timu yangu wiki hii ni ngapi', 'MTEJA HUYU ANA DC NGAPI KWA SASA', 'nimeripoti kesi ngapi mwezi huu', 'how much has my team recovered today'])
    assert.equal(M.asksForFigure(q), true, q);
  for (const q of ['reached % ni nini', 'simu ya portfolio ni nini?', 'what does reached mean', 'sekunde ngapi zinatakiwa ili mteja aonekane amefikiwa', 'namba ileile nikipiga mara tano kwa siku inahesabiwa ngapi', 'how many seconds count as reached', 'kwn dc ya mteja ni 2 ina maana gani', 'my advance got rejected do i have to wait', ''])
    assert.equal(M.asksForFigure(q), false, q);
  const asked = M.faqMatch(OFFICER, 'reached % yangu ya leo ni ngapi');
  assert.equal(asked.best, null); assert.equal(asked.figure, true); assert.ok(asked.near.some(n => n.id === 'reached'), 'the ready answer that DEFINES the term is offered, not given as if it were the figure');
  assert.equal(M.faqMatch(OFFICER, 'reached % ni nini').best.id, 'reached', 'the same words with no figure asked for are answered');
  assert.equal(M.faqMatch(OFFICER, 'reached % ni nini').figure, undefined);
  const none = M.faqMatch(OFFICER, 'nina wateja wangapi leo'); assert.equal(none.figure, true); assert.deepEqual(none.near.map(n => n.id), [], 'a figure asked for with no topic touched: nothing to offer');
});

test('A PERCENT SIGN IS A WORD (the cards engine drops it): "Rec %" and "Makusanyo %" are about a percentage', () => {
  const l = [E('pct', ['percent']), E('other', ['recovery'])];
  assert.deepEqual(M.matchFrom(l, ALL, 'Rec %').near.map(n => n.id), ['pct'], 'the sign is the word "percent" (an ordinary word: it is offered, not answered)');
  assert.deepEqual(M.matchFrom(l, ALL, 'Rec').near, [], 'without the sign nothing is touched');
  const l2 = [E('pct', ['percent', 'rec']), E('other', ['rec'])];
  assert.equal(M.matchFrom(l2, ALL, 'Rec %').best.id, 'pct', 'the sign tipped it between two entries that both have "rec"');
  assert.equal(M.matchFrom(l2, ALL, 'Rec').best, null, 'without the sign the two weigh alike');
});

test('ONLY WHAT A PERSON MAY BE OFFERED IS SCORED: a question about a screen they do not hold finds nothing of it, not even as a choice', () => {
  const only = id => e => e.id === id;
  const l = [E('secret', ['hidden']), E('open', ['visible'])];
  assert.deepEqual(M.matchFrom(l, only('open'), 'hidden hidden hidden').near, []);
  assert.equal(M.matchFrom(l, only('open'), 'visible').best.id, 'open');
});

/* ---------------- the real catalogue ---------------- */
test('EVERY READY ANSWER HAS KEYS IN THE ENGINE\'S OWN ALPHABET, none repeated, none so common that it touches most questions', () => {
  const df = new Map();
  for (const e of FAQ) {
    assert.ok(Array.isArray(e.keys) && e.keys.length >= 6 && e.keys.length <= 45, e.id + ': 6 to 45 keys, found ' + (e.keys && e.keys.length));
    assert.equal(new Set(e.keys).size, e.keys.length, e.id + ' repeats a key');
    for (const k of e.keys) {
      assert.match(k, /^[a-z0-9]+(_[a-z0-9]+)*$/, e.id + ': "' + k + '" is not a word or an underscore-joined phrase');
      assert.ok(k.length >= 2 && k.length <= 30, e.id + ': "' + k + '" is too short or too long');
      df.set(k, (df.get(k) || 0) + 1);
    }
    // a key that contains another key of the SAME entry (a word and its plural, a stem and a longer form) counts a word twice: the stem is enough (unless the stem is an ordinary word, which weighs half: the longer form is how an entry says it means it)
    const plain = e.keys.filter(k => !k.includes('_') && k.length >= 4);
    for (const a of plain) for (const b of plain) if (a !== b && b.includes(a) && !M.FAQ_COMMON.has(a)) assert.fail(e.id + ': "' + b + '" holds "' + a + '": the shorter one already touches it, so one word would count twice');
  }
  for (const [k, n] of df) assert.ok(n <= 3, '"' + k + '" is a key of ' + n + ' entries: a topic word is shared by the few entries of its topic, and an intent word is one entry\'s');
  const common = [...M.FAQ_COMMON].filter(w => !FAQ.some(e => e.keys.includes(w)));
  assert.deepEqual(common, [], 'a word on the list of ordinary words that no entry uses as a key does nothing: ' + common.join(', '));
  // the one question every ordinary person asks first must not hit most of the catalogue
  const hits = w => FAQ.filter(e => e.keys.some(k => keyHit(wordsOf(w), k, true))).length;
  for (const w of ['what', 'how', 'is', 'the', 'ni', 'nini', 'je', 'kwa', 'ya', 'na', 'wa']) assert.equal(hits(w), 0, '"' + w + '" touches a key');
});

test('EVERY READY QUESTION FINDS ITS OWN ANSWER FROM ITS OWN WORDS, in Swahili and in English, for a person who may be offered it', () => {
  for (const e of FAQ) for (const l of ['sw', 'en']) {
    const r = M.faqMatch(subjectFor(e), e[l].q);
    assert.ok(r.best && r.best.id === e.id, e.id + ' (' + l + '): "' + e[l].q + '" found ' + JSON.stringify(r));
  }
});

test('A PERSON IS NEVER ANSWERED FROM, OR OFFERED, A READY ANSWER THEY MAY NOT HAVE: the entry\'s own question, asked by somebody who may not be offered it, does not bring it back', () => {
  const nobody = [portal([]), portal(['dashboard']), OFFICER, LEAD];
  let checked = 0;
  for (const e of FAQ) for (const who of nobody) {
    if (faqAllowed(e, who)) continue;
    for (const l of ['sw', 'en']) {
      const r = M.faqMatch(who, e[l].q);
      assert.ok(!(r.best && r.best.id === e.id) && !r.near.some(n => n.id === e.id), e.id + ' (' + l + ') came back for ' + JSON.stringify(who));
      checked++;
    }
  }
  assert.ok(checked > 100, 'the check ran on ' + checked + ' pairs');
  // and in particular: the phone is offered no portal screen, the portal no phone entry
  assert.equal(M.faqMatch(OFFICER, FAQ.find(e => e.id === 'legal-notice').en.q).best, null);
  assert.equal(M.faqMatch(ADMIN, FAQ.find(e => e.id === 'call-lists').en.q).best, null, 'a phone-app entry is not offered in the portal, not even to the admin');
  const lr = M.faqMatch(OFFICER, FAQ.find(e => e.id === 'call-report').en.q);
  assert.ok(!(lr.best && lr.best.id === 'call-report') && !lr.near.some(n => n.id === 'call-report'), 'the leader\'s report question is the leader\'s');
  assert.equal(faqLabel('legal-notice', 'en'), 'When can a demand notice be issued?'); assert.equal(faqLabel('no-such', 'sw'), null);
});

test('THE ANSWERS THEMSELVES ARE UNCHANGED BY THE KEYS: each entry still has its question and answer in both languages, and the keys are the only thing a person never reads', () => {
  for (const e of FAQ) {
    for (const l of ['sw', 'en']) assert.ok(typeof e[l].q === 'string' && e[l].q.length > 8 && typeof e[l].a === 'string' && e[l].a.length > 20, e.id + ' ' + l);
    assert.ok(!/matcher|\bkeys\b/i.test(e.sw.a + e.en.a.replace(/API key/g, '')), e.id + ': an answer talks about the matching keys');
  }
  const s = FAQ.find(e => e.id === 'settings-claudian');
  assert.match(s.en.a, /typing box is shown to everybody/); assert.match(s.sw.a, /Kisanduku cha kuandika kinaonekana kwa kila mtu/, 'the answer to "why do people not see the box" says it is there');
});

/* ---------------- questions written by people who had not seen the keys ---------------- */
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/claudian-faq-questions.json'), 'utf8'));

function measure(entries, uncovered, offtopic) {
  const o = { n: 0, right: 0, listed: 0, wrong: 0, none: 0, negN: 0, negAnswered: 0, wrongList: [] };
  for (const id of Object.keys(entries)) {
    const e = FAQ.find(x => x.id === id);
    assert.ok(e, 'the fixture names an entry the catalogue no longer has: ' + id);
    for (const q of entries[id].direct) {
      const m = M.faqMatch(subjectFor(e), q); o.n++;
      if (m.best && m.best.id === id) { o.right++; o.listed++; }
      else if (m.near.some(x => x.id === id)) { o.listed++; if (m.best) { o.wrong++; o.wrongList.push([id, q, m.best.id]); } else o.none++; }
      else if (m.best) { o.wrong++; o.wrongList.push([id, q, m.best.id]); } else o.none++;
    }
  }
  for (const q of [...uncovered, ...offtopic]) for (const who of [ADMIN, LEAD, OFFICER]) { o.negN++; const m = M.faqMatch(who, q); if (m.best) o.negAnswered++; }
  return o;
}
const half = (arr, parity) => arr.filter((_, i) => i % 2 === parity);
const halfOf = parity => ({
  entries: Object.fromEntries(Object.entries(FIX.entries).map(([id, v]) => [id, { direct: half(v.direct, parity) }])),
  uncovered: half(FIX.uncovered, parity), offtopic: half(FIX.offtopic, parity),
});

test('THE CORPUS: questions written by other people, in everyday Swahili and English, are answered right, listed or left alone at the rates the keys were measured at', () => {
  const o = measure(Object.fromEntries(Object.entries(FIX.entries).map(([id, v]) => [id, { direct: v.direct }])), FIX.uncovered, FIX.offtopic);
  assert.ok(o.n >= 500, 'a corpus of ' + o.n + ' questions that mean something: ' + o.n);
  const pct = (a, b) => Math.round(1000 * a / b) / 10;
  const say = JSON.stringify({ n: o.n, right: pct(o.right, o.n), listed: pct(o.listed, o.n), wrong: o.wrong, negAnswered: o.negAnswered, negN: o.negN });
  assert.ok(pct(o.right, o.n) >= FIX.floors.right, 'answered right fell below ' + FIX.floors.right + '%: ' + say);
  assert.ok(pct(o.listed, o.n) >= FIX.floors.listed, 'right or listed fell below ' + FIX.floors.listed + '%: ' + say);
  assert.ok(pct(o.wrong, o.n) <= FIX.floors.wrongMax, 'answered with the WRONG ready answer more than ' + FIX.floors.wrongMax + '%: ' + say + ' ' + JSON.stringify(o.wrongList.slice(0, 6)));
  assert.ok(pct(o.negAnswered, o.negN) <= FIX.floors.negMax, 'questions about something else were answered: ' + say);
});

test('THE TWO HALVES OF THE CORPUS AGREE: the questions the keys were tuned on and the ones set aside are answered about alike (a big gap would be a tuning that learned the questions)', () => {
  const a = measure(halfOf(0).entries, halfOf(0).uncovered, halfOf(0).offtopic), b = measure(halfOf(1).entries, halfOf(1).uncovered, halfOf(1).offtopic);
  const pa = a.right / a.n, pb = b.right / b.n;
  assert.ok(Math.abs(pa - pb) < 0.2, 'answered right: ' + Math.round(pa * 100) + '% on one half, ' + Math.round(pb * 100) + '% on the other');
});
