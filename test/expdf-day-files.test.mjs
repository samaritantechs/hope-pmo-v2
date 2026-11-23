// THE DAY'S LIST IS THE DAY'S OWN MORNING FILE, FOUND BY ITS DATE (handbook Part 136).
//
//   "How comes staff are seeing expected defaultes with cleared like 62561111341 who are not even in the initial file of
//    today 23rd nov 2026" ... "i gave that sample customer of expected defaulter so as to solve a big problem that people
//    are complaining" ... "not just dropping but analyzing how that robust problem happens" -- the owner, 23 Nov 2026.
//
// The owner pasted the sample's own rows off the live book: team MASWA; an initial and two current rows a day from 15 to
// 18 Nov (18,000 owed, then 4,000 from the 17th), an initial row on 19 Nov (the customer paid the last 4,000 at 06:44 that
// morning), and no row since. Its dates make its cycle days Sunday and Wednesday. This file replays THAT history, with five
// neighbours, through the real list code, at each stage of a day and on each day of the week that followed.
//
// What the replay showed on the code as it was (kept here as the numbers the new assertions replace):
//   Sunday 22 Nov, before the day's later file was uploaded: the phone listed the sample as a DEFAULTER owing 18,000 and a
//   customer who had cleared on Tuesday as owing 25,000 (LAST SUNDAY's file); a customer who entered default on Thursday as
//   CLEARED; and a customer new on that morning's file not at all. With both files in: the two who had left days before
//   were still listed, CLEARED, "owing" 4,000 and 25,000, and the day's Rec % read 25.3 where the morning file's own
//   customers make it 37.9.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDb } from './fake-db.mjs';
import { DEFAULTER_GHOST_ROWS_RPC } from './snapshot-totals-rpc.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { expdfMine, expdfReport, expdfLeader } = await import('../api/_lib/expdf.js');
const { portalApi } = await import('../api/_lib/portal-core.js');

const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const wdOf = d => WD[new Date(d + 'T12:00:00Z').getUTCDay()];
const add = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const between = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

function row(c, date, type, arrears, seq = 1, status) {
  const expire = add(c.disb, 91), chronic = add(expire, 14);
  return { ref: c.ref, full_name: 'CUST ' + c.ref, contact: '07' + c.ref.slice(-8), guarantor_name: 'G ' + c.ref, guarantor_contact: '06' + c.ref.slice(-8),
    team: 'MASWA', arrears, balance: arrears, ds: c.ds || '9-12', dc: 1, days_elapsed: between(c.disb, date) - 2,
    status: status || (date >= chronic ? 'Chronic' : date > expire ? 'Expired' : 'Partial Defaulter'),
    disb_date: c.disb, expire_date: expire, chronic_date: chronic, other_inst: 34000,
    snapshot_type: type, weekday: wdOf(date), snapshot_date: date, upload_batch: type[0] + date + '#' + seq,
    created_at: date + (type === 'initial' ? 'T03:30:00Z' : seq === 1 ? 'T09:00:00Z' : 'T15:00:00Z') };
}
// Every customer is disbursed on a Sunday: their cycle days are Sunday and Wednesday.
const S = { ref: '62561111341', disb: '2026-08-16', ds: '11-12' };   // the owner's sample
const A = { ref: 'ACTIVE', disb: '2026-10-04' };                     // owes all week; pays 10,000 on Sunday 22 Nov
const B = { ref: 'CLEARS-TODAY', disb: '2026-10-11' };               // on Sunday's morning file, gone from Sunday's later file
const N = { ref: 'NEW-THIS-WEEK', disb: '2026-11-01' };              // first on a file on Thursday 19 Nov (the later file); owes since
const L = { ref: 'LEFT-TUESDAY', disb: '2026-09-20' };               // on the files to Monday and Tuesday's morning file; cleared that day
const F = { ref: 'FIRST-TODAY', disb: '2026-11-08' };                // first on any file: Sunday 22 Nov's morning file

