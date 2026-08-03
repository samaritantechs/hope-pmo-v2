// The portal backend: every tab's function against the mutation-capable fake PostgREST,
// with team scoping checked on the tabs where getting it wrong would leak another team's
// customers. Clock pinned to Friday 2026-07-24 noon EAT.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi, PORTAL_FUNCTIONS, assignFor } = await import('../api/_lib/portal-core.js');
// The announcement is READ without an access code -- it has to reach the sign-in screen -- so
// it lives on the calls door beside the brand. Both sides are checked here, together, because
// what one writes the other must be willing to show.
const { callApi } = await import('../api/_lib/call-core.js');

const NOW = Date.parse('2026-07-24T09:00:00Z');            // Friday noon EAT
const TODAY = '2026-07-24', YEST = '2026-07-23', MON = '2026-07-20';
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] };
const GMO = { code: 'G', name: 'JUMA G', role: 'GMO', teams: ['KONGOWE'], tabs: [] };

const E = (ref, team, exp, status, arrears, date = TODAY, type = 'today') => ({
  ref, full_name: 'C' + ref, contact: '07120000' + ref, team, payment_expected: exp, arrears,
  todays_status: status, due_summary: '2/6', snapshot_type: type, snapshot_date: date,
  upload_batch: 'b' + date, created_at: date + 'T04:00:00Z',
});
const D = (ref, team, arrears, type, days = 45, date = TODAY, wd = 'FRI') => ({
  ref, full_name: 'C' + ref, contact: '07140000' + ref, team, arrears, status: 'Defaulter',
  ds: '3-6', dc: 3, days_elapsed: days, disb_date: '2026-07-21',        // a Tuesday -> Day 1 Tue, Day 2 Fri
  initial_inst: 100000, other_inst: 40000, balance: 500000,
  snapshot_type: type, weekday: wd, snapshot_date: date,
  upload_batch: 'b' + type + date, created_at: date + 'T04:00:00Z',
});

function tables() {
  return {
    teams: [
      { team: 'KONGOWE', opm: null, recovery: 'JUMA G', gmo: null, manager: 'BOSS', credit: 'ANALYST A', expected: 'EARLY E', bike: null },
      { team: 'MBAGALA', opm: null, recovery: null, gmo: null, manager: null, credit: null, expected: null, bike: null },
    ],
    access_codes: [{ code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] }],
    roles: [{ role: 'ADMIN', tabs: ['upload', 'settings'] }],
    settings: [{ key: 'COMMISSION_RATE', value: '5' },
      { key: 'CMS_MODE', value: 'status' },
      { key: 'CMS_STATUS_RATES', value: 'defaulter:10, expired:5, chronic:2' },
      { key: 'CMS_PAID_TZS', value: '1000' }, { key: 'CMS_OVER_TZS', value: '1500' }],
    repayment_snapshots: [
      E('111', 'KONGOWE', 1000, 'UNPAID', 0),
      E('222', 'KONGOWE', 500, 'PAID', 0),
      E('333', 'MBAGALA', 800, 'UNPAID', 0),
      E('111', 'KONGOWE', 400, 'UNPAID', 0, YEST),
    ],
    defaulter_snapshots: [
      D('111', 'KONGOWE', 500, 'initial'), D('555', 'KONGOWE', 700, 'initial'),
      D('111', 'KONGOWE', 300, 'current'), D('555', 'KONGOWE', 600, 'current', 200),
      D('999', 'MBAGALA', 900, 'initial'), D('999', 'MBAGALA', 800, 'current'),
    ],
    followup_status: [
      { ref: '555', team: 'KONGOWE', full_name: 'C555', contact: '0714000555', arrears: 600, rejesho: 100, status: 'Defaulter', ds: '3-6', fu_status: 'AMETOA AHADI', promise_date: YEST, promise_amt: 200, comment_by: 'JUMA G', comment_at: YEST + 'T08:00:00Z' },
      { ref: '999', team: 'MBAGALA', full_name: 'C999', contact: '0714000999', arrears: 800, status: 'Defaulter', fu_status: '' },
      { ref: '777', team: 'KONGOWE', full_name: null, arrears: null, status: null },   // FK stub, not a defaulter
    ],
    followup_comments: [
      { id: 'c1', ref: '555', team: 'KONGOWE', comment: 'ataleta', fu_status: 'AMETOA AHADI', created_by: 'JUMA G', created_at: TODAY + 'T06:00:00Z' },
    ],
    call_agents: [{ user_id: 'CS1', names: 'NEEMA CS' }],
    loans: [
      { id: 'l1', team: 'KONGOWE', stage: 'approved', principal_amt: 300000, approved_date: '2026-07-21', created_by: 'ANALYST A', full_name: 'L1' },
      { id: 'l2', team: 'MBAGALA', stage: 'approved', principal_amt: 200000, approved_date: '2026-07-22', created_by: 'ANALYST B', full_name: 'L2' },
      { id: 'l3', team: 'KONGOWE', stage: 'disbursed', principal_amt: 100000, approved_date: '2026-07-20', created_by: 'ANALYST A', full_name: 'L3' },
      { id: 'l4', team: 'KONGOWE', stage: 'unassigned', requested_amt: 50000, full_name: 'L4' },
    ],
    received_payments: [
      { id: 'r1', team: 'KONGOWE', amount_paid: 1500, paid_at: TODAY },
      { id: 'r2', team: 'MBAGALA', amount_paid: 900, paid_at: MON },
    ],
    complaints: [{ id: 'k1', team: 'KONGOWE', complainant: 'MAMA A', status: 'Open', details: 'hakupata risiti', created_at: TODAY + 'T05:00:00Z' }],
    restructures: [{ id: 's1', ref: '555', team: 'KONGOWE', full_name: 'C555', arrears: 600, total: 800, installments: 4, inst_amt: 200, status: 'Pending', requested_by: 'JUMA G', created_at: TODAY + 'T05:00:00Z' }],
    demand_notices: [{ id: 'n1', ref: '999', team: 'MBAGALA', full_name: 'C999', notice_date: TODAY, total_demand: 900, issued_by: 'LEGAL', created_at: TODAY + 'T05:00:00Z' }],
    abnormal_payments: [{ id: 'x1', team: 'KONGOWE', customer_name: 'MAMA B', paid: 5000, created_at: TODAY + 'T05:00:00Z' }],
    call_users: [{ user_id: 'U1', name: 'JUMA G', team: 'KONGOWE', role: 'OFFICER', is_leader: false }],
    call_logs: [
      { id: 'g1', user_id: 'U1', officer: 'JUMA G', team: 'KONGOWE', phone: '712000111', call_date: TODAY, duration: 60, portfolio: true, category: 'EXPECTED', outcome: 'CONNECTED' },
      { id: 'g2', user_id: 'U1', officer: 'JUMA G', team: 'KONGOWE', phone: '799999999', call_date: TODAY, duration: 10, portfolio: false, outcome: 'MISSED' },
    ],
  };
}
const run = (fn, args, user = ADMIN, db = fakeDb(tables())) => portalApi(db, user, fn, args, NOW);

test('every dispatched function name is reachable', () => {
  assert.ok(PORTAL_FUNCTIONS.length >= 30);
  for (const n of ['dashboard', 'loans', 'expected', 'followup', 'promises', 'par', 'weekly', 'commission', 'callReport']) {
    assert.ok(PORTAL_FUNCTIONS.includes(n), n + ' dispatched');
  }
});

test('an unknown function is a 400, not a 500', async () => {
  await assert.rejects(() => run('nope'), e => e.status === 400);
});

test('loans: stage filter, totals, and the pipeline strip', async () => {
  const d = await run('loans', { stage: 'approved' });
  assert.equal(d.count, 2);
  assert.equal(d.amount, 500000);
  const p = await run('loanPipeline');
  const by = Object.fromEntries(p.stages.map(s => [s.stage, s.count]));
  assert.equal(by.approved, 2); assert.equal(by.disbursed, 1); assert.equal(by.unassigned, 1);
});

test('expected: totals, collection %, status split, batch-resolved date', async () => {
  const d = await run('expected', { type: 'today' });
  assert.equal(d.date, TODAY);
  assert.equal(d.count, 3);
  assert.equal(d.totals.expected, 2300);
  assert.equal(d.totals.collected, 500);                    // only the PAID row
  assert.equal(d.totals.uncollected, 1800);
  assert.equal(d.totals.pct, 21.7);
  assert.deepEqual(d.byStatus.find(s => s.status === 'UNPAID').count, 2);
});

test('expected defaulters place every customer on two weekdays', async () => {
  const d = await run('expectedDefaulters');
  assert.deepEqual(d.rows.map(r => r.ref).sort(), ['111', '555', '999']);
  const r = d.rows[0];
  // Disbursed on a Tuesday -> Day 1 Tue, Day 2 three days later (Fri).
  assert.equal(r.primaryName, 'Tue'); assert.equal(r.secondaryName, 'Fri');
  // Each customer counts on BOTH days, so the distribution sums to twice the headcount.
  assert.equal(d.dist[2], 3); assert.equal(d.dist[5], 3);
  assert.equal(d.dist[2] + d.dist[5], 2 * d.count);
  assert.equal(d.unplaced, 0);
});

test('a defaulter with no disbursement date is bucketed, never dropped', async () => {
  const t = tables();
  t.defaulter_snapshots.push({ ref: '888', full_name: 'C888', team: 'KONGOWE', arrears: 400,
    status: 'Defaulter', ds: '1-6', dc: 1, days_elapsed: 10, disb_date: null,
    snapshot_type: 'current', weekday: 'FRI', snapshot_date: TODAY,
    upload_batch: 'bcurrent' + TODAY, created_at: TODAY + 'T04:00:00Z' });
  const d = await portalApi(fakeDb(t), ADMIN, 'expectedDefaulters', {}, NOW);
  // It cannot be placed on a weekday -- but losing a defaulter silently is the one outcome
  // this tab must never produce, so it lands in day 0 and still shows up in the count.
  assert.equal(d.count, 4);
  assert.equal(d.unplaced, 1);
  assert.equal(d.dist[0], 1);
  const r = d.rows.find(x => x.ref === '888');
  assert.equal(r.primary, 0); assert.equal(r.primaryName, '—');
});

test('followup drops FK stubs but keeps real defaulters', async () => {
  const d = await run('followup');
  assert.deepEqual(d.rows.map(r => r.ref).sort(), ['555', '999']);
  assert.equal(d.arrears, 1400);
});

/* The tab recovery officers live in all day. It was rendering twelve columns while the server
   was already sending most of the rest -- the guarantor above all, who is the person an
   officer rings when the customer will not answer. */
test('followup carries everything the officer needs to work the customer', async () => {
  const t = tables();
  // The guarantor, the dates and the days-in-cycle are already columns on this table; they
  // were simply never asked for by the screen.
  Object.assign(t.followup_status[0], {
    guarantor_name: 'MAMA ASHA', guarantor_contact: '0715000555',
    disb_date: '2026-06-01', last_trans: '2026-07-20', dc: 4,
    last_comment: 'ameahidi kulipa ijumaa',
  });
  // A replacement number logged during a follow-up, and an older one that must lose to it.
  t.followup_comments.push(
    { id: 'c9', ref: '555', new_number: '0755111222', created_at: '2026-07-01T06:00:00Z' },
    { id: 'c10', ref: '555', new_number: '0766333444', created_at: TODAY + 'T07:00:00Z' });
  const d = await portalApi(fakeDb(t), ADMIN, 'followup', {}, NOW);
  const r = d.rows.find(x => x.ref === '555');

  assert.equal(r.guarantor_name, 'MAMA ASHA');
  assert.equal(r.guarantor_contact, '0715000555');
  assert.equal(r.disb_date, '2026-06-01');
  assert.equal(r.last_trans, '2026-07-20');
  assert.equal(r.dc, 4);
  assert.equal(r.last_comment, 'ameahidi kulipa ijumaa');

  // The NEWEST replacement number wins -- an officer who corrects a number twice means the
  // second one.
  assert.equal(r.new_no, '0766333444');
  // A customer nobody logged a new number for says so, rather than borrowing somebody else's.
  assert.equal(d.rows.find(x => x.ref === '999').new_no, null);

  // Recovered comes off the SAME baseline the Exp.Def screen uses -- today's own initial deck
  // -- so the two screens cannot disagree about what came back. 555: 700 initial, 600 now.
  assert.equal(r.initial, 700);
  assert.equal(r.recovered, 100);
  assert.equal(d.recovered, d.rows.reduce((s, x) => s + x.recovered, 0));

  // A customer absent from the baseline shows nothing recovered rather than a fabricated
  // number worked out against whatever deck happened to be lying around.
  t.defaulter_snapshots = t.defaulter_snapshots.filter(x => !(x.ref === '555' && x.snapshot_type === 'initial'));
  const none = await portalApi(fakeDb(t), ADMIN, 'followup', {}, NOW);
  const r2 = none.rows.find(x => x.ref === '555');
  assert.equal(r2.recovered, 0);
  assert.equal(r2.initial, 600);

  // The month of the last transaction, ready for the "any month" filter, newest month first.
  assert.equal(r.last_trans_month, '2026-07');
  assert.ok(d.months.includes('2026-07'));
  assert.deepEqual(d.months, d.months.slice().sort().reverse());
});

test('promises bucket against today, overdue first', async () => {
  const d = await run('promises');
  assert.equal(d.count, 1);
  assert.equal(d.rows[0].bucket, 'overdue');                // promised yesterday
  assert.equal(d.counts.overdue, 1);
  assert.equal(d.promised, 200);
});

test('follow-up rules are enforced server-side, and a comment updates both tables', async () => {
  const db = fakeDb(tables());
  await assert.rejects(() => portalApi(db, ADMIN, 'addComment', { ref: '999', fuStatus: 'AMETOA AHADI' }, NOW), /promise date/i);
  await assert.rejects(() => portalApi(db, ADMIN, 'addComment', { ref: '999', fuStatus: 'OTHERS' }, NOW), /comment is required/i);
  await assert.rejects(() => portalApi(db, ADMIN, 'addComment', { ref: '999', fuStatus: 'ANA NAMBA NYINGINE' }, NOW), /new phone number/i);
  const r = await portalApi(db, ADMIN, 'addComment', { ref: '999', fuStatus: 'ANALIPA LEO', comment: 'atalipa' }, NOW);
  assert.ok(r.savedAt);
  const st = db._dump('followup_status').find(x => x.ref === '999');
  assert.equal(st.fu_status, 'ANALIPA LEO');
  assert.equal(st.comment_by, 'THE ADMIN');
  assert.equal(db._dump('followup_comments').filter(c => c.ref === '999').length, 1);
});

test('a GMO cannot comment on another team, and sees only their own rows', async () => {
  const db = fakeDb(tables());
  await assert.rejects(() => portalApi(db, GMO, 'addComment', { ref: '999', comment: 'x' }, NOW), e => e.status === 403);
  const fu = await portalApi(db, GMO, 'followup', {}, NOW);
  assert.deepEqual(fu.rows.map(r => r.ref), ['555']);
  const exp = await portalApi(db, GMO, 'expected', { type: 'today' }, NOW);
  assert.equal(exp.count, 2);                               // MBAGALA excluded
  assert.equal(exp.totals.expected, 1500);
});

test('followup report counts by status, team and officer over a window', async () => {
  const d = await run('followupReport', { from: MON, to: TODAY });
  assert.equal(d.totals.customers, 2);                      // stubs excluded
  assert.equal(d.totals.touched, 1);
  assert.equal(d.totals.comments, 1);
  assert.equal(d.byOfficer[0].officer, 'JUMA G');
  assert.equal(d.byStatus.find(s => s.status === '(NOT TOUCHED)').customers, 1);
});

test('PAR bands customers by days in arrears', async () => {
  const d = await run('par');
  const band = Object.fromEntries(d.bands.map(b => [b.band, b.customers]));
  assert.equal(band['31-60'], 2);                           // 111 and 999 at 45 days
  assert.equal(band['180+'], 1);                            // 555 at 200 days
  assert.equal(d.totals.customers, 3);
  assert.equal(d.totals.arrears, 1700);
});

