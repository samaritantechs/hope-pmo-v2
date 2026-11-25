/* THE TWO COLLECTION SLIDES OF THE PRESENTATION, WITH THEIR SHORT COUNT COLUMNS AND CC%: Early collection (the next list, "kesho") and PMO Collection
   (today's sheet, "leo"). The REAL public/app.html and public/mod/present.js in a real browser; the officer boards' answer is served from this file
   (the officers and the figures are made up; the server's side is held by test/portal.test.mjs through the real dispatch).

     "Add Tt Count (total count) column after count 1 column just rename the columns into C1 LEO and TC LEO, for space purposes so that i see right
      away its count 1s among which total in the expected collection of today officers today as that of early col does"
     "having the columns short in both early and today col slides, we can add CC% (Count collection) to see percentage of paid customers (paid among total)"
                                                                                  -- the owner, 25 Nov 2026 (handbook Part 164, addendum 4)

   What it proves, at the sizes a TV and a laptop really are (3840x2160, 1920x1080, 1366x768, 1280x720, 1024x768):

     1. today's slide reads  PMO | Teams | C1 LEO | TC LEO | CC% LEO | J3 | J4 | J5 | AL | IJ | Uncollected (week) | Coll % (week), and the early slide
        reads  Officer | Teams | Wamebaki / Left | C1 KESHO | TC KESHO | CC% KESHO | Uncollected (kesho) | Coll % (kesho) | Uncollected (week) | Coll % (week):
        the long names ("Count 1 (NC 1 leo)", "Count 1 (NC 1)", "Wateja / Customers") are gone;
     2. each officer's row prints what the server sent (a count is a count, a CC% in whole numbers, a dash where it cannot be measured), and the JUMLA
        row adds the two counts up and works CC% out again from the totals' own two parts -- paid among the total, NEVER the average of the officers'
        percentages (the figures below are chosen so that the two differ);
     3. nothing is cut at any of the five sizes: the table stays inside its box (no sideways scroll), the slide does not scroll, the caption is under
        the table whole, and the short headers are never broken in the middle of a word;
     4. the caption says what the short names are, on both slides;
     5. no page error in any world.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-present-collection-columns.mjs

   CHROME overrides the browser path; APP_FILE and MOD_DIR run it against another copy of the page and of the modules (the code as it stood before
   this change shows what the check is for); SHOTS=<dir> saves pictures. Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
const APP = fs.readFileSync(process.env.APP_FILE || path.join(ROOT, 'public/app.html'), 'utf8');
const MOD_DIR = process.env.MOD_DIR || path.join(ROOT, 'public/mod');

/* THE DASHBOARD'S ANSWER: only what the first slide of the deck needs so that the deck builds. */
const DASH = () => ({ ok: true, weekday: 'WED', weekOf: '2026-11-23', weekEnd: '2026-11-29', pastWeek: false, asOfDate: '2026-11-25',
  cards: { curArrears: 3412547121, initArrears: 23760795812, recovered: 1234567890, defaulters: 10372, cleared: 4321, salesWeek: 987654321, uncollectedToday: 456789012, abnormal: 37 },
  perf: { salesPct: 84.4, ecolPct: 91.2, colPct: 96.7, recPct: 118.4, avgPct: 99.8, appsCount: 486, appsAmount: 1234000000 },
  recTrendTotal: { recovered: 94338048 }, edrTrendTotal: { recovered: 3600000, pct: 3 }, edrTrend: [{ weekday: 'MON', uploaded: true, recovered: 1800000 }],
  legal: { grand: { on: true, total: { owed: 52000000, recovered: 41000000, pct: 78.8 } } },
  teamPerf: [{ branch: 'DAR', team: 'KONGOWE', salesMonth: 1000, curArrears: 5000, defaulters: 3, uncollected: 100, collPct: 90, recPctMon: 80, recPctYest: 70, recPctWeek: 60, basis: 'today' }],
  colTrend: [], salesTrend: [], workspace: 'hopepmo' });

