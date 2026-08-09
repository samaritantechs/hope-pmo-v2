/* THE SPEED GUARD.
 *
 * "Moving forward everything we do should take speed precaution."
 *
 * A promise to be careful is worth nothing six weeks later. This is the promise written down as
 * something that FAILS: every screen has a budget in round trips, and adding a read that blows
 * it turns `npm test` red before the change can be deployed.
 *
 * ROUND TRIPS ARE THE UNIT. Each one is a separate journey from the web server to the database
 * and back -- 100 to 300 thousandths of a second on a good connection. Rows and megabytes
 * matter too, but they scale with the book; the number of journeys is a property of the CODE,
 * and it is what turned the dashboard into eighty-five seconds of waiting for one idle user.
 *
 * The budgets below are deliberately a little above what each screen costs today, so ordinary
 * work does not trip them. They are a ceiling, not a target. If a change needs more, the
 * question to answer first is "can the database do this instead of me?" -- and if the answer is
 * genuinely no, raise the number here IN THE SAME COMMIT, so the cost is visible in the diff
 * rather than discovered by somebody in the field.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';
import { SNAPSHOT_TOTALS_RPC } from './snapshot-totals-rpc.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');
const { callApi } = await import('../api/_lib/call-core.js');

const NOW = Date.parse('2026-07-24T09:00:00Z');            // Friday noon EAT
const TEAMS = Array.from({ length: 40 }, (_, i) => 'TEAM' + String(i + 1).padStart(2, '0'));

/** A book big enough that reading it carelessly shows up. Deliberately modest per table --
    this is about the SHAPE of the reads, and a shape that is wrong is wrong at any size. */
function bigBook() {
  const t = {
    teams: TEAMS.map(x => ({ team: x, recovery: 'REC ' + x, expected: 'EXP ' + x })),
    settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }],
    access_codes: [], roles: [], call_agents: [], call_users: [], call_logs: [],
    repayment_snapshots: [], defaulter_snapshots: [], followup_status: [], followup_comments: [],
    loans: [], received_payments: [], complaints: [], restructures: [], demand_notices: [],
    abnormal_payments: [],
  };
  const day = i => new Date(Date.parse('2026-07-24') - i * 86400000).toISOString().slice(0, 10);
  for (let d = 0; d < 7; d++) {
    for (let i = 0; i < 2000; i++) {
      const team = TEAMS[i % TEAMS.length];
      t.repayment_snapshots.push({ ref: 'R' + i, full_name: 'C' + i, team, payment_expected: 5000,
        todays_status: i % 2 ? 'PAID' : 'UNPAID', arrears: 0, snapshot_type: 'today',
        snapshot_date: day(d), upload_batch: 'b' + d, created_at: day(d) + 'T04:00:00Z' });
    }
    for (let i = 0; i < 500; i++) {
      const team = TEAMS[i % TEAMS.length];
      for (const type of ['initial', 'current']) {
        t.defaulter_snapshots.push({ ref: 'R' + i, team, arrears: 4000, snapshot_type: type,
          weekday: 'FRI', snapshot_date: day(d), upload_batch: 'b' + d + type,
          created_at: day(d) + 'T04:00:00Z' });
      }
    }
  }
  for (let i = 0; i < 2000; i++) {
    t.followup_status.push({ ref: 'R' + i, team: TEAMS[i % TEAMS.length], full_name: 'C' + i,
      arrears: 4000, status: 'Defaulter', fu_status: 'AMETOA AHADI' });
    t.loans.push({ id: 'l' + i, team: TEAMS[i % TEAMS.length], stage: 'approved',
      principal_amt: 300000, approved_date: day(i % 7), track_no: '1', created_by: 'CS1' });
  }
  // A year of imported comment history -- the thing that made the bell cost forty megabytes.
  for (let i = 0; i < 20000; i++) {
    t.followup_comments.push({ id: 'c' + i, ref: 'R' + (i % 2000), team: TEAMS[i % TEAMS.length],
      comment: 'a note', created_at: day(i % 7) + 'T08:00:00Z', created_by: 'OFFICER' });
  }
  for (let i = 0; i < 500; i++) {
    t.complaints.push({ id: 'k' + i, ref: 'R' + i, team: TEAMS[i % TEAMS.length],
      complainant: 'MAMA ' + i, details: 'x', created_at: day(i % 7) + 'T08:00:00Z' });
  }
  return t;
}

/** Counts every request the code sends, exactly as fetchAll issues them.
 *
 *  `rpc` calls count as a round trip AND their rows count too. Leaving the rows out would let
 *  the whole point of the team-day totals go unmeasured -- and worse, would let a future
 *  database function that returned a row per customer sail through this guard. */
