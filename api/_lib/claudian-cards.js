/* =====================================================================================
   THE KNOWLEDGE CARDS -- how HOPE really works, picked for each question (handbook Part 159).

     "So I believe Claudian-PMO has both knowledge from this chat and db to know how we really deal
      with everything well"                                           -- the owner, 25 Nov 2026

   WHAT WAS WRONG WITH THAT BELIEF, AND WHAT THIS IS. Until this file the helper knew eight lines of
   glossary and one line about each screen (claudian-knowledge.js), and matched a question to a screen
   by ENGLISH words only, so a question in Swahili found no screen note at all. It had none of this
   development chat and none of the company's data (it must not: the owner's own orders are that it
   is "only there to help" and keeps other departments' data private). What it can have, safely and
   cheaply, is what the system's own rules ARE, written once by people who read the code, checked by
   others who tried to refute them, and sent in small pieces.

   A CARD is one short English statement of how a part of the system works today, with the words
   (Swahili and English) a person would use to ask about it:

       { id, tabs, where, leader, keys, text }

   For each question the helper is sent the two or three cards whose keys the question touches (and
   nothing else), after the cached front of the request. No extra model call, no extra read of the
   database: the cards are data in this repository, picked in memory.

   PRIVACY IS MECHANISM, NOT A REQUEST TO THE MODEL (the same rule as the screen notes). A card that is
   about a restricted screen names its tabs, and a person who holds none of them is never sent it: a
   model that has not been told cannot repeat it. The phone app's people hold no portal screens, so
   they get only the cards written for the phone, or about the few screens whose subject the phone
   shows too (PHONE_TABS); a card marked `leader` goes only to a leader there.

   WHAT A CARD MAY NOT HOLD: a person, a customer, a team, a figure of the company, a file name or a
   developer's word. test/claudian-cards.test.mjs fails on each, on a key that would match almost every
   question, on a text longer than MAX_CARD_CHARS, and on a number the system fixes that no longer
   equals the code's own.

   WHEN A RULE CHANGES the card that states it changes in the same commit (CHAT.md section 7): a card
   the helper trusts and that is wrong costs somebody a decision; a card that is missing only costs an
   "I do not know".
   ===================================================================================== */
import { CARDS, TAB_KEYS } from './claudian-cards-data.js';

export { CARDS, TAB_KEYS };

/** At most this many cards go with a question, and at most this many characters of them: about 250 tokens of input, never more. */
export const MAX_CARDS = 3;
export const MAX_CARD_CHARS = 380;
export const MAX_CARDS_CHARS = 1100;
/** The portal screens whose subject the phone app shows too: a card about one of them may reach a phone user (a leader's Exp.Def list and Ripoti, the follow-up lists, the call reports). */
export const PHONE_TABS = new Set(['calls', 'followup', 'promises', 'defexp', 'expdfrep']);

/** The marks that sit on a letter (the accent of "cafe" written with a mark): built from escapes, because the file tool turns an escape typed in a regex into the invisible character itself. */
const MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
/** The words of a question: lowercase, accents taken off, letters and digits only. */
export function wordsOf(q) {
  return String(q == null ? '' : q).toLowerCase().normalize('NFD').replace(MARKS, '').match(/[a-z0-9]+/g) || [];
}

/** Does the question touch this key? A key of three letters or fewer is a whole word (def, exp, par, leo); a longer key is a stem and touches any word that
    starts with it or holds it ("piga" in "nikipiga", "leave" in "leaves", "notisi" in "notisi"). A key of seven letters or more also forgives ONE slip in a
    word of the question (a letter missed, added, wrong or two swapped: "restrcture", "uplod" is too short for it): a person types fast on a phone. */
export function keyHit(tokens, key, fuzzy = false) {
  const k = String(key || '').toLowerCase();
  if (!k) return false;
  if (k.includes('_')) return phraseHit(tokens, k.split('_').filter(Boolean));
  if (k.length <= 3) return tokens.includes(k);
  for (const t of tokens) {
    if (t === k || (t.length > k.length && t.includes(k))) return true;
    if (fuzzy && k.length >= 7 && t.length >= 6 && oneSlip(t, k)) return true;
  }
  return false;
}
/** A PHRASE KEY joins words with an underscore ("ana_namba_nyingine"): it is touched only when the question has those words one after the other, each a whole word
    or, for a part of four letters or more, a word that starts with it ("namba" in "nambari"). It is how a term of the system that is made of ordinary words
    (the field "Ana namba nyingine") is told from each of its words alone. */
