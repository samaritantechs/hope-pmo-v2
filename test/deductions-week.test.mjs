/* THE WEEK'S DEDUCTION CASES, PER TEAM -- the server's half of the Presentation's Abnormal card (handbook Part 164, addendum 6).

     "at abnormal card in presentation - show weekly deduction case counts per team counts too. so that i get the impact from that view"
                                                                                                      -- the owner, 25 Nov 2026

   `deductionsWeek` answers how many PMO deduction CASES were reported in a week, in all and for each team, for the teams the person may see. These tests hold it
   through the real dispatch (`portalApi`), on a fake database:
     * a case is counted ONCE however many staff lines it carries, a line with no case id is its own case, a line with no team reads "—";
     * the window is the dashboard's week (Monday to Sunday, any day of it names it, blank or unreadable is this week) and the day a case was reported is the day the tab
       already reads (`dayOf` of `submitted_at`): the last second of Sunday is in, the first second of the next Monday is out;
     * IT IS THE TAB'S OWN COUNT: for the same week `deductions` answers the same total and the same cases for each team, so the card, the slide and the tab can never disagree;
     * scoped to the viewer's teams AT THE DATABASE (an `in` on the team), never a filter after the rows arrive;
     * the one door's gate is the PMO Deduction tab: a person who does not hold it is refused, an admin and a read-only supervisor pass;
     * without RUN-ME-043 it answers `on: false` and the note, never a failure; any other failure is still a failure;
     * what it costs (CLAUDE.md section 1): ONE read, of FOUR columns (no customer, no staff name, no amount), nothing on /api/upload or /api/call, and nothing added to the
       dashboard, whose cached answer is shared by everybody who holds the same teams whatever tabs they hold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const CORE = read('api/_lib/portal-core.js');
const NOW = Date.parse('2026-07-24T09:00:00Z');                       // Friday noon EAT: the week is Mon 20 to Sun 26 July
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] };
const HOLDER = { code: 'P', name: 'PMO ONE', role: 'PMO', teams: null, tabs: ['deduct', 'present'] };
const GMO_DED = { code: 'G', name: 'JUMA G', role: 'GMO', teams: ['KONGOWE'], tabs: ['deduct', 'dashboard', 'present'] };
const GMO_NO = { code: 'G2', name: 'ASHA G', role: 'GMO', teams: ['KONGOWE'], tabs: ['dashboard', 'present'] };

/* a case: one submission, one row for each accused staff, all sharing the case id */
const C = (id, at, team, staff = ['S1'], extra = {}) => staff.map((s, i) => ({ id: id + '-' + i, case_id: id, submitted_at: at, dept: 'RECOVERY',
  reporter: 'R ONE', team, customer: 'CUSTOMER ' + id, ref: id, staff: s, amount_taken: 1000, deduction: 1000, to_pay: 1000, ...extra }));
const book = () => ({
  pmo_deductions: [
    // THIS WEEK (Mon 20 to Sun 26 July)
    ...C('c1', '2026-07-20T08:00:00Z', 'KONGOWE'),
    ...C('c2', '2026-07-22T08:00:00Z', 'KONGOWE', ['S1', 'S2', 'S3']),           // three accused staff: ONE case
    ...C('c3', '2026-07-26T23:59:59.999Z', 'KONGOWE'),                              // the last millisecond of the week: in
    ...C('c4', '2026-07-21T08:00:00Z', 'MBAGALA'), ...C('c5', '2026-07-24T08:00:00Z', 'MBAGALA'),
    ...C('c6', '2026-07-23T08:00:00Z', 'TANDIKA'),
    // a register line with no case id: its own case, keyed by its own id; two of them are two cases
    { id: 'x1', case_id: null, submitted_at: '2026-07-22T10:00:00Z', team: 'TANDIKA', staff: 'S9' },
    { id: 'x2', case_id: null, submitted_at: '2026-07-22T10:00:00Z', team: 'TANDIKA', staff: 'S9' },
    // a case filed under no team
    ...C('c10', '2026-07-25T08:00:00Z', ''),
    // OUTSIDE IT: the last moment before the week, the first moment of the next, and last week (times as PostgREST sends them back: with milliseconds, which is how a string comparison in the fake agrees with the database's)
    ...C('c7', '2026-07-19T23:59:59.999Z', 'KONGOWE'), ...C('c8', '2026-07-27T00:00:00.000Z', 'KONGOWE'), ...C('c9', '2026-07-13T08:00:00Z', 'KONGOWE', ['S1', 'S2']),
  ],
  // the tab's own read also asks for these; the week's does not, and a test below says so
  settings: [{ key: 'DEDUCTION_REPORTER_TZS', value: '10000' }],
  teams: [{ team: 'KONGOWE' }, { team: 'MBAGALA' }, { team: 'TANDIKA' }],
});
const asked = db => { const tables = []; const f = db.from.bind(db); db.from = t => { tables.push(t); return f(t); }; return tables; };

