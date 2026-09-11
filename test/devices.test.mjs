// The company phone register: the office's two panes and the handset's own endpoint.
//
//   "GM wants us to enroll and lock all our hope company phones ... some of uor unworth
//    employees quit with our phones so GM has ordered to implement those two nav panes for
//    locking and unlocking in hopepmo too"
//
// The rule this file exists to hold: the command always flows office -> phone. A handset can
// report what it is doing and can never decide it, and the two panes are two authorities, so
// whoever may lock a leaver's handset is not automatically whoever may hand it back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');
const { deviceApi } = await import('../api/_lib/device-core.js');
const { USER_TABS } = await import('../api/_lib/auth.js');

const NOW = Date.parse('2026-09-11T09:00:00Z');
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['settings'] };
// The two panes as two different people, which is the whole point of there being two.
const LOCKER = { code: 'L', name: 'STORE KEEPER', role: 'STORE', teams: null, tabs: ['devlock'] };
const UNLOCKER = { code: 'U', name: 'HR DESK', role: 'HR', teams: null, tabs: ['devunlock'] };
const NEITHER = { code: 'N', name: 'NOBODY', role: 'GMO', teams: null,
  tabs: USER_TABS.filter(t => t !== 'devlock' && t !== 'devunlock') };

const tables = () => ({ teams: [], access_codes: [], settings: [], devices: [], device_events: [] });
const run = (db, user, fn, args = {}, now = NOW) => portalApi(db, user, fn, args, now);

/* A database where `devices` is simply not there -- the state every deployment is in until
   somebody pastes db/RUN-ME-2026-09-11-devices.sql into the SQL editor. */
function dbWithoutRegister() {
  const inner = fakeDb(tables());
  return { ...inner, from(name) {
    if (name === 'devices' || name === 'device_events') {
      throw new Error('relation "public.' + name + '" does not exist');
    }
    return inner.from(name);
  } };
}

test('enrolling mints one token per phone, and does it once', async () => {
  const db = fakeDb(tables());
  const a = await run(db, LOCKER, 'deviceEnrol', { imeis: '351388334583295, 351388334583296', item: 'A05' });
  assert.equal(a.enrolled, 2);
  assert.equal(a.provision.length, 2);
  for (const p of a.provision) {
    assert.match(p.token, /^[0-9a-f]{32}$/, 'the bench expects 32 hex characters, and nothing else is a token');
    assert.equal(p.fresh, true);
  }
  assert.notEqual(a.provision[0].token, a.provision[1].token, 'one token per phone, never a shared one');

  // Re-enrolling the same handsets is a no-op that says so, and keeps each phone's identity.
  const b = await run(db, LOCKER, 'deviceEnrol', { imeis: '351388334583295' });
  assert.equal(b.enrolled, 0);
  assert.equal(b.alreadyOn, 1);
  assert.equal(b.provision[0].token, a.provision[0].token, 'a second enrolment never re-identifies a handset');
  assert.equal(b.provision[0].fresh, false);
  // ...but it DOES join the new batch, or the hub command would refuse it at the bench.
  assert.notEqual(b.batch, a.batch);
  assert.equal(db._dump('devices').find(d => d.imei === '351388334583295').enrol_batch, b.batch);

  // IMEIs are pasted out of spreadsheets, spaces and all.
  const c = await run(db, LOCKER, 'deviceEnrol', { imeis: '3513 8833 4583 297\n351388334583298' });
  assert.equal(c.enrolled, 2);
  assert.ok(db._dump('devices').some(d => d.imei === '351388334583297'));
});

test('the bench command names the APK that is actually on the phones', async () => {
  /* A WRONG PACKAGE FAILS SILENTLY, which is why this is pinned. `am broadcast` answers a
     package that is not installed with "Broadcast completed: result=0" -- the exact line the
     bench is told to read as success -- while nothing was enrolled at all.

     The default is the signed lock app HOPE actually installs: "set DEVICE_LOCK_PACKAGE to the
     hooploan one so that i dont download another apk nor nothing more". The app takes its
     SERVER at first enrolment, so pointing it at HOPE needs no build of our own. */
  const db = fakeDb(tables());
  const a = await run(db, LOCKER, 'deviceEnrol', { imeis: '350000000000001' });
  assert.equal(a.pkg, 'com.samaritantechs.hooploanlock', 'nothing has to be typed for the app in use');

  // And the day HOPE builds its own, the setting moves the bench command with no deploy.
  const t = tables();
  t.settings = [{ key: 'DEVICE_LOCK_PACKAGE', value: 'com.samaritantechs.hopelock' }];
  const own = await run(fakeDb(t), LOCKER, 'deviceEnrol', { imeis: '350000000000002' });
  assert.equal(own.pkg, 'com.samaritantechs.hopelock');
});

