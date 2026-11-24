/* THE PMO DEDUCTION TAB'S EARNERS' TABLE AND THE ADMIN'S COMMISSION SETTINGS: the REAL public/app.html and public/mod/deduct.js in a real
   browser, talking to the REAL portalApi over the repository's own fake database.

     "the bluedot at Makato ya PMO / PMO Deduction opens commisions, it just kills the meaning - remove it there but under the makato table
      add the earner's table and as admin could have copmmission settings alone, i need to set earners amount there - b/se like now its
      10,000 per case sometimes the amount changes to boost followup" -- the owner, 24 Nov 2026 (handbook Part 152)

   What it proves:

     1. the Walioripoti card that swapped the cases list for the earners' list is gone: eight cards, none of them the reporters';
     2. the EARNERS' TABLE sits under the cases list on every visit (reporter, unique cases, earnings, a total row), at the amount in
        force on the day each case was reported, with its own Excel; tapping a card narrows the cases list and leaves it where it is;
     3. for the ADMIN alone, a commission settings card under it: the amount now, the base, a form (amount, from date) and the dated
        amounts with a way to take one out; a person who is not an admin has no such card and the answer they get carries no amounts;
     4. an amount from a date changes what cases reported on and after that date earn and leaves earlier ones where they were; a PAST date
        rewrites from then (the card says so); taking an entry out puts the cases back; with none, the base applies to every case;
     5. a view-only admin sees the card and is refused on Save, said as NOT saved; a hand-damaged setting never stops the tab opening;
     6. the earners' board survives a table search, and no page error in any world.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-deductions-earners.mjs

   CHROME overrides the browser path; APP_FILE and MOD_DIR run it against another copy of the page and of the modules; SHOTS=<dir>
   saves pictures. Exit code 0 = everything passed. The dates are worked out from today, so it runs on any day. */
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
const add = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TODAY = eat(Date.now()), W1 = add(TODAY, -6), D1 = add(TODAY, -5), D2 = add(TODAY, -2);

/* THE BOOK, three cases in the window (made-up people): MTOA A reported two (five and two days ago), MTOA B one (today). The base
   amount is the Settings row the system always had: 10,000 per case. */
const CASE = (id, reporter, day, ref) => ({ id: 'r' + id, case_id: 'k' + id, submitted_at: day + 'T06:00:00Z', dept: 'RECOVERY', reporter, team: 'KONGOWE', customer: 'MTEJA ' + id,
  ref, staff: 'STAFF ' + id, amount_taken: 10000, received_date: day, discovery_date: day, decision: 'Akatwe', deduction: 10000, to_pay: 10000, hr_notes: null, deducted: 0, remaining: 0 });
const tables = (extraSettings = []) => ({
  teams: [{ team: 'KONGOWE', team_code: 'C-K', branch: null, zone: 'DAR', opm: null, recovery: null, gmo: null, manager: null, credit: null, expected: null, bike: null }],
  access_codes: [{ code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['deduct', 'settings'] }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }, { key: 'DEDUCTION_REPORTER_TZS', value: '10000' }, ...extraSettings],
  roles: [], audit_log: [],
  pmo_deductions: [CASE(1, 'MTOA A', D1, '9900000001'), CASE(2, 'MTOA A', D2, '9900000002'), CASE(3, 'MTOA B', TODAY, '9900000003')],
});
const ADMIN = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['deduct', 'settings'] };
const GMO = { code: 'GMO1', name: 'JUMA G', role: 'GMO', teams: ['KONGOWE'], tabs: ['deduct'] };
const VIEWONLY = { ...ADMIN, code: 'AUD1', name: 'AN AUDITOR', role: 'AUDITOR', readOnly: true };
let db = fakeDb(tables()), USER = ADMIN;
const REAL = new Set(['deductions', 'dedRateSet', 'dedRateDelete']);
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
const BENIGN = /favicon|status of 404|ERR_FAILED|brand|status of 500|status of 403/;
const UI = { presentSeconds: 3600, refreshSeconds: 6000, hintIntervalSeconds: 3600, hintLifetimeSeconds: 5 };

