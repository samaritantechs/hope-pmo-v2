// Lenient HTML tokenizer (files and fragments inside JS strings).
export const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
export const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'del', 'em', 'font', 'i', 'ins', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var']);

const isNameStart = (c) => /[A-Za-z]/.test(c || '');

export function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  let textStart = 0;
  function flushText(end) {
    if (end > textStart) toks.push({ type: 'text', v: src.slice(textStart, end), pos: textStart });
  }
  while (i < n) {
    const c = src[i];
    if (c !== '<') { i++; continue; }
    // comment
    if (src.startsWith('<!--', i)) {
      flushText(i);
      const e = src.indexOf('-->', i + 4);
      const end = e < 0 ? n : e + 3;
      toks.push({ type: 'comment', pos: i });
      i = end; textStart = i; continue;
    }
    if (src[i + 1] === '!' || src[i + 1] === '?') { // doctype / PI
      flushText(i);
      const e = src.indexOf('>', i);
      i = e < 0 ? n : e + 1; textStart = i; continue;
    }
    const closing = src[i + 1] === '/';
    const nameAt = i + (closing ? 2 : 1);
    if (!isNameStart(src[nameAt])) { i++; continue; } // a bare '<' is text
    // read tag name
    let j = nameAt;
    while (j < n && /[A-Za-z0-9:_-]/.test(src[j])) j++;
    const name = src.slice(nameAt, j).toLowerCase();
    const tagStart = i;
    if (closing) {
      const e = src.indexOf('>', j);
      if (e < 0) { flushText(tagStart); i = n; textStart = n; break; }
      flushText(tagStart);
      toks.push({ type: 'tag', name, close: true, attrs: [], pos: tagStart });
      i = e + 1; textStart = i; continue;
    }
    // attributes
    const attrs = [];
    let self = false, ended = false;
    while (j < n) {
      while (j < n && /\s/.test(src[j])) j++;
      if (j >= n) break;
      if (src[j] === '>') { j++; ended = true; break; }
      if (src[j] === '/' && src[j + 1] === '>') { self = true; j += 2; ended = true; break; }
      if (src[j] === '/') { j++; continue; }
      // attribute name
      const as = j;
      while (j < n && !/[\s=>]/.test(src[j]) && !(src[j] === '/' && src[j + 1] === '>')) j++;
      const an = src.slice(as, j).toLowerCase();
      let val = null, vpos = as;
      let k = j;
      while (k < n && /\s/.test(src[k])) k++;
      if (src[k] === '=') {
        k++;
        while (k < n && /\s/.test(src[k])) k++;
        vpos = k;
        if (src[k] === '"' || src[k] === "'") {
          const q = src[k];
          const e = src.indexOf(q, k + 1);
          if (e < 0) { val = src.slice(k + 1); j = n; vpos = k + 1; ended = false; attrs.push({ name: an, value: val, pos: vpos, open: true }); break; }
          val = src.slice(k + 1, e); vpos = k + 1; j = e + 1;
        } else {
          const vs = k;
          while (k < n && !/[\s>]/.test(src[k])) k++;
          val = src.slice(vs, k); j = k;
        }
      }
      if (an) attrs.push({ name: an, value: val, pos: vpos });
    }
    if (!ended) { // unterminated tag (a fragment cut across statements): drop it, keep what it opened
      flushText(tagStart);
      toks.push({ type: 'partialtag', name, attrs, pos: tagStart });
      i = n; textStart = n; break;
    }
    flushText(tagStart);
    if ((name === 'script' || name === 'style') && !self) {
      const re = new RegExp('</' + name + '\\b', 'i');
      const m = re.exec(src.slice(j));
      const cs = j;
      const ce = m ? j + m.index : n;
      toks.push({ type: name, v: src.slice(cs, ce), attrs, pos: cs, tagPos: tagStart });
      const e2 = src.indexOf('>', ce);
      i = e2 < 0 ? n : e2 + 1; textStart = i; continue;
    }
    toks.push({ type: 'tag', name, close: false, self: self || VOID.has(name), attrs, pos: tagStart });
    i = j; textStart = i;
  }
  flushText(n);
  return toks;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', mdash: '—', ndash: '–', rarr: '→', larr: '←', hellip: '…', bull: '•', times: '×', check: '✓', copy: '©', reg: '®', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', uarr: '↑', darr: '↓', harr: '↔', plusmn: '±', deg: '°', euro: '€', pound: '£', trade: '™' };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
  });
}

// line number of an offset
export function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (off) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}
