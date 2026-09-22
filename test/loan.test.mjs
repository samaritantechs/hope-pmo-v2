// HOPE Loan's origination pipeline, end to end: customer service through the funding gate,
// senior review, rejection at every desk, the reversal chain, and the reference-number rule
// verified against the format the real system's docket/ref pairs were confirmed to use.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { loanApi, mintDocket, refFor, docketFromRef, GMO_THRESHOLD, MANAGER_THRESHOLD,
        INTEREST_FLAT_RATE, INSTALLMENTS, _setCallLogsDb } = await import('../api/_lib/loan-core.js');
/* "Today" as the SERVER reads it -- East Africa Time -- not the UTC day. Between 21:00 and
   midnight UTC the two differ, and a plan dated the UTC day was refused as yesterday's. */
const { todayKey, addDaysKey } = await import('../api/_lib/time.js');
const todayEAT_ = () => todayKey(Date.now());

/* creditApprove now reads production call_logs (callVerificationFor_, a DIFFERENT database
   from the sandbox `db` every test here builds) to answer "did the analyst actually call this
   customer" -- see RUN-ME-011. Left to its real default it would hit the network at
   SUPABASE_URL above (test.invalid) on every one of this file's creditApprove calls, which is
   slow and pointless to test against; an empty fake here answers instantly and correctly
   (nothing on file -- not verified), same as call_logs genuinely holding no matching row would. */
_setCallLogsDb(fakeDb({}));

const { _setFetch: _setMailFetch } = await import('../api/_lib/mail.js');

const CS = { code: 'CS', name: 'ASHA CS', role: 'CUSTOMER SERVICE', tabs: ['customer_service'] };
// MGR already holds 'manager' for Assign and Disburse -- reused for Manager Review too, by the
// owner's own choice ("so here we'll have two side navs ... I give them navigation tabs access
// at access codes"), not a new tab minted just for this screen.
const MGR = { code: 'M', name: 'BOSS MANAGER', role: 'MANAGER', tabs: ['manager'], teams: ['MABIBO'] };
const TEAM = { code: 'T', name: 'A LOAN OFFICER', role: 'FIELD OFFICER', tabs: ['team'], teams: ['MABIBO'] };
const GMO_U = { code: 'GM1', name: 'A GMO', role: 'GMO', tabs: ['gmo'] };
const CREDIT = { code: 'CR', name: 'A CREDIT ANALYST', role: 'CREDIT', tabs: ['loan_credit'] };
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

  // Second loan for the SAME customer -- track 2.
  const { loan: loan2 } = await loanApi(db, CS, 'csRegister', {
    customer_id: loan1.customer_id, full_name: 'REPEAT CUSTOMER', mobile: '0700000003', team: 'MABIBO', amount: 250000,
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
  const { loan: loan2 } = await loanApi(db, CS, 'csRegister', {
    customer_id: loan.customer_id, full_name: 'A CUSTOMER', mobile: '0700000004', team: 'MABIBO', amount: 250000,
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

/* THE AUDIT TRAIL -- WHICH CAMERA ANSWERED.
   "We now have a setback officers are using Ai photos so this comes as ronaldo" -- a spoofed
   camera answers getUserMedia() the same way a real one does, so this is audit-only: every
   capture logs the browser's own label for whichever camera it was, against who was signed in,
   so a suspicious one can be traced to an officer rather than silently trusted. Fire-and-forget
   like loan_events -- db/RUN-ME-007 not having been run yet must never fail the upload itself. */
test('kycUpload logs the camera label (and who was signed in) against the capture', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'C CUSTOMER', mobile: '0700000032', team: 'MABIBO', amount: 200000 });
  const { path } = await loanApi(db, TEAM, 'kycUpload', { loan_id: loan.id, kind: 'photo', data_url: TINY_PNG, camera_label: 'Virtual Camera' });
  const rows = db._dump('kyc_captures');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].loan_id, loan.id);
  assert.equal(rows[0].kind, 'photo');
  assert.equal(rows[0].path, path);
  assert.equal(rows[0].camera_label, 'Virtual Camera');
  assert.equal(rows[0].actor, TEAM.name);
  assert.equal(rows[0].actor_role, TEAM.role);
});

test('kycUpload copes with no camera label at all, and with the audit table not existing yet', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'D CUSTOMER', mobile: '0700000033', team: 'MABIBO', amount: 200000 });
  const { path } = await loanApi(db, TEAM, 'kycUpload', { loan_id: loan.id, kind: 'thumbprint', data_url: TINY_PNG });
  assert.ok(path, 'the upload itself still succeeds with no label offered');
  assert.equal(db._dump('kyc_captures')[0].camera_label, null);

  const originalFrom = db.from.bind(db);
  db.from = (name) => { if (name === 'kyc_captures') throw new Error('relation "kyc_captures" does not exist'); return originalFrom(name); };
  const { path: path2 } = await loanApi(db, TEAM, 'kycUpload', { loan_id: loan.id, kind: 'photo', data_url: TINY_PNG, camera_label: 'back camera' });
  assert.ok(path2, 'db/RUN-ME-007 not run yet must never fail the upload it would have logged');
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

/* THE FIELD OFFICER'S OWN NAME AND SIGNATURE, AT RECOMMENDATION -- what fingerprint capture
   was replaced with. See db/hopeloan/RUN-ME-008-officer-attestation.sql. */
test('recommendation section: the officer\'s own name and signature are saved, distinct from who the loan is assigned to', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'ATTESTED CUSTOMER', mobile: '0700000040', team: 'MABIBO', amount: 300000 });
  const { path: sigPath } = await loanApi(db, TEAM, 'kycUpload', { loan_id: loan.id, kind: 'officer-signature', data_url: TINY_PNG });
  await loanApi(db, TEAM, 'teamAssessmentSave', {
    loan_id: loan.id, section: 'recommendation',
    fields: { amount: 300000, officer_name: 'A LOAN OFFICER', officer_signature_url: sigPath },
  });
  const d = await loanApi(db, TEAM, 'teamAssessDetail', { loan_id: loan.id });
  assert.equal(d.assessment.officer_name, 'A LOAN OFFICER');
  assert.equal(d.assessment.officer_signature_url, sigPath);
});

/* THE CONSENT FORM, WHEN THE MONEY GOES TO SOMEONE ELSE'S NUMBER. See
   db/hopeloan/RUN-ME-009-other-number-form.sql -- two photos of HOPE's own paper form,
   landing on the LOAN (a fact about this disbursement), not the customer record. */
