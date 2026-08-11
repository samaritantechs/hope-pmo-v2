import { createHash } from 'node:crypto';
import { buildHeaderMap, col, num, dateOrNull, timeOrNull, dsText, normPhone, textOrNull, normTeam, stampOrNull, inferDayFirst, tightestSpanIsDayFirst } from './parse.js';

// Every importer takes the raw parsed CSV rows (array of arrays, row 0 = headers) and
// returns an array of objects ready to insert. Mapping is by HEADER NAME, not column
// position -- the one thing the old system's mapRows_ always got right, kept here.

function rowsToObjects(csvRows) {
  const headerMap = buildHeaderMap(csvRows[0]);
  return csvRows.slice(1)
    .filter(r => r.some(v => String(v || '').trim() !== ''))   // drop fully-blank rows
    .map(r => ({ raw: r, h: headerMap }));
}

/* WHAT A REFERENCE COLUMN IS CALLED, IN EVERY SPELLING THIS COMPANY USES.

   normalizeHeader only trims, uppercases and collapses runs of whitespace -- so `REF#`, `REF #`
   and `REF NO` are three different keys, and a file using the second or third matched NEITHER
   candidate. The row then came out with ref null and was dropped by the filter below, silently,
   because a header that matches nothing looks exactly like a column of empty cells.

   That is the third time this shape has cost this system a week: the abnormal payments file's
   CUSTOMER NO and PAYMENT NO, then five columns of the received payments file, now this. Here it
   is worse than a blank column, because the reference is what the filter keeps the row on -- a
   spelling nobody thought of does not empty a field, it deletes the customer.

   `REF NO` is the company's own wording: it is what their received-payments columns say. */
export const REF_HEADERS = ['REF#', 'REF', 'REF NO', 'REF #', 'REF NO.', 'REF NUMBER',
  'REFERENCE', 'REFERENCE NO', 'LOAN REF', 'LOAN REF#'];

export function importDefaulters(csvRows, { snapshotType, weekday, snapshotDate }) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    ref: textOrNull(col(r, h, ...REF_HEADERS)),
    docket_no: textOrNull(col(r, h, 'DOCKET#', 'DOCKET #')),
    full_name: textOrNull(col(r, h, 'FULLNAME', 'FULL NAME')),
    contact: normPhone(col(r, h, 'CONTACT#', 'CONTACT #')),
    guarantor_name: textOrNull(col(r, h, 'GUARANTOR NAME')),
    guarantor_contact: normPhone(col(r, h, 'GUARANTOR CONTACT')),
    disb_date: dateOrNull(col(r, h, 'DISB DATE')),
    expire_date: dateOrNull(col(r, h, 'EXPIRE DATE')),
    chronic_date: dateOrNull(col(r, h, 'CHRONIC DATE')),
    due_date: dateOrNull(col(r, h, 'DUE DATE')),
    last_trans_date: dateOrNull(col(r, h, 'LAST TRANS DATE')),
    status: textOrNull(col(r, h, 'STATUS')),
    ds: dsText(col(r, h, 'D.S')),
    dc: num(col(r, h, 'D.C')),
    days_elapsed: num(col(r, h, 'DAYS ELAPSED')),
    initial_inst: num(col(r, h, 'INITIAL INST')),
    other_inst: num(col(r, h, 'OTHER INST')),
    payment_exp: num(col(r, h, 'PAYMENT EXP.')),
    t_payment: num(col(r, h, 'T.PAYMENT')),
    arrears: num(col(r, h, 'ARREAS', 'ARREARS')),
    balance: num(col(r, h, 'BALANCE')),
    branch: textOrNull(col(r, h, 'BRANCH')),
    team: normTeam(col(r, h, 'TEAM')),
    zone: textOrNull(col(r, h, 'ZONE')),
    nearest_landmark: textOrNull(col(r, h, 'NEAREST LANDMARK')),
    snapshot_type: snapshotType,       // 'initial' | 'current'
    weekday,                            // 'MON'..'SUN'
    snapshot_date: snapshotDate,        // yyyy-mm-dd, pass explicitly -- this is metadata about the FILE, not a column in it
  })).filter(x => x.ref);
}

