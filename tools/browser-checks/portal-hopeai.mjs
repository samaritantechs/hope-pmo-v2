/* Drives the REAL public/app.html and the REAL public/mod/hopeai.js in a real browser, against the REAL portalApi over an in-memory book, to prove
   the Hope Ai tab does what the owner asked (handbook Part 158):

     "Have a new tab called Hope Ai in the system with rows of user chats that I could open and see what the user is chatting.. like reports of
      Claudian-PMO chats per user roles, teams and dates"                                                   -- the owner, 25 Nov 2026

     1. the tab is in the sidebar for an admin and for nobody else, and opens on the last seven days;
     2. a row for each chat (one person, one day) with who, role, teams, the counts of each kind and the first question, newest first;
     3. the role and team picks narrow the list, the counters and the boards together, from what has arrived (no second request), and survive
        a search in the table's box;
     4. a tap on a row opens the whole chat: every question and answer in order, drawn as TEXT (a question with markup in it runs nothing), with an
        Excel of the conversation;
     5. the boards under the list (by role, team and day, and the ready questions tapped) add up to the list and have their own Excel;
     6. another window reads another set of chats (a chat of ten days ago is out of the first and in the second);
     7. before db/RUN-ME-090 is run the tab says so and names the file: never an empty list that would read as "nobody asked";
     8. no page error in any world;
     9. the REPORT FOR CLAUDE and the CLEAR (handbook Part 162: "I need to always export a report you may need at that window of Hope Ai, then clear all
        existing history ... and keep the db fresh"): the export saves one text file of EVERYTHING on file (a chat ten days old that the window does not show
        is in it), the clear button is dead until then and for anybody but the admin, the clear deletes exactly what the report held and leaves a chat written
        after it, the tab reads the history again and says when it was last cleared.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-hopeai.mjs

   CHROME overrides the browser path; SHOTS=<dir> saves pictures. Exit code 0 = everything passed. The dates are worked out from today, so it runs on any day. */
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
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
const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
const MOD_DIR = path.join(ROOT, 'public/mod');

const eat = ms => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
const add = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TODAY = eat(Date.now()), Y = add(TODAY, -1), OLD = add(TODAY, -10);

/* THE BOOK: made-up people. JUMA asked two typed questions and tapped one ready question today (his teams are behind); ASHA, on the phone app, tapped
   two ready questions today and asked one question yesterday; ZUBERI, an all-teams person, hit a limit yesterday; MALICIOUS typed markup; and one chat is
   ten days old (outside the first seven days). */
let seq = 0;
const R = (day, hh, over) => ({ id: 'r' + String(++seq).padStart(5, '0'), created_at: day + 'T' + hh + 'Z', day, source: 'portal', user_key: 'k-juma', user_name: 'JUMA G', role: 'MANAGER',
  teams: 'KONGOWE, MBAGALA', zone: 'DAR CENTER', lang: 'sw', thread: 'k-juma:' + day, mode: 'ai', faq_id: null, question: 'Nifanyeje?', answer: 'Piga simu.', tokens_in: 1500, tokens_out: 40,
  cache_read: 1200, ms: 900, behind: true, note: null, ...over });
