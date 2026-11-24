/* LEGAL RECOVERY BY PHONE, on the screens: the REAL public/app.html, public/mod/legal.js and public/mod/present.js in a real
   browser, talking to the REAL portalApi over the repository's own fake database (the database function is stood in for by
   the tests' own stand-in, which answers what db/RUN-ME-089's read answers).

     "Legal officers should be added another card of legal recovery by phone" ... "that card will be able to go forward and
      backward as usual, so that we always get legal recovery of both demand notices and call recovery -- and find a way to
      include recovery by phone of legal recovery in the sdame legal recovery slide at presentation" -- the owner, 23 Nov 2026

   What it proves (handbook Part 139):

     1. the Legal tab shows a SECOND card beside the weekly notices card, on this week, with the figure the server's own list
        gives; one of each card, never two; the backward arrow reaches the first week the phone table holds;
     2. a tap on it opens ITS list (day, lawyer, customer, number, talk time, owed, recovered), which adds up to the card;
        a customer name that is markup is drawn as text; its search box filters;
     3. its arrows move BOTH cards a week, open nothing, and give the focus back to the arrow that was pressed; a key on an
        arrow steps and never opens the list;
     4. the pair survives a table search (the whole screen is repainted from HEAD): still one of each, on the chosen week,
        the arrows still alive;
     5. the list carries the same week bar; its arrows step the PHONE list and both cards; the notices card still opens the
        notices list, and the phone card the phone list;
     6. a database where db/RUN-ME-089 has not been run: the card shows a dash and names the file, its arrows are off, the
        notices card works as before, and the list says the same instead of a table;
     7. a read that FAILS is said on the card, and nothing else on the tab is touched;
     8. the dashboard keeps ONE Legal card, and its two lawyers' boards carry "By phone" beside each lawyer with a line that
        says the week and the lawyers who have no row;
     9. the Presentation's Legal slide carries the two phone columns and the same line.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-legal-phone.mjs

   CHROME overrides the browser path. Exit code 0 = everything passed. The dates are worked out from today, so it runs on
   any day. */
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
const { LEGAL_PHONE_RPC } = await import(path.join(ROOT, 'test/snapshot-totals-rpc.mjs'));
const { portalApi } = await import(path.join(ROOT, 'api/_lib/portal-core.js'));
const APP = fs.readFileSync(process.env.APP_FILE || path.join(ROOT, 'public/app.html'), 'utf8');

// ---- the calendar, on the Dar es Salaam clock the server counts by
const eat = ms => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
const add = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = k => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TODAY = eat(Date.now()), THIS = mondayOf(TODAY), LAST = add(THIS, -7), BEFORE = add(THIS, -14);

const HOSTILE = '<img src=x onerror="window.__pwned=1">';
/* What a stamp would have written. THIS week (all on today, so the check runs on a Monday too): customer 100 spoken to by two
   lawyers (the second longer, on the guarantor's number), 200 who paid nothing, 300 at DC 1 and 400 from a paralegal's phone
   (neither counts), 500 by the lawyer who holds every team, 600 whose later file is not in, 777 whose name is markup.
   LAST week and the week before: one or two lines each, so there is somewhere to step to and a floor to stop at. */
const R = (day, ref, team, dc, uid, officer, role, phone, secs, calls, ini, cur, rec, extra = {}) => ({ day, ref, team, full_name: 'CUSTOMER ' + ref,
  contact: '0712000' + ref, guarantor_contact: '0755000' + ref, dc, ds: (12 - dc - 1) + '-12', user_id: uid, officer, role, phone, match_type: 'CUSTOMER',
  calls, secs, initial_arrears: ini, current_arrears: cur, recovered: rec, paired: true, stamped_at: day + 'T12:00:00Z', ...extra });
