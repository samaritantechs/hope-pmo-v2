// THE LEGAL TAB'S TWO NEW CARDS (24 Nov 2026, handbook Part 149).
//   "At legal: Combine these into single card (NOTICES ISSUED 1,485 TOTAL DEMANDED 1,298,367,000 FINES CHARGED 103,548,000
//    late-payment penalties )" ... "Then add a total recovery card at the end that shows each leagl's grand recovery (Notice+Calls
//    by amount and %)" -- the owner, 24 Nov 2026.
// The first card is page only (test/pages.test.mjs RUNs it). The second one is built on the server from the figures the tab already
// holds, and these tests hold what it decides, through the real dispatch: per lawyer, the notices the dashboard board's own row says
// (the lawyer's teams, the week's payments over what the notices said was owed), the calls the phone card's own lines say (customers
// at D.C 2 and above SPOKEN TO who had no notice yet, what they recovered that day over what they owed that morning), and the two
// together -- a customer who was served a notice and phoned counted ONCE, under notices, with the amount left out said; the total
// row equal to the cards above it; a side that cannot be read a null (never a nought), and the grand figure with it; the scope; the
// weeks; what it costs; and where it is NOT (today's list, the dashboard's card, the annual deck's book of notices).
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
const TODAY = '2026-07-24', MON = '2026-07-20', LAST = '2026-07-13';
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] };
const MBAGALA_GMO = { code: 'G', name: 'JUMA G', role: 'GMO', teams: ['MBAGALA'], tabs: ['legal', 'dashboard', 'present'] };

/* THE WEEK (Mon 20 to Sun 26 Jul), as the phone tests have it, plus what the notices side needs:
     customer 100 KONGOWE, served a notice on Wed 22 Jul for 100,000, paid 40,000 on Fri 24 (the ledger)
     the phone lines of the week: (24, 100) 40,000 of 100,000, spoken to by WAKILI TWO (300 s) and WAKILI ONE (130 s): she HAD a
       notice that day, so her money is in the notices column and is left out of calls; (21, 100) 10,000 of 110,000 by WAKILI ONE, two
       days BEFORE the notice: calls; (24, 200) MBAGALA 0 of 50,000 and (23, 600) MBAGALA 0 of 70,000 by WAKILI TWO; (24, 500) TANDIKA
       5,000 of 20,000 by WAKILI ALL (whose code holds every team: no row on the dashboard's board).
   last week: (15 Jul, 100) 7,000 of 120,000 by WAKILI ONE. */
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
const notice = (id, ref, team, date, arrears) => ({ id, ref, team, full_name: 'CUSTOMER ' + ref, contact: '0712000' + ref, notice_id: 'HMCL/W/' + id,
  notice_date: date, arrears_at_notice: arrears, created_at: date + 'T05:00:00Z' });
const paid = (ref, since, pid, day, amount) => ({ ref, since, payment_id: pid, paid_at: day, amount });
const tables = (extra = {}) => ({
  teams: [{ team: 'KONGOWE', team_code: 'KON1' }, { team: 'MBAGALA', team_code: 'MBA1' }, { team: 'TANDIKA', team_code: 'TAN1' }],
  settings: [{ key: 'SYSTEM_OPEN', value: 'YES' }],
  access_codes: [
    { code: 'L1', name: 'WAKILI ONE', role: 'LEGAL', teams: ['KONGOWE'], tabs: [] },
    { code: 'L2', name: 'WAKILI TWO', role: 'Legal Officer', teams: ['MBAGALA'], tabs: [] },
    { code: 'L3', name: 'WAKILI ALL', role: 'LEGAL', teams: [], tabs: [] },
    { code: 'R1', name: 'RECO ONE', role: 'PMO RECOVERY', teams: ['KONGOWE'], tabs: ['legal'] },
  ],
  demand_notices: [notice('n1', '100', 'KONGOWE', '2026-07-22', 100000)],
  notice_payment_ledger: [paid('100', '2026-07-22', 'p1', TODAY, 40000)],
  legal_phone_recovery: stamped(),
  legal_phone_days: [{ day: '2026-07-21', stamped_at: '2026-07-22T01:00:00Z' }, { day: TODAY, stamped_at: TODAY + 'T08:55:00Z' }, { day: '2026-07-15', stamped_at: '2026-07-16T01:00:00Z' }],
  ...extra,
});
const NP = { notice_payments: (store, args) => args.p_refs.map((ref, i) => ({ ref, since: args.p_dates[i], paid: 0, n: 0, last_paid: null, n_phone: 0 })), fold_notice_payments: () => 0 };
const withFn = (t = tables(), more = {}) => fakeDb(t, { rpc: { ...NP, ...LEGAL_PHONE_RPC, ...more } });
const withoutFn = (t = tables()) => fakeDb(t, { rpc: { ...NP } });
const noLedger = (t = tables()) => fakeDb(t, { rpc: { ...LEGAL_PHONE_RPC } });          // RUN-ME-040/041 not run: no payment function, no ledger
const quiet = async fn => { const w = console.warn; console.warn = () => {}; try { return await fn(); } finally { console.warn = w; } };
const grandOf = async (db, user = ADMIN, fn = 'demandNotices', args = {}) => (await portalApi(db, user, fn, args, NOW)).legal.grand;
const row = (g, name) => g.rows.find(r => r.officer.toUpperCase() === name);
/** Every figure of a row, for equality: [notices TZS, %, calls TZS, %, grand TZS, %]. */
const fig = r => [r.nRec, r.nPct, r.cRec, r.cPct, r.recovered, r.pct];