test('the two panes are two authorities, and the gate is on the order not the screen', async () => {
  const db = fakeDb(tables());
  await run(db, LOCKER, 'deviceEnrol', { imeis: '111111111111111' });

  // The unlocking desk cannot lock, however it asks -- curl does not read HTML.
  await assert.rejects(
    () => run(db, UNLOCKER, 'deviceSetState', { imei: '111111111111111', state: 'locked', reason: 'ameacha kazi' }),
    e => e.status === 403 && /Kufunga simu/.test(e.message));
  // And the store keeper cannot hand a handset back.
  await assert.rejects(
    () => run(db, LOCKER, 'deviceSetState', { imei: '111111111111111', state: 'released' }),
    e => e.status === 403 && /Kufungua simu/.test(e.message));
  // Somebody holding neither pane cannot even read the register.
  await assert.rejects(() => run(db, NEITHER, 'deviceList', {}), e => e.status === 403);

  // Each in their own lane, and an admin in both.
  const locked = await run(db, LOCKER, 'deviceSetState',
    { imei: '111111111111111', state: 'locked', reason: 'ameacha kazi na simu' });
  assert.equal(locked.changed, 1);
  const back = await run(db, UNLOCKER, 'deviceSetState', { imei: '111111111111111', state: 'enrolled' });
  assert.equal(back.changed, 1);
  assert.equal(db._dump('devices')[0].state, 'enrolled');
});

test('a lock always carries a reason, and the trail keeps who ordered it', async () => {
  const db = fakeDb(tables());
  await run(db, LOCKER, 'deviceEnrol', { imeis: '222222222222222' });
  await assert.rejects(
    () => run(db, LOCKER, 'deviceSetState', { imei: '222222222222222', state: 'locked' }),
    e => e.status === 400 && /Sababu|reason/i.test(e.message));

  await run(db, LOCKER, 'deviceSetState',
    { imei: '222222222222222', state: 'locked', reason: 'ameacha kazi na simu' });
  const row = db._dump('devices')[0];
  assert.equal(row.state, 'locked');
  assert.equal(row.state_reason, 'ameacha kazi na simu');
  assert.equal(row.state_by, 'STORE KEEPER');
  const ev = db._dump('device_events').filter(e => e.event === 'lock');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].from_state, 'enrolled');
  assert.equal(ev[0].to_state, 'locked');
  assert.equal(ev[0].actor, 'STORE KEEPER');
});

test('the phone is told what to do, and can never tell itself', async () => {
  const db = fakeDb(tables());
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '333333333333333' });
  const token = e.provision[0].token;

  // Enrolled and quiet: run, and come back in a quarter of an hour.
  let beat = await deviceApi(db, 'dev_beat', [{ token, locked: false, battery: 84, appVersion: '1.0' }], NOW);
  assert.equal(beat.command, 'unlock');
  assert.equal(beat.nextBeatSeconds, 900, 'the steady beat is 15 minutes, not Hoop\'s 60 seconds');
  assert.equal(beat.imei, '333333333333333');
  assert.equal(db._dump('devices')[0].reported, 'unlocked');
  assert.equal(db._dump('devices')[0].battery, 84);

  // The office orders a lock. The very next beat carries it, and the phone is told to hurry
  // back until it confirms.
  await run(db, LOCKER, 'deviceSetState',
    { imei: '333333333333333', state: 'locked', reason: 'ameacha kazi' });
  beat = await deviceApi(db, 'dev_beat', [{ token, locked: false }], NOW);
  assert.equal(beat.command, 'lock');
  assert.equal(beat.reason, 'ameacha kazi');
  assert.equal(beat.nextBeatSeconds, 25, 'an order outstanding is chased in seconds');
  assert.match(beat.message, /HOPE MICROCREDIT/, 'the words come from the server, never the APK');

  // It confirms. Now it is settled and goes quiet again.
  beat = await deviceApi(db, 'dev_beat', [{ token, locked: true }], NOW);
  assert.equal(beat.command, 'lock');
  assert.equal(beat.nextBeatSeconds, 900);
  assert.equal(db._dump('devices')[0].reported, 'locked');
  // The transition is history; the heartbeats around it are not.
  assert.equal(db._dump('device_events').filter(x => x.event === 'heartbeat').length, 2);

  /* AND A PHONE CANNOT TALK ITSELF FREE. Whatever it claims about itself, `state` is the
     office's and is never writable from the handset -- the whole security model. */
  await deviceApi(db, 'dev_beat', [{ token, locked: false, state: 'enrolled', command: 'unlock' }], NOW);
  assert.equal(db._dump('devices')[0].state, 'locked');
  const after = await deviceApi(db, 'dev_beat', [{ token }], NOW);
  assert.equal(after.command, 'lock');
});

