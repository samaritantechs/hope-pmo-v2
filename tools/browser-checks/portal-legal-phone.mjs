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
     9. the Presentation: the Legal (demand notices) slide is AS IT WAS (the owner, 24 Nov 2026: "leaving the demand recovery
        slide as it was"), and the legal officers' own calls slide lists every legal phone, the silent one in red, with its
        calls today and this week and recovery by phone today and for the week, adding up to the card (Part 141).

     10. the Legal tab's FIRST card holds the three figures the tiles had (Notices issued, Total demanded, Fines charged) and its
        LAST card, the grand recovery per lawyer, closes the row (Part 149, 24 Nov 2026: "Combine these into single card" ...
        "add a total recovery card at the end that shows each leagl's grand recovery (Notice+Calls by amount and %)"): one of
        each; the grand card's rows equal the server's reading of the same week; its arrows move all three cards and give the
        focus back; it survives a table search; it shows dashes and names the file where db/RUN-ME-089 is not run, says so when
        the read failed, and is not on the dashboard; on a phone's width the page does not scroll sideways. SHOTS=<dir> saves
        the pictures.

     11. the grand card's EXCEL and JPG buttons (Part 150, 24 Nov 2026: "add excel and jpg button at weekly grand recovery of legal
        teams so that we could always download it"): Excel downloads the card's own figures, week and total row included, for
        this week AND for the past week the arrows are on; the buttons still work after a table search repaints the card; where
        db/RUN-ME-089 is not run the calls and grand cells are EMPTY in the sheet (never noughts) and the sheet names the file;
        JPG downloads a real picture of the card, wide enough for its table.

     12. the DASHBOARD's Legal widget includes call recovery (Part 151, 24 Nov 2026: "in summary and in the data rows of Legal Recovery
        widget (Imerejeshwa wiki hii / Recovered this week) at dashboard tab, should include call recovery"): the card's headline
        and week are notices + calls, equal to the server's own grand total; a tap opens the list with a summary of the three
        figures and, under the payments, the data rows of recovery by phone; one search filters both boards; both boards download;
        a name that is markup is text; last week through the card's arrows; where db/RUN-ME-089 is not run, or its read failed,
        the card and the list say the calls are not included; and the Legal TAB's notices card still opens the notices alone.

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
const CL = (id, officer, team, phone, date, extra = {}) => ({ id, officer, team, phone, call_date: date, duration: 0, portfolio: false, outcome: 'CONNECTED', ref: null, category: null, ...extra });
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
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }], roles: [], audit_log: [], defaulter_snapshots: [],
  /* THE LEGAL PHONES (Part 141). ONE and TWO ring through the app (TWO's phone is registered as a field officer's: the one access
     code of her name makes it a lawyer's), ALL made one call, SILENT none this week. A recovery officer's phone is not on the
     legal officers' slide. */
  call_users: [
    { user_id: 'u1', name: 'LAWYER ONE', team: 'KONGOWE', role: 'LEGAL' },
    { user_id: 'u2', name: 'LAWYER TWO', team: 'MBAGALA', role: 'FIELD OFFICER' },
    { user_id: 'u3', name: 'LAWYER ALL', team: 'TANDIKA', role: 'LEGAL' },
    { user_id: 'u4', name: 'LAWYER SILENT', team: 'KONGOWE', role: 'LEGAL' },
    { user_id: 'u9', name: 'NOT A LAWYER', team: 'KONGOWE', role: 'PMO RECOVERY' },
  ],
  call_logs: [
    CL('k1', 'LAWYER ONE', 'KONGOWE', '0712000100', TODAY, { duration: 130, portfolio: true, ref: '100', category: 'DEFAULTER' }),
    CL('k2', 'LAWYER ONE', 'KONGOWE', '0799000001', TODAY, { duration: 400 }),
    CL('k3', 'LAWYER ONE', 'KONGOWE', '0799000002', TODAY, { duration: 2 }),
    CL('k4', 'LAWYER TWO', 'MBAGALA', '0755000100', TODAY, { duration: 300, ref: '100' }),
    CL('k5', 'LAWYER TWO', 'MBAGALA', '0712000200', TODAY, { duration: 20, portfolio: true, ref: '200', category: 'DEFAULTER' }),
    CL('k6', 'LAWYER ALL', 'TANDIKA', '0712000500', TODAY, { duration: 33, portfolio: true, ref: '500', category: 'DEFAULTER' }),
    CL('k7', 'NOT A LAWYER', 'KONGOWE', '0712000901', TODAY, { duration: 90, portfolio: true, ref: '901' }),
  ],
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
check('2 it says the rule and that the grand card counts a noticed customer once, under notices', /DC 2 and above/.test(await text(page, '#drawer')) && /counts them once, under notices/.test(await text(page, '#drawer')));
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

