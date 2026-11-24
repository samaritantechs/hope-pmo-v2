/* THE SEARCH'S CARD SAYS WHAT THE REGISTER KNOWS: the REAL public/call.html in a real browser, talking to the REAL call API
   (api/_lib/call-core.js) over the repository's own fake database.

     "people are reporting some customer cards abnormally displaying what were not used of as on the picture, Not showing
      arreas e.t.c" -- the owner, 24 Nov 2026, with a card that read only
      "Hali / Status: Kwenye rejista ya waliokosa / in the defaulter register" (handbook Part 145)

   That card came from the phone's search box: a customer the handset's own three lists do not hold, found in the index the server
   keeps of names and numbers. What it proves:

     1. a customer who has LEFT the defaulters file (the upload blanks the row and keeps it) is found, and neither the row in
        the results nor the card says "in the defaulter register": both say "Si mdaiwa kwa sasa ... / Not a defaulter now ...",
        the chip reads Rejista, and no debt is printed;
     2. a customer who OWES but is kept off a collection officer's own Def tab (single counts only) is found WITH the debt: the
        row says "Deni TZS 48,000" and the rejesho, and the card draws Deni / Arrears, the status, the last follow-up and the
        D.S, as an officer is used to;
     3. both cards can still be rung (the customer's and the guarantor's buttons are there);
     4. a field officer, whose Def tab already holds the owing customer, sees that customer once, from the phone's own list;
     5. no page error.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/call-search-card.mjs

   CHROME overrides the browser path; CALL_CORE runs it against another copy of the server code (a file beside call-core.js);
   SHOTS=<dir> saves pictures. Exit code 0 = everything passed. Made-up people only. */
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
const { callApi } = await import(process.env.CALL_CORE || path.join(ROOT, 'api/_lib/call-core.js'));
const PAGE = fs.readFileSync(path.join(ROOT, 'public/call.html'), 'utf8');
const NOW = Date.now();
const TODAY = new Date(NOW + 3 * 3600 * 1000).toISOString().slice(0, 10);

const db = fakeDb({
  teams: [{ team: 'KONGOWE', opm: null, recovery: null, gmo: null, manager: null, credit: null, expected: null, bike: null, team_code: 'KON123' }],
  access_codes: [{ code: 'COL1', name: 'CATHERINE C', role: 'PMO COLLECTION', teams: ['KONGOWE'], tabs: [] }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }],
  repayment_snapshots: [], defaulter_snapshots: [], followup_comments: [
    { ref: '601', team: 'KONGOWE', full_name: 'ALIYEMALIZA DENI', comment: 'namba mpya', fu_status: 'ANA NAMBA NYINGINE', new_number: '0752430101', created_by: 'JUMA ISSA', created_at: TODAY + 'T05:00:00Z' }],
  followup_status: [
    { ref: '555', team: 'KONGOWE', full_name: 'MDAIWA WA KARIBU', contact: '0714000555', guarantor_name: 'MDHAMINI WA 555', guarantor_contact: '0715000555',
      arrears: 900, rejesho: 100, status: 'Defaulter', fu_status: '', ds: '5-6', days_elapsed: 12, updated_at: TODAY + 'T05:00:00Z' },
    { ref: '601', team: 'KONGOWE', full_name: 'ALIYEMALIZA DENI', contact: '0714000601', guarantor_name: 'MDHAMINI WA 601', guarantor_contact: '0715000601',
      arrears: null, rejesho: 200, status: null, fu_status: 'ANA NAMBA NYINGINE', ds: '11-12', days_elapsed: 80, updated_at: TODAY + 'T05:00:00Z' },
    { ref: '603', team: 'KONGOWE', full_name: 'MDAIWA WA MBALI', contact: '0714000603', guarantor_name: 'MDHAMINI WA 603', guarantor_contact: '0715000603',
      arrears: 48000, rejesho: 6000, status: 'Chronic', fu_status: 'Ametoa Ahadi', ds: '4-12', days_elapsed: 140, updated_at: TODAY + 'T05:00:00Z' },
  ],
  loans: [], call_users: [], call_logs: [], received_payments: [], complaints: [], customer_locations: [],
});
// two handsets: a field officer (the team's code) and a collection officer (an access code)
await callApi(db, 'api_callRegister', ['dF', 'JUMA ISSA', '', '', '0712999999', 'KON123'], NOW);
await callApi(db, 'api_callRegister', ['dC', '', '', 'COL1', '0788111288'], NOW);
let DEVICE = 'dF';
const warn = console.warn; console.warn = () => {};

