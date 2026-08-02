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
