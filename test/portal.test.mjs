// The portal backend: every tab's function against the mutation-capable fake PostgREST,
// with team scoping checked on the tabs where getting it wrong would leak another team's
// customers. Clock pinned to Friday 2026-07-24 noon EAT.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';
/* The two aggregates from db/migrations/2026-08-10-upload-status.sql. They replaced four
   unbounded whole-table reads on the upload page; `db()` below is a database that HAS them,
   and a plain fakeDb(tables()) is one that does not -- both states are exercised. */
import { UPLOAD_STATUS_RPC } from './snapshot-totals-rpc.mjs';
const dbWithRpc = t => fakeDb(t || tables(), { rpc: UPLOAD_STATUS_RPC });

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi, PORTAL_FUNCTIONS, assignFor } = await import('../api/_lib/portal-core.js');
// The announcement is READ without an access code -- it has to reach the sign-in screen -- so
// it lives on the calls door beside the brand. Both sides are checked here, together, because
// what one writes the other must be willing to show.
const { callApi } = await import('../api/_lib/call-core.js');

const { todayKey: todayKeyOf } = await import('../api/_lib/time.js');
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
  /* A real deck carries the guarantor -- they are who an officer rings when the customer will
     not answer. The fixture did not, which is why no test noticed the Count 1-6 list had been
     built without them. */
  guarantor_name: 'G' + ref, guarantor_contact: '07150000' + ref,
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
const run = (fn, args, user = ADMIN, db = dbWithRpc()) => portalApi(db, user, fn, args, NOW);

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

/* "Manager bike and gm should see their own list at expdef so as to work on their report too."
   The tab has to tell the screen WHO is looking and whether the rotation gives them a list of
   their own -- without that it can only ever show everybody's book. */
test('expected defaulters names the viewer, and says whether the rotation gives them a list', async () => {
  // KONGOWE's manager. Holding a gmo/manager/bike column ANYWHERE is what counts.
  const boss = { code: 'B', name: 'BOSS', role: 'GMO', teams: ['KONGOWE'], tabs: [] };
  const d = await portalApi(fakeDb(tables()), boss, 'expectedDefaulters', {}, NOW);
  assert.equal(d.me, 'BOSS');
  assert.equal(d.iAmLeader, true);
  // ...and their own customers are actually reachable in what comes back, which is what the
  // screen narrows on. Anything else and the toggle would open on an empty list.
  assert.ok(d.rows.some(r => String(r.leader).toUpperCase() === 'BOSS'));
});

test('a recovery officer is not a recycling leader -- the rotation is gmo/manager/bike only', async () => {
  // JUMA G is KONGOWE's RECOVERY officer and nobody's gmo, manager or bike.
  const d = await portalApi(fakeDb(tables()), GMO, 'expectedDefaulters', {}, NOW);
  assert.equal(d.me, 'JUMA G');
  assert.equal(d.iAmLeader, false);
  // The whole scoped book still comes back untouched -- narrowing is the screen's job, and it
  // only narrows for somebody the rotation actually named.
  assert.equal(d.count, d.rows.length);
});

test('the admin sees everything: named, but never narrowed to a list of their own', async () => {
  const d = await run('expectedDefaulters');
  assert.equal(d.me, 'THE ADMIN');
  assert.equal(d.iAmLeader, false);
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
  const db = dbWithRpc();
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
  /* Ids are prefixed by stream so a complaint, a comment and a promise can never collide on
     the same key. Filtered to the two streams this test is about -- the fixture also carries a
     promise that came due yesterday, which the bell now shows and which has its own tests. */
  const twoStreams = mine.items.filter(i => i.kind === 'complaint' || i.kind === 'comment');
  assert.deepEqual(twoStreams.map(i => i.id), ['cp1', 'ff1']);
  assert.equal(mine.items.every(i => i.team === 'KONGOWE'), true);
  assert.equal(JSON.stringify(mine).includes('nje ya timu'), false, "another team's complaint leaked");

  // Newest first -- the complaint at 09:00 above the comment at 08:00.
  assert.equal(twoStreams[0].kind, 'complaint');
  assert.equal(twoStreams[1].kind, 'comment');

  // Everything is unseen until somebody says otherwise -- the two here plus the fixture's
  // promise, which came due yesterday and is now on the bell too.
  assert.equal(mine.unseen, mine.items.length);
  assert.equal(twoStreams.filter(i => i.unseen).length, 2);

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
    // LAST MONDAY'S deck, which is what this upload is compared against. Without a previous
    // deck for the weekday there is nothing to have left, and nobody may be blanked.
    defaulter_snapshots: [
      { ref: 'D1', team: 'KONGOWE', snapshot_type: 'current', weekday: 'MON',
        snapshot_date: '2026-07-17', upload_batch: 'old', created_at: '2026-07-17T04:00:00Z' },
      { ref: 'GONE', team: 'KONGOWE', snapshot_type: 'current', weekday: 'MON',
        snapshot_date: '2026-07-17', upload_batch: 'old', created_at: '2026-07-17T04:00:00Z' },
    ],
  });
  const deck = [
    { ref: 'D1', team: 'KONGOWE', full_name: 'NEW NAME', contact: '0712000001', status: 'Defaulter',
      ds: '3/6', dc: 3, days_elapsed: 40, other_inst: 40000, arrears: 700 },
    { ref: 'D2', team: 'KONGOWE', full_name: 'FRESH ONE', contact: '0712000002', status: 'Chronic',
      ds: '1/6', dc: 1, days_elapsed: 120, other_inst: 30000, arrears: 1500 },
  ];
  const n = await syncFollowupFromDeck(db, deck, 'MON', 'new');
  assert.equal(n.synced, 2);
  assert.equal(n.retired, 1, 'GONE left the deck');
  assert.equal(n.staleCapped, 0);

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
     future slide cannot include it by reaching for a field that happened to be there.
     The five DAILY RATES are on that list: pay follows each day's own band, so tzsJ3..tzsIJ are
     shillings and belong on the commission panel with the rest of the money. */
  for (const key of ['commission', 'weekCommission', 'bonus', 'band', 'expected', 'collected',
                     'tzsJ3', 'tzsJ4', 'tzsJ5', 'tzsAL', 'tzsIJ', 'weekDays']) {
    assert.equal(key in k, false, key + ' must not travel to the presentation');
  }
  /* THE FIVE DAILY PERCENTAGES DO travel, because the daily figure is what pay is worked out
     from -- the week's own percentage is the one number the officers are NOT paid on, and it
     was the only one the room could see. */
  for (const key of ['pctJ3', 'pctJ4', 'pctJ5', 'pctAL', 'pctIJ']) {
    assert.equal(key in k, true, key + ' must reach the slide');
  }
  assert.deepEqual(Object.keys(k).sort(),
    ['officer', 'pct', 'sn', 'teams', 'uncollected', 'weekPct', 'weekUncollected',
     'pctJ3', 'pctJ4', 'pctJ5', 'pctAL', 'pctIJ'].sort());
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


test('a Monday deck says nothing about Thursday\'s defaulters', async () => {
  /* THE DEFECT THIS FIXES. The decks are per WEEKDAY, and the sync blanked every customer who
     was not in the file just uploaded -- so loading Monday's current deck cleared the status
     and arrears of everybody whose follow-up day is Tuesday through Sunday, and Tuesday's
     upload then cleared Monday's back again.

     The Defaulters list on every phone showed roughly a seventh of the book, and which seventh
     depended on whichever deck had been loaded last. */
  const { syncFollowupFromDeck } = await import('../api/upload.js');
  const db = fakeDb({
    followup_status: [
      { ref: 'MON1', team: 'KONGOWE', arrears: 900, status: 'Defaulter' },
      { ref: 'THU1', team: 'KONGOWE', arrears: 700, status: 'Defaulter' },
      { ref: 'MONGONE', team: 'KONGOWE', arrears: 400, status: 'Defaulter' },
    ],
    defaulter_snapshots: [
      // Monday's previous deck had MON1 and MONGONE.
      { ref: 'MON1', snapshot_type: 'current', weekday: 'MON', snapshot_date: '2026-07-17', upload_batch: 'oldmon', created_at: '2026-07-17T04:00:00Z' },
      { ref: 'MONGONE', snapshot_type: 'current', weekday: 'MON', snapshot_date: '2026-07-17', upload_batch: 'oldmon', created_at: '2026-07-17T04:00:00Z' },
      // Thursday's deck is a different set of people entirely.
      { ref: 'THU1', snapshot_type: 'current', weekday: 'THU', snapshot_date: '2026-07-20', upload_batch: 'oldthu', created_at: '2026-07-20T04:00:00Z' },
    ],
  });

  // Today's Monday deck: MON1 is still there, MONGONE has cleared.
  await syncFollowupFromDeck(db, [{ ref: 'MON1', team: 'KONGOWE', status: 'Defaulter', arrears: 800 }], 'MON', 'newmon');

  const by = Object.fromEntries(db._dump('followup_status').map(r => [r.ref, r]));
  assert.equal(by.MON1.arrears, 800, 'still on Monday\'s deck, figures refreshed');
  assert.equal(by.MONGONE.arrears, null, 'left Monday\'s deck, so no longer a live defaulter');
  assert.equal(by.MONGONE.status, null);
  // THE LINE THAT MATTERS.
  assert.equal(by.THU1.arrears, 700, 'Thursday\'s defaulter is untouched by a Monday upload');
  assert.equal(by.THU1.status, 'Defaulter');
});

test('the very first deck for a weekday blanks nobody', async () => {
  /* "No previous deck" must mean "blank nobody", never "blank everybody" -- otherwise the
     first upload after a new weekday is introduced empties the entire working list. */
  const { syncFollowupFromDeck } = await import('../api/upload.js');
  const db = fakeDb({
    followup_status: [{ ref: 'X1', team: 'KONGOWE', arrears: 500, status: 'Defaulter' }],
    defaulter_snapshots: [],
  });
  await syncFollowupFromDeck(db, [{ ref: 'X2', team: 'KONGOWE', status: 'Defaulter', arrears: 100 }], 'SAT', 'first');
  const by = Object.fromEntries(db._dump('followup_status').map(r => [r.ref, r]));
  assert.equal(by.X1.arrears, 500, 'untouched — there was no Saturday deck to have left');
  assert.equal(by.X2.arrears, 100);
});


/* THE CUSTOMER WHO WOULD NOT LEAVE.
 *
 * Reported from the field: somebody showing on Kesho with D.S 9-10 AND on Def with D.S 8-9,
 * when they are not in the current defaulter file at all. The Def row is an old deck that
 * nothing came along to clear.
 *
 * The per-weekday rule only retires somebody whose OWN weekday deck came round and left them
 * out. If that weekday's deck simply stops being uploaded, they sit on the officers' list for
 * ever -- being telephoned about a debt that may be settled.
 */

const FU_SYNC = async () => (await import('../api/upload.js')).syncFollowupFromDeck;

test('a customer no deck has confirmed for a fortnight is retired', async () => {
  const syncFollowupFromDeck = await FU_SYNC();
  const db = fakeDb({
    followup_status: [
      // Confirmed three weeks ago and never since -- this is the one in the report.
      { ref: 'OLD1', team: 'KONGOWE', arrears: 12001, status: 'Partial Defaulter',
        ds: '8-9', deck_date: '2026-07-03' },
      // Confirmed last week: still current, must stay.
      { ref: 'RECENT', team: 'KONGOWE', arrears: 5000, status: 'Defaulter',
        ds: '3-6', deck_date: '2026-07-20' },
    ],
    defaulter_snapshots: [],
  });
  await syncFollowupFromDeck(db,
    [{ ref: 'TODAY1', team: 'KONGOWE', status: 'Defaulter', arrears: 900 }],
    'FRI', 'newbatch', '2026-07-24');

  const by = Object.fromEntries(db._dump('followup_status').map(r => [r.ref, r]));
  assert.equal(by.OLD1.arrears, null, 'three weeks with no deck confirming them: retired');
  assert.equal(by.OLD1.status, null);
  assert.equal(by.OLD1.deck_date, null);
  assert.equal(by.RECENT.arrears, 5000, 'four days ago is still current');
  assert.equal(by.TODAY1.arrears, 900);
  assert.equal(by.TODAY1.deck_date, '2026-07-24', 'and today\'s deck stamps its own date');
});

test('a row that was never stamped is left alone', async () => {
  /* Rows predating the column, and the placeholders created so an Expected customer's comment
     has somewhere to live, have no stamp. Retiring those on the strength of a stamp they never
     had would empty the working list on the first upload after the deploy. */
  const syncFollowupFromDeck = await FU_SYNC();
  const db = fakeDb({
    followup_status: [
      { ref: 'LEGACY', team: 'KONGOWE', arrears: 7000, status: 'Defaulter' },   // no deck_date
    ],
    defaulter_snapshots: [],
  });
  await syncFollowupFromDeck(db, [{ ref: 'X', team: 'KONGOWE', status: 'Defaulter', arrears: 1 }],
    'FRI', 'b', '2026-07-24');
  const by = Object.fromEntries(db._dump('followup_status').map(r => [r.ref, r]));
  assert.equal(by.LEGACY.arrears, 7000, 'never stamped is not the same as long overdue');
});

test('somebody in today\'s deck is never retired, however old their stamp', async () => {
  const syncFollowupFromDeck = await FU_SYNC();
  const db = fakeDb({
    followup_status: [
      { ref: 'BACK', team: 'KONGOWE', arrears: 100, status: 'Defaulter', deck_date: '2026-01-01' },
    ],
    defaulter_snapshots: [],
  });
  await syncFollowupFromDeck(db,
    [{ ref: 'BACK', team: 'KONGOWE', status: 'Defaulter', arrears: 4000 }], 'FRI', 'b', '2026-07-24');
  const by = Object.fromEntries(db._dump('followup_status').map(r => [r.ref, r]));
  assert.equal(by.BACK.arrears, 4000, 'they are in the file being uploaded — that settles it');
  assert.equal(by.BACK.deck_date, '2026-07-24');
});