const asha = (day, hh, over) => R(day, hh, { source: 'call', user_key: 'k-asha', user_name: 'ASHA M', role: 'FIELD OFFICER', teams: 'TEMEKE', zone: 'DAR CENTER', thread: 'k-asha:' + day, behind: false, ...over });
const chats = () => [
  R(TODAY, '05:50:00', { question: 'Je, nifanye nini leo?', answer: 'Piga simu za portfolio kwa wateja wote.\nAngalia malengo.' }),
  R(TODAY, '05:55:00', { question: 'Reached % ni nini?', answer: 'Ni namba ulizozungumza nazo.', tokens_in: 1000, tokens_out: 60, cache_read: 800 }),
  R(TODAY, '06:20:00', { mode: 'faq', faq_id: 'improve', question: 'Nifanye nini ili kufikia malengo?', answer: null, tokens_in: null, tokens_out: null, cache_read: null, ms: null }),
  asha(TODAY, '07:00:00', { mode: 'faq', faq_id: 'portfolio-call', question: 'Simu ya portfolio ni nini?', answer: null, tokens_in: null, tokens_out: null, cache_read: null, ms: null }),
  asha(TODAY, '07:01:00', { mode: 'faq', faq_id: 'portfolio-call', question: 'Simu ya portfolio ni nini?', answer: null, tokens_in: null, tokens_out: null, cache_read: null, ms: null }),
  asha(Y, '08:00:00', { question: 'Namtafutaje mteja?', answer: 'Tumia utafutaji.', behind: null }),
  R(Y, '08:10:00', { user_key: 'k-zub', user_name: 'ZUBERI K', role: 'GM', teams: 'ALL', zone: 'ALL ZONES', thread: 'k-zub:' + Y, mode: 'limit', question: 'Swali jingine', answer: 'Claudian-PMO ana kazi nyingi.',
    tokens_in: null, tokens_out: null, behind: null }),
  R(Y, '09:00:00', { user_key: 'k-evil', user_name: 'MALICIOUS', role: 'PMO', teams: 'ALL', zone: 'HQ', thread: 'k-evil:' + Y, behind: false,
    question: '<img src=x onerror="window.__xss=1"> naomba <b>msaada</b>', answer: '<script>window.__xss=2</script>jibu' }),
  R(OLD, '08:00:00', { user_key: 'k-old', user_name: 'MZEE O', role: 'MANAGER', teams: 'ILEMELA', thread: 'k-old:' + OLD, question: 'Swali la zamani', behind: false }),
];
const tables = () => ({ audit_log: [], teams: [], access_codes: [{ code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['settings', 'hopeai'] }], settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }], roles: [], audit_log: [],
  claudian_chats: chats() });
