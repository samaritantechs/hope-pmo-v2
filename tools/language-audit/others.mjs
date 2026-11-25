// Surfaces that are not JS / HTML: Java (Android), Android XML, SQL tip seeds, JSON.
import fs from 'node:fs';
import path from 'node:path';
import { htmlAtoms } from './web.mjs';
import { decodeEntities } from './html.mjs';
import { PH, PE } from './raw.mjs';

const looksHtml = (s) => /<\/?[A-Za-z][^>]*>/.test(s);

function javaUnescape(s) {
  return s.replace(/\\(u+[0-9a-fA-F]{4}|n|t|r|"|'|\\|b|f|0)/g, (m, e) => {
    if (e[0] === 'u') return String.fromCharCode(parseInt(e.slice(-4), 16));
    return { n: '\n', t: '\t', r: '\r', '"': '"', "'": "'", '\\': '\\', b: '\b', f: '\f', 0: '\0' }[e] ?? m;
  });
}

// returns [{line, text, phs, callee, argIdx}]
export function javaStrings(src) {
  const out = [];
  let i = 0, line = 1;
  const n = src.length;
  const stack = []; // open calls: {name, arg}
  const toks = [];
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; for (let k = i; k < end; k++) if (src[k] === '\n') line++; i = end; continue; }
    if (c === '"') {
      if (src.startsWith('"""', i)) { const e = src.indexOf('"""', i + 3); const end = e < 0 ? n : e + 3; for (let k = i; k < end; k++) if (src[k] === '\n') line++; i = end; continue; }
      let j = i + 1;
      while (j < n && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
      toks.push({ t: 'str', v: javaUnescape(src.slice(i + 1, j)), line });
      i = j + 1; continue;
    }
    if (c === "'") { let j = i + 1; while (j < n && src[j] !== "'") { if (src[j] === '\\') j++; j++; } i = j + 1; toks.push({ t: 'chr', line }); continue; }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < n && /[\w$]/.test(src[j])) j++; toks.push({ t: 'id', v: src.slice(i, j), line }); i = j; continue; }
    if (/\d/.test(c)) { let j = i; while (j < n && /[\w.]/.test(src[j])) j++; toks.push({ t: 'num', v: src.slice(i, j), line }); i = j; continue; }
    toks.push({ t: 'p', v: c, line }); i++;
  }
  // walk tokens, tracking calls
  const callStack = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'p' && t.v === '(') { const prev = toks[k - 1]; callStack.push({ name: prev && prev.t === 'id' ? prev.v : '', arg: 0 }); continue; }
    if (t.t === 'p' && t.v === ')') { callStack.pop(); continue; }
    if (t.t === 'p' && t.v === ',' && callStack.length) { callStack[callStack.length - 1].arg++; continue; }
    if (t.t !== 'str') continue;
    // a concatenation chain: str (+ (str | expr))*
    let text = t.v; const phs = []; const startLine = t.line;
    let m = k;
    while (toks[m + 1] && toks[m + 1].t === 'p' && toks[m + 1].v === '+') {
      let q = m + 2;
      if (toks[q] && toks[q].t === 'str') { text += toks[q].v; m = q; continue; }
      // an expression until the next top-level '+', ',', ')', ';'
      let depth = 0, e = q;
      while (toks[e]) {
        const x = toks[e];
        if (x.t === 'p' && (x.v === '(' || x.v === '[' || x.v === '{')) depth++;
        else if (x.t === 'p' && (x.v === ')' || x.v === ']' || x.v === '}')) { if (depth === 0) break; depth--; }
        else if (depth === 0 && x.t === 'p' && (x.v === '+' || x.v === ',' || x.v === ';' || x.v === '?' || x.v === ':')) break;
        e++;
      }
      phs.push(toks.slice(q, e).map((y) => y.v || '').join('').slice(0, 40) || 'x');
      text += PH + (phs.length - 1) + PE;
      m = e - 1;
    }
    const top = callStack[callStack.length - 1];
    out.push({ line: startLine, text, phs, callee: top ? top.name : '', argIdx: top ? top.arg : -1 });
    k = m;
  }
  return out;
}

