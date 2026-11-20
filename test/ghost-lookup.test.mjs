// The all-time ghost lookup (api/_lib/expdf.js, ghostRowsFor_ / readGhosts_) when the database is
// slow or refuses: the last good list stays on the screen, the pause after a failure holds, and
// nothing is asked twice. The cache reads its own 90-second and five-minute windows off
// Date.now(), so each test steps a fake clock instead of waiting for them.
//
// 20 Nov 2026. The Postgres logs showed statement timeouts about eight a minute at midday, and
// this lookup is a statement that can run long. Before this, a read that failed threw away the
// list the last good read had found and answered nothing for five minutes: every customer who had
// left the book vanished from the Exp.Def lists and the phone's list for five minutes at a time
// (the owner, 13, 15 and 16 Nov: "they should stay there", "i expect that customer in initial
// never to get lost"). A read that was only late did the same.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { ghostRowsFor_ } = await import('../api/_lib/expdf.js');

const T0 = Date.parse('2026-11-20T09:00:00Z');
const SEC = 1000, MIN = 60 * SEC;
const realNow = Date.now;
let offset = 0;
/* The fake clock is on for the whole of a test and put back after it, so a read that lands late
   (a test below makes one) never stamps the cache with the real clock beside a fake one. */
const withClock = fn => async () => {
  offset = 0;
  Date.now = () => T0 + offset;
  try { await fn(); } finally { Date.now = realNow; }
};

const row = (ref, team = 'KONGOWE') => ({ ref, team, arrears: 15500, status: 'Chronic' });
const good = (...refs) => ({ data: refs.map(r => row(r)), error: null });
const TIMEOUT = { data: null, error: { message: 'canceling statement due to statement timeout' } };
const MISSING = { data: null, error: { message: 'Could not find the function public.defaulter_ghost_rows(p_known_refs, p_teams) in the schema cache' } };
const refsOf = list => list.map(r => r.ref).sort();

/* A database whose answers are written down in order (the last one repeats), and which counts how
   many times it was asked. An answer that is a function is called, and may return a promise. */
function scripted(answers, args) {
  const db = {
    asked: 0,
    seen: [],
    rpc(name, a) {
      db.seen.push([name, a]);
      const next = answers[Math.min(db.asked, answers.length - 1)];
      db.asked++;
      return typeof next === 'function' ? next() : Promise.resolve(next);
    },
  };
  return db;
}

test('a refresh that fails keeps the last good list on the screen, and the pause after it holds', withClock(async () => {
  const db = scripted([good('G1', 'G2'), TIMEOUT, good('G1', 'G2', 'G3')]);
  assert.deepEqual(refsOf(await ghostRowsFor_(db, ['KONGOWE'], [])), ['G1', 'G2'], 'the first read');
  assert.equal(db.asked, 1);

  offset = 60 * SEC;     // a good answer is kept for 90 seconds, and asked for nothing in that time
  assert.deepEqual(refsOf(await ghostRowsFor_(db, ['KONGOWE'], [])), ['G1', 'G2']);
  assert.equal(db.asked, 1, 'not asked again while the good answer is fresh');

  offset = 100 * SEC;    // past the 90-second life of a good answer: a fresh read is asked for, and the database refuses it
  assert.deepEqual(refsOf(await ghostRowsFor_(db, ['KONGOWE'], [])), ['G1', 'G2'], 'refused: the last good list stands, not nothing');
  assert.equal(db.asked, 2);

  offset = 160 * SEC;    // inside the five-minute pause that follows a refusal
  assert.deepEqual(refsOf(await ghostRowsFor_(db, ['KONGOWE'], [])), ['G1', 'G2'], 'inside the pause: still the last good list');
  assert.equal(db.asked, 2, 'and the database is not asked again inside the pause');

  offset = 100 * SEC + 5 * MIN + SEC;    // the pause is over
  assert.deepEqual(refsOf(await ghostRowsFor_(db, ['KONGOWE'], [])), ['G1', 'G2', 'G3'], 'asked again once the pause is over, and the new answer is the list');
  assert.equal(db.asked, 3);
}));

test('a read still out when its budget ends answers the last good list, and lands in the cache for the next caller', withClock(async () => {
  // The second read answers after 120 ms (a real timer: the budget's own timer is unref'd, so with nothing else
  // holding the event loop open the runner would end the test under it).
  const db = scripted([good('G1'), () => new Promise(res => setTimeout(() => res(good('G1', 'G9')), 120))]);
  assert.deepEqual(refsOf(await ghostRowsFor_(db, ['A', 'B'], [], 25)), ['G1']);

  offset = 100 * SEC;
  const t0 = realNow();
  // The same two teams in the other order: one cache entry, the way readGhosts_ keys it.
  const late = await ghostRowsFor_(db, ['B', 'A'], [], 25);
  assert.deepEqual(refsOf(late), ['G1'], 'the fresh read was not back at the end of the budget: the last good list, not nothing');
  assert.ok(realNow() - t0 < 300, 'and the caller was not kept for it: ' + (realNow() - t0) + ' ms');
  assert.equal(db.asked, 2);

  await new Promise(r => setTimeout(r, 160));    // the read that outlived its budget lands
  offset = 110 * SEC;
  assert.deepEqual(refsOf(await ghostRowsFor_(db, ['A', 'B'], [], 25)), ['G1', 'G9'], 'what it found is in the cache for the next caller');
  assert.equal(db.asked, 2, 'which was not asked for a third time');
}));