export function importExpected(csvRows, { snapshotType, snapshotDate }) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    ref: textOrNull(col(r, h, ...REF_HEADERS)),
    docket_no: textOrNull(col(r, h, 'DOCKET#')),
    full_name: textOrNull(col(r, h, 'FULLNAME')),
    contact: normPhone(col(r, h, 'CONTACT#')),
    guarantor_name: textOrNull(col(r, h, 'GUARANTOR NAME')),
    guarantor_contact: normPhone(col(r, h, 'GUARANTOR CONTACT')),
    disb_date: dateOrNull(col(r, h, 'DISB DATE')),
    due_date: dateOrNull(col(r, h, 'DUE DATE')),
    first_schedule_date: dateOrNull(col(r, h, 'FIRST SCHEDULE DATE')),
    last_schedule_date: dateOrNull(col(r, h, 'LAST SCHEDULE DATE')),
    last_trans_date: dateOrNull(col(r, h, 'LAST TRANS DATE')),
    due_summary: dsText(col(r, h, 'DUE SUMMARY')),
    initial_inst: num(col(r, h, 'INITIAL INST')),
    other_inst: num(col(r, h, 'OTHER INST')),
    payment_expected: num(col(r, h, 'PAYMENT EXPECTED')),
    todays_payment: num(col(r, h, "TODAY'S PAYMENT")),
    todays_status: textOrNull(col(r, h, 'TODAYS STATUS')),
    arrears: num(col(r, h, 'ARREAS', 'ARREARS')),
    total_amount: num(col(r, h, 'TOTAL AMOUNT')),
    balance: num(col(r, h, 'BALANCE')),
    branch: textOrNull(col(r, h, 'BRANCH')),
    team: normTeam(col(r, h, 'TEAM')),
    zone: textOrNull(col(r, h, 'ZONE')),
    snapshot_type: snapshotType,        // 'today' | 'tomorrow' | 'yesterday' | 'initial'
    snapshot_date: snapshotDate,
  })).filter(x => x.ref);
}

export function importFollowup(csvRows) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    ref: textOrNull(col(r, h, 'REF#')),
    team: normTeam(col(r, h, 'TEAM')),
    full_name: textOrNull(col(r, h, 'FULLNAME')),
    contact: normPhone(col(r, h, 'CONTACT#')),
    guarantor_name: textOrNull(col(r, h, 'GUARANTOR NAME')),
    guarantor_contact: normPhone(col(r, h, 'G. CONTACT')),
    disb_date: dateOrNull(col(r, h, 'DISB DATE')),
    last_trans: dateOrNull(col(r, h, 'LAST TRANS')),
    status: textOrNull(col(r, h, 'STATUS')),
    ds: dsText(col(r, h, 'D.S')),
    dc: num(col(r, h, 'D.C')),
    days_elapsed: num(col(r, h, 'DS')),
    rejesho: num(col(r, h, 'REJESHO')),
    arrears: num(col(r, h, 'ARREAS', 'ARREARS')),
    fu_status: textOrNull(col(r, h, 'FU STATUS')),
    promise_date: dateOrNull(col(r, h, 'PROMISE DATE')),
    promise_amt: num(col(r, h, 'PROMISE AMT')),
    last_comment: textOrNull(col(r, h, 'LAST COMMENT')),
    comment_by: textOrNull(col(r, h, 'COMMENT BY')),
    comment_at: dateOrNull(col(r, h, 'COMMENT AT')),
  })).filter(x => x.ref);
}

/** The identity of a comment: who it was about, when it was said, and what was said. Two rows
    agreeing on all three ARE the same comment -- there is no legitimate way to write the same
    sentence about the same customer in the same minute twice.

    This matters because importing years of history is never done in one clean go. A file is
    uploaded, something is wrong with it, it is fixed and uploaded again -- and without an
    identity the second attempt doubles every comment already in, with nothing on screen to say
    so. Keyed this way the database itself collapses the repeat. */