/** The files from 15 Nov up to `upTo`. `last` says which of the last day's two files are in: 'none' | 'initial' | 'both'. */
function decks(upTo, last = 'both') {
  const out = [];
  for (let d = '2026-11-15'; d <= upTo; d = add(d, 1)) {
    const isLast = d === upTo, wantIni = !isLast || last !== 'none', wantCur = !isLast || last === 'both';
    const put = (c, a, { ini = true, cur = true, si, sc } = {}) => {
      if (wantIni && ini) out.push(row(c, d, 'initial', a.i != null ? a.i : a, 1, si));
      if (wantCur && cur) { const v = a.c != null ? a.c : a; out.push(row(c, d, 'current', v, 1, sc), row(c, d, 'current', v, 2, sc)); }
    };
    // The sample: exactly the rows the owner pasted.
    if (d === '2026-11-15') put(S, 18000, { si: 'Partial Defaulter', sc: 'Partial Defaulter' });
    if (d === '2026-11-16') put(S, 18000, { si: 'Partial Defaulter', sc: 'Expired' });
    if (d === '2026-11-17' || d === '2026-11-18') put(S, 4000, { si: 'Expired', sc: 'Expired' });
    if (d === '2026-11-19') put(S, 4000, { cur: false, si: 'Expired' });
    put(A, d === '2026-11-22' ? { i: 30000, c: 20000 } : 30000);
    if (d < '2026-11-22') put(B, 12000); else if (d === '2026-11-22') put(B, 12000, { cur: false });
    if (d === '2026-11-19') put(N, 9000, { ini: false }); else if (d > '2026-11-19') put(N, 9000);
    if (d <= '2026-11-16') put(L, 25000); else if (d === '2026-11-17') put(L, 25000, { cur: false });
    if (d >= '2026-11-22') put(F, 7000);
  }
  return out;
}
const tablesFor = (upTo, last) => ({
  teams: [{ team: 'MASWA', zone: 'LAKE', team_code: 'MAS 1', gmo: 'GMO M', manager: 'MANAGER M', bike: 'BIKE M', opm: 'OPM M', recovery: 'REC M', credit: 'CA M', expected: 'EARLY M' }],
  settings: [], access_codes: [], roles: [], defaulter_snapshots: decks(upTo, last), repayment_snapshots: [], followup_status: [], followup_comments: [], call_logs: [], call_users: [] });
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['upload', 'settings', 'expdfrep'] };
const TEAM = { code: 'T', name: 'SOMEBODY', role: 'GMO', teams: ['MASWA'], tabs: [] };
/** A database that counts what is asked of it, and has the function the all-time ghost used to ask (so "not asked" is a fact, not an absence). */
function counting(t) {
  const base = fakeDb(t, { rpc: DEFAULTER_GHOST_ROWS_RPC });
  const seen = { from: 0, rpc: 0, tables: {} };
  return { seen, db: { from(n) { seen.from++; seen.tables[n] = (seen.tables[n] || 0) + 1; return base.from(n); }, rpc(n, a) { seen.rpc++; return base.rpc(n, a); }, _dump: n => base._dump(n) } };
}
const at = iso => Date.parse(iso);
const line = r => [r.ref, r.status, r.arrears, r.initial, r.recovered];
const SUN = '2026-11-22';