function phraseHit(tokens, parts) {
  if (!parts.length) return false;
  for (let i = 0; i + parts.length <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < parts.length && ok; j++) {
      const t = tokens[i + j], p = parts[j];
      ok = t === p || (p.length >= 4 && t.length > p.length && t.startsWith(p));
    }
    if (ok) return true;
  }
  return false;
}
/** Two words one slip apart: one letter missing, added or wrong, or two neighbours swapped. */
function oneSlip(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/** How many distinct keys of a list the question touches. */
export function keyScore(tokens, keys, fuzzy = false) {
  let n = 0;
  const seen = new Set();
  for (const key of keys || []) {
    const k = String(key || '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (keyHit(tokens, k, fuzzy)) n++;
  }
  return n;
}

/** Ordinary words of the two languages that touch a key by accident ("leo" is today, "jana" yesterday, "saturday" any Saturday): a hit on one counts for
    less than half, so it cannot bring a card alone. They stay keys: "Leo list" or "orodha ya Kesho" still finds the phone's lists, with the second word. */
export const COMMON_WORDS = new Set(['leo', 'jana', 'kesho', 'wiki', 'mwezi', 'siku', 'saa', 'week', 'month', 'today', 'tomorrow', 'yesterday', 'daily', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'sunday', 'jumatatu', 'jumanne', 'jumatano', 'alhamisi', 'ijumaa', 'jumamosi', 'jumapili', 'bora', 'habari', 'orodha', 'list', 'namba', 'number',
  'nyingine', 'mteja', 'wateja', 'customer', 'customers', 'kiasi', 'amount', 'mwaka', 'year', 'time', 'muda', 'tarehe', 'date', 'report', 'ripoti', 'status', 'hali', 'check', 'angalia']);
const COMMON_FACTOR = 0.45;
/** A card is sent only if its keys weigh at least this much (in the units of keyWeight: 1 is a key that no other card has). One key that only this card has
    is enough; a key shared by several cards needs a second. */
export const MIN_CARD_SCORE = 0.95;

/** The weight of each key, from how few cards carry it: ln(1 + N/df) / ln(1 + N), so 1 for a key of one card only and less for a key many cards share. */
const dfCache = new WeakMap();
function keyWeights(cards) {
  let w = dfCache.get(cards);
  if (w) return w;
  const df = new Map();
  let n = 0;
  for (const c of cards) { if (!c || typeof c.text !== 'string' || !Array.isArray(c.keys)) continue; n++; for (const k of new Set(c.keys.map(x => String(x).toLowerCase()))) df.set(k, (df.get(k) || 0) + 1); }
  w = new Map();
  const norm = Math.log(1 + Math.max(1, n));
  for (const [k, d] of df) w.set(k, (Math.log(1 + n / d) / norm) * (COMMON_WORDS.has(k) ? COMMON_FACTOR : 1));
  if (cards && typeof cards === 'object') dfCache.set(cards, w);
  return w;
}
/** The weight of the keys of one card that the question touches. */
export function cardScore(tokens, card, weights) {
  let s = 0;
  const seen = new Set();
  for (const key of card.keys || []) {
    const k = String(key || '').toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    if (keyHit(tokens, k, true)) s += weights.get(k) || 0;
  }
  return s;
}

/** May this person be sent this card? Privacy as mechanism (see the head of this file). `subject` is the helper's own: { source: 'call' | 'portal',
    leader, allTabs, tabs }. A card written for the phone is the same knowledge for a person in the portal (how the phone app works is nothing restricted: a
    card about a RESTRICTED screen carries that screen's name in `tabs`, whatever app it is asked in). */
export function cardAllowed(card, subject) {
  const s = subject || {};
  const tabs = Array.isArray(card.tabs) ? card.tabs : [];
  if (s.source === 'call') {
    if (card.where === 'web') return false;
    if (card.leader && !s.leader) return false;
    return !tabs.length || tabs.every(t => PHONE_TABS.has(t));
  }
  if (!tabs.length) return true;
  return !!s.allTabs || tabs.some(t => (s.tabs || []).includes(t));
}

/** The cards a question touches, best first, from a list of cards (the real list below, or a test's): those whose keys weigh at least MIN_CARD_SCORE, and
    after the first only those that weigh at least half of it; at most MAX_CARDS and MAX_CARDS_CHARS. */
export function pickFrom(cards, subject, question, opts = {}) {
  const tokens = wordsOf(question);
  if (!tokens.length || !Array.isArray(cards)) return [];
  const maxCards = opts.maxCards || MAX_CARDS, maxChars = opts.maxChars || MAX_CARDS_CHARS, minScore = opts.minScore == null ? MIN_CARD_SCORE : opts.minScore;
  const weights = keyWeights(cards);
  const scored = [];
  cards.forEach((card, i) => {
    if (!card || typeof card.text !== 'string' || !cardAllowed(card, subject)) return;
    const score = cardScore(tokens, card, weights);
    if (score >= minScore) scored.push({ card, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const top = scored.length ? scored[0].score : 0;
  const out = [];
  let used = 0;
  for (const { card, score } of scored) {
    if (out.length >= maxCards) break;
    if (out.length && score < top / 2) break;
    if (used + card.text.length > maxChars) continue;
    out.push({ id: card.id, text: card.text });
    used += card.text.length;
  }
  return out;
}

/** The cards for a question, from the real list. */
export function pickCards(subject, question) {
  return pickFrom(CARDS, subject, question);
}

/** How strongly a question talks about a screen, by the Swahili and English words staff use for it (TAB_KEYS). Added to the English-note match in
    claudian.js, so that a question in Swahili finds the screen's note too. */
export function tabKeyScore(question, id) {
  const k = TAB_KEYS[id];
  if (!k) return 0;
  return keyScore(wordsOf(question), [...(k.sw || []), ...(k.en || [])]);
}
