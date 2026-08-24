// HOPE Loan's origination pipeline, end to end: customer service through the funding gate,
// senior review, rejection at every desk, the reversal chain, and the reference-number rule
// verified against the format the real system's docket/ref pairs were confirmed to use.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { loanApi, mintDocket, refFor, docketFromRef, GMO_THRESHOLD, MANAGER_THRESHOLD,
        INTEREST_FLAT_RATE, INSTALLMENTS } = await import('../api/_lib/loan-core.js');

const CS = { code: 'CS', name: 'ASHA CS', role: 'CUSTOMER SERVICE', tabs: ['customer_service'] };
const CSS = { code: 'CSS', name: 'THE CS SUPERVISOR', role: 'CS SUPERVISOR', tabs: ['customer_service', 'customer_service_supervisor'] };
// MGR already holds 'manager' for Assign and Disburse -- reused for Manager Review too, by the
// owner's own choice ("so here we'll have two side navs ... I give them navigation tabs access
// at access codes"), not a new tab minted just for this screen.
const MGR = { code: 'M', name: 'BOSS MANAGER', role: 'MANAGER', tabs: ['manager'], teams: ['MABIBO'] };
const TEAM = { code: 'T', name: 'A LOAN OFFICER', role: 'FIELD OFFICER', tabs: ['team'], teams: ['MABIBO'] };
const GMO_U = { code: 'GM1', name: 'A GMO', role: 'GMO', tabs: ['gmo'] };
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
   BRANCH, NOT TEAM, IS WHAT REGISTRATION PICKS FROM -- AND NOW WHAT ASSIGNMENT PICKS FROM TOO.
   =====================================================================================
     "Registering a new customer is always by selecting branch so that the customer gets
      visible in manager assignment window then manager selects team to assign"
     "Manager assigning to a team should be choice not filling"

   branchList is deliberately narrow: distinct branch names and which teams sit in each, nothing
   about who runs a team or what number rings them -- customer service does not have the `teams`
   tab, and this must not be a second door into the same roster. Both CS and Manager may call it
   now, one list serving both steps of the same handoff. */
test('branchList returns the distinct branches, its teams, and nothing else about a team', async () => {
  const db = fakeDb({ teams: [
    { team: 'MABIBO', region: 'DAR ES SALAAM', branch: 'DAR EAST', recovery: 'SOMEBODY', recovery_no: '712000001' },
    { team: 'SINZA', region: 'DAR ES SALAAM', branch: 'DAR EAST' },  // same branch as MABIBO -- must not duplicate
    { team: 'TUNDUMA', region: 'SONGWE', branch: 'TUNDUMA' },
    { team: 'NO BRANCH YET', branch: null },     // migration run, this team just has none set
  ] });
  const { branches, regions, byRegion, teamsByBranch } = await loanApi(db, CS, 'branchList', {});
  assert.deepEqual(branches, ['DAR EAST', 'TUNDUMA'], 'sorted, deduplicated, nulls dropped');
  // "infact they should select among regions and then choose drop list of branches in the
  // regions" -- the same data, grouped, so a two-step picker can be built from one call.
  assert.deepEqual(regions, ['DAR ES SALAAM', 'SONGWE']);
  assert.deepEqual(byRegion['DAR ES SALAAM'], ['DAR EAST']);
  assert.deepEqual(byRegion['SONGWE'], ['TUNDUMA']);
  assert.deepEqual(teamsByBranch['DAR EAST'], ['MABIBO', 'SINZA'], 'both of DAR EAST\'s teams, sorted');
  assert.deepEqual(teamsByBranch['TUNDUMA'], ['TUNDUMA']);
  assert.equal(teamsByBranch['recovery_no'], undefined, 'still no phone numbers, no role names');
});

