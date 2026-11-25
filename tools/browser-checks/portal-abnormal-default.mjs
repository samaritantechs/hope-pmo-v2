/* THE ABNORMAL PAYMENTS TAB OPENS ON THE WHOLE FORTNIGHT; THE LATEST DAY IS THE CHOICE. The REAL public/app.html in a real browser, talking to the REAL
   portalApi over the repository's own fake database.

     "Open Abnormal Payments panel with defaults at the two all weeks view, latest is an opt for user"   -- the owner, 25 Nov 2026 (handbook Part 164)

   ("the two all weeks" is the button "Wiki 2 zote / Whole fortnight"; "latest" is "Siku ya mwisho / Latest day".)

   What it proves:

     1. the tab opens asking for the WHOLE FORTNIGHT ('all'): every flagged payment of the book is listed, the "Wiki 2 zote" button is the lit one, the
        latest-day button is not, and the day-by-day buttons wait (there is no day to step from);
     2. the latest day is a press away: "Siku ya mwisho" asks for 'latest', lists only that day's flagged payments (the day the newest payment is
        from, not today), lights itself, puts that day in the date box and turns the day buttons on;
     3. from there a day either side, a typed day and the whole fortnight all still work, each asking the server for what it shows;
     4. no page error.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-abnormal-default.mjs

   CHROME overrides the browser path; APP_FILE runs it against another copy of the page (the page as it stood before this change opens on the latest day:
   that is what the first point is for). Exit code 0 = everything passed. The dates are worked out from today, so it runs on any day. */
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

