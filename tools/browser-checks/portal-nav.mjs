/* Drives the REAL public/app.html in a real browser, against a stub /api/portal, to prove the
   no-reload navigation works before it goes anywhere near the live system. A concurrency change
   shipped on reasoning alone once took this system down in the field; UI behaviour like "does
   the page stay put" cannot be checked any other way than by looking at a page.

   Lives OUTSIDE test/ on purpose: `node --test` sweeps that whole directory, so a check that
   needs a browser installed would have made `npm test` fail on any machine without one -- and
   npm test guards the deploy. playwright-core is likewise not in package.json. To run it:

       npm i --no-save playwright-core
       CHROME=/path/to/chrome node tools/browser-checks/portal-nav.mjs

   CHROME defaults to the Playwright chromium in this container. Exit code 0 = everything
   passed. Any timing check reads the screen in the SAME evaluate() as the click that causes
   it: over localhost the stub answers in under a millisecond, so a second round trip can miss
   the spinner entirely and fail a test that is actually fine. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const APP = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
const calls = [];               // every request the page makes, in order
let lastPurge = null;           // what the Clean button actually asked for
let srvCalls = 0;               // how many times the page went back to the server
let ANN = { on: false, ts: 0 }; // what the noticeboard currently says
let lastSearch = null;          // what the search box actually asked for

const teamRows = [
  { team: 'KONGOWE', ref: 'R1', full_name: 'AMINA JUMA', contact: '0712000001', payment_expected: 1000, todays_status: 'UNPAID', arrears: 0 },
  { team: 'MBAGALA', ref: 'R2', full_name: 'PILI SALUM', contact: '0714000001', payment_expected: 2000, todays_status: 'PAID', arrears: 0 },
];

function answer(fn, args) {
  srvCalls++;
  if (fn === 'expectedDay') return {
    ok: true, weekday: 'MON', todayWeekday: 'MON', date: '2026-08-01', weekdays: ['MON', 'TUE'],
    teams: ['KONGOWE', 'MBAGALA'], byStatus: [{ status: 'UNPAID', count: 1 }, { status: 'PAID', count: 1 }],
    totals: { expected: 3000, collected: 2000, uncollected: 1000, pct: 0.66, installments: 2, paid: 1, unpaid: 1, underpaid: 0 },
    rows: teamRows,
  };
  if (fn === 'par') return { ok: true, rows: [], totals: {}, teams: [] };
  if (fn === 'followup') return { ok: true, count: 4, arrears: 2300, recovered: 250,
    months: ['2026-07', '2026-06'],
    rows: [
      { ref: 'R1', full_name: 'AMINA JUMA', team: 'KONGOWE', contact: '0712000001',
        new_no: '0766333444', guarantor_name: 'MAMA ASHA', guarantor_contact: '0715000555',
        arrears: 600, rejesho: 100, recovered: 100, status: 'Defaulter', fu_status: 'ANALIPA LEO',
        promise_date: '2026-08-03', ds: '3-6', dc: 4, disb_date: '2026-06-01',
        last_trans: '2026-07-20', last_trans_month: '2026-07',
        last_comment: 'ameahidi kulipa ijumaa', comment_by: 'JUMA G', comment_at: '2026-07-30T08:00:00Z' },
      { ref: 'R2', full_name: 'PILI SALUM', team: 'KONGOWE', contact: '0714000001',
        new_no: null, guarantor_name: 'BABA PILI', guarantor_contact: '0715000777',
        arrears: 900, rejesho: 200, recovered: 150, status: 'Defaulter', fu_status: 'AMETOA AHADI',
        ds: '1-2', dc: 2, disb_date: '2026-05-01', last_trans: '2026-06-10',
        last_trans_month: '2026-06', last_comment: 'hana ushirikiano' },
      { ref: 'R3', full_name: 'JUMA HAJI', team: 'KONGOWE', contact: '0714000002',
        new_no: null, guarantor_name: 'MAMA JUMA', guarantor_contact: '0715000888',
        arrears: 300, rejesho: 50, recovered: 0, status: 'Defaulter', fu_status: 'HAPATIKANI YEYE & MDHAMINI',
        ds: '3-6', dc: 6, disb_date: '2026-04-01', last_trans: '2026-07-01',
        last_trans_month: '2026-07', last_comment: '' },
      /* A fourth customer on ANOTHER team, so filtering has something to remove and the grand
         total has something to change by. Without it the filter emptied the table and a total
         of "nothing" proved nothing. */
      { ref: 'R4', full_name: 'ZAWADI OMARI', team: 'MBAGALA', contact: '0714000003',
        new_no: null, guarantor_name: 'MAMA ZAWADI', guarantor_contact: '0715000999',
        // One of the statuses already in the column, so the fixture adds a ROW to sort and
        // filter with, not a fourth value that would change what the sort checks are about.
        arrears: 500, rejesho: 100, recovered: 0, status: 'Defaulter', fu_status: 'HAPATIKANI YEYE & MDHAMINI',
        ds: '1-2', dc: 1, disb_date: '2026-06-01', last_trans: '2026-07-05',
        last_trans_month: '2026-07', last_comment: '' },
    ] };
  /* Enough of a shape for the PRESENTATION to build every slide. The deck reads d.cards,
     d.teamPerf, d.colTrend and d.weekday; the boards supply the rest. */
  if (fn === 'dashboardFull') return { ok: true, kpis: {}, teams: [], weekdays: [], pipeline: {}, totals: {},
    weekday: 'WED', weekOf: '2026-07-20',
    cards: { curArrears: 100, recovered: 20, defaulters: 3, salesWeek: 500, uncollectedToday: 80, abnormal: 1 },
    teamPerf: [{ team: 'KONGOWE', recovery: 'JUMA G', curArrears: 100, recovered: 20, collPctToday: 90, defaulters: 3 }],
    colTrend: [{ weekday: 'MON', expected: 100, collected: 90, uncollected: 10, pct: 90 }] };
  if (fn === 'officerBoards') return { ok: true, boards: [],
    weekday: 'WED', weekOf: '2026-07-20', deckWarning: null,
    pmo: [{ sn: 1, officer: 'KAMARIA', teams: 35, uncollected: 400, pct: 91, weekUncollected: 900, weekPct: 93 },
          { sn: 2, officer: 'CATHERINE', teams: 34, uncollected: 700, pct: 86, weekUncollected: 1500, weekPct: 88 }],
    earlyToday: [{ sn: 1, officer: 'EARLY E', team: 'KONGOWE', teams: 2, uncollected: 400, paidOver: 9, pct: 91 }],
    earlyWeek: [{ sn: 1, officer: 'EARLY E', team: 'KONGOWE', teams: 2, uncollected: 900, paidOver: 40, pct: 93 }],
    recToday: [{ officer: 'JUMA G', team: 'KONGOWE', initial: 500, current: 300, uncollected: 400, recovered: 200, pct: 50 }],
    recWeek: [{ officer: 'JUMA G', team: 'KONGOWE', initial: 500, current: 300, uncollected: 900, debtCrisis: 0, recovered: 200, pct: 22 }],
    csWeek: [{ agent: 'NEEMA CS', id: 'CS1', unassigned: 3, assigned: 1, brought: 4, amount: 900 }],
    callWeek: [{ agent: 'BUSY B', team: 'KONGOWE', calls: 90, duration: 3000, portfolio: 70, connectPct: 80 },
               { agent: 'MID M', team: 'KONGOWE', calls: 10, duration: 300, portfolio: 5, connectPct: 50 },
               { agent: 'SILENT S', team: 'KONGOWE', calls: 0, duration: 0, portfolio: 0, connectPct: null }],
    callWeekWorst: [{ agent: 'SILENT S', team: 'KONGOWE', calls: 0, duration: 0, portfolio: 0, connectPct: null },
                    { agent: 'MID M', team: 'KONGOWE', calls: 10, duration: 300, portfolio: 5, connectPct: 50 },
                    { agent: 'BUSY B', team: 'KONGOWE', calls: 90, duration: 3000, portfolio: 70, connectPct: 80 }],
    creditWeek: [{ analyst: 'ANALYST A', apps: 2, amount: 400, salesPct: 40, perf: 45 }],
    fuStatus: [{ status: 'AMETOA AHADI', customers: 4, pct: 40, arrears: 800 }] };
  if (fn === 'settingSet') return { ok: true };
  if (fn === 'notifications') return { ok: true, unseen: 2, seenAt: '',
    items: [
      { kind:'complaint', id:'cp1', ref:'111', team:'KONGOWE', who:'AMINA', by:'DESK',
        what:'hakupewa risiti', at:'2026-08-02T09:00:00Z', unseen:true },
      { kind:'comment', id:'ff1', ref:'555', team:'KONGOWE', who:'C555', by:'JUMA G',
        what:'ataleta kesho', at:'2026-08-02T08:00:00Z', unseen:true },
      { kind:'comment', id:'ff2', ref:'222', team:'KONGOWE', who:'C222', by:'JUMA G',
        what:'amelipa', at:'2026-08-01T08:00:00Z', unseen:false } ] };
  if (fn === 'notifSeen') return { ok: true, seenAt: '2026-08-02T10:00:00Z' };
  if (fn === 'customerSearch') {
    lastSearch = args.q;
    if (String(args.q || '').length < 3) return { ok: true, q: args.q, tooShort: true, books: [], total: 0 };
    if (/nobody/i.test(args.q)) return { ok: true, q: args.q, tooShort: false, books: [], total: 0 };
    return { ok: true, q: args.q, tooShort: false, total: 3, capped: false, books: [
      { key:'defaulters', label:'Defaulters', failed:false,
        rows:[{ ref:'555', full_name:'AMINA JUMA', team:'KONGOWE', arrears:600, status:'Defaulter' }] },
      { key:'payments', label:'Received payments', failed:false,
        rows:[{ ref_no:'555', customer_name:'AMINA JUMA', team:'KONGOWE', amount_paid:200, paid_at:'2026-08-01' }] },
      { key:'notices', label:'Demand notices', failed:true, rows:[] } ] };
  }
  if (fn === 'restructureContract') return { ok: true, row: { id: 's1', ref: '555' },
    schedule: [{ n: 1, date: '2026-08-10', amount: 200 }],
    html: '<!DOCTYPE html><html><head><title>Mkataba</title></head><body>'
      + '<h1>Mkataba wa Marekebisho ya Marejesho</h1><p>Sahihi ya mteja</p>'
      + '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></body></html>' };
  if (fn === 'settings') return { ok: true, rows: [] };
  if (fn === 'accessCodes') return { ok: true, rows: [], count: 0, roles: [] };
  if (fn === 'officerAccounts') return { ok: true, rows: [], count: 0 };
  if (fn === 'storageUsage') return { ok: true, sources: [], dates: [], totalRows: 0, bytes: 0,
    perDay: 0, perMonth: 0, days: 1, oldest: '2026-07-01', newest: '2026-08-01' };
  if (fn === 'purgeSnapshots') {
    lastPurge = args;
    const per = {}; (args.types || []).forEach(t => { per[t] = 2; });
    return { ok: true, date: args.date, through: !!args.through, dryRun: !!args.dryRun,
             deleted: per, total: (args.types || []).length * 2, protectedRows: 3 };
  }
  return { ok: true, rows: [], totals: {}, teams: [] };
}