const STAMPED = [
  R(TODAY, '100', 'KONGOWE', 3, 'u1', 'LAWYER ONE', 'LEGAL', '0712000100', 130, 2, 100000, 60000, 40000),
  R(TODAY, '100', 'KONGOWE', 3, 'u2', 'LAWYER TWO', 'Legal Officer', '0755000100', 300, 1, 100000, 60000, 40000, { match_type: 'GUARANTOR' }),
  R(TODAY, '200', 'MBAGALA', 2, 'u2', 'LAWYER TWO', 'Legal Officer', '0712000200', 20, 1, 50000, 50000, 0),
  R(TODAY, '300', 'KONGOWE', 1, 'u1', 'LAWYER ONE', 'LEGAL', '0712000300', 60, 1, 30000, 21000, 9000),
  R(TODAY, '400', 'KONGOWE', 4, 'u8', 'PARA ONE', 'PARALEGAL', '0712000400', 500, 3, 40000, 32000, 8000),
  R(TODAY, '500', 'TANDIKA', 2, 'u3', 'LAWYER ALL', 'LEGAL', '0712000500', 33, 1, 20000, 15000, 5000),
  R(TODAY, '600', 'MBAGALA', 5, 'u2', 'LAWYER TWO', 'Legal Officer', '0712000600', 80, 2, 70000, null, 0, { paired: false }),
  R(TODAY, '777', 'MBAGALA', 2, 'u2', 'LAWYER TWO', 'Legal Officer', '0712000777', 25, 1, 9000, 8000, 1000, { full_name: HOSTILE }),
  R(add(LAST, 1), '100', 'KONGOWE', 3, 'u1', 'LAWYER ONE', 'LEGAL', '0712000100', 70, 1, 120000, 113000, 7000),
  R(add(LAST, 3), '200', 'MBAGALA', 2, 'u2', 'LAWYER TWO', 'Legal Officer', '0712000200', 40, 1, 52500, 50000, 2500),
  R(add(BEFORE, 2), '100', 'KONGOWE', 3, 'u1', 'LAWYER ONE', 'LEGAL', '0712000100', 55, 1, 125000, 120000, 5000),
];
const NP = { notice_payments: (store, args) => args.p_refs.map((ref, i) => ({ ref, since: args.p_dates[i], paid: 0, n: 0, last_paid: null, n_phone: 0 })), fold_notice_payments: () => 0 };
const book = rpc => fakeDb({
  // The only notice is THIS week's: the notices' own floor is this week, so a backward arrow that works is the phone table's doing.
  demand_notices: [{ id: 'n1', ref: '100', team: 'KONGOWE', full_name: 'CUSTOMER 100', contact: '0712000100', notice_id: 'HMCL/A/01', notice_date: THIS, arrears_at_notice: 100000, created_at: THIS + 'T05:00:00Z' }],
  notice_payment_ledger: [{ ref: '100', since: THIS, payment_id: 'p1', paid_at: TODAY, amount: 300 }],
  teams: [{ team: 'KONGOWE', team_code: 'C-K', zone: null }, { team: 'MBAGALA', team_code: 'C-M', zone: null }, { team: 'TANDIKA', team_code: 'C-T', zone: null }],
  access_codes: [{ code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['legal'] },
    { code: 'LG1', name: 'LAWYER ONE', role: 'LEGAL', teams: ['KONGOWE'], tabs: ['legal'] },
    { code: 'LG2', name: 'LAWYER TWO', role: 'Legal Officer', teams: ['MBAGALA'], tabs: ['legal'] },
    { code: 'LG3', name: 'LAWYER ALL', role: 'LEGAL', teams: [], tabs: ['legal'] },
    { code: 'R1', name: 'NOT A LAWYER', role: 'PMO RECOVERY', teams: ['KONGOWE'], tabs: ['legal'] }],
  legal_phone_recovery: STAMPED.map(r => ({ ...r })),
  legal_phone_days: [...new Set(STAMPED.map(r => r.day))].map(day => ({ day, stamped_at: day + 'T12:00:00Z' })),
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }], call_users: [], call_logs: [], roles: [], audit_log: [], defaulter_snapshots: [],
}, { rpc });
const WORLDS = {
  run: book({ ...NP, ...LEGAL_PHONE_RPC }),
  notRun: book({ ...NP }),
  failing: book({ ...NP, legal_phone_week: () => { throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }); } }),
};
let db = WORLDS.run;
const USER = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['legal', 'dashboard', 'present'] };
const REAL = new Set(['demandNotices', 'legalRecoveries', 'dashboardFull', 'officerBoards']);
const calls = [];
const warn = console.warn; console.warn = () => {};          // the failing world's read says so in the server's log, as it should; not here

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
const ME = { name: 'THE ADMIN', role: 'ADMIN', teams: null, teamCount: null, tabs: ['dashboard', 'legal', 'present'], can: { dashboard: true, upload: false, admin: true }, ui: UI };

