// LEGAL RECOVERY BY PHONE (24 Nov 2026, handbook Part 139; db/RUN-ME-089).
//   "Legal officers should be added another card of legal recovery by phone -- because they get responsible to costomers not only
//    those with noptices but also those with 2dc+ before giving out notices" ... "that card will be able to go forward and backward
//    as usual" ... "find a way to include recovery by phone of legal recovery in the sdame legal recovery slide at presentation" ...
//   "For all those customer's or guarantors of a defaulter of DC 2+ of a day initial default file, having that number called and
//    recorded in legal officer phone at minimum duration of 5 seconds, if such defaulter has recovered amount after current arrea,
//    then adds-up to recovery by phone of legal" -- the owner, 23 Nov 2026.
// THE DATABASE KEEPS THE FACTS (db/RUN-ME-089, held to a model on a real PostgreSQL by tools/db-checks/legal-phone.mjs); THE PORTAL
// DECIDES. Held here: what the portal decides (who is a lawyer, D.C 2 and above, one line a customer a day, who is named, the sums,
// the scope), on the three screens that show it (the Legal tab's second card, the list behind it for any week, the lawyers' board
// behind the Presentation's slide and the dashboard), in the three states a database can be in (the file run; not run; a read that
// failed), what each costs, and the file itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fakeDb } from './fake-db.mjs';
import { LEGAL_PHONE_RPC } from './snapshot-totals-rpc.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOW = Date.parse('2026-07-24T09:00:00Z');                    // Friday noon EAT
const TODAY = '2026-07-24', MON = '2026-07-20', SUN = '2026-07-26', LAST = '2026-07-13';
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] };
const ONE_TEAM = { code: 'G', name: 'JUMA G', role: 'GMO', teams: ['MBAGALA'], tabs: ['legal', 'dashboard', 'present'] };

/* WHAT A STAMP WOULD HAVE WRITTEN: one row for each phone that looks legal, each customer of the day's initial file it spoke to.
     24 Jul  100 KONGOWE  DC 3   WAKILI ONE 130 s on the customer's number; WAKILI TWO 300 s on the guarantor's   paid 40,000 of 100,000
     21 Jul  100 KONGOWE  DC 3   WAKILI ONE                                                                         paid 10,000 of 110,000
     24 Jul  200 MBAGALA  DC 2   WAKILI TWO                                                                         paid nothing of 50,000
     22 Jul  300 KONGOWE  DC 1   WAKILI ONE: below two installments, NOT the lawyers' (the portal decides)          paid 9,000
     24 Jul  400 KONGOWE  DC 4   a PARALEGAL's phone: the database keeps it (the letters LEGAL), the portal does not paid 8,000
     24 Jul  500 TANDIKA  DC 2   WAKILI ALL, whose code holds every team (no row on the board)                       paid 5,000 of 20,000
     23 Jul  600 MBAGALA  DC 5   WAKILI TWO, a day whose later file is not in: spoken to, nothing recovered yet      of 70,000
     24 Jul  700 KONGOWE  DC 2   an ADVOCATE's phone: a lawyer only when the LEGAL_ROLE setting names that role     paid 6,000 of 30,000
     15 Jul  100 KONGOWE  DC 3   WAKILI ONE, LAST week                                                              paid 7,000 of 120,000 */
const R = (day, ref, team, dc, uid, officer, role, phone, secs, calls, ini, cur, rec, extra = {}) => ({ day, ref, team, full_name: 'CUSTOMER ' + ref,
  contact: '0712000' + ref, guarantor_contact: '0755000' + ref, dc, ds: (12 - dc - 1) + '-12', user_id: uid, officer, role, phone, match_type: 'CUSTOMER',
  calls, secs, initial_arrears: ini, current_arrears: cur, recovered: rec, paired: true, stamped_at: day + 'T12:00:00Z', ...extra });