export function commentId(o) {
  const t = v => String(v == null ? '' : v).trim().toUpperCase();
  const hex = createHash('md5')
    .update([t(o.ref), t(o.created_at), t(o.comment), t(o.created_by)].join('|'))
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The v1 follow-up comment log:
      TIMESTAMP  REF#  TEAM  FULLNAME  COMMENT  FU STATUS  PROMISE DATE  PROMISE AMT  BY
      NEW NUMBER  DOCKET#

    THE TIMESTAMP IS THE WHOLE POINT of this import, and it was the one field being thrown
    away. A v1 export writes "6/22/2026 11:29"; dateOrNull cannot read a date with a clock
    attached and returned null, so every row fell through to `new Date()` -- years of follow-up
    history all stamped with the moment somebody pressed Upload. The thread on each customer
    would have read as one instant, in file order, with every date wrong.

    So: a real timestamp, clock included, in EAT. Both halves of that matter -- the clock keeps
    the afternoon's comments in the order they were made, and reading it as EAT stops an
    evening comment landing on the previous day.

    The day/month order is inferred from the whole column rather than assumed, and applied to
    PROMISE DATE too so one file cannot be read two ways. */
export function importComments(csvRows) {
  const objs = rowsToObjects(csvRows);
  const dayFirst = inferDayFirst(objs.map(({ raw: r, h }) => col(r, h, 'TIMESTAMP')));
  return objs.map(({ raw: r, h }) => {
    const row = {
      ref: textOrNull(col(r, h, 'REF#')),
      docket_no: textOrNull(col(r, h, 'DOCKET#')),
      team: normTeam(col(r, h, 'TEAM')),
      full_name: textOrNull(col(r, h, 'FULLNAME')),
      comment: textOrNull(col(r, h, 'COMMENT')),
      fu_status: textOrNull(col(r, h, 'FU STATUS')),
      promise_date: dateOrNull(col(r, h, 'PROMISE DATE'), dayFirst),
      promise_amt: num(col(r, h, 'PROMISE AMT')),
      new_number: normPhone(col(r, h, 'NEW NUMBER')),
      created_by: textOrNull(col(r, h, 'BY')),
      /* An unreadable stamp falls back to now, as before -- a comment with no date is still
         worth keeping. What is NOT acceptable is a READABLE stamp being silently discarded,
         which is what was happening to every row of a v1 export. */
      created_at: stampOrNull(col(r, h, 'TIMESTAMP'), dayFirst) || new Date().toISOString(),
    };
    row.id = commentId(row);
    return row;
  }).filter(x => x.ref);
}

/** What importComments decided about a file, for the upload screen to report. Reading a date
    column the wrong way round is the kind of mistake that is invisible in the result and
    expensive later, so the file is asked rather than guessed at -- and when it cannot say, the
    person uploading is told which way it was read. */
export function commentsDateOrder(csvRows) {
  const objs = rowsToObjects(csvRows);
  const stamps = objs.map(({ raw: r, h }) => col(r, h, 'TIMESTAMP'));
  const dayFirst = inferDayFirst(stamps);
  const unreadable = objs.filter(({ raw: r, h }) => {
    const v = col(r, h, 'TIMESTAMP');
    return String(v == null ? '' : v).trim() !== '' && stampOrNull(v, dayFirst) == null;
  }).length;
  return { dayFirst, unreadable };
}

const LOAN_STAGE_COLUMNS = {
  full_name: ['FULLNAME', 'FULL NAME'],
  contact: ['CONTACT#', 'CONTACT'],
  momo: ['MOMO', 'MOMO#'],
  recipient_full_name: ['RECIPIENT FULL NAME'],
  recipient_momo: ['RECIPIENT MOMO'],
  guarantor_name: ['GUARANTOR NAME', 'GUARANTOR'],
  guarantor_contact: ['GUARANTOR CONTACT'],
  region: ['REGION'],
  branch: ['BRANCH'],
  team: ['TEAM'],
  zone: ['ZONE'],
  location: ['LOCATION'],
  nearest_landmark: ['NEAREST LANDMARK'],
  product: ['PRODUCT'],
  disbursement_type: ['DISB MODE', 'DISBURSEMENT TYPE'],
  requested_amt: ['REQUESTED AMT', 'REQUESTED ANT'],
  team_recomm: ['TEAM RECOMM', 'TEAM RECOMMENDATION'],
  previous_balance: ['PREVIOUS BALANCE'],
  principal_amt: ['PRINCIPAL AMT'],
  processing_fee: ['PROCESSING FEE'],
  interest_amt: ['INTEREST AMT'],
  net_disbursed: ['NET DISBURSED'],
  loan_amt: ['LOAN AMT'],
  bank_name: ['BANK', 'BANK NAME'],
  account_no: ['ACCOUNT NO'],
  docket_no: ['DOCKET#', 'DOCKET #'],
  loan_id: ['LOAN ID'],
  track_no: ['TRACK#', 'TRK#', 'TRACK'],
  // The CALL AGENT who took the application. It was in the schema but never imported, so the
  // dashboard's call-agent board had nothing to group by and fell back to the calls app.
  created_by: ['CREATED BY', 'CREATEDBY', 'AGENT', 'AGENT ID'],
  disb_status: ['DISB STATUS'],
  disb_date: ['DISB DATE'],
  approved_date: ['APPROVED DATE'],
  approved_by: ['APPROVED BY'],
  disbursed_by: ['DISBURSED BY'],
  assigned_by: ['ASSIGNED BY'],
};

const NUMERIC_LOAN_FIELDS = new Set([
  'requested_amt', 'team_recomm', 'previous_balance', 'principal_amt',
  'processing_fee', 'interest_amt', 'net_disbursed', 'loan_amt',
]);
const DATE_LOAN_FIELDS = new Set(['disb_date', 'approved_date']);

/** One importer for all 8 loan-pipeline stages -- pass the stage name matching the
    loan_stage enum ('unassigned', 'assigned', ... 'disbursed') and it maps whatever
    columns that particular sheet export actually has; every stage's CSV has a
    different subset of these columns, which is fine, everything else is left null. */
/** WHAT MAKES TWO ROWS THE SAME LOAN.
    The whole point of the loans table is that a loan is ONE row whose `stage` moves, instead
    of the same loan living in eight separate sheets. That only holds if the system can
    recognise a loan it has already seen -- otherwise uploading Unassigned, then Assigned, then
    Approved for the same loan creates three rows, and re-uploading Approved doubles the
    sales figure.

    The identity is the loan's own number where the export carries one, and the customer plus
    their loan sequence where it does not. Deliberately NOT including stage or any amount: a
    loan that advances a stage, or whose amount is corrected, is still the same loan. */
export function loanIdentity(o) {
  const t = v => String(v == null ? '' : v).trim().toUpperCase();
  return t(o.loan_id) || t(o.docket_no)
    || [t(o.track_no), t(o.full_name), t(o.contact)].filter(Boolean).join('|');
}

/** The identity, turned into the row's primary key so the database itself refuses a
    duplicate. Same trick call_logs already uses: dedup by construction, not by remembering
    to check. md5 is used as a fingerprint here, never as security -- and the SQL migration
    computes the identical value with md5(...)::uuid so existing rows re-key to match. */
export function loanId(o) {
  const hex = createHash('md5').update(loanIdentity(o)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Which way round this file writes its dates, decided over the WHOLE date column rather than
    one value at a time. Exported so the upload can say what it decided -- reading a date column
    the wrong way round moves history by months and looks entirely reasonable in the result. */
export function loansDateOrder(csvRows) {
  const objs = rowsToObjects(csvRows);
  const vals = [];
  for (const { raw: r, h } of objs) {
    for (const field of DATE_LOAN_FIELDS) {
      const v = col(r, h, ...(LOAN_STAGE_COLUMNS[field] || []));
      if (v != null && v !== '') vals.push(v);
    }
  }
  /* Evidence first -- a 22 in the first component can only be a day, and that settles it. Only
     when a file offers no evidence at all does the shape of the result get a say. */
  const byEvidence = inferDayFirst(vals);
  return byEvidence === null ? tightestSpanIsDayFirst(vals) : byEvidence;
}

/* THE APPROVED DATE DECIDES WHICH MONTH A SALE BELONGS TO, and it was being read one value at
   a time with no knowledge of the column it came from.

     "i uploaded approved and now getting 0 sales!"
     "Replaced 7 days, 2026-03-08 to 2026-10-08"

   Their file's APPROVED DATE is 8/6/2026 -- the sixth of August. Read day-first that is the
   eighth of June, and a report covering the first week of August landed as the eighth of six
   different months. Nothing was in August, so August's sales were zero. The rows were all
   there; every one of them was filed under the wrong month.

   dateOrNull already takes the order as an argument -- the comments importer has passed it
   since the v1 history import -- and this simply did not. Now the whole column decides once,
   and every date in the file is read the same way. */
export function importLoans(csvRows, stage, dayFirst) {
  const order = dayFirst === undefined ? loansDateOrder(csvRows) : dayFirst;
  return rowsToObjects(csvRows).map(({ raw: r, h }) => {
    const obj = { stage };
    for (const [field, candidates] of Object.entries(LOAN_STAGE_COLUMNS)) {
      const v = col(r, h, ...candidates);
      obj[field] = field === 'team' ? normTeam(v) : NUMERIC_LOAN_FIELDS.has(field) ? num(v) : DATE_LOAN_FIELDS.has(field) ? dateOrNull(v, order) : textOrNull(v);
    }
    return obj;
  }).filter(x => x.full_name).map(o => ({ ...o, id: loanId(o), updated_at: new Date().toISOString() }));
}

/* THE WHOLE SHEET, so the file that Teams & Staff exports goes straight back in after a few
   cells are changed. It used to read eight columns; the offline sheet has twenty-three, and
   every one it did not read was silently dropped on the way back -- which turns "download,
   edit, upload" into "download, edit, upload, then re-type the phone numbers by hand".

   Columns added by a migration are read the same as any other. api/upload.js drops the ones a
   database has not got yet rather than failing the whole file, exactly as saveTeam does. */
export function importTeams(csvRows) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    team: normTeam(col(r, h, 'TEAM')),
    team_code: textOrNull(col(r, h, 'TEAM CODE', 'TEAM_CODE')),
    region: textOrNull(col(r, h, 'REGION')),
    zone: textOrNull(col(r, h, 'ZONE')),
    opm: textOrNull(col(r, h, 'OPM')),
    opm_no: normPhone(col(r, h, 'OPM NO', 'OPM_NO')),
    recovery: textOrNull(col(r, h, 'RECOVERY')),
    recovery_no: normPhone(col(r, h, 'RECOVERY NO', 'RECOVERY_NO')),
    gmo: textOrNull(col(r, h, 'GMO')),
    gmo_no: normPhone(col(r, h, 'GMO NO', 'GMO_NO')),
    manager: textOrNull(col(r, h, 'MANAGER')),
    manager_no: normPhone(col(r, h, 'MANAGER NO', 'MANAGER_NO')),
    credit: textOrNull(col(r, h, 'C. ANALYST', 'CREDIT')),
    credit_id: textOrNull(col(r, h, 'CREDIT ID', 'CREDIT_ID')),
    credit_no: normPhone(col(r, h, 'CREDIT NO', 'C. ANALYST NO')),
    expected: textOrNull(col(r, h, 'EXPECTED')),
    expected_no: normPhone(col(r, h, 'EXPECTED NO', 'EXPECTED_NO')),
    bike: textOrNull(col(r, h, 'BIKE')),
    bike_no: normPhone(col(r, h, 'BIKE NO', 'BIKE_NO')),
    legal: textOrNull(col(r, h, 'LEGAL')),
    legal_no: normPhone(col(r, h, 'LEGAL NO', 'LEGAL_NO')),
    collection: textOrNull(col(r, h, 'COLLECTION')),
    collection_no: normPhone(col(r, h, 'COL NO', 'COLLECTION NO')),
  })).filter(x => x.team);
}