test('the Legal tab carries the grand recovery card: a lawyer a row, notices + calls = grand, each with its percentage, and a total row', async () => {
  const g = await grandOf(withFn());
  assert.equal(g.on, true); assert.equal(g.nOn, true); assert.equal(g.pOn, true); assert.equal(g.nNote, null); assert.equal(g.pNote, null);
  // WAKILI ONE: KONGOWE's customer 100 paid 40,000 of the 100,000 the notice said (40%); the call of the 21st, two days before her notice, 10,000 of 110,000.
  assert.deepEqual(fig(row(g, 'WAKILI ONE')), [40000, 40, 10000, 9.1, 50000, 23.8]);
  assert.deepEqual([row(g, 'WAKILI ONE').nOwed, row(g, 'WAKILI ONE').cOwed, row(g, 'WAKILI ONE').owed], [100000, 110000, 210000]);
  // WAKILI TWO holds MBAGALA, which has no notice: notices 0 of 0 (no percentage), her two calls of the week 0 of 120,000. Her call to customer 100 on the 24th
  // is the one the notices column already has (she HAD a notice by then), so it is not here.
  assert.deepEqual(fig(row(g, 'WAKILI TWO')), [0, null, 0, 0, 0, 0]);
  assert.deepEqual([row(g, 'WAKILI TWO').nOwed, row(g, 'WAKILI TWO').cOwed, row(g, 'WAKILI TWO').owed], [0, 120000, 120000]);
  // WAKILI ALL's code holds every team, so the dashboard's board has no row for her; the card has, from her calls: TANDIKA's customer 500, 5,000 of 20,000.
  assert.deepEqual(fig(row(g, 'WAKILI ALL')), [0, null, 5000, 25, 5000, 25]);
  assert.deepEqual(g.rows.map(r => r.officer), ['WAKILI ONE', 'WAKILI ALL', 'WAKILI TWO'], 'the most recovered first');
  // NOT on the card: a paralegal and an advocate (not lawyers), a customer at D.C 1, the name of a person who is not a lawyer's code.
  assert.ok(!g.rows.some(r => /PARA|ADV|RECO/i.test(r.officer)));
  // The total row: the notices figures are the CARD's (each customer once), the calls are the sum of the lines, the grand the two together.
  assert.deepEqual(fig(g.total), [40000, 40, 15000, 6, 55000, 15.7]);
  assert.deepEqual([g.total.nOwed, g.total.cOwed, g.total.owed], [100000, 250000, 350000]);
  assert.equal(g.shared, false, 'no team is held by two lawyers: the rows add up to the total');
  for (const k of ['nOwed', 'nRec', 'cOwed', 'cRec', 'owed', 'recovered']) assert.equal(g.rows.reduce((s, r) => s + r[k], 0), g.total[k], 'the rows add up to the total: ' + k);
  // ONE shilling once: customer 100 paid 40,000 on the 24th, was phoned that day AFTER her notice. The phone card counts it (55,000 in all); the grand card has it under
  // notices only, and says how much it left out of calls.
  assert.deepEqual(g.overlap, { customers: 1, recovered: 40000 });
  const tab = await portalApi(withFn(), ADMIN, 'demandNotices', {}, NOW);
  assert.equal(tab.legal.phone.recovered, 55000, 'the phone card, as it was');
  assert.equal(g.total.recovered, g.total.nRec + g.total.cRec); assert.notEqual(g.total.recovered, tab.legal.recovered + tab.legal.phone.recovered, 'not the two cards added: that would be 95,000');
  assert.equal(tab.legal.recovered, 40000, 'the notices card, as it was');
  assert.equal(g.total.nRec, tab.legal.recovered, 'the total row\'s notices figure IS the card above it'); assert.equal(g.total.nPct, tab.legal.pct);
});

