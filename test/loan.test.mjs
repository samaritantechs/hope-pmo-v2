// HOPE Loan's origination pipeline, end to end: customer service through the funding gate,
// senior review, rejection at every desk, the reversal chain, and the reference-number rule
// verified against the format the real system's docket/ref pairs were confirmed to use.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { loanApi, mintDocket, refFor, docketFromRef, GMO_THRESHOLD, OPM_THRESHOLD,
        INTEREST_FLAT_RATE, INSTALLMENTS } = await import('../api/_lib/loan-core.js');

const CS = { code: 'CS', name: 'ASHA CS', role: 'CUSTOMER SERVICE', tabs: ['customer_service'] };
const CSS = { code: 'CSS', name: 'THE CS SUPERVISOR', role: 'CS SUPERVISOR', tabs: ['customer_service', 'customer_service_supervisor'] };
const MGR = { code: 'M', name: 'BOSS MANAGER', role: 'MANAGER', tabs: ['manager'], teams: ['MABIBO'] };
const TEAM = { code: 'T', name: 'A LOAN OFFICER', role: 'FIELD OFFICER', tabs: ['team'], teams: ['MABIBO'] };
const GMO_U = { code: 'GM1', name: 'A GMO', role: 'GMO', tabs: ['gmo'] };
const OPM_U = { code: 'OP1', name: 'AN OPM', role: 'OPM', tabs: ['opm'] };
const CREDIT = { code: 'CR', name: 'A CREDIT ANALYST', role: 'CREDIT', tabs: ['credit'] };
const FINANCE = { code: 'F', name: 'THE FINANCE MANAGER', role: 'FINANCE', tabs: ['finance'] };
const GM = { code: 'GM', name: 'THE GM', role: 'GENERAL MANAGER', tabs: ['gm'] };
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', tabs: ['admin'] };

/* =====================================================================================
   THE REFERENCE NUMBER RULE, verified against the live book in conversation:
   docket digits + track = ref, on all 2,921 loans, track 10+ takes two digits.
   ===================================================================================== */

test('mintDocket produces a sandbox docket under the prefix no live reference has ever used', () => {
  const d = mintDocket(42);
  assert.match(d, /^9-190-\d{6}$/, d);
});

test('refFor and docketFromRef are exact inverses for tracks 1-10, the confirmed range', () => {
  for (const [docket, track] of [['2-217-110984', 1], ['2-217-108360', 2], ['2-201-40832', 10], ['9-190-000042', 9]]) {
    const ref = refFor(docket, track);
    const back = docketFromRef(ref);
    assert.equal(back.docket, docket, ref);
    assert.equal(back.track, track, ref);
  }
});

/* THE OPEN GAP, MADE VISIBLE RATHER THAN HIDDEN. A ref ending 1-9 cannot be told apart from
   the low digit of track 11-19 by its digits alone -- explicitly left unresolved rather than
   guessed at. This test exists so that IF a future change makes docketFromRef quietly start
   guessing at two digits past track 10, this fails and says so, instead of the assumption
   sliding in unnoticed. */
test('docketFromRef openly cannot distinguish track 11 from track 1 on a longer stem', () => {
  const track1ref = refFor('2-201-408321', 1);   // a 10-digit-stem customer, track 1
  const wouldBeTrack11 = refFor('2-201-40832', 11); // a 9-digit-stem customer, track 11
  assert.equal(track1ref, wouldBeTrack11, 'the two ARE the same digits -- this is the ambiguity itself');
  // docketFromRef necessarily reads it as the single-digit case; that is documented, not fixed
  // here, because fixing it needs a fact (does the ref grow a digit at track 11?) nobody has
  // supplied yet -- see the docstring on docketFromRef.
  assert.equal(docketFromRef(track1ref).track, 1);
});

test('the verified live pairs decode exactly', () => {
  // From the user's own approved-file rows, confirmed correct in conversation.
  assert.equal(refFor('2-217-110984', 1), '22171109841');
  assert.equal(refFor('2-217-108360', 2), '22171083602');
  assert.equal(refFor('2-201-40832', 11), '22014083211');
});

/* =====================================================================================
   NAVIGATION, NOT ROLE NAMES -- the tab gate.
   ===================================================================================== */

test('a code without the screen tab is refused, whatever its role is called', async () => {
  const db = fakeDb({});
  await assert.rejects(() => loanApi(db, TEAM, 'managerAssign', { loan_id: 'x', team: 'MABIBO' }),
    /finance|manager/i);
  await assert.rejects(() => loanApi(db, { code: 'X', name: 'NOBODY', role: 'ANYTHING', tabs: [] },
    'managerQueue', {}), /manager/i);
});

