/* THE PRESENTATION OPENS ON 45 SECONDS A SLIDE: the REAL public/app.html and public/mod/present.js in a real browser, the seconds
   answered by the REAL uiCadences (api/me.js) over the repository's own fake database, the slides by the REAL portalApi.

     "change default slide seconds from 15 to 45 please" -- the owner, 24 Nov 2026 (handbook Part 146)

   What it proves, in three worlds:

     A. Settings holds no PRESENT_SECONDS: the tab's tile says 45, the Seconds box holds 45, Play starts a 45-second clock;
        a slide changed by hand and the way back from the black screen restart it on 45; a number typed in the box wins
        (60), and the tile follows it;
     B. Settings holds PRESENT_SECONDS = 20: the tile, the box and the clock say 20 (a row in Settings wins over the default);
     C. a sign-in answer that carries no cadences at all (a settings table that did not answer): the page's own default is the same 45;
     D. a sign-in answer that carries the other cadences and no seconds (a server older than this change): the same 45;
     and no page error in any of them.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-present-seconds.mjs

   CHROME overrides the browser path; APP_FILE and MOD_DIR run it against another copy of the page and of the modules.
   Exit code 0 = everything passed. */
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
const { portalApi } = await import(path.join(ROOT, 'api/_lib/portal-core.js'));
const { uiCadences } = await import(path.join(ROOT, 'api/me.js'));
const APP = fs.readFileSync(process.env.APP_FILE || path.join(ROOT, 'public/app.html'), 'utf8');
const MOD_DIR = process.env.MOD_DIR || path.join(ROOT, 'public/mod');

const book = settings => fakeDb({
  teams: [{ team: 'KONGOWE', team_code: 'C-K', branch: null, zone: 'DAR', opm: null, recovery: null, gmo: null, manager: null, credit: null, expected: null, bike: null }],
  access_codes: [{ code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['dashboard', 'present'] }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }].concat(settings), roles: [], audit_log: [],
});
const USER = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['dashboard', 'present'] };
const REAL = new Set(['dashboardFull', 'officerBoards']);
const warn = console.warn; console.warn = () => {};
let db = book([]);

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
const BENIGN = /favicon|status of 404|ERR_FAILED|brand|status of 500|fullscreen|Fullscreen/;

/** Open the Presentation tab in a fresh page signed in with this `ui`, and hand back the page with its slide-clock spy. */
async function open(world, ui) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', e => errs.push(world + ': ' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push(world + ' console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(15000);
  // every clock the page starts is written down: the slide clock is the one that is neither the refetch nor a short housekeeping one
  await page.addInitScript(() => { window.__iv = []; const o = window.setInterval; window.setInterval = function (f, ms) { window.__iv.push(ms); return o.apply(this, arguments); }; });
  await page.goto(base + '/');
  const me = { name: 'THE ADMIN', role: 'ADMIN', teams: null, teamCount: null, tabs: ['dashboard', 'present'], can: { dashboard: true, upload: false, admin: true } };
  if (ui) me.ui = ui;
  await page.evaluate(m => { S.code = 'ADM'; start(m); }, me);
  await page.waitForTimeout(300);
  await page.evaluate(() => go('present'));
  await page.waitForFunction(() => !!document.getElementById('presSecs') && window.S && S.slides && S.slides.length > 0);
  return page;
}
const shown = page => page.evaluate(() => {
  const txt = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
  const tile = [...document.querySelectorAll('#view .kpi')].map(txt).find(t => /Seconds per slide/.test(t)) || '';
  return { tile, box: document.getElementById('presSecs').value, secs: S.presSecs };
});
/** The slide clocks started since the last call: every setInterval that is neither the three-minute refetch nor a page housekeeping clock. */
const clocks = page => page.evaluate(() => { const refetch = typeof PRES_REFRESH_MS === 'number' ? PRES_REFRESH_MS : -1;
  const a = window.__iv.filter(ms => ms !== refetch && ms >= 5000 && ms <= 300000 && ms % 1000 === 0); window.__iv.length = 0; return a; });
