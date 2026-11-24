/* Drives the REAL public/call.html and the REAL public/app.html in a real browser to prove that every screen which shows a
   day SAYS when the day's later file is not in yet (handbook Part 140):

     the owner's own look at the upload times (db/RUN-ME-087, pasted 24 Nov 2026): the morning file comes in at about 05:00
     and the later file at about 20:00, so through the whole working day the list is the morning file with nothing to
     compare it with. A nought there, with no words, read as "nobody recovered anything".

   THE PHONE (a stub /api/call that answers in the real server's shapes):
     * a leader, before the later file: the Exp.Def strip carries the line, Marejesho and Rec % are a dash, the split by
       leader prints no recovery, and the top bar's Exp.Def figure is a dash;
     * the same leader with both files in: no line, the figures as before;
     * a bike officer, before the later file: the top bar's Marejesho and Rec are a dash (customers and debt are figures),
       and the card under the tabs is the line alone; with both files in: figures, and no card.
   THE PORTAL (the stub /api/portal answers with the REAL server's answers: the same fixture is run through portalApi):
     * the Exp.Def Report's day, a leader's card and the Expected Defaulters tab carry the one line before the later file,
       and none of them carries it with both files in; the week view never carries it (it has its own words).

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/expdef-later-file.mjs

   CHROME overrides the browser path. SHOTS=<dir> also saves a picture of each screen there. CALL_FILE and APP_FILE run it
   on another copy of a page (the page as it was before the change must FAIL it). Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const SHOTS = process.env.SHOTS || '';
const CALL = fs.readFileSync(process.env.CALL_FILE || path.join(ROOT, 'public/call.html'), 'utf8');
const APP = fs.readFileSync(process.env.APP_FILE || path.join(ROOT, 'public/app.html'), 'utf8');
const { fakeDb } = await import(path.join(ROOT, 'test/fake-db.mjs'));
const { portalApi } = await import(path.join(ROOT, 'api/_lib/portal-core.js'));
const { USER_TABS } = await import(path.join(ROOT, 'api/_lib/auth.js'));

const DASH = String.fromCharCode(0x2014);
const ok = [], fail = [];
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (extra ? ' -- ' + extra : ''));
const browser = await chromium.launch({ executablePath: CHROME });
const BENIGN = /favicon|status of 404|ERR_FAILED|Failed to fetch|boot failed|brand/;
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };

/* ====================================================================== THE PHONE */
let stage = 'morning', bike = false;
const LINE = 'Orodha ya jioni ya leo bado haijapakiwa ' + DASH + ' marejesho yataonekana ikishapakiwa.';
function phoneAnswer(fn, args) {
  const morning = stage === 'morning';
  const rows = [
    { ref: 'R1', name: 'AMINA JUMA', contact: '0712000001', gName: '', gContact: '', amt: morning ? 6000 : 5000, installment: 100, custStatus: 'DEFAULTER', fuStatus: 'D3',
      initial: 6000, recovered: morning ? 0 : 1000, ds: '3/6', days: 3, team: 'T1', called: false, leader: 'BIKE B', role: 'BIKE' },
    { ref: 'R2', name: 'PILI SALUM', contact: '0714000001', gName: '', gContact: '', amt: 3000, installment: 100, custStatus: 'DEFAULTER', fuStatus: 'D4',
      initial: 3000, recovered: 0, ds: '3/6', days: 4, team: 'T2', called: false, leader: 'BIKE B', role: 'BIKE' },
  ];
  if (fn === 'api_callBoot') return { ok: true, name: 'MARY M', team: 'T1', role: bike ? 'Bike' : 'Manager', leader: true, expdfLeader: true, bikeView: bike, logoutEnabled: true,
    syncEverySec: 300, brand: 'HOPE', fuStatuses: ['AMETOA AHADI'], fuNeedDate: [], fuNeedComment: [], fuNeedNumber: [], userId: 'U-MARY', systemOpen: true, callBuild: null, leaderTeams: 'T1,T2' };
  if (fn === 'api_callList' && args[1] === 'expdf') {
    const rec = morning ? 0 : 1000, arr = morning ? 9000 : 8000;
    return { ok: true, rows, expdf: { totals: { customers: 2, arrears: arr, initial: 9000, recovered: rec, pct: morning ? 0 : 11.1 },
      byCycle: [{ cycle: 'D3', customers: 1, arrears: rows[0].amt }, { cycle: 'D4', customers: 1, arrears: 3000 }],
      byLeader: [{ leader: 'BIKE B ' + String.fromCharCode(0xB7) + ' BIKE', customers: 2, arrears: arr, initial: 9000, recovered: rec, pct: morning ? 0 : 11.1 }],
      dayName: 'Fri', date: '2026-07-24', hasBaseline: true, scope: 'team', canSwitch: true, outside: [],
      diag: { deck: 144, assigned: 144, mine: 2, dated: 2, onToday: 2, undated: 0, noCycleDates: false, paired: !morning, enteredAfter: null, stage } } };
  }
  if (fn === 'api_callList') return { ok: true, rows: [], asOf: '2026-07-24', stale: false };
  if (fn === 'api_callDailySummary') return { ok: true, period: 'day', col: { pct: 0.4 }, kesho: { pct: 0.1 }, weekCol: { pct: 0.5 }, sales: { pct: 0.3 },
    expdf: { pct: morning ? null : 0.111, num: morning ? 0 : 1000, den: 9000, customers: 2, stage }, recovery: { pct: 0.6, num: 900 },
    totalDef: { num: 1, customers: 1, day: 'FRI', date: '2026-07-24', isToday: true }, dataVersion: 'v1' };
  if (fn === 'api_callSync') return { ok: true, added: 0, watermark: 1, dataVersion: 'v1' };
  if (fn === 'api_callNotifications') return { ok: true, unseen: 0, seenAt: '', items: [] };
  return { ok: true };
}
const phoneSrv = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/call')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(CALL); return; }
  if (req.url === '/api/call') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => { const { fn, args } = JSON.parse(b || '{}'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(phoneAnswer(fn, args || []))); });
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => phoneSrv.listen(0, r));
const phoneBase = 'http://127.0.0.1:' + phoneSrv.address().port;

