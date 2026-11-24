/* THE PMO DEDUCTIONS LIST HAS NO BRANCH COLUMN: the REAL public/app.html and public/mod/deduct.js in a real browser, talking to the
   REAL portalApi over the repository's own fake database.

     "At Makato ya PMO / PMO Deduction Orodha / List, remove branch column" -- the owner, 24 Nov 2026 (handbook Part 143)

   What it proves:

     1. the list of cases goes Date, Reporter, Dept, Team, Customer, REF NO ...: no header says Branch, and the team's branch
        (which the server still answers with each row) is printed nowhere in the table;
     2. the row itself is whole: the team, then the customer, the accused staff and the amounts, each under its own header;
     3. the list's own columns (what its Excel, JPG and CSV are made from) do not hold the branch either;
     4. the other two lists of the tab (balances before the window, the reporters) have no Branch column;
     5. the columns that remain are the ones the list had, in the order it had them: nothing else moved;
     6. no page error.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-deductions-list.mjs

   CHROME overrides the browser path; APP_FILE and MOD_DIR run it against another copy of the page and of the modules;
   SHOTS=<dir> saves a picture. Exit code 0 = everything passed. The dates are worked out from today, so it runs on any day. */
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
const MONTH1 = TODAY.slice(0, 8) + '01';
const before = (() => { const d = new Date(MONTH1 + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 10); return d.toISOString().slice(0, 10); })();

/* THE BOOK: one team that HAS a branch (so the server answers one with every row), two staff lines of one case this month, and a
   balance left over from before the month. Made-up people. */
const BRANCH = 'TAWI LA MFANO';
const db = fakeDb({
  teams: [{ team: 'KONGOWE', team_code: 'C-K', branch: BRANCH, zone: 'DAR', opm: null, recovery: null, gmo: null, manager: null, credit: null, expected: null, bike: null }],
  access_codes: [{ code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['deduct'] }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }],
  roles: [], audit_log: [],
  pmo_deductions: [
    { id: 'd1', case_id: 'K1', submitted_at: TODAY + 'T06:00:00Z', dept: 'RECOVERY', reporter: 'MTOA TAARIFA', team: 'KONGOWE', customer: 'MTEJA MMOJA', ref: '9900000001',
      staff: 'STAFF WA KWANZA', amount_taken: 50000, received_date: MONTH1, discovery_date: TODAY, decision: 'Akatwe', deduction: 50000, to_pay: 50000, hr_notes: null, deducted: 20000, remaining: 30000 },
    { id: 'd2', case_id: 'K1', submitted_at: TODAY + 'T06:00:00Z', dept: 'RECOVERY', reporter: 'MTOA TAARIFA', team: 'KONGOWE', customer: 'MTEJA MMOJA', ref: '9900000001',
      staff: 'STAFF WA PILI', amount_taken: 10000, received_date: MONTH1, discovery_date: TODAY, decision: 'Akatwe', deduction: 10000, to_pay: 50000, hr_notes: null, deducted: 0, remaining: 0 },
    { id: 'd0', case_id: 'K0', submitted_at: before + 'T06:00:00Z', dept: 'RECOVERY', reporter: 'MTOA TAARIFA', team: 'KONGOWE', customer: 'MTEJA WA ZAMANI', ref: '9900000000',
      staff: 'STAFF WA ZAMANI', amount_taken: 7000, received_date: before, discovery_date: before, decision: 'Akatwe', deduction: 7000, to_pay: 7000, hr_notes: null, deducted: 0, remaining: 7000 },
  ],
});
const USER = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['deduct'] };
const REAL = new Set(['deductions']);
const warn = console.warn; console.warn = () => {};

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
      try { out = REAL.has(fn) ? await portalApi(db, USER, fn, args || {}) : { rows: [] }; }
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
const BENIGN = /favicon|status of 404|ERR_FAILED|brand|status of 500/;
const UI = { presentSeconds: 3600, refreshSeconds: 6000, hintIntervalSeconds: 3600, hintLifetimeSeconds: 5 };
const ME = { name: 'THE ADMIN', role: 'ADMIN', teams: null, teamCount: null, tabs: ['deduct'], can: { dashboard: true, upload: false, admin: true }, ui: UI };

const page = await browser.newPage({ viewport: { width: 1700, height: 900 } });
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
page.on('dialog', d => d.accept());
page.setDefaultTimeout(8000);
await page.goto(base + '/');
await page.evaluate(m => { S.code = 'ADM'; start(m); }, ME);
await page.waitForTimeout(400);
await page.evaluate(() => go('deduct'));
await page.waitForFunction(() => document.querySelectorAll('#view table tbody tr').length >= 2);

