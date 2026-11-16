// A recycling leader's own list against the report their GMO or OPM reads -- "that manager in their code
// ain't seeing them, they getting just a little like two yet a Manager's gmo sees the manager has many ...
// so make sure the distribution is okay" (the owner, 16 Nov 2026). Clock pinned to Friday 2026-07-24.
//
// What these pin, in order:
//   1. the distribution is ONE rule: for every leader of every role, the list the leader reads with a code
//      that holds their teams is exactly the row the GMO's report shows for them -- count, arrears, recovery;
//   2. where the two differ, the difference is the code's teams, and BOTH screens now say so (the leader's own
//      list and the report's "Off code" mark) -- the rule that the code decides what is seen is not changed;
//   3. one person is one leader whichever way the blanks in their name fall.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');
const { expdfMine } = await import('../api/_lib/expdf.js');
const { callApi, _clearSummaryCache, _clearWidgetCache } = await import('../api/_lib/call-core.js');
const { USER_TABS } = await import('../api/_lib/auth.js');
const { leaderKey, teamsOutsideScope, codeGapOf } = await import('../api/_lib/leader-scope.js');

const NOW = Date.parse('2026-07-24T09:00:00Z');          // a Friday
const TODAY = '2026-07-24';
const TEAMS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

/** Six teams, one GMO over all of them, one manager over all of them (the cell can be made to vary per team),
    a bike officer on the first two. Twenty-four defaulters a team, their days in default and their disbursement
    weekdays spread so the rotation hands every role customers and every weekday has some: a team's eight
    BIKE, eight MANAGER and eight GMO customers, of whom two, two and three are on their cycle day this Friday. */
function book({ managerOf = () => 'MARY M' } = {}) {
  const teams = TEAMS.map(t => ({ team: t, team_code: t + 'CODE', opm: 'OPM O', recovery: null, gmo: 'GINA G', manager: managerOf(t), credit: null,
    expected: null, bike: ['T1', 'T2'].includes(t) ? 'BIKE B' : null }));
  const snaps = [];
  let n = 0;
  for (const t of TEAMS) for (let i = 0; i < 24; i++) {
    n++;
    const base = { ref: 'R' + n, full_name: 'C' + n, contact: '0712' + String(n).padStart(6, '0'), team: t, status: 'Defaulter',
      days_elapsed: 1 + (i % 18), disb_date: '2026-07-' + String(13 + (i % 7)).padStart(2, '0'),       // 13..19 July: Mon..Sun
      ds: '3-6', dc: 3, weekday: 'FRI', snapshot_date: TODAY };
    snaps.push({ ...base, arrears: 1000 + n, snapshot_type: 'initial', upload_batch: 'bi', created_at: TODAY + 'T04:00:00Z' });
    snaps.push({ ...base, arrears: 900 + n, snapshot_type: 'current', upload_batch: 'bc', created_at: TODAY + 'T08:00:00Z' });
  }
  return { teams, snaps };
}
function tablesFor(b, codes) {
  return { teams: b.teams, access_codes: codes, roles: [], settings: [], repayment_snapshots: [], defaulter_snapshots: b.snaps,
    followup_status: [], followup_comments: [], call_users: [], call_logs: [], loans: [], received_payments: [] };
}
const code = (c, name, role, teams) => ({ code: c, name, role, teams, tabs: [] });
const asUser = c => ({ code: c.code, name: c.name, role: c.role, teams: c.teams && c.teams.length ? c.teams : null, tabs: USER_TABS.slice() });
const GINA = code('G', 'GINA G', 'GMO', TEAMS);
const report = async (db, user = asUser(GINA), args = {}) => portalApi(db, user, 'expdfReport', { period: 'day', ...args }, NOW);
const sectionRows = (d, role) => d.sections.find(s => s.role === role).rows;

