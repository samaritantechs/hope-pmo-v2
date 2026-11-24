// REACHED MEANS SPOKEN TO (23 Nov 2026, handbook Part 137; db/RUN-ME-088).
//   "At calls slide in presentation "REACHED %" Should be percentage of connected calls against calls not just dialled b/se some ring
//    but dont get connected" -- the owner.
// A phone has no word for "it rang and nobody took it", so every dial that was not MISSED, REJECTED or BLOCKED used to count as reached.
// One definition now (outcomeOf, call-core.js): a dial is CONNECTED only when it lasted LONGER than the setting "Minimum seconds to
// count a call"; a number is reached on a day when one of its dials was. Held here: the rule, every screen that shows it (Ripoti and
// the Calls tab, the phone's report, the phone's own day, the Presentation's call boards) in the three states a database can be in
// (the file run; the two functions as they stood before it, where Reached is NOT shown; no function at all), the pages, and the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fakeDb } from './fake-db.mjs';
import { CALL_REPORT_RPC, CALL_REPORT_OLD_RPC, CALL_BOARD_RPC, CALL_BOARD_OLD_RPC, callMinSecsSql } from './snapshot-totals-rpc.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { callApi, reportCoreForPortal, callRollupRows, callTotals, boardRowsFromLogs, outcomeOf, callMinSecsOf, reachOf_, reachMark,
  REACH_NOTE, NO_ANSWER, CALL_MIN_SECS_DEFAULT, callRuleTxt } = await import('../api/_lib/call-core.js');
const { portalApi } = await import('../api/_lib/portal-core.js');

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOW = Date.parse('2026-07-24T09:00:00Z');                    // Friday noon EAT
const TODAY = '2026-07-24';
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] };

/* ONE OFFICER'S MORNING, the way the owner described it: some ring and are not taken.
     ...01  spoken to for 40 s                                  reached
     ...02  rang out (0 s)                                      not
     ...03  taken and dropped at 3 s                            not
     ...04  rang out, dialled again and spoken to for 25 s      reached (one number, two dials)
     ...05  exactly the minimum, 5 s                            not ("longer than")
     ...06  two dials of 2 s and 4 s: six seconds together      not (no single call was a conversation)
     ...07  60 s but the phone itself says MISSED               not (Android's own word stands)
   Seven numbers rung, nine dials, two reached. By the rule as it was: six of seven. BEN, on another team, has one number, spoken to
   for 6 s off the book. */
const L = (id, uid, officer, team, tail, dur, extra = {}) => ({ id, user_id: uid, officer, team, phone: '07000000' + tail, call_date: TODAY,
  duration: dur, portfolio: true, category: 'EXPECTED', outcome: 'CONNECTED', ref: 'R' + tail, ...extra });
const calls = () => [
  L('c01', 'u1', 'ASHA K', 'KONGOWE', '01', 40), L('c02', 'u1', 'ASHA K', 'KONGOWE', '02', 0), L('c03', 'u1', 'ASHA K', 'KONGOWE', '03', 3),
  L('c04', 'u1', 'ASHA K', 'KONGOWE', '04', 0), L('c05', 'u1', 'ASHA K', 'KONGOWE', '04', 25), L('c06', 'u1', 'ASHA K', 'KONGOWE', '05', 5),
  L('c07', 'u1', 'ASHA K', 'KONGOWE', '06', 2), L('c08', 'u1', 'ASHA K', 'KONGOWE', '06', 4),
  L('c09', 'u1', 'ASHA K', 'KONGOWE', '07', 60, { outcome: 'MISSED' }),
  L('c10', 'u2', 'BEN M', 'MBAGALA', '08', 6, { portfolio: false, category: null, ref: '' }),
];
const tables = (minSetting) => ({
  teams: [{ team: 'KONGOWE', team_code: 'KON1' }, { team: 'MBAGALA', team_code: 'MBA1' }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }].concat(minSetting === undefined ? [] : [{ key: 'CALL_MIN_SECS', value: minSetting }]),
  call_users: [
    { user_id: 'u1', name: 'ASHA K', team: 'KONGOWE', phone: '0711000001', role: 'OFFICER', active: true, device_id: 'd1', is_leader: false },
    { user_id: 'u2', name: 'BEN M', team: 'MBAGALA', phone: '0711000002', role: 'OFFICER', active: true, device_id: 'd2', is_leader: false },
    { user_id: 'u9', name: 'LEAD L', team: null, phone: '0711000009', role: 'MANAGEMENT', active: true, device_id: 'dL', is_leader: true, leader_teams: ['ALL'] },
  ],
  call_logs: calls(),
});
/* Counts what a screen asks: reads of call_logs, reads of settings and how (which keys), the rpcs. */
function watch(db) {
  const log = { logs: 0, settingEq: [], settingIn: [], rpcs: [] };
  const from = db.from.bind(db), rpc = db.rpc.bind(db);
  db.from = name => {
    const q = from(name);
    if (name === 'call_logs') log.logs++;
    if (name === 'settings') {
      const eq = q.eq.bind(q), inn = q.in.bind(q);
      q.eq = (c, v) => { log.settingEq.push(v); return eq(c, v); };
      q.in = (c, list) => { log.settingIn.push(list); return inn(c, list); };
    }
    return q;
  };
  db.rpc = (name, args) => { log.rpcs.push(name); return rpc(name, args); };
  return log;
}
const NEW = { rpc: { ...CALL_REPORT_RPC, ...CALL_BOARD_RPC } };     // db/RUN-ME-088 run
const OLD = { rpc: { ...CALL_REPORT_OLD_RPC, ...CALL_BOARD_OLD_RPC } };  // the two functions as they stood before it
const ROWS = {};                                                    // no function at all: the row roads

