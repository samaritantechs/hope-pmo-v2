// The Fraud Detector: every approved loan's parties against every other approved loan's and the
// current defaults sheet, newest first, team-scoped at the database.
//   "I need a new nav 'Fraud Detector' where every approved loan with a number or name among
//    customer, guarantor or receiver that still exists in an another approved of the three
//    columns or in the current defaults sheet, auto list the case list that will open card
//    details containing previous involved loan details vs current. Autosorted newest to oldest"

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');
const { nameKey, phoneKey, detect, MAX_LINKS } = await import('../api/_lib/fraud.js');

const NOW = Date.parse('2026-10-23T09:00:00Z');
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['fraud'] };
const GMO = { code: 'G', name: 'JUMA G', role: 'GMO', teams: ['KONGOWE'], tabs: ['fraud'] };
const NOTAB = { code: 'X', name: 'NOBODY', role: 'FIELD', teams: ['KONGOWE'], tabs: ['dashboard'] };

/* A loan as the origination writes it. The REF is docket digits + track (docket.js). */
let n = 0;
const L = (over) => ({
  id: 'L' + (++n), docket_no: null, loan_id: null, track_no: '1', full_name: null, contact: null, momo: null,
  recipient_full_name: null, recipient_momo: null, guarantor_name: null, guarantor_contact: null,
  team: 'KONGOWE', zone: 'SOUTH', product: 'BIASHARA', principal_amt: 500000, loan_amt: 600000, net_disbursed: 480000,
  stage: 'disbursed', approved_date: '2026-09-01', disb_date: '2026-09-02', approved_by: 'THE GM', created_by: 'OFFICER O',
  recommended_by: 'MANAGER M', created_at: '2026-09-01T06:00:00Z', ...over,
});
const D = (over) => ({
  ref: null, docket_no: null, full_name: null, contact: null, guarantor_name: null, guarantor_contact: null,
  team: 'KONGOWE', status: 'Defaulter', dc: 4, days_elapsed: 40, arrears: 120000, balance: 400000, disb_date: '2026-08-01',
  snapshot_type: 'current', weekday: 'THU', snapshot_date: '2026-10-22', upload_batch: 'b1', created_at: '2026-10-22T04:00:00Z', ...over,
});

function tables() {
  n = 0;
  return {
    teams: [{ team: 'KONGOWE' }, { team: 'MBAGALA' }],
    access_codes: [{ code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] }],
    roles: [], settings: [],
    loans: [
      // L1: AMINA's first loan, 2026-08-01 -- her own row is on the defaults sheet (D1)
      L({ docket_no: '1-100-200001', track_no: '1', full_name: 'AMINA JUMA', contact: '0712000001', momo: '0712000001',
        recipient_full_name: 'AMINA JUMA', recipient_momo: '0712000001', guarantor_name: 'FATUMA ALLY', guarantor_contact: '0713000001',
        approved_date: '2026-08-01', disb_date: '2026-08-02', created_at: '2026-08-01T06:00:00Z' }),
      // L2: JOSEPH, 2026-09-10 -- receiver number shared with L3; guarantor HALIMA is a defaulter (D2)
      L({ docket_no: '1-100-200002', track_no: '1', full_name: 'JOSEPH MWITA', contact: '0712000002', momo: '0712000002',
        recipient_full_name: 'ALEX ISAYA', recipient_momo: '0799000099', guarantor_name: 'HALIMA SAID', guarantor_contact: '0713000002',
        approved_date: '2026-09-10', disb_date: '2026-09-11', created_at: '2026-09-10T06:00:00Z' }),
      // L3: GRACE in MBAGALA, 2026-10-05 -- same receiver number as L2; her guarantor is named like L2's customer
      L({ docket_no: '1-100-200003', track_no: '1', full_name: 'GRACE MBWANA', contact: '0712000003', momo: '0712000003',
        recipient_full_name: 'ALEX ISAYA', recipient_momo: '0799000099', guarantor_name: 'Joseph Mwita', guarantor_contact: '0713000003',
        team: 'MBAGALA', approved_date: '2026-10-05', disb_date: '2026-10-06', created_at: '2026-10-05T06:00:00Z' }),
      // L4: AMINA's second loan, 2026-10-20 -- approved while her first (L1) sits on the defaults sheet
      L({ docket_no: '1-100-200001', track_no: '2', full_name: 'AMINA JUMA', contact: '0712000001', momo: '0712000001',
        recipient_full_name: 'AMINA JUMA', recipient_momo: '0712000001', guarantor_name: 'FATUMA ALLY', guarantor_contact: '0713000001',
        stage: 'approved', approved_date: '2026-10-20', disb_date: null, created_at: '2026-10-20T06:00:00Z' }),
      // L5: not approved -- never a case, never a link
      L({ docket_no: '1-100-200005', track_no: '1', full_name: 'ALEX ISAYA', contact: '0799000099', momo: '0799000099',
        recipient_full_name: 'ALEX ISAYA', recipient_momo: '0799000099', guarantor_name: 'PETER JOHN', guarantor_contact: '0713000005',
        stage: 'pending_approval', approved_date: null, disb_date: null, created_at: '2026-10-21T06:00:00Z' }),
      // L6: one-word names everywhere -- too little to compare
      L({ docket_no: '1-100-200006', track_no: '1', full_name: 'MARY JOHN', contact: '0712000006', momo: '0712000006',
        recipient_full_name: 'JOHN', recipient_momo: '0712000006', guarantor_name: 'JOHN', guarantor_contact: '0713000006',
        stage: 'funded', approved_date: '2026-07-01', disb_date: '2026-07-02', created_at: '2026-07-01T06:00:00Z' }),
    ],
    defaulter_snapshots: [
      D({ ref: '11002000011', docket_no: '1-100-200001', full_name: 'AMINA JUMA', contact: '0712000001', guarantor_name: 'FATUMA ALLY', guarantor_contact: '0713000001' }),
      D({ ref: '11009000011', docket_no: '1-100-900001', full_name: 'HALIMA SAID', contact: '0713000002', guarantor_name: 'ZAINABU OMARI', guarantor_contact: '0713000099', team: 'MBAGALA', status: 'Chronic', dc: 9 }),
      D({ ref: '11002000031', docket_no: '1-100-200003', full_name: 'GRACE MBWANA', contact: '0712000003', guarantor_name: 'JOSEPH MWITA', guarantor_contact: '0713000003', team: 'MBAGALA', dc: 2 }),
    ],
  };
}

