// THE ACCESS CODES HOLD THE LATEST LEADER OF EACH TEAM, AND TEAMS & STAFF FOLLOWS THEM (handbook Part 121).
//
//   "The access codes hold the latest staff / leader per team, so unless not there, will be set at teams
//    and staff but teams and staff (Wafanyakazi / Staff -- by person and its Orodha / List of team's
//    leaders) must always update the leaders as from settings (Misimbo ya kuingia / Access codes)" ...
//    "and that should affect all the current teams and staff nav data right away" -- the owner, 20 Nov 2026
//
// Two halves: the PLAN (api/_lib/leaders-sync.js, pure: which cells of the sheet the codes change, which
// they leave alone and why, which they cannot decide) and the DOOR (portal-core.js: leadersSync,
// leadersSyncUndo, and the sync saveAccessCode now runs after every save).

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { planLeaderSync, groupPatches } = await import('../api/_lib/leaders-sync.js');
const { portalApi } = await import('../api/_lib/portal-core.js');

const NOW = Date.parse('2026-07-24T09:00:00Z');
const COLS = ['opm', 'recovery', 'gmo', 'manager', 'credit', 'expected', 'bike'];
const PHONE = { opm: 'opm_no', recovery: 'recovery_no', gmo: 'gmo_no', manager: 'manager_no', credit: 'credit_no', expected: 'expected_no', bike: 'bike_no' };
const ID = { opm: null, recovery: 'recovery_id', gmo: 'gmo_id', manager: 'manager_id', credit: 'credit_id', expected: 'early_col_id', bike: 'bike_id' };
const ROLE = { GMO: 'gmo', MANAGER: 'manager', OPM: 'opm', RECOVERY: 'recovery', CREDIT: 'credit', EXPECTED: 'expected', BIKE: 'bike' };
const colOf = role => ROLE[String(role == null ? '' : role).trim().toUpperCase()] || null;

const blank = () => {
  const o = {};
  for (const c of COLS) { o[c] = null; o[PHONE[c]] = null; if (ID[c]) o[ID[c]] = null; }
  return o;
};
const team = (name, o = {}) => ({ team: name, ...blank(), ...o });
const code = (name, role, teams) => ({ name, role, teams });
const plan = (teams, codes, extra = {}) => planLeaderSync({ teams, codes, cols: COLS, colOf, phoneOf: PHONE, idOf: ID, ...extra });
const apply = (teams, p) => {                               // what the writer does, on plain rows
  const by = new Map(teams.map(t => [t.team, { ...t }]));
  for (const g of groupPatches(p.changes, null)) for (const row of g) Object.assign(by.get(row.team), row);
  return [...by.values()];
};

/* ================================== THE PLAN ================================== */

test('a cell the sheet leaves empty is filled from the code that holds the team', () => {
  const p = plan([team('KONGOWE'), team('MBAGALA')], [code('ASHA JUMA', 'GMO', ['KONGOWE'])]);
  assert.equal(p.changes.length, 1);
  assert.equal(p.changes[0].team, 'KONGOWE');
  assert.equal(p.changes[0].col, 'gmo');
  assert.equal(p.changes[0].now, 'ASHA JUMA');
  assert.equal(p.changes[0].why, 'filled');
});

test('a cell no code names keeps what Teams & Staff says ("unless not there")', () => {
  const rows = [team('KONGOWE', { gmo: 'TYPED BY HAND' }), team('MBAGALA', { gmo: 'ALSO TYPED' })];
  const p = plan(rows, [code('ASHA JUMA', 'GMO', ['MBAGALA'])]);
  assert.deepEqual(p.changes.map(c => c.team), ['MBAGALA'], 'only the team the code holds');
  assert.equal(apply(rows, p).find(t => t.team === 'KONGOWE').gmo, 'TYPED BY HAND');
});

test('a different person on the sheet is replaced by the code\'s, and takes nobody else\'s number or ID with them', () => {
  const rows = [team('KONGOWE', { gmo: 'OLD GMO', gmo_no: '0700000001', gmo_id: 'ID-OLD' })];
  const p = plan(rows, [code('NEW GMO', 'GMO', ['KONGOWE'])]);
  const c = p.changes[0];
  assert.equal(c.why, 'replaced');
  assert.equal(c.patch.gmo, 'NEW GMO');
  assert.equal(c.patch.gmo_no, null, 'the previous leader\'s number is not left beside the new one');
  assert.equal(c.patch.gmo_id, null);
  assert.deepEqual(c.undo, { gmo: 'OLD GMO', gmo_no: '0700000001', gmo_id: 'ID-OLD' }, 'and the way back holds all three');
});

