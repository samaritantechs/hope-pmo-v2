/* Drives the REAL public/call.html in a real browser, against a stub /api/call, to prove the
   Location and Map buttons on the customer card do what an officer standing at a door needs.

     "An officer can pinpoint coordinates of the customer during visitation. And pressing map
      later will open maps app in phone or browser to direct us towards that customer."

   What only a browser can show: that the buttons are on the card, that Location really asks the
   phone for a position and sends it with the card's own ref and team, that an existing point is
   put to the officer as a question rather than overwritten, and that Map opens the directions
   link -- including with no signal at all, from the point kept on the handset.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/call-customer-location.mjs

   CHROME overrides the browser path. Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PAGE = fs.readFileSync(path.join(ROOT, 'public/call.html'), 'utf8');

const pins = [];                      // every api_callCustPin body the page sent
let offline = false;                  // flip to simulate no signal
let pinMode = 'store';                // store | exists | pending | notmine
let savedLoc = null;                  // what the server holds for R1
const ROWS = [
  { ref: 'R1', name: 'AMINA JUMA', contact: '0712000001', team: 'KONGOWE', amt: 1000, installment: 1000, custStatus: 'UNPAID', fuStatus: '', ds: '2/6' },
];
const BOOT = { ok: true, name: 'JUMA ISSA', team: 'KONGOWE', role: 'Officer', leader: false, expdfLeader: false,
               logoutEnabled: true, syncEverySec: 300, brand: 'HOPE', fuStatuses: ['ANALIPA LEO'], fuNeedDate: [],
               fuNeedComment: [], fuNeedNumber: [], userId: 'U-JUMA', systemOpen: false, locReport: false };

function answer(fn, args) {
  if (fn === 'api_callBoot') return BOOT;
  if (fn === 'api_callList') return { ok: true, rows: ROWS, asOf: '2026-08-01', stale: false };
  if (fn === 'api_callComments') return { ok: true, items: [], complaints: [], loc: savedLoc, locReady: true };
  if (fn === 'api_callCustPin') {
    const p = args[1];
    pins.push(p);
    if (pinMode === 'pending') return { ok: true, stored: false, pending: 'MIGRATION' };
    if (pinMode === 'notmine') return { ok: false, error: 'NOT_YOUR_TEAM' };
    if (pinMode === 'exists' && !p.replace) return { ok: true, stored: false, exists: { by: 'ASHA JUMA', at: '2026-08-01 10:00', distM: 340 } };
    savedLoc = { lat: p.lat, lng: p.lng, acc: Math.round(p.acc), by: 'JUMA ISSA', at: '2026-08-02 11:00' };
    return { ok: true, stored: true, replaced: pinMode === 'exists', loc: savedLoc };
  }
  return { ok: true };
}
const srv = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/call')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
  if (req.url === '/api/call') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => {
      if (offline) { req.socket.destroy(); return; }
      const { fn, args } = JSON.parse(b || '{}');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(answer(fn, args)));
    });
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, geolocation: { latitude: -6.7924, longitude: 39.2083, accuracy: 8 }, permissions: ['geolocation'] });
// The shell hands every window.open to the phone's Maps app; here we just record what was asked for.
await ctx.addInitScript(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return {}; }; });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/favicon|status of 404|ERR_FAILED|ERR_EMPTY_RESPONSE|Failed to fetch|boot failed/.test(t)) errs.push('console: ' + t); });

const ok = [], fail = [];
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (extra ? ' -- ' + extra : ''));
const text = sel => page.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
const toastText = () => page.evaluate(() => { const t = document.getElementById('toast'); return t.style.display === 'none' ? '' : t.textContent; });
/* A page that comes back after being thrown away reopens the card the officer was on (tryRestoreUi_),
   so the card may already be open; tap the row only when it is not. */
const openCard = async () => {
  await page.waitForSelector('#body [data-ref]');
  await page.waitForTimeout(400);
  if (!(await page.evaluate(() => document.getElementById('sheet').style.display === 'flex'))) await page.click('#body [data-ref="R1"]');
  await page.waitForSelector('#locPin'); await page.waitForTimeout(250);
};

await page.goto(base + '/');
await openCard();

// --- 1. the two buttons are on the card, and a customer with no point says so
check('Location and Map are both on the card', (await text('#locPin')).includes('Location') && (await text('#locMap')).includes('Map'));
check('a card with no point says none is saved', /Bado hakuna eneo/.test(await text('#locNote')), await text('#locNote'));
check('and Map is the quiet button until there is a point to go to', await page.evaluate(() => document.getElementById('locMap').classList.contains('btn-ghost')));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-before.png' });   // SHOT=/some/dir/card to look at it
await page.click('#locMap');
check('Map with no point opens nothing and says why', (await page.evaluate(() => window.__opened.length)) === 0 && /Hakuna eneo/.test(await toastText()), await toastText());

