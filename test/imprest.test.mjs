// Imprest: request, GM decision (portal and the one-tap email link), accountant funding,
// retirement, report. Clock pinned to Friday 2026-07-24 noon EAT, matching portal.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');
const { imprestActionToken, imprestVerifyToken, imprestActionRow } = await import('../api/_lib/imprest.js');
const { _setFetch, sendMail } = await import('../api/_lib/mail.js');

const NOW = Date.parse('2026-07-24T09:00:00Z');
const TODAY = '2026-07-24';

const GM = { code: 'GM1', name: 'THE GM', role: 'GM', teams: null, tabs: ['impappr'] };
const REP = { code: 'AC1', name: 'THE ACCOUNTANT', role: 'FINANCE', teams: null, tabs: ['imprep'] };
const STAFF = { code: 'S1', name: 'JOHN OFFICER', role: 'FIELD', teams: null, tabs: ['impreq'] };
const STAFF2 = { code: 'S2', name: 'MARY OFFICER', role: 'FIELD', teams: null, tabs: ['impreq'] };
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] };
const AUDITOR = { code: 'AUD', name: 'THE AUDITOR', role: 'AUDITOR', teams: null,
  tabs: ['impreq', 'impappr', 'imprep'], readOnly: true };
const NOTAB = { code: 'X', name: 'NOBODY', role: 'NOTHING', teams: null, tabs: [] };

function tables() {
  return {
    access_codes: [
      { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] },
      { code: 'GM1', name: 'THE GM', role: 'GM', teams: null, tabs: ['impappr'] },
    ],
    roles: [],
    settings: [
      { key: 'IMPREST_GM_EMAIL', value: 'gm@hope.example' },
      { key: 'APP_BASE_URL', value: 'https://hope-pmo-v2.example.vercel.app' },
      { key: 'EMAIL_FROM', value: 'HOPE PMO <notices@hope.example>' },
    ],
    imprest_roles: [
      { role: 'FIELD OFFICER', accommodation_per_day: 20000, updated_by: 'A', updated_at: TODAY + 'T00:00:00Z' },
    ],
    imprest_requests: [],
    imprest_retirements: [],
    imprest_photos: [],
  };
}
const db_ = t => fakeDb(t || tables());

/* A fake image, small enough to be a receipt and no smaller -- exactly IMP_PHOTO_MIN_BYTES's
   worth of base64 padding, which is all imprestRetire actually checks. */
const RECEIPT = 'data:image/jpeg;base64,' + '/9j/'.repeat(400);

let lastMail = null;
_setFetch(async (url, opts) => {
  lastMail = { url, body: JSON.parse(opts.body) };
  return { ok: true, json: async () => ({ id: 'mail-' + (++_setFetch._n || (_setFetch._n = 1)) } ) };
});

test.beforeEach(() => { process.env.RESEND_API_KEY = 'test-resend-key'; process.env.IMPREST_LINK_SECRET = 'test-link-secret'; lastMail = null; });

/* ===================================================================== RATES */
test('a rate is saved, listed, and stamped onto a request -- never trusted from the form', async () => {
  const db = db_();
  const saved = await portalApi(db, GM, 'imprestRoleSave', { role: 'driver', rate: 15000 }, NOW);
  assert.equal(saved.role, 'DRIVER');
  const list = await portalApi(db, STAFF, 'imprestRoles', {}, NOW);
  assert.ok(list.roles.some(r => r.role === 'DRIVER' && r.rate === 15000));

  const r = await portalApi(db, STAFF, 'imprestRequest', {
    fullName: 'John', email: 'john@x.com', imprestRole: 'driver', travelDate: TODAY,
    purpose: 'site visit', accomDays: 2,
  }, NOW);
  assert.equal(r.accomRate, 15000, 'the server\'s own rate wins, whatever the form said');

  await portalApi(db, GM, 'imprestRoleDelete', { role: 'driver' }, NOW);
  const list2 = await portalApi(db, STAFF, 'imprestRoles', {}, NOW);
  assert.ok(!list2.roles.some(r => r.role === 'DRIVER'));
});

test('a role with no rate refuses the request rather than pricing nights at zero', async () => {
  const db = db_();
  await assert.rejects(portalApi(db, STAFF, 'imprestRequest', {
    fullName: 'John', email: 'john@x.com', imprestRole: 'unrated role', travelDate: TODAY,
    purpose: 'x', fareTrips: 1, farePerTrip: 5000,
  }, NOW), /hauna kiwango|has no rate/);
});