test('a new leader gets the number and ID the same person already has beside that role on another team', () => {
  const rows = [team('A', { gmo: 'OLD', gmo_no: '0700000001' }),
    team('B', { gmo: 'NEW GMO', gmo_no: '0711999888', gmo_id: 'ID-NEW' })];
  const p = plan(rows, [code('NEW GMO', 'GMO', ['A', 'B'])]);
  const c = p.changes.find(x => x.team === 'A');
  assert.equal(c.patch.gmo_no, '0711999888');
  assert.equal(c.patch.gmo_id, 'ID-NEW');
  assert.equal(p.changes.find(x => x.team === 'B'), undefined, 'and B already says so');
});

test('the same person under a SHORTER spelling on the code is the same person: the sheet\'s fuller name stays, and it is told', () => {
  const rows = [team('KONGOWE', { manager: 'MARY SAMPLE', manager_no: '0722000111' })];
  const p = plan(rows, [code('MARY', 'MANAGER', ['KONGOWE'])]);
  assert.equal(p.changes.length, 0, 'never re-spelt shorter');
  assert.deepEqual(p.kept, [{ team: 'KONGOWE', col: 'manager', sheet: 'MARY SAMPLE', code: 'MARY' }]);
});

test('a code that spells the person FULLER than the sheet upgrades the spelling and keeps the number', () => {
  const rows = [team('KONGOWE', { manager: 'MARY', manager_no: '0722000111' })];
  const p = plan(rows, [code('MARY SAMPLE', 'MANAGER', ['KONGOWE'])]);
  assert.equal(p.changes[0].why, 'fuller');
  assert.deepEqual(Object.keys(p.changes[0].patch), ['manager'], 'the name only: it is the same person, so their number stands');
});

test('the same name in other capitals or with a doubled blank is no change at all', () => {
  const rows = [team('KONGOWE', { gmo: 'asha  juma' })];
  const p = plan(rows, [code('ASHA JUMA', 'GMO', ['KONGOWE'])]);
  assert.equal(p.changes.length, 0);
  assert.equal(p.kept.length, 0);
});

test('two codes of one role that name DIFFERENT people on one team change nothing and are reported: a rule that has to choose is a guess', () => {
  const rows = [team('KONGOWE', { gmo: 'THIRD PERSON' }), team('MBAGALA')];
  const codes = [code('ASHA JUMA', 'GMO', ['KONGOWE', 'MBAGALA']), code('BOB BOSS', 'GMO', ['KONGOWE'])];
  const p = plan(rows, codes);
  assert.deepEqual(p.conflicts, [{ team: 'KONGOWE', col: 'gmo', names: ['ASHA JUMA', 'BOB BOSS'] }]);
  assert.deepEqual(p.changes.map(c => c.team), ['MBAGALA'], 'the cell nobody disputes is still filled');
});

test('two codes naming ONE person (two spellings) are one claimant, in the fuller spelling', () => {
  const p = plan([team('KONGOWE')], [code('MARY', 'MANAGER', ['KONGOWE']), code('MARY SAMPLE', 'MANAGER', ['KONGOWE'])]);
  assert.equal(p.conflicts.length, 0);
  assert.equal(p.changes[0].now, 'MARY SAMPLE');
});

test('two different people who share a first name are never merged into one claimant', () => {
  const p = plan([team('KONGOWE')], [code('JOHN ALPHA', 'GMO', ['KONGOWE']), code('JOHN BETA', 'GMO', ['KONGOWE'])]);
  assert.equal(p.changes.length, 0);
  assert.equal(p.conflicts.length, 1);
  const q = plan([team('KONGOWE')], [code('JOHN', 'GMO', ['KONGOWE']), code('JOHN ALPHA', 'GMO', ['KONGOWE']), code('JOHN BETA', 'GMO', ['KONGOWE'])]);
  assert.equal(q.changes.length, 0, 'and a bare JOHN does not decide between them');
});

