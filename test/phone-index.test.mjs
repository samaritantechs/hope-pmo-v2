// THE PHONE INDEX, READ IN TWO PARTS AND BUILT ONCE -- 20 Nov 2026 (handbook Part 118).
//
//   "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner
//
// api/_lib/call-core.js phoneIndex used to be one thing, thrown away whole and read again whole
// (the register, two sheets, the two-week window and the numbered comments: seven statements)
// whenever DATA_VERSION or NEW_NUMBER_VERSION moved or five minutes passed. It is now two parts:
// the LISTS (the four big reads, kept against today and DATA_VERSION) and the NUMBERED COMMENTS
// (one small read, kept against NEW_NUMBER_VERSION), each for the same five minutes, and one
// build that the syncs in flight at the same moment share.
//
// What this file holds against the change:
//   * THE OLD CODE IS THE YARDSTICK. oldIndex() below is the old phoneIndexCompute, word for word
//     (its comments cut), and the index the new code makes is compared with it, key by key and in
//     insertion order, over random books and over random sequences of uploads, recorded numbers
//     and clock. Under the rule the system keeps (every writer of the index's inputs moves a stamp)
//     the new index is at every moment the index the old code would make from the book as it then is.
//   * THE READS ARE COUNTED: a served index costs none; a recorded number costs the one small read;
//     an upload costs the lists; five minutes costs both; concurrent syncs cost one set.
//   * THE FRESHNESS PROMISES: a recorded number is in the very next index, an upload likewise, a
//     failed read is not kept, a clock that jumps backwards is not trusted, midnight rebuilds, and
//     a change that moved NO stamp is seen at the lists' own five-minute mark.
// Each of these fails when the code it guards is broken (the breaks are run by hand and kept in the
// handbook's Part 118, with their count).

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';
import { EXPECTED_PHONE_WINDOW_RPC } from './snapshot-totals-rpc.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { phoneIndex, pnorm } = await import('../api/_lib/call-core.js');
const { fetchAll, rpcAll } = await import('../api/_lib/supabase.js');
const { latestSnapshot } = await import('../api/_lib/snapshots.js');
const { addDaysKey, todayKey } = await import('../api/_lib/time.js');

const NOW = Date.parse('2026-11-20T09:00:00Z');       // a Friday noon EAT
const DAY = 86400000;
const TTL = 300000;
const COLS = 'ref, full_name, contact, guarantor_name, guarantor_contact, team';

/* THE OLD CODE, as it stood before this change (api/_lib/call-core.js at #760): the five reads
   and the arithmetic in one function. Its comments are cut; its text is not touched. */
async function oldIndex(db, today) {
  const [fu, eT, eM, eWin, cm] = await Promise.all([
    fetchAll(() => db.from('followup_status').select('ref, full_name, contact, guarantor_name, guarantor_contact, team')),
    latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'today' }, { notAfter: today, columns: COLS }),
    latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'tomorrow' }, { notAfter: today, columns: COLS }),
    rpcAll(db, 'expected_phone_window', { p_from: addDaysKey(today, -13) })
      .then(r => (r.error || !Array.isArray(r.data)) ? [] : r.data),
    fetchAll(() => db.from('followup_comments').select('ref, new_number, full_name, team')
      .not('new_number', 'is', null).neq('new_number', '')),
  ]);
  const byNum = {};
  const add = (numRaw, name, ref, team, role, src) => {
    const d = pnorm(numRaw);
    if (!d || byNum[d]) return;               // first add wins -- customers are added before guarantors
    byNum[d] = { K: d, N: name || '', R: ref || '', T: team || '', C: role, S: src || '' };
  };
  eT.rows.forEach(r => add(r.contact, r.full_name, r.ref, r.team, 'C', 'EXP'));
  eM.rows.forEach(r => add(r.contact, r.full_name, r.ref, r.team, 'C', 'EXP'));
  fu.forEach(r => add(r.contact, r.full_name, r.ref, r.team, 'C', 'DEF'));
  eWin.forEach(r => add(r.contact, r.full_name, r.ref, r.team, 'C', 'EXP'));
  const refName = {}, refTeam = {}, refSrc = {};
  Object.values(byNum).forEach(o => { if (o.R) { refName[o.R] = o.N; refTeam[o.R] = o.T; refSrc[o.R] = o.S; } });
  cm.forEach(r => {
    const nn = String(r.new_number == null ? '' : r.new_number).trim();
    if (!nn) return;
    const ref = String(r.ref || '');
    add(nn, refName[ref] || r.full_name || '', ref, refTeam[ref] || r.team, 'C', refSrc[ref] || 'DEF');
  });
  eT.rows.forEach(r => add(r.guarantor_contact, r.guarantor_name, r.ref, r.team, 'G', 'EXP'));
  eM.rows.forEach(r => add(r.guarantor_contact, r.guarantor_name, r.ref, r.team, 'G', 'EXP'));
  fu.forEach(r => add(r.guarantor_contact, r.guarantor_name, r.ref, r.team, 'G', 'DEF'));
  eWin.forEach(r => add(r.guarantor_contact, r.guarantor_name, r.ref, r.team, 'G', 'EXP'));
  return byNum;
}