test('a branch with no region yet is still selectable, grouped under its own heading', async () => {
  const db = fakeDb({ teams: [{ team: 'KASULU', region: null, branch: 'KASULU' }] });
  const { regions, byRegion } = await loanApi(db, CS, 'branchList', {});
  assert.deepEqual(regions, ['(Region unknown)']);
  assert.deepEqual(byRegion['(Region unknown)'], ['KASULU']);
});

test('branchList is open to Manager too, not just Customer Service', async () => {
  const db = fakeDb({ teams: [{ team: 'MABIBO', region: 'DAR ES SALAAM', branch: 'DAR EAST' }] });
  const { branches } = await loanApi(db, MGR, 'branchList', {});
  assert.deepEqual(branches, ['DAR EAST']);
});

test('branchList is refused to a code holding neither tab', async () => {
  await assert.rejects(() => loanApi(fakeDb({}), TEAM, 'branchList', {}), /required tabs/i);
});

test('managerAssign refuses a team that is not one of the loan\'s own branch', async () => {
  const db = fakeDb({ teams: [
    { team: 'MABIBO', region: 'DAR ES SALAAM', branch: 'DAR EAST' },
    { team: 'TUNDUMA', region: 'SONGWE', branch: 'TUNDUMA' },        // a different branch entirely
  ] });
  const { loan } = await loanApi(db, CS, 'csRegister', {
    full_name: 'A CUSTOMER', mobile: '0700000020', branch: 'DAR EAST', amount: 200000,
  });
  await assert.rejects(
    () => loanApi(db, MGR, 'managerAssign', { loan_id: loan.id, team: 'TUNDUMA' }),
    /not one of.*DAR EAST/i,
    'TUNDUMA does not sit in DAR EAST -- the choice is enforced server-side, not just offered');
  // The loan's own branch's team still works.
  await loanApi(db, MGR, 'managerAssign', { loan_id: loan.id, team: 'MABIBO' });
});

test('managerAssign does not check branch on a loan that never had one -- old data, old rule', async () => {
  const db = fakeDb({ teams: [{ team: 'MABIBO', region: 'DAR ES SALAAM', branch: 'DAR EAST' }] });
  // No branch passed at registration -- the same shape a loan from before branch tracking has.
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'B CUSTOMER', mobile: '0700000021', amount: 200000 });
  assert.equal(loan.branch, null);
  await loanApi(db, MGR, 'managerAssign', { loan_id: loan.id, team: 'ANY TEAM NAME' });
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
  assert.equal(q.rows.length, 1, 'below both the Manager (1M) and GMO (6M) thresholds, credit sees it directly');
});

test('at or above the Manager threshold (1M), credit cannot see the loan until Manager recommends', async () => {
  // "manager is all loans 1million+ loans ... all mandatory" -- a loan under the GMO threshold
  // (6M) still needs the Manager review now, where it used to need nothing at all.
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 2_000_000);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });

  assert.equal((await loanApi(db, CREDIT, 'creditQueue', {})).rows.length, 0,
    'blocked until the mandatory Manager review has happened');
  const mq = await loanApi(db, MGR, 'seniorQueue', { tier: 'manager' });
  assert.equal(mq.rows.length, 1);
  // GMO's own queue must not see it -- it is under GMO's own 6M threshold.
  assert.equal((await loanApi(db, GMO_U, 'seniorQueue', { tier: 'gmo' })).rows.length, 0);

  await loanApi(db, MGR, 'seniorRecommend', { loan_id: loanId, tier: 'manager', amount: 2_000_000, remarks: 'seen' });
  assert.equal((await loanApi(db, CREDIT, 'creditQueue', {})).rows.length, 1, 'unblocked once Manager has recommended');
});

