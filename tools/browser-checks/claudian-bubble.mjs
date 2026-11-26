/* CLAUDIAN-PMO'S BUBBLE: the REAL public/app.html, public/call.html and public/mod/claudian.js in a real browser, talking to the REAL helper
   (api/_lib/claudian.js, with a fake provider that records what it is sent), the REAL portal API and the REAL call API, over the repository's
   own fake database.

     "Please add an Ai floating bubble in both calls and system UI - that one could drag anywhere to their screen's position ..."
     "In settings- give a switch button to switch it on or off ..." -- the owner, 25 Nov 2026 (handbook Part 156)

   What it proves:

     A. THE PORTAL: the module is asked for only after the late timer (7 seconds) and the server is asked for NOTHING until the bubble is
        tapped; the bubble is drawn inside the screen; a drag moves it, is clamped at the edges, opens nothing, and is kept (a fraction of the
        screen: it comes back in the same place after a reload and stays inside after the window is resized); the keyboard moves it too;
        a tap opens the panel and asks for the ready questions in the page's language; a ready question is answered; with the AI OFF there is no
        box to type in; with it ON a typed question goes out with the last exchange and the answer comes back as TEXT (a tag in an answer is
        shown, never run); the questions left today are counted down; a limit and a failed provider are shown as the amber hint, an account that
        is not allowed as the red line; the panel adds NO closing offer or question of its own; SW / EN flips the panel and not the page;
        Escape closes it and gives the focus back; a phone is given a sheet across the bottom, nothing overflows, and a finger drags the bubble;
        the dark page gets the dark panel; a module that cannot be fetched leaves no bubble and no error.
     B. SETTINGS: the card reads the server's state, one button flips the AI, the limits are saved (and a bad one is refused and said), a
        table search on the screen does not take the card's buttons away, and a code without the Settings tab never sees the card.
     C. HOPE CALLS: the module is asked for only after the late timer (8 seconds) and after the officer is in, the bubble speaks as the
        registered handset and the officer's own ready questions come back, and signing out takes the bubble away.
     D. THE KEPT CONVERSATION (handbook Part 167; A22 to A24 and C5): a person's lines are kept in their own browser under a mark of who they
        are (never the access code or the device id), drawn again after a reload with the server asked NOTHING, the panel opens on the latest
        question, a restored choice is a live button, another person (or a person the record is not made for) finds an empty panel and the
        record is deleted, a record over thirty days old or a damaged one is ignored, the last exchange rides to the model only while it is
        under thirty minutes old, the portal's Toka and the call app's sign-out forget it, and the one release address in an answer is a real
        link (the constant as its address) while every other address and every bit of markup stays text.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/claudian-bubble.mjs

   CHROME overrides the browser path; SHOTS=<dir> saves pictures. Exit code 0 = everything passed. Made-up people only. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
delete process.env.ANTHROPIC_API_KEY;
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
const SHOTS = process.env.SHOTS || '';
const { fakeDb } = await import(path.join(ROOT, 'test/fake-db.mjs'));
const { portalApi } = await import(path.join(ROOT, 'api/_lib/portal-core.js'));
const { callApi, userByDevice, pseudoUser } = await import(path.join(ROOT, 'api/_lib/call-core.js'));
const C = await import(path.join(ROOT, 'api/_lib/claudian.js'));
const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
const CALL = fs.readFileSync(path.join(ROOT, 'public/call.html'), 'utf8');
const MODULE = path.join(ROOT, 'public/mod/claudian.js');
const BUILD = (APP.match(/var BUILD = '([^']+)'/) || [])[1];
const CALL_BUILD = (CALL.match(/var CALL_BUILD = '([^']+)'/) || [])[1];
const NOW = Date.now();
const TODAY = new Date(NOW + 3 * 3600 * 1000).toISOString().slice(0, 10);

const ADMIN = { code: 'ADM', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['dashboard', 'settings'] };
const CLERK = { code: 'CLK', name: 'A CREDIT CLERK', role: 'CREDIT ANALYST', teams: ['KONGOWE'], tabs: ['dashboard', 'followup'] };
const USERS = { ADM: ADMIN, CLK: CLERK };

const db = fakeDb({
  teams: [{ team: 'KONGOWE', opm: null, recovery: null, gmo: null, manager: null, credit: null, expected: null, bike: null, team_code: 'KON123', zone: 'DAR' }],
  access_codes: [{ code: 'ADM', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['settings'] }, { code: 'CLK', name: 'A CREDIT CLERK', role: 'CREDIT ANALYST', teams: ['KONGOWE'], tabs: ['followup'] }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }],
  roles: [], audit_log: [], repayment_snapshots: [], defaulter_snapshots: [], followup_comments: [],
  followup_status: [{ ref: '555', team: 'KONGOWE', full_name: 'MDAIWA WA KARIBU', contact: '0714000555', guarantor_name: 'MDHAMINI', guarantor_contact: '0715000555', arrears: 900, rejesho: 100, status: 'Defaulter', fu_status: '', ds: '5-6', days_elapsed: 12, updated_at: TODAY + 'T05:00:00Z' }],
  loans: [], call_users: [], call_logs: [], received_payments: [], complaints: [], customer_locations: [], performance_records: [],
});
await callApi(db, 'api_callRegister', ['dF', 'JUMA ISSA', '', '', '0712999999', 'KON123'], NOW);
const setting = (k, v) => { const rows = db._dump('settings'); const r = rows.find(x => x.key === k); if (r) r.value = v; else rows.push({ key: k, value: v }); };
const settingRow = k => (db._dump('settings').find(r => r.key === k) || {}).value;
const warn = console.warn; console.warn = () => {};

/* The provider: records every request it is sent and answers what the world says. */
const asked = [];
const PROV = { text: 'Piga simu za portfolio kwa wateja wa leo.', fail: 0, delay: 0 };
const client = { messages: { create: async (req) => {
  asked.push(req);
  if (PROV.delay) await new Promise(r => setTimeout(r, PROV.delay));
  if (PROV.fail) throw Object.assign(new Error('provider said ' + PROV.fail), { status: PROV.fail });
  return { content: [{ type: 'text', text: PROV.text }], usage: { input_tokens: 40, output_tokens: 12 }, stop_reason: 'end_turn' };
} } };

/* What the server was asked for, by the pages: so "nothing until the bubble is tapped" is a count, not a hope. */
const seen = { module: [], claudian: [], modules404: false, force: 0, delayStatus: 0, delayAsk: 0, brand: false, delayBoot: 0, portal401: false, meRefuse: false, bootCalls: [] };
let DEVICE = 'dF';
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const REAL_PORTAL = new Set(['settings', 'accessCodes', 'officerAccounts', 'systemOpenGet', 'teams', 'claudianStatus', 'claudianSet', 'claudianTest', 'settingSet', 'storageUsage']);

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname === '/app') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return; }
  if (u.pathname === '/call') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(CALL); return; }
  if (u.pathname === '/mod/claudian.js') {
    seen.module.push(u.search);
    if (seen.modules404) { res.writeHead(404); res.end(''); return; }
    res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(MODULE)); return;
  }
  if (u.pathname === '/brand.js' && seen.brand) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(path.join(ROOT, 'public/brand.js'))); return; }
  if (u.pathname.startsWith('/mod/')) {
    const f = path.join(ROOT, 'public/mod', path.basename(u.pathname));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(f)); return; }
  }
  if (u.pathname === '/api/me') { if (seen.meRefuse) { send(res, 401, { ok: false, error: 'That code is not current.' }); return; } send(res, 200, { ok: true, build: null }); return; }
  if (u.pathname === '/api/portal') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', async () => {
      const { fn, args } = JSON.parse(b || '{}');
      let out;
      if (seen.portal401) { send(res, 401, { ok: false, error: 'Unknown code' }); return; }
      try { out = REAL_PORTAL.has(fn) ? await portalApi(db, ADMIN, fn, args || {}, NOW) : { rows: [] }; }
      catch (e) { send(res, e.status || 500, { ok: false, error: String((e && e.message) || e) }); return; }
      send(res, 200, { ok: true, ...out, workspace: 'hopepmo' });
    });
    return;
  }
  if (u.pathname === '/api/call') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', async () => {
      const { fn, args } = JSON.parse(b || '{}');
      let out;
      if (fn === 'api_callBoot') { seen.bootCalls.push(Date.now()); if (seen.delayBoot) await new Promise(r => setTimeout(r, seen.delayBoot)); }
      try { out = await callApi(db, fn, [DEVICE].concat((args || []).slice(1)), NOW); }
      catch (e) { out = { ok: false, error: String((e && e.message) || e) }; }
      send(res, 200, out == null ? { ok: true } : out);
    });
    return;
  }
  if (u.pathname === '/api/claudian') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', async () => {
      const body = JSON.parse(b || '{}');
      seen.claudian.push(body);
      if (seen.delayStatus && body.op === 'status') await new Promise(r => setTimeout(r, seen.delayStatus));
      if (seen.delayAsk && body.op === 'ask') await new Promise(r => setTimeout(r, seen.delayAsk));
      if (seen.force) { send(res, seen.force, { ok: false, error: 'forced ' + seen.force }); return; }
      try {
        let subject;
        if (body.device) {
          const cu = await userByDevice(db, DEVICE);                       // the page's own device id is replaced by the registered one, as call-search-card does
          if (!cu) { send(res, 401, { ok: false, error: 'This device is not registered.' }); return; }
          subject = C.callSubject(cu, pseudoUser(cu), DEVICE);
        } else {
          const user = USERS[body.code];
          if (!user) { send(res, 401, { ok: false, error: 'Unknown code' }); return; }
          subject = C.portalSubject(user);
        }
        const out = await C.claudianHandle(db, subject, body, { client, noGap: true, nowMs: NOW });
        send(res, 200, { ok: true, ...out });
      } catch (e) { send(res, e.status || 500, { ok: false, error: String((e && e.message) || e) }); }
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
const BENIGN = /favicon|status of 404|ERR_FAILED|Failed to fetch|boot failed|manifest|serviceWorker|sw\.js|status of 40\d|status of 500|fullscreen|Fullscreen|brand/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));


/** A part of the check that throws is a failure of that part, not the end of the run: the rest still tells what it can. */
const ONLY = process.env.ONLY || '';
async function section(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  try { await fn(); } catch (e) { fail.push(name + ' -- THREW: ' + String((e && e.message) || e).split('\n')[0]); }
}

/* The late timers (7 s in the portal, 8 s in HOPE Calls) are asked for as they are; the page is given 1.5 s instead, so the check does not sit and wait. */
const SPEED = (late) => {
  window.__late = [];
  const st = window.setTimeout;
  window.setTimeout = function (f, ms) { if (ms === 7000 || ms === 8000) { window.__late.push(ms); ms = late; } return st.apply(this, [f, ms].concat([].slice.call(arguments, 2))); };
};

