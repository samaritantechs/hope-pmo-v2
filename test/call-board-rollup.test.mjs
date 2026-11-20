// The dashboard's and the Presentation's call boards from ONE database answer (db/RUN-ME-078: call_board_rollup), and the old read kept as the
// fall-back -- through the real portal dispatch, on a fake database that either HAS the function or has NOT been given it yet.
//
// "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner, 20 Nov 2026. pg_stat_statements put the read of the
// whole week of call logs, in pages, second in the whole book (121,746 calls, 70,285 seconds). The boards are figures people are judged on, so the
// function's answer is held equal to what the rows give: here at the app's level (the same boards from either source, the same arguments, no read of
// call_logs when the function answers, a fall-back that never shows nobody), and in tools/db-checks/call-board-rollup.mjs on a real PostgreSQL (the
// SQL against boardRowsFromLogs on random books, with deliberate breaks). The last tests pin the file, the wiring and the docs together.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fakeDb } from './fake-db.mjs';
import { CALL_BOARD_RPC } from './snapshot-totals-rpc.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');
const { teamMatchList } = await import('../api/_lib/snapshots.js');
const { USER_TABS } = await import('../api/_lib/auth.js');

const NOW = Date.parse('2026-07-24T09:00:00Z');                    // Friday noon EAT: the week is 2026-07-20 .. 2026-07-26
const MON = '2026-07-20', SUN = '2026-07-26', TODAY = '2026-07-24';
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] };
const viewer = teams => ({ code: 'G', name: 'JUMA G', role: 'GMO', teams, tabs: USER_TABS.slice() });
const run = (db, user = ADMIN, nowMs = NOW) => portalApi(db, user, 'officerBoards', {}, nowMs);
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const L = (id, officer, team, phone, date, extra = {}) => ({ id, officer, team, phone, call_date: date, duration: 0, portfolio: false, outcome: 'CONNECTED', ref: null, category: null, ...extra });
function calls() {
  return [
    L('a01', ' JUMA G', 'KONGOWE', '0712000001', TODAY, { duration: 30, portfolio: true, ref: 'R1', category: 'EXPECTED' }),
    L('a02', 'JUMA G ', 'KONGOWE', '0712000001', TODAY, { duration: 0, portfolio: true, ref: 'R1', category: 'DEFAULTER', outcome: 'MISSED' }),
    L('a03', 'JUMA G', 'KONGOWE', '0712000002', TODAY, { duration: 1200, portfolio: false }),
    L('a04', 'JUMA G', 'KONGOWE', '0712000003', '2026-07-21', { duration: 45, portfolio: true, ref: '', category: 'EXPECTED' }),
    L('a05', 'AMINA K', 'MBAGALA', '0788000001', TODAY, { duration: 12 }),
    L('a06', 'AMINA K', 'MBAGALA', '0788000002', '2026-07-25', { duration: 9, portfolio: true, ref: 'R7' }),
    L('a07', '', 'KONGOWE', '0799000001', TODAY, { duration: 5 }),
    L('a08', 'MARY M', null, '0799000002', '2026-07-22', { duration: 60, portfolio: true, ref: 'R8', outcome: 'REJECTED' }),
    L('a09', 'OLD O', 'KONGOWE', '0799000003', '2026-07-17', { duration: 99, portfolio: true }),     // last week: outside the window
    L('a10', 'Kongowe Kim', 'Kongowe ', '0799000004', TODAY, { duration: 40, portfolio: true, ref: 'R9' }),
  ];
}
const tables = () => ({
  call_logs: calls(),
  call_users: [
    { user_id: 'U1', name: 'AMINA K', team: 'MBAGALA', role: 'OFFICER' },
    { user_id: 'U2', name: 'SILENT S', team: 'KONGOWE', role: 'OFFICER' },
    { user_id: 'U3', name: 'GONE G', team: 'KONGOWE', role: 'OFFICER', active: false },
  ],
});
/* Counts what the screen asks of the database: reads of call_logs, and the arguments of every rpc. */
function watch(db) {
  const log = { reads: [], rpcs: [], ins: [] };
  const from = db.from.bind(db), rpc = db.rpc.bind(db);
  db.from = name => {
    const q = from(name);
    if (name !== 'call_logs') return q;
    log.reads.push(name);
    const orig = q.in.bind(q);
    q.in = (col, list) => { log.ins.push([col, list]); return orig(col, list); };       // what onTeams sends
    return q;
  };
  db.rpc = (name, args) => { if (name === 'call_board_rollup') log.rpcs.push(args); return rpc(name, args); };
  return log;
}
const boards = b => ({ callWeek: b.callWeek, callToday: b.callToday, callWeekWorst: b.callWeekWorst });

test('with the function installed the boards equal the boards added up from the rows, and call_logs is not read', async () => {
  const plain = fakeDb(tables()), wlog = watch(plain);
  const fn = fakeDb(tables(), { rpc: CALL_BOARD_RPC }), flog = watch(fn);
  const a = await run(plain), b = await run(fn);
  assert.ok(a.callWeek.length >= 5, 'a board with several officers, so equality means something: ' + a.callWeek.length);
  assert.deepEqual(boards(b), boards(a), 'the same boards from either source: the week, today and the other end of the week');
  assert.deepEqual(flog.rpcs, [{ p_from: MON, p_to: SUN, p_day: TODAY, p_teams: null }], 'one question, the week from Monday, today, and no team list for the admin');
  assert.equal(flog.reads.length, 0, 'call_logs is not read at all: that is the saving');
  assert.ok(wlog.reads.length >= 1, 'without the function the old read is made');
  assert.equal(wlog.rpcs.length, 1, 'and the function is asked for once');
  // the rule itself, so that equality is not two copies of one mistake
  const juma = b.callWeek.find(r => r.agent === 'JUMA G'), today = b.callToday.find(r => r.agent === 'JUMA G');
  assert.equal(juma.dials, 4);
  assert.equal(juma.calls, 3, 'two numbers today (redials and both spellings of the name are one officer) and one on Tuesday');
  assert.equal(juma.duration, 75, 'portfolio talk time only: 30 + 45; the twenty-minute chat on a non-portfolio number scores nothing');
  assert.equal(juma.otherDuration, 1200);
  assert.equal(today.calls, 2);
  assert.equal(today.dials, 3);
  assert.equal(b.callWeek.find(r => r.agent === '(unknown)').calls, 1, 'a blank officer is "(unknown)"');
  assert.equal(b.callWeek.find(r => r.agent === 'OLD O'), undefined, 'last week is outside the window');
  assert.equal(b.callToday.find(r => r.agent === 'MARY M'), undefined, 'a call on Wednesday is not today\'s');
  assert.equal(b.callWeek.find(r => r.agent === 'SILENT S').calls, 0, 'an officer who made no calls is still on the board');
  assert.equal(b.callWeek.find(r => r.agent === 'GONE G'), undefined, 'a switched-off account is not');
  assert.deepEqual(b.callWeekWorst, b.callWeek.slice().reverse());
});

