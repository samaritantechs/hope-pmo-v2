// The portal backend: every tab's function against the mutation-capable fake PostgREST,
// with team scoping checked on the tabs where getting it wrong would leak another team's
// customers. Clock pinned to Friday 2026-07-24 noon EAT.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi, PORTAL_FUNCTIONS, assignFor } = await import('../api/_lib/portal-core.js');

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