test('personal section: the other-number consent form photos land on the loan, not the customer', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'OTHER NUMBER CUSTOMER', mobile: '0700000041', team: 'MABIBO', amount: 300000 });
  const { path: formPath } = await loanApi(db, TEAM, 'kycUpload', { loan_id: loan.id, kind: 'other-number-form', data_url: TINY_PNG });
  const { path: holderPath } = await loanApi(db, TEAM, 'kycUpload', { loan_id: loan.id, kind: 'other-number-form-holder', data_url: TINY_PNG });
  await loanApi(db, TEAM, 'teamAssessmentSave', {
    loan_id: loan.id, section: 'personal',
    fields: { other_number_form_url: formPath, other_number_form_holder_url: holderPath },
  });
  const after = (await db.from('loans').select('*')).data.find(l => l.id === loan.id);
  assert.equal(after.other_number_form_url, formPath);
  assert.equal(after.other_number_form_holder_url, holderPath);
  const custAfter = (await db.from('customers').select('*')).data.find(c => c.id === loan.customer_id);
  assert.equal(custAfter.other_number_form_url, undefined, 'never written to the customer record');
});

/* THE NEIGHBOUR'S NUMBER -- WHO TO ASK IF WE CAN'T REACH THE CUSTOMER. See
   db/hopeloan/RUN-ME-010-neighbor-no.sql. "add neighbor no at customer service, they ask
   them who is near when we can't reach you, and not the guarantor, so we have alt no and
   neighbor no" -- a different person than the customer's own mobile_alt (asked later, at
   team assessment) and than the guarantor. */
test('csRegister captures the neighbour\'s number, normalised the same way every other phone is', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', {
    full_name: 'HAS A NEIGHBOUR', mobile: '0700000042', team: 'MABIBO', amount: 200000, neighbor_no: '0712345678',
  });
  const cust = (await db.from('customers').select('*')).data.find(c => c.id === loan.customer_id);
  assert.equal(cust.neighbor_no, '712345678');
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

/* The Reversals screen is drawn for finance, the GM AND credit (credit files the request), and
   the register itself is theirs alone: a team or customer-service code is refused at the server,
   which is what makes hiding the nav item a courtesy rather than the rule. */
test('reversalsList is readable by credit, finance and the GM, and refused to everyone else', async () => {
  const db = fakeDb({});
  await toDisbursed(db, 300000);
  for (const u of [CREDIT, FINANCE, GM]) {
    const list = await loanApi(db, u, 'reversalsList', {});
    assert.equal(list.eligible.length, 1, u.role + ' can read the register');
  }
  await assert.rejects(() => loanApi(db, TEAM, 'reversalsList', {}), /required tabs/i);
  await assert.rejects(() => loanApi(db, CS, 'reversalsList', {}), /required tabs/i);
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

  const { loan: loan2 } = await loanApi(db, CS, 'csRegister', {
    customer_id: loan1.customer_id, full_name: 'REVERSED CUSTOMER', mobile: '0700000009', team: 'MABIBO', amount: 300000,
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
    rows: [{ ref: '919000001', amount: 34000, trans_no: 'T-1', paid_by: '0715000001' }, { ref: '', amount: 0 }],
  });
  assert.equal(r.imported, 1, 'a row missing a reference or an amount is dropped, not guessed');
  const rows = (await db.from('payment_imports').select('*')).data;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'manual');
});

/* Both of these existed as writes with no way to read them back -- a register nobody can open
   and a shift-by-id nobody could look an id up for. */
/* "Importing payment at finance always require transaction ID too" */
test('financeImportPayments refuses the whole import when any row has no transaction ID', async () => {
  const db = fakeDb({});
  await assert.rejects(
    () => loanApi(db, FINANCE, 'financeImportPayments', { rows: [
      { ref: '919000001', amount: 34000, trans_no: 'T-1' },
      { ref: '919000002', amount: 51000 },
    ] }),
    /transaction ID[\s\S]*row 2 \(REF 919000002\)/, 'the offending row is named');
  assert.equal((await db.from('payment_imports').select('*')).data.length, 0,
    'nothing imported -- not even the good row; a partial import is a silent gap in the book');
});

