// The two admin-sheet importers: the workbook's Access Codes / User Roles tabs become
// access_codes / roles rows, managed by re-uploading the sheet instead of writing SQL.

import test from 'node:test';
import assert from 'node:assert/strict';

// upload.js builds its Supabase client at import time; these keep that from throwing in
// tests that only exercise its pure helpers.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { importAccessCodes, importUserRoles, importComments, commentId, commentsDateOrder }
  = await import('../api/_lib/importers.js');
const { stampOrNull, inferDayFirst, dateOrNull } = await import('../api/_lib/parse.js');

test('importAccessCodes: ALL -> null teams, comma lists -> arrays, incomplete rows skipped', () => {
  const rows = [
    ['CODE', 'NAME', 'ROLE', 'TEAMS', 'TABS'],
    ['AB12', 'Asha', 'ADMIN', 'ALL', 'upload, settings'],
    ['CD34', 'Juma', 'GMO', 'KONGOWE, MBAGALA', ''],
    ['', 'NoCode', 'USER', 'ALL', ''],                 // no code -- skipped
    ['EF56', '', 'USER', 'ALL', ''],                   // no name -- skipped (column is NOT NULL)
    ['GH78', 'Neema', '', 'ALL', ''],                  // no role -- skipped (column is NOT NULL)
  ];
  const out = importAccessCodes(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { code: 'AB12', name: 'Asha', role: 'ADMIN', teams: null, tabs: ['upload', 'settings'] });
  assert.deepEqual(out[1].teams, ['KONGOWE', 'MBAGALA']);
  assert.deepEqual(out[1].tabs, []);
});

test('importUserRoles: role + tabs list, blank rows dropped', () => {
  const rows = [
    ['ROLE', 'TABS'],
    ['ADMIN', 'dashboard, followup, upload, settings'],
    ['GMO', 'followup; promises'],                     // semicolons accepted too
    ['', ''],
  ];
  const out = importUserRoles(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].tabs, ['dashboard', 'followup', 'upload', 'settings']);
  assert.deepEqual(out[1], { role: 'GMO', tabs: ['followup', 'promises'] });
});

// A loan is ONE row whose stage moves. As a plain insert it was not: uploading Unassigned
// then Assigned then Approved for the same loan made three rows, and re-uploading Approved
// doubled the sales figure with nothing on screen to say so.
test('a loan keeps its identity across stages and re-uploads', async () => {
  const { importLoans, loanIdentity } = await import('../api/_lib/importers.js');
  const rows = s => [['LOAN ID', 'DOCKET#', 'TRACK#', 'FULLNAME', 'CONTACT#', 'TEAM', 'PRINCIPAL AMT'],
    ['L-100', 'D-1', '1', 'AMINA H', '0712000001', 'KONGOWE', '300000']];

  const asUnassigned = importLoans(rows(), 'unassigned');
  const asApproved = importLoans(rows(), 'approved');
  // Same loan, later stage -> the SAME row, so the second upload moves it instead of cloning it.
  assert.equal(asUnassigned[0].id, asApproved[0].id);
  assert.equal(asApproved[0].stage, 'approved');
  // Re-uploading the identical file is the same row again -- this is what stops sales doubling.
  assert.equal(importLoans(rows(), 'approved')[0].id, asApproved[0].id);

  // A DIFFERENT loan for the same customer is a different row.
  const repeat = importLoans([['LOAN ID', 'FULLNAME', 'CONTACT#'], ['L-200', 'AMINA H', '0712000001']], 'approved');
  assert.notEqual(repeat[0].id, asApproved[0].id);

  // Identity falls back the way the migration's SQL does: loan id, else docket, else the
  // customer and their loan sequence.
  assert.equal(loanIdentity({ loan_id: ' l-100 ', docket_no: 'D-1' }), 'L-100');
  assert.equal(loanIdentity({ docket_no: 'd-1' }), 'D-1');
  assert.equal(loanIdentity({ track_no: '2', full_name: 'Amina H', contact: '0712000001' }), '2|AMINA H|0712000001');

  // Stage and amounts are NOT part of identity: a corrected figure is still the same loan.
  const corrected = importLoans([['LOAN ID', 'FULLNAME', 'PRINCIPAL AMT'], ['L-100', 'AMINA H', '999999']], 'disbursed');
  assert.equal(corrected[0].id, asApproved[0].id);
});

// The CREATED BY agent was declared twice in the loan column map, so the second declaration
// silently threw away the AGENT / AGENT ID aliases the live exports actually use.
test('the call agent is read from any of the names the exports use', async () => {
  const { importLoans } = await import('../api/_lib/importers.js');
  for (const header of ['CREATED BY', 'AGENT', 'AGENT ID']) {
    const out = importLoans([[header, 'FULLNAME'], ['Callagent1', 'AMINA H']], 'assigned');
    assert.equal(out[0].created_by, 'Callagent1', header + ' should map to created_by');
  }
});

// The upload stamp: which report a row belongs to, so one day can be redone without touching
// any other. Not the dates inside the file -- a 27 July applications report holds June dates.
test('the upload stamp decides what a second upload of the same report does', async () => {
  const { stampPlan } = await import('../api/upload.js');
  const NOON_EAT = Date.parse('2026-07-27T09:00:00Z');

  // Snapshots already supersede by their own date, so they carry no stamp and no choice.
  assert.equal(stampPlan('repayment_snapshots', {}, NOON_EAT).stamped, false);
  assert.equal(stampPlan('defaulter_snapshots', {}, NOON_EAT).stamped, false);

  // Accumulating reports do, and default to TODAY on the EAT clock.
  const dflt = stampPlan('received_payments', {}, NOON_EAT);
  assert.equal(dflt.stamped, true);
  assert.equal(dflt.uploadDate, '2026-07-27');
  assert.equal(dflt.replace, false);

  // 01:00 EAT is still the 27th, though the server's UTC clock says the 26th.
  assert.equal(stampPlan('received_payments', {}, Date.parse('2026-07-26T22:00:00Z')).uploadDate, '2026-07-27');

  // A date can be named freely -- yesterday's report can be redone today.
  assert.equal(stampPlan('complaints', { uploadDate: '2026-07-20' }, NOON_EAT).uploadDate, '2026-07-20');
  // Anything that is not a real date falls back to today rather than writing rubbish.
  assert.equal(stampPlan('complaints', { uploadDate: 'yesterday' }, NOON_EAT).uploadDate, '2026-07-27');

  // Replace is scoped to that report's own stamp, never the whole table.
  const rep = stampPlan('abnormal_payments', { uploadDate: '2026-07-27', mode: 'replace' }, NOON_EAT);
  assert.equal(rep.replace, true);
  assert.deepEqual(rep.scope, { upload_date: '2026-07-27' });

  // The pipeline uploads one stage at a time, so replacing the 27th's APPLICATIONS report must
  // not take the 27th's ASSIGNED report with it. An applications report has no usable date of
  // its own -- one pulled on the 27th is full of June dates -- so the stamp still rules there.
  const loans = stampPlan('loans', { uploadDate: '2026-07-27', mode: 'replace', stage: 'unassigned' }, NOON_EAT);
  assert.deepEqual(loans.scope, { upload_date: '2026-07-27', stage: 'unassigned' });

  // Tables people also write INSIDE the app -- an officer's comment, a complaint logged at the
  // desk, a restructure request, a demand notice -- must never lose that work to a replace.
  for (const t of ['complaints', 'restructures', 'demand_notices', 'followup_comments']) {
    assert.equal(stampPlan(t, { mode: 'replace' }, NOON_EAT).uploadedOnly, true, t + ' is app-writable');
  }
  // The upload-only tables have no such work to protect, so a replace there is unrestricted.
  for (const t of ['loans', 'received_payments', 'abnormal_payments']) {
    assert.equal(stampPlan(t, { mode: 'replace' }, NOON_EAT).uploadedOnly, false, t + ' is upload-only');
  }
});

// Approvals and received payments carry their own dates, and those dates are the truth. Redo
// 27 July by uploading 27 July -- whatever today happens to be.
test('approvals and received payments replace by the dates in the FILE, not the upload stamp', async () => {
  const { stampPlan, dataDateColumn, datesInFile, MAX_REPLACE_DATES } = await import('../api/upload.js');
  const NOON_EAT = Date.parse('2026-07-27T09:00:00Z');

  // The two the field asked for, by their own date columns.
  assert.equal(dataDateColumn('received_payments'), 'paid_at');
  assert.equal(dataDateColumn('loans', 'approved'), 'approved_date');
  assert.equal(dataDateColumn('loans', 'disbursed'), 'disb_date');

  // Everything else has no date of its own that means anything, so it keeps the stamp.
  for (const s of ['unassigned', 'assigned', 'unassessed', 'assessed', 'pending_approval', 'pending_disb']) {
    assert.equal(dataDateColumn('loans', s), null, s + ' has no data date');
  }
  assert.equal(dataDateColumn('complaints'), null);
  assert.equal(dataDateColumn('abnormal_payments'), null);

  // A data-dated report does NOT scope by the stamp -- that is the whole change.
  const paid = stampPlan('received_payments', { uploadDate: '2026-08-01', mode: 'replace' }, NOON_EAT);
  assert.equal(paid.dateCol, 'paid_at');
  assert.deepEqual(paid.scope, {});                       // no upload_date -- the file decides
  const appr = stampPlan('loans', { uploadDate: '2026-08-01', mode: 'replace', stage: 'approved' }, NOON_EAT);
  assert.equal(appr.dateCol, 'approved_date');
  assert.deepEqual(appr.scope, { stage: 'approved' });    // still one stage at a time
  // The stamp is still recorded on the rows; it just no longer decides what gets cleared.
  assert.equal(appr.uploadDate, '2026-08-01');

  // The EXACT set of days in the file, sorted, deduped.
  assert.deepEqual(datesInFile([
    { paid_at: '2026-07-27' }, { paid_at: '2026-07-25' }, { paid_at: '2026-07-27' },
  ], 'paid_at'), ['2026-07-25', '2026-07-27']);

  // Timestamps are trimmed to the day; blanks, nulls and rubbish are dropped rather than
  // guessed at. A row with no date of its own belongs to no day, so it can neither be replaced
  // by date nor take a day down with it.
  assert.deepEqual(datesInFile([
    { paid_at: '2026-07-27T14:03:00Z' }, { paid_at: '' }, { paid_at: null },
    { paid_at: 'N/A' }, { paid_at: '27/07/2026' }, {},
  ], 'paid_at'), ['2026-07-27']);

  // A file of nothing but unreadable dates yields nothing -- so the caller must refuse to
  // replace rather than fall through to a delete with no date filter at all.
  assert.deepEqual(datesInFile([{ paid_at: 'x' }, { paid_at: '' }], 'paid_at'), []);

  // One report is one day, or a few. The cap exists so a column of rubbish read as dates
  // cannot turn "redo 27 July" into a delete spanning years.
  assert.ok(MAX_REPLACE_DATES >= 31 && MAX_REPLACE_DATES <= 200, 'cap is a sane number of days');
});

