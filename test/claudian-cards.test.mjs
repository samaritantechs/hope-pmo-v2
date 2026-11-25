/* THE KNOWLEDGE CARDS (handbook Part 159) -- the engine that picks, for each question, the few cards of how HOPE works that it touches, and holds the
   rule that a person is never sent a card about a screen they may not open.

     "So I believe Claudian-PMO has both knowledge from this chat and db to know how we really deal with everything well"   -- the owner, 25 Nov 2026

   (It had neither: eight glossary lines and a line for each screen, matched by English words only.) The engine is tested here on made-up cards, so that
   what it does is held apart from what the cards say; the cards themselves are tested below it. */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const K = await import('../api/_lib/claudian-cards.js');

const C = (id, keys, text, over = {}) => ({ id, tabs: [], where: 'both', leader: false, keys, text, ...over });
const LEAVE = C('leave', ['likizo', 'leave', 'holiday', 'ruhusa'], 'Leave: ask on Leave request.', { tabs: ['leavereq', 'leaveappr'], where: 'web' });
const LEGAL = C('legal', ['notisi', 'demand', 'notice', 'wakili'], 'A demand notice needs the rule.', { tabs: ['legal'], where: 'web' });
const CALLS = C('calls', ['piga', 'simu', 'call', 'portfolio', 'nikipiga'], 'A portfolio call is longer than the minimum.');
const EXPDEF = C('expdef', ['exp.def', 'expdef', 'leader', 'kiongozi', 'orodha'], 'Exp.Def is the leader list.', { tabs: ['defexp'], leader: true });
const PHONEONLY = C('phone', ['search', 'tafuta', 'namba'], 'Search finds a customer by name, REF or phone.', { where: 'phone' });
const ALL = [LEAVE, LEGAL, CALLS, EXPDEF, PHONEONLY];

const ADMIN = { source: 'portal', allTabs: true, tabs: [] };
const CLERK = { source: 'portal', allTabs: false, tabs: ['dashboard'] };
const HR = { source: 'portal', allTabs: false, tabs: ['leavereq'] };
const FO = { source: 'call', leader: false };
const GMO = { source: 'call', leader: true };

test('THE WORDS OF A QUESTION: lowercase, accents off, letters and digits only; anything that is not text has none', () => {
  assert.deepEqual(K.wordsOf('  Nifanye NINI, kama Mteja HAJALIPA?! (Leo) 2dc+ '), ['nifanye', 'nini', 'kama', 'mteja', 'hajalipa', 'leo', '2dc']);
  assert.deepEqual(K.wordsOf('Mkopo wa Ruhusá — café'), ['mkopo', 'wa', 'ruhusa', 'cafe']);
  for (const v of [null, undefined, '', '   ', '?!', 12, {}, []]) assert.ok(Array.isArray(K.wordsOf(v)));
  assert.deepEqual(K.wordsOf(null), []); assert.deepEqual(K.wordsOf(undefined), []);
});

test('A KEY: three letters or fewer is a whole word; longer is a stem that any word holding it touches ("piga" in "nikipiga"), and nothing else does', () => {
  assert.equal(K.keyHit(['nikipiga'], 'piga'), true);
  assert.equal(K.keyHit(['leaves'], 'leave'), true);
  assert.equal(K.keyHit(['leave'], 'leave'), true);
  assert.equal(K.keyHit(['pigo'], 'piga'), false);
  assert.equal(K.keyHit(['def'], 'def'), true);
  assert.equal(K.keyHit(['default', 'defaulters'], 'def'), false, 'a short key is the word itself');
  assert.equal(K.keyHit(['par'], 'par'), true); assert.equal(K.keyHit(['partial'], 'par'), false);
  assert.equal(K.keyHit(['simu'], 'SIMU'), true, 'the key is read in lowercase');
  for (const k of ['', null, undefined]) assert.equal(K.keyHit(['simu'], k), false);
  assert.equal(K.keyHit([], 'simu'), false);
});

