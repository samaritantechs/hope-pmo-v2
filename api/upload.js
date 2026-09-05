import { randomUUID } from 'node:crypto';
import { supabase, fetchAll, runQuery, isTransient } from './_lib/supabase.js';
import { gatedUser, can, withApi } from './_lib/auth.js';
/* The upload page calls the SAME functions the Settings cards call, rather than a second copy
   of the sweep and the retire rule. Two implementations of "which uploads are superseded" is
   two answers that can disagree, and the disagreement would only ever show up as a figure
   nobody can account for. */
import { portalApi, isAbnormalAmount } from './_lib/portal-core.js';
import { deckKindOfTable, unmarkDeckTotals, buildDeckTotals, topUpDeckTotals } from './_lib/snapshot-totals.js';
/* AN UPLOAD ON THIS SERVER CLEARS THIS SERVER'S ANSWERS AT ONCE.
   answer-cache.js keeps a screen's answer for a minute and says why: an upload landing on
   ANOTHER instance cannot reach in, so a minute is the floor for everybody. But an upload
   landing HERE can, and the person who just pressed Upload is the one person most likely to
   open the dashboard next and least able to tell a stale figure from a lost file. One line,
   no read, no write -- it throws away a map. */
import { noteAnswersChanged } from './_lib/answer-cache.js';
import { weekdayOfKey } from './_lib/time.js';
import {
  importDefaulters, importExpected, importExpectedSummary, importDefaulterSummary,
  importFollowup, importComments, commentsDateOrder,
  importLoans, loansDateOrder, importTeams, importReceivedPayments,
  importAccessCodes, importUserRoles,
  importAbnormal, importComplaints, importRestructures, importDemandNotices,
  importCallUsers, importCallLogs, importSettings, importHints,
  REF_HEADERS,
} from './_lib/importers.js';

/* ONE FILE IS NOT ONE REQUEST.
 *
 * A defaulter deck is tens of thousands of customers with twenty-five columns each. Writing it
 * in a single call meant building one JSON body of tens of megabytes in this process's memory
 * and pushing all of it at Supabase at once -- and a current-defaulter upload does that TWICE,
 * once for the deck and once for the officers' working list it rebuilds, while also holding
 * the whole existing list in memory to merge against.
 *
 * That is what "Failed: Unexpected token 'A', "An error o"..." was: not a bug in the page, and
 * not bad data. The hosting platform killed the function for running out of memory and answered
 * the browser with its own HTML error page, which the page then tried to read as JSON. Expected
 * files went in because they are narrower and do not rebuild the working list; the defaulter
 * deck is the one that tips it over.
 *
 * A thousand rows a request costs a few extra round trips and a fraction of the memory. It is
 * the same trade the READ side already makes for the same reason (see api/_lib/supabase.js):
 * fewer, bigger journeys rather than one impossible one -- and never several at a time, which
 * was tried once and took the whole system down.
 *
 * NOT ONE TRANSACTION ANY MORE, and that is worth saying plainly. If the fifth chunk fails, the
 * first four are already written. For the snapshot tables that is harmless -- every row of an
 * upload carries one batch stamp, and a re-upload supersedes the whole batch -- and for the
 * keyed tables a re-upload corrects in place. Both were already true of a second upload; this
 * only makes a FAILED one land in the same place. The error says how many rows were in when it
 * stopped, so "upload it again" is an instruction somebody can act on rather than a hope. */
/* HOW BIG A CHUNK -- AND WHY IT IS NOT A FIXED NUMBER.
 *
 * Two different failures sit on either side of this one setting, and a fixed size can only
 * ever avoid one of them:
 *
 *   TOO BIG   "canceling statement due to statement timeout" -- Postgres cancelling ONE
 *             statement that ran too long. Happens the moment the disk is slower than usual.
 *   TOO SMALL a thirty-thousand row file becomes hundreds of round trips, and the HOSTING
 *             platform cuts the whole function off at sixty seconds. HTTP 504, nothing saved.
 *
 * I moved it to a flat 250 to solve the first and walked straight into the second: a big deck
 * went from thirty journeys to a hundred and twenty, each with its own fixed overhead.
 *
 * So it adapts. It starts big, and HALVES only when the database says that statement was too
 * long -- down to a hundred rows. A healthy database therefore pays thirty journeys as before,
 * and a struggling one finds a size it can actually finish instead of failing at both ends.
 *
 * A cancelled statement is rolled back WHOLE, so the chunk that timed out wrote nothing and
 * re-sending its rows in smaller pieces cannot double them. That is what makes this safe on a
 * plain insert and not only on an upsert.
 *
 * NOT ONE TRANSACTION, and that is worth saying plainly. If the fifth chunk fails, the first
 * four are already written. For the snapshot tables that is harmless -- every row of an upload
 * carries one batch stamp and a re-upload supersedes the whole batch -- and the keyed tables
 * correct in place. Both were already true of a SECOND upload; this only makes a FAILED one
 * land in the same place. The error says how many rows were in when it stopped, so "upload it
 * again" is an instruction rather than a hope. */
const WRITE_CHUNK_MAX = 1000;
const WRITE_CHUNK_MIN = 100;

/** Does this error mean "that one statement took too long", as opposed to anything else?
    Only this failure is worth answering with a smaller chunk; a bad column or a constraint
    would fail identically at every size, and halving four times over would just be slower. */
function isStatementTimeout(err) {
  return /canceling statement|statement timeout/i.test(String((err && err.message) || err));
}

/** Insert or upsert `records`, a chunk at a time, shrinking the chunk if the database says the
    statement was too long. `onConflict` null means a plain insert. */
async function writeInChunks(db, table, records, onConflict) {
  let size = WRITE_CHUNK_MAX;
  let written = 0;
  let i = 0;
  while (i < records.length) {
    const slice = records.slice(i, i + size);
    // tries: 2 -- one immediate retry for a blip. Anything more belongs to the halving below,
    // which is a better answer than the same too-large statement a third time.
    const { error } = await runQuery(() => (onConflict
      ? db.from(table).upsert(slice, { onConflict })
      : db.from(table).insert(slice)), 2);
    if (error) {
      if (isStatementTimeout(error) && size > WRITE_CHUNK_MIN) {
        size = Math.max(WRITE_CHUNK_MIN, Math.floor(size / 2));
        continue;                                    // same rows, smaller bite
      }
      throw new Error(error.message
        + (isStatementTimeout(error)
          ? ` -- the database could not write even ${WRITE_CHUNK_MIN} rows in the time it allows, which means it is badly overloaded rather than that this file is wrong`
          : '')
        + (written ? ` (${written.toLocaleString('en-US')} row(s) of ${records.length.toLocaleString('en-US')} were already written before this stopped -- uploading the file again is safe and will finish the job)` : ''));
    }
    i += slice.length;
    written += slice.length;
  }
  return written;
}

/* =====================================================================================
   THE FILE IS IN. THE TIDYING AFTER IT MUST NEVER BE THE THING THAT FAILS THE UPLOAD.
   =====================================================================================
     "uploading (Failed: Error: Seva imechukua muda mrefu mno / the server took too long
      — HTTP 504)"

   That is the second time this shape has been reported, and the first fix -- moving the
   register rebuild out of the request -- treated the symptom that was in front of me rather
   than the shape of the failure. The shape is this:

     write the deck        the upload. Must happen, must be waited for.
     everything after it   the register retirement, the superseded-batch sweep. Housekeeping,
                           already wrapped so a failure is not fatal -- but NOT BOUNDED, so it
                           can spend fifty seconds and let the PLATFORM cut the function off
                           at sixty. The browser then gets a 504 and says the upload failed.

   And the deck is already written by then. So a 504 here does not mean "nothing landed"; it
   means "everything landed and the answer was lost", which is worse than either -- the person
   at the keyboard uploads the same file again, and again, chasing a failure that is not there.

   A try/catch cannot catch a platform timeout. Only a clock can. So the housekeeping now runs
   against a DEADLINE measured from the start of the request: each step is skipped if there is
   not enough time left to be worth starting, and abandoned if it overruns. What was abandoned
   is SAID, in the upload's own result, so nothing is quietly not done.

   NOTHING IS LOST BY ABANDONING EITHER STEP. The retirement is re-run in full by the next
   current-defaulter upload, and the sweep by the next upload of any deck or by the Settings
   card -- both are idempotent and both work from the table, not from this request. Abandoning
   them costs a day of staleness at the very worst; the 504 costs the upload.

   45 seconds of the platform's 60, so there is always room to send the answer back. */