test('a database without the column still works, and still retires by weekday', async () => {
  /* Migrations here are run by hand. Between a deploy and somebody opening the SQL editor the
     column does not exist, and the upload must not fail -- it simply does not stamp. */
  const syncFollowupFromDeck = await FU_SYNC();
  const rows = [
    { ref: 'MON1', team: 'KONGOWE', arrears: 900, status: 'Defaulter' },
    { ref: 'MONGONE', team: 'KONGOWE', arrears: 400, status: 'Defaulter' },
  ];
  const db = fakeDb({
    followup_status: rows,
    defaulter_snapshots: [
      { ref: 'MON1', snapshot_type: 'current', weekday: 'MON', snapshot_date: '2026-07-17', upload_batch: 'old', created_at: '2026-07-17T04:00:00Z' },
      { ref: 'MONGONE', snapshot_type: 'current', weekday: 'MON', snapshot_date: '2026-07-17', upload_batch: 'old', created_at: '2026-07-17T04:00:00Z' },
    ],
  });
  /* Make any select naming deck_date fail the way PostgREST does for an unknown column: ONE
     unknown column fails the WHOLE read, whatever else was asked for. The stub answers .limit
     and .range too, because a real query object does and the reader is free to page. */
  const realFrom = db.from.bind(db);
  db.from = (name) => {
    const q = realFrom(name);
    if (name !== 'followup_status') return q;
    const realSelect = q.select.bind(q);
    q.select = (cols) => {
      if (String(cols || '').includes('deck_date')) {
        const dead = {
          limit: () => dead, range: () => dead, order: () => dead, eq: () => dead,
          maybeSingle: () => dead,
          then: (res) => res({ data: null, error: { message: 'column followup_status.deck_date does not exist' } }),
        };
        return dead;
      }
      return realSelect(cols);
    };
    return q;
  };

  await syncFollowupFromDeck(db, [{ ref: 'MON1', team: 'KONGOWE', status: 'Defaulter', arrears: 800 }],
    'MON', 'newmon', '2026-07-24');
  const by = Object.fromEntries(db._dump('followup_status').map(r => [r.ref, r]));
  assert.equal(by.MON1.arrears, 800, 'the upload still lands');
  assert.equal(by.MONGONE.arrears, null, 'and the weekday rule still retires the one who left');
  assert.equal('deck_date' in by.MON1, false, 'nothing tries to write a column that is not there');
});

/* MATESO STEPHAN FELISI: ON KESHO WITH D.S 9-10 AND ON DEF WITH D.S 8-9.
 *
 * Being on both lists is right -- they answer different questions. Two different D.S values is
 * not: it means the Def row came from an older deck than the Kesho row, and that customer is
 * not in the current defaulter file at all.
 *
 * The first version of the fix retired a row whose deck_date was older than a fortnight, and
 * deliberately left rows with NO deck_date alone -- reasoning that they predate the column and
 * retiring them on a stamp they never had would empty the list.
 *
 * Which is exactly backwards for the row being complained about. It predates the column. It has
 * no stamp, it will never get one (nothing is uploading its weekday's deck), so under that rule
 * it could sit on the working list for ever. The fix cleared nothing.
 *
 * updated_at is the fallback: not null, and moved by any deck confirming the row or any officer
 * commenting on it. Untouched for a fortnight IS unconfirmed for a fortnight.
 */
test('a customer nobody has confirmed for a fortnight is retired even with no deck stamp', async () => {
  const { syncFollowupFromDeck } = await import('../api/upload.js');
  const old = '2026-06-20T04:00:00Z';                 // over a month before the deck below
  const db = fakeDb({
    followup_status: [
      { ref: 'MATESO', team: 'KONGOWE', full_name: 'MATESO STEPHAN FELISI', arrears: 8500,
        status: 'Defaulter', ds: '8-9', last_comment: 'aliahidi', updated_at: old },
      { ref: 'FRESH', team: 'KONGOWE', full_name: 'STILL WORKED', arrears: 400,
        status: 'Defaulter', updated_at: '2026-07-24T04:00:00Z' },
    ],
    defaulter_snapshots: [],
  });
  // A Monday deck that does not mention either of them. Nothing has ever been uploaded for
  // MATESO's own weekday, which is the whole point -- the per-weekday rule cannot reach them.
  const out = await syncFollowupFromDeck(db,
    [{ ref: 'D9', team: 'KONGOWE', full_name: 'ON THE DECK', arrears: 100 }],
    'MON', 'b-new', '2026-07-27');

  const by = Object.fromEntries(db._dump('followup_status').map(r => [r.ref, r]));
  assert.equal(by.MATESO.arrears, null, 'the stale row stops looking like a live defaulter');
  assert.equal(by.MATESO.status, null);
  assert.equal(by.MATESO.last_comment, 'aliahidi', 'and keeps every word of their history');
  assert.equal(by.FRESH.arrears, 400, 'somebody confirmed this month is left alone');
  assert.equal(out.retired, 1);
  assert.equal(out.staleCapped, 0);
});

test('a deck stamp still wins over updated_at when it is there', async () => {
  const { syncFollowupFromDeck } = await import('../api/upload.js');
  const db = fakeDb({
    /* Confirmed by a deck two days ago, but the row has not been WRITTEN since June. Reading
       updated_at alone would retire somebody a deck confirmed this week. */
    followup_status: [
      { ref: 'RECENT', team: 'KONGOWE', arrears: 700, status: 'Defaulter',
        deck_date: '2026-07-25', updated_at: '2026-06-01T04:00:00Z' },
    ],
    defaulter_snapshots: [],
  });
  await syncFollowupFromDeck(db, [{ ref: 'D9', team: 'KONGOWE', arrears: 100 }], 'MON', 'b', '2026-07-27');
  const row = db._dump('followup_status').find(r => r.ref === 'RECENT');
  assert.equal(row.arrears, 700, 'a deck confirmed them two days ago -- they stay');
});

test('the working list is never gutted in one upload, and the upload says so', async () => {
  /* Retiring is not deleting, and the next deck brings anybody back -- but this is the list two
     hundred people work from. If most of it looks stale, that is a real problem to read about,
     not one to action quietly. */
  const { syncFollowupFromDeck } = await import('../api/upload.js');
  const old = '2026-05-01T04:00:00Z';
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push({ ref: 'S' + i, team: 'KONGOWE', arrears: 500, status: 'Defaulter', updated_at: old });
  const db = fakeDb({ followup_status: rows, defaulter_snapshots: [] });

  const out = await syncFollowupFromDeck(db, [{ ref: 'D9', team: 'KONGOWE', arrears: 100 }], 'MON', 'b', '2026-07-27');
  assert.equal(out.retired, 0, 'nobody retired');
  assert.equal(out.staleCapped, 200, 'and the number is reported so it can be acted on');
  assert.equal(db._dump('followup_status').find(r => r.ref === 'S0').arrears, 500);
});

/* CLEANING THE FOLLOW-UP LIST WITHOUT WAITING FOR AN UPLOAD.
 *
 * Reported twice, two different customers: on Leo with D.S 9-10 and on Def with D.S 8-9 at the
 * same moment. The Def row is older than the other one and nothing has corrected it. The upload
 * retires such rows, but only WHEN SOMETHING IS UPLOADED -- and whoever is looking at the wrong
 * number cannot make that happen. So it is a button.
 */
test('the follow-up list can be cleaned on demand, and asking first changes nothing', async () => {
  const db = fakeDb({
    ...tables(),
    followup_status: [
      { ref: 'JOSEPH', team: 'KONGOWE', full_name: 'JOSEPH ANDREA KAHITWA', status: 'Defaulter',
        arrears: 8000, ds: '8-9', last_comment: 'aliahidi', updated_at: '2026-06-01T04:00:00Z' },
      { ref: 'LIVE', team: 'KONGOWE', full_name: 'STILL A DEFAULTER', status: 'Defaulter',
        arrears: 500, ds: '2-6', updated_at: TODAY + 'T04:00:00Z' },
    ],
  });

  // ASKING is free, and must not touch anything.
  const look = await portalApi(db, ADMIN, 'followupClean', {}, NOW);
  assert.equal(look.applied, false);
  assert.equal(look.stale, 1);
  assert.equal(look.sample[0].name, 'JOSEPH ANDREA KAHITWA');
  assert.equal(db._dump('followup_status').find(r => r.ref === 'JOSEPH').arrears, 8000,
    'a question is not an instruction');

  // ACTING is a second, explicit call.
  const done = await portalApi(db, ADMIN, 'followupClean', { confirm: true }, NOW);
  assert.equal(done.applied, true);
  assert.equal(done.retired, 1);
  const by = Object.fromEntries(db._dump('followup_status').map(r => [r.ref, r]));
  assert.equal(by.JOSEPH.arrears, null, 'stops looking like a live defaulter');
  assert.equal(by.JOSEPH.status, null);
  assert.equal(by.JOSEPH.last_comment, 'aliahidi', 'and NOTHING of their history is touched');
  assert.equal(by.LIVE.arrears, 500, 'somebody confirmed today is left alone');
});

test('cleaning the follow-up list is admin-only, and honours team scope', async () => {
  const db = fakeDb({ ...tables(), followup_status: [] });
  await assert.rejects(() => portalApi(db, GMO, 'followupClean', {}, NOW), e => e.status === 403);
});

/* CLEANING THE WORKING LIST MUST NOT MOVE A SINGLE FIGURE IN THE WEEKLY SUMMARY.
 *
 * Asked directly, and it is the right question: the button blanks status and arrears on
 * followup_status, and if any report counted its defaulters from there, cleaning would quietly
 * rewrite the week.
 *
 * It does not. The weekly summary counts defaulters from defaulter_snapshots -- the uploaded
 * decks themselves, which are history and are never touched by this. followup_status is the
 * officers' LIVE working list, a different thing with a different job. This test holds those
 * two apart, because a future change that started reading the working list for a weekly figure
 * would be silent, plausible, and wrong.
 */
test('cleaning stale defaulters changes nothing in the weekly summary', async () => {
  const t = tables();
  const db = fakeDb({
    ...t,
    followup_status: [
      { ref: 'STALE1', team: 'KONGOWE', full_name: 'OLD ONE', status: 'Defaulter', arrears: 9000,
        updated_at: '2026-05-01T04:00:00Z' },
      { ref: 'STALE2', team: 'KONGOWE', full_name: 'OLD TWO', status: 'Chronic', arrears: 7000,
        updated_at: '2026-05-01T04:00:00Z' },
    ],
  });
  const before = await portalApi(db, ADMIN, 'weekly', {}, NOW);

  const done = await portalApi(db, ADMIN, 'followupClean', { confirm: true }, NOW);
  assert.equal(done.retired, 2, 'both were genuinely retired, so this is a real comparison');

  const after = await portalApi(db, ADMIN, 'weekly', {}, NOW);
  assert.deepEqual(after.rows, before.rows, 'every team row is identical');
  assert.deepEqual(after.totals, before.totals, 'and so is every total');
});

test('promises and assignments survive a clean -- it only blanks the deck figures', async () => {
  /* The button clears status and arrears. It does NOT touch fu_status, promise_date,
     promise_amt or the last comment: those are what officers typed, and Promise to Pay and the
     assignment engine are built entirely on them. */
  const db = fakeDb({
    ...tables(),
    followup_status: [
      { ref: 'P1', team: 'KONGOWE', full_name: 'PROMISED', status: 'Defaulter', arrears: 4000,
        fu_status: 'AMETOA AHADI', promise_date: TODAY, promise_amt: 1200,
        last_comment: 'ataleta kesho', comment_by: 'JUMA G', updated_at: '2026-05-01T04:00:00Z' },
    ],
  });
  await portalApi(db, ADMIN, 'followupClean', { confirm: true }, NOW);
  const row = db._dump('followup_status').find(r => r.ref === 'P1');
  assert.equal(row.arrears, null);
  assert.equal(row.status, null);
  assert.equal(row.fu_status, 'AMETOA AHADI', 'the promise is the officer\'s work, not the deck\'s');
  assert.equal(row.promise_amt, 1200);
  assert.equal(row.last_comment, 'ataleta kesho');
});

/* WHAT AN OFFICER EARNS IS FIVE DAYS, NOT ONE WEEK.
 *
 * Pay follows each day's OWN band, added up -- a good Ijumaa is worth something after a poor
 * Jumanne. The board showed only the week's total and the week's single percentage, which is
 * the one number that does NOT decide the money. The five daily percentages are what tell
 * somebody what they are making, so they belong on the row.
 */
test('the PMO board carries each day\'s own percentage, keyed J3 J4 J5 AL IJ', async () => {
  const { pmoBoard, PMO_DAY_KEYS } = await import('../api/_lib/pmo.js');
  const { foldExpected } = await import('../api/_lib/snapshot-totals.js');
  assert.deepEqual(PMO_DAY_KEYS, ['J3', 'J4', 'J5', 'AL', 'IJ']);

  const days = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24'];
  /* Written as CUSTOMERS and folded into team-day totals, because that is what the board is
     handed now -- and folding here means the day still reads as "ten customers, six of whom
     paid" rather than as a pre-computed pair of sums nobody can check by eye. */
  const row = (paid, total, team) => foldExpected(Array.from({ length: total }, (_, i) => ({
    ref: 'R' + i, team, payment_expected: 1000, arrears: 0,
    todays_status: i < paid ? 'PAID' : 'UNPAID',
  })));
  const byDay = new Map();
  // Mon 100%, Tue 50%, Wed 0%, Thu 80%, Fri 100% -- five different bands on purpose.
  byDay.set(days[0], row(10, 10, 'KONGOWE'));
  byDay.set(days[1], row(5, 10, 'KONGOWE'));
  byDay.set(days[2], row(0, 10, 'KONGOWE'));
  byDay.set(days[3], row(8, 10, 'KONGOWE'));
  byDay.set(days[4], row(10, 10, 'KONGOWE'));

  const [r] = pmoBoard([{ name: 'KAMARIA', teams: ['KONGOWE'] }], byDay, days[4], days);
  assert.equal(r.pctJ3, 100);
  assert.equal(r.pctJ4, 50);
  assert.equal(r.pctJ5, 0);
  assert.equal(r.pctAL, 80);
  assert.equal(r.pctIJ, 100);

  /* AND THE MONEY IS THE SUM OF THE DAYS, not the week's percentage scored once. That is the
     whole reason the five columns exist -- if Week TZS were worked out from weekPct, a steady
     week and a spiky one paying the same total would look identical here. */
  const fromDays = ['J3', 'J4', 'J5', 'AL', 'IJ'].reduce((s, k) => s + r['tzs' + k], 0);
  assert.equal(r.weekCommission, fromDays);
  assert.ok(r.weekPct > 0 && r.weekPct < 100, 'the week has its own percentage too, as context');
});

/* THE WEEKLY BONUS IS A RATE, SO IT BELONGS WHERE THE RATES ARE.
 *
 * The rule was built and the amount deliberately left unset, to be typed into Settings as a raw
 * PMO_WEEKLY_BONUS key. So the one person deciding what a week is worth had to leave the board
 * showing it, find a key by name, and type a number with no context beside it. Every other rate
 * on the commission panel is set on the commission panel; this is a rate.
 */