test('paymentsList makes a misapplied payment findable, so shifting one is reachable', async () => {
  const db = fakeDb({});
  await loanApi(db, FINANCE, 'financeImportPayments', {
    batch: 'PAY-A', rows: [{ ref: '919000001', amount: 34000, trans_no: 'T-1' }, { ref: '919000002', amount: 51000, trans_no: 'T-2' }],
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
    rows: [{ ref: loan.loan_id, amount: 200000, paid_at: '2026-01-05', trans_no: 'T-200' }],
  });
  let after = (await db.from('loans').select('*')).data.find(l => l.id === loan.id);
  assert.equal(after.stage, 'funded', 'short of the total -- stays open');
  assert.equal(after.real_end_date, undefined);

  await loanApi(db, FINANCE, 'financeImportPayments', {
    rows: [{ ref: loan.loan_id, amount: 208000, paid_at: '2026-01-19', trans_no: 'T-208' }],
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
  await loanApi(db, FINANCE, 'financeImportPayments', { rows: [{ ref: loan.loan_id, amount: 999999999, trans_no: 'T-STRAY' }] });
  const after = (await db.from('loans').select('*')).data.find(l => l.id === loanId);
  assert.equal(after.stage, 'approved', 'never disbursed or funded -- a stray payment cannot close it');
});

test('shifting a payment onto a ref can be the transaction that finally closes it', async () => {
  const db = fakeDb({});
  const loan = await toFunded(db, 300000);   // loan_amt = 408000
  await loanApi(db, FINANCE, 'financeImportPayments', {
    rows: [{ ref: 'WRONG-REF', amount: 408000, paid_at: '2026-02-10', trans_no: 'T-408' }],
  });
  await loanApi(db, FINANCE, 'financeImportPayments', { rows: [{ ref: 'WRONG-REF', amount: 1, trans_no: 'T-ONE' }] });
  const rows = (await db.from('payment_imports').select('*')).data.filter(p => p.ref === 'WRONG-REF' && p.amount === 408000);
  await loanApi(db, FINANCE, 'financeShiftPayment', { payment_id: rows[0].id, to_ref: loan.loan_id, reason: 'misapplied slip' });
  const after = (await db.from('loans').select('*')).data.find(l => l.id === loan.id);
  assert.equal(after.stage, 'closed');
  assert.equal(after.real_end_date, '2026-02-10');
});

/* =====================================================================================
   EQUIVALENCE -- the batched financeMarkFunded / financeImportPayments must compute the
   exact same answer the old per-item loop did, not merely a faster-looking one.
   =====================================================================================
   Each OLD_ helper below is the pre-batching algorithm, reproduced call-for-call (this is the
   ground truth being compared against, not the code under test). Run against a freshly cloned
   fixture alongside the real, batched loanApi call, then diff the two `loans` tables and the
   two `loan_events` tables. funded_at/updated_at are excluded from the diff -- both
   implementations stamp "now" and the two runs do not share a clock tick -- everything else,
   including real_end_date (driven by the fixture's own paid_at values, not wall-clock time),
   is compared exactly. */

async function financeMarkFundedOld_(db, user, { loan_ids, batch }) {
  const ids = Array.isArray(loan_ids) ? loan_ids : [loan_ids];
  let n = 0;
  for (const id of ids) {
    const { data: rows } = await db.from('loans').select('*').eq('id', id);
    const loan = rows[0];
    if (!loan) throw new Error('That loan could not be found.');
    if (loan.stage !== 'disbursed') continue;
    const patch = { funded_at: new Date().toISOString(), funded_by: user.name, funding_batch: batch };
    const { error } = await db.from('loans')
      .update({ ...patch, stage: 'funded', updated_at: new Date().toISOString() }).eq('id', loan.id);
    if (error) throw new Error(error.message);
    await db.from('loan_events').insert({
      loan_id: loan.id, from_stage: 'disbursed', to_stage: 'funded',
      actor: user && user.name, actor_role: user && user.role,
      amount: patch.principal_amt || patch.net_disbursed || patch.team_recomm || null,
      note: 'Funded via ' + batch,
    });
    n++;
  }
  return { funded: n, batch };
}

async function closeIfFullyPaidOld_(db, user, ref) {
  if (!ref) return;
  const { data: loanRows } = await db.from('loans').select('*').eq('loan_id', ref);
  const loan = loanRows[0];
  if (!loan || loan.stage !== 'funded' || !(Number(loan.loan_amt) > 0)) return;
  const { data: payments } = await db.from('payment_imports').select('amount, paid_at').eq('ref', ref);
  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  if (paid < Number(loan.loan_amt)) return;
  const lastPaidAt = payments.reduce((max, p) => {
    const d = p.paid_at ? String(p.paid_at).slice(0, 10) : null;
    return d && (!max || d > max) ? d : max;
  }, null);
  const { error } = await db.from('loans').update({
    stage: 'closed', real_end_date: lastPaidAt || todayEAT_(), updated_at: new Date().toISOString(),
  }).eq('id', loan.id);
  if (error) throw new Error(error.message);
  await db.from('loan_events').insert({
    loan_id: loan.id, from_stage: 'funded', to_stage: 'closed',
    actor: user && user.name, actor_role: user && user.role, amount: null,
    note: 'Closed -- fully repaid (' + paid + ' against ' + loan.loan_amt + ')',
  });
}

async function financeImportPaymentsOld_(db, user, { rows, batch }) {
  const clean = (rows || []).map(r => ({
    batch, ref: r.ref || null, docket: r.docket || null, full_name: r.full_name || null,
    team: r.team || null, amount: Number(r.amount) || 0, paid_at: r.paid_at || null,
    trans_no: r.trans_no || null, paid_by: r.paid_by || null, source: 'manual', imported_by: user.name,
  })).filter(r => r.ref && r.amount);
  const { error } = await db.from('payment_imports').insert(clean);
  if (error) throw new Error(error.message);
  for (const ref of new Set(clean.map(r => r.ref))) await closeIfFullyPaidOld_(db, user, ref);
  return { imported: clean.length, batch };
}

// Strips the two wall-clock fields neither implementation can be made to agree on bit-for-bit,
// and sorts by id so the comparison does not depend on write order.
function stableLoans_(db) {
  return (db._dump('loans') || [])
    .map(({ funded_at, updated_at, ...rest }) => rest)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
function stableEvents_(db) {
  return (db._dump('loan_events') || [])
    // `id` is a generated sequence number shared across every fakeDb in the process (see
    // FakeQuery._seq) -- two independent runs never land on the same ids even when every
    // other field matches, so it is not part of what "identical" means here.
    .map(({ id, ...rest }) => rest)
    .sort((a, b) => String(a.loan_id).localeCompare(String(b.loan_id)) || String(a.to_stage).localeCompare(String(b.to_stage)));
}

test('financeMarkFunded on a mixed batch matches the old per-loan loop exactly', async () => {
  const stages = ['disbursed', 'disbursed', 'approved', 'disbursed', 'funded', 'disbursed', 'assigned', 'disbursed'];
  const fixture = stages.map((stage, i) => ({
    id: 'm' + i, loan_id: 'MREF' + i, docket_no: 'D' + i, full_name: 'C' + i, team: 'MABIBO',
    stage, principal_amt: 300000, net_disbursed: 300000, loan_amt: 408000,
  }));
  const ids = fixture.map(l => l.id);

  const dbOld = fakeDb({ loans: fixture, loan_events: [] });
  const dbNew = fakeDb({ loans: fixture, loan_events: [] });
  const rOld = await financeMarkFundedOld_(dbOld, FINANCE, { loan_ids: ids, batch: 'FUND-EQUIV' });
  const rNew = await loanApi(dbNew, FINANCE, 'financeMarkFunded', { loan_ids: ids, batch: 'FUND-EQUIV' });

  assert.equal(rNew.funded, rOld.funded, 'same count of loans actually funded');
  assert.equal(rNew.funded, 5, 'sanity: 5 of the 8 fixture loans start disbursed');
  assert.deepEqual(stableLoans_(dbNew), stableLoans_(dbOld), 'identical final loans table');
  assert.deepEqual(stableEvents_(dbNew), stableEvents_(dbOld), 'identical loan_events rows');
  // funded_at/updated_at were stripped above for the diff -- confirm the batched version still
  // actually stamps them, rather than the diff having silently made that check toothless. Only
  // the loans this run itself moved from 'disbursed' -- m4 starts already 'funded' and is
  // never touched, so it carries no funded_at either, exactly as before.
  const justFunded = fixture.filter(l => l.stage === 'disbursed').map(l => l.id);
  for (const id of justFunded) {
    const l = dbNew._dump('loans').find(x => x.id === id);
    assert.ok(l.funded_at, id + ' is funded but carries no funded_at');
    assert.ok(l.updated_at, id + ' is funded but carries no updated_at');
  }
});

test('financeImportPayments on a mixed batch of refs matches the old per-ref loop exactly', async () => {
  const fixture = [
    { id: 'f1', loan_id: 'REF1', stage: 'funded', loan_amt: 100000, principal_amt: 100000 },   // closes exactly
    { id: 'f2', loan_id: 'REF2', stage: 'funded', loan_amt: 100000, principal_amt: 100000 },   // short -- stays open
    { id: 'f3', loan_id: 'REF3', stage: 'funded', loan_amt: 150000, principal_amt: 150000 },   // closes with a prior payment already on file
    { id: 'f5', loan_id: 'REF5', stage: 'disbursed', loan_amt: 200000, principal_amt: 200000 }, // not funded -- must never auto-close
    { id: 'f7', loan_id: 'REF7', stage: 'funded', loan_amt: 0, principal_amt: 0 },              // loan_amt <= 0 -- never closes
    { id: 'f8', loan_id: 'REF8', stage: 'funded', loan_amt: 50000, principal_amt: 50000 },      // closes on TWO rows in this same import
    { id: 'f9', loan_id: 'REF9', stage: 'funded', loan_amt: 20000, principal_amt: 20000 },      // closes with no paid_at at all -- today's date
  ].map(l => ({ docket_no: l.id, full_name: l.id, team: 'MABIBO', ...l }));
  const existingPayments = [
    { id: 'pp1', ref: 'REF3', amount: 100000, paid_at: '2025-12-20' },
  ];
  const importRows = [
    { ref: 'REF1', amount: 100000, paid_at: '2026-01-05', trans_no: 'T1' },
    { ref: 'REF2', amount: 60000, paid_at: '2026-01-06', trans_no: 'T2' },
    { ref: 'REF3', amount: 50000, paid_at: '2026-01-10', trans_no: 'T3' },
    { ref: 'REF5', amount: 999999, paid_at: '2026-01-01', trans_no: 'T5' },
    { ref: 'REF-GHOST', amount: 5000, paid_at: '2026-01-01', trans_no: 'T6' },   // no matching loan at all
    { ref: 'REF7', amount: 1000, paid_at: '2026-01-01', trans_no: 'T7' },
    { ref: 'REF8', amount: 30000, paid_at: '2026-01-02', trans_no: 'T8a' },
    { ref: 'REF8', amount: 20000, paid_at: '2026-01-09', trans_no: 'T8b' },
    { ref: 'REF9', amount: 20000, paid_at: null, trans_no: 'T9' },
  ];

  const dbOld = fakeDb({ loans: fixture, payment_imports: existingPayments, loan_events: [] });
  const dbNew = fakeDb({ loans: fixture, payment_imports: existingPayments, loan_events: [] });
  const rOld = await financeImportPaymentsOld_(dbOld, FINANCE, { rows: importRows, batch: 'PAY-EQUIV' });
  const rNew = await loanApi(dbNew, FINANCE, 'financeImportPayments', { rows: importRows, batch: 'PAY-EQUIV' });

  assert.equal(rNew.imported, rOld.imported);
  assert.equal(rNew.imported, importRows.length);
  assert.deepEqual(stableLoans_(dbNew), stableLoans_(dbOld), 'identical final loans table');
  assert.deepEqual(stableEvents_(dbNew), stableEvents_(dbOld), 'identical loan_events rows');

  // And pin down what "identical" actually means here, so a bug shared by both OLD_ and the
  // real code -- which the diff above cannot catch -- still fails this test.
  const byId = Object.fromEntries(dbNew._dump('loans').map(l => [l.id, l]));
  assert.equal(byId.f1.stage, 'closed'); assert.equal(byId.f1.real_end_date, '2026-01-05');
  assert.equal(byId.f2.stage, 'funded', 'short of the total -- stays open');
  assert.equal(byId.f3.stage, 'closed', 'closed by the prior payment plus this import together');
  assert.equal(byId.f3.real_end_date, '2026-01-10', 'the LATEST payment on file, old or new');
  assert.equal(byId.f5.stage, 'disbursed', 'never funded -- a stray payment cannot close it');
  assert.equal(byId.f7.stage, 'funded', 'loan_amt <= 0 never closes');
  assert.equal(byId.f8.stage, 'closed', 'two rows in the SAME import together cover it');
  assert.equal(byId.f8.real_end_date, '2026-01-09');
  assert.equal(byId.f9.stage, 'closed', 'closes even with no paid_at on file');
  assert.equal(byId.f9.real_end_date, todayEAT_());
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
   RUN-ME-011 -- multi-photo business/residence, the 10-photo contract, its retention,
   contract email automation, call verification at approval, and the Assessment Plan screen.
   ===================================================================================== */

test('business section saves all three named photos, not just the first', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'A', mobile: '0700000020', team: 'MABIBO', amount: 300000 });
  await loanApi(db, MGR, 'managerAssign', { loan_id: loan.id, team: 'MABIBO' });
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan.id, section: 'business', fields: {
    business_verify_photo_url: 'p1', business_verify_photo2_url: 'p2', business_verify_photo3_url: 'p3',
  } });
  const loanRow = (await db.from('loans').select('*').eq('id', loan.id)).data[0];
  const cust = db._dump('customers').find(c => c.docket === loanRow.docket_ref);
  assert.equal(cust.business_verify_photo_url, 'p1');
  assert.equal(cust.business_verify_photo2_url, 'p2');
  assert.equal(cust.business_verify_photo3_url, 'p3');
});

