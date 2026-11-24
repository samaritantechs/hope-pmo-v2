/* LAST WEEK'S FIGURE BESIDE EVERY ARROW ON THE DASHBOARD: the REAL public/app.html in a real browser, talking to the REAL
   portalApi over the repository's own fake database.

     "infront of the arrow put the low opacity last week % e.g (arrow) 34% so that i notice if its higher low or the same what
      exactly was of last week ... those (arrows) at dashboard" -- the owner, 24 Nov 2026

   What it proves (handbook Part 142):

     1. every arrow on the dashboard (the five tiles of the performance strip, each day's tile of the six trend cards, and each
        card's title) is followed by last week's figure, and that figure is the one the SERVER answered (the page works nothing
        out): whole per cent, one decimal on the Expected Defaulters card, last week then this week for the applications that
        arrived;
     2. on a book built so that Monday has an arrow on every card, Monday's figures are the ones the book fixes
        (25%, 90%, 75%, 5 then 3, 20%, 15.0%): the check cannot pass on a dashboard with no arrows;
     3. the figure is FAINT (its opacity is under 1) and smaller than the figure of the tile it belongs to, and it comes AFTER
        the arrow;
     4. a tile with no arrow has no figure of last week; a card's title names the figure ("wiki iliyopita") and prints the
        difference in brackets;
     5. a book with no last week at all: no arrow and no faint figure on the strip nor on the collection, early collection,
        recovery and Expected Defaulters cards (nothing to compare with); the applications and sales cards, whose days wait on
        no upload, compare with a real nought ("0 then 3", "0%");
     6. a day that has not come yet carries no arrow on the applications and sales cards (it is not a fall), in both books;
     7. no page error.

   Lives OUTSIDE test/ on purpose (see call-warmstart.mjs): it needs a browser. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/portal-dashboard-lastweek.mjs

   CHROME overrides the browser path; APP_FILE runs it against another copy of the page; SHOTS=<dir> saves a picture of the
   dashboard. Exit code 0 = everything passed. The dates are worked out from today, so it runs on any day. */
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
const { SNAPSHOT_TOTALS_RPC, UPLOAD_STATUS_RPC, EXPDF_RECOVERY_RPC } = await import(path.join(ROOT, 'test/snapshot-totals-rpc.mjs'));
const { portalApi } = await import(path.join(ROOT, 'api/_lib/portal-core.js'));
const APP = fs.readFileSync(process.env.APP_FILE || path.join(ROOT, 'public/app.html'), 'utf8');