test('a written-off phone stays locked, and a released one is told to stop calling home', async () => {
  const db = fakeDb(tables());
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '444444444444444' });
  const token = e.provision[0].token;

  await run(db, LOCKER, 'deviceSetState',
    { imei: '444444444444444', state: 'lost', reason: 'ameacha kazi, hajarudisha' });
  let beat = await deviceApi(db, 'dev_beat', [{ token, locked: true }], NOW);
  assert.equal(beat.command, 'lock', 'a handset we have given up on must not come back to life');
  assert.equal(beat.retire, false);

  await run(db, UNLOCKER, 'deviceSetState', { imei: '444444444444444', state: 'released' });
  beat = await deviceApi(db, 'dev_beat', [{ token, locked: true }], NOW);
  assert.equal(beat.command, 'unlock');
  assert.equal(beat.retire, true, 'released means stop beating for good');
  assert.equal(beat.message, null, 'and leave none of our words in a former employee\'s storage');
});

test('an unknown token is refused, and told nothing at all', async () => {
  const db = fakeDb(tables());
  await run(db, LOCKER, 'deviceEnrol', { imeis: '555555555555555' });
  await assert.rejects(() => deviceApi(db, 'dev_beat', [{ token: 'f'.repeat(32) }], NOW),
    e => e.status === 403 && /Not enrolled/.test(e.message));
  await assert.rejects(() => deviceApi(db, 'dev_beat', [{}], NOW), e => e.status === 400);
  // And the door itself takes only the three names it knows.
  await assert.rejects(() => deviceApi(db, 'constructor', [{}], NOW), e => e.status === 400);
  await assert.rejects(() => deviceApi(db, 'dev_wipe', [{}], NOW), e => e.status === 400);
});

test('a handset claims its own identity out of a batch, and never another phone\'s', async () => {
  const db = fakeDb(tables());
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '666666666666661, 666666666666662' });
  const batch = e.batch;

  // The phone reads both SIM slots off itself and collects the token minted for it.
  const got = await deviceApi(db, 'dev_claim', [{ batch, imeis: ['666666666666662', ''] }], NOW);
  assert.equal(got.token, e.provision.find(p => p.imei === '666666666666662').token);

  // An IMEI that is not in the batch gets the same refusal as a bad batch: this endpoint
  // never tells a handset which of its guesses was wrong.
  await assert.rejects(() => deviceApi(db, 'dev_claim', [{ batch, imeis: ['999999999999999'] }], NOW),
    x => x.status === 403);
  await assert.rejects(() => deviceApi(db, 'dev_claim', [{ batch: 'nope', imeis: ['666666666666661'] }], NOW),
    x => x.status === 403);
  // A batch is a bench session, not a standing key: a day later it buys nothing.
  await assert.rejects(
    () => deviceApi(db, 'dev_claim', [{ batch, imeis: ['666666666666661'] }], NOW + 25 * 3600 * 1000),
    x => x.status === 403);
});

/* THE 403 SAYS NOTHING TO THE PHONE AND EVERYTHING TO THE BENCH.
   -----------------------------------------------------------------------------------
   This is the bench failure that has no other thread to pull: the IMEI on the stock sheet
   is not the IMEI inside the handset, so the claim is refused, nothing is written against
   any row, and the operator is left with three possible causes and no way to choose. The
   register now keeps the number the phone gave for itself, which settles it in a glance. */
test('a refused claim is filed for the office, naming the IMEI the handset gave', async () => {
  const db = fakeDb(tables());
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '888888888888881' });

  // What the bench actually hit: the phone reports a number nobody pasted.
  await assert.rejects(() => deviceApi(db, 'dev_claim',
    [{ batch: e.batch, imeis: ['888888888888889'] }], NOW), x => x.status === 403);
  await assert.rejects(() => deviceApi(db, 'dev_claim',
    [{ batch: e.batch, imeis: ['888888888888889'] }], NOW + 60000), x => x.status === 403);

  const seen = await run(db, LOCKER, 'deviceList', { refused: true }, NOW + 120000);
  assert.equal(seen.refused.length, 1, 'one handset, however many times it was tried');
  assert.equal(seen.refused[0].imei, '888888888888889', 'the number the PHONE gave, not the one pasted');
  assert.equal(seen.refused[0].tries, 2);
  assert.equal(seen.refused[0].onRegister, false,
    'and the fact that ends the hunt: this IMEI was never enrolled, so a different one was');

  // A phone that IS on the register but carried a stale command reads the other way round,
  // and the pane tells the operator to take a fresh command rather than to re-type an IMEI.
  const later = await run(db, LOCKER, 'deviceEnrol', { imeis: '888888888888882' }, NOW);
  await assert.rejects(() => deviceApi(db, 'dev_claim',
    [{ batch: later.batch, imeis: ['888888888888881'] }], NOW), x => x.status === 403);
  const two = await run(db, LOCKER, 'deviceList', { refused: true }, NOW + 120000);
  assert.equal(two.refused.length, 2);
  assert.equal(two.refused.find(r => r.imei === '888888888888881').onRegister, true);

  // AND NOTHING IS WRITTEN FOR A BATCH THAT WAS NEVER REAL. Otherwise /api/device, which is
  // the one door with no access code in front of it, would be a table anybody could fill.
  await assert.rejects(() => deviceApi(db, 'dev_claim',
    [{ batch: 'not-a-batch', imeis: ['123456789012345'] }], NOW), x => x.status === 403);
  const after = await run(db, LOCKER, 'deviceList', { refused: true }, NOW + 120000);
  assert.equal(after.refused.length, 2, 'a stranger with no batch leaves no row behind');

  // The pane that never enrols never asks, and so never pays for the read.
  const unlock = await run(db, UNLOCKER, 'deviceList', {}, NOW + 120000);
  assert.deepEqual(unlock.refused, []);
});

