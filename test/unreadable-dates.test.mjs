/* A DATE NO READER COULD READ IS COUNTED OUT LOUD (handbook Part 96, matter 4b of the owner's dates order).

     "... different excels might come with different fomarts am not sure." -- the owner, 17 Nov 2026

   A cell that held something and did not read as a date came back as NULL: the row went in with an empty date (or the moment of the upload, where the
   sheet needs one) and nothing on the screen said so. `unreadableDatesOf` (importers.js) counts those cells per upload, with a few examples, from the SAME
   column lists the importers use and the SAME reader and order. What these tests hold:

     1. a cell is counted only when the importer REALLY lost it: the count equals, over a generated file, the number of non-empty, non-placeholder date cells
        the importer turned into null (a parity with the importer itself, not a second opinion);
     2. what is NOT counted: an empty cell, the ways the sheets say "no date" on purpose (a dash, N/A, nil, none, null, TBD, hakuna, 0, "No Due Date"), a cell in any
        form the reader reads (month names, dotted, serial numbers, a clock), a month-first date in a month-first file;
     3. every upload type that carries date columns answers, and a type with none does not;
     4. examples: at most three, distinct, cut at thirty characters;
     5. the application stages (which ignore the file's own date columns) lose nothing and say 0. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const IMP = await import('../api/_lib/importers.js');

let seed = 20261117;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];

const DECK_H = ['REF#', 'FULLNAME', 'DISB DATE', 'EXPIRE DATE', 'CHRONIC DATE', 'DUE DATE', 'LAST TRANS DATE', 'DAYS ELAPSED', 'TEAM'];
const deckRow = (n, d, e, c, due, lt) => ['22' + String(n).padStart(8, '0'), 'C' + n, d, e, c, due, lt, '31', 'TEAM1'];

// ---- 3 and 2: a deck ------------------------------------------------------------------------------------------------------------------
test('a defaulters deck: each of its five date columns counts what it could not read, and nothing it could', () => {
  const rows = [DECK_H,
    deckRow(1, '7/9/2026', '10/8/2026', '10/22/2026', 'No Due Date', '11/1/2026'),                               // all read, one "no date" on purpose
    deckRow(2, 'sometime in July', '10/8/2026', '10/22/2026', '2026-09-03', '11/1/2026'),                       // one
    deckRow(3, '7/9/2026', '32/13/2026', 'soon', '2026-09-03', '-'),                                             // two more (the dash is a placeholder)
    deckRow(4, '', '', '', '', ''),                                                                              // empty
    deckRow(5, '09-Jul-2026', '8 Oct 2026', '46317', '2026.09.03', '20261101'),                                  // the new forms read
    deckRow(6, 'N/A', 'nil', 'none', 'null', '0'),                                                               // placeholders
    deckRow(7, '7/9/2026', '10/8/2026', '10/22/2026', '9/31/2026', 'TBD')];                                      // 31 September does not exist: one
  const u = IMP.unreadableDatesOf('defaulters-current', rows);
  assert.equal(u.count, 4, 'sometime in July; 32/13/2026 and soon; 9/31/2026');
  assert.deepEqual(u.examples, ['sometime in July', '32/13/2026', 'soon']);
});
test('whether a cell reads never depends on the order of the file: a date that can only be month-first reads, a date that cannot exist does not, whatever the file says', () => {
  const rows = [DECK_H,
    deckRow(1, '7/23/2026', '23/7/2026', '', '', ''),                         // read in any order (a part over twelve decides); one cell empty
    deckRow(2, '7/32/2026', '2/30/2026', '31/4/2026', '', '')];               // no such date in any order
  assert.equal(IMP.unreadableDatesOf('defaulters-initial', rows).count, 3);
  // the importer, given any order, loses exactly the same cells: 1 empty + 3 unreadable among the three first date columns
  for (const dayFirst of [true, false, null]) {
    const out = IMP.importDefaulters(rows, { snapshotType: 'initial', weekday: 'MON', snapshotDate: '2026-11-16', dateOrder: { dayFirst } });
    const nulls = out.flatMap(r => ['disb_date', 'expire_date', 'chronic_date'].map(f => r[f])).filter(v => v === null).length;
    assert.equal(nulls, 4, 'dayFirst ' + dayFirst);
  }
});

test('examples are at most three, distinct, and cut at thirty characters', () => {
  const long = 'a very long thing that is not a date at all, 123456';
  const rows = [DECK_H, ...Array.from({ length: 10 }, (_, i) => deckRow(i, 'junk' + (i % 4), long, 'junk0', '', ''))];
  const u = IMP.unreadableDatesOf('defaulters-current', rows);
  assert.equal(u.count, 30);
  assert.equal(u.examples.length, 3);
  assert.equal(new Set(u.examples).size, 3);
  assert.ok(u.examples.every(x => x.length <= 31), u.examples.join(' | '));
  assert.ok(u.examples.some(x => x.endsWith('\u2026')), 'a long cell is cut with an ellipsis');
});

// ---- 1: parity with the importer ---------------------------------------------------------------------------------------------------------
const PLACEHOLDER = /^(?:[-\u2010-\u2015_.\u00B7]+|n\/?a|nil|none|null|tbd|hakuna|0+|no\s+due\s+date)$/i;
const GOOD = ['7/9/2026', '12/31/2026', '31/12/2026', '2026-07-09', '09-Jul-2026', '9 July 2026', 'Jul 9, 2026', '09.07.2026', '2026/07/09', '20260709', '46210', '7/9/2026 14:03', '9 Julai 2026'];
const BAD = ['sometime in July', '32/13/2026', 'soon', '31/02/2026', '2026-02-30', '13/13/2026', 'July 2026', '45000.00', '12345', 'last week', '9/31/2026', 'abc 123', '99999', '1.5'];
const EMPTYISH = ['', ' ', '-', '--', 'N/A', 'n/a', 'NA', 'nil', 'None', 'NULL', 'TBD', 'hakuna', '0', 'No Due Date', 'no due date'];
test('PARITY: over 3,000 generated deck rows the count equals the number of date cells the importer really lost (non-empty, not a placeholder, and null in its output)', () => {
  const fields = { 'DISB DATE': 'disb_date', 'EXPIRE DATE': 'expire_date', 'CHRONIC DATE': 'chronic_date', 'DUE DATE': 'due_date', 'LAST TRANS DATE': 'last_trans_date' };
  const rows = [DECK_H];
  for (let i = 0; i < 3000; i++) rows.push(deckRow(i, ...Array.from({ length: 5 }, () => pick([...GOOD, ...GOOD, ...BAD, ...EMPTYISH]))));
  const out = IMP.importDefaulters(rows, { snapshotType: 'current', weekday: 'MON', snapshotDate: '2026-11-16' });
  let lost = 0; const examples = new Set();
  const byRef = new Map(out.map(r => [r.ref, r]));
  for (const r of rows.slice(1)) {
    const rec = byRef.get(r[0]);
    for (const [h, f] of Object.entries(fields)) {
      const cell = String(r[DECK_H.indexOf(h)]).trim();
      if (cell && !PLACEHOLDER.test(cell) && rec[f] === null) { lost++; examples.add(cell); }
    }
  }
  assert.ok(lost > 1000 && lost < 8000, 'the file has plenty of both: ' + lost);
  const u = IMP.unreadableDatesOf('defaulters-current', rows);
  assert.equal(u.count, lost);
  assert.ok(u.examples.every(x => examples.has(x.replace(/\u2026$/, '')) || [...examples].some(e => e.startsWith(x.slice(0, 29)))));
});
test('PARITY, the other loan-system sheets: Expected, Followup, payments and approved loans: the count is what the importer lost', () => {
  const nulls = (out, fields) => out.reduce((n, r) => n + fields.filter(f => r[f] === null).length, 0);
  const cellOf = () => pick([...GOOD, ...BAD]);
  // Expected
  const EH = ['REF#', 'FULLNAME', 'TEAM', 'DISB DATE', 'DUE DATE', 'FIRST SCHEDULE DATE', 'LAST SCHEDULE DATE', 'LAST TRANS DATE'];
  const er = [EH, ...Array.from({ length: 400 }, (_, i) => ['R' + i, 'C' + i, 'TEAM1', cellOf(), cellOf(), cellOf(), cellOf(), cellOf()])];
  const eo = IMP.importExpected(er, { snapshotType: 'today', snapshotDate: '2026-11-16' });
  const eu = IMP.unreadableDatesOf('expected-today', er);
  assert.equal(eu.count, nulls(eo, ['disb_date', 'due_date', 'first_schedule_date', 'last_schedule_date', 'last_trans_date']));
  // Followup
  const FH = ['REF#', 'FULLNAME', 'TEAM', 'DISB DATE', 'LAST TRANS', 'PROMISE DATE', 'COMMENT AT'];
  const fr = [FH, ...Array.from({ length: 400 }, (_, i) => ['R' + i, 'C' + i, 'TEAM1', cellOf(), cellOf(), cellOf(), cellOf()])];
  const fo = IMP.importFollowup(fr, { dateOrder: IMP.followupDateOrder(fr) });
  const fu = IMP.unreadableDatesOf('followup', fr);
  assert.equal(fu.count, nulls(fo, ['disb_date', 'last_trans', 'promise_date', 'comment_at']));
  // payments: ONE date per row, in the first of the spellings the file has
  const PH = ['PAYMENT DATE', 'REF NO', 'AMOUNT'];
  const pr = [PH, ...Array.from({ length: 400 }, (_, i) => [cellOf(), 'R' + i, '1000'])];
  const po = IMP.importReceivedPayments(pr, { dateOrder: IMP.paymentsDateOrder(pr) });
  const pu = IMP.unreadableDatesOf('received', pr);
  assert.equal(pu.count, po.filter(r => r.paid_at === null).length);
  // approved loans
  const LH = ['LOAN ID', 'FULLNAME', 'TEAM', 'APPROVED DATE', 'DISB DATE'];
  const lr = [LH, ...Array.from({ length: 400 }, (_, i) => ['L' + i, 'C' + i, 'TEAM1', cellOf(), cellOf()])];
  const order = IMP.loansDateOrder(lr, '2026-11-16');
  const lo = IMP.importLoans(lr, 'approved', order);
  const lu = IMP.unreadableDatesOf('loans', lr, { stage: 'approved' });
  assert.equal(lu.count, nulls(lo, ['approved_date', 'disb_date']));
  assert.ok(eu.count > 50 && fu.count > 50 && pu.count > 20 && lu.count > 50, 'every sheet had bad cells to find: ' + [eu.count, fu.count, pu.count, lu.count]);
});
test('the application stages ignore the file\'s own date columns, so they lose nothing and say 0', () => {
  const LH = ['LOAN ID', 'FULLNAME', 'TEAM', 'APPROVED DATE'];
  const rows = [LH, ['L1', 'C1', 'TEAM1', 'sometime'], ['L2', 'C2', 'TEAM1', 'never']];
  for (const stage of ['unassigned', 'assigned', 'pending_approval']) assert.deepEqual(IMP.unreadableDatesOf('loans', rows, { stage }), { count: 0, examples: [] }, stage);
  assert.equal(IMP.unreadableDatesOf('loans', rows, { stage: 'approved' }).count, 2);
});

// ---- 3: the company's own sheets -----------------------------------------------------------------------------------------------------------
test('the company\'s own sheets: a complaint, a restructure, call users, call history and a demand notice', () => {
  const CH = ['TIMESTAMP', 'REF#', 'TEAM', 'COMPLAINANT', 'RESOLVED AT'];
  const cr = (stamp, res, n) => [stamp, '2200' + n, 'TEAM1', 'A MADE UP', res];
  const c = IMP.unreadableDatesOf('complaints', [CH, cr('9 July 2026', 'Jul 10, 2026', 1), cr('Thu, 09 Jul 2026 14:03', '10.07.2026', 2), cr('last week', 'yesterday', 3), cr('24/09/2026 10:15:00', '25/09/2026 (Friday)', 4)], {});   // the last cell is cut at its first space by the importer, as always: it reads
  assert.equal(c.count, 2);
  assert.deepEqual(c.examples, ['last week', 'yesterday']);
  const RH = ['TIMESTAMP', 'REF#', 'TEAM', 'FULLNAME', 'START DATE', 'APPROVED AT'];
  assert.equal(IMP.unreadableDatesOf('restructures', [RH, ['9/7/2026', '1', 'TEAM1', 'A', 'next month', ''], ['9/7/2026', '2', 'TEAM1', 'B', '2026-10-01', '9/8/2026']]).count, 1);
  assert.equal(IMP.unreadableDatesOf('call-users', [['USER ID', 'NAME', 'REGISTERED AT', 'LAST SYNC'], ['U1', 'A', 'x y z', '9/7/2026'], ['U2', 'B', '46210', '']]).count, 1);
  assert.equal(IMP.unreadableDatesOf('call-logs', [['CALL DATE', 'SYNCED AT', 'REF#'], ['9/7/2026', 'later', '1'], ['bad', 'worse', '2']]).count, 3);
  const NH = ['REF#', 'TEAM', 'FULLNAME', 'NOTICE DATE', 'TIMESTAMP'];
  assert.equal(IMP.unreadableDatesOf('demand-notices', [NH, ['1', 'T', 'A', '9 July 2026', '9 July 2026 14:03'], ['2', 'T', 'B', 'the other day', '5/13/2026 3:00:00']]).count, 1);
});
test('a type that carries no date column worth counting answers nothing (and the comments log keeps counting its own stamps)', () => {
  for (const t of ['teams', 'access-codes', 'user-roles', 'abnormal', 'settings', 'hints', 'comments', 'staff-registry', 'pmo-deductions', 'advance-requests', 'expected-summary', 'defaulters-summary']) {
    assert.equal(IMP.unreadableDatesOf(t, [['A', 'B'], ['1', '2']]), null, t);
  }
});
test('a file with none of the date columns answers zero, and a header-only file does not throw', () => {
  assert.deepEqual(IMP.unreadableDatesOf('defaulters-current', [['REF#', 'FULLNAME'], ['1', 'A']]), { count: 0, examples: [] });
  assert.deepEqual(IMP.unreadableDatesOf('defaulters-current', [DECK_H]), { count: 0, examples: [] });
});

// ---- the pins: the counter reads the importers' own column lists ----------------------------------------------------------------------------
test('the counter reads the same column lists the importers read (one definition of which columns are dates), and adds no read', () => {
  const src = readFileSync(new URL('../api/_lib/importers.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function unreadableDatesOf('), src.indexOf('export function importDemandNotices('));
  for (const c of ['DEFAULTER_DATE_COLUMNS', 'EXPECTED_DATE_COLUMNS', 'FOLLOWUP_DATE_COLUMNS', 'PAYMENT_DATE_COLUMNS', 'LOAN_STAGE_COLUMNS.disb_date', 'LOAN_STAGE_COLUMNS.approved_date',
    'COMPLAINT_DATE_COLUMNS', 'RESTRUCTURE_DATE_COLUMNS', 'CALL_USER_DATE_COLUMNS', 'CALL_LOG_DATE_COLUMNS', 'NOTICE_DATE_COLUMNS', 'PRE_APPROVAL_STAGES']) assert.ok(body.includes(c), 'the counter names ' + c);
  assert.doesNotMatch(body, /\bawait\b|supabase|\.from\(|fetch\(/, 'pure arithmetic over the rows in hand');
  const up = readFileSync(new URL('../api/upload.js', import.meta.url), 'utf8');
  assert.match(up, /let unreadableDates = null;\s+try \{ unreadableDates = unreadableDatesOf\(type, rows, \{ stage: meta\.stage \}\); \}\s+catch \(e\) \{ unreadableDates = null; \}/, 'a count is housekeeping: it can never fail the write');
  assert.match(up, /unreadableDates: unreadableDates \|\| undefined,/);
});
test('payments: when a file carries two of the spellings of the date column, the importer reads the first non-empty one, and so does the count', () => {
  const rows = [['PAYMENT DATE', 'DATE', 'REF NO', 'AMOUNT'], ['11/10/2026', 'garbage', '1', '1000'], ['', 'also garbage', '2', '1000'], ['rubbish', '11/10/2026', '3', '1000']];
  const out = IMP.importReceivedPayments(rows);
  assert.equal(out.filter(r => r.paid_at === null).length, 2, 'the importer loses the second and third rows');
  const u = IMP.unreadableDatesOf('received', rows);
  assert.equal(u.count, 2, 'the garbage beside a date that read is not counted');
  assert.deepEqual(u.examples, ['also garbage', 'rubbish']);
});
