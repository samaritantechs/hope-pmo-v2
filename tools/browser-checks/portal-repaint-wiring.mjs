/* A REPAINT OF A SCREEN MUST LEAVE ITS BUTTONS AND BOXES ALIVE. The REAL public/app.html and public/mod/*.js in a real browser,
   talking to the REAL portalApi over the repository's own fake database (not a stub that answers what the page hopes to hear).

     found by the chat that built the Legal week arrows (#775), 23 Nov 2026, in a real browser: on the Legal tab type ONE letter in
     the search box above the register and "+ New demand notice" and "Recovered today" stop answering until the tab is opened again.

   paintNow_() rebuilds #view whole, head included, so every element a screen puts in HEAD is a new element after a repaint. wireBar()
   was re-run by every paint; wireForms() -- the head's own buttons and boxes -- only by drawView_(), once. Nine screens were hit
   (Legal, Teams & Staff, PMO deductions, Complaints, Restructuring, HR staff, the Imprest request form, Imprest approval, Adjust), and
   a keystroke was not the only trigger: the page asks for its hints 2.5 seconds after sign-in and REPAINTS the list on screen when they
   arrive (tipsStart), so the same buttons went dead about three seconds after the portal opened, with nobody touching anything.
   The cure (wireForms() run by every paint) was merged as #776 (Part 129) while this check was being written; this is its proof on
   every screen that loads, and it found what #776 left: the letterhead links on the Legal tab call settingForm(), which lives in the
   admin module, and threw "settingForm is not defined" in any session that had not opened Settings or Teams & Staff first. Part 133.

   What it proves:

     1. every screen that loads here, one keystroke in its table search and then a sort: the handlers on its head are the ones it
        had before (a map of every element outside the table that carries an onclick, an onchange, an oninput...), and the nine
        named screens were each really compared (no vacuous pass);
     2. the page's own repaint, three seconds after sign-in, on the Legal tab, with nobody touching it;
     3. after a repaint the buttons DO their work, on each of the nine screens (the drawer that opens, the live total, the
        chosen rate, the hint under the adjustment's target...), and the Legal card is dressed again (role, tab stop, cursor, title);
        a letterhead link, in a session that has not loaded the admin module, loads it and opens its setting;
     4. a repaint STARTS nothing: one keystroke makes no request, no timer, no listener on the document or the window, and runs
        wireForms() exactly once; every paint, a first draw or a repaint, wires exactly once (never twice, never none);
     5. typing is not disturbed: three keys in a row land in the box, which keeps its focus and its caret;
     6. what it costs: on a table of 3,000 rows wireForms() is a small fraction of the repaint it joins.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-repaint-wiring.mjs

   APP_FILE runs it against another copy of app.html (the page as it was: git show 0e126a4:public/app.html > /tmp/old.html fails
   32 of its 52 points; #776 as merged, BUILD 2026-11-23-c, fails the 3 of the letterhead links; this change passes all 52), CHROME
   overrides the browser path. Exit code 0 = everything passed. About a minute. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
const APP_FILE = process.env.APP_FILE || path.join(ROOT, 'public/app.html');
const { fakeDb } = await import(path.join(ROOT, 'test/fake-db.mjs'));
const { portalApi } = await import(path.join(ROOT, 'api/_lib/portal-core.js'));
const APP = fs.readFileSync(APP_FILE, 'utf8');

const eat = ms => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
const TODAY = eat(Date.now());
const NAMED = ['legal', 'teams', 'deduct', 'complaints', 'restructure', 'advstaff', 'impreq', 'impappr', 'adjust'];
const TABS = ['dashboard', 'adjust', 'settings', 'audit', 'officerloc', 'teams', 'legal', 'deduct', 'impreq', 'impappr', 'imprep', 'advreq', 'advappr', 'advrep',
  'advstaff', 'leavereq', 'leaveappr', 'leaverep', 'fraud', 'devlock', 'devunlock', 'complaints', 'restructure'];

const rpc = {
  notice_payments: (store, args) => args.p_refs.map((ref, i) => ({ ref, since: args.p_dates[i], paid: 0, n: 0, last_paid: null, n_phone: 0 })),
  fold_notice_payments: () => 0,
};
const db = fakeDb({
  demand_notices: [1, 2, 3].map(i => ({ id: 'n' + i, ref: String(500 + i), team: 'KONGOWE', full_name: ['ASHA ONE', 'ASHA TWO', 'JUMA THREE'][i - 1], contact: '071400055' + i,
    notice_id: 'HMCL/A/0' + i, notice_date: TODAY, arrears_at_notice: 1000 * i, created_at: TODAY + 'T05:00:00Z' })),
  notice_payment_ledger: [],
  teams: [{ team: 'KONGOWE', team_code: 'C-K', zone: 'LAKE', gmo: 'GMO ONE', opm: 'OPM ONE', manager: 'MGR ONE' }, { team: 'MBAGALA', team_code: 'C-M', zone: 'DAR', gmo: 'GMO TWO' }],
  access_codes: [{ code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: [] }, { code: 'GMO1', name: 'GMO ONE', role: 'GMO', teams: ['KONGOWE'], tabs: ['dashboard'] }],
  settings: [], call_users: [{ user_id: 'u1', name: 'OFFICER A', team: 'KONGOWE', phone: '0714000001' }], roles: [{ role: 'GMO', tabs: ['dashboard'] }], audit_log: [], defaulter_snapshots: [],
  pmo_deductions: [{ id: 'd1', staff: 'STAFF ONE', amount: 1000, reporter: 'REP', submitted_at: TODAY + 'T05:00:00Z' }],
  adjustments: [{ id: 'a1', adj_date: TODAY, target: 'expected-current', team: 'KONGOWE', amount: -500, reason: 'x' }],
  complaints: [{ id: 'c1', ref: '1', team: 'KONGOWE', category: 'X', status: 'Open', created_at: TODAY + 'T05:00:00Z' }],
  restructures: [], imprest_requests: [], imprest_roles: [{ role: 'ADMIN', accommodation_per_day: 50000 }], advance_requests: [], leave_requests: [], hints: [],
  staff_registry: [{ staff_id: 'S1', name: 'STAFF ONE', role: 'Field Officer - KONGOWE', zone: 'LAKE', status: 'Active' }],
}, { rpc });
const USER = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: TABS };
const calls = [];                       // [fn, args] for everything the page asked, in order
const hold = {};                        // fn -> ms the server holds that answer for

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname.startsWith('/app') || u.pathname === '/dashboard') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return; }
  if (u.pathname.startsWith('/mod/')) {
    const f = process.env.MOD_DIR ? path.join(process.env.MOD_DIR, path.basename(u.pathname.split('?')[0])) : path.join(ROOT, 'public', u.pathname.split('?')[0]);   // MOD_DIR: the modules of the page APP_FILE names
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(f)); return; }
  }
  if (u.pathname === '/api/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, build: null })); return; }
  if (u.pathname === '/api/portal') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', async () => {
      const { fn, args } = JSON.parse(b || '{}');
      calls.push([fn, args || {}]);
      let out;
      try { out = await portalApi(db, USER, fn, args || {}); }
      catch (e) { res.writeHead(e.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) })); return; }
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...(out && typeof out === 'object' && !Array.isArray(out) ? out : { rows: out }), workspace: 'hopepmo' })); }, hold[fn] || 0);
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const ok = [], fail = [], errs = [];
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (cond || !extra ? '' : ' -- ' + extra));
const BENIGN = /favicon|status of 404|ERR_FAILED|brand|status of 500|Failed to load resource/;
const UI = { presentSeconds: 30, refreshSeconds: 600, hintIntervalSeconds: 3600, hintLifetimeSeconds: 5 };
const ME = { name: 'THE ADMIN', role: 'ADMIN', teams: null, teamCount: null, tabs: TABS, can: { dashboard: true, upload: true, admin: true }, ui: UI };

/* What a screen's head has wired: every element OUTSIDE the table card that carries a handler property (inline attributes
   count too: they are what a repaint keeps), keyed by what it is, with how many there are. */