function counting(tables, opts) {
  const db0 = fakeDb(tables, opts);
  let trips = 0, rows = 0;
  const wrap = q => new Proxy(q, { get(o, p) {
    if (p === 'then') return (res, rej) => o.then(r => {
      trips++; if (Array.isArray(r.data)) rows += r.data.length; return res(r);
    }, rej);
    const v = o[p];
    return typeof v === 'function' ? (...a) => { const out = v.apply(o, a); return out === o ? wrap(o) : out; } : v;
  } });
  return { db: { from: n => wrap(db0.from(n)),
                 rpc: async (n, a) => {
                   trips++;
                   const r = await db0.rpc(n, a);
                   if (Array.isArray(r.data)) rows += r.data.length;
                   return r;
                 },
                 _dump: n => db0._dump(n) },
           stat: () => ({ trips, rows }) };
}

const ADMIN = { code: 'A', name: 'ADMIN', role: 'ADMIN', teams: null, tabs: ['settings', 'upload'] };
const OFFICER = { code: 'O', name: 'OFFICER', role: 'GMO', teams: [TEAMS[0]], tabs: [] };

/* ROWS ARE A BUDGET TOO, and leaving them out is how three unbounded reads of the comment log
   sat behind a guard that was passing. A filtered fetchAll costs ONE round trip and can still
   drag two hundred thousand rows across the wire -- the trip count says nothing about it. So
   every screen declares both, and the row budget is the one that catches "select everything and
   sort it here".

   THERE ARE TWO NUMBERS FOR EVERY SCREEN NOW, because there are two live worlds. The team-day
   totals arrive with db/migrations/2026-08-05-snapshot-totals.sql, which is pasted into the SQL
   editor by hand -- so until that happens the same code reads rows and adds them up itself. The
   pair of budgets is what makes the saving a fact rather than a claim, and it stops the SLOW
   path quietly rotting on deployments that have not run the migration yet.

   screen, portal function, args, who, TRIPS, ROWS, TRIPS(migrated), ROWS(migrated) */
const BUDGETS = [
  ['Dashboard (all teams)',   'dashboardFull', {}, ADMIN,   80,  90000,  40,  5000],
  ['Dashboard (one team)',    'dashboardFull', {}, OFFICER, 60,  40000,  40,   400],
  ['Officer boards',          'officerBoards', {}, ADMIN,   50,  60000,  30,  5000],
  ['Defaulters Followup',     'followup',      {}, ADMIN,   10,  10000,  10, 10000],
  ['Expected Repayment',      'expectedDay',   { type: 'today' }, ADMIN, 10, 10000, 10, 10000],
  ['Loan Applications',       'loanPipeline',  {}, ADMIN,   10,  10000,  10, 10000],
  ['Promise to Pay',          'promises',      {}, ADMIN,   10,  10000,  10, 10000],
  /* A report over a date range must read that range -- there is no honest way to count a
     week's follow-up comments without them. It is already narrowed to the six columns it uses
     and to the window asked for; what is left is proportionate. The officer-scoped row below
     is the proof that the team narrowing works: a fortieth of the same report. */
  ['Follow-up report',        'followupReport', {}, ADMIN,  10,  30000,  10, 30000],
  ['Follow-up report (one team)', 'followupReport', {}, OFFICER, 10, 1500, 10, 1500],
  /* The one that was worst, and the one the Monday meeting is read from. Count 1-6 still reads
     two decks as customer rows -- it compares each PERSON's Monday arrears against their
     arrears at the end of the week, which no team total can answer -- so the row budget here
     stays above zero on purpose. Everything else on the report is a sum. */
  ['Weekly report',           'weekly',        {}, ADMIN,   45,  90000,  20,  3500],
  ['The bell',                'notifications', {}, ADMIN,    6,    200,   6,   200],
  ['The bell (one team)',     'notifications', {}, OFFICER,  6,    200,   6,   200],
];

/* Both worlds, every screen. `rpc: undefined` is a database where the migration has not been
   run: the fake answers "could not find the function", which is exactly what PostgREST says,
   and the code falls back to reading rows. */
const WORLDS = [
  ['migration not run yet', undefined, 4, 5],
  ['team-day totals', { rpc: SNAPSHOT_TOTALS_RPC }, 6, 7],
];