test('a customer who was served a notice and phoned is counted once: with a second noticed customer who paid and was never phoned the numbers cannot coincide', async () => {
  const t = tables(); t.demand_notices.push(notice('n2', '150', 'KONGOWE', '2026-07-20', 80000)); t.notice_payment_ledger.push(paid('150', '2026-07-20', 'p2', '2026-07-22', 8000));
  const g = await grandOf(withFn(t));
  assert.deepEqual(fig(row(g, 'WAKILI ONE')), [48000, 26.7, 10000, 9.1, 58000, 20], 'notices 40,000 + 8,000 of 180,000; calls 10,000 of 110,000; together 58,000 of 290,000');
  assert.deepEqual(fig(g.total), [48000, 26.7, 15000, 6, 63000, 14.7], 'notices 48,000 of 180,000; calls 15,000 of 250,000; together 63,000 of 430,000');
  const tab = await portalApi(withFn(t), ADMIN, 'demandNotices', {}, NOW);
  assert.equal(tab.legal.recovered + tab.legal.phone.recovered, 103000, 'the two cards added would have said 103,000');
  assert.equal(g.total.recovered, 63000, 'the grand figure counts the 40,000 of customer 100 once');
});

test('the week arrows: any week has its own grand card, equal to the one the tab builds for this week, from the same function', async () => {
  const wk = await portalApi(withFn(), ADMIN, 'legalRecoveries', { period: 'week' }, NOW);
  const tab = await portalApi(withFn(), ADMIN, 'demandNotices', {}, NOW);
  assert.deepEqual(wk.legal.grand, tab.legal.grand, 'the list\'s reading of this week IS the tab\'s card');
  // Last week (13 to 19 Jul): customer 100 is read with TODAY's register (a notice served after that week still counts in the owed, Part 128), paid nothing that week;
  // WAKILI ONE's call of the 15th, a week before her notice: 7,000 of 120,000.
  const last = await grandOf(withFn(), ADMIN, 'legalRecoveries', { period: 'week', weekOf: '2026-07-16' });
  assert.deepEqual(fig(row(last, 'WAKILI ONE')), [0, 0, 7000, 5.8, 7000, 3.2]);
  assert.deepEqual(last.overlap, { customers: 0, recovered: 0 });
  assert.deepEqual(last.rows.map(r => r.officer), ['WAKILI ONE', 'WAKILI TWO'], 'the lawyers with nothing that week are the board\'s rows, at nought');
  assert.deepEqual(fig(last.total), [0, 0, 7000, 5.8, 7000, 3.2]);
  // The week the list is on is the week the card says.
  const lw = await portalApi(withFn(), ADMIN, 'legalRecoveries', { period: 'week', weekOf: '2026-07-16' }, NOW);
  assert.equal(lw.weekOf, LAST); assert.equal(lw.legal.mon, LAST);
});

