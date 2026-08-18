import { fetchAll, runQuery } from './supabase.js';
import { normPhone, textOrNull, normTeam } from './parse.js';
import { todayKey } from './time.js';

/* =====================================================================================
   HOPE LOAN -- ORIGINATION, END TO END.
   =====================================================================================

   Everything downstream of a phone call: a customer registers, a manager assigns them to a
   team, the team visits and assesses, a senior officer reviews the large ones, credit
   approves, a manager disburses inside finance's window, and finance actually sends the
   money -- which is the one stage this whole build exists to add, because today "disbursed"
   and "paid" are the same word and unfunded loans quietly become defaulters:

     "the unfunded always live in the expected and actually they start defaulting ... the
      disb action takes them into expected"

   THIS FILE RUNS AGAINST ITS OWN SCHEMA, and nothing in it ever reaches HOPE PMO's officer-
   facing tables. See api/_lib/workspace.js for how the database it is handed is chosen; this
   file does not know or care which mode is behind `db` -- it is the same code either way,
   which is the whole point of the split being at the door and not in here.

   THE BOUNDARY THAT IS DELIBERATELY NOT CROSSED YET. A funded loan is, conceptually, ready to
   enter HOPE PMO's `expected` book and start being chased by officers -- but the promotion
   pipe from here into `followup_status` / `defaulter_snapshots` is NOT built, on purpose:
   that is the actual crossing from sandbox into the live book, and it happens "the day we
   discuss merges", not before. Every stage up to and including funding runs fully and is
   fully tested here; what happens after funding is the one open door, left open on purpose.

   NAVIGATION, NOT ROLE NAMES. Per instruction: "who does what is by allowing user access to
   sidebar navigations already simple, not by role name." So loanApi does not ask "is this
   person a Manager" -- it exposes one function per SCREEN, and which screens a signed-in code
   can reach is the tab list on their role, exactly the mechanism HOPE PMO already uses for
   upload/settings/audit. A team leader who also holds the "finance" tab sees Finance; nothing
   here hard-codes who that must be. */

const K = s => String(s == null ? '' : s).trim().toUpperCase();
function badRequest(m) { const e = new Error(m); e.status = 400; return e; }
function forbidden(m) { const e = new Error(m); e.status = 403; return e; }

async function all(db, table, build) {
  const { data, error } = await runQuery(() => (build ? build(db.from(table)) : db.from(table).select('*')));
  if (error) throw new Error(error.message);
  return data || [];
}
async function allPaged(db, table, build) {
  return fetchAll(() => (build ? build(db.from(table)) : db.from(table).select('*')));
}

/** A tab gate, the same shape as HOPE PMO's: a screen is reachable only if its name is on the
    signed-in code's tab list -- built for the day several different codes hold different HOPE
    Loan tabs (a manager sees Assignment, a credit analyst sees Approval) exactly the way HOPE
    PMO tabs already work, so nothing here needs rewriting when that day comes.

    TODAY, only the ADMIN role ever reaches this file at all -- _lib/workspace.js refuses the
    HOPE Loan workspace to anyone else before loanApi is even called, per instruction ("Switch
    is visible to ADMIN role only"), and the owner is deliberately the one person walking every
    screen end to end for now ("i'll go test after switching ... from the start to the end").
    So the ADMIN role is let through here on the role string, same check workspace.js already
    makes -- not on a tab named "admin", which does not exist; HOPE PMO's own ADMIN_TABS is
    upload/settings/audit, never the word "admin" itself. */
function requireTab(user, tab) {
  if (String((user && user.role) || '').trim().toUpperCase() === 'ADMIN') return;
  const tabs = (user && user.tabs) || [];
  if (!tabs.includes(tab)) {
    throw forbidden('Hujaruhusiwa kufungua hii. / You do not have the "' + tab + '" tab for HOPE Loan.');
  }
}

/* =====================================================================================
   THE REFERENCE NUMBER.
   =====================================================================================
   Verified against the live book: docket digits + track digit(s) = the reference number, on
   every one of 2,921 loans, no two customers ever sharing a docket. A sandbox reference must
   never be mistakable for a real one, so it is minted under a leading digit the live book has
   never used -- confirmed across the whole book, which only ever starts 2 through 7. */
/* Four digits, always starting 9 -- the live book, checked across its whole 2,921-loan export,
   only ever starts a reference with 2 through 7. A sandbox docket is therefore identifiable on
   sight and removable with one query if a row ever escaped, the same rule the settings row
   SANDBOX_REF_PREFIX in RUN-ME-001-origination.sql documents for the database side. */
const SANDBOX_PREFIX = '9190';

function padSerial(n, len) { return String(n).padStart(len, '0'); }

/** stem = the 4-digit sandbox prefix + a 6-digit running serial, 10 digits total -- the same
    length as a live customer whose serial has crossed 99,999. A docket is that stem written
    1-3-6; a reference is the docket's digits with the track appended. */