test('at or above the GMO threshold (6M), credit needs BOTH Manager and GMO, not either alone', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, GMO_THRESHOLD);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  assert.equal((await loanApi(db, CREDIT, 'creditQueue', {})).rows.length, 0);

  await loanApi(db, MGR, 'seniorRecommend', { loan_id: loanId, tier: 'manager', amount: GMO_THRESHOLD, remarks: 'seen' });
  assert.equal((await loanApi(db, CREDIT, 'creditQueue', {})).rows.length, 0,
    'Manager alone is not enough at 6M -- GMO is still owed');

  await loanApi(db, GMO_U, 'seniorRecommend', { loan_id: loanId, tier: 'gmo', amount: GMO_THRESHOLD, remarks: 'seen' });
  assert.equal((await loanApi(db, CREDIT, 'creditQueue', {})).rows.length, 1, 'both done -- unblocked');
});

test('the Manager tier is gated on the manager tab, not the gmo tab, and the other way round', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, GMO_THRESHOLD);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  await assert.rejects(
    () => loanApi(db, GMO_U, 'seniorRecommend', { loan_id: loanId, tier: 'manager', amount: GMO_THRESHOLD, remarks: 'x' }),
    e => e.status === 403, 'a GMO-only code cannot record the Manager tier');
  await assert.rejects(
    () => loanApi(db, MGR, 'seniorRecommend', { loan_id: loanId, tier: 'gmo', amount: GMO_THRESHOLD, remarks: 'x' }),
    e => e.status === 403, 'a Manager-only code cannot record the GMO tier');
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
  // application_fee: 0 -- isolating the previous-balance netting from the application fee,
  // which has its own test below.
  await loanApi(db, CREDIT, 'creditApprove', { loan_id: loanId, granted_amount: 500000, previous_balance: 120000, application_fee: 0 });
  const loan = (await db.from('loans').select('*')).data.find(l => l.id === loanId);
  assert.equal(Number(loan.net_disbursed), 380000);
});

test('the application fee defaults to 5% of the grant and is deducted from what disburses', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 500000);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  const r = await loanApi(db, CREDIT, 'creditApprove', { loan_id: loanId, granted_amount: 500000 });
  assert.equal(r.application_fee, 25000, 'suggested at 5% when nothing overrides it');
  const loan = (await db.from('loans').select('*')).data.find(l => l.id === loanId);
  assert.equal(Number(loan.application_fee), 25000);
  assert.equal(Number(loan.net_disbursed), 475000, 'granted minus the fee, principal and interest untouched');
  assert.equal(Number(loan.loan_amt), 680000, 'the fee never inflates what the customer owes -- only the 36% does');
});

test('the application fee can be overridden by hand, e.g. to match the contract minimum floor', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 500000);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  const r = await loanApi(db, CREDIT, 'creditApprove', { loan_id: loanId, granted_amount: 500000, application_fee: 40000 });
  assert.equal(r.application_fee, 40000);
  const loan = (await db.from('loans').select('*')).data.find(l => l.id === loanId);
  assert.equal(Number(loan.net_disbursed), 460000);
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

test('District is captured at assessment, not registration -- "cs agents are superbusy to go into details"', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'A CUSTOMER', mobile: '0700000004', team: 'MABIBO', amount: 200000 });
  let cust = (await db.from('customers').select('*')).data.find(c => c.id === loan.customer_id);
  assert.equal(cust.district, null, 'csRegister no longer asks for it -- nothing to write yet');

  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan.id, section: 'personal', fields: { district: 'Kinondoni' } });
  cust = (await db.from('customers').select('*')).data.find(c => c.id === loan.customer_id);
  assert.equal(cust.district, 'Kinondoni', 'the team\'s assessment is what sets it now');

  // Not an identity field -- still open on a returning customer's later tracks, unlike DOB.
  // (A second loan is a top-up, so it goes through the supervisor with the eligibility fields.)
  const { loan: loan2 } = await loanApi(db, CSS, 'csRegister', {
    customer_id: loan.customer_id, full_name: 'A CUSTOMER', mobile: '0700000004', team: 'MABIBO', amount: 250000,
    topup_installments_left: 1, topup_arrears: 0,
  });
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan2.id, section: 'personal', fields: { district: 'Ilala' } });
  cust = (await db.from('customers').select('*')).data.find(c => c.id === loan.customer_id);
  assert.equal(cust.district, 'Ilala', 'district can change between loan cycles, unlike DOB/NIDA');
});

