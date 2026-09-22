/* THE WRITE PATH ITSELF HAD NO SPEED GUARD AT ALL.
 *
 * speed.test.mjs holds the whole company to a budget on every READ screen. Nothing held
 * api/upload.js's own POST handler -- the function CLAUDE.md calls the most protected code in
 * the system, the one line that says "UPLOADING and CALL APP should NEVER GO DOWN neither SLOW
 * DOWN" -- to any budget at all. Every existing test that touches this file drives its HELPERS
 * (stampPlan, runReplace, reconcileLoanIds, retireFollowupAfterDeck, pruneInSlices...) one at a
 * time; nothing drove the assembled default export the way a real upload actually calls it.
 *
 * That gap is how two of its optional, diagnostic-only steps went un-gated for as long as they
 * did: the Leo/Kesho duplicate check (`sameAsToday`) and the received-payments irregular-amount
 * count (`receivedAbnormal`) were the only two post-write steps in the whole function with no
 * `isLastPart`/clock guard, unlike every other one beside them -- see the comments at their call
 * sites in api/upload.js. `sameAsToday` ran on EVERY slice of a sliced file for an answer nobody
 * reads before the file is complete, and read its comparison off `records` -- one slice, not the
 * file -- so a big Leo/Kesho duplicate could be undercounted by whatever fraction of the file the
 * last slice happened to be. `receivedAbnormal` travelled home baked into a slice's own `message`
 * text, which the page kept only the LAST slice's copy of, so a large received-payments file
 * silently dropped whatever irregular payments an EARLIER slice found.
 *
 * Both are fixed now -- `sameAsToday` gated to the last slice and reading back every ref of the
 * WHOLE upload by batch (retireFollowupAfterDeck's own technique, a few lines below it in that
 * file); `receivedAbnormal` exposed as a plain number the page sums across slices exactly like
 * `inserted` and `followupSynced` already were. This file is the guard that keeps both fixed:
 * it drives the REAL handler -- the module-level `supabase` singleton monkey-patched to a fake
 * database for the length of each test, then restored -- rather than a stand-in for it, because
 * a fake handler is a fake guard.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { supabase } = await import('../api/_lib/supabase.js');
const uploadHandler = (await import('../api/upload.js')).default;
const { isAbnormalAmount } = await import('../api/_lib/portal-core.js');

const PUBLIC = new URL('../public/', import.meta.url).pathname;

/* =====================================================================================
   THE HARNESS: A FAKE DATABASE STANDING IN FOR THE MODULE-LEVEL SINGLETON.
   =====================================================================================
   api/upload.js -- unlike portalApi/callApi/loanApi -- never takes `db` as an argument. It
   reaches for the `supabase` singleton (api/_lib/supabase.js) directly, throughout, because it
   is the ONE handler in this system that predates that convention. So the fake goes where the
   real client lives: `supabase.from` and `supabase.rpc` are swapped for the fake's for the
   length of one call and restored in a `finally`, which is also what keeps a fake surviving a
   thrown assertion from leaking into the next test. */
function countingDb(tables, opts) {
  const db0 = fakeDb(tables, opts);
  let trips = 0, rows = 0;
  const log = [];                     // { table, mode, lim } -- enough to fingerprint a query
  const wrap = (name, q) => new Proxy(q, { get(o, p) {
    if (p === 'then') return (res, rej) => o.then(r => {
      trips++; if (Array.isArray(r.data)) rows += r.data.length;
      log.push({ table: name, mode: o.mode, lim: o.lim });
      return res(r);
    }, rej);
    const v = o[p];
    return typeof v === 'function' ? (...a) => { const out = v.apply(o, a); return out === o ? wrap(name, o) : out; } : v;
  } });
  return {
    db: { from: n => wrap(n, db0.from(n)), rpc: (n, a) => wrap('rpc:' + n, db0.rpc(n, a)) },
    stat: () => ({ trips, rows }),
    log,
    dump: n => db0._dump(n),
  };
}

function fakeRes() {
  const res = { statusCode: 200, body: null,
    setHeader() {},
    status(code) { res.statusCode = code; return res; },
    json(obj) { res.body = obj; return res; },
    end() { return res; } };
  return res;
}

/** Drive the REAL default-exported handler once, against a fake database, and restore the real
    (unreachable-in-a-test) singleton whichever way the call ends. */
async function callUpload(db, body) {
  const orig = { from: supabase.from, rpc: supabase.rpc };
  supabase.from = db.from;
  supabase.rpc = db.rpc;
  try {
    const req = { method: 'POST', body };
    const res = fakeRes();
    await uploadHandler(req, res);
    return res;
  } finally {
    supabase.from = orig.from;
    supabase.rpc = orig.rpc;
  }
}

