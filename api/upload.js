import { randomUUID } from 'node:crypto';
import { supabase } from './_lib/supabase.js';
import { authCode, can, withApi } from './_lib/auth.js';
import {
  importDefaulters, importExpected, importFollowup, importComments,
  importLoans, importTeams, importReceivedPayments,
  importAccessCodes, importUserRoles,
  importAbnormal, importComplaints, importRestructures, importDemandNotices,
  importCallUsers, importCallLogs, importSettings, importHints,
} from './_lib/importers.js';

// POST /api/upload   { code, type, meta, rows }
//   rows: the parsed sheet as an array-of-arrays, header row included -- the SAME shape
//         csv-parse produces for the CLI migration scripts, just coming from the
//         browser's SheetJS parse instead of a file on disk. Same importer functions,
//         same column-name mapping, same D.S/D.C text protection either way -- this
//         endpoint is not a second implementation of the import logic, it's the same one.
//   meta: { weekday, date } for defaulters/expected snapshots, { stage } for loans, else {}
/** THE UPLOAD STAMP: which report a row belongs to, and what a second upload of that same
    report does.

    The snapshot tables answer this already through snapshot_date + batch. The tables that
    ACCUMULATE could not: their rows only carried the dates INSIDE the file, and those are a
    different thing entirely -- a loan applications report pulled on 27 July legitimately
    contains applications dated in June. So the person uploading names the report's date, and
    says whether this file adds to that date or replaces it.

    Pure, so the decision is testable without a database: the route only carries it out. */
export const STAMPED_TABLES = new Set(['loans', 'received_payments', 'abnormal_payments',
  'complaints', 'restructures', 'demand_notices', 'followup_comments']);