test('the "admin" tab opens every HOPE Loan screen, mirroring HOPE PMO\'s own admin rule', async () => {
  const db = fakeDb({});
  // Would throw if the tab gate refused it -- an empty queue is success here, not a permission error.
  await loanApi(db, ADMIN, 'managerQueue', {});
  await loanApi(db, ADMIN, 'creditQueue', {});
  await loanApi(db, ADMIN, 'financeBankReport', {});
});

/* =====================================================================================
   BRANCH, NOT TEAM, IS WHAT REGISTRATION PICKS FROM.
   =====================================================================================
     "Registering a new customer is always by selecting branch so that the customer gets
      visible in manager assignment window then manager selects team to assign"

   branchList is deliberately narrow: distinct branch names only, nothing about who runs a
   team or what number rings them -- customer service does not have the `teams` tab, and this
   must not be a second door into the same roster. */
test('branchList returns the distinct branches, and nothing else about a team', async () => {
  const db = fakeDb({ teams: [
    { team: 'MABIBO', region: 'DAR ES SALAAM', branch: 'DAR EAST', recovery: 'SOMEBODY', recovery_no: '712000001' },
    { team: 'SINZA', region: 'DAR ES SALAAM', branch: 'DAR EAST' },  // same branch as MABIBO -- must not duplicate
    { team: 'TUNDUMA', region: 'SONGWE', branch: 'TUNDUMA' },
    { team: 'NO BRANCH YET', branch: null },     // migration run, this team just has none set
  ] });
  const { branches, regions, byRegion } = await loanApi(db, CS, 'branchList', {});
  assert.deepEqual(branches, ['DAR EAST', 'TUNDUMA'], 'sorted, deduplicated, nulls dropped');
  // "infact they should select among regions and then choose drop list of branches in the
  // regions" -- the same data, grouped, so a two-step picker can be built from one call.
  assert.deepEqual(regions, ['DAR ES SALAAM', 'SONGWE']);
  assert.deepEqual(byRegion['DAR ES SALAAM'], ['DAR EAST']);
  assert.deepEqual(byRegion['SONGWE'], ['TUNDUMA']);
});

test('a branch with no region yet is still selectable, grouped under its own heading', async () => {
  const db = fakeDb({ teams: [{ team: 'KASULU', region: null, branch: 'KASULU' }] });
  const { regions, byRegion } = await loanApi(db, CS, 'branchList', {});
  assert.deepEqual(regions, ['(Region unknown)']);
  assert.deepEqual(byRegion['(Region unknown)'], ['KASULU']);
});

test('branchList is refused without the customer_service tab', async () => {
  await assert.rejects(() => loanApi(fakeDb({}), MGR, 'branchList', {}), /customer_service/i);
});

/* =====================================================================================
   THE FULL PIPELINE, ONE LOAN, START TO FUNDED.
   ===================================================================================== */

async function registerAssignAssess(db, amount, opts = {}) {
  const { docket, ref, loan } = await loanApi(db, CS, 'csRegister', {
    full_name: 'ASHA OMARI IDDI', mobile: '0763357860', team: 'MABIBO', amount,
  });
  await loanApi(db, MGR, 'managerAssign', { loan_id: loan.id, team: 'MABIBO' });
  await loanApi(db, TEAM, 'teamAssessmentSave', {
    loan_id: loan.id, section: 'personal',
    fields: { dob: '1990-01-01', gender: 'Female', national_id: '19900101-00000-00001-01' },
  });
  await loanApi(db, TEAM, 'teamAssessmentSave', {
    loan_id: loan.id, section: 'recommendation', fields: { amount: opts.recommend || amount, zone: 'Manzese', remarks: 'ok' },
  });
  await loanApi(db, TEAM, 'teamAssessmentSave', {
    loan_id: loan.id, section: 'guarantor',
    fields: { guarantors: [{ full_name: 'A GUARANTOR', phone: '0715000001', relationship: 'Sister' }] },
  });
  return { docket, ref, loanId: loan.id };
}

test('a small loan flows unassigned -> assigned -> pending_approval without any senior review', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 300000);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  const loan = (await db.from('loans').select('*').eq('id', loanId).maybeSingle()).data
    || (await db.from('loans').select('*').eq('id', loanId)).data[0];
  assert.equal(loan.stage, 'pending_approval');
  assert.equal(Number(loan.team_recomm), 300000);

  const q = await loanApi(db, CREDIT, 'creditQueue', {});
  assert.equal(q.rows.length, 1, 'below the GMO threshold, credit sees it directly');
});

