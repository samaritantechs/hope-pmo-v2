/* THE SYSTEM LANGUAGE AUDIT (tools/language-audit/, handbook Part 153).
 *
 *   "Please give me an excel of the full system vocabulary with 3 sheets: 1 of all English only phrases ...; 2 of all multi lang -
 *    Sw translated Eng phrases e.g best of / Record; 3 if there are Sw only ones ... So leave no interface or words uncovered
 *    please" -- the owner, 25 Nov 2026.
 *
 * The audit is only worth its name while it reads EVERY surface. This file holds that as something that fails: a page, a module or a
 * server file that exists and is not read; a hand-written split (overrides.mjs) that no longer matches any text; a phrase that the
 * owner named as an example that the vocabulary no longer finds. It reads the repository's own text, runs no browser and no
 * database, and takes a few seconds. (The screen crawl that checks the vocabulary against real screens needs a browser and lives
 * beside the tool: crawl.mjs.) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanAll, listAll } from '../tools/language-audit/surfaces.mjs';
import { buildVocabulary } from '../tools/language-audit/vocabulary.mjs';
import { segment } from '../tools/language-audit/vocab.mjs';
import { rawStrings } from '../tools/language-audit/raw.mjs';
import { htmlAtoms } from '../tools/language-audit/web.mjs';
import { FIX } from '../tools/language-audit/overrides.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const atoms = scanAll(ROOT);
const V = buildVocabulary(atoms, { root: ROOT });

const walk = (dir, keep) => {
  const out = [];
  const go = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) go(p); } else if (keep(p)) out.push(path.relative(ROOT, p)); } };
  if (fs.existsSync(dir)) go(dir);
  return out.sort();
};

test('the audit reads every page, module and server file that exists', () => {
  const read = new Set(listAll(ROOT).map((f) => path.relative(ROOT, f)));
  // the only files left out, and why: a vendored library, the map's outlines (data) and the old team-holder table (staff names, data)
  const LEFT_OUT = new Set(['public/deck/pptxgen.bundle.js', 'public/deck/tz-regions.js', 'api/_lib/annual-holders-data.js']);
  const wanted = [...walk(path.join(ROOT, 'public'), (p) => /\.(html|js)$/.test(p)), ...walk(path.join(ROOT, 'api'), (p) => /\.js$/.test(p)), 'server.js'];
  for (const f of wanted) assert.ok(read.has(f) || LEFT_OUT.has(f), f + ' is a surface the audit does not read: add it to listAll (surfaces.mjs), or say here why it is left out');
  for (const f of LEFT_OUT) assert.ok(!read.has(f), f + ' is left out on purpose and the audit reads it');
  for (const f of ['android/app/src/main/res/values/strings.xml', 'docs/hints-v2.tsv', 'app-version.json', 'public/live.webmanifest']) assert.ok(read.has(f), f + ' is read');
  for (const f of walk(path.join(ROOT, 'android'), (p) => /\.java$/.test(p))) assert.ok(read.has(f), f + ' (the Android app) is read');
});

test('every file was read: no parse error, and a page that is mostly markup yields its text', () => {
  assert.deepEqual(atoms.filter((a) => a.origin === 'parse-error').map((a) => a.file + ': ' + a.text), []);
  const per = (f) => atoms.filter((a) => a.file === f).length;
  assert.ok(per('public/app.html') > 3000, 'the portal core page gives thousands of strings');
  assert.ok(per('public/call.html') > 800 && per('public/upload.html') > 500, 'the phone app and the Upload page too');
  assert.ok(atoms.some((a) => a.surface === 'android' && /Updater\.java$/.test(a.file)), 'the Android app is read');
  assert.ok(atoms.some((a) => a.origin === 'sql-hint' && /\.sql$/.test(a.file)), 'the tips in the migrations are read');
  assert.ok(atoms.some((a) => a.origin === 'sql-hint' && /\.tsv$/.test(a.file)), 'and the tip sheet');
});

test('the vocabulary has its three kinds, in the sizes the system has (floors, not counts)', () => {
  assert.ok(V.en.length > 1800, 'English only: ' + V.en.length);
  assert.ok(V.pairs.length > 2200, 'Swahili + English: ' + V.pairs.length);
  assert.ok(V.sw.length > 250, 'Swahili only: ' + V.sw.length);
  assert.ok(V.pairs.filter((p) => p.kinds.includes('Tip')).length > 100, 'the tip sheet gives its pairs');
  for (const e of [...V.en, ...V.sw]) { assert.ok(e.text && e.text.trim(), 'no empty phrase'); assert.ok(!/[\u0001\u0002]/.test(e.text), 'no internal marker in ' + e.text); }
  for (const p of V.pairs) { assert.ok(p.sw && p.en, 'a pair has both sides: ' + JSON.stringify(p).slice(0, 80)); assert.ok(!/[\u0001\u0002∕]/.test(p.sw + p.en), 'no internal marker in a pair'); }
});

test("the owner's own examples are in the vocabulary where he said they would be", () => {
  // "best of / Record": English first, then Swahili
  assert.ok(V.pairs.some((p) => p.en === 'Best of' && p.sw === 'Rekodi'), '"Best of / Rekodi"');
  assert.ok(V.pairs.some((p) => p.sw === 'Ingia' && p.en === 'Sign in'), 'the sign-in button is a pair');
  assert.ok(V.en.some((e) => e.text === 'Settings'), '"Settings" is an English-only phrase');
  assert.ok(V.sw.some((e) => e.files.includes('public/call.html')), 'the phone app has Swahili-only text');
  assert.ok(V.sw.some((e) => /^YAH: NOTISI/.test(e.text)), 'the demand letter is Swahili only');
});

test('text is cut into phrases the way a person reads it', () => {
  const L = V.L;
  const kinds = (t) => segment(t, L).map((s) => s.type).join(',');
  // a slash between the two languages pairs them
  const a = segment('Hifadhi / Save', L);
  assert.deepEqual([a[0].type, a[0].sw, a[0].en], ['pair', 'Hifadhi', 'Save']);
  // a slash between two things of ONE language lists them: it is not a pair
  assert.ok(!segment('cleared / reduced / bad / static', L).some((s) => s.type === 'pair'), 'a list is not a pair');
  assert.ok(!segment('Excel / CSV', L).some((s) => s.type === 'pair'), 'two file formats are not a pair');
  // both languages written one after the other with no slash
  const b = segment('Futa timu hii? Hakuna kurudi nyuma. Delete this team? This cannot be undone.', L);
  assert.equal(b.length, 1, kinds('Futa timu hii? Hakuna kurudi nyuma. Delete this team? This cannot be undone.'));
  assert.deepEqual([b[0].type, b[0].sw.slice(0, 8), b[0].en.slice(0, 8)], ['pair', 'Futa tim', 'Delete t']);
  // a " · " in a Swahili sentence is a list inside it: the sentence is not cut there
  const c = segment('Tuma kwa msimamizi: JINA · WADHIFA · TIMU. / Send to the supervisor: name · role · team.', L);
  assert.equal(c.length, 1);
  assert.ok(c[0].sw.includes('WADHIFA') && c[0].en.includes('role'));
  // a slash that lists things of one language inside a sentence of each side does not break the pair
  const d = segment('Weka timu kwa GMO / MANAGER / BIKE sasa. / Set the team to GMO / MANAGER / BIKE now.', L);
  assert.deepEqual(d.map((x) => x.type), ['pair']);
  assert.ok(d[0].sw.includes('GMO / MANAGER / BIKE') && d[0].en.includes('GMO / MANAGER / BIKE'), 'both lists stay whole');
  const d2 = segment('Orodha ya wateja wa timu yako (cleared / reduced / bad). / The list of your team customers (cleared / reduced / bad).', L);
  assert.deepEqual(d2.map((x) => x.type), ['pair']);
  // two pairs side by side
  assert.equal(segment('{1} wateja / customers · siku / days', L).filter((s) => s.type === 'pair').length, 2);
});

test('markup and strings: the words are read out of both, the code around them is not', () => {
  const atomsOf = (html) => htmlAtoms(html, { file: 'x.html', lineOf: null, baseLine: 0, origin: 'js-html', jsHandler: null });
  const t = atomsOf('<div class="k"><b>Jumla</b>: {x} <button onclick="go(\'dashboard\')" title="Ondoa / Remove">Hifadhi / Save</button></div>');
  assert.deepEqual(t.map((a) => a.text).sort(), ['Hifadhi / Save', 'Jumla: {x} ', 'Ondoa / Remove'].sort());
  const r = rawStrings("function f(n){ return '<td>' + n + ' wateja / customers</td>'; }", 'x.js');
  assert.equal(r.length, 1);
  assert.equal(r[0].text.replace(/\u0001\d+\u0002/g, '{}'), '<td>{} wateja / customers</td>');
  // the code inside a handler is read too (a message passed to toast() in an onclick)
  const handed = [];
  htmlAtoms('<button onclick="toast(\'Imehifadhiwa / Saved\')">Hifadhi</button>', { file: 'x.html', lineOf: null, baseLine: 0, origin: 'html', jsHandler: (code) => handed.push(code) });
  assert.deepEqual(handed, ["toast('Imehifadhiwa / Saved')"]);
  // an id, a selector or a route is never a phrase
  const code = rawStrings("document.getElementById('lgPhCard'); srv('demandNotices'); el.querySelector('#view .sk'); el.className = 'chip ok';", 'x.js');
  assert.equal(code.length, 4);
});

test('a hand-written split still has a text to split', () => {
  const texts = new Set(V.recs.map((r) => r.t));
  const joined = [...texts].join('\u0000');
  for (const key of Object.keys(FIX)) assert.ok(texts.has(key) || joined.includes(key), 'overrides.mjs has a split for a text that no longer exists: ' + key.slice(0, 70));
});

/* ---- THE SUGGESTED SWAHILI (the owner's second request, 25 Nov 2026):
 *   "On both sheets give your opinion column of the Sw version so that I don't take long on corrections brother" ... "Oh it's on the
 *    English only that needs opinion the rest already have"
 * tools/language-audit/data/suggested-swahili-*.json holds an opinion for each English-only row, by the row's ID. It is the owner's to
 * correct and no screen reads it; these tests only keep it from rotting: it belongs to its English, it keeps every value the system
 * fills in, it keeps what should stay, and it covers (all but a few of) the English-only phrases the code holds. */