test('BOTH FILES OF THE DAY IN: the list is the morning file\'s customers -- the sample and the Tuesday leaver are not on it, on the phone, the tab, the report or a leader\'s card', async () => {
  const NOW = at('2026-11-22T10:00:00Z');
  const { db, seen } = counting(tablesFor(SUN, 'both'));
  const phone = await expdfMine(db, TEAM, { scope: 'team' }, NOW);
  assert.deepEqual(phone.rows.map(line), [
    ['ACTIVE', 'DEFAULTER', 20000, 30000, 10000], ['NEW-THIS-WEEK', 'DEFAULTER', 9000, 9000, 0], ['FIRST-TODAY', 'DEFAULTER', 7000, 7000, 0],
    ['CLEARS-TODAY', 'CLEARED', 0, 12000, 12000]], 'the four of this morning\'s file: three owing, one cleared today and kept for verification');
  assert.deepEqual([phone.totals.customers, phone.totals.initial, phone.totals.recovered, phone.totals.pct], [4, 58000, 22000, 37.9],
    '37.9%: it read 25.3% while the two who had left days before were counted as owing 29,000 with nothing recovered');
  assert.equal(phone.date, SUN); assert.equal(phone.diag.paired, true);
  assert.equal(seen.rpc, 0, 'the all-time lookup is not asked');
  const tab = await portalApi(fakeDb(tablesFor(SUN, 'both'), { rpc: DEFAULTER_GHOST_ROWS_RPC }), ADMIN, 'expectedDefaulters', {}, NOW);
  assert.deepEqual(tab.rows.map(line).sort(), phone.rows.map(line).sort(), 'the tab is the same four, the same figures');
  const rep = await expdfReport(fakeDb(tablesFor(SUN, 'both'), { rpc: DEFAULTER_GHOST_ROWS_RPC }), ADMIN, {}, NOW);
  assert.deepEqual([rep.totals.customers, rep.totals.initial, rep.totals.recovered, rep.totals.pct], [4, 58000, 22000, 37.9], 'and so is the report');
  for (const [role, leader] of [['GMO', 'GMO M'], ['MANAGER', 'MANAGER M'], ['BIKE', 'BIKE M']]) {
    const card = await expdfLeader(fakeDb(tablesFor(SUN, 'both'), { rpc: DEFAULTER_GHOST_ROWS_RPC }), ADMIN, { role, leader }, NOW);
    assert.ok(!card.rows.some(r => r.ref === S.ref || r.ref === L.ref), role + ': nobody who left the files on an earlier day is on a leader\'s card');
  }
});

test('THE MORNING FILE ONLY: the list is this morning\'s file -- each customer owing the morning\'s arrears, a new one ON it, nobody CLEARED, nobody from last week', async () => {
  const NOW = at('2026-11-22T05:00:00Z');
  const { db, seen } = counting(tablesFor(SUN, 'initial'));
  const phone = await expdfMine(db, TEAM, { scope: 'team' }, NOW);
  assert.deepEqual(phone.rows.map(line), [
    ['ACTIVE', 'DEFAULTER', 30000, 30000, 0], ['CLEARS-TODAY', 'DEFAULTER', 12000, 12000, 0], ['NEW-THIS-WEEK', 'DEFAULTER', 9000, 9000, 0], ['FIRST-TODAY', 'DEFAULTER', 7000, 7000, 0]],
    'it used to be LAST SUNDAY\'s file: the sample owing 18,000, the Tuesday leaver 25,000, the Thursday entrant CLEARED and the new customer missing');
  assert.equal(phone.date, SUN, 'dated today: the strip says Leo');
  assert.equal(phone.hasBaseline, true); assert.equal(phone.diag.paired, false);
  assert.deepEqual([phone.totals.customers, phone.totals.initial, phone.totals.recovered], [4, 58000, 0]);
  assert.equal(seen.rpc, 0);
  const tab = await portalApi(fakeDb(tablesFor(SUN, 'initial'), { rpc: DEFAULTER_GHOST_ROWS_RPC }), ADMIN, 'expectedDefaulters', {}, NOW);
  assert.deepEqual(tab.rows.map(line).sort(), phone.rows.map(line).sort(),
    'the tab too: it used to read the new customer of this morning\'s file as CLEARED with 7,000 recovered');
  const rep = await expdfReport(fakeDb(tablesFor(SUN, 'initial'), { rpc: DEFAULTER_GHOST_ROWS_RPC }), ADMIN, {}, NOW);
  assert.deepEqual([rep.totals.customers, rep.totals.initial, rep.totals.recovered], [4, 58000, 0]);
});

