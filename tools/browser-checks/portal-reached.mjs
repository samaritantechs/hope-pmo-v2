/* REACHED MEANS SPOKEN TO, on the screens: the REAL public/app.html, public/mod/reports.js and public/mod/present.js in a real browser,
   talking to the REAL portalApi over the repository's own fake database, in the two states the live book passes through.

     "At calls slide in presentation "REACHED %" Should be percentage of connected calls against calls not just dialled b/se some ring
      but dont get connected" -- the owner, 23 Nov 2026 (handbook Part 137)

   What it proves:
     1. with db/RUN-ME-088 run, the Call Reports tab shows Reached as the numbers spoken to (3 of 8, not 7 of 8), says what Reached
        means, lists NO ANSWER among the outcomes, and the Presentation's calls slide carries Reached % and says the minimum in its title;
     2. on a database where the file has NOT been run, the same screens draw without an error, the Reached tile is a dash that names the
        file, the red line names the file, the Reached cells and their totals are BLANK (never 0 and never the old figure), every other
        figure is as it was, and the slide's title says Reached % is waiting.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-reached.mjs

   CHROME overrides the browser path. Exit code 0 = everything passed. The dates are worked out from today, so it runs on any day. */
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
const { CALL_REPORT_RPC, CALL_REPORT_OLD_RPC, CALL_BOARD_RPC, CALL_BOARD_OLD_RPC } = await import(path.join(ROOT, 'test/snapshot-totals-rpc.mjs'));
const { portalApi } = await import(path.join(ROOT, 'api/_lib/portal-core.js'));
const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
const TODAY = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);          // the Dar es Salaam day the server counts by

/* One officer's morning (test/reached-rule.test.mjs has the same book): seven numbers, nine dials, two spoken to; BEN has one. */
const L = (id, uid, officer, team, tail, dur, extra = {}) => ({ id, user_id: uid, officer, team, phone: '07000000' + tail, call_date: TODAY,
  duration: dur, portfolio: true, category: 'EXPECTED', outcome: 'CONNECTED', ref: 'R' + tail, ...extra });