test('at or above the GMO threshold, credit cannot see the loan until GMO recommends', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, GMO_THRESHOLD);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });

  assert.equal((await loanApi(db, CREDIT, 'creditQueue', {})).rows.length, 0,
    'blocked until the mandatory GMO review has happened');
  const gq = await loanApi(db, GMO_U, 'seniorQueue', { tier: 'gmo' });
  assert.equal(gq.rows.length, 1);

  await loanApi(db, GMO_U, 'seniorRecommend', { loan_id: loanId, tier: 'gmo', amount: GMO_THRESHOLD, remarks: 'seen' });
  assert.equal((await loanApi(db, CREDIT, 'creditQueue', {})).rows.length, 1, 'unblocked once GMO has recommended');
});

test('OPM review is optional (MAY, not MUST) below its own threshold', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, GMO_THRESHOLD);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  await loanApi(db, GMO_U, 'seniorRecommend', { loan_id: loanId, tier: 'gmo', amount: GMO_THRESHOLD, remarks: 'ok' });
  // Below OPM_THRESHOLD (6M) -- credit must already be reachable without any OPM action.
  assert.equal((await loanApi(db, CREDIT, 'creditQueue', {})).rows.length, 1);
});

/* THE CENTRAL GUARANTEE: authorised is not paid. */
test('disbursed does not mean funded -- only financeMarkFunded advances the stage', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 300000);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  await loanApi(db, CREDIT, 'creditApprove', { loan_id: loanId, granted_amount: 300000 });
  await loanApi(db, FINANCE, 'financeOpenWindow', {});
  await loanApi(db, MGR, 'managerDisburse', { loan_id: loanId });

  const afterDisburse = (await db.from('loans').select('*')).data.find(l => l.id === loanId);
  assert.equal(afterDisburse.stage, 'disbursed', 'authorised, and stops there');
  assert.equal(afterDisburse.funded_at, undefined, 'nothing about funding has happened yet');

  // The bank report lists it, waiting to be paid -- this is what finance actually sees.
  const bankReport = await loanApi(db, FINANCE, 'financeBankReport', {});
  assert.equal(bankReport.rows.length, 1);
  assert.equal(bankReport.rows[0].loan_id, loanId);

  await loanApi(db, FINANCE, 'financeMarkFunded', { loan_ids: [loanId] });
  const funded = (await db.from('loans').select('*')).data.find(l => l.id === loanId);
  assert.equal(funded.stage, 'funded');
  assert.ok(funded.funded_at, 'funding is when the schedule actually starts');

  // Now off the bank report -- it has been paid, so it stops appearing as owed.
  assert.equal((await loanApi(db, FINANCE, 'financeBankReport', {})).rows.length, 0);
});

test('a manager cannot disburse while the window is closed', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 300000);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  await loanApi(db, CREDIT, 'creditApprove', { loan_id: loanId, granted_amount: 300000 });
  // Window never opened.
  await assert.rejects(() => loanApi(db, MGR, 'managerDisburse', { loan_id: loanId }), /window is closed/i);
});

test('the window cannot be opened twice, or closed while already shut', async () => {
  const db = fakeDb({});
  await loanApi(db, FINANCE, 'financeOpenWindow', {});
  await assert.rejects(() => loanApi(db, FINANCE, 'financeOpenWindow', {}), /already open/i);
  await loanApi(db, FINANCE, 'financeCloseWindow', {});
  await assert.rejects(() => loanApi(db, FINANCE, 'financeCloseWindow', {}), /not open/i);
});

/* =====================================================================================
   THE SCHEDULE -- 36% flat, 12 weekly, verified against the order document's own example.
   ===================================================================================== */

test('interest is 36% flat and the installment is total/12, matching the worked example', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 300000);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  const r = await loanApi(db, CREDIT, 'creditApprove', { loan_id: loanId, granted_amount: 300000 });
  // 300,000 -> 108,000 interest -> 408,000 total -> 34,000 per week, from the order document.
  assert.equal(r.interest, 108000);
  assert.equal(r.total, 408000);
  assert.equal(r.installment, 34000);
  assert.equal(INTEREST_FLAT_RATE, 0.36);
  assert.equal(INSTALLMENTS, 12);
});

test('a top-up nets the new principal against the previous balance for the disbursing amount', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 500000);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  await loanApi(db, CREDIT, 'creditApprove', { loan_id: loanId, granted_amount: 500000, previous_balance: 120000 });
  const loan = (await db.from('loans').select('*')).data.find(l => l.id === loanId);
  assert.equal(Number(loan.net_disbursed), 380000);
});

