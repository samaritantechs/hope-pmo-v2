/* THE PMO DEDUCTION FORM: SEVERAL CUSTOMERS IN ONE CASE, AND ONE PRESS OF SAVE IS ONE CASE. The REAL public/app.html and public/mod/deduct.js in a
   real browser, talking to the REAL portalApi over the repository's own fake database (the server answers slowly and, once, with a failure, on purpose).

     "at filling deductions case, we can add another customer & ref no in the same case as we add multi officers"
     "[a reporter] pressed multiple times at submitting deduction case and deductions went so many (16) so we must delete all unique rows in the
      existing deductions bro and prevent such an issue in the future"                           -- the owner, 25 Nov 2026 (handbook Part 164)

   What it proves:

     1. the form has a customer row (name and REF NO) like the accused-staff rows: "+ Ongeza mteja mwingine / Add another customer" adds one,
        "✕ Ondoa huyu / Remove" takes one off, the last one cannot be removed, and a row left empty is no customer;
     2. a customer row with only a name, or only a REF NO, is said and NOTHING is sent;
     3. a case with three customers and two accused staff is saved as ONE case of two lines, every customer and every REF NO in the two cells
        the list, its Excel and the search read (in the order typed), and the list shows them;
     4. ONE PRESS, ONE CASE: with the server answering slowly, sixteen presses of Save (the button, and the handler itself called as if the
        button had not been switched off) send ONE request; while it is on its way the button is off and says it is saving; afterwards the
        form is closed, the register holds one case, and the toast says it was saved;
     5. a failed save brings the button back with its words, keeps everything typed, says NOT saved and why, and the next press saves it;
     6. the same case filled in again from a fresh form is told it was already saved, and the register still holds ONE case of its lines;
     7. no page error in any world.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-deductions-form.mjs

   CHROME overrides the browser path; APP_FILE and MOD_DIR run it against another copy of the page and of the modules; SHOTS=<dir> saves a picture.
   Exit code 0 = everything passed. The dates are worked out from today, so it runs on any day. */
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
const APP = fs.readFileSync(process.env.APP_FILE || path.join(ROOT, 'public/app.html'), 'utf8');
const MOD_DIR = process.env.MOD_DIR || path.join(ROOT, 'public/mod');

const eat = ms => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
const TODAY = eat(Date.now());
const tables = () => ({
  teams: [{ team: 'KONGOWE', team_code: 'C-K', branch: null, zone: 'DAR', opm: null, recovery: null, gmo: null, manager: null, credit: null, expected: null, bike: null }],
  access_codes: [{ code: 'GMO1', name: 'JUMA G', role: 'GMO', teams: ['KONGOWE'], tabs: ['deduct'] }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }, { key: 'DEDUCTION_REPORTER_TZS', value: '10000' }],
  roles: [], audit_log: [], pmo_deductions: [],
});
const GMO = { code: 'GMO1', name: 'JUMA G', role: 'GMO', teams: ['KONGOWE'], tabs: ['deduct'] };
let db = fakeDb(tables());
let DELAY = 0, FAIL_NEXT = false, SENT = [];
const REAL = new Set(['deductions', 'addDeduction']);
const warn = console.warn; console.warn = () => {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
      try {
        if (fn === 'addDeduction') {
          SENT.push(args);
          if (DELAY) await sleep(DELAY);
          if (FAIL_NEXT) { FAIL_NEXT = false; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'the database did not answer in time' })); return; }
        }
        out = REAL.has(fn) ? await portalApi(db, GMO, fn, args || {}) : { rows: [] };
      } catch (e) { res.writeHead(e.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) })); return; }
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
const BENIGN = /favicon|status of 404|ERR_FAILED|brand|status of 500|status of 403/;
const UI = { presentSeconds: 3600, refreshSeconds: 6000, hintIntervalSeconds: 3600, hintLifetimeSeconds: 5 };