test('the names and the teams are compared the way every register of names is', () => {
  assert.equal(leaderKey('  Mary   M '), 'MARY M');
  assert.equal(leaderKey(null), '');
  assert.equal(leaderKey('MARY M'), leaderKey('MARY  M'), 'a double blank inside a name is not another person');
  assert.notEqual(leaderKey('MARY M'), leaderKey('MARY MWITA'), 'a different WORD is a different spelling, which only a person can settle');

  const rows = [{ team: 'T1', manager: 'MARY M' }, { team: 'T2', manager: 'Mary  M' }, { team: 'T3', gmo: 'MARY M' }, { team: 'T4', bike: 'MARY M' },
    { team: 'T5', manager: 'SOMEONE ELSE' }, { team: 'T6', manager: '-' }, { team: 'Tunduru', manager: 'MARY M' }];
  const mary = { name: 'MARY M', teams: ['T1'] };
  assert.deepEqual(teamsOutsideScope(mary, rows), ['T2', 'T3', 'T4', 'Tunduru'], 'every team naming her as GMO, MANAGER or BIKE that her code does not hold');
  assert.deepEqual(teamsOutsideScope({ name: 'MARY M', teams: null }, rows), [], 'a code with every team has nothing outside it');
  assert.deepEqual(teamsOutsideScope({ ...mary, teamCode: true }, rows), [], 'a team code is one team and not a leader of record');
  assert.deepEqual(teamsOutsideScope({ name: 'NOBODY', teams: ['T1'] }, rows), [], 'a name no team carries has no book to lose');
  assert.deepEqual(teamsOutsideScope({ name: 'MARY M', teams: ['t1', ' T2 ', 'T3', 'T4', 'TUNDURU'] }, rows), [], 'held in any case or spacing is held');

  assert.deepEqual(codeGapOf(['T1', 'T2'], ['T1', 'T3', 'T4', 't3']), ['T3', 'T4']);
  assert.deepEqual(codeGapOf(null, ['T1']), [], 'a code with no teams is every team');
  assert.deepEqual(codeGapOf([], ['T1']), []);
  assert.deepEqual(codeGapOf(undefined, ['T1']), [], 'no single code carries the name: nothing can be said, so nothing is');
});

test('THE DISTRIBUTION IS ONE RULE: every leader, with a code that holds their teams, reads exactly the row their GMO reads', async () => {
  /* The check the complaint asks for. For each leader of each role on the report, the list that leader reads on
     the phone and on the portal -- with a code that holds the teams the sheet names them on -- is the same
     customers, the same arrears and the same recovery as the report's own row for them. If this ever fails, the
     two reads have grown two definitions of whose customer this is. */
  const b = book();
  const codes = [GINA, code('M', 'MARY M', 'MANAGER', TEAMS), code('B', 'BIKE B', 'BIKE', ['T1', 'T2'])];
  const db = fakeDb(tablesFor(b, codes));
  const d = await report(db);
  let checked = 0;
  for (const role of ['GMO', 'MANAGER', 'BIKE']) {
    for (const row of sectionRows(d, role)) {
      if (row.leader === '(unassigned)') continue;       // the bike customers of the four teams that name no bike officer: nobody's list
      const c = codes.find(x => leaderKey(x.name) === leaderKey(row.leader));
      assert.ok(c, role + ' ' + row.leader + ' has a code in this fixture');
      const phone = await expdfMine(fakeDb(tablesFor(b, codes)), { name: c.name, teams: c.teams, leader: true }, {}, NOW);
      assert.equal(phone.rows.length, row.customers, role + ' ' + row.leader + ': the phone list is the report row');
      assert.equal(phone.totals.arrears, row.arrears, role + ' ' + row.leader + ': arrears');
      assert.equal(phone.totals.recovered, row.recovered, role + ' ' + row.leader + ': recovered');
      assert.deepEqual(phone.outside, [], role + ' ' + row.leader + ': nothing is outside their code, so nothing is said');
      assert.equal(row.offCode, undefined, role + ' ' + row.leader + ': and the report marks nothing');
      checked++;
    }
  }
  assert.equal(checked, 3, 'one GMO, one manager and one bike officer were read');
  assert.equal(sectionRows(d, 'MANAGER')[0].customers, 12, 'the manager\'s share of the day, over six teams: two a team');
  assert.equal(sectionRows(d, 'GMO')[0].customers, 18, 'the GMO\'s: three a team');
  assert.equal(sectionRows(d, 'BIKE').find(r => r.leader === 'BIKE B').customers, 4, 'the bike officer\'s: two a team on two teams');
});