/* =====================================================================================
   RECEIVED PAYMENTS -- five columns that never matched, and the one that stopped the upload.

     "This file has no readable dates in its 'paid at' column, so there is no day to replace."

   col() matches a header by its exact normalised name. This importer asked for names the
   report does not use, and every mismatch imported as NULL in silence:

     the sheet says          this asked for       result
     PAYMENT DATE            DATE                 no date at all -- and Replace REFUSES a file
                                                  with no readable dates, which is the error
     CONTACT NO              CUSTOMER NO          the customer's number, blank
     CUSTOMER REF NO         REF NO               the loan reference, blank
     PHONE NUMBER            PAYMENT NO           the paying number, blank

   Four blank columns on a payments report, and a fifth failure that blocked the upload
   outright. Only the date announced itself; the other three had been arriving empty every
   time, because A HEADER THAT MATCHES NOTHING IS INDISTINGUISHABLE FROM A COLUMN OF EMPTY
   CELLS. That is the same fault that had CUSTOMER NO and PAYMENT NO blank on Abnormal
   Payments, and it is why every candidate list here now carries the real sheet's spelling
   FIRST and the older ones after it -- both work, and nothing already uploaded stops working.

   REF ID is now kept too. The report carries it, the abnormal-payments report carries it, and
   it is the id that reconciles a payment against the carrier's own record.

   THE DAY/MONTH ORDER IS INFERRED FROM THE WHOLE COLUMN, not assumed. "8/8/2026" is safe
   either way; "9/8/2026" is the 9th of August or the 8th of September, and a payments report
   read the wrong way round moves money between months. Every other date-bearing importer here
   already did this -- this one did not, which was a real risk sitting quietly behind the
   header bug. */