async function open() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(8000);
  await page.goto(base + '/');
  await page.evaluate(m => { S.code = 'GMO'; start(m); }, { name: GMO.name, role: GMO.role, teams: GMO.teams, teamCount: null, tabs: GMO.tabs, can: { dashboard: true, upload: false, admin: false }, ui: UI });
  await page.waitForTimeout(300);
  await page.evaluate(() => go('deduct', {}));
  await page.waitForFunction(() => document.getElementById('newDeduction'));
  await page.waitForTimeout(200);
  return page;
}
const toastOf = pg => pg.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
const rowsInDrawer = (pg, cls) => pg.evaluate(c => document.querySelectorAll('#drawer .' + c).length, cls);
const stored = () => db._dump('pmo_deductions');
const fillCust = (pg, i, name, ref) => pg.evaluate(([i, n, r]) => { const el = document.querySelectorAll('#drawer .ded-cust')[i]; el.querySelector('.dcName').value = n; el.querySelector('.dcRef').value = r; }, [i, name, ref]);
const fillStaff = (pg, i, name, taken, ded) => pg.evaluate(([i, n, t, d]) => { const el = document.querySelectorAll('#drawer .ded-staff')[i]; el.querySelector('.dsName').value = n; el.querySelector('.dsTaken').value = t; el.querySelector('.dsDed').value = d; }, [i, name, taken, ded]);
const fillRest = async pg => { await pg.selectOption('#ddTeam', 'KONGOWE'); await pg.fill('#ddRecv', TODAY); await pg.fill('#ddDec', 'Kikao kiliamua afisa akatwe'); await pg.fill('#ddPay', '57000'); };

try {
let page = await open();
// ---- 1. the form
await page.click('#newDeduction'); await page.waitForSelector('#ddSave');
check('1 the form opens with ONE customer row (name and REF NO) and one staff row', (await rowsInDrawer(page, 'ded-cust')) === 1 && (await rowsInDrawer(page, 'ded-staff')) === 1);
check('1 there is a button to add another customer, and one to add another staff', await page.evaluate(() => /Ongeza mteja mwingine \/ Add another customer/.test((document.getElementById('ddAddCust') || {}).textContent || '') && !!document.getElementById('ddAdd')));
check('1 the old single boxes are gone (one customer is a row of the list)', await page.evaluate(() => !document.getElementById('ddCust') && !document.getElementById('ddRef')));
await page.click('#ddAddCust'); await page.click('#ddAddCust');
check('1 pressing Add another customer twice makes three rows', (await rowsInDrawer(page, 'ded-cust')) === 3);
check('1 the new row has the focus (the next name is typed straight away)', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('dcName') && document.activeElement === document.querySelectorAll('#drawer .dcName')[2]));
if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, 'deduction-form-customers.png') }); }
await fillCust(page, 0, 'CUSTOMER A', '9900000001'); await fillCust(page, 1, 'CUSTOMER B', '9900000002'); await fillCust(page, 2, '', '');
// remove the empty third row; the last remaining row cannot be removed
await page.evaluate(() => document.querySelectorAll('#drawer .dcRm')[2].click());
check('1 a row can be taken off', (await rowsInDrawer(page, 'ded-cust')) === 2);
await page.evaluate(() => { document.querySelectorAll('#drawer .dcRm')[1].click(); });
await page.evaluate(() => { document.querySelectorAll('#drawer .dcRm')[0].click(); });
check('1 the LAST customer row cannot be removed, and it says so', (await rowsInDrawer(page, 'ded-cust')) === 1 && /Angalau mteja mmoja/.test(await toastOf(page)), await toastOf(page));
await page.click('#ddAddCust'); await page.click('#ddAddCust');
await fillCust(page, 0, 'CUSTOMER A', '9900000001'); await fillCust(page, 1, 'CUSTOMER B', '9900000002'); await fillCust(page, 2, 'CUSTOMER C', '9900000003');
await fillStaff(page, 0, 'STAFF ONE', '1500', '120000'); await page.click('#ddAdd'); await fillStaff(page, 1, 'STAFF TWO', '0', '60000');
await fillRest(page);
// ---- 2. half a customer is said and nothing is sent
await fillCust(page, 1, 'CUSTOMER B', '');
await page.click('#ddSave'); await page.waitForTimeout(300);
check('2 a customer with a name and no REF NO is said, and nothing is sent', SENT.length === 0 && /Kila mteja anahitaji jina na REF NO/.test(await toastOf(page)) && stored().length === 0, await toastOf(page));
await fillCust(page, 1, '', '9900000002');
await page.click('#ddSave'); await page.waitForTimeout(300);
check('2 a customer with a REF NO and no name is said too, and nothing is sent', SENT.length === 0 && /Kila mteja anahitaji jina na REF NO/.test(await toastOf(page)));
await fillCust(page, 1, 'CUSTOMER B', '9900000002');