test('it counts each CASE once, in all and for each team: three staff lines are one case, a line with no case id is its own case, no team reads a dash, the teams with most cases first', async () => {
  const a = await portalApi(fakeDb(book()), HOLDER, 'deductionsWeek', {}, NOW);
  assert.equal(a.on, true); assert.equal(a.note, null);
  assert.equal(a.weekOf, '2026-07-20'); assert.equal(a.weekEnd, '2026-07-26');
  // KONGOWE c1 c2 c3 = 3, MBAGALA c4 c5 = 2, TANDIKA c6 + x1 + x2 = 3, no team c10 = 1
  assert.deepEqual(a.teams, [{ team: 'KONGOWE', cases: 3 }, { team: 'TANDIKA', cases: 3 }, { team: 'MBAGALA', cases: 2 }, { team: '—', cases: 1 }], 'most cases first, ties by name');
  assert.equal(a.cases, 9, 'nine cases in all: c1 c2 c3 c4 c5 c6 x1 x2 c10 (the five lines of c2 and the others are not extra cases)');
  assert.equal(a.teams.reduce((s, t) => s + t.cases, 0), a.cases, 'the teams add up to the total');
  // the answer carries counts and names of teams, never a customer, a staff name, an amount or a reporter
  assert.deepEqual(Object.keys(a).sort(), ['cases', 'note', 'on', 'teams', 'weekEnd', 'weekOf']);
  for (const t of a.teams) assert.deepEqual(Object.keys(t).sort(), ['cases', 'team']);
});

test('THE WEEK: Monday to Sunday of the dashboard\'s week -- the last moment of Sunday is in, the last moment before Monday and the first moment of the next Monday are out; any day of a week names it; blank, unreadable and a week that has not begun are as the dashboard reads them', async () => {
  const db = () => fakeDb(book());
  const ids = r => r.teams.map(t => t.team + ':' + t.cases).join(' ');
  // this week: c3 (Sun 26, 23:59:59.999Z) is in; c7 (Sun 19, 23:59:59.999Z) and c8 (Mon 27, 00:00:00.000Z) are not
  const now = await portalApi(db(), HOLDER, 'deductionsWeek', {}, NOW);
  assert.equal(now.cases, 9);
  // last week (Mon 13 to Sun 19): c9 (two staff lines: one case) and c7 (the last moment of that Sunday)
  const last = await portalApi(db(), HOLDER, 'deductionsWeek', { weekOf: '2026-07-13' }, NOW);
  assert.deepEqual([last.weekOf, last.weekEnd, last.cases, ids(last)], ['2026-07-13', '2026-07-19', 2, 'KONGOWE:2']);
  // any day of a week names it (Wednesday of last week, and Sunday of it)
  for (const day of ['2026-07-15', '2026-07-19']) assert.deepEqual(await portalApi(db(), HOLDER, 'deductionsWeek', { weekOf: day }, NOW), last, 'weekOf ' + day);
  // blank, unreadable, nonsense: this week, exactly as the dashboard's week bar reads them
  for (const w of [undefined, '', 'banana', '2026-13-45x', null, 7]) assert.deepEqual(await portalApi(db(), HOLDER, 'deductionsWeek', w === undefined ? {} : { weekOf: w }, NOW), now, 'weekOf ' + String(w));
  // the next week (Mon 27 July to Sun 2 August): c8 (Mon 27, 00:00:00.000Z) is its first moment
  const next = await portalApi(db(), HOLDER, 'deductionsWeek', { weekOf: '2026-07-27' }, NOW);
  assert.deepEqual([next.weekOf, next.weekEnd, next.cases, ids(next)], ['2026-07-27', '2026-08-02', 1, 'KONGOWE:1']);
  // a week with nothing in it: a real nought and no teams, never missing
  const empty = await portalApi(db(), HOLDER, 'deductionsWeek', { weekOf: '2026-03-02' }, NOW);
  assert.deepEqual(empty, { on: true, note: null, weekOf: '2026-03-02', weekEnd: '2026-03-08', cases: 0, teams: [] });
});