// The only code in the system that deletes anybody's figures. Worth watching row by row.
test('a Replace takes exactly the days in the file and nothing else', async () => {
  const { runReplace, stampPlan } = await import('../api/upload.js');
  const { fakeDb } = await import('./fake-db.mjs');
  const NOW = Date.parse('2026-08-01T09:00:00Z');
  const book = () => ([
    { id: 'p1', paid_at: '2026-07-25', amount_paid: 100, upload_date: '2026-07-25' },
    { id: 'p2', paid_at: '2026-07-27', amount_paid: 200, upload_date: '2026-07-27' },
    { id: 'p3', paid_at: '2026-07-27', amount_paid: 300, upload_date: '2026-08-01' },  // same day, uploaded later
    { id: 'p4', paid_at: '2026-07-28', amount_paid: 400, upload_date: '2026-08-01' },
  ]);

  // Re-pull 27 July and upload it TODAY (1 August). The 27th goes -- both copies of it, no
  // matter when they were uploaded -- and no other day is touched. Under the old rule this
  // would have taken p3 and p4 (uploaded today) and left p2 (the actual 27 July row) behind:
  // exactly backwards.
  let db = fakeDb({ received_payments: book() });
  let plan = stampPlan('received_payments', { uploadDate: '2026-08-01', mode: 'replace' }, NOW);
  let out = await runReplace(db, 'received_payments', plan, [
    { paid_at: '2026-07-27', amount_paid: 250 },
  ]);
  assert.equal(out.replaced, 2);
  assert.deepEqual(out.replacedDates, ['2026-07-27']);
  assert.deepEqual(db._dump('received_payments').map(r => r.id), ['p1', 'p4']);

  // Nothing at all happens when the choice was Append.
  db = fakeDb({ received_payments: book() });
  plan = stampPlan('received_payments', { uploadDate: '2026-08-01', mode: 'append' }, NOW);
  out = await runReplace(db, 'received_payments', plan, [{ paid_at: '2026-07-27' }]);
  assert.equal(out.replaced, 0);
  assert.equal(db._dump('received_payments').length, 4);

  // A file whose date column is empty or unreadable is REFUSED. It must never fall through to
  // a delete with no date filter, which would clear the whole table.
  db = fakeDb({ received_payments: book() });
  plan = stampPlan('received_payments', { mode: 'replace' }, NOW);
  await assert.rejects(
    () => runReplace(db, 'received_payments', plan, [{ paid_at: '' }, { paid_at: 'N/A' }]),
    /no readable dates/i);
  assert.equal(db._dump('received_payments').length, 4, 'a refused replace deletes nothing');

  // A column of rubbish read as dates would span years. Refused, with the span quoted back.
  db = fakeDb({ received_payments: book() });
  const many = [];
  for (let i = 0; i < 400; i++) many.push({ paid_at: '2025-' + String(1 + (i % 12)).padStart(2, '0') + '-' + String(1 + (i % 28)).padStart(2, '0') });
  await assert.rejects(() => runReplace(db, 'received_payments', plan, many), /too much history/i);
  assert.equal(db._dump('received_payments').length, 4, 'a refused replace deletes nothing');

  // Loans: one stage at a time, still. Redoing the 27th's APPROVED report must not touch a
  // disbursed loan that happens to carry the same date.
  db = fakeDb({ loans: [
    { id: 'l1', stage: 'approved',  approved_date: '2026-07-27' },
    { id: 'l2', stage: 'approved',  approved_date: '2026-07-26' },
    { id: 'l3', stage: 'disbursed', approved_date: '2026-07-27' },
    { id: 'l4', stage: 'assigned',  approved_date: '2026-07-27' },
  ] });
  plan = stampPlan('loans', { uploadDate: '2026-08-01', mode: 'replace', stage: 'approved' }, NOW);
  out = await runReplace(db, 'loans', plan, [{ approved_date: '2026-07-27' }]);
  assert.equal(out.replaced, 1);
  assert.deepEqual(db._dump('loans').map(r => r.id), ['l2', 'l3', 'l4']);

  // An APPLICATIONS report has no date of its own worth trusting, so it still goes by the
  // stamp -- and only its own stage.
  db = fakeDb({ loans: [
    { id: 'a1', stage: 'unassigned', upload_date: '2026-08-01' },
    { id: 'a2', stage: 'unassigned', upload_date: '2026-07-27' },
    { id: 'a3', stage: 'approved',   upload_date: '2026-08-01' },
  ] });
  plan = stampPlan('loans', { uploadDate: '2026-08-01', mode: 'replace', stage: 'unassigned' }, NOW);
  out = await runReplace(db, 'loans', plan, [{}]);
  assert.equal(out.replaced, 1);
  assert.deepEqual(db._dump('loans').map(r => r.id), ['a2', 'a3']);

  // And the protection for work people typed inside the app still holds.
  db = fakeDb({ complaints: [
    { id: 'c1', upload_date: '2026-08-01', upload_batch: 'b1' },   // came from an upload
    { id: 'c2', upload_date: '2026-08-01', upload_batch: null },   // typed at the desk
  ] });
  plan = stampPlan('complaints', { uploadDate: '2026-08-01', mode: 'replace' }, NOW);
  out = await runReplace(db, 'complaints', plan, [{}]);
  assert.equal(out.replaced, 1);
  assert.deepEqual(db._dump('complaints').map(r => r.id), ['c2']);
});

/* The portal's cadences became settings, and a settings box is typed into by people. A slide
   timer of one second, or a remembered screen that lasts an hour, is not a preference -- it is
   a broken portal somebody has to be talked through undoing over the phone. */
test('UI cadence settings are clamped to something usable', async () => {
  process.env.SUPABASE_URL ||= 'http://x';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'y';
  const { clampNum } = await import('../api/me.js');

  // Nothing set at all keeps exactly the number that was hard-coded before.
  assert.equal(clampNum(undefined, 15, 5, 300), 15);
  assert.equal(clampNum('', 15, 5, 300), 15);
  assert.equal(clampNum(null, 90, 10, 900), 90);

  // A real value is honoured.
  assert.equal(clampNum('30', 15, 5, 300), 30);
  assert.equal(clampNum(45, 15, 5, 300), 45);

  // Out of range is pulled back rather than obeyed.
  assert.equal(clampNum('1', 15, 5, 300), 5);
  assert.equal(clampNum('99999', 15, 5, 300), 300);

  // Somebody typing "20 seconds" means 20, not a broken screen.
  assert.equal(clampNum('20 seconds', 15, 5, 300), 20);
  // And rubbish falls back rather than becoming zero, which would mean a timer that never
  // fires or one that fires continuously.
  assert.equal(clampNum('abc', 15, 5, 300), 15);
  assert.equal(clampNum('0', 15, 5, 300), 15);
  assert.equal(clampNum('-40', 15, 5, 300), 40);   // the minus is stripped, not obeyed
});


/* THE v1 FOLLOW-UP COMMENT LOG.

   Its columns are TIMESTAMP, REF#, TEAM, FULLNAME, COMMENT, FU STATUS, PROMISE DATE,
   PROMISE AMT, BY, NEW NUMBER, DOCKET# -- and the TIMESTAMP is the whole point. It is a
   history import: the thread on each customer only means anything if the comments keep the
   dates and the order they were actually made in. */

const V1_HEADER = ['TIMESTAMP', 'REF#', 'TEAM', 'FULLNAME', 'COMMENT', 'FU STATUS',
  'PROMISE DATE', 'PROMISE AMT', 'BY', 'NEW NUMBER', 'DOCKET#'];

test('a v1 comment keeps the day AND the hour it was actually written', () => {
  const rows = [V1_HEADER,
    ['6/22/2026 11:29', '2202428956', 'GOBA', 'ERNEST JOHN MSHUBI', 'BADO NA FATILIA',
      'HAPATIKANI YEYE & MDHAMINI', '', '', 'CHRISPIN LUKONGE', '', '2-202-42895'],
    ['6/22/2026 11:45', '2202508974', 'GOBA', 'JANETH JOHN MAKATA', 'NAMBA YA MUME WAKE 0714665566',
      'AMETOA AHADI', '2026-06-23', '500,000', 'CHRISPIN LUKONGE', '', '2-202-50897'],
  ];
  const out = importComments(rows);
  assert.equal(out.length, 2);

  /* 11:29 in the office is 08:29 UTC. Before this, dateOrNull could not read a date with a
     clock attached, returned null, and every row fell through to `new Date()` -- a year of
     history all stamped with the moment somebody pressed Upload. */
  assert.equal(out[0].created_at, '2026-06-22T08:29:00.000Z');
  assert.equal(out[1].created_at, '2026-06-22T08:45:00.000Z');
  assert.ok(out[0].created_at < out[1].created_at, 'and the afternoon stays in order');

  assert.equal(out[0].ref, '2202428956');
  assert.equal(out[0].team, 'GOBA');
  assert.equal(out[0].full_name, 'ERNEST JOHN MSHUBI');
  assert.equal(out[0].fu_status, 'HAPATIKANI YEYE & MDHAMINI');
  assert.equal(out[0].created_by, 'CHRISPIN LUKONGE');
  assert.equal(out[0].docket_no, '2-202-42895');
  assert.equal(out[1].promise_date, '2026-06-23');
  assert.equal(out[1].promise_amt, 500000, 'a thousands separator is not part of the number');
});