async function portal(label, { code = 'ADM', lang = 'sw', viewport = { width: 1280, height: 800 }, touch = false, wait = true, store = null, tabs = null } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(label + ': ' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push(label + ' console: ' + m.text()); });
  page.setDefaultTimeout(6000);
  await page.addInitScript(SPEED, 1500);
  if (store) await page.addInitScript(s => { try { for (const k in s) localStorage.setItem(k, s[k]); } catch (e) {} }, store);
  await page.goto(base + '/');
  const me = { name: USERS[code].name, role: USERS[code].role, teams: USERS[code].teams, teamCount: null, tabs: tabs || USERS[code].tabs, can: { dashboard: true, upload: false, admin: code === 'ADM' } };
  await page.evaluate(([m, c, l]) => { S.code = c; start(m); S.lang = l; }, [me, code, lang]);
  if (wait) await page.waitForFunction(() => !!document.getElementById('claudianPMO'), null, { timeout: 12000 }).catch(() => {});
  return { page, ctx };
}
const shape = page => page.evaluate(() => {
  const h = document.getElementById('claudianPMO');
  if (!h) return null;
  const r = h.shadowRoot, b = r.querySelector('.bub'), p = r.querySelector('.panel');
  const box = e => { const x = e.getBoundingClientRect(); return { x: Math.round(x.x), y: Math.round(x.y), w: Math.round(x.width), h: Math.round(x.height) }; };
  const txt = e => (e ? e.textContent : '').replace(/\s+/g, ' ').trim();
  return {
    z: h.style.zIndex, bub: box(b), bubClass: b.className, expanded: b.getAttribute('aria-expanded'), label: b.getAttribute('aria-label'), vw: window.innerWidth, vh: window.innerHeight,
    open: /\bopen\b/.test(p.className), sheet: /\bsheet\b/.test(p.className), panel: box(p), dark: /\bdark\b/.test(r.querySelector('.root').className),
    sub: txt(r.querySelector('.sub')), lg: txt(r.querySelector('.hd button:not(:last-child)')), left: txt(r.querySelector('.mt span')),
    inputOn: getComputedStyle(r.querySelector('.ft')).display !== 'none' && r.querySelector('textarea').getBoundingClientRect().width > 80 && !r.querySelector('textarea').disabled,
    bubStyle: (function () { var c = getComputedStyle(b), v = getComputedStyle(b.querySelector('svg')); return { border: c.borderTopWidth, bg: c.backgroundColor, radius: c.borderTopLeftRadius, shadow: c.boxShadow, filter: v.filter, padding: c.paddingTop }; })(),
    icoStyle: (function () { var e = r.querySelector('.hd .ico'); var c = getComputedStyle(e); return { bg: c.backgroundColor, radius: c.borderTopLeftRadius, w: Math.round(e.getBoundingClientRect().width) }; })(),
    welcome: txt(r.querySelector('.m.w')),
    chips: [...r.querySelectorAll('.chip')].map(c => txt(c)), chipIds: [...r.querySelectorAll('.chip')].map(c => c.getAttribute('data-id')),
    msgs: [...r.querySelectorAll('.body .m')].map(m => ({ kind: m.className.replace('m ', ''), text: txt(m) })),
    faqOpen: r.querySelector('details.faq').open,
    focus: (h.shadowRoot.activeElement && h.shadowRoot.activeElement.className) || '',
    docFocus: document.activeElement === h,
  };
});
const inside = s => s.bub.x >= 0 && s.bub.y >= 0 && s.bub.x + s.bub.w <= s.vw && s.bub.y + s.bub.h <= s.vh;
const panelInside = s => s.panel.x >= 0 && s.panel.y >= 0 && s.panel.x + s.panel.w <= s.vw + 0.5 && s.panel.y + s.panel.h <= s.vh + 0.5;
const msgsOf = async page => (await shape(page)).msgs.filter(m => m.kind !== 'w');
const asks = op => seen.claudian.filter(b => b.op === op);
async function until(page, fn, arg, ms = 6000) { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch (e) { return false; } }
const tap = async page => { await page.locator('.bub').click(); };
const bubbleCentre = async page => { const b = await page.locator('.bub').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
async function drag(page, dx, dy) {
  const c = await bubbleCentre(page);
  await page.mouse.move(c.x, c.y); await page.mouse.down();
  const n = 6; for (let i = 1; i <= n; i++) await page.mouse.move(c.x + dx * i / n, c.y + dy * i / n);
  await page.mouse.up();
}
const waitAnswer = (page, n) => until(page, c => { const h = document.getElementById('claudianPMO'); return h && h.shadowRoot.querySelectorAll('.body .m:not(.w):not(.t)').length >= c; }, n);

/* The kept conversation (handbook Part 167): the portal page again after a reload, signed in as `code` (what portal() does at its start); what is kept in the browser; the lines of the panel. */
async function reenter(page, code, lang = 'sw') {
  await page.reload();
  const me = { name: USERS[code].name, role: USERS[code].role, teams: USERS[code].teams, teamCount: null, tabs: USERS[code].tabs, can: { dashboard: true, upload: false, admin: code === 'ADM' } };
  await page.evaluate(([m, c, l]) => { S.code = c; start(m); S.lang = l; }, [me, code, lang]);
  await page.waitForFunction(() => !!document.getElementById('claudianPMO'), null, { timeout: 12000 }).catch(() => {});
}
async function kept(page, key = 'claudianChat.portal') {
  for (let i = 0; i < 3; i++) { try { return await page.evaluate(k => localStorage.getItem(k), key); } catch (e) { await page.waitForTimeout(250); } }
  return 'UNREADABLE';
}
/** Every line of the conversation (not the welcome line, which is the panel's own): its kind, its text, and the links in it. */
const convo = page => page.evaluate(() => {
  const r = document.getElementById('claudianPMO').shadowRoot;
  return [...r.querySelectorAll('.body .m')].slice(1).map(m => ({ kind: m.className.replace('m ', ''), text: m.textContent.replace(/\s+/g, ' ').trim(), links: [...m.querySelectorAll('a')].map(a => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel, text: a.textContent })) }));
});
/** Is the person's latest question inside the part of the panel that shows? */
const latestShown = page => page.evaluate(() => {
  const r = document.getElementById('claudianPMO').shadowRoot, b = r.querySelector('.body').getBoundingClientRect(), us = [...r.querySelectorAll('.body .m.u')], l = us[us.length - 1];
  if (!l) return null;
  const x = l.getBoundingClientRect();
  return { top: Math.round(x.top - b.top), bottom: Math.round(b.bottom - x.bottom), within: x.top >= b.top - 1 && x.bottom <= b.bottom + 1 };
});
const APK = 'https://github.com/samaritantechs/hope-pmo-v2/releases/download/hope-calls-apk/HOPE-Calls.apk';
/** The module's own mark function, run in Node (the first form of the kept conversation marked a handset by its device id alone: a record made so is what a handset passed on would still hold). */
const markOf = (() => { const W = {}; vm.runInNewContext(fs.readFileSync(MODULE, 'utf8'), { window: W }); return W.ClaudianPMO._t.mark; })();
/** Nothing is on its way: the panel's "Loading..." / "Thinking..." line is gone. (A restored conversation can hold choices, so "a chip exists" is no sign that the list has arrived.) */
const idle = page => until(page, () => !document.getElementById('claudianPMO').shadowRoot.querySelector('.body .m.t'));

/* ================================================= A. THE PORTAL ================================================= */
setting('CLAUDIAN_AI', 'OFF'); setting('CLAUDIAN_USER_DAILY', '20');
seen.module.length = 0; seen.claudian.length = 0;
await section('A (module, drag, keys, resize)', async () => {
  const { page, ctx } = await portal('A1', { wait: false });
  await page.waitForTimeout(300);
  check('A1 before the late timer the module has not been asked for, and the server has been asked nothing', seen.module.length === 0 && seen.claudian.length === 0, JSON.stringify([seen.module, seen.claudian.length]));
  const bubble = await until(page, () => !!document.getElementById('claudianPMO'), null, 12000);
  check('A1 the bubble arrives after the late timer', bubble);
  const late = await page.evaluate(() => window.__late);
  check('A1 the timer the page asked for is seven seconds', late.includes(7000), JSON.stringify(late));
  check('A1 the module was fetched once, by the build of the page', seen.module.length === 1 && seen.module[0] === '?v=' + BUILD, JSON.stringify(seen.module) + ' ' + BUILD);
  check('A1 and the server has still been asked nothing: the bubble costs nothing until somebody taps it', seen.claudian.length === 0, JSON.stringify(seen.claudian));
  const s = await shape(page);
  check('A1 the bubble is a 56 pixel round button inside the screen, closed, with a name for a screen reader', s && s.bub.w === 56 && s.bub.h === 56 && inside(s) && s.expanded === 'false' && /Fungua msaidizi Claudian-PMO/.test(s.label), JSON.stringify(s && [s.bub, s.expanded, s.label]));
  check('A1 it starts near the bottom right, above the tip toast', s.bub.x > s.vw - 100 && s.bub.y > s.vh - 200 && s.bub.y < s.vh - 80, JSON.stringify(s.bub));
  check('A1 it sits in the portal layer (38: over the page, under the phone menu, the drawers and the toasts)', s.z === '38', s.z);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'claudian-portal-bubble.png') });

  // ---- drag
  const before = s.bub;
  await drag(page, -300, -200);
  let m = await shape(page);
  check('A2 a drag moves the bubble by the distance dragged', Math.abs(m.bub.x - (before.x - 300)) <= 2 && Math.abs(m.bub.y - (before.y - 200)) <= 2, JSON.stringify([before, m.bub]));
  check('A2 and opens nothing: the press that ends a drag is not a tap', !m.open && m.expanded === 'false' && seen.claudian.length === 0, JSON.stringify([m.open, seen.claudian.length]));
  await drag(page, -2000, -2000);
  m = await shape(page);
  check('A2 dragged past the corner it stops at the edge, whole', m.bub.x === 8 && m.bub.y === 8 && inside(m), JSON.stringify(m.bub));
  await drag(page, 3000, 3000);
  m = await shape(page);
  check('A2 and past the opposite corner too', m.bub.x === m.vw - 56 - 8 && m.bub.y === m.vh - 56 - 8 && inside(m), JSON.stringify(m.bub));
  const kept = await page.evaluate(() => localStorage.getItem('claudianPos.portal'));
  check('A2 its place is kept, as a fraction of the screen (this page, not the call app\'s)', /"fx":1/.test(kept || '') && /"fy":1/.test(kept || ''), String(kept));
  await drag(page, -600, -300);
  m = await shape(page);
  const mid = m.bub;
  // ---- the keyboard
  await page.locator('.bub').focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
  const k = await shape(page);
  check('A3 the arrow keys move it twelve pixels at a time, and a tap is not needed', k.bub.x === mid.x + 24 && k.bub.y === mid.y + 12, JSON.stringify([mid, k.bub]));
  await page.keyboard.press('Shift+ArrowLeft');
  const k2 = await shape(page);
  check('A3 with Shift forty-eight', k2.bub.x === k.bub.x - 48, JSON.stringify([k.bub, k2.bub]));
  // ---- resize: the bubble comes back inside, and goes back to where it was when there is room again
  const frac0 = await page.evaluate(() => localStorage.getItem('claudianPos.portal'));
  await page.setViewportSize({ width: 420, height: 640 });
  await page.waitForTimeout(150);
  const r1 = await shape(page);
  check('A4 a smaller window keeps the bubble inside it', inside(r1), JSON.stringify([r1.bub, r1.vw, r1.vh]));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(150);
  const r2 = await shape(page);
  check('A4 and the same fraction of the bigger screen when it grows back', Math.abs(r2.bub.x - k2.bub.x) <= 2 && Math.abs(r2.bub.y - k2.bub.y) <= 2, JSON.stringify([k2.bub, r2.bub]));
  check('A4 resizing does not rewrite what was kept', (await page.evaluate(() => localStorage.getItem('claudianPos.portal'))) === frac0);
  // ---- reload: the same place
  const keptNow = await page.evaluate(() => localStorage.getItem('claudianPos.portal'));
  await ctx.close();
  const again = await portal('A4b', { store: { 'claudianPos.portal': keptNow } });
  const s2 = await shape(again.page);
  check('A4 after a reload the bubble is where it was left', s2 && Math.abs(s2.bub.x - r2.bub.x) <= 2 && Math.abs(s2.bub.y - r2.bub.y) <= 2, JSON.stringify([r2.bub, s2 && s2.bub]));
  await again.ctx.close();
  const junk = await portal('A4c', { store: { 'claudianPos.portal': '{"fx":"x","fy":9' } });
  const s3 = await shape(junk.page);
  check('A4 a damaged memory is ignored: the bubble is in its own corner', s3 && inside(s3) && s3.bub.x > s3.vw - 100, JSON.stringify(s3 && s3.bub));
  await junk.ctx.close();
});

// ---- the panel, with the AI off
await section('A5 (panel off)', async () => {
  const { page, ctx } = await portal('A5');
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  let s = await shape(page);
  const st = asks('status');
  check('A5 a tap opens the panel and asks for the status, once, as the person with the access code, in Swahili', s.open && s.expanded === 'true' && st.length === 1 && st[0].code === 'ADM' && st[0].lang === 'sw' && !st[0].device, JSON.stringify(st));
  check('A5 the panel stands inside the screen, near the bubble', panelInside(s), JSON.stringify([s.panel, s.vw, s.vh]));
  check('A5 with the AI off the box to type in is THERE (the owner: "people ain\'t seeing the keypad"), and the subtitle and the welcome say what it finds', s.inputOn && /Majibu ya maswali ya kawaida/.test(s.sub) && /Andika swali lako au chagua moja/.test(s.welcome) && /inajibu maswali ya kawaida tu/.test(s.welcome), JSON.stringify([s.inputOn, s.sub, s.welcome]));
  check('A5 the bubble is the head alone: no ring, no disc, no round button, no shadow box; a shadow that follows the head\'s own outline', s.bubStyle.border === '0px' && /rgba\(0, 0, 0, 0\)|transparent/.test(s.bubStyle.bg) && s.bubStyle.radius !== '28px' && s.bubStyle.padding === '0px' && s.bubStyle.shadow === 'none' && /drop-shadow/.test(s.bubStyle.filter), JSON.stringify(s.bubStyle));
  check('A5 and the header\'s icon is the head alone as well: no white disc behind it', /rgba\(0, 0, 0, 0\)|transparent/.test(s.icoStyle.bg) && s.icoStyle.radius === '0px', JSON.stringify(s.icoStyle));
  check('A5 the ready questions are the choices, open, in Swahili', s.faqOpen && s.chips.length >= 15 && s.chips.some(c => /Simu ya portfolio ni nini/i.test(c)), JSON.stringify(s.chips.slice(0, 3)));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'claudian-portal-faq.png') });
  // a ready question
  const id = s.chipIds[0];
  await page.locator('.chip').first().click();
  await waitAnswer(page, 2);
  s = await shape(page);
  const fq = asks('faq');
  check('A6 a ready question asks for its answer by its id', fq.length === 1 && fq[0].id === id && fq[0].code === 'ADM', JSON.stringify(fq));
  const ms = s.msgs.filter(x => x.kind !== 'w');
  check('A6 the question is shown, then its answer, and nothing after it', ms.length === 2 && ms[0].kind === 'u' && ms[1].kind === 'a' && ms[1].text.length > 20, JSON.stringify(ms));
  check('A6 no placeholder of the server is left in the answer', !/\{\w+\}/.test(ms[1].text), ms[1].text);
  // a second one, then the whole log has four lines and the module has added nothing of its own
  await page.locator('.chip').nth(1).click();
  await waitAnswer(page, 4);
  s = await shape(page);
  const ms2 = s.msgs.filter(x => x.kind !== 'w');
  check('A6 four lines after two questions, nothing added by the panel (no "anything else?", no greeting)', ms2.length === 4 && !ms2.some(x => /anything else|kingine|let me know|nijulishe|karibu tena/i.test(x.text) && x.kind === 'a' && false), JSON.stringify(ms2.map(x => x.kind)));
  const wide = s.msgs.map(x => x.text).join(' ');
  check('A6 the panel itself says nothing of its own beyond its instructions line', s.msgs.filter(x => x.kind === 'w').length === 1, JSON.stringify(s.msgs.map(x => x.kind)));
  // the language button flips the panel, not the page
  await page.locator('.hd button').first().click();
  await until(page, () => [...document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip')].some(c => /What is a portfolio call/i.test(c.textContent)));
  s = await shape(page);
  const st2 = asks('status');
  check('A7 SW / EN flips the panel into English and asks for the choices again in English', st2.length === 2 && st2[1].lang === 'en' && /Answers to the standard questions/.test(s.sub) && s.chips.some(c => /What is a portfolio call/i.test(c)), JSON.stringify([st2.map(x => x.lang), s.sub]));
  check('A7 and the page itself is still in Swahili', (await page.evaluate(() => S.lang)) === 'sw');
  // Escape
  await page.locator('.chip').first().focus();
  await page.keyboard.press('Escape');
  s = await shape(page);
  check('A8 Escape closes the panel and the bubble has the focus again', !s.open && s.expanded === 'false' && s.focus === 'bub', JSON.stringify([s.open, s.expanded, s.focus]));
  // reopened: within a minute the choices are not asked for again
  const n0 = seen.claudian.length;
  await tap(page);
  await page.waitForTimeout(200);
  check('A8 opened again within the minute, the ready questions are not asked for again', seen.claudian.length === n0 && (await shape(page)).open, String(seen.claudian.length - n0));
  await ctx.close();
});

