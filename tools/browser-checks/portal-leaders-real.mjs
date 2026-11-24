/* The Teams & Staff leaders card, the REAL public/app.html and public/mod/admin.js in a real browser, talking to the REAL
   portalApi over the repository's own fake database (not a stub that answers what the page hopes to hear).

     "The access codes hold the latest staff / leader per team, so unless not there, will be set at teams and staff but
      teams and staff ... must always update the leaders as from settings (Misimbo ya kuingia / Access codes)" ... "and
      that should affect all the current teams and staff nav data right away" -- the owner, 20 Nov 2026

   Why this one exists (handbook Part 122): the first check of this screen (portal-leaders-sync.mjs) answers the page from a
   stub that says "something differs" for ever, so it could not see that the page's own look straight after an Undo found the
   same difference and wrote it back -- an Undo that undid nothing. Here every question is answered by the server's code:

     1. opening the tab brings the book into line, once, and the list is read after it;
     2. Undo puts the cells back AND THEY STAY BACK: the look the page takes afterwards writes nothing, the card says what it
        is holding back, and no Undo is offered for a sync that no longer exists;
     3. Sync now says it will write what was undone, and does;
     4. a later open of a book that agrees still lists the cells the last sync changed (what Undo would put back);
     5. a check or a sync that FAILS is said on the card, as text, and the list still opens;
     6. saving or deleting an access code says what the sheet did;
     7. a view-only code is shown what differs and is never asked to write.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-leaders-real.mjs

   CHROME overrides the browser path. Exit code 0 = everything passed. */
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
const { portalApi } = await import(path.join(ROOT, 'api/_lib/portal-core.js'));
const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');

const COLS = ['opm', 'recovery', 'gmo', 'manager', 'credit', 'expected', 'bike'];
const PHONE = { opm: 'opm_no', recovery: 'recovery_no', gmo: 'gmo_no', manager: 'manager_no', credit: 'credit_no', expected: 'expected_no', bike: 'bike_no' };
const IDS = { opm: null, recovery: 'recovery_id', gmo: 'gmo_id', manager: 'manager_id', credit: 'credit_id', expected: 'early_col_id', bike: 'bike_id' };
const team = (name, o = {}) => {
  const r = { team: name, team_code: 'C-' + name, zone: null };
  for (const c of COLS) { r[c] = null; r[PHONE[c]] = null; if (IDS[c]) r[IDS[c]] = null; }
  return { ...r, ...o };
};
const HOSTILE = '<img src=x onerror="window.__pwned=1">';
function makeBook(extraCodes = []) {
  return fakeDb({
    teams: [team('KONGOWE', { gmo: 'OLD GMO', gmo_no: '0700000001', gmo_id: 'ID-OLD', manager: 'M OLD' }),
            team('MBAGALA', { gmo: 'ALSO OLD' }), team('TEMEKE', { gmo: 'ASHA JUMA' })],
    access_codes: [{ code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['settings'] },
      { code: 'G1', name: 'NEW GMO', role: 'GMO', teams: ['KONGOWE', 'MBAGALA'], tabs: [] },
      { code: 'M1', name: 'NEW MGR', role: 'MANAGER', teams: ['KONGOWE'], tabs: [] }, ...extraCodes],
    settings: [], call_users: [], roles: [], team_holders: [], audit_log: [],
  });
}
let db = makeBook();
let USER = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['teams', 'settings', 'upload'] };
const REAL = new Set(['leadersCheck', 'leadersSync', 'leadersSyncUndo', 'teams', 'callAgents', 'saveAccessCode', 'deleteAccessCode']);
const calls = [];                      // [fn, args] for everything the page asked, in order
let failFn = null;                     // a portal function the server answers with a 500

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
    req.on('end', async () => {
      const { fn, args } = JSON.parse(b || '{}');
      calls.push([fn, args || {}]);
      if (fn === failFn) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'canceling statement due to statement timeout' })); return; }
      let out;
      try { out = REAL.has(fn) ? await portalApi(db, USER, fn, args || {}) : { rows: [] }; }
      catch (e) { res.writeHead(e.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, ...out, workspace: 'hopepmo' }));
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
const BENIGN = /favicon|status of 404|ERR_FAILED|brand|status of 500/;
const names = () => calls.map(c => c[0]);
const cellOf = (t, c) => db._dump('teams').find(x => x.team === t)[c];
const settingsRow = k => { const r = db._dump('settings').find(x => x.key === k); return r ? JSON.parse(r.value) : null; };
const UI = { presentSeconds: 30, refreshSeconds: 600, hintIntervalSeconds: 3600, hintLifetimeSeconds: 5 };
const ME = { name: 'THE ADMIN', role: 'ADMIN', teams: null, teamCount: null, tabs: ['dashboard', 'teams', 'settings'], can: { dashboard: true, upload: false, admin: true }, ui: UI };