test('keys: a number is its last nine digits; a name needs two words and six letters', () => {
  assert.equal(phoneKey('+255 712 000 001'), '712000001');
  assert.equal(phoneKey('0712000001'), '712000001');
  assert.equal(phoneKey('712 000 001'), '712000001');
  assert.equal(phoneKey('12345'), '', 'too short to be a phone');
  assert.equal(nameKey('  Joseph   Mwita '), 'JOSEPH MWITA');
  assert.equal(nameKey("Joseph Mwita-Juma"), 'JOSEPH MWITA JUMA');
  assert.equal(nameKey('JOHN'), '', 'one word says nothing');
  assert.equal(nameKey('AL Y'), '', 'too few letters');
  assert.equal(nameKey(null), '');
});

test('the rule: another customer\'s loan by number or name, the defaults sheet, the customer\'s own earlier loan in default; never their own history, never the loan\'s own row, never one-word names, never an unapproved loan', async () => {
  const db = fakeDb(tables());
  const r = await portalApi(db, ADMIN, 'fraudCases', {}, NOW);
  assert.equal(r.scanned.loans, 5, 'the five approved-stage loans; the pending one is not read');
  assert.equal(r.scanned.defaults, 3); assert.equal(r.deck.date, '2026-10-22');
  assert.deepEqual(r.cases.map(c => c.ref), ['11002000012', '11002000031', '11002000021'], 'newest first; L1 and L6 are not cases');
  const [l4, l3, l2] = r.cases;
  // L4: AMINA again, while L1 sits on the sheet -- her own history is not a loan link, the sheet is
  assert.equal(l4.nLoans, 0, 'a repeat customer\'s earlier loan is not a link');
  assert.equal(l4.nDefaults, 1); assert.equal(l4.ownDefault, true); assert.equal(l4.strong, true);
  assert.ok(l4.links.every(x => x.t === 'def' && x.own && x.with.ref === '11002000011'));
  assert.ok(l4.links.some(x => x.kind === 'phone' && x.mine === 'customer' && x.theirs === 'customer' && x.value === '0712000001'));
  assert.ok(l4.links.some(x => x.kind === 'phone' && x.mine === 'guarantor' && x.theirs === 'guarantor'));
  assert.equal(l4.links[0].with.status, 'Defaulter'); assert.equal(l4.links[0].with.arrears, 120000);
  // L3: GRACE -- the receiver number is L2's receiver number (strong); her guarantor is named like L2's customer (weak)
  assert.equal(l3.nLoans, 1); assert.equal(l3.nDefaults, 0); assert.equal(l3.strong, true);
  const byNo = l3.links.find(x => x.kind === 'phone');
  assert.deepEqual([byNo.t, byNo.mine, byNo.theirs, byNo.value, byNo.with.ref, byNo.with.name], ['loan', 'receiver', 'receiver', '0799000099', '11002000021', 'JOSEPH MWITA']);
  const byName = l3.links.find(x => x.kind === 'name' && x.mine === 'guarantor');
  assert.deepEqual([byName.mine, byName.theirs, byName.value], ['guarantor', 'customer', 'Joseph Mwita'], 'case and spacing do not matter');
  assert.ok(l3.links.some(x => x.kind === 'name' && x.mine === 'receiver' && x.theirs === 'receiver' && x.value === 'ALEX ISAYA'), 'the shared receiver NAME is a link of its own, beside the number');
  assert.equal(l3.nLinks, 3);
  assert.equal(l3.links[0].kind, 'phone', 'strong links first');
  assert.ok(!l3.links.some(x => x.t === 'def' && x.with.ref === '11002000031'), 'the loan\'s own row on the sheet is not a link');
  // "add default so we see defaulted amount of each of the two": each loan carries its OWN row of the sheet, or null
  assert.deepEqual([l3.def.status, l3.def.dc, l3.def.arrears, l3.def.balance, l3.def.deckDate], ['Defaulter', 2, 120000, 400000, '2026-10-22'], 'GRACE\'s loan is itself on the sheet');
  assert.equal(byNo.with.def, null, 'JOSEPH\'s loan, on the other side of her card, is not');
  assert.equal(l4.def, null, 'AMINA\'s new loan is not on the sheet; her earlier one is (the own-default link)');
  assert.ok(!l3.links.some(x => x.with.ref === '11002000051' || (x.with.name || '') === 'ALEX ISAYA' && x.t === 'loan'), 'an unapproved loan is neither a case nor a link');
  // L2: JOSEPH -- L3's receiver number and guarantor name, and his guarantor HALIMA is a chronic defaulter
  assert.equal(l2.nLoans, 1); assert.equal(l2.ownDefault, false);
  assert.equal(l2.def, null, 'JOSEPH\'s own loan is not on the sheet');
  assert.equal(l2.links.find(x => x.t === 'loan').with.def.dc, 2, 'but GRACE\'s, on the other side of his card, is -- the two defaulted amounts sit side by side');
  // two rows of the sheet: HALIMA's own loan (his guarantor is a chronic defaulter, by number and name), and
  // GRACE's loan, where a JOSEPH MWITA stands as guarantor (by name only)
  assert.equal(l2.nDefaults, 2);
  assert.ok(l2.links.some(x => x.t === 'def' && x.kind === 'name' && x.mine === 'customer' && x.theirs === 'guarantor' && x.with.ref === '11002000031'));
  const hal = l2.links.find(x => x.t === 'def' && x.kind === 'phone');
  assert.deepEqual([hal.kind, hal.mine, hal.theirs, hal.with.ref, hal.with.status, hal.with.dc, hal.own], ['phone', 'guarantor', 'customer', '11009000011', 'Chronic', 9, false]);
  assert.ok(l2.links.some(x => x.t === 'def' && x.kind === 'name' && x.value === 'HALIMA SAID'));
  // the case carries the loan itself, for the card's left column
  assert.deepEqual([l2.name, l2.contact, l2.receiver, l2.receiverMomo, l2.guarantor, l2.team, l2.principal, l2.approvedBy, l2.createdBy],
    ['JOSEPH MWITA', '0712000002', 'ALEX ISAYA', '0799000099', 'HALIMA SAID', 'KONGOWE', 500000, 'THE GM', 'OFFICER O']);
  assert.equal(r.scope, null, 'the admin compares the whole company');
});

