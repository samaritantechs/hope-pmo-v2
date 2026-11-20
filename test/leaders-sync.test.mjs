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


/* ============ HANDBOOK PART 122: what the second reader of #764 found, each pinned ============ */

const AC = String.fromCharCode(0xC9), AI = String.fromCharCode(0xCD), CURLY = String.fromCharCode(0x2019);   // E acute, I acute, a curly apostrophe

test('a number is handed over only to the SAME words: a bare JOHN is not JOHN BETA, and two numbers for one person are not picked between', () => {
  // JOHN (with a number and ID) leads T1, whose code says JOHN ALPHA; JOHN BETA's code takes over T2: he must not get ALPHA's number
  const rows = [team('T1', { gmo: 'JOHN', gmo_no: '0711111111', gmo_id: 'ID-ALPHA' }), team('T2', { gmo: 'OLD' })];
  const p = plan(rows, [code('JOHN ALPHA', 'GMO', ['T1']), code('JOHN BETA', 'GMO', ['T2'])]);
  const t2 = p.changes.find(c => c.team === 'T2');
  assert.equal(t2.patch.gmo_no, null, 'a short form on another team could be anybody');
  assert.equal(t2.patch.gmo_id, null);
  // the same words elsewhere: the number is handed over
  const same = plan([team('T1', { gmo: 'JOHN BETA', gmo_no: '0722222222', gmo_id: 'ID-BETA' }), team('T2', { gmo: 'OLD' })], [code('JOHN BETA', 'GMO', ['T1', 'T2'])]);
  assert.equal(same.changes[0].patch.gmo_no, '0722222222');
  assert.equal(same.changes[0].patch.gmo_id, 'ID-BETA');
  // two different numbers for one person: not a thing to pick between; the ID they agree on is still handed over
  const two = plan([team('T1', { gmo: 'ASHA JUMA', gmo_no: '0711', gmo_id: 'ID-A' }), team('T3', { gmo: 'ASHA JUMA', gmo_no: '0722', gmo_id: 'ID-A' }), team('T2', { gmo: 'OLD' })],
    [code('ASHA JUMA', 'GMO', ['T1', 'T2', 'T3'])]);
  assert.equal(two.changes[0].team, 'T2');
  assert.equal(two.changes[0].patch.gmo_no, null, 'two numbers disagree');
  assert.equal(two.changes[0].patch.gmo_id, 'ID-A', 'the ID they agree on');
  const ids = plan([team('T1', { gmo: 'ASHA JUMA', gmo_no: '0711', gmo_id: 'ID-A' }), team('T3', { gmo: 'ASHA JUMA', gmo_no: '0711', gmo_id: 'ID-B' }), team('T2', { gmo: 'OLD' })],
    [code('ASHA JUMA', 'GMO', ['T1', 'T2', 'T3'])]);
  assert.equal(ids.changes[0].patch.gmo_no, '0711', 'the number they agree on');
  assert.equal(ids.changes[0].patch.gmo_id, null, 'two staff IDs for one person are not picked between either');
});

test('the same words with an apostrophe, an accent, a hyphen or another order are the same person: the sheet follows the code\'s spelling and the number stays', () => {
  const pairs = [["NG'SAMPLE ALPHA", 'NGSAMPLE ALPHA'], ['ASHA NG' + CURLY + 'SAMPLE', 'ASHA NGSAMPLE'], ['JOSE SAMPLE', 'JOS' + AC + ' SAMPL' + AC],
    ['SAMPLE-ONE ALI', 'SAMPLE ONE ALI'], ['JUMA ASHA', 'ASHA JUMA'], ["BA'SAMPLE SAID", 'BASAMPLE SAID'], ['ALPHA M' + AI + 'NOR', 'ALPHA MINOR']];
  for (const [sheet, codeName] of pairs) {
    const p = plan([team('T1', { gmo: sheet, gmo_no: '0700000001', gmo_id: 'ID-1' })], [code(codeName, 'GMO', ['T1'])]);
    assert.equal(p.changes.length, 1, sheet + ' / ' + codeName);
    assert.equal(p.changes[0].why, 'respelt');
    assert.deepEqual(p.changes[0].patch, { gmo: codeName }, 'the name only: it is the same person, so their number and ID stand');
    assert.equal(p.kept.length, 0);
    assert.equal(p.conflicts.length, 0);
  }
  // and a code that spells the person SHORTER is still never allowed to shorten the sheet
  const shorter = plan([team('T1', { gmo: "NG'SAMPLE ALPHA SAID" })], [code('NGSAMPLE ALPHA', 'GMO', ['T1'])]);
  assert.equal(shorter.changes.length, 0);
  assert.equal(shorter.kept.length, 1);
});