async function open(me) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(base + '/');
  await page.evaluate(m => { S.code = 'ADM'; start(m); }, me);
  await page.waitForTimeout(500);
  calls.length = 0;
  await page.evaluate(() => go('teams'));
  await page.waitForSelector('#leadersCard, #view table', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  return page;
}
const text = (page, sel) => page.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
const has = (page, sel) => page.evaluate(s => !!document.querySelector(s), sel);
const rowsOf = page => page.evaluate(() => [...document.querySelectorAll('#view table tbody tr')].length);

// --- 1. opening the tab: one check, one write, the list read after it
let page = await open(ME);
check('the check is asked first, then the write, once each, then the list', names()[0] === 'leadersCheck' && names().filter(n => n === 'leadersSync').length === 1
  && names().indexOf('leadersSync') < names().indexOf('teams'), names().join(','));
// "remove the wafanyakazi / staff by person at teams and staff" (the owner, 24 Nov 2026, Part 148): the screen no longer draws that card and no longer asks for the roster behind it
check('opening Teams & Staff asks no staff roster, and draws no staff-by-person card or its button', !names().includes('staffRoster') && !(await has(page, '#staffCard')) && !(await has(page, '#newStaff')), names().join(','));
check('the book is brought into line', cellOf('KONGOWE', 'gmo') === 'NEW GMO' && cellOf('MBAGALA', 'gmo') === 'NEW GMO' && cellOf('KONGOWE', 'manager') === 'NEW MGR');
check('the previous leader\'s number is not left beside the new one', cellOf('KONGOWE', 'gmo_no') === null && cellOf('KONGOWE', 'gmo_id') === null);
check('the card says 3 leaders were brought into line', /3/.test(await text(page, '#leadersCard')) && /brought into line/.test(await text(page, '#leadersCard')));
check('Undo is offered', await has(page, '#leadersUndo'));
// "fix the handlers lost after table search" (the owner, 23 Nov 2026): a keystroke in the search box above the
// table repaints the whole screen; what wireForms() wired in the head (+ New team here) must still answer.
if (await has(page, '#tblQ')) {
  await page.fill('#tblQ', 'KONGOWE'); await page.waitForTimeout(400);
  await page.click('#newTeam'); await page.waitForTimeout(500);
  const open = await page.evaluate(() => getComputedStyle(document.getElementById('drawerBg')).display !== 'none');
  check('after a table search, + New team still opens the form', open);
  await page.evaluate(() => closeDrawer());
  await page.fill('#tblQ', ''); await page.waitForTimeout(400);
} else fail.push('no search box on Teams & Staff to try the repaint with');