const UPLOAD_BUDGET_MS = 45000;
const uploadBudget = () => Number(process.env.UPLOAD_BUDGET_MS) || UPLOAD_BUDGET_MS;

/** How long a housekeeping step must have in front of it before it is worth starting at all.
    Starting one with two seconds left buys nothing and risks the clock. */
const UPLOAD_STEP_MIN_MS = 4000;

/** Run `p`, but give up on it after `ms` and answer `fallback` instead. The abandoned work is
    NOT cancelled -- it carries on against the database for as long as the platform lets it, and
    since every step here writes in chunks, whatever it finished stands. */
export function beforeDeadline(p, ms, fallback) {
  let t = null;
  const late = new Promise(res => { t = setTimeout(() => res(fallback), ms); if (t.unref) t.unref(); });
  return Promise.race([
    p.then(v => { clearTimeout(t); return v; }, () => { clearTimeout(t); return fallback; }),
    late,
  ]);
}

/** The clock for one upload request. `left()` is what remains of the budget; `worth()` says
    whether a step has room to start. Pure arithmetic over a start time, so a test can drive it
    with a tiny budget instead of waiting forty-five seconds. */
export function uploadClock(startedAt, budgetMs = uploadBudget(), nowFn = Date.now) {
  const left = () => Math.max(0, budgetMs - (nowFn() - startedAt));
  return { left, worth: (min = UPLOAD_STEP_MIN_MS) => left() >= min };
}

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

/* =====================================================================================
   ONE LOAN, ONE ROW -- EVEN WHEN ITS PAPERWORK GROWS UP BETWEEN UPLOADS.

     "Replacing sales works but appending doesnt update"

   A loan's row is keyed on its own identity: LOAN ID, else DOCKET#, else track + name +
   phone (loanId in importers.js). That key is computed FROM THE FILE -- and the same loan
   does not carry the same identity papers all its life. An application-stage export has no
   LOAN ID column (the ID is assigned at approval), so the loan went in under its docket or
   its name; the approvals export then arrives with a LOAN ID, computes a DIFFERENT key, and
   the upsert -- which can only match keys -- INSERTS A TWIN instead of moving the row it was
   meant to update. Append after append, the pipeline filled with loans that were both
   "awaiting approval" and "approved", and corrections landed on neither. Replace looked like
   it worked because it deletes the day wholesale before writing, twins and all.

   So before the write, each incoming loan is checked against what the pipeline already
   holds, by every identity it has:

     LOAN ID        exact, when both sides have one
     DOCKET#        exact, when both sides have one
     track+name     with the phone lenient -- equal, or missing on either side, because the
                    phone itself was being dropped by a header mismatch until today, so the
                    stored twin often has no phone through no fault of the file

   A match means "this row IS that loan": the incoming record takes the existing row's id, and
   the upsert becomes the update it was always meant to be. When one incoming loan matches
   SEVERAL existing rows under its strong identities (the twins earlier appends already made),
   the extras are provably the same loan filed twice -- they are removed, and the count is
   reported. The lenient triple never deletes anything; it only redirects the update.

   POSTGRES: three chunked keyed reads per slice (400 keys a request), only over the values
   this file actually carries, plus one delete only when twins exist. Upload-time cost only --
   no read path changes. */
export async function reconcileLoanIds(db, records) {
  if (!records.length) return { records, relinked: 0, merged: 0 };
  const T = v => String(v == null ? '' : v).trim().toUpperCase();
  const cols = 'id, loan_id, docket_no, track_no, full_name, contact';
  const existing = []; const seenIds = new Set();
  const pull = async (col, vals) => {
    const list = [...new Set(vals.filter(Boolean))];
    for (let i = 0; i < list.length; i += 400) {
      const { data, error } = await runQuery(() =>
        db.from('loans').select(cols).in(col, list.slice(i, i + 400)));
      if (error) throw new Error('Could not check for already-known loans: ' + error.message);
      for (const r of (data || [])) if (!seenIds.has(r.id)) { seenIds.add(r.id); existing.push(r); }
    }
  };
  await pull('loan_id', records.map(r => r.loan_id));
  await pull('docket_no', records.map(r => r.docket_no));
  await pull('full_name', records.map(r => r.full_name));

  const byLoanId = new Map(), byDocket = new Map(), byName = new Map();
  for (const e of existing) {
    if (T(e.loan_id)) byLoanId.set(T(e.loan_id), e);
    if (T(e.docket_no)) byDocket.set(T(e.docket_no), e);
    if (T(e.full_name)) {
      const k = T(e.full_name);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(e);
    }
  }

  let relinked = 0; const twinIds = new Set();
  const out = records.map(r => {
    // Strong identities first, in the same order loanId itself prefers them.
    const strong = [];
    if (T(r.loan_id) && byLoanId.has(T(r.loan_id))) strong.push(byLoanId.get(T(r.loan_id)));
    if (T(r.docket_no) && byDocket.has(T(r.docket_no))) strong.push(byDocket.get(T(r.docket_no)));
    let keeper = strong[0] || null;
    if (!keeper && T(r.full_name) && T(r.track_no)) {
      keeper = (byName.get(T(r.full_name)) || []).find(e => T(e.track_no) === T(r.track_no)
        && (!T(e.contact) || !T(r.contact) || T(e.contact) === T(r.contact))) || null;
    }
    if (!keeper) return r;
    // Two DIFFERENT existing rows both carrying this loan's papers are the same loan twice.
    for (const s of strong) if (s.id !== keeper.id) twinIds.add(s.id);
    if (keeper.id === r.id) return r;
    relinked++;
    return { ...r, id: keeper.id };
  });

  if (twinIds.size) {
    const gone = [...twinIds];
    for (let i = 0; i < gone.length; i += 400) {
      const { error } = await runQuery(() => db.from('loans').delete().in('id', gone.slice(i, i + 400)));
      if (error) throw new Error('Could not merge duplicate loan rows: ' + error.message);
    }
  }
  return { records: out, relinked, merged: twinIds.size };
}

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
  /* AN APPLICATION-STAGE FILE IS THE WHOLE LIST FOR ITS DAY, so two uploads of the same
     stage under the same date cannot both be true -- the second IS the day, corrected.

       "when i reupload unassigned and assessed apps by append but same date, i need that
        action not to merge with existing but replace that single date data"

     Append used to merge here: a loan in both files updated in place (they share an
     identity-derived id), but a loan REMOVED from the corrected file lingered under that
     date, invisible to the person who had just uploaded what they believed was the whole
     truth. So for the un-dated pipeline stages (unassigned, unassessed, assessed, assigned
     -- everything without its own date column), re-uploading a date REDOES that date, in
     either mode. The delete is scoped to this stage AND this upload date: other days, and
     the same day's other stages, are untouched. The dated stages (approved, disbursed)
     keep the append/replace choice, because appending genuinely means "add more days"
     there. */
  const sameDayRedo = table === 'loans' && !dateCol && !replace;
  return { stamped: true, uploadDate, replace: replace || sameDayRedo, sameDayRedo, scope, dateCol,
           uploadedOnly: APP_WRITABLE_TABLES.has(table) };
}

