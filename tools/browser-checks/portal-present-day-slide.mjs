/* THE "HOPE PMO — DAY" SLIDE OF THE PRESENTATION: TWELVE TILES, FOUR ACROSS AND THREE DOWN, FILLING THE TV. The REAL public/app.html and
   public/mod/present.js in a real browser, the dashboard's answer served from this file (the figures are made up).

     "Add 6 widgets to hope pmo overall slide at presentation so that they are 4x3 full on our tv (HOPE PMO - DAY slide)"
                                                                                  -- the owner, 25 Nov 2026 (handbook Part 164)

   What it proves, at the sizes a TV and a laptop really are (3840x2160, 1920x1080, 1366x768, 1280x720, 1024x768) and on a phone-width window:

     1. the slide has TWELVE tiles, each reading what the dashboard's answer says (whole numbers for a percentage, a dash where the week has
        nothing to measure, never a nought). The owner changed it twice on 25 Nov and left the choices to us (handbook Part 164, addenda 1 and 2):
        "replace initial arreas widget with anything else thats crucial ..." (Initial arrears is gone, the week's recovery in shillings is the
        seventh tile) and "combine % of sales, and of recovered at their amounts and replace with any other meaningful widgets": the Sales %
        and the Recovery % are a line UNDER Sales this week and Recovered this week, and the two tiles that were left are the week's Expected
        Defaulters recovery (a dash while the database has not answered it) and the Performance average of the strip;
     2. on a TV-sized screen they stand FOUR in a row and THREE in a column, every tile the same size, the grid reaching the bottom of the
        screen (it FILLS the TV: no band of empty wall under it) and the slide never scrolls;
     3. no figure runs past its tile, however long (a billion-shilling arrears at the smallest laptop), and every tile's figure has one size;
     4. on a window narrower than a tablet the twelve fall to two columns and the slide is fitted as every other slide is (nothing is cut);
     5. the other slides of the deck are drawn as they were (the team table is still a table), and no page error in any world.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-present-day-slide.mjs

   CHROME overrides the browser path; APP_FILE and MOD_DIR run it against another copy of the page and of the modules (the page as it
   stood before this change shows what the check is for); SHOTS=<dir> saves pictures. Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
const APP = fs.readFileSync(process.env.APP_FILE || path.join(ROOT, 'public/app.html'), 'utf8');
const MOD_DIR = process.env.MOD_DIR || path.join(ROOT, 'public/mod');

/* THE DASHBOARD'S ANSWER, as much of it as the deck reads. The largest figures are real-sized (a company's arrears in the billions). */
let CARDS = { curArrears: 3412547121, initArrears: 23760795812, recovered: 1234567890, defaulters: 10372, cleared: 4321, salesWeek: 987654321,
  uncollectedToday: 456789012, abnormal: 37 };
let PERF = { salesPct: 84.4, ecolPct: 91.2, colPct: 96.7, recPct: 118.4, avgPct: 99.8 };
let RECTOT = { recovered: 94338048, uncollected: 120000000, adjusted: 0, unrecovered: 25661952, pct: 78.6 };
let EDRTOT = { initial: 120000000, current: 116400000, recovered: 3600000, pct: 3 };
let EDRDAYS = [{ weekday: 'MON', uploaded: true, recovered: 1800000 }, { weekday: 'TUE', uploaded: true, recovered: 1800000 }, { weekday: 'WED', uploaded: false, recovered: 0 }];
let EDRNOTE = null;
const DASH = () => ({ ok: true, weekday: 'WED', weekOf: '2026-11-23', weekEnd: '2026-11-29', pastWeek: false, asOfDate: '2026-11-25', cards: CARDS, perf: PERF, recTrendTotal: RECTOT,
  edrTrendTotal: EDRTOT, edrTrend: EDRDAYS, edrNote: EDRNOTE,
  teamPerf: [{ branch: 'DAR', team: 'KONGOWE', salesMonth: 1000, curArrears: 5000, defaulters: 3, uncollected: 100, collPct: 90, recPctMon: 80, recPctYest: 70, recPctWeek: 60, basis: 'today' }],
  colTrend: [], workspace: 'hopepmo' });
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
      if (fn === 'dashboardFull') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(DASH())); return; }
      // the officer boards do not arrive: the deck says so on a slide of its own and plays the rest (the slide under test needs only the dashboard)
      res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'the officer boards are not served by this check' }));
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

