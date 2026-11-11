/* The zone beside the signed-in name, in the REAL public/app.html, in a real browser.

     "GMOs must see ther zone names infront of their name in login e.g
        MARK II - "LAKE ZONE"
        GMO · All teams · 2026-11-10-a"
     "in short after switching in system everyone must see their zone"

   What a unit test cannot say: that the typed sign-in and the stored-code sign-in both ask the
   server for the zone, that the version check which calls the same route every fifteen minutes
   does NOT, that the line is drawn as text, and that a long one stays inside the sidebar.

   Outside test/ like the other browser checks (see portal-nav.mjs for why). To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-zone-name.mjs            # SHOT=/path/file.png keeps a picture

   Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
const BUILD = /var BUILD = '([^']+)'/.exec(APP)[1];

const UI = { presentSeconds: 30, refreshSeconds: 600, hintIntervalSeconds: 3600, hintLifetimeSeconds: 5 };
const PEOPLE = {
  GMO1: { name: 'MARK II', role: 'GMO', teams: null, teamCount: null, zone: 'LAKE ZONE' },
  TEAM1: { name: 'VWAWA · F.O', role: 'FIELD OFFICER', teams: ['VWAWA'], teamCount: 1, zone: 'SOUTHERN HIGHLANDS' },
  ADMIN1: { name: 'ADMIN', role: 'ADMIN', teams: null, teamCount: null, zone: '' },
  LONG1: { name: 'CHRISTOPHER BONAVENTURA MWAKALINGA', role: 'MANAGER', teams: null, teamCount: null, zone: 'SOUTHERN HIGHLANDS, WESTERN LAKE ZONE +3' },
  MARKUP1: { name: 'ANNA', role: 'GMO', teams: null, teamCount: null, zone: '<img src=x onerror="window.__pwned=1"> ZONE' },
  OLD1: { name: 'ON AN OLDER SERVER', role: 'GMO', teams: null, teamCount: null },          // a server that does not know the zone
};
const meAsks = [];              // every /api/me query string the page sends, in order
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname.startsWith('/app') || u.pathname === '/dashboard') {
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return;
  }
  if (u.pathname === '/api/me') {
    meAsks.push(u.search);
    const p = PEOPLE[u.searchParams.get('code')];
    res.writeHead(p ? 200 : 401, { 'Content-Type': 'application/json' });
    if (!p) { res.end(JSON.stringify({ ok: false, error: 'Invalid access code' })); return; }
    const { zone, ...rest } = p;
    // the real route answers the zone only when asked for it
    const body = { ...rest, tabs: ['dashboard'], build: BUILD, systemOpen: true, hopeLoanAvailable: false, can: {}, ui: UI };
    if (u.searchParams.get('zone') === '1' && zone !== undefined) { body.zone = zone; body.zones = zone ? [zone] : []; }
    res.end(JSON.stringify(body)); return;
  }
  if (u.pathname === '/api/portal' || u.pathname === '/api/call') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rows: [], totals: {}, teams: [] })); });
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;
const browser = await chromium.launch({ executablePath: CHROME });
const ok = [], fail = [], errs = [];
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (extra ? ' -- ' + extra : ''));
const BENIGN = /favicon|status of 404|ERR_FAILED|Failed to load resource/;

async function signedIn(code, opts = {}) {
  const ctx = await browser.newContext(opts.viewport ? { viewport: opts.viewport, deviceScaleFactor: opts.dsf || 1 } : { deviceScaleFactor: opts.dsf || 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(code + ': ' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push(code + ' console: ' + m.text()); });
  await page.goto(base + '/');
  await page.fill('#code', code);
  await page.click('#inBtn');
  await page.waitForSelector('#shell:not(.hide)', { timeout: 5000 });
  return { ctx, page };
}
const nameLine = page => page.evaluate(() => document.getElementById('meName').textContent);
const roleLine = page => page.evaluate(() => document.getElementById('meRole').textContent);

// --- 1. the owner's example, typed sign-in
meAsks.length = 0;
let s = await signedIn('GMO1', { dsf: 2 });
check('typed sign-in asks the server for the zone', meAsks.length === 1 && /[?&]zone=1/.test(meAsks[0]), JSON.stringify(meAsks));
check('a GMO sees  MARK II - "LAKE ZONE"', await nameLine(s.page) === 'MARK II - "LAKE ZONE"', await nameLine(s.page));
check('the line under it is as it was', await roleLine(s.page) === 'GMO · All teams · ' + BUILD, await roleLine(s.page));
if (process.env.SHOT) await s.page.locator('.side .foot').screenshot({ path: process.env.SHOT });

// --- 2. the version check that runs every fifteen minutes asks for the build alone
meAsks.length = 0;
await s.page.evaluate(() => buildWatch_());
await s.page.waitForTimeout(250);
check('the version check does not ask for the zone', meAsks.length === 1 && !/zone/.test(meAsks[0]), JSON.stringify(meAsks));
check('and the name line stands after it', await nameLine(s.page) === 'MARK II - "LAKE ZONE"', await nameLine(s.page));

// --- 3. a stored code (the tab reopened, the page reloaded) asks for it too
meAsks.length = 0;
await s.page.reload();
await s.page.waitForSelector('#shell:not(.hide)', { timeout: 5000 });
check('a stored code signs in asking for the zone', meAsks.length >= 1 && /[?&]zone=1/.test(meAsks[0]), JSON.stringify(meAsks));
check('and draws the same line', await nameLine(s.page) === 'MARK II - "LAKE ZONE"', await nameLine(s.page));
await s.ctx.close();

// --- 4. a team code: the team, with its zone
s = await signedIn('TEAM1');
check('a team code sees its team with the zone', await nameLine(s.page) === 'VWAWA · F.O - "SOUTHERN HIGHLANDS"', await nameLine(s.page));
check('its second line still counts its team', await roleLine(s.page) === 'FIELD OFFICER · 1 team(s) · ' + BUILD, await roleLine(s.page));
await s.ctx.close();

// --- 5. nobody's zone: the name alone, no dash and no quotes
s = await signedIn('ADMIN1');
check('no zone, and the name stands alone', await nameLine(s.page) === 'ADMIN', await nameLine(s.page));
await s.ctx.close();
s = await signedIn('OLD1');
check('a server that does not answer a zone draws the name as before', await nameLine(s.page) === 'ON AN OLDER SERVER', await nameLine(s.page));
await s.ctx.close();

// --- 6. what is typed on Teams & Staff is drawn as text, never as markup
s = await signedIn('MARKUP1');
const drawn = await s.page.evaluate(() => ({ text: document.getElementById('meName').textContent, kids: document.getElementById('meName').children.length, pwned: !!window.__pwned }));
check('a zone is text', drawn.kids === 0 && !drawn.pwned && drawn.text.includes('<img'), JSON.stringify(drawn));
await s.ctx.close();

// --- 7. a long name with several zones stays inside the sidebar, on a desk and on a phone, and
//        the page is no wider for it than it is for a short name
const measure = page => page.evaluate(() => {
  const b = document.getElementById('meName'), side = b.closest('.side') || b.parentElement;
  const rb = b.getBoundingClientRect(), rs = side.getBoundingClientRect();
  return { inside: rb.left >= rs.left - 0.5 && rb.right <= rs.right + 0.5, noSpill: b.scrollWidth <= b.clientWidth + 1,
    pageWidth: document.documentElement.scrollWidth, sideWidth: Math.round(rs.width), height: Math.round(rb.height) };
});
for (const [label, viewport] of [['desk', { width: 1280, height: 800 }], ['phone', { width: 360, height: 740 }]]) {
  s = await signedIn('ADMIN1', { viewport });
  const short = await measure(s.page);
  await s.ctx.close();
  s = await signedIn('LONG1', { viewport });
  const long = await measure(s.page);
  check(label + ': a long name and zone wraps inside the sidebar', long.inside && long.noSpill && long.height > short.height, JSON.stringify(long));
  check(label + ': the page is no wider for it', long.pageWidth === short.pageWidth && long.sideWidth === short.sideWidth, JSON.stringify({ short, long }));
  await s.ctx.close();
}

await browser.close();
srv.close();
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
for (const o of ok) console.log('ok   ' + o);
for (const f of fail) console.log('FAIL ' + f);
console.log(fail.length ? `\n${fail.length} FAILED` : `\nALL ${ok.length} PASSED`);
process.exit(fail.length ? 1 : 0);