test('a side that cannot be read is a null, not a nought, and the grand figure goes with it: the file is named', async () => {
  // RUN-ME-089 not run: the notices are read, the calls are not.
  const a = await grandOf(withoutFn());
  assert.equal(a.on, false); assert.equal(a.nOn, true); assert.equal(a.pOn, false);
  assert.match(a.pNote, /db\/RUN-ME-089-legal-recovery-by-phone\.sql/); assert.equal(a.nNote, null);
  assert.deepEqual(fig(row(a, 'WAKILI ONE')), [40000, 40, null, null, null, null]);
  assert.deepEqual(fig(a.total), [40000, 40, null, null, null, null]);
  assert.deepEqual(a.overlap, { customers: 0, recovered: 0 });
  assert.deepEqual(a.rows.map(r => r.officer), ['WAKILI ONE', 'WAKILI TWO'], 'WAKILI ALL has no row: nothing of hers is read');
  // A read of the phone table that failed: said, and not the file's name (it is run).
  const failing = () => withFn(tables(), { legal_phone_week: () => { throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }); } });
  const b = await quiet(() => grandOf(failing()));
  assert.equal(b.pOn, false); assert.match(b.pNote, /could not be read just now/); assert.doesNotMatch(b.pNote, /RUN-ME-089/);
  assert.equal(b.total.recovered, null); assert.equal(b.total.nRec, 40000);
  // The ledger not there (RUN-ME-040/041 not run): the calls are read, the notices are not.
  const c = await grandOf(noLedger());
  assert.equal(c.on, false); assert.equal(c.nOn, false); assert.equal(c.pOn, true);
  assert.match(c.nNote, /db\/RUN-ME-041a/);
  // The calls column means "customers with no notice yet when phoned" in every state, so customer 100's call of the 24th (she had a notice) is not in it
  // although her notices cannot be read: nothing is shown for her until the ledger is, and the card says which file.
  assert.deepEqual(fig(row(c, 'WAKILI ONE')), [null, null, 10000, 9.1, null, null]);
  assert.deepEqual(fig(c.total), [null, null, 15000, 6, null, null], 'no notices side, so no grand');
  // Neither: still an object that says so, never a thrown tab.
  const d = await quiet(() => grandOf(fakeDb(tables(), { rpc: {} })));
  assert.equal(d.on, false); assert.equal(d.nOn, false); assert.equal(d.pOn, false); assert.equal(d.total.recovered, null);
});

test('a team no lawyer holds is "(unassigned)", last; a team two lawyers hold counts under each in the rows, once in the total, and says so', async () => {
  const t = tables(); t.demand_notices.push(notice('n3', '700', 'TANDIKA', '2026-07-21', 30000)); t.notice_payment_ledger.push(paid('700', '2026-07-21', 'p3', '2026-07-23', 3000));
  const g = await grandOf(withFn(t));
  assert.equal(g.rows[g.rows.length - 1].officer, '(unassigned)', 'a customer on a team no legal code holds stands under (unassigned), last whatever its figures');
  assert.deepEqual(fig(g.rows[g.rows.length - 1]), [3000, 10, 0, null, 3000, 10], 'its own notices figures, no call (a nought, no percentage of nothing)');
  assert.equal(g.total.nRec, 43000); assert.equal(g.shared, false);
  // two lawyers on KONGOWE
  const t2 = tables(); t2.access_codes.push({ code: 'L4', name: 'WAKILI FOUR', role: 'LEGAL', teams: ['KONGOWE'], tabs: [] });
  const s = await grandOf(withFn(t2));
  assert.equal(row(s, 'WAKILI FOUR').nRec, 40000); assert.equal(row(s, 'WAKILI ONE').nRec, 40000, 'each lawyer\'s own row, as on the dashboard\'s board');
  assert.equal(s.total.nRec, 40000, 'the total counts the customer once: it IS the card above'); assert.equal(s.total.nOwed, 100000);
  assert.equal(s.shared, true, 'and says the rows add up to more');
  assert.equal(s.rows.reduce((x, r) => x + r.nRec, 0), 80000);
});

test('whom it shows: a viewer\'s own teams only, at the database and in the rows', async () => {
  const g = await grandOf(withFn(), MBAGALA_GMO, 'legalRecoveries', { period: 'week' });
  assert.deepEqual(g.rows.map(r => r.officer), ['WAKILI TWO'], 'only the lawyer of the viewer\'s team: the others hold other teams, and their calls are on customers of other teams');
  assert.deepEqual(fig(g.rows[0]), [0, null, 0, 0, 0, 0]);
  assert.deepEqual(g.overlap, { customers: 0, recovered: 0 });
  const tab = await grandOf(withFn(), MBAGALA_GMO);
  assert.deepEqual(tab, g, 'the tab and the list say the same to the same viewer');
  // a viewer holding no team is shown nothing (no read is made for them)
  const none = await grandOf(withFn(), { ...MBAGALA_GMO, teams: [] }, 'legalRecoveries', { period: 'week' });
  assert.deepEqual(none.rows, []); assert.equal(none.total.recovered, 0);
});

