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
               userId: 'U-JUMA', systemOpen: false };

let bellFails = false;
let summaryFails = false;         // flip to simulate the strip's request failing
let dataVersion = 'v1';           // bumped by an "upload" further down
function answer(fn) {
  if (fn === 'api_callBoot') return bootOk ? BOOT : { ok: false };
  if (fn === 'api_callList') return { ok: true, rows: ROWS, asOf: '2026-08-01', stale: false };
  if (fn === 'api_callDailySummary') {
    if (summaryFails) return { ok: false, error: 'BOOM' };
    return { ok: true, period: 'day', col: { pct: 0.42 }, kesho: { pct: 0.11 }, weekCol: { pct: 0.55 },
             sales: { pct: 0.3 }, expdf: { pct: 0.2, num: 1400000 }, recovery: { pct: 0.6, num: 900000 },
             dataVersion: dataVersion };
  }
  if (fn === 'api_callSync') return { ok: true, added: 0, watermark: 1, dataVersion: dataVersion };
  if (fn === 'api_callNotifications' && bellFails) return { ok: false, error: 'BOOM' };
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

/* ------------------------------------------------- THE PERFORMANCE STRIP MUST NOT COME AND GO.
   "It gets lost so much that I am even not sure if it'll get back." It was hidden until a
   request succeeded and hidden again on every restart -- so on a handset Android throws away
   after each call it appeared for a few seconds a day, and one failed request took it away with
   nothing to say why. A figure that comes and goes is worse than no figure: nobody can tell
   whether the number is bad or the app is. */
const strip = () => page.evaluate(() => {
  const el = document.getElementById('dayStrip');
  return { shown: !el.classList.contains('hide'), stale: el.classList.contains('stale'),
           col: document.getElementById('dsCol').textContent,
           rec: document.getElementById('dsRec').textContent,
           saved: !!localStorage.getItem('hcDaySummary_v1') };
});
await page.waitForTimeout(400);
const s1 = await strip();
check('the strip is on screen with its figures', s1.shown && s1.col === '42%', JSON.stringify(s1));
check('and the shillings ride beside the percentage', /60%/.test(s1.rec) && /900k/.test(s1.rec), s1.rec);
check('the figures are kept on the handset', s1.saved);

// A failed request must not blank it. This is the exact behaviour that made it feel unreliable.
summaryFails = true;
await page.evaluate(() => loadDaySummary(true));
await page.waitForTimeout(400);
const s2 = await strip();
check('a failed request leaves the figures on screen instead of blanking them',
  s2.shown && s2.col === '42%', JSON.stringify(s2));
summaryFails = false;

// Restart with the server refusing from the very first moment: the strip is there anyway.
summaryFails = true;
await page.goto(base + '/');
await page.waitForTimeout(600);
const s3 = await strip();
check('and it is on screen straight after a restart, before the server has answered anything',
  s3.shown && s3.col === '42%', JSON.stringify(s3));
summaryFails = false;

/* UPDATING WHENEVER A REPORT IS UPLOADED. The figures are far too expensive to recompute on a
   timer for two hundred officers, so the phone watches a version stamp the upload changes and
   asks for new figures only then. */
await page.evaluate(() => loadDaySummary(true));
await page.waitForTimeout(400);
calls.length = 0;
await page.evaluate(() => versionPing_());        // a routine sync with nothing uploaded
await page.waitForTimeout(400);
check('a routine sync with nothing uploaded does NOT re-ask for the figures',
  calls.indexOf('api_callDailySummary') < 0, calls.join(','));

dataVersion = 'v2';                                // somebody uploads a report
calls.length = 0;
await page.evaluate(() => versionPing_());
await page.waitForTimeout(500);
check('but the first sync after an upload does',
  calls.indexOf('api_callDailySummary') >= 0, calls.join(','));

/* AND THE OFFICER CAN SEE THAT IT DID. Most uploads move none of the six figures by a whole
   point, so a refresh that works looks exactly like one that never happened -- which is the
   whole of "I don't know if it even does". */
const tag = () => page.evaluate(() => document.getElementById('dsTag').textContent);
check('the strip says WHEN the figures were worked out', /\d\d:\d\d/.test(await tag()), await tag());

// Coming back to the app asks the cheap question, not the fifteen-minute-throttled one.
dataVersion = 'v3';
calls.length = 0;
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(500);
check('returning to the app after an upload refreshes the figures at once',
  calls.indexOf('api_callDailySummary') >= 0, calls.join(','));

// And tapping the figures asks again -- the one thing to do when a number looks wrong.
calls.length = 0;
await page.click('#dayStrip');
await page.waitForTimeout(400);
check('tapping the strip asks for the figures again',
  calls.indexOf('api_callDailySummary') >= 0, calls.join(','));

/* -------------------------------------------- RUHUSU COMMENT KUSAVE AUTOMATIC.
   Android stops an app that is not on screen, so a comment typed at a customer's door may never
   reach the server. The exemption used to be a button on a banner -- something an officer had
   to notice on a list of customers and decide to press -- and almost nobody did. It is now
   something the app DOES when it opens, like the call-log permission and the update check.
   The native bridge is stubbed here because that is the only way to reach this path in a
   browser: nativeBridge() is what decides whether the app is running inside the APK at all. */
const bgVisible = () => page.evaluate(() => document.getElementById('bgPrompt').style.display === 'flex');
const installBridge = (exempt) => page.addInitScript(([ex]) => {
  window.HopeCalls = {
    getCalls: () => '[]', setWatermark: () => {}, getDeviceId: () => 'DEV-STUB',
    hasCallLogPermission: () => '1', getManufacturer: () => 'Tecno',
    isIgnoringBatteryOptimizations: () => (ex ? '1' : '0'),
    requestIgnoreBatteryOptimizations: () => { window.__bgAsked = (window.__bgAsked || 0) + 1; },
  };
}, [exempt]);

await ctx.clearCookies();
await page.evaluate(() => { try { localStorage.removeItem('hcBgAsk_v1'); } catch(e){} });
await installBridge(false);
await page.goto(base + '/');
await page.waitForTimeout(1500);
check('a handset that is not exempt is ASKED, without being sent looking for a button',
  await bgVisible());
const bgText = await page.evaluate(() => document.getElementById('bgPrompt').textContent);
check('and the words are what the permission buys, not what Android calls it',
  /Ruhusu comment kusave automatic/.test(bgText), bgText.replace(/\s+/g, ' ').slice(0, 70));

// Allowing hands over to Android's own dialog.
await page.click('#bgYes');
await page.waitForTimeout(200);
check('tapping Ruhusu opens the phone\'s own permission dialog',
  await page.evaluate(() => window.__bgAsked === 1));
check('and the prompt closes behind it', !(await bgVisible()));

/* ASKED ONCE A DAY, NOT EVERY TIME. Android's dialog is the second step, so a refusal costs two
   taps -- re-asking on every restart is how people are trained to refuse on sight. */
await page.goto(base + '/');
await page.waitForTimeout(1500);
check('a restart the same day does not ask again', !(await bgVisible()));

// A handset that is already exempt is never asked at all.
await page.evaluate(() => { try { localStorage.removeItem('hcBgAsk_v1'); } catch(e){} });
await installBridge(true);
await page.goto(base + '/');
await page.waitForTimeout(1500);
check('a handset that already allows it is never asked', !(await bgVisible()));

// And the old button is gone from the customer list.
check('the button on the banner is gone -- asking is the app\'s job now',
  await page.evaluate(() => !document.getElementById('battBtn')));

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
/* AND IT FORGOT THEIR FIGURES. Handsets get handed on. One team's numbers sitting there when
   the next officer signs in would look exactly as authoritative as their own. */
check('and their team figures went with it',
  await page.evaluate(() => !localStorage.getItem('hcDaySummary_v1')));

// --- 6. and that must not loop: one more launch, still sign-in, still calm
calls.length = 0;
await page.goto(base + '/');
await page.waitForTimeout(900);
const again = await screen();
check('the next launch settles on sign-in without looping',
  again.reg && !again.app && calls.filter(c => c === 'api_callBoot').length === 1,
  JSON.stringify(again) + ' boots=' + calls.filter(c => c === 'api_callBoot').length);
bootOk = true;

/* A BELL THAT CANNOT REACH THE SERVER MUST SAY SO, not spin. The failure path was swallowed
   in silence, which produced the same stuck screen as the missing redraw and gave no way to
   tell the two apart. */
bellFails = true;
await page.evaluate(() => { S.notif = null; S.notifErr = null; bellOpen(); });
await page.waitForTimeout(600);
check('a bell that cannot load says so instead of spinning',
  /Imeshindikana|haijasajiliwa/.test(await page.evaluate(() => document.getElementById('sheetBody').textContent)),
  (await page.evaluate(() => document.getElementById('sheetBody').textContent)).slice(0, 80));
await page.evaluate(() => sheetHide());
bellFails = false;

/* ---------------------------------------------------------------- THE SHEET MUST CLOSE.
   The close handlers were bound inside the CUSTOMER sheet's form wiring, so the bell -- which
   uses the same panel -- opened with no way out. Tapping the X or the dark area did nothing,
   and the only escape was Back, which left the app and landed the officer on the launcher. */
const sheetOpen = () => page.evaluate(() => document.getElementById('sheet').style.display === 'flex');

/* THE SPINNER THAT NOTHING REPLACED. Tapping the bell before the first count had landed drew
   a spinner, and the refresh updated the little red dot without ever redrawing the open sheet.
   S.notif is cleared here to reproduce exactly that: a bell opened with nothing in hand. */
await page.evaluate(() => { S.notif = null; S.notifErr = null; bellOpen(); });
await page.waitForTimeout(600);
const bellText = await page.evaluate(() => document.getElementById('sheetBody').textContent);
check('the bell fills in when the answer arrives, rather than spinning for ever',
  /hakupata risiti|ataleta kesho/.test(bellText), bellText.slice(0, 90));
check('and the sheet is open', await sheetOpen());
await page.evaluate(() => sheetHide());

// THE BELL FIRST, before any customer sheet has ever been opened. That order is the bug.
await page.evaluate(() => bellOpen());
await page.waitForTimeout(400);
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
