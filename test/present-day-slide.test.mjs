/* THE "HOPE PMO — DAY" SLIDE OF THE PRESENTATION: TWELVE TILES, FOUR ACROSS AND THREE DOWN (handbook Part 164).

     "Add 6 widgets to hope pmo overall slide at presentation so that they are 4x3 full on our tv (HOPE PMO - DAY slide)" -- the owner, 25 Nov 2026
     "replace initial arreas widget with anything else thats crucial in the presentation hope pmo day slide summary"      -- the owner, 25 Nov 2026 (addendum 1)
     "combine % of sales, and of recovered at their amounts and replace with any other meaningful widgets"                -- the owner, 25 Nov 2026 (addendum 2)
     "also cleared today to defaulters, add another meaningful widget" · "col% and uncollected today also in a single widget. add another meaningful one"   -- the owner, 25 Nov 2026 (addendum 3)
     "combine recovered today and this week, add another meaningful widget" · "show collection today% at uncollected today" · "ealry col% and col% week on their own widget"   -- the owner, 25 Nov 2026 (addendum 5)
     "legal recovery widget on presentation, have their phone recovery in the same widget"                                                        -- the owner, 25 Nov 2026 (addendum 5)
     "Performance card is not showing if today's or weekly at presentation" · "Recovered this week should go with uncol week" · "Going with uncol today on the same widget
      on the presentation slide doesn't make sense. Better kill the loan app request widget and differentiate today from weekly recovery vs uncollected"  -- the owner, 25 Nov 2026 (addendum 8)

   What is held here (the picture and the geometry at TV sizes are in tools/browser-checks/portal-present-day-slide.mjs, a real browser):
     * the slide builds TWELVE tiles, every one read from the dashboard's own answer (d.cards, d.perf, d.recTrendTotal, d.edrTrendTotal) and only printed here (a percentage in whole
       numbers, a dash where the week has nothing to measure, never a nought): the wall and the dashboard cannot say two different things;
     * the owner changed it twice and left the choices to a chat: Initial arrears is gone and the WEEK'S RECOVERY in shillings is the seventh tile (the weekly recovery trend's own TOTAL,
       added up from its days exactly as the dashboard does when the server did not send the total); the Sales % and the Recovery % are a LINE UNDER Sales this week and Recovered this week
       (the percentage is printed with its amount, not on a tile of its own), and the two tiles that were left are the week's Expected Defaulters recovery (a dash while the database has
       not answered it) and the Performance average of the strip; then Cleared today is a line under Defaulters ("4,321 cleared today") and the strip's Collection % a line under
       Uncollected today ("97% collected this week"), and the two tiles left free are the week's Loan applications (the strip's own count and the amount asked) and the week's Legal
       recovery (the dashboard's Legal card figure, notices and calls together: a dash while either side cannot be read);
     * then Recovered (today's) and Recovered this week are ONE tile (the week's figure, its percentage, and today's amount: two lines under the figure), the freed tile is SALES TODAY (the
       Sales trend card's own tile for today), Uncollected today carries TODAY'S collection % (the Weekly expected trend card's tile for today), the week's Collection % stands beside
       the Early collection % on a tile of their own, and the Legal recovery tile says how much of its figure came BY PHONE (a second line: the calls side of the grand total);
     * then (addendum 8) the Loan applications widget is GONE; Performance says it is the WEEK's ("Performance (week avg)"); Recovered this week carries the WEEK's uncollected under it and
       nothing of today's; TODAY has a Recovered tile of its own (the dashboard's Recovered card over the Uncollected today card, "not uploaded yet" where no deck was filed today, "no
       collection sheet today" where there is no uncollected to divide by); and the tiles stand in the order the story is told in: the book and the sales, today's uncollected and
       recovery, the week's recovery, the Abnormal count, then the week's measures;
     * the line (or lines) under a figure is part of the figure's own box (so the fit that sizes the figure sizes them with it), every tile of the slide reserves as many as the most-lined
       tile has (so a row stands level), and a slide with no such line is drawn exactly as it was;
     * the slide declares its grid (`grid: '4x3'`), presDraw gives the tile grid the class the CSS and the fit look for, and a slide that asks for nothing is drawn as before;
     * the CSS is four columns and three rows of one size (minmax(0,1fr): a long figure never widens a column), two columns on a narrow window, clear of the navigation arrows;
     * presFit_ gives the grid the whole height under the heading and ONE value size for every tile (shrunk until no figure runs past its tile's width AND no tile's content runs past its
       height), and leaves every other slide's fit exactly as it was;
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
/* THE DAY SLIDE'S CODE ENDS WHERE THE ABNORMAL CARD'S PER-TEAM SLIDE BEGINS (addendum 6): that block is the next slide's, and it has its own test file
   (test/present-abnormal-deductions.test.mjs). The Abnormal tile's line is made ABOVE the slide (presDedLine_, in presSlides' head) and handed in, as the page does. */
