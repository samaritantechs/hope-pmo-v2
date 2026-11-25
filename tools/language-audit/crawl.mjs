// Runtime crawl of the portal: every tab opened in a real browser against the real portalApi over the fake database;
// collects every text node and every shown attribute. Used to check the static vocabulary for gaps.
process.env.SUPABASE_URL = 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node ' + path.basename(fileURLToPath(import.meta.url)) + ' <output .json file>'); process.exit(2); }
const { chromium } = await import(ROOT + '/node_modules/playwright-core/index.mjs');
const { fakeDb } = await import(ROOT + '/test/fake-db.mjs');
const { portalApi } = await import(ROOT + '/api/_lib/portal-core.js');
const APP = fs.readFileSync(ROOT + '/public/app.html', 'utf8');
const NAVIDS = [...APP.matchAll(/\{\s*id:'([a-z0-9_]+)'[^}]*?label:'/g)].map((m) => m[1]);

const eat = (ms) => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
const TODAY = eat(Date.now());
const rpc = {
  notice_payments: (store, args) => args.p_refs.map((ref, i) => ({ ref, since: args.p_dates[i], paid: 0, n: 0, last_paid: null, n_phone: 0 })),
  fold_notice_payments: () => 0,
};
const db = fakeDb({
  demand_notices: [1, 2, 3].map((i) => ({ id: 'n' + i, ref: String(500 + i), team: 'KONGOWE', full_name: ['ASHA ONE', 'ASHA TWO', 'JUMA THREE'][i - 1], contact: '071400055' + i, notice_id: 'HMCL/A/0' + i, notice_date: TODAY, arrears_at_notice: 1000 * i, created_at: TODAY + 'T05:00:00Z' })),
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
const USER = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: NAVIDS };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname.startsWith('/app') || u.pathname === '/dashboard') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return; }
  if (u.pathname.startsWith('/mod/')) { const f = path.join(ROOT, 'public', u.pathname.split('?')[0]); if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(f)); return; } }
  if (u.pathname === '/brand.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(ROOT + '/public/brand.js')); return; }
  if (u.pathname === '/api/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, build: null })); return; }
  if (u.pathname === '/api/portal') {
    let b = ''; req.on('data', (c) => b += c);
    req.on('end', async () => {
      const { fn, args } = JSON.parse(b || '{}');
      let out;
      try { out = await portalApi(db, USER, fn, args || {}); }
      catch (e) { res.writeHead(e.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...(out && typeof out === 'object' && !Array.isArray(out) ? out : { rows: out }), workspace: 'hopepmo' }));
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}');
});
await new Promise((r) => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const UI = { presentSeconds: 30, refreshSeconds: 600, hintIntervalSeconds: 3600, hintLifetimeSeconds: 5 };
const ME = { name: 'THE ADMIN', role: 'ADMIN', teams: null, teamCount: null, tabs: NAVIDS, can: { dashboard: true, upload: true, admin: true }, ui: UI };

const COLLECT = `(function(){
  var out = [];
  var skip = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1 };
  var col = function (s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); };
  var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  var n;
  while ((n = w.nextNode())) { var p = n.parentElement; if (!p || skip[p.tagName]) continue; var t = col(n.nodeValue); if (t) out.push({ k: 'text', t: t, tag: p.tagName.toLowerCase() }); }
  var els = document.body.querySelectorAll('*');
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    ['title', 'placeholder', 'aria-label', 'alt'].forEach(function (a) { var v = e.getAttribute(a); if (v && v.trim()) out.push({ k: 'attr:' + a, t: col(v), tag: e.tagName.toLowerCase() }); });
    if (e.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(e.type) && e.value) out.push({ k: 'attr:value', t: col(e.value), tag: 'input' });
  }
  return out; })()`;

const all = [];
const errs = [];
async function snap(page, view) {
  const items = await page.evaluate(COLLECT);
  for (const it of items) all.push({ view, ...it });
}

async function fresh() {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 100)));
  page.on('dialog', (d) => d.accept());
  page.setDefaultTimeout(6000);
  await page.goto(base + '/');
  await page.waitForTimeout(300);
  return page;
}
{
  const page = await fresh();
  await snap(page, '(sign-in screen)');
  await page.evaluate((m) => { S.code = 'ADM'; start(m); }, ME);
  await page.waitForTimeout(700);
  await snap(page, '(portal shell)');
  await page.close();
}
for (const v of NAVIDS) {
  let page;
  try {
    page = await fresh();
    await page.evaluate((m) => { S.code = 'ADM'; start(m); }, ME);
    await page.waitForTimeout(300);
    await page.evaluate(async (id) => { var m = modOf_(id); if (m) await modLoad_(m); go(id); }, v);
    await page.waitForFunction(() => !document.querySelector('#view .sk'), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(450);
    await snap(page, v);
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    await page.waitForTimeout(120);
    await snap(page, v + ' (folds open)');
  } catch (e) { errs.push(v + ': ' + String(e).slice(0, 120)); }
  finally { if (page) await page.close().catch(() => {}); }
}
// the language button and the hints bar

await browser.close(); srv.close();
fs.writeFileSync(OUT, JSON.stringify({ items: all, errs }));
console.log('views', NAVIDS.length, 'items', all.length, 'errors', errs.length);
for (const e of errs.slice(0, 10)) console.log('  ', e);
