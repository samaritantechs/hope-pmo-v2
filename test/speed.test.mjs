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
import { SNAPSHOT_TOTALS_RPC, UPLOAD_STATUS_RPC, LOAN_STAGE_RPC, STORAGE_USAGE_RPC } from './snapshot-totals-rpc.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');
const { callApi } = await import('../api/_lib/call-core.js');
const { loanApi } = await import('../api/_lib/loan-core.js');
const { USER_TABS } = await import('../api/_lib/auth.js');

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
  /* An RPC goes through the SAME wrapper a table read does, so `.range()` chains and each PAGE
     is counted where it is answered rather than where it is asked for. Counting at the call
     instead was what made a capability check -- one extra `db.rpc(...)` that was never sent --
     show up as a round trip nobody paid for. */
  return { db: { from: n => wrap(db0.from(n)),
                 rpc: (n, a) => wrap(db0.rpc(n, a)),
                 _dump: n => db0._dump(n) },
           stat: () => ({ trips, rows }) };
}

const ADMIN = { code: 'A', name: 'ADMIN', role: 'ADMIN', teams: null, tabs: ['settings', 'upload'] };
// Ticked for the ordinary screens -- see the note beside GMO in portal.test.mjs.
const OFFICER = { code: 'O', name: 'OFFICER', role: 'GMO', teams: [TEAMS[0]], tabs: USER_TABS.slice() };

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
  /* Back DOWN from the month-ledger raise (32 trips, 5,200 / 1,200 rows) when the month was
     retired to the chip, then 22 -> 24 trips for the PERFORMANCE STRIP: two more week-sized
     totals reads, because every percentage on the strip says which way it moved and movement
     needs LAST week. Week-sized aggregate calls are the question shape this database answers
     fastest; the row budgets stay at their week-only values because a totals week is a
     handful of per-team-per-day rows, never customers. */
  /* 24 -> 30 for the ORODHA'S MONTH COLUMNS -- "so that we always see today's performance
     and monthly progress". The month came back to the dashboard as percentages per team, off
     the same remembered ledger the month report fills: one settings row, week-sized aggregate
     slices, two trips each. The dashboard fills at most two slices per load (the live week
     and one frozen week -- DASH_MONTH_SLICES), so a cold month costs it four aggregate trips
     plus the ledger write, and a warm month two plus the write; this fixture is a cold July
     of four slices, measured at 29 / 28 trips -- 30 / 29 once the Orodha's Col column
     read the collection officers off their access codes, one small read. The rows move with it -- 5,000 -> 5,500 and
     400 -> 900 -- because the ledger is ONE SHARED STORE, filled unscoped by whoever loads
     first so that an admin and a one-team officer read the same month: a slice is every
     team's per-day totals (~180 aggregate rows on this 40-team book), never a customer row,
     and the officer's screen pays for the company's slice the same as the admin's does.
     Measured at 5,072 / 753.

     THIRTY-ONE, AND THE THIRTY-FIRST IS THE ONE THAT PAYS FOR THE OTHERS. The cached deck
     totals ask ONE small read -- which days are built -- before serving any team-day question
     from a small table instead of aggregating a hundred and ten thousand deck rows. It is asked
     once per process per minute and shared by every question asked together, so in the field it
     is not one per dashboard at all; a fixture builds a fresh database per call, so here it
     shows as exactly one. Raised deliberately: one index read to skip several multi-second
     aggregates is the trade this whole change is, and it belongs in the diff.

     THIRTY-TWO, AND THE THIRTY-SECOND IS ILIYONASIA -- "the col% of excels and our system
     differ ... he is worried we are not including iliyonasia in collected". He was right, and
     the reason is that the register was applied on the weekly report and the leader reports
     and nowhere else, so this screen's Col % and that report's Col % were two answers to one
     question.

     ONE trip, not two, and the difference is the point. This screen asks for the register
     twice -- once for its own figures, once inside buildDashboard -- and the first version of
     the change paid for both. It is now read WHOLE and memoised per database client for a
     minute (see adjustments.js), so a second caller in the same request pays nothing, and in
     the field one read serves every screen and every handset behind it for that minute. A
     fixture builds a fresh database per call, so here it shows as exactly one.

     Could the database do it instead? It already is -- what comes back is the answer, not a
     book to sift: a hand-typed register of tens of rows, config-sized like `settings` and
     `teams`, which are memoised in exactly the same way and for exactly the same reason. The
     row budgets below are untouched because it adds no measurable rows. */
  ['Dashboard (all teams)',   'dashboardFull', {}, ADMIN,   80,  90000,  32,  5500],
  ['Dashboard (one team)',    'dashboardFull', {}, OFFICER, 60,  40000,  31,   900],
  ['Officer boards',          'officerBoards', {}, ADMIN,   50,  60000,  30,  5000],
  ['Defaulters Followup',     'followup',      {}, ADMIN,   10,  10000,  10, 10000],
  ['Expected Repayment',      'expectedDay',   { type: 'today' }, ADMIN, 10, 10000, 10, 10000],
  ['Loan Applications',       'loanPipeline',  {}, ADMIN,   10,  10000,  10, 10000],
  /* THE TAB, AS THE TAB ACTUALLY LOADS IT. The three answers on this screen -- the month's
     widgets, the day's list, the week by team -- each read the whole applications book for
     itself, in parallel, which is what put it past the client's 45 seconds. They come from the
     same rows, so the tab reads them once. Two trips: the loans book and the small teams list.
     A budget here is the only thing that stops that being undone by somebody (me) adding a
     fourth question to the screen without counting what it already asks for. */
  ['Applications tab',        'appsTab',       {}, ADMIN,    4,  20000,   4, 20000],
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
  ['Weekly report',           'weekly',        {}, ADMIN,   45,  90000,  14,  3500],
  ['The bell',                'notifications', {}, ADMIN,    6,    200,   6,   200],
  ['The bell (one team)',     'notifications', {}, OFFICER,  6,    200,   6,   200],
  /* =====================================================================================
     EVERY REMAINING NAV, SO "ALL NAVS" IS A CEILING RATHER THAN A PROMISE.
     =====================================================================================
       "the postgress war should check efficiency in all navs existing"
       "Slow speed is almost everywhere thats why i said all navs"

     Two thirds of the sidebar had no budget at all, which is how a screen gets slowly worse
     with nothing turning red. These numbers are what each one MEASURES on this fixture today,
     rounded up a little -- a ceiling, not a target. Raising one is allowed in the same commit
     as the change that needs it, with the reason in the diff, and the first question is always
     "can the database do this instead of me?".

     They will not catch a throttled instance, and nothing here can: when arithmetic with no
     table behind it takes ten seconds, every screen is slow whatever its shape. What they DO
     catch is the thing I did to the Applications tab -- three full reads of one table where
     one would do -- which is the only part of "slow everywhere" that is mine to fix. */
  ['Leader reports',          'leaderReports',       {}, ADMIN, 24, 26000, 20, 4500],
  ['Month report',            'monthReport',         {}, ADMIN, 16,  5000, 22, 5500],
  ['Credit analysts',         'credit',              {}, ADMIN, 14,  4000, 12, 4200],
  ['Expected defaulters',     'expectedDefaulters',  {}, ADMIN,  6,  1000,  6, 1000],
  ['Rotation report (expdf)', 'expdfReport',         {}, ADMIN, 10,  1500,  9, 1200],
  ['Assignments',             'assignments',         {}, ADMIN,  8,  3000,  8, 3000],
  ['Portfolio at Risk',       'par',                 {}, ADMIN,  5,   800,  5,  800],
  ['Complaints',              'complaints',          {}, ADMIN,  4,   800,  4,  800],
  ['Restructures',            'restructures',        {}, ADMIN,  6,   200,  6,  200],
  ['Demand notices (legal)',  'demandNotices',       {}, ADMIN,  6,   800,  6,  800],
  ['Abnormal payments',       'abnormal',            {}, ADMIN,  6,  2500,  6, 2500],
  ['Calls report',            'callReport',          {}, ADMIN,  6,   200,  6,  200],
  ['Teams & Staff',           'teams',               {}, ADMIN,  5,   200,  5,  200],
  ['Access codes (Settings)', 'accessCodes',         {}, ADMIN,  5,   100,  5,  100],
  ['Best of / Rekodi',        'perfHistory',         {}, ADMIN,  3,   100,  3,  100],
  ['Audit log',               'auditLog',            {}, ADMIN,  3,   100,  3,  100],
  /* THE TWO "error 504"s THIS GUARD WOULD HAVE CAUGHT ON DAY ONE. smsGaps and smsExport used
     to each read the whole defaulter book on their own -- a plain download paid for it once,
     "Save & download" in the gap-fill form paid for it TWICE in the same click -- and nothing
     in this file was watching, because nothing here measured the SMS export at all. Both are
     one fetch of the book now (smsBuild_ in portal-core.js); these numbers are what that
     actually costs on a 40-team, 3,500-defaulter book, with a little headroom -- if a future
     change pushes past them, that is this guard doing its job, not a nuisance to raise blindly. */
  ['SMS export (defaulters)',   'smsExport', { audience: 'defaulters' }, ADMIN, 8, 2000, 6, 2000],
  ['SMS export (portfolio)',    'smsExport', { audience: 'portfolio' }, ADMIN, 10, 15000, 8, 15000],
  ['SMS gaps (portfolio)',      'smsGaps',   { audience: 'portfolio' }, ADMIN, 10, 15000, 8, 15000],
  /* THE READ THAT HUNG THE SETTINGS TAB AND, ON A BAD NIGHT, THE DATABASE UNDER IT. The old
     fallback downloaded every row of eleven tables just to count them -- on this fixture alone
     that was ~45,000 rows for one click of Settings, and on the live book it was the click that
     kept a throttled instance pinned down. Now: with the function, one grouped call; without
     it, eleven HEAD counts that move NO rows. The row budgets are the whole point here.
     (Migrated world is more than one trip because a source with no rows at all answers the
     function with silence, and silence gets one HEAD count to confirm empty-vs-unknown.) */
  ['Storage panel (Settings)',  'storageUsage', {}, ADMIN, 14, 100, 8, 800],
  /* THE FOUR HEAVIEST SCREENS, WHICH HAD NO GUARD AT ALL UNTIL COMMISSION STOPPED OPENING.
     Measured on a live-scale book -- 18,000 defaulter rows per deck-date, the real figure --
     commission pulled 127,644 customer rows in 24 trips and blew the client's 45-second
     deadline. Nothing in this file was watching it, so it grew until a person reported it.

     These budgets are set a little above what each costs TODAY, so they are a ceiling that
     catches growth rather than a target. Commission's is deliberately generous and still far
     too high to be comfortable: it is here to stop the bleeding while the real fix (moving the
     per-customer arrears comparison into the database, the way the team-day totals already
     went) is decided. Lowering this number is the goal, not raising it. */
  ['Commission',              'commission',     {}, ADMIN, 30, 140000, 30, 140000],
  ['Promise to Pay (report)', 'promises',       {}, ADMIN, 16, 100000, 16, 100000],
  ['Follow-up report (big)',  'followupReport', {}, ADMIN, 14,  85000, 14,  85000],
  ['Credit book',             'credit',         {}, ADMIN, 16,  80000, 16,  80000],
];