test('team scoping at the database, both sides: a GMO compares only their teams\' loans and defaults, and is told so', async () => {
  const db = fakeDb(tables());
  const r = await portalApi(db, GMO, 'fraudCases', {}, NOW);
  assert.deepEqual(r.scope, ['KONGOWE']);
  assert.equal(r.scanned.loans, 4, 'L3 (MBAGALA) is not read');
  assert.equal(r.scanned.defaults, 1, 'only KONGOWE\'s row of the sheet');
  assert.deepEqual(r.cases.map(c => c.ref), ['11002000012'], 'L2\'s links were all in MBAGALA, so for this GMO it is no case');
  await assert.rejects(portalApi(db, NOTAB, 'fraudCases', {}, NOW), /haujafunguliwa|not open to your role/);
});

test('a number on many loans: the links are capped and the rest counted; a loan with no docket still compares by its loan_id', () => {
  const loans = [];
  const N = MAX_LINKS + 5;
  for (let i = 0; i < N; i++) {
    // a real REF: the docket's digits and the track, as the book writes them -- no docket column on the row
    loans.push(L({ docket_no: null, loan_id: '1100' + String(300000 + i) + '1', full_name: 'CUSTOMER NUMBER ' + i, contact: '07120' + String(10000 + i),
      recipient_full_name: 'THE OFFICER', recipient_momo: '0788000000', guarantor_name: null, approved_date: '2026-09-0' + ((i % 9) + 1) }));
  }
  const cases = detect(loans, []);
  assert.equal(cases.length, N, 'every one of them is a case');
  assert.equal(cases[0].docket, '', 'no docket column'); assert.equal(cases[0].ref.length, 11, 'the ref off the loan_id');
  // the receiver's number, the receiver's name, and -- digits are not letters -- the customers' shared "CUSTOMER NUMBER"
  assert.equal(cases[0].nLinks, (N - 1) * 3, 'against every other loan');
  assert.equal(cases[0].links.length, MAX_LINKS); assert.equal(cases[0].more, cases[0].nLinks - MAX_LINKS);
  assert.ok(cases[0].links.every(x => x.kind === 'phone'), 'the strong links are the ones kept');
  assert.ok(cases.every((c, i) => i === 0 || String(c.approvedDate) <= String(cases[i - 1].approvedDate)), 'newest first');
});

