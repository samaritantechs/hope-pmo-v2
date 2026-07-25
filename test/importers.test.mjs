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