test('locking a released-and-silent phone is refused, but the rest of the batch still locks', async () => {
  const db = fakeDb(tables());
  await run(db, LOCKER, 'deviceEnrol', { imeis: '777777777777771, 777777777777772' });
  await run(db, UNLOCKER, 'deviceSetState', { imei: '777777777777771', state: 'released' });

  /* Nineteen phones locked and one refused must never read as "nothing happened" -- the whole
     batch used to be rejected, and the toast that followed looked like success. */
  await assert.rejects(
    () => run(db, LOCKER, 'deviceSetState',
      { imeis: ['777777777777771', '777777777777772'], state: 'locked', reason: 'wameacha kazi' }),
    e => e.status === 409 && e.code === 'RELEASED_NOT_LISTENING'
      && e.changed === 1 && e.imeis.length === 1 && e.imeis[0] === '777777777777771');
  assert.equal(db._dump('devices').find(d => d.imei === '777777777777772').state, 'locked',
    'the phone that could hear the order was locked');

  // The override is a deliberate act, for a phone about to be re-provisioned by cable.
  const forced = await run(db, LOCKER, 'deviceSetState',
    { imei: '777777777777771', state: 'locked', reason: 'app itarudishwa kwa kebo', force: true });
  assert.equal(forced.changed, 1);
});

test('re-enrolling revives a released phone, and never frees a locked one', async () => {
  const db = fakeDb(tables());
  await run(db, LOCKER, 'deviceEnrol', { imeis: '888888888888881, 888888888888882' });
  await run(db, UNLOCKER, 'deviceSetState', { imei: '888888888888881', state: 'released' });
  await run(db, LOCKER, 'deviceSetState',
    { imei: '888888888888882', state: 'locked', reason: 'ameacha kazi' });

  const again = await run(db, LOCKER, 'deviceEnrol', { imeis: '888888888888881, 888888888888882' });
  assert.equal(again.revived, 1, 'and it is SAID, because nobody asked for a state change');
  const rows = db._dump('devices');
  assert.equal(rows.find(d => d.imei === '888888888888881').state, 'enrolled');
  /* THE SAFETY OF THE WHOLE THING: a cable is not an appeal. If enrolment reset state
     generally, plugging in a leaver's handset and running the bench command anybody can copy
     would quietly free it. */
  assert.equal(rows.find(d => d.imei === '888888888888882').state, 'locked');
});

test('the register says who is carrying each phone, and who was', async () => {
  const db = fakeDb(tables());
  await run(db, LOCKER, 'deviceEnrol', { imeis: '999999999999991' });
  await run(db, LOCKER, 'deviceIssue',
    { imei: '999999999999991', holder: 'JUMA G', team: 'KONGOWE', role: 'RECOVERY' });
  let list = await run(db, LOCKER, 'deviceList', {});
  assert.equal(list.rows[0].holder, 'JUMA G');
  assert.equal(list.rows[0].team, 'KONGOWE');
  assert.equal(list.counts.issued, 1);
  assert.equal(list.counts.inStore, 0);

  // Found by the officer's name, not only by the IMEI nobody has memorised.
  list = await run(db, LOCKER, 'deviceList', { q: 'juma' });
  assert.equal(list.rows.length, 1);
  assert.equal(list.searching, true);

  // Handed back in: the fields are cleared rather than left naming somebody who returned it.
  await run(db, LOCKER, 'deviceIssue', { imei: '999999999999991', holder: '' });
  const row = db._dump('devices')[0];
  assert.equal(row.holder, null);
  assert.equal(row.issued_at, null);
  assert.equal(row.state, 'enrolled', 'who holds a phone is a different fact from whether it is locked');
});

test('the register reports what it cannot do rather than failing', async () => {
  /* Every migration in this repository is pasted in by hand, so every code path that needs
     one has to work without it. These panes are new, so the first person to open them will be
     doing it before anybody has run the file. */
  const db = dbWithoutRegister();
  const list = await run(db, LOCKER, 'deviceList', {});
  assert.equal(list.ready, false);
  assert.equal(list.rows.length, 0);
  assert.match(list.note, /RUN-ME-2026-09-11-devices\.sql/);
  const enrol = await run(db, LOCKER, 'deviceEnrol', { imeis: '123456789012345' });
  assert.equal(enrol.ready, false);
  assert.equal(enrol.enrolled, 0);
  const hist = await run(db, LOCKER, 'deviceHistory', { imei: '123456789012345' });
  assert.equal(hist.ready, false);
});