const srv = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/app')) {
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(APP); return;
  }
  if (req.url === '/api/call') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => {
      const { fn } = JSON.parse(b || '{}');
      calls.push(fn);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fn === 'api_announcement' ? ANN : { ok: true }));
    });
    return;
  }
  if (req.url === '/api/portal') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => {
      const { fn, args } = JSON.parse(b || '{}');
      calls.push(fn);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(answer(fn, args || {})));
    });
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
// the stub server has no favicon or logo, and test 6 aborts requests on purpose
const BENIGN = /favicon|status of 404|ERR_FAILED/;
page.on('console', m => { if (m.type() === 'error' && !BENIGN.test(m.text())) errs.push('console: ' + m.text()); });
await page.goto(base + '/');

// Get past sign-in by driving the page's own state, the way start() does.
await page.evaluate(() => { S.code = 'X'; start({ name: 'TESTER', role: 'ADMIN', teams: null, teamCount: 0, tabs: null,
  // The cadences an admin can now set, delivered with sign-in.
  ui: { presentSeconds: 30, refreshSeconds: 20, hintIntervalSeconds: 600, hintLifetimeSeconds: 12 } }); });
await page.waitForTimeout(400);

const ok = [];
const fail = [];
const check = (name, cond, extra) => (cond ? ok : fail).push(name + (extra ? ' -- ' + extra : ''));