test('IT IS THE TAB\'S OWN COUNT: for the same week the PMO Deduction tab answers the same total and the same number of cases for every team, for an admin and for a scoped leader', async () => {
  for (const user of [ADMIN, HOLDER, GMO_DED]) {
    const w = await portalApi(fakeDb(book()), user, 'deductionsWeek', {}, NOW);
    const tab = await portalApi(fakeDb(book()), user, 'deductions', { from: w.weekOf, to: w.weekEnd }, NOW);
    assert.equal(w.cases, tab.cases, user.code + ': the same total');
    assert.deepEqual(Object.fromEntries(w.teams.map(t => [t.team, t.cases])), Object.fromEntries(tab.summary.map(s => [s.team, s.cases])), user.code + ': the same cases for each team');
  }
  // and last week's, through the tab's own window
  const wk = await portalApi(fakeDb(book()), ADMIN, 'deductionsWeek', { weekOf: '2026-07-13' }, NOW);
  const tab = await portalApi(fakeDb(book()), ADMIN, 'deductions', { from: '2026-07-13', to: '2026-07-19' }, NOW);
  assert.deepEqual([wk.cases, wk.teams], [tab.cases, tab.summary.map(s => ({ team: s.team, cases: s.cases }))]);
  // ONE definition of a case, in one place: the tab and the week read a line's case through the same function
  assert.equal((CORE.match(/r\.case_id \|\| r\.id/g) || []).length, 1, 'the case key is written once');
  assert.match(CORE, /const dedCaseKey_ = r => r\.case_id \|\| r\.id;/);
  const tabFn = CORE.slice(CORE.indexOf('async function deductions(db, user'), CORE.indexOf('async function deductionsWeek('));
  const weekFn = CORE.slice(CORE.indexOf('async function deductionsWeek('), CORE.indexOf('/** SETTING THE EARNERS\' AMOUNT PER CASE'));
  assert.ok(/dedCaseKey_\(r\)/.test(tabFn) && (tabFn.match(/dedCaseKey_\(r\)/g) || []).length === 2, 'the tab\'s cases and its team summary');
  assert.ok(/dedCaseKey_\(r\)/.test(weekFn), 'and the week\'s count');
});

test('SCOPE, AT THE DATABASE: a leader who holds some teams is asked about those teams in the query and sees only their cases; an admin and an all-teams code see every team', async () => {
  const db = fakeDb(book());
  const sel = [], ins = [];
  const from = db.from.bind(db);
  db.from = t => { const q = from(t); if (t !== 'pmo_deductions') return q;
    const s = q.select.bind(q), i = q.in && q.in.bind(q);
    q.select = (...x) => { sel.push(x[0]); return s(...x); };
    if (i) q.in = (...x) => { ins.push([x[0], x[1]]); return i(...x); };
    return q; };
  const g = await portalApi(db, GMO_DED, 'deductionsWeek', {}, NOW);
  assert.deepEqual(g.teams, [{ team: 'KONGOWE', cases: 3 }], 'KONGOWE\'s cases and nobody else\'s');
  assert.equal(g.cases, 3);
  assert.ok(ins.length === 1 && ins[0][0] === 'team' && ins[0][1].includes('KONGOWE') && !ins[0][1].includes('MBAGALA'), 'the team filter was sent to the database: ' + JSON.stringify(ins));
  // a team nobody of theirs holds: nothing, and not an error
  const none = await portalApi(fakeDb(book()), { ...GMO_DED, teams: ['NOWHERE'] }, 'deductionsWeek', {}, NOW);
  assert.deepEqual([none.cases, none.teams], [0, []]);
  // an admin and a code over every team (teams: null) are not narrowed
  for (const u of [ADMIN, HOLDER]) assert.equal((await portalApi(fakeDb(book()), u, 'deductionsWeek', {}, NOW)).cases, 9, u.code);
});

test('THE SECOND WALL: if the database ever answered more than the viewer\'s teams (a filter that did not apply), the rows are still narrowed to the teams the person may see before they are counted -- as the tab\'s own read does', async () => {
  const db = fakeDb(book());
  const from = db.from.bind(db);
  db.from = t => { const q = from(t); if (t === 'pmo_deductions') q.in = () => q; return q; };       // the team filter does nothing
  const g = await portalApi(db, GMO_DED, 'deductionsWeek', {}, NOW);
  assert.deepEqual(g.teams, [{ team: 'KONGOWE', cases: 3 }]); assert.equal(g.cases, 3);
});