// --- 2. Undo puts the cells back and they STAY back (on the same screen, straight after the sync it undoes)
calls.length = 0;
await page.click('#leadersUndo');
await page.waitForTimeout(1500);
check('Undo asks the server to undo, then LOOKS (check) and does not write again', names()[0] === 'leadersSyncUndo' && names().includes('leadersCheck') && !names().includes('leadersSync'), names().join(' -> '));
check('the cells are back as they were', cellOf('KONGOWE', 'gmo') === 'OLD GMO' && cellOf('MBAGALA', 'gmo') === 'ALSO OLD' && cellOf('KONGOWE', 'manager') === 'M OLD', JSON.stringify([cellOf('KONGOWE', 'gmo'), cellOf('MBAGALA', 'gmo')]));
check('with the number and ID that came with them', cellOf('KONGOWE', 'gmo_no') === '0700000001' && cellOf('KONGOWE', 'gmo_id') === 'ID-OLD');
let card = await text(page, '#leadersCard');
check('the card says it is holding them back, in both languages', /zimeshikwa/.test(card) && /held back/.test(card), card.slice(0, 220));
check('and says nothing was brought into line just now', !/leaders were brought into line/.test(card));
check('no Undo is offered for a sync that no longer exists', !(await has(page, '#leadersUndo')));
check('what is held is listed with the person the code names', /OLD GMO/.test(await page.evaluate(() => (document.querySelector('#leadersCard details') || {}).textContent || '')) && /NEW GMO/.test(await page.evaluate(() => (document.querySelector('#leadersCard details') || {}).textContent || '')));
// a second open, and a plain save of the same code: still held
calls.length = 0;
await page.evaluate(() => go('teams'));
await page.waitForTimeout(900);
check('opening it again writes nothing: the check finds nothing to change', names().includes('leadersCheck') && !names().includes('leadersSync'), names().join(','));
check('and the book is still as the owner put it', cellOf('KONGOWE', 'gmo') === 'OLD GMO');
const saved = await page.evaluate(async () => { try { return await srv('saveAccessCode', { code: 'G1', oldCode: 'G1', name: 'NEW GMO', role: 'GMO', teams: 'KONGOWE;MBAGALA', tabs: 'teams' }); } catch (e) { return { error: String(e.message || e) }; } });
check('saving the same code again does not write the undone leader back', cellOf('KONGOWE', 'gmo') === 'OLD GMO' && saved.leaders && saved.leaders.held >= 2, JSON.stringify(saved.leaders || saved));

// --- 3. Sync now says it will write what was undone, and does
let confirmText = '';
page.removeAllListeners('dialog');
page.on('dialog', d => { confirmText = d.message(); d.accept(); });
calls.length = 0;
await page.evaluate(() => go('teams'));
await page.waitForSelector('#leadersNow', { timeout: 4000 });
await page.click('#leadersNow');
await page.waitForTimeout(1500);
check('Sync now asks first, in both languages, because it would write cells that were undone', /ulizirudisha/.test(confirmText) && /undid/.test(confirmText), confirmText.slice(0, 120));
const syncCall = calls.find(c => c[0] === 'leadersSync');
check('and sends the explicit "let go of the holds"', !!syncCall && syncCall[1].releaseHolds === true, JSON.stringify(syncCall));
check('the leaders are brought into line again', cellOf('KONGOWE', 'gmo') === 'NEW GMO' && cellOf('MBAGALA', 'gmo') === 'NEW GMO');
check('and there is a sync to undo again', await has(page, '#leadersUndo'));

// --- 4. a later open of a book that agrees still lists what the last sync changed
calls.length = 0;
await page.evaluate(() => go('teams'));
await page.waitForTimeout(900);
const later = await page.evaluate(() => (document.querySelector('#leadersCard') || {}).textContent || '');
check('a later open asks the check and nothing else', names().includes('leadersCheck') && !names().includes('leadersSync'), names().join(','));
check('it says every leader agrees', /Every leader agrees/.test(later));
check('and still lists the cells the last sync changed, the way Undo would put them back', /The last sync/.test(later) && /KONGOWE/.test(later) && /OLD GMO/.test(later));
check('with the Undo for it', await has(page, '#leadersUndo'));
await page.close();