// ---- typing with the AI off (handbook Part 163): the box is there, and a typed question is answered from the ready answers, or told that none fits
await section('A5t (typing with the AI off)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db);
  seen.claudian.length = 0; asked.length = 0; db._dump('claudian_chats').length = 0;
  const { page, ctx } = await portal('A5t', { lang: 'en' });
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  let s = await shape(page);
  check('A5t the box is there with the AI off, and the English welcome says what it finds', s.inputOn && /Type your question or pick one below/.test(s.welcome) && /standard questions only/.test(s.welcome), JSON.stringify([s.inputOn, s.welcome]));
  // 1. a question a ready answer fits
  await page.locator('textarea').fill('what do the arrows on the dashboard mean');
  await page.locator('.send').click();
  await waitAnswer(page, 2);
  s = await shape(page);
  const q1 = asks('ask');
  check('A5t a typed question goes out as the person with the access code, and the provider is asked NOTHING', q1.length === 1 && q1[0].q === 'what do the arrows on the dashboard mean' && q1[0].code === 'ADM' && asked.length === 0, JSON.stringify([q1, asked.length]));
  const m1 = s.msgs.filter(x => x.kind !== 'w' || /Ready answer to/.test(x.text));
  check('A5t the question, then the ready question it answers, then the answer', m1.length === 3 && m1[0].kind === 'u' && m1[1].kind === 'w' && /^Ready answer to: What do the .* arrows on the Dashboard mean\?$/.test(m1[1].text) && m1[2].kind === 'a' && /last week/.test(m1[2].text), JSON.stringify(m1));
  check('A5t and the box is still there and free for the next question', s.inputOn && !(await page.locator('.send').isDisabled()), String(s.inputOn));
  // 2. a question nothing fits
  await page.locator('textarea').fill('will it rain in Dodoma tomorrow');
  await page.locator('.send').click();
  await waitAnswer(page, 4);
  s = await shape(page);
  const last = s.msgs[s.msgs.length - 1];
  check('A5t a question no ready answer fits is told so, in the amber hint, and offers no nearest choices', last.kind === 'h' && /No ready answer fits that question\. Pick one below, or type it in other words\./.test(last.text) && !s.msgs.some(x => /Closest/.test(x.text)), JSON.stringify(last));
  // 3. a question that touches two ready answers alike: nothing is answered, the two are offered
  await page.locator('textarea').fill('target za timu');
  await page.locator('.send').click();
  await waitAnswer(page, 6);
  s = await shape(page);
  const near = s.msgs[s.msgs.length - 1], hint = s.msgs[s.msgs.length - 2];
  check('A5t two ready answers that weigh alike are not guessed between: the hint, then "Closest:" with both as choices', hint.kind === 'h' && near.kind === 'w near' && /^Closest:/.test(near.text) && /company targets/.test(near.text) && /reach the targets/.test(near.text), JSON.stringify([hint, near]));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'claudian-portal-typed.png') });
  // a tap on one of them asks for that ready answer, exactly as a tap on the list does
  await page.locator('.m.near .chip').first().click();
  await waitAnswer(page, 8);
  s = await shape(page);
  const f1 = asks('faq');
  check('A5t a tap on a nearest choice asks for its ready answer by id, and the answer follows', f1.length >= 1 && f1[f1.length - 1].id === 'targets' && s.msgs[s.msgs.length - 1].kind === 'a' && /sales .* customers/.test(s.msgs[s.msgs.length - 1].text), JSON.stringify([f1, s.msgs[s.msgs.length - 1]]));
  // 3b. a question that asks for the person's own figure is not answered with the rule that defines the term
  await page.locator('textarea').fill('reached % yangu ya leo ni ngapi');
  await page.locator('.send').click();
  await waitAnswer(page, 10);
  s = await shape(page);
  const figNear = s.msgs[s.msgs.length - 1], figHint = s.msgs[s.msgs.length - 2];
  check('A5t a question for the person\'s own figure is told that a ready answer cannot give one, and the ready question that defines the term is a choice, not the answer', figHint.kind === 'h' && /^A ready answer cannot give a figure of yours\. Pick a ready question below\.$/.test(figHint.text) && figNear.kind === 'w near' && /Reached %/.test(figNear.text), JSON.stringify([figHint, figNear]));
  // 4. the log: the person's own questions, no model, no tokens, the kind of each
  const rows = db._dump('claudian_chats');
  const kinds = rows.map(r => r.mode).join(',');
  check('A5t the log has a row for each: a match, two that nothing settled, the tap and the question for a figure', kinds === 'match,nomatch,nomatch,faq,nomatch', kinds);
  check('A5t the question for a figure says so in its note', /^agent off · figure · near: reached/.test(rows[4].note), JSON.stringify(rows[4]));
  const r1 = rows[0];
  check('A5t the matched row names the ready answer, keeps what the person was told, and cost no tokens', r1.faq_id === 'dash-arrows' && /last week/.test(r1.answer) && r1.tokens_in === 0 && r1.tokens_out === 0 && /^agent off · score [\d.]+/.test(r1.note), JSON.stringify(r1));
  check('A5t the row of a question nothing fitted keeps the words, no answer, and the two nearest as the note', rows[2].question === 'target za timu' && rows[2].answer === null && /^agent off · near: (targets, improve|improve, targets)$/.test(rows[2].note), JSON.stringify(rows[2]));
  await ctx.close();
});
// a person who does not hold a screen is never answered from it, however the question is worded
await section('A5p (privacy of the ready answers)', async () => {
  seen.claudian.length = 0; db._dump('claudian_chats').length = 0;
  const { page, ctx } = await portal('A5p', { code: 'CLK', lang: 'sw' });
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  await page.locator('textarea').fill('notisi ya madai inatolewa lini');
  await page.locator('.send').click();
  await waitAnswer(page, 2);
  let s = await shape(page);
  const last = s.msgs[s.msgs.length - 1];
  check('A5p a clerk who does not hold the Legal screen asks about demand notices: no answer from it, in any words', last.kind === 'h' && !/D\.C 2/.test(JSON.stringify(s.msgs)) && !s.msgs.some(x => x.kind === 'w near' && /notisi/i.test(x.text)), JSON.stringify(s.msgs.slice(-2)));
  check('A5p and the chip list the clerk was shown has none of the Legal screen\'s questions', !s.chips.some(c => /Notisi ya madai/.test(c)), JSON.stringify(s.chips));
  await ctx.close();
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db);
  const adm = await portal('A5p2', { code: 'ADM', lang: 'sw' });
  await tap(adm.page);
  await until(adm.page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  await adm.page.locator('textarea').fill('notisi ya madai inatolewa lini');
  await adm.page.locator('.send').click();
  await waitAnswer(adm.page, 2);
  s = await shape(adm.page);
  check('A5p the admin, who holds every screen, is answered from the Legal screen\'s ready answer for the same words', s.msgs.some(x => x.kind === 'a' && /D\.C 2 au zaidi/.test(x.text)), JSON.stringify(s.msgs.slice(-2)));
  await adm.ctx.close();
});

// ---- the AI on
await section('A9 (AI on)', async () => {
  setting('CLAUDIAN_AI', 'ON'); setting('CLAUDIAN_USER_DAILY', '20'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests();
  PROV.text = '<img src=x onerror="window.__pwned=1"> Piga simu za portfolio kwa wateja wa leo. Ungependa kitu kingine?';
  asked.length = 0; seen.claudian.length = 0;
  const { page, ctx } = await portal('A9', { lang: 'en' });
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelector('.ft.on'));
  let s = await shape(page);
  check('A9 with the AI on the box is there, the subtitle invites a question, and the page\'s English is used', s.inputOn && /Ask a question about HOPE PMO/.test(s.sub) && asks('status')[0].lang === 'en', JSON.stringify([s.inputOn, s.sub]));
  check('A9 the ready questions are folded away (the box is the way in), and the questions left are counted', !s.faqOpen && /Questions left today: 20/.test(s.left), JSON.stringify([s.faqOpen, s.left]));
  await page.locator('textarea').fill('What should I do today?');
  await page.keyboard.press('Enter');
  await waitAnswer(page, 2);
  s = await shape(page);
  const ask1 = asks('ask');
  check('A9 Enter sends the question, with no earlier exchange to carry', ask1.length === 1 && ask1[0].q === 'What should I do today?' && Array.isArray(ask1[0].hist) && ask1[0].hist.length === 0 && ask1[0].lang === 'en', JSON.stringify(ask1));
  const ans = s.msgs.filter(x => x.kind === 'a')[0];
  check('A9 the answer is shown as TEXT: the tag is on the screen and ran nothing', ans && /<img src=x/.test(ans.text) && (await page.evaluate(() => window.__pwned)) === undefined, JSON.stringify(ans));
  check('A9 the closing question the model wrote is cut by the server, and the panel adds none', ans && !/Ungependa/.test(ans.text), JSON.stringify(ans));
  check('A9 the box is empty again, and one question fewer is left', (await page.locator('textarea').inputValue()) === '' && /Questions left today: 19/.test(s.left), s.left);
  check('A9 the provider got one request, of the lowest model, with the person\'s question in it', asked.length === 1 && asked[0].model === 'claude-haiku-5-5' && /QUESTION: What should I do today\?/.test(asked[0].messages[0].content), JSON.stringify(asked.map(a => a.model)));
  await page.locator('textarea').fill('And after that?');
  await page.locator('.send').click();
  await waitAnswer(page, 4);
  const ask2 = asks('ask');
  check('A10 the next question carries the last exchange, and only the last', ask2.length === 2 && ask2[1].hist.length === 1 && ask2[1].hist[0].q === 'What should I do today?' && /Piga simu za portfolio/.test(ask2[1].hist[0].a), JSON.stringify(ask2[1].hist));
  check('A10 an empty box sends nothing', await (async () => { const n = asks('ask').length; await page.locator('textarea').fill('   '); await page.locator('.send').click(); await page.waitForTimeout(150); return asks('ask').length === n; })());
  check('A10 a question longer than the server accepts is cut at the box itself', (await page.evaluate(() => document.getElementById('claudianPMO').shadowRoot.querySelector('textarea').maxLength)) === 400);
  // a limit
  setting('CLAUDIAN_USER_DAILY', '2'); C.noteClaudianSettingsWritten(db);
  await page.locator('textarea').fill('A third question');
  await page.locator('.send').click();
  await waitAnswer(page, 6);
  s = await shape(page);
  const last = s.msgs[s.msgs.length - 1];
  check('A11 a person at their limit is shown the amber "working hard, try later" line, in English, with its advice', last.kind === 'h' && /Try again/.test(last.text) && /(portfolio|customers)/i.test(last.text), JSON.stringify(last));
  // a provider that fails
  setting('CLAUDIAN_USER_DAILY', '20'); C.noteClaudianSettingsWritten(db);
  PROV.fail = 503;
  await page.locator('textarea').fill('A fourth question');
  await page.locator('.send').click();
  await waitAnswer(page, 8);
  s = await shape(page);
  const last2 = s.msgs[s.msgs.length - 1];
  check('A11 a provider that does not answer is the same amber line, never an error', last2.kind === 'h' && /Try again/.test(last2.text), JSON.stringify(last2));
  PROV.fail = 0;
  // the page cannot reach the server at all
  await page.route('**/api/claudian', r => r.abort());
  await page.locator('textarea').fill('A fifth question');
  await page.locator('.send').click();
  await waitAnswer(page, 10);
  s = await shape(page);
  const last3 = s.msgs[s.msgs.length - 1];
  check('A11 no connection at all says so, in the page\'s language, and the panel still works', last3.kind === 'h' && /No connection/.test(last3.text), JSON.stringify(last3));
  await page.unroute('**/api/claudian');
  check('A11 the send button is free again after a failure', !(await page.locator('.send').isDisabled()));
  // the owner switches the AI off while the panel is open: the next answer comes from the ready answers (a question none fits is told so), the box STAYS, and the subtitle and the counter follow the switch
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db);
  await page.locator('textarea').fill('Is anybody there?');
  await page.locator('.send').click();
  await until(page, () => /standard questions/.test(document.getElementById('claudianPMO').shadowRoot.querySelector('.sub').textContent));
  s = await shape(page);
  const lastOff = s.msgs[s.msgs.length - 1];
  check('A11 the AI switched off while the panel is open: the next answer is a ready-answer one, the box STAYS (it is there for everybody), and the subtitle and the counter follow the switch', s.inputOn && lastOff.kind === 'h' && /No ready answer fits that question/i.test(lastOff.text) && s.chips.length > 0 && /Answers to the standard questions/.test(s.sub) && s.left === '', JSON.stringify([s.inputOn, lastOff, s.sub, s.left]));
  check('A11 and its ready questions are laid out in full again (no height limit)', s.faqOpen);
  await ctx.close();
});

// ---- a person the server does not know
await section('A12 (refused)', async () => {
  seen.force = 403;
  const { page, ctx } = await portal('A12');
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelector('.m.e'));
  const s = await shape(page);
  check('A12 an account the server refuses gets the red line, in Swahili: the helper is not available', s.msgs.some(m => m.kind === 'e' && /Msaidizi hapatikani/.test(m.text)), JSON.stringify(s.msgs));
  seen.force = 0;
  await ctx.close();
});