// --- 9. the Presentation: the Legal slide as it was, and the legal officers' own calls slide
const readSlide = (pg, id) => pg.evaluate(id => {
  const i = S.slides.findIndex(s => s.id === id); if (i < 0) return null;
  const s = S.slides[i]; S.presI = i; presDraw();
  const t = document.querySelector('table.ptable');
  return { at: i, title: s.title, caption: s.caption || '', head: t ? [...t.querySelectorAll('thead th')].map(th => th.textContent.trim()) : [],
    cells: t ? [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim())) : [],
    red: t ? [...t.querySelectorAll('tbody tr')].map(tr => { const td = tr.children[1]; return !!td && /(^| )bad( |$)/.test(td.className); }) : [],
    // the first column after the row number, with the class the wall gave it (a column's own mark: red or green)
    marks: t ? [...t.querySelectorAll('tbody tr')].map(tr => { const td = tr.children[1]; return { text: td ? td.textContent.trim() : '', cls: td ? td.className.trim() : '' }; }) : [],
    body: document.body.textContent };
}, id);
/* THE LAYOUT, MEASURED. The wall's figure columns never wrap, so a header or a figure that is wider than its column runs into the
   one beside it, and a right-aligned cell spills to the LEFT, which scrollWidth does not see (the first form of this check asked
   scrollWidth and passed on a slide whose headers touched). So the TEXT of every cell is measured against the cell's own box, and
   the gap between neighbouring texts of a row is kept. The slide is shown as the TV shows it, at three widths. */