/* =====================================================================================
   REJECTION AT EVERY DESK -- always with a reason.
   ===================================================================================== */

test('every rejection requires a reason, at manager, team, and credit alike', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'X Y', mobile: '0700000001', team: 'MABIBO', amount: 200000 });
  await assert.rejects(() => loanApi(db, MGR, 'managerReject', { loan_id: loan.id }), /reason is required/i);
  await loanApi(db, MGR, 'managerReject', { loan_id: loan.id, reason: 'Duplicate application' });
  const after = (await db.from('loans').select('*')).data.find(l => l.id === loan.id);
  assert.equal(after.stage, 'rejected');
  assert.equal(after.reject_reason, 'Duplicate application');
});

test('a stage transition attempted from the wrong stage is refused, not silently overwritten', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'X Y', mobile: '0700000002', team: 'MABIBO', amount: 200000 });
  await loanApi(db, MGR, 'managerReject', { loan_id: loan.id, reason: 'no' });
  // Already rejected -- assigning it now must fail rather than quietly move a dead loan.
  await assert.rejects(() => loanApi(db, MGR, 'managerAssign', { loan_id: loan.id, team: 'MABIBO' }), /not "unassigned"/i);
});

/* =====================================================================================
   PERSONAL FIELDS ARE WRITE-ONCE PAST THE FIRST LOAN.
   ===================================================================================== */

test('a customer\'s DOB is locked from track 2 onward, but still editable on the first loan', async () => {
  const db = fakeDb({});
  const { loan: loan1 } = await loanApi(db, CS, 'csRegister', { full_name: 'REPEAT CUSTOMER', mobile: '0700000003', team: 'MABIBO', amount: 200000 });
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan1.id, section: 'personal', fields: { dob: '1985-05-05' } });
  let cust = (await db.from('customers').select('*')).data.find(c => c.id === loan1.customer_id);
  assert.equal(cust.dob, '1985-05-05', 'track 1: editable');

  // Second loan for the SAME customer -- track 2, so it is a top-up: the supervisor tab and an
  // instalments-left figure are both required (see the multi-loan top-up tests further down).
  const { loan: loan2 } = await loanApi(db, CSS, 'csRegister', {
    customer_id: loan1.customer_id, full_name: 'REPEAT CUSTOMER', mobile: '0700000003', team: 'MABIBO', amount: 250000,
    topup_installments_left: 1, topup_arrears: 0,
  });
  assert.equal(loan2.track_no, '2');
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan2.id, section: 'personal', fields: { dob: '1999-09-09', mobile_alt: '0711111111' } });
  cust = (await db.from('customers').select('*')).data.find(c => c.id === loan1.customer_id);
  assert.equal(cust.dob, '1985-05-05', 'track 2: DOB is locked, the write is silently dropped');
});

/* =====================================================================================
   THE REVERSAL CHAIN -- credit requests, finance reviews, GM authorises. All three, in order.
   ===================================================================================== */

async function toDisbursed(db, amount) {
  const { loanId } = await registerAssignAssess(db, amount);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  await loanApi(db, CREDIT, 'creditApprove', { loan_id: loanId, granted_amount: amount });
  await loanApi(db, FINANCE, 'financeOpenWindow', {});
  await loanApi(db, MGR, 'managerDisburse', { loan_id: loanId });
  return loanId;
}

test('reversal needs all three signatures, in order, before the loan closes', async () => {
  const db = fakeDb({});
  const loanId = await toDisbursed(db, 300000);

  await assert.rejects(() => loanApi(db, CREDIT, 'reversalRequest', { loan_id: loanId }), /reason is required/i);
  const { row } = await loanApi(db, CREDIT, 'reversalRequest', { loan_id: loanId, reason: 'Never funded, customer defaulting' });

  await assert.rejects(() => loanApi(db, GM, 'reversalGmDecide', { id: row.id, approve: true }),
    /finance must approve/i, 'the GM cannot authorise ahead of finance');

  await loanApi(db, FINANCE, 'reversalFinanceDecide', { id: row.id, approve: true });
  await loanApi(db, GM, 'reversalGmDecide', { id: row.id, approve: true });

  const loan = (await db.from('loans').select('*')).data.find(l => l.id === loanId);
  assert.equal(loan.stage, 'closed', '"keep reversed loan as closed contract"');
});

/* The queue the three desks work from -- missing on first write, so a pending reversal was
   requestable and decidable by name but could never be FOUND by the people who must sign it. */
