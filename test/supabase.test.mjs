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