test('a code with no team list names nobody, and a role that is not a column names nothing: both are counted, never written', () => {
  const rows = [team('KONGOWE'), team('MBAGALA')];
  const p = plan(rows, [code('BIG BOSS', 'GMO', null), code('ALSO ALL', 'GMO', []),
    code('SOME ADMIN', 'ADMIN', ['KONGOWE']), code('MANAGEMENT PERSON', 'MANAGEMENT', ['MBAGALA']), code('MORE MGMT', 'management', ['KONGOWE'])]);
  assert.equal(p.changes.length, 0);
  assert.equal(p.conflicts.length, 0, 'an all-teams code is not even a claimant: two of them are not in conflict over a team');
  assert.equal(p.allTeamsCodes, 2);
  assert.deepEqual(p.unmapped, [{ role: 'ADMIN', codes: 1 }, { role: 'MANAGEMENT', codes: 2 }]);
  const alone = plan(rows, [code('BIG BOSS', 'GMO', null)]);
  assert.equal(alone.changes.length, 0, 'one all-teams GMO does not become the GMO of every team');
  assert.equal(alone.conflicts.length, 0);
});

test('a team the sheet does not have is ignored, and a team is matched by its spelling in any case', () => {
  const p = plan([team('Tunduru')], [code('ASHA JUMA', 'GMO', ['TUNDURU', 'NOWHERE ON THE SHEET'])]);
  assert.equal(p.changes.length, 1);
  assert.equal(p.changes[0].team, 'Tunduru', 'written under the sheet\'s own spelling');
});

test('a phone or ID column the book has not got is not sent: the name is written and nothing else', () => {
  const noExtras = [{ team: 'KONGOWE', opm: null, recovery: null, gmo: 'OLD', manager: null, credit: null, expected: null, bike: null }];
  const p = plan(noExtras, [code('NEW GMO', 'GMO', ['KONGOWE'])]);
  assert.deepEqual(Object.keys(p.changes[0].patch), ['gmo']);
});

test('people whose own code does not hold teams the sheet gives them are told, not changed', () => {
  const rows = [team('A', { manager: 'MARY SAMPLE' }), team('B', { manager: 'MARY SAMPLE' }), team('C', { manager: 'MARY SAMPLE' })];
  const p = plan(rows, [code('MARY SAMPLE', 'MANAGER', ['A'])]);
  assert.equal(p.changes.length, 0);
  assert.deepEqual(p.offCode, [{ name: 'MARY SAMPLE', col: 'manager', teams: ['B', 'C'] }], 'her code holds A; the sheet also gives her B and C');
});

test('applying a plan and planning again changes nothing: the sync settles', () => {
  const rows = [team('A', { gmo: 'OLD', gmo_no: '0700000001' }), team('B'), team('C', { manager: 'M OLD' })];
  const codes = [code('NEW GMO', 'GMO', ['A', 'B']), code('MARY SAMPLE', 'MANAGER', ['C'])];
  const once = plan(rows, codes);
  assert.equal(once.changes.length, 3);
  const after = apply(rows, once);
  assert.equal(plan(after, codes).changes.length, 0);
});

test('the same book gives the same plan whatever order the rows and the codes come in', () => {
  const rows = [team('A', { gmo: 'OLD' }), team('B'), team('C', { manager: 'X' }), team('D')];
  const codes = [code('ONE', 'GMO', ['A', 'B']), code('TWO', 'MANAGER', ['C']), code('THREE', 'GMO', ['D']), code('FOUR', 'GMO', ['D'])];
  const want = JSON.stringify(plan(rows, codes));
  for (let i = 0; i < 60; i++) {
    const r = rows.slice().sort(() => Math.random() - 0.5), c = codes.slice().sort(() => Math.random() - 0.5);
    assert.equal(JSON.stringify(plan(r, c)), want);
  }
});

test('a team the caller may not change is left alone', () => {
  const p = plan([team('A'), team('B')], [code('ONE', 'GMO', ['A', 'B'])], { allowed: t => t === 'A' });
  assert.deepEqual(p.changes.map(c => c.team), ['A']);
});

test('the plan never carries an access code: a code is a password and the plan goes to a screen', () => {
  const p = plan([team('A')], [{ code: 'SECRET-123', name: 'ONE', role: 'GMO', teams: ['A'] }, { code: 'SECRET-456', name: 'TWO', role: 'ADMIN', teams: ['A'] }]);
  assert.ok(!JSON.stringify(p).includes('SECRET'), JSON.stringify(p));
});

