// The two admin-sheet importers: the workbook's Access Codes / User Roles tabs become
// access_codes / roles rows, managed by re-uploading the sheet instead of writing SQL.

import test from 'node:test';
import assert from 'node:assert/strict';

// upload.js builds its Supabase client at import time; these keep that from throwing in
// tests that only exercise its pure helpers.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { importAccessCodes, importUserRoles } = await import('../api/_lib/importers.js');

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
