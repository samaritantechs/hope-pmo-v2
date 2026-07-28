// The two admin-sheet importers: the workbook's Access Codes / User Roles tabs become
// access_codes / roles rows, managed by re-uploading the sheet instead of writing SQL.

import test from 'node:test';
import assert from 'node:assert/strict';

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