export function mintDocket(serial) {
  const stem = SANDBOX_PREFIX + padSerial(serial, 6);          // e.g. 9190000042
  return stem.slice(0, 1) + '-' + stem.slice(1, 4) + '-' + stem.slice(4);
}
export function refFor(docket, track) {
  const digits = docket.replace(/-/g, '');
  return digits + String(track);
}
/** The inverse, for the ONE report that carries a reference with no docket column at all --
    the expected report; every other report (defaulters, approved) carries DOCKET# outright
    and should be read from that column directly, never decoded.

    ONLY TRACKS 1-10 ARE UNAMBIGUOUS FROM THE BARE REFERENCE, and this is a known, open gap,
    not an oversight: "ending 0 is track 10" was confirmed, but a ref ending in 1-9 could be
    track 1-9 OR the low digit of track 11-19 -- nothing in the digits themselves says which,
    and that was left explicitly unresolved rather than guessed at. Never call this assuming
    it is exact past single digits; where the docket is known, use it instead of this. */
export function docketFromRef(ref) {
  const s = String(ref || '');
  const track = s.slice(-1) === '0' ? s.slice(-2) : s.slice(-1);
  const digits = s.slice(0, s.length - track.length);
  return { docket: digits.slice(0, 1) + '-' + digits.slice(1, 4) + '-' + digits.slice(4), track: Number(track) };
}

async function nextSerial(db) {
  // Small table, small scan -- the customer count is the counter. Fine at demo scale; a
  // dedicated sequence is the obvious upgrade once real volume makes this worth avoiding.
  const rows = await allPaged(db, 'customers', q => q.select('id'));
  return rows.length + 1;
}

/* =====================================================================================
   1. CUSTOMER SERVICE -- search first, register second.
   ===================================================================================== */

/** "search first" -- a returning customer must be found by name or phone before a new docket
    is minted, or the same person becomes two people. */
async function csSearch(db, user, { q }) {
  requireTab(user, 'customer_service');
  const query = K(q);
  if (!query) return { rows: [] };
  const rows = await allPaged(db, 'customers', b => b.select('id, docket, full_name, mobile, team, branch'));
  const hits = rows.filter(c => K(c.full_name).includes(query) || String(c.mobile || '').includes(query.replace(/\D/g, '')));
  return { rows: hits.slice(0, 25) };
}

/** A new application. Registers the customer (or reuses one found by csSearch) and opens a
    loan at 'unassigned' with the requested amount -- the first rung of the amount ladder. */
async function csRegister(db, user, p) {
  requireTab(user, 'customer_service');
  const name = textOrNull(p.full_name);
  if (!name) throw badRequest('Full name is required.');
  const mobile = normPhone(p.mobile);
  let customerId = p.customer_id || null;
  let docket = p.docket || null;

  if (!customerId) {
    const serial = await nextSerial(db);
    docket = mintDocket(serial);
    const { data, error } = await db.from('customers').insert({
      docket, full_name: name, mobile, region: textOrNull(p.region), district: textOrNull(p.district),
      nearest_landmark: textOrNull(p.landmark), team: normTeam(p.team), branch: textOrNull(p.branch),
      created_by: user.name, updated_by: user.name,
    }).select('id, docket').maybeSingle();
    if (error) throw new Error(error.message);
    customerId = data.id; docket = data.docket;
  } else if (!docket) {
    /* A RETURNING CUSTOMER, IDENTIFIED BY ID, NOT BY A DOCKET TYPED IN AGAIN. The docket is
       the one thing that must never be re-entered -- retyping it is exactly how a returning
       customer becomes a second person -- so when csSearch has already found them, only their
       id travels here and their real docket is read back from the record that already exists. */
    const rows = await allPaged(db, 'customers', b => b.select('docket').eq('id', customerId));
    if (!rows[0]) throw badRequest('That customer could not be found.');
    docket = rows[0].docket;
  }

  const track = await nextTrackFor(db, customerId);
  const ref = refFor(docket, track);
  const { data: loan, error: lerr } = await db.from('loans').insert({
    docket_no: docket, docket_ref: docket, track_no: String(track), loan_id: ref,
    full_name: name, contact: mobile, region: textOrNull(p.region), branch: textOrNull(p.branch),
    team: normTeam(p.team), zone: textOrNull(p.zone), location: textOrNull(p.location),
    nearest_landmark: textOrNull(p.landmark), product: 'Business Loan',
    disbursement_type: textOrNull(p.disbursement_mode),
    requested_amt: Number(p.amount) || 0,
    stage: 'unassigned', customer_id: customerId, created_by: user.name,
  }).select('*').maybeSingle();
  if (lerr) throw new Error(lerr.message);
  await logEvent(db, loan.id, null, 'unassigned', user, Number(p.amount) || 0, 'Registered by customer service');
  return { loan, docket, ref };
}

async function nextTrackFor(db, customerId) {
  const rows = await allPaged(db, 'loans', b => b.select('track_no').eq('customer_id', customerId));
  const max = rows.reduce((m, r) => Math.max(m, Number(r.track_no) || 0), 0);
  return max + 1;
}

