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

/* "It must be of existing and of user logged in" / "I fill the days for Accommodation, jumla
   doesn't count and submit button doesn't work": the signed-in code's own role is accepted
   before the approver has priced it, for a trip without nights; nights still wait on the rate. */
test('the requester\'s own unpriced role: a trip without nights goes through, nights wait on the approver, another unpriced role is still refused', async () => {
  const db = db_();
  const r = await portalApi(db, STAFF, 'imprestRequest', {
    fullName: 'John', email: 'john@x.com', imprestRole: 'field', travelDate: TODAY,
    purpose: 'fuel run', fareTrips: 1, farePerTrip: 5000,
  }, NOW);
  assert.equal(r.total, 5000);
  assert.equal(r.accomRate, 0, 'stamped at zero, never invented');
  const mine = await portalApi(db, STAFF, 'imprestMine', {}, NOW);
  assert.equal(mine.rows[0].imprestRole, 'FIELD', 'the row carries the role as the code holds it');
  await assert.rejects(portalApi(db, STAFF2, 'imprestRequest', {
    fullName: 'Mary', email: 'mary@x.com', imprestRole: 'field', travelDate: TODAY,
    purpose: 'x', fareTrips: 1, farePerTrip: 5000, accomDays: 2,
  }, NOW), /hauna kiwango cha malazi bado|no nightly rate yet/, 'nights on an unpriced own role are refused, in the words the form repeats');
  await assert.rejects(portalApi(db, STAFF2, 'imprestRequest', {
    fullName: 'Mary', email: 'mary@x.com', imprestRole: 'gm', travelDate: TODAY,
    purpose: 'x', fareTrips: 1, farePerTrip: 5000,
  }, NOW), /hauna kiwango bado|has no rate yet/, 'somebody else\'s unpriced role is no way in');
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

/* ONE IMPREST AT A TIME -- "No more imprest requests with pending retirements per user ...
   tell them to retire previous approved imprests first!" Approved and unretired blocks the next
   ask; pending does not (no money has left), and the page says the same thing the refusal says. */
test('a new request is refused while an approved imprest is unretired, and allowed again once it is', async () => {
  const db = db_();
  const ask = extra => portalApi(db, STAFF, 'imprestRequest', { fullName: 'John', email: 'j@x.com',
    imprestRole: 'field officer', travelDate: TODAY, destination: 'MTWARA', purpose: 'x', accomDays: 2, ...extra }, NOW);
  const first = await ask();
  // Pending is not a debt: a second ask while the first waits on the GM goes through.
  const second = await ask({ destination: 'LINDI' });
  let mine = await portalApi(db, STAFF, 'imprestMine', {}, NOW);
  assert.deepEqual(mine.unretired, [], 'nothing owed while both are pending');
  assert.equal(mine.unretiredNote, '');

  await portalApi(db, GM, 'imprestDecide', { id: first.id, approve: true, approvedAmount: 40000 }, NOW);
  await assert.rejects(ask({ destination: 'TANGA' }), /bila retirement[\s\S]*Retire hiyo kwanza[\s\S]*not yet retired/,
    'approved and unretired: the next request is refused, and told why');
  mine = await portalApi(db, STAFF, 'imprestMine', {}, NOW);
  assert.deepEqual(mine.unretired, [first.id], 'the page is told which one is owed');
  assert.match(mine.unretiredNote, /MTWARA/);
  assert.match(mine.unretiredNote, /40,000/, 'the approved amount, not the asked one');
  // Somebody else is not blocked by John's debt.
  await portalApi(db, STAFF2, 'imprestRequest', { fullName: 'Mary', email: 'm@x.com',
    imprestRole: 'field officer', travelDate: TODAY, purpose: 'y', accomDays: 1 }, NOW);

  await portalApi(db, REP, 'imprestFund', { id: first.id, amount: 40000 }, NOW); // the retirement waits on Accounts (below)
  await portalApi(db, STAFF, 'imprestRetire', { id: first.id, accomActual: 30000, photos: [RECEIPT] }, NOW);
  const third = await ask({ destination: 'TANGA' });
  assert.ok(third.id, 'retired: the gate opens again');
  mine = await portalApi(db, STAFF, 'imprestMine', {}, NOW);
  assert.deepEqual(mine.unretired, []);
  // The second (still pending) request being approved now closes the gate again.
  await portalApi(db, GM, 'imprestDecide', { id: second.id, approve: true }, NOW);
  await assert.rejects(ask(), /Retire hiyo kwanza|Retire the previous one first/);
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
  await portalApi(db, REP, 'imprestFund', { id: r.id, amount: 40000 }, NOW); // the retirement waits on Accounts (below)

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

/* FUNDED BEFORE RETIRED -- "someone shouldn't be able to make retirement unless the imprest was
   funded -- hit them with 'you have 3 unfunded imprests, check the account to record them funded
   before you make the retirement!'" The refusal counts the requester's own unfunded (approved,
   unretired) imprests; the page is told the same; 0 is a recorded figure and opens the door. */
test('a retirement waits on Accounts recording the funding: refused with the count of every unfunded imprest, open on 0', async () => {
  const t = tables();
  // Retired before this rule, the money never recorded: nothing of John's waits on it, so it is not counted.
  t.imprest_requests.push({ id: '00000000-0000-4000-8000-000000000001', staff_code: 'S1', staff_name: 'JOHN OFFICER',
    status: 'approved', approved_amount: 5000, travel_date: '2026-06-01', destination: 'OLD', requested_at: '2026-05-30T09:00:00Z',
    retired_at: '2026-06-02T09:00:00Z', retire_total: 5000, retire_balance: 0 });
  const db = db_(t);
  const ask = extra => portalApi(db, STAFF, 'imprestRequest', { fullName: 'John', email: 'j@x.com',
    imprestRole: 'field officer', travelDate: TODAY, purpose: 'x', accomDays: 1, ...extra }, NOW);
  const a = await ask({ destination: 'MTWARA' });
  const b = await ask({ destination: 'LINDI', travelDate: '2026-07-27' });
  await portalApi(db, GM, 'imprestDecide', { id: a.id, approve: true }, NOW);
  await portalApi(db, GM, 'imprestDecide', { id: b.id, approve: true }, NOW);

  await assert.rejects(portalApi(db, STAFF, 'imprestRetire', { id: a.id, accomActual: 20000, photos: [RECEIPT] }, NOW),
    /hazijarekodiwa kuwa zimelipwa[\s\S]*You have 2 unfunded imprests: check with Accounts to record them as funded before you file the retirement/,
    'refused, counting both -- not the one retired before the rule');
  let mine = await portalApi(db, STAFF, 'imprestMine', {}, NOW);
  assert.deepEqual(mine.unfunded, [a.id, b.id], 'the page is told which, by travel date');
  assert.match(mine.unfundedNote, /2 unfunded imprests/);
  assert.match(mine.unfundedNote, /MTWARA[\s\S]*LINDI/);
  assert.doesNotMatch(mine.unfundedNote, /OLD/);
  // The gate comes first: a form with no receipt is refused for the funding, not for the receipt.
  await assert.rejects(portalApi(db, STAFF, 'imprestRetire', { id: a.id, accomActual: 20000, photos: [] }, NOW), /unfunded/);

  await portalApi(db, REP, 'imprestFund', { id: a.id, amount: 0 }, NOW);
  const ret = await portalApi(db, STAFF, 'imprestRetire', { id: a.id, accomActual: 20000, photos: [RECEIPT] }, NOW);
  assert.equal(ret.total, 20000, '0 is a recorded figure: the retirement goes through');
  mine = await portalApi(db, STAFF, 'imprestMine', {}, NOW);
  assert.deepEqual(mine.unfunded, [b.id]);
  await assert.rejects(portalApi(db, STAFF, 'imprestRetire', { id: b.id, accomActual: 20000, photos: [RECEIPT] }, NOW),
    /haijarekodiwa kuwa imelipwa[\s\S]*You have 1 unfunded imprest: check with Accounts to record it as funded/,
    'singular, once one is left');
  // Mary's unfunded imprest is not John's debt.
  const m = await portalApi(db, STAFF2, 'imprestRequest', { fullName: 'Mary', email: 'm@x.com',
    imprestRole: 'field officer', travelDate: TODAY, purpose: 'y', accomDays: 1 }, NOW);
  await portalApi(db, GM, 'imprestDecide', { id: m.id, approve: true }, NOW);
  await portalApi(db, REP, 'imprestFund', { id: b.id, amount: 20000 }, NOW);
  await portalApi(db, STAFF, 'imprestRetire', { id: b.id, accomActual: 20000, photos: [RECEIPT] }, NOW);
  mine = await portalApi(db, STAFF, 'imprestMine', {}, NOW);
  assert.deepEqual(mine.unfunded, []); assert.equal(mine.unfundedNote, '');
  mine = await portalApi(db, STAFF2, 'imprestMine', {}, NOW);
  assert.deepEqual(mine.unfunded, [m.id]);
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

/* ===================================================================== PHONE NOTIFICATIONS
   "GM needs phone notifications whenever there is an imprest even if he logs in via browser" */
const { _setSend, vapidKeys, _resetKeys, topicsFor } = await import('../api/_lib/push.js');
let pushes = [], pushGone = null;
_setSend(async (sub, body, opts) => {
  pushes.push({ endpoint: sub.endpoint, body: JSON.parse(body), opts });
  if (pushGone && pushGone(sub.endpoint)) { const e = new Error('Gone'); e.statusCode = 410; throw e; }
  return { statusCode: 201 };
});
const SUB = n => ({ endpoint: 'https://push.example/' + n, keys: { p256dh: 'BPp256dh-' + n + '-xxxxxxxxxx', auth: 'authauth' + n } });
/* The fake copies its tables at construction, so the register is read back from the db itself. */
const subsOf = (db, code) => { const r = db._dump('settings').find(x => x.key === 'PUSH_SUB_' + code); return r ? JSON.parse(r.value) : []; };
test.beforeEach(() => { pushes = []; pushGone = null; });

test('push keys: derived from the deployment when none are set -- stable, a P-256 point; the explicit pair wins when given', () => {
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; _resetKeys();
  const k = vapidKeys();
  assert.ok(k && k.source === 'derived');
  assert.equal(Buffer.from(k.publicKey, 'base64url').length, 65, 'an uncompressed P-256 point');
  assert.equal(Buffer.from(k.privateKey, 'base64url').length, 32);
  assert.equal(vapidKeys().publicKey, k.publicKey, 'the same pair every time');
  process.env.VAPID_PUBLIC_KEY = 'pub'; process.env.VAPID_PRIVATE_KEY = 'priv'; _resetKeys();
  assert.equal(vapidKeys().source, 'env');
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; _resetKeys();
  assert.deepEqual(topicsFor(GM), ['IMPREST']); assert.deepEqual(topicsFor(REP), ['IMPREST_FUND']);
  assert.deepEqual(topicsFor(STAFF), ['IMPREST_MINE']); assert.deepEqual(topicsFor(NOTAB), []);
  assert.deepEqual(topicsFor(ADMIN), ['IMPREST', 'IMPREST_FUND', 'IMPREST_MINE']);
});

test('push: whoever holds an imprest pane subscribes from the bell, and hears only that pane\'s steps', async () => {
  const t = tables(); const db = db_(t);
  await assert.rejects(portalApi(db, NOTAB, 'pushSubscribe', { sub: SUB(1) }, NOW), /haujafunguliwa|not open to your role/);
  const key = await portalApi(db, GM, 'pushKey', {}, NOW);
  assert.ok(key.publicKey && key.devices === 0 && key.note === '');
  assert.deepEqual(key.topics, ['IMPREST']);
  assert.deepEqual((await portalApi(db, REP, 'pushKey', {}, NOW)).topics, ['IMPREST_FUND']);
  assert.deepEqual((await portalApi(db, STAFF, 'pushKey', {}, NOW)).topics, ['IMPREST_MINE']);
  // no topics named by the phone: everything the code may hear, decided by its tabs
  assert.deepEqual((await portalApi(db, STAFF, 'pushSubscribe', { sub: SUB(7) }, NOW)).topics, ['IMPREST_MINE']);
  assert.deepEqual(subsOf(db, 'S1')[0].topics, ['IMPREST_MINE']);
  const r = await portalApi(db, GM, 'pushSubscribe', { sub: SUB(1), topics: ['IMPREST'], ua: 'Chrome Android' }, NOW);
  assert.equal(r.devices, 1); assert.deepEqual(r.topics, ['IMPREST']);
  const rows = subsOf(db, 'GM1');
  assert.equal(rows.length, 1); assert.equal(rows[0].endpoint, SUB(1).endpoint); assert.deepEqual(rows[0].topics, ['IMPREST']);
  assert.equal(rows[0].ua, 'Chrome Android'); assert.ok(rows[0].at);
  // the same phone again replaces itself; a second phone sits beside it
  await portalApi(db, GM, 'pushSubscribe', { sub: SUB(1) }, NOW);
  await portalApi(db, GM, 'pushSubscribe', { sub: SUB(2) }, NOW);
  assert.equal(subsOf(db, 'GM1').length, 2);
  assert.equal((await portalApi(db, GM, 'pushKey', {}, NOW)).devices, 2);
  // malformed: refused, nothing written
  await assert.rejects(portalApi(db, GM, 'pushSubscribe', { sub: { endpoint: 'http://not-https', keys: {} } }, NOW), /haukueleweka|malformed/);
  // a topic the code may not hear is dropped; none left = refused
  await assert.rejects(portalApi(db, GM, 'pushSubscribe', { sub: SUB(3), topics: ['PAYROLL'] }, NOW), /Hakuna arifa|No notification topic/);
  assert.equal(subsOf(db, 'GM1').length, 2);
  // the view-only code may look, never switch
  await assert.rejects(portalApi(db, AUDITOR, 'pushSubscribe', { sub: SUB(4) }, NOW), /kuangalia tu|view-only/);
  // off again
  const u = await portalApi(db, GM, 'pushUnsubscribe', { endpoint: SUB(1).endpoint }, NOW);
  assert.equal(u.devices, 1);
  await portalApi(db, GM, 'pushUnsubscribe', { endpoint: SUB(2).endpoint }, NOW);
  assert.equal(subsOf(db, 'GM1').length, 0, 'the row goes when the last phone does');
  assert.ok(!db._dump('settings').some(x => x.key === 'PUSH_SUB_GM1'));
});

/* "I thought we allow notification even from app too" -- the HOPE Calls app registers as apk:<device> in the same register
   and is served a queue it polls (pushPending), since a WebView has no push service. */
test('push: the HOPE Calls app registers as apk:<device> and is served a queue instead of a push', async () => {
  const t = tables(); const db = db_(t);
  const APK = { endpoint: 'apk:a1b2c3d4e5f6' };
  await assert.rejects(portalApi(db, NOTAB, 'pushSubscribe', { sub: APK }, NOW), /haujafunguliwa|not open to your role/);
  const r = await portalApi(db, GM, 'pushSubscribe', { sub: APK, ua: 'HopeCalls/1.10' }, NOW);
  assert.equal(r.devices, 1); assert.deepEqual(r.topics, ['IMPREST']);
  assert.equal(subsOf(db, 'GM1')[0].kind, 'apk'); assert.equal(subsOf(db, 'GM1')[0].endpoint, APK.endpoint);
  await assert.rejects(portalApi(db, GM, 'pushSubscribe', { sub: { endpoint: 'apk:x' } }, NOW), /haukueleweka|malformed/, 'a device id too short to be one');
  // nothing queued yet; the poll says how often to ask: an approver's phone every two minutes
  let p = await portalApi(db, GM, 'pushPending', { since: 0 }, NOW);
  assert.deepEqual(p.items, []); assert.equal(p.interval, 120); assert.ok(p.now);
  // a request: no push service is involved, the alert lands in the code's queue, counted as sent
  const req = await askOne(db, STAFF, { destination: 'Mtwara' });
  assert.equal(req.pushed, 1); assert.equal(req.pushNote, '');
  assert.equal(pushes.length, 0, 'nothing went to a push service');
  const q = db._dump('settings').find(x => x.key === 'PUSH_Q_GM1');
  assert.ok(q, 'the queue row exists, one per code');
  p = await portalApi(db, GM, 'pushPending', { since: 0 }, NOW);
  assert.equal(p.items.length, 1);
  assert.match(p.items[0].title, /imprest/i); assert.match(p.items[0].body, /JOHN OFFICER/);
  assert.equal(p.items[0].url, '/dashboard?imp=' + req.id); assert.equal(p.items[0].tag, 'imprest-' + req.id);
  assert.ok(p.items[0].at && p.items[0].id);
  // the phone remembers the last `at` it drew: nothing comes twice, and the server writes nothing on a poll
  const before = JSON.stringify(db._dump('settings'));
  const later = await portalApi(db, GM, 'pushPending', { since: p.items[0].at }, NOW);
  assert.deepEqual(later.items, []);
  assert.equal(JSON.stringify(db._dump('settings')), before, 'a poll is a read');
  // a requester's phone asks every ten minutes; a code with no app registered is told not to ask at all
  await portalApi(db, STAFF, 'pushSubscribe', { sub: { endpoint: 'apk:s1s1s1s1' } }, NOW);
  assert.equal((await portalApi(db, STAFF, 'pushPending', {}, NOW)).interval, 600);
  assert.equal((await portalApi(db, REP, 'pushPending', {}, NOW)).interval, 0);
  await assert.rejects(portalApi(db, NOTAB, 'pushPending', {}, NOW), /haujafunguliwa|not open to your role/);
  // a browser and the app on the same code: the browser is pushed, the app is queued, both counted
  await portalApi(db, GM, 'pushSubscribe', { sub: SUB(1) }, NOW);
  const req2 = await askOne(db, STAFF, { destination: 'Lindi' });
  assert.equal(req2.pushed, 2); assert.equal(pushes.length, 1);
  assert.equal((await portalApi(db, GM, 'pushPending', { since: 0 }, NOW)).items.length, 2);
  // the Test button reaches the app's queue the same way
  const tst = await portalApi(db, GM, 'pushTest', {}, NOW);
  assert.equal(tst.sent, 2);
  assert.equal((await portalApi(db, GM, 'pushPending', { since: 0 }, NOW)).items.length, 3);
  // off: the app row goes like any other
  await portalApi(db, GM, 'pushUnsubscribe', { endpoint: APK.endpoint }, NOW);
  assert.ok(!subsOf(db, 'GM1').some(s => s.kind === 'apk'));
  assert.equal((await portalApi(db, GM, 'pushPending', {}, NOW)).interval, 0, 'no app registered: stop asking');
});

test('push: a new request buzzes every approver phone that is on -- and only those', async () => {
  const t = tables();
  t.access_codes.push({ code: 'GM2', name: 'SECOND GM', role: 'GM', teams: null, tabs: ['impappr'] });
  // a row subscribed to some other topic is never reached by this one
  t.settings.push({ key: 'PUSH_SUB_AC1', value: JSON.stringify([{ ...SUB(9), topics: ['OTHER'] }]) });
  const db = db_(t);
  await portalApi(db, GM, 'pushSubscribe', { sub: SUB(1) }, NOW);
  await portalApi(db, GM, 'pushSubscribe', { sub: SUB(2) }, NOW);
  await portalApi(db, { ...GM, code: 'GM2' }, 'pushSubscribe', { sub: SUB(3) }, NOW);
  const r = await askOne(db, STAFF, { destination: 'Mtwara' });
  assert.equal(r.pushed, 3); assert.equal(r.pushNote, '');
  assert.equal(pushes.length, 3);
  assert.deepEqual(pushes.map(p => p.endpoint).sort(), [SUB(1), SUB(2), SUB(3)].map(s => s.endpoint).sort());
  const b = pushes[0].body;
  assert.match(b.title, /imprest/i);
  assert.match(b.body, /JOHN OFFICER/); assert.match(b.body, /20,000 TZS/); assert.match(b.body, /Mtwara/);
  assert.equal(b.url, '/dashboard?imp=' + r.id, 'the tap lands on the request, as the email link does');
  assert.equal(b.tag, 'imprest-' + r.id);
  const v = pushes[0].opts.vapidDetails;
  assert.ok(v.publicKey && v.privateKey && /^(https:|mailto:)/.test(v.subject), 'signed, with a contact the push service can reach');
  assert.ok(pushes[0].opts.timeout <= 6000 && pushes[0].opts.TTL > 0, 'under a clock, with a shelf life');
  assert.equal(r.emailed, true, 'the email still goes too');
});

/* "Imprest push notifications to roles I choose only. There is a privacy concern." */
test('push: the approver narrows a broadcast topic to the roles chosen -- honoured where a phone subscribes, where the app polls, and when the alert is sent', async () => {
  const t = tables();
  t.access_codes.push({ code: 'OPS1', name: 'OPS LEAD', role: 'OPERATIONS', teams: null, tabs: ['impappr'] });
  const db = db_(t);
  const OPS = { code: 'OPS1', name: 'OPS LEAD', role: 'OPERATIONS', teams: null, tabs: ['impappr'] };
  // open by default: the GM, the operations lead and the admin all hear a new request
  assert.deepEqual((await portalApi(db, GM, 'pushPolicy', {}, NOW)).policy, { IMPREST: null, IMPREST_FUND: null });
  await portalApi(db, GM, 'pushSubscribe', { sub: SUB(1) }, NOW);
  await portalApi(db, OPS, 'pushSubscribe', { sub: SUB(2) }, NOW);
  await portalApi(db, ADMIN, 'pushSubscribe', { sub: SUB(3) }, NOW);
  await portalApi(db, OPS, 'pushSubscribe', { sub: { endpoint: 'apk:ops-device-1' } }, NOW);
  assert.equal((await askOne(db, STAFF)).pushed, 4, 'three browsers and one app queue');
  pushes = [];
  // narrowed to the GM alone
  const saved = await portalApi(db, GM, 'pushPolicySave', { policy: { IMPREST: ['gm'], IMPREST_FUND: null } }, NOW);
  assert.deepEqual(saved.policy, { IMPREST: ['GM'], IMPREST_FUND: null }, 'kept in the registry\'s spelling');
  assert.deepEqual((await portalApi(db, GM, 'pushKey', {}, NOW)).topics, ['IMPREST']);
  assert.deepEqual((await portalApi(db, OPS, 'pushKey', {}, NOW)).topics, [], 'a role left out is offered nothing');
  assert.deepEqual((await portalApi(db, ADMIN, 'pushKey', {}, NOW)).topics, ['IMPREST_FUND', 'IMPREST_MINE'], 'ADMIN too is left out of a narrowed topic unless ticked');
  await assert.rejects(portalApi(db, OPS, 'pushSubscribe', { sub: SUB(5) }, NOW), /Hakuna arifa|No notification topic/);
  assert.equal((await portalApi(db, OPS, 'pushPending', { since: 0 }, NOW)).interval, 0, 'the app stops polling for a role that hears nothing');
  const r = await askOne(db, STAFF2);
  assert.equal(r.pushed, 1, 'phones registered before the change are narrowed at send time');
  assert.deepEqual(pushes.map(p => p.endpoint), [SUB(1).endpoint]);
  const q = db._dump('settings').find(x => x.key === 'PUSH_Q_OPS1');
  assert.equal(JSON.parse(q.value).length, 1, 'the app queue of a role left out gets nothing new');
  // an empty list silences the topic, and the answer says so
  pushes = [];
  await portalApi(db, GM, 'pushPolicySave', { policy: { IMPREST: [] } }, NOW);
  const quiet = await askOne(db, { ...STAFF, code: 'S3', name: 'THIRD' });
  assert.equal(quiet.pushed, 0); assert.match(quiet.pushNote, /wadhifa uliochaguliwa|chosen role/);
  // back to everyone holding the pane
  await portalApi(db, GM, 'pushPolicySave', { policy: { IMPREST: null } }, NOW);
  assert.deepEqual((await portalApi(db, OPS, 'pushKey', {}, NOW)).topics, ['IMPREST']);
  // the requester's own steps are never a broadcast and never narrowed
  assert.deepEqual(topicsFor(STAFF, { IMPREST: [], IMPREST_FUND: [] }), ['IMPREST_MINE']);
  await assert.rejects(portalApi(db, GM, 'pushPolicySave', { policy: { IMPREST_MINE: ['GM'] } }, NOW), /isiyojulikana|Unknown topic/);
  // who may: the approval pane; never a view-only code, which may still look
  await assert.rejects(portalApi(db, STAFF, 'pushPolicySave', { policy: { IMPREST: ['GM'] } }, NOW), /haujafunguliwa|not open to your role/);
  await assert.rejects(portalApi(db, AUDITOR, 'pushPolicySave', { policy: { IMPREST: ['GM'] } }, NOW), /kuangalia tu|view-only/);
  assert.ok((await portalApi(db, AUDITOR, 'pushPolicy', {}, NOW)).policy);
});

test('push: nothing on = nothing sent, said in the answer; a phone the service says is gone is dropped', async () => {
  const t = tables(); const db = db_(t);
  const quiet = await askOne(db);
  assert.equal(quiet.pushed, 0); assert.match(quiet.pushNote, /hakuna simu|no phone/);
  assert.equal(pushes.length, 0);
  await portalApi(db, GM, 'pushSubscribe', { sub: SUB(1) }, NOW);
  await portalApi(db, GM, 'pushSubscribe', { sub: SUB(2) }, NOW);
  pushGone = ep => ep === SUB(1).endpoint;
  const r = await askOne(db, STAFF2);
  assert.equal(r.pushed, 1); assert.match(r.pushNote, /410/, 'one reached, one not -- and the answer says so');
  assert.deepEqual(subsOf(db, 'GM1').map(s => s.endpoint), [SUB(2).endpoint], 'the gone phone is dropped, the live one kept');
  // a push service that simply errors is reported, and the phone is kept
  _setSend(async () => { const e = new Error('ECONNRESET'); throw e; });
  const r2 = await askOne(db, { ...STAFF, code: 'S3', name: 'THIRD' });
  assert.equal(r2.pushed, 0); assert.match(r2.pushNote, /ECONNRESET/);
  assert.equal(subsOf(db, 'GM1').length, 1);
  _setSend(async (sub, body, opts) => { pushes.push({ endpoint: sub.endpoint, body: JSON.parse(body), opts }); return { statusCode: 201 }; });
});

test('push: every step after the ask -- the decision and the funding reach the requester, an approval and a retirement the accountant, a retirement the approver', async () => {
  const db = db_();
  await portalApi(db, GM, 'pushSubscribe', { sub: SUB(1) }, NOW);       // approver
  await portalApi(db, REP, 'pushSubscribe', { sub: SUB(2) }, NOW);      // accountant
  await portalApi(db, STAFF, 'pushSubscribe', { sub: SUB(3) }, NOW);    // requester
  await portalApi(db, STAFF2, 'pushSubscribe', { sub: SUB(4) }, NOW);   // another requester
  const r = await askOne(db);
  assert.deepEqual(pushes.map(p => p.endpoint), [SUB(1).endpoint], 'the ask: the approver only');
  // a rejection reaches its requester alone, with the reason
  const rj = await askOne(db, STAFF2);
  pushes = [];
  const dR = await portalApi(db, GM, 'imprestDecide', { id: rj.id, approve: false, comment: 'no budget' }, NOW);
  assert.equal(dR.pushed, 1); assert.deepEqual(pushes.map(p => p.endpoint), [SUB(4).endpoint]);
  assert.match(pushes[0].body.title, /imekataliwa|rejected/); assert.match(pushes[0].body.body, /no budget/);
  // an approval reaches the requester and the accountant
  pushes = [];
  const dA = await portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true, approvedAmount: 15000 }, NOW);
  assert.equal(dA.pushed, 2); assert.equal(dA.pushNote, '');
  assert.deepEqual(pushes.map(p => p.endpoint).sort(), [SUB(2).endpoint, SUB(3).endpoint].sort());
  const toReq = pushes.find(p => p.endpoint === SUB(3).endpoint), toAcc = pushes.find(p => p.endpoint === SUB(2).endpoint);
  assert.match(toReq.body.title, /imeidhinishwa|approved/); assert.match(toReq.body.body, /15,000 TZS/);
  assert.match(toAcc.body.title, /inasubiri kutolewa|to be funded/); assert.match(toAcc.body.body, /JOHN OFFICER/);
  assert.ok(pushes.every(p => p.body.url === '/dashboard?imp=' + r.id), 'every tap lands on the request');
  // the funding reaches the requester
  pushes = [];
  const f = await portalApi(db, REP, 'imprestFund', { id: r.id, amount: 15000 }, NOW);
  assert.equal(f.pushed, 1); assert.deepEqual(pushes.map(p => p.endpoint), [SUB(3).endpoint]);
  assert.match(pushes[0].body.title, /imetolewa|funded/); assert.match(pushes[0].body.body, /15,000 TZS/);
  // the retirement reaches the approver and the accountant, not the requester
  pushes = [];
  const ret = await portalApi(db, STAFF, 'imprestRetire', { id: r.id, accomActual: 12000, photos: [RECEIPT] }, NOW);
  assert.equal(ret.pushed, 2);
  assert.deepEqual(pushes.map(p => p.endpoint).sort(), [SUB(1).endpoint, SUB(2).endpoint].sort());
  assert.match(pushes[0].body.title, /Retirement/); assert.match(pushes[0].body.body, /12,000 TZS/); assert.match(pushes[0].body.body, /3,000 TZS/);
  // a requester whose phone is off: the decision still stands, and the screen is told
  const r3 = await askOne(db, { ...STAFF, code: 'S3', name: 'THIRD' });
  const d3 = await portalApi(db, GM, 'imprestDecide', { id: r3.id, approve: true }, NOW);
  assert.equal(d3.status, 'approved'); assert.equal(d3.pushed, 1, 'the accountant still hears'); assert.match(d3.pushNote, /S3/);
});

test('push: the test button reaches this code\'s own phones only', async () => {
  const t = tables();
  t.settings.push({ key: 'PUSH_SUB_GM2', value: JSON.stringify([{ ...SUB(2), topics: ['IMPREST'] }]) });
  const db = db_(t);
  await assert.rejects(portalApi(db, GM, 'pushTest', {}, NOW), /haijasajiliwa|not subscribed/);
  await portalApi(db, GM, 'pushSubscribe', { sub: SUB(1) }, NOW);
  const r = await portalApi(db, GM, 'pushTest', {}, NOW);
  assert.equal(r.sent, 1); assert.equal(pushes.length, 1);
  assert.equal(pushes[0].endpoint, SUB(1).endpoint); assert.match(pushes[0].body.title, /jaribio|test/);
});

/* ===================================================================== THE OPM STEP
   "GMOs and Managers imprests shouldn't go to GM directly ... I select which roles pass through which at the
   imprest approvals tab ... their respective OPM finds their requests in the request tab, OPM confirms the request
   {may adjust amount with comment} - then it proceeds to the approval tab / GM" */
const GMO = { code: 'G1', name: 'JUMA GMO', role: 'GMO', teams: null, tabs: ['impreq'] };
const MGR = { code: 'M1', name: 'ZUBERI MANAGER', role: 'MANAGER', teams: null, tabs: ['impreq'] };
const OPM1 = { code: 'O1', name: 'ASHA OPM', role: 'OPM', teams: null, tabs: ['impreq'] };
const OPM2 = { code: 'O2', name: 'OTHER OPM', role: 'OPM', teams: null, tabs: ['impreq'] };
const GM_ROUTE = [{ from: ['GMO', 'MANAGER'], via: 'OPM' }];

function opmTables(extra) {
  const t = tables();
  t.access_codes.push(
    { code: 'G1', name: 'JUMA GMO', role: 'GMO', teams: null, tabs: ['impreq'] },
    { code: 'M1', name: 'ZUBERI MANAGER', role: 'MANAGER', teams: null, tabs: ['impreq'] },
    { code: 'O1', name: 'ASHA OPM', role: 'OPM', teams: null, tabs: ['impreq'] },
    { code: 'O2', name: 'OTHER OPM', role: 'OPM', teams: null, tabs: ['impreq'] });
  // Teams & Staff: Kongwe and Mikocheni are Juma's (GMO) and Asha is their OPM; Temeke is Zuberi's, also Asha's.
  t.teams = [
    { team: 'KONGWE', gmo: 'JUMA GMO', manager: 'ZUBERI MANAGER', credit: '', opm: 'ASHA OPM' },
    { team: 'MIKOCHENI', gmo: 'JUMA GMO', manager: 'ZUBERI MANAGER', credit: '', opm: 'ASHA OPM' },
    { team: 'ARUSHA', gmo: 'SOMEONE ELSE', manager: 'ANOTHER MANAGER', credit: '', opm: 'OTHER OPM' },
  ];
  if (extra) extra(t);
  return t;
}
async function routed(db) { await portalApi(db, GM, 'imprestRoutesSave', { routes: GM_ROUTE }, NOW); return db; }
const askAs = (db, user, extra) => portalApi(db, user, 'imprestRequest', { fullName: user.name, email: 'x@x.com',
  imprestRole: 'field officer', travelDate: TODAY, purpose: 'visit', fareTrips: 2, farePerTrip: 20000, ...extra }, NOW);

test('OPM step: the GM chooses which roles pass through which; a bad rule is refused, a good one is kept and listed', async () => {
  const db = db_(opmTables());
  const empty = await portalApi(db, GM, 'imprestRoutes', {}, NOW);
  assert.deepEqual(empty.routes, []); assert.ok(empty.roles.includes('GM'), 'the role names to pick from');
  const bad = rule => assert.rejects(portalApi(db, GM, 'imprestRoutesSave', { routes: rule }, NOW));
  await bad([{ from: ['GMO', 'OPM'], via: 'OPM' }]);                                  // a role through itself
  await bad([{ from: ['GMO'], via: 'OPM' }, { from: ['GMO'], via: 'CREDIT' }]);        // a role in two routes
  await bad([{ from: ['GMO'], via: 'OPM' }, { from: ['OPM'], via: 'CREDIT' }]);        // the via role is itself routed
  await bad([{ from: [], via: 'OPM' }]); await bad([{ from: ['GMO'], via: '' }]); await bad('nope');
  assert.deepEqual((await portalApi(db, GM, 'imprestRoutes', {}, NOW)).routes, [], 'nothing half-saved');
  const ok = await portalApi(db, GM, 'imprestRoutesSave', { routes: [{ from: ['gmo', 'manager', 'GMO'], via: 'opm' }] }, NOW);
  assert.deepEqual(ok.routes, GM_ROUTE, 'upper-cased and de-duplicated, as every role is held');
  assert.deepEqual((await portalApi(db, GM, 'imprestRoutes', {}, NOW)).routes, GM_ROUTE);
  assert.equal(db._dump('settings').find(x => x.key === 'IMPREST_ROUTES').value, JSON.stringify(GM_ROUTE));
  // the pane's holders only, and the read-only wall stands
  await assert.rejects(portalApi(db, STAFF, 'imprestRoutesSave', { routes: [] }, NOW), /ruhusa|not open|haujafunguliwa/i);
  await assert.rejects(portalApi(db, AUDITOR, 'imprestRoutesSave', { routes: [] }, NOW));
  assert.equal((await portalApi(db, GM, 'imprestRoutes', {}, NOW)).ready, true);
});

test('OPM step: a GMO\'s request waits for their OPM -- not in the GM\'s queue, not emailed, not buzzed -- and the OPM finds it in the Requests tab', async () => {
  const db = await routed(db_(opmTables()));
  const r = await askAs(db, GMO);
  assert.equal(r.routed.stage, 'opm'); assert.deepEqual(r.routed.names, ['ASHA OPM']);
  assert.equal(r.emailed, false); assert.equal(lastMail, null, 'the GM is not emailed yet');
  assert.equal(r.pushed, 0, 'no GM phone either (the OPM has no phone registered here)');
  // the GM's side: counted apart, listed only under "with the OPM", and cannot be decided while it waits
  const q = await portalApi(db, GM, 'imprestQueue', { state: 'pending' }, NOW);
  assert.equal(q.counts.pending, 0); assert.equal(q.counts.waiting, 1); assert.equal(q.rows.length, 0);
  assert.equal(q.routed, true);
  const w = await portalApi(db, GM, 'imprestQueue', { state: 'waiting' }, NOW);
  assert.deepEqual(w.rows.map(x => x.id), [r.id]); assert.equal(w.rows[0].stage, 'opm'); assert.equal(w.rows[0].routedNames, 'ASHA OPM');
  const all = await portalApi(db, GM, 'imprestQueue', {}, NOW);
  assert.equal(all.rows.length, 1, 'All still shows it, flagged');
  await assert.rejects(portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true }, NOW), /bado linasubiri OPM|still waiting for the OPM/);
  // the requester sees where it is
  const mine = await portalApi(db, GMO, 'imprestMine', {}, NOW);
  assert.equal(mine.rows[0].stage, 'opm'); assert.deepEqual(mine.confirm, [], 'a GMO confirms nobody');
  // the respective OPM finds it; the other OPM does not
  const opm = await portalApi(db, OPM1, 'imprestMine', {}, NOW);
  assert.deepEqual(opm.confirm.map(x => x.id), [r.id]); assert.equal(opm.confirm[0].total, 40000); assert.equal(opm.confirm[0].purpose, 'visit');
  assert.deepEqual((await portalApi(db, OPM2, 'imprestMine', {}, NOW)).confirm, [], 'another OPM\'s teams are not theirs');
  assert.deepEqual((await portalApi(db, STAFF, 'imprestMine', {}, NOW)).confirm, []);
  // the report counts it apart too
  const rep = await portalApi(db, REP, 'imprestReport', {}, NOW);
  assert.equal(rep.totals.waiting, 1);
});

test('OPM step: a Manager goes the same way, through the teams Teams & Staff gives them', async () => {
  const db = await routed(db_(opmTables()));
  const r = await askAs(db, MGR);
  assert.equal(r.routed.stage, 'opm'); assert.deepEqual(r.routed.names, ['ASHA OPM']);
  assert.deepEqual((await portalApi(db, OPM1, 'imprestMine', {}, NOW)).confirm.map(x => x.id), [r.id]);
});

test('OPM step: the OPM confirms -- lower with a comment, never higher -- and only then does it reach the GM, at the OPM\'s figure', async () => {
  const db = await routed(db_(opmTables()));
  const r = await askAs(db, GMO);
  await assert.rejects(portalApi(db, OPM2, 'imprestConfirm', { id: r.id }, NOW), /si la kuthibitisha na wewe|not yours to confirm/);
  await assert.rejects(portalApi(db, STAFF, 'imprestConfirm', { id: r.id }, NOW), /si la kuthibitisha na wewe|not yours to confirm/);
  await assert.rejects(portalApi(db, GMO, 'imprestConfirm', { id: r.id }, NOW), /si la kuthibitisha|not yours|mwenyewe|own/);
  await assert.rejects(portalApi(db, OPM1, 'imprestConfirm', { id: r.id, amount: 30000 }, NOW), /sababu|comment is required/, 'lowering needs a reason');
  await assert.rejects(portalApi(db, OPM1, 'imprestConfirm', { id: r.id, amount: 50000, comment: 'more' }, NOW), /zaidi ya kilichoombwa|more than was asked/);
  await assert.rejects(portalApi(db, OPM1, 'imprestConfirm', { id: r.id, amount: 0, comment: 'x' }, NOW));
  await assert.rejects(portalApi(db, GM, 'imprestConfirm', { id: r.id }, NOW), /ruhusa|not open|haujafunguliwa/i, 'the GM has the release, not the confirm');
  assert.equal(lastMail, null, 'nothing refused reached the GM');
  const c = await portalApi(db, OPM1, 'imprestConfirm', { id: r.id, amount: 30000, comment: 'two trips are enough' }, NOW);
  assert.equal(c.amount, 30000); assert.equal(c.asked, 40000); assert.equal(c.adjusted, true); assert.equal(c.emailed, true);
  assert.ok(lastMail, 'the GM is emailed now'); assert.match(lastMail.body.subject, /JUMA GMO/); assert.match(lastMail.body.subject, /30,000/);
  assert.match(lastMail.body.html, /ASHA OPM/); assert.match(lastMail.body.html, /two trips are enough/);
  const q = await portalApi(db, GM, 'imprestQueue', { state: 'pending' }, NOW);
  assert.equal(q.counts.pending, 1); assert.equal(q.counts.waiting, 0);
  assert.equal(q.rows[0].opmBy, 'ASHA OPM'); assert.equal(q.rows[0].opmAmount, 30000); assert.equal(q.rows[0].opmComment, 'two trips are enough');
  assert.equal(q.rows[0].total, 40000, 'what was asked stays on the row');
  assert.deepEqual((await portalApi(db, OPM1, 'imprestMine', {}, NOW)).confirm, [], 'it leaves the OPM\'s list');
  await assert.rejects(portalApi(db, OPM1, 'imprestConfirm', { id: r.id }, NOW), /halisubiri uthibitisho|no longer waiting/, 'confirmed once');
  // the GM approves at the OPM's figure by default, and may still go up to what was asked
  const d = await portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true }, NOW);
  assert.equal(d.status, 'approved'); assert.equal(d.granted, 30000, 'the OPM\'s figure is the default');
  assert.equal(db._dump('imprest_requests')[0].approved_amount, 30000);
});

