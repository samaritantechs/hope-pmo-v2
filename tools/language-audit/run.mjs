/* THE SYSTEM LANGUAGE AUDIT -- one Excel workbook of every phrase the system shows, in three sheets.

   "Please give me an excel of the full system vocabulary with 3 sheets: 1 of all English only phrases e.g settings; 2 of all multi
    lang - Sw translated Eng phrases e.g best of / Record; 3 if there are Sw only ones. This is because I want to make full system
    language audit ... much of the system Sw language always sound robotic that's why I must have to confirm and submit that to you
    myself before we proceed, I'll bring you back the acceptable Sw version words / phrases. So leave no interface or words
    uncovered please" -- the owner, 25 Nov 2026 (CHAT.md section 2; handbook Part 153).

   What it reads (surfaces.mjs): public/ (every page and module, the deck's code; not the vendored PowerPoint library nor the map's
   outlines), api/ and server.js (the messages the server sends), the Android app (strings.xml and the Java), the tip sheet
   (docs/hints-v2.tsv and the tip migrations in db/), the app's release notes and the web manifest. Nothing is run and nothing is
   read from a database: it is the repository's own text. A string that is code (an id, a selector, a URL, SQL, CSS, a column
   list) is left out; everything that reads as language is in.

   To run it (the parser is a development dependency: `npm ci` brings it):

       node tools/language-audit/run.mjs --out /tmp/audit --xlsx /tmp/audit/HOPE-system-language-audit.xlsx

   and, to check the vocabulary against what real screens show and bring in what the code analysis set aside, first crawl them
   (a real Chromium against the real portalApi over the repository's fake database; about three minutes):

       node tools/language-audit/crawl.mjs /tmp/audit/dom.json
       node tools/language-audit/crawl_pages.mjs /tmp/audit/dom_pages.json
       node tools/language-audit/run.mjs --out /tmp/audit --dom /tmp/audit/dom.json,/tmp/audit/dom_pages.json --xlsx /tmp/audit/book.xlsx

   The workbook is made by make_xlsx.py (python3 with openpyxl). It writes rows.json beside it: the same rows, for the next chat
   that has the owner's acceptable Swahili to put back (the ID of a row is a hash of its text: it does not move when the list grows).

   MY SUGGESTED SWAHILI ("On both sheets give your opinion column of the Sw version so that I don't take long on corrections ...
   it's on the English only that needs opinion", the owner, 25 Nov 2026): data/suggested-swahili-*.json (the newest one) holds a
   suggestion for each English-only row, by the row's ID. The workbook's first sheet carries it (--suggest FILE names another file,
   --no-suggest leaves it out), and the run lists the English-only rows that have none yet in rows-without-suggestion.json: a row
   whose text changed since is a new row. Add the new ones to the data file (same format) and run again. It is an opinion for the
   owner to correct: no screen reads it.

   Costs nothing at run time: a tool, not part of the system; `/api/upload` and `/api/call` do not know it exists. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanAll } from './surfaces.mjs';
import { buildVocabulary } from './vocabulary.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; };
const out = path.resolve(arg('out') || path.join(os.tmpdir(), 'hope-language-audit'));
fs.mkdirSync(out, { recursive: true });

const atoms = scanAll(ROOT);
const parseErrors = atoms.filter((a) => a.origin === 'parse-error');
if (parseErrors.length) { console.error('could not read: ' + parseErrors.map((a) => a.file).join(', ')); process.exit(1); }
let domItems = [];
for (const f of (arg('dom') || '').split(',').filter(Boolean)) domItems = domItems.concat(JSON.parse(fs.readFileSync(f, 'utf8')).items);
const v = buildVocabulary(atoms, { root: ROOT, domItems, log: (m) => console.log(m) });
fs.writeFileSync(path.join(out, 'rows.json'), JSON.stringify({ pairs: v.pairs, en: v.en, sw: v.sw, complex: [] }));
console.log(`${atoms.length} strings read; vocabulary: ${v.en.length} English only, ${v.pairs.length} Swahili + English, ${v.sw.length} Swahili only`);
// my suggested Swahili for the English-only sheet: the newest data/suggested-swahili-*.json, unless --no-suggest
const latestSuggestions = () => {
  const d = path.join(HERE, 'data');
  if (!fs.existsSync(d)) return null;
  const f = fs.readdirSync(d).filter((x) => /^suggested-swahili-.*\.json$/.test(x)).sort().pop();
  return f ? path.join(d, f) : null;
};
const sugFile = process.argv.includes('--no-suggest') ? null : (arg('suggest') ? path.resolve(arg('suggest')) : latestSuggestions());
if (sugFile) {
  const sug = JSON.parse(fs.readFileSync(sugFile, 'utf8')).rows;
  const hid = (t) => 'EN-' + crypto.createHash('sha1').update(t, 'utf8').digest('hex').slice(0, 6);
  const without = v.en.filter((e) => !sug[hid(e.text)]).map((e) => ({ id: hid(e.text), text: e.text }));
  fs.writeFileSync(path.join(out, 'rows-without-suggestion.json'), JSON.stringify(without, null, 1));
  console.log(`suggested Swahili: ${path.basename(sugFile)}; ${without.length} English-only row(s) have none yet` + (without.length ? ' (listed in rows-without-suggestion.json)' : ''));
}
const xlsx = arg('xlsx');
if (xlsx) {
  const r = spawnSync('python3', [path.join(HERE, 'make_xlsx.py'), path.join(out, 'rows.json'), path.resolve(xlsx), ...(sugFile ? ['--suggest', sugFile] : [])], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('make_xlsx.py failed (python3 with openpyxl is needed)'); process.exit(r.status || 1); }
}