test('residence section saves all four customer photos, and guarantor save saves all four of theirs', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'A', mobile: '0700000021', team: 'MABIBO', amount: 300000 });
  await loanApi(db, MGR, 'managerAssign', { loan_id: loan.id, team: 'MABIBO' });
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan.id, section: 'residence', fields: {
    residence_verify_photo_url: 'r1', residence_verify_photo2_url: 'r2',
    residence_verify_photo3_url: 'r3', residence_verify_photo4_url: 'r4',
  } });
  const loanRow = (await db.from('loans').select('*').eq('id', loan.id)).data[0];
  const cust = db._dump('customers').find(c => c.docket === loanRow.docket_ref);
  assert.deepEqual([cust.residence_verify_photo_url, cust.residence_verify_photo2_url, cust.residence_verify_photo3_url, cust.residence_verify_photo4_url],
    ['r1', 'r2', 'r3', 'r4']);

  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan.id, section: 'guarantor', fields: { guarantors: [{
    full_name: 'A GUARANTOR', phone: '0715000009',
    residence_verify_photo_url: 'g1', residence_verify_photo2_url: 'g2',
    residence_verify_photo3_url: 'g3', residence_verify_photo4_url: 'g4',
  }] } });
  const g = db._dump('guarantors').find(x => x.loan_id === loan.id && x.rank === 0);
  assert.deepEqual([g.residence_verify_photo_url, g.residence_verify_photo2_url, g.residence_verify_photo3_url, g.residence_verify_photo4_url],
    ['g1', 'g2', 'g3', 'g4']);
});

