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

/* A PAYMENTS FILE OF ONE DAY GIVES THE READER NOTHING TO DECIDE BY BUT THE DAY IT IS UPLOADED (handbook Part 93).
     "Repair everything that's wrong brother ... we have transactions dates at received" -- the owner, 17 Nov 2026
   Through the real handler: a day's file of `11/10/2026`, sent on the tenth of November, is the tenth of November -- not the
   eleventh of October -- and the answer says how the order was decided. Cost: arithmetic over the rows in hand, the same trips. */
test('a received-payments file of one day is stored on that day, and the answer says how the order was read', async () => {
  const header = ['PAYMENT DATE', 'TEAM', 'CUSTOMER NAME', 'AMOUNT PAID', 'TRANSACTION ID'];
  const rows = [header, ...Array.from({ length: 12 }, (_, i) => ['11/10/2026', 'TEAM1', 'C' + i, 500 + i, 'TX' + i])];
  const c = countingDb(baseTables());
  const res = await callUpload(c.db, { code: 'A', type: 'received', meta: { uploadDate: '2026-11-10' }, rows });
  assert.equal(res.body.ok, true, res.body.error);
  assert.deepEqual([...new Set(c.dump('received_payments').map(r => String(r.paid_at).slice(0, 10)))], ['2026-11-10']);
  assert.match(String(res.body.dateOrder), /^month\/day, because that puts the file's dates nearest the day it was uploaded/);
  // sent the next day it is the day before, as the file says; with no upload day named, the server's own clock (East Africa) is read
  const later = countingDb(baseTables());
  const r2 = await callUpload(later.db, { code: 'A', type: 'received', meta: { uploadDate: '2026-11-11' }, rows });
  assert.deepEqual([...new Set(later.dump('received_payments').map(r => String(r.paid_at).slice(0, 10)))], ['2026-11-10']);
  assert.equal(r2.body.ok, true);
  // the day the PAGE names is the one that decides: the same file, uploaded on the twelfth of October, is the eleventh of October (day-first)
  const oct = countingDb(baseTables());
  await callUpload(oct.db, { code: 'A', type: 'received', meta: { uploadDate: '2026-10-12' }, rows });
  assert.deepEqual([...new Set(oct.dump('received_payments').map(r => String(r.paid_at).slice(0, 10)))], ['2026-10-11']);
  // a file that proves its own order says so in the old words
  const proves = countingDb(baseTables());
  const r3 = await callUpload(proves.db, { code: 'A', type: 'received', meta: { uploadDate: '2026-11-10' }, rows: [header, ['11/16/2026', 'TEAM1', 'C', 1, 'TXA'], ['11/10/2026', 'TEAM1', 'D', 1, 'TXB']] });
  assert.equal(r3.body.dateOrder, 'month/day, as the file itself showed');
  assert.deepEqual(proves.dump('received_payments').map(r => String(r.paid_at).slice(0, 10)).sort(), ['2026-11-10', '2026-11-16']);
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
   UPLOADING NEVER GOES DOWN FOR A COLUMN THE DATABASE HAS NOT GOT YET.
   =====================================================================================
   N.C (db/RUN-ME-039a) is read off every Expected sheet now. Migrations here are run by hand,
   so between the deploy and that paste the table has no such column -- and PostgREST refuses
   the WHOLE insert for one unknown column. The write must shed the column and go again, and
   the upload must SAY it did: a column thrown away in silence is the worst kind of success. */
test('an Expected sheet carrying N.C stores it, and a database without the column is told rather than failed', async () => {
  const header = ['REF#', 'FULLNAME', 'TEAM', 'N.C', 'TODAYS STATUS'];
  const rows = [header, ['R1', 'C1', 'TEAM1', 1, 'UNPAID'], ['R2', 'C2', 'TEAM1', 0, 'PAID'], ['R3', 'C3', 'TEAM1', '', 'UNPAID']];
  const body = { code: 'A', type: 'expected-today', meta: { date: '2026-09-01' }, rows };

  // With the column: stored as the sheet writes it, blank as null.
  const c1 = countingDb(baseTables());
  const r1 = await callUpload(c1.db, body);
  assert.equal(r1.body.ok, true, r1.body.error);
  assert.deepEqual(c1.dump('repayment_snapshots').map(r => [r.ref, r.nc]).sort(), [['R1', 1], ['R2', 0], ['R3', null]]);
  assert.equal(/N\.C/.test(String(r1.body.message || '')), false, 'nothing to warn about on a migrated database');
  const okTrips = c1.stat().trips;

  // Without it: the write is refused once, sent again without N.C, every row lands, and the
  // upload names what it could not keep and the file to run. One extra trip, no failure.
  const c2 = countingDb(baseTables(), { missingColumns: { repayment_snapshots: ['nc'] } });
  const r2 = await callUpload(c2.db, body);
  assert.equal(r2.body.ok, true, r2.body.error);
  const stored = c2.dump('repayment_snapshots');
  assert.equal(stored.length, 3, 'every row went in');
  assert.ok(stored.every(r => r.nc === undefined), 'without the column the database has not got');
  assert.match(String(r2.body.message), /N\.C/);
  assert.match(String(r2.body.message), /RUN-ME-039/);
  assert.ok(c2.stat().trips <= okTrips + 1, `shedding the column cost ${c2.stat().trips - okTrips} extra trips, not one`);
});

/* =====================================================================================
   2. FINDING 1, THE WASTE: sameAsToday MUST RUN ONCE PER UPLOAD, NOT ONCE PER SLICE.
   =====================================================================================
   `.limit(2000)` on `repayment_snapshots` is a fingerprint nothing else in this codebase
   produces -- it is the one, unique shape of the Leo/Kesho "other type" read. Before the fix
   this ran on every slice of a file that had to be sent as several requests; the guard below
   sends the SAME file as three slices and fails if that query shows up more than once. */
/* =====================================================================================
   A DEFAULTERS DECK'S DATES ARE READ THE WAY ROUND THE FILE WRITES THEM -- THROUGH THE REAL HANDLER.
   =====================================================================================
     "Was 2209966593 on initial file of today 16th nov 2026 & expected defaulters?" -- the owner

   The loan system writes every date month-first (`9/7/2026`, a seventh of September), and the
   importer read each one both of whose numbers were twelve or under as day-first: 3,883 of the
   10,372 disbursement dates in the real file of 16 Nov were stored swapped, so a third of the
   customers sat on the wrong two days of the week. importers.test.mjs pins the reading; this
   pins that the ROUTE hands the decision in, stores what the file means, and says which way it
   read -- and that a deck costs the database nothing more for it. */
test('a defaulters deck written month-first is stored as the file means it, and the answer says so', async () => {
  const header = ['REF#', 'FULLNAME', 'DISB DATE', 'EXPIRE DATE', 'CHRONIC DATE', 'DUE DATE', 'LAST TRANS DATE', 'STATUS', 'D.S', 'D.C', 'DAYS ELAPSED', 'ARREAS', 'TEAM'];
  const rows = [header,
    ['2200000001', 'A MADE UP', '9/7/2026', '12/7/2026', '12/21/2026', '2026-11-30', '11/11/2026', 'Partial Defaulter', '8-9', 1, 68, 31001, 'TEAM1'],
    ['2200000002', 'B MADE UP', '5/28/2026', '8/27/2026', '9/10/2026', 'No due date', '11/10/2026', 'Defaulter', '3-6', 3, 45, 9000, 'TEAM1']];
  const c = countingDb(baseTables());
  const res = await callUpload(c.db, { code: 'A', type: 'defaulters-initial', meta: { date: '2026-11-16' }, rows });
  assert.equal(res.body.ok, true, res.body.error);
  assert.equal(res.body.defaulterDateOrder, 'month/day, as the file itself showed');
  const stored = c.dump('defaulter_snapshots');
  const a = stored.find(r => r.ref === '2200000001');
  assert.equal(a.disb_date, '2026-09-07', 'the seventh of September, a Monday -- not the ninth of July');
  assert.equal(a.expire_date, '2026-12-07');
  assert.equal(a.chronic_date, '2026-12-21');
  assert.equal(a.weekday, 'MON', '16 Nov 2026 is a Monday');
  assert.ok(!/DAY\/MONTH because nothing/.test(res.body.message || ''), 'a deck that decided says nothing alarming');
});

test('a defaulters deck that gives no clue is read day-first as it always was, and the answer says that it guessed', async () => {
  const header = ['REF#', 'FULLNAME', 'DISB DATE', 'EXPIRE DATE', 'STATUS', 'ARREAS', 'TEAM'];
  const rows = [header, ['2200000001', 'A MADE UP', '9/7/2026', '12/7/2026', 'Defaulter', 5000, 'TEAM1']];
  const c = countingDb(baseTables());
  const res = await callUpload(c.db, { code: 'A', type: 'defaulters-current', meta: { date: '2026-11-16' }, rows });
  assert.equal(res.body.ok, true, res.body.error);
  assert.match(res.body.defaulterDateOrder, /^assumed day\/month/);
  assert.match(res.body.message, /read as DAY\/MONTH because nothing in it said which way round/);
  assert.equal(c.dump('defaulter_snapshots')[0].disb_date, '2026-07-09', 'the old reading, unchanged where nothing says otherwise');
});

test('reading the date order adds no trip to a defaulters upload', async () => {
  const header = ['REF#', 'FULLNAME', 'DISB DATE', 'EXPIRE DATE', 'CHRONIC DATE', 'STATUS', 'ARREAS', 'TEAM'];
  const body = i => ({ code: 'A', type: 'defaulters-initial', meta: { date: '2026-11-16' },
    rows: [header, ...Array.from({ length: 40 }, (_, k) => ['22' + String(k + i).padStart(8, '0'), 'C' + k, '9/7/2026', '12/7/2026', '12/21/2026', 'Defaulter', 1000 + k, 'TEAM1'])] });
  const c = countingDb(baseTables());
  const res = await callUpload(c.db, body(0));
  assert.equal(res.body.ok, true, res.body.error);
  const { trips } = c.stat();
  // Arithmetic over rows already in hand: the same trips a deck cost before it. Measured at 20 on this fixture, with headroom.
  assert.ok(trips <= 24, 'a 40-row defaulters deck cost ' + trips + ' round trips (budget 24)');
});

/* =====================================================================================
   THE EXPECTED SHEET AND THE FOLLOWUP SHEET READ THEIR DATES THE SAME WAY -- THROUGH THE REAL HANDLER.
   =====================================================================================
     "so fix date readings okay? i even seen the error on default lists at disb date columns" -- the owner

   The Follow-up list shows Disb date and Last trans from followup_status. A CURRENT defaulters deck
   refreshes that register, and so does the "Defaulters Followup" upload -- whose importer used to read
   those columns with no order. This pins that the route reads each sheet's own order, stores what the
   file means, says which way it read, and that a Followup file cannot undo a corrected register. */
test('an Expected sheet written month-first is stored as the file means it, and the answer says so', async () => {
  const header = ['REF#', 'FULLNAME', 'DISB DATE', 'DUE DATE', 'LAST TRANS DATE', 'ARREAS', 'TEAM'];
  const rows = [header, ['2200000001', 'A MADE UP', '9/7/2026', '11/30/2026', '11/9/2026', 31001, 'TEAM1']];
  const c = countingDb(baseTables());
  const res = await callUpload(c.db, { code: 'A', type: 'expected-today', meta: { date: '2026-11-16' }, rows });
  assert.equal(res.body.ok, true, res.body.error);
  assert.equal(res.body.dateOrder, 'month/day, as the file itself showed');
  const a = c.dump('repayment_snapshots').find(r => r.ref === '2200000001');
  assert.equal(a.disb_date, '2026-09-07', 'the seventh of September, not the ninth of July');
  assert.equal(a.last_trans_date, '2026-11-09');
  assert.ok(!/DAY\/MONTH because nothing/.test(res.body.message || ''), 'a sheet that decided says nothing alarming');
});

test('an Expected sheet that gives no clue is read day-first as it always was, and the answer says that it guessed', async () => {
  const header = ['REF#', 'FULLNAME', 'DISB DATE', 'LAST TRANS DATE', 'ARREAS', 'TEAM'];
  const rows = [header, ['2200000001', 'A MADE UP', '9/7/2026', '11/9/2026', 5000, 'TEAM1']];
  const c = countingDb(baseTables());
  const res = await callUpload(c.db, { code: 'A', type: 'expected-initial', meta: { date: '2026-11-16' }, rows });
  assert.equal(res.body.ok, true, res.body.error);
  assert.match(res.body.dateOrder, /^assumed day\/month/);
  assert.match(res.body.message, /read as DAY\/MONTH because nothing in it said which way round/);
  assert.equal(c.dump('repayment_snapshots')[0].disb_date, '2026-07-09', 'the old reading, unchanged where nothing says otherwise');
});

test('a Defaulters Followup file written month-first cannot put swapped dates back on the Follow-up list', async () => {
  const header = ['REF#', 'TEAM', 'FULLNAME', 'DISB DATE', 'LAST TRANS', 'ARREAS', 'PROMISE DATE'];
  const rows = [header, ['2200000001', 'TEAM1', 'A MADE UP', '9/7/2026', '11/9/2026', 31001, '11/30/2026']];
  // The register holds what a corrected CURRENT deck wrote; the Followup file is uploaded after it.
  const c = countingDb(baseTables({ followup_status: [{ ref: '2200000001', team: 'TEAM1', disb_date: '2026-09-07', last_trans: '2026-11-09' }] }));
  const res = await callUpload(c.db, { code: 'A', type: 'followup', rows });
  assert.equal(res.body.ok, true, res.body.error);
  assert.equal(res.body.dateOrder, 'month/day, as the file itself showed');
  const a = c.dump('followup_status').find(r => r.ref === '2200000001');
  assert.equal(a.disb_date, '2026-09-07', 'still the seventh of September -- not the ninth of July');
  assert.equal(a.last_trans, '2026-11-09', 'the ninth of November, not the eleventh of September');
  assert.equal(a.promise_date, '2026-11-30');
});

/* Measured on this fixture (a 40-row file) both with and without the date order: 21 round trips for an
   Expected deck and 8 for a Followup file, the same before the change and after it. */
const EXPECTED_SHEET_TRIPS = 24, FOLLOWUP_SHEET_TRIPS = 10;
test('reading the date order adds no trip to an Expected or a Followup upload', async () => {
  const exp = { code: 'A', type: 'expected-today', meta: { date: '2026-11-16' },
    rows: [['REF#', 'FULLNAME', 'DISB DATE', 'DUE DATE', 'ARREAS', 'TEAM'],
      ...Array.from({ length: 40 }, (_, k) => ['22' + String(k).padStart(8, '0'), 'C' + k, '9/7/2026', '11/30/2026', 1000 + k, 'TEAM1'])] };
  const fu = { code: 'A', type: 'followup',
    rows: [['REF#', 'TEAM', 'FULLNAME', 'DISB DATE', 'LAST TRANS', 'ARREAS'],
      ...Array.from({ length: 40 }, (_, k) => ['22' + String(k).padStart(8, '0'), 'TEAM1', 'C' + k, '9/7/2026', '11/30/2026', 1000 + k])] };
  const ce = countingDb(baseTables());
  const re = await callUpload(ce.db, exp);
  assert.equal(re.body.ok, true, re.body.error);
  const cf = countingDb(baseTables({ followup_status: [] }));
  const rf = await callUpload(cf.db, fu);
  assert.equal(rf.body.ok, true, rf.body.error);
  /* Arithmetic over rows already in hand: no read and no write is added. Measured on this fixture and
     bounded with headroom, so a read added to either sheet's path fails here with its own count. */
  assert.ok(ce.stat().trips <= EXPECTED_SHEET_TRIPS, 'a 40-row Expected deck cost ' + ce.stat().trips + ' round trips (budget ' + EXPECTED_SHEET_TRIPS + ')');
  assert.ok(cf.stat().trips <= FOLLOWUP_SHEET_TRIPS, 'a 40-row Followup file cost ' + cf.stat().trips + ' round trips (budget ' + FOLLOWUP_SHEET_TRIPS + ')');
});

/* =====================================================================================
   THE COMPANY'S OWN FOUR SHEETS READ THEIR DATES THE WAY THEIR FILE WRITES THEM -- THROUGH THE REAL HANDLER.
   =====================================================================================
     "just study the dates if the position of month starts then day or vice versa trim the same for the rest
      not to stay contradicted.. since that I think affects multiple lists in the system so pass through
      how you cumpute uploaded dates bro" -- the owner, 16 Nov 2026 (handbook Part 89)

   Complaints, restructures, call registrations and call history were the last uploads that read a slash
   date with no look at the file around it, and a stamp with a clock came back null and was replaced by the
   moment of the upload. importers.test.mjs pins the reading; this pins that the ROUTE stores what the file
   means for each of the four, and that reading the order costs the database nothing. */
const COMPANY_SHEETS = [
  { type: 'complaints', table: 'complaints',
    rows: n => [['TIMESTAMP', 'REF#', 'COMPLAINANT', 'RESOLVED AT'], ['9/7/2026 10:15:00', '2200000001', 'A MADE UP', '9/8/2026 09:00:00'], ['11/16/2026 14:02:00', '2200000002', 'B MADE UP', ''],
      ...Array.from({ length: n }, (_, k) => ['9/7/2026 10:15:00', '23' + String(k).padStart(8, '0'), 'C' + k, ''])],
    first: r => [r.created_at, r.resolved_at], means: ['2026-09-07', '2026-09-08'] },
  { type: 'restructures', table: 'restructures',
    rows: n => [['TIMESTAMP', 'REF#', 'FULLNAME', 'START DATE', 'APPROVED AT'], ['9/7/2026', '2200000001', 'A MADE UP', '10/1/2026', '9/8/2026'], ['11/16/2026', '2200000002', 'B MADE UP', '', ''],
      ...Array.from({ length: n }, (_, k) => ['9/7/2026', '23' + String(k).padStart(8, '0'), 'C' + k, '', ''])],
    first: r => [r.created_at, r.start_date, r.approved_at], means: ['2026-09-07', '2026-10-01', '2026-09-08'] },
  { type: 'call-users', table: 'call_users',
    rows: n => [['USER ID', 'NAME', 'PHONE', 'REGISTERED AT', 'LAST SYNC'], ['U1', 'A MADE UP', '0700000001', '9/7/2026 10:15:00', '11/16/2026 08:00:00'],
      ...Array.from({ length: n }, (_, k) => ['V' + k, 'C' + k, '071' + String(k).padStart(7, '0'), '9/7/2026 10:15:00', ''])],
    first: r => [r.registered_at, r.last_sync], means: ['2026-09-07', '2026-11-16'] },
  { type: 'call-logs', table: 'call_logs',
    rows: n => [['LOG ID', 'USER ID', 'PHONE', 'CALL DATE', 'CALL TIME', 'SYNCED AT'], ['L1', 'U1', '0700000001', '9/7/2026', '10:15', '9/7/2026 18:00:00'], ['L2', 'U1', '0700000002', '11/16/2026', '11:00', '11/16/2026 18:00:00'],
      ...Array.from({ length: n }, (_, k) => ['M' + k, 'U1', '071' + String(k).padStart(7, '0'), '9/7/2026', '10:15', ''])],
    first: r => [r.call_date, r.synced_at], means: ['2026-09-07', '2026-09-07'] },
];
for (const s of COMPANY_SHEETS) {
  test(`a ${s.type} upload is stored on the days its file means -- month-first, as the file itself shows`, async () => {
    const c = countingDb(baseTables({ [s.table]: [] }));
    const res = await callUpload(c.db, { code: 'A', type: s.type, meta: { date: '2026-11-16' }, rows: s.rows(0) });
    assert.equal(res.body.ok, true, res.body.error);
    const stored = c.dump(s.table);
    const row = stored.find(r => (r.ref || r.user_id || r.id) && String(s.first(r)[0]).slice(0, 10) === s.means[0]) || stored[0];
    assert.deepEqual(s.first(row).map(v => (v == null ? v : String(v).slice(0, 10))), s.means, `${s.type}: the seventh of September, not the ninth of July`);
  });
}
test('reading the date order adds no trip to a complaints, restructures, registrations or call-history upload', async () => {
  /* Arithmetic over rows already in hand: no read and no write is added. Measured on this fixture (a 40-row
     file) and identical on the code before this change and after it: complaints 7, restructures 7, call-users 8
     (one row read: the team list), call-logs 7 trips; bounded with headroom so a read added to any of the four
     fails here with its own count. */
  const budget = { complaints: 10, restructures: 10, 'call-users': 11, 'call-logs': 10 };
  for (const s of COMPANY_SHEETS) {
    const c = countingDb(baseTables({ [s.table]: [] }));
    const res = await callUpload(c.db, { code: 'A', type: s.type, meta: { date: '2026-11-16' }, rows: s.rows(40) });
    assert.equal(res.body.ok, true, res.body.error);
    assert.ok(c.stat().trips <= budget[s.type], `a 40-row ${s.type} upload cost ${c.stat().trips} round trips (budget ${budget[s.type]})`);
  }
});

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

/* =====================================================================================
   PAYMENTS ARE STORED ONCE -- "i randomly upload received payments, so sometimes they are
   duplicate we shouldnt store duplicates". Keyed on the payment's identity and written with
   ignoreDuplicates: the copy already in the book stays, the new one is not written, and the
   answer says how many were new and how many were already there.
   ===================================================================================== */
test('received payments: a payment already in the book is not stored twice, and the upload says so', async () => {
  const header = ['PAYMENT DATE', 'TEAM', 'CUSTOMER NAME', 'TRANSACTION ID', 'AMOUNT PAID'];
  const p1 = ['2026-09-01', 'TEAM1', 'A', 'T1', 500];
  const p2 = ['2026-09-01', 'TEAM1', 'B', 'T2', 1000];
  const p3 = ['2026-09-02', 'TEAM1', 'C', 'T3', 700];
  const c = countingDb(baseTables());
  // The same payment twice IN ONE FILE is written once.
  let res = await callUpload(c.db, { code: 'A', type: 'received', meta: {}, rows: [header, p1, p2, p2.slice()] });
  assert.equal(res.body.ok, true, res.body.error);
  assert.equal(res.body.inserted, 2);
  assert.equal(res.body.duplicates, 0, 'nothing was in the book yet');
  assert.equal(res.body.collapsed, 1, 'the in-file repeat is reported');
  assert.equal(c.dump('received_payments').length, 2);
  // The same sheet again, with one new payment on it: one new row, two already there.
  res = await callUpload(c.db, { code: 'A', type: 'received', meta: {}, rows: [header, p1, p2, p3] });
  assert.equal(res.body.ok, true, res.body.error);
  assert.equal(res.body.inserted, 1, 'only the new payment counts as inserted');
  assert.equal(res.body.duplicates, 2, 'the two already in the book are counted, not stored');
  assert.equal(c.dump('received_payments').length, 3);
  // Nothing new at all is still a successful upload that stored nothing.
  res = await callUpload(c.db, { code: 'A', type: 'received', meta: {}, rows: [header, p1, p2, p3] });
  assert.equal(res.body.ok, true);
  assert.equal(res.body.inserted, 0);
  assert.equal(res.body.duplicates, 3);
  assert.equal(c.dump('received_payments').length, 3, 'the book did not grow');
  // The copy already stored is the one kept: its original batch stamp is untouched.
  const first = c.dump('received_payments').find(r => r.transaction_id === 'T1');
  assert.equal(first.customer_name, 'A');
  // A non-payments upload carries no `duplicates` at all, so the page never words one.
  const d = countingDb(baseTables());
  res = await callUpload(d.db, { code: 'A', type: 'expected', meta: { date: '2026-09-01', weekday: 'MON' },
    rows: [EXPECTED_HEADER, expectedRow(1)] });
  assert.equal(res.body.duplicates, undefined);
});

/* "The abnormal table too.. and it contains duplicates too" -- the same ignoreDuplicates
   write on the abnormal sheet, and the same answer. */
test('abnormal payments: a row already in the book is not stored twice, and the upload says so', async () => {
  const header = ['TEAM', 'REF NO', 'CUSTOMER NAME', 'TRANSACTION ID', 'PAID'];
  const r1 = ['TEAM1', 'R1', 'A', 'TX1', 1234];
  const r2 = ['TEAM1', 'R2', 'B', 'TX2', 777];
  const c = countingDb(baseTables({ abnormal_payments: [] }));
  let res = await callUpload(c.db, { code: 'A', type: 'abnormal', meta: {}, rows: [header, r1, r2, r2.slice()] });
  assert.equal(res.body.ok, true, res.body.error);
  assert.equal(res.body.inserted, 2);
  assert.equal(res.body.duplicates, 0);
  assert.equal(res.body.collapsed, 1, 'the in-file repeat is reported');
  res = await callUpload(c.db, { code: 'A', type: 'abnormal', meta: {}, rows: [header, r1, r2, ['TEAM1', 'R3', 'C', 'TX3', 501]] });
  assert.equal(res.body.inserted, 1, 'only the new row counts as inserted');
  assert.equal(res.body.duplicates, 2, 'the two already in the book are counted, not stored');
  assert.equal(c.dump('abnormal_payments').length, 3, 'the book did not double');
  // The two-week trim is asked for at the end of the clock, and a database without the
  // function (RUN-ME-036 not yet run) is tolerated exactly like the other two trims.
  assert.ok(c.log.some(l => l.table === 'rpc:prune_abnormal_payments'), 'prune_abnormal_payments is called on the last slice');
});

/* WHAT A SECOND UPLOAD DOES, SAID FROM THE KEY. The result's `behaviour` sentence told every
   stamped append upload that "uploading the same file twice would store it twice" -- written
   before the registers had keys, and still said of the demand-notice register after it was
   being REPLACED by REF NO or Kumb.Na. (replaceNoticesByRef) and upserted on the notice's own
   id. The sentence sent people to Replace all for a correction append already makes. */
test('the behaviour sentence says what a re-upload of THIS table does, from its key', async () => {
  const header = ['NoticeID', 'Timestamp', 'AccessCode', 'LegalOfficer', 'REF#', 'CustName', 'Contact',
    'NoticeDate', 'NoticeDays', 'FineAmount', 'TotalDemand', 'ArrearsAtNotice', 'CurrentArrears',
    'Difference', 'Status', 'Team', 'OtherInst'];
  const row = ['HMCL/HEN/24/09/2026-4', '24/09/2026 10:15', 'L1', 'JOHN LEGAL', '2206464347',
    'HUMPHREY EZEKIEL NDONE', '774711656', '24/09/2026', 7, 2493500, 12323500, 9830000, 9000000, -830000,
    'Reduced', 'TEAM1', 1133334];
  const c = countingDb(baseTables({ demand_notices: [], notice_payments: [] }));
  let res = await callUpload(c.db, { code: 'A', type: 'demand-notices', meta: { mode: 'append' }, rows: [header, row] });
  assert.equal(res.body.ok, true, res.body.error);
  assert.equal(res.body.behaviour.mode, 'append');
  assert.match(res.body.behaviour.text, /^Added under \d{4}-\d{2}-\d{2}\. An earlier uploaded notice for the same REF NO or Kumb\.Na\. is REPLACED by the file's row, never stored twice\./);
  assert.doesNotMatch(res.body.behaviour.text, /store it twice/);
  // And the sentence is true: the same register again is the same single row.
  res = await callUpload(c.db, { code: 'A', type: 'demand-notices', meta: { mode: 'append' }, rows: [header, row] });
  assert.equal(res.body.ok, true, res.body.error);
  assert.equal(c.dump('demand_notices').length, 1, 'replaced, not doubled');
  assert.equal(res.body.noticePlace.replaced, 1);
  // A keyed register that is upserted rather than cleared says so from its key words.
  const dHeader = ['Timestamp', 'CUSTOMER NAME', 'REF NO', 'TEAM', 'STAFF NAME', 'AMOUNT'];
  const d = countingDb(baseTables({ pmo_deductions: [] }));
  res = await callUpload(d.db, { code: 'A', type: 'pmo-deductions', meta: { mode: 'append' },
    rows: [dHeader, ['2026-09-01 09:00', 'C1', 'R1', 'TEAM1', 'S1', 5000]] });
  assert.equal(res.body.ok, true, res.body.error);
  assert.match(res.body.behaviour.text, /is UPDATED in place, never stored twice/);
  assert.match(res.body.behaviour.text, /the submission time, customer, reference and staff named together/);
  // The payment books keep the copy already in -- their self-dated sentence says that, not "twice".
  const p = countingDb(baseTables());
  res = await callUpload(p.db, { code: 'A', type: 'received', meta: {},
    rows: [['PAYMENT DATE', 'TEAM', 'CUSTOMER NAME', 'TRANSACTION ID', 'AMOUNT PAID'], ['2026-09-01', 'TEAM1', 'A', 'T1', 500]] });
  assert.equal(res.body.ok, true, res.body.error);
  assert.match(res.body.behaviour.text, /a payment already in the book \(matched on the transaction id/);
  assert.doesNotMatch(res.body.behaviour.text, /store it twice/);
  // A register with no key genuinely appends, and still says so.
  const k = countingDb(baseTables({ complaints: [] }));
  res = await callUpload(k.db, { code: 'A', type: 'complaints', meta: { mode: 'append', uploadDate: '2026-09-01' },
    rows: [['REF#', 'TEAM', 'COMPLAINANT', 'DETAILS'], ['R1', 'TEAM1', 'X', 'late']] });
  assert.equal(res.body.ok, true, res.body.error);
  assert.match(res.body.behaviour.text, /Added under 2026-09-01\. Uploading the same file twice would store it twice\./);
});

/* =====================================================================================
   A DATE NO READER COULD READ IS COUNTED OUT LOUD -- THROUGH THE REAL HANDLER, AND THROUGH THE PAGE (handbook Part 96).
   ===================================================================================== */
const DECK_H2 = ['REF#', 'FULLNAME', 'DISB DATE', 'EXPIRE DATE', 'CHRONIC DATE', 'DUE DATE', 'LAST TRANS DATE', 'STATUS', 'ARREAS', 'TEAM'];
const deckRow2 = (n, d, e, c, due, lt) => ['22' + String(n).padStart(8, '0'), 'C' + n, d, e, c, due, lt, 'Defaulter', 1000 + n, 'TEAM1'];

test('a defaulters deck with dates no reader can read: the answer counts them with examples, the cells are stored empty, and no trip is added', async () => {
  const clean = [DECK_H2, ...Array.from({ length: 40 }, (_, k) => deckRow2(k, '9/7/2026', '12/7/2026', '12/21/2026', 'No Due Date', '11/11/2026'))];
  const dirty = clean.map((r, i) => (i === 3 ? deckRow2(i, 'sometime in July', '12/7/2026', '12/21/2026', '', '') : i === 9 ? deckRow2(i, '9/7/2026', 'soon', 'later', '', '') : r));
  const a = countingDb(baseTables());
  const ra = await callUpload(a.db, { code: 'A', type: 'defaulters-initial', meta: { date: '2026-11-16' }, rows: clean });
  assert.equal(ra.body.ok, true, ra.body.error);
  assert.deepEqual(ra.body.unreadableDates, { count: 0, examples: [] }, 'a file that read in full says 0, not nothing, so the page can add the slices up');
  const b = countingDb(baseTables());
  const rb = await callUpload(b.db, { code: 'A', type: 'defaulters-initial', meta: { date: '2026-11-16' }, rows: dirty });
  assert.equal(rb.body.ok, true, rb.body.error);
  assert.deepEqual(rb.body.unreadableDates, { count: 3, examples: ['sometime in July', 'soon', 'later'] });
  const row = b.dump('defaulter_snapshots').find(r => r.ref === '2200000003');
  assert.equal(row.disb_date, null, 'stored empty, not guessed');
  assert.equal(b.stat().trips, a.stat().trips, 'counting adds no round trip: ' + b.stat().trips + ' against ' + a.stat().trips);
});
test('every other upload that carries date columns answers a count, and one that carries none does not', async () => {
  const c1 = countingDb(baseTables());
  const pay = await callUpload(c1.db, { code: 'A', type: 'received', meta: { uploadDate: '2026-11-16' }, rows: [['PAYMENT DATE', 'REF NO', 'AMOUNT', 'TRANSACTION ID'], ['11/10/2026', '2200000001', '1000', 'T1'], ['the other day', '2200000002', '1000', 'T2']] });
  assert.equal(pay.body.ok, true, pay.body.error);
  assert.deepEqual(pay.body.unreadableDates, { count: 1, examples: ['the other day'] });
  const c2 = countingDb(baseTables());
  const exp = await callUpload(c2.db, { code: 'A', type: 'expected-today', meta: { date: '2026-11-16' }, rows: [['REF#', 'FULLNAME', 'TEAM', 'DISB DATE'], ['R1', 'C1', 'TEAM1', '11/10/2026'], ['R2', 'C2', 'TEAM1', '??']] });
  assert.equal(exp.body.ok, true, exp.body.error);
  assert.equal(exp.body.unreadableDates.count, 1);
  const c3 = countingDb(baseTables({ hints: [] }));
  const hints = await callUpload(c3.db, { code: 'A', type: 'hints', meta: {}, rows: [['KEY', 'TEXT'], ['k1', 'a hint']] });
  assert.equal(hints.body.unreadableDates, undefined, 'a type with no date column carries no field (the page must not gain a stray zero)');
});

test('the page adds the unreadable-date counts of every slice up, keeps three distinct examples, and leaves a type without them alone', async () => {
  const body = await driveSlicer(5000, [
    { unreadableDates: { count: 3, examples: ['sometime', 'soon'] } },
    { unreadableDates: { count: 4, examples: ['soon', 'later', 'never', 'x'] } },
    { unreadableDates: { count: 0, examples: [] } },
  ]);
  assert.deepEqual(body.unreadableDates, { count: 7, examples: ['sometime', 'soon', 'later'] }, '3 + 4 + 0 over three slices; the examples distinct and at most three');
  const none = await driveSlicer(5000, [{}, {}, {}]);
  assert.equal(none.unreadableDates, undefined, 'an upload type that never carries it must not gain one');
  const one = await driveSlicer(500, [{ unreadableDates: { count: 2, examples: ['a', 'b'] } }]);
  assert.deepEqual(one.unreadableDates, { count: 2, examples: ['a', 'b'] }, 'a file small enough for one request carries its own through');
  const clean = await driveSlicer(5000, [{ unreadableDates: { count: 0, examples: [] } }]);
  assert.equal(clean.unreadableDates.count, 0, 'a file that read in full says 0');
});
test('the Done message says it in both languages, from the file\'s total, only when something was lost', () => {
  const src = readFileSync(PUBLIC + 'upload.html', 'utf8');
  const i = src.indexOf('A DATE THE SYSTEM COULD NOT READ IS SAID');
  assert.ok(i > 0, 'the page carries the sentence');
  const block = src.slice(i, i + 1800);
  assert.match(block, /res\.body\.unreadableDates && res\.body\.unreadableDates\.count/, 'only when a count is not zero');
  assert.match(block, /ANGALIA: tarehe /);
  assert.match(block, /WARNING: '? ?\+? ?res\.body\.unreadableDates\.count|WARNING: ' \+ res\.body\.unreadableDates\.count/);
  assert.match(block, /no date was guessed/);
  assert.match(block, /hakuna tarehe iliyokisiwa/);
});