async function openDeck(size) {
  const page = await browser.newPage({ viewport: size });
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(9000);
  await page.goto(base + '/');
  await page.evaluate(m => { S.code = 'ADM'; start(m); }, { name: USER.name, role: USER.role, teams: USER.teams, teamCount: null, tabs: USER.tabs, can: { dashboard: true, upload: false, admin: true }, ui: UI });
  await page.waitForTimeout(300);
  await page.evaluate(() => go('present', {}));
  await page.waitForFunction(() => S.slides && S.slides.length && document.getElementById('presStart'), null, { timeout: 12000 });
  await page.evaluate(() => { presStart(0); clearInterval(S.presTimer); clearInterval(S.presRefresh); });   // the first slide, held still
  await page.waitForFunction(() => document.querySelector('#pres .pkpis'), null, { timeout: 8000 });
  await page.waitForTimeout(250);
  return page;
}
const geo = page => page.evaluate(() => {
  const pres = document.getElementById('pres'), g = pres.querySelector('.pkpis');
  const tiles = [...g.querySelectorAll('.pkpi')].map(t => t.getBoundingClientRect());
  const vals = [...g.querySelectorAll('.pv')].map(v => ({ over: v.scrollWidth > v.clientWidth + 1, fs: Math.round(parseFloat(getComputedStyle(v).fontSize) * 10) / 10 }));
  const uniq = a => [...new Set(a.map(x => Math.round(x)))].length;
  const t = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
  return { cls: g.className, n: tiles.length, cols: uniq(tiles.map(r => r.left)), rows: uniq(tiles.map(r => r.top)),
    sameW: uniq(tiles.map(r => r.width)) === 1, sameH: uniq(tiles.map(r => r.height)) === 1,
    bottom: Math.max(...tiles.map(r => r.bottom)), top: Math.min(...tiles.map(r => r.top)), right: Math.max(...tiles.map(r => r.right)), left: Math.min(...tiles.map(r => r.left)),
    vals, vw: innerWidth, vh: innerHeight, scrolls: pres.scrollHeight > pres.clientHeight + 1, hscrolls: pres.scrollWidth > pres.clientWidth + 1,
    tiles: [...g.querySelectorAll('.pkpi')].map(el => { const pv = el.querySelector('.pv'), ps = pv.querySelector('.ps');
      return [t(el.querySelector('.pl')), [...pv.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim(), ps ? t(ps) : '']; }),
    // nothing of a tile (label, figure, the line under it) runs past the tile, either way
    tileOverflow: [...g.querySelectorAll('.pkpi')].some(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1),
    subs: [...g.querySelectorAll('.pv .ps')].filter(ps => ps.textContent.trim()).map(ps => { const r = document.createRange(); r.selectNodeContents(ps); const b = r.getBoundingClientRect(), tr = ps.closest('.pkpi').getBoundingClientRect(); return b.right <= tr.right && b.left >= tr.left && b.bottom <= tr.bottom && b.top >= tr.top; }) };
});

try {
const SIZES = [[3840, 2160], [1920, 1080], [1366, 768], [1280, 720], [1024, 768]];
let first = null;
for (const [w, h] of SIZES) {
  const page = await openDeck({ width: w, height: h });
  const G = await geo(page);
  if (!first) first = G;
  const tag = w + 'x' + h;
  check(tag + ' twelve tiles on the day slide', G.n === 12, 'n=' + G.n + ' class=' + G.cls);
  check(tag + ' FOUR in a row and THREE in a column', G.cols === 4 && G.rows === 3, G.cols + ' columns, ' + G.rows + ' rows');
  check(tag + ' every tile the same size', G.sameW && G.sameH);
  check(tag + ' the grid FILLS the screen: it reaches the bottom (within the slide\'s own margin) and starts under the heading', G.bottom >= G.vh - 70 && G.bottom <= G.vh - 20 && G.top > 40 && G.top < G.vh * 0.2, 'top ' + Math.round(G.top) + ' bottom ' + Math.round(G.bottom) + ' of ' + G.vh);
  check(tag + ' it uses the width too, clear of the two navigation arrows (they sit on the edges, 74 pixels in)', G.left >= 74 && G.left <= 110 && G.right >= G.vw - 110 && G.right <= G.vw - 74, Math.round(G.left) + ' .. ' + Math.round(G.right) + ' of ' + G.vw);
  check(tag + ' and no arrow lies over a tile', await page.evaluate(() => { const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const arrows = [...document.querySelectorAll('#pres .pnav')].map(e => e.getBoundingClientRect()); return ![...document.querySelectorAll('#pres .pkpi')].some(t => arrows.some(a => hit(a, t.getBoundingClientRect()))); }));
  check(tag + ' the slide does not scroll', !G.scrolls && !G.hscrolls);
  check(tag + ' no figure runs past its tile, and every tile\'s figure has one size', G.vals.every(v => !v.over) && new Set(G.vals.map(v => v.fs)).size === 1, JSON.stringify(G.vals.map(v => v.fs)));
  check(tag + ' the figures of a row stand level whether the tile has a line under its figure or not (among tiles whose label is one line: a label that wraps is a taller label, as it always was)', await page.evaluate(() => { const rows = {}; [...document.querySelectorAll('#pres .pkpi')].forEach(t => { const pl = t.querySelector('.pl'), one = pl.getBoundingClientRect().height < 2 * parseFloat(getComputedStyle(pl).fontSize); if (!one) return; const k = Math.round(t.getBoundingClientRect().top); (rows[k] = rows[k] || []).push(Math.round(t.querySelector('.pv').getBoundingClientRect().top - t.getBoundingClientRect().top)); }); const L = Object.values(rows); return L.length >= 2 && L.every(r => Math.max(...r) - Math.min(...r) <= 2); }));
  check(tag + ' nothing of a tile (its label, its figure, the line under it) runs past the tile, and each of the four lines under a figure lies inside its tile', !G.tileOverflow && G.subs.length === 4 && G.subs.every(Boolean), JSON.stringify({ over: G.tileOverflow, subs: G.subs }));
  if (process.env.SHOTS && (w === 1920 || w === 1366)) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, 'present-day-' + tag + '.png') }); }
  await page.close();
}
// ---- 1. what the twelve say
const T = first.tiles, L = T.map(x => x[0]), V = Object.fromEntries(T.map(x => [x[0], x[1]])), SUB = Object.fromEntries(T.map(x => [x[0], x[2]]));
check('1 the twelve, in their places: the first eight as they were (the seventh is the week\'s recovery), then the two collection percentages, the week\'s Expected Defaulters recovery and the Performance average',
  JSON.stringify(L) === JSON.stringify(['Current arrears', 'Recovered', 'Defaulters', 'Sales this week', 'Uncollected today', 'Abnormal', 'Recovered this week', 'Cleared today',
    'Early Collection % (week)', 'Collection % (week)', 'Exp.Def recovery (week)', 'Performance (average)']), JSON.stringify(L));