// ---- a clerk sees the clerk's own choices
await section('A13 (clerk)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests();
  const adm = await portal('A13a');
  await tap(adm.page); await until(adm.page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  const sa = await shape(adm.page);
  const clk = await portal('A13b', { code: 'CLK' });
  await tap(clk.page); await until(clk.page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  const sc = await shape(clk.page);
  check('A13 a clerk is offered fewer ready questions than the admin (a screen they do not hold has none)', sc.chips.length > 0 && sc.chips.length < sa.chips.length, JSON.stringify([sa.chips.length, sc.chips.length]));
  check('A13 and none of the admin\'s screens\' questions among them', !sc.chips.some(c => /Makato|Deduction|earners|Claudian-PMO/i.test(c) && /reporters|earners|walioripoti|Nawashaje/i.test(c)), JSON.stringify(sc.chips));
  await adm.ctx.close(); await clk.ctx.close();
});

// ---- the dark page
await section('A14 (dark)', async () => {
  const { page, ctx } = await portal('A14');
  await page.evaluate(() => document.body.classList.add('dark'));
  await tap(page);
  const s = await shape(page);
  check('A14 a page in its dark theme gets the dark panel', s.dark, JSON.stringify(s.dark));
  await page.evaluate(() => document.body.classList.remove('dark'));
  await page.keyboard.press('Escape');
  await page.locator('.chip').first().focus().catch(() => {});
  await ctx.close();
});

// ---- a phone: the sheet, no overflow, a finger
await section('A15 (phone)', async () => {
  const { page, ctx } = await portal('A15', { viewport: { width: 390, height: 780 }, touch: true });
  let s = await shape(page);
  const c = { x: s.bub.x + 28, y: s.bub.y + 28 };
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', c.x, c.y);
  for (let i = 1; i <= 8; i++) await touch('touchMove', c.x - 20 * i, c.y - 40 * i);
  await touch('touchEnd');
  await page.waitForTimeout(100);
  const moved = await shape(page);
  check('A15 a finger drags the bubble, and the drag opens nothing', Math.abs(moved.bub.x - (s.bub.x - 160)) <= 4 && Math.abs(moved.bub.y - (s.bub.y - 320)) <= 4 && !moved.open, JSON.stringify([s.bub, moved.bub, moved.open]));
  await page.locator('.bub').tap();
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  s = await shape(page);
  check('A15 a tap opens it as a sheet across the bottom of the phone, the bubble out of the way', s.open && s.sheet && s.panel.x === 8 && s.panel.x + s.panel.w === s.vw - 8 && s.panel.y + s.panel.h <= s.vh && /away/.test(s.bubClass), JSON.stringify([s.panel, s.vw, s.vh, s.bubClass]));
  const over = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - window.innerWidth, panel: (() => { const r = document.getElementById('claudianPMO').shadowRoot; return [...r.querySelectorAll('.chip,.m,.hd,.mt')].filter(e => e.scrollWidth > e.clientWidth + 1).length; })() }));
  check('A15 nothing overflows sideways: not the page, not a line or a choice of the panel', over.doc <= 0 && over.panel === 0, JSON.stringify(over));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'claudian-phone-sheet.png') });
  await page.locator('.hd button').last().click();
  s = await shape(page);
  check('A15 closing brings the bubble back where it was', !s.open && !/away/.test(s.bubClass) && Math.abs(s.bub.x - moved.bub.x) <= 2, JSON.stringify([s.bub, moved.bub]));
  await ctx.close();
});

// ---- a module that cannot be fetched
await section('A16 (404)', async () => {
  seen.modules404 = true; seen.module.length = 0;
  const { page, ctx } = await portal('A16', { wait: false });
  await page.waitForTimeout(1500);
  check('A16 a module that cannot be fetched leaves no bubble, and no error on the page', (await page.evaluate(() => !document.getElementById('claudianPMO'))) && seen.module.length === 1);
  seen.modules404 = false;
  await ctx.close();
});

/* ================================================= B. SETTINGS ================================================= */
// ---- the TAIL of a touch (the second reader of Part 163): one tap on the bubble must not also press the page's own control that is under the finger afterwards
await section('A17 (the tail of a tap)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests();
  for (const [name, frac] of [['top right', { fx: 1, fy: 0 }], ['bottom right', { fx: 1, fy: 1 }], ['middle right', { fx: 1, fy: 0.5 }]]) {
    seen.claudian.length = 0;
    const { page, ctx } = await portal('A17', { viewport: { width: 390, height: 780 }, touch: true, store: { 'claudianPos.portal': JSON.stringify(frac) } });
    await page.evaluate(() => {
      window.__pageClicks = [];
      const b = document.createElement('button'); b.id = 'pgBtn'; b.textContent = 'PAGE CONTROL';
      b.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:0;z-index:10;opacity:.01';     // a control under EVERY place the bubble can be parked (the real page has its log-out and header buttons)
      b.onclick = () => window.__pageClicks.push('page');
      document.body.appendChild(b);
    });
    let s = await shape(page);
    await page.touchscreen.tap(s.bub.x + 28, s.bub.y + 28);
    await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
    await page.waitForTimeout(700);
    s = await shape(page);
    const clicks = await page.evaluate(() => window.__pageClicks.length);
    const stored = await page.evaluate(() => localStorage.getItem('claudianPos.portal'));
    check('A17 ' + name + ': one tap opens the panel and presses NOTHING of the page under the finger', s.open && clicks === 0, JSON.stringify([s.open, clicks]));
    check('A17 ' + name + ': nor a button of the sheet (the bubble keeps the place it was left in)', stored !== null && JSON.parse(stored).fy === frac.fy, String(stored));
    // the swallowing is for a moment only: a tap on the page well after it is a tap on the page
    await page.keyboard.press('Escape');
    await page.touchscreen.tap(20, 400);
    check('A17 ' + name + ': a tap on the page a moment later is still a tap on the page', (await page.evaluate(() => window.__pageClicks.length)) === 1);
    await ctx.close();
  }
});

// ---- the focus is the person's (the second reader of Part 163): the list arriving must not take it from the box, and a chip pressed by the keyboard gives it back
await section('A18 (the focus)', async () => {
  seen.delayStatus = 1500;
  const { page, ctx } = await portal('A18', { viewport: { width: 390, height: 780 }, touch: true });
  await page.locator('.bub').tap();
  await page.locator('textarea').tap();
  await page.keyboard.type('mshahara ');
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0, null, 8000);
  await page.keyboard.type('unaingia');
  const v = await page.locator('textarea').inputValue();
  check('A18 the list arriving does not take the focus from the box: what is typed after it still lands in the box', v === 'mshahara unaingia', JSON.stringify(v));
  seen.delayStatus = 0;
  await ctx.close();
  // a keyboard user: Enter on a ready question, and the focus is where it can be used again
  const k = await portal('A18k', { viewport: { width: 1280, height: 800 } });
  await tap(k.page);
  await until(k.page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  await k.page.locator('.chip').first().focus();
  await k.page.keyboard.press('Enter');
  await waitAnswer(k.page, 2);
  await k.page.waitForTimeout(150);
  check('A18 after a ready question is pressed with the keyboard the focus is on the box, not lost', (await shape(k.page)).focus === '' && (await k.page.evaluate(() => { const r = document.getElementById('claudianPMO').shadowRoot; return r.activeElement === r.querySelector('textarea'); })));
  await k.ctx.close();
});

// ---- a short window (a 1366x768 laptop has under 650 pixels of page): the open panel is not drawn over the bubble
await section('A19 (a short window)', async () => {
  for (const [w, h] of [[1024, 600], [1366, 640], [1280, 480]]) {
    const { page, ctx } = await portal('A19', { viewport: { width: w, height: h } });
    await tap(page);
    await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
    const s = await shape(page);
    const over = !(s.panel.x + s.panel.w <= s.bub.x || s.bub.x + s.bub.w <= s.panel.x || s.panel.y + s.panel.h <= s.bub.y || s.bub.y + s.bub.h <= s.panel.y);
    check('A19 ' + w + 'x' + h + ': the open panel is not over the bubble, and both are inside the window', !over && inside(s) && panelInside(s), JSON.stringify([s.bub, s.panel]));
    if (SHOTS && w === 1024) await page.screenshot({ path: path.join(SHOTS, 'claudian-short-window.png') });
    await ctx.close();
  }
});

// ---- a question that was not answered goes back into the box; a server fault is not "no connection"
await section('A20 (a failed question)', async () => {
  setting('CLAUDIAN_AI', 'ON'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests();
  const { page, ctx } = await portal('A20', { lang: 'en' });
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  seen.force = 500;
  await page.locator('textarea').fill('A long question I do not want to type again');
  await page.keyboard.press('Enter');
  await waitAnswer(page, 2);
  const s = await shape(page);
  const last = s.msgs[s.msgs.length - 1];
  check('A20 a server fault is said as a fault, not as "no connection"', last.kind === 'h' && /fault/i.test(last.text) && !/No connection/.test(last.text), JSON.stringify(last));
  check('A20 the question is back in the box, to send again', (await page.locator('textarea').inputValue()) === 'A long question I do not want to type again');
  seen.force = 0;
  await ctx.close();
});

// ---- SW / EN pressed while something is on its way (the second reader of Part 163): the ready questions are asked for again in the new language once nothing is on its way, not left in the old one until the panel is closed and opened a minute later
await section('A21 (SW / EN while busy)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests();
  // (a) the first list is still on its way
  seen.claudian.length = 0; seen.delayStatus = 1500;
  const a = await portal('A21a', { lang: 'sw' });
  await tap(a.page);
  await a.page.waitForTimeout(300);
  check('A21 the first list was asked for in Swahili and is on its way', asks('status').length === 1 && asks('status')[0].lang === 'sw', JSON.stringify(asks('status').map(x => x.lang)));
  await a.page.locator('.hd button').first().click();          // SW / EN while the list is still on its way
  seen.delayStatus = 0;
  const gotEn = await until(a.page, () => [...document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip')].some(c => /What is a portfolio call/i.test(c.textContent)), null, 8000);
  const sa = await shape(a.page);
  check('A21 pressed while the first list was on its way, the list is asked for again in English as soon as it has landed', gotEn && asks('status').length === 2 && asks('status')[1].lang === 'en', JSON.stringify(asks('status').map(x => x.lang)));
  check('A21 and no ready question is left in Swahili beside them', !sa.chips.some(c => /Simu ya portfolio ni nini/i.test(c)) && sa.chips.length > 0, JSON.stringify(sa.chips.slice(0, 3)));
  check('A21 the page itself is still in Swahili (the button flips the panel, not the page)', (await a.page.evaluate(() => S.lang)) === 'sw');
  await a.ctx.close();
  // (b) a typed question is on its way
  seen.claudian.length = 0; seen.delayStatus = 0; seen.delayAsk = 1500;
  const b = await portal('A21b', { lang: 'sw' });
  await tap(b.page);
  await until(b.page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  await b.page.locator('textarea').fill('mshahara unaingia lini');
  await b.page.keyboard.press('Enter');
  await b.page.waitForTimeout(300);
  await b.page.locator('.hd button').first().click();
  seen.delayAsk = 0;
  const gotEn2 = await until(b.page, () => [...document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip')].some(c => /What is a portfolio call/i.test(c.textContent)), null, 8000);
  const sb = await shape(b.page);
  check('A21 pressed while a typed question was on its way, the list is asked for again in English after the answer', gotEn2 && asks('status').length === 2 && asks('status')[1].lang === 'en' && !sb.chips.some(c => /Simu ya portfolio ni nini/i.test(c)), JSON.stringify(asks('status').map(x => x.lang)));
  await b.ctx.close();
  seen.delayAsk = 0; seen.delayStatus = 0;
});

// ---- the conversation is KEPT (handbook Part 167; the owner, 26 Nov: "could user always find their history without new chat whenever thry open Claudian-PMO")
await section('A22 (history kept across a reload)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0;
  const { page, ctx } = await portal('A22');
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  await page.locator('.chip').first().click(); await waitAnswer(page, 2);
  await page.locator('.chip').nth(1).click(); await waitAnswer(page, 4);
  await page.locator('textarea').fill('target za timu');             // two ready answers weigh alike: the nearest are offered as choices
  await page.keyboard.press('Enter');
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.body .m:not(.w):not(.t)').length >= 5);
  await idle(page);                    // the ANSWER has landed (the thinking line is gone): the panel and the record are read of one state, not of two moments (the second reader's T3: this point was racy)
  const before = await convo(page);
  const raw = await kept(page); let rec = null; try { rec = JSON.parse(raw); } catch (e) { /* reported below */ }
  check('A22 every line of the conversation is kept in the browser, under a mark of who it is', !!rec && rec.v === 1 && typeof rec.who === 'string' && rec.who.length >= 6 && rec.m.length === before.length && before.length >= 5, JSON.stringify([rec && rec.v, rec && rec.who, rec && rec.m.length, before.length]));
  check('A22 the access code is nowhere in what is kept', typeof raw === 'string' && !/ADM/.test(raw), String(raw).slice(0, 160));
  const near = before.find(x => /near/.test(x.kind));
  check('A22 the choices the panel offered are kept with their ids', !!near && rec.m.some(l => l[0] === 'n' && l[1].length >= 1 && typeof l[1][0].id === 'string'), JSON.stringify(rec && rec.m.map(l => l[0])));
  const asked0 = seen.claudian.length;
  await reenter(page, 'ADM');
  await page.waitForTimeout(200);
  check('A22 after a reload the server has been asked NOTHING: the conversation is drawn from the browser', seen.claudian.length === asked0, JSON.stringify(seen.claudian.slice(asked0)));
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  await idle(page);
  const after = await convo(page);
  check('A22 the panel opens on the same conversation: the same lines in the same order, not a new empty chat', JSON.stringify(after.map(x => [x.kind, x.text])) === JSON.stringify(before.map(x => [x.kind, x.text])), JSON.stringify(after.map(x => x.kind)));
  const vis = await latestShown(page);
  check('A22 and it opens on the latest question, with its answer under it', vis && vis.within, JSON.stringify(vis));
  // a restored choice is a live button: a tap asks its ready question by id
  const nearBtn = page.locator('.m.near .chip').first();
  const nid = await nearBtn.getAttribute('data-id');
  const f0 = asks('faq').length;
  await nearBtn.click(); await waitAnswer(page, after.length + 2);
  check('A22 a choice restored from the browser asks its ready question as before', asks('faq').length === f0 + 1 && asks('faq')[f0].id === nid, JSON.stringify([nid, asks('faq').slice(f0)]));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'claudian-portal-history.png') });
  // the panel's own welcome line is still the first, once
  const lines = await shape(page);
  check('A22 the panel\'s welcome line is still the first line, once', lines.msgs.filter(m => /Andika swali lako/.test(m.text)).length === 1 && /Andika swali lako/.test(lines.msgs[0].text), JSON.stringify(lines.msgs[0]));
  // another person on the same browser finds an empty panel, and the first person's conversation is deleted, not just hidden
  await reenter(page, 'CLK');
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  check('A22 another person on the same browser finds an EMPTY panel', (await convo(page)).length === 0);
  check('A22 and the first person\'s conversation was deleted the moment it was met', (await kept(page)) === null, String(await kept(page)).slice(0, 80));
  // a conversation more than thirty days old is not found
  await page.locator('.chip').first().click(); await waitAnswer(page, 2);
  check('A22 the second person\'s own conversation is kept under their own mark', (await kept(page)) !== null && JSON.parse(await kept(page)).who !== rec.who);
  await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('claudianChat.portal')); r.at = Date.now() - 31 * 86400000; localStorage.setItem('claudianChat.portal', JSON.stringify(r)); });
  await reenter(page, 'CLK');
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  check('A22 thirty-one days old: not found, and deleted', (await convo(page)).length === 0 && (await kept(page)) === null);
  // a damaged record is ignored without a word
  await page.evaluate(() => localStorage.setItem('claudianChat.portal', '{oops'));
  await reenter(page, 'CLK');
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  const st = await shape(page);
  check('A22 a damaged record is ignored: the panel opens as it always did, with its choices', st.open && st.chips.length >= 5 && (await convo(page)).length === 0, JSON.stringify([st.open, st.chips.length, (await convo(page)).length]));
  await ctx.close();
});