test('a number rung under two categories on one day is still one call: the boards have never selected category', async () => {
  const t = tables(); t.call_logs = [
    L('c1', 'JUMA G', 'KONGOWE', '0712000009', TODAY, { duration: 10, portfolio: true, ref: 'R1', category: 'EXPECTED' }),
    L('c2', 'JUMA G', 'KONGOWE', '0712000009', TODAY, { duration: 10, portfolio: true, ref: 'R1', category: 'DEFAULTER' }),
  ];
  for (const opts of [{}, { rpc: CALL_BOARD_RPC }]) {
    const b = await run(fakeDb(t, opts));
    const j = b.callWeek.find(r => r.agent === 'JUMA G');
    assert.equal(j.calls, 1, 'one number is one call ' + (opts.rpc ? 'from the function' : 'from the rows'));
    assert.equal(j.dials, 2);
  }
});

test('a viewer\'s teams reach the database exactly as the .in() always sent them, and the boards stay inside them', async () => {
  const teams = ['Kongowe ', 'mbagala'];
  const fn = fakeDb(tables(), { rpc: CALL_BOARD_RPC }), flog = watch(fn);
  const plain = fakeDb(tables()), wlog = watch(plain);
  const u = viewer(teams);
  const b = await run(fn, u), a = await run(plain, u);
  assert.equal(wlog.ins.length, 1, 'the old read filters on team once');
  assert.equal(wlog.ins[0][0], 'team');
  assert.deepEqual(flog.rpcs[0].p_teams, wlog.ins[0][1], 'the very list the old read\'s .in() sent (onTeams: teamMatchList of the viewer\'s teams)');
  assert.ok(flog.rpcs[0].p_teams.includes('MBAGALA') && flog.rpcs[0].p_teams.includes('KONGOWE') && flog.rpcs[0].p_teams.includes('mbagala'), 'and it is the list of spellings, not the viewer\'s teams as typed');
  assert.ok(teamMatchList(['x']).length >= 1);
  assert.deepEqual(boards(b), boards(a));
  assert.ok(b.callWeek.some(r => r.agent === 'AMINA K'));
  assert.equal(b.callWeek.find(r => r.agent === 'MARY M'), undefined, 'a call with no team is nobody\'s to see');
  const kongowe = await run(fakeDb(tables(), { rpc: CALL_BOARD_RPC }), viewer(['KONGOWE']));
  assert.equal(kongowe.callWeek.find(r => r.agent === 'AMINA K'), undefined, 'another team\'s officer is not on a KONGOWE viewer\'s board');
  assert.ok(kongowe.callWeek.find(r => r.agent === 'JUMA G'));
});

test('a viewer who holds no teams sees no calls, and nothing is read or asked for them', async () => {
  const fn = fakeDb(tables(), { rpc: CALL_BOARD_RPC }), flog = watch(fn);
  const b = await run(fn, viewer([]));
  assert.deepEqual(b.callWeek, []);
  assert.deepEqual(b.callToday, []);
  assert.equal(flog.reads.length + flog.rpcs.length, 0);
  assert.deepEqual(boards(await run(fakeDb(tables()), viewer([]))), boards(b), 'as the old read, which dropped every row');
});

test('a function that is missing, throws or answers a wrong shape falls back to the rows: never an empty board', async () => {
  const want = boards(await run(fakeDb(tables())));
  const states = {
    'not installed': {},
    'throws': { rpc: { call_board_rollup: () => { throw new Error('boom'); } } },
    'a list, not the value': { rpc: { call_board_rollup: () => [] } },
    'no week': { rpc: { call_board_rollup: () => ({ t: [] }) } },
    'a week that is not a list': { rpc: { call_board_rollup: () => ({ w: 'x', t: [] }) } },
    'a row with no name': { rpc: { call_board_rollup: () => ({ w: [{ calls: 1, dials: 1 }], t: [] }) } },
    'a row with no figures': { rpc: { call_board_rollup: () => ({ w: [{ name: 'X' }], t: [] }) } },
    'null': { rpc: { call_board_rollup: () => null } },
  };
  for (const [label, opts] of Object.entries(states)) {
    const db = fakeDb(tables(), opts), log = watch(db);
    const got = await run(db);
    assert.deepEqual(boards(got), want, label + ': the boards are the boards the rows give');
    assert.ok(log.reads.length >= 1, label + ': and they were read the old way');
  }
});