export function stampPlan(table, meta = {}, nowMs = Date.now()) {
  if (!STAMPED_TABLES.has(table)) return { stamped: false, uploadDate: null, replace: false, scope: {} };
  // Free-form on purpose: yesterday's report can be re-done today without pretending it is
  // today's. Defaults to today on the EAT clock, not the server's UTC one.
  const uploadDate = /^\d{4}-\d{2}-\d{2}$/.test(String(meta.uploadDate || ''))
    ? String(meta.uploadDate)
    : new Date(nowMs + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const replace = String(meta.mode || '').toLowerCase() === 'replace';
  // The pipeline is uploaded one stage at a time, so replacing the 27th's APPROVED report must
  // not take the 27th's Assigned report with it.
  const scope = { upload_date: uploadDate };
  if (table === 'loans' && meta.stage) scope.stage = meta.stage;
  return { stamped: true, uploadDate, replace, scope };
}

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
    case 'abnormal':
      table = 'abnormal_payments';
      records = importAbnormal(rows);
      break;
    case 'complaints':
      table = 'complaints';
      records = importComplaints(rows);
      break;
    case 'restructures':
      table = 'restructures';
      records = importRestructures(rows);
      break;
    case 'demand-notices':
      table = 'demand_notices';
      records = importDemandNotices(rows);
      break;
    case 'call-users': {
      // team is a FK -- pass the real list so an unknown one is nulled instead of failing.
      const { data: t } = await supabase.from('teams').select('team');
      table = 'call_users';
      records = importCallUsers(rows, (t || []).map(x => x.team));
      break;
    }
    case 'call-logs':
      table = 'call_logs';
      records = importCallLogs(rows);
      break;
    case 'settings':
      table = 'settings';
      records = importSettings(rows);
      break;
    case 'hints':
      table = 'hints';
      records = importHints(rows);
      break;
    default: {
      const e = new Error(`Unknown upload type: ${type}`); e.status = 400; throw e;
    }
  }

  // Managing who can log in is a step above ordinary uploads. Gate it on the same
  // permission that marks admins in the live system: the 'settings' tab (ADMIN/CUSTOM
  // roles) -- the same people who could edit the Access Codes sheet in Google Sheets.
  const ADMIN_TABLES = new Set(['access_codes', 'roles', 'settings', 'hints', 'call_users']);
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

  /* THE UPLOAD STAMP, for the tables that accumulate.
     A loan applications report pulled on 27 July legitimately contains applications dated in
     June, so the dates INSIDE the file cannot say which report a row belongs to. The person
     uploading says: this is the report FOR this date. That handle is what makes "replace the
     27th, leave every other day alone" a thing anyone can ask for.
     The date defaults to today but is deliberately free -- yesterday's report can be re-done
     today without pretending it is today's. */
  const plan = stampPlan(table, meta);
  const { stamped, uploadDate } = plan;
  let replaced = 0;
  if (stamped) {
    uploadBatch = randomUUID();
    records = records.map(r => ({ ...r, upload_date: uploadDate, upload_batch: uploadBatch }));
  }

  // REPLACE ALL FOR THIS DATE. Only ever touches rows carrying this report's own stamp, so a
  // wrong or short report can be redone without disturbing any other day -- and without the
  // blunt alternative of clearing the whole table.
  if (plan.replace) {
    let q = supabase.from(table).delete();
    for (const [k, v] of Object.entries(plan.scope)) q = q.eq(k, v);
    const { data: gone, error: delErr } = await q.select('id');
    if (delErr) throw new Error('Could not clear the previous report for that date: ' + delErr.message);
    replaced = (gone || []).length;
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
  // Re-uploadable "current state per key" tables. call_logs is keyed by its deterministic id
  // so a re-upload of the same history collapses instead of duplicating every call.
  // `loans` is keyed on the loan's own identity (see loanId in importers.js), which is what
  // makes the pipeline behave the way it was designed to: ONE row per loan whose stage moves.
  // As a plain insert it appended, so uploading Unassigned then Assigned then Approved for the
  // same loan made three rows, and re-uploading Approved doubled the sales figure -- with
  // nothing on screen to say so.
  const upsertTables = {
    followup_status: 'ref', teams: 'team', access_codes: 'code', roles: 'role',
    settings: 'key', call_users: 'user_id', call_logs: 'id', loans: 'id',
  };

  // Hints are the one sheet that is REPLACED wholesale. A tab has MANY tips -- the reader
  // groups them into a list and rotates through it -- so 'tab' is not a key, and upserting on
  // it made Postgres refuse the whole upload the moment two rows shared a tab:
  //   ON CONFLICT DO UPDATE command cannot affect row a second time
  // The sheet is the full set of tips by definition, so deleting first is also what makes a
  // REMOVED tip actually disappear instead of lingering forever.
  if (table === 'hints') {
    const { error: delErr } = await supabase.from('hints').delete().not('tab', 'is', null);
    if (delErr) throw new Error('Could not clear the previous hints: ' + delErr.message);
  }

  const result = upsertTables[table]
    ? await supabase.from(table).upsert(records, { onConflict: upsertTables[table] })
    : await supabase.from(table).insert(records);
  if (result.error) throw new Error(result.error.message);

  // The CURRENT defaulter deck is also the officers' working list. The phone's Def/Exp/Chr
  // tabs and the portal's Followup tab both read followup_status, which only a separate
  // "Defaulters Followup" upload ever filled -- so uploading the deck left every officer
  // staring at an empty app, with nothing to say why. The live system rebuilt that list from
  // the deck automatically; this restores it.
  //
  // It MERGES rather than replaces: fu_status, promise_date, promise_amt and the last
  // comment are what officers typed and must survive an upload. Only the figures that come
  // from the deck are refreshed.
  let followupSynced = 0;
  if (type === 'defaulters-current') {
    followupSynced = await syncFollowupFromDeck(supabase, records);
  }

  // "Inserted 412" says nothing about whether a second upload of the same file doubles the
  // figures or corrects them, and there is no append-or-replace option to choose because the
  // answer is a property of the report, not of the moment. So the answer travels back with
  // every upload, in words.
  const behaviour = stamped
    ? (replaced || String(meta.mode || '').toLowerCase() === 'replace'
        ? { mode: 'replace-date', text: `Replaced the ${uploadDate} report: ${replaced} earlier row(s) removed, ${records.length} written. No other date was touched.` }
        : { mode: 'append', text: `Added to the ${uploadDate} report. Uploading the same file again under this date would store it twice — choose "Replace all for this date" to redo a day instead.` })
    : SNAPSHOT_TABLES.has(table)
    ? { mode: 'supersede', text: 'This date now reads from THIS upload. An earlier upload of the same date stays in history but no longer counts, so nothing is doubled.' }
    : table === 'hints'
      ? { mode: 'replace-all', text: 'The whole tip sheet was replaced. Tips you removed from the file are now gone from the app.' }
      : upsertTables[table]
        ? { mode: 'update', text: `Existing rows were UPDATED in place (matched on ${upsertTables[table] === 'id' && table === 'loans' ? 'the loan\'s own number' : upsertTables[table]}). Re-uploading corrects rather than duplicates.` }
        : { mode: 'append', text: 'These rows were ADDED to the history. Uploading the same file twice would store it twice.' };

  return {
    inserted: records.length, table, uploadBatch, uploadDate, replaced,
    followupSynced, behaviour,
    message: newTeams.length ? `Also auto-created ${newTeams.length} new team(s), not seen before: ${newTeams.join(', ')}. Worth a glance -- if any of these is actually a typo of an existing team, fix it in this table directly rather than leaving a duplicate.` : undefined
  };
});