// ---- the calendar, on the Dar es Salaam clock the server counts by
const eat = ms => new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
const add = (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayOf = k => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const TODAY = eat(Date.now()), THIS = mondayOf(TODAY), LAST = add(THIS, -7);

/* THE BOOK. Everything sits on the two MONDAYS, so the check reads the same on any day of the week (this week's Monday is never
   in the future). One team; the weekly sales target is 1,000, so a day's is 200.
     collection        this Monday 600 of 1,000 (60%)        last Monday 250 of 1,000 (25%)      rises
     early collection  this Monday 800 of 1,000 (80%)        last Monday 900 of 1,000 (90%)      falls
     sales             this Monday 100 of 200 (50%)          last Monday 150 of 200 (75%)        falls
     applications      this Monday 3 arrived                 last Monday 5 arrived               falls
     recovery          this Monday 100 back of 400 out (25%) last Monday 150 back of 750 (20%)   rises
     expected def.     this Monday 100 back of 1,000 (10.0%) last Monday 150 of 1,000 (15.0%)    falls
   The decks' one customer was disbursed on a Monday, so Monday is their cycle day (Day 1) on the Expected Defaulters card. */
const E = (ref, exp, status, date, type = 'today') => ({ ref, full_name: 'C' + ref, contact: '07120000' + ref, team: 'KONGOWE', payment_expected: exp, arrears: 0,
  todays_status: status, due_summary: '2/6', nc: 0, snapshot_type: type, snapshot_date: date, upload_batch: 'b' + type + date, created_at: date + 'T04:00:00Z' });
const D = (ref, arrears, type, date) => ({ ref, full_name: 'C' + ref, contact: '07140000' + ref, team: 'KONGOWE', arrears, status: 'Defaulter',
  guarantor_name: 'G' + ref, guarantor_contact: '07150000' + ref, ds: '3-6', dc: 3, days_elapsed: 45, disb_date: add(LAST, -28),
  initial_inst: 100000, other_inst: 40000, balance: 500000, snapshot_type: type, weekday: 'MON', snapshot_date: date,
  upload_batch: 'b' + type + date, created_at: date + 'T04:00:00Z' });
const L = (id, stage, date, extra = {}) => ({ id, team: 'KONGOWE', stage, requested_amt: 100, upload_date: date, ...extra });
const weekOf = (mon, w) => ({
  loans: [...Array.from({ length: w.apps }, (_, i) => L('a' + mon + i, i < 2 ? 'unassigned' : 'rejected', mon)),
    { id: 's' + mon, team: 'KONGOWE', stage: 'approved', principal_amt: w.sale, approved_date: mon }],
  repayment_snapshots: [E('c1' + mon, w.col, 'PAID', mon), E('c2' + mon, 1000 - w.col, 'UNPAID', mon),
    E('e1' + mon, w.ecol, 'PAID', mon, 'initial'), E('e2' + mon, 1000 - w.ecol, 'UNPAID', mon, 'initial')],
  defaulter_snapshots: [D('R1', 1000, 'initial', mon), D('R1', 1000 - w.rec, 'current', mon)],
});
const THISW = weekOf(THIS, { apps: 3, sale: 100, col: 600, ecol: 800, rec: 100 });
const LASTW = weekOf(LAST, { apps: 5, sale: 150, col: 250, ecol: 900, rec: 150 });
const book = withLast => fakeDb({
  teams: [{ team: 'KONGOWE', team_code: 'C-K', zone: null, opm: null, recovery: null, gmo: null, manager: null, credit: null, expected: null, bike: null }],
  access_codes: [{ code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['dashboard'] }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }, { key: 'SALES_TARGET_WEEKLY', value: '1000' }],
  roles: [], audit_log: [], demand_notices: [], call_users: [], call_logs: [], followup_status: [], adjustments: [],
  loans: [...THISW.loans, ...(withLast ? LASTW.loans : [])],
  repayment_snapshots: [...THISW.repayment_snapshots, ...(withLast ? LASTW.repayment_snapshots : [])],
  defaulter_snapshots: [...THISW.defaulter_snapshots, ...(withLast ? LASTW.defaulter_snapshots : [])],
}, { rpc: { ...SNAPSHOT_TOTALS_RPC, ...UPLOAD_STATUS_RPC, ...EXPDF_RECOVERY_RPC } });
const WORLDS = { both: book(true), first: book(false) };
let db = WORLDS.both;
const USER = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['dashboard'] };
const REAL = new Set(['dashboardFull']);
const warn = console.warn; console.warn = () => {};

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
const UI = { presentSeconds: 3600, refreshSeconds: 6000, hintIntervalSeconds: 3600, hintLifetimeSeconds: 5 };
const ME = { name: 'THE ADMIN', role: 'ADMIN', teams: null, teamCount: null, tabs: ['dashboard'], can: { dashboard: true, upload: false, admin: true }, ui: UI };

