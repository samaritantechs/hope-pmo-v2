/* The vocabulary: every phrase of every interface, sorted into the three kinds the owner asked for (25 Nov 2026).

     1. English only      ("Settings")
     2. Swahili + English ("Best of / Rekodi": the system writes both, a pair)
     3. Swahili only

   buildVocabulary(atoms, { root, domItems }) takes the atoms (surfaces.mjs: every string of every surface, with where it was
   found), decides which are screen text (vocab.mjs, decide.mjs), cuts them into phrases (a "/" pairs two languages, a sentence in
   each language side by side pairs too, a "/" between two things of one language is a list), classifies the language of what is
   left (lex.mjs, lang.mjs) and gathers the same phrase from every place into one row with where it is used.

   `domItems` (optional) are the words and attributes real screens showed (crawl.mjs, crawl_pages.mjs): they are checked against the
   vocabulary (cover.mjs) and whatever a real screen showed that the code analysis had set aside is brought in. */
import fs from 'node:fs';
import path from 'node:path';
import { decideAll, segment } from './vocab.mjs';
import { analyze } from './cover.mjs';

const MOD_AREA = {
  adjust: 'Iliyonasia / Adjustments tab', admin: 'Settings, Teams & Staff, Roles & access, Hints, Call agents', advance: 'Advance tabs (request, approval, report, HR staff)',
  annual: 'Annual report tab', bonusplan: 'Daily Bonus Plan tab', checklist: 'Daily Checklist tab', deduct: 'PMO Deduction tab', devices: 'Devices (phone lock) tab',
  fraud: 'Fraud Detector tab', imprest: 'Imprest tabs', leave: 'Leave tabs', legal: 'Legal / Demand Notices tab', loan: 'HOPE Loan screens', present: 'Presentation tab',
  reports: 'Report tabs (month report, trend, PAR, audit report, commission, calls, credit, Best of, audit log, locations)',
};

function navLabels(root) {
  const nav = {};
  const src = fs.readFileSync(path.join(root, 'public/app.html'), 'utf8');
  for (const m of src.matchAll(/\{\s*id:'([a-z0-9_]+)'[^}]*?label:'([^']+)'/g)) nav[m[1]] = m[2];
  return nav;
}

function areaOf(a, NAV) {
  const f = a.file;
  if (a.surface === 'tips') return 'Tip (tab: ' + (a.tab || '?') + ')';
  if (f === 'public/app.html') {
    const m = /VIEWS\.([a-z0-9_]+)/.exec(a.fn || '');
    if (m && NAV[m[1]]) return 'Portal · ' + NAV[m[1]];
    return 'Portal core (shared screens, menus, sign-in)';
  }
  const m = /^public\/mod\/([a-z]+)\.js$/.exec(f);
  if (m) return 'Portal · ' + (MOD_AREA[m[1]] || m[1]);
  if (f === 'public/call.html') return 'HOPE Calls (phone app)';
  if (f === 'public/upload.html') return 'Upload page';
  if (f === 'public/mkopo.html') return 'Customer page (mkopo)';
  if (f === 'public/home.html') return 'Home / launcher page';
  if (f === 'public/dashboard.html') return 'Code dashboard page';
  if (f === 'public/live.html') return 'HOPE Live widget';
  if (f === 'public/brand.js') return 'Sign-in screens (brand)';
  if (/^public\/(sw|push-sw)\.js$/.test(f)) return 'Push notifications';
  if (f === 'public/deck/annual-ppt.js') return 'Annual report deck (PowerPoint)';
  if (f.startsWith('public/')) return 'Web (' + f.replace('public/', '') + ')';
  if (f.startsWith('android/')) return 'Android app';
  if (f === 'app-version.json') return 'Android app (update notes)';
  if (f.startsWith('api/') || f === 'server.js') return 'Server messages (' + f.replace(/^api\/(_lib\/)?/, '') + ')';
  return f;
}