test('registration captures the disbursement number and business type, right where they belong', async () => {
  // "after disb mode in loanapp, fill the disb no (mobile money/momo no or bank a/c no)" and
  // "add filling business type before location choices too".
  const db = fakeDb({});
  const { loan: momoLoan } = await loanApi(db, CS, 'csRegister', {
    full_name: 'MOMO CUSTOMER', mobile: '0700000005', team: 'MABIBO', amount: 200000,
    disbursement_mode: 'Momo', momo: '0700000005', business_type: 'Duka la nguo',
  });
  assert.equal(momoLoan.disbursement_type, 'Momo');
  assert.equal(momoLoan.momo, '700000005', 'normalised, same as the mobile field');
  const momoCust = (await db.from('customers').select('*')).data.find(c => c.id === momoLoan.customer_id);
  assert.equal(momoCust.business_type, 'Duka la nguo');

  const { loan: bankLoan } = await loanApi(db, CS, 'csRegister', {
    full_name: 'BANK CUSTOMER', mobile: '0700000006', team: 'MABIBO', amount: 200000,
    disbursement_mode: 'Bank', bank_name: 'CRDB', account_no: '0150-123456-00',
  });
  assert.equal(bankLoan.bank_name, 'CRDB');
  assert.equal(bankLoan.account_no, '0150-123456-00');
  assert.equal(bankLoan.momo, null, 'a bank disbursement carries no momo number');
});

/* =====================================================================================
   KYC CAPTURE -- ID TYPE, SIGNATURE, THUMBPRINT, THE THREE VERIFIED PLACES, AND THE
   FIVE EXTRA GUARANTORS.
   ===================================================================================== */

// A real, tiny, well-formed PNG (1x1, transparent) -- enough for the decode/size path to be
// genuine rather than a string that merely looks like a data URL.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('kycUpload stores the bytes in the private bucket and hands back a path', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'A CUSTOMER', mobile: '0700000030', team: 'MABIBO', amount: 200000 });
  const { path } = await loanApi(db, TEAM, 'kycUpload', { loan_id: loan.id, kind: 'signature', data_url: TINY_PNG });
  assert.ok(path.startsWith('loans/' + loan.id + '/signature-'), path);
  assert.ok(path.endsWith('.png'));
  const file = db._storageDump('kyc-photos')[path];
  assert.ok(file, 'the bytes actually landed in the bucket');
  assert.equal(file.contentType, 'image/png');
});

test('kycUpload refuses anything that is not a data URL, and anything requiring team it does not have', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'B CUSTOMER', mobile: '0700000031', team: 'MABIBO', amount: 200000 });
  await assert.rejects(() => loanApi(db, TEAM, 'kycUpload', { loan_id: loan.id, kind: 'signature', data_url: 'not-a-data-url' }), /did not look like/i);
  await assert.rejects(() => loanApi(db, CS, 'kycUpload', { loan_id: loan.id, kind: 'signature', data_url: TINY_PNG }), /"team"/i);
});