/** Complaint register, per the customer-service description: type, details, assign onward. */
async function csComplaint(db, user, p) {
  requireTab(user, 'customer_service');
  const { data, error } = await db.from('complaints').insert({
    ref: textOrNull(p.ref), team: normTeam(p.team), category: textOrNull(p.type),
    details: textOrNull(p.details), status: 'Open', logged_by: user.name,
  }).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return { row: data };
}

/* =====================================================================================
   2. MANAGER -- assignment. First loan only; from track 2 the team is already known.
   ===================================================================================== */

async function managerQueue(db, user) {
  requireTab(user, 'manager');
  const rows = await allPaged(db, 'loans', b => b.select('*').eq('stage', 'unassigned').order('created_at'));
  return { rows: rows.filter(r => !r.team || Number(r.track_no) === 1 || !r.assigned_at) };
}

/** Assign, or SHIFT between the manager's own teams before assigning -- same action, the team
    argument decides which. */
async function managerAssign(db, user, { loan_id, team }) {
  requireTab(user, 'manager');
  const t = normTeam(team);
  if (!t) throw badRequest('A team is required.');
  const loan = await mustLoan(db, loan_id);
  await transition(db, loan, 'unassigned', 'assigned', user, {
    team: t, assigned_by: user.name, assigned_at: new Date().toISOString(),
  }, 'Assigned to ' + t);
  return { ok: true };
}

async function managerReject(db, user, { loan_id, reason }) {
  requireTab(user, 'manager');
  if (!textOrNull(reason)) throw badRequest('A reason is required for every rejection.');
  const loan = await mustLoan(db, loan_id);
  await transition(db, loan, loan.stage, 'rejected', user, { reject_reason: reason, rejected_by: user.name, rejected_at: new Date().toISOString() }, reason);
  return { ok: true };
}

/* =====================================================================================
   3. TEAM -- the assessment visit, five sections, saved as it goes.
   =====================================================================================
   "Add save option for the loan assessment stages to allow segments review per time without
    losing primary captured data before submitting the recommendation." Each section is its
    own patch; nothing requires the other four to be filled to save one. */

async function teamQueue(db, user) {
  requireTab(user, 'team');
  const team = user.teams && user.teams.length === 1 ? user.teams[0] : null;
  let b = db.from('loans').select('*').in('stage', ['assigned', 'unassessed', 'assessed']);
  if (team) b = b.eq('team', team);
  return { rows: await allPaged(db, 'loans', () => b) };
}

async function assessmentFor(db, loanId) {
  const rows = await allPaged(db, 'assessments', b => b.select('*').eq('loan_id', loanId).order('created_at', { ascending: false }));
  return rows[0] || null;
}

/** One call for all five sections -- pass whichever `section` you're saving and its fields.
    Personal-detail writes ALSO update the permanent customer record (write-once fields are
    simply not offered by the screen past track 1 -- see FIELD_LOCK_ below); everything else
    stays local to this assessment draft until SUBMIT. */
const SECTIONS = new Set(['personal', 'recommendation', 'guarantor', 'residence', 'business']);
async function teamAssessmentSave(db, user, { loan_id, section, fields }) {
  requireTab(user, 'team');
  if (!SECTIONS.has(section)) throw badRequest('Unknown assessment section: ' + section);
  const loan = await mustLoan(db, loan_id);
  let a = await assessmentFor(db, loan_id);
  const patch = { ['done_' + section]: true, updated_at: new Date().toISOString(), submitted_by: user.name };

  if (section === 'personal') {
    // Track 2+: permanent fields are locked, per instruction -- silently dropped rather than
    // erroring, so a screen that still shows them (a stale cache) cannot corrupt identity.
    const locked = Number(loan.track_no) > 1;
    const customerPatch = {};
    for (const [k, v] of Object.entries(fields || {})) {
      if (locked && FIELD_LOCK_.has(k)) continue;
      customerPatch[k] = v;
    }
    if (Object.keys(customerPatch).length && loan.customer_id) {
      customerPatch.updated_by = user.name; customerPatch.updated_at = new Date().toISOString();
      const { error } = await db.from('customers').update(customerPatch).eq('id', loan.customer_id);
      if (error) throw new Error(error.message);
    }
  }
  if (section === 'recommendation') {
    patch.recommend_amount = Number((fields || {}).amount) || null;
    patch.zone_visited = textOrNull((fields || {}).zone);
    patch.remarks = textOrNull((fields || {}).remarks);
  }
  if (section === 'guarantor') {
    await saveGuarantors(db, loan, user, (fields || {}).guarantors || []);
  }
  if (section === 'residence') {
    patch.residence_verified = !!(fields || {}).verified;
    patch.guarantor_residence_verified = !!(fields || {}).guarantor_verified;
  }
  if (section === 'business') {
    patch.business_verified = !!(fields || {}).verified;
    if (loan.customer_id) {
      const bizPatch = { updated_by: user.name, updated_at: new Date().toISOString() };
      for (const k of ['business_type', 'business_name', 'daily_sales', 'daily_profit', 'weekly_expenses']) {
        if ((fields || {})[k] !== undefined) bizPatch[k] = (fields || {})[k];
      }
      if ((fields || {}).daily_profit != null) bizPatch.weekly_profit = Number((fields || {}).daily_profit) * 6;
      const { error } = await db.from('customers').update(bizPatch).eq('id', loan.customer_id);
      if (error) throw new Error(error.message);
    }
  }

  if (a) {
    const { data, error } = await db.from('assessments').update(patch).eq('id', a.id).select('*').maybeSingle();
    if (error) throw new Error(error.message);
    a = data;
  } else {
    const { data, error } = await db.from('assessments').insert({
      loan_id: loan.id, customer_id: loan.customer_id, team: loan.team, officer: user.name,
      visited_at: new Date().toISOString(), ...patch,
    }).select('*').maybeSingle();
    if (error) throw new Error(error.message);
    a = data;
  }
  if (loan.stage === 'assigned') await transition(db, loan, 'assigned', 'unassessed', user, {}, 'Assessment started');
  return { assessment: a };
}

