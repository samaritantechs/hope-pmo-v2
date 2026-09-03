/* THE MASTER SWITCH: is the system side open to everybody, or is this a Calls-only day?

   This is an access-control change on a live system, so it is tested as one. The question a
   test has to answer is not "does the button disappear" -- a hidden button is a courtesy, not
   a lock -- but "does the SERVER refuse", including for somebody who types the address in
   directly or keeps an old page open. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { isSystemOpen, requireSystemOpen, readsAsOpen, isAdminUser, clearSystemOpenCache }
  = await import('../api/_lib/system-gate.js');
const { portalApi } = await import('../api/_lib/portal-core.js');
const { callApi } = await import('../api/_lib/call-core.js');

const NOW = Date.parse('2026-07-24T09:00:00Z');
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] };
const LEADER = { code: 'L', name: 'A LEADER', role: 'GMO', teams: ['KONGOWE'], tabs: ['dashboard', 'followup'] };

const withSetting = value => fakeDb({
  settings: value == null ? [] : [{ key: 'SYSTEM_OPEN', value }],
  teams: [{ team: 'KONGOWE', team_code: 'KON123' }],
  access_codes: [{ code: 'L', name: 'A LEADER', role: 'GMO', teams: ['KONGOWE'] }],
});

test('a switch nobody has set is closed, not open', async () => {
  // The state of a deployment that has never had this decided. "Nobody decided" must not read
  // as "let everybody in" -- that is the failure that would matter.
  assert.equal(await isSystemOpen(withSetting(null), NOW), false);
  assert.equal(await isSystemOpen(withSetting(''), NOW), false);
});

test('only a value that plainly says yes counts as open', async () => {
  for (const yes of ['YES', 'yes', ' On ', 'TRUE', '1', 'open']) {
    assert.equal(readsAsOpen(yes), true, yes + ' means open');
  }
  // Including the ones somebody might type meaning to open it. A near miss reads as closed,
  // which is the harmless direction to be wrong in: the admin tries again.
  for (const no of ['NO', 'FALSE', '0', '', null, undefined, 'ndiyo', 'openish', 'Y']) {
    assert.equal(readsAsOpen(no), false, JSON.stringify(no) + ' does not mean open');
  }
});

test('a settings table that will not answer leaves the system closed', async () => {
  const broken = { from() { throw new Error('database is having a moment'); } };
  assert.equal(await isSystemOpen(broken, NOW), false);
  // And the admin still gets in, because their check never reaches the settings table at all.
  // Otherwise the one person who can reopen the door would be locked out by the same failure.
  assert.equal(await requireSystemOpen(broken, ADMIN, NOW), true);
  await assert.rejects(() => requireSystemOpen(broken, LEADER, NOW), e => e.status === 403);
});

test('closed, the portal refuses a leader and admits an admin', async () => {
  const db = withSetting('NO');
  assert.equal(isAdminUser(ADMIN), true);
  assert.equal(isAdminUser(LEADER), false);
  await assert.rejects(() => requireSystemOpen(db, LEADER, NOW),
    e => e.status === 403 && e.systemClosed === true && /HOPE Calls/.test(e.message));
  assert.equal(await requireSystemOpen(db, ADMIN, NOW), true);
});

test('open, everybody is admitted', async () => {
  const db = withSetting('YES');
  assert.equal(await requireSystemOpen(db, LEADER, NOW), true);
  assert.equal(await requireSystemOpen(db, ADMIN, NOW), true);
});

test('HOPE Live goes dark with the system, and says so without leaking whether a code is real', async () => {
  const closed = withSetting('NO');
  // A real leader code, a real team code and a made-up one all get the same answer, so a
  // closed screen is not a way to find out which codes exist.
  for (const code of ['L', 'KON123', 'NOT-A-CODE']) {
    const r = await callApi(closed, 'api_widget', [code], NOW);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'SYSTEM_CLOSED', code + ' gets the closed answer');
  }
  // Open, a bad code is told it is a bad code again.
  const open = withSetting('YES');
  assert.equal((await callApi(open, 'api_widget', ['NOT-A-CODE'], NOW)).error, 'BAD_CODE');
});

test('the switch is a real toggle, and flipping it takes effect at once', async () => {
  const db = withSetting(null);
  assert.equal((await portalApi(db, ADMIN, 'systemOpenGet', {}, NOW)).open, false);

  const on = await portalApi(db, ADMIN, 'systemOpenSet', { open: true }, NOW);
  assert.equal(on.open, true);
  // Written in the form the reader recognises -- not whatever the caller happened to send.
  assert.equal(db._dump('settings').find(r => r.key === 'SYSTEM_OPEN').value, 'YES');
  /* And visible IMMEDIATELY, despite the half-minute cache the earlier read just filled. An
     admin who flips the switch and then checks must see the new state, not the old one for
     another thirty seconds. */
  assert.equal(await isSystemOpen(db, NOW), true);
  assert.equal(await requireSystemOpen(db, LEADER, NOW), true);

  const off = await portalApi(db, ADMIN, 'systemOpenSet', { open: false }, NOW);
  assert.equal(off.open, false);
  assert.equal(await isSystemOpen(db, NOW), false);
  await assert.rejects(() => requireSystemOpen(db, LEADER, NOW), e => e.status === 403);
});

