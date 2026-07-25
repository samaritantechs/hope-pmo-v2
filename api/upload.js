import { randomUUID } from 'node:crypto';
import { supabase } from './_lib/supabase.js';
import { authCode, can, withApi } from './_lib/auth.js';
import {
  importDefaulters, importExpected, importFollowup, importComments,
  importLoans, importTeams, importReceivedPayments,
  importAccessCodes, importUserRoles,
} from './_lib/importers.js';

// POST /api/upload   { code, type, meta, rows }
//   rows: the parsed sheet as an array-of-arrays, header row included -- the SAME shape
//         csv-parse produces for the CLI migration scripts, just coming from the
//         browser's SheetJS parse instead of a file on disk. Same importer functions,
//         same column-name mapping, same D.S/D.C text protection either way -- this
//         endpoint is not a second implementation of the import logic, it's the same one.
//   meta: { weekday, date } for defaulters/expected snapshots, { stage } for loans, else {}
export default withApi(async (req, res) => {
  if (req.method !== 'POST') { const e = new Error('Method not allowed'); e.status = 405; throw e; }
  const { code, type, meta = {}, rows } = req.body || {};
  const user = await authCode(code);
  if (!(await can(user, 'upload'))) { const e = new Error('Upload permission is required for your access code.'); e.status = 403; throw e; }
  if (!Array.isArray(rows) || rows.length < 2) { const e = new Error('No data rows found in the file.'); e.status = 400; throw e; }

  let table, records;
  switch (type) {
    case 'defaulters-current':
    case 'defaulters-initial':
      if (!meta.weekday || !meta.date) { const e = new Error('weekday and date are required for a Defaulters upload.'); e.status = 400; throw e; }
      table = 'defaulter_snapshots';
      records = importDefaulters(rows, { snapshotType: type === 'defaulters-initial' ? 'initial' : 'current', weekday: meta.weekday, snapshotDate: meta.date });
      break;
    case 'expected-today':
    case 'expected-tomorrow':
    case 'expected-yesterday':
    case 'expected-initial':
      if (!meta.date) { const e = new Error('date is required for an Expected upload.'); e.status = 400; throw e; }
      table = 'repayment_snapshots';
      records = importExpected(rows, { snapshotType: type.replace('expected-', ''), snapshotDate: meta.date });
      break;
    case 'followup':
      table = 'followup_status';
      records = importFollowup(rows);
      break;
    case 'comments':
      table = 'followup_comments';
      records = importComments(rows);
      break;
    case 'loans':
      if (!meta.stage) { const e = new Error('stage is required for a loan-pipeline upload.'); e.status = 400; throw e; }
      table = 'loans';
      records = importLoans(rows, meta.stage);
      break;
    case 'teams':
      table = 'teams';
      records = importTeams(rows);
      break;
    case 'received':
      table = 'received_payments';
      records = importReceivedPayments(rows);
      break;
    case 'access-codes':
      table = 'access_codes';
      records = importAccessCodes(rows);
      break;
    case 'user-roles':
      table = 'roles';
      records = importUserRoles(rows);
      break;
    default: {
      const e = new Error(`Unknown upload type: ${type}`); e.status = 400; throw e;
    }
  }

  // Managing who can log in is a step above ordinary uploads. Gate it on the same
  // permission that marks admins in the live system: the 'settings' tab (ADMIN/CUSTOM
  // roles) -- the same people who could edit the Access Codes sheet in Google Sheets.
  const ADMIN_TABLES = new Set(['access_codes', 'roles']);
  if (ADMIN_TABLES.has(table) && !(await can(user, 'settings'))) {
    const e = new Error('Managing access codes or roles requires the settings (admin) permission.'); e.status = 403; throw e;
  }

  if (!records.length) return { inserted: 0, table, message: 'File parsed but no valid rows were found -- check the key column (REF#, FULLNAME, etc.) is present and populated.' };

  // One uuid per upload, stamped across every row of it. Snapshots are append-only -- a
  // re-upload of the same date ADDS rows, never overwrites -- so without this, a corrected
  // re-upload stacked both copies into every KPI. Readers resolve latest date -> latest
  // batch within it (api/_lib/snapshots.js), so the newest upload wins while the full
  // history stays underneath.
  const SNAPSHOT_TABLES = new Set(['defaulter_snapshots', 'repayment_snapshots']);
  let uploadBatch;
  if (SNAPSHOT_TABLES.has(table)) {
    uploadBatch = randomUUID();
    records = records.map(r => ({ ...r, upload_batch: uploadBatch }));
  }

  // Tables that reference teams.team as a foreign key -- auto-create any team name that
  // doesn't exist yet, rather than blocking the upload. Your team list grows over time; a new
  // team's first Defaulters/Expected file shouldn't have to wait on someone remembering to
  // register it first. New teams get blank role columns (no leader assigned yet) -- fill those
  // in later via Leaders/Teams or a teams-editing screen.
  const TEAM_REF_TABLES = new Set(['defaulter_snapshots', 'repayment_snapshots', 'followup_status', 'loans']);
  let newTeams = [];
  if (TEAM_REF_TABLES.has(table)) {
    const incomingTeams = [...new Set(records.map(r => r.team).filter(Boolean))];
    if (incomingTeams.length) {
      const { data: existingTeams, error: teamErr } = await supabase.from('teams').select('team').in('team', incomingTeams);
      if (teamErr) throw new Error('Could not verify team names: ' + teamErr.message);
      const known = new Set((existingTeams || []).map(t => t.team));
      newTeams = incomingTeams.filter(t => !known.has(t));
      if (newTeams.length) {
        const { error: createErr } = await supabase.from('teams').insert(newTeams.map(team => ({ team })));
        if (createErr) throw new Error('Could not auto-create new team(s) (' + newTeams.join(', ') + '): ' + createErr.message);
      }
    }
  }

  // followup_status and teams are "current state per key" -- re-uploading updates in
  // place. Everything else (snapshots, loans, comments, payments) is append-only history:
  // a fresh "today" upload is a NEW today, never an overwrite of a previous one.
  const upsertTables = { followup_status: 'ref', teams: 'team', access_codes: 'code', roles: 'role' };
  const result = upsertTables[table]
    ? await supabase.from(table).upsert(records, { onConflict: upsertTables[table] })
    : await supabase.from(table).insert(records);
  if (result.error) throw new Error(result.error.message);

  return {
    inserted: records.length, table, uploadBatch,
    message: newTeams.length ? `Also auto-created ${newTeams.length} new team(s), not seen before: ${newTeams.join(', ')}. Worth a glance -- if any of these is actually a typo of an existing team, fix it in this table directly rather than leaving a duplicate.` : undefined
  };
});