// --- 1. first visit to a tab asks the server and shows rows
calls.length = 0;
await page.evaluate(() => go('expected'));
await page.waitForTimeout(400);
let n1 = calls.filter(c => c === 'expectedDay').length;
let rows1 = await page.evaluate(() => document.querySelectorAll('#view table tbody tr:not(.totrow)').length);
check('first visit fetches once and draws rows', n1 === 1 && rows1 === 2, 'fetches=' + n1 + ' rows=' + rows1);

// --- 2. go away and come straight back: the table must be there with NO blank spinner
await page.evaluate(() => go('par'));
await page.waitForTimeout(300);
calls.length = 0;
// read the screen in the SAME round trip as the click -- on localhost the quiet refresh can
// finish before a second evaluate() lands, which is a harness artefact, not the real thing
const instant = await page.evaluate(() => {
  go('expected');
  return {
    rows: document.querySelectorAll('#view table tbody tr:not(.totrow)').length,
    spinner: !!document.querySelector('#view .sk'),
    busy: !!document.querySelector('#busy.on'),
  };
});
check('returning to a tab is instant, no blank screen',
  instant.rows === 2 && !instant.spinner, JSON.stringify(instant));
check('a hairline shows while it refreshes behind you', instant.busy, JSON.stringify(instant));
await page.waitForTimeout(400);
check('and it still checks the server quietly', calls.filter(c => c === 'expectedDay').length === 1,
  'quiet fetches=' + calls.filter(c => c === 'expectedDay').length);
const after = await page.evaluate(() => document.querySelectorAll('#view table tbody tr:not(.totrow)').length);
check('rows survive the quiet refresh', after === 2, 'rows=' + after);

// --- 3. the reload button must always go to the server AND blank for a fresh load
calls.length = 0;
// read the blank state in the SAME round trip -- on localhost the stub can answer and repaint
// before a second evaluate() even lands, which makes the check flaky rather than wrong
const dur = await page.evaluate(() => { document.getElementById('refBtn').click(); return !!document.querySelector('#view .sk'); });
await page.waitForTimeout(400);
check('reload button ignores what we remembered', calls.filter(c => c === 'expectedDay').length === 1 && dur,
  'fetches=' + calls.filter(c => c === 'expectedDay').length + ' blanked=' + dur);

// --- 4. a WRITE throws the remembered screens away
await page.evaluate(() => srv('settingSet', { key: 'X', value: '1' }));
await page.waitForTimeout(200);
const emptied = await page.evaluate(() => Object.keys(VC.store).length);
check('saving anything clears every remembered screen', emptied === 0, 'left=' + emptied);
calls.length = 0;
const blanked = await page.evaluate(() => { go('expected'); return !!document.querySelector('#view .sk'); });
await page.waitForTimeout(400);
check('so the next visit really re-asks', calls.filter(c => c === 'expectedDay').length === 1 && blanked,
  'fetches=' + calls.filter(c => c === 'expectedDay').length);

// --- 5. a filter narrows without any trip to the server, and the choice comes back with the tab
calls.length = 0;
await page.evaluate(() => {
  const sel = document.querySelector('[data-filter="team"]');
  sel.value = 'KONGOWE'; sel.onchange();
});
const filtered = await page.evaluate(() => document.querySelectorAll('#view table tbody tr:not(.totrow)').length);
check('filtering costs no network call', calls.length === 0 && filtered === 1,
  'calls=' + calls.length + ' rows=' + filtered);
await page.evaluate(() => go('par'));
await page.waitForTimeout(300);
await page.evaluate(() => go('expected'));
const back = await page.evaluate(() => ({
  rows: document.querySelectorAll('#view table tbody tr:not(.totrow)').length,
  box: (document.querySelector('[data-filter="team"]') || {}).value,
}));
check('the box and the rows agree when you come back',
  back.rows === 1 && back.box === 'KONGOWE', JSON.stringify(back));
await page.waitForTimeout(400);

// --- 6. a failed quiet refresh must NOT wipe a page someone is reading
await page.evaluate(() => go('par'));
await page.waitForTimeout(300);
await page.evaluate(() => go('expected'));
await page.waitForTimeout(400);
await page.route('**/api/portal', r => r.abort());
calls.length = 0;
await page.evaluate(() => go('par'));
await page.waitForTimeout(200);
await page.evaluate(() => go('expected'));
await page.waitForTimeout(600);
const survived = await page.evaluate(() => ({
  rows: document.querySelectorAll('#view table tbody tr:not(.totrow)').length,
  err: !!document.querySelector('#view .msg.bad'),
  busy: !!document.querySelector('#busy.on'),
}));
check('a dropped connection does not take your page away',
  survived.rows >= 1 && !survived.err && !survived.busy, JSON.stringify(survived));
await page.unroute('**/api/portal');