/* ADMIN never pays for roleTabsOf's read (short-circuited by role), never gets closed out by
   the system-open switch (isAdminUser short-circuits requireSystemOpen), and always holds
   upload/settings -- exactly the actor an upload actually runs as. */
const ADMIN = [{ code: 'A', name: 'ADMIN', role: 'ADMIN', teams: null, tabs: [] }];

function baseTables(extra) {
  return {
    access_codes: ADMIN, roles: [], teams: [{ team: 'TEAM1' }], settings: [],
    repayment_snapshots: [], defaulter_snapshots: [], snapshot_summaries: [],
    received_payments: [],
    ...extra,
  };
}

// A valid uuid, the shape partPlan actually requires (uuid_() in upload.html, checked against
// UUID_RE) -- a plain string here silently mints a FRESH batch per slice instead of one shared
// batch, which would test something else entirely.
const BATCH_1 = '11111111-1111-4111-8111-111111111111';

const EXPECTED_HEADER = ['REF#', 'FULLNAME', 'TEAM'];
const expectedRow = i => ['R' + i, 'C' + i, 'TEAM1'];

/* =====================================================================================
   1. A SANE TRIP BUDGET ON THE HANDLER ITSELF -- FINDING 4.
   =====================================================================================
   Not tight, and not meant to be: this is the first budget this handler has ever had, and the
   point is to catch a FUTURE read added carelessly to /api/upload, not to police today's cost
   down to the trip. Numbers are measured on this fixture with headroom, exactly like every
   budget in speed.test.mjs. */
test('a small received-payments upload, sent whole, keeps a sane trip budget', async () => {
  const c = countingDb(baseTables());
  const header = ['PAYMENT DATE', 'TEAM', 'CUSTOMER NAME', 'AMOUNT PAID'];
  const rows = [header, ...Array.from({ length: 50 }, (_, i) =>
    ['2026-09-01', 'TEAM1', 'C' + i, i % 3 === 0 ? 1234 : 500])];
  const res = await callUpload(c.db, { code: 'A', type: 'received', meta: {}, rows });
  assert.equal(res.body.ok, true, res.body.error);
  const { trips, rows: rowCount } = c.stat();
  // Measured at 8 trips, 0 rows.
  assert.ok(trips <= 15, `received-payments single request cost ${trips} round trips (budget 15)`);
  assert.ok(rowCount <= 300, `received-payments single request pulled ${rowCount} rows (budget 300)`);
});

test('a small Expected-Tomorrow upload, sent whole, keeps a sane trip budget', async () => {
  const tables = baseTables();
  for (let i = 0; i < 900; i++) {
    tables.repayment_snapshots.push({ ref: 'R' + i, snapshot_type: 'today',
      snapshot_date: '2026-09-01', team: 'TEAM1', upload_batch: 'existing' });
  }
  const c = countingDb(tables);
  const rows = [EXPECTED_HEADER, ...Array.from({ length: 900 }, (_, i) => expectedRow(i))];
  const res = await callUpload(c.db, { code: 'A', type: 'expected-tomorrow',
    meta: { date: '2026-09-01' }, rows });
  assert.equal(res.body.ok, true, res.body.error);
  const { trips, rows: rowCount } = c.stat();
  // Measured at 21 trips, 3,601 rows (the sweep and deck-totals housekeeping this upload type
  // also runs are the bulk of both -- unrelated to this fix, and already the shape this handler
  // has always had).
  assert.ok(trips <= 35, `Expected-Tomorrow single request cost ${trips} round trips (budget 35)`);
  assert.ok(rowCount <= 6000, `Expected-Tomorrow single request pulled ${rowCount} rows (budget 6000)`);
});

/* =====================================================================================
   2. FINDING 1, THE WASTE: sameAsToday MUST RUN ONCE PER UPLOAD, NOT ONCE PER SLICE.
   =====================================================================================
   `.limit(2000)` on `repayment_snapshots` is a fingerprint nothing else in this codebase
   produces -- it is the one, unique shape of the Leo/Kesho "other type" read. Before the fix
   this ran on every slice of a file that had to be sent as several requests; the guard below
   sends the SAME file as three slices and fails if that query shows up more than once. */