test('the manager whose code holds two of her six teams sees a third of what her GMO sees -- and both screens say why', async () => {
  const b = book();
  const mary = code('M', 'MARY M', 'MANAGER', ['T1', 'T2']);
  const db = fakeDb(tablesFor(b, [GINA, mary]));

  // What the GMO reads.
  const d = await report(db);
  const row = sectionRows(d, 'MANAGER')[0];
  assert.deepEqual([row.leader, row.teams, row.customers], ['MARY M', 6, 12]);
  assert.deepEqual(row.offCode, ['T3', 'T4', 'T5', 'T6'], 'the report marks the four teams her own code cannot see');
  assert.equal(d.sections.find(s => s.role === 'MANAGER').offCode, 1, 'and counts the leaders it says it of');
  assert.equal(d.sections.find(s => s.role === 'GMO').offCode, 0);
  assert.equal(sectionRows(d, 'GMO')[0].offCode, undefined, 'her GMO\'s own code holds the zone: nothing is said of them');

  // What she reads on the portal: the rule is unchanged -- her code decides what she sees -- and the screen says what is missing.
  const own = await portalApi(fakeDb(tablesFor(b, [GINA, mary])), asUser(mary), 'expectedDefaulters', {}, NOW);
  assert.equal(own.iAmLeader, true);
  assert.deepEqual(own.teams, ['T1', 'T2'], 'only her code\'s teams are read: the code decides, the sheet never widens it');
  assert.equal(own.rows.filter(r => leaderKey(r.leader) === 'MARY M').length, 16, 'her whole book in the two teams she can see');
  assert.deepEqual(own.outside, ['T3', 'T4', 'T5', 'T6'], 'and the screen names the four she cannot');

  // And on the phone, with the same code.
  const phone = await expdfMine(fakeDb(tablesFor(b, [GINA, mary])), { name: 'MARY M', teams: ['T1', 'T2'], leader: true }, {}, NOW);
  assert.equal(phone.rows.length, 4, 'today\'s list is a third of the six teams\' 12');
  assert.deepEqual(phone.outside, ['T3', 'T4', 'T5', 'T6']);

  // Give her the teams and every screen agrees.
  const full = code('M', 'MARY M', 'MANAGER', TEAMS);
  const fixed = await portalApi(fakeDb(tablesFor(b, [GINA, full])), asUser(full), 'expectedDefaulters', {}, NOW);
  assert.deepEqual(fixed.outside, []);
  assert.equal(fixed.rows.filter(r => leaderKey(r.leader) === 'MARY M').length, 48);
});

test('the off-code mark is said only where it is true', async () => {
  const b = book();
  const mark = async codes => sectionRows(await report(fakeDb(tablesFor(b, [GINA, ...codes]))), 'MANAGER')[0].offCode;
  assert.deepEqual(await mark([code('M', 'MARY M', 'MANAGER', ['T1'])]), ['T2', 'T3', 'T4', 'T5', 'T6']);
  assert.equal(await mark([code('M', 'MARY M', 'MANAGER', ['t1', ' T2 ', 'T3', 'T4', 'T5', 'T6'])]), undefined, 'teams held in another case or spacing are held');
  assert.equal(await mark([code('M', 'MARY M', 'MANAGER', null)]), undefined, 'a code with no teams is every team');
  assert.equal(await mark([code('M', 'MARY M', 'MANAGER', [])]), undefined);
  assert.equal(await mark([]), undefined, 'a manager who works from a team code has no access code to be short: nothing is said');
  assert.equal(await mark([code('M1', 'MARY M', 'MANAGER', ['T1']), code('M2', 'Mary  M', 'MANAGER', ['T2'])]), undefined,
    'two codes carry the name -- nobody can say which is hers, so nothing is said');
  assert.deepEqual(await mark([code('M', 'MARY  M', 'MANAGER', ['T1', 'T2', 'T3', 'T4', 'T5'])]), ['T6'], 'a code spelt with a double blank is hers all the same');
});

test('one person is one row of the report, however the blanks of her name fall on the teams', async () => {
  // "MARY  M" on two teams, "MARY M" on the other four: the report used to show two rows that look alike.
  const b = book({ managerOf: t => (t === 'T1' || t === 'T2') ? 'MARY  M' : 'MARY M' });
  const mary = code('M', 'MARY M', 'MANAGER', TEAMS);
  const db = () => fakeDb(tablesFor(b, [GINA, mary]));
  const rows = sectionRows(await report(db()), 'MANAGER');
  assert.equal(rows.length, 1, 'one leader');
  assert.deepEqual([rows[0].teams, rows[0].customers], [6, 12]);

  // The card behind her name reads the same six teams, and so does her own list on the phone and the portal.
  const card = await portalApi(db(), asUser(GINA), 'expdfLeader', { role: 'MANAGER', leader: 'MARY M', period: 'day' }, NOW);
  assert.equal(card.totals.customers, 12);
  const phone = await expdfMine(db(), { name: 'MARY M', teams: TEAMS, leader: true }, {}, NOW);
  assert.equal(phone.rows.length, 12);
  assert.equal(phone.diag.mine, 48, 'the whole book, from every team');
  const own = await portalApi(db(), asUser(mary), 'expectedDefaulters', {}, NOW);
  assert.equal(own.iAmLeader, true);
  assert.equal(own.rows.filter(r => leaderKey(r.leader) === leaderKey(own.me)).length, 48, 'the page\'s own compare finds all forty-eight');
});

