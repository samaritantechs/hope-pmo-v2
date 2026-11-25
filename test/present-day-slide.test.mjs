/* THE "HOPE PMO — DAY" SLIDE OF THE PRESENTATION: TWELVE TILES, FOUR ACROSS AND THREE DOWN (handbook Part 164).

     "Add 6 widgets to hope pmo overall slide at presentation so that they are 4x3 full on our tv (HOPE PMO - DAY slide)" -- the owner, 25 Nov 2026
     "replace initial arreas widget with anything else thats crucial in the presentation hope pmo day slide summary"      -- the owner, 25 Nov 2026 (addendum 1)
     "combine % of sales, and of recovered at their amounts and replace with any other meaningful widgets"                -- the owner, 25 Nov 2026 (addendum 2)

   What is held here (the picture and the geometry at TV sizes are in tools/browser-checks/portal-present-day-slide.mjs, a real browser):
     * the slide builds TWELVE tiles, every one read from the dashboard's own answer (d.cards, d.perf, d.recTrendTotal, d.edrTrendTotal) and only printed here (a percentage in whole
       numbers, a dash where the week has nothing to measure, never a nought): the wall and the dashboard cannot say two different things;
     * the owner changed it twice and left the choices to a chat: Initial arrears is gone and the WEEK'S RECOVERY in shillings is the seventh tile (the weekly recovery trend's own TOTAL,
       added up from its days exactly as the dashboard does when the server did not send the total); the Sales % and the Recovery % are a LINE UNDER Sales this week and Recovered this week
       (the percentage is printed with its amount, not on a tile of its own), and the two tiles that were left are the week's Expected Defaulters recovery (a dash while the database has
       not answered it) and the Performance average of the strip;
     * the line under a figure is part of the figure's own box (so the fit that sizes the figure sizes the line with it), every tile of the slide reserves it when any has it (so a row
       stands level), and a slide with no such line is drawn exactly as it was;
     * the slide declares its grid (`grid: '4x3'`), presDraw gives the tile grid the class the CSS and the fit look for, and a slide that asks for nothing is drawn as before;
     * the CSS is four columns and three rows of one size (minmax(0,1fr): a long figure never widens a column), two columns on a narrow window, clear of the navigation arrows;
     * presFit_ gives the grid the whole height under the heading and ONE value size for every tile, and leaves every other slide's fit exactly as it was;
     * no read is added: the tiles are arithmetic over the answer the slide already stood on. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const PRESENT = read('public/mod/present.js');
const APP = read('public/app.html');

// the slide's own code, run for real with the page's three formatters
const money = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const pct = v => (v == null || v === '' || isNaN(v)) ? '—' : Math.round(Number(v)) + '%';
const pct1 = v => (v == null || v === '' || isNaN(v)) ? '—' : Number(v).toFixed(1) + '%';
const slideOf = (c, perf, weekday = 'WED', extra = {}) => {
  const from = PRESENT.indexOf("var pf = d.perf || {};");
  const to = PRESENT.indexOf('/* TEAM PERFORMANCE.');
  assert.ok(from > 0 && to > from, 'the day slide\'s code is where it was');
  const slides = [];
  new Function('d', 'c', 'slides', 'money', 'pct', 'pct1', PRESENT.slice(from, to))({ weekday, perf, ...extra }, c, slides, money, pct, pct1);
  assert.equal(slides.length, 1, 'it builds one slide');
  return slides[0];
};
const CARDS = { curArrears: 3412547121, initArrears: 23760795812, recovered: 1234567890, defaulters: 10372, cleared: 4321, salesWeek: 987654321, uncollectedToday: 456789012, abnormal: 37 };
const PERF = { salesPct: 84.4, ecolPct: 91.2, colPct: 96.7, recPct: 118.4, avgPct: 99.8 };
const WEEK = {
  recTrendTotal: { recovered: 94338048, uncollected: 120000000, adjusted: 0, unrecovered: 25661952, pct: 78.6 },
  edrTrendTotal: { initial: 120000000, current: 116400000, recovered: 3600000, pct: 3 },
  edrTrend: [{ weekday: 'MON', uploaded: true, recovered: 1800000 }, { weekday: 'TUE', uploaded: true, recovered: 1800000 }, { weekday: 'WED', uploaded: false, recovered: 0 }] };
const tiles = s => ({ v: Object.fromEntries(s.items.map(i => [i.l, i.v])), s: Object.fromEntries(s.items.map(i => [i.l, i.s || ''])) });
const LABELS = ['Current arrears', 'Recovered', 'Defaulters', 'Sales this week', 'Uncollected today', 'Abnormal', 'Recovered this week', 'Cleared today',
  'Early Collection % (week)', 'Collection % (week)', 'Exp.Def recovery (week)', 'Performance (average)'];

test('the day slide has TWELVE tiles in their places: the first eight as they were (the seventh is the week\'s recovery, not the morning\'s arrears), then the two collection percentages, the Expected Defaulters recovery and the Performance average', () => {
  const s = slideOf(CARDS, PERF, 'WED', WEEK);
  assert.equal(s.id, 'kpi'); assert.equal(s.kind, 'kpi'); assert.equal(s.title, 'HOPE PMO — WED');
  assert.deepEqual(s.items.map(i => i.l), LABELS);
  assert.equal(s.items.length, 12, 'four across and three down is twelve');
  assert.ok(!s.items.some(i => /Initial arrears/.test(i.l)), 'the owner replaced the Initial arrears tile (25 Nov): it is not on the slide');
  assert.ok(!s.items.some(i => /^Sales %|^Recovery %/.test(i.l)), 'Sales % and Recovery % are printed under their amounts (25 Nov): they are not tiles of their own');
});

test('every figure is the dashboard\'s own, and the percentage of an amount is printed UNDER it: sales % under sales, recovery % under the week\'s recovery, the card\'s own percentage under the Expected Defaulters recovery', () => {
  const { v, s } = tiles(slideOf(CARDS, PERF, 'WED', WEEK));
  assert.deepEqual(v, {
    'Current arrears': 'TZS 3,412,547,121', 'Recovered': 'TZS 1,234,567,890', 'Defaulters': '10,372', 'Sales this week': 'TZS 987,654,321', 'Uncollected today': 'TZS 456,789,012', 'Abnormal': '37',
    'Recovered this week': 'TZS 94,338,048', 'Cleared today': '4,321',
    'Early Collection % (week)': '91%', 'Collection % (week)': '97%', 'Exp.Def recovery (week)': 'TZS 3,600,000', 'Performance (average)': '100%' });
  assert.deepEqual(s, {
    'Current arrears': '', 'Recovered': '', 'Defaulters': '', 'Sales this week': '84% of target', 'Uncollected today': '', 'Abnormal': '',
    'Recovered this week': '118% of uncollected', 'Cleared today': '',
    'Early Collection % (week)': '', 'Collection % (week)': '', 'Exp.Def recovery (week)': '3.0% of their arrears', 'Performance (average)': 'sales · collection · recovery' });
});

test('a percentage the week cannot measure is a dash, never a nought; a real nought is a nought; a dash stands alone under an amount (never "— of target"); a dashboard with no strip at all still draws twelve tiles', () => {
  const { v, s } = tiles(slideOf(CARDS, { salesPct: null, ecolPct: null, colPct: 100, recPct: 0, avgPct: null }, 'WED', WEEK));
  assert.equal(v['Early Collection % (week)'], '—'); assert.equal(v['Collection % (week)'], '100%'); assert.equal(v['Performance (average)'], '—');
  assert.equal(s['Sales this week'], '—', 'nothing to measure: a dash alone');
  assert.equal(s['Recovered this week'], '0% of uncollected', 'a real nought is a nought, with its words');
  const bare = tiles(slideOf(CARDS, undefined));
  assert.equal(Object.keys(bare.v).length, 12);
  assert.deepEqual([bare.v['Early Collection % (week)'], bare.v['Collection % (week)'], bare.v['Exp.Def recovery (week)'], bare.v['Performance (average)']], ['—', '—', '—', '—'], 'no strip, no Expected Defaulters answer: four dashes');
  assert.equal(bare.s['Sales this week'], '—'); assert.equal(bare.s['Recovered this week'], '—');
});

test('THE WEEK\'S RECOVERY: the server\'s own total when it sent one, else the days added up exactly as the dashboard adds them, else nought; a damaged day counts nothing and never breaks the slide', () => {
  const tile = (extra) => tiles(slideOf(CARDS, { salesPct: 80, ecolPct: 80, colPct: 80, recPct: 80 }, 'WED', extra)).v['Recovered this week'];
  assert.equal(tile(WEEK), 'TZS 94,338,048', 'the total the server worked out');
  // the total WINS over the days (the dashboard prints the same: the server\'s figure carries the standing, the days are only the fall-back)
  assert.equal(tile({ ...WEEK, recTrend: [{ recovered: 1 }, { recovered: 2 }] }), 'TZS 94,338,048');
  // a real nought from the server is a nought, not a fall-back to the days
  assert.equal(tile({ recTrendTotal: { recovered: 0 }, recTrend: [{ recovered: 5 }] }), 'TZS 0');
  // no total: the days, added the way the dashboard adds them
  assert.equal(tile({ recTrend: [{ recovered: 1000 }, { recovered: 2500 }, { recovered: 0 }] }), 'TZS 3,500');
  // a damaged day (missing, null, text, no recovered) counts nothing
  assert.equal(tile({ recTrend: [{ recovered: 1000 }, null, {}, { recovered: 'x' }, { recovered: null }, undefined, { recovered: 250 }] }), 'TZS 1,250');
  // nothing at all: a nought, as the dashboard\'s own card reads
  assert.equal(tile({}), 'TZS 0');
  assert.equal(tile({ recTrend: [] }), 'TZS 0');
});

test('THE WEEK\'S EXPECTED DEFAULTERS RECOVERY is the dashboard card\'s own TOTAL (not the days added again), a dash while the database has not answered it or no day has its files, and a damaged answer never breaks the slide', () => {
  const tile = (extra) => { const t = tiles(slideOf(CARDS, PERF, 'WED', extra)); return [t.v['Exp.Def recovery (week)'], t.s['Exp.Def recovery (week)']]; };
  assert.deepEqual(tile(WEEK), ['TZS 3,600,000', '3.0% of their arrears']);
  // the server's total, not the sum of the days (the dashboard's own TOTAL tile prints the total)
  assert.deepEqual(tile({ ...WEEK, edrTrendTotal: { recovered: 5000000, pct: 4.2 } }), ['TZS 5,000,000', '4.2% of their arrears']);
  // the database did not answer (the dashboard says so in a note): a dash and no line, never a nought
  assert.deepEqual(tile({ ...WEEK, edrNote: 'Kadi ya Expected Defaulters haijajibiwa' }), ['—', '']);
  // no day of the week has its two files: "not uploaded yet" on the dashboard, a dash here
  assert.deepEqual(tile({ ...WEEK, edrTrend: [{ weekday: 'MON', uploaded: false }, { weekday: 'TUE', uploaded: false }] }), ['—', '']);
  assert.deepEqual(tile({ ...WEEK, edrTrend: [] }), ['—', '']);
  assert.deepEqual(tile({ edrTrendTotal: WEEK.edrTrendTotal }), ['—', ''], 'no days at all');
  assert.deepEqual(tile({ edrTrend: WEEK.edrTrend }), ['—', ''], 'no total at all (an older answer)');
  assert.deepEqual(tile({}), ['—', '']);
  // answered, but the list had no arrears to divide by: the money, and a dash for the percentage
  assert.deepEqual(tile({ ...WEEK, edrTrendTotal: { recovered: 3600000, pct: null } }), ['TZS 3,600,000', '—']);
  // a real nought is a nought, with its decimal
  assert.deepEqual(tile({ ...WEEK, edrTrendTotal: { recovered: 0, pct: 0 } }), ['TZS 0', '0.0% of their arrears']);
  // damaged days (null, undefined, empty) count nothing and never throw; one good day is enough
  assert.deepEqual(tile({ ...WEEK, edrTrend: [null, undefined, {}, { uploaded: true }] }), ['TZS 3,600,000', '3.0% of their arrears']);
  assert.deepEqual(tile({ ...WEEK, edrTrend: [null, undefined, {}] }), ['—', '']);
});

test('THE PERFORMANCE AVERAGE is the strip\'s own (the average of sales %, collection % and recovery %, to a whole number), says what it is the average of, and is a dash when nothing was measured', () => {
  const tile = (perf) => { const t = tiles(slideOf(CARDS, perf, 'WED', WEEK)); return [t.v['Performance (average)'], t.s['Performance (average)']]; };
  assert.deepEqual(tile(PERF), ['100%', 'sales · collection · recovery']);
  assert.deepEqual(tile({ ...PERF, avgPct: 84.4 }), ['84%', 'sales · collection · recovery']);
  assert.deepEqual(tile({ ...PERF, avgPct: 0 }), ['0%', 'sales · collection · recovery'], 'a real nought is a nought');
  assert.deepEqual(tile({ ...PERF, avgPct: null }), ['—', 'sales · collection · recovery'], 'nothing measured: a dash (the line still says what it would be the average of)');
});

test('the tiles come from the answer the slide already has: no read of its own, no call, and nothing of the officer boards (the day slide still plays when they do not load)', () => {
  const from = PRESENT.indexOf("var pf = d.perf || {};"), to = PRESENT.indexOf('/* TEAM PERFORMANCE.');
  const code = PRESENT.slice(from, to).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /\bsrv\(|\bfetch\(|XMLHttpRequest/, 'no request is made to fill a tile');
  assert.ok(!/\bb\./.test(code), 'the officer boards (b) are not read: the slide is built before the check for them');
  // it is pushed BEFORE the boards' note, so the deck keeps it when the boards are missing
  assert.ok(PRESENT.indexOf("id:'kpi'") < PRESENT.indexOf('if (!b){'), 'the day slide is built before the boards\' check');
  // and the server's answer carries exactly the fields the tiles read
  const core = read('api/_lib/portal-core.js');
  assert.ok(!/initArrears/.test(code), 'the replaced tile (Initial arrears) is no longer read by the slide');
  assert.match(core, /recTrend, recTrendTotal, ecolTrend, edrTrend, edrTrendTotal, edrNote/, 'dashboardFull answers the weekly recovery total (and its days, the fall-back) and the Expected Defaulters total, its days and its note');
  const rtt = core.slice(core.indexOf('const recTrendTotal = (() => {'), core.indexOf('const recTrendTotal = (() => {') + 700);
  assert.match(rtt, /return \{ recovered, uncollected, adjusted, unrecovered:/, 'the recovery total carries recovered, the figure the tile prints');
  const ett = core.slice(core.indexOf('const edrTrendTotal = (() => {'), core.indexOf('const edrTrendTotal = (() => {') + 700);
  assert.match(ett, /return \{ initial, current, recovered, pct, dEdr, lwEdr:/, 'the Expected Defaulters total carries recovered and pct, the two figures the tile prints');
  assert.match(core, /return \{ weekday: wd, date: d, initial, current, recovered, customers, undated, uploaded, pct, dEdr, lwEdr:/, 'and each of its days says whether it was uploaded');
  for (const f of ['cleared', 'curArrears', 'recovered', 'defaulters', 'salesWeek', 'uncollectedToday', 'abnormal']) assert.ok(new RegExp('\\b' + f + ': ').test(core.slice(core.indexOf('cards: {\n      curArrears'), core.indexOf('cards: {\n      curArrears') + 2600)), 'dashboardFull answers cards.' + f);
  for (const f of ['salesPct', 'ecolPct', 'colPct', 'recPct', 'avgPct']) assert.ok(core.includes('perf.' + f) || new RegExp('\\b' + f + ': wkNow\\.' + f).test(core), 'dashboardFull answers perf.' + f);
});

test('presDraw gives the tile grid its class only when the slide asks for the 4x3 grid; a tile\'s line under its figure is ESCAPED text inside the figure\'s box; when any tile has one every tile reserves it; a slide with none is drawn exactly as it was', () => {
  const draw = PRESENT.slice(PRESENT.indexOf('function presDraw()'), PRESENT.indexOf('} else if (s.kind === \'progress\''));
  assert.match(draw, /<div class="pkpis' \+ \(s\.grid === '4x3' \? ' p12' : ''\) \+ '">'/);
  assert.match(PRESENT, /kind:'kpi', grid:'4x3'/);
  // the drawing itself, RUN: the snippet that builds the tiles, with the page's escaper
  const a = draw.indexOf('var anySub'), z = draw.indexOf("join('') + '</div>';", a) + "join('') + '</div>';".length;
  assert.ok(a > 0 && z > a, 'the tile drawing is where it was');
  const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const run = s => new Function('s', 'esc', 'var body;\n' + draw.slice(a, z) + '\nreturn body;')(s, esc);
  // some tile has a line: it is a span INSIDE the figure, escaped; the others reserve the line with an invisible one
  const html = run({ grid: '4x3', items: [{ l: 'A', v: '1', s: '84% of target' }, { l: 'B', v: '2' }, { l: 'C<b>', v: '3', s: '<i>x</i>' }] });
  assert.ok(html.startsWith('<div class="pkpis p12">') && html.endsWith('</div>'));
  assert.ok(html.includes('<div class="pkpi"><div class="pl">A</div><div class="pv">1<span class="ps">84% of target</span></div></div>'), 'a tile with a line: the line is inside the figure\'s box');
  assert.ok(html.includes('<div class="pkpi"><div class="pl">B</div><div class="pv">2<span class="ps" aria-hidden="true">&nbsp;</span></div></div>'), 'a tile without one reserves it, so a row stands level');
  assert.ok(html.includes('<div class="pl">C&lt;b&gt;</div>') && html.includes('<span class="ps">&lt;i&gt;x&lt;/i&gt;</span>'), 'label and line are escaped');
  // no tile has a line: exactly the markup it always was (a label and a figure, both escaped), no reserved line
  const plain = run({ items: [{ l: 'A', v: '1' }, { l: 'B<', v: '2&' }] });
  assert.equal(plain, '<div class="pkpis"><div class="pkpi"><div class="pl">A</div><div class="pv">1</div></div><div class="pkpi"><div class="pl">B&lt;</div><div class="pv">2&amp;</div></div></div>');
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
  // the line UNDER a figure (the percentage that belongs to an amount): its own line, a little over half the figure's size WHATEVER size the fit gives the figure (em, not pixels)
  assert.match(APP, /#pres \.pv \.ps\{display:block;font-size:\.56em;/);
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