const DAY_END = "/* THE ABNORMAL CARD'S PER-TEAM VIEW";
const slideOf = (c, perf, weekday = 'WED', extra = {}, dedLine = '') => {
  const from = PRESENT.indexOf("var pf = d.perf || {};");
  const to = PRESENT.indexOf(DAY_END);
  assert.ok(from > 0 && to > from, 'the day slide\'s code is where it was');
  const slides = [];
  new Function('d', 'c', 'slides', 'money', 'pct', 'pct1', 'dedLine', PRESENT.slice(from, to))({ weekday, perf, ...extra }, c, slides, money, pct, pct1, dedLine);
  assert.equal(slides.length, 1, 'it builds one slide');
  return slides[0];
};
const CARDS = { curArrears: 3412547121, initArrears: 23760795812, recovered: 123456789, defaulters: 10372, cleared: 4321, salesWeek: 987654321, uncollectedToday: 456789012, abnormal: 37 };
const PERF = { salesPct: 84.4, ecolPct: 91.2, colPct: 96.7, recPct: 78.6, avgPct: 99.8, appsCount: 486, appsAmount: 1234000000 };   // the strip still answers the applications (the dashboard draws them); the slide does not read them
// the dashboard's two per-day cards, with TODAY (Wednesday 25 Nov) among their days: today's collection % and today's sales are read off them
const DAYS = {
  asOfDate: '2026-11-25',
  colTrend: [{ weekday: 'MON', date: '2026-11-23', expected: 9000000, collected: 8289000, uncollected: 711000, uploaded: true, pct: 92.1 },
    { weekday: 'TUE', date: '2026-11-24', expected: 9500000, collected: 8550000, uncollected: 950000, uploaded: true, pct: 90 },
    { weekday: 'WED', date: '2026-11-25', expected: 10000000, collected: 8660000, uncollected: 1340000, uploaded: true, pct: 86.6 }],
  salesTrend: [{ weekday: 'MON', date: '2026-11-23', amount: 1000, loans: 1, pct: 5 }, { weekday: 'TUE', date: '2026-11-24', amount: 3000000, loans: 3, pct: 60 },
    { weekday: 'WED', date: '2026-11-25', amount: 4200000, loans: 5, pct: 84.4 }],
};
const WEEK = {
  ...DAYS,
  recTrendTotal: { recovered: 94338048, uncollected: 120000000, adjusted: 0, unrecovered: 25661952, pct: 78.6 },
  edrTrendTotal: { initial: 120000000, current: 116400000, recovered: 3600000, pct: 3 },
  edrTrend: [{ weekday: 'MON', uploaded: true, recovered: 1800000 }, { weekday: 'TUE', uploaded: true, recovered: 1800000 }, { weekday: 'WED', uploaded: false, recovered: 0 }],
  legal: { grand: { on: true, nOn: true, pOn: true, rows: [], total: { nOwed: 40000000, nRec: 30000000, nPct: 75, cOwed: 12000000, cRec: 11000000, cPct: 91.7, owed: 52000000, recovered: 41000000, pct: 78.8, tRecovered: 2000000 } } } };
const tiles = s => ({ v: Object.fromEntries(s.items.map(i => [i.l, i.v])), s: Object.fromEntries(s.items.map(i => [i.l, i.s || ''])) });
const LABELS = ['Current arrears', 'Defaulters', 'Sales this week', 'Sales today', 'Uncollected today', 'Recovered today', 'Recovered this week', 'Abnormal',
  'Early col · Col % (week)', 'Legal recovery (week)', 'Exp.Def recovery (week)', 'Performance (week avg)'];