// ---- the Toka (the portal's sign-out) takes the kept conversation with the person
await section('A22b (the portal sign-out forgets)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0;
  for (const withBrand of [false, true]) {
    // (false) the page has no brand.js (an old cached page, a failed fetch): the helper's own forget() does it; (true) the system's one sign-out, HOPESession, does it
    seen.brand = withBrand;
    const { page, ctx } = await portal('A22b' + (withBrand ? 'b' : 'a'));
    const sessionKnown = await page.evaluate(() => typeof window.HOPESession === 'object');
    check('A22b the page ' + (withBrand ? 'has' : 'has not') + ' the system\'s one sign-out (brand.js)', sessionKnown === withBrand, String(sessionKnown));
    await tap(page);
    await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
    await page.locator('.chip').first().click(); await waitAnswer(page, 2);
    await drag(page, -80, -60);                           // the bubble's place is kept too
    check('A22b a conversation and a place are kept', (await kept(page)) !== null && (await kept(page, 'claudianPos.portal')) !== null);
    await page.evaluate(() => { localStorage.setItem('claudianChat.call', '{"v":1}'); document.getElementById('outBtn').click(); });
    await page.waitForTimeout(800);
    check('A22b pressing Toka forgets the conversation, and the call app\'s copy as well (one storage, one sign-out) -- ' + (withBrand ? 'by HOPESession and by the helper' : 'by the helper alone'), (await kept(page)) === null && (await kept(page, 'claudianChat.call')) === null, JSON.stringify([await kept(page), await kept(page, 'claudianChat.call')]));
    check('A22b and the bubble\'s place is nobody\'s secret and stays', (await kept(page, 'claudianPos.portal')) !== null);
    await ctx.close();
  }
  seen.brand = false;
});

// ---- a long conversation: a hidden panel forgets its scroll, so every opening goes to the latest question
await section('A22c (a long conversation opens on the latest question)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0;
  const { page, ctx } = await portal('A22c');
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  await page.locator('.chip').first().click(); await waitAnswer(page, 2);
  const mine = JSON.parse(await kept(page));
  const m = [];
  for (let i = 1; i <= 18; i++) { m.push(['u', 'Swali la ' + i + ': timu yangu inafanyaje leo?']); m.push(['a', 'Jibu la ' + i + ': ' + 'Piga simu za portfolio kwa wateja wa leo kwanza, kisha ahadi, kisha waliokosa. '.repeat(4)]); }
  await page.evaluate(v => localStorage.setItem('claudianChat.portal', JSON.stringify(v)), { v: 1, who: mine.who, at: Date.now(), ha: 0, hist: null, m });
  await reenter(page, 'ADM');
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  const scroll1 = await page.evaluate(() => { const b = document.getElementById('claudianPMO').shadowRoot.querySelector('.body'); return { top: Math.round(b.scrollTop), room: b.scrollHeight - b.clientHeight }; });
  const vis1 = await latestShown(page);
  check('A22c thirty-six lines are drawn, and the panel is scrolled down to the latest question', (await convo(page)).length === 36 && scroll1.room > 200 && scroll1.top > 200 && vis1 && vis1.within, JSON.stringify([scroll1, vis1]));
  // closed and opened again: the hidden panel forgot its scroll, and the opening goes back to the latest question
  await page.keyboard.press('Escape');
  await tap(page);
  await page.waitForTimeout(300);
  const scroll2 = await page.evaluate(() => { const b = document.getElementById('claudianPMO').shadowRoot.querySelector('.body'); return Math.round(b.scrollTop); });
  const vis2 = await latestShown(page);
  check('A22c closed and opened again, it is on the latest question again', scroll2 > 200 && vis2 && vis2.within, JSON.stringify([scroll2, vis2]));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'claudian-portal-long.png') });
  await ctx.close();
});

// ---- the exchange rides across a reload while it is young
await section('A23 (the last exchange across a reload)', async () => {
  setting('CLAUDIAN_AI', 'ON'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); PROV.text = 'Piga simu za portfolio kwa wateja wa leo.'; seen.claudian.length = 0;
  const { page, ctx } = await portal('A23');
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  await page.locator('textarea').fill('Nifanye nini leo kwa timu yangu?'); await page.keyboard.press('Enter'); await waitAnswer(page, 2);
  await reenter(page, 'ADM');
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  check('A23 after a reload the AI answer is there', (await convo(page)).some(x => x.kind === 'a' && /Piga simu za portfolio/.test(x.text)));
  await page.locator('textarea').fill('Na kesho?'); await page.keyboard.press('Enter'); await waitAnswer(page, 4);
  const q2 = asks('ask')[1];
  check('A23 the next question carries the last exchange, kept across the reload (while it is under thirty minutes old)', !!q2 && Array.isArray(q2.hist) && q2.hist.length === 1 && q2.hist[0].q === 'Nifanye nini leo kwa timu yangu?' && /^Piga simu za portfolio/.test(q2.hist[0].a), JSON.stringify(q2 && q2.hist));
  // thirty-one minutes later the lines are found and the exchange is not handed to the model
  await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('claudianChat.portal')); r.ha = Date.now() - 31 * 60000; localStorage.setItem('claudianChat.portal', JSON.stringify(r)); });
  await reenter(page, 'ADM');
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  check('A23 thirty-one minutes later the lines are still found', (await convo(page)).length >= 4);
  await page.locator('textarea').fill('Na kesho kutwa?'); await page.keyboard.press('Enter'); await waitAnswer(page, 6);
  const q3 = asks('ask')[2];
  check('A23 but the exchange is no longer sent to the model as the previous one', !!q3 && Array.isArray(q3.hist) && q3.hist.length === 0, JSON.stringify(q3 && q3.hist));
  await ctx.close();
});

// ---- a link in an answer: the release address is a real link, and nothing else is
await section('A24 (the link)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0;
  const seeded = { v: 1, who: 'x', at: Date.now(), ha: 0, hist: null, m: [['u', 'I called a customer but "Amepigiwa leo" did not appear'], ['a', 'Close the app completely and open it again so it asks for permissions.\n\nIf it still does not appear, install it again from here: ' + APK],
    ['a', 'Do not use https://evil.example/HOPE-Calls.apk or <a href="https://evil.example">this</a>']] };
  const { page, ctx } = await portal('A24');
  const who = await page.evaluate(() => { /* the module's mark of the signed-in person: ask it by keeping one line first */ return null; });
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  await page.locator('.chip').first().click(); await waitAnswer(page, 2);
  const mine = JSON.parse(await kept(page));
  seeded.who = mine.who;
  await page.evaluate(v => localStorage.setItem('claudianChat.portal', JSON.stringify(v)), seeded);
  await reenter(page, 'ADM');
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  const cv = await convo(page);
  const install = cv[1], hostile = cv[2];
  check('A24 the release address in an answer is a link, with the constant as its address, opening elsewhere', !!install && install.links.length === 1 && install.links[0].href === APK && install.links[0].target === '_blank' && /noopener/.test(install.links[0].rel) && install.links[0].text === APK, JSON.stringify(install));
  check('A24 the words around it are all there', /Close the app completely and open it again/.test(install.text) && /install it again from here: https:\/\/github\.com/.test(install.text), install.text);
  check('A24 any other address, and markup, is text and never a link', !!hostile && hostile.links.length === 0 && /evil\.example\/HOPE-Calls\.apk/.test(hostile.text) && /<a href=/.test(hostile.text), JSON.stringify(hostile));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'claudian-portal-link.png') });
  await ctx.close();
});

await section('B (settings)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); setting('CLAUDIAN_USER_DAILY', '20'); setting('CLAUDIAN_ALL_DAILY', '2000'); C.noteClaudianSettingsWritten(db);
  const { page, ctx } = await portal('B1');
  await page.evaluate(() => go('settings'));
  const card = await until(page, () => { const c = document.getElementById('cpCard'); return c && /Haijaonyeshwa|READY QUESTIONS ONLY/.test((document.getElementById('cpState') || {}).textContent || ''); }, null, 12000);
  check('B1 Settings has the helper\'s card, filled with the server\'s own reading', card);
  const text = () => page.evaluate(() => (document.getElementById('cpCard') || {}).textContent || '');
  let t = await text();
  check('B1 it says: ready questions only, no key, the model, the owner\'s targets for each team (7+ customers, TZS 5,000,000+, Early Col 90%, Col 100%, Rec 120%, TZS 700,000+, 300+ calls)', /READY QUESTIONS ONLY/.test(t) && /No key/.test(t) && /claude-haiku-5-5/.test(t)
  && /Targets in use \(each team\)/.test(t) && /sales 7\+/.test(t) && /TZS 5,000,000\+/.test(t) && /Early Col 90%/.test(t) && /Col 100%/.test(t) && /Rec 120%/.test(t) && /TZS 700,000\+/.test(t) && /calls 300\+/.test(t), t.slice(0, 600));
  check('B1 the limits boxes hold the server\'s reading (20 and 2,000) and the buttons are enabled', (await page.evaluate(() => [document.getElementById('cpUser').value, document.getElementById('cpAll').value, document.getElementById('cpToggle').disabled])).join() === '20,2000,false');
  await page.click('#cpToggle');
  await until(page, () => /AI ON/.test(document.getElementById('cpState').textContent));
  t = await text();
  check('B2 the one button switches the AI on: the settings row says ON, and with no key on the host the chip says so', settingRow('CLAUDIAN_AI') === 'ON' && /AI IMEWASHWA, HAKUNA UFUNGUO \/ AI ON, NO KEY/.test(t) && /Zima AI/.test(t), settingRow('CLAUDIAN_AI') + ' | ' + t.slice(0, 160));
  await page.click('#cpToggle');
  await until(page, () => /READY QUESTIONS ONLY/.test(document.getElementById('cpState').textContent));
  check('B2 and the same button switches it off again', settingRow('CLAUDIAN_AI') === 'OFF');
  await page.fill('#cpUser', '35'); await page.fill('#cpAll', '3000');
  await page.click('#cpSave');
  await until(page, () => document.getElementById('cpUser').value === '35' && !document.getElementById('cpSave').disabled);
  check('B3 the limits are saved', settingRow('CLAUDIAN_USER_DAILY') === '35' && settingRow('CLAUDIAN_ALL_DAILY') === '3000', JSON.stringify([settingRow('CLAUDIAN_USER_DAILY'), settingRow('CLAUDIAN_ALL_DAILY')]));
  await page.fill('#cpUser', '0');
  await page.click('#cpSave');
  await page.waitForTimeout(400);
  const toastText = await page.evaluate(() => (document.getElementById('toast') || document.querySelector('.toast') || {}).textContent || '');
  check('B3 a limit outside its range is refused and said, and nothing changes', settingRow('CLAUDIAN_USER_DAILY') === '35' && /1 to 200/.test(toastText), toastText);
  check('B3 the button is free again after a refusal', !(await page.locator('#cpSave').isDisabled()));
  // a table search repaints the whole screen from HEAD: the card, and its buttons, are still there and still work
  await page.evaluate(() => { var q = document.getElementById('q') || document.querySelector('input[type=search]'); if (q) { q.value = 'zzz'; q.dispatchEvent(new Event('input', { bubbles: true })); } else { paint(true); } });
  await page.waitForTimeout(300);
  check('B4 after a repaint the card is still filled', /READY QUESTIONS ONLY/.test(await text()) && (await page.inputValue('#cpUser')) === '35');
  await page.click('#cpToggle');
  await until(page, () => /AI ON/.test(document.getElementById('cpState').textContent));
  check('B4 and its button still works (the screen\'s wiring is run at every repaint)', settingRow('CLAUDIAN_AI') === 'ON');
  setting('CLAUDIAN_AI', 'OFF');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'claudian-settings-card.png'), fullPage: false });
  await ctx.close();
});

