/* The Legal tab's weekly recovery card and its week arrows, the REAL public/app.html and public/mod/legal.js in a real
   browser, talking to the REAL portalApi over the repository's own fake database (not a stub that answers what the page
   hopes to hear).

     "Legal recovery weekly report at the top right card should have foward and backward arrows so that we get last
      week(s) reports" -- the owner, 23 Nov 2026

   What it proves (handbook Part 128):

     1. the card opens on THIS week, with the figures the server's own list gives, the forward arrow off and the
        backward one on; tapping the card opens the list for the week it shows;
     2. an arrow press asks the server for that week, repaints the card (figures, name, range, a way home, lit),
        and does NOT open the list;
     3. the week the reader chose survives a table search (the whole screen is repainted from HEAD) and the arrows
        still work afterwards;
     4. the backward arrow stops at the week of the first notice, the forward one at this week;
     5. the list behind the card carries the same arrows and a way home, takes the week into the title of its Excel,
        and keeps the card behind it on the same week; a customer name that is markup is drawn as text;
     6. a key on an arrow steps and never opens the list; two quick presses are two weeks; an answer that comes
        back after the reader moved on never paints over their choice;
     7. a read that FAILS is said, as text, and leaves the card where it was, not dimmed;
     8. a book without the ledger (RUN-ME-041a) says so on the card and switches both arrows off;
     9. leaving the tab and coming back shows this week again.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-legal-week.mjs

   CHROME overrides the browser path. Exit code 0 = everything passed. The dates are worked out from today, so it
   runs on any day. */
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
const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');

// ---- the calendar, on the Dar es Salaam clock the server counts by
const eat = ms => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
const add = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = k => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TODAY = eat(Date.now()), THIS = mondayOf(TODAY), LAST = add(THIS, -7), BEFORE = add(THIS, -14);