/** An index as a string that shows its keys' ORDER too (assert.deepEqual would not): the phone's
    search lists customers in the order the index was filled. */
const shape = idx => JSON.stringify(Object.entries(idx));

/** Counts every database call a function makes. */
function counted(db) {
  const n = { total: 0, followup_status: 0, repayment_snapshots: 0, followup_comments: 0, rpc: 0, other: 0 };
  const wrap = {
    from(name) {
      n.total += 1;
      if (name in n) n[name] += 1; else n.other += 1;
      return db.from(name);
    },
    rpc(...a) { n.total += 1; n.rpc += 1; return db.rpc(...a); },
    _dump: name => db._dump(name),
  };
  return { db: wrap, n, reset() { for (const k of Object.keys(n)) n[k] = 0; } };
}

/* ---------- a book the size and shape of the real one, small enough to repeat ---------- */
function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const FORMATS = [n => '0' + n, n => '+255' + n, n => '255' + n, n => '0' + n.slice(0, 3) + ' ' + n.slice(3, 6) + ' ' + n.slice(6), n => n];
const TEAMS = ['KONGOWE', 'MBAGALA', 'TEMEKE', 'UBUNGO'];

function makeBook(seed) {
  const r = prng(seed);
  const pick = a => a[Math.floor(r() * a.length)];
  const people = [];                                   // a small pool of numbers, so numbers collide on purpose
  for (let i = 0; i < 26; i++) people.push(String(710000000 + Math.floor(r() * 90000000)));
  const num = () => (r() < 0.08 ? null : (r() < 0.04 ? '' : pick(FORMATS)(pick(people))));
  const today = todayKey(NOW);
  const t = {
    followup_status: [], repayment_snapshots: [], followup_comments: [],
  };
  const refs = [];
  for (let i = 0; i < 14; i++) refs.push('R' + (100 + i));
  for (const ref of refs) {
    if (r() < 0.7) t.followup_status.push({ ref, full_name: 'DEF ' + ref, contact: num(), guarantor_name: 'DG ' + ref, guarantor_contact: num(), team: pick(TEAMS), status: 'DEFAULTER', arrears: 1000 });
  }
  const sheet = (type, date, batch) => {
    for (const ref of refs) {
      if (r() < 0.45) t.repayment_snapshots.push({ ref, full_name: 'EXP ' + ref, contact: num(), guarantor_name: 'EG ' + ref, guarantor_contact: num(), team: pick(TEAMS),
        payment_expected: 100, arrears: 0, snapshot_type: type, snapshot_date: date, upload_batch: batch, created_at: date + 'T04:0' + (batch.length % 9) + ':00Z' });
    }
  };
  for (let back = 0; back <= 15; back++) {             // the two weeks, and a day older than the window
    const d = addDaysKey(today, -back);
    if (r() < 0.8) sheet('today', d, 'b' + back + 'a');
    if (r() < 0.5) sheet('tomorrow', d, 'b' + back + 'b');
    if (r() < 0.15) sheet('today', d, 'b' + back + 'z');   // a second upload of the same day
  }
  if (r() < 0.5) sheet('today', addDaysKey(today, 2), 'future');    // a sheet uploaded ahead, no upper bound
  const nc = Math.floor(r() * 5);
  for (let i = 0; i < nc; i++) {
    t.followup_comments.push({ ref: r() < 0.85 ? pick(refs) : 'NOBODY' + i, new_number: r() < 0.9 ? pick(FORMATS)(pick(people)) : (r() < 0.5 ? '' : null),
      full_name: 'CM ' + i, team: pick(TEAMS), comment: 'x', created_at: today + 'T05:00:00Z' });
  }
  return t;
}
const clone = o => JSON.parse(JSON.stringify(o));
const newDb = tables => fakeDb(clone(tables), { rpc: EXPECTED_PHONE_WINDOW_RPC });