// ---- 4. ONE PRESS, ONE CASE: a slow server, sixteen presses
DELAY = 1200;
await page.evaluate(() => { document.getElementById('ddSave').click(); });
await page.waitForTimeout(150);
const during = await page.evaluate(() => { const b = document.getElementById('ddSave'); return { off: b.disabled, label: b.textContent }; });
check('4 while the save is on its way the button is OFF and says it is saving', during.off === true && /Inahifadhi… \/ Saving…/.test(during.label), JSON.stringify(during));
await page.evaluate(() => { const b = document.getElementById('ddSave'); for (let i = 0; i < 8; i++) b.click(); for (let i = 0; i < 7; i++) b.onclick(); });   // the button AND the handler called as if it were not switched off
await page.waitForTimeout(100);
await page.waitForFunction(() => document.getElementById('drawerBg').style.display === 'none', null, { timeout: 8000 });
await page.waitForTimeout(400);
check('4 sixteen presses sent ONE request', SENT.length === 1, 'sent ' + SENT.length);
check('4 the request carries the three customers, in the order typed, and no old single pair', JSON.stringify((SENT[0] || {}).customers) === JSON.stringify([{ name: 'CUSTOMER A', ref: '9900000001' }, { name: 'CUSTOMER B', ref: '9900000002' }, { name: 'CUSTOMER C', ref: '9900000003' }]) && SENT[0].customer === undefined && SENT[0].ref === undefined, JSON.stringify(SENT[0]));
let rows = stored();
check('4 the register holds ONE case of two lines', rows.length === 2 && new Set(rows.map(r => r.case_id)).size === 1, rows.length + ' lines, ' + new Set(rows.map(r => r.case_id)).size + ' cases');
check('3 every customer and every REF NO is in the two cells of every line, in the order typed', rows.every(r => r.customer === 'CUSTOMER A, CUSTOMER B, CUSTOMER C' && r.ref === '9900000001, 9900000002, 9900000003'), JSON.stringify(rows.map(r => [r.customer, r.ref])));
check('4 the form is closed and the toast says the case was saved with its customers', await page.evaluate(() => document.getElementById('drawerBg').style.display === 'none') && /Kesi imehifadhiwa: 2 staff, wateja 3\. \/ Case saved: 2 staff line\(s\), 3 customers\./.test(await toastOf(page)), await toastOf(page));
await page.waitForFunction(() => document.querySelectorAll('#view table tbody tr').length >= 2);
const listed = await page.evaluate(() => [...document.querySelectorAll('#view table tbody tr')].map(tr => (tr.textContent || '').replace(/\s+/g, ' ').trim()));
check('3 the list shows the case: two lines, each with all three customers and all three REF NOs', listed.filter(t => t.includes('CUSTOMER A, CUSTOMER B, CUSTOMER C') && t.includes('9900000001, 9900000002, 9900000003')).length === 2, JSON.stringify(listed.map(t => t.slice(0, 120))));
const dl = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#mainCard [data-xls]')]).then(r => r[0]).catch(() => null);
const xl = dl ? fs.readFileSync(await dl.path()).toString('utf8') : '';
check('3 its Excel carries them too', /CUSTOMER A, CUSTOMER B, CUSTOMER C/.test(xl) && /9900000001, 9900000002, 9900000003/.test(xl));
await page.fill('#tblQ', '9900000002'); await page.waitForTimeout(400);
check('3 a search for the SECOND customer\'s REF NO finds the case', await page.evaluate(() => document.querySelectorAll('#view table tbody tr').length >= 2));
await page.fill('#tblQ', ''); await page.waitForTimeout(300);

