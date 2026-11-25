/* THE HOPE CALLS SLIDE IS RANKED BY PORTFOLIO TALK TIME, NOT BY CALLS. The REAL public/app.html and public/mod/present.js in a real browser, talking to the REAL
   portalApi over the repository's own fake database (the database functions of RUN-ME-078 and RUN-ME-088 stood in for by the tests' own stand-ins, and the same book
   read WITHOUT them, the road the board takes where they are not installed).

     "Sort busiest and least active officers slide by portifolio talk time brother not calls" -- the owner, 25 Nov 2026 (handbook Part 164, addendum 7)

   The book: twenty officers of the three PMO units and one who belongs to none (and has the most talk of all of them), made so that the order by calls and the order by
   portfolio talk time are very different: the officer who rang the MOST numbers (forty-three, thirty-eight of them not portfolio, and not one portfolio call answered) must
   be at the red end, and the one who rang fourteen and talked an hour and a half at the top.

   What it proves, at the sizes a TV and a laptop really are (3840x2160, 1920x1080, 1366x768, 1280x720, 1024x768):

     1. the slide lists the twenty officers of the three units, in descending portfolio talk time (the PORTFOLIO TALK column, as the wall prints it, never rises going down), the
        ones with no talk last, ordered by calls among themselves; the officer of no unit is not on it;
     2. the first six rows say Busiest and are green, the last six say Least active and are red, and the seventh from the bottom, who is only red because he has no portfolio
        talk (the one who rang the most numbers of all), is red too: the mark follows the key; the ones between are not marked;
     3. the Calls column is NOT in descending order (it is not what is ranked), and the title says what the slide is ranked by;
     4. the same on the road where the database function is not installed (the rows read and added up by the portal);
     5. no cell runs past its own box and the slide fits its screen, at each size; the picture is looked at (SHOTS=<dir>);
     6. no page error in any world.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-present-calls-talk-order.mjs

   CHROME overrides the browser path; APP_FILE and MOD_DIR run it against another copy of the page and of the modules (the page and the server as they stood before this change
   show what the check is for: run from a copy of the repository); SHOTS=<dir> saves pictures. Exit code 0 = everything passed. The dates are worked out from today. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
const { fakeDb } = await import(path.join(ROOT, 'test/fake-db.mjs'));
const { CALL_REPORT_RPC, CALL_BOARD_RPC } = await import(path.join(ROOT, 'test/snapshot-totals-rpc.mjs'));
const { portalApi } = await import(path.join(ROOT, 'api/_lib/portal-core.js'));
const APP = fs.readFileSync(process.env.APP_FILE || path.join(ROOT, 'public/app.html'), 'utf8');
const MOD_DIR = process.env.MOD_DIR || path.join(ROOT, 'public/mod');
const TODAY = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);          // the Dar es Salaam day the server counts by

/* THE BOOK. [name, unit, team, numbers rung with a portfolio customer, seconds of talk on them, numbers rung that are not portfolio]
   Thirteen officers talked, in the order of their talk; seven did not, in the order of their calls. PAUL X is of no unit and talked the most. */