const MAP = `(function(){
  var out = {}, els = document.querySelectorAll('#view *'), props = ['onclick','onchange','oninput','onkeydown','onkeyup','onfocus'];
  for (var i = 0; i < els.length; i++) {
    var e = els[i]; if (e.closest('#mainCard')) continue;
    var h = props.filter(function(p){ return typeof e[p] === 'function'; }); if (!h.length) continue;
    var at = Array.prototype.filter.call(e.attributes, function(a){ return a.name !== 'style' && a.name !== 'class' && !/^on/.test(a.name); })
      .map(function(a){ return a.name + '=' + String(a.value).slice(0, 30); }).join(',');
    var k = e.tagName + '|' + at + '|' + (e.textContent || '').slice(0, 14) + '|' + h.join('+');
    out[k] = (out[k] || 0) + 1;
  }
  return out; })()`;
const lostOf = (m1, m2) => Object.keys(m1).filter(k => (m2[k] || 0) < m1[k]).map(k => k.split('|').slice(0, 2).join(' ') + (m1[k] > 1 ? ' x' + (m1[k] - (m2[k] || 0)) : ''));

async function open(view, { wait = 450, counters = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(6000);
  await page.goto(base + '/');
  if (counters) await page.evaluate(COUNTERS);
  await page.evaluate(m => { S.code = 'ADM'; start(m); }, ME);
  await page.waitForTimeout(300);
  if (view) await goto(page, view, wait);
  return page;
}
async function goto(page, view, wait = 450) {
  await page.evaluate(async v => { var m = modOf_(v); if (m) await modLoad_(m); go(v); }, view);
  await page.waitForFunction(() => !document.querySelector('#view .sk'), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(wait);
}
const loaded = page => page.evaluate(() => !document.querySelector('#view .msg.bad') && !document.querySelector('#view .sk'));
const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!(e && e.offsetParent); }, sel);
// a real press: a section folded shut is opened first, as a person would, and then the mouse goes to the element
const press = async (page, sel) => {
  await page.evaluate(s => { for (let d = (document.querySelector(s) || {}).closest ? document.querySelector(s).closest('details') : null; d; d = d.parentElement && d.parentElement.closest('details')) d.open = true; }, sel);
  await page.click(sel, { timeout: 3000 });
  await page.waitForTimeout(350);
};
// a real keyboard: click into the box, then type (a box that keeps no focus after a keystroke would lose the second key)
const type = async (page, text) => {
  try { await page.click('#tblQ', { timeout: 1500 }); }
  catch (e) { await page.evaluate(() => { const b = document.getElementById('tblQ'); b.scrollIntoView({ block: 'center' }); b.focus(); }); }   // a box another element sits over: the keyboard still reaches it
  await page.keyboard.type(text); await page.waitForTimeout(250);
};
const drawerOpen = page => page.evaluate(() => getComputedStyle(document.getElementById('drawerBg')).display !== 'none');
const drawerText = page => page.evaluate(() => (document.getElementById('drawer') || {}).textContent || '');
const closeDrawer = async page => { await page.evaluate(() => closeDrawer()); await page.waitForTimeout(150); };
const opens = async (page, sel, word, name) => {
  await press(page, sel);
  const t = await drawerText(page);
  check(name, (await drawerOpen(page)) && t.indexOf(word) >= 0, 'drawer ' + ((await drawerOpen(page)) ? 'opened with: ' + t.slice(0, 80) : 'did not open'));
  await closeDrawer(page);
};
const COUNTERS = () => {
  window.__c = { fetch: 0, xhr: 0, timeout: 0, interval: 0, docL: 0, winL: 0, paintNow: 0, paintHead: 0, wireForms: 0, wireBar: 0 };
  const f = window.fetch; window.fetch = function () { __c.fetch++; return f.apply(this, arguments); };
  const xs = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function () { __c.xhr++; return xs.apply(this, arguments); };
  const st = window.setTimeout; window.setTimeout = function () { __c.timeout++; return st.apply(this, arguments); };
  const si = window.setInterval; window.setInterval = function () { __c.interval++; return si.apply(this, arguments); };
  const da = document.addEventListener; document.addEventListener = function () { __c.docL++; return da.apply(this, arguments); };
  const wa = window.addEventListener; window.addEventListener = function () { __c.winL++; return wa.apply(this, arguments); };
  const pn = window.paintNow_; window.paintNow_ = function () { __c.paintNow++; return pn.apply(this, arguments); };
  const ph = window.paintHeadOnly; window.paintHeadOnly = function () { __c.paintHead++; return ph.apply(this, arguments); };
  const wf = window.wireForms; window.wireForms = function () { __c.wireForms++; return wf.apply(this, arguments); };
  const wb = window.wireBar; window.wireBar = function () { __c.wireBar++; return wb.apply(this, arguments); };
};
const counts = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__c)));
const zero = page => page.evaluate(() => { for (const k in __c) __c[k] = 0; });

