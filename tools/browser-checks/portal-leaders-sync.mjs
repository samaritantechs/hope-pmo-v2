/* The Teams & Staff screen brings the leaders into line with the access codes as it opens, in the REAL
   public/app.html and public/mod/admin.js, in a real browser, against a stub /api/portal.

     "The access codes hold the latest staff / leader per team, so unless not there, will be set at teams
      and staff but teams and staff ... must always update the leaders as from settings (Misimbo ya
      kuingia / Access codes)" ... "and that should affect all the current teams and staff nav data right
      away" -- the owner, 20 Nov 2026

   What a unit test cannot say: that the screen asks for the sync BEFORE it reads the list, once for an
   open, and not at all for a view-only code (the server would refuse it and write that refusal in the
   audit log every time the tab opened); that the card says what happened in words a person reads; that a
   leader's name is drawn as TEXT (names are typed by people); that the two buttons are wired and send the
   right calls; and that a settled book shows no Undo.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-leaders-sync.mjs

   CHROME overrides the browser path. Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');

const calls = [];                       // every portal fn the page asked for, in order
let mode = 'changed';                   // what the stub's leadersSync answers
let synced = false;                     // true once the stub has ANSWERED the sync (it answers late on purpose)
const HOSTILE = '<img src=x onerror="window.__pwned=1">';

const CHANGED = {
  ok: true, preview: false, applied: true, at: '2026-11-20T13:30:00.000Z',
  last: { at: '2026-11-20T13:30:00.000Z', by: 'THE ADMIN', n: 3 },
  changed: 3,
  changes: [
    { team: 'KONGOWE', col: 'gmo', was: 'OLD GMO', now: 'NEW GMO', why: 'replaced' },
    { team: 'MBAGALA', col: 'gmo', was: null, now: 'NEW GMO', why: 'filled' },
    { team: 'TEMEKE', col: 'manager', was: 'MARY', now: HOSTILE, why: 'fuller' },
  ],
  kept: [{ team: 'KONGOWE', col: 'manager', sheet: 'MARY SAMPLE', code: 'MARY' }],
  conflicts: [{ team: 'TEMEKE', col: 'gmo', names: ['ASHA JUMA', 'BOB BOSS'] }],
  offCode: [{ name: 'MARY SAMPLE', col: 'manager', teams: ['B', 'C'] }],
  unmapped: [{ role: 'ADMIN', codes: 1 }], allTeamsCodes: 2,
};
const SETTLED = { ok: true, preview: false, applied: false, at: '2026-11-20T13:31:00.000Z', last: null, changed: 0,
  changes: [], kept: [], conflicts: [], offCode: [], unmapped: [], allTeamsCodes: 0 };

function answer(fn) {
  calls.push(fn);
  if (fn === 'leadersCheck') return mode === 'changed' ? { ...CHANGED, preview: true, applied: false } : SETTLED;   // the read: what differs, nothing written
  if (fn === 'leadersSync') return mode === 'changed' ? CHANGED : SETTLED;
  if (fn === 'leadersSyncUndo') return { ok: true, restored: 3, skipped: 0, from: CHANGED.at };
  if (fn === 'teams') return { ok: true, count: 3, roles: [], allTabs: [],
    // until the sync has been answered the list is the stale one: a screen that did not WAIT for it shows OLD GMO
    rows: [{ team: 'KONGOWE', gmo: synced ? 'NEW GMO' : 'OLD GMO', team_code: 'K1' }, { team: 'MBAGALA', gmo: 'NEW GMO', team_code: 'M1' }, { team: 'TEMEKE', manager: 'X', team_code: 'T1' }] };
  if (fn === 'staffRoster') return { ok: true, staff: [], allTeams: ['KONGOWE', 'MBAGALA', 'TEMEKE'], roles: [] };
  if (fn === 'callAgents') return { ok: true, agents: [], unnamed: [] };
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
    req.on('end', () => {
      const { fn } = JSON.parse(b || '{}');
      const send = () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(answer(fn))); };
      if (fn === 'leadersSync') { calls.push('(asked leadersSync)'); setTimeout(() => { synced = true; send(); }, 350); return; }   // late on purpose
      send();
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
const BENIGN = /favicon|status of 404|ERR_FAILED|brand/;

async function open(me) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(base + '/');
  await page.evaluate(m => { S.code = 'ADM'; start(m); }, me);
  await page.waitForTimeout(500);
  calls.length = 0; synced = false;
  await page.evaluate(() => go('teams'));
  await page.waitForSelector('#view table, #view .card', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  return page;
}
const text = (page, sel) => page.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
const wired = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); return !!el && typeof el.onclick === 'function'; }, sel);
const UI = { presentSeconds: 30, refreshSeconds: 600, hintIntervalSeconds: 3600, hintLifetimeSeconds: 5 };
const ADMIN = { name: 'THE ADMIN', role: 'ADMIN', teams: null, teamCount: null, tabs: ['dashboard', 'teams', 'settings'], can: { dashboard: true, upload: false, admin: true }, ui: UI };

// --- 1. an admin opens Teams & Staff: the sync is asked for FIRST, once, and the card says what it did
mode = 'changed';
let page = await open(ADMIN);
check('the check (a read) is asked first when the tab opens', calls[0] === 'leadersCheck', calls.join(','));
check('the write is asked because the check found a difference', calls.includes('leadersSync'), calls.join(','));
check('each exactly once', calls.filter(c => c === 'leadersCheck').length === 1 && calls.filter(c => c === 'leadersSync').length === 1, calls.join(','));
check('BEFORE the list is read', calls.indexOf('leadersSync') >= 0 && calls.indexOf('leadersSync') < calls.indexOf('teams'), calls.join(','));
check('the card is on the screen', (await page.$('#leadersCard')) !== null);
const card = await text(page, '#leadersCard');
check('it says how many leaders were brought into line (3)', /3/.test(card) && /viongozi/.test(card) && /brought into line/.test(card), card.slice(0, 160));
check('it names the access code rule in both languages', /misimbo ya kuingia/.test(card) && /access code that holds a team names its leader/.test(card));
const details = await page.evaluate(() => (document.querySelector('#leadersCard details') || {}).innerHTML || '');
check('the changes are in the details: team, role, was and now', /KONGOWE/.test(details) && /OLD GMO/.test(details) && /NEW GMO/.test(details) && /Manager/.test(details));
check('the two codes that name two people are told, not changed', /ASHA JUMA \/ BOB BOSS/.test(details) && /hakuna kilichobadilishwa/.test(details));
check('the longer name kept on the sheet is told, with what the code says', /MARY SAMPLE \(MARY\)/.test(details));
check('the leader on teams their own code does not hold is told', /MARY SAMPLE/.test(details) && /B, C/.test(details));
check('the codes that name no leader are counted', /ADMIN ×1/.test(details));
check('a leader\'s name is drawn as TEXT, never as markup', (await page.evaluate(() => window.__pwned)) === undefined && (await page.$('#leadersCard img')) === null);
check('...and the hostile name is there, as characters', /<img src=x/.test(await text(page, '#leadersCard details')));
check('the last change is dated and signed', /2026-11-20 13:30/.test(card) && /THE ADMIN/.test(card));
check('Sync now is wired', await wired(page, '#leadersNow'));
check('Undo is offered, with the count', await wired(page, '#leadersUndo') && /\(3\)/.test(await text(page, '#leadersUndo')));
const listRow = await page.evaluate(() => [...document.querySelectorAll('#view table tbody tr')].map(r => r.textContent).find(t => /K1/.test(t)) || '');
check('the list below was read AFTER the sync had answered (the KONGOWE row shows NEW GMO, not the stale OLD GMO)', /NEW GMO/.test(listRow) && !/OLD GMO/.test(listRow), listRow.slice(0, 80));

// --- 2. the buttons send the right calls
calls.length = 0;
await page.click('#leadersNow');
await page.waitForTimeout(600);
check('Sync now sends a leadersSync of its own', calls.includes('(asked leadersSync)'), calls.join(','));
calls.length = 0;
await page.waitForSelector('#leadersUndo', { timeout: 4000 });
await page.click('#leadersUndo');
await page.waitForTimeout(600);
check('Undo sends leadersSyncUndo once, after the confirm', calls.filter(c => c === 'leadersSyncUndo').length === 1, calls.join(','));
await page.close();

// --- 3. a settled book: the card says everything agrees, and there is no Undo to offer
mode = 'settled';
page = await open(ADMIN);
const settled = await text(page, '#leadersCard');
check('a settled book says every leader agrees', /Viongozi wote wanalingana/.test(settled) && /Every leader agrees/.test(settled), settled.slice(0, 160));
check('and the write is NOT asked: a book that agrees costs the check and nothing else', calls.includes('leadersCheck') && !calls.includes('leadersSync'), calls.join(','));
check('and offers no Undo', (await page.$('#leadersUndo')) === null);
check('nor a details block with nothing in it', (await page.$('#leadersCard details')) === null);
await page.close();

// --- 4. a view-only code may be shown what differs, and is never asked to write
mode = 'changed';
page = await open({ ...ADMIN, readOnly: true });
check('a view-only code asks the check', calls.includes('leadersCheck'), calls.join(','));
check('and NEVER the write (the server would refuse it and write the refusal in the audit log)', !calls.includes('leadersSync'), calls.join(','));
check('and the list still opens', calls.includes('teams'), calls.join(','));
const ro = await text(page, '#leadersCard');
check('the card says what differs, in words that change nothing', /hawalingani/.test(ro) && /differ from the access codes/.test(ro), ro.slice(0, 140));
check('with no Sync now and no Undo to press', (await page.$('#leadersNow')) === null && (await page.$('#leadersUndo')) === null);
await page.close();

// --- 5. a code that is not an admin is not asked either
page = await open({ ...ADMIN, can: { dashboard: true, upload: false, admin: false }, tabs: ['dashboard', 'teams'] });
check('a code without the settings tab asks neither', !calls.includes('leadersCheck') && !calls.includes('leadersSync'), calls.join(','));
await page.close();

check('no script error anywhere', errs.length === 0, errs.join(' | '));
await browser.close();
srv.close();
console.log(ok.map(x => 'PASS ' + x).join('\n'));
if (fail.length) { console.log(fail.map(x => 'FAIL ' + x).join('\n')); process.exit(1); }
console.log('\n' + ok.length + ' points pass');
