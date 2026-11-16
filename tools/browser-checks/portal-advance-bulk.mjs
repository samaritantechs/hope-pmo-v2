/* Drives the REAL public/app.html in a real browser, against a stub /api/portal, to prove the
   salary-advance approval desk decides SEVERAL ticked requests in one go.

     "someone is saying ticking multiple advance requests to approve at once fails unless one
      by one" -- the owner, 16 Nov 2026

   The desk's bulk save is three things that only meet in a browser: the ticks (app.html keeps
   them as a set of row keys), the bar's buttons (the advance module's, rebuilt and re-wired on
   every paint) and the one call that carries every ticked id. Reading any one of them cannot
   show whether the three still meet.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-advance-bulk.mjs

   CHROME overrides the browser path. ROWS sets how many requests are pending (6 by default).
   Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
const N = Math.max(8, Number(process.env.ROWS || 8));

const calls = [];                 // every portal fn the page asked for, in order
const decides = [];               // every advDecide body the page sent
const decided = new Set();
let failAfter = -1;               // >= 0: the next advDecide saves this many and then the database "fails"
const row = i => ({ id: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'), submitted_at: '2026-11-1' + (i % 6) + 'T08:0' + (i % 10) + ':00Z',
  staff_name: 'STAFF ' + i, staff_id: 'S' + i, staff_role: 'FIELD OFFICER', req_role: 'FIELD OFFICER', zone: 'LAKE ZONE', amount: 50000 + i * 1000,
  app_date: '2026-11-1' + (i % 6), age: 2, approval: 'Pending', route: 'GMO of LAKE ZONE', routeTo: 'GMO', routeKind: 'role' });
const ROWS = Array.from({ length: N }, (_, i) => row(i + 1));

function queue_() {
  const pending = ROWS.filter(r => !decided.has(r.id));
  const recent = ROWS.filter(r => decided.has(r.id)).map(r => ({ ...r, approval: 'Approved', decided_by: 'GMO TEST', decided_at: '2026-11-16T09:00:00Z', comment: null }));
  return { ok: true, on: true, note: null, pending, recent, closed: [], count: pending.length, closedCount: 0, expiredCount: 0, month: '2026-11',
    monthState: { month: '2026-11', finalized: false, open: true }, amount: pending.reduce((s, r) => s + r.amount, 0), zones: ['LAKE ZONE'], noZoneTeams: [],
    approvals: ['Approved', 'Disapproved'], desk: { admin: false, roles: ['FIELD OFFICER'], supervises: [], zones: ['LAKE ZONE'] }, unrouted: [], routingOn: true, routingNote: null };
}
function answer(fn, args) {
  calls.push(fn);
  if (fn === 'advQueue') return queue_();
  if (fn === 'advDecide') {
    decides.push(args);
    const ups = (args.updates || []).filter(u => u && u.id && !decided.has(u.id));
    if (failAfter >= 0) {         // part of the batch is saved, then the save fails: the worst answer a save can give
      ups.slice(0, failAfter).forEach(u => decided.add(u.id));
      failAfter = -1;
      return { __status: 500, ok: false, error: 'boom from the database' };
    }
    ups.forEach(u => decided.add(u.id));
    return { ok: true, updated: ups.length, approved: ups.filter(u => u.approval === 'Approved').length, disapproved: ups.filter(u => u.approval === 'Disapproved').length, skipped: [] };
  }
  if (fn === 'notifications') return { ok: true, unseen: 0, seenAt: '', items: [] };
  if (fn === 'settings') return { ok: true, rows: [] };
  if (fn === 'dashboardFull') return { ok: true, kpis: {}, teams: [], weekdays: [], pipeline: {}, totals: {}, recovery: {}, legal: {} };
  if (fn === 'officerBoards') return { ok: true, boards: [] };
  return { ok: true, rows: [] };
}
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname.startsWith('/app') || u.pathname === '/dashboard') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return; }
  if (u.pathname.startsWith('/mod/')) {
    const f = path.join(ROOT, 'public', u.pathname);
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(f)); return; }
  }
  if (u.pathname === '/api/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, build: null })); return; }
  if (u.pathname === '/api/call') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return; }
  if (u.pathname === '/api/portal') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => { const { fn, args } = JSON.parse(b || '{}'); const out = answer(fn, args || {});
      // The save takes a moment, as a real one does: long enough to see that the buttons are off while it runs.
      setTimeout(() => { res.writeHead(out.__status || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out)); }, fn === 'advDecide' ? 350 : 0); });
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const ok = [], fail = [];
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (extra ? ' -- ' + extra : ''));

async function desk(viewport, label) {
  decides.length = 0; decided.clear();
  const page = await browser.newPage({ viewport });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const BENIGN = /favicon|status of 404|status of 500|ERR_FAILED|brand/;      // the 500 is this check's own (step 2)
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const toastText = () => page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
  const count = () => page.evaluate(() => (document.querySelector('[data-pickcount]') || {}).textContent);
  await page.goto(base + '/');
  await page.evaluate(() => { S.code = 'GMO1'; start({ name: 'GMO TEST', role: 'GMO', teams: ['KONGOWE'], teamCount: 1,
    tabs: ['dashboard', 'advappr'], ui: { presentSeconds: 30, refreshSeconds: 20, hintIntervalSeconds: 600, hintLifetimeSeconds: 12 } }); });
  await page.waitForTimeout(500);
  await page.evaluate(() => go('advappr'));
  await page.waitForSelector('#advApproveMany', { timeout: 8000 });
  await page.waitForTimeout(300);
  const ticks = await page.$$('input[data-pick]');
  check(label + ': the desk lists every pending request with a tick box', ticks.length === N, ticks.length + ' of ' + N);

  // --- 1. TICK THREE, ONE BY ONE, AND APPROVE THEM TOGETHER -- the action the report names
  for (const i of [0, 2, 3]) await ticks[i].check();
  await page.waitForTimeout(100);
  check(label + ': the bar counts three ticked', (await count()) === '3', String(await count()));
  await page.click('#advApproveMany');
  check(label + ': while it saves, both buttons are off and the screen says it is saving',
    await page.evaluate(() => document.getElementById('advApproveMany').disabled && document.getElementById('advRejectMany').disabled
      && /Saving 3/.test((document.getElementById('toast') || {}).textContent || '')), await toastText());
  await page.waitForFunction(() => /Saved|Imehifadhiwa/.test((document.getElementById('toast') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  check(label + ': no script error', errs.length === 0, errs.join(' | '));
  check(label + ': it asks once before saving', dialogs.length === 1, JSON.stringify(dialogs));
  check(label + ': ONE advDecide goes out', decides.length === 1, String(decides.length));
  const sent = ((decides[0] || {}).updates || []);
  check(label + ': carrying the three ticked ids, each Approved', sent.length === 3 && sent.every(u => u.approval === 'Approved')
    && [ROWS[0].id, ROWS[2].id, ROWS[3].id].every(id => sent.some(u => u.id === id)), JSON.stringify(sent));
  check(label + ': the toast says three were approved', /3 approved/.test(await toastText()), await toastText());
  await page.waitForSelector('input[data-pick]', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  check(label + ': the three are gone from Pending, the rest remain', (await page.$$('input[data-pick]')).length === N - 3, String((await page.$$('input[data-pick]')).length));
  check(label + ': and nothing is left ticked', (await count()) === '0', String(await count()));

  // --- 2. A SAVE THAT FAILS PART-WAY: four ticked, two saved, then the database refuses
  const left = await page.$$('input[data-pick]');
  for (const i of [0, 1, 2, 3]) await left[i].check();
  failAfter = 2;
  await page.click('#advApproveMany');
  await page.waitForFunction(() => /boom/.test((document.getElementById('toast') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  check(label + ': a failed save says so, in the database\'s words', /boom from the database/.test(await toastText()), await toastText());
  check(label + ': and the list is read again: the two that WERE saved are gone from Pending', (await page.$$('input[data-pick]')).length === N - 5, String((await page.$$('input[data-pick]')).length));
  check(label + ': only the two that were not saved are still ticked', (await count()) === '2', String(await count()));
  check(label + ': and the buttons work again', await page.evaluate(() => !document.getElementById('advApproveMany').disabled));
  const before = decides.length;

  // --- 3. THE MASTER TICK, THEN APPROVE: everything still on screen, in one call
  const all = await page.$('input[data-pickall]');
  check(label + ': there is a tick-all box', !!all);
  if (all) {
    await page.click('input[data-pickall]');         // a click, not check(): the tick repaints the table and the box it clicked is replaced
    await page.waitForTimeout(200);
    check(label + ': tick-all ticks every row on screen', (await count()) === String(N - 5), String(await count()));
    await page.click('#advApproveMany');
    await page.waitForFunction(() => /Saved|Imehifadhiwa/.test((document.getElementById('toast') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const sent2 = ((decides[before] || {}).updates || []);
    check(label + ': tick-all then Approve sends every remaining id once', decides.length === before + 1 && sent2.length === N - 5 && new Set(sent2.map(u => u.id)).size === N - 5
      && sent2.every(u => /^[0-9a-f-]{36}$/.test(u.id)), JSON.stringify(sent2).slice(0, 300));
    check(label + ': no script error after tick-all', errs.length === 0, errs.join(' | '));
  }
  await page.close();
}
await desk({ width: 1366, height: 800 }, 'desktop');
await desk({ width: 390, height: 800 }, 'phone');

await browser.close(); srv.close();
for (const s of ok) console.log('ok   ' + s);
for (const s of fail) console.log('FAIL ' + s);
console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall ' + ok.length + ' passed');
process.exit(fail.length ? 1 : 0);