test('ONE SLIP IS FORGIVEN IN A LONG KEY AND NOWHERE ELSE: a letter missed, added, wrong or two swapped in "restructure"; never in a key under seven letters ("hatari" is not "habari")', () => {
  for (const w of ['restrcture', 'restructure', 'restructuree', 'restrucutre', 'restructura']) assert.equal(K.keyHit([w], 'restructure', true), true, w);
  assert.equal(K.keyHit(['restrcture'], 'restructure'), false, 'off unless asked');
  for (const w of ['restcture', 'restrukchure', 'restruct']) assert.equal(K.keyHit([w], 'restructure', true), false, 'two slips or more: ' + w);
  assert.equal(K.keyHit(['habari'], 'hatari', true), false, 'a six-letter key is exact: a greeting is not the portfolio at risk');
  assert.equal(K.keyHit(['uplod'], 'upload', true), false);
  assert.equal(K.keyHit(['nafungaje'], 'kufunga', true), false);
});

test('A PHRASE KEY (words joined by an underscore) is touched only by those words one after the other: the field "Ana namba nyingine" is not each of its words alone', () => {
  const t = w => K.wordsOf(w);
  assert.equal(K.keyHit(t('Ana namba nyingine ni nini?'), 'ana_namba_nyingine'), true);
  assert.equal(K.keyHit(t('weka ana namba nyingine'), 'ana_namba_nyingine'), true);
  assert.equal(K.keyHit(t('namba nyingine ana'), 'ana_namba_nyingine'), false, 'in the order of the phrase');
  assert.equal(K.keyHit(t('ana ya namba nyingine'), 'ana_namba_nyingine'), false, 'one after the other');
  assert.equal(K.keyHit(t('namba nyingine'), 'ana_namba_nyingine'), false, 'all of its words');
  assert.equal(K.keyHit(t('Exp.Def ya leo'), 'exp_def'), true, 'a dot is a word break: Exp.Def is "exp def"');
  assert.equal(K.keyHit(t('expdef'), 'exp_def'), false);
  assert.equal(K.keyHit(t('nambari nyingine ana'), 'namba_nyingine'), true, 'a part of four letters or more starts a word ("nambari")');
  assert.equal(K.keyHit(t('ana'), 'ana_'), true); assert.equal(K.keyHit([], 'a_b'), false); assert.equal(K.keyHit(t('x'), '_'), false);
  // a phrase key weighs like any key: how few cards carry it
  const cards = [mk('a', ['ana_namba_nyingine', 'zzzz1']), mk('b', ['namba', 'nyingine', 'zzzz2']), mk('c', ['yyyy1']), mk('d', ['yyyy2'])];
  assert.deepEqual(K.pickFrom(cards, CLERK, 'weka ana namba nyingine').map(x => x.id), ['a'], 'the phrase brings its card alone');
  assert.deepEqual(K.pickFrom(cards, CLERK, 'namba nyingine').map(x => x.id), [], 'two ordinary words shared by cards do not');
});

test('A KEY SCORE counts each distinct key once, whatever its case, and ignores empty ones', () => {
  const t = K.wordsOf('naomba likizo ya likizo leo kwa leave');
  assert.equal(K.keyScore(t, ['likizo', 'LIKIZO', 'leave', '', null, 'hakuna']), 2);
  assert.equal(K.keyScore(t, undefined), 0); assert.equal(K.keyScore([], ['likizo']), 0);
});

test('WHO MAY BE SENT A CARD, in the portal: a card with no screens goes to everybody; one with screens only to a person who holds one of them (the admin holds all); how the phone works is nothing restricted', () => {
  assert.equal(K.cardAllowed(CALLS, CLERK), true);
  assert.equal(K.cardAllowed(LEGAL, CLERK), false, 'the Legal tab is not theirs');
  assert.equal(K.cardAllowed(LEGAL, ADMIN), true);
  assert.equal(K.cardAllowed(LEAVE, HR), true, 'one of the two leave screens is enough');
  assert.equal(K.cardAllowed(LEAVE, CLERK), false);
  assert.equal(K.cardAllowed(LEAVE, { source: 'portal', tabs: undefined }), false, 'no tabs at all');
  assert.equal(K.cardAllowed(PHONEONLY, ADMIN), true, 'a head-office person may be told how the phone app works');
  assert.equal(K.cardAllowed(PHONEONLY, CLERK), true);
  assert.equal(K.cardAllowed({ ...PHONEONLY, tabs: ['defexp'] }, CLERK), false, 'a card about a screen is for the people who hold the screen, in whichever app it is asked');
  assert.equal(K.cardAllowed({ ...LEGAL, tabs: undefined }, CLERK), true, 'a card with no tab list is a card for everybody (the data test forbids a restricted one)');
});

