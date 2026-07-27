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
      { team: 'KONGOWE', opm: null, recovery: 'ASHA JUMA', gmo: null, manager: 'BOB M', credit: null, expected: null, bike: null, team_code: 'KON123' },
      { team: 'MBAGALA', opm: null, recovery: null, gmo: null, manager: null, credit: null, expected: null, bike: null, team_code: 'MBA456' },
    ],
    access_codes: [
      { code: 'LEAD1', name: 'ASHA JUMA', role: 'MANAGEMENT', teams: ['KONGOWE'], tabs: [] },
      { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] },   // ALL teams
    ],
    settings: [{ key: 'SALES_TARGET_MONTHLY', value: '4000000' }],
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

// An officer signs in with their TEAM'S code. The code decides which team they get -- it is
// not a team picker -- and their phone still decides who they are.
const ADMIN_U = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] };
async function registeredDb() {
  const db = fakeDb(makeTables());
  await callApi(db, 'api_callRegister', ['d1', 'JUMA ISSA', '', '', '0712999999', 'KON123'], NOW);
  await callApi(db, 'api_callRegister', ['d2', '', '', 'LEAD1', '0788111222'], NOW);
  return db;
}

test('boot on an unknown device gives branding only, never the team list', async () => {
  const db = fakeDb(makeTables());
  const d = await callApi(db, 'api_callBoot', ['dev-x'], NOW);
  assert.equal(d.ok, false);
  assert.equal(d.error, 'DEVICE_NOT_REGISTERED');
  // Publishing every team name to an unauthenticated handset was half of what made
  // self-registration work: pick a team off the list, get handed its book.
  assert.deepEqual(d.teams, []);
  assert.ok(d.brand, 'branding still loads so the sign-in screen is recognisable');
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

test('an officer cannot register without their team code', async () => {
  const db = fakeDb(makeTables());
  // This is what the APK used to allow: a name, any team off the public list, and a phone.
  // It handed over that team's whole portfolio -- names, numbers, arrears, guarantors.
  await assert.rejects(() => callApi(db, 'api_callRegister', ['d9', 'X', 'KONGOWE', '', '0711111111'], NOW),
    /team code/i);
  await assert.rejects(() => callApi(db, 'api_callRegister', ['d9', 'X', '', '', '0711111111', 'WRONG9'], NOW),
    /not correct/i);
  // A name is still required -- the code says which team, the person says who they are.
  await assert.rejects(() => callApi(db, 'api_callRegister', ['d9', '', '', '', '0711111111', 'KON123'], NOW),
    /jina|name/i);
});

test('the team code decides the team -- a typed team name cannot override it', async () => {
  const db = fakeDb(makeTables());
  // Claiming MBAGALA while holding KONGOWE's code must land on KONGOWE, not MBAGALA.
  await callApi(db, 'api_callRegister', ['dx', 'SNEAKY', 'MBAGALA', '', '0700000123', 'KON123'], NOW);
  const row = db._dump('call_users').find(u => u.name === 'SNEAKY');
  assert.equal(row.team, 'KONGOWE');
  // Codes are matched loosely on case and punctuation -- they get read aloud over a phone.
  await callApi(db, 'api_callRegister', ['dy', 'CASE TEST', '', '', '0700000124', ' kon-123 '], NOW);
  assert.equal(db._dump('call_users').find(u => u.name === 'CASE TEST').team, 'KONGOWE');
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



test('same phone on a new device keeps ONE identity and releases the old device', async () => {
  const db = await registeredDb();
  const r1 = await callApi(db, 'api_callBoot', ['d1'], NOW);
  await callApi(db, 'api_callRegister', ['d3', 'JUMA ISSA', '', '', '0712999999', 'KON123'], NOW);
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

test('the called-today tick needs a real conversation, not a dial attempt', async () => {
  const db = await registeredDb();
  // 111 rang out (2s); 222 was actually spoken to (30s).
  await callApi(db, 'api_callSync', ['d1', [
    { ts: T1, dur: 2, dir: 'out', num: '0712000001' },
    { ts: T1, dur: 30, dir: 'out', num: '0712000002' },
  ]], NOW);
  const d = await callApi(db, 'api_callList', ['d1', 'today'], NOW);
  assert.equal(d.rows.find(r => r.ref === '111').called, false);   // 2s -- nobody was spoken to
  assert.equal(d.rows.find(r => r.ref === '222').called, true);

  // Direction does not matter: the customer ringing back and talking counts the same.
  await callApi(db, 'api_callSync', ['d1', [{ ts: T1 + 1000, dur: 40, dir: 'in', num: '0712000001' }]], NOW);
  assert.equal((await callApi(db, 'api_callList', ['d1', 'today'], NOW)).rows.find(r => r.ref === '111').called, true);

  // Exactly at the threshold is still a dial attempt; a second past it is a call.
  const db2 = await registeredDb();
  await callApi(db2, 'api_callSync', ['d1', [{ ts: T1, dur: 5, dir: 'out', num: '0712000001' }]], NOW);
  assert.equal((await callApi(db2, 'api_callList', ['d1', 'today'], NOW)).rows.find(r => r.ref === '111').called, false);
  await callApi(db2, 'api_callSync', ['d1', [{ ts: T1 + 1000, dur: 6, dir: 'out', num: '0712000001' }]], NOW);
  assert.equal((await callApi(db2, 'api_callList', ['d1', 'today'], NOW)).rows.find(r => r.ref === '111').called, true);

  // The threshold is tunable without a deploy.
  const db3 = await registeredDb();
  db3._dump('settings').push({ key: 'CALL_MIN_SECS', value: '20' });
  await callApi(db3, 'api_callSync', ['d1', [{ ts: T1, dur: 12, dir: 'out', num: '0712000001' }]], NOW);
  assert.equal((await callApi(db3, 'api_callList', ['d1', 'today'], NOW)).rows.find(r => r.ref === '111').called, false);
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
  assert.ok(Math.abs(d.sales.pct - 200000 / 4000000) < 1e-9);   // month-to-date vs the MONTHLY target x 1 team
  assert.equal(d.sales.basis, 'month');
  // Col wiki: Thursday's 400 expected + Friday's 1500, none of Thursday's collected, 500 of Friday's.
  assert.equal(d.weekCol.den, 1900);
  assert.equal(d.weekCol.num, 500);
});

test('sales is month-to-date on the WEEKEND too, and defaults to 100m a team', async () => {
  const db = fakeDb(makeTables());
  db._dump('settings').length = 0;                              // no target configured -- the default stands
  await callApi(db, 'api_callRegister', ['d1', 'JUMA ISSA', '', '', '0712999999', 'KON123'], NOW);
  const sat = Date.parse('2026-07-25T09:00:00Z');               // Saturday
  const d = await callApi(db, 'api_callDailySummary', ['d1'], sat);
  assert.equal(d.sales.basis, 'month');
  assert.equal(d.sales.num, 200000);                            // still the month, not the week
  assert.equal(d.sales.den, 100000000);                         // 5m x 5 days x 4 weeks, one team
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





test('rotating a team code cuts the handsets that had the old one', async () => {
  const db = await registeredDb();
  const { portalApi } = await import('../api/_lib/portal-core.js');
  assert.equal((await callApi(db, 'api_callBoot', ['d1'], NOW)).ok, true);

  // "Someone left -- change the code" has to actually lock them out, or nothing changed for
  // whoever is holding that handset.
  const r = await portalApi(db, ADMIN_U, 'saveTeam', { team: 'KONGOWE', teamCode: 'NEW777' }, NOW);
  assert.equal(r.rotated, true);
  assert.equal(r.released, 1);

  const after = await callApi(db, 'api_callBoot', ['d1'], NOW);
  assert.equal(after.ok, false);
  assert.equal(after.error, 'DEVICE_NOT_REGISTERED');
  await assert.rejects(() => callApi(db, 'api_callRegister', ['d1', 'JUMA ISSA', '', '', '0712999999', 'KON123'], NOW),
    /not correct/i);
  assert.equal((await callApi(db, 'api_callRegister', ['d1', 'JUMA ISSA', '', '', '0712999999', 'NEW777'], NOW)).ok, true);

  // The leader signed in with a portal access code, not the team code -- rotating must not
  // knock them out alongside the field officers.
  assert.equal((await callApi(db, 'api_callBoot', ['d2'], NOW)).ok, true);
});

test('one officer can be cut without changing the whole team code', async () => {
  const db = await registeredDb();
  const { portalApi } = await import('../api/_lib/portal-core.js');
  await portalApi(db, ADMIN_U, 'saveOfficerAccount',
    { name: 'JUMA ISSA', team: 'KONGOWE', phone: '0712999999', active: false }, NOW);

  assert.equal((await callApi(db, 'api_callBoot', ['d1'], NOW)).ok, false);
  // And the still-valid team code does not let them back in.
  await assert.rejects(() => callApi(db, 'api_callRegister', ['d1', 'JUMA ISSA', '', '', '0712999999', 'KON123'], NOW),
    /switched off/i);
  // A colleague on the same team is unaffected -- that is the point of cutting one person.
  assert.equal((await callApi(db, 'api_callRegister', ['dq', 'OTHER OFFICER', '', '', '0712888888', 'KON123'], NOW)).ok, true);
});

test('team codes must be unique and long enough to not be guessed', async () => {
  const db = await registeredDb();
  const { portalApi } = await import('../api/_lib/portal-core.js');
  // Two teams on one code would silently put officers on the wrong book.
  await assert.rejects(() => portalApi(db, ADMIN_U, 'saveTeam', { team: 'MBAGALA', teamCode: 'KON123' }, NOW),
    e => e.status === 400 && /already used by team KONGOWE/.test(e.message));
  await assert.rejects(() => portalApi(db, ADMIN_U, 'saveTeam', { team: 'MBAGALA', teamCode: 'AB' }, NOW),
    e => e.status === 400 && /at least 4/.test(e.message));
  // Generating one gives a code that actually works on the phone.
  const g = await portalApi(db, ADMIN_U, 'saveTeam', { team: 'MBAGALA', generateCode: true }, NOW);
  assert.ok(g.teamCode && g.teamCode.length >= 6);
  assert.equal((await callApi(db, 'api_callRegister', ['dm', 'MB OFFICER', '', '', '0799000111', g.teamCode], NOW)).ok, true);
  assert.equal(db._dump('call_users').find(u => u.name === 'MB OFFICER').team, 'MBAGALA');
});

test('KESHO is derived from the date, never a second upload of the same file', async () => {
  const t = makeTables();
  const E = (ref, date) => ({ ref, full_name: 'C' + ref, contact: '07120000' + ref, team: 'KONGOWE',
    payment_expected: 500, arrears: 0, todays_status: 'UNPAID', due_summary: '2/6',
    snapshot_type: 'today', snapshot_date: date, upload_batch: 'b' + date, created_at: date + 'T04:00:00Z' });
  // The PMO uploads each day's sheet under its own date -- exactly as the live system worked.
  t.repayment_snapshots = [E('MON1', '2026-07-27'), E('TUE1', '2026-07-28'), E('MON2', '2026-08-03')];
  const db = fakeDb(t);
  await callApi(db, 'api_callRegister', ['d1', 'JUMA ISSA', '', '', '0712999999', 'KON123'], NOW);

  // Monday 2026-07-27 -> kesho is Tuesday's sheet.
  const mon = Date.parse('2026-07-27T09:00:00Z');
  assert.deepEqual((await callApi(db, 'api_callList', ['d1', 'tomorrow'], mon)).rows.map(r => r.ref), ['TUE1']);
  assert.deepEqual((await callApi(db, 'api_callList', ['d1', 'today'], mon)).rows.map(r => r.ref), ['MON1']);

  // There are no weekend sheets, so Friday's "tomorrow" is MONDAY -- and so is the weekend's.
  const fri = Date.parse('2026-07-31T09:00:00Z');
  assert.deepEqual((await callApi(db, 'api_callList', ['d1', 'tomorrow'], fri)).rows.map(r => r.ref), ['MON2']);
  const sun = Date.parse('2026-08-02T09:00:00Z');
  assert.deepEqual((await callApi(db, 'api_callList', ['d1', 'tomorrow'], sun)).rows.map(r => r.ref), ['MON2']);

  // The bar's Kesho % reads the SAME sheet the Kesho tab does -- Monday's bar is Tuesday's list.
  const s = await callApi(db, 'api_callDailySummary', ['d1'], mon);
  assert.equal(s.kesho.den, 500);
  assert.equal(s.kesho.customers, 1);
  assert.equal(s.kesho.pct, 0);           // TUE1 is UNPAID -- nothing collected early yet
});

// The launcher, the dashboard sign-in and the upload page all show the company before anyone
// has identified themselves. They read the brand from here rather than hard-coding it, so this
// endpoint must answer with no device and no code at all.
test('the brand endpoint is public, and one setting feeds every surface', async () => {
  const t = makeTables();
  const bare = await callApi(fakeDb(t), 'api_brand', [], NOW);
  assert.equal(bare.brand, 'HOPE MICROCREDIT CO. LTD');   // the built-in default
  assert.equal(bare.logo, '');                            // nothing uploaded -> the drawn mark stands

  t.settings.push({ key: 'CALL_BRAND', value: 'HOPE MICRO CREDIT' },
    { key: 'CALL_LOGO_URL', value: 'data:image/png;base64,AAAA' });
  const set = await callApi(fakeDb(t), 'api_brand', [], NOW);
  assert.equal(set.brand, 'HOPE MICRO CREDIT');
  assert.equal(set.logo, 'data:image/png;base64,AAAA');
});