test('a locked phone cannot be deleted out of the register', async () => {
  const db = fakeDb(tables());
  await run(db, LOCKER, 'deviceEnrol', { imeis: '121212121212121' });
  await run(db, LOCKER, 'deviceSetState',
    { imei: '121212121212121', state: 'locked', reason: 'ameacha kazi' });
  /* Deleting the row would leave a locked handset in somebody's hand with nothing left able
     to free it -- the one shape of this feature that cannot be undone from a desk. */
  await assert.rejects(() => run(db, ADMIN, 'deviceDelete', { imei: '121212121212121' }),
    e => e.status === 400 && /LOCKED/.test(e.message));
  await run(db, UNLOCKER, 'deviceSetState', { imei: '121212121212121', state: 'enrolled' });
  const gone = await run(db, ADMIN, 'deviceDelete', { imei: '121212121212121' });
  assert.equal(gone.deleted, true);
  assert.equal(db._dump('devices').length, 0);
  // The history stays: it is the record of what was done to a real phone.
  assert.ok(db._dump('device_events').length > 0);
});

test('the list chases what needs somebody, and names a lock nobody ever confirmed', async () => {
  const db = fakeDb(tables());
  await run(db, LOCKER, 'deviceEnrol', { imeis: '131313131313131, 141414141414141' });
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '151515151515151' });
  // One phone has spoken and is doing as it was told.
  await deviceApi(db, 'dev_beat', [{ token: e.provision[0].token, locked: false }], NOW);
  // One was ordered locked and has never once called home -- the alarm.
  await run(db, LOCKER, 'deviceSetState',
    { imei: '131313131313131', state: 'locked', reason: 'ameacha kazi' });

  const list = await run(db, LOCKER, 'deviceList', {});
  const by = Object.fromEntries(list.rows.map(r => [r.imei, r]));
  assert.equal(by['131313131313131'].lockState, 'pending');
  assert.equal(by['131313131313131'].lockedNeverSpoke, true);
  assert.equal(by['151515151515151'].lockState, 'done');
  assert.equal(by['151515151515151'].neverSeen, false);
  assert.equal(by['141414141414141'].neverSeen, true);
  assert.equal(list.counts.lockPending, 1);
  assert.equal(list.counts.lockedNeverSpoke, 1);
  assert.equal(list.counts.locked, 1);
  assert.equal(list.counts.enrolled, 2);

  // The token is never on the list. It is the handset's credential, fetched one at a time.
  for (const r of list.rows) assert.equal(r.token, undefined);
  const t = await run(db, LOCKER, 'deviceToken', { imei: '151515151515151' });
  assert.equal(t.token, e.provision[0].token);
  // And the desk that only unlocks has no business with the bench's credentials.
  await assert.rejects(() => run(db, UNLOCKER, 'deviceToken', { imei: '151515151515151' }),
    x => x.status === 403);
});

test('a phone still in the store never locks itself for being quiet', async () => {
  const db = fakeDb(tables());
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '161616161616161, 171717171717171' });
  const inStore = e.provision[0].token, issued = e.provision[1].token;
  await run(db, LOCKER, 'deviceIssue', { imei: '171717171717171', holder: 'ASHA J', team: 'MBAGALA' });

  const a = await deviceApi(db, 'dev_beat', [{ token: inStore, locked: false }], NOW);
  assert.equal(a.graceHours, -1, 'a drawer full of spares must not lock itself in the dark');
  const b = await deviceApi(db, 'dev_beat', [{ token: issued, locked: false }], NOW);
  assert.equal(b.graceHours, 24 * 14, 'a fortnight, because an officer can be out of coverage for a week');
});

test('the beat pace is the office\'s to set, with a floor it cannot type away', async () => {
  const t = tables();
  t.settings = [{ key: 'DEVICE_BEAT_SECONDS', value: '300' },
    { key: 'DEVICE_PENDING_BEAT_SECONDS', value: '1' }];
  const db = fakeDb(t);
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '181818181818181' });
  const beat = await deviceApi(db, 'dev_beat', [{ token: e.provision[0].token, locked: false }], NOW);
  assert.equal(beat.nextBeatSeconds, 300, 'five minutes, as the admin asked');

  await run(db, LOCKER, 'deviceSetState',
    { imei: '181818181818181', state: 'locked', reason: 'ameacha kazi' });
  const pending = await deviceApi(db, 'dev_beat', [{ token: e.provision[0].token, locked: false }], NOW);
  /* A typo of 1 here is three hundred handsets hammering the database the upload runs on --
     rule one. The floor is not the admin's to remove. */
  assert.equal(pending.nextBeatSeconds, 25, 'a pending pace below ten seconds is read as the typo it is');
});

/* WHERE A HANDSET LAST WAS -- "add location tracking too, GM will want it."
   The care in this feature is not the coordinate, it is the SECOND fact beside it: the phone
   reports its LAST KNOWN position rather than waking the GPS every beat, so the fix can be
   hours older than the beat carrying it. A register that collapses the two claims a phone is
   somewhere it left on Tuesday, and somebody drives there. */