const stamped = () => [
  R(TODAY, '100', 'KONGOWE', 3, 'u1', 'WAKILI ONE', 'LEGAL', '0712000100', 130, 2, 100000, 60000, 40000),
  R(TODAY, '100', 'KONGOWE', 3, 'u2', 'wakili two', 'Legal Officer', '255755000100', 300, 1, 100000, 60000, 40000),
  R('2026-07-21', '100', 'KONGOWE', 3, 'u1', 'WAKILI ONE', 'LEGAL', '0799999999', 45, 1, 110000, 100000, 10000),
  R(TODAY, '200', 'MBAGALA', 2, 'u2', 'wakili two', 'Legal Officer', '0712000200', 20, 1, 50000, 50000, 0),
  R('2026-07-22', '300', 'KONGOWE', 1, 'u1', 'WAKILI ONE', 'LEGAL', '0712000300', 60, 1, 30000, 21000, 9000),
  R(TODAY, '400', 'KONGOWE', 4, 'u8', 'PARA ONE', 'PARALEGAL', '0712000400', 500, 3, 40000, 32000, 8000),
  R(TODAY, '500', 'TANDIKA', 2, 'u3', 'WAKILI ALL', 'LEGAL', '0712000500', 33, 1, 20000, 15000, 5000),
  R('2026-07-23', '600', 'MBAGALA', 5, 'u2', 'wakili two', 'Legal Officer', '0788888888', 80, 2, 70000, null, 0, { paired: false, match_type: 'GUARANTOR' }),
  R(TODAY, '700', 'KONGOWE', 2, 'u6', 'ADV ONE', 'Advocate - HQ', '0712000700', 90, 1, 30000, 24000, 6000),
  R('2026-07-15', '100', 'KONGOWE', 3, 'u1', 'WAKILI ONE', 'LEGAL', '0712000100', 70, 1, 120000, 113000, 7000),
];
const tables = (extra = {}) => ({
  teams: [{ team: 'KONGOWE', team_code: 'KON1' }, { team: 'MBAGALA', team_code: 'MBA1' }, { team: 'TANDIKA', team_code: 'TAN1' }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }],
  access_codes: [
    { code: 'L1', name: 'WAKILI ONE', role: 'LEGAL', teams: ['KONGOWE'], tabs: [] },
    { code: 'L2', name: 'WAKILI TWO', role: 'Legal Officer', teams: ['MBAGALA'], tabs: [] },
    { code: 'L3', name: 'WAKILI ALL', role: 'LEGAL', teams: [], tabs: [] },
    { code: 'R1', name: 'RECO ONE', role: 'PMO RECOVERY', teams: ['KONGOWE'], tabs: ['legal'] },
  ],
  // Customer 100 was served a notice on Wednesday 22 Jul: spoken to on the 21st she was not yet a noticed customer, on the 24th she was.
  demand_notices: [{ id: 'n1', ref: '100', team: 'KONGOWE', full_name: 'CUSTOMER 100', contact: '0712000100', notice_id: 'HMCL/W/22/07/2026', notice_date: '2026-07-22', arrears_at_notice: 100000, created_at: '2026-07-22T05:00:00Z' }],
  notice_payment_ledger: [],
  legal_phone_recovery: stamped(),
  legal_phone_days: [{ day: '2026-07-21', stamped_at: '2026-07-22T01:00:00Z' }, { day: TODAY, stamped_at: TODAY + 'T08:55:00Z' }, { day: '2026-07-15', stamped_at: '2026-07-16T01:00:00Z' }],
  ...extra,
});
const NP = { notice_payments: (store, args) => args.p_refs.map((ref, i) => ({ ref, since: args.p_dates[i], paid: 0, n: 0, last_paid: null, n_phone: 0 })), fold_notice_payments: () => 0 };
const withFn = (t = tables(), more = {}) => fakeDb(t, { rpc: { ...NP, ...LEGAL_PHONE_RPC, ...more } });
const withoutFn = (t = tables()) => fakeDb(t, { rpc: { ...NP } });
/* Counts the trips a screen makes, and what it asked the phone function. */
function watch(db) {
  const log = { trips: 0, rpcs: [], phoneArgs: [] };
  const from = db.from.bind(db), rpc = db.rpc.bind(db);
  db.from = name => { log.trips++; return from(name); };
  db.rpc = (name, args) => { log.trips++; log.rpcs.push(name); if (name === 'legal_phone_week') log.phoneArgs.push(args); return rpc(name, args); };
  return log;
}
const quiet = async fn => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };

test('the Legal tab carries a second card, recovery by phone: lawyers only, D.C 2 and above, one line a customer a day, the day\'s recovery once', async () => {
  const d = await portalApi(withFn(), ADMIN, 'demandNotices', {}, NOW);
  const p = d.legal.phone;
  assert.equal(p.on, true); assert.equal(p.note, null);
  // The lines of the week: (24, 100) 40,000 of 100,000; (21, 100) 10,000 of 110,000; (24, 200) 0 of 50,000; (24, 500) 5,000 of 20,000;
  // (23, 600) 0 of 70,000, its later file not in. NOT: 300 (DC 1), 400 (a paralegal is not a lawyer), 700 (an advocate, unless the setting says).
  assert.equal(p.recovered, 55000); assert.equal(p.owed, 350000); assert.equal(p.pct, 15.7);
  assert.equal(p.tRecovered, 45000, 'today: 40,000 + 0 + 5,000'); assert.equal(p.tOwed, 170000); assert.equal(p.tPct, 26.5);
  assert.equal(p.spoken, 5, 'five conversations with a customer on a day'); assert.equal(p.customers, 4, 'four customers: one was spoken to on two days');
  assert.equal(p.paid, 3); assert.equal(p.tSpoken, 3); assert.equal(p.tPaid, 2);
  assert.equal(p.waiting, 1, 'one line of a day whose later file is not in yet');
  assert.equal(p.noticed, 1, 'customer 100 paid on the 24th, two days after her notice'); assert.equal(p.noticedRecovered, 40000);
  assert.equal(p.stampedAt, TODAY + 'T08:55:00Z', 'the newest stamp of the week'); assert.equal(p.first, '2026-07-15');
  // The notices card is as it was, and the two share one object and one floor for the backward arrow.
  assert.equal(d.legal.mon, MON); assert.equal(d.legal.sun, SUN); assert.equal(d.legal.thisWeek, MON);
  assert.equal(d.legal.since, LAST, 'the first notice is this week\'s, the phone table reaches last week: the arrows reach it');
  assert.equal(d.legal.customers, 1, 'the notices card still counts noticed customers only');
});