async function openPhone(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(phoneBase + '/');
  await page.waitForTimeout(800);
  await page.evaluate(() => { const b = document.getElementById('tabExpdf'); if (b && !b.classList.contains('on')) b.click(); });
  await page.waitForFunction(() => { const s = document.getElementById('expdfStrip'), d = document.getElementById('bkCust');
    return /Muhtasari|Orodha ya jioni/.test((s || {}).textContent || '') || (d && d.textContent === '2'); }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  const read = () => page.evaluate(() => {
    const el = document.getElementById('expdfStrip'), t = id => (document.getElementById(id) || {}).textContent || '';
    const stats = {}; Array.from(el.querySelectorAll('.xstat')).forEach(x => { stats[(x.querySelector('span') || {}).textContent] = (x.querySelector('b') || {}).textContent; });
    return { shown: !el.classList.contains('hide'), text: el.textContent, notes: Array.from(el.querySelectorAll('.xnote')).map(n => n.textContent), stats,
      split: Array.from(el.querySelectorAll('.xcyc span')).map(n => n.textContent),
      bar: { expdf: t('dsExpdf'), cust: t('bkCust'), deni: t('bkDeni'), rec: t('bkRec'), pct: t('bkPct') },
      bikeBar: document.getElementById('dayStrip').classList.contains('bike') };
  });
  return { page, ctx, errs, read };
}

for (const [viewport, label] of [[{ width: 390, height: 780 }, 'phone'], [{ width: 768, height: 900 }, 'tablet']]) {
  // --- a leader, the day's later file not in yet
  stage = 'morning'; bike = false;
  let h = await openPhone(viewport), s = await h.read();
  check(label + ': before the later file the strip says so, in its own Swahili', s.shown && s.notes.includes(LINE), JSON.stringify(s.notes));
  check(label + ': Marejesho is a dash, never a nought', s.stats.Marejesho === DASH, JSON.stringify(s.stats));
  check(label + ': Rec % is a dash, never 0%', s.stats['Rec %'] === DASH, JSON.stringify(s.stats));
  check(label + ': customers and debt are still figures', s.stats.Wateja === '2' && /9/.test(s.stats.Deni || ''), JSON.stringify(s.stats));
  check(label + ': the split by leader prints no recovery it does not know', s.split.some(x => /BIKE B/.test(x) && / 2$/.test(x)) && !s.split.some(x => /%/.test(x)), JSON.stringify(s.split));
  check(label + ': the top bar\'s Exp.Def figure is a dash', s.bar.expdf === DASH, s.bar.expdf);
  check(label + ': no script error', h.errs.length === 0, h.errs.join(' | '));
  await shot(h.page, label + '-leader-morning');
  await h.ctx.close();

  // --- the same leader with both of the day's files in
  stage = 'pair'; bike = false;
  h = await openPhone(viewport); s = await h.read();
  check(label + ': with both files in the line is not there', s.shown && !s.notes.some(n => /Orodha ya jioni/.test(n)), JSON.stringify(s.notes));
  check(label + ': and the figures are: recovered and Rec %', /^1(\.0)?k$/.test(s.stats.Marejesho || '') && s.stats['Rec %'] === '11%', JSON.stringify(s.stats));
  check(label + ': the split by leader carries its recovery again', s.split.some(x => /BIKE B/.test(x) && /11%/.test(x)), JSON.stringify(s.split));
  check(label + ': the top bar prints its percentage and the shillings', /^11%/.test(s.bar.expdf) && /1(\.0)?k/.test(s.bar.expdf), s.bar.expdf);
  check(label + ': no script error with both files in', h.errs.length === 0, h.errs.join(' | '));
  await h.ctx.close();

  // --- a bike officer, the later file not in yet
  stage = 'morning'; bike = true;
  h = await openPhone(viewport); s = await h.read();
  check(label + ': a bike officer has their own bar', s.bikeBar === true);
  check(label + ': on it customers and debt are figures', s.bar.cust === '2' && /9/.test(s.bar.deni), JSON.stringify(s.bar));
  check(label + ': and Marejesho and Rec are a dash before the later file', s.bar.rec === DASH && s.bar.pct === DASH, JSON.stringify(s.bar));
  check(label + ': the card under the tabs is the line alone', s.shown && s.notes.length === 1 && s.notes[0] === LINE && s.text === LINE, JSON.stringify(s.text));
  check(label + ': no script error on the bike officer\'s screen', h.errs.length === 0, h.errs.join(' | '));
  await shot(h.page, label + '-bike-morning');
  await h.ctx.close();

  // --- the bike officer with both files in
  stage = 'pair'; bike = true;
  h = await openPhone(viewport); s = await h.read();
  check(label + ': with both files in the bike officer\'s bar prints recovered and Rec', /^1(\.0)?k$/.test(s.bar.rec) && s.bar.pct === '11%', JSON.stringify(s.bar));
  check(label + ': and there is no card', s.shown === false, JSON.stringify(s.text));
  await h.ctx.close();
}
phoneSrv.close();

/* ====================================================================== THE PORTAL */
const DAY = '2026-11-24', BEFORE = '2026-11-23', NOW = Date.parse(DAY + 'T07:00:00Z');
const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const wdOf = d => WD[new Date(d + 'T12:00:00Z').getUTCDay()];
function drow(ref, date, type, arrears) {
  return { ref, full_name: 'C ' + ref, contact: '0714' + ref, team: 'MASWA', arrears, status: 'Defaulter', days_elapsed: 3, disb_date: '2026-11-17',
    ds: '3-6', dc: 3, weekday: wdOf(date), snapshot_date: date, snapshot_type: type, upload_batch: type[0] + date, created_at: date + (type === 'initial' ? 'T02:00:00Z' : 'T17:00:00Z') };
}
function tablesFor(st) {
  const d = [drow('A', BEFORE, 'initial', 30000), drow('A', BEFORE, 'current', 30000), drow('B', BEFORE, 'initial', 12000), drow('B', BEFORE, 'current', 12000),
    drow('A', DAY, 'initial', 30000), drow('B', DAY, 'initial', 12000)];
  if (st === 'pair') d.push(drow('A', DAY, 'current', 20000));
  return { teams: [{ team: 'MASWA', zone: 'LAKE', team_code: 'MAS 1', gmo: 'GMO M', manager: 'MANAGER M', bike: 'BIKE M', opm: 'OPM M', recovery: 'REC M', credit: 'CA M', expected: 'EARLY M' }],
    settings: [], access_codes: [], roles: [], defaulter_snapshots: d, repayment_snapshots: [], followup_status: [], followup_comments: [], call_logs: [], call_users: [],
    loans: [], received_payments: [] };
}
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: USER_TABS.slice() };
let situation = 'morning';
const REAL = new Set(['expectedDefaulters', 'expdfReport', 'expdfLeader']);
async function portalAnswer(fn, args) {
  if (REAL.has(fn)) return portalApi(fakeDb(tablesFor(situation)), ADMIN, fn, args || {}, NOW);
  if (fn === 'notifications') return { ok: true, unseen: 0, seenAt: '', items: [] };
  if (fn === 'settings') return { ok: true, rows: [] };
  if (fn === 'dashboardFull') return { ok: true, kpis: {}, teams: [], weekdays: [], pipeline: {}, totals: {}, recovery: {}, legal: {} };
  if (fn === 'officerBoards') return { ok: true, boards: [] };
  return { ok: true, rows: [] };
}
const portalSrv = http.createServer((req, res) => {
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
      let out;
      try { const { fn, args } = JSON.parse(b || '{}'); out = await portalAnswer(fn, args); } catch (e) { out = { ok: false, error: String(e && e.message || e) }; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => portalSrv.listen(0, r));
const portalBase = 'http://127.0.0.1:' + portalSrv.address().port;
const SW = 'Faili la jioni la siku hii bado halijapakiwa: marejesho yanasoma 0 na hakuna aliye CLEARED hadi lipakiwe.';
const EN = 'The later file of this day is not uploaded yet: recovery reads 0 and nobody reads CLEARED until it is.';

async function openPortal(viewport, tab, wait) {
  const page = await browser.newPage({ viewport });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(portalBase + '/');
  await page.evaluate(u => { S.code = 'X1'; start(u); }, { name: 'THE ADMIN', role: 'ADMIN', teams: null, teamCount: 0, tabs: ['dashboard', 'defexp', 'expdfrep'],
    ui: { presentSeconds: 30, refreshSeconds: 20, hintIntervalSeconds: 600, hintLifetimeSeconds: 12 } });
  await page.waitForTimeout(400);
  await page.evaluate(t => go(t), tab);
  await page.waitForFunction(re => new RegExp(re).test(document.body.innerText), wait, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { page, errs, text: () => page.evaluate(() => document.body.innerText),
    notes: () => page.evaluate(() => Array.from(document.querySelectorAll('.xd-later')).map(n => n.textContent)) };
}

for (const [viewport, label] of [[{ width: 1366, height: 800 }, 'laptop'], [{ width: 390, height: 800 }, 'small']]) {
  // --- THE REPORT'S DAY, before the later file
  situation = 'morning';
  let p = await openPortal(viewport, 'expdfrep', 'Marejesho / Recovered');
  let n = await p.notes(), txt = await p.text();
  check(label + ': the Exp.Def Report\'s day says the later file is not in, in Swahili and English', n.length === 1 && n[0].includes(SW) && n[0].includes(EN), JSON.stringify(n));
  check(label + ': the report still shows the morning\'s two customers', /Wateja \/ Customers\s*2\b/i.test(txt), (txt.match(/Wateja \/ Customers\s*\S+/i) || [txt.slice(0, 200)])[0].replace(/\s+/g, ' '));
  check(label + ': no script error on the report', p.errs.length === 0, p.errs.join(' | '));
  await shot(p.page, label + '-report-morning');
  // --- A LEADER'S CARD, opened from that report
  await p.page.evaluate(() => xdLeaderOpen_('GMO', 'GMO M', ''));
  await p.page.waitForFunction(() => document.querySelectorAll('.xd-later').length >= 2, null, { timeout: 8000 }).catch(() => {});
  n = await p.notes();
  check(label + ': a leader\'s card carries the same line', n.length === 2 && n.every(x => x.includes(SW) && x.includes(EN)), JSON.stringify(n.length));
  check(label + ': no script error on the card', p.errs.length === 0, p.errs.join(' | '));
  await shot(p.page, label + '-card-morning');
  // --- THE WEEK never carries it (it lists the days that were not filed in its own note)
  await p.page.evaluate(() => { var d = document.getElementById('drawer'); if (d && typeof closeDrawer === 'function') closeDrawer(); S.args.period = 'week'; render(); });
  await p.page.waitForFunction(() => /Wiki ni jumla ya siku zake/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
  await p.page.waitForTimeout(300);
  n = await p.page.evaluate(() => Array.from(document.querySelectorAll('#view .xd-later')).map(x => x.textContent));
  txt = await p.text();
  check(label + ': the week view does not carry the line (it has its own words for a day that was not filed)', n.length === 0 && /Wiki ni jumla ya siku zake/.test(txt), JSON.stringify(n));
  await p.page.close();

  // --- THE EXPECTED DEFAULTERS TAB, before the later file
  p = await openPortal(viewport, 'defexp', 'In the weekly cycle');
  n = await p.notes(); txt = await p.text();
  check(label + ': the Expected Defaulters tab says it too', n.length === 1 && n[0].includes(SW) && n[0].includes(EN), JSON.stringify(n));
  const statuses = await p.page.evaluate(() => Array.from(document.querySelectorAll('#view table tbody tr')).map(tr => tr.textContent));
  check(label + ': and nobody on its list reads CLEARED', statuses.length >= 2 && !statuses.some(x => /CLEARED/.test(x)), statuses.length + ' rows');
  check(label + ': no script error on the tab', p.errs.length === 0, p.errs.join(' | '));
  await shot(p.page, label + '-tab-morning');
  await p.page.close();

  // --- WITH BOTH FILES IN nothing is said, anywhere
  situation = 'pair';
  p = await openPortal(viewport, 'expdfrep', 'Marejesho / Recovered');
  n = await p.notes(); txt = await p.text();
  check(label + ': with both files in the report says nothing of it', n.length === 0, JSON.stringify(n));
  check(label + ': and shows what was recovered', /Marejesho \/ Recovered\s*22,000/i.test(txt), (txt.match(/Marejesho \/ Recovered\s*\S+/i) || [txt.slice(0, 200)])[0].replace(/\s+/g, ' '));
  await p.page.evaluate(() => xdLeaderOpen_('GMO', 'GMO M', ''));
  await p.page.waitForTimeout(900);
  check(label + ': nor does a leader\'s card', (await p.notes()).length === 0);
  check(label + ': no script error with both files in', p.errs.length === 0, p.errs.join(' | '));
  await p.page.close();
  p = await openPortal(viewport, 'defexp', 'In the weekly cycle');
  check(label + ': nor does the tab', (await p.notes()).length === 0);
  await p.page.close();
}

await browser.close(); portalSrv.close();
for (const s of ok) console.log('ok   ' + s);
for (const s of fail) console.log('FAIL ' + s);
console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall ' + ok.length + ' passed');
process.exit(fail.length ? 1 : 0);