/** Fields the bureau matches identity on -- write-once past the first loan, per instruction:
    "team recomendation of track two has review info but some info that seems perminent
     shouldnt be editable". Everything else (phone, residence, business, income, guarantor)
     stays revisable every track. */
const FIELD_LOCK_ = new Set([
  'first_name', 'middle_names', 'present_surname', 'birth_surname', 'gender', 'dob',
  'country_of_birth', 'national_id', 'tin',
]);

async function saveGuarantors(db, loan, user, list) {
  const rows = (list || []).slice(0, 6).map((g, i) => ({
    loan_id: loan.id, customer_id: loan.customer_id, rank: i,
    full_name: textOrNull(g.full_name), phone: normPhone(g.phone), relationship: textOrNull(g.relationship),
    occupation: textOrNull(g.occupation), national_id: textOrNull(g.national_id),
    district: textOrNull(g.district), ward: textOrNull(g.ward), created_by: user.name,
  })).filter(r => r.full_name);
  if (!rows.length) return;
  // Replace this loan's guarantor set whole -- a short list edited in the field is simpler to
  // resend complete than to diff, and it is at most six rows.
  await db.from('guarantors').delete().eq('loan_id', loan.id);
  const { error } = await db.from('guarantors').insert(rows);
  if (error) throw new Error(error.message);
}

async function teamSubmit(db, user, { loan_id, decision, reason }) {
  requireTab(user, 'team');
  const loan = await mustLoan(db, loan_id);
  const a = await assessmentFor(db, loan_id);
  if (!a) throw badRequest('No assessment has been started for this loan.');
  if (decision === 'REJECTED') {
    if (!textOrNull(reason)) throw badRequest('A reason is required for every rejection.');
    await db.from('assessments').update({ decision, reject_reason: reason, submitted_at: new Date().toISOString() }).eq('id', a.id);
    await transition(db, loan, loan.stage, 'rejected', user, { reject_reason: reason }, reason);
    return { ok: true };
  }
  const amount = Number(a.recommend_amount) || 0;
  if (!amount) throw badRequest('A recommended amount is required to submit.');
  await db.from('assessments').update({ decision: 'ACCEPTED', submitted_at: new Date().toISOString() }).eq('id', a.id);
  const nextStage = amount >= GMO_THRESHOLD ? 'pending_approval' : 'pending_approval';
  await transition(db, loan, loan.stage, nextStage, user, { team_recomm: amount }, 'Recommended ' + amount);
  return { ok: true };
}

/* =====================================================================================
   4. SENIOR REVIEW -- the tier the wireframes never drew.
   =====================================================================================
   GMO MUST add a recommendation at 3M+; OPM MAY at 6M+. Both happen before credit sees it,
   and neither BLOCKS the stage machine on their own -- they attach a record to the loan,
   which credit's screen shows alongside everything else, exactly as described: "add
   recommendation of their own assessment based on the recommended loan application before
   the application proceeds to the Credit Analyst." */
export const GMO_THRESHOLD = 3_000_000;
export const OPM_THRESHOLD = 6_000_000;

async function seniorQueue(db, user, { tier }) {
  requireTab(user, tier === 'opm' ? 'opm' : 'gmo');
  const min = tier === 'opm' ? OPM_THRESHOLD : GMO_THRESHOLD;
  /* Filtered in JS rather than with `.gte()`: PostgREST/Postgres compares this NUMERICALLY,
     which is what a threshold needs, but a couple of the amounts here span different digit
     counts (500,000 vs 3,000,000) and any fake or intermediary that compared the column as a
     STRING would put 500,000 above the threshold ("500000" > "3000000" char by char). Rather
     than depend on the query layer getting that right, the comparison is done here in the one
     place it is unambiguous. The table this reads is small; this is not a cost worth the risk. */
  const rows = await allPaged(db, 'loans', b => b.select('*').eq('stage', 'pending_approval'));
  const eligible = rows.filter(r => (Number(r.team_recomm) || 0) >= min);
  if (tier === 'gmo') return { rows: eligible.filter(r => !r.gmo_at) };
  return { rows: eligible.filter(r => !r.opm_at) };
}