test('the rule: a dial is CONNECTED only when it lasted longer than the minimum; MISSED, REJECTED and BLOCKED stay the phone\'s own words', () => {
  const o = (outcome, duration, min = 5) => outcomeOf({ outcome, duration }, min);
  assert.equal(o('CONNECTED', 40), 'CONNECTED');
  assert.equal(o('CONNECTED', 6), 'CONNECTED', 'one second over the minimum is a conversation');
  assert.equal(o('CONNECTED', 5), NO_ANSWER, 'exactly the minimum is not: "longer than", the rule that ticks a customer Amepigiwa leo');
  assert.equal(o('CONNECTED', 0), NO_ANSWER, 'it rang out');
  assert.equal(o(null, 0), NO_ANSWER, 'no outcome filed and no length: an attempt');
  assert.equal(o(' connected ', '7'), 'CONNECTED', 'the cell is read without regard to case or blanks, the length as a number');
  assert.equal(o('CONNECTED', null), NO_ANSWER);
  assert.equal(o('MISSED', 60), 'MISSED', 'a call the phone says nobody took is never a conversation, whatever length it carries');
  assert.equal(o('rejected', 60), 'REJECTED');
  assert.equal(o('BLOCKED', 0), 'BLOCKED');
  assert.equal(o('CONNECTED', 1, 0), 'CONNECTED', 'a minimum of nought: any call with a length');
  assert.equal(o('CONNECTED', 0, 0), NO_ANSWER, 'and still not one with none');
  assert.equal(o('CONNECTED', 0, -Infinity), 'CONNECTED', 'no minimum at all is the rule as it was: every dial not missed');
  assert.equal(NO_ANSWER, 'NO ANSWER', 'the word the boards and the database function print');
});

test('the setting is read in ONE way in JavaScript, and the database\'s reading of the same cell is the same number', () => {
  const cases = [[null, 5], [undefined, 5], ['', 5], ['5', 5], ['0', 0], ['10', 10], [' 7s', 7], ['abc', 5], ['3.5', 35], ['-4', 4], ['007', 7],
    ['2000000000', 2000000000], ['2000000001', 2000000000], ['9'.repeat(40), 2000000000], ['9'.repeat(400), 2000000000], ['sekunde 8', 8]];
  for (const [v, want] of cases) {
    assert.equal(callMinSecsOf(v), want, 'JavaScript reads ' + JSON.stringify(String(v).slice(0, 20)) + ' as ' + want);
    const store = { settings: { rows: v === undefined ? [] : [{ key: 'CALL_MIN_SECS', value: v }] } };
    assert.equal(callMinSecsSql(store), want, 'and the database function\'s transcription reads the same');
  }
  assert.equal(CALL_MIN_SECS_DEFAULT, 5);
});

test('a number is reached when ONE of its dials was a conversation: redials are one number, short dials do not add up', () => {
  const t = callTotals(callRollupRows(calls().filter(c => c.user_id === 'u1'), undefined, 5));
  assert.deepEqual([t.dials, t.calls, t.connected], [9, 7, 2], 'nine dials, seven numbers, two reached (the 40 s one and the one rung out then spoken to)');
  const was = callTotals(callRollupRows(calls().filter(c => c.user_id === 'u1'), undefined, -Infinity));
  assert.deepEqual([was.dials, was.calls, was.connected], [9, 7, 6], 'by the rule as it was: six of seven, the near-hundred figure');
  assert.equal(callTotals(callRollupRows(calls().filter(c => c.user_id === 'u1'), undefined, 30)).connected, 1, 'the setting moves it: over thirty seconds, one');
  assert.equal(callTotals(callRollupRows(calls().filter(c => c.user_id === 'u1'), undefined, 0)).connected, 5, 'over nought: every number that was taken at all');
  const d = callRollupRows(calls(), undefined, 5).filter(r => r.kind === 'd');
  assert.ok(d.length && d.every(r => r.outcome === reachMark(5)), 'every number row says which minimum its reached numbers were counted by');
  assert.deepEqual(reachOf_(callRollupRows(calls(), undefined, 7)), { known: true, min: 7 });
  assert.deepEqual(reachOf_([{ kind: 'g' }, { kind: 'u' }]), { known: true, min: null }, 'a window with no number row has nothing to show, and is known');
  assert.deepEqual(reachOf_([{ kind: 'd', outcome: 'MIN:5' }, { kind: 'd', outcome: null }]), { known: false, min: null }, 'one unmarked number row and the figure is not shown');
  assert.equal(boardRowsFromLogs(calls(), TODAY, TODAY, 5).find(r => r.name === 'ASHA K').connected, 2, 'the boards\' rows by the same rule');
});

