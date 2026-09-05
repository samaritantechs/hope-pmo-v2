// Paging. Supabase caps any single query at 1000 rows -- silently -- so fetchAll pages until a
// short page arrives. Getting this wrong TRUNCATES data without an error, which is how two
// different tables once both reported exactly 1000 rows, so every boundary is pinned here.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { fetchAll } = await import('../api/_lib/supabase.js');

/** A table of `n` numbered rows that counts how many round trips were made to read it. */
function fakeTable(n) {
  const rows = Array.from({ length: n }, (_, i) => ({ i }));
  const state = { trips: 0 };
  state.build = () => ({
    range: async (a, b) => { state.trips++; return { data: rows.slice(a, b + 1), error: null }; },
  });
  return state;
}

test('fetchAll returns every row, in order, at every page boundary', async () => {
  for (const n of [0, 1, 999, 1000, 1001, 2500, 6000, 6001, 7000, 12000]) {
    const t = fakeTable(n);
    const out = await fetchAll(t.build);
    assert.equal(out.length, n, `${n} rows in, ${out.length} out`);
    assert.ok(out.every((r, i) => r.i === i), `${n} rows came back out of order`);
  }
});

test('a table that fits in one page costs exactly one round trip', async () => {
  for (const n of [0, 1, 999]) {
    const t = fakeTable(n);
    await fetchAll(t.build);
    assert.equal(t.trips, 1, `${n} rows should not page`);
  }
});

test('a big table is read in a few big journeys, not many small ones', async () => {
  /* 12,000 rows used to be twelve separate journeys to the database, one after another, each a
     full round trip from Vercel. Thirty thousand customers made it thirty, and the dashboard
     needed 567 -- which is why it never finished.

     Bigger pages, not parallel ones: firing them at once was tried and took the whole system
     down by exhausting the connection pool. */
  const t = fakeTable(12000);
  const out = await fetchAll(t.build);
  assert.equal(out.length, 12000, 'every row still arrives');
  assert.ok(t.trips <= 3, 'twelve thousand rows in at most three journeys, not twelve: ' + t.trips);
});

test('an error on any page is raised, never silently swallowed as a short read', async () => {
  const boom = () => ({ range: async () => ({ data: null, error: { message: 'nope' } }) });
  await assert.rejects(() => fetchAll(boom));
});

/* Asking for a thousand rows at a time meant thirty journeys to the database for one snapshot
   of thirty thousand customers. The dashboard needed 567 of them -- eighty-five seconds of
   waiting before a figure was worked out, on a platform that gives up at sixty.

   The fix is bigger pages, not parallel ones (that was tried and took the system down). But a
   server may enforce a lower ceiling SILENTLY, and treating a truncated page as "the end"
   would drop every row past it while the numbers still looked plausible. */
test('bigger pages, and a server ceiling is learned rather than assumed', async () => {
  const { fetchAll, MAX_PAGE } = await import('../api/_lib/supabase.js');
  const { fakeDb, setPageCap } = await import('./fake-db.mjs');

  const rows = Array.from({ length: 4500 }, (_, i) => ({ id: i }));
  const db = fakeDb({ big: rows });

  // A server with no ceiling: one request carries the lot.
  setPageCap(100000);
  let trips = 0;
  const count = () => { trips = 0; return () => { trips++; return db.from('big'); }; };
  let build = count();
  let out = await fetchAll(build);
  assert.equal(out.length, 4500, 'every row arrives');
  assert.equal(trips, 1, '4500 rows in one journey, not five');

  // A server that DOES cap, at a number below what we ask for. Every row must still arrive.
  setPageCap(1000);
  build = count();
  out = await fetchAll(build);
  assert.equal(out.length, 4500, 'a silent ceiling must not lose rows');
  assert.ok(trips >= 5, 'it pages under the ceiling: ' + trips);

  // The ceiling is NOT carried into the next read: a query that happened to return a round
  // number must not pin every later read to that size for the life of the process.
  setPageCap(100000);
  build = count();
  out = await fetchAll(build);
  assert.equal(out.length, 4500);
  assert.equal(trips, 1, 'the next read starts optimistic again');

  // And it does not ask for less than the server allows on later reads.
  assert.ok(MAX_PAGE >= 10000, 'the page we ask for is worth asking for');
  setPageCap(100000);
});