test('NO FILE OF THE DAY YET: the freshest earlier file stands in, dated as such -- not the same weekday of last week', async () => {
  const NOW = at('2026-11-22T02:00:00Z');
  const { db, seen } = counting(tablesFor('2026-11-21', 'both'));
  const phone = await expdfMine(db, TEAM, { scope: 'team' }, NOW);
  assert.deepEqual(phone.rows.map(line), [
    ['ACTIVE', 'DEFAULTER', 30000, 30000, 0], ['CLEARS-TODAY', 'DEFAULTER', 12000, 12000, 0], ['NEW-THIS-WEEK', 'DEFAULTER', 9000, 9000, 0]],
    'who is in default on Saturday\'s last file, at its figures; the sample and the Tuesday leaver are not on it');
  assert.equal(phone.date, '2026-11-21', 'the answer says it is Saturday\'s file: the phone\'s strip shows 21/11, not Leo');
  assert.equal(phone.hasBaseline, false, 'and that today\'s initial list is not in, so recoveries read 0');
  assert.equal(seen.rpc, 0);
  const tab = await portalApi(fakeDb(tablesFor('2026-11-21', 'both'), { rpc: DEFAULTER_GHOST_ROWS_RPC }), ADMIN, 'expectedDefaulters', {}, NOW);
  assert.deepEqual(tab.rows.map(line).sort(), phone.rows.map(line).sort());
});

test('THE SAMPLE\'S WEEK: listed on its own cycle days while it was on the files, cleared on the day it cleared, on no day\'s list after it', async () => {
  // Each day read at its close (both files in), as the report reads a past day.
  const seenOn = {};
  for (let d = '2026-11-15'; d <= '2026-11-25'; d = add(d, 1)) {
    const t = tablesFor(d > SUN ? SUN : d, 'both');
    if (d > SUN) for (let x = add(SUN, 1); x <= d; x = add(x, 1)) for (const [c, a] of [[A, 20000], [N, 9000], [F, 7000]]) {
      t.defaulter_snapshots.push(row(c, x, 'initial', a), row(c, x, 'current', a, 1), row(c, x, 'current', a, 2));
    }
    const NOW = at(d + 'T15:30:00Z');
    const phone = await expdfMine(fakeDb(t, { rpc: DEFAULTER_GHOST_ROWS_RPC }), TEAM, { scope: 'team' }, NOW);
    const tab = await portalApi(fakeDb(t, { rpc: DEFAULTER_GHOST_ROWS_RPC }), ADMIN, 'expectedDefaulters', {}, NOW);
    const p = phone.rows.find(r => r.ref === S.ref), q = tab.rows.find(r => r.ref === S.ref);
    seenOn[d] = [p ? p.status + ' ' + p.arrears + '/' + p.recovered : '-', q ? q.status + ' ' + q.arrears + '/' + q.recovered : '-'];
  }
  assert.deepEqual(seenOn, {
    '2026-11-15': ['DEFAULTER 18000/0', 'DEFAULTER 18000/0'],   // Sunday: its cycle day, owing
    '2026-11-16': ['-', 'EXPIRED 18000/0'],                     // Monday: not its day on the phone; on the tab's book
    '2026-11-17': ['-', 'EXPIRED 4000/0'],
    '2026-11-18': ['EXPIRED 4000/0', 'EXPIRED 4000/0'],         // Wednesday: its cycle day, owing 4,000
    '2026-11-19': ['-', 'CLEARED 0/4000'],                      // Thursday: on the morning file, gone from the later one: CLEARED that day, 4,000 recovered
    '2026-11-20': ['-', '-'],                                   // and from the next day on it is on no file ...
    '2026-11-21': ['-', '-'],
    '2026-11-22': ['-', '-'],                                   // ... so not on Sunday's list (it was, CLEARED "owing" 4,000, every Sunday and Wednesday for ever)
    '2026-11-23': ['-', '-'],                                   // nor on Monday 23 Nov, the day the owner asked
    '2026-11-24': ['-', '-'],
    '2026-11-25': ['-', '-'],
  });
  // THE WEEK'S REPORT of 16 to 22 Nov keeps the sample where it belongs: on Wednesday, the one cycle day of the week it was on the files.
  const NOW = at('2026-11-22T15:30:00Z');
  const card = await expdfLeader(fakeDb(tablesFor(SUN, 'both'), { rpc: DEFAULTER_GHOST_ROWS_RPC }), ADMIN, { role: 'GMO', leader: 'GMO M', period: 'week' }, NOW);
  const all = [];
  for (const [role, leader] of [['GMO', 'GMO M'], ['MANAGER', 'MANAGER M'], ['BIKE', 'BIKE M']]) {
    const c = role === 'GMO' ? card : await expdfLeader(fakeDb(tablesFor(SUN, 'both'), { rpc: DEFAULTER_GHOST_ROWS_RPC }), ADMIN, { role, leader, period: 'week' }, NOW);
    for (const r of c.rows) if (r.ref === S.ref) all.push([role, Object.keys(r.byDay)]);
  }
  assert.deepEqual(all.map(x => x[1]).flat(), ['2026-11-18'], 'the week keeps the customer on the day they were worked: a cleared customer is not lost, they are on their own day');
});