test('a name with a double blank on EVERY team is still her own: she is a leader, and her list is hers', async () => {
  // Only the exact spelling would have found nobody: no team says 'MARY M' -- they all say 'MARY  M' -- so she was no leader at all,
  // her screen showed the whole scope with no "My list", and the phone showed her everybody's customers.
  const b = book({ managerOf: () => 'MARY  M' });
  const mary = code('M', 'MARY M', 'MANAGER', TEAMS);
  const own = await portalApi(fakeDb(tablesFor(b, [GINA, mary])), asUser(mary), 'expectedDefaulters', {}, NOW);
  assert.equal(own.iAmLeader, true, 'named on the sheet, whatever the blanks');
  assert.equal(own.rows.filter(r => leaderKey(r.leader) === leaderKey(own.me)).length, 48);
  const phone = await expdfMine(fakeDb(tablesFor(b, [GINA, mary])), { name: 'MARY M', teams: TEAMS, leader: true }, {}, NOW);
  assert.equal(phone.canSwitch, true, 'recognised as a leader on the phone too');
  assert.equal(phone.scope, 'mine');
  assert.equal(phone.rows.length, 12, 'her own twelve, not the whole scope\'s');
});

test('a spelling that differs in a WORD is not merged: it stays two rows for a person to judge', async () => {
  const b = book({ managerOf: t => (t === 'T1' || t === 'T2') ? 'MARY M' : 'MARY MWITA' });
  const rows = sectionRows(await report(fakeDb(tablesFor(b, [GINA, code('M', 'MARY M', 'MANAGER', TEAMS)]))), 'MANAGER');
  assert.deepEqual(rows.map(r => r.leader).sort(), ['MARY M', 'MARY MWITA']);
  assert.deepEqual(rows.map(r => r.teams).sort(), [2, 4], 'her code is MARY M: it holds all six, so nothing is "off code" -- the names are what differ');
  assert.equal(rows.find(r => r.leader === 'MARY MWITA').offCode, undefined, 'and no code carries the longer spelling, so nothing is said of it');
});

test('no read is added: the codes the report reads for the week\'s work are the codes it marks from', async () => {
  const b = book();
  const base = fakeDb(tablesFor(b, [GINA, code('M', 'MARY M', 'MANAGER', ['T1'])]));
  const reads = {};
  const counting = { from(n) { reads[n] = (reads[n] || 0) + 1; return base.from(n); }, rpc: base.rpc, _dump: n => base._dump(n) };
  const d = await portalApi(counting, asUser(GINA), 'expdfReport', { period: 'day' }, NOW);
  assert.ok(sectionRows(d, 'MANAGER')[0].offCode, 'the mark is there');
  assert.equal(reads.access_codes, 1, 'the access codes were read once -- weekWork\'s own read, one more column');

  const own = {};
  const base2 = fakeDb(tablesFor(b, [GINA, code('M', 'MARY M', 'MANAGER', ['T1'])]));
  const counting2 = { from(n) { own[n] = (own[n] || 0) + 1; return base2.from(n); }, rpc: base2.rpc, _dump: n => base2._dump(n) };
  const ed = await portalApi(counting2, asUser(code('M', 'MARY M', 'MANAGER', ['T1'])), 'expectedDefaulters', {}, NOW);
  assert.ok(ed.outside.length, 'the list names what it cannot show');
  assert.equal(own.teams, 1, 'and the teams sheet is read once, as it was before this change');
  assert.equal(own.access_codes, 1, 'with the access codes it lies over');
});

test('on the phone: a leader on an access code is told; a team-code handset is widened by the sheet and has nothing to be told', async () => {
  const b = book();
  const codes = [GINA, code('M', 'MARY M', 'MANAGER', ['T1', 'T2'])];
  _clearSummaryCache(); _clearWidgetCache();
  const db = fakeDb(tablesFor(b, codes));

  // MARY signs the handset in with her ACCESS code: her scope is the code's two teams, as the owner set it.
  await callApi(db, 'api_callRegister', ['dMARY', '', '', 'M', '0712999801'], NOW);
  const mine = await callApi(db, 'api_callList', ['dMARY', 'expdf'], NOW);
  assert.equal(mine.ok, true);
  assert.equal(mine.rows.length, 4);
  assert.deepEqual(mine.expdf.outside, ['T3', 'T4', 'T5', 'T6'], 'the strip is told which teams the sheet gives her that her code does not');
  assert.equal(mine.expdf.diag.mine, 16);

  // The same woman signed in on the TEAM code of T1 is widened to every team the sheet names her on -- no gap to report.
  _clearSummaryCache(); _clearWidgetCache();
  const db2 = fakeDb(tablesFor(b, codes));
  await callApi(db2, 'api_callRegister', ['dMARY2', 'MARY M', '', '', '0712999802', 'T1CODE'], NOW);
  const widened = await callApi(db2, 'api_callList', ['dMARY2', 'expdf'], NOW);
  assert.equal(widened.ok, true);
  assert.deepEqual(widened.expdf.outside, []);
  assert.equal(widened.rows.length, 12, 'six teams\' worth, the report\'s own figure for her');
  assert.equal(widened.expdf.diag.mine, 48);
});