const reportFigures = d => ({ totals: d.totals, users: d.users.map(u => [u.name, u.calls, u.dials, u.connected, u.connectRatio]),
  byCategory: d.byCategory.map(c => [c.category, c.calls, c.connected, c.connectRatio]), byOutcome: d.byOutcome.map(o => [o.outcome, o.dials]) });

test('Ripoti and the Calls tab: with db/RUN-ME-088 run, Reached is the numbers spoken to, the outcomes say NO ANSWER, and the screen says the rule', async () => {
  const db = fakeDb(tables('5'), NEW), log = watch(db);
  const d = await reportCoreForPortal(db, ADMIN, { from: TODAY, to: TODAY }, NOW);
  assert.deepEqual([d.totals.calls, d.totals.dials, d.totals.connected], [8, 10, 3], 'eight numbers, ten dials, three reached (it was seven of eight)');
  const asha = d.users.find(u => u.name === 'ASHA K');
  assert.deepEqual([asha.calls, asha.connected], [7, 2]);
  assert.ok(Math.abs(asha.connectRatio - 2 / 7) < 1e-9, 'Reached % is reached numbers over numbers rung: 28.6%, not 85.7%');
  assert.deepEqual(d.byOutcome.map(o => [o.outcome, o.dials]), [['CONNECTED', 3], [NO_ANSWER, 6], ['MISSED', 1]], 'the dials by what became of them, NO ANSWER second');
  assert.deepEqual(d.byCategory.map(c => [c.category, c.connected]), [['EXPECTED', 2], ['OTHER', 1]]);
  assert.equal(d.reachKnown, true); assert.equal(d.reachMin, 5);
  assert.match(d.rule, /Reached = a number spoken to for longer than 5 seconds; a dial that only rang, or ended within them, is NO ANSWER\./);
  assert.equal(d.ruleNote, undefined, 'nothing is waiting on the database');
  assert.equal(log.logs, 0, 'the call rows are not read: the database counted');
  assert.deepEqual(log.settingEq.filter(k => k === 'CALL_MIN_SECS'), [], 'and the app does not read the setting: the function reads its own cell');
});

test('Ripoti and the Calls tab: the setting "Minimum seconds to count a call" decides, in the database and on the row road alike', async () => {
  for (const [setting, want] of [[undefined, 3], ['5', 3], ['30', 1], ['0', 6], ['24', 2], ['25', 1]]) {
    for (const [name, opts] of [['the database', NEW], ['the rows', ROWS]]) {
      const d = await reportCoreForPortal(fakeDb(tables(setting), opts), ADMIN, { from: TODAY, to: TODAY }, NOW);
      assert.equal(d.totals.connected, want, name + ', minimum ' + JSON.stringify(setting) + ': reached ' + want);
      assert.equal(d.reachMin, callMinSecsOf(setting));
    }
  }
});

test('Ripoti and the Calls tab: the row road (no database function) counts by the same rule and reads the setting once', async () => {
  const viaDb = await reportCoreForPortal(fakeDb(tables('5'), NEW), ADMIN, { from: TODAY, to: TODAY }, NOW);
  const db = fakeDb(tables('5'), ROWS), log = watch(db);
  const rows = await reportCoreForPortal(db, ADMIN, { from: TODAY, to: TODAY }, NOW);
  assert.deepEqual(reportFigures(rows), reportFigures(viaDb), 'the two roads cannot disagree about who was reached');
  assert.equal(rows.rule, viaDb.rule);
  assert.deepEqual(log.settingEq.filter(k => k === 'CALL_MIN_SECS'), ['CALL_MIN_SECS'], 'one read of the one cell, made only on this road');
});

