// Coverage of what real screens showed, against the vocabulary. Exports analyze(); CLI prints the gaps.
import fs from 'node:fs';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function analyze(domItems, R, recs) {
  const phrases = [];
  const add = (t) => { if (t && /[A-Za-z]/.test(t)) phrases.push(t.replace(/\s+/g, ' ').trim()); };
  for (const p of R.pairs) { add(p.sw); add(p.en); }
  for (const e of R.en) add(e.text);
  for (const e of R.sw) add(e.text);
  const comp = [...new Set(phrases)].sort((a, b) => b.length - a.length).map((p) => {
    const parts = p.split(/\{\w+\}/);
    return { p, parts, lit: parts.reduce((a, b) => (b.length > a.length ? b : a), '').trim().toLowerCase(), re: null };
  });
  const reOf = (c) => c.re || (c.re = new RegExp('(?<![\\p{L}\\p{N}])' + c.parts.map(esc).join('.{0,80}?') + '(?![\\p{L}\\p{N}])', 'giu'));
  let haystack = '';
  const fullSet = new Set();
  for (const r of recs) if (r.include) { const t = r.t.replace(/\s+/g, ' ').trim(); if (!fullSet.has(t)) { fullSet.add(t); haystack += t + '\u0000'; } }
  const hayNoPh = haystack.replace(/\{\w+\}/g, '\u0001');
  const hayL = haystack.toLowerCase(), hayNoPhL = hayNoPh.toLowerCase();
  const inFull = (d) => hayL.includes(d.toLowerCase()) || hayNoPhL.includes(d.toLowerCase());
  const leftover = (d) => {
    let s = d; const hits = [];
    for (const c of comp) {
      if (c.lit.length < 2 || !s.toLowerCase().includes(c.lit)) continue;
      const re = reOf(c); re.lastIndex = 0;
      s = s.replace(re, (m) => { hits.push(c.p); return '\u0000'.repeat(m.length); });
    }
    return { rest: s.replace(/\u0000+/g, ' ').replace(/\s+/g, ' ').trim(), hits };
  };
  const hayLower = ' ' + haystack.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ' ') + ' ';
  const inVocab = (w) => hayLower.includes(' ' + w.toLowerCase() + ' ');
  const seen = new Map();
  for (const it of domItems) {
    const t = it.t.replace(/\s+/g, ' ').trim();
    if (!/[A-Za-zÀ-ɏ]{2,}/.test(t)) continue;
    const key = it.k + '|' + t;
    if (!seen.has(key)) seen.set(key, { ...it, t, views: new Set() });
    seen.get(key).views.add(it.view);
  }
  let covered = 0;
  const gaps = [];
  for (const e of seen.values()) {
    if (inFull(e.t)) { covered++; continue; }
    const { rest, hits } = leftover(e.t);
    const words = rest.match(/[A-Za-zÀ-ɏ]{2,}/g) || [];
    if (!words.length) { covered++; continue; }
    gaps.push({ t: e.t, k: e.k, rest, words, hits: hits.length, views: [...e.views].slice(0, 3).join(',') });
  }
  return { distinct: seen.size, covered, gaps };
}

if (process.argv[1] && process.argv[1].endsWith('cover.mjs')) {
  const [domFile, rowsFile, recsFile] = process.argv.slice(2, 5);
  if (!domFile || !rowsFile || !recsFile) { console.error('usage: node cover.mjs <dom.json> <rows.json> <recs.json> [how many gaps to print]'); process.exit(2); }
  const dom = JSON.parse(fs.readFileSync(domFile, 'utf8'));
  const R = JSON.parse(fs.readFileSync(rowsFile, 'utf8'));
  const recs = JSON.parse(fs.readFileSync(recsFile, 'utf8'));
  const a = analyze(dom.items, R, recs);
  console.log('distinct strings seen', a.distinct, 'covered', a.covered, 'gaps', a.gaps.length);
  const skip = /ASHA|JUMA|STAFF ONE|THE ADMIN|KONGOWE|MBAGALA|GMO (ONE|TWO)|MGR ONE|HMCL|RHOBI|OFFICER A|GMO1|ADMIN1/;
  for (const g of a.gaps.filter((x) => !skip.test(x.t)).slice(0, +process.argv[5] || 100)) console.log((g.hits ? '~' : '!') + ' ' + JSON.stringify(g.t).slice(0, 100) + (g.hits ? '  REST: ' + JSON.stringify(g.rest).slice(0, 70) : '') + '  [' + g.views + ']');
}