test('the day/month order is read off the file, not assumed', () => {
  // 6/22 can only be month-first: there is no twenty-second month.
  assert.equal(inferDayFirst(['6/22/2026 11:29', '6/7/2026 09:00']), false);
  // 23/07 can only be day-first.
  assert.equal(inferDayFirst(['23/07/2026 11:29', '6/7/2026 09:00']), true);
  // Nothing decisive anywhere: say so rather than guess.
  assert.equal(inferDayFirst(['6/7/2026 09:00', '5/4/2026 10:00']), null);
  assert.equal(inferDayFirst([]), null);

  /* And the decision reaches the ambiguous rows. 6/7/2026 in a month-first file is the 7th of
     June; in a day-first file it is the 6th of July. Getting this wrong moves a comment by a
     month while looking entirely reasonable. */
  const monthFirst = importComments([V1_HEADER,
    ['6/22/2026 11:29', 'A', 'GOBA', 'X', 'c1', '', '', '', 'BY', '', ''],
    ['6/7/2026 09:00', 'B', 'GOBA', 'Y', 'c2', '', '', '', 'BY', '', ''],
  ]);
  assert.equal(monthFirst[1].created_at, '2026-06-07T06:00:00.000Z');

  const dayFirst = importComments([V1_HEADER,
    ['23/6/2026 11:29', 'A', 'GOBA', 'X', 'c1', '', '', '', 'BY', '', ''],
    ['6/7/2026 09:00', 'B', 'GOBA', 'Y', 'c2', '', '', '', 'BY', '', ''],
  ]);
  assert.equal(dayFirst[1].created_at, '2026-07-06T06:00:00.000Z');

  // PROMISE DATE is read the same way round as the TIMESTAMP, so one file is never read two
  // ways -- a promise dated a month off is a customer chased on the wrong day.
  const both = importComments([V1_HEADER,
    ['6/22/2026 11:29', 'A', 'GOBA', 'X', 'c1', 'AMETOA AHADI', '6/7/2026', '1000', 'BY', '', ''],
  ]);
  assert.equal(both[0].promise_date, '2026-06-07');
});

test('what the importer decided is reported, including what it could not read', () => {
  assert.deepEqual(commentsDateOrder([V1_HEADER,
    ['6/22/2026 11:29', 'A', 'GOBA', 'X', 'c', '', '', '', 'BY', '', ''],
  ]), { dayFirst: false, unreadable: 0 });

  assert.deepEqual(commentsDateOrder([V1_HEADER,
    ['6/7/2026 09:00', 'A', 'GOBA', 'X', 'c', '', '', '', 'BY', '', ''],
  ]), { dayFirst: null, unreadable: 0 }, 'no evidence either way is reported as such');

  const messy = commentsDateOrder([V1_HEADER,
    ['6/22/2026 11:29', 'A', 'GOBA', 'X', 'c', '', '', '', 'BY', '', ''],
    ['sometime last june', 'B', 'GOBA', 'Y', 'c', '', '', '', 'BY', '', ''],
    ['', 'C', 'GOBA', 'Z', 'c', '', '', '', 'BY', '', ''],
  ]);
  assert.equal(messy.unreadable, 1, 'a blank stamp is not the same as an unreadable one');
});

test('an unreadable stamp falls back to now, and is the only row that does', () => {
  const before = Date.now();
  const out = importComments([V1_HEADER,
    ['6/22/2026 11:29', 'A', 'GOBA', 'X', 'good', '', '', '', 'BY', '', ''],
    ['not a date', 'B', 'GOBA', 'Y', 'bad', '', '', '', 'BY', '', ''],
  ]);
  assert.equal(out[0].created_at, '2026-06-22T08:29:00.000Z');
  assert.ok(Date.parse(out[1].created_at) >= before, 'the unreadable one is stamped now');
});