// --- 7. CLEANING REPORTS. The list used to stop at five, and ticking ten boxes one at a time
//        is its own reason not to bother, so there is a Select all.
await page.evaluate(() => { VC.store = {}; go('settings'); });
await page.waitForTimeout(600);
const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('.clType')).map(c => c.value));
check('every report that grows can be cleaned, not just five', boxes.length === 11, boxes.join(','));
for (const k of ['expected','defaulters','received','abnormal','calls','loans','comments','complaints','restructures','demand_notices','followup'])
  check('  ...including ' + k, boxes.includes(k));
// The follow-up list is the one line here that takes a customer's whole comment history with
// it, and a cascade nobody was warned about is the worst kind of surprise in this system.
check('and the one that takes comments with it says so on the box',
  await page.evaluate(() => {
    const l = Array.from(document.querySelectorAll('.clType')).find(c => c.value === 'followup');
    return l && /removes their comments too/.test(l.parentElement.textContent);
  }));
check('the four people also type into say so on the box itself',
  await page.evaluate(() => {
    const lbls = Array.from(document.querySelectorAll('.clType')).map(c => c.parentElement.textContent);
    return lbls.filter(t => /uploaded only/.test(t)).length === 4;
  }));

await page.evaluate(() => document.getElementById('clAll').click());
check('Select all ticks every one',
  await page.evaluate(() => Array.from(document.querySelectorAll('.clType')).every(c => c.checked)));
await page.evaluate(() => document.getElementById('clNone').click());
check('Clear unticks every one',
  await page.evaluate(() => Array.from(document.querySelectorAll('.clType')).every(c => !c.checked)));

// Check first must be a DRY RUN -- nothing may be deleted by pressing it.
lastPurge = null;
await page.evaluate(() => { document.getElementById('clAll').click(); document.getElementById('clCheck').click(); });
await page.waitForTimeout(400);
check('"Check first" asks for a dry run, and for every type',
  lastPurge && lastPurge.dryRun === true && (lastPurge.types || []).length === 11, JSON.stringify(lastPurge));
const dryOut = await page.evaluate(() => document.getElementById('clOut').textContent);
check('and it says how many typed rows are being left alone',
  /3/.test(dryOut) && /left alone|imeachwa/.test(dryOut), dryOut.slice(0, 120));

// --- 8. THE TAB RECOVERY OFFICERS LIVE IN. It was showing twelve columns while the server
//        was already sending the guarantor, the dates and the last comment.
await page.evaluate(() => { VC.store = {}; go('followup'); });
await page.waitForTimeout(600);
const heads = await page.evaluate(() => Array.from(document.querySelectorAll('#mainCard thead th')).map(t => t.textContent.trim()));
for (const want of ['Guarantor', 'G. Contact', 'New no', 'Disb date', 'Last trans', 'D.C', 'Recovered', 'Last comment'])
  check('followup shows ' + want, heads.includes(want), heads.join(' | '));
check('and it still shows Follow-up status, which was never actually missing',
  heads.includes('Follow-up'), heads.join(' | '));

// The guarantor's number has to be tappable -- that is the whole reason it is on the screen.
check('the guarantor number is dialable',
  await page.evaluate(() => !!document.querySelector('#mainCard a.tel[href="tel:0715000555"]')));

// Searching a guarantor's name must find the customer's row, which is what an officer does
// when the guarantor rings THEM back.
await page.evaluate(() => { document.getElementById('q').value = 'MAMA ASHA';
  document.getElementById('q').dispatchEvent(new Event('input')); });
await page.waitForTimeout(200);
check('searching a guarantor name finds their customer',
  await page.evaluate(() => document.querySelectorAll('#mainCard tbody tr:not(.totrow)').length === 1
    && /AMINA JUMA/.test(document.querySelector('#mainCard tbody tr:not(.totrow)').textContent)));
await page.evaluate(() => { document.getElementById('q').value = '';
  document.getElementById('q').dispatchEvent(new Event('input')); });
await page.waitForTimeout(200);

// The month filter, off the last transaction.
await page.evaluate(() => { const s = document.querySelector('[data-filter="last_trans_month"]');
  s.value = '2026-06'; s.onchange(); });
await page.waitForTimeout(200);
check('the month filter narrows to that month only',
  await page.evaluate(() => document.querySelectorAll('#mainCard tbody tr:not(.totrow)').length === 1));
await page.evaluate(() => { const s = document.querySelector('[data-filter="last_trans_month"]');
  s.value = ''; s.onchange(); });
await page.waitForTimeout(200);

// Columns are looked up BY NAME, never by position -- adding an S/N column ahead of them
// would otherwise silently move every index and make these checks lie.
// The active sort column's heading gains an arrow, so match on the start of the label rather
// than the whole of it -- otherwise these checks stop finding a column the moment it is sorted.
const colIdx = async (name) => page.evaluate((n) =>
  Array.from(document.querySelectorAll('#mainCard thead th'))
    .findIndex(t => t.textContent.trim().replace(/[^\w. &-]+$/, '').trim() === n), name);
const colValues = async (name) => {
  const i = await colIdx(name);
  return page.evaluate((k) => Array.from(document.querySelectorAll('#mainCard tbody tr:not(.totrow)'))
    .map(r => (((r.children[k] || {}).textContent) || '').trim()), i);
};

// TWO-LEVEL SORT: by follow-up status, then by arrears descending inside it. R1 and R3 share
// no status here, so the second level is proven by adding a tie: both AMETOA AHADI rows must
// come back biggest-arrears-first.
await page.evaluate(() => { S.rows[2].fu_status = 'AMETOA AHADI'; paint(); });
await page.evaluate(() => {
  const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.onchange.call(e); };
  set('sortA', 'fu_status'); set('sortB', 'arrears'); set('sortBd', '0');
});
await page.waitForTimeout(150);
const st = await colValues('Follow-up'), ar = await colValues('Arrears');
check('the first sort level groups by follow-up status',
  st[0] === st[1] && st[0] === 'AMETOA AHADI', st.join(','));
