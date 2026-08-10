/* THE SUMS MOVED INTO THE DATABASE, AND NOT ONE FIGURE CHANGED.
 *
 * The Dashboard, the Weekly report and the Presentation are pure arithmetic over the week's
 * snapshots. They used to fetch every row -- about 161,000 on this book -- into the web
 * server's memory and add them up there. That is what produced the HTTP 504s and what was
 * consuming three-quarters of the hosting plan's memory allowance.
 *
 * db/migrations/2026-08-05-snapshot-totals.sql moves the adding up into Postgres: one row per
 * team, per day, per upload batch. Roughly two hundred rows for the same answer.
 *
 * THAT IS A TERRIFYING CHANGE TO MAKE TO A SYSTEM WHOSE WHOLE VALUE IS ITS NUMBERS. So this
 * file computes every one of those screens BOTH WAYS over the same book --
 *
 *    with the migration:      the database groups and sums (test/snapshot-totals-rpc.mjs,
 *                             the SQL transcribed clause for clause)
 *    without the migration:   the rows are read and folded here, exactly as before
 *
 * -- and asserts the two answers are IDENTICAL, field for field, to the shilling. Not "close",
 * not "the totals agree": deepEqual over the entire response, every team row, every trend day,
 * every percentage, every note.
 *
 * The two sides are deliberately separate pieces of arithmetic. If they called the same
 * function the comparison would prove nothing.
 *
 * It also runs on a WEEKDAY and at the WEEKEND, because the dashboard changes shape between
 * them -- a weekday reads one snapshot, the weekend reads five and pairs five decks -- and a
 * test that only ever ran on a Friday would leave half the code unchecked.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';
import { SNAPSHOT_TOTALS_RPC } from './snapshot-totals-rpc.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');
const { callApi, _clearSummaryCache } = await import('../api/_lib/call-core.js');
const { buildDashboard } = await import('../api/_lib/dashboard-core.js');
const { foldExpected, foldDefaulter, expectedTotalsLatest, expectedTotalsInRange,
        defaulterTotalsLatest, tExpected, tCollected, tArrears }
  = await import('../api/_lib/snapshot-totals.js');
const { collectedOf, uncollectedOf, num } = await import('../api/_lib/recovery.js');

const FRIDAY = Date.parse('2026-07-24T09:00:00Z');   // Friday, midday EAT
const SUNDAY = Date.parse('2026-07-26T09:00:00Z');   // the weekend, week-to-date shape

const TEAMS = ['KONGOWE', 'MBAGALA', 'TEMEKE', 'KIGAMBONI'];
const WD = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
const DAYS = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24'];

/** A book with every awkward case in it that the arithmetic has to survive:
 *
 *   - all four collection statuses, including blanks and odd casing / stray spaces
 *   - UNDERPAID rows whose arrears EXCEED what was expected, so the per-row clamp matters
 *   - a day uploaded TWICE (Wednesday), so the batch rule has something to resolve
 *   - a customer with NO TEAM at all, which groups under "(no team)"
 *   - decks for every weekday, initial and current, so recovery pairs on date+type+weekday
 *   - a weekday whose initial deck is missing, so the unpaired branch is exercised
 */