// --- 5. a failure is said, as text, and the list still opens
for (const fn of ['leadersCheck', 'leadersSync']) {
  db = makeBook();
  failFn = fn;
  page = await open(ME);
  failFn = null;
  card = await text(page, '#leadersCard');
  check(fn + ' fails: the card says so, in both languages', /hawakuweza kulinganishwa/.test(card) && /could not be checked/.test(card), card.slice(0, 200));
  check('...with the server\'s own words', /statement timeout/.test(card));
  check('...and the list still opens', (await rowsOf(page)) >= 3, String(await rowsOf(page)));
  check('...with a way to try again', await has(page, '#leadersNow'));
  await page.close();
}

// --- 6. saving and deleting an access code say what the sheet did to every other team's leader
db = makeBook();
page = await open(ME);                                    // the open brings the whole book into line ...
await portalApi(db, USER, 'saveTeam', { team: 'KONGOWE', manager: 'M OLD' });      // ... then somebody puts one cell back by hand: drift the save will find
await page.evaluate(() => codeForm({ code: 'G1', name: 'NEW GMO', role: 'GMO', teams: ['KONGOWE', 'MBAGALA'], tabs: [] }));
await page.waitForSelector('#kSave', { timeout: 4000 });
await page.click('#kSave');
await page.waitForTimeout(1200);
let toast = await text(page, '#toast');
check('the save says the code was saved', /Imehifadhiwa/.test(toast), toast.slice(0, 160));
check('and says the OTHER leaders were brought into line (one cell had drifted)', /1 leaders on Teams & Staff brought into line/.test(toast), toast.slice(0, 300));
check('the sheet followed', cellOf('KONGOWE', 'manager') === 'NEW MGR');
await page.close();
db = makeBook([{ code: 'G2', name: 'OTHER GMO', role: 'GMO', teams: ['KONGOWE'], tabs: [] }]);   // two codes dispute KONGOWE's GMO
page = await open(ME);
check('two codes naming two people on one team change nothing, and the card says so', cellOf('KONGOWE', 'gmo') === 'OLD GMO' && /OTHER GMO/.test(await page.evaluate(() => (document.querySelector('#leadersCard details') || {}).textContent || '')));
await page.evaluate(() => codeForm({ code: 'G2', name: 'OTHER GMO', role: 'GMO', teams: ['KONGOWE'], tabs: [] }));
await page.waitForSelector('#kDel', { timeout: 4000 });
await page.click('#kDel');
await page.waitForTimeout(1200);
toast = await text(page, '#toast');
check('deleting a code says it was deleted', /Imefutwa/.test(toast), toast.slice(0, 160));
check('and that the one that is left now leads: the sheet followed at once', /1 leaders on Teams & Staff brought into line/.test(toast) && cellOf('KONGOWE', 'gmo') === 'NEW GMO', toast.slice(0, 300));
await page.close();

// --- 7. a view-only code is shown what differs and never asked to write
db = makeBook();
USER = { code: 'V', name: 'SUPERVISOR', role: 'AUDITOR', teams: null, tabs: ['teams', 'settings'], readOnly: true };
page = await open({ ...ME, name: 'SUPERVISOR', role: 'AUDITOR', readOnly: true });
check('a view-only code asks the check and never the write', names().includes('leadersCheck') && !names().includes('leadersSync'), names().join(','));
check('it is shown what differs, with no button to press', /differ/.test(await text(page, '#leadersCard')) && !(await has(page, '#leadersNow')) && !(await has(page, '#leadersUndo')));
check('and nothing was written', cellOf('KONGOWE', 'gmo') === 'OLD GMO');
await page.close();

check('no script error anywhere', errs.length === 0, errs.join(' | ').slice(0, 300));
await browser.close(); srv.close();
for (const f of fail) console.log('FAIL', f);
for (const o of ok) console.log('PASS', o);
console.log('\n' + ok.length + ' points pass' + (fail.length ? ', ' + fail.length + ' FAIL' : ''));
process.exit(fail.length ? 1 : 0);