test('the writes are grouped by the keys they carry: PostgREST turns a missing key into NULL, which on a conflict BLANKS the cell', () => {
  const rows = [team('A', { gmo: 'OLD', manager: 'M OLD' }), team('B', { gmo: 'OLD2' }), team('C')];
  const codes = [code('NEW GMO', 'GMO', ['A', 'B']), code('NEW MGR', 'MANAGER', ['A', 'C'])];
  const p = plan(rows, codes);
  const groups = groupPatches(p.changes, '2026-07-24T09:00:00.000Z');
  for (const g of groups) {
    const sigs = new Set(g.map(r => Object.keys(r).sort().join(',')));
    assert.equal(sigs.size, 1, 'a group holds one key set: ' + [...sigs].join(' | '));
    for (const r of g) assert.equal(r.updated_at, '2026-07-24T09:00:00.000Z');
  }
  const a = groups.flat().find(r => r.team === 'A');
  assert.ok('gmo' in a && 'manager' in a, 'a team with two changed cells carries both in one row');
  assert.equal(groups.flat().length, 3, 'one row for each team');
  assert.ok(groups.length >= 2, 'rows with different keys are in different statements');
});

/* ================================== THE DOOR ================================== */

const ADMIN = { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['teams', 'settings', 'upload'] };
const AUDITOR = { code: 'V', name: 'SUPERVISOR', role: 'AUDITOR', teams: null, tabs: ['teams', 'settings'], readOnly: true };

function book() {
  return {
    teams: [
      team('KONGOWE', { gmo: 'OLD GMO', gmo_no: '0700000001', gmo_id: 'ID-OLD', manager: 'MARY SAMPLE', recovery: 'RAPHAEL R' }),
      team('MBAGALA', { gmo: 'ALSO OLD', credit: 'ANALYST A' }),
      team('TEMEKE', { gmo: 'ASHA JUMA', bike: 'BIKER B' }),
    ].map(t => ({ ...t, team_code: null, zone: null })),
    access_codes: [
      { code: 'ADMIN1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] },
      { code: 'G1', name: 'NEW GMO', role: 'GMO', teams: ['KONGOWE', 'MBAGALA'], tabs: [] },
      { code: 'M1', name: 'MARY', role: 'MANAGER', teams: ['KONGOWE'], tabs: [] },
      { code: 'R1', name: 'RAPHAEL R', role: 'PMO RECOVERY', teams: ['KONGOWE', 'TEMEKE'], tabs: [] },
    ],
    settings: [], call_users: [], roles: [], team_holders: [],
  };
}
const cell = (db, team, col) => db._dump('teams').find(t => t.team === team)[col];

test('leadersSync brings every cell the codes name into line, right away, for all the current data', async () => {
  const db = fakeDb(book());
  const r = await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  assert.equal(r.ok, true);
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'NEW GMO');
  assert.equal(cell(db, 'MBAGALA', 'gmo'), 'NEW GMO', 'a team the same code holds');
  assert.equal(cell(db, 'KONGOWE', 'gmo_no'), null, 'the old GMO\'s number is not left beside the new one');
  assert.equal(cell(db, 'KONGOWE', 'gmo_id'), null);
  assert.equal(cell(db, 'KONGOWE', 'manager'), 'MARY SAMPLE', 'MARY on the code, the fuller name on the sheet: kept');
  assert.equal(cell(db, 'TEMEKE', 'recovery'), 'RAPHAEL R', 'a PMO RECOVERY code is written to the sheet too: one rule for the role');
  assert.equal(cell(db, 'TEMEKE', 'gmo'), 'ASHA JUMA', 'a team no code names as GMO keeps what Teams & Staff says');
  assert.ok(r.changed >= 3);
  assert.equal(r.applied, true);
  assert.ok(r.kept.some(k => k.team === 'KONGOWE' && k.sheet === 'MARY SAMPLE'));
});