const ADMIN = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['settings', 'hopeai', 'dashboard'] };
const CLERK = { code: 'CL1', name: 'A CLERK', role: 'CREDIT ANALYST', teams: ['KONGOWE'], tabs: ['dashboard'] };
let db = fakeDb(tables()), USER = ADMIN, NOWMS;                 // NOWMS: the server's clock for a world that needs one (the chats are seeded at fixed times of today)
const REAL = new Set(['claudianChats', 'claudianThread', 'claudianChatsExport', 'claudianChatsClear']);
const asked = [];
const warn = console.warn; console.warn = () => {};

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname.startsWith('/app')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return; }
  if (u.pathname.startsWith('/mod/')) {
    const f = path.join(MOD_DIR, path.basename(u.pathname));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(f)); return; }
  }
  if (u.pathname === '/api/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, build: null })); return; }
  if (u.pathname === '/api/portal') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', async () => {
      const { fn, args } = JSON.parse(b || '{}');
      asked.push([fn, args]);
      let out;
      try { out = REAL.has(fn) ? await portalApi(db, USER, fn, args || {}, NOWMS) : { rows: [] }; }
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
const BENIGN = /favicon|status of 404|ERR_FAILED|brand|status of 500|status of 403/;
const UI = { presentSeconds: 3600, refreshSeconds: 6000, hintIntervalSeconds: 3600, hintLifetimeSeconds: 5 };
const txt = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
const settle = ms => new Promise(r => setTimeout(r, ms));

async function open(world, user, go_ = true) {
  db = world; USER = user; asked.length = 0;
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 }, acceptDownloads: true });
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(8000);
  await page.goto(base + '/');
  await page.evaluate(m => { S.code = 'ADM'; start(m); }, { name: user.name, role: user.role, teams: user.teams, teamCount: null, tabs: user.tabs, can: { dashboard: true, upload: false, admin: user.tabs.includes('settings') }, ui: UI });
  await page.waitForTimeout(300);
  if (go_) {
    await page.evaluate(() => go('hopeai'));
    await page.waitForFunction(() => document.querySelector('#mainCard tbody tr[data-i], #view .note.bad'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  return page;
}
const listOf = pg => pg.evaluate(() => [...document.querySelectorAll('#mainCard tbody tr[data-i]')].map(tr => [...tr.children].map(c => (c.textContent || '').replace(/\s+/g, ' ').trim())));
const totalOf = pg => pg.evaluate(() => { const t = document.querySelector('#mainCard tbody tr.totrow'); return t ? [...t.children].map(c => (c.textContent || '').replace(/\s+/g, ' ').trim()) : null; });
const kpisOf = pg => pg.evaluate(() => [...document.querySelectorAll('#view .kpis .kpi')].map(k => [(k.querySelector('.l') || {}).textContent || '', ((k.querySelector('.v') || {}).textContent || '').replace(/\s+/g, ' ').trim()]));
const sheet = async dl => { const raw = fs.readFileSync(await dl.path()); return { name: dl.suggestedFilename(), text: raw.subarray(3).toString('utf8') }; };
const pick = async (pg, label, value) => { await pg.evaluate(([l, v]) => { const f = [...document.querySelectorAll('#view .fld')].find(x => (((x.querySelector('label') || {}).textContent) || '').indexOf(l) === 0); const s = f.querySelector('select'); s.value = v; s.onchange(); }, [label, value]); await pg.waitForTimeout(250); };

try {
// ---- the admin: the tab is there and opens on the last seven days
let page = await open(fakeDb(tables()), ADMIN, false);
check('1 the sidebar has Hope Ai for an admin, directly after the audit log', await page.evaluate(() => { const v = [...document.querySelectorAll('#nav button[data-v]')].map(b => b.getAttribute('data-v')); const i = v.indexOf('hopeai'); return i > 0 && v[i - 1] === 'audit' && /Hope Ai/.test(document.querySelector('#nav button[data-v="hopeai"]').textContent); }), 'no hopeai button right after audit');
await page.evaluate(() => go('hopeai'));
await page.waitForSelector('#mainCard tbody tr[data-i]');
await page.waitForTimeout(300);
check('1 the first open asks for the last seven days, today included', asked.some(a => a[0] === 'claudianChats' && a[1].from === add(TODAY, -6) && a[1].to === TODAY), JSON.stringify(asked.filter(a => a[0] === 'claudianChats')));
let rows = await listOf(page);
check('2 a row for each chat of the window: JUMA, ASHA today, ASHA, ZUBERI and MALICIOUS yesterday; the chat of ten days ago is not there', rows.length === 5 && !rows.some(r => r.some(c => /MZEE O|zamani/.test(c))), JSON.stringify(rows.map(r => r[3] || r[2])));
check('2 newest first: ASHA\'s phone chat of today is above JUMA\'s earlier one', rows.findIndex(r => r.some(c => c === 'ASHA M')) < rows.findIndex(r => r.some(c => c === 'JUMA G')), JSON.stringify(rows.map(r => r.slice(0, 5))));
const juma = rows.find(r => r.some(c => c === 'JUMA G'));
check('2 JUMA\'s row says role, teams, asked 3, AI 2, ready 1, tokens and BEHIND, and his first typed question', !!juma && juma.includes('MANAGER') && juma.includes('KONGOWE, MBAGALA') && juma.includes('3') && juma.some(c => /NYUMA \/ BEHIND/.test(c)) && juma.some(c => /Je, nifanye nini leo\?/.test(c)), JSON.stringify(juma));
const asha = rows.find(r => r.some(c => c === 'ASHA M') && r.some(c => /Maswali ya kawaida/.test(c)));
check('2 ASHA\'s chat of ready questions only names the question in Swahili and is marked CALLS', !!asha && asha.some(c => /Simu ya portfolio ni nini\?/.test(c)) && asha.includes('CALLS'), JSON.stringify(asha));
const fitAt = async w => { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250); return page.evaluate(() => {
  const sc = document.querySelector('#mainCard .scroll');
  const lines = text => { const out = []; document.querySelectorAll('#mainCard tbody tr[data-i] td').forEach(td => { if ((td.textContent || '').trim() === text) {
    /* the TEXT's own boxes (a chip's padding box is another, taller box with another top, and is not a second line) */
    const w = document.createTreeWalker(td, NodeFilter.SHOW_TEXT); let tops = new Set(), n; while ((n = w.nextNode())) { if (!n.nodeValue.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); [...r.getClientRects()].forEach(x => tops.add(Math.round(x.top))); }
    out.push(tops.size); } }); return out; };
  return { fit: !!sc && sc.classList.contains('fit') && sc.classList.contains('fitw'), noScroll: !!sc && sc.scrollWidth <= sc.clientWidth + 2, malicious: lines('MALICIOUS'), portal: lines('PORTAL'), tokens: lines('2600') };
}); };
for (const w of [1366, 1700]) {
  const f = await fitAt(w);
  check('2 at ' + w + ' px the whole list is in sight (the first question, the last column, needs no scroll to the right) and no short word is broken in two', f.fit && f.noScroll && f.malicious.every(n => n === 1) && f.portal.every(n => n === 1) && f.tokens.every(n => n === 1), JSON.stringify(f));
}
await page.setViewportSize({ width: 1700, height: 1100 }); await page.waitForTimeout(250);
const tot = await totalOf(page);
check('2 the list\'s total row names no place and no standing (the two chips are blank there) and adds the questions up', !!tot && tot.includes('JUMLA / TOTAL') && !tot.some(c => /PORTAL|CALLS|SAWA|NYUMA/.test(c)) && tot.includes('8'), JSON.stringify(tot));
let k = await kpisOf(page);
check('2 the counters: 5 chats, 4 people, 8 questions, 4 AI answers, 3 ready answers, 1 limit, 1 chat of a team behind', k.length === 7 && /^5\b/.test(k[0][1]) && /^4\b/.test(k[1][1]) && /^8\b/.test(k[2][1]) && /^4\b/.test(k[3][1]) && /^3\b/.test(k[4][1]) && /^1\b/.test(k[5][1]) && /^1\b/.test(k[6][1]), JSON.stringify(k));
if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'hopeai-list.png') }); }