test('the list behind the phone card: any week, the lawyer who spoke longest named, whose number, and the card\'s own figures', async () => {
  const wk = await portalApi(withFn(), ADMIN, 'legalRecoveries', { period: 'week' }, NOW);
  const tab = await portalApi(withFn(), ADMIN, 'demandNotices', {}, NOW);
  assert.deepEqual(wk.legal.phone, tab.legal.phone, 'the list\'s reading of this week IS the tab\'s card');
  assert.equal(wk.legal.since, tab.legal.since);
  const rows = wk.phoneRows;
  assert.deepEqual(rows.map(r => [r.day, r.ref, r.recovered]), [[TODAY, '100', 40000], ['2026-07-21', '100', 10000], [TODAY, '500', 5000], ['2026-07-23', '600', 0], [TODAY, '200', 0]],
    'the most recovered first, then by day, then by name');
  const a = rows[0];
  assert.equal(a.officer, 'wakili two', 'two lawyers spoke to her that day: the one who spoke longest is named');
  assert.deepEqual(a.others, ['WAKILI ONE']); assert.equal(a.calls, 3, 'the calls are both lawyers\''); assert.equal(a.secs, 430);
  assert.equal(a.who, 'Mdhamini / Guarantor', 'the longest call was on the guarantor\'s number on that day\'s file (255755... is 0755...), whatever tag the call carried'); assert.equal(a.phone, '255755000100');
  assert.equal(a.initial, 100000); assert.equal(a.current, 60000); assert.equal(a.dc, 3); assert.equal(a.team, 'KONGOWE'); assert.equal(a.full_name, 'CUSTOMER 100');
  assert.equal(a.noticed, true); assert.equal(rows[1].noticed, false, 'on the 21st her notice had not been served');
  assert.equal(rows[1].who, 'Namba nyingine / Other number', 'a number that is neither on the day\'s file: one recorded under Ana namba nyingine');
  assert.equal(rows[4].who, 'Mteja / Customer');
  assert.equal(rows[3].who, 'Mdhamini / Guarantor', 'a number on neither line of the file that the call app tied to her as a guarantor\'s (an older one): the tag is all there is');
  assert.equal(rows[3].paired, false); assert.equal(rows[3].current, null, 'no later file that day: no current figure, never a nought');
  assert.equal(rows.reduce((s, r) => s + r.recovered, 0), wk.legal.phone.recovered, 'the list adds up to the card');
  assert.equal(rows.reduce((s, r) => s + r.initial, 0), wk.legal.phone.owed);
  // LAST WEEK: the same answer shape for the week the arrows are on.
  const last = await portalApi(withFn(), ADMIN, 'legalRecoveries', { period: 'week', weekOf: '2026-07-16' }, NOW);
  assert.equal(last.weekOf, LAST); assert.equal(last.legal.phone.recovered, 7000); assert.equal(last.legal.phone.owed, 120000); assert.equal(last.legal.phone.spoken, 1);
  assert.equal(last.legal.phone.tRecovered, 0, 'today is not a day of last week'); assert.equal(last.legal.phone.noticed, 0);
  assert.deepEqual(last.phoneRows.map(r => [r.day, r.ref, r.officer, r.recovered]), [['2026-07-15', '100', 'WAKILI ONE', 7000]]);
  // TODAY's list has no phone card behind it, and asks nothing of the phone function.
  const db = withFn(), log = watch(db);
  const td = await portalApi(db, ADMIN, 'legalRecoveries', { period: 'today' }, NOW);
  assert.equal(td.phoneRows, undefined); assert.equal(td.legal.phone, undefined); assert.deepEqual(log.phoneArgs, []);
});

test('who is a lawyer is the boards\' own test: the LEGAL_ROLE setting adds its role, and a role that only holds the letters is never one', async () => {
  const t = tables(); t.settings.push({ key: 'LEGAL_ROLE', value: 'advocate hq' });
  const wk = await portalApi(withFn(t), ADMIN, 'legalRecoveries', { period: 'week' }, NOW);
  assert.ok(wk.phoneRows.some(r => r.ref === '700' && r.officer === 'ADV ONE' && r.recovered === 6000), 'the advocate\'s customer counts once the setting names the role');
  assert.equal(wk.legal.phone.recovered, 61000); assert.ok(!wk.phoneRows.some(r => r.ref === '400'), 'PARALEGAL still does not');
  assert.ok(wk.phoneRows.some(r => r.ref === '500'), 'and the word LEGAL still does');
  const tab = await portalApi(withFn(t), ADMIN, 'demandNotices', {}, NOW);
  assert.equal(tab.legal.phone.recovered, 61000, 'the tab reads the same setting (from the read it already makes)');
});