test('a function that failed is not asked again for five minutes, and is asked again after', async () => {
  const db = fakeDb(tables()), log = watch(db);
  const realNow = Date.now;
  try {
    const t0 = realNow.call(Date);
    Date.now = () => t0;
    await run(db, ADMIN, NOW);
    assert.equal(log.rpcs.length, 1, 'asked once, and missing');
    await run(db, ADMIN, NOW + 61000);                     // the one-minute answer has expired; the pause has not
    assert.equal(log.rpcs.length, 1, 'not asked again inside five minutes');
    assert.equal(log.reads.length, 2, 'the rows were read both times');
    Date.now = () => t0 + 5 * 60 * 1000 + 1000;
    await run(db, ADMIN, NOW + 2 * 61000);
    assert.equal(log.rpcs.length, 2, 'asked again after the pause');
  } finally { Date.now = realNow; }
});

/* THE LAST GOOD BOARD STANDS IN WHEN THE DATABASE IS ONLY BRIEFLY UNREACHABLE -- 20 Nov 2026 (handbook Part 123).
     "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner

   The owner's second pg_stat_statements paste: the old week read ran 810 times (about 58 boards) beside 31 runs of the function:
   when the function failed once, every board of the next five minutes was fifteen statements, made when the database was
   already busy. A failure that is the database being busy or unreachable (isTransient) leaves the last answer only older, so for ten
   minutes it stands in, and says how old it is (callsStaleS). Every other failure is a fault, answered by the old read as before. */
function flakyBoards_() {
  const db = fakeDb(tables(), { rpc: CALL_BOARD_RPC }), real = db.rpc.bind(db), state = { fail: null, asked: 0 };
  db.rpc = (name, args) => {
    if (name !== 'call_board_rollup') return real(name, args);
    state.asked++;
    if (!state.fail) return real(name, args);
    const f = state.fail;
    return typeof f === 'function' ? f() : Promise.resolve(f);                  // an error PostgREST RETURNS, or one the client THROWS
  };
  return { db, state };
}
const TIMEOUT_ = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
function clock_() {
  const real = Date.now, t0 = real.call(Date);
  return { at: (ms, base = NOW) => { Date.now = () => t0 + ms; return base + ms; }, restore: () => { Date.now = real; } };
}

test('when the database is only briefly unreachable the last good boards stand in for ten minutes, say how old they are, and the week is not read', async () => {
  const c = clock_();
  try {
    const { db, state } = flakyBoards_(), log = watch(db);
    const good = await run(db, ADMIN, c.at(0));
    assert.equal(good.callsStaleS, undefined, 'a board from the function carries no age');
    state.fail = TIMEOUT_;
    for (const s of [61, 125, 200, 400, 560]) {                                  // every one is past the one-minute answer
      const got = await run(db, ADMIN, c.at(s * 1000));
      assert.deepEqual(boards(got), boards(good), s + ' s: the same boards');
      assert.equal(got.callsStaleS, s, s + ' s: and the answer says how old they are');
    }
    assert.equal(log.reads.length, 0, 'the week of calls was not read');
    assert.equal(state.asked, 3, 'the function: at 0 s, at 61 s (it fails: five minutes of pause), at 400 s (it fails again)');
    const old = await run(db, ADMIN, c.at(625 * 1000));                           // ten minutes old (and past the one-minute answer of the last): it no longer stands in
    assert.deepEqual(boards(old), boards(good), 'the boards are the boards the rows give');
    assert.equal(old.callsStaleS, undefined, 'and they are not marked old');
    assert.ok(log.reads.length >= 1, 'read the old way');
  } finally { c.restore(); }
});

test('every way the database can be briefly unreachable stands in for the boards: a returned error, a thrown one, a full pool, the network', async () => {
  const moments = {
    'a statement timeout, returned': TIMEOUT_,
    'a full connection pool, returned': { data: null, error: { code: 'PGRST003', message: 'Timed out acquiring connection from connection pool.' } },
    'a gateway page, returned': { data: null, error: { message: '<!DOCTYPE html><html><title>522: Connection timed out</title>' } },
    'the network, thrown': () => { throw new TypeError('fetch failed'); },
    'a timeout, thrown': () => { throw new Error('canceling statement due to statement timeout'); },
  };
  for (const [name, fail] of Object.entries(moments)) {
    const c = clock_();
    try {
      const { db, state } = flakyBoards_(), log = watch(db);
      const good = await run(db, ADMIN, c.at(0));
      state.fail = fail;
      const got = await run(db, ADMIN, c.at(61000));
      assert.deepEqual(boards(got), boards(good), name);
      assert.equal(got.callsStaleS, 61, name + ': marked old');
      assert.equal(log.reads.length, 0, name + ': the week was not read');
    } finally { c.restore(); }
  }
});

