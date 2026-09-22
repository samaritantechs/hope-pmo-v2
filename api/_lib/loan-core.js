import { fetchAll, runQuery, supabase } from './supabase.js';
import { normPhone, textOrNull, normTeam } from './parse.js';
import { todayKey } from './time.js';
import { sendMail, noticeHtml } from './mail.js';
import { PDFDocument } from 'pdf-lib';

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
    signed-in code's tab list -- a manager sees Assignment, a credit analyst sees Approval, each
    on its own ticked box, exactly the way HOPE PMO tabs already work (see mayUseHopeLoan in
    workspace.js: ADMIN, or a code holding at least one of HOPE Loan's own tabs, may even reach
    this file at all -- this is the SECOND check, per screen, once they are in it).

    The ADMIN role is let through here on the role string, same check workspace.js already
    makes -- not on a tab named "admin", which does not exist; HOPE PMO's own ADMIN_TABS is
    upload/settings/audit, never the word "admin" itself. */
function requireTab(user, tab) {
  if (String((user && user.role) || '').trim().toUpperCase() === 'ADMIN') return;
  const tabs = (user && user.tabs) || [];
  if (!tabs.includes(tab)) {
    throw forbidden('Hujaruhusiwa kufungua hii. / You do not have the "' + tab + '" tab for HOPE Loan.');
  }
}

/** Same rule, any ONE of several tabs -- for a screen more than one role legitimately needs.
    branchList is the first: Customer Service picks a branch at registration, and now Manager
    picks a team FROM that same branch/team list at assignment ("Manager assigning to a team
    should be choice not filling") -- one list, two tabs allowed to ask for it. */