test('WHO MAY BE SENT A CARD, on the phone: never a portal-only card; a leader\'s card only to a leader; and no card about a screen the phone does not show', () => {
  assert.equal(K.cardAllowed(CALLS, FO), true);
  assert.equal(K.cardAllowed(LEAVE, GMO), false, 'portal only');
  assert.equal(K.cardAllowed(LEGAL, GMO), false);
  assert.equal(K.cardAllowed(PHONEONLY, FO), true);
  assert.equal(K.cardAllowed(EXPDEF, FO), false, 'a leader\'s card, an officer asked');
  assert.equal(K.cardAllowed(EXPDEF, GMO), true, 'Exp.Def is a screen the phone shows a leader too');
  assert.equal(K.cardAllowed(C('x', ['a'], 'x', { tabs: ['legal'], where: 'both' }), GMO), false, 'a card about a restricted screen never reaches the phone, even marked both');
  assert.ok([...K.PHONE_TABS].every(t => ['calls', 'followup', 'promises', 'defexp', 'expdfrep'].includes(t)), 'the phone shows only these');
});

/* The weight of a key is how few cards carry it: 1 for a key of one card only (so it brings its card alone), less for a key several cards share (it needs
   a second), and under half for an ordinary word of the two languages ("leo", "saturday"), which can never bring a card alone. */
const mk = (id, keys) => C(id, keys, id + ' text');
test('A KEY ONLY ONE CARD HAS BRINGS ITS CARD ALONE; A KEY SEVERAL SHARE NEEDS A SECOND; AN ORDINARY WORD NEVER BRINGS A CARD ALONE', () => {
  const cards = [mk('a', ['alpha', 'shared', 'common']), mk('b', ['beta', 'shared', 'other']), mk('c', ['gamma', 'shared', 'other']), mk('d', ['delta', 'leo', 'extra']), mk('e', ['epsilon', 'leo']), mk('f', ['zeta']), mk('g', ['eta']), mk('h', ['theta'])];
  const ids = q => K.pickFrom(cards, CLERK, q).map(x => x.id);
  assert.deepEqual(ids('alpha'), ['a'], 'a key of one card');
  assert.deepEqual(ids('shared'), [], 'a key of three cards is not enough alone');
  assert.deepEqual(ids('shared other'), ['b', 'c'], 'but two keys of the same cards are; list order breaks the tie');
  assert.deepEqual(ids('other'), [], 'a key of two cards');
  assert.deepEqual(ids('leo'), [], 'an ordinary word, shared by two cards');
  assert.deepEqual(ids('leo delta'), ['d'], 'and with a second hit it counts');
  assert.deepEqual(ids('nothing here'), []); assert.deepEqual(ids(''), []); assert.deepEqual(ids(null), []); assert.deepEqual(ids('the of and'), []);
  const lone = [mk('x', ['saturday', 'qqqq']), mk('y', ['rare', 'wwww'])];
  assert.deepEqual(K.pickFrom(lone, CLERK, 'saturday').map(x => x.id), [], 'a day of the week is not a topic even when only one card has it');
  assert.deepEqual(K.pickFrom(lone, CLERK, 'saturday rare').map(x => x.id), ['y']);
  assert.ok(K.COMMON_WORDS.has('leo') && K.COMMON_WORDS.has('saturday') && K.COMMON_WORDS.has('jana'));
  assert.ok(K.MIN_CARD_SCORE > 0.9 && K.MIN_CARD_SCORE <= 1, 'one unique key is enough, an ordinary word is not');
});

