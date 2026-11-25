/* THE PRESENTATION'S ABNORMAL CARD: THE WEEK'S DEDUCTION CASES, ON THE CARD AND TEAM BY TEAM. The REAL public/app.html and public/mod/present.js in a real browser, the
   dashboard's and the deduction cases' answers served from this file (the figures and the teams are made up).

     "at abnormal card in presentation - show weekly deduction case counts per team counts too. so that i get the impact from that view"
                                                                                  -- the owner, 25 Nov 2026 (handbook Part 164, addendum 6)

   What it proves, at the sizes a TV and a laptop really are (3840x2160, 1920x1080, 1366x768, 1280x720, 1024x768):

     1. the Abnormal tile of the day slide carries the dashboard's own figure and, under it, "9 deduction cases this week": the day slide is still twelve tiles, four across and three
        down, every tile the same size, nothing running past its tile (the line is one of the two every tile reserves: no tile grew);
     2. the slide right after it is the card's per-team view: a row for each team with an abnormal payment or a deduction case, the teams with most cases first, the abnormal
        payments the dashboard's own per-team count, a JUMLA row that is the card's number and the week's total, a caption that says the week and what the columns are -- and
        the slide fits the screen, no cell running past its own box, nothing scrolling;
     3. a long list is twelve rows and ONE last row for all the others, and the JUMLA row is still the whole of it;
     4. the cases are asked for AFTER the officer boards, once, for the SAME week as the two reads before them, and again (after the boards again) when the deck refreshes, whose new
        answer reaches the card without a reload;
     5. when the read FAILS the page says so (a note and a retry that works), the card's line is a dash (never a nought), the slide's column is blank and its caption says why;
        when the table is not there (RUN-ME-043) the card says nothing and the slide says so;
     6. a person who does NOT hold the PMO Deduction tab is never asked, sees no line and no slide (the team table stays the second slide), and the day slide is what it was;
     7. the deck's own choices work on it: untick its segment and it is gone; scope the deck to one team and it is that team's row;
     8. no page error in any world.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-present-abnormal-deductions.mjs

   CHROME overrides the browser path; APP_FILE and MOD_DIR run it against another copy of the page and of the modules (the page as it stood before this change shows what the
   check is for); SHOTS=<dir> saves pictures. Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
const APP = fs.readFileSync(process.env.APP_FILE || path.join(ROOT, 'public/app.html'), 'utf8');
const MOD_DIR = process.env.MOD_DIR || path.join(ROOT, 'public/mod');

/* THE DASHBOARD'S ANSWER, as much of it as the deck reads: the card's figure (37 abnormal payments) is the sum of the teams' own counts (7 + 0 + 20 + 10), as the server makes it. */
const TEAM = (team, abnormal) => ({ branch: 'DAR', team, abnormal, salesMonth: 1000, curArrears: 5000, defaulters: 3, uncollected: 100, collPct: 90, recPctMon: 80, recPctYest: 70, recPctWeek: 60, basis: 'today' });
const SHORT = [TEAM('MBAGALA', 20), TEAM('KONGOWE', 7), TEAM('TANDIKA', 0), TEAM('NYAMA', 10), TEAM('QUIET', 0)];
let TEAMPERF = SHORT, CARDS = { curArrears: 3412547121, initArrears: 1, recovered: 1234567890, defaulters: 10372, cleared: 4321, salesWeek: 987654321, uncollectedToday: 456789012, abnormal: 37 };
let DED = { on: true, note: null, weekOf: '2026-11-23', weekEnd: '2026-11-29', cases: 9, teams: [{ team: 'KONGOWE', cases: 4 }, { team: 'TANDIKA', cases: 3 }, { team: 'MBAGALA', cases: 2 }] };
let DEDMODE = 'ok';                     // 'ok' | 'fail' (HTTP 500)
let REQ = [];                           // every call the page made, in order: [fn, args]
const DASH = () => ({ ok: true, weekday: 'WED', weekOf: '2026-11-23', weekEnd: '2026-11-29', pastWeek: false, asOfDate: '2026-11-25', cards: CARDS,
  perf: { salesPct: 84.4, ecolPct: 91.2, colPct: 96.7, recPct: 118.4, avgPct: 99.8, appsCount: 486, appsAmount: 1234000000 },
  recTrendTotal: { recovered: 94338048, uncollected: 120000000, adjusted: 0, unrecovered: 25661952, pct: 78.6 },
  edrTrendTotal: { initial: 120000000, current: 116400000, recovered: 3600000, pct: 3 }, edrTrend: [{ weekday: 'MON', uploaded: true, recovered: 1800000 }],
  legal: { grand: { on: true, nOn: true, pOn: true, rows: [], total: { owed: 52000000, recovered: 41000000, pct: 78.8, nRec: 30000000, cRec: 11000000 } } },
  teamPerf: TEAMPERF, colTrend: [{ weekday: 'WED', date: '2026-11-25', expected: 10000000, collected: 8660000, uncollected: 1340000, uploaded: true, pct: 86.6 }],
  salesTrend: [{ weekday: 'WED', date: '2026-11-25', amount: 4200000, loans: 5, pct: 84.4 }], workspace: 'hopepmo' });