for (const [world, opts, tripIdx, rowIdx] of WORLDS) {
for (const B of BUDGETS) {
  const [label, fn, args, user] = B;
  const tripBudget = B[tripIdx], rowBudget = B[rowIdx];
  test(`speed [${world}]: ${label} stays within ${tripBudget} trips and ${rowBudget.toLocaleString()} rows`, async () => {
    const c = counting(bigBook(), opts);
    await portalApi(c.db, user, fn, args, NOW);
    const { trips, rows } = c.stat();
    const advice = `\n  Before raising these numbers: can the database do the work instead?\n` +
      `  Ordering, limiting, filtering and counting all belong there. If the answer is genuinely\n` +
      `  no, raise them in the SAME commit so the cost is visible in the diff.`;
    assert.ok(trips <= tripBudget,
      `${label} took ${trips} round trips (budget ${tripBudget}).` + advice);
    assert.ok(rows <= rowBudget,
      `${label} read ${rows.toLocaleString()} rows (budget ${rowBudget.toLocaleString()}) in ${trips} trips.` +
      `\n  A filtered read is ONE trip and can still drag a whole table.` + advice);
  });
}
}

/* THE PHONE IS THE WORST CONNECTION IN THE COMPANY, so its budgets are the tightest. Every one
   of these is a field officer standing in the sun on mobile data. */
const PHONE = [
  ['Calls: boot',        'api_callBoot',          ['DEV1'], 12,  5000],
  ['Calls: today list',  'api_callList',          ['DEV1', 'today'], 10, 6000],
  ['Calls: defaulters',  'api_callList',          ['DEV1', 'defaulters'], 10, 6000],
  ['Calls: one customer\'s comments', 'api_callComments', ['DEV1', 'R1'], 6, 200],
  /* The phone's search index. It used to read EVERY comment ever written to find the few
     hundred carrying a replacement phone number -- the portal's copy of this was fixed weeks
     ago and the phone's was not, which is why the app felt slower than the portal on the same
     data. */
  ['Calls: sync / search index', 'api_callSync',
    ['DEV1', [{ phone: '0712000001', date: '2026-07-24', ts: 1, duration: 60, outcome: 'CONNECTED' }]],
    20, 30000],
  ['Calls: the bell',    'api_callNotifications', ['DEV1'], 6,    200],
  /* The highest budget here, deliberately. HOPE Live works out the WHOLE dashboard -- the six
     figures on it are the dashboard's own figures, and computing them a second, cheaper way
     would be two answers that could disagree on a wall in front of the company.
     It is also the one screen nobody is waiting on: the figures are kept for two minutes per
     scope, so a display refreshing every twenty seconds pays this once every two minutes.

     35 -> 36 ON 2026-08-09, and the one trip is worth naming. It is the summary probe: a
     single count that sends NO ROWS, asking whether this database has any summary uploads at
     all, remembered for a minute per database and shared between the several totals questions
     a screen asks at once. On a deployment that never uses summaries that is the entire cost;
     on one that does, the summary rows are then read alongside the lists rather than instead
     of them.

     It bought a day being uploadable as the company's summary sheet when the full export was
     missed -- which is the difference between a report that is right and one that is a day
     behind. The first attempt cost FIVE trips; sharing the in-flight probe and folding the
     "which date" question into the same read as the rows took it to one. */
  ['HOPE Live widget',   'api_widget',            ['TEAM01'], 36, 60000],
];

for (const [label, fn, args, tripBudget, rowBudget] of PHONE) {
  test(`speed: ${label} stays within ${tripBudget} trips and ${rowBudget.toLocaleString()} rows`, async () => {
    const t = bigBook();
    t.call_users.push({ user_id: 'U1', name: 'JUMA G', team: TEAMS[0], role: 'OFFICER',
      device_id: 'DEV1', active: true });
    t.teams = t.teams.map(x => (x.team === TEAMS[0] ? { ...x, team_code: 'TEAM01' } : x));
    const c = counting(t);
    await callApi(c.db, fn, args, NOW);
    const { trips, rows } = c.stat();
    const advice = `\n  This one runs on a PHONE, on mobile data. Ask the database to do more before\n` +
      `  asking the handset to wait longer.`;
    assert.ok(trips <= tripBudget, `${label} took ${trips} round trips (budget ${tripBudget}).` + advice);
    assert.ok(rows <= rowBudget,
      `${label} read ${rows.toLocaleString()} rows (budget ${rowBudget.toLocaleString()}) in ${trips} trips.` + advice);
  });
}

test('speed: the bell reads a page, not a table', async () => {
  /* The specific mistake this guards. The bell shows sixty items; it used to read every
     complaint and every comment ever written -- measured at 204,000 rows and 40 MB against a
     real book -- to find them. The budget above catches the round trips; this catches the
     rows, because a single query that drags a whole table is one round trip and still wrong. */
  const c = counting(bigBook());
  await portalApi(c.db, OFFICER, 'notifications', {}, NOW);
  const { rows } = c.stat();
  assert.ok(rows <= 200, `the bell read ${rows.toLocaleString()} rows to show at most 60 items`);
});