export function importReceivedPayments(csvRows) {
  const objs = rowsToObjects(csvRows);
  const dayFirst = inferDayFirst(objs.map(({ raw: r, h }) =>
    col(r, h, 'PAYMENT DATE', 'PAID AT', 'DATE PAID', 'DATE', 'TRANSACTION DATE')));
  return objs.map(({ raw: r, h }) => ({
    paid_at: dateOrNull(col(r, h, 'PAYMENT DATE', 'PAID AT', 'DATE PAID', 'DATE', 'TRANSACTION DATE'), dayFirst),
    team: normTeam(col(r, h, 'TEAM')),
    customer_name: textOrNull(col(r, h, 'CUSTOMER NAME')),
    customer_no: normPhone(col(r, h, 'CONTACT NO', 'CUSTOMER NO', 'CUSTOMER NUMBER', 'CONTACT NUMBER')),
    transaction_id: textOrNull(col(r, h, 'TRANSACTION ID')),
    ref_no: textOrNull(col(r, h, 'CUSTOMER REF NO', 'REF NO', 'CUSTOMER REF', 'REF#')),
    ref_id: textOrNull(col(r, h, 'REF ID')),
    amount_paid: num(col(r, h, 'AMOUNT PAID', 'AMOUNT', 'PAID')),
    payment_no: textOrNull(col(r, h, 'PHONE NUMBER', 'PAYMENT NO', 'PAYMENT NUMBER', 'PHONE NO')),
    sender_name: textOrNull(col(r, h, 'SENDER NAME')),
  }));
}

/** 'ALL' or blank -> null (the ALL-teams convention auth.js already honors); otherwise a
    comma/semicolon list -> text[]. Used by the two admin sheets below. */
function listOrNull(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s.toUpperCase() === 'ALL') return null;
  const items = s.split(/[;,]/).map(x => x.trim()).filter(Boolean);
  return items.length ? items : null;
}

/** The workbook's Access Codes tab (CODE | NAME | ROLE | TEAMS | TABS) -> access_codes
    rows, so codes are managed by re-uploading the sheet instead of writing SQL. Rows
    missing any of code/name/role are skipped rather than half-inserted. */