test('the day slide has TWELVE tiles in their places: the book and the sales, then what was left to collect today, what came back today and what came back this week, the Abnormal count, and last the week\'s measures; the Loan applications widget is gone', () => {
  const s = slideOf(CARDS, PERF, 'WED', WEEK);
  assert.equal(s.id, 'kpi'); assert.equal(s.kind, 'kpi'); assert.equal(s.title, 'HOPE PMO — WED');
  assert.deepEqual(s.items.map(i => i.l), LABELS);
  assert.equal(s.items.length, 12, 'four across and three down is twelve');
  assert.ok(!s.items.some(i => /loan app/i.test(i.l)), 'the owner killed the Loan applications widget (25 Nov, addendum 8)');
  assert.ok(!s.items.some(i => /Initial arrears/.test(i.l)), 'the owner replaced the Initial arrears tile (25 Nov): it is not on the slide');
  assert.ok(!s.items.some(i => /^Sales %|^Recovery %|^Cleared today|^Collection %/.test(i.l)), 'Sales %, Recovery %, Cleared today and Collection % are printed under their amounts and Defaulters (25 Nov): they are not tiles of their own');
  assert.ok(!s.items.some(i => i.l === 'Recovered' || /^Early Collection %/.test(i.l)), 'no tile is called plain "Recovered" (each says today or this week), and the Early Collection % is on a tile with the Collection %');
  assert.deepEqual(s.items.filter(i => /Recovered/.test(i.l)).map(i => i.l), ['Recovered today', 'Recovered this week'], 'two Recovered tiles, one for each period (addendum 8: "differentiate today from weekly"), never one tile with both');
  assert.deepEqual(s.items.filter(i => /Performance/.test(i.l)).map(i => i.l), ['Performance (week avg)'], 'the Performance tile says it is the week\'s (addendum 8)');
  // the order is the story: today's uncollected, today's recovery, the week's recovery side by side in the middle row; the last row is all weekly
  assert.deepEqual(s.items.slice(4, 7).map(i => i.l), ['Uncollected today', 'Recovered today', 'Recovered this week']);
  assert.ok(s.items.slice(8).every(i => /\(week/.test(i.l)), 'the whole last row is the week\'s measures, and every label says so');
});

test('every figure is the dashboard\'s own, and what belongs to an amount is printed UNDER it: sales % under sales, TODAY\'S collection % under the day\'s uncollected, cleared customers under the defaulters, each period\'s recovery with its own uncollected and its own percentage, a percentage under each of the Expected Defaulters and Legal figures', () => {
  const { v, s } = tiles(slideOf(CARDS, PERF, 'WED', WEEK));
  assert.deepEqual(v, {
    'Current arrears': 'TZS 3,412,547,121', 'Defaulters': '10,372', 'Sales this week': 'TZS 987,654,321', 'Sales today': 'TZS 4,200,000', 'Uncollected today': 'TZS 456,789,012',
    'Recovered today': 'TZS 123,456,789', 'Recovered this week': 'TZS 94,338,048', 'Abnormal': '37',
    'Early col · Col % (week)': '91% · 97%', 'Legal recovery (week)': 'TZS 41,000,000', 'Exp.Def recovery (week)': 'TZS 3,600,000', 'Performance (week avg)': '100%' });
  assert.deepEqual(s, {
    'Current arrears': '', 'Defaulters': '4,321 cleared today', 'Sales this week': '84% of target', 'Sales today': '5 loans · 84% of target',
    'Uncollected today': '87% collected today', 'Recovered today': ['of TZS 456,789,012 uncollected', '27% recovered'],
    'Recovered this week': ['of TZS 120,000,000 uncollected', '79% recovered'], 'Abnormal': '',
    'Early col · Col % (week)': '', 'Legal recovery (week)': ['79% of owed', 'by phone TZS 11,000,000'], 'Exp.Def recovery (week)': '3.0% of their arrears', 'Performance (week avg)': 'sales · collection · recovery' });
});

test('a percentage the week cannot measure is a dash, never a nought; a real nought is a nought; a dash stands alone under an amount (never "— of target"); a dashboard with no strip at all still draws twelve tiles', () => {
  const { v, s } = tiles(slideOf(CARDS, { salesPct: null, ecolPct: null, colPct: 100, recPct: 0, avgPct: null }, 'WED', WEEK));
  assert.equal(v['Early col · Col % (week)'], '— · 100%', 'the early collection cannot be measured (a dash) while the week\'s collection reads its real 100%'); assert.equal(v['Performance (week avg)'], '—');
  assert.equal(s['Sales this week'], '—', 'nothing to measure: a dash alone');
  assert.deepEqual(s['Recovered this week'], ['of TZS 120,000,000 uncollected', '0% recovered'], 'a real nought is a nought, with its words; the week\'s uncollected is still there');
  const bare = tiles(slideOf(CARDS, undefined));
  assert.equal(Object.keys(bare.v).length, 12);
  assert.deepEqual([bare.v['Early col · Col % (week)'], bare.v['Legal recovery (week)'], bare.v['Exp.Def recovery (week)'], bare.v['Performance (week avg)'], bare.v['Sales today']], ['— · —', '—', '—', '—', '—'], 'no strip, no Expected Defaulters answer, no Legal card, no day cards: five dashes');
  assert.equal(bare.s['Sales this week'], '—'); assert.equal(bare.s['Uncollected today'], '—');
  assert.equal(bare.s['Recovered this week'], 'no collection sheet yet', 'no sheet in the answer: no uncollected to show, and the tile says so (never "of TZS 0 uncollected")');
  assert.equal(bare.s['Recovered today'], 'no collection sheet today'); assert.equal(bare.v['Recovered today'], 'TZS 123,456,789', 'the card\'s own recovery is still there');
  assert.equal(bare.s['Legal recovery (week)'], ''); assert.equal(bare.s['Sales today'], '');
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

test('THE PERFORMANCE AVERAGE is the strip\'s own (the average of the WEEK\'S sales %, collection % and recovery %, to a whole number), says it is the week\'s and what it is the average of, and is a dash when nothing was measured', () => {
  const tile = (perf) => { const t = tiles(slideOf(CARDS, perf, 'WED', WEEK)); return [t.v['Performance (week avg)'], t.s['Performance (week avg)']]; };
  assert.deepEqual(tile(PERF), ['100%', 'sales · collection · recovery']);
  assert.deepEqual(tile({ ...PERF, avgPct: 84.4 }), ['84%', 'sales · collection · recovery']);
  assert.deepEqual(tile({ ...PERF, avgPct: 0 }), ['0%', 'sales · collection · recovery'], 'a real nought is a nought');
  assert.deepEqual(tile({ ...PERF, avgPct: null }), ['—', 'sales · collection · recovery'], 'nothing measured: a dash (the line still says what it would be the average of)');
});

test('CLEARED TODAY is the line under the Defaulters: the dashboard card\'s own count, a real nought is "0 cleared today", and it is never a tile of its own', () => {
  const line = (c) => tiles(slideOf(c, PERF, 'WED', WEEK)).s['Defaulters'];
  assert.equal(line(CARDS), '4,321 cleared today');
  assert.equal(line({ ...CARDS, cleared: 0 }), '0 cleared today');
  assert.equal(line({ ...CARDS, cleared: 1234567 }), '1,234,567 cleared today');
  assert.equal(tiles(slideOf({ ...CARDS, cleared: 7 }, PERF, 'WED', WEEK)).v['Defaulters'], '10,372', 'the figure itself is the defaulters');
});

test('THE LOAN APPLICATIONS WIDGET IS GONE ("Better kill the loan app request widget", the owner, 25 Nov 2026, addendum 8): no tile, whatever the strip answers, and the slide\'s code no longer reads the strip\'s application count or amount (the dashboard\'s own strip still answers them: it draws them)', () => {
  const code = PRESENT.slice(PRESENT.indexOf("var pf = d.perf || {};"), PRESENT.indexOf(DAY_END)).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/appsCount|appsAmount|appsOn|Loan applications/.test(code), 'nothing of the applications is read or named by the slide');
  for (const perf of [PERF, { ...PERF, appsCount: 0, appsAmount: 0 }, { ...PERF, appsCount: 12345, appsAmount: 98765432109 }, { ...PERF, appsCount: undefined }]) {
    const t = slideOf(CARDS, perf, 'WED', WEEK);
    assert.equal(t.items.length, 12); assert.ok(!t.items.some(i => /loan app/i.test(i.l)));
    assert.ok(!JSON.stringify(t.items).match(/requested|486|12,345/), 'and no tile carries a number of applications or an amount asked');
  }
  assert.match(read('api/_lib/portal-core.js'), /appsCount: wkNow\.appsCount, appsAmount: wkNow\.appsAmount, appsPrevCount/, 'the dashboard\'s strip still answers the week\'s applications');
});

test('THE WEEK\'S LEGAL RECOVERY is the dashboard\'s Legal card figure, notices and calls TOGETHER with the percentage of what the two were owed under it, and then how much of it came BY PHONE; a dash, and no line, while either side cannot be read; a damaged answer never breaks the slide', () => {
  const tile = (legal) => { const t = tiles(slideOf(CARDS, PERF, 'WED', { ...WEEK, legal })); return [t.v['Legal recovery (week)'], t.s['Legal recovery (week)']]; };
  const g = (over) => ({ grand: { ...WEEK.legal.grand, ...over, total: { ...WEEK.legal.grand.total, ...(over && over.total) } } });
  assert.deepEqual(tile(WEEK.legal), ['TZS 41,000,000', ['79% of owed', 'by phone TZS 11,000,000']], 'the figure, the share of what was owed, and the phone\'s part of it');
  // the grand total (notices + calls), never one side of it; the phone line is the calls side of the SAME total row
  assert.deepEqual(tile(g({ total: { recovered: 55000000, nRec: 1, cRec: 2 } })), ['TZS 55,000,000', ['79% of owed', 'by phone TZS 2']]);
  assert.deepEqual(tile(g({ total: { cRec: 0 } })), ['TZS 41,000,000', ['79% of owed', 'by phone TZS 0']], 'a real nought by phone is a nought, with its words');
  assert.deepEqual(tile(g({ total: { cRec: 98765432109 } }))[1][1], 'by phone TZS 98,765,432,109');
  // an answer with the total and not its parts: the phone line is a dash, never a silent omission
  assert.deepEqual(tile(g({ total: { cRec: null } })), ['TZS 41,000,000', ['79% of owed', 'by phone —']]);
  assert.deepEqual(tile({ grand: { on: true, total: { recovered: 41000000, pct: 78.8 } } }), ['TZS 41,000,000', ['79% of owed', 'by phone —']]);
  // a side that cannot be read (the ledger not there, RUN-ME-089 not run, a phone read that failed or was late): a dash, never the other side alone
  assert.deepEqual(tile(g({ on: false, pOn: false, total: { recovered: null, pct: null } })), ['—', '']);
  assert.deepEqual(tile(g({ on: false })), ['—', ''], 'the grand total says it is not whole');
  assert.deepEqual(tile(g({ on: true, total: { recovered: null } })), ['—', ''], 'on, but no figure');
  // no Legal card at all, no grand total, no total row
  assert.deepEqual(tile(undefined), ['—', '']); assert.deepEqual(tile({}), ['—', '']); assert.deepEqual(tile({ grand: null }), ['—', '']); assert.deepEqual(tile({ grand: { on: true } }), ['—', '']);
  // owed nothing: the money, and a dash for the percentage; a real nought is a nought
  assert.deepEqual(tile(g({ total: { recovered: 41000000, pct: null } })), ['TZS 41,000,000', ['—', 'by phone TZS 11,000,000']]);
  assert.deepEqual(tile(g({ total: { recovered: 0, pct: 0, cRec: 0 } })), ['TZS 0', ['0% of owed', 'by phone TZS 0']]);
});

test('RECOVERED THIS WEEK GOES WITH THE WEEK\'S UNCOLLECTED ("Recovered this week should go with uncol week"): the week\'s recovery, under it the week\'s uncollected (the Weekly recovery trend\'s own TOTAL, else the Weekly expected trend\'s days added up) and then the percentage; nothing of today\'s is on the tile', () => {
  const tile = (perf, extra = WEEK) => { const t = tiles(slideOf(CARDS, perf, 'WED', extra)); return [t.v['Recovered this week'], t.s['Recovered this week']]; };
  assert.deepEqual(tile(PERF), ['TZS 94,338,048', ['of TZS 120,000,000 uncollected', '79% recovered']], 'recovered, the uncollected it is measured against, the percentage: in that order');
  assert.ok(!/today|456,789,012|123,456,789/.test(JSON.stringify(tile(PERF))), 'nothing of today\'s is on the week\'s tile: not the recovered, not the uncollected (addendum 8: "going with uncol today on the same widget doesn\'t make sense")');
  // the server's total wins over the days; a total with no uncollected falls back to the Weekly expected trend\'s days (711,000 + 950,000 + 1,340,000)
  assert.deepEqual(tile(PERF, { ...WEEK, recTrendTotal: { ...WEEK.recTrendTotal, uncollected: 5000000 } })[1][0], 'of TZS 5,000,000 uncollected');
  assert.deepEqual(tile(PERF, { ...WEEK, recTrendTotal: { recovered: 94338048 } })[1][0], 'of TZS 3,001,000 uncollected', 'a total with no uncollected: the days');
  assert.deepEqual(tile(PERF, { ...WEEK, recTrendTotal: { recovered: 94338048, uncollected: 'x' } })[1][0], 'of TZS 3,001,000 uncollected', 'a damaged one too');
  assert.deepEqual(tile(PERF, { colTrend: DAYS.colTrend, recTrend: [{ recovered: 1000 }] }), ['TZS 1,000', ['of TZS 3,001,000 uncollected', '79% recovered']], 'an older answer with no total at all: the days, both of them');
  assert.deepEqual(tile(PERF, { ...WEEK, recTrendTotal: { recovered: 94338048, uncollected: 0 } })[1][0], 'of TZS 0 uncollected', 'a real nought from the server is a nought (the week has its sheets)');
  // the week\'s percentage cannot be measured: a dash alone (never "— recovered"); a real nought is a nought
  assert.deepEqual(tile({ ...PERF, recPct: null })[1], ['of TZS 120,000,000 uncollected', '—']);
  assert.deepEqual(tile({ ...PERF, recPct: 0 })[1], ['of TZS 120,000,000 uncollected', '0% recovered']);
  assert.deepEqual(tile({ ...PERF, recPct: 118.4 })[1], ['of TZS 120,000,000 uncollected', '118% recovered'], 'more than the week left behind: above 100, as the dashboard\'s strip prints it');
  // no collection sheet behind the week (a Monday morning, no card, an older answer): no uncollected to show, and the tile says so; "not uploaded" is the dashboard\'s own flag
  const none = { uploaded: false, uncollected: 0 };
  for (const extra of [{ ...WEEK, colTrend: [{ ...none, weekday: 'MON' }, { ...none, weekday: 'TUE' }] }, { ...WEEK, colTrend: [] }, { ...WEEK, colTrend: undefined }, { ...WEEK, colTrend: [null, undefined] }])
    assert.deepEqual(tile(PERF, extra), ['TZS 94,338,048', 'no collection sheet yet'], JSON.stringify(extra.colTrend));
  // ONE day with a sheet is enough (an entry that carries no flag counts as uploaded, as the dashboard\'s own card reads it)
  assert.deepEqual(tile(PERF, { ...WEEK, colTrend: [{ ...none, weekday: 'MON' }, { weekday: 'TUE', uncollected: 5 }] })[1][0], 'of TZS 120,000,000 uncollected');
  // the lines are the strings the dashboard\'s own words end in, and only this tile and the Legal tile and the today tile carry two
  const items = slideOf(CARDS, PERF, 'WED', WEEK).items;
  assert.deepEqual(items.filter(i => Array.isArray(i.s)).map(i => i.l), ['Recovered today', 'Recovered this week', 'Legal recovery (week)'], 'three tiles carry two lines: the two Recovered tiles and the Legal recovery tile (its phone line)');
});

test('RECOVERED TODAY IS A TILE OF ITS OWN, WITH TODAY\'S UNCOLLECTED ("differentiate today from weekly recovery vs uncollected"): the dashboard\'s Recovered card over the Uncollected today card and the percentage that ratio is; "not uploaded yet" where no defaulter deck was filed today; "no collection sheet today" where there is no uncollected to divide by', () => {
  const tile = (c, extra = {}) => { const t = tiles(slideOf(c, PERF, 'WED', { ...WEEK, ...extra })); return [t.v['Recovered today'], t.s['Recovered today']]; };
  assert.deepEqual(tile(CARDS), ['TZS 123,456,789', ['of TZS 456,789,012 uncollected', '27% recovered']], 'recovered, the uncollected it is measured against, the percentage: in that order');
  assert.ok(!/week|94,338,048|120,000,000/.test(JSON.stringify(tile(CARDS))), 'nothing of the week\'s is on the day\'s tile');
  // the ratio the Weekly recovery trend\'s tile for today prints (recovered over the day\'s own uncollected), in whole numbers
  assert.equal(tile({ ...CARDS, recovered: 456789012 })[1][1], '100% recovered'); assert.equal(tile({ ...CARDS, recovered: 455000000 })[1][1], '100% recovered', '99.6 reads 100');
  assert.equal(tile({ ...CARDS, recovered: 228394506 })[1][1], '50% recovered');
  // a real nought is a nought, with its words (the day\'s later file is not in yet: the dashboard\'s own card reads nought too)
  assert.deepEqual(tile({ ...CARDS, recovered: 0 }), ['TZS 0', ['of TZS 456,789,012 uncollected', '0% recovered']]);
  // more than the day left behind: above 100, as the dashboard\'s tile prints it
  assert.deepEqual(tile({ ...CARDS, recovered: 912000000 }), ['TZS 912,000,000', ['of TZS 456,789,012 uncollected', '200% recovered']]);
  // nothing was uncollected today (the day\'s sheet is in and everything was collected): the money and a dash, never a division by nought
  assert.deepEqual(tile({ ...CARDS, uncollectedToday: 0 }), ['TZS 123,456,789', ['of TZS 0 uncollected', '—']]);
  // NO DEFAULTER DECK TODAY: the dashboard\'s own "not uploaded yet", a dash, never a nought that reads as "nothing came back" (VIEWS.dashboard, deckToday)
  assert.deepEqual(tile(CARDS, { deckToday: false }), ['—', 'not uploaded yet']);
  assert.deepEqual(tile({ ...CARDS, recovered: 0, uncollectedToday: 0 }, { deckToday: false }), ['—', 'not uploaded yet'], 'a zero because nothing was filed is not a result');
  assert.deepEqual(tile(CARDS, { deckToday: true }), ['TZS 123,456,789', ['of TZS 456,789,012 uncollected', '27% recovered']]); assert.equal(tile(CARDS, { deckToday: undefined })[0], 'TZS 123,456,789', 'an answer that does not say is read as filed');
  // NO COLLECTION SHEET FOR TODAY (a weekend, a morning before the upload, a card without the day): there is no uncollected to divide by; the recovered amount is still shown
  for (const extra of [{ colTrend: [DAYS.colTrend[0], DAYS.colTrend[1]] }, { colTrend: [{ ...DAYS.colTrend[2], uploaded: false }] }, { colTrend: [] }, { colTrend: undefined }, { asOfDate: '2026-11-28' }])
    assert.deepEqual(tile(CARDS, extra), ['TZS 123,456,789', 'no collection sheet today'], JSON.stringify(extra).slice(0, 90));
  // a damaged answer never breaks the slide: text and nothing read as nought
  assert.deepEqual(tile({ ...CARDS, recovered: undefined, uncollectedToday: null }), ['TZS 0', ['of TZS 0 uncollected', '—']]);
  assert.equal(tile({ ...CARDS, recovered: 'x' })[0], 'TZS 0');
  assert.deepEqual(tile({ ...CARDS, recovered: 98765432109, uncollectedToday: 98765432109 }), ['TZS 98,765,432,109', ['of TZS 98,765,432,109 uncollected', '100% recovered']]);
  // it sits beside the Uncollected today tile, which is as the owner left it (its figure and TODAY\'S collection %)
  const t = tiles(slideOf(CARDS, PERF, 'WED', WEEK));
  assert.equal(t.v['Uncollected today'], 'TZS 456,789,012'); assert.equal(t.s['Uncollected today'], '87% collected today');
});

test('COLLECTION TODAY % IS UNDER UNCOLLECTED TODAY: the Weekly expected trend card\'s own percentage for the day the dashboard\'s clock names (found by its DATE), never the week\'s; a day with no figure is a dash alone', () => {
  const line = (extra, perf = PERF) => tiles(slideOf(CARDS, perf, 'WED', { ...WEEK, ...extra })).s['Uncollected today'];
  assert.equal(line({}), '87% collected today', 'today\'s 86.6, in whole numbers');
  assert.ok(!/97|week/i.test(line({})), 'the week\'s collection % (96.7) is no longer under it');
  // by date, not by position: another day\'s entry is never taken for today\'s, whatever order the card lists them in
  assert.equal(line({ colTrend: [DAYS.colTrend[2], DAYS.colTrend[0], DAYS.colTrend[1]] }), '87% collected today');
  assert.equal(line({ colTrend: [{ weekday: 'WED', date: '2026-11-18', pct: 12 }, DAYS.colTrend[2]] }), '87% collected today', 'last Wednesday is not today');
  assert.equal(line({ asOfDate: '2026-11-24' }), '90% collected today', 'the dashboard\'s own clock says which day today is (a finished week\'s Friday, for one)');
  // an answer with no date on its days (older) is read by the weekday
  assert.equal(line({ asOfDate: undefined, colTrend: [{ weekday: 'TUE', pct: 90 }, { weekday: 'WED', pct: 86.6 }] }), '87% collected today');
  // a real nought and a real hundred are what they are
  assert.equal(line({ colTrend: [{ ...DAYS.colTrend[2], pct: 0 }] }), '0% collected today');
  assert.equal(line({ colTrend: [{ ...DAYS.colTrend[2], pct: 100 }] }), '100% collected today');
  assert.equal(line({ colTrend: [{ ...DAYS.colTrend[2], pct: 99.6 }] }), '100% collected today', 'whole numbers, as every percentage of the slide');
  // nothing to measure: the day has no sheet (a weekend, a morning before the upload), no card at all, or a damaged one: a dash alone, never "— collected today" and never a nought
  for (const bad of [{ colTrend: [{ ...DAYS.colTrend[2], pct: null }] }, { colTrend: [DAYS.colTrend[0], DAYS.colTrend[1]] }, { colTrend: [] }, { colTrend: undefined }, { colTrend: [null, undefined, {}] }, { asOfDate: '2026-11-28' }])
    assert.equal(line(bad), '—', JSON.stringify(bad).slice(0, 80));
  // it is the day's own figure whatever the week did
  assert.equal(line({}, { ...PERF, colPct: null }), '87% collected today'); assert.equal(line({}, { ...PERF, colPct: 12 }), '87% collected today');
});

test('SALES TODAY is the Sales trend card\'s own tile for today: the approved principal, the loans and the percentage of the daily target; the loan count is a count (1 loan, 0 loans), a percentage that cannot be measured leaves only the count, a day with no card is a dash', () => {
  const tile = (extra) => { const t = tiles(slideOf(CARDS, PERF, 'WED', { ...WEEK, ...extra })); return [t.v['Sales today'], t.s['Sales today']]; };
  assert.deepEqual(tile({}), ['TZS 4,200,000', '5 loans · 84% of target']);
  assert.deepEqual(tile({ salesTrend: [{ weekday: 'WED', date: '2026-11-25', amount: 1000000, loans: 1, pct: 20 }] }), ['TZS 1,000,000', '1 loan · 20% of target'], 'one loan is "1 loan"');
  assert.deepEqual(tile({ salesTrend: [{ weekday: 'WED', date: '2026-11-25', amount: 0, loans: 0, pct: 0 }] }), ['TZS 0', '0 loans · 0% of target'], 'a day with no sale is a real nought, with its words');
  assert.deepEqual(tile({ salesTrend: [{ weekday: 'WED', date: '2026-11-25', amount: 4200000, loans: 5, pct: null }] }), ['TZS 4,200,000', '5 loans'], 'no daily target to measure against: the count alone, never "· —"');
  assert.deepEqual(tile({ salesTrend: [{ weekday: 'WED', date: '2026-11-25', amount: 123456789012, loans: 1234, pct: 2469 }] }), ['TZS 123,456,789,012', '1,234 loans · 2469% of target']);
  // found by date: Monday\'s and Tuesday\'s entries are never today\'s
  assert.deepEqual(tile({ salesTrend: [DAYS.salesTrend[2], DAYS.salesTrend[0], DAYS.salesTrend[1]] }), ['TZS 4,200,000', '5 loans · 84% of target']);
  assert.deepEqual(tile({ asOfDate: '2026-11-24' }), ['TZS 3,000,000', '3 loans · 60% of target']);
  assert.deepEqual(tile({ asOfDate: undefined, salesTrend: [{ weekday: 'TUE', amount: 1, loans: 1, pct: 1 }, { weekday: 'WED', amount: 4200000, loans: 5, pct: 84.4 }] }), ['TZS 4,200,000', '5 loans · 84% of target'], 'an answer with no date on its days is read by the weekday');
  // no such day (Sunday has no sales day; an older answer has no card; a damaged card): a dash and no line, never a nought
  for (const bad of [{ asOfDate: '2026-11-29', weekday: 'SUN' }, { salesTrend: [] }, { salesTrend: undefined }, { salesTrend: [null, undefined, {}] }, { salesTrend: [DAYS.salesTrend[0], DAYS.salesTrend[1]] }])
    assert.deepEqual(tile(bad), ['—', ''], JSON.stringify(bad).slice(0, 80));
});

test('THE EARLY COLLECTION % AND THE COLLECTION % (WEEK) STAND SIDE BY SIDE ON A TILE OF THEIR OWN, the early one first as the owner wrote it; each is a dash where the week cannot measure it; the week\'s collection % is under nothing else', () => {
  const v = (perf) => tiles(slideOf(CARDS, perf, 'WED', WEEK)).v['Early col · Col % (week)'];
  assert.equal(v(PERF), '91% · 97%', '91.2 and 96.7, in whole numbers');
  assert.equal(v({ ...PERF, ecolPct: null }), '— · 97%'); assert.equal(v({ ...PERF, colPct: null }), '91% · —'); assert.equal(v({ ...PERF, ecolPct: null, colPct: null }), '— · —');
  assert.equal(v({ ...PERF, ecolPct: 0, colPct: 100 }), '0% · 100%', 'a real nought and a real hundred are what they are');
  assert.equal(v(undefined), '— · —');
  const t = tiles(slideOf(CARDS, PERF, 'WED', WEEK));
  assert.equal(t.s['Early col · Col % (week)'], '', 'nothing is under it: both figures are in it');
  assert.ok(![...Object.values(t.s)].flat().some(x => /collected this week/.test(x)), 'no tile prints the week\'s collection % under another figure any more');
});

test('the tiles come from the answer the slide already has: no read of its own, no call, and nothing of the officer boards (the day slide still plays when they do not load)', () => {
  const from = PRESENT.indexOf("var pf = d.perf || {};"), to = PRESENT.indexOf(DAY_END);
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
  assert.match(core, /honest zeros\.\n\s+deckToday,/, 'dashboardFull answers whether a defaulter deck was filed today (the Recovered today tile says "not uploaded yet" by it, as the dashboard\'s own card does)');
  assert.match(code, /d\.deckToday === false/, 'and the slide reads it');
  // the two per-day cards today's tiles are read from, and the clock that says which day today is
  assert.match(core, /asOfDate: today, pastWeek: asOf\.past,/, 'dashboardFull says which day its own clock calls today');
  assert.match(core, /return \{ weekday: wd, date: d, amount: amt, loans: on\.length, pct, dSales,/, 'each day of the Sales trend carries its date, the approved principal, the loans and the percentage of the daily target');
  assert.match(core, /return \{ weekday: wd, date: d, expected: exp, collected: col, uncollected: tUncollected\(rows\),/, 'each day of the Weekly expected trend carries its date, expected, collected and (below) the percentage');
  assert.match(core, /uploaded, pct, dCol, lwCol: dCol != null \? ppct : null \};/, 'and its percentage, null when nothing was expected');
  assert.match(core, /legal: legalDash_,/, 'dashboardFull answers the Legal card'); assert.match(core, /\.\.\.\(grand \? \{ grand \} : \{\}\)/, 'with the grand total (notices and calls) beside it');
  const gt = core.slice(core.indexOf('function legalGrand_('), core.indexOf('function legalGrand_(') + 3200);
  assert.match(gt, /return \{ on: nOn && pOn, nOn, pOn,/, 'the grand total says whether BOTH sides were read'); assert.match(gt, /owed: both \? r\.nOwed \+ r\.cOwed : null, recovered: both \? r\.nRec \+ r\.cRec : null, pct: both \?/, 'and its total row carries recovered and pct, null unless both sides were read');
});

test('presDraw gives the tile grid its class only when the slide asks for the 4x3 grid; the line (or LINES: a tile\'s `s` may be an array) under a figure is ESCAPED text inside the figure\'s box; every tile reserves as many lines as the most-lined tile has; a slide with none is drawn exactly as it was', () => {
  const draw = PRESENT.slice(PRESENT.indexOf('function presDraw()'), PRESENT.indexOf('} else if (s.kind === \'progress\''));
  assert.match(draw, /<div class="pkpis' \+ \(s\.grid === '4x3' \? ' p12' : ''\) \+ '">'/);
  assert.match(PRESENT, /kind:'kpi', grid:'4x3'/);
  // the drawing itself, RUN: the snippet that builds the tiles, with the page's escaper
  const a = draw.indexOf('var linesOf'), z = draw.indexOf("join('') + '</div>';", a) + "join('') + '</div>';".length;
  assert.ok(a > 0 && z > a, 'the tile drawing is where it was');
  const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const run = s => new Function('s', 'esc', 'var body;\n' + draw.slice(a, z) + '\nreturn body;')(s, esc);
  const PH = '<span class="ps" aria-hidden="true">&nbsp;</span>';
  // some tile has a line: it is a span INSIDE the figure, escaped; the others reserve the line with an invisible one
  const html = run({ grid: '4x3', items: [{ l: 'A', v: '1', s: '84% of target' }, { l: 'B', v: '2' }, { l: 'C<b>', v: '3', s: '<i>x</i>' }] });
  assert.ok(html.startsWith('<div class="pkpis p12">') && html.endsWith('</div>'));
  assert.ok(html.includes('<div class="pkpi"><div class="pl">A</div><div class="pv">1<span class="ps">84% of target</span></div></div>'), 'a tile with a line: the line is inside the figure\'s box');
  assert.ok(html.includes('<div class="pkpi"><div class="pl">B</div><div class="pv">2' + PH + '</div></div>'), 'a tile without one reserves it, so a row stands level');
  assert.ok(html.includes('<div class="pl">C&lt;b&gt;</div>') && html.includes('<span class="ps">&lt;i&gt;x&lt;/i&gt;</span>'), 'label and line are escaped');
  // SEVERAL LINES (the combined Recovered tile: the percentage, then today's amount): one span each, in order, escaped; the tiles with fewer reserve the rest
  const two = run({ grid: '4x3', items: [{ l: 'A', v: '1', s: ['118% of uncollected', 'TZS 1,000 <today>'] }, { l: 'B', v: '2', s: 'one' }, { l: 'C', v: '3' }, { l: 'D', v: '4', s: ['', 'y'] }, { l: 'E', v: '5', s: [] }] });
  assert.ok(two.includes('<div class="pv">1<span class="ps">118% of uncollected</span><span class="ps">TZS 1,000 &lt;today&gt;</span></div>'), 'two lines, two spans, in the order given, escaped');
  assert.ok(two.includes('<div class="pv">2<span class="ps">one</span>' + PH + '</div>'), 'a tile with one line reserves the second');
  assert.ok(two.includes('<div class="pv">3' + PH + PH + '</div>'), 'a tile with none reserves both');
  assert.ok(two.includes('<div class="pv">4<span class="ps">y</span>' + PH + '</div>'), 'an empty line is no line (it is dropped, not drawn as a blank)');
  assert.ok(two.includes('<div class="pv">5' + PH + PH + '</div>'), 'an empty list is no line');
  // the most-lined tile sets the count for the WHOLE slide, whichever tile it is
  const late = run({ items: [{ l: 'A', v: '1', s: 'a' }, { l: 'B', v: '2' }, { l: 'C', v: '3', s: ['c1', 'c2', 'c3'] }] });
  assert.equal((late.match(/class="ps"/g) || []).length, 9, 'three tiles of three lines: every tile reserves three');
  // no tile has a line: exactly the markup it always was (a label and a figure, both escaped), no reserved line
  const plain = run({ items: [{ l: 'A', v: '1' }, { l: 'B<', v: '2&' }] });
  assert.equal(plain, '<div class="pkpis"><div class="pkpi"><div class="pl">A</div><div class="pv">1</div></div><div class="pkpi"><div class="pl">B&lt;</div><div class="pv">2&amp;</div></div></div>');
  assert.equal(run({ items: [{ l: 'A', v: '1', s: '' }, { l: 'B', v: '2', s: [] }] }).includes('class="ps"'), false, 'empty strings and empty lists are not lines at all');
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
  // and so is a tile whose content (its label above, its last line below) runs past the tile's own height: a tile may carry two lines under its figure
  assert.match(kg, /var overH = function\(\)\{ return tiles\.some\(function\(t\)\{/);
  assert.match(kg, /m = Math\.min\(8, parseFloat\(getComputedStyle\(t\)\.paddingTop\) \|\| 0\);/, 'a margin of 8 pixels (never more than the tile\'s own padding)');
  assert.match(kg, /a\.getBoundingClientRect\(\)\.top < r\.top \+ m \|\| z\.getBoundingClientRect\(\)\.bottom > r\.bottom - m/, 'the label\'s top within the margin of the tile\'s top, or the last line\'s bottom within it of the bottom');
  assert.match(kg, /var over = function\(\)\{ return vals\.some\(function\(v\)\{ return v\.scrollWidth > v\.clientWidth \+ 1; \}\) \|\| overH\(\); \};/, 'either one is the signal to shrink');
  assert.match(kg, /vals\.forEach\(function\(v\)\{ v\.style\.fontSize = sz \+ 'px'; \}\)/, 'every tile gets the same size');
  assert.match(kg, /return;\s*\}\s*\}/, 'and the branch returns: no zoom on top of it');
  assert.match(kg, /kg\.style\.height = ''; vals\.forEach\(function\(v\)\{ v\.style\.fontSize = ''; \}\)/, 'every draw and every resize starts from the CSS sizes again');
  // the table branch and the generic zoom are still there, in their places
  assert.ok(fit.indexOf("if (tbl) {") < fit.indexOf("var kg = pres.querySelector"), 'tables are fitted first, as they were');
  assert.match(fit, /var r = Math\.max\(0\.5, Math\.floor\(avail \/ h \* 100\) \/ 100\);/);
});