async function open(world, user) {
  db = world; USER = user;
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(8000);
  await page.goto(base + '/');
  await page.evaluate(m => { S.code = 'ADM'; start(m); }, { name: user.name, role: user.role, teams: user.teams, teamCount: null, tabs: user.tabs, can: { dashboard: true, upload: false, admin: user.tabs.includes('settings') }, ui: UI });
  await page.waitForTimeout(300);
  await page.evaluate(w => go('deduct', { from: w.from, to: w.to }), { from: W1, to: TODAY });
  await page.waitForFunction(() => document.querySelectorAll('#view table tbody tr').length >= 2);
  await page.waitForTimeout(200);
  return page;
}
const txt = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
const earnOf = pg => pg.evaluate(() => { const t = e => (e.textContent || '').replace(/\s+/g, ' ').trim(), c = document.getElementById('dedEarn');
  return c ? { title: t(c.querySelector('.card-h')), rows: [...c.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(t)) } : null; });
const ratesOf = pg => pg.evaluate(() => { const t = e => (e.textContent || '').replace(/\s+/g, ' ').trim(), c = document.getElementById('dedRates');
  return c ? { text: t(c), hist: [...c.querySelectorAll('tbody tr')].map(tr => [...tr.children].slice(0, 2).map(t)), dels: [...c.querySelectorAll('[data-dedrate-del]')].map(b => b.getAttribute('data-dedrate-del')) } : null; });
const sheet = async dl => { const raw = fs.readFileSync(await dl.path()); return { name: dl.suggestedFilename(), text: raw.subarray(3).toString('utf8') }; };
const settle = ms => new Promise(r => setTimeout(r, ms));
const waitEarn = (pg, rowsJson) => pg.waitForFunction(j => { const c = document.getElementById('dedEarn'); if (!c) return false; const t = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
  return JSON.stringify([...c.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(t))) === j; }, rowsJson, { timeout: 7000 }).then(() => true, () => false);
const fmt = n => Math.round(n).toLocaleString('en-US');
const rowsOf = (a, b, atot) => [['1', 'MTOA A', '2', fmt(a)], ['2', 'MTOA B', '1', fmt(b)], ['', 'JUMLA / TOTAL', '3', fmt(atot)]];