const HOSTILE = '<img src=x onerror="window.__pwned=1">';
const NOTICES = [
  { id: 'n1', ref: '555', team: 'KONGOWE', full_name: 'ASHA ONE', contact: '0714000555', notice_id: 'HMCL/A/01', notice_date: add(BEFORE, 1), arrears_at_notice: 1000, created_at: add(BEFORE, 1) + 'T05:00:00Z' },
  { id: 'n2', ref: '555', team: 'KONGOWE', full_name: 'ASHA ONE', contact: '0714000555', notice_id: 'HMCL/A/02', notice_date: LAST, arrears_at_notice: 800, created_at: LAST + 'T05:00:00Z' },
  { id: 'n3', ref: '777', team: 'MBAGALA', full_name: HOSTILE, contact: '0714000777', notice_id: 'HMCL/B/01', notice_date: THIS, arrears_at_notice: 500, created_at: THIS + 'T05:00:00Z' },
];
const LEDGER = [
  { ref: '555', since: add(BEFORE, 1), payment_id: 'p1', paid_at: add(BEFORE, 2), amount: 70 },     // the week before last, under the FIRST notice
  { ref: '555', since: LAST, payment_id: 'p2', paid_at: add(LAST, 1), amount: 500 },                 // last week
  { ref: '555', since: LAST, payment_id: 'p3', paid_at: add(LAST, 4), amount: 250 },                 // last week
  { ref: '555', since: LAST, payment_id: 'p4', paid_at: THIS, amount: 100 },                         // this week
  { ref: '777', since: THIS, payment_id: 'p5', paid_at: THIS, amount: 50 },                          // this week
];
const rpc = {
  notice_payments: (store, args) => args.p_refs.map((ref, i) => ({ ref, since: args.p_dates[i], paid: 0, n: 0, last_paid: null, n_phone: 0 })),
  fold_notice_payments: () => 0,
};
const makeBook = ({ noLedger = false, big = 0 } = {}) => {
  const more = [];
  for (let i = 0; i < big; i++) more.push({ id: 'b' + i, ref: String(100000 + i), team: i % 2 ? 'KONGOWE' : 'MBAGALA', full_name: 'CUSTOMER ' + i, contact: '07' + String(10000000 + i),
    notice_id: 'HMCL/B/' + i, notice_date: add(THIS, -((i % 60) + 7)), arrears_at_notice: 1000 + i, created_at: add(THIS, -((i % 60) + 7)) + 'T05:00:00Z' });
  const db = fakeDb({ demand_notices: NOTICES.map(n => ({ ...n })).concat(more), notice_payment_ledger: LEDGER.map(l => ({ ...l })),
    teams: [{ team: 'KONGOWE', team_code: 'C-K', zone: null }, { team: 'MBAGALA', team_code: 'C-M', zone: null }],
    access_codes: [{ code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['legal'] },
      // The lawyer whose code holds KONGOWE: the list names them on ASHA ONE's row; MBAGALA has no legal code.
      { code: 'LG1', name: 'LAWYER ONE', role: 'LEGAL', teams: ['KONGOWE'], tabs: ['legal'] },
      // A recovery code holding KONGOWE with the Legal tab is NOT a lawyer (Part 26's rule): never named on a row.
      { code: 'R1', name: 'NOT A LAWYER', role: 'PMO RECOVERY', teams: ['KONGOWE'], tabs: ['legal'] }],
    settings: [], call_users: [], roles: [], audit_log: [], defaulter_snapshots: [] }, { rpc });
  if (noLedger) {
    const from = db.from.bind(db);
    db.from = n => { if (n === 'notice_payment_ledger') throw new Error('relation "notice_payment_ledger" does not exist'); return from(n); };
  }
  return db;
};
let db = makeBook();
const USER = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['legal', 'dashboard'] };
const REAL = new Set(['demandNotices', 'legalRecoveries']);
const calls = [];                       // [fn, args] for everything the page asked, in order
let failFn = null;                      // a portal function the server answers with a 500
const delayWeek = {};                   // weekOf -> ms the server holds a legalRecoveries answer for that week

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
    req.on('end', async () => {
      const { fn, args } = JSON.parse(b || '{}');
      calls.push([fn, args || {}]);
      if (fn === failFn) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'canceling statement due to statement timeout' })); return; }
      let out;
      try { out = REAL.has(fn) ? await portalApi(db, USER, fn, args || {}) : { rows: [] }; }
      catch (e) { res.writeHead(e.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) })); return; }
      const hold = fn === 'legalRecoveries' ? (delayWeek[(args || {}).weekOf || ''] || 0) : 0;
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, ...out, workspace: 'hopepmo' })); }, hold);
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
const UI = { presentSeconds: 30, refreshSeconds: 600, hintIntervalSeconds: 3600, hintLifetimeSeconds: 5 };
const ME = { name: 'THE ADMIN', role: 'ADMIN', teams: null, teamCount: null, tabs: ['dashboard', 'legal'], can: { dashboard: true, upload: false, admin: true }, ui: UI };
const ask = (fn, args) => portalApi(db, USER, fn, args);

async function open() {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(6000);
  await page.goto(base + '/');
  await page.evaluate(m => { S.code = 'ADM'; start(m); }, ME);
  await page.waitForTimeout(400);
  calls.length = 0;
  await page.evaluate(() => go('legal'));
  await page.waitForSelector('#lgWkCard', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  return page;
}
const text = (page, sel) => page.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
const has = (page, sel) => page.evaluate(s => !!document.querySelector(s), sel);
const attr = (page, sel, a) => page.evaluate(([s, k]) => { const e = document.querySelector(s); return e ? e.getAttribute(k) : null; }, [sel, a]);
const off = (page, n) => page.evaluate(n => { const b = document.querySelector('#lgWkCard [data-lgwk="' + n + '"]'); return b ? b.disabled : null; }, n);
const drawerOpen = page => page.evaluate(() => getComputedStyle(document.getElementById('drawerBg')).display !== 'none');
const lastCall = (fn) => { const c = calls.filter(x => x[0] === fn); return c.length ? c[c.length - 1][1] : null; };
// what the card's figure SHOULD read for a week, worked out by the server's own list and formatted by the page's own helpers
const figure = async (page, weekOf) => {
  const lg = (await ask('legalRecoveries', { period: 'week', weekOf })).legal;
  return page.evaluate(l => (l.pct != null ? pct(l.pct) + ' · ' : '') + money(l.recovered || 0), lg);
};
const waitFor = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 6000 }).then(() => true, () => false);
const cardWeek = page => attr(page, '#lgWkCard', 'data-mon');