test('sameAsToday runs on the LAST slice only, not on every slice of a big file', async () => {
  const tables = baseTables();
  for (let i = 0; i < 900; i++) {
    tables.repayment_snapshots.push({ ref: 'R' + i, snapshot_type: 'today',
      snapshot_date: '2026-09-01', team: 'TEAM1', upload_batch: 'existing' });
  }
  const c = countingDb(tables);
  const fingerprint = from => c.log.slice(from)
    .filter(x => x.table === 'repayment_snapshots' && x.mode === 'select' && x.lim === 2000).length;

  let mark = 0;
  for (let s = 0; s < 3; s++) {
    const rows = [EXPECTED_HEADER, ...Array.from({ length: 300 }, (_, i) => expectedRow(s * 300 + i))];
    const res = await callUpload(c.db, { code: 'A', type: 'expected-tomorrow',
      meta: { date: '2026-09-01' }, rows, part: { id: BATCH_1, index: s, total: 3 } });
    assert.equal(res.body.ok, true, res.body.error);
    const hits = fingerprint(mark);
    mark = c.log.length;
    if (s < 2) assert.equal(hits, 0, `slice ${s} of 3 (not the last) ran the same-as-today check -- it should wait for the file to be complete`);
    else assert.equal(hits, 1, 'the last slice should run the same-as-today check exactly once');
  }
});

/* =====================================================================================
   3. FINDING 1, THE CORRECTNESS BUG: THE COMPARISON MUST SEE THE WHOLE FILE.
   =====================================================================================
   Before the fix, the last slice compared ITS OWN ~300 rows against the other day's 900 --
   which, because every one of those 300 rows genuinely is also in the other day's list, still
   cleared the 95% bar, but reported `sameAsToday: 300`: the size of the last slice, not the
   size of the actual overlap. A file sliced into three parts was judged on a third of itself.
   Sent whole, the same file correctly reports 900. Sliced, it must report the SAME 900 -- not
   a number that depends on how many requests the browser happened to need. */
test('sameAsToday reads back the WHOLE upload by batch -- sliced or not, the count agrees', async () => {
  const seedTables = () => {
    const tables = baseTables();
    for (let i = 0; i < 900; i++) {
      tables.repayment_snapshots.push({ ref: 'R' + i, snapshot_type: 'today',
        snapshot_date: '2026-09-01', team: 'TEAM1', upload_batch: 'existing' });
    }
    return tables;
  };

  const whole = countingDb(seedTables());
  const wholeRows = [EXPECTED_HEADER, ...Array.from({ length: 900 }, (_, i) => expectedRow(i))];
  const wholeRes = await callUpload(whole.db, { code: 'A', type: 'expected-tomorrow',
    meta: { date: '2026-09-01' }, rows: wholeRows });
  assert.equal(wholeRes.body.ok, true, wholeRes.body.error);

  const sliced = countingDb(seedTables());
  let slicedRes;
  for (let s = 0; s < 3; s++) {
    const rows = [EXPECTED_HEADER, ...Array.from({ length: 300 }, (_, i) => expectedRow(s * 300 + i))];
    slicedRes = await callUpload(sliced.db, { code: 'A', type: 'expected-tomorrow',
      meta: { date: '2026-09-01' }, rows, part: { id: BATCH_1, index: s, total: 3 } });
    assert.equal(slicedRes.body.ok, true, slicedRes.body.error);
  }

  assert.equal(wholeRes.body.sameAsToday, 900, 'the whole-file upload should see all 900 shared customers');
  assert.equal(slicedRes.body.sameAsToday, 900,
    'the sliced upload undercounted the overlap -- it is reading a slice, not the file (the old bug this guards against)');
});

/* =====================================================================================
   4. FINDING 2, SERVER SIDE: receivedAbnormal TRAVELS AS A NUMBER, PER SLICE, CORRECTLY.
   =====================================================================================
   Each slice's own count has to be right on its own terms before the page can be trusted to
   sum them -- this proves the field, not the summing (test 5 proves the summing). Two slices
   of a received-payments file, with the irregular rows split across both; each response's
   `receivedAbnormal` must count only ITS OWN slice's irregular rows, and the two together must
   equal the true total -- computed independently here with the same rule the server uses. */
test('receivedAbnormal is right on every slice, not just the last one', async () => {
  const amountsA = [500, 1234, 500, 777, 500, 500, 1999, 500, 500, 500];     // 3 irregular
  const amountsB = [500, 250, 500, 3001, 500, 500, 500, 4444, 500, 1];       // 4 irregular
  const trueTotal = [...amountsA, ...amountsB].filter(a => isAbnormalAmount(a, 500)).length;
  assert.equal(trueTotal, 7, 'sanity check on the fixture itself');

  const header = ['PAYMENT DATE', 'TEAM', 'CUSTOMER NAME', 'AMOUNT PAID'];
  const rowsFor = amounts => amounts.map((a, i) => ['2026-09-01', 'TEAM1', 'C' + i, a]);

  const c = countingDb(baseTables());
  const resA = await callUpload(c.db, { code: 'A', type: 'received', meta: {},
    rows: [header, ...rowsFor(amountsA)], part: { id: BATCH_1, index: 0, total: 2 } });
  const resB = await callUpload(c.db, { code: 'A', type: 'received', meta: {},
    rows: [header, ...rowsFor(amountsB)], part: { id: BATCH_1, index: 1, total: 2 } });

  assert.equal(resA.body.ok, true, resA.body.error);
  assert.equal(resB.body.ok, true, resB.body.error);
  assert.equal(resA.body.receivedAbnormal, 3, 'slice 1 should count only its own 3 irregular rows');
  assert.equal(resB.body.receivedAbnormal, 4, 'slice 2 should count only its own 4 irregular rows');
  assert.equal(resA.body.receivedAbnormal + resB.body.receivedAbnormal, trueTotal,
    'the two slices, summed, must equal the whole file’s true count');
});

