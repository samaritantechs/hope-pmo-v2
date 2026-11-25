/* =====================================================================================
   THE READY-ANSWER MATCHER -- what a typed question finds when the AI is off (handbook Part 163).

     "People ain't seeing the keypad to ask agent.. there are only opts"      -- the owner, 25 Nov 2026

   THE FAULT. The typing box was drawn only while the AI was switched on and a key was in the host's settings; with either missing the panel was a list of ready questions and
   nothing else, and a person who wanted to ask something had no way to. The box is now ALWAYS there. What it does when the AI is not answering is this file: a typed
   question is matched, in memory, to the ready answers the person may be offered (claudian-faq.js), and answered from the best of them. It costs NO model, NO token and NO read:
   it is arithmetic over a list that is data in this repository.

   ONE ENGINE, NOT TWO. How a question touches a key (a whole word for three letters or fewer, a stem for longer ones, one slip forgiven in long keys, phrase keys joined by an
   underscore) is the knowledge cards' own (claudian-cards.js `keyHit`, through `cardScore`): a rule that decides what a word means exists once. How heavily a key weighs is this
   file's, with the cards' formula: a key only one entry has weighs most, a key several share less, an ordinary word of the two languages half.

   THREE OUTCOMES, and a person is never told more than the catalogue says:
     match     one ready answer clearly outweighs the others: it is the answer, with the ready question it answers named, and the next nearest as choices;
     near      nothing clearly wins (two answers weigh alike, or one only just touched): the nearest ready questions are shown as choices and nothing is answered;
     nothing   no ready question is touched: the person is told so and the whole list stays open. These are the rows the owner reads on the Hope Ai tab to see what to write next.

   PRIVACY IS THE LIST'S, NOT THIS FILE'S: only entries the person may be offered are scored (faqAllowed, the one rule that decides who sees which ready question), so a question
   about a screen the person does not hold cannot bring that screen's text back.
   ===================================================================================== */
import { wordsOf, cardScore } from './claudian-cards.js';
import { FAQ, faqAllowed } from './claudian-faq.js';

/** An answer is given when the keys the question touches weigh at least this much (1 is one key that no other entry has; two ordinary words together reach it). */
export const MATCH_MIN = 0.95;
/** An entry is worth showing as a choice when its keys weigh at least this much. */
export const NEAR_MIN = 0.45;
/** The best must outweigh the next by this factor, or nobody wins and the person chooses. */
export const CLEAR_RATIO = 1.25;
/** At most this many nearest choices go with an answer, and with no answer. */
export const MAX_NEAR_WITH = 2;
export const MAX_NEAR_WITHOUT = 3;

/** Keys of the ready answers that are ordinary words of the two languages: a hit on one weighs half, so that "change", "request" or "record" alone never answers a question about
    something else, and two of them together do. */
export const FAQ_COMMON = new Set(['change', 'badili', 'record', 'rekodi', 'comment', 'maoni', 'search', 'find', 'asked', 'leave', 'omba', 'cycle', 'mzunguko', 'recovered', 'owed', 'deni',
  'initial', 'cleared', 'chats', 'faint', 'hafifu', 'officers', 'maafisa', 'tabs', 'lists', 'advice', 'ushauri', 'increase', 'behind', 'nyuma', 'goal', 'company', 'kampuni',
  'percent', 'asilimia', 'calculated', 'formula', 'sales', 'mauzo', 'kufunga', 'access', 'permission', 'mshahara', 'salary', 'kesho', 'nifanye', 'jina', 'haionekani', 'haijaonekana',
  'sioni', 'ripoti', 'report', 'leader', 'kiongozi', 'nianzie', 'nianze', 'tofauti', 'difference', 'box', 'options', 'choices', 'limit', 'rate', 'source', 'closed', 'finance', 'paid',
  'morning', 'evening', 'replace', 'mwingine', 'menu', 'page', 'tab', 'ongez', 'uliza', 'fungwa', 'aliyelipa', 'waliolipa', 'kuandika',
  // GENERIC VERBS AND NOUNS (the second reader of Part 163 found a lone "approve" answering about leave, imprest and loans with the ADVANCE rule, "start" bringing the portfolio-call advice and
  // "mazungumzo" the Hope Ai chats): a word that means the same thing about many things needs the thing as well. Alone it offers the entry as a choice; with its object it answers.
  'approve', 'approval', 'idhini', 'kubali', 'kataa', 'start', 'mazungumzo', 'tumia', 'fungua', 'chini', 'low', 'kufikia', 'rekebisha', 'fedha', 'kikomo']);
export const FAQ_COMMON_FACTOR = 0.5;

