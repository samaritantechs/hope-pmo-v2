// Stage 2: is this atom screen text, and in what form?
import { wordsOf } from './lex.mjs';
import { decodeEntities } from './html.mjs';

const ph = /\u0001(\d+)\u0002/g;

// ---- placeholders -> {1}, {2} by distinct expression, in order of first appearance
export function display(text, phs) {
  const order = new Map();
  let s = text.replace(ph, (m, i) => {
    const src = (phs && phs[+i]) || 'x' + i;
    if (!order.has(src)) order.set(src, order.size + 1);
    return '{' + order.get(src) + '}';
  });
  s = s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}
export const noPh = (s) => s.replace(/\{\d+\}/g, ' ').replace(/\s+/g, ' ').trim();

// ---- contexts
const HARD_CALLEE = new Set(['$', '$all', 'getElementById', 'querySelector', 'querySelectorAll', 'closest', 'matches', 'addEventListener', 'removeEventListener', 'getAttribute', 'setAttribute', 'hasAttribute', 'removeAttribute', 'createElement', 'createElementNS', 'getItem', 'setItem', 'removeItem', 'srv', 'fetch', 'RegExp', 'require', 'import', 'parse', 'Date', 'getContext', 'toDataURL', 'NumberFormat', 'DateTimeFormat', 'postMessage', 'dispatchEvent', 'Event', 'CustomEvent', 'parseInt', 'parseFloat', 'rpc', 'from', 'select', 'eq', 'ilike', 'gte', 'lte', 'single', 'maybeSingle', 'upsert', 'URLSearchParams', 'book_append_sheet', 'aoa_to_sheet', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'applyLang', 'log', 'warn', 'debug', 'trace', 'num', 'cnt', 'avgOf', 'sumOf', 'sumOn', 'pick', 'roleCol', 'tcell', 'settingVal', 'allowed', 'filterForView_', 'exportBoard', 'download', 'tone', 'capture', 'wirePhotoCapture_', 'wireCanvasPad_', 'wireGpsCapture_', 'wireDigitDots_', 'digitDots_', 'backLayerOpen_', 'backLayerClose_', 'go', 'store', 'load', 'getContext', 'sw', 'caches', 'replace', 'indexOf', 'lastIndexOf', 'startsWith', 'endsWith', 'split', 'match', 'test', 'toggle', 'contains', 'remove', 'has', 'append', 'appendChild', 'getComputedStyle', 'matchMedia', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'escapeRegExp', 'btoa', 'atob', 'encodeURIComponent', 'decodeURIComponent', 'importScripts', 'registerRoute', 'unregister', 'getRegistration', 'postMessage', 'dataset', 'set', 'get', 'send', 'open', 'Blob', 'File', 'Image', 'FileReader', 'Worker', 'WebSocket', 'XMLHttpRequest', 'AbortController', 'Intl', 'Promise', 'Symbol', 'Object', 'Array', 'Math']);
const CODE_PROP_TARGET = new Set(['display', 'color', 'background', 'backgroundColor', 'className', 'id', 'type', 'href', 'src', 'cssText', 'fillStyle', 'strokeStyle', 'font', 'width', 'height', 'position', 'overflow', 'cursor', 'transform', 'opacity', 'dataset', 'name', 'rel', 'target', 'method', 'mode', 'role', 'htmlFor', 'inputMode', 'autocomplete', 'accept', 'workspace', 'hadIn', 'had', 'closed', 'pickKey', 'cls', 'foldMain', 'key', 'kind']);
const CODE_KEYS = new Set(['key', 'kind', 'id', 'type', 'valign', 'ev', 'target', 'div', 'color', 'align', 'method', 'Content-Type', 'v', 'tab', 'fn', 'file', 'dir', 'avgKey', 'block', 'ramp', 'legendPos', 'dataLabelPosition', 'style', 'dashType', 'workspace', 'period', 'credit', 'objectName', 'fontFace', 'font_face', 'layout', 'tag', 'ariaRole', 'href', 'src', 'class', 'className', 'cls', 'mode', 'role_', 'icon', 'ic', 'path', 'url', 'endpoint', 'api', 'fnName', 'tabId', 'view', 'viewId', 'sort', 'sortBy', 'order', 'dateKey', 'field', 'column', 'col', 'cols', 'table', 'select', 'where', 'from', 'to_', 'unit', 'format', 'fmt', 'pattern', 'regex', 'selector', 'sel', 'event', 'on', 'name_', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', '&', '<', '>', '"', 'font', 'face', 'fontFace', 'fill', 'stroke', 'shape', 'layout', 'position', 'anchor', 'baseline', 'wrap', 'zone', 'scope', 'gate', 'gates_', 'perm', 'tabs', 'storage', 'store', 'ls', 'cache', 'cacheKey', 'ttl', 'interval', 'delay', 'timeout']);

function lastSeg(s) { return (s || '').replace(/\(.*$/, '').replace(/^.*\./, ''); }

// returns 'ui' | 'code' | 'maybe'
export function contextVerdict(a) {
  if (a.origin === 'xml' || a.origin === 'json') return 'ui';
  if (a.uiCallee) return 'ui';
  if (a.origin === 'html') return a.kind === 'text' || /^attr:(title|placeholder|alt|aria-label|aria-description|aria-placeholder|label)$/.test(a.kind) || (a.kind === 'attr:content' && a.tag === 'meta') || a.kind === 'attr:value' ? 'ui' : 'code';
  if (a.origin === 'js-html') return /^attr:(title|placeholder|alt|aria-label|aria-description|aria-placeholder|label)$/.test(a.kind) || a.kind === 'attr:value' ? 'ui' : a.kind === 'text' ? 'ui' : 'code';
  const c = a.ctx || {};
  if (c.callee) {
    const cal = lastSeg(c.callee);
    const full = c.callee;
    if (/classList\.(add|remove|toggle|contains)$/.test(full) || /\.style\./.test(full) || /^console\./.test(full)) return 'hard';
    if (HARD_CALLEE.has(cal)) return 'hard';
    if (/^(toast|alert|confirm|prompt|Error|esc|drawer|row|line|kv|sec|heading2|box|tile|trendGrid|trendSub|ttl|group|rej|say|sayWhy|ask|renderAsk|renderSignIn|pageTitle|locAsk_|defKpi_|arrow|lk|fold_|card|board|boardPair|content|note|push|kpi|add|bar|addText|String)$/.test(cal)) return 'maybe+';
    return 'maybe';
  }
  if (c.t === 'BinaryExpression' && /^(===|!==|==|!=|<|>|<=|>=|in)$/.test(c.op || '')) return 'code';
  if (c.t === 'SwitchCase') return 'code';
  if (c.t === 'MemberExpression' && c.isObject === false) return 'code';
  if (c.key) {
    if (c.isKey) return 'code';
    if (CODE_KEYS.has(c.key)) return 'code';
    if (/^(label|title|name|sub|note|noteMore|t|text|desc|description|hint|msg|message|placeholder|heading|subtitle|caption|tip|lbl|legendTitle|noneText|listTitle|pill|seen|leads|rec|base|cur|of|leader|nothing|jpgfail|saved|pane|l|day|role|series)$/.test(c.key)) return 'ui+';
    return 'maybe';
  }
  if (c.target && c.op) {
    const tg = lastSeg(c.target);
    if (CODE_PROP_TARGET.has(tg)) return 'code';
    if (/^(textContent|innerText|innerHTML|nodeValue|title|placeholder|foot|HEAD|body|msg|t|s|foldLabel|html|alt|ariaLabel|label|text|value)$/.test(tg)) return 'ui+';
    return 'maybe';
  }
  if (c.t === 'ArrayExpression') {
    if (c.arrCallee) { const cal = lastSeg(c.arrCallee); if (HARD_CALLEE.has(cal) || /^(forEach|map|filter|reduce|concat|indexOf|includes|some|every|find|join|sort)$/.test(cal)) return 'code'; }
    if (c.arrProp && /^(forEach|map|filter|reduce|concat|indexOf|includes|some|every|find|\[\])$/.test(c.arrProp)) return 'code';
    if (c.arrTarget && /^(MGMT_ORDER|ROLE_ORDER_|TEAM_ROLES|HIDDEN_VIEWS|AVG_KEYS|CALLS_KEYS|ORODHA_PCTS|ZONE_PAL|KEY_HEADERS|APPS_CARD_STAGES)$/.test(c.arrTarget)) return 'code';
    if (c.arrKey && /^(from|tAvg|mAvg|blue|green|red|tab|live|future|key|cols|keys|ids|order)$/.test(c.arrKey)) return 'code';
    return 'maybe';
  }
  return 'maybe';
}

// ---- content
const RE_URL = /^(https?:|data:|mailto:|tel:|blob:|about:|file:|javascript:|\/\/)/i;
const RE_PATH = /^[./~]?\/?[\w.-]+(\/[\w.{}-]+)+\/?(\?[\w=&{}%.-]*)?$/;
const RE_MIME = /^[a-z]+\/[a-z0-9.+-]+(;.*)?$/i;
const RE_CSS = /^[\w-]+\s*:\s*[^;]+;?(\s*[\w-]+\s*:\s*[^;]+;?)*$/;
const RE_SQL = /^\s*(select|insert|update|delete|with|create|alter|drop)\b.*\b(from|into|set|table|values|where)\b/i;
const RE_CODE = /(=>|\bfunction\s*\(|&&|\|\||===|!==|;\s*$|\}\s*\)|\)\s*\{|\breturn\b[^.]*;|\b(var|const|let)\s+[\w$]+\s*=|\bif\s*\([^)]*\)\s*[{;])/;
const RE_SEL = /^[#.\[]|\[data-|\]\s*$|^[a-z]+\[|>\s*[a-z.#\[]|:(not|hover|first|last|nth)/;
const RE_IDENT = /^[a-z_$][\w$]*$/;
const RE_CAMEL = /^[a-z]+[A-Z][A-Za-z0-9]*$/;
const RE_SNAKE = /^[a-z0-9]+(_[a-z0-9]+)+$/;
const RE_KEBAB = /^[a-z0-9]+(-[a-z0-9]+)+$/;
const RE_HEX = /^#?[0-9a-f]{3,8}$/i;
const RE_ENV = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/;
const RE_CLASSES = /^[a-z][a-z0-9_-]*(\s+[a-z][a-z0-9_-]*)*$/;

export function codeLike(t) {
  const s = t.trim();
  if (RE_URL.test(s) || RE_MIME.test(s) || RE_SQL.test(s)) return 'url/mime/sql';
  if (RE_PATH.test(s) && !/\s/.test(s)) return 'path';
  if (RE_CODE.test(s) && /[;{}()=]/.test(s)) return 'js code';
  if (RE_CSS.test(s) && /[;]|:\s*(#|\d|none|flex|block|auto|inherit|var\()/.test(s) && !/ \/ /.test(s)) return 'css';
  if (RE_SEL.test(s) && !/ \/ /.test(s) && !/\s{2}/.test(s) && /[#.\[\]>]/.test(s) && !/[a-z]{3,}\s[a-z]{3,}\s[a-z]{3,}/i.test(s)) return 'selector';
  if (RE_HEX.test(s) && !/^[a-f]+$/i.test(s) && /\d/.test(s)) return 'hex/number';
  if (RE_CAMEL.test(s) || RE_SNAKE.test(s) || RE_KEBAB.test(s) || RE_ENV.test(s)) return 'identifier';
  if (/^\s*[{[]/.test(s) && /[}\]]\s*$/.test(s) && /:/.test(s)) return 'json';
  if (/\(\?[:=!<]|\\[dwsbDWSB]|\[\^?[a-z0-9\\-]+\][*+?]|\)\?\s*[|)]/.test(s)) return 'regular expression';
  if (/^[\w.-]+\.(js|css|html|json|png|jpg|svg|xlsx|csv|apk|pdf|sql|md|txt)$/i.test(s)) return 'file name';
  if (/^[\w.{}%-]+(\|[\w.{}%-]*)+$/.test(s) && !/\s/.test(s)) return 'cache key';
  if (/\b\w+\.(eq|neq|ilike|like|gte|lte|gt|lt|in|is|not)\.[\w%{}(),.-]*/.test(s) && !/\s/.test(s)) return 'database filter';
  if (/^[A-Za-z0-9_]+(\s*,\s*[A-Za-z0-9_]+){1,}$/.test(s) && /_|^[a-z]/.test(s) && !/[A-Z][a-z]+ [A-Z]/.test(s)) return 'column list';
  if (/^[A-Za-z0-9$.-]*_[A-Za-z0-9_$.-]*$/.test(s) || /^[A-Za-z0-9_]+\.[a-z]{2,4}$/.test(s)) return 'identifier';
  if (/^(it|no|is|an|ii|iii|iv|vi|vii|viii|ix)\.?$/i.test(s)) return 'glue word';
  if (/^www\./i.test(s)) return 'address';
  if (/(^|\s)--?[a-z][\w-]*(\s|=|$)/.test(s) && /\b(adb|shell|npm|git|curl|node|sudo|chmod)\b/.test(s)) return 'command';
  if (/^[\w.-]+\s+(--?[a-z][\w-]*)(\s|$)/.test(s) && s.split(/\s--?[a-z]/).length > 2) return 'command';
  return null;
}

// tokens with letters, ignoring placeholders
export const xph = (t) => t.replace(/\{\d+\}/g, 'X');
export const tokens = (t) => (noPh(t).match(/[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’.-]*/g) || []);

export function hasWord(t) { return /[A-Za-zÀ-ɏ]{2,}/.test(noPh(t)); }


// signature of a js atom's context (callee#arg, key, assignment target, array owner)
export function sigOf(a) {
  const c = a.ctx;
  if (!c) return 'none';
  if (c.callee) return 'call ' + c.callee.replace(/\(.*$/, '').replace(/^.*\./, '') + '#' + c.argIdx;
  if (c.key) return 'key ' + c.key;
  if (c.target && c.op) return 'asg ' + c.target.replace(/^.*\./, '');
  return c.t;
}