// ---- the picks narrow everything from what has arrived: no second request
const before = asked.filter(a => a[0] === 'claudianChats').length;
await pick(page, 'Cheo', 'MANAGER');
rows = await listOf(page); k = await kpisOf(page);
check('3 the role pick narrows the list to JUMA, the counters to his chat, and says 1 of 5', rows.length === 1 && rows[0].includes('JUMA G') && /^1\b/.test(k[0][1]) && /\/\s*5/.test(k[0][1]) && /^3\b/.test(k[2][1]), JSON.stringify([rows.length, k[0], k[2]]));
const roleBoard = await page.evaluate(() => { const c = document.getElementById('haRole'); return c ? [...c.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(x => (x.textContent || '').replace(/\s+/g, ' ').trim())) : null; });
check('3 and the by-role board follows the pick: MANAGER and the total, nothing else', !!roleBoard && roleBoard.length === 2 && roleBoard[0][1] === 'MANAGER' && roleBoard[1][1] === 'JUMLA / TOTAL', JSON.stringify(roleBoard));
check('3 no second request was made for a pick', asked.filter(a => a[0] === 'claudianChats').length === before);
await pick(page, 'Cheo', '');
await pick(page, 'Timu', 'TEMEKE');
rows = await listOf(page);
check('3 the team pick: TEMEKE is ASHA\'s two chats', rows.length === 2 && rows.every(r => r.includes('ASHA M')), JSON.stringify(rows.map(r => r.slice(0, 4))));
await pick(page, 'Timu', '');
await pick(page, 'Nyuma?', 'yes');
rows = await listOf(page);
check('3 "teams behind" leaves JUMA only', rows.length === 1 && rows[0].includes('JUMA G'), JSON.stringify(rows.length));
await page.evaluate(() => haReset_()); await page.waitForTimeout(200);
// a search in the table's box repaints the whole screen: the picks and the row taps must survive it
await pick(page, 'Cheo', 'FIELD OFFICER');
await page.fill('#tblQ', 'ASHA'); await page.waitForTimeout(400);
check('3 after a search in the table\'s box the role pick is still on (a repaint keeps what was picked)', (await listOf(page)).length === 2);
await page.fill('#tblQ', ''); await page.waitForTimeout(300);
await page.evaluate(() => haReset_()); await page.waitForTimeout(200);