function book() {
  const t = {
    teams: TEAMS.map((x, i) => ({ team: x, opm: 'OPM' + i, recovery: 'REC' + (i % 2),
      gmo: 'GMO' + i, manager: 'MAN' + i, credit: 'CR' + i, expected: 'EXP' + (i % 3), bike: 'BK' + i })),
    settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }, { key: 'SALES_TARGET_WEEKLY', value: '100000000' },
      { key: 'PMO_ROLE', value: 'PMO COLLECTION' }, { key: 'PMO_WEEKLY_BONUS', value: '150000' }],
    access_codes: [
      { code: 'P1', name: 'KAMARIA', role: 'PMO COLLECTION', teams: ['KONGOWE', 'MBAGALA'] },
      { code: 'P2', name: 'JUMA', role: 'PMO COLLECTION', teams: ['TEMEKE'] },
      { code: 'A', name: 'ADMIN', role: 'ADMIN', teams: null },
    ],
    roles: [], call_agents: [{ user_id: 'CS1', names: 'ASHA NA NEEMA' }], call_users: [], call_logs: [],
    repayment_snapshots: [], defaulter_snapshots: [], followup_status: [],
    followup_comments: [], loans: [], received_payments: [], abnormal_payments: [],
    complaints: [], restructures: [], demand_notices: [],
  };

  const STATUS = ['PAID', 'UNPAID', 'UNDERPAID', 'OVERPAID', '', ' overpaid ', 'Underpaid', null];
  const push = (date, batch, stamp, teamOf, count, offset) => {
    for (let i = 0; i < count; i++) {
      const st = STATUS[(i + offset) % STATUS.length];
      t.repayment_snapshots.push({
        ref: 'R' + i, full_name: 'C' + i, contact: '07120000' + (i % 90),
        team: teamOf(i), payment_expected: 5000 + (i % 7) * 250,
        // Deliberately larger than payment_expected on some rows: an UNDERPAID customer whose
        // arrears exceed the instalment must clamp to zero collected, never go negative.
        arrears: (i % 5 === 0) ? 20000 : (i % 3) * 900,
        todays_status: st, snapshot_type: 'today', snapshot_date: date,
        upload_batch: batch, created_at: stamp,
      });
    }
  };
  DAYS.forEach((d, di) => {
    push(d, 'exp-' + di, d + 'T04:30:00.000Z', i => (i === 11 ? null : TEAMS[i % TEAMS.length]), 60, di);
    // WEDNESDAY WENT IN TWICE. The second upload supersedes the first whole-batch; if the batch
    // rule were dropped anywhere in this change, Wednesday would silently double.
    if (di === 2) push(d, 'exp-2b', d + 'T11:15:00.000Z', i => TEAMS[i % TEAMS.length], 45, 3);
  });
  // The early-collection list: Initial, which is what this operation actually uploads.
  push('2026-07-24', 'ini-fri', '2026-07-24T05:00:00.000Z', i => TEAMS[i % TEAMS.length], 30, 2);
  for (const r of t.repayment_snapshots) if (r.upload_batch === 'ini-fri') r.snapshot_type = 'initial';

  DAYS.forEach((d, di) => {
    for (const type of ['initial', 'current']) {
      // Thursday has no initial deck -- the unpaired branch, where recovery must read 0 rather
      // than the whole book, and the screen must say which day is unpaired.
      if (di === 3 && type === 'initial') continue;
      for (let i = 0; i < 40; i++) {
        t.defaulter_snapshots.push({
          ref: 'D' + i, full_name: 'F' + i, team: (i === 7 ? null : TEAMS[i % TEAMS.length]),
          arrears: type === 'initial' ? 30000 + i * 100 : 24000 + i * 100,
          ds: (i % 6) + '/6', dc: i % 4, initial_inst: 9000, other_inst: 4000, t_payment: i * 500,
          status: i % 3 === 0 ? 'Chronic' : 'Defaulter',
          snapshot_type: type, weekday: WD[di], snapshot_date: d,
          upload_batch: 'def-' + di + type, created_at: d + 'T04:00:00.000Z',
        });
      }
    }
  });

  for (let i = 0; i < 40; i++) {
    t.followup_status.push({ ref: 'D' + i, team: TEAMS[i % TEAMS.length], full_name: 'F' + i,
      arrears: 24000, status: 'Defaulter', fu_status: i % 2 ? 'AMETOA AHADI' : 'ANALIPA LEO' });
    t.loans.push({ id: 'l' + i, team: TEAMS[i % TEAMS.length], stage: i % 3 ? 'approved' : 'assigned',
      principal_amt: 400000, requested_amt: 400000, approved_date: DAYS[i % 5],
      created_at: DAYS[i % 5] + 'T08:00:00Z', upload_date: DAYS[i % 5],
      track_no: '1', created_by: 'CS1' });
    t.received_payments.push({ team: TEAMS[i % TEAMS.length], amount_paid: 7000, paid_at: DAYS[i % 5] });
  }
  return t;
}

const ADMIN = { code: 'A', name: 'ADMIN', role: 'ADMIN', teams: null, tabs: ['settings', 'upload'] };
const OFFICER = { code: 'O', name: 'REC0', role: 'GMO', teams: ['KONGOWE', 'TEMEKE'], tabs: [] };

/** The same book, once behind a database that has the migration and once behind one that has
    not. Two separate fakes so nothing -- not the one-minute answer cache, not the note about a
    missing function -- can carry across from one to the other. */