check('1 the old six read what they read before', V['Current arrears'] === 'TZS 3,412,547,121' && V['Recovered'] === 'TZS 1,234,567,890' && V['Defaulters'] === '10,372'
  && V['Sales this week'] === 'TZS 987,654,321' && V['Uncollected today'] === 'TZS 456,789,012' && V['Abnormal'] === '37', JSON.stringify(V));
check('1 the week\'s recovery is the weekly recovery trend\'s own total and the cleared customers are the dashboard card\'s', V['Recovered this week'] === 'TZS 94,338,048' && V['Cleared today'] === '4,321', JSON.stringify(V));
check('1 neither the Initial arrears tile nor the two percentage tiles that were combined with their amounts are on the slide as tiles of their own',
  !('Initial arrears' in V) && !('Sales % (week)' in V) && !('Recovery % (week)' in V) && CARDS.initArrears > 0, JSON.stringify(L));
check('1 the two collection percentages are the strip\'s, in whole numbers (91.2 reads 91, 96.7 reads 97)', V['Early Collection % (week)'] === '91%' && V['Collection % (week)'] === '97%', JSON.stringify(V));
check('1 SALES % IS UNDER THE SALES AMOUNT and RECOVERY % UNDER THE WEEK\'S RECOVERY (84.4 reads 84, 118.4 reads 118), each a line under its figure on the same tile',
  SUB['Sales this week'] === '84% of target' && SUB['Recovered this week'] === '118% of uncollected', JSON.stringify(SUB));