test('PICKING: the best match first, ties in the list\'s order, at most three cards, and after the first only cards worth at least half of it', () => {
  const a = mk('a', ['alpha1', 'beta1', 'gamma1']), b = mk('b', ['alpha1', 'beta1', 'gamma1', 'delta1']), c = mk('c', ['alpha1']), d = mk('d', ['alpha1', 'beta1']), e = mk('e', ['zzzzz']);
  const all = [a, b, c, d, e, mk('f', ['uuuuu']), mk('g', ['vvvvv'])];
  const ids = (q, o) => K.pickFrom(all, CLERK, q, o).map(x => x.id);
  assert.deepEqual(ids('alpha1 beta1 gamma1 delta1'), ['b', 'a'], 'the best first; "d" shares two of the four keys and is worth under half of "b", so it is left out');
  assert.deepEqual(ids('beta1 gamma1 alpha1'), ['a', 'b', 'd'], 'two cards that touch the same three keys go in list order, and "d" (two of the three) is worth more than half of them');
  assert.deepEqual(ids('zzzzz uuuuu vvvvv'), ['e', 'f', 'g'], 'three cards of equal worth, in list order; a fourth would not go');
  assert.deepEqual(ids('delta1'), ['b'], 'a key of one card');
  assert.deepEqual(ids('zzzzz'), ['e']);
  assert.deepEqual(ids('alpha1 beta1 gamma1 delta1', { maxCards: 1 }), ['b']);
  assert.deepEqual(ids('alpha1 beta1 gamma1 delta1', { minScore: 99 }), []);
  assert.equal(K.pickFrom(undefined, ADMIN, 'likizo').length, 0); assert.deepEqual(K.pickFrom('nope', ADMIN, 'likizo'), []);
  // after the first, only a card worth at least half of it: the weak one that shares one key is left out
  const strong = mk('strong', ['uniqa', 'uniqb', 'uniqc']), weak = mk('weak', ['uniqa', 'filler']);
  assert.deepEqual(K.pickFrom([strong, weak, mk('p', ['pppp']), mk('q', ['qqqq']), mk('r', ['rrrr']), mk('s', ['ssss'])], CLERK, 'uniqa uniqb uniqc').map(x => x.id), ['strong'], 'the other card shares one of the three keys');
});

test('PICKING IS CAPPED IN CHARACTERS TOO: a card that would pass the limit is skipped and a shorter one after it still goes', () => {
  const big = C('big', ['alpha', 'bigk'], 'x'.repeat(800)), mid = C('mid', ['alpha', 'midk'], 'y'.repeat(500)), small = C('small', ['alpha', 'smallk'], 'z'.repeat(100));
  const pad = [mk('p', ['pppp']), mk('q', ['qqqq']), mk('r', ['rrrr'])];
  const q = 'alpha bigk midk smallk';
  assert.deepEqual(K.pickFrom([big, mid, small, ...pad], CLERK, q).map(x => x.id), ['big', 'small'], 'big (800) fits, mid (500) would pass 1,100, small (100) fits');
  assert.deepEqual(K.pickFrom([mid, big, small, ...pad], CLERK, q).map(x => x.id), ['mid', 'small'], 'mid, then big would pass the limit, then small');
  assert.ok(K.pickFrom([big, mid, small, ...pad], CLERK, q).reduce((n, x) => n + x.text.length, 0) <= K.MAX_CARDS_CHARS);
});

test('A SWAHILI QUESTION FINDS ITS CARD, an English one the same card, and the other person\'s restricted cards are never among them', () => {
  const pick = (who, q) => K.pickFrom([...ALL, mk('filler1', ['fillera']), mk('filler2', ['fillerb']), mk('filler3', ['fillerc'])], who, q).map(x => x.id);
  assert.deepEqual(pick(HR, 'Naomba kuomba likizo, nifanyeje?'), ['leave']);
  assert.deepEqual(pick(HR, 'How do I ask for leave'), ['leave']);
  assert.deepEqual(pick(CLERK, 'Naomba kuomba likizo, nifanyeje?'), [], 'a person who may not open the leave screens is not told how it works');
  assert.deepEqual(pick(CLERK, 'Notisi ya demand inatolewa lini?'), [], 'nor the legal rule');
  assert.deepEqual(pick(ADMIN, 'Notisi ya demand inatolewa lini?'), ['legal']);
  assert.deepEqual(pick(FO, 'nikipiga simu kwa mteja, inahesabika?'), ['calls']);
  assert.deepEqual(pick(FO, 'tafuta namba ya mteja'), ['phone'], 'the phone card');
  assert.deepEqual(pick(ADMIN, 'tafuta namba ya mteja'), ['phone'], 'and a head-office person is told how the phone\'s search works too');
  assert.deepEqual(pick(FO, 'Notisi ya demand inatolewa lini?'), [], 'an officer on a phone is never told the legal rule');
});