const srv = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/call')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
  if (req.url === '/api/call') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', async () => {
      const { fn, args } = JSON.parse(b || '{}');
      let out;
      // the page's own device id is replaced by the registered one; everything else is the page's request as it sent it
      try { out = await callApi(db, fn, [DEVICE].concat((args || []).slice(1)), NOW); }
      catch (e) { out = { ok: false, error: String((e && e.message) || e) }; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out == null ? { ok: true } : out));
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
const BENIGN = /favicon|status of 404|ERR_FAILED|Failed to fetch|boot failed|manifest|serviceWorker|sw\.js/i;

async function open(device, label) {
  DEVICE = device;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(label + ': ' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push(label + ' console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(9000);
  await page.goto(base + '/');
  await page.waitForFunction(() => !!document.getElementById('listQ') && typeof S === 'object' && !!S.user, null, { timeout: 9000 }).catch(() => {});
  await page.waitForTimeout(900);
  return { page, ctx };
}
/** Type a name in the search box, wait for a row of that customer, and read the row. */
async function search(page, q, ref) {
  await page.fill('#listQ', '');
  await page.type('#listQ', q, { delay: 5 });
  await page.waitForFunction(r => !!document.querySelector('.crow[data-ref="' + r + '"]'), ref, { timeout: 9000 }).catch(() => {});
  await page.waitForTimeout(700);                                   // the book's answer arrives after the pause in typing
  return page.evaluate(r => {
    const rows = [...document.querySelectorAll('.crow[data-ref="' + r + '"]')];
    const txt = e => (e ? e.textContent : '').replace(/\s+/g, ' ').trim();
    return { n: rows.length, sub: txt(rows[0] && rows[0].querySelector('.crow-sub')), chips: txt(rows[0] && rows[0].querySelector('.crow-chips')), all: txt(rows[0]) };
  }, ref);
}
async function card(page, ref) {
  await page.evaluate(r => { const el = document.querySelector('.crow[data-ref="' + r + '"] .crow-main') || document.querySelector('.crow[data-ref="' + r + '"]'); el.click(); }, ref);
  await page.waitForFunction(() => !!document.querySelector('.sheet-card .sheet-title'), null, { timeout: 9000 }).catch(() => {});
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const c = document.querySelector('.sheet-card');
    const txt = e => (e ? e.textContent : '').replace(/\s+/g, ' ').trim();
    const facts = {}; [...c.querySelectorAll('.factrow')].forEach(f => { const s = f.children; if (s.length >= 2) facts[txt(s[0])] = txt(s[1]); });
    return { title: txt(c.querySelector('.sheet-title')), sub: txt(c.querySelector('.sheet-sub')), facts, calls: [...c.querySelectorAll('.callrow a')].map(a => txt(a)), text: txt(c) };
  });
}

