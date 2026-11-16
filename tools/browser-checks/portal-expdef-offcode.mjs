/* Drives the REAL public/app.html in a real browser, against a stub /api/portal whose answers are the
   REAL server's (the same fixture is run through portalApi first), to prove the two screens that say
   what a leader's own code cannot see:

     "gmo or opm is seeing expected defaulters of gmo or manager where that manager in their code
      ain't seeing them, they getting just a little like two yet a Manager's gmo sees the manager has
      many or opm sees o has many so make sure the distribution is okay" -- the owner, 16 Nov 2026

   * Expected Defaulters, signed in as the manager: the note naming the teams the sheet gives her that her
     code does not hold, and "Wangu / My list" counting her whole book whatever the blanks of her name.
   * The Exp.Def Report, signed in as the GMO: the "Off code" column on the leader's row and the board's note.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-expdef-offcode.mjs

   CHROME overrides the browser path. SHOTS=<dir> also saves a picture of each screen there. Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHOTS = process.env.SHOTS || '';
const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
const { fakeDb } = await import(path.join(ROOT, 'test/fake-db.mjs'));
const { portalApi } = await import(path.join(ROOT, 'api/_lib/portal-core.js'));
const { USER_TABS } = await import(path.join(ROOT, 'api/_lib/auth.js'));

const NOW = Date.parse('2026-07-24T09:00:00Z');                 // a Friday
const TODAY = '2026-07-24';
const TEAMS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
function tablesFor(managerCell, codes) {
  const teams = TEAMS.map(t => ({ team: t, team_code: t + 'CODE', opm: 'OPM O', recovery: null, gmo: 'GINA G', manager: managerCell(t), credit: null, expected: null,
    bike: ['T1', 'T2'].includes(t) ? 'BIKE B' : null }));
  const snaps = []; let n = 0;
  for (const t of TEAMS) for (let i = 0; i < 24; i++) {
    n++;
    const base = { ref: 'R' + n, full_name: 'C' + n, contact: '0712' + String(n).padStart(6, '0'), team: t, status: 'Defaulter', days_elapsed: 1 + (i % 18),
      disb_date: '2026-07-' + String(13 + (i % 7)).padStart(2, '0'), ds: '3-6', dc: 3, weekday: 'FRI', snapshot_date: TODAY };
    snaps.push({ ...base, arrears: 1000 + n, snapshot_type: 'initial', upload_batch: 'bi', created_at: TODAY + 'T04:00:00Z' });
    snaps.push({ ...base, arrears: 900 + n, snapshot_type: 'current', upload_batch: 'bc', created_at: TODAY + 'T08:00:00Z' });
  }
  return { teams, access_codes: codes, roles: [], settings: [], repayment_snapshots: [], defaulter_snapshots: snaps, followup_status: [], followup_comments: [],
    call_users: [], call_logs: [], loans: [], received_payments: [] };
}
const code = (c, name, role, teams) => ({ code: c, name, role, teams, tabs: [] });
const asUser = c => ({ code: c.code, name: c.name, role: c.role, teams: c.teams && c.teams.length ? c.teams : null, tabs: USER_TABS.slice() });

const GINA = code('G', 'GINA G', 'GMO', TEAMS);
const MARY_SHORT = code('M', 'MARY M', 'MANAGER', ['T1', 'T2']);
const MARY_ALL = code('M', 'MARY M', 'MANAGER', TEAMS);

/* The real answers of the real server for the three situations the page has to draw. */
const answers = {
  short: {
    expectedDefaulters: await portalApi(fakeDb(tablesFor(() => 'MARY M', [GINA, MARY_SHORT])), asUser(MARY_SHORT), 'expectedDefaulters', {}, NOW),
    expdfReport: await portalApi(fakeDb(tablesFor(() => 'MARY M', [GINA, MARY_SHORT])), asUser(GINA), 'expdfReport', { period: 'day' }, NOW),
  },
  blanks: {          // the cell says 'MARY  M' on every team and her code says 'MARY M'
    expectedDefaulters: await portalApi(fakeDb(tablesFor(() => 'MARY  M', [GINA, MARY_ALL])), asUser(MARY_ALL), 'expectedDefaulters', {}, NOW),
  },
  whole: {
    expectedDefaulters: await portalApi(fakeDb(tablesFor(() => 'MARY M', [GINA, MARY_ALL])), asUser(MARY_ALL), 'expectedDefaulters', {}, NOW),
    expdfReport: await portalApi(fakeDb(tablesFor(() => 'MARY M', [GINA, MARY_ALL])), asUser(GINA), 'expdfReport', { period: 'day' }, NOW),
  },
};
let situation = 'short';

const calls = [];
function answer(fn) {
  calls.push(fn);
  const a = answers[situation][fn];
  if (a) return a;
  if (fn === 'notifications') return { ok: true, unseen: 0, seenAt: '', items: [] };
  if (fn === 'settings') return { ok: true, rows: [] };
  if (fn === 'dashboardFull') return { ok: true, kpis: {}, teams: [], weekdays: [], pipeline: {}, totals: {}, recovery: {}, legal: {} };
  if (fn === 'officerBoards') return { ok: true, boards: [] };
  return { ok: true, rows: [] };
}
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
    req.on('end', () => { const { fn } = JSON.parse(b || '{}'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(answer(fn))); });
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const ok = [], fail = [];
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (extra ? ' -- ' + extra : ''));

