import { buildHeaderMap, col, num, dateOrNull, dsText, normPhone, textOrNull, normTeam } from './parse.js';

// Every importer takes the raw parsed CSV rows (array of arrays, row 0 = headers) and
// returns an array of objects ready to insert. Mapping is by HEADER NAME, not column
// position -- the one thing the old system's mapRows_ always got right, kept here.

function rowsToObjects(csvRows) {
  const headerMap = buildHeaderMap(csvRows[0]);
  return csvRows.slice(1)
    .filter(r => r.some(v => String(v || '').trim() !== ''))   // drop fully-blank rows
    .map(r => ({ raw: r, h: headerMap }));
}

export function importDefaulters(csvRows, { snapshotType, weekday, snapshotDate }) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    ref: textOrNull(col(r, h, 'REF#', 'REF')),
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
    ref: textOrNull(col(r, h, 'REF', 'REF#')),
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

export function importComments(csvRows) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    ref: textOrNull(col(r, h, 'REF#')),
    docket_no: textOrNull(col(r, h, 'DOCKET#')),
    team: normTeam(col(r, h, 'TEAM')),
    full_name: textOrNull(col(r, h, 'FULLNAME')),
    comment: textOrNull(col(r, h, 'COMMENT')),
    fu_status: textOrNull(col(r, h, 'FU STATUS')),
    promise_date: dateOrNull(col(r, h, 'PROMISE DATE')),
    promise_amt: num(col(r, h, 'PROMISE AMT')),
    new_number: normPhone(col(r, h, 'NEW NUMBER')),
    created_by: textOrNull(col(r, h, 'BY')),
    created_at: dateOrNull(col(r, h, 'TIMESTAMP')) || new Date().toISOString(),
  })).filter(x => x.ref);
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
  disb_status: ['DISB STATUS'],
  disb_date: ['DISB DATE'],
  approved_date: ['APPROVED DATE'],
  approved_by: ['APPROVED BY'],
  disbursed_by: ['DISBURSED BY'],
  created_by: ['CREATED BY'],
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
export function importLoans(csvRows, stage) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => {
    const obj = { stage };
    for (const [field, candidates] of Object.entries(LOAN_STAGE_COLUMNS)) {
      const v = col(r, h, ...candidates);
      obj[field] = field === 'team' ? normTeam(v) : NUMERIC_LOAN_FIELDS.has(field) ? num(v) : DATE_LOAN_FIELDS.has(field) ? dateOrNull(v) : textOrNull(v);
    }
    return obj;
  }).filter(x => x.full_name);
}

export function importTeams(csvRows) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    team: normTeam(col(r, h, 'TEAM')),
    opm: textOrNull(col(r, h, 'OPM')),
    recovery: textOrNull(col(r, h, 'RECOVERY')),
    gmo: textOrNull(col(r, h, 'GMO')),
    manager: textOrNull(col(r, h, 'MANAGER')),
    credit: textOrNull(col(r, h, 'CREDIT')),
    expected: textOrNull(col(r, h, 'EXPECTED')),
    bike: textOrNull(col(r, h, 'BIKE')),
  })).filter(x => x.team);
}

export function importReceivedPayments(csvRows) {
  return rowsToObjects(csvRows).map(({ raw: r, h }) => ({
    paid_at: dateOrNull(col(r, h, 'DATE')),
    team: normTeam(col(r, h, 'TEAM')),
    customer_name: textOrNull(col(r, h, 'CUSTOMER NAME')),
    customer_no: normPhone(col(r, h, 'CUSTOMER NO')),
    transaction_id: textOrNull(col(r, h, 'TRANSACTION ID')),
    ref_no: textOrNull(col(r, h, 'REF NO')),
    amount_paid: num(col(r, h, 'AMOUNT PAID')),
    payment_no: textOrNull(col(r, h, 'PAYMENT NO')),
    sender_name: textOrNull(col(r, h, 'SENDER NAME')),
  }));
}