/* =====================================================================================
   OFFSET/LIMIT WITHOUT AN ORDER BY IS NOT A STABLE SLICE.
   =====================================================================================
   Reported from the field:

     "The dashboard reads different stats after every visit or refresh without even any
      update being uploaded."

   Nothing was uploaded and nothing in our arithmetic is random. Postgres only promises a row
   order when the query asks for one, and on a big table it genuinely does not give the same
   one twice: `synchronize_seqscans` is on by default, so a sequential scan joins whichever
   scan is already running, wherever it has got to, and wraps round at the end. Two requests
   for the same unchanged rows come back rotated against each other.

   Page 1 is then rows 0-9,999 of one ordering and page 2 is rows 10,000-19,999 of a different
   one -- so some customers arrive twice, others not at all, and the total moves by a
   plausible-looking amount with no error anywhere.

   setUnstableOrder(true) makes the fake behave that way, which is the only way to have a test
   that fails on the old code. */
test('a paged read is complete and identical every time, however the database reorders', async () => {
  const { fakeDb, setPageCap, setUnstableOrder } = await import('./fake-db.mjs');
  const { fetchAll } = await import('../api/_lib/supabase.js');

  const rows = Array.from({ length: 4500 }, (_, i) => ({ id: 'r' + String(i).padStart(5, '0'), n: i }));
  const db = fakeDb({ repayment_snapshots: rows });
  setPageCap(1000);          // five pages, so the reordering has somewhere to bite
  setUnstableOrder(true);
  try {
    const seen = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const out = await fetchAll(() => db.from('repayment_snapshots').select('*'));
      assert.equal(out.length, 4500, 'every row exactly once, no duplicates and none dropped');
      assert.equal(new Set(out.map(r => r.id)).size, 4500, 'and no row arrived twice');
      seen.push(out.reduce((s, r) => s + r.n, 0));
    }
    assert.equal(seen[0], 4500 * 4499 / 2, 'the total is the real one');
    assert.ok(seen.every(s => s === seen[0]),
      'and it is the SAME total on every refresh: ' + seen.join(' / '));
  } finally {
    setUnstableOrder(false);
    setPageCap(100000);
  }
});

test('the tiebreaker settles ties without overruling the sort the caller asked for', async () => {
  const { fakeDb } = await import('./fake-db.mjs');
  const { fetchAll } = await import('../api/_lib/supabase.js');
  /* A caller that orders by date descending must still get its dates in that order -- the
     tiebreaker only decides between rows the caller's sort left equal. Get this backwards and
     "the newest first" silently becomes "in id order", which is the kind of thing that is
     noticed months later on the wrong screen. */
  const db = fakeDb({ loans: [
    { id: 'c', approved_date: '2026-07-01' },
    { id: 'a', approved_date: '2026-07-03' },
    { id: 'b', approved_date: '2026-07-01' },
  ] });
  const out = await fetchAll(() => db.from('loans').select('*').order('approved_date', { ascending: false }));
  assert.deepEqual(out.map(r => r.id), ['a', 'b', 'c'],
    'newest date first, and the two equal dates in a fixed order rather than an accidental one');
});

