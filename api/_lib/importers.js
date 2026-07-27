import { buildHeaderMap, col, num, dateOrNull, timeOrNull, dsText, normPhone, textOrNull, normTeam } from './parse.js';

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
  // The CALL AGENT who took the application. It was in the schema but never imported, so the
  // dashboard's call-agent board had nothing to group by and fell back to the calls app.
  created_by: ['CREATED BY', 'CREATEDBY', 'AGENT', 'AGENT ID'],
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
    contact_no: normPhone(col(r, h, 'CONTACT NO')),
    phone_number: normPhone(col(r, h, 'PHONE NUMBER')),
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
    ref: textOrNull(col(r, h, 'REF#', 'REF')),
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
    ref: textOrNull(col(r, h, 'REF#', 'REF')),
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
    ref: textOrNull(col(r, h, 'REF#', 'REF')),
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
    ref: textOrNull(col(r, h, 'REF#', 'REF')),
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
