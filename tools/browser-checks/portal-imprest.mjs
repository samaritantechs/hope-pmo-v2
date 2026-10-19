/* Drives the REAL public/app.html in a real browser, against a stub /api/portal, to prove the
   imprest request form's Submit button is wired and sends what was typed -- and that every
   state in which it is closed SAYS WHY on the screen.

     "GMO is saying he can't submit imprest request that the button ain't working"

   The button is wired by wireForms() in the core after every draw, while the form itself is
   drawn by the imprest module (public/mod/imprest.js); a break anywhere between the two leaves
   a button that looks fine and does nothing. That cannot be seen by reading either file.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-imprest.mjs

   CHROME overrides the browser path. Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');

const calls = [];                 // every portal fn the page asked for, in order
const requests = [];              // every imprestRequest body the page sent
let mine = { ok: true, rows: [], roles: [{ role: 'GMO', rate: 30000 }, { role: 'MANAGER', rate: 40000 }], unretired: [], unretiredNote: '' };

function answer(fn, args) {
  calls.push(fn);
  if (fn === 'imprestMine') return mine;
  if (fn === 'imprestRequest') { requests.push(args); return { ok: true, id: 'imp-1', total: 50000, accomRate: 30000, emailed: true, emailNote: '', pushed: 1, pushNote: '' }; }
  if (fn === 'notifications') return { ok: true, unseen: 0, seenAt: '', items: [] };
  if (fn === 'settings') return { ok: true, rows: [] };
  if (fn === 'dashboardFull') return { ok: true, kpis: {}, teams: [], weekdays: [], pipeline: {}, totals: {}, recovery: {}, legal: {} };
  if (fn === 'officerBoards') return { ok: true, boards: [] };
  return { ok: true, rows: [] };
}
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname.startsWith('/app') || u.pathname === '/dashboard') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return; }
  if (u.pathname.startsWith('/mod/')) {                       // the screens that load at tab open
    const f = path.join(ROOT, 'public', u.pathname);
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(f)); return; }
  }
  if (u.pathname === '/api/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, build: null })); return; }
  if (u.pathname === '/api/call') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return; }
  if (u.pathname === '/api/portal') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => { const { fn, args } = JSON.parse(b || '{}'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(answer(fn, args || {}))); });
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 390, height: 800 } });   // a GMO's phone
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
const BENIGN = /favicon|status of 404|ERR_FAILED|brand/;
page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
const ok = [], fail = [];
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (extra ? ' -- ' + extra : ''));
const text = sel => page.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
const btn = () => page.evaluate(() => { const b = document.getElementById('imqSend'); return b ? { there: true, disabled: b.disabled, label: b.textContent.trim(), wired: typeof b.onclick === 'function' } : { there: false }; });
const openForm = async () => {
  await page.evaluate(() => go('impreq'));
  await page.waitForSelector('#imqSend', { timeout: 8000 });
  await page.waitForTimeout(300);
};

await page.goto(base + '/');
// Signed in as a GMO holding the request pane -- driven the way start() does it, as portal-nav.mjs does.
await page.evaluate(() => { S.code = 'GMO1'; start({ name: 'GMO TEST', role: 'GMO', teams: ['KONGOWE'], teamCount: 1,
  tabs: ['dashboard', 'advreq', 'impreq'], ui: { presentSeconds: 30, refreshSeconds: 20, hintIntervalSeconds: 600, hintLifetimeSeconds: 12 } }); });
await page.waitForTimeout(500);

// --- 1. the form opens, the button is there, enabled, and WIRED
await openForm();
let b = await btn();
check('the request form opens for a GMO with the impreq tab', b.there);
check('the Submit button is enabled and has a click handler', b.disabled === false && b.wired && /Tuma ombi/.test(b.label), JSON.stringify(b));

// --- 2. filled and pressed: the request reaches the server with what was typed
await page.selectOption('#imqRole', 'GMO');
await page.fill('#imqEmail', 'gmo@example.com');
await page.fill('#imqTrips', '2'); await page.fill('#imqTrip', '10000');
await page.fill('#imqDays', '1');
await page.fill('#imqDest', 'Mtwara');
await page.fill('#imqPurpose', 'Ukaguzi wa timu');
await page.waitForTimeout(150);
check('the preview totals as typed: 2 x 10,000 + 1 night at 30,000 = 50,000', (await text('#imqTotal')).replace(/[^\d]/g, '') === '50000', await text('#imqTotal'));
await page.click('#imqSend');
await page.waitForFunction(() => /Ombi limetumwa/.test((document.getElementById('imqOut') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
check('pressing Submit sends ONE imprestRequest', requests.length === 1, JSON.stringify(requests.length));
check('with the fields as typed', requests[0] && requests[0].imprestRole === 'GMO' && requests[0].fareTrips === '2' && requests[0].farePerTrip === '10000'
  && requests[0].accomDays === '1' && requests[0].purpose === 'Ukaguzi wa timu' && requests[0].email === 'gmo@example.com', JSON.stringify(requests[0]));
check('and the screen says it was sent, emailed and buzzed', /Ombi limetumwa/.test(await text('#imqOut')) && /GM ameambiwa/.test(await text('#imqOut')) && /simu 1/.test(await text('#imqOut')), await text('#imqOut'));

// --- 3. a figure that is not a whole number closes the button -- and the screen must say why
await openForm();
await page.selectOption('#imqRole', 'GMO');
await page.fill('#imqTrips', '1.5');
await page.waitForTimeout(150);
b = await btn();
check('a decimal closes the button and blanks the total', b.disabled === true && (await text('#imqTotal')).trim() === '—', JSON.stringify(b) + ' total=' + await text('#imqTotal'));
const why1 = await text('#imqWhy');
check('and the screen says WHY it is closed (whole numbers only)', /namba nzima|whole numbers/i.test(why1), why1 || '(no reason shown)');
await page.fill('#imqTrips', '2');
await page.waitForTimeout(150);
b = await btn();
check('fixing the figure reopens it and clears the reason', b.disabled === false && (await text('#imqWhy')).trim() === '', JSON.stringify(b) + ' why=' + await text('#imqWhy'));

// --- 4. an approved imprest not yet retired closes the button, in the server's own words
mine = { ...mine, unretired: ['old-1'], unretiredNote: 'Una imprest 1 iliyoidhinishwa bila retirement (2026-10-10 Lindi · TZS 80,000). Retire hiyo kwanza, kisha omba.' };
await openForm();
b = await btn();
check('an unretired imprest closes the button and relabels it', b.disabled === true && /Retire imprest ya awali/.test(b.label), JSON.stringify(b));
check('with the reason on the screen, in the server\'s words', /bila retirement/.test(await text('#view')) && /Lindi/.test(await text('#view')));
mine = { ...mine, unretired: [], unretiredNote: '' };

// --- 5. no rate table yet: closed, with the red note
mine = { ...mine, roles: [] };
await openForm();
b = await btn();
check('no rates: the button is closed and the note names the approver', b.disabled === true && /hajaweka viwango|not set any role rates/.test(await text('#view')), JSON.stringify(b));

check('no script errors', errs.length === 0, errs.join(' | '));
await browser.close(); srv.close();
for (const o of ok) console.log('ok   ' + o);
for (const f of fail) console.log('FAIL ' + f);
console.log(ok.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