const SUG_DIR = path.join(ROOT, 'tools/language-audit/data');
const SUG_FILE = fs.readdirSync(SUG_DIR).filter((f) => /^suggested-swahili-.*\.json$/.test(f)).sort().pop();
const SUG = JSON.parse(fs.readFileSync(path.join(SUG_DIR, SUG_FILE), 'utf8')).rows;
const hidOf = (t) => 'EN-' + crypto.createHash('sha1').update(t, 'utf8').digest('hex').slice(0, 6);
const phsOf = (t) => t.match(/\{\d+\}/g) || [];

test('every suggestion belongs to its English: its id is the hash of the text, it says something, its flag is one of the four', () => {
  assert.ok(Object.keys(SUG).length > 2000, 'the suggestions are missing');
  for (const [id, r] of Object.entries(SUG)) {
    assert.equal(id, hidOf(r.en), 'the id of "' + r.en.slice(0, 50) + '" is not the hash of its text (a row was edited by hand, or the English changed)');
    assert.ok(typeof r.sw === 'string' && r.sw.trim(), 'no Swahili for "' + r.en.slice(0, 50) + '"');
    assert.ok(['', 'c', 'k', 'n'].includes(r.flag || ''), 'unknown flag on "' + r.en.slice(0, 50) + '"');
    if (r.flag === 'c' || r.flag === 'n') assert.ok(r.note && r.note.trim(), 'a row flagged ' + r.flag + ' needs its note: ' + r.en.slice(0, 50));
    // "keep as it is" means the English itself: a name, an abbreviation, a file column
    if (r.flag === 'k') assert.equal(r.sw, r.en, 'a row marked keep must be the English itself: ' + r.en.slice(0, 50));
  }
});