test('the weekly bonus can be set from the commission panel', async () => {
  const db = fakeDb(tables());
  const r = await portalApi(db, ADMIN, 'commissionSave', { weeklyBonus: '250000' }, NOW);
  assert.equal(r.weeklyBonus, 250000);
  const row = db._dump('settings').find(s => s.key === 'PMO_WEEKLY_BONUS');
  assert.equal(row.value, '250000', 'and it writes the same key the rule already reads');

  // Zero is a real answer -- "no bonus this period" -- not a missing one.
  await portalApi(db, ADMIN, 'commissionSave', { weeklyBonus: '0' }, NOW);
  assert.equal(db._dump('settings').find(s => s.key === 'PMO_WEEKLY_BONUS').value, '0');

  // Nonsense cannot become a payout.
  await portalApi(db, ADMIN, 'commissionSave', { weeklyBonus: 'ngapi' }, NOW);
  assert.equal(db._dump('settings').find(s => s.key === 'PMO_WEEKLY_BONUS').value, '0');

  // Saving the other rates must not silently wipe it.
  await portalApi(db, ADMIN, 'commissionSave', { weeklyBonus: '90000' }, NOW);
  await portalApi(db, ADMIN, 'commissionSave', { paidTzs: '100' }, NOW);
  assert.equal(db._dump('settings').find(s => s.key === 'PMO_WEEKLY_BONUS').value, '90000',
    'a field left out of one save is untouched, not cleared');
});

test('setting the bonus is admin-only', async () => {
  const db = fakeDb(tables());
  await assert.rejects(() => portalApi(db, GMO, 'commissionSave', { weeklyBonus: '1' }, NOW),
    e => e.status === 403);
});

/* UNRECOVERED IS WHAT IS STILL OUT, NOT WHAT WAS DUE.
 *
 * Reported from the field, and it was a real defect rather than a preference: the recovery
 * trend tile printed the day's UNCOLLECTED under the heading "Unrecovered". Those are two
 * different numbers, and the difference between them is the entire point of the row --
 * "Tuesday left 8m behind, the officers got 2m of it back, so 6m is still out."
 */
test('unrecovered is the day\'s uncollected minus what came back', async () => {
  const d = await run('dashboardFull');
  for (const x of d.recTrend) {
    assert.equal(x.unrecovered, Math.max(0, x.uncollected - x.recovered),
      x.weekday + ': unrecovered must be what is left AFTER recovery, not what was due');
  }
  // At least one day in this book has both a real uncollected and a real recovery, or the
  // assertion above would be passing on a row of zeroes.
  const live = d.recTrend.filter(x => x.uncollected > 0 && x.recovered > 0);
  assert.ok(live.length > 0, 'the fixture must contain a day with both, or this proves nothing');
  for (const x of live) {
    assert.ok(x.unrecovered < x.uncollected,
      x.weekday + ': a day with recovery must show LESS still out than it left behind');
  }
});

test('unrecovered never goes negative, however good the day was', async () => {
  /* Recovery comes off the DEFAULTER decks -- a different population from today's expected
     list -- so a good day can bring back more than the day itself left behind. The tile must
     read 0 rather than a negative, which looks like a fault; the Rec % beside it goes above
     100 and that is where the room should be looking. */
  const { portalApi: api } = await import('../api/_lib/portal-core.js');
  const d = await run('dashboardFull');
  for (const x of d.recTrend) assert.ok(x.unrecovered >= 0, x.weekday + ' went negative');
  assert.ok(typeof api === 'function');
});

/* STAFF, BY PERSON RATHER THAN BY TEAM.
 *
 *   "one staff with 10 teams if changed i have to edit one by one team"
 *
 * Twenty edits to move a GMO off ten teams and onto ten others, each one a chance to miss a
 * row -- and a missed row leaves a team pointing at somebody who has left, silently, on every
 * board that resolves an officer from it.
 */
const STAFF_BOOK = () => ({
  teams: [
    { team: 'ALPHA', gmo: 'JUMA G', recovery: 'REC A', expected: 'EXP A' },
    { team: 'BETA',  gmo: 'JUMA G', recovery: 'REC B', expected: 'EXP A' },
    { team: 'GAMMA', gmo: 'OTHER P', recovery: 'REC A', expected: 'EXP B' },
    { team: 'DELTA', gmo: null,     recovery: null,    expected: null },
  ],
  access_codes: [
    { code: 'C1', name: 'CATHERINE', role: 'PMO COLLECTION', teams: ['ALPHA', 'BETA'] },
    { code: 'C2', name: 'KAMARIA', role: 'PMO COLLECTION', teams: ['GAMMA'] },
    { code: 'C3', name: 'SEES ALL', role: 'PMO COLLECTION', teams: [] },
    { code: 'A', name: 'ADMIN', role: 'ADMIN', teams: null },
  ],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }],
  roles: [],
});
const STAFF_ADMIN = { code: 'A', name: 'ADMIN', role: 'ADMIN', teams: null, tabs: ['settings', 'upload'] };

test('the roster shows the collection officers beside everybody else', async () => {
  const db = fakeDb(STAFF_BOOK());
  const r = await portalApi(db, STAFF_ADMIN, 'staffRoster', {}, NOW);

  const juma = r.staff.find(s => s.name === 'JUMA G' && s.role === 'gmo');
  assert.deepEqual(juma.teams, ['ALPHA', 'BETA'], 'a team-table role gathers its teams');

  /* THE POINT OF THE MERGE: a collection officer's teams live on their access code, not on the
     teams table, so they were not on this screen at all. */
  const cath = r.staff.find(s => s.name === 'CATHERINE');
  assert.equal(cath.role, 'collection');
  assert.deepEqual(cath.teams, ['ALPHA', 'BETA']);
  assert.equal(cath.code, 'C1', 'the code travels, so a save edits the right person');

  /* A code with NO teams means "every team" everywhere else in this system. Such a person is
     not a collection officer with a distributed portfolio, and listing them with an empty team
     list would invite somebody to "fix" it by ticking all forty. */
  assert.equal(r.staff.some(s => s.name === 'SEES ALL'), false);

  assert.ok(r.roles.some(x => x.key === 'collection'), 'collection is offered as a role');
  assert.deepEqual(r.allTeams, ['ALPHA', 'BETA', 'DELTA', 'GAMMA']);
});

test('one save moves a person across teams, and clears the ones they left', async () => {
  const db = fakeDb(STAFF_BOOK());
  const res = await portalApi(db, STAFF_ADMIN, 'saveStaffTeams',
    { role: 'gmo', name: 'JUMA G', teams: ['BETA', 'DELTA'] }, NOW);

  const by = Object.fromEntries(db._dump('teams').map(t => [t.team, t]));
  assert.equal(by.BETA.gmo, 'JUMA G', 'kept');
  assert.equal(by.DELTA.gmo, 'JUMA G', 'added');
  /* THE HALF THAT MADE THIS WORTH BUILDING. A reassignment left half-done is a team pointing
     at somebody who has left, and nothing on any screen says so. */
  assert.equal(by.ALPHA.gmo, null, 'a team they no longer hold is CLEARED');
  assert.equal(res.cleared, 1);

  // Nobody else is touched, on any team.
  assert.equal(by.GAMMA.gmo, 'OTHER P', 'another person keeps their team');
  assert.equal(by.ALPHA.recovery, 'REC A', 'and every other role on the same row is untouched');
  assert.equal(by.ALPHA.expected, 'EXP A');
});

test('only rows that actually change are written', async () => {
  /* A save that rewrote all forty teams would touch every other role on them for no reason,
     and on a database having a bad minute that is forty chances to fail instead of two. */
  const db = fakeDb(STAFF_BOOK());
  let writes = 0;
  const realFrom = db.from.bind(db);
  db.from = (n) => {
    const q = realFrom(n);
    if (n !== 'teams') return q;
    const realUpsert = q.upsert.bind(q);
    q.upsert = (rows, opts) => { writes += (rows || []).length; return realUpsert(rows, opts); };
    return q;
  };
  const res = await portalApi(db, STAFF_ADMIN, 'saveStaffTeams',
    { role: 'gmo', name: 'JUMA G', teams: ['ALPHA', 'BETA'] }, NOW);
  assert.equal(res.changed, 0, 'saving what is already true changes nothing');
  assert.equal(writes, 0, 'and writes nothing');
});

test('a collection officer is one write, however many teams they hold', async () => {
  const db = fakeDb(STAFF_BOOK());
  const res = await portalApi(db, STAFF_ADMIN, 'saveStaffTeams',
    { role: 'collection', code: 'C1', name: 'CATHERINE', teams: ['gamma', 'DELTA', 'GAMMA'] }, NOW);

  const row = db._dump('access_codes').find(c => c.code === 'C1');
  assert.deepEqual(row.teams, ['DELTA', 'GAMMA'],
    'normalised to uppercase and de-duplicated, like every other team list in the system');
  assert.equal(res.changed, 1, 'one write, because their teams are a list on the person');
  // And the teams table is not touched at all -- that is not where their teams live.
  assert.equal(db._dump('teams').find(t => t.team === 'GAMMA').gmo, 'OTHER P');
});

test('a collection officer with no access code is refused, and told what to do', async () => {
  const db = fakeDb(STAFF_BOOK());
  await assert.rejects(
    () => portalApi(db, STAFF_ADMIN, 'saveStaffTeams',
      { role: 'collection', name: 'NOBODY', teams: ['ALPHA'] }, NOW),
    /access code/i,
    'the error has to say WHERE a collection officer comes from, or it is a dead end');
});

test('an unknown role is refused rather than silently doing nothing', async () => {
  const db = fakeDb(STAFF_BOOK());
  await assert.rejects(
    () => portalApi(db, STAFF_ADMIN, 'saveStaffTeams', { role: 'wizard', name: 'X', teams: [] }, NOW),
    /Unknown role/);
});

test('only an admin may reassign staff', async () => {
  const db = fakeDb(STAFF_BOOK());
  const officer = { code: 'O', name: 'OFF', role: 'GMO', teams: ['ALPHA'], tabs: [] };
  await assert.rejects(
    () => portalApi(db, officer, 'saveStaffTeams', { role: 'gmo', name: 'X', teams: [] }, NOW),
    /admin/i);
});

/* THE DECKS ARE PAIRED WEEKDAY BY WEEKDAY, NOT JUST DATE BY DATE.
 *
 * A defaulter upload is one file per DATE that carries every weekday's customers inside it, so
 * a single snapshot_date holds a MON deck, a TUE deck and so on -- each one a different set of
 * people. "Recovered" is initial-minus-current, and it is only a real figure when both sides
 * describe the SAME people.
 *
 * The recovered CARD has always matched on weekday. The recovery trend, the weekly day strip,
 * the weekly team section and the dashboard's team board did not: they took the newest initial
 * batch on the date and the newest current batch on the date, which on a real book were
 * frequently two DIFFERENT weekdays. The gap between two unrelated populations was then printed
 * as recovery -- which is how one live week read 2.9 billion recovered on one day and MINUS 1.9
 * billion on the next, against a whole book of 2.1 billion, while the card beside it read a
 * sane 874 million off the very same data.
 *
 * The book below is that situation in miniature: on Monday's date the newest INITIAL batch
 * belongs to the TUE deck and the newest CURRENT batch belongs to the MON deck. Pair them and
 * Monday "recovers" 4.1 million out of a Monday book of 1 million. Pair each weekday with
 * itself and it recovers the 100,000 it actually recovered.
 */
const CROSS_WEEKDAY_BOOK = () => {
  const t = tables();
  const dd = (wd, type, arrears, hour, batch) => ({
    ref: 'X' + wd + type, full_name: 'C' + wd, contact: '0714000000', team: 'KONGOWE',
    arrears, status: 'Defaulter', ds: '3-6', dc: 3, days_elapsed: 45, disb_date: '2026-07-21',
    initial_inst: 100000, other_inst: 40000, balance: 500000,
    snapshot_type: type, weekday: wd, snapshot_date: MON,
    upload_batch: batch, created_at: MON + 'T' + hour + ':00:00Z',
  });
  t.defaulter_snapshots = [
    dd('MON', 'initial', 1000000, '04', 'i-mon'),
    dd('MON', 'current',  900000, '05', 'c-mon'),    // newest CURRENT batch on this date
    dd('TUE', 'initial', 5000000, '05', 'i-tue'),    // newest INITIAL batch on this date
    dd('TUE', 'current', 4800000, '04', 'c-tue'),
  ];
  return t;
};

test('the recovery trend pairs each weekday against itself, not across populations', async () => {
  const d = await run('dashboardFull', {}, ADMIN, fakeDb(CROSS_WEEKDAY_BOOK()));
  const mon = d.recTrend.find(x => x.weekday === 'MON');
  assert.equal(mon.from, 1000000, "Monday's baseline is the MON deck, not whichever was newest");
  assert.equal(mon.to, 900000, "and Monday's current is the MON deck too");
  assert.equal(mon.recovered, 100000,
    'cross-pairing would read 4,100,000 -- four times the whole Monday book');
});

test('the weekly day strip pairs each weekday against itself', async () => {
  const w = await run('weekly', {}, ADMIN, fakeDb(CROSS_WEEKDAY_BOOK()));
  const mon = w.days.find(x => x.weekday === 'MON');
  assert.equal(mon.recovered, 100000);
  // Tuesday's DATE carries no decks at all in this book, so Tuesday recovered nothing. It must
  // not borrow Monday's TUE-weekday deck: the deck belongs to the date it was uploaded on.
  assert.equal(w.days.find(x => x.weekday === 'TUE').recovered, 0);
});

test('the weekly team section pairs each weekday against itself', async () => {
  const w = await run('weekly', {}, ADMIN, fakeDb(CROSS_WEEKDAY_BOOK()));
  const kongowe = w.teams.find(t => t.team === 'KONGOWE');
  assert.equal(kongowe.recovered, 100000,
    'the team row and the day strip are the same money and must agree');
});

test('a weekday with no deck of its own recovers nothing, rather than the whole book', async () => {
  /* The other half of the same rule. Drop the MON current deck and Monday has a baseline and
     nothing to compare it against -- which must read 0, not "recovered the entire 1,000,000",
     and certainly not "recovered 1,000,000 minus some other weekday's current deck". */
  const book = CROSS_WEEKDAY_BOOK();
  book.defaulter_snapshots = book.defaulter_snapshots.filter(r => !(r.weekday === 'MON' && r.snapshot_type === 'current'));
  const d = await run('dashboardFull', {}, ADMIN, fakeDb(book));
  const mon = d.recTrend.find(x => x.weekday === 'MON');
  assert.equal(mon.recovered, 0);
  assert.equal(mon.to, 0);
});