test('PICKING CHANGES NOTHING AND ANSWERS THE SAME TWICE: the cards are not copied into other objects they could be changed through, and junk in the list is skipped', () => {
  const list = [LEAVE, null, undefined, 5, {}, { id: 'no-text', keys: ['likizo'] }, CALLS, mk('p', ['pppp']), mk('q', ['qqqq']), mk('r', ['rrrr'])];
  const snapshot = JSON.stringify(list);
  const a = K.pickFrom(list, ADMIN, 'likizo piga simu'), b = K.pickFrom(list, ADMIN, 'likizo piga simu');
  assert.deepEqual(a, b); assert.equal(JSON.stringify(list), snapshot);
  assert.deepEqual(a.map(x => x.id).sort(), ['calls', 'leave']);
  a[0].text = 'changed'; assert.notEqual(LEAVE.text, 'changed'); assert.notEqual(CALLS.text, 'changed');
  assert.deepEqual(K.pickFrom(undefined, ADMIN, 'likizo'), []);
  assert.deepEqual(K.pickFrom([{ ...LEAVE, tabs: undefined, keys: ['likizo'] }, mk('p', ['pppp']), mk('q', ['qqqq'])], undefined, 'likizo').length, 1, 'no subject is a portal person with no screens: only the card for everybody');
});

test('THE SCREEN WORDS: an unknown screen scores nothing', () => {
  assert.equal(K.tabKeyScore('likizo', 'no-such-screen'), 0);
  assert.equal(K.tabKeyScore('', 'dashboard'), 0);
});

/* ===================================================================================================================================
   THE CARDS THEMSELVES (api/_lib/claudian-cards-data.js). The engine above is tested on made-up cards; these tests hold the real ones to the
   rules written in the head of claudian-cards.js: what a card may say, who it may reach, and how a person's words find it.
   =================================================================================================================================== */
const { TAB_NOTES } = await import('../api/_lib/claudian-knowledge.js');
const AREAS = ['calls', 'defaulters', 'reports', 'legal', 'deduct', 'hr', 'admin'];
const SHORT_KEYS = new Set(['def', 'exp', 'chr', 'leo', 'par', 'dsc', 'dcc', 'hr', 'tv', 'gmo', 'opm']);
/** The portal screens a phone does not show, by the label staff read ("Credit Analysts" is left out: a card says "credit analysts" for the ROLE, whose lists the phone narrows). */
const RESTRICTED_LABELS = Object.keys(TAB_NOTES).filter(id => !K.PHONE_TABS.has(id) && id !== 'credit').map(id => TAB_NOTES[id][0]);
/** A card names a screen when it writes its label: a label of several words in any case ("teams & staff"), a one-word label as it is written ("Settings", never the ordinary word "settings"). */
const names = (text, label) => (/\s/.test(label) ? text.toLowerCase().includes(label.toLowerCase()) : text.includes(label));

