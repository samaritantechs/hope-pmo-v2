import fs from 'node:fs';
import path from 'node:path';
import { scanFile } from './web.mjs';
import { scanJava, scanAndroidXml, scanHintsSql, scanJson, scanHintsTsv } from './others.mjs';

export function listAll(root) {
  const files = [];
  const walk = (d, filt) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!/node_modules|\.git|^build$/.test(e.name)) walk(p, filt); } else if (filt(p)) files.push(p); } };
  walk(path.join(root, 'public'), (f) => /\.(html|js)$/.test(f) && !/pptxgen\.bundle\.js$|tz-regions\.js$/.test(f));
  // left out: the manager names the annual deck keeps, and Claudian-PMO's own reading (its instructions, glossary, screen notes and knowledge cards: text for a model, never shown to a person)
  walk(path.join(root, 'api'), (f) => /\.js$/.test(f) && !/annual-holders-data\.js$|claudian-knowledge\.js$|claudian-cards-data\.js$/.test(f));
  walk(path.join(root, 'android'), (f) => /\.java$|res[\\/]values[\\/]strings\.xml$/.test(f));
  walk(path.join(root, 'db'), (f) => /hint.*\.sql$/i.test(f));
  for (const f of ['server.js', 'app-version.json', 'public/live.webmanifest', 'docs/hints-v2.tsv']) if (fs.existsSync(path.join(root, f))) files.push(path.join(root, f));
  return [...new Set(files)];
}
export function scanAll(root, log = () => {}) {
  const out = [];
  for (const f of listAll(root)) {
    const rel = path.relative(root, f);
    let a;
    if (/\.java$/.test(f)) a = scanJava(f, root);
    else if (/\.xml$/.test(f)) a = scanAndroidXml(f, root);
    else if (/\.sql$/.test(f)) a = scanHintsSql(f, root);
    else if (/\.tsv$/.test(f)) a = scanHintsTsv(f, root);
    else if (/\.(json|webmanifest)$/.test(f)) a = scanJson(f, root);
    else { a = scanFile(f, root); for (const x of a) x.surface = rel.startsWith('api/') || rel === 'server.js' ? 'server' : 'web'; }
    out.push(...a);
    log(rel, a.length);
  }
  return out;
}
