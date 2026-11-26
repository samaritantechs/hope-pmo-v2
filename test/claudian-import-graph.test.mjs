/* THE TWO PATHS THAT NEVER GO DOWN KNOW NOTHING OF THE HELPER (CLAUDE.md section 1; handbook Part 169, finding F13 of the second reader).

     "Throughout our development even if we handle anything or run on limits: UPLOADING and CALL APP should NEVER GO DOWN neither SLOW DOWN"

   The helper (Claudian-PMO: api/claudian.js and api/_lib/claudian*.js) is its own function. The guards that held this were a search for the WORD "claudian" in four files
   (api/upload.js, api/call.js, call-core.js, snapshots.js) and a check that portal-core.js has no STATIC import of it: a new import in any other module of the graph was not
   caught. This walks the whole STATIC import graph from the two entry points (every module that loads with them) and fails when a module of the helper is reachable.

   Dynamic import() is not followed: portal-core.js loads the helper by a dynamic import made only when its two functions are CALLED (claudianStatus and claudianSet, asked by the
   portal's screens), and nothing under /api/upload or /api/call calls them; the tests of the helper hold that a static import of it there fails. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The text of a module without its comments (an import named in a comment is not an import). */
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** `import x from 'a'`, `import 'a'`, `export { x } from 'a'`, `export * from 'a'`: the specifier of each STATIC import. `import('a')` (dynamic) has no space after the word and is not matched. */
const STATIC = /(?:^|[\n;])\s*(?:import|export)\s+(?:[^'"`;]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const resolveFile = (from, spec) => {
  if (!spec.startsWith('.')) return null;                                   // a package, never ours
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, base + '.js', base + '.mjs', path.join(base, 'index.js')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
};
/** Every file reachable from `entry` by static imports, as paths relative to `root`. */
export function staticGraph(entry, root = ROOT) {
  const seen = new Set(), todo = [path.resolve(root, entry)];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    for (const m of src.matchAll(STATIC)) { const r = resolveFile(f, m[1]); if (r) todo.push(r); }
  }
  return [...seen].map(f => path.relative(root, f)).sort();
}

test('THE WALKER FINDS A PLANTED EDGE AND FOLLOWS ONLY STATIC IMPORTS: an import in a far module is found, a dynamic import and a comment are not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-'));
  try {
    const w = (n, s) => { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), s); };
    w('entry.js', "import { a } from './lib/a.js';\nimport './lib/side.js';\nexport * from './lib/re.js';\n");
    w('lib/a.js', "import b from './b';\nconst x = await import('./lazy-claudian.js');\n// import z from './comment-claudian.js'\n/* import y from './block-claudian.js' */\nexport const a = 1;\n");
    w('lib/b.js', "export { far } from './far/claudian-x.js';\n"); w('lib/far/claudian-x.js', 'export const far = 1;\n');
    w('lib/side.js', ''); w('lib/re.js', 'export const re = 1;\n');
    w('lib/lazy-claudian.js', ''); w('lib/comment-claudian.js', ''); w('lib/block-claudian.js', '');
    const g = staticGraph('entry.js', dir);
    assert.ok(g.includes(path.join('lib', 'far', 'claudian-x.js')), 'a static import three modules away is found: ' + g.join(', '));
    assert.ok(g.includes(path.join('lib', 'side.js')) && g.includes(path.join('lib', 're.js')), 'a bare import and an export-from are followed');
    assert.ok(!g.some(f => /lazy-claudian|comment-claudian|block-claudian/.test(f)), 'a dynamic import and a comment are not followed: ' + g.join(', '));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const entry of ['api/upload.js', 'api/call.js']) {
  test('NO MODULE OF THE HELPER IS REACHABLE BY A STATIC IMPORT FROM ' + entry.toUpperCase() + ' (CLAUDE.md section 1)', () => {
    const g = staticGraph(entry);
    assert.ok(g.length > 10 && g.includes(entry) && g.some(f => f.endsWith('supabase.js')), 'the walker really walked the graph of the entry (' + g.length + ' modules)');
    const hit = g.filter(f => /claudian/i.test(f));
    assert.deepEqual(hit, [], entry + ' reaches the helper through a static import: ' + hit.join(', '));
  });
}

test('THE ONLY DOOR TO THE HELPER FROM THE PORTAL IS A DYNAMIC IMPORT, made when its functions are called (so the portal, which /api/upload imports, never loads it at start)', () => {
  const core = stripComments(fs.readFileSync(path.join(ROOT, 'api/_lib/portal-core.js'), 'utf8'));
  assert.ok(!/(?:^|[\n;])\s*(?:import|export)\s+[^'"`;]*?['"][^'"]*claudian[^'"]*['"]/.test(core), 'portal-core.js has no static import of a helper module');
  assert.match(core, /await import\(['"]\.\/claudian[^'"]*['"]\)/, 'and it does load the helper by a dynamic import where the two screens ask for it');
});