async function open(world) {
  db = WORLDS[world];
  const page = await browser.newPage({ viewport: { width: 1500, height: 1400 } });
  page.on('pageerror', e => errs.push(world + ': ' + String(e)));
  page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push(world + ' console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  page.setDefaultTimeout(7000);
  await page.goto(base + '/');
  await page.evaluate(m => { S.code = 'ADM'; start(m); }, ME);
  await page.waitForTimeout(400);
  await page.evaluate(() => go('dashboard'));
  await page.waitForSelector('#gCol', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  return page;
}
/* What the screen shows: the strip's tiles, and each card's title and day tiles. For each: the arrow, the faint figure after it,
   whether the faint figure really comes after the arrow in the page, how faint it is and how large beside the tile's own figure. */
const read = page => page.evaluate(() => {
  const MARKS = /[\u25b2\u25bc\u25ac]/;
  const part = el => {
    if (!el) return null;
    const lw = el.querySelector('.lw'), arrow = [...el.querySelectorAll('span')].find(s => MARKS.test(s.textContent) && s.textContent.trim().length === 1);
    const cs = lw ? getComputedStyle(lw) : null;
    return { text: el.textContent.replace(/\s+/g, ' ').trim(), arrow: arrow ? arrow.textContent.trim() : '', lw: lw ? lw.textContent.trim() : '', lws: el.querySelectorAll('.lw').length,
      after: !!(lw && arrow && (arrow.compareDocumentPosition(lw) & Node.DOCUMENT_POSITION_FOLLOWING)),
      opacity: cs ? Number(cs.opacity) : null, size: cs ? parseFloat(cs.fontSize) : null, own: parseFloat(getComputedStyle(el).fontSize), title: lw ? lw.getAttribute('title') || '' : '' };
  };
  const strip = {};
  for (const k of document.querySelectorAll('.kpis.sm .kpi')) { const l = (k.querySelector('.l') || {}).textContent || ''; strip[l.trim()] = part(k.querySelector('.v')); }
  const cards = {};
  for (const id of ['gApps', 'gSales', 'gEcol', 'gCol', 'gRec', 'gEdr']) {
    const c = document.getElementById(id); if (!c) { cards[id] = null; continue; }
    const head = c.querySelector('.card-h');
    cards[id] = { title: part(head), tiles: [...c.querySelectorAll('.tgrid .tcell')].map(t => ({ ...part(t.querySelector('.th')), body: t.textContent.replace(/\s+/g, ' ').trim(), tot: /(^| )tot( |$)/.test(t.className),
      big: Math.max(...[...t.querySelectorAll('.tl')].map(x => parseFloat(getComputedStyle(x).fontSize))) })) };
  }
  return { strip, cards, lwAll: document.querySelectorAll('#view .lw').length, marksAll: (document.getElementById('view').textContent.match(/[\u25b2\u25bc\u25ac]/g) || []).length };
});
const pct = v => Math.round(Number(v)) + '%', pct1 = v => Number(v).toFixed(1) + '%', num = v => Number(v).toLocaleString('en-US');
const markOf = dv => dv == null ? '' : dv > 0 ? '\u25b2' : dv < 0 ? '\u25bc' : '\u25ac';
const THEN = '\u2192';

let page;
try {
// --- 1 to 4. a book with a last week
page = await open('both');
const d = await portalApi(WORLDS.both, USER, 'dashboardFull', {});
const s = await read(page);
if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, 'dashboard-lastweek.png'), fullPage: true }); }
const P = d.perf;
// the strip
for (const [label, dv, lw] of [['Sales %', P.dSales, P.lwSales], ['Early Collection %', P.dEcol, P.lwEcol], ['Collection %', P.dCol, P.lwCol], ['Recovery %', P.dRec, P.lwRec], ['Performance \u00b7 wastani', P.dAvg, P.lwAvg]]) {
  const t = s.strip[label];
  check('1 the strip, ' + label + ': the arrow, then last week\'s figure as the server answered it', !!t && dv != null && t.arrow === markOf(dv) && t.lw === pct(lw) && t.after && t.lws === 1, JSON.stringify([t, dv, lw]));
  if (t) check('3 the strip, ' + label + ': faint, and smaller than the tile\'s own figure', t.opacity > 0.3 && t.opacity < 0.8 && t.size < t.own && /last week/.test(t.title), JSON.stringify([t.opacity, t.size, t.own, t.title]));
}
// the cards: each day's tile, and the title
const CARDS = [
  ['gApps', 'appsTrend', x => x.dApps, x => num(x.lwApps) + THEN + num(x.arrived), P.dApps, num(P.appsPrevCount), '5' + THEN + '3', ' maombi'],
  ['gSales', 'salesTrend', x => x.dSales, x => pct(x.lwSales), P.dSales, pct(P.lwSales), '75%', '%'],
  ['gEcol', 'ecolTrend', x => x.dEcol, x => pct(x.lwEcol), P.dEcol, pct(P.lwEcol), '90%', '%'],
  ['gCol', 'colTrend', x => x.dCol, x => pct(x.lwCol), P.dCol, pct(P.lwCol), '25%', '%'],
  ['gRec', 'recTrend', x => x.dRec, x => pct(x.lwRec), P.dRec, pct(P.lwRec), '20%', '%'],
  ['gEdr', 'edrTrend', x => x.dEdr, x => pct1(x.lwEdr), (d.edrTrendTotal || {}).dEdr, pct1((d.edrTrendTotal || {}).lwEdr), '15.0%', '%'],
];
/* The screen against the server's own answer, tile by tile: a day with a difference shows its arrow and then last week's figure;
   a day with none shows neither. */