try {
// ---- the admin
let page = await open(fakeDb(tables()), ADMIN);
const cards = await page.evaluate(() => [...document.querySelectorAll('#view .kpis .kpi.tap')].map(c => (c.querySelector('.l') || {}).textContent || ''));
check('1 eight cards, none of them the reporters\'', cards.length === 8 && !cards.some(c => /walioripoti|reporters/i.test(c)), JSON.stringify(cards));
check('1 no list of the tab is the reporters\'', !(await page.evaluate(() => typeof DED_SHOW_ === 'object' && !!DED_SHOW_.reporters)));
let E = await earnOf(page);
check('2 the earners\' table is under the cases list', await page.evaluate(() => { const m = document.getElementById('mainCard'), e = document.getElementById('dedEarn'); return !!m && !!e && m.nextElementSibling === e; }));
check('2 it names its window and the amount per case', !!E && /Wapataji wa malipo/.test(E.title) && E.title.includes(W1 + ' → ' + TODAY) && /TZS 10,000 kwa kila kesi/.test(E.title), JSON.stringify(E && E.title));
check('2 a row for each reporter with their unique cases and earnings at 10,000 a case, then the total', JSON.stringify(E && E.rows) === JSON.stringify(rowsOf(20000, 10000, 30000)), JSON.stringify(E && E.rows));
// a card narrows the cases list and leaves the earners where they are
await page.click('[data-arg="show"][data-val="taken"]'); await page.waitForTimeout(400);
check('2 tapping a card narrows the cases list and the earners\' table stays, the same', JSON.stringify((await earnOf(page) || {}).rows) === JSON.stringify(rowsOf(20000, 10000, 30000)) && (await page.evaluate(() => !!document.querySelector('#mainCard'))));
await page.click('[data-arg="show"][data-val="all"]'); await page.waitForTimeout(300);
// a table search repaints the whole screen: the board is still there
await page.fill('#tblQ', 'MTEJA 1'); await page.waitForTimeout(400);
check('6 a table search keeps the earners\' table (the buttons in it still work)', JSON.stringify((await earnOf(page) || {}).rows) === JSON.stringify(rowsOf(20000, 10000, 30000)));
const x1 = await sheet(await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#dedEarn [data-xls]')]).then(r => r[0]));
check('2 its Excel, like every board\'s: the reporters, their unique cases and what they earned', /Wapataji/.test(x1.name) && /MTOA A/.test(x1.text) && /MTOA B/.test(x1.text) && />20000</.test(x1.text) && />10000</.test(x1.text) && /<td x:num>2<\/td>/.test(x1.text), x1.name);
await page.fill('#tblQ', ''); await page.waitForTimeout(300);

// the commission settings
let R = await ratesOf(page);
check('3 the admin has a commission settings card under the earners\' table', await page.evaluate(() => { const e = document.getElementById('dedEarn'), r = document.getElementById('dedRates'); return !!r && e.nextElementSibling === r; }));
check('3 it says the amount now, the base and that no dated change exists yet', !!R && /Amount per unique case now: TZS 10,000/.test(R.text) && /base TZS 10,000/.test(R.text) && /No dated changes yet/.test(R.text) && R.hist.length === 0, R && R.text.slice(0, 200));
check('3 it says admin only, and that a past date changes earlier cases', !!R && /admin pekee \/ admin only/.test(R.text) && /A PAST date changes what cases reported since then earn/.test(R.text));
if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.setViewportSize({ width: 1700, height: 1700 }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(process.env.SHOTS, 'deductions-earners-admin.png') }); await page.setViewportSize({ width: 1700, height: 1000 }); }
// 15,000 from two days ago: case 2 (two days ago) and case 3 (today) earn it, case 1 keeps 10,000
await page.fill('#dedRateTzs', '15000'); await page.fill('#dedRateFrom', D2); await page.click('#dedRateSave');
check('4 15,000 from two days ago: the case of that day and today\'s earn it, the earlier one keeps 10,000', await waitEarn(page, JSON.stringify(rowsOf(25000, 15000, 40000))), JSON.stringify((await earnOf(page) || {}).rows));
E = await earnOf(page); R = await ratesOf(page);
check('4 the earners\' table says both amounts and the day the second began', !!E && E.title.includes('TZS 10,000 kuanzia / from ' + W1) && E.title.includes('TZS 15,000 kuanzia / from ' + D2), E && E.title);
check('4 the card shows 15,000 now and the dated amount with a way to take it out', !!R && /per unique case now: TZS 15,000/.test(R.text) && JSON.stringify(R.hist) === JSON.stringify([[D2, '15,000']]) && JSON.stringify(R.dels) === JSON.stringify([D2]), R && JSON.stringify([R.hist, R.dels]));
// a PAST date rewrites from then: 20,000 from the window's first day
await page.fill('#dedRateTzs', '20000'); await page.fill('#dedRateFrom', W1); await page.click('#dedRateSave');
check('4 a past date rewrites what cases since then earn: 20,000 from the window\'s first day, 15,000 from two days ago', await waitEarn(page, JSON.stringify(rowsOf(35000, 15000, 50000))), JSON.stringify((await earnOf(page) || {}).rows));
// the same date again REPLACES that entry
await page.fill('#dedRateTzs', '18000'); await page.fill('#dedRateFrom', D2); await page.click('#dedRateSave');
check('4 an amount for a date that has one replaces it, it does not add a second', await waitEarn(page, JSON.stringify(rowsOf(38000, 18000, 56000))) && JSON.stringify((await ratesOf(page)).hist) === JSON.stringify([[W1, '20,000'], [D2, '18,000']]), JSON.stringify((await ratesOf(page) || {}).hist));
if (process.env.SHOTS) { await page.setViewportSize({ width: 1700, height: 1700 }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(process.env.SHOTS, 'deductions-earners-dated.png') }); await page.setViewportSize({ width: 1700, height: 1000 }); }
// taking entries out puts the cases back
await page.click('#dedRates [data-dedrate-del="' + D2 + '"]');
check('4 taking the later entry out: every case earns 20,000 again', await waitEarn(page, JSON.stringify(rowsOf(40000, 20000, 60000))));
await page.click('#dedRates [data-dedrate-del="' + W1 + '"]');
check('4 taking the last one out: the base applies to every case again', await waitEarn(page, JSON.stringify(rowsOf(20000, 10000, 30000))) && /No dated changes yet/.test((await ratesOf(page)).text));
// refusals said, and nothing stored
await page.fill('#dedRateTzs', ''); await page.click('#dedRateSave'); await page.waitForTimeout(300);
check('4 an empty amount is refused on the page and nothing is stored', (await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '')).includes('Enter the amount per case') && !db._dump('settings').some(r => r.key === 'DEDUCTION_REPORTER_RATES' && r.value !== '[]'));
check('4 the base setting itself was never touched by any of it', db._dump('settings').find(r => r.key === 'DEDUCTION_REPORTER_TZS').value === '10000');
await page.close();

