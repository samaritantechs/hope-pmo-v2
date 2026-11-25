/* THE BELL REPEATS TODAY'S PROMISE EVERY THREE HOURS (handbook Part 161) --

     "At notification bell: Default Customers with today's date promise, no recovery and no "amepigiwa leo" must always repeat the same promise
      notification after every 3 hrs."                                                                    -- the owner, 25 Nov 2026

   Through the real doors of the bell (the phone's api_callNotifications and the portal's notifications): the day's three-hour slots from the promise's own
   stamp (09:00, 12:00, 15:00, 18:00 East Africa time); that the same item becomes new again after the reader marked everything read; who is NOT reminded
   (spoken to today, money typed today, nothing open); that a check which cannot answer reminds nobody; that nothing is asked of the database when no promise
   is due today; and the call page's own clock. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { callApi, _clearWidgetCache } = await import('../api/_lib/call-core.js');
const { portalApi } = await import('../api/_lib/portal-core.js');
const { notifCore, promiseSlot, PROMISE_REPEAT_MS, PROMISE_DAY_MS } = await import('../api/_lib/notify.js');

const DAY = '2026-11-25', YESTERDAY = '2026-11-24', TOMORROW = '2026-11-26';
const at = hhmmZ => Date.parse(DAY + 'T' + hhmmZ + ':00Z');                 // Z is three hours behind East Africa: 06:00Z is 09:00 there
const T0930 = at('06:30'), T1130 = at('08:30'), T1230 = at('09:30'), T1530 = at('12:30'), T1830 = at('15:30'), T2130 = at('18:30'), T2230 = at('19:30');

const P = (ref, over = {}) => ({ ref, team: 'KONGOWE', full_name: 'MTEJA ' + ref, contact: '0714' + ref.replace(/\D/g, '').padStart(6, '0'), guarantor_contact: '0755' + ref.replace(/\D/g, '').padStart(6, '0'),
  arrears: 50000, status: 'Defaulter', fu_status: 'AMETOA AHADI', promise_date: DAY, promise_amt: 20000, comment_by: 'JUMA ISSA', ...over });
const book = (promises = [P('P1')], extra = {}) => ({
  teams: [{ team: 'KONGOWE', team_code: 'KON123', recovery: 'ASHA JUMA' }, { team: 'MBAGALA', team_code: 'MBA456' }],
  access_codes: [{ code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['settings'] }],
  roles: [], settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }, { key: 'CALL_MIN_SECS', value: '5' }],
  followup_status: promises, followup_comments: [], complaints: [], call_logs: [], pmo_adjustments: [], call_users: [], ...extra });
const ADMIN = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['settings'] };

async function phone(tables) {
  _clearWidgetCache();
  const db = fakeDb(tables);
  await callApi(db, 'api_callRegister', ['d1', 'JUMA ISSA', '', '', '0712999999', 'KON123'], T0930);
  return db;
}
const bell = (db, now) => callApi(db, 'api_callNotifications', ['d1'], now);
const read = (db, now) => callApi(db, 'api_callNotifSeen', ['d1'], now);
const promiseOf = d => (d.items || []).find(x => x.kind === 'promise');
const call = (over = {}) => ({ id: 'c' + Math.random().toString(36).slice(2), user_id: 'OTHER-OFFICER', officer: 'OTHER O', team: 'MBAGALA', phone: '0714000001', call_date: DAY, duration: 60, portfolio: true, outcome: 'CONNECTED', ...over });

test('THE MARKS: 09:00, 12:00, 15:00, 18:00 and 21:00 East Africa time for a promise from an earlier day; from the moment of logging for one logged today; none after 21:00; midnight to nine is the first', () => {
  assert.equal(PROMISE_REPEAT_MS, 3 * 3600 * 1000); assert.equal(PROMISE_DAY_MS, 12 * 3600 * 1000);
  const z = hh => promiseSlot(DAY, at(hh));
  assert.deepEqual(z('00:30'), { slot: 0, at: DAY + 'T06:00:00.000Z', next: DAY + 'T09:00:00.000Z' }, 'before the day starts it is the first telling, as it always was');
  assert.deepEqual(z('06:00'), { slot: 0, at: DAY + 'T06:00:00.000Z', next: DAY + 'T09:00:00.000Z' });
  for (const [hh, slot] of [['08:59', 0], ['09:00', 1], ['11:59', 1], ['12:00', 2], ['14:59', 2], ['15:00', 3], ['17:59', 3], ['18:00', 4], ['23:59', 4]]) assert.equal(z(hh).slot, slot, hh + 'Z');
  assert.deepEqual(z('15:00'), { slot: 3, at: DAY + 'T15:00:00.000Z', next: DAY + 'T18:00:00.000Z' });
  assert.deepEqual(z('18:00'), { slot: 4, at: DAY + 'T18:00:00.000Z', next: null }, '21:00 East Africa time is the last mark of the day');
  assert.deepEqual(z('23:59'), { slot: 4, at: DAY + 'T18:00:00.000Z', next: null }, 'nothing after it');
  // a promise logged TODAY begins when it was logged
  const L = (now, logged) => promiseSlot(DAY, at(now), at(logged));
  assert.deepEqual(L('07:41', '07:40'), { slot: 0, at: DAY + 'T07:40:00.000Z', next: DAY + 'T10:40:00.000Z' }, 'new the moment it is written');
  assert.equal(L('10:39', '07:40').slot, 0); assert.deepEqual(L('10:40', '07:40'), { slot: 1, at: DAY + 'T10:40:00.000Z', next: DAY + 'T13:40:00.000Z' });
  assert.deepEqual(L('16:50', '07:40'), { slot: 3, at: DAY + 'T16:40:00.000Z', next: null }, 'three marks after it was logged, and the one after that is past 21:00');
  assert.equal(L('19:50', '07:40').slot, 3);
  assert.deepEqual(L('06:30', '04:00'), { slot: 0, at: DAY + 'T06:00:00.000Z', next: DAY + 'T09:00:00.000Z' }, 'logged before nine: it starts at nine');
  assert.deepEqual(promiseSlot(DAY, at('09:30'), Date.parse('2026-11-24T10:00:00Z')), { slot: 1, at: DAY + 'T09:00:00.000Z', next: DAY + 'T12:00:00.000Z' }, 'logged on an earlier day: the morning\'s marks');
  assert.equal(L('07:00', '09:00').at, DAY + 'T07:00:00.000Z', 'a logged time ahead of the clock never runs ahead of it');
  assert.deepEqual(L('19:30', '19:00'), { slot: 0, at: DAY + 'T19:00:00.000Z', next: null }, 'logged after the last mark: told once, never again');
  for (const junk of [null, undefined, NaN, 'x', {}]) assert.equal(promiseSlot(DAY, at('09:30'), junk).slot, 1, 'a logged time that is not a time is ignored');
  assert.equal(promiseSlot('not a day', at('09:00')), null); assert.equal(promiseSlot(DAY, NaN), null); assert.equal(promiseSlot(null, at('09:00')), null);
});

test('THE SAME PROMISE IS NEW AGAIN AT 12:00, 15:00 AND 18:00 after the officer marked everything read: same id, the words with "reminder", the next mark named; and nothing after 18:00', async () => {
  const db = await phone(book());
  let d = await bell(db, T0930);
  let p = promiseOf(d);
  assert.ok(p && p.repeat === 0 && p.unseen === true && p.at === DAY + 'T06:00:00.000Z', 'the first telling is the morning\'s');
  assert.ok(!/kumbusho|reminder/.test(p.what), 'the first telling has no reminder in it');
  assert.equal(d.nextRepeatAt, DAY + 'T09:00:00.000Z', 'the page is told when to look again');
  const id = p.id;
  await read(db, T0930 + 60000);
  assert.equal((await bell(db, T1130)).unseen, 0, 'read at 09:31, still read at 11:30');
  d = await bell(db, T1230); p = promiseOf(d);
  assert.equal(d.unseen, 1, 'at 12:30 the same promise is new again'); assert.equal(p.id, id, 'the SAME item, not another');
  assert.equal(p.repeat, 1); assert.equal(p.at, DAY + 'T09:00:00.000Z'); assert.match(p.what, /Ahadi ya leo \/ promise due today.*kumbusho \/ reminder$/);
  assert.equal(d.nextRepeatAt, DAY + 'T12:00:00.000Z');
  await read(db, T1230 + 60000);
  assert.equal((await bell(db, T1230 + 120000)).unseen, 0);
  d = await bell(db, T1530); assert.equal(d.unseen, 1); assert.equal(promiseOf(d).repeat, 2); assert.equal(d.nextRepeatAt, DAY + 'T15:00:00.000Z');
  await read(db, T1530 + 60000);
  d = await bell(db, T1830); assert.equal(d.unseen, 1); assert.equal(promiseOf(d).repeat, 3); assert.equal(d.nextRepeatAt, DAY + 'T18:00:00.000Z');
  await read(db, T1830 + 60000);
  d = await bell(db, T2130); assert.equal(d.unseen, 1, 'and at 21:00'); assert.equal(promiseOf(d).repeat, 4); assert.equal(d.nextRepeatAt, null, 'the last mark of the day: nothing more to look for');
  await read(db, T2130 + 60000);
  d = await bell(db, T2230); assert.equal(d.unseen, 0, 'after 21:00 it is not told again'); assert.equal(d.nextRepeatAt, null);
});

test('A PROMISE LOGGED TODAY FOR TODAY RUNS TOO: new the moment it is written, for a reader who had already read everything, and again every three hours after it was logged', async () => {
  const logged = DAY + 'T07:40:00Z';                                           // 10:40 East Africa time
  const db = await phone(book([P('P1', { comment_at: logged })]));
  await read(db, at('07:00'));                                                // the officer read the bell at 10:00, before the promise existed
  let d = await bell(db, at('07:41')), p = promiseOf(d);
  assert.equal(d.unseen, 1, 'a promise written today for today is new at once'); assert.equal(p.repeat, 0); assert.equal(p.at, logged.replace('Z', '.000Z'));
  assert.ok(!/kumbusho|reminder/.test(p.what), 'the first telling has no reminder in it');
  assert.equal(d.nextRepeatAt, DAY + 'T10:40:00.000Z', 'three hours after it was logged');
  await read(db, at('07:42'));
  assert.equal((await bell(db, at('10:39'))).unseen, 0, 'not before the three hours');
  d = await bell(db, at('10:41')); assert.equal(d.unseen, 1); assert.equal(promiseOf(d).repeat, 1); assert.match(promiseOf(d).what, /kumbusho \/ reminder$/); assert.equal(d.nextRepeatAt, DAY + 'T13:40:00.000Z');
  await read(db, at('10:42'));
  d = await bell(db, at('13:41')); assert.equal(d.unseen, 1); assert.equal(promiseOf(d).repeat, 2);
  await read(db, at('13:42'));
  d = await bell(db, at('16:41')); assert.equal(d.unseen, 1); assert.equal(promiseOf(d).repeat, 3); assert.equal(d.nextRepeatAt, null, '19:40 East Africa time is the last: the next would be past 21:00');
  await read(db, at('16:42'));
  assert.equal((await bell(db, at('19:41'))).unseen, 0);
  // the same promise, written yesterday for today: the morning's marks, not yesterday's time
  const old = await phone(book([P('P1', { comment_at: '2026-11-24T10:00:00Z' })]));
  await read(old, at('06:31'));
  assert.equal((await bell(old, at('08:30'))).unseen, 0); assert.equal((await bell(old, at('09:30'))).unseen, 1);
  // and the one logged today but spoken to since is quiet from the start
  const called = await phone(book([P('P1', { comment_at: logged })], { call_logs: [call({ phone: '0714000001' })] }));
  await read(called, at('07:00'));
  assert.equal((await bell(called, at('07:41'))).unseen, 0, 'the customer was spoken to today: nothing to remind');
});

test('A READER WHO HAS NOT PRESSED "MARK ALL READ" SEES IT ONCE: the repeat is a newer time, never a second item', async () => {
  const db = await phone(book());
  const d = await bell(db, T1530);
  assert.equal((d.items || []).filter(x => x.kind === 'promise').length, 1, 'one item however many slots have passed');
  assert.equal(d.unseen, 1);
});

test('YESTERDAY\'S PROMISE IS NOT TOLD AGAIN, TOMORROW\'S IS NOT YET, A CLEARED OR CHANGED ONE IS NOT THERE: the repeat is for today\'s open promise only', async () => {
  // beside one due today and uncalled, so that the check does run and an overdue one could be taken for a reminder
  const db = await phone(book([P('P1', { promise_date: YESTERDAY }), P('P2', { promise_date: TOMORROW }), P('P3', { arrears: 0 }), P('P4', { promise_date: null, fu_status: 'REJESHO LIMELIWA' }), P('P5')]));
  await read(db, T0930 + 60000);
  const d = await bell(db, T1230);
  const ps = Object.fromEntries((d.items || []).filter(x => x.kind === 'promise').map(x => [x.ref, x]));
  assert.deepEqual(Object.keys(ps).sort(), ['P1', 'P5'], 'yesterday\'s overdue one and today\'s: tomorrow\'s, the cleared one and the one the officer closed are not on the bell');
  assert.equal(ps.P1.late, true); assert.equal(ps.P1.repeat, 0, 'an overdue promise is not told again'); assert.equal(ps.P1.at, YESTERDAY + 'T06:00:00.000Z', 'its stamp is its own day\'s, as it always was');
  assert.equal(ps.P5.repeat, 1); assert.equal(d.unseen, 1, 'only today\'s is new');
  const alone = await phone(book([P('P1', { promise_date: YESTERDAY })]));
  await read(alone, T0930 + 60000);
  const a = await bell(alone, T1230); assert.equal(a.unseen, 0); assert.equal(a.nextRepeatAt, null);
});

test('NOBODY IS REMINDED WHO WAS SPOKEN TO TODAY: the customer\'s own number, the guarantor\'s, by any officer; a three-second dial, yesterday, and a number recorded under "Ana namba nyingine" do not count', async () => {
  const cases = [
    ['their own number', [call({ phone: '0714000001' })], true],
    ['the guarantor\'s number', [call({ phone: '0755000001' })], true],
    ['the number in international form', [call({ phone: '+255 714 000 001' })], true],
    ['a three-second dial', [call({ phone: '0714000001', duration: 3 })], false],
    ['exactly the minimum seconds (not LONGER than it)', [call({ phone: '0714000001', duration: 5 })], false],
    ['yesterday\'s call', [call({ phone: '0714000001', call_date: YESTERDAY })], false],
    ['somebody else\'s number', [call({ phone: '0714999999' })], false],
  ];
  for (const [why, logs, skipped] of cases) {
    const db = await phone(book([P('P1')], { call_logs: logs }));
    await read(db, T0930 + 60000);
    const d = await bell(db, T1230);
    assert.equal(d.unseen, skipped ? 0 : 1, why + (skipped ? ': spoken to, so no reminder' : ': not a conversation today, so it is reminded'));
    assert.equal(promiseOf(d).repeat, skipped ? 0 : 1, why);
  }
  // "Ana namba nyingine": a call to a number the officer recorded for the customer is a portfolio call everywhere, but not the grey tick, so it does not stop the reminder.
  const db = await phone(book([P('P1')], { call_logs: [call({ phone: '0766123456' })], followup_comments: [{ id: 'k1', ref: 'P1', team: 'KONGOWE', fu_status: 'ANA NAMBA NYINGINE', new_number: '766123456', created_by: 'JUMA ISSA', created_at: DAY + 'T05:00:00Z' }] }));
  await read(db, T0930 + 60000);
  assert.equal((await bell(db, T1230)).unseen, 1, 'a call to the number recorded under Ana namba nyingine is not the tick');
});

test('NOBODY IS REMINDED FOR WHOM MONEY WAS TYPED TODAY: a Miamala on the register against the ref, in any of the four books; not yesterday\'s, not another ref\'s, not nothing', async () => {
  const entry = over => ({ team: 'KONGOWE', target: 'defaulter-current', amount: 20000, adj_date: DAY, ref: 'P1', ...over });
  for (const [why, row, skipped] of [
    ['an arrears entry today', entry(), true],
    ['an entry against the initial arrears book', entry({ target: 'defaulter-initial' }), true],
    ['an entry against the day\'s expected sheet', entry({ target: 'expected-current' }), true],
    ['the early-collection book', entry({ target: 'expected-initial' }), true],
    ['yesterday\'s entry', entry({ adj_date: YESTERDAY }), false],
    ['another customer\'s entry', entry({ ref: 'P9' }), false],
    ['an entry that nets to nothing', entry({ amount: 0 }), false],
    ['an entry with no ref', entry({ ref: null }), false],
  ]) {
    const db = await phone(book([P('P1')], { pmo_adjustments: [row] }));
    await read(db, T0930 + 60000);
    const d = await bell(db, T1230);
    assert.equal(d.unseen, skipped ? 0 : 1, why);
  }
  // two entries that net below nothing are not a payment
  const db = await phone(book([P('P1')], { pmo_adjustments: [{ team: 'KONGOWE', target: 'defaulter-current', amount: 20000, adj_date: DAY, ref: 'P1' }, { team: 'KONGOWE', target: 'defaulter-current', amount: -20000, adj_date: DAY, ref: 'P1' }] }));
  await read(db, T0930 + 60000);
  assert.equal((await bell(db, T1230)).unseen, 1, 'a payment and its correction net to nothing: not a customer who paid');
});

test('EACH PROMISE IS JUDGED ALONE: two promises today, one spoken to and one not, and the mark to look again is the earliest of those still being reminded', async () => {
  const db = await phone(book([P('P1'), P('P2')], { call_logs: [call({ phone: '0714000001' })] }));
  await read(db, T0930 + 60000);
  const d = await bell(db, T1230);
  const by = Object.fromEntries(d.items.filter(x => x.kind === 'promise').map(x => [x.ref, x]));
  assert.equal(by.P1.repeat, 0, 'P1 was called'); assert.equal(by.P2.repeat, 1, 'P2 was not');
  assert.equal(d.unseen, 1); assert.equal(d.nextRepeatAt, DAY + 'T12:00:00.000Z');
  const all = await phone(book([P('P1'), P('P2')], { call_logs: [call({ phone: '0714000001' }), call({ phone: '0714000002' })] }));
  assert.equal((await bell(all, T1230)).nextRepeatAt, null, 'both spoken to: nothing to look for');
  // two promises logged at different moments: the page is told the EARLIEST next mark, and then the next after it
  const two = await phone(book([P('P1', { comment_at: DAY + 'T08:10:00Z' }), P('P2', { comment_at: DAY + 'T07:40:00Z' }), P('P3', { comment_at: DAY + 'T07:00:00Z' })], { call_logs: [call({ phone: '0714000003' })] }));
  let w = await bell(two, at('08:20'));
  assert.equal(w.nextRepeatAt, DAY + 'T10:40:00.000Z', 'P2\'s mark, not P1\'s (13:10) and not P3\'s, who was spoken to');
  w = await bell(two, at('10:45'));
  assert.equal(w.nextRepeatAt, DAY + 'T11:10:00.000Z', 'then P1\'s');
});

test('THE REMINDER IS FOR THE READER\'S OWN TEAMS: another team\'s promise is not on this handset\'s bell, repeated or not', async () => {
  const db = await phone(book([P('P1'), P('P2', { team: 'MBAGALA' })]));
  const d = await bell(db, T1230);
  assert.deepEqual(d.items.filter(x => x.kind === 'promise').map(x => x.ref), ['P1']);
});

test('A CHECK THAT CANNOT ANSWER REMINDS NOBODY, NEVER A GUESS: no check given, one that throws, one that answers something else, and one that is too slow: the bell is as it was', async () => {
  const seen = '2026-11-25T06:31:00.000Z';
  const base = book([P('P1')], { settings: [{ key: 'NOTIF_SEEN_X', value: seen }] });
  const asIs = async deps => { const d = await notifCore(fakeDb(base), { teams: ['KONGOWE'] }, 'NOTIF_SEEN_X', T1230, deps); return d; };
  for (const [why, deps] of [
    ['no check', undefined], ['an empty set of deps', {}], ['a check that throws', { skipToday: async () => { throw new Error('boom'); } }],
    ['a check that answers null', { skipToday: async () => null }], ['a check that answers an array', { skipToday: async () => ['P1'] }],
  ]) {
    const d = await asIs(deps);
    assert.equal(d.unseen, 0, why + ': the promise was read at 09:31 and is not told again'); assert.equal(promiseOf(d).repeat, 0, why); assert.equal(d.nextRepeatAt, null, why);
  }
  // and the one that answers a Set that does not name the customer reminds them
  const d = await asIs({ skipToday: async rows => new Set(rows.filter(r => r.ref === 'nobody').map(r => r.ref)) });
  assert.equal(d.unseen, 1); assert.equal(promiseOf(d).repeat, 1);
});

test('A CALLS READ THAT IS TOO SLOW IS "CANNOT TELL": the bell answers within its budget and reminds nobody', async () => {
  const db = await phone(book([P('P1')]));
  const from = db.from.bind(db);
  db.from = name => {
    const q = from(name);
    if (name !== 'call_logs') return q;
    const slow = new Proxy(q, { get(o, p) {
      if (p === 'then') return (res, rej) => new Promise(r => setTimeout(r, 2600)).then(() => o.then(res, rej));
      const v = o[p]; return typeof v === 'function' ? (...a) => { const out = v.apply(o, a); return out === o ? slow : out; } : v;
    } });
    return slow;
  };
  await read(db, T0930 + 60000);
  const started = Date.now();
  const d = await bell(db, T1230);
  assert.ok(Date.now() - started < 1500, 'the bell did not wait for the slow read: ' + (Date.now() - started) + ' ms (its budget is 800)');
  assert.equal(d.unseen, 0); assert.equal(promiseOf(d).repeat, 0);
});

test('THE PORTAL\'S BELL IS THE SAME BELL: the same promise, the same rule for who is not reminded, kept apart for each code\'s own "read up to here"', async () => {
  const t = book([P('P1'), P('P2')], { call_logs: [call({ phone: '0714000002' })] });
  const db = fakeDb(t);
  let d = await portalApi(db, ADMIN, 'notifications', {}, T0930);
  assert.equal(d.unseen, 2);
  await portalApi(db, ADMIN, 'notifSeen', {}, T0930 + 60000);
  d = await portalApi(db, ADMIN, 'notifications', {}, T1230);
  assert.deepEqual(d.items.filter(x => x.kind === 'promise' && x.repeat >= 1).map(x => x.ref), ['P1'], 'P2 was spoken to: no reminder; P1 was not');
  assert.equal(d.unseen, 1); assert.equal(d.nextRepeatAt, DAY + 'T12:00:00.000Z');
});

test('WHAT IT COSTS THE PATH (CLAUDE.md section 1): a reader with no promise due today asks the database for nothing new; one with a promise asks the day\'s calls and the typed payments, each once', async () => {
  const count = db => { const n = {}; const f = db.from.bind(db); db.from = t => { n[t] = (n[t] || 0) + 1; return f(t); }; return n; };
  const quiet = await phone(book([P('P1', { promise_date: TOMORROW }), P('P2', { promise_date: YESTERDAY })]));
  const nq = count(quiet); await bell(quiet, T1230);
  assert.ok(!nq.call_logs && !nq.pmo_adjustments && !nq.settings === false ? true : !nq.call_logs && !nq.pmo_adjustments, 'no promise due today: neither the calls nor the typed payments were read: ' + JSON.stringify(nq));
  assert.equal(nq.followup_status, 1, 'the promise read is the one it always was');
  const busy = await phone(book([P('P1'), P('P2'), P('P3')]));
  const nb = count(busy); await bell(busy, T1230);
  assert.equal(nb.followup_status, 1, 'one read of the register however many promises are due today');
  assert.equal(nb.call_logs, 1, 'the day\'s called numbers, once for all of them'); assert.equal(nb.pmo_adjustments, 1, 'the typed payments, once for all of them');
});

test('THE CALL PAGE LOOKS AGAIN AT THE NEXT MARK, ONCE, SPREAD OUT, NEVER WHEN HIDDEN: its clock run on its own with stand-ins', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/call.html'), 'utf8');
  const fn = /function bellRemind_\(d\)\{[\s\S]*?\n\}\n/.exec(html);
  assert.ok(fn, 'bellRemind_ is on the page');
  const make = (now, hidden = false) => {
    const timers = [], cleared = [], toasts = [], refreshes = [];
    const win = { BELL_TIMER: null, BELL_OPEN: false, S: { notif: null }, document: { hidden },
      Date: class extends Date { static now() { return now; } }, Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
      setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: id => cleared.push(id),
      toast: m => toasts.push(m), isFinite, parseInt,
      bellRefresh: () => { refreshes.push(1); return Promise.resolve(win.__answer); } };
    vm.createContext(win); vm.runInContext('var BELL_TIMER = null;' + fn[0], win);
    return { win, timers, cleared, toasts, refreshes };
  };
  const now = Date.parse(DAY + 'T09:30:00Z');
  let c = make(now);
  c.win.bellRemind_({ nextRepeatAt: DAY + 'T12:00:00.000Z' });
  assert.equal(c.timers.length, 1);
  assert.equal(c.timers[0].ms, Date.parse(DAY + 'T12:00:00.000Z') - now + 45000, 'the mark, plus a spread of up to 90 seconds (here the middle)');
  c.win.bellRemind_({ nextRepeatAt: DAY + 'T12:00:00.000Z' });
  assert.equal(c.cleared.length, 1, 'a second look at the answer replaces the first timer: never two');
  for (const none of [{}, { nextRepeatAt: null }, { nextRepeatAt: 'x' }, null, undefined]) { c = make(now); c.win.bellRemind_(none); assert.equal(c.timers.length, 0, JSON.stringify(none)); }
  c = make(now); c.win.bellRemind_({ nextRepeatAt: DAY + 'T09:29:00.000Z' }); assert.equal(c.timers[0].ms, 5000, 'a mark already behind: five seconds, not an immediate loop');
  c = make(now); c.win.bellRemind_({ nextRepeatAt: '2026-11-26T09:30:00.000Z' }); assert.equal(c.timers.length, 0, 'a mark a day away is a clock that is out: the next foreground asks instead');
  // when it fires: it asks the bell again, and says so only when a promise reminder is unread
  c = make(now); c.win.bellRemind_({ nextRepeatAt: DAY + 'T12:00:00.000Z' });
  c.win.__answer = { items: [{ kind: 'promise', unseen: true, repeat: 1 }, { kind: 'promise', unseen: true, repeat: 2 }, { kind: 'promise', unseen: true, repeat: 0 }, { kind: 'complaint', unseen: true }] };
  return c.timers[0].f(), Promise.resolve().then(() => Promise.resolve()).then(() => {
    assert.equal(c.refreshes.length, 1); assert.equal(c.toasts.length, 1); assert.match(c.toasts[0], /^2 ahadi za leo bado hazijafuatiliwa \(kumbusho\) \/ 2 of today's promises not followed up yet \(reminder\)$/);
    const h = make(now, true); h.win.bellRemind_({ nextRepeatAt: DAY + 'T12:00:00.000Z' }); h.timers[0].f(); assert.equal(h.refreshes.length, 0, 'a hidden page asks nothing');
    const q = make(now); q.win.bellRemind_({ nextRepeatAt: DAY + 'T12:00:00.000Z' }); q.win.__answer = { items: [{ kind: 'complaint', unseen: true }] };
    return q.timers[0].f(), Promise.resolve().then(() => Promise.resolve()).then(() => assert.equal(q.toasts.length, 0, 'no promise reminder, no toast'));
  });
});

test('THE PAGE WIRES THE CLOCK TO THE BELL AND TO NOTHING ELSE: bellRefresh hands its answer to the clock, there is no interval, and CALL_BUILD moved so every handset reloads the page', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/call.html'), 'utf8');
  const bellRefresh = /function bellRefresh\(\)\{[\s\S]*?\n\}\n/.exec(html)[0];
  assert.ok(/bellRemind_\(d\);\s*\n\s*return d;/.test(bellRefresh), 'the answer goes to the clock');
  const region = html.slice(html.indexOf('var BELL_TIMER = null;'), html.indexOf('function bellOpen()'));
  assert.ok(!/setInterval/.test(region), 'no interval: one look at the mark the server names, then the next');
  assert.match(html, /var CALL_BUILD = '2026-11-25-b';/);
});

test('NOTHING NEW ON THE UPLOAD, AND THE PHONE\'S TICK IS ONE DEFINITION: api/upload.js does not know the check, and the list and the bell both ask calledHit_', () => {
  const core = fs.readFileSync(path.join(ROOT, 'api/_lib/call-core.js'), 'utf8');
  assert.ok(!/promiseSkipsToday|PROMISE_REPEAT|promiseSlot/.test(fs.readFileSync(path.join(ROOT, 'api/upload.js'), 'utf8')), 'the upload knows nothing of it');
  assert.equal((core.match(/called\[pnorm\(a\)\] \|\| called\[pnorm\(b\)\]/g) || []).length, 1, 'the tick is written once');
  assert.ok(/const hit = \(a, b\) => calledHit_\(called, a, b\);/.test(core), 'the list asks the one definition');
  assert.ok(/calledHit_\(called, r\.contact, r\.guarantor_contact\)/.test(core), 'the bell asks the same one');
});