function kindOf(a, t) {
  if (a.surface === 'tips') return 'Tip';
  if (a.origin === 'xml') return 'Android text';
  if (a.origin === 'json') return a.kind.replace('json:', '') === 'notes' ? 'Android update notes' : 'App name / description';
  if (a.surface === 'android') return /setTitle|setContentTitle|NotificationChannel/.test((a.ctx && a.ctx.callee) || '') ? 'Android title' : 'Android message';
  if (/\.(jpg|png|csv|xlsx|pdf|json|txt|zip|xls|apk|jpeg)$/i.test(t)) return 'File name (download)';
  if (a.origin === 'html' || a.origin === 'js-html') {
    if (/^attr:/.test(a.kind)) { const n = a.kind.slice(5); return { title: 'Tooltip', placeholder: 'Input hint', alt: 'Image text', 'aria-label': 'Accessibility label', label: 'Label', value: 'Button', content: 'Page description' }[n] || 'Attribute'; }
    return 'Screen text';
  }
  const c = a.ctx || {};
  const cal = c.callee ? c.callee.replace(/\(.*$/, '').replace(/^.*\./, '') : '';
  if (cal === 'col' && c.argIdx === 1) return 'Table column header';
  if (cal === 'kpi') return c.argIdx === 0 ? 'Card label' : c.argIdx === 2 ? 'Card note' : 'Card text';
  if (/^(toast|say|sayWhy)$/.test(cal)) return 'Message (toast)';
  if (/^(alert|confirm|prompt)$/.test(cal)) return 'Question / alert';
  if (cal === 'Error') return 'Error message';
  if (/^(badRequest|forbidden|notFound|unauthorized|fail|bad|reject)$/.test(cal)) return 'Server message';
  if (/^(drawer|row|line|kv|sec|heading2|ttl|group|box|tile)$/.test(cal)) return 'Screen text';
  if (/^(board|boardPair|card|note|content|trendGrid)$/.test(cal)) return 'Board / card text';
  if (c.key && /^(label|lbl|title|name|t|text|sub|note|heading|subtitle|desc|hint|message|msg)$/.test(c.key)) return c.key === 'label' ? 'Label' : c.key === 'title' ? 'Title' : 'Screen text';
  if (c.target) { const tg = c.target.replace(/^.*\./, ''); if (/textContent|innerText|nodeValue/.test(tg)) return 'Screen text'; if (/title/.test(tg)) return 'Tooltip'; if (/placeholder/.test(tg)) return 'Input hint'; }
  if (a.surface === 'server') return 'Server message';
  return 'Text';
}

// the rows the first pass gives, as far as the screens' coverage check needs them
function provisional(recs, L) {
  const pairs = [], en = [], sw = [];
  for (const r of recs) {
    if (r.a.origin === 'sql-hint') { pairs.push({ sw: r.a.sw, en: r.a.en }); continue; }
    if (!r.include) continue;
    for (const s of segment(r.t, L)) {
      if (s.type === 'pair') pairs.push({ sw: s.sw, en: s.en });
      else if (s.type === 'en') en.push({ text: s.text });
      else if (s.type === 'sw') sw.push({ text: s.text });
    }
  }
  return { pairs, en, sw };
}

export function buildVocabulary(atoms, { root, domItems, log = () => {} } = {}) {
  const NAV = navLabels(root);
  let { recs, L } = decideAll(atoms);
  let coverage = null;
  if (domItems && domItems.length) {
    const a = analyze(domItems, provisional(recs, L), recs.map((r) => ({ t: r.t, include: r.include })));
    const seen = new Set();
    for (const g of a.gaps) { seen.add(g.t); for (const w of g.words) seen.add(w); }
    log('screens: ' + a.distinct + ' distinct strings, ' + a.covered + ' found in the vocabulary, ' + a.gaps.length + ' not: looking for them in the code');
    ({ recs, L } = decideAll(atoms, seen));
    const b = analyze(domItems, provisional(recs, L), recs.map((r) => ({ t: r.t, include: r.include })));
    coverage = { distinct: b.distinct, covered: b.covered, notFound: b.gaps.length };
    log('after bringing them in: ' + b.covered + ' of ' + b.distinct + ' strings the screens showed are in the vocabulary; the ' + b.gaps.length + ' left are names and values the system fills in, and sentences it joins together as it runs');
  }
  const occ = (a) => `${a.file}:${a.line}`;
  const maps = { pairs: new Map(), en: new Map(), sw: new Map() };
  function put(map, key, init, a, kind, full) {
    let e = map.get(key);
    if (!e) { e = { ...init, count: 0, where: [], areas: new Set(), kinds: new Set(), fulls: new Set(), files: new Set() }; map.set(key, e); }
    e.count++;
    if (e.where.length < 6 && !e.where.includes(occ(a))) e.where.push(occ(a));
    e.areas.add(areaOf(a, NAV)); e.kinds.add(kind); e.files.add(a.file);
    if (full) e.fulls.add(full);
    return e;
  }
  for (const r of recs) {
    const a = r.a;
    if (a.origin === 'sql-hint') {
      if (!a.en && !a.sw) continue;
      put(maps.pairs, (a.sw || '') + '\u0000' + (a.en || ''), { sw: a.sw, en: a.en, order: 'columns (sw_message / message)', flag: '' }, a, 'Tip');
      continue;
    }
    if (!r.include) continue;
    const kind = kindOf(a, r.t);
    for (const s of segment(r.t, L)) {
      if (s.type === 'pair') put(maps.pairs, s.sw + '\u0000' + s.en, { sw: s.sw, en: s.en, order: s.order, flag: s.flag || '' }, a, kind, s.flag === 'split from a longer text' ? r.t : '');
      else if (s.type === 'en') put(maps.en, s.text, { text: s.text, conf: s.conf, why: s.why }, a, kind, s.why !== 'single' ? r.t : '');
      else if (s.type === 'sw') put(maps.sw, s.text, { text: s.text, conf: s.conf, why: s.why }, a, kind, s.why !== 'single' ? r.t : '');
    }
  }
  const ser = (m) => [...m.values()].map((e) => ({ ...e, areas: [...e.areas], kinds: [...e.kinds], fulls: [...e.fulls].slice(0, 3), files: [...e.files] }));
  return { L, coverage, pairs: ser(maps.pairs), en: ser(maps.en), sw: ser(maps.sw), recs: recs.map((r) => ({ t: r.t, include: r.include, reason: r.reason, file: r.a.file, line: r.a.line })) };
}
