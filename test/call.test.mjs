// The HOPE Calls backend, end to end against the mutation-capable fake PostgREST:
// register (officer + leader + phone-keyed re-register), scoped lists with called-today
// flags, sync with primary-key dedup and portfolio matching, the daily-summary strip
// (which must agree with buildDashboard by construction), comments, and leader reports.
// Clock pinned to Friday 2026-07-24 noon EAT unless a test says otherwise.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { callApi, pnorm, dsFmt } = await import('../api/_lib/call-core.js');

const NOW = Date.parse('2026-07-24T09:00:00Z');   // Friday noon EAT
const T1 = Date.parse('2026-07-24T05:00:00Z');    // this morning EAT -- calls synced below

function makeTables() {
  return {
    teams: [
      { team: 'KONGOWE', opm: null, recovery: 'ASHA JUMA', gmo: null, manager: 'BOB M', credit: null, expected: null, bike: null },
      { team: 'MBAGALA', opm: null, recovery: null, gmo: null, manager: null, credit: null, expected: null, bike: null },
    ],
    access_codes: [
      { code: 'LEAD1', name: 'ASHA JUMA', role: 'MANAGEMENT', teams: ['KONGOWE'], tabs: [] },
      { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] },   // ALL teams
    ],
    settings: [{ key: 'SALES_TARGET_WEEKLY', value: '1000000' }],
    repayment_snapshots: [
      { ref: '111', full_name: 'AMINA H', contact: '0712000001', guarantor_name: 'G ONE', guarantor_contact: '0713000001', team: 'KONGOWE', payment_expected: 1000, arrears: 0, todays_status: 'UNPAID', due_summary: '2/6', snapshot_type: 'today', snapshot_date: '2026-07-24', upload_batch: 'b1', created_at: '2026-07-24T04:00:00Z' },
      { ref: '222', full_name: 'PILI S', contact: '0712000002', guarantor_name: '', guarantor_contact: '', team: 'KONGOWE', payment_expected: 500, arrears: 0, todays_status: 'PAID', due_summary: '3/6', snapshot_type: 'today', snapshot_date: '2026-07-24', upload_batch: 'b1', created_at: '2026-07-24T04:00:00Z' },
      { ref: '333', full_name: 'OTHER TEAM', contact: '0712000003', guarantor_name: '', guarantor_contact: '', team: 'MBAGALA', payment_expected: 800, arrears: 0, todays_status: 'UNPAID', due_summary: '', snapshot_type: 'today', snapshot_date: '2026-07-24', upload_batch: 'b1', created_at: '2026-07-24T04:00:00Z' },
      { ref: '444', full_name: 'KESHO K', contact: '0712000004', guarantor_name: '', guarantor_contact: '', team: 'KONGOWE', payment_expected: 700, arrears: 0, todays_status: '', due_summary: '', snapshot_type: 'tomorrow', snapshot_date: '2026-07-24', upload_batch: 'b2', created_at: '2026-07-24T04:00:00Z' },
      // Thursday's today-snapshot: Friday's recovery denominator (yesterday basis)
      { ref: '111', full_name: 'AMINA H', contact: '0712000001', guarantor_name: '', guarantor_contact: '', team: 'KONGOWE', payment_expected: 400, arrears: 0, todays_status: 'UNPAID', due_summary: '', snapshot_type: 'today', snapshot_date: '2026-07-23', upload_batch: 'b0', created_at: '2026-07-23T04:00:00Z' },
    ],
    defaulter_snapshots: [
      { ref: '555', team: 'KONGOWE', arrears: 500, snapshot_type: 'initial', weekday: 'FRI', snapshot_date: '2026-07-24', upload_batch: 'bi', created_at: '2026-07-24T04:00:00Z' },
      { ref: '555', team: 'KONGOWE', arrears: 350, snapshot_type: 'current', weekday: 'FRI', snapshot_date: '2026-07-24', upload_batch: 'bc', created_at: '2026-07-24T04:00:00Z' },
    ],
    followup_status: [
      { ref: '555', team: 'KONGOWE', full_name: 'DEF GUY', contact: '0714000001', guarantor_name: 'G DEF', guarantor_contact: '0715000001', arrears: 900, rejesho: 100, status: 'Defaulter', fu_status: '', ds: '3-6', days_elapsed: 12 },
    ],
    followup_comments: [],
    loans: [
      { team: 'KONGOWE', principal_amt: 200000, loan_amt: null, approved_date: '2026-07-10', stage: 'approved' },
      { team: 'KONGOWE', principal_amt: 999999, loan_amt: null, approved_date: '2026-06-10', stage: 'approved' },   // last month -- out of the month-to-date window
    ],
    call_users: [],
    call_logs: [],
    received_payments: [],
  };
}

