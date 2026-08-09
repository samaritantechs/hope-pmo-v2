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
    /* HOPE Live is a system-side screen, so it opens and closes with the system. These
       fixtures describe a normal, open deployment; the closed case has its own test below. */
    settings: [{ key: 'SALES_TARGET_MONTHLY', value: '4000000' }, { key: 'SYSTEM_OPEN', value: 'YES' }],
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
  /* The summary/widget cache is MODULE-level -- one cache for the whole process, which is right
     in production (two hundred handsets asking for the same six figures) and wrong between
     tests: it is keyed on the device, and every fixture here uses the same device names. A test
     that built a fresh database could therefore be served an answer computed from a PREVIOUS
     test's book, and pass or fail on that. */
  const { _clearWidgetCache } = await import('../api/_lib/call-core.js');
  _clearWidgetCache();
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

test('Ripoti team dropdown: the list is what you may see, and picking one narrows the report', async () => {
  const db = await registeredDb();
  await callApi(db, 'api_callRegister', ['d3', '', '', 'ADMIN1', '0788333444'], NOW);
  await callApi(db, 'api_callSync', ['d1', [{ ts: T1, dur: 60, dir: 'out', num: '0712000001' }]], NOW);

  // A leader tied to one team is offered only that team...
  const one = await callApi(db, 'api_callReport', ['d2', '2026-07-24', '2026-07-24'], NOW);
  assert.deepEqual(one.teamChoices, ['KONGOWE']);
  assert.equal(one.team, '');

  // ...and naming a team they do not lead changes nothing -- the dropdown is not a back door.
  const sneak = await callApi(db, 'api_callReport', ['d2', '2026-07-24', '2026-07-24', 'MBAGALA'], NOW);
  assert.equal(sneak.team, '');
  assert.deepEqual(sneak.debugScope, ['KONGOWE']);
  assert.equal(sneak.totals.calls, one.totals.calls);

  // Someone who sees everything is offered every team on the books, quiet ones included.
  const all = await callApi(db, 'api_callReport', ['d3', '2026-07-24', '2026-07-24'], NOW);
  assert.deepEqual(all.teamChoices, ['KONGOWE', 'MBAGALA']);
  assert.equal(all.debugScope, 'ALL');
  assert.equal(all.totals.calls, 1);

  // Picking one keeps only that team's calls. MBAGALA made none, so the report is empty --
  // it must not fall back to showing everybody.
  const mb = await callApi(db, 'api_callReport', ['d3', '2026-07-24', '2026-07-24', 'MBAGALA'], NOW);
  assert.equal(mb.team, 'MBAGALA');
  assert.deepEqual(mb.debugScope, ['MBAGALA']);
  assert.equal(mb.totals.calls, 0);

  // Spelling and spacing are not a trap: ' kongowe ' is KONGOWE.
  const kg = await callApi(db, 'api_callReport', ['d3', '2026-07-24', '2026-07-24', ' kongowe '], NOW);
  assert.equal(kg.team, 'KONGOWE');
  assert.equal(kg.totals.calls, 1);
});

/* THE WIDGET FEED. It will be asked the same question all day by every screen that has it, so
   what it costs and what it carries both matter more than usual. */
test('the widget answers to a leader code or a team code, and carries no customer data', async () => {
  const db = fakeDb(makeTables());

  // A leader's access code. LEAD1 is ASHA JUMA, scoped to KONGOWE.
  const lead = await callApi(db, 'api_widget', ['LEAD1'], NOW);
  assert.equal(lead.ok, true);
  assert.equal(lead.who, 'ASHA JUMA');
  assert.equal(lead.scope, 'KONGOWE');
  assert.ok(lead.brand);
  for (const k of ['col', 'kesho', 'weekCol', 'sales', 'expdf', 'recovery']) {
    assert.ok(k in lead, k + ' is on the widget');
    assert.deepEqual(Object.keys(lead[k]).sort(), ['den', 'num', 'pct']);
  }

  // An officer's TEAM code opens it too -- an officer has no access code at all, and a widget
  // cannot show a sign-in form.
  const team = await callApi(db, 'api_widget', ['KON123'], NOW);
  assert.equal(team.ok, true);
  assert.equal(team.scope, 'KONGOWE');
  assert.equal(team.col.den, lead.col.den, 'same team, same figures, whichever code was used');
  // Written any way at all, exactly as registering a phone accepts it.
  assert.equal((await callApi(db, 'api_widget', [' kon-123 '], NOW)).ok, true);

  // An admin code with no teams sees everything.
  const all = await callApi(db, 'api_widget', ['ADMIN1'], NOW);
  assert.equal(all.scope, 'All teams');
  assert.ok(all.col.den >= lead.col.den);

  // NO CUSTOMER DATA. This ends up on lock screens and on monitors in corridors, so the whole
  // reply is checked as text -- not just its field names.
  const blob = JSON.stringify(lead);
  for (const leak of ['AMINA', 'PILI', '0712000001', '0713000001', 'ref', 'rows', 'full_name']) {
    assert.equal(blob.includes(leak), false, 'widget must not carry ' + leak);
  }
  // And it stays small enough to poll all day from every phone in the field.
  assert.ok(blob.length < 1200, 'widget payload is ' + blob.length + ' bytes');

  // A code nobody has is refused plainly; no code at all is a different, clearer answer.
  assert.deepEqual(await callApi(db, 'api_widget', ['NOPE'], NOW), { ok: false, error: 'BAD_CODE' });
  assert.deepEqual(await callApi(db, 'api_widget', ['  '], NOW), { ok: false, error: 'NO_CODE' });
});

/* Every screen with the widget on it asks the same question every two minutes. For a leader
   who sees all teams that question is the heaviest one this system can be asked -- heavy
   enough that the platform was cutting the request off before it answered. */
