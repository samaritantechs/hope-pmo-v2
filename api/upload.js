import { randomUUID } from 'node:crypto';
import { supabase } from './_lib/supabase.js';
import { gatedUser, can, withApi } from './_lib/auth.js';
import { pickLatestBatch } from './_lib/snapshots.js';
import { addDaysKey as addDays_ } from './_lib/time.js';
import {
  importDefaulters, importExpected, importFollowup, importComments, commentsDateOrder,
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

/* Four of the stamped tables are ALSO written by people inside the app -- an officer's
   follow-up comment, a complaint logged at the desk, a restructure request, a demand notice
   issued from the Legal screen. Those rows are somebody's work, not part of any upload, and
   "replace the 27th's report" must never take them.

   They are told apart by upload_batch: a row that arrived in an upload has one, a row typed in
   the app does not. Rows that predate the stamp do not have one either, which is the safe way
   round -- they survive.

   The other three are only ever uploaded, so replacing a date there can take everything
   carrying that stamp, including rows backfilled when the stamp was introduced. */
export const APP_WRITABLE_TABLES = new Set(['complaints', 'restructures', 'demand_notices',
  'followup_comments']);

/* TWO REPORTS CARRY THEIR OWN DATES, AND THOSE DATES ARE THE TRUTH.
   A loan approvals report says when each loan was approved. A received payments report says
   when each payment came in. Every figure in the system already reads those columns and always
   has -- sales, the weekly boards, commission, the officer boards. The upload stamp has never
   been part of any number.

   Where the stamp DID still rule was Replace, and that was wrong for these two. Re-pull the
   approvals report for 27 July, upload it as a correction, and "Replace" would have removed
   whatever was uploaded under today's stamp instead of the 27 July approvals you meant to
   correct. So for these two, Replace now works off the dates in the file.

   Deliberately the EXACT SET of dates found in the file, never the span between the earliest
   and the latest. One mistyped year in one cell would otherwise turn "redo 27 July" into
   "delete everything between 1970 and now". With a set, a stray date can only ever clear that
   stray date -- almost always nothing at all.

   Every other report keeps the stamp, because a loan APPLICATIONS report pulled on 27 July
   legitimately contains applications dated in June: the dates inside cannot say which report a
   row belongs to, so the person uploading has to. */
export const DATA_DATED = {
  received_payments: { col: 'paid_at' },
  loans: { byStage: { approved: 'approved_date', disbursed: 'disb_date' } },
};
export function dataDateColumn(table, stage) {
  const d = DATA_DATED[table];
  if (!d) return null;
  if (d.col) return d.col;
  return (d.byStage && d.byStage[String(stage || '')]) || null;
}
/** The distinct dates this file is actually about. Blank and unreadable dates are dropped:
    a row with no date of its own belongs to no day, so it can neither be replaced by date nor
    take a day down with it -- it is simply added. */
export function datesInFile(records, col) {
  const seen = new Set();
  for (const r of records) {
    const v = String(r[col] == null ? '' : r[col]).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) seen.add(v);
  }
  return [...seen].sort();
}
/* One report is one day, or a few. A file claiming hundreds of distinct days is not a report
   being corrected -- it is a whole history, or a column of rubbish being read as dates, and
   turning that into a delete is not a risk worth taking. Append still works; only Replace
   stops, and it says why. */
export const MAX_REPLACE_DATES = 62;

/** REPLACE ALL FOR THIS DAY. This is the only code in the system that deletes anybody's
    figures, so every path out of it is deliberate:
      - Not replacing? Touch nothing.
      - Approvals / received payments? Clear exactly the days found in the file, and no others.
        A file with no readable dates, or one claiming more days than any real report covers,
        is REFUSED rather than guessed at -- refusing costs someone a second upload, guessing
        costs them their records.
      - Everything else? Clear that report's own stamp, one pipeline stage at a time.
      - Tables people also type into inside the app? Never take a row that did not arrive in an
        upload.
    Takes the database as an argument so the deletes can be watched in a test. */