test('a suggestion keeps every value the system fills in ({1} {2} ...): dropped only where English builds a plural with it, never invented', () => {
  const bad = [];
  for (const r of Object.values(SUG)) {
    const en = phsOf(r.en), sw = phsOf(r.sw);
    const suffix = (p) => new RegExp('[A-Za-z]' + p.replace(/[{}]/g, '\\$&')).test(r.en); // month{2}, team{3}: the English plural's letter
    const dropped = en.filter((p) => !sw.includes(p) && !suffix(p) && !/dropped/i.test(r.note || ''));
    const invented = sw.filter((p) => !en.includes(p));
    const more = [...new Set(sw)].filter((p) => sw.filter((x) => x === p).length > en.filter((x) => x === p).length);
    if (dropped.length || invented.length || more.length) bad.push(r.en.slice(0, 60) + '  =>  ' + r.sw.slice(0, 60));
  }
  assert.deepEqual(bad, [], 'a suggestion lost or invented a value the system fills in');
});

test('the suggestions cover the English-only phrases the code holds (the owner corrects; he does not start from nothing)', () => {
  const without = V.en.filter((e) => !SUG[hidOf(e.text)]);
  // a few new strings may arrive between two runs; when more than two in a hundred have none, the data is stale
  assert.ok(without.length <= Math.ceil(V.en.length * 0.02), without.length + ' of ' + V.en.length + ' English-only phrases have no suggested Swahili: run `node tools/language-audit/run.mjs --out DIR` (it writes rows-without-suggestion.json), write those suggestions into data/, and run it again. First ones: ' + without.slice(0, 5).map((e) => '"' + e.text.slice(0, 40) + '"').join(', '));
});