const withMigration = () => fakeDb(book(), { rpc: SNAPSHOT_TOTALS_RPC });
const withoutMigration = () => fakeDb(book());

/* ------------------------------------------------------------------ THE FIGURES THEMSELVES */

const SCREENS = [
  ['Dashboard + Presentation (dashboardFull)', 'dashboardFull', {}],
  ['Officer boards (the deck)', 'officerBoards', {}],
  ['Weekly report', 'weekly', {}],
  ['Commission, including the PMO board', 'commission', {}],
];

for (const [label, fn, args] of SCREENS) {
  for (const [when, nowMs] of [['on a weekday', FRIDAY], ['at the weekend', SUNDAY]]) {
    for (const [who, user] of [['for an admin', ADMIN], ['for one officer', OFFICER]]) {
      test(`${label}: identical ${when} ${who}, database sums vs rows in memory`, async () => {
        const fromDb = await portalApi(withMigration(), user, fn, args, nowMs);
        const inMemory = await portalApi(withoutMigration(), user, fn, args, nowMs);
        assert.deepEqual(fromDb, inMemory,
          `${label} answered differently when the database did the adding up.\n` +
          '  Every figure on this screen must be identical either way -- the migration is run by\n' +
          '  hand, so BOTH paths are live at once across the estate.');
      });
    }
  }
}

test('the phone performance strip and HOPE Live agree, both ways', async () => {
  /* Six percentages on two hundred handsets, refreshed on every sync. It is the same book
     behind them as the dashboard's, so it has to answer the same either way -- and the strip
     is where an all-teams admin was quietly downloading the whole book to work out Kesho. */
  const withUser = t => {
    t.call_users = [{ user_id: 'U1', name: 'JUMA G', team: 'KONGOWE', role: 'OFFICER',
      device_id: 'DEV1', active: true }];
    t.teams = t.teams.map(x => (x.team === 'KONGOWE' ? { ...x, team_code: 'KONGOWE1' } : x));
    return t;
  };
  for (const [fn, args] of [['api_widget', ['KONGOWE1']], ['api_callBoot', ['DEV1']]]) {
    _clearSummaryCache();
    const a = await callApi(fakeDb(withUser(book()), { rpc: SNAPSHOT_TOTALS_RPC }), fn, args, FRIDAY);
    _clearSummaryCache();
    const b = await callApi(fakeDb(withUser(book())), fn, args, FRIDAY);
    assert.deepEqual(a, b, fn + ' answered differently when the database did the adding up');
  }
});

test('the dashboard itself agrees, on every day of the week', async () => {
  /* buildDashboard is what the portal, the phone strip and HOPE Live all read, so the seven
     days are worth walking one at a time: the recovery denominator changes basis on Monday, on
     Tuesday-to-Friday and again at the weekend, and each basis reads a different snapshot. */
  for (let d = 0; d < 7; d++) {
    const nowMs = Date.parse('2026-07-20T09:00:00Z') + d * 86400000;
    const a = await buildDashboard(withMigration(), ADMIN, nowMs);
    const b = await buildDashboard(withoutMigration(), ADMIN, nowMs);
    assert.deepEqual(a, b, 'the dashboard differed on day ' + d + ' of the week');
  }
});

/* ------------------------------------------------------- AND THE FOLD MATCHES THE OLD RULES

   The two screens tests above prove the database and the in-memory fold agree with each other.
   This proves the FOLD still agrees with the definitions it replaced -- collectedOf() and
   uncollectedOf(), the rules in api/_lib/recovery.js that every figure in this system has
   always been built on. Without this, both sides could be wrong together. */