test('weekly lays out Mon-Fri with the week totals', async () => {
  const d = await run('weekly', {});
  assert.equal(d.weekOf, MON);
  assert.equal(d.days.length, 5);
  const fri = d.days[4];
  assert.equal(fri.date, TODAY);
  assert.equal(fri.expected, 2300);
  assert.equal(fri.collected, 500);
  assert.equal(fri.recovered, 400);                         // initial 2100 - current 1700, and the
                                                            // same 400 team progress splits 300/100
  assert.equal(fri.received, 1500);
  assert.equal(d.totals.salesCount, 2);
});

test('team progress pairs initial and current decks per team', async () => {
  const d = await run('teamProgress');
  assert.equal(d.paired, true);
  const k = d.rows.find(r => r.team === 'KONGOWE');
  assert.equal(k.initArrears, 1200); assert.equal(k.curArrears, 900);
  assert.equal(k.recovered, 300);
  assert.equal(k.progress, 25);
  assert.equal(k.recovery, 'JUMA G');                       // joined from the teams table
});

test('commission pays the recovery officer a % and the early officer a flat rate', async () => {
  const d = await run('commission');
  assert.equal(d.mode, 'status');
  // Recovery: KONGOWE's officer earns on 111 (500->300) and 555 (700->600) = 300 at 10%.
  const juma = d.day.find(r => r.officer === 'JUMA G');
  assert.equal(juma.recovered, 300); assert.equal(juma.recComm, 30);
  // MBAGALA names no recovery officer, so its 100 recovered is still counted, unassigned.
  assert.equal(d.day.find(r => r.officer === '(unassigned)').recovered, 100);
  // Early collection: one PAID client on KONGOWE's expected list at TZS 1,000 flat.
  const early = d.day.find(r => r.officer === 'EARLY E');
  assert.equal(early.paid, 1); assert.equal(early.over, 0); assert.equal(early.colComm, 1000);
  assert.equal(d.totals.recovered, 400);
});

test('commission rates save, and a malformed rate saves nothing', async () => {
  const db = fakeDb(tables());
  await portalApi(db, ADMIN, 'commissionSave', { mode: 'year', yearRates: '2024:5, 2025:2.5', paidTzs: 800 }, NOW);
  const val = k => db._dump('settings').find(r => r.key === k).value;
  assert.equal(val('CMS_MODE'), 'year');
  assert.equal(val('CMS_YEAR_RATES'), '2024:5, 2025:2.5');
  assert.equal(val('CMS_PAID_TZS'), '800');
  // Validation happens before ANY write, so a bad list cannot half-save over a good one.
  await assert.rejects(() => portalApi(db, ADMIN, 'commissionSave', { yearRates: 'nonsense!!' }, NOW),
    e => e.status === 400);
  assert.equal(val('CMS_YEAR_RATES'), '2024:5, 2025:2.5');
});

test('assignments flags customers nobody has followed up', async () => {
  const d = await run('assignments');
  assert.equal(d.count, 3);
  assert.equal(d.untouched, 2);                             // only 555 has a follow-up status
  assert.ok(d.rows.every(r => r.arrears >= 0));
});

test('rotation: ACTIVE cycles by day-bucket, EXPIRED steps weekly then holds, CHRONIC cycles weekly', () => {
  const strat = { active: ['BIKE', 'MANAGER', 'GMO'], chronic: ['BIKE', 'GMO', 'MANAGER'],
    expired: ['MANAGER', 'GMO'], graceWeeks: 2, bucketDays: 2 };
  const A = d => assignFor({ status: 'Defaulter', days_elapsed: d }, strat, NOW);
  // Two days per bucket, three roles -> the owner changes every 2 days and repeats every 6.
  assert.equal(A(1).role, 'BIKE'); assert.equal(A(2).role, 'BIKE');
  assert.equal(A(3).role, 'MANAGER'); assert.equal(A(4).role, 'MANAGER');
  assert.equal(A(5).role, 'GMO'); assert.equal(A(6).role, 'GMO');
  assert.equal(A(7).role, 'BIKE');                                  // wraps
  assert.equal(A(7).phase, 'ACTIVE'); assert.equal(A(7).label, 'D7');

  // EXPIRED walks its list one role per week and then STAYS on the last one.
  const wkAgo = n => new Date(NOW - n * 7 * 86400000).toISOString().slice(0, 10);
  assert.equal(assignFor({ status: 'Expired', expire_date: wkAgo(0) }, strat, NOW).role, 'MANAGER');
  assert.equal(assignFor({ status: 'Expired', expire_date: wkAgo(1) }, strat, NOW).role, 'GMO');
  // Past the grace window an expired customer is chronic in practice, and rotates weekly.
  const past = assignFor({ status: 'Expired', expire_date: wkAgo(2) }, strat, NOW);
  assert.equal(past.phase, 'CHRONIC');
  assert.equal(past.role, 'BIKE');

  // CHRONIC rotates weekly from its own chronic date, forever.
  assert.equal(assignFor({ status: 'Chronic', chronic_date: wkAgo(0) }, strat, NOW).role, 'BIKE');
  assert.equal(assignFor({ status: 'Chronic', chronic_date: wkAgo(1) }, strat, NOW).role, 'GMO');
  assert.equal(assignFor({ status: 'Chronic', chronic_date: wkAgo(2) }, strat, NOW).role, 'MANAGER');
  assert.equal(assignFor({ status: 'Chronic', chronic_date: wkAgo(3) }, strat, NOW).role, 'BIKE');
});

test('assignments name the recycling leader from that team, and group by role/leader', async () => {
  const db = fakeDb(tables());
  const d = await portalApi(db, ADMIN, 'assignments', {}, NOW);
  assert.equal(d.count, 3);
  const r = d.rows.find(x => x.ref === '111');
  assert.equal(r.phase, 'ACTIVE');
  assert.ok(['BIKE', 'MANAGER', 'GMO'].includes(r.role));
  // KONGOWE has no bike/gmo named in the fixture but does have a manager, so whichever role
  // the rotation picked either resolves to a real person or is flagged, never silently blank.
  assert.ok(r.leader === '(unassigned)' || typeof r.leader === 'string');
  assert.ok(d.byRole.length >= 1);
  assert.ok(d.byLeader.length >= 1);
  assert.equal(d.byRole.reduce((s, x) => s + x.customers, 0), 3);
  assert.deepEqual(d.strategy.active, ['BIKE', 'MANAGER', 'GMO']);   // defaults when unset
});

test('settings drive the rotation -- changing ASSIGN_ACTIVE changes the owner', async () => {
  const db = fakeDb(tables());
  db._dump('settings').push({ key: 'ASSIGN_ACTIVE', value: 'RECOVERY' });
  db._dump('settings').push({ key: 'ASSIGN_BUCKET_DAYS', value: '3' });
  const d = await portalApi(db, ADMIN, 'assignments', {}, NOW);
  assert.deepEqual(d.strategy.active, ['RECOVERY']);
  assert.equal(d.strategy.bucketDays, 3);
  const r = d.rows.find(x => x.ref === '111');
  assert.equal(r.role, 'RECOVERY');
  assert.equal(r.leader, 'JUMA G');                                  // teams.recovery for KONGOWE
});

test('expected defaulters carry the same recycling leader', async () => {
  const d = await run('expectedDefaulters');
  assert.equal(d.rows.length, 3);
  assert.ok(d.rows[0].role, 'a role is assigned');
  assert.ok('leader' in d.rows[0], 'the leader name travels with the row');
  assert.ok(d.rows[0].cycle, 'the cycle label is shown');
});

test('registers: complaints, restructures, notices, abnormal, received', async () => {
  const db = fakeDb(tables());
  const c = await portalApi(db, ADMIN, 'complaints', {}, NOW);
  assert.equal(c.count, 1); assert.equal(c.open, 1);
  await portalApi(db, ADMIN, 'addComplaint', { complainant: 'MAMA C', team: 'KONGOWE', details: 'x' }, NOW);
  assert.equal((await portalApi(db, ADMIN, 'complaints', {}, NOW)).count, 2);
  await portalApi(db, ADMIN, 'resolveComplaint', { id: 'k1', resolution: 'sorted' }, NOW);
  assert.equal((await portalApi(db, ADMIN, 'complaints', {}, NOW)).open, 1);
  assert.equal((await portalApi(db, ADMIN, 'complaints', {}, NOW)).resolved, 1);

  const rs = await portalApi(db, ADMIN, 'restructures', {}, NOW);
  assert.equal(rs.pending, 1);
  await portalApi(db, ADMIN, 'decideRestructure', { id: 's1', decision: 'approve' }, NOW);
  assert.equal((await portalApi(db, ADMIN, 'restructures', {}, NOW)).pending, 0);

  await portalApi(db, ADMIN, 'addDemandNotice', { ref: '555', team: 'KONGOWE', totalDemand: 700 }, NOW);
  assert.equal((await portalApi(db, ADMIN, 'demandNotices', {}, NOW)).count, 2);

  assert.equal((await portalApi(db, ADMIN, 'abnormal', {}, NOW)).count, 1);
  const rcv = await portalApi(db, ADMIN, 'received', {}, NOW);
  assert.equal(rcv.count, 2); assert.equal(rcv.amount, 2400);
});

test('credit scores analysts on their count 1-6 book and their sales', async () => {
  const d = await run('credit');
  // KONGOWE's credit column names ANALYST A, so both its defaulters are their book.
  const a = d.rows.find(r => r.analyst === 'ANALYST A');
  assert.equal(a.cnt, 2);                                   // 111 and 555, both paid < 6 of 12
  assert.equal(a.reduced, 2);                               // 500->300 and 700->600
  assert.equal(a.cleared, 0); assert.equal(a.bad, 0); assert.equal(a.stat, 0);
  assert.equal(a.success, 100);                             // (cleared + reduced) / count 1-6
  assert.equal(a.recovered, 300);
  assert.equal(a.sales, 300000);                            // the one approved KONGOWE loan
  // MBAGALA names no analyst, so its 999 lands on (unassigned) rather than vanishing.
  assert.equal(d.rows.find(r => r.analyst === '(unassigned)').cnt, 1);
  // The portfolio is the daily call list, built from TODAY's deck, not Monday's.
  assert.equal(d.portfolio.length, 3);
  assert.equal(d.portfolio.every(p => p.state === 'Reduced'), true);
});

test('settings and access codes need the settings permission', async () => {
  await assert.rejects(() => run('settings', {}, GMO), e => e.status === 403);
  await assert.rejects(() => run('accessCodes', {}, GMO), e => e.status === 403);
  const s = await run('settings');
  assert.ok(s.rows.some(r => r.key === 'COMMISSION_RATE'));
  const db = fakeDb(tables());
  await portalApi(db, ADMIN, 'settingSet', { key: 'COMMISSION_RATE', value: '7' }, NOW);
  assert.equal(db._dump('settings').find(r => r.key === 'COMMISSION_RATE').value, '7');
});

test('call report reachable from the portal, scoped by the code', async () => {
  const d = await run('callReport', { from: TODAY, to: TODAY });
  assert.equal(d.totals.calls, 2);
  assert.equal(d.totals.portfolio, 1);
  const g = await run('callReport', { from: TODAY, to: TODAY }, GMO);
  assert.deepEqual(g.scope, ['KONGOWE']);                   // live-resolved from teams.recovery
  assert.equal(g.totals.calls, 2);
});

test('access codes: add, edit, delete -- and never your own', async () => {
  const db = fakeDb(tables());
  await portalApi(db, ADMIN, 'saveAccessCode', { code: 'NEW1', name: 'NEW OFFICER', role: 'GMO', teams: 'KONGOWE, MBAGALA', tabs: '' }, NOW);
  let rows = (await portalApi(db, ADMIN, 'accessCodes', {}, NOW)).rows;
  const added = rows.find(r => r.code === 'NEW1');
  assert.deepEqual(added.teams, ['KONGOWE', 'MBAGALA']);
  assert.deepEqual(added.tabs, []);
  // Editing the same code updates in place rather than adding a second row.
  await portalApi(db, ADMIN, 'saveAccessCode', { code: 'NEW1', name: 'RENAMED', role: 'GMO', teams: 'ALL', tabs: 'upload' }, NOW);
  rows = (await portalApi(db, ADMIN, 'accessCodes', {}, NOW)).rows;
  assert.equal(rows.filter(r => r.code === 'NEW1').length, 1);
  assert.equal(rows.find(r => r.code === 'NEW1').name, 'RENAMED');
  assert.equal(rows.find(r => r.code === 'NEW1').teams, null);     // ALL -> null, the auth.js convention
  await portalApi(db, ADMIN, 'deleteAccessCode', { code: 'NEW1' }, NOW);
  assert.equal((await portalApi(db, ADMIN, 'accessCodes', {}, NOW)).rows.filter(r => r.code === 'NEW1').length, 0);
  // Deleting the code you are holding would lock you out mid-migration.
  await assert.rejects(() => portalApi(db, ADMIN, 'deleteAccessCode', { code: 'A' }, NOW), /signed in with/i);
  await assert.rejects(() => portalApi(db, GMO, 'saveAccessCode', { code: 'X', name: 'x', role: 'y' }, NOW), e => e.status === 403);
});

test('phone users: list with call counts, sign-out keeps history, delete removes both', async () => {
  const db = fakeDb(tables());
  db._dump('call_users')[0].device_id = 'dev-1';
  let d = await portalApi(db, ADMIN, 'callUsers', {}, NOW);
  assert.equal(d.count, 1);
  assert.equal(d.rows[0].calls, 2);                                // both fixture logs are theirs

  // Sign-out: the row and its history stay, only the device is released.
  await portalApi(db, ADMIN, 'removeCallUser', { userId: 'U1', mode: 'unregister' }, NOW);
  d = await portalApi(db, ADMIN, 'callUsers', {}, NOW);
  assert.equal(d.count, 1);
  assert.equal(d.rows[0].device_id, null);
  assert.equal(db._dump('call_logs').length, 2);

  // Delete: registration AND logs go (logs first, or the FK would refuse).
  await portalApi(db, ADMIN, 'removeCallUser', { userId: 'U1', mode: 'delete' }, NOW);
  assert.equal((await portalApi(db, ADMIN, 'callUsers', {}, NOW)).count, 0);
  assert.equal(db._dump('call_logs').length, 0);

  await assert.rejects(() => portalApi(db, GMO, 'callUsers', {}, NOW), e => e.status === 403);
  await assert.rejects(() => portalApi(db, ADMIN, 'removeCallUser', {}, NOW), /userId is required/);
});

test('teams list is scoped too', async () => {
  assert.equal((await run('teams')).rows.length, 2);
  assert.deepEqual((await run('teams', {}, GMO)).rows.map(r => r.team), ['KONGOWE']);
});

test('storage usage reports what each date costs, per report type', async () => {
  const d = await run('storageUsage');
  assert.ok(d.totalRows > 0);
  const today = d.dates.find(x => x.date === TODAY);
  assert.equal(today.expected, 3);            // 3 rows uploaded for today
  assert.equal(today.defaulters, 6);          // 3 initial + 3 current
  assert.equal(d.newest, TODAY);
  // Only an admin may see (or act on) the storage picture.
  await assert.rejects(() => run('storageUsage', {}, GMO), e => e.status === 403);
});

/* The Settings tab used to download every row of five tables just to count them -- millions of
   rows, over the internet, to work out a number Postgres already knew. It now asks the database
   to count, and falls back to the old way while the migration has not been run by hand yet.
   Both roads have to arrive at the same place, or the tab tells a different story depending on
   whether somebody remembered to run some SQL. */