test('where it is NOT: today\'s list, the dashboard\'s own card, the annual deck\'s book of notices; and what it costs', async () => {
  const td = await portalApi(withFn(), ADMIN, 'legalRecoveries', { period: 'today' }, NOW);
  assert.equal(td.legal.grand, undefined); assert.equal(td.legal.phone, undefined);
  // the dashboard's Legal card carries the grand TOTAL since Part 151 and no lawyers' rows (see the tests at the end of this file)
  const src = read('api/_lib/portal-core.js');
  assert.deepEqual((await quiet(() => portalApi(withFn(), ADMIN, 'dashboardFull', {}, NOW))).legal.grand.rows, [], 'never the per-lawyer rows: the dashboard draws the total');
  assert.match(read('api/_lib/annual.js'), /deps\.demandNotices\(db, user, \{\}, nowMs, \{ phone: false \}\)/);
  assert.match(src, /wantPhone \? readCodesAll\(db, nowMs\)\.catch\(\(\) => null\) : null/, 'the codes are read for the tab only, never fatal, never for the annual deck');
  // trips: the tab asks for the codes the wave already reads (branchByTeam lays them over the teams): one read of them in all, the memo shared while in flight;
  // the list reads them once, as it did before the card
  const trips = async (fn, args) => { const db = withFn(), log = { n: 0, codes: 0 }; const from = db.from.bind(db), rpc = db.rpc.bind(db);
    db.from = name => { log.n++; if (name === 'access_codes') log.codes++; return from(name); }; db.rpc = (name, a) => { log.n++; return rpc(name, a); };
    await quiet(() => portalApi(db, ADMIN, fn, args, NOW)); return log; };
  assert.equal((await trips('demandNotices', {})).codes, 1, 'ONE read of the access codes on the tab: the grand card shares the one the tab makes anyway');
  assert.equal((await trips('legalRecoveries', { period: 'week' })).codes, 1, 'the list reads the codes once, as it did before the card');
  assert.equal((await trips('annualBook', { year: 2026 })).codes <= 1, true);
  for (const f of ['api/upload.js', 'api/call.js', 'api/_lib/call-core.js']) assert.doesNotMatch(read(f), /legalGrand_|legal\.grand|grand recovery/i, f + ' knows nothing of it');
});

/* THE DASHBOARD'S LEGAL CARD INCLUDES CALL RECOVERY (24 Nov 2026, handbook Part 151).
     "in summary and in the data rows of Legal Recovery widget (Imerejeshwa wiki hii / Recovered this week) at dashboard tab, should
      include call recovery" -- the owner.
   The card is fed by dashboardFull. These tests hold what the SERVER sends it: the Legal tab's own grand total (one computation:
   legalGrandTotals_ is legalGrand_ asked for the total row), today's figure beside the week's, the phone card, a side that cannot be
   read a null, a phone read that is late or fails never costing the dashboard, the scope, the weeks, and what it costs. The page's
   words are test/pages.test.mjs; the real page and its list are tools/browser-checks/portal-legal-phone.mjs section 12. */
const dashOf = (db, user = ADMIN, args = {}) => quiet(() => portalApi(db, user, 'dashboardFull', args, NOW));