const warn = console.warn; console.warn = () => {};
const send = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname.startsWith('/app')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return; }
  if (u.pathname.startsWith('/mod/')) {
    const f = path.join(MOD_DIR, path.basename(u.pathname));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(f)); return; }
  }
  if (u.pathname === '/api/me') { send(res, 200, { ok: true, build: null }); return; }
  if (u.pathname === '/api/portal') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => {
      const { fn, args } = JSON.parse(b || '{}');
      REQ.push([fn, args]);
      if (fn === 'dashboardFull') { send(res, 200, DASH()); return; }
      if (fn === 'deductionsWeek') { if (DEDMODE === 'fail') send(res, 500, { ok: false, error: 'Hifadhidata haikujibu / the database did not answer' }); else send(res, 200, DED); return; }
      // the officer boards do not arrive: the deck says so on a slide of its own and plays the rest (the slides under test need only the dashboard and the cases)
      send(res, 500, { ok: false, error: 'the officer boards are not served by this check' });
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
const HOLDER = { name: 'THE PMO', role: 'PMO', teams: null, tabs: ['present', 'dashboard', 'deduct'] };
const OUTSIDER = { name: 'THE GM', role: 'GM', teams: null, tabs: ['present', 'dashboard'] };

/* Opens the Presentation PAGE (before Play) as `user`, waits until the cases have answered or failed (a person who is never asked: until the boards have settled and a moment more),
   then plays the first slide held still. `weekOf` rides the way the week bar's choice does. */
async function openDeck(size, user = HOLDER, { weekOf = '', play = true, settle = true } = {}) {
  const page = await browser.newPage({ viewport: size });
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(9000);
  await page.goto(base + '/');
  await page.evaluate(m => { S.code = 'U'; start(m); }, { name: user.name, role: user.role, teams: user.teams, teamCount: null, tabs: user.tabs, can: { dashboard: true, upload: false, admin: false }, ui: UI });
  await page.waitForTimeout(300);
  // the page's own boot reads (its landing screen) are not the Presentation's: the log starts here
  REQ = [];
  await page.evaluate(w => go('present', w ? { weekOf: w } : {}), weekOf);
  await page.waitForFunction(() => S.slides && S.slides.length && document.getElementById('presStart'), null, { timeout: 12000 });
  if (settle) {
    await page.waitForFunction(() => S.presData && (S.presData.b || S.presData.bWhy) && !S.presData.bLoading, null, { timeout: 12000 });
    await page.waitForFunction(() => { const p = S.presData; return !!(p.ded || p.dedWhy) || !allowed('deduct'); }, null, { timeout: 12000 });
    await page.waitForTimeout(350);          // a request that should NOT be made has had its chance
  }
  if (play) {
    await page.evaluate(() => { presStart(0); clearInterval(S.presTimer); clearInterval(S.presRefresh); });
    await page.waitForFunction(() => document.querySelector('#pres .pkpis'), null, { timeout: 8000 });
    await page.waitForTimeout(250);
  }
  return page;
}
const show = async (page, id) => { const k = await page.evaluate(i => { const k = S.slides.findIndex(s => s.id === i); if (k < 0) return -1; S.presI = k; presDraw(); return k; }, id); await page.waitForTimeout(250); return k; };
const day = page => page.evaluate(() => {
  const g = document.querySelector('#pres .pkpis'), t = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
  const tiles = [...g.querySelectorAll('.pkpi')];
  const uniq = a => [...new Set(a.map(x => Math.round(x)))].length, rects = tiles.map(e => e.getBoundingClientRect());
  return { n: tiles.length, cols: uniq(rects.map(r => r.left)), rows: uniq(rects.map(r => r.top)), sameW: uniq(rects.map(r => r.width)) === 1, sameH: uniq(rects.map(r => r.height)) === 1,
    overflow: tiles.some(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1),
    figOver: [...g.querySelectorAll('.pv')].some(v => v.scrollWidth > v.clientWidth + 1),
    lineCounts: tiles.map(el => el.querySelectorAll('.pv .ps').length),
    margins: tiles.map(el => { const r = el.getBoundingClientRect(), a = el.firstElementChild.getBoundingClientRect(), z = el.lastElementChild.getBoundingClientRect(); return [Math.round(a.top - r.top), Math.round(r.bottom - z.bottom)]; }),
    tiles: Object.fromEntries(tiles.map(el => { const pv = el.querySelector('.pv'); return [t(el.querySelector('.pl')), { v: [...pv.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim(), s: [...pv.querySelectorAll('.ps')].map(t).filter(Boolean) }]; })),
    scrolls: document.getElementById('pres').scrollHeight > document.getElementById('pres').clientHeight + 1 };
});
const table = page => page.evaluate(() => {
  const pres = document.getElementById('pres'), tb = pres.querySelector('.ptable'), cap = pres.querySelector('.pcap'), body = pres.querySelector('.pbody'), sc = pres.querySelector('.pscroll');
  const clean = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
  return { title: clean(pres.querySelector('.phead span')), head: [...tb.querySelectorAll('thead th')].map(clean), rows: [...tb.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(clean)),
    over: [...tb.querySelectorAll('th, td')].filter(c => c.scrollWidth > c.clientWidth + 1).map(clean), caption: cap ? clean(cap) : '', capHtml: cap ? cap.innerHTML : '',
    vh: innerHeight, tableBottom: tb.getBoundingClientRect().bottom, bodyBottom: body.getBoundingClientRect().bottom, capBottom: cap ? cap.getBoundingClientRect().bottom : 0,
    // the table's own edges, and whether either navigation arrow lies over any cell of it
    left: tb.getBoundingClientRect().left, right: tb.getBoundingClientRect().right, vw: innerWidth,
    underArrow: (() => { const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; const arrows = [...pres.querySelectorAll('.pnav')].map(e => e.getBoundingClientRect());
      return [...tb.querySelectorAll('th, td')].filter(c => arrows.some(a => hit(a, c.getBoundingClientRect()))).length; })(),
    fs: parseFloat(getComputedStyle(tb).fontSize), scrolls: pres.scrollHeight > pres.clientHeight + 1, hscrolls: pres.scrollWidth > pres.clientWidth + 1 || (sc && sc.scrollWidth > sc.clientWidth + 1), n: tb.querySelectorAll('tbody tr').length };
});
const SIZES = [[3840, 2160], [1920, 1080], [1366, 768], [1280, 720], [1024, 768]];
const shot = async (page, name) => { if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, name + '.png') }); } };

