/* Drives the REAL public/app.html in a real browser, against a stub /api/portal, to prove the
   Leave & Holiday ask screen's own fields (lvReason/lvStart/lvEnd/lvSubmit) are wired once a
   name is picked, and stay wired.

     "clicking name on omba likizo - Imeshindikana / Could not load.
      Cannot set properties of null (setting 'onchange')" -- the owner

   VIEWS.leavereq's own promise sets HEAD and used to wire those fields in the same breath --
   before drawView_() ever paints HEAD into the page (the exact bug HOPE Loan's own HEAD buttons
   had on first write; see the note beside wireLnCs_ in app.html, and portal-imprest.mjs's own
   doc-comment for the same class of bug on impreq's Submit button). That cannot be seen by
   reading either file: the form these fields live in is drawn once a name is chosen, and a name
   is chosen by a change event the FIRST time, after the page the chat had been looking at (no
   name chosen, no fields at all) was already painted.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-leave-ask.mjs

   CHROME overrides the browser path. Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
const LEAVE_JS = fs.readFileSync(path.join(ROOT, 'public/mod/leave.js'), 'utf8');

const calls = [];                 // every portal fn the page asked for, in order
const requests = [];              // every leaveRequest body the page sent
const STAFF = { id: 'S1', name: 'ASHA K', role: 'FIELD OFFICER', zone: 'LAKE ZONE' };

function page_(staffId) {
  const chosen = staffId === STAFF.id ? STAFF : null;
  return { ok: true, on: true, staff: [STAFF], chosen,
    reasons: ['LIKIZO', 'UGONJWA', 'Other'], zones: ['LAKE ZONE'], role: 'FIELD OFFICER',
    route: chosen ? { kind: 'role', label: 'GMO · JUMA G' } : null,
    balance: chosen ? { annualDays: 26, taken: 0, pending: 0, remaining: 26 } : null,
    canHistory: true, history: [] };
}
function answer(fn, args) {
  calls.push(fn);
  if (fn === 'leaveRequestPage') return page_(args.staffId);
  if (fn === 'leaveRequest') { requests.push(args); return { ok: true, days: 3, route: { label: 'GMO · JUMA G' } }; }
  if (fn === 'notifications') return { ok: true, unseen: 0, seenAt: '', items: [] };
  if (fn === 'settings') return { ok: true, rows: [] };
  if (fn === 'dashboardFull') return { ok: true, kpis: {}, teams: [], weekdays: [], pipeline: {}, totals: {}, recovery: {}, legal: {} };
  if (fn === 'officerBoards') return { ok: true, boards: [] };
  return { ok: true, rows: [] };
}
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname.startsWith('/app') || u.pathname === '/dashboard') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return; }
  if (u.pathname === '/mod/leave.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(LEAVE_JS); return; }
  if (u.pathname.startsWith('/mod/')) {
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
const page = await browser.newPage({ viewport: { width: 390, height: 800 } });   // a field officer's phone
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
const BENIGN = /favicon|status of 404|ERR_FAILED|brand/;
page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
const ok = [], fail = [];
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (extra ? ' -- ' + extra : ''));
const text = sel => page.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
const wired = sel => page.evaluate(s => { const el = document.querySelector(s); return !!el && typeof (el.onclick || el.onchange || el.oninput) === 'function'; }, sel);

await page.goto(base + '/');
// Signed in as a field officer holding the leavereq tab -- driven the way start() does it, as portal-nav.mjs does.
await page.evaluate(() => { S.code = 'FO1'; start({ name: 'FO TEST', role: 'FIELD OFFICER', teams: ['KONGOWE'], teamCount: 1,
  tabs: ['dashboard', 'leavereq'], ui: { presentSeconds: 30, refreshSeconds: 20, hintIntervalSeconds: 600, hintLifetimeSeconds: 12 } }); });
await page.waitForTimeout(500);

// --- 1. the ask screen opens, no name chosen yet: the picker is there, the form is not
await page.evaluate(() => go('leavereq'));
await page.waitForSelector('select[data-arg="staffId"]', { timeout: 8000 });
await page.waitForTimeout(300);
check('the ask screen opens for a field officer with the leavereq tab', (await text('#view')).length > 0);
check('no form fields before a name is picked', (await page.$('#lvStart')) === null && (await page.$('#lvSubmit')) === null);

// --- 2. CLICKING THE NAME -- the exact action the owner's report names
await page.selectOption('select[data-arg="staffId"]', STAFF.id);
await page.waitForSelector('#lvSubmit', { timeout: 8000 });
await page.waitForTimeout(300);
check('no script error when a name is picked for the first time', errs.length === 0, errs.join(' | '));
check('the form appears, with Start/End/Reason/Submit all in the real DOM', await page.$('#lvStart') && await page.$('#lvEnd') && await page.$('#lvReason') && await page.$('#lvSubmit'));

// --- 3. every field a name picked should have wired is actually wired (not looking fine and doing nothing)
check('#lvReason.onchange is wired', await wired('#lvReason'));
check('#lvStart.oninput is wired', await wired('#lvStart'));
check('#lvEnd.oninput is wired', await wired('#lvEnd'));
check('#lvSubmit.onclick is wired', await wired('#lvSubmit'));

// --- 4. the Other-reason field toggles, and the day count recalculates -- proof the wiring runs, not just exists
await page.selectOption('#lvReason', 'Other');
await page.waitForTimeout(100);
check('"Other" reveals the other-reason box', await page.evaluate(() => document.getElementById('lvOtherFld').style.display !== 'none'));
await page.selectOption('#lvReason', 'LIKIZO');
await page.waitForTimeout(100);
check('picking a named reason hides it again', await page.evaluate(() => document.getElementById('lvOtherFld').style.display === 'none'));
await page.fill('#lvStart', '2026-11-16'); await page.fill('#lvEnd', '2026-11-18');
await page.waitForTimeout(100);
check('the day count recalculates as the dates change', /3 siku|3 day/.test(await text('#lvDaysNote')), await text('#lvDaysNote'));

// --- 5. pressing Submit actually sends ONE leaveRequest, with what was filled in
page.on('dialog', d => d.accept());
await page.fill('#lvCover', 'BAKARI');
await page.click('#lvSubmit');
await page.waitForFunction(() => /Ombi limetumwa/.test((document.getElementById('toast') || {}).textContent || ''), null, { timeout: 4000 }).catch(() => {});
await page.waitForTimeout(300);
check('pressing Submit sends ONE leaveRequest', requests.length === 1, JSON.stringify(requests.length));
check('with the fields as typed', requests[0] && requests[0].staffId === 'S1' && requests[0].startDate === '2026-11-16'
  && requests[0].endDate === '2026-11-18' && requests[0].reason === 'LIKIZO' && requests[0].coverName === 'BAKARI', JSON.stringify(requests[0]));

// --- 6. switching to a name with no clean effect of a stale handler: re-picking the same name wires once more, harmlessly
await page.selectOption('select[data-arg="staffId"]', '');
await page.waitForTimeout(200);
await page.selectOption('select[data-arg="staffId"]', STAFF.id);
await page.waitForSelector('#lvSubmit', { timeout: 8000 });
await page.waitForTimeout(300);
check('no script error re-picking the name a second time', errs.length === 0, errs.join(' | '));

check('no script errors over the whole run', errs.length === 0, errs.join(' | '));
await browser.close(); srv.close();
for (const o of ok) console.log('ok   ' + o);
for (const f of fail) console.log('FAIL ' + f);
console.log(ok.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