/** The table on screen: its headers and its rows' cells, as text; and the list's own columns (what the exports are made from). */
const read = () => page.evaluate(() => {
  const t = document.querySelector('#view table');
  const txt = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
  return { head: t ? [...t.querySelectorAll('thead th')].map(txt) : [], rows: t ? [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(txt)) : [],
    keys: (S.cols || []).map(c => c.key), all: t ? txt(t) : '', view: txt(document.getElementById('view')) };
});
// A sorted column's header carries an arrow; it is taken off by its character code (never typed here: an invisible or look-alike
// character in a check is a check that passes for the wrong reason).
const ARROWS = new RegExp('[' + [0x25b2, 0x25bc, 0x2191, 0x2193, 0x21c5].map(c => String.fromCharCode(c)).join('') + ']', 'g');
const strip = h => h.replace(ARROWS, '').trim();

let L = await read();
const head = L.head.map(strip);
check('1 no header of the cases list says Branch', head.length > 0 && !head.some(h => /branch|tawi/i.test(h)), JSON.stringify(head));
check('1 the team\'s branch, which the server still answers, is printed nowhere on the tab', !L.view.includes(BRANCH), '');
const want = ['Tarehe / Date', 'Aliyeripoti / Reporter', 'Dept', 'Team', 'Mteja / Customer', 'REF NO', 'Staff mtuhumiwa / Accused staff', 'Alichokula / Taken',
  'Aliyopokea / Received', 'Ugunduzi / Discovered', 'Makato / Deduction', 'Cha kulipiwa / To pay', 'Imekatwa (HR) / Deducted', 'Salio / Remaining', 'HR notes', 'Maamuzi / Decision'];
const named = head.filter(h => h && h !== 'S/N');
check('5 the headers that remain are the ones the list had, in the order it had them', JSON.stringify(named) === JSON.stringify(want), JSON.stringify(named));
const iH = n => head.indexOf(n);
const row = L.rows.find(r => r.includes('STAFF WA KWANZA')) || [];
check('2 a row is whole: the team, then the customer, each under its own header', row[iH('Team')] === 'KONGOWE' && row[iH('Mteja / Customer')] === 'MTEJA MMOJA'
  && iH('Mteja / Customer') === iH('Team') + 1 && row[iH('REF NO')] === '9900000001', JSON.stringify(row));
check('2 the accused staff and the amounts sit under their own headers', row[iH('Staff mtuhumiwa / Accused staff')] === 'STAFF WA KWANZA' && row[iH('Alichokula / Taken')] === '50,000'
  && row[iH('Imekatwa (HR) / Deducted')] === '20,000' && row[iH('Salio / Remaining')] === '30,000' && row[iH('Dept')] === 'RECOVERY', JSON.stringify(row));
const lines = L.rows.filter(r => !/JUMLA/.test(r.join(' ')));
check('2 both staff lines of the case are listed, and the total row under them', lines.length === 2 && L.rows.length === 3, JSON.stringify(L.rows.map(r => r.length)));
check('2 the total row keeps its figures under their headers (60,000 taken, 20,000 deducted, 30,000 remaining)', (() => { const t = L.rows.find(r => /JUMLA/.test(r.join(' '))) || [];
  return t[iH('Alichokula / Taken')] === '60,000' && t[iH('Imekatwa (HR) / Deducted')] === '20,000' && t[iH('Salio / Remaining')] === '30,000'; })(), JSON.stringify(L.rows.find(r => /JUMLA/.test(r.join(' ')))));
check('3 the list\'s own columns (its Excel, JPG and CSV) do not hold the branch', L.keys.length === 16 && !L.keys.includes('branch') && L.keys.join().includes('team,customer,ref'), L.keys.join());
if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'deductions-list.png') });

// 4 the other two lists of the tab
for (const [show, cols] of [['prev', ['Staff', 'Salio / Remaining']], ['reporters', ['Aliyeripoti / Reporter', 'Kesi / Unique cases', 'Malipo / Earnings']]]) {
  await page.evaluate(s => { const el = document.querySelector('[data-arg="show"][data-val="' + s + '"]'); if (el) el.click(); }, show);
  await page.waitForTimeout(500);
  L = await read();
  const h = L.head.map(strip).filter(x => x && x !== 'S/N');
  check('4 the "' + show + '" list has its own columns and no Branch', JSON.stringify(h) === JSON.stringify(cols) && !L.keys.includes('branch') && !L.view.includes(BRANCH), JSON.stringify(h));
}
check('6 no page error', errs.length === 0, errs.join(' | '));

await browser.close(); srv.close(); console.warn = warn;
for (const f of fail) console.log('FAIL  ' + f);
console.log(ok.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