/* ============================ B5. THE TEMPORARY TEST BUTTON (handbook Part 162, addendum 2) ============================ */
await section('B5 (test button)', async () => {
  const TP = { mode: 'ok', calls: 0 };
  const tclient = { messages: { create: async (req) => {
    TP.calls++; TP.last = req;
    if (TP.mode === 'ok') return { id: 'm', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 2900, output_tokens: 4, cache_creation_input_tokens: 2800 }, stop_reason: 'end_turn' };
    if (TP.mode === '401') throw Object.assign(new Error('401 invalid x-api-key'), { status: 401, requestID: 'req_011BROWSER', error: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
    if (TP.mode === '429') throw Object.assign(new Error('429 rate limited'), { status: 429, error: { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } } });
    if (TP.mode === '400') throw Object.assign(new Error('400 thinking is not supported'), { status: 400, error: { type: 'error', error: { type: 'invalid_request_error', message: 'thinking is not supported' } } });
    if (TP.mode === 'evil') throw Object.assign(new Error('500 <img src=x onerror="window.__xss=1"><script>window.__xss=2</script> oops'), { status: 500 });
    throw new Error('unknown mode');
  } } };
  const reset = (mode, withKey = true) => { TP.mode = mode; C.resetClaudianForTests(); C.setClaudianClientForTests(tclient); if (withKey) process.env.ANTHROPIC_API_KEY = 'sk-test-browser-must-never-appear'; else delete process.env.ANTHROPIC_API_KEY; };
  setting('CLAUDIAN_AI', 'ON'); setting('CLAUDIAN_USER_DAILY', '20'); setting('CLAUDIAN_ALL_DAILY', '2000'); C.noteClaudianSettingsWritten(db);
  reset('ok', false);
  const { page, ctx } = await portal('B5a');
  await page.evaluate(() => go('settings'));
  await until(page, () => { const c = document.getElementById('cpCard'); return c && /AI ON|AI IMEWASHWA/.test((document.getElementById('cpState') || {}).textContent || ''); }, null, 12000);
  const box = () => page.evaluate(() => { const b = document.getElementById('cpTestBox'); return b ? b.textContent.replace(/\s+/g, ' ').trim() : ''; });
  const press = async (want) => { await page.click('#cpTest'); await until(page, w => { const b = document.getElementById('cpTestBox'); return b && !/Inajaribu/.test(b.textContent) && (!w || new RegExp(w).test(b.textContent)); }, want, 8000); return box(); };
  check('B5 the card has the test button, marked temporary, enabled once the state has arrived', await page.evaluate(() => { const b = document.getElementById('cpTest'); return !!b && !b.disabled && /Jaribu AI \(ya muda\) \/ Test the AI \(temporary\)/.test(b.textContent); }));
  check('B5 there is no result box before the first press', (await box()) === '');
  // no key on this host: nothing is sent, and the host is named
  let t = await press('no ANTHROPIC_API_KEY|haina ufunguo');
  check('B5 NO KEY: the result says this host has no key, nothing was sent, and it names the host (not Vercel here)', /Seva hii haina ufunguo \/ This host has no ANTHROPIC_API_KEY/.test(t) && /Nothing was sent/.test(t) && /not Vercel/.test(t) && /Environment Variables, Production na Preview/.test(t) && TP.calls === 0, t.slice(0, 400));
  check('B5 and it is a failure to the eye (red chip)', await page.evaluate(() => !!document.querySelector('#cpTestBox .chip.bad')));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'claudian-test-nokey.png'), fullPage: false });
  // a key and a provider that answers
  reset('ok');
  t = await press('AI inajibu');
  check('B5 ANSWERED: the result says the AI answers, with the model, the time, the tokens and the answer', /AI inajibu \/ The AI answers/.test(t) && /claude-haiku-5-5/.test(t) && /5700 ndani \/ in, 4 nje \/ out/.test(t) && /“OK”/.test(t) && TP.calls === 1, t.slice(0, 400));
  check('B5 and it is a success to the eye (green chip)', await page.evaluate(() => !!document.querySelector('#cpTestBox .chip.ok')));
  check('B5 the request the provider was sent is the helper\'s own: Haiku 5.5, thinking off, effort low, one cached system block, no sampling settings', TP.last && TP.last.model === 'claude-haiku-5-5' && TP.last.thinking.type === 'disabled' && TP.last.output_config.effort === 'low' && TP.last.system[0].cache_control.type === 'ephemeral' && !('temperature' in TP.last) && !('tools' in TP.last), JSON.stringify(TP.last && Object.keys(TP.last)));
  check('B5 the key is nowhere on the page', !(await page.evaluate(() => document.documentElement.outerHTML)).includes('must-never-appear'));
  check('B5 the chip now says the AI is on with a key (the state came back with the result)', await page.evaluate(() => /AI IMEWASHWA \/ AI ON$/.test((document.getElementById('cpState') || {}).textContent.trim())), await page.evaluate(() => (document.getElementById('cpState') || {}).textContent));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'claudian-test-ok.png'), fullPage: false });
  // pressed again at once: told to wait, nothing sent
  t = await press('Subiri|Wait 5 seconds');
  check('B5 PRESSED AGAIN AT ONCE: told to wait five seconds, and nothing more was sent', /Subiri sekunde 5 kisha bonyeza tena \/ Wait 5 seconds and press again/.test(t) && TP.calls === 1, t);
  // a repaint (a table search) keeps the result and the button still works
  await page.evaluate(() => { var q = document.getElementById('q') || document.querySelector('input[type=search]'); if (q) { q.value = 'zzz'; q.dispatchEvent(new Event('input', { bubbles: true })); } else { paint(true); } });
  await page.waitForTimeout(300);
  check('B5 after a repaint the result is still there', /Wait 5 seconds/.test(await box()));
  // each refusal, in words, with the provider's own
  reset('401');
  t = await press('refused the key');
  check('B5 REFUSED KEY (401): the result says so with the status, the error type, the request id and the provider\'s words; the card\'s last problem says it too', /Mtoa huduma amekataa ufunguo \/ The provider refused the key/.test(t) && /Hali \/ Status: 401/.test(t) && /authentication_error/.test(t) && /req_011BROWSER/.test(t) && /invalid x-api-key/.test(t)
    && /Last problem: the provider refused the key/.test(await text_()), t.slice(0, 400));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'claudian-test-refused.png'), fullPage: false });
  reset('429');
  t = await press('Limit or credit');
  check('B5 LIMIT OR CREDIT (429): said, with where to look', /Kikomo au mkopo \/ Limit or credit/.test(t) && /Billing/.test(t) && /Hali \/ Status: 429/.test(t), t.slice(0, 300));
  reset('400');
  t = await press('rejects our request');
  check('B5 OUR REQUEST REJECTED (400): said, with the provider\'s words', /Mtoa huduma hakubali ombi letu \/ The provider rejects our request/.test(t) && /thinking is not supported/.test(t), t.slice(0, 300));
  // what a provider says is text, never markup
  reset('evil');
  t = await press('did not answer');
  const xss = await page.evaluate(() => ({ img: !!document.querySelector('#cpTestBox img'), script: !!document.querySelector('#cpTestBox script'), flag: window.__xss || 0 }));
  check('B5 A TAG IN THE PROVIDER\'S WORDS is shown as text and runs nothing', xss.img === false && xss.script === false && xss.flag === 0 && /<img src=x/.test(t), JSON.stringify(xss) + ' ' + t.slice(0, 200));
  // the screen forgets an old result when it is opened again
  await page.evaluate(() => go('dashboard'));
  await page.waitForTimeout(200);
  await page.evaluate(() => go('settings'));
  await until(page, () => { const c = document.getElementById('cpCard'); return c && /AI ON|AI IMEWASHWA/.test((document.getElementById('cpState') || {}).textContent || ''); }, null, 12000);
  check('B5 opening Settings again starts without an old result (a "no key" read before a redeploy must not outlive it)', (await box()) === '');
  delete process.env.ANTHROPIC_API_KEY;
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests();
  await ctx.close();
  async function text_() { return page.evaluate(() => (document.getElementById('cpCard') || {}).textContent || ''); }
});

/* ================================================= C. HOPE CALLS ================================================= */
await section('C (calls)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests();
  seen.module.length = 0; seen.claudian.length = 0; DEVICE = 'dF';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('C: ' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('C console: ' + m.text()); });
  page.setDefaultTimeout(9000);
  await page.addInitScript(SPEED, 8000);          // the call app's late timer is left at its own eight seconds
  await page.goto(base + '/call');
  await page.waitForFunction(() => !!document.getElementById('listQ') && typeof S === 'object' && S.entered === true, null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(150);
  check('C1 the app is open and nothing of the helper has been asked for yet (the module, nor the server)', seen.module.length === 0 && seen.claudian.length === 0, JSON.stringify([seen.module, seen.claudian.length]));
  const bubble = await until(page, () => !!document.getElementById('claudianPMO'), null, 20000);
  check('C1 the bubble arrives after the late timer', bubble);
  const late = await page.evaluate(() => window.__late);
  check('C1 the timer the app asked for is eight seconds, and the module is fetched once, by the CALL build', late.includes(8000) && seen.module.length === 1 && seen.module[0] === '?v=' + CALL_BUILD, JSON.stringify([late, seen.module, CALL_BUILD]));
  check('C1 the server is still asked nothing', seen.claudian.length === 0, JSON.stringify(seen.claudian));
  let s = await shape(page);
  check('C1 it sits in the call app\'s layer (38: under its sheets) and inside the screen, above the tab bar', s && s.z === '38' && inside(s) && s.bub.y < s.vh - 90, JSON.stringify(s && [s.z, s.bub]));
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  s = await shape(page);
  const st = asks('status');
  check('C2 a tap asks as the HANDSET (its device id), not with an access code', st.length === 1 && typeof st[0].device === 'string' && st[0].device.length > 0 && !st[0].code && st[0].lang === 'sw', JSON.stringify(st));
  check('C2 the choices include the call app\'s own (portfolio call, Amepigiwa leo, Ana namba nyingine)', s.chips.some(c => /Amepigiwa leo/.test(c)) && s.chips.some(c => /namba nyingine/i.test(c)), JSON.stringify(s.chips));
  check('C2 the panel is a sheet inside the 390 pixel screen, and the list underneath did not move', s.sheet && panelInside(s) && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'claudian-call-sheet.png') });
  await page.keyboard.press('Escape');
  // signing out takes it away
  await page.evaluate(() => { try { doLogout(); } catch (e) {} });
  await page.waitForTimeout(200);
  check('C3 signing out of the app takes the bubble away', await page.evaluate(() => document.getElementById('claudianPMO').style.display === 'none'));
  await ctx.close();
});

// ---- the handset is shared: signing out forgets the officer who left, and the next one meets an empty panel and sends none of the last one's words
await section('C2 (sign-out forgets)', async () => {
  setting('CLAUDIAN_AI', 'ON'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); PROV.text = 'Piga wateja wa leo kwanza.';
  seen.claudian.length = 0; DEVICE = 'dF';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('C2: ' + String(e)));
  page.setDefaultTimeout(9000);
  await page.addInitScript(SPEED, 1500);
  await page.goto(base + '/call');
  await page.waitForFunction(() => typeof S === 'object' && S.entered === true, null, { timeout: 12000 }).catch(() => {});
  await until(page, () => !!document.getElementById('claudianPMO'), null, 20000);
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  await page.locator('textarea').fill('Timu yangu inadaiwa kiasi gani?');
  await page.keyboard.press('Enter');
  await waitAnswer(page, 2);
  const hadKept = await kept(page, 'claudianChat.call');
  await page.evaluate(() => { try { doLogout(); } catch (e) {} });
  await page.waitForTimeout(200);
  check('C4 the conversation was kept for the next visit, and signing out deleted it (the handset is shared)', typeof hadKept === 'string' && hadKept.length > 20 && (await kept(page, 'claudianChat.call')) === null, JSON.stringify([String(hadKept).slice(0, 40), await kept(page, 'claudianChat.call')]));
  const after = await page.evaluate(() => { const h = document.getElementById('claudianPMO'), r = h.shadowRoot; return { host: h.style.display, open: /\bopen\b/.test(r.querySelector('.panel').className), lines: r.querySelectorAll('.body .m:not(.w)').length, box: r.querySelector('textarea').value }; });
  check('C4 signing out forgets the conversation: the panel is closed and holds no line of the officer who left', after.host === 'none' && !after.open && after.lines === 0 && after.box === '', JSON.stringify(after));
  await page.evaluate(() => window.ClaudianPMO.show());
  seen.claudian.length = 0;
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  await page.locator('textarea').fill('Na ahadi za leo?');
  await page.keyboard.press('Enter');
  await waitAnswer(page, 2);
  const nxt = asks('ask');
  check('C4 the next officer\'s first question carries NO exchange of the one who left, and the list was asked for again', nxt.length === 1 && Array.isArray(nxt[0].hist) && nxt[0].hist.length === 0 && asks('status').length === 1, JSON.stringify([nxt.map(a => a.hist), asks('status').length]));
  const quoted = asked.filter(r => /Timu yangu inadaiwa/.test(r.messages[0].content) && /Na ahadi za leo/.test(r.messages[0].content));
  check('C4 and the model was never given the last officer\'s words as the previous exchange', quoted.length === 0, String(quoted.length));
  await ctx.close();
});