test('the widget works the figures out once and hands the same answer to every screen', async () => {
  const { _clearWidgetCache } = await import('../api/_lib/call-core.js');
  _clearWidgetCache();

  // Count what actually gets asked of the database.
  const base = fakeDb(makeTables());
  let reads = 0;
  const counting = { from(n){ reads++; return base.from(n); }, rpc: base.rpc, _dump: n => base._dump(n) };

  const first = await callApi(counting, 'api_widget', ['LEAD1'], NOW);
  const afterFirst = reads;
  assert.equal(first.ok, true);
  assert.equal(first.cached, false);
  assert.ok(afterFirst > 10, 'the first answer really is expensive: ' + afterFirst + ' reads');

  // A second screen on the same teams pays almost nothing -- just enough to check the code and
  // fetch the brand.
  const second = await callApi(counting, 'api_widget', ['LEAD1'], NOW + 1000);
  const cost = reads - afterFirst;
  assert.equal(second.cached, true);
  assert.ok(cost <= 4, 'a repeat costs ' + cost + ' reads, not ' + afterFirst);
  assert.deepEqual(second.col, first.col);
  assert.deepEqual(second.recovery, first.recovery);

  // The figures carry the moment they were worked out, not the moment they were handed over --
  // a screen must not say "live" over numbers that are four minutes old.
  assert.equal(second.at, first.at);

  // An officer's TEAM code lands on the same cached figures, because it is the same scope.
  const viaTeam = await callApi(counting, 'api_widget', ['KON123'], NOW + 2000);
  assert.equal(viaTeam.cached, true);
  assert.deepEqual(viaTeam.col, first.col);

  // A DIFFERENT scope is a different question and is worked out properly.
  const before = reads;
  const admin = await callApi(counting, 'api_widget', ['ADMIN1'], NOW + 3000);
  assert.equal(admin.cached, false);
  assert.ok(reads - before > 10, 'all-teams is computed, not served from the team cache');
  assert.equal(admin.scope, 'All teams');

  // And it stops being reused once it is old enough to be worth redoing.
  const later = await callApi(counting, 'api_widget', ['LEAD1'], NOW + 130000);
  assert.equal(later.cached, false);

  // A clock that jumps backwards must not make an old copy look brand new.
  _clearWidgetCache();
  await callApi(counting, 'api_widget', ['LEAD1'], NOW);
  assert.equal((await callApi(counting, 'api_widget', ['LEAD1'], NOW - 60000)).cached, false);

  _clearWidgetCache();
});

/* THE CUSTOMER'S OWN DOOR. A reference number is the only thing being asked for, so the shape
   of what comes back is a security decision as much as a design one. */
test('a customer sees their own loan, and nothing that would help anyone else', async () => {
  const db = fakeDb(makeTables());
  db._dump('received_payments').push(
    { ref_no: '111', paid_at: '2026-07-22', amount_paid: 1000, transaction_id: 'TX1' },
    { ref_no: '111', paid_at: '2026-07-24', amount_paid: 500, transaction_id: 'TX2' },
    { ref_no: '222', paid_at: '2026-07-24', amount_paid: 900, transaction_id: 'TX9' },
  );

  const me = await callApi(db, 'api_customerLookup', ['111'], NOW);
  assert.equal(me.ok, true);
  assert.equal(me.name, 'AMINA H');
  assert.equal(me.ref, '111');
  assert.equal(me.team, 'KONGOWE');
  assert.equal(me.loan.expectedToday, 1000);
  assert.equal(me.loan.dueSummary, '2/6');

  // A phone number is the one field that turns a leaked ref into something worth harvesting.
  // It must not be here, on this door, in any form.
  for (const k of ['contact', 'phone', 'guarantor_name', 'guarantor_contact', 'guarantorName']) {
    assert.equal(k in me, false, k + ' must never be returned to a customer');
  }
  assert.equal(JSON.stringify(me).includes('0712000001'), false, 'no customer phone anywhere in the reply');
  assert.equal(JSON.stringify(me).includes('0713000001'), false, 'no guarantor phone anywhere in the reply');
  assert.equal(JSON.stringify(me).includes('G ONE'), false, 'no guarantor name anywhere in the reply');

  // Their payments, newest first -- and ONLY theirs.
  assert.deepEqual(me.payments.map(p => p.date), ['2026-07-24', '2026-07-22']);
  assert.equal(me.payments.some(p => p.receipt === 'TX9'), false, "another customer's payment leaked");

  // Nothing about anybody else, at all.
  assert.equal(JSON.stringify(me).includes('PILI S'), false);
  assert.equal(JSON.stringify(me).includes('OTHER TEAM'), false);

  // A customer who has fallen behind is told so plainly, off the follow-up book -- they must
  // not be turned away just because they dropped off the daily repayment list.
  const late = await callApi(db, 'api_customerLookup', ['555'], NOW);
  assert.equal(late.ok, true);
  assert.equal(late.name, 'DEF GUY');
  assert.equal(late.behind, true);
  assert.equal(late.loan.arrears, 900);
  assert.equal(JSON.stringify(late).includes('0714000001'), false, 'no phone on the follow-up path either');
  assert.equal(JSON.stringify(late).includes('0715000001'), false);

  // A ref nobody has is a plain "not found", not an error and not a hint.
  const none = await callApi(db, 'api_customerLookup', ['999999'], NOW);
  assert.deepEqual(none, { ok: false, error: 'NOT_FOUND' });
  assert.deepEqual(await callApi(db, 'api_customerLookup', ['  '], NOW), { ok: false, error: 'NO_REF' });
});