try {
// ---- 1 and 2: the card and its per-team slide, at five sizes
let firstDay = null, firstTable = null;
for (const [w, h] of SIZES) {
  const tag = w + 'x' + h;
  REQ = []; const page = await openDeck({ width: w, height: h });
  const G = await day(page);
  if (!firstDay) firstDay = G;
  check('1 ' + tag + ' the day slide is still twelve tiles, four across and three down, one size, nothing running past its tile', G.n === 12 && G.cols === 4 && G.rows === 3 && G.sameW && G.sameH && !G.overflow && !G.figOver && !G.scrolls, JSON.stringify({ n: G.n, c: G.cols, r: G.rows, o: G.overflow, f: G.figOver }));
  check('1 ' + tag + ' every tile still reserves the same two lines (the card\'s line is one of them: no tile grew) and no tile\'s label or last line touches its border', new Set(G.lineCounts).size === 1 && G.lineCounts[0] === 2 && G.margins.every(m => m[0] >= 7 && m[1] >= 7), JSON.stringify(G.lineCounts) + ' ' + JSON.stringify(G.margins));
  await shot(page, 'abn-day-' + tag);
  const k = await show(page, 'abndeduct');
  check('2 ' + tag + ' the per-team slide is the SECOND slide, right after the day\'s', k === 1, 'index ' + k);
  const T = await table(page);
  if (!firstTable) firstTable = T;
  check('2 ' + tag + ' it fits the screen: nothing scrolls, the table and its caption end above the bottom, no cell runs past its own box', !T.scrolls && !T.hscrolls && T.capBottom <= T.vh && T.over.length === 0, JSON.stringify({ over: T.over, cap: Math.round(T.capBottom), vh: T.vh }));
  check('2 ' + tag + ' the table keeps clear of the two navigation arrows (74 pixels in from each edge): no cell lies under either', T.left >= 74 && T.right <= T.vw - 74 && T.underArrow === 0, Math.round(T.left) + ' .. ' + Math.round(T.right) + ' of ' + T.vw + ', cells under an arrow: ' + T.underArrow);
  await shot(page, 'abn-slide-' + tag);
  await page.close();
}
const V = firstDay.tiles['Abnormal'];
check('1 the Abnormal tile is the dashboard\'s own figure (37) with the week\'s deduction cases under it', V && V.v === '37' && JSON.stringify(V.s) === JSON.stringify(['9 deduction cases this week']), JSON.stringify(V));
check('1 every other tile is as it was (no line of the cases anywhere else), and the others still carry their own', Object.entries(firstDay.tiles).filter(([l, x]) => l !== 'Abnormal' && x.s.some(s => /deduction/.test(s))).length === 0 && firstDay.tiles['Defaulters'].s[0] === '4,321 cleared today', JSON.stringify(firstDay.tiles['Defaulters']));
check('2 the slide\'s title, its three columns and its caption say what it is', /Abnormal payments & deduction cases/.test(firstTable.title) && JSON.stringify(firstTable.head) === JSON.stringify(['#', 'Team', 'Abnormal payments', 'Deduction cases (week)']) && /Wiki \/ Week: 2026-11-23 → 2026-11-29/.test(firstTable.caption) && /teams with a deduction case: 3 \/ 5/.test(firstTable.caption), firstTable.title + ' | ' + firstTable.head.join(','));
check('2 a row for each team with an abnormal payment or a case: the most cases first (KONGOWE 4, TANDIKA 3, MBAGALA 2), then the flagged team with none (NYAMA); QUIET, with nothing, is not there',
  JSON.stringify(firstTable.rows.slice(0, 4)) === JSON.stringify([['1', 'KONGOWE', '7', '4'], ['2', 'TANDIKA', '0', '3'], ['3', 'MBAGALA', '20', '2'], ['4', 'NYAMA', '10', '0']]) && firstTable.n === 5, JSON.stringify(firstTable.rows));
check('2 the JUMLA row is the whole: the card\'s 37 abnormal payments and the week\'s 9 deduction cases', JSON.stringify(firstTable.rows[4]) === JSON.stringify(['', 'JUMLA / TOTAL', '37', '9']), JSON.stringify(firstTable.rows[4]));
check('2 the caption says what the two columns are, in Swahili and English', /Abnormal = malipo yaliyowekwa alama kwenye kadi ya Abnormal/.test(firstTable.caption) && /Deduction cases = unique PMO deduction cases reported this week, a case counted once however many staff it names/.test(firstTable.caption), firstTable.caption.slice(0, 200));

// ---- 3: a long list: twelve rows and ONE for the others, the total still the whole
TEAMPERF = Array.from({ length: 24 }, (_, i) => TEAM('TEAM' + String(i + 1).padStart(2, '0'), (i * 5) % 9 + 1));
CARDS = { ...CARDS, abnormal: TEAMPERF.reduce((n, t) => n + t.abnormal, 0) };
DED = { ...DED, cases: 36, teams: Array.from({ length: 8 }, (_, i) => ({ team: 'TEAM' + String(i * 3 + 1).padStart(2, '0'), cases: 8 - i })) };
for (const [w, h] of [[1920, 1080], [1366, 768], [1024, 768]]) {
  const page = await openDeck({ width: w, height: h });
  await show(page, 'abndeduct');
  const T = await table(page);
  const sumCol = i => T.rows.slice(0, -1).reduce((n, r) => n + (Number(String(r[i]).replace(/,/g, '')) || 0), 0);
  check('3 ' + w + 'x' + h + ' twenty-four teams are twelve rows and ONE last row for all the others, and the slide still fits the screen (the type is shrunk to fit, never cut)', T.n === 14 && /^Timu nyingine \/ Other teams \(\d+\)$/.test(T.rows[12][1]) && T.rows[13][1] === 'JUMLA / TOTAL' && !T.scrolls && !T.hscrolls && T.capBottom <= T.vh && T.over.length === 0 && T.fs >= 8, JSON.stringify({ n: T.n, last: T.rows[12], fs: T.fs, cap: Math.round(T.capBottom), vh: T.vh, over: T.over }));
  check('3 ' + w + 'x' + h + ' the JUMLA row is the whole of the list: ' + CARDS.abnormal + ' abnormal payments (the card\'s figure) and 36 cases, shown or not', T.rows[13][2] === String(CARDS.abnormal) && T.rows[13][3] === '36' && sumCol(2) === CARDS.abnormal && sumCol(3) === 36, JSON.stringify([T.rows[13], sumCol(2), sumCol(3)]));
  check('3 ' + w + 'x' + h + ' and on a LONG list no figure is under an arrow (the rows in the middle of the screen are where the arrows are)', T.underArrow === 0 && T.left >= 74 && T.right <= T.vw - 74, 'cells under an arrow: ' + T.underArrow);
  if (w === 1366) await shot(page, 'abn-slide-long-' + w + 'x' + h);
  await page.close();
}
TEAMPERF = SHORT; CARDS = { ...CARDS, abnormal: 37 };
DED = { on: true, note: null, weekOf: '2026-11-23', weekEnd: '2026-11-29', cases: 9, teams: [{ team: 'KONGOWE', cases: 4 }, { team: 'TANDIKA', cases: 3 }, { team: 'MBAGALA', cases: 2 }] };

// ---- 4: when and how it is asked for
REQ = []; let page = await openDeck({ width: 1920, height: 1080 }, HOLDER, { weekOf: '2026-11-16' });
const fns = REQ.map(r => r[0]);
check('4 the cases are asked for ONCE, AFTER the dashboard and the officer boards, never beside them', JSON.stringify(fns) === JSON.stringify(['dashboardFull', 'officerBoards', 'deductionsWeek']), JSON.stringify(fns));
check('4 for the SAME week as the two reads before them (the week bar\'s choice)', REQ.length === 3 && REQ.every(r => r[1] && r[1].weekOf === '2026-11-16'), JSON.stringify(REQ.map(r => r[1])));
// the deck refreshes (while it plays, every three minutes): the dashboard, the boards, then the cases; and the new answer reaches the card
DED = { ...DED, cases: 11, teams: [{ team: 'KONGOWE', cases: 6 }, { team: 'TANDIKA', cases: 3 }, { team: 'MBAGALA', cases: 2 }] };
REQ = [];
await page.evaluate(() => presRefetch());
await page.waitForFunction(() => S.presData.ded && S.presData.ded.cases === 11, null, { timeout: 8000 });
check('4 the refresh asks again, in the same order, and the NEW answer is on the card (11) without a reload', JSON.stringify(REQ.map(r => r[0])) === JSON.stringify(['dashboardFull', 'officerBoards', 'deductionsWeek']), JSON.stringify(REQ.map(r => r[0])));
await page.evaluate(() => { S.presI = 0; presDraw(); }); await page.waitForTimeout(200);
check('4 the card reads 11 deduction cases this week after the refresh', JSON.stringify((await day(page)).tiles['Abnormal'].s) === JSON.stringify(['11 deduction cases this week']));
await page.close();
DED = { on: true, note: null, weekOf: '2026-11-23', weekEnd: '2026-11-29', cases: 9, teams: [{ team: 'KONGOWE', cases: 4 }, { team: 'TANDIKA', cases: 3 }, { team: 'MBAGALA', cases: 2 }] };

// ---- 5: the read FAILS: said on the page, a dash on the card, a blank column, a retry that works
DEDMODE = 'fail';
page = await openDeck({ width: 1920, height: 1080 }, HOLDER, { play: false });
const note = await page.evaluate(() => { const n = [...document.querySelectorAll('.note.bad')].find(x => /Kesi za makato/.test(x.textContent)); return n ? { t: n.textContent.replace(/\s+/g, ' ').trim(), btn: !!n.querySelector('#presDedRetry') } : null; });
check('5 when the read fails the PAGE says so, with the reason and a retry button', !!note && /Kesi za makato hazikupakia \/ the deduction cases did not load/.test(note.t) && /Hifadhidata haikujibu/.test(note.t) && note.btn, JSON.stringify(note));
await page.evaluate(() => { presStart(0); clearInterval(S.presTimer); clearInterval(S.presRefresh); });
await page.waitForFunction(() => document.querySelector('#pres .pkpis')); await page.waitForTimeout(250);
const Gf = await day(page);
check('5 the card\'s line is a DASH (not known), never a nought', JSON.stringify(Gf.tiles['Abnormal'].s) === JSON.stringify(['— deduction cases this week']) && Gf.tiles['Abnormal'].v === '37', JSON.stringify(Gf.tiles['Abnormal']));
await show(page, 'abndeduct');
const Tf = await table(page);
check('5 the per-team slide still lists the abnormal payments, its cases column is BLANK (not a nought) with a blank total, and the caption says it did not load and why',
  Tf.rows.length > 1 && Tf.rows.slice(0, -1).every(r => r[3] === '') && Tf.rows[Tf.rows.length - 1][3] === '' && Tf.rows[Tf.rows.length - 1][2] === '37' && /Kesi za makato hazikupakia/.test(Tf.caption) && /Hifadhidata haikujibu/.test(Tf.caption), JSON.stringify(Tf.rows) + ' ' + Tf.caption.slice(0, 120));
await shot(page, 'abn-slide-failed-1920x1080');
// the retry: the database is back
DEDMODE = 'ok'; REQ = [];
await page.evaluate(() => { presStop(); });
await page.evaluate(() => document.getElementById('presDedRetry').click());
await page.waitForFunction(() => S.presData.ded && S.presData.ded.cases === 9, null, { timeout: 8000 });
await page.waitForTimeout(250);
check('5 the retry asks again (once) and the note is gone, the card reads 9', REQ.filter(r => r[0] === 'deductionsWeek').length === 1 && !(await page.evaluate(() => !!document.getElementById('presDedRetry'))) && (await page.evaluate(() => S.presData.dedWhy === '')));
await page.evaluate(() => { presStart(0); clearInterval(S.presTimer); clearInterval(S.presRefresh); }); await page.waitForTimeout(250);
check('5 and the slide shows the cases now', (await show(page, 'abndeduct')) === 1 && (await table(page)).rows[0][3] === '4');
await page.close();

// ---- 5b: RUN-ME-043 not run: the card says nothing, the slide says so
const DED0 = DED;
DED = { on: false, note: 'Jedwali la makato halipo bado: endesha db/RUN-ME-043-pmo-deductions.sql', weekOf: '2026-11-23', weekEnd: '2026-11-29', cases: 0, teams: [] };
page = await openDeck({ width: 1920, height: 1080 });
check('5 with no deductions table the card says nothing under its figure', JSON.stringify((await day(page)).tiles['Abnormal'].s) === '[]');
await show(page, 'abndeduct');
const To = await table(page);
check('5 and the slide says the table is not there, naming the file, with its column blank', /Jedwali la makato halipo \/ the deductions table is not there yet/.test(To.caption) && /RUN-ME-043/.test(To.caption) && To.rows.slice(0, -1).every(r => r[3] === ''), To.caption.slice(0, 160));
await page.close();
DED = DED0;

// ---- 6: a person who does not hold the PMO Deduction tab
REQ = []; page = await openDeck({ width: 1920, height: 1080 }, OUTSIDER);
check('6 a person without the PMO Deduction tab is NEVER asked for the cases (the two other reads are made)', JSON.stringify(REQ.map(r => r[0])) === JSON.stringify(['dashboardFull', 'officerBoards']), JSON.stringify(REQ.map(r => r[0])));
const Go = await day(page);
check('6 the Abnormal tile has no line, and the day slide is what it was before (twelve tiles, nine of them with lines under their figures)', JSON.stringify(Go.tiles['Abnormal'].s) === '[]' && Go.n === 12 && Object.values(Go.tiles).filter(x => x.s.length).length === 9, JSON.stringify(Go.tiles['Abnormal']));
const ids = await page.evaluate(() => S.slides.map(s => s.id));
check('6 no per-team slide, and the team table is the second slide', !ids.includes('abndeduct') && ids[1] === 'teams', JSON.stringify(ids));
check('6 no note on the page about the cases, and no segment box for the slide', await page.evaluate(() => !document.getElementById('presDedRetry') && !document.querySelector('input.presSeg[value="abndeduct"]')));
await page.close();

// ---- 7: the deck's own choices
page = await openDeck({ width: 1920, height: 1080 }, HOLDER, { play: false });
check('7 the slide has its own segment box, ticked', await page.evaluate(() => { const b = document.querySelector('input.presSeg[value="abndeduct"]'); return !!b && b.checked; }));
await page.evaluate(() => { const b = document.querySelector('input.presSeg[value="abndeduct"]'); b.checked = false; b.dispatchEvent(new Event('change', { bubbles: true })); });
await page.waitForTimeout(250);
check('7 unticked, it is gone from the deck (and nothing was asked of the server for it)', await page.evaluate(() => !S.slides.some(s => s.id === 'abndeduct')) && REQ.filter(r => r[0] === 'deductionsWeek').length === 1);
await page.evaluate(() => { S.presOff = []; try { localStorage.removeItem('hopePresOff'); } catch (e) {} presApply(); S.presTeam = 'MBAGALA'; presApply(); });
const scoped = await page.evaluate(() => { const s = S.slides.find(x => x.id === 'abndeduct'); return s ? s.rows : null; });
check('7 scoped to one team the deck shows that team\'s row, as every board does', JSON.stringify(scoped) === JSON.stringify([{ team: 'MBAGALA', abnormal: 20, dedCases: 2 }]), JSON.stringify(scoped));
await page.close();
} catch (e) { fail.push('the check stopped: ' + String((e && e.message) || e).split('\n')[0].slice(0, 300)); }

check('8 no page error in any world', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close(); srv.close(); console.warn = warn;
for (const f of fail) console.log('FAIL  ' + f);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