test('two codes naming one person with punctuation apart are ONE claimant; a name with no letters at all, or two different non-Latin names, are nobody\'s "same person"', () => {
  const one = plan([team('T1')], [code("NG'SAMPLE ALPHA", 'GMO', ['T1']), code('NGSAMPLE ALPHA', 'GMO', ['T1'])]);
  assert.equal(one.conflicts.length, 0);
  assert.equal(one.changes.length, 1);
  const symbols = plan([team('T1', { gmo: '???' })], [code('---', 'GMO', ['T1'])]);
  assert.equal(symbols.changes.length, 1, 'two different symbol-only names are not the same person');
  assert.equal(symbols.changes[0].why, 'replaced');
  const cyr = (...c) => String.fromCharCode(...c);
  const hasan = cyr(0x425, 0x410, 0x421, 0x410, 0x41D), ali = cyr(0x410, 0x41B, 0x418);
  const cy = plan([team('T1', { gmo: hasan })], [code(ali, 'GMO', ['T1'])]);
  assert.equal(cy.changes.length, 1, 'two different names in another alphabet are two people');
  assert.equal(cy.changes[0].why, 'replaced');
  const juma = cyr(0x416, 0x423, 0x41C, 0x410);
  const same = plan([team('T1', { gmo: hasan + ' ' + juma, gmo_no: '0700000001' })], [code(juma + ' ' + hasan, 'GMO', ['T1'])]);
  assert.equal(same.changes[0].why, 'respelt', 'the same words in another alphabet are the same person: letters are letters in any alphabet');
  assert.deepEqual(same.changes[0].patch, { gmo: juma + ' ' + hasan });
});

test('one person with two codes of one role is one row of "off their code": their codes\' teams are pooled', () => {
  const rows = [team('A', { manager: 'MARY SAMPLE' }), team('B', { manager: 'MARY SAMPLE' })];
  assert.deepEqual(plan(rows, [code('MARY SAMPLE', 'MANAGER', ['A']), code('MARY SAMPLE', 'MANAGER', ['B'])]).offCode, []);
  assert.deepEqual(plan(rows, [code('MARY', 'MANAGER', ['A']), code('MARY SAMPLE', 'MANAGER', ['B'])]).offCode, [], 'under two spellings too');
  assert.equal(plan(rows, [code('MARY SAMPLE', 'MANAGER', ['A'])]).offCode.length, 1, 'and still told when no code of theirs holds B');
});