function requireAnyTab(user, tabs) {
  if (String((user && user.role) || '').trim().toUpperCase() === 'ADMIN') return;
  const utabs = (user && user.tabs) || [];
  if (!tabs.some(t => utabs.includes(t))) {
    throw forbidden('Hujaruhusiwa kufungua hii. / You do not have any of the required tabs for HOPE Loan.');
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
  /* THE CHEAPEST READ THERE IS: PostgREST answers a head-only exact count in a HEADER, with no
     body at all. This used to page the whole customers table just to length it -- one request
     per thousand rows, every single registration, to learn a number Postgres already knows.
     At sandbox scale that was invisible; on a real book it is the exact shape of read this
     project has been burned by before.

     STILL NOT A SEQUENCE, and deliberately: count+1 is only safe because registration is one
     person at a time on a demo. Before this carries real volume it wants a Postgres sequence,
     which is the one thing that cannot hand two customers the same docket under concurrency. */
  const { count, error } = await runQuery(() => db.from('customers').select('id', { count: 'exact', head: true }));
  if (error) throw new Error(error.message);
  return (count || 0) + 1;
}

/* =====================================================================================
   1. CUSTOMER SERVICE -- search first, register second.
   ===================================================================================== */

/** "search first" -- a returning customer must be found by name or phone before a new docket
    is minted, or the same person becomes two people. */
async function csSearch(db, user, { q }) {
  requireTab(user, 'customer_service');
  const query = String(q == null ? '' : q).trim();
  if (query.length < 3) return { rows: [], note: 'Andika angalau herufi 3. / Type at least 3 characters.' };

  /* FILTERED IN THE QUERY, NOT AFTERWARDS. This used to read the WHOLE customers table and
     filter it in JavaScript -- fine against a handful of sandbox rows, and a full-table read
     per search the moment this holds a real book. Same idiom findCustomer already uses:
     one `.or()` across the columns a person actually types, capped, so the database returns
     the twenty-five that matched instead of the ninety thousand that did not.

     PHONES ARE STORED NORMALISED -- normPhone strips the leading zero and the country code --
     so a typed 0763357860 must be searched as its last nine digits or it silently finds
     nothing, which is the failure most likely to be blamed on the data rather than the query. */
  const like = '%' + query.replace(/[%_\\]/g, m => '\\' + m) + '%';
  const digits = query.replace(/\D/g, '');
  const numLike = digits.length >= 7 ? '%' + digits.slice(-9) + '%' : null;
  const cols = ['full_name.ilike.' + like, 'docket.ilike.' + like]
    .concat(numLike ? ['mobile.ilike.' + numLike] : []);
  const rows = await allPaged(db, 'customers', b =>
    b.select('id, docket, full_name, mobile, team, branch, business_type').or(cols.join(',')).limit(25));
  return { rows };
}

/** The region -> branch choice at registration.

    "Registering a new customer is always by selecting branch so that the customer gets
     visible in manager assignment window then manager selects team to assign"

    "selecting a branch should autofill its region since customer service agents dont know
     that / infact they should select among regions and then choose drop list of branches in
     the regions"

    Customer service does not choose a TEAM -- it does not know, and should not have to know,
    which of a branch's several teams a landmark actually belongs to. That is the manager's
    call, made from the branch and the customer's own landmark once the application is in the
    queue (managerQueue). Nor, it turns out, do they reliably know which REGION a branch is
    in -- so the choice is two steps, region first (the geography an agent actually knows),
    then branch (narrowed to that region), rather than one flat list of ~80 branch names to
    search by eye.

    Deliberately narrow, same as before: branch and region names only, nothing about who runs
    a team or what number rings them -- the full roster stays behind the `teams` tab, which
    customer service does not have. */
async function branchList(db, user) {
  // CS picks a branch at registration; Manager now picks a TEAM from that same branch at
  // assignment ("Manager assigning to a team should be choice not filling") -- one read, two
  // tabs allowed to ask for it, same as any other screen more than one role legitimately needs.
  requireAnyTab(user, ['customer_service', 'manager']);
  const rows = await allPaged(db, 'teams', b => b.select('team, region, branch'));
  // A branch belongs to one region; several teams share both. First non-null region seen for
  // a branch wins -- if the data ever disagrees, that is a Teams & Staff data question, not
  // something this list should silently average or duplicate the branch to "fix".
  const regionOf = {};
  for (const r of rows) {
    const b = textOrNull(r.branch);
    if (!b || regionOf[b]) continue;
    const rg = textOrNull(r.region);
    if (rg) regionOf[b] = rg;
  }
  const branches = [...new Set(rows.map(r => textOrNull(r.branch)).filter(Boolean))].sort();
  const byRegion = {};
  for (const b of branches) {
    const rg = regionOf[b] || '(Region unknown)';
    (byRegion[rg] = byRegion[rg] || []).push(b);
  }
  const regions = Object.keys(byRegion).sort((a, b) =>
    a === '(Region unknown)' ? 1 : b === '(Region unknown)' ? -1 : a.localeCompare(b));
  // Which teams sit in each branch -- the manager's own choice list, so assigning a loan is a
  // SELECT off what actually exists (same reasoning branch/region already got), not a name
  // typed from memory that a typo or a stale one turns into an orphaned loan nobody's queue picks up.
  const teamsByBranch = {};
  for (const r of rows) {
    const b = textOrNull(r.branch), t = textOrNull(r.team);
    if (!b || !t) continue;
    (teamsByBranch[b] = teamsByBranch[b] || []).push(t);
  }
  for (const b of Object.keys(teamsByBranch)) teamsByBranch[b] = [...new Set(teamsByBranch[b])].sort();
  return { regions, byRegion, branches, teamsByBranch };
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
      // "add filling business type before location choices too" -- asked at registration now,
      // the SAME column the team's own Business assessment section writes later (see
      // teamAssessmentSave's 'business' branch) -- one field, filled early when CS already has
      // the answer, still editable at assessment if it needs correcting.
      business_type: textOrNull(p.business_type),
      // "they ask them who is near when we can't reach you, and not the guarantor" -- someone
      // physically near the customer, distinct from mobile_alt (the customer's own second
      // number, asked later at team assessment) and from the guarantor. See RUN-ME-010.
      neighbor_no: normPhone(p.neighbor_no),
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
    // "after disb mode in loanapp, fill the disb no (mobile money/momo no or bank a/c no)" --
    // the SAME three columns credit approval already offers (momo / bank_name / account_no),
    // asked for once, right where the mode itself is chosen, instead of waiting for credit to
    // ask a second time with nothing on file yet if this step is skipped.
    momo: normPhone(p.momo), bank_name: textOrNull(p.bank_name), account_no: textOrNull(p.account_no),
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

/** The register itself. csComplaint could WRITE a complaint and nothing could read one back,
    which makes a register a drawer nobody opens -- and "Can assign other system users to
    follow-up over registered complaint(s)" needs the list before it can mean anything. */
async function complaintsList(db, user) {
  requireTab(user, 'customer_service');
  const rows = await allPaged(db, 'complaints', b => b.select('*'));
  const sorted = rows.slice().sort((x, y) => String(y.created_at || '').localeCompare(String(x.created_at || '')));
  return {
    rows: sorted,
    open: sorted.filter(r => K(r.status) !== 'RESOLVED').length,
    resolved: sorted.filter(r => K(r.status) === 'RESOLVED').length,
  };
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
  /* "Manager assigning to a team should be choice not filling" -- the client now offers only
     the branch's own teams (branchList's teamsByBranch), but the choice is enforced here too,
     not merely suggested there: a team that is not actually one of this loan's branch's teams
     is refused, the same protection a typo or a stale client would otherwise slip past.
     Loans from before branch tracking existed carry no branch at all -- nothing to check
     against, so those fall back to the old bare non-empty rule rather than being blocked by a
     fact the record never had. */
  if (loan.branch) {
    const rows = await allPaged(db, 'teams', b => b.select('team').eq('team', t).eq('branch', loan.branch));
    if (!rows.length) throw badRequest('"' + t + '" is not one of ' + loan.branch + '\'s teams.');
  }
  await transition(db, loan, 'unassigned', 'assigned', user, {
    team: t, assigned_by: user.name, assigned_at: new Date().toISOString(),
  }, 'Assigned to ' + t);
  /* "if assigned no = assessment plan number, merge both for the single customer into
     recommendation" -- the team may have visited this customer before customer service could
     register them (a double loan needs 10 installments paid; the visit happens at 9). What
     they captured is waiting on the plan; it lands on this loan now. Never fails the
     assignment: what happened, or did not, comes back in the answer. */
  const planMerged = await mergePlanIntoLoan_(db, user, { ...loan, stage: 'assigned', team: t });
  return { ok: true, planMerged };
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

/** Everything the assessment drawer needs to open ALREADY FILLED, not blank -- the customer,
    every guarantor slot (rank 0 the guarantor, 1-5 the alternates), and the draft assessment
    itself. Without this, leaving the screen and coming back showed empty boxes over data that
    was actually saved -- "nothing is lost if you leave and come back" was true in the database
    and false on the screen. Also what the KYC copy button reads from: one fetch, the same
    fields either way. */
async function teamAssessDetail(db, user, { loan_id }) {
  requireTab(user, 'team');
  const loan = await mustLoan(db, loan_id);
  await pruneStaleContractPhotos_(db, loan);
  const [custRows, guarantors, assessment] = await Promise.all([
    loan.customer_id ? allPaged(db, 'customers', b => b.select('*').eq('id', loan.customer_id)) : [],
    allPaged(db, 'guarantors', b => b.select('*').eq('loan_id', loan.id).order('rank')),
    assessmentFor(db, loan.id),
  ]);
  return { loan, customer: custRows[0] || null, guarantors, assessment };
}

/* =====================================================================================
   KYC CAPTURES -- SIGNATURE, THUMBPRINT PRESS, AND THE VERIFICATION PHOTOS.
   =====================================================================================
   "i mean they press the thumb on phone screen and we record the fingerprint or draw
    signature too llike how we work with phone notes apps" -- a canvas capture, drawn on the
   device; there is no browser API and no bridge method in this app that reads an actual
   fingerprint sensor, and this was confirmed rather than assumed before it was built.

   Every byte here is compressed on the PHONE before it is ever sent -- "adapt the whatsapp
   tech ... optimize it before storing and store the low quality" -- so the cap below is a
   backstop, not the primary defence. Uploaded through the API with the service-role key, the
   same as every write in this system; the bucket itself is private (see RUN-ME-004), so a
   leaked path is not a leaked photo. */
const KYC_BUCKET = 'kyc-photos';
const KYC_MAX_BYTES = 2 * 1024 * 1024;
/* "10-photo contract capture" -- a genuinely repeated, undifferentiated set (RUN-ME-011),
   capped server-side rather than left to the client alone to enforce. */
const CONTRACT_MAX_PHOTOS = 10;
async function kycUpload(db, user, { loan_id, kind, data_url, camera_label, plan_id }) {
  requireTab(user, 'team');
  /* A PLAN MAY OWN A CAPTURE TOO. The field visit that fills an Assessment Plan's draft (see
     assessmentPlanDraftSave) takes the same photos the recommendation does, before there is a
     loan to file them under. They land under plans/<plan id>/ and their paths ride the draft
     into the loan at merge -- the objects never move. The signed contract is the one kind a
     plan cannot take: it is a fact about a loan that exists. */
  if (!loan_id && plan_id) return kycUploadForPlan_(db, user, { plan_id, kind, data_url });
  const loan = await mustLoan(db, loan_id);
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(data_url || ''));
  if (!m) throw badRequest('That did not look like an image.');
  const [, contentType, b64] = m;
  let bytes;
  try { bytes = Buffer.from(b64, 'base64'); } catch { throw badRequest('That image could not be read.'); }
  if (!bytes.length) throw badRequest('That image was empty.');
  if (bytes.length > KYC_MAX_BYTES) throw badRequest('That image is still too large (over 2MB) even after compression.');
  const safeKind = String(kind || 'file').replace(/[^a-z0-9_-]/gi, '') || 'file';
  if (safeKind === 'contract' && (Array.isArray(loan.contract_photo_urls) ? loan.contract_photo_urls.length : 0) >= CONTRACT_MAX_PHOTOS) {
    throw badRequest('Already at ' + CONTRACT_MAX_PHOTOS + ' contract photos for this loan.');
  }
  const ext = contentType.indexOf('png') >= 0 ? 'png' : 'jpg';
  const path = 'loans/' + loan_id + '/' + safeKind + '-' + Date.now() + '.' + ext;
  const { error } = await db.storage.from(KYC_BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(error.message);
  await logKycCapture(db, loan_id, safeKind, path, camera_label, user);
  if (safeKind === 'contract') await addContractPhoto_(db, loan, path);
  return { path };
}

/** The image checks kycUpload makes, on their own, so the plan-owned upload cannot drift from
    the loan-owned one on what it accepts. */
function decodeCapture_(data_url) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(data_url || ''));
  if (!m) throw badRequest('That did not look like an image.');
  const [, contentType, b64] = m;
  let bytes;
  try { bytes = Buffer.from(b64, 'base64'); } catch { throw badRequest('That image could not be read.'); }
  if (!bytes.length) throw badRequest('That image was empty.');
  if (bytes.length > KYC_MAX_BYTES) throw badRequest('That image is still too large (over 2MB) even after compression.');
  return { contentType, bytes, ext: contentType.indexOf('png') >= 0 ? 'png' : 'jpg' };
}
async function kycUploadForPlan_(db, user, { plan_id, kind, data_url }) {
  const plan = await mustPlan_(db, user, plan_id);
  const safeKind = String(kind || 'file').replace(/[^a-z0-9_-]/gi, '') || 'file';
  if (safeKind === 'contract') throw badRequest('The signed contract is captured at Team · Recommendation, once the loan exists.');
  const { contentType, bytes, ext } = decodeCapture_(data_url);
  const path = 'plans/' + plan.id + '/' + safeKind + '-' + Date.now() + '.' + ext;
  const { error } = await db.storage.from(KYC_BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(error.message);
  return { path };
}

/** Appends one captured contract-page path to the loan's array and marks the assessment
    "contract_signed" the moment the first page lands. A read-modify-write, not an atomic
    array append -- one officer works one loan at a time here, never concurrent writers on the
    same row, so the small race window this leaves is not worth a Postgres function to close. */
async function addContractPhoto_(db, loan, path) {
  const next = [...(Array.isArray(loan.contract_photo_urls) ? loan.contract_photo_urls : []), path];
  const { error } = await db.from('loans').update({ contract_photo_urls: next }).eq('id', loan.id);
  if (error) throw new Error(error.message);
  loan.contract_photo_urls = next;
  const a = await assessmentFor(db, loan.id);
  if (a) {
    if (!a.contract_signed) await db.from('assessments').update({ contract_signed: true }).eq('id', a.id);
  } else {
    // No assessment row yet is unusual (personal details is normally saved first) but not
    // impossible -- create one rather than losing that the contract has been signed.
    await db.from('assessments').insert({
      loan_id: loan.id, customer_id: loan.customer_id, team: loan.team, contract_signed: true,
    });
  }
}

/* "delete recommendation photos on approval / 3-day max lifetime otherwise" -- the raw
   per-page captures are meant to be consolidated into one PDF at approval (finalizeContract_,
   below) and cleared from storage then. A loan that never gets there -- rejected, abandoned,
   or just slow -- must not keep piling up raw photos indefinitely; checked lazily the next
   time anyone opens this one loan, same as every other time-based cleanup in this codebase has
   no cron to run on (see CLAUDE.md) and instead rides the feature's own natural read. */
const CONTRACT_PHOTO_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
async function pruneStaleContractPhotos_(db, loan) {
  const paths = Array.isArray(loan.contract_photo_urls) ? loan.contract_photo_urls : [];
  if (!paths.length) return;
  const oldest = oldestCaptureMs_(paths);
  if (oldest == null || Date.now() - oldest < CONTRACT_PHOTO_MAX_AGE_MS) return;
  try { await db.storage.from(KYC_BUCKET).remove(paths); } catch { /* best-effort -- the DB clear below still runs */ }
  const { error } = await db.from('loans').update({ contract_photo_urls: [] }).eq('id', loan.id);
  if (!error) loan.contract_photo_urls = [];
}
/* Every kycUpload path ends "...-<epoch ms>.<ext>" -- reused here rather than adding a
   first-captured-at column just to answer "how old is the oldest one". */
function oldestCaptureMs_(paths) {
  let oldest = null;
  for (const p of paths) {
    const m = /-(\d{10,})\.\w+$/.exec(String(p || ''));
    const ms = m ? Number(m[1]) : NaN;
    if (Number.isFinite(ms) && (oldest == null || ms < oldest)) oldest = ms;
  }
  return oldest;
}

/** Assembles the loan's captured contract-page photos into ONE PDF -- literally the photographed
    pages of the actual signed paper contract, one image per page, never invented text: this
    codebase has no legal-contract-text generator (see RUN-ME-011) and is not the place to guess
    at one. Stored as assessments.contract_url, emailed as a courtesy if CONTRACT_EMAIL is set
    (never able to block the approval it follows -- same rule as every email in api/_lib/mail.js),
    then the raw per-page photos are deleted: they are now preserved inside the PDF, and keeping
    both would only be the same record twice. Never throws -- called after the approval itself
    has already committed. */
async function finalizeContractOnApproval_(db, loan, assessment, user) {
  const paths = Array.isArray(loan.contract_photo_urls) ? loan.contract_photo_urls : [];
  if (!paths.length) return { built: false };
  try {
    const doc = await PDFDocument.create();
    for (const path of paths) {
      const { data, error } = await db.storage.from(KYC_BUCKET).download(path);
      if (error || !data) continue;                    // one missing page skips, it does not fail the whole contract
      const bytes = Buffer.from(await data.arrayBuffer());
      const isPng = /\.png$/i.test(path);
      const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    if (!doc.getPageCount()) return { built: false };
    const pdfBytes = Buffer.from(await doc.save());
    const pdfPath = 'loans/' + loan.id + '/contract-' + Date.now() + '.pdf';
    const { error: upErr } = await db.storage.from(KYC_BUCKET).upload(pdfPath, pdfBytes, { contentType: 'application/pdf', upsert: false });
    if (upErr) throw new Error(upErr.message);

    if (assessment) await db.from('assessments').update({ contract_url: pdfPath }).eq('id', assessment.id);

    const mailResult = await sendMail(db, {
      toKey: 'CONTRACT_EMAIL',
      subject: 'Mkataba ulioidhinishwa / Approved contract -- ' + (loan.loan_id || loan.id),
      html: noticeHtml('Mkataba ulioidhinishwa / Approved contract', [
        ['Ref', loan.loan_id || '—'], ['Docket', loan.docket_no || '—'],
        ['Jina / Name', loan.full_name || '—'], ['Timu / Team', loan.team || '—'],
        ['Kiasi kilichoidhinishwa / Granted', Number(loan.principal_amt) || 0],
        ['Aliyeidhinisha / Approved by', (user && user.name) || '—'],
      ], 'Mkataba uliosainiwa umeambatanishwa kama PDF. / The signed contract is attached as a PDF.'),
      attachments: [{ filename: 'contract-' + (loan.loan_id || loan.id) + '.pdf', content: pdfBytes.toString('base64') }],
    });

    try { await db.storage.from(KYC_BUCKET).remove(paths); } catch { /* the PDF above is the durable copy either way */ }
    await db.from('loans').update({ contract_photo_urls: [] }).eq('id', loan.id);

    return { built: true, pdfPath, mail: mailResult };
  } catch (e) {
    // Never lets a PDF/email hiccup undo or fail an approval that already happened.
    return { built: false, error: String((e && e.message) || e) };
  }
}

/** "call verification tick at approval tied to min-seconds threshold from the approver's own
    call-sync login" -- not a checkbox anyone could tick, a fact read off the SAME call_logs the
    officer's own call-sync app already wrote (see call-core.js/call.html) -- a DIFFERENT
    database from `db` in this file (see this file's own header comment on the sandbox/live
    split), reached deliberately for this one read. Advisory only: it never blocks approval, it
    tells the analyst what their own synced call history already shows. */
let callLogsDb_ = supabase;
/** Test-only seam, same idea as mail.js's _setFetch -- a test must not let this reach a real
    network. */
export function _setCallLogsDb(db) { callLogsDb_ = db || supabase; }

const CALL_VERIFY_DEFAULT_SECONDS = 30;
async function hlSettingNum_(db, key, dflt) {
  try {
    const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle();
    const n = parseInt(String((data && data.value) || '').replace(/[^0-9]/g, ''), 10);
    return (!n || isNaN(n)) ? dflt : n;
  } catch { return dflt; }
}
async function callVerificationFor_(db, user, phone) {
  const p = normPhone(phone);
  const minSeconds = await hlSettingNum_(db, 'CALL_VERIFY_MIN_SECONDS', CALL_VERIFY_DEFAULT_SECONDS);
  if (!p) return { verified: false, seconds: 0, minSeconds };
  try {
    const { data, error } = await callLogsDb_.from('call_logs')
      .select('duration, call_date')
      .eq('phone', p).eq('officer', (user && user.name) || '').eq('outcome', 'CONNECTED')
      .order('duration', { ascending: false }).limit(1);
    if (error || !data || !data.length) return { verified: false, seconds: 0, minSeconds };
    const seconds = Number(data[0].duration) || 0;
    return { verified: seconds >= minSeconds, seconds, minSeconds, callDate: data[0].call_date };
  } catch {
    return { verified: false, seconds: 0, minSeconds };   // call_logs unreachable is not a reason to block the screen
  }
}
async function creditCallCheck(db, user, { loan_id }) {
  requireTab(user, 'loan_credit');
  const loan = await mustLoan(db, loan_id);
  return callVerificationFor_(db, user, loan.contact);
}

/* Fire-and-forget, same rule as logEvent above: the audit trail must never be able to fail
   the upload it is recording, and db/RUN-ME-007 not having been run yet is not an error. */
async function logKycCapture(db, loanId, kind, path, cameraLabel, user) {
  try {
    await db.from('kyc_captures').insert({
      loan_id: loanId, kind, path,
      camera_label: cameraLabel ? String(cameraLabel).slice(0, 200) : null,
      actor: user && user.name, actor_role: user && user.role,
    });
  } catch { /* never blocks the real upload */ }
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
  const a = await assessmentFor(db, loan_id);
  /* "as long as recommendation is not submitted - can edit previous stages but always load /
     preview presaved info" -- and NOT once it has been. teamSubmit sets submitted_at and moves
     the loan out of the team's queue, but a screen already open (or a stale one someone kept
     a tab on) could still fire a save after that -- straight past senior review or credit,
     who may already be looking at the very numbers this would quietly change underneath them. */
  if (a && a.submitted_at) {
    throw badRequest('This recommendation has already been submitted -- it can no longer be edited here.');
  }
  const patch = await applySection_(db, user, loan, section, fields);
  const saved = await upsertAssessment_(db, user, loan, a, patch);
  if (loan.stage === 'assigned') await transition(db, loan, 'assigned', 'unassessed', user, {}, 'Assessment started');
  return { assessment: saved };
}

/** Where one section's fields LAND -- the customer record, the loan, the guarantor rows --
    and the patch that goes on the assessment row itself. One definition, read by two callers:
    the recommendation form's own save (teamAssessmentSave) and the merge of an Assessment
    Plan's draft into a freshly assigned loan (mergePlanIntoLoan_). The draft is saved in
    exactly this shape, section by section, so that at merge the same code files it the same
    way it would have been filed had the officer typed it into the recommendation. */
async function applySection_(db, user, loan, section, fields) {
  const patch = { ['done_' + section]: true, updated_at: new Date().toISOString(), submitted_by: user.name };

  if (section === 'personal') {
    // Track 2+: permanent fields are locked, per instruction -- silently dropped rather than
    // erroring, so a screen that still shows them (a stale cache) cannot corrupt identity.
    const locked = Number(loan.track_no) > 1;
    const customerPatch = {};
    for (const [k, v] of Object.entries(fields || {})) {
      if (k === 'other_number_form_url' || k === 'other_number_form_holder_url') continue;   // lands on loans, below
      if (locked && FIELD_LOCK_.has(k)) continue;
      customerPatch[k] = v;
    }
    if (Object.keys(customerPatch).length && loan.customer_id) {
      customerPatch.updated_by = user.name; customerPatch.updated_at = new Date().toISOString();
      const { error } = await db.from('customers').update(customerPatch).eq('id', loan.customer_id);
      if (error) throw new Error(error.message);
    }
    // "receives money with nos that ain't under their registration" -- the consent form
    // photos (RUN-ME-009). A fact about THIS loan's disbursement, not a permanent fact
    // about the customer, so it lands on loans rather than on the customer record above.
    const loanPatch = {};
    if ('other_number_form_url' in (fields || {})) loanPatch.other_number_form_url = textOrNull(fields.other_number_form_url);
    if ('other_number_form_holder_url' in (fields || {})) loanPatch.other_number_form_holder_url = textOrNull(fields.other_number_form_holder_url);
    if (Object.keys(loanPatch).length) {
      loanPatch.updated_at = new Date().toISOString();
      const { error } = await db.from('loans').update(loanPatch).eq('id', loan.id);
      if (error) throw new Error(error.message);
    }
  }
  if (section === 'recommendation') {
    patch.recommend_amount = Number((fields || {}).amount) || null;
    patch.zone_visited = textOrNull((fields || {}).zone);
    patch.remarks = textOrNull((fields || {}).remarks);
    // "recommendation kyc should go with team name, track no and credit score" -- team and
    // track_no already live on the loan itself; this is the one new number, the officer's own
    // scoring of the customer, carried into the copied KYC text alongside the amount.
    const scoreRaw = (fields || {}).credit_score;
    patch.credit_score = (scoreRaw === '' || scoreRaw == null) ? null : (Number(scoreRaw) || null);
    // "DHAMANA YA MKOPO ... mali za biashara na mali za nyumbani ... zenye thamani mara mbili
    // ya mkopo" (the contract's own collateral clause) -- collateral_type/collateral_value
    // already existed on loans (RUN-ME-001); this is the one place that ever writes to them.
    const collType = textOrNull((fields || {}).collateral_type);
    const collValRaw = (fields || {}).collateral_value;
    const collVal = (collValRaw === '' || collValRaw == null) ? null : (Number(collValRaw) || null);
    if (collType != null || collVal != null) {
      const { error } = await db.from('loans').update({
        collateral_type: collType, collateral_value: collVal, updated_at: new Date().toISOString(),
      }).eq('id', loan.id);
      if (error) throw new Error(error.message);
    }
    // The field officer's own attestation -- who was actually there, not just who the loan
    // was assigned to (that is the existing `officer` column). See RUN-ME-008.
    if ('officer_name' in (fields || {})) patch.officer_name = textOrNull(fields.officer_name);
    if ('officer_signature_url' in (fields || {})) patch.officer_signature_url = textOrNull(fields.officer_signature_url);
  }
  if (section === 'guarantor') {
    await saveGuarantors(db, loan, user, (fields || {}).guarantors || []);
  }
  if (section === 'residence') {
    patch.residence_verified = !!(fields || {}).verified;
    patch.guarantor_residence_verified = !!(fields || {}).guarantor_verified;
    // "residence and business ver should be filled street, ward, district for both customer
    // and guarantor" -- the CUSTOMER half lands here, on their permanent record, the same
    // merge-only update 'personal' already uses (only the keys actually sent are touched;
    // everything else on the customer stays exactly as it was). The guarantor half travels
    // with the guarantor section instead (see saveGuarantors) -- their row may not exist yet
    // the first time this section is saved, and a guarantor's own facts belong together.
    if (loan.customer_id) {
      const resPatch = {};
      // block_number/type_of_residence/residency_capacity/years_of_residence and the local
      // government letter are all CreditInfo Individual columns that already existed on
      // customers (RUN-ME-001/006) with nothing on this screen ever asking for them.
      // "4 residence photos each for customer and guarantor" (RUN-ME-011) -- the one photo
      // above is now the first of four; the extra three are optional, same as it was optional
      // before this.
      for (const k of ['street', 'ward', 'district', 'residence_lat', 'residence_lng', 'residence_verify_photo_url',
        'residence_verify_photo2_url', 'residence_verify_photo3_url', 'residence_verify_photo4_url',
        'block_number', 'type_of_residence', 'residency_capacity', 'years_of_residence', 'local_govt_letter_url']) {
        if ((fields || {})[k] !== undefined) resPatch[k] = (fields || {})[k];
      }
      if (Object.keys(resPatch).length) {
        resPatch.updated_by = user.name; resPatch.updated_at = new Date().toISOString();
        const { error } = await db.from('customers').update(resPatch).eq('id', loan.customer_id);
        if (error) throw new Error(error.message);
      }
    }
  }
  if (section === 'business') {
    patch.business_verified = !!(fields || {}).verified;
    if (loan.customer_id) {
      const bizPatch = { updated_by: user.name, updated_at: new Date().toISOString() };
      // "fill business name and capture live location coordinates for all 3 placess business
      // and their residences" -- business_lat/lng and the site photo (officer + customer AT
      // the business front) join business_name and business_type here.
      const BIZ_NUMERIC_ = new Set(['daily_sales', 'daily_profit', 'weekly_expenses']);
      // "3 business verification photos (customer alone / customer+officer / customer+officer
      // +guarantor)" (RUN-ME-011) -- business_verify_photo_url is the first ("customer alone"),
      // already existed; the other two are new and optional, same as the first always was.
      for (const k of ['business_type', 'business_name', 'daily_sales', 'daily_profit', 'weekly_expenses',
        'business_lat', 'business_lng', 'business_verify_photo_url',
        'business_verify_photo2_url', 'business_verify_photo3_url']) {
        const v = (fields || {})[k];
        if (v === undefined) continue;
        // These come off the form as trimmed strings, same as every text field -- cast rather
        // than hand '' or '12000' straight to a numeric(14,2) column and let Postgres decide.
        bizPatch[k] = BIZ_NUMERIC_.has(k) ? (v === '' || v == null ? null : (Number(v) || null)) : v;
      }
      if ((fields || {}).daily_profit != null && (fields || {}).daily_profit !== '') {
        bizPatch.weekly_profit = Number((fields || {}).daily_profit) * 6;
      }
      const { error } = await db.from('customers').update(bizPatch).eq('id', loan.customer_id);
      if (error) throw new Error(error.message);
    }
  }
  return patch;
}

async function upsertAssessment_(db, user, loan, a, patch) {
  if (a) {
    const { data, error } = await db.from('assessments').update(patch).eq('id', a.id).select('*').maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }
  const { data, error } = await db.from('assessments').insert({
    loan_id: loan.id, customer_id: loan.customer_id, team: loan.team, officer: user.name,
    visited_at: new Date().toISOString(), ...patch,
  }).select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Fields the bureau matches identity on -- write-once past the first loan, per instruction:
    "team recomendation of track two has review info but some info that seems perminent
     shouldnt be editable". Everything else (phone, residence, business, income, guarantor)
     stays revisable every track. */
const FIELD_LOCK_ = new Set([
  'first_name', 'middle_names', 'present_surname', 'birth_surname', 'gender', 'dob',
  'country_of_birth', 'national_id', 'tin',
]);

/** rank 0 is the guarantor -- a full record, street/GPS/photo/signature/thumbprint included.
    "we have 5 extra guarantors who we just say are the close people to the customer these are
     filled names nos and relationship" -- ranks 1-5 are exactly that and nothing more; the
     extra columns simply come back undefined for them and textOrNull/normPhone leave them
     null, the same as an alternate has always worked. */
async function saveGuarantors(db, loan, user, list) {
  const rows = (list || []).slice(0, 6).map((g, i) => ({
    loan_id: loan.id, customer_id: loan.customer_id, rank: i,
    full_name: textOrNull(g.full_name), phone: normPhone(g.phone), relationship: textOrNull(g.relationship),
    occupation: textOrNull(g.occupation), id_type: textOrNull(g.id_type), national_id: textOrNull(g.national_id),
    street: textOrNull(g.street), district: textOrNull(g.district), ward: textOrNull(g.ward),
    block_number: textOrNull(g.block_number), type_of_residence: textOrNull(g.type_of_residence),
    residency_capacity: textOrNull(g.residency_capacity),
    residence_lat: g.residence_lat != null ? Number(g.residence_lat) : null,
    residence_lng: g.residence_lng != null ? Number(g.residence_lng) : null,
    residence_verify_photo_url: textOrNull(g.residence_verify_photo_url),
    // "4 residence photos each for customer and guarantor" (RUN-ME-011).
    residence_verify_photo2_url: textOrNull(g.residence_verify_photo2_url),
    residence_verify_photo3_url: textOrNull(g.residence_verify_photo3_url),
    residence_verify_photo4_url: textOrNull(g.residence_verify_photo4_url),
    local_govt_letter_url: textOrNull(g.local_govt_letter_url),
    photo_url: textOrNull(g.photo_url), signature_url: textOrNull(g.signature_url), thumbprint_url: textOrNull(g.thumbprint_url),
    created_by: user.name,
  })).filter(r => r.full_name);
  if (!rows.length) return;
  // Replace this loan's guarantor set whole -- a short list edited in the field is simpler to
  // resend complete than to diff, and it is at most six rows. The DRAWER is what guarantees
  // nothing already saved gets clobbered by this: it opens pre-filled from teamAssessDetail,
  // so "resend complete" really does mean complete, not blanking out fields the officer never
  // touched this visit.
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
   4. SENIOR REVIEW -- the tier the wireframes never drew, now TWO SIDE NAVS, BOTH MANDATORY.
   =====================================================================================
   "the GMO and OPM review should be Manager and GMO review and all mandatory. Where manager
   is all loans 1million+ loans, gmo all 6m+ loans (change of policy, I'd been off on followup
   for a moment)". Both used to be one nav item and one optional tier (OPM MAY at 6M, never
   blocking); now they are two separate screens, gated on their own tab, and BOTH block credit
   once a loan crosses their threshold -- Manager at 1M, GMO at 6M, so a loan of 6M+ needs both,
   a loan of 1M-5,999,999 needs Manager alone, and anything under 1M needs neither.

   THE OLD 'opm' TAB IS GONE -- "so here we'll have two side navs b/se that's the way I
   distribute operations people login and I give them navigation tabs access at access codes"
   was answered by reusing the 'manager' tab that already grants Manager·Assign and Disburse,
   rather than minting a new one: an access code holding 'manager' now also reaches this screen,
   by the owner's own choice, not an oversight.

   THE STORAGE COLUMNS KEEP THEIR OLD NAME ON PURPOSE. opm_recommend / opm_remarks / opm_by /
   opm_at are a live table on a live system -- renaming a column is a migration this deploy does
   not need to make just to relabel what a tier is called. Anything already recorded under the
   old optional OPM step satisfies the new mandatory Manager step retroactively, which is the
   right outcome: a loan a senior person already looked at does not need looking at again just
   because the title on the button changed. */
export const GMO_THRESHOLD = 6_000_000;
export const MANAGER_THRESHOLD = 1_000_000;

async function seniorQueue(db, user, { tier }) {
  requireTab(user, tier === 'manager' ? 'manager' : 'gmo');
  const min = tier === 'manager' ? MANAGER_THRESHOLD : GMO_THRESHOLD;
  /* Filtered in JS rather than with `.gte()`: PostgREST/Postgres compares this NUMERICALLY,
     which is what a threshold needs, but a couple of the amounts here span different digit
     counts (500,000 vs 3,000,000) and any fake or intermediary that compared the column as a
     STRING would put 500,000 above the threshold ("500000" > "3000000" char by char). Rather
     than depend on the query layer getting that right, the comparison is done here in the one
     place it is unambiguous. The table this reads is small; this is not a cost worth the risk. */
  const rows = await allPaged(db, 'loans', b => b.select('*').eq('stage', 'pending_approval'));
  const eligible = rows.filter(r => (Number(r.team_recomm) || 0) >= min);
  if (tier === 'gmo') return { rows: eligible.filter(r => !r.gmo_at) };
  return { rows: eligible.filter(r => !r.opm_at) };          // 'manager' tier, opm_* columns underneath
}

async function seniorRecommend(db, user, { loan_id, tier, amount, remarks }) {
  requireTab(user, tier === 'manager' ? 'manager' : 'gmo');
  const loan = await mustLoan(db, loan_id);
  const patch = tier === 'manager'
    ? { opm_recommend: Number(amount) || null, opm_remarks: textOrNull(remarks), opm_by: user.name, opm_at: new Date().toISOString() }
    : { gmo_recommend: Number(amount) || null, gmo_remarks: textOrNull(remarks), gmo_by: user.name, gmo_at: new Date().toISOString() };
  const { error } = await db.from('loans').update(patch).eq('id', loan.id);
  if (error) throw new Error(error.message);
  await logEvent(db, loan.id, loan.stage, loan.stage, user, Number(amount) || 0, (tier === 'manager' ? 'MANAGER' : 'GMO') + ' recommendation');
  return { ok: true };
}

/* =====================================================================================
   5. CREDIT ANALYST -- approval.
   ===================================================================================== */

async function creditQueue(db, user) {
  requireTab(user, 'loan_credit');
  const rows = await allPaged(db, 'loans', b => b.select('*').eq('stage', 'pending_approval').order('team_recomm', { ascending: false }));
  // Blocked until EVERY mandatory senior review for this amount has happened -- Manager at 1M,
  // GMO at 6M, both required once a loan crosses both thresholds (see the section above).
  return { rows: rows.filter(r => {
    const amt = Number(r.team_recomm) || 0;
    if (amt >= MANAGER_THRESHOLD && !r.opm_at) return false;
    if (amt >= GMO_THRESHOLD && !r.gmo_at) return false;
    return true;
  }) };
}

/** "ADA YA MKOPO (APPLICATION FEES) ... asilimia tano (5%) ya kiasi cha msingi na haitakuwa
    chini ya Shilingi ................." -- the contract's own 5%-of-principal application fee,
    separate from the 36% interest/management-fee already in INTEREST_FLAT_RATE. The minimum-
    shillings floor is a blank in the contract template itself, so it is not hard-coded here --
    this is only the suggested 5%; credit can raise it by hand on the form when the floor
    applies. Deducted from what is actually disbursed, per the contract's own "Barua ya Ahadi
    ya Mkopo": the amount promised is the principal MINUS this fee, not the principal itself. */
const APPLICATION_FEE_RATE = 0.05;

async function creditApprove(db, user, p) {
  requireTab(user, 'loan_credit');
  const loan = await mustLoan(db, p.loan_id);
  const granted = Number(p.granted_amount) || 0;
  if (!granted) throw badRequest('A granted amount is required.');
  const previousBalance = Number(p.previous_balance) || 0;
  const appFee = p.application_fee != null && p.application_fee !== ''
    ? Number(p.application_fee) || 0 : Math.round(granted * APPLICATION_FEE_RATE);
  const disbursing = Math.max(0, granted - previousBalance - appFee);
  const interest = Math.round(granted * INTEREST_FLAT_RATE);
  const total = granted + interest;
  const installment = Math.round(total / INSTALLMENTS);
  await transition(db, loan, 'pending_approval', 'approved', user, {
    principal_amt: granted, previous_balance: previousBalance, net_disbursed: disbursing,
    interest_amt: interest, loan_amt: total, installment_amt: installment, application_fee: appFee,
    installments: INSTALLMENTS, disbursement_type: textOrNull(p.disbursement_mode) || loan.disbursement_type,
    approved_by: user.name, approved_date: todayKey(Date.now()), bank_name: textOrNull(p.bank_name),
    account_no: textOrNull(p.account_no),
  }, 'Granted ' + granted);
  loan.principal_amt = granted;   // finalizeContractOnApproval_'s email reads this off the in-memory loan, not a refetch

  // "call verification tick at approval" -- recorded now, once, against what the analyst's
  // own call-sync history actually showed AT approval, not left to drift from a client-side
  // read that may be minutes stale by the time this fires.
  const a = await assessmentFor(db, loan.id);
  const callCheck = await callVerificationFor_(db, user, loan.contact);
  if (a) {
    await db.from('assessments').update({
      call_verified: callCheck.verified, call_verified_seconds: callCheck.seconds,
      call_verified_at: new Date().toISOString(),
    }).eq('id', a.id);
  }

  // "delete recommendation photos on approval" -- consolidated into one PDF and emailed as a
  // courtesy first (see finalizeContractOnApproval_); never allowed to fail the approval that
  // already committed above.
  const contract = await finalizeContractOnApproval_(db, loan, a, user);

  return { ok: true, interest, total, installment, application_fee: appFee, callCheck, contract };
}

async function creditReject(db, user, { loan_id, reason }) {
  requireTab(user, 'loan_credit');
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

/** THE WINDOW STATE RIDES ALONG WITH THE QUEUE. The screen needs both and used to ask for them
    as two separate calls from the browser -- two HTTPS round trips from Vercel for one screen,
    when the second answer is one small read the first request could carry back for free.
    "Can two questions share one journey?" is the standing rule; this is the answer. */
async function disburseQueue(db, user) {
  requireTab(user, 'manager');
  const [rows, win] = await Promise.all([
    allPaged(db, 'loans', b => b.select('*').eq('stage', 'approved').order('approved_date')),
    disburseWindowStatus(db),
  ]);
  return { rows, windowOpen: win.open, window: win.window };
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
  /* Same one-journey rule as disburseQueue: the finance screen shows the window state above
     the report, so the report brings it back rather than the browser asking twice.
     NARROWED SELECT: this only ever prints eight fields, and `select('*')` on a loans row
     carries fifty -- most of them amounts and dates this screen never shows. Asking for fewer
     columns is the cheapest optimisation there is and the one the standing rule names first. */
  const [rows, win] = await Promise.all([
    allPaged(db, 'loans', b => b.select(
      'id, docket_no, full_name, contact, disbursement_type, bank_name, account_no, net_disbursed'
    ).eq('stage', 'disbursed')),
    disburseWindowStatus(db),
  ]);
  return {
    rows: rows.map(r => ({
      loan_id: r.id, docket: r.docket_no, full_name: r.full_name, contact: r.contact,
      carrier: r.disbursement_type, bank_name: r.bank_name, account_no: r.account_no,
      amount: r.net_disbursed,
    })),
    windowOpen: win.open, window: win.window,
  };
}

/** ONE READ, ONE WRITE, ONE EVENT INSERT FOR THE WHOLE BATCH -- not 3 round trips per loan.
    Every loan in a funding batch gets the identical patch (funded_at/funded_by/funding_batch);
    the only per-loan logic is the disbursed check, which used to cost its own `mustLoan` trip
    per id and now runs in JS against the one read already in hand. Reproduces the old
    per-id loop's behaviour exactly, including what it did almost by accident: a duplicate id
    in the list is read once, funded once, and every later repeat of it is silently a no-op
    (its stage is no longer 'disbursed' by the time the dedup would otherwise re-check it) --
    so ids are deduped up front rather than double-writing the update or the event.

    An id that names no loan at all still fails loudly, with `mustLoan`'s own words, and still
    fails the WHOLE call -- but now before anything is written, rather than after whichever
    earlier ids in the list had already been funded. That is a deliberate, safer change from
    the old partial-write-then-throw shape, and nothing in this codebase relies on the old one:
    `loan_ids` only ever arrives as a list of ids the caller just read off the bank report. */
async function financeMarkFunded(db, user, { loan_ids, batch }) {
  requireTab(user, 'finance');
  const ids = Array.isArray(loan_ids) ? loan_ids : [loan_ids];
  const uniqueIds = [...new Set(ids.map(id => String(id)))];
  const batchName = textOrNull(batch) || ('FUND-' + todayKey(Date.now()));
  const loans = await allPaged(db, 'loans', b => b.select('*').in('id', uniqueIds));
  const byId = new Map(loans.map(l => [String(l.id), l]));
  for (const id of uniqueIds) {
    if (!byId.has(id)) throw badRequest('That loan could not be found.');
  }
  /* THE STAGE THAT DOES NOT EXIST TODAY. Funding is the only thing that starts the schedule
     and puts a loan into the book that expected/defaulters logic will one day read. */
  const eligible = uniqueIds.map(id => byId.get(id)).filter(l => l.stage === 'disbursed');
  if (!eligible.length) return { funded: 0, batch: batchName };
  const nowIso = new Date().toISOString();
  const { error } = await db.from('loans').update({
    funded_at: nowIso, funded_by: user.name, funding_batch: batchName,
    stage: 'funded', updated_at: nowIso,
  }).in('id', eligible.map(l => l.id));
  if (error) throw new Error(error.message);
  const note = 'Funded via ' + batchName;
  // Same fire-and-forget rule as logEvent: the audit trail must never be able to fail the
  // write it is recording, batched or not.
  try {
    await db.from('loan_events').insert(eligible.map(l => ({
      loan_id: l.id, from_stage: 'disbursed', to_stage: 'funded',
      actor: user && user.name, actor_role: user && user.role, amount: null, note,
    })));
  } catch { /* never blocks the real write */ }
  return { funded: eligible.length, batch: batchName };
}

/** "CreditInfo asks for a Real End Date, which needs a closing event to hang on rather than
    being inferred from a zero balance" -- this IS that closing event: the payment that finally
    covers everything owed (loan_amt, principal plus the flat interest/fees). Runs after every
    import and after a shift lands money on a new ref; touches only 'funded' loans -- nothing
    still moving through origination, and nothing already closed/rejected/reversed -- and it
    only ever CLOSES. A shift that moves money away and drops a loan back under full payment
    does not reopen it automatically; whether a closed contract un-closes is a human call, not
    something a stray transfer should decide by itself. */
/** THE BATCHED VERSION OF THE RULE ABOVE, and the ONLY implementation of it -- closeIfFullyPaid_
    below is now a one-ref call into this, so an import touching many refs and a single shifted
    payment run the exact same close-if-covered logic rather than two copies of it drifting
    apart (CLAUDE.md: "one definition of a rule, in one place").

    Costs a handful of round trips for the WHOLE list of refs, not per ref: one read of the
    funded loans among them, one read of every payment on those loans' refs (summed and dated
    in JS, per ref), and -- only if anything actually closes -- one upsert (not a plain update:
    each closing loan stamps its OWN Real End Date, the latest payment on file for THAT loan,
    so the write cannot be one uniform patch) plus one batched loan_events insert. */
async function closeFullyPaidBatch_(db, user, refs) {
  const wanted = [...new Set((refs || []).filter(Boolean))];
  if (!wanted.length) return;
  const loans = await allPaged(db, 'loans', b => b.select('*').in('loan_id', wanted).eq('stage', 'funded'));
  const eligible = loans.filter(l => Number(l.loan_amt) > 0);
  if (!eligible.length) return;
  const payments = await allPaged(db, 'payment_imports',
    b => b.select('ref, amount, paid_at').in('ref', eligible.map(l => l.loan_id)));
  const byRef = new Map();
  for (const p of payments) {
    const g = byRef.get(p.ref) || { paid: 0, lastPaidAt: null };
    g.paid += Number(p.amount) || 0;
    // The Real End Date is when the balance actually reached zero, i.e. the latest payment on
    // file for this loan -- not today, if this import is finance catching up on a backlog.
    const d = p.paid_at ? String(p.paid_at).slice(0, 10) : null;
    if (d && (!g.lastPaidAt || d > g.lastPaidAt)) g.lastPaidAt = d;
    byRef.set(p.ref, g);
  }
  const todayFallback = todayKey(Date.now());
  const closing = eligible
    .map(loan => {
      const g = byRef.get(loan.loan_id) || { paid: 0, lastPaidAt: null };
      return { loan, paid: g.paid, real_end_date: g.lastPaidAt || todayFallback };
    })
    .filter(c => c.paid >= Number(c.loan.loan_amt));
  if (!closing.length) return;
  const nowIso = new Date().toISOString();
  const { error } = await db.from('loans').upsert(closing.map(c => ({
    id: c.loan.id, stage: 'closed', real_end_date: c.real_end_date, updated_at: nowIso,
  })), { onConflict: 'id' });
  if (error) throw new Error(error.message);
  try {
    await db.from('loan_events').insert(closing.map(c => ({
      loan_id: c.loan.id, from_stage: 'funded', to_stage: 'closed',
      actor: user && user.name, actor_role: user && user.role, amount: null,
      note: 'Closed -- fully repaid (' + c.paid + ' against ' + c.loan.loan_amt + ')',
    })));
  } catch { /* never blocks the real write */ }
}

async function closeIfFullyPaid_(db, user, ref) {
  if (!ref) return;
  await closeFullyPaidBatch_(db, user, [ref]);
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
  /* "Importing payment at finance always require transaction ID too." A payment with no
     transaction number cannot be traced back to the money -- and the WHOLE import is refused
     rather than the bad row quietly dropped, because "12 rows imported" with 11 in the book is
     exactly the kind of silent gap that becomes an unexplained figure later. */
  const noTrans = clean.map((r, i) => (r.trans_no ? null : (i + 1) + ' (REF ' + r.ref + ')')).filter(Boolean);
  if (noTrans.length) {
    throw badRequest('Kila mlipo lazima uwe na namba ya muamala / Every payment needs a transaction ID. '
      + 'Bila: / Missing on row ' + noTrans.join(', ') + '. Hakuna kilichoingizwa / Nothing was imported.');
  }
  const { error } = await db.from('payment_imports').insert(clean);
  if (error) throw new Error(error.message);
  // ONE batched close-check for every distinct ref in the import, not one call per ref --
  // closeFullyPaidBatch_ dedupes internally, same as the Set this used to build here.
  await closeFullyPaidBatch_(db, user, clean.map(r => r.ref));
  return { imported: clean.length, batch: batchName };
}

/** THE PAYMENTS FINANCE HAS BROUGHT IN, so that shifting one is reachable at all. Without
    this, financeShiftPayment could only be called by an id nobody had any way to look up --
    a working function with no door to it. Newest first, because a misapplied payment is
    almost always one that has just arrived. */
async function paymentsList(db, user, { batch, ref } = {}) {
  requireTab(user, 'finance');
  let b = db.from('payment_imports').select('*');
  if (batch) b = b.eq('batch', batch);
  if (ref) b = b.eq('ref', String(ref));
  /* ORDERED AND CAPPED IN THE QUERY, not sorted in JavaScript after dragging the lot back.
     A payments table only grows, so "read it all and sort it here" is a read with no ceiling --
     the exact shape this project has been burned by. Newest first because a misapplied payment
     is almost always one that has just arrived, and 500 is far more than anyone scrolls. */
  const rows = await allPaged(db, 'payment_imports', () =>
    b.order('imported_at', { ascending: false }).limit(500));
  return {
    rows,
    /* The batches on THIS page, so the screen can offer them rather than making somebody
       remember what an import was called. Deliberately not a second query for the full
       distinct list: one more round trip to name a few older batches nobody is looking for. */
    batches: [...new Set(rows.map(r => r.batch).filter(Boolean))].sort().reverse(),
  };
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
  // The money that just landed on to_ref might be what finally covers it -- same closing
  // check an import gets. The ref it left is not re-checked: money LEAVING never closes a loan.
  await closeIfFullyPaid_(db, user, textOrNull(to_ref));
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
  /* The three parties to a reversal, and nobody else: the register names every customer whose
     contract is being unwound, which a team or customer-service code has no business reading. */
  requireAnyTab(user, ['finance', 'gm', 'loan_credit']);
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
      team: l.team, branch: l.branch, amount: l.net_disbursed,
    })),
  };
}

async function reversalRequest(db, user, { loan_id, amount, reason }) {
  requireTab(user, 'loan_credit');
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
       comes it deals with next loan" -- the docket lives on for the next track.

       ONE write, not two: this used to stamp 'reversed' and then, in the very same request,
       immediately overwrite it with 'closed' -- two round trips to land on a state the first
       write was never meant to be seen in, and the loan_events row that DID get written
       (only the first update went through transition/logEvent) named a stage, 'reversed',
       that the loan was never left sitting in. STAGE_ORDER (below) does count and display a
       'reversed' bucket on the pipeline screen, so a loan that is genuinely mid-reversal on a
       given day is meant to show there -- what changes here is that this function no longer
       lands a loan in that bucket only for the instant between two writes, and (a real fix,
       not only a trip saved) the old second write's error was never checked, so a transient
       failure there could have stranded a loan at 'reversed' with nothing to ever move it on;
       transition()'s own write here is checked like every other one in this file. Landing on
       'closed' directly is the same final row, one fewer trip, and an audit trail that names
       the stage the loan is actually left in. */
    await transition(db, loan, 'disbursed', 'closed', user, {}, 'Reversal authorised by GM: ' + r.reason);
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
   ASSESSMENT PLAN -- who a team means to visit, and when, before there is even a customer.
   =====================================================================================
   "a new Assessment Plan nav, team-pivoted, only future dates editable, autodelete after 30
   days, autodelete once a matching approved loan appears, dropdown stale-reason comments, an
   ED/elapsed-days column" -- see RUN-ME-011 for the table. Both autodeletes are lazy, checked
   the moment anyone opens the list, same reasoning as pruneStaleContractPhotos_ above: no cron
   in this codebase (CLAUDE.md), and a screen's own natural read is what pays for it. */
const PLAN_MAX_AGE_DAYS = 30;
const PLAN_STALE_REASONS = [
  'Hapatikani / Unreachable', 'Amekataa / Declined', 'Amehama eneo / Moved away',
  'Biashara imefungwa / Business closed', 'Hana muda bado / No time yet', 'Nyingine / Other',
];

function elapsedDays_(plannedDate, nowKey) {
  if (!plannedDate) return null;
  const a = new Date(plannedDate + 'T00:00:00Z'), b = new Date(nowKey + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

/** Both autodeletes, checked once per list-open against the rows just read (no second query
    just to decide what to prune):
      - 30 days past its own planned_date, whatever the reason
      - a phone number that now matches a REAL, approved-or-further loan -- the plan did its job
    Marks the rows it removed with `_pruned` rather than re-querying; assessmentPlanList filters
    those out of what it returns. */
const PLAN_DONE_STAGES = ['approved', 'disbursed', 'funded', 'closed'];
/* A loan already with the team, whose recommendation is the place to type now -- a plan for
   this phone opened after assignment has nowhere to merge, so the list says so on the row. */
const PLAN_ASSIGNED_STAGES = ['assigned', 'unassessed', 'assessed'];
async function pruneAssessmentPlans_(db, rows) {
  if (!rows.length) return;
  const nowKey = todayKey(Date.now());
  const stale = new Set(rows.filter(r => elapsedDays_(r.planned_date, nowKey) > PLAN_MAX_AGE_DAYS));
  const phones = [...new Set(rows.map(r => normPhone(r.phone)).filter(Boolean))];
  let matched = new Set();
  const assigned = new Map();
  if (phones.length) {
    try {
      // ONE read for both questions (speed budget: 2 trips) -- done-or-further prunes the
      // plan; with-the-team marks it "already assigned, use Team · Recommendation".
      const loans = await allPaged(db, 'loans', b => b.select('contact, stage, loan_id, team')
        .in('stage', PLAN_DONE_STAGES.concat(PLAN_ASSIGNED_STAGES)).in('contact', phones));
      matched = new Set(loans.filter(l => PLAN_DONE_STAGES.includes(l.stage)).map(l => l.contact));
      for (const l of loans) if (PLAN_ASSIGNED_STAGES.includes(l.stage)) assigned.set(l.contact, { ref: l.loan_id, team: l.team });
    } catch { /* a failed lookup just means nothing autodeletes for that reason this time */ }
  }
  for (const r of rows) {
    const hit = assigned.get(normPhone(r.phone));
    r.assignedRef = hit ? hit.ref : null;
    r.assignedTeam = hit ? hit.team : null;
  }
  const toDelete = rows.filter(r => stale.has(r) || matched.has(normPhone(r.phone)));
  if (!toDelete.length) return;
  try { await db.from('assessment_plans').delete().in('id', toDelete.map(r => r.id)); } catch { /* next open tries again */ }
  for (const r of toDelete) r._pruned = true;
}

/** The teams a plan may be filed under, for this code: exactly the ones granted on its access
    code -- "they get their granted teams at access codes as we always pivot" -- or every team on
    the register for a code granted all of them (teams null/empty, the same convention /api/me
    reports). Spellings are the register's own, matched case-insensitively but never rewritten:
    .in()/.eq() are exact-case (CLAUDE.md), so the filter has to carry the stored spelling. */
async function planTeamsFor_(db, user) {
  const mine = [...new Set((Array.isArray(user.teams) ? user.teams : []).map(t => String(t == null ? '' : t).trim()).filter(Boolean))];
  if (mine.length) return { mine, all: false };
  const rows = await allPaged(db, 'teams', b => b.select('team'));
  return { mine: [...new Set(rows.map(r => textOrNull(r.team)).filter(Boolean))].sort(), all: true };
}
function matchTeam_(list, want) {
  const w = String(want == null ? '' : want).trim().toUpperCase();
  if (!w) return null;
  return list.find(t => String(t).trim().toUpperCase() === w) || null;
}

async function assessmentPlanList(db, user, p) {
  requireTab(user, 'team');
  const scope = await planTeamsFor_(db, user);
  // The bar's pivot. A team the code does not hold is simply not honoured -- the list stays
  // scoped to what it holds rather than answering with somebody else's plans.
  const picked = matchTeam_(scope.mine, (p || {}).team);
  const only = picked ? [picked] : (scope.all ? null : scope.mine);
  const rows = await allPaged(db, 'assessment_plans', b => only ? b.select('*').in('team', only) : b.select('*'));
  await pruneAssessmentPlans_(db, rows);
  const nowKey = todayKey(Date.now());
  return {
    rows: rows.filter(r => !r._pruned)
      .sort((a, b) => String(a.planned_date || '').localeCompare(String(b.planned_date || '')))
      .map(r => ({ ...r, elapsedDays: elapsedDays_(r.planned_date, nowKey),
        // How much of the recommendation is already drafted on this plan -- the column.
        draftSections: draftSections_(draftOf_(r)) })),
    staleReasons: PLAN_STALE_REASONS,
    teams: scope.mine,
  };
}

/** Which team a save lands in: the one named, if the code holds it; the code's only team when
    it holds just one and named none; and for a code granted every team, whatever it named
    (the register is the choice list, but a brand-new team is not refused). A code holding
    several teams that names none, or names one it does not hold, is told to choose. */
function resolvePlanTeam_(scope, want) {
  const held = matchTeam_(scope.mine, want);
  if (held) return held;
  if (scope.all) return textOrNull(want);
  if (scope.mine.length === 1 && !textOrNull(want)) return scope.mine[0];
  return null;
}

async function assessmentPlanSave(db, user, p) {
  requireTab(user, 'team');
  const scope = await planTeamsFor_(db, user);
  const fullName = textOrNull(p.full_name);
  if (!fullName) throw badRequest('A name is required.');
  const plannedDate = textOrNull(p.planned_date);
  if (!plannedDate) throw badRequest('A planned date is required.');
  const nowKey = todayKey(Date.now());
  if (p.id) {
    const rows = await allPaged(db, 'assessment_plans', b => b.select('*').eq('id', p.id));
    const existing = rows[0];
    if (!existing) throw badRequest('That plan could not be found.');
    // The list never shows a plan outside the code's teams; a save reaching one anyway is
    // refused for the same reason, not quietly accepted.
    if (!scope.all && !matchTeam_(scope.mine, existing.team)) throw forbidden('That plan belongs to a team this code does not hold.');
    // "only future dates editable" -- once a row's OWN planned date has passed, the dropdown
    // reason is still open to it (that is what the dropdown is for) but nothing else is.
    let patch;
    if (existing.planned_date < nowKey) {
      patch = { stale_reason: textOrNull(p.stale_reason) };
    } else {
      const team = p.team != null && textOrNull(p.team) ? resolvePlanTeam_(scope, p.team) : existing.team;
      if (!team) throw badRequest('Chagua timu unayoishikilia / Choose one of your own teams.');
      patch = { team, full_name: fullName, phone: normPhone(p.phone), planned_date: plannedDate, stale_reason: textOrNull(p.stale_reason) };
    }
    const { error } = await db.from('assessment_plans')
      .update({ ...patch, updated_by: user.name, updated_at: new Date().toISOString() }).eq('id', p.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  }
  const team = resolvePlanTeam_(scope, p.team);
  if (!team) throw badRequest('Chagua timu unayoishikilia / Choose one of your own teams.');
  // A brand new plan is only ever for a date not yet here -- "only future dates editable"
  // starts at creation, not just at edit.
  if (plannedDate < nowKey) throw badRequest('The planned date must be today or later.');
  const { error } = await db.from('assessment_plans').insert({
    team, full_name: fullName, phone: normPhone(p.phone), planned_date: plannedDate, created_by: user.name,
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function assessmentPlanDelete(db, user, { id }) {
  requireTab(user, 'team');
  const { error } = await db.from('assessment_plans').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** The plan this code may work on: it exists, and it belongs to a team the code holds. */
async function mustPlan_(db, user, id) {
  if (!id) throw badRequest('A plan is required.');
  const rows = await allPaged(db, 'assessment_plans', b => b.select('*').eq('id', id));
  const plan = rows[0];
  if (!plan) throw badRequest('That plan could not be found.');
  const scope = await planTeamsFor_(db, user);
  if (!scope.all && !matchTeam_(scope.mine, plan.team)) throw forbidden('That plan belongs to a team this code does not hold.');
  return plan;
}
function draftOf_(plan) {
  return plan && plan.draft && typeof plan.draft === 'object' && !Array.isArray(plan.draft) ? plan.draft : {};
}
function draftSections_(draft) {
  return [...SECTIONS].filter(s => draft[s] && typeof draft[s] === 'object' && Object.keys(draft[s]).length);
}

/* THE PRE-FILLABLE RECOMMENDATION -- SAVED ON THE PLAN, SUBMITTED ONLY ONCE THERE IS A LOAN.

     "allow the pre-fillable info of loan recommendation at assessment plan and saving only -
      submitting will only happen at recommendation"

   The same five sections the recommendation form saves, in the same field names, kept as
   JSON on the plan (RUN-ME-012). Nothing is written to any customer or loan here -- there is
   no customer yet; that is the whole point. Allowed whatever the plan's date: the visit is
   what the date was FOR, and the officer types it up on the day or the day after. */
async function assessmentPlanDraftSave(db, user, { id, section, fields }) {
  requireTab(user, 'team');
  if (!SECTIONS.has(section)) throw badRequest('Unknown assessment section: ' + section);
  const plan = await mustPlan_(db, user, id);
  const draft = { ...draftOf_(plan) };
  // A section is replaced whole, the way the form sends it -- every field it shows, each
  // save. Merging key-by-key would keep a photo the officer deliberately cleared.
  draft[section] = fields && typeof fields === 'object' ? fields : {};
  const { error } = await db.from('assessment_plans')
    .update({ draft, updated_by: user.name, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) {
    if (/draft/i.test(String(error.message))) {
      throw new Error('Rasimu haiwezi kuhifadhiwa bado: endesha db/hopeloan/RUN-ME-012 kwenye SQL editor. '
        + '/ The draft cannot be saved yet: run db/hopeloan/RUN-ME-012 in the SQL editor.');
    }
    throw new Error(error.message);
  }
  return { ok: true, draft, sections: draftSections_(draft) };
}

/** Which plan a freshly assigned loan matches: the loan's phone against the plans' -- the
    team's own plan first, then anyone's, newest saved first. */
function pickPlanForLoan_(plans, loan) {
  const team = String(loan.team == null ? '' : loan.team).trim().toUpperCase();
  const byNewest = (a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
  const own = plans.filter(p => String(p.team == null ? '' : p.team).trim().toUpperCase() === team).sort(byNewest);
  return own[0] || plans.slice().sort(byNewest)[0] || null;
}

/* "so if assigned no = assessment plan number, merge both for the single customer into
   recommendation". Runs inside managerAssign, after the assignment itself has been written.
   Every section the draft holds is filed through applySection_ -- the SAME code the
   recommendation form's own save goes through -- under the plan's author, so the loan reads
   exactly as if that officer had typed it into Team · Recommendation. Then the plan is
   removed: it did its job. A plan with an empty draft still matches (the customer is now in
   the team's queue, which is what the plan was reminding them of) and is removed too.
   Never throws: the assignment has already happened, and a merge that could not be finished
   is reported in the answer rather than allowed to undo it. */
async function mergePlanIntoLoan_(db, user, loan) {
  const phone = normPhone(loan.contact);
  if (!phone) return null;
  let plans;
  try { plans = await allPaged(db, 'assessment_plans', b => b.select('*').eq('phone', phone)); } catch { return null; }
  if (!plans.length) return null;
  const plan = pickPlanForLoan_(plans, loan);
  const draft = draftOf_(plan);
  const sections = draftSections_(draft);
  const out = { plan_id: plan.id, team: plan.team, planned_date: plan.planned_date,
    planned_by: plan.updated_by || plan.created_by || null, sections, error: null };
  try {
    if (sections.length) {
      // Filed under the officer who captured it, not the manager pressing Assign.
      const author = { ...user, name: out.planned_by || user.name };
      let patch = {};
      for (const s of sections) patch = { ...patch, ...(await applySection_(db, author, loan, s, draft[s])) };
      const a = await assessmentFor(db, loan.id);
      await upsertAssessment_(db, author, loan, a, patch);
      await transition(db, loan, 'assigned', 'unassessed', user, {},
        'Assessment plan merged: ' + sections.join(', ') + ' (planned ' + (plan.planned_date || '?') + ' by ' + (out.planned_by || '?') + ')');
    } else {
      await logEvent(db, loan.id, 'assigned', 'assigned', user, null,
        'Assessment plan matched (planned ' + (plan.planned_date || '?') + ', nothing drafted)');
    }
    const { error } = await db.from('assessment_plans').delete().eq('id', plan.id);
    if (error) throw new Error(error.message);
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  return out;
}

/* =====================================================================================
   THE ONE DOOR.
   ===================================================================================== */

const FN = {
  csSearch, csRegister, csComplaint, branchList,
  managerQueue, managerAssign, managerReject,
  teamQueue, teamAssessDetail, teamAssessmentSave, teamSubmit, kycUpload,
  seniorQueue, seniorRecommend,
  creditQueue, creditApprove, creditReject, creditCallCheck,
  disburseWindowStatus, disburseQueue, managerDisburse, managerDisburseReject, managerReturnToCredit,
  financeOpenWindow, financeCloseWindow, financeBankReport, financeMarkFunded,
  financeImportPayments, financeShiftPayment, paymentsList,
  complaintsList,
  reversalsList, reversalRequest, reversalFinanceDecide, reversalGmDecide,
  carriersList, carrierSave,
  adjustmentSave, adjustmentsList,
  pipelineSummary,
  assessmentPlanList, assessmentPlanSave, assessmentPlanDelete, assessmentPlanDraftSave,
};

export async function loanApi(db, user, fn, args) {
  const h = FN[fn];
  if (!h) throw badRequest('Unknown HOPE Loan function: ' + fn);
  return h(db, user, args || {});
}

export const LOAN_FUNCTIONS = Object.keys(FN);