test('a table whose key is not called id still gets a stable order', async () => {
  const { fakeDb, setPageCap, setUnstableOrder } = await import('./fake-db.mjs');
  const { fetchAll, pageKeyFor } = await import('../api/_lib/supabase.js');
  /* followup_status is keyed on `ref`, and it is one of the few big tables that really does
     page -- thirteen thousand defaulters. Ordering it by a column it does not have would be
     refused by the server, and the read would fall back to exactly the fault being fixed. */
  const db = fakeDb({ followup_status: Array.from({ length: 2500 }, (_, i) => ({ ref: 'F' + String(i).padStart(5, '0') })) });
  assert.equal(pageKeyFor(db.from('followup_status').select('*')), 'ref');
  assert.equal(pageKeyFor(db.from('repayment_snapshots').select('*')), 'id');

  setPageCap(1000);
  setUnstableOrder(true);
  try {
    const out = await fetchAll(() => db.from('followup_status').select('*'));
    assert.equal(new Set(out.map(r => r.ref)).size, 2500);
  } finally {
    setUnstableOrder(false);
    setPageCap(100000);
  }
});

test('the two tables with no id name their real keys instead of being refused first', async () => {
  const { fakeDb, setPageCap, setUnstableOrder } = await import('./fake-db.mjs');
  const { fetchAll, pageKeyFor } = await import('../api/_lib/supabase.js');
  /* THE ERROR STORM. `deck_totals` has no primary key at all and `deck_totals_days` is keyed
     on (kind, snapshot_date) -- neither has an `id`. Defaulting to one meant every read of
     them sent Postgres an `order=id.asc` it could only REJECT: PostgREST 400, a line in the
     Postgres error log, and only then the plain read. Two round trips instead of one, on the
     deck-totals cache -- which is asked on every totals question in the system, the phone's
     summary strip included. Twelve thousand Postgres errors a day against thirteen thousand
     Postgres requests, and this was the loudest part of it. */
  const db = fakeDb({ deck_totals: [], deck_totals_days: [] });
  assert.deepEqual(pageKeyFor(db.from('deck_totals_days').select('*')), ['kind', 'snapshot_date']);
  assert.deepEqual(pageKeyFor(db.from('deck_totals').select('*')),
    ['kind', 'snapshot_date', 'snapshot_type', 'weekday', 'team', 'upload_batch']);

  /* AND IT IS STILL A REAL TIEBREAKER. A multi-column key that is not unique would be worse
     than none -- see the note in supabase.js on what an ambiguous order does to a paged read.
     These are the columns the build GROUPs BY, so two rows cannot share them. */
  const rows = [];
  for (let i = 0; i < 2500; i++) {
    rows.push({ kind: 'expected', snapshot_date: '2026-07-' + String((i % 28) + 1).padStart(2, '0'),
      snapshot_type: 'today', weekday: 'MON', team: 'T' + (i % 40),
      upload_batch: 'b' + i, collected_amt: 1 });
  }
  const db2 = fakeDb({ deck_totals: rows });
  setPageCap(1000);
  setUnstableOrder(true);
  try {
    const out = await fetchAll(() => db2.from('deck_totals').select('*'));
    assert.equal(new Set(out.map(r => r.upload_batch)).size, 2500,
      'every row exactly once, across three pages, with the server shuffling between them');
  } finally {
    setUnstableOrder(false);
    setPageCap(100000);
  }
});

test('a server that will not accept the order still returns the rows', async () => {
  const { fetchAll } = await import('../api/_lib/supabase.js');
  /* An un-migrated table, a view, a renamed column: PostgREST answers 400 and names the
     column. A tiebreaker that cannot be applied must cost the read its determinism and
     NOTHING ELSE -- turning a working screen into an error would be far worse than the fault
     it is there to fix. */
  const rows = Array.from({ length: 30 }, (_, i) => ({ i }));
  let refusals = 0;
  const build = () => {
    let ordered = false;
    const q = {
      url: { pathname: '/rest/v1/repayment_snapshots' },
      order() { ordered = true; return q; },
      range: async (a, b) => {
        if (ordered) { refusals++; return { data: null, error: { message: 'column "id" does not exist' } }; }
        return { data: rows.slice(a, b + 1), error: null };
      },
    };
    return q;
  };
  const out = await fetchAll(build);
  assert.equal(out.length, 30, 'the rows still arrive');
  assert.ok(refusals > 0, 'and the tiebreaker really was attempted first');
});