test('two codes that differ only in capitals write the same spelling whatever order they come in', () => {
  const a = plan([team('T1')], [code('mary sample', 'MANAGER', ['T1']), code('MARY SAMPLE', 'MANAGER', ['T1'])]);
  const b = plan([team('T1')], [code('MARY SAMPLE', 'MANAGER', ['T1']), code('mary sample', 'MANAGER', ['T1'])]);
  assert.equal(a.changes[0].now, b.changes[0].now);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('what the owner undid stays undone while a code still names that person there (plan rule 8): held, reported, and the hold lets go when the code stops saying it', () => {
  const rows = [team('KONGOWE', { gmo: 'OLD GMO' }), team('MBAGALA', { gmo: 'ALSO OLD' })];
  const codes = [code('NEW GMO', 'GMO', ['KONGOWE', 'MBAGALA'])];
  const holds = [{ team: 'KONGOWE', col: 'gmo', name: 'NEW GMO' }];
  const p = plan(rows, codes, { holds });
  assert.deepEqual(p.changes.map(c => c.team), ['MBAGALA'], 'only the cell that was not undone');
  assert.deepEqual(p.held, [{ team: 'KONGOWE', col: 'gmo', was: 'OLD GMO', now: 'NEW GMO' }]);
  assert.deepEqual(p.holdsInForce, holds);
  // the code now names somebody else there: the claim is a new one, applied; the hold is no longer needed
  const other = plan(rows, [code('ANOTHER GMO', 'GMO', ['KONGOWE'])], { holds });
  assert.equal(other.changes.length, 1);
  assert.equal(other.changes[0].now, 'ANOTHER GMO');
  assert.deepEqual(other.holdsInForce, []);
  // no code names the team any more: nothing is held, nothing is written
  const none = plan(rows, [code('SOMEBODY', 'GMO', ['MBAGALA'])], { holds });
  assert.deepEqual(none.holdsInForce, []);
  assert.equal(none.held.length, 0);
  // the same person under a longer spelling on the code is still the person that was undone
  const longer = plan(rows, [code('NEW GMO JUNIOR', 'GMO', ['KONGOWE'])], { holds });
  assert.equal(longer.held.length, 1);
  // a hold is not an order to keep a cell the sheet already agrees on: it is let go
  const agrees = plan([team('KONGOWE', { gmo: 'NEW GMO' })], codes, { holds });
  assert.deepEqual(agrees.holdsInForce, []);
  // a hold is on ONE role of ONE team: the same person as the team's manager is a different claim
  const two = plan([team('KONGOWE', { gmo: 'OLD GMO', manager: 'OLD MGR' })], [code('NEW GMO', 'GMO', ['KONGOWE']), code('NEW GMO', 'MANAGER', ['KONGOWE'])], { holds });
  assert.deepEqual(two.changes.map(c => c.col), ['manager'], 'only the role that was undone is held');
  assert.deepEqual(two.held.map(h => h.col), ['gmo']);
});

test('handsOverPatch is the ONE rule for a cell that changes hands: the plan and the save of one code use it', async () => {
  const fs = await import('node:fs');
  const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const { handsOverPatch } = await import('../api/_lib/leaders-sync.js');
  const rows = [team('A', { gmo: 'NEW GMO', gmo_no: '0711999888', gmo_id: 'ID-NEW' })];
  assert.deepEqual(handsOverPatch({ rows, row: team('B', { gmo: 'OLD', gmo_no: '0700000001' }), col: 'gmo', name: 'NEW GMO', phoneOf: PHONE, idOf: ID }),
    { gmo: 'NEW GMO', gmo_no: '0711999888', gmo_id: 'ID-NEW' });
  assert.deepEqual(handsOverPatch({ rows, row: { team: 'B', gmo: 'OLD' }, col: 'gmo', name: 'NEW GMO', phoneOf: PHONE, idOf: ID }),
    { gmo: 'NEW GMO' }, 'a book without the phone and ID columns is sent the name alone');
  const core = read('api/_lib/portal-core.js');
  const staff = core.slice(core.indexOf('async function syncStaffFromCode('), core.indexOf('function leaderColumnOf_'));
  assert.ok(/handsOverPatch\(/.test(staff), 'the save of one code hands a cell over by the same rule');
  assert.ok(/groupPatches\(writes/.test(staff), 'and sends rows that carry different keys in different statements');
  assert.ok(/handsOverPatch\(/.test(read('api/_lib/leaders-sync.js').slice(read('api/_lib/leaders-sync.js').indexOf('export function planLeaderSync'))), 'as does the plan');
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


/* ============ HANDBOOK PART 122, THE DOOR: Undo that sticks, one rule on both roads, failures said ============ */

const holdsOf = db => { const r = db._dump('settings').find(x => x.key === 'LEADERS_SYNC_HOLDS'); return r ? JSON.parse(r.value) : []; };
const logOf = db => { const r = db._dump('settings').find(x => x.key === 'LEADERS_SYNC_LOG'); return r ? JSON.parse(r.value) : null; };

test('Undo STAYS undone: the look the screen takes straight afterwards finds nothing to change, and a save of the same code does not write it back', async () => {
  const db = fakeDb(book());
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  const u = await portalApi(db, ADMIN, 'leadersSyncUndo', {}, NOW + 1000);
  assert.ok(u.restored >= 3);
  assert.equal(u.held, u.restored, 'every cell put back is held');
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'OLD GMO');
  const c = await portalApi(db, ADMIN, 'leadersCheck', {}, NOW + 2000);
  assert.equal(c.changed, 0, 'the same difference is not found again, or the Undo would undo nothing');
  assert.equal(c.held.length, u.held, 'and the screen is told what it is holding back');
  assert.equal(c.last, null, 'nothing is left to undo');
  const s2 = await portalApi(db, ADMIN, 'leadersSync', {}, NOW + 3000);
  assert.equal(s2.changed, 0);
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'OLD GMO');
  assert.equal(cell(db, 'KONGOWE', 'gmo_no'), '0700000001', 'the number came back with the name and stays');
  assert.equal(cell(db, 'MBAGALA', 'gmo'), 'ALSO OLD');
  assert.equal(cell(db, 'TEMEKE', 'recovery'), null);
  // the other road: saving the SAME access code again (a tab ticked, nothing about its leader changed) is not an order to apply it
  const r = await portalApi(db, ADMIN, 'saveAccessCode', { code: 'G1', oldCode: 'G1', name: 'NEW GMO', role: 'GMO', teams: 'KONGOWE;MBAGALA', tabs: 'teams' }, NOW + 4000);
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'OLD GMO', 'the save road holds what the owner undid too');
  assert.equal(cell(db, 'MBAGALA', 'gmo'), 'ALSO OLD');
  assert.ok(r.leaders.held >= 2, JSON.stringify(r.leaders));
});

test('a hold ends when the code stops saying it: another person on the team is applied, a deleted code lets go, and Sync now writes what was undone', async () => {
  // (1) the code now names somebody else
  let db = fakeDb(book());
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  await portalApi(db, ADMIN, 'leadersSyncUndo', {}, NOW + 1000);
  assert.ok(holdsOf(db).length >= 2);
  await portalApi(db, ADMIN, 'saveAccessCode', { code: 'G1', oldCode: 'G1', name: 'ANOTHER GMO', role: 'GMO', teams: 'KONGOWE;MBAGALA' }, NOW + 2000);
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'ANOTHER GMO');
  assert.equal(cell(db, 'MBAGALA', 'gmo'), 'ANOTHER GMO');
  assert.deepEqual(holdsOf(db).filter(h => h.col === 'gmo'), [], 'the claim is a new one, so the hold on the old one is gone');
  // (2) the code is deleted: the hold goes with it, and a new code for the same person is a fresh claim
  db = fakeDb(book());
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  await portalApi(db, ADMIN, 'leadersSyncUndo', {}, NOW + 1000);
  const d = await portalApi(db, ADMIN, 'deleteAccessCode', { code: 'G1' }, NOW + 2000);
  assert.ok(d.leaders && !d.leaders.error, 'the sheet follows a deletion too, and says so: ' + JSON.stringify(d.leaders));
  assert.deepEqual(holdsOf(db).filter(h => h.col === 'gmo'), []);
  await portalApi(db, ADMIN, 'saveAccessCode', { code: 'G2', name: 'NEW GMO', role: 'GMO', teams: 'KONGOWE' }, NOW + 3000);
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'NEW GMO', 'the same person again, on a code made after the delete, is applied');
  // (3) Sync now lets go of every hold and writes what was undone
  db = fakeDb(book());
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  await portalApi(db, ADMIN, 'leadersSyncUndo', {}, NOW + 1000);
  const n = await portalApi(db, ADMIN, 'leadersSync', { releaseHolds: true }, NOW + 2000);
  assert.ok(n.changed >= 3 && n.heldReleased >= 3, JSON.stringify([n.changed, n.heldReleased]));
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'NEW GMO');
  assert.deepEqual(holdsOf(db), []);
  assert.ok(n.last && n.last.n >= 3, 'and it is a sync like any other: there is something to undo again');
});

test('Undo puts a cell back only if EVERYTHING the sync wrote there is still there: a number typed since leaves the whole cell as it is, and twin rows are two cells', async () => {
  let db = fakeDb(book());
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  await portalApi(db, ADMIN, 'saveTeam', { team: 'KONGOWE', gmo_no: '0788888888' }, NOW + 1000);          // somebody types the new GMO's real number
  const u = await portalApi(db, ADMIN, 'leadersSyncUndo', {}, NOW + 2000);
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'NEW GMO', 'the name is not put back beside a number somebody typed for the new one');
  assert.ok(/788888888/.test(String(cell(db, 'KONGOWE', 'gmo_no'))), 'and what they typed is not lost');
  assert.ok(u.skipped >= 1);
  assert.equal(cell(db, 'MBAGALA', 'gmo'), 'ALSO OLD', 'the cells nobody touched are put back');
  assert.equal(holdsOf(db).some(h => h.team === 'KONGOWE' && h.col === 'gmo'), false, 'a cell that was not put back is not held either');
  // twin rows: the registry can hold KONGOWE and "KONGOWE " as two rows; each is its own cell for the way back
  const b = book();
  b.teams = [team('KONGOWE', { gmo: 'OLD ONE' }), team('KONGOWE ', { gmo: 'OLD TWO' })];
  b.access_codes = [b.access_codes[0], { code: 'G1', name: 'NEW GMO', role: 'GMO', teams: ['KONGOWE'], tabs: [] }];
  db = fakeDb(b);
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  assert.deepEqual(db._dump('teams').map(t => t.gmo), ['NEW GMO', 'NEW GMO']);
  const t = await portalApi(db, ADMIN, 'leadersSyncUndo', {}, NOW + 1000);
  assert.deepEqual(db._dump('teams').map(x => x.gmo), ['OLD ONE', 'OLD TWO'], 'both put back, not one twice');
  assert.equal(t.restored, 2);
  assert.equal(t.skipped, 0);
});