test('a reader sees the customers of the teams their code holds, asked of the database and held again here', async () => {
  const db = withFn(), log = watch(db);
  const wk = await portalApi(db, ONE_TEAM, 'legalRecoveries', { period: 'week' }, NOW);
  assert.deepEqual(wk.phoneRows.map(r => r.ref).sort(), ['200', '600']); assert.equal(wk.legal.phone.recovered, 0); assert.equal(wk.legal.phone.owed, 120000);
  assert.equal(log.phoneArgs.length, 1); assert.ok(Array.isArray(log.phoneArgs[0].p_teams) && log.phoneArgs[0].p_teams.includes('MBAGALA'), 'the teams go to the database');
  assert.equal(log.phoneArgs[0].p_from, MON); assert.equal(log.phoneArgs[0].p_to, SUN);
  // A database that answered more than it was asked (it must not): the other teams' rows are still dropped here.
  const loose = fakeDb(tables(), { rpc: { ...NP, legal_phone_week: (store, a) => LEGAL_PHONE_RPC.legal_phone_week(store, { ...a, p_teams: null }) } });
  const wk2 = await portalApi(loose, ONE_TEAM, 'legalRecoveries', { period: 'week' }, NOW);
  assert.deepEqual(wk2.phoneRows.map(r => r.ref).sort(), ['200', '600']);
  // The admin asks for every team: no list.
  const dbA = withFn(), logA = watch(dbA);
  await portalApi(dbA, ADMIN, 'legalRecoveries', { period: 'week' }, NOW);
  assert.equal(logA.phoneArgs[0].p_teams, null);
  // A code that holds no team at all sees nobody's customers and asks nothing.
  const dbN = withFn(), logN = watch(dbN);
  const none = await portalApi(dbN, { ...ONE_TEAM, teams: [] }, 'legalRecoveries', { period: 'week' }, NOW);
  assert.deepEqual(none.phoneRows, []); assert.equal(none.legal.phone.on, true); assert.equal(none.legal.phone.recovered, 0); assert.deepEqual(logN.phoneArgs, []);
});

test('UNTIL db/RUN-ME-089 IS RUN the card says so and names the file, nothing else on the tab changes, and the refusal is remembered five minutes', async () => {
  const db = withoutFn(), log = watch(db);
  const tab = await portalApi(db, ADMIN, 'demandNotices', {}, NOW);
  assert.equal(tab.legal.phone.on, false); assert.match(tab.legal.phone.note, /db\/RUN-ME-089-legal-recovery-by-phone\.sql/);
  assert.equal(tab.legal.phone.recovered, undefined, 'no figure at all: never a nought that reads as "nobody recovered"');
  assert.equal(tab.legal.since, MON, 'the floor is the notices\' own'); assert.equal(tab.legal.customers, 1); assert.equal(tab.count, 1, 'the register is as it was');
  assert.equal(log.phoneArgs.length, 1);
  const wk = await portalApi(db, ADMIN, 'legalRecoveries', { period: 'week' }, NOW);
  assert.equal(wk.legal.phone.on, false); assert.deepEqual(wk.phoneRows, []); assert.equal(wk.on, true, 'the notices list is as it was');
  const boards = await portalApi(db, ADMIN, 'officerBoards', {}, NOW);
  assert.equal(boards.legalPhone.on, false); assert.ok(boards.legal.length >= 2);
  assert.ok(boards.legal.every(r => r.phToday === null && r.phWeek === null && r.phSpoken === null), 'a dash on every row of the board, never a nought');
  assert.equal(log.phoneArgs.length, 1, 'the database was asked ONCE: the refusal is remembered');
  // Five minutes later it is asked again (the file may have been run meanwhile).
  const real = Date.now; Date.now = () => real() + 5 * 60 * 1000 + 1;
  try { await portalApi(db, ADMIN, 'legalRecoveries', { period: 'week' }, NOW); } finally { Date.now = real; }
  assert.equal(log.phoneArgs.length, 2);
});

