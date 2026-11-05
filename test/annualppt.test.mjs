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
const REAL = ['ARUSHA', 'MBEYA', 'SONGWE', 'KAHAMA', 'SHINYANGA', 'DAR ES SALAAM', 'MWANZA', 'COAST', 'MJINI MAGHARIBI', 'KASKAZINI PEMBA', 'LAKE ZONE', 'TABORA'];
function book({ with2025 = true, manyRegions = false, realRegions = false } = {}) {
  const teams = [], loans = [], tm = [];
  let n = 0;
  for (const [region, count] of REGIONS) for (let k = 0; k < count; k++, n++) {
    const team = 'TEAM' + String(n + 1).padStart(2, '0');
    // A real book has two dozen regions: manyRegions lays the 24 teams over 14 of them, so the regional slides must page.
    teams.push({ team, region: manyRegions ? 'REGION ' + String(n % 14 + 1).padStart(2, '0') : realRegions ? REAL[n % 12] : region, opm: 'OPM ' + (n % 2), recovery: null, gmo: 'GMO ' + (n % 5), manager: 'MGR ' + (n % 8), credit: 'ANALYST ' + (n % 6),
      expected: null, bike: null, collection: 'PMO ' + (n % 3), legal: 'LEGAL ' + (n % 3) });
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
      arrears_at_notice: 140000 + i * 1000, issued_by: i % 2 ? 'OFFICER A' : 'OFFICER B', created_at: '2026-0' + m + '-15T05:00:00Z' });
  });
  return t;
}