test('a sync cut short is taken up by the next one: the first part stays undoable, and the log says when it is complete', async () => {
  const db = fakeDb(book());
  const realFrom = db.from.bind(db);
  let up = 0, failing = true;
  db.from = name => {
    const q = realFrom(name);
    if (name !== 'teams' || typeof q.upsert !== 'function') return q;
    const u = q.upsert.bind(q);
    q.upsert = (rows, opts) => { up++; return failing && up === 2 ? Promise.resolve({ data: null, error: { message: 'canceling statement due to statement timeout' } }) : u(rows, opts); };
    return q;
  };
  await assert.rejects(() => portalApi(db, ADMIN, 'leadersSync', {}, NOW), /statement timeout/);
  assert.equal(logOf(db).done, false, 'written before the first cell, and not finished');
  assert.equal(logOf(db).changes.length, 3, 'every planned cell, so nothing that was written is out of it');
  failing = false;
  const again = await portalApi(db, ADMIN, 'leadersSync', {}, NOW + 1000);
  assert.ok(again.changed >= 1 && again.changed < 3, 'the cells the first run reached are done: ' + again.changed);
  assert.equal(logOf(db).done, true);
  assert.equal(logOf(db).changes.length, 3, 'the log now holds the first part too, each cell as it was BEFORE the first run');
  const u = await portalApi(db, ADMIN, 'leadersSyncUndo', {}, NOW + 2000);
  assert.equal(u.restored, 3);
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'OLD GMO');
  assert.equal(cell(db, 'MBAGALA', 'gmo'), 'ALSO OLD');
  assert.equal(cell(db, 'TEMEKE', 'recovery'), null);
});