test('a read that FAILED is said as a failure, is not taken for "not run", is not remembered, and never fails the screen', async () => {
  let n = 0;
  const failing = () => fakeDb(tables(), { rpc: { ...NP, legal_phone_week: () => { n++; throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }); } } });
  const db = failing();
  const tab = await quiet(() => portalApi(db, ADMIN, 'demandNotices', {}, NOW));
  assert.equal(tab.legal.phone.on, null); assert.match(tab.legal.phone.note, /could not be read just now/); assert.doesNotMatch(tab.legal.phone.note, /RUN-ME-089/);
  assert.equal(tab.count, 1, 'the register is there');
  const wk = await quiet(() => portalApi(db, ADMIN, 'legalRecoveries', { period: 'week' }, NOW));
  assert.equal(wk.legal.phone.on, null); assert.deepEqual(wk.phoneRows, []);
  assert.equal(n, 2, 'asked again the second time: a failure is not remembered');
  const boards = await quiet(() => portalApi(db, ADMIN, 'officerBoards', {}, NOW));
  assert.equal(boards.legalPhone.on, null); assert.ok(boards.legal.every(r => r.phWeek === null));
  // An answer of a shape the function does not make is a failure too, not rows.
  for (const odd of [[], { v: 2, rows: [] }, { v: 1 }, 'x', null]) {
    const d2 = await quiet(() => portalApi(fakeDb(tables(), { rpc: { ...NP, legal_phone_week: () => odd } }), ADMIN, 'legalRecoveries', { period: 'week' }, NOW));
    assert.equal(d2.legal.phone.on, null, 'an answer shaped ' + JSON.stringify(odd));
  }
});

test('the lawyers\' board (the Presentation\'s Legal slide, the dashboard\'s boards) carries each lawyer\'s recovery by phone, and it adds up to the card', async () => {
  const b = await portalApi(withFn(), ADMIN, 'officerBoards', {}, NOW);
  const by = Object.fromEntries(b.legal.map(r => [r.officer, r]));
  assert.deepEqual([by['WAKILI ONE'].phToday, by['WAKILI ONE'].phWeek, by['WAKILI ONE'].phSpoken], [0, 10000, 1], 'named on the 21st only: on the 24th her colleague spoke longer');
  assert.deepEqual([by['WAKILI TWO'].phToday, by['WAKILI TWO'].phWeek, by['WAKILI TWO'].phSpoken], [40000, 40000, 3], 'a lawyer is credited for whom they spoke to, whatever team the customer is on');
  assert.equal(b.legalPhone.on, true);
  assert.deepEqual(b.legalPhone.others, [{ officer: 'WAKILI ALL', tRecovered: 5000, recovered: 5000, spoken: 1 }], 'a lawyer whose code holds every team has no row: said beside the board');
  const tab = await portalApi(withFn(), ADMIN, 'demandNotices', {}, NOW);
  assert.equal(b.legalPhone.recovered, tab.legal.phone.recovered, 'the slide\'s week is the Legal tab\'s card');
  assert.equal(b.legal.reduce((s, r) => s + r.phWeek, 0) + b.legalPhone.others.reduce((s, o) => s + o.recovered, 0), b.legalPhone.recovered, 'the rows and the others add up to it');
  assert.equal(b.legal.reduce((s, r) => s + r.phToday, 0) + b.legalPhone.others.reduce((s, o) => s + o.tRecovered, 0), b.legalPhone.tRecovered);
  // The notices figures on the same rows are untouched.
  assert.equal(by['WAKILI ONE'].customers, 1); assert.equal(by['WAKILI ONE'].owed, 100000);
});