const layoutOf = (pg, id, width) => pg.evaluate(async ({ id, width }) => {
  const i = S.slides.findIndex(s => s.id === id); if (i < 0) return null;
  S.presI = i; const pres = document.getElementById('pres'); pres.style.display = 'block'; presDraw(); if (typeof presFit_ === 'function') presFit_();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const t = document.querySelector('table.ptable'), out = { width, vw: window.innerWidth, spill: 0, minGap: 1e9, worst: '', lines: 0, cols: 0, tw: 0 };
  if (t) {
    out.tw = Math.round(t.getBoundingClientRect().width); out.cols = t.querySelectorAll('thead th').length;
    for (const tr of t.querySelectorAll('tr')) {
      const cells = [...tr.children].map(el => { const r = document.createRange(); r.selectNodeContents(el); const a = r.getBoundingClientRect(), c = el.getBoundingClientRect();
        return { el, tl: a.left, tr: a.right, cl: c.left, cr: c.right, w: a.width, h: a.height }; }).filter(c => c.w > 0);
      cells.forEach((c, k) => {
        const over = Math.max(c.cl - c.tl, c.tr - c.cr);
        if (over > 0.5) { out.spill++; out.worst = out.worst || (c.el.textContent.trim().slice(0, 30) + ' by ' + over.toFixed(1) + 'px'); }
        if (k) out.minGap = Math.min(out.minGap, c.tl - cells[k - 1].tr);
      });
    }
    // how many lines the tallest name cell takes (a wrapped name is right; a figure cell is always one line)
    const lh = parseFloat(getComputedStyle(t).fontSize) * 1.3;
    out.lines = Math.max(...[...t.querySelectorAll('tbody tr')].map(tr => { const el = tr.children[1]; const r = document.createRange(); r.selectNodeContents(el); return Math.round(r.getBoundingClientRect().height / lh); }));
    out.minGap = Math.round(out.minGap * 10) / 10;
    // the mark is never broken across lines: the characters from the dash to the end sit in one line box
    const cell = [...t.querySelectorAll('tbody tr td:nth-child(2)')].find(td => /kimya/.test(td.textContent));
    if (cell && cell.firstChild && cell.firstChild.nodeType === 3) { const tx = cell.firstChild, k = tx.data.indexOf('kimya') - 2; const r = document.createRange(); r.setStart(tx, k); r.setEnd(tx, tx.data.length);
      out.markWhole = r.getClientRects().length === 1; } else out.markWhole = null;
  }
  pres.style.display = 'none';
  return out;
}, { id, width });
page = await open('run', 'present');
await page.waitForFunction(() => window.S && S.slides && S.slides.some(s => s.id === 'legalcalls') && S.presData && S.presData.b, null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(300);
const slide = await readSlide(page, 'legal');
check('9 the Legal slide is as it was: its title says nothing of the phone', !!slide && /Legal recovery/.test(slide.title) && !/simu|phone/i.test(slide.title), slide ? slide.title : 'no slide');
if (slide) {
  check('9 and it has no By phone column: it ends at the week\'s Rec %', !slide.head.some(h => /By phone/.test(h)) && /Rec % \(week\)/.test(slide.head[slide.head.length - 1] || ''), JSON.stringify(slide.head));
  check('9 nor the phone line in its caption', !/By phone/.test(slide.caption), slide.caption.slice(-200));
}
const lc = await readSlide(page, 'legalcalls');
// SHOTS=<dir> saves a picture of the slide as the TV shows it.
if (process.env.SHOTS) {
  fs.mkdirSync(process.env.SHOTS, { recursive: true });
  await page.evaluate(() => { document.getElementById('pres').style.display = 'block'; presDraw(); if (typeof presFit_ === 'function') presFit_(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(process.env.SHOTS, 'legalcalls-slide.png') });
  await page.evaluate(() => { document.getElementById('pres').style.display = 'none'; });
}
check('9 the legal officers\' calls slide is built, right after the Legal slide', !!lc && !!slide && lc.at === slide.at + 1 && /Legal calls/.test(lc.title) && /recovery by phone/.test(lc.title), lc ? lc.title : 'no slide');
if (lc) {
  const H = re => lc.head.findIndex(h => re.test(h));
  const iOff = H(/^Legal officer$/i), iCalls = H(/^Calls today$/i), iTalk = H(/^Portfolio talk$/i), iPf = H(/^Portfolio$/i), iWk = H(/^Calls week$/i), iRw = H(/^Reached week$/i),
    iSp = H(/^DC 2\+ spoken$/i), iT = H(/^By phone today$/i), iW = H(/^By phone week$/i);
  check('9 nine columns after the row number, in the order the room reads them: today, the week, then the phone',
    lc.head.length === 10 && [iOff, iCalls, iTalk, iPf, iWk, iRw, iSp, iT, iW].join() === '1,2,3,4,5,6,7,8,9' && !lc.head.some(h => /Reached today/i.test(h)), JSON.stringify(lc.head));
  // On the TV: no text leaves its own column and neighbours keep a gap, from a small projector's width to a full-HD screen's.
  for (const w of [1024, 1280, 1366, 1500, 1920]) {
    await page.setViewportSize({ width: w, height: Math.round(w * 9 / 16) });
    const L = await layoutOf(page, 'legalcalls', w);
    check('9 at ' + w + ' px wide nothing on the slide leaves its own column and neighbouring texts stay 6 px apart or more', !!L && L.cols === 10 && L.spill === 0 && L.minGap >= 6, JSON.stringify(L));
    if (w === 1500) check('9 the silent phone\'s name and its mark wrap inside their own cell (two lines at most), the mark kept whole on its line', !!L && L.lines <= 2 && L.markWhole === true, JSON.stringify(L));
  }
  // every other table slide is laid out as before: none of them carries the class
  const other = await page.evaluate(() => S.slides.filter(s => s.tcls).map(s => s.id));
  check('9 no other slide asks for the wider name column', JSON.stringify(other) === JSON.stringify(['legalcalls']), JSON.stringify(other));
  await page.setViewportSize({ width: 1500, height: 950 });
  const rows = lc.cells.filter(r => !/JUMLA/.test(r.join(' ')));
  const names = rows.map(r => r[iOff].replace(/\s.\skimya\s\/\ssilent$/, ''));
  check('9 it lists the four legal phones, the one that rings as a field officer too, and not the recovery officer', JSON.stringify(names) === JSON.stringify(['LAWYER TWO', 'LAWYER ALL', 'LAWYER ONE', 'LAWYER SILENT']), JSON.stringify(names));
  const R9 = n => rows[names.indexOf(n)] || [];
  check('9 LAWYER TWO: two numbers rung today, one of them a customer of the lawyer\'s own teams, four customers at DC 2+ spoken to, 41,000 by phone today and this week',
    R9('LAWYER TWO')[iCalls] === '2' && R9('LAWYER TWO')[iPf] === '1' && R9('LAWYER TWO')[iSp] === '4' && R9('LAWYER TWO')[iT] === '41,000' && R9('LAWYER TWO')[iW] === '41,000', JSON.stringify(R9('LAWYER TWO')));
  check('9 LAWYER ONE: three numbers rung, two of them spoken to this week; nothing by phone (the other lawyer spoke longest)',
    R9('LAWYER ONE')[iCalls] === '3' && /^6[67]/.test(R9('LAWYER ONE')[iRw] || '') && R9('LAWYER ONE')[iW] === '0', JSON.stringify(R9('LAWYER ONE')));
  /* THE THIRD COLUMN IS TODAY'S PORTFOLIO TALK (Part 143): the talk time of today's calls to customers of the officer's own teams,
     as the HOPE Calls slide prints it. LAWYER ONE spoke 130 s with one such customer (the 400 s call was to a number of no
     customer: it is not portfolio talk); LAWYER TWO 20 s; LAWYER ALL 33 s; the silent phone nothing; the total is their sum. */
  check('9 the third column is today\'s portfolio talk: 2:10, 0:20 and 0:33, the silent phone 0:00',
    R9('LAWYER ONE')[iTalk] === '2:10' && R9('LAWYER TWO')[iTalk] === '0:20' && R9('LAWYER ALL')[iTalk] === '0:33' && R9('LAWYER SILENT')[iTalk] === '0:00',
    JSON.stringify(['LAWYER ONE', 'LAWYER TWO', 'LAWYER ALL', 'LAWYER SILENT'].map(n => R9(n)[iTalk])));
  const si = names.indexOf('LAWYER SILENT');
  check('9 the phone that sent no call this week says "kimya / silent" in its own cell, in red, at nought', si >= 0 && /^LAWYER SILENT\s.\skimya\s\/\ssilent$/.test(rows[si][iOff] || '') && lc.red[si] === true
    && rows[si][iCalls] === '0' && rows[si][iWk] === '0' && rows[si][iW] === '0', JSON.stringify([rows[si], lc.red]));
  check('9 nobody else is marked', lc.red.filter(Boolean).length === 1 && rows.filter(r => /kimya/.test(r[iOff] || '')).length === 1, JSON.stringify(lc.red));
  const tot = lc.cells.find(r => /JUMLA/.test(r.join(' '))) || [];
  check('9 the total row adds the phone columns up to the card: 46,000', tot[iT] === '46,000' && tot[iW] === '46,000', JSON.stringify(tot));
  check('9 and the portfolio talk up to 3:03 (130 + 20 + 33 seconds)', tot[iTalk] === '3:03', JSON.stringify(tot));
  check('9 the caption carries the phone line, with nobody "without a row"', /By phone:/.test(lc.caption) && /TZS 46,000/.test(lc.caption) && !/with no row here/.test(lc.caption), lc.caption.slice(0, 260));
  check('9 and it says what the third column is: the talk time of today\'s portfolio calls', /Portfolio talk = [^<]*the talk time of those calls today/.test(lc.caption) && !/Reached today/.test(lc.caption), lc.caption.slice(-420, -200));
  check('9 it says one customer waits for the later file and one legal phone is silent', /waiting for the later file/.test(lc.caption) && /1 legal phone has sent no call through HOPE Calls this week/.test(lc.caption), lc.caption.slice(-330));
}
// The wall draws a column's own mark on every slide that has one: the HOPE Calls slide's "Busiest" is green and "Least active" red
// ("format red the least actives"), which the wall never drew before this change.
{
  const hc = await readSlide(page, 'calls');
  const marked = hc ? hc.marks.filter(m => m.text === 'Busiest' || m.text === 'Least active') : [];
  check('9 the HOPE Calls slide\'s own marks are coloured on the wall too: every "Least active" red, every "Busiest" green',
    marked.length > 0 && marked.every(m => (m.text === 'Busiest' ? /(^| )good( |$)/ : /(^| )bad( |$)/).test(m.cls)), JSON.stringify(hc ? hc.marks : null));
}
await page.close();
// and on a database where the file was not run: the phones and their calls are shown, the three phone columns are blank, the file is named
page = await open('notRun', 'present');
await page.waitForFunction(() => window.S && S.slides && S.slides.some(s => s.id === 'legalcalls') && S.presData && S.presData.b, null, { timeout: 15000 }).catch(() => {});
const lcOff = await readSlide(page, 'legalcalls');
if (lcOff) {
  const H = re => lcOff.head.findIndex(h => re.test(h));
  const iOff = H(/^Legal officer$/i), iCalls = H(/^Calls today$/i), iSp = H(/^DC 2\+ spoken$/i), iT = H(/^By phone today$/i), iW = H(/^By phone week$/i);
  const rows = lcOff.cells.filter(r => !/JUMLA/.test(r.join(' ')));
  check('9 not run: the slide names the file', /db\/RUN-ME-089/.test(lcOff.caption), lcOff.caption.slice(0, 200));
  check('9 not run: the phones and their calls are shown all the same', rows.length === 4 && (rows.find(r => r[iOff] === 'LAWYER ONE') || [])[iCalls] === '3', JSON.stringify(rows.map(r => [r[iOff], r[iCalls]])));
  check('9 not run: nothing under the three phone columns, on the rows or the total', iSp > 0 && iT > 0 && iW > 0 && lcOff.cells.every(r => r[iSp] === '' && r[iT] === '' && r[iW] === ''), JSON.stringify(lcOff.cells.map(r => [r[iSp], r[iT], r[iW]])));
} else check('9 not run: the legal calls slide is built', false);
await page.close();
// --- 10. the tab's first card, and its last (Part 149)
page = await open('run');
const fmt = n => Math.round(Number(n) || 0).toLocaleString('en-US');
const gThis = (await portalApi(db, USER, 'legalRecoveries', { period: 'week', weekOf: '' })).legal.grand;
const gLast = (await portalApi(db, USER, 'legalRecoveries', { period: 'week', weekOf: LAST })).legal.grand;
const dnRes = await portalApi(db, USER, 'demandNotices', {});
const issued = await page.evaluate(() => { const c = document.getElementById('lgIssued'); return c ? [...c.querySelectorAll('.m')].map(m => [m.querySelector('.ml').textContent, m.querySelector('.mv').textContent, (m.querySelector('.ms') || {}).textContent || '']) : null; });
check('10 the first card holds the three figures in the owner\'s order, with the fines\' note', JSON.stringify(issued) === JSON.stringify([['Notices issued', fmt(dnRes.count), ''], ['Total demanded', fmt(dnRes.demanded), ''], ['Fines charged', fmt(dnRes.fines), 'late-payment penalties']]), JSON.stringify(issued));
check('10 it is the first card of the row, and the three tiles it replaces are gone', await page.evaluate(() => { const k = document.querySelector('.kpis');
  return !!k && k.firstElementChild.id === 'lgIssued' && ![...document.querySelectorAll('.kpi .l')].some(l => /^(Notices issued|Total demanded|Fines charged)$/i.test(l.textContent.trim())); }));
const grandOnPage = pg => pg.evaluate(() => [...document.querySelectorAll('#lgGrand tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim())));
const expectGrand = (pg, g) => pg.evaluate(g => { const a = v => v == null ? '—' : money(v), p = v => v == null ? '' : pct(v);
  const cells = r => [a(r.nRec), p(r.nPct), a(r.cRec), p(r.cPct), a(r.recovered), p(r.pct)];
  return g.rows.map(r => [r.officer].concat(cells(r))).concat([['Jumla / Total'].concat(cells(g.total))]); }, g);
const sameGrand = async (pg, g) => JSON.stringify(await grandOnPage(pg)) === JSON.stringify(await expectGrand(pg, g));
check('10 the fixture is what it says: three lawyers, the noticed customer\'s 40,000 left out of calls, 6,300 together', gThis.rows.length === 3 && gThis.overlap.recovered === 40000
  && gThis.total.recovered === 6300 && gThis.total.nRec === 300 && gThis.total.cRec === 6000, JSON.stringify([gThis.rows.map(r => r.officer), gThis.overlap, gThis.total]));
check('10 one grand card, the LAST of the row, the whole width of it', (await count(page, '#lgGrand')) === 1 && await page.evaluate(() => { const g = document.getElementById('lgGrand'), k = g.parentNode;
  return k.classList.contains('kpis') && !g.nextElementSibling && g.previousElementSibling.id === 'lgPhCard' && g.getBoundingClientRect().width > k.getBoundingClientRect().width - 4; }));
check('10 a row for each lawyer, then the total, equal to the server\'s reading of this week', await sameGrand(page, gThis), JSON.stringify(await grandOnPage(page)).slice(0, 400));
check('10 its notices total is the notices card above it, and the week is the cards\'', dnRes.legal.recovered === gThis.total.nRec && new RegExp(THIS + ' → ' + add(THIS, 6)).test(await text(page, '#lgGrand .s')) && (await attr(page, '#lgWkCard', 'data-mon')) === THIS);
check('10 it says what it left out of calls, in both languages', /1 customer-days/.test(await text(page, '#lgGrand')) && /TZS 40,000 haikuhesabiwa mara ya pili/.test(await text(page, '#lgGrand')));
// the arrows of the third card move all three
await page.click('#lgGrand [data-lgwk="-1"]');
check('10 backward on the grand card puts all three on last week', await waitWeek(page, LAST) && /past week/.test(await text(page, '#lgGrand .s')) && (await attr(page, '#lgPhCard', 'class') || '').includes('on'));
check('10 still one of each card, and the grand card shows last week\'s reading', (await count(page, '#lgWkCard')) === 1 && (await count(page, '#lgPhCard')) === 1 && (await count(page, '#lgGrand')) === 1 && await sameGrand(page, gLast), JSON.stringify(await grandOnPage(page)).slice(0, 300));
check('10 the focus is back on the grand card\'s backward arrow', (await focusId(page)) === 'lgGrand:-1', await focusId(page));
const q10 = await page.evaluate(() => !!document.querySelector('#tblQ'));
if (q10) { await page.fill('#tblQ', 'CUSTOMER'); await page.waitForTimeout(500); }
check('10 a table search keeps all three, on last week', q10 && (await count(page, '#lgGrand')) === 1 && (await count(page, '#lgPhCard')) === 1 && (await attr(page, '#lgWkCard', 'data-mon')) === LAST && await sameGrand(page, gLast));
await page.click('#lgGrand [data-lgwk="1"]');
check('10 and its arrows are alive after the repaint: forward lands on this week', await waitWeek(page, THIS) && await sameGrand(page, gThis));
if (q10) { await page.fill('#tblQ', ''); await page.waitForTimeout(300); }
// the two ends of the picture: a wide screen and a phone's
if (process.env.SHOTS) {
  fs.mkdirSync(process.env.SHOTS, { recursive: true });
  await (await page.$('.kpis')).screenshot({ path: path.join(process.env.SHOTS, 'legal-cards-wide.png') });
}
await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(300);
check('10 on a phone\'s width nothing scrolls sideways, not the page and not the screen: the table scrolls inside its own card', await page.evaluate(() => {
  const body = document.getElementById('view').closest('.body') || document.body, g = document.getElementById('lgGrand'), sc = g.querySelector('.scroll');
  return document.documentElement.scrollWidth <= window.innerWidth + 1 && body.scrollWidth <= body.clientWidth + 1 && g.getBoundingClientRect().right <= window.innerWidth + 1 && !!sc && sc.scrollWidth > sc.clientWidth;
}), await page.evaluate(() => { const b = document.getElementById('view').closest('.body') || document.body, sc = document.querySelector('#lgGrand .scroll'); return 'page ' + document.documentElement.scrollWidth + ', screen ' + b.scrollWidth + '/' + b.clientWidth + ', table box ' + (sc ? sc.scrollWidth + '/' + sc.clientWidth : 'none') + ', window ' + window.innerWidth; }));
if (process.env.SHOTS) await (await page.$('.kpis')).screenshot({ path: path.join(process.env.SHOTS, 'legal-cards-phone.png') });
await page.close();
// where db/RUN-ME-089 is not run: dashes for the calls and the grand figures, the file named, the notices still read
page = await open('notRun');
const gOff = (await portalApi(db, USER, 'legalRecoveries', { period: 'week', weekOf: '' })).legal.grand;
check('10 not run: the card names the file, and the calls and grand cells are dashes, never noughts', /db\/RUN-ME-089/.test(await text(page, '#lgGrand')) && gOff.pOn === false && await sameGrand(page, gOff)
  && (await grandOnPage(page)).every(r => r[3] === '—' && r[5] === '—'), JSON.stringify(await grandOnPage(page)).slice(0, 300));
check('10 not run: the notices side is still read', (await grandOnPage(page)).some(r => r[1] === '300'), JSON.stringify(await grandOnPage(page)).slice(0, 200));
await page.close();
page = await open('failing');
check('10 a read that failed is said on the card, and the file is not blamed', /could not be read just now/.test(await text(page, '#lgGrand')) && !/RUN-ME-089/.test(await text(page, '#lgGrand')));
await page.close();
// the dashboard keeps ONE Legal card
page = await open('run', 'dashboard');
check('10 the dashboard has no grand card: one Legal card', (await count(page, '#lgGrand')) === 0 && (await count(page, '#lgWkCard')) <= 1);
await page.close();

// --- 11. the grand card's downloads (Part 150)
const jpegSize = buf => { let i = 2; while (i < buf.length) { if (buf[i] !== 0xFF) { i++; continue; } const m = buf[i + 1];
  if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + buf.readUInt16BE(i + 2); } return null; };
const sheetOf = async dl => { const raw = fs.readFileSync(await dl.path()); return { name: dl.suggestedFilename(), bom: raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF, text: raw.subarray(3).toString('utf8') }; };
const sheetRows = text => [...text.matchAll(/<tr><td>([^<]*)<\/td>((?:<td[^>]*>[^<]*<\/td>)+)<\/tr>/g)].map(m => [...m[2].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(c => c[1]));
const wantSheet = g => { const n = v => v == null ? '' : String(v), p = v => v == null ? '' : String(Math.round(v));
  const cells = r => [n(r.nRec), p(r.nPct), n(r.cRec), p(r.cPct), n(r.recovered), p(r.pct)];
  return g.rows.map(r => [r.officer].concat(cells(r))).concat([['JUMLA / TOTAL'].concat(cells(g.total))]); };
const press = (pg, kind) => Promise.all([pg.waitForEvent('download', { timeout: 30000 }), pg.click('#lgGrand button[onclick*="\'' + kind + '\'"]')]).then(r => r[0]);
page = await open('run');
check('11 the grand card has an Excel and a JPG button, in a row of their own', await page.evaluate(() => { const r = document.querySelector('#lgGrand .lgGact'); return !!r && [...r.querySelectorAll('button')].map(b => b.textContent).join('|') === 'Excel|JPG'; }));
const x1 = await sheetOf(await press(page, 'xls'));
check('11 Excel: a real .xls file named for the week, with the byte-order mark', /^Legal-grand-recovery-week-of-/.test(x1.name) && x1.name.includes(THIS) && x1.name.endsWith('.xls') && x1.bom, x1.name);
check('11 Excel: the title says the week', x1.text.includes('<h3>Legal grand recovery — week of ' + THIS + ' to ' + add(THIS, 6) + '</h3>'));
check('11 Excel: a row for each lawyer then the total row, equal to the server\'s reading of this week', JSON.stringify(sheetRows(x1.text)) === JSON.stringify(wantSheet(gThis)), JSON.stringify(sheetRows(x1.text)).slice(0, 300));
check('11 Excel: the sentences are under the table, with what was left out of calls', /Calls = customers at DC 2\+ spoken to who had no notice yet/.test(x1.text) && /TZS 40,000 left out/.test(x1.text));
check('11 Excel: the sheet\'s notices total is the notices card\'s figure', Number((sheetRows(x1.text).pop() || [])[1]) === dnRes.legal.recovered, JSON.stringify(sheetRows(x1.text).pop()));
// a past week: the arrows are on last week, and the sheet is last week's
await page.click('#lgGrand [data-lgwk="-1"]');
check('11 the cards are on last week', await waitWeek(page, LAST));
const x2 = await sheetOf(await press(page, 'xls'));
check('11 Excel on a past week: its title, its file name and its figures are last week\'s', x2.text.includes('week of ' + LAST + ' to ' + add(LAST, 6)) && x2.name.includes(LAST) && JSON.stringify(sheetRows(x2.text)) === JSON.stringify(wantSheet(gLast)), x2.name);
check('11 the way home is in the same row, and the row still holds Excel and JPG', await page.evaluate(() => [...document.querySelectorAll('#lgGrand .lgGact button')].map(b => b.textContent.trim()).join('|') === 'Rudi wiki hii / Back to this week|Excel|JPG'));
// a table search repaints the card from HEAD: the buttons are alive after it
const q11 = await page.evaluate(() => !!document.querySelector('#tblQ'));
if (q11) { await page.fill('#tblQ', 'CUSTOMER'); await page.waitForTimeout(500); }
const x3 = await sheetOf(await press(page, 'xls'));
check('11 after a table search repainted the card, Excel still downloads the same week', q11 && JSON.stringify(sheetRows(x3.text)) === JSON.stringify(wantSheet(gLast)) && x3.text.includes('week of ' + LAST), x3.name);
if (q11) { await page.fill('#tblQ', ''); await page.waitForTimeout(300); }
// the picture
const cardBox = await page.evaluate(() => { const r = document.getElementById('lgGrand').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
const jdl = await press(page, 'jpg');
const jraw = fs.readFileSync(await jdl.path()), jsz = jpegSize(jraw);
check('11 JPG: a real JPEG picture, named for the screen and the day', jraw[0] === 0xFF && jraw[1] === 0xD8 && jraw[2] === 0xFF && /^legal-\d{4}-\d\d-\d\d\.jpg$/.test(jdl.suggestedFilename()), jdl.suggestedFilename() + ' ' + jraw.length + ' bytes');
check('11 JPG: at least as wide and as tall as the card on the screen (all of the table, none cut)', !!jsz && jsz.w >= cardBox.w && jsz.h >= cardBox.h, JSON.stringify([jsz, cardBox]));
if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); fs.writeFileSync(path.join(process.env.SHOTS, 'grand-card-past-week.jpg'), jraw); }
await page.close();
// where db/RUN-ME-089 is not run: empty cells in the sheet, never noughts, and the file named
page = await open('notRun');
const xo = await sheetOf(await press(page, 'xls'));
const wantOff = wantSheet(gOff);
check('11 not run: the calls and grand cells are EMPTY in the sheet, the notices side is read', JSON.stringify(sheetRows(xo.text)) === JSON.stringify(wantOff) && sheetRows(xo.text).every(r => r[3] === '' && r[5] === '') && sheetRows(xo.text).some(r => r[1] === '300'), JSON.stringify(sheetRows(xo.text)).slice(0, 300));
check('11 not run: the sheet names the file', /<p>⚠ [^<]*RUN-ME-089/.test(xo.text));
await page.close();

// --- 12. the dashboard's Legal widget includes call recovery (Part 151)
page = await open('run', 'dashboard');
await page.waitForSelector('#lgWkCard', { timeout: 10000 }).catch(() => {});
const dRes = await portalApi(db, USER, 'dashboardFull', {}), dG = dRes.legal.grand, dT = dG.total;
const wkRes = await portalApi(db, USER, 'legalRecoveries', { period: 'week', weekOf: '' }), wkG = wkRes.legal.grand.total;
const cardOf = pg => pg.evaluate(() => ({ title: (document.querySelector('#lgWkCard .l') || {}).textContent || '', head: (document.getElementById('lgRecW') || {}).textContent || '', sub: (document.getElementById('lgRecWS') || {}).textContent || '' }));
let c12 = await cardOf(page);
check('12 the dashboard\'s server total is the Legal tab\'s for the week (one computation), with 45,300 of today and 6,300 of the week', JSON.stringify(dT) === JSON.stringify(wkG) && dT.recovered === 6300 && dT.nRec === 300 && dT.cRec === 6000 && dT.tRecovered === 6300, JSON.stringify([dT, wkG]));
check('12 the card says it is notices + calls', /notisi \+ simu \/ notices \+ calls/.test(c12.title), c12.title);
check('12 its headline is today\'s notices + calls, the server\'s figure', c12.head.trim() === fmt(dT.tRecovered), JSON.stringify(c12));
check('12 the week beneath it is the grand figure with its two parts', c12.sub.includes('TZS ' + fmt(dT.recovered) + ' (' + Math.round(dT.pct) + '%)') && c12.sub.includes('notisi / notices ' + fmt(dT.nRec) + ' + simu / calls ' + fmt(dT.cRec)), c12.sub);
check('12 there is ONE Legal card, and no grand card (that is the tab\'s)', (await count(page, '#lgWkCard')) === 1 && (await count(page, '#lgGrand')) === 0);
// the tap: the list
if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await (await page.$('#lgWkCard')).screenshot({ path: path.join(process.env.SHOTS, 'dashboard-legal-card.png') }); }
await page.click('#lgWkCard');
await page.waitForSelector('#drawer #lgRec', { timeout: 10000 }).catch(() => {});
if (process.env.SHOTS) await (await page.$('#drawer')).screenshot({ path: path.join(process.env.SHOTS, 'dashboard-legal-list.png') });
const tiles = await page.evaluate(() => [...document.querySelectorAll('#drawer .kpis .kpi')].map(k => [k.querySelector('.l').textContent, k.querySelector('.v').textContent, (k.querySelector('.s') || {}).textContent || '']));
check('12 the list opens with a SUMMARY: notices, calls and the two together, equal to the server\'s total', JSON.stringify(tiles.map(t => [t[0], t[1]])) === JSON.stringify([['Notisi / Notices', fmt(wkG.nRec)], ['Simu / Calls', fmt(wkG.cRec)], ['Jumla / Grand', fmt(wkG.recovered)]]), JSON.stringify(tiles));
check('12 each figure says what it is a percentage of', tiles.every(t => /% ya \/ of /.test(t[2])), JSON.stringify(tiles.map(t => t[2])));
check('12 the summary says how the two are added (a noticed customer once) and what was left out', /haikuhesabiwa mara ya pili/.test(await text(page, '#drawer')) && /customer-days/.test(await text(page, '#drawer')));
const phRows = await listOf('');
const bd = await page.evaluate(() => ({ rec: !!document.getElementById('lgRec'), ph: !!document.getElementById('lgPh'),
  recRows: [...document.querySelectorAll('#lgRec tbody tr:not(.totrow)')].length, phRows: [...document.querySelectorAll('#lgPh tbody tr:not(.totrow)')].length,
  order: [...document.querySelectorAll('#drawer .card')].map(c => c.id) }));
check('12 under the payments recorded against notices come the DATA ROWS of recovery by phone', bd.rec && bd.ph && JSON.stringify(bd.order) === JSON.stringify(['lgRec', 'lgPh']), JSON.stringify(bd));
check('12 the phone board has every line the Legal tab\'s phone list has', bd.phRows === phRows.length && bd.phRows > 0, bd.phRows + ' of ' + phRows.length);
check('12 its total row adds up to the phone card\'s own figure', await page.evaluate(() => { const t = document.querySelector('#lgPh tr.totrow'); return t ? t.textContent : ''; }).then(tx => tx.includes(fmt(wkRes.legal.phone.recovered))), wkRes.legal.phone.recovered + '');
check('12 a customer name that is markup is drawn as text, nothing runs', (await page.evaluate(() => window.__pwned)) === undefined && /<img src=x/.test(await text(page, '#lgPh')));
// ONE search for both boards
await page.fill('#lgRecQ', 'CUSTOMER 500'); await page.waitForTimeout(300);
const found = await page.evaluate(() => ({ rec: [...document.querySelectorAll('#lgRec tbody tr:not(.totrow)')].length, ph: [...document.querySelectorAll('#lgPh tbody tr:not(.totrow)')].map(tr => tr.textContent) }));
check('12 one search box filters both boards: customer 500 is on the phone board alone', found.ph.length === 1 && /CUSTOMER 500/.test(found.ph[0]) && found.rec === 0, JSON.stringify(found).slice(0, 200));
await page.fill('#lgRecQ', ''); await page.waitForTimeout(300);
// both boards download
const phX = await sheetOf(await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#lgPh [data-xls]')]).then(r => r[0]));
check('12 the phone board\'s Excel downloads, with its week in the title', /Recovery-by-phone/.test(phX.name) && phX.text.includes(THIS) && /CUSTOMER 500/.test(phX.text), phX.name);
const recX = await sheetOf(await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#lgRec [data-xls]')]).then(r => r[0]));
check('12 and so does the payments board\'s', /Payments-recorded-against-notices/.test(recX.name), recX.name);
// last week through the card's own arrows (the drawer closed first)
await page.click('#drawer .dx'); await page.waitForTimeout(300);
await page.click('#lgWkCard [data-lgwk="-1"]');
check('12 the card steps back a week', await waitWeek(page, LAST));
c12 = await cardOf(page);
const lastG = (await portalApi(db, USER, 'legalRecoveries', { period: 'week', weekOf: LAST })).legal.grand.total;
check('12 last week\'s card: the week\'s grand figure is the headline, with its parts', /past week · notisi \+ simu/.test(c12.title) && c12.head.includes(fmt(lastG.recovered)) && c12.sub.includes('notisi / notices ' + fmt(lastG.nRec) + ' + simu / calls ' + fmt(lastG.cRec)), JSON.stringify(c12));
await page.close();
// the Legal TAB's notices card is not changed: it opens the notices list alone
page = await open('run');
await page.click('#lgWkCard'); await page.waitForSelector('#drawer #lgRec', { timeout: 10000 }).catch(() => {});
check('12 the Legal tab\'s notices card still opens the payments list alone: no summary tiles, no phone board', (await count(page, '#drawer #lgRec')) === 1 && (await count(page, '#drawer .kpis')) === 0 && (await count(page, '#drawer #lgPh')) === 0);
check('12 and the tab\'s card is still the notices figure', (await text(page, '#lgRecW')).trim() === fmt(dnRes.legal.recovered) || /^\d+% · /.test((await text(page, '#lgRecW')).trim()), await text(page, '#lgRecW'));
await page.close();
// where db/RUN-ME-089 is not run: the card and the list say the calls are not included
page = await open('notRun', 'dashboard');
await page.waitForSelector('#lgWkCard', { timeout: 10000 }).catch(() => {});
c12 = await cardOf(page);
check('12 not run: the card is the notices alone and says the calls are not included', /simu hazijajumuishwa \/ calls not included/.test(c12.sub) && !/notisi \+ simu/.test(c12.title), JSON.stringify(c12));
await page.click('#lgWkCard'); await page.waitForSelector('#drawer #lgRec', { timeout: 10000 }).catch(() => {});
check('12 not run: the list names the file and has no phone board; the calls and grand tiles are dashes', /RUN-ME-089/.test(await text(page, '#drawer')) && (await count(page, '#drawer #lgPh')) === 0
  && JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#drawer .kpis .kpi .v')].map(v => v.textContent))) === JSON.stringify([fmt(300), '—', '—']));
await page.close();
page = await open('failing', 'dashboard');
await page.waitForSelector('#lgWkCard', { timeout: 10000 }).catch(() => {});
c12 = await cardOf(page);
check('12 a read that failed: the card says the calls are not included, and the dashboard is up', /calls not included/.test(c12.sub) && (await count(page, '#lgWkCard')) === 1, JSON.stringify(c12));
await page.click('#lgWkCard'); await page.waitForSelector('#drawer #lgRec', { timeout: 10000 }).catch(() => {});
check('12 a read that failed: the list says so and does not blame the file', /could not be read just now/.test(await text(page, '#drawer')) && !/RUN-ME-089/.test(await text(page, '#drawer')));
await page.close();
} catch (e) { fail.push('the check stopped: ' + String((e && e.message) || e).split('\n')[0].slice(0, 240)); }

check('no page error in any world', !errs.length, errs.slice(0, 3).join(' | '));
await browser.close(); srv.close(); console.warn = warn;
for (const f of fail) console.log('FAIL  ' + f);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