/* THE OFFICERS. Eight on each slide, long names among them (the slide is read from the back of a room, and a name that wraps is a taller row).
   Today's slide: C1 LEO, TC LEO and the paid count (CC% LEO is paid among TC LEO); one officer's Count 1 is unknown (null: a sheet uploaded before
   N.C existed), and one officer has nobody on the list today (TC LEO 0: CC% is a dash, never "0%"). */
const days = (k, p) => ({ ['pct' + k]: p, ['col' + k]: p == null ? 0 : p * 100000, ['exp' + k]: p == null ? 0 : 10000000 });
const pmoRow = (sn, officer, teams, count1, customers, paidOver, extra = {}) => ({
  sn, officer, teams, count1, customers, paidOver, ccPct: customers > 0 ? Math.round(paidOver / customers * 1000) / 10 : null,
  uncollected: 1200000 * sn, pct: 80 - sn, ...days('J3', 91), ...days('J4', 88), ...days('J5', 90), ...days('AL', 93), ...days('IJ', null),
  weekUncollected: 5400000 * sn, weekPct: 86 - sn, weekCollected: 40000000, weekExpected: 50000000, ...extra });
const PMO_ROWS = [
  pmoRow(1, 'PMO ALPHA ONE', 31, 24, 410, 330),
  pmoRow(2, 'PMO BRAVO TWO LONGER NAME', 12, 9, 150, 90),
  pmoRow(3, 'PMO CHARLIE', 7, 15, 88, 79),
  pmoRow(4, 'PMO DELTA FOUR', 9, null, 120, 40),            // Count 1 not known (an older sheet)
  pmoRow(5, 'PMO ECHO', 5, 0, 60, 60),
  pmoRow(6, 'PMO FOXTROT SIX', 14, 3, 0, 0),               // nobody on today's list
  pmoRow(7, 'PMO GOLF', 3, 41, 1234, 617),
  pmoRow(8, '(unassigned)', 4, 6, 75, 12),
];
const earlyRow = (sn, officer, teams, customers, paidOver, count1, extra = {}) => ({
  sn, officer, teams, customers, paidOver, remaining: Math.max(0, customers - paidOver), count1, count1Missing: [],
  ccPct: customers > 0 ? Math.round(paidOver / customers * 1000) / 10 : null,
  uncollected: 900000 * sn, expected: 12000000, collected: 12000000 - 900000 * sn, pct: 90 - sn, ...extra });
const EARLY_ROWS = [
  earlyRow(1, 'EARLY ALPHA ONE', 22, 530, 400, 31), earlyRow(2, 'EARLY BRAVO TWO LONGER NAME', 11, 210, 105, 12), earlyRow(3, 'EARLY CHARLIE', 6, 95, 90, 4),
  earlyRow(4, 'EARLY DELTA FOUR', 8, 160, 40, null), earlyRow(5, 'EARLY ECHO', 4, 70, 70, 0), earlyRow(6, 'EARLY FOXTROT', 9, 2345, 1000, 88),
];
const earlyWeekRows = EARLY_ROWS.map(r => ({ officer: r.officer, uncollected: r.uncollected * 4, pct: r.pct - 2, collected: 40000000, expected: 50000000 }));
const BOARDS = () => ({ ok: true, today: '2026-11-25', earlyDate: '2026-11-26',
  pmo: PMO_ROWS, pmoCount1Missing: ['KONGOWE'], earlyToday: EARLY_ROWS, earlyWeek: earlyWeekRows, earlyCount1Missing: [],
  recToday: [], recWeek: [], callToday: [], callWeek: [], unassignedTeams: { col: [], early: [], rec: [] }, dayProgress: [], fuStatus: [],
  csWeek: [], creditWeek: [], csExcluded: [], legalOn: true, legalCustomers: 0, legalAll: [], legalUnheld: [], workspace: 'hopepmo' });
