/* Drives the REAL public/call.html in a real browser, against a stub /api/call, to prove the Exp.Def
   strip says why a leader's own list is short:

     "that manager in their code ain't seeing them, they getting just a little like two yet a Manager's
      gmo sees the manager has many" -- the owner, 16 Nov 2026

   Teams & Staff names the manager on teams her own access code does not hold, so the customers the
   rotation hands her there are not on her list (the code decides what is seen). The server now says
   which teams (expdf.outside, api/_lib/leader-scope.js); the strip prints them -- and prints nothing for
   a leader whose code holds every team she leads.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/call-expdef-offcode.mjs

   CHROME overrides the browser path. SHOTS=<dir> also saves a picture of the screen there. Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.SHOTS || '';
const PAGE = fs.readFileSync(path.join(ROOT, 'public/call.html'), 'utf8');

let outside = ['T3', 'T4', 'T5', 'T6'];
const ROWS = [
  { ref: 'R1', name: 'AMINA JUMA', contact: '0712000001', gName: '', gContact: '', amt: 5000, installment: 100, custStatus: 'DEFAULTER', fuStatus: 'D3', initial: 6000, recovered: 1000, ds: '3/6', days: 3, team: 'T1', called: false, leader: 'MARY M', role: 'MANAGER' },
  { ref: 'R2', name: 'PILI SALUM',  contact: '0714000001', gName: '', gContact: '', amt: 3000, installment: 100, custStatus: 'DEFAULTER', fuStatus: 'D4', initial: 3000, recovered: 0, ds: '3/6', days: 4, team: 'T2', called: false, leader: 'MARY M', role: 'MANAGER' },
];
const BOOT = { ok: true, name: 'MARY M', team: 'T1', role: 'Manager', leader: true, expdfLeader: true, bikeView: false, logoutEnabled: true, syncEverySec: 300, brand: 'HOPE',
  fuStatuses: ['AMETOA AHADI'], fuNeedDate: [], fuNeedComment: [], fuNeedNumber: [], userId: 'U-MARY', systemOpen: true, callBuild: null, leaderTeams: 'T1,T2' };
function answer(fn, args) {
  if (fn === 'api_callBoot') return BOOT;
  if (fn === 'api_callList' && args[1] === 'expdf') {
    return { ok: true, rows: ROWS, expdf: { totals: { customers: 2, arrears: 8000, initial: 9000, recovered: 1000, pct: 11 },
      byCycle: [{ cycle: 'D3', customers: 1, arrears: 5000 }, { cycle: 'D4', customers: 1, arrears: 3000 }], byLeader: [], dayName: 'Fri', date: '2026-07-24',
      hasBaseline: true, scope: 'mine', canSwitch: true, outside: outside.slice(), diag: { deck: 144, assigned: 144, mine: 16, dated: 16, onToday: 2, undated: 0, noCycleDates: false } } };
  }
  if (fn === 'api_callList') return { ok: true, rows: [], asOf: '2026-07-24', stale: false };
  if (fn === 'api_callDailySummary') return { ok: true, period: 'day', col: { pct: 0.4 }, kesho: { pct: 0.1 }, weekCol: { pct: 0.5 }, sales: { pct: 0.3 },
    expdf: { pct: 0.2, num: 1000 }, recovery: { pct: 0.6, num: 900 }, totalDef: { num: 1, customers: 1, day: 'FRI', date: '2026-07-24', isToday: true }, dataVersion: 'v1' };
  if (fn === 'api_callSync') return { ok: true, added: 0, watermark: 1, dataVersion: 'v1' };
  if (fn === 'api_callNotifications') return { ok: true, unseen: 0, seenAt: '', items: [] };
  return { ok: true };
}
const srv = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/call')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
  if (req.url === '/api/call') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => { const { fn, args } = JSON.parse(b || '{}'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(answer(fn, args || []))); });
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const ok = [], fail = [];
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (extra ? ' -- ' + extra : ''));

async function openExpdf(viewport, label) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|status of 404|ERR_FAILED|Failed to fetch|boot failed/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(base + '/');
  await page.waitForTimeout(700);
  await page.click('#tabExpdf');
  await page.waitForFunction(() => /Muhtasari/.test((document.getElementById('expdfStrip') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const strip = () => page.evaluate(() => { const el = document.getElementById('expdfStrip'); return { shown: !el.classList.contains('hide'), text: el.textContent, notes: Array.from(el.querySelectorAll('.xnote')).map(n => n.textContent) }; });
  return { page, ctx, errs, strip, label,
    shot: async name => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, label + '-' + name + '.png') }); } } };
}

for (const [viewport, label] of [[{ width: 390, height: 780 }, 'phone'], [{ width: 768, height: 900 }, 'tablet']]) {
  outside = ['T3', 'T4', 'T5', 'T6'];
  let h = await openExpdf(viewport, label);
  let s = await h.strip();
  check(label + ': the strip is there with the leader\'s own list', s.shown && /Muhtasari/.test(s.text) && /Wateja/.test(s.text), s.text.slice(0, 80));
  check(label + ': it says which teams the leader\'s own code does not hold, in Swahili', s.notes.some(n => /Jina lako liko kwenye timu ambazo code yako haizioni \(T3, T4, T5, T6\)/.test(n) && /Mwambie msimamizi aziongeze kwenye code yako/.test(n)), JSON.stringify(s.notes));
  check(label + ': no script error', h.errs.length === 0, h.errs.join(' | '));
  await h.shot('strip-with-note');
  await h.ctx.close();

  outside = [];
  h = await openExpdf(viewport, label);
  s = await h.strip();
  check(label + ': a leader whose code holds every team she leads gets no such note', s.shown && s.notes.length === 0, JSON.stringify(s.notes));
  check(label + ': and still no script error', h.errs.length === 0, h.errs.join(' | '));
  await h.ctx.close();
}

await browser.close(); srv.close();
for (const s of ok) console.log('ok   ' + s);
for (const s of fail) console.log('FAIL ' + s);
console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall ' + ok.length + ' passed');
process.exit(fail.length ? 1 : 0);