export async function runReplace(db, table, plan, records) {
  if (!plan || !plan.replace) return { replaced: 0, replacedDates: null };
  let replacedDates = null;
  if (plan.dateCol) {
    replacedDates = datesInFile(records, plan.dateCol);
    if (!replacedDates.length) {
      const e = new Error('This file has no readable dates in its "' + plan.dateCol.replace(/_/g, ' ')
        + '" column, so there is no day to replace. Upload it with "Ongeza / Append" instead, or check the file.');
      e.status = 400; throw e;
    }
    if (replacedDates.length > MAX_REPLACE_DATES) {
      const e = new Error('This file covers ' + replacedDates.length + ' different days ('
        + replacedDates[0] + ' to ' + replacedDates[replacedDates.length - 1]
        + '). That is too much history to replace in one go — it usually means the wrong column is being read as a date. '
        + 'Upload it with "Ongeza / Append", or split it into single days.');
      e.status = 400; throw e;
    }
  }
  let q = db.from(table).delete();
  for (const [k, v] of Object.entries(plan.scope)) q = q.eq(k, v);
  if (replacedDates) q = q.in(plan.dateCol, replacedDates);
  // Never take what a person typed in the app.
  if (plan.uploadedOnly) q = q.not('upload_batch', 'is', null);
  const { data: gone, error: delErr } = await q.select('id');
  if (delErr) throw new Error('Could not clear the previous report for that date: ' + delErr.message);
  return { replaced: (gone || []).length, replacedDates };
}

/** TWO ROWS IN ONE FILE CANNOT CLAIM THE SAME KEY.
 *
 *  Postgres will not let one statement update the same row twice:
 *    ON CONFLICT DO UPDATE command cannot affect row a second time
 *  It does not skip the second row -- it refuses the WHOLE upload, and the message names no
 *  file, no column and no customer. Somebody holding a year of history has nothing to act on.
 *
 *  A v1 comment export genuinely contains duplicates: the same sentence about the same customer
 *  at the same minute, because the sheet was exported twice or a row was copied down. commentId
 *  hashes exactly those fields, so those rows share an id BY DESIGN -- which is what makes
 *  re-uploading a half-loaded history collapse instead of double. The identity that protects
 *  the second upload is what broke the first.
 *
 *  Sending it once is all that was ever meant. THE LAST OCCURRENCE WINS, matching what a
 *  re-upload does: later in the file is later in time, so the file's own last word stands.
 *
 *  Rows with no key are left alone rather than dropped -- the upsert will then fail on its own
 *  terms, which is a more honest error than quietly discarding somebody's rows here.
 */
export function dedupeByKey(records, key) {
  const seen = new Map();
  let collapsed = 0;
  for (const r of records) {
    const k = r == null ? null : r[key];
    if (k == null || k === '') continue;
    if (seen.has(String(k))) collapsed++;
    seen.set(String(k), r);
  }
  if (!collapsed) return { records, collapsed: 0 };
  return { records: records.filter(r => r == null || r[key] == null || r[key] === '' || seen.get(String(r[key])) === r), collapsed };
}