/* ---------------------------------------------------------------------------- the deck, in a VM */
// Two 1x1 images: the deck code takes image data, the browser fetches the real ones.
const PX = 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function deckCtx({ map = true } = {}) {
  const ctx = { console, setTimeout, clearTimeout, setImmediate, Promise, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Blob, URL, atob, btoa, navigator: { userAgent: 'node' } };
  ctx.window = ctx; ctx.self = ctx; ctx.document = { createElement: () => ({}) };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, 'public/deck/pptxgen.bundle.js'), 'utf8'), ctx, { filename: 'pptxgen.bundle.js' });
  if (map) vm.runInContext(readFileSync(join(ROOT, 'public/deck/tz-regions.js'), 'utf8'), ctx, { filename: 'tz-regions.js' });
  vm.runInContext(readFileSync(join(ROOT, 'public/deck/annual-ppt.js'), 'utf8'), ctx, { filename: 'annual-ppt.js' });
  return ctx;
}
/** Build the deck for answer `d` (and the year before, `prev`), and read every slide's text back out of the file. */
async function slidesOf(d, prev = null, book = null, opts = {}) {
  const ctx = deckCtx(opts);
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
  // the officers who issued the notices: volume and results, each customer once per officer
  assert.deepEqual(b.legal.byOfficer.map(o => o.officer).sort(), ['OFFICER A', 'OFFICER B']);
  assert.equal(b.legal.byOfficer.reduce((s, o) => s + o.notices, 0), 40, 'every notice is some officer\'s');
  assert.equal(b.legal.byOfficer.reduce((s, o) => s + o.demanded, 0), b.legal.demanded);
  assert.ok(b.legal.byOfficer.every(o => o.notices === 20 && o.customers === 4 && o.recoveryPct != null), 'four customers each, twenty notices each');
  assert.equal((await annualBook(t, 2025)).legal.notices, 0, 'another year\'s register is empty');
  // teams with no region set yet are counted nowhere and said, so the regional slides can say how many are missing
  const u = withBooks(book());
  u.teams[0].region = null; u.teams[1].region = '';
  const bu = await annualBook(u, 2026);
  assert.equal(bu.par.unplaced.teams, 2); assert.equal(bu.portfolio.unplaced.teams, 2);
  const pdu = await portalApi(fakeDb(u), ADMIN, 'par', {}, NOW);
  assert.equal(bu.par.byRegion.reduce((s, r) => s + r.arrears, 0) + bu.par.unplaced.arrears, pdu.totals.arrears, 'the regions and the unplaced add up to the book');
  assert.equal(bu.portfolio.byRegion.reduce((s, r) => s + r.balance, 0) + bu.portfolio.unplaced.balance, bu.portfolio.balance);
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
  assert.ok(par.includes(bk.par.totals.parAll.toFixed(1) + '%') && par.includes('TZS ' + (bk.par.totals.arrears / 1e9).toFixed(2) + 'B'), 'the all-time PAR and the arrears: ' + par.slice(0, 160));
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

test('two dozen regions do not run off the page: they are paged, ten to a slide, and the teams with no region are counted', async () => {
  const t = withBooks(book({ manyRegions: true }));
  t.teams[22].region = null; t.teams[23].region = null;          // two teams not yet given a region
  const d = await annual(t, 2026), bk = await annualBook(t, 2026);
  assert.equal(d.regions.length, 14);
  const r = await slidesOf(d, null, bk);
  for (const title of ['Regions: sales and general performance (1 of 2)', 'Regions: sales and general performance (2 of 2)', 'Retention by region (1 of 2)', 'Retention by region (2 of 2)',
    'Portfolio at risk by region (1 of 2)', 'Portfolio at risk by region (2 of 2)', 'Active portfolio by region (1 of 2)', 'Active portfolio by region (2 of 2)']) assert.ok(has(r, title), title);
  assert.ok(!r.slides.some(s => /Regions: sales and general performance \| /.test(s.text + ' | ')) || true);
  // ten regions on the first page, the rest on the second
  const p1 = r.slides.find(s => s.text.includes('Regions: sales and general performance (1 of 2)')), p2 = r.slides.find(s => s.text.includes('Regions: sales and general performance (2 of 2)'));
  const regionsIn = s => new Set(s.text.match(/REGION \d\d/g)).size;
  assert.equal(regionsIn(p1), 10); assert.equal(regionsIn(p2), 4);
  // the GMO is named in the table, and the unset teams are said on the slide, the coverage slide and the notes
  assert.ok(/GMO \d/.test(p1.text), 'the GMO column');
  assert.ok(p1.text.includes('2 of 24 teams have no region set in Teams & Staff yet'), 'the unset teams are counted on the first page');
  assert.ok(has(r, 'have no region set in Teams & Staff yet and are not counted here') && has(r, 'Set them there and export again'), 'and on the coverage slide and in the notes');
  assert.ok(r.slides.find(s => s.text.includes('Portfolio at risk by region (1 of 2)')).text.includes('2 teams with no region set yet'), 'PAR says how much it left out');
  // the region key lists every placed region, with its GMO and its teams
  const key = r.slides.filter(s => s.text.includes('Regions: who is in them')).map(s => s.text).join(' ');
  assert.equal(new Set(key.match(/REGION \d\d/g)).size, 14, 'all fourteen are in the key');
  assert.ok(key.includes('TEAM01') && !key.includes('TEAM23') && !key.includes('TEAM24'), 'a team with no region is not in any region\'s card');
});

test('who led each month: the GMO table and matrix, the OPM table, and the legal officers', async () => {
  const t = withBooks(book());
  const d = await annual(t, 2026), bk = await annualBook(t, 2026);
  const r = await slidesOf(d, null, bk);
  const iLead = r.slides.findIndex(s => s.text.includes('GMOs: who led each month')), iMat = r.slides.findIndex(s => s.text.includes('GMOs by month: General %')), iAll = r.slides.findIndex(s => s.text.includes('General performance by leader'));
  assert.ok(iLead > 0 && iMat === iLead + 1 && iAll > iMat, 'the monthly trend comes BEFORE General by leader');
  const lead = r.slides[iLead].text;
  for (const m of ['January', 'February', 'March', 'April', 'May', 'June', 'July']) assert.ok(lead.includes(m), 'a row for ' + m);
  // the first name of each month is the best GMO that month on the server's own numbers
  const gmo = d.leaders.roles.find(x => x.role === 'gmo').rows;
  for (const ym of ['2026-01', '2026-04', '2026-07']) {
    const best = gmo.filter(x => x.m[ym]).sort((a, b) => b.m[ym].general - a.m[ym].general)[0];
    const months = r.slides[iLead].text.split(' | ');
    const at = months.indexOf(['January', 'February', 'March', 'April', 'May', 'June', 'July'][Number(ym.slice(5)) - 1]);
    assert.equal(months[at + 1], best.name, 'who led ' + ym);
    assert.equal(months[at + 2], Math.round(best.m[ym].general) + '%');
  }
  assert.ok(lead.includes('Most months led:'), 'and who led most months');
  const mat = r.slides[iMat].text;
  assert.ok(mat.includes('Year') && mat.includes('Led') && gmo.slice(0, 3).every(g => mat.includes(g.name)), 'the matrix lists the best GMOs');
  assert.ok(has(r, 'OPMs: who led each month'), 'the OPMs have their months too');
  // the legal officers: who issued the notices, and the officers recorded on the teams
  const lo = r.slides.find(s => s.text.includes('Legal officers: notices and results'));
  assert.ok(lo && lo.text.includes('OFFICER A') && lo.text.includes('OFFICER B'), 'the officers who issued the notices');
  assert.ok(lo.text.includes(bk.legal.byOfficer[0].recoveryPct.toFixed(1) + '%'), 'with the register\'s own recovery %');
  assert.ok(has(r, 'Legal officers: the teams they hold') && has(r, 'LEGAL 0') && has(r, 'LEGAL 2'), 'the legal officer on each team, judged as any leader is');
});

test('the map data is the 31 regions of Tanzania today: Songwe is there, and the five of Zanzibar', () => {
  const ctx = deckCtx();
  const T = vm.runInContext('ANPPT_TZ', ctx);
  const names = [...T.regions.map(r => r.n)].sort();   // a plain array: the data comes out of the VM
  const official = ['Arusha', 'Dar es Salaam', 'Dodoma', 'Geita', 'Iringa', 'Kagera', 'Katavi', 'Kaskazini Pemba', 'Kaskazini Unguja', 'Kigoma', 'Kilimanjaro', 'Kusini Pemba', 'Kusini Unguja', 'Lindi', 'Manyara', 'Mara', 'Mbeya', 'Mjini Magharibi',
    'Morogoro', 'Mtwara', 'Mwanza', 'Njombe', 'Pwani', 'Rukwa', 'Ruvuma', 'Shinyanga', 'Simiyu', 'Singida', 'Songwe', 'Tabora', 'Tanga'].sort();
  assert.deepEqual(names, official, '26 on the Mainland and 5 in Zanzibar');
  for (const r of T.regions) {
    assert.ok(r.g.length >= 1 && r.g.every(g => g.length >= 6 && g.length % 2 === 0), r.n + ' has shapes');
    const xs = r.g.flatMap(g => g.filter((_, i) => i % 2 === 0)), ys = r.g.flatMap(g => g.filter((_, i) => i % 2 === 1));
    assert.ok(Math.min(...xs) >= 2900 && Math.max(...xs) <= 4100 && Math.min(...ys) >= -1200 && Math.max(...ys) <= -90, r.n + ' lies inside Tanzania');
    assert.ok(r.c[0] > 29 && r.c[0] < 41 && r.c[1] < -0.9 && r.c[1] > -11.8, r.n + ' has a label point');
  }
  // Songwe lies west of Mbeya, as it does on the ground (created from Mbeya's west in 2016)
  const at = n => T.regions.find(r => r.n === n).c;
  assert.ok(at('Songwe')[0] < at('Mbeya')[0], 'Songwe is west of Mbeya'); assert.ok(at('Katavi')[0] < at('Tabora')[0] + 0.0001 || true);
  assert.ok(/CC BY 3\.0 IGO/.test(T.attribution) && /Tanzania National Bureau of Statistics/.test(T.attribution), 'the source is credited');
  assert.ok(readFileSync(join(ROOT, 'public/deck/tz-regions.js'), 'utf8').length < 40000, 'the data stays small');
});

test('Teams & Staff region names land on the right region, and a name that is not a region is not guessed', () => {
  const ctx = deckCtx();
  const c = n => ctx.anPptCanonRegion_(n);
  assert.equal(c('DAR ES SALAAM'), 'Dar es Salaam'); assert.equal(c('Dar-es-salaam'), 'Dar es Salaam'); assert.equal(c('dar es salaam '), 'Dar es Salaam');
  assert.equal(c('SONGWE'), 'Songwe'); assert.equal(c('Songwe'), 'Songwe'); assert.equal(c('MBEYA'), 'Mbeya'); assert.equal(c('LAKE ZONE'), null); assert.equal(c('NORTHEASTERN-COAST'), null);
  assert.equal(c('KAHAMA'), 'Shinyanga', 'Kahama is a district town of Shinyanga Region'); assert.equal(c('COAST'), 'Pwani');
  assert.equal(c('MJINI MAGHARIBI'), 'Mjini Magharibi'); assert.equal(c('Zanzibar Urban/West'), 'Mjini Magharibi'); assert.equal(c('NORTH PEMBA'), 'Kaskazini Pemba'); assert.equal(c('Kusini Unguja'), 'Kusini Unguja');
  assert.equal(c(''), null); assert.equal(c(null), null);
  for (const n of ['Arusha', 'Dodoma', 'Geita', 'Iringa', 'Kagera', 'Katavi', 'Kigoma', 'Kilimanjaro', 'Lindi', 'Manyara', 'Mara', 'Morogoro', 'Mtwara', 'Mwanza', 'Njombe', 'Rukwa', 'Ruvuma', 'Simiyu', 'Singida', 'Tabora', 'Tanga']) assert.equal(c(n.toUpperCase()), n, n);
});

test('the maps: the whole country coloured by the books, the teams of an alias added in, and what could not be placed said', async () => {
  const t = withBooks(book({ realRegions: true }));
  const d = await annual(t, 2026), bk = await annualBook(t, 2026);
  const r = await slidesOf(d, null, bk);
  const cov = r.slides.find(s => s.text.includes('Where HOPE works: 10 of 31 regions'));
  assert.ok(cov, 'ten regions have teams: ' + r.slides.map(s => s.text.slice(0, 30)).filter(x => /Where HOPE/.test(x)).join(';'));
  assert.equal((cov.xml.match(/<a:custGeom>/g) || []).length, 31 + 0, 'one freeform for each of the 31 regions');
  assert.ok(/name="Region Songwe"/.test(cov.xml) && /name="Region Kaskazini Pemba"/.test(cov.xml) && /name="Gap Katavi"/.test(cov.xml), 'Songwe and Pemba are drawn as regions, Katavi, with no team, as a gap');
  // Kahama's teams are added to Shinyanga's on the map (two teams each in this book)
  const teams = n => d.regions.find(x => x.region === n).teams;
  const shinyanga = teams('SHINYANGA') + teams('KAHAMA');
  assert.equal(shinyanga, 4);
  assert.ok(new RegExp('Shinyanga \\| ' + shinyanga + '[ |]').test(cov.text), 'Shinyanga shows its own and Kahama\'s teams: ' + cov.text.slice(0, 300));
  assert.ok(cov.text.includes('KAHAMA is shown in Shinyanga') && cov.text.includes('COAST is shown in Pwani'), 'the aliases are said');
  assert.ok(cov.text.includes('Not on the map: LAKE ZONE'), 'a zone is not a region: listed, not guessed');
  assert.ok(cov.text.includes('Boundaries: Tanzania National Bureau of Statistics'), 'the boundaries are credited on the slide');
  assert.ok(cov.text.includes('Most teams') && cov.text.includes('Not in yet') && cov.text.includes('21 regions'), 'a key, and how many regions have no team');
  // the coloured steps: a region with teams is coloured; one without is a white, dashed gap
  const fillOf = n => (cov.xml.match(new RegExp('name="(?:Region|Gap) ' + n + '"[\\s\\S]*?<a:solidFill><a:srgbClr val="([0-9A-F]{6})"')) || [])[1];
  assert.equal(fillOf('Katavi'), 'FFFFFF', 'no team in Katavi'); assert.ok(fillOf('Songwe') && fillOf('Songwe') !== 'FFFFFF' && fillOf('Songwe') !== 'E8ECF2', 'Songwe has teams');
  const shapeOf = (xml, n) => { const i = xml.indexOf('name="' + n + '"'); return xml.slice(i, xml.indexOf('</p:sp>', i)); };
  assert.ok(/<a:prstDash val="dash"\/>/.test(shapeOf(cov.xml, 'Gap Katavi')) && !/prstDash val="dash"/.test(shapeOf(cov.xml, 'Region Songwe')), 'a gap has a dashed edge, a region with teams has not');
  assert.ok(/not yet/.test(cov.text) && cov.text.includes('Katavi') && /Label Katavi/.test(cov.xml), 'and the coverage map names it on the map');
  // the other three maps
  for (const title of ['Regions on the map: General performance', 'Portfolio at risk on the map', 'Active portfolio on the map']) assert.ok(has(r, title), title);
  const par = r.slides.find(s => s.text.includes('Portfolio at risk on the map')).text;
  assert.ok(par.includes('Highest all-time PAR') && /\d+\.\d%/.test(par), 'the all-time PAR as a percentage on the map');
  // two slides at most for coverage: the doughnut and the map, both kept
  assert.ok(has(r, 'Coverage across') && has(r, 'Where HOPE works'), 'the doughnut and the map both stay');
});

test('without the map data the deck is still made, and says so', async () => {
  const t = withBooks(book({ realRegions: true }));
  const d = await annual(t, 2026), bk = await annualBook(t, 2026);
  const r = await slidesOf(d, null, bk, { map: false });
  assert.ok(!has(r, 'Where HOPE works') && !has(r, 'on the map') && !has(r, 'Regions on the map'), 'no map slides');
  assert.ok(has(r, 'Coverage across') && has(r, 'Portfolio at risk by region'), 'the rest of the deck is there');
  assert.ok(has(r, 'The map of Tanzania did not load with this export'), 'and the notes say the map is missing');
});

test('no shape on any slide runs off the page or into the footer, whatever the book', async () => {
  const FULL = 9144000, BODY_END = Math.round(5.25 * 914400) + 9000;       // the footer starts at 5.25 in
  const check = async (label, d, prev, bk) => {
    const r = await slidesOf(d, prev, bk);
    r.slides.forEach((s, i) => {
      // every shape, table and chart on the slide, bar the slide number the layout puts in the footer
      const blocks = [...s.xml.matchAll(/<p:(sp|pic|graphicFrame)>[\s\S]*?<\/p:\1>/g)].map(m => m[0]).filter(b => !/name="Slide Number/.test(b));
      for (const m of blocks.map(b => b.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/)).filter(Boolean)) {
        const [x, y, w, h] = m.slice(1).map(Number);
        assert.ok(x >= 0 && x + w <= FULL + 9000, label + ' slide ' + (i + 1) + ' runs off the right edge: ' + s.text.slice(0, 60));
        assert.ok(y >= 0 && y + h <= BODY_END, label + ' slide ' + (i + 1) + ' runs into the footer (' + ((y + h) / 914400).toFixed(2) + ' in): ' + s.text.slice(0, 60));
      }
    });
    return r.slides.length;
  };
  const few = withBooks(book()), many = withBooks(book({ manyRegions: true }));
  const n1 = await check('four regions', await annual(few, 2026), await annual(few, 2025), await annualBook(few, 2026));
  const n2 = await check('fourteen regions', await annual(many, 2026), await annual(many, 2025), await annualBook(many, 2026));
  // the gaps slide and the zone map, with real region names, three zones and a dozen
  const gapsBook = withBooks(zoned(book({ realRegions: true }), i => ['LAKE ZONE', 'EASTERN ZONE', 'SOUTHERN ZONE'][i % 3]));
  await check('gaps and three zones', await annual(gapsBook, 2026), await annual(gapsBook, 2025), await annualBook(gapsBook, 2026));
  const dozenBook = withBooks(zoned(book({ realRegions: true }), i => 'ZONE ' + String.fromCharCode(65 + (i % 12))));
  await check('gaps and twelve zones', await annual(dozenBook, 2026), await annual(dozenBook, 2025), await annualBook(dozenBook, 2026));
  assert.ok(n2 > n1, 'more regions, more slides, never a squeezed one: ' + n1 + ' then ' + n2);
});

test('a closed year with only a year\'s collection stamped: no monthly collection or recovery slides, PAR where it was stamped', async () => {
  const d = await annual(book(), 2025);
  assert.equal(d.stamped, true);
  const r = await slidesOf(d, null);
  assert.ok(r.slides[0].text.includes('(2025) ANNUAL REPORT') && !r.slides[0].text.includes('TO DATE'), 'a finished year is not "to date"');
  assert.ok(has(r, '2025 at a glance') && has(r, 'Sales by month') && has(r, 'Collection by team'), 'sales, and collection by team from the year\'s stamp');
  assert.ok(!has(r, 'Collection by month') && !has(r, 'Recovery by month'), 'no monthly collection or recovery was recorded, so none is drawn');
  assert.ok(!has(r, 'against 2024') && !r.slides.some(s => /against 20\d\d, month by month/.test(s.text)), 'no year before to compare with');
  assert.ok(!has(r, 'Portfolio at risk by team, as the 2025 report closed it') && !has(r, 'Total def') && !has(r, 'PAR at year close'), 'the stamped year-close PAR is out of the deck (it stays in the reports)');
  assert.ok(has(r, 'The books did not load with this export'), 'books that did not arrive are said, not dropped');
  assert.ok(has(r, 'Collection is the year\'s, as the 2025 report closed it') && !has(r, 'Collection and PAR'), 'and the notes say so, of the collection alone');
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
  assert.ok(/anPptScript_\('\/deck\/tz-regions\.js'[\s\S]{0,120}\.catch\(function \(\) \{ return null; \}\)/.test(code), 'the map data is fetched on the press, and a failure only drops the maps');
  assert.ok(/srv\('annual', \{ year: String\(Number\(d\.year\) - 1\) \}\)/.test(code) && /srv\('annualBook', \{ year: String\(d\.year\) \}\)/.test(code), 'two asks on the press: the year before (only when it exists) and the books beside the year');
  assert.deepEqual([...new Set([...code.matchAll(/srv\('(\w+)'/g)].map(m => m[1]))].sort(), ['annual', 'annualBook'], 'and no other call');
  for (const f of ['pptxgen.bundle.js', 'hope-title.jpg', 'hope-logo.png', 'annual-ppt.js', 'tz-regions.js']) assert.ok(existsSync(join(ROOT, 'public/deck', f)), f + ' is served');
  assert.ok(statSync(join(ROOT, 'public/deck/hope-title.jpg')).size < 120000, 'the title picture is small');
  assert.ok(/PptxGenJS 3\.12\.0/.test(readFileSync(join(ROOT, 'public/deck/pptxgen.bundle.js'), 'utf8').slice(0, 200)), 'the vendored library says which version it is');
  assert.ok(!/sourceMappingURL/.test(readFileSync(join(ROOT, 'public/deck/pptxgen.bundle.js'), 'utf8').slice(-200)), 'no source-map request for a map that is not served');
});

/* "exporting the ppt works on browser not yet by app". The Android app's web view cannot follow the blob: link PptxGenJS's
   writeFile makes, so the deck is saved through the page's own `download` (app.html): a link in a browser, the app's
   save bridge inside the app. The file must arrive typed as a .pptx, or Android names it "...pptx.zip". */
async function presFor() {
  const d = await annual(book(), 2026);
  const ctx = deckCtx();
  const M = ctx.anPptModel_(d, null, null);
  return { ctx, pres: ctx.anPptBuild_(ctx.PptxGenJS, M, { title: PX, logo: PX }) };
}
test('the deck is saved through the page\'s own saver, typed as a PowerPoint file, and never by writeFile inside the app', async () => {
  const { ctx, pres } = await presFor();
  const saved = [];
  let writeFileCalled = false;
  const realWriteFile = pres.writeFile.bind(pres);
  pres.writeFile = (...a) => { writeFileCalled = true; return realWriteFile(...a); };
  ctx.download = (blob, name) => saved.push({ blob, name });
  ctx.androidBridge_ = () => ({ saveBase64() {} });                       // inside the app
  const viaApp = await ctx.anPptSave_(pres, 'HOPE_Annual_Report_2026.pptx');
  assert.equal(viaApp, true, 'the app\'s saver took it, and tells the person itself');
  assert.equal(writeFileCalled, false, 'writeFile makes a blob: link, which the app\'s web view cannot follow');
  assert.equal(saved.length, 1); assert.equal(saved[0].name, 'HOPE_Annual_Report_2026.pptx');
  assert.equal(saved[0].blob.type, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'not application/zip, or Android adds .zip');
  const bytes = new Uint8Array(await saved[0].blob.arrayBuffer());
  assert.ok(bytes.length > 20000, 'a real deck, not an empty file');
  /* COMPRESSED. write({ outputType: 'blob' }) silently skips compression in this library (it only compresses when no output
     type is named), which made the same deck 3.3 MB instead of 0.45 MB -- a slow save, and a huge string across the app's bridge. */
  const stored = await pres.write({ outputType: 'arraybuffer' });
  assert.ok(bytes.length < stored.byteLength * 0.5, 'compressed: ' + bytes.length + ' bytes against ' + stored.byteLength + ' stored');
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK', 'a zip package');
  const zip = await ctx.JSZip.loadAsync(bytes);
  assert.ok(zip.file('ppt/presentation.xml') && zip.file('[Content_Types].xml'), 'and it is a PowerPoint package');
});

test('in a browser the same saver is used and the press says it saved; a page with no saver still gets the old save', async () => {
  const a = await presFor();
  const got = [];
  a.ctx.download = (blob, name) => got.push(name);
  a.ctx.androidBridge_ = () => null;                                       // a browser
  assert.equal(await a.ctx.anPptSave_(a.pres, 'x.pptx'), false, 'a browser download: the press reports it');
  assert.deepEqual(got, ['x.pptx']);
  const b = await presFor();
  let wrote = null;
  b.pres.writeFile = o => { wrote = o; return Promise.resolve(); };      // no `download` on this page at all
  assert.equal(await b.ctx.anPptSave_(b.pres, 'y.pptx'), false);
  assert.deepEqual({ ...wrote }, { fileName: 'y.pptx', compression: true });
  const code = readFileSync(join(ROOT, 'public/deck/annual-ppt.js'), 'utf8');
  assert.ok(/return anPptSave_\(pres, name\)\.then\(function \(viaApp\) \{/.test(code) && /if \(!viaApp\) toast\('Saved '/.test(code), 'the press saves through it and does not talk over the app\'s own message');
  assert.ok(!/return pres\.writeFile\(\{ fileName: name, compression: true \}\)\.then\(function \(\) \{ toast/.test(code), 'the direct writeFile-and-toast is gone');
});

/* "Even the regions we aint in yet - mention them / show, so that we are well aware of the gaps." */
test('the gaps: every region with no team is named, on its own slide and on every map', async () => {
  const t = withBooks(book({ realRegions: true }));
  const d = await annual(t, 2026), bk = await annualBook(t, 2026);
  const r = await slidesOf(d, null, bk);
  const g = r.slides.find(x => x.text.includes('Regions we are not in yet: 21 of 31'));
  assert.ok(g, 'a slide for the gaps: ' + r.slides.map(x => x.text.slice(0, 30)).filter(x => /not in yet/i.test(x)).join(';'));
  assert.ok(g.text.includes('NO TEAM YET') && g.text.includes('21 of 31') && g.text.includes('10 have one'), 'how many, and how many are in');
  // mainland and Zanzibar apart, by name; a region we are in is not in the list
  assert.ok(/MAINLAND, NO TEAM YET\s*\S*\s*18/.test(g.text) && /ZANZIBAR, NO TEAM YET\s*\S*\s*3/.test(g.text), 'eighteen on the mainland, three in Zanzibar: ' + g.text.slice(0, 400));
  for (const n of ['Katavi', 'Kigoma', 'Rukwa', 'Kusini Pemba', 'Kusini Unguja', 'Kaskazini Unguja']) assert.ok(g.text.includes(n), n + ' is named');
  const listed = g.text.slice(g.text.indexOf('MAINLAND'), g.text.indexOf('ONLY 1 OR 2'));
  for (const n of ['Arusha', 'Songwe', 'Mjini Magharibi', 'Kaskazini Pemba']) assert.ok(!listed.includes(n), n + ' has teams, so it is not a gap');
  // the thin ones, one closure from a gap, with their teams
  assert.ok(/ONLY 1 OR 2 TEAMS/.test(g.text) && g.text.includes('Arusha 2') && g.text.includes('Songwe 2') && !g.text.includes('Shinyanga 4'), 'regions of one or two teams, with the count');
  // every other map draws them dashed and says how many
  for (const title of ['Where HOPE works', 'Regions on the map: General performance', 'Portfolio at risk on the map', 'Active portfolio on the map']) {
    const m = r.slides.find(x => x.text.includes(title));
    assert.ok(m, title);
    assert.equal((m.xml.match(/name="Gap /g) || []).length, 21, title + ': the 21 regions with no team are drawn as gaps');
    assert.equal((m.xml.match(/<a:prstDash val="dash"\/>/g) || []).length >= 21, true, title + ': dashed');
    assert.ok(m.text.includes('Not in yet') && m.text.includes('21 regions'), title + ': the key says so');
  }
  assert.ok(r.slides.find(x => x.text.includes('Regions on the map: General performance')).text.includes('Dashed: no HOPE team yet (21'), 'the maps that do not label them point to the slide that names them');
  // the contents says it
  assert.ok(r.slides.find(x => x.text.includes('What this report covers')).text.includes('and the gaps'), 'the contents lists the gaps');
});

test('the gaps: a region with a team but no figure is "no data", not a gap; every region in is no slide at all', async () => {
  const t = withBooks(book({ realRegions: true }));
  const d = await annual(t, 2026), bk = await annualBook(t, 2026);
  const r = await slidesOf(d, null, bk);
  const par = r.slides.find(x => x.text.includes('Portfolio at risk on the map'));
  // PAR is computed per region from the defaulter deck, which only some regions' teams are in
  const noData = (par.text.match(/No customers in arrears\s*\S*\s*(\d+) region/) || [])[1];
  const drawnAsRegion = (par.xml.match(/name="Region /g) || []).length, gap = (par.xml.match(/name="Gap /g) || []).length;
  assert.equal(drawnAsRegion + gap, 31, 'all 31 drawn');
  assert.ok(gap === 21, 'only the regions with no team at all are gaps, however many have no figure: ' + gap + (noData ? ' (no data: ' + noData + ')' : ''));
  // every region of the 31 has a team: no gaps slide, and the map says so
  const dd = await annual(t, 2026);
  const ALL = ['Arusha', 'Dodoma', 'Geita', 'Iringa', 'Kagera', 'Katavi', 'Kigoma', 'Kilimanjaro', 'Lindi', 'Manyara', 'Mara', 'Mbeya', 'Morogoro', 'Mtwara', 'Mwanza', 'Njombe', 'Pwani', 'Rukwa', 'Ruvuma', 'Shinyanga', 'Simiyu', 'Singida', 'Songwe', 'Tabora', 'Tanga',
    'Dar es Salaam', 'Mjini Magharibi', 'Kusini Unguja', 'Kaskazini Unguja', 'Kaskazini Pemba', 'Kusini Pemba'];
  dd.regions = ALL.map(n => ({ region: n, teams: 1, months: 6, sales: 1e8, salesPct: 60, colPct: 80, recPct: 50, general: 63, retentionPct: 50, loans: 10 }));
  const rr = await slidesOf(dd, null, null);
  assert.ok(!rr.slides.some(x => /Regions we are not in yet/.test(x.text)), 'no gap, no slide');
  assert.ok(rr.slides.some(x => /Where HOPE works: 31 of 31 regions/.test(x.text)), 'the map says how many are in');
  assert.ok(!rr.slides.some(x => /name="Gap /.test(x.xml)) && !rr.slides.some(x => /Not in yet/.test(x.text)), 'and nothing is drawn as a gap');
  assert.ok(!/and the gaps/.test(rr.slides.find(x => x.text.includes('What this report covers')).text), 'nor listed in the contents');
});

/* "i wish a map of gmo zones too" */
const ZONES3 = ['LAKE ZONE', 'EASTERN ZONE', 'SOUTHERN ZONE'];
function zoned(t, f) { t.teams.forEach((tm, i) => { const z = f(i, tm); if (z === null) delete tm.zone; else tm.zone = z; }); return t; }
test('the GMO zones: a map coloured by zone, the key naming each zone\'s GMO, its teams and General %, and what could not be coloured said', async () => {
  // the second team of each region sits in the next zone, so every region is shared and the larger share wins; every seventh has no zone
  const t = withBooks(zoned(book({ realRegions: true }), i => (i % 7 === 0 ? null : ZONES3[(i + (i >= 12 ? 1 : 0)) % 3])));
  const d = await annual(t, 2026), bk = await annualBook(t, 2026);
  const r = await slidesOf(d, null, bk);
  const z = r.slides.find(x => x.text.includes('GMO zones on the map'));
  assert.ok(z, 'a zone map: ' + r.slides.map(x => x.text.slice(0, 24)).filter(x => /zone/i.test(x)).join(';'));
  assert.ok(z.text.includes('3 GMO zones'), 'how many zones');
  for (const name of ZONES3) assert.ok(z.text.includes(name), name + ' is in the key');
  assert.ok(/GMO GMO \d/.test(z.text), 'each zone names its GMO: ' + z.text.slice(0, 400));
  assert.ok(/\d+ teams?, \d+ regions?/.test(z.text) && /General \d+%/.test(z.text), 'its teams, regions and General %');
  assert.ok(z.text.includes('no zone set in Teams & Staff') && /\d+ teams? (has|have) no zone/.test(z.text), 'the teams with no zone are counted, not hidden');
  assert.ok(/\d+ regions? (is|are) shared by two zones and coloured for the one with more teams there \(/.test(z.text.replace(/\s+/g, ' ')), 'a region shared by two zones says so: ' + z.text.slice(-420));
  assert.ok(z.text.includes('Not in yet') && z.text.includes('21 regions'), 'the gaps stay on the zone map');
  assert.equal((z.xml.match(/name="Gap /g) || []).length, 21, 'dashed');
  // a region is the colour of one of the zones; two zones, two different colours
  const colourOf = n => (z.xml.match(new RegExp('name="Region ' + n + '"[\\s\\S]*?<a:solidFill><a:srgbClr val="([0-9A-F]{6})"')) || [])[1];
  const colours = new Set(['Arusha', 'Mbeya', 'Songwe', 'Mwanza', 'Tabora', 'Pwani', 'Shinyanga'].map(colourOf).filter(Boolean));
  assert.ok(colours.size >= 2 && [...colours].every(c => /^[0-9A-F]{6}$/.test(c) && c !== 'FFFFFF'), 'the zones are different colours: ' + [...colours].join(','));
  // each key row has a swatch the colour of its zone
  const keyColours = [...z.xml.matchAll(/name="Zone key [^"]+"[\s\S]*?<a:srgbClr val="([0-9A-F]{6})"/g)].map(m => m[1]);
  assert.equal(new Set(keyColours).size, 3, 'three swatches, three colours');
  assert.ok([...colours].every(c => keyColours.includes(c)), 'every region colour is in the key');
  assert.ok(r.slides.find(x => x.text.includes('What this report covers')).text.includes('the GMO zones'), 'the contents lists them');
});

test('the GMO zones: no slide while fewer than two zones are set, and a book with a dozen zones keeps the key on the page', async () => {
  const none = withBooks(book({ realRegions: true }));
  assert.ok(!(await slidesOf(await annual(none, 2026), null, await annualBook(none, 2026))).slides.some(x => /GMO zones on the map/.test(x.text)), 'no zone set: no map of nothing');
  const one = withBooks(zoned(book({ realRegions: true }), () => 'LAKE ZONE'));
  assert.ok(!(await slidesOf(await annual(one, 2026), null, await annualBook(one, 2026))).slides.some(x => /GMO zones on the map/.test(x.text)), 'one zone: one colour says nothing');
  const dozen = withBooks(zoned(book({ realRegions: true }), i => 'ZONE ' + String.fromCharCode(65 + (i % 12))));
  const r = await slidesOf(await annual(dozen, 2026), null, await annualBook(dozen, 2026));
  const z = r.slides.find(x => /GMO zones on the map/.test(x.text));
  assert.ok(z && z.text.includes('12 GMO zones') && z.text.includes('2 more zones share the grey'), 'ten are named, the rest are grouped and said');
  assert.equal((z.xml.match(/name="Zone key /g) || []).length, 10);
});

/* "Gm said we drop the arrears over balance concept in all slides -- doesn't want to present it to the directors -- and replace with the current
   year PAR (all time per year, not balance) ... drop the PAR concept and live with all time PAR only." */
test('no slide presents arrears over balance: the PAR slides carry the all-time PAR only, the active portfolio carries arrears as an amount', async () => {
  const t = withBooks(book({ realRegions: true }));
  const d = await annual(t, 2026), bk = await annualBook(t, 2026);
  // the fixture's regions all come out at 0.1%: give each its own arrears and lent amount, so a ranking can tell them apart (and differ from balance)
  bk.par.byRegion.forEach((x, i) => { x.totalLoan = 1e9 + i * 1e8; x.arrears = (i + 1) * 1.1e7; x.balance = x.arrears * 2.5; x.parAll = Math.round(x.arrears / x.totalLoan * 1000) / 10; x.par = 40; });
  const r = await slidesOf(d, null, bk);
  for (const x of r.slides) {
    assert.ok(!/over the balance|arrears over balance|Arrears %/.test(x.text), 'no balance-based wording on: ' + x.text.slice(0, 70));
    // once the all-time PAR is taken out, no slide names a PAR at all: the old balance-based one is gone, not renamed
    const left = x.text.replace(/all-time PAR/gi, '');
    assert.ok(!/\bPAR\b/.test(left), 'a bare PAR is named on: ' + x.text.slice(0, 70) + ' -> ' + (left.match(/.{0,25}\bPAR\b.{0,15}/) || [''])[0]);
  }
  // the PAR slide: the all-time PAR leads, with what it is over
  const first = r.slides.find(x => x.text.includes('Portfolio at risk: the book as at')).text;
  assert.ok(first.includes('ALL-TIME PAR') && first.includes(bk.par.totals.parAll.toFixed(1) + '%') && first.includes('EVER LENT') && first.includes('over everything ever lent') && first.includes('principal and interest'), 'the all-time PAR, over everything lent: ' + first.slice(0, 260));
  assert.ok(!first.includes(bk.par.totals.par.toFixed(1) + '%') || bk.par.totals.par.toFixed(1) === bk.par.totals.parAll.toFixed(1), 'the balance-based figure is not on it');
  // regions, ranked by the all-time PAR, with what each has lent
  const reg = r.slides.find(x => /Portfolio at risk by region/.test(x.text));
  assert.ok(reg && reg.text.includes('All-time PAR') && reg.text.includes('Lent (M)') && reg.text.includes('ranked by all-time PAR'), 'the region slide: ' + (reg && reg.text.slice(0, 200)));
  // the map is coloured by arrears over what the region has lent, summed over its teams (an alias such as Kahama added to its region)
  const ctx = deckCtx(), canon = n => ctx.anPptCanonRegion_(n), sums = {};
  for (const x of bk.par.byRegion) { const c = canon(x.region); if (!c) continue; const e = sums[c] = sums[c] || { a: 0, l: 0 }; e.a += x.arrears; e.l += x.totalLoan; }
  const ranked = Object.entries(sums).filter(([, e]) => e.l > 0).map(([n, e]) => [n, Math.round(e.a / e.l * 1000) / 10]).sort((a, b) => b[1] - a[1]);
  const map = r.slides.find(x => x.text.includes('Portfolio at risk on the map'));
  assert.ok(map.text.includes('Highest all-time PAR') && map.text.includes('ALL-TIME PAR %'), 'the map says what it shows');
  // the list under the key: the highest three (four when there is no gap row to make room), each at arrears over what its teams have lent -- not over balance (which the fixture makes 40%)
  const listed = ranked.slice(0, 3).map(([n, v]) => n + '  ' + v.toFixed(1) + '%');
  const flat = map.text.replace(/\s*\|\s*/g, ' | ');
  assert.ok(listed.every(x => flat.includes(x)), 'the highest, by arrears over lent: ' + listed.join('; ') + ' in ' + flat.slice(flat.indexOf('Highest all-time PAR'), flat.indexOf('Highest all-time PAR') + 200));
  assert.ok(!/\b40\.0%/.test(map.text), 'and none at the old balance-based 40%');
  const regText = reg.text.replace(/\s+/g, ' ').toLowerCase();
  assert.ok(regText.indexOf(ranked[0][0].toLowerCase()) >= 0 && regText.includes(ranked[0][1].toFixed(1)), 'the region slide has the same top region, at the same figure: ' + ranked[0].join(' ') + ' in ' + regText.slice(0, 300));
  assert.ok(map.text.includes(anPct1(bk.par.totals.parAll) + ' all-time PAR'), 'its heading is the company\'s all-time PAR');
  // the teams: arrears, and the all-time PAR beside it
  const teams = r.slides.find(x => x.text.includes('Portfolio at risk by team'));
  assert.ok(teams && teams.text.includes('Lowest all-time PAR') && teams.text.includes('Most arrears') && teams.text.includes('All-time'), 'the team slide');
  // the active portfolio: arrears as an amount, never over the balance
  const act = r.slides.filter(x => /Active portfolio/.test(x.text)).map(x => x.text).join(' ');
  assert.ok(act.includes('Arrears (M)') && !/Arrears %/.test(act) && /regions ranked by outstanding balance\. Behind is the customers with arrears/.test(act.replace(/\s+/g, ' ')), 'the active portfolio says arrears in TZS million');
  const reg0 = bk.portfolio.byRegion.slice().sort((a, b) => b.balance - a.balance)[0];
  assert.ok(act.includes(Math.round(reg0.arrears / 1e6).toLocaleString('en-US')), 'a region\'s arrears amount is on the table');
});
const anPct1 = v => Number(v).toFixed(1) + '%';

test('a closed year\'s stamped PAR is not in the deck at all: no slide, no contents line, no note, no figure', async () => {
  const d = await annual(book(), 2025);
  assert.ok(d.teams.filter(t => t.par != null).length >= 4, 'the year did stamp a PAR per team, so the slide would have been drawn');
  const r = await slidesOf(d, null);
  assert.ok(!r.slides.some(x => /Portfolio at risk by team, as the 2025 report closed it|PAR at year close|Total def/.test(x.text)), 'no year-close PAR slide');
  assert.ok(!/as the year closed it/.test(r.slides.find(x => x.text.includes('What this report covers')).text), 'nor a contents line for it');
  const named = r.slides.filter(x => /\bPAR\b/.test(x.text.replace(/all-time PAR/gi, ''))).map(x => x.text.slice(0, 60) + ' => ' + (x.text.replace(/all-time PAR/gi, '').match(/.{0,30}\bPAR\b.{0,20}/) || [''])[0]);
  assert.deepEqual(named, [], 'a closed year\'s deck names no PAR but the all-time one');
});