async function registeredDb() {
  const db = fakeDb(makeTables());
  await callApi(db, 'api_callRegister', ['d1', 'JUMA ISSA', 'KONGOWE', '', '0712999999'], NOW);
  await callApi(db, 'api_callRegister', ['d2', '', '', 'LEAD1', '0788111222'], NOW);
  return db;
}

test('boot before registration returns the team list for the register screen', async () => {
  const db = fakeDb(makeTables());
  const d = await callApi(db, 'api_callBoot', ['dev-x'], NOW);
  assert.equal(d.ok, false);
  assert.equal(d.error, 'DEVICE_NOT_REGISTERED');
  assert.deepEqual(d.teams, ['KONGOWE', 'MBAGALA']);
});

test('officer registration: boot resolves the device to the user', async () => {
  const db = await registeredDb();
  const d = await callApi(db, 'api_callBoot', ['d1'], NOW);
  assert.equal(d.ok, true);
  assert.equal(d.name, 'JUMA ISSA');
  assert.equal(d.team, 'KONGOWE');
  assert.equal(d.leader, false);
  assert.equal(d.watermark, 0);
  assert.deepEqual(d.today, { calls: 0, duration: 0, portfolio: 0 });
});

test('officer registration rejects a team that is not on file', async () => {
  const db = fakeDb(makeTables());
  await assert.rejects(() => callApi(db, 'api_callRegister', ['d9', 'X', 'NOSUCH', '', '0711111111'], NOW), /Unknown team/);
});

test('leader registration pulls name and scope from the access code', async () => {
  const db = await registeredDb();
  const d = await callApi(db, 'api_callBoot', ['d2'], NOW);
  assert.equal(d.ok, true);
  assert.equal(d.name, 'ASHA JUMA');            // from the code, never typed
  assert.equal(d.leader, true);
  assert.equal(d.leaderTeams, 'KONGOWE');
});

test('ALL-teams admin registers: home team is NULL, not the literal "ALL"', async () => {
  // call_users.team is a FK into teams; writing 'ALL' there used to violate the constraint
  // and blocked admin registration outright ("violates foreign key constraint").
  const db = fakeDb(makeTables());
  const r = await callApi(db, 'api_callRegister', ['dA', '', '', 'ADMIN1', '0755000111'], NOW);
  assert.equal(r.ok, true);
  assert.equal(r.leaderTeams, 'ALL');
  const row = db._dump('call_users').find(u => u.user_id === r.userId);
  assert.equal(row.team, null);                  // no home team -- never a fake one
  assert.equal(row.leader_teams, null);          // null scope = every team
  const b = await callApi(db, 'api_callBoot', ['dA'], NOW);
  assert.equal(b.ok, true);
  assert.equal(b.name, 'THE ADMIN');
  assert.equal(b.leaderTeams, 'ALL');
});

test('an ALL-teams admin sees every team in the lists', async () => {
  const db = fakeDb(makeTables());
  await callApi(db, 'api_callRegister', ['dA', '', '', 'ADMIN1', '0755000111'], NOW);
  const d = await callApi(db, 'api_callList', ['dA', 'today'], NOW);
  assert.deepEqual(d.rows.map(r => r.ref).sort(), ['111', '222', '333']);   // MBAGALA included
});