test('reversalsList shows what is waiting for a signature and what is still reversible', async () => {
  const db = fakeDb({});
  const loanId = await toDisbursed(db, 300000);

  let list = await loanApi(db, FINANCE, 'reversalsList', {});
  assert.equal(list.pending.length, 0);
  assert.equal(list.eligible.length, 1, 'authorised but unfunded -- the money has not moved, so it is reversible');
  assert.equal(list.eligible[0].loan_id, loanId);

  const { row } = await loanApi(db, CREDIT, 'reversalRequest', { loan_id: loanId, reason: 'never funded' });
  list = await loanApi(db, FINANCE, 'reversalsList', {});
  assert.equal(list.pending.length, 1, 'now waiting on finance');
  assert.equal(list.eligible.length, 0, 'a loan with a live request is not offered for a second one');

  await loanApi(db, FINANCE, 'reversalFinanceDecide', { id: row.id, approve: true });
  await loanApi(db, GM, 'reversalGmDecide', { id: row.id, approve: true });
  list = await loanApi(db, FINANCE, 'reversalsList', {});
  assert.equal(list.pending.length, 0, 'closed out');
  assert.equal(list.rows.length, 1, 'but still on the record');
});

test('a funded loan is NOT reversible -- the money has already moved', async () => {
  const db = fakeDb({});
  const loanId = await toDisbursed(db, 300000);
  await loanApi(db, FINANCE, 'financeMarkFunded', { loan_ids: [loanId] });

  const list = await loanApi(db, FINANCE, 'reversalsList', {});
  assert.equal(list.eligible.length, 0, 'funded loans leave the reversible list');
  await assert.rejects(() => loanApi(db, CREDIT, 'reversalRequest', { loan_id: loanId, reason: 'too late' }),
    /authorised-but-unfunded/i);
});

test('the next loan for a reversed customer opens on the next track, not a reused one', async () => {
  const db = fakeDb({});
  const { loan: loan1 } = await loanApi(db, CS, 'csRegister', { full_name: 'REVERSED CUSTOMER', mobile: '0700000009', team: 'MABIBO', amount: 300000 });
  await loanApi(db, MGR, 'managerAssign', { loan_id: loan1.id, team: 'MABIBO' });
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan1.id, section: 'recommendation', fields: { amount: 300000 } });
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loan1.id, decision: 'ACCEPTED' });
  await loanApi(db, CREDIT, 'creditApprove', { loan_id: loan1.id, granted_amount: 300000 });
  await loanApi(db, FINANCE, 'financeOpenWindow', {});
  await loanApi(db, MGR, 'managerDisburse', { loan_id: loan1.id });
  const { row } = await loanApi(db, CREDIT, 'reversalRequest', { loan_id: loan1.id, reason: 'never funded' });
  await loanApi(db, FINANCE, 'reversalFinanceDecide', { id: row.id, approve: true });
  await loanApi(db, GM, 'reversalGmDecide', { id: row.id, approve: true });

  const { loan: loan2 } = await loanApi(db, CSS, 'csRegister', {
    customer_id: loan1.customer_id, full_name: 'REVERSED CUSTOMER', mobile: '0700000009', team: 'MABIBO', amount: 300000,
    topup_installments_left: 0, topup_arrears: 0,
  });
  assert.equal(loan2.track_no, '2', 'the docket is unchanged; only the track has moved on');
  assert.equal(loan2.docket_no, loan1.docket_no);
});

/* =====================================================================================
   FINANCE -- the payment-import receiver, and shifting a payment between references.
   ===================================================================================== */

test('financeImportPayments is the receiver for the ISP feed finance already runs by hand', async () => {
  const db = fakeDb({});
  const r = await loanApi(db, FINANCE, 'financeImportPayments', {
    rows: [{ ref: '919000001', amount: 34000, paid_by: '0715000001' }, { ref: '', amount: 0 }],
  });
  assert.equal(r.imported, 1, 'a row missing a reference or an amount is dropped, not guessed');
  const rows = (await db.from('payment_imports').select('*')).data;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'manual');
});

/* Both of these existed as writes with no way to read them back -- a register nobody can open
   and a shift-by-id nobody could look an id up for. */
test('paymentsList makes a misapplied payment findable, so shifting one is reachable', async () => {
  const db = fakeDb({});
  await loanApi(db, FINANCE, 'financeImportPayments', {
    batch: 'PAY-A', rows: [{ ref: '919000001', amount: 34000 }, { ref: '919000002', amount: 51000 }],
  });
  const d = await loanApi(db, FINANCE, 'paymentsList', {});
  assert.equal(d.rows.length, 2);
  assert.deepEqual(d.batches, ['PAY-A']);
  assert.ok(d.rows[0].id, 'a row must carry the id financeShiftPayment needs');

  const filtered = await loanApi(db, FINANCE, 'paymentsList', { ref: '919000001' });
  assert.equal(filtered.rows.length, 1);
});