test('the dashboard\'s Legal card carries the Legal tab\'s own grand TOTAL: notices + calls (a noticed customer once), today\'s and the week\'s, with the phone card beside it', async () => {
  const d = (await dashOf(withFn())).legal;
  const tab = (await portalApi(withFn(), ADMIN, 'demandNotices', {}, NOW)).legal;
  assert.deepEqual(d.grand.total, tab.grand.total, 'the dashboard\'s total IS the tab\'s total row, field for field: one computation');
  assert.deepEqual(fig(d.grand.total), [40000, 40, 15000, 6, 55000, 15.7], 'the week: 40,000 of notices, 15,000 of calls, 55,000 together');
  assert.equal(d.grand.total.tRecovered, 45000, 'today: the notices card\'s 40,000 and the 5,000 customer 500 recovered the day she was phoned; the 40,000 customer 100 paid after her notice is NOT counted twice');
  assert.deepEqual(d.grand.overlap, { customers: 1, recovered: 40000 }, 'and the amount left out of calls is said');
  assert.deepEqual([d.grand.on, d.grand.nOn, d.grand.pOn, d.grand.nNote, d.grand.pNote], [true, true, true, null, null]);
  assert.deepEqual(d.grand.rows, [], 'the total only: the dashboard draws no lawyers\' rows'); assert.equal(d.grand.shared, false);
  assert.deepEqual(d.phone, tab.phone, 'the phone card is the tab\'s'); assert.equal(d.since, tab.since, 'and so is the arrows\' floor (the earlier of the first notice\'s week and the first phone week)');
  // the notices side of the card is what it always was
  assert.deepEqual([d.tRecovered, d.recovered, d.customers, d.owed, d.pct, d.mon, d.sun, d.thisWeek], [tab.tRecovered, tab.recovered, tab.customers, tab.owed, tab.pct, tab.mon, tab.sun, tab.thisWeek]);
  assert.equal(d.tRecovered, 40000); assert.equal(d.recovered, 40000);
});

test('the dashboard\'s Legal card: a side that cannot be read is a null with its reason, never a nought; a phone read that fails or is late costs the card its calls and the dashboard nothing', async () => {
  // the phone function not run: the notices side is read, the calls and the grand figures are null, the file is named
  const off = (await dashOf(withoutFn())).legal;
  assert.deepEqual([off.grand.on, off.grand.nOn, off.grand.pOn], [false, true, false]);
  assert.equal(off.grand.total.nRec, 40000); assert.equal(off.grand.total.cRec, null); assert.equal(off.grand.total.recovered, null); assert.equal(off.grand.total.pct, null); assert.equal(off.grand.total.tRecovered, null);
  assert.match(off.grand.pNote, /RUN-ME-089/); assert.equal(off.phone.on, false);
  assert.equal(off.recovered, 40000, 'the notices card is untouched');
  // the ledger not there (the table itself: the dashboard reads it directly, as it always did): the calls are read, the notices are not
  const nl = (await dashOf(fakeDb(tables(), { missingTables: ['notice_payment_ledger'], rpc: { ...NP, ...LEGAL_PHONE_RPC } }))).legal;
  assert.deepEqual([nl.grand.on, nl.grand.nOn, nl.grand.pOn], [false, false, true]);
  assert.equal(nl.grand.total.nRec, null); assert.equal(nl.grand.total.recovered, null); assert.equal(nl.grand.total.tRecovered, null);
  assert.match(nl.grand.nNote, /RUN-ME-041a/);
  // a read that FAILS: on: null and the words, remembered for nothing
  const bad = (await dashOf(withFn(tables(), { legal_phone_week: () => { throw new Error('canceling statement due to statement timeout'); } }))).legal;
  assert.equal(bad.phone.on, null); assert.equal(bad.grand.pOn, false); assert.match(bad.grand.pNote, /could not be read just now/); assert.equal(bad.grand.total.recovered, null);
  assert.equal(bad.recovered, 40000, 'the dashboard still answers, with the notices');
  // a read that is LATE: past DASH_PHONE_BUDGET_MS the card is drawn from the notices alone and says so, and the dashboard does not wait
  const saved = process.env.DASH_PHONE_BUDGET_MS; process.env.DASH_PHONE_BUDGET_MS = '40';
  try {
    const slow = withFn(tables(), { legal_phone_week: async (store, a) => { await new Promise(r => setTimeout(r, 1500)); return LEGAL_PHONE_RPC.legal_phone_week(store, a); } });
    const t0 = Date.now(); const late = (await dashOf(slow)).legal; const took = Date.now() - t0;
    assert.ok(took < 1200, 'the dashboard did not wait for it (' + took + ' ms)');
    assert.equal(late.phone.on, null); assert.match(late.phone.note, /not read in time/); assert.equal(late.grand.pOn, false); assert.equal(late.grand.total.recovered, null);
    assert.equal(late.recovered, 40000);
  } finally { if (saved === undefined) delete process.env.DASH_PHONE_BUDGET_MS; else process.env.DASH_PHONE_BUDGET_MS = saved; }
});