test('OPM step: the GM may still approve up to what was asked, not above it, after the OPM lowered it', async () => {
  const db = await routed(db_(opmTables()));
  const r = await askAs(db, GMO);
  await portalApi(db, OPM1, 'imprestConfirm', { id: r.id, amount: 30000, comment: 'trim' }, NOW);
  await assert.rejects(portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true, approvedAmount: 45000 }, NOW));
  const d = await portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true, approvedAmount: 40000 }, NOW);
  assert.equal(d.granted, 40000);
});

test('OPM step: confirming at the asked amount needs no comment', async () => {
  const db = await routed(db_(opmTables()));
  const r = await askAs(db, GMO);
  const c = await portalApi(db, OPM1, 'imprestConfirm', { id: r.id }, NOW);
  assert.equal(c.amount, 40000); assert.equal(c.adjusted, false);
  const q = await portalApi(db, GM, 'imprestQueue', { state: 'pending' }, NOW);
  assert.equal(q.rows[0].opmAmount, 40000);
  assert.equal((await portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true }, NOW)).granted, 40000);
});

test('OPM step: the GM can release a waiting request (the OPM is away) and then decide it; nobody else can', async () => {
  const db = await routed(db_(opmTables()));
  const r = await askAs(db, GMO);
  await assert.rejects(portalApi(db, STAFF, 'imprestRelease', { id: r.id }, NOW), /ruhusa|not open|haujafunguliwa/i);
  await assert.rejects(portalApi(db, OPM1, 'imprestRelease', { id: r.id }, NOW), /ruhusa|not open|haujafunguliwa/i);
  assert.equal(lastMail, null);
  const rel = await portalApi(db, GM, 'imprestRelease', { id: r.id }, NOW);
  assert.equal(rel.emailed, true); assert.ok(lastMail, 'the GM is emailed at release, as at any arrival');
  const q = await portalApi(db, GM, 'imprestQueue', { state: 'pending' }, NOW);
  assert.equal(q.counts.pending, 1); assert.equal(q.counts.waiting, 0);
  assert.match(q.rows[0].routedNote, /THE GM/, 'the row says who released it');
  assert.equal(q.rows[0].opmBy, '');
  assert.deepEqual((await portalApi(db, OPM1, 'imprestMine', {}, NOW)).confirm, [], 'it leaves the OPM\'s list');
  await assert.rejects(portalApi(db, OPM1, 'imprestConfirm', { id: r.id }, NOW), /halisubiri uthibitisho|no longer waiting/);
  await assert.rejects(portalApi(db, GM, 'imprestRelease', { id: r.id }, NOW), /halisubiri OPM|not waiting for the OPM/);
  assert.equal((await portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true }, NOW)).granted, 40000);
});