/* =====================================================================================
   THE DOOR.
   =====================================================================================
   Who gets in and who does not is the most consequential rule in this system, and it had no
   test at all -- authCode reached for the database client directly instead of being handed one,
   so there was no way to write one. It takes an optional db now, and nothing else changed.

   The masked sign-in box is what made this urgent. A password field turns the browser's own
   autocapitalize="characters" off, so a phone that used to upper-case the code before sending
   it stopped doing so -- and a leader typing their own code in lower case would have been told
   it was invalid, with the box showing dots and no way to check.
*/
const { authCode } = await import('../api/_lib/auth.js');
const CODE_BOOK = () => ({ access_codes: [
  { code: 'KON123', name: 'ASHA JUMA', role: 'MANAGEMENT', teams: ['KONGOWE'], tabs: [] },
  { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] },
] });

test('an access code typed in the wrong case still opens the door', async () => {
  const db = fakeDb(CODE_BOOK());
  const u = await authCode('kon123', db);
  assert.equal(u.code, 'KON123', 'and it is the STORED code that comes back, not what was typed');
  assert.deepEqual(u.teams, ['KONGOWE'], 'with their real teams, not a guess');
});

test('the exact code still wins, so nothing about an existing one changes', async () => {
  const book = CODE_BOOK();
  // Two codes that differ only in case. The one typed exactly is the one that gets in.
  book.access_codes.push({ code: 'kon123', name: 'SOMEBODY ELSE', role: 'GMO', teams: ['MBAGALA'], tabs: [] });
  const db = fakeDb(book);
  assert.equal((await authCode('KON123', db)).name, 'ASHA JUMA');
  assert.equal((await authCode('kon123', db)).name, 'SOMEBODY ELSE');
});

test('an ambiguous code is refused rather than guessed', async () => {
  /* Two codes differing only in case, and neither typed exactly: signing somebody in on a coin
     toss would hand them another person's teams. Being told the code is invalid is the safe
     answer, and the admin can see both codes in Settings. */
  const book = CODE_BOOK();
  book.access_codes.push({ code: 'kon123', name: 'SOMEBODY ELSE', role: 'GMO', teams: ['MBAGALA'], tabs: [] });
  const db = fakeDb(book);
  await assert.rejects(() => authCode('KoN123', db), /Invalid access code/);
});

test('a wildcard in a typed code cannot match somebody else', async () => {
  /* The case-insensitive look-up is a LIKE, where % and _ are wildcards. Unescaped, typing
     "KON12_" or even "%" would match a real code and open somebody else's account. */
  const db = fakeDb(CODE_BOOK());
  await assert.rejects(() => authCode('%', db), /Invalid access code/);
  await assert.rejects(() => authCode('KON12_', db), /Invalid access code/);
  await assert.rejects(() => authCode('KON%', db), /Invalid access code/);
});

test('no code, and an unknown code, are both refused', async () => {
  const db = fakeDb(CODE_BOOK());
  await assert.rejects(() => authCode('', db), /required/i);
  await assert.rejects(() => authCode('NOPE99', db), /Invalid access code/);
});

/* =====================================================================================
   DELETING A TEAM.
   =====================================================================================
   "I need to delete team from the team and staff table."

   Five tables carry `team text references teams(team)` and Postgres refuses to delete a row any
   of them still points at. The guard only ever asked about `loans`, so a team with one day of
   snapshots behind it failed on the other four -- with the database's own words, naming a
   constraint rather than anything an admin can go and deal with.
*/
const TEAM_TO_DELETE = () => ({
  teams: [{ team: 'KONGOWE' }, { team: 'OLDTEAM' }],
  access_codes: [{ code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] }],
  call_users: [
    { user_id: 'u1', team: 'OLDTEAM', name: 'OFFICER ONE' },
    { user_id: 'u2', team: 'KONGOWE', name: 'OFFICER TWO' },
  ],
  repayment_snapshots: [], defaulter_snapshots: [], followup_status: [], loans: [],
});

test('a team with nothing behind it is deleted, and its handsets go with it', async () => {
  const db = fakeDb(TEAM_TO_DELETE());
  const r = await portalApi(db, ADMIN, 'deleteTeam', { team: 'oldteam' }, NOW);
  assert.equal(r.team, 'OLDTEAM', 'the name is normalised the same way every write path does');
  assert.equal(r.released, 1, 'the officers of a team that no longer exists must register again');
  assert.deepEqual(db._dump('teams').map(t => t.team), ['KONGOWE']);
  assert.deepEqual(db._dump('call_users').map(c => c.user_id), ['u2'],
    'and ONLY that team\'s handsets -- the rest of the company keeps working');
});

test('a team with history is refused, and told exactly what is holding it', async () => {
  const book = TEAM_TO_DELETE();
  book.repayment_snapshots = [
    { id: 'e1', ref: '1', team: 'OLDTEAM' }, { id: 'e2', ref: '2', team: 'OLDTEAM' },
  ];
  book.followup_status = [{ ref: '1', team: 'OLDTEAM' }];
  const db = fakeDb(book);
  await assert.rejects(
    () => portalApi(db, ADMIN, 'deleteTeam', { team: 'OLDTEAM' }, NOW),
    e => /2 expected snapshots/.test(e.message) && /1 follow-up records/.test(e.message),
    'the refusal has to name the tables AND the counts, or there is nothing to act on');
  assert.equal(db._dump('teams').length, 2, 'and nothing was deleted');
  assert.equal(db._dump('call_users').length, 2, 'not even the handsets');
});

test('only an admin may delete a team', async () => {
  const db = fakeDb(TEAM_TO_DELETE());
  await assert.rejects(() => portalApi(db, GMO, 'deleteTeam', { team: 'OLDTEAM' }, NOW), e => e.status === 403);
});

/* =====================================================================================
   A WEEK THAT HAS ALREADY HAPPENED.
   =====================================================================================
   "I need a Mondays date picker at dashboard and presentations so that if I choose a last
    weeks Monday then I get last weeks reports / performances"

   Every figure on those screens is derived from ONE moment, so the moment itself moves and
   the ordinary code produces the answer -- no second path for history to drift down.
*/
const { asOfWeek } = await import('../api/_lib/portal-core.js');

test('picking a past Monday reads that week, as it stood on its Friday', () => {
  // NOW is Friday 2026-07-24; this week's Monday is 2026-07-20.
  const a = asOfWeek(NOW, '2026-07-13');
  assert.equal(a.weekOf, '2026-07-13');
  assert.equal(a.past, true);
  assert.equal(todayKeyOf(a.ms), '2026-07-17', 'the Friday of the chosen week, not its Monday');
});

test('any day of a past week snaps to that week, not to a week starting mid-way', () => {
  for (const d of ['2026-07-13', '2026-07-15', '2026-07-19']) {
    assert.equal(asOfWeek(NOW, d).weekOf, '2026-07-13', d);
  }
});

test('this week, a future week, and no choice at all leave the clock exactly alone', () => {
  /* The live screen has to be bit-for-bit what it was before the picker existed. A future
     week is clamped rather than honoured: there is nothing in it, and a dashboard of zeroes
     reads as a broken system rather than as an empty future. */
  for (const pick of ['', null, undefined, 'rubbish', '2026-07-20', '2026-07-24', '2026-09-01']) {
    const a = asOfWeek(NOW, pick);
    assert.equal(a.ms, NOW, String(pick));
    assert.equal(a.past, false, String(pick));
    assert.equal(a.weekOf, MON, String(pick));
  }
});

/* "I tried pressing the date picker to 10th august so that all info start of next week but
   didn't work". Picked on the Sunday, the 10th is NEXT week -- and the clamp answered with
   the current week SILENTLY, so the screen redrew with the identical figures and looked
   broken. The clamp is right; the silence was the bug. */
test('a week that has not started says so, instead of pretending nothing was pressed', () => {
  const a = asOfWeek(NOW, '2026-09-01');            // NOW is Friday 2026-07-24
  assert.equal(a.future, true, 'the screen has to be able to say the week has not started');
  assert.equal(a.requested, '2026-08-31', 'and which week was actually asked for, as its Monday');
  assert.equal(a.weekOf, MON, 'while still showing the live week rather than a screen of zeroes');
  assert.equal(a.ms, NOW);
});

test('a mid-week date reports the Monday it resolved to, so the snap is explainable', () => {
  // Thursday of a past week. The screen shows that week; the bar can now say why.
  const a = asOfWeek(NOW, '2026-07-16');
  assert.equal(a.weekOf, '2026-07-13');
  assert.equal(a.requested, '2026-07-13');
  assert.equal(a.future, false);
});

test('no choice at all reports no request -- the ordinary case stays quiet', () => {
  for (const pick of ['', null, undefined, 'rubbish']) {
    const a = asOfWeek(NOW, pick);
    assert.equal(a.requested, null, String(pick));
    assert.equal(a.future, false, String(pick));
  }
});

test('the weekly report carries the week bar its own answer', async () => {
  const d = await portalApi(fakeDb(tables()), ADMIN, 'weekly', { weekOf: '2026-09-01' }, NOW);
  assert.equal(d.weekFuture, true);
  assert.equal(d.weekRequested, '2026-08-31');
  assert.equal(d.weekOf, MON, 'and still shows the live week');
});

test('the dashboard computes a past week from that week, not from today', async () => {
  const book = tables();
  const LASTMON = '2026-07-13', LASTFRI = '2026-07-17';
  // Last week's book: a different expected sheet, and a defaulter deck that recovered.
  book.repayment_snapshots.push(
    { ...E('LW1', 'KONGOWE', 9000, 'UNPAID', 0, LASTFRI), upload_batch: 'blw', created_at: LASTFRI + 'T04:00:00Z' });
  book.defaulter_snapshots.push(
    { ...D('LW1', 'KONGOWE', 5000, 'initial', 45, LASTFRI, 'FRI'), upload_batch: 'ilw', created_at: LASTFRI + 'T04:00:00Z' },
    { ...D('LW1', 'KONGOWE', 4000, 'current', 45, LASTFRI, 'FRI'), upload_batch: 'clw', created_at: LASTFRI + 'T04:00:00Z' });
  const db = fakeDb(book);

  const now = await portalApi(db, ADMIN, 'dashboardFull', {}, NOW);
  assert.equal(now.weekOf, MON);
  assert.equal(now.pastWeek, false);

  const last = await portalApi(db, ADMIN, 'dashboardFull', { weekOf: LASTMON }, NOW);
  assert.equal(last.weekOf, LASTMON, 'the week it says it is showing');
  assert.equal(last.pastWeek, true, 'and it says out loud that this is not today');
  assert.equal(last.asOfDate, LASTFRI);
  assert.equal(last.weekday, 'FRI');

  // The figures are that week's, worked out from that week's decks.
  assert.equal(last.cards.curArrears, 4000);
  assert.equal(last.cards.initArrears, 5000);
  assert.equal(last.cards.recovered, 1000);
  // And this week's screen is untouched by the existence of last week's.
  assert.notEqual(now.cards.curArrears, 4000);
});

test('the recovery trend of a past week lands on that week\'s own days', async () => {
  const book = tables();
  const LASTMON = '2026-07-13';
  book.defaulter_snapshots.push(
    { ...D('LW2', 'KONGOWE', 800, 'initial', 45, LASTMON, 'MON'), upload_batch: 'i2', created_at: LASTMON + 'T04:00:00Z' },
    { ...D('LW2', 'KONGOWE', 300, 'current', 45, LASTMON, 'MON'), upload_batch: 'c2', created_at: LASTMON + 'T04:00:00Z' });
  const d = await portalApi(fakeDb(book), ADMIN, 'dashboardFull', { weekOf: LASTMON }, NOW);
  const mon = d.recTrend.find(x => x.weekday === 'MON');
  assert.equal(mon.date, LASTMON, 'Monday of the CHOSEN week');
  assert.equal(mon.recovered, 500);
  assert.equal(d.recTrend.length, 7);
  assert.equal(d.recTrend[6].date, '2026-07-19', 'through to that week\'s Sunday');
});

test('the officer boards follow the same week, so a deck cannot pair two of them', async () => {
  /* The Presentation asks for the dashboard AND the boards. If only one of them honoured the
     week, the slides would set one week's cards beside another week's officers -- the sort of
     thing nobody notices in a dark room. */
  const db = fakeDb(tables());
  const a = await portalApi(db, ADMIN, 'officerBoards', { weekOf: '2026-07-13' }, NOW);
  const b = await portalApi(db, ADMIN, 'officerBoards', {}, NOW);
  assert.equal(a.weekOf, '2026-07-13');
  assert.equal(b.weekOf, MON, 'and the two answers are not the same cache entry');
});

test('the weekly report snaps a mid-week date to its Monday too', async () => {
  const db = fakeDb(tables());
  // A Wednesday. All three screens have to agree on what "that week" means.
  const w = await portalApi(db, ADMIN, 'weekly', { weekOf: '2026-07-15' }, NOW);
  assert.equal(w.weekOf, '2026-07-13');
});

/* =====================================================================================
   TODAY'S RECOVERY, BESIDE THE WEEK'S.
   =====================================================================================
   "On wiki report add leo rec b/se we only seeing total week rec at call app without noticing
    todays progress in app"

   By Thursday the week's figure is mostly Monday and Tuesday, so a day of nothing disappears
   inside it. Both numbers come off the SAME paired decks in the same pass, so they cannot
   disagree about the day.
*/
test('the weekly report separates today\'s recovery from the week\'s', async () => {
  const book = tables();
  const THU = '2026-07-23';
  book.defaulter_snapshots.push(
    // Thursday: 900 -> 400, so 500 recovered on a day that is NOT today.
    { ...D('W1', 'KONGOWE', 900, 'initial', 45, THU, 'THU'), upload_batch: 'it', created_at: THU + 'T04:00:00Z' },
    { ...D('W1', 'KONGOWE', 400, 'current', 45, THU, 'THU'), upload_batch: 'ct', created_at: THU + 'T04:00:00Z' });
  const w = await portalApi(fakeDb(book), ADMIN, 'weekly', {}, NOW);   // NOW is Friday

  const fri = w.days.find(d => d.weekday === 'FRI');
  assert.equal(w.totals.isCurrentWeek, true);
  assert.equal(w.totals.recoveredToday, fri.recovered,
    'leo is exactly the day strip\'s Friday, not a second calculation');
  assert.ok(w.totals.recovered > w.totals.recoveredToday,
    'and the week is more than today, or Thursday\'s 500 went missing');

  // ADMIN sees every team, so the day strip is the COMPANY's Friday and one team's column is
  // a part of it. The grand total is what has to reconcile.
  assert.equal(w.teamTotals.recToday, w.totals.recoveredToday,
    'the team section\'s grand total and the day strip are the same money');
  const kongowe = w.teams.find(t => t.team === 'KONGOWE');
  assert.ok(kongowe.recToday > 0 && kongowe.recToday <= fri.recovered,
    'and one team is a part of it, not more than it');
});