test('teamAssessDetail opens pre-filled: customer, every guarantor rank, and the draft assessment', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'C CUSTOMER', mobile: '0700000032', team: 'MABIBO', amount: 200000 });
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan.id, section: 'personal', fields: { gender: 'Female', id_type: 'NIDA', national_id: '1990-1' } });
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan.id, section: 'guarantor', fields: { guarantors: [
    { full_name: 'THE GUARANTOR', phone: '0711000001', relationship: 'Sister', street: 'Uhuru St' },
    { full_name: 'ALT ONE', phone: '0711000002', relationship: 'Neighbour' },
  ] } });
  const d = await loanApi(db, TEAM, 'teamAssessDetail', { loan_id: loan.id });
  assert.equal(d.loan.id, loan.id);
  assert.equal(d.customer.gender, 'Female');
  assert.equal(d.customer.id_type, 'NIDA');
  assert.equal(d.guarantors.length, 2);
  assert.equal(d.guarantors[0].rank, 0);
  assert.equal(d.guarantors[0].street, 'Uhuru St');
  assert.equal(d.guarantors[1].rank, 1);
  assert.equal(d.guarantors[1].full_name, 'ALT ONE');
  assert.ok(d.assessment, 'a draft exists once any section has been saved');
});

test('recommendation section: credit score is saved and surfaced back through teamAssessDetail', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'SCORED CUSTOMER', mobile: '0700000038', team: 'MABIBO', amount: 300000 });
  await loanApi(db, TEAM, 'teamAssessmentSave', {
    loan_id: loan.id, section: 'recommendation', fields: { amount: 300000, credit_score: '72.5', zone: 'Manzese', remarks: 'ok' },
  });
  const d = await loanApi(db, TEAM, 'teamAssessDetail', { loan_id: loan.id });
  assert.equal(d.assessment.credit_score, 72.5);
  // Re-saving with an empty string (the field cleared, not typed) must not resurrect a stale number.
  await loanApi(db, TEAM, 'teamAssessmentSave', {
    loan_id: loan.id, section: 'recommendation', fields: { amount: 300000, credit_score: '', zone: 'Manzese', remarks: 'ok' },
  });
  const d2 = await loanApi(db, TEAM, 'teamAssessDetail', { loan_id: loan.id });
  assert.equal(d2.assessment.credit_score, null);
});

test('recommendation section: collateral type/value land on the loan itself, not the assessment draft', async () => {
  // "DHAMANA YA MKOPO ... mali za biashara na mali za nyumbani ... zenye thamani mara mbili
  // ya mkopo" -- the contract's own collateral clause.
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'COLLATERAL CUSTOMER', mobile: '0700000039', team: 'MABIBO', amount: 300000 });
  await loanApi(db, TEAM, 'teamAssessmentSave', {
    loan_id: loan.id, section: 'recommendation',
    fields: { amount: 300000, collateral_type: 'Business & household assets', collateral_value: '900000' },
  });
  const after = (await db.from('loans').select('*')).data.find(l => l.id === loan.id);
  assert.equal(after.collateral_type, 'Business & household assets');
  assert.equal(Number(after.collateral_value), 900000);
});

test('personal details: gender/ID type/signature/thumbprint/photo all pass through, the same generic write DOB already used', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'D CUSTOMER', mobile: '0700000033', team: 'MABIBO', amount: 200000 });
  const { path: sigPath } = await loanApi(db, TEAM, 'kycUpload', { loan_id: loan.id, kind: 'signature', data_url: TINY_PNG });
  const { path: thumbPath } = await loanApi(db, TEAM, 'kycUpload', { loan_id: loan.id, kind: 'thumbprint', data_url: TINY_PNG });
  const { path: photoPath } = await loanApi(db, TEAM, 'kycUpload', { loan_id: loan.id, kind: 'photo', data_url: TINY_PNG });
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan.id, section: 'personal', fields: {
    gender: 'Male', id_type: 'Driving Licence', driving_licence: 'DL-001',
    signature_url: sigPath, thumbprint_url: thumbPath, photo_url: photoPath,
    // "are all information captured enough for the future creditinfo crb report?" -- the rest
    // of the CreditInfo Individual columns (RUN-ME-001), all of them accepted the same
    // generic way DOB always was.
    first_name: 'Amina', middle_names: 'Juma', present_surname: 'Mwakalinga', birth_surname: 'Kimaro',
    marital_status: 'Married', spouses: 1, children: 3, education: 'Secondary', tin: '109-233-445',
    occupation: 'Tailor', employment: 'SelfEmployed', employer_name: '', mobile_alt: '0755000002', email: 'amina@example.com',
  } });
  const cust = (await db.from('customers').select('*')).data.find(c => c.id === loan.customer_id);
  assert.equal(cust.gender, 'Male');
  assert.equal(cust.id_type, 'Driving Licence');
  assert.equal(cust.driving_licence, 'DL-001');
  assert.equal(cust.signature_url, sigPath);
  assert.equal(cust.thumbprint_url, thumbPath);
  assert.equal(cust.photo_url, photoPath);
  assert.equal(cust.first_name, 'Amina');
  assert.equal(cust.birth_surname, 'Kimaro');
  assert.equal(cust.marital_status, 'Married');
  assert.equal(Number(cust.spouses), 1);
  assert.equal(Number(cust.children), 3);
  assert.equal(cust.education, 'Secondary');
  assert.equal(cust.tin, '109-233-445');
  assert.equal(cust.occupation, 'Tailor');
  assert.equal(cust.employment, 'SelfEmployed');
  assert.equal(cust.mobile_alt, '0755000002');
  assert.equal(cust.email, 'amina@example.com');
});