let WORLD = 'normal';
const warn = console.warn; console.warn = () => {};

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname.startsWith('/app')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return; }
  if (u.pathname.startsWith('/mod/')) {
    const f = path.join(MOD_DIR, path.basename(u.pathname));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(f)); return; }
  }
  if (u.pathname === '/api/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, build: null })); return; }
  if (u.pathname === '/api/portal') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => {
      const { fn } = JSON.parse(b || '{}');
      const send = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (fn === 'dashboardFull') return send(DASH());
      if (fn === 'officerBoards') {
        const o = BOARDS();
        if (WORLD === 'nonc') { o.pmo = PMO_ROWS.map(r => ({ ...r, count1: null })); o.earlyToday = EARLY_ROWS.map(r => ({ ...r, count1: null })); }
        return send(o);
      }
      send({ ok: true, rows: [] });
    });
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;
const browser = await chromium.launch({ executablePath: CHROME });
const ok = [], fail = [], errs = [];
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (extra ? ' -- ' + extra : ''));
const BENIGN = /favicon|status of 404|ERR_FAILED|brand|status of 500|status of 403/;
const UI = { presentSeconds: 3600, refreshSeconds: 6000, hintIntervalSeconds: 3600, hintLifetimeSeconds: 5 };
const USER = { name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['present', 'dashboard', 'settings'] };