test('a cell the cut-short sync wrote and the next sync writes AGAIN (the code changed in between) goes back to what it was BEFORE the first of them', async () => {
  const db = fakeDb(book());
  const realFrom = db.from.bind(db);
  let up = 0, failing = true;
  db.from = name => {
    const q = realFrom(name);
    if (name !== 'teams' || typeof q.upsert !== 'function') return q;
    const u = q.upsert.bind(q);
    q.upsert = (rows, opts) => { up++; return failing && up === 2 ? Promise.resolve({ data: null, error: { message: 'canceling statement due to statement timeout' } }) : u(rows, opts); };
    return q;
  };
  await assert.rejects(() => portalApi(db, ADMIN, 'leadersSync', {}, NOW), /statement timeout/);
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'NEW GMO', 'the first group was written');
  failing = false;
  await db.from('access_codes').update({ name: 'THIRD GMO' }).eq('code', 'G1');          // the code changes before the next look
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW + 1000);
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'THIRD GMO');
  const u = await portalApi(db, ADMIN, 'leadersSyncUndo', {}, NOW + 2000);
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'OLD GMO', 'not NEW GMO, the half-way state: what it was before the first sync touched it');
  assert.equal(cell(db, 'KONGOWE', 'gmo_no'), '0700000001');
  assert.ok(u.restored >= 3);
});

test('a log written before this change (no "wrote", no "done") can still be undone, by the name cell', async () => {
  const db = fakeDb(book());
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  const log = logOf(db);
  for (const c of log.changes) delete c.wrote;
  delete log.done;
  db._dump('settings').find(x => x.key === 'LEADERS_SYNC_LOG').value = JSON.stringify(log);
  const u = await portalApi(db, ADMIN, 'leadersSyncUndo', {}, NOW + 1000);
  assert.ok(u.restored >= 3);
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'OLD GMO');
});

test('a look that could not read what the owner undid must not go on to write it: the check and the sync fail, and the sheet is not touched', async () => {
  const db = fakeDb(book());
  const before = JSON.stringify(db._dump('teams'));
  const realFrom = db.from.bind(db);
  db.from = name => {
    const q = realFrom(name);
    if (name === 'settings' && typeof q.select === 'function') {
      const sel = q.select.bind(q);
      q.select = (...a) => { const r = sel(...a); return typeof r.in === 'function' ? { ...r, in: () => Promise.resolve({ data: null, error: { message: 'connection reset' } }) } : r; };
    }
    return q;
  };
  await assert.rejects(() => portalApi(db, ADMIN, 'leadersCheck', {}, NOW), /connection reset/);
  await assert.rejects(() => portalApi(db, ADMIN, 'leadersSync', {}, NOW), /connection reset/);
  assert.equal(JSON.stringify(db._dump('teams')), before);
});

