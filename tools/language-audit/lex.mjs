// Swahili / English lexicon bootstrapped from the system's own "Sw / En" pairs.
import fs from 'node:fs';

export const SW_SEED = 'ya wa kwa na ni la za cha vya hii hizi hiyo huu huo hizo yake wake zake kila bado hakuna tafadhali kwenye kuhusu lakini au pia tu sana zaidi ndani nje juu chini kabla baada hadi tangu leo jana kesho wiki mwezi mwaka siku ili kama kwamba ambayo ambao ambaye mimi wewe yeye sisi nyinyi wao yangu yako yetu yenu yao katika kutoka kuwa si wala huku hapa pale hapo sasa tena kisha halafu wateja mteja mkopo mikopo ripoti orodha jina namba simu malipo marejesho deni hifadhi futa ongeza tuma chagua weka angalia fungua funga badilisha tafuta pakia pakua kosa imeshindikana imefanikiwa tarehe jumla wastani kiasi hali timu afisa kiongozi msimamizi mfumo msimbo ingia toka samahani karibu asante ndiyo hapana'.split(/\s+/);
export const EN_SEED = 'the of and to in is for on at by with from not no or this that are was be as it you your all any per only if when will has have had can may must should would could been being its their there these those which what who how why where than then also but so into over under after before between during without within about against each every both either neither other another such same more most less least very just still already yet again once new old first last next previous current today tomorrow yesterday week month year day'.split(/\s+/);

export const wordsOf = (t) => (t.toLowerCase().replace(/\u0001\d+\u0002/g, ' ').match(/[a-zà-ɏ]+(?:'[a-z]+)?/g) || []);

export function buildLexicon(pairTexts) {
  const SW = new Set(SW_SEED), EN = new Set(EN_SEED);
  const L = new Map(), R = new Map();
  const bump = (m, w) => m.set(w, (m.get(w) || 0) + 1);
  const parts = pairTexts.map((t) => { const i = t.indexOf(' / '); return [t.slice(0, i), t.slice(i + 3)]; });
  const orient = (a, b, tab) => {
    const sc = (txt) => { let s = 0; for (const w of wordsOf(txt)) { const sw = tab.sw.get(w) || 0, en = tab.en.get(w) || 0; s += SW.has(w) ? 2 : 0; s -= EN.has(w) ? 2 : 0; if (tab.use) s += Math.max(-2, Math.min(2, Math.log((sw + .5) / (en + .5)))); } return s; };
    return sc(a) - sc(b);
  };
  let tab = { sw: new Map(), en: new Map(), use: false };
  for (let round = 0; round < 4; round++) {
    const nsw = new Map(), nen = new Map();
    for (const [a, b] of parts) {
      const o = orient(a, b, tab);
      const [swT, enT] = o >= 0 ? [a, b] : [b, a];
      for (const w of new Set(wordsOf(swT))) bump(nsw, w);
      for (const w of new Set(wordsOf(enT))) bump(nen, w);
    }
    tab = { sw: nsw, en: nen, use: true };
  }
  return tab;
}

export function wordLang(tab, w) {
  const sw = tab.sw.get(w) || 0, en = tab.en.get(w) || 0;
  const seedSw = SW_SEED.includes(w), seedEn = EN_SEED.includes(w);
  let s = Math.log((sw + .4) / (en + .4));
  if (seedSw) s += 2; if (seedEn) s -= 2;
  return { s, n: sw + en, sw, en };
}