async function openSlide(id, size) {
  const page = await browser.newPage({ viewport: size });
  page.on('pageerror', e => errs.push(id + ': ' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(9000);
  await page.goto(base + '/');
  await page.evaluate(m => { S.code = 'ADM'; start(m); }, { name: USER.name, role: USER.role, teams: USER.teams, teamCount: null, tabs: USER.tabs, can: { dashboard: true, upload: false, admin: true }, ui: UI });
  await page.waitForTimeout(300);
  await page.evaluate(() => go('present', {}));
  await page.waitForFunction(() => S.slides && S.slides.length && document.getElementById('presStart'), null, { timeout: 12000 });
  await page.evaluate(() => { presStart(0); clearInterval(S.presTimer); clearInterval(S.presRefresh); });
  await page.waitForFunction(() => document.querySelector('#pres .pkpis'), null, { timeout: 8000 });
  const found = await page.evaluate(i => { const k = S.slides.findIndex(s => s.id === i); if (k < 0) return false; S.presI = k; presDraw(); return true; }, id);
  if (!found) throw new Error('the deck has no slide ' + id);
  await page.waitForSelector('#pres .ptable', { timeout: 8000 });
  await page.waitForTimeout(250);
  return page;
}
// the drawn table: headers, body rows, the JUMLA row, the caption, and what the layout did
const table = page => page.evaluate(() => {
  const pres = document.getElementById('pres'), t = pres.querySelector('.ptable'), sc = pres.querySelector('.pscroll');
  const tx = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
  const rows = [...t.querySelectorAll('tbody tr')];
  const head = [...t.querySelectorAll('thead th')].map(th => tx(th));
  const body = rows.filter(tr => !tr.classList.contains('ptot')).map(tr => [...tr.children].map(td => tx(td)));
  const tot = rows.filter(tr => tr.classList.contains('ptot')).map(tr => [...tr.children].map(td => tx(td)))[0] || [];
  // a header whose single word was broken across lines (overflow-wrap:anywhere lets a long word break): its text node's rects, line by line
  const lines = th => { const r = document.createRange(); r.selectNodeContents(th); const tops = new Set([...r.getClientRects()].map(q => Math.round(q.top))); return tops.size; };
  const ths = [...t.querySelectorAll('thead th')];
  const cap = pres.querySelector('.pcap');
  const capR = cap ? cap.getBoundingClientRect() : null, tr = t.getBoundingClientRect(), pr = pres.getBoundingClientRect();
  return { head, body, tot, lineCounts: ths.map(lines),
    // a single word (no space) that spans more than one line = broken mid-word
    brokenWords: ths.map(th => { const w = tx(th); return !/\s/.test(w) && lines(th) > 1; }),
    hscroll: sc ? sc.scrollWidth > sc.clientWidth + 1 : false, vscroll: pres.scrollHeight > pres.clientHeight + 1,
    capText: cap ? tx(cap) : '', capInside: capR ? (capR.bottom <= pr.bottom + 1 && capR.left >= pr.left - 1 && capR.right <= pr.right + 1) : null,
    tableInside: tr.right <= pr.right + 1 && tr.left >= pr.left - 1,
    // any cell whose content (a figure that never wraps, a word that cannot break) runs past the cell's own box
    cellOver: [...t.querySelectorAll('td, th')].filter(c => c.scrollWidth > c.clientWidth + 1).map(c => tx(c)),
    // the share of the table's width each header column takes
    widths: ths.map(th => Math.round(th.getBoundingClientRect().width / tr.width * 1000) / 10),
    vw: innerWidth, vh: innerHeight };
});
const col = (T, name) => T.head.indexOf(name);

try {
const SIZES = [[3840, 2160], [1920, 1080], [1366, 768], [1280, 720], [1024, 768]];
const PMO_HEAD = ['#', 'PMO', 'Teams', 'C1 LEO', 'TC LEO', 'CC% LEO', 'J3', 'J4', 'J5', 'AL', 'IJ', 'Uncollected (week)', 'Coll % (week)'];
const EARLY_HEAD = ['#', 'Officer', 'Teams', 'Wamebaki / Left', 'C1 KESHO', 'TC KESHO', 'CC% KESHO', 'Uncollected (kesho)', 'Coll % (kesho)', 'Uncollected (week)', 'Coll % (week)'];
// the wall's table prints a figure that is not known as a BLANK cell (as it does for every column of every slide), and a count with no thousands separator
const pctW = v => v == null ? '' : Math.round(v) + '%';
const cnt = n => n == null ? '' : String(n);
let first = {};
for (const [id, HEAD] of [['pmo', PMO_HEAD], ['early', EARLY_HEAD]]) {
  for (const [w, h] of SIZES) {
    const page = await openSlide(id, { width: w, height: h });
    const T = await table(page), tag = id + ' ' + w + 'x' + h;
    if (!first[id]) first[id] = T;
    check(tag + ' the table stays inside its box: no sideways scroll, the slide does not scroll, and no cell\'s content runs past the cell', !T.hscroll && !T.vscroll && T.tableInside && T.cellOver.length === 0, JSON.stringify({ h: T.hscroll, v: T.vscroll, in: T.tableInside, over: T.cellOver.slice(0, 4) }));
    const want = id === 'pmo' ? [3, 19, 5.5, 6.5, 6.5, 6.5, 6, 6, 6, 6, 6, 15, 8] : [3, 17, 6, 9, 7.5, 7.5, 8, 13, 8, 13, 8];
    check(tag + ' the columns have the widths the slide asks for (within a point)', T.widths.length === want.length && T.widths.every((x, i) => Math.abs(x - want[i]) <= 1.2), JSON.stringify(T.widths));
    check(tag + ' no header is broken in the middle of a word (a header of several words may stand on several lines)', T.brokenWords.every(x => !x), JSON.stringify(T.head.filter((_h, i) => T.brokenWords[i])));
    check(tag + ' the caption is under the table, whole', T.capInside === true && T.capText.length > 40, JSON.stringify({ inside: T.capInside }));
    const shorts = HEAD.map((x, i) => [x, i]).filter(([x]) => /^(C1|TC|CC%)/.test(x)).map(([, i]) => i);
    check(tag + ' the short count headers stand on at most two lines (C1 / LEO)', shorts.every(i => T.lineCounts[i] <= 2), JSON.stringify(shorts.map(i => [T.head[i], T.lineCounts[i]])));
    if (process.env.SHOTS && (w === 1920 || w === 1366)) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, 'collection-' + id + '-' + w + 'x' + h + '.png') }); }
    await page.close();
  }
}
// ---- 1. the headers, in their places
check('1 today\'s slide: PMO, Teams, C1 LEO, TC LEO, CC% LEO, then J3 .. IJ and the week', JSON.stringify(first.pmo.head) === JSON.stringify(PMO_HEAD), JSON.stringify(first.pmo.head));
check('1 the early slide: the same three short counts for the next list, between Wamebaki and Uncollected', JSON.stringify(first.early.head) === JSON.stringify(EARLY_HEAD), JSON.stringify(first.early.head));
check('1 the long names are gone from both', ![...first.pmo.head, ...first.early.head].some(x => /Count 1|Wateja \/ Customers/.test(x)));
// ---- 2. what the rows print
{
  const T = first.pmo, c1 = col(T, 'C1 LEO'), tc = col(T, 'TC LEO'), cc = col(T, 'CC% LEO');
  const R = Object.fromEntries(T.body.map(r => [r[1], r]));
  check('2 today: each officer\'s C1 LEO and TC LEO are the counts the server sent, and CC% LEO is whole per cent', PMO_ROWS.every(p => {
    const r = R[p.officer]; return r && r[c1] === cnt(p.count1) && r[tc] === cnt(p.customers) && r[cc] === pctW(p.ccPct); }), JSON.stringify(T.body.map(r => [r[1], r[c1], r[tc], r[cc]])));
  check('2 today: an officer whose Count 1 is not known has a blank there and keeps the total count; nobody on the list is a blank for CC%, never "0%"',
    R['PMO DELTA FOUR'][c1] === '' && R['PMO DELTA FOUR'][tc] === '120' && R['PMO FOXTROT SIX'][tc] === '0' && R['PMO FOXTROT SIX'][cc] === '', JSON.stringify([R['PMO DELTA FOUR'], R['PMO FOXTROT SIX']]));
  const sumC1 = PMO_ROWS.reduce((s, r) => s + (r.count1 || 0), 0), sumTC = PMO_ROWS.reduce((s, r) => s + r.customers, 0), sumPaid = PMO_ROWS.reduce((s, r) => s + r.paidOver, 0);
  const meanCC = PMO_ROWS.filter(r => r.ccPct != null).reduce((s, r, _i, a) => s + r.ccPct / a.length, 0);
  check('2 today: the JUMLA row adds C1 LEO and TC LEO up (the officer whose Count 1 is unknown adds nothing)', T.tot[c1] === cnt(sumC1) && T.tot[tc] === cnt(sumTC), JSON.stringify([T.tot[c1], T.tot[tc], sumC1, sumTC]));
  check('2 today: and CC% LEO in the JUMLA row is paid among the total of the TOTALS (' + sumPaid + ' of ' + sumTC + '), not the average of the officers\' percentages (' + meanCC.toFixed(1) + '%)',
    T.tot[cc] === pctW(Math.round(sumPaid / sumTC * 1000) / 10) && T.tot[cc] !== pctW(meanCC), JSON.stringify([T.tot[cc], pctW(Math.round(sumPaid / sumTC * 1000) / 10), pctW(meanCC)]));
}
{
  const T = first.early, c1 = col(T, 'C1 KESHO'), tc = col(T, 'TC KESHO'), cc = col(T, 'CC% KESHO');
  const R = Object.fromEntries(T.body.map(r => [r[1], r]));
  check('2 early: each officer\'s C1 KESHO, TC KESHO and CC% KESHO are what the server sent, and Wamebaki is still the headcount left', EARLY_ROWS.every(p => {
    const r = R[p.officer]; return r && r[c1] === cnt(p.count1) && r[tc] === cnt(p.customers) && r[cc] === pctW(p.ccPct) && r[col(T, 'Wamebaki / Left')] === cnt(p.remaining); }), JSON.stringify(T.body.map(r => [r[1], r[3], r[c1], r[tc], r[cc]])));
  const sumTC = EARLY_ROWS.reduce((s, r) => s + r.customers, 0), sumPaid = EARLY_ROWS.reduce((s, r) => s + r.paidOver, 0);
  const meanCC = EARLY_ROWS.reduce((s, r) => s + r.ccPct, 0) / EARLY_ROWS.length;
  check('2 early: the JUMLA row adds the two counts up and works CC% KESHO out from the totals (' + sumPaid + ' of ' + sumTC + '), not the average of the officers\' percentages (' + meanCC.toFixed(1) + '%)',
    T.tot[tc] === cnt(sumTC) && T.tot[cc] === pctW(Math.round(sumPaid / sumTC * 1000) / 10) && T.tot[cc] !== pctW(meanCC), JSON.stringify([T.tot[tc], T.tot[cc], pctW(Math.round(sumPaid / sumTC * 1000) / 10), pctW(meanCC)]));
}
// ---- 4. the captions say what the short names are
check('4 today\'s caption says what C1 LEO, TC LEO and CC% LEO are, in Swahili and English',
  /C1 LEO = wateja wa N\.C 1 wanaodaiwa leo · TC LEO = jumla ya wateja wa leo \(total count\) · CC% LEO = wateja waliolipa \(wamelipa \+ wamezidisha\) kati ya jumla/.test(first.pmo.capText)
  && /C1 LEO = today's N\.C 1 customers still owing · TC LEO = all of today's customers \(total count\) · CC% LEO = customers who have paid \(paid \+ overpaid\) among the total/.test(first.pmo.capText), first.pmo.capText.slice(0, 400));