const calls = () => [
  L('c01', 'u1', 'ASHA K', 'KONGOWE', '01', 40), L('c02', 'u1', 'ASHA K', 'KONGOWE', '02', 0), L('c03', 'u1', 'ASHA K', 'KONGOWE', '03', 3),
  L('c04', 'u1', 'ASHA K', 'KONGOWE', '04', 0), L('c05', 'u1', 'ASHA K', 'KONGOWE', '04', 25), L('c06', 'u1', 'ASHA K', 'KONGOWE', '05', 5),
  L('c07', 'u1', 'ASHA K', 'KONGOWE', '06', 2), L('c08', 'u1', 'ASHA K', 'KONGOWE', '06', 4),
  L('c09', 'u1', 'ASHA K', 'KONGOWE', '07', 60, { outcome: 'MISSED' }),
  L('c10', 'u2', 'BEN M', 'MBAGALA', '08', 6, { portfolio: false, category: null, ref: '' }),
];
const book = rpc => fakeDb({
  teams: [{ team: 'KONGOWE', team_code: 'KON1', expected: 'ASHA K' }, { team: 'MBAGALA', team_code: 'MBA1', recovery: 'BEN M' }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }, { key: 'CALL_MIN_SECS', value: '5' }],
  access_codes: [{ code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['calls', 'present', 'dashboard'] }],
  call_users: [{ user_id: 'u1', name: 'ASHA K', team: 'KONGOWE', role: 'OFFICER', active: true }, { user_id: 'u2', name: 'BEN M', team: 'MBAGALA', role: 'OFFICER', active: true }],
  call_logs: calls(), roles: [], audit_log: [],
}, { rpc });
const WORLDS = { run: book({ ...CALL_REPORT_RPC, ...CALL_BOARD_RPC }), notRun: book({ ...CALL_REPORT_OLD_RPC, ...CALL_BOARD_OLD_RPC }) };
let db = WORLDS.run;
const USER = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['calls', 'present', 'dashboard'] };
const REAL = new Set(['callReport', 'dashboardFull', 'officerBoards']);

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname.startsWith('/app') || u.pathname === '/dashboard') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return; }
  if (u.pathname.startsWith('/mod/')) {
    const f = path.join(ROOT, 'public', u.pathname);
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

async function open(world) {
  db = WORLDS[world];
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', e => errs.push(world + ': ' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push(world + ' console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(8000);
  await page.goto(base + '/');
  await page.evaluate(m => { S.code = 'ADM'; start(m); }, ME);
  await page.waitForTimeout(400);
  return page;
}
// the Call Reports tab: its tiles, its notes, and a board's cells by column label
const callsTab = async page => {
  await page.evaluate(() => go('calls'));
  await page.waitForFunction(() => /Reached/.test(document.getElementById('view').textContent), null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const tiles = {}; document.querySelectorAll('#view .kpi').forEach(k => { tiles[(k.querySelector('.l') || {}).textContent] = [(k.querySelector('.v') || {}).textContent, (k.querySelector('.s') || {}).textContent || '']; });
    const boardOf = id => {
      const t = document.querySelector('#' + id + ' table');            // board() draws <div class="card" id="..."> around its table
      if (!t) return null;
      const head = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
      const cellsOf = tr => [...tr.children].map(td => td.textContent.trim());
      const isTotal = tr => !!tr.closest('tfoot') || /tot/i.test(tr.className);
      const all = [...t.querySelectorAll('tbody tr, tfoot tr')];
      return { head, rows: all.filter(tr => !isTotal(tr)).map(cellsOf), foot: all.filter(isTotal).map(cellsOf) };
    };
    return { tiles, notes: [...document.querySelectorAll('#view .note')].map(n => [n.className, n.textContent]), cat: boardOf('clCat'), out: boardOf('clOut'), html: document.getElementById('view').innerHTML.length };
  });
};
const colOf = (b, label) => { const i = b.head.findIndex(h => h.replace(/[^A-Za-z% ]/g, '').trim() === label); return { i, cells: b.rows.map(r => r[i]), foot: b.foot.map(r => r[i]) }; };
// the Presentation: the calls slide as the page built it, then drawn
const callsSlide = async page => {
  await page.evaluate(() => go('present'));
  await page.waitForFunction(() => window.S && S.slides && S.slides.some(s => s.id === 'calls') && S.presData && S.presData.b, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const i = S.slides.findIndex(s => s.id === 'calls'); if (i < 0) return null;
    const s = S.slides[i];
    S.presI = i; presDraw();
    const stage = document.body;
    const t = document.querySelector('table.ptable');                  // presDraw's own table
    const head = t ? [...t.querySelectorAll('thead th')].map(th => th.textContent.trim()) : [];
    const rows = t ? [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim())) : [];
    return { title: s.title, rows: s.rows.map(r => [r.agent, r.calls, r.connected, r.connectPct]), head, cells: rows, shown: stage.textContent.includes(s.title) };
  });
};