test('OPM step: two OPMs confirming one request cannot both win', async () => {
  const db = await routed(db_(opmTables(t => { t.teams[1].opm = 'OTHER OPM'; })));   // Mikocheni is Other\'s, Kongwe is Asha\'s
  const r = await askAs(db, GMO);
  assert.deepEqual(r.routed.names.sort(), ['ASHA OPM', 'OTHER OPM']);
  const [a, b] = await Promise.allSettled([portalApi(db, OPM1, 'imprestConfirm', { id: r.id }, NOW), portalApi(db, OPM2, 'imprestConfirm', { id: r.id }, NOW)]);
  assert.deepEqual([a, b].map(x => x.status).sort(), ['fulfilled', 'rejected']);
});

test('OPM step: no OPM to be found is never a dead end -- it goes straight to the GM with the reason on it', async () => {
  // a GMO whose teams name an OPM who has no sign-in
  const db = await routed(db_(opmTables(t => { t.teams.forEach(x => { x.opm = 'ROGUE OPM'; }); })));
  const r = await askAs(db, GMO);
  assert.equal(r.routed.stage, 'gm'); assert.match(r.routed.note, /ROGUE OPM/);
  assert.equal(r.emailed, true); assert.ok(lastMail, 'the GM is emailed at once');
  const q = await portalApi(db, GM, 'imprestQueue', { state: 'pending' }, NOW);
  assert.equal(q.rows.length, 1); assert.equal(q.rows[0].stage, 'gm'); assert.match(q.rows[0].routedNote, /ROGUE OPM/);
  // a team whose OPM cell is a placeholder names nobody
  const db3 = await routed(db_(opmTables(t => { t.teams.forEach(x => { x.opm = 'NO OPM'; }); })));
  const r3 = await askAs(db3, GMO);
  assert.equal(r3.routed.stage, 'gm'); assert.match(r3.routed.note, /Hakuna OPM aliyetajwa|No OPM is named/);
  // a GMO on no team at all
  const db2 = await routed(db_(opmTables(t => { t.teams = []; })));
  const r2 = await askAs(db2, GMO);
  assert.equal(r2.routed.stage, 'gm'); assert.match(r2.routed.note, /Hakuna timu|No teams/);
});