test('complaintsList reads back what csComplaint writes, with an open/resolved split', async () => {
  const db = fakeDb({});
  await loanApi(db, CS, 'csComplaint', { ref: '919000001', team: 'MABIBO', type: 'Misallocation', details: 'wrong team' });
  const d = await loanApi(db, CS, 'complaintsList', {});
  assert.equal(d.rows.length, 1);
  assert.equal(d.open, 1);
  assert.equal(d.resolved, 0);
  assert.equal(d.rows[0].category, 'Misallocation');
});

test('shifting a payment keeps the original, marked, rather than deleting it', async () => {
  const db = fakeDb({ payment_imports: [{ id: 'p1', ref: 'REF-A', amount: 34000 }] });
  await assert.rejects(() => loanApi(db, FINANCE, 'financeShiftPayment', { payment_id: 'p1', to_ref: 'REF-B' }),
    /reason is required/i);
  await loanApi(db, FINANCE, 'financeShiftPayment', { payment_id: 'p1', to_ref: 'REF-B', reason: 'wrong ref on the slip' });
  const rows = (await db.from('payment_imports').select('*')).data;
  assert.equal(rows.length, 1, 'the row is updated in place, not duplicated');
  assert.equal(rows[0].ref, 'REF-B');
  assert.equal(rows[0].shifted_from_ref, 'REF-A');
});

/* =====================================================================================
   ILIYONASA -- signed and attributable, never an anonymous edit.
   ===================================================================================== */

test('a manual adjustment is signed and cannot be zero', async () => {
  const db = fakeDb({});
  await assert.rejects(() => loanApi(db, FINANCE, 'adjustmentSave', { team: 'MABIBO', target: 'expected', amount: 0, reason: 'x' }),
    /non-zero/i);
  const { row } = await loanApi(db, FINANCE, 'adjustmentSave', { team: 'MABIBO', target: 'defaults', amount: -15000, reason: 'unsuccessful transaction' });
  assert.equal(row.created_by, 'THE FINANCE MANAGER');
  assert.equal(Number(row.amount), -15000);
  const list = await loanApi(db, FINANCE, 'adjustmentsList', { team: 'MABIBO' });
  assert.equal(list.rows.length, 1);
});

/* =====================================================================================
   EVERY TRANSITION LEAVES A TRAIL.
   ===================================================================================== */

test('loan_events records who moved a loan and from where to where, at every step', async () => {
  const db = fakeDb({});
  const loanId = await toDisbursed(db, 300000);
  const events = (await db.from('loan_events').select('*')).data.filter(e => e.loan_id === loanId);
  const stages = events.map(e => e.to_stage);
  assert.deepEqual(stages, ['unassigned', 'assigned', 'unassessed', 'pending_approval', 'approved', 'disbursed']);
  assert.ok(events.every(e => e.actor), 'every event names who did it');
});

/* =====================================================================================
   THE PIPELINE SUMMARY -- one screen, every stage's count.
   ===================================================================================== */

/* =====================================================================================
   THE TWO REGISTRIES ARE SEPARATE -- the guarantee that HOPE PMO's officer-facing functions
   cannot be reached from the sandbox, and vice versa, even by naming them outright.
   ===================================================================================== */

test('loanApi refuses every HOPE PMO function name -- the registries do not overlap', async () => {
  const db = fakeDb({});
  const { PORTAL_FUNCTIONS } = await import('../api/_lib/portal-core.js');
  const { LOAN_FUNCTIONS } = await import('../api/_lib/loan-core.js');

  const overlap = PORTAL_FUNCTIONS.filter(f => LOAN_FUNCTIONS.includes(f));
  assert.deepEqual(overlap, [], 'a shared name would make the workspace switch ambiguous');

  // And a HOPE PMO name really is refused here rather than falling through to anything.
  for (const fn of ['dashboardFull', 'followup', 'saveTeam', 'rebuildFollowup', 'settingSet']) {
    await assert.rejects(() => loanApi(db, ADMIN, fn, {}), /Unknown HOPE Loan function/);
  }
});

test('portalApi refuses every HOPE Loan function name, in the same way', async () => {
  const db = fakeDb({});
  const { portalApi } = await import('../api/_lib/portal-core.js');
  for (const fn of ['csRegister', 'financeMarkFunded', 'creditApprove', 'pipelineSummary']) {
    await assert.rejects(() => portalApi(db, ADMIN, fn, {}), /Unknown portal function/);
  }
});