test('storage counts: asking the database and counting by hand agree exactly', async () => {
  /* Stands in for storage_usage_by_date(): the same GROUP BY, done in JavaScript over the fake.
     It deliberately knows only the ORIGINAL FIVE reports, which makes this the upgrade path as
     well: a live database still running the earlier version of that function answers for five,
     and the app must count the other five itself and arrive at exactly the same totals. Do not
     "fix" this list to match the code -- that is the thing being tested. */
  const COUNT_FN = (store) => {
    const src = [
      ['expected', 'repayment_snapshots', 'snapshot_date'],
      ['defaulters', 'defaulter_snapshots', 'snapshot_date'],
      ['received', 'received_payments', 'paid_at'],
      ['abnormal', 'abnormal_payments', 'created_at'],
      ['calls', 'call_logs', 'call_date'],
    ];
    const out = [];
    for (const [key, table, col] of src) {
      const n = {};
      for (const r of (store[table] ? store[table].rows : [])) {
        const d = String(r[col] == null ? '' : r[col]).slice(0, 10) || null;
        n[d] = (n[d] || 0) + 1;
      }
      for (const [day, count] of Object.entries(n)) out.push({ source: key, day: day === 'null' ? null : day, n: count });
    }
    return out;
  };

  const slow = await portalApi(fakeDb(tables()), ADMIN, 'storageUsage', {}, NOW);
  const fast = await portalApi(fakeDb(tables(), { rpc: { storage_usage_by_date: COUNT_FN } }),
    ADMIN, 'storageUsage', {}, NOW);

  assert.equal(fast.totalRows, slow.totalRows);
  assert.equal(fast.bytes, slow.bytes);
  assert.equal(fast.oldest, slow.oldest);
  assert.equal(fast.newest, slow.newest);
  assert.equal(fast.perDay, slow.perDay);
  assert.deepEqual(fast.dates, slow.dates);
  assert.deepEqual(fast.sources, slow.sources);

  // A database where the function has not been created must NOT error -- that is every live
  // database between a deploy and someone running the migration.
  const notYet = await portalApi(fakeDb(tables(), { rpc: { storage_usage_by_date: null } }),
    ADMIN, 'storageUsage', {}, NOW);
  assert.deepEqual(notYet.dates, slow.dates);

  // Rows with no date of their own still count towards the size, they just belong to no day --
  // otherwise the disk figure would understate what is actually stored.
  const t = tables();
  t.abnormal_payments = (t.abnormal_payments || []).concat([{ id: 'x1', created_at: null }]);
  const withNull = await portalApi(fakeDb(t, { rpc: { storage_usage_by_date: COUNT_FN } }),
    ADMIN, 'storageUsage', {}, NOW);
  const plain = await portalApi(fakeDb(t), ADMIN, 'storageUsage', {}, NOW);
  assert.equal(withNull.totalRows, plain.totalRows);
  assert.deepEqual(withNull.dates, plain.dates);
});

test('cleanup deletes only the chosen types for the chosen date', async () => {
  const db = fakeDb(tables());
  const count = t => db._dump(t).length;
  const before = { exp: count('repayment_snapshots'), def: count('defaulter_snapshots') };

  // Check first: a dry run reports the damage and touches nothing.
  const dry = await portalApi(db, ADMIN, 'purgeSnapshots',
    { date: TODAY, types: ['expected'], dryRun: true }, NOW);
  assert.equal(dry.deleted.expected, 3);
  assert.equal(count('repayment_snapshots'), before.exp);

  const done = await portalApi(db, ADMIN, 'purgeSnapshots', { date: TODAY, types: ['expected'] }, NOW);
  assert.equal(done.total, 3);
  assert.equal(count('repayment_snapshots'), before.exp - 3);   // yesterday's row survives
  assert.equal(count('defaulter_snapshots'), before.def);       // defaulters were not chosen

  // `through` reclaims a whole span at once.
  await portalApi(db, ADMIN, 'purgeSnapshots', { date: TODAY, types: ['expected'], through: true }, NOW);
  assert.equal(count('repayment_snapshots'), 0);

  await assert.rejects(() => portalApi(db, ADMIN, 'purgeSnapshots', { date: TODAY, types: [] }, NOW),
    e => e.status === 400);
  await assert.rejects(() => portalApi(db, GMO, 'purgeSnapshots', { date: TODAY, types: ['expected'] }, NOW),
    e => e.status === 403);
});

/* The cleanup only ever knew five reports, which left an admin able to tidy five things and
   stuck with everything else. Now it covers every report that grows -- and four of those are
   registers people ALSO type into from inside the app, which is where this gets dangerous. */
test('cleanup reaches every report, and never takes what somebody typed', async () => {
  const t = tables();
  const day = TODAY + 'T09:00:00Z';
  t.loans = [
    { id: 'l1', stage: 'approved', upload_date: TODAY },
    { id: 'l2', stage: 'assigned', upload_date: '2020-01-01' },
  ];
  // Two of each: one that arrived in an upload, one somebody typed at the desk.
  t.followup_comments = [{ id: 'c1', created_at: day, upload_batch: 'b1' },
                         { id: 'c2', created_at: day, upload_batch: null }];
  t.complaints = [{ id: 'p1', created_at: day, upload_batch: 'b1' },
                  { id: 'p2', created_at: day, upload_batch: null }];
  t.restructures = [{ id: 'r1', created_at: day, upload_batch: 'b1' },
                    { id: 'r2', created_at: day, upload_batch: null }];
  t.demand_notices = [{ id: 'd1', created_at: day, upload_batch: 'b1' },
                      { id: 'd2', created_at: day, upload_batch: null }];
  const db = fakeDb(t);
  const ids = n => db._dump(n).map(r => r.id);

  // All ten types are offered, and the storage picture accounts for the new ones.
  const usage = await portalApi(db, ADMIN, 'storageUsage', {}, NOW);
  const keys = usage.sources.map(s => s.key);
  for (const k of ['expected', 'defaulters', 'received', 'abnormal', 'calls',
                   'loans', 'comments', 'complaints', 'restructures', 'demand_notices']) {
    assert.ok(keys.includes(k), k + ' is missing from the storage picture');
  }
  assert.equal(usage.sources.find(s => s.key === 'loans').rows, 2);

  // A dry run first: it must report what WOULD go without taking anything.
  const dry = await portalApi(db, ADMIN, 'purgeSnapshots',
    { date: TODAY, types: ['loans', 'comments', 'complaints', 'restructures', 'demand_notices'],
      dryRun: true }, NOW);
  assert.equal(dry.deleted.loans, 1);              // only today's; the 2020 row is another day
  assert.equal(dry.deleted.comments, 1);           // the uploaded one, not the typed one
  assert.equal(dry.total, 5);
  assert.equal(dry.protectedRows, 4, 'says how many typed rows it is leaving alone');
  assert.equal(db._dump('complaints').length, 2, 'a dry run takes nothing');

  const done = await portalApi(db, ADMIN, 'purgeSnapshots',
    { date: TODAY, types: ['loans', 'comments', 'complaints', 'restructures', 'demand_notices'] }, NOW);
  assert.equal(done.total, 5);
  assert.equal(done.protectedRows, 4);

  // THE LINE THAT MATTERS: every desk-typed row is still there, every uploaded one is gone.
  assert.deepEqual(ids('followup_comments'), ['c2']);
  assert.deepEqual(ids('complaints'), ['p2']);
  assert.deepEqual(ids('restructures'), ['r2']);
  assert.deepEqual(ids('demand_notices'), ['d2']);
  assert.deepEqual(ids('loans'), ['l2']);          // the other day's pipeline row survives

  assert.ok(keys.includes('followup'), 'the follow-up list is accounted for too');
});

/* THE FOLLOW-UP LIST WAS THE ONE REGISTER THAT ONLY EVER GREW.

   It was deliberately left out of the cleanup at first, on the reasoning that it is a live
   working list rather than a day of history -- one row per customer, carrying their promises
   and comments. That reasoning is still true, and it is exactly why it accumulated: a customer
   who leaves the deck keeps their row on purpose, so nothing ever removed one. Import a year of
   v1 comments and it gains a placeholder for every customer mentioned as well.

   So it is cleanable now, and the safety is that NOTHING IS HIDDEN: comments cascade, and both
   the count of those and the count of customers who are still live defaulters come back before
   anything is taken. */
test('cleaning the follow-up list says what else goes before it goes', async () => {
  const t = tables();
  t.followup_status = [
    { ref: '555', team: 'KONGOWE', full_name: 'C555', status: 'Defaulter', arrears: 600, updated_at: '2020-01-01T00:00:00Z' },
    { ref: '999', team: 'MBAGALA', full_name: 'C999', status: null, arrears: null, updated_at: '2020-01-01T00:00:00Z' },
    { ref: '111', team: 'KONGOWE', full_name: 'C111', status: 'Defaulter', arrears: 100, updated_at: TODAY + 'T09:00:00Z' },
  ];
  t.followup_comments = [
    { id: 'c1', ref: '555', comment: 'one' }, { id: 'c2', ref: '555', comment: 'two' },
    { id: 'c3', ref: '999', comment: 'three' },
    { id: 'c4', ref: '111', comment: 'still current' },
  ];
  const db = fakeDb(t);

  const dry = await portalApi(db, ADMIN, 'purgeSnapshots',
    { date: '2020-01-01', types: ['followup'], dryRun: true }, NOW);
  assert.equal(dry.deleted.followup, 2, 'the two dormant customers, not the one touched today');
  // THE LINE THAT MATTERS: three comments would go with them, and it is said before, not after.
  assert.equal(dry.cascaded.followup.rows, 3);
  assert.equal(dry.cascaded.followup.stillDefaulters, 1, 'and one of them is still a live defaulter');
  assert.equal(db._dump('followup_status').length, 3, 'a dry run takes nothing');
  assert.equal(db._dump('followup_comments').length, 4);

  const done = await portalApi(db, ADMIN, 'purgeSnapshots',
    { date: '2020-01-01', types: ['followup'] }, NOW);
  assert.equal(done.total, 2);
  assert.equal(done.cascaded.followup.rows, 3);
  assert.deepEqual(db._dump('followup_status').map(r => r.ref), ['111'],
    'the customer touched today stays');
});

test('a stray setting can be removed, and only by an admin', async () => {
  const db = fakeDb(tables());
  await portalApi(db, ADMIN, 'settingSet', { key: 'TYPO_KEY', value: 'oops' }, NOW);
  assert.ok(db._dump('settings').some(r => r.key === 'TYPO_KEY'));

  await assert.rejects(() => portalApi(db, GMO, 'settingDelete', { key: 'TYPO_KEY' }, NOW),
    e => e.status === 403);
  await assert.rejects(() => portalApi(db, ADMIN, 'settingDelete', {}, NOW), e => e.status === 400);

  const r = await portalApi(db, ADMIN, 'settingDelete', { key: 'TYPO_KEY' }, NOW);
  assert.equal(r.deleted, true);
  assert.equal(db._dump('settings').some(x => x.key === 'TYPO_KEY'), false);
  // The real ones are untouched.
  assert.ok(db._dump('settings').some(x => x.key === 'COMMISSION_RATE'));
});

/* The one document here a customer actually SIGNS. The figures were already being worked out
   and stored; there was simply nothing to put in front of them. */