// A press or a wait that cannot find its element (the page is not the one this check is for) ends the run as a failure, said.
let page;
try {
// --- 1. the card opens on this week
page = await open();
const first = await text(page, '#lgRecW');
check('the card is there, on THIS week', (await cardWeek(page)) === THIS && /Recovered this week/.test(await text(page, '#lgWkCard .l')));
check('its figure is the server\'s own reading of this week', first === await figure(page, ''), JSON.stringify(first) + ' vs ' + JSON.stringify(await figure(page, '')));
check('it is not lit', !(await page.evaluate(() => document.getElementById('lgWkCard').classList.contains('on'))));
check('forward is off, backward is on', (await off(page, 1)) === true && (await off(page, -1)) === false);
check('the range is in its sub', new RegExp(THIS + ' → ' + add(THIS, 6)).test(await text(page, '#lgRecWS')));
check('the floor is the week of the first notice', (await attr(page, '#lgWkCard', 'data-since')) === BEFORE, String(await attr(page, '#lgWkCard', 'data-since')));
// today's card still opens its own list
await page.click('#lgRecT');
await page.waitForTimeout(700);
check('today\'s card still opens today\'s list', await drawerOpen(page) && /Recovered today/.test(await text(page, '#drawer')));
await page.evaluate(() => closeDrawer());
// tapping the week card opens the list for the week it shows
calls.length = 0;
await page.click('#lgRecW');
await page.waitForTimeout(800);
check('tapping the week card opens the list of this week', await drawerOpen(page) && new RegExp(THIS + ' → ' + add(THIS, 6)).test(await text(page, '#drawer h3')), (await text(page, '#drawer h3')).slice(0, 120));
check('and asks the server for this week once', calls.filter(c => c[0] === 'legalRecoveries').length === 1 && lastCall('legalRecoveries').period === 'week', JSON.stringify(calls));
await page.evaluate(() => closeDrawer());

// --- 2. an arrow press: asks for the week, repaints the card, opens nothing
calls.length = 0;
await page.click('#lgWkCard [data-lgwk="-1"]');
const arrived = await waitFor(page, w => document.getElementById('lgWkCard').getAttribute('data-mon') === w, LAST);
check('backward asks the server for LAST week', arrived && lastCall('legalRecoveries') && lastCall('legalRecoveries').weekOf === LAST && lastCall('legalRecoveries').period === 'week', JSON.stringify(calls));
check('and does not open the list', !(await drawerOpen(page)));
check('the card is on last week: its name, figure and range', /past week/.test(await text(page, '#lgWkCard .l')) && !/this week/.test(await text(page, '#lgWkCard .l'))
  && (await text(page, '#lgRecW')) === await figure(page, LAST) && new RegExp(LAST + ' → ' + add(LAST, 6)).test(await text(page, '#lgRecWS')), await text(page, '#lgWkCard'));
check('lit, with a way home', await page.evaluate(() => document.getElementById('lgWkCard').classList.contains('on')) && /Back to this week/.test(await text(page, '#lgRecWS')));
check('both arrows are on', (await off(page, 1)) === false && (await off(page, -1)) === false);
check('last week\'s figure is not this week\'s', (await text(page, '#lgRecW')) !== first, await text(page, '#lgRecW'));

// --- 3. the week survives a table search (the screen is repainted whole, from HEAD)
const q = await has(page, '#tblQ');
if (q) { await page.fill('#tblQ', 'ASHA'); await page.waitForTimeout(500); }
check('a table search keeps the card on last week', q && (await cardWeek(page)) === LAST && (await text(page, '#lgRecW')) === await figure(page, LAST), 'search box: ' + q);
// "fix the handlers lost after table search" (the owner, 23 Nov): what wireForms() wired must still answer after the
// repaint, not only the weekly card with its inline handlers. Today's card and + New demand notice are the two the
// owner would meet first on this tab.
await page.click('#lgRecT'); await page.waitForTimeout(600);
check('after a table search, today\'s card still opens its list', await drawerOpen(page) && /Recovered today/.test(await text(page, '#drawer')));
await page.evaluate(() => closeDrawer());
await page.click('#newNotice'); await page.waitForTimeout(600);
check('after a table search, + New demand notice still opens the form', await drawerOpen(page) && /Notisi mpya|New demand notice|REF/.test(await text(page, '#drawer')));
await page.evaluate(() => closeDrawer());
// A sort repaints too.
await page.click('#view table thead th:nth-child(2)').catch(() => {}); await page.waitForTimeout(400);
await page.click('#lgRecT'); await page.waitForTimeout(600);
check('after a sort, today\'s card still opens its list', await drawerOpen(page));
await page.evaluate(() => closeDrawer());
calls.length = 0;
await page.click('#lgWkCard [data-lgwk="1"]');
check('and the arrows still work after the repaint (forward lands on this week)', await waitFor(page, w => document.getElementById('lgWkCard').getAttribute('data-mon') === w, THIS) && (await off(page, 1)) === true);
check('forward onto this week asks for this week', lastCall('legalRecoveries') && (lastCall('legalRecoveries').weekOf === '' || lastCall('legalRecoveries').weekOf === THIS), JSON.stringify(lastCall('legalRecoveries')));

// --- 4. the floor: the week of the first notice is the last week back
await page.click('#lgWkCard [data-lgwk="-1"]'); await waitFor(page, w => document.getElementById('lgWkCard').getAttribute('data-mon') === w, LAST);
await page.click('#lgWkCard [data-lgwk="-1"]'); const atFloor = await waitFor(page, w => document.getElementById('lgWkCard').getAttribute('data-mon') === w, BEFORE);
check('backward reaches the week of the first notice', atFloor && (await text(page, '#lgRecW')) === await figure(page, BEFORE), await text(page, '#lgRecW'));
check('where backward is OFF', (await off(page, -1)) === true && (await off(page, 1)) === false);
const before = calls.length;
await page.click('#lgWkCard [data-lgwk="-1"]', { force: true }).catch(() => {});
await page.waitForTimeout(300);
check('a press on the disabled arrow asks nothing', calls.length === before);

// --- 5. the list behind the card carries the arrows, a way home, the week in its title, and keeps the card in step
await page.click('#lgRecW');
await page.waitForTimeout(800);
const dr = () => text(page, '#drawer');
check('the list opens on the week the card shows (the first week)', await drawerOpen(page) && new RegExp(BEFORE + ' → ' + add(BEFORE, 6)).test(await text(page, '#drawer h3')) && /past week/.test(await dr()), (await text(page, '#drawer h3')).slice(0, 140));
const payers = () => page.evaluate(() => (BOARDS.lgRec ? BOARDS.lgRec.rows : []).map(r => [r.full_name, r.paid]));
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
check('its rows are that week\'s payers (one: ASHA ONE, 70)', same(await payers(), [['ASHA ONE', 70]]), JSON.stringify(await payers()));
// "add 'Legal Officer' name between s/n and customer name" (23 Nov): the first columns of the list on screen.
const heads = await page.evaluate(() => [...document.querySelectorAll('#drawer #lgRec thead th')].slice(0, 3).map(th => th.textContent.trim().replace(/\s*[▲▼↑↓]+$/, '')));
check('the list reads S/N, Legal officer, Customer', same(heads, ['S/N', 'Afisa wa sheria / Legal officer', 'Mteja / Customer']), JSON.stringify(heads));
const lawyers = () => page.evaluate(() => (BOARDS.lgRec ? BOARDS.lgRec.rows : []).map(r => [r.full_name, r.officer]));
check('ASHA ONE stands under LAWYER ONE, whose code holds KONGOWE; the recovery code with the tab is not named', same(await lawyers(), [['ASHA ONE', 'LAWYER ONE']]), JSON.stringify(await lawyers()));
check('the lawyer is in the Excel too (the board\'s own columns)', await page.evaluate(() => (BOARDS.lgRec.cols[0] || {}).key === 'officer' && (BOARDS.lgRec.cols[1] || {}).key === 'full_name'));
check('the list has both arrows and its own way home; backward is off here', await has(page, '#drawer [data-lgwd="-1"]') && await has(page, '#drawer [data-lgwd="1"]') && await has(page, '#drawer [data-lgwd="0"]')
  && await page.evaluate(() => document.querySelector('#drawer [data-lgwd="-1"]').disabled) === true);
check('the Excel of the list carries the week in its title', await page.evaluate(w => /→/.test((BOARDS.lgRec || {}).title || '') && (BOARDS.lgRec.title || '').indexOf(w) >= 0, BEFORE), await page.evaluate(() => (BOARDS.lgRec || {}).title));
await page.click('#drawer [data-lgwd="1"]');
const dFwd = await waitFor(page, w => /past week/.test(document.getElementById('drawer').textContent) && document.getElementById('drawer').textContent.indexOf(w) >= 0, LAST + ' → ' + add(LAST, 6));
check('forward in the list is last week: its payer, ASHA ONE, 750', dFwd && same(await payers(), [['ASHA ONE', 750]]), JSON.stringify(await payers()));
check('and the card behind the list moved with it', (await cardWeek(page)) === LAST && (await text(page, '#lgRecW')) === await figure(page, LAST));
await page.click('#drawer [data-lgwd="0"]');
const dHome = await waitFor(page, w => /Recovered this week/.test(document.getElementById('drawer').textContent) && document.getElementById('drawer').textContent.indexOf(w) >= 0, THIS + ' → ' + add(THIS, 6));
check('the way home is this week, in the list and on the card', dHome && (await cardWeek(page)) === THIS && !(await page.evaluate(() => document.getElementById('lgWkCard').classList.contains('on'))));
check('this week\'s list has both payers, biggest first', same(await payers(), [['ASHA ONE', 100], [HOSTILE, 50]]), JSON.stringify(await payers()));
check('a customer on a team no legal code holds is listed under "(unassigned)", as the boards count them', same(await lawyers(), [['ASHA ONE', 'LAWYER ONE'], [HOSTILE, '(unassigned)']]), JSON.stringify(await lawyers()));
// The search box finds a lawyer's name.
await page.fill('#lgRecQ', 'LAWYER'); await page.waitForTimeout(300);
check('typing a lawyer\'s name in the list\'s search keeps their customers only', same(await lawyers(), [['ASHA ONE', 'LAWYER ONE']]), JSON.stringify(await lawyers()));
await page.fill('#lgRecQ', ''); await page.waitForTimeout(300);
check('and the customer whose name is markup is drawn as text, never run', (await dr()).indexOf('<img src=x') >= 0 && !(await page.evaluate(() => window.__pwned)) && !(await has(page, '#drawer img[src="x"]')));
await page.evaluate(() => closeDrawer());

// --- 6. keys, quick presses, a late answer
calls.length = 0;
await page.focus('#lgWkCard [data-lgwk="-1"]');
await page.keyboard.press('Enter');
const viaKey = await waitFor(page, w => document.getElementById('lgWkCard').getAttribute('data-mon') === w, LAST);
check('Enter on an arrow steps, and does not open the list', viaKey && !(await drawerOpen(page)));
check('and keeps the focus on the arrow it was on', await page.evaluate(() => (document.activeElement || {}).getAttribute && document.activeElement.getAttribute('data-lgwk')) === '-1');
await page.click('#lgWkCard [data-lgwk="1"]'); await waitFor(page, w => document.getElementById('lgWkCard').getAttribute('data-mon') === w, THIS);
// two quick presses, with the first week's answer held back: the reader ends two weeks back, and LAST never paints after
delayWeek[LAST] = 700;
calls.length = 0;
await page.click('#lgWkCard [data-lgwk="-1"]');
await page.click('#lgWkCard [data-lgwk="-1"]', { force: true });
const two = await waitFor(page, w => document.getElementById('lgWkCard').getAttribute('data-mon') === w, BEFORE);
await page.waitForTimeout(1100);                                 // the held answer for LAST has long since come back
check('two quick presses are two weeks', two && (await cardWeek(page)) === BEFORE, 'now on ' + await cardWeek(page));
check('and the late answer for last week did not paint over the choice', (await text(page, '#lgRecW')) === await figure(page, BEFORE) && /past week/.test(await text(page, '#lgWkCard .l')));
delete delayWeek[LAST];

// --- 7. a read that fails is said and leaves the card alone
await page.click('#lgWkCard [data-lgwk="1"]'); await waitFor(page, w => document.getElementById('lgWkCard').getAttribute('data-mon') === w, LAST);
const stood = await text(page, '#lgRecW');
failFn = 'legalRecoveries';
await page.evaluate(() => { LGW_.c = {}; });                    // a fresh ask, not a remembered answer
await page.click('#lgWkCard [data-lgwk="1"]');
await page.waitForTimeout(900);
const tst = await text(page, '#toast');
failFn = null;
check('a failed read is said, as an error', /Could not load/.test(tst), tst.slice(0, 160));
check('and the card stays on the week it was on, figure and all, and is not left dimmed', (await cardWeek(page)) === LAST && (await text(page, '#lgRecW')) === stood
  && (await page.evaluate(() => document.getElementById('lgWkCard').style.opacity)) === '');
check('after which the arrow works again', await (async () => { await page.click('#lgWkCard [data-lgwk="1"]'); return waitFor(page, w => document.getElementById('lgWkCard').getAttribute('data-mon') === w, THIS); })());

// --- 9. leaving the tab and coming back shows this week again
await page.click('#lgWkCard [data-lgwk="-1"]'); await waitFor(page, w => document.getElementById('lgWkCard').getAttribute('data-mon') === w, LAST);
await page.evaluate(() => go('legal'));
await page.waitForTimeout(900);
check('opening the tab again shows this week', (await cardWeek(page)) === THIS && /Recovered this week/.test(await text(page, '#lgWkCard .l')));
await page.close();

// --- 8. a book without the ledger: the card says so and both arrows are off
db = makeBook({ noLedger: true });
page = await open();
check('without the ledger the card says so', /RUN-ME-041a/.test(await text(page, '#lgRecWS')), (await text(page, '#lgRecWS')).slice(0, 160));
check('and both arrows are off', (await off(page, -1)) === true && (await off(page, 1)) === true);
await page.close();

// --- 10. THE COST OF WIRING ON EVERY REPAINT, measured: a register of 5,000 notices, the whole repaint a search
// keystroke makes (paint(true)) against wireForms() alone, medians of 15 runs each. Said in the handbook; the
// check only holds that wiring is a small share of the repaint it rides on.
db = makeBook({ big: 5000 });
page = await open();
const rowsOnScreen = await page.evaluate(() => document.querySelectorAll('#view table tbody tr').length);
const cost = await page.evaluate(() => {
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const tp = [], tw = [];
  for (let i = 0; i < 15; i++) { const t = performance.now(); paint(true); tp.push(performance.now() - t); }
  for (let i = 0; i < 15; i++) { const t = performance.now(); wireForms(); tw.push(performance.now() - t); }
  return { paint: med(tp), wire: med(tw) };
});
check('the big register is on the screen (5,000 rows and the fixture\'s own)', rowsOnScreen >= 5000, String(rowsOnScreen));
check('wireForms() is a small share of the repaint it rides on: ' + cost.wire.toFixed(1) + ' ms of ' + cost.paint.toFixed(0) + ' ms', cost.wire < cost.paint * 0.2 && cost.wire < 25, JSON.stringify(cost));
await page.close();
} catch (e) { fail.push('the run stopped: ' + String((e && e.message) || e).split('\n')[0].slice(0, 200)); }

check('no script error anywhere', errs.length === 0, errs.join(' | ').slice(0, 400));
await browser.close(); srv.close();
for (const f of fail) console.log('FAIL', f);
for (const o of ok) console.log('PASS', o);
console.log('\n' + ok.length + ' points pass' + (fail.length ? ', ' + fail.length + ' FAIL' : ''));
process.exit(fail.length ? 1 : 0);
