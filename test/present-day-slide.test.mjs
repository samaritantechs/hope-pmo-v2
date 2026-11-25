/* THE "HOPE PMO — DAY" SLIDE OF THE PRESENTATION: TWELVE TILES, FOUR ACROSS AND THREE DOWN (handbook Part 164).

     "Add 6 widgets to hope pmo overall slide at presentation so that they are 4x3 full on our tv (HOPE PMO - DAY slide)" -- the owner, 25 Nov 2026
     "replace initial arreas widget with anything else thats crucial in the presentation hope pmo day slide summary"      -- the owner, 25 Nov 2026 (addendum 1)
     "combine % of sales, and of recovered at their amounts and replace with any other meaningful widgets"                -- the owner, 25 Nov 2026 (addendum 2)
     "also cleared today to defaulters, add another meaningful widget" · "col% and uncollected today also in a single widget. add another meaningful one"   -- the owner, 25 Nov 2026 (addendum 3)
     "combine recovered today and this week, add another meaningful widget" · "show collection today% at uncollected today" · "ealry col% and col% week on their own widget"   -- the owner, 25 Nov 2026 (addendum 5)
     "legal recovery widget on presentation, have their phone recovery in the same widget"                                                        -- the owner, 25 Nov 2026 (addendum 5)

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
const CARDS = { curArrears: 3412547121, initArrears: 23760795812, recovered: 1234567890, defaulters: 10372, cleared: 4321, salesWeek: 987654321, uncollectedToday: 456789012, abnormal: 37 };
const PERF = { salesPct: 84.4, ecolPct: 91.2, colPct: 96.7, recPct: 118.4, avgPct: 99.8, appsCount: 486, appsAmount: 1234000000 };
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
const LABELS = ['Current arrears', 'Recovered this week', 'Defaulters', 'Sales this week', 'Uncollected today', 'Abnormal', 'Sales today', 'Loan applications (week)',
  'Early col · Col % (week)', 'Legal recovery (week)', 'Exp.Def recovery (week)', 'Performance (average)'];

test('the day slide has TWELVE tiles in their places: ONE Recovered tile (the week\'s, with today\'s under it) second, Sales today seventh, the loan applications, the Early col and Col % pair, the Legal recovery, the Expected Defaulters recovery and the Performance average', () => {
  const s = slideOf(CARDS, PERF, 'WED', WEEK);
  assert.equal(s.id, 'kpi'); assert.equal(s.kind, 'kpi'); assert.equal(s.title, 'HOPE PMO — WED');
  assert.deepEqual(s.items.map(i => i.l), LABELS);
  assert.equal(s.items.length, 12, 'four across and three down is twelve');
  assert.ok(!s.items.some(i => /Initial arrears/.test(i.l)), 'the owner replaced the Initial arrears tile (25 Nov): it is not on the slide');
  assert.ok(!s.items.some(i => /^Sales %|^Recovery %|^Cleared today|^Collection %/.test(i.l)), 'Sales %, Recovery %, Cleared today and Collection % are printed under their amounts and Defaulters (25 Nov): they are not tiles of their own');
  assert.ok(!s.items.some(i => i.l === 'Recovered' || /^Early Collection %/.test(i.l)), 'Recovered (today\'s) is one tile with Recovered this week, and the Early Collection % is on a tile with the Collection % (25 Nov, addendum 5)');
  assert.equal(s.items.filter(i => /Recovered/.test(i.l)).length, 1, 'one tile says Recovered');
});

test('every figure is the dashboard\'s own, and what belongs to an amount is printed UNDER it: sales % under sales, TODAY\'S collection % under the day\'s uncollected, cleared customers under the defaulters, the recovery % and today\'s recovery under the week\'s recovery, a percentage under each of the Expected Defaulters, Legal and applications figures', () => {
  const { v, s } = tiles(slideOf(CARDS, PERF, 'WED', WEEK));
  assert.deepEqual(v, {
    'Current arrears': 'TZS 3,412,547,121', 'Recovered this week': 'TZS 94,338,048', 'Defaulters': '10,372', 'Sales this week': 'TZS 987,654,321', 'Uncollected today': 'TZS 456,789,012', 'Abnormal': '37',
    'Sales today': 'TZS 4,200,000', 'Loan applications (week)': '486',
    'Early col · Col % (week)': '91% · 97%', 'Legal recovery (week)': 'TZS 41,000,000', 'Exp.Def recovery (week)': 'TZS 3,600,000', 'Performance (average)': '100%' });
  assert.deepEqual(s, {
    'Current arrears': '', 'Recovered this week': ['118% of uncollected', 'TZS 1,234,567,890 today'], 'Defaulters': '4,321 cleared today', 'Sales this week': '84% of target',
    'Uncollected today': '87% collected today', 'Abnormal': '',
    'Sales today': '5 loans · 84% of target', 'Loan applications (week)': 'TZS 1,234,000,000 requested',
    'Early col · Col % (week)': '', 'Legal recovery (week)': ['79% of owed', 'by phone TZS 11,000,000'], 'Exp.Def recovery (week)': '3.0% of their arrears', 'Performance (average)': 'sales · collection · recovery' });
});

test('a percentage the week cannot measure is a dash, never a nought; a real nought is a nought; a dash stands alone under an amount (never "— of target"); a dashboard with no strip at all still draws twelve tiles', () => {
  const { v, s } = tiles(slideOf(CARDS, { salesPct: null, ecolPct: null, colPct: 100, recPct: 0, avgPct: null, appsCount: 0, appsAmount: 0 }, 'WED', WEEK));
  assert.equal(v['Early col · Col % (week)'], '— · 100%', 'the early collection cannot be measured (a dash) while the week\'s collection reads its real 100%'); assert.equal(v['Performance (average)'], '—');
  assert.equal(s['Sales this week'], '—', 'nothing to measure: a dash alone');
  assert.deepEqual(s['Recovered this week'], ['0% of uncollected', 'TZS 1,234,567,890 today'], 'a real nought is a nought, with its words; today\'s amount is still there');
  assert.equal(v['Loan applications (week)'], '0', 'no application this week is a real nought: a count, never a dash'); assert.equal(s['Loan applications (week)'], 'TZS 0 requested');
  const bare = tiles(slideOf(CARDS, undefined));
  assert.equal(Object.keys(bare.v).length, 12);
  assert.deepEqual([bare.v['Early col · Col % (week)'], bare.v['Legal recovery (week)'], bare.v['Exp.Def recovery (week)'], bare.v['Performance (average)'], bare.v['Loan applications (week)'], bare.v['Sales today']], ['— · —', '—', '—', '—', '—', '—'], 'no strip, no Expected Defaulters answer, no Legal card, no applications count, no day cards: six dashes');
  assert.equal(bare.s['Sales this week'], '—'); assert.deepEqual(bare.s['Recovered this week'], ['—', 'TZS 1,234,567,890 today']); assert.equal(bare.s['Uncollected today'], '—');
  assert.equal(bare.s['Legal recovery (week)'], ''); assert.equal(bare.s['Loan applications (week)'], ''); assert.equal(bare.s['Sales today'], '');
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

test('CLEARED TODAY is the line under the Defaulters: the dashboard card\'s own count, a real nought is "0 cleared today", and it is never a tile of its own', () => {
  const line = (c) => tiles(slideOf(c, PERF, 'WED', WEEK)).s['Defaulters'];
  assert.equal(line(CARDS), '4,321 cleared today');
  assert.equal(line({ ...CARDS, cleared: 0 }), '0 cleared today');
  assert.equal(line({ ...CARDS, cleared: 1234567 }), '1,234,567 cleared today');
  assert.equal(tiles(slideOf({ ...CARDS, cleared: 7 }, PERF, 'WED', WEEK)).v['Defaulters'], '10,372', 'the figure itself is the defaulters');
});

test('THE WEEK\'S LOAN APPLICATIONS are the strip\'s own count with the amount asked under it; a count is a count (no application is a nought, never a dash) and an answer with no count at all is a dash', () => {
  const tile = (perf) => { const t = tiles(slideOf(CARDS, perf, 'WED', WEEK)); return [t.v['Loan applications (week)'], t.s['Loan applications (week)']]; };
  assert.deepEqual(tile(PERF), ['486', 'TZS 1,234,000,000 requested']);
  assert.deepEqual(tile({ ...PERF, appsCount: 0, appsAmount: 0 }), ['0', 'TZS 0 requested']);
  assert.deepEqual(tile({ ...PERF, appsCount: 12345, appsAmount: 98765432109 }), ['12,345', 'TZS 98,765,432,109 requested']);
  assert.deepEqual(tile({ ...PERF, appsCount: undefined }), ['—', ''], 'an older answer with no count');
  assert.deepEqual(tile({ ...PERF, appsCount: null }), ['—', '']);
  assert.deepEqual(tile({ ...PERF, appsAmount: undefined }), ['486', 'TZS 0 requested'], 'a count with no amount: the amount reads nought, as the dashboard\'s own money does');
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

test('RECOVERED TODAY AND THIS WEEK ARE ONE TILE: the week\'s money is the figure, under it the percentage that belongs to it, then today\'s amount; a dash for a percentage the week cannot measure never hides today\'s amount; there is no second Recovered tile', () => {
  const tile = (c, perf, extra = WEEK) => { const t = tiles(slideOf(c, perf, 'WED', extra)); return [t.v['Recovered this week'], t.s['Recovered this week']]; };
  assert.deepEqual(tile(CARDS, PERF), ['TZS 94,338,048', ['118% of uncollected', 'TZS 1,234,567,890 today']]);
  // today's amount is the dashboard card's own `recovered`, in full, whatever it is: a real nought reads "TZS 0 today"
  assert.deepEqual(tile({ ...CARDS, recovered: 0 }, PERF), ['TZS 94,338,048', ['118% of uncollected', 'TZS 0 today']]);
  assert.deepEqual(tile({ ...CARDS, recovered: 98765432109 }, PERF)[1][1], 'TZS 98,765,432,109 today');
  // the week's percentage cannot be measured: a dash alone (never "— of uncollected"), and today's amount is still there
  assert.deepEqual(tile(CARDS, { ...PERF, recPct: null }), ['TZS 94,338,048', ['—', 'TZS 1,234,567,890 today']]);
  assert.deepEqual(tile(CARDS, { ...PERF, recPct: 0 }), ['TZS 94,338,048', ['0% of uncollected', 'TZS 1,234,567,890 today']]);
  // an answer with no weekly total falls back to the days, as before; the tile never loses today's amount
  assert.deepEqual(tile(CARDS, PERF, { recTrend: [{ recovered: 1000 }, { recovered: 2500 }] }), ['TZS 3,500', ['118% of uncollected', 'TZS 1,234,567,890 today']]);
  // one tile, two lines, in that order: the percentage belongs to the week's amount, so it sits right under it
  const items = slideOf(CARDS, PERF, 'WED', WEEK).items;
  assert.deepEqual(items.filter(i => Array.isArray(i.s)).map(i => i.l), ['Recovered this week', 'Legal recovery (week)'], 'two tiles carry two lines: the combined Recovered tile and the Legal recovery tile (its phone line)');
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
  assert.match(core, /appsCount: wkNow\.appsCount, appsAmount: wkNow\.appsAmount, appsPrevCount/, 'the strip answers the week\'s applications: the count and the amount asked');
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