/* ===================================================================== THE ASK */
test('the request is costed from its parts, and refuses what it must', async () => {
  const db = db_();
  const r = await portalApi(db, STAFF, 'imprestRequest', {
    fullName: 'John', email: 'john@x.com', imprestRole: 'field officer', travelDate: TODAY,
    destination: 'MTWARA', purpose: 'client visit',
    fareTrips: 2, farePerTrip: 12000, accomDays: 3,
    other1Desc: 'fuel', other1Amount: 5000,
  }, NOW);
  // fare 2*12000=24000, accom 3*20000=60000, other 5000 -> 89000
  assert.equal(r.total, 89000);
  assert.equal(r.emailed, true, 'the GM copy went out');

  await assert.rejects(portalApi(db, STAFF, 'imprestRequest', {
    fullName: '', email: 'john@x.com', imprestRole: 'field officer', travelDate: TODAY, purpose: 'x',
  }, NOW), /jina kamili|full name/);

  await assert.rejects(portalApi(db, STAFF, 'imprestRequest', {
    fullName: 'John', email: 'not-an-email', imprestRole: 'field officer', travelDate: TODAY, purpose: 'x',
  }, NOW), /barua pepe|valid email/);

  await assert.rejects(portalApi(db, STAFF, 'imprestRequest', {
    fullName: 'John', email: 'john@x.com', imprestRole: 'field officer', travelDate: TODAY, purpose: 'x',
  }, NOW), /gharama yoyote|no costs/, 'zero-cost requests are refused');

  await assert.rejects(portalApi(db, STAFF, 'imprestRequest', {
    fullName: 'John', email: 'john@x.com', imprestRole: 'field officer', travelDate: TODAY, purpose: 'x',
    other1Amount: 5000,
  }, NOW), /Eleza gharama|Describe other expense/, 'an amount with no description is refused');
});

test('my history shows only my own requests', async () => {
  const db = db_();
  await portalApi(db, STAFF, 'imprestRequest', { fullName: 'John', email: 'j@x.com',
    imprestRole: 'field officer', travelDate: TODAY, purpose: 'x', accomDays: 1 }, NOW);
  await portalApi(db, STAFF2, 'imprestRequest', { fullName: 'Mary', email: 'm@x.com',
    imprestRole: 'field officer', travelDate: TODAY, purpose: 'y', accomDays: 1 }, NOW);
  const mine = await portalApi(db, STAFF, 'imprestMine', {}, NOW);
  assert.equal(mine.rows.length, 1);
  assert.equal(mine.rows[0].fullName, 'John');
  assert.ok(mine.rows[0].mine);
});

/* ===================================================================== THE GM'S DECISION */
async function askOne(db, user = STAFF, extra = {}) {
  return portalApi(db, user, 'imprestRequest', { fullName: user.name, email: 's@x.com',
    imprestRole: 'field officer', travelDate: TODAY, purpose: 'trip', accomDays: 1, ...extra }, NOW);
}

test('the queue counts, and the decision approves at or under what was asked', async () => {
  const db = db_();
  const r = await askOne(db);
  const q = await portalApi(db, GM, 'imprestQueue', { state: 'pending' }, NOW);
  assert.equal(q.counts.pending, 1);
  assert.equal(q.rows[0].id, r.id);

  const d = await portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true, approvedAmount: 15000 }, NOW);
  assert.equal(d.status, 'approved');
  assert.equal(d.granted, 15000);
  assert.equal(d.emailed.requester, true);

  await assert.rejects(portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true }, NOW),
    /tayari limeamuliwa|already been decided/);
});

test('approving more than was asked is refused, and a rejection needs a reason', async () => {
  const db = db_();
  const r = await askOne(db);
  await assert.rejects(portalApi(db, GM, 'imprestDecide',
    { id: r.id, approve: true, approvedAmount: 999999 }, NOW), /zaidi ya kilichoombwa|more than was requested/);
  await assert.rejects(portalApi(db, GM, 'imprestDecide', { id: r.id, approve: false }, NOW),
    /sababu ya kukataa|comment is required/);
  const d = await portalApi(db, GM, 'imprestDecide', { id: r.id, approve: false, comment: 'no budget' }, NOW);
  assert.equal(d.status, 'rejected');
});