test('THE PHONE\'S COST: fewer reads than before in every stage, and never the all-time lookup', async () => {
  const reads = async (upTo, last, iso) => { const { db, seen } = counting(tablesFor(upTo, last)); await expdfMine(db, TEAM, { scope: 'team' }, at(iso)); return seen; };
  const pair = await reads(SUN, 'both', '2026-11-22T10:00:00Z'), morning = await reads(SUN, 'initial', '2026-11-22T05:00:00Z'), none = await reads('2026-11-21', 'both', '2026-11-22T02:00:00Z');
  // Before this change the same three calls made 7 round trips each: two reads for each of two decks (the date, then the rows), the teams,
  // the rotation's settings, and the all-time lookup. A ceiling, not a target: lower is welcome, higher needs its reason beside it (CLAUDE.md section 1).
  assert.deepEqual([pair.from + pair.rpc, morning.from + morning.rpc, none.from + none.rpc], [6, 5, 5], 'both files: 6; the morning file only: 5; neither: 5');
  assert.deepEqual([pair.rpc, morning.rpc, none.rpc], [0, 0, 0]);
  assert.deepEqual([pair.tables.defaulter_snapshots, morning.tables.defaulter_snapshots, none.tables.defaulter_snapshots], [4, 3, 3],
    'two one-row reads say which files the day has, then only the files needed are read');
});