try {
  // --- 1. every screen that loads: one keystroke in the table search, then a sort; the head keeps what it had
  let page = await open();
  await page.evaluate(async () => { const n = {}; Object.keys(MOD_OF).forEach(k => { n[MOD_OF[k]] = 1; }); await Promise.all(Object.keys(n).map(m => modLoad_(m))); });
  const views = (await page.evaluate(() => Object.keys(VIEWS))).filter(v => !['present', 'upload', 'noaccess'].includes(v) && !/^ln_/.test(v));
  const seen = {}, broken = [];
  for (const v of views) {
    await goto(page, v, 400);
    if (!(await loaded(page)) || !(await page.evaluate(() => !!document.getElementById('tblQ')))) continue;
    const m0 = await page.evaluate(MAP);
    const wired = Object.keys(m0).length;
    if (process.env.DEBUG_VIEWS) console.log('  survey', v);
    if (await visible(page, '#tblQ')) await type(page, 'a'); else await page.evaluate(() => { const b = document.getElementById('tblQ'); b.value = 'a'; b.oninput(); });
    const m1 = await page.evaluate(MAP);
    const lostSearch = lostOf(m0, m1);
    await page.evaluate(() => { const th = document.querySelector('#mainCard thead th:nth-child(2)') || document.querySelector('#mainCard thead th'); if (th) th.click(); });
    await page.waitForTimeout(150);
    const lostSort = lostOf(m0, await page.evaluate(MAP));
    seen[v] = wired;
    if (lostSearch.length || lostSort.length) broken.push(v + ': ' + lostSearch.concat(lostSort).slice(0, 3).join('; '));
  }
  check('every screen that loads here was compared (' + Object.keys(seen).length + ' of ' + views.length + ')', Object.keys(seen).length >= 30, 'only ' + Object.keys(seen).length);
  check('the nine screens the defect reached were each really compared (loaded, a table search, something wired on the head)', NAMED.every(v => seen[v] > 0),
    NAMED.filter(v => !(seen[v] > 0)).join(', ') + ' not compared');
  check('after one keystroke and after a sort NO screen has lost a handler from its head', broken.length === 0, broken.join(' | '));
  await page.close();

  // --- 2. the page's own repaint: the hints it asks for 2.5 s after sign-in repaint the list on screen, nobody touching it
  page = await open(null, { counters: true });                       // counted from before sign-in, so the count holds whatever the machine's speed
  await goto(page, 'legal', 300);
  const aliveAtFirst = await page.evaluate(() => typeof document.getElementById('newNotice').onclick);
  await page.waitForFunction(() => window.__c.paintNow >= 2, null, { timeout: 9000 }).catch(() => {});
  await page.waitForTimeout(400);
  const c2 = await counts(page);
  check('the page repainted the Legal tab by itself (a draw, and the hints arriving about three seconds after sign-in)', c2.paintNow >= 2, JSON.stringify(c2));
  check('and "+ New demand notice" was alive on the first draw and is alive after that repaint, nobody having touched the page', aliveAtFirst === 'function' && await page.evaluate(() => typeof document.getElementById('newNotice').onclick) === 'function');
  check('with every paint wired exactly once (the bar and the forms)', c2.wireForms === c2.paintNow + c2.paintHead && c2.wireBar === c2.wireForms, JSON.stringify(c2));
  await page.close();

  // --- 3. after a repaint the buttons do their work, on each screen
  // Legal
  page = await open('legal');
  check('Legal: in a session that has not opened Settings or Teams & Staff, a letterhead link loads the admin module it needs and opens its setting',
    !(await page.evaluate(() => typeof window.settingForm === 'function')) && await (async () => { await press(page, '#lgWho'); await page.waitForTimeout(500);
      return (await drawerOpen(page)) && /Set a value/.test(await drawerText(page)) && typeof (await page.evaluate(() => typeof window.settingForm)) === 'string'; })());
  await closeDrawer(page);
  await type(page, 'ASH');
  check('Legal: three keys typed in a row land in the table search, which keeps its focus and its caret', await page.evaluate(() => { const b = document.getElementById('tblQ'); return document.activeElement === b && b.value === 'ASH' && b.selectionStart === 3; }));
  check('Legal: and the register narrowed to the two customers called ASHA', /2 \/ 3/.test(await page.evaluate(() => document.querySelector('#mainCard .card-h .sub').textContent)));
  await opens(page, '#newNotice', 'New demand notice', 'Legal: after a repaint "+ New demand notice" opens the form');
  await opens(page, '#lgRecT', 'Recovered today', 'Legal: and "Recovered today" opens its list');
  check('Legal: that card is dressed again (a button, a tab stop, the pointer, its title)', await page.evaluate(() => { const c = document.getElementById('lgRecT').closest('.kpi');
    return c.getAttribute('role') === 'button' && c.getAttribute('tabindex') === '0' && c.style.cursor === 'pointer' && /Tap for the list/.test(c.title); }));
  await opens(page, '#lgWho', 'Set a value', 'Legal: and a letterhead link (the signatory) opens its setting');
  await page.close();
  // Teams & Staff
  page = await open('teams');
  await type(page, 'a');
  await opens(page, '#newTeam', 'New team', 'Teams & Staff: after a repaint "+ New team" opens the form');
  await opens(page, '#newAgent', 'New agent', 'Teams & Staff: "+ Agent" opens its form');
  // "remove the wafanyakazi / staff by person at teams and staff" (the owner, 24 Nov 2026, Part 148): the card, its buttons and its rows are gone, before and after a repaint
  check('Teams & Staff: the staff-by-person card is gone (no card, no "+ New" button, no row of a person), after a repaint too', await page.evaluate(() =>
    !document.getElementById('staffCard') && !document.getElementById('newStaff') && !document.getElementById('staffXl') && !document.querySelector('[data-staff]') && !/by person/i.test(document.getElementById('view').textContent)));
  await page.close();
  // PMO deductions, Complaints, Restructuring, HR staff
  for (const [view, sel, word, name] of [['deduct', '#newDeduction', 'New PMO deduction case', 'PMO deductions: "+ New case" opens the form'],
      ['deduct', '#dedReport', 'PMO deduction report', 'PMO deductions: "Report" opens the report'],
      ['complaints', '#newComplaint', 'Register a complaint', 'Complaints: "+ New complaint" opens the form'],
      ['restructure', '#newRestructure', 'New restructuring offer', 'Restructuring: "+ New offer" opens the lookup'],
      ['advstaff', '#newAdvStaff', 'New staff', 'HR staff (advance): "+ New staff" opens the form']]) {
    page = await open(view);
    await type(page, 'a');
    await opens(page, sel, word, name.replace(': ', ': after a repaint '));
    await page.close();
  }
  // The Imprest request form: the live total and Send
  page = await open('impreq');
  const firstDraw = await page.evaluate(() => ({ send: document.getElementById('imqSend').disabled, why: document.getElementById('imqWhy').style.display, said: document.getElementById('imqWhy').textContent.length > 0 }));
  await type(page, 'a');
  const afterRepaint = await page.evaluate(() => ({ send: document.getElementById('imqSend').disabled, why: document.getElementById('imqWhy').style.display, said: document.getElementById('imqWhy').textContent.length > 0 }));
  check('Imprest request: a repaint leaves the form in the state a first draw gives it (Send closed, the reason said under it)', firstDraw.send === true && firstDraw.said && JSON.stringify(afterRepaint) === JSON.stringify(firstDraw), JSON.stringify([firstDraw, afterRepaint]));
  await page.fill('#imqDays', '3');
  await page.waitForTimeout(150);
  const tot = await page.evaluate(() => ({ total: document.getElementById('imqTotal').textContent, accom: document.getElementById('imqAccom').value, send: document.getElementById('imqSend').disabled }));
  check('Imprest request: after a repaint three nights at the role\'s rate make a live total of 150,000 and open Send', tot.total === '150,000' && tot.accom === '150,000' && tot.send === false, JSON.stringify(tot));
  calls.length = 0;
  await press(page, '#imqSend');
  check('Imprest request: and Send asks the server', calls.some(c => c[0] === 'imprestRequest'), JSON.stringify(calls.map(c => c[0])));
  await page.close();
  // Settings: a screen with NO table, whose head alone is drawn (paintHeadOnly) -- the other road to the same wiring
  page = await open('settings');
  check('Settings (no table, the head alone): opening it wires its buttons', !(await page.evaluate(() => !!document.getElementById('tblQ'))));
  await opens(page, '#newSetting', 'Set a value', 'Settings (no table, the head alone): "+ Set a value" opens its form');
  await page.close();
  // Imprest approval: the state chips and the rate editor
  page = await open('impappr');
  await type(page, 'a');
  calls.length = 0;
  await press(page, '[data-impq="pending"]');
  check('Imprest approval: after a repaint a state chip asks the server for that state', calls.some(c => c[0] === 'imprestQueue' && c[1].state === 'pending'), JSON.stringify(calls.map(c => [c[0], c[1].state])));
  await type(page, 'a');
  await press(page, '[data-rle="ADMIN"]');
  check('Imprest approval: and the rate editor\'s Edit button fills the role and its rate into the form', await page.evaluate(() => document.getElementById('rlRole').value === 'ADMIN' && document.getElementById('rlRate').value === '50000'));
  await page.close();
  // Adjust: the hint under the target
  page = await open('adjust');
  await type(page, 'a');
  const hint0 = await page.evaluate(() => document.getElementById('adjTargetHint').textContent);
  await page.fill('#adjAmt', '-5');
  const hint1 = await page.evaluate(() => document.getElementById('adjTargetHint').textContent);
  check('Adjust: after a repaint the hint under the target is there and follows the amount\'s sign', /UP/.test(hint0) && /DOWN/.test(hint1), JSON.stringify([hint0, hint1]));
  calls.length = 0;
  await press(page, '#adjSave');
  check('Adjust: and Save asks the server', calls.some(c => c[0] === 'adjustmentRecord'), JSON.stringify(calls.map(c => c[0])));
  await page.close();

  // --- 4. a repaint starts nothing, and every paint wires exactly once
  for (const v of NAMED) {
    page = await open();
    await page.evaluate(COUNTERS);
    await goto(page, v, 400);
    await zero(page);
    await type(page, 'a');
    const c = await counts(page);
    check(v + ': one keystroke runs wireForms once and starts nothing (no request, timer, or document or window listener)',
      c.wireForms === 1 && c.paintNow === 1 && !c.fetch && !c.xhr && !c.timeout && !c.interval && !c.docL && !c.winL, JSON.stringify(c));
    await zero(page);
    await page.evaluate(() => go(S.view));
    await page.waitForTimeout(500);
    const d = await counts(page);
    check(v + ': a draw (opening the screen again) wires exactly once per paint, never twice', d.wireForms === d.paintNow + d.paintHead && d.wireBar === d.wireForms && d.wireForms >= 1, JSON.stringify(d));
    await page.close();
  }

  // the screen with no table: every paint of it wires too (paintHeadOnly), the first draw and a quiet refresh alike
  page = await open();
  await page.evaluate(COUNTERS);
  await goto(page, 'settings', 400);
  await page.evaluate(() => go(S.view));
  await page.waitForTimeout(600);
  const hc = await counts(page);
  check('settings: a screen with no table draws its head alone and wires it (the bar and the forms) exactly once for each draw', hc.paintHead >= 1 && hc.paintNow === 0 && hc.wireForms === hc.paintHead && hc.wireBar === hc.paintHead, JSON.stringify(hc));
  await page.close();

  // --- 6. what it costs: wireForms() against the repaint it joins, on a table of 3,000 rows
  page = await open('legal');
  const cost = await page.evaluate(() => {
    const rows = []; for (let i = 0; i < 3000; i++) rows.push({ notice_id: 'HMCL/X/' + i, notice_date: '2026-11-0' + (1 + i % 9), full_name: 'CUSTOMER NUMBER ' + i, ref: String(100000 + i), team: 'T' + (i % 40), contact: '0714' + (100000 + i), arrears_at_notice: 1000 + i, amount: 5000 + i, state: 'x', fine: 100, total: 1100 });
    S.rows = rows; S.q = ''; paint(true);
    const med = (f, n) => { const a = []; for (let k = 0; k < n; k++) { const t = performance.now(); f(); a.push(performance.now() - t); } a.sort((x, y) => x - y); return a[a.length >> 1]; };
    return { nodes: document.getElementById('view').getElementsByTagName('*').length, paint: med(() => paint(true), 7), wire: med(() => wireForms(), 40) };
  });
  check('cost: wireForms() on 3,000 rows (' + cost.nodes + ' elements) is ' + cost.wire.toFixed(2) + ' ms against a repaint of ' + cost.paint.toFixed(0) + ' ms: under 5% of it, and under 25 ms', cost.wire < cost.paint * 0.05 && cost.wire < 25, JSON.stringify(cost));
  await page.close();
} catch (e) { fail.push('the run stopped: ' + String((e && e.message) || e).split('\n')[0].slice(0, 220)); }

check('no script error anywhere', errs.length === 0, errs.join(' | ').slice(0, 400));
await browser.close(); srv.close();
for (const f of fail) console.log('FAIL', f);
for (const o of ok) console.log('PASS', o);
console.log('\n' + ok.length + ' points pass' + (fail.length ? ', ' + fail.length + ' FAIL' : ''));
process.exit(fail.length ? 1 : 0);