test('the restructuring contract prints exactly what was agreed', async () => {
  const t = tables();
  Object.assign(t.restructures[0], {
    contact: '0714000555', guarantor: 'MAMA ASHA', guarantor_contact: '0715000555',
    first_inst: 200, remaining: 400, interest_amt: 0, start_date: '2026-08-10',
    status: 'Approved', approved_by: 'ASHA JUMA',
  });
  t.settings = (t.settings || []).concat([
    { key: 'CALL_BRAND', value: 'HOPE MICROCREDIT CO. LTD' },
    { key: 'BRAND_STAMP', value: 'data:image/png;base64,STAMP' },
    { key: 'BRAND_SIGN', value: 'data:image/png;base64,SIGN' },
  ]);
  const db = fakeDb(t);
  const c = await portalApi(db, ADMIN, 'restructureContract', { id: 's1' }, NOW);

  // The schedule on the paper comes from the SAME builder the request was created with, so
  // the contract and the books cannot drift.
  assert.equal(c.schedule.length, 4);
  assert.deepEqual(c.schedule.map(s => s.date),
    ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']);
  // Three at the regular amount and a last one carrying the remainder -- never 200×4 = 800
  // when the total is not divisible.
  assert.equal(c.schedule.reduce((s, x) => s + x.amount, 0), 800);

  // Everything a signed document has to name.
  for (const must of ['C555', '0714000555', 'MAMA ASHA', 'HOPE MICROCREDIT CO. LTD',
                      'Sahihi ya mteja', 'Sahihi ya mdhamini', '2026-08-31', '800']) {
    assert.ok(c.html.includes(must), 'the contract must name ' + must);
  }
  // The company's stamp and signature, or it is not a company document.
  assert.ok(c.html.includes('base64,STAMP'), 'the stamp must be on the contract');
  assert.ok(c.html.includes('base64,SIGN'), 'the signature must be on the contract');

  // Found by REF as well as by id, newest first, for printing a replacement copy.
  const byRef = await portalApi(db, ADMIN, 'restructureContract', { ref: '555' }, NOW);
  assert.equal(byRef.row.id, 's1');

  // Team scoping is not optional on a document naming a customer and their guarantor. The row
  // is KONGOWE; a leader scoped to MBAGALA must not be able to print it.
  const OTHER = { code: 'M', name: 'MB LEAD', role: 'GMO', teams: ['MBAGALA'], tabs: [] };
  await assert.rejects(() => portalApi(db, OTHER, 'restructureContract', { id: 's1' }, NOW),
    e => e.status === 403);
  await assert.rejects(() => portalApi(db, ADMIN, 'restructureContract', { id: 'nope' }, NOW),
    e => e.status === 400);
});

/* An officer looking at a commission figure asks "when do I actually get it?" next. Without a
   note on the screen they ask a person instead. */
test('the commission payout note reaches the officer who needs it', async () => {
  const db = fakeDb(tables());
  assert.equal((await portalApi(db, GMO, 'commission', {}, NOW)).payText, '');

  await portalApi(db, ADMIN, 'commissionSave', { payText: 'Kamisheni hulipwa tarehe 5 ya mwezi.' }, NOW);
  assert.equal((await portalApi(db, GMO, 'commission', {}, NOW)).payText,
    'Kamisheni hulipwa tarehe 5 ya mwezi.');

  // Only an admin sets it -- it appears on every officer's screen.
  await assert.rejects(() => portalApi(db, GMO, 'commissionSave', { payText: 'x' }, NOW),
    e => e.status === 403);

  // A settings box is not a place to paste a page of text onto everybody's screen.
  await portalApi(db, ADMIN, 'commissionSave', { payText: 'z'.repeat(900) }, NOW);
  assert.equal((await portalApi(db, ADMIN, 'commission', {}, NOW)).payText.length, 300);

  // Saving the note must not disturb the rates sitting beside it.
  await portalApi(db, ADMIN, 'commissionSave', { paidTzs: 500, overTzs: 800 }, NOW);
  await portalApi(db, ADMIN, 'commissionSave', { payText: 'imebadilika' }, NOW);
  const after = await portalApi(db, ADMIN, 'commission', {}, NOW);
  assert.equal(after.paidTzs, 500);
  assert.equal(after.overTzs, 800);
  assert.equal(after.payText, 'imebadilika');
});

/* The register listed notices as issued and stopped there. So the one question it exists to
   answer -- does serving a demand notice actually bring money back -- had no figures behind
   it. */
test('demand notices show whether they worked', async () => {
  const t = tables();
  const D = (ref, team, arrears, type) => ({ ref, team, arrears, snapshot_type: type,
    weekday: 'FRI', snapshot_date: TODAY, upload_batch: 'b' + type, full_name: 'C' + ref });
  t.demand_notices = [
    { id: 'n1', ref: '111', team: 'KONGOWE', notice_date: TODAY, arrears_at_notice: 1000, total_demand: 1200, fine: 200 },
    { id: 'n2', ref: '555', team: 'KONGOWE', notice_date: TODAY, arrears_at_notice: 800, total_demand: 900, fine: 100 },
    { id: 'n3', ref: '222', team: 'KONGOWE', notice_date: TODAY, arrears_at_notice: 500, total_demand: 600, fine: 100 },
  ];
  // 111 has paid some of it down, 555 has not moved, 222 is off the deck entirely.
  t.defaulter_snapshots = [D('111', 'KONGOWE', 400, 'current'), D('555', 'KONGOWE', 800, 'current')];
  const d = await portalApi(fakeDb(t), ADMIN, 'demandNotices', {}, NOW);
  const by = Object.fromEntries(d.rows.map(r => [r.ref, r]));

  assert.equal(by['111'].arrears_now, 400);
  assert.equal(by['111'].recovered_since, 600);
  assert.match(by['111'].notice_state, /Reducing/);

  assert.equal(by['555'].arrears_now, 800);
  assert.equal(by['555'].recovered_since, 0);
  assert.match(by['555'].notice_state, /No movement/);

  // Gone from the deck is the STRONGEST outcome a notice can have, not missing data.
  assert.equal(by['222'].arrears_now, 0);
  assert.equal(by['222'].recovered_since, 500);
  assert.match(by['222'].notice_state, /Cleared/);

  assert.equal(d.recoveredSince, 1100);
  assert.equal(d.cleared, 1);
  assert.equal(d.atNotice, 2300);

  // WITH NO DECK UPLOADED, every customer would look cleared and the tab would report a
  // triumph that never happened. It must say it does not know instead.
  const noDeck = { ...t, defaulter_snapshots: [] };
  const nd = await portalApi(fakeDb(noDeck), ADMIN, 'demandNotices', {}, NOW);
  assert.equal(nd.rows[0].arrears_now, null);
  assert.equal(nd.rows[0].recovered_since, null);
  assert.equal(nd.recoveredSince, 0);
  assert.equal(nd.cleared, 0);
  assert.match(nd.rows[0].notice_state, /No deck/);
});

/* An officer on the phone with a customer, asking "where is this person right now?". Until
   this it meant opening tabs one at a time while the customer waited. */
test('one search finds a customer in every book at once', async () => {
  const t = tables();
  t.received_payments = [{ id: 'r1', ref_no: '555', customer_name: 'C555', customer_no: '0714000555',
    team: 'KONGOWE', amount_paid: 200, paid_at: TODAY }];
  t.restructures[0].contact = '0714000555';
  const db = fakeDb(t);

  // By reference number -- the thing an officer actually has in front of them.
  const byRef = await portalApi(db, ADMIN, 'customerSearch', { q: '555' }, NOW);
  const keys = byRef.books.map(b => b.key);
  assert.ok(keys.includes('defaulters'), 'found in the defaulter deck');
  assert.ok(keys.includes('followup'), 'found in the follow-up book');
  assert.ok(keys.includes('payments'), 'found in received payments');
  assert.ok(keys.includes('restructures'), 'found in restructuring');
  assert.ok(byRef.total >= 4);
  // Every book is named, so an officer can say where each figure came from.
  assert.ok(byRef.books.every(b => b.label), 'each book says what it is');

  // By NAME.
  const byName = await portalApi(db, ADMIN, 'customerSearch', { q: 'c555' }, NOW);
  assert.ok(byName.total > 0, 'a name finds them too');

  // By PHONE, however it is written. 0714000555 typed with spaces, or with the country code.
  for (const q of ['0714000555', '0714 000 555', '255714000555']) {
    const byPhone = await portalApi(db, ADMIN, 'customerSearch', { q }, NOW);
    assert.ok(byPhone.total > 0, 'a phone written as "' + q + '" must still find them');
  }

  // TEAM SCOPING IS NOT OPTIONAL. A search box is not a way around it.
  const mbagala = { code: 'M', name: 'MB', role: 'GMO', teams: ['MBAGALA'], tabs: [] };
  const blocked = await portalApi(db, mbagala, 'customerSearch', { q: '555' }, NOW);
  assert.equal(blocked.total, 0, "another team's customer must not appear");
  assert.equal(JSON.stringify(blocked).includes('C555'), false);

  // Two characters matches half the book and answers nothing.
  const tiny = await portalApi(db, ADMIN, 'customerSearch', { q: '55' }, NOW);
  assert.equal(tiny.tooShort, true);
  assert.equal(tiny.total, 0);
  assert.equal((await portalApi(db, ADMIN, 'customerSearch', {}, NOW)).tooShort, true);

  // Somebody nobody has is an empty answer, not an error.
  const none = await portalApi(db, ADMIN, 'customerSearch', { q: 'ZZZNOBODY' }, NOW);
  assert.equal(none.total, 0);
  assert.equal(none.tooShort, false);

  // A % typed into the box must not turn into "match everything".
  const wild = await portalApi(db, ADMIN, 'customerSearch', { q: '%%%' }, NOW);
  assert.equal(wild.total, 0, 'a wildcard typed by a person is text, not a query');
});

/* The noticeboard. Its table has been in the schema since the start and nothing ever wrote to
   it. It reaches the SIGN-IN screen, so what it will accept matters more than most things. */
test('an announcement reaches every screen, and will not carry just anything', async () => {
  const db = fakeDb(tables());
  const PNG = 'data:image/png;base64,' + 'A'.repeat(40);

  // Nothing posted = nothing shown, and the phone's poll stays tiny.
  assert.deepEqual(await callApi(db, 'api_announcement', [], NOW), { on: false, ts: 0 });

  await portalApi(db, ADMIN, 'announceSave', { text: 'Mkutano Jumatatu saa 2.', image: PNG }, NOW);
  const a = await callApi(db, 'api_announcement', [], NOW);
  assert.equal(a.on, true);
  assert.equal(a.text, 'Mkutano Jumatatu saa 2.');
  assert.equal(a.image, PNG);
  assert.ok(a.ts > 0, 'a version stamp, so a phone fetches the image only when it changes');

  // Taking the PICTURE off does not end the announcement while words remain. Two things were
  // posted; removing one is not removing both.
  await portalApi(db, ADMIN, 'announceSave', { text: 'Mkutano Jumatatu saa 2.', image: '' }, NOW);
  const words = await callApi(db, 'api_announcement', [], NOW);
  assert.equal(words.on, true);
  assert.equal(words.image, '');

  // Emptying both ends it.
  await portalApi(db, ADMIN, 'announceSave', { text: '', image: '' }, NOW);
  assert.equal((await callApi(db, 'api_announcement', [], NOW)).on, false);

  // A URL would let a noticeboard point every screen in the company at somebody else's server.
  await assert.rejects(
    () => portalApi(db, ADMIN, 'announceSave', { image: 'https://example.com/x.png' }, NOW),
    e => e.status === 400);
  await assert.rejects(
    () => portalApi(db, ADMIN, 'announceSave', { image: 'data:text/html;base64,PHNjcmlwdD4=' }, NOW),
    e => e.status === 400);

  // Every phone in the field loads this, most of them on mobile data.
  await assert.rejects(
    () => portalApi(db, ADMIN, 'announceSave', { image: 'data:image/png;base64,' + 'A'.repeat(700 * 1024) }, NOW),
    e => e.status === 400);

  // A noticeboard is not a place to paste a page onto everybody's screen.
  await portalApi(db, ADMIN, 'announceSave', { text: 'z'.repeat(900) }, NOW);
  assert.equal((await callApi(db, 'api_announcement', [], NOW)).text.length, 500);

  // Whoever loads the company's reports posts to the company's noticeboard -- not everybody.
  await assert.rejects(() => portalApi(db, GMO, 'announceSave', { text: 'hi' }, NOW),
    e => e.status === 403);
});

/* How a supervisor learns a complaint was logged without opening the complaints tab. */
test('the bell merges complaints and comments, scoped to your own teams', async () => {
  const t = tables();
  t.complaints = [
    { id: 'p1', ref: '111', team: 'KONGOWE', complainant: 'AMINA', details: 'hakupewa risiti', created_at: TODAY + 'T09:00:00Z', created_by: 'DESK' },
    { id: 'p2', ref: '999', team: 'MBAGALA', complainant: 'OTHER', details: 'nje ya timu', created_at: TODAY + 'T10:00:00Z', created_by: 'DESK' },
  ];
  t.followup_comments = [
    { id: 'f1', ref: '555', team: 'KONGOWE', full_name: 'C555', comment: 'ataleta kesho', created_at: TODAY + 'T08:00:00Z', created_by: 'JUMA G' },
  ];
  const db = fakeDb(t);

  // A leader over KONGOWE sees their own two and not the other team's.
  const mine = await portalApi(db, GMO, 'notifications', {}, NOW);
  // Ids are prefixed by stream so a complaint and a comment can never collide on the same key.
  assert.deepEqual(mine.items.map(i => i.id), ['cp1', 'ff1']);
  assert.equal(mine.items.every(i => i.team === 'KONGOWE'), true);
  assert.equal(JSON.stringify(mine).includes('nje ya timu'), false, "another team's complaint leaked");

  // Newest first -- the complaint at 09:00 above the comment at 08:00.
  assert.equal(mine.items[0].kind, 'complaint');
  assert.equal(mine.items[1].kind, 'comment');

  // Everything is unseen until somebody says otherwise.
  assert.equal(mine.unseen, 2);

  // Marking them read is PER CODE: one supervisor clearing their bell must not clear another's.
  await portalApi(db, GMO, 'notifSeen', {}, Date.parse(TODAY + 'T11:00:00Z'));
  assert.equal((await portalApi(db, GMO, 'notifications', {}, NOW)).unseen, 0);
  assert.equal((await portalApi(db, ADMIN, 'notifications', {}, NOW)).unseen > 0, true,
    "one person's bell must not clear everybody's");

  // Something new after that stamp shows up again. Written into the DATABASE, not the fixture
  // it was built from -- the fake copies its rows on construction, the way a real one would.
  db._dump('complaints').push({ id: 'p3', ref: '111', team: 'KONGOWE', complainant: 'NEW',
    details: 'baadaye', created_at: TODAY + 'T12:00:00Z', created_by: 'DESK' });
  const later = await portalApi(db, GMO, 'notifications', {}, NOW);
  assert.equal(later.items[0].what, 'baadaye');
  assert.equal(later.unseen, 1);
});

/* Every other register can lose a row -- teams, roles, access codes, officer accounts, call
   agents. Complaints could not, so one logged against the wrong customer stayed in the
   register and in every count built off it. */
test('a complaint can be removed, and the removal is on the record', async () => {
  const t = tables();
  t.complaints = [{ id: 'p1', ref: '111', team: 'KONGOWE', complainant: 'AMINA',
    details: 'imeandikwa vibaya', status: 'Open', created_at: TODAY + 'T09:00:00Z' }];
  const db = fakeDb(t);

  const out = await portalApi(db, ADMIN, 'deleteComplaint', { id: 'p1' }, NOW);
  assert.equal(out.deleted, true);
  assert.equal(db._dump('complaints').length, 0);

  /* THE TRAIL SURVIVES THE ROW. complaint_log cascades on delete, so a note filed against the
     complaint would have vanished with it -- leaving a register somebody could quietly empty.
     It is recorded with no complaint_id for exactly that reason. */
  const log = db._dump('complaint_log');
  const gone = log.find(x => x.action === 'DELETED');
  assert.ok(gone, 'the deletion is on the record');
  assert.equal(gone.complaint_id, null, 'and is not attached to the row it describes');
  assert.equal(gone.created_by, ADMIN.name, 'named to whoever did it');
  assert.ok(String(gone.note).includes('AMINA'), 'saying what was removed');

  // Only an admin, and only within their own teams.
  const db2 = fakeDb(t);
  await assert.rejects(() => portalApi(db2, GMO, 'deleteComplaint', { id: 'p1' }, NOW),
    e => e.status === 403);
  assert.equal(db2._dump('complaints').length, 1, 'a refused delete removes nothing');
  await assert.rejects(() => portalApi(db2, ADMIN, 'deleteComplaint', {}, NOW), e => e.status === 400);
  await assert.rejects(() => portalApi(db2, ADMIN, 'deleteComplaint', { id: 'nope' }, NOW), e => e.status === 400);
});

/* Eight stage cards answer "where are they" and never "how many". */
test('the pipeline says how many applications there are altogether', async () => {
  const t = tables();
  t.loans = [
    { id: 'l1', team: 'KONGOWE', stage: 'approved', principal_amt: 300000, requested_amt: 350000 },
    { id: 'l2', team: 'KONGOWE', stage: 'unassigned', requested_amt: 200000 },
    { id: 'l3', team: 'MBAGALA', stage: 'disbursed', principal_amt: 100000, requested_amt: 120000 },
  ];
  const all = await portalApi(fakeDb(t), ADMIN, 'loanPipeline', {}, NOW);
  assert.equal(all.total, 3);
  assert.equal(all.requested, 670000);
  // The per-stage cards are untouched by the addition.
  assert.equal(all.stages.find(s => s.stage === 'approved').count, 1);

  // Scoped like everything else: a leader sees their own teams' pipeline, not the company's.
  const mine = await portalApi(fakeDb(t), GMO, 'loanPipeline', {}, NOW);
  assert.equal(mine.total, 2);
  assert.equal(mine.requested, 550000);
});

test('every complaint save is written to the audit trail', async () => {
  const db = fakeDb(tables());
  // The complaint_log table existed from the start but nothing wrote to it, so "who changed
  // this, and when" -- the question the register exists to answer -- had no data behind it.
  const made = await portalApi(db, ADMIN, 'saveComplaint',
    { complainant: 'MAMA D', team: 'KONGOWE', category: 'Malipo / Payment', details: 'hakupata risiti' }, NOW);
  assert.equal(made.action, 'registered');

  await portalApi(db, ADMIN, 'saveComplaint',
    { id: made.id, complainant: 'MAMA D', team: 'KONGOWE', details: 'hakupata risiti mbili' }, NOW);
  await portalApi(db, ADMIN, 'saveComplaint',
    { id: made.id, complainant: 'MAMA D', team: 'KONGOWE', status: 'Resolved', resolution: 'risiti imetumwa' }, NOW);

  const log = await portalApi(db, ADMIN, 'complaintLog', { id: made.id }, NOW);
  assert.deepEqual(log.rows.map(r => r.action).sort(), ['edited', 'registered', 'resolved']);
  assert.ok(log.rows.every(r => r.created_by === 'THE ADMIN'));

  // Resolving stamps who closed it, and only on the transition.
  const row = db._dump('complaints').find(r => r.id === made.id);
  assert.equal(row.status, 'Resolved');
  assert.equal(row.resolved_by, 'THE ADMIN');
  assert.equal(row.complainant, 'MAMA D');
});

test('a complaint cannot be saved into, or read from, a team you cannot see', async () => {
  const db = fakeDb(tables());
  await assert.rejects(() => portalApi(db, GMO, 'saveComplaint',
    { complainant: 'X', team: 'MBAGALA', details: 'y' }, NOW), e => e.status === 403);
  const mine = await portalApi(db, GMO, 'saveComplaint',
    { complainant: 'X', team: 'KONGOWE', details: 'y' }, NOW);
  assert.ok(mine.id);
  await assert.rejects(() => portalApi(db, ADMIN, 'saveComplaint', { complainant: '  ' }, NOW),
    e => e.status === 400);
});

test('complaints are date-ranged and carry their own vocabularies', async () => {
  const db = fakeDb(tables());
  const d = await portalApi(db, ADMIN, 'complaints', { from: TODAY, to: TODAY }, NOW);
  assert.equal(d.count, 1);
  assert.equal(d.loggedToday, 1);
  assert.ok(d.categories.length && d.channels.length && d.statuses.includes('Resolved'));
  // A window that excludes it returns nothing rather than everything.
  const none = await portalApi(db, ADMIN, 'complaints', { from: MON, to: MON }, NOW);
  assert.equal(none.count, 0);
});

test('restructuring derives every number from the customer, not from the browser', async () => {
  const db = fakeDb(tables());
  // Give 555 a real-sized arrears and enough missed installments to qualify.
  for (const r of db._dump('defaulter_snapshots')) if (r.ref === '555' && r.snapshot_type === 'current') {
    r.dc = 5; r.arrears = 600000;
  }

  const e = await portalApi(db, ADMIN, 'restructureEligible', { ref: '555' }, NOW);
  assert.equal(e.found, true); assert.equal(e.eligible, true);
  assert.equal(e.arrears, 600000); assert.equal(e.minDc, 4);

  // Client sends a flattering arrears figure and a total it made up -- both are ignored.
  const made = await portalApi(db, ADMIN, 'addRestructure',
    { ref: '555', firstInst: 100000, installments: 4, interestOn: true,
      arrears: 999999999, total: 1, instAmt: 1, startDate: '2026-07-27' }, NOW);
  const c = made.computed;
  assert.equal(c.arrears, 600000);              // from the deck, not the payload
  assert.equal(c.first, 100000);
  assert.equal(c.remaining, 500000);
  assert.equal(c.interest, 60000);              // 12% of the remaining
  assert.equal(c.total, 560000);
  assert.equal(c.per, 140000);                  // 140,000 is already a multiple of 500
  // The last installment absorbs the rounding so the schedule sums to the total exactly.
  assert.equal(made.schedule.reduce((s, x) => s + x.amount, 0), 560000);
  assert.deepEqual(made.schedule.map(x => x.date),
    ['2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17']);
  // And what was stored matches what was previewed.
  assert.equal(made.row.total, 560000);
  assert.equal(made.row.inst_amt, 140000);
  assert.equal(made.row.status, 'Pending');
});

test('a total too small to split is refused rather than scheduled as zeroes', async () => {
  const db = fakeDb(tables());
  for (const r of db._dump('defaulter_snapshots')) if (r.ref === '555' && r.snapshot_type === 'current') r.dc = 5;
  // 600 over 4 weekly installments rounds to 0 each; a schedule of 0/0/0/600 is not an offer.
  await assert.rejects(() => portalApi(db, ADMIN, 'addRestructure',
    { ref: '555', firstInst: 0, installments: 4 }, NOW),
    e => e.status === 400 && /Reduce the count/.test(e.message));
});

test('restructuring refuses the ineligible, the oversized and the impossible', async () => {
  const db = fakeDb(tables());
  // 555 has dc 3 in the fixture -- below the 4 the policy requires.
  await assert.rejects(() => portalApi(db, ADMIN, 'addRestructure',
    { ref: '555', firstInst: 0, installments: 4 }, NOW), e => e.status === 400);

  for (const r of db._dump('defaulter_snapshots')) if (r.ref === '555') r.dc = 5;
  // 4 months x 4 weeks = 16 installments is the cap.
  await assert.rejects(() => portalApi(db, ADMIN, 'addRestructure',
    { ref: '555', firstInst: 0, installments: 20 }, NOW), e => e.status === 400);
  // Paying the whole arrears up front leaves nothing to reschedule.
  await assert.rejects(() => portalApi(db, ADMIN, 'addRestructure',
    { ref: '555', firstInst: 600, installments: 4 }, NOW), e => e.status === 400);
  // A REF that is not a current defaulter at all.
  await assert.rejects(() => portalApi(db, ADMIN, 'addRestructure',
    { ref: 'NOPE', installments: 4 }, NOW), e => e.status === 400);
});

test('only an approver can decide a restructuring offer', async () => {
  const db = fakeDb(tables());
  // GMO is not in RESTRUCTURE_APPROVERS and holds no settings tab -- approving a restructure
  // rewrites a customer's obligations, and anyone could do it before.
  await assert.rejects(() => portalApi(db, GMO, 'decideRestructure',
    { id: 's1', decision: 'approve' }, NOW), e => e.status === 403);
  // Rejecting without a reason leaves no record of why.
  await assert.rejects(() => portalApi(db, ADMIN, 'decideRestructure',
    { id: 's1', decision: 'reject' }, NOW), e => e.status === 400);

  await portalApi(db, ADMIN, 'decideRestructure', { id: 's1', decision: 'reject', reason: 'hana uwezo' }, NOW);
  const row = db._dump('restructures').find(r => r.id === 's1');
  assert.equal(row.status, 'Rejected');
  assert.equal(row.reject_reason, 'hana uwezo');
  assert.equal(row.approved_by, 'THE ADMIN');
  // A decided offer cannot be decided twice.
  await assert.rejects(() => portalApi(db, ADMIN, 'decideRestructure',
    { id: 's1', decision: 'approve' }, NOW), e => e.status === 400);
});

test('demand notice: the fine only starts after the grace period, and scales with the year', async () => {
  const db = fakeDb(tables());
  const setDef = patch => {
    for (const r of db._dump('defaulter_snapshots')) {
      if (r.ref === '555' && r.snapshot_type === 'current') Object.assign(r, patch);
    }
  };
  // Disbursed 2026-01-05, weekly installment 40,000, 3 of 12 paid.
  // First missed due = disb + 7 x 4 days = 2026-02-02; grace ends two weeks later, 2026-02-16.
  setDef({ disb_date: '2026-01-05', expire_date: '2026-03-30', other_inst: 40000,
    initial_inst: 100000, t_payment: 220000, ds: '3/12' });

  // Inside the grace window: no fine. Charging one here would be indefensible.
  const early = await portalApi(db, ADMIN, 'legalPreview',
    { ref: '555', noticeDate: '2026-02-10' }, NOW);
  assert.equal(early.weeks, 0); assert.equal(early.fine, 0);

  // Four weeks past the grace end, at 5% (disbursed after 2024).
  const late = await portalApi(db, ADMIN, 'legalPreview',
    { ref: '555', noticeDate: '2026-03-16' }, NOW);
  assert.equal(late.ratePct, 5);
  assert.equal(late.weeks, 4);
  assert.equal(late.fine, 8000);                        // 4 x 0.05 x 40,000
  // total loan = 100,000 + 11 x 40,000 = 540,000; paid 220,000 -> 320,000 remaining.
  assert.equal(late.totalLoan, 540000);
  assert.equal(late.principalRemaining, 320000);
  assert.equal(late.totalDemand, 328000);               // remaining + fine, rounded up to 500

  // The same loan written in 2024 carries the older 2% rate.
  setDef({ disb_date: '2024-01-05', expire_date: '2024-03-30' });
  const old = await portalApi(db, ADMIN, 'legalPreview', { ref: '555', noticeDate: '2024-03-16' }, NOW);
  assert.equal(old.ratePct, 2);
});

test('issuing a notice stores what it prints, under a citable reference', async () => {
  const db = fakeDb(tables());
  for (const r of db._dump('defaulter_snapshots')) {
    if (r.ref === '555' && r.snapshot_type === 'current') {
      Object.assign(r, { disb_date: '2026-01-05', expire_date: '2026-03-30', other_inst: 40000,
        initial_inst: 100000, t_payment: 220000, ds: '3/12', full_name: 'ASHA JUMA MOSHI' });
    }
  }
  const a = await portalApi(db, ADMIN, 'addDemandNotice',
    { ref: '555', noticeDate: '2026-03-16', noticeDays: 7 }, NOW);
  assert.equal(a.noticeId, 'HMCL/AJM/16/03/2026');
  assert.equal(a.totalDemand, 328000);

  // The register row carries the same figures the letter states.
  const row = db._dump('demand_notices').find(r => r.notice_id === a.noticeId);
  assert.equal(row.total_demand, 328000);
  assert.equal(row.fine, 8000);
  assert.equal(row.paid_count, 3);
  assert.equal(row.issued_by, 'THE ADMIN');

  // And the letter itself states them, in words the customer reads.
  assert.match(a.html, /Kumb\.Na\. HMCL\/AJM\/16\/03\/2026/);
  assert.match(a.html, /SHILINGI 328,000\/= NDANI YA SIKU SABA/);
  assert.match(a.html, /marejesho 3 kati ya 12/);

  // Serving the same person again the same day gets its own reference, never a duplicate.
  const b = await portalApi(db, ADMIN, 'addDemandNotice',
    { ref: '555', noticeDate: '2026-03-16', noticeDays: 7 }, NOW);
  assert.equal(b.noticeId, 'HMCL/AJM/16/03/2026-2');

  // Team scoping holds: MBAGALA's 999 is not GMO's to serve.
  await assert.rejects(() => portalApi(db, GMO, 'legalPreview', { ref: '999' }, NOW),
    e => e.status === 403);
  await assert.rejects(() => portalApi(db, ADMIN, 'addDemandNotice', { ref: 'NOPE' }, NOW),
    e => e.status === 400);
});

test('upload status says what is still missing for today', async () => {
  const db = fakeDb(tables());
  const d = await portalApi(db, ADMIN, 'uploadStatus', {}, NOW);
  // The fixture has today's Expected and today's FRI current deck loaded.
  assert.equal(d.weekday, 'FRI');
  assert.equal(d.ready, true);
  assert.deepEqual(d.missing, []);
  const exp = d.items.find(i => i.key === 'expected-today');
  assert.equal(exp.loadedToday, true);
  assert.equal(exp.today, 3);
  assert.equal(exp.latest, TODAY);
  // A weekday deck that was never uploaded reads "never" rather than going unmentioned.
  const mon = d.items.find(i => i.key === 'defaulters-current-MON');
  assert.equal(mon.loadedToday, false);
  assert.equal(mon.latest, null);

  // Drop today's Expected and it becomes a named gap -- a missing upload never errors on its
  // own, it just leaves yesterday's numbers on today's dashboard.
  await portalApi(db, ADMIN, 'purgeSnapshots', { date: TODAY, types: ['expected'] }, NOW);
  const after = await portalApi(db, ADMIN, 'uploadStatus', {}, NOW);
  assert.equal(after.ready, false);
  assert.deepEqual(after.missing, ['Expected — today']);

  // It is the UPLOADER's panel, so upload permission is what gates it, not settings.
  await assert.rejects(() => portalApi(db, GMO, 'uploadStatus', {}, NOW), e => e.status === 403);
  const uploader = { ...GMO, tabs: ['upload'] };
  assert.ok((await portalApi(db, uploader, 'uploadStatus', {}, NOW)).items.length > 0);
});

test('roles can be created, edited and safely deleted', async () => {
  const db = fakeDb(tables());
  await portalApi(db, ADMIN, 'saveRole', { role: 'recovery', tabs: 'dashboard, followup, nonsense, calls' }, NOW);
  const saved = db._dump('roles').find(r => r.role === 'RECOVERY');
  // Name is normalised, and a tab that does not exist is dropped rather than stored and
  // silently ignored at permission-check time.
  assert.deepEqual(saved.tabs, ['dashboard', 'followup', 'calls']);

  const t = await portalApi(db, ADMIN, 'teams', {}, NOW);
  assert.ok(t.roles.some(r => r.role === 'RECOVERY'));
  assert.ok(t.allTabs.includes('upload'));

  // A role still in use cannot be deleted: codes with a blank tab list inherit from their
  // role, so removing it would quietly strip those people back to the default set.
  await assert.rejects(() => portalApi(db, ADMIN, 'deleteRole', { role: 'ADMIN' }, NOW),
    e => e.status === 400);
  await portalApi(db, ADMIN, 'saveAccessCode',
    { code: 'R1', name: 'REC ONE', role: 'RECOVERY', teams: 'KONGOWE' }, NOW);
  await assert.rejects(() => portalApi(db, ADMIN, 'deleteRole', { role: 'RECOVERY' }, NOW),
    e => e.status === 400 && /still use/.test(e.message));

  await portalApi(db, ADMIN, 'deleteAccessCode', { code: 'R1' }, NOW);
  await portalApi(db, ADMIN, 'deleteRole', { role: 'RECOVERY' }, NOW);
  assert.equal(db._dump('roles').some(r => r.role === 'RECOVERY'), false);

  await assert.rejects(() => portalApi(db, GMO, 'saveRole', { role: 'X', tabs: 'dashboard' }, NOW),
    e => e.status === 403);
});

test('leader reports roll teams up under each supervisor, not just per team', async () => {
  const db = fakeDb(tables());
  const d = await portalApi(db, ADMIN, 'leaderReports', {}, NOW);
  const rec = d.sections.find(s => s.role === 'recovery');

  // KONGOWE names JUMA G as recovery; MBAGALA names nobody. An unstaffed role is exactly
  // what a leader report should surface, so it collects rather than disappearing.
  const juma = rec.rows.find(r => r.leader === 'JUMA G');
  assert.equal(juma.teams, 1);
  assert.equal(juma.teamList, 'KONGOWE');
  assert.equal(juma.initArrears, 1200);
  assert.equal(juma.recovered, 300);
  assert.equal(juma.progress, 25);
  assert.equal(rec.rows.find(r => r.leader === '(unassigned)').teams, 1);
  assert.equal(rec.unstaffed, 1);

  // BOSS manages KONGOWE, so the SAME team appears again under the manager section.
  const mgr = d.sections.find(s => s.role === 'manager');
  assert.equal(mgr.rows.find(r => r.leader === 'BOSS').teamList, 'KONGOWE');

  // Every section covers all the teams the viewer can see, so the totals agree across them.
  for (const s of d.sections) assert.equal(s.totals.teams, d.totals.teams);
  assert.equal(d.totals.recovered, 400);
});

test('loan applications default to the whole pipeline, not one stage', async () => {
  const db = fakeDb(tables());
  // "Where is every application right now" is what this tab gets asked most, and forcing a
  // stage first meant a docket could only be found if you already knew its stage.
  const all = await portalApi(db, ADMIN, 'loans', {}, NOW);
  assert.equal(all.stage, '');
  assert.equal(all.count, 4);                      // 2 approved + 1 disbursed + 1 unassigned
  assert.equal(all.amount, 650000);
  // A named stage still narrows it.
  const appr = await portalApi(db, ADMIN, 'loans', { stage: 'approved' }, NOW);
  assert.equal(appr.count, 2);
  // Team scoping still applies to the unfiltered view.
  assert.equal((await portalApi(db, GMO, 'loans', {}, NOW)).count, 3);
});

test('an access code can be changed — it is the password, so it must be rotatable', async () => {
  const db = fakeDb(tables());
  await portalApi(db, ADMIN, 'saveAccessCode',
    { code: 'TEGETA', name: 'MR T', role: 'GMO', teams: 'KONGOWE' }, NOW);

  const r = await portalApi(db, ADMIN, 'saveAccessCode',
    { oldCode: 'TEGETA', code: 'TEGETA77', name: 'MR T', role: 'GMO', teams: 'KONGOWE' }, NOW);
  assert.equal(r.renamedFrom, 'TEGETA');
  const codes = db._dump('access_codes').map(c => c.code);
  assert.ok(codes.includes('TEGETA77'));
  assert.equal(codes.includes('TEGETA'), false);          // the old one stops working
  assert.equal(db._dump('access_codes').find(c => c.code === 'TEGETA77').name, 'MR T');

  // Renaming onto a code someone else holds would hand them that person's access.
  await portalApi(db, ADMIN, 'saveAccessCode', { code: 'OTHER', name: 'X', role: 'GMO' }, NOW);
  await assert.rejects(() => portalApi(db, ADMIN, 'saveAccessCode',
    { oldCode: 'TEGETA77', code: 'OTHER', name: 'MR T', role: 'GMO' }, NOW),
    e => e.status === 400 && /already in use/.test(e.message));

  // And you cannot rename the code you are currently signed in with.
  await assert.rejects(() => portalApi(db, ADMIN, 'saveAccessCode',
    { oldCode: 'A', code: 'A2', name: 'THE ADMIN', role: 'ADMIN' }, NOW),
    e => e.status === 400 && /signed in with/.test(e.message));
});

/* Expected defaulters, per recycling leader. KONGOWE names BOSS as manager and JUMA G as
   recovery; give the deck a manager-owned and a gmo-owned customer so the split is real. */
function expdfTables() {
  const t = tables();
  t.teams[0] = { ...t.teams[0], gmo: 'GMO GEE', manager: 'BOSS', bike: 'BIKE BEE' };
  t.settings.push({ key: 'ASSIGN_ACTIVE', value: 'BIKE,MANAGER,GMO' },
    { key: 'ASSIGN_BUCKET_DAYS', value: '2' });
  const D = (ref, arrears, type, days, disb) => ({
    ref, full_name: 'C' + ref, contact: '07140000' + ref, team: 'KONGOWE', arrears,
    status: 'Defaulter', ds: '2/6', dc: 2, days_elapsed: days, disb_date: disb,
    snapshot_type: type, weekday: 'FRI', snapshot_date: TODAY,
    upload_batch: 'b' + type + TODAY, created_at: TODAY + 'T04:00:00Z',
  });
  // days_elapsed 1-2 -> bucket 1 -> BIKE; 3-4 -> bucket 2 -> MANAGER; 5-6 -> bucket 3 -> GMO.
  // Disbursed 2026-07-21 (Tue) -> visited Tue and Fri; TODAY is a Friday.
  t.defaulter_snapshots = [
    D('A1', 1000, 'initial', 1, '2026-07-21'), D('A1', 600, 'current', 1, '2026-07-21'),
    D('A2', 2000, 'initial', 3, '2026-07-21'), D('A2', 1500, 'current', 3, '2026-07-21'),
    D('A3', 3000, 'initial', 5, '2026-07-21'), D('A3', 3000, 'current', 5, '2026-07-21'),
  ];
  return t;
}

test('a recycling leader sees only their own expected defaulters, with the cycle label', async () => {
  const db = fakeDb(expdfTables());
  const asLeader = n => ({ code: 'X', name: n, role: 'MANAGER', teams: null, tabs: [] });

  const boss = await portalApi(db, asLeader('BOSS'), 'expdfMine', {}, NOW);
  assert.deepEqual(boss.rows.map(r => r.ref), ['A2']);        // bucket 2 -> MANAGER
  assert.equal(boss.rows[0].cycle, 'D3');                     // D<days elapsed>
  assert.equal(boss.totals.initial, 2000);
  assert.equal(boss.totals.arrears, 1500);
  assert.equal(boss.totals.recovered, 500);
  assert.equal(boss.totals.pct, 25);                          // 500 of 2000

  const gmo = await portalApi(db, asLeader('GMO GEE'), 'expdfMine', {}, NOW);
  assert.deepEqual(gmo.rows.map(r => r.ref), ['A3']);
  assert.equal(gmo.totals.recovered, 0);                      // arrears unchanged
  assert.equal(gmo.totals.pct, 0);

  const bike = await portalApi(db, asLeader('BIKE BEE'), 'expdfMine', {}, NOW);
  assert.deepEqual(bike.rows.map(r => r.ref), ['A1']);
  assert.equal(bike.byCycle[0].cycle, 'D1');

  // Somebody who holds none of the three roles is not left with an empty screen: the whole
  // company follows up in this mode, so they see the day's list for the teams they may see,
  // with the assigned leader named on every row.
  const anyone = await portalApi(db, asLeader('NOBODY'), 'expdfMine', {}, NOW);
  assert.equal(anyone.scope, 'team');
  assert.deepEqual(anyone.rows.map(r => r.ref).sort(), ['A1', 'A2', 'A3']);
  assert.ok(anyone.rows.every(r => r.leader && r.role));
  assert.equal(anyone.canSwitch, false);
  // And a leader can still ask for the wider list explicitly.
  const wide = await portalApi(db, asLeader('BOSS'), 'expdfMine', { scope: 'team' }, NOW);
  assert.equal(wide.rows.length, 3);
  assert.equal(wide.canSwitch, true);
  assert.deepEqual(wide.byLeader.map(x => x.leader).sort(),
    ['BIKE BEE · BIKE', 'BOSS · MANAGER', 'GMO GEE · GMO']);
});

test('expdf leaves out customers not due on the visit day, unless asked for all', async () => {
  const db = fakeDb(expdfTables());
  // Disbursed on a Wednesday -> visited Wed and Sat, so NOT due on this Friday.
  for (const r of db._dump('defaulter_snapshots')) if (r.ref === 'A2') r.disb_date = '2026-07-22';
  const me = { code: 'X', name: 'BOSS', role: 'MANAGER', teams: null, tabs: [] };
  assert.equal((await portalApi(db, me, 'expdfMine', {}, NOW)).rows.length, 0);
  const all = await portalApi(db, me, 'expdfMine', { all: true }, NOW);
  assert.equal(all.rows.length, 1);
  assert.equal(all.totals.recovered, 500);
});

test('the expdf report splits GMO / MANAGER / BIKE and totals the whole book', async () => {
  const db = fakeDb(expdfTables());
  const d = await portalApi(db, ADMIN, 'expdfReport', {}, NOW);
  assert.deepEqual(d.sections.map(s => s.role), ['GMO', 'MANAGER', 'BIKE']);
  const mgr = d.sections.find(s => s.role === 'MANAGER');
  assert.equal(mgr.rows[0].leader, 'BOSS');
  assert.equal(mgr.totals.recovered, 500);
  assert.equal(mgr.totals.pct, 25);
  // 1000 + 2000 + 3000 initial, 400 + 500 + 0 recovered.
  assert.equal(d.totals.initial, 6000);
  assert.equal(d.totals.recovered, 900);
  assert.equal(d.totals.pct, 15);
  assert.equal(d.weekly, false);
  // Weekly measures against MONDAY's deck; there is none here, so it falls back to the day's
  // own initial rather than inventing a baseline.
  const w = await portalApi(db, ADMIN, 'expdfReport', { weekly: true }, NOW);
  assert.equal(w.weekly, true);
  assert.equal(w.totals.recovered, 900);
});

test('the weekly email refuses clearly when it is not configured, and never sends daily', async () => {
  const db = fakeDb(expdfTables());
  delete process.env.RESEND_API_KEY;
  await assert.rejects(() => portalApi(db, ADMIN, 'emailWeeklyExpdf', {}, NOW),
    e => e.status === 400 && /RESEND_API_KEY/.test(e.message));

  process.env.RESEND_API_KEY = 'test-key';
  await assert.rejects(() => portalApi(db, ADMIN, 'emailWeeklyExpdf', {}, NOW),
    e => e.status === 400 && /ADMIN_EMAIL/.test(e.message));
  delete process.env.RESEND_API_KEY;

  // It is admin-only, and there is deliberately no scheduled sender anywhere in the codebase.
  await assert.rejects(() => portalApi(db, GMO, 'emailWeeklyExpdf', {}, NOW), e => e.status === 403);
});

test('uploading the current deck rebuilds the officers working list', async () => {
  // The phone's Def/Exp/Chr tabs and the portal's Followup tab read followup_status, which
  // only a separate "Defaulters Followup" upload ever filled -- so uploading the deck left
  // every officer staring at an empty app with nothing to say why.
  const { syncFollowupFromDeck } = await import('../api/upload.js');
  const db = fakeDb({
    followup_status: [
      // This one is already being worked: the officer's own entries must survive the upload.
      { ref: 'D1', team: 'KONGOWE', full_name: 'OLD NAME', arrears: 900, status: 'Defaulter',
        fu_status: 'AMETOA AHADI', promise_date: TODAY, promise_amt: 250,
        last_comment: 'ataleta kesho', comment_by: 'JUMA G', comment_at: TODAY + 'T06:00:00Z' },
      // And this one has left the deck since the last upload.
      { ref: 'GONE', team: 'KONGOWE', full_name: 'CLEARED C', arrears: 400, status: 'Defaulter',
        fu_status: 'ANALIPA LEO', last_comment: 'analipa' },
    ],
  });
  const deck = [
    { ref: 'D1', team: 'KONGOWE', full_name: 'NEW NAME', contact: '0712000001', status: 'Defaulter',
      ds: '3/6', dc: 3, days_elapsed: 40, other_inst: 40000, arrears: 700 },
    { ref: 'D2', team: 'KONGOWE', full_name: 'FRESH ONE', contact: '0712000002', status: 'Chronic',
      ds: '1/6', dc: 1, days_elapsed: 120, other_inst: 30000, arrears: 1500 },
  ];
  const n = await syncFollowupFromDeck(db, deck);
  assert.equal(n, 2);

  const by = Object.fromEntries(db._dump('followup_status').map(r => [r.ref, r]));
  // Deck figures refresh...
  assert.equal(by.D1.arrears, 700);
  assert.equal(by.D1.full_name, 'NEW NAME');
  assert.equal(by.D1.rejesho, 40000);
  // ...but the officer's own work is never overwritten by an upload.
  assert.equal(by.D1.fu_status, 'AMETOA AHADI');
  assert.equal(by.D1.promise_amt, 250);
  assert.equal(by.D1.last_comment, 'ataleta kesho');
  assert.equal(by.D1.comment_by, 'JUMA G');

  // A customer new to the deck simply appears, with no follow-up state yet.
  assert.equal(by.D2.arrears, 1500);
  assert.equal(by.D2.fu_status, null);

  // One who has left the deck stops looking like a live defaulter (so nobody calls them for
  // a debt they cleared) but keeps their row and their history.
  assert.equal(by.GONE.arrears, null);
  assert.equal(by.GONE.status, null);
  assert.equal(by.GONE.last_comment, 'analipa');

  // And the list the app actually reads now has exactly the two live ones.
  const fu = await portalApi(db, ADMIN, 'followup', {}, NOW);
  assert.deepEqual(fu.rows.map(r => r.ref).sort(), ['D1', 'D2']);
});

test('officer accounts can be deleted outright, taking their call history with them', async () => {
  const db = fakeDb({
    ...tables(),
    call_users: [{ user_id: 'U1', name: 'TEST ACCT', team: 'KONGOWE', phone: '712000111', active: true }],
    call_logs: [{ id: 'l1', user_id: 'U1', call_date: TODAY }, { id: 'l2', user_id: 'U1', call_date: TODAY }],
  });
  // Switching off is right for someone who left; deleting is for accounts that should never
  // have existed -- a test, a typo, a duplicate.
  const r = await portalApi(db, ADMIN, 'deleteOfficerAccount', { userId: 'U1' }, NOW);
  assert.equal(r.deleted, true);
  assert.equal(db._dump('call_users').length, 0);
  // call_logs references call_users, so the logs must go first or the delete just fails.
  assert.equal(db._dump('call_logs').length, 0);

  await assert.rejects(() => portalApi(db, ADMIN, 'deleteOfficerAccount', { userId: 'U1' }, NOW),
    e => e.status === 400 && /no longer exists/.test(e.message));
  await assert.rejects(() => portalApi(db, GMO, 'deleteOfficerAccount', { userId: 'U1' }, NOW),
    e => e.status === 403);
});

test('call agents are the CREATED BY agents on applications, TRACK# 1 only', async () => {
  const t = tables();
  const L = (id, stage, created_by, track, amt) => ({ id, team: 'KONGOWE', stage, created_by,
    track_no: track, requested_amt: amt, full_name: 'C' + id });
  t.loans = [
    L('a', 'unassigned', 'Callagent1', 1, 100000),
    L('b', 'assigned',   'Callagent1', '', 200000),   // blank track counts: old reports had no column
    L('c', 'assigned',   'Callagent2', 1, 300000),
    L('d', 'unassigned', 'Callagent2', 3, 900000),    // repeat customer -- not a new win
    L('e', 'approved',   'Callagent1', 1, 500000),    // past the two stages this board counts
    L('f', 'unassigned', 'Callagent9', 1, 50000),     // on applications but not in the roster
  ];
  t.call_agents = [
    { user_id: 'Callagent1', names: 'Amina Mustafa, Nadhir Msangi' },
    { user_id: 'Callagent2', names: 'Salehe Hamad' },
  ];
  const d = await portalApi(fakeDb(t), ADMIN, 'callAgents', {}, NOW);

  const one = d.rows.find(r => r.id === 'Callagent1');
  assert.equal(one.unassigned, 1);
  assert.equal(one.assigned, 1);
  assert.equal(one.total, 2);
  assert.equal(one.amount, 300000);
  assert.equal(one.names, 'Amina Mustafa, Nadhir Msangi');

  // TRACK# 3 is a repeat customer, so Callagent2 keeps only the assigned one.
  const two = d.rows.find(r => r.id === 'Callagent2');
  assert.equal(two.total, 1);
  assert.equal(two.amount, 300000);

  // An id with no roster entry is still counted and is NAMED as missing, not hidden.
  assert.deepEqual(d.unnamed, ['Callagent9']);
  assert.equal(d.totals.total, 4);

  // The roster is editable without SQL.
  const db = fakeDb(t);
  await portalApi(db, ADMIN, 'saveCallAgent', { userId: 'Callagent9', names: 'Leah Masali' }, NOW);
  assert.equal(db._dump('call_agents').find(a => a.user_id === 'Callagent9').names, 'Leah Masali');
  await portalApi(db, ADMIN, 'saveCallAgent', { userId: 'Callagent9', remove: true }, NOW);
  assert.equal(db._dump('call_agents').some(a => a.user_id === 'Callagent9'), false);
  await assert.rejects(() => portalApi(db, GMO, 'saveCallAgent', { userId: 'X' }, NOW), e => e.status === 403);
});

// A tab has MANY tips -- that is the whole point of rotating them -- so the reader must group
// rather than pick one. This is the read side of the fix that stopped hints being keyed on tab.
test('hints group many tips per tab, and fall back across languages', async () => {
  const db = fakeDb({
    hints: [
      { id: 'h1', tab: 'all', message: 'Upload daily.', sw_message: 'Pakia kila siku.' },
      { id: 'h2', tab: 'ALL', message: 'Check the deck.', sw_message: '' },        // same tab, different case
      { id: 'h3', tab: 'followup', message: '', sw_message: 'Piga simu mapema.' }, // Swahili only
      { id: 'h4', tab: '', message: 'orphan', sw_message: '' },                    // no tab -- dropped
    ],
  });
  const d = await portalApi(db, ADMIN, 'hints', {}, NOW);
  assert.deepEqual(d.tips.en.all, ['Upload daily.', 'Check the deck.']);
  assert.deepEqual(d.tips.sw.all, ['Pakia kila siku.', 'Check the deck.']);   // no Swahili -> English stands in
  assert.deepEqual(d.tips.en.followup, ['Piga simu mapema.']);                // no English -> Swahili stands in
  assert.equal('' in d.tips.en, false);
});

// An Exp.Def screen that is empty for a reason the officer cannot see costs a phone call and
// a day. Each of the four ways it empties out must be distinguishable from the response.
test('expdf says WHY it is empty, and shows the book when the deck has no DISB DATE', async () => {
  // 1. No deck for today's weekday at all.
  const bare = tables();
  bare.teams[0] = { ...bare.teams[0], gmo: 'GMO GEE', manager: 'BOSS', bike: 'BIKE BEE' };
  bare.defaulter_snapshots = [];
  const me = { code: 'X', name: 'BOSS', role: 'MANAGER', teams: null, tabs: [] };
  const none = await portalApi(fakeDb(bare), me, 'expdfMine', {}, NOW);
  assert.equal(none.diag.deck, 0);
  assert.equal(none.rows.length, 0);

  // 2. A deck, assigned, but this leader's own customers are all on another cycle day.
  const db2 = fakeDb(expdfTables());
  for (const r of db2._dump('defaulter_snapshots')) if (r.ref === 'A2') r.disb_date = '2026-07-22';
  const off = await portalApi(db2, me, 'expdfMine', {}, NOW);
  assert.equal(off.rows.length, 0);
  assert.equal(off.diag.deck, 3);            // the deck is there
  assert.equal(off.diag.mine, 1);            // and one of them is this leader's
  assert.equal(off.diag.onToday, 0);         // just not today
  assert.equal(off.diag.noCycleDates, false);

  // 3. No DISB DATE anywhere -> the 2-day cycle is unknowable, so the whole book shows rather
  //    than an empty screen, and the flag says the rotation could not be applied.
  const db3 = fakeDb(expdfTables());
  for (const r of db3._dump('defaulter_snapshots')) r.disb_date = null;
  const blind = await portalApi(db3, me, 'expdfMine', {}, NOW);
  assert.equal(blind.diag.noCycleDates, true);
  assert.equal(blind.diag.dated, 0);
  assert.deepEqual(blind.rows.map(r => r.ref), ['A2']);   // MANAGER's own, shown despite no cycle day
});

/* THE PRESENTATION DECK. Two server calls stand behind it -- the dashboard and these officer
   boards -- and until now the boards half had no test at all, which is a poor state for the
   screen that gets projected in front of the whole company every week.

   They are also the reads that were narrowed hardest: a whole week of snapshots, cut down to
   the handful of columns the sums actually touch. Every figure below is therefore also a check
   that nothing was cut too far -- the fake database returns ONLY the columns asked for, so a
   missing one shows up here as a zero rather than as a blank slide on the wall. */

test('presentation boards: recovery, early collection, credit, calls and follow-up', async () => {
  const b = await run('officerBoards');
  assert.equal(b.weekday, 'FRI');
  assert.equal(b.weekOf, MON);

  // Recovery is initial minus current, per the team's recovery officer.
  // KONGOWE -> JUMA G: (500+700) - (300+600) = 300. MBAGALA has no recovery officer named.
  const juma = b.recWeek.find(r => r.officer === 'JUMA G');
  assert.equal(juma.recovered, 300, 'initial arrears minus current, not a whole-book figure');
  const mbagala = b.recWeek.find(r => r.officer === '(unassigned)');
  assert.equal(mbagala.recovered, 100);                       // 900 - 800
  assert.equal(b.initialCount, 3);
  assert.equal(b.currentCount, 3);
  assert.equal(b.deckWarning, null, 'matched deck sizes raise no warning');

  // Early collection is judged per the team's Expected officer, on payment_expected vs paid.
  const early = b.earlyWeek.find(r => r.officer === 'EARLY E');
  assert.equal(early.expected, 1900);                         // 1000 + 500 + 400 (KONGOWE, Mon-Fri)
  assert.equal(early.collected, 500);                         // the one PAID row
  assert.equal(early.uncollected, 1400);
  assert.equal(early.paidOver, 1);

  // Credit analysts: applications they processed, with an amount attached.
  // Counted on the date they were approved, whatever became of them afterwards -- l3 was
  // disbursed since, and that is still an application this analyst processed this week.
  const analyst = b.creditWeek.find(r => r.analyst === 'ANALYST A');
  assert.equal(analyst.apps, 2);                              // l1 approved Tue, l3 Mon
  assert.equal(analyst.amount, 400000);

  // Call agents.
  const agent = b.callWeek.find(r => r.agent === 'JUMA G');
  assert.equal(agent.calls, 2);
  assert.equal(agent.duration, 70);
  assert.equal(agent.portfolio, 1);

  // Follow-up status across the book. The FK stub (no name, no arrears) is not a defaulter and
  // must not be counted as one -- it would otherwise invent a "NOT TOUCHED" customer.
  assert.equal(b.fuTotal, 2);
  const promised = b.fuStatus.find(s => s.status === 'AMETOA AHADI');
  assert.equal(promised.customers, 1);
  assert.equal(promised.arrears, 600);
});

test('presentation boards never show an officer another team\'s money', async () => {
  const b = await run('officerBoards', {}, GMO);
  const names = JSON.stringify(b);
  assert.ok(!names.includes('999'), 'MBAGALA customer must not reach a KONGOWE officer');
  assert.ok(!names.includes('ANALYST B'), 'nor the analyst who processed their loans');
  assert.equal(b.recWeek.length, 1);
  assert.equal(b.recWeek[0].officer, 'JUMA G');
  assert.equal(b.recWeek[0].recovered, 300);
  assert.equal(b.fuTotal, 1);
});

test('a narrowed snapshot read still lets the newest upload win', async () => {
  /* The boards ask for a short list of columns. upload_batch and created_at are NOT on that
     list -- they are added back by the snapshot reader, because they are what decides which
     upload counts. Leave them out and a corrected re-upload stacks on top of the file it
     replaced instead of replacing it, doubling every figure on the wall. */
  const t = tables();
  for (const r of t.defaulter_snapshots.filter(x => x.snapshot_type === 'current')) {
    t.defaulter_snapshots.push({ ...r, arrears: 0, upload_batch: 'redo', created_at: TODAY + 'T09:00:00Z' });
  }
  const b = await run('officerBoards', {}, ADMIN, fakeDb(t));
  assert.equal(b.currentCount, 3, 'the re-upload replaces the earlier deck, it does not stack');
  // Current arrears are now zero, so the whole 2100 of initial arrears reads as recovered.
  assert.equal(b.recWeek.find(r => r.officer === 'JUMA G').recovered, 1200);
});

test('the presentation is worked out once a minute, per set of teams', async () => {
  const db = fakeDb(tables());
  const first = await portalApi(db, ADMIN, 'officerBoards', {}, NOW);
  // Change the data underneath. A cached answer is meant not to notice for up to a minute.
  db._dump('defaulter_snapshots').length = 0;
  const again = await portalApi(db, ADMIN, 'officerBoards', {}, NOW + 30000);
  assert.equal(again.recWeek.find(r => r.officer === 'JUMA G').recovered, 300, 'same minute, same answer');
  assert.equal(again, first, 'and it was not worked out a second time');

  const later = await portalApi(db, ADMIN, 'officerBoards', {}, NOW + 61000);
  assert.equal(later.initialCount, 0, 'past a minute the figures are worked out afresh');

  // An officer scoped to one team must never be handed the answer computed for everybody.
  const scopedAns = await portalApi(db, GMO, 'officerBoards', {}, NOW + 61000);
  assert.notEqual(scopedAns, later);
  assert.equal(scopedAns.fuTotal, 1);
});


/* CUSTOMER CARE AGENTS ARE NOT THE CALL APP OFFICERS.

   The Presentation deck showed one under the other's name: talk time and connected
   percentages for the field officers, on a slide headed "Call agents". They are two different
   rooms doing two different jobs. Customer care agents bring in applications and nobody
   records their talk time or puts them on a team; the app officers are everybody in the field
   with a phone. Each now has its own board. */

/* CS1/CS2 are CUSTOMER CARE agents -- the people named as CREATED BY on the application
   reports. Kept OUT of the shared fixture: the loan-pipeline tests count what is in there, and
   applications are a different question from the pipeline's stages. */
function csTables() {
  const t = tables();
  t.loans = t.loans.concat([
    { id: 'a1', team: 'KONGOWE', stage: 'unassigned', requested_amt: 400000, track_no: '1', created_by: 'CS1', upload_date: TODAY, full_name: 'A1' },
    { id: 'a2', team: 'KONGOWE', stage: 'assigned', requested_amt: 200000, track_no: '1', created_by: 'CS1', upload_date: MON, full_name: 'A2' },
    // TRACK# 3 is a repeat customer -- nobody won that application.
    { id: 'a3', team: 'KONGOWE', stage: 'unassigned', requested_amt: 900000, track_no: '3', created_by: 'CS1', upload_date: TODAY, full_name: 'A3 repeat' },
    // A blank track counts: the earliest reports had no such column.
    { id: 'a4', team: 'MBAGALA', stage: 'unassigned', requested_amt: 150000, track_no: '', created_by: 'CS2', upload_date: TODAY, full_name: 'A4' },
    { id: 'a5', team: 'KONGOWE', stage: 'unassigned', requested_amt: 500000, track_no: '1', created_by: 'CS1', upload_date: '2026-07-10', full_name: 'A5 last month' },
  ]);
  return t;
}

test('call agents are measured on applications brought in, TRACK# 1 only', async () => {
  const b = await run('officerBoards', {}, ADMIN, fakeDb(csTables()));
  const neema = b.csWeek.find(r => r.id === 'CS1');

  // a1 (unassigned, today) + a2 (assigned, Monday). NOT a3 -- track 3 is a repeat customer,
  // and crediting it would reward the same relationship twice. NOT a5 -- last month.
  assert.equal(neema.brought, 2);
  assert.equal(neema.unassigned, 1);
  assert.equal(neema.assigned, 1);
  assert.equal(neema.amount, 600000);
  assert.equal(neema.agent, 'NEEMA CS', 'the roster supplies the name');

  // A blank track counts -- the earliest reports had no such column.
  const cs2 = b.csWeek.find(r => r.id === 'CS2');
  assert.equal(cs2.brought, 1);
  assert.equal(cs2.agent, 'CS2', 'an id with no roster entry shows as the bare id, not hidden');

  // Nothing about talking on the phone appears on this board at all.
  assert.equal('duration' in neema, false);
  assert.equal('connectPct' in neema, false);
});

test('the call app board counts everybody who should be calling, including the ones who did not', async () => {
  const b = await run('officerBoards');

  const juma = b.callWeek.find(r => r.agent === 'JUMA G');
  assert.equal(juma.calls, 2);
  assert.equal(juma.duration, 70);
  assert.equal(juma.team, 'KONGOWE');

  /* The whole reason this board is worth showing. An officer built only from the call log who
     never opened the app all week does not appear -- and that is the one name a meeting about
     underperformance most needs. */
  const db = fakeDb((function(){
    const t = csTables();
    t.call_users.push({ user_id: 'U2', name: 'SILENT S', team: 'KONGOWE', role: 'OFFICER', is_leader: false });
    t.call_users.push({ user_id: 'U3', name: 'GONE G', team: 'KONGOWE', role: 'OFFICER', active: false });
    return t;
  })());
  const b2 = await run('officerBoards', {}, ADMIN, db);
  const silent = b2.callWeek.find(r => r.agent === 'SILENT S');
  assert.ok(silent, 'an officer who made no calls is on the board');
  assert.equal(silent.calls, 0);
  assert.equal(silent.team, 'KONGOWE');
  assert.equal(b2.callWeek.find(r => r.agent === 'GONE G'), undefined,
    'a switched-off account is not expected to be calling and would only bury the ones who are');

  // The "needs attention" slide is the same rows the other way up -- never a second
  // calculation that could disagree with the first about the same week.
  assert.deepEqual(b2.callWeekWorst, b2.callWeek.slice().reverse());
  assert.equal(b2.callWeekWorst[0].calls, 0);
});

test('both agent boards stay inside the caller\'s teams', async () => {
  const b = await run('officerBoards', {}, GMO, fakeDb(csTables()));
  // CS2's only application is MBAGALA's.
  assert.equal(b.csWeek.find(r => r.id === 'CS2'), undefined);
  assert.equal(b.csWeek.length, 1);
  assert.equal(b.csWeek[0].id, 'CS1');
});

test('the call report puts a silent officer on the list at zero', async () => {
  const t = tables();
  t.call_users.push({ user_id: 'U2', name: 'SILENT S', team: 'KONGOWE', role: 'OFFICER' });
  t.call_users.push({ user_id: 'U9', name: 'OTHER TEAM O', team: 'MBAGALA', role: 'OFFICER' });
  const d = await run('callReport', { from: MON, to: TODAY }, GMO, fakeDb(t));
  const silent = d.users.find(u => u.name === 'SILENT S');
  assert.ok(silent, 'the officer who never opened the app is on the report');
  assert.equal(silent.calls, 0);
  assert.equal(silent.duration, 0);
  assert.equal(silent.days, 0);
  // Still scoped: a KONGOWE leader does not learn about MBAGALA's quiet officers.
  assert.equal(d.users.find(u => u.name === 'OTHER TEAM O'), undefined);
});


/* PMO COLLECTION — the collection officers, paid on the ONE thing they control.
 *
 * They are ACCESS CODES with a role, each carrying their own list of teams: one officer holds
 * thirty-odd, which is a list on the person rather than their name repeated in thirty-odd rows
 * of the teams table.
 *
 * These tests are about money, so the arithmetic is spelled out rather than asserted against
 * whatever the code happens to produce. */

const PMO_A = { code: 'P1', name: 'KAMARIA', role: 'PMO COLLECTION', teams: ['KONGOWE'] };
const PMO_B = { code: 'P2', name: 'CATHERINE', role: 'PMO COLLECTION', teams: ['MBAGALA'] };

/** An Expected-today row for a given team and date: expected 1000, and `paid` says whether it
    came in. Two rows a day per team keeps the percentages easy to check by hand. */
const X = (team, date, status, exp = 1000, arrears = 0) => ({
  ref: team + date + status + Math.random(), team, payment_expected: exp, arrears,
  todays_status: status, snapshot_type: 'today', snapshot_date: date,
  upload_batch: 'x' + date, created_at: date + 'T04:00:00Z',
});

function pmoTables(rows) {
  const t = tables();
  t.access_codes = t.access_codes.concat([PMO_A, PMO_B]);
  t.repayment_snapshots = rows;
  return t;
}

test('a PMO officer is scored on the percentage collected, not the size of the book', async () => {
  /* KAMARIA: 9 of 10 paid = 90%.  CATHERINE: 1 of 2 paid = 50%, on a fifth of the customers.
     The plan's whole point is that the small book does not flatter anybody. */
  const rows = [];
  for (let i = 0; i < 9; i++) rows.push(X('KONGOWE', TODAY, 'PAID'));
  rows.push(X('KONGOWE', TODAY, 'UNPAID'));
  rows.push(X('MBAGALA', TODAY, 'PAID'));
  rows.push(X('MBAGALA', TODAY, 'UNPAID'));

  const b = await run('officerBoards', {}, ADMIN, fakeDb(pmoTables(rows)));
  assert.equal(b.pmo.length, 2);

  const k = b.pmo.find(r => r.officer === 'KAMARIA');
  assert.equal(k.sn, 1, 'best first, numbered for the slide');
  assert.equal(k.teams, 1);
  assert.equal(k.pct, 90);
  assert.equal(k.uncollected, 1000);

  const c = b.pmo.find(r => r.officer === 'CATHERINE');
  assert.equal(c.pct, 50);
  assert.equal(c.uncollected, 1000, 'the same shillings uncollected, a very different percentage');

  /* NO MONEY ON THE PRESENTATION. Not "not displayed" -- not present in the answer at all, so a
     future slide cannot include it by reaching for a field that happened to be there. */
  for (const key of ['commission', 'weekCommission', 'bonus', 'band', 'expected', 'collected']) {
    assert.equal(key in k, false, key + ' must not travel to the presentation');
  }
  assert.deepEqual(Object.keys(k).sort(),
    ['officer', 'pct', 'sn', 'teams', 'uncollected', 'weekPct', 'weekUncollected'].sort());
});

test('the five bands pay what the plan says they pay', async () => {
  const { pmoBand, PMO_BANDS } = await import('../api/_lib/pmo.js');
  const rate = p => { const b = pmoBand(p); return b ? b.tzs : null; };

  assert.equal(rate(85), 20000);   assert.equal(rate(89), 20000);
  assert.equal(rate(90), 25000);   assert.equal(rate(92), 25000);
  assert.equal(rate(93), 30000);   assert.equal(rate(94), 30000);
  assert.equal(rate(95), 40000);   assert.equal(rate(96), 40000);
  assert.equal(rate(97), 60000);   assert.equal(rate(100), 60000);
  assert.equal(rate(84.9), 0, 'below 85 pays nothing, which is intended');
  assert.equal(rate(0), 0);

  /* The plan lists whole numbers with GAPS -- 89 to 90, 92 to 93 -- so 89.4 belongs to no band
     as written. It pays the band below rather than nothing, because nobody intended a
     percentage that pays zero while a lower one pays 20,000. */
  assert.equal(rate(89.4), 20000);
  assert.equal(rate(92.7), 25000);
  assert.equal(rate(96.5), 40000);

  // A day with nothing expected is not a 0% day. It is a day with no percentage at all.
  assert.equal(pmoBand(null), null);

  // A week of steady 90–92% pays 5 × 25,000 = 125,000, exactly as the plan's table says.
  assert.equal(PMO_BANDS.find(b => b.floor === 90).tzs * 5, 125000);
});

test('the week is each day on its own band, added up', async () => {
  /* Mon 100% (60,000) · Tue 50% (nothing) · Wed 100% (60,000). Two rows a day, so the
     percentages are exact. A week scored as ONE percentage would be 5 of 6 = 83.3% and pay
     nothing at all -- which is why the choice matters and why it is tested. */
  const rows = [
    X('KONGOWE', MON, 'PAID'), X('KONGOWE', MON, 'PAID'),
    X('KONGOWE', '2026-07-21', 'PAID'), X('KONGOWE', '2026-07-21', 'UNPAID'),
    X('KONGOWE', '2026-07-22', 'PAID'), X('KONGOWE', '2026-07-22', 'PAID'),
  ];
  const d = await run('commission', {}, ADMIN, fakeDb(pmoTables(rows)));
  const k = d.pmo.find(r => r.officer === 'KAMARIA');

  assert.equal(k.weekCommission, 120000, 'two good days at 60,000; the 50% day pays nothing');
  assert.equal(k.weekPct, 83.3, 'and the week itself is still reported honestly');
  assert.equal(k.weekUncollected, 1000);
});

test('the weekly bonus is checked, not assumed', async () => {
  const thisWeek = [
    X('KONGOWE', MON, 'PAID'), X('KONGOWE', MON, 'PAID'),     // KAMARIA 100%
    X('MBAGALA', MON, 'PAID'), X('MBAGALA', MON, 'UNPAID'),   // CATHERINE 50%
  ];
  // Last week KAMARIA also managed 100% — so she leads, but has not BEATEN herself.
  const lastWeek = [
    X('KONGOWE', '2026-07-13', 'PAID'), X('KONGOWE', '2026-07-13', 'PAID'),
  ];
  const t = pmoTables(thisWeek.concat(lastWeek));
  t.settings = t.settings.concat([{ key: 'PMO_WEEKLY_BONUS', value: '50000' }]);

  const d = await run('commission', {}, ADMIN, fakeDb(t));
  assert.equal(d.pmoBonus.set, true);
  assert.equal(d.pmoBonus.leader, 'KAMARIA');
  assert.equal(d.pmoBonus.won, false, 'leading is not enough — she has to beat her own last week');
  assert.match(d.pmoBonus.why, /previous week/);
  assert.equal(d.pmo.find(r => r.officer === 'KAMARIA').bonus, 0);

  /* Now last week was worse, so leading IS beating herself. */
  const t2 = pmoTables(thisWeek.concat([
    X('KONGOWE', '2026-07-13', 'PAID'), X('KONGOWE', '2026-07-13', 'UNPAID'),   // 50% last week
  ]));
  t2.settings = t2.settings.concat([{ key: 'PMO_WEEKLY_BONUS', value: '50000' }]);
  const d2 = await run('commission', {}, ADMIN, fakeDb(t2));
  assert.equal(d2.pmoBonus.won, true);
  assert.equal(d2.pmoBonus.leaderPrevPct, 50);
  assert.equal(d2.pmo.find(r => r.officer === 'KAMARIA').bonus, 50000);
  assert.equal(d2.pmo.find(r => r.officer === 'CATHERINE').bonus, 0, 'only the leader');
});

test('an amount nobody has set pays nothing and says so', async () => {
  const rows = [X('KONGOWE', MON, 'PAID'), X('KONGOWE', MON, 'PAID')];
  const d = await run('commission', {}, ADMIN, fakeDb(pmoTables(rows)));
  assert.equal(d.pmoBonus.set, false);
  assert.equal(d.pmoBonus.tzs, 0);
  assert.equal(d.pmo.find(r => r.officer === 'KAMARIA').bonus, 0,
    'the rule is in place; the figure is the owner\'s to choose, not one to invent');
});

test('a PMO officer sees their own money and nobody else\'s', async () => {
  const rows = [X('KONGOWE', TODAY, 'PAID'), X('MBAGALA', TODAY, 'PAID')];
  const me = { code: 'P1', name: 'KAMARIA', role: 'PMO COLLECTION', teams: ['KONGOWE'], tabs: ['commission'] };
  const d = await run('commission', {}, me, fakeDb(pmoTables(rows)));
  assert.equal(d.pmo.length, 1);
  assert.equal(d.pmo[0].officer, 'KAMARIA');
});

test('somebody who sees every team is not a collection officer with a portfolio', async () => {
  /* A blank team list means ALL teams. Putting that person on this board would make their
     percentage the company's percentage and quietly outrank everybody. */
  const t = pmoTables([X('KONGOWE', TODAY, 'PAID')]);
  t.access_codes = t.access_codes.concat([
    { code: 'P9', name: 'EVERYWHERE E', role: 'PMO COLLECTION', teams: null }]);
  const b = await run('officerBoards', {}, ADMIN, fakeDb(t));
  assert.equal(b.pmo.find(r => r.officer === 'EVERYWHERE E'), undefined);
});

test('the role name is a setting, so a spelling is fixable without a deploy', async () => {
  const t = pmoTables([X('KONGOWE', TODAY, 'PAID')]);
  t.access_codes = t.access_codes.map(c =>
    c.code === 'P1' ? { ...c, role: 'pmo-collection' } : c);
  // Written differently, meant identically: case and punctuation are not the point.
  const b = await run('officerBoards', {}, ADMIN, fakeDb(t));
  assert.ok(b.pmo.find(r => r.officer === 'KAMARIA'), 'PMO-COLLECTION is PMO COLLECTION');

  const t2 = pmoTables([X('KONGOWE', TODAY, 'PAID')]);
  t2.access_codes = t2.access_codes.map(c => c.code === 'P1' ? { ...c, role: 'COLLECTIONS' } : c);
  t2.settings = t2.settings.concat([{ key: 'PMO_ROLE', value: 'COLLECTIONS' }]);
  const b2 = await run('officerBoards', {}, ADMIN, fakeDb(t2));
  assert.ok(b2.pmo.find(r => r.officer === 'KAMARIA'), 'and the name itself can be changed');
});


/* RECOVERY IS DIVIDED BY THE UNCOLLECTED THE OFFICER IS ACTUALLY CHASING.
 *
 * Which day's uncollected that is depends on the day of the week -- the rule the dashboard's
 * Recovery % has always used (recovery.js):
 *
 *     Monday      today's uncollected      (no yesterday exists inside a HOPE week)
 *     Tue–Fri     yesterday's uncollected
 *     Sat/Sun     the whole week's         (the weekend reconciles Monday to Friday)
 *
 * The officer boards were not following it. They added up every Expected row of the whole week
 * -- every day, and every RE-UPLOAD of every day -- and used that on both the daily and the
 * weekly board. A team whose Tuesday file went in twice had its recovery percentage quietly
 * halved, and Monday was divided by a week that had barely started.
 */

test('recovery divides by yesterday\'s uncollected on a Tuesday-to-Friday', async () => {
  // NOW is Friday 2026-07-24, so the basis is Thursday the 23rd.
  const t = tables();
  t.repayment_snapshots = [
    E('111', 'KONGOWE', 1000, 'UNPAID', 0, YEST),          // Thursday: 1000 uncollected
    E('222', 'KONGOWE', 500, 'PAID', 0, YEST),             //           nothing uncollected
    E('333', 'KONGOWE', 9000, 'UNPAID', 0, TODAY),         // Friday's own -- NOT the basis
    E('444', 'KONGOWE', 7000, 'UNPAID', 0, MON),           // Monday's -- NOT the basis either
  ];
  const b = await run('officerBoards', {}, ADMIN, fakeDb(t));
  const juma = b.recWeek.find(r => r.officer === 'JUMA G');
  assert.equal(juma.uncollected, 17000,
    'the WEEKLY board always divides by the whole week: 7000 Mon + 1000 Thu + 9000 Fri');

  const jumaToday = b.recToday.find(r => r.officer === 'JUMA G');
  assert.equal(jumaToday.uncollected, 1000,
    'but the DAILY board divides by yesterday alone — not the week, and not today');
  assert.equal(b.pmoBasis, 'yesterday');
});

test('a report uploaded twice no longer halves the recovery percentage', async () => {
  /* THE DEFECT THIS FIXES. Two uploads of the same Thursday: the later batch is the real one,
     and the earlier must not be added to it. Before, both counted, so the denominator doubled
     and every officer's recovery percentage read half what it was. */
  const t = tables();
  const first = { ...E('111', 'KONGOWE', 1000, 'UNPAID', 0, YEST), upload_batch: 'b1', created_at: YEST + 'T04:00:00Z' };
  const redo = { ...E('111', 'KONGOWE', 1000, 'UNPAID', 0, YEST), upload_batch: 'b2', created_at: YEST + 'T09:00:00Z' };
  t.repayment_snapshots = [first, redo];
  const b = await run('officerBoards', {}, ADMIN, fakeDb(t));
  assert.equal(b.recToday.find(r => r.officer === 'JUMA G').uncollected, 1000,
    'one thousand, not two — the re-upload replaces the file, it does not stack on it');
});

test('on a Monday recovery divides by Monday, and on the weekend by the week', async () => {
  const t = tables();
  t.repayment_snapshots = [
    E('111', 'KONGOWE', 1000, 'UNPAID', 0, MON),
    E('222', 'KONGOWE', 400, 'UNPAID', 0, '2026-07-21'),      // Tuesday
    E('333', 'KONGOWE', 600, 'UNPAID', 0, '2026-07-22'),      // Wednesday
  ];
  // Monday 2026-07-20, noon EAT.
  const monday = await portalApi(fakeDb(t), ADMIN, 'officerBoards', {}, Date.parse('2026-07-20T09:00:00Z'));
  assert.equal(monday.pmoBasis, 'today');
  assert.equal(monday.recToday.find(r => r.officer === 'JUMA G').uncollected, 1000,
    'Monday has no yesterday inside a HOPE week, so it divides by itself');

  // Saturday 2026-07-25.
  const sat = await portalApi(fakeDb(t), ADMIN, 'officerBoards', {}, Date.parse('2026-07-25T09:00:00Z'));
  assert.equal(sat.pmoBasis, 'week');
  assert.equal(sat.recToday.find(r => r.officer === 'JUMA G').uncollected, 2000,
    'the weekend reconciles Monday to Friday: 1000 + 400 + 600');
  assert.equal(sat.recWeek.find(r => r.officer === 'JUMA G').uncollected, 2000);
});


/* EARLY COLLECTION IS WORKED FROM THE LIST OF WHO IS DUE NEXT.
 *
 * That used to mean the "Expected Tomorrow" report and nothing else -- and that report is not
 * uploaded here. The essential Expected reports in this operation are INITIAL and the day's
 * own, and it is INITIAL that early collection is worked from. So the board was silently
 * empty: no error, no note, just an officer board with nobody on it.
 */

test('early collection reads the INITIAL list, and says which list it read', async () => {
  const t = tables();
  t.repayment_snapshots = [
    // The initial list: who is due next. One paid early, one not.
    { ...E('111', 'KONGOWE', 1000, 'PAID', 0, TODAY, 'initial') },
    { ...E('222', 'KONGOWE', 1000, 'UNPAID', 0, TODAY, 'initial') },
  ];
  const b = await run('officerBoards', {}, ADMIN, fakeDb(t));
  assert.equal(b.earlySource, 'initial');
  const e = b.earlyToday.find(r => r.officer === 'EARLY E');
  assert.ok(e, 'the board is no longer empty');
  assert.equal(e.pct, 50);
  assert.equal(e.uncollected, 1000);
  assert.equal(e.teams, 1);
  assert.equal(e.sn, 1);
});

test('a company that uploads Tomorrow instead still gets its board', async () => {
  const t = tables();
  t.repayment_snapshots = [
    { ...E('444', 'KONGOWE', 700, 'PAID', 0, TODAY, 'tomorrow') },
    { ...E('555', 'KONGOWE', 300, 'UNPAID', 0, TODAY, 'tomorrow') },
  ];
  const b = await run('officerBoards', {}, ADMIN, fakeDb(t));
  assert.equal(b.earlySource, 'tomorrow', 'the fallback, so neither convention has to be explained');
  assert.equal(b.earlyToday.find(r => r.officer === 'EARLY E').pct, 70);
});

test('initial wins when both are uploaded, and neither means an empty board that says so', async () => {
  const t = tables();
  t.repayment_snapshots = [
    { ...E('111', 'KONGOWE', 1000, 'PAID', 0, TODAY, 'initial') },
    { ...E('444', 'KONGOWE', 1000, 'UNPAID', 0, TODAY, 'tomorrow') },
  ];
  const both = await run('officerBoards', {}, ADMIN, fakeDb(t));
  assert.equal(both.earlySource, 'initial');
  assert.equal(both.earlyToday.find(r => r.officer === 'EARLY E').pct, 100);

  const t2 = tables();
  t2.repayment_snapshots = [E('333', 'KONGOWE', 500, 'PAID', 0, TODAY)];   // only the day's own
  const none = await run('officerBoards', {}, ADMIN, fakeDb(t2));
  assert.equal(none.earlySource, null, 'no list uploaded is reported, not disguised as zero');
  assert.deepEqual(none.earlyToday, []);
});

test('the dashboard reads the same list as the officer board', async () => {
  /* Two screens showing "early collection" from two different reports is how a meeting spends
     twenty minutes on a discrepancy that is not real. */
  const t = tables();
  t.repayment_snapshots = [
    { ...E('111', 'KONGOWE', 1000, 'PAID', 0, TODAY, 'initial') },
    { ...E('222', 'KONGOWE', 1000, 'UNPAID', 0, TODAY, 'initial') },
  ];
  const db = fakeDb(t);
  const dash = await run('dashboardFull', {}, ADMIN, db);
  const kongowe = dash.teamPerf.find(r => r.team === 'KONGOWE');
  assert.equal(kongowe.collPctEarly, 50, 'the same 50% the officer board reports');
});


/* TEAM PERFORMANCE, ranked on what the company is actually judged on. */

test('teams are ranked on the average of sales and collection, best first', async () => {
  const t = tables();
  t.settings = t.settings.concat([{ key: 'SALES_TARGET_WEEKLY', value: '1000' }]);
  t.loans = [
    // Monthly sales: KONGOWE 400, MBAGALA 100. Monthly target = weekly x 4 = 4,000.
    { id: 'm1', team: 'KONGOWE', stage: 'approved', principal_amt: 400, approved_date: TODAY },
    { id: 'm2', team: 'MBAGALA', stage: 'approved', principal_amt: 100, approved_date: TODAY },
    // Last month is NOT this month's sales.
    { id: 'm3', team: 'MBAGALA', stage: 'approved', principal_amt: 9999, approved_date: '2026-06-15' },
  ];
  t.repayment_snapshots = [
    E('111', 'KONGOWE', 1000, 'UNPAID', 0),          // 0% collected today
    E('333', 'MBAGALA', 1000, 'PAID', 0),            // 100% collected today
  ];
  const d = await run('dashboardFull', {}, ADMIN, fakeDb(t));
  const k = d.teamPerf.find(r => r.team === 'KONGOWE');
  const m = d.teamPerf.find(r => r.team === 'MBAGALA');

  assert.equal(k.salesMonth, 400);
  assert.equal(m.salesMonth, 100, 'last month is a different month');

  // KONGOWE: sales 10% of 4,000, collection 0%  -> score 5
  // MBAGALA: sales  2.5%,          collection 100% -> score 51.3
  assert.equal(k.salesPct, 10);
  assert.equal(k.collPct, 0);
  assert.equal(m.collPct, 100);
  assert.ok(m.score > k.score, 'collecting everything beats selling a little');
  assert.equal(d.teamPerf[0].team, 'MBAGALA', 'best first');
  assert.equal(d.teamPerf[0].sn, 1, 'and numbered after ranking, not before');
});

test('recovery % is shown against all three denominators', async () => {
  const t = tables();
  t.repayment_snapshots = [
    E('111', 'KONGOWE', 1000, 'UNPAID', 0, MON),                  // Monday: 1000 uncollected
    E('222', 'KONGOWE', 400, 'UNPAID', 0, YEST),                  // yesterday: 400
    E('333', 'KONGOWE', 600, 'UNPAID', 0, TODAY),                 // today: 600
  ];
  // Recovered today = initial 500+700 minus current 300+600 = 300 (from the shared fixture).
  const d = await run('dashboardFull', {}, ADMIN, fakeDb(t));
  const k = d.teamPerf.find(r => r.team === 'KONGOWE');
  assert.equal(k.uncolMon, 1000);
  assert.equal(k.uncolYest, 400);
  assert.equal(k.uncolWeek, 2000, 'Monday + yesterday + today');
  assert.equal(k.recovered, 300);
  assert.equal(k.recPctMon, 30);
  assert.equal(k.recPctYest, 75);
  assert.equal(k.recPctWeek, 15);
});

test('the collection column means today on a weekday and the week at the weekend', async () => {
  const t = tables();
  t.repayment_snapshots = [
    E('111', 'KONGOWE', 1000, 'PAID', 0, MON),        // Monday collected in full
    E('222', 'KONGOWE', 1000, 'UNPAID', 0, TODAY),    // Friday collected nothing
  ];
  const fri = await run('dashboardFull', {}, ADMIN, fakeDb(t));
  const kf = fri.teamPerf.find(r => r.team === 'KONGOWE');
  assert.equal(kf.basis, 'today');
  assert.equal(kf.collPct, 0, 'Friday alone');
  assert.equal(kf.uncollected, 1000);
  // The parts the grand total is worked out from travel with it.
  assert.equal(kf.colBasis, 0);
  assert.equal(kf.expBasis, 1000);

  const sat = await portalApi(fakeDb(t), ADMIN, 'dashboardFull', {}, Date.parse('2026-07-25T09:00:00Z'));
  const ks = sat.teamPerf.find(r => r.team === 'KONGOWE');
  assert.equal(ks.basis, 'week');
  assert.equal(ks.collPct, 50, 'the whole week: 1000 of 2000');
  assert.equal(ks.uncollected, 1000);
  assert.equal(ks.colBasis, 1000);
  assert.equal(ks.expBasis, 2000);
});