test('a past week has no "today", and says so rather than borrowing Friday', async () => {
  /* With the Monday picker, the weekly report can be pointed at a finished week. Printing that
     week's Friday under the heading "Leo" would be a different number wearing the same label. */
  const w = await portalApi(fakeDb(tables()), ADMIN, 'weekly', { weekOf: '2026-07-13' }, NOW);
  assert.equal(w.weekOf, '2026-07-13');
  assert.equal(w.totals.isCurrentWeek, false);
  assert.equal(w.totals.recoveredToday, 0);
});

/* =====================================================================================
   "KWA HALI" COUNTS ALL THREE CATEGORIES, AND CAN NOW SHOW THAT IT DOES.
   ===================================================================================== */
test('the follow-up status board splits defaulters, expired and chronic', async () => {
  const book = tables();
  book.followup_status = [
    { ref: 'F1', team: 'KONGOWE', status: 'Defaulter', arrears: 100, fu_status: 'AMETOA AHADI' },
    { ref: 'F2', team: 'KONGOWE', status: 'Expired', arrears: 200, fu_status: 'AMETOA AHADI' },
    { ref: 'F3', team: 'KONGOWE', status: 'Chronic', arrears: 300, fu_status: 'AMETOA AHADI' },
    { ref: 'F4', team: 'KONGOWE', status: 'Chronic', arrears: 400, fu_status: '' },
  ];
  const d = await portalApi(fakeDb(book), ADMIN, 'followupReport', {}, NOW);
  const promised = d.byStatus.find(s => s.status === 'AMETOA AHADI');
  assert.equal(promised.customers, 3);
  assert.deepEqual([promised.defaulters, promised.expired, promised.chronic], [1, 1, 1],
    'one of each, rather than three of an unnamed kind');
  assert.equal(promised.defaulters + promised.expired + promised.chronic, promised.customers,
    'the split has to add back up to the count beside it');

  const untouched = d.byStatus.find(s => s.status === '(NOT TOUCHED)');
  assert.equal(untouched.chronic, 1);
  assert.deepEqual([d.totals.defaulters, d.totals.expired, d.totals.chronic], [1, 1, 2],
    'and the report totals carry the same three-way split');
});

/* THE DAY STRIP OBEYS THE BATCH RULE, LIKE EVERYTHING ELSE.
 *
 * Every read in this system takes the latest upload_batch within a date, so a corrected
 * re-upload supersedes rather than doubles. The weekly report's five day tiles were the one
 * place that did not: they summed EVERY batch. So on any day somebody uploaded twice, the
 * strip read roughly double while the team section underneath it -- which does apply the rule
 * -- read the truth. Two figures for the same money on one screen, appearing only after a
 * re-upload, which is precisely when somebody is already hunting a discrepancy.
 */
test('a re-uploaded day does not double the weekly day strip', async () => {
  const book = tables();
  const FRI = TODAY;
  // The same Friday, uploaded twice: a wrong file at 04:00, the corrected one at 09:00.
  book.repayment_snapshots = [
    { ...E('R1', 'KONGOWE', 5000, 'UNPAID', 0, FRI), upload_batch: 'bad', created_at: FRI + 'T04:00:00Z' },
    { ...E('R1', 'KONGOWE', 1000, 'UNPAID', 0, FRI), upload_batch: 'fix', created_at: FRI + 'T09:00:00Z' },
  ];
  book.defaulter_snapshots = [
    { ...D('R1', 'KONGOWE', 9000, 'initial', 45, FRI, 'FRI'), upload_batch: 'ibad', created_at: FRI + 'T04:00:00Z' },
    { ...D('R1', 'KONGOWE', 2000, 'initial', 45, FRI, 'FRI'), upload_batch: 'ifix', created_at: FRI + 'T09:00:00Z' },
    { ...D('R1', 'KONGOWE', 1500, 'current', 45, FRI, 'FRI'), upload_batch: 'cfix', created_at: FRI + 'T09:00:00Z' },
  ];
  const w = await portalApi(fakeDb(book), ADMIN, 'weekly', {}, NOW);
  const fri = w.days.find(d => d.weekday === 'FRI');

  assert.equal(fri.expected, 1000, 'the corrected upload, not both added together');
  assert.equal(fri.customers, 1, 'and one customer, not the same person twice');
  assert.equal(fri.recovered, 500, '2000 initial - 1500 current, off the winning batches only');

  // And the two halves of the screen agree, which is the whole point.
  assert.equal(w.teamTotals.expected, fri.expected);
  assert.equal(w.teamTotals.recToday, fri.recovered);
});

/* =====================================================================================
   THE EXPECTED TAB: FEWER ROWS, FEWER COLUMNS, SAME SCREEN.
   =====================================================================================
   This read downloaded every team's customers with every column, and threw away the
   thirty-nine teams the officer may not see -- the exact shape behind the 521s in the log.
   Both halves of the narrowing are pinned here: an officer must get their own teams only, and
   every column the tab draws must still arrive.
*/
test('an officer\'s Expected read is scoped to their teams at the database', async () => {
  const db = fakeDb(tables());
  const seen = [];
  const watched = { from(n){ const q = db.from(n); if (n === 'repayment_snapshots') seen.push(q); return q; },
    rpc: db.rpc, _dump: n => db._dump(n) };

  const officer = await portalApi(watched, GMO, 'expected', {}, NOW);
  assert.deepEqual(officer.rows.map(r => r.ref).sort(), ['111', '222'],
    'their own team, and MBAGALA\'s customer is not on the list');
  assert.ok(officer.rows.every(r => r.team === 'KONGOWE'));

  // An admin sees every team, exactly as before -- null teams means no narrowing at all.
  const admin = await portalApi(fakeDb(tables()), ADMIN, 'expected', {}, NOW);
  assert.deepEqual(admin.rows.map(r => r.ref).sort(), ['111', '222', '333']);
});

test('the Expected tab still receives every column it draws', async () => {
  const d = await portalApi(fakeDb(tables()), ADMIN, 'expected', {}, NOW);
  const r = d.rows.find(x => x.ref === '111');
  // The table's own columns...
  for (const k of ['ref', 'full_name', 'contact', 'team', 'due_summary',
    'payment_expected', 'todays_status', 'arrears']) {
    assert.notEqual(r[k], undefined, k + ' is missing from the narrowed read');
  }
  // ...and the pair the follow-up drawer offers to ring when the customer will not answer.
  assert.notEqual(r.guarantor_name, undefined);
  assert.notEqual(r.guarantor_contact, undefined);
  // The three fields collectedOf() reads have to be real numbers, or the totals are silently 0.
  assert.equal(d.totals.expected, 2300, 'all three teams: 1000 + 500 + 800');
  assert.equal(d.totals.collected, 500, 'PAID counts the expected amount -- 222 paid 500');
});

test('the per-weekday Expected read is scoped and complete too', async () => {
  const officer = await portalApi(fakeDb(tables()), GMO, 'expectedDay', { weekday: 'FRI' }, NOW);
  assert.ok(officer.rows.every(r => r.team === 'KONGOWE'));
  assert.deepEqual(officer.teams, ['KONGOWE'], 'and the team filter offers only what they may see');
  for (const r of officer.rows) {
    for (const k of ['ref', 'full_name', 'contact', 'payment_expected', 'todays_status']) {
      assert.notEqual(r[k], undefined, k + ' missing on ' + r.ref);
    }
  }
});

test('the Defaulters tab is scoped to the officer\'s teams as well', async () => {
  const officer = await portalApi(fakeDb(tables()), GMO, 'defaulters', {}, NOW);
  assert.ok(officer.rows.length > 0);
  assert.ok(officer.rows.every(r => r.team === 'KONGOWE'),
    'MBAGALA\'s defaulter must not be carried here to be dropped in JavaScript');
});

/* =====================================================================================
   THE DEMAND MESSAGE.
   =====================================================================================
   "We need a WHATSApp & Normal sms demand message pretext button ... Kwa maelezo Zaidi piga
    (user phone no from leader table chat, if not in chat default to pmo recovery no)"

   The number is the point. A demand notice telling a customer to ring a number nobody answers
   is worse than sending nothing, so the three fallbacks are pinned here one at a time.
*/
const { demandContact, waNumber } = await import('../api/_lib/portal-core.js');
const DEMAND_BOOK = () => {
  const t = tables();
  t.teams[0] = { ...t.teams[0], recovery: 'JUMA G', recovery_no: '0713000001',
    gmo: 'GEE MO', gmo_no: '0714000002', manager: 'BOSS', manager_no: '0715000003' };
  t.settings.push({ key: 'PMO_RECOVERY_NO', value: '0800111222' });
  t.followup_status = [{ ref: '555', team: 'KONGOWE', full_name: 'DEF GUY',
    contact: '0714000001', arrears: 900, status: 'Defaulter', fu_status: '' }];
  return t;
};

test('the number is the sender\'s own, found by the role they hold on that team', async () => {
  const gmo = { code: 'G', name: 'GEE MO', role: 'GMO', teams: ['KONGOWE'], tabs: [] };
  const d = await portalApi(fakeDb(DEMAND_BOOK()), gmo, 'demandMessage', { ref: '555' }, NOW);
  assert.equal(d.phone, '0714000002');
  assert.equal(d.phoneSource, 'gmo');
  assert.match(d.text, /Kwa maelezo Zaidi piga 0714000002/);
  assert.match(d.text, /^Habari/);
  assert.match(d.text, /Unakumbushwa kulipa deni lako \(Arreas\) kuepusha usumbufu\./);
});

test('somebody with no number of their own falls back to the recovery officer', async () => {
  const other = { code: 'X', name: 'NOBODY IN PARTICULAR', role: 'ADMIN', teams: null, tabs: [] };
  const d = await portalApi(fakeDb(DEMAND_BOOK()), other, 'demandMessage', { ref: '555' }, NOW);
  assert.equal(d.phone, '0713000001');
  assert.equal(d.phoneSource, 'recovery');
});

test('a team with no numbers at all falls back to the PMO', async () => {
  const book = DEMAND_BOOK();
  delete book.teams[0].recovery_no;
  const d = await portalApi(fakeDb(book), ADMIN, 'demandMessage', { ref: '555' }, NOW);
  assert.equal(d.phone, '0800111222');
  assert.equal(d.phoneSource, 'pmo');
});

test('with no number anywhere the "piga" line is dropped, not left empty', async () => {
  /* A reminder with no number is still a reminder. A reminder telling somebody to call
     nothing -- or to call "undefined" -- is a complaint waiting to happen. */
  const book = DEMAND_BOOK();
  delete book.teams[0].recovery_no;
  book.settings = book.settings.filter(s => s.key !== 'PMO_RECOVERY_NO');
  const d = await portalApi(fakeDb(book), ADMIN, 'demandMessage', { ref: '555' }, NOW);
  assert.equal(d.phone, '');
  assert.ok(d.text.indexOf('piga') < 0, 'the whole line goes, not just the token');
  assert.ok(d.text.indexOf('{phone}') < 0, 'and certainly not the placeholder');
  assert.match(d.text, /Unakumbushwa kulipa deni lako/, 'but the reminder itself survives');
});

test('the wording is a setting, so it changes without a deploy', async () => {
  const book = DEMAND_BOOK();
  book.settings.push({ key: 'DEMAND_MESSAGE_TEXT', value: 'Salamu. Lipa deni. Piga {phone}' });
  const d = await portalApi(fakeDb(book), ADMIN, 'demandMessage', { ref: '555' }, NOW);
  assert.equal(d.text, 'Salamu. Lipa deni. Piga 0713000001');
});

test('both links carry the same message, addressed to the customer', async () => {
  const d = await portalApi(fakeDb(DEMAND_BOOK()), ADMIN, 'demandMessage', { ref: '555' }, NOW);
  assert.ok(d.whatsapp.startsWith('https://wa.me/255714000001?text='),
    'a local 07... number becomes 2557... for wa.me: ' + d.whatsapp);
  assert.equal(decodeURIComponent(d.whatsapp.split('?text=')[1]), d.text);
  assert.ok(d.sms.startsWith('sms:0714000001?body='));
  assert.equal(decodeURIComponent(d.sms.split('?body=')[1]), d.text);
});

test('a phone number is normalised for WhatsApp, or left alone if it cannot be', () => {
  assert.equal(waNumber('0714000001'), '255714000001');
  assert.equal(waNumber('714000001'), '255714000001');
  assert.equal(waNumber('+255 714 000 001'), '255714000001');
  assert.equal(waNumber('255714000001'), '255714000001');
  assert.equal(waNumber(''), '');
  assert.equal(waNumber(null), '');
});

test('nobody can read another team\'s officer number by naming it', async () => {
  /* The customer decides the team, not the caller -- otherwise passing a team name would be a
     way to read that team's officers' phone numbers. */
  const gmo = { code: 'G', name: 'JUMA G', role: 'GMO', teams: ['MBAGALA'], tabs: [] };
  await assert.rejects(
    () => portalApi(fakeDb(DEMAND_BOOK()), gmo, 'demandMessage', { ref: '555', team: 'MBAGALA' }, NOW),
    e => e.status === 403);
});

test('the fallback order is a rule of its own, testable without a database', () => {
  const team = { team: 'T', gmo: 'A', gmo_no: '111', recovery: 'B', recovery_no: '222' };
  assert.deepEqual(demandContact({ name: 'A' }, team, '999'), { phone: '111', source: 'gmo' });
  assert.deepEqual(demandContact({ name: 'B' }, team, '999'), { phone: '222', source: 'recovery' });
  assert.deepEqual(demandContact({ name: 'C' }, team, '999'), { phone: '222', source: 'recovery' });
  assert.deepEqual(demandContact({ name: 'C' }, { team: 'T' }, '999'), { phone: '999', source: 'pmo' });
  assert.deepEqual(demandContact({ name: 'C' }, null, ''), { phone: '', source: 'none' });
  // A name on the team with no number beside it must not win and then print nothing.
  assert.deepEqual(demandContact({ name: 'A' }, { team: 'T', gmo: 'A', recovery_no: '222' }, '999'),
    { phone: '222', source: 'recovery' });
});