/* ================================================================================== */

test('the index the new code makes is the one the old code made: 120 random books, key by key and in order', async () => {
  let customers = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const tables = makeBook(seed);
    const db = newDb(tables);
    const now = NOW + seed * 1000;
    const want = shape(await oldIndex(newDb(tables), todayKey(now)));
    const got = shape(await phoneIndex(db, now, 'v1', 'n1'));
    assert.equal(got, want, 'seed ' + seed + ': the index differs from the old code\'s');
    customers += Object.keys(JSON.parse(got).length ? Object.fromEntries(JSON.parse(got)) : {}).length;
  }
  assert.ok(customers > 600, 'the books were not empty (' + customers + ' numbers across them): a comparison of nothing proves nothing');
});

test('without the window function installed, the index is still the old code\'s (the fallback it always had)', async () => {
  for (let seed = 200; seed < 230; seed++) {
    const tables = makeBook(seed);
    const bare = () => fakeDb(clone(tables));          // no rpc: PostgREST would answer "function not found"
    assert.equal(shape(await phoneIndex(bare(), NOW, 'v1', 'n1')), shape(await oldIndex(bare(), todayKey(NOW))), 'seed ' + seed);
  }
});

test('over random sequences of uploads, recorded numbers and clock, every sync gets the index the old code would make from the book as it is then', async () => {
  let syncs = 0, rebuilds = 0, cmOnly = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const r = prng(seed * 7919);
    const tables = makeBook(seed + 1000);
    const db = newDb(tables);
    const c = counted(db);
    let now = NOW, dv = 'd0', nv = 'n0', k = 0;
    const pickRef = () => 'R' + (100 + Math.floor(r() * 14));
    for (let step = 0; step < 40; step++) {
      const x = r();
      if (x < 0.14) {                                    // an UPLOAD: the register and a sheet change, and the stamp moves (after the writes, as api/upload.js does)
        const ref = pickRef();
        const st = db._dump('followup_status');
        const row = st.find(z => z.ref === ref);
        if (row) row.contact = '07' + (10000000 + Math.floor(r() * 80000000));
        else await db.from('followup_status').insert({ ref, full_name: 'NEW ' + ref, contact: '07' + (10000000 + Math.floor(r() * 80000000)), guarantor_name: '', guarantor_contact: '', team: 'KONGOWE', status: 'DEFAULTER', arrears: 5 });
        await db.from('repayment_snapshots').insert({ ref: 'U' + (k++), full_name: 'UP ' + k, contact: '07' + (20000000 + Math.floor(r() * 70000000)), guarantor_name: 'UG', guarantor_contact: '07' + (30000000 + Math.floor(r() * 60000000)), team: 'MBAGALA',
          payment_expected: 1, arrears: 0, snapshot_type: r() < 0.5 ? 'today' : 'tomorrow', snapshot_date: todayKey(now), upload_batch: 'u' + k, created_at: new Date(now).toISOString() });
        dv = 'd' + step;
      } else if (x < 0.3) {                              // an officer RECORDS a number: the comment is written, then the stamp moves
        await db.from('followup_comments').insert({ ref: pickRef(), new_number: '07' + (40000000 + Math.floor(r() * 50000000)), full_name: 'REC', team: 'TEMEKE', comment: 'namba mpya', created_at: new Date(now).toISOString() });
        nv = 'n' + step;
      } else if (x < 0.5) {
        now += Math.floor(r() * 400000);                // the clock moves up to nearly seven minutes
      } else if (x < 0.53) {
        now += DAY;                                      // midnight passes
      }
      // a sync, as /api/call makes one
      const before = c.n.total;
      const got = shape(await phoneIndex(c.db, now, dv, nv));
      if (c.n.total > before) rebuilds += 1;
      if (c.n.total - before === 1 && c.n.followup_comments) cmOnly += 0;
      const want = shape(await oldIndex(db, todayKey(now)));
      assert.equal(got, want, 'seed ' + seed + ' step ' + step + ': the index is not the one the old code makes from the book as it is now');
      syncs += 1;
    }
  }
  assert.ok(syncs >= 2400 && rebuilds > 100, 'the sequences exercised both hits and rebuilds (' + syncs + ' syncs, ' + rebuilds + ' with reads)');
  void cmOnly;
});