test('contract photos accumulate on the loan and are capped at ten; the first one signs the assessment', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 300000);
  let a = (await db.from('assessments').select('*').eq('loan_id', loanId)).data[0];
  assert.equal(!!a.contract_signed, false);

  // A real capture is always at least a millisecond after the last (a live camera shot, an
  // upload round trip); ten in a tight loop here can land on the very same millisecond, which
  // would collide on kycUpload's own Date.now()-based filename -- nothing this test means to
  // prove, so it is given the same headroom a real capture always has for free.
  for (let i = 0; i < 10; i++) {
    await loanApi(db, TEAM, 'kycUpload', { loan_id: loanId, kind: 'contract', data_url: TINY_PNG });
    await new Promise(r => setTimeout(r, 2));
  }
  const loan = (await db.from('loans').select('*').eq('id', loanId)).data[0];
  assert.equal(loan.contract_photo_urls.length, 10);
  a = (await db.from('assessments').select('*').eq('loan_id', loanId)).data[0];
  assert.equal(a.contract_signed, true, 'signed the moment the first page landed');

  await assert.rejects(
    () => loanApi(db, TEAM, 'kycUpload', { loan_id: loanId, kind: 'contract', data_url: TINY_PNG }),
    /Already at 10/);
});

test('an unapproved loan\'s contract photos are purged once they are more than three days old', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 300000);
  await loanApi(db, TEAM, 'kycUpload', { loan_id: loanId, kind: 'contract', data_url: TINY_PNG });
  let loan = (await db.from('loans').select('*').eq('id', loanId)).data[0];
  assert.equal(loan.contract_photo_urls.length, 1);

  // Backdate the one capture's own embedded timestamp past the 3-day line, the same way a
  // genuinely old file's path would read.
  const stale = 'loans/' + loanId + '/contract-' + (Date.now() - 4 * 24 * 60 * 60 * 1000) + '.jpg';
  await db.from('loans').update({ contract_photo_urls: [stale] }).eq('id', loanId);
  await db.storage.from('kyc-photos').upload(stale, Buffer.from('x'), { upsert: true });

  await loanApi(db, TEAM, 'teamAssessDetail', { loan_id: loanId });   // the natural read that triggers the lazy prune
  loan = (await db.from('loans').select('*').eq('id', loanId)).data[0];
  assert.deepEqual(loan.contract_photo_urls, []);
  assert.deepEqual(db._storageDump('kyc-photos')[stale], undefined, 'the raw file is gone too, not just the reference');
});

test('a fresh (under three days) contract photo survives opening the assessment', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 300000);
  await loanApi(db, TEAM, 'kycUpload', { loan_id: loanId, kind: 'contract', data_url: TINY_PNG });
  await loanApi(db, TEAM, 'teamAssessDetail', { loan_id: loanId });
  const loan = (await db.from('loans').select('*').eq('id', loanId)).data[0];
  assert.equal(loan.contract_photo_urls.length, 1, 'one day old is nowhere near the three-day line');
});

test('approval assembles the contract photos into one PDF, emails it, and clears the raw photos', async () => {
  process.env.RESEND_API_KEY = 'test-resend-key';
  let mailBody = null;
  _setMailFetch(async (url, opts) => {
    mailBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ id: 'mail-1' }) };
  });
  const db = fakeDb({ settings: [{ key: 'CONTRACT_EMAIL', value: 'legal@hope.example' }, { key: 'EMAIL_FROM', value: 'HOPE <n@hope.example>' }] });
  const { loanId } = await registerAssignAssess(db, 300000);
  await loanApi(db, TEAM, 'kycUpload', { loan_id: loanId, kind: 'contract', data_url: TINY_PNG });
  await new Promise(r => setTimeout(r, 2));
  await loanApi(db, TEAM, 'kycUpload', { loan_id: loanId, kind: 'contract', data_url: TINY_PNG });
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });

  const r = await loanApi(db, CREDIT, 'creditApprove', { loan_id: loanId, granted_amount: 300000 });
  assert.equal(r.contract.built, true);
  assert.ok(r.contract.pdfPath);
  assert.equal(r.contract.mail.sent, true);
  assert.ok(mailBody, 'sendMail actually reached the (mocked) network');
  assert.equal(mailBody.attachments.length, 1);
  assert.match(mailBody.attachments[0].filename, /\.pdf$/);

  const a = (await db.from('assessments').select('*').eq('loan_id', loanId)).data[0];
  assert.equal(a.contract_url, r.contract.pdfPath);
  const loan = (await db.from('loans').select('*').eq('id', loanId)).data[0];
  assert.deepEqual(loan.contract_photo_urls, [], 'consolidated into the PDF -- the loose pages are gone');
  assert.ok(db._storageDump('kyc-photos')[r.contract.pdfPath], 'the assembled PDF itself is on file');

  delete process.env.RESEND_API_KEY;
  _setMailFetch(null);
});

test('approval with no captured contract photos never builds a PDF or emails anything', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 300000);
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  const r = await loanApi(db, CREDIT, 'creditApprove', { loan_id: loanId, granted_amount: 300000 });
  assert.equal(r.contract.built, false);
});

test('creditCallCheck and the same check recorded at approval read the analyst\'s OWN synced call log, not a checkbox', async () => {
  const callDb = fakeDb({ call_logs: [
    { phone: '763357860', officer: CREDIT.name, outcome: 'CONNECTED', duration: 45, call_date: '2026-09-18' },
    { phone: '763357860', officer: 'SOMEONE ELSE', outcome: 'CONNECTED', duration: 900, call_date: '2026-09-18' },
  ] });
  _setCallLogsDb(callDb);
  try {
    const db = fakeDb({});
    const { loanId } = await registerAssignAssess(db, 300000);
    const check = await loanApi(db, CREDIT, 'creditCallCheck', { loan_id: loanId });
    assert.equal(check.verified, true, '45s from the ANALYST\'s own log clears the 30s default threshold');
    assert.equal(check.seconds, 45, 'not the 900s that belongs to a different officer\'s row');

    await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
    const r = await loanApi(db, CREDIT, 'creditApprove', { loan_id: loanId, granted_amount: 300000 });
    assert.equal(r.callCheck.verified, true);
    const a = (await db.from('assessments').select('*').eq('loan_id', loanId)).data[0];
    assert.equal(a.call_verified, true);
    assert.equal(a.call_verified_seconds, 45);
    assert.ok(a.call_verified_at);
  } finally {
    _setCallLogsDb(fakeDb({}));   // back to the file's own empty default for every test after this one
  }
});