test('OPM step: a role nobody routed asks exactly as before, and a route changed later never moves a request already waiting', async () => {
  const db = await routed(db_(opmTables()));
  const plain = await askAs(db, STAFF);
  assert.equal(plain.routed, null); assert.equal(plain.emailed, true); assert.ok(lastMail);
  assert.notEqual(db._dump('imprest_requests')[0].stage, 'opm', 'an unrouted request is never made to wait (the column defaults to gm)');
  lastMail = null;
  const r = await askAs(db, GMO);
  assert.equal(r.routed.stage, 'opm');
  const dropped = await portalApi(db, GM, 'imprestRoutesSave', { routes: [] }, NOW);   // the rule is dropped
  assert.equal(dropped.stranded, 1, 'the save says one request is still waiting for an OPM nobody routes to now');
  assert.deepEqual((await portalApi(db, OPM1, 'imprestMine', {}, NOW)).confirm, [], 'the OPM\'s list follows the rule in force...');
  const w = await portalApi(db, GM, 'imprestQueue', { state: 'waiting' }, NOW);
  assert.deepEqual(w.rows.map(x => x.id), [r.id], '...so the GM still sees it, stamped with its OPM, and can release it');
  assert.equal(w.rows[0].routedNames, 'ASHA OPM'); assert.equal(w.counts.waiting, 1);
  await portalApi(db, GM, 'imprestRelease', { id: r.id }, NOW);
  assert.equal((await portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true }, NOW)).granted, 40000);
  // a rule that still routes it strands nothing
  const db2 = await routed(db_(opmTables()));
  await askAs(db2, GMO);
  assert.equal((await portalApi(db2, GM, 'imprestRoutesSave', { routes: [{ from: ['GMO'], via: 'OPM' }] }, NOW)).stranded, 0);
});