/* ---------- what each thing costs, in database calls ---------- */

async function warm() {
  const db = newDb(makeBook(5));
  const c = counted(db);
  await phoneIndex(c.db, NOW, 'v1', 'n1');
  const cold = { ...c.n };
  c.reset();
  return { db, c, cold };
}

test('a cold index reads the register, both sheets (a date and the rows each), the window and the numbered comments; nothing more', async () => {
  const { cold } = await warm();
  assert.equal(cold.followup_status, 1, 'the register: one read');
  assert.equal(cold.repayment_snapshots, 4, 'two sheets, each a date and the rows');
  assert.equal(cold.rpc, 1, 'the two-week window: one call');
  assert.equal(cold.followup_comments, 1, 'the numbered comments: one read');
  assert.equal(cold.other, 0, 'no other table is touched');
  assert.equal(cold.total, 7);
});

test('a served index costs no read at all, and is the same object (the phone\'s search keeps its own index of it)', async () => {
  const { db, c } = await warm();
  const a = await phoneIndex(c.db, NOW + 1000, 'v1', 'n1');
  const b = await phoneIndex(c.db, NOW + TTL - 1, 'v1', 'n1');
  assert.equal(c.n.total, 0, 'two syncs inside the five minutes read nothing');
  assert.equal(a, b, 'the very same index object');
  void db;
});

test('a recorded number costs ONE small read, not seven, and the number is in the very next index', async () => {
  const { db, c } = await warm();
  const idx0 = await phoneIndex(c.db, NOW + 1000, 'v1', 'n1');
  c.reset();
  await db.from('followup_comments').insert({ ref: 'R100', new_number: '0765432109', full_name: 'REC', team: 'KONGOWE', comment: 'namba mpya', created_at: new Date(NOW).toISOString() });
  c.reset();
  const idx1 = await phoneIndex(c.db, NOW + 2000, 'v1', 'n2');
  assert.equal(c.n.total, 1, 'only the numbered comments are read again (' + JSON.stringify(c.n) + ')');
  assert.equal(c.n.followup_comments, 1);
  assert.ok(idx1[pnorm('0765432109')], 'the recorded number is in the index');
  assert.equal(idx1[pnorm('0765432109')].R, 'R100');
  assert.equal(idx0[pnorm('0765432109')], undefined, 'and it was not in the one before');
  assert.notEqual(idx0, idx1, 'a new index object, because its content changed');
});

test('an upload costs the lists (six reads) and not the numbered comments', async () => {
  const { c } = await warm();
  await phoneIndex(c.db, NOW + 1000, 'v2', 'n1');
  assert.equal(c.n.total, 6, 'register 1, sheets 4, window 1 (' + JSON.stringify(c.n) + ')');
  assert.equal(c.n.followup_comments, 0);
});

test('five minutes cost both parts again; one second less costs nothing', async () => {
  const { c } = await warm();
  await phoneIndex(c.db, NOW + TTL - 1, 'v1', 'n1');
  assert.equal(c.n.total, 0);
  await phoneIndex(c.db, NOW + TTL, 'v1', 'n1');
  assert.equal(c.n.total, 7, 'both parts, after five minutes (' + JSON.stringify(c.n) + ')');
});

test('midnight rebuilds the lists: the day is in their key', async () => {
  const { c } = await warm();
  const midnightEat = Date.parse('2026-11-20T21:00:00Z');          // 00:00 on the 21st, East Africa
  await phoneIndex(c.db, midnightEat - 1000, 'v1', 'n1');           // still the 20th, nothing yet... but the ttl has gone
  c.reset();
  const t1 = midnightEat + 1000;
  await phoneIndex(c.db, midnightEat - 1000, 'v1', 'n1');
  assert.equal(c.n.total, 0, 'the same instant again: served');
  await phoneIndex(c.db, t1, 'v1', 'n1');
  assert.equal(c.n.repayment_snapshots, 4, 'the sheets are read again for the new day');
  assert.equal(c.n.followup_status, 1);
});

