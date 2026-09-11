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