test('Ripoti and the Calls tab: on a database where db/RUN-ME-088 has not been run, Reached is NOT shown (null), the file is named, and the call rows are not read', async () => {
  const known = await reportCoreForPortal(fakeDb(tables('5'), NEW), ADMIN, { from: TODAY, to: TODAY }, NOW);
  const db = fakeDb(tables('5'), OLD), log = watch(db);
  const d = await reportCoreForPortal(db, ADMIN, { from: TODAY, to: TODAY }, NOW);
  assert.equal(d.totals.connected, null, 'not the old seven of eight, and not a nought');
  assert.ok(d.users.filter(u => u.calls).every(u => u.connected === null && u.connectRatio === null), 'no officer carries a reached figure');
  assert.ok(d.byCategory.every(c => c.connected === null && c.connectRatio === null));
  assert.equal(d.reachKnown, false); assert.equal(d.reachMin, null);
  assert.equal(d.ruleNote, REACH_NOTE, 'the red line the screens already print says why');
  assert.match(REACH_NOTE, /db\/RUN-ME-088-reached-is-a-conversation\.sql/);
  assert.match(REACH_NOTE, /Reached and Reached % are not shown/);
  assert.ok(!/Reached = a number spoken to/.test(d.rule), 'the rule line does not claim a minimum the figures were not counted by');
  for (const k of ['calls', 'dials', 'duration', 'otherDuration', 'portfolio', 'nonPortfolio']) assert.equal(d.totals[k], known.totals[k], k + ' is the figure it always was');
  assert.deepEqual(d.users.map(u => [u.name, u.calls, u.dials, u.duration]), known.users.map(u => [u.name, u.calls, u.dials, u.duration]));
  assert.equal(log.logs, 0, 'the heavy read of the call rows is NOT made to work the figure out');
  assert.deepEqual(log.settingEq.filter(k => k === 'CALL_MIN_SECS'), [], 'and nothing more is read');
  // one person's report: the totals are added up again from the officers, and stay "not known"
  const one = await reportCoreForPortal(fakeDb(tables('5'), OLD), ADMIN, { from: TODAY, to: TODAY, user: 'ASHA K' }, NOW);
  assert.equal(one.totals.connected, null, 'added up again for one person\'s teams, it is still not a nought');
  assert.equal(one.totals.calls, 7);
});

test('the phone: a leader\'s report shows the same figures, and nothing when the database is behind', async () => {
  const d = await callApi(fakeDb(tables('5'), NEW), 'api_callReport', ['dL', TODAY, TODAY, '', ''], NOW);
  assert.equal(d.ok, true);
  assert.deepEqual([d.totals.calls, d.totals.connected, d.reachKnown], [8, 3, true]);
  assert.match(d.rule, /longer than 5 seconds/);
  const old = await callApi(fakeDb(tables('5'), OLD), 'api_callReport', ['dL', TODAY, TODAY, '', ''], NOW);
  assert.deepEqual([old.totals.calls, old.totals.connected, old.reachKnown, old.ruleNote], [8, null, false, REACH_NOTE]);
});

test('the phone: an officer\'s own day counts reached by the same rule, and the minimum rides the settings read the boot already makes', async () => {
  const db = fakeDb(tables('5'), NEW), log = watch(db);
  const b = await callApi(db, 'api_callBoot', ['d1'], NOW);
  assert.equal(b.ok, true);
  assert.deepEqual([b.today.dials, b.today.calls, b.today.connected], [9, 7, 2]);
  assert.ok(log.settingIn.some(list => list.includes('CALL_MIN_SECS')), 'it is one more key of the boot\'s one settings query');
  assert.deepEqual(log.settingEq.filter(k => k === 'CALL_MIN_SECS'), [], 'never a read of its own on the path every handset opens');
  assert.equal((await callApi(fakeDb(tables('30'), NEW), 'api_callBoot', ['d1'], NOW)).today.connected, 1);
  assert.equal((await callApi(fakeDb(tables(undefined), NEW), 'api_callBoot', ['d1'], NOW)).today.connected, 2, 'no setting is five seconds');
});

const boardsOf = (db, user = ADMIN, at = NOW) => portalApi(db, user, 'officerBoards', {}, at);
const line = (b, who, list = 'callToday') => b[list].find(r => r.agent === who);

test('the Presentation\'s call boards: with db/RUN-ME-088 run, Reached % is the numbers spoken to out of the numbers rung, and the slide is told the minimum', async () => {
  const db = fakeDb(tables('5'), NEW), log = watch(db);
  const b = await boardsOf(db);
  const asha = line(b, 'ASHA K');
  assert.deepEqual([asha.calls, asha.dials, asha.connected, asha.connectPct], [7, 9, 2, 28.6], 'two of seven: 28.6%, where it read 85.7%');
  assert.deepEqual([line(b, 'BEN M').connected, line(b, 'BEN M').connectPct], [1, 100]);
  assert.equal(line(b, 'ASHA K', 'callWeek').connectPct, 28.6, 'the week\'s board too');
  assert.equal(b.callsReachMin, 5); assert.equal(b.callsReachNote, undefined);
  assert.equal(log.logs, 0, 'the week\'s call rows are not read');
  const b30 = await boardsOf(fakeDb(tables('30'), NEW));
  assert.deepEqual([line(b30, 'ASHA K').connected, line(b30, 'ASHA K').connectPct, b30.callsReachMin], [1, 14.3, 30], 'the setting decides');
});