test('the two parts are asked for TOGETHER, as the five reads always were: a sync waits for the slowest read, not for their sum', async () => {
  const inner = newDb(makeBook(11));
  let done = 0, doneWhenCommentsAsked = -1;
  const tick = q => new Proxy(q, { get(o, k) {
    if (k === 'then') return (res, rej) => o.then(v => { done += 1; return res(v); }, rej);
    const v = o[k];
    return typeof v === 'function' ? (...a) => { const out = v.apply(o, a); return out === o ? tick(o) : out; } : v;
  } });
  const timed = {
    from(name) { if (name === 'followup_comments') doneWhenCommentsAsked = done; return tick(inner.from(name)); },
    rpc: (...a) => tick(inner.rpc(...a)),
  };
  await phoneIndex(timed, NOW, 'v1', 'n1');
  assert.equal(doneWhenCommentsAsked, 0, 'the numbered comments were asked for before any other read had come back (' + doneWhenCommentsAsked + ' had)');
});

/* ---------- one build, shared ---------- */

test('syncs in flight at the same moment share ONE set of reads', async () => {
  const db = newDb(makeBook(7));
  const c = counted(db);
  const out = await Promise.all(Array.from({ length: 12 }, (_, i) => phoneIndex(c.db, NOW + i, 'v1', 'n1')));
  assert.equal(c.n.total, 7, 'twelve concurrent syncs, one build (' + JSON.stringify(c.n) + ')');
  assert.ok(out.every(x => x === out[0]), 'and they all hold the same index');
});

test('concurrent syncs that ask for a NEW stamp share one read of the comments, and none of the lists', async () => {
  const { c } = await warm();
  const out = await Promise.all(Array.from({ length: 9 }, (_, i) => phoneIndex(c.db, NOW + 1000 + i, 'v1', 'n9')));
  assert.equal(c.n.total, 1, JSON.stringify(c.n));
  assert.ok(out.every(x => x === out[0]));
});

test('a build that FAILS is not kept: the next sync asks again, and every waiter is told', async () => {
  const tables = makeBook(9);
  const mk = () => {
    const inner = newDb(tables);
    const st = { fail: true, asked: 0 };
    const reject = () => Promise.reject(new Error('statement timeout'));
    const flaky = {
      from(name) {
        if (name !== 'followup_comments') return inner.from(name);
        st.asked += 1;
        if (!st.fail) return inner.from(name);
        // a read that fails however it is awaited or paged: supabase-js reports it as an error object
        const q = { select: () => q, not: () => q, neq: () => q, order: () => q, range: () => q, limit: () => q,
          then: (res) => res({ data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } }) };
        void reject;
        return q;
      },
      rpc: (...a) => inner.rpc(...a),
    };
    return { flaky, st };
  };
  // one waiter: how many times the read is asked for when it fails (the reader may retry a timeout)
  const one = mk();
  const r1 = await Promise.allSettled([phoneIndex(one.flaky, NOW, 'v1', 'n1')]);
  assert.equal(r1[0].status, 'rejected', 'a failed read fails the sync, as it always did');
  const perAttempt = one.st.asked;
  assert.ok(perAttempt >= 1);
  // two waiters at once: the same number of asks, and both are told
  const two = mk();
  const r2 = await Promise.allSettled([phoneIndex(two.flaky, NOW, 'v1', 'n1'), phoneIndex(two.flaky, NOW + 1, 'v1', 'n1')]);
  assert.ok(r2.every(x => x.status === 'rejected'), 'both waiters hear the failure');
  assert.equal(two.st.asked, perAttempt, 'two waiters, one set of asks');
  // the failure is not kept
  two.st.fail = false;
  const before = two.st.asked;
  const ok = await phoneIndex(two.flaky, NOW + 2, 'v1', 'n1');
  assert.ok(Object.keys(ok).length > 0, 'the next sync asks again and gets an index');
  assert.ok(two.st.asked > before, 'it asked again: the failure was not kept');
  const asked = two.st.asked;
  const again = await phoneIndex(two.flaky, NOW + 3, 'v1', 'n1');
  assert.equal(again, ok, 'and the good one is kept');
  assert.equal(two.st.asked, asked);
});