const OFFICERS = [
  ['AMINA K', 'EXPECTED', 'T01', 14, 5400, 0], ['BAKARI J', 'COLLECTION', 'T02', 31, 4800, 0], ['CHAUSIKU M', 'RECOVERY', 'T01', 9, 4500, 0],
  ['DAUDI R', 'EXPECTED', 'T02', 25, 3900, 0], ['EMMA T', 'COLLECTION', 'T03', 22, 3300, 0], ['FADHILI S', 'RECOVERY', 'T02', 17, 3000, 0],
  ['GRACE N', 'EXPECTED', 'T03', 40, 2400, 0], ['HAMISI O', 'COLLECTION', 'T04', 12, 1800, 0], ['IDDI P', 'RECOVERY', 'T03', 8, 1500, 0],
  ['JANETH L', 'EXPECTED', 'T04', 19, 900, 0], ['KASIM V', 'COLLECTION', 'T05', 6, 420, 0], ['LUCY W', 'RECOVERY', 'T04', 11, 130, 0],
  ['MWITA B', 'EXPECTED', 'T05', 3, 25, 0],
  ['NEEMA Z', 'COLLECTION', 'T06', 5, 0, 38], ['OMARI Q', 'RECOVERY', 'T05', 30, 0, 0], ['PENDO D', 'EXPECTED', 'T06', 12, 0, 0], ['QUEEN A', 'COLLECTION', 'T07', 7, 0, 0],
  ['RAJAB H', 'RECOVERY', 'T06', 4, 0, 0], ['SALMA G', 'EXPECTED', 'T07', 2, 0, 0], ['TUMAINI F', 'RECOVERY', 'T07', 0, 0, 0],
  ['PAUL X', null, 'T01', 20, 9000, 0],
];
const WANT = OFFICERS.filter(o => o[1]).map(o => o[0]);                                   // the slide's rows, top to bottom
const calls = () => {
  const rows = []; let n = 0;
  for (const [name, , team, rung, talk, other] of OFFICERS) {
    for (let i = 0; i < rung; i++) {
      const secs = rung ? Math.floor(talk / rung) + (i === 0 ? talk % rung : 0) : 0;
      rows.push({ id: 'c' + String(1000 + n++), user_id: 'u-' + name, officer: name, team, phone: '07' + String(10000000 + n), call_date: TODAY, duration: secs, portfolio: true,
        ref: 'R' + n, category: 'EXPECTED', outcome: secs > 5 ? 'CONNECTED' : 'MISSED' });
    }
    for (let i = 0; i < other; i++) rows.push({ id: 'c' + String(1000 + n++), user_id: 'u-' + name, officer: name, team, phone: '07' + String(10000000 + n), call_date: TODAY, duration: 20,
      portfolio: false, ref: null, category: null, outcome: 'CONNECTED' });
  }
  return rows;
};
const book = rpc => fakeDb({
  teams: [['T01', 'AMINA K', 'CHAUSIKU M'], ['T02', 'DAUDI R', 'FADHILI S'], ['T03', 'GRACE N', 'IDDI P'], ['T04', 'JANETH L', 'LUCY W'], ['T05', 'MWITA B', 'OMARI Q'],
    ['T06', 'PENDO D', 'RAJAB H'], ['T07', 'SALMA G', 'TUMAINI F']].map(([team, expected, recovery]) => ({ team, team_code: 'C-' + team, expected, recovery })),
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }, { key: 'CALL_MIN_SECS', value: '5' }],
  access_codes: [{ code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['calls', 'present', 'dashboard'] },
    ...['BAKARI J', 'EMMA T', 'HAMISI O', 'KASIM V', 'NEEMA Z', 'QUEEN A'].map((name, i) => ({ code: 'COL' + i, name, role: 'PMO COLLECTION', teams: ['T0' + (i + 1)], tabs: [] }))],
  call_users: OFFICERS.map(([name, , team]) => ({ user_id: 'u-' + name, name, team, role: 'OFFICER', active: true })),
  call_logs: calls(), roles: [], audit_log: [],
}, { rpc });
const WORLDS = { run: book({ ...CALL_REPORT_RPC, ...CALL_BOARD_RPC }), rows: book({}) };
let db = WORLDS.run;
const USER = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['calls', 'present', 'dashboard'] };
const REAL = new Set(['callReport', 'dashboardFull', 'officerBoards']);
const warn = console.warn; console.warn = () => {};

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname.startsWith('/app') || u.pathname === '/dashboard') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return; }
  if (u.pathname.startsWith('/mod/')) {
    const f = path.join(MOD_DIR, path.basename(u.pathname));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(f)); return; }
  }
  if (u.pathname === '/api/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, build: null })); return; }
  if (u.pathname === '/api/portal') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', async () => {
      const { fn, args } = JSON.parse(b || '{}');
      let out;
      try { out = REAL.has(fn) ? await portalApi(db, USER, fn, args || {}) : { rows: [] }; }
      catch (e) { res.writeHead(e.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, ...out, workspace: 'hopepmo' }));
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
const BENIGN = /favicon|status of 404|ERR_FAILED|brand|status of 500/;
const UI = { presentSeconds: 3600, refreshSeconds: 6000, hintIntervalSeconds: 3600, hintLifetimeSeconds: 5 };
const ME = { name: 'THE ADMIN', role: 'ADMIN', teams: null, teamCount: null, tabs: ['dashboard', 'calls', 'present'], can: { dashboard: true, upload: false, admin: true }, ui: UI };
const SIZES = [[3840, 2160], [1920, 1080], [1366, 768], [1280, 720], [1024, 768]];
const shot = async (page, name) => { if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, name + '.png') }); } };

