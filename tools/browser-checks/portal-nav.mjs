/* Drives the REAL public/app.html in a real browser, against a stub /api/portal, to prove the
   no-reload navigation works before it goes anywhere near the live system. A concurrency change
   shipped on reasoning alone once took this system down in the field; UI behaviour like "does
   the page stay put" cannot be checked any other way than by looking at a page.

   Lives OUTSIDE test/ on purpose: `node --test` sweeps that whole directory, so a check that
   needs a browser installed would have made `npm test` fail on any machine without one -- and
   npm test guards the deploy. playwright-core is likewise not in package.json. To run it:

       npm i --no-save playwright-core
       CHROME=/path/to/chrome node tools/browser-checks/portal-nav.mjs

   CHROME defaults to the Playwright chromium in this container. Exit code 0 = everything
   passed. Any timing check reads the screen in the SAME evaluate() as the click that causes
   it: over localhost the stub answers in under a millisecond, so a second round trip can miss
   the spinner entirely and fail a test that is actually fine. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
const calls = [];               // every request the page makes, in order

const teamRows = [
  { team: 'KONGOWE', ref: 'R1', full_name: 'AMINA JUMA', contact: '0712000001', payment_expected: 1000, todays_status: 'UNPAID', arrears: 0 },
  { team: 'MBAGALA', ref: 'R2', full_name: 'PILI SALUM', contact: '0714000001', payment_expected: 2000, todays_status: 'PAID', arrears: 0 },
];

function answer(fn) {
  if (fn === 'expectedDay') return {
    ok: true, weekday: 'MON', todayWeekday: 'MON', date: '2026-08-01', weekdays: ['MON', 'TUE'],
    teams: ['KONGOWE', 'MBAGALA'], byStatus: [{ status: 'UNPAID', count: 1 }, { status: 'PAID', count: 1 }],
    totals: { expected: 3000, collected: 2000, uncollected: 1000, pct: 0.66, installments: 2, paid: 1, unpaid: 1, underpaid: 0 },
    rows: teamRows,
  };
  if (fn === 'par') return { ok: true, rows: [], totals: {}, teams: [] };
  if (fn === 'dashboardFull') return { ok: true, kpis: {}, teams: [], weekdays: [], pipeline: {}, totals: {} };
  if (fn === 'officerBoards') return { ok: true, boards: [] };
  if (fn === 'settingSet') return { ok: true };
  return { ok: true, rows: [], totals: {}, teams: [] };
}

const srv = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/app')) {
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return;
  }
  if (req.url === '/api/portal') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => {
      const { fn } = JSON.parse(b || '{}');
      calls.push(fn);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(answer(fn)));
    });
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
// the stub server has no favicon or logo, and test 6 aborts requests on purpose
const BENIGN = /favicon|status of 404|ERR_FAILED/;
page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
await page.goto(base + '/');

// Get past sign-in by driving the page's own state, the way start() does.
await page.evaluate(() => { S.code = 'X'; start({ name: 'TESTER', role: 'ADMIN', teams: null, teamCount: 0, tabs: null }); });
await page.waitForTimeout(400);

const ok = [];
const fail = [];
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (extra ? ' -- ' + extra : ''));

// --- 1. first visit to a tab asks the server and shows rows
calls.length = 0;
await page.evaluate(() => go('expected'));
await page.waitForTimeout(400);
let n1 = calls.filter(c => c === 'expectedDay').length;
let rows1 = await page.evaluate(() => document.querySelectorAll('#view table tbody tr').length);
check('first visit fetches once and draws rows', n1 === 1 && rows1 === 2, 'fetches=' + n1 + ' rows=' + rows1);

// --- 2. go away and come straight back: the table must be there with NO blank spinner
await page.evaluate(() => go('par'));
await page.waitForTimeout(300);
calls.length = 0;
// read the screen in the SAME round trip as the click -- on localhost the quiet refresh can
// finish before a second evaluate() lands, which is a harness artefact, not the real thing
const instant = await page.evaluate(() => {
  go('expected');
  return {
    rows: document.querySelectorAll('#view table tbody tr').length,
    spinner: !!document.querySelector('#view .sk'),
    busy: !!document.querySelector('#busy.on'),
  };
});
check('returning to a tab is instant, no blank screen',
  instant.rows === 2 && !instant.spinner, JSON.stringify(instant));
check('a hairline shows while it refreshes behind you', instant.busy, JSON.stringify(instant));
await page.waitForTimeout(400);
check('and it still checks the server quietly', calls.filter(c => c === 'expectedDay').length === 1,
  'quiet fetches=' + calls.filter(c => c === 'expectedDay').length);
const after = await page.evaluate(() => document.querySelectorAll('#view table tbody tr').length);
check('rows survive the quiet refresh', after === 2, 'rows=' + after);

// --- 3. the reload button must always go to the server AND blank for a fresh load
calls.length = 0;
// read the blank state in the SAME round trip -- on localhost the stub can answer and repaint
// before a second evaluate() even lands, which makes the check flaky rather than wrong
const dur = await page.evaluate(() => { document.getElementById('refBtn').click(); return !!document.querySelector('#view .sk'); });
await page.waitForTimeout(400);
check('reload button ignores what we remembered', calls.filter(c => c === 'expectedDay').length === 1 && dur,
  'fetches=' + calls.filter(c => c === 'expectedDay').length + ' blanked=' + dur);

// --- 4. a WRITE throws the remembered screens away
await page.evaluate(() => srv('settingSet', { key: 'X', value: '1' }));
await page.waitForTimeout(200);
const emptied = await page.evaluate(() => Object.keys(VC.store).length);
check('saving anything clears every remembered screen', emptied === 0, 'left=' + emptied);
calls.length = 0;
const blanked = await page.evaluate(() => { go('expected'); return !!document.querySelector('#view .sk'); });
await page.waitForTimeout(400);
check('so the next visit really re-asks', calls.filter(c => c === 'expectedDay').length === 1 && blanked,
  'fetches=' + calls.filter(c => c === 'expectedDay').length);

// --- 5. a filter narrows without any trip to the server, and the choice comes back with the tab
calls.length = 0;
await page.evaluate(() => {
  const sel = document.querySelector('[data-filter="team"]');
  sel.value = 'KONGOWE'; sel.onchange();
});
const filtered = await page.evaluate(() => document.querySelectorAll('#view table tbody tr').length);
check('filtering costs no network call', calls.length === 0 && filtered === 1,
  'calls=' + calls.length + ' rows=' + filtered);
await page.evaluate(() => go('par'));
await page.waitForTimeout(300);
await page.evaluate(() => go('expected'));
const back = await page.evaluate(() => ({
  rows: document.querySelectorAll('#view table tbody tr').length,
  box: (document.querySelector('[data-filter="team"]') || {}).value,
}));
check('the box and the rows agree when you come back',
  back.rows === 1 && back.box === 'KONGOWE', JSON.stringify(back));
await page.waitForTimeout(400);

// --- 6. a failed quiet refresh must NOT wipe a page someone is reading
await page.evaluate(() => go('par'));
await page.waitForTimeout(300);
await page.evaluate(() => go('expected'));
await page.waitForTimeout(400);
await page.route('**/api/portal', r => r.abort());
calls.length = 0;
await page.evaluate(() => go('par'));
await page.waitForTimeout(200);
await page.evaluate(() => go('expected'));
await page.waitForTimeout(600);
const survived = await page.evaluate(() => ({
  rows: document.querySelectorAll('#view table tbody tr').length,
  err: !!document.querySelector('#view .msg.bad'),
  busy: !!document.querySelector('#busy.on'),
}));
check('a dropped connection does not take your page away',
  survived.rows >= 1 && !survived.err && !survived.busy, JSON.stringify(survived));
await page.unroute('**/api/portal');

console.log('\nPASS');
ok.forEach(s => console.log('  ok   ' + s));
if (fail.length) { console.log('\nFAIL'); fail.forEach(s => console.log('  FAIL ' + s)); }
if (errs.length) { console.log('\nPAGE ERRORS'); errs.forEach(s => console.log('  ! ' + s)); }
console.log('\n' + ok.length + ' passed, ' + fail.length + ' failed, ' + errs.length + ' page errors');

await browser.close(); srv.close();
process.exit(fail.length || errs.length ? 1 : 0);