test('a database that is down is reported, not retried into a second failure', async () => {
  const { fetchAll } = await import('../api/_lib/supabase.js');
  /* The fallback above must not swallow an outage. runQuery already retries transient
     failures three times; going round again without the order would make it six, against a
     database that is by then measurably struggling. */
  let trips = 0;
  const build = () => ({
    url: { pathname: '/rest/v1/teams' },
    order() { return this; },
    range: async () => { trips++; return { data: null, error: { message: 'fetch failed' } }; },
  });
  // PostgREST hands back a plain error OBJECT rather than an Error, which is what fetchAll
  // rethrows -- so this matches on the message rather than on the class.
  await assert.rejects(() => fetchAll(build), e => /fetch failed/.test(String(e && e.message)));
  assert.equal(trips, 3, 'three attempts, not six: ' + trips);
});

/* =====================================================================================
   A DATABASE FUNCTION IS CAPPED EXACTLY LIKE A TABLE READ.

     "i wonder why use sampling in a list that needs them all .. i fear many defaulters havent
      been reached in app followup by now"

   fetchAll has paged past the 1000-row cap since the beginning. Every `db.rpc(...)` in the
   system was a single bare request, and PostgREST truncates a function that returns a set at
   the same limit -- no error, no warning, row 1001 onward simply absent. A week of team-day
   totals is several thousand summary rows, so the weekly report and the dashboard were adding
   up a quarter of the week and the per-team date map lost every team past the cap.
   ===================================================================================== */

/** Stands in for a PostgREST function that returns `n` rows and truncates at 1000, counting
    how many requests it took to read the lot. */
function cappedRpc(n, cap = 1000) {
  const rows = Array.from({ length: n }, (_, i) => ({ i }));
  const stat = { calls: 0 };
  return { stat, db: { rpc() {
    const q = { rng: null, range(a, b) { q.rng = [a, b]; return q; },
      then(res, rej) {
        stat.calls++;
        const slice = q.rng ? rows.slice(q.rng[0], q.rng[1] + 1) : rows;
        return Promise.resolve({ data: slice.slice(0, cap), error: null }).then(res, rej);
      } };
    return q;
  } } };
}

test('a database function returning more than 1000 rows is read whole, not sampled', async () => {
  const { rpcAll } = await import('../api/_lib/supabase.js');
  const { db, stat } = cappedRpc(4200);
  const { data, error } = await rpcAll(db, 'snapshot_team_day_totals', { p_from: 'x' });
  assert.equal(error, null);
  assert.equal(data.length, 4200, 'every row arrives: ' + data.length);
  assert.deepEqual(data[0], { i: 0 });
  assert.deepEqual(data[4199], { i: 4199 }, 'including the last one, which used to be missing');
  assert.equal(stat.calls, 5, 'four full pages and one short one: ' + stat.calls);
});

test('an exactly-full last page still costs one more request, or the end is a guess', async () => {
  const { rpcAll } = await import('../api/_lib/supabase.js');
  const { db, stat } = cappedRpc(2000);
  const { data } = await rpcAll(db, 'f');
  assert.equal(data.length, 2000);
  assert.equal(stat.calls, 3, 'two full pages then an empty one: ' + stat.calls);
});

test('a short answer costs exactly one request -- paging must not tax the ordinary case', async () => {
  const { rpcAll } = await import('../api/_lib/supabase.js');
  const { db, stat } = cappedRpc(12);
  const { data } = await rpcAll(db, 'f');
  assert.equal(data.length, 12);
  assert.equal(stat.calls, 1, 'one: ' + stat.calls);
});