test('the Presentation\'s call boards: the row road counts by the same rule', async () => {
  const viaDb = await boardsOf(fakeDb(tables('5'), NEW));
  const db = fakeDb(tables('5'), ROWS), log = watch(db);
  const rows = await boardsOf(db);
  assert.deepEqual(rows.callToday, viaDb.callToday); assert.deepEqual(rows.callWeek, viaDb.callWeek);
  assert.equal(rows.callsReachMin, 5);
  assert.ok(log.logs > 0, 'this is the road that reads the rows');
  const none = await boardsOf(fakeDb(tables(undefined), ROWS));
  assert.deepEqual([line(none, 'ASHA K').connected, none.callsReachMin], [2, 5], 'no setting is five seconds');
  const r30 = await boardsOf(fakeDb(tables('30'), ROWS));
  assert.deepEqual([line(r30, 'ASHA K').connected, line(r30, 'ASHA K').connectPct, r30.callsReachMin], [1, 14.3, 30], 'the setting decides on this road too: it counts by the minimum it says');
});

test('the Presentation\'s call boards: on a database where db/RUN-ME-088 has not been run, Reached % is NOT shown, the file is named, and the week\'s rows are not read', async () => {
  const known = await boardsOf(fakeDb(tables('5'), NEW));
  const db = fakeDb(tables('5'), OLD), log = watch(db);
  const b = await boardsOf(db);
  for (const list of ['callToday', 'callWeek', 'callWeekWorst']) {
    assert.ok(b[list].length > 0);
    assert.ok(b[list].every(r => r.connected === null && r.connectPct === null), list + ': no line carries a reached figure, not the old one and not a nought');
    assert.deepEqual(b[list].map(r => [r.agent, r.calls, r.dials, r.duration, r.portfolio, r.portfolioPct]), known[list].map(r => [r.agent, r.calls, r.dials, r.duration, r.portfolio, r.portfolioPct]),
      list + ': every other figure is the one it always was');
  }
  assert.equal(b.callsReachNote, REACH_NOTE); assert.equal(b.callsReachMin, undefined);
  assert.equal(log.logs, 0, 'the heavy read of the week is NOT made to work the figure out');
});

test('the Presentation\'s call boards: a viewer who holds no team is told nothing is waiting, and the last good board that stands in keeps its minimum', async () => {
  const nobody = await boardsOf(fakeDb(tables('5'), OLD), { code: 'N', name: 'NO TEAMS', role: 'GMO', teams: [], tabs: ['dashboard', 'present'] });
  assert.equal(nobody.callsReachNote, undefined, 'nobody\'s calls are shown, so nothing is "waiting"');
  assert.equal(nobody.callsReachMin, undefined);
  // a good answer, then the database briefly unreachable: the board that stands in is the same one, with its minimum
  const db = fakeDb(tables('5'), NEW), real = db.rpc.bind(db), state = { fail: false };
  db.rpc = (name, args) => (name === 'call_board_rollup' && state.fail
    ? Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) : real(name, args));
  const quiet = console.warn, realNow = Date.now, t0 = realNow.call(Date); console.warn = () => {};
  try {
    const good = await boardsOf(db);
    state.fail = true;
    Date.now = () => t0 + 125 * 1000;                                            // past the screen's one-minute answer, inside the ten minutes
    const stale = await boardsOf(db, ADMIN, NOW + 125 * 1000);
    assert.equal(typeof stale.callsStaleS, 'number', 'the older answer stands in');
    assert.deepEqual(stale.callToday, good.callToday);
    assert.equal(stale.callsReachMin, 5, 'and it is still known which minimum it was counted by');
    assert.equal(stale.callsReachNote, undefined);
  } finally { console.warn = quiet; Date.now = realNow; }
});

/* ---- the pages ---- */
const APP = read('public/app.html'), REPORTS = read('public/mod/reports.js'), PRESENT = read('public/mod/present.js'), CALL = read('public/call.html');
const totalsFns = () => {
  const src = APP.slice(APP.indexOf('function sumRow(rows, fields){'), APP.indexOf('var BOARDS = {};'));
  return new Function(src + '\nreturn { sumRow: sumRow, autoTotals: autoTotals, fillPctTotals: fillPctTotals };')();
};