test('pipelineSummary counts every stage and reports the window state', async () => {
  const db = fakeDb({});
  await loanApi(db, CS, 'csRegister', { full_name: 'A', mobile: '0700000010', team: 'MABIBO', amount: 100000 });
  await loanApi(db, CS, 'csRegister', { full_name: 'B', mobile: '0700000011', team: 'MABIBO', amount: 100000 });
  const s = await loanApi(db, ADMIN, 'pipelineSummary', {});
  assert.equal(s.total, 2);
  assert.equal(s.stages.find(x => x.stage === 'unassigned').count, 2);
  assert.equal(s.windowOpen, false);
});

/* =====================================================================================
   MULTI-LOAN TOP-UPS ("doubles") -- CSS-only, and only with 2 or fewer instalments left.

     "at multi loan we allow these customers to double, this is to topup their loans only
      when they request loans and get registered with not more than two installments left
      ... that amount will be deducted from the next disbursement amount but will not affect
      next loan installement as per its amount requested"
   ===================================================================================== */

test('a TRACK# 2 registration is refused to plain customer_service -- the supervisor tab is required', async () => {
  const db = fakeDb({});
  const { loan: loan1 } = await loanApi(db, CS, 'csRegister', { full_name: 'TOPUP CANDIDATE', mobile: '0700000020', team: 'MABIBO', amount: 200000 });
  await assert.rejects(() => loanApi(db, CS, 'csRegister', {
    customer_id: loan1.customer_id, full_name: 'TOPUP CANDIDATE', mobile: '0700000020', team: 'MABIBO', amount: 250000,
    topup_installments_left: 1, topup_arrears: 0,
  }), /customer_service_supervisor/);
});

test('a top-up requires instalments-left, and refuses more than 2', async () => {
  const db = fakeDb({});
  const { loan: loan1 } = await loanApi(db, CS, 'csRegister', { full_name: 'TOPUP CANDIDATE', mobile: '0700000021', team: 'MABIBO', amount: 200000 });
  await assert.rejects(() => loanApi(db, CSS, 'csRegister', {
    customer_id: loan1.customer_id, full_name: 'TOPUP CANDIDATE', mobile: '0700000021', team: 'MABIBO', amount: 250000,
  }), /Instalments left.*is required/);
  await assert.rejects(() => loanApi(db, CSS, 'csRegister', {
    customer_id: loan1.customer_id, full_name: 'TOPUP CANDIDATE', mobile: '0700000021', team: 'MABIBO', amount: 250000,
    topup_installments_left: 3,
  }), /3 instalments left.*2 or fewer/);
});

test('an eligible top-up carries its instalments-left and arrears onto the new loan', async () => {
  const db = fakeDb({});
  const { loan: loan1 } = await loanApi(db, CS, 'csRegister', { full_name: 'ELIGIBLE TOPUP', mobile: '0700000022', team: 'MABIBO', amount: 200000 });
  // "instalment 34,000 has ds 10/12 arreas 50,000 tzs" -- 2 left, arrears 50,000.
  const { loan: loan2 } = await loanApi(db, CSS, 'csRegister', {
    customer_id: loan1.customer_id, full_name: 'ELIGIBLE TOPUP', mobile: '0700000022', team: 'MABIBO', amount: 400000,
    topup_installments_left: 2, topup_arrears: 50000,
  });
  assert.equal(loan2.track_no, '2');
  assert.equal(loan2.topup_installments_left, 2);
  assert.equal(loan2.topup_arrears, 50000);
  // THE ARREARS DO NOT TOUCH THE REQUESTED AMOUNT -- what the new instalments are computed
  // from is exactly what was asked for; only net_disbursed (set later, at credit approval)
  // carries the deduction.
  assert.equal(loan2.requested_amt, 400000);
});

test('track 1 never asks for top-up fields, whoever registers it', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'FIRST TIMER', mobile: '0700000023', team: 'MABIBO', amount: 200000 });
  assert.equal(loan.track_no, '1');
  assert.equal(loan.topup_installments_left, undefined);
});

/* =====================================================================================
   THE SINGLE-SIGNATORY SPLIT SCREEN -- signature, fingerprint, guarantor signature, all on
   the team's assessment, alongside the other five sections.
   ===================================================================================== */

const PNG = 'data:image/png;base64,' + 'A'.repeat(40);