test('a call under the minute threshold does not verify, and an unreachable call_logs never blocks approval', async () => {
  const shortCallDb = fakeDb({ call_logs: [
    { phone: '763357860', officer: CREDIT.name, outcome: 'CONNECTED', duration: 5, call_date: '2026-09-18' },
  ] });
  _setCallLogsDb(shortCallDb);
  try {
    const db = fakeDb({});
    const { loanId } = await registerAssignAssess(db, 300000);
    const check = await loanApi(db, CREDIT, 'creditCallCheck', { loan_id: loanId });
    assert.equal(check.verified, false, '5s is under the 30s default');
    assert.equal(check.seconds, 5);
  } finally {
    _setCallLogsDb(fakeDb({}));
  }

  // A call_logs read that throws must not take approval down with it -- see finalizeContractOnApproval_'s
  // own never-block rule, applied here to the OTHER new network read creditApprove now makes.
  const brokenDb = { from() { throw new Error('network is down'); } };
  _setCallLogsDb(brokenDb);
  try {
    const db = fakeDb({});
    const { loanId } = await registerAssignAssess(db, 300000);
    await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
    const r = await loanApi(db, CREDIT, 'creditApprove', { loan_id: loanId, granted_amount: 300000 });
    assert.equal(r.callCheck.verified, false);
    const loan = (await db.from('loans').select('*').eq('id', loanId)).data[0];
    assert.equal(loan.stage, 'approved', 'the approval itself went through despite call_logs being unreachable');
  } finally {
    _setCallLogsDb(fakeDb({}));
  }
});

test('Assessment Plan: a new plan must be dated today or later, and lists sorted by date with elapsedDays', async () => {
  const db = fakeDb({});
  const today = todayEAT_();
  const yesterday = addDaysKey(today, -1);
  await assert.rejects(
    () => loanApi(db, TEAM, 'assessmentPlanSave', { full_name: 'PROSPECT A', phone: '0715000030', planned_date: yesterday }),
    /today or later/);
  await loanApi(db, TEAM, 'assessmentPlanSave', { full_name: 'PROSPECT A', phone: '0715000030', planned_date: today });
  const r = await loanApi(db, TEAM, 'assessmentPlanList', {});
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].elapsedDays, 0);
  assert.ok(r.staleReasons.length > 0);
});

test('Assessment Plan: once its own planned date has passed, only the stale-reason dropdown can still change', async () => {
  const db = fakeDb({ assessment_plans: [{
    id: 'plan-1', team: 'MABIBO', full_name: 'PROSPECT B', phone: '0715000031',
    planned_date: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10),
  }] });
  await loanApi(db, TEAM, 'assessmentPlanSave', {
    id: 'plan-1', full_name: 'RENAMED -- SHOULD NOT STICK', planned_date: todayEAT_(),
    stale_reason: 'Amekataa / Declined',
  });
  const row = db._dump('assessment_plans')[0];
  assert.equal(row.full_name, 'PROSPECT B', 'the name/date past their own planned date do not move');
  assert.equal(row.stale_reason, 'Amekataa / Declined', 'but the stale reason does');
});

test('Assessment Plan: 30+ days past its own planned date autodeletes on the next list read', async () => {
  const db = fakeDb({ assessment_plans: [{
    id: 'plan-old', team: 'MABIBO', full_name: 'OLD PROSPECT', phone: '0715000032',
    planned_date: new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10),
  }] });
  const r = await loanApi(db, TEAM, 'assessmentPlanList', {});
  assert.equal(r.rows.length, 0);
  assert.equal(db._dump('assessment_plans').length, 0, 'gone from the table, not just hidden from this read');
});

/* "Users with multiple teams should also be able to create assessment plan ... they get their
   granted teams at access codes as we always pivot" */
test('Assessment Plan: a code holding several teams sees only those, pivots within them, and must pick one to save', async () => {
  const TWO = { code: 'T2', name: 'A TWO-TEAM LEADER', role: 'TEAM LEADER', tabs: ['team'], teams: ['MABIBO', 'KAWE'] };
  const soon = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const db = fakeDb({ assessment_plans: [
    { id: 'p-mab', team: 'MABIBO', full_name: 'IN MABIBO', phone: '0715000040', planned_date: soon },
    { id: 'p-kawe', team: 'KAWE', full_name: 'IN KAWE', phone: '0715000041', planned_date: soon },
    { id: 'p-other', team: 'TANDIKA', full_name: 'SOMEBODY ELSE\'S', phone: '0715000042', planned_date: soon },
  ] });

  const all = await loanApi(db, TWO, 'assessmentPlanList', {});
  assert.deepEqual(all.teams, ['MABIBO', 'KAWE'], 'the pivot offers exactly the granted teams, in the code\'s own order');
  assert.deepEqual(all.rows.map(r => r.team).sort(), ['KAWE', 'MABIBO'], 'TANDIKA is not this code\'s to see');

  const kawe = await loanApi(db, TWO, 'assessmentPlanList', { team: 'kawe' });
  assert.deepEqual(kawe.rows.map(r => r.id), ['p-kawe'], 'the pivot filters, matched case-insensitively');
  const outside = await loanApi(db, TWO, 'assessmentPlanList', { team: 'TANDIKA' });
  assert.deepEqual(outside.rows.map(r => r.team).sort(), ['KAWE', 'MABIBO'], 'a pivot outside the grant is not honoured, not answered');

  await assert.rejects(() => loanApi(db, TWO, 'assessmentPlanSave', { full_name: 'X', planned_date: soon }), /Choose one of your own teams/);
  await assert.rejects(() => loanApi(db, TWO, 'assessmentPlanSave', { full_name: 'X', planned_date: soon, team: 'TANDIKA' }), /Choose one of your own teams/);
  await loanApi(db, TWO, 'assessmentPlanSave', { full_name: 'NEW IN KAWE', planned_date: soon, team: 'kawe' });
  const saved = db._dump('assessment_plans').find(r => r.full_name === 'NEW IN KAWE');
  assert.equal(saved.team, 'KAWE', 'stored under the granted spelling, not whatever case was typed');

  await assert.rejects(() => loanApi(db, TWO, 'assessmentPlanSave', { id: 'p-other', full_name: 'HIJACK', planned_date: soon }),
    e => e.status === 403, 'editing another team\'s plan is refused, not just hidden');
  await loanApi(db, TWO, 'assessmentPlanSave', { id: 'p-mab', full_name: 'MOVED', planned_date: soon, team: 'KAWE' });
  assert.equal(db._dump('assessment_plans').find(r => r.id === 'p-mab').team, 'KAWE', 'a future-dated plan can be moved between held teams');
});

test('Assessment Plan: a code granted every team is offered the whole register to pivot on', async () => {
  const db = fakeDb({ teams: [{ team: 'MABIBO', branch: 'B' }, { team: 'KAWE', branch: 'B' }, { team: 'MABIBO', branch: 'B' }] });
  const r = await loanApi(db, ADMIN, 'assessmentPlanList', {});
  assert.deepEqual(r.teams, ['KAWE', 'MABIBO'], 'every team, once each, sorted');
  const soon = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await assert.rejects(() => loanApi(db, ADMIN, 'assessmentPlanSave', { full_name: 'X', planned_date: soon }), /Choose one of your own teams/);
  await loanApi(db, ADMIN, 'assessmentPlanSave', { full_name: 'X', planned_date: soon, team: 'KAWE' });
  assert.equal(db._dump('assessment_plans')[0].team, 'KAWE');
});