// ---- 6. the same case from a fresh form: already saved
DELAY = 0; SENT = [];
await page.click('#newDeduction'); await page.waitForSelector('#ddSave');
await page.click('#ddAddCust'); await page.click('#ddAddCust');
await fillCust(page, 0, 'CUSTOMER A', '9900000001'); await fillCust(page, 1, 'CUSTOMER B', '9900000002'); await fillCust(page, 2, 'CUSTOMER C', '9900000003');
await fillStaff(page, 0, 'STAFF ONE', '1500', '120000'); await page.click('#ddAdd'); await fillStaff(page, 1, 'STAFF TWO', '0', '60000');
await fillRest(page);
await page.click('#ddSave'); await page.waitForFunction(() => document.getElementById('drawerBg').style.display === 'none'); await page.waitForTimeout(300);
check('6 the same case filled in again is told it was ALREADY saved, not repeated', SENT.length === 1 && /Kesi hii ilikwisha hifadhiwa — haikurudiwa\. \/ This case was already saved — not repeated\./.test(await toastOf(page)), await toastOf(page));
check('6 and the register still holds ONE case of two lines', stored().length === 2 && new Set(stored().map(r => r.case_id)).size === 1);
check('6 the earners\' table counts ONE case for the reporter', await page.evaluate(() => { const c = document.getElementById('dedEarn'); return !!c && [...c.querySelectorAll('tbody tr')].some(tr => /JUMA G/.test(tr.textContent) && (tr.children[3] || {}).textContent.trim() === '1'); }));

// ---- 5. a failed save keeps everything and brings the button back
FAIL_NEXT = true; SENT = [];
await page.click('#newDeduction'); await page.waitForSelector('#ddSave');
await fillCust(page, 0, 'ZAWADI K', '999000111'); await fillStaff(page, 0, 'STAFF THREE', '10', '10'); await fillRest(page);
await page.click('#ddSave'); await page.waitForTimeout(500);
const after = await page.evaluate(() => { const b = document.getElementById('ddSave'); return { there: !!b, off: b && b.disabled, label: b && b.textContent, cust: (document.querySelector('#drawer .dcName') || {}).value, staff: (document.querySelector('#drawer .dsName') || {}).value, dec: (document.getElementById('ddDec') || {}).value }; });
check('5 a failed save: the form stays open with everything typed, and the button is back with its words', after.there && after.off === false && after.label === 'Hifadhi kesi / Save case' && after.cust === 'ZAWADI K' && after.staff === 'STAFF THREE' && /Kikao/.test(after.dec), JSON.stringify(after));
check('5 it says NOT saved and why', /Haikuhifadhiwa \/ NOT saved: .*did not answer in time/.test(await toastOf(page)), await toastOf(page));
check('5 nothing was stored by the failed press', stored().length === 2);
await page.click('#ddSave'); await page.waitForFunction(() => document.getElementById('drawerBg').style.display === 'none'); await page.waitForTimeout(300);
check('5 the next press saves it: two requests in all, the register now holds two cases', SENT.length === 2 && stored().length === 3 && new Set(stored().map(r => r.case_id)).size === 2, SENT.length + ' sent, ' + stored().length + ' lines');
await page.close();
} catch (e) { fail.push('the check stopped: ' + String((e && e.message) || e).split('\n')[0].slice(0, 260)); }

check('7 no page error in any world', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close(); srv.close(); console.warn = warn;
if (process.env.VERBOSE) for (const o of ok) console.log('ok    ' + o);
for (const f of fail) console.log('FAIL  ' + f);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
