/* THE ANDROID XML MUST PARSE.
 *
 * Same lesson as pages.test.mjs, one directory over. The APK build on main (android-apk.yml
 * run #22) failed at processReleaseMainManifest with "Error parsing AndroidManifest.xml":
 * a comment added to the manifest used " -- " as a dash, and XML forbids a double hyphen
 * anywhere inside a comment. Nothing in this sandbox builds an APK, the Java had been
 * syntax-checked with a plain JDK and looked fine, and the merge went out on that basis --
 * the manifest merger runs BEFORE javac, so the Java never even got compiled. The whole
 * update pipeline for three hundred handsets stopped on a hyphen.
 *
 * This is the cheapest possible guard against that: every .xml under android/app/src/main
 * is scanned, and a comment carrying "--" fails the suite. It proves only well-formedness
 * of comments, not that the manifest is right; but it is exactly the failure that got past
 * everything else, and it now cannot.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ANDROID_MAIN = new URL('../android/app/src/main/', import.meta.url).pathname;

function xmlFiles(dir) {
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...xmlFiles(p));
    else if (/\.xml$/i.test(d.name)) out.push(p);
  }
  return out;
}

test('no XML under android/app/src/main carries a double hyphen inside a comment', () => {
  const files = xmlFiles(ANDROID_MAIN);
  assert.ok(files.some(f => /AndroidManifest\.xml$/.test(f)), 'the manifest itself is among the files scanned');
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const re = /<!--([\s\S]*?)-->/g;
    let m;
    while ((m = re.exec(src))) {
      assert.ok(!m[1].includes('--'),
        f.replace(ANDROID_MAIN, '') + ': a comment contains a double hyphen, which XML forbids and '
        + 'the manifest merger fails the whole APK build on. Comment begins: '
        + JSON.stringify(m[1].trim().slice(0, 100)));
    }
  }
});

test('every comment in the manifest is actually closed (an unclosed one swallows the rest of the file)', () => {
  const src = readFileSync(join(ANDROID_MAIN, 'AndroidManifest.xml'), 'utf8');
  const opens = (src.match(/<!--/g) || []).length;
  const closes = (src.match(/-->/g) || []).length;
  assert.equal(opens, closes, opens + ' comment openers vs ' + closes + ' closers');
});