test('a function that is not installed, refused, or that answers a shape it does not make is a fault: the old read answers, never the last board', async () => {
  const faults = {
    'not installed (what PostgREST says)': { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.call_board_rollup(p_day, p_from, p_teams, p_to) in the schema cache' } },
    'refused': { data: null, error: { code: '42501', message: 'permission denied for function call_board_rollup' } },
    'a shape it does not make': { data: { w: 'x', t: [] }, error: null },
    'a row with no figures': { data: { w: [{ name: 'X' }], t: [] }, error: null },
    'nothing at all': { data: null, error: null },
    'a call that throws something that is not a bad moment': () => { throw new Error('boom'); },
  };
  for (const [name, answer] of Object.entries(faults)) {
    const c = clock_();
    try {
      const { db, state } = flakyBoards_(), log = watch(db);
      const good = await run(db, ADMIN, c.at(0));
      state.fail = answer;
      const got = await run(db, ADMIN, c.at(61000));
      assert.deepEqual(boards(got), boards(good), name + ': the boards are the boards the rows give');
      assert.equal(got.callsStaleS, undefined, name + ': and not marked old');
      assert.ok(log.reads.length >= 1, name + ': the week was read the old way');
      const reads = log.reads.length;
      const paused = await run(db, ADMIN, c.at(125000));                          // inside the five minutes the fault began: a fault is not a bad moment then either
      assert.equal(paused.callsStaleS, undefined, name + ': not handed out in the pause');
      assert.ok(log.reads.length > reads, name + ': the week was read again the old way');
    } finally { c.restore(); }
  }
});

test('a board that failed the shape check is never kept as the last good one', async () => {
  const c = clock_();
  try {
    const { db, state } = flakyBoards_(), log = watch(db);
    const good = await run(db, ADMIN, c.at(0));
    state.fail = { data: { w: 'x', t: [] }, error: null };                       // a fault: answered by the rows
    await run(db, ADMIN, c.at(61000));
    state.fail = TIMEOUT_;                                                       // and, once the five minutes of pause are over, a bad moment
    log.reads.length = 0;
    const got = await run(db, ADMIN, c.at(400000));
    assert.deepEqual(boards(got), boards(good), 'what stands in is the board the function made at 0 s, not the answer that was refused');
    assert.equal(got.callsStaleS, 400);
    assert.equal(log.reads.length, 0);
  } finally { c.restore(); }
});

test('ten minutes exactly is no longer a board that stands in, and a clock that went backwards never makes one younger', async () => {
  {
    const c = clock_();
    try {
      const { db, state } = flakyBoards_(), log = watch(db);
      await run(db, ADMIN, c.at(0));
      state.fail = TIMEOUT_;
      const got = await run(db, ADMIN, c.at(600 * 1000));
      assert.equal(got.callsStaleS, undefined);
      assert.ok(log.reads.length >= 1, 'read the old way');
    } finally { c.restore(); }
  }
  {
    const c = clock_();
    try {
      const { db, state } = flakyBoards_(), log = watch(db);
      await run(db, ADMIN, c.at(300000));
      state.fail = TIMEOUT_;
      const got = await run(db, ADMIN, c.at(100000));                            // the process clock is EARLIER than the board's own
      assert.equal(got.callsStaleS, undefined, 'a board from the future is not trusted');
      assert.ok(log.reads.length >= 1);
    } finally { c.restore(); }
  }
});

test('the last good board is kept for each viewer\'s scope and day: another scope, another day and another week are never handed this one\'s', async () => {
  // Another scope: the admin has a good board; a viewer with teams has none, so a failing database reads the rows for the viewer.
  {
    const c = clock_();
    try {
      const { db, state } = flakyBoards_(), log = watch(db);
      await run(db, ADMIN, c.at(0));
      state.fail = TIMEOUT_;
      const want = boards(await run(fakeDb(tables()), viewer(['KONGOWE']), c.at(61000)));
      log.reads.length = 0;
      const got = await run(db, viewer(['KONGOWE']), c.at(61000));
      assert.deepEqual(boards(got), want, 'the viewer\'s own board, from the rows');
      assert.equal(got.callsStaleS, undefined);
      assert.ok(log.reads.length >= 1, 'read the old way for the scope that has no board of its own');
      // and once that scope has one (the five minutes of pause the failure above began are over), its own stands in
      const mine = viewer(['KONGOWE', 'MBAGALA']);
      state.fail = null;
      const good = await run(db, mine, c.at(400000));
      state.fail = TIMEOUT_;
      log.reads.length = 0;
      const again = await run(db, mine, c.at(470000));
      assert.deepEqual(boards(again), boards(good));
      assert.equal(again.callsStaleS, 70);
      assert.equal(log.reads.length, 0);
    } finally { c.restore(); }
  }
  // Another day (the same week): the key carries today. A board made at 23:55 EAT on Friday is seven minutes old at 00:02 on Saturday:
  // young enough to stand in by its age, and it still never serves the new day.
  {
    const c = clock_(), late = Date.parse('2026-07-24T20:55:00Z');
    try {
      const { db, state } = flakyBoards_(), log = watch(db);
      await run(db, ADMIN, c.at(0, late));
      state.fail = TIMEOUT_;
      const got = await run(db, ADMIN, c.at(7 * 60 * 1000, late));
      assert.equal(got.callsStaleS, undefined, 'yesterday\'s board is not today\'s');
      assert.ok(log.reads.length >= 1);
    } finally { c.restore(); }
  }
});

test('the function is not capped at a thousand rows: 1,200 officers are 1,200 lines, from either source', async () => {
  const t = tables(); t.call_logs = [];
  for (let i = 0; i < 1200; i++) t.call_logs.push(L('z' + String(i).padStart(5, '0'), 'OFFICER ' + i, 'T' + (i % 7), '07' + String(10000000 + i), TODAY, { duration: 6 + (i % 5), portfolio: i % 2 === 0, ref: 'R' + (i % 50) }));
  const a = await run(fakeDb(t)), b = await run(fakeDb(t, { rpc: CALL_BOARD_RPC }));
  assert.ok(b.callWeek.length >= 1200, 'every officer is a line: ' + b.callWeek.length);
  assert.deepEqual(boards(b), boards(a));
});

test('the order of ties follows the order the officers first appear, as it always did', async () => {
  const t = tables(); t.call_logs = [
    L('p3', 'CHARLIE', 'T1', '0700000003', TODAY, { duration: 9 }),
    L('p1', 'ALICE', 'T1', '0700000001', TODAY, { duration: 9 }),
    L('p2', 'BOB', 'T1', '0700000002', TODAY, { duration: 9 }),
  ]; t.call_users = [];
  const a = await run(fakeDb(t)), b = await run(fakeDb(t, { rpc: CALL_BOARD_RPC }));
  assert.deepEqual(a.callWeek.map(r => r.agent), ['ALICE', 'BOB', 'CHARLIE'], 'three officers, one call each: the id order decides');
  assert.deepEqual(b.callWeek.map(r => r.agent), ['ALICE', 'BOB', 'CHARLIE']);
});

/* ---- FOUND BY THE SECOND READER OF #759 (handbook Part 119) ---- */
test('an officer whose typed name is a key every object has ("__proto__", "constructor", "toString") is a person like any other, and nothing is ever written onto Object.prototype', async () => {
  // A name is typed at registration and is free text. The boards were keyed on a plain object, so "__proto__" was Object.prototype
  // itself: the board wrote the officer's team onto it, and every object in the server process read that team until it restarted.
  const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
  try {
    for (const opts of [{}, { rpc: CALL_BOARD_RPC }]) {
      const where = opts.rpc ? 'from the function' : 'from the rows';
      const t = tables();
      t.call_logs = names.map((n, i) => L('p' + i, n, 'KONGOWE', '071200002' + i, TODAY, { duration: 5 + i, portfolio: true, ref: 'R' + i }));
      t.call_users = [{ user_id: 'U9', name: '__proto__', team: 'KONGOWE', role: 'OFFICER' }];       // and a handset registered under that name too
      const b = await run(fakeDb(t, opts));
      for (const n of names) {
        const w = b.callWeek.find(r => r.agent === n), d = b.callToday.find(r => r.agent === n);
        assert.ok(w && d, n + ' is on both boards ' + where);
        assert.equal(w.calls, 1, n + ' made one call ' + where);
        assert.equal(w.team, 'KONGOWE', n + ' keeps their team ' + where);
      }
      assert.equal(b.callWeek.filter(r => r.agent === '__proto__').length, 1, 'one line, though a handset is registered under that name too');
      assert.equal(({}).team, undefined, 'no plain object has a team it was never given ' + where);
      assert.equal(Object.prototype.hasOwnProperty('team'), false, 'Object.prototype was not written to ' + where);
    }
  } finally { delete Object.prototype.team; }                                                          // never leave the runner polluted, whatever happened
});

test('a function that answers a figure that is not a number (null, a string, or one of the eight missing) is a wrong shape: the board is read the old way', async () => {
  const want = boards(await run(fakeDb(tables())));
  const row = over => ({ name: 'X', team: 'KONGOWE', dials: 1, calls: 1, duration: 5, otherDuration: 0, portfolio: 1, nonPortfolio: 0, connected: 1, customers: 1, ...over });
  const states = {};
  for (const k of ['dials', 'calls', 'duration', 'otherDuration', 'portfolio', 'nonPortfolio', 'connected', 'customers']) {
    states['a null ' + k] = row({ [k]: null });
    states['a string ' + k] = row({ [k]: '5' });
    const gone = row({}); delete gone[k]; states[k + ' missing'] = gone;
  }
  states['every figure but no name'] = row({ name: undefined });                       // the figures alone must not carry a row
  states['a name that is not text'] = row({ name: 7 });
  for (const [label, bad] of Object.entries(states)) {
    const db = fakeDb(tables(), { rpc: { call_board_rollup: () => ({ w: [bad], t: [] }) } }), log = watch(db);
    const got = await run(db);
    assert.deepEqual(boards(got), want, label + ': the boards are the boards the rows give');
    assert.ok(log.reads.length >= 1, label + ': and they were read the old way');
  }
  // and the shape the function really answers passes
  const db = fakeDb(tables(), { rpc: { call_board_rollup: () => ({ w: [row({})], t: [] }) } }), log = watch(db);
  const ok = await run(db);
  assert.equal(log.reads.length, 0, 'a whole row is believed');
  assert.ok(ok.callWeek.find(r => r.agent === 'X'));
});

/* ---- THE OLD CODE, KEPT AS THE YARDSTICK ----
   The refactor moves the adding-up out of the screen (callBoard in officerBoardsUncached, which summed the rows itself) into
   boardRowsFromLogs (call-core.js), and it is live the moment this deploys, before anybody has run RUN-ME-078: every board a person is
   judged on is now made by the new path. So the code it replaced is kept here, word for word as it stood in api/_lib/portal-core.js
   before this change, and the two are compared on random books: the same lines, the same figures, the same ORDER (ties included), for
   the admin and for a viewer with teams. A difference here is a figure that changed for somebody for no reason they can know. */
const { callRollupRows, callTotals } = await import('../api/_lib/call-core.js');
const { teamAllowed } = await import('../api/_lib/auth.js');
function oldBucket(map, key, init) { if (!map[key]) map[key] = Object.assign({ key }, init); return map[key]; }
function oldPctOf(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : null; }
function oldCallBoard(myCalls, myPhoneUsers, from, to) {
  const nameOf = c => String(c.officer || '(unknown)').trim() || '(unknown)';
  const inRange = myCalls.filter(c => { const d = String(c.call_date || '').slice(0, 10); return d && d >= from && d <= to; });
  const rollBy = {};
  for (const r of callRollupRows(inRange, nameOf)) (rollBy[r.user_id] || (rollBy[r.user_id] = [])).push(r);
  const m = {};
  for (const c of inRange) {
    const b = oldBucket(m, nameOf(c), { team: c.team || '' });
    if (!b.team) b.team = c.team || '';
  }
  for (const u of myPhoneUsers) {
    if (u.active === false) continue;
    const name = String(u.name || '').trim();
    if (!name) continue;
    const b = oldBucket(m, name, { team: u.team || '' });
    if (!b.team) b.team = u.team || '';
  }
  return Object.values(m).map(b => {
    const t = callTotals(rollBy[b.key] || []);
    return { agent: b.key, team: b.team, ...t, unit: null, connectPct: oldPctOf(t.connected, t.calls), portfolioPct: oldPctOf(t.portfolio, t.calls) };
  }).sort((a, b) => b.calls - a.calls);
}
const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const NAMES = ['JUMA G', ' JUMA G', 'JUMA G ', 'juma g', 'AMINA K', ' AMINA K', 'MARY  M', 'Steve', 'Nathan' + '%t', '', null, '   ', '(unknown)', '7', '12', 'Tt', 'Vv', 'ZED' + '%u2003', '%u00a0NEEMA'];
const TEAMS_ = [null, '', 'KONGOWE', 'MBAGALA', 'Kongowe ', 'kongowe', 'TUNDURU'];
const unesc = x => (typeof x === 'string' ? x.replace(/%t/g, String.fromCharCode(9)).replace(/%u([0-9a-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : x);
function randomBook(seed) {
  const rnd = mulberry32(seed), int = (a, b) => a + Math.floor(rnd() * (b - a + 1)), pick = a => a[int(0, a.length - 1)];
  const names = Array.from({ length: int(2, 6) }, () => unesc(pick(NAMES)));
  const rows = [];
  const n = int(0, 70);
  for (let i = 0; i < n; i++) {
    rows.push({ id: pick(['a', 'B', 'c', '_', '9', 'Z']) + pick(['a', 'B', '1', '-']) + i.toString(36), officer: pick(names), team: pick(TEAMS_),
      phone: pick([null, '', '0712000001', '0712 000 001', '0712000002', '0788000003', '0788000004', 'x']), ref: pick([null, '', 'R1', 'R2', 'R3']),
      duration: pick([null, 0, 3, 30, 600, 61]), portfolio: pick([null, true, true, false, false]), outcome: pick([null, 'CONNECTED', 'MISSED', 'REJECTED', 'BLOCKED', 'connected', ' blocked ']),
      category: pick([null, 'EXPECTED', 'DEFAULTER']), call_date: pick(['2026-07-19', MON, '2026-07-21', '2026-07-22', '2026-07-23', TODAY, TODAY, '2026-07-25', SUN, '2026-07-27']) });
  }
  const users = Array.from({ length: int(0, 4) }, (_, i) => ({ user_id: 'U' + i, name: unesc(pick(NAMES.concat(['SILENT S', 'GONE G']))), team: pick(TEAMS_), role: 'OFFICER', active: pick([true, true, false, undefined]) }));
  return { rows, users };
}
const byId = (x, y) => (String(x.id) < String(y.id) ? -1 : String(x.id) > String(y.id) ? 1 : 0);

test('THE OLD CODE AS YARDSTICK: the boards the new path makes equal the boards the old code made, on 250 random books, for the admin and for a viewer with teams', async () => {
  let compared = 0, nonEmpty = 0, ties = 0;
  for (let seed = 1; seed <= 250; seed++) {
    const { rows, users } = randomBook(seed);
    for (const [label, user, teams] of [['admin', ADMIN, null], ['viewer', viewer(['KONGOWE', 'Mbagala']), ['KONGOWE', 'Mbagala']]]) {
      for (const opts of [{}, { rpc: CALL_BOARD_RPC }]) {
        const db = fakeDb({ call_logs: rows, call_users: users }, opts);
        const b = await run(db, user);
        // what the old screen held: the rows the board's query returns (the DB's .in(), in id order), then the screen's own team filter
        const mine = rows.filter(r => !teams || teamMatchList(teams).includes(r.team)).slice().sort(byId)
          .map(r => ({ officer: r.officer, team: r.team, duration: r.duration, portfolio: r.portfolio, ref: r.ref, phone: r.phone, outcome: r.outcome, call_date: r.call_date }))
          .filter(r => teamAllowed(user, r.team));
        // the phone users are read the same way: the DB's exact .in() on the viewer's team spellings, then the screen's own teamAllowed
        const myUsers = users.filter(u => !teams || teamMatchList(teams).includes(u.team)).filter(u => teamAllowed(user, u.team));
        const wantWeek = oldCallBoard(mine, myUsers, MON, SUN), wantToday = oldCallBoard(mine, myUsers, TODAY, TODAY);
        const tag = 'seed ' + seed + ' ' + label + (opts.rpc ? ' with the function' : ' from the rows');
        assert.deepEqual(b.callWeek, wantWeek, tag + ': the week');
        assert.deepEqual(b.callToday, wantToday, tag + ': today');
        compared += 2; if (wantWeek.length) nonEmpty++;
        for (let i = 1; i < wantWeek.length; i++) if (wantWeek[i].calls === wantWeek[i - 1].calls) { ties++; break; }
      }
    }
  }
  assert.ok(compared >= 2000, 'boards compared: ' + compared);
  assert.ok(nonEmpty >= 600, 'books with a real week: ' + nonEmpty);
  assert.ok(ties >= 100, 'books where officers tie on calls (so the order of ties was compared): ' + ties);
});

/* ---- the file, the wiring and the docs, held together ---- */
const F078 = read('db/RUN-ME-078-call-board-rollup.sql');
const PORTAL = read('api/_lib/portal-core.js');
const CHECK = read('tools/db-checks/call-board-rollup.mjs');
const norm = s => s.replace(/\s+/g, ' ').trim();
const sqlCode = text => text.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
const jsCode = text => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const FN = norm(sqlCode(F078));
const APP = jsCode(PORTAL);

test('RUN-ME-078 is a block the owner can paste: small, flush-left, plain text, with its END line', () => {
  assert.ok(F078.length < 10000, 'under 10,000 characters: ' + F078.length);
  assert.ok(!F078.split('\n').some(l => /^\s/.test(l)), 'no line starts with a blank: nothing for an editor\'s indentation to pile up on');
  assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(F078), 'plain ASCII (the no-break space and the others are written as escapes)');
  assert.match(F078.split('\n').filter(Boolean).pop(), /^-- END OF THE SCRIPT:/, 'it ends with the line the owner looks for');
});

test('RUN-ME-078 answers ONE value {"w": [...], "t": [...]} with the figures the board draws, in the order the officers first appear', () => {
  assert.match(FN, /^create or replace function call_board_rollup\(p_from date, p_to date, p_day date, p_teams text\[\] default null\) returns jsonb language sql stable set search_path = public, pg_catalog as \$\$/,
    'the name and the four arguments (the app asks for them by name), a single jsonb value: one row, so no row cap and no paging');
  for (const k of ['name', 'team', 'dials', 'calls', 'duration', 'otherDuration', 'portfolio', 'nonPortfolio', 'connected', 'customers'])
    assert.ok(FN.includes("'" + k + "', "), 'the figure ' + k + ' is in each line (callTotals\' own names)');
  assert.match(FN, /'w', coalesce\(\(select jsonb_agg\(j order by first_id\) from rowsj where scope = 'w'\), '\[\]'::jsonb\)/, 'the week, in first-appearance order, [] (never null) when quiet');
  assert.match(FN, /'t', coalesce\(\(select jsonb_agg\(j order by first_id\) from rowsj where scope = 't'\), '\[\]'::jsonb\)/, 'and today');
  assert.match(FN, /min\(id\) as first_id/, 'first appearance is the smallest id, the order the rows were always read in');
  assert.match(FN, /c\.call_date >= p_from and c\.call_date <= p_to and \(p_teams is null or c\.team = any \(p_teams\)\)/, 'the window, and the team list matched EXACTLY (the .in() the board always sent)');
  assert.match(FN, /from dg where call_date = p_day group by officer/, 'today\'s figures are the day\'s groups only');
  assert.match(FN, /from base where call_date = p_day group by officer \)/, 'and its dials, first appearance, team and customers come from the day\'s rows only');
  assert.ok(!/\bscoped\b/.test(FN), 'the day\'s rows are not copied through the big aggregates a second time');
});

test('RUN-ME-078 keeps the board\'s own rule: category is ignored, a team that is null or empty is one team, an officer is trimmed of every blank', () => {
  assert.ok(!/category/i.test(FN), 'no category anywhere in the code: the board\'s query has never selected it');
  assert.match(FN, /coalesce\(c\.team, ''\) as team/, 'a null team and an empty one are one group, as callRollupRows joins them');
  assert.ok(F078.includes("E' \\t\\n\\r\\f\\x0b\\u00a0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff'"), 'the blanks JavaScript trims, written as escapes; \\x0b is the vertical tab (\\v would be the letter v)');
  assert.ok(!/\\v/.test(sqlCode(F078)), 'never \\v');
  assert.match(FN, /coalesce\(nullif\(btrim\(c\.officer, p\.ws\), ''\), '\(unknown\)'\) as officer/, 'a blank officer is "(unknown)"');
  assert.match(FN, /select officer, call_date, team, portfolio, phone, sum\(duration\) as dur, bool_or\(connected\) as connected from base group by officer, call_date, team, portfolio, phone/, 'one line for each number an officer rang on a day (and team, and portfolio flag): the redials are one number');
  assert.match(FN, /select officer, call_date, team, portfolio, count\(\*\) as n, sum\(dur\) as dur, count\(\*\) filter \(where connected\) as reached from byphone group by officer, call_date, team, portfolio \)/, 'a number is one call a day; its talk time is the sum; it is reached if any call to it connected; per officer, day and team: callRollupRows\' own groups');
  assert.match(FN, /\(count\(distinct coalesce\(nullif\(ref, ''\), phone\)\) filter \(where portfolio\)\)::bigint as customers/, 'customers: distinct refs (or numbers) of portfolio calls');
});

test('RUN-ME-078 reads call_logs and changes nothing; only service_role may call it; the undo is written and commented', () => {
  const code = sqlCode(F078);
  assert.ok(!/\b(delete|truncate|alter|insert|update|drop)\b/i.test(code), 'no statement that changes a row, a table or a function outside a comment');
  assert.match(code, /revoke execute on function call_board_rollup\(date, date, date, text\[\]\) from public, anon, authenticated;/);
  assert.match(code, /grant execute on function call_board_rollup\(date, date, date, text\[\]\) to service_role;/);
  assert.match(F078, /^-- UNDO, alone: drop function if exists call_board_rollup\(date, date, date, text\[\]\);$/m);
  assert.match(code, /select jsonb_array_length\(r->'w'\) as officers_this_week, jsonb_array_length\(r->'t'\) as officers_today/, 'the landing line answers two numbers');
  assert.ok(!/\bset statement_timeout\b/i.test(FN), 'no limit of its own: the role\'s limit applies (PostgREST would enforce a tighter one on every call)');
});

test('RUN-ME-078 says what it saves, how it was measured, what is not known, what it costs, and what happens until it is run', () => {
  assert.match(F078, /121,746 times/, 'the statement it replaces, in the owner\'s own numbers');
  assert.match(F078, /MEASURED by tools\/db-checks\/call-board-rollup\.mjs/);
  assert.match(F078, /buffers touched/, 'pages are counted, not only milliseconds');
  assert.match(F078, /The live seconds are NOT known/, 'what was not measured is said');
  assert.match(F078, /WHAT IT COSTS: nothing to \/api\/upload or \/api\/call/, 'CLAUDE.md section 1: what the two sacred paths pay, written beside the change');
  assert.match(F078, /IT IS EXACTLY THE BOARD'S OWN RULE, NOT RUN-ME-042's/, 'the category difference is said where the owner reads it');
  assert.match(F078, /UNTIL IT IS RUN the app reads the week page by page exactly as it always did/, 'a code path that depends on a migration works without it');
  assert.ok(!/CHECK_NUMBERS/.test(F078), 'no placeholder is left in what the owner pastes');
});

test('the SQL, the app and the stand-in use the same function name and the same four argument names, and the old read stays', () => {
  assert.match(APP, /const CALL_BOARD_FN = 'call_board_rollup';/);
  assert.match(APP, /db\.rpc\(CALL_BOARD_FN, \{ p_from: mon, p_to: sun, p_day: today,\n {6}p_teams: user\.teams && user\.teams\.length \? teamMatchList\(user\.teams\) : null \}\)/, 'the same list onTeams sends, or none');
  assert.equal((APP.match(/db\.rpc\(CALL_BOARD_FN/g) || []).length, 1, 'the function is asked for in exactly one place');
  assert.match(APP, /const CALL_BOARD_PAUSE_MS = 5 \* 60 \* 1000;/);
  assert.match(APP, /if \(failed && \(Date\.now\(\) - failed\.at\) < CALL_BOARD_PAUSE_MS\) return failed\.soft \? callBoardLast_\(db, scope\) : null;/);
  assert.match(APP, /callBoardFailed\.set\(db, \{ at: Date\.now\(\), soft \}\);\n {2}return soft \? callBoardLast_\(db, scope\) : null;/, 'every failure path is remembered, with whether the database was briefly unreachable, and falls back');
  assert.match(APP, /\.select\('officer, team, duration, portfolio, ref, phone, outcome, call_date'\)\n {4}\.gte\('call_date', mon\)\.lte\('call_date', sun\), user\.teams\)\);/, 'the old read, unchanged: the same eight columns, and no category');
  assert.equal((APP.match(/\.select\('officer, team, duration, portfolio, ref, phone, outcome, call_date'\)/g) || []).length, 1, 'the week\'s calls are read in exactly one place');
  assert.match(APP, /boardRowsFromLogs\(mine, mon, sun\), t: boardRowsFromLogs\(mine, today, today\)/, 'the fall-back adds the rows up with the one definition');
  assert.ok(!/callRollupRows|callTotals/.test(APP), 'portal-core keeps no second copy of the counting rule');
  const mock = read('test/snapshot-totals-rpc.mjs');
  assert.match(mock, /call_board_rollup: async \(store, a = \{\}\) =>/);
  for (const k of ['p_teams', 'p_from', 'p_to', 'p_day']) { assert.match(mock, new RegExp('a\\.' + k + '\\b')); assert.ok(F078.includes(k + ' '), 'the SQL names ' + k); }
});