test('team names register in their canonical spelling (FK-safe)', async () => {
  const db = fakeDb(makeTables());
  await callApi(db, 'api_callRegister', ['dc', 'CASE TEST', ' kongowe ', '', '0766000111'], NOW);
  const row = db._dump('call_users').find(u => u.name === 'CASE TEST');
  assert.equal(row.team, 'KONGOWE');
});

test('same phone on a new device keeps ONE identity and releases the old device', async () => {
  const db = await registeredDb();
  const r1 = await callApi(db, 'api_callBoot', ['d1'], NOW);
  await callApi(db, 'api_callRegister', ['d3', 'JUMA ISSA', 'KONGOWE', '', '0712999999'], NOW);
  const r3 = await callApi(db, 'api_callBoot', ['d3'], NOW);
  assert.equal(r3.userId, r1.userId);            // phone-keyed identity survived the device swap
  const old = await callApi(db, 'api_callBoot', ['d1'], NOW);
  assert.equal(old.ok, false);                   // old device released -- one device, one identity
});

test('list today: team-scoped, unpaid first, batch-resolved', async () => {
  const db = await registeredDb();
  const d = await callApi(db, 'api_callList', ['d1', 'today'], NOW);
  assert.deepEqual(d.rows.map(r => r.ref), ['111', '222']);   // MBAGALA row excluded; UNPAID before PAID
  assert.equal(d.rows[0].installment, 1000);                  // payment_expected feeds Rejesho on expected lists
  assert.equal(d.rows[0].ds, '2/6');
});

test('list defaulters: from followup, sorted by arrears, D.S text intact', async () => {
  const db = await registeredDb();
  const d = await callApi(db, 'api_callList', ['d1', 'defaulters'], NOW);
  assert.equal(d.rows.length, 1);
  assert.equal(d.rows[0].ref, '555');
  assert.equal(d.rows[0].amt, 900);
  assert.equal(d.rows[0].installment, 100);
  assert.equal(d.rows[0].ds, '3-6');
});

test('sync: portfolio matching + in-batch dedup + watermark', async () => {
  const db = await registeredDb();
  const calls = [
    { ts: T1, dur: 60, dir: 'out', num: '0712000001' },                        // customer on today's expected
    { ts: T1 + 60000, dur: 30, dir: 'in', num: '+255715000001' },              // guarantor of the defaulter
    { ts: T1 + 120000, dur: 5, dir: 'out', num: '0799999999', outcome: 'MISSED' },   // outside the portfolio
    { ts: T1, dur: 60, dir: 'out', num: '0712000001' },                        // exact duplicate in the same batch
  ];
  const r = await callApi(db, 'api_callSync', ['d1', calls], NOW);
  assert.equal(r.added, 3);
  assert.equal(r.dup, 1);
  assert.equal(r.portfolio, 2);
  assert.equal(r.nonPortfolio, 1);
  assert.equal(r.watermark, T1 + 120000);
  const logs = db._dump('call_logs');
  const cust = logs.find(l => l.phone === pnorm('0712000001'));
  assert.equal(cust.match_type, 'CUSTOMER');
  assert.equal(cust.ref, '111');
  assert.equal(cust.category, 'EXPECTED');
  assert.equal(cust.call_date, '2026-07-24');
  const guar = logs.find(l => l.phone === pnorm('0715000001'));
  assert.equal(guar.match_type, 'GUARANTOR');
  assert.equal(guar.ref, '555');
  assert.equal(guar.category, 'DEFAULTER');
  // Re-sending the same window is the DESIGN (no fragile watermark cutoffs) -- all dups, no growth.
  const r2 = await callApi(db, 'api_callSync', ['d1', calls], NOW);
  assert.equal(r2.added, 0);
  assert.equal(r2.dup, 4);
  assert.equal(db._dump('call_logs').length, 3);
});

