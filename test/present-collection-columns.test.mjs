/* THE TWO COLLECTION SLIDES OF THE PRESENTATION: SHORT COUNT COLUMNS, A TOTAL COUNT AND CC% (handbook Part 164, addendum 4).

     "Add Tt Count (total count) column after count 1 column just rename the columns into C1 LEO and TC LEO, for space purposes so that i see right away its
      count 1s among which total in the expected collection of today officers today as that of early col does"
     "having the columns short in both early and today col slides, we can add CC% (Count collection) to see percentage of paid customers (paid among total)"
                                                                                                       -- the owner, 25 Nov 2026

   The server's side (the total count and the paid count on today's row; CC% as ONE definition used by both boards; the early board's CC%) is held by
   test/portal.test.mjs through the real dispatch, and the slides' columns, caption and order by test/pages.test.mjs. This holds what is left: the
   COLUMN WIDTHS the two slides ask for (a fixed table shares its width equally, so thirteen columns and eleven columns need their own shares or the
   column of shillings runs past its cell at a laptop's width), and that nothing money-shaped came along with the counts. The two slides in a real
   browser at five sizes, with the figures, the totals, the captions and the pictures: tools/browser-checks/portal-present-collection-columns.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const PRESENT = read('public/mod/present.js');
const APP = read('public/app.html');
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

/* the widths the CSS gives each column of a slide class: { 1: 3, 2: 19, ... } (column number -> percent of the table) */
function widthsOf(cls) {
  const out = {};
  const re = /([^{}]*?)\{width:([\d.]+)%\}/g;
  let m;
  const body = code(APP);
  while ((m = re.exec(body))) {
    if (!m[1].includes('.' + cls + ' th:nth-child(')) continue;
    for (const part of m[1].split(',')) {
      const n = /\.\w+ th:nth-child\((\d+)\)/.exec(part);
      if (n && part.includes('.' + cls + ' ')) { assert.ok(!(n[1] in out), cls + ' column ' + n[1] + ' is given a width twice'); out[n[1]] = Number(m[2]); }
    }
  }
  return out;
}

test('both collection slides ask for their own column widths (tcls), and presDraw puts the class on the table', () => {
  const view = PRESENT.slice(PRESENT.indexOf('function presSlides'), PRESENT.indexOf('function presApply'));
  const early = view.slice(view.indexOf("id:'early'"), view.indexOf("id:'pmo'"));
  assert.match(code(view), /slides\.push\(\{ id:'early', kind:'table', tcls:'pcolearly',/);
  assert.match(code(view), /slides\.push\(\{ id:'pmo', kind:'table', tcls:'pcolpmo',/);
  assert.ok(early.length > 500);
  const draw = PRESENT.slice(PRESENT.indexOf('function presDraw()'), PRESENT.indexOf('function presSetHtml_'));
  assert.match(draw, /<table class="ptable'\+\(s\.tcls\?\(' '\+s\.tcls\):''\)\+'">/, 'the table takes the slide\'s own class');
});

test('the widths add up to a whole table, one for each column, in the order the columns are drawn: #, PMO, Teams, C1 LEO, TC LEO, CC% LEO, J3..IJ, Uncollected (week), Coll % (week)', () => {
  const w = widthsOf('pcolpmo');
  assert.deepEqual(Object.keys(w).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], 'thirteen columns: the row number and twelve more');
  assert.deepEqual(Object.keys(w).map(k => w[k]), [3, 19, 5.5, 6.5, 6.5, 6.5, 6, 6, 6, 6, 6, 15, 8]);
  assert.equal(Math.round(Object.values(w).reduce((s, x) => s + x, 0) * 100) / 100, 100);
  // the slide really has thirteen columns: the row number and the twelve it declares
  const view = PRESENT.slice(PRESENT.indexOf("id:'pmo'"), PRESENT.indexOf("id:'dayprog'"));
  const cols = code(view).slice(code(view).indexOf('cols:['));
  const declared = (cols.slice(0, cols.indexOf('}] });') > 0 ? cols.indexOf('}] });') : 1500).match(/col\('[A-Za-z0-9]+'|\{key:'[A-Za-z0-9]+'/g) || []);
  assert.equal(declared.length, 12, 'twelve declared columns beside the row number');
});

test('the early slide: #, Officer, Teams, Wamebaki / Left, C1 KESHO, TC KESHO, CC% KESHO, Uncollected (kesho), Coll % (kesho), Uncollected (week), Coll % (week)', () => {
  const w = widthsOf('pcolearly');
  assert.deepEqual(Object.keys(w).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'eleven columns: the row number and ten more');
  assert.deepEqual(Object.keys(w).map(k => w[k]), [3, 17, 6, 9, 7.5, 7.5, 8, 13, 8, 13, 8]);
  assert.equal(Math.round(Object.values(w).reduce((s, x) => s + x, 0) * 100) / 100, 100);
});

test('a header of several words may stand on two lines on these two slides, the name wraps, and no other wall table is touched', () => {
  const css = code(APP);
  assert.match(css, /#pres \.ptable\.pcolpmo th\.r, #pres \.ptable\.pcolearly th\.r\{white-space:normal\}/, 'the right-aligned headers (Coll % (week), Wamebaki / Left) may wrap: the figures under them still never do');
  assert.match(css, /#pres \.ptable\.pcolpmo td:nth-child\(2\), #pres \.ptable\.pcolearly td:nth-child\(2\)\{white-space:normal\}/, 'a long officer name wraps');
  // every rule that gives a column a width on the wall is scoped to one of the slide classes (the shared base rule gives the first column none but auto)
  const wallWidths = [...css.matchAll(/#pres \.ptable([^{}]*)\{width:[\d.]+%\}/g)].map(m => m[1]);
  assert.ok(wallWidths.length > 0 && wallWidths.every(sel => /\.(pname2|pcolpmo|pcolearly|pcolabn)\b/.test(sel)), 'only the slides that ask for widths get them: ' + JSON.stringify(wallWidths.filter(sel => !/\.(pname2|pcolpmo|pcolearly|pcolabn)\b/.test(sel))));
  assert.match(css, /#pres \.ptable th:first-child, #pres \.ptable td:first-child\{width:auto\}/, 'the base rule is as it was');
  assert.match(css, /#pres \.ptable \.r\{text-align:right;white-space:nowrap\}/, 'and so is the figure rule: a figure never wraps');
});

test('the counts came along, no money did: the presentation\'s PMO row names the total count and the paid count (headcounts) and still none of the pay fields', () => {
  const pmo = read('api/_lib/pmo.js');
  const row = pmo.slice(pmo.indexOf('export function pmoPublicRow'));
  const r = code(row);
  assert.match(r, /customers: Number\(r\.customers\) \|\| 0,/);
  assert.match(r, /paidOver: Number\(r\.paidOver\) \|\| 0, ccPct: r\.ccPct == null \? null : r\.ccPct,/);
  for (const f of ['commission', 'weekCommission', 'bonus', 'band', 'tzsJ3', 'weekDays']) assert.ok(!new RegExp('\\b' + f + '\\b').test(r), f + ' is still not on the row the wall gets');
});