test('a position is kept with the age of its own fix, never the age of the beat', async () => {
  const db = fakeDb(tables());
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '361000000000001' });
  const token = e.provision[0].token;
  const fixAt = NOW - 3 * 3600 * 1000;                     // taken three hours before it spoke

  await deviceApi(db, 'dev_beat',
    [{ token, locked: false, lat: -6.7924, lng: 39.2083, locAcc: 18, locAt: fixAt }], NOW);
  const row = db._dump('devices')[0];
  assert.equal(row.last_lat, -6.7924);
  assert.equal(row.last_lng, 39.2083);
  assert.equal(row.last_loc_acc, 18);
  assert.equal(Date.parse(row.last_loc_at), fixAt, 'the FIX\'s time, not the beat\'s');
  assert.notEqual(Date.parse(row.last_loc_at), Date.parse(row.last_seen));

  const list = await run(db, LOCKER, 'deviceList', {});
  assert.equal(list.rows[0].lat, -6.7924);
  assert.equal(list.rows[0].locAcc, 18);
  assert.equal(Date.parse(list.rows[0].locAt), fixAt);
});

test('half a coordinate, a nonsense one, or a wrong clock never reaches the register', async () => {
  const db = fakeDb(tables());
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '361000000000002' });
  const token = e.provision[0].token;
  const at = () => db._dump('devices')[0];

  // Half a fix is a point in the sea, so it is dropped WHOLE.
  await deviceApi(db, 'dev_beat', [{ token, lat: -6.79 }], NOW);
  assert.equal(at().last_lat, undefined);
  // 0,0 is the Gulf of Guinea: what a handset sends when it has no fix at all.
  await deviceApi(db, 'dev_beat', [{ token, lat: 0, lng: 0 }], NOW);
  assert.equal(at().last_lat, undefined);
  // Off the globe entirely.
  await deviceApi(db, 'dev_beat', [{ token, lat: 91, lng: 200 }], NOW);
  assert.equal(at().last_lat, undefined);

  /* A FIX STAMPED IN THE FUTURE tells us the phone's CLOCK is wrong, not where it is. The
     position still lands -- it is probably fine -- but the beat's own time stands in, so the
     age on the screen is honest about what we actually know. */
  await deviceApi(db, 'dev_beat',
    [{ token, lat: -6.79, lng: 39.2, locAt: NOW + 40 * 24 * 3600 * 1000 }], NOW);
  assert.equal(at().last_lat, -6.79);
  assert.equal(Date.parse(at().last_loc_at), NOW);
  // And an accuracy nobody sent is null rather than a number somebody might believe.
  assert.equal(at().last_loc_acc, null);
});

test('a beat still lands on a register that has not taken the location columns yet', async () => {
  /* The migration is pasted in by hand like every other, and the location one is SEPARATE
     from the register's own. A handset reporting a position against a register without those
     columns must not lose its beat over it: a phone that cannot report its state is a phone
     the office has lost, while one that cannot report where it was is merely one somebody
     cannot go and find. */
  const inner = fakeDb(tables());
  let stripped = false;
  const db = { ...inner, from(name) {
    const q = inner.from(name);
    if (name !== 'devices') return q;
    const realUpdate = q.update.bind(q);
    q.update = function (patch) {
      if ('last_lat' in patch) {
        stripped = true;
        return { eq: () => ({ error: { message: 'column devices.last_lat does not exist' } }) };
      }
      return realUpdate(patch);
    };
    return q;
  } };
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '361000000000003' });
  const beat = await deviceApi(db, 'dev_beat',
    [{ token: e.provision[0].token, locked: true, battery: 40, lat: -6.79, lng: 39.2 }], NOW);
  assert.equal(stripped, true, 'the first write was refused for the missing column');
  assert.equal(beat.command, 'unlock');
  assert.equal(inner._dump('devices')[0].reported, 'locked', 'and the beat landed anyway');
  assert.equal(inner._dump('devices')[0].battery, 40);
});

test('the lock screen\'s words come from settings, and a missing number promises nothing', async () => {
  const t = tables();
  t.settings = [{ key: 'DEVICE_LOCK_BRAND', value: 'HOPE MICROCREDIT CO. LTD' },
    { key: 'DEVICE_HELP_PHONE', value: '0659077770' }];
  const db = fakeDb(t);
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '191919191919191' });
  const beat = await deviceApi(db, 'dev_beat', [{ token: e.provision[0].token }], NOW);
  assert.equal(beat.brand, 'HOPE MICROCREDIT CO. LTD');
  assert.match(beat.message, /HOPE MICROCREDIT CO\. LTD/);
  assert.match(beat.message, /0659077770/, '{namba} is filled on the server, not by the APK');

  const bare = fakeDb(tables());
  const e2 = await run(bare, LOCKER, 'deviceEnrol', { imeis: '202020202020202' });
  const b2 = await deviceApi(bare, 'dev_beat', [{ token: e2.provision[0].token }], NOW);
  assert.equal(b2.brand, 'HOPE MICROCREDIT');
  assert.doesNotMatch(b2.message, /piga\s*\./i, 'no number, no promise of one');
});