const play = async page => { await clocks(page); await page.click('#presStart'); await page.waitForFunction(() => document.getElementById('pres').style.display === 'block'); };
const stop = async page => { await page.evaluate(() => presStop()); };

/* ---- A: no row in Settings ---- */
db = book([]);
let ui = await uiCadences(db);
check('A the server answers 45 seconds when Settings holds no PRESENT_SECONDS', ui.presentSeconds === 45, JSON.stringify(ui));
let page = await open('A', ui);
let s = await shown(page);
check('A the tile says 45', /Seconds per slide\s*45(?!\d)/.test(s.tile), s.tile);
check('A the Seconds box holds 45', s.box === '45', s.box);
await play(page);
let c = await clocks(page);
check('A Play starts a 45-second clock, and only one', c.filter(ms => ms === 45000).length === 1 && !c.includes(15000), JSON.stringify(c));
await page.keyboard.press('ArrowRight');
c = await clocks(page);
check('A a slide changed by hand restarts the clock on 45 seconds', JSON.stringify(c) === '[45000]', JSON.stringify(c));
await page.keyboard.press('b'); await page.waitForTimeout(100);
await page.evaluate(() => presBlank(false));
c = await clocks(page);
check('A back from the black screen the clock runs on 45 seconds', JSON.stringify(c) === '[45000]', JSON.stringify(c));
await stop(page);
await page.fill('#presSecs', '60');
await play(page);
c = await clocks(page);
check('A a number typed in the box wins: 60 seconds', c.filter(ms => ms === 60000).length === 1 && !c.includes(45000), JSON.stringify(c));
await stop(page);
await page.fill('#presSecs', '');
await play(page);
c = await clocks(page);
check('A the box emptied: Play falls back to 45, never 15', c.filter(ms => ms === 45000).length === 1 && !c.includes(15000), JSON.stringify(c));
await stop(page);
await page.close();

/* ---- B: a row in Settings wins ---- */
db = book([{ key: 'PRESENT_SECONDS', value: '20' }]);
ui = await uiCadences(db);
check('B the server answers the setting when Settings holds one (20)', ui.presentSeconds === 20, JSON.stringify(ui));
page = await open('B', ui);
s = await shown(page);
check('B the tile and the box say 20', /Seconds per slide\s*20(?!\d)/.test(s.tile) && s.box === '20', s.tile + ' | ' + s.box);
await play(page);
c = await clocks(page);
check('B Play starts a 20-second clock', c.filter(ms => ms === 20000).length === 1 && !c.includes(45000), JSON.stringify(c));
await stop(page);
await page.close();

/* ---- C: an answer with no seconds at all ---- */
db = book([]);
page = await open('C', null);
s = await shown(page);
check('C with no seconds in the sign-in answer the page\'s own default is the same 45', /Seconds per slide\s*45(?!\d)/.test(s.tile) && s.box === '45', s.tile + ' | ' + s.box);
await play(page);
c = await clocks(page);
check('C Play starts a 45-second clock', c.filter(ms => ms === 45000).length === 1 && !c.includes(15000), JSON.stringify(c));
await stop(page);
await page.close();

/* ---- D: an answer that has the other cadences and no seconds (a server older than this change, or a settings row that is no number) ---- */
page = await open('D', { refreshSeconds: 90, hintIntervalSeconds: 240, hintLifetimeSeconds: 7 });
s = await shown(page);
check('D an answer with cadences but no seconds: the tile and the box say 45', /Seconds per slide\s*45(?!\d)/.test(s.tile) && s.box === '45', s.tile + ' | ' + s.box);
await play(page);
c = await clocks(page);
check('D Play starts a 45-second clock', c.filter(ms => ms === 45000).length === 1 && !c.includes(15000), JSON.stringify(c));
await stop(page);
await page.close();

check('no page error in any world', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close(); srv.close(); console.warn = warn;
for (const l of ok) console.log('  ok    ' + l);
for (const l of fail) console.log('  FAIL  ' + l);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