check('and the second orders by arrears inside the group, biggest first',
  Number(ar[0].replace(/,/g, '')) > Number(ar[1].replace(/,/g, '')), ar.join(','));
await page.evaluate(() => { S.rows[2].fu_status = 'HAPATIKANI YEYE & MDHAMINI'; paint(); });

// CUSTOM ORDER: the alphabet is not the order the work happens in. Put ANALIPA LEO first.
await page.evaluate(() => { localStorage.removeItem('hopeOrder_fu_status'); openOrderPanel('fu_status'); });
await page.waitForTimeout(200);
check('the custom order panel lists the values actually in the column',
  await page.evaluate(() => document.querySelectorAll('#ordList .ordrow').length === 3));
const ordered = await page.evaluate(() => {
  // Alphabetically AMETOA < ANALIPA < HAPATIKANI. Move ANALIPA LEO to the top.
  const rows = () => Array.from(document.querySelectorAll('#ordList .ordrow')).map(r => r.children[0].textContent.trim());
  const i = rows().indexOf('ANALIPA LEO');
  document.querySelector('[data-up="' + i + '"]').click();
  const after = rows();
  document.getElementById('ordSave').click();
  return { panel: after, saved: JSON.parse(localStorage.getItem('hopeOrder_fu_status') || '[]') };
});
check('moving a value up reorders the panel', ordered.panel[0] === 'ANALIPA LEO', ordered.panel.join(','));
const afterSave = await colValues('Follow-up');
check('and saving puts the table in THAT order, not the alphabet',
  afterSave[0] === 'ANALIPA LEO', afterSave.join(','));
check('the order is remembered on the device', ordered.saved[0] === 'ANALIPA LEO', ordered.saved.join(','));
await page.evaluate(() => localStorage.removeItem('hopeOrder_fu_status'));

// --- 9. PRINTING. A legal document has to reach paper, and the old path used a pop-up window
//        -- blocked by browsers, and impossible in the Android app, where the button did
//        nothing at all and said nothing about it.
await page.evaluate(() => { VC.store = {}; go('dashboard'); });
await page.waitForTimeout(400);
const printed = await page.evaluate(() => {
  // Catch the print call rather than opening a real dialog, which would hang the run.
  window.__printedFrom = null;
  const seen = [];
  const orig = window.open;
  window.open = function(){ seen.push('popup'); return null; };
  return new Promise((resolve) => {
    printHtml('<html><head></head><body><h1>Mkataba wa Marekebisho</h1>'
      + '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></body></html>');
    setTimeout(() => {
      const f = document.getElementById('printFrame');
      const body = f && f.contentWindow.document.body;
      window.open = orig;
      resolve({ frame: !!f, popup: seen.length,
                text: body ? body.innerText.trim() : '',
                imgs: body ? body.querySelectorAll('img').length : 0 });
    }, 600);
  });
});
check('printing writes into the page, never a pop-up window',
  printed.frame && printed.popup === 0, JSON.stringify(printed));
check('and the document itself is what lands there',
  /Mkataba wa Marekebisho/.test(printed.text), printed.text.slice(0, 60));
check('with its images -- a contract printed without its stamp has to be printed twice',
  printed.imgs === 1, 'images=' + printed.imgs);

// On paper the frame must be the ONLY thing: an app sidebar printed down the side of a legal
// document is not a document anybody hands to a customer.
const printCss = await page.evaluate(() => {
  const out = { hidesBody: false, showsFrame: false };
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch(e){ continue; }
    for (const r of rules) {
      if (r.type !== CSSRule.MEDIA_RULE || !/print/.test(r.conditionText || '')) continue;
      for (const inner of r.cssRules) {
        if (/body > \*/.test(inner.selectorText || '') && /none/.test(inner.style.display)) out.hidesBody = true;
        if (/#printFrame/.test(inner.selectorText || '') && /visible/.test(inner.style.visibility)) out.showsFrame = true;
      }
    }
  }
  return out;
});
check('on paper the app is hidden and only the document shows',
  printCss.hidesBody && printCss.showsFrame, JSON.stringify(printCss));

// --- 10. The three cadences that used to be numbers typed into the page. They arrive with
//         sign-in, because an officer cannot read the settings table but every officer needs
//         them.
const cad = await page.evaluate(() => ({ vc: VC_MS, pres: S.presSecs,
  hintEvery: S.hintEverySec, hintHold: S.hintHoldSec }));
check('a configured refresh window replaces the built-in ninety seconds', cad.vc === 20000, 'VC_MS=' + cad.vc);
check('the slide timer comes from settings, not from 15 hard-coded', cad.pres === 30, 'presSecs=' + cad.pres);
check('so does how often a tip appears', cad.hintEvery === 600, 'every=' + cad.hintEvery);
check('and how long it stays on screen', cad.hintHold === 12, 'hold=' + cad.hintHold);

// Signing in WITHOUT them must behave exactly as the app did before -- an older deployment,
// or a settings table that will not answer, must not change how the portal runs.
const dflt = await page.evaluate(() => {
  applyCadences(undefined);
  return { vc: VC_MS, pres: S.presSecs };
});
check('and with nothing configured, nothing changes', dflt.vc === 20000, 'VC_MS=' + dflt.vc);

// --- 11. THE NOTICEBOARD. It covers every screen on purpose, so the thing that matters is
//         that it can always be got past, and that waving one away does not wave away the next.
ANN = { on: true, ts: 1000, text: 'Mkutano Jumatatu saa 2.', image: '' };
await page.evaluate(() => { localStorage.removeItem('hopeAnnSeen_1000');
  localStorage.removeItem('hopeAnnSeen_2000'); });
await page.evaluate(() => annCheck());
await page.waitForTimeout(300);
check('an announcement covers the screen',
  await page.evaluate(() => document.getElementById('annBg').classList.contains('on')));
check('and says what was posted',
  /Mkutano Jumatatu/.test(await page.evaluate(() => document.getElementById('annBox').innerText)));