/** WHICH SLICE OF THE FILE IS THIS?
 *
 *  A thirty-thousand row deck cannot be relied on to finish inside the sixty seconds the hosting
 *  platform allows a function, and on a database having a bad morning it certainly cannot. It
 *  failed two ways depending on how the writes were sized -- "canceling statement due to
 *  statement timeout" if the chunks were large, HTTP 504 if there were so many small ones that
 *  the whole function outran its clock. Sizing the writes can only find a point between those
 *  two; it cannot remove them. Sending less per request can.
 *
 *  So the upload page sends the file in slices, each its own request with its own sixty seconds,
 *  and tells the server which slice this is:
 *
 *    id     ONE uuid for the WHOLE file, generated by the page. Every slice is stamped with it,
 *           so all of them belong to ONE upload batch. THIS IS THE PART THAT MATTERS: the
 *           readers keep the latest batch of the latest date and discard the rest, so a file
 *           that arrived as twelve batches would be read as a TWELFTH of itself -- every figure
 *           quietly too low, and nothing on any screen to say so.
 *    index  0-based. Replace-that-date runs on the FIRST slice only, or slice two would delete
 *           slice one and a replaced file would keep only its final slice.
 *    total  how many there are. The follow-up list is rebuilt, and the phones' data stamp moved,
 *           on the LAST slice only -- rebuilding against slice one of twelve would read
 *           "the deck no longer names them" as true of eleven twelfths of the book.
 *
 *  NO `part` AT ALL means a file small enough to send whole, and everything behaves exactly as
 *  it always did: one slice, first and last at once, and a batch id of the server's own making.
 *
 *  The id is VALIDATED rather than trusted, because upload_batch is a uuid column and a
 *  malformed one fails the write with a message about syntax rather than about the file. An
 *  unusable id falls back to null, and the caller mints a fresh uuid -- worse, because it splits
 *  the batch, but not an error. It cannot happen from our own page.
 *
 *  Pure, so the decision is testable without a database -- the route only carries it out. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function partPlan(part) {
  if (!part) return { index: 0, total: 1, isFirst: true, isLast: true, batch: null };
  const index = Math.max(0, parseInt(part.index, 10) || 0);
  const total = Math.max(1, parseInt(part.total, 10) || 1);
  return {
    index,
    total,
    isFirst: index === 0,
    // >= rather than ===, so a total that arrives smaller than the index still finishes the
    // upload rather than leaving the working list un-rebuilt for ever.
    isLast: index >= total - 1,
    batch: UUID_RE.test(String(part.id || '')) ? String(part.id) : null,
  };
}

export default withApi(async (req, res) => {
  if (req.method !== 'POST') { const e = new Error('Method not allowed'); e.status = 405; throw e; }
  /* The clock starts HERE, not after the write, because the platform's sixty seconds started
     here too. See the note on UPLOAD_BUDGET_MS: the write is waited for whatever it costs, and
     the housekeeping that follows it gets whatever is left. */
  const clock = uploadClock(Date.now());
  /* A BIG FILE IS SEVERAL REQUESTS NOW, NOT ONE.
   *
   * A thirty-thousand row deck cannot be relied on to finish inside the sixty seconds the
   * hosting platform allows a function, and on a database having a bad morning it certainly
   * cannot. It failed two ways depending on how the writes were sized -- "canceling statement
   * due to statement timeout" if the chunks were large, HTTP 504 if there were so many small
   * ones that the whole function outran its clock. Sizing the writes can only ever find a point
   * between those two; it cannot remove them.
   *
   * So the PAGE sends the file in slices, and each slice is its own request with its own sixty
   * seconds. `part` carries what the server cannot work out for itself:
   *
   *   id     one uuid for the WHOLE file, generated by the page. Every slice is stamped with
   *          it, so all of them belong to ONE upload batch. THIS IS THE PART THAT MATTERS:
   *          the readers keep the latest batch of the latest date and discard the rest, so a
   *          file that arrived as twelve batches would be read as a twelfth of itself, with
   *          every figure quietly too low and nothing on screen to say so.
   *   index  0-based. Replace-that-date runs on the FIRST slice only -- otherwise slice two
   *          would delete slice one.
   *   total  how many there are. The follow-up list is rebuilt, and the phones' data stamp
   *          moved, on the LAST slice only, when the deck is actually complete.
   *
   * A file small enough to fit in one request sends no `part` at all and behaves exactly as it
   * always did -- which is what keeps every existing test honest.
   *
   * IF IT STOPS HALF WAY, the slices already in share one batch stamp with each other and the
   * upload is simply incomplete. Sending the file again writes a NEW batch, and the batch rule
   * supersedes the incomplete one whole. That is the same protection a re-upload has always
   * had, working for a case it was not designed for. */
  const { code, type, meta: metaIn = {}, rows, part = null } = req.body || {};
  /* THE DATE DECIDES THE WEEKDAY. ALWAYS.

       "remove the day thing since am choosing calender already -- its mixing me, am finding
        Monday always. I might disturb Mondays data while I always find todays date."

     The weekday used to be its own dropdown beside the date, defaulting to Monday. Two ways
     of saying the same thing, and the moment they disagreed the deck was filed under the
     wrong day: Tuesday's book stamped MON would overwrite Monday's recovery pairing and be
     invisible under Tuesday. It could not be caught by eye, because both boxes looked
     deliberate.

     So a defaulter upload's weekday is now DERIVED from the date the person chose, on the
     server, whatever any client sends -- one fact, one place, no way to disagree. A file
     dated 18/08 is a Tuesday deck because the 18th of August IS a Tuesday. */
  const DEFAULTER_TYPES = new Set(['defaulters-current', 'defaulters-initial', 'defaulters-summary']);
  const derivedWd = DEFAULTER_TYPES.has(type) ? weekdayOfKey(metaIn && metaIn.date) : null;
  const meta = derivedWd ? { ...metaIn, weekday: derivedWd } : metaIn;
  const { index: partIndex, total: partTotal, isFirst: isFirstPart, isLast: isLastPart,
          batch: partBatch } = partPlan(part);
  // Uploading is a system-side act, so it closes with the rest of the system. An admin
  // still gets through -- somebody has to be able to load the day's files either way.
  const user = await gatedUser(code);
  if (!(await can(user, 'upload'))) { const e = new Error('Upload permission is required for your access code.'); e.status = 403; throw e; }
  if (!Array.isArray(rows) || rows.length < 2) { const e = new Error('No data rows found in the file.'); e.status = 400; throw e; }

  let table, records, commentsOrder = null, loansOrder, teamsDroppedCols = null;
  let loansRelinked = 0, loansMerged = 0, receivedAbnormal = 0, receivedStep = 0;
  switch (type) {
    case 'defaulters-current':
    case 'defaulters-initial':
      if (!meta.date) { const e = new Error('A date is required for a Defaulters upload — the weekday is read from it.'); e.status = 400; throw e; }
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
    /* A DAY WITHOUT ITS CUSTOMERS. The company's own summary sheet -- money per team, no
       names -- for the mornings the full export was missed. It goes to its own table, shaped
       like what the totals functions already return, so the batch rule decides between a
       summary and a list exactly as it decides between two lists: the later upload wins. The
       customer lists are untouched, so the phone, the follow-up tab and the rotation go on
       reading them whatever the reports are using. */
    case 'expected-summary':
      if (!meta.date) { const e = new Error('date is required for an Expected summary.'); e.status = 400; throw e; }
      table = 'snapshot_summaries';
      records = importExpectedSummary(rows, {
        snapshotType: String(meta.expectedType || 'today').toLowerCase(), snapshotDate: meta.date });
      break;
    case 'defaulters-summary':
      if (!meta.date) { const e = new Error('A date is required for a Defaulters summary — the weekday is read from it, and recovery is only honest when an initial deck is compared against the current deck of the SAME weekday.'); e.status = 400; throw e; }
      if (meta.defType !== 'initial' && meta.defType !== 'current') { const e = new Error('Choose Initial or Current for a Defaulters summary.'); e.status = 400; throw e; }
      table = 'snapshot_summaries';
      records = importDefaulterSummary(rows, {
        snapshotType: meta.defType, snapshotDate: meta.date, weekday: meta.weekday });
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
      /* The whole APPROVED DATE column decides its own order, once, and the answer is reported
         below -- reading a date column the wrong way round moves a report by months and looks
         entirely reasonable in the result. */
      /* And when the column offers no evidence at all -- one day's report, every value the
         same "9/1/2026" -- the day it is being uploaded decides which way round it reads:
         a report uploaded on the second of September is about the first of September, not
         the ninth of January. See nearestToDayIsDayFirst. */
      loansOrder = loansDateOrder(rows,
        /^\d{4}-\d{2}-\d{2}$/.test(String(meta.uploadDate || ''))
          ? String(meta.uploadDate)
          : new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10));
      records = importLoans(rows, meta.stage, loansOrder);
      /* A loan whose paperwork grew a LOAN ID since its last upload must UPDATE its row, not
         sit beside it as a twin -- see reconcileLoanIds above. */
      {
        const rec = await reconcileLoanIds(supabase, records);
        records = rec.records; loansRelinked = rec.relinked; loansMerged = rec.merged;
      }
      break;
    case 'teams':
      table = 'teams';
      records = importTeams(rows);
      /* ONE READ OF THE TEAMS TABLE DOES TWO JOBS. It used to be a `limit(1)` probe for the
         column list; the table is under a hundred rows, so reading it whole costs the same one
         trip and also answers the second question below -- which spelling of each team already
         exists. Two answers, one journey. */
      {
        const existing = await fetchAll(() => supabase.from('teams').select('*'));

        /* COLUMNS A DATABASE HAS NOT GOT YET ARE DROPPED, NOT SENT. The leaders sheet carries
           region, zone and a phone per role, all added by 2026-08-09-team-contacts.sql -- and
           migrations here are run by hand. Sending a column that does not exist fails the WHOLE
           file, so an admin who had not yet pasted that SQL would find the leaders upload broken
           with an error naming a column they never asked about. Same guard saveTeam has.

           BUT IT USED TO DROP THEM IN SILENCE, and that is how "why didnt even the ids update"
           happens: a column is read correctly out of the sheet, thrown away here because the
           database has not got it, and the upload reports a cheerful success. The names of what
           was dropped are now carried back and said out loud. */
        const known = existing.length ? Object.keys(existing[0]) : null;
        if (known) {
          const dropped = new Set();
          records = records.map(r => {
            const out = {};
            for (const k of Object.keys(r)) {
              if (known.includes(k)) out[k] = r[k];
              else dropped.add(k);
            }
            return out;
          });
          teamsDroppedCols = [...dropped];
        }

        /* A TEAM IS NOT CREATED TWICE BECAUSE OF ITS CAPITAL LETTERS.

             "i deleted / merged TUNDURU into Tunduru but i still see it"

           importTeams upper-cases every name (normTeam), and `teams.team` is the primary key,
           which Postgres compares exactly. So a sheet saying "Tunduru" upserts a SECOND row
           called "TUNDURU" beside the one that is already there -- and the merge the admin had
           just done is undone by the next upload of the same sheet.

           Matched case-insensitively against what is already stored, and filed under the
           spelling the database already uses. A genuinely new team still arrives as written. */
        const bySpelling = new Map(existing.map(t => [String(t.team || '').toUpperCase(), t.team]));
        records = records.map(r => {
          const kept = bySpelling.get(String(r.team || '').toUpperCase());
          return kept && kept !== r.team ? { ...r, team: kept } : r;
        });
      }
      break;
    case 'received':
      table = 'received_payments';
      records = importReceivedPayments(rows);
      /* REF ID arrives with db/migrations/2026-08-10-received-ref-id.sql, and migrations here
         are run by hand. Sending a column the database has not got yet fails the WHOLE file,
         so the payments upload would break on an admin who had not pasted that SQL -- with an
         error naming a column they never asked about. Same guard the leaders sheet has. */
      {
        const probe = await supabase.from('received_payments').select('*').limit(1);
        const known = probe.data && probe.data.length ? Object.keys(probe.data[0]) : null;
        if (known) records = records.map(r => {
          const out = {};
          for (const k of Object.keys(r)) if (known.includes(k)) out[k] = r[k];
          return out;
        });
      }
      /* SAY WHAT THE RULE WILL FLAG, AT THE MOMENT OF UPLOAD.

           "I don't think uploading by appending or replacing received payments updates
            abnormal ones"

         It does -- the Abnormal screen and the dashboard tile both work irregular payments out
         from this very table -- but nothing ever SAID so, and an update that happens invisibly
         is indistinguishable from one that does not happen. The abnormal sheet is not uploaded
         any more, so this line is the only receipt. One keyed settings read; the count is
         arithmetic over rows already in hand. */
      {
        const { data: st } = await supabase.from('settings').select('value').eq('key', 'ABNORMAL_STEP').maybeSingle();
        const step = st && Number(st.value) > 0 ? Number(st.value) : 500;
        receivedAbnormal = records.filter(r => isAbnormalAmount(r.amount_paid, step)).length;
        receivedStep = step;
      }
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

  /* =====================================================================================
     A ROW THE FILE HAD AND THE SYSTEM DID NOT USE MUST BE COUNTED OUT LOUD.

       "am not yet seeing 2209728651  2-209-72865  ESTER PETER OMARY"
       "Some customers werent seen ... yet they are in the uploaded file"

     Every importer ends `.filter(x => x.ref)`, and that filter is correct -- a row with no
     reference cannot be joined to anything. What was not correct is that it happened in
     SILENCE. `inserted` has always been the count AFTER the filter, so a file of nine thousand
     customers whose reference column is spelled in a way no candidate matched reports "8,783
     rows uploaded" and looks like a clean upload. The rows are not rejected loudly; they are
     subtracted from the number you are reading.

     That is the same shape three times over now, and it is the reason this particular hunt has
     run for days: every screen was searched for a customer who may never have been written.

     So the file's own row count is compared against what came out of the importer, and any
     difference is reported with NAMES -- because "217 rows were skipped" is a statistic and
     "ESTER PETER OMARY was skipped" is an answer. It is computed from the parsed sheet already
     in memory: no extra read, no extra round trip. */
  const dataRows = rows.slice(1).filter(r => Array.isArray(r) && r.some(v => String(v == null ? '' : v).trim() !== '')).length;
  const skipped = Math.max(0, dataRows - records.length);
  let skippedNames = [];
  if (skipped) {
    /* Which ones. The importers key on the reference, so a dropped row is one whose reference
       could not be read -- name it by whatever the sheet DOES carry, so it can be found in the
       file by eye. */
    const h = {};
    (rows[0] || []).forEach((c, i) => { h[String(c == null ? '' : c).trim().toUpperCase().replace(/\s+/g, ' ')] = i; });
    const pick = (r, names) => { for (const n of names) { const i = h[n]; if (i !== undefined && String(r[i] || '').trim()) return String(r[i]).trim(); } return ''; };
    const kept = new Set(records.map(x => String(x.ref == null ? '' : x.ref).trim().toUpperCase()));
    for (const r of rows.slice(1)) {
      if (!Array.isArray(r) || !r.some(v => String(v == null ? '' : v).trim() !== '')) continue;
      const ref = pick(r, REF_HEADERS.map(x => x.toUpperCase()));
      if (ref && kept.has(ref.toUpperCase())) continue;
      const name = pick(r, ['FULLNAME', 'FULL NAME', 'CUSTOMER NAME', 'NAME']);
      const any = pick(r, ['CUSTOMER NO', 'DOCKET#', 'DOCKET #', 'LOAN ID', 'TRACK#']);
      skippedNames.push([name, ref || any].filter(Boolean).join(' — ') || '(row with nothing readable in it)');
      if (skippedNames.length >= 12) break;
    }
  }

  // One uuid per upload, stamped across every row of it. Snapshots are append-only -- a
  // re-upload of the same date ADDS rows, never overwrites -- so without this, a corrected
  // re-upload stacked both copies into every KPI. Readers resolve latest date -> latest
  // batch within it (api/_lib/snapshots.js), so the newest upload wins while the full
  // history stays underneath.
  const SNAPSHOT_TABLES = new Set(['defaulter_snapshots', 'repayment_snapshots', 'snapshot_summaries']);
  let uploadBatch;
  if (SNAPSHOT_TABLES.has(table)) {
    uploadBatch = partBatch || randomUUID();
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
    uploadBatch = partBatch || randomUUID();
    records = records.map(r => ({ ...r, upload_date: uploadDate, upload_batch: uploadBatch }));
  }

  /* REPLACE RUNS ONCE, ON THE FIRST SLICE. It removes what was uploaded under that report date
     before this file is written -- so running it again on slice two would delete slice one, and
     a Replace of a big file would end up keeping only its final slice. */
  const { replaced: nReplaced, replacedDates } = isFirstPart
    ? await runReplace(supabase, table, plan, records)
    : { replaced: 0, replacedDates: null };
  replaced = nReplaced;

  // Tables that reference teams.team as a foreign key -- auto-create any team name that
  // doesn't exist yet, rather than blocking the upload. Your team list grows over time; a new
  // team's first Defaulters/Expected file shouldn't have to wait on someone remembering to
  // register it first. New teams get blank role columns (no leader assigned yet) -- fill those
  // in later via Leaders/Teams or a teams-editing screen.
  const TEAM_REF_TABLES = new Set(['defaulter_snapshots', 'repayment_snapshots', 'followup_status', 'loans',
    'followup_comments', 'snapshot_summaries']);
  let newTeams = [], stubbed = 0;
  if (TEAM_REF_TABLES.has(table)) {
    const incomingTeams = [...new Set(records.map(r => r.team).filter(Boolean))];
    if (incomingTeams.length) {
      /* THE WHOLE TEAM LIST, NOT THE NAMES THIS FILE HAPPENS TO SPELL. Under a hundred rows and
         still one round trip, and it is the only way to see that "TUNDURU" in this file is the
         "Tunduru" that already exists -- `.in()` compares exactly, so the old query answered
         "no such team" and auto-created the twin. Every record is then re-filed under the
         spelling the database already uses, so the rows land on the real team's book. */
      const { data: existingTeams, error: teamErr } = await supabase.from('teams').select('team');
      if (teamErr) throw new Error('Could not verify team names: ' + teamErr.message);
      const bySpelling = new Map((existingTeams || []).map(t => [String(t.team || '').toUpperCase(), t.team]));
      for (const r of records) {
        if (!r.team) continue;
        const kept = bySpelling.get(String(r.team).toUpperCase());
        if (kept && kept !== r.team) r.team = kept;
      }
      const known = new Set(bySpelling.values());
      newTeams = [...new Set(records.map(r => r.team).filter(Boolean))].filter(t => !known.has(t));
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

  await writeInChunks(supabase, table, records, upsertTables[table] || null);

  /* THE DAY'S CACHED TOTALS ARE NOW OUT OF DATE, AND THIS IS THE FIRST MOMENT ANYTHING KNOWS IT.
     One delete by primary key, on every slice, before anything else -- so from this instant that
     day is read live by every screen, whether or not the rebuild at the bottom of this function
     ever runs. It is deliberately not paired with the rebuild: see the note in snapshot-totals.js
     for why unmarking first and building later is what makes a stale figure impossible rather
     than merely unlikely. Never fatal; on a database without the tables it does nothing. */
  const deckKind = deckKindOfTable(table);
  if (deckKind && meta.date) { try { await unmarkDeckTotals(supabase, deckKind, meta.date); } catch (e) { /* reads live */ } }

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
  // On the LAST slice only. Moving the stamp half way through would send two hundred phones to
  // fetch figures built on a file that is not all there yet.
  if (isLastPart) {
    try {
      await supabase.from('settings')
        .upsert({ key: 'DATA_VERSION', value: String(Date.now()) }, { onConflict: 'key' });
    } catch (e) { /* the data is in; the phones will catch up on their own schedule */ }
  }

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

  /* THE WORKING LIST IS REBUILT ON THE LAST SLICE ONLY, and that is not an optimisation.
     Rebuilding it compares who is on the deck against who is on the list, and retires the ones
     the deck no longer names. Run against slice one of twelve, "the deck no longer names them"
     is true of eleven twelfths of the book. */
  /* =====================================================================================
     THE SYNC WAS ONLY EVER SEEING THE LAST SLICE OF THE FILE.

       initial:  "Done — 8888 row(s) into defaulter_snapshots."
       current:  "Done — 8888 row(s) ... Officers' working list rebuilt: 888 customer(s) ...
                  7977 customer(s) no deck has confirmed were taken off the officers' list."

     Eight thousand eight hundred and eighty-eight rows in, eight hundred and eighty-eight out.
     That is not a coincidence and it is not a rounding: a file is uploaded a THOUSAND ROWS AT A
     TIME, and this ran on `records` -- the variable holding the CURRENT SLICE. On the last part
     that is whatever is left over, here 888.

     So every current-defaulter upload wrote the whole deck to defaulter_snapshots correctly, put
     one slice of it into the officers' register, and then -- because the other 8,000 were "not
     in the deck" as far as this could see -- RETIRED THEM. Seven thousand nine hundred and
     seventy-seven customers blanked, on every single upload, by the upload itself.

     That is the whole complaint, in one line of arithmetic. Every read path I have been through
     was working; the register they all depend on was being emptied on the way in.

     THE WRITE NEEDS NO SLICE AND NO MERGE. It is split in two:

       every part   writes ITS OWN rows, deck columns only. A PostgREST upsert updates exactly
                    the columns in the payload, so leaving fu_status, the promise and the
                    comment OUT of it preserves them by construction -- which also means the
                    whole existing register no longer has to be read and merged in memory to
                    protect them. Cheaper AND safer than what it replaced.
       last part    does the retiring, against the refs of THIS WHOLE UPLOAD BATCH read back
                    from the table -- one column, so the file's own size is no longer the thing
                    that decides who gets retired.
     ===================================================================================== */
  let followupSynced = 0, followupRetired = 0, followupCapped = 0, followupDeferred = false;
  if (type === 'defaulters-current') {
    followupSynced = await writeFollowupFromDeck(supabase, records, meta.date);
  }
  if (type === 'defaulters-current' && isLastPart) {
    /* THE RETIREMENT IS ON THE CLOCK. It reads back every ref of this batch and then the live
       half of the register, both of which grow with the book -- so on a database having a bad
       morning it is the step most likely to run past the platform's limit and turn a completed
       upload into a 504. The next current file re-runs it in full against the same table, so a
       deferral costs nothing but a day of a few cleared customers still showing. */
    if (!clock.worth()) {
      followupDeferred = true;
    } else {
      const fu = await beforeDeadline(
        retireFollowupAfterDeck(supabase, meta.weekday, uploadBatch, meta.date),
        clock.left(), null);
      if (fu) { followupRetired = fu.retired; followupCapped = fu.capped; }
      else followupDeferred = true;
    }
  }
  /* =====================================================================================
     THE DEFAULTERS LIST COMES FROM THE DEFAULTERS FILE. NOTHING ELSE WRITES IT.
     =====================================================================================
       "we should see defaulters from defaulters since its not the hopeloan yet, now you
        pulling defaulters from expected yet i upload my defaulters manually thats abusing me
        brother"

     An expected upload used to clear settled customers off the officers' register here. It was
     added because retirement appeared never to happen -- and it did paper over the symptom,
     because the expected book arrives daily and states a balance.

     But the reason retirement never happened was a BUG in the deck comparison, twenty lines
     down in retireFollowupAfterDeck: it looked for "the previous deck of this weekday", found
     the upload's own date, and retired nobody. Fixing that makes the defaulters file do its own
     job, on its own terms, exactly as the person filing it expects. The expected book has no
     business deciding who is a defaulter, and no longer touches the register at all. */

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
    ? (plan.sameDayRedo
        ? { mode: 'replace-date', text: `This is the ${meta.stage ? String(meta.stage).toUpperCase() + ' ' : ''}list for ${dayPhrase} now: `
            + (replaced ? `the earlier upload of this date (${replaced} row(s)) was replaced, ` : '')
            + `${records.length} row(s) written. A same-date re-upload REDOES the date rather than merging with it — rows you removed from the file are gone too. Other days and other stages were not touched.` }
        : replaced || String(meta.mode || '').toLowerCase() === 'replace'
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

  /* =====================================================================================
     TWO THINGS THAT NOW HAPPEN BY THEMSELVES, ON THE LAST SLICE OF EVERY SNAPSHOT UPLOAD.
     =====================================================================================
     "always auto delete all the same date previos reports whenever i upload and remove the
      manual setting"
     "Remove the manual checking and always delete 1 day and above stale defaulters"

     Both were buttons in Settings, and a button is a thing somebody has to remember. Nobody
     remembers a housekeeping button, which is how a database ends up holding a million rows
     nobody reads and a working list full of people who cleared last week.

     They are deliberately fire-and-forget, like the audit log: an upload that succeeded must
     never be reported as failed because the tidying after it did not. The file is already in
     and the batch rule already makes it the one that counts -- everything below is only
     cleaning up behind it. */
  let autoSwept = null, autoRetired = null, autoRegister = null;
  /* WHO IS DOING THE TIDYING. Uploading requires the `upload` tab; the sweep and the retire
     rule require `settings`. Somebody granted upload-only would therefore have had the
     housekeeping refused with a 403 that the catch below swallows -- silently doing nothing,
     for ever, which is the exact failure shape that has already cost two rounds of this.

     So the actor is built HERE, on the server, never from the request. It keeps the real
     person's name and code, so the audit log still says who was at the keyboard, and carries
     the permission because THE SYSTEM is what decided to tidy up -- not them. The arguments
     below are fixed by this file, so nothing a caller sends can widen what runs. */
  const housekeeper = { code: user.code, name: user.name, role: user.role,
    teams: null, tabs: ['upload', 'settings'] };
  let sweepDeferred = false;
  if (isLastPart && SNAPSHOT_TABLES.has(table)) {
    /* ON THE CLOCK TOO, and last in the queue on purpose: of everything after the write this is
       the one whose only job is to save disk. The batch rule already makes the file that just
       landed the one that counts, so a superseded batch left in place for another day changes
       no figure on any screen. The next upload sweeps it, or the Settings card does. */
    if (!clock.worth()) {
      sweepDeferred = true;
    } else {
      try {
        /* The same sweep the Settings card runs, on this date only, keeping two: the file just
           uploaded and the one it replaced -- so a wrong file can still be undone by sending the
           right one again, which is the whole reason two are kept rather than one. */
        const r = await beforeDeadline(portalApi(supabase, housekeeper, 'purgeSuperseded',
          { confirm: true, keep: 2, to: uploadDate || meta.date, days: 1, limit: 200 }, Date.now()),
        clock.left(), null);
        if (r) autoSwept = { batches: r.deletedBatches, rows: r.totalRows };
        else sweepDeferred = true;
      } catch (e) { /* the upload stands */ }
    }
  }

  /* ADD THE DECK UP, ONCE, NOW THAT IT IS ALL IN. Last of everything and on the same clock, so
     it can only ever use time nothing else needed. If it does not run, the day was unmarked at
     the top of this function and is simply read live -- which is what every day did before this
     existed, and what every unbuilt day still does. The backfill in RUN-ME-022 catches it, or
     the next upload of that date does. */
  // The figures on every screen have just changed. See the import note.
  noteAnswersChanged(supabase);
  let deckBuilt = false;
  if (isLastPart && deckKind && meta.date && clock.worth(6000)) {
    try {
      deckBuilt = !!(await beforeDeadline(buildDeckTotals(supabase, deckKind, meta.date),
        clock.left(), false));
    } catch (e) { /* the day reads live */ }
  }
  /* AND TOP UP THE FORWARD WINDOW, so the cache does not quietly expire.
     The backfill builds a fortnight ahead so the dashboard's Monday-to-Sunday week is complete
     -- but that fortnight is measured from the day it ran, and two weeks later the week has
     unbuilt days in it again and every screen silently returns to the slow path. The days this
     builds are in the FUTURE: no decks, empty index range, milliseconds each. Bounded, last,
     and on the same clock as everything else, so a slow morning simply skips it and the next
     upload carries on. See topUpDeckTotals. */
  if (isLastPart && deckKind && clock.worth(5000)) {
    try { await beforeDeadline(topUpDeckTotals(supabase, 3000), Math.min(4000, clock.left()), false); }
    catch (e) { /* the window is topped up by the next upload, or by RUN-ME-022 */ }
  }
  /* AND TRIM THE CALL LOG, IN ONE BOUNDED SLICE.
       "please always autodelete call logs by keeping only last week and current [2]"

     call_logs is the fastest-growing table in the book -- three hundred officers, every call,
     every day, 977,000 rows in the first month -- and it is on the path the phone reads all
     day. Keeping the current week and the one before it holds it at roughly forty thousand.

     ONE SLICE, LAST, ON THE SAME CLOCK as everything else here, so a slow morning simply skips
     it and the next upload carries on. A day produces about 2,800 calls; a slice of 20,000 is
     seven days of them, so this keeps up comfortably from one upload a day. The FIRST clean-out
     is nine hundred thousand rows and is deliberately NOT done here -- RUN-ME-027 section 2b
     is run by hand until it reports 0, because the one thing this must never do is turn an
     upload into a mass delete.

     `prune_call_logs` not existing is the ordinary case until RUN-ME-027 is run, and it is
     caught like every other optional migration: the upload stands and nothing is trimmed. */
  if (isLastPart && clock.worth(4000)) {
    try {
      await beforeDeadline(
        runQuery(() => supabase.rpc('prune_call_logs', { p_keep_weeks: 2, p_limit: 20000 })),
        Math.min(3000, clock.left()), null);
    } catch (e) { /* not installed, or no time -- the next upload trims instead */ }
  }
  /* =====================================================================================
     THE LINE THAT EMPTIED THE OFFICERS' LIST.

       "Just previewing defaulters arranged by arreas and not seeing ester at 1.7m ... the
        complain is growing larger and words spreading that the app has no customers"

     This used to run `followupClean` with days:1 after every current-defaulter upload, on the
     reasoning that somebody whose deck came round without them should drop off at once rather
     than a fortnight later.

     THE REASONING WAS RIGHT AND THE TOOL WAS WRONG. followupClean retires on AGE ALONE and
     knows nothing about weekdays. Decks are per weekday and each one comes round ONCE A WEEK,
     so "not confirmed within one day" describes almost everybody almost all the time. Uploading
     Friday's deck blanked every customer whose own deck was Monday, Tuesday or Wednesday --
     status and arrears set to null -- and the phone's Defaulters list skips exactly those rows.
     Measured on a register of a hundred spread across five weekdays: sixty retired by ONE
     upload, leaving only the last two days' decks standing.

     Then Monday's upload blanked Friday's people back again. That is the seventh-of-the-book
     fault this system already fixed once inside syncFollowupFromDeck, re-introduced wholesale by
     a housekeeping call that ran immediately afterwards and overrode it.

     NOTHING REPLACES IT, because nothing needs to. syncFollowupFromDeck has already run by this
     point and it does this job properly: it retires the people who were on THIS WEEKDAY'S
     previous deck and are not on this one, plus anyone unconfirmed for a fortnight, with a brake
     so one upload can never empty the list. The correct rule was already there; this was a
     second, cruder one running last and winning. */

  /* THE REGISTER REPAIRS ITSELF NOW, because nobody should have to know it needs repairing.

       "I don't need manual works of ... Rejista ya ufuatiliaji / Follow-up register
        (should be automated and remove them from fontend)"

     Quite right. Three buttons in Settings existed because three things could silently drift,
     and a button is only a fix for somebody who already knows to press it -- which is nobody,
     until the phones are empty and the complaint has been going round for a week.

     syncFollowupFromDeck, a few lines above, writes the deck that was just uploaded into the
     register. This covers the rest of the book: every OTHER weekday's deck, each read at its own
     date, put back if the register has it blanked or missing. That is what makes "I should not
     have to upload Saturday's report today to see Saturday's defaulters" true, rather than true
     only for whoever remembers the button.

     AND IT CANNOT LIVE HERE, which the field found within the hour:

       "uploading now fails at 4/5 Failed: Error: Seva imechukua muda mrefu mno / the server took
        too long — HTTP 504"

     That is mine. The last slice of a defaulter upload was already the heaviest request in the
     system -- it writes the deck, then reads the WHOLE working register to merge the officers'
     work into it, then sweeps superseded batches. Adding a full rebuild on top meant reading
     every weekday's deck across the company and the register a second time, inside the same
     sixty seconds the platform allows. It went over, and an upload that fails is worse than any
     list being short: nothing lands at all.

     SO IT IS SPLIT BY WHAT IT IS FOR. Un-blanking the deck that was just uploaded is
     syncFollowupFromDeck's own job and it already does it, for free, from rows it is holding
     anyway -- so a weekday's people come back the moment their weekday is uploaded, with no
     extra read. What that cannot reach is a customer on a DIFFERENT weekday's deck who is still
     blanked from before, and that is now a one-off repair rather than a standing cost, because
     the thing that blanked them (followupClean at days:1) is gone. Nothing is producing new
     damage for a per-upload repair to chase.

     The button stays gone from Settings as asked, and nothing replaces it, because after the
     one-off repair there is nothing left for it to do: each weekday's own upload restores its
     own people from rows already in hand, so any row still blanked from the old sweep corrects
     itself the next time its weekday comes round -- within a week, without anybody pressing
     anything. Automatic, and free. */


  return {
    inserted: records.length, table, uploadBatch, uploadDate, replaced,
    autoSwept, autoRetired, autoRegister,
    fileRows: dataRows, skipped: skipped || undefined,
    /* Which slice this was. The page adds them up and only shows a result when the last one
       lands, so "Done -- 2,000 rows" twelve times over never appears. `partial` is the flag it
       reads: true means the file is not all in yet and nothing has been rebuilt from it. */
    ...(part ? { part: { index: partIndex, total: partTotal, partial: !isLastPart } } : {}),
    followupSynced, followupRetired: followupRetired || undefined, behaviour, sameAsToday,
    deferred: (followupDeferred || sweepDeferred)
      ? { retire: followupDeferred || undefined, sweep: sweepDeferred || undefined } : undefined,
    /* SAY WHAT WAS NOT DONE. This was `deckBuilt || undefined` -- so a build that FAILED sent
       no field at all, and the page said "Done" with nothing to distinguish it from a build
       that worked. Silence read as success, on the one thing that had the power to slow the
       whole company down.

       On 5 September it did: one morning's defaulter day went unbuilt, and because a range
       served from the cache only when EVERY day in it was built, every screen fell through to
       the live aggregate over 1.4 million rows -- thirty-one of them at once, with uploading
       and the phone queueing behind. The cache now stitches around a gap, so a missing day
       costs one small aggregate instead of the earth. It should still not be invisible.

       Always sent when this upload owed a build, with WHY when it did not happen: `no-time`
       means the upload's clock had nothing left, which is the budget working as designed and
       usually corrects itself on the next upload of that date; `failed` means it was tried and
       did not, which is worth somebody looking at. */
    deckTotals: (isLastPart && deckKind && meta.date)
      ? { built: deckBuilt, kind: deckKind, date: meta.date,
          why: deckBuilt ? null : (clock.worth(6000) ? 'failed' : 'no-time') }
      : undefined,
    deckBuilt: deckBuilt || undefined,
    stubbed: stubbed || undefined,
    collapsed: collapsed || undefined,
    /* Reading a date column the wrong way round moves history by up to eleven months and looks
       entirely reasonable in the result, so the file is told what was decided about it. */
    loanDateOrder: loansOrder === undefined ? undefined
      : (loansOrder === null ? 'assumed day/month -- the file gave no clue either way'
        : loansOrder ? 'day/month' : 'month/day'),
    dateOrder: commentsOrder ? (commentsOrder.dayFirst === null ? 'assumed day/month (the file gave no clue either way -- if these are American dates, check a few)'
      : commentsOrder.dayFirst ? 'day/month, as the file itself showed' : 'month/day, as the file itself showed') : undefined,
    unreadableStamps: commentsOrder && commentsOrder.unreadable ? commentsOrder.unreadable : undefined,
    message: [
      /* NAMED, not counted. This is the line that would have ended a week of searching. */
      skipped ? `\u26a0\ufe0f ${skipped} row(s) of the ${dataRows} in this file were NOT uploaded, because their reference column could not be read. They are not in the system and no screen can show them. Check the header spelling of the reference column against the rest of the file. Skipped: ${skippedNames.join('; ')}${skipped > skippedNames.length ? `; and ${skipped - skippedNames.length} more` : ''}.` : '',
      loansOrder !== undefined ? `Dates in this file were read as ${loansOrder === null ? 'DAY/MONTH (nothing in the file said which way round it writes them)' : loansOrder ? 'DAY/MONTH' : 'MONTH/DAY'}. Check one row against the report if a figure looks like it landed in the wrong month.` : '',
      /* The whole reason "appending didn't update": the same loan under a new identity. Both
         figures are worth a sentence -- an update that happened invisibly is indistinguishable
         from one that did not happen. */
      loansRelinked ? `${loansRelinked} loan(s) were recognised as already in the pipeline under an older identity (a docket or name from before their LOAN ID existed) and their existing rows were UPDATED rather than duplicated.` : '',
      loansMerged ? `${loansMerged} duplicate row(s) -- the same loan filed twice by earlier uploads under two identities -- were merged into one. Sales and pipeline counts no longer double-count them.` : '',
      table === 'received_payments' ? (receivedAbnormal
        ? `${receivedAbnormal} of these payments are irregular (not a multiple of TZS ${receivedStep.toLocaleString('en-US')}) and are now flagged on the Abnormal Payments screen and the dashboard. No separate abnormal sheet is needed.`
        : 'None of these payments are irregular by the multiples rule. The Abnormal Payments screen works itself out from this table, so there is nothing else to upload.') : '',
      newTeams.length ? `Also auto-created ${newTeams.length} new team(s), not seen before: ${newTeams.join(', ')}. Worth a glance -- if any of these is actually a typo of an existing team, fix it in this table directly rather than leaving a duplicate.` : '',
      /* A COLUMN THROWN AWAY IN SILENCE IS THE WORST KIND OF SUCCESS. The file was read right,
         the database has no such column yet, and without this line the upload says "done" while
         the very field the admin uploaded the sheet to change is left exactly as it was. */
      teamsDroppedCols && teamsDroppedCols.length ? `⚠️ Your file also carried ${teamsDroppedCols.join(', ')} — this database has no such column yet, so ${teamsDroppedCols.length === 1 ? 'it was' : 'they were'} NOT saved and the rest of the file went in as normal. Run the outstanding migration in db/migrations (region, zone and the per-role phone numbers come from 2026-08-09-team-contacts.sql), then upload this same sheet again.` : '',
      stubbed ? `${stubbed} of these customers were not on the follow-up list, so a placeholder record was created for each so their history has somewhere to live. They are NOT counted as defaulters anywhere -- a placeholder has no status and no arrears.` : '',
      collapsed ? `${collapsed} row(s) in the file were the same record twice and were written once. ${table === 'followup_comments' ? 'For comments that means the same sentence about the same customer at the same minute -- one comment, exported twice.' : `Matched on ${upsertTables[table]}.`} Nothing was lost: the file's last version of each is what was kept.` : '',
      commentsOrder && commentsOrder.unreadable ? `${commentsOrder.unreadable} row(s) had a TIMESTAMP that could not be read; those are stamped with the time of this upload instead.` : '',
      followupRetired ? `\u2713 ${followupRetired} customer(s) this deck no longer names were taken off the officers' working list. Their comments and history are untouched, and the next deck that names them puts them straight back.` : '',
      /* SAID, NOT SWALLOWED. Housekeeping that ran out of clock is reported in the same
         sentence the upload reports itself, because "the file is in and one tidying step is a
         day late" is a completely different thing from a failed upload -- and the person at the
         keyboard can only tell the difference if somebody tells them. */
      followupDeferred ? `\u2713 The deck is in. The officers' working list was NOT re-checked for customers who have cleared, because the database was too slow today to finish that inside the time the host allows -- and running past it would have failed this upload after the file had already landed. The next current-defaulters upload does it in full. Nothing is missing from the list; at most a few cleared customers are still on it.` : '',
      sweepDeferred ? `Superseded older uploads of this date were left in place for now, for the same reason. They change no figure -- the newest upload is the one every screen reads -- and the next upload or the Settings sweep clears them.` : '',
      followupCapped ? `\u26a0\ufe0f NOTHING was taken off the officers' working list, because this file would have retired ${followupCapped} of them -- nearly the whole list. A current-defaulters file is meant to carry the WHOLE book, so that shape usually means the export was cut short or only part of it was selected. Check the file has every team in it and upload it again. Nobody was changed.` : '',
    ].filter(Boolean).join(' ') || undefined
  };
});

/** Refresh followup_status from a current-defaulter deck, keeping whatever the officers have
    already entered. Customers who have left the deck keep their row (their history is still
    worth reading) but stop looking like live defaulters, so they drop off the working list
    instead of being called for a debt they have already cleared. */
/* prevWeekdayDeck stood here: two queries that fetched "the previous deck of this weekday" so
   the upload could be compared against it. It is gone, and so are its two round trips -- the
   comparison now reads the deck_date stamp the register already carries. See the block inside
   retireFollowupAfterDeck for why looking for a previous deck was both broken and the wrong
   question. */

/* "THE DECKS ARE PER WEEKDAY" was the belief that stood here, and it was half right. Decks
   ARE filed per weekday and recovery is paired on the weekday -- but a CURRENT file carries the
   whole defaulter book, so the weekday never decided who belongs on an officer's list. The
   blanking that seemed to prove otherwise was the slicing fault, fixed separately. The
   fourteen-day stale rule that compensated for the resulting paralysis is gone with it:
   somebody missing from the latest current file is retired by that upload, not a fortnight
   later. See retireFollowupAfterDeck. */
/** How much of the working list one upload may retire before it is refused outright, as a
    fraction of the live rows. This is a guard against a TRUNCATED file, not against churn: one
    current file is the whole defaulter book, so retiring a great many people is often exactly
    right -- the first upload after the comparison was fixed clears a backlog years deep. Only
    a file that would empty nearly everything is treated as a file that is not all there. */
const FU_RETIRE_CAP = 0.9;

/** WRITE ONE SLICE OF A DECK INTO THE REGISTER. No reads, no merge, no retiring.
 *
 *  The old version read the WHOLE register first so it could copy fu_status, the promise and
 *  the comment back onto every row -- protecting the officers' work by rewriting it. That was
 *  never necessary: PostgREST's upsert updates exactly the columns the payload carries, so
 *  simply NOT MENTIONING those columns preserves them, on a row that already exists, without
 *  reading anything. On a genuinely new customer they are absent, which is correct.
 *
 *  Dropping that read is what makes this safe to run on EVERY slice: the cost is proportional
 *  to the slice, not to the register, so a nine-part upload no longer pays for nine full reads
 *  of the largest current-state table in the system. */
export async function writeFollowupFromDeck(db, records, deckDate) {
  const rows = (records || []).filter(d => d && d.ref).map(d => ({
    ref: String(d.ref), team: d.team || null, full_name: d.full_name || null,
    contact: d.contact || null,
    guarantor_name: d.guarantor_name || null, guarantor_contact: d.guarantor_contact || null,
    disb_date: d.disb_date || null, last_trans: d.last_trans_date || null,
    status: d.status || null, ds: d.ds || null, dc: d.dc == null ? null : d.dc,
    days_elapsed: d.days_elapsed == null ? null : d.days_elapsed,
    rejesho: d.other_inst == null ? null : d.other_inst,
    arrears: d.arrears == null ? null : d.arrears,
    deck_date: deckDate || null,
    updated_at: new Date().toISOString(),
  }));
  if (!rows.length) return 0;
  try {
    return await writeInChunks(db, 'followup_status', rows, 'ref');
  } catch (e) {
    /* deck_date arrived in a migration that is run by hand. A database without it must still
       get its register written -- the stamp is what the retirement clock reads, and losing the
       stamp is a smaller failure than losing the customer. */
    if (!/deck_date/.test(String((e && e.message) || e))) throw e;
    for (const r of rows) delete r.deck_date;
    return writeInChunks(db, 'followup_status', rows, 'ref');
  }
}

/** THE RETIRING, ONCE, AGAINST THE WHOLE UPLOAD.
 *
 *  This is what was reading one slice and concluding that the other eight thousand customers
 *  had left the book. The refs of the upload are read back from the table by batch -- ONE
 *  column, so it costs a fraction of what re-sending the file would -- which makes "who is in
 *  this deck" a fact about the DECK rather than about however the browser happened to slice it.
 */
/* retireSettledFromExpected stood here -- an expected upload clearing settled customers off the
   officers' register. It is gone. The defaulters file writes the defaulters list and nothing
   else does; see the block at the call site for why it was added and why fixing the deck
   comparison replaced it. */

export async function retireFollowupAfterDeck(db, weekday, uploadBatch, deckDate) {
  const mine = await fetchAll(() => db.from('defaulter_snapshots').select('ref')
    .eq('snapshot_type', 'current').eq('upload_batch', uploadBatch));
  const inDeck = new Set((mine || []).map(r => String(r.ref).trim().toUpperCase()));
  if (!inDeck.size) return { retired: 0, capped: 0 };

  /* THE WHOLE REGISTER WAS BEING READ TO FIND THE PART OF IT THAT IS LIVE.
     Four columns of every row in the largest current-state table in the system came back here,
     and then all but the live ones -- the rows with a status or arrears still on them -- were
     thrown away in this process. On a slow morning that read alone is most of the sixty seconds
     the platform allows, which is how a completed upload ended as an HTTP 504.

     The filter belongs at the database, where it is one index-free but narrow scan returning a
     fraction of the rows, and ONE column: `ref` is all that is used from here on. status and
     arrears were only ever read to decide "is this row live", which is now decided before the
     rows are sent, and PostgREST spells that `status.not.is.null,arrears.not.is.null`.

     deck_date is not read at all -- it is only PROBED, because the migration that adds it is
     run by hand and the retirement write must know whether to blank it. One row is enough to
     ask that, so the probe costs nothing next to what it replaced. */
  let stamped = true;
  try {
    const { error } = await db.from('followup_status').select('deck_date').limit(1);
    if (error) throw new Error(error.message);
  } catch (e) {
    if (!/deck_date/.test(String((e && e.message) || e))) throw e;
    stamped = false;
  }
  const liveRows = (await fetchAll(() => db.from('followup_status').select('ref')
    .or('status.not.is.null,arrears.not.is.null'))) || [];

  /* =====================================================================================
     THE LATEST CURRENT FILE IS THE DEFAULTERS LIST. THAT IS THE WHOLE RULE.
     =====================================================================================
       "defaulters are uploaded with current and we cant look by last day of last week but
        read current defaulters latest file no matter when uploaded"

       "we just leaving each days reports and using initial to know recovery amount but only
        latest [current defaulter] file is legit for defaulters list no matter which day it is"

     A current file carries the WHOLE defaulter book, not one weekday's slice of it. So the
     latest one uploaded is the complete answer to "who is a defaulter": anybody the register
     still shows as live, whom this file does not name, has left the book. No weekday, no
     previous deck, no clock.

     WHAT WAS HERE BEFORE, AND WHY IT RETIRED NOBODY. Two rules stood in place of that one:

       prevWeekdayDeck -- "who was on this weekday's PREVIOUS deck and is not on this one". It
       never found a previous deck: the file is written to defaulter_snapshots BEFORE this
       runs, so the newest date for the weekday is the upload's own, and dropping this batch
       left nothing. It returned null and retired NOBODY, every time. The only comparison it
       ever made was against another upload OF THE SAME DATE -- a same-day re-upload, which is
       why every test of it passed and no customer ever came off a phone.

       the fourteen-day stale rule -- the backstop that had to exist because the rule above
       did nothing. Subsumed now: somebody missing from the latest file is retired on that
       upload, not a fortnight later.

     THE WEEKDAY IS STILL REAL, JUST NOT HERE. Recovery is initial-minus-current paired on the
     same weekday, and every day's reports are kept for exactly that. The weekday decides
     RECOVERY ARITHMETIC; it never decided who is on an officer's list. Conflating the two is
     what produced a register nothing could clear.

     THE BLANKING THAT MADE PEOPLE FEAR THIS. "uploading Monday's current deck cleared every
     defaulter whose follow-up day is Tuesday through Sunday" was real, and the cause was the
     SLICING bug documented at the call site: the retirement ran against `records`, a single
     thousand-row slice, so 8,000 of 8,888 customers looked absent. `inDeck` is now read back
     from the table by upload_batch -- the whole upload, every slice -- so "not in the file" is
     a fact about the FILE, and the per-weekday scoping added to compensate is not needed. */
  const departed = liveRows.filter(r => !inDeck.has(String(r.ref).trim().toUpperCase()));

  /* THE BRAKE, against a file that is not all there.
     One file is the whole book, so a TRUNCATED or half-selected export would retire almost
     everybody -- and unlike a wrong figure, an empty list is what two hundred officers see at
     once. It no longer guesses at a "reasonable" churn, because with this rule a large
     retirement is often perfectly correct: the first upload after this fix clears the whole
     backlog nothing has ever been able to clear. It only refuses the catastrophic shape --
     a file that would empty nearly the entire register -- and says so instead. */
  const capAt = Math.floor(liveRows.length * FU_RETIRE_CAP);
  let capped = 0, retire = departed;
  if (liveRows.length && departed.length > capAt) { capped = departed.length; retire = []; }

  const gone = retire.map(r => ({ ref: r.ref, status: null, arrears: null,
    ...(stamped ? { deck_date: null } : {}),
    updated_at: new Date().toISOString() }));
  if (gone.length) await writeInChunks(db, 'followup_status', gone, 'ref');
  return { retired: gone.length, capped };
}

/* syncFollowupFromDeck stood here: the ORIGINAL combined write-and-retire, superseded by
   writeFollowupFromDeck + retireFollowupAfterDeck when the slicing fault was found. Nothing in
   the running system had called it since; it survived only because its tests still did, and it
   carried its own copy of the prevWeekdayDeck comparison that retired nobody. A second
   implementation of a rule is a second answer that can disagree with the first -- which is what
   this file's own header warns about -- so it is gone rather than fixed twice. */