test('the failure of an OLDER build does not throw away a NEWER one', async () => {
  const inner = newDb(makeBook(13));
  let failFirst = null, calls = 0;
  const hanging = () => {
    const q = new Proxy({}, { get: (o, k) => (k === 'then'
      ? (res) => { failFirst = () => res({ data: null, error: { message: 'permission denied for table followup_status', code: '42501' } }); }
      : () => q) });
    return q;
  };
  const wrapped = {
    from(name) {
      if (name === 'followup_status') { calls += 1; if (calls === 1) return hanging(); }   // the first build's register read hangs until the test fails it
      return inner.from(name);
    },
    rpc: (...a) => inner.rpc(...a),
  };
  const c = counted(wrapped);                               // the cache is kept against the client: one client throughout
  const p1 = phoneIndex(c.db, NOW, 'vA', 'n1');             // key A: its register read hangs
  const p2 = phoneIndex(c.db, NOW + 1, 'vB', 'n1');         // key B takes the slot and reads fine
  const idxB = await p2;
  assert.equal(typeof failFirst, 'function', 'the first build is waiting on its hung read');
  failFirst();                                              // now the OLDER build fails
  await assert.rejects(p1);
  c.reset();
  const again = await phoneIndex(c.db, NOW + 2, 'vB', 'n1');
  assert.equal(c.n.total, 0, 'the newer build is still held: ' + JSON.stringify(c.n));
  assert.equal(again, idxB);
});

/* ---------- the clock ---------- */

test('a clock that jumps backwards does not make an old index look new', async () => {
  const { c } = await warm();
  await phoneIndex(c.db, NOW + 10 * 60000, 'v1', 'n1');        // ten minutes on: rebuilt
  c.reset();
  await phoneIndex(c.db, NOW + 60000, 'v1', 'n1');              // the clock now says it is nine minutes EARLIER than the index
  assert.equal(c.n.total, 7, 'rebuilt, not trusted (' + JSON.stringify(c.n) + ')');
});

/* ---------- the promise for a change that moved no stamp ---------- */

test('a change to the register that moved NO stamp is seen at the lists\' own five-minute mark', async () => {
  const { db, c } = await warm();
  const st = db._dump('followup_status');
  st[0].contact = '0711000099';
  const stale = await phoneIndex(c.db, NOW + TTL - 1000, 'v1', 'n1');
  assert.equal(stale[pnorm('0711000099')], undefined, 'inside the five minutes the old register is served: that is the promise it always made');
  const fresh = await phoneIndex(c.db, NOW + TTL + 1000, 'v1', 'n1');
  assert.ok(fresh[pnorm('0711000099')], 'after them it is read again');
});

/* ---------- a longer life once an upload has settled (matter 3c, handbook Part 120) ---------- */

const MIN = 60000;
/* Counts one kind of build: the register is read once for each build of the lists, and never otherwise. */
const listsBuilt = c => c.n.followup_status;

test('a build made ten minutes after its upload\'s stamp is SETTLED: the lists are kept thirty minutes, the comments still five', async () => {
  const stamp = String(NOW - 11 * MIN);                                   // an upload eleven minutes ago, on the upload's own clock
  const db = newDb(makeBook(21)); const c = counted(db);
  await phoneIndex(c.db, NOW, stamp, 'n1');
  assert.equal(c.n.total, 7);
  c.reset();
  await phoneIndex(c.db, NOW + 5 * MIN, stamp, 'n1');
  assert.equal(c.n.total, 1, 'five minutes on: only the numbered comments (' + JSON.stringify(c.n) + ')');
  assert.equal(c.n.followup_comments, 1);
  c.reset();
  await phoneIndex(c.db, NOW + 29 * MIN, stamp, 'n1');
  assert.equal(listsBuilt(c), 0, 'twenty-nine minutes on: the lists are still the same build');
  c.reset();
  await phoneIndex(c.db, NOW + 30 * MIN, stamp, 'n1');
  assert.equal(listsBuilt(c), 1, 'thirty minutes on: the lists are read again');
  assert.equal(c.n.repayment_snapshots, 4);
  assert.equal(c.n.rpc, 1);
});