test('the portal\'s totals: a figure that is "not known" on every row totals to blank, never to a nought; a field a board does not carry adds up as it always did', () => {
  const { sumRow, autoTotals, fillPctTotals } = totalsFns();
  const unknown = [{ category: 'EXPECTED', calls: 7, connected: null, connectPct: null }, { category: 'OTHER', calls: 1, connected: null, connectPct: null }];
  assert.deepEqual(sumRow(unknown, ['calls', 'connected']), { calls: 8, connected: null });
  const cols = [{ key: 'category' }, { key: 'calls', kind: 'num' }, { key: 'connected', kind: 'num' }, { key: 'connectPct', kind: 'pct' }];
  const t = autoTotals(unknown, cols);
  assert.equal(t.calls, 8); assert.equal(t.connected, null);
  assert.ok(t.connectPct === undefined || t.connectPct === null || t.connectPct === '', 'no Reached % is made up from parts that are not known: ' + JSON.stringify(t.connectPct));
  const known = [{ calls: 7, connected: 2, connectPct: 28.6 }, { calls: 1, connected: 1, connectPct: 100 }];
  assert.deepEqual(sumRow(known, ['calls', 'connected']), { calls: 8, connected: 3 });
  assert.equal(autoTotals(known, cols).connectPct, 37.5, 'three of eight, from the totals');
  const mixed = [{ calls: 7, connected: null }, { calls: 1, connected: 1 }];
  assert.equal(sumRow(mixed, ['connected']).connected, 1, 'only "not known on EVERY row" is read this way');
  assert.deepEqual(sumRow([{ calls: 2 }, { calls: 3 }], ['calls', 'connected']), { calls: 5, connected: 0 }, 'a field the rows do not carry at all (undefined) still adds up to nought, as before');
  const t2 = {}; fillPctTotals(t2, [{ calls: 2 }, { calls: 3 }], [{ key: 'connectPct', kind: 'pct' }]);
  assert.equal(t2.connectPct, 0, 'and its percentage is worked out as before');
  assert.deepEqual(sumRow([], ['connected']), { connected: 0 }, 'an empty board is a nought, not "not known"');
});