const daysMatch = (screen, answer, id, key, dOf, lwOf) => {
  const days = ((screen.cards[id] || {}).tiles || []).filter(t => !t.tot);
  let bad = days.length === answer[key].length ? '' : 'tiles ' + days.length + ' against ' + answer[key].length;
  answer[key].forEach((x, i) => {
    const t = days[i] || {}, dv = dOf(x);
    const want = dv == null ? ['', ''] : [markOf(dv), lwOf(x)];
    if (t.arrow !== want[0] || t.lw !== want[1] || (dv != null && !t.after) || t.lws !== (dv == null ? 0 : 1)) bad = bad || JSON.stringify([x.weekday, t.text, want]);
  });
  return bad;
};
/* 6. A day that has not come yet. Which days those are depends on the day the check is run (none on a Sunday), so the point is
   made only when there is one; test/portal.test.mjs proves it on a fixed Friday. */
const toCome = (screen, answer, label) => {
  for (const [id, key] of [['gApps', 'appsTrend'], ['gSales', 'salesTrend']]) {
    const days = ((screen.cards[id] || {}).tiles || []).filter(t => !t.tot);
    const later = answer[key].map((x, i) => [x, days[i] || {}]).filter(([x]) => x.date > TODAY);
    if (later.length) check('6 ' + label + ', ' + id + ': the ' + later.length + ' day(s) still to come carry no arrow and no figure of last week', later.every(([, t]) => !t.arrow && t.lws === 0), JSON.stringify(later.map(([x, t]) => [x.weekday, t.text])));
    const come = answer[key].map((x, i) => [x, days[i] || {}]).filter(([x]) => x.date <= TODAY);
    check('6 ' + label + ', ' + id + ': every day that has come carries its arrow', come.length >= 1 && come.every(([, t]) => !!t.arrow && t.lws === 1), JSON.stringify(come.map(([x, t]) => [x.weekday, t.text])));
  }
};
for (const [id, key, dOf, lwOf, wd, wlw, monday, unit] of CARDS) {
  const c = s.cards[id];
  if (!c) { check('1 the card ' + id + ' is on the dashboard', false); continue; }
  const days = c.tiles.filter(t => !t.tot);
  const bad = daysMatch(s, d, id, key, dOf, lwOf);
  check('1 ' + id + ': every day\'s arrow is followed by last week\'s figure, and a day with no arrow has none', !bad, bad);
  const mon = days[0] || {};
  check('2 ' + id + ': Monday reads the figure the book fixes (' + monday.replace(THEN, ' then ') + ')', mon.lw === monday && !!mon.arrow, JSON.stringify(mon));
  check('3 ' + id + ': the day\'s figure of last week is faint and no larger than the tile\'s own figures', mon.opacity > 0.3 && mon.opacity < 0.8 && mon.size <= mon.big, JSON.stringify([mon.opacity, mon.size, mon.big]));
  check('1 ' + id + ': the title\'s arrow is the week\'s, followed by last week\'s figure', wd != null && c.title.arrow === markOf(wd) && c.title.lw === wlw && c.title.after, JSON.stringify([c.title, wd, wlw]));
  const diff = (wd > 0 ? '+' : '') + (id === 'gEdr' ? Number(wd).toFixed(1) : Math.round(wd)) + unit;
  check('4 ' + id + ': the title names the figure and prints the difference in brackets', c.title.text.includes('wiki iliyopita (' + diff + ')'), c.title.text.slice(0, 160));
  const tot = c.tiles.find(t => t.tot);
  check('4 ' + id + ': the TOTAL tile carries no arrow and no figure of last week', !!tot && !tot.arrow && tot.lws === 0, JSON.stringify(tot));
}
check('1 there are as many figures of last week on the screen as there are arrows', s.lwAll === s.marksAll && s.lwAll >= 5 + 6 + 6, JSON.stringify([s.lwAll, s.marksAll]));
toCome(s, d, 'a book with a last week');
await page.close();