test('two decisions racing on the same request cannot both win', async () => {
  const db = db_();
  const r = await askOne(db);
  const [a, b] = await Promise.allSettled([
    portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true }, NOW),
    portalApi(db, GM, 'imprestDecide', { id: r.id, approve: false, comment: 'x' }, NOW),
  ]);
  const outcomes = [a, b].map(x => x.status);
  assert.deepEqual(outcomes.sort(), ['fulfilled', 'rejected']);
});

test('a request must hold impreq, and a decision must hold impappr -- ADMIN needs neither', async () => {
  const db = db_();
  await assert.rejects(portalApi(db, NOTAB, 'imprestRequest', { fullName: 'X', email: 'x@x.com',
    imprestRole: 'field officer', travelDate: TODAY, purpose: 'x', accomDays: 1 }, NOW), /Ukurasa huu haujafunguliwa|not open to your role/);
  const r = await askOne(db, ADMIN);
  await assert.rejects(portalApi(db, NOTAB, 'imprestDecide', { id: r.id, approve: true }, NOW),
    /Ukurasa huu haujafunguliwa|not open to your role/);
  const d = await portalApi(db, ADMIN, 'imprestDecide', { id: r.id, approve: true }, NOW);
  assert.equal(d.status, 'approved', 'ADMIN holds every tab without being ticked for it');
});

test('a read-only code sees the imprest panes but cannot write to any of them', async () => {
  const db = db_();
  const r = await askOne(db, STAFF);
  // AUDITOR reads through resolveTabs's USER_TABS grant (impreq/impappr/imprep all included).
  const mine = await portalApi(db, AUDITOR, 'imprestMine', {}, NOW);
  assert.ok(mine.notReady !== true, 'the pane opens for a read-only code');
  await assert.rejects(portalApi(db, AUDITOR, 'imprestRequest', { fullName: 'X', email: 'x@x.com',
    imprestRole: 'field officer', travelDate: TODAY, purpose: 'x', accomDays: 1 }, NOW), /kuangalia tu|view-only/);
  await assert.rejects(portalApi(db, AUDITOR, 'imprestDecide', { id: r.id, approve: true }, NOW), /kuangalia tu|view-only/);
});

/* ===================================================================== THE ONE-TAP EMAIL PATH */
test('the email-link user decides through the exact same function, and the row says how', async () => {
  const db = db_();
  const r = await askOne(db);
  // The synthetic user api/imprest-action.js constructs after a token checks out.
  const emailUser = { code: 'imprest-link', name: 'GM (email link)', role: 'GM-EMAIL-LINK', teams: null, tabs: ['impappr'] };
  const d = await portalApi(db, emailUser, 'imprestDecide', { id: r.id, approve: true, viaEmail: true }, NOW);
  assert.equal(d.status, 'approved');
  const row = await imprestActionRow(db, r.id);
  assert.equal(row.decidedViaEmail, true);
  assert.match(row.decidedBy, /GM \(email link\)/);
});

test('the portal decision leaves decided_via_email false', async () => {
  const db = db_();
  const r = await askOne(db);
  await portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true }, NOW);
  const row = await imprestActionRow(db, r.id);
  assert.equal(row.decidedViaEmail, false);
});

test('the action token is per-request, tamper-evident, and absent without a secret', async () => {
  const t1 = imprestActionToken('id-1');
  const t2 = imprestActionToken('id-2');
  assert.ok(t1 && t2 && t1 !== t2);
  assert.equal(imprestVerifyToken('id-1', t1), true);
  assert.equal(imprestVerifyToken('id-1', t2), false, 'a token for a different id must not verify');
  assert.equal(imprestVerifyToken('id-1', t1 + 'x'), false);
  delete process.env.IMPREST_LINK_SECRET;
  assert.equal(imprestActionToken('id-1'), null);
  assert.equal(imprestVerifyToken('id-1', t1), false, 'no secret configured means no link can ever verify');
  process.env.IMPREST_LINK_SECRET = 'test-link-secret';
});

test('the new-request email carries the decide link and the portal link when both settings are set', async () => {
  const db = db_();
  await askOne(db);
  assert.ok(lastMail, 'a mail was sent');
  assert.match(lastMail.body.html, /\/api\/imprest-action\?id=/);
  assert.match(lastMail.body.html, /\/\?imp=/);
});

test('a request still files, and says so, when email is not configured at all', async () => {
  delete process.env.RESEND_API_KEY;
  const db = db_();
  const r = await askOne(db);
  assert.equal(r.emailed, false);
  assert.match(r.emailNote, /RESEND_API_KEY/);
  process.env.RESEND_API_KEY = 'test-resend-key';
});