/* "the search in here will help credit analysts to search a number among the list before approval - but
   return active customer even if not in the list - for search character only" */
test('the look-up: the typed characters against the whole book -- a number in any spelling, a name in any case; loans first, newest first, then the sheet; scoped; at least three characters', async () => {
  const db = fakeDb(tables());
  const byNo = await portalApi(db, ADMIN, 'fraudFind', { q: '0799 000 099' }, NOW);
  assert.equal(byNo.kind, 'number'); assert.equal(byNo.total, 2);
  assert.deepEqual(byNo.hits.map(h => [h.t, h.with.ref, h.where.map(w => w.party + ':' + w.field).join()]),
    [['loan', '11002000031', 'receiver:momo'], ['loan', '11002000021', 'receiver:momo']], 'both receivers, newest first; the pending loan is not in the book');
  assert.deepEqual((await portalApi(db, ADMIN, 'fraudFind', { q: '+255799000099' }, NOW)).hits.map(h => h.with.ref), ['11002000031', '11002000021'], 'the same number in international spelling');
  const run = await portalApi(db, ADMIN, 'fraudFind', { q: '000099' }, NOW);
  assert.deepEqual(run.hits.map(h => h.t + ':' + h.with.ref + ':' + h.where[0].party), ['loan:11002000031:receiver', 'loan:11002000021:receiver', 'def:11009000011:guarantor'],
    'any run of digits -- the two receivers, and the sheet row whose guarantor number ends the same way');
  const byName = await portalApi(db, ADMIN, 'fraudFind', { q: 'mwita' }, NOW);
  assert.equal(byName.kind, 'name');
  assert.deepEqual(byName.hits.map(h => [h.t, h.with.ref, h.where.map(w => w.party).join()]),
    [['loan', '11002000031', 'guarantor'], ['loan', '11002000021', 'customer'], ['def', '11002000031', 'guarantor']], 'his own loan, the loan he guarantees, and the sheet row where he stands guarantor');
  const amina = await portalApi(db, ADMIN, 'fraudFind', { q: '0712000001' }, NOW);
  assert.deepEqual(amina.hits.map(h => h.t + ':' + h.with.ref), ['loan:11002000012', 'loan:11002000011', 'def:11002000011'], 'a number that is on the sheet is found there too');
  assert.deepEqual(amina.hits[0].where.map(w => w.party + ':' + w.field), ['customer:contact', 'customer:momo', 'receiver:momo'], 'every field it sits in');
  assert.equal(amina.hits[0].with.def, null); assert.equal(amina.hits[1].with.def.arrears, 120000, 'each loan found carries its own row of the sheet too');
  assert.equal((await portalApi(db, ADMIN, 'fraudFind', { q: '0744000000' }, NOW)).total, 0, 'a clean number is clean');
  await assert.rejects(portalApi(db, ADMIN, 'fraudFind', { q: '07' }, NOW), /angalau|at least/);
  await assert.rejects(portalApi(db, ADMIN, 'fraudFind', { q: 'MW' }, NOW), /angalau|at least/);
  // scoped: the GMO's teams only
  const gmo = await portalApi(db, GMO, 'fraudFind', { q: '0799000099' }, NOW);
  assert.deepEqual(gmo.hits.map(h => h.with.ref), ['11002000021']); assert.deepEqual(gmo.scope, ['KONGOWE']);
  await assert.rejects(portalApi(db, NOTAB, 'fraudFind', { q: '0799000099' }, NOW), /haujafunguliwa|not open to your role/);
});

test('no deck, no loans: an empty, honest answer', async () => {
  const t = tables(); t.defaulter_snapshots = []; t.loans = [];
  const r = await portalApi(fakeDb(t), ADMIN, 'fraudCases', {}, NOW);
  assert.deepEqual(r.cases, []); assert.equal(r.deck.date, null); assert.equal(r.scanned.loans, 0);
});