test('OPM step: until the migration is run nothing breaks -- the request goes to the GM, and every screen says routing is not on', async () => {
  const missing = { imprest_requests: ['stage', 'routed_via', 'routed_names', 'routed_teams', 'routed_note', 'opm_by', 'opm_at', 'opm_amount', 'opm_comment'] };
  const db = fakeDb(opmTables(), { missingColumns: missing });
  await portalApi(db, GM, 'imprestRoutesSave', { routes: GM_ROUTE }, NOW);            // the rule itself lives in settings
  const r = await askAs(db, GMO);
  assert.equal(r.total, 40000, 'the request is written');
  assert.equal(r.emailed, true); assert.ok(lastMail, 'and it reaches the GM, as it did before routing existed');
  assert.match(r.routingNote, /RUN-ME-2026-11-05-imprest-opm-step/, 'the person who asked is told why it did not wait');
  // the database is known to lack the columns by now: the NEXT request is told too, not just the one that found out
  await portalApi(db, GM, 'imprestDecide', { id: r.id, approve: true }, NOW);
  const again = await askAs(db, MGR, { travelDate: '2026-07-25' });
  assert.match(again.routingNote, /RUN-ME-2026-11-05-imprest-opm-step/); assert.ok(again.emailed);
  const q = await portalApi(db, GM, 'imprestQueue', { state: 'pending' }, NOW);
  assert.equal(q.counts.waiting, 0); assert.equal(q.routed, false);
  assert.equal((await portalApi(db, GM, 'imprestRoutes', {}, NOW)).ready, false, 'the routing card can say so');
  const mine = await portalApi(db, GMO, 'imprestMine', {}, NOW);
  assert.equal(mine.rows.length, 1);
  assert.deepEqual((await portalApi(db, OPM1, 'imprestMine', {}, NOW)).confirm, []);
  const rep = await portalApi(db, REP, 'imprestReport', {}, NOW);
  assert.equal(rep.rows.length, 2);
});