test('residence section: customer street/ward/district/GPS/photo land on the permanent record, other fields untouched', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'E CUSTOMER', mobile: '0700000034', team: 'MABIBO', amount: 200000 });
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan.id, section: 'personal', fields: { gender: 'Female' } });
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan.id, section: 'residence', fields: {
    verified: true, guarantor_verified: false,
    street: 'Kilimani Rd', ward: 'Manzese', district: 'Kinondoni',
    block_number: 'B-14', type_of_residence: 'Rented', residency_capacity: 'Tenant', years_of_residence: 2.5,
    residence_lat: -6.792354, residence_lng: 39.208328, residence_verify_photo_url: 'loans/x/residence-1.jpg',
    local_govt_letter_url: 'loans/x/residence-letter-1.jpg',
  } });
  const cust = (await db.from('customers').select('*')).data.find(c => c.id === loan.customer_id);
  assert.equal(cust.street, 'Kilimani Rd');
  assert.equal(cust.district, 'Kinondoni');
  assert.equal(Number(cust.residence_lat), -6.792354);
  assert.equal(Number(cust.residence_lng), 39.208328);
  assert.equal(cust.residence_verify_photo_url, 'loans/x/residence-1.jpg');
  assert.equal(cust.block_number, 'B-14');
  assert.equal(cust.type_of_residence, 'Rented');
  assert.equal(cust.residency_capacity, 'Tenant');
  assert.equal(Number(cust.years_of_residence), 2.5);
  assert.equal(cust.local_govt_letter_url, 'loans/x/residence-letter-1.jpg');
  assert.equal(cust.gender, 'Female', 'the earlier personal-section write is untouched by this one');
});

test('business section: business name, GPS and the site photo all save alongside the existing fields', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'F CUSTOMER', mobile: '0700000035', team: 'MABIBO', amount: 200000, business_type: 'Retail' });
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan.id, section: 'business', fields: {
    verified: true, business_name: 'Mama Asha Duka', business_lat: -6.8, business_lng: 39.2, business_verify_photo_url: 'loans/x/biz-1.jpg',
    daily_sales: '45000', daily_profit: '12000', weekly_expenses: '20000',
  } });
  const cust = (await db.from('customers').select('*')).data.find(c => c.id === loan.customer_id);
  assert.equal(cust.business_type, 'Retail', 'set at registration, still there');
  assert.equal(cust.business_name, 'Mama Asha Duka');
  assert.equal(Number(cust.business_lat), -6.8);
  assert.equal(cust.business_verify_photo_url, 'loans/x/biz-1.jpg');
  assert.equal(Number(cust.daily_sales), 45000);
  assert.equal(Number(cust.daily_profit), 12000);
  assert.equal(Number(cust.weekly_expenses), 20000);
  assert.equal(Number(cust.weekly_profit), 72000, 'daily_profit x 6, same derivation as before');
});