test('Teams & Staff shows it at once: the list of team leaders and the staff by person', async () => {
  const db = fakeDb(book());
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  const list = await portalApi(db, ADMIN, 'teams', {}, NOW);
  assert.equal(list.rows.find(r => r.team === 'MBAGALA').gmo, 'NEW GMO');
  const roster = await portalApi(db, ADMIN, 'staffRoster', {}, NOW);
  const g = roster.staff.find(s => s.name === 'NEW GMO' && s.role === 'gmo');
  assert.deepEqual(g.teams, ['KONGOWE', 'MBAGALA']);
  assert.equal(roster.staff.find(s => s.name === 'OLD GMO'), undefined, 'and nobody is left on a team they no longer lead');
});

test('a second run changes nothing', async () => {
  const db = fakeDb(book());
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  const before = JSON.stringify(db._dump('teams'));
  const again = await portalApi(db, ADMIN, 'leadersSync', {}, NOW + 60000);
  assert.equal(again.changed, 0);
  assert.equal(again.applied, false);
  assert.equal(JSON.stringify(db._dump('teams')), before);
});

test('a preview says what would change and writes nothing', async () => {
  const db = fakeDb(book());
  const before = JSON.stringify(db._dump('teams'));
  const r = await portalApi(db, ADMIN, 'leadersSync', { preview: true }, NOW);
  assert.ok(r.changed >= 3);
  assert.equal(r.applied, false);
  assert.equal(JSON.stringify(db._dump('teams')), before);
  assert.equal(db._dump('settings').some(s => s.key === 'LEADERS_SYNC_LOG'), false, 'not even a log');
});

test('the way back: the sync keeps what every cell was, and undoing puts it back (a cell changed since is left as it was changed)', async () => {
  const db = fakeDb(book());
  const original = JSON.stringify(db._dump('teams'));
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  const log = db._dump('settings').find(s => s.key === 'LEADERS_SYNC_LOG');
  assert.ok(log, 'the log is written');
  assert.ok(!/G1|M1|R1|ADMIN1/.test(log.value), 'and carries no access code');
  // somebody changes one cell by hand after the sync
  await portalApi(db, ADMIN, 'saveTeam', { team: 'MBAGALA', gmo: 'CHANGED BY HAND' }, NOW + 1000);
  const r = await portalApi(db, ADMIN, 'leadersSyncUndo', {}, NOW + 2000);
  assert.ok(r.restored >= 2);
  assert.equal(r.skipped, 1, 'the cell changed since is skipped');
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'OLD GMO');
  assert.equal(cell(db, 'KONGOWE', 'gmo_no'), '0700000001', 'the number and ID come back with the name');
  assert.equal(cell(db, 'KONGOWE', 'gmo_id'), 'ID-OLD');
  assert.equal(cell(db, 'MBAGALA', 'gmo'), 'CHANGED BY HAND');
  assert.equal(db._dump('settings').some(s => s.key === 'LEADERS_SYNC_LOG'), false, 'and the log is spent');
  await assert.rejects(() => portalApi(db, ADMIN, 'leadersSyncUndo', {}, NOW + 3000), /no sync to undo/i);
  void original;
});

test('leadersCheck is the READ the screen asks first: it says what differs, writes nothing, is not in the audit log, and a view-only admin may ask it', async () => {
  const b = book(); b.audit_log = [];
  const db = fakeDb(b);
  const before = JSON.stringify(db._dump('teams'));
  const c = await portalApi(db, ADMIN, 'leadersCheck', {}, NOW);
  assert.equal(c.preview, true);
  assert.equal(c.applied, false);
  assert.ok(c.changed >= 3, 'it sees the same cells leadersSync would change');
  assert.equal(JSON.stringify(db._dump('teams')), before, 'and writes nothing');
  assert.equal(db._dump('settings').some(x => x.key === 'LEADERS_SYNC_LOG'), false);
  assert.equal(db._dump('audit_log').length, 0, 'a book that is being looked at leaves nothing in the audit log');
  assert.equal(db._dump('team_holders').length, 0, 'nor in the history of who held what');
  const seen = await portalApi(db, AUDITOR, 'leadersCheck', {}, NOW);
  assert.equal(seen.changed, c.changed, 'a view-only admin is shown the same list');
  assert.equal(JSON.stringify(db._dump('teams')), before);
  const GMO = { code: 'G1', name: 'NEW GMO', role: 'GMO', teams: ['KONGOWE'], tabs: ['teams'] };
  await assert.rejects(() => portalApi(db, GMO, 'leadersCheck', {}, NOW), e => e.status === 403, 'an admin only');
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  assert.ok(db._dump('audit_log').some(r => r.action === 'leadersSync'), 'the write IS in the audit log');
});