test('folding a snapshot preserves collected, uncollected and the headcount exactly', () => {
  const rows = book().repayment_snapshots;
  const agg = foldExpected(rows);

  assert.equal(agg.reduce((s, r) => s + r.customers, 0), rows.length,
    'every customer must be counted exactly once');
  assert.equal(agg.reduce((s, r) => s + r.expected_amt, 0),
    rows.reduce((s, r) => s + num(r.payment_expected), 0));
  assert.equal(agg.reduce((s, r) => s + r.collected_amt, 0),
    rows.reduce((s, r) => s + collectedOf(r), 0),
    'collected must still be collectedOf() -- expected only on PAID/OVERPAID, clamped on UNDERPAID');
  assert.equal(agg.reduce((s, r) => s + r.uncollected_amt, 0), uncollectedOf(rows),
    'uncollected must still be clamped per CUSTOMER before summing, or it can go negative');
  assert.equal(agg.reduce((s, r) => s + r.paid_n + r.over_n, 0),
    rows.filter(r => ['PAID', 'OVERPAID'].includes(String(r.todays_status || '').trim().toUpperCase())).length,
    'the early-collection headcount counts the same rows, whatever the spacing and case');

  // And the same sums per (day, batch, team) -- not merely in total, which a compensating pair
  // of errors could satisfy.
  for (const g of agg) {
    const mine = rows.filter(r => String(r.snapshot_date) === String(g.snapshot_date)
      && String(r.snapshot_type) === String(g.snapshot_type)
      && (r.team == null ? null : r.team) === g.team
      && String(r.upload_batch) === String(g.upload_batch));
    assert.equal(g.customers, mine.length);
    assert.equal(g.collected_amt, mine.reduce((s, r) => s + collectedOf(r), 0));
    assert.equal(g.uncollected_amt, uncollectedOf(mine));
  }
});

test('folding a deck preserves arrears and the headcount, per weekday', () => {
  const rows = book().defaulter_snapshots;
  const agg = foldDefaulter(rows);
  assert.equal(agg.reduce((s, r) => s + r.customers, 0), rows.length);
  assert.equal(agg.reduce((s, r) => s + r.arrears_amt, 0), rows.reduce((s, r) => s + num(r.arrears), 0));
  // The weekday must survive the fold. Pairing an initial deck against a current one of a
  // DIFFERENT weekday compares two populations and reports the gap as recovery -- that is the
  // mistake that once produced minus 194 million.
  assert.deepEqual([...new Set(agg.map(r => r.weekday))].sort(), WD.slice().sort());
});

test('the database and the fold group a re-uploaded day the same way', () => {
  const store = { repayment_snapshots: { rows: book().repayment_snapshots } };
  const fromDb = SNAPSHOT_TOTALS_RPC.expected_snapshot_totals(store,
    { p_from: DAYS[0], p_to: DAYS[4], p_type: 'today', p_teams: null });
  const folded = foldExpected(store.repayment_snapshots.rows.filter(r => r.snapshot_type === 'today'));
  const key = r => [r.snapshot_date, r.snapshot_type, r.team, r.upload_batch].join('|');
  const sortByKey = a => a.slice().sort((x, y) => (key(x) < key(y) ? -1 : 1));
  assert.deepEqual(sortByKey(fromDb), sortByKey(folded));

  // Wednesday went in twice, so it must come back as two batches for the batch rule to choose
  // between -- collapsing them here would double Wednesday and no screen would say so.
  const wed = fromDb.filter(r => String(r.snapshot_date) === DAYS[2]);
  assert.equal(new Set(wed.map(r => r.upload_batch)).size, 2,
    'both uploads of Wednesday must survive as separate batches');
});

/* --------------------------------------------------------------- AND IT IS ACTUALLY SMALLER

   The point of the whole change. A week of this book is a few thousand customer rows; the same
   answer is a couple of hundred totals. The ratio is what matters -- on the real book it is
   161,000 against roughly two hundred. */

test('a week of snapshots comes back as team-day totals, not customers', () => {
  const b = book();
  const store = { repayment_snapshots: { rows: b.repayment_snapshots },
                  defaulter_snapshots: { rows: b.defaulter_snapshots } };
  const rawRows = b.repayment_snapshots.length + b.defaulter_snapshots.length;
  const totals = SNAPSHOT_TOTALS_RPC.expected_snapshot_totals(store,
      { p_from: DAYS[0], p_to: DAYS[4], p_type: 'today', p_teams: null }).length
    + SNAPSHOT_TOTALS_RPC.defaulter_snapshot_totals(store,
      { p_from: DAYS[0], p_to: DAYS[4], p_type: null, p_teams: null, p_weekday: null }).length;

  assert.ok(totals * 4 < rawRows,
    `the totals (${totals}) are not meaningfully smaller than the rows (${rawRows})`);
  // One row per team per day per batch, and nothing per customer: the count must not move when
  // the number of CUSTOMERS does.
  assert.ok(totals <= (DAYS.length + 1) * (TEAMS.length + 1) * 2 * 3,
    `${totals} totals is more than one per team, per day, per deck, per batch`);
});