/* =====================================================================================
   CHANGING YOUR OWN CODE.
   =====================================================================================
   "and i can change my admin password in my admin a/c please"

   The access code IS the password: it decides who you are, which teams you see and what you
   may change. This is the one change that can lock the real owner out of their own account, so
   every guard on it is worth a test.
*/
const CODE_OWNER = () => ({
  access_codes: [
    { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] },
    { code: 'LEADER1', name: 'ASHA JUMA', role: 'MANAGEMENT', teams: ['KONGOWE'], tabs: [] },
  ],
  teams: [{ team: 'KONGOWE' }],
});
const ME = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] };

test('an admin can change their own code', async () => {
  const db = fakeDb(CODE_OWNER());
  const r = await portalApi(db, ME, 'changeMyCode',
    { oldCode: 'ADMIN1', newCode: 'NEWPASS9', confirmCode: 'NEWPASS9' }, NOW);
  assert.equal(r.ok, true);
  const codes = db._dump('access_codes').map(c => c.code).sort();
  assert.deepEqual(codes, ['LEADER1', 'NEWPASS9']);
  // Their name, role and teams survive -- this changes the secret, not the person.
  const row = db._dump('access_codes').find(c => c.code === 'NEWPASS9');
  assert.equal(row.name, 'THE ADMIN');
  assert.equal(row.role, 'ADMIN');
});

test('the current code is required, even though you are already signed in', async () => {
  /* A portal session is a code held in a browser, so "already signed in" is exactly the state
     somebody is in when they have walked away from an unlocked screen. */
  const db = fakeDb(CODE_OWNER());
  await assert.rejects(
    () => portalApi(db, ME, 'changeMyCode', { oldCode: 'WRONG1', newCode: 'NEWPASS9' }, NOW),
    e => e.status === 403);
  assert.deepEqual(db._dump('access_codes').map(c => c.code).sort(), ['ADMIN1', 'LEADER1']);
});

test('a new code that is already somebody else\'s is refused', async () => {
  /* Case-insensitively, because sign-in now matches that way -- so a code differing only in
     case from somebody else's would be an ambiguity the door refuses, locking BOTH out. */
  const db = fakeDb(CODE_OWNER());
  await assert.rejects(
    () => portalApi(db, ME, 'changeMyCode', { oldCode: 'ADMIN1', newCode: 'LEADER1' }, NOW),
    /already in use/i);
  await assert.rejects(
    () => portalApi(db, ME, 'changeMyCode', { oldCode: 'ADMIN1', newCode: 'leader1' }, NOW),
    /already in use/i);
});

test('a short, punctuated, mistyped or unchanged code is refused', async () => {
  const db = fakeDb(CODE_OWNER());
  const bad = async (p, re) => assert.rejects(
    () => portalApi(db, ME, 'changeMyCode', { oldCode: 'ADMIN1', ...p }, NOW), re);
  await bad({ newCode: 'AB12' }, /6 characters/);
  await bad({ newCode: 'NEW PASS 9' }, /Letters and numbers/);
  await bad({ newCode: 'NEWPASS9', confirmCode: 'NEWPASS8' }, /do not match/);
  await bad({ newCode: 'ADMIN1' }, /same code/);
  await bad({ newCode: '' }, /current code and the new one/);
  assert.deepEqual(db._dump('access_codes').map(c => c.code).sort(), ['ADMIN1', 'LEADER1']);
});

test('a leader can change their own code too -- it is not an admin privilege', async () => {
  /* Every leader has a code and every leader's code is their authority. A rule that only
     admins may change their own would be the wrong way round. */
  const db = fakeDb(CODE_OWNER());
  const lead = { code: 'LEADER1', name: 'ASHA JUMA', role: 'MANAGEMENT', teams: ['KONGOWE'], tabs: [] };
  await portalApi(db, lead, 'changeMyCode', { oldCode: 'LEADER1', newCode: 'ASHA2026' }, NOW);
  assert.ok(db._dump('access_codes').some(c => c.code === 'ASHA2026'));
});

test('nobody can change somebody else\'s code through this door', async () => {
  const db = fakeDb(CODE_OWNER());
  const lead = { code: 'LEADER1', name: 'ASHA JUMA', role: 'MANAGEMENT', teams: ['KONGOWE'], tabs: [] };
  await assert.rejects(
    () => portalApi(db, lead, 'changeMyCode', { oldCode: 'ADMIN1', newCode: 'STOLEN99' }, NOW),
    e => e.status === 403);
  assert.deepEqual(db._dump('access_codes').map(c => c.code).sort(), ['ADMIN1', 'LEADER1']);
});

/* =====================================================================================
   SWEEPING UP THE SUPERSEDED UPLOADS.
   =====================================================================================
   "I thought we weren't overiting a days reports and I was uploading like every half an hour
    so leave the last uploads"

   Nothing was ever double-counted -- every read already takes the latest batch. What thirty
   copies of a day do is fill the database. This removes precisely the rows every read was
   already ignoring, which is why it cannot change a figure.
*/
const DUP_BOOK = () => {
  const t = tables();
  const E2 = (ref, amt, batch, hour) => ({
    ref, full_name: 'C' + ref, team: 'KONGOWE', payment_expected: amt, arrears: 0,
    todays_status: 'UNPAID', snapshot_type: 'today', snapshot_date: TODAY,
    upload_batch: batch, created_at: TODAY + 'T' + hour + ':00:00Z',
  });
  // The same day uploaded three times, half an hour apart.
  t.repayment_snapshots = [
    E2('A', 100, 'b08', '08'), E2('B', 100, 'b08', '08'),
    E2('A', 200, 'b09', '09'), E2('B', 200, 'b09', '09'),
    E2('A', 300, 'b10', '10'), E2('B', 300, 'b10', '10'),
  ];
  t.defaulter_snapshots = [];
  return t;
};

test('a dry run counts what is beyond the last two, and deletes nothing', async () => {
  const db = fakeDb(DUP_BOOK());
  const r = await portalApi(db, ADMIN, 'purgeSuperseded', {}, NOW);
  assert.equal(r.dryRun, true);
  assert.equal(r.keep, 2, 'the one in use and the one it replaced');
  assert.equal(r.totalBatches, 1, 'three uploads, two kept, so one goes');
  assert.equal(r.totalRows, 2);
  assert.equal(r.deletedBatches, 0);
  assert.equal(db._dump('repayment_snapshots').length, 6, 'and nothing was touched');
});

test('confirming keeps the last TWO uploads and removes the rest', async () => {
  /* "just keep two copies if unsuccessful uploads are an issue" -- the one in use, and the one
     it replaced, so a bad upload can still be undone by sending the right file again. */
  const db = fakeDb(DUP_BOOK());
  const before = await portalApi(db, ADMIN, 'expected', {}, NOW);
  const r = await portalApi(db, ADMIN, 'purgeSuperseded', { confirm: true }, NOW);
  assert.equal(r.deletedBatches, 1);
  const left = db._dump('repayment_snapshots');
  assert.equal(left.length, 4);
  assert.deepEqual([...new Set(left.map(x => x.upload_batch))].sort(), ['b09', 'b10'],
    'the 10:00 upload and the 09:00 one it replaced; the 08:00 one goes');

  // THE POINT: the figures cannot move, because what went is what every read already skipped.
  const after = await portalApi(db, ADMIN, 'expected', {}, NOW);
  assert.equal(after.totals.expected, before.totals.expected);
  assert.equal(after.count, before.count);
  // Running it again finds nothing left to do.
  const again = await portalApi(db, ADMIN, 'purgeSuperseded', { confirm: true }, NOW);
  assert.equal(again.totalBatches, 0);
});

test('keeping one is allowed, for a deployment that wants the space back', async () => {
  const db = fakeDb(DUP_BOOK());
  const r = await portalApi(db, ADMIN, 'purgeSuperseded', { confirm: true, keep: 1 }, NOW);
  assert.equal(r.keep, 1);
  assert.equal(r.deletedBatches, 2);
  const left = db._dump('repayment_snapshots');
  assert.ok(left.every(x => x.upload_batch === 'b10'), 'only the 10:00 upload survives');
});

test('the sweep works in bounded bites and says what is left', async () => {
  /* A book uploaded every half hour for weeks has hundreds of losing batches, and one delete
     per batch would run past the platform's sixty seconds. */
  const db = fakeDb(DUP_BOOK());
  const r = await portalApi(db, ADMIN, 'purgeSuperseded', { confirm: true, keep: 1, limit: 1 }, NOW);
  assert.equal(r.deletedBatches, 1);
  assert.equal(r.remainingBatches, 1, 'so it can be run again until it reports none');
  assert.equal(db._dump('repayment_snapshots').length, 4);
});

test('a day with two uploads is already at the limit and is left alone', async () => {
  const book = DUP_BOOK();
  book.repayment_snapshots = book.repayment_snapshots.filter(r => r.upload_batch !== 'b08');
  const db = fakeDb(book);
  const r = await portalApi(db, ADMIN, 'purgeSuperseded', { confirm: true }, NOW);
  assert.equal(r.totalBatches, 0);
  assert.equal(db._dump('repayment_snapshots').length, 4);
});

test('a day with only one upload is left completely alone', async () => {
  const db = fakeDb(tables());
  const before = db._dump('repayment_snapshots').length;
  const r = await portalApi(db, ADMIN, 'purgeSuperseded', { confirm: true }, NOW);
  assert.equal(r.totalBatches, 0);
  assert.equal(db._dump('repayment_snapshots').length, before);
});

test('only an admin may sweep', async () => {
  const db = fakeDb(DUP_BOOK());
  await assert.rejects(() => portalApi(db, GMO, 'purgeSuperseded', { confirm: true }, NOW),
    e => e.status === 403);
});

/* =====================================================================================
   WHO DID WHAT.
   =====================================================================================
   "Add an audit log nav and start with access for admin only, I may tyick it to be seen on
    others via settings as usual so that we know who did what"

   Written from the ONE door every portal call goes through, so it cannot be forgotten at the
   hundredth call site -- a log with holes in it invites the conclusion that what is missing
   did not happen.
*/
const AUDIT_BOOK = () => {
  const t = tables();
  t.audit_log = [];
  return t;
};

test('a change is recorded: who, what, and what it was about', async () => {
  const db = fakeDb(AUDIT_BOOK());
  await portalApi(db, ADMIN, 'settingSet', { key: 'SALES_TARGET', value: '5000000' }, NOW);
  const log = db._dump('audit_log');
  assert.equal(log.length, 1);
  const r = log[0];
  assert.equal(r.action, 'settingSet');
  assert.equal(r.actor_name, 'THE ADMIN');
  assert.equal(r.actor_code, 'A');
  assert.equal(r.actor_role, 'ADMIN');
  assert.equal(r.ok, true);
  assert.match(r.subject, /key=SALES_TARGET/);
});

test('the payload never reaches the log', async () => {
  /* An audit log is read by whoever is allowed to see the log, so one carrying its arguments in
     full would be a second, unguarded copy of the customer book. Only the identifying fields
     survive -- and the list is of what is KEPT, so an argument nobody thought about is excluded
     by default rather than included by default. */
  const db = fakeDb(AUDIT_BOOK());
  await portalApi(db, ADMIN, 'addComment', {
    ref: '555', team: 'KONGOWE', comment: 'Ana pesa nyingi, mkewe 0714999888',
    promiseAmt: 250000, newNumber: '0714999888',
  }, NOW);
  const r = db._dump('audit_log')[0];
  assert.equal(r.ref, '555', 'which customer, yes');
  assert.equal(r.team, 'KONGOWE');
  const whole = JSON.stringify(r);
  assert.ok(whole.indexOf('mkewe') < 0, 'the comment text must not be in the log: ' + whole);
  assert.ok(whole.indexOf('0714999888') < 0, 'nor a phone number');
  assert.ok(whole.indexOf('250000') < 0, 'nor an amount');
});

test('a refused attempt is recorded, and the refusal still happens', async () => {
  /* Somebody trying to delete a team they may not touch is precisely what this exists to show,
     so a failure is worth MORE than a success, not less. */
  const db = fakeDb(AUDIT_BOOK());
  await assert.rejects(() => portalApi(db, GMO, 'deleteTeam', { team: 'KONGOWE' }, NOW),
    e => e.status === 403);
  const r = db._dump('audit_log')[0];
  assert.equal(r.action, 'deleteTeam');
  assert.equal(r.actor_name, 'JUMA G');
  assert.equal(r.ok, false);
  assert.match(r.error, /admin/i);
});

test('reads are not logged', async () => {
  /* Two hundred officers opening a dashboard every few minutes would bury the twelve writes a
     day that matter. This table exists to be read by a person. */
  const db = fakeDb(AUDIT_BOOK());
  await portalApi(db, ADMIN, 'expected', {}, NOW);
  await portalApi(db, ADMIN, 'followup', {}, NOW);
  await portalApi(db, ADMIN, 'dashboardFull', {}, NOW);
  assert.equal(db._dump('audit_log').length, 0);
});

test('a database with no audit table still saves', async () => {
  /* An audit log that could fail a save would turn every write in the system into two things
     that must both succeed -- a worse system than one with no audit log at all. */
  const base = fakeDb(AUDIT_BOOK());
  const db = { from(n) { if (n === 'audit_log') throw new Error('relation does not exist'); return base.from(n); },
    rpc: base.rpc, _dump: n => base._dump(n) };
  const r = await portalApi(db, ADMIN, 'settingSet', { key: 'X', value: '1' }, NOW);
  assert.ok(r);
  assert.ok(base._dump('settings').some(s => s.key === 'X'), 'the setting was saved regardless');
});

test('the log is admin-only until the tab is granted', async () => {
  const db = fakeDb(AUDIT_BOOK());
  await assert.rejects(() => portalApi(db, GMO, 'auditLog', {}, NOW), e => e.status === 403);
  // "I may tyick it to be seen on others via settings as usual" -- ticking the tab is the whole
  // mechanism, the same one every other tab uses.
  const granted = { code: 'G', name: 'JUMA G', role: 'GMO', teams: ['KONGOWE'], tabs: ['audit'] };
  const d = await portalApi(db, granted, 'auditLog', {}, NOW);
  assert.ok(Array.isArray(d.rows));
});