// ---- not an admin
page = await open(fakeDb(tables()), GMO);
check('3 a person who is not an admin has the earners\' table and NO commission settings card', !!(await earnOf(page)) && !(await ratesOf(page)));
const gm = await portalApi(db, GMO, 'deductions', { from: W1, to: TODAY });
check('3 and the answer they get carries no dated amounts and no base', gm.canRates === false && gm.rates === undefined && gm.rateBase === undefined && gm.rate === 10000 && Array.isArray(gm.rateSteps), JSON.stringify([gm.canRates, gm.rates, gm.rateBase, gm.rate]));
await portalApi(db, GMO, 'dedRateSet', { tzs: 99999 }).then(() => check('3 the server refuses them the write', false), e => check('3 the server refuses them the write', e.status === 403, String(e.message)));
await page.close();

// ---- a view-only admin: seen, not saved
page = await open(fakeDb(tables()), VIEWONLY);
check('5 a view-only admin sees the card', !!(await ratesOf(page)));
await page.fill('#dedRateTzs', '12345'); await page.click('#dedRateSave'); await page.waitForTimeout(600);
const toast = await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
check('5 and Save is refused, said as NOT saved, with nothing stored', /NOT saved/.test(toast) && !db._dump('settings').some(r => r.key === 'DEDUCTION_REPORTER_RATES'), toast);
await page.close();

// ---- a hand-damaged setting never stops the tab
for (const bad of ['{oops', '[{"from":"nope","tzs":5},{"from":"2026-01-01","tzs":-3},{"tzs":7},null,"x"]', '{"from":"2026-01-01","tzs":5}']) {
  page = await open(fakeDb(tables([{ key: 'DEDUCTION_REPORTER_RATES', value: bad }])), ADMIN);
  check('5 a damaged amounts row (' + bad.slice(0, 16) + ') leaves the tab open at the base amount', JSON.stringify((await earnOf(page) || {}).rows) === JSON.stringify(rowsOf(20000, 10000, 30000)) && !!(await ratesOf(page)));
  await page.close();
}
} catch (e) { fail.push('the check stopped: ' + String((e && e.message) || e).split('\n')[0].slice(0, 240)); }

check('6 no page error in any world', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close(); srv.close(); console.warn = warn;
for (const f of fail) console.log('FAIL  ' + f);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