async function open(world, size) {
  db = WORLDS[world];
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
  page.on('pageerror', e => errs.push(world + ' ' + size.join('x') + ': ' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push(world + ' console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(9000);
  await page.goto(base + '/');
  await page.evaluate(m => { S.code = 'ADM'; start(m); }, ME);
  await page.waitForTimeout(300);
  await page.evaluate(() => go('present'));
  await page.waitForFunction(() => window.S && S.slides && S.slides.some(s => s.id === 'calls') && S.presData && S.presData.b, null, { timeout: 15000 });
  await page.evaluate(() => { presStart(0); clearInterval(S.presTimer); clearInterval(S.presRefresh); });
  await page.waitForTimeout(250);
  return page;
}
// the HOPE Calls slide as the page built it and as the wall draws it
const slideOf = page => page.evaluate(async () => {
  const i = S.slides.findIndex(s => s.id === 'calls'); if (i < 0) return null;
  S.presI = i; presDraw();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const pres = document.getElementById('pres'), tb = pres.querySelector('.ptable'), clean = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
  const trs = [...tb.querySelectorAll('tbody tr')];
  const cells = trs.map(tr => [...tr.children].map(clean));
  const mark = trs.map(tr => { const td = tr.children[1]; return { text: clean(td), cls: td.className.trim() }; });
  const s = S.slides[i];
  return { title: s.title, head: [...tb.querySelectorAll('thead th')].map(clean), cells, mark, model: s.rows.map(r => [r.agent, r.calls, r.duration, r.end]),
    /* a cell whose text runs past its own box. ONE exception, proved harmless by its own condition: the total row's label (JUMLA / TOTAL) is written in the narrow mark column and
       spills over the officer cell beside it, which is empty on that row (so nothing is under it): it did so before this change, at 1024 px (checked on the code as it was) */
    over: [...tb.querySelectorAll('th, td')].filter(c => c.scrollWidth > c.clientWidth + 1 && !(/JUMLA|TOTAL/i.test(c.textContent) && c.nextElementSibling && !clean(c.nextElementSibling))).map(clean),
    totalLabelOver: [...tb.querySelectorAll('td')].filter(c => /JUMLA|TOTAL/i.test(c.textContent) && c.scrollWidth > c.clientWidth + 1).map(c => [clean(c), clean(c.nextElementSibling || c)]),
    scrolls: pres.scrollHeight > pres.clientHeight + 1,
    hscrolls: pres.scrollWidth > pres.clientWidth + 1, tableBottom: tb.getBoundingClientRect().bottom, vh: innerHeight, fs: parseFloat(getComputedStyle(tb).fontSize) };
});
const secs = t => { if (t == null || t === '' || t === '—') return 0; const p = String(t).split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0]; };
const isTotal = r => /JUMLA|TOTAL/i.test(r.join(' '));

try {
  // ---- 1 to 5: the drawn slide at five sizes, from the real server's answer
  let first = null;
  for (const [w, h] of SIZES) {
    const tag = w + 'x' + h;
    const page = await open('run', [w, h]);
    const s = await slideOf(page);
    check(tag + ' the slide is built', !!s);
    if (!s) { await page.close(); continue; }
    if (!first) first = s;
    const H = re => s.head.findIndex(x => re.test(x));
    const iOff = H(/^Officer$/), iCalls = H(/^Calls$/), iTalk = H(/^Portfolio talk$/);
    const rows = s.cells.filter(r => !isTotal(r)), marks = s.mark.slice(0, rows.length);
    check(tag + ' the columns are the nine it always had, the mark column first after the row number', iOff === 2 && iCalls === 5 && iTalk === 7 && H(/^Dials$/) === 6 && H(/^Portfolio$/) === 8 && H(/^Reached %$/) === 9 && s.head.length === 10, JSON.stringify(s.head));
    check(tag + ' it lists the twenty officers of the three units and not the one of no unit, in the order of their portfolio talk, then (for the ones who did not talk) their calls',
      JSON.stringify(rows.map(r => r[iOff])) === JSON.stringify(WANT), JSON.stringify(rows.map(r => r[iOff])));
    const talk = rows.map(r => secs(r[iTalk])), call = rows.map(r => Number(r[iCalls]));
    check(tag + ' the PORTFOLIO TALK column never rises going down (the S/N reads as one ranking)', talk.length === 20 && talk.every((t, i) => !i || talk[i - 1] >= t), JSON.stringify(talk));
    check(tag + ' the first row talked an hour and a half (1:30:00) on fourteen numbers; the busiest by CALLS is NOT first', rows[0][iTalk] === '1:30:00' && rows[0][iCalls] === '14' && rows[0][iOff] === 'AMINA K', JSON.stringify(rows[0]));
    check(tag + ' the Calls column is NOT in descending order: it is not what is ranked', !call.every((c, i) => !i || call[i - 1] >= c), JSON.stringify(call));
    const redIdx = marks.map((m, i) => (m.text === 'Least active' ? i : -1)).filter(i => i >= 0), greenIdx = marks.map((m, i) => (m.text === 'Busiest' ? i : -1)).filter(i => i >= 0);
    check(tag + ' the first six say Busiest, in green', JSON.stringify(greenIdx) === '[0,1,2,3,4,5]' && greenIdx.every(i => /(^| )good( |$)/.test(marks[i].cls)), JSON.stringify(marks.slice(0, 7)));
    check(tag + ' the last six say Least active, in red, and so does the seventh from the bottom, who is red only because he has no portfolio talk',
      JSON.stringify(redIdx) === '[13,14,15,16,17,18,19]' && redIdx.every(i => /(^| )bad( |$)/.test(marks[i].cls)), JSON.stringify(marks.slice(11)));
    check(tag + ' that officer rang the most numbers of anybody on the slide (43) and talked to no portfolio customer: the first of the red', rows[13][iOff] === 'NEEMA Z' && rows[13][iCalls] === '43' && rows[13][iTalk] === '0:00' && Math.max(...call) === 43, JSON.stringify(rows[13]));
    check(tag + ' the ones between are not marked', marks.slice(6, 13).every(m => m.text === '' && !/good|bad/.test(m.cls)), JSON.stringify(marks.slice(6, 13)));
    check(tag + ' the title says what the slide is ranked by', /busiest first by time talking to customers/.test(s.title) && /not by calls made/.test(s.title) && !/numbers rung, not dials/.test(s.title), s.title);
    check(tag + ' the page\'s own rows say the same (the model the wall draws)', JSON.stringify(s.model.map(m => m[0])) === JSON.stringify(WANT) && s.model[13][3] === 'Least active' && s.model[0][3] === 'Busiest', JSON.stringify(s.model.slice(11, 15)));
    check(tag + ' no cell runs past its own box, and the slide scrolls nowhere', s.over.length === 0 && !s.scrolls && !s.hscrolls, JSON.stringify({ over: s.over.slice(0, 4), scrolls: s.scrolls, hscrolls: s.hscrolls }));
    check(tag + ' the table ends inside the screen', s.tableBottom <= s.vh + 1, 'table bottom ' + Math.round(s.tableBottom) + ' of ' + s.vh);
    check(tag + ' the total row is there, and its label spills over nothing but an empty cell', s.cells.some(isTotal) && s.totalLabelOver.every(([label, next]) => next === ''), JSON.stringify(s.totalLabelOver));
    if (w === 1920 || w === 1366 || w === 1024) await shot(page, 'calls-slide-' + tag);
    await page.close();
  }
  // ---- 4: the road where the database function is not installed: the same ranking, from the rows
  {
    const page = await open('rows', [1920, 1080]);
    const s = await slideOf(page);
    check('rows: the slide is built where the database function is not installed', !!s);
    if (s) {
      const iOff = s.head.findIndex(x => /^Officer$/.test(x)), rows = s.cells.filter(r => !isTotal(r));
      check('rows: the same twenty officers in the same order', JSON.stringify(rows.map(r => r[iOff])) === JSON.stringify(WANT), JSON.stringify(rows.map(r => r[iOff])));
      check('rows: the same marks (six green, seven red)', s.mark.filter(m => m.text === 'Busiest').length === 6 && s.mark.filter(m => m.text === 'Least active').length === 7);
    }
    await page.close();
  }
} finally {
  await browser.close(); srv.close(); console.warn = warn;
}
for (const o of ok) console.log('  ok   ' + o);
for (const f of fail) console.log('  FAIL ' + f);
for (const e of errs) console.log('  PAGE ERROR ' + e);
console.log(`${ok.length} passed, ${fail.length} failed, ${errs.length} page errors`);
process.exit(fail.length || errs.length ? 1 : 0);