// ---- one chat in full
await page.evaluate(() => { const tr = [...document.querySelectorAll('#mainCard tbody tr[data-i]')].find(t => t.textContent.indexOf('JUMA G') >= 0); tr.click(); });
await page.waitForSelector('#drawer .card');
const d1 = await page.evaluate(() => { const d = document.getElementById('drawer'); return { text: (d.textContent || '').replace(/\s+/g, ' ').trim(), cards: d.querySelectorAll('.card').length }; });
check('4 the drawer opens JUMA\'s chat: who, where, three questions, in order', d1.cards === 3 && /JUMA G/.test(d1.text) && /MANAGER/.test(d1.text) && /KONGOWE, MBAGALA/.test(d1.text) && d1.text.indexOf('Je, nifanye nini leo?') < d1.text.indexOf('Reached % ni nini?') && d1.text.indexOf('Reached % ni nini?') < d1.text.indexOf('Nifanye nini ili kufikia malengo?'), d1.text.slice(0, 300));
check('4 an answer keeps its line break and a ready question says its answer is the catalogue\'s', /Piga simu za portfolio kwa wateja wote\./.test(d1.text) && /Jibu la kawaida kutoka kwenye orodha/.test(d1.text));
check('4 the times are East Africa\'s (05:50 UTC is 08:50)', /08:50/.test(d1.text) && /09:20/.test(d1.text), d1.text.slice(0, 400));
const dl = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#drawer .dxl')]).then(r => r[0]);
const x1 = await sheet(dl);
check('4 the drawer\'s Excel is the conversation: the questions, the answers and the tokens', /Hope-Ai-JUMA-G-/.test(x1.name) && /Je, nifanye nini leo\?/.test(x1.text) && /Piga simu za portfolio kwa wateja wote\./.test(x1.text) && />1500</.test(x1.text) && /jibu la kawaida/.test(x1.text), x1.name);
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'hopeai-chat.png') });
await page.evaluate(() => closeDrawer());
// a question with markup in it runs nothing
await page.evaluate(() => { const tr = [...document.querySelectorAll('#mainCard tbody tr[data-i]')].find(t => t.textContent.indexOf('MALICIOUS') >= 0); tr.click(); });
await page.waitForSelector('#drawer .card');
const x = await page.evaluate(() => ({ xss: window.__xss === undefined, imgs: document.querySelectorAll('#drawer img').length, scripts: document.querySelectorAll('#drawer script').length, text: (document.getElementById('drawer').textContent || '') }));
check('4 a question with markup in it is drawn as text and runs nothing', x.xss && x.imgs === 0 && x.scripts === 0 && /<img src=x onerror=/.test(x.text) && /<script>window\.__xss=2<\/script>jibu/.test(x.text), JSON.stringify(x).slice(0, 200));
await page.evaluate(() => closeDrawer());
const listText = await page.evaluate(() => document.getElementById('view').textContent);
check('4 and in the list too', (await page.evaluate(() => window.__xss === undefined)) && /naomba/.test(listText));

// ---- the boards add up to the list and have their own Excel
const boards = await page.evaluate(() => ['haRole', 'haTeam', 'haDay', 'haFaq'].map(id => { const c = document.getElementById(id); return c ? { id, rows: [...c.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(x => (x.textContent || '').replace(/\s+/g, ' ').trim())), head: [...c.querySelectorAll('thead th')].map(th => (th.textContent || '').replace(/\s+/g, ' ').trim()) } : { id, rows: null }; }));
check('5 four boards are under the list: by role, by team, by day, the ready questions tapped', boards.every(b => b.rows && b.rows.length >= 2), JSON.stringify(boards.map(b => [b.id, b.rows && b.rows.length])));
const dayBoard = boards.find(b => b.id === 'haDay');
check('5 by day: today 2 chats and 6 questions... newest first, then yesterday, and the total row', dayBoard.rows[0][1] === TODAY && dayBoard.rows[0][2] === '2' && dayBoard.rows[1][1] === Y && dayBoard.rows[1][2] === '3' && dayBoard.rows[dayBoard.rows.length - 1][1] === 'JUMLA / TOTAL' && dayBoard.rows[dayBoard.rows.length - 1][2] === '5', JSON.stringify(dayBoard.rows));
const faqBoard = boards.find(b => b.id === 'haFaq');
check('5 the ready questions tapped: the portfolio-call question twice (ASHA) above the other (JUMA), in both languages', faqBoard.rows[0][1] === 'Simu ya portfolio ni nini? / What is a portfolio call?' && faqBoard.rows[0][2] === '2' && faqBoard.rows[1][2] === '1', JSON.stringify(faqBoard.rows));
const teamBoard = boards.find(b => b.id === 'haTeam');
check('5 by team: a person with two teams is under each; "ALL" is its own line', teamBoard.rows.some(r => r[1] === 'KONGOWE') && teamBoard.rows.some(r => r[1] === 'MBAGALA') && teamBoard.rows.some(r => /^ALL/.test(r[1])), JSON.stringify(teamBoard.rows.map(r => r[1])));
const dl2 = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#haRole [data-xls]')]).then(r => r[0]);
const x2 = await sheet(dl2);
check('5 a board has its own Excel: the roles and their counts (a board\'s sheet has no total row; the screen has it)', /Kwa-cheo/.test(x2.name) && /MANAGER/.test(x2.text) && /FIELD OFFICER/.test(x2.text) && />4</.test(x2.text), x2.name + ' ' + x2.text.slice(0, 300));
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'hopeai-boards.png'), fullPage: true });