test('the pages print a dash or a blank for a reached figure that is not known, and say what Reached means', () => {
  // Ripoti and the Calls tab
  assert.match(REPORTS, /\(t\.connected == null \? kpi\('Reached', '\\u2014', 'inasubiri \/ waits for db\/RUN-ME-088'\)\n\s+: kpi\('Reached', money\(t\.connected\), t\.calls \? Math\.round\(100\*t\.connected\/t\.calls\)\+'% of numbers' : ''\)\)/);
  assert.equal((REPORTS.match(/get:function\(r\)\{ return r\.connectRatio == null \? null : Math\.round\(\(r\.connectRatio\|\|0\)\*1000\)\/10; \}/g) || []).length, 2, 'both Reached % columns print nothing for "not known"');
  assert.ok(!/get:function\(r\)\{ return Math\.round\(\(r\.connectRatio\|\|0\)/.test(REPORTS), 'no column turns "not known" into 0%');
  assert.match(REPORTS, /\(d\.ruleNote \? '<div class="note bad">' \+ esc\(d\.ruleNote\) \+ '<\/div>' : ''\)/, 'the red line that names the file is printed');
  assert.match(REPORTS, /CONNECTED was spoken on, NO ANSWER only rang or ended at once/, 'the outcome board says what its two words mean');
  // the Presentation
  assert.match(PRESENT, /\(b\.callsReachNote \? ' · Reached % inasubiri \/ waits for db\/RUN-ME-088'\n\s+: b\.callsReachMin != null \? ' · Reached = waliongea zaidi ya sek ' \+ b\.callsReachMin \+ ' \/ spoken to for over ' \+ b\.callsReachMin \+ ' s' : ''\)/);
  assert.match(PRESENT, /col\('connectPct','Reached %','pct'\)/);
  assert.match(APP, /function cellText\(r, c\)\{\n  var v = r\[c\.key\];\n  if \(c\.get\) v = c\.get\(r\);\n  if \(v==null \|\| v===''\) return '';/, 'a null cell is printed as nothing, on every table');
  // the phone
  assert.match(CALL, /\(t\.connected == null \? '\\u2014'\n\s+: money\(t\.connected\) \+ \(t\.calls \? ' <span style="color:var\(--soft\);font-size:12px">' \+ pct\(t\.connected \/ t\.calls\) \+ '<\/span>' : ''\)\)/);
  assert.match(CALL, /if \(d\.reachKnown === false\) t\.connected = null;/, 'one role\'s figure, added up on the phone, stays "not known" too');
  assert.match(CALL, /\(c\.connectRatio == null \? '' : ' \\u00B7 ' \+ pct\(c\.connectRatio\) \+ ' walipatikana'\)/);
  assert.match(CALL, /\(d\.ruleNote \? '<div class="hint" style="color:var\(--bad\);font-size:11px;margin-bottom:8px">' \+ esc\(d\.ruleNote\) \+ '<\/div>' : ''\)/);
});

/* ---- one definition, and the file ---- */
const jsCode = text => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const CORE = jsCode(read('api/_lib/call-core.js')), PORTAL = jsCode(read('api/_lib/portal-core.js'));

test('one definition: every rollup is given the minimum, the outcome is decided in one place, and the portal keeps no second copy', () => {
  const uses = CORE.match(/callRollupRows\([^\n]*/g) || [];
  assert.equal(uses.length, 4, 'the definition and its three callers: ' + uses.length);
  assert.match(CORE, /export function callRollupRows\(logs, keyOf = r => r\.user_id, min = CALL_MIN_SECS_DEFAULT\) \{/);
  assert.match(CORE, /today: callTotals\(callRollupRows\(logs, \(\) => cu\.user_id, callMinSecsOf\(setting\('CALL_MIN_SECS'\)\)\)\),/, 'the phone\'s own day');
  assert.match(CORE, /for \(const r of callRollupRows\(inRange, nameOf, min\)\) \{/, 'the boards\' rows');
  assert.match(CORE, /legacyRollup_\(rollup \|\| callRollupRows\(logs, undefined, rowMin\)\);/, 'the report\'s row road');
  assert.equal((CORE.match(/outcomeOf\(/g) || []).length, 1, 'the outcome is decided where the rollup is built, and nowhere else');
  assert.match(CORE, /\? o : \(num\(r\.duration\) > min \? 'CONNECTED' : NO_ANSWER\);/, 'longer than the minimum, never "at least"');
  assert.equal((CORE.match(/replace\(\/\[\^0-9\]\/g, ''\), 10\)/g) || []).filter(Boolean).length >= 1, true);
  assert.match(CORE, /const min = callMinSecsOf\(await settingGet\(db, 'CALL_MIN_SECS'\)\);/, 'the called-today tick reads the setting through the same function');
  assert.match(CORE, /rowMin = await settingGet\(db, 'CALL_MIN_SECS'\)\.then\(callMinSecsOf, \(\) => CALL_MIN_SECS_DEFAULT\);/);
  assert.ok(!/outcomeOf|callRollupRows|NO ANSWER|NO_ANSWER/.test(PORTAL), 'portal-core counts nothing itself');
  assert.match(PORTAL, /connected: reachKnown \? f\.connected : null,/);
  assert.match(PORTAL, /connectPct: reachKnown \? pctOf\(t\.connected, t\.calls\) : null,/);
  assert.match(PORTAL, /\.\.\.\(reachKnown \? \(reach\.min != null \? \{ callsReachMin: reach\.min \} : \{\}\) : \{ callsReachNote: REACH_NOTE \}\),/);
  assert.match(callRuleTxt({ known: true, min: 9 }), /longer than 9 seconds/);
  assert.ok(!/Reached =/.test(callRuleTxt({ known: false, min: null })) && !/Reached =/.test(callRuleTxt({ known: true, min: null })));
});

const F088 = read('db/RUN-ME-088-reached-is-a-conversation.sql');
const sqlCode = text => text.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
const norm = s => s.replace(/\s+/g, ' ').trim();
const SQL = norm(sqlCode(F088));

test('RUN-ME-088 is a block the owner can paste: small, flush-left, plain text, with its END line', () => {
  assert.ok(F088.length < 10000, 'under 10,000 characters: ' + F088.length);
  assert.ok(!F088.split('\n').some(l => /^\s/.test(l)), 'no line starts with a blank');
  assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(F088), 'plain ASCII');
  assert.equal(F088.split('\n').filter(Boolean).pop(), '-- END OF RUN-ME-088');
  assert.ok(!/\b(delete|truncate|alter|insert|update|drop)\b/i.test(sqlCode(F088)), 'it changes no row and no table: three functions, a grant and a select');
});

test('RUN-ME-088 puts the one rule into the two functions in place, reads the setting in one place, and marks every answer', () => {
  assert.match(SQL, /create or replace function call_min_secs\(\) returns integer language sql stable set search_path = public, pg_catalog as \$\$ select least\(coalesce\(nullif\(regexp_replace\(coalesce\(\(select s\.value from public\.settings s where s\.key = 'CALL_MIN_SECS'\), ''\), '\[\^0-9\]', '', 'g'\), ''\)::numeric, 5\), 2000000000\)::integer; \$\$;/,
    'digits only, nothing readable is 5, never above two thousand million: callMinSecsOf, in SQL (coalesce INSIDE least: least() skips an empty value)');
  assert.match(SQL, /create or replace function call_report_rollup\(p_from date, p_to date, p_teams text\[\] default null\) returns table \(kind text, day date, user_id text, team text, category text, outcome text, portfolio boolean, calls bigint, dur bigint, uniq bigint\)/,
    'the report: the same name, arguments and columns as db/RUN-ME-042, so it is replaced in place');
  assert.match(SQL, /create or replace function call_board_rollup\(p_from date, p_to date, p_day date, p_teams text\[\] default null\) returns jsonb/, 'the board: the same as db/RUN-ME-078');
  assert.equal((SQL.match(/m as materialized \(select call_min_secs\(\) as min\),/g) || []).length, 2, 'each function reads the minimum once a call');
  assert.match(SQL, /case when upper\(btrim\(coalesce\(outcome, ''\)\)\) in \('MISSED', 'REJECTED', 'BLOCKED'\) then upper\(btrim\(outcome\)\) when coalesce\(duration, 0\) > m\.min then 'CONNECTED' else 'NO ANSWER' end as outcome/,
    'the report: outcomeOf, clause for clause');
  assert.match(SQL, /select 'd'::text, call_date, user_id, team, category, 'MIN:' \|\| \(select min from m\), portfolio,/, 'every number row says which minimum it was counted by');
  assert.match(SQL, /\(count\(distinct phone\) filter \(where outcome = 'CONNECTED'\)\)::bigint/, 'a number is reached when one of its dials was CONNECTED');
  assert.match(SQL, /not in \('MISSED', 'REJECTED', 'BLOCKED'\) and coalesce\(c\.duration, 0\) > m\.min as connected from public\.call_logs c cross join p cross join m/, 'the board: the same rule');
  assert.match(SQL, /bool_or\(connected\) as connected/);
  assert.match(SQL, /'min', \(select min from m\)\);/, 'the board says which minimum it counted by');
  assert.match(SQL, /revoke execute on function call_board_rollup\(date, date, date, text\[\]\) from public, anon, authenticated; grant execute on function call_board_rollup\(date, date, date, text\[\]\) to service_role;/);
  // everything else of the two bodies is db/RUN-ME-078's and db/RUN-ME-042's, word for word
  const body = (text, name) => { const c = norm(sqlCode(text)); const i = c.indexOf('create or replace function ' + name); return c.slice(i, c.indexOf('$$;', i)); };
  const b78 = body(read('db/RUN-ME-078-call-board-rollup.sql'), 'call_board_rollup'), b88 = body(F088, 'call_board_rollup');
  assert.equal(b88.replace("m as materialized (select call_min_secs() as min), ", '').replace(' and coalesce(c.duration, 0) > m.min as connected', ' as connected')
    .replace(' cross join p cross join m ', ' cross join p ').replace(", 'min', (select min from m));", ');'), b78, 'the board function differs from RUN-ME-078 in the rule and the mark, and in nothing else');
});

test('RUN-ME-088 says what was wrong, what it does, what it costs, the undo and its answer; the stand-in and the kept check hold it', () => {
  assert.match(F088, /"At calls slide in presentation "REACHED %" Should be percentage of connected calls against calls not just dialled b\/se some ring/);
  assert.match(F088, /UNTIL IT IS RUN the screens show a dash for Reached and Reached % and name this file: never the old figure\./);
  assert.match(F088, /WHAT IT COSTS: nothing to \/api\/upload; on \/api\/call nothing is read that was not read/);
  assert.match(F088, /UNDO: run db\/RUN-ME-042 and then db\/RUN-ME-078 again/);
  assert.match(sqlCode(F088), /select 7, 'the calls slide answers with its minimum', coalesce\(call_board_rollup\(current_date, current_date, current_date, null\)->>'min', 'MISSING'\)/);
  const mock = read('test/snapshot-totals-rpc.mjs');
  assert.match(mock, /: \(min == null \|\| dur > min\) \? 'CONNECTED' : 'NO ANSWER';/, 'the report\'s stand-in is the SQL\'s transcription');
  assert.match(mock, /outcome: min == null \? null : 'MIN:' \+ min,/);
  assert.match(mock, /return \{ w: boardRowsFromLogs\(rows, a\.p_from, a\.p_to, min\), t: boardRowsFromLogs\(rows, a\.p_day, a\.p_day, min\), min \};/);
  const check = read('tools/db-checks/reached-rule.mjs');
  assert.match(check, /db\/RUN-ME-088-reached-is-a-conversation\.sql/);
  assert.match(check, /const \{ boardRowsFromLogs, callRollupRows, callMinSecsOf, reachOf_, reachMark, NO_ANSWER \} = await import\('\.\.\/\.\.\/api\/_lib\/call-core\.js'\);/, 'the yardstick is the production definition, imported');
  assert.match(check, /psqlTo\(F042, DB\); psqlTo\(F078, DB\);\n\n\/\* ---- 0\. before the file/, 'the live sequence: the two earlier files first');
  const m = check.match(/const BREAKS = \[([\s\S]*?)\n\];/);
  assert.ok(m && (m[1].match(/^  \[/gm) || []).length >= 21, 'deliberate breaks of the file: ' + (m ? (m[1].match(/^  \[/gm) || []).length : 0));
  // the older check of RUN-ME-078 still holds its own file: its yardstick is the rule with no minimum, which is the rule as it was
  assert.match(read('tools/db-checks/call-board-rollup.mjs'), /boardRowsFromLogs\(rows, from, to, -Infinity\), t: boardRowsFromLogs\(rows, day, day, -Infinity\)/);
});

test('the handbook and CHAT.md record the reached rule, the file and what is not done', () => {
  const h = read('docs/HANDOFF.md'), c = read('CHAT.md');
  assert.match(h, /Part 137/); assert.match(h, /RUN-ME-088/);
  assert.match(c, /RUN-ME-088/); assert.match(c, /Part 137/);
  // Each handset reloaded the call page for the rule: its build is that day's, or a later change's.
  const callBuild = (CALL.match(/var CALL_BUILD = '([^']+)';/) || [])[1] || '';
  assert.ok(callBuild >= '2026-11-23-a', 'CALL_BUILD ' + callBuild);
});