test('THE CARDS: every card is whole -- a unique kebab-case id of its area, known screens, a valid reach, keys a person could type, a text of the right length', () => {
  assert.ok(K.CARDS.length >= 60, 'the set is ' + K.CARDS.length + ' cards');
  const ids = new Set();
  for (const c of K.CARDS) {
    assert.match(c.id, /^[a-z]+(-[a-z0-9]+)+$/, 'id ' + c.id);
    assert.ok(!ids.has(c.id), 'duplicate id ' + c.id); ids.add(c.id);
    assert.ok(AREAS.includes(c.id.split('-')[0]), 'area of ' + c.id);
    assert.ok(Array.isArray(c.tabs), c.id + ' tabs'); for (const t of c.tabs) assert.ok(TAB_NOTES[t], c.id + ' names an unknown screen: ' + t);
    assert.equal(new Set(c.tabs).size, c.tabs.length, c.id + ' repeats a screen');
    assert.ok(['both', 'web', 'phone'].includes(c.where), c.id + ' where');
    assert.equal(typeof c.leader, 'boolean', c.id + ' leader');
    assert.ok(Array.isArray(c.keys) && c.keys.length >= 5 && c.keys.length <= 16, c.id + ' has ' + (c.keys || []).length + ' keys');
    assert.equal(new Set(c.keys).size, c.keys.length, c.id + ' repeats a key');
    for (const k of c.keys) { assert.match(k, /^([a-z0-9]{3,16}|[a-z0-9]{1,12}(_[a-z0-9]{1,12}){1,3})$/, c.id + ' key ' + k); assert.ok(k.length >= 4 || SHORT_KEYS.has(k), c.id + ' key too short: ' + k); }
    assert.equal(typeof c.text, 'string');
    assert.ok(c.text.length >= 60 && c.text.length <= K.MAX_CARD_CHARS, c.id + ' text is ' + c.text.length + ' characters');
    assert.equal(c.text, c.text.replace(/\s+/g, ' ').trim(), c.id + ' has stray blanks');
    assert.ok(!/[<>]|&(amp|lt|gt|quot|#\d+);/.test(c.text), c.id + ' carries markup or an HTML entity');
  }
});

test('THE CARDS SAY WHAT THE SYSTEM DOES AND NOTHING ELSE: no developer\'s word, no file, no person, no customer, no number of the company or of a person', () => {
  const DEV = /\b(Part \d+|RUN-ME|CHAT\.md|HANDOFF|handbook|SQL|Supabase|Postgres|PostgREST|JSON|endpoint|migration|webhook|cron|cache|regex|async)\b|\.(m?js|html|sql|md)\b|https?:|\/api\/|`/i;
  for (const c of K.CARDS) {
    assert.ok(!DEV.test(c.text), c.id + ' speaks like a developer: ' + (c.text.match(DEV) || [''])[0]);
    assert.ok(!/\d{7,}/.test(c.text.replace(/[,\s]/g, '')) && !/\b\d{1,3}(,\d{3}){2,}\b/.test(c.text), c.id + ' carries a long number (a phone, an account, a company figure)');
    assert.ok(!/\bTZS\s*[\d,]{5,}/i.test(c.text), c.id + ' carries an amount of money');
    assert.ok(!/@|\bpassword\b|\baccess code is\b/i.test(c.text), c.id + ' touches a secret');
  }
});

test('WHAT REACHES A PHONE NAMES NO SCREEN THE PHONE DOES NOT SHOW: a card with no screens, or only the phone\'s, is sent to every officer, so it never says "Settings" or "Teams & Staff"', () => {
  const phoneReach = c => c.where !== 'web' && c.tabs.every(t => K.PHONE_TABS.has(t));
  const reach = K.CARDS.filter(phoneReach);
  assert.ok(reach.length >= 15, 'the phone is sent ' + reach.length + ' cards');
  for (const c of reach) for (const lab of RESTRICTED_LABELS) assert.ok(!names(c.text, lab), c.id + ' (reaches the phone) names the screen "' + lab + '"');
  for (const c of K.CARDS.filter(x => x.where === 'phone')) assert.ok(c.tabs.every(t => K.PHONE_TABS.has(t)), c.id + ': a phone card about a portal screen');
  // and the engine really does hold a portal-only card back from a phone, whatever its words
  for (const c of K.CARDS.filter(x => x.tabs.some(t => !K.PHONE_TABS.has(t)))) assert.equal(K.cardAllowed(c, { source: 'call', leader: true }), false, c.id);
});

test('NO KEY IS SO COMMON THAT IT BRINGS HALF THE CARDS: a key appears in at most six cards', () => {
  const n = new Map();
  for (const c of K.CARDS) for (const k of c.keys) n.set(k, (n.get(k) || 0) + 1);
  const heavy = [...n].filter(([, v]) => v > 6);
  assert.deepEqual(heavy, [], 'keys in more than six cards: ' + JSON.stringify(heavy));
});

test('EVERY SCREEN HAS ITS WORDS, IN BOTH LANGUAGES, and they are plain lowercase words', () => {
  for (const id of Object.keys(TAB_NOTES)) {
    const k = K.TAB_KEYS[id];
    assert.ok(k && k.sw.length >= 1 && k.en.length >= 2, 'screen words of ' + id);
    for (const w of [...k.sw, ...k.en]) assert.match(w, /^[a-z0-9]{2,16}$/, id + ': ' + w);
    assert.equal(new Set([...k.sw, ...k.en]).size, k.sw.length + k.en.length, id + ' repeats a word');
  }
  assert.deepEqual(Object.keys(K.TAB_KEYS).filter(id => !TAB_NOTES[id]), [], 'words for a screen the notes do not know');
});

/* ---------------------------------------------------------------------------------------------------------------------------------------
   THE FEW NUMBERS THE SYSTEM FIXES ITSELF are held to the code: a card that says "90 days" is wrong the day the code says 60, and a card the helper
   trusts and that is wrong costs somebody a decision. Each pin reads the number out of the code's own source and out of the card's text. Everything
   else a card says is a Settings value and is not written in it (the data test above forbids a company figure).
   --------------------------------------------------------------------------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PORTAL = src('api/_lib/portal-core.js'), CALLC = src('api/_lib/call-core.js'), IMPREST = src('api/_lib/imprest.js'), LEGALMOD = src('public/mod/legal.js');
const card = id => { const c = K.CARDS.find(x => x.id === id); assert.ok(c, 'the card ' + id); return c.text; };
const num = (re, text, what) => { const m = text.match(re); assert.ok(m, what + ' in ' + text.slice(0, 60)); return Number(m[1].replace(/,/g, '')); };

test('THE NUMBERS A CARD STATES ARE THE CODE\'S OWN: the demand notice\'s D.C, the fine\'s rates, grace and rounding, the leave cap, the imprest photos, the phones at once, the code lengths, the search lengths', () => {
  // the demand notice and its fine
  const minDc = num(/const LEGAL_MIN_DC = (\d+);/, PORTAL, 'LEGAL_MIN_DC');
  assert.match(card('legal-cannot-issue'), new RegExp('D\\.C of ' + minDc + ' or more|D\\.C ' + minDc + '\\b|at least ' + minDc + '\\b|' + minDc + ' or more|\\b' + minDc + ' DC'), 'the D.C minimum');
  assert.match(PORTAL, /const legalDcWaived_ = d => \{ const p = dsParts\(dsOf\(d\)\); return !!p && p\.paid === 11 && p\.target === 12; \};/, 'the D.S 11-12 waiver, as the card describes it');
  assert.match(card('legal-cannot-issue'), /11-12/);
  const grace = num(/const LEGAL_GRACE_DAYS = (\d+);/, PORTAL, 'LEGAL_GRACE_DAYS');
  assert.match(card('legal-fine'), new RegExp('\\b' + grace + ' days'));
  assert.match(PORTAL, /disbYear <= 2024 \? 0\.02 : 0\.05/); assert.match(card('legal-fine'), /2%/); assert.match(card('legal-fine'), /5%/); assert.match(card('legal-fine'), /2024/);
  assert.match(PORTAL, /function roundUp500/); assert.match(card('legal-fine'), /\b500\b/); assert.match(card('legal-total-demand'), /\b500\b/);
  assert.equal(num(/noticeDays\) \|\| (\d+)\)/, PORTAL, 'default notice days'), 7); assert.match(card('legal-issue-steps'), /\(?7 by default|7 by default/);
  // searches
  assert.match(PORTAL, /Type at least 3 characters — a REF#, a name, or a phone number/); assert.match(PORTAL, /digits\.length >= 7\) clauses\.push\('contact\.ilike/);
  assert.match(card('legal-issue-steps'), /at least 3 characters; a phone needs 7 digits/);
  assert.equal(num(/const FIND_MIN_CHARS = (\d+)[,;]/, CALLC, 'FIND_MIN_CHARS'), 3); assert.match(card('calls-search-book'), /from 3 characters/);
  // leave, imprest, phones
  assert.match(PORTAL, /if \(days > 90\) throw badRequest\('Siku nyingi sana kwa ombi moja/); assert.match(card('hr-leave-rules'), /at most 90 days/);
  assert.equal(num(/const IMP_PHOTO_MAX = (\d+);/, IMPREST, 'IMP_PHOTO_MAX'), 3); assert.match(card('hr-imprest-retire'), /1 to 3 receipt photos/);
  assert.equal(num(/const DEVICE_MAX_BATCH = (\d+);/, PORTAL, 'DEVICE_MAX_BATCH'), 500); assert.match(card('hr-device-lock'), /up to 500/);
  assert.equal(num(/LEAVE_DAYS_DEFAULT = (\d+);/, PORTAL, 'LEAVE_DAYS_DEFAULT'), 26);
  // the codes of Settings
  assert.match(PORTAL, /if \(newCode\.length < 6\)/); assert.match(card('admin-access-codes'), /\(6\+ letters or digits\)/);
  assert.match(PORTAL, /codeKeyOf\(code\)\.length < 4/); assert.match(card('admin-team-code-handsets'), /needs 4\+ letters or digits/);
  // the phone's minimum seconds, as the glossary and the answers say it
  assert.equal(num(/export const CALL_MIN_SECS_DEFAULT = (\d+);/, CALLC, 'CALL_MIN_SECS_DEFAULT'), 5);
  // the two figures of the earners' card and the Legal tab, as the screens print them
  assert.match(LEGALMOD, /Recovered|Imerejeshwa/);
});