/* THE LAST GOOD BOARD STANDS IN (20 Nov 2026, handbook Part 123): the rule's source, held here; its behaviour is above. */
test('the last good board stands in only for a failure that is the database being briefly unreachable, for ten minutes, for the same scope and day, and the old read stays for every other failure', () => {
  assert.match(APP, /^import \{ fetchAll, runQuery , rpcAll, isTransient, STALE_OK_MS \} from '\.\/supabase\.js';$/m, 'the one definition of "briefly unreachable" is the reader\'s own, and the ten minutes are defined once');
  assert.match(APP, /soft = isTransient\(error\);/);
  assert.match(APP, /catch \(e\) \{ soft = isTransient\(e\);\s*\}/);
  assert.match(APP, /\{ callBoardKeep_\(db, scope, data\); return data; \}/, 'only an answer that passed the shape check is kept');
  assert.match(APP, /\[mon, sun, today, user\.teams && user\.teams\.length \? teamMatchList\(user\.teams\)\.slice\(\)\.sort\(\)\.join\('\\u0001'\) : '\*'\]\.join\('\|'\)/,
    'the scope is the three things the function is asked: the week, today and the teams (an admin is its own scope)');
  assert.match(APP, /return v && age >= 0 && age < STALE_OK_MS \? \{ w: v\.data\.w, t: v\.data\.t, staleS: Math\.round\(age \/ 1000\) \} : null;/, 'younger than ten minutes, never from the future, and it says how old it is');
  assert.match(APP, /if \(now - v\.at >= STALE_OK_MS\) m\.delete\(k\);/, 'nothing older than it may be used is kept');
  assert.match(APP, /\.\.\.\(callSrc\.staleS \? \{ callsStaleS: callSrc\.staleS \} : \{\}\),/, 'the answer says when the boards are an older answer, and carries nothing when they are not');
  assert.equal((APP.match(/\? callBoardLast_\(db, scope\)/g) || []).length, 2, 'handed out in the pause and after a failure, nowhere else');
});