test('only an admin may run it, and a view-only code is refused at the one door and changes nothing', async () => {
  const db = fakeDb(book());
  const before = JSON.stringify(db._dump('teams'));
  for (const fn of ['leadersSync', 'leadersSyncUndo']) {
    await assert.rejects(() => portalApi(db, AUDITOR, fn, {}, NOW), e => e.status === 403 && /view-only/.test(e.message), fn);
  }
  const GMO = { code: 'G1', name: 'NEW GMO', role: 'GMO', teams: ['KONGOWE'], tabs: ['teams'] };
  await assert.rejects(() => portalApi(db, GMO, 'leadersSync', {}, NOW), e => e.status === 403);
  assert.equal(JSON.stringify(db._dump('teams')), before);
});

test('who held a team is recorded around it, like every other change of leader', async () => {
  const db = fakeDb(book());
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  const h = db._dump('team_holders');
  assert.ok(h.some(r => r.team === 'MBAGALA' && r.role === 'gmo' && r.name === 'NEW GMO' && r.to_date === '9999-12-31'),
    'the new GMO of MBAGALA is on the record, from today');
});

test('the writes reach the database in groups that carry the same keys: nothing is blanked on the way', async () => {
  const db = fakeDb(book());
  const sent = [];
  const realFrom = db.from.bind(db);
  db.from = name => {
    const q = realFrom(name);
    if (name !== 'teams' || typeof q.upsert !== 'function') return q;
    const up = q.upsert.bind(q);
    q.upsert = (rows, opts) => { sent.push(Array.isArray(rows) ? rows : [rows]); return up(rows, opts); };
    return q;
  };
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  assert.ok(sent.length >= 2);
  for (const batch of sent) {
    const sigs = new Set(batch.map(r => Object.keys(r).sort().join(',')));
    assert.equal(sigs.size, 1, 'one batch, one key set: ' + [...sigs].join(' | '));
  }
});

test('saving an access code runs the whole sync after it: the other codes\' drift is put right in the same save, and the answer says so', async () => {
  const b = book();
  b.access_codes = b.access_codes.filter(c => c.code !== 'G1');             // the GMO code does not exist yet
  const db = fakeDb(b);
  const r = await portalApi(db, ADMIN, 'saveAccessCode', { code: 'G9', name: 'BRAND NEW', role: 'GMO', teams: 'MBAGALA' }, NOW);
  assert.equal(cell(db, 'MBAGALA', 'gmo'), 'BRAND NEW', 'the saved code');
  assert.equal(cell(db, 'TEMEKE', 'recovery'), 'RAPHAEL R', 'and a code saved long ago whose cell never followed');
  assert.ok(r.leaders && r.leaders.changed >= 1, JSON.stringify(r.leaders));
});

test('a PMO RECOVERY code is one rule on both roads: saved to the sheet, and taking a team off it takes the person off that team', async () => {
  const db = fakeDb(book());
  await portalApi(db, ADMIN, 'saveAccessCode', { code: 'R1', oldCode: 'R1', name: 'RAPHAEL R', role: 'PMO RECOVERY', teams: 'KONGOWE' }, NOW);
  assert.equal(cell(db, 'KONGOWE', 'recovery'), 'RAPHAEL R');
  assert.equal(cell(db, 'TEMEKE', 'recovery'), null, 'TEMEKE was dropped from the code: the sheet must not re-assert him there');
});

test('a collection or legal officer named by a code is shown on the team over what the row says; a team no code names keeps its row', async () => {
  const b = book();
  b.teams[0].collection = 'TYPED BY HAND';
  b.teams[1].collection = 'STAYS';
  b.access_codes.push({ code: 'P', name: 'CATHERINE', role: 'PMO COLLECTION', teams: ['KONGOWE'], tabs: [] });
  const d = await portalApi(fakeDb(b), ADMIN, 'teams', {}, NOW);
  assert.equal(d.rows.find(r => r.team === 'KONGOWE').collection, 'CATHERINE', 'the code holds the latest');
  assert.equal(d.rows.find(r => r.team === 'MBAGALA').collection, 'STAYS', 'unless not there');
});

