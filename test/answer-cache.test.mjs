// THE SAME QUESTION, ASKED ONCE -- including while it is still being answered.
//
//   "Seva haijibu ndani ya sekunde 45" -- and then again, and again, as people pressed the tab.
//
// Only a finished answer used to be remembered, so every retry of a slow dashboard started a
// second full computation beside the first. The pending computation is now shared.
import test from 'node:test';
import assert from 'node:assert/strict';
// The cache imports the snapshot helpers, which build the Supabase client at load -- the same
// stand-in environment every other test file sets before importing.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { cachedAnswer, ANSWER_TTL_MS } = await import('../api/_lib/answer-cache.js');

const NOW = Date.parse('2026-09-02T06:00:00Z');
const ADMIN = { teams: null };

test('two people asking while the first answer is still computing share one computation', async () => {
  const db = {};
  let runs = 0, release;
  const gate = new Promise(r => { release = r; });
  const compute = async () => { runs += 1; await gate; return { n: runs }; };
  const a = cachedAnswer(db, 'dash', ADMIN, NOW, compute);
  const b = cachedAnswer(db, 'dash', ADMIN, NOW + 1000, compute);
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(runs, 1, 'one computation, however many pressed the tab');
  assert.deepEqual(ra, rb);
  // And the finished answer is remembered for the minute, as before.
  const c = await cachedAnswer(db, 'dash', ADMIN, NOW + 5000, compute);
  assert.equal(runs, 1);
  assert.deepEqual(c, ra);
  const d = await cachedAnswer(db, 'dash', ADMIN, NOW + ANSWER_TTL_MS + 1, compute);
  assert.equal(runs, 2, 'past the minute it is asked afresh');
  assert.deepEqual(d, { n: 2 });
});

test('a computation that fails is forgotten at once, so the next press asks afresh', async () => {
  const db = {};
  let runs = 0;
  const failing = async () => { runs += 1; throw new Error('database away'); };
  await assert.rejects(() => cachedAnswer(db, 'dash', ADMIN, NOW, failing), /database away/);
  const ok = await cachedAnswer(db, 'dash', ADMIN, NOW + 10, async () => { runs += 1; return 'fine'; });
  assert.equal(ok, 'fine');
  assert.equal(runs, 2);
});

test('different scopes never share a computation', async () => {
  const db = {};
  let runs = 0;
  const compute = async () => { runs += 1; return runs; };
  await Promise.all([
    cachedAnswer(db, 'dash', { teams: ['KONGOWE'] }, NOW, compute),
    cachedAnswer(db, 'dash', { teams: ['MBAGALA'] }, NOW, compute),
  ]);
  assert.equal(runs, 2);
});
