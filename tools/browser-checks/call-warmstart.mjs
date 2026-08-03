/* Drives the REAL public/call.html in a real browser, against a stub /api/call, to prove that
   coming back from a phone call does not put an officer back on the blue screen.

   Tapping a customer's number hands the phone to the dialler, and Android is free to throw the
   page away while the officer talks. On the handsets actually in the field it usually does, so
   "it reloads after every call" is a page starting from nothing several dozen times a day.
   That is a browser-level behaviour: it cannot be checked by reading the code.

   Lives OUTSIDE test/ on purpose: `node --test` sweeps that whole directory, so a check that
   needs a browser installed would have made `npm test` fail on any machine without one -- and
   npm test guards the deploy. playwright-core is likewise not in package.json. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/call-warmstart.mjs

   CHROME overrides the browser path. Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PAGE = fs.readFileSync(path.join(ROOT, 'public/call.html'), 'utf8');

const calls = [];                 // every api_* the page asks for, in order
let bootOk = true;                // flip to simulate a de-registered handset
let bootHangs = false;            // flip to simulate no connection
let bootDelayMs = 60;             // long enough that a cold start is visibly waiting

const ROWS = [
  { ref: 'R1', full_name: 'AMINA JUMA', contact: '0712000001', team: 'KONGOWE', due_summary: '2/6', payment_expected: 1000, todays_status: 'UNPAID' },
  { ref: 'R2', full_name: 'PILI SALUM', contact: '0714000001', team: 'KONGOWE', due_summary: '3/6', payment_expected: 2000, todays_status: 'UNPAID' },
];
const BOOT = { ok: true, name: 'JUMA ISSA', team: 'KONGOWE', role: 'Officer', leader: false,
               expdfLeader: false, logoutEnabled: true, syncEverySec: 300, brand: 'HOPE',
               // The customer sheet builds its follow-up dropdown from these.
               fuStatuses: ['AMETOA AHADI', 'ANALIPA LEO', 'HAPATIKANI YEYE & MDHAMINI'],
               fuNeedDate: ['AMETOA AHADI'], fuNeedComment: [], fuNeedNumber: [],
               systemOpen: false };

function answer(fn) {
  if (fn === 'api_callBoot') return bootOk ? BOOT : { ok: false };
  if (fn === 'api_callList') return { ok: true, rows: ROWS, asOf: '2026-08-01', stale: false };
  if (fn === 'api_callDailySummary') return { ok: true, col: {}, kesho: {}, weekCol: {}, sales: {}, expdf: {}, recovery: {} };
  if (fn === 'api_callSync') return { ok: true, added: 0, watermark: 1 };
  if (fn === 'api_callNotifications') return { ok: true, unseen: 2, seenAt: '', items: [
    { kind:'complaint', id:'c1', ref:'R1', team:'KONGOWE', who:'MAMA A', by:'DESK',
      what:'hakupata risiti', at:'2026-08-02T09:00:00Z', unseen:true },
    { kind:'comment', id:'f1', ref:'R2', team:'KONGOWE', who:'PILI S', by:'JUMA G',
      what:'ataleta kesho', at:'2026-08-02T08:00:00Z', unseen:true } ] };
  if (fn === 'api_callComments') return { ok: true, items: [
    { by:'JUMA G', at:'2026-08-01 10:00', fu:'AMETOA AHADI', comment:'ataleta kesho' } ] };
  return { ok: true };
}

const srv = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/call')) {
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return;
  }
  if (req.url === '/api/call') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => {
      const { fn } = JSON.parse(b || '{}');
      calls.push(fn);
      const send = () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(answer(fn)));
      };
      if (fn === 'api_callBoot') {
        if (bootHangs) return;                        // never answers -- a dead connection
        setTimeout(send, bootDelayMs);
        return;
      }
      send();
    });
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext();          // one context = one handset, storage persists
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon|status of 404|ERR_FAILED|Failed to fetch|boot failed/.test(t)) errs.push('console: ' + t);
});

const ok = [], fail = [];
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (extra ? ' -- ' + extra : ''));
const screen = () => page.evaluate(() => ({
  boot: !document.getElementById('scrBoot').classList.contains('hide'),
  reg: !document.getElementById('scrRegister').classList.contains('hide'),
  app: document.getElementById('scrApp').style.display === 'flex',
  rows: document.querySelectorAll('#body .row, #body .card, #body [data-ref]').length,
  name: document.getElementById('appName').textContent,
  err: !document.getElementById('bootErr').classList.contains('hide'),
}));

// --- 1. a handset that has never been here waits on the server, as it must
await page.goto(base + '/');
const cold = await screen();
check('a brand new handset shows the blue screen while it asks',
  cold.boot && !cold.app, JSON.stringify(cold));
await page.waitForTimeout(500);
const landed = await screen();
check('and then lands in the app', landed.app && !landed.boot && landed.name === 'JUMA ISSA',
  JSON.stringify(landed));
check('the handset remembered who it is',
  await page.evaluate(() => !!localStorage.getItem('hcBoot_v1')));

// --- 2. THE ONE THAT MATTERS: back from a call, page thrown away, no network yet
calls.length = 0;
bootDelayMs = 3000;                              // server is slow; the officer must not wait
await page.goto(base + '/');
const warm = await screen();
check('back from a call: straight into the app, no blue screen',
  warm.app && !warm.boot && warm.name === 'JUMA ISSA', JSON.stringify(warm));
await page.waitForTimeout(300);
const listed = await page.evaluate(() => document.querySelectorAll('#body [data-ref]').length);
check('with the customer list already on screen', listed > 0, 'tappable rows=' + listed);
bootDelayMs = 60;

// --- 3. the server is still asked, and its answer still lands
await page.waitForTimeout(3200);
check('the server was asked anyway', calls.indexOf('api_callBoot') >= 0, calls.join(','));
const settled = await screen();
check('and the app stayed put while it answered', settled.app && !settled.boot, JSON.stringify(settled));

// --- 4. no connection at all: the officer keeps working
bootHangs = true;
await page.goto(base + '/');
await page.waitForTimeout(900);
const offline = await screen();
check('no connection is not a dead end -- the app opens anyway',
  offline.app && !offline.err && !offline.boot, JSON.stringify(offline));
bootHangs = false;

// --- 5. de-registered: what we let them see has to go
bootOk = false;
await page.goto(base + '/');
await page.waitForTimeout(1600);                 // enough for the answer AND the restart it triggers
const kicked = await screen();
check('a handset the server no longer knows is put back to sign-in',
  kicked.reg && !kicked.app, JSON.stringify(kicked));
check('and it forgot who it was', await page.evaluate(() => !localStorage.getItem('hcBoot_v1')));

// --- 6. and that must not loop: one more launch, still sign-in, still calm
calls.length = 0;
await page.goto(base + '/');
await page.waitForTimeout(900);
const again = await screen();
check('the next launch settles on sign-in without looping',
  again.reg && !again.app && calls.filter(c => c === 'api_callBoot').length === 1,
  JSON.stringify(again) + ' boots=' + calls.filter(c => c === 'api_callBoot').length);
bootOk = true;

/* ---------------------------------------------------------------- THE SHEET MUST CLOSE.
   The close handlers were bound inside the CUSTOMER sheet's form wiring, so the bell -- which
   uses the same panel -- opened with no way out. Tapping the X or the dark area did nothing,
   and the only escape was Back, which left the app and landed the officer on the launcher. */