test('a NEW person saved onto a team does not inherit the last leader\'s number or ID, on this road either; a rename keeps the number; an arrival brings the number they already have', async () => {
  const b = book();
  b.access_codes = b.access_codes.filter(c => c.code !== 'G1');
  b.teams[2].gmo = 'NEW GMO'; b.teams[2].gmo_no = '0711999888'; b.teams[2].gmo_id = 'ID-NEW';           // TEMEKE: the person already has a number here
  const db = fakeDb(b);
  await portalApi(db, ADMIN, 'saveAccessCode', { code: 'G9', name: 'BRAND NEW', role: 'GMO', teams: 'KONGOWE' }, NOW);
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'BRAND NEW');
  assert.equal(cell(db, 'KONGOWE', 'gmo_no'), null, 'OLD GMO\'s number is not left beside BRAND NEW');
  assert.equal(cell(db, 'KONGOWE', 'gmo_id'), null);
  await portalApi(db, ADMIN, 'saveAccessCode', { code: 'G8', name: 'NEW GMO', role: 'GMO', teams: 'MBAGALA;TEMEKE' }, NOW + 1000);
  assert.equal(cell(db, 'MBAGALA', 'gmo'), 'NEW GMO');
  assert.equal(cell(db, 'MBAGALA', 'gmo_no'), '0711999888', 'the number the same person already has beside that role on another team');
  assert.equal(cell(db, 'MBAGALA', 'gmo_id'), 'ID-NEW');
  assert.equal(cell(db, 'TEMEKE', 'gmo_no'), '0711999888', 'and the team they already lead is untouched');
  // a rename of the same person keeps what is beside them
  const c = book();
  c.teams[0].manager = 'MARY'; c.teams[0].manager_no = '0722000111';
  c.access_codes = c.access_codes.map(x => x.code === 'M1' ? { ...x, name: 'MARY' } : x);
  const db2 = fakeDb(c);
  await portalApi(db2, ADMIN, 'saveAccessCode', { code: 'M1', oldCode: 'M1', name: 'MARY SAMPLE', role: 'MANAGER', teams: 'KONGOWE' }, NOW);
  assert.equal(cell(db2, 'KONGOWE', 'manager'), 'MARY SAMPLE');
  assert.equal(cell(db2, 'KONGOWE', 'manager_no'), '0722000111');
});

test('an access code with no name names nobody: it is never shown as the Collection or Legal officer (a code is a password)', async () => {
  const b = book();
  b.access_codes.push({ code: 'SECRET-PW-123', name: '', role: 'PMO COLLECTION', teams: ['KONGOWE', 'MBAGALA'], tabs: [] });
  b.access_codes.push({ code: 'SECRET-PW-456', name: '  ', role: 'LEGAL', teams: ['KONGOWE'], tabs: [] });
  b.teams[0].collection = 'TYPED BY HAND';
  const d = await portalApi(fakeDb(b), ADMIN, 'teams', {}, NOW);
  assert.ok(!JSON.stringify(d).includes('SECRET-PW'), 'no access code reaches the Teams list');
  assert.equal(d.rows.find(r => r.team === 'KONGOWE').collection, 'TYPED BY HAND', 'the row keeps what it says');
});

test('deleting an access code brings the sheet into line right away and says what it did: with one of two disputing codes gone, the other one leads', async () => {
  const b = book();
  b.access_codes.push({ code: 'G2', name: 'SECOND GMO', role: 'GMO', teams: ['KONGOWE'], tabs: [] });
  const db = fakeDb(b);
  const c = await portalApi(db, ADMIN, 'leadersCheck', {}, NOW);
  assert.ok(c.conflicts.some(x => x.team === 'KONGOWE' && x.col === 'gmo'), 'two codes dispute KONGOWE');
  const d = await portalApi(db, ADMIN, 'deleteAccessCode', { code: 'G2' }, NOW + 1000);
  assert.ok(d.leaders.changed >= 1, JSON.stringify(d.leaders));
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'NEW GMO');
});

test('the answer of a look carries WHICH cells the last sync changed, so a later open shows what Undo would put back; a sync that a code save ran is not forgotten', async () => {
  const b = book();
  b.access_codes = b.access_codes.filter(c => c.code !== 'G1');
  const db = fakeDb(b);
  const saved = await portalApi(db, ADMIN, 'saveAccessCode', { code: 'G9', name: 'BRAND NEW', role: 'GMO', teams: 'MBAGALA' }, NOW);
  assert.ok(saved.leaders.changed >= 1);
  const open = await portalApi(db, ADMIN, 'leadersCheck', {}, NOW + 1000);
  assert.equal(open.changed, 0, 'the book agrees');
  assert.ok(open.last && open.last.n >= 1);
  assert.ok(Array.isArray(open.last.changes) && open.last.changes.some(x => x.team === 'TEMEKE' && x.col === 'recovery' && x.now === 'RAPHAEL R'), JSON.stringify(open.last));
  assert.ok(!/ADMIN1|G9|R1/.test(JSON.stringify(open.last)), 'and no access code');
});