export function importAccessCodes(csvRows) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    code: textOrNull(col(r, h, 'CODE')),
    name: textOrNull(col(r, h, 'NAME')),
    role: textOrNull(col(r, h, 'ROLE')),
    teams: listOrNull(col(r, h, 'TEAMS')),
    tabs: listOrNull(col(r, h, 'TABS')) || [],
  })).filter(x => x.code && x.name && x.role);
}

/** The workbook's User Roles tab (ROLE | TABS) -> roles rows. */
export function importUserRoles(csvRows) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    role: textOrNull(col(r, h, 'ROLE')),
    tabs: listOrNull(col(r, h, 'TABS')) || [],
  })).filter(x => x.role);
}

/* ---------------------------------------------------------------------------------------
   The remaining live sheets. Without these, migrating "everything" would silently leave the
   operational registers, the call history and the tuning values behind in Sheets -- which is
   exactly the data nobody notices is missing until the day they need it.
   --------------------------------------------------------------------------------------- */

export function importAbnormal(csvRows) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    gmo: textOrNull(col(r, h, 'GMO')),
    team: normTeam(col(r, h, 'TEAM')),
    pmo: textOrNull(col(r, h, 'PMO')),
    /* THE TWO THAT WERE ARRIVING EMPTY, EVERY TIME.
       col() matches a header by its exact normalised name, and these asked only for
       'CONTACT NO' and 'PHONE NUMBER'. The sheet's headers are CUSTOMER NO and PAYMENT NO --
       so neither ever matched, and the customer's number and the paying number imported as
       NULL on every abnormal-payments upload since the beginning. Two blank columns on the
       one report whose entire purpose is to let somebody ring the payer and ask what the
       money was.

       Nothing warned about it: a header that matches nothing is indistinguishable from a
       column of empty cells, which is exactly why this survived so long. Both spellings are
       accepted now, the sheet's own first. */
    contact_no: normPhone(col(r, h, 'CUSTOMER NO', 'CUSTOMER NUMBER', 'CONTACT NO', 'CONTACT NUMBER')),
    phone_number: normPhone(col(r, h, 'PAYMENT NO', 'PAYMENT NUMBER', 'PHONE NUMBER', 'PHONE NO')),
    ref_no: textOrNull(col(r, h, 'REF NO')),
    ref_id: textOrNull(col(r, h, 'REF ID')),
    customer_name: textOrNull(col(r, h, 'CUSTOMER NAME')),
    sender_name: textOrNull(col(r, h, 'SENDER NAME')),
    transaction_id: textOrNull(col(r, h, 'TRANSACTION ID')),
    paid: num(col(r, h, 'PAID')),
    payment: textOrNull(col(r, h, 'PAYMENT')),
  })).filter(x => x.ref_no || x.customer_name || x.transaction_id);
}

export function importComplaints(csvRows) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    ref: textOrNull(col(r, h, ...REF_HEADERS)),
    team: normTeam(col(r, h, 'TEAM')),
    complainant: textOrNull(col(r, h, 'COMPLAINANT')),
    phone: normPhone(col(r, h, 'PHONE')),
    category: textOrNull(col(r, h, 'CATEGORY')),
    channel: textOrNull(col(r, h, 'CHANNEL')),
    details: textOrNull(col(r, h, 'DETAILS')),
    status: textOrNull(col(r, h, 'STATUS')) || 'Open',
    resolution: textOrNull(col(r, h, 'RESOLUTION')),
    logged_by: textOrNull(col(r, h, 'BY')),
    resolved_by: textOrNull(col(r, h, 'RESOLVED BY')),
    resolved_at: dateOrNull(col(r, h, 'RESOLVED AT')),
    created_at: dateOrNull(col(r, h, 'TIMESTAMP', 'DATE')) || new Date().toISOString(),
  })).filter(x => x.complainant);
}

export function importRestructures(csvRows) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    ref: textOrNull(col(r, h, ...REF_HEADERS)),
    team: normTeam(col(r, h, 'TEAM')),
    full_name: textOrNull(col(r, h, 'FULLNAME')),
    contact: normPhone(col(r, h, 'CONTACT#')),
    guarantor: textOrNull(col(r, h, 'GUARANTOR')),
    guarantor_contact: normPhone(col(r, h, 'G.CONTACT', 'GUARANTOR CONTACT')),
    arrears: num(col(r, h, 'ARREARS', 'ARREAS')),
    dc: num(col(r, h, 'DC')),
    first_inst: num(col(r, h, 'FIRST INST')),
    remaining: num(col(r, h, 'REMAINING')),
    interest_on: textOrNull(col(r, h, 'INTEREST ON')),
    interest_amt: num(col(r, h, 'INTEREST AMT')),
    total: num(col(r, h, 'TOTAL')),
    installments: num(col(r, h, 'INSTALLMENTS')),
    inst_amt: num(col(r, h, 'INST AMT')),
    start_date: dateOrNull(col(r, h, 'START DATE')),
    status: textOrNull(col(r, h, 'STATUS')) || 'Pending',
    requested_by: textOrNull(col(r, h, 'REQUESTED BY')),
    approved_by: textOrNull(col(r, h, 'APPROVED BY')),
    approved_at: dateOrNull(col(r, h, 'APPROVED AT')),
    reject_reason: textOrNull(col(r, h, 'REJECT REASON')),
    notes: textOrNull(col(r, h, 'NOTES')),
    created_at: dateOrNull(col(r, h, 'TIMESTAMP')) || new Date().toISOString(),
  })).filter(x => x.ref);
}