test('an officer is handed their own teams only, by the database', () => {
  const b = book();
  const store = { repayment_snapshots: { rows: b.repayment_snapshots } };
  const mine = SNAPSHOT_TOTALS_RPC.expected_snapshot_totals(store,
    { p_from: DAYS[0], p_to: DAYS[4], p_type: 'today', p_teams: ['KONGOWE'] });
  assert.ok(mine.length > 0);
  assert.deepEqual([...new Set(mine.map(r => r.team))], ['KONGOWE'],
    'team scoping happens at the database -- a filter applied after the rows arrive is a download');
});

/* =====================================================================================
   A SUMMARY IS MORE ROWS OF THE SAME ANSWER.
   =====================================================================================
   "So from now on we keep both the last customers default report list and the default summary
    but use the latest among the two on displaying report data"

   Which is not a new rule. The summary table is shaped like what these functions already
   return, carries its own upload_batch and created_at, and is handed to the batch rule that has
   always decided which upload wins. The customer lists stay exactly where they are -- the phone,
   the follow-up tab and the rotation go on reading them whatever the reports use.
*/
const SUMM = (over = {}) => ({
  id: 's' + (SUMM.n = (SUMM.n || 0) + 1), kind: 'expected', snapshot_type: 'today',
  snapshot_date: '2026-07-24', weekday: null, team: 'A', customers: null,
  expected_amt: 0, collected_amt: 0, uncollected_amt: 0, arrears_amt: null,
  upload_batch: 'sum', created_at: '2026-07-24T10:00:00Z', ...over,
});
const LIST = (over = {}) => ({
  id: 'e' + (LIST.n = (LIST.n || 0) + 1), ref: 'R' + (LIST.n), team: 'A',
  payment_expected: 0, todays_status: 'UNPAID', arrears: 0,
  snapshot_type: 'today', snapshot_date: '2026-07-24',
  upload_batch: 'list', created_at: '2026-07-24T06:00:00Z', ...over,
});

test('a summary uploaded after the list is what the reports read', async () => {
  const db = fakeDb({
    repayment_snapshots: [LIST({ payment_expected: 1000 }), LIST({ payment_expected: 500 })],
    snapshot_summaries: [SUMM({ expected_amt: 9000, collected_amt: 7000, uncollected_amt: 2000 })],
  });
  const r = await expectedTotalsLatest(db, { type: 'today', notAfter: '2026-07-24' });
  assert.equal(tExpected(r.rows), 9000, 'the summary is newer, so the summary wins');
  assert.equal(tCollected(r.rows), 7000);
  assert.equal(r.batch, 'sum');
  // And the customer list is untouched underneath -- the phone still has its names.
  assert.equal(db._dump('repayment_snapshots').length, 2);
});

test('a list uploaded after the summary wins it back', async () => {
  const db = fakeDb({
    repayment_snapshots: [LIST({ payment_expected: 1000, upload_batch: 'late', created_at: '2026-07-24T14:00:00Z' })],
    snapshot_summaries: [SUMM({ expected_amt: 9000 })],
  });
  const r = await expectedTotalsLatest(db, { type: 'today', notAfter: '2026-07-24' });
  assert.equal(tExpected(r.rows), 1000, 'the export arrived at last, so it is the record again');
  assert.equal(r.batch, 'late');
});

test('a day that exists ONLY as a summary is still the latest day', async () => {
  /* The morning the export was missed entirely. Resolving the latest date off the customer
     lists alone would step straight past it to an older, fuller day and report last week's
     money as today's -- which is worse than showing nothing. */
  const db = fakeDb({
    repayment_snapshots: [LIST({ snapshot_date: '2026-07-23', payment_expected: 400 })],
    snapshot_summaries: [SUMM({ snapshot_date: '2026-07-24', expected_amt: 7777 })],
  });
  const r = await expectedTotalsLatest(db, { type: 'today', notAfter: '2026-07-24' });
  assert.equal(r.date, '2026-07-24');
  assert.equal(tExpected(r.rows), 7777);
});

