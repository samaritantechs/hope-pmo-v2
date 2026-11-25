/* THE "HOPE PMO — DAY" SLIDE OF THE PRESENTATION: TWELVE TILES, FOUR ACROSS AND THREE DOWN (handbook Part 164).

     "Add 6 widgets to hope pmo overall slide at presentation so that they are 4x3 full on our tv (HOPE PMO - DAY slide)" -- the owner, 25 Nov 2026

   What is held here (the picture and the geometry at TV sizes are in tools/browser-checks/portal-present-day-slide.mjs, a real browser):
     * the slide builds TWELVE tiles: the six it always had in their places, then six more, every one read from the dashboard's own answer (d.cards, d.perf) and only printed here
       (a percentage in whole numbers, a dash where the week has nothing to measure): the wall and the dashboard cannot say two different things;
     * the slide declares its grid (`grid: '4x3'`), presDraw gives the tile grid the class the CSS and the fit look for, and a slide that asks for nothing is drawn as before;
     * the CSS is four columns and three rows of one size (minmax(0,1fr): a long figure never widens a column), two columns on a narrow window, clear of the navigation arrows;
     * presFit_ gives the grid the whole height under the heading and ONE value size for every tile, and leaves every other slide's fit exactly as it was;
     * no read is added: the new tiles are arithmetic over the answer the slide already stood on. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const PRESENT = read('public/mod/present.js');
const APP = read('public/app.html');

// the slide's own code, run for real with the page's two formatters
const money = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = v => (v == null || v === '' || isNaN(v)) ? '—' : Math.round(Number(v)) + '%';
const slideOf = (c, perf, weekday = 'WED') => {
  const from = PRESENT.indexOf("var pf = d.perf || {};");
  const to = PRESENT.indexOf('/* TEAM PERFORMANCE.');
  assert.ok(from > 0 && to > from, 'the day slide\'s code is where it was');
  const slides = [];
  new Function('d', 'c', 'slides', 'money', 'pct', PRESENT.slice(from, to))({ weekday, perf }, c, slides, money, pct);
  assert.equal(slides.length, 1, 'it builds one slide');
  return slides[0];
};
const CARDS = { curArrears: 3412547121, initArrears: 23760795812, recovered: 1234567890, defaulters: 10372, cleared: 4321, salesWeek: 987654321, uncollectedToday: 456789012, abnormal: 37 };

test('the day slide has TWELVE tiles: the six it always had in their places, then the six that joined them', () => {
  const s = slideOf(CARDS, { salesPct: 84.4, ecolPct: 91.2, colPct: 96.7, recPct: 118.4 });
  assert.equal(s.id, 'kpi'); assert.equal(s.kind, 'kpi'); assert.equal(s.title, 'HOPE PMO — WED');
  assert.deepEqual(s.items.map(i => i.l), ['Current arrears', 'Recovered', 'Defaulters', 'Sales this week', 'Uncollected today', 'Abnormal',
    'Initial arrears', 'Cleared today', 'Sales % (week)', 'Early Collection % (week)', 'Collection % (week)', 'Recovery % (week)']);
  assert.equal(s.items.length, 12, 'four across and three down is twelve');
});

test('the six old tiles read what they read before, and the six new ones are the dashboard\'s own figures: the cards\' arrears and customers, the strip\'s four percentages in whole numbers', () => {
  const s = slideOf(CARDS, { salesPct: 84.4, ecolPct: 91.2, colPct: 96.7, recPct: 118.4 });
  const v = Object.fromEntries(s.items.map(i => [i.l, i.v]));
  assert.deepEqual(v, {
    'Current arrears': 'TZS 3,412,547,121', 'Recovered': 'TZS 1,234,567,890', 'Defaulters': '10,372', 'Sales this week': 'TZS 987,654,321', 'Uncollected today': 'TZS 456,789,012', 'Abnormal': '37',
    'Initial arrears': 'TZS 23,760,795,812', 'Cleared today': '4,321',
    'Sales % (week)': '84%', 'Early Collection % (week)': '91%', 'Collection % (week)': '97%', 'Recovery % (week)': '118%' });
});

test('a percentage the week cannot measure is a dash, never a nought; a real nought is a nought; a dashboard with no strip at all still draws twelve tiles', () => {
  const dashes = slideOf(CARDS, { salesPct: null, ecolPct: null, colPct: 100, recPct: 0 });
  const v = Object.fromEntries(dashes.items.map(i => [i.l, i.v]));
  assert.equal(v['Sales % (week)'], '—'); assert.equal(v['Early Collection % (week)'], '—');
  assert.equal(v['Collection % (week)'], '100%'); assert.equal(v['Recovery % (week)'], '0%');
  const bare = slideOf(CARDS, undefined);
  assert.equal(bare.items.length, 12);
  assert.ok(bare.items.slice(8).every(i => i.v === '—'), 'no strip, four dashes');
});

test('the new tiles come from the answer the slide already has: no read of its own, no call, and nothing of the officer boards (the day slide still plays when they do not load)', () => {
  const from = PRESENT.indexOf("var pf = d.perf || {};"), to = PRESENT.indexOf('/* TEAM PERFORMANCE.');
  const code = PRESENT.slice(from, to).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /\bsrv\(|\bfetch\(|XMLHttpRequest/, 'no request is made to fill a tile');
  assert.ok(!/\bb\./.test(code), 'the officer boards (b) are not read: the slide is built before the check for them');
  // it is pushed BEFORE the boards' note, so the deck keeps it when the boards are missing
  assert.ok(PRESENT.indexOf("id:'kpi'") < PRESENT.indexOf('if (!b){'), 'the day slide is built before the boards\' check');
  // and the server's answer carries exactly the fields the tiles read
  const core = read('api/_lib/portal-core.js');
  for (const f of ['initArrears', 'cleared', 'curArrears', 'recovered', 'defaulters', 'salesWeek', 'uncollectedToday', 'abnormal']) assert.ok(new RegExp('\\b' + f + ': ').test(core.slice(core.indexOf('cards: {\n      curArrears'), core.indexOf('cards: {\n      curArrears') + 2600)), 'dashboardFull answers cards.' + f);
  for (const f of ['salesPct', 'ecolPct', 'colPct', 'recPct']) assert.ok(core.includes('perf.' + f) || new RegExp('\\b' + f + ': wkNow\\.' + f).test(core), 'dashboardFull answers perf.' + f);
});

test('presDraw gives the tile grid its class only when the slide asks for the 4x3 grid, and every other kpi slide is drawn as it was', () => {
  const draw = PRESENT.slice(PRESENT.indexOf('function presDraw()'), PRESENT.indexOf('} else if (s.kind === \'progress\''));
  assert.match(draw, /<div class="pkpis' \+ \(s\.grid === '4x3' \? ' p12' : ''\) \+ '">'/);
  assert.match(draw, /<div class="pkpi"><div class="pl">'\+esc\(it\.l\)\+'<\/div><div class="pv">'\+esc\(it\.v\)\+'<\/div><\/div>/, 'a tile is as it was: a label and a figure, both escaped');
  assert.match(PRESENT, /kind:'kpi', grid:'4x3'/);
});

test('the CSS: four equal columns and three equal rows, the figure kept on one line, two columns on a narrow window, and clear of the two navigation arrows', () => {
  const css = APP.slice(APP.indexOf('#pres .pkpis.p12{'), APP.indexOf('#pres .pkpis.p12{') + 1800);
  assert.match(css, /#pres \.pkpis\.p12\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\);grid-template-rows:repeat\(3,minmax\(0,1fr\)\);/);
  assert.match(css, /margin:0 44px\}/, 'the arrows sit 74 pixels in from the edge: the grid starts clear of them');
  assert.match(css, /#pres \.pkpis\.p12 \.pv\{[^}]*white-space:nowrap/, 'a figure is one line (the fit makes it small enough, never two lines)');
  assert.match(css, /@media \(max-width:900px\)\{ #pres \.pkpis\.p12\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);grid-template-rows:none\} \}/);
  assert.match(css, /@media \(max-width:700px\)\{ #pres \.pkpis\.p12\{margin:0 22px\} \}/);
  // the old rule for every other tile grid is untouched
  assert.match(APP, /#pres \.pkpis\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(260px,1fr\)\);gap:16px\}/);
});

test('presFit_ fills the screen with the grid and gives every tile ONE value size, on a screen wider than a phone; anything else is fitted exactly as before', () => {
  const fit = PRESENT.slice(PRESENT.indexOf('function presFit_()'), PRESENT.indexOf('/** ONE UNIT\'S COLUMN'));
  const kg = fit.slice(fit.indexOf("var kg = pres.querySelector('.pkpis.p12');"), fit.indexOf('var h = body.getBoundingClientRect().height;'));
  assert.ok(kg.length > 200, 'the 4x3 branch is there, before the generic zoom');
  assert.match(kg, /window\.innerWidth > 900/);
  assert.match(kg, /kg\.style\.height = Math\.max\(240, Math\.floor\(avail\)\) \+ 'px'/, 'the grid is given the whole height under the heading');
  assert.match(kg, /v\.scrollWidth > v\.clientWidth \+ 1/, 'a figure that runs past its tile is the signal to shrink');
  assert.match(kg, /vals\.forEach\(function\(v\)\{ v\.style\.fontSize = sz \+ 'px'; \}\)/, 'every tile gets the same size');
  assert.match(kg, /return;\s*\}\s*\}/, 'and the branch returns: no zoom on top of it');
  assert.match(kg, /kg\.style\.height = ''; vals\.forEach\(function\(v\)\{ v\.style\.fontSize = ''; \}\)/, 'every draw and every resize starts from the CSS sizes again');
  // the table branch and the generic zoom are still there, in their places
  assert.ok(fit.indexOf("if (tbl) {") < fit.indexOf("var kg = pres.querySelector"), 'tables are fitted first, as they were');
  assert.match(fit, /var r = Math\.max\(0\.5, Math\.floor\(avail \/ h \* 100\) \/ 100\);/);
});
