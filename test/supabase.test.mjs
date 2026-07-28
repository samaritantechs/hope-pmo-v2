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

test('big tables are read in waves, not one page at a time', async () => {
  // 12,000 rows is twelve pages. Read one after another that is twelve waits laid end to end;
  // in waves of six it is two. This is the difference an officer feels as a spinner.
  const t = fakeTable(12000);
  await fetchAll(t.build);
  assert.equal(t.trips, 13);              // 1 first page + two waves of six
  assert.ok(t.trips <= 13, 'should not be reading page by page');
});

test('an error on any page is raised, never silently swallowed as a short read', async () => {
  const boom = () => ({ range: async () => ({ data: null, error: { message: 'nope' } }) });
  await assert.rejects(() => fetchAll(boom));
});