test('a stale summary cannot outrank a newer day\'s list', async () => {
  const db = fakeDb({
    repayment_snapshots: [LIST({ snapshot_date: '2026-07-24', payment_expected: 400 })],
    snapshot_summaries: [SUMM({ snapshot_date: '2026-07-20', expected_amt: 999999 })],
  });
  const r = await expectedTotalsLatest(db, { type: 'today', notAfter: '2026-07-24' });
  assert.equal(r.date, '2026-07-24');
  assert.equal(tExpected(r.rows), 400, 'Monday\'s summary is Monday\'s, whatever size it is');
});

test('the week reads a summary day beside its list days', async () => {
  const db = fakeDb({
    repayment_snapshots: [
      LIST({ snapshot_date: '2026-07-20', payment_expected: 100 }),
      LIST({ snapshot_date: '2026-07-21', payment_expected: 200 }),
    ],
    snapshot_summaries: [SUMM({ snapshot_date: '2026-07-22', expected_amt: 300 })],
  });
  const rows = await expectedTotalsInRange(db, { type: 'today', from: '2026-07-20', to: '2026-07-24' });
  const byDay = {};
  for (const r of rows) byDay[r.snapshot_date] = (byDay[r.snapshot_date] || 0) + Number(r.expected_amt || 0);
  assert.deepEqual(byDay, { '2026-07-20': 100, '2026-07-21': 200, '2026-07-22': 300 });
});

test('defaulter summaries pair initial against current on the same weekday', async () => {
  /* The worked example: 108,781,206 initial and 108,771,206 current is 10,000 recovered. And
     the weekday has to survive, or the pairing compares two different populations -- the fault
     that once produced minus 194 million. */
  const D = (type, amt, wd) => ({ id: 'd' + type + wd, kind: 'defaulter', snapshot_type: type,
    snapshot_date: '2026-07-24', weekday: wd, team: 'A', customers: null,
    expected_amt: null, collected_amt: null, uncollected_amt: null, arrears_amt: amt,
    upload_batch: 'ds' + type + wd, created_at: '2026-07-24T10:00:00Z' });
  const db = fakeDb({ defaulter_snapshots: [], snapshot_summaries: [
    D('initial', 108781206, 'FRI'), D('current', 108771206, 'FRI'),
    D('initial', 500, 'MON'), D('current', 100, 'MON'),
  ] });
  const ini = await defaulterTotalsLatest(db, { type: 'initial', weekday: 'FRI', notAfter: '2026-07-24' });
  const cur = await defaulterTotalsLatest(db, { type: 'current', weekday: 'FRI', notAfter: '2026-07-24' });
  assert.equal(tArrears(ini.rows) - tArrears(cur.rows), 10000);
  assert.equal(tArrears(ini.rows), 108781206, 'Monday\'s deck is not swept into Friday\'s');
});

test('a database with no summaries table behaves exactly as it always did', async () => {
  /* The migration is run by hand like all of them, and every deployment is in this state
     between a deploy and somebody opening the SQL editor. */
  const base = fakeDb({ repayment_snapshots: [LIST({ payment_expected: 1000 })] });
  const db = { from(n) { if (n === 'snapshot_summaries') throw new Error('relation does not exist'); return base.from(n); },
    rpc: base.rpc, _dump: n => base._dump(n) };
  const r = await expectedTotalsLatest(db, { type: 'today', notAfter: '2026-07-24' });
  assert.equal(tExpected(r.rows), 1000);
  assert.equal(r.batch, 'list');
});

/* THE SUMMARY LOOK-UP IS BOUNDED TOO.
 *
 * The duplicate sweep taught this the hard way: a range of 0001-01-01 to 9999-12-31 is instant
 * on a fixture and does not come back on a live database. The same shape was in this read,
 * harmless only while nobody used summaries -- so it would have started biting at exactly the
 * moment somebody came to rely on the feature.
 */
test('a summary far in the past is not "the latest"', async () => {
  const db = fakeDb({
    repayment_snapshots: [],
    snapshot_summaries: [SUMM({ snapshot_date: '2019-01-04', expected_amt: 12345 })],
  });
  const r = await expectedTotalsLatest(db, { type: 'today', notAfter: '2026-07-24' });
  assert.equal(r.date, null, 'seven years back is history, not today');
  assert.equal(r.rows.length, 0);
});