test('WHAT IT COSTS: one more trip on the Legal tab, on the week\'s list and on the boards; none on today\'s list; none for the annual deck', async () => {
  const trips = async (fn, args, mk) => { const db = mk(), log = watch(db); await quiet(() => portalApi(db, ADMIN, fn, args, NOW)); return { n: log.trips, phone: log.phoneArgs.length }; };
  for (const mk of [withFn, withoutFn]) {
    assert.equal((await trips('demandNotices', {}, mk)).phone, 1);
    assert.equal((await trips('legalRecoveries', { period: 'week' }, mk)).phone, 1);
    assert.equal((await trips('legalRecoveries', { period: 'week', weekOf: LAST }, mk)).phone, 1);
    assert.equal((await trips('legalRecoveries', { period: 'today' }, mk)).phone, 0);
    assert.equal((await trips('officerBoards', {}, mk)).phone, 1);
    assert.equal((await trips('annualBook', { year: 2026 }, mk)).phone, 0, 'the annual deck reads the register of notices and has no phone card: it does not ask');
    assert.equal((await trips('dashboard', {}, mk)).phone, 0, 'the dashboard\'s own load asks nothing of it');
  }
  // The tab asks for the week's rows and for nothing else new: the legal role's name comes with the settings read it already made.
  const src = read('api/_lib/portal-core.js');
  const dn = /async function demandNotices\([\s\S]*?\n\}\n/.exec(src)[0];
  assert.doesNotMatch(dn, /settingsMany\(/, 'demandNotices makes no settings read of its own for the legal role');
  assert.match(dn, /wantPhone \? legalPhoneRead_\(db, user, weekMon0, addDaysKey\(weekMon0, 6\)\) : null/);
  assert.match(src, /legalRole: String\(get\(LEGAL_ROLE_KEY\)\)\.trim\(\) \|\| LEGAL_ROLE_DEFAULT/);
  assert.match(read('api/_lib/annual.js'), /deps\.demandNotices\(db, user, \{\}, nowMs, \{ phone: false \}\)/);
  // Nothing of it on the two paths that never slow down.
  for (const f of ['api/upload.js', 'api/call.js', 'api/_lib/call-core.js']) assert.doesNotMatch(read(f), /legal_phone|legalPhone/i, f + ' knows nothing of it');
});

test('db/RUN-ME-089: what the owner pastes, held to its safety lines', () => {
  const sql = read('db/RUN-ME-089-legal-recovery-by-phone.sql');
  assert.ok(sql.length < 10000, 'a block the owner pastes stays under 10,000 characters: ' + sql.length);
  assert.ok(!/[^\x00-\x7F]/.test(sql), 'plain ASCII');
  assert.ok(sql.split('\n').every(l => !/^[ \t]/.test(l)), 'every line starts at the left edge');
  assert.equal(sql.trimEnd().split('\n').pop(), '-- END OF RUN-ME-089');
  const code = sql.split('\n').filter(l => !l.startsWith('--')).join('\n');
  // The minimum seconds is RUN-ME-088's function, word for word (this file must run whether or not that one has).
  const fn = t => /create or replace function call_min_secs\(\)[\s\S]*?\n\$\$;\n/.exec(t)[0];
  assert.equal(fn(sql), fn(read('db/RUN-ME-088-reached-is-a-conversation.sql')));
  // What the portal reads is what the table holds.
  const cols = /create table if not exists public\.legal_phone_recovery \(([\s\S]*?)primary key \(day, ref, user_id\)\);/.exec(code)[1]
    .replace(/\([^()]*\)/g, '').split(',').map(c => c.trim().split(/\s+/)[0]).filter(Boolean);
  for (const c of ['day', 'ref', 'team', 'full_name', 'contact', 'guarantor_contact', 'dc', 'ds', 'user_id', 'officer', 'role', 'phone', 'match_type', 'calls', 'secs',
    'initial_arrears', 'current_arrears', 'recovered', 'paired', 'stamped_at']) assert.ok(cols.includes(c), 'the table holds ' + c);
  assert.deepEqual(Object.keys(stamped()[0]).sort(), cols.slice().sort(), 'and this test\'s rows are the table\'s columns, no more and no fewer');
  // A conversation, a legal phone, the day's own files.
  assert.match(code, /not in \('MISSED', 'REJECTED', 'BLOCKED'\) and coalesce\(c\.duration, 0\) > m\.min/);
  assert.match(code, /having count\(\*\) = 1\), u\.role, ''\) as role/, 'the code of that name when exactly one carries it, else the registered role');
  assert.match(code, /from public\.defaulter_snapshots s where s\.snapshot_date = p_day and s\.weekday = to_char\(p_day, 'DY'\) and exists \(select 1 from per\)/,
    'the day\'s own files only (the date and the date\'s own weekday, as every screen finds a day\'s deck), and only when somebody was spoken to');
  assert.match(code, /first_value\(s\.upload_batch\) over \(partition by s\.snapshot_type, coalesce\(s\.team, ''\) order by s\.created_at desc nulls last, s\.upload_batch desc nulls last\)/,
    'which upload wins is RUN-ME-058\'s own reading');
  assert.match(read('db/RUN-ME-058-expdf-team-day-recovery-totals.sql'), /first_value\(s\.upload_batch\) over \(partition by coalesce\(s\.team, ''\)\s+order by s\.created_at desc nulls last, s\.upload_batch desc nulls last\) as win_batch\s+from public\.defaulter_snapshots s\s+where s\.snapshot_type = 'initial' and s\.snapshot_date = p\.snapshot_date and s\.weekday = p\.weekday/,
    'RUN-ME-058 reads a day\'s file the same way: the date, its weekday, the newest upload of each team');
  // The rows outlive the call logs: a day is only cleared while its call logs exist, and only today and the three days before are ever read again.
  assert.match(code, /delete from public\.legal_phone_recovery where day = p_day and exists \(select 1 from public\.call_logs c where c\.call_date = p_day\);/);
  assert.match(code, /for d in select today - g from generate_series\(0, 3\) g loop/);
  assert.match(code, /generate_series\(\(date_trunc\('week', today::timestamp\)::date - 7\)::timestamp, \(today - 4\)::timestamp, interval '1 day'\)/, 'older days: never stamped ones only, back to the Monday of last week (as far as the call logs go)');
  assert.match(code, /where not exists \(select 1 from public\.legal_phone_days y where y\.day = g::date\)/);
  // A day is read again only when something changed; one tick at a time; a failing stamp never fails the read.
  assert.match(code, /if found and x\.sig = public\.legal_phone_sig\(d\) then update public\.legal_phone_days set stamped_at = now\(\) where day = d;/);
  assert.match(code, /if not pg_try_advisory_xact_lock\(7302611\) then return jsonb_build_object\('busy', true\); end if;/);
  assert.match(code, /begin t := public\.legal_phone_tick\(interval '25 minutes', 1\); exception when others then t := jsonb_build_object\('error', sqlerrm\); end;/);
  assert.match(code, /perform cron\.schedule\('legal-phone-tick', '\*\/10 \* \* \* \*', \$job\$set statement_timeout = '20s'; select public\.legal_phone_tick\(interval '9 minutes', 1\);\$job\$\);/);
  // Private: customers' names and numbers.
  assert.match(code, /alter table public\.legal_phone_recovery enable row level security;/); assert.match(code, /alter table public\.legal_phone_days enable row level security;/);
  assert.match(code, /revoke all on public\.legal_phone_recovery, public\.legal_phone_days from anon, authenticated;/);
  assert.match(code, /array\['legal_phones\(\)', 'legal_phone_sig\(date\)', 'legal_phone_stamp\(date\)', 'legal_phone_tick\(interval, integer\)', 'legal_phone_week\(date, date, text\[\]\)'\]/);
  assert.match(code, /revoke execute on function public\.%s from public, anon, authenticated; grant execute on function public\.%s to service_role/);
  assert.doesNotMatch(code, /security definer/i);
  // The undo names everything the file makes.
  const undo = sql.split('\n').find(l => l.startsWith('-- UNDO'));
  for (const w of ["cron.unschedule('legal-phone-tick')", 'legal_phone_week(date, date, text[])', 'legal_phone_tick(interval, integer)', 'legal_phone_stamp(date)', 'legal_phone_sig(date)', 'legal_phones()',
    'drop table if exists legal_phone_recovery, legal_phone_days']) assert.ok(undo.includes(w), 'the undo names ' + w);
  // The kept check is the file's, and says how to run it.
  const chk = read('tools/db-checks/legal-phone.mjs');
  assert.match(chk, /db\/RUN-ME-089-legal-recovery-by-phone\.sql/); assert.match(chk, /NEVER point it at the live book/);
});