check('1 the week\'s Expected Defaulters recovery is the dashboard card\'s own total, its percentage to one decimal under it', V['Exp.Def recovery (week)'] === 'TZS 3,600,000' && SUB['Exp.Def recovery (week)'] === '3.0% of their arrears', JSON.stringify([V['Exp.Def recovery (week)'], SUB['Exp.Def recovery (week)']]));
check('1 the Performance average is the strip\'s (99.8 reads 100) and says what it is the average of', V['Performance (average)'] === '100%' && SUB['Performance (average)'] === 'sales · collection · recovery', JSON.stringify([V['Performance (average)'], SUB['Performance (average)']]));
check('1 only the four tiles that carry a percentage or a meaning under the figure have the line, and no tile has an empty one', T.filter(x => x[2]).map(x => x[0]).join('|') === 'Sales this week|Recovered this week|Exp.Def recovery (week)|Performance (average)', JSON.stringify(T.filter(x => x[2]).map(x => x[0])));
// ---- a week with nothing to measure: a dash, never a nought
PERF = { salesPct: null, ecolPct: null, colPct: 100, recPct: 0, avgPct: null };
let page = await openDeck({ width: 1920, height: 1080 });
let G0 = await geo(page), N = Object.fromEntries(G0.tiles.map(x => [x[0], x[1]])), NS = Object.fromEntries(G0.tiles.map(x => [x[0], x[2]]));
check('1 a percentage the week cannot measure is a dash, a real nought is a nought: Early Collection and the Performance average a dash, Collection 100%',
  N['Early Collection % (week)'] === '—' && N['Collection % (week)'] === '100%' && N['Performance (average)'] === '—', JSON.stringify(N));