export function stampPlan(table, meta = {}, nowMs = Date.now()) {
  if (!STAMPED_TABLES.has(table)) {
    return { stamped: false, uploadDate: null, replace: false, scope: {}, uploadedOnly: false };
  }
  // Free-form on purpose: yesterday's report can be re-done today without pretending it is
  // today's. Defaults to today on the EAT clock, not the server's UTC one.
  const uploadDate = /^\d{4}-\d{2}-\d{2}$/.test(String(meta.uploadDate || ''))
    ? String(meta.uploadDate)
    : new Date(nowMs + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const replace = String(meta.mode || '').toLowerCase() === 'replace';
  // The pipeline is uploaded one stage at a time, so replacing the 27th's APPROVED report must
  // not take the 27th's Assigned report with it.
  const scope = {};
  if (table === 'loans' && meta.stage) scope.stage = meta.stage;
  // Approvals and received payments are matched on the dates in the file (filled in later, once
  // the file has been read). Everything else is matched on the stamp the uploader chose.
  const dateCol = dataDateColumn(table, meta.stage);
  if (!dateCol) scope.upload_date = uploadDate;
  return { stamped: true, uploadDate, replace, scope, dateCol,
           uploadedOnly: APP_WRITABLE_TABLES.has(table) };
}

export default withApi(async (req, res) => {
  if (req.method !== 'POST') { const e = new Error('Method not allowed'); e.status = 405; throw e; }
  const { code, type, meta = {}, rows } = req.body || {};
  // Uploading is a system-side act, so it closes with the rest of the system. An admin
  // still gets through -- somebody has to be able to load the day's files either way.
  const user = await gatedUser(code);
  if (!(await can(user, 'upload'))) { const e = new Error('Upload permission is required for your access code.'); e.status = 403; throw e; }
  if (!Array.isArray(rows) || rows.length < 2) { const e = new Error('No data rows found in the file.'); e.status = 400; throw e; }

  let table, records, commentsOrder = null;
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
      commentsOrder = commentsDateOrder(rows);
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

  const { replaced: nReplaced, replacedDates } = await runReplace(supabase, table, plan, records);
  replaced = nReplaced;

  // Tables that reference teams.team as a foreign key -- auto-create any team name that
  // doesn't exist yet, rather than blocking the upload. Your team list grows over time; a new
  // team's first Defaulters/Expected file shouldn't have to wait on someone remembering to
  // register it first. New teams get blank role columns (no leader assigned yet) -- fill those
  // in later via Leaders/Teams or a teams-editing screen.
  const TEAM_REF_TABLES = new Set(['defaulter_snapshots', 'repayment_snapshots', 'followup_status', 'loans',
    'followup_comments']);
  let newTeams = [], stubbed = 0;
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
  /* A COMMENT HAS TO HAVE SOMEBODY TO BE ABOUT.

     followup_comments.ref is a foreign key into followup_status, so importing years of v1
     history fails outright the moment it mentions a customer who is not on today's follow-up
     list -- which, over a year of history, is most of them. Not a few rows rejected: the whole
     upload refused, with a foreign-key error nobody outside this file can act on.

     So the missing ones are created as stubs first -- ref, team and name, nothing else. This
     is the SAME stub the Calls app already creates when an officer comments on an Expected
     customer who is not a defaulter, and every screen already knows to skip them: a row with
     no status and no arrears is not a defaulter and is never counted as one. */
  if (table === 'followup_comments') {
    const refs = [...new Set(records.map(r => r.ref).filter(Boolean))];
    const known = new Set();
    // Chunked: a year of history can mention tens of thousands of customers, and a single
    // .in() with all of them is a URL no server will accept.
    for (let i = 0; i < refs.length; i += 500) {
      const { data, error } = await supabase.from('followup_status').select('ref').in('ref', refs.slice(i, i + 500));
      if (error) throw new Error('Could not check which customers already exist: ' + error.message);
      for (const r of (data || [])) known.add(String(r.ref));
    }
    const missing = refs.filter(r => !known.has(String(r)));
    if (missing.length) {
      // The name and team off the first comment that mentions them -- the only thing the file
      // knows about a customer it is only quoting.
      const first = new Map();
      for (const r of records) if (r.ref && !first.has(String(r.ref))) first.set(String(r.ref), r);
      const stubs = missing.map(ref => {
        const r = first.get(String(ref)) || {};
        return { ref, team: r.team || null, full_name: r.full_name || null };
      });
      for (let i = 0; i < stubs.length; i += 500) {
        const { error } = await supabase.from('followup_status')
          .upsert(stubs.slice(i, i + 500), { onConflict: 'ref', ignoreDuplicates: true });
        if (error) throw new Error('Could not create customer records for the comments: ' + error.message);
      }
      stubbed = stubs.length;
    }
  }

  const upsertTables = {
    followup_status: 'ref', teams: 'team', access_codes: 'code', roles: 'role',
    settings: 'key', call_users: 'user_id', call_logs: 'id', loans: 'id',
    /* Keyed on the comment's own identity (importers.js commentId), so re-uploading a history
       file that was already partly loaded collapses instead of doubling every comment in it.
       Importing years of history is never done in one clean go. */
    followup_comments: 'id',
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

  // Two rows in one file cannot claim the same key -- see dedupeByKey.
  let collapsed = 0;
  if (upsertTables[table]) {
    const d = dedupeByKey(records, upsertTables[table]);
    records = d.records; collapsed = d.collapsed;
  }

  const result = upsertTables[table]
    ? await supabase.from(table).upsert(records, { onConflict: upsertTables[table] })
    : await supabase.from(table).insert(records);
  if (result.error) throw new Error(result.error.message);

  /* THE FIGURES ON EVERY PHONE ARE NOW OUT OF DATE, AND ONLY THIS CODE KNOWS IT.
     The performance strip is worked out from the whole book, so it is far too expensive to
     recompute on a timer for two hundred officers. It was therefore refreshed a quarter of an
     hour after the fact at best -- which is a long time to stand in front of a manager holding
     a phone that still shows this morning.
     One line moved here instead: the moment anything is uploaded, the stamp changes, every
     phone's next routine sync sees a different value, and only then does it ask for new
     figures. Cost when nothing is uploaded: nothing at all.
     Deliberately not fatal. An upload that WORKED must not be reported as failed because a
     bookkeeping stamp did not save. */
  try {
    await supabase.from('settings')
      .upsert({ key: 'DATA_VERSION', value: String(Date.now()) }, { onConflict: 'key' });
  } catch (e) { /* the data is in; the phones will catch up on their own schedule */ }

  // The CURRENT defaulter deck is also the officers' working list. The phone's Def/Exp/Chr
  // tabs and the portal's Followup tab both read followup_status, which only a separate
  // "Defaulters Followup" upload ever filled -- so uploading the deck left every officer
  // staring at an empty app, with nothing to say why. The live system rebuilt that list from
  // the deck automatically; this restores it.
  //
  // It MERGES rather than replaces: fu_status, promise_date, promise_amt and the last
  // comment are what officers typed and must survive an upload. Only the figures that come
  // from the deck are refreshed.
  /* LEO AND KESHO SHOWING THE SAME PEOPLE.
     Kesho is the sheet dated tomorrow; where none exists it falls back to the older
     "Expected - Tomorrow" upload type, which by the live system's convention is stamped with
     TODAY's date. Both readings are correct -- but if the SAME file is uploaded under both
     Today and Tomorrow for one date, the two tabs resolve to the same customers and officers
     work one list twice while the other day goes uncalled.
     The system cannot tell which of the two was the mistake, so it does not guess: it says
     what it found, at the moment it can still be undone. */
  let sameAsToday = 0;
  if (type === 'expected-tomorrow' || type === 'expected-today') {
    const other = type === 'expected-tomorrow' ? 'today' : 'tomorrow';
    const { data: existing } = await supabase.from('repayment_snapshots')
      .select('ref').eq('snapshot_type', other).eq('snapshot_date', meta.date).limit(2000);
    if (existing && existing.length) {
      const have = new Set(existing.map(r => String(r.ref)));
      const mine = new Set(records.map(r => String(r.ref)));
      let shared = 0;
      for (const r of mine) if (have.has(r)) shared++;
      // Two lists for different days share SOME customers; being all but identical is the
      // signature of the same file uploaded twice.
      if (shared / Math.max(mine.size, 1) >= 0.95) sameAsToday = shared;
    }
  }

  let followupSynced = 0;
  if (type === 'defaulters-current') {
    followupSynced = await syncFollowupFromDeck(supabase, records, meta.weekday, uploadBatch, meta.date);
  }

  // "Inserted 412" says nothing about whether a second upload of the same file doubles the
  // figures or corrects them, and there is no append-or-replace option to choose because the
  // answer is a property of the report, not of the moment. So the answer travels back with
  // every upload, in words.
  // Which days this actually touched, said the way the uploader thinks about it. For approvals
  // and received payments that is the days INSIDE the file, and naming them is the whole point:
  // someone redoing 27 July needs to see "27 July" and not the day they pressed the button.
  const dayPhrase = replacedDates
    ? (replacedDates.length === 1 ? replacedDates[0]
       : replacedDates.length <= 4 ? replacedDates.join(', ')
       : `${replacedDates.length} days, ${replacedDates[0]} to ${replacedDates[replacedDates.length - 1]}`)
    : uploadDate;
  const behaviour = stamped
    ? (replaced || String(meta.mode || '').toLowerCase() === 'replace'
        ? { mode: 'replace-date', text: `Replaced ${dayPhrase}: ${replaced} earlier row(s) removed, ${records.length} written. No other day was touched.`
            + (plan.dateCol ? ` The days come from the "${plan.dateCol.replace(/_/g, ' ')}" column in your file, not from the upload date.` : '')
            + (plan.uploadedOnly ? ' Anything staff entered in the app was left alone — only uploaded rows were replaced.' : '') }
        : { mode: 'append', text: plan.dateCol
            ? `Added. Each row counts under its own "${plan.dateCol.replace(/_/g, ' ')}" from the file, so re-pulled dates land on the right day — but uploading the same file twice would store it twice. Choose "Badilisha yote / Replace all" to redo a day instead.`
            : `Added to the ${uploadDate} report. Uploading the same file again under this date would store it twice — choose "Replace all for this date" to redo a day instead.` })
    : SNAPSHOT_TABLES.has(table)
    ? { mode: 'supersede', text: 'This date now reads from THIS upload. An earlier upload of the same date stays in history but no longer counts, so nothing is doubled.' }
    : table === 'hints'
      ? { mode: 'replace-all', text: 'The whole tip sheet was replaced. Tips you removed from the file are now gone from the app.' }
      : upsertTables[table]
        ? { mode: 'update', text: `Existing rows were UPDATED in place (matched on ${upsertTables[table] === 'id' && table === 'loans' ? 'the loan\'s own number' : upsertTables[table]}). Re-uploading corrects rather than duplicates.` }
        : { mode: 'append', text: 'These rows were ADDED to the history. Uploading the same file twice would store it twice.' };

  return {
    inserted: records.length, table, uploadBatch, uploadDate, replaced,
    followupSynced, behaviour, sameAsToday,
    stubbed: stubbed || undefined,
    collapsed: collapsed || undefined,
    /* Reading a date column the wrong way round moves history by up to eleven months and looks
       entirely reasonable in the result, so the file is told what was decided about it. */
    dateOrder: commentsOrder ? (commentsOrder.dayFirst === null ? 'assumed day/month (the file gave no clue either way -- if these are American dates, check a few)'
      : commentsOrder.dayFirst ? 'day/month, as the file itself showed' : 'month/day, as the file itself showed') : undefined,
    unreadableStamps: commentsOrder && commentsOrder.unreadable ? commentsOrder.unreadable : undefined,
    message: [
      newTeams.length ? `Also auto-created ${newTeams.length} new team(s), not seen before: ${newTeams.join(', ')}. Worth a glance -- if any of these is actually a typo of an existing team, fix it in this table directly rather than leaving a duplicate.` : '',
      stubbed ? `${stubbed} of these customers were not on the follow-up list, so a placeholder record was created for each so their history has somewhere to live. They are NOT counted as defaulters anywhere -- a placeholder has no status and no arrears.` : '',
      collapsed ? `${collapsed} row(s) in the file were the same record twice and were written once. ${table === 'followup_comments' ? 'For comments that means the same sentence about the same customer at the same minute -- one comment, exported twice.' : `Matched on ${upsertTables[table]}.`} Nothing was lost: the file's last version of each is what was kept.` : '',
      commentsOrder && commentsOrder.unreadable ? `${commentsOrder.unreadable} row(s) had a TIMESTAMP that could not be read; those are stamped with the time of this upload instead.` : '',
    ].filter(Boolean).join(' ') || undefined
  };
});

/** Refresh followup_status from a current-defaulter deck, keeping whatever the officers have
    already entered. Customers who have left the deck keep their row (their history is still
    worth reading) but stop looking like live defaulters, so they drop off the working list
    instead of being called for a debt they have already cleared. */
/** The refs on the latest CURRENT deck for one weekday, other than the one just uploaded.
 *
 *  Two bounded queries, never a table scan: the newest date for that weekday, then that date's
 *  rows. An upload is not a screen, but it is still somebody standing at a laptop waiting.
 *
 *  Returns null when there is no previous deck for this weekday at all -- which must mean
 *  "blank nobody", not "blank everybody". */
async function prevWeekdayDeck(db, weekday, excludeBatch) {
  if (!weekday) return null;
  const base = () => db.from('defaulter_snapshots')
    .select('ref, snapshot_date, upload_batch, created_at')
    .eq('snapshot_type', 'current').eq('weekday', weekday);
  const { data: latest } = await base().order('snapshot_date', { ascending: false }).limit(1).maybeSingle();
  if (!latest) return null;
  const { data: rows } = await base().eq('snapshot_date', latest.snapshot_date);
  const others = (rows || []).filter(r => String(r.upload_batch || '') !== String(excludeBatch || ''));
  if (!others.length) return null;                       // that date IS this upload, nothing before it
  return new Set(pickLatestBatch(others).map(r => String(r.ref).trim().toUpperCase()));
}

/** THE DECKS ARE PER WEEKDAY, and this used to forget that.
 *
 *  It blanked every customer who was not in the file just uploaded -- so uploading Monday's
 *  current deck cleared the status and arrears of every defaulter whose follow-up day is
 *  Tuesday through Sunday, and then Tuesday's upload cleared Monday's back again. The
 *  Defaulters list on every phone showed roughly a seventh of the book, and which seventh
 *  depended on whichever deck had been loaded last.
 *
 *  A Monday deck says something about Monday's defaulters and NOTHING about anybody else's, so
 *  only Monday's are compared against it. */
/** How long a customer may sit on the working list without a deck confirming them.
    A weekday's deck should come round every seven days, so a fortnight is forgiving. */
const FU_STALE_DAYS = 14;

export async function syncFollowupFromDeck(db, records, weekday, uploadBatch, deckDate) {
  const refs = records.map(r => String(r.ref)).filter(Boolean);
  if (!refs.length) return 0;
  /* deck_date is read defensively: it arrived in a later migration, and migrations here are
     run by hand. A database that has not had it yet simply reports the column as unknown, and
     everything below carries on without the stamp. */
  let stamped = true;
  let existing = null;
  {
    const withDeck = await db.from('followup_status')
      .select('ref, fu_status, promise_date, promise_amt, last_comment, comment_by, comment_at, deck_date');
    if (withDeck.error) {
      stamped = false;
      const plain = await db.from('followup_status')
        .select('ref, fu_status, promise_date, promise_amt, last_comment, comment_by, comment_at');
      if (plain.error) throw new Error(plain.error.message);
      existing = plain.data;
    } else existing = withDeck.data;
  }
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
      // When a deck last confirmed this customer, so a row nobody re-confirms can be retired.
      ...(stamped ? { deck_date: deckDate || null } : {}),
      // Everything below is the officer's own work -- never overwritten by an upload.
      fu_status: p.fu_status || null, promise_date: p.promise_date || null,
      promise_amt: p.promise_amt == null ? null : p.promise_amt,
      last_comment: p.last_comment || null, comment_by: p.comment_by || null,
      comment_at: p.comment_at || null,
      updated_at: new Date().toISOString(),
    };
  });
  /* Customers who have LEFT THIS WEEKDAY'S deck: blank the deck-derived figures so they stop
     showing as live defaulters, while their comment history stays attached to the ref.

     Only the people who were on this weekday's previous deck are candidates. Somebody whose
     follow-up day is Thursday is not "gone" because Monday's file does not mention them. */
  const inDeck = new Set(rows.map(r => String(r.ref).trim().toUpperCase()));
  const wasHere = await prevWeekdayDeck(db, weekday, uploadBatch);
  const leftThisWeekday = new Set(!wasHere ? [] : (existing || [])
    .map(r => String(r.ref).trim().toUpperCase())
    .filter(k => wasHere.has(k) && !inDeck.has(k)));

  /* AND THE ONES NOBODY HAS RE-CONFIRMED AT ALL.
     The per-weekday rule above only retires somebody whose own weekday deck came round and
     left them out. If that weekday's deck simply stops being uploaded -- the customer left the
     book, the file was renamed, whatever -- they sit on the officers' list for ever. That is
     the "showing on Def with an eight-day-old D.S when they are not in the current file"
     report from the field.

     A row STAMPED longer ago than a fortnight is retired. Rows with no stamp at all are left
     alone: they predate the column or are placeholders holding somebody's comment history, and
     retiring those on the strength of a stamp they never had would empty the list. */
  const cutoff = stamped && deckDate ? addDays_(deckDate, -FU_STALE_DAYS) : null;
  const staleRefs = !cutoff ? [] : (existing || [])
    .filter(r => r.deck_date && String(r.deck_date).slice(0, 10) < cutoff)
    .map(r => String(r.ref).trim().toUpperCase())
    .filter(k => !inDeck.has(k));

  const retire = new Set([...leftThisWeekday, ...staleRefs]);
  const gone = (existing || [])
    .filter(r => retire.has(String(r.ref).trim().toUpperCase()))
    .map(r => ({ ref: r.ref, status: null, arrears: null,
      ...(stamped ? { deck_date: null } : {}),
      updated_at: new Date().toISOString() }));

  for (const batch of [rows, gone]) {
    if (!batch.length) continue;
    const { error } = await db.from('followup_status').upsert(batch, { onConflict: 'ref' });
    if (error) throw new Error(error.message);
  }
  return rows.length;
}