/** Refresh followup_status from a current-defaulter deck, keeping whatever the officers have
    already entered. Customers who have left the deck keep their row (their history is still
    worth reading) but stop looking like live defaulters, so they drop off the working list
    instead of being called for a debt they have already cleared. */
export async function syncFollowupFromDeck(db, records) {
  const refs = records.map(r => String(r.ref)).filter(Boolean);
  if (!refs.length) return 0;
  const { data: existing, error: exErr } = await db
    .from('followup_status').select('ref, fu_status, promise_date, promise_amt, last_comment, comment_by, comment_at');
  if (exErr) throw new Error(exErr.message);
  const prev = {};
  for (const r of existing || []) prev[String(r.ref).trim().toUpperCase()] = r;

  const rows = records.map(d => {
    const k = String(d.ref).trim().toUpperCase();
    const p = prev[k] || {};
    return {
      ref: String(d.ref), team: d.team || null, full_name: d.full_name || null,
      contact: d.contact || null,
      guarantor_name: d.guarantor_name || null, guarantor_contact: d.guarantor_contact || null,
      disb_date: d.disb_date || null, last_trans: d.last_trans_date || null,
      status: d.status || null, ds: d.ds || null, dc: d.dc == null ? null : d.dc,
      days_elapsed: d.days_elapsed == null ? null : d.days_elapsed,
      rejesho: d.other_inst == null ? null : d.other_inst,
      arrears: d.arrears == null ? null : d.arrears,
      // Everything below is the officer's own work -- never overwritten by an upload.
      fu_status: p.fu_status || null, promise_date: p.promise_date || null,
      promise_amt: p.promise_amt == null ? null : p.promise_amt,
      last_comment: p.last_comment || null, comment_by: p.comment_by || null,
      comment_at: p.comment_at || null,
      updated_at: new Date().toISOString(),
    };
  });
  // Customers no longer in the deck: blank the deck-derived figures so they stop showing as
  // live defaulters, while their comment history stays attached to the ref.
  const inDeck = new Set(rows.map(r => String(r.ref).trim().toUpperCase()));
  const gone = (existing || [])
    .filter(r => !inDeck.has(String(r.ref).trim().toUpperCase()))
    .map(r => ({ ref: r.ref, status: null, arrears: null, updated_at: new Date().toISOString() }));

  for (const batch of [rows, gone]) {
    if (!batch.length) continue;
    const { error } = await db.from('followup_status').upsert(batch, { onConflict: 'ref' });
    if (error) throw new Error(error.message);
  }
  return rows.length;
}