await page.evaluate(() => document.getElementById('annOk').click());
check('it can always be got past -- a notice nobody can close is an outage',
  !(await page.evaluate(() => document.getElementById('annBg').classList.contains('on'))));

// Same notice again = stays down. This is what stops it reappearing on every tab click.
await page.evaluate(() => annCheck());
await page.waitForTimeout(250);
check('the same notice does not come back',
  !(await page.evaluate(() => document.getElementById('annBg').classList.contains('on'))));

// A NEW notice does come back. Waving away Monday's must not wave away Tuesday's.
ANN = { on: true, ts: 2000, text: 'Tangazo jipya.', image: '' };
await page.evaluate(() => annCheck());
await page.waitForTimeout(250);
check('but a NEW one does -- dismissal is per notice, not for ever',
  await page.evaluate(() => document.getElementById('annBg').classList.contains('on')));
await page.evaluate(() => document.getElementById('annOk').click());
ANN = { on: false, ts: 0 };

// --- 12. THE BELL.
await page.evaluate(() => bellRefresh());
await page.waitForTimeout(300);
check('the bell shows how many are unseen',
  await page.evaluate(() => (document.querySelector('#bellBtn b') || {}).textContent === '2'));
await page.evaluate(() => bellOpen());
await page.waitForTimeout(200);
const bell = await page.evaluate(() => ({
  rows: document.querySelectorAll('#notifList .nrow').length,
  fresh: document.querySelectorAll('#notifList .nrow.new').length,
  first: (document.querySelector('#notifList .nrow') || {}).innerText || '',
}));
check('it lists complaints and comments together', bell.rows === 3, JSON.stringify(bell));
check('newest first', /hakupewa risiti/.test(bell.first), bell.first.slice(0, 50));
check('and marks which ones are new', bell.fresh === 2, 'new=' + bell.fresh);
check('with a way to clear them', await page.evaluate(() => !!document.getElementById('notifSeen')));

// --- 13. WHERE IS THIS CUSTOMER? Opened while somebody is on the phone, so what matters is
//         that it answers in one go and never leaves the officer looking at a spinner.
await page.evaluate(() => findOpen(''));
await page.waitForTimeout(200);
check('the finder opens with an empty box, focused', await page.evaluate(() =>
  !!document.getElementById('findQ') && document.activeElement.id === 'findQ'));

await page.evaluate(() => { document.getElementById('findQ').value = '55';
  document.getElementById('findGo').click(); });
await page.waitForTimeout(200);
check('two characters is refused before it reaches the server',
  /three characters|herufi tatu/.test(await page.evaluate(() => document.getElementById('findOut').innerText)));

await page.evaluate(() => { document.getElementById('findQ').value = '555';
  document.getElementById('findGo').click(); });
await page.waitForTimeout(400);
const found = await page.evaluate(() => document.getElementById('findOut').innerText);
check('one search shows every book the customer is in',
  /Defaulters/.test(found) && /Received payments/.test(found), found.slice(0, 90));
check('with the customer named in each', (found.match(/AMINA JUMA/g) || []).length >= 2);
check('and a book that could not be read says so rather than reading empty',
  /could not be read|imeshindikana/.test(found));

await page.evaluate(() => { document.getElementById('findQ').value = 'ZZNOBODY';
  document.getElementById('findGo').click(); });
await page.waitForTimeout(400);
check('nobody found is a sentence, not an empty box',
  /Nobody found|Hakuna aliyepatikana/.test(await page.evaluate(() => document.getElementById('findOut').innerText)));

/* THE MAIN LIST HAS A GRAND TOTAL TOO. Every card board and every slide grew one; this table
   -- the biggest on every tab, and the one the commission week is read from -- did not, which
   is what "the totals aint adding" meant. */
await page.evaluate(() => { VC.store = {}; go('followup'); });
await page.waitForTimeout(600);
check('the main list carries a grand total',
  await page.evaluate(() => !!document.querySelector('#mainCard tr.totrow')));
check('and it is labelled in both languages',
  /JUMLA \/ TOTAL/.test(await page.evaluate(() => {
    const tr = document.querySelector('#mainCard tr.totrow');
    return tr ? tr.textContent : ''; })));
check('the total adds the money column, not the row numbers',
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#mainCard tbody tr:not(.totrow)'));
    const idx = Array.from(document.querySelectorAll('#mainCard thead th'))
      .findIndex(th => /arrears/i.test(th.textContent));
    if (idx < 0) return 'no arrears column';
    const n = s => Number(String(s).replace(/[^0-9.-]/g, '')) || 0;
    const want = rows.reduce((a, r) => a + n(r.children[idx].textContent), 0);
    const got = n(document.querySelector('#mainCard tr.totrow').children[idx].textContent);
    return want === got ? true : ('want ' + want + ' got ' + got);
  }));
/* A total that ignored the filter would be read as the filtered one by everybody, so it
   totals WHAT IS ON SCREEN. */
const totBefore = await page.evaluate(() => {
  const idx = Array.from(document.querySelectorAll('#mainCard thead th')).findIndex(th => /arrears/i.test(th.textContent));
  return document.querySelector('#mainCard tr.totrow').children[idx].textContent; });
await page.evaluate(() => { S.filters.team = 'KONGOWE'; paint(); });
await page.waitForTimeout(200);
const totAfter = await page.evaluate(() => {
  const tr = document.querySelector('#mainCard tr.totrow');
  if (!tr) return null;
  const idx = Array.from(document.querySelectorAll('#mainCard thead th')).findIndex(th => /arrears/i.test(th.textContent));
  return tr.children[idx].textContent; });
check('the total follows the filter rather than ignoring it',
  totBefore === '2,300' && totAfter === '1,800', totBefore + ' -> ' + totAfter);
await page.evaluate(() => { S.filters.team = ''; paint(); });

/* ------------------------------------------------------------------ THE PRESENTATION.
   Two complaints, both about the deck: ticking a segment box reloaded the whole page, and once
   it was playing there was no way to move a slide without a keyboard. */