/* ---- 1. db/RUN-ME-088 run ---- */
{
  const page = await open('run');
  const c = await callsTab(page);
  check('1 the Reached tile is the numbers spoken to: 3, 38% of numbers (it was 7 of 8)', c.tiles.Reached && c.tiles.Reached[0] === '3' && /38% of numbers/.test(c.tiles.Reached[1]), JSON.stringify(c.tiles.Reached));
  check('1 the Calls tile is unchanged: 8 numbers, 10 dials', c.tiles.Calls && c.tiles.Calls[0] === '8' && /10 dials/.test(c.tiles.Calls[1]), JSON.stringify(c.tiles.Calls));
  check('1 the screen says what Reached means, with the minimum', c.notes.some(n => /Reached = a number spoken to for longer than 5 seconds/.test(n[1])));
  check('1 no red line about a file to run', !c.notes.some(n => /RUN-ME-088/.test(n[1])));
  check('1 the category board is drawn', !!c.cat && c.cat.rows.length === 2, c.cat ? JSON.stringify(c.cat.head) : 'not found');
  if (c.cat) {
    const r = colOf(c.cat, 'Reached'), p = colOf(c.cat, 'Reached %');
    check('1 by category: Reached 2 and 1, total 3', JSON.stringify(r.cells) === '["2","1"]' && r.foot[0] === '3', JSON.stringify([r.cells, r.foot]));
    check('1 by category: Reached % 28.6% and 100%', /^28\.6%$|^29%$/.test(p.cells[0]) && /^100(\.0)?%$/.test(p.cells[1]), JSON.stringify(p.cells));
  }
  check('1 the outcome board lists CONNECTED, NO ANSWER, MISSED with their dials', !!c.out && JSON.stringify(colOf(c.out, 'Outcome').cells.map((o, i) => [o, colOf(c.out, 'Dials').cells[i]])) === '[["CONNECTED","3"],["NO ANSWER","6"],["MISSED","1"]]', c.out ? JSON.stringify(c.out.rows) : 'not found');
  const s = await callsSlide(page);
  check('1 the calls slide is built', !!s && s.rows.length >= 2, s ? '' : 'no slide with id calls');
  if (s) {
    check('1 the slide\'s title says the minimum', / · Reached = waliongea zaidi ya sek 5 \/ spoken to for over 5 s/.test(s.title), s.title);
    const asha = s.rows.find(r => r[0] === 'ASHA K');
    check('1 the slide\'s row: ASHA K rang 7, reached 2, 28.6%', !!asha && asha[1] === 7 && asha[2] === 2 && asha[3] === 28.6, JSON.stringify(asha));
    const i = s.head.indexOf('Reached %'), row = s.cells.find(r => r.includes('ASHA K'));
    check('1 the slide draws Reached % for her', i >= 0 && !!row && /^(28\.6|29)%$/.test(row[i]), JSON.stringify([s.head, row]));
  }
  await page.close();
}
/* ---- 2. the file NOT run: the state of the live book after the deploy and before the paste ---- */
{
  const page = await open('notRun');
  const c = await callsTab(page);
  check('2 the screen draws (tiles, boards)', c.html > 2000 && !!c.cat && !!c.out, 'view length ' + c.html);
  check('2 the Reached tile is a dash that names the file', c.tiles.Reached && c.tiles.Reached[0] === '—' && /waits for db\/RUN-ME-088/.test(c.tiles.Reached[1]), JSON.stringify(c.tiles.Reached));
  check('2 the Calls tile is the figure it always was', c.tiles.Calls && c.tiles.Calls[0] === '8' && /10 dials/.test(c.tiles.Calls[1]), JSON.stringify(c.tiles.Calls));
  check('2 the red line names the file', c.notes.some(n => /bad/.test(n[0]) && /db\/RUN-ME-088-reached-is-a-conversation\.sql/.test(n[1])));
  check('2 the rule line does not claim a minimum', !c.notes.some(n => /Reached = a number spoken to/.test(n[1])));
  if (c.cat) {
    const r = colOf(c.cat, 'Reached'), p = colOf(c.cat, 'Reached %'), k = colOf(c.cat, 'Calls');
    check('2 by category: the Reached cells and their total are BLANK, not 0 and not the old figure', r.cells.every(x => x === '') && r.foot.every(x => x === ''), JSON.stringify([r.cells, r.foot]));
    check('2 by category: the Reached % cells and their total are BLANK', p.cells.every(x => x === '') && p.foot.every(x => x === ''), JSON.stringify([p.cells, p.foot]));
    check('2 by category: Calls are as they were (7 and 1, total 8)', JSON.stringify(k.cells) === '["7","1"]' && k.foot[0] === '8', JSON.stringify([k.cells, k.foot]));
  }
  const s = await callsSlide(page);
  check('2 the calls slide is built', !!s && s.rows.length >= 2);
  if (s) {
    check('2 the slide\'s title says Reached % is waiting for the file', / · Reached % inasubiri \/ waits for db\/RUN-ME-088/.test(s.title), s.title);
    check('2 no row of the slide carries a reached figure', s.rows.every(r => r[2] === null && r[3] === null), JSON.stringify(s.rows.slice(0, 3)));
    const i = s.head.indexOf('Reached %'), ci = s.head.indexOf('Calls'), row = s.cells.find(r => r.includes('ASHA K'));
    check('2 the slide draws a blank under Reached % and her calls as they were', i >= 0 && !!row && row[i] === '' && row[ci] === '7', JSON.stringify([s.head, row]));
  }
  await page.close();
}

await browser.close(); srv.close();
for (const o of ok) console.log('  ok   ' + o);
for (const f of fail) console.log('  FAIL ' + f);
for (const e of errs) console.log('  PAGE ERROR ' + e);
console.log(`${ok.length} passed, ${fail.length} failed, ${errs.length} page errors`);
process.exit(fail.length || errs.length ? 1 : 0);