/* ===================================================================== RETIREMENT */
test('an approved request is retired once, with a receipt, and its balance follows the sign', async () => {
  const db = db_();
  const r = await askOne(db, STAFF, { accomDays: 2 }); // 2*20000 = 40000
  await portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true, approvedAmount: 40000 }, NOW);

  await assert.rejects(portalApi(db, STAFF, 'imprestRetire',
    { id: r.id, accomActual: 40000, photos: [] }, NOW), /picha moja ya risiti|receipt photo/);

  const ret = await portalApi(db, STAFF, 'imprestRetire',
    { id: r.id, accomActual: 30000, photos: [RECEIPT] }, NOW);
  assert.equal(ret.total, 30000);
  assert.equal(ret.balance, 10000, 'spent less than approved -- the traveller returns the difference');

  await assert.rejects(portalApi(db, STAFF, 'imprestRetire',
    { id: r.id, accomActual: 30000, photos: [RECEIPT] }, NOW), /tayari lina retirement|already been retired/);

  const photos = await portalApi(db, STAFF, 'imprestPhotos', { id: r.id }, NOW);
  assert.equal(photos.photos.length, 1);
});

test('retirement is refused for a pending or someone else\'s request', async () => {
  const db = db_();
  const r = await askOne(db, STAFF, { accomDays: 1 });
  await assert.rejects(portalApi(db, STAFF, 'imprestRetire',
    { id: r.id, accomActual: 1000, photos: [RECEIPT] }, NOW), /idhinishwa tu|approved request/);
  await portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true }, NOW);
  await assert.rejects(portalApi(db, STAFF2, 'imprestRetire',
    { id: r.id, accomActual: 1000, photos: [RECEIPT] }, NOW), /Ombi halipo|no longer exists/);
});

/* ===================================================================== REPORT AND FUNDING */
test('the report totals separate pending, approved, funded and retired money', async () => {
  const db = db_();
  const r1 = await askOne(db, STAFF, { accomDays: 1 });      // 20000
  const r2 = await askOne(db, STAFF2, { accomDays: 2 });     // 40000
  await portalApi(db, GM, 'imprestDecide', { id: r1.id, approve: true }, NOW);
  await portalApi(db, GM, 'imprestDecide', { id: r2.id, approve: false, comment: 'no' }, NOW);
  await portalApi(db, REP, 'imprestFund', { id: r1.id, amount: 20000 }, NOW);

  const rep = await portalApi(db, REP, 'imprestReport', {}, NOW);
  assert.equal(rep.totals.count, 2);
  assert.equal(rep.totals.approved, 1);
  assert.equal(rep.totals.rejected, 1);
  assert.equal(rep.totals.approvedAmount, 20000);
  assert.equal(rep.totals.funded, 1);
  assert.equal(rep.totals.fundedAmount, 20000);
  assert.equal(rep.totals.toRetire, 1);
});

test('funding is written on an approved row, as many times as it needs correcting, and refused elsewhere', async () => {
  const db = db_();
  const r = await askOne(db, STAFF, { accomDays: 1 });
  await assert.rejects(portalApi(db, REP, 'imprestFund', { id: r.id, amount: 5000 }, NOW),
    /maombi yaliyoidhinishwa tu|only be recorded against an approved/);
  await portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true }, NOW);
  await portalApi(db, REP, 'imprestFund', { id: r.id, amount: 10000 }, NOW);
  await portalApi(db, REP, 'imprestFund', { id: r.id, amount: 20000 }, NOW);
  const rep = await portalApi(db, REP, 'imprestReport', {}, NOW);
  assert.equal(rep.rows.find(x => x.id === r.id).fundedAmount, 20000, 'the later figure wins -- a part-payment followed by the rest is ordinary');
});

/* ===================================================================== MAIL, STANDALONE */
test('sendMail resolves without throwing, either way, and never talks to the real network here', async () => {
  const db = fakeDb({ settings: [{ key: 'EMAIL_FROM', value: 'X <a@b.com>' }] });
  delete process.env.RESEND_API_KEY;
  const off = await sendMail(db, { to: 'x@y.com', subject: 'hi', html: '<p>hi</p>' });
  assert.equal(off.sent, false);
  process.env.RESEND_API_KEY = 'test-resend-key';
  const on = await sendMail(db, { to: 'x@y.com', subject: 'hi', html: '<p>hi</p>' });
  assert.equal(on.sent, true);
});