test('Assessment Plan: a matching approved loan autodeletes the plan that predicted it', async () => {
  const db = fakeDb({});
  const { loanId } = await registerAssignAssess(db, 300000);   // registers mobile 0763357860 -- see the top of this file
  await loanApi(db, TEAM, 'teamSubmit', { loan_id: loanId, decision: 'ACCEPTED' });
  await loanApi(db, CREDIT, 'creditApprove', { loan_id: loanId, granted_amount: 300000 });
  await loanApi(db, TEAM, 'assessmentPlanSave', { full_name: 'ASHA, PLANNED EARLIER', phone: '0763357860', planned_date: todayEAT_() });

  const r = await loanApi(db, TEAM, 'assessmentPlanList', {});
  assert.equal(r.rows.length, 0, 'the plan did its job -- there is now a real approved loan for this phone number');
});

/* =====================================================================================
   THE ASSESSMENT PLAN CARRIES THE RECOMMENDATION'S DRAFT, AND MERGES INTO THE LOAN AT ASSIGN.
   =====================================================================================
   "We allow our customers to double loans when they reach 10+ installments. Now it happens a
    team has a customer at 9, they visit this customer later the customer pays the 10th so as
    to get assigned (customer service never register under 10) so assessment plan should ...
    allow the pre-fillable info of loan recommendation at assessment plan and saving only -
    submitting will only happen at recommendation ... so if assigned no = assessment plan
    number, merge both for the single customer into recommendation" */
const PLAN_DRAFT = {
  personal: { dob: '1988-05-05', gender: 'Female', id_type: 'NIDA', national_id: '19880505-00000-00001-01', first_name: 'ASHA', photo_url: 'plans/p1/photo-1.jpg' },
  business: { verified: true, business_name: 'ASHA MAMA LISHE', daily_profit: '20000', business_verify_photo_url: 'plans/p1/business-1.jpg' },
  residence: { verified: true, guarantor_verified: false, street: 'MABIBO KATI', ward: 'MABIBO', district: 'UBUNGO' },
  guarantor: { guarantors: [
    { full_name: 'A GUARANTOR', phone: '0715000001', relationship: 'Sister' },
    { full_name: 'ALT ONE', phone: '0715000002', relationship: 'Friend' },
    { full_name: 'ALT TWO', phone: '0715000003', relationship: 'Friend' },
    { full_name: 'ALT THREE', phone: '0715000004', relationship: 'Neighbour' } ] },
  recommendation: { amount: 450000, credit_score: '7.5', zone: 'Mabibo', remarks: 'Visited at 9 installments', officer_name: 'A LOAN OFFICER' },
};
const soonKey_ = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

test('Assessment Plan: the recommendation is drafted on the plan section by section, saving only', async () => {
  const db = fakeDb({ assessment_plans: [{ id: 'p1', team: 'MABIBO', full_name: 'ASHA', phone: '0763357860', planned_date: soonKey_() }] });
  await assert.rejects(() => loanApi(db, TEAM, 'assessmentPlanDraftSave', { id: 'p1', section: 'contract', fields: {} }), /Unknown assessment section/);
  await assert.rejects(() => loanApi(db, TEAM, 'assessmentPlanDraftSave', { id: 'nope', section: 'personal', fields: {} }), /could not be found/);
  for (const [section, fields] of Object.entries(PLAN_DRAFT)) {
    await loanApi(db, TEAM, 'assessmentPlanDraftSave', { id: 'p1', section, fields });
  }
  const row = db._dump('assessment_plans')[0];
  assert.deepEqual(row.draft, PLAN_DRAFT, 'every section, in the field names the form sends');
  assert.equal(row.updated_by, TEAM.name);
  // A section is replaced whole, never merged key by key: a cleared photo stays cleared.
  await loanApi(db, TEAM, 'assessmentPlanDraftSave', { id: 'p1', section: 'business', fields: { verified: false, business_name: 'RENAMED' } });
  assert.deepEqual(db._dump('assessment_plans')[0].draft.business, { verified: false, business_name: 'RENAMED' });
  // Nothing touched a customer or a loan -- there is none.
  assert.equal(db._dump('customers').length, 0); assert.equal(db._dump('loans').length, 0);
  const list = await loanApi(db, TEAM, 'assessmentPlanList', {});
  assert.deepEqual(list.rows[0].draftSections, ['personal', 'recommendation', 'guarantor', 'residence', 'business']);
  // Another team's plan is refused, the same rule the plan's own save applies.
  const OTHER = { ...TEAM, code: 'T9', teams: ['KAWE'] };
  await assert.rejects(() => loanApi(db, OTHER, 'assessmentPlanDraftSave', { id: 'p1', section: 'personal', fields: {} }), e => e.status === 403);
});

test('Assessment Plan: photos are captured under the plan, and the contract is refused until there is a loan', async () => {
  const db = fakeDb({ assessment_plans: [{ id: 'p1', team: 'MABIBO', full_name: 'ASHA', phone: '0763357860', planned_date: soonKey_() }] });
  const png = 'data:image/png;base64,' + Buffer.from('not-really-a-png').toString('base64');
  const r = await loanApi(db, TEAM, 'kycUpload', { plan_id: 'p1', kind: 'business', data_url: png });
  assert.match(r.path, /^plans\/p1\/business-\d+\.png$/);
  await assert.rejects(() => loanApi(db, TEAM, 'kycUpload', { plan_id: 'p1', kind: 'contract', data_url: png }), /once the loan exists/);
  const OTHER = { ...TEAM, code: 'T9', teams: ['KAWE'] };
  await assert.rejects(() => loanApi(db, OTHER, 'kycUpload', { plan_id: 'p1', kind: 'photo', data_url: png }), e => e.status === 403);
});