test('the owner\'s rule is written where the code is: the sources register the two functions at the one door, the audit log and the history', async () => {
  const fs = await import('node:fs');
  const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const { AUDITED } = await import('../api/_lib/audit.js');
  const { HOLDER_FNS } = await import('../api/_lib/holders.js');
  const { PORTAL_FUNCTIONS } = await import('../api/_lib/portal-core.js');
  for (const fn of ['leadersSync', 'leadersSyncUndo']) {
    assert.ok(PORTAL_FUNCTIONS.includes(fn), fn + ' is dispatched');
    assert.ok(AUDITED.has(fn), fn + ' is audited (and so refused to a view-only code)');
    assert.ok(HOLDER_FNS.has(fn), fn + ' records who held what');
  }
  assert.ok(PORTAL_FUNCTIONS.includes('leadersCheck'), 'the check is dispatched');
  assert.ok(!AUDITED.has('leadersCheck') && !HOLDER_FNS.has('leadersCheck'), 'and it is a read: not audited, not in the history (it runs at every open)');
  assert.ok(/leadersCheck: \['teams'\], leadersSync: \['teams'\]/.test(read('api/_lib/portal-core.js')), 'behind the Teams & Staff tab');
});

test('the answer carries the last sync that changed something, so the screen can offer its Undo; once it is undone nothing is offered', async () => {
  const db = fakeDb(book());
  const first = await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  assert.ok(first.changed >= 3);
  assert.equal(first.last.n, first.changed);
  assert.equal(first.last.by, 'THE ADMIN');
  const again = await portalApi(db, ADMIN, 'leadersSync', {}, NOW + 1000);
  assert.equal(again.changed, 0, 'a settled book');
  assert.equal(again.last.n, first.changed, 'the log outlives the screen it was first shown on');
  await portalApi(db, ADMIN, 'leadersSyncUndo', {}, NOW + 2000);
  const seen = await portalApi(db, ADMIN, 'leadersSync', { preview: true }, NOW + 3000);
  assert.equal(seen.last, null, 'nothing to undo any more');
});

/* ================================== THE SCREEN ================================== */

test('the Teams & Staff screen asks for the sync BEFORE it reads the list, only for a code that may change things, and draws every name as text', async () => {
  const fs = await import('node:fs');
  const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const admin = read('public/mod/admin.js');
  const view = admin.slice(admin.indexOf('VIEWS.teams = function()'), admin.indexOf('function teamsView_()'));
  assert.ok(/srv\('leadersCheck'\)/.test(view) && /srv\('leadersSync'\)/.test(view));
  assert.ok(view.indexOf("srv('leadersCheck')") < view.indexOf("srv('leadersSync')"), 'the check is asked first');
  assert.ok(/c\.changed && !S\.me\.readOnly/.test(view), 'the write is asked only by a code that may change things, and only when the check found a difference (a view-only code asking would be refused and the refusal written in the audit log at every open)');
  assert.ok(view.indexOf("srv('leadersSync')") < view.indexOf('teamsView_()'), 'the sync comes first');
  assert.equal((view.match(/teamsView_\(\)/g) || []).length, 1, 'the list is read once, and only inside the sync\'s own then()');
  assert.ok(/sync\.then\(function\(sr\)\{[^}]*teamsView_\(\)/.test(view), 'after the sync has answered');
  assert.ok(/S\.teamsCache = null/.test(view), 'and what the list remembered is dropped when it changed something');
  const card = admin.slice(admin.indexOf('function leadersCard_('), admin.indexOf('function wireLeadersSync_('));
  for (const k of ['c.now', 'c.was', 'c.team', 'c.sheet', 'c.code', 'o.name']) {
    assert.ok(card.includes('esc(' + k) || card.includes('esc(' + k.replace(/^c\./, 'c.')), k + ' is drawn through esc()');
  }
  assert.ok(!/\+ c\.(now|was|team|sheet|code) \+/.test(card.replace(/esc\(c\.[a-z]+\)/g, '')), 'no leader\'s name is put into the page raw');
  assert.ok(/wireLeadersSync_/.test(read('public/app.html')), 'the core wires the two buttons');
  assert.ok(/readOnly: !!user\.readOnly/.test(read('api/me.js')), 'and /api/me tells the page when the code is view-only');
});
