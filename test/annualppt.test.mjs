/* THE ANNUAL REPORT'S "EXPORT DECK (PPT)" -- public/deck/annual-ppt.js, made in the browser from the
   answer the Annual Rep tab already holds.

     "Having the ppt design in place -- I wish to have an export annual ppt button that will
      always ppt export with updated data of selected year"

   These tests run the REAL server (annualReport, on a fake database with a year of teams, loans
   and stamped months) and hand its answer to the REAL deck code and the REAL vendored PowerPoint
   library, in a VM, then read the slides back out of the .pptx. So what is pinned is the whole
   chain: the figures on a slide are the server's figures, a slide whose data is not there is left
   out rather than drawn empty, and the deck never takes a year down because a section had nothing
   to say. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-08-02T08:00:00Z');
const ADMIN = { code: 'A', name: 'ADMIN', role: 'ADMIN', teams: null, tabs: ['settings', 'upload', 'annual'] };

/* ---------------------------------------------------------------------------- the fixture */
const REGIONS = [['LAKE ZONE', 10], ['DAR ES SALAAM', 6], ['SOUTH', 5], ['NORTH', 3]];
function book({ with2025 = true } = {}) {
  const teams = [], loans = [], tm = [];
  let n = 0;
  for (const [region, count] of REGIONS) for (let k = 0; k < count; k++, n++) {
    const team = 'TEAM' + String(n + 1).padStart(2, '0');
    teams.push({ team, region, opm: 'OPM ' + (n % 2), recovery: null, gmo: 'GMO ' + (n % 5), manager: 'MGR ' + (n % 8), credit: 'ANALYST ' + (n % 6),
      expected: null, bike: null, collection: 'PMO ' + (n % 3), legal: null });
    const opened = n >= 18 ? 4 : 1;                                  // the last six teams open in April
    for (let m = opened; m <= 7; m++) {
      const ym = '2026-' + String(m).padStart(2, '0');
      const count = 8 + ((n + m) % 6);
      for (let j = 0; j < count; j++) {
        loans.push({ id: team + ym + j, team, stage: 'approved', principal_amt: 7500000, loan_amt: 10200000, approved_date: ym + '-10',
          track_no: String((j % 3 === 0 && !(n >= 18 && m === opened)) ? 2 : 1) });
      }
      const exp = 10000000 + n * 100000, col = Math.round(exp * (0.80 + ((n + m) % 10) / 50)), unc = exp - col;
      tm.push({ team, ym, source: 'sheet', expected: exp, collected: col, uncollected: unc, ecol_pct: 70 + (n % 20), recovered: Math.round(unc * (0.3 + (n % 7) / 10)) });
    }
    if (with2025) {
      for (let m = 1; m <= 12; m++) loans.push({ id: team + '25' + m, team, stage: 'approved', principal_amt: 5000000, loan_amt: 6800000, approved_date: '2025-' + String(m).padStart(2, '0') + '-12', track_no: m % 2 ? '1' : '3' });
      tm.push({ team, ym: '2025', source: 'sheet', col_pct: 88 + (n % 10), total_def: 20000000 + n * 1000000, par_pct: 4 + (n % 9), gmo: 'GMO ' + (n % 5) });
    }
  }
  return { teams, loans, team_months: tm,
    settings: [{ key: 'SALES_TARGET_WEEKLY', value: '25000000' }, { key: 'ANNUAL_HOLDERS_LOADED', value: 'test' }],
    access_codes: [], roles: [], pmo_adjustments: [], repayment_snapshots: [], defaulter_snapshots: [] };
}
const annual = (tables, year) => portalApi(fakeDb(tables), ADMIN, 'annual', { year }, NOW);
const annualBook = (tables, year, user = ADMIN) => portalApi(fakeDb(tables), user, 'annualBook', { year }, NOW);
const DAY = '2026-08-01';
/** The books the deck lays beside the year: today's defaulter deck, today's expected deck, and a register of notices. */
function withBooks(t) {
  t.defaulter_snapshots = []; t.repayment_snapshots = []; t.demand_notices = [];
  t.teams.forEach((tm, i) => {
    for (let c = 0; c < 3; c++) t.defaulter_snapshots.push({ ref: 'D' + i + c, full_name: 'DEF ' + i + c, contact: '0714', team: tm.team, arrears: 100000 * (c + 1) + i * 1000, status: c === 2 ? 'Chronic' : 'Defaulter',
      ds: '3-6', dc: 3, days_elapsed: 20 + c * 40, disb_date: '2026-06-01', initial_inst: 100000, other_inst: 40000, balance: 500000 + i * 5000, snapshot_type: 'current', weekday: 'SAT', snapshot_date: DAY, upload_batch: 'bd', created_at: DAY + 'T04:00:00Z' });
    for (let c = 0; c < 5; c++) t.repayment_snapshots.push({ ref: 'E' + i + c, full_name: 'EXP ' + i + c, contact: '0712', team: tm.team, payment_expected: 20000, arrears: c === 0 ? 30000 : 0, balance: 400000 + c * 10000,
      todays_status: c % 2 ? 'PAID' : 'UNPAID', todays_payment: c % 2 ? 20000 : 0, due_summary: '2/6', nc: 0, snapshot_type: 'today', snapshot_date: DAY, upload_batch: 'be', created_at: DAY + 'T04:00:00Z' });
    if (i % 3 === 0) for (let m = 3; m <= 7; m++) t.demand_notices.push({ id: 'n' + i + m, ref: 'D' + i + '0', team: tm.team, full_name: 'DEF ' + i + '0', notice_date: '2026-0' + m + '-15', total_demand: 150000 + i * 1000, fine: 10000,
      arrears_at_notice: 140000 + i * 1000, issued_by: 'LEGAL', created_at: '2026-0' + m + '-15T05:00:00Z' });
  });
  return t;
}