check('1 and under the amounts: Sales % has nothing to measure (a dash alone, never "— of target"), Recovery % is a real nought (0% of uncollected)', NS['Sales this week'] === '—' && NS['Recovered this week'] === '0% of uncollected', JSON.stringify(NS));
await page.close();
PERF = { salesPct: 84.4, ecolPct: 91.2, colPct: 96.7, recPct: 118.4, avgPct: 99.8 };
// ---- the week's Expected Defaulters recovery when the database has NOT answered it (the dashboard says so in a note), and when no day of the week has its files
EDRNOTE = 'Kadi ya Expected Defaulters haijajibiwa / The Expected Defaulters card got no answer from the database';
page = await openDeck({ width: 1920, height: 1080 });
G0 = await geo(page); N = Object.fromEntries(G0.tiles.map(x => [x[0], x[1]])); NS = Object.fromEntries(G0.tiles.map(x => [x[0], x[2]]));
check('1 with no answer from the database the Expected Defaulters tile is a dash with no line under it (the dashboard says so in a note; the TV never shows a nought for it)', N['Exp.Def recovery (week)'] === '—' && NS['Exp.Def recovery (week)'] === '' && G0.n === 12, JSON.stringify([N['Exp.Def recovery (week)'], NS['Exp.Def recovery (week)']]));
await page.close();
EDRNOTE = null; EDRDAYS = [{ weekday: 'MON', uploaded: false, recovered: 0 }, { weekday: 'TUE', uploaded: false, recovered: 0 }];
page = await openDeck({ width: 1920, height: 1080 });
G0 = await geo(page); N = Object.fromEntries(G0.tiles.map(x => [x[0], x[1]]));
check('1 a week with no day uploaded yet reads a dash, not "TZS 0"', N['Exp.Def recovery (week)'] === '—', JSON.stringify(N['Exp.Def recovery (week)']));
await page.close();
EDRDAYS = [{ weekday: 'MON', uploaded: true, recovered: 1800000 }, { weekday: 'TUE', uploaded: true, recovered: 1800000 }, { weekday: 'WED', uploaded: false, recovered: 0 }];
// ---- 3. the longest figures at the smallest screens
CARDS = { ...CARDS, curArrears: 98765432109, initArrears: 123456789012, recovered: 98765432109, salesWeek: 98765432109, uncollectedToday: 98765432109 };
RECTOT = { ...RECTOT, recovered: 98765432109 };
EDRTOT = { ...EDRTOT, recovered: 98765432109, pct: 100 };
for (const [w, h] of [[1366, 768], [1024, 768], [1280, 720]]) {
  page = await openDeck({ width: w, height: h });
  const G = await geo(page);
  check('3 ' + w + 'x' + h + ' with arrears of TZS 123 billion no figure runs past its tile and they share one size', G.vals.every(v => !v.over) && new Set(G.vals.map(v => v.fs)).size === 1 && G.cols === 4 && G.rows === 3 && !G.tileOverflow && G.subs.every(Boolean), JSON.stringify({ fs: G.vals.map(v => v.fs), over: G.tileOverflow, subs: G.subs }));
  await page.close();
}
if (process.env.SHOTS) { page = await openDeck({ width: 1366, height: 768 }); await page.screenshot({ path: path.join(process.env.SHOTS, 'present-day-1366x768-billions.png') }); await page.close(); }
// ---- 4. a narrow window: two columns, nothing cut
page = await openDeck({ width: 800, height: 600 });
const NW = await geo(page);
check('4 on a window narrower than a tablet the twelve fall to two columns and are fitted to the screen, none cut', NW.n === 12 && NW.cols === 2 && NW.vals.every(v => !v.over) && NW.bottom <= NW.vh, JSON.stringify({ cols: NW.cols, rows: NW.rows, bottom: Math.round(NW.bottom), vh: NW.vh }));
await page.close();
// ---- 5. the other slides are drawn as they were: the second slide is still a table
page = await openDeck({ width: 1920, height: 1080 });
await page.evaluate(() => { S.presI = 1; presDraw(); });
await page.waitForTimeout(250);
const second = await page.evaluate(() => ({ table: !!document.querySelector('#pres .ptable'), kpis: !!document.querySelector('#pres .pkpis'), head: (document.querySelector('#pres .phead span') || {}).textContent }));
check('5 the second slide is still the team table, with no tile grid', second.table && !second.kpis && /Team performance/.test(second.head || ''), JSON.stringify(second));
await page.evaluate(() => { S.presI = 0; presDraw(); });
await page.waitForTimeout(250);
const back = await geo(page);
check('5 coming back to the day slide draws it whole again (the fit is redone on every draw)', back.n === 12 && back.cols === 4 && back.rows === 3 && back.bottom >= back.vh - 70);
await page.close();
} catch (e) { fail.push('the check stopped: ' + String((e && e.message) || e).split('\n')[0].slice(0, 240)); }

check('5 no page error in any world', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close(); srv.close(); console.warn = warn;
for (const f of fail) console.log('FAIL  ' + f);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