test('with no good read to fall back on the answer is nothing, as it always was, and the pause still holds', withClock(async () => {
  const db = scripted([MISSING]);
  assert.deepEqual(await ghostRowsFor_(db, ['KONGOWE'], []), [], 'a database that has not had RUN-ME-055 run: no ghosts, no failed request');
  offset = 60 * SEC;
  assert.deepEqual(await ghostRowsFor_(db, ['KONGOWE'], []), []);
  assert.equal(db.asked, 1, 'and it is asked once, not on every request');
  offset = 5 * MIN + SEC;
  await ghostRowsFor_(db, ['KONGOWE'], []);
  assert.equal(db.asked, 2, 'again when the five minutes are over');

  // The very first read, if it is late, has no list to fall back on either. (A DELAYED answer, never a promise that
  // never settles: node's test runner cancels every later test of the file on a promise left pending for ever.)
  const slow = scripted([() => new Promise(res => setTimeout(() => res(good('G1')), 120))]);
  assert.deepEqual(await ghostRowsFor_(slow, ['KONGOWE'], [], 25), [], 'a first read that is late, and nothing before it');
  await new Promise(r => setTimeout(r, 160));    // it lands, inside this test, under the fake clock
  assert.deepEqual(refsOf(await ghostRowsFor_(slow, ['KONGOWE'], [], 25)), ['G1'], 'and is the list for the next caller');
  assert.equal(slow.asked, 1);
}));

test('a ref today\'s own deck names is never a ghost, however old the list that stands in', withClock(async () => {
  const db = scripted([good('G1', 'G2'), TIMEOUT]);
  assert.deepEqual(refsOf(await ghostRowsFor_(db, ['KONGOWE'], [])), ['G1', 'G2']);
  offset = 100 * SEC;
  const standIn = await ghostRowsFor_(db, ['KONGOWE'], [' g2 ']);    // today's deck names G2 (blanks and case aside)
  assert.deepEqual(refsOf(standIn), ['G1'], 'the stand-in list is filtered by what today\'s deck names, as a fresh one is');
  assert.ok(standIn.every(r => r._ghost === true), 'and what is left is marked as a ghost');
}));

test('one team set failing does not touch another\'s list', withClock(async () => {
  const db = {
    asked: 0,
    rpc(name, a) {
      db.asked++;
      const mine = a.p_teams.includes('A');
      return Promise.resolve(db.asked > 2 && mine ? TIMEOUT : good(mine ? 'GA' : 'GB'));
    },
  };
  assert.deepEqual(refsOf(await ghostRowsFor_(db, ['A'], [])), ['GA']);
  assert.deepEqual(refsOf(await ghostRowsFor_(db, ['B'], [])), ['GB']);
  offset = 100 * SEC;
  assert.deepEqual(refsOf(await ghostRowsFor_(db, ['A'], [])), ['GA'], 'the refused set keeps its own last list');
  assert.deepEqual(refsOf(await ghostRowsFor_(db, ['B'], [])), ['GB'], 'the other set is read fresh and is not told about the refusal');
  assert.equal(db.asked, 4);
}));

test('a read that fails at once is remembered, never forgotten and asked for ever', withClock(async () => {
  /* The real client does not throw where it is called (its builder answers later), so this cannot
     happen on the live site. It is what a read that fails the moment it is asked for looks like: the
     entry used to be written after the read started and overwrote the memory of the failure with a
     settled promise, and a server instance then answered nothing, and asked for nothing, until it
     was restarted. */
  const db = { asked: 0, rpc() { db.asked++; throw new Error('refused at once'); } };
  assert.deepEqual(await ghostRowsFor_(db, ['KONGOWE'], []), []);
  offset = 60 * SEC;
  assert.deepEqual(await ghostRowsFor_(db, ['KONGOWE'], []), []);
  assert.equal(db.asked, 1, 'the pause holds');
  offset = 5 * MIN + SEC;
  await ghostRowsFor_(db, ['KONGOWE'], []);
  assert.equal(db.asked, 2, 'and when it is over the database is asked again');
}));

test('what is asked of the database is unchanged: one call, the teams and the refs today\'s deck names', withClock(async () => {
  const db = scripted([good('G1')]);
  await ghostRowsFor_(db, ['KONGOWE', 'TEMEKE'], ['r1', ' r2']);
  assert.equal(db.asked, 1);
  assert.equal(db.seen[0][0], 'defaulter_ghost_rows');
  assert.deepEqual(db.seen[0][1], { p_teams: ['KONGOWE', 'TEMEKE'], p_known_refs: ['R1', 'R2'] });
}));