export function importDemandNotices(csvRows) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    ref: textOrNull(col(r, h, ...REF_HEADERS)),
    team: normTeam(col(r, h, 'TEAM')),
    full_name: textOrNull(col(r, h, 'FULLNAME')),
    contact: normPhone(col(r, h, 'CONTACT#')),
    notice_date: dateOrNull(col(r, h, 'NOTICE DATE')),
    notice_days: num(col(r, h, 'NOTICE DAYS')),
    paid_count: num(col(r, h, 'PAID COUNT')),
    fine: num(col(r, h, 'FINE')),
    principal_remaining: num(col(r, h, 'PRINCIPAL REMAINING')),
    total_demand: num(col(r, h, 'TOTAL DEMAND')),
    arrears_at_notice: num(col(r, h, 'ARREARS AT NOTICE')),
    other_inst: num(col(r, h, 'OTHER INST')),
    issued_by: textOrNull(col(r, h, 'BY')),
    created_at: dateOrNull(col(r, h, 'TIMESTAMP')) || new Date().toISOString(),
  })).filter(x => x.ref);
}

/** Call app registrations. LEADER is YES/NO text in the sheet and a boolean here; LEADER
    TEAMS is a comma list or ALL (ALL -> null, the same everything-scope convention as
    access codes). TEAM is nulled unless it is a real team -- it is a FOREIGN KEY. */
export function importCallUsers(csvRows, knownTeams) {
  const known = new Set((knownTeams || []).map(t => String(t).trim().toUpperCase()));
  return rowsToObjects(csvRows).map(({ raw: r, h }) => {
    const team = normTeam(col(r, h, 'TEAM'));
    const lt = String(col(r, h, 'LEADER TEAMS') || '').trim();
    return {
      user_id: textOrNull(col(r, h, 'USER ID')),
      name: textOrNull(col(r, h, 'NAME')),
      team: (team && (!known.size || known.has(String(team).toUpperCase()))) ? team : null,
      role: textOrNull(col(r, h, 'ROLE')),
      is_leader: String(col(r, h, 'LEADER') || '').trim().toUpperCase() === 'YES',
      leader_teams: (!lt || lt.toUpperCase() === 'ALL') ? null : lt.split(/[;,]/).map(s => s.trim()).filter(Boolean),
      device_id: textOrNull(col(r, h, 'DEVICE ID')),
      phone: normPhone(col(r, h, 'PHONE')),
      registered_at: dateOrNull(col(r, h, 'REGISTERED AT')) || new Date().toISOString(),
      last_sync: dateOrNull(col(r, h, 'LAST SYNC')),
      last_ts: num(col(r, h, 'LAST TS')) || null,
    };
  }).filter(x => x.user_id && x.phone);
}

/** Call history. PORTFOLIO is YES/NO text -> boolean; DIRECTION/OUTCOME/CATEGORY are CHECK
    constrained, so anything unrecognised becomes null rather than failing the whole insert. */
export function importCallLogs(csvRows) {
  const pick = (v, allowed) => {
    const k = String(v == null ? '' : v).trim().toUpperCase();
    return allowed.includes(k) ? k : null;
  };
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    id: textOrNull(col(r, h, 'LOG ID')),
    user_id: textOrNull(col(r, h, 'USER ID')),
    officer: textOrNull(col(r, h, 'OFFICER')),
    team: normTeam(col(r, h, 'TEAM')),
    phone: normPhone(col(r, h, 'PHONE')),
    direction: pick(col(r, h, 'DIRECTION'), ['IN', 'OUT']),
    call_date: dateOrNull(col(r, h, 'CALL DATE')),
    call_time: timeOrNull(col(r, h, 'CALL TIME')),
    duration: num(col(r, h, 'DURATION')),
    portfolio: String(col(r, h, 'PORTFOLIO') || '').trim().toUpperCase() === 'YES',
    match_type: textOrNull(col(r, h, 'MATCH')),
    ref: textOrNull(col(r, h, ...REF_HEADERS)),
    customer: textOrNull(col(r, h, 'CUSTOMER')),
    synced_at: dateOrNull(col(r, h, 'SYNCED AT')) || new Date().toISOString(),
    outcome: pick(col(r, h, 'OUTCOME'), ['CONNECTED', 'MISSED', 'REJECTED', 'BLOCKED']),
    category: pick(col(r, h, 'CATEGORY'), ['EXPECTED', 'DEFAULTER']),
  })).filter(x => x.id && x.call_date);
}