test('the dashboard\'s Legal card: a viewer sees their own teams\' total, any week the week bar names is the Legal tab\'s for that week, and a viewer with no team asks for nothing', async () => {
  const mine = (await dashOf(withFn(), MBAGALA_GMO)).legal, theirs = (await portalApi(withFn(), MBAGALA_GMO, 'demandNotices', {}, NOW)).legal;
  assert.deepEqual(mine.grand.total, theirs.grand.total, 'the viewer\'s own teams: the same total as their Legal tab');
  assert.deepEqual(fig(mine.grand.total), [0, null, 0, 0, 0, 0]);
  const last = (await dashOf(withFn(), ADMIN, { weekOf: LAST })).legal, list = (await portalApi(withFn(), ADMIN, 'legalRecoveries', { period: 'week', weekOf: LAST }, NOW)).legal;
  assert.deepEqual([last.mon, last.sun], [LAST, '2026-07-19']);
  const { tRecovered: lt, ...lastTotal } = last.grand.total, { tRecovered: pt, ...listTotal } = list.grand.total;
  assert.deepEqual(lastTotal, listTotal, 'a past week through the dashboard\'s week bar: the Legal tab\'s total for that week (today\'s figure differs by design: the dashboard pins "today" to that week\'s Friday)');
  assert.deepEqual(fig(last.grand.total), [0, 0, 7000, 5.8, 7000, 3.2], 'last week: customer 100\'s one call, 7,000 of 120,000, and her notice (served after that week) still counts in owed, 100,000: the rule of every past week, Part 128');
  const calls = []; const db = withFn(); const rpc = db.rpc.bind(db); db.rpc = (name, a) => { calls.push(name + ' ' + JSON.stringify(a.p_teams)); return rpc(name, a); };
  await dashOf(db, { ...MBAGALA_GMO, teams: [] });
  assert.ok(!calls.some(c => c.startsWith('legal_phone_week')), 'a viewer who holds no team makes no phone read');
});

test('the dashboard\'s Legal card is the Legal tab\'s sum, not a second one, and costs ONE function call in the wave it already makes; nothing on an upload or a call (Part 151)', async () => {
  const src = read('api/_lib/portal-core.js');
  const totals = /function legalGrandTotals_\([\s\S]*?\n\}\n/.exec(src)[0];
  assert.match(totals, /const g = legalGrand_\(\{ on: !!card && card\.on !== false, rows: \[\] \}, card, lines, phoneCard, mon, sun\);/, 'legalGrandTotals_ IS legalGrand_, asked for the total row');
  const compute = /async function dashboardFullCompute_\([\s\S]*?\n\}\n/.exec(src)[0];
  assert.match(compute, /within_\(legalPhoneRead_\(db, user, mon, sun\), dashPhoneBudget_\(\), \{ on: null, note: DASH_PHONE_LATE_NOTE \}\),\n  \]\);/, 'the phone read rides in the dashboard\'s own wave, under its budget');
  assert.match(compute, /legalWithPhone_\(legalNoticesCard, legalPhoneCard, legalGrandTotals_\(legalNoticesCard, legalPhoneLines, legalPhoneCard, mon, sun\)\)/);
  assert.doesNotMatch(compute.replace(/\/\*[\s\S]*?\*\//g, ''), /\.noticed\b/, 'the dashboard decides nothing about which customer counts in calls: that is legalGrand_\'s one rule');
  // trips: ONE call of the phone function per load; where the function is missing, one cheap failed call, remembered for five minutes
  const log = []; const db = withFn(); const rpc = db.rpc.bind(db); db.rpc = (name, a) => { log.push(name); return rpc(name, a); };
  await dashOf(db); assert.equal(log.filter(n => n === 'legal_phone_week').length, 1);
  const log2 = []; const db2 = withoutFn(); const rpc2 = db2.rpc.bind(db2); db2.rpc = (name, a) => { log2.push(name); return rpc2(name, a); };
  await dashOf(db2); await dashOf(db2); assert.equal(log2.filter(n => n === 'legal_phone_week').length, 1, 'asked once, then remembered: no failed call on every load');
  for (const f of ['api/upload.js', 'api/call.js', 'api/_lib/call-core.js']) assert.doesNotMatch(read(f), /legalGrandTotals_|DASH_PHONE_BUDGET_MS|legal_phone_week/, f + ' knows nothing of it');
});