async function openAs(viewport, user, tab, label) {
  const page = await browser.newPage({ viewport });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const BENIGN = /favicon|status of 404|ERR_FAILED|brand/;
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(base + '/');
  await page.evaluate(u => { S.code = 'X1'; start(u); }, { ...user, teamCount: (user.teams || []).length, tabs: ['dashboard', 'defexp', 'expdfrep'],
    ui: { presentSeconds: 30, refreshSeconds: 20, hintIntervalSeconds: 600, hintLifetimeSeconds: 12 } });
  await page.waitForTimeout(400);
  await page.evaluate(t => go(t), tab);
  await page.waitForFunction(() => /Wangu \/ My list|Kwa MANAGER \/ By MANAGER/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  return { page, errs, text: () => page.evaluate(() => document.body.innerText),
    shot: async name => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, label + '-' + name + '.png') }); } } };
}

for (const [viewport, label] of [[{ width: 1366, height: 800 }, 'laptop'], [{ width: 390, height: 800 }, 'phone']]) {
  // --- THE MANAGER, whose code holds two of the six teams the sheet names her on
  situation = 'short';
  let p = await openAs(viewport, { name: 'MARY M', role: 'MANAGER', teams: ['T1', 'T2'] }, 'defexp', label);
  let txt = await p.text();
  check(label + ': the manager\'s list opens on "Wangu / My list" with her sixteen in the two teams she can see', /Wangu \/ My list\s*\(16\)/.test(txt), (txt.match(/Wangu \/ My list\s*\(\d+\)/) || [''])[0]);
  check(label + ': it names the four teams her code does not hold, in Swahili', /timu zina jina lako kwenye Teams & Staff lakini code yako haizioni/.test(txt) && /T3, T4, T5, T6/.test(txt));
  check(label + ': and in English', /Your name is on 4 teams in Teams & Staff that your access code does not hold/.test(txt));
  check(label + ': no script error on the manager\'s list', p.errs.length === 0, p.errs.join(' | '));
  await p.shot('manager-list');
  await p.page.close();

  // --- THE SAME MANAGER once her code holds every team: nothing is said
  situation = 'whole';
  p = await openAs(viewport, { name: 'MARY M', role: 'MANAGER', teams: TEAMS }, 'defexp', label);
  txt = await p.text();
  check(label + ': with every team on her code the note is not there', !/code yako haizioni/.test(txt));
  check(label + ': and her whole book is counted', /Wangu \/ My list\s*\(48\)/.test(txt), (txt.match(/Wangu \/ My list\s*\(\d+\)/) || [''])[0]);
  await p.page.close();

  // --- A DOUBLE BLANK in her name on every team: the page finds her book all the same
  situation = 'blanks';
  p = await openAs(viewport, { name: 'MARY M', role: 'MANAGER', teams: TEAMS }, 'defexp', label);
  txt = await p.text();
  check(label + ': a double blank in the sheet\'s spelling still gives her "My list" of forty-eight', /Wangu \/ My list\s*\(48\)/.test(txt), (txt.match(/Wangu \/ My list\s*\(\d+\)/) || ['no My list'])[0]);
  check(label + ': no script error', p.errs.length === 0, p.errs.join(' | '));
  await p.page.close();

  // --- THE GMO'S REPORT
  situation = 'short';
  p = await openAs(viewport, { name: 'GINA G', role: 'GMO', teams: TEAMS }, 'expdfrep', label);
  txt = await p.text();
  check(label + ': the report has an "Off code" column (the header is upper-cased by the table\'s own style)', /Off code/i.test(txt));
  check(label + ': the manager\'s row says four teams are off her code, naming three and counting the rest', /4 · T3, T4, T5 \+1/.test(txt), (txt.match(/\d · T\d[^\n]*/) || ['none'])[0]);
  check(label + ': the MANAGER board says how many leaders cannot see all their teams', /1 kiongozi hawezi kuona timu zake zote kwenye code yake \/ 1 leader cannot see all their teams on their own code/.test(txt));
  check(label + ': the GMO\'s own board says nothing of the kind', (txt.match(/cannot see all their teams/g) || []).length === 1);
  check(label + ': no script error on the report', p.errs.length === 0, p.errs.join(' | '));
  await p.shot('gmo-report');
  await p.page.close();

  situation = 'whole';
  p = await openAs(viewport, { name: 'GINA G', role: 'GMO', teams: TEAMS }, 'expdfrep', label);
  txt = await p.text();
  check(label + ': with every code whole the report says nothing of it', !/cannot see all their teams/.test(txt) && !/\d · T\d/.test(txt));
  await p.page.close();
}

await browser.close(); srv.close();
for (const s of ok) console.log('ok   ' + s);
for (const s of fail) console.log('FAIL ' + s);
console.log(fail.length ? '\n' + fail.length + ' FAILED' : '\nall ' + ok.length + ' passed');
process.exit(fail.length ? 1 : 0);