const sheetOpen = () => page.evaluate(() => document.getElementById('sheet').style.display === 'flex');

// THE BELL FIRST, before any customer sheet has ever been opened. That order is the bug.
await page.evaluate(() => bellOpen());
await page.waitForTimeout(300);
check('the bell opens the sheet', await sheetOpen());
await page.evaluate(() => document.getElementById('sheetClose').click());
await page.waitForTimeout(200);
check('and the X closes it, with no customer sheet ever opened first', !(await sheetOpen()));

await page.evaluate(() => bellOpen());
await page.waitForTimeout(200);
await page.evaluate(() => document.getElementById('sheet').click());
await page.waitForTimeout(200);
check('tapping the dark area closes it too', !(await sheetOpen()));

// And BACK closes the sheet rather than leaving the app.
await page.evaluate(() => bellOpen());
await page.waitForTimeout(200);
check('the sheet is open before going back', await sheetOpen());
await page.goBack();
await page.waitForTimeout(300);
check('Back closes the sheet instead of leaving HOPE Calls', !(await sheetOpen()));
check('and the app is still loaded, not replaced by the launcher',
  await page.evaluate(() => typeof S === 'object' && !!document.getElementById('sheet')));

// The customer sheet still closes, which was the one that used to work.
await page.evaluate(() => {
  // This check ends on the sign-in screen, so the sheet's own prerequisites are set by hand.
  S.boot = { fuStatuses: ['AMETOA AHADI', 'ANALIPA LEO'], fuNeedDate: ['AMETOA AHADI'],
             fuNeedComment: [], fuNeedNumber: [] };
  S.rows = [{ ref:'R1', name:'AMINA', contact:'0712000001', amt: 900,
    installment: 100, custStatus:'Defaulter', fuStatus:'', ds:'', days:'', team:'KONGOWE' }];
  openSheet('R1');
});
await page.waitForTimeout(300);
check('a customer sheet still opens', await sheetOpen());
await page.evaluate(() => document.getElementById('sheetClose').click());
await page.waitForTimeout(200);
check('and still closes', !(await sheetOpen()));


console.log('\nPASS');
ok.forEach(s => console.log('  ok   ' + s));
if (fail.length) { console.log('\nFAIL'); fail.forEach(s => console.log('  FAIL ' + s)); }
if (errs.length) { console.log('\nPAGE ERRORS'); errs.forEach(s => console.log('  ! ' + s)); }
console.log('\n' + ok.length + ' passed, ' + fail.length + ' failed, ' + errs.length + ' page errors');

await browser.close(); srv.close();
process.exit(fail.length || errs.length ? 1 : 0);
