// Runs the ENTIRE dashboard pipeline -- EAT clock, batch-aware snapshot resolution, the
// recovery-basis rule -- against an in-memory PostgREST fake, across all seven days of one
// literal week (Mon 2026-07-20 -> Sun 2026-07-26). No mocking of the code under test: the
// real dashboard-core/snapshots/recovery/time modules run exactly as they do on Vercel;
// only the database is faked, at the supabase-js query-builder surface (.eq/.gte/.order/
// .range/.maybeSingle), including PostgREST's 1000-row page cap so pagination is real too.
//
//   npm test        (node --test test/)

import test from 'node:test';
import assert from 'node:assert/strict';

// api/lib/supabase.js creates its client at import time from env -- give it inert values
// BEFORE the dynamic imports below (static imports would hoist above these assignments).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { buildDashboard } = await import('../api/lib/dashboard-core.js');
const { pickLatestBatch } = await import('../api/lib/snapshots.js');
const { recoveryBasis, collectedOf } = await import('../api/lib/recovery.js');
const { todayKey, currentWeekday, isoWeekday, weekMondayKey } = await import('../api/lib/time.js');

// ---------------------------------------------------------------------------------------
// Fake PostgREST -- the exact query-builder subset the code under test uses.
// ---------------------------------------------------------------------------------------
const PAGE_CAP = 1000;   // PostgREST's silent default cap, so fetchAll's pagination is exercised for real

