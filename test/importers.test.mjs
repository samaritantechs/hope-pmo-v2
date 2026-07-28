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
  const rep = stampPlan('received_payments', { uploadDate: '2026-07-27', mode: 'replace' }, NOON_EAT);
  assert.equal(rep.replace, true);
  assert.deepEqual(rep.scope, { upload_date: '2026-07-27' });

  // The pipeline uploads one stage at a time, so replacing the 27th's APPROVED report must not
  // take the 27th's ASSIGNED report with it.
  const loans = stampPlan('loans', { uploadDate: '2026-07-27', mode: 'replace', stage: 'approved' }, NOON_EAT);
  assert.deepEqual(loans.scope, { upload_date: '2026-07-27', stage: 'approved' });
});