// ---- HOPE Calls: the officer finds their conversation after the app is opened again, and the instruction's link is a link
await section('C5 (history in HOPE Calls)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests();
  seen.claudian.length = 0; DEVICE = 'dF';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('C5: ' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('C5 console: ' + m.text()); });
  page.setDefaultTimeout(9000);
  await page.addInitScript(SPEED, 1500);
  const enter = async () => { await page.waitForFunction(() => typeof S === 'object' && S.entered === true, null, { timeout: 12000 }).catch(() => {}); await until(page, () => !!document.getElementById('claudianPMO'), null, 20000); };
  await page.goto(base + '/call');
  await enter();
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  const concern = page.locator('.chip[data-id="call-not-ticked"]');
  check('C5 the concern "Amepigiwa leo did not appear" is one of the officer\'s ready questions', (await concern.count()) === 1);
  await concern.click(); await waitAnswer(page, 2);
  let cv = await convo(page);
  const ans = cv[cv.length - 1];
  check('C5 its answer ends with the instruction to close the app and open it again so it asks for permissions', /close the app completely|funga programu kabisa/i.test(ans.text) && /permission|ruhusa/i.test(ans.text), ans.text.slice(-260));
  check('C5 and the release address in it is a link a finger can tap, opening outside the app', ans.links.length === 1 && ans.links[0].href === APK && ans.links[0].target === '_blank' && /noopener/.test(ans.links[0].rel), JSON.stringify(ans.links));
  const dev = await page.evaluate(() => (typeof DEV === 'string' ? DEV : ''));
  const raw = await kept(page, 'claudianChat.call');
  check('C5 the conversation is kept under the call app\'s own key, with a mark and not the handset\'s id', typeof raw === 'string' && JSON.parse(raw).v === 1 && (dev.length < 8 || !raw.includes(dev)) && (await kept(page, 'claudianChat.portal')) === null, JSON.stringify([dev.length, String(raw).slice(0, 60)]));
  // the app is opened again (the page reloads, a handset brings it back from the background)
  const asked0 = seen.claudian.length;
  await page.reload();
  await enter();
  await page.waitForTimeout(200);
  check('C5 after the reload the server has been asked nothing', seen.claudian.length === asked0, JSON.stringify(seen.claudian.slice(asked0)));
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  const back = await convo(page);
  check('C5 the officer finds the same conversation, the link included, and not a new empty chat', JSON.stringify(back.map(x => [x.kind, x.text])) === JSON.stringify(cv.map(x => [x.kind, x.text])) && back[back.length - 1].links.length === 1 && back[back.length - 1].links[0].href === APK, JSON.stringify(back.map(x => x.kind)));
  const vis = await latestShown(page);
  check('C5 the sheet opens on the latest question', vis && vis.within, JSON.stringify(vis));
  check('C5 it stays inside the 390 pixel screen', (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) && panelInside(await shape(page)));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'claudian-call-history.png') });
  // another officer on the same handset: the sign-out forgets (C2 above), and a record that is not theirs is never shown
  await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('claudianChat.call')); r.who = 'someone.else'; localStorage.setItem('claudianChat.call', JSON.stringify(r)); });
  await page.reload();
  await enter();
  await tap(page);
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  check('C5 a conversation that is not this handset\'s officer\'s is not shown, and is deleted', (await convo(page)).length === 0 && (await kept(page, 'claudianChat.call')) === null);
  await ctx.close();
});

// ---- ONE HANDSET, TWO OFFICERS (handbook Part 167, addendum 1): a handset that is re-registered as another officer, de-registered, or registered afresh passes through no log-out
const callPage = async (label, { seed = null } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(label + ': ' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push(label + ' console: ' + m.text()); });
  page.setDefaultTimeout(9000);
  await page.addInitScript(SPEED, 1500);
  await page.goto(base + '/call');
  return { ctx, page };
};
const inCall = async page => { await page.waitForFunction(() => typeof S === 'object' && S.entered === true, null, { timeout: 12000 }).catch(() => {}); await until(page, () => !!document.getElementById('claudianPMO'), null, 20000); };
const choicesIn = page => until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);

await section('C6 (the handset is handed to another officer)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0; DEVICE = 'dF';
  const row = db._dump('call_users').find(r => r.device_id === 'dF');
  const juma = row.name;
  try {
    // ONE page throughout: the same handset (its device id and its storage), reloaded, with another officer registered to it
    const a = await callPage('C6');
    await inCall(a.page);
    await tap(a.page); await choicesIn(a.page);
    await a.page.locator('.chip').first().click(); await waitAnswer(a.page, 2);
    const raw = await kept(a.page, 'claudianChat.call');
    check('C6 the first officer\'s conversation is kept', typeof raw === 'string' && JSON.parse(raw).m.length >= 2);
    await a.page.reload(); await inCall(a.page);
    await tap(a.page); await choicesIn(a.page); await idle(a.page);
    check('C6 the same officer, the app opened again, finds it', (await convo(a.page)).length >= 2, JSON.stringify((await convo(a.page)).map(x => x.kind)));
    // the PMO registers ANOTHER officer to this handset: no log-out of ours is passed
    row.name = 'ASHA KOMBO';
    await a.page.reload(); await inCall(a.page);
    check('C6 the page now names the new officer', (await a.page.evaluate(() => S.boot && S.boot.name)) === 'ASHA KOMBO');
    await tap(a.page); await choicesIn(a.page); await idle(a.page);
    check('C6 the next officer meets an EMPTY panel, not the last one\'s questions and answers', (await convo(a.page)).length === 0, JSON.stringify((await convo(a.page)).map(x => x.text.slice(0, 40))));
    check('C6 and what the last officer asked is deleted from the handset', (await kept(a.page, 'claudianChat.call')) === null);
    await a.page.locator('.chip').first().click(); await waitAnswer(a.page, 2);
    const mine = await kept(a.page, 'claudianChat.call');
    check('C6 the new officer\'s own conversation is kept under their own mark', mine !== null && JSON.parse(mine).who !== JSON.parse(raw).who);
    await a.ctx.close();
  } finally { row.name = juma; }
});

await section('C7 (the server says the handset is no longer signed in)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0; DEVICE = 'dF';
  try {
    const a = await callPage('C7');
    await inCall(a.page);
    await tap(a.page); await choicesIn(a.page);
    await a.page.locator('.chip').first().click(); await waitAnswer(a.page, 2);
    check('C7 a conversation is kept while the officer is signed in', (await kept(a.page, 'claudianChat.call')) !== null);
    // the PMO de-registers the handset: the next time the app asks the server it is told it is no longer signed in (the officer's helper is mounted)
    DEVICE = 'dGone';
    await Promise.all([a.page.waitForNavigation({ timeout: 9000 }).catch(() => {}), a.page.evaluate(() => { boot(); })]);
    await a.page.waitForTimeout(500);
    check('C7 the app is back on its sign-in screen', await a.page.evaluate(() => !document.getElementById('scrRegister').classList.contains('hide')));
    check('C7 and the officer who is gone took their helper conversation with them', (await kept(a.page, 'claudianChat.call')) === null);
    await a.ctx.close();
  } finally { DEVICE = 'dF'; }
});

await section('C8 (a handset registered afresh starts with an empty helper)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0; DEVICE = 'dF';
  try {
    // the officer who was here leaves a conversation; the handset reaches its sign-in screen by a road that forgets nothing (a state the other roads can leave behind: an app update, a restored backup)
    const a = await callPage('C8');
    await inCall(a.page);
    await tap(a.page); await choicesIn(a.page);
    await a.page.locator('.chip').first().click(); await waitAnswer(a.page, 2);
    check('C8 the officer who was here left a conversation', (await kept(a.page, 'claudianChat.call')) !== null);
    DEVICE = 'dNew';
    await a.page.evaluate(() => { localStorage.setItem('hcLoggedOut', '1'); localStorage.removeItem('hcBoot_v1'); });
    await a.page.reload();
    await a.page.waitForFunction(() => !document.getElementById('scrRegister').classList.contains('hide'), null, { timeout: 12000 }).catch(() => {});
    check('C8 a handset that is on its sign-in screen holds no helper conversation (nobody is signed in on it)', (await kept(a.page, 'claudianChat.call')) === null);
    // what a handset passed on could still hold: a record marked by the device id alone (the first form of the mark), left by a road that forgets nothing
    const dev = await a.page.evaluate(() => DEV);
    await a.page.evaluate(v => localStorage.setItem('claudianChat.call', JSON.stringify(v)), { v: 1, who: markOf(dev), at: Date.now(), ha: 0, hist: null, m: [['u', 'a question of the last officer'], ['a', 'an answer for the last officer']] });
    // a new officer registers
    await a.page.fill('#regPhone', '0712123456'); await a.page.fill('#regName', 'NEW OFFICER'); await a.page.fill('#regPass', 'KON123');
    await a.page.click('#regBtn');
    await a.page.waitForFunction(() => typeof S === 'object' && S.entered === true, null, { timeout: 12000 }).catch(() => {});
    check('C8 the new officer is in', (await a.page.evaluate(() => S.boot && S.boot.name)) === 'NEW OFFICER');
    check('C8 registering started the helper empty: the last officer\'s conversation is gone from the handset at once, before the helper is even loaded', (await kept(a.page, 'claudianChat.call')) === null);
    await until(a.page, () => !!document.getElementById('claudianPMO'), null, 20000);
    await tap(a.page); await choicesIn(a.page); await idle(a.page);
    check('C8 and the panel holds nothing of the last officer', (await convo(a.page)).length === 0);
    await a.ctx.close();
  } finally {
    DEVICE = 'dF';
    const users = db._dump('call_users'); const i = users.findIndex(r => r.device_id === 'dNew'); if (i >= 0) users.splice(i, 1);
  }
});


// ---- THE SECOND READER'S FINDINGS ON THE KEPT CONVERSATION (handbook Part 167, addendum 2). Each of F1 to F3 and F5 is a point that was RED on the code as merged (#832/#833) and is green now.
await section('R1 (a boot answer that lands after the module mounted, naming another officer: F2)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0; DEVICE = 'dF';
  const row = db._dump('call_users').find(r => r.device_id === 'dF');
  const juma = row.name;
  try {
    const a = await callPage('R1');
    await inCall(a.page);
    await tap(a.page); await choicesIn(a.page);
    await a.page.locator('.chip').first().click(); await waitAnswer(a.page, 2);
    const cvJ = await convo(a.page);
    const rawJ = JSON.parse(await kept(a.page, 'claudianChat.call'));
    const dev = await a.page.evaluate(() => DEV);
    check('R1 setup: JUMA ISSA has a kept conversation under mark(dev|JUMA ISSA)', cvJ.length >= 2 && rawJ.who === markOf(dev + '|JUMA ISSA'), JSON.stringify([cvJ.length, rawJ.who]));
    // the PMO re-pointed the handset's account to ASHA KOMBO, and the network is slow: the boot answer comes AFTER the module mounted (the page's 8 s timer is compressed to 1.5 s, the answer is held 6 s)
    row.name = 'ASHA KOMBO'; seen.delayBoot = 6000; seen.bootCalls.length = 0;
    await a.page.reload();
    await until(a.page, () => !!document.getElementById('claudianPMO'), null, 20000);
    const atMount = await a.page.evaluate(() => ({ name: S.boot && S.boot.name, entered: S.entered }));
    check('R1 at mount the page still names the PREVIOUS officer (the warm entry): the known window of Part 167 addendum 1', atMount.name === 'JUMA ISSA', JSON.stringify(atMount));
    const landed = await until(a.page, () => S.boot && S.boot.name === 'ASHA KOMBO', null, 15000);
    check('R1 the server\'s fresh answer lands and the page now names ASHA KOMBO', landed);
    seen.delayBoot = 0;
    await a.page.waitForTimeout(300);
    const linesAfter = (await convo(a.page)).map(x => x.text.slice(0, 50));
    check('R1 CLAIM OF #833, kept: the moment the answer arrives the panel holds NONE of JUMA\'s lines', linesAfter.length === 0, JSON.stringify(linesAfter));
    check('R1 and JUMA\'s kept record is deleted from the handset (not re-owned by ASHA)', (await kept(a.page, 'claudianChat.call')) === null, String(await kept(a.page, 'claudianChat.call')).slice(0, 80));
    check('R1 the bubble is still there for ASHA (shown, not hidden)', await a.page.evaluate(() => { const h = document.getElementById('claudianPMO'); return !!h && h.style.display !== 'none'; }));
    await tap(a.page); await choicesIn(a.page); await idle(a.page);
    await a.page.locator('.chip').nth(1).click(); await waitAnswer(a.page, 2);
    const rawA = JSON.parse(await kept(a.page, 'claudianChat.call'));
    check('R1 ASHA\'s record is ASHA\'s mark and holds NONE of JUMA\'s lines', rawA.who === markOf(dev + '|ASHA KOMBO') && !cvJ.some(x => rawA.m.some(l => l[1] === x.text)), JSON.stringify(rawA.m.map(l => String(l[1]).slice(0, 40))));
    await a.page.reload(); await inCall(a.page);
    await tap(a.page); await choicesIn(a.page); await idle(a.page);
    const found = (await convo(a.page)).map(x => x.text.slice(0, 50));
    check('R1 ASHA, after a normal reload, finds her own two lines and none of JUMA\'s', found.length >= 2 && !cvJ.some(x => found.includes(x.text.slice(0, 50))), JSON.stringify(found));
    await a.ctx.close();
  } finally { row.name = juma; seen.delayBoot = 0; }
});

