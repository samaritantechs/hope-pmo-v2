/* Measures the ready-answer matcher (handbook Part 163) on the questions in test/fixtures/claudian-faq-questions.json and says WHICH questions it got wrong, so a key can be
   fixed on the evidence. The test (test/claudian-faq-match.test.mjs) holds the rates; this prints the cases behind them.

     node tools/claudian-faq/eval.mjs                      both halves, every failure
     node tools/claudian-faq/eval.mjs --half even|odd      only the even- or odd-numbered questions of each list (tune on one, keep the other aside)
     node tools/claudian-faq/eval.mjs --quiet              the numbers only
     node tools/claudian-faq/eval.mjs --why "question" [portal|lead|off]   which keys of which entries the question touches, and their weights

   Rules of the road: tune on one half, look at the other only to measure, and put the keys to a FRESH batch of questions written by somebody else before trusting a number. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { FAQ, faqAllowed } = await import('../../api/_lib/claudian-faq.js');
const { faqMatch, FAQ_COMMON } = await import('../../api/_lib/claudian-match.js');
const { wordsOf, keyHit } = await import('../../api/_lib/claudian-cards.js');
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/claudian-faq-questions.json'), 'utf8'));
const args = process.argv.slice(2);
const admin = { source: 'portal', allTabs: true, tabs: [], leader: false }, lead = { source: 'call', leader: true, tabs: [], allTabs: false }, off = { source: 'call', leader: false, tabs: [], allTabs: false };
const subjFor = e => (e.call ? (e.call === 'leader' ? lead : off) : admin);

if (args.includes('--why')) {
  const q = args[args.indexOf('--why') + 1], who = args[args.indexOf('--why') + 2] || 'portal';
  const subj = who === 'lead' ? lead : who === 'off' ? off : admin;
  const tokens = wordsOf(String(q).replace(/%/g, ' percent '));
  const df = new Map(); for (const e of FAQ) for (const k of new Set(e.keys)) df.set(k, (df.get(k) || 0) + 1);
  console.log('words:', tokens.join(' '));
  for (const e of FAQ) {
    if (!faqAllowed(e, subj)) continue;
    const hits = [...new Set(e.keys)].filter(k => keyHit(tokens, k, true)).map(k => k + ':' + (Math.log(1 + FAQ.length / df.get(k)) / Math.log(1 + FAQ.length) * (FAQ_COMMON.has(k) ? 0.5 : 1)).toFixed(2));
    if (hits.length) console.log(e.id.padEnd(18), hits.join('  '));
  }
  console.log(JSON.stringify(faqMatch(subj, q)));
  process.exit(0);
}
const half = args.includes('--half') ? args[args.indexOf('--half') + 1] : 'all';
const keep = i => half === 'all' || (half === 'even' ? i % 2 === 0 : i % 2 === 1);
const quiet = args.includes('--quiet');
const o = { n: 0, right: 0, listed: 0, wrong: 0, none: 0 }, wrong = [], none = [];
for (const [id, v] of Object.entries(FIX.entries)) {
  const e = FAQ.find(x => x.id === id); if (!e) { console.log('NO ENTRY', id); continue; }
  v.direct.forEach((q, i) => {
    if (!keep(i)) return;
    const m = faqMatch(subjFor(e), q); o.n++;
    if (m.best && m.best.id === id) { o.right++; o.listed++; }
    else { const listed = m.near.some(x => x.id === id); if (listed) o.listed++; if (m.best) { o.wrong++; wrong.push([id, q, m.best.id]); } else { o.none++; none.push([id, q, listed ? 'listed' : 'not listed', m.tie ? 'TIE' : '']); } }
  });
}
const pct = (a, b) => (100 * a / b).toFixed(1) + '%';
console.log('DIRECT: n=%d  answered right %s  right or listed %s  answered WRONG %d (%s)  nothing answered %d', o.n, pct(o.right, o.n), pct(o.listed, o.n), o.wrong, pct(o.wrong, o.n), o.none);
let nN = 0, nA = 0; const nl = [];
const negs = [];
for (const [id, v] of Object.entries(FIX.entries)) { const e = FAQ.find(x => x.id === id); v.near.forEach((q, i) => { if (keep(i)) negs.push(['near:' + id, q, subjFor(e)]); }); }
FIX.uncovered.forEach((q, i) => { if (keep(i)) for (const s of [admin, lead, off]) negs.push(['uncovered', q, s]); });
FIX.offtopic.forEach((q, i) => { if (keep(i)) for (const s of [admin, lead, off]) negs.push(['offtopic', q, s]); });
const by = {};
for (const [kind, q, s] of negs) { const k = kind.split(':')[0]; by[k] = by[k] || { n: 0, answered: 0 }; by[k].n++; const m = faqMatch(s, q); if (m.best) { by[k].answered++; nl.push([kind, q, m.best.id]); } }
console.log('about something else, answered:', JSON.stringify(by), '(a "near" question may rightly find a neighbouring ready answer: read them)');
if (!quiet) {
  console.log('\n--- answered with the WRONG ready answer'); for (const [id, q, got] of wrong) console.log(' ', id.padEnd(18), '|', q, '=>', got);
  console.log('\n--- nothing answered'); for (const [id, q, l, t] of none) console.log(' ', id.padEnd(18), '|', q, '=>', l, t);
  console.log('\n--- about something else, but answered'); for (const [kind, q, got] of nl) if (!/^near/.test(kind)) console.log(' ', kind.padEnd(12), '|', q, '=>', got);
}