test('OPM step: the waiting request is told to the OPM\'s phone, and the confirmation to the requester\'s', async () => {
  const t = opmTables(x => {
    x.settings.push({ key: 'PUSH_SUB_O1', value: JSON.stringify([{ ...SUB(11), topics: ['IMPREST_MINE'] }]) });
    x.settings.push({ key: 'PUSH_SUB_G1', value: JSON.stringify([{ ...SUB(12), topics: ['IMPREST_MINE'] }]) });
    x.settings.push({ key: 'PUSH_SUB_GM1', value: JSON.stringify([{ ...SUB(13), topics: ['IMPREST'] }]) });
  });
  const db = await routed(db_(t));
  const r = await askAs(db, GMO);
  assert.deepEqual(pushes.map(p => p.endpoint), [SUB(11).endpoint], 'the OPM hears; the GM does not, yet');
  assert.match(pushes[0].body.title, /OPM|uthibitisho|confirm/i); assert.equal(pushes[0].body.url, '/dashboard?imp=' + r.id);
  assert.equal(r.pushed, 1);
  pushes = [];
  await portalApi(db, OPM1, 'imprestConfirm', { id: r.id, amount: 35000, comment: 'ok' }, NOW);
  assert.deepEqual(pushes.map(p => p.endpoint).sort(), [SUB(12).endpoint, SUB(13).endpoint].sort(), 'now the GM hears, and so does the requester');
  assert.match(pushes.find(p => p.endpoint === SUB(13).endpoint).body.body, /OPM ASHA OPM/);
});
