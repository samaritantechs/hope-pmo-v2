/* =====================================================================================
   NAV-BY-NAV AUDIT, AS A PERMANENT GUARD.

   "last time i found navs not working in the directors board meeting presentation,
    it killed me."

   Both halves of every nav are checked here, so a broken one fails the suite instead of
   the boardroom:

     the WIRING   every server-function name the pages call must exist in a registry
                  (the Iliyonasia tab shipped calling `adjustmentSave`, which HOPE Loan
                  owns, and the drawer once hid `adjust` and `audit` from everyone --
                  both were exactly this class of fault);
     the VIEWS    every nav item, ALWAYS entry and data-go button must land on a screen
                  that exists;
     the ANSWERS  every registered portal and loan function must answer an ADMIN --
                  a result, or a clean refusal (an AppError with a status) -- never a
                  crash. A tab whose first request throws TypeError is a spinner.
   ===================================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { portalApi, PORTAL_FUNCTIONS } = await import('../api/_lib/portal-core.js');
const { loanApi, LOAN_FUNCTIONS } = await import('../api/_lib/loan-core.js');
const { callApi } = await import('../api/_lib/call-core.js');

const NOW = Date.parse('2026-07-24T09:00:00Z');   // Friday noon EAT, like the other suites
const app = readFileSync(new URL('../public/app.html', import.meta.url), 'utf8');
const phone = readFileSync(new URL('../public/call.html', import.meta.url), 'utf8');

const names = (src, rx) => [...new Set([...src.matchAll(rx)].map(m => m[1]))];

/* ------------------------------------------------------------------ the wiring */
test('every srv() name the portal page calls exists on a server registry', () => {
  const known = new Set([...PORTAL_FUNCTIONS, ...LOAN_FUNCTIONS]);
  const called = names(app, /\bsrv\('([A-Za-z_]+)'/g);
  assert.ok(called.length > 80, 'the extractor stopped seeing srv() calls -- fix the regex, not the page');
  const missing = called.filter(n => !known.has(n));
  assert.deepEqual(missing, [],
    'app.html calls server functions no registry knows -- these tabs would spin forever: ' + missing.join(', '));
});

test('every lnAct() name is a HOPE Loan function', () => {
  const known = new Set(LOAN_FUNCTIONS);
  const called = names(app, /\blnAct\('([A-Za-z_]+)'/g);
  assert.ok(called.length > 10, 'the extractor stopped seeing lnAct() calls');
  const missing = called.filter(n => !known.has(n));
  assert.deepEqual(missing, [], 'HOPE Loan buttons pointing at nothing: ' + missing.join(', '));
});

test('every api_ name the phone page calls is a real phone API', async () => {
  const called = names(phone, /'(api_[A-Za-z]+)'/g);
  assert.ok(called.length > 5, 'the extractor stopped seeing phone API names');
  for (const n of called) {
    try {
      await callApi(fakeDb({ call_users: [], settings: [], teams: [] }), n, [], NOW);
    } catch (e) {
      assert.ok(!/Unknown call API/.test(String(e && e.message)), n + ' is not a phone API any more');
    }
  }
});

/* ------------------------------------------------------------------ the views */
test('every nav item, ALWAYS entry and data-go button lands on a screen that exists', () => {
  const views = new Set(names(app, /VIEWS\.([A-Za-z_]+)\s*=/g));
  assert.ok(views.size > 20, 'the extractor stopped seeing VIEWS definitions');

  /* `upload` is the one nav that is a page of its own -- go() redirects to /upload, and the
     route plus public/upload.html both exist (checked below), so it needs no VIEWS entry. */
  assert.ok(/view==='upload'.*location\.href='\/upload'/.test(app), 'the upload nav lost its redirect');
  assert.ok(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8').includes('"/upload"'),
    'the /upload route left vercel.json while the nav still points there');
  const navIds = names(app, /\{ id:'([A-Za-z_]+)',\s*label:/g).filter(id => id !== 'upload');
  assert.ok(navIds.length > 20, 'the extractor stopped seeing nav entries');
  const navMissing = navIds.filter(id => !views.has(id));
  assert.deepEqual(navMissing, [], 'nav items whose screen does not exist: ' + navMissing.join(', '));

  /* ALWAYS -- the twenty-five tabs drawn for everybody whatever their role -- is gone, because
     it made ticking a permission decorative. What is left is the handful of views that have no
     nav item of their own and are reached from inside a screen that IS gated, so they still
     have to exist even though nothing in the drawer points at them. */
  const hiddenSrc = app.match(/var HIDDEN_VIEWS = \[([^\]]+)\]/);
  assert.ok(hiddenSrc, 'the HIDDEN_VIEWS list moved -- update the extractor');
  const hidden = names(hiddenSrc[1], /'([A-Za-z_]+)'/g);
  const hiddenMissing = hidden.filter(id => !views.has(id));
  assert.deepEqual(hiddenMissing, [], 'hidden views with no screen: ' + hiddenMissing.join(', '));
  /* And the screen somebody lands on when their role holds nothing at all. Without it an
     unticked role opens a blank app, which is indistinguishable from a broken one. */
  assert.ok(views.has('noaccess'), 'the "access not set yet" screen went missing');
  /* AND IT MUST OFFER A WAY BACK TO THE PHONE. Most people who land here are collection
     officers whose actual work is HOPE Calls; the screen already tells them their phone app is
     unaffected, and a screen that says so while leaving them nowhere to go makes them close the
     portal and doubt the whole system. The route is /call -- the same one home.html uses. */
  const noaccessSrc = app.slice(app.indexOf('VIEWS.noaccess'),
    app.indexOf('VIEWS.', app.indexOf('VIEWS.noaccess') + 10));
  assert.ok(/href="\/call"/.test(noaccessSrc),
    'the access-not-set screen is a dead end again -- no way back to HOPE Calls');
  /* THE SIGN-IN SCREEN ASKS FOR A CODE AND NOTHING ELSE.

       "at logging in: weka msimbo should not even have a hopecalls card below if someone
        puts code through app take them directly to hopecalls, they'll access the system by
        the switch whenever they need to"

     Every code already lands on Calls -- a team code through tryTeamCode, a leader's through
     renderHome -- so a tile offering Calls as the OTHER choice made the screen look like a fork
     when both paths end in the same place. But the way through must survive: this page is what
     the Android WebView opens, and an officer with a mistyped or missing team code sitting at a
     box they cannot fill is the call app being down for that person. A plain link is the floor,
     a tile is the thing that was asked to go. */
  const home = readFileSync(new URL('../public/home.html', import.meta.url), 'utf8');
  const signIn = home.slice(home.indexOf('function renderSignIn'), home.indexOf('function readJson_'));
  assert.ok(!/tile\('\/call'/.test(signIn), 'the HOPE Calls TILE is back on the sign-in screen');
  assert.ok(/href="\/call"/.test(signIn),
    'the sign-in screen has no way through to Calls at all -- an officer without a code is stranded');
  /* AND THE LANDING ITSELF IS CALLS, SIGNED IN OR OUT.

       "the landing page if someone is logout should be that of logging in to hopecalls by
        team or leader / if already logged in land to customers"

     Signed in, Calls opens on the customer list; signed out, on Calls' own sign-in, which
     takes a team code or a leader's access code. Both answers are /call, so boot goes there
     without asking the server first -- the redirect must live in boot, not behind a fetch,
     or the first thing the WebView loads is a round trip it does not need. */
  const boot = home.slice(home.indexOf('(function boot()'));
  assert.ok(/window\.location\.replace\('\/call'\)/.test(boot),
    'the landing page no longer opens HOPE Calls');
  assert.ok(boot.indexOf("window.location.replace('/call')") < boot.indexOf('fetch('),
    'the landing waits on /api/me before opening Calls -- that read is not needed to decide');
  /* The launcher is not gone, it is just no longer the front door: the office TV and an admin
     wanting /upload directly still reach it, and losing that strands both. */
  assert.ok(/menu=1/.test(boot), 'the ?menu=1 launcher escape hatch is gone');
  assert.ok(/window\.location\.href = '\/call'/.test(home),
    'a team code no longer lands on HOPE Calls');
  /* THE OTHER DOORS MUST NOT DEPEND ON THIS SCREEN. Each carries its own code box and reads
     hopeCode itself; if one ever stopped, this redirect would lock its people out. */
  for (const page of ['upload.html', 'dashboard.html', 'app.html']) {
    const src = readFileSync(new URL('../public/' + page, import.meta.url), 'utf8');
    assert.ok(/hopeCode/.test(src) && /'code'\)|#code/.test(src),
      page + ' lost its own sign-in -- the landing redirect now strands whoever needs it');
  }

  /* THE STAMP THE SERVER READS AND THE ONE THE PAGE REPORTS MUST BE THE SAME STRING.
     A permission that lands on the server and not on the screen is what let an unticked role
     keep its navs, so the page reloads itself when /api/me says it is behind. That handshake
     is only worth anything while the server's regex still finds the page's stamp -- rename
     BUILD on one side and the check silently never fires again, which is exactly the shape of
     the fault it exists to catch. */
  const pageBuild = app.match(/var BUILD = '([^']+)'/);
  assert.ok(pageBuild, 'the page lost its BUILD stamp');
  const meSrc = readFileSync(new URL('../api/me.js', import.meta.url), 'utf8');
  const serverRe = meSrc.match(/src\.match\((\/var BUILD = [^/]*\/)\)/);
  assert.ok(serverRe, 'api/me.js no longer reads the page build -- the handshake is dead');
  const found = app.match(new RegExp(serverRe[1].slice(1, -1)));
  assert.ok(found && found[1] === pageBuild[1],
    'the server reads a different stamp (' + (found && found[1]) + ') than the page reports ('
    + pageBuild[1] + ')');
  assert.ok(/freshEnough_/.test(app), 'the page stopped checking whether it is out of date');
  assert.ok(/go\(firstAllowed_\(\) \|\| 'noaccess'\)/.test(app),
    'the landing tab must be one the person actually holds, never a fixed dashboard');

  const goTargets = names(app, /data-go="([A-Za-z_]+)"/g);
  const goMissing = goTargets.filter(id => !views.has(id));
  assert.deepEqual(goMissing, [], 'data-go buttons pointing at no screen: ' + goMissing.join(', '));
});

/* ------------------------------------------------------------------ the answers */
/* Every table the code ever reads, empty -- the point is that an EMPTY deployment must
   answer every screen with zeros and dashes, never a crash. A missing-table fake throws
   TypeError, which is exactly the class of failure this exists to catch. */
function emptyBook() {
  const t = {};
  for (const name of [
    'teams', 'access_codes', 'roles', 'settings', 'repayment_snapshots', 'defaulter_snapshots',
    'snapshot_summaries', 'followup_status', 'followup_comments', 'loans', 'received_payments',
    'abnormal_payments', 'complaints', 'complaint_log', 'restructures', 'demand_notices',
    'call_users', 'call_agents', 'call_logs', 'audit_log', 'performance_records',
    'pmo_adjustments', 'hints', 'announcement', 'assessments', 'customers', 'guarantors',
    'carriers', 'disbursement_windows', 'loan_events', 'manual_adjustments', 'payment_imports',
    'reversals',
  ]) t[name] = [];
  t.teams.push({ team: 'KONGOWE', team_code: 'KON123', recovery: 'ASHA', manager: 'BOB' });
  t.settings.push({ key: 'SYSTEM_OPEN', value: 'YES' });
  return t;
}
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null,
  tabs: ['upload', 'settings', 'audit', 'adjust'] };