check('4 the early caption says what C1 KESHO, TC KESHO and CC% KESHO are, in Swahili and English',
  /C1 KESHO = wateja wa N\.C 1 wanaodaiwa kwenye orodha ya kesho · TC KESHO = jumla ya wateja wa orodha hiyo · CC% KESHO = wateja waliolipa \(wamelipa \+ wamezidisha\) kati ya jumla/.test(first.early.capText)
  && /C1 KESHO = N\.C 1 customers still owing on the next list · TC KESHO = all customers on it \(total count\) · CC% KESHO = customers who have paid \(paid \+ overpaid\) among the total/.test(first.early.capText), first.early.capText.slice(0, 400));
// ---- the sheets of N.C-less teams: Count 1 is a dash on every row and its total is blank, the total count and CC% are still there
WORLD = 'nonc';
for (const id of ['pmo', 'early']) {
  const page = await openSlide(id, { width: 1920, height: 1080 });
  const T = await table(page), k = id === 'pmo' ? 'LEO' : 'KESHO', c1 = col(T, 'C1 ' + k), tc = col(T, 'TC ' + k), cc = col(T, 'CC% ' + k);
  check('2 ' + id + ': with no N.C on any sheet every Count 1 is blank and its total is blank (never 0), while the total count and CC% still read', T.body.every(r => r[c1] === '') && T.tot[c1] === '' && /\d/.test(T.tot[tc]) && /%/.test(T.tot[cc]), JSON.stringify([T.body.map(r => r[c1]), T.tot[c1], T.tot[tc], T.tot[cc]]));
  check('4 ' + id + ': and the caption still says which sheet to upload again, beside what the short names are', /Count 1 haipo kwa/.test(T.capText) && /C1 (LEO|KESHO) = /.test(T.capText), T.capText.slice(0, 160));
  await page.close();
}
WORLD = 'normal';
// ---- 5. the other slides are drawn as they were
{
  const page = await openSlide('pmo', { width: 1920, height: 1080 });
  await page.evaluate(() => { S.presI = 0; presDraw(); });
  await page.waitForTimeout(250);
  check('5 the day slide is still the twelve tiles', await page.evaluate(() => document.querySelectorAll('#pres .pkpis .pkpi').length) === 12);
  await page.close();
}
} catch (e) { fail.push('the check stopped: ' + String((e && e.message) || e).split('\n')[0].slice(0, 240)); }

check('5 no page error in any world', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close(); srv.close(); console.warn = warn;
for (const f of fail) console.log('FAIL  ' + f);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