test('a build made sooner is UNSETTLED and lives five minutes, as it always did; the first build after the settle point is the settled one', async () => {
  const stamp = String(NOW - 1 * MIN);                                    // an upload a minute ago
  const db = newDb(makeBook(22)); const c = counted(db);
  await phoneIndex(c.db, NOW, stamp, 'n1');                                // built 1 minute after the stamp: unsettled
  assert.equal(listsBuilt(c), 1);
  c.reset();
  await phoneIndex(c.db, NOW + 5 * MIN - 1, stamp, 'n1');
  assert.equal(listsBuilt(c), 0, 'inside the five minutes');
  await phoneIndex(c.db, NOW + 5 * MIN, stamp, 'n1');                      // 6 minutes after the stamp: still unsettled
  assert.equal(listsBuilt(c), 1, 'after five minutes the lists are read again');
  c.reset();
  await phoneIndex(c.db, NOW + 10 * MIN - 1, stamp, 'n1');
  assert.equal(listsBuilt(c), 0);
  await phoneIndex(c.db, NOW + 10 * MIN, stamp, 'n1');                     // 11 minutes after the stamp: this build is settled
  assert.equal(listsBuilt(c), 1, 'and again after five more, because the build of the sixth minute was unsettled');
  c.reset();
  await phoneIndex(c.db, NOW + 39 * MIN, stamp, 'n1');
  assert.equal(listsBuilt(c), 0, 'the settled build is kept for thirty minutes from when it was made');
  await phoneIndex(c.db, NOW + 40 * MIN, stamp, 'n1');
  assert.equal(listsBuilt(c), 1);
});

test('the settle point is exactly ten minutes after the stamp', async () => {
  for (const [offset, settled] of [[10 * MIN - 1, false], [10 * MIN, true]]) {
    const stamp = String(NOW - offset);
    const db = newDb(makeBook(23)); const c = counted(db);
    await phoneIndex(c.db, NOW, stamp, 'n1');
    c.reset();
    await phoneIndex(c.db, NOW + 6 * MIN, stamp, 'n1');
    assert.equal(listsBuilt(c), settled ? 0 : 1, (settled ? 'at' : 'one millisecond before') + ' the settle point the build is ' + (settled ? 'settled' : 'unsettled'));
  }
});

test('a stamp that is not a millisecond clock never settles: nothing uploaded yet, a label, a tiny number, a stamp from the future', async () => {
  for (const stamp of ['', 'v1', 'upload-7', '12345', '999999999999', String(NOW + 60 * MIN)]) {
    const db = newDb(makeBook(24)); const c = counted(db);
    await phoneIndex(c.db, NOW, stamp, 'n1');
    c.reset();
    await phoneIndex(c.db, NOW + 5 * MIN, stamp, 'n1');
    assert.equal(listsBuilt(c), 1, 'stamp ' + JSON.stringify(stamp) + ': five minutes, as before');
  }
});

test('an upload moves the stamp and the lists are read at once, however settled the last build was; and the new build is unsettled', async () => {
  const old = String(NOW - 2 * 3600000);
  const db = newDb(makeBook(25)); const c = counted(db);
  await phoneIndex(c.db, NOW, old, 'n1');
  c.reset();
  await phoneIndex(c.db, NOW + 20 * MIN, old, 'n1');
  assert.equal(listsBuilt(c), 0, 'settled: kept');
  c.reset();
  const fresh = String(NOW + 21 * MIN);                                    // an upload a moment ago
  await phoneIndex(c.db, NOW + 21 * MIN + 5000, fresh, 'n1');
  assert.equal(listsBuilt(c), 1, 'the stamp moved: read again on the very next sync');
  c.reset();
  await phoneIndex(c.db, NOW + 26 * MIN + 5000, fresh, 'n1');
  assert.equal(listsBuilt(c), 1, 'and, being built five seconds after the stamp, it is unsettled: five minutes');
});

test('a recorded number on a SETTLED index is still one small read, and the lists stay', async () => {
  const stamp = String(NOW - 3600000);
  const db = newDb(makeBook(26)); const c = counted(db);
  await phoneIndex(c.db, NOW, stamp, 'n1');
  await db.from('followup_comments').insert({ ref: 'R101', new_number: '0765000111', full_name: 'REC', team: 'KONGOWE', comment: 'namba mpya', created_at: new Date(NOW).toISOString() });
  c.reset();
  const idx = await phoneIndex(c.db, NOW + 12 * MIN, stamp, 'n2');
  assert.equal(c.n.total, 1, JSON.stringify(c.n));
  assert.ok(idx[pnorm('0765000111')], 'the number is in the index');
});