test('the save of one code sends rows that carry different keys in different statements: an arrival and a removal in one save blank nothing', async () => {
  const b = book();
  b.teams = [team('KONGOWE', { manager: 'MARY SAMPLE', manager_no: '0722000111', manager_id: 'ID-M' }),
    team('TEMEKE', { manager: 'SOMEBODY ELSE', manager_no: '0700000009' }),
    team('BIKO', { manager: 'MARY SAMPLE', manager_no: '0722000111', manager_id: 'ID-M' })].map(t => ({ ...t, team_code: null, zone: null }));
  b.access_codes = [b.access_codes[0], { code: 'M1', name: 'MARY SAMPLE', role: 'MANAGER', teams: ['KONGOWE', 'BIKO'], tabs: [] }];
  const db = fakeDb(b);
  const sent = [];
  const realFrom = db.from.bind(db);
  db.from = name => {
    const q = realFrom(name);
    if (name !== 'teams' || typeof q.upsert !== 'function') return q;
    const up = q.upsert.bind(q);
    q.upsert = (rows, opts) => { sent.push(Array.isArray(rows) ? rows : [rows]); return up(rows, opts); };
    return q;
  };
  // the code now holds KONGOWE and TEMEKE and no longer BIKO: TEMEKE is an arrival (name, number, ID), BIKO a removal (the name alone)
  await portalApi(db, ADMIN, 'saveAccessCode', { code: 'M1', oldCode: 'M1', name: 'MARY SAMPLE', role: 'MANAGER', teams: 'KONGOWE;TEMEKE' }, NOW);
  const own = sent.filter(batch => batch.some(r => r.team === 'TEMEKE' || r.team === 'BIKO'));
  assert.ok(own.length >= 2, 'the two kinds of write are two statements: ' + own.length);
  for (const batch of sent) assert.equal(new Set(batch.map(r => Object.keys(r).sort().join(','))).size, 1, 'one batch, one key set');
  assert.equal(cell(db, 'TEMEKE', 'manager'), 'MARY SAMPLE');
  assert.equal(cell(db, 'TEMEKE', 'manager_no'), '0722000111', 'the arrival brings the number the same person already has beside that role on another team, not the last leader\'s');
  assert.equal(cell(db, 'TEMEKE', 'manager_id'), 'ID-M');
  assert.equal(cell(db, 'BIKO', 'manager'), null, 'and the team dropped from the code is cleared');
  assert.equal(cell(db, 'KONGOWE', 'manager_no'), '0722000111', 'the team she keeps is untouched: nothing was blanked on the way');
});

test('a sync that fails after a save does not fail the save, and the answer says so', async () => {
  const b = book();
  b.access_codes = b.access_codes.filter(c => c.code !== 'G1');
  const db = fakeDb(b);
  const realFrom = db.from.bind(db);
  db.from = name => {
    const q = realFrom(name);
    if (name === 'access_codes' && typeof q.select === 'function') {
      const sel = q.select.bind(q);
      q.select = cols => {
        const b = sel(cols);
        if (cols !== 'name, role, teams') return b;                       // only the sync's own read of the codes fails
        b.order = () => b;
        b.range = () => Promise.resolve({ data: null, error: { message: 'canceling statement due to statement timeout' } });
        return b;
      };
    }
    return q;
  };
  const r = await portalApi(db, ADMIN, 'saveAccessCode', { code: 'G9', name: 'BRAND NEW', role: 'GMO', teams: 'MBAGALA' }, NOW);
  assert.equal(cell(db, 'MBAGALA', 'gmo'), 'BRAND NEW', 'the saved code still reached its own teams');
  assert.match(r.leaders.error, /statement timeout/, JSON.stringify(r.leaders));
  assert.ok(db._dump('access_codes').some(c => c.code === 'G9'), 'and the code is saved');
});


test('a sync whose cells were all written but whose log was never closed is closed by the next look', async () => {
  const db = fakeDb(book());
  const realFrom = db.from.bind(db);
  let puts = 0, failing = true;
  db.from = name => {
    const q = realFrom(name);
    if (name !== 'settings' || typeof q.upsert !== 'function') return q;
    const up = q.upsert.bind(q);
    q.upsert = (rows, opts) => { puts++; return failing && puts === 2 ? Promise.resolve({ data: null, error: { message: 'connection reset' } }) : up(rows, opts); };
    return q;
  };
  await assert.rejects(() => portalApi(db, ADMIN, 'leadersSync', {}, NOW), /connection reset/);      // the second settings write is the one that closes the log
  assert.equal(logOf(db).done, false);
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'NEW GMO', 'every cell was written');
  failing = false;
  const again = await portalApi(db, ADMIN, 'leadersSync', {}, NOW + 1000);
  assert.equal(again.changed, 0);
  assert.equal(logOf(db).done, true, 'so a later, unrelated sync does not take it up as a cut-short one');
});