test('only an admin may read or move the switch', async () => {
  const db = withSetting('YES');
  await assert.rejects(() => portalApi(db, LEADER, 'systemOpenSet', { open: false }, NOW),
    e => e.status === 403);
  await assert.rejects(() => portalApi(db, LEADER, 'systemOpenGet', {}, NOW),
    e => e.status === 403);
  // And a leader cannot get at it the long way round either, through the raw settings editor.
  await assert.rejects(() => portalApi(db, LEADER, 'settingSet', { key: 'SYSTEM_OPEN', value: 'YES' }, NOW),
    e => e.status === 403);
});

test('the answer is remembered per database, so one deployment cannot answer for another', async () => {
  const a = withSetting('YES'), b = withSetting('NO');
  assert.equal(await isSystemOpen(a, NOW), true);
  assert.equal(await isSystemOpen(b, NOW), false, 'b is not handed a\'s answer');

  // The cache holds for half a minute, then asks again.
  b._dump('settings')[0].value = 'YES';
  assert.equal(await isSystemOpen(b, NOW + 5000), false, 'still the remembered answer');
  assert.equal(await isSystemOpen(b, NOW + 31000), true, 'past half a minute it looks again');

  // And can be dropped on demand.
  a._dump('settings')[0].value = 'NO';
  clearSystemOpenCache(a);
  assert.equal(await isSystemOpen(a, NOW), false);
});

test('HOPE Calls is never closed', async () => {
  /* The entire point of the switch: field officers carry on working. Calls has its own door
     and its own identity -- no access code at all -- so nothing on that path may consult the
     switch. Boot answers, and tells the phone whether to offer the way across. */
  const db = fakeDb({
    settings: [{ key: 'SYSTEM_OPEN', value: 'NO' }],
    teams: [{ team: 'KONGOWE', team_code: 'KON123' }],
    call_users: [{ user_id: 'U1', name: 'JUMA G', team: 'KONGOWE', role: 'OFFICER', device_id: 'DEV1', active: true }],
  });
  const closed = await callApi(db, 'api_callBoot', ['DEV1'], NOW);
  assert.equal(closed.ok, true, 'the officer still boots into Calls');
  assert.equal(closed.name, 'JUMA G');
  assert.equal(closed.systemOpen, false, 'but is not offered the switch across');

  // An unregistered phone is told about the switch too, so the sign-in screen agrees with the
  // app it is about to become.
  const stranger = await callApi(db, 'api_callBoot', ['NOPE'], NOW);
  assert.equal(stranger.ok, false);
  assert.equal(stranger.systemOpen, false);

  db._dump('settings')[0].value = 'YES';
  clearSystemOpenCache(db);
  assert.equal((await callApi(db, 'api_callBoot', ['DEV1'], NOW)).systemOpen, true);
});

test('closing the system does not lock the admin out of their own switch', async () => {
  /* "Brother, I am role admin and i too dont see the switch button in the call app!"

     Closing the system takes the way across to the portal off every handset, and the admin who
     closed it is holding a handset too -- so the one person who can reopen it had no button to
     go and do it with. The portal has always let an admin through a closed door; the phone was
     hiding a door that would have opened. */
  const db = fakeDb({
    settings: [{ key: 'SYSTEM_OPEN', value: 'NO' }],
    teams: [{ team: 'KONGOWE', team_code: 'KON123' }],
    call_users: [
      { user_id: 'U1', name: 'JUMA G', team: 'KONGOWE', role: 'OFFICER', device_id: 'DEV1', active: true },
      { user_id: 'U2', name: 'THE BOSS', team: 'KONGOWE', role: 'ADMIN', device_id: 'DEV2', active: true, is_leader: true },
      { user_id: 'U3', name: 'A MANAGER', team: 'KONGOWE', role: 'GMO', device_id: 'DEV3', active: true, is_leader: true },
    ],
  });
  const officer = await callApi(db, 'api_callBoot', ['DEV1'], NOW);
  assert.equal(officer.systemOpen, false);
  assert.equal(officer.systemAdmin, false, 'an officer stays in Calls, which is the whole point');

  const boss = await callApi(db, 'api_callBoot', ['DEV2'], NOW);
  assert.equal(boss.systemOpen, false, 'the system really is closed');
  assert.equal(boss.systemAdmin, true, 'and the admin can still see the way back to it');

  /* NOT EVERY LEADER -- only an admin. "all other users stay in the call app for a moment"
     is what closing it is for, and a GMO is one of those users. */
  const gmo = await callApi(db, 'api_callBoot', ['DEV3'], NOW);
  assert.equal(gmo.systemAdmin, false);
});