test('customer login can be hardened with the last 4 digits of the phone', async () => {
  const t = makeTables();
  t.settings = (t.settings || []).concat([{ key: 'CUSTOMER_LOGIN_VERIFY', value: 'phone4' }]);
  const db = fakeDb(t);

  // The ref alone is no longer enough.
  assert.deepEqual(await callApi(db, 'api_customerLookup', ['111'], NOW), { ok: false, error: 'VERIFY_FAILED' });
  assert.deepEqual(await callApi(db, 'api_customerLookup', ['111', '9999'], NOW), { ok: false, error: 'VERIFY_FAILED' });

  // The right four digits open it, however the number is written down.
  assert.equal((await callApi(db, 'api_customerLookup', ['111', '0001'], NOW)).ok, true);
  assert.equal((await callApi(db, 'api_customerLookup', ['111', '00 01'], NOW)).ok, true);

  // A customer with no number on file has nothing to check against. Refusing them would lock
  // out exactly the people whose records are thinnest, so the ref alone still stands.
  db._dump('repayment_snapshots').push({ ref: '888', full_name: 'NO PHONE', contact: '', team: 'KONGOWE',
    payment_expected: 100, arrears: 0, snapshot_type: 'today', snapshot_date: '2026-07-24',
    upload_batch: 'b1', created_at: '2026-07-24T04:00:00Z' });
  assert.equal((await callApi(db, 'api_customerLookup', ['888'], NOW)).ok, true);

  // And with the setting off (the default), four digits are never asked for.
  const open = fakeDb(makeTables());
  assert.equal((await callApi(open, 'api_customerLookup', ['111'], NOW)).ok, true);
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

// A field officer has exactly ONE code -- their team's -- and typing it into the launcher's
// sign-in box used to dead-end at "invalid code". It is valid, just for the other door.
test('a team code is recognised as a team code, however it is typed', async () => {
  const db = fakeDb(makeTables());
  assert.deepEqual(await callApi(db, 'api_teamCode', ['KON123'], NOW), { ok: true, team: 'KONGOWE' });
  // Read aloud over a phone and typed back with whatever spacing and case land -- same rule
  // register() itself applies, so a code that works there is recognised here.
  assert.deepEqual(await callApi(db, 'api_teamCode', [' kon-123 '], NOW), { ok: true, team: 'KONGOWE' });
  assert.deepEqual(await callApi(db, 'api_teamCode', ['MBA456'], NOW), { ok: true, team: 'MBAGALA' });
  // An access code is NOT a team code: it belongs to the portal door, and must not be
  // mistaken for this one.
  assert.equal((await callApi(db, 'api_teamCode', ['ADMIN1'], NOW)).ok, false);
  assert.equal((await callApi(db, 'api_teamCode', [''], NOW)).ok, false);
  assert.equal((await callApi(db, 'api_teamCode', [null], NOW)).ok, false);
});

// 0.147 GB of data became 81 GB of transfer in a month because every officer downloaded every
// team's book on every load. Narrowing happens at the DATABASE now, so the wrong team's rows
// never travel -- but under-matching here would show an officer an EMPTY list with no error,
// which is worse than the waste. Both directions are pinned.
test('an officer is served only their own team, and case never loses them their list', async () => {
  const t = makeTables();
  // MBAGALA's defaulter must never reach a KONGOWE officer, and KONGOWE's must always arrive.
  t.followup_status.push({ ref: '777', team: 'MBAGALA', full_name: 'OTHER TEAM DEF',
    contact: '0714000777', arrears: 500, status: 'Defaulter', ds: '2-6', days_elapsed: 5 });
  const db = fakeDb(t);
  await callApi(db, 'api_callRegister', ['d1', 'JUMA ISSA', '', '', '0712999999', 'KON123'], NOW);

  const mine = await callApi(db, 'api_callList', ['d1', 'defaulters'], NOW);
  assert.deepEqual(mine.rows.map(r => r.ref), ['555']);
  assert.equal(mine.rows.every(r => r.team === 'KONGOWE'), true);

  // An ADMIN sees everything -- no team filter is applied at all when scope is ALL teams.
  await callApi(db, 'api_callRegister', ['d3', '', '', 'ADMIN1', '0788999000'], NOW);
  const all = await callApi(db, 'api_callList', ['d3', 'defaulters'], NOW);
  assert.deepEqual(all.rows.map(r => r.ref).sort(), ['555', '777']);

  // A team spelled in lower case on the account must still match the stored UPPERCASE name.
  // Getting this wrong is silent: the officer simply sees no customers.
  const db2 = fakeDb(makeTables());
  await callApi(db2, 'api_callRegister', ['d4', 'CASE OFFICER', '', '', '0712999888', 'KON123'], NOW);
  db2._dump('call_users').find(u => u.name === 'CASE OFFICER').team = 'kongowe';
  const lower = await callApi(db2, 'api_callList', ['d4', 'defaulters'], NOW);
  assert.deepEqual(lower.rows.map(r => r.ref), ['555'], 'lower-case team must still find its list');
});


test('"Amepigiwa leo" ticks for a call by ANYBODY, not just the officer looking', async () => {
  /* An officer reported that the tick only appeared for their own calls. It does not: the flag
     is built from every call log of today regardless of who made it, matched on the PHONE
     NUMBER. This pins that down so the question is settled with evidence rather than opinion.

     What IS true is that another officer's call only counts once their handset has SYNCED --
     the row has to reach the server before anybody else can see it. That is a delay, not a
     scope: the default sync is every five minutes. */
  // Before anybody has called: no tick.
  const before = await callApi(await registeredDb(), 'api_callList', ['d1', 'today'], NOW);
  assert.equal(before.rows.find(r => r.ref === '111').called, false);

  // A call to AMINA's number, made by a DIFFERENT officer on a DIFFERENT team's handset.
  const db = await registeredDb();
  db._dump('call_logs').push({ id: 'other-1', user_id: 'SOMEBODY-ELSE', officer: 'MBAGALA OFFICER',
    team: 'MBAGALA', phone: '0712000001', call_date: '2026-07-24', duration: 120,
    portfolio: true, outcome: 'CONNECTED' });
  const list = await callApi(db, 'api_callList', ['d1', 'today'], NOW);
  assert.equal(list.rows.find(r => r.ref === '111').called, true,
    'somebody else spoke to her today, so she is ticked for everybody');

  // And a dial attempt is still not a call, whoever made it.
  const db2 = await registeredDb();
  db2._dump('call_logs').push({ id: 'other-2', user_id: 'SOMEBODY-ELSE', officer: 'OTHER O',
    team: 'MBAGALA', phone: '0712000001', call_date: '2026-07-24', duration: 3,
    portfolio: true, outcome: 'CONNECTED' });
  const list2 = await callApi(db2, 'api_callList', ['d1', 'today'], NOW);
  assert.equal(list2.rows.find(r => r.ref === '111').called, false,
    'three seconds is a dial attempt, not a conversation — by anyone');
});


test('the bell reaches the field, scoped to the handset\'s own teams', async () => {
  /* An officer had no way to learn that a complaint had been raised against a customer on
     their round except by being telephoned about it. Same updates the portal shows, through
     the same implementation, so the office and the field can never see different lists. */
  const db = await registeredDb();
  db.from('complaints');          // the fake makes a table on first touch
  db._dump('complaints').push({ id: 'k9', team: 'KONGOWE', complainant: 'MAMA A',
    details: 'hakupata risiti', created_at: '2026-07-24T05:00:00Z', created_by: 'DESK' });
  db._dump('complaints').push({ id: 'k8', team: 'MBAGALA', complainant: 'OTHER TEAM',
    details: 'not mine', created_at: '2026-07-24T06:00:00Z', created_by: 'DESK' });

  const d = await callApi(db, 'api_callNotifications', ['d1'], NOW);
  assert.equal(d.ok, true);
  const blob = JSON.stringify(d.items);
  assert.match(blob, /hakupata risiti/);
  assert.doesNotMatch(blob, /not mine/, 'another team\'s complaint is not this officer\'s news');
  assert.ok(d.unseen > 0, 'nothing read yet means everything is unread');

  // Marking read is per HANDSET: one officer clearing theirs must not clear anybody else's.
  const seen = await callApi(db, 'api_callNotifSeen', ['d1'], NOW + 1000);
  assert.ok(seen.seenAt);
  assert.equal((await callApi(db, 'api_callNotifications', ['d1'], NOW)).unseen, 0);
  assert.ok((await callApi(db, 'api_callNotifications', ['d2'], NOW)).unseen > 0,
    'the leader on another handset has still read nothing');

  // An unregistered phone is told so rather than handed the company's updates.
  assert.equal((await callApi(db, 'api_callNotifications', ['nope'], NOW)).error, 'DEVICE_NOT_REGISTERED');
});

/* THE PERFORMANCE STRIP HAS TO KEEP UP WITH UPLOADS, AND CANNOT BE RECOMPUTED ON A TIMER.
 *
 * "The performance bar in app should be permanent and updating whenever I upload reports; it
 *  gets lost so much that I am even not sure if it'll get back."
 *
 * The figures come from the whole book, so asking for them every few minutes for two hundred
 * officers is not affordable -- which is why the strip lagged an upload by a quarter of an hour
 * at best. The signal is DATA_VERSION: uploads stamp it, and the phone's routine sync carries
 * it back so the phone asks for new figures only when something has actually changed.
 */
test('a sync carries the data version, so a phone knows when an upload has happened', async () => {
  const db = await registeredDb();
  const before = await callApi(db, 'api_callSync', ['d1', []], NOW);
  assert.equal(before.ok, true);
  assert.equal(before.dataVersion, '', 'nothing uploaded yet on this database');

  // What an upload does, at the end of writing its rows.
  await db.from('settings').upsert({ key: 'DATA_VERSION', value: '1700000000000' }, { onConflict: 'key' });

  const after = await callApi(db, 'api_callSync', ['d1', []], NOW);
  assert.equal(after.dataVersion, '1700000000000', 'the next sync reports the new version');
  assert.notEqual(after.dataVersion, before.dataVersion, 'and it differs, which is the whole signal');
});

test('an empty sync stays cheap -- it is asked far more often than any other question', async () => {
  /* This runs every few minutes on every handset in the company, including officers with no
     calls to send at all. If it ever grows a list read it stops being affordable. */
  const db0 = await registeredDb();
  let trips = 0;
  const wrap = q => new Proxy(q, { get(o, p) {
    if (p === 'then') return (res, rej) => o.then(r => { trips++; return res(r); }, rej);
    const v = o[p];
    return typeof v === 'function' ? (...a) => { const out = v.apply(o, a); return out === o ? wrap(o) : out; } : v;
  } });
  const db = { from: n => wrap(db0.from(n)), rpc: (...a) => db0.rpc(...a), _dump: n => db0._dump(n) };
  await callApi(db, 'api_callSync', ['d1', []], NOW);
  assert.ok(trips <= 3, `an empty sync took ${trips} round trips; it must stay a couple of key lookups`);
});

test('the daily summary says which upload it was computed from', async () => {
  const db = await registeredDb();
  await db.from('settings').upsert({ key: 'DATA_VERSION', value: '1700000000001' }, { onConflict: 'key' });
  const d = await callApi(db, 'api_callDailySummary', ['d1'], NOW);
  assert.equal(d.ok, true);
  assert.equal(d.dataVersion, '1700000000001',
    'the figures carry their own version, so the phone cannot store them against the wrong one');
});

/* KESHO ON THE STRIP MUST AGREE WITH THE KESHO TAB.
 *
 * Nobody uploads an "Expected - Tomorrow" sheet: tomorrow's list is the ordinary Expected sheet
 * filed under tomorrow's date, and the tab has always read it that way with the old explicit
 * type behind it as a fallback. The strip's figure only had the first half -- so on a
 * deployment that never files a sheet ahead, Kesho on the strip was a permanent dash while the
 * Kesho tab right underneath it listed customers. A number that is always blank looks exactly
 * like a bar that is not working.
 */
test('the strip\'s Kesho figure falls back exactly as the Kesho tab does', async () => {
  const db = await registeredDb();
  // Nothing is filed under tomorrow's date -- only the old explicit type exists.
  db._dump('repayment_snapshots').length;
  await db.from('repayment_snapshots').insert([
    { ref: '901', full_name: 'KESHO ONE', team: 'KONGOWE', payment_expected: 1000, arrears: 0,
      todays_status: 'PAID', snapshot_type: 'tomorrow', snapshot_date: '2026-07-24',
      upload_batch: 'kb', created_at: '2026-07-24T04:00:00Z' },
    { ref: '902', full_name: 'KESHO TWO', team: 'KONGOWE', payment_expected: 1000, arrears: 0,
      todays_status: 'UNPAID', snapshot_type: 'tomorrow', snapshot_date: '2026-07-24',
      upload_batch: 'kb', created_at: '2026-07-24T04:00:00Z' },
  ]);
  const list = await callApi(db, 'api_callList', ['d1', 'tomorrow'], NOW);
  assert.ok(list.rows.length > 0, 'the tab shows customers');

  const sum = await callApi(db, 'api_callDailySummary', ['d1'], NOW);
  assert.notEqual(sum.kesho.pct, null, 'so the strip must not show a dash');
  assert.equal(sum.kesho.customers, list.rows.length, 'and it is the same list, not a second one');
});

/* AN ADMIN WITH NO HOME TEAM MUST SEE THE WHOLE COMPANY, ON THE STRIP TOO.
 *
 * "The performance bar is still dashes."
 *
 * An ALL-teams admin registers with call_users.team = NULL deliberately -- the column is a
 * foreign key into teams, so writing the literal 'ALL' broke registration outright. Wrapping
 * that NULL in an array scoped them to a team named "", which matches nothing, so every
 * denominator was zero and every percentage came back null. Dashes, all the way across, for the
 * one person most likely to be looking at the bar.
 *
 * The customer LISTS escaped it because they take their own path; the strip did not.
 */
test('an ALL-teams admin gets real figures on the strip, not dashes', async () => {
  const db = fakeDb(makeTables());
  await callApi(db, 'api_callRegister', ['dA', '', '', 'ADMIN1', '0755000111'], NOW);
  await callApi(db, 'api_callRegister', ['d1', 'JUMA ISSA', '', '', '0712999999', 'KON123'], NOW);
  const d = await callApi(db, 'api_callDailySummary', ['dA'], NOW);
  assert.equal(d.ok, true);
  assert.notEqual(d.col.pct, null, 'Col leo must be a number, not a dash');
  assert.ok(d.col.den > 0, 'and it is measured against a real expected amount');
  // MBAGALA is a second team; an ALL-teams admin's figures must include it.
  const scoped = await callApi(db, 'api_callDailySummary', ['d1'], NOW);   // KONGOWE officer
  assert.ok(d.col.den > scoped.col.den, 'the admin sees more of the book than one team does');
});

test('an officer with a home team is still scoped to it', async () => {
  // The fix must not turn every officer into an admin.
  const db = await registeredDb();
  const d = await callApi(db, 'api_callDailySummary', ['d1'], NOW);
  assert.equal(d.ok, true);
  assert.equal(d.col.den, 1500, 'KONGOWE only: 1000 + 500, never MBAGALA\'s 800');
});

/* TWO HUNDRED PHONES MUST NOT EACH RUN THE WHOLE DASHBOARD.
 *
 * The six figures on the strip are the dashboard's own, deliberately -- working them out a
 * second, cheaper way would be two answers that can disagree on a wall in front of the company.
 * The mistake was letting every handset run that read: two hundred officers opening the app,
 * plus a refresh on every upload, is two hundred whole-book reads. For an all-teams admin it is
 * the full forty teams, and it is what turned a JSON reply into an HTML error page.
 *
 * The widget already had a cache. The figures themselves did not, so the phones paid full price.
 */
test('officers on the same team share one calculation, not one each', async () => {
  const { _clearWidgetCache } = await import('../api/_lib/call-core.js');
  _clearWidgetCache();
  const base = fakeDb(makeTables());
  await callApi(base, 'api_callRegister', ['p1', 'JUMA ISSA', '', '', '0712999991', 'KON123'], NOW);
  await callApi(base, 'api_callRegister', ['p2', 'ASHA M', '', '', '0712999992', 'KON123'], NOW);

  let reads = 0;
  const counting = { from(n){ reads++; return base.from(n); }, rpc: base.rpc, _dump: n => base._dump(n) };

  const first = await callApi(counting, 'api_callDailySummary', ['p1'], NOW);
  const afterFirst = reads;
  assert.equal(first.ok, true);
  assert.ok(afterFirst > 8, 'the first officer really does pay for it: ' + afterFirst + ' reads');

  const second = await callApi(counting, 'api_callDailySummary', ['p2'], NOW + 1000);
  const cost = reads - afterFirst;
  assert.ok(cost <= 3, 'the next officer costs ' + cost + ' reads, not ' + afterFirst);
  assert.deepEqual(second.col, first.col, 'and gets the identical figures');

  // Still redone once it is old enough to be worth redoing.
  const before = reads;
  await callApi(counting, 'api_callDailySummary', ['p1'], NOW + 130000);
  assert.ok(reads - before > 8, 'two minutes on, it is worked out again');
  _clearWidgetCache();
});

test('the widget and the phone strip read from the SAME cache, not two', async () => {
  /* They used to keep separate ones, so the same numbers could be two minutes old on a wall and
     fresh on a handset -- two clocks for one set of figures. */
  const { _clearWidgetCache } = await import('../api/_lib/call-core.js');
  _clearWidgetCache();
  const base = fakeDb(makeTables());
  await callApi(base, 'api_callRegister', ['p1', 'JUMA ISSA', '', '', '0712999991', 'KON123'], NOW);
  let reads = 0;
  const counting = { from(n){ reads++; return base.from(n); }, rpc: base.rpc, _dump: n => base._dump(n) };

  await callApi(counting, 'api_callDailySummary', ['p1'], NOW);   // a phone asks first
  const after = reads;
  const w = await callApi(counting, 'api_widget', ['KON123'], NOW + 1000);
  assert.equal(w.cached, true, 'the wall display rides on the phone\'s answer');
  // access_codes, teams, the system switch and two branding settings -- everything except the
  // book itself, which is the whole point.
  assert.ok(reads - after <= 6, 'and pays only for the code lookup and the branding, not the book: '
    + (reads - after));
  _clearWidgetCache();
});

/* =====================================================================================
   WHOSE CUSTOMER IS THIS? -- the fourth chip.
   =====================================================================================
   "On the status, default days and default summary at customer widgets in the exp.def add the
    4th -- Leader (Show -- Bike, Manager, or GMO so that we know whose customer followup it is)"

   The rotation moves every defaulter between a GMO, a MANAGER and a BIKE officer on a clock,
   so on any given day whose customer this is genuinely cannot be guessed from the row. The
   phone showed status, cycle and D.S and stopped there.

   Also the fourth special case: a BIKE leader must get their own book on a handset exactly as
   a MANAGER or a GMO does. That is decided by holding the `bike` column on a team -- not by
   the role written on their access code -- and this pins it.
*/
async function bikeLeaderDb() {
  const t = makeTables();
  // ASHA JUMA holds the BIKE column, and nothing else. LEAD1 is their portal code.
  t.teams[0] = { ...t.teams[0], gmo: null, manager: null, bike: 'ASHA JUMA', recovery: null };
  t.settings.push({ key: 'ASSIGN_ACTIVE', value: 'BIKE,MANAGER,GMO' },
    { key: 'ASSIGN_BUCKET_DAYS', value: '2' });
  const D = (ref, arrears, type, days) => ({
    ref, full_name: 'C' + ref, contact: '07140000' + ref, team: 'KONGOWE', arrears,
    status: 'Defaulter', ds: '2/6', dc: 2, days_elapsed: days,
    disb_date: '2026-07-21',                       // a Tuesday -> due Tue and Fri; NOW is Friday
    snapshot_type: type, weekday: 'FRI', snapshot_date: '2026-07-24',
    upload_batch: 'b' + type, created_at: '2026-07-24T04:00:00Z',
  });
  t.defaulter_snapshots = [
    D('B1', 1000, 'initial', 1), D('B1', 600, 'current', 1),     // days 1-2 -> bucket 1 -> BIKE
    D('B2', 2000, 'initial', 3), D('B2', 2000, 'current', 3),    // days 3-4 -> bucket 2 -> MANAGER
  ];
  const db = fakeDb(t);
  const { _clearWidgetCache } = await import('../api/_lib/call-core.js');
  _clearWidgetCache();
  await callApi(db, 'api_callRegister', ['d2', '', '', 'LEAD1', '0788111222'], NOW);
  return db;
}

test('a BIKE leader gets their own expected defaulters on the phone', async () => {
  const db = await bikeLeaderDb();
  const d = await callApi(db, 'api_callList', ['d2', 'expdf'], NOW);
  assert.equal(d.ok, true);
  assert.deepEqual(d.rows.map(r => r.ref), ['B1'],
    'the bike officer\'s own bucket, not the manager\'s');
  assert.equal(d.expdf.scope, 'mine');
  assert.equal(d.expdf.canSwitch, true, 'and they are recognised as a leader, so they may widen it');
});

test('every expected-defaulter row on the phone names the role and the leader', async () => {
  const db = await bikeLeaderDb();
  const d = await callApi(db, 'api_callList', ['d2', 'expdf', 'team'], NOW);
  assert.equal(d.rows.length, 2, 'the whole team book');
  for (const r of d.rows) {
    assert.ok(r.role, 'the chip has nothing to draw without a role: ' + r.ref);
    assert.ok(r.leader, 'nor without a leader name: ' + r.ref);
  }
  const by = {};
  for (const r of d.rows) by[r.ref] = r;
  assert.equal(by.B1.role, 'BIKE');
  assert.equal(by.B1.leader, 'ASHA JUMA');
  assert.equal(by.B2.role, 'MANAGER');
  assert.equal(by.B2.leader, '(unassigned)',
    'a team that names nobody for the role says so, rather than leaving the chip blank');
});

/* =====================================================================================
   THREE KINDS OF USER SEE A NARROWER LIST -- AND ONLY THOSE THREE.
   =====================================================================================
   "i have a special case for credit analysts, expected and collection officers in call app
    only and not in system ... thats for 3 kind of users only and not the rest"

   The examples given, which are what these assertions are built from:
     credit               3-5, 4-12, 5-9, 0-3 in   ·   6-9, 10-12 out
     expected/collection  0-1, 2-3, 6-9 in         ·   5-9, 3-9 out
*/
const { narrowForRole, dsParts } = await import('../api/_lib/call-core.js');
const DSROWS = ds => ds.map(v => ({ ref: v, ds: v }));

test('a due summary reads as paid-of-target, in either spelling', () => {
  assert.deepEqual(dsParts('4/6'), { paid: 4, target: 6 });
  assert.deepEqual(dsParts('4-6'), { paid: 4, target: 6 });
  assert.equal(dsParts(''), null);
  assert.equal(dsParts('n/a'), null);
  assert.equal(dsParts(null), null);
});

test('a credit analyst sees only customers short of the fifth instalment', () => {
  const rows = DSROWS(['3-5', '4-12', '5-9', '0-3', '6-9', '10-12']);
  const kept = narrowForRole(rows, 'CREDIT', 'today', { creditMaxPaid: 5, earlyMaxBehind: 3 });
  assert.deepEqual(kept.map(r => r.ref), ['3-5', '4-12', '5-9', '0-3'],
    'exactly the worked example, and 6-9 / 10-12 are past the fifth');
});

test('the credit rule applies to every list they hold, not just Leo and Kesho', () => {
  const rows = DSROWS(['3-5', '6-9']);
  for (const which of ['today', 'tomorrow', 'defaulters']) {
    assert.deepEqual(
      narrowForRole(rows, 'CREDIT', which, { creditMaxPaid: 5, earlyMaxBehind: 3 }).map(r => r.ref),
      ['3-5'], which);
  }
});

test('expected and collection officers see only the one-behind, on Leo and Kesho only', () => {
  /* "expected for earl col and collection leaders only (keep those which behind = 1 only)".
     6-9 is three behind and therefore NOT theirs, which settles the one thing the original
     examples left ambiguous. */
  const rows = DSROWS(['0-1', '2-3', '6-9', '5-9', '3-9']);
  const lim = { creditMaxPaid: 5, earlyMaxBehind: 1 };
  for (const role of ['EXPECTED', 'COLLECTION']) {
    assert.deepEqual(narrowForRole(rows, role, 'today', lim).map(r => r.ref), ['0-1', '2-3'],
      role + ' on Leo');
    assert.deepEqual(narrowForRole(rows, role, 'tomorrow', lim).map(r => r.ref), ['0-1', '2-3'],
      role + ' on Kesho');
    // "in Leo and Kesho lists ONLY" -- the defaulter lists are the follow-up work itself.
    assert.equal(narrowForRole(rows, role, 'defaulters', lim).length, 5,
      role + ' must keep the whole defaulter list');
  }
});

test('the threshold is a setting, so it can be widened without a deploy', () => {
  const rows = DSROWS(['0-1', '2-3', '6-9', '5-9', '3-9']);
  assert.deepEqual(
    narrowForRole(rows, 'EXPECTED', 'today', { creditMaxPaid: 5, earlyMaxBehind: 3 }).map(r => r.ref),
    ['0-1', '2-3', '6-9']);
});

test('everybody else keeps the whole list -- "that\'s for 3 kind of users only"', () => {
  const rows = DSROWS(['0-1', '6-9', '10-12']);
  assert.equal(narrowForRole(rows, null, 'today', { creditMaxPaid: 5, earlyMaxBehind: 3 }).length, 3);
});

test('a customer with no readable due summary is never hidden', () => {
  /* A missing or unreadable D.S is a fault in the upload. Answering it by hiding the customer
     turns a bad column into somebody nobody rings, silently -- which is far worse than the
     bad column. */
  const rows = [{ ref: 'NODS', ds: '' }, { ref: 'JUNK', ds: 'n/a' }, { ref: 'OK', ds: '10-12' }];
  const lim = { creditMaxPaid: 5, earlyMaxBehind: 1 };
  assert.deepEqual(narrowForRole(rows, 'CREDIT', 'today', lim).map(r => r.ref), ['NODS', 'JUNK'],
    'the readable one is past the fifth instalment, so only the unreadable pair survive');
  assert.deepEqual(narrowForRole(rows, 'EXPECTED', 'today', lim).map(r => r.ref), ['NODS', 'JUNK'],
    '10-12 is two behind, so the early rule drops it -- but neither unreadable row is hidden');
});

test('the narrowing runs end to end, and the phone is told it happened', async () => {
  const t = makeTables();
  // The signed-in leader holds the `credit` column, which is what makes them a credit analyst
  // here -- the same rule the recycling rotation uses for its three.
  t.teams[0] = { ...t.teams[0], credit: 'ASHA JUMA' };
  t.repayment_snapshots = [
    { ref: 'P1', full_name: 'EARLY', contact: '0712000011', team: 'KONGOWE', payment_expected: 1000,
      arrears: 0, todays_status: 'UNPAID', due_summary: '2/6', snapshot_type: 'today',
      snapshot_date: '2026-07-24', upload_batch: 'z1', created_at: '2026-07-24T04:00:00Z' },
    { ref: 'P2', full_name: 'LATE', contact: '0712000012', team: 'KONGOWE', payment_expected: 1000,
      arrears: 0, todays_status: 'UNPAID', due_summary: '9/12', snapshot_type: 'today',
      snapshot_date: '2026-07-24', upload_batch: 'z1', created_at: '2026-07-24T04:00:00Z' },
  ];
  const db = fakeDb(t);
  const { _clearWidgetCache } = await import('../api/_lib/call-core.js');
  _clearWidgetCache();
  await callApi(db, 'api_callRegister', ['d9', '', '', 'LEAD1', '0788111333'], NOW);

  const d = await callApi(db, 'api_callList', ['d9', 'today'], NOW);
  assert.deepEqual(d.rows.map(r => r.ref), ['P1'], 'only the one short of the fifth instalment');
  assert.deepEqual(d.narrowed, { role: 'CREDIT', shown: 1, of: 2 },
    'and the phone is told, or a shorter list is just a discrepancy nobody can explain');
});

test('a field officer on the same book still sees everybody', async () => {
  const t = makeTables();
  t.teams[0] = { ...t.teams[0], credit: 'ASHA JUMA' };
  t.repayment_snapshots = [
    { ref: 'P1', full_name: 'EARLY', contact: '0712000011', team: 'KONGOWE', payment_expected: 1000,
      arrears: 0, todays_status: 'UNPAID', due_summary: '2/6', snapshot_type: 'today',
      snapshot_date: '2026-07-24', upload_batch: 'z1', created_at: '2026-07-24T04:00:00Z' },
    { ref: 'P2', full_name: 'LATE', contact: '0712000012', team: 'KONGOWE', payment_expected: 1000,
      arrears: 0, todays_status: 'UNPAID', due_summary: '9/12', snapshot_type: 'today',
      snapshot_date: '2026-07-24', upload_batch: 'z1', created_at: '2026-07-24T04:00:00Z' },
  ];
  const db = fakeDb(t);
  const { _clearWidgetCache } = await import('../api/_lib/call-core.js');
  _clearWidgetCache();
  await callApi(db, 'api_callRegister', ['d8', 'JUMA ISSA', '', '', '0712999998', 'KON123'], NOW);
  const d = await callApi(db, 'api_callList', ['d8', 'today'], NOW);
  assert.deepEqual(d.rows.map(r => r.ref).sort(), ['P1', 'P2']);
  assert.equal(d.narrowed, null);
});

/* =====================================================================================
   THE NARROWED READ STILL CARRIES EVERYTHING THE PHONE DRAWS.
   =====================================================================================
   The Leo and Kesho lists now ask for ten named columns instead of every column of the table
   -- this is the read two hundred handsets make several times a day on a mobile connection,
   and it was carrying the docket, four schedule dates, the branch, the zone and the totals,
   none of which appears anywhere on a phone.

   The saving is only safe if the list is complete. A forgotten column is not an error: it is
   a customer on somebody's phone with no name and nothing to tap, which is exactly how that
   happened once before. The fake database honours the projection, so this test is the guard.
*/
test('the phone\'s Leo list carries every field its row and sheet render', async () => {
  const db = await registeredDb();
  const d = await callApi(db, 'api_callList', ['d1', 'today'], NOW);
  const r = d.rows.find(x => x.ref === '111');
  assert.ok(r, 'the fixture customer is on the list');

  // rowHtml: the name, the team, the arrears, the instalment, the status chips, the D.S.
  assert.equal(r.name, 'AMINA H');
  assert.equal(r.team, 'KONGOWE');
  assert.equal(r.contact, '0712000001');
  assert.equal(r.custStatus, 'UNPAID');
  assert.equal(r.ds, '2/6');
  assert.equal(r.installment, 1000, 'the expected amount is what Leo shows as the instalment');
  // sheetSkeleton: the guarantor, and their number, which is who an officer rings when the
  // customer does not answer.
  assert.equal(r.gName, 'G ONE');
  assert.equal(r.gContact, '0713000001');
  // Nothing may be undefined -- an undefined field renders as the word "undefined" or as blank,
  // and both look like a data problem rather than a narrowed read.
  for (const k of ['ref', 'name', 'contact', 'gName', 'gContact', 'amt', 'installment',
    'custStatus', 'fuStatus', 'ds', 'team', 'called']) {
    assert.notEqual(r[k], undefined, k + ' is missing from the narrowed read');
  }
});

test('the phone\'s Kesho list carries the same fields', async () => {
  const db = await registeredDb();
  const d = await callApi(db, 'api_callList', ['d1', 'tomorrow'], NOW);
  assert.ok(d.rows.length, 'the fixture has a Kesho customer');
  for (const r of d.rows) {
    for (const k of ['ref', 'name', 'contact', 'gName', 'gContact', 'amt', 'team']) {
      assert.notEqual(r[k], undefined, k + ' is missing on ' + r.ref);
    }
  }
});

/* =====================================================================================
   PORTFOLIO MEANS *THEIR* BOOK, NOT THE COMPANY'S.
   =====================================================================================
   "A user's portfolio calls should count for their assigned team's customers only, a call in
    other teams not assigned to the users are non portfolio."

   A match against any customer anywhere used to count, so ringing somebody who happens to
   borrow from another branch scored as portfolio work -- and an officer's portfolio ratio was
   not a measure of their own book at all.
*/
test('a call to another team\'s customer is not portfolio work', async () => {
  const db = await registeredDb();          // d1 = JUMA ISSA, a field officer on KONGOWE
  const r = await callApi(db, 'api_callSync', ['d1', [
    // 0712000001 is AMINA H on KONGOWE -- this officer's own team.
    { num: '0712000001', ts: Date.parse('2026-07-24T07:00:00Z'), dur: 60, outcome: 'CONNECTED' },
    // 0712000003 is OTHER TEAM on MBAGALA -- a real customer, but not theirs.
    { num: '0712000003', ts: Date.parse('2026-07-24T07:05:00Z'), dur: 60, outcome: 'CONNECTED' },
    // Nobody at all.
    { num: '0755999999', ts: Date.parse('2026-07-24T07:10:00Z'), dur: 30, outcome: 'MISSED' },
  ]], NOW);
  assert.equal(r.ok, true);
  assert.equal(r.portfolio, 1, 'only the KONGOWE customer counts');
  assert.equal(r.nonPortfolio, 2, 'the other team\'s customer counts as non-portfolio, like a stranger');

  const logs = db._dump('call_logs');
  const mbagala = logs.find(l => l.phone.slice(-9) === '712000003');
  assert.equal(mbagala.portfolio, false);
  assert.equal(mbagala.customer, 'OTHER TEAM',
    'but the customer is still named -- the officer dialled the number, so this hides nothing');
  assert.equal(mbagala.category, null, 'and it is not filed under a category it does not belong to');
});

test('a leader who sees every team keeps every match', async () => {
  /* Their book IS every team, so narrowing would take away exactly the thing that makes a
     leader's ratio meaningful. d2 registers with LEAD1, whose teams are KONGOWE only, so this
     uses the admin code to get the all-teams case. */
  const t = makeTables();
  t.access_codes.push({ code: 'ALLT', name: 'BIG BOSS', role: 'MANAGEMENT', teams: null, tabs: [] });
  const db = fakeDb(t);
  const { _clearWidgetCache } = await import('../api/_lib/call-core.js');
  _clearWidgetCache();
  await callApi(db, 'api_callRegister', ['dz', '', '', 'ALLT', '0788000111'], NOW);
  const r = await callApi(db, 'api_callSync', ['dz', [
    { num: '0712000001', ts: Date.parse('2026-07-24T07:00:00Z'), dur: 60, outcome: 'CONNECTED' },
    { num: '0712000003', ts: Date.parse('2026-07-24T07:05:00Z'), dur: 60, outcome: 'CONNECTED' },
  ]], NOW);
  assert.equal(r.portfolio, 2, 'every team is their book');
  assert.equal(r.nonPortfolio, 0);
});

test('a customer with no team recorded still counts as portfolio', async () => {
  /* That is a gap in the upload, not evidence the call was outside their book. Demoting it
     would dock an officer for somebody else's blank cell. */
  const t = makeTables();
  t.followup_status.push({ ref: 'NOTEAM', team: null, full_name: 'NO TEAM GUY',
    contact: '0719000001', arrears: 500, status: 'Defaulter', fu_status: '' });
  const db = fakeDb(t);
  const { _clearWidgetCache } = await import('../api/_lib/call-core.js');
  _clearWidgetCache();
  await callApi(db, 'api_callRegister', ['dn', 'JUMA ISSA', '', '', '0712999777', 'KON123'], NOW);
  const r = await callApi(db, 'api_callSync', ['dn', [
    { num: '0719000001', ts: Date.parse('2026-07-24T07:00:00Z'), dur: 60, outcome: 'CONNECTED' },
  ]], NOW);
  assert.equal(r.portfolio, 1);
});

/* =====================================================================================
   WHO THE THREE SPECIAL CASES ACTUALLY REACH.

     "logged in to catherine and at leo just the first customer is 6-10, at kesho 4-12"

   6-10 is four behind, 4-12 is eight. Neither belongs in front of a collection officer, so
   the narrowing was not running for her at all -- and the cause was that the rule matched a
   role by exact equality against the literal word 'COLLECTION', while every collection
   officer in this system carries 'PMO COLLECTION' (pmo.js names it, register() copies it off
   the access code onto call_users.role verbatim).

   These assertions pin the role RESOLUTION on its own, which is where the fault was -- the
   arithmetic below it was always right and was never the problem.
   ===================================================================================== */
const { callRoleKind } = await import('../api/_lib/call-core.js');
const roleDb = (role, extra = {}) => ({ db: fakeDb(Object.assign(makeTables(), extra)),
  user: { name: 'CATHERINE', role } });

test('a PMO collection officer is recognised -- the spelling every access code actually uses', async () => {
  // THE REPORTED BUG. 'PMO COLLECTION' is what pmo.js calls the role and what register()
  // writes; matching the bare word 'COLLECTION' never saw it.
  const a = roleDb('PMO COLLECTION');
  assert.equal(await callRoleKind(a.db, a.user), 'COLLECTION');
});

test('the collection role forgives case and punctuation, as isPmoRole always has', async () => {
  for (const spelling of ['PMO COLLECTION', 'pmo collection', 'PMO-COLLECTION', 'Pmo  Collection',
                          'COLLECTION', 'Collection Officer', 'EARLY COLLECTION']) {
    const { db, user } = roleDb(spelling);
    const got = await callRoleKind(db, user);
    // 'EARLY COLLECTION' carries both words; either early rule narrows identically, which is
    // the point -- EXPECTED and COLLECTION share one threshold.
    assert.ok(got === 'COLLECTION' || got === 'EXPECTED',
      spelling + ' must reach the early-collection rule, got ' + got);
  }
});

test('renaming the role in Settings moves the rule with it, with no deploy', async () => {
  /* The whole reason PMO_ROLE is a setting. A deployment that calls them something else must
     not silently lose the narrowing. */
  const { db, user } = roleDb('WAKUSANYAJI', { settings: [{ key: 'PMO_ROLE', value: 'WAKUSANYAJI' }] });
  assert.equal(await callRoleKind(db, user), 'COLLECTION');
});

test('a credit analyst is recognised however the role was typed', async () => {
  for (const spelling of ['CREDIT', 'CREDIT ANALYST', 'Credit Analyst', 'credit-analyst']) {
    const { db, user } = roleDb(spelling);
    assert.equal(await callRoleKind(db, user), 'CREDIT', spelling);
  }
});

test('no other role is narrowed -- everybody else keeps the whole book', async () => {
  /* The one real risk in matching on a contained word rather than the whole string: a role
     that was never special quietly becoming so, and an officer losing customers with nothing
     to explain it. None of these carries any of the three words. */
  for (const role of ['OFFICER', 'RECOVERY', 'GMO', 'MANAGER', 'BIKE', 'OPM', 'LEGAL',
                      'ADMIN', 'MANAGEMENT', 'LEADER', '']) {
    const { db, user } = roleDb(role);
    assert.equal(await callRoleKind(db, user), null,
      role + ' must keep the whole book');
  }
});

test('failing the role, the teams table still recognises somebody by name', async () => {
  // The credit analyst and the expected officer genuinely are columns there.
  const t = makeTables();
  t.teams[0].credit = 'CATHERINE';
  const db = fakeDb(t);
  assert.equal(await callRoleKind(db, { name: 'CATHERINE', role: 'OFFICER' }), 'CREDIT');
});

test('an early-collection officer with a leader role name is still narrowed to behind = 1', async () => {
  /* End to end, the way Catherine actually meets it: the role resolves, so the Leo list drops
     6-10 (four behind) and keeps 2-3 (one). Before the fix both stayed. */
  const rows = DSROWS(['2-3', '6-10', '4-12']);
  const kept = narrowForRole(rows, 'COLLECTION', 'today', { creditMaxPaid: 5, earlyMaxBehind: 1 });
  assert.deepEqual(kept.map(r => r.ref), ['2-3'],
    'the two she reported seeing are exactly the two that go');
});