test('A MONTH is its first deck and the freshest file: a customer of the first deck who left has cleared in the month; one who left before it began is not listed', async () => {
  const mk = (ref, disb) => ({ ref, disb });
  const M1 = mk('MONTH-OWES', '2026-09-06'), M2 = mk('MONTH-CLEARED', '2026-09-13'), M3 = mk('LEFT-IN-OCTOBER', '2026-08-02'), M4 = mk('ENTERED-MID-MONTH', '2026-10-25');
  const rows = [];
  const both = (c, d, a) => rows.push(row(c, d, 'initial', a), row(c, d, 'current', a, 1));
  both(M3, '2026-10-20', 50000);                                                    // on a file in October, on none since
  for (const d of ['2026-11-02', '2026-11-09', '2026-11-22']) both(M1, d, d === '2026-11-22' ? 6000 : 10000);
  for (const d of ['2026-11-02', '2026-11-09']) both(M2, d, 8000);                  // on the month's first deck; on no file after the 9th
  for (const d of ['2026-11-12', '2026-11-22']) both(M4, d, 3000);                  // not on the month's first deck
  const t = { ...tablesFor('2026-11-14', 'both'), defaulter_snapshots: rows };
  const rep = await expdfReport(fakeDb(t, { rpc: DEFAULTER_GHOST_ROWS_RPC }), ADMIN, { monthly: true }, at('2026-11-22T15:30:00Z'));
  const got = {};
  for (const sec of rep.sections) for (const lead of sec.rows) got[sec.role + ' ' + lead.leader] = [lead.customers, lead.initial, lead.recovered];
  assert.deepEqual([rep.totals.customers, rep.totals.initial, rep.totals.recovered, rep.totals.arrears], [3, 21000, 12000, 9000],
    'M1 10,000 -> 6,000 (4,000 back), M2 8,000 -> cleared (8,000 back), M4 3,000 with no baseline (0 back); the one who left in October is not in November\'s book: ' + JSON.stringify(got));
  assert.equal(rep.baseDate, '2026-11-02'); assert.equal(rep.period, 'month');
});

test('a customer the file still flags is never listed under one who has cleared, whatever the figures say', async () => {
  const NOW = at('2026-11-22T10:00:00Z');
  const t = tablesFor(SUN, 'both');
  // FLAGGED: the day's later file still calls them Expired though the figure reads below zero. The file's word stands: still a customer to call,
  // so above the cleared one -- a plain "largest arrears first" would put a figure of -100 under the cleared customer's 0.
  const FL = { ref: 'FLAGGED-BELOW-ZERO', disb: '2026-08-09' };
  t.defaulter_snapshots.push(row(FL, SUN, 'initial', 6000, 1, 'Expired'), row(FL, SUN, 'current', -100, 1, 'Expired'), row(FL, SUN, 'current', -100, 2, 'Expired'));
  const phone = await expdfMine(fakeDb(t, { rpc: DEFAULTER_GHOST_ROWS_RPC }), TEAM, { scope: 'team' }, NOW);
  const order = phone.rows.map(r => r.ref), st = Object.fromEntries(phone.rows.map(r => [r.ref, r.status]));
  assert.equal(st['FLAGGED-BELOW-ZERO'], 'EXPIRED'); assert.equal(st['CLEARS-TODAY'], 'CLEARED');
  assert.ok(order.indexOf('FLAGGED-BELOW-ZERO') < order.indexOf('CLEARS-TODAY'), 'still to be called, so above the cleared: ' + order.join(', '));
  assert.equal(order[order.length - 1], 'CLEARS-TODAY', 'the cleared customer is last');
});

test('the statements the phone sends are the shape they always were: a file is asked for by its type, the weekday of its date, its date and the team', () => {
  const src = readFileSync(new URL('../api/_lib/expdf.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(src, /latestSnapshot\(db, T_, \{ snapshot_type: type, weekday: weekdayOfKey\(date\) \}, \{ onDate: date, teams: user\.teams/,
    'the weekday is the date\'s own, so the read rides the (type, weekday, date, team) index it always rode, straight to the team\'s rows');
  assert.ok(!/defaulter_ghost_rows|ghostRowsFor_|GHOST_/.test(src), 'and nothing of the all-time lookup is left in the list code');
  const core = src.slice(src.indexOf('export async function expdfCore('), src.indexOf('const WD_ = '));
  assert.equal((core.match(/latestSnapshotDate\(db, T_, \{ snapshot_type: '(initial|current)' \}, \{ notAfter: today \}\)/g) || []).length, 2,
    'which files the day has is two one-row reads, by type alone: never "the same weekday, whenever it last came round"');
  const portal = readFileSync(new URL('../api/_lib/portal-core.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/ghostRowsFor_|defaulter_ghost_rows'/.test(portal.replace(/\/\/[^\n]*/g, '')), 'nor in the portal');
});
