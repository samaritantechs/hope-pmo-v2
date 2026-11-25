// Stage 3: decide, segment, classify, aggregate.
import fs from 'node:fs';
import { display, noPh, xph, contextVerdict, codeLike, tokens, hasWord, sigOf } from './decide.mjs';
import { buildLexicon, wordsOf } from './lex.mjs';
import { makeLang, SW_FN, EN_FN } from './lang.mjs';
import { FIX } from './overrides.mjs';

const UNITS = new Set(['km', 'tzs', 'usd', 'kb', 'mb', 'gb', 'ms', 'px', 'pt', 'am', 'pm', 'eat', 'utc', 'gps', 'url', 'id', 'ok', 'na', 'n/a', 'vs', 'etc', 'apk']);
const CAL = new Set('jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august september october november december mon tue tues wed thu thur thurs fri sat sun monday tuesday wednesday thursday friday saturday sunday januari februari machi mac aprili mei juni julai agosti ago septemba oktoba okt novemba desemba des jumatatu jumanne jumatano alhamisi alh ijumaa ijm jumamosi jumapili jtatu jnne jtano jmosi jpili jtt jnn jtn ijmaa'.split(' '));
const GLUE = new Set('of to in on at by or and for from with as ya wa na kwa la za cha vya kati ni si kama hadi tangu au'.split(' '));
const DENY_SINGLE = new Set(['Calibri', 'Arial', 'Helvetica', 'Segoe', 'Roboto', 'Georgia', 'Verdana', 'Tahoma', 'Courier','GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'JSON', 'NaN', 'Infinity', 'Error', 'Object', 'Array', 'String', 'Number', 'Date', 'Math', 'Promise', 'Event', 'Image', 'Audio', 'Blob', 'File', 'Map', 'Set', 'Window', 'Document', 'Element', 'Node', 'Authorization', 'Bearer', 'Content', 'Accept', 'Range', 'Cache', 'Origin', 'Referer']);

const isPlaceholderOnly = (t) => !hasWord(t);

const CSS_WORDS = new Set(['good', 'bad', 'warn', 'warnc', 'mut', 'mutl', 'on', 'off', 'hide', 'show', 'left', 'right', 'top', 'bottom', 'center', 'middle', 'block', 'none', 'flex', 'grid', 'bold', 'dim', 'small', 'large', 'primary', 'secondary', 'danger', 'success', 'info', 'active', 'disabled', 'hidden', 'open', 'closed', 'red', 'green', 'blue', 'amber', 'gray', 'grey', 'black', 'white', 'text', 'number', 'date', 'time', 'button', 'submit', 'reset', 'checkbox', 'radio', 'password', 'email', 'tel', 'url', 'search', 'file', 'image', 'hidden', 'string', 'object', 'function', 'boolean', 'undefined', 'null', 'true', 'false']);

export function decideAll(atoms, seenOnScreen) {
  const out = [];
  const pre = atoms.map((a) => {
    const t = a.origin === 'sql-hint' ? '' : display(a.text || '', a.phs);
    const cv = hasWord(t) ? contextVerdict(a) : 'none';
    const cl = hasWord(t) ? codeLike(xph(t)) : null;
    return { a, t, cv, cl };
  });
  // pass 1: lexicon from pair strings that are not code
  const pairSet = new Set();
  for (const p of pre) {
    if (!hasWord(p.t) || p.cv === 'hard' || p.cl) continue;
    if ((p.t.match(/ \/ /g) || []).length === 1) pairSet.add(noPh(p.t));
  }
  const tab = buildLexicon([...pairSet]);
  const L = makeLang(tab);
  const known = (w) => (tab.sw.get(w) || 0) + (tab.en.get(w) || 0) >= 2;
  const coverOf = (t) => {
    const wt = tokens(t).filter((w) => w.replace(/[^A-Za-zÀ-ɏ]/g, '').length >= 2);
    if (!wt.length) return { cover: 0, n: 0 };
    let k = 0;
    for (const w of wt) if (known(w.toLowerCase().replace(/[^a-zÀ-ɏ']/g, '')) || /^[A-Z]/.test(w)) k++;
    return { cover: k / wt.length, n: wt.length };
  };
  const isNatural = (t) => {
    if ((t.match(/ \/ /g) || []).length >= 1) { const c = coverOf(t); return c.n >= 2 && c.cover >= 0.5; }
    const c = coverOf(t); return c.n >= 3 && c.cover >= 0.6;
  };
  // pass 2: how often is each context signature given sentences?
  const sig = new Map();
  for (const p of pre) {
    if (p.a.origin !== 'js' || p.cv === 'hard' || p.cv === 'none' || p.cl) continue;
    const sg = sigOf(p.a);
    const e = sig.get(sg) || { n: 0, nat: 0 };
    e.n++; if (isNatural(p.t)) e.nat++;
    sig.set(sg, e);
  }
  const sigUi = (a) => {
    const sg = sigOf(a);
    if (!/^(call|key|asg) /.test(sg)) return false;
    const e = sig.get(sg);
    return !!e && e.nat >= 3 && e.nat / e.n >= 0.3;
  };

  for (const p of pre) {
    const { a, t, cv, cl } = p;
    const rec = { a, t, include: false, reason: '', cv };
    out.push(rec);
    if (a.origin === 'sql-hint') { rec.reason = 'tip pair'; continue; }
    if (!t || !hasWord(t)) { rec.reason = 'no words'; continue; }
    if (cv === 'hard') {
      const cal = (a.ctx && a.ctx.callee) ? a.ctx.callee.replace(/\(.*$/, '').replace(/^.*\./, '') : '';
      if (API_CALLEE.has(cal) || a.origin !== 'js' || cl || !isNatural(t)) { rec.reason = 'code context'; continue; }
    }
    if (cl && !(cv === 'ui' && cl === 'identifier' && /^[A-Z]/.test(t))) { rec.reason = 'code-like: ' + cl; continue; }
    const toks = tokens(t);
    const wordToks = toks.filter((w) => w.replace(/[^A-Za-zÀ-ɏ]/g, '').length >= 2);
    const uiCtx = cv === 'ui' || cv === 'ui+' || cv === 'maybe+' || sigUi(a);
    const hasPh = /\{\d+\}/.test(t);
    if (hasPh && wordToks.length === 1 && !/ \/ /.test(t)) {
      const w = wordToks[0].replace(/^[.'’-]+|[.'’-]+$/g, '');
      const wl = w.toLowerCase();
      if ((w.length >= 3 || GLUE.has(wl)) && !(CSS_WORDS.has(w) && /^[a-z]+$/.test(w)) && !UNITS.has(wl) && !/\d/.test(w) && (cv === 'ui' || cv === 'ui+' || cv === 'maybe+' || sigUi(a) || known(wl) || GLUE.has(wl) || /^[A-Z]/.test(w))) { rec.include = true; rec.reason = 'phrase with a value in it'; continue; }
      rec.reason = 'value + unit-like word'; continue;
    }
    if (toks.length === 1 || (wordToks.length === 1 && !/ \/ /.test(t))) {
      const w = (wordToks[0] || toks[0]).replace(/^[.'’-]+|[.'’-]+$/g, '');
      if (!w) { rec.reason = 'no words'; continue; }
      if (DENY_SINGLE.has(w)) { rec.reason = 'denied single word'; continue; }
      if (w.length < 2) { rec.reason = 'one letter'; continue; }
      if (UNITS.has(w.toLowerCase())) { rec.reason = 'unit / format abbreviation'; continue; }
      if (/\d/.test(w) && !/^[A-Z]{1,6}\d?$/.test(w)) { rec.reason = 'token with digits'; continue; }
      if (CAL.has(w.toLowerCase()) && cv !== 'code') { rec.include = true; rec.reason = 'calendar word'; continue; }
      if (cv === 'code') { rec.reason = 'single word, code context'; continue; }
      if (uiCtx) {
        if (/^[a-z]+$/.test(w) && (CSS_WORDS.has(w) || (cv !== 'ui' && cv !== 'ui+' && (!known(w) || w.length < 4)))) { rec.reason = 'lowercase word in UI-ish context, not a known word'; continue; }
        rec.include = true; rec.reason = 'single word in UI context'; continue;
      }
      if (a.surface === 'server') { rec.reason = 'server constant (single word, no UI context)'; continue; }
      if (/^[A-Z][a-z]{2,}$/.test(w)) { rec.include = true; rec.reason = 'Capitalised word'; continue; }
      if (/^[A-Z]{3,}$/.test(w) && known(w.toLowerCase())) { rec.include = true; rec.reason = 'ALL CAPS known word'; continue; }
      rec.reason = 'single token, no UI context'; continue;
    }
    // several words
    if (!/[a-z]/.test(noPh(t)) && !/ \/ /.test(t) && !(cv === 'ui' || cv === 'ui+') && !/^(maybe\+)$/.test(cv)) { rec.reason = 'ALL-CAPS header or constant'; continue; }
    if (/^\/[a-z]/.test(t)) { rec.reason = 'path'; continue; }
    const nat = isNatural(t);
    if (cv === 'code') {
      if (nat) { rec.include = true; rec.reason = 'phrase in a code context (kept: it reads as language)'; continue; }
      rec.reason = 'code context'; continue;
    }
    const c = coverOf(t);
    if (!uiCtx && cv === 'maybe') {
      if (RE_CLASSLIST.test(noPh(t)) && c.cover < 0.7) { rec.reason = 'looks like a class list'; continue; }
      if (c.cover < 0.4) { rec.reason = 'low vocabulary coverage'; continue; }
    }
    if (/^[\W\d_]*$/.test(noPh(t))) { rec.reason = 'no words'; continue; }
    rec.include = true; rec.reason = uiCtx ? 'phrase in UI context' : 'phrase';
  }
  // words and phrases a real screen showed that the code analysis had set aside (single lowercase words, ALL-CAPS statuses, ...)
  if (seenOnScreen) {
    const SOFT = /^(single token|single word|lowercase word|server constant|ALL-CAPS|unit|value \+ unit|token with digits|code-like: (identifier|selector|hex|column list|cache key)|looks like a class list|low vocabulary|short unknown|one letter)/;
    for (const rec of out) {
      if (rec.include || !SOFT.test(rec.reason)) continue;
      if (seenOnScreen.has(rec.t) || seenOnScreen.has(rec.t.replace(/\{\d+\}/g, '').trim())) { rec.include = true; rec.reason = 'seen on a real screen'; }
      else if (/_/.test(rec.t) && seenOnScreen.has(rec.t.replace(/[_]+/g, ' '))) { rec.t = rec.t.replace(/[_]+/g, ' '); rec.include = true; rec.reason = 'seen on a real screen'; }
    }
  }
  return { recs: out, tab, L, sig };
}
const API_CALLEE = new Set(['$', '$all', 'getElementById', 'querySelector', 'querySelectorAll', 'closest', 'matches', 'addEventListener', 'removeEventListener', 'getAttribute', 'setAttribute', 'hasAttribute', 'removeAttribute', 'createElement', 'createElementNS', 'getItem', 'setItem', 'removeItem', 'srv', 'fetch', 'RegExp', 'require', 'import', 'postMessage', 'dispatchEvent', 'Event', 'CustomEvent', 'NumberFormat', 'DateTimeFormat', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'getContext', 'toDataURL', 'URLSearchParams', 'applyLang', 'go', 'register', 'wirePhotoCapture_', 'rpc', 'from', 'select', 'eq', 'ilike']);
const RE_CLASSLIST = /^[a-z][a-z0-9_-]*(\s+[a-z][a-z0-9_-]*)+$/;

// ---------- segmentation ----------
const TRIM = /^[\s·—|:;,\-–]+|[\s·—|;,\-–]+$/g;
const trimEdges = (s) => s.replace(TRIM, '').trim();

function splitSlashes(chunk) {
  const P = chunk.split(' / ');
  const merged = [];
  for (const part of P) {
    if (merged.length && (!hasWord(merged[merged.length - 1]) || !hasWord(part))) merged[merged.length - 1] += ' / ' + part;
    else merged.push(part);
  }
  return merged;
}


function sentencesOf(text) {
  // [start,end) offsets of sentences; splits after . ! ? … : ; before a capital/placeholder/quote, at ' — ', and at '.X' with no space
  const cuts = [0];
  const re = /(?<=[.!?…])\s+(?=[A-ZÀ-Þ{(“"'‘])|(?<=[a-zß-ÿ\)])[.!?](?=[A-ZÀ-Þ])|\s+—\s+|(?<=[?!])\s+(?=[a-z])/g;
  let m;
  while ((m = re.exec(text))) {
    const isNoSpace = !/\s/.test(m[0]);
    cuts.push(isNoSpace ? m.index + 1 : m.index + m[0].length);
    if (m[0].trim() === '—') cuts.push(m.index);
  }
  cuts.push(text.length);
  const u = [...new Set(cuts)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < u.length; i++) { const s0 = u[i], e0 = u[i + 1]; if (text.slice(s0, e0).trim()) out.push([s0, e0]); }
  return out;
}
export function runsOf(text, L) {
  const sents = sentencesOf(text).map(([s0, e0]) => { const x = text.slice(s0, e0); const c = L.cls(x); return { s0, e0, lang: c.lang, per: c.per || 0, n: c.n }; });
  if (sents.length < 2) return null;
  // neutral / tiny sentences join their neighbour
  for (let i = 0; i < sents.length; i++) if (sents[i].lang === 'neutral') sents[i].lang = (sents[i - 1] && sents[i - 1].lang !== 'neutral') ? sents[i - 1].lang : null;
  for (let i = sents.length - 1; i >= 0; i--) if (!sents[i].lang) sents[i].lang = (sents[i + 1] && sents[i + 1].lang) || null;
  if (sents.some((x) => !x.lang)) return null;
  const runs = [];
  for (const x of sents) { const last = runs[runs.length - 1]; if (last && last.lang === x.lang) last.e0 = x.e0; else runs.push({ lang: x.lang, s0: x.s0, e0: x.e0 }); }
  if (runs.length < 2) return null;
  return runs.map((r) => ({ lang: r.lang, text: text.slice(r.s0, r.e0) }));
}


// ' · ' / ' | ' between parts, except inside brackets; with a single ' / ' the parts that are in the same language as the
// side they touch belong to that side (a list inside a sentence), the others stand alone
function splitChunks(t, L) {
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    if (depth === 0 && (c === '·' || c === '|') && t[i - 1] === ' ' && t[i + 1] === ' ') { parts.push(cur.slice(0, -1)); cur = ''; i++; continue; }
    cur += c;
  }
  parts.push(cur);
  const slashes = parts.map((p) => (p.match(/ \/ /g) || []).length);
  const total = slashes.reduce((a, b) => a + b, 0);
  if (parts.length < 2 || total !== 1) return parts;
  const k = slashes.findIndex((x) => x === 1);
  const [A, B] = parts[k].split(' / ');
  const la = L.cls(A).lang, lb = L.cls(B).lang;
  const out = [];
  let left = A, right = B;
  const before = [], after = [];
  for (let i = 0; i < k; i++) before.push(parts[i]);
  for (let i = k + 1; i < parts.length; i++) after.push(parts[i]);
  // walk outwards from the slash while the neighbour speaks the same language as that side
  let bi = before.length - 1;
  while (bi >= 0 && la !== 'neutral' && L.cls(before[bi]).lang === la) { left = before[bi] + ' · ' + left; bi--; }
  let ai = 0;
  while (ai < after.length && lb !== 'neutral' && L.cls(after[ai]).lang === lb) { right = right + ' · ' + after[ai]; ai++; }
  for (let i = 0; i <= bi; i++) out.push(before[i]);
  out.push(left + ' / ' + right);
  for (let i = ai; i < after.length; i++) out.push(after[i]);
  return out;
}


// a ' / ' between two things of the SAME language ("HR / admin", "cleared / reduced / bad") lists them; it does not pair languages
const LIST_MARK = '\u2215';
function maskListSlashes(t, L) {
  const n = (t.match(/ \/ /g) || []).length;
  if (n < 2) return t;
  const re = / \/ /g;
  const idx = [];
  let m;
  while ((m = re.exec(t))) idx.push(m.index);
  const BOUND = /[.?!:;—·|]/;
  const near = (i, dir) => {
    // up to three words next to the slash, not crossing a sentence mark
    let seg = dir < 0 ? t.slice(0, i) : t.slice(i + 3);
    const cut = dir < 0 ? Math.max(...[...seg.matchAll(/[.?!:;—·|]/g)].map((x) => x.index), -1) : (seg.search(BOUND) < 0 ? seg.length : seg.search(BOUND));
    seg = dir < 0 ? seg.slice(cut + 1) : seg.slice(0, cut);
    const ws = seg.trim().split(/\s+/).filter(Boolean);
    return (dir < 0 ? ws.slice(-3) : ws.slice(0, 3)).join(' ');
  };
  let out = t;
  const adjacent = (i, dir) => { const ws = (dir < 0 ? t.slice(0, i) : t.slice(i + 3)).trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w)); const w = dir < 0 ? ws[ws.length - 1] : ws[0]; return w ? w.replace(/[^A-Za-z\u00C0-\u024F'’-]/g, '') : ''; };
  const decided = idx.map((i) => {
    // the two words that touch the slash decide first: two of one language, or two abbreviations, are a list
    if (/[.?!…]$/.test(t.slice(0, i).trimEnd())) return { i, list: false, diff: 0 };   // a sentence ended before it: it pairs the sentences
    const la = L.cls(adjacent(i, -1)).lang, ra = L.cls(adjacent(i, 1)).lang;
    if (la === 'neutral' && ra === 'neutral') return { i, list: true, diff: 0 };
    if (la !== 'neutral' && ra !== 'neutral') return { i, list: la === ra, diff: 0 };
    const l = near(i, -1), r = near(i, 1);
    const cl = L.cls(l), cr = L.cls(r);
    const diff = (cl.s || 0) - (cr.s || 0);
    const sameLang = cl.lang === cr.lang || Math.abs(diff) < 1.5;
    return { i, list: sameLang, diff };
  });
  // if every slash looks like a list slash but there are exactly two languages overall, keep the strongest as the pair slash
  const pairs = decided.filter((d) => !d.list);
  if (pairs.length === 0) { /* a text with only lists */ }
  const chars = out.split('');
  for (const d of decided) if (d.list) { chars[d.i + 1] = LIST_MARK; }
  return chars.join('');
}

export function segment(t, L) {
  t = t.replace(/\}\/ (?=[A-Za-z])/g, '} / ').replace(/ \/(?=\{)/g, ' / ');
  if (FIX[t]) return FIX[t].map((f) => ({ ...f, flag: 'split by hand', order: 'sw-en' }));
  const original = t;
  t = maskListSlashes(t, L);
  const rows = [];
  const emitSingle = (text, why) => {
    const x = trimEdges(text);
    if (!x || !hasWord(x)) return;
    const c = L.cls(x);
    rows.push({ type: c.lang === 'sw' ? 'sw' : 'en', text: x, why, conf: c.lang === 'neutral' ? 'neutral' : 'ok' });
  };
  const chunks = splitChunks(t, L);
  for (const chunk of chunks) {
    if (FIX[chunk.split(LIST_MARK).join('/')]) { for (const f of FIX[chunk.split(LIST_MARK).join('/')]) rows.push({ ...f, flag: 'split by hand', order: 'sw-en' }); continue; }
    const P = splitSlashes(chunk);
    if (P.length === 1) { if (!viaRuns(chunk)) emitSingle(chunk, 'single'); continue; }
    if (P.length === 2) { pair(P[0], P[1], chunk); continue; }
    multi(P, chunk);
  }
  return rows.map((r) => { for (const k of ['text', 'sw', 'en']) if (typeof r[k] === 'string') r[k] = r[k].split(LIST_MARK).join('/'); return r; });

  function viaRuns(chunk) {
    const runs = runsOf(chunk, L);
    if (!runs) return false;
    let i = 0;
    while (i < runs.length) {
      const a = runs[i], b = runs[i + 1];
      if (b && a.lang !== b.lang) {
        const sw = a.lang === 'sw' ? a : b, en = a.lang === 'sw' ? b : a;
        rows.push({ type: 'pair', sw: trimEdges(sw.text), en: trimEdges(en.text), order: a.lang === 'sw' ? 'sw-en' : 'en-sw', flag: 'two languages in one text (no slash)' });
        i += 2;
      } else { emitSingle(a.text, 'run'); i += 1; }
    }
    return true;
  }
  function pair(left, right, chunk) {
    left = left.trim(); right = right.trim();
    const cl = L.cls(left), cr = L.cls(right);
    // a slash list of one language ("Excel / CSV", "PAID / OVERPAID"), not a pair
    const bothEn = cl.lang === 'en' && cr.lang === 'en', bothSw = cl.lang === 'sw' && cr.lang === 'sw';
    // two file formats, two abbreviations ("Excel / CSV", "GMO / MANAGER") list things; they do not pair two languages
    const TECH = /^(excel|csv|jpg|jpeg|pdf|png|xlsx|xls|whatsapp|sms|email|e-mail|app|apk|web|html|json|sql|url|tsv|momo)$/i;
    const techSide = (x) => { const w = noPh(x).match(/[A-Za-z0-9#%.]+/g) || []; return w.length > 0 && w.every((t) => TECH.test(t) || /^[A-Z0-9#%.]{2,}$/.test(t)); };
    const bothTech = techSide(left) && techSide(right);
    const bothNeutralShort = cl.lang === 'neutral' && cr.lang === 'neutral' && noPh(left).split(/\s+/).length <= 2 && noPh(right).split(/\s+/).length <= 2 && !identicalish(left, right);
    if (bothEn || bothSw || bothNeutralShort || bothTech) { if (chunk && viaRuns(chunk)) return; emitSingle(left + ' / ' + right, 'slash list'); return; }
    let order = 'sw-en', flag = '';
    const d = cl.s - cr.s;
    if (d <= -0.8) order = 'en-sw'; else if (d < 0.8) flag = 'order assumed';
    let a = left, b = right;
    // peel an unmatched " — " prefix (on the left) or suffix (on the right)
    const dl = a.split(' — '), dr = b.split(' — ');
    if (dl.length > 1 && dr.length === 1) {
      const pre = dl.slice(0, -1).join(' — '), core = dl[dl.length - 1];
      const lp = L.cls(pre).lang, lc = L.cls(core).lang;
      if (!hasWord(pre) || lp !== lc) { emitSingle(pre, 'peeled prefix'); a = core; }
    } else if (dr.length > 1 && dl.length === 1) {
      const core = dr[0], suf = dr.slice(1).join(' — ');
      const ls = L.cls(suf).lang, lc = L.cls(core).lang;
      if (!hasWord(suf) || ls !== lc) { emitSingle(suf, 'peeled suffix'); b = core; }
    }
    a = trimEdges(a); b = trimEdges(b);
    if (!a || !b) { emitSingle(left + ' / ' + right, 'one side empty'); return; }
    rows.push(order === 'sw-en' ? { type: 'pair', sw: a, en: b, order, flag } : { type: 'pair', sw: b, en: a, order, flag });
  }
  function multi(P, chunk) {
    // order from the outer parts
    const first = L.cls(P[0]), last = L.cls(P[P.length - 1]);
    const swFirst = first.s - last.s >= 0;
    const sides = []; // sequence of language-tagged pieces
    const pieces = [P[0]];
    let ok = true;
    for (let i = 1; i < P.length - 1; i++) {
      const cut = bestCut(P[i], swFirst);
      if (!cut) { ok = false; break; }
      pieces.push(cut[0], cut[1]);
    }
    pieces.push(P[P.length - 1]);
    if (!ok || pieces.length % 2) { if (viaRuns(chunk)) return; rows.push({ type: 'complex', text: trimEdges(chunk), why: 'several pairs in one text' }); return; }
    for (let i = 0; i < pieces.length; i += 2) {
      const l = pieces[i], r = pieces[i + 1];
      if (!hasWord(l) || !hasWord(r)) { rows.push({ type: 'complex', text: trimEdges(chunk), why: 'empty side' }); return; }
      rows.push(swFirst ? { type: 'pair', sw: trimEdges(l), en: trimEdges(r), order: 'sw-en', flag: 'split from a longer text' } : { type: 'pair', sw: trimEdges(r), en: trimEdges(l), order: 'en-sw', flag: 'split from a longer text' });
    }
  }
  function bestCut(part, swFirst) {
    // part = [tail of pair i | head of pair i+1]; with sw-first the tail is English and the head Swahili
    const cands = [];
    const re = /(?:[.!?;:,] | — | - |\) |: )/g;
    let m;
    while ((m = re.exec(part))) cands.push(m.index + m[0].length - (m[0].endsWith(' ') ? 1 : 0));
    // also before an opening parenthesis / capital letter after a space
    const re2 = / (?=[A-ZÀ-Þ{(])/g;
    while ((m = re2.exec(part))) cands.push(m.index + 1);
    let best = null;
    for (const c of cands) {
      const l = part.slice(0, c).trim(), r = part.slice(c).trim();
      if (!hasWord(l) || !hasWord(r)) continue;
      const sl = L.cls(l).s, sr = L.cls(r).s;
      const v = swFirst ? (-sl + sr) : (sl - sr);
      if (!best || v > best.v) best = { v, l, r };
    }
    if (!best || best.v < 1.5) return null;
    return [best.l, best.r];
  }
}
const identicalish = (a, b) => a.replace(/\W+/g, '').toLowerCase() === b.replace(/\W+/g, '').toLowerCase();