/* THE MARK ON THE LOCKED SCREEN.
   -----------------------------------------------------------------------------------
     "For hope phones this is the logo, so the logos differ"

   HOPE runs Hoop's signed APK on purpose, and the wordmark used to be compiled into it --
   so a locked HOPE handset drew HOOP's mark above the words "HOPE MICROCREDIT". Two
   companies on one screen, in front of the officer deciding whether this is their employer
   or a scam. The mark now travels with the words, and the rules below are what make one
   APK able to serve both companies. */
test('a locked handset is told which mark to draw, and a released one is told none', async () => {
  const db = fakeDb(tables());
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '212121212121212' });
  const beat = await deviceApi(db, 'dev_beat', [{ token: e.provision[0].token }], NOW);

  // A PATH, not a URL: the handset resolves it against the server it was provisioned
  // against, which is the whole mechanism by which one build serves two companies.
  assert.equal(beat.logo[0], '/', 'an absolute URL here would send Hoop\'s phones to HOPE');
  assert.match(beat.logoVersion, /^[0-9a-f]{8}$/, 'generated from the bytes, never typed');

  /* The version is what tells a handset to fetch again. A phone that draws this screen with
     no network redraws from its cached copy, so a version that did not move with the file
     would leave a fleet showing last month's mark with nothing on any screen to say so. */
  const again = await deviceApi(db, 'dev_beat', [{ token: e.provision[0].token }], NOW + 1000);
  assert.equal(again.logoVersion, beat.logoVersion, 'stable while the bytes are');

  // RELEASED MEANS RELEASED. Our logo left cached on a leaver's handset is the opposite of
  // handing the phone back -- the same rule the words already followed.
  await run(db, UNLOCKER, 'deviceSetState', { imei: '212121212121212', state: 'released' });
  const bye = await deviceApi(db, 'dev_beat', [{ token: e.provision[0].token }], NOW + 2000);
  assert.equal(bye.logo, null);
  assert.equal(bye.logoVersion, null);
  assert.equal(bye.brand, null, 'and the words go with it, as they always did');
});

test('the office can point the mark elsewhere, or turn it off without falling back', async () => {
  const t = tables();
  t.settings = [{ key: 'DEVICE_LOCK_LOGO', value: 'https://cdn.example/hope-white.png' }];
  const db = fakeDb(t);
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '222222222222221' });
  const beat = await deviceApi(db, 'dev_beat', [{ token: e.provision[0].token }], NOW);
  assert.equal(beat.logo, 'https://cdn.example/hope-white.png');
  assert.equal(beat.logoVersion, 'https://cdn.example/hope-white.png',
    'an address is its own version: change it and every handset refetches');

  /* `none` MUST MEAN NO MARK, not "use whatever is baked into the APK". Falling back is
     exactly how HOOP's logo lands on a HOPE phone, which is what this whole change exists
     to prevent -- so the off switch has to be unambiguous on the wire. */
  for (const off of ['none', 'NONE', 'hakuna', '-', '  none  ']) {
    const t2 = tables();
    t2.settings = [{ key: 'DEVICE_LOCK_LOGO', value: off }];
    const db2 = fakeDb(t2);
    const e2 = await run(db2, LOCKER, 'deviceEnrol', { imeis: '222222222222222' });
    const b2 = await deviceApi(db2, 'dev_beat', [{ token: e2.provision[0].token }], NOW);
    assert.equal(b2.logo, null, off);
    assert.equal(b2.logoVersion, null, off);
  }
});

/* SHIFTING A HANDSET TO THE OTHER COMPANY, WITHOUT A FACTORY RESET.
   -----------------------------------------------------------------------------------
     "another button for shift so that hoop can shift a device to hope and viceversa
      saving re-enlorrment energy"

   Achia gives up Device Owner, and taking it back is refused while any account is signed
   in -- so on a phone that has been in use, achia-then-enrol means a factory reset. Shift
   writes an ORDER onto the row instead: the next beat hands the phone a server + batch,
   exactly like a lock order, and the phone (not tested here -- see Shift.java) does the
   rest without ever letting go of ownership. */
test('a shift order rides the next beat, exactly like a lock order does', async () => {
  const db = fakeDb(tables());
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '303030303030301' });
  const token = e.provision[0].token;

  await assert.rejects(() => run(db, LOCKER, 'deviceShift',
    { imei: '303030303030301', server: 'http://other.example', batch: 'a'.repeat(32) }),
    x => x.status === 400, 'http, not https, is refused');
  await assert.rejects(() => run(db, LOCKER, 'deviceShift',
    { imei: '303030303030301', server: 'https://other.example', batch: 'not-a-batch' }),
    x => x.status === 400, 'a batch that is not 32 hex characters is refused');

  const ordered = await run(db, LOCKER, 'deviceShift',
    { imei: '303030303030301', server: 'https://other.example/', batch: 'b'.repeat(32) });
  assert.equal(ordered.ordered, 1);
  assert.equal(ordered.server, 'https://other.example', 'a trailing slash is trimmed');

  const beat = await deviceApi(db, 'dev_beat', [{ token }], NOW);
  assert.deepEqual(beat.shift, { server: 'https://other.example', batch: 'b'.repeat(32) });

  // Only Kufunga simu may order one -- the same lane enrolling already uses.
  await assert.rejects(() => run(db, UNLOCKER, 'deviceShift',
    { imei: '303030303030301', server: 'https://other.example', batch: 'c'.repeat(32) }),
    x => x.status === 403);
});