/* Both worlds, every screen. `rpc: undefined` is a database where the migration has not been
   run: the fake answers "could not find the function", which is exactly what PostgREST says,
   and the code falls back to reading rows. */
const WORLDS = [
  ['migration not run yet', undefined, 4, 5],
  /* The migrated world means EVERY migration, not just the totals: the pipeline funnel's eight
     counts collapse into one grouped call the same way the team-day sums do, and a budget that
     leaves that out is measuring a deployment nobody is running. */
  ['team-day totals', { rpc: { ...SNAPSHOT_TOTALS_RPC, ...LOAN_STAGE_RPC, ...STORAGE_USAGE_RPC } }, 6, 7],
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
  /* One trip tighter since the OFFICER/LEADER short-circuit: a plain handset no longer pays
     a settings read per list load to ask what the PMO role is called. Moved DOWN on purpose --
     a budget that quietly grows back is the failure this file exists to stop. */
  ['Calls: today list',  'api_callList',          ['DEV1', 'today'], 9, 6000],
  ['Calls: defaulters',  'api_callList',          ['DEV1', 'defaulters'], 9, 6000],
  ['Calls: one customer\'s comments', 'api_callComments', ['DEV1', 'R1'], 6, 200],
  /* The phone's search index. It used to read EVERY comment ever written to find the few
     hundred carrying a replacement phone number -- the portal's copy of this was fixed weeks
     ago and the phone's was not, which is why the app felt slower than the portal on the same
     data. */
  ['Calls: sync / search index', 'api_callSync',
    ['DEV1', [{ phone: '0712000001', date: '2026-07-24', ts: 1, duration: 60, outcome: 'CONNECTED' }]],
    20, 30000],
  /* THE PHONE'S SUMMARY STRIP, WHICH HAD NO BUDGET AT ALL, AND COSTS THIRTY TRIPS.
     Adding the Iliyonasia read is what made me measure it, and the number is worth writing
     down plainly rather than burying: TWENTY-NINE before this change, THIRTY after. ONE of
     those thirty is mine. The other twenty-nine were already there with nothing watching them.

     The bar shows TWO collection figures -- today's, out of buildDashboard, and the week's,
     which is its own read -- and both take the register, because a bar that contradicts itself
     in front of three hundred officers is worse than the fault being fixed. That is two
     callers and one trip: the register is read whole and memoised per database client, so the
     second caller pays nothing. Behind that sit summaryCache with its single flight and
     cachedAnswer, both of which exist because forty handsets on a scope used to run this side
     by side -- so thirty trips is thirty per scope per refresh, not thirty per officer.

     A number that goes UP here is a number to argue about before it ships, not after. */
  ['Calls: daily summary', 'api_callDailySummary', ['DEV1'], 30, 40000],
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

/* =====================================================================================
   THE PANEL THAT STOPPED THE UPLOADS IT WAS THERE TO HELP WITH.

     "i can't even upload report appdates we get delay errors and so on"

   The upload page's "what is already in?" panel read FOUR WHOLE TABLES with no date filter --
   every expected row, every defaulter row, every payment and every call ever recorded -- to
   answer a question about ONE DAY, on the page whose entire job is to accept an upload.

   Not one of those rows was ever shown: every figure on it is a count or a maximum. Both
   budgets below are deliberately far below the size of the book they run against, so a return
   to reading rows fails here instead of in the field on a Monday morning.
   ===================================================================================== */
const UPLOADER = { code: 'U', name: 'UPLOADER', role: 'ADMIN', teams: null, tabs: ['settings', 'upload'] };

function yearOfHistory() {
  const t = bigBook();
  const day = i => new Date(Date.parse('2026-07-24') - i * 86400000).toISOString().slice(0, 10);
  for (let d = 7; d < 120; d++) {
    for (let i = 0; i < 500; i++) {
      t.repayment_snapshots.push({ ref: 'H' + i, team: TEAMS[i % 40], payment_expected: 1000,
        todays_status: 'PAID', arrears: 0, snapshot_type: 'today', snapshot_date: day(d),
        upload_batch: 'h' + d, created_at: day(d) + 'T04:00:00Z' });
    }
  }
  for (let i = 0; i < 30000; i++) {
    t.call_logs.push({ id: 'CL' + i, user_id: 'U' + (i % 300), phone: '0712',
      duration: 60, call_date: day(i % 120) });
  }
  return t;
}

test('speed: the upload panel asks the database to count, instead of reading the book', async () => {
  const t = yearOfHistory();
  const total = t.repayment_snapshots.length + t.defaulter_snapshots.length + t.call_logs.length;
  const c = counting(t, { rpc: UPLOAD_STATUS_RPC });
  const d = await portalApi(c.db, UPLOADER, 'uploadStatus', {}, NOW);
  const { trips, rows } = c.stat();
  assert.equal(d.lifetime, true, 'with the migration it reports real lifetime totals');
  assert.ok(trips <= 3, `uploadStatus took ${trips} round trips (budget 3) -- it is a count, not a read`);
  assert.ok(rows <= 60,
    `uploadStatus read ${rows.toLocaleString()} rows out of a book of ${total.toLocaleString()}. `
    + 'Every figure on that panel is a count or a maximum; none of them needs a customer row.');
});

test('speed: without the migration the upload panel still reads ONE DAY, never the book', async () => {
  /* Migrations here are run by hand, so between a deploy and that being done this page still
     has to work -- but it must never go back to reading everything. It answers from the chosen
     day and reports the lifetime totals as unknown, which is the honest trade. */
  const t = yearOfHistory();
  const total = t.repayment_snapshots.length + t.defaulter_snapshots.length + t.call_logs.length;
  const c = counting(t);                       // no rpc -- the un-migrated world
  const d = await portalApi(c.db, UPLOADER, 'uploadStatus', {}, NOW);
  const { rows } = c.stat();
  assert.equal(d.lifetime, false);
  assert.ok(d.note && /2026-08-10-upload-status/.test(d.note), 'and says which file to run');
  assert.ok(rows < total / 10,
    `the fallback read ${rows.toLocaleString()} of ${total.toLocaleString()} rows -- it must read `
    + 'the chosen day only, not the whole book.');
});

test('speed: calls-per-officer is counted by the database, not by reading every call', async () => {
  const t = yearOfHistory();
  t.call_users.push({ user_id: 'U1', name: 'JUMA G', team: TEAMS[0], role: 'OFFICER', device_id: 'DEV1', active: true });
  const c = counting(t, { rpc: UPLOAD_STATUS_RPC });
  await portalApi(c.db, UPLOADER, 'callUsers', {}, NOW);
  const { rows } = c.stat();
  assert.ok(rows <= 400,
    `callUsers read ${rows.toLocaleString()} rows. call_logs grows forever -- 300 officers at `
    + 'fifty calls a day is five and a half million a year, and counting them here read all of it.');
});

test('speed: an officer does not download forty teams of abnormal payments to read one', async () => {
  /* listTable feeds Abnormal Payments, Restructures and Demand Notices. It read the WHOLE
     table and discarded what the viewer may not see -- on tables that only ever grow. */
  const t = bigBook();
  for (let i = 0; i < 4000; i++) {
    t.abnormal_payments.push({ id: 'A' + i, team: TEAMS[i % 40], paid: 1234,
      ref_no: 'R' + i, customer_name: 'C' + i, created_at: '2026-07-20T08:00:00Z' });
  }
  const c = counting(t);
  const d = await portalApi(c.db, OFFICER, 'abnormal', {}, NOW);
  const { rows } = c.stat();
  assert.equal(d.count, 100, 'one team of the forty -- the same answer as before');
  assert.ok(rows <= 400,
    `an officer read ${rows.toLocaleString()} rows to see ${d.count}. Team scoping belongs in `
    + 'the query, not in a filter after the whole table has crossed the wire.');
});

test('scoping abnormal payments at the database keeps EXACTLY the rows it kept before', async () => {
  /* The optimisation must not change the answer. A row with NO team is the case that could
     have gone wrong: teamAllowed() rejects it for a scoped user, so an `in` filter that drops
     it agrees -- but an ALL-teams admin must still see it. */
  const t = bigBook();
  t.abnormal_payments.push({ id: 'N1', team: null, paid: 500, ref_no: 'NOTEAM', created_at: '2026-07-20T08:00:00Z' });
  t.abnormal_payments.push({ id: 'T1', team: TEAMS[0], paid: 700, ref_no: 'MINE', created_at: '2026-07-20T08:00:00Z' });
  const asOfficer = await portalApi(fakeDb(t), OFFICER, 'abnormal', {}, NOW);
  assert.deepEqual(asOfficer.rows.map(r => r.ref_no), ['MINE'], 'a team-less row is not theirs');
  const asAdmin = await portalApi(fakeDb(t), ADMIN, 'abnormal', {}, NOW);
  assert.equal(asAdmin.rows.length, 2, 'but the admin still sees it -- nothing is lost from the table');
});

/* =====================================================================================
   THE WHOLE-SYSTEM GUARD, AND THE REASON IT EXISTS.

     "i expect to - fungua mfumo, did that ... and its my most fear"

   Opening the system means every officer in the company can reach every screen they are
   entitled to, at the same time, on a Monday morning. The individual budgets above bound the
   screens somebody thought to measure. This bounds ALL OF THEM, and it bounds the one thing
   that actually decides whether opening the door is safe:

       HOW MUCH DOES ONE ORDINARY OFFICER READ?

   An officer holds ONE team of forty. Every screen they open should therefore read roughly a
   fortieth of the book. Where it reads the whole book instead, the cause is always the same
   mistake -- fetch everything, filter in JavaScript -- and it is invisible in testing because
   a fortieth and a whole are the same number when there is only one team in the fixture.

   That mistake was found on FIVE endpoints at once by measuring exactly this, and the tell was
   unmistakable: the officer read the identical number of rows as the admin.

   THIS TEST SWEEPS EVERY READ-ONLY PORTAL FUNCTION. A new screen is covered the day it is
   added, without anybody remembering to add it here. If it trips, the fix is virtually never
   to raise the ceiling -- it is to put the team filter in the query.
   ===================================================================================== */
const ONE_TEAM = { code: 'O', name: 'REC TEAM01', role: 'GMO', teams: [TEAMS[0]], tabs: [] };
const OFFICER_ROW_CEILING = 4000;

/* Functions that CHANGE something. A speed sweep must not fire them, and their cost is not a
   read cost anyway. Everything not named here is swept. */
const WRITERS = new Set(['addComment', 'addComplaint', 'saveComplaint', 'resolveComplaint',
  'deleteComplaint', 'addRestructure', 'decideRestructure', 'addDemandNotice', 'saveTeam',
  'deleteTeam', 'saveRole', 'deleteRole', 'saveCallAgent', 'settingSet', 'settingDelete',
  'systemOpenSet', 'saveAccessCode', 'deleteAccessCode', 'commissionSave', 'saveStaffTeams',
  'purgeSnapshots', 'cleanFollowup', 'removeCallUser', 'changeMyCode', 'fuStatusesSave',
  'stampWeek', 'teamsImport', 'purgeSuperseded', 'retireUploads', 'saveHint', 'deleteHint',
  'rotateAccessCode', 'saveSettings', 'announcementSave', 'demandMessage']);

test('speed: NO screen lets one officer read the whole company book', async () => {
  const { PORTAL_FUNCTIONS } = await import('../api/_lib/portal-core.js');
  const worst = [];
  for (const fn of PORTAL_FUNCTIONS) {
    if (WRITERS.has(fn)) continue;
    const c = counting(bigBook(), { rpc: { ...SNAPSHOT_TOTALS_RPC, ...UPLOAD_STATUS_RPC } });
    try { await portalApi(c.db, ONE_TEAM, fn, {}, NOW); }
    catch (e) { continue; }                    // not permitted, or needs arguments -- not a read
    worst.push({ fn, rows: c.stat().rows });
  }
  worst.sort((a, b) => b.rows - a.rows);
  const over = worst.filter(w => w.rows > OFFICER_ROW_CEILING);
  assert.deepEqual(over, [],
    'These screens read more than ' + OFFICER_ROW_CEILING.toLocaleString() + ' rows for an officer '
    + 'who holds ONE team of forty:\n  '
    + over.map(w => w.fn + ' -- ' + w.rows.toLocaleString() + ' rows').join('\n  ')
    + '\n\n  Almost certainly a read that fetches every team and filters in JavaScript.'
    + '\n  The fix is `onTeams(q, user.teams)` in the QUERY, not a bigger number here.');
});

test('speed: an officer and an admin must NOT read the same amount', async () => {
  /* The tell. When a one-team officer reads exactly what an all-teams admin reads, the team
     filter is not in the query -- and that is true however small the test fixture is, which is
     what makes it a better check than any absolute number. Only screens with a meaningfully
     team-shaped book are compared; a settings list is the same for everybody by design. */
  const { PORTAL_FUNCTIONS } = await import('../api/_lib/portal-core.js');
  const ALL_TEAMS = { code: 'A', name: 'ADMIN', role: 'ADMIN', teams: null, tabs: ['settings', 'upload'] };
  const same = [];
  for (const fn of PORTAL_FUNCTIONS) {
    if (WRITERS.has(fn)) continue;
    const run = async user => {
      const c = counting(bigBook(), { rpc: { ...SNAPSHOT_TOTALS_RPC, ...UPLOAD_STATUS_RPC } });
      try { await portalApi(c.db, user, fn, {}, NOW); } catch (e) { return null; }
      return c.stat().rows;
    };
    const [o, a] = [await run(ONE_TEAM), await run(ALL_TEAMS)];
    if (o == null || a == null) continue;
    if (a >= 2000 && o === a) same.push(fn);    // only where there is a real book to narrow
  }
  assert.deepEqual(same, [],
    'These screens read exactly as much for a ONE-TEAM officer as for an ALL-TEAMS admin, '
    + 'which means the team filter is not in the query:\n  ' + same.join('\n  '));
});

/* =====================================================================================
   A WEEK OF DECKS, EACH UPLOADED ON ITS OWN DAY -- STILL TRUE FOR 'initial' BASELINES.
   =====================================================================================
   Resolving the deck date per team AND per weekday is what finally made every defaulter
   visible without waiting on a re-upload. It also changed the read's shape: it used to resolve
   to one or two distinct dates and now resolves to one per distinct upload day -- six or seven
   in a normal week.

   'current' no longer takes this path at all -- "one file, all weekdays together, every time"
   -- see defaulterBook's own comment in portal-core.js and the test just below this one. But a
   baseline is not re-uploaded on a defaulter's cadence, so 'initial' still needs exactly this
   protection, and this is the fixture that would notice if the mechanism itself broke: six
   weekdays, every one uploaded on a different day, across forty teams. The trip budget is what
   catches somebody later deciding to read each team separately, and the row budget is what
   catches a read that stops narrowing by weekday and drags the whole window.

   It is also why the loop is sequential. Six requests in flight per screen, times the several
   these screens each fire, times two hundred handsets, is the concurrency that exhausted the
   connection pool the last time it was tried. */
test('speed: a week of INITIAL decks on six different upload dates stays within 20 trips and 40,000 rows', async () => {
  const WDS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const DATES = ['2026-07-24', '2026-07-23', '2026-07-22', '2026-07-21', '2026-07-20', '2026-07-17'];
  const rows = [];
  let n = 0;
  for (let w = 0; w < WDS.length; w++) {
    for (const team of TEAMS) {
      for (let i = 0; i < 40; i++) {
        rows.push({ id: 'd' + (++n), ref: 'R' + n, full_name: 'C' + n, team,
          status: 'Defaulter', arrears: 1000, ds: '2-4',
          snapshot_type: 'initial', snapshot_date: DATES[w], weekday: WDS[w],
          upload_batch: 'b' + w, created_at: DATES[w] + 'T06:00:00Z' });
      }
    }
  }
  const c = counting({ ...bigBook(), defaulter_snapshots: rows },
    { rpc: { ...SNAPSHOT_TOTALS_RPC, ...UPLOAD_STATUS_RPC } });
  const out = await portalApi(c.db, ADMIN, 'defaulters', { type: 'initial' }, NOW);
  const s = c.stat();

  assert.equal(out.rows.length, rows.length,
    `every deck must come back whole: ${out.rows.length} of ${rows.length}`);
  assert.equal(new Set(out.rows.map(r => r.weekday)).size, 6,
    'all six weekdays, each read at its own date');
  assert.ok(s.trips <= 20, `${s.trips} trips for six dates -- one per date, not one per team`);
  assert.ok(s.rows <= 40000, `${s.rows} rows -- the weekday narrowing has stopped working`);
});

/* =====================================================================================
   CURRENT DEFAULTERS: THE SAME SPREAD-ACROSS-THE-WEEK SHAPE READS AS ONE DATE, CHEAPLY.
   =====================================================================================
   The mirror image of the test above, same fixture shape, 'current' instead of 'initial'.
   Only the single latest date's rows (Monday's, here) come back -- the older five weekdays'
   rows are leftovers from before "one whole-company file, every time" and must not resurrect
   a paid-off customer's team. This also costs far less: no deckDatesPerTeam round trip at all,
   just the one date lookup and the one page of rows on it. */
test('speed: CURRENT defaulters read the single latest date only, and cheaply', async () => {
  const WDS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const DATES = ['2026-07-24', '2026-07-23', '2026-07-22', '2026-07-21', '2026-07-20', '2026-07-17'];
  const rows = [];
  let n = 0;
  for (let w = 0; w < WDS.length; w++) {
    for (const team of TEAMS) {
      for (let i = 0; i < 40; i++) {
        rows.push({ id: 'd' + (++n), ref: 'R' + n, full_name: 'C' + n, team,
          status: 'Defaulter', arrears: 1000, ds: '2-4',
          snapshot_type: 'current', snapshot_date: DATES[w], weekday: WDS[w],
          upload_batch: 'b' + w, created_at: DATES[w] + 'T06:00:00Z' });
      }
    }
  }
  const c = counting({ ...bigBook(), defaulter_snapshots: rows },
    { rpc: { ...SNAPSHOT_TOTALS_RPC, ...UPLOAD_STATUS_RPC } });
  const out = await portalApi(c.db, ADMIN, 'defaulters', {}, NOW);
  const s = c.stat();

  const mondayRows = TEAMS.length * 40;
  assert.equal(out.rows.length, mondayRows,
    `only today's whole-company upload counts: ${out.rows.length} of ${mondayRows}`);
  assert.equal(new Set(out.rows.map(r => r.weekday)).size, 1, 'today\'s one weekday, not all six');
  assert.ok(s.trips <= 6, `${s.trips} trips -- no per-team-per-weekday lookback needed any more`);
});

/* =====================================================================================
   THE ROLE MAP IS ONE READ FOR THE WHOLE COMPANY, NOT ONE PER SCREEN.
   =====================================================================================
   Widening a credit analyst to the teams they hold meant looking their name up in the teams
   table's role columns -- on EVERY list load, from every handset. Two hundred phones opening
   Leo, Kesho and Def through a morning is thousands of reads of a table whose answer is
   identical for all of them and changes when somebody is reassigned, which is not often and
   never in the middle of a Monday.

   Worse, callRoleKind then read the very same columns AGAIN on the same request to decide the
   narrowing -- two reads of one small table to answer two halves of one question.
   ===================================================================================== */
test('speed: the second handset does not re-read the teams role columns', async () => {
  const t = bigBook();
  t.teams = t.teams.map((x, i) => ({ ...x, credit: i === 0 ? 'ANALYST A' : null }));
  t.call_users = [
    { user_id: 'u1', device_id: 'DEV1', name: 'ANALYST A', team: TEAMS[0], role: 'OFFICER', is_leader: false },
    { user_id: 'u2', device_id: 'DEV2', name: 'ANALYST A', team: TEAMS[0], role: 'OFFICER', is_leader: false },
  ];
  const c = counting(t, { rpc: { ...SNAPSHOT_TOTALS_RPC, ...UPLOAD_STATUS_RPC } });

  await callApi(c.db, 'api_callList', ['DEV1', 'defaulters'], NOW);
  const first = c.stat().trips;
  await callApi(c.db, 'api_callList', ['DEV2', 'defaulters'], NOW);
  const second = c.stat().trips - first;

  /* The SECOND handset is the one that shows it. The first pays for the map; every other
     handset in the same minute rides on it, and the scope widening plus the role narrowing
     between them cost nothing extra at all. */
  assert.ok(second <= first, `the second handset cost more than the first: ${second} vs ${first}`);
  assert.ok(second <= 6, `${second} trips for a warm handset -- the role map is being re-read`);
});

/* =====================================================================================
   HOPE LOAN'S OWN BUDGETS.
   =====================================================================================
   A second system on the same deployment is a second system on the same connection pool, so
   it gets the same discipline rather than a pass for being new. These are the screens an
   admin opens while HOPE PMO is carrying three hundred officers, and every one of them is a
   filtered read on its own schema with a stated ceiling.

   The budgets are deliberately tight -- most of these screens are ONE query -- because that is
   what they cost today and the point of writing it down is to notice the day one of them
   stops being one query. */
const LOAN_ADMIN = { code: 'A', name: 'ADMIN', role: 'ADMIN', teams: null, tabs: ['settings', 'upload'] };

/** A sandbox with enough in it that a careless read shows up: 400 customers, 400 loans spread
    across every stage, 400 payments. Small next to the real book on purpose -- a read whose
    SHAPE is wrong is wrong at any size, and these tables are meant to stay modest. */
function loanBook() {
  const stages = ['unassigned', 'assigned', 'unassessed', 'pending_approval', 'approved', 'disbursed', 'funded'];
  return {
    customers: Array.from({ length: 400 }, (_, i) => ({
      id: 'c' + i, docket: '9-190-' + String(i).padStart(6, '0'),
      full_name: 'CUSTOMER ' + i, mobile: '7' + String(10000000 + i), team: TEAMS[i % 40],
    })),
    loans: Array.from({ length: 400 }, (_, i) => ({
      id: 'l' + i, customer_id: 'c' + i, loan_id: '9190' + String(i).padStart(6, '0') + '1',
      docket_no: '9-190-' + String(i).padStart(6, '0'), full_name: 'CUSTOMER ' + i,
      team: TEAMS[i % 40], stage: stages[i % stages.length], track_no: '1',
      requested_amt: 300000, team_recomm: 300000, principal_amt: 300000, net_disbursed: 300000,
    })),
    payment_imports: Array.from({ length: 400 }, (_, i) => ({
      id: 'p' + i, batch: 'PAY-1', ref: '9190' + String(i).padStart(6, '0') + '1',
      amount: 34000, imported_at: '2026-08-18T09:00:00Z',
    })),
    complaints: [], reversals: [], disbursement_windows: [], carriers: [],
    manual_adjustments: [], assessments: [], guarantors: [], loan_events: [],
  };
}

/* [label, fn, args, trips, rows] -- rows counts what came BACK, so a filtered read that still
   drags the whole table is caught even though it is only one trip. */
const LOAN_BUDGETS = [
  ['pipelineSummary', 'pipelineSummary', {}, 3, 900],
  ['managerQueue', 'managerQueue', {}, 2, 400],
  ['teamQueue', 'teamQueue', {}, 2, 400],
  ['creditQueue', 'creditQueue', {}, 2, 400],
  ['seniorQueue', 'seniorQueue', { tier: 'gmo' }, 2, 400],
  ['disburseQueue (+window)', 'disburseQueue', {}, 3, 400],
  ['financeBankReport (+window)', 'financeBankReport', {}, 3, 400],
  ['reversalsList', 'reversalsList', {}, 3, 400],
  ['paymentsList', 'paymentsList', {}, 2, 500],  // capped in the query, never the whole table
  ['complaintsList', 'complaintsList', {}, 2, 100],
  ['carriersList', 'carriersList', {}, 2, 100],
  /* THE SEARCH IS THE ONE THAT MATTERS. It used to read the WHOLE customers table and filter
     in JavaScript; the row budget here is what makes that impossible to reintroduce quietly --
     400 customers exist and a search may bring back at most a capped handful. */
  ['csSearch', 'csSearch', { q: 'CUSTOMER 7' }, 2, 30],
];

for (const [label, fn, args, tripBudget, rowBudget] of LOAN_BUDGETS) {
  test(`speed [hopeloan]: ${label} stays within ${tripBudget} trips and ${rowBudget} rows`, async () => {
    const c = counting(loanBook());
    await loanApi(c.db, LOAN_ADMIN, fn, args);
    const { trips, rows } = c.stat();
    assert.ok(trips <= tripBudget, `${label} took ${trips} round trips (budget ${tripBudget}).`);
    assert.ok(rows <= rowBudget, `${label} read ${rows} rows (budget ${rowBudget}).`
      + '\n  A filtered read is ONE trip and can still drag a whole table.');
  });
}

/* REGISTRATION MUST NOT COST A TABLE SCAN. nextSerial used to page the whole customers table
   simply to length it -- one request per thousand rows, on every single registration, to learn
   a number Postgres already knows. It is a head-only count now, and this is what keeps it one. */
test('speed [hopeloan]: registering a customer does not scan the customers table', async () => {
  const c = counting(loanBook());
  await loanApi(c.db, LOAN_ADMIN, 'csRegister',
    { full_name: 'NEW PERSON', mobile: '0715000123', team: TEAMS[0], amount: 300000 });
  const { rows } = c.stat();
  assert.ok(rows <= 20, `registration read ${rows} rows -- the serial is scanning the table again`);
});