async function seniorRecommend(db, user, { loan_id, tier, amount, remarks }) {
  requireTab(user, tier === 'opm' ? 'opm' : 'gmo');
  const loan = await mustLoan(db, loan_id);
  const patch = tier === 'opm'
    ? { opm_recommend: Number(amount) || null, opm_remarks: textOrNull(remarks), opm_by: user.name, opm_at: new Date().toISOString() }
    : { gmo_recommend: Number(amount) || null, gmo_remarks: textOrNull(remarks), gmo_by: user.name, gmo_at: new Date().toISOString() };
  const { error } = await db.from('loans').update(patch).eq('id', loan.id);
  if (error) throw new Error(error.message);
  await logEvent(db, loan.id, loan.stage, loan.stage, user, Number(amount) || 0, (tier === 'opm' ? 'OPM' : 'GMO') + ' recommendation');
  return { ok: true };
}

/* =====================================================================================
   5. CREDIT ANALYST -- approval.
   ===================================================================================== */

async function creditQueue(db, user) {
  requireTab(user, 'credit');
  const rows = await allPaged(db, 'loans', b => b.select('*').eq('stage', 'pending_approval').order('team_recomm', { ascending: false }));
  // Blocked until the mandatory senior review has happened, for anything above its threshold.
  return { rows: rows.filter(r => (Number(r.team_recomm) || 0) < GMO_THRESHOLD || r.gmo_at) };
}

async function creditApprove(db, user, p) {
  requireTab(user, 'credit');
  const loan = await mustLoan(db, p.loan_id);
  const granted = Number(p.granted_amount) || 0;
  if (!granted) throw badRequest('A granted amount is required.');
  const previousBalance = Number(p.previous_balance) || 0;
  const disbursing = Math.max(0, granted - previousBalance);
  const interest = Math.round(granted * INTEREST_FLAT_RATE);
  const total = granted + interest;
  const installment = Math.round(total / INSTALLMENTS);
  await transition(db, loan, 'pending_approval', 'approved', user, {
    principal_amt: granted, previous_balance: previousBalance, net_disbursed: disbursing,
    interest_amt: interest, loan_amt: total, installment_amt: installment,
    installments: INSTALLMENTS, disbursement_type: textOrNull(p.disbursement_mode) || loan.disbursement_type,
    approved_by: user.name, approved_date: todayKey(Date.now()), bank_name: textOrNull(p.bank_name),
    account_no: textOrNull(p.account_no),
  }, 'Granted ' + granted);
  return { ok: true, interest, total, installment };
}

async function creditReject(db, user, { loan_id, reason }) {
  requireTab(user, 'credit');
  if (!textOrNull(reason)) throw badRequest('A reason is required for every rejection.');
  const loan = await mustLoan(db, loan_id);
  await transition(db, loan, loan.stage, 'rejected', user, { reject_reason: reason }, reason);
  return { ok: true };
}

/* =====================================================================================
   6. THE SCHEDULE -- 36% flat over 12 weekly installments, 6 days' grace.
   =====================================================================================
   "we, HOPE MICROFINANCE CO LTD, provide loans ... with interest of 36% to be repaid in 12
    installments weekly schedule in complete 3 months." Flat interest on the granted amount,
    not amortised -- 300,000 -> 108,000 -> 408,000 -> 34,000 x 12, verified against the order
    document's own worked example. */
export const INTEREST_FLAT_RATE = 0.36;
export const INSTALLMENTS = 12;
export const GRACE_DAYS = 6;

