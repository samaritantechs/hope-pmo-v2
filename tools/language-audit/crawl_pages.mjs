// Crawl of the other pages: HOPE Calls (with a registered handset), Upload, customer page, home, dashboard, live.
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
const { callApi } = await import(ROOT + '/api/_lib/call-core.js');
const NOW = Date.now();
const TODAY = new Date(NOW + 3 * 3600 * 1000).toISOString().slice(0, 10);
const db = fakeDb({
  teams: [{ team: 'KONGOWE', opm: null, recovery: null, gmo: 'GMO ONE', manager: null, credit: null, expected: null, bike: null, team_code: 'KON123' }],
  access_codes: [{ code: 'COL1', name: 'CATHERINE C', role: 'PMO COLLECTION', teams: ['KONGOWE'], tabs: [] }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }],
  repayment_snapshots: [], defaulter_snapshots: [], followup_comments: [],
  followup_status: [
    { ref: '555', team: 'KONGOWE', full_name: 'MDAIWA WA KARIBU', contact: '0714000555', guarantor_name: 'MDHAMINI WA 555', guarantor_contact: '0715000555', arrears: 900, rejesho: 100, status: 'Defaulter', fu_status: '', ds: '5-6', days_elapsed: 12, updated_at: TODAY + 'T05:00:00Z' },
    { ref: '603', team: 'KONGOWE', full_name: 'MDAIWA WA MBALI', contact: '0714000603', guarantor_name: 'MDHAMINI WA 603', guarantor_contact: '0715000603', arrears: 48000, rejesho: 6000, status: 'Chronic', fu_status: 'Ametoa Ahadi', ds: '4-12', days_elapsed: 140, updated_at: TODAY + 'T05:00:00Z' },
  ],
  loans: [], call_users: [], call_logs: [], received_payments: [], complaints: [], customer_locations: [],
});
await callApi(db, 'api_callRegister', ['dF', 'JUMA ISSA', '', '', '0712999999', 'KON123'], NOW);
console.warn = () => {};
const PAGES = { '/call': 'call.html', '/upload': 'upload.html', '/mkopo': 'mkopo.html', '/home': 'home.html', '/dashboard-code': 'dashboard.html', '/live': 'live.html' };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (PAGES[u.pathname]) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(ROOT + '/public/' + PAGES[u.pathname], 'utf8')); return; }
  if (u.pathname === '/brand.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(ROOT + '/public/brand.js')); return; }
  if (u.pathname === '/api/call') {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', async () => {
      const { fn, args } = JSON.parse(b || '{}'); let out;
      try { out = await callApi(db, fn, ['dF'].concat((args || []).slice(1)), NOW); } catch (e) { out = { ok: false, error: String((e && e.message) || e) }; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out == null ? { ok: true } : out));
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}');
});
await new Promise((r) => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const COLLECT = `(function(){
  var out = []; var skip = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1 };
  var col = function (s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); };
  var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); var n;
  while ((n = w.nextNode())) { var p = n.parentElement; if (!p || skip[p.tagName]) continue; var t = col(n.nodeValue); if (t) out.push({ k: 'text', t: t }); }
  var els = document.querySelectorAll('*');
  for (var i = 0; i < els.length; i++) { var e = els[i];
    ['title', 'placeholder', 'aria-label', 'alt'].forEach(function (a) { var v = e.getAttribute(a); if (v && v.trim()) out.push({ k: 'attr:' + a, t: col(v) }); });
    if (e.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(e.type) && e.value) out.push({ k: 'attr:value', t: col(e.value) }); }
  var tt = col(document.title); if (tt) out.push({ k: 'attr:title', t: tt });
  return out; })()`;
const all = [], errs = [];
const snap = async (page, view) => { for (const it of await page.evaluate(COLLECT)) all.push({ view, ...it }); };
async function visit(route, label, fn) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(label + ': ' + String(e).slice(0, 100)));
  page.on('dialog', (d) => d.accept());
  page.setDefaultTimeout(5000);
  try {
    await page.goto(base + route); await page.waitForTimeout(1500);
    await snap(page, label);
    if (fn) await fn(page, label);
  } catch (e) { errs.push(label + ': ' + String(e).slice(0, 100)); }
  await ctx.close();
}
await visit('/call', 'call', async (page, label) => {
  const SEL = '#tabs button, .tabs button, nav button';
  const n = await page.evaluate((s) => document.querySelectorAll(s).length, SEL);
  for (let i = 0; i < Math.min(n, 12); i++) {
    try { await page.evaluate(([s, k]) => { const b = document.querySelectorAll(s)[k]; if (b) b.click(); }, [SEL, i]); await page.waitForTimeout(500); await snap(page, label + ' tab ' + i); } catch (e) { /* ignore */ }
  }
  for (const sel of ['#menuBtn', '#btnMenu', '[data-menu]', '#repBtn', '#btnReport', '.hdr button']) {
    try {
      const els = await page.$$(sel);
      for (const el of els.slice(0, 4)) {
        await el.click({ timeout: 800 }).catch(() => {});
        await page.waitForTimeout(500); await snap(page, label + ' ' + sel);
        await page.evaluate(() => { try { if (typeof closeSheet === 'function') closeSheet(); } catch (e) { /* ignore */ } });
      }
    } catch (e) { /* ignore */ }
  }
});
await visit('/upload', 'upload', async (page, label) => { await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; })); await page.waitForTimeout(200); await snap(page, label + ' (folds open)'); });
await visit('/mkopo', 'mkopo');
await visit('/home', 'home');
await visit('/dashboard-code', 'dashboard');
await visit('/live', 'live');
await browser.close(); srv.close();
fs.writeFileSync(OUT, JSON.stringify({ items: all, errs }));
console.log('items', all.length, 'errors', errs.length);
for (const e of errs.slice(0, 8)) console.log('  ', e);