test('a change that moved NO stamp is seen at the thirty-minute mark on a settled index: the price of the longer life, written down', async () => {
  const stamp = String(NOW - 3600000);
  const db = newDb(makeBook(27)); const c = counted(db);
  await phoneIndex(c.db, NOW, stamp, 'n1');
  db._dump('followup_status')[0].contact = '0711000077';
  const stale = await phoneIndex(c.db, NOW + 29 * MIN, stamp, 'n1');
  assert.equal(stale[pnorm('0711000077')], undefined, 'not seen inside thirty minutes');
  const fresh = await phoneIndex(c.db, NOW + 30 * MIN, stamp, 'n1');
  assert.ok(fresh[pnorm('0711000077')], 'seen at thirty');
});

test('the settled index is still the old code\'s index: 30 random books built twenty minutes after their upload and served twenty minutes later', async () => {
  for (let seed = 300; seed < 330; seed++) {
    const tables = makeBook(seed);
    const db = newDb(tables);
    const stamp = String(NOW - 40 * MIN);
    await phoneIndex(db, NOW, stamp, 'n1');
    const served = await phoneIndex(db, NOW + 25 * MIN, stamp, 'n1');
    assert.equal(shape(served), shape(await oldIndex(newDb(tables), todayKey(NOW + 25 * MIN))), 'seed ' + seed);
  }
});

/* ---------- what the longer life rests on: every writer of what the lists hold moves a stamp ---------- */

test('every writer of a replacement number outside the importers moves NEW_NUMBER_VERSION; every writer of the register outside an upload moves DATA_VERSION', async () => {
  const fs = await import('node:fs');
  const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const code = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const writers = ['api/followup.js', 'api/_lib/call-core.js', 'api/_lib/portal-core.js'];
  for (const f of writers) {
    const src = code(read(f));
    assert.ok(/new_number\s*:/.test(src), f + ' is a writer of new_number (the list is current)');
    assert.ok(/NEW_NUMBER_VERSION/.test(src), f + ' moves NEW_NUMBER_VERSION');
  }
  // no other server file writes new_number outside the importers
  for (const f of fs.readdirSync(new URL('../api/_lib/', import.meta.url)).map(x => 'api/_lib/' + x).concat(['api/upload.js', 'api/comments.js', 'api/expected.js'])) {
    if (!f.endsWith('.js') || writers.includes(f) || /importers\.js$/.test(f)) continue;
    assert.ok(!/new_number\s*:/.test(code(read(f))), f + ' writes new_number and is not on the list of writers that move the stamp');
  }
  // the admin restore of the register
  const portal = code(read('api/_lib/portal-core.js'));
  const fn = portal.slice(portal.indexOf('async function rebuildFollowup'), portal.indexOf('async function findCustomer'));
  assert.ok(/key: 'DATA_VERSION'/.test(fn) && fn.indexOf("key: 'DATA_VERSION'") > fn.indexOf('const restored = await write('), 'rebuildFollowup moves DATA_VERSION after it has written');
  // an upload moves it on the last slice
  const up = code(read('api/upload.js'));
  assert.ok(/if \(isLastPart\) \{\s*try \{\s*await supabase\.from\('settings'\)\s*\.upsert\(\{ key: 'DATA_VERSION'/.test(up), 'api/upload.js moves DATA_VERSION on the last slice');
});

test('the settled life is two named numbers the index reads, ten minutes to settle and thirty to keep', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../api/_lib/call-core.js', import.meta.url), 'utf8');
  assert.ok(/const PHONE_INDEX_SETTLE_MS = 600000;/.test(src));
  assert.ok(/const PHONE_INDEX_SETTLED_TTL_MS = 1800000;/.test(src));
  assert.ok(/const PHONE_INDEX_TTL_MS = 300000;/.test(src), 'and the five minutes stand');
});

/* ---------- the callers ---------- */

test('both callers pass the two stamps apart (no joined string), and the module exports phoneIndex for this file', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../api/_lib/call-core.js', import.meta.url), 'utf8');
  const lines = src.split('\n').filter(l => /phoneIndex\(db, nowMs, /.test(l) && !/export async function phoneIndex/.test(l));
  assert.equal(lines.length, 2, 'sync and find ask for the index: ' + JSON.stringify(lines));
  for (const l of lines) {
    assert.ok(/(DATA_VERSION|rawVersion)/.test(l) && /NEW_NUMBER_VERSION/.test(l), 'both stamps are asked for: ' + l);
    assert.ok(!/\+ '\|' \+/.test(l), 'and they are two arguments, not one joined string: ' + l);
  }
  assert.ok(/export async function phoneIndex\(db, nowMs, dataVersion, numberVersion\)/.test(src));
});