class FakeQuery {
  constructor(rows) { this.rows = rows; this.filters = []; this.ord = null; this.lim = null; this.rng = null; this.single = false; }
  select() { return this; }
  eq(k, v) { this.filters.push(r => String(r[k]) === String(v)); return this; }
  gte(k, v) { this.filters.push(r => r[k] != null && String(r[k]) >= String(v)); return this; }
  lte(k, v) { this.filters.push(r => r[k] != null && String(r[k]) <= String(v)); return this; }
  in(k, arr) { this.filters.push(r => arr.map(String).includes(String(r[k]))); return this; }
  order(k, opts) { this.ord = { k, asc: !opts || opts.ascending !== false }; return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.single = true; return this; }
  _exec() {
    let out = this.rows.filter(r => this.filters.every(f => f(r)));
    if (this.ord) {
      const { k, asc } = this.ord;
      out = out.slice().sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
    out = out.slice(0, Math.min(this.lim != null ? this.lim : PAGE_CAP, PAGE_CAP));
    if (this.single) return { data: out[0] || null, error: null };
    return { data: out, error: null };
  }
  then(res, rej) { return Promise.resolve(this._exec()).then(res, rej); }
}

function fakeDb(tables) {
  return { from: name => new FakeQuery(tables[name] || []) };
}

// ---------------------------------------------------------------------------------------
// Fixture: the week of Mon 2026-07-20 .. Sun 2026-07-26.
// Per-day uncollected: Mon 600, Tue 400, Wed 300 (after dedup), Thu 350, Fri 250 -> week 1900.
// Per-day deck recovered: 200 (A 150 + B 50) x 5 days -> week 1000.
// ---------------------------------------------------------------------------------------
const T = (date, team, expected, status, arrears, batch, createdHour = 6) => ({
  team, payment_expected: expected, todays_status: status, arrears,
  snapshot_type: 'today', snapshot_date: date, upload_batch: batch,
  created_at: date + 'T' + String(createdHour).padStart(2, '0') + ':00:00Z',
});
const D = (date, weekday, type, team, arrears, batch) => ({
  team, arrears, snapshot_type: type, weekday, snapshot_date: date,
  upload_batch: batch, created_at: date + 'T06:00:00Z',
});

function makeTables() {
  const repayment_snapshots = [
    T('2026-07-20', 'A', 1000, 'UNDERPAID', 400, 'b-mon'),   // collected 600, uncollected 400
    T('2026-07-20', 'B', 200, 'UNPAID', 0, 'b-mon'),          // uncollected 200            -> Mon 600
    T('2026-07-21', 'A', 300, 'UNPAID', 0, 'b-tue'),
    T('2026-07-21', 'B', 400, 'UNDERPAID', 100, 'b-tue'),     //                            -> Tue 400
    // Wednesday uploaded TWICE: a stale 09:00 batch, then the corrected 10:00 batch.
    T('2026-07-22', 'A', 5000, 'UNPAID', 0, 'b-wed-stale', 9),
    T('2026-07-22', 'A', 200, 'UNPAID', 0, 'b-wed-fix', 10),
    T('2026-07-22', 'B', 300, 'UNDERPAID', 100, 'b-wed-fix', 10),   //                      -> Wed 300 deduped
    T('2026-07-23', 'A', 250, 'UNPAID', 0, 'b-thu'),
    T('2026-07-23', 'B', 100, 'UNPAID', 0, 'b-thu'),          //                            -> Thu 350
    T('2026-07-24', 'A', 150, 'UNPAID', 0, 'b-fri'),
    T('2026-07-24', 'B', 100, 'UNPAID', 0, 'b-fri'),          //                            -> Fri 250
  ];
  const defaulter_snapshots = [];
  for (const [date, wd] of [['2026-07-20', 'MON'], ['2026-07-21', 'TUE'], ['2026-07-22', 'WED'], ['2026-07-23', 'THU'], ['2026-07-24', 'FRI']]) {
    defaulter_snapshots.push(
      D(date, wd, 'initial', 'A', 500, 'bi-' + wd), D(date, wd, 'initial', 'B', 100, 'bi-' + wd),
      D(date, wd, 'current', 'A', 350, 'bc-' + wd), D(date, wd, 'current', 'B', 50, 'bc-' + wd),
    );
  }
  const loans = [
    { team: 'A', principal_amt: 1000, loan_amt: null, approved_date: '2026-07-21', stage: 'approved' },
    { team: 'B', principal_amt: null, loan_amt: 500, approved_date: '2026-07-23', stage: 'approved' },
    { team: 'A', principal_amt: 99999, loan_amt: null, approved_date: '2026-06-01', stage: 'approved' },  // last month -- must NOT count
    { team: 'A', principal_amt: 77777, loan_amt: null, approved_date: null, stage: 'approved' },          // no approved date -- must NOT count
    { team: 'A', principal_amt: 1234, loan_amt: null, approved_date: '2026-07-22', stage: 'pending_approval' },
  ];
  const received_payments = [
    { team: 'A', amount_paid: 100, paid_at: '2026-07-20' },
    { team: 'B', amount_paid: 200, paid_at: '2026-07-22' },
    { team: 'A', amount_paid: 50, paid_at: '2026-07-24' },
    { team: 'B', amount_paid: 25, paid_at: '2026-07-25' },
  ];
  return { repayment_snapshots, defaulter_snapshots, loans, received_payments };
}

const ALL = { code: 't', name: 'T', role: 'admin', teams: null, tabs: [] };   // null teams = ALL, same convention as auth.js
const noonEAT = date => Date.parse(date + 'T09:00:00Z');                       // 12:00 in Dar
const run = (nowMs, user = ALL, tables = makeTables()) => buildDashboard(fakeDb(tables), user, nowMs);

// ---------------------------------------------------------------------------------------
// The seven days
// ---------------------------------------------------------------------------------------
test("Monday: recovery divides by TODAY's uncollected", async () => {
  const d = await run(noonEAT('2026-07-20'));
  assert.equal(d.asOfWeekday, 'MON');
  assert.equal(d.period, 'day');
  assert.equal(d.totals.recovery.basis, 'today');
  assert.equal(d.totals.recovery.denominator, 600);
  assert.equal(d.totals.recovery.recovered, 200);
  assert.equal(d.totals.recovery.pct, 33.3);
  assert.equal(d.totals.recovery.yesterdaySource, undefined);
});

test("Tuesday: recovery divides by YESTERDAY's uncollected while collections stay on today", async () => {
  const d = await run(noonEAT('2026-07-21'));
  assert.equal(d.totals.recovery.basis, 'yesterday');
  assert.equal(d.totals.recovery.denominator, 600);                    // Monday's uncollected
  assert.equal(d.totals.recovery.yesterdaySource, 'previous-today-snapshot');
  assert.equal(d.totals.uncollected, 400);                             // Tuesday's own -- proves the two are decoupled
  assert.equal(d.totals.recovery.recovered, 200);
  assert.deepEqual(d.dates.recoveryDen, ['2026-07-20']);
});

test("Wednesday: same-date re-upload is deduped in Wednesday's own totals", async () => {
  const d = await run(noonEAT('2026-07-22'));
  assert.equal(d.totals.expectedCustomers, 2);                         // not 3 -- stale batch gone
  assert.equal(d.totals.expectedAmount, 500);                          // not 5500
  assert.equal(d.totals.uncollected, 300);                             // not 5300
  assert.equal(d.totals.collected, 200);
  assert.deepEqual(d.dates.expected, ['2026-07-22']);
});

test("Thursday: denominator is Wednesday's DEDUPED uncollected", async () => {
  const d = await run(noonEAT('2026-07-23'));
  assert.equal(d.totals.recovery.basis, 'yesterday');
  assert.equal(d.totals.recovery.denominator, 300);                    // not 5000 or 5300
  assert.deepEqual(d.dates.recoveryDen, ['2026-07-22']);
});

test("Friday: denominator is Thursday's uncollected", async () => {
  const d = await run(noonEAT('2026-07-24'));
  assert.equal(d.totals.recovery.denominator, 350);
  assert.equal(d.totals.recovery.recovered, 200);
});

test('Saturday: the whole dashboard goes week-to-date; recovery is 1000/1900', async () => {
  const d = await run(noonEAT('2026-07-25'));
  assert.equal(d.period, 'week');
  assert.equal(d.totals.recovery.basis, 'week');
  assert.equal(d.totals.recovery.denominator, 1900);
  assert.equal(d.totals.recovery.recovered, 1000);
  assert.equal(d.totals.recovery.pct, 52.6);
  assert.equal(d.totals.uncollected, 1900);
  assert.equal(d.totals.receivedAmount, 375);                          // Mon 100 + Wed 200 + Fri 50 + Sat 25
  assert.equal(d.totals.receivedCount, 4);
  assert.equal(d.totals.salesAmount, 1500);
  assert.equal(d.totals.defaulterArrears, 2000);                       // 400 x 5 decks
  assert.equal(d.totals.defaulterCustomers, 10);
  assert.deepEqual(d.dates.expected, ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']);
});

test('Sunday: same week basis as Saturday', async () => {
  const d = await run(noonEAT('2026-07-26'));
  assert.equal(d.asOfWeekday, 'SUN');
  assert.equal(d.period, 'week');
  assert.equal(d.totals.recovery.denominator, 1900);
  assert.equal(d.totals.recovery.recovered, 1000);
});

// ---------------------------------------------------------------------------------------
// Shape, scoping, clock edges
// ---------------------------------------------------------------------------------------
test('response is purely additive over the original shape', async () => {
  const d = await run(noonEAT('2026-07-20'));
  for (const k of ['expectedCustomers', 'expectedAmount', 'collected', 'uncollected',
    'defaulterCustomers', 'defaulterArrears', 'salesCount', 'salesAmount', 'receivedCount', 'receivedAmount']) {
    assert.ok(k in d.totals, `totals.${k} still present`);
  }
  assert.equal(d.asOfWeekday, 'MON');
  assert.deepEqual(d.teams.map(t => t.team), ['A', 'B']);
  for (const k of ['expectedAmount', 'collected', 'defaulterArrears', 'defaulterCustomers', 'salesAmount', 'receivedAmount']) {
    assert.ok(k in d.teams[0], `teams[].${k} still present`);
  }
  assert.equal(d.teams[0].recovered, 150);                             // the new per-team column
  assert.equal(d.teams[1].recovered, 50);
});

test('teamAllowed scoping applies to every figure, denominator included', async () => {
  const d = await run(noonEAT('2026-07-20'), { ...ALL, teams: ['A'] });
  assert.equal(d.totals.expectedAmount, 1000);
  assert.equal(d.totals.recovery.denominator, 400);                    // A's uncollected only
  assert.equal(d.totals.recovery.recovered, 150);
  assert.equal(d.totals.recovery.pct, 37.5);
  assert.deepEqual(d.teams.map(t => t.team), ['A']);
});

test('midnight EAT: 21:30 UTC Wednesday is already Thursday in Dar', async () => {
  const d = await run(Date.parse('2026-07-22T21:30:00Z'));             // 00:30 EAT Thu
  assert.equal(d.asOfWeekday, 'THU');
  assert.equal(d.totals.recovery.basis, 'yesterday');
  assert.equal(d.totals.recovery.denominator, 300);                    // Wednesday, deduped
});

test('midnight EAT boundary: 20:59 UTC is still Wednesday in Dar', async () => {
  const d = await run(Date.parse('2026-07-22T20:59:00Z'));             // 23:59 EAT Wed
  assert.equal(d.asOfWeekday, 'WED');
  assert.equal(d.totals.recovery.denominator, 400);                    // Tuesday
});

test('fetchAll pages past the 1000-row PostgREST cap', async () => {
  const tables = makeTables();
  tables.repayment_snapshots = [];
  for (let i = 0; i < 1500; i++) tables.repayment_snapshots.push(T('2026-07-20', 'A', 1, 'UNPAID', 0, 'b-big'));
  const d = await run(noonEAT('2026-07-20'), ALL, tables);
  assert.equal(d.totals.expectedCustomers, 1500);
  assert.equal(d.totals.expectedAmount, 1500);
});

// ---------------------------------------------------------------------------------------
// Yesterday resolution (Tue-Fri denominator)
// ---------------------------------------------------------------------------------------
test('a fresh Expected-Yesterday file beats the previous today-snapshot', async () => {
  const tables = makeTables();
  tables.repayment_snapshots.push({ ...T('2026-07-23', 'A', 100, 'UNPAID', 0, 'b-yfile'), snapshot_type: 'yesterday' });
  const d = await run(noonEAT('2026-07-24'), ALL, tables);             // Friday
  assert.equal(d.totals.recovery.yesterdaySource, 'yesterday-file');
  assert.equal(d.totals.recovery.denominator, 100);
  assert.deepEqual(d.dates.recoveryDen, ['2026-07-23']);
});

test("a yesterday-file stamped with TODAY's date is accepted too (>= compare)", async () => {
  const tables = makeTables();
  tables.repayment_snapshots.push({ ...T('2026-07-24', 'A', 120, 'UNPAID', 0, 'b-yfile'), snapshot_type: 'yesterday' });
  const d = await run(noonEAT('2026-07-24'), ALL, tables);             // Friday, file dated Friday
  assert.equal(d.totals.recovery.yesterdaySource, 'yesterday-file');
  assert.equal(d.totals.recovery.denominator, 120);
});

test('a STALE yesterday-file from earlier in the week is ignored', async () => {
  const tables = makeTables();
  tables.repayment_snapshots.push({ ...T('2026-07-20', 'A', 999, 'UNPAID', 0, 'b-yfile'), snapshot_type: 'yesterday' });
  const d = await run(noonEAT('2026-07-24'), ALL, tables);             // Friday; Monday's file is old news
  assert.equal(d.totals.recovery.yesterdaySource, 'previous-today-snapshot');
  assert.equal(d.totals.recovery.denominator, 350);                    // Thursday
});

test('holiday gap: no snapshot yesterday falls back to the prior REAL day', async () => {
  const tables = makeTables();
  tables.repayment_snapshots = tables.repayment_snapshots.filter(r => r.snapshot_date !== '2026-07-23');
  const d = await run(noonEAT('2026-07-24'), ALL, tables);             // Friday, Thursday was a holiday
  assert.equal(d.totals.recovery.denominator, 300);                    // Wednesday, deduped
  assert.deepEqual(d.dates.recoveryDen, ['2026-07-22']);
});

// ---------------------------------------------------------------------------------------
// Recovered pairing, batch resolution, hijack cap, sales bound
// ---------------------------------------------------------------------------------------
test('a missing initial deck yields recovered 0 with a note -- never the whole book', async () => {
  const tables = makeTables();
  tables.defaulter_snapshots = tables.defaulter_snapshots.filter(r => !(r.weekday === 'MON' && r.snapshot_type === 'initial'));
  const d = await run(noonEAT('2026-07-20'), ALL, tables);
  assert.equal(d.totals.recovery.recovered, 0);                        // NOT -400 (minus the current deck)
  assert.match(d.totals.recovery.note, /initial/i);
  assert.equal(d.totals.defaulterArrears, 400);                        // the KPI itself still shows the deck
});

test("a typo'd FUTURE snapshot_date cannot hijack the dashboard", async () => {
  const tables = makeTables();
  tables.repayment_snapshots.push(T('2026-08-15', 'A', 12345, 'UNPAID', 0, 'b-typo'));
  const d = await run(noonEAT('2026-07-20'), ALL, tables);
  assert.deepEqual(d.dates.expected, ['2026-07-20']);
  assert.equal(d.totals.recovery.denominator, 600);
});

test('legacy NULL-batch rows resolve as one batch; a stamped re-upload supersedes them', async () => {
  // Unit level: all-legacy stays whole, and a newer stamped batch wins over legacy rows.
  const legacy = [{ upload_batch: null, created_at: '2026-07-20T06:00:00Z', v: 1 }, { upload_batch: null, created_at: '2026-07-20T06:00:01Z', v: 2 }];
  assert.equal(pickLatestBatch(legacy).length, 2);
  const mixed = legacy.concat([{ upload_batch: 'b2', created_at: '2026-07-20T07:00:00Z', v: 3 }]);
  assert.deepEqual(pickLatestBatch(mixed).map(r => r.v), [3]);
  // Pipeline level: a whole day of legacy rows still computes normally.
  const tables = makeTables();
  for (const r of tables.repayment_snapshots) if (r.snapshot_date === '2026-07-20') r.upload_batch = null;
  const d = await run(noonEAT('2026-07-20'), ALL, tables);
  assert.equal(d.totals.recovery.denominator, 600);
});

test('sales counts only loans approved within the current week', async () => {
  const d = await run(noonEAT('2026-07-22'));                          // Wednesday
  assert.equal(d.totals.salesCount, 1);                                // Tue's 1000 only -- Thu hasn't happened yet
  assert.equal(d.totals.salesAmount, 1000);                            // June's 99999 and the undated loan are out
});

// ---------------------------------------------------------------------------------------
// Unit: the ports themselves
// ---------------------------------------------------------------------------------------
test('collectedOf is the exact Code.gs port, clamps included', () => {
  assert.equal(collectedOf({ payment_expected: 100, arrears: 0, todays_status: 'PAID' }), 100);
  assert.equal(collectedOf({ payment_expected: 100, arrears: 0, todays_status: 'OVERPAID' }), 100);   // never the overpayment
  assert.equal(collectedOf({ payment_expected: 100, arrears: 30, todays_status: 'UNDERPAID' }), 70);
  assert.equal(collectedOf({ payment_expected: 100, arrears: 150, todays_status: 'UNDERPAID' }), 0);  // clamped low
  assert.equal(collectedOf({ payment_expected: 100, arrears: -50, todays_status: 'UNDERPAID' }), 100); // clamped high
  assert.equal(collectedOf({ payment_expected: 100, arrears: 0, todays_status: '' }), 0);
  assert.equal(collectedOf({ payment_expected: 100, arrears: 0, todays_status: 'whatever' }), 0);
});

test('recoveryBasis and the EAT clock agree on all seven days', () => {
  assert.equal(recoveryBasis(1).kind, 'today');
  for (const d of [2, 3, 4, 5]) assert.equal(recoveryBasis(d).kind, 'yesterday');
  assert.equal(recoveryBasis(6).kind, 'week');
  assert.equal(recoveryBasis(7).kind, 'week');
  // And the clock feeding it: Sat 2026-07-25 noon EAT.
  const nowMs = noonEAT('2026-07-25');
  assert.equal(todayKey(nowMs), '2026-07-25');
  assert.equal(currentWeekday(nowMs), 'SAT');
  assert.equal(isoWeekday(nowMs), 6);
  assert.equal(weekMondayKey(nowMs), '2026-07-20');
});