test('THE GATE IS THE PMO DEDUCTION TAB: a person who does not hold it is refused (nothing is read), an admin and a read-only supervisor pass, and so does anyone who holds it', async () => {
  const db = fakeDb(book()); const tables = asked(db);
  await assert.rejects(() => portalApi(db, GMO_NO, 'deductionsWeek', {}, NOW), e => e.status === 403 && /deductionsWeek/.test(e.message));
  assert.deepEqual(tables, [], 'refused before any table is touched');
  // holding the Presentation or the dashboard is not enough
  await assert.rejects(() => portalApi(fakeDb(book()), { ...HOLDER, tabs: ['present', 'dashboard', 'abnormal'] }, 'deductionsWeek', {}, NOW), e => e.status === 403);
  for (const u of [ADMIN, HOLDER, GMO_DED, { ...GMO_NO, readOnly: true }]) assert.equal((await portalApi(fakeDb(book()), u, 'deductionsWeek', {}, NOW)).on, true, u.code);
  assert.match(CORE, /deductionsWeek: \['deduct'\],/, 'FN_TAB names exactly the one tab');
  assert.match(CORE, /deductions, deductionsWeek, addDeduction,/, 'and the dispatch table carries it');
  // a read, never a write: the page may keep it in its cache like the register it counts
  assert.match(read('public/app.html'), /deductions:1, deductionsWeek:1,/);
  assert.ok(!/deductionsWeek/.test(read('api/_lib/audit.js')), 'it writes nothing, so it is not an audited write');
});

test('WITHOUT RUN-ME-043 it says so and does not fail; any other failure is still a failure', async () => {
  const off = await portalApi(fakeDb(book(), { missingTables: ['pmo_deductions'] }), ADMIN, 'deductionsWeek', {}, NOW);
  assert.equal(off.on, false); assert.match(off.note, /RUN-ME-043/); assert.deepEqual([off.cases, off.teams], [0, []]);
  assert.deepEqual([off.weekOf, off.weekEnd], ['2026-07-20', '2026-07-26'], 'the week is still said');
  const db2 = fakeDb(book()); const from = db2.from.bind(db2);
  db2.from = n => { if (n === 'pmo_deductions') throw new Error('relation "public.pmo_deductions" does not exist'); return from(n); };
  assert.equal((await portalApi(db2, ADMIN, 'deductionsWeek', {}, NOW)).on, false);
  // a database that is down is not "the table is not there": the caller hears it
  const db3 = fakeDb(book()); const from3 = db3.from.bind(db3);
  db3.from = n => { if (n === 'pmo_deductions') throw new Error('connection reset by peer'); return from3(n); };
  await assert.rejects(() => portalApi(db3, ADMIN, 'deductionsWeek', {}, NOW), /connection reset/);
});

test('WHAT IT COSTS: one read of one table, four narrow columns of one week\'s lines -- no customer, no staff name, no amount, no reporter, no settings, no codes, no teams table', async () => {
  const db = fakeDb(book()); const tables = asked(db);
  const cols = [];
  const from = db.from.bind(db);
  db.from = t => { const q = from(t); const s = q.select.bind(q); q.select = (...x) => { cols.push(x[0]); return s(...x); }; return q; };
  await portalApi(db, ADMIN, 'deductionsWeek', {}, NOW);
  assert.deepEqual(tables, ['pmo_deductions'], 'one table, once');
  assert.deepEqual(cols, ['case_id, id, team, submitted_at'], 'four columns, named: never *');
  // the dashboard pays nothing for it, and neither does the officer boards' answer: their answers are cached for everyone who holds the same teams, whatever tabs
  for (const name of ['dashboardFull', 'dashboardFullCompute_', 'officerBoards', 'officerBoardsUncached']) {
    const i = CORE.indexOf('async function ' + name + '(');
    assert.ok(i > 0, name + ' is where it was');
    const body = CORE.slice(i, CORE.indexOf('\nasync function ', i + 40));
    // the computing function is long (a thousand lines): read to its end, not to the first helper after its opening
    assert.ok(body.length > (name.endsWith('Compute_') || name.endsWith('Uncached') ? 3000 : 100), name + ' was read whole (' + body.length + ' characters)');
    assert.ok(!/pmo_deductions|deductionsWeek|dedCaseKey_/.test(body), name + ' reads no deductions: that answer is shared by people who do not hold the tab');
  }
  // and never on the two paths that must not slow down (CLAUDE.md section 1)
  // (the upload WRITES the register when a deductions file is uploaded: that is its own import and it is not touched; the point is that nothing of the weekly count is there)
  for (const f of ['api/upload.js', 'api/call.js', 'api/_lib/call-core.js']) assert.ok(!/deductionsWeek|dedCaseKey_/.test(read(f)), f + ' knows nothing of the weekly count');
  for (const f of ['api/call.js', 'api/_lib/call-core.js']) assert.ok(!/pmo_deductions/.test(read(f)), f + ' never reads the deductions register');
});
