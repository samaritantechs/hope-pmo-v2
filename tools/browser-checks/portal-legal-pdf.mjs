/* Drives the REAL public/app.html in a real browser, against a stub /api/portal, to prove the
   demand notice comes out of the Legal screen as a PDF FILE -- two pages, named after the
   customer -- and that no print dialog is involved anywhere.

     "Button on demands notices must be download not print"

   The PDF is made on the device from the letter's own HTML (noticePdf_ in public/mod/legal.js):
   html2canvas draws each page, jsPDF places it on A4 inside the letter's margins. That is
   browser work and can only be seen by doing it. The two libraries are pinned cdnjs URLs; here
   they are served from local copies (LIBS, fetched once with `npm pack`), so the check needs no
   internet -- and proves the page asks for exactly those two addresses.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       LIBS=/path/with/html2canvas.min.js+jspdf.umd.min.js node tools/browser-checks/portal-legal-pdf.mjs

   CHROME overrides the browser path. Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const LIBS = process.env.LIBS || path.join(ROOT, '..', 'libs');
const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');

// A one-pixel PNG, same-origin by being inline: the letter's logo and stamp stand-ins.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
/* The letter, in the SHAPE demandNoticeHtml (portal-core.js) writes: the print stylesheet, a
   .first-page box holding the header and the costs table, the page break, then page two. */