// --- 5. a book with no last week at all
page = await open('first');
const f = await read(page), d1 = await portalApi(WORLDS.first, USER, 'dashboardFull', {});
check('5 no last week: no arrow and no faint figure on any tile of the strip', Object.values(f.strip).length === 5 && Object.values(f.strip).every(t => t && !t.arrow && t.lws === 0), JSON.stringify(Object.values(f.strip).map(t => t && t.text)));
for (const id of ['gEcol', 'gCol', 'gRec', 'gEdr']) {
  const c = f.cards[id];
  check('5 no last week, ' + id + ': no arrow and no faint figure, on a day or on the title', !!c && !c.title.arrow && c.title.lws === 0 && c.tiles.every(t => !t.arrow && t.lws === 0), JSON.stringify(c && [c.title.text.slice(0, 60), c.tiles.map(t => t.text)]));
}
for (const [id, key, dOf, lwOf, , , , ] of CARDS.slice(0, 2)) {
  const bad = daysMatch(f, d1, id, key, dOf, lwOf);
  check('5 no last week, ' + id + ': the days still read as the server answered', !bad, bad);
}
check('5 no last week: Monday\'s applications compare with a real nought (0 then 3)', ((f.cards.gApps.tiles[0] || {}).lw) === '0' + THEN + '3', JSON.stringify(f.cards.gApps.tiles[0]));
check('5 no last week: and Monday\'s sales with 0%', ((f.cards.gSales.tiles[0] || {}).lw) === '0%', JSON.stringify(f.cards.gSales.tiles[0]));
check('5 no last week: as many faint figures as arrows', f.lwAll === f.marksAll, JSON.stringify([f.lwAll, f.marksAll]));
check('5 no last week: the tiles still show this week (Monday\'s collection is 60%)', !!f.cards.gCol && /Col 60%/.test((f.cards.gCol.tiles[0] || {}).body || ''), JSON.stringify(f.cards.gCol && f.cards.gCol.tiles[0]));
toCome(f, d1, 'a book with no last week');
await page.close();
} catch (e) { fail.push('the check stopped: ' + String((e && e.message) || e).split('\n')[0].slice(0, 240)); }

check('7 no page error in any world', !errs.length, errs.slice(0, 3).join(' | '));
await browser.close(); srv.close(); console.warn = warn;
for (const x of fail) console.log('FAIL  ' + x);
console.log(`${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
