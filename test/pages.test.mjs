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

/* =====================================================================================
   AND TWO RULES OF THE PAGE, RUN RATHER THAN GREPPED FOR.
   =====================================================================================
   Parsing is the cheapest possible guard and it says nothing about behaviour. These two rules
   are worth more than a regex because both are easy to break silently:

     the red line on a count column  -- "those below average in grand total row marked red".
                                       On a percentage column the total row IS the line; on a
                                       column of COUNTS it cannot be, because every team is
                                       below the sum of all teams and the whole table would go
                                       red. The line has to be the average team.
     a board's sortable headers      -- "column headers sortable". The main list has sorted on
                                       its headers since the beginning and the chipped boards
                                       never did.

   The functions are pure -- no DOM, no network -- so they are lifted out of the page and run
   as themselves, against the same stubs the page gives them. */
function liftFromApp(names) {
  const src = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const grab = re => {
    const m = src.match(re);
    assert.ok(m, 'app.html no longer contains ' + re + ' -- the extractor needs updating');
    return m[0];
  };
  const code = [
    'var BOARDS = {}; var S = { targets:{}, cols:[], rows:[] };',
    'function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){'
      + ' return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]; }); }',
    'function isNum(c){ return c.kind==="num"||c.kind==="money"||c.kind==="pct"||c.kind==="dur"; }',
    'function cellHtml(r,c){ var v = c.get?c.get(r):r[c.key]; return esc(v==null?"":v); }',
    'var NAME_KEYS = {}; var AVG_KEYS = ["avgPct"];',
    'function targetOf_(){ return null; }',
    grab(/function colourCtx_\(cols, tot, rows\)\{[\s\S]*?\n\}/),
    grab(/function pctClass_\(r, c, ctx\)\{[\s\S]*?\n\}/),
    grab(/function cellCls_\(r, c, ctx\)\{[\s\S]*?\n\}/),
    grab(/function tableSimple\(rows, cols, totalRow, boardId\)\{[\s\S]*?\n\}/),
    'return {' + names.map(n => n + ': ' + n).join(', ') + ', BOARDS: BOARDS };',
  ].join('\n');
  return new Function(code)();
}

test('a count column goes red below the AVERAGE TEAM, never below the grand total', () => {
  const M = liftFromApp(['colourCtx_', 'cellCls_']);
  // 6, 3 and 0 applications: the average team brought in three.
  const rows = [{ team: 'BUSY', total: 6 }, { team: 'MIDDLE', total: 3 }, { team: 'QUIET', total: 0 }];
  const cols = [{ key: 'team', label: 'Team' },
    { key: 'total', label: 'Total', kind: 'num', meanFloor: true }];
  const ctx = M.colourCtx_(cols, { team: '', total: 9 }, rows);
  assert.equal(ctx.floors.total, 3, 'the line is the mean across the rows, not the 9 in the total row');
  assert.equal(M.cellCls_(rows[0], cols[1], ctx), '', 'above the average team: not red');
  assert.equal(M.cellCls_(rows[1], cols[1], ctx), '', 'exactly on the line: "below" is strict');
  assert.equal(M.cellCls_(rows[2], cols[1], ctx), 'bad', 'below it: red');
});

test('a chipped board draws sortable headers, and the total row is never painted red', () => {
  const M = liftFromApp(['tableSimple']);
  const rows = [{ team: 'BUSY', total: 6 }, { team: 'QUIET', total: 0 }];
  const cols = [{ key: 'team', label: 'Team' },
    { key: 'total', label: 'Total', kind: 'num', meanFloor: true }];
  M.BOARDS.b1 = { rows, cols, sort: 'total', asc: false };
  const html = M.tableSimple(rows, cols, { team: '', total: 6 }, 'b1');
  assert.ok(/data-bsort="team"/.test(html) && /data-bsort="total"/.test(html),
    'every column header must be clickable to sort');
  assert.ok(/data-bid="b1"/.test(html), 'and must say which board it belongs to');
  assert.ok(/>Total ↓</.test(html), 'the sorted column shows its direction');
  // Without a board id nothing is sortable -- boards that never opted in are unchanged.
  assert.equal(/data-bsort/.test(M.tableSimple(rows, cols, null)), false);
  /* THE TOTAL ROW IS NOT A TEAM. Painting it against its own average would put a red figure
     under a column and mean nothing at all. */
  const totrow = html.slice(html.indexOf('totrow'));
  assert.equal(/ bad/.test(totrow), false, 'the JUMLA row carries no red');
});