test('the departing phone tells this office it left, and the row reads released', async () => {
  const db = fakeDb(tables());
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '303030303030302' });
  const token = e.provision[0].token;
  await run(db, LOCKER, 'deviceShift',
    { imei: '303030303030302', server: 'https://other.example', batch: 'd'.repeat(32) });

  // The handset posts dev_shifted with the OLD token, once the new office has answered.
  const said = await deviceApi(db, 'dev_shifted', [{ token }], NOW);
  assert.equal(said.ok, true);

  const row = db._dump('devices').find(d => d.imei === '303030303030302');
  assert.equal(row.state, 'released');
  assert.equal(row.shift_server, null, 'the order is cleared once it is confirmed');
  const ev = db._dump('device_events').find(x => x.event === 'shifted');
  assert.ok(ev, 'the transition is in the trail');

  // An unknown token proves nothing -- same refusal every dev_* door already gives one.
  await assert.rejects(() => deviceApi(db, 'dev_shifted', [{ token: 'x'.repeat(32) }], NOW),
    x => x.status === 403);
});

test('a released phone is not shiftable, and an unknown IMEI is refused up front', async () => {
  const db = fakeDb(tables());
  await run(db, LOCKER, 'deviceEnrol', { imeis: '303030303030303' });
  await run(db, UNLOCKER, 'deviceSetState', { imei: '303030303030303', state: 'released' });

  const r = await run(db, LOCKER, 'deviceShift',
    { imei: '303030303030303', server: 'https://other.example', batch: 'e'.repeat(32) });
  assert.equal(r.ordered, 0);
  assert.equal(r.alreadyReleased, 1, 'a released phone is not beating here to receive it');

  await assert.rejects(() => run(db, LOCKER, 'deviceShift',
    { imei: '999999999999999', server: 'https://other.example', batch: 'f'.repeat(32) }),
    x => x.status === 400, 'nothing on the register to order at all');
});

/* THE STATE CARRIES ACROSS -- SAFELY.
   -----------------------------------------------------------------------------------
     "when we shift it goes with current state"

   Only LOCKED or LOST are trusted from the claim, and only ever onto a row still at its
   own default: this office's own opinion, once formed, is never overwritten by what a
   phone says about itself. */
test('a claim can carry LOCKED or LOST across, but never onto a row already decided', async () => {
  const db = fakeDb(tables());
  const e = await run(db, LOCKER, 'deviceEnrol', { imeis: '404040404040401' });
  const batch = e.batch;

  const got = await deviceApi(db, 'dev_claim',
    [{ batch, imeis: ['404040404040401'], state: 'locked', reason: 'ameacha kazi na simu' }], NOW);
  assert.ok(got.token);
  const row = db._dump('devices').find(d => d.imei === '404040404040401');
  assert.equal(row.state, 'locked');
  assert.match(row.state_reason, /ameacha kazi na simu/);
  assert.equal(row.state_by, 'shift');
  const ev = db._dump('device_events').find(x => x.to_state === 'locked');
  assert.ok(ev, 'the transition is in the trail like any other lock');

  // 'enrolled' carried across is a no-op: that is the row's own default already.
  const e2 = await run(db, LOCKER, 'deviceEnrol', { imeis: '404040404040402' });
  await deviceApi(db, 'dev_claim',
    [{ batch: e2.batch, imeis: ['404040404040402'], state: 'enrolled' }], NOW);
  assert.equal(db._dump('devices').find(d => d.imei === '404040404040402').state, 'enrolled');

  // A row this office already decided about is never overwritten by an incoming claim.
  // Once state leaves 'enrolled' -- this office's own action, taken independent of anything
  // a phone claims about its history -- a later claim on the SAME batch can never move it,
  // whichever direction it argues for.
  const e3 = await run(db, LOCKER, 'deviceEnrol', { imeis: '404040404040403' });
  await run(db, LOCKER, 'deviceSetState',
    { imei: '404040404040403', state: 'locked', reason: 'ofisi hii iliamua' });
  await deviceApi(db, 'dev_claim',
    [{ batch: e3.batch, imeis: ['404040404040403'], state: 'lost', reason: 'x' }], NOW);
  const row3 = db._dump('devices').find(d => d.imei === '404040404040403');
  assert.equal(row3.state, 'locked', 'this office\'s own lock stands; a claim never argues it away');
  assert.equal(row3.state_reason, 'ofisi hii iliamua');
});
