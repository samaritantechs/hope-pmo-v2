// Stage 1: every atom (a candidate phrase with where it came from), no filtering yet beyond "has a letter".
import fs from 'node:fs';
import path from 'node:path';
import { rawStrings } from './raw.mjs';
import { tokenize, INLINE, decodeEntities, lineIndex } from './html.mjs';

const PH = '\u0001', PE = '\u0002';

// attribute names whose value is shown to a person
const SHOWN_ATTR = new Set(['title', 'placeholder', 'alt', 'aria-label', 'aria-description', 'aria-placeholder', 'label', 'content', 'data-tip', 'data-title', 'data-label', 'data-text', 'data-msg', 'data-confirm', 'data-placeholder', 'data-empty', 'data-hint', 'data-name', 'data-ph', 'data-sub', 'data-note']);
const CODE_ATTR = new Set(['class', 'id', 'style', 'href', 'src', 'type', 'name', 'for', 'action', 'method', 'target', 'rel', 'value', 'colspan', 'rowspan', 'width', 'height', 'min', 'max', 'step', 'maxlength', 'pattern', 'inputmode', 'autocomplete', 'accept', 'capture', 'lang', 'charset', 'viewport', 'http-equiv', 'role', 'tabindex', 'd', 'viewbox', 'fill', 'stroke', 'xmlns', 'points', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'transform', 'data-id', 'data-k', 'data-key', 'data-v', 'data-val', 'data-i', 'data-idx', 'data-t', 'data-type', 'data-tab', 'data-view', 'data-ref', 'data-team', 'data-day', 'data-date', 'data-code', 'data-role', 'data-kind', 'data-sort', 'data-col', 'data-fn', 'data-a', 'data-b', 'data-c']);

function blockRuns(tokens) {
  // text tokens grouped into runs; a block-level tag ends a run
  const runs = [];
  let cur = [];
  const end = () => { if (cur.length) runs.push(cur); cur = []; };
  for (const t of tokens) {
    if (t.type === 'text') cur.push(t);
    else if (t.type === 'tag') { if (!INLINE.has(t.name)) end(); else cur.push({ type: 'inline', name: t.name, close: t.close, pos: t.pos }); }
    else if (t.type === 'partialtag') end();
    else if (t.type === 'comment') { /* transparent */ }
    else end();
  }
  end();
  return runs;
}

function mergeRun(run) {
  // join text atoms across inline tags when it does not glue two words; returns [{text,pos}]
  const out = [];
  let cur = null;
  let gap = false; // an inline tag since the last text
  for (const t of run) {
    if (t.type === 'inline') { gap = true; continue; }
    if (!cur) { cur = { text: t.v, pos: t.pos }; gap = false; continue; }
    if (!gap) { cur.text += t.v; continue; }
    const l = cur.text, r = t.v;
    const glue = /[A-Za-z0-9\u0002)]$/.test(l) && /^[A-Za-z0-9\u0001(]/.test(r); // would glue two words/values
    if (glue) { out.push(cur); cur = { text: t.v, pos: t.pos }; } else { cur.text += t.v; }
    gap = false;
  }
  if (cur) out.push(cur);
  return out;
}

export function htmlAtoms(src, { file, lineOf, baseLine = 0, origin, jsHandler }) {
  const toks = tokenize(src);
  const atoms = [];
  const add = (a) => atoms.push({ file, origin, ...a });
  const mapLine = (pos) => (lineOf ? lineOf(pos) : 1) + baseLine;
  for (const t of toks) {
    if (t.type === 'script') {
      const isJs = !t.attrs.some((a) => a.name === 'type' && a.value && !/javascript|module/i.test(a.value));
      if (isJs && t.v.trim() && jsHandler) jsHandler(t.v, mapLine(t.pos) - 1);
    }
    if (t.type === 'tag' && !t.close || t.type === 'partialtag') {
      for (const a of t.attrs) {
        if (a.value == null) continue;
        if (/^on[a-z]+$/.test(a.name)) { if (jsHandler) jsHandler(a.value, mapLine(a.pos) - 1, true); continue; }
        let shown = SHOWN_ATTR.has(a.name);
        if (a.name === 'content' && t.name === 'meta' && !t.attrs.some((x) => x.name === 'name' && /^(description|application-name|apple-mobile-web-app-title|og:title|og:description)$/i.test(x.value || ''))) shown = false;
        const isBtnValue = a.name === 'value' && t.name === 'input' && t.attrs.some((x) => x.name === 'type' && /^(button|submit|reset)$/i.test(x.value || ''));
        if (shown || isBtnValue) {
          add({ line: mapLine(a.pos), kind: 'attr:' + a.name, tag: t.name, text: decodeEntities(a.value) });
        }
      }
    }
  }
  for (const run of blockRuns(toks)) {
    for (const m of mergeRun(run)) add({ line: mapLine(m.pos), kind: 'text', text: decodeEntities(m.text) });
  }
  return atoms;
}

const looksHtml = (s) => /<\/?[A-Za-z][^>]*>/.test(s) || /<[A-Za-z][A-Za-z0-9-]*[\s>]/.test(s);

export function scanFile(file, root) {
  const rel = path.relative(root, file);
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  const jsRoots = [];
  const handleJs = (code, lineOffset, isHandler) => {
    let recs;
    try { recs = rawStrings(isHandler ? 'function __h(){' + code + '\n}' : code, rel, lineOffset); }
    catch (e) { out.push({ file: rel, line: lineOffset + 1, origin: 'parse-error', text: String(e.message).slice(0, 120), kind: 'parse-error' }); return; }
    for (const r of recs) jsRoots.push(r);
  };
  if (/\.html?$/.test(file)) {
    const lineOf = lineIndex(src);
    out.push(...htmlAtoms(src, { file: rel, lineOf, origin: 'html', jsHandler: handleJs }));
  } else if (/\.js$/.test(file)) {
    handleJs(src, 0, false);
  }
  for (const r of jsRoots) {
    if (looksHtml(r.text)) {
      // html inside a JS string: tokenise, the line stays the string's line
      const atoms = htmlAtoms(r.text, { file: rel, lineOf: null, baseLine: r.line - 1, origin: 'js-html', jsHandler: null });
      for (const a of atoms) out.push({ ...a, line: r.line, fn: r.fn, ctx: r.ctx, phs: r.phs });
      // a root that is HTML but whose plain text parts are the whole point (e.g. "<b>x</b>") is covered by atoms
    } else if (/^\s*[\w:-]+="/.test(r.text) || /\s(title|placeholder|aria-label|alt)="/.test(r.text)) {
      // an attribute list written without its tag (title="..." role="button")
      const atoms = htmlAtoms('<x ' + r.text + '>', { file: rel, lineOf: null, baseLine: r.line - 1, origin: 'js-html', jsHandler: null });
      for (const a of atoms) if (a.kind !== 'text') out.push({ ...a, line: r.line, fn: r.fn, ctx: r.ctx, phs: r.phs });
    } else {
      out.push({ file: rel, line: r.line, origin: 'js', kind: 'js:' + r.kind, text: r.text, fn: r.fn, ctx: r.ctx, phs: r.phs });
    }
  }
  return out;
}
