/* Drives the REAL public/call.html in a real browser, against a stub /api/call, to prove the
   Location and Map buttons on the customer card do what an officer standing at a door needs.

     "An officer can pinpoint coordinates of the customer during visitation. And pressing map
      later will open maps app in phone or browser to direct us towards that customer."

   "Add them as two icons on the right side of name and team+refno ... two rows map icons for both
    customer and guarantor. All tied to ref no."
   "Someone fraudulent could update real location into fake, so if there is more than one location,
    open location history once the button is clicked."

   What only a browser can show: that the customer's two icons sit at the right of the name and
   the team + REF lines and the guarantor's at the right of the guarantor's own row, that Location
   really asks the phone for a position and sends it with the card's own ref and team and the
   right party, that an existing point is put to the officer as a question rather than
   overwritten, that Map opens the directions link -- including with no signal at all, from the
   point kept on the handset -- to the right person's door, and that a person with more than one
   location gets the history (current and earlier points, who, when, how far apart, a warning when
   they differ) when Map is pressed, while a person with one location still goes straight to Maps.

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
const finds = [];                     // every api_callFind query the page sent
let offline = false;                  // flip to simulate no signal
let pinMode = 'store';                // store | exists | pending | notmine
const saved = { C: null, G: null };   // what the server holds for R1, per party
const ROWS = [
  { ref: 'R1', name: 'AMINA JUMA', contact: '0712000001', team: 'KONGOWE', amt: 1000, installment: 1000, custStatus: 'UNPAID', fuStatus: '', ds: '2/6',
    gName: 'BABA JUMA', gContact: '0713000001' },
  { ref: 'R2', name: 'PILI SALUM', contact: '0714000001', team: 'KONGOWE', amt: 2000, installment: 500, custStatus: 'UNPAID', fuStatus: '', ds: '3/6',
    gName: '', gContact: '' },                                   // a loan with no guarantor
];
const BOOT = { ok: true, name: 'JUMA ISSA', team: 'KONGOWE', role: 'Officer', leader: false, expdfLeader: false,
               logoutEnabled: true, syncEverySec: 300, brand: 'HOPE', fuStatuses: ['ANALIPA LEO'], fuNeedDate: [],
               fuNeedComment: [], fuNeedNumber: [], userId: 'U-JUMA', systemOpen: false, locReport: false };

function answer(fn, args) {
  if (fn === 'api_callBoot') return BOOT;
  if (fn === 'api_callList') return { ok: true, rows: ROWS, asOf: '2026-08-01', stale: false };
  // The history follows the docket: R1's card also carries a note made on the customer's earlier loan, R0.
  if (fn === 'api_callComments') return { ok: true, complaints: [], loc: args[1] === 'R1' ? saved.C : null, gloc: args[1] === 'R1' ? saved.G : null, locReady: true,
    items: args[1] === 'R1' ? [{ ref: 'R1', by: 'JUMA G', at: '2026-08-01 10:00', fu: '', comment: 'mkopo huu' }, { ref: 'R0', by: 'ASHA J', at: '2026-05-02 09:00', fu: 'AMETOA AHADI', comment: 'mkopo uliopita' }] : [] };
  // The book behind the search box: an application under assessment, found by name after a pause.
  if (fn === 'api_callFind') { finds.push(args[1]); return { ok: true, loansReady: true, rows: /MWOMB/i.test(args[1]) ? [
    { ref: '22171109991', docket: '2-217-110999', name: 'MWOMBAJI MPYA', contact: '0719000001', gName: 'MDHAMINI WAKE', gContact: '0719000002', team: 'KONGOWE',
      amt: null, installment: null, custStatus: '', fuStatus: '', ds: '', days: '', called: false, noBook: true, note: 'Maombi · assessed · TZS 300,000 · 2026-07-20', _seg: 'Maombi', src: 'LOAN', stage: 'assessed' } ] : [] }; }
  if (fn === 'api_callCustPin') {
    const p = args[1];
    pins.push(p);
    if (pinMode === 'pending') return { ok: true, stored: false, pending: 'MIGRATION' };
    if (pinMode === 'notmine') return { ok: false, error: 'NOT_YOUR_TEAM' };
    if (pinMode === 'exists' && !p.replace) return { ok: true, stored: false, exists: { by: 'ASHA JUMA', at: '2026-08-01 10:00', distM: 340 } };
    const prev = saved[p.party];
    const hist = prev && p.replace ? (prev.hist || []).concat([{ lat: prev.lat, lng: prev.lng, acc: prev.acc, by: prev.by, at: prev.at }]) : [];
    saved[p.party] = { lat: p.lat, lng: p.lng, acc: Math.round(p.acc), by: 'JUMA ISSA', at: '2026-08-02 11:00', hist };
    return { ok: true, stored: true, party: p.party, replaced: pinMode === 'exists', loc: saved[p.party] };
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
const openCard = async (ref = 'R1', pg = page) => {
  await pg.waitForSelector('#body [data-ref]');
  await pg.waitForTimeout(400);
  if (!(await pg.evaluate(() => document.getElementById('sheet').style.display === 'flex'))) await pg.click('#body [data-ref="' + ref + '"]');
  await pg.waitForSelector('#locPin_C'); await pg.waitForTimeout(250);
};
const box = sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; }, sel);

await page.goto(base + '/');
await openCard();

// --- 1. LAYOUT: the customer's two icons at the right of the name and the team + REF lines, side by side
const title = await box('.sheet-card .sheet-title'), sub = await box('.sheet-card .sheet-sub');
const cp = await box('#locPin_C'), cm = await box('#locMap_C');
check('the customer has a Location icon and a Map icon', !!cp && !!cm);
check('both icons are to the right of the name and the team + REF line, not under them',
  cp.l > title.l + 40 && cp.l > sub.l + 40 && cp.l > Math.min(title.r, sub.r) - 120, JSON.stringify({ title, sub, cp }));
check('side by side, on one line, round and finger-sized',
  Math.abs(cp.t - cm.t) < 1 && cm.l > cp.r && cp.w >= 36 && cp.h >= 36 && Math.abs(cp.w - cp.h) < 1, JSON.stringify({ cp, cm }));
check('and level with the name and team + REF block (the two lines they sit beside)', cp.t >= title.t - 4 && cp.b <= sub.b + 40, JSON.stringify({ cp, title, sub }));
check('the old wide buttons are gone', !(await page.evaluate(() => !!document.getElementById('locPin') || !!document.getElementById('locMap'))));
check('a card with no point has no note line taking room', (await box('#locNote_C')).h === 0, JSON.stringify(await box('#locNote_C')));
check('and Map is not tinted ready until there is a point', await page.evaluate(() => !document.getElementById('locMap_C').classList.contains('on')));

// --- 1b. a note from the customer's EARLIER loan is on this card, marked with its REF; this loan's is not marked
await page.waitForFunction(() => /mkopo uliopita/.test(document.getElementById('histBox').textContent), null, { timeout: 5000 });
const histItems = await page.evaluate(() => Array.from(document.querySelectorAll('#histBox .hist-item')).map(e => e.textContent.replace(/\s+/g, ' ')));
check('the earlier loan\'s note is on the card and says which loan it was about', histItems.some(t => /mkopo uliopita/.test(t) && /Mkopo REF R0/.test(t)), JSON.stringify(histItems));
check('and this loan\'s own note carries no such mark', histItems.some(t => /mkopo huu/.test(t) && !/Mkopo REF/.test(t)), JSON.stringify(histItems));

// --- 2. the guarantor has a row of their own with their own pair, to the right of the name
const gname = await box('.partyrow .pname'), gp = await box('#locPin_G'), gm = await box('#locMap_G');
check('the guarantor\'s row shows the guarantor\'s name', /BABA JUMA/.test(await text('.partyrow .pname')) && /Mdhamini/.test(await text('.partyrow .plab')));
check('with a second pair of icons at its right, side by side', !!gp && !!gm && gp.l > gname.l + 40 && Math.abs(gp.t - gm.t) < 1 && gm.l > gp.r, JSON.stringify({ gname, gp, gm }));
check('below the customer\'s pair, never mixed with it', gp.t > cm.b);
check('titled for the right person', /mdhamini/i.test(await page.evaluate(() => document.getElementById('locPin_G').title)) && /mteja/i.test(await page.evaluate(() => document.getElementById('locPin_C').title)));

// --- 3. Map with no point opens nothing and says why, per person
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-before.png' });   // SHOT=/some/dir/card to look at it
await page.click('#locMap_C');
check('Map with no point opens nothing and says why', (await page.evaluate(() => window.__opened.length)) === 0 && /Hakuna eneo/.test(await toastText()), await toastText());
await page.click('#locMap_G');
check('and for the guarantor it says the guarantor', /mdhamini/.test(await toastText()), await toastText());

// --- 4. Location for the CUSTOMER reads the phone and sends it with the card's own ref, team, name and party C
await page.click('#locPin_C');
await page.waitForFunction(() => /Saved:/.test(document.getElementById('locNote_C').textContent), null, { timeout: 8000 });
check('Location sent one pin', pins.length === 1, JSON.stringify(pins));
check('for the customer: the card\'s own ref, team and name, party C',
  pins[0].ref === 'R1' && pins[0].team === 'KONGOWE' && pins[0].name === 'AMINA JUMA' && pins[0].party === 'C', JSON.stringify(pins[0]));
check('and the phone\'s position', Math.abs(pins[0].lat + 6.7924) < 1e-6 && Math.abs(pins[0].lng - 39.2083) < 1e-6 && pins[0].acc <= 25, JSON.stringify(pins[0]));
check('the customer\'s note shows the point, who saved it and when', /-6\.79240, 39\.20830/.test(await text('#locNote_C')) && /JUMA ISSA/.test(await text('#locNote_C')) && /mteja/.test(await text('#locNote_C')), await text('#locNote_C'));
check('the customer\'s Map icon is tinted ready, the guarantor\'s is not',
  await page.evaluate(() => document.getElementById('locMap_C').classList.contains('on') && !document.getElementById('locMap_G').classList.contains('on')));
check('and the icon is pressable again', !(await page.evaluate(() => document.getElementById('locPin_C').disabled)));

// --- 5. Location for the GUARANTOR, from where the guarantor lives: the same ref, party G, the guarantor\'s own name and point
await ctx.setGeolocation({ latitude: -6.8010, longitude: 39.2150, accuracy: 9 });
await page.click('#locPin_G');
await page.waitForFunction(() => /Saved:/.test(document.getElementById('locNote_G').textContent), null, { timeout: 8000 });
check('a second pin for the same ref', pins.length === 2 && pins[1].ref === 'R1', JSON.stringify(pins));
check('as the guarantor, under the guarantor\'s own name', pins[1].party === 'G' && pins[1].name === 'BABA JUMA' && Math.abs(pins[1].lat + 6.8010) < 1e-6, JSON.stringify(pins[1]));
check('the guarantor\'s note says guarantor, the customer\'s is unchanged', /mdhamini/.test(await text('#locNote_G')) && /-6\.80100, 39\.21500/.test(await text('#locNote_G')) && /-6\.79240/.test(await text('#locNote_C')));

// --- 6. Map opens directions to THAT person's point in the Maps app (the shell hands window.open to the phone)
await page.click('#locMap_C');
await page.click('#locMap_G');
const opened = await page.evaluate(() => window.__opened.slice());
check('the customer\'s Map goes to the customer\'s point',
  opened[0] === 'https://www.google.com/maps/dir/?api=1&destination=-6.7924,39.2083&travelmode=driving', JSON.stringify(opened));
check('and the guarantor\'s to the guarantor\'s', opened[1] === 'https://www.google.com/maps/dir/?api=1&destination=-6.801,39.215&travelmode=driving', JSON.stringify(opened));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-after.png' });

// --- 7. both points survive the app being thrown away, and work with NO SIGNAL
offline = true;
await page.goto(base + '/');
await openCard();
check('with no signal the card still shows both points kept on the phone', /-6\.79240/.test(await text('#locNote_C')) && /-6\.80100/.test(await text('#locNote_G')), await text('#locNote_C') + ' | ' + await text('#locNote_G'));
await page.evaluate(() => { window.__opened = []; });
await page.click('#locMap_G');
check('and the guarantor\'s Map still opens', (await page.evaluate(() => window.__opened.length)) === 1);
offline = false;

// --- 8. a point already on file is a question, never an overwrite -- for the guarantor too
await ctx.setGeolocation({ latitude: -6.7924, longitude: 39.2083, accuracy: 8 });
pinMode = 'exists'; pins.length = 0;
await page.reload(); await openCard();
await page.click('#locPin_G');
await page.waitForSelector('#locYes', { timeout: 8000 });
check('an existing point is put to the officer, with who and how far', /ASHA JUMA/.test(await text('#locNote_G')) && /340/.test(await text('#locNote_G')) && /mdhamini/.test(await text('#locNote_G')), await text('#locNote_G'));
check('and nothing was replaced yet', pins.length === 1 && !pins[0].replace && pins[0].party === 'G');
await page.click('#locYes');
await page.waitForTimeout(500);
check('saying yes sends it again, marked as a replacement', pins.length === 2 && pins[1].replace === true && pins[1].party === 'G', JSON.stringify(pins.map(p => p.replace)));
pins.length = 0;
await page.click('#locPin_G');
await page.waitForSelector('#locNo', { timeout: 8000 });
await page.click('#locNo');
await page.waitForTimeout(300);
check('saying no keeps the old point and sends nothing more', pins.length === 1 && !/locYes/.test(await page.evaluate(() => document.getElementById('locNote_G').innerHTML)));

// --- 8b. HISTORY: the guarantor's point was replaced above, so there are now TWO locations -- Map opens the history, not Maps
pinMode = 'store';
await page.reload(); await openCard();
check('a person with more than one location says so, under the icons', /Maeneo 2/.test(await text('#locNote_G')) && !!(await box('#locHist_G')), await text('#locNote_G'));
check('while the customer, with one location, shows no history link', !(await box('#locHist_C')));
await page.evaluate(() => { window.__opened = []; });
await page.click('#locMap_G');
await page.waitForSelector('#locNote_G .histpanel', { timeout: 3000 });
check('Map opens the history instead of going straight to Maps', (await page.evaluate(() => window.__opened.length)) === 0 && !!(await box('#locNote_G .histpanel')));
check('with the current point and the one it replaced', (await page.evaluate(() => document.querySelectorAll('#locNote_G .histrow').length)) === 2, await text('#locNote_G .histlist'));
check('each says who pinned it and when', /JUMA ISSA/.test(await text('#locNote_G .histlist')) && /2026-08-0[12] \d\d:\d\d/.test(await text('#locNote_G .histlist')), await text('#locNote_G .histlist'));
check('the earlier one says how far it is from the current point', /km kutoka sasa|m kutoka sasa/.test(await text('#locNote_G .histlist')), await text('#locNote_G .histlist'));
check('and the places differ, so there is a warning in red words', /Maeneo yanatofautiana hadi/.test(await text('#locNote_G .histwarn')), await text('#locNote_G .histpanel'));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT + '-history.png' });
await page.click('#locNote_G .histrow:nth-child(2) .locbtn');
check('the earlier point has its own Map icon, to ITS coordinates', (await page.evaluate(() => window.__opened.slice())).pop() === 'https://www.google.com/maps/dir/?api=1&destination=-6.801,39.215&travelmode=driving', JSON.stringify(await page.evaluate(() => window.__opened)));
await page.click('#locNote_G .histrow:nth-child(1) .locbtn');
check('and so does the current one', (await page.evaluate(() => window.__opened.slice())).pop() === 'https://www.google.com/maps/dir/?api=1&destination=-6.7924,39.2083&travelmode=driving');
await page.click('#locHistClose');
check('Close puts the note back', !(await box('#locNote_G .histpanel')) && /Saved:/.test(await text('#locNote_G')));
await page.click('#locHist_G');
check('and the "view history" line opens it as well', !!(await box('#locNote_G .histpanel')));
await page.click('#locHistClose');
await page.evaluate(() => { window.__opened = []; });
await page.click('#locMap_C');
check('a person with ONE location still goes straight to Maps', (await page.evaluate(() => window.__opened.length)) === 1 && !(await box('#locNote_C .histpanel')));

// --- 9. before the migration, and a customer who is not this officer's, each say so
pinMode = 'pending'; await page.click('#locPin_C'); await page.waitForTimeout(500);
check('before the migration the officer is told the office has not switched it on', /haijawasha/.test(await toastText()), await toastText());
pinMode = 'notmine'; await page.click('#locPin_C'); await page.waitForTimeout(500);
check('a customer of another team is refused in words', /si wa timu yako/.test(await toastText()), await toastText());

// --- 10. a loan with NO guarantor has the customer's pair only
await page.evaluate(() => sheetHide());
await page.click('#body [data-ref="R2"]');
await page.waitForSelector('#locPin_C'); await page.waitForTimeout(250);
check('no guarantor, no second pair', await page.evaluate(() => !document.getElementById('locPin_G') && !document.getElementById('locMap_G') && !document.querySelector('.partyrow')));
check('and the customer\'s pair is there and does not carry R1\'s point', !!(await box('#locPin_C')) && (await text('#locNote_C')) === '' && await page.evaluate(() => !document.getElementById('locMap_C').classList.contains('on')));

// --- 10b. SEARCH REACHES THE BOOK: an applicant under assessment, not on any list, found by name -- and pinnable
await page.evaluate(() => sheetHide());
finds.length = 0;
await page.fill('#listQ', 'mw');
await page.waitForTimeout(700);
check('two letters ask the book nothing', finds.length === 0);
await page.fill('#listQ', 'mwomb');
await page.waitForTimeout(250);
check('and three or more wait for the typing to pause', finds.length === 0);
await page.waitForSelector('#body [data-ref="22171109991"]', { timeout: 4000 });
check('after the pause the book is asked once, and the applicant appears', finds.length === 1 && finds[0] === 'MWOMB', JSON.stringify(finds));
const appRow = await page.evaluate(() => document.querySelector('#body [data-ref="22171109991"]').textContent.replace(/\s+/g, ' '));
check('the row says Maombi and the stage and amount, not a debt of 0', /Maombi/.test(appRow) && /TZS 300,000/.test(appRow) && !/Deni TZS 0/.test(appRow), appRow);
await page.click('#body [data-ref="22171109991"]');
await page.waitForSelector('#locPin_C'); await page.waitForTimeout(250);
const appCard = await page.evaluate(() => document.getElementById('sheetBody').textContent.replace(/\s+/g, ' '));
check('the card opens with the status instead of arrears, the guarantor, and the Location icons for both', /Hali \/ Status/.test(appCard) && /MDHAMINI WAKE/.test(appCard) && !/Deni \/ Arrears/.test(appCard) && !!(await box('#locPin_G')), appCard.slice(0, 160));
pins.length = 0; pinMode = 'store';
await page.click('#locPin_C');
await page.waitForFunction(() => /Saved:/.test(document.getElementById('locNote_C').textContent), null, { timeout: 8000 });
check('and the applicant\'s location is pinned under the REF the loan will carry', pins.length === 1 && pins[0].ref === '22171109991' && pins[0].party === 'C', JSON.stringify(pins[0]));
await page.evaluate(() => sheetHide());
await page.fill('#listQ', '');
await page.waitForTimeout(300);

// --- 11. a phone with no GPS permission is told how to fix it
const ctx2 = await browser.newContext();                      // no geolocation permission granted
await ctx2.addInitScript(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return {}; }; });
const p2 = await ctx2.newPage();
await p2.goto(base + '/'); await openCard('R1', p2);
pinMode = 'store';
await p2.click('#locPin_G');
await p2.waitForFunction(() => { const t = document.getElementById('toast'); return t.style.display !== 'none' && /Location|mahali|GPS/i.test(t.textContent); }, null, { timeout: 25000 }).catch(() => {});
check('a refused permission is explained and the icon comes back', /ruhusa|permission|mahali|GPS/i.test(await p2.evaluate(() => document.getElementById('toast').textContent))
  && !(await p2.evaluate(() => document.getElementById('locPin_G').disabled)));

// --- 12. signing out forgets every point
await page.evaluate(() => doLogout());
await page.waitForTimeout(300);
check('signing out forgets the points kept on the phone', await page.evaluate(() => localStorage.getItem('hcCustLoc') === null));

check('no script errors', errs.length === 0, errs.join(' | '));
await browser.close(); srv.close();
for (const o of ok) console.log('ok   ' + o);
for (const f of fail) console.log('FAIL ' + f);
console.log(ok.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