test('an aggregate function is executed ONCE, not once per thousand rows it hands back', async () => {
  const { rpcAll } = await import('../api/_lib/supabase.js');
  /* PostgREST applies .range() as LIMIT/OFFSET AROUND a function call, so page two does not
     resume anything: it RE-EXECUTES THE WHOLE FUNCTION and throws away the first thousand rows.
     On a function that is cheap per row that is merely slow; on one whose cost is an aggregate
     it is quadratic waste.

     MEASURED ON THE LIVE BOOK, and it was the largest single cost in the database.
     expected_phone_window -- one `select distinct` over a fortnight of expected sheets, which
     the phone rebuilds its number index from -- ran 162,762 times against 30,295 rebuilds. Five
     and a half executions per rebuild, of a query averaging 1,646 ms, to read about 5,400
     distinct customers a thousand at a time. Seventy-four hours of database time, on the path
     three hundred handsets sync. */
  const { db, stat } = cappedRpc(5400, Infinity);
  const { data } = await rpcAll(db, 'expected_phone_window', { p_from: '2026-08-23' });
  assert.equal(data.length, 5400, 'every customer in the window, still');
  assert.equal(stat.calls, 1, 'and the function ran ONCE, not six times: ' + stat.calls);
});

test('a server ceiling above a thousand is learned, never mistaken for the end of the rows', async () => {
  const { rpcAll } = await import('../api/_lib/supabase.js');
  /* Asking for ten thousand from a server that allows five thousand returns a SILENTLY
     truncated page. Reading that as "the end" would drop every row past it and leave a total
     that still looks plausible -- which is the failure this file already carries scars from,
     and the reason the bigger page is only safe with the ceiling learned. */
  const { db, stat } = cappedRpc(12000, 5000);
  const { data } = await rpcAll(db, 'f');
  assert.equal(data.length, 12000, 'nothing dropped past the ceiling: ' + data.length);
  assert.deepEqual(data[11999], { i: 11999 }, 'including the last row');
  assert.equal(stat.calls, 4, 'two at the learned size, the remainder, then the empty one: ' + stat.calls);
});

test('a client that cannot page is answered rather than broken -- and costs nothing extra', async () => {
  const { rpcAll } = await import('../api/_lib/supabase.js');
  /* The first version of rpcAll built a throwaway call purely to look for `.range` on it. On the
     real client that is free, but it is still one more call than the work needs, and the speed
     guards count calls. They were right to: the capability has to be read off the same builder
     the page is sent on. */
  let calls = 0;
  const db = { rpc: async () => { calls++; return { data: [{ i: 1 }], error: null }; } };
  const { data, error } = await rpcAll(db, 'f');
  assert.equal(error, null);
  assert.deepEqual(data, [{ i: 1 }]);
  assert.equal(calls, 1, 'one call, no probe: ' + calls);
});

test('an error on a later page is reported, not silently returned as a part answer', async () => {
  const { rpcAll } = await import('../api/_lib/supabase.js');
  /* Returning the pages that did arrive would be the same fault in a new coat: a plausible
     total, quietly short. */
  let calls = 0;
  const db = { rpc() {
    const q = { range: () => q, then(res, rej) {
      calls++;
      if (calls === 1) return Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ i })), error: null }).then(res, rej);
      return Promise.resolve({ data: null, error: { message: 'permission denied for function f' } }).then(res, rej);
    } };
    return q;
  } };
  const { data, error } = await rpcAll(db, 'f');
  assert.equal(data, null, 'no half answer');
  assert.match(String(error.message), /permission denied/);
});

test('a function that never returns a short page stops loudly instead of never ending', async () => {
  const { rpcAll } = await import('../api/_lib/supabase.js');
  const db = { rpc() {
    const q = { range: () => q, then: (res, rej) =>
      Promise.resolve({ data: Array.from({ length: 1000 }, (_, i) => ({ i })), error: null }).then(res, rej) };
    return q;
  } };
  await assert.rejects(() => rpcAll(db, 'runaway'), /more than 500,000 rows/);
});