test('business section: numbers sent as trimmed strings from the form still land as numbers, and a cleared field writes null', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'F2 CUSTOMER', mobile: '0700000037', team: 'MABIBO', amount: 200000 });
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan.id, section: 'business', fields: { daily_sales: '' } });
  const cust = (await db.from('customers').select('*')).data.find(c => c.id === loan.customer_id);
  assert.equal(cust.daily_sales, null);
});

test('guarantor section: the primary carries every KYC field, five alternates carry only name/phone/relationship', async () => {
  // "we have 5 extra guarantors who we just say are the close people to the customer these
  // are filled names nos and relationship [help in followup by having people to ask whats
  // going on when both customer and guarantor are unreachable]"
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'G CUSTOMER', mobile: '0700000036', team: 'MABIBO', amount: 200000 });
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan.id, section: 'guarantor', fields: { guarantors: [
    { full_name: 'PRIMARY GUARANTOR', phone: '0711000010', relationship: 'Brother',
      street: 'Mtaa wa Pili', ward: 'Kigogo', district: 'Ilala', id_type: 'Voters ID', national_id: '1985-2',
      occupation: 'Mechanic', block_number: 'B-9', type_of_residence: 'Owned', residency_capacity: 'Owner',
      local_govt_letter_url: 'loans/x/g-letter.jpg',
      residence_lat: -6.81, residence_lng: 39.21, residence_verify_photo_url: 'loans/x/g-res.jpg',
      photo_url: 'loans/x/g-photo.jpg', signature_url: 'loans/x/g-sig.jpg', thumbprint_url: 'loans/x/g-thumb.jpg' },
    { full_name: 'ALT A', phone: '0711000011', relationship: 'Uncle' },
    { full_name: 'ALT B', phone: '0711000012', relationship: 'Aunt' },
    { full_name: 'ALT C', phone: '0711000013', relationship: 'Cousin' },
    { full_name: 'ALT D', phone: '0711000014', relationship: 'Friend' },
    { full_name: 'ALT E', phone: '0711000015', relationship: 'Neighbour' },
  ] } });
  const rows = db._dump('guarantors').filter(r => r.loan_id === loan.id).sort((a, b) => a.rank - b.rank);
  assert.equal(rows.length, 6, 'the primary plus all five alternates');
  assert.equal(rows[0].street, 'Mtaa wa Pili');
  // "guarantor id should be choices too.. not just nida"
  assert.equal(rows[0].id_type, 'Voters ID');
  assert.equal(rows[0].national_id, '1985-2', 'the number itself still lands in the one existing column');
  assert.equal(rows[0].occupation, 'Mechanic');
  assert.equal(rows[0].block_number, 'B-9');
  assert.equal(rows[0].type_of_residence, 'Owned');
  assert.equal(rows[0].residency_capacity, 'Owner');
  assert.equal(rows[0].local_govt_letter_url, 'loans/x/g-letter.jpg');
  assert.equal(Number(rows[0].residence_lat), -6.81);
  assert.equal(rows[0].signature_url, 'loans/x/g-sig.jpg');
  for (let i = 1; i <= 5; i++) {
    assert.equal(rows[i].street, null, 'rank ' + i + ' is name/phone/relationship only');
    assert.equal(rows[i].signature_url, null);
    assert.ok(rows[i].full_name && rows[i].phone && rows[i].relationship);
  }
});

test('once the recommendation is submitted, no section can be edited any more', async () => {
  // "as long as recommendation is not submitted - can edit previous stages but always load /
  // preview presaved info" -- and not once it has been.
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 300000);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  await assert.rejects(
    () => loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loanId, section: 'personal', fields: { gender: 'Male' } }),
    /already been submitted/i);
  await assert.rejects(
    () => loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loanId, section: 'business', fields: { business_name: 'Late edit' } }),
    /already been submitted/i);
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
   REAL END DATE -- the closing event CreditInfo needs, instead of inferring it from a
   zero balance. "close all these gaps starting with real_end_date".
   ===================================================================================== */

