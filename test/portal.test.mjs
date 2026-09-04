// The portal backend: every tab's function against the mutation-capable fake PostgREST,
// with team scoping checked on the tabs where getting it wrong would leak another team's
// customers. Clock pinned to Friday 2026-07-24 noon EAT.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fakeDb } from './fake-db.mjs';
/* The two aggregates from db/migrations/2026-08-10-upload-status.sql. They replaced four
   unbounded whole-table reads on the upload page; `db()` below is a database that HAS them,
   and a plain fakeDb(tables()) is one that does not -- both states are exercised. */
import { UPLOAD_STATUS_RPC, SNAPSHOT_TOTALS_RPC } from './snapshot-totals-rpc.mjs';
/* A database that HAS the migrations -- which now includes the team-day totals function, because
   the defaulter book asks it which date each team's own latest deck is on. A plain fakeDb() is
   still the un-migrated world, and several tests use it deliberately. */
const dbWithRpc = t => fakeDb(t || tables(), { rpc: { ...SNAPSHOT_TOTALS_RPC, ...UPLOAD_STATUS_RPC } });

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi, PORTAL_FUNCTIONS, assignFor } = await import('../api/_lib/portal-core.js');
// The announcement is READ without an access code -- it has to reach the sign-in screen -- so
// it lives on the calls door beside the brand. Both sides are checked here, together, because
// what one writes the other must be willing to show.
const { callApi } = await import('../api/_lib/call-core.js');

/* The ordinary screens' tab ids, from the one place that names them, so a fixture's grant
   cannot drift away from what the system actually offers. */
const { USER_TABS } = await import('../api/_lib/auth.js');
const { todayKey: todayKeyOf } = await import('../api/_lib/time.js');
const NOW = Date.parse('2026-07-24T09:00:00Z');            // Friday noon EAT
const TODAY = '2026-07-24', YEST = '2026-07-23', MON = '2026-07-20';
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] };
/* GRANTED, EXPLICITLY, because the blanket is gone. These tests are about TEAM SCOPING --
   an officer seeing only their own rows -- and they used to lean on every screen being open
   to everybody. The screens are now open because a role was ticked for them, which is the
   state a real officer is in once the admin has set them up, and the scoping question is
   unchanged: holding the tab is not holding the company's data. */
const GMO = { code: 'G', name: 'JUMA G', role: 'GMO', teams: ['KONGOWE'], tabs: USER_TABS.slice() };

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
  // '' at both ends is "no window" -- the whole pipeline, which is what this test is about.
  const d = await run('loans', { stage: 'approved', from: '', to: '' });
  assert.equal(d.count, 2);
  assert.equal(d.amount, 500000);
  /* THE STRIP IS THIS MONTH'S PROGRESS. The base fixture's loans carry no date at all, so none
     of them belongs to any month -- which is exactly the case the undated count exists to
     report rather than hide. */
  const p = await run('loanPipeline');
  assert.equal(p.total, 0);
  assert.equal(p.undated, 4, 'said, not silently dropped');
  assert.equal(p.allTime, 4, 'and the whole book is still reported beside the month');
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
  const boss = { code: 'B', name: 'BOSS', role: 'GMO', teams: ['KONGOWE'], tabs: USER_TABS.slice() };
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

/* =====================================================================================
   BRANCH RIDES ALONG, ON EVERY REPORT THIS PASS COULD REACH.
   =====================================================================================
     "The branches column is in all reports just before the team column"
   One representative per shape: a per-customer list (followup), a per-team summary
   (dashboardFull), and a customer-service register (complaints). All three read the same
   branchByTeam() lookup, so proving it here is proving the lookup, not each call site. */
test('followup and dashboardFull carry branch, straight off the teams table', async () => {
  const t = tables();
  t.teams[0].branch = 'KIBAHA-KONGOWE';   // KONGOWE
  // MBAGALA's branch is left unset on purpose -- null, not a crash, not "(no team)".
  const db = fakeDb(t);

  const fu = await portalApi(db, ADMIN, 'followup', {}, NOW);
  const kongoweRow = fu.rows.find(r => r.team === 'KONGOWE');
  assert.equal(kongoweRow.branch, 'KIBAHA-KONGOWE');

  const dash = await portalApi(db, ADMIN, 'dashboardFull', {}, NOW);
  const kongoweTeam = dash.teamPerf.find(r => r.team === 'KONGOWE');
  assert.equal(kongoweTeam.branch, 'KIBAHA-KONGOWE');
});