export function scanJava(file, root) {
  const rel = path.relative(root, file);
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const UI_CALLEE = new Set(['setTitle', 'setMessage', 'setText', 'setContentTitle', 'setContentText', 'setDescription', 'makeText', 'setPositiveButton', 'setNegativeButton', 'setNeutralButton', 'NotificationChannel', 'setSubText', 'setTicker', 'setBigText']);
  for (const s of javaStrings(src)) {
    const ctx = { t: 'java', callee: s.callee, argIdx: s.argIdx, uiCallee: UI_CALLEE.has(s.callee) };
    if (looksHtml(s.text)) {
      for (const a of htmlAtoms(s.text, { file: rel, lineOf: null, baseLine: s.line - 1, origin: 'js-html', jsHandler: null })) out.push({ ...a, line: s.line, ctx, phs: s.phs, surface: 'android' });
    } else out.push({ file: rel, line: s.line, origin: 'js', kind: 'java', text: s.text, phs: s.phs, ctx: { callee: s.callee, argIdx: s.argIdx, t: 'CallExpression' }, surface: 'android', uiCallee: ctx.uiCallee });
  }
  return out;
}

export function scanAndroidXml(file, root) {
  const rel = path.relative(root, file);
  const src = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const out = [];
  const re = /<(string|item)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    const nameM = /name="([^"]*)"/.exec(m[2]);
    const text = decodeEntities(m[3]).replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\@/g, '@').trim();
    out.push({ file: rel, line, origin: 'xml', kind: 'android string', text, phs: [], ctx: { t: 'xml', key: nameM ? nameM[1] : '' }, surface: 'android' });
  }
  return out;
}

// ---- SQL tip seeds: insert into hints (tab, message, sw_message) values (...) / select ...
function sqlLiterals(s) {
  const lits = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "'") {
      let j = i + 1, v = '';
      while (j < s.length) { if (s[j] === "'") { if (s[j + 1] === "'") { v += "'"; j += 2; continue; } break; } v += s[j]; j++; }
      lits.push({ v, pos: i }); i = j + 1;
    } else if (s[i] === '-' && s[i + 1] === '-') { while (i < s.length && s[i] !== '\n') i++; }
    else i++;
  }
  return lits;
}
export function scanHintsSql(file, root) {
  const rel = path.relative(root, file);
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /insert\s+into\s+(?:public\.)?hints\s*\(([^)]*)\)/gi;
  let m;
  while ((m = re.exec(src))) {
    const cols = m[1].split(',').map((x) => x.trim().toLowerCase());
    // statement body up to the ending ';' outside quotes, cut at WHERE (outside quotes)
    let i = re.lastIndex, inq = false, end = src.length;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "'") inq = !inq;
      else if (!inq && ch === ';') { end = i; break; }
    }
    let body = src.slice(re.lastIndex, end);
    // cut at a top-level where
    { let q = false, cut = body.length; for (let k = 0; k < body.length; k++) { if (body[k] === "'") q = !q; else if (!q && /^where\b/i.test(body.slice(k, k + 6)) && /\W/.test(body[k - 1] || ' ')) { cut = k; break; } } body = body.slice(0, cut); }
    const lits = sqlLiterals(body);
    const per = cols.length;
    const line0 = src.slice(0, re.lastIndex).split('\n').length;
    for (let k = 0; k + per <= lits.length; k += per) {
      const row = {};
      cols.forEach((c, x) => { row[c] = lits[k + x].v; });
      const line = line0 + body.slice(0, lits[k].pos).split('\n').length - 1;
      out.push({ file: rel, line, origin: 'sql-hint', kind: 'tip', tab: row.tab, en: row.message, sw: row.sw_message, surface: 'tips' });
    }
  }
  return out;
}

export function scanJson(file, root) {
  const rel = path.relative(root, file);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  const want = ['notes', 'name', 'short_name', 'description', 'title'];
  const walk = (o, key) => {
    if (typeof o === 'string') { if (want.includes(key)) out.push({ file: rel, line: 1, origin: 'json', kind: 'json:' + key, text: o, phs: [], ctx: { t: 'json', key }, surface: 'misc' }); return; }
    if (Array.isArray(o)) o.forEach((x) => walk(x, key));
    else if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], k);
  };
  walk(j, '');
  return out;
}

// docs/hints-v2.tsv: the tip sheet the Upload page loads into the hints table (TAB, MESSAGE, SW-MESSAGE)
export function scanHintsTsv(file, root) {
  const rel = path.relative(root, file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const out = [];
  const head = (lines[0] || '').split('\t').map((x) => x.trim().toLowerCase());
  const iT = head.indexOf('tab'), iE = head.indexOf('message'), iS = head.findIndex((x) => /sw/.test(x));
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c = lines[i].split('\t');
    out.push({ file: rel, line: i + 1, origin: 'sql-hint', kind: 'tip', tab: c[iT], en: c[iE], sw: c[iS], surface: 'tips' });
  }
  return out;
}
