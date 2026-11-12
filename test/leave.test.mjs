/* LEAVE / HOLIDAY REQUESTS -- the FOMU YA RUHUSA NA LIKIZO Google Form moved into the portal
 * the same way the salary-advance sheet was: "the tunnels and approvals must be the same to
 * advances when people request leaves / holidays" (api/_lib/portal-core.js's leave section).
 *
 * The routing itself (who approves whose request) is advance's own engine, already exercised
 * against roles/access_codes elsewhere; what is new here is leave_requests' own shape: the
 * day count from two dates, the overlap guard, the balance (Approved-only, against
 * LEAVE_ANNUAL_DAYS), expiry by start date rather than by calendar month, and the missing-
 * table fallback. Clock pinned to Thursday 2026-11-12 noon EAT, the day this shipped. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');

const NOW = Date.parse('2026-11-12T09:00:00Z');   // Thursday noon EAT
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['leave', 'leaverep'] };
const FO = { code: 'KON', name: 'KONGOWE', role: 'FIELD OFFICER', teams: ['KONGOWE'], tabs: ['leave'] };
const GMO = { code: 'G', name: 'JUMA G', role: 'GMO', teams: ['KONGOWE'], tabs: ['leave', 'leaverep'] };

function tables() {
  return {
    teams: [{ team: 'KONGOWE', zone: 'LAKE ZONE', gmo: 'JUMA G', manager: 'BOSS' }],
    roles: [
      { role: 'ADMIN', tabs: ['leave', 'leaverep'] },
      // FIELD OFFICER's requests are routed to the GMO role, in zone -- advance's own rule, read again here.
      { role: 'FIELD OFFICER', tabs: ['leave'], approver_role: 'GMO' },
      { role: 'GMO', tabs: ['leave', 'leaverep'] },
    ],
    access_codes: [
      { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null },
      { code: 'KON', name: 'KONGOWE', role: 'FIELD OFFICER', teams: ['KONGOWE'] },
      { code: 'G', name: 'JUMA G', role: 'GMO', teams: ['KONGOWE'] },
    ],
    staff_registry: [
      { id: 'S1', name: 'ASHA K', role: 'FIELD OFFICER', zone: 'LAKE ZONE', status: 'Active' },
      { id: 'S2', name: 'JUMA G', role: 'GMO', zone: 'LAKE ZONE', status: 'Active' },
    ],
    settings: [],
    leave_requests: [],
  };
}

test('the ask: a field officer sees only their own zone and role, the reasons list, and who will decide it', async () => {
  const d = await portalApi(fakeDb(tables()), FO, 'leaveRequestPage', {}, NOW);
  assert.equal(d.on, true);
  assert.deepEqual(d.staff.map(s => s.id), ['S1'], 'only the field officer, not the GMO');
  assert.ok(d.reasons.includes('LIKIZO') && d.reasons.includes('Other'), 'the ported reason list');
  const pick = await portalApi(fakeDb(tables()), FO, 'leaveRequestPage', { staffId: 'S1' }, NOW);
  assert.equal(pick.chosen.name, 'ASHA K');
  assert.equal(pick.route.kind, 'role'); assert.equal(pick.route.label.split(' ')[0], 'GMO', 'routed to the GMO role, by advance\'s own rule');
  assert.equal(pick.canApprove, false, 'a field officer does not get the desk pill');
  assert.deepEqual(pick.balance, { annualDays: 26, taken: 0, pending: 0, remaining: 26 }, 'nothing asked yet: the sheet\'s own default');
});

test('the ask itself: days is the two dates, inclusive -- never a third typed number', async () => {
  const db = fakeDb(tables());
  const r = await portalApi(db, FO, 'leaveRequest', { staffId: 'S1', startDate: '2026-11-16', endDate: '2026-11-18', reason: 'LIKIZO', coverName: 'BAKARI' }, NOW);
  assert.equal(r.days, 3, 'Mon to Wed, inclusive');
  assert.equal(r.route.label.split(' ')[0], 'GMO');
  const rows = await db.from('leave_requests').select('*');
  assert.equal(rows.data.length, 1);
  assert.equal(rows.data[0].req_role, 'FIELD OFFICER'); assert.equal(rows.data[0].zone, 'LAKE ZONE');
  assert.equal(rows.data[0].cover_name, 'BAKARI'); assert.equal(rows.data[0].approval, 'Pending');
});

test('a same-day request is one day, not zero; a return before the start is refused', async () => {
  const db = fakeDb(tables());
  const r = await portalApi(db, FO, 'leaveRequest', { staffId: 'S1', startDate: '2026-11-16', endDate: '2026-11-16', reason: 'UGONJWA' }, NOW);
  assert.equal(r.days, 1);
  await assert.rejects(() => portalApi(fakeDb(tables()), FO, 'leaveRequest', { staffId: 'S1', startDate: '2026-11-16', endDate: '2026-11-10', reason: 'UGONJWA' }, NOW),
    /haiwezi kuwa kabla/);
});

test('an overlapping request is refused -- the Google Form had no such check at all, this is new', async () => {
  const db = fakeDb(tables());
  await portalApi(db, FO, 'leaveRequest', { staffId: 'S1', startDate: '2026-11-16', endDate: '2026-11-20', reason: 'LIKIZO' }, NOW);
  await assert.rejects(
    () => portalApi(db, FO, 'leaveRequest', { staffId: 'S1', startDate: '2026-11-19', endDate: '2026-11-22', reason: 'MSIBA' }, NOW),
    /linalogongana/);
  // A request OUTSIDE the first one's dates is unaffected.
  const r = await portalApi(db, FO, 'leaveRequest', { staffId: 'S1', startDate: '2026-11-23', endDate: '2026-11-23', reason: 'MSIBA' }, NOW);
  assert.equal(r.days, 1);
});

test('the balance: Approved days are deducted, Pending days are shown but not deducted -- unlike the sheet\'s own unconditional SUMIF', async () => {
  const db = fakeDb(tables());
  const a = await portalApi(db, FO, 'leaveRequest', { staffId: 'S1', startDate: '2026-11-16', endDate: '2026-11-20', reason: 'LIKIZO' }, NOW);
  const b = await portalApi(db, FO, 'leaveRequest', { staffId: 'S1', startDate: '2026-11-23', endDate: '2026-11-24', reason: 'UGONJWA' }, NOW);
  await portalApi(db, GMO, 'leaveDecide', { updates: [{ id: a.id, approval: 'Approved', comment: '' }] }, NOW);
  const pick = await portalApi(db, FO, 'leaveRequestPage', { staffId: 'S1' }, NOW);
  assert.deepEqual(pick.balance, { annualDays: 26, taken: 5, pending: 2, remaining: 21 }, 'a\'s 5 approved days taken; b\'s 2 pending, shown, not subtracted');
  // Disapprove b: it stops counting as pending, and never counted against the balance at all.
  await portalApi(db, GMO, 'leaveDecide', { updates: [{ id: b.id, approval: 'Disapproved', comment: 'hapana' }] }, NOW);
  const after = await portalApi(db, FO, 'leaveRequestPage', { staffId: 'S1' }, NOW);
  assert.deepEqual(after.balance, { annualDays: 26, taken: 5, pending: 0, remaining: 21 });
});

test('the desk: the GMO sees the field officer\'s pending request by role routing, decides it, and it leaves pending', async () => {
  const db = fakeDb(tables());
  const r = await portalApi(db, FO, 'leaveRequest', { staffId: 'S1', startDate: '2026-11-16', endDate: '2026-11-18', reason: 'LIKIZO' }, NOW);
  const q0 = await portalApi(db, GMO, 'leaveQueue', {}, NOW);
  assert.equal(q0.count, 1); assert.equal(q0.pending[0].staff_name, 'ASHA K'); assert.equal(q0.pending[0].routeKind, 'role');
  const dec = await portalApi(db, GMO, 'leaveDecide', { updates: [{ id: r.id, approval: 'Approved', comment: 'sawa' }] }, NOW);
  assert.equal(dec.approved, 1);
  const q1 = await portalApi(db, GMO, 'leaveQueue', {}, NOW);
  assert.equal(q1.count, 0); assert.equal(q1.recent.length, 1); assert.equal(q1.recent[0].approval, 'Approved');
  // A field officer is not an approver: no desk pill, and a second decision is refused as not decided-once.
  const pageFO = await portalApi(db, FO, 'leaveRequestPage', {}, NOW);
  assert.equal(pageFO.canApprove, false);
  const again = await portalApi(db, GMO, 'leaveDecide', { updates: [{ id: r.id, approval: 'Disapproved', comment: 'x' }] }, NOW);
  assert.deepEqual(again, { updated: 0, approved: 0, disapproved: 0, skipped: ['ASHA K: already Approved -- a request is decided once'] });
});

test('a stray tick outside this desk is skipped, not fatal to the rest of a bulk decision', async () => {
  const db = fakeDb(tables());
  const r = await portalApi(db, FO, 'leaveRequest', { staffId: 'S1', startDate: '2026-11-16', endDate: '2026-11-16', reason: 'LIKIZO' }, NOW);
  const res = await portalApi(db, GMO, 'leaveDecide', { updates: [{ id: r.id, approval: 'Approved', comment: '' }, { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', approval: 'Approved', comment: '' }] }, NOW);
  assert.equal(res.approved, 1); assert.equal(res.skipped.length, 1);
});

test('expired: a request not decided before its own start date can no longer be decided, and reads Expired, not Pending', async () => {
  const db = fakeDb(tables());
  const past = await portalApi(db, FO, 'leaveRequest', { staffId: 'S1', startDate: '2026-11-10', endDate: '2026-11-11', reason: 'UGONJWA' }, Date.parse('2026-11-09T09:00:00Z'));
  const q = await portalApi(db, GMO, 'leaveQueue', {}, NOW);   // NOW is after 2026-11-10
  assert.equal(q.count, 0, 'not pending any more'); assert.equal(q.expiredCount, 1);
  assert.equal(q.expired[0].approval, 'Expired');
  const dec = await portalApi(db, GMO, 'leaveDecide', { updates: [{ id: past.id, approval: 'Approved', comment: '' }] }, NOW);
  assert.deepEqual(dec, { updated: 0, approved: 0, disapproved: 0, skipped: [dec.skipped[0]] });
  assert.match(dec.skipped[0], /expired -- its start date \(2026-11-10\) came and went undecided/);
  // The database row itself is now written Expired too (leaveExpireOld_), not just read that way.
  const raw = await db.from('leave_requests').select('approval').eq('id', past.id);
  assert.equal(raw.data[0].approval, 'Expired');
});

test('the report: Approved by default, by zone, with each row\'s own balance after', async () => {
  const db = fakeDb(tables());
  const r = await portalApi(db, FO, 'leaveRequest', { staffId: 'S1', startDate: '2026-11-16', endDate: '2026-11-20', reason: 'LIKIZO' }, NOW);
  await portalApi(db, GMO, 'leaveDecide', { updates: [{ id: r.id, approval: 'Approved', comment: '' }] }, NOW);
  const rep = await portalApi(db, GMO, 'leaveReport', { from: '2026-11-01', to: '2026-11-30' }, NOW);
  assert.equal(rep.approval, 'Approved'); assert.equal(rep.count, 1); assert.equal(rep.days, 5); assert.equal(rep.approvedDays, 5);
  assert.equal(rep.rows[0].staff_name, 'ASHA K'); assert.deepEqual(rep.rows[0].balance, { annualDays: 26, taken: 5, pending: 0, remaining: 21 });
  assert.equal(rep.summary[0].zone, 'LAKE ZONE'); assert.equal(rep.summary[0].approvedDays, 5);
});

test('no month to close: leave has no finance Finalize, unlike advance -- a decision made in a later calendar month still stands', async () => {
  const db = fakeDb(tables());
  // Filed in November, FOR a December date -- still well before its own start date, a month
  // later, which is exactly where advance's own calendar-month lock would have closed it.
  const r = await portalApi(db, FO, 'leaveRequest', { staffId: 'S1', startDate: '2026-12-15', endDate: '2026-12-16', reason: 'LIKIZO' }, NOW);
  const nextMonth = Date.parse('2026-12-01T09:00:00Z');
  const dec = await portalApi(db, GMO, 'leaveDecide', { updates: [{ id: r.id, approval: 'Approved', comment: '' }] }, nextMonth);
  assert.equal(dec.approved, 1, 'no month-closed refusal exists for leave -- only its own start date can expire it');
});

test('a database without RUN-ME-047 refuses cleanly on every leave action that reads or writes leave_requests, never throws', async () => {
  const db = fakeDb(tables(), { missingTables: ['leave_requests'] });
  // leaveRequestPage's `on` mirrors advRequestPage's own: it reports whether staff_registry (the
  // name picker) is reachable, not leave_requests -- the same design advance already ships with.
  // The ask still draws; it is leaveRequest, leaveQueue and leaveReport (which read leave_requests
  // directly) that must refuse.
  const page = await portalApi(db, FO, 'leaveRequestPage', {}, NOW);
  assert.equal(page.on, true);
  await assert.rejects(() => portalApi(db, FO, 'leaveRequest', { staffId: 'S1', startDate: '2026-11-16', endDate: '2026-11-16', reason: 'LIKIZO' }, NOW), /RUN-ME-047/);
  const q = await portalApi(db, GMO, 'leaveQueue', {}, NOW);
  assert.equal(q.on, false); assert.match(q.note, /RUN-ME-047/);
  const rep = await portalApi(db, GMO, 'leaveReport', {}, NOW);
  assert.equal(rep.on, false); assert.match(rep.note, /RUN-ME-047/);
});

test('neither migration run at all (a fresh database): the ask says so plainly instead of pretending there is nobody to pick', async () => {
  const db = fakeDb(tables(), { missingTables: ['leave_requests', 'staff_registry'] });
  const page = await portalApi(db, FO, 'leaveRequestPage', {}, NOW);
  assert.equal(page.on, false); assert.match(page.note, /RUN-ME-047/); assert.deepEqual(page.staff, []);
});

test('customer service: one shared code, names off the call-agents roster, no zone -- the same special case advance makes', async () => {
  const t = tables();
  t.access_codes.push({ code: 'CS', name: 'CS DESK', role: 'CUSTOMER SERVICE', teams: null });
  t.roles.push({ role: 'CUSTOMER SERVICE', tabs: ['leave'], approver_role: 'GMO' });
  t.call_agents = [{ user_id: 'u1', names: 'HAPPY AGENT' }];
  const CS = { code: 'CS', name: 'CS DESK', role: 'CUSTOMER SERVICE', teams: null, tabs: ['leave'] };
  const db = fakeDb(t);
  const page = await portalApi(db, CS, 'leaveRequestPage', {}, NOW);
  assert.deepEqual(page.staff.map(s => s.name), ['HAPPY AGENT']);
  const r = await portalApi(db, CS, 'leaveRequest', { staffName: 'HAPPY AGENT', startDate: '2026-11-16', endDate: '2026-11-16', reason: 'LIKIZO' }, NOW);
  assert.equal(r.zone, null, 'customer service requests carry no zone, like advance\'s');
});
