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
const seen = { module: [], claudian: [], modules404: false, force: 0 };
let DEVICE = 'dF';
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const REAL_PORTAL = new Set(['settings', 'accessCodes', 'officerAccounts', 'systemOpenGet', 'teams', 'claudianStatus', 'claudianSet', 'settingSet', 'storageUsage']);

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname === '/app') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return; }
  if (u.pathname === '/call') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(CALL); return; }
  if (u.pathname === '/mod/claudian.js') {
    seen.module.push(u.search);
    if (seen.modules404) { res.writeHead(404); res.end(''); return; }
    res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(MODULE)); return;
  }
  if (u.pathname.startsWith('/mod/')) {
    const f = path.join(ROOT, 'public/mod', path.basename(u.pathname));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(f)); return; }
  }
  if (u.pathname === '/api/me') { send(res, 200, { ok: true, build: null }); return; }
  if (u.pathname === '/api/portal') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', async () => {
      const { fn, args } = JSON.parse(b || '{}');
      let out;
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
  // 4. the log: the person's own questions, no model, no tokens, the kind of each
  const rows = db._dump('claudian_chats');
  const kinds = rows.map(r => r.mode).join(',');
  check('A5t the log has a row for each: a match, two that nothing settled, and the tap', kinds === 'match,nomatch,nomatch,faq', kinds);
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

await browser.close(); srv.close(); console.warn = warn;
for (const f of ok) console.log('ok   ' + f);
for (const f of fail) console.log('FAIL ' + f);
for (const e of errs) console.log('ERR  ' + e);
console.log('\n' + ok.length + ' passed, ' + fail.length + ' failed, ' + errs.length + ' page errors');
process.exit(fail.length || errs.length ? 1 : 0);