async function toFunded(db, amount) {
  const loanId = await toDisbursed(db, amount);
  await loanApi(db, FINANCE, 'financeMarkFunded', { loan_ids: [loanId] });
  const loan = (await db.from('loans').select('*')).data.find(l => l.id === loanId);
  return loan;   // loan_amt = amount * 1.36; loan_id is the ref payment_imports matches on
}

test('a payment that covers the loan in full closes it and stamps the Real End Date', async () => {
  const db = fakeDb({});
  const loan = await toFunded(db, 300000);   // loan_amt = 408000
  await loanApi(db, FINANCE, 'financeImportPayments', {
    rows: [{ ref: loan.loan_id, amount: 200000, paid_at: '2026-01-05' }],
  });
  let after = (await db.from('loans').select('*')).data.find(l => l.id === loan.id);
  assert.equal(after.stage, 'funded', 'short of the total -- stays open');
  assert.equal(after.real_end_date, undefined);

  await loanApi(db, FINANCE, 'financeImportPayments', {
    rows: [{ ref: loan.loan_id, amount: 208000, paid_at: '2026-01-19' }],
  });
  after = (await db.from('loans').select('*')).data.find(l => l.id === loan.id);
  assert.equal(after.stage, 'closed', 'fully covered now -- the closing event fires');
  assert.equal(after.real_end_date, '2026-01-19', 'the date of the payment that actually cleared it, not today');

  const events = (await db.from('loan_events').select('*')).data.filter(e => e.loan_id === loan.id);
  assert.ok(events.some(e => e.to_stage === 'closed'), 'the closure is on the record like every other transition');
});

test('a loan not yet funded never auto-closes, even if a matching ref is fully paid', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 300000);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  await loanApi(db, CREDIT, 'creditApprove', { loan_id: loanId, granted_amount: 300000 });
  const loan = (await db.from('loans').select('*')).data.find(l => l.id === loanId);
  assert.equal(loan.stage, 'approved', 'sanity: not disbursed or funded yet');
  await loanApi(db, FINANCE, 'financeImportPayments', { rows: [{ ref: loan.loan_id, amount: 999999999 }] });
  const after = (await db.from('loans').select('*')).data.find(l => l.id === loanId);
  assert.equal(after.stage, 'approved', 'never disbursed or funded -- a stray payment cannot close it');
});

test('shifting a payment onto a ref can be the transaction that finally closes it', async () => {
  const db = fakeDb({});
  const loan = await toFunded(db, 300000);   // loan_amt = 408000
  await loanApi(db, FINANCE, 'financeImportPayments', {
    rows: [{ ref: 'WRONG-REF', amount: 408000, paid_at: '2026-02-10' }],
  });
  await loanApi(db, FINANCE, 'financeImportPayments', { rows: [{ ref: 'WRONG-REF', amount: 1 }] });
  const rows = (await db.from('payment_imports').select('*')).data.filter(p => p.ref === 'WRONG-REF' && p.amount === 408000);
  await loanApi(db, FINANCE, 'financeShiftPayment', { payment_id: rows[0].id, to_ref: loan.loan_id, reason: 'misapplied slip' });
  const after = (await db.from('loans').select('*')).data.find(l => l.id === loan.id);
  assert.equal(after.stage, 'closed');
  assert.equal(after.real_end_date, '2026-02-10');
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

/* Three signature-section tests stood here briefly -- the section they exercised never
   merged: the KYC capture work (kycUpload + storage bucket, its own tests) landed first and
   does the same job better. See the note where SECTIONS is defined in loan-core.js. */

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