test('after a sync, the called-today tick shows on the list', async () => {
  const db = await registeredDb();
  await callApi(db, 'api_callSync', ['d1', [{ ts: T1, dur: 60, dir: 'out', num: '0712000001' }]], NOW);
  const d = await callApi(db, 'api_callList', ['d1', 'today'], NOW);
  assert.equal(d.rows.find(r => r.ref === '111').called, true);
  assert.equal(d.rows.find(r => r.ref === '222').called, false);
});

test('daily summary strip reconciles with the dashboard rule (Friday = yesterday basis)', async () => {
  const db = await registeredDb();
  const d = await callApi(db, 'api_callDailySummary', ['d1'], NOW);
  assert.equal(d.ok, true);
  assert.equal(d.period, 'day');
  assert.ok(Math.abs(d.col.pct - 500 / 1500) < 1e-9);          // KONGOWE today: PAID 500 of 1500 expected
  assert.equal(d.recovery.den, 400);                            // THURSDAY's uncollected -- the basis rule
  assert.equal(d.recovery.num, 150);                            // FRI deck: initial 500 - current 350
  assert.equal(d.recovery.basis, 'yesterday');
  assert.ok(Math.abs(d.recovery.pct - 0.375) < 1e-9);
  assert.ok(Math.abs(d.sales.pct - 200000 / 4000000) < 1e-9);   // month-to-date vs monthly target (weekly x 4) x 1 team
});

test('follow-up: validations enforced; expected customers get a followup stub for the FK', async () => {
  const db = await registeredDb();
  await assert.rejects(() => callApi(db, 'api_callAddComment', ['d1', { ref: '111', fu: 'AMETOA AHADI' }], NOW), /promise date/i);
  const r = await callApi(db, 'api_callAddComment', ['d1', { ref: '111', team: 'KONGOWE', name: 'AMINA H', fu: 'ANALIPA LEO', comment: 'atalipa mchana' }], NOW);
  assert.equal(r.ok, true);
  assert.ok(db._dump('followup_status').some(s => s.ref === '111'));   // stub created -- ref 111 wasn't a defaulter
  const c = await callApi(db, 'api_callComments', ['d1', '111'], NOW);
  assert.equal(c.items.length, 1);
  assert.equal(c.items[0].by, 'JUMA ISSA');
  assert.equal(c.items[0].fu, 'ANALIPA LEO');
});

test('reports are leader-only and live-scoped off the teams role columns', async () => {
  const db = await registeredDb();
  await callApi(db, 'api_callSync', ['d1', [
    { ts: T1, dur: 60, dir: 'out', num: '0712000001' },
    { ts: T1 + 60000, dur: 30, dir: 'in', num: '0715000001' },
    { ts: T1 + 120000, dur: 5, dir: 'out', num: '0799999999', outcome: 'MISSED' },
  ]], NOW);
  await assert.rejects(() => callApi(db, 'api_callReport', ['d1', '2026-07-24', '2026-07-24'], NOW), /Leader access only/);
  const d = await callApi(db, 'api_callReport', ['d2', '2026-07-24', '2026-07-24'], NOW);
  assert.equal(d.ok, true);
  assert.deepEqual(d.debugScope, ['KONGOWE']);                 // resolved LIVE from teams.recovery = ASHA JUMA
  assert.equal(d.totals.calls, 3);
  assert.equal(d.totals.portfolio, 2);
  const u = d.users.find(x => x.name === 'JUMA ISSA');
  assert.equal(u.calls, 3);
  assert.equal(u.expected, 1);
  assert.equal(u.defaulter, 1);
  assert.equal(u.position, 'Officer');
  assert.deepEqual(d.byCategory.map(c => c.category), ['EXPECTED', 'DEFAULTER', 'OTHER']);
});

test('dsFmt: coerced M/d/yyyy dates render back as paid/target; real text passes through', () => {
  assert.equal(dsFmt('3/6/2026'), '3/6');
  assert.equal(dsFmt('11-12-2025'), '11/12');
  assert.equal(dsFmt('7-12'), '7-12');
  assert.equal(dsFmt(''), '');
});