const eat = ms => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
const add = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TODAY = eat(Date.now()), D1 = add(TODAY, -1), D3 = add(TODAY, -3), D5 = add(TODAY, -5);
// the newest payment is from THREE days ago (not today): the latest day is that day. Flagged = not a whole multiple of 500.
const P = (id, day, amt, team = 'KONGOWE') => ({ id, team, amount_paid: amt, paid_at: day, transaction_id: 'TX' + id, ref_no: 'R' + id, customer_name: 'CUSTOMER ' + id, customer_no: '0700000000', payment_no: '0711111111', sender_name: 'SENDER ' + id });
const tables = () => ({
  teams: [{ team: 'KONGOWE', team_code: 'C-K', branch: null, zone: 'DAR', opm: null, recovery: null, gmo: null, manager: null, credit: null, expected: null, bike: null }],
  access_codes: [{ code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['abnormal', 'settings'] }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }],
  roles: [], audit_log: [], abnormal_payments: [], followup_status: [], repayment_snapshots: [],
  received_payments: [P('1', D3, 1001), P('2', D3, 1002), P('3', D3, 3000), P('4', D5, 1003), P('5', D5, 1004), P('6', D5, 1005), P('7', D5, 2000)],
});
const ADMIN = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['abnormal', 'settings'] };
const db = fakeDb(tables());
const ASKED = [];
const warn = console.warn; console.warn = () => {};

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname.startsWith('/app')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return; }
  if (u.pathname === '/api/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, build: null })); return; }
  if (u.pathname === '/api/portal') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', async () => {
      const { fn, args } = JSON.parse(b || '{}');
      let out;
      try { if (fn === 'abnormal') ASKED.push((args || {}).date); out = fn === 'abnormal' ? await portalApi(db, ADMIN, fn, args || {}) : { rows: [] }; }
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
const BENIGN = /favicon|status of 404|ERR_FAILED|brand|status of 500|status of 403/;
const UI = { presentSeconds: 3600, refreshSeconds: 6000, hintIntervalSeconds: 3600, hintLifetimeSeconds: 5 };
const state = pg => pg.evaluate(() => {
  const on = sel => { const b = document.querySelector(sel); return !!b && !b.classList.contains('ghost'); };
  const dis = sel => { const b = document.querySelector(sel); return !!b && b.disabled; };
  return { latestLit: on('[data-abn-set="latest"]'), allLit: on('[data-abn-set="all"]'), stepOff: dis('[data-abn-step="-1"]') && dis('[data-abn-step="1"]'), stepOn: !dis('[data-abn-step="-1"]') && !dis('[data-abn-step="1"]'),
    day: (document.getElementById('abnDate') || {}).value, rows: [...document.querySelectorAll('#view table tbody tr')].map(tr => (tr.textContent || '').replace(/\s+/g, ' ').trim()).filter(t => !/^JUMLA/.test(t)).length,
    flagged: ((document.querySelector('#view .kpis .kpi .v') || {}).textContent || '').trim() };
});
const settle = (pg, n) => pg.waitForFunction(k => document.querySelectorAll('#view table tbody tr').length >= 0 && window.__abnSeen >= k, n, { timeout: 8000 }).catch(() => {});

try {
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
page.on('dialog', d => d.accept());
page.setDefaultTimeout(8000);
await page.goto(base + '/');
await page.evaluate(m => { S.code = 'ADM'; start(m); }, { name: ADMIN.name, role: ADMIN.role, teams: ADMIN.teams, teamCount: null, tabs: ADMIN.tabs, can: { dashboard: true, upload: false, admin: true }, ui: UI });
await page.waitForTimeout(300);
await page.evaluate(() => go('abnormal', {}));
await page.waitForFunction(() => document.querySelector('[data-abn-set="all"]'));
await page.waitForTimeout(300);
// ---- 1. the first open
let st = await state(page);
check('1 the tab opens asking for the WHOLE FORTNIGHT', ASKED[0] === 'all', JSON.stringify(ASKED));
check('1 the "Wiki 2 zote / Whole fortnight" button is the lit one, the latest-day button is not', st.allLit && !st.latestLit, JSON.stringify(st));
check('1 the day-by-day buttons wait (no day to step from) and the date box is empty', st.stepOff && st.day === '', JSON.stringify(st));
check('1 every flagged payment of the book is listed (the three of three days ago and the four of five days ago; the whole multiples are not)', st.rows === 7 - 2 && st.flagged === '5', JSON.stringify(st));
if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, 'abnormal-default.png') }); }
// ---- 2. the latest day
await page.click('[data-abn-set="latest"]');
await page.waitForFunction(() => document.getElementById('abnDate') && document.getElementById('abnDate').value);
await page.waitForTimeout(300);
st = await state(page);
check('2 pressing "Siku ya mwisho / Latest day" asks for the latest day', ASKED[ASKED.length - 1] === 'latest', JSON.stringify(ASKED));
check('2 it lists that day\'s flagged payments only (the newest payment is from three days ago, not today)', st.day === D3 && st.rows === 2 && st.flagged === '2', JSON.stringify(st));
check('2 the latest-day button is lit now and the fortnight button is not; the day buttons are on', st.latestLit && !st.allLit && st.stepOn, JSON.stringify(st));
// ---- 3. a day either side, a typed day, the whole fortnight
await page.click('[data-abn-step="-1"]');
await page.waitForFunction(d => { const e = document.getElementById('abnDate'); return !!e && e.value === d; }, add(D3, -1));
await page.waitForTimeout(250);
st = await state(page);
check('3 a day before: that day is asked for and shown (two days before today: nothing flagged), neither big button is lit', ASKED[ASKED.length - 1] === add(D3, -1) && st.day === add(D3, -1) && st.rows === 0 && !st.latestLit && !st.allLit, JSON.stringify(st));
await page.evaluate(d => { const e = document.getElementById('abnDate'); e.value = d; e.dispatchEvent(new Event('change')); }, D5);
await page.waitForFunction(d => { const e = document.getElementById('abnDate'); return !!e && e.value === d && document.querySelectorAll('#view table tbody tr').length > 1; }, D5);
st = await state(page);
check('3 a typed day shows that day\'s three flagged payments', ASKED[ASKED.length - 1] === D5 && st.rows === 3, JSON.stringify(st));
await page.click('[data-abn-set="all"]');
await page.waitForFunction(() => { const e = document.getElementById('abnDate'); return !!e && e.value === ''; });
await page.waitForTimeout(250);
st = await state(page);
check('3 the whole fortnight again: asked for as \'all\', all five listed, its button lit and the day buttons waiting', ASKED[ASKED.length - 1] === 'all' && st.rows === 5 && st.allLit && !st.latestLit && st.stepOff, JSON.stringify(st) + ' ' + JSON.stringify(ASKED));
await page.close();
} catch (e) { fail.push('the check stopped: ' + String((e && e.message) || e).split('\n')[0].slice(0, 260)); }

check('4 no page error', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close(); srv.close(); console.warn = warn;
if (process.env.VERBOSE) for (const o of ok) console.log('ok    ' + o);
for (const f of fail) console.log('FAIL  ' + f);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