function cleanAnswer(fn) {
  return e => {
    const clean = e && typeof e.status === 'number' && e.status >= 400 && e.status < 500;
    assert.ok(clean, fn + ' crashed instead of answering or refusing cleanly: ' + (e && (e.stack || e.message)));
    return true;
  };
}

test('every registered portal function answers an ADMIN on an empty book -- or refuses cleanly', async () => {
  for (const fn of PORTAL_FUNCTIONS) {
    try { await portalApi(fakeDb(emptyBook()), ADMIN, fn, {}, NOW); }
    catch (e) { cleanAnswer(fn)(e); }
  }
});

test('every registered loan function answers an ADMIN on an empty book -- or refuses cleanly', async () => {
  for (const fn of LOAN_FUNCTIONS) {
    try { await loanApi(fakeDb(emptyBook()), ADMIN, fn, {}); }
    catch (e) { cleanAnswer(fn)(e); }
  }
});

/* The same walk again over a POPULATED book -- rows in every table a screen maps over, so
   each nav's row-shaping code actually runs. An empty book cannot catch "reduce on a field
   that is not there"; this can. */
function richBook() {
  const t = emptyBook();
  const D = '2026-07-24';
  t.access_codes.push(
    { code: 'LEAD1', name: 'ASHA JUMA', role: 'MANAGEMENT', teams: ['KONGOWE'], tabs: [] },
    { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] });
  t.roles.push({ role: 'MANAGEMENT', tabs: ['weekly'] });
  t.settings.push({ key: 'SALES_TARGET_MONTHLY', value: '4000000' });
  t.repayment_snapshots.push(
    { ref: '111', full_name: 'AMINA H', contact: '0712000001', guarantor_name: 'G ONE', guarantor_contact: '0713000001', team: 'KONGOWE', payment_expected: 1000, payment_received: 400, arrears: 0, todays_status: 'UNPAID', due_summary: '2/6', snapshot_type: 'today', snapshot_date: D, upload_batch: 'b1', created_at: D + 'T04:00:00Z' },
    { ref: '444', full_name: 'KESHO K', contact: '0712000004', guarantor_name: '', guarantor_contact: '', team: 'KONGOWE', payment_expected: 700, arrears: 0, todays_status: '', due_summary: '', snapshot_type: 'tomorrow', snapshot_date: D, upload_batch: 'b2', created_at: D + 'T04:00:00Z' },
    { ref: '111', full_name: 'AMINA H', contact: '0712000001', guarantor_name: '', guarantor_contact: '', team: 'KONGOWE', payment_expected: 400, arrears: 0, todays_status: 'PAID', due_summary: '', snapshot_type: 'today', snapshot_date: '2026-07-23', upload_batch: 'b0', created_at: '2026-07-23T04:00:00Z' });
  t.defaulter_snapshots.push(
    { ref: '555', full_name: 'DEF GUY', contact: '0714000001', team: 'KONGOWE', arrears: 500, ds: '3-6', dc: 4, days_elapsed: 12, snapshot_type: 'initial', weekday: 'FRI', snapshot_date: D, upload_batch: 'bi', created_at: D + 'T04:00:00Z' },
    { ref: '555', full_name: 'DEF GUY', contact: '0714000001', team: 'KONGOWE', arrears: 350, ds: '3-6', dc: 4, days_elapsed: 12, snapshot_type: 'current', weekday: 'FRI', snapshot_date: D, upload_batch: 'bc', created_at: D + 'T04:00:00Z' });
  t.followup_status.push({ ref: '555', team: 'KONGOWE', full_name: 'DEF GUY', contact: '0714000001',
    guarantor_name: 'G DEF', guarantor_contact: '0715000001', arrears: 900, rejesho: 100, status: 'Defaulter',
    fu_status: 'PROMISED', promise_date: D, promise_amt: 200, ds: '3-6', dc: 4, days_elapsed: 12,
    last_trans: '2026-07-01', disb_date: '2026-05-01', last_comment: 'ok', comment_by: 'JUMA', comment_at: D + 'T05:00:00Z' });
  t.followup_comments.push(
    { id: 'cm1', ref: '555', team: 'KONGOWE', full_name: 'DEF GUY', comment: 'ataleta', fu_status: 'PROMISED', promise_date: D, promise_amt: 200, new_number: null, created_by: 'JUMA', created_at: D + 'T05:00:00Z' },
    { id: 'cm2', ref: '555', team: 'KONGOWE', full_name: 'DEF GUY', comment: 'namba mpya', fu_status: 'ANA NAMBA NYINGINE', new_number: '0716999999', created_by: 'JUMA', created_at: D + 'T06:00:00Z' });
  t.loans.push(
    { id: 'L1', team: 'KONGOWE', full_name: 'AMINA H', principal_amt: 200000, loan_amt: null, approved_date: '2026-07-10', stage: 'approved', created_at: '2026-07-10T04:00:00Z' },
    { id: 'L2', team: 'KONGOWE', full_name: 'PILI S', requested_amt: 300000, stage: 'applied', created_at: D + 'T04:00:00Z' });
  t.received_payments.push({ id: 'p1', paid_at: D, team: 'KONGOWE', customer_name: 'AMINA H', customer_no: '0712000001', ref_no: '111', amount_paid: 12500, payment_no: '0712000001', transaction_id: 'TX1', created_at: D + 'T05:00:00Z' });
  t.abnormal_payments.push({ id: 'a1', team: 'KONGOWE', customer_name: 'AMINA H', ref: '111', paid: 12345, paid_at: D, created_at: D + 'T05:00:00Z' });
  t.complaints.push({ id: 'x1', ref: '111', team: 'KONGOWE', complainant: 'AMINA H', phone: '0712000001', complaint: 'mrefu', status: 'OPEN', created_at: D + 'T05:00:00Z' });
  t.restructures.push({ id: 'r1', ref: '111', team: 'KONGOWE', full_name: 'AMINA H', status: 'PENDING', created_at: D + 'T05:00:00Z' });
  t.demand_notices.push({ id: 'd1', ref: '555', team: 'KONGOWE', full_name: 'DEF GUY', created_at: D + 'T05:00:00Z' });
  t.call_users.push({ user_id: 'U1', name: 'JUMA ISSA', phone: '712999999', team: 'KONGOWE', role: 'OFFICER', device_id: 'd1', active: true, last_sync: D + 'T06:00:00Z' });
  t.call_logs.push({ id: 'CL1', user_id: 'U1', officer: 'JUMA ISSA', team: 'KONGOWE', phone: '712000001',
    direction: 'OUT', call_date: D, call_time: '09:00', duration: 60, portfolio: true, match_type: 'CUSTOMER',
    ref: '111', customer: 'AMINA H', outcome: 'CONNECTED', category: 'EXPECTED', synced_at: D + 'T06:00:00Z' });
  t.pmo_adjustments.push({ id: 'adj1', adj_date: D, target: 'expected-current', team: 'KONGOWE', amount: 250000, reason: 'iliyonasa', ref: null, created_by: 'PMO DATA', created_at: D + 'T05:00:00Z' });
  t.performance_records.push({ period: 'week', period_start: '2026-07-20', metric: 'collection', scope: 'team',
    name: 'KONGOWE', position: 1, value: 400, basis: 1000, pct: 40, recorded_at: D + 'T06:00:00Z' });
  t.audit_log.push({ id: 'au1', at: D + 'T05:00:00Z', actor_name: 'THE ADMIN', actor_role: 'ADMIN', action: 'settings', ok: true, ms: 12 });
  return t;
}

test('every registered portal function answers an ADMIN on a populated book -- or refuses cleanly', async () => {
  for (const fn of PORTAL_FUNCTIONS) {
    try { await portalApi(fakeDb(richBook()), ADMIN, fn, {}, NOW); }
    catch (e) { cleanAnswer(fn)(e); }
  }
});

test('every registered loan function answers an ADMIN on a populated book -- or refuses cleanly', async () => {
  for (const fn of LOAN_FUNCTIONS) {
    try { await loanApi(fakeDb(richBook()), ADMIN, fn, {}); }
    catch (e) { cleanAnswer(fn)(e); }
  }
});