/* ---------------------------------------------------------------------------- the deck, in a VM */
// Two 1x1 images: the deck code takes image data, the browser fetches the real ones.
const PX = 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function deckCtx() {
  const ctx = { console, setTimeout, clearTimeout, setImmediate, Promise, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Blob, URL, atob, btoa, navigator: { userAgent: 'node' } };
  ctx.window = ctx; ctx.self = ctx; ctx.document = { createElement: () => ({}) };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, 'public/deck/pptxgen.bundle.js'), 'utf8'), ctx, { filename: 'pptxgen.bundle.js' });
  vm.runInContext(readFileSync(join(ROOT, 'public/deck/annual-ppt.js'), 'utf8'), ctx, { filename: 'annual-ppt.js' });
  return ctx;
}
/** Build the deck for answer `d` (and the year before, `prev`), and read every slide's text back out of the file. */
async function slidesOf(d, prev = null, book = null) {
  const ctx = deckCtx();
  const M = ctx.anPptModel_(d, prev, book);
  if (!M) return { model: null, slides: [] };
  const pres = ctx.anPptBuild_(ctx.PptxGenJS, M, { title: PX, logo: PX });
  const b64 = await pres.write({ outputType: 'base64' });
  const zip = await ctx.JSZip.loadAsync(b64, { base64: true });
  const names = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(a.match(/\d+/)) - Number(b.match(/\d+/)));
  const slides = [];
  for (const f of names) {
    const xml = await zip.file(f).async('string');
    slides.push({ xml, text: [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')).join(' | ') });
  }
  return { model: M, slides, zip, names };
}
const has = (r, s) => r.slides.some(x => x.text.includes(s));

/* ---------------------------------------------------------------------------- the tests */
test('the server answers with regions and a leader\'s retention, by the same rule as the company', async () => {
  const d = await annual(book(), 2026);
  assert.equal(d.regions.length, 4, 'one board per region');
  assert.deepEqual(d.regions.map(r => r.region).sort(), ['DAR ES SALAAM', 'LAKE ZONE', 'NORTH', 'SOUTH']);
  const sumR = k => d.regions.reduce((s, r) => s + r[k], 0);
  assert.equal(sumR('sales'), d.totals.sales, 'the regions add up to the company');
  assert.equal(sumR('loans'), d.totals.loans); assert.equal(sumR('retained'), d.totals.retained);
  const lake = d.regions.find(r => r.region === 'LAKE ZONE');
  assert.equal(lake.teamsEver, 10); assert.equal(lake.months, 7);
  // a region's month is the company's month rule, over its own teams
  const cells = d.teams.filter(t => t.region === 'LAKE ZONE').map(t => t.m['2026-03']).filter(Boolean);
  const exp = cells.reduce((s, c) => s + c.expected, 0), col = cells.reduce((s, c) => s + c.collected, 0);
  assert.equal(lake.m['2026-03'].colPct, Math.round(col / exp * 1000) / 10, 'collected over expected, summed first');
  // the company's months are still what they were: the same helper builds them
  const mar = d.months[2];
  assert.equal(mar.state, 'sheet'); assert.equal(mar.teams, 18, 'six teams open in April');
  assert.equal(mar.retentionPct, Math.round(mar.retained / mar.loans * 1000) / 10);
  // a leader carries the retention of the teams they held, month by month
  const an = d.leaders.roles.find(r => r.role === 'credit').rows.find(r => r.name === 'ANALYST 0');
  assert.ok(an.loans > 0 && an.retained >= 0 && an.retentionPct != null);
  assert.equal(an.retentionPct, Math.round(an.retained / an.loans * 1000) / 10);
  assert.equal(Object.values(an.m).reduce((s, x) => s + x.retained, 0), an.retained, 'the months add up to the year');
});

test('the books beside the year: PAR, the active portfolio and the legal register, each from its own tab\'s reader', async () => {
  const t = withBooks(book());
  const b = await annualBook(t, 2026);
  assert.equal(b.asAt, '2026-08-02');
  // PAR: the PAR tab's own answer, laid by region
  assert.equal(b.par.ok, true); assert.equal(b.par.date, DAY); assert.equal(b.par.totals.customers, 72, 'three defaulters a team, 24 teams');
  const pd = await portalApi(fakeDb(t), ADMIN, 'par', {}, NOW);
  assert.equal(b.par.totals.par, pd.totals.par, 'the PAR tab\'s company PAR, not a second one');
  assert.equal(b.par.byTeam.length, pd.byTeam.length);
  assert.equal(b.par.byRegion.length, 4); assert.equal(b.par.byRegion.reduce((s, r) => s + r.arrears, 0), pd.totals.arrears, 'the regions add up to the book');
  const lakeP = b.par.byRegion.find(r => r.region === 'LAKE ZONE');
  assert.equal(lakeP.par, Math.round(lakeP.arrears / lakeP.balance * 1000) / 10, 'arrears over balance');
  // the active portfolio: the latest expected deck
  assert.equal(b.portfolio.ok, true); assert.equal(b.portfolio.date, DAY); assert.equal(b.portfolio.customers, 120, 'five customers a team');
  assert.equal(b.portfolio.behind.customers, 24, 'one in arrears a team');
  assert.equal(b.portfolio.byStatus.reduce((s, x) => s + x.customers, 0), 120);
  assert.equal(b.portfolio.byRegion.reduce((s, r) => s + r.balance, 0), b.portfolio.balance, 'regions add up to the book');
  // legal: the year's notices, by month and team, the tab's own tiles
  assert.equal(b.legal.ok, true); assert.equal(b.legal.notices, 40, 'eight teams, five notices each'); assert.equal(b.legal.byMonth.length, 12);
  assert.deepEqual(b.legal.byMonth.slice(2, 7).map(m => m.notices), [8, 8, 8, 8, 8]); assert.equal(b.legal.byMonth[0].notices, 0);
  assert.equal(b.legal.demanded, b.legal.byTeam.reduce((s, x) => s + x.demanded, 0));
  const reg = await portalApi(fakeDb(t), ADMIN, 'demandNotices', {}, NOW);
  assert.equal(b.legal.recovery, reg.recovery, 'the register\'s own recovery when every notice is this year\'s');
  assert.equal(b.legal.recoveryPct, reg.recoveryPct); assert.equal(b.legal.paidSince, reg.paidSince);
  assert.equal((await annualBook(t, 2025)).legal.notices, 0, 'another year\'s register is empty');
});

test('a section the code may not open, or that cannot be read, says so and the others still come', async () => {
  const t = withBooks(book());
  const parOnly = { code: 'P', name: 'PAR ONLY', role: 'GMO', teams: null, tabs: ['annual', 'par'] };
  const b = await annualBook(t, 2026, parOnly);
  assert.equal(b.par.ok, true);
  assert.equal(b.portfolio.ok, false); assert.match(b.portfolio.reason, /needs the Expected tab/);
  assert.equal(b.legal.ok, false); assert.match(b.legal.reason, /needs the Legal tab/);
  // no decks uploaded: the sections answer, empty, and say which date they could not find
  const bare = await annualBook(book(), 2026);
  assert.equal(bare.par.ok, true); assert.equal(bare.par.empty, true); assert.equal(bare.portfolio.empty, true); assert.equal(bare.legal.empty, true);
});

test('the deck for a year in progress: every section, the figures the server gave, the year before beside it', async () => {
  const t = withBooks(book());
  const d = await annual(t, 2026), prev = await annual(t, 2025), bk = await annualBook(t, 2026);
  const r = await slidesOf(d, prev, bk);
  assert.ok(r.slides.length >= 32, 'a full deck: ' + r.slides.length + ' slides');
  assert.ok(r.slides[0].text.includes('(2026) ANNUAL REPORT TO DATE') && r.slides[0].text.includes('January to July 2026'), 'the title says to date, and the span');
  for (const title of ['What this report covers', '2026 at a glance', 'Teams went from 18 to 24', 'Coverage across 4 regions', 'Sales by month', '2026 against 2025, month by month',
    'First-time and returning customers', 'Retention by team', 'Retention by region', 'Collection by month', 'Collection by team', 'Recovery by month',
    'Regions: sales and general performance', 'Regions: who is in them', 'Credit analysts: sales and results', 'Retention by credit analyst', 'General performance by team',
    'General performance by leader', 'Statistical snapshot: the 7 months', 'Key observations', 'What the figures point to', 'Not in this export', 'Notes on the figures',
    'Portfolio at risk: the book as at 2026-08-01', 'Portfolio at risk by region', 'Portfolio at risk by team', 'Arrears by status',
    'Active portfolio: customers on the 2026-08-01 deck', 'Active portfolio by region', 'Active portfolio by team',
    'Legal: demand notices in 2026', 'Notices by month and by state', 'Legal by team']) {
    assert.ok(has(r, title), 'a slide called "' + title + '"');
  }
  // the glance slide is the server's totals, to the digit
  const glance = r.slides.find(s => s.text.includes('2026 at a glance')).text;
  assert.ok(glance.includes('TZS ' + (d.totals.sales / 1e9).toFixed(2) + 'B'), 'sales: ' + glance.slice(0, 200));
  assert.ok(glance.includes(d.totals.retentionPct.toFixed(1) + '%'), 'retention');
  assert.ok(glance.includes(d.totals.colPct.toFixed(1) + '%') && glance.includes(d.totals.recPct.toFixed(1) + '%') && glance.includes(d.totals.general.toFixed(1) + '%'), 'collection, recovery, general');
  assert.ok(glance.includes('2025: ' + prev.totals.retentionPct.toFixed(1) + '%'), 'last year\'s retention beside it');
  // the snapshot table: a row for each month and the year to date
  const snap = r.slides.find(s => s.text.includes('Statistical snapshot')).text;
  assert.ok(snap.includes('Year to date') && snap.includes('Jan') && snap.includes('Jul'), 'the months and the year');
  // native charts, not pictures
  assert.ok(r.names.length >= 22 && Object.keys(r.zip.files).some(f => /^ppt\/charts\/chart\d+\.xml$/.test(f)), 'real charts inside');
  // the contents list names what is in, and it is a section that is in
  const contents = r.slides[1].text;
  for (const s of ['At a glance', 'Sales', 'Customers', 'Collection', 'Recovery', 'Regions', 'Credit analysts', 'Portfolio at risk', 'Active portfolio', 'Legal', 'Notes']) assert.ok(contents.includes(s), 'contents: ' + s);
  assert.ok(!contents.includes('as the year closed it'), '2026 carries no stamped PAR, so no year-close PAR section');
  // the figures on the books slides are the server's
  const par = r.slides.find(s => s.text.includes('Portfolio at risk: the book as at')).text;
  assert.ok(par.includes(bk.par.totals.par.toFixed(1) + '%') && par.includes('TZS ' + (bk.par.totals.arrears / 1e9).toFixed(2) + 'B'), 'PAR and arrears: ' + par.slice(0, 160));
  const act = r.slides.find(s => s.text.includes('Active portfolio: customers on')).text;
  assert.ok(act.includes('120') && act.includes('TZS ' + (bk.portfolio.balance / 1e9).toFixed(2) + 'B'), 'the active portfolio\'s customers and balance');
  const leg = r.slides.find(s => s.text.includes('Legal: demand notices in')).text;
  assert.ok(leg.includes('| 40 |') || leg.includes(' 40 '), 'forty notices') && assert.ok(leg.includes(bk.legal.recoveryPct.toFixed(1) + '%'), 'the register\'s recovery %');
  // THE KEY: every region with its GMO and its teams
  const key = r.slides.filter(s => s.text.includes('Regions: who is in them')).map(s => s.text).join(' ');
  for (const reg of ['LAKE ZONE', 'DAR ES SALAAM', 'SOUTH', 'NORTH']) assert.ok(key.includes(reg), 'region ' + reg + ' in the key');
  assert.ok(key.includes('TEAM01') && key.includes('TEAM24') && /GMO: GMO \d/.test(key), 'its teams and a GMO: ' + key.slice(0, 200));
  const regionTable = r.slides.find(s => s.text.includes('Regions: sales and general performance')).text;
  assert.ok(/GMO \d/.test(regionTable) && regionTable.includes('GMO'), 'the regions table names the GMO');
});

test('a closed year with only a year\'s collection stamped: no monthly collection or recovery slides, PAR where it was stamped', async () => {
  const d = await annual(book(), 2025);
  assert.equal(d.stamped, true);
  const r = await slidesOf(d, null);
  assert.ok(r.slides[0].text.includes('(2025) ANNUAL REPORT') && !r.slides[0].text.includes('TO DATE'), 'a finished year is not "to date"');
  assert.ok(has(r, '2025 at a glance') && has(r, 'Sales by month') && has(r, 'Collection by team'), 'sales, and collection by team from the year\'s stamp');
  assert.ok(!has(r, 'Collection by month') && !has(r, 'Recovery by month'), 'no monthly collection or recovery was recorded, so none is drawn');
  assert.ok(!has(r, 'against 2024') && !r.slides.some(s => /against 20\d\d, month by month/.test(s.text)), 'no year before to compare with');
  assert.ok(has(r, 'Portfolio at risk by team, as the 2025 report closed it') && has(r, 'Total def'), 'PAR by team, as the year\'s report closed it');
  assert.ok(has(r, 'The books did not load with this export'), 'books that did not arrive are said, not dropped');
  assert.ok(has(r, 'Collection and PAR are the year\'s'), 'and the notes say so');
  assert.ok(r.slides.find(s => s.text.includes('Statistical snapshot')).text.includes('| Year |') || r.slides.find(s => s.text.includes('Statistical snapshot')).text.includes(' Year '), 'a finished year closes its table on "Year"');
});

test('a book section that cannot be read gets a slide that says why, and the others are still drawn', async () => {
  const t = withBooks(book());
  const d = await annual(t, 2026);
  const bk = await annualBook(t, 2026, { code: 'P', name: 'PAR ONLY', role: 'GMO', teams: null, tabs: ['annual', 'par'] });
  const r = await slidesOf(d, null, bk);
  assert.ok(has(r, 'Portfolio at risk: the book as at'), 'PAR was readable, so it is drawn');
  assert.ok(has(r, 'This section needs the Expected tab on this code') && has(r, 'This section needs the Legal tab on this code'), 'the two it could not read say which tab they need');
  assert.ok(!has(r, 'Legal: demand notices in'), 'and draw nothing from nothing');
  // no deck uploaded and no notices: said in plain words
  const bare = await annualBook(book(), 2026);
  const r2 = await slidesOf(d, null, bare);
  assert.ok(has(r2, 'No defaulter deck yet') && has(r2, 'No expected deck yet') && has(r2, 'No notices in 2026'), 'empty books are named as empty');
  // a year with no notices
  const r3 = await slidesOf(await annual(t, 2025), null, await annualBook(t, 2025));
  assert.ok(has(r3, 'No notices in 2025') && has(r3, 'The register holds no demand notice dated 2025'), 'another year\'s register is empty and says so');
});

test('a thin year does not break the deck: one team, one month, nothing to compare', async () => {
  const t = { teams: [{ team: 'ONLY', region: 'NORTH', gmo: 'G', credit: 'C' }],
    loans: [{ id: 'x1', team: 'ONLY', stage: 'approved', principal_amt: 5000000, loan_amt: 6800000, approved_date: '2026-07-10', track_no: '1' }],
    team_months: [], settings: [{ key: 'ANNUAL_HOLDERS_LOADED', value: 'test' }], access_codes: [], roles: [], pmo_adjustments: [], repayment_snapshots: [], defaulter_snapshots: [] };
  const d = await annual(t, 2026);
  const r = await slidesOf(d, null);
  assert.ok(r.slides.length >= 5 && r.slides.length <= 18, 'a short deck: ' + r.slides.length);
  assert.ok(has(r, '2026 at a glance') && has(r, 'Sales by month') && has(r, 'Statistical snapshot: the month'), 'the basics');
  for (const absent of ['Coverage across', 'Retention by region', 'Credit analysts', 'Collection by month', 'Recovery by month', 'Retention by team', 'against 2025']) assert.ok(!has(r, absent), absent + ' has nothing to say, so it is not drawn');
  assert.ok(r.slides[0].text.includes('July 2026'), 'a one-month span reads as that month');
});

test('a year with no month yet gives no deck, and the answer is never mutated', async () => {
  const ctx = deckCtx();
  assert.equal(ctx.anPptModel_({ year: 2027, months: [{ ym: '2027-01', state: 'future', teams: 0 }], totals: {}, teams: [] }, null), null);
  const d = await annual(book(), 2026);
  const before = JSON.stringify(d);
  await slidesOf(d, null);
  assert.equal(JSON.stringify(d), before, 'building a deck reads the answer and changes nothing');
});

test('the button: the tab loads the deck on the press, the page never loads it, and the files are all there', () => {
  const mod = readFileSync(join(ROOT, 'public/mod/annual.js'), 'utf8');
  const app = readFileSync(join(ROOT, 'public/app.html'), 'utf8');
  assert.ok(/onclick="anPptExport_\(this\)"[^>]*>Export deck \(PPT\)<\/button>/.test(mod), 'a button on the bar');
  assert.ok(/function anPptExport_\(btn\)\{\s*if \(window\.anPptRun_\) return anPptRun_\(btn\);/.test(mod) && /'\/deck\/annual-ppt\.js\?v=' \+ encodeURIComponent\(BUILD\)/.test(mod), 'the file is fetched on the first press, by BUILD');
  assert.ok(!/deck\/annual-ppt\.js|pptxgen\.bundle/.test(app), 'the portal page itself never names the deck or the library');
  const code = readFileSync(join(ROOT, 'public/deck/annual-ppt.js'), 'utf8');
  assert.ok(/'\/deck\/pptxgen\.bundle\.js'/.test(code) && /anPptImage_\('\/deck\/hope-title\.jpg'\)/.test(code) && /anPptImage_\('\/deck\/hope-logo\.png'\)/.test(code), 'the library and the two images, on the press');
  assert.ok(/srv\('annual', \{ year: String\(Number\(d\.year\) - 1\) \}\)/.test(code) && /srv\('annualBook', \{ year: String\(d\.year\) \}\)/.test(code), 'two asks on the press: the year before (only when it exists) and the books beside the year');
  assert.deepEqual([...new Set([...code.matchAll(/srv\('(\w+)'/g)].map(m => m[1]))].sort(), ['annual', 'annualBook'], 'and no other call');
  for (const f of ['pptxgen.bundle.js', 'hope-title.jpg', 'hope-logo.png', 'annual-ppt.js']) assert.ok(existsSync(join(ROOT, 'public/deck', f)), f + ' is served');
  assert.ok(statSync(join(ROOT, 'public/deck/hope-title.jpg')).size < 120000, 'the title picture is small');
  assert.ok(/PptxGenJS 3\.12\.0/.test(readFileSync(join(ROOT, 'public/deck/pptxgen.bundle.js'), 'utf8').slice(0, 200)), 'the vendored library says which version it is');
  assert.ok(!/sourceMappingURL/.test(readFileSync(join(ROOT, 'public/deck/pptxgen.bundle.js'), 'utf8').slice(-200)), 'no source-map request for a map that is not served');
});