/* =====================================================================================
   5. FINDING 2, CLIENT SIDE: THE PAGE MUST SUM receivedAbnormal ACROSS SLICES.
   =====================================================================================
   sendInSlices_ lives in public/upload.html, not in a module -- lifted out of the real file the
   same way test/pages.test.mjs already lifts it (liftSlicer there), so this proves the actual
   shipped code rather than a copy of it. A fake network answers each slice with its OWN
   receivedAbnormal, mirroring what the server now sends; the merged result the page hands back
   must be the total, not whichever slice happened to answer last. */
function sendInSlicesSource() {
  const src = readFileSync(PUBLIC + 'upload.html', 'utf8');
  const grab = re => {
    const m = src.match(re);
    assert.ok(m, 'upload.html no longer contains ' + re + ' -- the extractor needs updating');
    return m[0];
  };
  return [
    grab(/var UPLOAD_SLICE_ROWS = \d+;/), grab(/var SLICE_MIN_ROWS = \d+;/),
    grab(/var SLICE_SLOW_MS = \d+;/), grab(/function sliceTimedOut_\(e\)\{[\s\S]*?\n\}/),
    grab(/function sendInSlices_\([\s\S]*?\n\}\n(?=\n)/),
    'return sendInSlices_;',
  ].join('\n');
}

/** Drive the REAL sendInSlices_ (lifted out of public/upload.html, not a copy of it -- see
    liftSlicer in pages.test.mjs for the same technique) against a fake network that answers
    each call with WHATEVER body the test hands it, in order -- so the test controls exactly
    what each slice "found", the way a real server's per-slice answers would differ. */
function driveSlicer(rowCount, bodies) {
  let call = 0;
  const fetch = async (url, opt) => {
    const body = JSON.parse(opt.body);
    const n = body.rows.length - 1;
    const b = bodies[Math.min(call, bodies.length - 1)];
    call++;
    return { r: { status: 200, body: { ok: true, inserted: n, ...b } } };
  };
  // readJson_ in the real page unwraps { r } the same way; uuid_ is replaced with a fixed id
  // since only the SERVER needs it to be a real uuid, and this harness never reaches the server.
  const send = new Function('fetch', 'readJson_', 'uuid_', 'Date', sendInSlicesSource())(
    fetch, x => Promise.resolve(x.r), () => 'test-batch-id', { now: () => Date.now() });
  const rows = [['A', 'B']].concat(Array.from({ length: rowCount }, (_, i) => ['r' + i, i]));
  return send('', 'CODE', 'received', {}, rows, null).then(res => res.r ? res.r.body : res.body);
}

test('the page sums receivedAbnormal across every slice, not the last slice’s alone', async () => {
  // 5,000 rows -> three real slices at UPLOAD_SLICE_ROWS=2000: 2000, 2000, 1000 -- the same
  // split the "healthy database" case in pages.test.mjs measures.
  const body = await driveSlicer(5000, [
    { receivedAbnormal: 3, receivedStep: 500 },
    { receivedAbnormal: 4, receivedStep: 500 },
    { receivedAbnormal: 5, receivedStep: 500 },
  ]);
  assert.equal(body.receivedAbnormal, 12, 'the three slices’ counts (3 + 4 + 5) should be added up, not read off the last one (5)');
  assert.equal(body.receivedStep, 500);
});

test('a type with no receivedAbnormal field is left alone -- no stray zero appears', async () => {
  const body = await driveSlicer(5000, [
    {}, {}, {},                          // e.g. defaulters-current: no such field at all
  ]);
  assert.equal(body.receivedAbnormal, undefined,
    'an upload type that never carries this field must not gain one from the summing logic');
});

test('a file small enough for one request still carries its own receivedAbnormal through unchanged', async () => {
  const body = await driveSlicer(500, [{ receivedAbnormal: 9, receivedStep: 500 }]);
  assert.equal(body.receivedAbnormal, 9, 'the ordinary, unsliced case must behave exactly as the server answered');
});