test('a summary inside the look-back window still wins', async () => {
  const db = fakeDb({
    repayment_snapshots: [],
    snapshot_summaries: [SUMM({ snapshot_date: '2026-07-01', expected_amt: 4321 })],
  });
  const r = await expectedTotalsLatest(db, { type: 'today', notAfter: '2026-07-24' });
  assert.equal(r.date, '2026-07-01');
  assert.equal(tExpected(r.rows), 4321);
});

test('a year of history is still reachable', async () => {
  /* Thirteen months, so a full year of records can be read back without the window being the
     thing that hides them. */
  const db = fakeDb({
    repayment_snapshots: [],
    snapshot_summaries: [SUMM({ snapshot_date: '2025-09-01', expected_amt: 999 })],
  });
  const r = await expectedTotalsLatest(db, { type: 'today', notAfter: '2026-07-24' });
  assert.equal(r.date, '2025-09-01', 'ten months back is inside the window');
});

/* =====================================================================================
   A COMPANY BIG ENOUGH TO BE TRUNCATED.
   =====================================================================================
     "still not, she is a 2-4 arreas 1,700,000.00 i just want to find that kind of customer in
      default automatic i wonder why use sampling in a list that needs them all .. i fear many
      defaulters havent been reached in app followup by now"

   The fear was right and this is where it came from. Moving the sums into the database made
   them small -- one row per team, per day, per weekday, per batch -- but "small" is relative to
   a hundred and sixty thousand customers, not to PostgREST's thousand-row ceiling. Forty teams
   across a week of decks is several thousand summary rows, and a bare `db.rpc(...)` was handed
   the first thousand with no error to say so.

   The damage is not a total that is slightly low. It is a per-team map that is missing whole
   TEAMS -- so the newest deck date for GOBA is never learned, GOBA's deck is never read, and
   every defaulter on it is invisible on every phone. A customer in the uploaded file and
   nowhere on any screen.

   Every fixture in this file is four teams and fits in one page, which is exactly why this
   never showed up here. So one fixture is deliberately too big.
   ===================================================================================== */

/** Fifty teams, five days, every weekday: more team-day rows than one page can carry. */
function wideBook() {
  const teams = Array.from({ length: 50 }, (_, i) => 'TEAM' + String(i + 1).padStart(2, '0'));
  const rows = [];
  let n = 0;
  for (const d of DAYS) for (const wd of WD) for (const t of teams) {
    rows.push({ id: 'd' + (++n), ref: 'R' + n, name: 'C' + n, team: t,
      snapshot_type: 'current', snapshot_date: d, weekday: wd, arrears: 1000,
      upload_batch: 'b1', created_at: d + 'T06:00:00Z' });
  }
  return { teams, rows };
}

test('a week wide enough to be truncated still reports every team', async () => {
  const { teams, rows } = wideBook();
  assert.ok(rows.length > 1000, 'the fixture has to be bigger than one page: ' + rows.length);
  const { defaulterTotalsInRange } = await import('../api/_lib/snapshot-totals.js');
  const db = fakeDb({ defaulter_snapshots: rows }, { rpc: SNAPSHOT_TOTALS_RPC });
  const out = await defaulterTotalsInRange(db,
    { type: 'current', from: DAYS[0], to: DAYS[4], teams: null });
  const seen = new Set(out.map(r => String(r.team)));
  assert.equal(seen.size, teams.length,
    `${seen.size} of ${teams.length} teams came back -- the rest fell past the 1000-row cap`);
  assert.ok(seen.has(teams[teams.length - 1]), 'including the last team in the alphabet');
  assert.equal(tArrears(out), rows.length * 1000, 'and the arrears add up to the whole book');
});

test('the newest deck date is learned for every team, not just the first thousand rows', async () => {
  /* This is the one that hid ESTER PETER OMARY of team GOBA. `deckDatesPerTeam` builds the map
     of "which date is this team's newest deck", and a team missing from the map has no deck --
     so nobody on it is ever called. */
  const { deckDatesPerTeam } = await import('../api/_lib/snapshot-totals.js');
  const { teams, rows } = wideBook();
  const db = fakeDb({ defaulter_snapshots: rows }, { rpc: SNAPSHOT_TOTALS_RPC });
  const map = await deckDatesPerTeam(db, { type: 'current', from: DAYS[0], to: DAYS[4] });
  assert.ok(map, 'the function is there, so a map comes back');
  for (const t of teams) assert.equal(map.get(t), DAYS[4], 'no deck date for ' + t);
});