await page.evaluate(() => { VC.store = {}; go('present'); });
await page.waitForTimeout(700);

const segs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.presSeg')).map(c => c.value));
check('every board is offered as a segment', segs.length >= 10, segs.join(','));
for (const id of ['pmo', 'early', 'recovery', 'calls', 'cs', 'credit'])
  check('  ...including ' + id, segs.includes(id));
check('the two HOPE Calls ends are ONE slide, not two',
  segs.includes('calls') && !segs.includes('callsLow'), segs.join(','));
/* ONE SLIDE PER ROLE, carrying today AND the week. Split apart, the room read today's figure,
   discussed it, and had lost the week by the time it came round. */
for (const [id, gone] of [['pmo','pmoDay'], ['pmo','pmoWeek'], ['early','earlyWeek'], ['recovery','recToday']])
  check('  ...and ' + gone + ' is folded into ' + id, !segs.includes(gone), segs.join(','));
const bothPeriods = await page.evaluate(() => {
  const out = {};
  for (const id of ['pmo', 'early', 'recovery']) {
    const sl = S.slides.find(s => s.id === id);
    out[id] = sl ? sl.cols.map(c => c.label).join(' | ') : null;
  }
  return out;
});
for (const id of ['pmo', 'early', 'recovery'])
  check('  ...' + id + ' carries today and the week on one slide',
    /today/i.test(bothPeriods[id] || '') && /week/i.test(bothPeriods[id] || ''), bothPeriods[id]);

/* DOWNLOADING INSIDE THE APK USED TO CLOSE IT.
   An anchor with a download attribute makes a blob: URL. Inside the WebView that goes to
   Android's DownloadManager, which does not understand blob:, throws, and then the fallback
   asks Android to open the same URL with an ordinary app -- nothing can, and the process dies.
   No file, no message, no app. The page must never take that route inside the APK. */
const downloadRoute = async (hasSave) => page.evaluate((withSave) => {
  window.HopeCalls = { getDeviceId: () => 'DEV' };
  const out = { anchorClicked: false, savedName: null, toldUser: false };
  if (withSave) window.HopeCalls.saveBase64 = (n) => { out.savedName = n; return 'OK ' + n; };
  const realCreate = document.createElement.bind(document);
  document.createElement = function(t){
    const el = realCreate(t);
    if (t === 'a') { const c = el.click.bind(el); el.click = function(){ out.anchorClicked = true; return c(); }; }
    return el;
  };
  const realToast = window.toast;
  window.toast = function(m, bad){ out.toldUser = true; out.msg = m; };
  download(new Blob(['x'], { type: 'image/jpeg' }), 'report.jpg');
  document.createElement = realCreate;
  return new Promise(r => setTimeout(() => { window.toast = realToast; delete window.HopeCalls; r(out); }, 300));
}, hasSave);

const older = await downloadRoute(false);
check('an older handset is TOLD, never walked into the crash',
  older.anchorClicked === false && older.toldUser === true, JSON.stringify(older));
const newer = await downloadRoute(true);
check('a handset that can save gets the bytes, not a blob: URL',
  newer.anchorClicked === false && newer.savedName === 'report.jpg', JSON.stringify(newer));

const browser_ = await page.evaluate(() => {
  const out = { anchorClicked: false };
  const realCreate = document.createElement.bind(document);
  document.createElement = function(t){
    const el = realCreate(t);
    if (t === 'a') { const c = el.click.bind(el); el.click = function(){ out.anchorClicked = true; }; }
    return el;
  };
  download(new Blob(['x'], { type: 'image/jpeg' }), 'report.jpg');
  document.createElement = realCreate;
  return out;
});
check('and an ordinary browser still downloads exactly as before', browser_.anchorClicked === true);

/* PRAYERS, AND THE TELEVISION. Switching the TV off and back on costs the meeting a minute of
   watching the deck reload. The blackout has to cover the room WITHOUT losing the deck -- and
   the clock has to stop with it, or the presenter comes back three slides further on with
   nothing to explain it. */
await page.evaluate(() => presStart(0));
await page.waitForTimeout(200);
const blackedOut = () => page.evaluate(() => !!document.querySelector('#pres .pblank'));
const slideNow = () => page.evaluate(() => S.presI);
const startedOn = await slideNow();
await page.evaluate(() => presBlank(true));
/* AND IT HAS TO BE FINDABLE. It was a bare filled circle beside the close cross, which reads as
   decoration -- the person who asked for it looked at the deck and did not see it. */
check('the blackout button says what it does, in words',
  /Skrini nyeusi/.test(await page.evaluate(() => document.querySelector('#pres .phead').textContent)),
  await page.evaluate(() => document.querySelector('#pres .phead').textContent));

check('the screen can be blacked out mid-deck', await blackedOut());
check('and the deck is still there underneath, on the same slide', (await slideNow()) === startedOn);
check('the auto-advance stops with it',
  await page.evaluate(() => S.presTimer === null || S.presTimer === undefined));
// Every key brings it back and NONE of them move the deck -- a hand reaching for the remote in
// a dark room must not land somewhere else.
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(120);
check('any key brings the deck back', !(await blackedOut()));
check('and it comes back on the slide it left', (await slideNow()) === startedOn);
// Blacking out again, then tapping the screen itself.
await page.evaluate(() => presBlank(true));
check('it can be blacked out again', await blackedOut());
await page.click('#pres .pblank');
await page.waitForTimeout(120);
check('tapping the black screen ends it', !(await blackedOut()));
check('a redraw while blacked out does not uncover the room', await page.evaluate(() => {
  presBlank(true); presDraw();                 // an auto-advance firing behind the black
  const on = !!document.querySelector('#pres .pblank');
  presBlank(false);
  return on;
}));

await page.evaluate(() => presStart(0));
await page.waitForTimeout(200);
check('a fresh play never starts behind the black', !(await blackedOut()));