// ---- another window, another set of chats
await page.evaluate(([f, t]) => { S.args.from = f; S.args.to = t; render(); }, [add(TODAY, -12), add(TODAY, -9)]);
await page.waitForFunction(() => /MZEE O/.test(document.getElementById('view').textContent), null, { timeout: 8000 }).catch(() => {});
rows = await listOf(page);
check('6 a window that reaches ten days back reads the old chat and none of the others', rows.length === 1 && rows[0].includes('MZEE O'), JSON.stringify(rows.length));
await page.evaluate(([f, t]) => { S.args.from = f; S.args.to = t; render(); }, [add(TODAY, -40), add(TODAY, -35)]);
await page.waitForTimeout(700);
const emptyText = await page.evaluate(() => document.getElementById('view').textContent);
check('6 an empty window is an empty list, with no red error', (await listOf(page)).length === 0 && !(await page.evaluate(() => !!document.querySelector('#view .note.bad, #view .msg.bad'))), emptyText.slice(0, 120));
await page.close();

// ---- a code that does not hold the tab
page = await open(fakeDb(tables()), CLERK, false);
check('1 a code without the tab has no Hope Ai in its sidebar', await page.evaluate(() => !document.querySelector('#nav button[data-v="hopeai"]')));
const refused = await page.evaluate(async () => { try { await srv('claudianChats', {}); return 'answered'; } catch (e) { return String(e.message || e); } });
check('1 and the server refuses it the list', refused !== 'answered', refused);
await page.close();

// ---- before RUN-ME-090: the tab says so
page = await open(fakeDb(tables(), { missingTables: ['claudian_chats'] }), ADMIN);
const gone = await page.evaluate(() => ({ note: (document.querySelector('#view .note.bad') || {}).textContent || '', rows: document.querySelectorAll('#mainCard tbody tr[data-i]').length, boards: !!document.getElementById('haRole') }));
check('7 the red line names the file, there are no rows and no boards', /RUN-ME-090/.test(gone.note) && gone.rows === 0 && !gone.boards, JSON.stringify(gone).slice(0, 200));
await page.close();