/* =====================================================================================
   THE ONE THAT TURNED THE DATABASE RED.

     "Whenever we insist our field officers to use the app, postgres gets full red, i can't
      even upload report updates, we get delay errors and so on."

   The budget above bounds ONE sync. It could not see the real fault, which was that the
   phone index was rebuilt from scratch on EVERY sync -- the whole company book, per handset,
   every five minutes, all day. One request looked reasonable; three hundred of them were a
   full-book scan roughly once a second, and the uploads queued behind them.

   So this measures what the budget could not: the SECOND handset, and the three hundredth.
   ===================================================================================== */
test('speed: the phone index is built once and shared, not rebuilt per handset', async () => {
  const t = bigBook();
  for (let i = 1; i <= 12; i++) {
    t.call_users.push({ user_id: 'U' + i, name: 'OFF' + i, team: TEAMS[i % TEAMS.length],
      role: 'OFFICER', device_id: 'DEV' + i, active: true });
  }
  t.settings.push({ key: 'DATA_VERSION', value: '1000' });
  const c = counting(t);
  const sync = i => callApi(c.db, 'api_callSync',
    ['DEV' + i, [{ num: '0712000001', ts: Date.parse('2026-07-24T07:00:00Z') + i, dur: 60, outcome: 'CONNECTED' }]], NOW);

  await sync(1);
  const first = c.stat().rows;
  assert.ok(first > 1000, 'the first handset does build the index -- ' + first + ' rows');

  let before = c.stat().rows;
  for (let i = 2; i <= 12; i++) {
    await sync(i);
    const after = c.stat().rows;
    assert.ok(after - before < 100,
      `handset ${i} re-read ${after - before} rows to sync one call -- the index is not being shared. `
      + 'This is the exact regression that made the database unusable with the officers on it.');
    before = after;
  }

  /* AND IT MUST NOT GO STALE PAST AN UPLOAD. DATA_VERSION is stamped by api/upload.js, so a
     newly uploaded customer has to be matchable on the very next sync -- a cache that outlived
     an upload would quietly mark real portfolio calls as somebody else's. */
  c.db._dump('settings').find(r => r.key === 'DATA_VERSION').value = '2000';
  before = c.stat().rows;
  await sync(1);
  assert.ok(c.stat().rows - before > 1000,
    'an upload must force the index to rebuild on the next sync');
});

test('speed: opening the app is one wait, not ten', async () => {
  /* Three hundred handsets open this on the same Monday morning. Every round trip here is a
     connection held while they all do it, and they used to be taken strictly one after
     another -- the teams list, the device, five separate single-row settings reads, the
     teams table a second time for the rotation check. */
  const t = bigBook();
  t.call_users.push({ user_id: 'U1', name: 'JUMA G', team: TEAMS[0], role: 'OFFICER',
    device_id: 'DEV1', active: true });
  const c = counting(t);
  await callApi(c.db, 'api_callBoot', ['DEV1'], NOW);
  const { trips } = c.stat();
  assert.ok(trips <= 6, `boot took ${trips} round trips (budget 6). `
    + 'Settings belong in one `in` query and the teams table should be read once.');
});

test('speed: "amepigiwa leo" is read once per half-minute, not once per list', async () => {
  /* The second whole-table read on a hot path, and the one that gets WORSE as the day goes on:
     three hundred officers making fifty calls each is fifteen thousand rows of call_logs, and
     every list load from every handset dragged all of them. A system that is fine when it is
     tested and fails when it is busy. */
  const t = bigBook();
  for (let i = 1; i <= 6; i++) {
    t.call_users.push({ user_id: 'U' + i, name: 'OFF' + i, team: TEAMS[i], role: 'OFFICER',
      device_id: 'DEV' + i, active: true });
  }
  // An afternoon's worth of calls.
  for (let i = 0; i < 3000; i++) {
    t.call_logs.push({ id: 'L' + i, user_id: 'U1', phone: '07120' + String(i).padStart(5, '0'),
      duration: 60, call_date: '2026-07-24', portfolio: true });
  }
  const c = counting(t);
  await callApi(c.db, 'api_callList', ['DEV1', 'today'], NOW);
  const first = c.stat().rows;
  assert.ok(first > 2000, 'the first list does read the log -- ' + first + ' rows');

  let before = c.stat().rows;
  for (let i = 2; i <= 6; i++) {
    await callApi(c.db, 'api_callList', ['DEV' + i, 'today'], NOW);
    const after = c.stat().rows;
    assert.ok(after - before < 2000,
      `handset ${i} re-read ${after - before} rows -- the called-today set is not being shared, `
      + 'and this read grows all day as the officers work.');
    before = after;
  }
});