test('an admin scoped to some teams neither judges nor lets go of the holds on the teams they cannot change', async () => {
  const db = fakeDb(book());
  await portalApi(db, ADMIN, 'leadersSync', {}, NOW);
  await portalApi(db, ADMIN, 'leadersSyncUndo', {}, NOW + 1000);
  const before = holdsOf(db);
  assert.ok(before.some(h => h.team === 'MBAGALA') && before.some(h => h.team === 'KONGOWE'));
  const SCOPED = { ...ADMIN, code: 'ADMIN2', teams: ['TEMEKE'] };                         // may change TEMEKE only
  const plain = await portalApi(db, SCOPED, 'leadersSync', {}, NOW + 2000);
  assert.equal(plain.changed, 0, 'TEMEKE\'s own cell is held too (it was undone with the rest)');
  assert.deepEqual(holdsOf(db).map(h => h.team + '|' + h.col).sort(), before.map(h => h.team + '|' + h.col).sort(), 'a sync that changed nothing leaves every hold as it was');
  const rel = await portalApi(db, SCOPED, 'leadersSync', { releaseHolds: true }, NOW + 3000);
  assert.equal(rel.heldReleased, 1, 'Sync now lets go of the one hold on a team they may change: TEMEKE');
  assert.equal(cell(db, 'TEMEKE', 'recovery'), 'RAPHAEL R', 'and writes only that');
  assert.equal(cell(db, 'KONGOWE', 'gmo'), 'OLD GMO', 'what they cannot change is not written');
  assert.equal(cell(db, 'MBAGALA', 'gmo'), 'ALSO OLD');
  assert.deepEqual(holdsOf(db).map(h => h.team).sort(), before.filter(h => h.team !== 'TEMEKE').map(h => h.team).sort(), 'and the holds on KONGOWE and MBAGALA, which they cannot judge, are still there');
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

test('the screen says what happened (Part 122): a failed check or sync is a card and never silence, the save and the delete of a code say what the sheet did, Sync now lets go of what was undone, and leadersCheck is a read the page may remember', async () => {
  const fs = await import('node:fs');
  const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const admin = read('public/mod/admin.js'), app = read('public/app.html');
  const view = admin.slice(admin.indexOf('VIEWS.teams = function()'), admin.indexOf('function teamsView_()'));
  assert.ok(/\.catch\(function\(e\)\{ return \{ error: /.test(view), 'a failure becomes an answer the card can say, not null');
  assert.ok(!/\.catch\(function\(\)\{ return null; \}\)/.test(view), 'and is no longer swallowed');
  const card = admin.slice(admin.indexOf('function leadersCard_('), admin.indexOf('function wireLeadersSync_('));
  assert.ok(/if \(sr\.error\)/.test(card) && card.includes('esc(sr.error)'), 'the failure is drawn, as text');
  assert.ok(card.includes('sr.held') && card.includes("esc(c.was || ") && card.includes('esc(c.now)'), 'what is held back is listed');
  assert.ok(card.includes('last.changes') && card.includes('!sr.applied'), 'the last sync\'s own cells are listed when this open did not write them');
  const wire = admin.slice(admin.indexOf('function wireLeadersSync_('), admin.indexOf('function leadersTold_('));
  assert.ok(wire.includes("srv('leadersSync', { releaseHolds: true })"), 'Sync now is the explicit "write it all again"');
  assert.ok(/holdN && !confirm\(/.test(wire), 'and says so first when it would write cells the owner undid');
  const told = admin.slice(admin.indexOf('function leadersTold_('), admin.indexOf('function agentForm('));
  assert.ok(told.includes('L.error') && told.includes('L.changed') && told.includes('L.conflicts') && told.includes('L.held'));
  assert.equal((admin.match(/leadersTold_\(r && r\.leaders\)/g) || []).length, 2, 'the save and the delete of an access code both say what the sheet did');
  assert.ok(/var READ_FNS = \{[^}]*\bleadersCheck:1/.test(app), 'leadersCheck is a read: opening Teams & Staff on a book that agrees must not wipe what the page remembers');
  assert.ok(!/var READ_FNS = \{[^}]*\bleadersSync:1/.test(app) && !/var READ_FNS = \{[^}]*\bleadersSyncUndo:1/.test(app), 'the two writes are not');
});