// ---- 9. the report and the clear (handbook Part 162)
{
  NOWMS = Date.parse(TODAY + 'T23:59:30Z');                        // the end of today: a clear refuses a line ahead of the server's clock, and the seeded chats are at fixed times
  const world = fakeDb(tables());
  let pg = await open(world, ADMIN);
  const dead = () => pg.evaluate(() => { const c = document.getElementById('haClrBtn'); return c ? c.disabled : null; });
  check('9 the report card is there, and the clear button is dead before any export', (await pg.evaluate(() => /Ripoti kwa Claude/.test(document.getElementById('view').textContent))) && (await dead()) === true);
  const dlr = await Promise.all([pg.waitForEvent('download', { timeout: 15000 }), pg.click('#haExpBtn')]).then(r => r[0]);
  const raw = fs.readFileSync(await dlr.path(), 'utf8');
  check('9 the export saves one text file named for the day', dlr.suggestedFilename() === 'Hope-Ai-report-' + TODAY + '.txt', dlr.suggestedFilename());
  check('9 it holds EVERYTHING on file: the chat of ten days ago, which the window does not show, is in it', /MZEE O/.test(raw) && /Swali la zamani/.test(raw) && /JUMA G/.test(raw) && /ZUBERI K/.test(raw), raw.length + ' characters');
  check('9 it says how many: nine rows, six chats of five people (JUMA and ASHA two days, ZUBERI, MALICIOUS, MZEE)', /9 rows: 6 chats of 5 people, 6 typed questions, 3 taps? of ready questions|9 rows: 6 chats of 5 people/.test(raw) && /END OF REPORT: 6 chats, 9 rows/.test(raw), (raw.match(/Covers:[^\n]*/) || [''])[0].slice(0, 200));
  check('9 markup a person typed is in the file as plain text', raw.indexOf('<img src=x onerror="window.__xss=1">') >= 0 && !(await pg.evaluate(() => window.__xss)));
  check('9 the clear button woke up and the card says what was exported', (await dead()) === false && /Imepakuliwa: 9 hadi/.test(await pg.evaluate(() => document.getElementById('haExpNote').textContent)));
  check('9 pages were asked with the line the first one drew', asked.filter(a => a[0] === 'claudianChatsExport').length === 1 && asked.find(a => a[0] === 'claudianChatsExport')[1].upTo === '', JSON.stringify(asked.filter(a => a[0] === 'claudianChatsExport')));
  // a chat is written while the owner reads the card: the clear must leave it
  world._dump('claudian_chats').push(R(TODAY, '23:30:00', { user_key: 'k-late', user_name: 'LATE L', role: 'MANAGER', teams: 'ILALA', thread: 'k-late:' + TODAY, question: 'Imeandikwa baada ya ripoti', behind: false }));
  const dialogs = []; pg.removeAllListeners('dialog'); pg.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await pg.click('#haClrBtn');
  await pg.waitForFunction(() => document.querySelectorAll('#mainCard tbody tr[data-i]').length >= 0 && /Zimefutwa|rows cleared/.test((document.getElementById('toast') || document.body).textContent), null, { timeout: 8000 }).catch(() => {});
  await pg.waitForTimeout(600);
  const left = world._dump('claudian_chats');
  check('9 the clear asked first, in both languages, with the count', dialogs.length === 1 && /Futa mazungumzo 9 /.test(dialogs[0]) && /Delete the 9 rows/.test(dialogs[0]), JSON.stringify(dialogs).slice(0, 160));
  check('9 and deleted exactly the nine rows the report held; the chat written after it is still there', left.length === 1 && left[0].user_name === 'LATE L', JSON.stringify(left.map(r => r.user_name)));
  check('9 the clear button is dead again (the export is spent) and the note of the clear is on file', (await dead()) === true && world._dump('settings').some(r => r.key === 'CLAUDIAN_LAST_CLEAR'));
  check('9 the tab read the history again and shows only the chat that remains', JSON.stringify((await listOf(pg)).map(r => r[3])) === JSON.stringify(['LATE L']), JSON.stringify(await listOf(pg)));
  check('9 and says when the history was last cleared, by whom', /Historia ilifutwa mara ya mwisho/.test(await pg.evaluate(() => document.getElementById('haExpNote').textContent)) && /THE ADMIN/.test(await pg.evaluate(() => document.getElementById('haExpNote').textContent)));
  check('9 the server recorded the clear in the audit log', world._dump('audit_log').some(r => r.action === 'claudianChatsClear' && r.ok === true));
  if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, 'hopeai-report-card.png'), fullPage: true });
  await pg.close();

  // a role ticked for the tab: the export, no clear
  const HOLDER = { code: 'GM1', name: 'THE GM', role: 'GM', teams: null, tabs: ['dashboard', 'hopeai'] };
  const w2 = fakeDb(tables());
  pg = await open(w2, HOLDER);
  check('9 a role ticked for the tab has the export and no clear button', (await pg.evaluate(() => !!document.getElementById('haExpBtn') && !document.getElementById('haClrBtn'))));
  const refusedClear = await pg.evaluate(async () => { try { await srv('claudianChatsClear', { upTo: new Date().toISOString(), expected: 1 }); return 'answered'; } catch (e) { return String(e.message || e); } });
  check('9 and the server refuses it the clear anyway; nothing was deleted', refusedClear !== 'answered' && w2._dump('claudian_chats').length === 9, refusedClear);
  await pg.close();

  // before RUN-ME-090: no card at all
  pg = await open(fakeDb(tables(), { missingTables: ['claudian_chats'] }), ADMIN);
  check('9 before RUN-ME-090 there is no report card', await pg.evaluate(() => !document.getElementById('haExpBtn')));
  await pg.close();
  NOWMS = undefined;
}
} catch (e) { fail.push('the check stopped: ' + String((e && e.message) || e).split('\n')[0].slice(0, 240)); }

check('8 no page error in any world', errs.length === 0, errs.slice(0, 3).join(' | '));
await browser.close(); srv.close(); console.warn = warn;
for (const f of fail) console.log('FAIL  ' + f);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