await section('R10 (the portal door of a handset whose account the PMO re-pointed: F1)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0; DEVICE = 'dF';
  const row = db._dump('call_users').find(r => r.device_id === 'dF');
  const juma = row.name;
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const openPortal = async () => {                                  // the portal in the same storage, signed in with what the call app left in hopeCode (a team code on a real handset; 'ADM' here)
      const p = await ctx.newPage(); p.setDefaultTimeout(9000);
      await p.addInitScript(SPEED, 1500);
      await p.goto(base + '/');
      const code = await p.evaluate(() => localStorage.getItem('hopeCode') || 'ADM');
      const me = { name: USERS.ADM.name, role: USERS.ADM.role, teams: USERS.ADM.teams, teamCount: null, tabs: USERS.ADM.tabs, can: { dashboard: true, upload: false, admin: true } };
      await p.evaluate(([m, c]) => { S.code = c; start(m); S.lang = 'sw'; }, [me, code]);
      await p.waitForFunction(() => !!document.getElementById('claudianPMO'), null, { timeout: 12000 }).catch(() => {});
      return p;
    };
    // officer JUMA works on this handset: the call app, and the portal through the door (hopeCode is what the registration left)
    const call = await ctx.newPage(); call.setDefaultTimeout(9000); await call.addInitScript(SPEED, 1500);
    await call.goto(base + '/call'); await inCall(call);
    await call.evaluate(() => localStorage.setItem('hopeCode', 'ADM'));
    await tap(call); await choicesIn(call); await call.locator('.chip').first().click(); await waitAnswer(call, 2);
    const p1 = await openPortal();
    await tap(p1); await until(p1, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
    await p1.locator('.chip').nth(2).click(); await waitAnswer(p1, 2);
    check('R10 setup: JUMA has a call-app conversation and a portal conversation on the handset', (await kept(call, 'claudianChat.call')) !== null && (await kept(p1, 'claudianChat.portal')) !== null && (await convo(p1)).length >= 2);
    await p1.close();
    // the PMO re-points the account at ASHA (no registration form, no log-out); ASHA opens the app and then the portal door
    row.name = 'ASHA KOMBO';
    await call.reload(); await inCall(call);
    check('R10 the app names ASHA KOMBO and her call-app helper is empty', (await call.evaluate(() => S.boot.name)) === 'ASHA KOMBO' && (await tap(call), await choicesIn(call), await idle(call), (await convo(call)).length === 0));
    const p2 = await openPortal();
    await tap(p2); await until(p2, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0); await idle(p2);
    const meets = (await convo(p2)).map(x => x.text.slice(0, 40));
    check('R10 and through the portal door ASHA meets NONE of JUMA\'s portal conversation', meets.length === 0, JSON.stringify(meets));
    await ctx.close();
  } finally { row.name = juma; }
});

await section('R2 (the server refuses the code: "you have been signed out" forgets the conversation: F3)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0;
  seen.brand = true;                                         // the normal page: brand.js is loaded (HOPESession exists)
  try {
    const { page, ctx } = await portal('R2');
    check('R2 setup: the page has the system\'s one sign-out (HOPESession)', await page.evaluate(() => typeof window.HOPESession === 'object'));
    await page.evaluate(() => localStorage.setItem('hopeCode', 'ADM'));
    await tap(page);
    await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
    await page.locator('.chip').first().click(); await waitAnswer(page, 2);
    check('R2 setup: a conversation is kept', (await kept(page)) !== null);
    seen.portal401 = true;
    await page.evaluate(() => { srv('teams').catch(function () {}); });
    await page.waitForTimeout(800);
    const code = await page.evaluate(() => localStorage.getItem('hopeCode'));
    const msg = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 140));
    check('R2 the page signs the person out ("you have been signed out") and drops hopeCode', code === null && /signed out/i.test(msg), JSON.stringify([code, msg]));
    check('R2 and the kept conversation is gone with it, on both pages\' keys', (await kept(page)) === null && (await kept(page, 'claudianChat.call')) === null, String(await kept(page)).slice(0, 100));
    seen.portal401 = false;
    // the same code comes back (a rotated code put back): the person finds no conversation they were signed out of
    await reenter(page, 'ADM');
    await tap(page);
    await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
    check('R2 after being signed out, the same code finds NO conversation', (await convo(page)).length === 0, JSON.stringify((await convo(page)).map(x => x.text.slice(0, 40))));
    await ctx.close();
  } finally { seen.portal401 = false; seen.brand = false; }
});

await section('R2b (a stored code the server refuses at load forgets the conversation: F3)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0;
  seen.brand = true; seen.meRefuse = true;
  try {
    const rec = { v: 1, who: markOf('ADM'), at: Date.now(), ha: 0, hist: null, m: [['u', 'a question of long ago'], ['a', 'an answer of long ago']] };
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage(); page.setDefaultTimeout(6000);
    page.on('pageerror', e => errs.push('R2b: ' + String(e)));
    await page.addInitScript(r => { try { localStorage.setItem('hopeCode', 'ADM'); localStorage.setItem('claudianChat.portal', JSON.stringify(r)); } catch (e) {} }, rec);
    await page.goto(base + '/');
    await page.waitForTimeout(800);
    const v = await page.evaluate(() => [localStorage.getItem('hopeCode'), localStorage.getItem('claudianChat.portal'), localStorage.getItem('claudianChat.call')]);
    check('R2b the stored code is refused at load: the code goes and the kept conversation goes with it', v[0] === null && v[1] === null, JSON.stringify(v).slice(0, 160));
    await ctx.close();
  } finally { seen.meRefuse = false; seen.brand = false; }
});

await section('R11 (the page comes to name another person while the module is mounted: the module forgets the last one before the panel opens or a question is asked: F2, the module\'s own net)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0;
  // the first code's conversation was kept: it is drawn again when the module mounts (the page names that code then)
  const seed = { v: 1, who: markOf('ADM'), at: Date.now(), ha: 0, hist: null, m: [['u', 'a question kept for the first code'], ['a', 'an answer kept for the first code']] };
  const { page, ctx } = await portal('R11', { store: { 'claudianChat.portal': JSON.stringify(seed) } });
  const restored = (await convo(page)).map(x => x.text.slice(0, 30));
  check('R11 setup: the first code\'s conversation is drawn again at mount', restored.length === 2 && (await kept(page)) !== null, JSON.stringify(restored));
  // the page comes to name ANOTHER person before anybody has touched the panel (the late boot answer of a handset, a code changed in the same page)
  await page.evaluate(() => { S.code = 'CLK'; });
  await tap(page); await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0); await idle(page);
  const opened = (await convo(page)).map(x => x.text.slice(0, 40));
  check('R11 the panel opened for the new person holds NONE of the last person\'s lines, and the copy kept for the next visit is gone', opened.length === 0 && (await kept(page)) === null, JSON.stringify([opened, String(await kept(page)).slice(0, 60)]));
  await page.locator('.chip').nth(1).click(); await waitAnswer(page, 2);
  const rec2 = JSON.parse(await kept(page));
  check('R11 the new person\'s own conversation is kept under their own mark, and holds only their own lines', rec2.who === markOf('CLK') && rec2.m.length >= 2 && !rec2.m.some(l => /kept for the first code/.test(String(l[1]))), JSON.stringify([rec2.who, rec2.m.map(l => String(l[1]).slice(0, 30))]));
  // the person changes while the panel is OPEN and the new person types a question and presses Send: their question is kept, the last one's lines are not, and the panel stays open
  await page.evaluate(() => { S.code = 'ADM'; });
  await page.locator('textarea').fill('target za timu'); await page.keyboard.press('Enter');
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.body .m.u').length >= 1); await idle(page);
  const after = await convo(page);
  check('R11 asking after the person changed: only the new question and its answer are there, none of the last person\'s', after.filter(x => x.kind === 'u').length === 1 && after.some(x => /target za timu/.test(x.text)) && !after.some(x => rec2.m.some(l => String(l[1]).slice(0, 30) === x.text.slice(0, 30) && l[0] !== 'u')), JSON.stringify(after.map(x => x.kind + ':' + x.text.slice(0, 30))));
  check('R11 and the panel stayed open for them', (await shape(page)).open === true);
  const rec3 = JSON.parse(await kept(page));
  check('R11 and what is kept is the new mark with their own lines only', rec3.who === markOf('ADM') && rec3.m.length === after.length, JSON.stringify([rec3.who, rec3.m.length, after.length]));
  // and the same when the new person taps a ready question instead of typing
  await page.evaluate(() => { S.code = 'CLK'; });
  await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0);
  const before = (await convo(page)).length;
  await page.locator('.chip').first().click(); await waitAnswer(page, 2); await idle(page);
  const tapped = await convo(page);
  check('R11 tapping a ready question after the person changed: only that question and its answer are there', before >= 3 && tapped.filter(x => x.kind === 'u').length === 1, JSON.stringify([before, tapped.map(x => x.kind + ':' + x.text.slice(0, 24))]));
  await ctx.close();
});

await section('R9 (the PMO corrects the registered name of the same officer: F5, the trade-off kept on purpose)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0; DEVICE = 'dF';
  const row = db._dump('call_users').find(r => r.device_id === 'dF');
  const juma = row.name;
  try {
    const a = await callPage('R9');
    await inCall(a.page);
    const uid0 = await a.page.evaluate(() => S.boot.userId);
    await tap(a.page); await choicesIn(a.page);
    await a.page.locator('.chip').first().click(); await waitAnswer(a.page, 2);
    check('R9 setup: the officer has a kept conversation', (await convo(a.page)).length >= 2);
    row.name = 'JUMA ISSA KOMBO';                                  // the PMO completes the name; same phone, same user id, same handset
    await a.page.reload(); await inCall(a.page);
    const after = await a.page.evaluate(() => ({ uid: S.boot.userId, name: S.boot.name }));
    await tap(a.page); await choicesIn(a.page); await idle(a.page);
    check('R9 the page knows it is the same person (same userId) after the name was completed', after.uid === uid0 && after.name === 'JUMA ISSA KOMBO', JSON.stringify([uid0, after]));
    // A completed name and an account handed to another person look the same to the page (the user id comes from the phone number), so a changed name forgets: said in Part 167, addendum 2, and to the owner
    check('R9 and a changed name forgets the conversation, on purpose (a correction and a hand-over look the same to the page)', (await convo(a.page)).length === 0 && (await kept(a.page, 'claudianChat.call')) === null);
    await a.ctx.close();
  } finally { row.name = juma; }
});

await section('R5d (sign-out while a question is in flight: the next person is not left busy: T1)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0;
  const { page, ctx } = await portal('R5d');
  await tap(page); await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0); await idle(page);
  seen.delayAsk = 2500;
  await page.locator('textarea').fill('target za timu'); await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.ClaudianPMO.hide(); });           // what the Toka / doLogout do
  await page.waitForTimeout(3000); seen.delayAsk = 0;
  await page.evaluate(() => { window.ClaudianPMO.show(); });
  await tap(page); await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0); await idle(page);
  const s = await page.evaluate(() => { const r = document.getElementById('claudianPMO').shadowRoot; return { sendDisabled: r.querySelector('.send').disabled, lines: [...r.querySelectorAll('.body .m')].slice(1).map(x => x.textContent.slice(0, 40)), kept: localStorage.getItem('claudianChat.portal') }; });
  check('R5d after sign-out with an answer in flight the next person finds Send enabled, no line of the last one, and nothing kept', !s.sendDisabled && s.lines.length === 0 && s.kept === null, JSON.stringify(s));
  await ctx.close();
});

await section('R7 (the last person\'s UNSENT draft in the box at sign-out: T1)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0;
  const { page, ctx } = await portal('R7');
  await tap(page); await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0); await idle(page);
  await page.locator('textarea').fill('Mshahara wangu ni kiasi gani na kwa nini nimekatwa?');          // typed, never sent
  await page.evaluate(() => { window.ClaudianPMO.hide(); });                                           // what the Toka / doLogout do
  await page.evaluate(() => { window.ClaudianPMO.show(); });
  await tap(page); await until(page, () => document.getElementById('claudianPMO').shadowRoot.querySelectorAll('.chip').length > 0); await idle(page);
  const box = await page.evaluate(() => document.getElementById('claudianPMO').shadowRoot.querySelector('textarea').value);
  check('R7 after a sign-out the next person finds the box EMPTY (not the last person\'s unsent draft)', box === '', JSON.stringify(box));
  await ctx.close();
});

await section('R6 (the same page: sign-out, then another officer registers: the bubble comes back, empty: T2)', async () => {
  setting('CLAUDIAN_AI', 'OFF'); C.noteClaudianSettingsWritten(db); C.resetClaudianForTests(); seen.claudian.length = 0; DEVICE = 'dF';
  try {
    const a = await callPage('R6');
    await inCall(a.page);
    await tap(a.page); await choicesIn(a.page);
    await a.page.locator('.chip').first().click(); await waitAnswer(a.page, 2);
    check('R6 setup: the first officer has a kept conversation', (await kept(a.page, 'claudianChat.call')) !== null);
    await a.page.evaluate(() => { doLogout(); });
    await a.page.waitForTimeout(300);
    DEVICE = 'dNew';
    await a.page.fill('#regPhone', '0712123456'); await a.page.fill('#regName', 'NEW OFFICER'); await a.page.fill('#regPass', 'KON123');
    await a.page.click('#regBtn');
    await a.page.waitForFunction(() => typeof S === 'object' && S.entered === true, null, { timeout: 12000 }).catch(() => {});
    await a.page.waitForTimeout(400);
    const shown = await a.page.evaluate(() => { const h = document.getElementById('claudianPMO'); return h ? h.style.display : 'NO HOST'; });
    check('R6 the new officer, in the same page, is offered the bubble (the host is not display:none)', shown !== 'none', String(shown));
    await tap(a.page); await choicesIn(a.page); await idle(a.page);
    check('R6 and the panel holds nothing of the first officer', (await convo(a.page)).length === 0);
    await a.ctx.close();
  } finally {
    DEVICE = 'dF';
    const users = db._dump('call_users'); const i = users.findIndex(r => r.device_id === 'dNew'); if (i >= 0) users.splice(i, 1);
  }
});

await browser.close(); srv.close(); console.warn = warn;
for (const f of ok) console.log('ok   ' + f);
for (const f of fail) console.log('FAIL ' + f);
for (const e of errs) console.log('ERR  ' + e);
console.log('\n' + ok.length + ' passed, ' + fail.length + ' failed, ' + errs.length + ' page errors');
process.exit(fail.length || errs.length ? 1 : 0);