export function importSettings(csvRows) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    key: textOrNull(col(r, h, 'KEY')),
    value: textOrNull(col(r, h, 'VALUE')),
  })).filter(x => x.key);
}

export function importHints(csvRows) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    tab: textOrNull(col(r, h, 'TAB')),
    message: textOrNull(col(r, h, 'MESSAGE')),
    sw_message: textOrNull(col(r, h, 'SW-MESSAGE', 'SW MESSAGE')),
  })).filter(x => x.tab);
}

/* =====================================================================================
   SUMMARY UPLOADS -- a day's figures without the customers behind them.
   =====================================================================================
   "I need at uploading I choose to upload summary or customers ... if I upload summary the
    latest defaulters lists stay but the latest list/summary uploaded is the one used for
    reports"

   Both of these produce rows in the SHAPE THE TOTALS FUNCTIONS RETURN -- one per team, figures
   already added up -- so they need no merging rule of their own. They carry an upload_batch and
   a created_at like every other upload and go to the same batch rule that has always decided
   which upload wins.

   The sheets are the company's own, described exactly as they arrive: data from A1 of a sheet
   named Data, headers on row 1. Mapping is by HEADER NAME like every other importer here, so a
   column moving does not silently read the wrong one. */

/** THE EXPECTED SUMMARY.

      TEAMS | EXPECTED | PAID | ILIYONASIA | EXP TOMMR | UNCOLLECTED | %

    "Read expected as expected collection, sum of the next 3 collumns (paid+iliyonasia+exp
     tommr) as collected, uncollected and collection %"

    The percentage in the file is deliberately NOT stored. Every screen works a percentage out
    from the two amounts it is made of, so keeping a second copy would be a figure that could
    disagree with its own parts after a rounding -- and the one on screen has to be the one the
    totals produce. */
export function importExpectedSummary(csvRows, { snapshotType, snapshotDate }) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => {
    const expected = num(col(r, h, 'EXPECTED'));
    const paid = num(col(r, h, 'PAID'));
    const nasia = num(col(r, h, 'ILIYONASIA'));
    const tommr = num(col(r, h, 'EXP TOMMR', 'EXP TOMORROW', 'EXP TOMM'));
    const collected = paid + nasia + tommr;
    /* UNCOLLECTED is taken from the file when it is there, because that is the company's own
       figure and the sheet is the record. Where the column is blank -- and in these exports it
       often is, shown as a dash -- it is expected minus collected, clamped at zero exactly as
       the customer-level rule clamps it per row. Never negative: a team that overpaid has
       collected everything, not less than nothing. */
    const stated = col(r, h, 'UNCOLLECTED');
    const hasStated = String(stated == null ? '' : stated).replace(/[\s,-]/g, '') !== '';
    return {
      kind: 'expected',
      snapshot_type: snapshotType,
      snapshot_date: snapshotDate,
      weekday: null,
      team: normTeam(col(r, h, 'TEAMS', 'TEAM')),
      customers: null,                       // a summary is money, not a list of people
      expected_amt: expected,
      collected_amt: collected,
      uncollected_amt: hasStated ? num(stated) : Math.max(expected - collected, 0),
      arrears_amt: null,
    };
  }).filter(x => x.team);
}

/** THE DEFAULTER SUMMARY.

      team_id | team_name | amount_defaulted

    "Where if initial defaulters was uploaded by file 108781206 then current 108771206
     therefore recovered is 10,000."

    Which is the recovery rule this system already has -- initial minus current, paired on the
    same date, type and WEEKDAY -- so the weekday comes from the upload screen exactly as it
    does for a customer file. A summary that could not be paired on weekday would compare two
    different populations, which is the fault that once produced minus 194 million.

    team_id is read but not stored: the teams table is keyed on the NAME everywhere else in
    this system, and introducing a second key here would be a second way for a team to be
    identified and therefore a second way for one to go missing. */
export function importDefaulterSummary(csvRows, { snapshotType, snapshotDate, weekday }) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    kind: 'defaulter',
    snapshot_type: snapshotType,
    snapshot_date: snapshotDate,
    weekday,
    team: normTeam(col(r, h, 'team_name', 'TEAM_NAME', 'TEAM', 'TEAMS')),
    customers: null,
    expected_amt: null,
    collected_amt: null,
    uncollected_amt: null,
    arrears_amt: num(col(r, h, 'amount_defaulted', 'AMOUNT_DEFAULTED', 'AMOUNT DEFAULTED', 'ARREARS', 'ARREAS')),
  })).filter(x => x.team);
}