test('the kept check holds the file to the production definition and breaks it on purpose', () => {
  assert.match(CHECK, /db\/RUN-ME-078-call-board-rollup\.sql/);
  assert.match(CHECK, /const \{ boardRowsFromLogs \} = await import\('\.\.\/\.\.\/api\/_lib\/call-core\.js'\);/, 'the yardstick is the production function, imported, never written again');
  assert.match(CHECK, /const \{ teamMatchList \} = await import\('\.\.\/\.\.\/api\/_lib\/snapshots\.js'\);/, 'and the team list is the production one');
  assert.match(CHECK, /order by id\) t;/, 'the reference rows are read in id order, the order the board always read them in');
  assert.match(CHECK, /select officer, team, duration, portfolio, ref, phone, outcome, call_date from call_logs\$\{teams \?/, 'the reference rows are the eight columns the board selects, and no category');
  assert.match(CHECK, /order by id asc limit 10000 offset/, 'the old read is measured in the shape the app sent it');
  assert.match(CHECK, /Buffers: shared/, 'the pages are counted, not only the milliseconds');
  assert.match(CHECK, /'random'/, 'in the worst layout a table can have, as well as the one calls really have');
  assert.match(CHECK, /alter default privileges in schema public grant all on functions to anon, authenticated, service_role/, 'with Supabase\'s default grants, so the revoke is what is tested');
  assert.match(CHECK, /has_function_privilege/);
  const m = CHECK.match(/const BREAKS = \[([\s\S]*?)\n\];/);
  assert.ok(m, 'the list of deliberate breaks is found');
  assert.ok((m[1].match(/^  \[/gm) || []).length >= 28, 'deliberate breaks of the file: ' + (m[1].match(/^  \[/gm) || []).length);
});

test('the handbook and CHAT.md record RUN-ME-078 with its numbers and what is not claimed', () => {
  const h = read('docs/HANDOFF.md'), c = read('CHAT.md');
  assert.match(h, /Part 116/);
  assert.match(h, /RUN-ME-078/);
  assert.match(c, /RUN-ME-078/);
  assert.match(c, /call_board_rollup/);
});