function addDays(dateKey, n) {
  const d = new Date(dateKey + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* =====================================================================================
   7. MANAGER -- disbursement, only while finance's window is open.
   ===================================================================================== */

async function disburseWindowStatus(db) {
  const rows = await allPaged(db, 'disbursement_windows', b => b.select('*').order('opened_at', { ascending: false }).limit(1));
  const w = rows[0];
  return { open: !!(w && !w.closed_at), window: w || null };
}

async function financeOpenWindow(db, user) {
  requireTab(user, 'finance');
  const { open } = await disburseWindowStatus(db);
  if (open) throw badRequest('The disbursement window is already open.');
  const { data, error } = await db.from('disbursement_windows').insert({ opened_by: user.name }).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return { window: data };
}

async function financeCloseWindow(db, user) {
  requireTab(user, 'finance');
  const { open, window: w } = await disburseWindowStatus(db);
  if (!open) throw badRequest('The disbursement window is not open.');
  const { error } = await db.from('disbursement_windows').update({ closed_by: user.name, closed_at: new Date().toISOString() }).eq('id', w.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function disburseQueue(db, user) {
  requireTab(user, 'manager');
  const rows = await allPaged(db, 'loans', b => b.select('*').eq('stage', 'approved').order('approved_date'));
  return { rows };
}

async function managerDisburse(db, user, { loan_id }) {
  requireTab(user, 'manager');
  const { open } = await disburseWindowStatus(db);
  if (!open) throw forbidden('The disbursement window is closed. Ask finance to open it.');
  const loan = await mustLoan(db, loan_id);
  const first = addDays(todayKey(Date.now()), GRACE_DAYS);
  const last = addDays(first, (INSTALLMENTS - 1) * 7);
  /* AUTHORISATION, NOT PAYMENT. This is the line that used to also mean "money sent" -- it no
     longer does. Nothing about `expected` happens here; only `financeMarkFunded` starts that. */
  await transition(db, loan, 'approved', 'disbursed', user, {
    disb_date: todayKey(Date.now()), disbursed_by: user.name,
    first_schedule: first, last_schedule: last,
  }, 'Authorised by manager -- awaiting funding');
  return { ok: true };
}

async function managerDisburseReject(db, user, { loan_id, reason }) {
  requireTab(user, 'manager');
  if (!textOrNull(reason)) throw badRequest('A reason is required for every rejection.');
  const loan = await mustLoan(db, loan_id);
  await transition(db, loan, loan.stage, 'rejected', user, { reject_reason: reason }, reason);
  return { ok: true };
}

/** "manager can return granted customers to CA" -- the one backward move the wireframes drew. */
async function managerReturnToCredit(db, user, { loan_id, reason }) {
  requireTab(user, 'manager');
  const loan = await mustLoan(db, loan_id);
  await transition(db, loan, 'approved', 'pending_approval', user, {}, reason || 'Returned to credit for review');
  return { ok: true };
}

/* =====================================================================================
   8. FINANCE -- the bank report, funding, payment imports, shifting, and the window.
   =====================================================================================
   "finance manager has isp aceess for unlanded payments that he uses those excel columns to
    import payments into customer loans" -- financeImportPayments IS that channel, formalised;
    the day a live feed exists it lands in the same table with source='feed' and nothing
    downstream changes. */

async function financeBankReport(db, user) {
  requireTab(user, 'finance');
  const rows = await allPaged(db, 'loans', b => b.select('*').eq('stage', 'disbursed'));
  return {
    rows: rows.map(r => ({
      loan_id: r.id, docket: r.docket_no, full_name: r.full_name, contact: r.contact,
      carrier: r.disbursement_type, bank_name: r.bank_name, account_no: r.account_no,
      amount: r.net_disbursed,
    })),
  };
}

async function financeMarkFunded(db, user, { loan_ids, batch }) {
  requireTab(user, 'finance');
  const ids = Array.isArray(loan_ids) ? loan_ids : [loan_ids];
  const batchName = textOrNull(batch) || ('FUND-' + todayKey(Date.now()));
  let n = 0;
  for (const id of ids) {
    const loan = await mustLoan(db, id);
    if (loan.stage !== 'disbursed') continue;
    /* THE STAGE THAT DOES NOT EXIST TODAY. Funding is the only thing that starts the schedule
       and puts a loan into the book that expected/defaulters logic will one day read. */
    await transition(db, loan, 'disbursed', 'funded', user, {
      funded_at: new Date().toISOString(), funded_by: user.name, funding_batch: batchName,
    }, 'Funded via ' + batchName);
    n++;
  }
  return { funded: n, batch: batchName };
}

async function financeImportPayments(db, user, { rows, batch }) {
  requireTab(user, 'finance');
  const batchName = textOrNull(batch) || ('PAY-' + todayKey(Date.now()));
  const clean = (rows || []).map(r => ({
    batch: batchName, ref: textOrNull(r.ref), docket: textOrNull(r.docket), full_name: textOrNull(r.full_name),
    team: normTeam(r.team), amount: Number(r.amount) || 0, paid_at: r.paid_at || null,
    trans_no: textOrNull(r.trans_no), paid_by: textOrNull(r.paid_by), source: 'manual', imported_by: user.name,
  })).filter(r => r.ref && r.amount);
  if (!clean.length) throw badRequest('No usable rows -- each needs at least a reference and an amount.');
  const { error } = await db.from('payment_imports').insert(clean);
  if (error) throw new Error(error.message);
  return { imported: clean.length, batch: batchName };
}

/** "yes teams that get transactions removed from them may find themselves having negative
    recovery if tranfering a trans creates a defaulter" -- accepted consequence, per
    instruction; the original row is marked and kept, never deleted. */
async function financeShiftPayment(db, user, { payment_id, to_ref, reason }) {
  requireTab(user, 'finance');
  if (!textOrNull(reason)) throw badRequest('A reason is required to shift a payment.');
  const rows = await allPaged(db, 'payment_imports', b => b.select('*').eq('id', payment_id));
  const p = rows[0];
  if (!p) throw badRequest('That payment could not be found.');
  const { error } = await db.from('payment_imports').update({
    shifted_from_ref: p.ref, ref: textOrNull(to_ref), shifted_by: user.name,
    shifted_at: new Date().toISOString(), shift_reason: reason,
  }).eq('id', p.id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/* =====================================================================================
   9. REVERSAL -- three desks, because the money never moved.
   ===================================================================================== */

/** THE LIST THE THREE DESKS ACTUALLY WORK FROM, and it was missing: the chain could be
    requested and decided by name, but nothing could SHOW a pending reversal, so finance and
    the GM had no way to find one waiting for them. A queue nobody can see is a queue nobody
    works.

    Returns both halves of the screen in ONE round trip rather than two -- the reversals
    themselves, and the authorised-but-unfunded loans that are eligible to become one. Those
    are the same loans the bank report lists, which is the point: every row on that report is
    money that has not moved yet, so every row on it is reversible until it does. */
async function reversalsList(db, user) {
  const rows = await allPaged(db, 'reversals', b => b.select('*').order('requested_at', { ascending: false }));
  const loans = await allPaged(db, 'loans', b => b.select('*').eq('stage', 'disbursed'));
  const openIds = new Set(rows.filter(r => r.status === 'Pending').map(r => String(r.loan_id)));
  return {
    rows,
    pending: rows.filter(r => r.status === 'Pending'),
    /* A loan already carrying an open request is not offered again -- two live reversals for
       one loan is two people about to close the same contract. */
    eligible: loans.filter(l => !openIds.has(String(l.id))).map(l => ({
      loan_id: l.id, ref: l.loan_id, docket: l.docket_no, full_name: l.full_name,
      team: l.team, amount: l.net_disbursed,
    })),
  };
}

async function reversalRequest(db, user, { loan_id, amount, reason }) {
  requireTab(user, 'credit');
  if (!textOrNull(reason)) throw badRequest('A reason is required to request a reversal.');
  const loan = await mustLoan(db, loan_id);
  if (loan.stage !== 'disbursed') throw badRequest('Only an authorised-but-unfunded loan can be reversed.');
  /* THE THREE STATUSES ARE WRITTEN OUT, not left to the column defaults. The table does
     default them to 'Pending', but a value that only exists because of a default is a value
     this code cannot see in the row it just inserted -- and the reversal queue filters on
     exactly these three. Saying them here means the returned row is complete on the way back,
     and means the chain's starting state is readable in the code rather than in the schema. */
  const { data, error } = await db.from('reversals').insert({
    loan_id: loan.id, ref: loan.loan_id, docket: loan.docket_no, full_name: loan.full_name,
    team: loan.team, amount: Number(amount) || loan.net_disbursed, reason, requested_by: user.name,
    requested_at: new Date().toISOString(),
    status: 'Pending', finance_status: 'Pending', gm_status: 'Pending',
  }).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return { row: data };
}

async function reversalFinanceDecide(db, user, { id, approve, note }) {
  requireTab(user, 'finance');
  const { error } = await db.from('reversals').update({
    finance_status: approve ? 'Approved' : 'Rejected', finance_by: user.name,
    finance_at: new Date().toISOString(), finance_note: textOrNull(note),
    status: approve ? 'Pending' : 'Rejected',
  }).eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function reversalGmDecide(db, user, { id, approve, note }) {
  requireTab(user, 'gm');
  const rows = await allPaged(db, 'reversals', b => b.select('*').eq('id', id));
  const r = rows[0];
  if (!r) throw badRequest('That reversal could not be found.');
  if (r.finance_status !== 'Approved') throw badRequest('Finance must approve before the GM authorises.');
  const { error } = await db.from('reversals').update({
    gm_status: approve ? 'Approved' : 'Rejected', gm_by: user.name, gm_at: new Date().toISOString(),
    gm_note: textOrNull(note), status: approve ? 'Reversed' : 'Rejected', closed_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw new Error(error.message);
  if (approve) {
    const loan = await mustLoan(db, r.loan_id);
    /* CLOSED, NOT DELETED. "keep reversed loan as closed contract when another application
       comes it deals with next loan" -- the docket lives on for the next track. */
    await transition(db, loan, 'disbursed', 'reversed', user, {}, 'Reversal authorised by GM: ' + r.reason);
    await db.from('loans').update({ stage: 'closed' }).eq('id', loan.id);
  }
  return { ok: true };
}

/* =====================================================================================
   10. GM -- carriers, and growth (region / branch / zone / team, in HOPE PMO's own `teams`
       table, which lives inside this schema too -- see the header of db/schema.sql).
   ===================================================================================== */

async function carriersList(db) { return { rows: await allPaged(db, 'carriers', b => b.select('*').order('name')) }; }
async function carrierSave(db, user, { name, kind }) {
  requireTab(user, 'gm');
  if (!textOrNull(name)) throw badRequest('A carrier name is required.');
  const { error } = await db.from('carriers').upsert({ name: name.trim(), kind: kind || 'momo', added_by: user.name }, { onConflict: 'name' });
  if (error) throw new Error(error.message);
  return { ok: true };
}

/* =====================================================================================
   11. ILIYONASA -- the manual, signed, attributable adjustment.
   =====================================================================================
   "handling iliyonasia could add or reduce manual amount from current expected or current
    default total amounts of a team" -- a signed figure against one team/date/target, always
    editable, but never anonymous: who, when, why survive alongside the number. */

async function adjustmentSave(db, user, p) {
  requireTab(user, 'finance');
  const amount = Number(p.amount);
  if (!Number.isFinite(amount) || !amount) throw badRequest('A non-zero amount is required.');
  if (!['expected', 'defaults'].includes(p.target)) throw badRequest('target must be expected or defaults.');
  const { data, error } = await db.from('manual_adjustments').insert({
    team: normTeam(p.team), adj_date: p.date || todayKey(Date.now()), target: p.target,
    amount, reason: textOrNull(p.reason), ref: textOrNull(p.ref), created_by: user.name,
  }).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return { row: data };
}
async function adjustmentsList(db, user, { team, date }) {
  requireTab(user, 'finance');
  let b = db.from('manual_adjustments').select('*');
  if (team) b = b.eq('team', normTeam(team));
  if (date) b = b.eq('adj_date', date);
  return { rows: await allPaged(db, 'manual_adjustments', () => b) };
}

/* =====================================================================================
   12. THE PIPELINE VIEW -- one screen, every stage's count, for whoever holds several tabs.
   ===================================================================================== */

const STAGE_ORDER = ['unassigned', 'assigned', 'unassessed', 'assessed', 'pending_approval',
  'approved', 'disbursed', 'funded', 'rejected', 'reversed', 'closed'];

async function pipelineSummary(db, user) {
  const rows = await allPaged(db, 'loans', b => b.select('stage, requested_amt, principal_amt, net_disbursed'));
  const by = {};
  for (const s of STAGE_ORDER) by[s] = { count: 0, amount: 0 };
  for (const r of rows) {
    const s = by[r.stage] || (by[r.stage] = { count: 0, amount: 0 });
    s.count++;
    s.amount += Number(r.principal_amt || r.requested_amt || 0);
  }
  const { open } = await disburseWindowStatus(db);
  return { stages: STAGE_ORDER.map(s => ({ stage: s, ...by[s] })), windowOpen: open, total: rows.length };
}

/* =====================================================================================
   THE STAGE MACHINE'S TWO SHARED HELPERS.
   ===================================================================================== */

async function mustLoan(db, id) {
  const rows = await allPaged(db, 'loans', b => b.select('*').eq('id', id));
  const loan = rows[0];
  if (!loan) throw badRequest('That loan could not be found.');
  return loan;
}

/** Every stage change goes through here: it writes the new stage AND a loan_events row in one
    place, so "where has this loan been, and who moved it" is always a read, never a
    reconstruction -- and a transition attempted from the wrong stage fails loudly rather than
    silently overwriting whatever another screen already did to it. */
async function transition(db, loan, fromStage, toStage, user, patch, note) {
  if (loan.stage !== fromStage) {
    throw badRequest('This loan is at "' + loan.stage + '", not "' + fromStage + '" -- someone else may have just moved it. Reload and try again.');
  }
  const { error } = await db.from('loans').update({ ...patch, stage: toStage, updated_at: new Date().toISOString() }).eq('id', loan.id);
  if (error) throw new Error(error.message);
  await logEvent(db, loan.id, fromStage, toStage, user, patch.principal_amt || patch.net_disbursed || patch.team_recomm || null, note);
}

async function logEvent(db, loanId, from, to, user, amount, note) {
  // Fire-and-forget, same rule as HOPE PMO's audit log: the event trail must never be able to
  // fail the write it is recording.
  try {
    await db.from('loan_events').insert({
      loan_id: loanId, from_stage: from, to_stage: to, actor: user && user.name,
      actor_role: user && user.role, amount: amount || null, note: note || null,
    });
  } catch { /* never blocks the real write */ }
}

/* =====================================================================================
   THE ONE DOOR.
   ===================================================================================== */

const FN = {
  csSearch, csRegister, csComplaint,
  managerQueue, managerAssign, managerReject,
  teamQueue, teamAssessmentSave, teamSubmit,
  seniorQueue, seniorRecommend,
  creditQueue, creditApprove, creditReject,
  disburseWindowStatus, disburseQueue, managerDisburse, managerDisburseReject, managerReturnToCredit,
  financeOpenWindow, financeCloseWindow, financeBankReport, financeMarkFunded,
  financeImportPayments, financeShiftPayment,
  reversalsList, reversalRequest, reversalFinanceDecide, reversalGmDecide,
  carriersList, carrierSave,
  adjustmentSave, adjustmentsList,
  pipelineSummary,
};

export async function loanApi(db, user, fn, args) {
  const h = FN[fn];
  if (!h) throw badRequest('Unknown HOPE Loan function: ' + fn);
  return h(db, user, args || {});
}

export const LOAN_FUNCTIONS = Object.keys(FN);