// --- 2. Location reads the phone and sends it with the card's own ref and team
await page.click('#locPin');
await page.waitForFunction(() => /Saved:/.test(document.getElementById('locNote').textContent), null, { timeout: 8000 });
check('Location sent one pin', pins.length === 1, JSON.stringify(pins));
check('with the card\'s own ref and team', pins[0] && pins[0].ref === 'R1' && pins[0].team === 'KONGOWE' && pins[0].name === 'AMINA JUMA', JSON.stringify(pins[0]));
check('and the phone\'s position', pins[0] && Math.abs(pins[0].lat + 6.7924) < 1e-6 && Math.abs(pins[0].lng - 39.2083) < 1e-6 && pins[0].acc <= 25, JSON.stringify(pins[0]));
check('the card now shows the saved point, who saved it and when', /-6\.79240, 39\.20830/.test(await text('#locNote')) && /JUMA ISSA/.test(await text('#locNote')), await text('#locNote'));
check('Map becomes the main button', await page.evaluate(() => document.getElementById('locMap').classList.contains('btn-pri')));
check('and the Location button is back to its label', (await text('#locPin')).includes('Location') && !(await page.evaluate(() => document.getElementById('locPin').disabled)));

if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-after.png' });

// --- 3. Map opens directions to that point in the Maps app (the shell hands window.open to the phone)
await page.click('#locMap');
const opened = await page.evaluate(() => window.__opened.slice());
check('Map opens Google Maps directions to the saved point',
  opened.length === 1 && opened[0] === 'https://www.google.com/maps/dir/?api=1&destination=-6.7924,39.2083&travelmode=driving', JSON.stringify(opened));

// --- 4. the point survives the app being thrown away, and works with NO SIGNAL
offline = true;
await page.goto(base + '/');
await openCard();
check('with no signal the card still shows the point kept on the phone', /-6\.79240, 39\.20830/.test(await text('#locNote')), await text('#locNote'));
await page.evaluate(() => { window.__opened = []; });
await page.click('#locMap');
check('and Map still opens', (await page.evaluate(() => window.__opened.length)) === 1);
offline = false;

// --- 5. a point already on file from somewhere else is a question, never an overwrite
pinMode = 'exists'; pins.length = 0;
await page.reload(); await openCard();
await page.click('#locPin');
await page.waitForSelector('#locYes', { timeout: 8000 });
check('an existing point is put to the officer, with who and how far', /ASHA JUMA/.test(await text('#locNote')) && /340/.test(await text('#locNote')), await text('#locNote'));
check('and nothing was replaced yet', pins.length === 1 && !pins[0].replace);
await page.click('#locYes');
await page.waitForTimeout(500);
check('saying yes sends it again, marked as a replacement', pins.length === 2 && pins[1].replace === true, JSON.stringify(pins.map(p => p.replace)));
pins.length = 0;
await page.click('#locPin');
await page.waitForSelector('#locNo', { timeout: 8000 });
await page.click('#locNo');
await page.waitForTimeout(300);
check('saying no keeps the old point and sends nothing more', pins.length === 1 && !/locYes/.test(await page.evaluate(() => document.getElementById('locNote').innerHTML)));

// --- 6. before the migration, and a customer who is not this officer's, each say so
pinMode = 'pending'; await page.click('#locPin'); await page.waitForTimeout(500);
check('before the migration the officer is told the office has not switched it on', /haijawasha/.test(await toastText()), await toastText());
pinMode = 'notmine'; await page.click('#locPin'); await page.waitForTimeout(500);
check('a customer of another team is refused in words', /si wa timu yako/.test(await toastText()), await toastText());

// --- 7. a phone with no GPS permission is told how to fix it
const ctx2 = await browser.newContext();                      // no geolocation permission granted
await ctx2.addInitScript(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return {}; }; });
const p2 = await ctx2.newPage();
await p2.goto(base + '/'); await p2.waitForSelector('#body [data-ref]'); await p2.click('#body [data-ref="R1"]'); await p2.waitForSelector('#locPin');
pinMode = 'store';
await p2.click('#locPin');
await p2.waitForFunction(() => { const t = document.getElementById('toast'); return t.style.display !== 'none' && /Location|mahali|GPS/i.test(t.textContent); }, null, { timeout: 25000 }).catch(() => {});
check('a refused permission is explained and the button comes back', /ruhusa|permission|mahali|GPS/i.test(await p2.evaluate(() => document.getElementById('toast').textContent))
  && !(await p2.evaluate(() => document.getElementById('locPin').disabled)));

// --- 8. signing out forgets every customer's point
await page.evaluate(() => doLogout());
await page.waitForTimeout(300);
check('signing out forgets the points kept on the phone', await page.evaluate(() => localStorage.getItem('hcCustLoc') === null));

check('no script errors', errs.length === 0, errs.join(' | '));
await browser.close(); srv.close();
for (const o of ok) console.log('ok   ' + o);
for (const f of fail) console.log('FAIL ' + f);
console.log(ok.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