const cardsOf = new WeakMap();
const weightsOf = new WeakMap();
/** The entries as the cards engine reads a card ({ id, text, keys }): its own test of whether a question touches a key is used as it is. */
function asCards(entries) {
  let c = cardsOf.get(entries);
  if (!c) { c = entries.map(e => ({ id: e.id, text: String(e.id), keys: Array.isArray(e.keys) ? e.keys : [] })); cardsOf.set(entries, c); }
  return c;
}
/** How heavily each key weighs: ln(1 + N/df) / ln(1 + N), so 1 for a key only one entry has and less for one several share, and half of that for an ordinary word. */
function weightsFor(cards) {
  let w = weightsOf.get(cards);
  if (!w) {
    const df = new Map();
    for (const c of cards) for (const k of new Set(c.keys.map(x => String(x).toLowerCase()))) df.set(k, (df.get(k) || 0) + 1);
    const norm = Math.log(1 + Math.max(1, cards.length));
    w = new Map();
    for (const [k, d] of df) w.set(k, (Math.log(1 + cards.length / d) / norm) * (FAQ_COMMON.has(k) ? FAQ_COMMON_FACTOR : 1));
    weightsOf.set(cards, w);
  }
  return w;
}

/** Scores a question against a list of entries and decides. `allowed(entry)` says who may be offered what. Returns
    { best: { id, score } | null, near: [{ id, score }], tie: boolean, tokens: n } with `near` already cut to the number that goes with this outcome. */
export function matchFrom(entries, allowed, question) {
  // a percent sign is a word here ("Rec %", "Makusanyo %"): the cards engine drops it, and for a question about a percentage it is the one word that says so
  const tokens = wordsOf(String(question == null ? '' : question).replace(/%/g, ' percent '));
  const out = { best: null, near: [], tie: false, tokens: tokens.length };
  if (!tokens.length || !Array.isArray(entries)) return out;
  const cards = asCards(entries), weights = weightsFor(cards);
  const scored = [];
  entries.forEach((e, i) => {
    if (!e || !allowed(e)) return;
    const score = cardScore(tokens, cards[i], weights);
    if (score >= NEAR_MIN) scored.push({ id: e.id, score: Math.round(score * 100) / 100, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const top = scored[0], next = scored[1];
  const strip = list => list.map(({ id, score }) => ({ id, score }));
  if (top && top.score >= MATCH_MIN && !(next && top.score < next.score * CLEAR_RATIO)) {
    out.best = { id: top.id, score: top.score };
    out.near = strip(scored.slice(1, 1 + MAX_NEAR_WITH));
    return out;
  }
  out.tie = !!(top && top.score >= MATCH_MIN);
  out.near = strip(scored.slice(0, MAX_NEAR_WITHOUT));
  return out;
}

/** A QUESTION THAT ASKS FOR THE PERSON'S OWN FIGURE ("reached % yangu ya leo ni ngapi", "how many portfolio calls did I make today", "makusanyo % ya timu yangu wiki hii ni ngapi"): a ready
    answer is a RULE and can never state a number of anybody's, so it is not given as if it did (the definition of the term would read as an answer and is not one). The two things
    that say so: a word that makes it the person's own (mine, my team, this customer) and a word that asks how many or how much. Measured on the 364 questions a ready answer genuinely
    answers: none of them has both; on the 156 that only share its topic: 14 do (and are the ones whose answer was the definition when a figure was asked). */
const PERSONAL = new Set(['yangu', 'wangu', 'langu', 'zangu', 'changu', 'vyangu', 'pangu', 'my', 'mine', 'nina', 'huyu', 'yule', 'nimepiga', 'nimefikia', 'nimeripoti', 'nimeidhinisha', 'nimebakiza', 'nimebakiwa', 'nimepata']);
const COUNT = new Set(['ngapi', 'wangapi', 'kiasi', 'jumla', 'total', 'balance', 'salio', 'baki', 'zilizobaki', 'iliyobaki', 'remaining']);
export function asksForFigure(question) {
  const t = wordsOf(question), joined = t.join(' ');
  if (!(t.some(w => COUNT.has(w)) || /\bhow (many|much)\b/.test(joined))) return false;
  return t.some(w => PERSONAL.has(w)) || /\bhow (many|much)\b.{0,40}\b(did|have|do) i\b/.test(joined);
}

/** What a typed question finds among the ready answers this person may be offered. `subject` is the helper's own ({ source, tabs, allTabs, leader }). A question that asks for the
    person's own figure is never ANSWERED from a ready answer (`figure: true`): the nearest ready answers are offered and nothing more. */
export function faqMatch(subject, question) {
  const r = matchFrom(FAQ, e => faqAllowed(e, subject), question);
  if (!asksForFigure(question)) return r;
  const near = r.best ? [r.best, ...r.near].slice(0, MAX_NEAR_WITHOUT) : r.near;
  return { best: null, near, tie: false, tokens: r.tokens, figure: true };
}