test('the tab is offered to roles, so it can be ticked without a deploy', async () => {
  const db = fakeDb(AUDIT_BOOK());
  const d = await portalApi(db, ADMIN, 'teams', {}, NOW);
  assert.ok(d.allTabs.includes('audit'),
    'the role editor has to offer it, or "tick it via settings" is not a thing anybody can do');
});

test('the log reads newest first and says so when it is not set up', async () => {
  const book = AUDIT_BOOK();
  book.audit_log = [
    { at: '2026-07-24T08:00:00Z', actor_name: 'A', action: 'settingSet', ok: true },
    { at: '2026-07-24T09:00:00Z', actor_name: 'B', action: 'saveTeam', ok: true },
  ];
  const d = await portalApi(fakeDb(book), ADMIN, 'auditLog', {}, NOW);
  assert.deepEqual(d.rows.map(r => r.actor_name), ['B', 'A']);
  assert.equal(d.available, true);
  assert.equal(d.note, null);

  const base = fakeDb(AUDIT_BOOK());
  const missing = { from(n) { if (n === 'audit_log') throw new Error('relation does not exist'); return base.from(n); },
    rpc: base.rpc, _dump: n => base._dump(n) };
  const gone = await portalApi(missing, ADMIN, 'auditLog', {}, NOW);
  assert.equal(gone.available, false);
  assert.match(gone.note, /2026-08-09c-audit-log\.sql/,
    'an empty audit log reads as "nobody did anything" -- it has to say which it is');
});

/* =====================================================================================
   THE FOLLOW-UP STATUS LIST IS EDITABLE; ITS BEHAVIOURS ARE NOT.
   =====================================================================================
   "edit existing/add new fu_status; new ones should be plain-comment type with no calendar or
    new-number characteristics"

   The built-in ten are the ones the SYSTEM behaves differently for -- AMETOA AHADI opens a
   promise date and feeds the promise report and now the bell; ANA NAMBA NYINGINE opens a
   replacement number. Those are wired into other screens, not decorations on a word.
*/
test('an admin can add a status, and it is a plain comment', async () => {
  const db = fakeDb(tables());
  const before = await portalApi(db, ADMIN, 'fuStatuses', {}, NOW);
  assert.ok(before.fuStatuses.includes('AMETOA AHADI'));
  assert.deepEqual(before.fuNeedDate, ['AMETOA AHADI']);

  const after = await portalApi(db, ADMIN, 'fuStatusesSave',
    { list: before.fuStatuses.join('\n') + '\nAMEHAMIA\nKAFARIKI' }, NOW);
  assert.ok(after.fuStatuses.includes('AMEHAMIA'));
  assert.ok(after.fuStatuses.includes('KAFARIKI'));
  // THE POINT: nothing new acquires a calendar or a number box.
  assert.deepEqual(after.fuNeedDate, ['AMETOA AHADI']);
  assert.deepEqual(after.fuNeedNumber, ['ANA NAMBA NYINGINE']);
  assert.ok(!after.fuNeedDate.includes('AMEHAMIA'));
});

test('removing a built-in takes its behaviour with it', async () => {
  /* A deployment with no use for AMETOA AHADI must not be left with a calendar for a word
     nobody can choose. */
  const db = fakeDb(tables());
  const r = await portalApi(db, ADMIN, 'fuStatusesSave',
    { list: 'HAPATIKANI\nANALIPA LEO\nANA NAMBA NYINGINE' }, NOW);
  assert.deepEqual(r.fuStatuses, ['HAPATIKANI', 'ANALIPA LEO', 'ANA NAMBA NYINGINE']);
  assert.deepEqual(r.fuNeedDate, [], 'the promise date goes with the promise status');
  assert.deepEqual(r.fuNeedNumber, ['ANA NAMBA NYINGINE'], 'and the one still listed keeps its box');
});

test('the list cannot be emptied by accident', async () => {
  /* An empty dropdown is a screen nobody can use. Somebody clearing the box must not be able
     to stop the whole company logging a follow-up. */
  const db = fakeDb(tables());
  for (const empty of ['', '   ', '\n\n', null, undefined]) {
    const r = await portalApi(db, ADMIN, 'fuStatusesSave', { list: empty }, NOW);
    assert.ok(r.fuStatuses.length >= 10, 'falls back to the built-in ten: ' + JSON.stringify(empty));
  }
});

test('the same word twice is one option, not two', async () => {
  const db = fakeDb(tables());
  const r = await portalApi(db, ADMIN, 'fuStatusesSave',
    { list: 'ANALIPA LEO\nanalipa leo\nAMEHAMIA' }, NOW);
  assert.deepEqual(r.fuStatuses, ['ANALIPA LEO', 'AMEHAMIA']);
});

test('only an admin may edit the list', async () => {
  const db = fakeDb(tables());
  await assert.rejects(() => portalApi(db, GMO, 'fuStatusesSave', { list: 'X\nY' }, NOW),
    e => e.status === 403);
  // But anyone signed in may read it -- every screen with a follow-up form needs it.
  const r = await portalApi(db, GMO, 'fuStatuses', {}, NOW);
  assert.ok(r.fuStatuses.length > 0);
});

test('the phone gets the edited list, not the built-in one', async () => {
  const db = fakeDb(tables());
  await portalApi(db, ADMIN, 'fuStatusesSave', { list: 'ANALIPA LEO\nAMEHAMIA' }, NOW);
  const { _clearWidgetCache } = await import('../api/_lib/call-core.js');
  _clearWidgetCache();
  const t = db._dump('teams').find(x => x.team === 'KONGOWE');
  t.team_code = 'KON123';                       // this book has no codes; the phone needs one
  await callApi(db, 'api_callRegister', ['dfu', 'JUMA ISSA', '', '', '0712999444', 'KON123'], NOW);
  const boot = await callApi(db, 'api_callBoot', ['dfu'], NOW);
  assert.deepEqual(boot.fuStatuses, ['ANALIPA LEO', 'AMEHAMIA'],
    'one list, or the office and the field are logging different vocabularies');
  assert.deepEqual(boot.fuNeedDate, []);
});

/* =====================================================================================
   A PROMISE THAT HAS COME DUE REACHES THE BELL.
   =====================================================================================
   "Ameweka ahadi should also pop into notification when their date reaches"

   A promise is the one thing in this system with a date attached that nobody was told about.
   It sat in the Promise to Pay tab, and unless somebody opened that tab on the right morning
   it passed silently -- which is exactly the day it was worth acting on.
*/
const PROMISE_BOOK = (dates) => {
  const t = tables();
  t.followup_status = dates.map((d, i) => ({
    ref: 'P' + i, team: 'KONGOWE', full_name: 'PROMISER ' + i, contact: '07140001' + i,
    arrears: d.arrears == null ? 5000 : d.arrears, status: 'Defaulter',
    fu_status: 'AMETOA AHADI', promise_date: d.on, promise_amt: 2000, comment_by: 'JUMA G',
  }));
  return t;
};

test('a promise due today is on the bell', async () => {
  const d = await portalApi(fakeDb(PROMISE_BOOK([{ on: TODAY }])), ADMIN, 'notifications', {}, NOW);
  const p = d.items.find(x => x.kind === 'promise');
  assert.ok(p, 'the promise has to appear at all');
  assert.equal(p.ref, 'P0');
  assert.equal(p.late, false);
  assert.match(p.what, /leo|today/i);
  assert.match(p.what, new RegExp(TODAY));
});

test('a promise nobody chased is more urgent, not less', async () => {
  const d = await portalApi(fakeDb(PROMISE_BOOK([{ on: YEST }])), ADMIN, 'notifications', {}, NOW);
  const p = d.items.find(x => x.kind === 'promise');
  assert.ok(p, 'a promise that came due on Saturday must still be there on Monday');
  assert.equal(p.late, true);
  assert.match(p.what, /overdue|imepita/i);
});

test('a promise still in the future is not on the bell yet', async () => {
  const later = '2026-07-31';
  const d = await portalApi(fakeDb(PROMISE_BOOK([{ on: later }])), ADMIN, 'notifications', {}, NOW);
  assert.equal(d.items.filter(x => x.kind === 'promise').length, 0);
});

test('a promise whose customer has cleared is dropped', async () => {
  /* They paid, which is the outcome the promise existed for. Telling somebody to chase it
     would be worse than saying nothing. */
  const d = await portalApi(fakeDb(PROMISE_BOOK([{ on: TODAY, arrears: 0 }])), ADMIN, 'notifications', {}, NOW);
  assert.equal(d.items.filter(x => x.kind === 'promise').length, 0);
});

test('a promise on another team stays on that team', async () => {
  const book = PROMISE_BOOK([{ on: TODAY }]);
  book.followup_status[0].team = 'MBAGALA';
  const d = await portalApi(fakeDb(book), GMO, 'notifications', {}, NOW);
  assert.equal(d.items.filter(x => x.kind === 'promise').length, 0);
});

test('the bell survives a promise read that fails', async () => {
  /* An addition to the bell must not be able to take the bell down. A bell that stops showing
     complaints because one extra query was refused is worse than one without promises. */
  const base = fakeDb(PROMISE_BOOK([{ on: TODAY }]));
  const db = { from(n) {
      const q = base.from(n);
      if (n === 'followup_status') { q.then = (res) => Promise.resolve({ data: null, error: { message: 'nope' } }).then(res); }
      return q;
    }, rpc: base.rpc, _dump: n => base._dump(n) };
  const d = await portalApi(db, ADMIN, 'notifications', {}, NOW);
  assert.ok(Array.isArray(d.items), 'the bell still answers');
  assert.equal(d.items.filter(x => x.kind === 'promise').length, 0);
});

/* =====================================================================================
   WHO WAS BEST, AND WHEN -- WRITTEN DOWN AT THE TIME.
   =====================================================================================
   "the system needs to always keep record of best team and leaders weekly, monthly and yearly
    progress REGARDLESS OF FUTURE LEADER TABLE ALTERATIONS"

   The last five words are the whole design. Every report here resolves a leader by looking
   them up NOW -- right for today's work, and it means the past is rewritten every time
   somebody is moved. A record copies the name and position AS TEXT at the moment it is
   written: a photograph, not a pointer.
*/
const { recordsFor, periodsOf } = await import('../api/_lib/performance.js');

test('one date belongs to a week, a month and a year', () => {
  assert.deepEqual(periodsOf('2026-07-24'), [
    { period: 'week', period_start: '2026-07-20' },
    { period: 'month', period_start: '2026-07-01' },
    { period: 'year', period_start: '2026-01-01' },
  ]);
});

test('a record carries the leader\'s name and position as text', () => {
  const teams = [{ team: 'KONGOWE', sales: 500, collected: 800, expected: 1000, recovered: 300, uncollected: 600 }];
  const leadBy = { KONGOWE: { team: 'KONGOWE', gmo: 'GEE MO', manager: 'BOSS', recovery: 'JUMA G' } };
  const rows = recordsFor(teams, leadBy, '2026-07-24');

  const rec = rows.find(r => r.period === 'week' && r.metric === 'recovery' && r.scope === 'leader');
  assert.equal(rec.name, 'JUMA G');
  assert.equal(rec.position, 'RECOVERY', 'the position they held THEN, not a lookup done later');
  assert.equal(rec.value, 300);
  assert.equal(rec.basis, 600);
  assert.equal(rec.pct, 50);

  // All three metrics, both scopes, all three periods.
  assert.deepEqual([...new Set(rows.map(r => r.metric))].sort(), ['collection', 'recovery', 'sales']);
  assert.deepEqual([...new Set(rows.map(r => r.scope))].sort(), ['leader', 'team']);
  assert.deepEqual([...new Set(rows.map(r => r.period))].sort(), ['month', 'week', 'year']);
});

test('a leader holding several teams is one record, added up', () => {
  const teams = [
    { team: 'A', sales: 100, collected: 0, expected: 0, recovered: 40, uncollected: 100 },
    { team: 'B', sales: 300, collected: 0, expected: 0, recovered: 60, uncollected: 100 },
  ];
  const leadBy = { A: { recovery: 'JUMA G' }, B: { recovery: 'JUMA G' } };
  const rows = recordsFor(teams, leadBy, '2026-07-24');
  const rec = rows.filter(r => r.period === 'week' && r.metric === 'recovery' && r.scope === 'leader');
  assert.equal(rec.length, 1);
  assert.equal(rec[0].value, 100, '40 + 60 across both their teams');
  assert.equal(rec[0].pct, 50, 'and the percentage from the summed parts, not an average of two');
});

test('a zero is not an achievement worth a row', () => {
  const rows = recordsFor([{ team: 'A', sales: 0, collected: 0, expected: 0, recovered: 0, uncollected: 0 }],
    { A: { recovery: 'X' } }, '2026-07-24');
  assert.equal(rows.length, 0);
});

test('the weekly report writes the record, and a later reassignment cannot rewrite it', async () => {
  /* THE TEST THE FEATURE EXISTS FOR. Record a week with JUMA G on KONGOWE, then move the team
     to somebody else. The record must still say JUMA G. */
  const book = tables();
  book.performance_records = [];
  book.teams[0] = { ...book.teams[0], recovery: 'JUMA G', gmo: 'GEE MO', manager: 'BOSS' };
  const db = fakeDb(book);

  await portalApi(db, ADMIN, 'weekly', {}, NOW);
  const written = db._dump('performance_records');
  assert.ok(written.length > 0, 'opening the weekly report is what writes the record');
  const rec = written.find(r => r.period === 'week' && r.metric === 'recovery' && r.scope === 'leader');
  assert.ok(rec, 'a recovery leader was recorded');
  assert.equal(rec.name, 'JUMA G');
  assert.equal(rec.period_start, MON);

  // The leader table changes. Everything live re-points -- that is correct and deliberate.
  await portalApi(db, ADMIN, 'saveTeam', { team: 'KONGOWE', recovery: 'SOMEBODY ELSE' }, NOW);

  // The RECORD does not.
  const after = await portalApi(db, ADMIN, 'perfHistory', { period: 'week', metric: 'recovery' }, NOW);
  const still = after.rows.find(r => r.scope === 'leader' && r.period_start === MON);
  assert.equal(still.name, 'JUMA G',
    'last week still says who actually earned it, whoever holds the team today');
  assert.equal(still.position, 'RECOVERY');
});

test('re-opening the report updates the period rather than piling up rows', async () => {
  /* A week is written many times while it is running and settles on its final figures when it
     ends -- which is exactly how a record of "this week" should behave. */
  const book = tables();
  book.performance_records = [];
  book.teams[0] = { ...book.teams[0], recovery: 'JUMA G' };
  const db = fakeDb(book);
  await portalApi(db, ADMIN, 'weekly', {}, NOW);
  const first = db._dump('performance_records').length;
  await portalApi(db, ADMIN, 'weekly', {}, NOW);
  await portalApi(db, ADMIN, 'weekly', {}, NOW);
  assert.equal(db._dump('performance_records').length, first, 'three reads, one set of records');
});