// ---- 1. the field officer searches the customer who has left the defaulters file (the owner's picture)
{
  const { page, ctx } = await open('dF', 'field officer');
  const row = await search(page, 'ALIYEMALIZA', '601');
  check('1 the customer who left the file is found, once', row.n === 1, JSON.stringify(row));
  check('1 the row does not call them a defaulter: it says "Si mdaiwa kwa sasa ... / Not a defaulter now ..."', /Si mdaiwa kwa sasa/.test(row.sub) && /Not a defaulter now: not on the current defaulters file/.test(row.sub)
    && !/in the defaulter register/.test(row.all), row.sub);
  check('1 no debt is printed on the row, and the chip reads Rejista', !/Deni TZS/.test(row.all) && /Rejista/.test(row.chips) && !/\bDef\b/.test(row.chips), row.all);
  const c = await card(page, '601');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'search-card-left-the-file.png') });
  check('1 the card: the customer, the team and the REF', c.title === 'ALIYEMALIZA DENI' && /KONGOWE/.test(c.sub) && /REF 601/.test(c.sub), JSON.stringify([c.title, c.sub]));
  check('1 the card\'s Status line says not a defaulter now, never "in the defaulter register"', /Si mdaiwa kwa sasa/.test(c.facts['Hali / Status'] || '') && !/in the defaulter register/.test(c.text), JSON.stringify(c.facts));
  check('1 the card prints no Deni / Arrears line', !('Deni / Arrears' in c.facts), JSON.stringify(Object.keys(c.facts)));
  check('3 it can still be rung: the customer\'s and the guarantor\'s buttons', c.calls.length === 2 && /Mteja/.test(c.calls[0]) && /Mdhamini/.test(c.calls[1]), JSON.stringify(c.calls));
  // 4. the owing customer is on this officer's own Def tab already: one row, from the phone's own list, with its debt
  await page.evaluate(() => { if (typeof closeSheet === 'function') closeSheet(); else history.back(); });
  await page.waitForTimeout(400);
  const own = await search(page, 'MDAIWA WA MBALI', '603');
  check('4 a customer the officer\'s own Def tab holds is listed once, with the debt', own.n === 1 && /Deni TZS 48,000/.test(own.sub), JSON.stringify(own));
  await ctx.close();
}
// ---- 2. the collection officer searches the customer the narrowing keeps off their Def tab
{
  const { page, ctx } = await open('dC', 'collection officer');
  const onTab = await page.evaluate(async () => { const d = await srv('api_callList', DEV, 'defaulters'); return (d.rows || []).map(r => r.ref); });
  check('2 the collection officer\'s own Def tab does not hold the customer who is eight behind (single counts only)', !onTab.includes('603') && onTab.includes('555'), JSON.stringify(onTab));
  const row = await search(page, 'MDAIWA WA MBALI', '603');
  check('2 the search finds them, once', row.n === 1, JSON.stringify(row));
  check('2 the row says the debt and the rejesho, not a status line', /Deni TZS 48,000/.test(row.sub) && /Rejesho TZS 6,000/.test(row.sub) && !/rejista/i.test(row.sub), row.sub);
  const c = await card(page, '603');
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'search-card-owes.png') });
  check('2 the card draws Deni / Arrears and the rejesho', c.facts['Deni / Arrears'] === 'TZS 48,000' && c.facts['Rejesho'] === 'TZS 6,000', JSON.stringify(c.facts));
  check('2 and the status, the last follow-up and the D.S, as on the Def tab', /Chronic/i.test(c.facts['Hali ya mteja / Customer status'] || '') && /Ametoa Ahadi/i.test(c.facts['Ufuatiliaji wa mwisho / Last follow-up'] || '')
    && c.facts['D.S'] === '4-12', JSON.stringify(c.facts));
  check('2 no "Hali / Status" line stands in for the debt', !('Hali / Status' in c.facts), JSON.stringify(Object.keys(c.facts)));
  check('3 it can be rung: the customer\'s and the guarantor\'s buttons', c.calls.length === 2, JSON.stringify(c.calls));
  await ctx.close();
}
check('5 no page error', errs.length === 0, errs.join(' | '));

await browser.close(); srv.close(); console.warn = warn;
for (const f of fail) console.log('FAIL  ' + f);
console.log(ok.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