test('the runner and the workbook maker carry the suggestions to the first sheet', () => {
  const maker = fs.readFileSync(path.join(ROOT, 'tools/language-audit/make_xlsx.py'), 'utf8');
  const runner = fs.readFileSync(path.join(ROOT, 'tools/language-audit/run.mjs'), 'utf8');
  assert.ok(maker.includes("'--suggest' in sys.argv") && maker.includes("sys.argv.index('--suggest')") && maker.includes("Suggested Swahili (Claude's opinion)") && maker.includes('Please check') && maker.includes('Keep as it is'), 'make_xlsx.py no longer writes the suggestion columns');
  assert.ok(/'--suggest'/.test(runner) && runner.includes('suggested-swahili-') && runner.includes('rows-without-suggestion.json'), 'run.mjs no longer hands the suggestions to the maker');
  // the owner's yellow columns come AFTER mine: "leave the yellow column empty where you agree"
  assert.ok(/"Suggested Swahili \(Claude's opinion\)", "Claude's confidence", "Claude's note", 'Acceptable Swahili \(owner\)', 'Notes \(owner\)'/.test(maker), 'the owner columns must follow the suggestion columns, in this order');
});

test('the maker writes my suggestion beside its English and leaves the owner columns empty (needs python3 with openpyxl: skipped where it is not there)', (t) => {
  if (spawnSync('python3', ['-c', 'import openpyxl'], { encoding: 'utf8' }).status !== 0) return t.skip('python3 with openpyxl is not installed here');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-sug-'));
  const text = 'Save the {1} report';
  const id = hidOf(text);
  fs.writeFileSync(path.join(tmp, 'rows.json'), JSON.stringify({ pairs: [], sw: [], complex: [], en: [{ text, conf: 'en', why: 'single', count: 1, where: ['x.js:1'], areas: ['Portal core'], kinds: ['Screen text'], fulls: [], files: ['x.js'] }] }));
  fs.writeFileSync(path.join(tmp, 'sug.json'), JSON.stringify({ rows: { [id]: { en: text, sw: 'Hifadhi ripoti ya {1}', flag: 'c', note: 'a note' } } }));
  const made = spawnSync('python3', [path.join(ROOT, 'tools/language-audit/make_xlsx.py'), path.join(tmp, 'rows.json'), path.join(tmp, 'o.xlsx'), '--suggest', path.join(tmp, 'sug.json')], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const read = spawnSync('python3', ['-c', 'import json,sys\nfrom openpyxl import load_workbook\nws = load_workbook(sys.argv[1])["1 English only"]\nprint(json.dumps([[c.value for c in row] for row in ws.iter_rows(min_row=2)]))', path.join(tmp, 'o.xlsx')], { encoding: 'utf8' });
  const sheet = JSON.parse(read.stdout);
  assert.deepEqual(sheet[0].slice(0, 7), ['ID', 'English phrase (current)', "Suggested Swahili (Claude's opinion)", "Claude's confidence", "Claude's note", 'Acceptable Swahili (owner)', 'Notes (owner)']);
  assert.deepEqual(sheet[1].slice(0, 7), [id, text, 'Hifadhi ripoti ya {1}', 'Please check', 'a note', null, null]);
  // without --suggest the sheet is the one it always was
  const plain = spawnSync('python3', [path.join(ROOT, 'tools/language-audit/make_xlsx.py'), path.join(tmp, 'rows.json'), path.join(tmp, 'p.xlsx')], { encoding: 'utf8' });
  assert.equal(plain.status, 0, plain.stderr);
});