/* GRAND TOTALS. The number the meeting reads out, missing from every projected table. */
await page.evaluate(() => presStart(0));
await page.waitForTimeout(200);
const totalOn = async () => page.evaluate(() => {
  const tr = document.querySelector('#pres .ptot');
  return tr ? tr.textContent.replace(/\s+/g, ' ').trim() : null;
});
let seenTotals = 0, tableSlides = 0;
const nSlides = await page.evaluate(() => S.slides.length);
for (let i = 0; i < nSlides; i++) {
  const kind = await page.evaluate(() => S.slides[S.presI].kind);
  if (kind === 'table') { tableSlides++; if (await totalOn()) seenTotals++; }
  await page.evaluate(() => presGo(1));
}
check('every table slide carries a grand total', seenTotals === tableSlides,
  seenTotals + ' of ' + tableSlides);
check('and it is labelled in both languages',
  /JUMLA \/ TOTAL/.test(await page.evaluate(() => {
    const t = S.slides.findIndex(s => s.kind === 'table');
    S.presI = t; presDraw();
    const tr = document.querySelector('#pres .ptot');
    return tr ? tr.textContent : '';
  })));
/* A column of percentages ADDED UP is nonsense. It is worked out again from the two totals
   that made it, or left blank -- never summed. */
check('percentages are never summed into the total',
  await page.evaluate(() => {
    const rows = [{ collected: 90, expected: 100, pct: 90 }, { collected: 10, expected: 100, pct: 10 }];
    const cols = [{ key:'collected', label:'C', kind:'money' }, { key:'expected', label:'E', kind:'money' },
                  { key:'pct', label:'%', kind:'pct' }];
    const t = autoTotals(rows, cols);
    return t.collected === 100 && t.expected === 200 && t.pct === 50;   // 100/200, not 90+10
  }));
await page.evaluate(() => presStop());

/* THE BUG. This view is never cached (the slideshow runs its own timers), so re-rendering it
   went back for the dashboard AND the officer boards -- a hundred-odd round trips because
   somebody chose not to project one slide. */
const beforeTick = await page.evaluate(() => window.__srvCount || 0);
const callsBefore = srvCalls;
await page.evaluate(() => {
  const box = Array.from(document.querySelectorAll('.presSeg')).find(c => c.value === 'cs');
  box.checked = false; box.onchange();
});
await page.waitForTimeout(400);
check('ticking a segment off asks the server for NOTHING', srvCalls === callsBefore,
  (srvCalls - callsBefore) + ' request(s)');
check('and the slide count drops straight away',
  await page.evaluate(() => document.getElementById('presCount').textContent.trim()),
  await page.evaluate(() => String(S.slides.length)));
check('the hidden one is really gone from the deck',
  await page.evaluate(() => !S.slides.some(s => s.id === 'cs')));
check('and the checkbox list is still on screen to un-tick',
  await page.evaluate(() => !!document.querySelector('.presSeg[value="cs"]')));

// Put it back, and confirm that costs nothing either.
const callsBefore2 = srvCalls;
await page.evaluate(() => {
  const box = Array.from(document.querySelectorAll('.presSeg')).find(c => c.value === 'cs');
  box.checked = true; box.onchange();
});
await page.waitForTimeout(300);
check('un-ticking is free too', srvCalls === callsBefore2);
check('and the slide comes back', await page.evaluate(() => S.slides.some(s => s.id === 'cs')));

// Choosing a team is the same kind of choice and must cost the same.
const callsBefore3 = srvCalls;
await page.evaluate(() => { const t = document.getElementById('presTeam'); t.value = 'KONGOWE'; t.onchange(); });
await page.waitForTimeout(300);
check('picking a team does not go back to the server either', srvCalls === callsBefore3);
await page.evaluate(() => { const t = document.getElementById('presTeam'); t.value = ''; t.onchange(); });

/* THE ARROWS. On a TV nobody is holding a keyboard, and a phone has no arrow keys at all. */
await page.evaluate(() => presStart(0));
await page.waitForTimeout(300);
check('the deck opens on the first slide', await page.evaluate(() => S.presI) === 0);
check('there is a forward button', await page.evaluate(() => !!document.querySelector('#pres .pnext')));
check('and a back button', await page.evaluate(() => !!document.querySelector('#pres .pprev')));
await page.evaluate(() => document.querySelector('#pres .pnext').click());
check('forward moves one slide', await page.evaluate(() => S.presI) === 1);
await page.evaluate(() => document.querySelector('#pres .pprev').click());
check('back moves one slide', await page.evaluate(() => S.presI) === 0);
await page.evaluate(() => document.querySelector('#pres .pprev').click());
check('and back from the first wraps to the last, rather than sticking',
  await page.evaluate(() => S.presI === S.slides.length - 1));
check('the slide counter follows',
  await page.evaluate(() => document.querySelector('#pres .pnum').textContent.trim()),
  await page.evaluate(() => (S.presI + 1) + ' / ' + S.slides.length));
/* Moving by hand must restart the countdown -- otherwise the slide somebody just chose is
   taken away a second later by a timer that was already half spent. */
check('moving by hand restarts the timer rather than leaving it half spent',
  await page.evaluate(() => { const before = S.presTimer; presGo(1); return S.presTimer !== before; }));
await page.evaluate(() => presStop());
check('and it closes', await page.evaluate(() => document.getElementById('pres').style.display) === 'none');

console.log('\nPASS');
ok.forEach(s => console.log('  ok   ' + s));
if (fail.length) { console.log('\nFAIL'); fail.forEach(s => console.log('  FAIL ' + s)); }
if (errs.length) { console.log('\nPAGE ERRORS'); errs.forEach(s => console.log('  ! ' + s)); }
console.log('\n' + ok.length + ' passed, ' + fail.length + ' failed, ' + errs.length + ' page errors');

await browser.close(); srv.close();
process.exit(fail.length || errs.length ? 1 : 0);