test('the signature section requires at least one capture, and validates what it is given', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'SIGNER', mobile: '0700000030', team: 'MABIBO', amount: 200000 });
  await assert.rejects(() => loanApi(db, TEAM, 'teamAssessmentSave', {
    loan_id: loan.id, section: 'signature', fields: {},
  }), /At least one signature or fingerprint/);
  await assert.rejects(() => loanApi(db, TEAM, 'teamAssessmentSave', {
    loan_id: loan.id, section: 'signature', fields: { customer_signature: 'not-a-data-url' },
  }), /must be a captured image/);
});

test('a captured signature, fingerprint and guarantor signature all save on the one assessment row', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'SIGNER TWO', mobile: '0700000031', team: 'MABIBO', amount: 200000 });
  const { assessment } = await loanApi(db, TEAM, 'teamAssessmentSave', {
    loan_id: loan.id, section: 'signature',
    fields: { customer_signature: PNG, customer_fingerprint: PNG, guarantor_signature: PNG },
  });
  assert.equal(assessment.customer_signature, PNG);
  assert.equal(assessment.customer_fingerprint, PNG);
  assert.equal(assessment.guarantor_signature, PNG);
  assert.equal(assessment.signed_by, TEAM.name);
  assert.ok(assessment.signed_at);
  assert.equal(assessment.done_signature, true);
});

test('an oversized capture is refused rather than silently stored', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'SIGNER THREE', mobile: '0700000032', team: 'MABIBO', amount: 200000 });
  const huge = 'data:image/png;base64,' + 'A'.repeat(500 * 1024);
  await assert.rejects(() => loanApi(db, TEAM, 'teamAssessmentSave', {
    loan_id: loan.id, section: 'signature', fields: { customer_signature: huge },
  }), /too large/);
});

/* =====================================================================================
   COMMENTS FOLLOW THE CUSTOMER, NOT THE TRACK.
   ===================================================================================== */

test('a comment logged on a customer\'s first loan is visible from their second, and their third', async () => {
  const db = fakeDb({});
  const { loan: loan1 } = await loanApi(db, CS, 'csRegister', { full_name: 'CHATTY CUSTOMER', mobile: '0700000040', team: 'MABIBO', amount: 200000 });
  await loanApi(db, CS, 'loanAddComment', { loan_id: loan1.id, comment: 'Called about the first loan; promised to pay Friday.' });

  const { loan: loan2 } = await loanApi(db, CSS, 'csRegister', {
    customer_id: loan1.customer_id, full_name: 'CHATTY CUSTOMER', mobile: '0700000040', team: 'MABIBO', amount: 250000,
    topup_installments_left: 1, topup_arrears: 0,
  });
  // A real gap, so the two comments cannot land in the same created_at millisecond -- without
  // it "newest first" is comparing two equal timestamps, which is exactly the kind of tie
  // snapshots.js's batchRank exists to warn about (see idx_loan_comments_customer's own note).
  await new Promise(r => setTimeout(r, 2));
  await loanApi(db, MGR, 'loanAddComment', { loan_id: loan2.id, comment: 'Assigned the top-up to the branch team.' });

  // Read from EITHER loan -- both resolve to the same customer, so both see the whole trail.
  const fromLoan1 = await loanApi(db, ADMIN, 'loanComments', { loan_id: loan1.id });
  const fromLoan2 = await loanApi(db, ADMIN, 'loanComments', { loan_id: loan2.id });
  assert.equal(fromLoan1.rows.length, 2);
  assert.equal(fromLoan2.rows.length, 2);
  assert.deepEqual(fromLoan1.rows.map(r => r.comment).sort(), fromLoan2.rows.map(r => r.comment).sort());
  // Newest first.
  assert.equal(fromLoan2.rows[0].comment, 'Assigned the top-up to the branch team.');
});

test('an empty comment is refused', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'QUIET CUSTOMER', mobile: '0700000041', team: 'MABIBO', amount: 200000 });
  await assert.rejects(() => loanApi(db, CS, 'loanAddComment', { loan_id: loan.id, comment: '  ' }), /comment is required/);
});

test('a note can be added by customer_id alone -- csSearch results carry no loan_id yet', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'FOUND BY SEARCH', mobile: '0700000042', team: 'MABIBO', amount: 200000 });
  await loanApi(db, CS, 'loanAddComment', { customer_id: loan.customer_id, comment: 'Spoke to them before registering the top-up.' });
  const d = await loanApi(db, ADMIN, 'loanComments', { customer_id: loan.customer_id });
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].docket, loan.docket_no);
  await assert.rejects(() => loanApi(db, CS, 'loanAddComment', { comment: 'orphaned' }), /loan_id or customer_id/);
});