test('a database with no history table still shows the weekly report', async () => {
  /* A report that failed because its history could not be written would be a worse report than
     one with no history. */
  const base = fakeDb(tables());
  const db = { from(n) { if (n === 'performance_records') throw new Error('relation does not exist'); return base.from(n); },
    rpc: base.rpc, _dump: n => base._dump(n) };
  const w = await portalApi(db, ADMIN, 'weekly', {}, NOW);
  assert.ok(w.teams.length > 0);
  const h = await portalApi(db, ADMIN, 'perfHistory', {}, NOW);
  assert.equal(h.available, false);
  assert.match(h.note, /2026-08-09d-performance-records\.sql/);
});

/* =====================================================================================
   RIPOTI, SORTED BY A LEADER.
   ===================================================================================== */
test('naming a leader scopes the call report to the teams they hold', async () => {
  const book = tables();
  book.teams = [
    { team: 'KONGOWE', recovery: 'JUMA G' },
    { team: 'MBAGALA', recovery: 'JUMA G' },
    { team: 'SINZA', recovery: 'OTHER P' },
  ];
  const db = fakeDb(book);
  const d = await portalApi(db, ADMIN, 'callReport', { leader: 'JUMA G' }, NOW);
  assert.deepEqual(d.scope.slice().sort(), ['KONGOWE', 'MBAGALA'],
    'their two teams, and not the third');
  assert.equal(d.leader, 'JUMA G');
  // The dropdown is built from the same map the scoping uses, not a second guess about who
  // counts as a leader.
  assert.deepEqual(d.leaders.map(l => l.name).sort(), ['JUMA G', 'OTHER P']);
  assert.equal(d.leaders.find(l => l.name === 'JUMA G').teams, 2);
});

test('a leader filter narrows what you may see, never widens it', async () => {
  /* Choosing a leader whose teams overlap yours shows the overlap; choosing one whose teams you
     hold none of shows nothing. A leader filter must not become a way round team scoping. */
  const book = tables();
  book.teams = [
    { team: 'KONGOWE', recovery: 'JUMA G' },
    { team: 'MBAGALA', recovery: 'JUMA G' },
  ];
  const db = fakeDb(book);
  const onlyKongowe = { code: 'X', name: 'NOBODY', role: 'GMO', teams: ['KONGOWE'], tabs: [] };
  const d = await portalApi(db, onlyKongowe, 'callReport', { leader: 'JUMA G' }, NOW);
  assert.deepEqual(d.scope, ['KONGOWE'], 'the overlap only');

  const elsewhere = { code: 'Y', name: 'NOBODY2', role: 'GMO', teams: ['SINZA'], tabs: [] };
  const none = await portalApi(db, elsewhere, 'callReport', { leader: 'JUMA G' }, NOW);
  assert.deepEqual(none.scope, [], 'and nothing at all when there is no overlap');
});

/* =====================================================================================
   THE SWEEP IS BOUNDED, AND SAYS HOW FAR BACK TO ASK NEXT.
   =====================================================================================
   Reported from the field: "angalia/check first loads nothing".

   The first version defaulted `from` to the year 0001, which asked the totals function to
   aggregate every snapshot row the company has ever written in ONE call. On a real book that
   does not come back inside the platform's sixty seconds, so the button appeared to do
   nothing at all. Bounded to a window, it finishes -- and says which window it covered and the
   date to ask for next, so the screen can walk backwards until there is nothing older.
*/
test('the sweep covers a window, not the whole history', async () => {
  const db = fakeDb(DUP_BOOK());
  const r = await portalApi(db, ADMIN, 'purgeSuperseded', { to: TODAY }, NOW);
  assert.equal(r.days, 31, 'a month at a time by default');
  assert.equal(r.to, TODAY);
  assert.equal(r.from, '2026-06-24', 'thirty-one days ending today, not the year 0001');
  assert.equal(r.before, '2026-06-23', 'and the day before it, to ask for next');
});

test('it says when there is nothing older left to ask for', async () => {
  const db = fakeDb(DUP_BOOK());
  // Everything in this book is on TODAY, so one window covers it.
  const r = await portalApi(db, ADMIN, 'purgeSuperseded', { to: TODAY }, NOW);
  assert.equal(r.oldest, TODAY, 'the earliest date anything is held on');
  assert.equal(r.done, true, 'so the walk stops rather than marching back through empty years');
});

test('a window that predates the data is done immediately', async () => {
  const db = fakeDb(DUP_BOOK());
  const r = await portalApi(db, ADMIN, 'purgeSuperseded', { to: '2026-01-31' }, NOW);
  assert.equal(r.totalBatches, 0);
  assert.equal(r.done, true);
});

test('an older window finds its own duplicates and points further back', async () => {
  const book = DUP_BOOK();
  const OLD = '2026-05-10';
  const E3 = (ref, batch, hour) => ({
    ref, full_name: 'C' + ref, team: 'KONGOWE', payment_expected: 100, arrears: 0,
    todays_status: 'UNPAID', snapshot_type: 'today', snapshot_date: OLD,
    upload_batch: batch, created_at: OLD + 'T' + hour + ':00:00Z',
  });
  book.repayment_snapshots.push(E3('X', 'o08', '08'), E3('X', 'o09', '09'), E3('X', 'o10', '10'));
  const db = fakeDb(book);

  // This month's window does not reach May.
  const now = await portalApi(db, ADMIN, 'purgeSuperseded', { to: TODAY }, NOW);
  assert.equal(now.done, false, 'there IS something older, so keep walking');
  assert.equal(now.oldest, OLD);

  // The May window finds it.
  const may = await portalApi(db, ADMIN, 'purgeSuperseded', { to: '2026-05-31', confirm: true }, NOW);
  assert.equal(may.deletedBatches, 1, 'three uploads that day, two kept');
  assert.deepEqual([...new Set(db._dump('repayment_snapshots')
    .filter(r => r.snapshot_date === OLD).map(r => r.upload_batch))].sort(), ['o09', 'o10']);
});

/* =====================================================================================
   STAMPING A WEEK BY HAND, AND RE-STAMPING IT.
   =====================================================================================
   "i always want to choose week and press stamp report so as to ferment permanent data of
    current uploaded weekly data and if i do so to that week again meaning i could overwrite it
    too in case like i reuploaded something to those dates"
*/
test('stamping a week writes that week\'s records', async () => {
  const book = tables();
  book.performance_records = [];
  book.teams[0] = { ...book.teams[0], recovery: 'JUMA G', gmo: 'GEE MO', manager: 'BOSS' };
  const db = fakeDb(book);
  const r = await portalApi(db, ADMIN, 'stampWeek', {}, NOW);
  assert.equal(r.weekOf, MON);
  assert.ok(r.records > 0, 'it says what it wrote');
  assert.equal(r.empty, false);
  assert.ok(db._dump('performance_records').length > 0);
});

test('re-stamping the same week overwrites rather than piling up', async () => {
  /* The case the request names: a week corrected by a re-upload is corrected in the record. */
  const book = tables();
  book.performance_records = [];
  book.teams[0] = { ...book.teams[0], recovery: 'JUMA G' };
  const db = fakeDb(book);
  await portalApi(db, ADMIN, 'stampWeek', {}, NOW);
  const first = db._dump('performance_records').length;
  const before = db._dump('performance_records')
    .find(x => x.metric === 'recovery' && x.scope === 'leader').value;

  // More recovery arrives for that week, and the week is stamped again.
  db._dump('defaulter_snapshots').forEach(d => { if (d.snapshot_type === 'current') d.arrears = 0; });
  await portalApi(db, ADMIN, 'stampWeek', {}, NOW);

  assert.equal(db._dump('performance_records').length, first, 'same rows, not twice as many');
  const after = db._dump('performance_records')
    .find(x => x.metric === 'recovery' && x.scope === 'leader').value;
  assert.ok(after > before, 'and the figure was updated: ' + before + ' -> ' + after);
});

test('stamping a week with nothing in it says so', async () => {
  const book = tables();
  book.performance_records = [];
  const db = fakeDb(book);
  const r = await portalApi(db, ADMIN, 'stampWeek', { weekOf: '2026-05-04' }, NOW);
  assert.equal(r.empty, true, 'rather than silently recording nothing');
});

test('only an admin may stamp', async () => {
  const db = fakeDb(tables());
  await assert.rejects(() => portalApi(db, GMO, 'stampWeek', {}, NOW), e => e.status === 403);
});

/* =====================================================================================
   THE LEADERS SHEET, OUT AND BACK IN.
   =====================================================================================
   "I want to upload updated leaders table but have an opt to download existing one so that I
    make the few updates and upload current"
*/
test('the leaders export carries every column, in the importer\'s own shape', async () => {
  const book = tables();
  book.teams = [{ team: 'KONGOWE', team_code: 'KON123', region: 'DAR', zone: 'A',
    recovery: 'JUMA G', recovery_no: '0713000001', gmo: 'GEE MO', gmo_no: '0714000002',
    manager: 'BOSS', manager_no: '0715000003', credit: 'ANALYST A', credit_id: 'CA9',
    credit_no: '0716000004', expected: 'EXP A', expected_no: '0717000005',
    bike: 'BIKE B', bike_no: '0718000006', legal: 'LEGAL L', legal_no: '0719000007',
    collection: 'CATHERINE', collection_no: '0720000008', opm: 'OPM O', opm_no: '0721000009' }];
  const d = await portalApi(fakeDb(book), ADMIN, 'teamsExport', {}, NOW);
  assert.equal(d.count, 1);
  assert.ok(d.headers.includes('COL NO'));
  assert.ok(d.headers.includes('REGION'));
  assert.equal(d.headers.length, d.rows[0].length, 'every header has a cell under it');

  // THE ROUND TRIP: what came out goes back in and nothing is lost.
  const { importTeams } = await import('../api/_lib/importers.js');
  const back = importTeams([d.headers].concat(d.rows))[0];
  assert.equal(back.team, 'KONGOWE');
  assert.equal(back.region, 'DAR');
  assert.equal(back.collection, 'CATHERINE');
  assert.equal(back.legal, 'LEGAL L');
  assert.equal(back.credit_id, 'CA9');
  for (const k of ['recovery_no', 'gmo_no', 'manager_no', 'expected_no', 'bike_no', 'legal_no', 'collection_no']) {
    assert.ok(back[k], k + ' was lost on the way back');
  }
});

test('only an admin may download the leaders sheet', async () => {
  await assert.rejects(() => portalApi(fakeDb(tables()), GMO, 'teamsExport', {}, NOW),
    e => e.status === 403);
});

/* =====================================================================================
   COUNT 1-6 SHOWS THE GUARANTOR.
   =====================================================================================
   "Count 1-6 (payments brlow 6 full payments) at credit analyst aint showing guarantors"
   It is a list built for RINGING PEOPLE, and the number you ring when the customer does not
   answer was the one column not on it.
*/
test('the Count 1-6 list carries the guarantor and their number', async () => {
  const d = await portalApi(fakeDb(tables()), ADMIN, 'credit', {}, NOW);
  assert.ok(d.portfolio.length > 0, 'the fixture has customers under the threshold');
  const withG = d.portfolio.filter(p => p.guarantor_name || p.guarantor_contact);
  assert.ok(withG.length > 0, 'at least one carries a guarantor');
  for (const p of d.portfolio) {
    assert.notEqual(p.guarantor_name, undefined, p.ref + ' has no guarantor field at all');
    assert.notEqual(p.guarantor_contact, undefined, p.ref + ' has no guarantor number field');
  }
});

/* =====================================================================================
   THE HOUSEKEEPING IS THE SYSTEM'S ACT, NOT THE UPLOADER'S.
   =====================================================================================
   Uploading requires the `upload` tab; the sweep and the retire rule require `settings`.
   Somebody granted upload-only would have had the automatic tidying refused with a 403 that
   the fire-and-forget catch swallows -- silently doing nothing, for ever. That is the exact
   failure shape that has already cost two rounds of this, so it gets a test of its own.

   The actor is built on the server and never from the request: it keeps the real person's name
   and code so the audit log still says who was at the keyboard, and carries the permission
   because THE SYSTEM is what decided to tidy up.
*/
test('an upload-only user cannot sweep on their own account', async () => {
  const db = fakeDb(DUP_BOOK());
  const uploader = { code: 'U', name: 'THE UPLOADER', role: 'CLERK', teams: null, tabs: ['upload'] };
  await assert.rejects(() => portalApi(db, uploader, 'purgeSuperseded', { confirm: true }, NOW),
    e => e.status === 403, 'which is right -- asking for it by hand is an admin act');
  await assert.rejects(() => portalApi(db, uploader, 'followupClean', { days: 1, confirm: true }, NOW),
    e => e.status === 403);
});

test('the same user, as the system tidies up after their upload, succeeds', async () => {
  /* Exactly the object api/upload.js builds: their identity, the system's permission. */
  const db = fakeDb(DUP_BOOK());
  const housekeeper = { code: 'U', name: 'THE UPLOADER', role: 'CLERK',
    teams: null, tabs: ['upload', 'settings'] };
  const r = await portalApi(db, housekeeper, 'purgeSuperseded',
    { confirm: true, keep: 2, to: TODAY, days: 1, limit: 200 }, NOW);
  assert.equal(r.deletedBatches, 1, 'the third copy of the day goes, two are kept');
  assert.deepEqual([...new Set(db._dump('repayment_snapshots').map(x => x.upload_batch))].sort(),
    ['b09', 'b10']);
});

test('the audit log still names the person, not "the system"', async () => {
  /* The permission is the system's; the name has to stay theirs, or the log answers "who did
     this" with a word nobody can go and ask. */
  const book = DUP_BOOK();
  book.audit_log = [];
  const db = fakeDb(book);
  const housekeeper = { code: 'U', name: 'THE UPLOADER', role: 'CLERK',
    teams: null, tabs: ['upload', 'settings'] };
  await portalApi(db, housekeeper, 'purgeSuperseded', { confirm: true, to: TODAY }, NOW);
  const entry = db._dump('audit_log').find(a => a.action === 'purgeSuperseded');
  assert.ok(entry, 'a destructive act is always recorded');
  assert.equal(entry.actor_name, 'THE UPLOADER');
  assert.equal(entry.actor_code, 'U');
});