test('the same comment uploaded twice is the same row', () => {
  /* Importing years of history is never done in one clean go: a file goes in, something is
     wrong with it, it is fixed and sent again. Without an identity the second attempt doubles
     every comment already stored, and nothing on screen says so. */
  const rows = [V1_HEADER,
    ['6/22/2026 11:29', '2202428956', 'GOBA', 'ERNEST JOHN MSHUBI', 'BADO NA FATILIA', '', '', '', 'CHRISPIN LUKONGE', '', ''],
  ];
  assert.equal(importComments(rows)[0].id, importComments(rows)[0].id);

  // Two DIFFERENT comments are two rows, including two in the same minute about the same
  // person -- an officer can log a call and a note one after the other.
  const two = importComments([V1_HEADER,
    ['6/22/2026 11:29', 'A', 'GOBA', 'X', 'first thing', '', '', '', 'BY', '', ''],
    ['6/22/2026 11:29', 'A', 'GOBA', 'X', 'second thing', '', '', '', 'BY', '', ''],
  ]);
  assert.notEqual(two[0].id, two[1].id);

  // The identity is the customer, the moment, the words and who said them -- not the fields an
  // officer might correct later.
  assert.equal(
    commentId({ ref: 'A', created_at: 'T', comment: 'c', created_by: 'B' }),
    commentId({ ref: 'a', created_at: 'T', comment: ' c ', created_by: 'b', fu_status: 'CHANGED', promise_amt: 999 }));
  // And it is shaped as a uuid, because that is what the column is.
  assert.match(importComments(rows)[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('stampOrNull reads the shapes a real export produces, and refuses the rest', () => {
  assert.equal(stampOrNull('2026-06-22 11:29:07'), '2026-06-22T08:29:07.000Z');
  assert.equal(stampOrNull('2026-06-22T11:29:07'), '2026-06-22T08:29:07.000Z');
  assert.equal(stampOrNull('6/22/2026 1:05 PM', false), '2026-06-22T10:05:00.000Z');
  assert.equal(stampOrNull('6/22/2026 12:30 AM', false), '2026-06-21T21:30:00.000Z', 'midnight is 00, not 12');
  assert.equal(stampOrNull('6/22/2026', false), '2026-06-21T21:00:00.000Z', 'a date with no clock is midnight EAT');
  // The XLSX reader hands real date cells back as Date objects; those already carry the clock.
  assert.equal(stampOrNull(new Date('2026-06-22T08:29:00Z')), '2026-06-22T08:29:00.000Z');
  for (const bad of ['', null, undefined, 'sometime', '13/13/2026', new Date('nope')]) {
    assert.equal(stampOrNull(bad), null, JSON.stringify(String(bad)) + ' is not a moment');
  }
});

test('dateOrNull still behaves exactly as it did when nothing is passed', () => {
  assert.equal(dateOrNull('2026-06-23'), '2026-06-23');
  assert.equal(dateOrNull('23/07/2026'), '2026-07-23');
  assert.equal(dateOrNull('07/23/2026'), '2026-07-23');
  assert.equal(dateOrNull('6/7/2026'), '2026-07-06', 'ambiguous stays day/month by default');
  assert.equal(dateOrNull('6/7/2026', false), '2026-06-07', 'unless the file said month-first');
  assert.equal(dateOrNull(''), null);
});

/* THE SAME COMMENT TWICE IN ONE FILE.
 *
 * Reported from the field while uploading a year of v1 history:
 *   Failed: ON CONFLICT DO UPDATE command cannot affect row a second time
 *
 * Postgres refuses a statement that would update the same row twice. Not the second row -- the
 * WHOLE upload, with a message naming no file, no column and no customer.
 *
 * The duplicate is real and expected: a v1 sheet exported twice, or a row copied down, gives the
 * same sentence about the same customer at the same minute. commentId hashes exactly those
 * fields, so those rows share an id BY DESIGN -- which is what stops a re-upload doubling
 * everything. The identity that protects the second upload was breaking the first.
 */
test('a file containing the same comment twice is written once, not refused', async () => {
  const { dedupeByKey } = await import('../api/upload.js');

  const rows = [
    ['TIMESTAMP', 'REF#', 'TEAM', 'FULLNAME', 'COMMENT', 'FU STATUS', 'BY'],
    ['22-06-2026 08:45', '2202508974', 'KAMARIA', 'JUMA G', 'AMETOA AHADI', 'PROMISE', 'ASHA'],
    ['22-06-2026 08:45', '2202508974', 'KAMARIA', 'JUMA G', 'AMETOA AHADI', 'PROMISE', 'ASHA'],
    ['22-06-2026 09:00', '3234909611', 'KAMARIA', 'MARY P', 'ANALIPA LEO', 'PROMISE', 'ASHA'],
  ];
  const records = importComments(rows);
  assert.equal(records.length, 3, 'the importer keeps every row -- deduplication is not its job');
  assert.equal(records[0].id, records[1].id, 'and the two identical rows DO share an id');

  const { records: out, collapsed } = dedupeByKey(records, 'id');
  assert.equal(collapsed, 1, 'one row collapsed');
  assert.equal(out.length, 2, 'two comments survive');
  assert.equal(new Set(out.map(r => r.id)).size, 2, 'and no id appears twice');
  assert.deepEqual(out.map(r => r.ref).sort(), ['2202508974', '3234909611']);
});

test('the LAST version of a repeated row wins, as a re-upload would', async () => {
  const { dedupeByKey } = await import('../api/upload.js');
  /* Later in the file is later in time. A sheet corrected in place puts the correction below
     the mistake, so the file's own last word is the one to keep -- exactly what uploading the
     file a second time does. */
  const rows = [{ id: 'a', v: 'first' }, { id: 'b', v: 'other' }, { id: 'a', v: 'corrected' }];
  const { records, collapsed } = dedupeByKey(rows, 'id');
  assert.equal(collapsed, 1);
  assert.deepEqual(records, [{ id: 'b', v: 'other' }, { id: 'a', v: 'corrected' }]);
});

test('a file with no duplicates is returned untouched', async () => {
  const { dedupeByKey } = await import('../api/upload.js');
  const rows = [{ ref: '1' }, { ref: '2' }, { ref: '3' }];
  const out = dedupeByKey(rows, 'ref');
  assert.equal(out.collapsed, 0);
  assert.equal(out.records, rows, 'the same array, not a copy -- nothing to do means no work');
});

test('rows with no key at all are left for the upsert to complain about honestly', async () => {
  const { dedupeByKey } = await import('../api/upload.js');
  /* Silently dropping somebody's rows here would be worse than the error: the upload would
     report success having written less than it was given. */
  const rows = [{ ref: '1' }, { ref: null }, { ref: '' }, { ref: '1' }];
  const { records, collapsed } = dedupeByKey(rows, 'ref');
  assert.equal(collapsed, 1);
  assert.equal(records.length, 3, 'the keyless rows stay');
});

/* ONE FILE SENT IN SLICES IS STILL ONE UPLOAD.
 *
 * A big deck is now several HTTP requests, because no single request can be relied on to finish
 * inside the sixty seconds the hosting platform allows. That is a safe change ONLY while three
 * things hold, and each of them fails silently rather than loudly if it does not:
 *
 *   1. Every slice shares ONE upload batch. The readers keep the latest batch of the latest date
 *      and discard the rest -- so a file arriving as twelve batches is read as a TWELFTH of
 *      itself, with every figure quietly too low.
 *   2. Replace-that-date runs on the FIRST slice only, or slice two deletes slice one.
 *   3. The working list is rebuilt on the LAST slice only, or "the deck no longer names them"
 *      is true of eleven twelfths of the book.
 */
test('a file sent whole behaves exactly as it always did', async () => {
  const { partPlan } = await import('../api/upload.js');
  const p = partPlan(null);
  assert.deepEqual(p, { index: 0, total: 1, isFirst: true, isLast: true, batch: null });
  // batch null means the route mints its own uuid, which is what it has always done.
});

test('every slice of one file carries the same upload batch', async () => {
  const { partPlan } = await import('../api/upload.js');
  const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const batches = new Set();
  for (let i = 0; i < 12; i++) batches.add(partPlan({ id, index: i, total: 12 }).batch);
  assert.deepEqual([...batches], [id],
    'twelve slices must be ONE batch -- twelve batches would read as a twelfth of the file');
});

test('replace runs on the first slice, the rebuild on the last, and never the other way round', async () => {
  const { partPlan } = await import('../api/upload.js');
  const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const firsts = [], lasts = [];
  for (let i = 0; i < 12; i++) {
    const p = partPlan({ id, index: i, total: 12 });
    if (p.isFirst) firsts.push(i);
    if (p.isLast) lasts.push(i);
  }
  assert.deepEqual(firsts, [0], 'exactly one slice may replace the date');
  assert.deepEqual(lasts, [11], 'exactly one slice may rebuild the working list');
});

test('a single slice is both the first and the last', async () => {
  const { partPlan } = await import('../api/upload.js');
  const p = partPlan({ id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', index: 0, total: 1 });
  assert.equal(p.isFirst, true);
  assert.equal(p.isLast, true, 'a one-slice upload must still rebuild the working list');
});

test('an id that is not a uuid is refused rather than written', async () => {
  const { partPlan } = await import('../api/upload.js');
  /* upload_batch is a uuid column. A malformed id would fail the write with a message about
     syntax rather than about the file, so it falls back to null and the route mints its own --
     worse, because it splits the batch, but not an error. */
  for (const bad of ['', 'abc', null, undefined, 42, 'DROP TABLE loans', '3f2504e0-4f89-41d3-9a0c']) {
    assert.equal(partPlan({ id: bad, index: 0, total: 3 }).batch, null, 'refused: ' + bad);
  }
  // And a real one, in either case, is kept exactly as sent.
  assert.equal(partPlan({ id: '3F2504E0-4F89-41D3-9A0C-0305E82C3301', index: 0, total: 3 }).batch,
    '3F2504E0-4F89-41D3-9A0C-0305E82C3301');
});

test('nonsense counts still finish the upload rather than stranding it', async () => {
  const { partPlan } = await import('../api/upload.js');
  /* An index past the total, or a garbled total, must still resolve as "this is the last one".
     The alternative is an upload whose working list is never rebuilt and whose phones never
     hear about it, with nothing on screen to say why. */
  assert.equal(partPlan({ index: 9, total: 3 }).isLast, true);
  assert.equal(partPlan({ index: 'x', total: 'y' }).isLast, true);
  assert.equal(partPlan({ index: -5, total: 0 }).index, 0);
  assert.equal(partPlan({ index: -5, total: 0 }).total, 1);
});

/* =====================================================================================
   SUMMARY UPLOADS -- a day's figures without the customers behind them.
   =====================================================================================
   The sheets are the company's own, described exactly as they arrive. Both produce rows in the
   shape the totals functions return, so a summary needs no merging rule of its own -- it is
   more rows for the batch rule to judge.
*/
const { importExpectedSummary, importDefaulterSummary } = await import('../api/_lib/importers.js');

test('the expected summary reads collected as PAID + ILIYONASIA + EXP TOMMR', () => {
  const rows = [
    ['TEAMS', 'EXPECTED', 'PAID', 'ILIYONASIA', 'EXP TOMMR', 'UNCOLLECTED', '%'],
    ['BABATI', '2045653', '1909654', '-', '-', '135,999.00', '93%'],
    ['BARIADI', '0', '0', '-', '-', '-', '100%'],
    ['BOMA NGOMBE', '2515992', '2413992', '', '', '102,000.00', '96%'],
  ];
  const out = importExpectedSummary(rows, { snapshotType: 'today', snapshotDate: '2026-08-07' });
  assert.equal(out.length, 3);
  const babati = out.find(r => r.team === 'BABATI');
  assert.equal(babati.expected_amt, 2045653);
  assert.equal(babati.collected_amt, 1909654, 'the dashes are nothing, not NaN');
  assert.equal(babati.uncollected_amt, 135999, 'the file\'s own uncollected, commas and all');
  assert.equal(babati.kind, 'expected');
  assert.equal(babati.snapshot_type, 'today');
  assert.equal(babati.snapshot_date, '2026-08-07');
  assert.equal(babati.customers, null, 'a summary is money, not a list of people');
  // A team that owes nothing is a real row, not a blank one to drop.
  assert.equal(out.find(r => r.team === 'BARIADI').expected_amt, 0);
});

test('the three collected columns really are added together', () => {
  const rows = [
    ['TEAMS', 'EXPECTED', 'PAID', 'ILIYONASIA', 'EXP TOMMR', 'UNCOLLECTED'],
    ['MABIBO', '1000', '400', '250', '150', ''],
  ];
  const r = importExpectedSummary(rows, { snapshotType: 'today', snapshotDate: '2026-08-07' })[0];
  assert.equal(r.collected_amt, 800);
  assert.equal(r.uncollected_amt, 200, 'blank uncollected is worked out, not left at zero');
});

test('an overpaying team is not shown as owing less than nothing', () => {
  const rows = [['TEAMS', 'EXPECTED', 'PAID', 'ILIYONASIA', 'EXP TOMMR', 'UNCOLLECTED'],
    ['SINZA', '1000', '1400', '0', '0', '']];
  const r = importExpectedSummary(rows, { snapshotType: 'today', snapshotDate: '2026-08-07' })[0];
  assert.equal(r.uncollected_amt, 0, 'clamped, exactly as the customer-level rule clamps per row');
});

test('the defaulter summary reads team_name and amount_defaulted', () => {
  const rows = [
    ['team_id', 'team_name', 'amount_defaulted'],
    ['202-2026', 'MABIBO', '108781206'],
    ['202-2027', 'SINZA', '123465272'],
  ];
  const out = importDefaulterSummary(rows, {
    snapshotType: 'initial', snapshotDate: '2026-08-07', weekday: 'FRI' });
  assert.deepEqual(out.map(r => r.team), ['MABIBO', 'SINZA']);
  assert.equal(out[0].arrears_amt, 108781206);
  assert.equal(out[0].kind, 'defaulter');
  assert.equal(out[0].snapshot_type, 'initial');
  assert.equal(out[0].weekday, 'FRI', 'the weekday is what makes the deck pairable at all');
  assert.equal(out[0].customers, null);
});

test('the worked example: initial minus current is the recovery', () => {
  const head = ['team_id', 'team_name', 'amount_defaulted'];
  const ini = importDefaulterSummary([head, ['202-2026', 'MABIBO', '108781206']],
    { snapshotType: 'initial', snapshotDate: '2026-08-07', weekday: 'FRI' })[0];
  const cur = importDefaulterSummary([head, ['202-2026', 'MABIBO', '108771206']],
    { snapshotType: 'current', snapshotDate: '2026-08-07', weekday: 'FRI' })[0];
  assert.equal(ini.arrears_amt - cur.arrears_amt, 10000);
});

test('a row with no team is dropped rather than stored against nobody', () => {
  const rows = [['TEAMS', 'EXPECTED', 'PAID', 'ILIYONASIA', 'EXP TOMMR', 'UNCOLLECTED'],
    ['', '100', '0', '0', '0', '100'], ['GRAND TOTAL', '', '', '', '', '']];
  const out = importExpectedSummary(rows, { snapshotType: 'today', snapshotDate: '2026-08-07' });
  assert.deepEqual(out.map(r => r.team), ['GRAND TOTAL'],
    'a blank team goes; a total ROW is a team name we cannot tell apart and is left to the eye');
});

/* =====================================================================================
   THE TWO ABNORMAL-PAYMENT COLUMNS THAT WERE ARRIVING EMPTY.

     "the columns in the system should be GMO TEAM PMO CUSTOMER NO PAYMENT NO REF NO
      CUSTOMER NAME TRANSACTION ID PAID REF ID PAYMENT SENDER NAME"

   col() matches a header by its exact normalised name, and importAbnormal asked only for
   'CONTACT NO' and 'PHONE NUMBER'. The sheet says CUSTOMER NO and PAYMENT NO, so neither ever
   matched and both imported as NULL -- two blank columns on the one report whose whole purpose
   is to let somebody ring the payer and ask what the money was.

   A header that matches nothing looks exactly like a column of empty cells. That is why it
   survived, and it is why this test exists.
   ===================================================================================== */
const { importAbnormal: importAbn } = await import('../api/_lib/importers.js');

test('abnormal payments: the sheet\'s own headers import, all twelve of them', () => {
  const rows = [
    ['GMO', 'TEAM', 'PMO', 'CUSTOMER NO', 'PAYMENT NO', 'REF NO', 'CUSTOMER NAME',
     'TRANSACTION ID', 'PAID', 'REF ID', 'PAYMENT', 'SENDER NAME'],
    ['G ONE', 'kongowe', 'EARLY E', '0712 000 111', '0755000222', 'R99', 'AMINA H',
     'TX123', '12,345', 'RID9', 'MPESA', 'MAMA A'],
  ];
  const [x] = importAbn(rows);
  assert.equal(x.gmo, 'G ONE');
  assert.equal(x.team, 'KONGOWE');
  assert.equal(x.pmo, 'EARLY E');
  assert.equal(x.contact_no, '712000111', 'CUSTOMER NO -- this was importing as null');
  assert.equal(x.phone_number, '755000222', 'PAYMENT NO -- this was importing as null');
  assert.equal(x.ref_no, 'R99');
  assert.equal(x.customer_name, 'AMINA H');
  assert.equal(x.transaction_id, 'TX123');
  assert.equal(x.paid, 12345);
  assert.equal(x.ref_id, 'RID9');
  assert.equal(x.payment, 'MPESA');
  assert.equal(x.sender_name, 'MAMA A');
});

test('abnormal payments: the older header spellings still import', () => {
  /* Sheets already uploaded under the old names must not stop working because the new ones
     were added. Both are accepted; neither is preferred at the other's expense. */
  const rows = [
    ['TEAM', 'CONTACT NO', 'PHONE NUMBER', 'REF NO', 'PAID'],
    ['KONGOWE', '0712000111', '0755000222', 'R99', '500'],
  ];
  const [x] = importAbn(rows);
  assert.equal(x.contact_no, '712000111');
  assert.equal(x.phone_number, '755000222');
});

/* =====================================================================================
   RECEIVED PAYMENTS -- the real sheet, header for header.

     "Failed: This file has no readable dates in its 'paid at' column, so there is no day to
      replace."

   Five columns never matched. Only the date announced itself, because Replace refuses a file
   with no readable dates; the other three had been importing as NULL in silence every time.
   A header that matches nothing is indistinguishable from a column of empty cells.

   This is the sheet as it actually arrives, so the next change to either side breaks a test
   rather than a Monday morning.
   ===================================================================================== */
const { importReceivedPayments: importRcv } = await import('../api/_lib/importers.js');

const RCV_HEADER = ['CUSTOMER NAME', 'TRANSACTION ID', 'CUSTOMER REF NO', 'AMOUNT PAID',
  'REF ID', 'PAYMENT DATE', 'STATUS', 'STATUS CODE', 'PHONE NUMBER', 'CARRIER',
  'SENDER NAME', 'BRANCH', 'TEAM', 'CONTACT NO'];

test('received payments: the real sheet imports, every column of it', () => {
  const [x] = importRcv([RCV_HEADER,
    ['ASHA  MBWANA CHOMBINGA', '26552917454906', '2201403386', '79500', '226552917454906',
     '8/8/2026', 'processed', 'error000', '255675218973', 'TIGO', 'ASHA CHOMBINGA',
     'TEMEKE-GONGOLAMBOTO ', 'TEMEKE', '0686852827']]);
  assert.equal(x.paid_at, '2026-08-08', 'PAYMENT DATE -- this is the one that failed the upload');
  assert.equal(x.team, 'TEMEKE');
  assert.equal(x.customer_name, 'ASHA  MBWANA CHOMBINGA');
  assert.equal(x.transaction_id, '26552917454906');
  assert.equal(x.ref_no, '2201403386', 'CUSTOMER REF NO -- was importing as null');
  assert.equal(x.ref_id, '226552917454906', 'REF ID -- had nowhere to go at all');
  assert.equal(x.amount_paid, 79500);
  assert.equal(x.payment_no, '255675218973', 'PHONE NUMBER -- was importing as null');
  assert.equal(x.customer_no, '686852827', 'CONTACT NO -- was importing as null');
  assert.equal(x.sender_name, 'ASHA CHOMBINGA');
});

test('received payments: the day/month order is inferred, not assumed', () => {
  /* "9/8/2026" is the 9th of August or the 8th of September. A payments report read the wrong
     way round moves money between months. Every other date-bearing importer already inferred
     this from the whole column; this one did not, which was a real risk sitting quietly behind
     the header bug. The 25th proves the column is day-first, and the 9th then follows it. */
  const rows = importRcv([RCV_HEADER,
    ['A', 'T1', 'R1', '100', 'RID1', '25/8/2026', 'processed', 'e', '255700000001', 'TIGO', 'S', 'B', 'TEMEKE', '0700000001'],
    ['B', 'T2', 'R2', '200', 'RID2', '9/8/2026', 'processed', 'e', '255700000002', 'TIGO', 'S', 'B', 'TEMEKE', '0700000002']]);
  assert.equal(rows[0].paid_at, '2026-08-25');
  assert.equal(rows[1].paid_at, '2026-08-09', 'the 9th of August, not the 8th of September');
});

test('received payments: the older header spellings still import', () => {
  // Files already uploaded under the old names must not stop working.
  const [x] = importRcv([['DATE', 'TEAM', 'CUSTOMER NO', 'REF NO', 'AMOUNT PAID', 'PAYMENT NO'],
    ['2026-08-08', 'TEMEKE', '0686852827', 'R9', '500', '0755000111']]);
  assert.equal(x.paid_at, '2026-08-08');
  assert.equal(x.ref_no, 'R9');
  assert.equal(x.customer_no, '686852827');
  assert.equal(x.payment_no, '0755000111');
});

/* =====================================================================================
   THE DEFAULTER DECK IMPORTER, WHICH HAD NO TESTS AT ALL.
   =====================================================================================
   The most important file in the system -- the one every phone's Defaulters list is built from
   -- went through `importDefaulters` untested. That is the gap this whole hunt fell into:

     "am not yet seeing 2209728651  2-209-72865  ESTER PETER OMARY"

   Five separate faults were found and fixed in how a deck is READ before anybody checked
   whether the row survives being IMPORTED. These use her real row, exactly as the company's
   file carries it.
   ===================================================================================== */
const DEF_HEADER = ['CUSTOMER NO', 'REF#', 'FULLNAME', 'CONTACT#', 'GUARANTOR NAME',
  'GUARANTOR CONTACT', 'DISB DATE', 'EXPIRE DATE', 'CHRONIC DATE', 'DUE DATE', 'LAST TRANS DATE',
  'STATUS', 'D.S', 'D.C', 'DAYS ELAPSED', 'INITIAL INST', 'OTHER INST', 'PAYMENT EXP.',
  'T.PAYMENT', 'ARREAS', 'BALANCE', 'BRANCH', 'TEAM', 'ZONE'];
const ESTER = ['2209728651', '2-209-72865', 'ESTER PETER OMARY', '0746115063',
  'PETER CHARLES OMARY', '0783384221', '7/9/2026', '10/8/2026', '10/22/2026', '2026-09-03',
  '7/31/2026', 'Partial Defaulter', '2-4', '2', '31', '1133337', '1133333', '13600000',
  '2767000', '1766336', '10833000', 'GOBA-TEGETA', 'GOBA', 'SANYA'];
const DEF_META = { snapshotType: 'current', weekday: 'THU', snapshotDate: '2026-08-10' };

test('the defaulter deck: a real row survives the importer whole', async () => {
  const { importDefaulters } = await import('../api/_lib/importers.js');
  const [r] = importDefaulters([DEF_HEADER, ESTER], DEF_META);
  assert.ok(r, 'the row was not dropped');
  assert.equal(r.ref, '2-209-72865');
  assert.equal(r.full_name, 'ESTER PETER OMARY');
  assert.equal(r.team, 'GOBA');
  assert.equal(r.status, 'Partial Defaulter');
  assert.equal(r.arrears, 1766336, 'the figure the phone sorts the list by');
  assert.equal(r.ds, '2-4', 'D.S stays TEXT -- as a number it becomes a date or a fraction');
  assert.equal(r.dc, 2);
  /* Nine digits, no leading zero and no country code: normPhone stores one canonical form so
     0746115063, +255746115063 and 746115063 are the same handset to the phone index. */
  assert.equal(r.contact, '746115063');
  assert.equal(r.guarantor_contact, '783384221');
  assert.equal(r.snapshot_type, 'current');
  assert.equal(r.weekday, 'THU');
  assert.equal(r.snapshot_date, '2026-08-10');
});

test('the defaulter deck: the reference column is read however it is spelled', async () => {
  /* normalizeHeader only trims, uppercases and collapses whitespace, so `REF#`, `REF #` and
     `REF NO` are three different keys. Only the first two were ever tried -- and a reference
     that cannot be read does not blank a field, it DELETES THE CUSTOMER, because every importer
     ends `.filter(x => x.ref)`. `REF NO` is the company's own wording: it is what their
     received-payments columns say. */
  const { importDefaulters } = await import('../api/_lib/importers.js');
  for (const spelling of ['REF#', 'REF', 'REF NO', 'REF #', 'REFERENCE', 'REF NUMBER']) {
    const head = DEF_HEADER.slice();
    head[1] = spelling;
    const out = importDefaulters([head, ESTER], DEF_META);
    assert.equal(out.length, 1, `a file whose reference column says "${spelling}" loses every row`);
    assert.equal(out[0].ref, '2-209-72865', spelling);
  }
});

test('the defaulter deck: a row with no readable reference is dropped, and can be counted', async () => {
  /* The filter itself is right -- a row with no reference joins to nothing. What was wrong is
     that it was silent, and `inserted` reports the count AFTER it. The upload now compares the
     file's own row count against what came out, which is only meaningful if this stays true. */
  const { importDefaulters } = await import('../api/_lib/importers.js');
  const noRef = ESTER.slice(); noRef[1] = '';
  const out = importDefaulters([DEF_HEADER, ESTER, noRef], DEF_META);
  assert.equal(out.length, 1, 'one of the two rows was used');
});

test('the defaulter deck: CUSTOMER NO is never mistaken for the reference', async () => {
  /* They look alike -- 2209728651 against 2-209-72865 -- and they are not the same key. Reading
     one as the other would join this customer to nothing and quietly split their history. */
  const { importDefaulters } = await import('../api/_lib/importers.js');
  const [r] = importDefaulters([DEF_HEADER, ESTER], DEF_META);
  assert.notEqual(r.ref, '2209728651');
  assert.equal(r.ref, '2-209-72865');
});

test('the defaulter deck: a file with no reference column at all yields nothing, loudly countable', async () => {
  const { importDefaulters } = await import('../api/_lib/importers.js');
  const head = DEF_HEADER.slice();
  head[1] = 'SOMETHING ELSE ENTIRELY';
  const out = importDefaulters([head, ESTER], DEF_META);
  assert.equal(out.length, 0);
  /* And this is exactly the case the upload must now shout about rather than report as a
     successful upload of zero rows. */
});

/* =====================================================================================
   THE APPROVED DATE DECIDES WHICH MONTH A SALE BELONGS TO.
   =====================================================================================
     "i uploaded approved and now getting 0 sales!"
     "Replaced 7 days, 2026-03-08 to 2026-10-08"

   Their APPROVED DATE is 8/6/2026 -- the sixth of August. Read day-first that is the eighth of
   June, and a report covering the first week of August landed as the eighth of six different
   months. Nothing was in August, so August's sales read zero. Every row was there; every one
   was filed under the wrong month.

   And the file could not be settled by evidence: an approved report for the first week of a
   month is 8/3, 8/4 ... 8/10, where BOTH components are under thirteen on every single row.
   ===================================================================================== */
const LOAN_H = ['DOCKET #', 'LOAN ID', 'FULL NAME', 'CONTACT #', 'TEAM', 'TRACK',
  'PRINCIPAL AMT', 'APPROVED DATE', 'APPROVED BY'];
const loanRow = (d, n) => ['2-217-10968' + n, '2217109681' + n, 'MATUKA MASOUD ' + n,
  '0650941063', 'SEGEREA', '1', '500000', d, '201'];

test('a wholly ambiguous date column is read by which way round makes SENSE', async () => {
  const { importLoans } = await import('../api/_lib/importers.js');
  /* Nobody exports the eighth of six different months. They export a week. Whichever reading
     puts the file in the tighter span is the one the file meant -- seven days against seven
     months is not a close call. */
  const out = importLoans([LOAN_H, loanRow('8/3/2026', 1), loanRow('8/6/2026', 2),
    loanRow('8/10/2026', 3)], 'approved');
  assert.deepEqual(out.map(o => o.approved_date), ['2026-08-03', '2026-08-06', '2026-08-10']);
});

test('a genuine day/month file is still read day-first', async () => {
  /* The evidence rule comes first and stays decisive: a 22 in the first component can only be
     a day. This must not have been traded away for the span rule above. */
  const { importLoans } = await import('../api/_lib/importers.js');
  const out = importLoans([LOAN_H, loanRow('22/7/2026', 1), loanRow('8/7/2026', 2)], 'approved');
  assert.deepEqual(out.map(o => o.approved_date), ['2026-07-22', '2026-07-08']);
});

test('a genuine month/day file is read month-first', async () => {
  const { importLoans } = await import('../api/_lib/importers.js');
  const out = importLoans([LOAN_H, loanRow('7/22/2026', 1), loanRow('7/8/2026', 2)], 'approved');
  assert.deepEqual(out.map(o => o.approved_date), ['2026-07-22', '2026-07-08']);
});

test('the whole column decides ONCE, so one row cannot be read differently from the next', async () => {
  /* This is what a per-value reading gets wrong. 8/6 alone is ambiguous; 8/20 in the same file
     proves the file is month-first, and that proof has to apply to 8/6 as well. */
  const { importLoans } = await import('../api/_lib/importers.js');
  const out = importLoans([LOAN_H, loanRow('8/6/2026', 1), loanRow('8/20/2026', 2)], 'approved');
  assert.deepEqual(out.map(o => o.approved_date), ['2026-08-06', '2026-08-20'],
    'both in August -- not one in August and one in June');
});

test('the order the file was read in is reported, not silently chosen', async () => {
  const { loansDateOrder } = await import('../api/_lib/importers.js');
  assert.equal(loansDateOrder([LOAN_H, loanRow('8/3/2026', 1), loanRow('8/10/2026', 2)]), false,
    'month/day');
  assert.equal(loansDateOrder([LOAN_H, loanRow('22/7/2026', 1)]), true, 'day/month');
  assert.equal(loansDateOrder([LOAN_H, loanRow('8/6/2026', 1)]), null, 'one date, undecidable');
});

/* =====================================================================================
   THE LEADERS SHEET MUST NOT ERASE WHAT IT DOES NOT MENTION.
   =====================================================================================
     "i uploaded teams and leaders sheet to update credit ID and i can see lost all team codes"

   Seventy-eight teams lost their passcode in one upload. The sheet did not have a TEAM CODE
   column at all -- and the importer built every column on every row regardless, so the absent
   one imported as null, and a PostgREST upsert writes exactly the columns in the payload.
   Nobody typed a blank. The blank was manufactured here.

   The rule, and the reason both halves of it matter:
     ABSENT column  -> the key is not in the payload at all -> the stored value survives
     PRESENT but blank -> the key IS in the payload as null -> the stored value is cleared,
                          which is how somebody removes a leader who has left.
*/
test('a column the leaders sheet does not have is left alone, not blanked', async () => {
  const { importTeams } = await import('../api/_lib/importers.js');
  // The real shape of the sheet that caused it: no TEAM CODE column anywhere.
  const out = importTeams([
    ['TEAM', 'REGION', 'CREDIT'],
    ['KONGOWE', 'DAR', 'ANALYST A'],
  ]);
  assert.equal(out.length, 1);
  assert.equal('team_code' in out[0], false, 'team_code must not be in the payload at all');
  assert.equal(out[0].credit, 'ANALYST A');
  assert.equal(out[0].region, 'DAR');
  // Nor may any other unmentioned role column ride along as a null.
  for (const k of ['gmo', 'gmo_no', 'manager', 'legal', 'collection', 'expected_no']) {
    assert.equal(k in out[0], false, k + ' was sent as a null and would have erased the stored one');
  }
});

test('a column that IS on the sheet but left blank still clears the value', async () => {
  const { importTeams } = await import('../api/_lib/importers.js');
  const out = importTeams([
    ['TEAM', 'TEAM CODE', 'GMO'],
    ['KONGOWE', '', 'GEE MO'],
  ]);
  assert.equal('team_code' in out[0], true, 'the sheet HAS the column, so it speaks about it');
  assert.equal(out[0].team_code, null, 'and an empty cell means "make it empty"');
  assert.equal(out[0].gmo, 'GEE MO');
});

test('the team code is recognised by the name the screen shows it under', async () => {
  const { importTeams } = await import('../api/_lib/importers.js');
  // The teams screen labels it MSIMBO / CODE, so an admin editing what they see writes that.
  for (const header of ['TEAM CODE', 'TEAM_CODE', 'MSIMBO', 'MSIMBO / CODE', 'CODE']) {
    const out = importTeams([['TEAM', header], ['KONGOWE', 'KON123']]);
    assert.equal(out[0].team_code, 'KON123', header + ' was not recognised');
  }
});

test('a CREDIT ID column is ignored, and never erases a stored value', async () => {
  /* "so even remove the credit id column in teams and staff - not using it". A sheet that
     still carries the column must neither store it nor -- more importantly -- send a null
     that would wipe whatever a deployment already has. Not mentioning a column is how this
     importer leaves it alone; that is the same rule that saved the team codes. */
  const { importTeams } = await import('../api/_lib/importers.js');
  for (const header of ['CREDIT ID', 'CREDIT_ID', 'CREDIT ANALYST ID', 'C. ANALYST ID', 'ANALYST ID', 'CA ID']) {
    const out = importTeams([['TEAM', header, 'CREDIT'], ['KONGOWE', 'CA9', 'ANALYST A']]);
    assert.equal('credit_id' in out[0], false, header + ' must not reach the payload');
    assert.equal(out[0].credit, 'ANALYST A', 'the analyst NAME is what is kept');
  }
});

test('a row with no team at all is dropped, as before', async () => {
  const { importTeams } = await import('../api/_lib/importers.js');
  assert.equal(importTeams([['TEAM', 'GMO'], ['', 'NOBODY'], ['KONGOWE', 'GEE MO']]).length, 1);
});

/* =====================================================================================
   THE APPROVED-SALES FILE, AS THE COMPANY ACTUALLY EXPORTS IT.
   =====================================================================================
   "Replacing sales works but appending doesnt update"

   The real header row writes 'CONTACT #' and 'TRACK' with a space before the hash -- and
   normalizeHeader keeps a single space, so 'CONTACT #' is not 'CONTACT#'. The customer's
   phone imported as null off every approved-sales file, silently.
*/
test('the spaced headers of the real approvals export are recognised', async () => {
  const { importLoans } = await import('../api/_lib/importers.js');
  const out = importLoans([
    ['DOCKET #', 'LOAN ID', 'FULL NAME', 'CONTACT #', 'TRACK', 'PRINCIPAL AMT', 'APPROVED DATE'],
    ['2-217-109681', '22171096811', 'MATUKA MASOUD', '0650941063', '1', '500000', '22/6/2026'],
  ], 'approved');
  assert.equal(out[0].contact, '0650941063', 'the phone was dropped by the spaced header');
  assert.equal(out[0].docket_no, '2-217-109681');
  assert.equal(out[0].loan_id, '22171096811');
  assert.equal(out[0].track_no, '1');
});

test('a loan column the file does not have is not manufactured as null', async () => {
  /* The approvals export has no DISB DATE and no CREATED BY. Building them as null meant the
     upsert erased whatever an earlier stage's file had filled in -- the same "absent means
     erase" fault as the teams sheet wiping the passcodes. */
  const { importLoans } = await import('../api/_lib/importers.js');
  const out = importLoans([
    ['FULL NAME', 'TEAM', 'PRINCIPAL AMT', 'APPROVED DATE'],
    ['MATUKA MASOUD', 'SEGEREA', '500000', '22/6/2026'],
  ], 'approved');
  const o = out[0];
  assert.equal('disb_date' in o, false, 'disb_date was sent as null and would erase the disbursement');
  assert.equal('created_by' in o, false, 'created_by was sent as null and would erase the call agent');
  assert.equal('contact' in o, false);
  assert.equal(o.principal_amt, 500000);
  assert.equal(o.stage, 'approved');
  assert.ok(o.id, 'the key itself is always computed');
});

test('a loan column present but blank still clears', async () => {
  const { importLoans } = await import('../api/_lib/importers.js');
  const out = importLoans([
    ['FULL NAME', 'CONTACT #', 'PRINCIPAL AMT'],
    ['MATUKA MASOUD', '', '500000'],
  ], 'approved');
  assert.equal('contact' in out[0], true);
  assert.equal(out[0].contact, null);
});

/* =====================================================================================
   ONE LOAN, ONE ROW -- EVEN WHEN ITS PAPERWORK GROWS UP BETWEEN UPLOADS.
   =====================================================================================
   The application-stage export has no LOAN ID column (the ID is assigned at approval), so
   the loan went in under its docket or name. The approvals export then computes a DIFFERENT
   key from the new LOAN ID, and an upsert can only match keys -- so appending Approved
   INSERTED A TWIN instead of moving the row. "Replacing sales works but appending doesnt
   update", in one mechanism.
*/
const { fakeDb } = await import('./fake-db.mjs');

test('an approved append updates the loan the applications file created', async () => {
  const { importLoans } = await import('../api/_lib/importers.js');
  const { reconcileLoanIds } = await import('../api/upload.js');
  // Day 1: the applications file -- no LOAN ID column exists yet at this stage.
  const applied = importLoans([
    ['DOCKET #', 'FULL NAME', 'CONTACT #', 'TRACK', 'TEAM', 'REQUESTED AMT'],
    ['2-217-109681', 'MATUKA MASOUD', '0650941063', '1', 'SEGEREA', '500000'],
  ], 'unassigned');
  const db = fakeDb({ loans: applied });
  // Day 5: the approvals file for the same loan, now carrying its LOAN ID.
  const approved = importLoans([
    ['DOCKET #', 'LOAN ID', 'FULL NAME', 'CONTACT #', 'TRACK', 'TEAM', 'PRINCIPAL AMT', 'APPROVED DATE'],
    ['2-217-109681', '22171096811', 'MATUKA MASOUD', '0650941063', '1', 'SEGEREA', '500000', '22/6/2026'],
  ], 'approved');
  assert.notEqual(approved[0].id, applied[0].id, 'the identities genuinely differ -- that is the fault');
  const rec = await reconcileLoanIds(db, approved);
  assert.equal(rec.relinked, 1);
  assert.equal(rec.records[0].id, applied[0].id, 'the approval must land on the applications row');
});

test('the twins earlier appends already made are merged, and counted', async () => {
  const { importLoans } = await import('../api/_lib/importers.js');
  const { reconcileLoanIds } = await import('../api/upload.js');
  const applied = importLoans([
    ['DOCKET #', 'FULL NAME', 'TRACK', 'TEAM', 'REQUESTED AMT'],
    ['2-217-109681', 'MATUKA MASOUD', '1', 'SEGEREA', '500000'],
  ], 'unassigned');
  const approvedOld = importLoans([
    ['LOAN ID', 'FULL NAME', 'TRACK', 'TEAM', 'PRINCIPAL AMT', 'APPROVED DATE'],
    ['22171096811', 'MATUKA MASOUD', '1', 'SEGEREA', '500000', '22/6/2026'],
  ], 'approved');
  // Both rows are already in the table -- the twin an earlier append created.
  const db = fakeDb({ loans: applied.concat(approvedOld) });
  // The re-pulled approvals file carries BOTH identities, which is what proves the twins.
  const again = importLoans([
    ['DOCKET #', 'LOAN ID', 'FULL NAME', 'TRACK', 'TEAM', 'PRINCIPAL AMT', 'APPROVED DATE'],
    ['2-217-109681', '22171096811', 'MATUKA MASOUD', '1', 'SEGEREA', '500000', '22/6/2026'],
  ], 'approved');
  const rec = await reconcileLoanIds(db, again);
  assert.equal(rec.merged, 1, 'one of the two rows is provably the same loan filed twice');
  assert.equal(db._dump('loans').length, 1, 'the twin is gone');
  assert.equal(rec.records[0].id, approvedOld[0].id, 'the LOAN ID row is the keeper');
});

test('two different loans for the same customer are never confused', async () => {
  const { importLoans } = await import('../api/_lib/importers.js');
  const { reconcileLoanIds } = await import('../api/upload.js');
  // Track 1 exists; track 2 (the repeat loan) arrives. Same name, same phone.
  const first = importLoans([
    ['DOCKET #', 'FULL NAME', 'CONTACT #', 'TRACK', 'TEAM', 'REQUESTED AMT'],
    ['2-217-109681', 'MATUKA MASOUD', '0650941063', '1', 'SEGEREA', '500000'],
  ], 'unassigned');
  const db = fakeDb({ loans: first });
  const repeat = importLoans([
    ['DOCKET #', 'FULL NAME', 'CONTACT #', 'TRACK', 'TEAM', 'REQUESTED AMT'],
    ['2-300-200200', 'MATUKA MASOUD', '0650941063', '2', 'SEGEREA', '700000'],
  ], 'unassigned');
  const rec = await reconcileLoanIds(db, repeat);
  assert.equal(rec.relinked, 0, 'a repeat loan is a NEW loan, not an update of the first');
  assert.equal(rec.merged, 0);
});

test('the lenient phone match redirects but never deletes', async () => {
  const { importLoans } = await import('../api/_lib/importers.js');
  const { reconcileLoanIds } = await import('../api/upload.js');
  /* The stored twin has no phone -- the header mismatch dropped it for months -- and no
     docket or loan id in common. Track+name still finds it; nothing is deleted. */
  const stored = importLoans([
    ['FULL NAME', 'TRACK', 'TEAM', 'REQUESTED AMT'],
    ['MATUKA MASOUD', '1', 'SEGEREA', '500000'],
  ], 'unassigned');
  const db = fakeDb({ loans: stored });
  const incoming = importLoans([
    ['FULL NAME', 'CONTACT #', 'TRACK', 'TEAM', 'PRINCIPAL AMT', 'APPROVED DATE'],
    ['MATUKA MASOUD', '0650941063', '1', 'SEGEREA', '500000', '22/6/2026'],
  ], 'approved');
  const rec = await reconcileLoanIds(db, incoming);
  assert.equal(rec.relinked, 1, 'track+name with a missing phone is still the same loan');
  assert.equal(rec.merged, 0, 'the lenient form must never delete');
  assert.equal(rec.records[0].id, stored[0].id);
});

/* =====================================================================================
   AN APPLICATION-STAGE FILE IS THE WHOLE LIST FOR ITS DAY.
   =====================================================================================
   "when i reupload unassigned and assessed apps by append but same date, i need that
    action not to merge with existing but replace that single date data"

   Two uploads of the same stage under the same date cannot both be true -- the second IS
   the day, corrected. Append used to merge: matching loans updated, but a loan REMOVED
   from the corrected file lingered under that date. Now a same-date re-upload REDOES the
   date for the un-dated pipeline stages, whichever mode is chosen.
*/
test('re-uploading an application stage on the same date replaces that date, even on append', async () => {
  const { stampPlan } = await import('../api/upload.js');
  const NOON_EAT = Date.parse('2026-08-14T09:00:00Z');
  for (const stage of ['unassigned', 'unassessed', 'assessed', 'assigned']) {
    const p = stampPlan('loans', { uploadDate: '2026-08-14', mode: 'append', stage }, NOON_EAT);
    assert.equal(p.replace, true, stage + ': append must still redo the date');
    assert.equal(p.sameDayRedo, true);
    // Scoped to THIS stage and THIS date -- other days and the same day's other stages survive.
    assert.deepEqual(p.scope, { stage, upload_date: '2026-08-14' });
  }
});

test('the dated stages keep the append/replace choice', async () => {
  /* Approved and disbursed replace by the dates IN the file; appending there genuinely
     means "add more days" and must not quietly become a delete. */
  const { stampPlan } = await import('../api/upload.js');
  const NOON_EAT = Date.parse('2026-08-14T09:00:00Z');
  for (const stage of ['approved', 'disbursed']) {
    const p = stampPlan('loans', { uploadDate: '2026-08-14', mode: 'append', stage }, NOON_EAT);
    assert.equal(p.replace, false, stage + ': append stays append');
    assert.equal(p.sameDayRedo, false);
  }
});

test('other stamped reports are untouched by the redo rule', async () => {
  const { stampPlan } = await import('../api/upload.js');
  const NOON_EAT = Date.parse('2026-08-14T09:00:00Z');
  const p = stampPlan('complaints', { uploadDate: '2026-08-14', mode: 'append' }, NOON_EAT);
  assert.equal(p.replace, false);
  assert.equal(p.sameDayRedo, false);
});

/* =====================================================================================
   AN APPLICATION-STAGE UPLOAD ANSWERS TO THE CHOSEN DATE, AND ONLY TO IT.
   =====================================================================================
   "uploading unassigned and assigned apps should adhere to the chosen date at uploads not
    the date inside sheet data"

   The register exports every column for every row, so an applications sheet can carry an
   APPROVED DATE on loans nobody has approved -- and a stamped approval date on an
   'assigned' row makes every approved_date-windowed board count the app under the sheet's
   date instead of the chosen one.
*/
test('a pre-approval stage never imports the sheet\'s date columns', async () => {
  const { importLoans } = await import('../api/_lib/importers.js');
  const H = ['FULL NAME', 'TEAM', 'REQUESTED AMT', 'APPROVED DATE', 'DISB DATE'];
  for (const stage of ['unassigned', 'unassessed', 'assessed', 'assigned', 'pending_approval']) {
    const out = importLoans([H, ['APP PERSON', 'KONGOWE', '50000', '8/6/2026', '9/6/2026']], stage);
    assert.equal('approved_date' in out[0], false, stage + ' must not carry an approval date');
    assert.equal('disb_date' in out[0], false, stage + ' must not carry a disbursement date');
    assert.equal(out[0].requested_amt, 50000, 'the rest of the row still lands');
  }
});

test('approved and disbursed keep the dates in the file -- that is the report', async () => {
  const { importLoans } = await import('../api/_lib/importers.js');
  const H = ['FULL NAME', 'TEAM', 'APPROVED DATE'];
  const out = importLoans([H, ['SOLD PERSON', 'KONGOWE', '22/7/2026']], 'approved');
  assert.equal(out[0].approved_date, '2026-07-22');
});

/* =====================================================================================
   THE MANUAL SUMMARY REPORTS -- "when i miss the customers file time".
   =====================================================================================
   The Expected_Summary export: Team | Expected | Collected | Outstanding | ...% | Date.
   The defaulter summary: THREE exports (default, expired, chronic), each team_id |
   team_name | amount_defaulted -- highlighted together and summed into one report,
   because the batch rule keeps only the latest batch per date and three separate uploads
   would each replace the one before.
*/
test('the Expected_Summary shape: COLLECTED and OUTSTANDING read; the chosen date rules', async () => {
  const { importExpectedSummary } = await import('../api/_lib/importers.js');
  const rows = [
    ['Team', 'Expected', 'Collected', 'Outstanding', 'Collection %', 'Outstanding %', 'Date'],
    ['BABATI', '5530693', '5236027', '294666', '94.67%', '5.33%', '2026-08-17'],
    ['BUKOBA B', '2040043', '2040043', '0', '100.0%', '0.0%', '2026-08-17'],
  ];
  // The CHOSEN date rules -- the owner's standing rule, same as the application stages.
  // The file's Date column only pre-fills the box on the upload page.
  const out = importExpectedSummary(rows, { snapshotType: 'today', snapshotDate: '2026-08-17' });
  assert.equal(out.length, 2);
  assert.equal(out[0].snapshot_date, '2026-08-17', 'the box decides, exactly as chosen');
  assert.equal(out[0].collected_amt, 5236027, 'COLLECTED is the figure, not a sum of blanks');
  assert.equal(out[0].uncollected_amt, 294666, 'OUTSTANDING is the company\'s own uncollected');
  assert.equal(out[1].uncollected_amt, 0, 'a stated zero stays zero');
});

test('the workbook-tab shape still works exactly as before', async () => {
  const { importExpectedSummary } = await import('../api/_lib/importers.js');
  const out = importExpectedSummary([
    ['TEAMS', 'EXPECTED', 'PAID', 'ILIYONASIA', 'EXP TOMMR'],
    ['KONGOWE', '1000', '600', '100', '50'],
  ], { snapshotType: 'today', snapshotDate: '2026-08-18' });
  assert.equal(out[0].collected_amt, 750, 'the parts still sum where COLLECTED is absent');
  assert.equal(out[0].snapshot_date, '2026-08-18', 'no DATE column, so the chosen date holds');
});

test('the three defaulter segments sum into one row per team', async () => {
  const { importDefaulterSummary } = await import('../api/_lib/importers.js');
  // Concatenated the way the page sends the highlighted files: one header, all data rows.
  const rows = [
    ['team_id', 'team_name', 'amount_defaulted'],
    ['225-2069', 'MAFINGA', '8682526'],       // default segment
    ['208-2040', 'GONGOLAMBOTO ', '1418672'], // trailing space, as the real export writes it
    ['225-2069', 'MAFINGA', '41570555'],      // chronic segment, same team
    ['207-2039', 'KONGOWE', '3740000'],       // expired segment
  ];
  const out = importDefaulterSummary(rows, { snapshotType: 'current', snapshotDate: '2026-08-17', weekday: 'MON' });
  assert.equal(out.length, 3, 'one row per team, not per segment');
  assert.equal(out.find(r => r.team === 'MAFINGA').arrears_amt, 50253081, 'segments summed');
  assert.ok(out.find(r => r.team === 'GONGOLAMBOTO'), 'the trailing space is normalised away');
  assert.equal(out.find(r => r.team === 'KONGOWE').arrears_amt, 3740000);
});

/* =====================================================================================
   THE DATE DECIDES THE WEEKDAY. ALWAYS.
   =====================================================================================
   "remove the day thing since am choosing calender already -- its mixing me, am finding
    Monday always. I might disturb Mondays data while I always find todays date."

   Two boxes saying the same thing is two boxes that can disagree, and the disagreement is
   silent: a Tuesday deck stamped MON overwrites Monday's recovery pairing and hides itself
   from Tuesday. The date the person picked is the one fact, so the weekday is read from it.
*/
test('weekdayOfKey reads the real weekday of a chosen date', async () => {
  const { weekdayOfKey } = await import('../api/_lib/time.js');
  // The owner's own working days, checked against the calendar.
  assert.equal(weekdayOfKey('2026-08-17'), 'MON');
  assert.equal(weekdayOfKey('2026-08-18'), 'TUE');   // the day this was reported
  assert.equal(weekdayOfKey('2026-08-14'), 'FRI');   // the night-shift upload
  assert.equal(weekdayOfKey('2026-08-15'), 'SAT');
  assert.equal(weekdayOfKey('2026-08-16'), 'SUN');
  // A full week, so no off-by-one can hide in the middle of it.
  assert.deepEqual(
    ['2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-22','2026-08-23']
      .map(weekdayOfKey),
    ['MON','TUE','WED','THU','FRI','SAT','SUN']);
});

test('weekdayOfKey refuses anything that is not a real date key', async () => {
  const { weekdayOfKey } = await import('../api/_lib/time.js');
  for (const bad of ['', null, undefined, 'yesterday', '17/08/2026', '2026-8-1', 'not-a-date']) {
    assert.equal(weekdayOfKey(bad), null, String(bad) + ' must not produce a weekday');
  }
  // A full timestamp still answers for its own day rather than being refused.
  assert.equal(weekdayOfKey('2026-08-18T09:30:00Z'), 'TUE');
});

test('midnight and end-of-day both land on the same weekday', async () => {
  /* Read at noon UTC on purpose: a date key parsed at 00:00 can be tipped onto the previous
     day by any negative offset, which is exactly how a Tuesday becomes a Monday. */
  const { weekdayOfKey } = await import('../api/_lib/time.js');
  assert.equal(weekdayOfKey('2026-08-18'), 'TUE');
  assert.equal(weekdayOfKey('2026-08-18T00:00:00Z'), 'TUE');
  assert.equal(weekdayOfKey('2026-08-18T23:59:59Z'), 'TUE');
});

/* The four tests of retireSettledFromExpected stood here -- an expected upload clearing
   settled customers off the officers' register. Both the function and its tests are gone:
   "we should see defaulters from defaulters ... now you pulling defaulters from expected yet
   i upload my defaulters manually thats abusing me brother". The defaulters file writes the
   defaulters list; see the deck tests in portal.test.mjs for the rule that replaced this. */