test('a team with no branch set yet reads null, not a crash', async () => {
  const d = await run('followup');   // tables()'s default fixture never sets .branch
  assert.ok(d.rows.length, 'the fixture has rows to check');
  for (const r of d.rows) assert.equal(r.branch, null);
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
  // A bare comment keeps the standing status -- same rule as the calls app: writing
  // fu_status: null over it blanked the chip on the phone's card and got customers re-rung.
  await portalApi(db, ADMIN, 'addComment', { ref: '999', comment: 'bado anafuatiliwa' }, NOW);
  const st2 = db._dump('followup_status').find(x => x.ref === '999');
  assert.equal(st2.fu_status, 'ANALIPA LEO');
  assert.equal(st2.last_comment, 'bado anafuatiliwa');
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

/* THE WEEKLY REPORT WAS HANDING OUT EVERY TEAM'S SIGN-IN CODE.
   `teamRows` went out as readTeamsAll() returns it: every team in the company, every column,
   to anybody who could open the report. The scope alone was wrong -- no other screen shows an
   officer another team's leaders -- but `team_code` is the real fault. That is the credential a
   field officer types to register a handset onto a team, and the Teams screen says in as many
   words to change it the moment it leaks. Inside an ordinary weekly report, any officer could
   read every other team's code out of the response and enrol a phone on that team, which hands
   them that team's entire customer book. The report only ever needed the leader NAMES. */
test('the weekly report never ships another team\'s leaders, and never ships a sign-in code', async () => {
  const t = tables();
  // Give both teams a sign-in code, so its absence below is a real assertion.
  for (const row of t.teams) row.team_code = 'CODE-' + row.team;

  const mine = await portalApi(fakeDb(t), GMO, 'weekly', {}, NOW);   // GMO holds KONGOWE only
  assert.ok(mine.teamRows.length, 'the leader columns are still there to stamp');
  assert.ok(mine.teamRows.every(r => r.team === 'KONGOWE'), 'and only for the team they hold');
  for (const r of mine.teamRows) {
    assert.equal(r.team_code, undefined, 'the sign-in code must never travel in a report');
  }

  // An admin sees every team -- and still gets no codes, because no report needs one.
  const all = await portalApi(fakeDb(t), ADMIN, 'weekly', {}, NOW);
  assert.ok(all.teamRows.length > mine.teamRows.length, 'an admin sees more teams');
  for (const r of all.teamRows) assert.equal(r.team_code, undefined);
  // The whole point of teamRows survives: the leader names are what a hand-stamp records.
  assert.ok(all.teamRows.some(r => r.gmo || r.manager || r.bike), 'leader names still present');
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
  // 3, not 2: l3 (stage 'disbursed', approved 2026-07-20, within Mon-Fri) is a genuine sale
  // that had already moved past 'approved' by the time this reads it -- "sales ... aint
  // reflecting okay", the bug SALES_STAGES fixes. l1 and l2 (still at 'approved') count as
  // before; only l4 (never reached approval) sits out.
  assert.equal(d.totals.salesCount, 3);
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
  /* THE WEEKLY % ON THE COMBINED TABLE -- "have a last colomn of their weekly performance
     percentage". JUMA's observed books entered the week holding 500 + 700 = 1,200 and he
     recovered 300: rec % = 25. */
  const juWeek = d.week.find(r => r.officer === 'JUMA G');
  assert.equal(juWeek.pct, 25, 'rec % = recovered over what the observed books held entering the range');

  /* TODAY BY BAND -- "how much each person earned from each disb year band in that days
     rec". Status mode here, so the band is the status; both of today's drops are Defaulter
     rows, so one DEFAULTER column carries the whole day. */
  assert.deepEqual(d.recBands.bands, ['DEFAULTER']);
  const jb = d.recBands.rows.find(r => r.officer === 'JUMA G');
  assert.equal(jb.rec_DEFAULTER, 300, 'the band carries today\'s recovered amount');
  assert.equal(jb.tzs_DEFAULTER, 30, 'and what it earned at that band\'s rate');
  assert.equal(jb.total, 30);

  /* Early collection: the fixture has only a TODAY sheet, and the early scheme reads the
     INITIAL file ONLY -- "its initial file only no other fallback". No initial, no pay. */
  assert.equal(d.day.find(r => r.officer === 'EARLY E'), undefined,
    'no INITIAL file means no early pay -- the today sheet is never a fallback');
  assert.equal(d.totals.recovered, 400);

  /* THE INDEPENDENT BOARDS. "early col and rec should also be independent tables" -- the
     recovery officer's amounts and pay day by day, the early officer's col % and PAID+OVER
     count day by day, each on its own board and agreeing with the combined figures above. */
  const recJuma = d.recBoard.find(r => r.officer === 'JUMA G');
  assert.ok(recJuma, 'the recovery officer has their own board row');
  assert.equal(recJuma.weekRecovered, 300);
  assert.equal(recJuma.weekCommission, 30);
  assert.ok(Array.isArray(recJuma.days) && recJuma.days.length >= 1, 'day-by-day record rides along');
  assert.equal(recJuma.days.reduce((s, x) => s + x.recovered, 0), 300, 'the days add up to the week');
  assert.equal(d.colBoard.find(r => r.officer === 'EARLY E'), undefined,
    'the early board stays empty without the initial file -- never filled off the today sheet');

  /* "early collection aint reading from initial file on commissions ... its initial file
     only no other fallback" -- the early scheme is judged on the day's INITIAL expected
     sheet and on nothing else: initial col % and the PAID+OVERPAID counted there. */
  const t2 = tables();
  t2.repayment_snapshots.push(
    E('881', 'KONGOWE', 1000, 'PAID', 0, TODAY, 'initial'),
    E('882', 'KONGOWE', 1000, 'PAID', 0, TODAY, 'initial'),
    E('883', 'KONGOWE', 1000, 'OVERPAID', 0, TODAY, 'initial'),
    E('884', 'KONGOWE', 1000, 'UNPAID', 0, TODAY, 'initial'),
  );
  const d2 = await portalApi(dbWithRpc(t2), ADMIN, 'commission', {}, NOW);
  const e2 = d2.colBoard.find(r => r.officer === 'EARLY E');
  assert.ok(e2, 'the early officer is on the board');
  assert.equal(e2.weekN, 3, 'PAID+OVERPAID counted from the INITIAL sheet (2 paid + 1 over), not the today sheet\'s 1');
  assert.equal(e2.weekCommission, 2 * 1000 + 1 * 1500, 'paid at the flat rates off the initial counts');

  /* "aint seeing todays col expected people on orodha" -- an officer whose initial book was
     EXPECTED today sits on the combined table even before a single PAID lands. */
  const t3 = tables();
  t3.repayment_snapshots.push(E('885', 'KONGOWE', 1000, 'UNPAID', 0, TODAY, 'initial'));
  const d3 = await portalApi(dbWithRpc(t3), ADMIN, 'commission', {}, NOW);
  const e3 = d3.week.find(r => r.officer === 'EARLY E');
  assert.ok(e3, 'expected-but-unpaid still puts the officer on the combined table');
  assert.equal(e3.colComm, 0, 'with zero pay until a PAID lands');

  /* THE MONTH RECORD behind the blinking dot: the same walk from the month's first day.
     NOW's week sits inside its own month here, so the month figures must carry at least the
     week's -- and the scope must say what range it covered. */
  const m = await run('commission', { scope: 'month' });
  assert.equal(m.scope, 'month');
  assert.equal(m.from, TODAY.slice(0, 7) + '-01');
  const mRec = m.recBoard.find(r => r.officer === 'JUMA G');
  assert.ok(mRec && mRec.weekRecovered >= 300, 'the month record carries the week it contains');
  assert.ok(m.totals.week >= d.totals.week, 'month-to-date pay is never less than this week\'s');
});

/* THE ZERO-RECOVERY MONDAY. Live, with 532 customers genuinely dropped: the board read zero.
   Two causes, either alone enough: the 'current' baseline used the working list's whole-table
   pin (only the last-uploaded weekday's deck came back, every other book got an empty
   baseline), and the initial book's 45-day lookback silently dropped books whose initial deck
   is older -- which is most of them, since an initial is drawn up at cycle start. The
   commission walk now asks for perBook baselines: each team-and-weekday book brought forward
   by ITS OWN last current, over a lookback long enough for real cycles. */
test('commission baseline: each book is brought forward by its own last current, however old the initial', async () => {
  const t = tables();
  t.defaulter_snapshots.push(
    // The MON book: initial drawn up 100+ days ago -- outside the old 45-day window.
    { ref: 'M1', team: 'KONGOWE', full_name: 'MON GUY', arrears: 1000, status: 'Defaulter', disb_date: '2024-05-01',
      snapshot_type: 'initial', weekday: 'MON', snapshot_date: '2026-04-06', upload_batch: 'im', created_at: '2026-04-06T04:00:00Z' },
    // Its own last current: LAST week's Monday, 800 still owed.
    { ref: 'M1', team: 'KONGOWE', arrears: 800,
      snapshot_type: 'current', weekday: 'MON', snapshot_date: '2026-07-13', upload_batch: 'cm1', created_at: '2026-07-13T04:00:00Z' },
    // The table-wide NEWEST current before this week is a different weekday's deck -- the
    // whole-table pin returned only this and starved every other book's baseline.
    { ref: 'S1', team: 'KONGOWE', arrears: 50,
      snapshot_type: 'current', weekday: 'SUN', snapshot_date: '2026-07-19', upload_batch: 'cs', created_at: '2026-07-19T04:00:00Z' },
    // THIS week's Monday deck: M1 dropped 800 -> 500.
    { ref: 'M1', team: 'KONGOWE', full_name: 'MON GUY', arrears: 500, status: 'Defaulter', disb_date: '2024-05-01',
      snapshot_type: 'current', weekday: 'MON', snapshot_date: '2026-07-20', upload_batch: 'cm2', created_at: '2026-07-20T04:00:00Z' },
  );
  const d = await portalApi(dbWithRpc(t), ADMIN, 'commission', {}, NOW);
  const juma = d.recBoard.find(r => r.officer === 'JUMA G');
  assert.ok(juma, 'the recovery officer appears on the board');
  const monday = (juma.days || []).find(x => x.date === '2026-07-20');
  assert.ok(monday, 'Monday was observed');
  assert.equal(monday.recovered, 300,
    '800 -> 500 against the book\'s OWN last current pays 300 -- not zero (starved baseline) and not 500 (initial-based)');
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

  /* One uploaded row, plus one the system now works out for itself: the fixture's 900/= is not
     a whole multiple of 500, so it is flagged where before nothing was. */
  const ab = await portalApi(db, ADMIN, 'abnormal', {}, NOW);
  assert.equal(ab.uploaded, 1);
  assert.equal(ab.derived, 1);
  assert.equal(ab.count, 2);
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
  // l1 (approved, 300000) + l3 (disbursed, 100000) -- both are ANALYST A's KONGOWE sales;
  // l3 does not stop being one just because it has since moved past 'approved' (SALES_STAGES).
  assert.equal(a.sales, 400000);
  // MBAGALA names no analyst, so its 999 lands on (unassigned) rather than vanishing.
  assert.equal(d.rows.find(r => r.analyst === '(unassigned)').cnt, 1);
  // The portfolio is the daily call list, built from TODAY's deck, not Monday's.
  assert.equal(d.portfolio.length, 3);
  assert.equal(d.portfolio.every(p => p.state === 'Reduced'), true);
});

test('sms export: defaulters only, deduplicated, in the fixed 6-column shape', async () => {
  const d = await run('smsExport', { audience: 'defaulters' });
  assert.equal(d.audience, 'defaulters');
  assert.deepEqual(d.headers, ['Contact No', 'Contact Person', 'Team', 'Ref No', 'Arrears', 'HOPE Phone No']);
  // Today's current defaulter book: 111 and 555 (KONGOWE), 999 (MBAGALA) -- one row each.
  assert.equal(d.count, 3);
  const refs = d.rows.map(r => r[3]).sort();
  assert.deepEqual(refs, ['111', '555', '999']);
  const r111 = d.rows.find(r => r[3] === '111');
  assert.equal(r111[0], '07140000111');   // Contact No -- the customer's own phone
  assert.equal(r111[1], 'C111');          // Contact Person
  assert.equal(r111[2], 'KONGOWE');       // Team
  // Arrears rounded UP to the nearest 500 for the SMS text -- "our customers aint demanded
  // decimals" -- 300 reads as 500, the same roundUp500 a demand notice already uses.
  assert.equal(r111[4], 500);
});

test('sms export: arrears are rounded UP to the nearest 500, never left exact', async () => {
  const t = tables();
  const snaps = t.defaulter_snapshots;
  snaps[snaps.findIndex(r => r.ref === '111' && r.snapshot_type === 'current')].arrears = 45333;
  snaps[snaps.findIndex(r => r.ref === '555' && r.snapshot_type === 'current')].arrears = 67800;
  snaps[snaps.findIndex(r => r.ref === '999' && r.snapshot_type === 'current')].arrears = 50000;
  const d = await portalApi(dbWithRpc(t), ADMIN, 'smsExport', { audience: 'defaulters' }, NOW);
  assert.equal(d.rows.find(r => r[3] === '111')[4], 45500);
  assert.equal(d.rows.find(r => r[3] === '555')[4], 68000);
  assert.equal(d.rows.find(r => r[3] === '999')[4], 50000);   // already an exact multiple -- left alone
});

test('sms export: carries its own .gaps, so the Upload page never has to fetch the book twice', async () => {
  // The 504 that came out of the first cut of this was smsGaps and smsExport each doing their
  // own full defaulter-book fetch back to back for a single download -- see smsBuild_'s own
  // comment in portal-core.js. Locking in that smsExport's response IS the gap report too, not
  // a second round trip's worth, is what keeps that regression from creeping back in.
  const t = tables();
  const d = await portalApi(dbWithRpc(t), ADMIN, 'smsExport', { audience: 'defaulters' }, NOW);
  const g = await portalApi(dbWithRpc(tables()), ADMIN, 'smsGaps', { audience: 'defaulters' }, NOW);
  assert.ok(d.gaps, 'smsExport response carries a .gaps field');
  assert.equal(d.gaps.pmoNeeded, g.pmoNeeded);
  assert.equal(d.gaps.count, g.count);
  assert.deepEqual(d.gaps.teamGaps.map(x => x.team + '|' + x.role).sort(),
    g.teamGaps.map(x => x.team + '|' + x.role).sort());
});

test('sms export: carries buckets + teamPhones too, so a gap-fill save never re-fetches the book', async () => {
  // "Save & download" used to call smsExport a SECOND time after saving new numbers -- a fresh
  // request paying for the whole defaulter book again, which is exactly what "error 504" came
  // back from the moment someone actually used the gap-fill form. The fix moves the final HOPE
  // Phone resolution to the browser: it needs, per row, which fallback CHAIN it belongs to
  // (an index into the four fixed chains) and the raw phone columns of every team involved --
  // both of which this locks in the shape of.
  const t = tables();
  t.teams[0].credit_no = '0711000CR';
  const d = await portalApi(dbWithRpc(t), ADMIN, 'smsExport', { audience: 'defaulters' }, NOW);
  assert.equal(d.buckets.length, d.rows.length, 'one bucket index per row, same order');
  // 111 and 555 are KONGOWE, paid < 6 -> bucket 0 (credit chain).
  const i111 = d.rows.findIndex(r => r[3] === '111');
  assert.equal(d.buckets[i111], 0);
  assert.deepEqual(d.teamPhones.KONGOWE, { credit_no: '0711000CR' });   // the raw value on file, un-resolved
  assert.equal(d.pmo, '');
  // MBAGALA has no numbers on file at all -- still present, just an empty slot, not missing.
  assert.deepEqual(d.teamPhones.MBAGALA, {});
});

test('sms export: 1-6 goes to the credit analyst, the rest to the team\'s OWN recovery officer', async () => {
  const t = tables();
  t.teams[0].credit_no = '0711000CR';                              // KONGOWE's credit analyst
  t.teams[1].recovery_no = '0722000RC';                            // MBAGALA's OWN recovery officer
  t.settings.push({ key: 'PMO_RECOVERY_NO', value: '0700000PMO' }); // must NOT win over a team that has one
  // 999 (MBAGALA) is pushed past count 1-6.
  const snaps = t.defaulter_snapshots;
  const i999 = snaps.findIndex(r => r.ref === '999' && r.snapshot_type === 'current');
  snaps[i999] = { ...snaps[i999], ds: '9/12' };
  const d = await portalApi(dbWithRpc(t), ADMIN, 'smsExport', { audience: 'defaulters' }, NOW);
  assert.equal(d.rows.find(r => r[3] === '111')[5], '0711000CR');   // 1-6, KONGOWE -> credit analyst
  assert.equal(d.rows.find(r => r[3] === '555')[5], '0711000CR');
  // past 1-6 -> MBAGALA's OWN recovery officer -- "not first, there is no company wide, each
  // team must have one" -- PMO_RECOVERY_NO is set here too, and must lose to the team's own.
  assert.equal(d.rows.find(r => r[3] === '999')[5], '0722000RC');
});

test('sms export: rest bucket falls to the team\'s COLLECTION officer when it has no recovery officer', async () => {
  const t = tables();
  t.teams[1].collection_no = '0722000CO';   // MBAGALA has a collection officer but no recovery officer
  const snaps = t.defaulter_snapshots;
  const i999 = snaps.findIndex(r => r.ref === '999' && r.snapshot_type === 'current');
  snaps[i999] = { ...snaps[i999], ds: '9/12' };
  const d = await portalApi(dbWithRpc(t), ADMIN, 'smsExport', { audience: 'defaulters' }, NOW);
  // "if no recovery officer at all default to collection officer" -- tried before PMO, not after.
  assert.equal(d.rows.find(r => r[3] === '999')[5], '0722000CO');
});

test('sms export: only once a team has NEITHER recovery NOR collection does a row reach PMO recovery', async () => {
  const t = tables();
  t.settings.push({ key: 'PMO_RECOVERY_NO', value: '0700000PMO' });
  const snaps = t.defaulter_snapshots;
  const i999 = snaps.findIndex(r => r.ref === '999' && r.snapshot_type === 'current');
  snaps[i999] = { ...snaps[i999], ds: '9/12' };
  // MBAGALA has neither recovery_no nor collection_no on file at all.
  const d = await portalApi(dbWithRpc(t), ADMIN, 'smsExport', { audience: 'defaulters' }, NOW);
  assert.equal(d.rows.find(r => r[3] === '999')[5], '0700000PMO');
});

test('sms export: a team missing its own credit number still falls to PMO recovery, not a blank cell', async () => {
  const t = tables();
  t.settings.push({ key: 'PMO_RECOVERY_NO', value: '0700000PMO' });
  // KONGOWE has a credit ANALYST name but no credit_no column value -- the winnable branch
  // still has to name somebody.
  const d = await portalApi(dbWithRpc(t), ADMIN, 'smsExport', { audience: 'defaulters' }, NOW);
  assert.equal(d.rows.find(r => r[3] === '111')[5], '0700000PMO');
});

test('sms export: full portfolio appends this week\'s Expected after Defaulters, deduplicated by ref', async () => {
  const t = tables();
  t.teams[0].expected_no = '0711000EC';       // KONGOWE early collection officer
  t.teams[0].collection_no = '0711000CO';     // (unused here -- MBAGALA has neither)
  t.settings.push({ key: 'PMO_RECOVERY_NO', value: '0700000PMO' });
  t.repayment_snapshots.push(
    // 444 is new -- not a defaulter -- 1-6, KONGOWE -> the early collection officer.
    { ...E('444', 'KONGOWE', 1000, 'UNPAID', 300, '2026-07-21'), due_summary: '2/6' },
    // 888 is new too, past 1-6, MBAGALA has no collection officer -> PMO recovery.
    { ...E('888', 'MBAGALA', 1000, 'UNPAID', 400, '2026-07-22'), due_summary: '9/12' },
    // 111 is ALREADY a defaulter -- must not appear a second time.
    { ...E('111', 'KONGOWE', 1000, 'UNPAID', 999, '2026-07-23') },
  );
  const d = await portalApi(dbWithRpc(t), ADMIN, 'smsExport', { audience: 'portfolio' }, NOW);
  assert.equal(d.audience, 'portfolio');
  const refs = d.rows.map(r => r[3]);
  assert.equal(refs.filter(r => r === '111').length, 1);            // no duplicate
  assert.equal(refs.filter(r => r === '444' || r === '888').length, 2);
  // Defaulters lead, Expected-only trail -- "beginning with defaulters and ending with expected".
  assert.ok(refs.indexOf('999') < refs.indexOf('444'));
  const r444 = d.rows.find(r => r[3] === '444');
  assert.equal(r444[4], 500);                 // arrears carried from the Expected row, rounded up to 500
  assert.equal(r444[5], '0711000EC');         // 1-6 -> early collection
  assert.equal(d.rows.find(r => r[3] === '888')[5], '0700000PMO');  // past 1-6, no collection officer -> PMO
  // 'defaulters' audience never reads the week's Expected at all.
  const defOnly = await portalApi(dbWithRpc(t), ADMIN, 'smsExport', { audience: 'defaulters' }, NOW);
  assert.equal(defOnly.rows.some(r => r[3] === '444'), false);
});

test('sms gaps: flags a team with no number on file for the role its defaulters need', async () => {
  const t = tables();
  // Neither team has a credit_no, and both KONGOWE's 111/555 and MBAGALA's 999 default to
  // paid < 6 (the D() fixture's "3-6" ds does not match the N/M regex, so paidCount falls to
  // 0) -- so all three route to 'credit'. PMO_RECOVERY_NO is not set either, so these rows
  // would genuinely render a blank cell right now -- pmoNeeded says so.
  const d = await portalApi(dbWithRpc(t), ADMIN, 'smsGaps', { audience: 'defaulters' }, NOW);
  assert.equal(d.pmoNeeded, true);
  assert.equal(d.teamGaps.length, 2);
  const kongowe = d.teamGaps.find(g => g.team === 'KONGOWE');
  assert.equal(kongowe.role, 'credit');
  assert.equal(kongowe.roleLabel, 'Credit Analyst');
  assert.equal(kongowe.phoneField, 'credit_no');
  assert.equal(kongowe.name, 'ANALYST A');            // the name already on file, for a prefill
  const mbagala = d.teamGaps.find(g => g.team === 'MBAGALA');
  assert.equal(mbagala.role, 'credit');
  assert.equal(mbagala.name, '');                     // no analyst named at all
  assert.equal(d.count, 3);                           // 2 team gaps + PMO Recovery No itself
});

test('sms gaps: a team that already has the number is not a gap', async () => {
  const t = tables();
  t.teams[0].credit_no = '0711000CR';
  const d = await portalApi(dbWithRpc(t), ADMIN, 'smsGaps', { audience: 'defaulters' }, NOW);
  assert.equal(d.teamGaps.some(g => g.team === 'KONGOWE'), false);
  assert.equal(d.teamGaps.some(g => g.team === 'MBAGALA'), true);   // MBAGALA still has none
});

test('sms gaps: the "rest" bucket asks for a RECOVERY OFFICER per team, not one company setting', async () => {
  const t = tables();
  // Push both KONGOWE defaulters and MBAGALA's past count 1-6. Neither team has a recovery_no
  // or a collection_no on file, and PMO_RECOVERY_NO is not set either -- "each team must have
  // one" means this is now a gap on EVERY team that needs the rest bucket, not one shared blank.
  for (const r of t.defaulter_snapshots) if (r.snapshot_type === 'current') r.ds = '9/12';
  const d = await portalApi(dbWithRpc(t), ADMIN, 'smsGaps', { audience: 'defaulters' }, NOW);
  assert.equal(d.teamGaps.length, 2);
  assert.ok(d.teamGaps.every(g => g.role === 'recovery'), 'the primary ask is the recovery officer, not collection');
  assert.equal(d.teamGaps.find(g => g.team === 'KONGOWE').name, 'JUMA G');   // KONGOWE's recovery is named
  assert.equal(d.teamGaps.find(g => g.team === 'MBAGALA').name, '');
  // Still nobody's last resort -- PMO_RECOVERY_NO itself is unset, so a team with nothing at
  // all filled in would still land on a blank cell without it.
  assert.equal(d.pmoNeeded, true);
  assert.equal(d.count, 3);
});

test('sms gaps: a team with EITHER a recovery or a collection officer on file is not a gap', async () => {
  const t = tables();
  for (const r of t.defaulter_snapshots) if (r.snapshot_type === 'current') r.ds = '9/12';
  t.teams[0].recovery_no = '0711000RC';       // KONGOWE covered via recovery
  t.teams[1].collection_no = '0722000CO';     // MBAGALA covered via collection, no recovery officer
  const d = await portalApi(dbWithRpc(t), ADMIN, 'smsGaps', { audience: 'defaulters' }, NOW);
  assert.equal(d.teamGaps.length, 0);
  assert.equal(d.pmoNeeded, false);
});

test('sms gaps: saving the number through saveTeam clears the gap on the next check', async () => {
  const t = tables();
  // saveTeam drops a column no fetched row carries at all, on the assumption the migration
  // that added it has not been run yet (see TEAM_OPTIONAL_COLS in portal-core.js) -- a blank
  // credit_no on file, like a real post-migration database has, is what lets the save land.
  t.teams[0].credit_no = null;
  const db = dbWithRpc(t);
  const before = await portalApi(db, ADMIN, 'smsGaps', { audience: 'defaulters' }, NOW);
  assert.equal(before.teamGaps.some(g => g.team === 'KONGOWE'), true);
  // saveTeam runs every phone number through the same pnorm() the leaders sheet and the phone
  // search use -- leading zero and 255 stripped, nine digits left -- so what comes back out is
  // not the literal string typed in, same as a real save through the Teams & Staff form.
  await portalApi(db, ADMIN, 'saveTeam', { team: 'KONGOWE', credit_no: '0711000001' }, NOW);
  const after = await portalApi(db, ADMIN, 'smsGaps', { audience: 'defaulters' }, NOW);
  assert.equal(after.teamGaps.some(g => g.team === 'KONGOWE'), false);
  // Downloading now actually carries the number just saved, not a stale PMO fallback.
  const exp = await portalApi(db, ADMIN, 'smsExport', { audience: 'defaulters' }, NOW);
  assert.equal(exp.rows.find(r => r[3] === '111')[5], '711000001');
});

test('sms gaps: the portfolio audience also checks the expected/collection roles Expected-only rows need', async () => {
  const t = tables();
  t.repayment_snapshots.push(
    { ...E('444', 'KONGOWE', 1000, 'UNPAID', 300, '2026-07-21'), due_summary: '2/6' },   // winnable -> expected
    { ...E('888', 'MBAGALA', 1000, 'UNPAID', 400, '2026-07-22'), due_summary: '9/12' },  // rest -> collection
  );
  const d = await portalApi(dbWithRpc(t), ADMIN, 'smsGaps', { audience: 'portfolio' }, NOW);
  const kongoweExp = d.teamGaps.find(g => g.team === 'KONGOWE' && g.role === 'expected');
  assert.ok(kongoweExp, 'KONGOWE has no expected_no on file, so this is a gap');
  assert.equal(kongoweExp.name, 'EARLY E');           // the early collection officer's name
  const mbagalaCol = d.teamGaps.find(g => g.team === 'MBAGALA' && g.role === 'collection');
  assert.ok(mbagalaCol, 'MBAGALA has no collection officer at all');
  // 'defaulters' audience never looks at Expected, so it must not surface these two.
  const defOnly = await portalApi(dbWithRpc(t), ADMIN, 'smsGaps', { audience: 'defaulters' }, NOW);
  assert.equal(defOnly.teamGaps.some(g => g.role === 'expected' || g.role === 'collection'), false);
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

test('call report carries branch on both the by-team board and the officer table', async () => {
  const t = tables();
  t.teams[0].branch = 'KIBAHA-KONGOWE';   // KONGOWE
  const d = await portalApi(fakeDb(t), ADMIN, 'callReport', { from: TODAY, to: TODAY }, NOW);
  const teamRow = d.teams.find(x => x.team === 'KONGOWE');
  assert.equal(teamRow.branch, 'KIBAHA-KONGOWE');
  const officer = d.users.find(u => u.team === 'KONGOWE');
  assert.equal(officer.branch, 'KIBAHA-KONGOWE');
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

/* Stands in for storage_usage_by_date(): the same GROUP BY, done in JavaScript over the fake.
   `countFnOver` takes the list of sources the simulated function KNOWS, because a live database
   can be running any vintage of it -- the current one that answers for everything, or an older
   one that has never heard of the loan pipeline. */
const STORAGE_SRC_ALL = [
  ['expected', 'repayment_snapshots', 'snapshot_date'],
  ['defaulters', 'defaulter_snapshots', 'snapshot_date'],
  ['received', 'received_payments', 'paid_at'],
  ['abnormal', 'abnormal_payments', 'created_at'],
  ['calls', 'call_logs', 'call_date'],
  ['loans', 'loans', 'upload_date'],
  ['comments', 'followup_comments', 'created_at'],
  ['complaints', 'complaints', 'created_at'],
  ['restructures', 'restructures', 'created_at'],
  ['demand_notices', 'demand_notices', 'created_at'],
  ['followup', 'followup_status', 'updated_at'],
];
const countFnOver = (src) => (store) => {
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
const storageDb = (t, fn) => fakeDb(t || tables(), { rpc: { storage_usage_by_date: fn } });

test('storage usage reports what each date costs, per report type', async () => {
  const d = await portalApi(storageDb(null, countFnOver(STORAGE_SRC_ALL)), ADMIN, 'storageUsage', {}, NOW);
  assert.ok(d.totalRows > 0);
  const today = d.dates.find(x => x.date === TODAY);
  assert.equal(today.expected, 3);            // 3 rows uploaded for today
  assert.equal(today.defaulters, 6);          // 3 initial + 3 current
  assert.equal(d.newest, TODAY);
  assert.equal(d.undated, undefined);         // the function answered for everything
  // Only an admin may see (or act on) the storage picture.
  await assert.rejects(() => run('storageUsage', {}, GMO), e => e.status === 403);
});

/* The Settings tab used to download every row of ten tables just to count them -- millions of
   rows, over the internet, to work out a number Postgres already knew. On the night the
   database was already struggling, that fallback was itself a large part of the struggle: one
   open of Settings re-downloaded the very tables it was measuring. So the old way is GONE.
   Where the function is missing or behind, the app asks each table for its count alone -- a
   HEAD request, a number and no rows -- and says plainly which reports have no day-by-day
   split rather than showing a quieter board than the totals imply. */
test('storage counts: sources the function does not answer for are head-counted, never fetched', async () => {
  /* An OLDER vintage of the function: knows the original five reports only. The app must
     head-count the other six and arrive at the same totals the full function reports. */
  const fast = await portalApi(storageDb(null, countFnOver(STORAGE_SRC_ALL)), ADMIN, 'storageUsage', {}, NOW);
  const older = await portalApi(storageDb(null, countFnOver(STORAGE_SRC_ALL.slice(0, 5))), ADMIN, 'storageUsage', {}, NOW);

  assert.equal(older.totalRows, fast.totalRows);
  assert.equal(older.bytes, fast.bytes);
  assert.deepEqual(older.sources, fast.sources);
  // What the head-count road cannot know is the dates, and it must SAY so, per source.
  for (const [key] of STORAGE_SRC_ALL.slice(5)) assert.ok(older.undated.includes(key), key + ' reported undated');
  for (const [key] of STORAGE_SRC_ALL.slice(0, 5)) assert.ok(!older.undated.includes(key), key + ' has its dates');
  // The five answered sources still carry their full day-by-day picture.
  const today = older.dates.find(x => x.date === TODAY);
  assert.equal(today.expected, 3);
  assert.equal(today.defaulters, 6);

  // A database where the function has not been created AT ALL must not error -- that is every
  // live database between a deploy and someone running the migration. Totals stay exact.
  const notYet = await portalApi(storageDb(null, null), ADMIN, 'storageUsage', {}, NOW);
  assert.equal(notYet.totalRows, fast.totalRows);
  assert.equal(notYet.bytes, fast.bytes);
  assert.deepEqual(notYet.dates, []);
  assert.equal(notYet.oldest, null);

  // Rows with no date of their own still count towards the size, they just belong to no day --
  // otherwise the disk figure would understate what is actually stored.
  const t = tables();
  t.abnormal_payments = (t.abnormal_payments || []).concat([{ id: 'x1', created_at: null }]);
  const withNull = await portalApi(storageDb(t, countFnOver(STORAGE_SRC_ALL)), ADMIN, 'storageUsage', {}, NOW);
  const headOnly = await portalApi(storageDb(t, null), ADMIN, 'storageUsage', {}, NOW);
  assert.equal(withNull.totalRows, headOnly.totalRows);
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
  const OTHER = { code: 'M', name: 'MB LEAD', role: 'GMO', teams: ['MBAGALA'], tabs: USER_TABS.slice() };
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
  const mbagala = { code: 'M', name: 'MB', role: 'GMO', teams: ['MBAGALA'], tabs: USER_TABS.slice() };
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
test('the pipeline says how many applications came in this month', async () => {
  const t = tables();
  // All three landed this month (TODAY is 2026-07-24).
  t.loans = [
    { id: 'l1', team: 'KONGOWE', stage: 'approved', principal_amt: 300000, requested_amt: 350000, upload_date: TODAY },
    { id: 'l2', team: 'KONGOWE', stage: 'unassigned', requested_amt: 200000, upload_date: MON },
    { id: 'l3', team: 'MBAGALA', stage: 'disbursed', principal_amt: 100000, requested_amt: 120000, upload_date: '2026-07-01' },
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

/* "the applications widgets should be monthly progress based and not alltime"
   A running total of every application ever written only ever goes up: a good month and a bad
   one look identical beside it, and nobody can tell from it whether this month is going well. */
test('the widgets count this month\'s arrivals, wherever each has reached since', async () => {
  const t = tables();
  t.loans = [
    { id: 'now1', team: 'KONGOWE', stage: 'unassigned', requested_amt: 100, upload_date: TODAY },
    { id: 'now2', team: 'KONGOWE', stage: 'approved', principal_amt: 900, requested_amt: 900, upload_date: '2026-07-02' },
    // Last month, and the month before: neither belongs to this month's progress.
    { id: 'old1', team: 'KONGOWE', stage: 'disbursed', principal_amt: 500, requested_amt: 500, upload_date: '2026-06-30' },
    { id: 'old2', team: 'KONGOWE', stage: 'approved', principal_amt: 500, requested_amt: 500, upload_date: '2026-05-15' },
    // Dated by the insert moment where the admin's day is missing, as everywhere else.
    { id: 'fb', team: 'KONGOWE', stage: 'assigned', requested_amt: 50, created_at: '2026-07-10T06:00:00Z' },
    // No date at all: it can be in no month, and the tab is told so rather than left to guess.
    { id: 'nd', team: 'KONGOWE', stage: 'unassigned', requested_amt: 7 },
  ];
  const d = await portalApi(fakeDb(t), ADMIN, 'loanPipeline', {}, NOW);
  assert.equal(d.month, '2026-07');
  assert.equal(d.from, '2026-07-01');
  assert.equal(d.to, TODAY, 'month TO DATE for the month we are in');
  assert.equal(d.total, 3, 'the two July arrivals plus the one dated by created_at');
  assert.equal(d.requested, 1050);
  /* THE STAGE IS WHEREVER IT HAS REACHED. An application that came in this month and has since
     been approved is still this month's arrival -- counting only what is still sitting in the
     early stages would make the month shrink as work got done. */
  assert.equal(d.stages.find(s => s.stage === 'approved').count, 1);
  assert.equal(d.stages.find(s => s.stage === 'disbursed').count, 0, 'June\'s disbursement is June\'s');
  // The whole book is still reported, small, beside the month -- "how big is it" is still real.
  assert.equal(d.allTime, 6);
  assert.equal(d.undated, 1);

  // A month already finished runs to its own end, not to today.
  const june = await portalApi(fakeDb(t), ADMIN, 'loanPipeline', { month: '2026-06' }, NOW);
  assert.equal(june.from, '2026-06-01');
  assert.equal(june.to, '2026-06-30', 'a finished month is finished');
  assert.equal(june.total, 1);

  // And December rolls the year over rather than producing month 13.
  t.loans.push({ id: 'dec', team: 'KONGOWE', stage: 'unassigned', requested_amt: 1, upload_date: '2025-12-31' });
  const dec = await portalApi(fakeDb(t), ADMIN, 'loanPipeline', { month: '2025-12' }, NOW);
  assert.equal(dec.to, '2025-12-31');
  assert.equal(dec.total, 1);
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

test('a role can be ticked into a HOPE Loan tab too, not just HOPE PMO -- both live in the same checkbox list', async () => {
  // "ticking the nav pannels from all existing whatever the future stage am on because
  // writing could error" -- saveRole used to filter against ADMIN_TABS alone, so a Loan tab
  // ticked on the checkbox list this same allTabs feeds was silently dropped on save.
  const db = fakeDb(tables());
  await portalApi(db, ADMIN, 'saveRole', { role: 'senior', tabs: 'dashboard, gmo, manager, nonsense' }, NOW);
  const saved = db._dump('roles').find(r => r.role === 'SENIOR');
  assert.deepEqual(saved.tabs, ['dashboard', 'gmo', 'manager']);

  // Both screens that offer this checkbox draw from the same combined list.
  const t = await portalApi(db, ADMIN, 'teams', {}, NOW);
  const ac = await portalApi(db, ADMIN, 'accessCodes', {}, NOW);
  for (const list of [t.allTabs, ac.allTabs]) {
    for (const lt of ['customer_service', 'manager', 'team', 'gmo', 'credit', 'finance', 'gm']) {
      assert.ok(list.includes(lt), lt + ' is tickable');
    }
    assert.ok(list.includes('upload'), 'HOPE PMO tabs are still there too');
  }
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

/* THE LEADER REPORTS' ORODHA -- "chipped table segments of 9 ... one leader goes his teams,
   grand totals/averages row then start the other leader in the same table", with J3..IJ as a
   LOOKUP of the latest occurrence of that weekday rather than this week's. */
test('the leader segments group each leader\'s teams, subtotal them, and look up each weekday', async () => {
  const t = tables();
  t.access_codes = t.access_codes.concat([
    { code: 'P', name: 'CATHERINE', role: 'PMO COLLECTION', teams: ['KONGOWE'], tabs: [] },
  ]);
  const d = await run('leaderReports', {}, ADMIN, dbWithRpc(t));

  // Four measurements over three leader kinds each: the nine asked for, plus sales.
  assert.equal(d.segments.length, 12);
  assert.deepEqual(d.segments.filter(s => s.dflt).map(s => s.id).sort(),
    ['col_collection', 'col_gmo', 'col_manager', 'ecol_collection', 'ecol_gmo', 'ecol_manager',
     'rec_gmo', 'rec_manager', 'rec_recovery'],
    'the nine open ticked; sales is one tick away');

  // The day columns are the LATEST of each weekday. Today is Friday 24 July.
  assert.equal(d.segDays.IJ, TODAY, 'IJ is today');
  assert.equal(d.segDays.AL, YEST, 'AL is yesterday');
  assert.equal(d.segDays.J3, MON);
  assert.equal(d.segDays.J2, '2026-07-19', 'no Sunday yet this week, so last Sunday');

  // COLLECTION, by the PMO collection officer -- who is resolved off her access code.
  const col = d.segments.find(s => s.id === 'col_collection');
  const cath = col.groups.find(g => g.leader === 'CATHERINE');
  assert.equal(cath.teams, 1);
  assert.equal(cath.rows[0].team, 'KONGOWE');
  assert.equal(cath.rows[0].uncol, 1000);          // 1500 expected, 500 collected
  assert.equal(cath.rows[0].pct, 33.3);
  assert.equal(cath.rows[0].d.IJ, 33.3, 'IJ is today itself');
  assert.equal(cath.rows[0].d.AL, 0, 'Thursday collected nothing of its 400');
  assert.equal(cath.rows[0].d.J3, null, 'nothing uploaded for Monday: not measured, never 0%');
  assert.equal(cath.total.sub, true, 'each leader closes with their own JUMLA row');
  assert.equal(cath.total.pct, 33.3);
  // MBAGALA has no collection officer on either the codes or the sheet.
  assert.ok(col.groups.find(g => g.leader === '(unassigned)'), 'an unstaffed team is visible');
  assert.equal(col.unstaffed, 1);
  // The segment total is worked out again from the parts, never averaged from the rows.
  assert.equal(col.totals.pct, pctOfTest_(500, 2300));

  // RECOVERY, by the recovery officer, on the day's own rule: Friday divides by jana.
  const rec = d.segments.find(s => s.id === 'rec_recovery');
  assert.equal(rec.basis, 'yest');
  const juma = rec.groups.find(g => g.leader === 'JUMA G');
  assert.equal(juma.rows[0].recovered, 300);       // initial 1200 - current 900
  assert.equal(juma.rows[0].uncol, 400);           // Thursday's uncollected
  assert.equal(juma.rows[0].pct, 75);
  assert.deepEqual(rec.amtKeys, ['J1', 'J2'], 'the weekend shows an amount, not a percentage');

  // SALES is emitted for the credit analyst, and is NOT one of the nine by default.
  const sales = d.segments.find(s => s.id === 'sales_credit');
  assert.equal(sales.dflt, false);
  assert.ok(sales.groups.find(g => g.leader === 'ANALYST A'));
  assert.equal(sales.dayKeys.length, 6, 'six days for sales: Mon-Sat');

  // The team distributions are untouched -- "leave the team distributions, just ammend orodha".
  assert.ok(d.sections.length);
  assert.ok(d.rows.length);
});
const pctOfTest_ = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/* "Start with empty accessible navs for all roles except all for ADMIN so that i go set well
   now : i fear running into errors" -- so the clean slate has to be reversible, and ADMIN has
   to survive it, or the fear is justified. */
test('the clean slate empties every role but ADMIN, clears code extras, and undoes exactly', async () => {
  const t = tables();
  t.roles = [
    { role: 'ADMIN', tabs: ['upload'] },              // a thin ADMIN row: it must come back full
    { role: 'GMO', tabs: ['dashboard', 'followup', 'par'] },
    { role: 'MANAGEMENT', tabs: ['dashboard', 'weekly'] },
  ];
  t.access_codes = t.access_codes.concat([
    { code: 'G1', name: 'JUMA G', role: 'GMO', teams: ['KONGOWE'], tabs: ['audit'] },
    { code: 'M1', name: 'BOSS', role: 'MANAGEMENT', teams: null, tabs: [] },
  ]);
  const db = dbWithRpc(t);

  const before = await run('accessCodes', {}, ADMIN, db);
  assert.equal(before.roleBackupAt, null, 'nothing saved until something is emptied');

  const r = await run('resetRoleTabs', {}, ADMIN, db);
  assert.equal(r.emptied, 2, 'GMO and MANAGEMENT');
  assert.equal(r.codesCleared, 2, 'only the codes that actually carried extras: A and G1');
  assert.ok(r.adminKept > 20);

  const after = await run('accessCodes', {}, ADMIN, db);
  const roleOf = (d, name) => d.roles.find(x => x.role === name);
  assert.deepEqual(roleOf(after, 'GMO').tabs, []);
  assert.deepEqual(roleOf(after, 'MANAGEMENT').tabs, []);
  assert.ok(roleOf(after, 'ADMIN').tabs.includes('settings'), 'ADMIN is written out in full');
  assert.ok(roleOf(after, 'ADMIN').tabs.includes('dashboard'));
  assert.deepEqual(after.rows.find(x => x.code === 'G1').tabs, [], 'the code carries nothing of its own now');
  /* The ADMIN CODE loses its per-code extras too, and that is safe: every enforcement point
     grants an ADMIN role every tab whatever its row says, so the admin who presses this
     cannot shut themselves out with it. */
  assert.deepEqual(after.rows.find(x => x.code === 'A').tabs, []);
  assert.ok(after.roleBackupAt, 'and there is something to undo back to');

  const u = await run('resetRoleTabs', { undo: true }, ADMIN, db);
  assert.equal(u.undone, true);
  const back = await run('accessCodes', {}, ADMIN, db);
  assert.deepEqual(roleOf(back, 'GMO').tabs, ['dashboard', 'followup', 'par'], 'exactly as it was');
  assert.deepEqual(roleOf(back, 'MANAGEMENT').tabs, ['dashboard', 'weekly']);
  assert.deepEqual(roleOf(back, 'ADMIN').tabs, ['upload'], 'even the thin ADMIN row is restored as it was');
  assert.deepEqual(back.rows.find(x => x.code === 'G1').tabs, ['audit']);
  assert.deepEqual(back.rows.find(x => x.code === 'A').tabs, ['upload', 'settings']);
});

test('an undo with nothing saved refuses rather than emptying anything', async () => {
  const db = dbWithRpc(tables());
  await assert.rejects(() => run('resetRoleTabs', { undo: true }, ADMIN, db), e => e.status === 400);
});

/* =====================================================================================
   A ROLE EXISTS THE MOMENT A CODE CARRIES IT.
   =====================================================================================
     "Nafasi na ruhusa / Roles & access showed only collection and pmo collection"
     "yet i said all existing roles meaning even if i create a new one [in access codes
      creation] thats where the leaders who use system are created and their nav settings"

   The card listed the `roles` TABLE, which only ever gains a row when somebody edits a role.
   Every leader in this system is created by typing a role on an access code -- so that role
   existed for the person holding it and appeared nowhere on the screen that grants
   permissions. There was no route to give it a single tab. */
test('every role on an access code is listed, even one that has no row of its own', async () => {
  const t = tables();
  t.roles = [{ role: 'COLLECTION', tabs: ['followup'] }];
  t.access_codes = t.access_codes.concat([
    { code: 'G1', name: 'JUMA G', role: 'GMO', teams: ['KONGOWE'], tabs: [] },
    { code: 'X1', name: 'NEW LEADER', role: 'ZONE OFFICER', teams: null, tabs: [] },
    { code: 'G2', name: 'ASHA G', role: 'GMO', teams: ['TEMEKE'], tabs: [] },
  ]);
  const d = await run('accessCodes', {}, ADMIN, dbWithRpc(t));
  const names = d.roles.map(r => r.role);
  assert.ok(names.includes('GMO'), 'a role only an access code carries is still a role');
  assert.ok(names.includes('ZONE OFFICER'), 'including one invented while creating a code');
  assert.ok(names.includes('COLLECTION'), 'and the ones with rows are still there');
  assert.ok(names.includes('ADMIN'), 'ADMIN is always grantable');
  assert.equal(names.length, new Set(names).size, 'two codes with the same role list it once');

  const gmo = d.roles.find(r => r.role === 'GMO');
  assert.deepEqual(gmo.tabs, [], 'nothing granted yet');
  assert.equal(gmo.unset, true, 'and the screen can say so, rather than looking emptied');
  const col = d.roles.find(r => r.role === 'COLLECTION');
  assert.deepEqual(col.tabs, ['followup'], 'a role WITH a row keeps its own tabs');
  assert.ok(!col.unset);
});

/* =====================================================================================
   THE TICKS DECIDE, AND THEY ARE ENFORCED.
   =====================================================================================
     "roles assignment aint strict: user will see all allowed teams in call app but see only
      allowed navs in the system, so if empty in the system show none: the custom ticking aint
      working"

   Two things made ticking decorative. resolveTabs fell back to USER_TABS -- twenty-two screens
   -- whenever the granted list came out empty, so an emptied role was granted almost
   everything. And a screen is a nav item AND a function: the drawer drew twenty-five ids for
   everybody, and the function behind each was reachable by anybody with a valid code. */
test('an empty role is granted nothing at all -- no fallback to the ordinary screens', async () => {
  const { resolveTabs } = await import('../api/_lib/auth.js');
  assert.deepEqual(resolveTabs({ role: 'GMO', tabs: [] }, []), [],
    'empty means empty. A fallback that GRANTS is the wrong direction for a permission.');
  assert.deepEqual(resolveTabs({ role: 'GMO', tabs: [] }, null), [],
    'and a role with no row at all is the same answer, not a wider one');
  assert.deepEqual(resolveTabs({ role: 'GMO', tabs: [] }, ['followup']), ['followup'],
    'exactly what was ticked, and nothing beside it');
  const admin = resolveTabs({ role: 'ADMIN', tabs: [] }, []);
  assert.ok(admin.includes('settings') && admin.includes('dashboard'),
    'ADMIN still holds everything whatever its row says -- nobody can lock the admin out');
});

test('a screen refuses the role it was not ticked for, and says who can open it', async () => {
  const db = dbWithRpc();
  const nothing = { code: 'N', name: 'NEW LEADER', role: 'ZONE OFFICER', teams: null, tabs: [] };
  for (const fn of ['dashboardFull', 'commission', 'weekly', 'followup', 'par', 'credit']) {
    await assert.rejects(() => portalApi(db, nothing, fn, {}, NOW),
      e => e.status === 403 && /Nafasi na ruhusa|Roles & access/.test(String(e.message)),
      fn + ' must refuse a role that holds nothing, and name where it is granted');
  }
  /* TICK ONE, AND ONLY THAT ONE OPENS. This is the whole promise: what was ticked is what is
     reachable, on the server, not only in the drawer. */
  const one = { ...nothing, tabs: ['followup'] };
  assert.ok(await portalApi(db, one, 'followup', {}, NOW));
  await assert.rejects(() => portalApi(db, one, 'commission', {}, NOW), e => e.status === 403);
});

test('a function serving two screens opens for either tab', async () => {
  /* officerBoards and dashboardFull draw the Dashboard AND the Presentation; `teams` is read
     by Teams & Staff, by Settings and by Iliyonasia. Requiring one named tab would have shut
     the other screen for somebody who legitimately holds it. */
  const db = dbWithRpc();
  const presenter = { code: 'P', name: 'PRESENTER', role: 'MANAGER', teams: null, tabs: ['present'] };
  assert.ok(await portalApi(db, presenter, 'officerBoards', {}, NOW));
  assert.ok(await portalApi(db, presenter, 'dashboardFull', {}, NOW));
  const teamsOnly = { code: 'T', name: 'HR', role: 'MANAGER', teams: null, tabs: ['teams'] };
  assert.ok(await portalApi(db, teamsOnly, 'teams', {}, NOW));
  await assert.rejects(() => portalApi(db, teamsOnly, 'dashboardFull', {}, NOW), e => e.status === 403);
});

test('the admin and the read-only supervisor pass the tab gate whatever their row says', async () => {
  const db = dbWithRpc();
  const thinAdmin = { code: 'A2', name: 'BOSS', role: 'ADMIN', teams: null, tabs: [] };
  assert.ok(await portalApi(db, thinAdmin, 'dashboardFull', {}, NOW),
    'an ADMIN with a blank tabs cell still holds every tab -- the same rule as resolveTabs');
  const sup = { code: 'V2', name: 'SUPERVISOR', role: 'AUDITOR', teams: null, tabs: [], readOnly: true };
  assert.ok(await portalApi(db, sup, 'weekly', {}, NOW),
    'supervision sees every screen; the read-only wall stops it CHANGING anything');
});

test('the phone is untouched by any of this', async () => {
  /* "user will see all allowed teams in call app but see only allowed navs in the system".
     HOPE Calls has its own door and its own identity -- no access code, no tabs -- so an
     officer whose portal role holds nothing still boots into their full working list. */
  const db = fakeDb({ ...tables(),
    roles: [{ role: 'OFFICER', tabs: [] }],
    call_users: [{ user_id: 'U1', name: 'JUMA G', team: 'KONGOWE', role: 'OFFICER',
      device_id: 'DEV1', active: true }] });
  const boot = await callApi(db, 'api_callBoot', ['DEV1'], NOW);
  assert.equal(boot.ok, true, 'the phone signs in regardless of what the portal role holds');
  assert.equal(boot.team, 'KONGOWE', 'and still has their team');
});

test('a role listed from a code keeps the spelling the code actually holds', async () => {
  /* Not cosmetic. Every permission check finds the row by the role's NAME, so tidying the
     spelling here would list a role nobody holds, and the tabs ticked against it would reach
     no one. */
  const t = tables();
  t.roles = [];
  t.access_codes = t.access_codes.concat([
    { code: 'P9', name: 'KAMARIA', role: 'Pmo Collection', teams: null, tabs: [] },
  ]);
  const d = await run('accessCodes', {}, ADMIN, dbWithRpc(t));
  assert.ok(d.roles.some(r => r.role === 'Pmo Collection'),
    'listed exactly as the code spells it, not normalised into something else');
});

test('a role row and a code that spell the role differently are ONE role, and it grants', async () => {
  /* THE SILENT LOCKOUT. saveRole stores a role uppercased; an access code keeps whatever was
     typed. The permission checks compared the two EXACTLY, so "Pmo Collection" beside a row
     saying "PMO COLLECTION" found nothing -- the person got no tabs at all, while the roles
     screen showed a full tick list beside their role and nothing said why.

     The same fault as the Tunduru blackout, one level up: an exact-case comparison standing
     between a person and their own screens. It is at its most dangerous exactly now, while
     access is being set from an empty slate, because "not granted yet" and "row not found"
     look identical. */
  const t = tables();
  t.roles = [{ role: 'PMO COLLECTION', tabs: ['followup', 'par'] }];
  t.access_codes = t.access_codes.concat([
    { code: 'P9', name: 'KAMARIA', role: 'Pmo Collection', teams: ['KONGOWE'], tabs: [] },
  ]);
  const d = await run('accessCodes', {}, ADMIN, dbWithRpc(t));
  const listed = d.roles.filter(r => String(r.role).toUpperCase() === 'PMO COLLECTION');
  assert.equal(listed.length, 1, 'one role, not two rows saying the same thing');
  assert.deepEqual(listed[0].tabs, ['followup', 'par'], 'and it is the row with the tabs on it');
});

test('only an admin may empty the roles', async () => {
  const db = dbWithRpc(tables());
  await assert.rejects(() => run('resetRoleTabs', {}, GMO, db));
});

test('loan applications default to the whole pipeline, not one stage', async () => {
  const db = fakeDb(tables());
  // "Where is every application right now" is what this tab gets asked most, and forcing a
  // stage first meant a docket could only be found if you already knew its stage.
  const all = await portalApi(db, ADMIN, 'loans', { from: '', to: '' }, NOW);
  assert.equal(all.stage, '');
  assert.equal(all.count, 4);                      // 2 approved + 1 disbursed + 1 unassigned
  assert.equal(all.amount, 650000);
  assert.equal(all.windowed, false);
  // A named stage still narrows it.
  const appr = await portalApi(db, ADMIN, 'loans', { stage: 'approved', from: '', to: '' }, NOW);
  assert.equal(appr.count, 2);
  // Team scoping still applies to the unfiltered view.
  assert.equal((await portalApi(db, GMO, 'loans', { from: '', to: '' }, NOW)).count, 3);
});

/* "having loan applications nav - put a default start and end date of today {they too many}"
   Every application the company has ever written arrived on this tab at once. */
test('the applications list opens on today, and both ends are editable', async () => {
  const t = tables();
  // Three applications on three different days, filed by the day the ADMIN chose.
  t.loans = [
    { id: 'a1', team: 'KONGOWE', stage: 'unassigned', requested_amt: 100, upload_date: TODAY },
    { id: 'a2', team: 'KONGOWE', stage: 'assigned', requested_amt: 100, upload_date: MON },
    // No upload_date: the day falls back to the insert moment, as the dashboard's trend does.
    { id: 'a3', team: 'KONGOWE', stage: 'unassigned', requested_amt: 100, created_at: TODAY + 'T06:00:00Z' },
  ];
  const db = fakeDb(t);
  const d = await portalApi(db, ADMIN, 'loans', {}, NOW);
  assert.equal(d.windowed, true);
  assert.equal(d.from, TODAY); assert.equal(d.to, TODAY);
  assert.deepEqual(d.rows.map(r => r.id).sort(), ['a1', 'a3'], 'today only, both ways of dating');
  assert.equal(d.total, 3, 'and it still says how many there are altogether');

  // Widened by hand: the whole week is one change away.
  const wk = await portalApi(db, ADMIN, 'loans', { from: MON, to: TODAY }, NOW);
  assert.equal(wk.count, 3);
  // One day back on its own.
  const mon = await portalApi(db, ADMIN, 'loans', { from: MON, to: MON }, NOW);
  assert.deepEqual(mon.rows.map(r => r.id), ['a2']);
});

test('an application carrying no date at all is left out of the window and SAID, not dropped', async () => {
  /* It cannot be put on a day, and putting it in every window would be worse -- the same
     docket in every report. So it is excluded and counted, because a row that disappears
     behind a date box with nothing said about it is how a docket goes missing for a week. */
  const t = tables();
  t.loans = [
    { id: 'ok', team: 'KONGOWE', stage: 'unassigned', requested_amt: 100, upload_date: TODAY },
    { id: 'nodate', team: 'KONGOWE', stage: 'unassigned', requested_amt: 100 },
  ];
  const d = await portalApi(fakeDb(t), ADMIN, 'loans', {}, NOW);
  assert.deepEqual(d.rows.map(r => r.id), ['ok']);
  assert.equal(d.undated, 1, 'the screen can say so instead of the row vanishing');
  // With no window there is nothing to fall out of, so nothing is reported undated.
  const all = await portalApi(fakeDb(t), ADMIN, 'loans', { from: '', to: '' }, NOW);
  assert.equal(all.count, 2);
  assert.equal(all.undated, 0);
});

/* "chip their list under a teams weekly report s/n teamname j3(u+a), j4 - j2, total and avrg
   (avrg per day in the 7 days) so that we get loan app performance report by all existing
   teams" */
test('the weekly applications board counts u+a per day, for every team, including the zeros', async () => {
  const t = tables();
  t.teams = [{ team: 'KONGOWE' }, { team: 'MBAGALA' }, { team: 'QUIET' }];
  t.loans = [
    // KONGOWE: two on Monday, one on Tuesday. MBAGALA: one on Monday.
    { id: 'k1', team: 'KONGOWE', stage: 'unassigned', requested_amt: 100, upload_date: MON },
    { id: 'k2', team: 'KONGOWE', stage: 'assigned', requested_amt: 100, upload_date: MON },
    { id: 'k3', team: 'KONGOWE', stage: 'unassigned', requested_amt: 100, upload_date: '2026-07-21' },
    { id: 'm1', team: 'MBAGALA', stage: 'assigned', requested_amt: 100, upload_date: MON },
    /* APPROVED IS STILL AN APPLICATION -- it just moved on. Counting only what is still
       sitting in u/a would make last week's figures shrink every time a docket advanced, so
       this one is deliberately excluded from the (u+a) definition the dashboard also uses. */
    { id: 'k4', team: 'KONGOWE', stage: 'approved', principal_amt: 100, upload_date: MON },
    // Last week: outside the window entirely.
    { id: 'old', team: 'KONGOWE', stage: 'unassigned', requested_amt: 100, upload_date: '2026-07-17' },
  ];
  const d = await portalApi(fakeDb(t), ADMIN, 'appsWeekly', {}, NOW);
  assert.equal(d.weekOf, MON);
  assert.deepEqual(d.days.map(x => x.key), ['J3', 'J4', 'J5', 'AL', 'IJ', 'J1', 'J2']);

  const by = Object.fromEntries(d.rows.map(r => [r.team, r]));
  assert.equal(by.KONGOWE.J3, 2); assert.equal(by.KONGOWE.J4, 1);
  assert.equal(by.KONGOWE.total, 3);
  assert.equal(by.MBAGALA.J3, 1); assert.equal(by.MBAGALA.total, 1);
  /* A TEAM THAT BROUGHT IN NOTHING IS THE FINDING. A report that omits it says nothing about
     it at all -- a zero row is an answer, a missing row is a question. */
  assert.ok(by.QUIET, 'every existing team is on the board');
  assert.equal(by.QUIET.total, 0);
  assert.equal(by.QUIET.avg, 0);

  // The average is per day over SEVEN, not over the days that happened to have something.
  assert.equal(by.KONGOWE.avg, Math.round((3 / 7) * 10) / 10);
  assert.equal(d.rows[0].team, 'KONGOWE', 'busiest first');
  assert.equal(d.totals.total, 4);
  assert.equal(d.totals.J3, 3);
  assert.equal(d.totals.avg, Math.round((4 / 7) * 10) / 10);
});

/* =====================================================================================
   ILIYONASIA COUNTS, OR IT IS A NOTEBOOK.
   =====================================================================================
     "received amounts in all team reports and leader reports must include registered
      iliyonasia"

   The register recorded a payment that was made and verified and did not reach the deck, with
   who, when and why attached -- and NOTHING read it back. Every report went on showing the
   figure the deck got wrong, which is the exact situation it was built to end. Writing a
   correction down and not applying it is worse than not having the register, because it looks
   like the fix has been made. */
test('a registered Iliyonasia payment is part of what the weekly report says was received', async () => {
  const t = tables();
  t.pmo_adjustments = [
    // KONGOWE received 40,000 on Monday that the day's sheet never showed.
    { id: 'a1', adj_date: MON, target: 'expected-current', team: 'KONGOWE', amount: 40000,
      reason: 'ilipwa benki, haikuonekana', created_by: 'PMO DATA' },
  ];
  const plain = await portalApi(dbWithRpc(tables()), ADMIN, 'weekly', {}, NOW);
  const withAdj = await portalApi(dbWithRpc(t), ADMIN, 'weekly', {}, NOW);
  const teamOf = (d, name) => d.teams.find(x => x.team === name);

  assert.equal(teamOf(withAdj, 'KONGOWE').collected,
    teamOf(plain, 'KONGOWE').collected + 40000, 'the correction is part of what was received');
  assert.equal(teamOf(withAdj, 'KONGOWE').adjusted, 40000,
    'and it is shown beside the figure, never folded away -- an adjustment that moves a total '
    + 'silently is indistinguishable from a bug');
  /* MONEY RECEIVED IS MONEY NO LONGER OUTSTANDING. Uncollected falls by the same amount,
     clamped at zero like every uncollected figure in this system. */
  assert.equal(teamOf(withAdj, 'KONGOWE').uncollected,
    Math.max(0, teamOf(plain, 'KONGOWE').uncollected - 40000));
  // Nobody else moves.
  assert.equal(teamOf(withAdj, 'MBAGALA').collected, teamOf(plain, 'MBAGALA').collected);
  assert.equal(teamOf(withAdj, 'MBAGALA').adjusted, 0);
  assert.equal(withAdj.teamTotals.adjusted, 40000);

  /* THE DAY STRIP MOVES WITH THE TEAM TABLE. A report that corrects one and not the other
     shows two figures for the same money on the same screen -- and only after a correction,
     which is exactly when somebody is already hunting a discrepancy. */
  const dayOf = (d, date) => d.days.find(x => x.date === date);
  assert.equal(dayOf(withAdj, MON).collected, dayOf(plain, MON).collected + 40000);
  assert.equal(dayOf(withAdj, MON).adjusted, 40000);
  assert.equal(dayOf(withAdj, TODAY).collected, dayOf(plain, TODAY).collected, 'other days untouched');
});

test('a negative Iliyonasia reduces what was received, and an unattributed one is kept apart', async () => {
  const t = tables();
  t.pmo_adjustments = [
    { id: 'a1', adj_date: MON, target: 'expected-current', team: 'KONGOWE', amount: -25000 },
    /* NO TEAM. It cannot be attributed to one, and inventing an attribution would make the
       team rows stop adding up to the total -- a discrepancy nobody could account for. */
    { id: 'a2', adj_date: MON, target: 'expected-current', team: null, amount: 99000 },
    /* THE ARREARS BOOKS ARE DELIBERATELY NOT APPLIED. Recovery is initial-minus-current across
       two decks, so the same +50,000 raises it on one side and lowers it on the other, and
       guessing which was meant would put a confident wrong number in the Monday meeting. */
    { id: 'a3', adj_date: MON, target: 'defaulter-current', team: 'KONGOWE', amount: 50000 },
    { id: 'a4', adj_date: MON, target: 'defaulter-initial', team: 'KONGOWE', amount: 50000 },
  ];
  const plain = await portalApi(dbWithRpc(tables()), ADMIN, 'weekly', {}, NOW);
  const d = await portalApi(dbWithRpc(t), ADMIN, 'weekly', {}, NOW);
  const kong = d.teams.find(x => x.team === 'KONGOWE');
  assert.equal(kong.adjusted, -25000, 'positive adds, negative reduces -- the register\'s own rule');
  assert.equal(kong.recovered, plain.teams.find(x => x.team === 'KONGOWE').recovered,
    'the defaulter rows change no recovery figure until somebody says which way they read');
  assert.equal(d.teamTotals.adjusted, -25000, 'the unattributed 99,000 is not in the team total');
});

test('a database with no Iliyonasia table reports exactly as it always did', async () => {
  /* db/RUN-ME-015 is pasted in by hand like every migration here, so between a deploy and
     somebody opening the SQL editor the reports must be untouched -- not broken, not empty. */
  const bare = tables();
  delete bare.pmo_adjustments;
  const d = await portalApi(dbWithRpc(bare), ADMIN, 'weekly', {}, NOW);
  assert.ok(d.teams.length);
  assert.equal(d.teamTotals.adjusted, 0);
});

/* =====================================================================================
   ONE COL %, OR THE REGISTER IS WORSE THAN USELESS.
   =====================================================================================
     "my guys who posts reports says the col% of excels and our system differ so he is worried
      we are not including iliyonasia in collected"
     "he just uploaded and confirmed that by using the expected tab"

   He was right, and the fault was the one CLAUDE.md names first: TWO implementations of one
   rule. The weekly report and the leader reports applied the register; the dashboard, the
   Orodha, the month ledger and the month report did not. So the same week's Col % read one
   figure on the report he posts and another on the screen the directors open, and neither
   matched his Excel. A figure that disagrees with itself is worse than a wrong one, because
   there is nothing to correct. These tests are what stops it splitting again. */
const ADJ_WEEK = [
  /* TODAY, because that is the day this fixture actually has a deck on -- and because a
     correction against a day whose sheet DID arrive is the case where every screen has a
     figure to move. The day-with-no-deck case is covered by the weekly report's own tests
     above, which register against Monday. */
  { id: 'c1', adj_date: TODAY, target: 'expected-current', team: 'KONGOWE', amount: 40000,
    reason: 'ilipwa benki, haikuonekana', created_by: 'PMO DATA' },
];

test('the dashboard Col % counts the same Iliyonasia the weekly report does', async () => {
  const t = tables();
  t.pmo_adjustments = ADJ_WEEK.slice();
  const plain = await portalApi(dbWithRpc(tables()), ADMIN, 'dashboardFull', {}, NOW);
  const d = await portalApi(dbWithRpc(t), ADMIN, 'dashboardFull', {}, NOW);

  /* THE PERFORMANCE STRIP. Its Col % is the week's collected over its expected, and the
     collected side is now the same one the report he posts prints. */
  assert.ok(d.perf.colPct > plain.perf.colPct,
    'the registered payment raises the week Col % the strip shows');

  // THE COL TREND TILE -- the same money, on the day it was registered against.
  const dayOf = (x, date) => x.colTrend.find(r => r.date === date);
  assert.equal(dayOf(d, TODAY).collected, dayOf(plain, TODAY).collected + 40000);
  /* MONEY RECEIVED IS MONEY NO LONGER OUTSTANDING -- clamped PER TEAM, which is the whole
     reason the correction is applied to team-day cells rather than to a finished total. The
     40,000 clears KONGOWE's own outstanding and stops there; it cannot reach into MBAGALA's,
     which is what subtracting it from the day's total would have done. */
  assert.ok(dayOf(d, TODAY).uncollected < dayOf(plain, TODAY).uncollected);
  assert.equal(dayOf(d, TODAY).uncollected,
    dayOf(plain, TODAY).uncollected - Math.min(1000, 40000) - 0 + 0 - 0,
    'KONGOWE"s 1,000 is cleared; MBAGALA"s 800 is untouched');
  assert.ok(dayOf(d, TODAY).pct > dayOf(plain, TODAY).pct);

  /* THE ORODHA. Its T. Col % is the same day read per team, and it must not be a third
     answer to the question the two figures above already agree on. */
  const teamOf = (x, name) => x.teamPerf.find(r => r.team === name);
  assert.ok(teamOf(d, 'KONGOWE').tColPct > teamOf(plain, 'KONGOWE').tColPct);
  assert.equal(teamOf(d, 'MBAGALA').tColPct, teamOf(plain, 'MBAGALA').tColPct,
    'a correction is for one team -- nobody else moves');
});

test('the weekly report and the dashboard now answer the day with ONE Col %', async () => {
  /* The whole point. Before this these two read the same decks by two different rules and
     disagreed by exactly the register -- which is what sent somebody to check their Excel. */
  const t = tables();
  t.pmo_adjustments = ADJ_WEEK.slice();
  const wk = await portalApi(dbWithRpc(t), ADMIN, 'weekly', {}, NOW);
  const dash = await portalApi(dbWithRpc(t), ADMIN, 'dashboardFull', {}, NOW);
  const dWk = wk.days.find(x => x.date === TODAY);
  const dDash = dash.colTrend.find(x => x.date === TODAY);
  assert.equal(dWk.collected, dDash.collected,
    'one day, one collected figure, whichever screen asks');
  assert.equal(dWk.pct, dDash.pct, 'and therefore one Col %');
});

test('the Expected tab adds the register to Collected, and still shows the deck alone', async () => {
  /* This is the tab he checked, and the instruction after the evidence was explicit: "not just
     there ... EVERYWHERE the amount should add as stated during manual input". So Collected and
     Col % include it. The deck's own figures come back beside them, because the rows on screen
     are still the deck alone -- an Iliyonasia has no customer row, that is what it is -- and
     without saying so a person adding up the list would find it short and hunt a bug. */
  const t = tables();
  t.pmo_adjustments = ADJ_WEEK.slice();
  const args = { type: 'today', weekday: 'FRI' };
  const plain = await portalApi(dbWithRpc(tables()), ADMIN, 'expectedDay', args, NOW);
  const d = await portalApi(dbWithRpc(t), ADMIN, 'expectedDay', args, NOW);

  assert.equal(d.totals.collected, plain.totals.collected + 40000, 'the amount adds, as typed');
  assert.ok(d.totals.pct > plain.totals.pct, 'and Col % moves with it');
  assert.equal(d.totals.adjusted, 40000);
  assert.equal(d.totals.deckCollected, plain.totals.collected,
    'the deck is still there to be reconciled against the rows');
  assert.equal(d.totals.deckPct, plain.totals.pct);
  assert.ok(d.totals.uncollected < plain.totals.uncollected, 'and uncollected falls with it');
  assert.equal(d.totals.adjReady, true);

  /* THE INITIAL BOOK IS NOT THIS BOOK. An `expected-current` correction must not appear on the
     early-collection sheet, or Col would move Early Col by its own figure. */
  const ini = await portalApi(dbWithRpc(t), ADMIN, 'expectedDay', { type: 'initial', weekday: 'FRI' }, NOW);
  assert.equal(ini.totals.adjusted, 0);

  // No register table: the tab is exactly what it was, and says so rather than claiming zero.
  const bare = tables();
  delete bare.pmo_adjustments;
  const b = await portalApi(dbWithRpc(bare), ADMIN, 'expectedDay', args, NOW);
  assert.equal(b.totals.adjusted, 0);
  assert.equal(b.totals.collected, plain.totals.collected);
  assert.equal(b.totals.deckCollected, plain.totals.collected);
});

test('the month ledger takes the register on READ, so a late correction still lands', async () => {
  /* The ledger FREEZES days before the current week -- computed once, stored, never
     recomputed. An Iliyonasia registered today against a day three weeks back is the ordinary
     case (that is when somebody finds the missing payment), so a correction baked into a
     frozen cell would simply never appear. It is laid over the stored ledger on every read. */
  const t = tables();
  t.pmo_adjustments = ADJ_WEEK.slice();
  const plain = await portalApi(dbWithRpc(tables()), ADMIN, 'monthReport', {}, NOW);
  const d = await portalApi(dbWithRpc(t), ADMIN, 'monthReport', {}, NOW);
  assert.ok(plain.ledgerReady && d.ledgerReady, 'the fixture fills the ledger in one pass');
  assert.equal(d.totals.collected, plain.totals.collected + 40000,
    'the month total carries the correction');
  assert.ok(d.totals.colPct > plain.totals.colPct);
  // Per team, per day, as above: KONGOWE's Friday 1,000 clears and nothing else moves.
  assert.equal(d.totals.uncollected, plain.totals.uncollected - 1000);
  /* AND THE LEADER ROWS OFF THE SAME LEDGER. One walk, two readers -- so the month report's
     total and the leader beside it cannot disagree about the same money. */
  const leadOf = (x, name) => x.leaders.find(r => r.name === name && r.roleKey === 'manager');
  assert.ok(leadOf(d, 'BOSS').colPct > leadOf(plain, 'BOSS').colPct);
});

test('the register is read once per request, and a missing one is not asked twice', async () => {
  /* "Mind you we aint interfering app efficiency and speed : postgres issues"
     The dashboard asks for the register twice -- its own figures and buildDashboard's -- and
     the phone's bar asks twice as well. Read per caller, that is a drip on a throttled
     instance; read whole and remembered, it is one trip that everything behind it shares. */
  const t = tables();
  t.pmo_adjustments = ADJ_WEEK.slice();
  const db = dbWithRpc(t);
  let hits = 0;
  const from0 = db.from.bind(db);
  db.from = (n) => { if (n === 'pmo_adjustments') hits += 1; return from0(n); };
  await portalApi(db, ADMIN, 'dashboardFull', {}, NOW);
  assert.equal(hits, 1, 'two callers in one request, one journey to the database');

  /* AND THE MISSING TABLE IS REMEMBERED, WHICH IS NOT AN OPTIMISATION. db/RUN-ME-015 is pasted
     in by hand, so until it is, every one of these reads is a query Postgres REJECTS and LOGS
     as an error -- which is what a screen full of Postgres errors is made of. Asked once and
     remembered, the fallback behaves identically and stops shouting. */
  const bare = tables();
  delete bare.pmo_adjustments;
  const db2 = dbWithRpc(bare);
  let asks = 0;
  const f2 = db2.from.bind(db2);
  db2.from = (n) => { if (n === 'pmo_adjustments') asks += 1; return f2(n); };
  await portalApi(db2, ADMIN, 'dashboardFull', {}, NOW);
  await portalApi(db2, ADMIN, 'weekly', {}, NOW);
  assert.ok(asks <= 1, `a table that is not there was asked for ${asks} times`);
});

test('the phone strip and the portal dashboard cannot disagree about the same day', async () => {
  /* buildDashboard is shared by both on purpose. Correcting one and not the other would have
     put two Collected figures for one day on ONE screen -- the shared cards and the Orodha
     beside them -- which is worse than the fault being fixed. */
  const t = tables();
  t.pmo_adjustments = ADJ_WEEK.slice();
  const plain = await portalApi(dbWithRpc(tables()), ADMIN, 'dashboard', {}, NOW);
  const d = await portalApi(dbWithRpc(t), ADMIN, 'dashboard', {}, NOW);
  assert.equal(d.totals.collected, plain.totals.collected + 40000, 'the amount adds, as typed');
  const kong = x => x.teams.find(r => r.team === 'KONGOWE');
  assert.equal(kong(d).collected, kong(plain).collected + 40000);
  assert.equal(kong(d).uncollected, Math.max(0, kong(plain).uncollected - 40000));
  assert.equal(d.teams.find(r => r.team === 'MBAGALA').collected,
    plain.teams.find(r => r.team === 'MBAGALA').collected, 'one team, one day');
});

test('the collection commission boards pay on what was collected, register included', async () => {
  /* This one is PAY, not a report, which is why it is tested on its own. An Iliyonasia is
     money the officer DID collect -- the only thing that went wrong is that it never reached
     the deck -- so paying on the deck alone pays them less than they collected. */
  const withOfficer = () => {
    const x = tables();
    // A collection officer holding KONGOWE -- these people live on their access codes.
    x.access_codes.push({ code: 'PMO1', name: 'PMO ONE', role: 'COLLECTION', teams: ['KONGOWE'] });
    return x;
  };
  const t = withOfficer();
  t.pmo_adjustments = ADJ_WEEK.slice();
  const plain = await portalApi(dbWithRpc(withOfficer()), ADMIN, 'commission', {}, NOW);
  const d = await portalApi(dbWithRpc(t), ADMIN, 'commission', {}, NOW);
  const rowOf = x => x.pmo.find(r => r.officer === 'PMO ONE');
  assert.ok(rowOf(plain), 'the fixture puts a collection officer on the board');
  assert.ok(rowOf(d).weekPct > rowOf(plain).weekPct,
    'a payment that was collected and registered is paid on, not left on the deck that missed it');
});

/* =====================================================================================
   PAYING FOR A CUSTOMER, AND NOT PAYING FOR THEM TWICE.
   =====================================================================================
     "yes keep commission on the register ... they are the most complaining on this part"
     "so check the deck by customer ref no and status not amounts"

   PMO Collection is paid by BAND on a percentage, so applying the amount already moved that
   officer's money. Early Collection is paid PER PAID CUSTOMER times a rate -- so applying the
   amount moved their percentage and left their shillings exactly where they were. */
function earlyBook_() {
  /* An INITIAL sheet, which is the only book the early scheme is judged on, with a team whose
     early-collection officer is named on the sheet. */
  const x = tables();
  x.teams = x.teams.map(t => (t.team === 'KONGOWE' ? { ...t, expected: 'EARLY E' } : t));
  x.settings = x.settings.concat([{ key: 'CMS_PAID_TZS', value: '1000' }]);
  x.repayment_snapshots = x.repayment_snapshots.concat([
    { ref: '901', full_name: 'A', team: 'KONGOWE', payment_expected: 1000, todays_status: 'UNPAID',
      arrears: 0, snapshot_type: 'initial', snapshot_date: TODAY, upload_batch: 'i1',
      created_at: TODAY + 'T04:00:00Z' },
    { ref: '902', full_name: 'B', team: 'KONGOWE', payment_expected: 1000, todays_status: 'PAID',
      arrears: 0, snapshot_type: 'initial', snapshot_date: TODAY, upload_batch: 'i1',
      created_at: TODAY + 'T04:00:00Z' },
  ]);
  return x;
}
const earlyRow_ = d => (d.colBoard || []).find(r => r.officer === 'EARLY E');

test('a registered payment that names a customer is paid for on the early scheme', async () => {
  const plainT = earlyBook_();
  const t = earlyBook_();
  // 901 is UNPAID on the deck and was paid in cash -- the case the register exists for.
  t.pmo_adjustments = [{ id: 'e1', adj_date: TODAY, target: 'expected-initial',
    team: 'KONGOWE', amount: 1000, ref: '901', reason: 'ilipwa, haikuonekana' }];
  const plain = await portalApi(dbWithRpc(plainT), ADMIN, 'commission', {}, NOW);
  const d = await portalApi(dbWithRpc(t), ADMIN, 'commission', {}, NOW);
  assert.equal(earlyRow_(plain).weekN, 1, 'the deck alone has one paid customer');
  assert.equal(earlyRow_(d).weekN, 2, 'the register names a second, and it counts');
  assert.ok(earlyRow_(d).weekCommission > earlyRow_(plain).weekCommission,
    'which is the whole point -- the percentage moved before, the money did not');
});

test('the deck is checked by ref and status, so nobody is paid for twice', async () => {
  /* "so check the deck by customer ref no and status not amounts". 902 already reads PAID on
     the sheet. A register row against them is stale -- the corrected deck arrived -- so the
     deck pays for them and the register stands down. */
  const t = earlyBook_();
  t.pmo_adjustments = [{ id: 'e1', adj_date: TODAY, target: 'expected-initial',
    team: 'KONGOWE', amount: 1000, ref: '902' }];
  const plain = await portalApi(dbWithRpc(earlyBook_()), ADMIN, 'commission', {}, NOW);
  const d = await portalApi(dbWithRpc(t), ADMIN, 'commission', {}, NOW);
  assert.equal(earlyRow_(d).weekN, earlyRow_(plain).weekN,
    'the deck already counts 902 -- the register must not count them again');
  assert.equal(earlyRow_(d).weekCommission, earlyRow_(plain).weekCommission);
  // The AMOUNT still applies. It is only the customer count that stands down.
  assert.ok(earlyRow_(d).weekPct > earlyRow_(plain).weekPct);
});

test('a register row with no customer ref moves the amount and pays for nobody', async () => {
  /* An entry with no ref cannot be attributed to a person, and inventing one to pay somebody
     for would be worse than paying nothing. */
  const t = earlyBook_();
  t.pmo_adjustments = [{ id: 'e1', adj_date: TODAY, target: 'expected-initial',
    team: 'KONGOWE', amount: 1000, ref: null }];
  const plain = await portalApi(dbWithRpc(earlyBook_()), ADMIN, 'commission', {}, NOW);
  const d = await portalApi(dbWithRpc(t), ADMIN, 'commission', {}, NOW);
  assert.equal(earlyRow_(d).weekN, earlyRow_(plain).weekN, 'no ref, no customer');
  assert.ok(earlyRow_(d).weekPct > earlyRow_(plain).weekPct, 'but the amount still applies');
});

test('a negative correction never turns into a paying customer', async () => {
  const t = earlyBook_();
  t.pmo_adjustments = [{ id: 'e1', adj_date: TODAY, target: 'expected-initial',
    team: 'KONGOWE', amount: -500, ref: '901' }];
  const plain = await portalApi(dbWithRpc(earlyBook_()), ADMIN, 'commission', {}, NOW);
  const d = await portalApi(dbWithRpc(t), ADMIN, 'commission', {}, NOW);
  assert.equal(earlyRow_(d).weekN, earlyRow_(plain).weekN,
    'money going back out does not make somebody a paying customer');
});

test('the Iliyonasia tab says what the commission side did with every row', async () => {
  /* "so if autoremoved find a way to flag by anything on the transaction row in iliyonasia
      that alerts what was done" -- a figure that changed for a reason nobody can see is the
     exact thing this register exists to stop. */
  const t = earlyBook_();
  t.pmo_adjustments = [
    { id: 'a', adj_date: TODAY, target: 'expected-initial', team: 'KONGOWE', amount: 1000, ref: '901' },
    { id: 'b', adj_date: TODAY, target: 'expected-initial', team: 'KONGOWE', amount: 1000, ref: '902' },
    { id: 'c', adj_date: TODAY, target: 'expected-initial', team: 'KONGOWE', amount: 1000, ref: null },
    { id: 'e', adj_date: TODAY, target: 'defaulter-current', team: 'KONGOWE', amount: 1000, ref: '901' },
  ];
  const d = await portalApi(dbWithRpc(t), ADMIN, 'adjustments', {}, NOW);
  const by = {};
  for (const r of d.rows) by[r.id] = r;
  assert.equal(by.a.countState, 'counted');
  assert.equal(by.b.countState, 'superseded', 'the deck overtook this one -- say so on the row');
  assert.equal(by.c.countState, 'no-ref');
  assert.equal(by.e.countState, 'amount-only', 'the arrears books pay no per-customer commission');
  assert.equal(d.superseded, 1, 'and the tab can lead with the count that needs a person');
  for (const r of d.rows) assert.ok(r.countNote, 'every row explains itself in words');
});

test('every field of a register row is editable, and absent means untouched', async () => {
  /* "the iliyonasia register rows info should be editable" -- the ref especially, now that a
     row carrying one is worth money to an officer. */
  const t = tables();
  t.pmo_adjustments = [{ id: 'x1', adj_date: MON, target: 'expected-current', team: 'KONGOWE',
    amount: 1000, ref: null, reason: 'first go', created_by: 'PMO ONE' }];
  const db = dbWithRpc(t);
  const r1 = await portalApi(db, ADMIN, 'adjustmentAmend',
    { id: 'x1', ref: '901', date: TODAY, target: 'expected-initial', team: 'MBAGALA' }, NOW);
  assert.equal(r1.row.ref, '901');
  assert.equal(r1.row.adj_date, TODAY);
  assert.equal(r1.row.target, 'expected-initial');
  assert.equal(r1.row.team, 'MBAGALA');
  assert.equal(r1.row.amount, 1000, 'a field not sent is left exactly as it was');
  assert.equal(r1.row.reason, 'first go');
  assert.equal(r1.row.created_by, 'THE ADMIN', 'and the row is re-signed by whoever decided it');

  // A team the register does not know is refused, exactly as it is on a new row.
  await assert.rejects(() => portalApi(db, ADMIN, 'adjustmentAmend', { id: 'x1', team: 'NOWHERE' }, NOW),
    /haipo kwenye orodha|not in the register/);
  // So is a book that does not exist, and a zero amount.
  await assert.rejects(() => portalApi(db, ADMIN, 'adjustmentAmend', { id: 'x1', target: 'nonsense' }, NOW),
    /target must be one of/);
  await assert.rejects(() => portalApi(db, ADMIN, 'adjustmentAmend', { id: 'x1', amount: 0 }, NOW),
    /non-zero/);
  // Clearing is deliberate and possible: an empty string blanks, undefined leaves alone.
  const r2 = await portalApi(db, ADMIN, 'adjustmentAmend', { id: 'x1', reason: '', ref: '' }, NOW);
  assert.equal(r2.row.reason, null);
  assert.equal(r2.row.ref, null);
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
  const asLeader = n => ({ code: 'X', name: n, role: 'MANAGER', teams: null, tabs: USER_TABS.slice() });

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
  const me = { code: 'X', name: 'BOSS', role: 'MANAGER', teams: null, tabs: USER_TABS.slice() };
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
  //
  // This is what actually runs in production: writeFollowupFromDeck (every slice, deck columns
  // only) then retireFollowupAfterDeck (once, at the end, against the whole batch's own refs
  // read back from the table -- see "LAST WEEK's deck" further down for why that replaced a
  // per-weekday "previous deck" lookup that never found one).
  const { writeFollowupFromDeck, retireFollowupAfterDeck } = await import('../api/upload.js');
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
    defaulter_snapshots: [],
  });
  const deck = [
    { ref: 'D1', team: 'KONGOWE', full_name: 'NEW NAME', contact: '0712000001', status: 'Defaulter',
      ds: '3/6', dc: 3, days_elapsed: 40, other_inst: 40000, arrears: 700 },
    { ref: 'D2', team: 'KONGOWE', full_name: 'FRESH ONE', contact: '0712000002', status: 'Chronic',
      ds: '1/6', dc: 1, days_elapsed: 120, other_inst: 30000, arrears: 1500 },
  ];
  // The write also lands the deck in defaulter_snapshots, exactly as the upload route does --
  // retireFollowupAfterDeck reads inDeck back from there, not from the records in memory.
  db._dump('defaulter_snapshots').push(...deck.map((d, i) => ({ id: 'new' + i, ref: d.ref,
    team: d.team, snapshot_type: 'current', weekday: 'MON', snapshot_date: TODAY,
    upload_batch: 'new', created_at: TODAY + 'T06:00:00Z' })));
  const synced = await writeFollowupFromDeck(db, deck, TODAY);
  assert.equal(synced, 2);
  const r = await retireFollowupAfterDeck(db, 'MON', 'new', TODAY);
  assert.equal(r.retired, 1, 'GONE left the deck');
  assert.equal(r.capped, 0);

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

  // A customer new to the deck simply appears, with no follow-up state yet. There is nothing
  // to preserve for a row that never existed, so writeFollowupFromDeck's payload simply omits
  // fu_status rather than writing it -- a real database answers null for the unset column; the
  // fake store just has no key, which is why this reads with ?? rather than a bare equal.
  assert.equal(by.D2.arrears, 1500);
  assert.equal(by.D2.fu_status ?? null, null);

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

/* =====================================================================================
   THE TIPS TIMER HAD NOWHERE TO BE SET, BECAUSE NOTHING EVER READ IT.
   =====================================================================================
     "Am not seeing were to set tips timelapse in settings"

   S.hintEverySec / S.hintHoldSec have always existed client-side with a hard-coded fallback
   (240s / 7s) for when they are unset -- and nothing server-side ever set them, so the
   fallback was the only value that could ever run. There was nowhere to see because there was
   nothing to find: hints() carried no timing at all. */
test('hints carries the tip timer, defaulting to the fallback the client always used', async () => {
  const bare = await portalApi(fakeDb({ hints: [] }), ADMIN, 'hints', {}, NOW);
  assert.equal(bare.everySec, 240, 'unset -- the same default the client fell back to');
  assert.equal(bare.holdSec, 7);

  const set = await portalApi(fakeDb({ hints: [], settings: [
    { key: 'HINT_EVERY_SEC', value: '600' }, { key: 'HINT_HOLD_SEC', value: '12' } ] }),
    ADMIN, 'hints', {}, NOW);
  assert.equal(set.everySec, 600, 'a real setting now actually changes it');
  assert.equal(set.holdSec, 12);
});

// An Exp.Def screen that is empty for a reason the officer cannot see costs a phone call and
// a day. Each of the four ways it empties out must be distinguishable from the response.
test('expdf says WHY it is empty, and shows the book when the deck has no DISB DATE', async () => {
  // 1. No deck for today's weekday at all.
  const bare = tables();
  bare.teams[0] = { ...bare.teams[0], gmo: 'GMO GEE', manager: 'BOSS', bike: 'BIKE BEE' };
  bare.defaulter_snapshots = [];
  const me = { code: 'X', name: 'BOSS', role: 'MANAGER', teams: null, tabs: USER_TABS.slice() };
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
  /* CHANGED 14 Aug on the owner's instruction: "Recovery — today ... Rec % ÷ this week's
     uncollected [show yesterday uncollected before today recovered]". The daily board's own
     caption had always SAID "÷ this week's uncollected" while dividing by a day-dependent
     basis; the caption's rule now runs, and yesterday stands as its own column instead. */
  assert.equal(jumaToday.uncollected, 17000,
    'the DAILY board divides by the week, exactly as its caption has always claimed');
  assert.equal(jumaToday.yUncollected, 1000,
    'and yesterday\'s uncollected stands as its own column before recovered');
  assert.equal(b.pmoBasis, 'yesterday', 'the PMO board keeps its own day-dependent basis');
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
  assert.equal(monday.pmoBasis, 'today', 'the PMO board keeps its own day-dependent basis');
  // Since 14 Aug the recovery board divides by the week on every day -- see the test above.
  assert.equal(monday.recToday.find(r => r.officer === 'JUMA G').uncollected, 2000,
    'the week as uploaded: 1000 Mon + 400 Tue + 600 Wed');

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

/* "Sales of 31st aug are not counting at dashboard": Monday's approvals were uploaded again on
   Tuesday as the pending-disbursement list, which moved every one of them to a stage the sales
   rule did not know -- the fault SALES_STAGES was made to end, one stage over. */
test('a sale that moved on to pending disbursement is still a sale', async () => {
  const t = tables();
  t.settings = t.settings.concat([{ key: 'SALES_TARGET_WEEKLY', value: '1000' }]);
  t.loans = [
    { id: 'p1', team: 'KONGOWE', stage: 'pending_disb', principal_amt: 400, approved_date: MON },
    { id: 'p2', team: 'KONGOWE', stage: 'approved', principal_amt: 100, approved_date: TODAY },
  ];
  const d = await run('dashboardFull', {}, ADMIN, dbWithRpc(t));
  assert.equal(d.cards.salesWeek, 500, 'Monday\'s 400, now pending disbursement, plus today\'s 100');
  assert.equal(d.cards.salesLoans, 2);
  assert.equal(d.salesTrend.find(x => x.date === MON).amount, 400, 'and it sits under Monday on the trend');
  const k = d.teamPerf.find(r => r.team === 'KONGOWE');
  assert.equal(k.sales, 500);
  assert.equal(k.salesMonth, 500);
});

/* THE MONTH IS NOT ON THE DASHBOARD. The three month tiles lived on the KPI row for one week
   of production and were then retired on request -- "the directors hate exposing data so keep
   monthly in the chip" -- so the dashboard answer must carry NO month figure at all (absent,
   not null: null was "could not compute", absence is "not asked"), and must not spend a
   single read producing one. The one survivor is teamPerf's per-team salesMonth, because the
   ranking has always been read on the month. */
test('the dashboard carries no month figures -- the month lives only in the month report', async () => {
  const t = tables();
  t.settings = t.settings.concat([{ key: 'SALES_TARGET_WEEKLY', value: '1000' }]);
  t.loans = [
    { id: 'm1', team: 'KONGOWE', stage: 'approved', principal_amt: 400, approved_date: TODAY },
    { id: 'm2', team: 'MBAGALA', stage: 'disbursed', principal_amt: 100, approved_date: TODAY },
    { id: 'm3', team: 'MBAGALA', stage: 'approved', principal_amt: 9999, approved_date: '2026-06-15' },
  ];
  t.repayment_snapshots = [
    E('111', 'KONGOWE', 1000, 'UNPAID', 0),
    E('333', 'MBAGALA', 1000, 'PAID', 0),
  ];
  const d = await run('dashboardFull', {}, ADMIN, dbWithRpc(t));
  const c = d.cards;
  for (const k of ['salesMonth', 'salesMonthLoans', 'colMonthExpected', 'colMonthCollected',
                   'colMonthPct', 'recMonthRecovered', 'recMonthUncollected', 'recMonthPct']) {
    assert.equal(k in c, false, k + ' must not appear on the dashboard at all');
  }
  assert.equal('monthTarget' in d, false, 'the month target rode along for the tile; the tile is gone');
  // The weekly cards are untouched by the retirement.
  assert.equal(c.salesWeek, 500, 'approved 400 + disbursed 100 this week; June excluded');
  assert.equal(c.salesLoans, 2);
  // The ranking still reads the month per team, as it always has.
  assert.equal(d.teamPerf.find(r => r.team === 'KONGOWE').salesMonth, 400);
});

/* "this week ended on 30th but we need to view monlthly report from there." A finished month
   is read to its LAST day, however the week bar reached it -- the week of the 24th no longer
   stops August at its own Friday and leaves the 31st "not yet". */
test('a finished month opened from one of its weeks is read to its last day', async () => {
  const t = tables();
  t.settings = t.settings.concat([{ key: 'SALES_TARGET_WEEKLY', value: '1000' }]);
  t.loans = [
    { id: 'm1', team: 'KONGOWE', stage: 'approved', principal_amt: 400, approved_date: TODAY },
    // A sale on the last day of July -- a Friday, in the week that closes the month.
    { id: 'm4', team: 'KONGOWE', stage: 'approved', principal_amt: 250, approved_date: '2026-07-31' },
  ];
  // Now is a Wednesday in August; the bar is on the week of the 20th of July.
  const AUG = Date.parse('2026-08-05T09:00:00Z');
  const d = await portalApi(dbWithRpc(t), ADMIN, 'monthReport', { weekOf: '2026-07-20' }, AUG);
  assert.equal(d.month, '2026-07');
  assert.equal(d.asOfDate, '2026-07-31', 'read to the month\'s last day, not the chosen week\'s Friday');
  assert.equal(d.weekOf, '2026-07-20', 'the bar stays on the week that was chosen');
  const last = d.rows[d.rows.length - 1];
  assert.deepEqual([last.from, last.to], ['2026-07-27', '2026-07-31']);
  assert.equal(last.started, true, 'the closing week has happened');
  assert.equal(last.sales, 250, 'and the 31st\'s sale is in it');
  assert.equal(d.totals.sales, 650);
  // The live month is still read to today.
  const live = await portalApi(dbWithRpc(t), ADMIN, 'monthReport', {}, NOW);
  assert.equal(live.asOfDate, TODAY);
});

/* THE PERFORMANCE STRIP -- "show average of sales%, col% and recovery% performance where in
   each one and the average have the rising constant or dropping arrow symbol to know
   progress". Three percentages and their average for THIS week, each with last week's
   movement beside it; a last week with no uploads at all yields null movement -- no arrow,
   never a fake "rising from nothing". */
test('the dashboard performance strip carries the three percentages, their average, and the movement', async () => {
  const t = tables();
  t.settings = t.settings.concat([{ key: 'SALES_TARGET_WEEKLY', value: '1000' }]);
  t.loans = [
    { id: 'p1', team: 'KONGOWE', stage: 'approved', principal_amt: 400, approved_date: TODAY },
    { id: 'p2', team: 'MBAGALA', stage: 'disbursed', principal_amt: 100, approved_date: TODAY },
    // LAST week (Mon 2026-07-13): 200 sold, so this week's sales movement is +15 points.
    { id: 'p3', team: 'KONGOWE', stage: 'approved', principal_amt: 200, approved_date: '2026-07-15' },
  ];
  t.repayment_snapshots = [
    E('111', 'KONGOWE', 1000, 'UNPAID', 0),
    E('333', 'MBAGALA', 1000, 'PAID', 0),
    // Last week collected nothing of 1,000 -- so collection moved up by 50 points.
    E('444', 'KONGOWE', 1000, 'UNPAID', 0, '2026-07-15'),
  ];
  const d = await run('dashboardFull', {}, ADMIN, dbWithRpc(t));
  const p = d.perf;
  // Target 1,000 x 2 teams = 2,000/week. This week: sales 500 -> 25%; col 1,000/2,000 -> 50%;
  // recovery 400 of 1,000 -> 40%; average (25+50+40)/3 = 38.3.
  assert.equal(p.salesPct, 25);
  assert.equal(p.colPct, 50);
  assert.equal(p.recPct, 40);
  assert.equal(p.avgPct, 38.3);
  assert.equal(p.avgOn, 3, 'all three were measured this week');
  // Movement against last week: sales 10% -> 25% (+15), collection 0% -> 50% (+50),
  // recovery had no decks last week (null -- no arrow).
  assert.equal(p.dSales, 15);
  assert.equal(p.dCol, 50);
  assert.equal(p.dRec, null, 'no defaulter decks last week: no arrow, not a fake rise');
  /* THE AVERAGE IS OVER WHAT WAS MEASURED, AND THAT IS WHY THIS IS 33.3 AND NOT 35.
     Last week had sales 10% and collection 0%, and NO defaulter deck at all -- so recovery was
     not measured, which is not the same as being zero. Averaging over three counted that
     absence as 0% and put last week at 3.3, flattering this week's rise by nearly two points.
     Over the two that were measured last week stands at 5.0, and the movement is 38.3 - 5.0.
     The same rule is why a strip showing "Recovery —" can never print an average lower than
     both figures printed beside it. */
  assert.equal(p.dAvg, 33.3);

  // A truly empty last week silences every arrow.
  const t2 = tables();
  t2.settings = t2.settings.concat([{ key: 'SALES_TARGET_WEEKLY', value: '1000' }]);
  t2.loans = [{ id: 'q1', team: 'KONGOWE', stage: 'approved', principal_amt: 400, approved_date: TODAY }];
  t2.repayment_snapshots = [E('111', 'KONGOWE', 1000, 'UNPAID', 0), E('333', 'MBAGALA', 1000, 'PAID', 0)];
  // NOT ONE DEFAULTER DECK. The base fixture ships with decks, so it has to be emptied on
  // purpose -- an unmeasured recovery is the whole point of the rule below.
  t2.defaulter_snapshots = [];
  const p2 = (await run('dashboardFull', {}, ADMIN, dbWithRpc(t2))).perf;
  assert.equal(p2.dSales, null);
  assert.equal(p2.dCol, null);
  assert.equal(p2.dAvg, null);

  /* AN AVERAGE OVER A PERCENTAGE NOBODY COULD MEASURE IS NOT AN AVERAGE.
     t2 has sales and expected rows but not one defaulter deck, so recovery is genuinely not
     measured -- null, never 0%. Dividing by three regardless printed 23.3 under a strip
     reading "Sales 20%, Collection 50%, Recovery —", and a month of good collection read as a
     bad one purely because the decks had not been uploaded. Over the two that were measured it
     is 35, and avgOn carries the "2 of 3" the tile discloses. */
  assert.equal(p2.recPct, null, 'no decks at all: recovery was not measured');
  assert.equal(p2.salesPct, 20);
  assert.equal(p2.colPct, 50);
  assert.equal(p2.avgPct, 35, 'the mean of the two measured, not of three (the old rule said 23.3)');
  assert.equal(p2.avgOn, 2, 'and the strip is told it covered two of the three');
});

/* THE MONTH REPORT -- "a chip to open a monthly report that shows the 4 weeks summaries
   progress and summary". The three month cards opened up into their weeks: calendar weeks
   CLIPPED to the month ("some months happen to start or end in the same month with the
   others"), the movement against the week before beside each figure, and a TOTAL row that
   must agree with the dashboard's cards to the shilling -- it is the same ledger. */
test('the month report cuts the month into clipped weeks and agrees with the cards', async () => {
  const t = tables();
  t.settings = t.settings.concat([{ key: 'SALES_TARGET_WEEKLY', value: '1000' }]);
  t.loans = [
    { id: 'm1', team: 'KONGOWE', stage: 'approved', principal_amt: 400, approved_date: TODAY },
    { id: 'm2', team: 'MBAGALA', stage: 'disbursed', principal_amt: 100, approved_date: TODAY },
    { id: 'm3', team: 'MBAGALA', stage: 'approved', principal_amt: 9999, approved_date: '2026-06-15' },
    // An application brought in this month, not yet a sale -- the loan-apps card counts it.
    { id: 'a1', team: 'KONGOWE', stage: 'unassigned', requested_amt: 50, created_at: TODAY + 'T08:00:00Z', created_by: 'CS1', track_no: '1' },
    // Brought in this month by the same agent and moved on past assignment: still this month's app.
    { id: 'a2', team: 'KONGOWE', stage: 'pending_approval', requested_amt: 70, created_at: TODAY + 'T09:00:00Z', created_by: 'CS1', track_no: '1' },
    // A repeat customer (TRACK# 2) is not a new win, as on the dashboard board.
    { id: 'a3', team: 'KONGOWE', stage: 'unassigned', requested_amt: 90, created_at: TODAY + 'T09:30:00Z', created_by: 'CS1', track_no: '2' },
  ];
  t.repayment_snapshots = [
    E('111', 'KONGOWE', 1000, 'UNPAID', 0),
    E('333', 'MBAGALA', 1000, 'PAID', 0),
  ];
  const db = dbWithRpc(t);
  const d = await run('monthReport', {}, ADMIN, db);
  assert.equal(d.month, '2026-07');
  assert.equal(d.ledgerReady, true);
  // July 2026 opens on a Wednesday and closes on a Friday: five clipped weeks, nothing
  // borrowed from June or August, and no gap between one week's end and the next's start.
  assert.deepEqual(d.rows.map(r => [r.from, r.to]), [
    ['2026-07-01', '2026-07-05'], ['2026-07-06', '2026-07-12'], ['2026-07-13', '2026-07-19'],
    ['2026-07-20', '2026-07-26'], ['2026-07-27', '2026-07-31'],
  ]);
  const wk = d.rows[3];                                       // the week TODAY sits in
  assert.equal(wk.sales, 500, 'approved 400 + disbursed 100; June excluded');
  assert.equal(wk.loans, 2);
  assert.equal(wk.dSales, 500, 'movement against the quiet week before');
  assert.equal(wk.expected, 2000);
  assert.equal(wk.collected, 1000);
  assert.equal(wk.colPct, 50);
  assert.equal(wk.recovered, 400, 'the same shared decks the cards read');
  assert.equal(wk.recPct, 40);
  const future = d.rows[4];
  assert.equal(future.started, false);
  assert.equal(future.sales, null, 'a week that has not happened says nothing');
  assert.equal(future.expected, null);

  /* The per-week performance: sales against a quarter of the month's target (8,000/4 =
     2,000), and perf = average of the three percentages. Week 4: sales 25%, col 50%,
     rec 40% -> perf 38.3, moving up from week 3's 0. */
  assert.equal(wk.salesPct, 25);
  assert.equal(wk.perf, 38.3);
  assert.equal(wk.dPerf, 38.3, 'week 3 had figures worth 0; the movement says so');
  assert.equal(wk.dSalesPct, 25);

  // The TOTAL row: the whole month summed under the same ledger the weeks came from.
  assert.equal(d.totals.sales, 500);
  assert.equal(d.totals.loans, 2);
  assert.equal(d.totals.expected, 2000);
  assert.equal(d.totals.collected, 1000);
  assert.equal(d.totals.colPct, 50);
  // The shared decks: initial 500+700+900 minus current 300+600+800 = 400 recovered today.
  assert.equal(d.totals.recovered, 400);
  assert.equal(d.totals.uncollected, 1000, 'the UNPAID row is the month\'s uncollected');
  assert.equal(d.totals.recPct, 40);
  assert.ok(d.totals.monthTarget > 0, 'weekly target x 4 x teams, for the sales card');
  // Month performance: (6.3 + 50 + 40) / 3 -- sales 500 of an 8,000 month target.
  assert.equal(d.totals.salesPct, 6.3);
  assert.equal(d.totals.perfPct, 32.1);

  /* THE LEADERS, EVERY ONE, BEST FIRST. KONGOWE's four named people each hold that one team,
     so they share its month: sales 400 of 4,000 (10%), col 0 of 1,000 (0%), rec 300 of 1,000
     (30%), early col unmeasured (no initial sheet) -> average 13.3 over the three measured.
     MBAGALA names nobody, so its figures belong to no leader. */
  assert.ok(Array.isArray(d.leaders));
  const juma = d.leaders.find(r => r.name === 'JUMA G');
  assert.equal(juma.role, 'Recovery');
  assert.equal(juma.teams, 1);
  assert.equal(juma.salesPct, 10);
  assert.equal(juma.ecolPct, null, 'no initial sheet this month: not measured, never 0%');
  assert.equal(juma.colPct, 0);
  assert.equal(juma.recPct, 30);
  assert.equal(juma.avgPct, 13.3);
  assert.equal(juma.avgOn, 3);
  assert.deepEqual(d.leaders.map(r => r.role + ':' + r.name).sort(),
    ['Credit Analyst:ANALYST A', 'Early Collection:EARLY E', 'Manager:BOSS', 'Recovery:JUMA G']);
  assert.ok(d.leaders.every((r, i) => i === 0 || (d.leaders[i - 1].avgPct ?? -1) >= (r.avgPct ?? -1)), 'best first');
  assert.equal(d.leaders[0].sn, 1);
  // The cards: applications brought in this month, and the company's early col.
  assert.equal(d.cards.apps, 3, 'three applications created this month');
  assert.equal(d.cards.ecolPct, null);
  /* "monthly loan application report before the all leaders chip": by agent, TRACK# 1 only,
     by the day the report was brought in, whatever stage each has reached since. */
  const cs = d.agents.rows.find(r => r.id === 'CS1');
  assert.equal(cs.names, 'NEEMA CS');
  assert.equal(cs.total, 2, 'a1 and a2; the TRACK# 2 repeat is not a new win');
  assert.equal(cs.unassigned, 1);
  assert.equal(cs.assigned, 0);
  assert.equal(cs.advanced, 1, 'a2 has moved on since -- still this month\'s application');
  assert.equal(cs.amount, 120, 'requested 50 + 70');
  assert.equal(d.agents.totals.total, 2);

  // Without the totals function: sales still exact (they read loans, not snapshots), and the
  // ledger columns stand down rather than print a month of zeros.
  const bare2 = await run('monthReport', {}, ADMIN, fakeDb(t));
  assert.equal(bare2.leaders.find(r => r.name === 'JUMA G').colPct, null, 'the ledger side stands down');
  assert.equal(bare2.leaders.find(r => r.name === 'JUMA G').salesPct, 10, 'sales still answer');
  assert.equal(bare2.ledgerReady, false);
  assert.equal(bare2.totals.sales, 500);
  assert.equal(bare2.totals.expected, null);
  assert.equal(bare2.rows[3].sales, 500);
  assert.equal(bare2.rows[3].expected, null, 'null means "not available", never zero');
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

/* THE ORODHA IN PAIRS -- "performance columns of 1&2 (today sales%, monthly sales%), 3&4
   (today early col%, monthly early col), 5&6 (today col%, monthly col%), 7&8 (today rec%,
   monthly rec%) and gen avrg of all today & monthly ... so that we always see today's
   performance and monthly progress". Each team carries its four officers and eight
   percentages plus the two averages; the month side comes off the same ledger the month
   report reads and stands down (null, never 0%) where the totals functions are absent. */
test('the Orodha carries today beside the month for sales, early col, col and rec, per team', async () => {
  const t = tables();
  /* The sheet names a collection officer on KONGOWE; a PMO COLLECTION access code holds
     KONGOWE too. "PMO today col officers didn't appear": the code is where these people
     live, so it wins; MBAGALA, held by no code, falls back to its sheet column. */
  t.teams[0].collection = 'COL C';
  t.teams[1].collection = 'SHEET S';
  t.access_codes = t.access_codes.concat([
    { code: 'P', name: 'CATHERINE', role: 'PMO COLLECTION', teams: ['KONGOWE'], tabs: [] },
  ]);
  t.settings = t.settings.concat([{ key: 'SALES_TARGET_WEEKLY', value: '1000' }]);
  // Today: 100 approved -> 50% of the team's daily target (1000 / 5); the month: 100 of 4000.
  t.loans = [{ id: 'm1', team: 'KONGOWE', stage: 'approved', principal_amt: 100, approved_date: TODAY }];
  t.repayment_snapshots = [
    E('111', 'KONGOWE', 1000, 'UNPAID', 0),                       // today: 1000 of 2000 collected
    E('222', 'KONGOWE', 1000, 'PAID', 0),
    E('111', 'KONGOWE', 400, 'UNPAID', 0, YEST),                  // jana: 400 uncollected
    E('333', 'KONGOWE', 1000, 'PAID', 0, TODAY, 'initial'),       // the early sheet: 50%
    E('444', 'KONGOWE', 1000, 'UNPAID', 0, TODAY, 'initial'),
  ];
  const db = dbWithRpc(t);
  /* A COLD MONTH FILLS ACROSS LOADS. July has four week slices and the dashboard fills at
     most two per load (the live week and one frozen week -- DASH_MONTH_SLICES), so its first
     load on a ledger nobody has filled says "not yet" rather than spending the budget of the
     most-opened screen on the whole month. The month report fills the rest under its own
     budget, and the next dashboard load -- a minute on, past the answer cache -- reads the
     whole month off the shared store. In production only ONE frozen week is ever missing
     (the one that just ended), so the dashboard is whole on its first load of the week. */
  const cold = await run('dashboardFull', {}, ADMIN, db);
  assert.equal(cold.monthReady, false, 'two of four slices on the first load: still filling');
  assert.equal(cold.teamPerf.find(r => r.team === 'KONGOWE').mColPct, null, 'and no figure is guessed');
  await run('monthReport', {}, ADMIN, db);
  const d = await portalApi(db, ADMIN, 'dashboardFull', {}, NOW + 61000);
  assert.equal(d.monthReady, true);
  const k = d.teamPerf.find(r => r.team === 'KONGOWE');
  // The four officers, off the teams table.
  assert.equal(k.credit, 'ANALYST A');
  assert.equal(k.expected, 'EARLY E');
  assert.equal(k.collection, 'CATHERINE', 'the PMO collection officer, off her access code');
  assert.equal(k.recovery, 'JUMA G');
  assert.equal(d.teamPerf.find(r => r.team === 'MBAGALA').collection, 'SHEET S', 'no code holds it: the sheet');
  // 1 & 2
  assert.equal(k.tSalesPct, 50, '100 of a 200 daily target');
  assert.equal(k.mSalesPct, 2.5, '100 of the 4000 month target');
  // 3 & 4 -- the initial sheet, today and the month (one sheet so far this month).
  assert.equal(k.tEColPct, 50);
  assert.equal(k.mEColPct, 50);
  // 5 & 6
  assert.equal(k.tColPct, 50, 'today is a weekday: today\'s own sheet');
  assert.equal(k.mColPct, 41.7, 'the month: 1000 collected of 2400 expected (jana expected 400 and collected none)');
  // 7 & 8 -- Friday divides by jana's uncollected; the month by all its uncollected.
  assert.equal(k.recBasis, 'yest');
  assert.equal(k.recovered, 300, 'initial 1200 minus current 900, the shared decks');
  assert.equal(k.tRecPct, 75, '300 of jana\'s 400');
  assert.equal(k.mRecPct, 21.4, '300 of the month\'s 1400 uncollected');
  // The averages, over what was measured.
  assert.equal(k.tAvg, 56.3, '(50 + 50 + 50 + 75) / 4');
  assert.equal(k.mAvg, 28.9, '(2.5 + 50 + 41.7 + 21.4) / 4');
  // The cards still carry no month figure -- the directors' rule on amounts stands.
  for (const key of ['salesMonth', 'colMonthPct', 'recMonthPct']) assert.equal(key in d.cards, false);
  assert.equal('monthTarget' in d, false);

  // Without the totals functions the month side stands down; today's side is unaffected.
  const bare = await run('dashboardFull', {}, ADMIN, fakeDb(t));
  assert.equal(bare.monthReady, false);
  const kb = bare.teamPerf.find(r => r.team === 'KONGOWE');
  assert.equal(kb.tSalesPct, 50);
  assert.equal(kb.tColPct, 50);
  assert.equal(kb.mColPct, null, 'null means "not yet", never 0%');
  assert.equal(kb.mEColPct, null);
  assert.equal(kb.mRecPct, null);
  assert.equal(kb.mSalesPct, 2.5, 'sales read the loans table and always answer');
  assert.equal(kb.mAvg, 2.5, 'the average of the one month figure that was measured');
});

/* "at setting sales target I need to set early col, col and rec % targets so that those who
   hit targets the % turns green". The targets travel on the hints call every screen makes at
   sign-in; unset means null, so nothing turns green by accident. */
test('the percentage targets ride on hints: numbers when set, null when not', async () => {
  const t = tables();
  t.hints = [];
  const bare = await run('hints', {}, ADMIN, fakeDb(t));
  assert.deepEqual(bare.targets, { ecol: null, col: null, rec: null });
  t.settings = t.settings.concat([
    { key: 'TARGET_EARLY_COL_PCT', value: '85' },
    { key: 'TARGET_COL_PCT', value: '90%' },          // a typed percent sign is forgiven
    { key: 'TARGET_REC_PCT', value: ' 30 ' },
  ]);
  const set = await run('hints', {}, GMO, fakeDb(t));   // any signed-in user, not only admins
  assert.deepEqual(set.targets, { ecol: 85, col: 90, rec: 30 });
});

/* "dashboard [Imeshindikana / Could not load. Seva haijibu ndani ya sekunde 45]" -- the ledger
   slice in flight ran as long as the database took, and the whole screen waited on it. The
   dashboard now races the ledger against its budget: a stalled slice costs the M. columns,
   never the dashboard. */
test('a stalled ledger slice cannot hold the dashboard past its budget', async () => {
  const t = tables();
  t.repayment_snapshots = [E('111', 'KONGOWE', 1000, 'PAID', 0), E('222', 'KONGOWE', 1000, 'UNPAID', 0)];
  const slow = { ...SNAPSHOT_TOTALS_RPC,
    // Only the ledger asks for every type at once; the dashboard's own week reads say 'today'.
    async expected_snapshot_totals(store, a) {
      if (a.p_type == null) await new Promise(r => setTimeout(r, 1200));
      return SNAPSHOT_TOTALS_RPC.expected_snapshot_totals(store, a);
    } };
  // The race allows the budget plus half a second; a 20ms budget answers at ~520ms.
  process.env.DASH_MONTH_BUDGET_MS = '20';
  try {
    const t0 = Date.now();
    const d = await run('dashboardFull', {}, ADMIN, fakeDb(t, { rpc: slow }));
    const took = Date.now() - t0;
    assert.ok(took < 1000, `the dashboard answered in ${took}ms, before the stalled slice did`);
    assert.equal(d.monthReady, false, 'the M. columns stand down');
    const k = d.teamPerf.find(r => r.team === 'KONGOWE');
    assert.equal(k.tColPct, 50, 'and today\'s side is whole');
    assert.equal(k.mColPct, null);
  } finally { delete process.env.DASH_MONTH_BUDGET_MS; }
});

/* The dashboard's own diagnosis: every read the dashboard makes, timed on its own, so a
   timeout on the live instance says WHICH read rather than only that one did. */
test('the dashboard probe times each read on its own and names them', async () => {
  const p = await run('dashboardProbe', {}, ADMIN, dbWithRpc(tables()));
  assert.ok(p.steps.length >= 12);
  for (const s of p.steps) {
    assert.ok(typeof s.name === 'string' && s.name.length);
    assert.ok(typeof s.ms === 'number' && s.ms >= 0, s.name + ' is timed');
    assert.equal(!!s.capped, false, s.name + ' answered');
    assert.equal(s.error, undefined, s.name + ' had no error');
  }
  assert.ok(p.steps.some(s => /expected totals/.test(s.name) && s.rows > 0));
  assert.ok(typeof p.total === 'number');
});

/* The diagnosis card on a saturated morning: settings 1.4s, the 84-row teams table past four
   seconds, an empty abnormal_payments table past four seconds. Nothing about the queries is
   wrong there -- so the dashboard asks for less. Half its heavy aggregate work is LAST week,
   and all last week produces is the arrows. */
test('a stalled last-week read costs the arrows, never the dashboard', async () => {
  const t = tables();
  t.settings = t.settings.concat([{ key: 'SALES_TARGET_WEEKLY', value: '1000' }]);
  t.repayment_snapshots = [E('111', 'KONGOWE', 1000, 'PAID', 0), E('222', 'KONGOWE', 1000, 'UNPAID', 0)];
  const slow = { ...SNAPSHOT_TOTALS_RPC,
    // Only LAST week's window stalls; this week answers as usual.
    async expected_snapshot_totals(store, a) {
      if (String(a.p_to) < TODAY) await new Promise(r => setTimeout(r, 1200));
      return SNAPSHOT_TOTALS_RPC.expected_snapshot_totals(store, a);
    },
    async defaulter_snapshot_totals(store, a) {
      if (String(a.p_to) < TODAY) await new Promise(r => setTimeout(r, 1200));
      return SNAPSHOT_TOTALS_RPC.defaulter_snapshot_totals(store, a);
    } };
  process.env.DASH_PREV_BUDGET_MS = '20';
  process.env.DASH_MONTH_BUDGET_MS = '20';
  try {
    const t0 = Date.now();
    const d = await run('dashboardFull', {}, ADMIN, fakeDb(t, { rpc: slow }));
    const took = Date.now() - t0;
    assert.ok(took < 1000, `the dashboard answered in ${took}ms, before the stalled read did`);
    assert.equal(d.perf.prevRead, false, 'the screen is told last week could not be read');
    assert.equal(d.perf.dCol, null, 'so no arrow is drawn');
    assert.equal(d.perf.dRec, null);
    // THIS week is whole -- the figures the arrows sit beside are untouched.
    assert.equal(d.perf.colPct, 50);
    assert.equal(d.cards.salesWeek, 600000, 'the fixture\'s three sales this week, unaffected');
    const k = d.teamPerf.find(r => r.team === 'KONGOWE');
    assert.equal(k.collPctToday, 50);
  } finally { delete process.env.DASH_PREV_BUDGET_MS; delete process.env.DASH_MONTH_BUDGET_MS; }
});

test('a month with no deck paired on any day has not measured recovery: null, not 0%', async () => {
  const t = tables();
  t.defaulter_snapshots = [];                                     // no decks at all this month
  t.repayment_snapshots = [E('111', 'KONGOWE', 1000, 'UNPAID', 0)];
  const db = dbWithRpc(t);
  await run('monthReport', {}, ADMIN, db);                        // fills the shared ledger whole
  const d = await run('dashboardFull', {}, ADMIN, db);
  assert.equal(d.monthReady, true);
  const k = d.teamPerf.find(r => r.team === 'KONGOWE');
  assert.equal(k.mRecPct, null);
  assert.equal(k.tRecPct, null);
  assert.equal(k.mColPct, 0, 'collection WAS measured: 0 of 1000');
});


/* Eight tests of syncFollowupFromDeck stood here. The function they tested is gone -- it was
   dead in production (writeFollowupFromDeck + retireFollowupAfterDeck replaced it after the
   slicing fault was found) and carried its own copy of the broken per-weekday comparison, kept
   alive only because these tests still called it directly. See the deck tests further up this
   file (search "LAST WEEK's deck") for the rule that actually runs, and retireFollowupAfterDeck
   in api/upload.js for why "per weekday" was the wrong question once a current file was
   confirmed to carry the whole book, not one weekday's slice of it. */

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
  const officer = { code: 'O', name: 'OFF', role: 'GMO', teams: ['ALPHA'], tabs: USER_TABS.slice() };
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

test('this week and no choice at all leave the clock exactly alone', () => {
  // The live screen has to be bit-for-bit what it was before the picker existed.
  for (const pick of ['', null, undefined, 'rubbish', '2026-07-20', '2026-07-24']) {
    const a = asOfWeek(NOW, pick);
    assert.equal(a.ms, NOW, String(pick));
    assert.equal(a.past, false, String(pick));
    assert.equal(a.future, false, String(pick));
    assert.equal(a.weekOf, MON, String(pick));
  }
});

/* "I tried pressing the date picker to 10th august so that all info start of next week but
   didn't work". Picked on the Sunday, the 10th is NEXT week -- and the clamp used to answer
   with the current week SILENTLY, so the screen redrew with the identical figures and looked
   broken. "Dashboard date should be able to slide next week since am uploading next week
   progress reports too" / "so backward and foward should both work" -- the clamp itself is
   gone now, not just the silence: a future week reads back as itself. */
test('a week that has not started yet is shown as itself, not bounced back to this week', () => {
  const a = asOfWeek(NOW, '2026-09-01');            // NOW is Friday 2026-07-24
  assert.equal(a.future, true, 'the screen can still say this week is upcoming, not "this week"');
  assert.equal(a.requested, '2026-08-31', 'which week was actually asked for, as its Monday');
  assert.equal(a.weekOf, '2026-08-31', 'and that IS what is shown -- no more falling back to today');
  assert.equal(todayKeyOf(a.ms), '2026-09-04', 'the Friday of the chosen future week, same as a past one');
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
  assert.equal(d.weekOf, '2026-08-31', 'the upcoming week itself, not the live one');
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

/* "Dashboard date should be able to slide next week since am uploading next week progress
   reports too" / "so backward and foward should both work" -- the mirror image of the past-
   week test above: a week not yet lived through, already populated in advance, reads back
   exactly like any other week instead of being refused. */
test('the dashboard computes a future week from that week too, once it has been uploaded', async () => {
  const book = tables();
  const NEXTMON = '2026-07-27', NEXTFRI = '2026-07-31';
  book.repayment_snapshots.push(
    { ...E('NW1', 'KONGOWE', 9000, 'UNPAID', 0, NEXTFRI), upload_batch: 'bnw', created_at: NEXTFRI + 'T04:00:00Z' });
  book.defaulter_snapshots.push(
    { ...D('NW1', 'KONGOWE', 5000, 'initial', 45, NEXTFRI, 'FRI'), upload_batch: 'inw', created_at: NEXTFRI + 'T04:00:00Z' },
    { ...D('NW1', 'KONGOWE', 4000, 'current', 45, NEXTFRI, 'FRI'), upload_batch: 'cnw', created_at: NEXTFRI + 'T04:00:00Z' });
  const db = fakeDb(book);

  const next = await portalApi(db, ADMIN, 'dashboardFull', { weekOf: NEXTMON }, NOW);
  assert.equal(next.weekOf, NEXTMON, 'the upcoming week it was asked for, not the live one');
  assert.equal(next.weekFuture, true);
  assert.equal(next.pastWeek, false);
  // Read back the figures actually uploaded for it, the same as any other week -- no zeroing
  // out, no substitution.
  assert.equal(next.cards.curArrears, 4000);
  assert.equal(next.cards.initArrears, 5000);
  assert.equal(next.cards.recovered, 1000);
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

/* THE RED LINE ON THE EXPECTED TAB.
   "i missed the banner" -- and it was not there to miss. The old notice fired on `fellBack`,
   which asks the narrower question "the weekday I asked for had no sheet". On a Saturday the
   tab asks for FRIDAY and Friday exists, so nothing fell back and the screen said nothing at
   all while showing a list that was not today's. `isToday` asks the question the reader
   actually has. */
test('the Expected tab says plainly when the list on screen is not today\'s', async () => {
  // NOW is Friday 2026-07-24 and the fixture's sheet is dated that day: this IS today's list.
  const today = await portalApi(fakeDb(tables()), ADMIN, 'expectedDay', {}, NOW);
  assert.equal(today.date, TODAY);
  assert.equal(today.isToday, true, 'Friday, showing Friday: no red line');
  assert.equal(today.today, TODAY);

  // The same book read on SATURDAY. The tab lands on Friday -- the last working day that has a
  // list -- so fellBack stays false, and the old notice therefore said nothing. isToday is what
  // catches it.
  const SAT = Date.parse('2026-07-25T09:00:00Z');
  const sat = await portalApi(fakeDb(tables()), ADMIN, 'expectedDay', {}, SAT);
  assert.equal(sat.weekday, 'FRI', 'a weekend lands on Friday');
  assert.equal(sat.date, TODAY, 'and shows Friday\'s sheet');
  assert.equal(sat.fellBack, false, 'nothing fell back -- which is why the old notice was silent');
  assert.equal(sat.isToday, false, 'but it is NOT today\'s list, and the red line says so');
  assert.equal(sat.today, '2026-07-25');
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
  const gmo = { code: 'G', name: 'GEE MO', role: 'GMO', teams: ['KONGOWE'], tabs: USER_TABS.slice() };
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
  const onlyKongowe = { code: 'X', name: 'NOBODY', role: 'GMO', teams: ['KONGOWE'], tabs: USER_TABS.slice() };
  const d = await portalApi(db, onlyKongowe, 'callReport', { leader: 'JUMA G' }, NOW);
  assert.deepEqual(d.scope, ['KONGOWE'], 'the overlap only');

  const elsewhere = { code: 'Y', name: 'NOBODY2', role: 'GMO', teams: ['SINZA'], tabs: USER_TABS.slice() };
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
  /* PHONES ARE SEEDED THE WAY THE DATABASE ACTUALLY HOLDS THEM -- nine digits, no leading zero,
     which is what normPhone leaves behind on the way in through either door. Seeding "0713..."
     here would make the round trip look lossy when all that changed was the leading zero. */
  book.teams = [{ team: 'KONGOWE', team_code: 'KON123', region: 'DAR', zone: 'A', branch: 'KIBAHA-KONGOWE',
    recovery: 'JUMA G', recovery_no: '713000001', recovery_id: 'R1', gmo: 'GEE MO', gmo_no: '714000002', gmo_id: 'G1',
    manager: 'BOSS', manager_no: '715000003', manager_id: 'M1', credit: 'ANALYST A', credit_id: 'CA9',
    credit_no: '716000004', expected: 'EXP A', expected_no: '717000005', early_col_id: 'E1',
    bike: 'BIKE B', bike_no: '718000006', bike_id: 'B1', legal: 'LEGAL L', legal_no: '719000007', legal_id: 'L1',
    collection: 'CATHERINE', collection_no: '720000008', collection_id: 'C1', opm: 'OPM O', opm_no: '721000009' }];
  const d = await portalApi(fakeDb(book), ADMIN, 'teamsExport', {}, NOW);
  assert.equal(d.count, 1);
  assert.ok(d.headers.includes('COL NO'));
  // "my final thought of the teams and staff table" brought the staff-ID columns back,
  // credit's included -- as plain storage, not as a report key (see importers.test.mjs).
  assert.ok(d.headers.includes('CREDIT ID'), 'the staff ID columns are on the sheet again');
  assert.ok(d.headers.includes('EARLY COL'), 'EXPECTED was renamed on the sheet itself');
  assert.equal(d.headers.includes('EXPECTED'), false, 'the export shows the new name, not both');
  assert.ok(d.headers.includes('REGION'));
  // "The upload template has no branch column, last time i lost all team codes i have to
  // upload when sure" -- BRANCH must round-trip exactly like every other optional column.
  assert.ok(d.headers.includes('BRANCH'), 'branch belongs on the sheet the importer reads back');
  assert.equal(d.headers.length, d.rows[0].length, 'every header has a cell under it');

  // THE ROUND TRIP: what came out goes back in and nothing is lost.
  const { importTeams } = await import('../api/_lib/importers.js');
  const back = importTeams([d.headers].concat(d.rows))[0];
  assert.equal(back.team, 'KONGOWE');
  assert.equal(back.region, 'DAR');
  assert.equal(back.branch, 'KIBAHA-KONGOWE');
  assert.equal(back.collection, 'CATHERINE');
  assert.equal(back.legal, 'LEGAL L');
  assert.equal(back.credit_id, 'CA9', 'CREDIT ID round-trips now, as plain storage');
  assert.equal(back.credit, 'ANALYST A', 'and the analyst is still matched by NAME, not this');
  for (const k of ['recovery_no', 'gmo_no', 'manager_no', 'expected_no', 'bike_no', 'legal_no', 'collection_no',
                   'recovery_id', 'gmo_id', 'manager_id', 'early_col_id', 'bike_id', 'legal_id', 'collection_id']) {
    assert.ok(back[k], k + ' was lost on the way back');
  }

  /* EVERY CELL, NOT A CHOSEN FEW. The list above names the columns that have been lost before;
     this walks the whole exported row instead, so the next column added to the sheet is covered
     by this test on the day it is added rather than the day someone notices it going missing. */
  d.headers.forEach((h, i) => {
    const cell = d.rows[0][i];
    if (!cell) return;                       // an empty cell has nothing to carry back
    assert.ok(Object.values(back).some(v => String(v) === cell),
      'the exported column ' + h + ' (' + cell + ') did not survive the round trip');
  });
});

/* The bug the round-trip test above uncovered: the form only trimmed, so the same officer's
   number was one string when typed and another when uploaded, and the phone search -- which
   matches the normalised nine digits -- could not find the typed one. */
test('a phone typed into the leaders form is stored the same shape as an uploaded one', async () => {
  const book = tables();
  // A database that HAS run 2026-08-09-team-contacts.sql -- otherwise saveTeam's migration
  // guard rightly drops the phone columns rather than failing the whole save.
  book.teams = [{ team: 'KONGOWE', team_code: 'KON123', recovery: null, recovery_no: null,
    manager: null, manager_no: null }];
  const db = fakeDb(book);
  await portalApi(db, ADMIN, 'saveTeam', {
    team: 'KONGOWE', recovery: 'JUMA G', recovery_no: '0713 000 001',
    manager: 'BOSS', manager_no: '+255 715 000 003',
  }, NOW);
  // Read back through the API: fakeDb keeps its own copy of the book, so the write landed there.
  const saved = (await portalApi(db, ADMIN, 'teams', {}, NOW)).rows.find(t => t.team === 'KONGOWE');
  assert.equal(saved.recovery_no, '713000001', 'the leading zero is dropped, as on upload');
  assert.equal(saved.manager_no, '715000003', 'the country code is dropped, as on upload');
  assert.equal(saved.recovery, 'JUMA G', 'a name is still a name -- only phones are normalised');

  const { importTeams } = await import('../api/_lib/importers.js');
  const viaSheet = importTeams([['TEAM', 'RECOVERY NO'], ['KONGOWE', '0713 000 001']])[0];
  assert.equal(viaSheet.recovery_no, saved.recovery_no, 'both doors must agree, exactly');
});

/* "we should update a branch colomn for all teams in both HOPEPMO and HOPELOAN" -- branch is
   the same optional-column shape as region and zone, so it gets the same guard: a database
   that has not run 2026-08-19-team-branch.sql yet must still save everything else. */
test('saveTeam writes branch once the migration has run, and drops it silently if not', async () => {
  const ran = fakeDb({ ...tables(), teams: [{ team: 'KONGOWE', branch: null }] });
  await portalApi(ran, ADMIN, 'saveTeam', { team: 'KONGOWE', branch: 'KIBAHA-KONGOWE' }, NOW);
  assert.equal(ran._dump('teams').find(t => t.team === 'KONGOWE').branch, 'KIBAHA-KONGOWE');

  // No row anywhere carries a `branch` key -- exactly what a database looks like before the
  // migration is run, since existing() (readTeamsAll) is what the guard inspects.
  const notRun = fakeDb({ ...tables(), teams: [{ team: 'KONGOWE' }] });
  await portalApi(notRun, ADMIN, 'saveTeam', { team: 'KONGOWE', branch: 'KIBAHA-KONGOWE', gmo: 'GEE MO' }, NOW);
  const row = notRun._dump('teams').find(t => t.team === 'KONGOWE');
  assert.equal('branch' in row, false, 'dropped rather than sent as a column the database does not have');
  assert.equal(row.gmo, 'GEE MO', 'the rest of the save still goes through');
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

/* =====================================================================================
   ABNORMAL PAYMENTS -- the twelve columns, and who is chasing each one.

     "the columns in the system should be GMO TEAM PMO CUSTOMER NO PAYMENT NO REF NO
      CUSTOMER NAME TRANSACTION ID PAID REF ID PAYMENT SENDER NAME
      where pmo is of either early collection, collection or recovery depending on the
      customer stage"
   ===================================================================================== */
function abnBook() {
  const t = tables();
  t.teams[0] = { ...t.teams[0], expected: 'EARLY E', collection: 'COLLECT C', recovery: 'JUMA G' };
  // Three customers of KONGOWE, one at each stage.
  t.followup_status.push(
    { ref: 'D1', team: 'KONGOWE', full_name: 'BEHIND', status: 'Defaulter', arrears: 100 },
    { ref: 'C1', team: 'KONGOWE', full_name: 'CHRONIC ONE', status: 'Chronic', arrears: 900 });
  t.abnormal_payments = [
    { id: 'A1', team: 'KONGOWE', pmo: null, ref_no: 'D1', ref_id: 'RID1', paid: 1234,
      customer_name: 'BEHIND', created_at: '2026-07-24T08:00:00Z' },
    { id: 'A2', team: 'KONGOWE', pmo: null, ref_no: 'C1', ref_id: 'RID2', paid: 2345,
      customer_name: 'CHRONIC ONE', created_at: '2026-07-24T08:00:00Z' },
    { id: 'A3', team: 'KONGOWE', pmo: null, ref_no: '111', ref_id: 'RID3', paid: 3456,
      customer_name: 'AMINA H', created_at: '2026-07-24T08:00:00Z' },
    { id: 'A4', team: 'KONGOWE', pmo: 'SOMEBODY REAL', ref_no: 'D1', ref_id: 'RID4', paid: 4567,
      customer_name: 'BEHIND', created_at: '2026-07-24T08:00:00Z' },
    { id: 'A5', team: 'KONGOWE', pmo: null, ref_no: 'NOBODY-KNOWS', ref_id: 'RID5', paid: 5678,
      customer_name: '?', created_at: '2026-07-24T08:00:00Z' },
  ];
  return t;
}

test('abnormal payments: a blank PMO is filled from the customer\'s stage', async () => {
  const d = await portalApi(dbWithRpc(abnBook()), ADMIN, 'abnormal', {}, NOW);
  const by = Object.fromEntries(d.rows.map(r => [r.id, r]));
  // A defaulter is the collection officer's; chronic is recovery's; still on the expected
  // deck is early collection's. Each named from the teams table.
  assert.equal(by.A1.pmo, 'COLLECT C');
  assert.equal(by.A1.pmo_stage, 'COLLECTION');
  assert.equal(by.A2.pmo, 'JUMA G');
  assert.equal(by.A2.pmo_stage, 'RECOVERY');
  assert.equal(by.A3.pmo, 'EARLY E');
  assert.equal(by.A3.pmo_stage, 'EARLY COLLECTION');
});

test('abnormal payments: what the sheet said is NEVER overwritten', async () => {
  /* The sheet is the record. Filling a blank helps; replacing a name somebody typed would be
     the system quietly disagreeing with the document it was given. */
  const d = await portalApi(dbWithRpc(abnBook()), ADMIN, 'abnormal', {}, NOW);
  const a4 = d.rows.find(r => r.id === 'A4');
  assert.equal(a4.pmo, 'SOMEBODY REAL');
  assert.equal(a4.pmo_stage, undefined, 'and it is not marked as filled, because it was not');
});

test('abnormal payments: a reference in neither book is left blank, not guessed at', async () => {
  /* An unknown customer wrongly labelled "early collection" sends somebody to the wrong desk,
     which is worse than an empty cell that says "find out". */
  const d = await portalApi(dbWithRpc(abnBook()), ADMIN, 'abnormal', {}, NOW);
  const a5 = d.rows.find(r => r.id === 'A5');
  assert.ok(!a5.pmo, 'no stage could be established, so nothing is claimed');
  assert.equal(d.pmoFilled, 3, 'three of the four blanks were answerable');
});

test('abnormal payments: REF ID survives the round trip -- it was never on screen before', async () => {
  const d = await portalApi(dbWithRpc(abnBook()), ADMIN, 'abnormal', {}, NOW);
  assert.deepEqual(d.rows.filter(r => r.source === 'upload').map(r => r.ref_id).sort(),
    ['RID1', 'RID2', 'RID3', 'RID4', 'RID5']);
});

/* =====================================================================================
   "I uploaded received payments but not a single abnormal payment was flagged"

   Because nothing flagged anything. The screen has always said "amounts not in multiples of
   TZS 500 / 1,000", and that sentence was the only place the rule existed -- no code applied
   it. Uploading the payments themselves did nothing at all.
   ===================================================================================== */
const { isAbnormalAmount } = await import('../api/_lib/portal-core.js');

test('the rule itself: a whole multiple of the step is clean, anything else is not', () => {
  for (const ok of [79500, 100000, 500, 1000, 250000]) {
    assert.equal(isAbnormalAmount(ok, 500), false, String(ok));
  }
  for (const bad of [79543, 900, 1001, 12345]) {
    assert.equal(isAbnormalAmount(bad, 500), true, String(bad));
  }
  // Zero and blank are a gap in the file, not an irregular payment.
  for (const none of [0, null, undefined, '', 'x']) {
    assert.equal(isAbnormalAmount(none, 500), false, String(none));
  }
  // The step is company policy, not arithmetic: at 1000, 79,500 becomes irregular.
  assert.equal(isAbnormalAmount(79500, 1000), true);
});

test('an irregular received payment is flagged, carrying its own columns across', async () => {
  const t = tables();
  t.received_payments = [{ id: 'r9', team: 'KONGOWE', amount_paid: 79543, paid_at: TODAY,
    customer_name: 'ASHA CHOMBINGA', customer_no: '686852827', payment_no: '255675218973',
    transaction_id: 'TX9', ref_no: 'R9', ref_id: 'RID9', sender_name: 'ASHA C' }];
  const d = await portalApi(dbWithRpc(t), ADMIN, 'abnormal', {}, NOW);
  const r = d.rows.find(x => x.transaction_id === 'TX9');
  assert.ok(r, '79,543 is not a whole multiple of 500');
  assert.equal(r.source, 'received', 'and it is marked as one the system worked out');
  assert.equal(r.paid, 79543);
  assert.equal(r.contact_no, '686852827');
  assert.equal(r.phone_number, '255675218973');
  assert.equal(r.ref_id, 'RID9');
  assert.equal(r.customer_name, 'ASHA CHOMBINGA');
});

test('an uploaded row wins over the derived one for the same transaction', async () => {
  /* Somebody typed the uploaded row. It is not this code's place to duplicate their work. */
  const t = tables();
  t.received_payments = [{ id: 'r9', team: 'KONGOWE', amount_paid: 79543, paid_at: TODAY,
    transaction_id: 'TX9', customer_name: 'FROM PAYMENTS' }];
  t.abnormal_payments = [{ id: 'a9', team: 'KONGOWE', paid: 79543, transaction_id: 'TX9',
    customer_name: 'FROM THE SHEET', pmo: 'TYPED BY HAND', created_at: TODAY + 'T05:00:00Z' }];
  const d = await portalApi(dbWithRpc(t), ADMIN, 'abnormal', {}, NOW);
  assert.equal(d.rows.filter(r => r.transaction_id === 'TX9').length, 1, 'not two');
  assert.equal(d.rows[0].customer_name, 'FROM THE SHEET');
  assert.equal(d.rows[0].pmo, 'TYPED BY HAND', 'and what somebody typed is untouched');
});

test('a clean payment is never flagged -- the reported sample stays quiet', async () => {
  // The two rows from the real sheet: 79,500 and 100,000, both whole multiples of 500.
  const t = tables();
  t.abnormal_payments = [];
  t.received_payments = [
    { id: 'p1', team: 'KONGOWE', amount_paid: 79500, paid_at: TODAY, transaction_id: 'T1' },
    { id: 'p2', team: 'KONGOWE', amount_paid: 100000, paid_at: TODAY, transaction_id: 'T2' }];
  const d = await portalApi(dbWithRpc(t), ADMIN, 'abnormal', {}, NOW);
  assert.equal(d.derived, 0);
  assert.equal(d.count, 0);
  assert.equal(d.scanned, 2, 'both were looked at, and both were clean');
});

test('the step is a setting, so the policy can change without a deploy', async () => {
  const t = tables();
  t.abnormal_payments = [];
  t.settings.push({ key: 'ABNORMAL_STEP', value: '1000' });
  t.received_payments = [{ id: 'p1', team: 'KONGOWE', amount_paid: 79500, paid_at: TODAY, transaction_id: 'T1' }];
  const d = await portalApi(dbWithRpc(t), ADMIN, 'abnormal', {}, NOW);
  assert.equal(d.step, 1000);
  assert.equal(d.derived, 1, 'clean at 500, irregular at 1000');
});

test('an officer only ever sees their own team\'s irregular payments', async () => {
  const t = tables();
  t.abnormal_payments = [];
  t.received_payments = [
    { id: 'p1', team: 'KONGOWE', amount_paid: 901, paid_at: TODAY, transaction_id: 'T1' },
    { id: 'p2', team: 'MBAGALA', amount_paid: 902, paid_at: TODAY, transaction_id: 'T2' }];
  const d = await portalApi(dbWithRpc(t), GMO, 'abnormal', {}, NOW);
  assert.equal(d.count, 1);
  assert.equal(d.rows[0].transaction_id, 'T1');
});

/* =====================================================================================
   ONE DEFINITION OF "COLLECTION OFFICER", AND A COMPANY TOTAL WITH EVERY BOARD IN IT.

     "change it to be the one reading at commissions since commissions are using
      PMO COLLECTION instead of COLLECTION"
     "and the total collected commissions aint computing for several roles"
   ===================================================================================== */
const { isPmoRole: isPmo, hasCollectionWord } = await import('../api/_lib/pmo.js');

test('commissions recognise a collection officer however the role is spelled', () => {
  /* The call app was taught this so Catherine's list would narrow; commissions was not, and
     compared to the configured name by exact equality. The moment the roles were renamed to
     COLLECTION the PMO board matched nobody and went empty -- two screens holding different
     opinions about the same person. */
  for (const spelling of ['PMO COLLECTION', 'pmo-collection', 'Pmo  Collection',
                          'COLLECTION', 'Collection Officer', 'EARLY COLLECTION', 'COLLECTOR']) {
    assert.equal(isPmo(spelling, 'PMO COLLECTION'), true, spelling);
  }
});

test('and no other role is swept into it', () => {
  for (const role of ['RECOVERY', 'GMO', 'MANAGER', 'BIKE', 'OPM', 'LEGAL', 'CREDIT',
                      'CREDIT ANALYST', 'ADMIN', 'OFFICER', 'EXPECTED', '']) {
    assert.equal(isPmo(role, 'PMO COLLECTION'), false, role);
    assert.equal(hasCollectionWord(role), false, role);
  }
});

test('a renamed PMO_ROLE is still matched exactly, whatever it says', () => {
  // The setting exists so a deployment can call them something with no English in it at all.
  assert.equal(isPmo('WAKUSANYAJI', 'WAKUSANYAJI'), true);
  assert.equal(isPmo('WAKUSANYAJI', 'PMO COLLECTION'), false);
});

test('the company commission total includes the PMO board, not just two of the three', async () => {
  /* Three schemes pay three different people on this screen: recovery on a percentage, early
     collection per PAID/OVERPAID, and PMO collection on a band. The headline added up only the
     first two, so "company total" was short by an entire category of officer -- and the more
     the PMO side earned, the more wrong it got. */
  const d = await portalApi(dbWithRpc(), ADMIN, 'commission', {}, NOW);
  assert.ok(d.totals.split, 'the split is sent so a wrong figure can be taken apart on screen');
  const { recDay, colDay, pmoDay, recWeek, colWeek, pmoWeek } = d.totals.split;
  // The total is exactly its three parts -- no board left out, and nothing counted twice.
  assert.equal(Math.round(d.totals.day), Math.round(recDay + colDay + pmoDay));
  assert.equal(Math.round(d.totals.week), Math.round(recWeek + colWeek + pmoWeek));
  // And the PMO part agrees with the board it was computed from.
  assert.equal(Math.round(pmoDay), Math.round(d.pmoTotals.day));
  assert.equal(Math.round(pmoWeek), Math.round(d.pmoTotals.week));
});

test('a collection officer whose code says COLLECTION now reaches the PMO board', async () => {
  /* End to end, the way it actually broke: the role renamed, the board empty, and the
     commission computed on it gone with it. */
  const t = tables();
  t.access_codes.push({ code: 'CAT', name: 'CATHERINE', role: 'COLLECTION',
    teams: ['KONGOWE'], tabs: [] });
  const d = await portalApi(dbWithRpc(t), ADMIN, 'commission', {}, NOW);
  assert.ok(d.pmoDiag.withRole >= 1, 'the code is recognised as carrying the collection role');
  assert.ok(d.pmo.some(r => String(r.officer).toUpperCase() === 'CATHERINE'),
    'and she appears on the PMO board that pays her');
  /* "orodha has no these people" -- a PMO officer sits on the combined table too, with
     their pay in its own column, agreeing with the board it came from. */
  const cat = d.week.find(r => String(r.officer).toUpperCase() === 'CATHERINE');
  assert.ok(cat, 'she sits on the combined Orodha as well');
  const board = d.pmo.find(r => String(r.officer).toUpperCase() === 'CATHERINE');
  assert.equal(cat.pmoComm, Math.round((board.weekCommission || 0) + (board.bonus || 0)),
    'the Orodha carries the same pay the PMO board computed');
  assert.equal(cat.pct == null ? null : cat.pct, board.weekPct == null ? null : board.weekPct,
    'and her weekly % is the PMO board\'s own week percentage');
});

/* =====================================================================================
   "Imeshindikana / Could not load. column received_payments.ref_id does not exist"

   Migrations here are run by hand, so EVERY deployment spends time in the state where an
   optional column does not exist yet. PostgREST refuses the WHOLE query for one unknown
   column -- so asking for ref_id on a database that has not run
   db/migrations/2026-08-10-received-ref-id.sql took the entire Abnormal Payments screen down.

   THE LESSON, AND IT IS THE WHOLE POINT OF THESE TESTS: an optional column is optional in BOTH
   DIRECTIONS. The write path was already guarded (api/upload.js probes the table before
   sending) and the read path was not. Guarding one and not the other is not a smaller version
   of the same care -- it is a screen that loads until somebody uses the feature.
   ===================================================================================== */
test('abnormal payments loads on a database that has not run the ref_id migration', async () => {
  const t = tables();
  t.abnormal_payments = [];
  t.received_payments = [{ id: 'p1', team: 'KONGOWE', amount_paid: 79543, paid_at: TODAY,
    transaction_id: 'TX1', customer_name: 'ASHA' }];
  // The database as it stands before that SQL is pasted in.
  const db = fakeDb(t, { rpc: UPLOAD_STATUS_RPC, missingColumns: { received_payments: ['ref_id'] } });
  const d = await portalApi(db, ADMIN, 'abnormal', {}, NOW);
  assert.equal(d.derived, 1, 'the rule still runs');
  assert.equal(d.rows[0].transaction_id, 'TX1');
  assert.equal(d.rows[0].ref_id, undefined, 'just without the column that is not there yet');
});

test('and it still reads ref_id once the migration HAS been run', async () => {
  const t = tables();
  t.abnormal_payments = [];
  t.received_payments = [{ id: 'p1', team: 'KONGOWE', amount_paid: 79543, paid_at: TODAY,
    transaction_id: 'TX1', ref_id: 'RID1' }];
  const d = await portalApi(dbWithRpc(t), ADMIN, 'abnormal', {}, NOW);
  assert.equal(d.rows[0].ref_id, 'RID1');
});

test('a real failure is still a real failure -- the fallback is not a blanket catch', async () => {
  /* Falling back on ANY error would turn a database having a bad minute into a silent decision
     to drop a column, which is how a fault becomes invisible instead of fixed. */
  const t = tables();
  t.abnormal_payments = [];
  const db = fakeDb(t, { rpc: UPLOAD_STATUS_RPC,
    missingColumns: { received_payments: ['team'] } });   // not ref_id -- something else broke
  await assert.rejects(() => portalApi(db, ADMIN, 'abnormal', {}, NOW));
});

/* =====================================================================================
   A DUPLICATE TEAM IS MERGED, NOT DELETED.

     "Team TUNDURU should be deleted because the correct one is Tunduru. it fails saying it has
      expected snapshots"

   The refusal is right: removing a team that still holds records would orphan them -- snapshots
   pointing at a team that no longer exists, invisible on every screen. But it answered the
   wrong question. A misspelled duplicate holds REAL WORK -- real customers, real arrears, real
   recovery -- sitting under a name nobody meant to create. The admin never wanted it thrown
   away; they wanted it filed under the right name.
   ===================================================================================== */
function dupBook() {
  const t = tables();
  t.teams.push({ team: 'TUNDURU', opm: null, recovery: null, gmo: null, manager: null,
    credit: null, expected: null, bike: null });
  t.teams.push({ team: 'TUNDURU SOUTH', opm: null, recovery: null, gmo: null, manager: null,
    credit: null, expected: null, bike: null });
  t.repayment_snapshots.push({ ref: 'T1', full_name: 'MISFILED', team: 'TUNDURU',
    payment_expected: 900, arrears: 0, todays_status: 'UNPAID', snapshot_type: 'today',
    snapshot_date: TODAY, upload_batch: 'bt', created_at: TODAY + 'T04:00:00Z' });
  t.followup_status.push({ ref: 'T1', team: 'TUNDURU', full_name: 'MISFILED', arrears: 500,
    status: 'Defaulter' });
  t.loans.push({ id: 'lt1', team: 'TUNDURU', stage: 'approved', principal_amt: 100000,
    approved_date: TODAY });
  t.call_users.push({ user_id: 'UT', name: 'FIELD ONE', team: 'TUNDURU', role: 'OFFICER',
    device_id: 'dT', active: true });
  return t;
}

test('deleting a team that holds records is still refused, and says merging is the answer', async () => {
  await assert.rejects(
    () => portalApi(dbWithRpc(dupBook()), ADMIN, 'deleteTeam', { team: 'TUNDURU' }, NOW),
    e => /still holds/.test(e.message) && /MERGE/.test(e.message));
});

test('merging carries every record across, then removes only the name', async () => {
  const db = dbWithRpc(dupBook());
  const r = await portalApi(db, ADMIN, 'deleteTeam',
    { team: 'TUNDURU', moveTo: 'TUNDURU SOUTH' }, NOW);
  assert.equal(r.mergedInto, 'TUNDURU SOUTH');

  // Nothing is left behind under the wrong name...
  const left = n => db._dump(n).filter(x => String(x.team).toUpperCase() === 'TUNDURU').length;
  for (const tbl of ['repayment_snapshots', 'followup_status', 'loans', 'call_users']) {
    assert.equal(left(tbl), 0, tbl + ' still has rows under the deleted name');
  }
  // ...and nothing was thrown away either.
  const now = n => db._dump(n).filter(x => String(x.team).toUpperCase() === 'TUNDURU SOUTH').length;
  assert.equal(now('repayment_snapshots'), 1);
  assert.equal(now('followup_status'), 1);
  assert.equal(now('loans'), 1);
  assert.equal(now('call_users'), 1, 'the handset follows its team rather than being cut off');
  // Only the name is gone.
  assert.equal(db._dump('teams').some(x => x.team === 'TUNDURU'), false);
  assert.equal(db._dump('teams').some(x => x.team === 'TUNDURU SOUTH'), true);
});

test('merging into a team that does not exist is refused, not silently invented', async () => {
  await assert.rejects(
    () => portalApi(dbWithRpc(dupBook()), ADMIN, 'deleteTeam',
      { team: 'TUNDURU', moveTo: 'NOWHERE' }, NOW),
    e => /no team called NOWHERE/.test(e.message));
});

test('a team cannot be merged into itself', async () => {
  await assert.rejects(
    () => portalApi(dbWithRpc(dupBook()), ADMIN, 'deleteTeam',
      { team: 'TUNDURU', moveTo: 'tunduru' }, NOW),
    e => /itself/.test(e.message));
});

test('an empty team still deletes outright -- merging is only for one holding records', async () => {
  const t = tables();
  t.teams.push({ team: 'EMPTYONE', opm: null, recovery: null, gmo: null, manager: null,
    credit: null, expected: null, bike: null });
  const db = dbWithRpc(t);
  const r = await portalApi(db, ADMIN, 'deleteTeam', { team: 'EMPTYONE' }, NOW);
  assert.equal(r.mergedInto, undefined);
  assert.equal(db._dump('teams').some(x => x.team === 'EMPTYONE'), false);
});

test('only an admin may merge teams', async () => {
  await assert.rejects(
    () => portalApi(dbWithRpc(dupBook()), GMO, 'deleteTeam',
      { team: 'TUNDURU', moveTo: 'TUNDURU SOUTH' }, NOW),
    e => e.status === 403);
});

/* =====================================================================================
   "abnomal payments worked but not counting at dashboard"

   The tab learned to work irregular payments out for itself; the dashboard tile did not, so it
   went on counting only the rows somebody had uploaded. Two screens, one question, two answers
   -- and the dashboard's was the SMALLER one, which is the direction nobody notices.

   These assertions are deliberately written as "the two screens agree" rather than as two
   separate expected numbers. A test that hard-codes both can pass while they drift apart; one
   that compares them cannot.
   ===================================================================================== */
function abnDashBook() {
  const t = tables();
  t.abnormal_payments = [{ id: 'a1', team: 'KONGOWE', paid: 1234, transaction_id: 'UP1',
    created_at: TODAY + 'T05:00:00Z' }];
  t.received_payments = [
    { id: 'p1', team: 'KONGOWE', amount_paid: 79543, paid_at: TODAY, transaction_id: 'TX1' },
    { id: 'p2', team: 'KONGOWE', amount_paid: 12345, paid_at: TODAY, transaction_id: 'TX2' },
    { id: 'p3', team: 'KONGOWE', amount_paid: 80000, paid_at: TODAY, transaction_id: 'TX3' },
    // Already uploaded above -- must not be counted twice on either screen.
    { id: 'p4', team: 'KONGOWE', amount_paid: 1234, paid_at: TODAY, transaction_id: 'UP1' },
  ];
  return t;
}

test('the dashboard counts irregular payments the rule found, not just uploaded ones', async () => {
  const d = await portalApi(dbWithRpc(abnDashBook()), ADMIN, 'dashboardFull', {}, NOW);
  // 1 uploaded + 2 found (79,543 and 12,345). 80,000 is clean; UP1 is already uploaded.
  assert.equal(d.cards.abnormal, 3);
  assert.equal(d.cards.abnormalAmount, 1234 + 79543 + 12345);
});

test('and it agrees EXACTLY with the Abnormal Payments tab', async () => {
  /* The whole point. Written as an agreement rather than two numbers, because a test that
     hard-codes both sides can pass while the screens drift apart. */
  const t = abnDashBook();
  const dash = await portalApi(dbWithRpc(t), ADMIN, 'dashboardFull', {}, NOW);
  const tab = await portalApi(dbWithRpc(t), ADMIN, 'abnormal', {}, NOW);
  assert.equal(dash.cards.abnormal, tab.count);
  assert.equal(dash.cards.abnormalAmount,
    tab.rows.reduce((s, r) => s + (Number(r.paid) || 0), 0));
});

test('a payment in both the sheet and the ledger is counted once, on both screens', async () => {
  const t = abnDashBook();
  const dash = await portalApi(dbWithRpc(t), ADMIN, 'dashboardFull', {}, NOW);
  const tab = await portalApi(dbWithRpc(t), ADMIN, 'abnormal', {}, NOW);
  assert.equal(tab.rows.filter(r => r.transaction_id === 'UP1').length, 1);
  assert.equal(dash.cards.abnormal, tab.count, 'and the tile does not double it either');
});

test('an officer sees only their own team on the dashboard tile too', async () => {
  const t = abnDashBook();
  t.received_payments.push({ id: 'p9', team: 'MBAGALA', amount_paid: 55555, paid_at: TODAY,
    transaction_id: 'TX9' });
  const dash = await portalApi(dbWithRpc(t), GMO, 'dashboardFull', {}, NOW);
  const tab = await portalApi(dbWithRpc(t), GMO, 'abnormal', {}, NOW);
  assert.equal(dash.cards.abnormal, tab.count);
  assert.ok(!tab.rows.some(r => r.transaction_id === 'TX9'), 'MBAGALA is not theirs');
});

/* =====================================================================================
   "it should workout in the entire system including lists of teams accessed in access codes"

   The first version moved five tables. A team name is stored in FIFTEEN places, and two of
   them are LISTS rather than columns -- a PMO collection officer holds thirty-odd teams as an
   array on their access code, and a leader's scope is the same shape on their handset.

   Moving five of fifteen would have left ten pointing at a team that no longer exists, which
   is precisely the orphaning the delete guard was there to prevent -- and it would have looked
   like it worked, which is worse than refusing outright.
   ===================================================================================== */
function fullMergeBook() {
  const t = tables();
  t.teams.push({ team: 'TUNDURU', opm: null, recovery: null, gmo: null, manager: null,
    credit: null, expected: null, bike: null });
  t.teams.push({ team: 'TUNDURU SOUTH', opm: null, recovery: null, gmo: null, manager: null,
    credit: null, expected: null, bike: null });
  const T = 'TUNDURU';
  t.repayment_snapshots.push({ ref: 'M1', team: T, payment_expected: 100, arrears: 0,
    todays_status: 'UNPAID', snapshot_type: 'today', snapshot_date: TODAY, upload_batch: 'bm',
    created_at: TODAY + 'T04:00:00Z' });
  t.defaulter_snapshots.push({ ref: 'M1', team: T, arrears: 100, status: 'Defaulter',
    snapshot_type: 'current', weekday: 'FRI', snapshot_date: TODAY, upload_batch: 'bm2',
    created_at: TODAY + 'T04:00:00Z' });
  t.followup_status.push({ ref: 'M1', team: T, full_name: 'C', arrears: 100, status: 'Defaulter' });
  t.followup_comments.push({ id: 'cm1', ref: 'M1', team: T, comment: 'x', created_at: TODAY + 'T05:00:00Z' });
  t.loans.push({ id: 'lm1', team: T, stage: 'approved', principal_amt: 1, approved_date: TODAY });
  t.received_payments.push({ id: 'rp1', team: T, amount_paid: 500, paid_at: TODAY });
  t.abnormal_payments.push({ id: 'ap1', team: T, paid: 1, created_at: TODAY + 'T05:00:00Z' });
  t.complaints.push({ id: 'cp1', team: T, complainant: 'X', details: 'y', created_at: TODAY + 'T05:00:00Z' });
  t.complaint_log = [{ id: 'cl1', team: T, action: 'opened', created_at: TODAY + 'T05:00:00Z' }];
  t.restructures.push({ id: 'rs9', ref: 'M1', team: T, status: 'Pending', created_at: TODAY + 'T05:00:00Z' });
  t.demand_notices.push({ id: 'dn9', ref: 'M1', team: T, created_at: TODAY + 'T05:00:00Z' });
  t.call_logs = (t.call_logs || []).concat([{ id: 'clg1', user_id: 'U1', team: T, phone: '07', duration: 9, call_date: TODAY }]);
  t.call_users.push({ user_id: 'UM', name: 'ON WRONG TEAM', team: T, role: 'OFFICER',
    device_id: 'dM', active: true, leader_teams: ['TUNDURU', 'KONGOWE'] });
  // The two LIST-shaped ones -- the part that was missed.
  t.access_codes.push({ code: 'PMO1', name: 'CATHERINE', role: 'PMO COLLECTION',
    teams: ['TUNDURU', 'KONGOWE'], tabs: [] });
  t.access_codes.push({ code: 'PMO2', name: 'HOLDS BOTH', role: 'PMO COLLECTION',
    teams: ['TUNDURU', 'TUNDURU SOUTH'], tabs: [] });
  return t;
}

test('a merge moves EVERY table that stores a team name, not just the blocking four', async () => {
  const db = dbWithRpc(fullMergeBook());
  await portalApi(db, ADMIN, 'deleteTeam', { team: 'TUNDURU', moveTo: 'TUNDURU SOUTH' }, NOW);
  const stillWrong = [];
  for (const tbl of ['repayment_snapshots', 'defaulter_snapshots', 'followup_status',
    'followup_comments', 'loans', 'received_payments', 'abnormal_payments', 'complaints',
    'complaint_log', 'restructures', 'demand_notices', 'call_logs', 'call_users']) {
    if (db._dump(tbl).some(r => String(r.team || '').toUpperCase() === 'TUNDURU')) stillWrong.push(tbl);
  }
  assert.deepEqual(stillWrong, [],
    'these tables still point at a team that no longer exists: ' + stillWrong.join(', '));
});

test('and the TEAM LISTS on access codes move with it', async () => {
  /* The part that was missed. A PMO collection officer holds thirty-odd teams as a list on
     their own code; a name left behind there is somebody scoped to a team that is gone. */
  const db = dbWithRpc(fullMergeBook());
  await portalApi(db, ADMIN, 'deleteTeam', { team: 'TUNDURU', moveTo: 'TUNDURU SOUTH' }, NOW);
  const codes = db._dump('access_codes');
  const one = codes.find(c => c.code === 'PMO1');
  assert.deepEqual(one.teams.slice().sort(), ['KONGOWE', 'TUNDURU SOUTH']);
  // Somebody holding BOTH spellings ends up with one, not a duplicate.
  const both = codes.find(c => c.code === 'PMO2');
  assert.deepEqual(both.teams, ['TUNDURU SOUTH']);
});

test('and a leader\'s scope on their handset moves too', async () => {
  const db = dbWithRpc(fullMergeBook());
  await portalApi(db, ADMIN, 'deleteTeam', { team: 'TUNDURU', moveTo: 'TUNDURU SOUTH' }, NOW);
  const u = db._dump('call_users').find(x => x.user_id === 'UM');
  assert.equal(u.team, 'TUNDURU SOUTH');
  assert.deepEqual(u.leader_teams.slice().sort(), ['KONGOWE', 'TUNDURU SOUTH']);
});

test('the merge reports what it carried, table by table', async () => {
  const db = dbWithRpc(fullMergeBook());
  const r = await portalApi(db, ADMIN, 'deleteTeam', { team: 'TUNDURU', moveTo: 'TUNDURU SOUTH' }, NOW);
  assert.equal(r.mergedInto, 'TUNDURU SOUTH');
  assert.ok(r.moved['access codes'] >= 2, 'including the list-shaped ones');
  assert.ok(r.moved['leader scopes'] >= 1);
  assert.ok(Object.keys(r.moved).length >= 10, 'and it is not quietly moving three of them');
});

test('history is NOT rewritten by a merge', async () => {
  /* performance_records copies a name as text on purpose -- last March's best team stays
     whatever it was called last March. A merge today must not reach back and change that. */
  const t = fullMergeBook();
  t.performance_records = [{ id: 'pr1', period: 'week', period_start: '2026-07-13',
    metric: 'sales', scope: 'team', name: 'TUNDURU', value: 100, recorded_at: '2026-07-17T09:00:00Z' }];
  const db = dbWithRpc(t);
  await portalApi(db, ADMIN, 'deleteTeam', { team: 'TUNDURU', moveTo: 'TUNDURU SOUTH' }, NOW);
  assert.equal(db._dump('performance_records')[0].name, 'TUNDURU',
    'the photograph stays what it was');
});

/* =====================================================================================
   "On choosing team sahihi Tunduru is not appearing"

   teams.team is the primary key and Postgres compares it EXACTLY, so TUNDURU and Tunduru are
   two separate rows -- which is how the duplicate came to exist in the first place. Both ends
   of the merge collapsed them: deleteTeam uppercased whatever it was given, and the picker
   excluded the destination case-insensitively. So the one team somebody was trying to merge
   INTO was the one team they could not choose.
   ===================================================================================== */
function caseDupBook() {
  const t = tables();
  t.teams.push({ team: 'TUNDURU', opm: null, recovery: null, gmo: null, manager: null,
    credit: null, expected: null, bike: null });
  t.teams.push({ team: 'Tunduru', opm: null, recovery: null, gmo: null, manager: null,
    credit: null, expected: null, bike: null });
  t.repayment_snapshots.push({ ref: 'CD1', team: 'TUNDURU', payment_expected: 100, arrears: 0,
    todays_status: 'UNPAID', snapshot_type: 'today', snapshot_date: TODAY, upload_batch: 'bcd',
    created_at: TODAY + 'T04:00:00Z' });
  return t;
}

test('TUNDURU merges into Tunduru -- two rows that differ only in case are two teams', async () => {
  const db = dbWithRpc(caseDupBook());
  const r = await portalApi(db, ADMIN, 'deleteTeam',
    { team: 'TUNDURU', moveTo: 'Tunduru' }, NOW);
  assert.equal(r.mergedInto, 'Tunduru');
  const teamsLeft = db._dump('teams').map(x => x.team);
  assert.ok(!teamsLeft.includes('TUNDURU'), 'the wrong spelling is gone');
  assert.ok(teamsLeft.includes('Tunduru'), 'and the right one remains');
  assert.equal(db._dump('repayment_snapshots').find(x => x.ref === 'CD1').team, 'Tunduru');
});

test('and the same merge the other way round works too', async () => {
  const db = dbWithRpc(caseDupBook());
  const r = await portalApi(db, ADMIN, 'deleteTeam',
    { team: 'Tunduru', moveTo: 'TUNDURU' }, NOW);
  assert.equal(r.mergedInto, 'TUNDURU');
  assert.ok(!db._dump('teams').map(x => x.team).includes('Tunduru'));
});

test('typing a name in any case still finds the one team that has it', async () => {
  /* The reason this used to uppercase at all. Where there is only ONE spelling, the old
     forgiving behaviour must survive -- every other use of delete depends on it. */
  const t = tables();
  t.teams.push({ team: 'SINGLETON', opm: null, recovery: null, gmo: null, manager: null,
    credit: null, expected: null, bike: null });
  const db = dbWithRpc(t);
  await portalApi(db, ADMIN, 'deleteTeam', { team: 'singleton' }, NOW);
  assert.ok(!db._dump('teams').map(x => x.team).includes('SINGLETON'));
});

test('an ambiguous spelling is refused and both are named, never guessed', async () => {
  /* Guessing which of two spellings somebody meant is exactly how the wrong one gets deleted. */
  await assert.rejects(
    () => portalApi(dbWithRpc(caseDupBook()), ADMIN, 'deleteTeam', { team: 'tunduru' }, NOW),
    e => /More than one team is spelled/.test(e.message)
      && /TUNDURU/.test(e.message) && /Tunduru/.test(e.message));
});

test('a team still cannot be merged into itself, compared as stored', async () => {
  await assert.rejects(
    () => portalApi(dbWithRpc(caseDupBook()), ADMIN, 'deleteTeam',
      { team: 'TUNDURU', moveTo: 'TUNDURU' }, NOW),
    e => /itself/.test(e.message));
});

/* =====================================================================================
   "Some customers werent seen in credit users for defaulters, while troubleshooting they aint
    seen anywhere even in my admin user yet they are in the uploaded file"

   She was in the database the whole time. Defaulter decks are stored PER WEEKDAY -- deliberate,
   and it must stay, because an initial MON deck against a current TUE deck measures two
   different populations and reports the gap as recovery. But every defaulter screen reads
   TODAY'S weekday, so a customer whose deck went in under Tuesday is invisible on Monday. To
   everyone, admin included, with nothing anywhere to say so.

   The data is right and the screens are right, and the person looking has no way to tell which
   of the two is lying to them. That is what this answers.
   ===================================================================================== */
const K2 = v => String(v == null ? '' : v).trim().toUpperCase();
function estherBook(weekday) {
  const t = tables();
  t.teams.push({ team: 'GOBA', opm: null, recovery: 'R', gmo: 'G', manager: 'M',
    credit: 'ANALYST A', expected: 'E', bike: 'B' });
  const base = { ref: '2-209-72865', docket_no: '2209728651', full_name: 'ESTER PETER OMARY',
    contact: '746115063', guarantor_name: 'PETER CHARLES OMARY', guarantor_contact: '783384221',
    disb_date: '2026-07-09', status: 'Partial Defaulter', ds: '2-4', dc: 2, days_elapsed: 31,
    arrears: 1766336, balance: 10833000, branch: 'GOBA-TEGETA', team: 'GOBA',
    snapshot_date: TODAY, upload_batch: 'bg', created_at: TODAY + 'T04:00:00Z' };
  t.defaulter_snapshots.push({ ...base, snapshot_type: 'current', weekday });
  t.defaulter_snapshots.push({ ...base, snapshot_type: 'initial', weekday, arrears: 2000000 });
  return t;
}

/* "As a defaulter; they are meant to be visible everyday unless its expected defaulter"

   The rule, stated by the person who owns it. A defaulter does not stop being a defaulter
   because the deck they arrived in was filed under Tuesday. Only the Exp.Def ROTATION is
   weekday-shaped, and that is because its whole purpose is a two-day cycle.

   This was the opposite before: every daily list pinned itself to today's weekday, so a
   customer in Tuesday's deck was nowhere on Monday -- for everybody, admin included. */
test('a defaulter is visible EVERY day, whatever weekday their deck was filed under', async () => {
  const t = estherBook('TUE');                     // NOW is Friday -- a different weekday
  /* The deck-driven screens. followup/promises read the follow-up REGISTER, which the upload
     rebuilds separately -- a different path, and not what the weekday pin ever touched. */
  for (const fn of ['defaulters', 'expectedDefaulters']) {
    const d = await portalApi(dbWithRpc(t), ADMIN, fn, {}, NOW);
    assert.ok((d.rows || []).some(r => K2(r.ref) === '2-209-72865'),
      fn + ' hides a defaulter whose deck was filed under another weekday');
  }
  // PAR reports aggregates rather than customers, so it is checked on its own count.
  const par = await portalApi(dbWithRpc(t), ADMIN, 'par', {}, NOW);
  assert.ok(par.totals.customers >= 1, 'PAR counts her too');
});

test('and the credit analyst has them in their book on any day', async () => {
  const d = await portalApi(dbWithRpc(estherBook('TUE')), ADMIN, 'credit', {}, NOW);
  const a = d.rows.find(r => r.analyst === 'ANALYST A');
  assert.ok(a && a.cnt >= 1, 'the analyst who owns GOBA can see their count 1-6 customer');
});

test('the Defaulters tab still honours an EXPLICIT weekday choice', async () => {
  /* The day buttons must keep meaning what they say -- "show me Tuesday's deck" is a real
     question, and the change is only to what happens when nobody asked. */
  const t = estherBook('TUE');
  const tue = await portalApi(dbWithRpc(t), ADMIN, 'defaulters', { weekday: 'TUE' }, NOW);
  assert.ok(tue.rows.some(r => K2(r.ref) === '2-209-72865'));
  const mon = await portalApi(dbWithRpc(t), ADMIN, 'defaulters', { weekday: 'MON' }, NOW);
  assert.ok(!mon.rows.some(r => K2(r.ref) === '2-209-72865'), 'Monday\'s deck is Monday\'s deck');
});

test('a customer in two weekdays\' decks is listed ONCE, from the newer one', async () => {
  /* A day can hold several weekdays' decks and the same person may sit in more than one.
     Counting them twice would be a worse fault than the one being fixed. */
  const t = estherBook('TUE');
  const hers = t.defaulter_snapshots.find(r => r.ref === '2-209-72865' && r.snapshot_type === 'current');
  t.defaulter_snapshots.push({ ...hers, weekday: 'WED',
    arrears: 999, upload_batch: 'bz', created_at: TODAY + 'T06:00:00Z' });
  const d = await portalApi(dbWithRpc(t), ADMIN, 'defaulters', {}, NOW);
  const hits = d.rows.filter(r => K2(r.ref) === '2-209-72865');
  assert.equal(hits.length, 1, 'once, not twice');
  assert.equal(Number(hits[0].arrears), 999, 'and it is the newer upload that wins');
});

test('a customer dropped from a same-day corrected re-upload does not survive on their old batch row', async () => {
  // "Some customers were texted arrears when I exported the sms file ... yet she aint in the
  // defaulters file" -- ANASTAZIA JUMBE NGOI, SINGIDA. A team's CURRENT deck corrected with a
  // same-day re-upload that no longer names a given customer -- because they paid off -- must
  // not resurrect them from the batch it replaced. pickLatestPerCustomer alone had nothing in
  // the newer, more complete batch to compare her old row against, so her old row just won.
  const t = estherBook('TUE');
  // A LATER upload for GOBA's TUE current deck, same date, that does NOT mention her -- but
  // does name somebody else, so the fix has to be "her batch loses, not the whole date".
  t.defaulter_snapshots.push({
    ref: '9-000-00001', full_name: 'SOMEBODY ELSE', team: 'GOBA', arrears: 400000,
    status: 'Defaulter', ds: '3-6', snapshot_type: 'current', weekday: 'TUE',
    snapshot_date: TODAY, upload_batch: 'bg2', created_at: TODAY + 'T06:00:00Z',
  });
  const d = await portalApi(dbWithRpc(t), ADMIN, 'defaulters', {}, NOW);
  assert.equal(d.rows.some(r => K2(r.ref) === '2-209-72865'), false,
    'she is not in the corrected file -- the old batch\'s row must not survive');
  assert.ok(d.rows.some(r => K2(r.ref) === '9-000-00001'), 'the corrected file\'s own customer is there');
});

test('and Find customer says exactly where she is and why she cannot be seen', async () => {
  const d = await portalApi(dbWithRpc(estherBook('TUE')), ADMIN, 'findCustomer', { q: 'ESTER' }, NOW);
  // The fixture carries an 'initial' AND a 'current' snapshot for her -- one ref's whole
  // history, not two different results -- so this is the latest (current) row alone now.
  assert.equal(d.count, 1, 'one row, the latest upload, not the full snapshot history');
  assert.equal(d.decks[0].arrears, 1766336, 'the CURRENT figure, not the initial baseline');
  assert.ok(d.decks.every(x => x.weekday === 'TUE'));
  assert.ok(d.decks.every(x => x.onToday === false));
  assert.ok(d.notes.some(n => /weekday TUE/.test(n) && /today is FRI/.test(n)),
    'and it says so in words rather than leaving somebody to work it out');
});

test('found by reference and by phone number too, not just by name', async () => {
  const db = dbWithRpc(estherBook('TUE'));
  assert.equal((await portalApi(db, ADMIN, 'findCustomer', { q: '2-209-72865' }, NOW)).count, 1);
  assert.equal((await portalApi(dbWithRpc(estherBook('TUE')), ADMIN,
    'findCustomer', { q: '0746115063' }, NOW)).count, 1);
});

test('find customer: one row per ref carries the contact and guarantor, for the panel it opens into', async () => {
  const d = await portalApi(dbWithRpc(estherBook('TUE')), ADMIN, 'findCustomer', { q: 'ESTER' }, NOW);
  const r = d.decks[0];
  assert.equal(r.contact, '746115063');
  assert.equal(r.guarantor_name, 'PETER CHARLES OMARY');
  assert.equal(r.guarantor_contact, '783384221');
});

test('find customer: no separate follow-up-register rows in the result list any more', async () => {
  const t = estherBook('THU');
  t.followup_status = [{ ref: '2-209-72865', team: 'GOBA', full_name: 'ESTER PETER OMARY',
    status: 'Partial Defaulter', arrears: 1766336, ds: '2-4', updated_at: TODAY + 'T04:00:00Z' }];
  const d = await portalApi(dbWithRpc(t), ADMIN, 'findCustomer', { q: 'ESTER' }, NOW);
  assert.equal(d.follow, undefined, '"not transactions or whatever" -- the register is not a result row');
  assert.equal(d.decks.length, 1);
});

test('when the deck IS today\'s weekday, it says so instead of crying wolf', async () => {
  /* The verdict no longer turns on the weekday matching today -- a defaulter has no day, and
     saying "wrong weekday" was sending people to re-upload a deck that was already fine. What
     it turns on now is whether the customer is actually REACHABLE: in the deck, and in the
     register with live figures. This fixture has the deck and no register row, which is a real
     and different problem, and the verdict must name that one instead. */
  const d = await portalApi(dbWithRpc(estherBook('FRI')), ADMIN, 'findCustomer', { q: 'ESTER' }, NOW);
  assert.ok(d.decks.every(x => x.onToday === true));
  assert.ok(d.notes.some(n => /NOT in the follow-up register/.test(n)),
    'in the deck, on no handset -- and it says which');
  assert.ok(!d.notes.some(n => /Do NOT re-upload/.test(n)),
    'and it does not cry wolf about the weekday when the weekday is today');
});

test('a customer in the deck AND the register with live figures is reported as reachable', async () => {
  const t = estherBook('THU');                       // deliberately NOT today's weekday
  t.followup_status = [{ ref: '2-209-72865', team: 'GOBA', full_name: 'ESTER PETER OMARY',
    status: 'Partial Defaulter', arrears: 1766336, ds: '2-4', updated_at: TODAY + 'T04:00:00Z' }];
  const d = await portalApi(dbWithRpc(t), ADMIN, 'findCustomer', { q: 'ESTER' }, NOW);
  assert.ok(d.notes.some(n => /should both\s*\n?\s*show them|should both/.test(n) || /HOPE Calls should both/.test(n)),
    'both halves present, so the answer is "a screen filter", not "she is missing"');
  assert.ok(d.notes.some(n => /THAT IS NORMAL/.test(n)),
    'and the Thursday deck is explicitly called normal rather than a fault');
});

test('BLANKED is reported as its own thing -- present, and on no handset', async () => {
  /* The shape that cost the most time. Retiring keeps the row and empties status and arrears,
     and the phone skips exactly that -- so the register search lists her like anybody else and
     the screen used to say nothing at all about it. */
  const t = estherBook('THU');
  t.followup_status = [{ ref: '2-209-72865', team: 'GOBA', full_name: 'ESTER PETER OMARY',
    status: null, arrears: null, ds: '2-4', fu_status: 'AMETOA AHADI',
    updated_at: '2026-07-01T04:00:00Z' }];
  const d = await portalApi(dbWithRpc(t), ADMIN, 'findCustomer', { q: 'ESTER' }, NOW);
  assert.ok(d.notes.some(n => /BLANKED/.test(n)), 'it has to say the word');
  assert.ok(d.notes.some(n => /restores the figures/.test(n)), 'and what puts it right');
  assert.ok(!d.notes.some(n => /NOT in the follow-up register/.test(n)),
    'she IS in the register -- that is the whole trap, and it must not be mis-reported');
});

test('a customer who is genuinely nowhere is told apart from one who is hidden', async () => {
  /* Two very different problems -- "the upload did not land" and "you are looking on the wrong
     day" -- and the whole value here is not confusing them. */
  const d = await portalApi(dbWithRpc(tables()), ADMIN, 'findCustomer', { q: 'NOBODY AT ALL' }, NOW);
  assert.equal(d.count, 0);
  assert.ok(d.notes.some(n => /Not found anywhere/.test(n) && /upload did not land/.test(n)));
});

test('an officer can only find their own teams', async () => {
  const d = await portalApi(dbWithRpc(estherBook('FRI')), GMO, 'findCustomer', { q: 'ESTER' }, NOW);
  assert.equal(d.count, 0, 'GOBA is not KONGOWE');
});

test('too short a search is refused rather than returning the whole book', async () => {
  await assert.rejects(
    () => portalApi(dbWithRpc(tables()), ADMIN, 'findCustomer', { q: 'ab' }, NOW),
    e => /at least 3/.test(e.message));
});

/* =====================================================================================
   "I as admin not yet seeing her on the call app defaulters"

   HOPE Calls builds its Defaulters list from followup_status -- the working register -- and
   deliberately so: an officer's own statuses, promises and comments live there. Every deck
   upload rebuilds it, so in normal running the two agree.

   They can come apart. A customer retired for going a fortnight without their weekday's deck
   coming round, or one loaded before the register was being written, sits in the deck and NOT
   in the register: present on every portal screen, absent from every handset, with each half
   individually correct and nothing anywhere to say so.
   ===================================================================================== */
test('a customer in the deck but not the register is invisible to the phone -- and named as such', async () => {
  const t = estherBook('TUE');
  t.followup_status = t.followup_status.filter(r => r.ref !== '2-209-72865');
  const d = await portalApi(dbWithRpc(t), ADMIN, 'findCustomer', { q: 'ESTER' }, NOW);
  // follow-up register rows are no longer part of the result list at all (see the
  // "no separate follow-up-register rows" test) -- the verdict below is what proves she is
  // missing from it, not a row count on a list that no longer exists.
  assert.ok(d.decks.length > 0, 'but she IS in the deck');
  assert.ok(d.notes.some(n => /NOT in the follow-up register/.test(n) && /no handset/.test(n)),
    'and the diagnostic says exactly that, rather than leaving it to be worked out');
});

test('rebuilding the register puts her back, so the phone can see her', async () => {
  const t = estherBook('TUE');
  t.followup_status = t.followup_status.filter(r => r.ref !== '2-209-72865');
  const db = dbWithRpc(t);
  const r = await portalApi(db, ADMIN, 'rebuildFollowup', {}, NOW);
  assert.ok(r.added >= 1);
  const reg = db._dump('followup_status').find(x => x.ref === '2-209-72865');
  assert.ok(reg, 'she is in the register now');
  assert.equal(reg.team, 'GOBA');
  assert.equal(Number(reg.arrears), 1766336);
  assert.equal(reg.ds, '2-4');
});

test('rebuilding NEVER touches a row that is already there', async () => {
  /* An officer's follow-up status, promise and comments live on that row. Overwriting them
     would be a far worse fault than the one being repaired. */
  const t = estherBook('TUE');
  // Somebody already on the register, with an officer's work on their row.
  t.followup_status.push({ ref: 'WORKED', team: 'GOBA', full_name: 'HAS A PROMISE',
    status: 'Defaulter', arrears: 1 });
  const mine = t.followup_status.find(r => r.ref === 'WORKED');
  mine.fu_status = 'AMETOA AHADI';
  mine.promise_date = '2026-08-20';
  mine.last_comment = 'atalipa Jumatatu';
  mine.arrears = 12345;
  const db = dbWithRpc(t);
  await portalApi(db, ADMIN, 'rebuildFollowup', {}, NOW);
  const after = db._dump('followup_status').find(x => x.ref === 'WORKED');
  assert.equal(after.fu_status, 'AMETOA AHADI');
  assert.equal(after.promise_date, '2026-08-20');
  assert.equal(after.last_comment, 'atalipa Jumatatu');
  assert.equal(Number(after.arrears), 12345, 'even the arrears they were working from');
});

test('rebuilding twice adds nothing the second time', async () => {
  const t = estherBook('TUE');
  t.followup_status = t.followup_status.filter(r => r.ref !== '2-209-72865');
  const db = dbWithRpc(t);
  const first = await portalApi(db, ADMIN, 'rebuildFollowup', {}, NOW);
  assert.ok(first.added >= 1);
  const second = await portalApi(db, ADMIN, 'rebuildFollowup', {}, NOW);
  assert.equal(second.added, 0);
  assert.ok(/already in the follow-up register/.test(second.note));
});

test('only an admin may rebuild the register', async () => {
  await assert.rejects(
    () => portalApi(dbWithRpc(estherBook('TUE')), GMO, 'rebuildFollowup', {}, NOW),
    e => e.status === 403);
});

/* =====================================================================================
   "i rebuilt and also reuploaded still ester aint there .. means we missing customers to make
    followups to"

   THE DATE WAS STILL ONE NUMBER FOR THE WHOLE COMPANY.

   Three rules decide which deck rows a screen sees, and each had to become per-team before a
   defaulter could reliably be found:

     which BATCH    fixed long ago -- was per DAY, and threw away sixteen teams when a day
                    arrived as seventeen files
     which WEEKDAY  fixed -- a defaulter is a defaulter every day
     which DATE     THIS ONE. latestSnapshotDate asks the WHOLE TABLE for its newest date, so
                    the moment ANY team was uploaded with a newer date, every team with an
                    older deck vanished ENTIRELY.

   Not a few rows -- the whole team. And it is why re-uploading her team changed nothing: her
   deck was landing perfectly and being filtered out by somebody else's more recent upload.

   THAT FIX STILL STANDS -- for 'initial' baselines, and for anything else that reads a deck
   type teams might genuinely upload on different days. It no longer applies to 'current'
   defaulters: see the comment on defaulterBook's own 'current' branch in portal-core.js.
   "the latest current defaulter file is to live until the next one, no limit" -- confirmed
   after paid-off customers kept resurfacing from a stale deck the exact same shape as GOBA's
   here. A team missing from today's whole-company CURRENT file is now read as zero, not as
   "their own latest deck" -- the tests below were rewritten to prove that on purpose, not
   because the old protection was wrong for what it was built for. */
function twoTeamBook(gobaDate, type) {
  const t = tables();
  t.teams.push({ team: 'GOBA', opm: null, recovery: 'R', gmo: 'G', manager: 'M',
    credit: 'ANALYST A', expected: 'E', bike: 'B' });
  t.teams.push({ team: 'MBEYA', opm: null, recovery: 'R2', gmo: 'G2', manager: 'M2',
    credit: 'ANALYST B', expected: 'E2', bike: 'B2' });
  const mk = (ref, team, date, wd) => ({ ref, full_name: ref + ' NAME', team, arrears: 1000,
    status: 'Partial Defaulter', ds: '2-4', dc: 2, disb_date: '2026-07-09',
    snapshot_type: type || 'current', weekday: wd, snapshot_date: date,
    upload_batch: 'b' + team + date, created_at: date + 'T04:00:00Z' });
  t.defaulter_snapshots.push(mk('ESTHER', 'GOBA', gobaDate, 'TUE'));
  t.defaulter_snapshots.push(mk('OTHER', 'MBEYA', TODAY, 'MON'));
  return t;
}

test('a team missing from today\'s CURRENT file reads as zero, not their own older deck', async () => {
  /* The policy this session deliberately flipped, aware it reopens the door the OLD version of
     this test closed. MBEYA uploaded today; GOBA's only CURRENT deck is two days old, and a
     team quiet since must mean paid off, not "still catching up". */
  const t = twoTeamBook('2026-07-22');             // TODAY is 2026-07-24
  const d = await portalApi(dbWithRpc(t), ADMIN, 'defaulters', {}, NOW);
  assert.ok(!d.rows.some(r => r.ref === 'ESTHER'), 'GOBA\'s two-day-old deck no longer counts');
  assert.ok(d.rows.some(r => r.ref === 'OTHER'), 'MBEYA, on today\'s, still does');
});

test('...but an INITIAL baseline still protects a team on an older date -- only CURRENT changed', async () => {
  const t = twoTeamBook('2026-07-22', 'initial');
  const d = await portalApi(dbWithRpc(t), ADMIN, 'defaulters', { type: 'initial' }, NOW);
  assert.ok(d.rows.some(r => r.ref === 'ESTHER'),
    'a baseline is not re-uploaded on a defaulter\'s cadence -- staying sticky is still right here');
});

test('rebuilding the register no longer reaches into an old CURRENT deck either', async () => {
  const t = twoTeamBook('2026-07-22');
  const db = dbWithRpc(t);
  await portalApi(db, ADMIN, 'rebuildFollowup', {}, NOW);
  assert.ok(!db._dump('followup_status').some(r => r.ref === 'ESTHER'),
    'the register follows the same current-deck rule everything else now does');
});

test('an explicit weekday choice is still exactly that', async () => {
  const t = twoTeamBook('2026-07-22');
  const d = await portalApi(dbWithRpc(t), ADMIN, 'defaulters', { weekday: 'MON' }, NOW);
  assert.ok(!d.rows.some(r => r.ref === 'ESTHER'), 'she is in TUE\'s deck, not MON\'s');
});

/* =====================================================================================
   THE SWEEP THAT EMPTIED THE OFFICERS' LIST.
   =====================================================================================
     "Just previewing defaulters arranged by arreas and not seeing ester at 1.7m ... the
      complain is growing larger and words spreading that the app has no customers and not
      trustworthy"

   Four theories about ESTER PETER OMARY were wrong before this one, and each was wrong the same
   way: they all looked at how a deck is READ. She was being read perfectly. She was being
   ERASED afterwards.

   Every current-defaulter upload ran followupClean with days:1. That function retires on AGE
   ALONE and knows nothing about weekdays -- but decks ARE per weekday and each comes round once
   a week, so "not confirmed within one day" describes almost the whole register almost all the
   time. Uploading Friday's deck blanked the status and arrears of everybody whose own deck was
   Monday, Tuesday or Wednesday, and the phone's Defaulters list skips exactly that shape.

   It is the seventh-of-the-book fault this system already fixed once inside syncFollowupFromDeck,
   re-introduced wholesale by a housekeeping call that ran immediately afterwards and overrode it.

   These are the tests that were missing. Every earlier one called followupClean with its DEFAULT
   fourteen days against a register two rows long -- which is a register with no weekdays in it,
   and therefore a fixture that could not fail.
   ===================================================================================== */

/** A register the way a live one looks: five weekdays' decks, each confirming its own people,
    each coming round once a week. Nothing here is stale -- every row was confirmed this week. */
function weekRegister(perDay = 20) {
  const WD = { MON: '2026-07-20', TUE: '2026-07-21', WED: '2026-07-22', THU: '2026-07-23', FRI: '2026-07-24' };
  const out = [];
  for (const [wd, d] of Object.entries(WD)) {
    for (let i = 0; i < perDay; i++) {
      out.push({ ref: wd + i, team: 'KONGOWE', full_name: 'C ' + wd + i, status: 'Partial Defaulter',
        arrears: 1766336, ds: '2-4', deck_date: d, updated_at: d + 'T06:00:00Z' });
    }
  }
  return out;
}
const stillLive = db => db._dump('followup_status').filter(r => !(r.status == null && r.arrears == null));

test('a day-old cutoff cannot retire a customer whose own weekday deck is not due yet', async () => {
  const db = fakeDb({ ...tables(), followup_status: weekRegister() });
  /* Exactly what api/upload.js used to run after every current-defaulter upload. It retired
     sixty of these hundred in one go, leaving only the last two days' decks standing. */
  const r = await portalApi(db, ADMIN, 'followupClean', { days: 1, confirm: true }, NOW);
  assert.equal(r.retired, 0, 'nobody here is stale -- every deck came round this week');
  assert.equal(stillLive(db).length, 100, 'and every one of them is still visible on a phone');
});

test('a cutoff shorter than the deck cycle is raised to it, and the caller is told', async () => {
  const db = fakeDb({ ...tables(), followup_status: weekRegister(1) });
  const r = await portalApi(db, ADMIN, 'followupClean', { days: 1 }, NOW);
  assert.equal(r.asked, 1, 'what was asked for is reported honestly');
  assert.equal(r.days, 7, 'and what was used is a week -- the cycle a deck actually runs on');
  assert.match(String(r.note), /once a week/);
});

test('a genuinely stale customer is still retired -- the floor is not a way out of the rule', async () => {
  const db = fakeDb({ ...tables(), followup_status: [
    ...weekRegister(2),
    { ref: 'GONE', team: 'KONGOWE', full_name: 'LEFT THE BOOK', status: 'Defaulter', arrears: 9000,
      deck_date: '2026-06-01', updated_at: '2026-06-01T04:00:00Z' },
  ] });
  const r = await portalApi(db, ADMIN, 'followupClean', { days: 1, confirm: true }, NOW);
  assert.equal(r.retired, 1, 'seven weeks without a deck is stale on any reading');
  const by = Object.fromEntries(db._dump('followup_status').map(x => [x.ref, x]));
  assert.equal(by.GONE.arrears, null);
  assert.equal(by.MON0.arrears, 1766336, 'and this week\'s people are untouched');
});

test('a sweep that would blank most of the working list blanks none of it, and says the number', async () => {
  /* The brake syncFollowupFromDeck has carried all along, which this side never had. A third of
     the register looking stale is not a list needing a tidy -- it means some weekdays' decks
     have stopped arriving, and that is worth reading about rather than actioning silently. */
  const old = [];
  for (let i = 0; i < 200; i++) {
    old.push({ ref: 'OLD' + i, team: 'KONGOWE', full_name: 'O' + i, status: 'Defaulter',
      arrears: 5000, deck_date: '2026-05-01', updated_at: '2026-05-01T04:00:00Z' });
  }
  const db = fakeDb({ ...tables(), followup_status: [...old, ...weekRegister(2)] });
  const r = await portalApi(db, ADMIN, 'followupClean', { confirm: true }, NOW);
  assert.equal(r.retired, 0, 'nothing was retired');
  assert.equal(r.capped, 200, 'and the number that looked stale is reported instead');
  assert.match(String(r.note), /stopped being uploaded/);
  assert.equal(stillLive(db).length, 210, 'the working list is exactly as it was');
});

/* =====================================================================================
   PUTTING BACK WHAT THE SWEEP ERASED.

     "i rebuilt and also reuploaded still ester aint there"

   Both of those reported success and changed nothing, and this is why. Rebuild read the register
   for its KEYS ALONE, so it could only answer "is this customer there at all". Ester was there.
   She was there with her status and arrears set to null, which is the one shape the phone's
   Defaulters list skips -- present, and invisible, and reported as nothing to do.
   ===================================================================================== */
test('rebuilding restores a customer the deck still names but the register has blanked', async () => {
  const t = tables();
  const db = fakeDb({
    ...t,
    defaulter_snapshots: [
      { id: 'd1', ref: '2-209-72865', full_name: 'ESTER PETER OMARY', contact: '0746115063',
        team: 'KONGOWE', status: 'Partial Defaulter', ds: '2-4', arrears: 1766336, other_inst: 1133333,
        snapshot_type: 'current', weekday: 'THU', snapshot_date: TODAY,
        upload_batch: 'b1', created_at: TODAY + 'T06:00:00Z' },
    ],
    followup_status: [
      // Present, blanked, and carrying an officer's work that must survive the repair.
      { ref: '2-209-72865', team: 'KONGOWE', full_name: 'ESTER PETER OMARY', status: null, arrears: null,
        fu_status: 'AMETOA AHADI', promise_amt: 200000, last_comment: 'ataleta Ijumaa',
        comment_by: 'JUMA G', deck_date: null, updated_at: '2026-07-01T04:00:00Z' },
    ],
  });

  const r = await portalApi(db, ADMIN, 'rebuildFollowup', {}, NOW);
  assert.equal(r.added, 0, 'she was never missing -- that is what made this so hard to see');
  assert.equal(r.restored, 1, 'she was blanked, and that is what needed undoing');

  const row = db._dump('followup_status').find(x => x.ref === '2-209-72865');
  assert.equal(row.arrears, 1766336, 'the arrears the phone sorts by are back');
  assert.equal(row.status, 'Partial Defaulter');
  assert.equal(row.ds, '2-4');
  assert.equal(row.fu_status, 'AMETOA AHADI', 'and not one thing the officer typed was touched');
  assert.equal(row.promise_amt, 200000);
  assert.equal(row.last_comment, 'ataleta Ijumaa');
  assert.equal(row.comment_by, 'JUMA G');
});

test('a restored customer is on the phone\'s defaulters list, sorted by arrears', async () => {
  /* The end of the chain, and the only test that proves the point the report was actually
     about: after the repair she is ON THE HANDSET, and near the top, because that list is
     sorted by arrears descending and hers are 1.7m. */
  const { callApi } = await import('../api/_lib/call-core.js');
  const t = tables();
  const db = fakeDb({
    ...t,
    call_users: [{ user_id: 'u1', device_id: 'DEV1', name: 'ADMIN', role: 'ADMIN', teams: null }],
    defaulter_snapshots: [
      { id: 'd1', ref: '2-209-72865', full_name: 'ESTER PETER OMARY', contact: '0746115063',
        team: 'KONGOWE', status: 'Partial Defaulter', ds: '2-4', arrears: 1766336,
        snapshot_type: 'current', weekday: 'THU', snapshot_date: TODAY,
        upload_batch: 'b1', created_at: TODAY + 'T06:00:00Z' },
    ],
    followup_status: [
      { ref: '2-209-72865', team: 'KONGOWE', full_name: 'ESTER PETER OMARY', contact: '0746115063',
        status: null, arrears: null, updated_at: '2026-07-01T04:00:00Z' },
      { ref: 'OTHER', team: 'KONGOWE', full_name: 'SOMEBODY ELSE', status: 'Defaulter',
        arrears: 400000, updated_at: TODAY + 'T04:00:00Z' },
    ],
  });

  const before = await callApi(db, 'api_callList', ['DEV1', 'defaulters'], NOW);
  assert.ok(!before.rows.some(r => r.ref === '2-209-72865'),
    'this is the complaint, reproduced: she is in the deck and on no phone');

  await portalApi(db, ADMIN, 'rebuildFollowup', {}, NOW);

  const after = await callApi(db, 'api_callList', ['DEV1', 'defaulters'], NOW);
  assert.ok(after.rows.some(r => r.ref === '2-209-72865'), 'and now she is there');
  assert.equal(after.rows[0].ref, '2-209-72865', 'at the top, because 1.7m is the largest arrears');
  assert.equal(after.rows[0].amt, 1766336);
});

/* =====================================================================================
   THE REPAIR HAS TO BE REACHABLE, AND IT HAS TO FIT IN ONE REQUEST.
   =====================================================================================
     "Customers Still invisible"

   My own regression, and the worst kind: two changes that were each right on their own. #168
   removed the Settings button because manual housekeeping was not wanted. #169 took the
   automatic call off the upload because it pushed the request past sixty seconds and broke
   uploading altogether. Between them the repair became reachable from NOWHERE, and every
   weekday whose deck had not been re-uploaded since stayed blanked with nothing able to correct
   it.

   So it is bounded and resumable now: a call fixes at most FU_REPAIR_MAX and reports how many
   are left, and the upload page rings it until there are none. It cannot run out of time,
   because it no longer tries to finish in one go.
   ===================================================================================== */
test('the repair is bounded, and says how much is left', async () => {
  const t = tables();
  const deck = [], reg = [];
  for (let i = 0; i < 30; i++) {
    deck.push({ id: 'd' + i, ref: 'R' + i, full_name: 'C' + i, team: 'KONGOWE',
      status: 'Defaulter', arrears: 1000 + i, ds: '2-4', snapshot_type: 'current',
      weekday: 'FRI', snapshot_date: TODAY, upload_batch: 'b1', created_at: TODAY + 'T04:00:00Z' });
    reg.push({ ref: 'R' + i, team: 'KONGOWE', full_name: 'C' + i, status: null, arrears: null,
      updated_at: '2026-07-01T04:00:00Z' });
  }
  const db = fakeDb({ ...t, defaulter_snapshots: deck, followup_status: reg });

  const first = await portalApi(db, ADMIN, 'rebuildFollowup', { max: 10 }, NOW);
  assert.equal(first.restored, 10, 'exactly the cap, not the lot');
  assert.equal(first.remaining, 20);
  assert.equal(first.done, false, 'and it says so, so the caller knows to ring again');

  // Ring until it is finished, exactly as the upload page does.
  let guard = 0, r = first;
  while (!r.done && guard++ < 10) r = await portalApi(db, ADMIN, 'rebuildFollowup', { max: 10 }, NOW);
  assert.equal(r.done, true);
  assert.equal(r.remaining, 0);

  const live = db._dump('followup_status').filter(x => !(x.status == null && x.arrears == null));
  assert.equal(live.length, 30, 'every one of them is visible to a handset again');
});

test('the repair spends its budget on the MISSING before the merely blanked', async () => {
  /* A customer with no row at all is invisible to more of the system than one whose figures
     were cleared, so when there is not enough budget for both, they go first. */
  const t = tables();
  const db = fakeDb({
    ...t,
    defaulter_snapshots: [
      { id: 'a', ref: 'GONE', full_name: 'NOT IN REGISTER', team: 'KONGOWE', status: 'Defaulter',
        arrears: 500, snapshot_type: 'current', weekday: 'FRI', snapshot_date: TODAY,
        upload_batch: 'b1', created_at: TODAY + 'T04:00:00Z' },
      { id: 'b', ref: 'BLANK', full_name: 'BLANKED', team: 'KONGOWE', status: 'Defaulter',
        arrears: 900, snapshot_type: 'current', weekday: 'FRI', snapshot_date: TODAY,
        upload_batch: 'b1', created_at: TODAY + 'T04:00:00Z' },
    ],
    followup_status: [
      { ref: 'BLANK', team: 'KONGOWE', full_name: 'BLANKED', status: null, arrears: null,
        updated_at: '2026-07-01T04:00:00Z' },
    ],
  });
  const r = await portalApi(db, ADMIN, 'rebuildFollowup', { max: 1 }, NOW);
  assert.equal(r.added, 1, 'the one with no row at all');
  assert.equal(r.restored, 0);
  assert.equal(r.remaining, 1);
  assert.equal(r.done, false);
});

test('a register needing nothing reports done, and writes nothing', async () => {
  const t = tables();
  const db = fakeDb({
    ...t,
    defaulter_snapshots: [{ id: 'a', ref: 'OK1', full_name: 'FINE', team: 'KONGOWE',
      status: 'Defaulter', arrears: 500, snapshot_type: 'current', weekday: 'FRI',
      snapshot_date: TODAY, upload_batch: 'b1', created_at: TODAY + 'T04:00:00Z' }],
    followup_status: [{ ref: 'OK1', team: 'KONGOWE', full_name: 'FINE', status: 'Defaulter',
      arrears: 500, fu_status: 'AMETOA AHADI', updated_at: TODAY + 'T04:00:00Z' }],
  });
  const r = await portalApi(db, ADMIN, 'rebuildFollowup', {}, NOW);
  assert.equal(r.done, true);
  assert.equal(r.remaining, 0);
  assert.equal(r.added + r.restored, 0);
  assert.equal(db._dump('followup_status')[0].fu_status, 'AMETOA AHADI', 'and touched nobody');
});

/* =====================================================================================
   8,888 IN, 888 OUT: THE UPLOAD WAS EMPTYING THE REGISTER ON THE WAY IN.
   =====================================================================================
   The owner's own upload result, and it is the whole diagnosis in three lines:

     "Done — 8888 row(s) into defaulter_snapshots."
     "Officers' working list rebuilt: 888 customer(s) now visible..."
     "7977 customer(s) no deck has confirmed were taken off the officers' working list."

   A file is uploaded A THOUSAND ROWS AT A TIME. The register sync ran on `records` -- the
   CURRENT SLICE -- so on the last part it saw 888 customers, wrote those, and retired the other
   eight thousand for not being in "the deck".

   Every read path had been searched. The register they all depend on was being emptied by the
   upload itself, once per upload, and reporting it as a tidy-up.
   ===================================================================================== */
test('a deck uploaded in slices puts EVERY customer on the working list, not the last slice', async () => {
  const { writeFollowupFromDeck, retireFollowupAfterDeck } = await import('../api/upload.js');
  const deck = [];
  for (let i = 0; i < 2500; i++) {
    deck.push({ ref: 'R' + i, full_name: 'C' + i, team: 'KONGOWE', status: 'Defaulter',
      arrears: 1000 + i, ds: '2-4', other_inst: 500 });
  }
  const snaps = deck.map((d, i) => ({ id: 's' + i, ref: d.ref, team: 'KONGOWE',
    snapshot_type: 'current', weekday: 'MON', snapshot_date: TODAY,
    upload_batch: 'NEW', created_at: TODAY + 'T06:00:00Z' }));
  const db = fakeDb({ ...tables(), defaulter_snapshots: snaps, followup_status: [] });

  // Exactly how the page sends it: a thousand at a time, the last slice short.
  let wrote = 0;
  for (let i = 0; i < deck.length; i += 1000) {
    wrote += await writeFollowupFromDeck(db, deck.slice(i, i + 1000), TODAY);
  }
  assert.equal(wrote, 2500, 'every slice writes its own rows');

  const reg = db._dump('followup_status');
  assert.equal(reg.length, 2500, `the whole deck is on the working list, not the last 500: ${reg.length}`);

  // And the retiring, run once at the end, must not retire anybody in this upload.
  const r = await retireFollowupAfterDeck(db, 'MON', 'NEW', TODAY);
  assert.equal(r.retired, 0, 'nobody in the deck just uploaded is "no longer in the deck"');
  const live = db._dump('followup_status').filter(x => !(x.status == null && x.arrears == null));
  assert.equal(live.length, 2500, 'and all of them are visible to a handset');
});

test('an officer\'s own work survives the write without the register being read at all', async () => {
  /* The old sync read the WHOLE register so it could copy fu_status, the promise and the
     comment back onto every row -- protecting them by rewriting them. Leaving those columns out
     of the payload preserves them by construction, which is both safer and what makes running
     this on every slice affordable. */
  const { writeFollowupFromDeck } = await import('../api/upload.js');
  const db = fakeDb({ ...tables(), followup_status: [
    { ref: 'R1', team: 'KONGOWE', full_name: 'OLD NAME', status: null, arrears: null,
      fu_status: 'AMETOA AHADI', promise_date: TODAY, promise_amt: 5000,
      last_comment: 'ataleta Ijumaa', comment_by: 'JUMA G', updated_at: '2026-07-01T00:00:00Z' },
  ] });
  await writeFollowupFromDeck(db, [{ ref: 'R1', full_name: 'ESTER PETER OMARY', team: 'KONGOWE',
    status: 'Partial Defaulter', arrears: 1766336, ds: '2-4' }], TODAY);
  const row = db._dump('followup_status')[0];
  assert.equal(row.arrears, 1766336, 'the deck figures are refreshed');
  assert.equal(row.status, 'Partial Defaulter');
  assert.equal(row.full_name, 'ESTER PETER OMARY');
  assert.equal(row.fu_status, 'AMETOA AHADI', 'and not one thing the officer typed was touched');
  assert.equal(row.promise_amt, 5000);
  assert.equal(row.last_comment, 'ataleta Ijumaa');
  assert.equal(row.comment_by, 'JUMA G');
});

/* =====================================================================================
   THE DECK WAS ONLY EVER COMPARED AGAINST ITSELF.
   =====================================================================================
     "we should see defaulters from defaulters since its not the hopeloan yet, now you pulling
      defaulters from expected yet i upload my defaulters manually thats abusing me brother"

   Quite right, and the complaint found a real fault rather than a preference.

   A defaulter comes off the working list when their own weekday's deck comes round WITHOUT
   them. That is the whole rule, and it is the one the owner has always described. It did not
   work, and the reason is four lines long:

   prevWeekdayDeck asks for the LATEST snapshot_date of this weekday, then drops the batch
   being uploaded. But the deck is written to defaulter_snapshots BEFORE the retiring runs, so
   the latest date IS the upload's own date -- drop this batch and nothing is left, so it
   returns null and NOBODY is retired. LAST WEEK'S DECK IS NEVER LOOKED AT.

   It only ever compared this upload against ANOTHER UPLOAD OF THE SAME DATE. Every existing
   test passes because every one of them models a same-day re-upload -- see the fixture below
   this one, which stamps its "previous" deck with the same TODAY. In the field nobody uploads
   Tuesday's deck twice on Tuesday; they upload it next Tuesday, and that is exactly the case
   that quietly did nothing.

   So a customer who cleared their debt stayed on two hundred officers' phones for ever, and
   the only thing that ever removed anybody was the fourteen-day stale rule -- which is a
   backstop, not the rule. */
test('LAST WEEK\'s deck is what this week\'s is compared against, not another upload of today', async () => {
  const { retireFollowupAfterDeck } = await import('../api/upload.js');
  const LAST_TUE = '2026-08-11', THIS_TUE = '2026-08-18';
  /* Three Tuesday customers, all last confirmed by LAST Tuesday's deck. Well inside the
     fourteen-day stale window, so the stale rule cannot be what retires anybody here -- the
     weekday comparison is the only thing under test. */
  const reg = ['HUSNA', 'STILL1', 'STILL2'].map(ref => ({
    ref, team: 'MSAMVU', full_name: ref, status: 'Defaulter', arrears: 1, ds: '8-9',
    deck_date: LAST_TUE, updated_at: LAST_TUE + 'T06:00:00Z' }));
  const snaps = [
    // Last Tuesday's deck named all three.
    ...['HUSNA', 'STILL1', 'STILL2'].map((ref, i) => ({ id: 'p' + i, ref, team: 'MSAMVU',
      snapshot_type: 'current', weekday: 'TUE', snapshot_date: LAST_TUE,
      upload_batch: 'LASTWEEK', created_at: LAST_TUE + 'T06:00:00Z' })),
    // This Tuesday's names only the two who still owe. Husna paid.
    ...['STILL1', 'STILL2'].map((ref, i) => ({ id: 'n' + i, ref, team: 'MSAMVU',
      snapshot_type: 'current', weekday: 'TUE', snapshot_date: THIS_TUE,
      upload_batch: 'THISWEEK', created_at: THIS_TUE + 'T06:00:00Z' })),
  ];
  const db = fakeDb({ ...tables(), defaulter_snapshots: snaps, followup_status: reg });
  const r = await retireFollowupAfterDeck(db, 'TUE', 'THISWEEK', THIS_TUE);
  assert.equal(r.retired, 1, 'the one customer this week\'s deck no longer names comes off');

  const rows = db._dump('followup_status');
  const husna = rows.find(x => x.ref === 'HUSNA');
  assert.equal(husna.status, null, 'she is no longer a defaulter on anybody\'s phone');
  assert.equal(husna.arrears, null);
  for (const ref of ['STILL1', 'STILL2']) {
    assert.equal(rows.find(x => x.ref === ref).status, 'Defaulter',
      ref + ' is still in this week\'s deck and must be untouched');
  }
});

test('the brake refuses a file that would empty nearly the whole register', async () => {
  /* A current file is meant to be the whole defaulter book, so retiring most of the register
     is normal on the FIRST upload after this rule was fixed -- that is a backlog clearing, not
     a fault. What is still a fault is a file that names almost NOBODY the register already
     knows: 5 of 300 is a truncated export, not a shrunk book, and the brake exists for exactly
     that shape. */
  const { retireFollowupAfterDeck } = await import('../api/upload.js');
  const reg = [], snaps = [];
  for (let i = 0; i < 300; i++) {
    reg.push({ ref: 'R' + i, team: 'KONGOWE', full_name: 'C' + i, status: 'Defaulter',
      arrears: 500, deck_date: TODAY, updated_at: TODAY + 'T06:00:00Z' });
  }
  // Only 5 of the 300 known defaulters are in this "current" upload.
  for (let i = 0; i < 5; i++) {
    snaps.push({ id: 'n' + i, ref: 'R' + i, team: 'KONGOWE', snapshot_type: 'current',
      weekday: 'MON', snapshot_date: TODAY, upload_batch: 'NEW', created_at: TODAY + 'T06:00:00Z' });
  }
  const db = fakeDb({ ...tables(), defaulter_snapshots: snaps, followup_status: reg });
  const r = await retireFollowupAfterDeck(db, 'MON', 'NEW', TODAY);
  assert.equal(r.retired, 0, 'retiring 295 of 300 on one file is refused, not actioned');
  assert.equal(r.capped, 295, 'and the number is reported instead');
  const live = db._dump('followup_status').filter(x => !(x.status == null && x.arrears == null));
  assert.equal(live.length, 300, 'the working list is exactly as it was');
});

test('but retiring most of the register is allowed when the file really says so', async () => {
  /* The other side of the same brake: this is not a churn cap. A current file naming only a
     handful of survivors is legitimate the day this rule starts running against a register a
     broken comparison never touched -- so a retirement under the 90% ceiling goes through in
     full, however large. */
  const { retireFollowupAfterDeck } = await import('../api/upload.js');
  const reg = [], snaps = [];
  for (let i = 0; i < 300; i++) {
    reg.push({ ref: 'R' + i, team: 'KONGOWE', full_name: 'C' + i, status: 'Defaulter',
      arrears: 500, deck_date: '2026-01-01', updated_at: '2026-01-01T06:00:00Z' });
  }
  // 250 of the 300 have genuinely paid and are not in today's file -- 83%, under the 90% cap.
  for (let i = 250; i < 300; i++) {
    snaps.push({ id: 'n' + i, ref: 'R' + i, team: 'KONGOWE', snapshot_type: 'current',
      weekday: 'MON', snapshot_date: TODAY, upload_batch: 'NEW', created_at: TODAY + 'T06:00:00Z' });
  }
  const db = fakeDb({ ...tables(), defaulter_snapshots: snaps, followup_status: reg });
  const r = await retireFollowupAfterDeck(db, 'MON', 'NEW', TODAY);
  assert.equal(r.retired, 250, 'a real backlog clears in one upload, not gradually');
  assert.equal(r.capped, 0);
  const live = db._dump('followup_status').filter(x => !(x.status == null && x.arrears == null));
  assert.equal(live.length, 50);
});

/* =====================================================================================
   THE UPLOAD MUST NOT BE FAILED BY THE TIDYING THAT FOLLOWS IT.
   =====================================================================================
     "uploading (Failed: Error: Seva imechukua muda mrefu mno / the server took too long
      — HTTP 504)"

   The deck is written first and the housekeeping runs after it. A try/catch around that
   housekeeping stops it FAILING the upload; it does nothing at all about it being SLOW, and
   the platform kills the whole function at sixty seconds regardless. The browser then reports
   a failure for a file that is entirely, correctly, in the database.

   So the housekeeping is on a clock. These three tests hold the three promises that makes:
   the register read is small, an overrun is abandoned rather than allowed to run out the
   platform's clock, and an abandonment is SAID rather than swallowed. */
test('the retirement reads only the live half of the register, and only its refs', async () => {
  /* 300 rows, 50 of them already retired (status and arrears null). The old read fetched all
     300 with four columns and filtered in this process; on a register of twelve thousand that
     read alone was most of the request. What the database is ASKED for is what this checks --
     an answer that happens to be right after fetching the whole table is the bug, not the fix. */
  const { retireFollowupAfterDeck } = await import('../api/upload.js');
  const reg = [], snaps = [];
  for (let i = 0; i < 300; i++) {
    const live = i < 250;
    reg.push({ ref: 'R' + i, team: 'KONGOWE', full_name: 'C' + i,
      status: live ? 'Defaulter' : null, arrears: live ? 500 : null,
      deck_date: live ? TODAY : null, updated_at: TODAY + 'T06:00:00Z' });
  }
  // Today's deck names 240 of the 250 live ones. Ten have cleared.
  for (let i = 0; i < 240; i++) {
    snaps.push({ id: 'n' + i, ref: 'R' + i, team: 'KONGOWE', snapshot_type: 'current',
      weekday: 'MON', snapshot_date: TODAY, upload_batch: 'NEW', created_at: TODAY + 'T06:00:00Z' });
  }
  const db = fakeDb({ ...tables(), defaulter_snapshots: snaps, followup_status: reg });
  const r = await retireFollowupAfterDeck(db, 'MON', 'NEW', TODAY);
  assert.equal(r.retired, 10, 'exactly the ten live customers the deck no longer names');
  assert.equal(r.capped, 0, 'ten of two hundred and fifty is nowhere near the brake');
  /* THE BRAKE COUNTS THE LIVE ROWS, NOT EVERY ROW. Were the fifty retired rows still in the
     denominator the ceiling would sit at 270 instead of 225, which is the sort of drift a
     "same answer, cheaper read" change makes silently. */
  const live = db._dump('followup_status').filter(x => !(x.status == null && x.arrears == null));
  assert.equal(live.length, 240, 'the deck\'s own people, and nobody else, are left standing');
});

test('an upload with no clock left does its tidying next time rather than dying at the host', async () => {
  const { uploadClock, beforeDeadline } = await import('../api/upload.js');
  /* A budget already spent. `worth()` is what the upload asks before starting a step, and it
     must say no -- starting a thirty-second read with two seconds of platform time left is how
     a finished upload becomes a 504. */
  let t = 100000;
  const spent = uploadClock(0, 45000, () => t);
  assert.equal(spent.left(), 0, 'nothing left of the budget');
  assert.equal(spent.worth(), false, 'so no housekeeping step may start');

  t = 1000;
  const fresh = uploadClock(0, 45000, () => t);
  assert.equal(fresh.worth(), true, 'a second into the request there is plenty of room');
  assert.equal(fresh.left(), 44000);

  /* And a step that overruns is ABANDONED with the fallback, not waited out. The abandoned
     promise keeps running -- nothing here cancels a database write half done -- so the test
     also proves the answer does not wait for it. */
  let settled = false;
  const slow = new Promise(res => setTimeout(() => { settled = true; res('too late'); }, 5000));
  const got = await beforeDeadline(slow, 30, null);
  assert.equal(got, null, 'the deadline answers, not the slow step');
  assert.equal(settled, false, 'and it answered before the slow step finished');
});

test('a deferred retirement is reported in the upload\'s own message, never swallowed', async () => {
  /* "The file is in and one tidying step is a day late" and "the upload failed" are completely
     different facts, and the person at the keyboard can only tell them apart if the result says
     so. This reads the source rather than running a request, because what is under test is that
     the sentence EXISTS on the deferred path at all -- a silent skip is the failure shape. */
  const src = await readFile(new URL('../api/upload.js', import.meta.url), 'utf8');
  assert.match(src, /followupDeferred \? `/, 'the deferred retirement has its own sentence');
  assert.match(src, /sweepDeferred \? `/, 'and so does the deferred sweep');
  assert.match(src, /The deck is in\./, 'which says the upload itself succeeded, first');
  assert.match(src, /The next current-defaulters upload does it in full/,
    'and says when it will be done, so nobody has to go looking for a button');
});

/* =====================================================================================
   FIND ONE OFFICER, RATHER THAN SHIPPING EVERY OFFICER.
   =====================================================================================
     "enable search officer by name/number while the live search shows name no and team so as
      to produce person reports., having the whole list on font end is tooo long"

   The Calls screen sent the roster to the browser twice -- a dropdown of every user who made a
   call, and a table of every officer in the report -- and then asked somebody to find one name
   in it. This answers the same question at the database.
   ===================================================================================== */
const OFFICERS = () => ({
  ...tables(),
  call_users: [
    { user_id: 'u1', name: 'CATHERINE MWAKALINGA', phone: '788111222', team: 'KONGOWE', role: 'PMO COLLECTION' },
    { user_id: 'u2', name: 'JUMA ISSA', phone: '712999999', team: 'KONGOWE', role: 'OFFICER' },
    { user_id: 'u3', name: 'CATHERINE JOHN', phone: '755000111', team: 'MBAGALA', role: 'OFFICER' },
    { user_id: 'u4', name: 'SWITCHED OFF', phone: '766000222', team: 'KONGOWE', role: 'OFFICER', active: false },
  ],
});

test('an officer is found by name, and the hit says who they are', async () => {
  const db = fakeDb(OFFICERS());
  const r = await portalApi(db, ADMIN, 'callOfficers', { q: 'CATHERINE' }, NOW);
  assert.equal(r.rows.length, 2, 'two people share that first name -- which is the point');
  const [a, b] = r.rows;
  assert.equal(a.name, 'CATHERINE JOHN');
  /* Name, NUMBER and TEAM: without those two extra fields the list cannot tell them apart. */
  assert.equal(a.phone, '755000111');
  assert.equal(a.team, 'MBAGALA');
  assert.equal(b.team, 'KONGOWE');
});

test('an officer is found by the number as it is typed off a handset', async () => {
  /* Phones are stored normalised -- no leading zero, no country code -- so matching the typed
     string literally would find nothing for anybody typing 0712... */
  const db = fakeDb(OFFICERS());
  for (const typed of ['0712999999', '712999999', '+255712999999', '999999']) {
    const r = await portalApi(db, ADMIN, 'callOfficers', { q: typed }, NOW);
    assert.ok(r.rows.some(x => x.name === 'JUMA ISSA'), 'not found for ' + typed);
  }
});

test('the search is scoped to what the caller may already see', async () => {
  /* It must not become a way of reading a roster somebody has no business reading. */
  const db = fakeDb(OFFICERS());
  const r = await portalApi(db, GMO, 'callOfficers', { q: 'CATHERINE' }, NOW);
  assert.deepEqual(r.rows.map(x => x.team), ['KONGOWE'], 'MBAGALA is not theirs');
});

test('one letter is refused rather than answered with half the staff', async () => {
  const db = fakeDb(OFFICERS());
  const r = await portalApi(db, ADMIN, 'callOfficers', { q: 'C' }, NOW);
  assert.equal(r.tooShort, true);
  assert.equal(r.rows.length, 0);
});

test('a switched-off account is not offered', async () => {
  const db = fakeDb(OFFICERS());
  const r = await portalApi(db, ADMIN, 'callOfficers', { q: 'SWITCHED' }, NOW);
  assert.equal(r.rows.length, 0, 'an account an admin turned off is not somebody to report on');
});

/* =====================================================================================
   A PERSON'S TEAMS ARE THE TEAMS THEY HOLD, NOT THE TEAMS THEIR CALLS LANDED ON.
   =====================================================================================
     "teams - loaded single team ... it loaded just dodoma for Betty instead of all her
      assigned teams"

   A call is stamped with the officer's home team at the moment it syncs. Building the set from
   the report's own rows therefore resolved a leader of eleven teams down to the one her own
   calls happened to land on, and the report about her book showed an eleventh of it.
   ===================================================================================== */
test('picking a leader reports every team they hold, not the one their calls landed on', async () => {
  const t = tables();
  /* BETTY leads three teams on the teams table. Her own calls all land on DODOMA, because that
     is the team her handset is registered to. */
  t.teams = [
    { team: 'DODOMA', manager: 'BETTY M', recovery: 'R1' },
    { team: 'SINGIDA', manager: 'BETTY M', recovery: 'R2' },
    { team: 'TABORA', gmo: 'BETTY M', recovery: 'R3' },
    { team: 'MBEYA', manager: 'SOMEBODY ELSE', recovery: 'R4' },
  ];
  t.call_users = [
    { user_id: 'b1', name: 'BETTY M', team: 'DODOMA', role: 'MANAGER', is_leader: true, leader_teams: null },
    { user_id: 'o1', name: 'OFFICER SINGIDA', team: 'SINGIDA', role: 'OFFICER' },
    { user_id: 'o2', name: 'OFFICER MBEYA', team: 'MBEYA', role: 'OFFICER' },
  ];
  t.call_logs = [
    { id: 'c1', user_id: 'b1', officer: 'BETTY M', team: 'DODOMA', call_date: TODAY, duration: 60, portfolio: true, category: 'EXPECTED', outcome: 'CONNECTED' },
    { id: 'c2', user_id: 'o1', officer: 'OFFICER SINGIDA', team: 'SINGIDA', call_date: TODAY, duration: 30, portfolio: true, category: 'EXPECTED', outcome: 'CONNECTED' },
    { id: 'c3', user_id: 'o2', officer: 'OFFICER MBEYA', team: 'MBEYA', call_date: TODAY, duration: 30, portfolio: true, category: 'EXPECTED', outcome: 'CONNECTED' },
  ];
  const db = fakeDb(t);
  const d = await portalApi(db, ADMIN, 'callReport',
    { from: TODAY, to: TODAY, user: 'BETTY M' }, NOW);

  const got = (d.userTeams || []).map(x => String(x).toUpperCase()).sort();
  assert.deepEqual(got, ['DODOMA', 'SINGIDA', 'TABORA'],
    'all three she holds -- not just the one her own calls landed on');
  assert.ok(!got.includes('MBEYA'), 'and not a team that is somebody else\'s');

  /* And the officers under her come with it: her patch, which is the question being asked. */
  const names = (d.users || []).map(u => u.name).sort();
  assert.ok(names.includes('OFFICER SINGIDA'), 'the officer on a team she holds is in her report');
  assert.ok(!names.includes('OFFICER MBEYA'), 'the officer on somebody else\'s team is not');
});

test('a plain officer still resolves to their own team', async () => {
  /* The half that must not move: somebody who holds no role column anywhere is their home team
     plus wherever they actually worked, and nothing more. */
  const t = tables();
  t.teams = [{ team: 'DODOMA', manager: 'BETTY M' }, { team: 'SINGIDA', manager: 'BETTY M' }];
  t.call_users = [{ user_id: 'o1', name: 'PLAIN OFFICER', team: 'DODOMA', role: 'OFFICER' }];
  t.call_logs = [{ id: 'c1', user_id: 'o1', officer: 'PLAIN OFFICER', team: 'DODOMA',
    call_date: TODAY, duration: 60, portfolio: true, category: 'EXPECTED', outcome: 'CONNECTED' }];
  const db = fakeDb(t);
  const d = await portalApi(db, ADMIN, 'callReport',
    { from: TODAY, to: TODAY, user: 'PLAIN OFFICER' }, NOW);
  assert.deepEqual((d.userTeams || []).map(x => String(x).toUpperCase()), ['DODOMA']);
});

/* =====================================================================================
   AN ACCESS CODE AND THE TEAMS TABLE ARE ONE FACT KEPT IN TWO PLACES.
   =====================================================================================
   "Updating User accesscode for a role should auto update the names and teams accessed in
    the teams and staff"

   The damage this prevents is quiet: the teams table is what the weekly boards, the officer
   boards and the recycling rotation all read, so a name that drifts between the two registers
   is an officer whose work simply stops being counted. Nothing says so -- it reads zero.
*/
test('saving a code with a team list files that person into Teams & Staff', async () => {
  const book = tables();
  const db = fakeDb(book);
  await portalApi(db, ADMIN, 'saveAccessCode',
    { code: 'N1', name: 'NEW GMO', role: 'GMO', teams: 'KONGOWE, MBAGALA' }, NOW);
  const t = db._dump('teams');
  assert.equal(t.find(x => x.team === 'KONGOWE').gmo, 'NEW GMO');
  assert.equal(t.find(x => x.team === 'MBAGALA').gmo, 'NEW GMO');
});

test('renaming the person on a code renames them across the teams they hold', async () => {
  const book = tables();
  book.access_codes.push({ code: 'R1', name: 'JUMA G', role: 'RECOVERY', teams: ['KONGOWE'], tabs: [] });
  const db = fakeDb(book);
  const r = await portalApi(db, ADMIN, 'saveAccessCode',
    { code: 'R1', oldCode: 'R1', name: 'JUMA GEORGE', role: 'RECOVERY', teams: 'KONGOWE' }, NOW);
  assert.equal(db._dump('teams').find(x => x.team === 'KONGOWE').recovery, 'JUMA GEORGE',
    'the teams table still credited the old spelling, so his work would read zero');
  assert.equal(r.staff.renamedOn, 1, 'and the admin is told, not left to notice');
});

test('taking a team off a code takes the person off that team', async () => {
  const book = tables();
  book.teams.find(x => x.team === 'MBAGALA').recovery = 'JUMA G';
  book.access_codes.push({ code: 'R1', name: 'JUMA G', role: 'RECOVERY', teams: ['KONGOWE', 'MBAGALA'], tabs: [] });
  const db = fakeDb(book);
  await portalApi(db, ADMIN, 'saveAccessCode',
    { code: 'R1', oldCode: 'R1', name: 'JUMA G', role: 'RECOVERY', teams: 'KONGOWE' }, NOW);
  const t = db._dump('teams');
  assert.equal(t.find(x => x.team === 'KONGOWE').recovery, 'JUMA G');
  assert.equal(t.find(x => x.team === 'MBAGALA').recovery, null, 'MBAGALA was dropped from the code');
});

test('ALL teams never makes one person the officer of every team', async () => {
  /* Blank means unscoped -- "may see everything" -- not "is in charge of everything". Writing
     it through would put one name in all seventy-eight rows of a live teams table. */
  const book = tables();
  const db = fakeDb(book);
  await portalApi(db, ADMIN, 'saveAccessCode',
    { code: 'N2', name: 'BIG BOSS', role: 'GMO', teams: 'ALL' }, NOW);
  for (const t of db._dump('teams')) assert.equal(t.gmo, null, t.team + ' was quietly assigned');
});

test('a role with no column in the teams table writes nothing', async () => {
  const book = tables();
  const db = fakeDb(book);
  const before = JSON.stringify(db._dump('teams'));
  const r = await portalApi(db, ADMIN, 'saveAccessCode',
    { code: 'N3', name: 'CATHERINE', role: 'PMO', teams: 'KONGOWE' }, NOW);
  assert.equal(r.staff, null, 'a collection officer keeps their teams on the code itself');
  assert.equal(JSON.stringify(db._dump('teams')), before);
});

test('another officer holding the team is never blanked by somebody else\'s save', async () => {
  /* Asha's teams are edited; the person who took KONGOWE over from her must survive it. */
  const book = tables();
  book.teams.find(x => x.team === 'KONGOWE').gmo = 'THE SUCCESSOR';
  const db = fakeDb(book);
  await portalApi(db, ADMIN, 'saveAccessCode',
    { code: 'N4', name: 'ASHA', role: 'GMO', teams: 'MBAGALA' }, NOW);
  const t = db._dump('teams');
  assert.equal(t.find(x => x.team === 'KONGOWE').gmo, 'THE SUCCESSOR');
  assert.equal(t.find(x => x.team === 'MBAGALA').gmo, 'ASHA');
});

test('the roster shows the change straight away', async () => {
  const book = tables();
  const db = fakeDb(book);
  await portalApi(db, ADMIN, 'saveAccessCode',
    { code: 'N5', name: 'NEW GMO', role: 'GMO', teams: 'KONGOWE' }, NOW);
  const r = await portalApi(db, ADMIN, 'staffRoster', {}, NOW);
  const row = r.staff.find(s => s.name === 'NEW GMO' && s.role === 'gmo');
  assert.ok(row, 'Teams & Staff never heard about the code that was just saved');
  assert.deepEqual(row.teams, ['KONGOWE']);
});

/* =====================================================================================
   MANAGE CALL APP USERS -- the three faults behind "simamisha doesnt work".
   =====================================================================================
   1. On a database without 2026-07-26-officer-accounts.sql, every save failed with
      "schema cache", which reads like the system is broken rather than like a file is
      waiting to be pasted.
   2. The form never sent leaderTeams, and an absent field wrote null -- so merely opening
      a multi-team leader and pressing Save collapsed their scope to nothing.
   3. The sign-the-phone-out form existed but nothing could reach it (UI-side, covered by
      the officerForm rewiring).
*/
test('an un-migrated database refuses the officer save in plain words, naming the file', async () => {
  const db = fakeDb(tables(), { missingColumns: { call_users: ['active', 'passcode_hash', 'passcode_salt', 'passcode_set_at', 'created_by'] } });
  await assert.rejects(
    () => portalApi(db, ADMIN, 'saveOfficerAccount',
      { name: 'ASHA O', phone: '0713111222', team: 'KONGOWE' }, NOW),
    e => e.status === 400 && /2026-07-26-officer-accounts\.sql/.test(e.message)
      && !/schema cache/.test(e.message.split('\n')[0]),
    'the first line an admin reads must name the file, not the schema cache');
});

test('editing a leader without mentioning their teams leaves the teams alone', async () => {
  const book = tables();
  book.call_users = [{ user_id: 'UB', name: 'BETTY', team: null, phone: '713000111',
    is_leader: true, leader_teams: ['KONGOWE', 'MBAGALA'], active: true, role: 'LEADER' }];
  const db = fakeDb(book);
  // The rename an admin actually performs: name changes, leaderTeams not sent at all.
  await portalApi(db, ADMIN, 'saveOfficerAccount',
    { name: 'BETTY M', phone: '713000111', isLeader: true }, NOW);
  const u = db._dump('call_users').find(x => x.user_id === 'UB');
  assert.equal(u.name, 'BETTY M');
  assert.deepEqual(u.leader_teams, ['KONGOWE', 'MBAGALA'],
    'her multi-team scope was erased by a save that never mentioned it');
});

test('sending leaderTeams still changes them, and demotion still clears them', async () => {
  const book = tables();
  book.call_users = [{ user_id: 'UB', name: 'BETTY', team: null, phone: '713000111',
    is_leader: true, leader_teams: ['KONGOWE'], active: true, role: 'LEADER' }];
  const db = fakeDb(book);
  await portalApi(db, ADMIN, 'saveOfficerAccount',
    { name: 'BETTY', phone: '713000111', isLeader: true, leaderTeams: 'KONGOWE, MBAGALA' }, NOW);
  assert.deepEqual(db._dump('call_users')[0].leader_teams, ['KONGOWE', 'MBAGALA']);
  // Demoted: the scope goes with the rank -- a list without the rank is a door left unlocked.
  await portalApi(db, ADMIN, 'saveOfficerAccount',
    { name: 'BETTY', phone: '713000111', isLeader: false, team: 'KONGOWE' }, NOW);
  assert.equal(db._dump('call_users')[0].leader_teams, null);
});

test('switching an officer off cuts the handset in the same save', async () => {
  const book = tables();
  book.call_users = [{ user_id: 'UO', name: 'ASHA O', team: 'KONGOWE', phone: '713000222',
    device_id: 'DEV1', active: true, role: 'OFFICER', is_leader: false }];
  const db = fakeDb(book);
  await portalApi(db, ADMIN, 'saveOfficerAccount',
    { name: 'ASHA O', phone: '713000222', team: 'KONGOWE', active: false }, NOW);
  const u = db._dump('call_users')[0];
  assert.equal(u.active, false);
  assert.equal(u.device_id, null, 'off must mean off NOW, not at their next sign-out');
});

/* =====================================================================================
   THE READ-ONLY ADMIN -- SUPERVISION THAT CANNOT LEAVE FINGERPRINTS.
   =====================================================================================
   "I need to create an admin with [read only] user characteristics to view and try
    everything without changing nothing ... their team that do so could also use ai to
    login and check whats what -- but read only"
*/
const AUDITOR = { code: 'V', name: 'SUPERVISOR', role: 'AUDITOR', teams: null,
  tabs: ['dashboard', 'teams', 'settings', 'audit'], readOnly: true };

test('a view-only code opens the admin screens', async () => {
  const db = fakeDb(tables());
  const d = await portalApi(db, AUDITOR, 'dashboard', {}, NOW);
  assert.ok(d);
  const s = await portalApi(db, AUDITOR, 'settings', {}, NOW);
  assert.ok(s.rows.length, 'the settings screen itself is visible');
});

test('every write is refused at the one door, loudly', async () => {
  const db = fakeDb(tables());
  for (const [fn, args] of [
    ['saveTeam', { team: 'KONGOWE', gmo: 'INTRUDER' }],
    ['settingSet', { key: 'CMS_PAID_TZS', value: '9' }],
    ['saveAccessCode', { code: 'X1', name: 'X', role: 'GMO' }],
    ['deleteTeam', { team: 'MBAGALA' }],
    ['saveOfficerAccount', { name: 'X', phone: '0713000999', team: 'KONGOWE' }],
    ['stampWeek', {}],                    // a maintenance write, deliberately unaudited
    ['rebuildFollowup', {}],
  ]) {
    await assert.rejects(() => portalApi(fakeDb(tables()), AUDITOR, fn, args, NOW),
      e => e.status === 403 && /view-only/.test(e.message), fn + ' was not refused');
  }
  // And nothing moved: the team above is exactly as the fixture made it.
  assert.equal(db._dump('teams').find(t => t.team === 'KONGOWE').gmo, null);
});

test('the secrets are masked, never sent to a view-only screen', async () => {
  const book = tables();
  book.teams.find(t => t.team === 'KONGOWE').team_code = 'KON123';
  book.access_codes.push({ code: 'SECRET9', name: 'HOLDER', role: 'GMO', teams: ['KONGOWE'], tabs: [] });
  const db = fakeDb(book);
  const t = await portalApi(db, AUDITOR, 'teams', {}, NOW);
  assert.equal(t.rows.find(r => r.team === 'KONGOWE').team_code, '••••');
  const c = await portalApi(db, AUDITOR, 'accessCodes', {}, NOW);
  assert.ok(c.rows.length >= 2);
  for (const r of c.rows) assert.equal(r.code, '••••', 'a code IS a password');
  // And the file that would carry them out is refused outright.
  await assert.rejects(() => portalApi(db, AUDITOR, 'teamsExport', {}, NOW),
    e => e.status === 403);
  // The admin still sees everything exactly as before.
  const ta = await portalApi(db, ADMIN, 'teams', {}, NOW);
  assert.equal(ta.rows.find(r => r.team === 'KONGOWE').team_code, 'KON123');
});

test('a view-only code does not register a handset', async () => {
  const { callApi } = await import('../api/_lib/call-core.js');
  const book = tables();
  book.access_codes.push({ code: 'VIEW1', name: 'SUPERVISOR', role: 'READONLY', teams: null, tabs: [] });
  const db = fakeDb(book);
  await assert.rejects(
    () => callApi(db, 'api_callRegister', ['dev-v', '', '', 'VIEW1', '0788999888'], NOW),
    e => /view-only|kuangalia tu/.test(String(e && e.message || e)));
});

test('the read-only role is recognised in all its spellings, and only those', async () => {
  const { isReadOnly, resolveTabs } = await import('../api/_lib/auth.js');
  for (const r of ['AUDITOR', 'auditor', 'READONLY', 'READ ONLY', 'READ-ONLY']) {
    assert.equal(isReadOnly({ role: r }), true, r);
  }
  for (const r of ['ADMIN', 'GMO', 'READER', '']) assert.equal(isReadOnly({ role: r }), false, r);
  const tabs = resolveTabs({ role: 'AUDITOR', tabs: [] }, null);
  assert.ok(tabs.includes('settings') && tabs.includes('audit'), 'sees the admin screens');
  assert.equal(tabs.includes('upload'), false, 'the upload door is not even drawn');
});

test('a role is found however it is spelled, and "no such role" is not "no tabs"', async () => {
  /* The permission checks found the role's row with an exact string comparison. Role names
     are typed by hand twice -- once on the code, once in the roles table, which stores them
     uppercased -- so "Pmo Collection" beside "PMO COLLECTION" granted NOTHING, with a full
     tick list on screen and no message anywhere. Same shape as the Tunduru blackout. */
  const { pickRoleTabs } = await import('../api/_lib/auth.js');
  const rows = [{ role: 'PMO COLLECTION', tabs: ['followup', 'par'] },
    { role: 'GMO', tabs: [] }];
  for (const spelling of ['PMO COLLECTION', 'Pmo Collection', 'pmo collection', '  PMO Collection  ']) {
    assert.deepEqual(pickRoleTabs(rows, spelling), ['followup', 'par'], spelling);
  }
  /* NULL AND [] ARE DIFFERENT ANSWERS. A role with a row and no tabs has been deliberately
     emptied; a role with no row has never been set. resolveTabs falls back to the basic tabs
     for the second and must not be handed the first by mistake. */
  assert.deepEqual(pickRoleTabs(rows, 'GMO'), [], 'a real role that holds nothing');
  assert.equal(pickRoleTabs(rows, 'ZONE OFFICER'), null, 'a role with no row at all');
  assert.equal(pickRoleTabs(rows, ''), null);
  assert.equal(pickRoleTabs(null, 'GMO'), null, 'and a database that answered nothing');
});

/* =====================================================================================
   A LEADER'S NUMBER COMES FROM WHERE THE LEADER ACTUALLY KEEPS IT.
   =====================================================================================
   "read phone numbers in leaders table directly from call app users b/se thats where i
    mostly update leaders data and their teams"

   The sheet is uploaded now and then; the app is where the same person signs in every day
   with the number they actually carry. So the app's number beats the sheet's, matched by
   name -- and where nobody is registered, the sheet's column still stands, because the
   overlay must never replace a number with a blank.
*/
test('the teams screen shows the app number over the sheet number', async () => {
  const book = tables();
  book.teams.find(x => x.team === 'KONGOWE').recovery_no = '0700000001';   // the sheet's stale one
  book.call_users = [{ user_id: 'UR', name: 'JUMA G', team: 'KONGOWE', role: 'OFFICER',
    is_leader: false, phone: '0788999888', registered_at: '2026-08-01T00:00:00Z' }];
  const d = await portalApi(fakeDb(book), ADMIN, 'teams', {}, NOW);
  const kongowe = d.rows.find(r => r.team === 'KONGOWE');
  assert.equal(kongowe.recovery_no, '0788999888', 'the app number is the one that rings');
  assert.equal(kongowe.manager, 'BOSS', 'nothing else on the row moved');
});

test('a supervisor nobody registered keeps the sheet number', async () => {
  const book = tables();
  book.teams.find(x => x.team === 'KONGOWE').manager_no = '0711222333';
  const d = await portalApi(fakeDb(book), ADMIN, 'teams', {}, NOW);
  assert.equal(d.rows.find(r => r.team === 'KONGOWE').manager_no, '0711222333');
});

test('a switched-off registration cannot supply a number', async () => {
  const book = tables();
  book.teams.find(x => x.team === 'KONGOWE').recovery_no = '0700000001';
  book.call_users = [{ user_id: 'UR', name: 'JUMA G', team: 'KONGOWE', role: 'OFFICER',
    is_leader: false, phone: '0788999888', active: false, registered_at: '2026-08-01T00:00:00Z' }];
  const d = await portalApi(fakeDb(book), ADMIN, 'teams', {}, NOW);
  assert.equal(d.rows.find(r => r.team === 'KONGOWE').recovery_no, '0700000001',
    'an account the admin switched off is not a source of anything');
});

test('two registrations under one name: the leader\'s, then the newest', async () => {
  const book = tables();
  book.call_users = [
    { user_id: 'U1', name: 'JUMA G', team: 'KONGOWE', is_leader: false, phone: '0700000111',
      registered_at: '2026-08-10T00:00:00Z' },
    { user_id: 'U2', name: 'JUMA G', team: 'KONGOWE', is_leader: true, phone: '0700000222',
      registered_at: '2026-08-01T00:00:00Z' },
  ];
  const d = await portalApi(fakeDb(book), ADMIN, 'teams', {}, NOW);
  assert.equal(d.rows.find(r => r.team === 'KONGOWE').recovery_no, '0700000222',
    'the leader registration wins even though the officer one is newer');
});

test('the staff roster carries each person\'s number and says where it came from', async () => {
  const book = tables();
  book.teams.find(x => x.team === 'KONGOWE').credit_no = '0755000111';
  book.call_users = [{ user_id: 'UJ', name: 'JUMA G', team: 'KONGOWE', is_leader: false,
    phone: '0788999888', registered_at: '2026-08-01T00:00:00Z' }];
  const r = await portalApi(fakeDb(book), ADMIN, 'staffRoster', {}, NOW);
  const juma = r.staff.find(s => s.name === 'JUMA G' && s.role === 'recovery');
  assert.equal(juma.phone, '0788999888');
  assert.equal(juma.phoneFrom, 'app');
  const analyst = r.staff.find(s => s.name === 'ANALYST A' && s.role === 'credit');
  assert.equal(analyst.phone, '0755000111', 'no registration, so the sheet answers');
  assert.equal(analyst.phoneFrom, 'sheet');
  const boss = r.staff.find(s => s.name === 'BOSS' && s.role === 'manager');
  assert.equal(boss.phone, null, 'no number anywhere is shown as no number, not invented');
});

/* =====================================================================================
   THE PHONE LIST -- role, team, name, number, as an export.
   =====================================================================================
   "I need my leaders and officers no.s so export excel of role, team, officername and
    phoneno"
*/
test('staffExport lists every named supervisor per team with the freshest number', async () => {
  const book = tables();
  book.teams.find(x => x.team === 'KONGOWE').recovery_no = '0700000001';
  book.call_users = [{ user_id: 'UJ', name: 'JUMA G', team: 'KONGOWE', is_leader: false,
    phone: '0788999888', registered_at: '2026-08-01T00:00:00Z' }];
  const d = await portalApi(fakeDb(book), ADMIN, 'staffExport', {}, NOW);
  assert.deepEqual(d.headers, ['WADHIFA / ROLE', 'TIMU / TEAM', 'JINA / NAME', 'NAMBA / PHONE NO']);
  const rec = d.rows.find(r => r[0] === 'RECOVERY' && r[1] === 'KONGOWE');
  assert.deepEqual(rec, ['RECOVERY', 'KONGOWE', 'JUMA G', '0788999888'],
    'the app number, not the sheet\'s stale one');
  const mgr = d.rows.find(r => r[0] === 'MANAGER' && r[1] === 'KONGOWE');
  assert.equal(mgr[2], 'BOSS');
});

test('contactsExport: Google-format contacts off the call-app register, admin only', async () => {
  // "The GM needs to get all company contacts into hq new phones by importing csv" -- the
  // header names are Google's own import format, EXACT, because its importer matches on them.
  const book = tables();
  book.call_users = [
    { user_id: 'U1', name: 'FIELD ROBERT ONE', team: 'KONGOWE', role: 'OFFICER', is_leader: false, phone: '712999999' },
    { user_id: 'U2', name: 'BOSS', team: 'KONGOWE', role: 'LEADER', is_leader: true, leader_teams: ['KONGOWE'], phone: '0755000111' },
    { user_id: 'U3', name: 'GONE PERSON', team: 'KONGOWE', role: 'OFFICER', is_leader: false, phone: '712000000', active: false },
  ];
  const db = fakeDb(book);
  await assert.rejects(() => portalApi(db, GMO, 'contactsExport', {}, NOW), e => e.status === 403);
  const d = await portalApi(db, ADMIN, 'contactsExport', {}, NOW);
  assert.deepEqual(d.headers, ['Name', 'Given Name', 'Additional Name', 'Family Name',
    'E-mail 1 - Type', 'E-mail 1 - Value', 'Phone 1 - Type', 'Phone 1 - Value',
    'Organization 1 - Name', 'Organization 1 - Title', 'Notes']);
  assert.equal(d.count, 2, 'switched-off accounts stay out');
  const officer = d.rows.find(r => r[0] === 'FIELD ROBERT ONE');
  assert.deepEqual(officer.slice(1, 4), ['FIELD', 'ROBERT', 'ONE'], 'given / additional / family from the one full name');
  assert.equal(officer[6], 'Mobile');
  assert.equal(officer[7], '+255712999999', 'normPhone\'s nine digits come out E.164');
  assert.equal(officer[8], 'HOPE Microcredit');
  assert.equal(officer[9], 'Officer', 'not in any teams role column -- the registration default');
  const boss = d.rows.find(r => r[0] === 'BOSS');
  assert.equal(boss[7], '+255755000111', 'a stored leading zero still lands E.164');
  assert.equal(boss[9], 'Manager', 'title from the teams role columns, the one shared definition');
  assert.ok(boss[10].indexOf('Leads: KONGOWE') >= 0);
});

test('staffExport carries the collection officers, one row per team on their code', async () => {
  const book = tables();
  book.access_codes.push({ code: 'C9', name: 'CATHERINE', role: 'PMO', teams: ['KONGOWE', 'MBAGALA'], tabs: [] });
  book.settings.push({ key: 'PMO_ROLE', value: 'PMO' });
  book.call_users = [{ user_id: 'UC', name: 'CATHERINE', team: 'KONGOWE', is_leader: true,
    phone: '0766000555', registered_at: '2026-08-01T00:00:00Z' }];
  const d = await portalApi(fakeDb(book), ADMIN, 'staffExport', {}, NOW);
  const hers = d.rows.filter(r => r[2] === 'CATHERINE' && r[0] !== 'LEADER (APP)');
  assert.equal(hers.length, 2, 'one row per team she holds');
  assert.ok(hers.every(r => r[3] === '0766000555'));
});

test('staffExport includes the app\'s field officers -- the people no sheet carries', async () => {
  const book = tables();
  book.call_users = [
    { user_id: 'UF', name: 'FIELD ONE', team: 'KONGOWE', is_leader: false, phone: '0712000001',
      registered_at: '2026-08-01T00:00:00Z' },
    { user_id: 'UX', name: 'GONE PERSON', team: 'KONGOWE', is_leader: false, phone: '0712000002',
      active: false, registered_at: '2026-08-01T00:00:00Z' },
  ];
  const d = await portalApi(fakeDb(book), ADMIN, 'staffExport', {}, NOW);
  const off = d.rows.find(r => r[0] === 'OFFICER' && r[2] === 'FIELD ONE');
  assert.deepEqual(off, ['OFFICER', 'KONGOWE', 'FIELD ONE', '0712000001']);
  assert.equal(d.rows.some(r => r[2] === 'GONE PERSON'), false,
    'a switched-off account is not on a call list');
});

test('the downloaded leaders sheet also carries the fresh app numbers', async () => {
  /* So the download-edit-upload round trip WRITES the fresh number into the sheet,
     rather than quietly reviving the stale one on the next upload. */
  const book = tables();
  book.teams.find(x => x.team === 'KONGOWE').recovery_no = '0700000001';
  book.call_users = [{ user_id: 'UJ', name: 'JUMA G', team: 'KONGOWE', is_leader: false,
    phone: '0788999888', registered_at: '2026-08-01T00:00:00Z' }];
  const d = await portalApi(fakeDb(book), ADMIN, 'teamsExport', {}, NOW);
  const i = d.headers.indexOf('RECOVERY NO');
  assert.ok(i > 0, 'the export has a RECOVERY NO column');
  const kong = d.rows.find(r => r[0] === 'KONGOWE' || r.includes('KONGOWE'));
  assert.equal(kong[i], '0788999888');
});

/* =====================================================================================
   THE SAME PERSON UNDER TWO LENGTHS OF NAME.
   =====================================================================================
     registered in the app:  CAREEN            677123160
     named on the sheet:     CAREEN GODFREY    -- roster showed no number at all

   People register with the name they answer to; the sheet carries the full one. The match
   must bridge that -- but only when exactly one registration fits. Two Careens is not a
   match, it is a question, and a phone number is the wrong place to guess.
*/
test('CAREEN in the app answers for CAREEN GODFREY on the sheet', async () => {
  const book = tables();
  book.teams.find(x => x.team === 'KONGOWE').recovery = 'CAREEN GODFREY';
  book.call_users = [{ user_id: 'UC', name: 'CAREEN', team: 'IRINGA B', is_leader: true,
    phone: '677123160', registered_at: '2026-08-01T00:00:00Z' }];
  const d = await portalApi(fakeDb(book), ADMIN, 'teams', {}, NOW);
  assert.equal(d.rows.find(r => r.team === 'KONGOWE').recovery_no, '677123160');
  const r = await portalApi(fakeDb(book), ADMIN, 'staffRoster', {}, NOW);
  const her = r.staff.find(s => s.name === 'CAREEN GODFREY' && s.role === 'recovery');
  assert.equal(her.phone, '677123160', 'the number she registered with, found by her short name');
  assert.equal(her.phoneFrom, 'app');
});

test('a single letter on the sheet is an initial: JUMA GEORGE answers for JUMA G', async () => {
  const book = tables();   // KONGOWE's recovery is 'JUMA G'
  book.call_users = [{ user_id: 'UJ', name: 'JUMA GEORGE', team: 'KONGOWE', is_leader: false,
    phone: '0713555666', registered_at: '2026-08-01T00:00:00Z' }];
  const d = await portalApi(fakeDb(book), ADMIN, 'teams', {}, NOW);
  assert.equal(d.rows.find(r => r.team === 'KONGOWE').recovery_no, '0713555666');
});

test('two registrations that both fit a name is a question, not a match', async () => {
  const book = tables();
  book.teams.find(x => x.team === 'KONGOWE').gmo = 'ASHA';
  book.teams.find(x => x.team === 'KONGOWE').gmo_no = '0700000009';
  book.call_users = [
    { user_id: 'A1', name: 'ASHA JUMA', team: 'KONGOWE', is_leader: false, phone: '0711111111',
      registered_at: '2026-08-01T00:00:00Z' },
    { user_id: 'A2', name: 'ASHA PETER', team: 'MBAGALA', is_leader: false, phone: '0722222222',
      registered_at: '2026-08-02T00:00:00Z' },
  ];
  const d = await portalApi(fakeDb(book), ADMIN, 'teams', {}, NOW);
  assert.equal(d.rows.find(r => r.team === 'KONGOWE').gmo_no, '0700000009',
    'ambiguous, so the sheet number stands rather than a guessed one');
});

test('an exact name still beats a contained one', async () => {
  const book = tables();
  book.teams.find(x => x.team === 'KONGOWE').gmo = 'ASHA JUMA';
  book.call_users = [
    { user_id: 'A1', name: 'ASHA JUMA', team: 'KONGOWE', is_leader: false, phone: '0711111111',
      registered_at: '2026-08-01T00:00:00Z' },
    { user_id: 'A2', name: 'ASHA', team: 'MBAGALA', is_leader: true, phone: '0722222222',
      registered_at: '2026-08-02T00:00:00Z' },
  ];
  const d = await portalApi(fakeDb(book), ADMIN, 'teams', {}, NOW);
  assert.equal(d.rows.find(r => r.team === 'KONGOWE').gmo_no, '0711111111',
    'her own exact registration, not the leader short-name one');
});

/* =====================================================================================
   RECOVERY METRICS: OFF JANA tracking and credit user performance
   =====================================================================================
   OFF JANA = customers 7+ days offline from previous upload
   Goal: Track which customers recovered (dropped below 7 days) and who chased them.
*/
test('recoveryByCredit tracks customers who recovered from 7+ day lockout', async () => {
  const book = tables();
  // Friday's defaulters (TODAY): customers with various days_elapsed
  book.defaulter_snapshots.push(
    D('R1', 'KONGOWE', 500, 'current', 5, TODAY),   // improved from 8 to 5 (recovered)
  );
  // Thursday (YEST): R1 was locked 8 days
  book.defaulter_snapshots.push(
    D('R1', 'KONGOWE', 500, 'current', 8, YEST),    // was 8 days locked (OFF JANA)
  );
  // Credit users on KONGOWE
  book.call_users = [
    { user_id: 'UC1', name: 'CREDIT ONE', team: 'KONGOWE', role: 'CREDIT', is_leader: false,
      phone: '0712000001', registered_at: '2026-08-01T00:00:00Z' },
  ];

  const d = await portalApi(fakeDb(book), ADMIN, 'recoveryByCredit', {}, NOW);

  assert.ok(d.metrics, 'returns metrics array');
  // Should have some recovery data
  const summary = d.metrics.filter(m => m.date === TODAY);
  assert.ok(summary.length > 0, 'has recovery data for the requested day');
  // Should show 1 OFF JANA customer assigned
  const totalAssigned = summary.reduce((sum, m) => sum + m.assigned, 0);
  assert.equal(totalAssigned, 1, '1 OFF JANA customer assigned for followup');
  // Should show that R1 recovered
  const totalRecovered = summary.reduce((sum, m) => sum + m.recovered, 0);
  assert.equal(totalRecovered, 1, '1 OFF JANA customer recovered');
  // The team on the row is the credit officer's own branch (call_users.team), not a
  // deck-derived label -- the branches rule, same as the agent scorecard fix.
  assert.equal(summary[0].team, 'KONGOWE');
});

test('recoveryByCredit returns empty metrics if no customers locked 7+ days', async () => {
  const book = tables();
  // Only customers with less than 7 days locked
  book.defaulter_snapshots.push(
    D('R1', 'KONGOWE', 500, 'current', 3, TODAY),
    D('R2', 'KONGOWE', 600, 'current', 5, TODAY),
  );
  book.call_users = [
    { user_id: 'UC1', name: 'CREDIT ONE', team: 'KONGOWE', role: 'CREDIT', is_leader: false,
      phone: '0712000001', registered_at: '2026-08-01T00:00:00Z' },
  ];

  const d = await portalApi(fakeDb(book), ADMIN, 'recoveryByCredit', {}, NOW);

  assert.ok(d.metrics, 'returns metrics array');
  assert.equal(d.metrics.length, 0, 'no metrics since no OFF JANA customers');
});

test('recoveryByCredit scopes results to user\'s teams', async () => {
  const book = tables();
  // KONGOWE has a locked customer
  book.defaulter_snapshots.push(
    D('R1', 'KONGOWE', 500, 'current', 8, TODAY),
  );
  // MBAGALA has a locked customer
  book.defaulter_snapshots.push(
    D('R2', 'MBAGALA', 600, 'current', 9, TODAY),
  );
  // Add previous day data
  book.defaulter_snapshots.push(
    D('R1', 'KONGOWE', 500, 'current', 9, YEST),
    D('R2', 'MBAGALA', 600, 'current', 10, YEST),
  );
  book.call_users = [
    { user_id: 'UC1', name: 'CREDIT ONE', team: 'KONGOWE', role: 'CREDIT', is_leader: false,
      phone: '0712000001', registered_at: '2026-08-01T00:00:00Z' },
    { user_id: 'UC2', name: 'CREDIT TWO', team: 'MBAGALA', role: 'CREDIT', is_leader: false,
      phone: '0712000002', registered_at: '2026-08-01T00:00:00Z' },
  ];

  // GMO can only see KONGOWE
  const d = await portalApi(fakeDb(book), GMO, 'recoveryByCredit', {}, NOW);

  assert.ok(d.metrics, 'returns metrics');
  // Only results from KONGOWE should be present (GMO's team)
  const teams = [...new Set(d.metrics.map(m => m.team))];
  assert.ok(teams.every(t => t === 'KONGOWE'), 'only GMO\'s team in results');
});

test('recoveryByCredit only assigns to CREDIT-role call_users, not bikes/managers/gmos', async () => {
  const book = tables();
  book.defaulter_snapshots.push(
    D('R1', 'KONGOWE', 500, 'current', 5, TODAY),
    D('R1', 'KONGOWE', 500, 'current', 8, YEST),
  );
  book.call_users = [
    // Same team, but not a credit role -- must not receive an assignment.
    { user_id: 'UB1', name: 'BIKE ONE', team: 'KONGOWE', role: 'BIKE', is_leader: false,
      phone: '0712000009', registered_at: '2026-08-01T00:00:00Z' },
    { user_id: 'UC1', name: 'CREDIT ONE', team: 'KONGOWE', role: 'CREDIT ANALYST', is_leader: false,
      phone: '0712000001', registered_at: '2026-08-01T00:00:00Z' },
  ];

  const d = await portalApi(fakeDb(book), ADMIN, 'recoveryByCredit', {}, NOW);

  assert.ok(d.metrics.some(m => m.creditUser === 'CREDIT ONE'), 'the credit officer got the customer');
  assert.ok(!d.metrics.some(m => m.creditUser === 'BIKE ONE'), 'a bike officer never appears on this board');
});

test('recoveryByCredit deals OFF JANA customers fairly across more than one credit officer', async () => {
  const book = tables();
  // Four customers, all locked 7+ yesterday, none recovered today -- deal must split 2/2.
  for (const ref of ['R1', 'R2', 'R3', 'R4']) {
    book.defaulter_snapshots.push(D(ref, 'KONGOWE', 500, 'current', 5, TODAY));
    book.defaulter_snapshots.push(D(ref, 'KONGOWE', 500, 'current', 9, YEST));
  }
  book.call_users = [
    { user_id: 'UC1', name: 'CREDIT ONE', team: 'KONGOWE', role: 'CREDIT', is_leader: false,
      phone: '0712000001', registered_at: '2026-08-01T00:00:00Z' },
    { user_id: 'UC2', name: 'CREDIT TWO', team: 'KONGOWE', role: 'CREDIT', is_leader: false,
      phone: '0712000002', registered_at: '2026-08-01T00:00:00Z' },
  ];

  const d = await portalApi(fakeDb(book), ADMIN, 'recoveryByCredit', {}, NOW);
  const today = d.metrics.filter(m => m.date === TODAY);
  const assigned = today.map(m => m.assigned).sort();
  assert.deepEqual(assigned, [2, 2], 'four OFF JANA customers split evenly across two credit officers');
});

/* =====================================================================================
   THE APPS-PER-WEEKDAY BOARD FILES BY THE DAY THE ADMIN CHOSE.
   =====================================================================================
   "still didnt update: the thing worked to thursday.. the day i started uploading friday
    started taking them"

   It grouped by created_at -- the insert moment -- so it agreed with the admin only while
   each day's file was uploaded on its own day. Friday's file uploaded on Sunday filed its
   apps under Sunday, whatever the date box said.
*/
test('an app counts under its upload stamp, not the moment it was inserted', async () => {
  const book = tables();
  // Uploaded TODAY (Friday the 24th) but stamped for Wednesday -- the date box was obeyed.
  book.loans.push({ id: 'w1', team: 'KONGOWE', stage: 'assigned', requested_amt: 70000,
    full_name: 'WEDNESDAY APP', created_at: TODAY + 'T09:00:00Z', upload_date: '2026-07-22' });
  const db = dbWithRpc(book);
  const d = await portalApi(db, ADMIN, 'dashboardFull', {}, NOW);
  const wed = d.appsTrend.find(x => x.date === '2026-07-22');
  const fri = d.appsTrend.find(x => x.date === TODAY);
  assert.equal(wed.assigned, 1, 'the chosen Wednesday is where it shows');
  assert.equal(fri.assigned, 0, 'and not doubled under the day the button was pressed');
});

test('a row from before the stamp existed still counts, by its created day', async () => {
  const book = tables();
  book.loans.push({ id: 'w2', team: 'KONGOWE', stage: 'unassigned', requested_amt: 30000,
    full_name: 'OLD ROW', created_at: YEST + 'T09:00:00Z' });   // no upload_date at all
  const db = dbWithRpc(book);
  const d = await portalApi(db, ADMIN, 'dashboardFull', {}, NOW);
  const thu = d.appsTrend.find(x => x.date === YEST);
  assert.equal(thu.unassigned, 1, 'nothing already there is lost');
});

test('the portal follow-up list wears PAID on a cleared balance too', async () => {
  const book = tables();
  book.followup_status.push({ ref: 'Z1', team: 'KONGOWE', full_name: 'CLEARED',
    contact: '0714000801', arrears: 0, rejesho: 100, status: '' });
  const d = await portalApi(dbWithRpc(book), ADMIN, 'followup', {}, NOW);
  assert.equal(d.rows.find(r => r.ref === 'Z1').status, 'PAID');
  assert.equal(d.rows.find(r => r.ref === '555').status, 'Defaulter', 'a real debt is untouched');
});

/* =====================================================================================
   TWO DIFFERENT DEPARTMENTS, NEVER ADDED TOGETHER.
   =====================================================================================
   "you mixed callagent customer service department who receive loan requests with credit
    analysts who approve loan sales at dashboard"

   `created_by` names the CUSTOMER CARE agent who RECEIVED the application. `approved_by`
   names the CREDIT ANALYST who APPROVED the sale. The credit board was grouping approved
   loans by created_by, so the customer-care room appeared on the analysts' board.
*/
test('the credit board names the APPROVER, never the customer-care agent', async () => {
  const book = tables();
  book.teams[0] = { ...book.teams[0], credit: 'ANALYST A' };
  book.loans = [{ id: 'x1', team: 'KONGOWE', stage: 'approved', principal_amt: 400000,
    approved_date: TODAY, approved_by: 'CA9', created_by: 'NEEMA CS' }];
  const d = await portalApi(dbWithRpc(book), ADMIN, 'officerBoards', {}, NOW);
  const names = d.creditToday.map(r => r.analyst);
  assert.ok(names.includes('ANALYST A'), 'named from the credit column in Teams & Staff');
  assert.equal(names.includes('NEEMA CS'), false,
    'the customer-care agent must not appear on the analysts\' board');
});

test('an approvals file that names the analyst in words is honoured', async () => {
  const book = tables();
  book.teams[0] = { ...book.teams[0], credit: 'ANALYST A' };
  book.loans = [{ id: 'x1', team: 'KONGOWE', stage: 'approved', principal_amt: 400000,
    approved_date: TODAY, approved_by: 'UNKNOWN-ID', created_by: 'NEEMA CS' }];
  const d = await portalApi(dbWithRpc(book), ADMIN, 'officerBoards', {}, NOW);
  assert.deepEqual(d.creditToday.map(r => r.analyst), ['ANALYST A']);
});

test('an unknown approver ID is NEVER printed -- no IDs anywhere', async () => {
  /* "dont use IDs in the approved report". With no analyst nameable, the row still appears
     (a real sale must not vanish) but reads (unassigned) -- which is the prompt to fill the
     credit officer in on Teams & Staff, not a number nobody can use. */
  const book = tables();
  book.teams[0] = { ...book.teams[0], credit: null };
  book.loans = [{ id: 'x1', team: 'KONGOWE', stage: 'approved', principal_amt: 400000,
    approved_date: TODAY, approved_by: 'CA-777', created_by: 'NEEMA CS' }];
  const d = await portalApi(dbWithRpc(book), ADMIN, 'officerBoards', {}, NOW);
  const names = d.creditToday.map(r => r.analyst);
  assert.deepEqual(names, ['(unassigned)']);
  assert.equal(names.includes('CA-777'), false, 'no ID reaches the screen');
  assert.equal(names.includes('NEEMA CS'), false, 'and never the customer-care agent');
});

test('the customer-care board still names the agent who RECEIVED the application', async () => {
  /* The other half of the separation: created_by belongs here, and only here. */
  const book = tables();
  book.call_agents = [{ user_id: 'NEEMA CS', names: 'NEEMA THE AGENT' }];
  book.loans = [{ id: 'a1', team: 'KONGOWE', stage: 'unassigned', requested_amt: 50000,
    created_by: 'NEEMA CS', track_no: '1', upload_date: TODAY, full_name: 'APPLICANT' }];
  const d = await portalApi(dbWithRpc(book), ADMIN, 'officerBoards', {}, NOW);
  const row = d.csToday.find(r => r.id === 'NEEMA CS');
  assert.ok(row, 'the customer-care agent belongs on the customer-care board');
  assert.equal(row.brought, 1);
});

/* ILIYONASIA -- the manual, signed, attributable adjustment register.
   "on manual adjustment we have to select date and report type on expected ini/curr or def
    in/cur and put positive or negative amount". A signed figure against one report date and
   one of the four books, never anonymous: who and why survive beside the number. Gated on
   its own granted tab (like audit), because writing numbers reports lean on is not a
   default power. */
test('Iliyonasia: the register records signed amounts per book, gated on the adjust tab', async () => {
  const db = fakeDb(tables());
  // No adjust tab and not an admin: the door is shut.
  await assert.rejects(() => portalApi(db, GMO, 'adjustments', {}, NOW), e => e.status === 403);
  await assert.rejects(() => portalApi(db, GMO, 'adjustmentRecord',
    { date: TODAY, target: 'expected-current', amount: 5 }, NOW), e => e.status === 403);

  // The PMO-Data person: an ordinary code with the tab ticked.
  const DATA = { code: 'PD', name: 'PMO DATA', role: 'GMO', teams: null, tabs: ['adjust'] };

  // The three refusals that keep the register honest: no amount, no such book, no date.
  await assert.rejects(() => portalApi(db, DATA, 'adjustmentRecord',
    { date: TODAY, target: 'expected-initial', amount: 0 }, NOW), /non-zero/i);
  await assert.rejects(() => portalApi(db, DATA, 'adjustmentRecord',
    { date: TODAY, target: 'expected-today', amount: 100 }, NOW), /target/i);
  await assert.rejects(() => portalApi(db, DATA, 'adjustmentRecord',
    { target: 'expected-initial', amount: 100 }, NOW), /date|tarehe/i);

  await portalApi(db, DATA, 'adjustmentRecord',
    { date: TODAY, target: 'expected-current', team: 'kongowe', amount: 250000, reason: 'muamala ulionasa' }, NOW);
  await portalApi(db, DATA, 'adjustmentRecord',
    { date: TODAY, target: 'expected-current', amount: -50000 }, NOW);
  await portalApi(db, DATA, 'adjustmentRecord',
    { date: TODAY, target: 'defaulter-current', amount: -100000, ref: '5215609147' }, NOW);

  const d = await portalApi(db, ADMIN, 'adjustments', {}, NOW);   // admins hold the tab from the start
  assert.equal(d.ready, true);
  assert.equal(d.rows.length, 3);
  assert.equal(d.totals['expected-current'], 200000, 'signed amounts net out per book');
  assert.equal(d.totals['defaulter-current'], -100000);
  assert.equal(d.net, 100000);
  const first = d.rows.find(r => Number(r.amount) === 250000);
  assert.equal(first.created_by, 'PMO DATA', 'never anonymous');
  assert.equal(first.team, 'KONGOWE', 'team is normalised like everywhere else');

  // Deleting stays available -- and the row is gone from the totals with it.
  const gone = d.rows.find(r => Number(r.amount) === -50000);
  await portalApi(db, DATA, 'adjustmentDelete', { id: gone.id }, NOW);
  const after = await portalApi(db, DATA, 'adjustments', {}, NOW);
  assert.equal(after.rows.length, 2);
  assert.equal(after.totals['expected-current'], 250000);

  /* "some issues are sorted midday": the AMOUNT of a recorded adjustment can be re-typed.
     Everything else stands -- date, book, team, reason -- and the row is re-signed by
     whoever last decided the number, so the register stays attributable. */
  const kept = after.rows.find(r => Number(r.amount) === 250000);
  await assert.rejects(() => portalApi(db, GMO, 'adjustmentAmend',
    { id: kept.id, amount: 5 }, NOW), e => e.status === 403, 'same gate as recording');
  await assert.rejects(() => portalApi(db, DATA, 'adjustmentAmend',
    { id: kept.id, amount: 0 }, NOW), /non-zero/i);
  await assert.rejects(() => portalApi(db, DATA, 'adjustmentAmend',
    { id: 'no-such-row', amount: 5 }, NOW), /halipo|exists/i);
  const amended = await portalApi(db, DATA, 'adjustmentAmend', { id: kept.id, amount: 300000 }, NOW);
  assert.equal(amended.previousAmount, 250000, 'the old figure is echoed back');
  const final = await portalApi(db, ADMIN, 'adjustments', {}, NOW);
  assert.equal(final.totals['expected-current'], 300000, 'the register carries the new amount');
  const row = final.rows.find(r => r.id === kept.id);
  assert.equal(row.target, 'expected-current', 'the book stands');
  assert.equal(row.team, 'KONGOWE', 'the team stands');
  assert.equal(row.adj_date, TODAY, 'the report date stands');
  assert.equal(row.created_by, 'PMO DATA', 're-signed by the person who last decided it');
});

/* THE TUNDURU BLACKOUT. JavaScript compares team names through K() -- trim + uppercase -- so
   'Tunduru' and 'TUNDURU' were always one team on the server. Postgres compares EXACTLY, and
   every database filter uppercased the officer's team list first. So an officer scoped to the
   one mixed-case team in the company asked every table for TUNDURU, their rows sat there as
   Tunduru, and they signed in to NOTHING: empty lists, an empty dashboard, no error anywhere.
   teamMatchList sends both spellings, which is exact-case-invisible for every other team and
   the difference between a book and a blank page for this one. */
test('an officer on a mixed-case team sees their rows under either spelling', async () => {
  const t = tables();
  t.teams.push({ team: 'Tunduru', team_code: 'DH6E47' });
  t.followup_status.push(
    { ref: 'TN1', team: 'Tunduru', full_name: 'MTEJA WA TUNDURU', contact: '0710000001', arrears: 5000, status: 'Defaulter', fu_status: '', ds: '3-6', days_elapsed: 9 },
    { ref: 'TN2', team: 'TUNDURU', full_name: 'MTEJA WA PILI', contact: '0710000002', arrears: 3000, status: 'Defaulter', fu_status: '', ds: '3-6', days_elapsed: 9 },
  );
  t.repayment_snapshots.push(
    { ref: 'TN1', team: 'Tunduru', full_name: 'MTEJA WA TUNDURU', payment_expected: 1000, todays_status: 'UNPAID',
      arrears: 0, snapshot_type: 'today', snapshot_date: TODAY, upload_batch: 'tb', created_at: TODAY + 'T04:00:00Z' },
  );
  const OFF = { code: 'T', name: 'AFISA', role: 'GMO', teams: ['Tunduru'], tabs: USER_TABS.slice() };

  const fu = await portalApi(fakeDb(t), OFF, 'followup', {}, NOW);
  assert.equal(fu.rows.length, 2, 'both spellings of their own team, nothing hidden');
  assert.ok(fu.rows.some(r => r.ref === 'TN1') && fu.rows.some(r => r.ref === 'TN2'));

  const exp = await portalApi(fakeDb(t), OFF, 'expectedDay', {}, NOW);
  assert.equal(exp.rows.length, 1, 'the Expected list reaches the mixed-case rows too');
  assert.equal(exp.rows[0].ref, 'TN1');

  // And they still see nothing of anybody else's book -- both spellings widen the match to
  // THEIR OWN team only, never sideways.
  assert.ok(fu.rows.every(r => ['Tunduru', 'TUNDURU'].includes(r.team)));
});