async function seedPlan_(db, user, { id, team, draft }) {
  await loanApi(db, user, 'assessmentPlanSave', { full_name: 'ASHA', phone: '0763357860', planned_date: soonKey_(), team });
  const row = db._dump('assessment_plans').find(r => r.team === team && !r._seeded);
  row._seeded = true; row.id = id;
  for (const [section, fields] of Object.entries(draft || {})) await loanApi(db, user, 'assessmentPlanDraftSave', { id, section, fields });
  return row;
}
test('Assessment Plan: assigning a loan whose phone matches a plan merges the draft into the recommendation', async () => {
  const db = fakeDb({});
  await seedPlan_(db, TEAM, { id: 'p1', team: 'MABIBO', draft: PLAN_DRAFT });
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'ASHA OMARI IDDI', mobile: '0763357860', team: 'MABIBO', amount: 400000 });
  const r = await loanApi(db, MGR, 'managerAssign', { loan_id: loan.id, team: 'MABIBO' });
  assert.ok(r.planMerged, 'the answer says a plan was found');
  assert.equal(r.planMerged.error, null);
  assert.deepEqual(r.planMerged.sections, ['personal', 'recommendation', 'guarantor', 'residence', 'business']);
  assert.equal(r.planMerged.planned_by, TEAM.name);

  const after = (await db.from('loans').select('*').eq('id', loan.id)).data[0];
  assert.equal(after.stage, 'unassessed', 'the assessment has started -- exactly as if the officer had saved a section');
  assert.equal(after.team, 'MABIBO');
  const a = db._dump('assessments').find(x => x.loan_id === loan.id);
  assert.ok(a, 'an assessment row exists');
  for (const s of ['personal', 'business', 'residence', 'guarantor', 'recommendation']) assert.equal(a['done_' + s], true, s + ' is done');
  assert.equal(Number(a.recommend_amount), 450000);
  assert.equal(a.zone_visited, 'Mabibo');
  assert.equal(a.credit_score, 7.5);
  assert.equal(a.business_verified, true); assert.equal(a.residence_verified, true); assert.equal(a.guarantor_residence_verified, false);
  assert.equal(a.submitted_by, TEAM.name, 'filed under the officer who captured it, not the manager who pressed Assign');
  const c = db._dump('customers').find(x => x.id === loan.customer_id);
  assert.equal(c.dob, '1988-05-05'); assert.equal(c.first_name, 'ASHA');
  assert.equal(c.business_name, 'ASHA MAMA LISHE'); assert.equal(Number(c.weekly_profit), 120000, 'derived exactly as the form save derives it');
  assert.equal(c.street, 'MABIBO KATI'); assert.equal(c.photo_url, 'plans/p1/photo-1.jpg', 'the plan-owned photo path rides across');
  const gs = db._dump('guarantors').filter(x => x.loan_id === loan.id);
  assert.equal(gs.length, 4); assert.equal(gs[0].full_name, 'A GUARANTOR'); assert.equal(gs[0].rank, 0);
  assert.equal(db._dump('assessment_plans').length, 0, 'the plan did its job and is gone');
  const ev = db._dump('loan_events').find(e => /Assessment plan merged/.test(String(e.note || '')));
  assert.ok(ev, 'the loan\'s own history says the draft came from a plan');
  // The drawer opens on the merged data, and the officer can carry on editing it.
  const d = await loanApi(db, TEAM, 'teamAssessDetail', { loan_id: loan.id });
  assert.equal(d.customer.business_name, 'ASHA MAMA LISHE');
  assert.equal(d.guarantors.length, 4);
  await loanApi(db, TEAM, 'teamAssessmentSave', { loan_id: loan.id, section: 'recommendation', fields: { amount: 500000, zone: 'Mabibo', remarks: 'raised' } });
  assert.equal(Number(db._dump('assessments').find(x => x.loan_id === loan.id).recommend_amount), 500000);
});

test('Assessment Plan: the assigned team\'s own plan is the one merged when several teams planned the same number', async () => {
  const db = fakeDb({});
  const KAWE_U = { ...TEAM, code: 'TK', name: 'KAWE OFFICER', teams: ['KAWE'] };
  const mab = await seedPlan_(db, TEAM, { id: 'p-mab', team: 'MABIBO', draft: { recommendation: { amount: 2 } } });
  const kawe = await seedPlan_(db, KAWE_U, { id: 'p-kawe', team: 'KAWE', draft: { recommendation: { amount: 1 } } });
  mab.updated_at = '2026-09-19T10:00:00Z'; kawe.updated_at = '2026-09-20T10:00:00Z';   // KAWE's is the newer
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'ASHA OMARI IDDI', mobile: '0763357860', team: 'MABIBO', amount: 400000 });
  const r = await loanApi(db, MGR, 'managerAssign', { loan_id: loan.id, team: 'MABIBO' });
  assert.equal(r.planMerged.plan_id, 'p-mab', 'MABIBO\'s plan, although KAWE\'s is newer');
  assert.equal(Number(db._dump('assessments').find(x => x.loan_id === loan.id).recommend_amount), 2);
  assert.deepEqual(db._dump('assessment_plans').map(p => p.id), ['p-kawe'], 'the other team\'s plan is left alone');
});

test('Assessment Plan: a matching plan with nothing drafted is closed at assign, and the loan stays at assigned', async () => {
  const db = fakeDb({});
  await seedPlan_(db, TEAM, { id: 'p1', team: 'MABIBO' });
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'ASHA OMARI IDDI', mobile: '0763357860', team: 'MABIBO', amount: 400000 });
  const r = await loanApi(db, MGR, 'managerAssign', { loan_id: loan.id, team: 'MABIBO' });
  assert.deepEqual(r.planMerged.sections, []);
  assert.equal(r.planMerged.error, null);
  assert.equal((await db.from('loans').select('*').eq('id', loan.id)).data[0].stage, 'assigned');
  assert.equal(db._dump('assessments').length, 0, 'nothing invented');
  assert.equal(db._dump('assessment_plans').length, 0);
  // And no plan at all: the answer says so with null, and the assignment is unchanged.
  const { loan: loan2 } = await loanApi(db, CS, 'csRegister', { full_name: 'NOBODY PLANNED', mobile: '0763357861', team: 'MABIBO', amount: 400000 });
  const r2 = await loanApi(db, MGR, 'managerAssign', { loan_id: loan2.id, team: 'MABIBO' });
  assert.equal(r2.planMerged, null);
});

test('Assessment Plan: a plan for a customer already assigned says so on the row, pointing at the recommendation', async () => {
  const db = fakeDb({});
  const { loan } = await loanApi(db, CS, 'csRegister', { full_name: 'ASHA OMARI IDDI', mobile: '0763357860', team: 'MABIBO', amount: 400000 });
  await loanApi(db, MGR, 'managerAssign', { loan_id: loan.id, team: 'MABIBO' });
  await loanApi(db, TEAM, 'assessmentPlanSave', { full_name: 'ASHA, PLANNED LATE', phone: '0763357860', planned_date: soonKey_() });
  const r = await loanApi(db, TEAM, 'assessmentPlanList', {});
  assert.equal(r.rows.length, 1, 'not pruned -- the loan is not approved, it is with the team');
  assert.equal(r.rows[0].assignedRef, loan.loan_id);
  assert.equal(r.rows[0].assignedTeam, 'MABIBO');
});
