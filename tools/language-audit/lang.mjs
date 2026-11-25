// Language scoring: positive = Swahili, negative = English.
import { wordsOf, wordLang, SW_SEED, EN_SEED } from './lex.mjs';

// closed-class words: the most reliable evidence of a language in a short text
export const SW_FN = new Set('ya wa na kwa la za cha vya ni si hii huu hizi hiyo huo hizo hili hilo yake wake zake kila bado hakuna kwenye kuhusu lakini au pia tu sana zaidi ndani nje juu chini kabla baada hadi tangu ili kama kwamba ambayo ambao ambaye mimi wewe yeye sisi nyinyi wao yangu yako yetu yenu yao katika kutoka kuwa wala huku hapa pale hapo sasa tena kisha halafu wakati ndiyo hapana tafadhali pekee wote zote yote kabisa mpya mapya sawa hata bila pamoja pia kisha kwanza mwisho nyingine mwingine tayari bado haijapakiwa haikuhifadhiwa'.split(/\s+/));
export const EN_FN = new Set('the of and to in is for on at by with from not no or this that are was were be been as it its you your all any per only if when will would can may must should has have had do does did than then there their they them these those which what who how why where into over under after before between during without within about each every both either other such same more most less very just still already yet again once a an'.split(/\s+/));

const SW_SET = new Set(SW_SEED), EN_SET = new Set(EN_SEED);
const EN_SUFFIX = /(tion|sion|ment|ness|ing|ed|ly|able|ible|ity|ive|ous|ful|less|ship|age|ence|ance|er|or|ist|ize|ise|al|ic|ty|ies|es|s|ck|th|ght|ph|wh|oo|ee|ou|ow|ew|ai|ay|ey|oy)$/;
const SW_PREFIX = /^(ki|vi|wa|ku|ha|si|ni|tu|mw|m|u|ma|ch|nd|ng|ny|nj|nz|mb|ts|sh|dh|th|gh|kh)/;
// strict Bantu syllable shape: (C)(C)V repeated, consonant clusters only the Swahili ones
const CV = /^(?:(?:mb|nd|ng'?|nj|ny|nz|mw|ch|sh|th|dh|gh|kh|ts|kw|gw|pw|vy|ny|[bcdfghjklmnprstvwyz])?[aeiou]|m(?=[bcdfghjklnprstvwyz])|n(?=[bcdfghjklmprstvwyz]))+$/;

export function morph(w) {
  if (w.length < 3) return 0;
  let s = 0;
  if (CV.test(w)) s += w.length >= 5 ? 1.2 : 0.4;
  else s -= 0.8;
  if (/[aeiou]$/.test(w) === false) s -= 0.8; // consonant ending: English-like
  if (EN_SUFFIX.test(w) && !CV.test(w)) s -= 0.7;
  if (/[qx]/.test(w)) s -= 1.2;
  if (/(th|ck|ght|ph|tion)/.test(w)) s -= 1;
  return s;
}

export function makeLang(tab) {
  const wScore = (w) => {
    const l = wordLang(tab, w);
    let s = l.s;
    if (l.n === 0) { s = morph(w); if (SW_SET.has(w)) s += 3; if (EN_SET.has(w)) s -= 3; return Math.max(-3, Math.min(3, s)); }
    // frequent in both sides = neutral term; weight by confidence
    const conf = Math.min(1, (l.n + 1) / 4);
    return Math.max(-3, Math.min(3, s * conf + (l.n < 3 ? morph(w) * 0.4 : 0)));
  };
  const score = (text) => {
    const ws = wordsOf(text).filter((w) => w.length >= 2 || /^[a]$/.test(w));
    let s = 0;
    for (const w of ws) s += SW_FN.has(w) ? 2.5 : EN_FN.has(w) ? -2.5 : Math.max(-2, Math.min(2, wScore(w)));
    return { s, n: ws.length };
  };
  const cls = (text) => {
    const { s, n } = score(text);
    if (n === 0) return { lang: 'neutral', s, n };
    // closed-class words decide first: a Swahili sentence full of English product names is still Swahili
    const ws = wordsOf(text);
    let swFn = 0, enFn = 0;
    for (const w of ws) { if (SW_FN.has(w)) swFn++; else if (EN_FN.has(w)) enFn++; }
    if (swFn >= 1 && swFn >= 2 * enFn) return { lang: 'sw', s, n, per: s / Math.sqrt(n), by: 'fn' };
    if (enFn >= 1 && enFn >= 2 * swFn) return { lang: 'en', s, n, per: s / Math.sqrt(n), by: 'fn' };
    const per = s / Math.sqrt(n);
    if (per >= 0.9) return { lang: 'sw', s, n, per };
    if (per <= -0.9) return { lang: 'en', s, n, per };
    return { lang: 'neutral', s, n, per };
  };
  return { score, cls, wScore };
}