const LETTER = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AMINA JUMA</title><style>
@page{size:A4;margin:15mm 18mm 18mm 18mm;}
body{margin:0 auto;width:174mm;font-family:Verdana,sans-serif;font-size:9.5pt;color:#000;line-height:1.35;text-align:justify;}
.header{text-align:right;margin-bottom:12px;} .header img{float:left;margin-top:-10px;}
.first-page{position:relative;} table{width:100%;border-collapse:collapse;margin:10px 0;} td,th{border:1px solid #000;padding:4px;}
.page-break-before{page-break-before:always;}
</style></head><body>
<div class="first-page"><div class="header"><img src="${PNG}" alt="nembo / logo" width="60" height="60"><b>HOPE MICROCREDIT CO. LTD</b><br>P.O. Box 1, Dar es Salaam</div>
<p class="subject"><b>YAH: NOTISI YA SIKU SABA</b></p>
${Array.from({ length: 6 }, (_, i) => `<p>${i + 1}. Kwa kuwa umeshindwa kulipa rejesho la mkopo wako kwa mujibu wa mkataba, unatakiwa kulipa deni lote ndani ya siku saba kuanzia tarehe ya notisi hii. Maelezo haya yanarudiwa ili ukurasa upime kama barua halisi inavyopima kwenye karatasi ya A4.</p>`).join('')}
<table><tr><th>Na.</th><th>Maelezo</th><th>Kiasi</th></tr>
<tr><td>i.</td><td>Deni lote la mkopo wako</td><td>Tsh. 1,250,000/=</td></tr>
<tr><td>ii.</td><td>Gharama ya dalali</td><td>50,000/=</td></tr>
<tr><td>iii.</td><td>Kamisheni 10%</td><td>125,000/=</td></tr>
<tr><th colspan="2">JUMLA</th><th>1,425,000/=</th></tr></table></div>
<div class="page-break-before"></div>
<p>Pia utalipa gharama za usafiri wa kubeba vitu au mali zako zitakazochukuliwa kwa ajili ya ufilisi wa kulipa madeni yako.</p>
<p class="compact"><strong>NB:</strong> Malipo yafanyike kupitia MIX BY YAS piga *150*01#<br>- Ingiza Kumbukumbu No 22171109841</p>
<div class="signature-block"><img src="${PNG}" alt="muhuri / stamp" width="80" height="80"><p>Afisa Sheria</p></div>
<script>window.hopeFit = function(){};</script>
</body></html>`;

const calls = [];
const ROW = { id: 'n1', notice_id: 'DN/2026/0001', notice_date: '2026-10-19', full_name: 'AMINA JUMA', ref: '22171109841', team: 'KONGOWE', contact: '0712000001',
  notice_days: 7, paid_count: 3, ds: '3/12', arrears_at_notice: 1250000, arrears_now: 1100000, arrears_down: 150000, rec_pct: 12, paid_since: 150000, paid_n: 2, paid_n_phone: 1,
  last_paid: '2026-10-18', total_demand: 1250000, fine: 50000, principal_remaining: 900000, notice_state: 'served', issued_by: 'LEGAL ONE', created_at: '2026-10-19T08:00:00Z', letter_kept: true };
function answer(fn, args) {
  calls.push(fn);
  if (fn === 'demandNotices') return { ok: true, rows: [ROW], count: 1, demanded: 1250000, fines: 50000, recovery: 150000, recoveryPct: 12, owed: 1250000, cleared: 0, asOf: '2026-10-19',
    paymentsOn: true, paidSince: 150000, paymentsKept: true, legal: { on: false }, brand: { logo: true, stamp: true, sign: true, who: 'X', title: 'Y', phone: '0700' }, today: '2026-10-19' };
  if (fn === 'demandNoticePrint') return { ok: true, html: LETTER, rebuilt: false };
  if (fn === 'addDemandNotice') return { ok: true, noticeId: 'DN/2026/0002', html: LETTER };
  if (fn === 'legalFind') return { ok: true, rows: [], minDc: 2 };                 // a bare REF of six digits or more previews straight away
  if (fn === 'legalPreview') return { ok: true, found: true, ref: args.ref, full_name: 'AMINA JUMA', eligible: true, servedToday: [], served: [], dc: 3, minDc: 2,
    disb_date: '2026-07-01', expire_date: '2026-10-01', guarantor_name: 'G ONE', guarantor_contact: '0713000001', team: 'KONGOWE', contact: '0712000001', arrears: 1250000, ds: '3/12' };
  if (fn === 'notifications') return { ok: true, unseen: 0, seenAt: '', items: [] };
  return { ok: true, rows: [] };
}
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname.startsWith('/app') || u.pathname === '/dashboard') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return; }
  if (u.pathname.startsWith('/mod/')) { const f = path.join(ROOT, 'public', u.pathname); if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(f)); return; } }
  if (u.pathname === '/api/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, build: null })); return; }
  if (u.pathname === '/api/call') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return; }
  if (u.pathname === '/api/portal') { let b = ''; req.on('data', c => b += c); req.on('end', () => { const { fn, args } = JSON.parse(b || '{}'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(answer(fn, args || {}))); }); return; }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 800 } });
const page = await ctx.newPage();
const libHits = [];
await page.route('https://cdnjs.cloudflare.com/**', route => {
  const url = route.request().url(); libHits.push(url);
  const f = /html2canvas/.test(url) ? 'html2canvas.min.js' : /jspdf/.test(url) ? 'jspdf.umd.min.js' : null;
  if (!f) return route.abort();
  route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(LIBS, f)) });
});
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
const BENIGN = /favicon|status of 404|ERR_FAILED|brand/;
page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
const ok = [], fail = [];
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (extra ? ' -- ' + extra : ''));
const toastText = () => page.evaluate(() => { const t = document.getElementById('toast'); return t && t.style.display !== 'none' ? t.textContent : ''; });

await page.goto(base + '/');
await page.evaluate(() => { S.code = 'LEGAL1'; start({ name: 'LEGAL ONE', role: 'LEGAL', teams: null, teamCount: 0, tabs: ['dashboard', 'legal'],
  ui: { presentSeconds: 30, refreshSeconds: 20, hintIntervalSeconds: 600, hintLifetimeSeconds: 12 } }); });
await page.waitForTimeout(400);
// Any print would go through printHtml -- it is replaced here so a call to it is a visible failure.
await page.evaluate(() => { window.__printed = 0; window.printHtml = function(){ window.__printed++; }; });

// --- 1. the register opens with download wording, and the details pane has a Download button
await page.evaluate(() => go('legal'));
await page.waitForSelector('#newNotice', { timeout: 8000 });
await page.waitForTimeout(300);
const bar = await page.evaluate(() => document.getElementById('view').textContent);
check('the register says download, not print', /kupakua PDF/.test(bar) && !/Save as PDF/.test(bar) && !/kuchapisha/.test(bar));
await page.evaluate(() => lgDetails(S.rows[0]));
await page.waitForSelector('#lgDoPrint', { timeout: 4000 });
check('the details pane\'s button is Download PDF', /Pakua PDF/.test(await page.evaluate(() => document.getElementById('lgDoPrint').textContent)));
// "Replace Marejesho / Paid (of 12) with DS (default summary)": the deck's D.S, no paid-of-12 count.
const pane = await page.evaluate(() => document.body.textContent);
check('the details pane shows DS (default summary) and no paid-of-12 count', /DS \(default summary\)\s*3\/12/.test(pane) && !/\(of 12\)/.test(pane) && !/Marejesho \/ Paid/.test(pane),
  (pane.match(/DS \(default summary\).{0,12}/) || ['no DS row'])[0] + ' | ' + (pane.match(/.{0,40}(\(of 12\)|Marejesho \/ Paid).{0,20}/) || [''])[0]);

// --- 2. pressing it makes a two-page PDF named after the customer, with no print dialog
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#lgDoPrint')]);
const file = await dl.path();
const bytes = fs.readFileSync(file);
if (process.env.KEEP) fs.copyFileSync(file, process.env.KEEP);                 // KEEP=/some/dir/letter.pdf to look at it
const text = bytes.toString('latin1');
check('a file is downloaded, named after the customer', dl.suggestedFilename() === 'AMINA JUMA.pdf', dl.suggestedFilename());
check('and it is a PDF', text.startsWith('%PDF-'), text.slice(0, 8));
const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
check('of exactly two pages', pages === 2, 'pages=' + pages);
check('of a size that travels on WhatsApp', bytes.length > 20000 && bytes.length < 2500000, bytes.length + ' bytes');
check('the two libraries were asked for from their pinned cdnjs addresses, once each',
  libHits.length === 2 && libHits.some(u => u.endsWith('/html2canvas/1.4.1/html2canvas.min.js')) && libHits.some(u => u.endsWith('/jspdf/2.5.1/jspdf.umd.min.js')), JSON.stringify(libHits));
check('no print dialog was involved', (await page.evaluate(() => window.__printed)) === 0 && calls.includes('demandNoticePrint'));
check('nothing was reported missing from the letter', !/Barua imetoka bila/.test(await toastText()), await toastText());
check('the button is back', !(await page.evaluate(() => document.getElementById('lgDoPrint').disabled)));
check('the hidden frame is gone again', (await page.evaluate(() => document.querySelectorAll('iframe[aria-hidden]').length)) === 0);

// --- 3. a second download does not fetch the libraries again
libHits.length = 0;
const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#lgDoPrint')]);
check('a second letter downloads without fetching the libraries again', libHits.length === 0 && dl2.suggestedFilename() === 'AMINA JUMA.pdf');

// --- 4. issuing a new notice downloads the letter too
await page.evaluate(() => closeDrawer());
await page.evaluate(() => lgIssue());
await page.waitForSelector('#lgQ', { timeout: 4000 });
await page.fill('#lgQ', '22171109841');
await page.click('#lgLoad');
await page.waitForSelector('#lgGo', { timeout: 8000 });
const goLabel = await page.evaluate(() => document.getElementById('lgGo').textContent);
check('the issue button says Issue & download PDF, with no print-dialog note', /pakua PDF/.test(goLabel) && !/Save as PDF/.test(await page.evaluate(() => document.getElementById('lgPrev').textContent)), goLabel);
const prev = await page.evaluate(() => document.getElementById('lgPrev').textContent);
check('the preview shows DS (default summary), not a paid-of-12 count', /DS \(default summary\)\s*3\/12/.test(prev) && !/\/ 12/.test(prev) && !/Marejesho \/ Paid/.test(prev), prev.slice(0, 160));
const [dl3] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#lgGo')]);
check('issuing a notice downloads its letter', dl3.suggestedFilename() === 'AMINA JUMA.pdf' && calls.includes('addDemandNotice'));
check('still no print dialog', (await page.evaluate(() => window.__printed)) === 0);

check('no script errors', errs.length === 0, errs.join(' | '));
await browser.close(); srv.close();
for (const o of ok) console.log('ok   ' + o);
for (const f of fail) console.log('FAIL ' + f);
console.log(ok.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
