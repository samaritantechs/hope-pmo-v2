/* THE PAGES MUST PARSE.
 *
 * This file exists because of one afternoon: a comment was pasted over the closing brace of an
 * `if` block in public/app.html, `npm test` stayed green -- every test here exercises the API,
 * and nothing had ever read the front end -- and the portal went out with a page whose script
 * could not be parsed at all. Not a wrong figure on one tab: NOTHING ran. The sign-in box
 * spun forever, and from the outside that looks exactly like a database that has stopped
 * answering, which is where the search went first while the fault sat in a file that had just
 * been deployed.
 *
 * There is no build step in this system -- public/*.html is served exactly as written -- so
 * nothing between the edit and two hundred people stood in the way. This is that missing step,
 * and it is deliberately the cheapest possible one: every inline <script> in every page is
 * handed to the same parser the browser uses, and a page that will not parse fails the suite.
 *
 * It proves only that the page PARSES. It cannot tell you the screen is right. That is worth
 * saying plainly, because the failure it catches is the one that makes every other test's
 * greenness meaningless.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const PUBLIC = new URL('../public/', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'pages-'));

/** Inline scripts only. A <script src=...> is somebody else's file, and a JSON or template
    block is not JavaScript -- feeding either to the parser would fail for the wrong reason. */
function inlineScripts(html) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (type && !/^(text\/javascript|application\/javascript|module)$/i.test(type)) continue;
    out.push({ code: m[2], module: /^module$/i.test(type || '') });
  }
  return out;
}

const pages = readdirSync(PUBLIC).filter(f => f.endsWith('.html')).sort();
assert.ok(pages.length, 'there are pages to check');

for (const page of pages) {
  test(`public/${page}: every inline script parses`, () => {
    const html = readFileSync(join(PUBLIC, page), 'utf8');
    const blocks = inlineScripts(html);
    assert.ok(blocks.length, `${page} has at least one inline script`);
    blocks.forEach((b, i) => {
      const file = join(scratch, `${page}.${i}.${b.module ? 'mjs' : 'js'}`);
      writeFileSync(file, b.code);
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      } catch (e) {
        const why = String((e.stderr && e.stderr.toString()) || e.message)
          .split('\n').slice(0, 6).join('\n');
        assert.fail(`public/${page} script #${i} will not parse -- the whole page is dead in a `
          + `browser, not just this feature:\n${why}`);
      }
    });
  });
}

/* The service worker is served to every phone and decides what they see when offline. A syntax
   error there does not break the page outright, which is worse: it fails silently and the
   caching everybody depends on quietly stops happening. */
test('public/sw.js parses', () => {
  execFileSync(process.execPath, ['--check', join(PUBLIC, 'sw.js')], { stdio: 'pipe' });
});