async function open(world, tab = 'legal') {
  db = WORLDS[world];
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.on('pageerror', e => errs.push(world + ': ' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push(world + ' console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(7000);
  await page.goto(base + '/');
  await page.evaluate(m => { S.code = 'ADM'; start(m); }, ME);
  await page.waitForTimeout(400);
  calls.length = 0;
  await page.evaluate(t => go(t), tab);
  if (tab === 'legal') await page.waitForSelector('#lgWkCard', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  return page;
}
const text = (page, sel) => page.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
const count = (page, sel) => page.evaluate(s => document.querySelectorAll(s).length, sel);
const attr = (page, sel, a) => page.evaluate(([s, k]) => { const e = document.querySelector(s); return e ? e.getAttribute(k) : null; }, [sel, a]);
const off = (page, card, n) => page.evaluate(([c, n]) => { const b = document.querySelector('#' + c + ' [data-lgwk="' + n + '"]'); return b ? b.disabled : null; }, [card, n]);
const drawerOpen = page => page.evaluate(() => getComputedStyle(document.getElementById('drawerBg')).display !== 'none');
const weekCalls = () => calls.filter(c => c[0] === 'legalRecoveries' && c[1].period === 'week').map(c => c[1].weekOf || '');
const phoneOf = async weekOf => (await portalApi(db, USER, 'legalRecoveries', { period: 'week', weekOf })).legal.phone;
const listOf = async weekOf => (await portalApi(db, USER, 'legalRecoveries', { period: 'week', weekOf })).phoneRows;
const figure = (page, p) => page.evaluate(p => (p.pct != null ? pct(p.pct) + ' · ' : '') + money(p.recovered || 0), p);
const waitWeek = (page, w) => page.waitForFunction(w => { const c = document.getElementById('lgWkCard'); return c && c.getAttribute('data-mon') === w && c.style.opacity !== '0.55'; }, w, { timeout: 7000 }).then(() => true, () => false);
const focusId = page => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || (a.closest('[id]') || {}).id + ':' + (a.getAttribute('data-lgwk') || '')) : ''; });
// the open drawer's board: its headers and rows as drawn
const drawerBoard = page => page.evaluate(() => {
  const t = document.querySelector('#drawer table');
  if (!t) return null;
  const cellsOf = tr => [...tr.children].map(td => td.textContent.trim());
  const isTotal = tr => !!tr.closest('tfoot') || /tot/i.test(tr.className);
  const all = [...t.querySelectorAll('tbody tr, tfoot tr')];
  return { head: [...t.querySelectorAll('thead th')].map(th => th.textContent.trim()), rows: all.filter(tr => !isTotal(tr)).map(cellsOf), foot: all.filter(isTotal).map(cellsOf) };
});
const closeDrawer = page => page.evaluate(() => closeDrawer());

let page;
try {
// --- 1. the second card, on this week
page = await open('run');
const pThis = await phoneOf(''), pLast = await phoneOf(LAST), pBefore = await phoneOf(BEFORE);
check('1 the fixture is what it says: this week 46,000 of 249,000 from 5 customers, last week 9,500, the week before 5,000',
  pThis.recovered === 46000 && pThis.owed === 249000 && pThis.customers === 5 && pLast.recovered === 9500 && pBefore.recovered === 5000, JSON.stringify([pThis, pLast.recovered, pBefore.recovered]));
check('1 one notices card and one phone card, side by side in the row of cards', (await count(page, '#lgWkCard')) === 1 && (await count(page, '#lgPhCard')) === 1
  && await page.evaluate(() => { const a = document.getElementById('lgWkCard'), b = document.getElementById('lgPhCard'); return a.parentNode === b.parentNode && a.nextElementSibling === b && a.parentNode.classList.contains('kpis'); }));
check('1 the phone card is on this week and says so', /Recovered by phone this week/.test(await text(page, '#lgPhCard .l')) && new RegExp(THIS + ' → ' + add(THIS, 6)).test(await text(page, '#lgPhS')), await text(page, '#lgPhCard'));
check('1 its figure is the server\'s own reading of this week', (await text(page, '#lgPhV')) === await figure(page, pThis), (await text(page, '#lgPhV')) + ' vs ' + await figure(page, pThis));
check('1 it says who it counts and what waits', /5 wateja wa DC 2\+ waliozungumzwa/.test(await text(page, '#lgPhS')) && /1 wanasubiri faili la jioni/.test(await text(page, '#lgPhS')) && /leo \/ today TZS 46,000/.test(await text(page, '#lgPhS')), await text(page, '#lgPhS'));
check('1 forward is off and backward is ON on both cards: the floor is the first week the phone table holds, not the first notice',
  (await off(page, 'lgPhCard', 1)) === true && (await off(page, 'lgPhCard', -1)) === false && (await off(page, 'lgWkCard', -1)) === false && (await attr(page, '#lgWkCard', 'data-since')) === BEFORE, String(await attr(page, '#lgWkCard', 'data-since')));
check('1 the tab asked the server once, and for no list', calls.filter(c => c[0] === 'demandNotices').length === 1 && !weekCalls().length, JSON.stringify(calls.map(c => c[0])));

// --- 2. a tap opens ITS list
calls.length = 0;
await page.click('#lgPhV');
await page.waitForSelector('#lgPhBoard table', { timeout: 7000 }).catch(() => {});
const rowsThis = await listOf('');
let b = await drawerBoard(page);
check('2 a tap on the phone card opens the phone list of this week', await drawerOpen(page) && /Recovered by phone this week/.test(await text(page, '#drawer h3')) && new RegExp(THIS + ' → ' + add(THIS, 6)).test(await text(page, '#drawer h3')), (await text(page, '#drawer h3')).slice(0, 140));
check('2 its columns: S/N, day, lawyer, customer, REF#, team', !!b && JSON.stringify(b.head.slice(0, 6).map(h => h.replace(/[^A-Za-z#/. ]/g, '').trim())) === JSON.stringify(['S/N', 'Tarehe / Day', 'Afisa wa sheria / Legal officer', 'Mteja / Customer', 'REF#', 'Timu / Team']), b ? JSON.stringify(b.head) : 'no table');
check('2 one row for each customer and day the server lists (two lawyers on one customer are ONE row)', !!b && b.rows.length === rowsThis.length && rowsThis.length === 5, b ? b.rows.length + ' vs ' + rowsThis.length : '');
if (b) {
  const iRec = b.head.findIndex(h => /Imerejeshwa \/ Recovered/.test(h)), iOff = b.head.findIndex(h => /Legal officer/.test(h)), iWho = b.head.findIndex(h => /Spoken to/.test(h)), iCur = b.head.findIndex(h => /Owed after/.test(h));
  const top = b.rows[0];
  check('2 the most recovered first: customer 100, the lawyer who spoke longest, on the guarantor\'s number', top[iOff] === 'LAWYER TWO' && /Guarantor/.test(top[iWho]) && top[iRec] === '40,000', JSON.stringify(top));
  check('2 the list adds up to the card', !!b.foot.length && b.foot[0][iRec] === (await page.evaluate(n => money(n), pThis.recovered)), JSON.stringify(b.foot));
  check('2 a day whose later file is not in says so instead of a figure', b.rows.some(r => /later file not in/.test(r[iCur])), JSON.stringify(b.rows.map(r => r[iCur])));
  check('2 a customer name that is markup is drawn as text', b.rows.some(r => r.includes(HOSTILE)) && !(await page.evaluate(() => window.__pwned)));
}
check('2 it says the rule and that the two cards are never added together', /DC 2 and above/.test(await text(page, '#drawer')) && /never added together/.test(await text(page, '#drawer')));
check('2 it asked the server for this week, once (the week the cards carry)', weekCalls().length === 1 && (weekCalls()[0] === THIS || weekCalls()[0] === ''), JSON.stringify(weekCalls()));
await page.fill('#lgPhQ', 'LAWYER ALL'); await page.waitForTimeout(250);
b = await drawerBoard(page);
check('2 the search box finds a lawyer', !!b && b.rows.length === 1 && b.rows[0].includes('LAWYER ALL'), b ? JSON.stringify(b.rows.map(r => r[2])) : '');
await closeDrawer(page);

// --- 3. its arrows move BOTH cards, open nothing, keep the focus
calls.length = 0;
await page.click('#lgPhCard [data-lgwk="-1"]');
check('3 backward on the phone card puts BOTH cards on last week', await waitWeek(page, LAST) && /past week/.test(await text(page, '#lgPhCard .l')) && /past week/.test(await text(page, '#lgWkCard .l'))
  && (await text(page, '#lgPhV')) === await figure(page, pLast) && new RegExp(LAST + ' → ' + add(LAST, 6)).test(await text(page, '#lgPhS')), await text(page, '#lgPhCard'));
check('3 it opened nothing, and asked the server for last week', !(await drawerOpen(page)) && JSON.stringify(weekCalls()) === JSON.stringify([LAST]), JSON.stringify(weekCalls()));
check('3 the focus is back on the phone card\'s backward arrow', (await focusId(page)) === 'lgPhCard:-1', await focusId(page));
check('3 still one of each card, both lit, each with a way home', (await count(page, '#lgWkCard')) === 1 && (await count(page, '#lgPhCard')) === 1
  && await page.evaluate(() => ['lgWkCard', 'lgPhCard'].every(id => document.getElementById(id).classList.contains('on') && /Back to this week/.test(document.getElementById(id).textContent))));
await page.keyboard.press('Enter');                                   // a key on the arrow that has the focus
check('3 Enter on the arrow steps to the week before and opens nothing', await waitWeek(page, BEFORE) && !(await drawerOpen(page)) && (await text(page, '#lgPhV')) === await figure(page, pBefore), await text(page, '#lgPhCard'));
check('3 at the floor the backward arrow is off on both cards and the focus stays on the phone card', (await off(page, 'lgPhCard', -1)) === true && (await off(page, 'lgWkCard', -1)) === true && (await focusId(page)) === 'lgPhCard', await focusId(page));
calls.length = 0;
await page.click('#lgWkCard [data-lgwk="1"]');                        // the NOTICES card's arrow moves the phone card too
check('3 forward on the notices card brings both back to last week, from what is already held', await waitWeek(page, LAST) && (await text(page, '#lgPhV')) === await figure(page, pLast) && !weekCalls().length, JSON.stringify(weekCalls()));

// --- 4. the pair survives a table search
const q = await page.evaluate(() => !!document.querySelector('#tblQ'));
if (q) { await page.fill('#tblQ', 'CUSTOMER'); await page.waitForTimeout(500); }
check('4 a table search keeps one of each card, both on last week', q && (await count(page, '#lgWkCard')) === 1 && (await count(page, '#lgPhCard')) === 1 && (await attr(page, '#lgWkCard', 'data-mon')) === LAST
  && (await text(page, '#lgPhV')) === await figure(page, pLast) && /past week/.test(await text(page, '#lgPhCard .l')), 'search box: ' + q + ' ' + await text(page, '#lgPhCard'));
await page.click('#lgPhCard [data-lgwk="1"]');
check('4 and the phone card\'s arrows are alive after the repaint', await waitWeek(page, THIS) && /this week/.test(await text(page, '#lgPhCard .l')) && (await text(page, '#lgPhV')) === await figure(page, pThis));
if (q) { await page.fill('#tblQ', ''); await page.waitForTimeout(300); }

// --- 5. the list's own week bar, and the two lists stay apart
await page.click('#lgPhCard [data-lgwk="-1"]'); await waitWeek(page, LAST);
await page.click('#lgPhV');
await page.waitForSelector('#lgPhBoard table', { timeout: 7000 }).catch(() => {});
b = await drawerBoard(page);
check('5 the phone list opens on the week the cards are on (last week)', /Recovered by phone, past week/.test(await text(page, '#drawer h3')) && new RegExp(LAST + ' → ' + add(LAST, 6)).test(await text(page, '#drawer h3')) && !!b && b.rows.length === (await listOf(LAST)).length && b.rows.length === 2, (await text(page, '#drawer h3')).slice(0, 120));
check('5 with the week bar: both arrows on, a way home', await page.evaluate(() => { const g = n => document.querySelector('#drawer [data-lgwd="' + n + '"]'); return !!g(-1) && !g(-1).disabled && !!g(1) && !g(1).disabled && !!g(0); }));
await page.click('#drawer [data-lgwd="-1"]');
await page.waitForFunction(w => new RegExp(w).test((document.querySelector('#drawer h3') || {}).textContent || '') && !!document.querySelector('#lgPhBoard table'), BEFORE, { timeout: 7000 }).catch(() => {});
b = await drawerBoard(page);
check('5 its backward arrow steps the PHONE list and both cards to the week before', new RegExp(BEFORE + ' → ' + add(BEFORE, 6)).test(await text(page, '#drawer h3')) && /Recovered by phone/.test(await text(page, '#drawer h3')) && !!b && b.rows.length === 1
  && (await attr(page, '#lgWkCard', 'data-mon')) === BEFORE && (await text(page, '#lgPhV')) === await figure(page, pBefore), (await text(page, '#drawer h3')).slice(0, 120));
check('5 at the floor the list\'s backward arrow is off', await page.evaluate(() => document.querySelector('#drawer [data-lgwd="-1"]').disabled));
await page.click('#drawer [data-lgwd="0"]');
await page.waitForFunction(w => new RegExp(w + ' →').test((document.querySelector('#drawer h3') || {}).textContent || '') && !!document.querySelector('#lgPhBoard table'), THIS, { timeout: 7000 }).catch(() => {});
check('5 the way home is the PHONE list of this week', /Recovered by phone this week/.test(await text(page, '#drawer h3')) && (await attr(page, '#lgWkCard', 'data-mon')) === THIS && (await text(page, '#lgPhV')) === await figure(page, pThis), (await text(page, '#drawer h3')).slice(0, 120));
await closeDrawer(page);
await page.click('#lgRecW');
await page.waitForFunction(() => /Recovered this week/.test((document.querySelector('#drawer h3') || {}).textContent || ''), null, { timeout: 7000 }).catch(() => {});
b = await drawerBoard(page);
check('5 the notices card still opens the NOTICES list', /Imerejeshwa wiki hii \/ Recovered this week/.test(await text(page, '#drawer h3')) && !/by phone/.test(await text(page, '#drawer h3')) && !!b && /Legal officer/.test(b.head[1]) && /Customer/.test(b.head[2]) && !(await page.evaluate(() => !!document.getElementById('lgPhBoard'))), b ? JSON.stringify(b.head.slice(0, 4)) : (await text(page, '#drawer')).slice(0, 200));
await closeDrawer(page);
await page.close();

// --- 6. db/RUN-ME-089 not run
page = await open('notRun');
check('6 not run: the phone card shows a dash and names the file', (await text(page, '#lgPhV')) === '—' && /db\/RUN-ME-089-legal-recovery-by-phone\.sql/.test(await text(page, '#lgPhS')), await text(page, '#lgPhCard'));
check('6 its arrows are off; the notices card is as it always was (this week is its floor: one notice, this week)', (await off(page, 'lgPhCard', -1)) === true && (await off(page, 'lgPhCard', 1)) === true
  && (await attr(page, '#lgWkCard', 'data-since')) === THIS && /Recovered this week/.test(await text(page, '#lgWkCard .l')) && (await text(page, '#lgRecW')) !== '');
await page.click('#lgPhV'); await page.waitForTimeout(700);
check('6 a tap says the same in the list, with no table', await drawerOpen(page) && /db\/RUN-ME-089/.test(await text(page, '#drawer .note')) && !(await page.evaluate(() => !!document.querySelector('#drawer table'))), (await text(page, '#drawer')).slice(0, 200));
await closeDrawer(page);
await page.close();

// --- 7. a read that fails
page = await open('failing');
check('7 a failed read is said on the card, with no figure', (await text(page, '#lgPhV')) === '—' && /could not be read just now/.test(await text(page, '#lgPhS')) && !/RUN-ME-089/.test(await text(page, '#lgPhS')), await text(page, '#lgPhCard'));
check('7 and the rest of the tab is there: the notices card, the register', (await count(page, '#lgWkCard')) === 1 && (await text(page, '#lgRecW')) !== '' && /CUSTOMER 100/.test(await text(page, '#view')));
await page.close();

// --- 8. the dashboard: one Legal card, and "By phone" on the lawyers' boards
page = await open('run', 'dashboard');
await page.waitForSelector('#dashBoardsLoad', { timeout: 10000 }).catch(() => {});
await page.click('#dashBoardsLoad').catch(() => {});                    // the boards wait behind one button
await page.waitForFunction(() => !!document.querySelector('#bLegalW table'), null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(400);
const boardOf = id => page.evaluate(id => {
  const t = document.querySelector('#' + id + ' table'); if (!t) return null;
  const cellsOf = tr => [...tr.children].map(td => td.textContent.trim());
  const isTotal = tr => !!tr.closest('tfoot') || /tot/i.test(tr.className);
  const all = [...t.querySelectorAll('tbody tr, tfoot tr')];
  return { head: [...t.querySelectorAll('thead th')].map(th => th.textContent.trim()), rows: all.filter(tr => !isTotal(tr)).map(cellsOf), foot: all.filter(isTotal).map(cellsOf) };
}, id);
check('8 the dashboard has no phone card', (await count(page, '#lgPhCard')) === 0);
const bw = await boardOf('bLegalW'), bt = await boardOf('bLegalT');
check('8 the week\'s board is drawn with a "By phone" column', !!bw && bw.head.some(h => /Kwa simu \/ By phone/.test(h)), bw ? JSON.stringify(bw.head) : 'no board');
if (bw && bt) {
  const iw = bw.head.findIndex(h => /By phone/.test(h)), it = bt.head.findIndex(h => /By phone/.test(h)), io = bw.head.findIndex(h => /Legal officer/.test(h));
  const rowOf = (bd, name) => bd.rows.find(r => r[io] === name) || [];
  check('8 the week: LAWYER TWO 41,000 (40,000 + 1,000), LAWYER ONE nothing, total 41,000', rowOf(bw, 'LAWYER TWO')[iw] === '41,000' && rowOf(bw, 'LAWYER ONE')[iw] === '0' && !!bw.foot.length && bw.foot[0][iw] === '41,000', JSON.stringify([rowOf(bw, 'LAWYER TWO'), rowOf(bw, 'LAWYER ONE'), bw.foot]));
  check('8 today\'s board carries today\'s', rowOf(bt, 'LAWYER TWO')[it] === '41,000', JSON.stringify(rowOf(bt, 'LAWYER TWO')));
}
const notes = await page.evaluate(() => [...document.querySelectorAll('#view .note')].map(n => n.textContent));
check('8 a line above the boards says the week and the lawyer who has no row', notes.some(n => /By phone:/.test(n) && /week TZS 46,000 \(5 wateja \/ customers\)/.test(n) && /LAWYER ALL TZS 5,000/.test(n) && /never added to the notices figure/.test(n)), JSON.stringify(notes.filter(n => /simu/.test(n))));
await page.close();

// --- 9. the Presentation's Legal slide
page = await open('run', 'present');
await page.waitForFunction(() => window.S && S.slides && S.slides.some(s => s.id === 'legal') && S.presData && S.presData.b, null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(300);
const slide = await page.evaluate(() => {
  const i = S.slides.findIndex(s => s.id === 'legal'); if (i < 0) return null;
  const s = S.slides[i]; S.presI = i; presDraw();
  const t = document.querySelector('table.ptable');
  return { title: s.title, caption: s.caption, head: t ? [...t.querySelectorAll('thead th')].map(th => th.textContent.trim()) : [],
    cells: t ? [...t.querySelectorAll('tbody tr, tfoot tr')].map(tr => [...tr.children].map(td => td.textContent.trim())) : [], body: document.body.textContent };
});
check('9 the Legal slide is built and its title says by phone', !!slide && /kwa simu \/ by phone/.test(slide.title), slide ? slide.title : 'no slide');
if (slide) {
  const it = slide.head.findIndex(h => /By phone today/.test(h)), iw = slide.head.findIndex(h => /By phone \(week\)/.test(h));
  const two = slide.cells.find(r => r.includes('LAWYER TWO')) || [];
  check('9 two columns, today and the week, with LAWYER TWO\'s 41,000 in each', it > 0 && iw > 0 && two[it] === '41,000' && two[iw] === '41,000', JSON.stringify([slide.head, two]));
  check('9 the caption carries the line (the week, the lawyer with no row)', /By phone:/.test(slide.caption) && /TZS 46,000/.test(slide.caption) && /LAWYER ALL TZS 5,000/.test(slide.caption) && /LAWYER ALL TZS 5,000/.test(slide.body), slide.caption.slice(-300));
}
await page.close();
// and on a database where the file was not run, the slide and the boards say so and show no figure
page = await open('notRun', 'present');
await page.waitForFunction(() => window.S && S.slides && S.slides.some(s => s.id === 'legal') && S.presData && S.presData.b, null, { timeout: 15000 }).catch(() => {});
const slideOff = await page.evaluate(() => {
  const i = S.slides.findIndex(s => s.id === 'legal'); if (i < 0) return null;
  const s = S.slides[i]; S.presI = i; presDraw();
  const t = document.querySelector('table.ptable');
  return { caption: s.caption, head: t ? [...t.querySelectorAll('thead th')].map(th => th.textContent.trim()) : [], cells: t ? [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim())) : [] };
});
if (slideOff) {
  const iw = slideOff.head.findIndex(h => /By phone \(week\)/.test(h));
  check('9 not run: the slide names the file and shows no figure under By phone', /db\/RUN-ME-089/.test(slideOff.caption) && iw > 0 && slideOff.cells.length >= 2 && slideOff.cells.every(r => r[iw] === ''), JSON.stringify([slideOff.caption.slice(-160), slideOff.cells.map(r => r[iw])]));
} else check('9 not run: the slide is built', false);
await page.close();
} catch (e) { fail.push('the check stopped: ' + String((e && e.message) || e).split('\n')[0].slice(0, 240)); }

check('no page error in any world', !errs.length, errs.slice(0, 3).join(' | '));
await browser.close(); srv.close(); console.warn = warn;
for (const f of fail) console.log('FAIL  ' + f);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
