/** IMPREST -- ask, decide, fund, retire, review.
 *  =========================================================================================
 *    "our office and field staff always make imprest requests as implemented in Hoop, the
 *     hope google drive sheet has gone down with the sheet i was using so implement requests:
 *     so implement request, approval and report and i'll grant the navs to those responsible.
 *     refer to hoop implementation and the old one, i'll set GM email in settings, so these
 *     people see their history and everything but gm gets email that has the details and two
 *     links (single tap approval and disapproval or read). so we use the new way but the
 *     accountant infos are no longer there for requesting but they will just update funded
 *     amount in imprest report tab."
 *    "so gm can approve through email or system by the current implementation"
 *
 *  THE SHAPE IS HOOP'S OWN (hoop-pmo's imprest feature), deliberately: a costed trip kept as
 *  its parts, an accommodation rate STAMPED at request time so a later rate change never
 *  reprices an old trip, a retirement filed once with its receipts in their own table so no
 *  list ever drags three photos across the wire, and a retirement claim taken as a two-phase
 *  lock so two presses cannot both win. See imprestRetire below for the exact reasoning; it
 *  is carried over almost unchanged because it is already correct.
 *
 *  WHAT IS NEW HERE, because HOPE asked for it and HOOP was not:
 *    - THE GM CAN DECIDE FROM THE EMAIL, not only from the portal -- see imprestActionToken /
 *      imprestVerifyToken and api/imprest-action.js. The same imprestDecide() this file
 *      exports is what both paths call; the email path constructs a synthetic user holding
 *      exactly the impappr tab and nothing else (the same pattern api/shift-batch.js uses for
 *      the other office's server), so there is one definition of "what a decision does" and
 *      two doors to it.
 *    - THE ACCOUNTANT'S OWN FIELD. HOOP has no accountant step in imprest at all ("No
 *      accountants integration yet" -- its own migration's words). HOPE's does, but narrowly:
 *      funded_amount is written from the report tab, once, by whoever holds imprep and is not
 *      read-only -- it is what was actually disbursed, independent of what the GM approved,
 *      because cash flow does not always keep up with a decision.
 *
 *  THREE PANES, THREE TABS, NOBODY BY DEFAULT -- exactly the rule advreq/advappr/advrep and
 *  impreq/impappr/imprep already follow in hoop-pmo: "i'll grant navs to who performs what so
 *  the navs are the roles, not roles". Gated centrally in portal-core.js's FN_TAB, the same
 *  mechanism every other screen in this system uses -- nothing here re-invents a door.
 */
import { fetchAll, runQuery } from './supabase.js';
import { num } from './recovery.js';
import { sendMail, noticeHtml, noticeButton } from './mail.js';
import { pushTopic, pushCode, pushNoteOf } from './push.js';
import { sameName } from './expdf.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

function bad(msg) { const e = new Error(msg); e.status = 400; throw e; }
const K = v => String(v == null ? '' : v).trim().toUpperCase();
const money0 = n => Math.round(num(n)).toLocaleString('en-US');

const IMP_NOT_READY = 'Jedwali la imprest halijatengenezwa bado. Endesha db/RUN-ME-031-imprest.sql '
  + 'kwenye Supabase. / The imprest tables have not been created yet -- run that migration first.';
function tableMissing(err) {
  const s = String((err && (err.message || err.code)) || err || '');
  return /does not exist|Could not find the table|42P01|PGRST205/i.test(s)
    || /PGRST204/i.test(s) || /Could not find the '.*' column of/i.test(s);
}

const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
/* SHAPE, THEN CALENDAR -- a regex says a string looks like a date; only a round trip through
   Date says it names a real one (2026-02-30 passes the regex and nothing else). */
const isDay = s => {
  const v = String(s || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
/* A NON-NEGATIVE WHOLE NUMBER, or nothing. Money here is integer TZS; a value that is not one
   is refused rather than rounded, because a silently-rounded figure on a cash form is the
   exact argument the form exists to prevent. Booleans, arrays and hex strings all coerce under
   Number() -- true is 1, [7] is 7 -- and none of them is a shilling amount anybody typed. */
const intNN = v => {
  if (v === '' || v == null) return 0;
  if (typeof v !== 'number' && (typeof v !== 'string' || !/^\s*\d+(?:\.0+)?\s*$/.test(v))) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MONEY_MAX ? n : null;
};
const MONEY_MAX = 2000000000;
const S_ = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);

/* ---------------------------------------------------------------- READ IT ONCE, PER REQUEST
   The rate table is read by impreq (the form's preview), impappr (the owner) and imprep (the
   report). It is small -- a handful of roles -- so a whole-table read costs the same as asking
   for one row and cannot be defeated by an unmatched case. */
async function readRoles_(db) {
  try {
    return await fetchAll(() => db.from('imprest_roles')
      .select('role, accommodation_per_day, updated_by, updated_at'));
  } catch (e) {
    if (tableMissing(e)) return null;
    throw e;
  }
}
/** Role names known elsewhere in the system, for the approver's "add a rate" autocomplete --
    never a restriction on what may be typed, only a way to avoid a rate row nothing looks up
    because of one missing letter.

    MEMOISED PER DATABASE CLIENT, FIFTEEN SECONDS -- same idiom as readTeamsRawMemo_ in
    portal-core.js: impreq (the form's preview), impappr (the owner) and a page flipping
    between them all ask for this within moments of each other, and it is advisory only, never
    validated against, so a few seconds of staleness costs nothing a wrong keystroke in the
    other direction would not already cost. Kept local to this file rather than imported from
    portal-core.js, which imports FROM here -- a shared helper would be a cycle. */
const ROLE_NAMES_TTL_MS = 15000;
const roleNamesCache = new WeakMap();
async function readRoleNames_(db) {
  const at = Date.now();
  const hit = roleNamesCache.get(db);
  if (hit && hit.names && (at - hit.at) < ROLE_NAMES_TTL_MS) return hit.names;
  if (hit && hit.pending) return hit.pending;
  const read = async () => {
    const seen = new Set();
    for (const table of ['roles', 'access_codes']) {
      try {
        for (const r of await fetchAll(() => db.from(table).select('role'))) {
          const k = K(r.role);
          if (k) seen.add(k);
        }
      } catch (e) { /* table not there, or not readable -- the rate table's own rows still answer */ }
    }
    return [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  };
  const pending = read().then(names => { roleNamesCache.set(db, { at: Date.now(), names }); return names; },
    e => { if (roleNamesCache.get(db) && roleNamesCache.get(db).pending === pending) roleNamesCache.delete(db); throw e; });
  roleNamesCache.set(db, { at, pending });
  return pending;
}

export async function imprestRoles(db, user) {
  const rows = await readRoles_(db);
  if (rows === null) return { ok: true, roles: [], all: await readRoleNames_(db), notReady: true };
  return { ok: true,
    roles: rows.map(r => ({ role: K(r.role), rate: num(r.accommodation_per_day),
      by: r.updated_by || '', at: r.updated_at ? Date.parse(r.updated_at) : null }))
      .sort((a, b) => a.role < b.role ? -1 : a.role > b.role ? 1 : 0),
    all: await readRoleNames_(db) };
}

export async function imprestRoleSave(db, user, args) {
  const a = args || {};
  const role = K(a.role).slice(0, 60);
  if (!role) bad('Andika jina la wadhifa. / Enter a role name.');
  // Blank is not zero: a forgotten box must not become a role that sleeps for free.
  if (a.rate === '' || a.rate == null) bad('Andika kiwango cha malazi kwa siku (0 inaruhusiwa). / Enter the nightly rate (0 is allowed).');
  const rate = intNN(a.rate);
  if (rate === null) bad('Kiwango cha malazi lazima kiwe namba nzima. / The nightly rate must be a whole number.');
  const { error } = await db.from('imprest_roles')
    .upsert({ role, accommodation_per_day: rate, updated_at: new Date().toISOString(),
      updated_by: user.name || '' }, { onConflict: 'role' });
  if (error) { if (tableMissing(error)) bad(IMP_NOT_READY); throw new Error(error.message); }
  return { ok: true, role, rate };
}

export async function imprestRoleDelete(db, user, args) {
  const role = K(args && args.role);
  if (!role) bad('Chagua wadhifa. / Choose a role.');
  const { error } = await db.from('imprest_roles').delete().eq('role', role);
  if (error) { if (tableMissing(error)) bad(IMP_NOT_READY); throw new Error(error.message); }
  return { ok: true, role };
}

/* ---------------------------------------------------------------------------- THE READ SHAPE
   ONE SHAPE ON THE WIRE, the access code never on it -- same rule every other register here
   follows (see impRow in hoop-pmo, adjRow-style shaping in adjustments.js). */
const IMP_COLS = 'id, requested_at, staff_code, staff_name, staff_role, full_name, mobile, '
  + 'recipient_name, email, imprest_role, pay_mode, account_no, travel_date, destination, '
  + 'fare_trips, fare_per_trip, fare_amount, accom_days, accom_rate, accom_amount, '
  + 'other1_desc, other1_amount, other2_desc, other2_amount, other3_desc, other3_amount, '
  + 'total_amount, purpose, status, approved_amount, comment, decided_by, decided_at, decided_via_email, '
  + 'funded_amount, funded_by, funded_at, retired_at, retire_total, retire_balance';
/* THE ROUTING COLUMNS (db/RUN-ME-2026-11-05-imprest-opm-step.sql). Read and written only when the database has them: a
   deployment that has not run the migration keeps working exactly as before, every request going straight to the
   GM. `readRows_` below asks for the wide list first and falls back to the narrow one, remembering the answer. */
const RT_COLS = 'stage, routed_via, routed_names, routed_teams, routed_note, opm_by, opm_at, opm_amount, opm_comment';
const IMP_COLS_RT = IMP_COLS + ', ' + RT_COLS;
const IMP_RET_COLS = 'request_id, filed_at, filed_by_name, fare_actual, accom_actual, '
  + 'other1_actual, other2_actual, other3_actual, total_actual, notes, photo_count';

const impRow = (r, me) => ({
  id: String(r.id),
  at: r.requested_at ? Date.parse(r.requested_at) : null,
  mine: !!(me && r.staff_code && String(r.staff_code) === String(me)),
  staffName: r.staff_name || '', staffRole: r.staff_role || '',
  fullName: r.full_name || '', mobile: r.mobile || '', recipientName: r.recipient_name || '',
  email: r.email || '', imprestRole: r.imprest_role || '',
  payMode: r.pay_mode || '', accountNo: r.account_no || '',
  travelDate: r.travel_date ? String(r.travel_date).slice(0, 10) : '', destination: r.destination || '',
  fareTrips: num(r.fare_trips), farePerTrip: num(r.fare_per_trip), fareAmount: num(r.fare_amount),
  accomDays: num(r.accom_days), accomRate: num(r.accom_rate), accomAmount: num(r.accom_amount),
  other1Desc: r.other1_desc || '', other1Amount: num(r.other1_amount),
  other2Desc: r.other2_desc || '', other2Amount: num(r.other2_amount),
  other3Desc: r.other3_desc || '', other3Amount: num(r.other3_amount),
  total: num(r.total_amount), purpose: r.purpose || '',
  status: r.status || 'pending',
  approved: r.approved_amount == null ? null : Number(r.approved_amount),
  comment: r.comment || '', decidedBy: r.decided_by || '',
  decidedAt: r.decided_at ? Date.parse(r.decided_at) : null,
  decidedViaEmail: !!r.decided_via_email,
  fundedAmount: r.funded_amount == null ? null : Number(r.funded_amount),
  fundedBy: r.funded_by || '', fundedAt: r.funded_at ? Date.parse(r.funded_at) : null,
  /* FINISHED, not merely claimed -- retired_at is stamped first as the lock a filing takes,
     retire_total last when the receipts are in. Only the second makes a trip "retired"
     anywhere this row is read, so a filing that died half-way shows as not-retired everywhere
     at once. See imprestRetire. */
  retiredAt: (r.retired_at && r.retire_total != null) ? Date.parse(r.retired_at) : null,
  retireTotal: r.retire_total == null ? null : Number(r.retire_total),
  retireBalance: r.retire_balance == null ? null : Number(r.retire_balance),
  /* THE OPM STEP. stage 'opm' = waiting for the requester's OPM (the GM does not see it yet); 'gm' = with the GM,
     whether it never needed the OPM or the OPM has confirmed. routedNote says why a request that should have gone
     through the OPM went straight to the GM (nobody named, no sign-in) or that the GM released it. */
  stage: r.stage === 'opm' ? 'opm' : 'gm',
  routedVia: r.routed_via || '', routedNames: r.routed_names || '', routedNote: r.routed_note || '',
  opmBy: r.opm_by || '', opmAt: r.opm_at ? Date.parse(r.opm_at) : null,
  opmAmount: r.opm_amount == null ? null : Number(r.opm_amount), opmComment: r.opm_comment || '',
});

/* ONE IMPREST AT A TIME: NO NEW REQUEST WHILE AN APPROVED ONE IS UNRETIRED.

     "No more imprest requests with pending retirements per user, b/se people are just going
      further so if one requests and got unretired imprest, tell them to retire previous
      approved imprests first!"

   The rule, in one place: an APPROVED request whose retirement has not been FILED (retire_total
   still null -- the same test impRow's retiredAt makes, so "unretired" means the same thing on
   this refusal, on the requester's own page and on the GM's queue). A pending request does not
   block -- the money has not left the office -- and neither does a rejected one. Read raw, on
   the requester's own code, so a form that was sitting open cannot slip a second request past
   it: the check runs at the button, not when the page was drawn. */
const UNRETIRED_COLS = 'id, travel_date, destination, approved_amount, retired_at, retire_total';
async function unretiredOf_(db, code) {
  const rows = await fetchAll(() => db.from('imprest_requests').select(UNRETIRED_COLS)
    .eq('staff_code', code || '~none~').eq('status', 'approved').is('retire_total', null));
  return rows.sort((x, y) => String(x.travel_date || '').localeCompare(String(y.travel_date || '')));
}
const unretiredNote_ = rows => 'Una imprest ' + rows.length + ' iliyoidhinishwa bila retirement ('
  + rows.map(r => (r.travel_date ? String(r.travel_date).slice(0, 10) : '?') + (r.destination ? ' ' + r.destination : '')
    + ' · TZS ' + money0(num(r.approved_amount))).join('; ')
  + '). Retire hiyo kwanza, kisha omba. / You have ' + rows.length + ' approved imprest'
  + (rows.length === 1 ? '' : 's') + ' not yet retired. Retire the previous one first, then request.';

/* FUNDED BEFORE RETIRED: NO RETIREMENT ON AN IMPREST ACCOUNTS HAS NOT RECORDED AS FUNDED.

     "Am having a hard time to check in on the accountant (she ain't filling the funded amounts
      on imprests), so someone shouldn't be able to make retirement unless the imprest was
      funded -- hit them with 'you have 3 unfunded imprests, check the account to record them
      funded before you make the retirement!'"

   The retirement is the one step every traveller must take (the next request waits on it,
   above), so it is the one place a missing funded_amount is certain to be noticed -- by the
   person who can walk over to Accounts, rather than on a report nobody opens. The rule, in one
   place: an APPROVED request, not yet retired, whose funded_amount is still null -- the same
   null the report's toFund and the drawer's "bado / not yet" read, so "unfunded" means one
   thing everywhere. 0 is a recorded figure and opens the door. A retirement filed before this
   rule on money never recorded is not counted: nothing of theirs waits on it. The refusal
   counts the requester's whole debt, not the one row, so the sentence is the one the page
   shows (imprestMine) and the one the tap is refused with (imprestRetire). */
const isUnfunded_ = r => String(r.status) === 'approved' && r.funded_amount == null && r.retire_total == null;
const UNFUNDED_COLS = 'id, travel_date, destination, approved_amount, funded_amount, retire_total';
async function unfundedOf_(db, code) {
  const rows = await fetchAll(() => db.from('imprest_requests').select(UNFUNDED_COLS)
    .eq('staff_code', code || '~none~').eq('status', 'approved').is('funded_amount', null).is('retire_total', null));
  return rows.sort((x, y) => String(x.travel_date || '').localeCompare(String(y.travel_date || '')));
}
const unfundedNote_ = rows => {
  const n = rows.length, one = n === 1;
  return 'Una imprest ' + n + (one ? ' iliyoidhinishwa ambayo haijarekodiwa kuwa imelipwa (' : ' zilizoidhinishwa ambazo hazijarekodiwa kuwa zimelipwa (')
    + rows.map(r => (r.travel_date ? String(r.travel_date).slice(0, 10) : '?') + (r.destination ? ' ' + r.destination : '')
      + ' · TZS ' + money0(num(r.approved_amount))).join('; ')
    + '). Wasiliana na uhasibu ' + (one ? 'irekodiwe kuwa imelipwa' : 'zirekodiwe kuwa zimelipwa') + ', kisha jaza retirement. '
    + '/ You have ' + n + ' unfunded imprest' + (one ? '' : 's') + ': check with Accounts to record '
    + (one ? 'it' : 'them') + ' as funded before you file the retirement.';
};

/* ---------------------------------------------------------------------------- THE OPM STEP
     "GMOs and Managers imprests shouldn't go to GM directly ... I have to select which roles pass through which
      to get to GM at the imprest approvals tab, so I select those two and choose OPM role. When their respective
      OPM finds their requests in the Requests tab, the OPM confirms the request (may adjust the amount with a
      comment), then it proceeds to the approval tab / GM."

   THE RULE, in settings (IMPREST_ROUTES, edited on the approvals tab): [{ from: ['GMO','MANAGER'], via: 'OPM' }].
   A request by a code whose role is in `from` waits for the OPM and is NOT in the GM's queue, email or phone until
   an OPM confirms it. WHICH OPM: the OPM Teams & Staff names on the teams the requester holds (their GMO or Manager
   column, by name; their code's teams where the role has no column), and the OPM-role sign-ins that match -- by the
   same name, or by teams in common. Nobody found is never a dead end: the request goes straight to the GM with a
   note saying why, and the GM can always release a waiting one. The OPM may confirm LESS than was asked, with a
   comment; the GM then decides on that amount (and may still approve up to what was asked). */
const ROUTES_KEY = 'IMPREST_ROUTES';
const ROUTE_COL = { GMO: 'gmo', MANAGER: 'manager', CREDIT: 'credit', OPM: 'opm' };
const rtState = new WeakMap(), RT_RETRY_MS = 60 * 1000;
const rtMissing_ = e => {
  const s = String((e && (e.message || e.code)) || e || '');
  return /column\s+\S*\b(stage|routed_\w+|opm_\w+)\b\S*\s+does not exist/i.test(s) || /Could not find the '(stage|routed_\w+|opm_\w+)' column/i.test(s);
};
const rtNotReady_ = db => { const st = rtState.get(db); return !!(st && st.ready === false && Date.now() - st.at < RT_RETRY_MS); };
/** Imprest rows with the routing columns when the database has them, without when it has not. `build(cols)` makes the query. */
async function readRows_(db, build) {
  if (!rtNotReady_(db)) {
    try { const rows = await fetchAll(() => build(IMP_COLS_RT)); rtState.set(db, { ready: true }); return rows; }
    catch (e) { if (!rtMissing_(e)) throw e; rtState.set(db, { ready: false, at: Date.now() }); }
  }
  return fetchAll(() => build(IMP_COLS));
}
const routesCache = new WeakMap(), ROUTES_TTL_MS = 15 * 1000;
function parseRoutes_(raw) {
  try {
    const a = JSON.parse(String(raw || '[]'));
    return (Array.isArray(a) ? a : []).map(x => ({ from: [...new Set((Array.isArray(x && x.from) ? x.from : []).map(K).filter(Boolean))], via: K(x && x.via) }))
      .filter(x => x.from.length && x.via && !x.from.includes(x.via));
  } catch (e) { return []; }
}
async function readRoutes_(db) {
  const hit = routesCache.get(db);
  if (hit && Date.now() - hit.at < ROUTES_TTL_MS) return hit.routes;
  let routes = [];
  try {
    const { data } = await db.from('settings').select('value').eq('key', ROUTES_KEY).maybeSingle();
    routes = parseRoutes_(data && data.value);
  } catch (e) { routes = []; }
  routesCache.set(db, { at: Date.now(), routes });
  return routes;
}
const routeOf_ = (routes, role) => routes.find(r => r.from.includes(K(role))) || null;
const csv_ = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
const holder_ = (cell, name) => { const c = String(cell == null ? '' : cell).trim(); return !!c && (K(c) === K(name) || sameName(c, name)); };

/** Where a request by `user` has to go first, or null when nothing routes their role. */
async function resolveRoute_(db, user, routes) {
  const rule = routeOf_(routes, user.role);
  if (!rule) return null;
  const col = ROUTE_COL[K(user.role)] || null;
  let teamRows = [];
  try { teamRows = await fetchAll(() => db.from('teams').select(col && col !== 'opm' ? 'team, opm, ' + col : 'team, opm')); }
  catch (e) { if (!tableMissing(e)) throw e; }
  let mine = col ? teamRows.filter(t => holder_(t[col], user.name)) : [];
  if (!mine.length && user.teams && user.teams.length) { const own = new Set(user.teams.map(K)); mine = teamRows.filter(t => own.has(K(t.team))); }
  const teams = [...new Set(mine.map(t => String(t.team || '').trim()).filter(Boolean))];
  const names = [...new Set(mine.map(t => String(t.opm == null ? '' : t.opm).trim()).filter(n => n && !/^(NO[ -]|NONE$|N\/A$|-$|\(UNASSIGNED\))/i.test(n)))];
  let codes = [];
  try { codes = (await fetchAll(() => db.from('access_codes').select('code, name, role, teams'))).filter(c => K(c.role) === rule.via); }
  catch (e) { codes = []; }
  const mineSet = new Set(teams.map(K));
  const confirmers = codes.filter(c => names.some(n => holder_(c.name, n))
    || (Array.isArray(c.teams) && c.teams.length && c.teams.some(t => mineSet.has(K(t)))));
  let note = '';
  if (!teams.length) note = 'Hakuna timu zilizopatikana kwa mwombaji; imekwenda kwa GM moja kwa moja. / No teams found for the requester; it went straight to the GM.';
  else if (!confirmers.length) note = (names.length
    ? 'Hakuna kodi ya ' + rule.via + ' inayolingana na ' + names.join(', ')
    : 'Hakuna ' + rule.via + ' aliyetajwa kwenye timu hizi') + '; imekwenda kwa GM moja kwa moja. / '
    + (names.length ? 'No ' + rule.via + ' sign-in matches ' + names.join(', ') : 'No ' + rule.via + ' is named on these teams') + '; it went straight to the GM.';
  return { via: rule.via, teams, names, confirmers, note };
}
/** May this code confirm that waiting request? The right role, and the OPM named for it or a team in common. */
function canConfirm_(user, row) {
  if (!row || row.stage !== 'opm' || !row.routed_via || K(user.role) !== K(row.routed_via)) return false;
  if (csv_(row.routed_names).some(n => holder_(user.name, n))) return true;
  const own = new Set((user.teams || []).map(K));
  return own.size > 0 && csv_(row.routed_teams).some(t => own.has(K(t)));
}

/** The GM's email and phone nudge for a request that is now with them. Best effort, after the row exists. */
async function nudgeGm_(db, q, nowMs) {
  const links = await gmActionLinks_(db, q.id);
  const facts = [['Jina / Name', q.fullName], ['Wadhifa / Role', q.imprestRole], ['Safari / Travel', q.travelDate],
    ['Mahali / Destination', q.destination || '—'], ['Jumla / Total', q.total]];
  if (q.opmBy) facts.push(['OPM ' + q.opmBy, (q.opmAmount != null && q.opmAmount !== q.total ? 'amethibitisha ' + money0(q.opmAmount) + ' / confirmed ' + money0(q.opmAmount) : 'amethibitisha / confirmed') + (q.opmComment ? ' · ' + q.opmComment.slice(0, 200) : '')]);
  facts.push(['Madhumuni / Purpose', String(q.purpose || '').slice(0, 300)]);
  const html = noticeHtml('Ombi jipya la imprest / New imprest request', facts, '') + (links ? `<div style="margin-top:14px">
      ${noticeButton('Amua sasa / Decide now', links.decide, '#0B2A6B')}
      ${noticeButton('Fungua kwenye portal / Open in the portal', links.portal, '#334155')}
    </div>` : `<p style="color:#6b7280;font-size:12px">Fungua Idhini ya imprest kuamua. / Open the imprest approval pane to decide.</p>`);
  const shown = q.opmAmount != null ? q.opmAmount : q.total;
  const mail = await sendMail(db, { toKey: 'IMPREST_GM_EMAIL',
    subject: 'HOPE PMO — ombi la imprest / imprest request: ' + q.fullName + ' · ' + money0(shown) + ' TZS',
    html });
  /* THE SECOND NUDGE, TO THE PHONE -- "GM needs phone notifications whenever there is an imprest even if he logs in
     via browser". Every handset whose code holds the approval pane and has turned alerts on (the bell in the portal;
     api/_lib/push.js). Same standing as the email: after the row, under a clock, reported rather than depended on. */
  const push = await pushTopic(db, 'IMPREST', {
    title: 'Ombi jipya la imprest / New imprest request',
    body: q.fullName + ' · ' + money0(shown) + ' TZS · ' + q.travelDate + (q.destination ? ' · ' + q.destination : '') + (q.opmBy ? ' · OPM ' + q.opmBy : ''),
    url: '/dashboard?imp=' + encodeURIComponent(q.id),
    tag: 'imprest-' + q.id,
  }, { nowMs });
  return { mail, push };
}

/** THE ROUTING CARD'S DATA: the rules, the role names to pick from, and whether the migration has been run. */
export async function imprestRoutes(db, user) {
  const [routes, all] = await Promise.all([readRoutes_(db), readRoleNames_(db)]);
  let ready = rtState.get(db) ? rtState.get(db).ready === true : null;
  if (ready === null || ready === false) {
    try { const { error } = await db.from('imprest_requests').select('id, stage').limit(1); ready = !error || !rtMissing_(error) ? !error : false;
      rtState.set(db, ready ? { ready: true } : { ready: false, at: Date.now() }); } catch (e) { ready = false; }
  }
  return { ok: true, routes, roles: all, ready };
}
export async function imprestRoutesSave(db, user, args, nowMs, deps) {
  const list = Array.isArray(args && args.routes) ? args.routes : null;
  if (!list) bad('Chagua njia. / Choose the routes.');
  const seen = new Set(), out = [];
  for (const x of list) {
    const from = [...new Set((Array.isArray(x && x.from) ? x.from : []).map(K).filter(Boolean))].slice(0, 20), via = K(x && x.via).slice(0, 60);
    if (!from.length && !via) continue;
    if (!from.length) bad('Chagua wadhifa wa kupitisha. / Choose the roles that pass through.');
    if (!via) bad('Chagua wadhifa wa kupitia. / Choose the role they pass through.');
    if (from.includes(via)) bad('Wadhifa ' + via + ' hauwezi kupitia yenyewe. / ' + via + ' cannot pass through itself.');
    for (const r of from) { if (seen.has(r)) bad('Wadhifa ' + r + ' uko kwenye njia mbili. / ' + r + ' is in two routes.'); seen.add(r); }
    out.push({ from, via });
  }
  if (out.some(x => seen.has(x.via))) bad('Wadhifa wa kupitia hauwezi kuwa wa kupitishwa pia. / A role that others pass through cannot itself be routed.');
  const { error } = await db.from('settings').upsert({ key: ROUTES_KEY, value: JSON.stringify(out) }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  routesCache.set(db, { at: Date.now(), routes: out });
  if (deps && deps.noteSettingsWritten) deps.noteSettingsWritten(db);
  /* A ROUTE TAKEN AWAY DOES NOT MOVE A REQUEST ALREADY WAITING (its OPM was stamped on it), but the OPM's own list
     follows the rule in force -- so a waiting request whose OPM role is no longer routed to is stranded with an OPM
     who cannot see it. Say how many, here, so the GM releases them; a handful of rows, read once, on this save only. */
  let stranded = 0;
  if (!rtNotReady_(db)) {
    try {
      const vias = new Set(out.map(x => x.via));
      stranded = (await readRows_(db, cols => db.from('imprest_requests').select(cols).eq('status', 'pending').eq('stage', 'opm')))
        .filter(r => !vias.has(K(r.routed_via))).length;
    } catch (e) { stranded = 0; }
  }
  return { ok: true, routes: out, stranded };
}

/* --------------------------------------------------------------------------------- THE ASK
   "impRequest": staff_code is stamped from the SESSION, never trusted from the form; the
   accommodation rate is LOOKED UP from imprest_roles and stamped, never taken from the form's
   own preview figure, so a form left open across a rate change still prices at the rate that
   was in force when the button was pressed. */
export async function imprestRequest(db, user, args, nowMs) {
  const a = args || {};
  // The gate first, so a person who cannot ask is told that and not sent back for a comma.
  let owed;
  try { owed = await unretiredOf_(db, user.code); }
  catch (e) { if (!tableMissing(e)) throw e; bad(IMP_NOT_READY); }
  if (owed.length) bad(unretiredNote_(owed));
  const fullName = S_(a.fullName, 120);
  if (!fullName) bad('Andika jina kamili. / Enter your full name.');
  const email = S_(a.email, 160);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('Andika barua pepe sahihi. / Enter a valid email.');
  const imprestRole = K(a.imprestRole).slice(0, 60);
  if (!imprestRole) bad('Chagua wadhifa. / Choose a role.');
  const travelDate = S_(a.travelDate, 10);
  if (!isDay(travelDate)) bad('Weka tarehe ya safari. / Pick a travel date.');
  const purpose = S_(a.purpose, 2000);
  if (!purpose) bad('Andika madhumuni ya safari. / Describe the purpose of the trip.');

  const rateRows = await readRoles_(db);
  if (rateRows === null) bad(IMP_NOT_READY);
  const rateRow = rateRows.find(r => K(r.role) === imprestRole);
  /* THE REQUESTER'S OWN ROLE IS ALWAYS ACCEPTED -- "It must be of existing and of user logged
     in": the form opens on the signed-in code's role whether or not the approver has priced it,
     and a trip without nights (fare, fuel, meals) must not be refused for a rate it never uses.
     Nights are still never priced at zero (below), and any OTHER unpriced role is still refused:
     nobody borrows a rate by naming a role the approver has not set. */
  const ownRole = !rateRow && imprestRole === K(user.role);
  if (!rateRow && !ownRole) bad('Wadhifa huo hauna kiwango bado -- mwidhinishaji aweke kwanza. / That role has no rate yet; ask the approver to add it.');
  const accomRate = rateRow ? num(rateRow.accommodation_per_day) : 0;

  const fareTrips = intNN(a.fareTrips), farePerTrip = intNN(a.farePerTrip), accomDays = intNN(a.accomDays);
  if (fareTrips === null || farePerTrip === null || accomDays === null) {
    bad('Idadi na gharama lazima ziwe namba nzima. / Trips, fares and nights must be whole numbers.');
  }
  const others = [1, 2, 3].map(i => {
    const desc = S_(a['other' + i + 'Desc'], 120);
    const amt = intNN(a['other' + i + 'Amount']);
    if (amt === null) bad('Gharama nyingine lazima ziwe namba nzima. / Other amounts must be whole numbers.');
    if (amt > 0 && !desc) bad('Eleza gharama nyingine ' + i + '. / Describe other expense ' + i + '.');
    return { desc, amt };
  });
  if (accomDays > 0 && accomRate === 0) {
    bad(rateRow
      ? 'Wadhifa huu una kiwango cha malazi 0 -- mwidhinishaji aweke kiwango kwanza. / This role\'s nightly rate is 0; ask the approver to set it before claiming nights.'
      : 'Wadhifa wako hauna kiwango cha malazi bado -- mwidhinishaji aweke kwenye Idhini ya imprest -> Viwango, au weka siku 0. / Your role has no nightly rate yet -- the approver sets it under Imprest approval -> Rates, or claim 0 nights.');
  }
  const fareAmount = fareTrips * farePerTrip;
  const accomAmount = accomDays * accomRate;
  const total = fareAmount + accomAmount + others.reduce((s, o) => s + o.amt, 0);
  if (total <= 0) bad('Ombi halina gharama yoyote. / The request has no costs on it.');
  if ([fareAmount, accomAmount, total].some(v => v > MONEY_MAX)) {
    bad('Kiasi ni kikubwa kupita kiasi -- angalia namba. / The amount is implausibly large; check the figures.');
  }

  const at = new Date(nowMs || Date.now()).toISOString();
  const row = {
    // App-side id, so the row that comes back can be deleted without a second read -- the
    // database default still covers rows inserted straight through SQL. Same convention as
    // pmo_adjustments (adjustmentRecord in portal-core.js).
    id: (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'imp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
    requested_at: at, updated_at: at,
    staff_code: user.code || null, staff_name: user.name || '', staff_role: user.role || '',
    full_name: fullName, mobile: S_(a.mobile, 40), recipient_name: S_(a.recipientName, 120) || fullName,
    email, imprest_role: imprestRole, pay_mode: S_(a.payMode, 40), account_no: S_(a.accountNo, 80),
    travel_date: travelDate, destination: S_(a.destination, 120),
    fare_trips: fareTrips, fare_per_trip: farePerTrip, fare_amount: fareAmount,
    accom_days: accomDays, accom_rate: accomRate, accom_amount: accomAmount,
    other1_desc: others[0].desc || null, other1_amount: others[0].amt,
    other2_desc: others[1].desc || null, other2_amount: others[1].amt,
    other3_desc: others[2].desc || null, other3_amount: others[2].amt,
    total_amount: total, purpose, status: 'pending',
  };
  /* THROUGH THE OPM FIRST? Only when a rule names the requester's role AND the database has the routing columns; a
     request that cannot be routed (nobody named, no sign-in) still goes, to the GM, with the reason on it. */
  const routes = await readRoutes_(db);
  const rule = routes.length ? routeOf_(routes, user.role) : null;
  const notSwitchedOn = !!rule && rtNotReady_(db);          // meant to wait, and the database cannot hold the wait: say so
  const route = rule && !notSwitchedOn ? await resolveRoute_(db, user, routes) : null;
  const waiting = !!(route && !route.note);
  const routing = route ? { stage: waiting ? 'opm' : 'gm', routed_via: route.via, routed_names: route.names.join(', ') || null,
    routed_teams: route.teams.join(', ') || null, routed_note: route.note || null } : null;
  let ins = await db.from('imprest_requests').insert([routing ? { ...row, ...routing } : row]).select('id').maybeSingle();
  let routedOk = !!routing;
  if (ins.error && routing && rtMissing_(ins.error)) {
    // the migration is not run: remember it, and send the request the old way rather than lose it
    rtState.set(db, { ready: false, at: Date.now() }); routedOk = false;
    ins = await db.from('imprest_requests').insert([row]).select('id').maybeSingle();
  }
  const { data, error } = ins;
  if (error) { if (tableMissing(error)) bad(IMP_NOT_READY); throw new Error(error.message); }
  const id = data && data.id;
  const q = { id, fullName, imprestRole, travelDate, destination: row.destination, total, purpose };

  if (routedOk && waiting) {
    /* THE OPM'S NUDGE, not the GM's: the request waits for them. Each OPM sign-in that may confirm it hears on its
       own handset; the GM hears nothing until it is confirmed. */
    let pushed = 0, notes = [];
    for (const c of route.confirmers) {
      const pr = await pushCode(db, c.code, 'IMPREST_MINE', { title: 'Ombi linasubiri uthibitisho wako / A request needs your confirmation',
        body: fullName + ' · ' + money0(total) + ' TZS · ' + travelDate + (row.destination ? ' · ' + row.destination : ''),
        url: impLink_(id), tag: 'imprest-' + id + '-opm' }, { nowMs });
      pushed += pr.sent; if (pushNoteOf(pr)) notes.push(pushNoteOf(pr));
    }
    return { ok: true, id, total, accomRate, routed: { stage: 'opm', via: route.via, names: route.names }, emailed: false, emailNote: '',
      pushed, pushNote: notes.join(' · ') };
  }
  const nudge = await nudgeGm_(db, q, nowMs);
  // pushNote says so whenever a phone was NOT reached -- even when another one was.
  return { ok: true, id, total, accomRate, emailed: nudge.mail.sent, emailNote: nudge.mail.sent ? '' : nudge.mail.reason,
    pushed: nudge.push.sent, pushNote: pushNoteOf(nudge.push),
    routed: route && route.note ? { stage: 'gm', via: route.via, note: route.note } : null,
    routingNote: notSwitchedOn || (routing && !routedOk) ? 'Njia ya OPM haijawashwa (endesha db/RUN-ME-2026-11-05-imprest-opm-step.sql). / OPM routing is not switched on yet (run db/RUN-ME-2026-11-05-imprest-opm-step.sql).' : '' };
}
/* The deep link every imprest push carries: the portal lands on whichever imprest pane the
   code holds and opens the row (imprestOpenDeepLink_ in app.html). */
const impLink_ = id => '/dashboard?imp=' + encodeURIComponent(id);

/** The requester's own history, and only their own -- with the rate table so the form can
    offer roles without a second trip. */
export async function imprestMine(db, user) {
  let rows;
  try {
    rows = await readRows_(db, cols => db.from('imprest_requests').select(cols)
      .eq('staff_code', user.code || '~none~'));
  } catch (e) {
    if (!tableMissing(e)) throw e;
    return { ok: true, rows: [], roles: [], notReady: true };
  }
  const roles = await imprestRoles(db, user);
  /* The gate, said on the page before anyone types -- the SAME rows this history already holds,
     through the same test imprestRequest applies, so the form is closed exactly when the button
     would refuse. `unretired` carries the ids, `unretiredNote` the sentence the refusal uses. */
  const owed = rows.filter(r => String(r.status) === 'approved' && r.retire_total == null)
    .sort((x, y) => String(x.travel_date || '').localeCompare(String(y.travel_date || '')));
  /* The other gate, the same way: the retirements this page cannot open yet, through the test
     imprestRetire applies, in the sentence it refuses with. */
  const unfunded = rows.filter(isUnfunded_)
    .sort((x, y) => String(x.travel_date || '').localeCompare(String(y.travel_date || '')));
  /* WAITING FOR THIS PERSON TO CONFIRM: only asked when a rule routes requests through their role, and then one read
     of the waiting rows (a handful at any time), filtered to those they may confirm. */
  let confirm = [];
  const routes = await readRoutes_(db);
  if (routes.some(r => r.via === K(user.role)) && !rtNotReady_(db)) {
    try {
      const waitingRows = await readRows_(db, cols => db.from('imprest_requests').select(cols).eq('status', 'pending').eq('stage', 'opm'));
      confirm = waitingRows.filter(r => canConfirm_(user, r) && String(r.staff_code) !== String(user.code))
        .map(r => impRow(r, user.code)).sort((x, y) => (x.at || 0) - (y.at || 0));
    } catch (e) { if (!tableMissing(e) && !rtMissing_(e)) throw e; }
  }
  return { ok: true, roles: roles.roles || [],
    unretired: owed.map(r => String(r.id)),
    unretiredNote: owed.length ? unretiredNote_(owed) : '',
    unfunded: unfunded.map(r => String(r.id)),
    unfundedNote: unfunded.length ? unfundedNote_(unfunded) : '',
    confirm,
    rows: rows.map(r => impRow(r, user.code)).sort((x, y) => (y.at || 0) - (x.at || 0)) };
}

/** THE OPM CONFIRMS: the request goes on to the GM. The amount may be LOWER than asked (never higher: the requester
    asked for that much, and a higher figure is a new request), and a comment is required when it is. Guarded on the
    stage, so two OPMs for one request cannot both win. The GM is emailed and buzzed now, with the OPM's line on it,
    and the requester hears it is with the GM. */
export async function imprestConfirm(db, user, args, nowMs) {
  const a = args || {};
  const id = String(a.id || '').trim();
  if (!isUuid(id)) bad('Ombi halijachaguliwa. / No request chosen.');
  let rows;
  try { rows = await readRows_(db, cols => db.from('imprest_requests').select(cols).eq('id', id)); }
  catch (e) { if (!tableMissing(e)) throw e; bad(IMP_NOT_READY); }
  const row = rows.find(r => String(r.id) === id);
  if (!row) bad('Ombi halipo. / That request no longer exists.');
  if (row.stage !== 'opm' || String(row.status) !== 'pending') bad('Ombi hili halisubiri uthibitisho tena. / That request is no longer waiting for confirmation.');
  if (!canConfirm_(user, row)) bad('Ombi hili si la kuthibitisha na wewe: ni la ' + (row.routed_names || row.routed_via) + '. / That request is not yours to confirm: it waits for ' + (row.routed_names || row.routed_via) + '.');
  if (String(row.staff_code) === String(user.code)) bad('Huwezi kuthibitisha ombi lako mwenyewe. / You cannot confirm your own request.');
  const asked = num(row.total_amount);
  const amount = a.amount == null || a.amount === '' ? asked : intNN(a.amount);
  if (amount === null || amount <= 0) bad('Kiasi lazima kiwe namba nzima. / The amount must be a whole number.');
  if (amount > asked) bad('Huwezi kuthibitisha zaidi ya kilichoombwa (' + money0(asked) + '). / You cannot confirm more than was asked (' + money0(asked) + ').');
  const comment = S_(a.comment, 1000);
  if (amount !== asked && !comment) bad('Andika sababu ya kubadilisha kiasi. / A comment is required when the amount is changed.');
  const at = new Date(nowMs || Date.now()).toISOString();
  const { data, error } = await db.from('imprest_requests').update({ stage: 'gm', opm_by: user.name || '', opm_at: at, opm_amount: amount,
    opm_comment: comment || null, updated_at: at }).eq('id', id).eq('stage', 'opm').eq('status', 'pending').select('id');
  if (error) throw new Error(error.message);
  if (!data || !data.length) bad('Ombi hili limethibitishwa na mtu mwingine sasa hivi. / Somebody else just confirmed this one.');
  const q = { id, fullName: row.full_name || row.staff_name, imprestRole: row.imprest_role || '', travelDate: String(row.travel_date || '').slice(0, 10),
    destination: row.destination || '', total: asked, purpose: row.purpose || '', opmBy: user.name || '', opmAmount: amount, opmComment: comment };
  const nudge = await nudgeGm_(db, q, nowMs);
  const mine = await pushCode(db, row.staff_code, 'IMPREST_MINE', {
    title: 'OPM amethibitisha ombi lako / Your OPM confirmed your request',
    body: (amount !== asked ? money0(amount) + ' TZS (ulioomba ' + money0(asked) + ') · ' : '') + 'sasa liko kwa GM / now with the GM', url: impLink_(id), tag: 'imprest-' + id + '-opm-ok' }, { nowMs });
  return { ok: true, id, amount, asked, adjusted: amount !== asked, emailed: nudge.mail.sent, emailNote: nudge.mail.sent ? '' : nudge.mail.reason,
    pushed: nudge.push.sent + mine.sent, pushNote: pushNoteOf(nudge.push, mine) };
}

/** THE GM'S OVERRIDE: take a request out of the OPM's hands (the OPM is away, or the request cannot wait). */
export async function imprestRelease(db, user, args, nowMs) {
  const id = String(args && args.id || '').trim();
  if (!isUuid(id)) bad('Ombi halijachaguliwa. / No request chosen.');
  let rows;
  try { rows = await readRows_(db, cols => db.from('imprest_requests').select(cols).eq('id', id)); }
  catch (e) { if (!tableMissing(e)) throw e; bad(IMP_NOT_READY); }
  const row = rows.find(r => String(r.id) === id);
  if (!row) bad('Ombi halipo. / That request no longer exists.');
  if (row.stage !== 'opm' || String(row.status) !== 'pending') bad('Ombi hili halisubiri OPM. / That request is not waiting for the OPM.');
  const at = new Date(nowMs || Date.now()).toISOString();
  const note = 'Imeachiliwa kwa GM na ' + (user.name || '') + ' / Released to the GM by ' + (user.name || '');
  const { data, error } = await db.from('imprest_requests').update({ stage: 'gm', routed_note: note, updated_at: at }).eq('id', id).eq('stage', 'opm').eq('status', 'pending').select('id');
  if (error) throw new Error(error.message);
  if (!data || !data.length) bad('Ombi hili limebadilika sasa hivi. / That request just changed.');
  const nudge = await nudgeGm_(db, { id, fullName: row.full_name || row.staff_name, imprestRole: row.imprest_role || '', travelDate: String(row.travel_date || '').slice(0, 10),
    destination: row.destination || '', total: num(row.total_amount), purpose: row.purpose || '' }, nowMs);
  return { ok: true, id, emailed: nudge.mail.sent, pushed: nudge.push.sent };
}

/** THE GM's QUEUE. Every request, pending first; the counts are over the whole table so they
    do not move as the list is narrowed.

    THE COUNTS ARE FOUR HEAD COUNTS, NOT A WHOLE-TABLE READ -- same idiom as stageCounts() in
    portal-core.js: a count sends no rows, and the KPI strip needs exactly four of them
    (pending/approved/rejected/toRetire), never the wide free-text columns (purpose, comment)
    that IMP_COLS carries. Only the subset the caller actually asked for (the frontend defaults
    to 'pending' -- see IMPQ_STATE in app.html) is fetched with full columns; an unrecognised or
    blank `state` still means "all", exactly as it always has, so a whole-book request still
    reads the whole book -- just once, not five times over. */
export async function imprestQueue(db, user, args) {
  const a = args || {};
  const want = String(a.state || '').trim();

  const headCount = async build => {
    const { count, error } = await runQuery(build);
    if (error) throw error;
    return count || 0;
  };
  /* WAITING FOR THE OPM is not the GM's to decide: it is counted apart and left out of 'pending'. The count that
     tells whether the database has the routing columns comes first, so a database without them reads exactly as
     it always did.

     IT IS A READ THAT RETURNS ROWS (one at most), NOT A HEAD COUNT. A head request has no body, so when the column is
     missing the refusal comes back with no words at all (`{ message: '' }`): it cannot be told from any other failure
     and, rethrown, it is what the approvals tab printed as "[object Object]". A get carries PostgREST's message
     ("column ... does not exist"), which rtMissing_ recognises. And the probe never takes the tab down: whatever
     goes wrong in it, the pane is drawn the old way (nothing waits, nothing is left out of pending). */
  let waiting = 0, routed = false;
  if (!rtNotReady_(db)) {
    try {
      const res = await runQuery(() => db.from('imprest_requests')
        .select('id', { count: 'exact' }).eq('status', 'pending').eq('stage', 'opm').limit(1));
      if (res.error) throw res.error;
      waiting = res.count || 0;
      routed = true; rtState.set(db, { ready: true });
    } catch (e) {
      /* rtMissing_ FIRST: tableMissing matches any "does not exist", a missing COLUMN included. */
      if (rtMissing_(e)) rtState.set(db, { ready: false, at: Date.now() });
      else if (tableMissing(e)) return { ok: true, rows: [], notReady: true, counts: { pending: 0, approved: 0, rejected: 0, toRetire: 0, waiting: 0 } };
      waiting = 0; routed = false;
    }
  }
  let counts;
  try {
    counts = {
      pending: await headCount(() => { let q = db.from('imprest_requests')
        .select('id', { count: 'exact', head: true }).eq('status', 'pending'); return routed ? q.neq('stage', 'opm') : q; }),
      approved: await headCount(() => db.from('imprest_requests')
        .select('id', { count: 'exact', head: true }).eq('status', 'approved')),
      rejected: await headCount(() => db.from('imprest_requests')
        .select('id', { count: 'exact', head: true }).eq('status', 'rejected')),
      toRetire: await headCount(() => db.from('imprest_requests')
        .select('id', { count: 'exact', head: true }).eq('status', 'approved').is('retired_at', null)),
      waiting,
    };
  } catch (e) {
    if (!tableMissing(e)) throw e;
    return { ok: true, rows: [], notReady: true, counts: { pending: 0, approved: 0, rejected: 0, toRetire: 0, waiting: 0 } };
  }

  let rows;
  try {
    /* "With the OPM" on a database that cannot hold a wait (or whose probe above failed) is simply empty: asking it to
       filter on a column it may not have would be a read that fails, and "tables not created" would be the wrong thing
       to say about it. */
    rows = want === 'waiting' && !routed ? [] : await readRows_(db, cols => {
      let q = db.from('imprest_requests').select(cols);
      if (want === 'pending') { q = q.eq('status', 'pending'); if (routed) q = q.neq('stage', 'opm'); }
      else if (want === 'waiting') q = q.eq('status', 'pending').eq('stage', 'opm');
      else if (want === 'decided') q = q.neq('status', 'pending');
      else if (want === 'toRetire') q = q.eq('status', 'approved').is('retired_at', null);
      return q;
    });
  } catch (e) {
    if (!tableMissing(e)) throw e;
    return { ok: true, rows: [], notReady: true, counts };
  }
  const shown = rows.map(r => impRow(r, user.code));
  return { ok: true, counts, routed,
    rows: shown.sort((x, y) => (x.status === 'pending' && x.stage !== 'opm' ? 0 : 1) - (y.status === 'pending' && y.stage !== 'opm' ? 0 : 1)
      || (y.at || 0) - (x.at || 0)) };
}

/** APPROVE (possibly for less) OR REJECT, with a comment required to reject.
    THE ONE FUNCTION BOTH DOORS CALL -- the portal (a signed-in code holding impappr) and the
    emailed one-tap link (a synthetic user holding exactly that tab, minted in
    api/imprest-action.js after its token checks out). `args.viaEmail` is set only by that
    second door, and only ever moves the row from `false`; nothing a portal caller sends can
    forge it, because tabGate_ never lets that caller through the email door's user object. */
export async function imprestDecide(db, user, args, nowMs) {
  const a = args || {};
  const id = String(a.id || '').trim();
  if (!isUuid(id)) bad('Ombi halijachaguliwa. / No request chosen.');
  const approve = a.approve === true;
  const comment = String(a.comment || '').trim().slice(0, 1000);
  if (!approve && !comment) bad('Andika sababu ya kukataa. / A comment is required when rejecting.');
  let rows;
  try {
    rows = await readRows_(db, cols => db.from('imprest_requests').select(cols).eq('id', id));
  } catch (e) {
    if (!tableMissing(e)) throw e;
    bad(IMP_NOT_READY);
  }
  const row = rows.find(r => String(r.id) === id);
  if (!row) bad('Ombi halipo. / That request no longer exists.');
  if (String(row.status) !== 'pending') bad('Ombi hili tayari limeamuliwa. / That request has already been decided.');
  if (row.stage === 'opm') bad('Ombi hili bado linasubiri OPM (' + (row.routed_names || row.routed_via || '') + ') kulithibitisha. Liachilie kwanza ukitaka kuamua. / That request is still waiting for the OPM (' + (row.routed_names || row.routed_via || '') + ') to confirm it. Release it first if you want to decide it now.');
  const asked = num(row.total_amount);
  let granted = null;
  if (approve) {
    // the OPM's confirmed amount is what the GM starts from; the GM may still approve up to what was asked
    granted = a.approvedAmount == null ? (row.opm_amount != null ? num(row.opm_amount) : asked) : intNN(a.approvedAmount);
    if (granted === null || granted <= 0) bad('Kiasi cha kuidhinisha lazima kiwe namba nzima. / The approved amount must be a whole number.');
    if (granted > asked) bad('Huwezi kuidhinisha zaidi ya kilichoombwa. / You cannot approve more than was requested.');
  }
  const at = new Date(nowMs || Date.now()).toISOString();
  const patch = { status: approve ? 'approved' : 'rejected', approved_amount: approve ? granted : null,
    comment: comment || null, decided_by: user.name || '', decided_at: at, updated_at: at,
    decided_via_email: !!a.viaEmail };
  // Guarded on status so two decisions racing (the portal and the email link, say) cannot both win.
  const { data, error } = await db.from('imprest_requests')
    .update(patch).eq('id', id).eq('status', 'pending').select('id');
  if (error) throw new Error(error.message);
  if (!data || !data.length) bad('Ombi hili limeamuliwa na mtu mwingine sasa hivi. / Somebody else just decided this one.');

  const facts = [['Jina / Name', row.full_name || row.staff_name], ['Wadhifa / Role', row.imprest_role || ''],
    ['Safari / Travel', String(row.travel_date || '').slice(0, 10)], ['Mahali / Destination', row.destination || '—'],
    ['Kiliombwa / Requested', asked], ['Uamuzi / Decision', approve ? 'IMEIDHINISHWA · ' + money0(granted) + ' TZS' : 'IMEKATALIWA'],
    ['Maoni / Comment', comment || '—'], ['Aliyeamua / Decided by', (user.name || '') + (a.viaEmail ? ' (barua pepe / email)' : '')]]
    .concat(row.opm_by ? [['OPM ' + row.opm_by, (row.opm_amount != null ? money0(row.opm_amount) + ' TZS' : 'amethibitisha / confirmed') + (row.opm_comment ? ' · ' + row.opm_comment : '')]] : []);
  const requester = await sendMail(db, { to: row.email,
    subject: 'HOPE PMO — ombi lako la imprest / your imprest request: ' + (approve ? 'imeidhinishwa / approved' : 'imekataliwa / rejected'),
    html: noticeHtml('Ombi lako la imprest / Your imprest request', facts,
      approve ? 'Ukifika, jaza retirement na picha za risiti. / On arrival, file the retirement with receipt photos.'
              : 'Wasiliana na GM ukihitaji maelezo. / Speak to the GM if you need more.') });
  /* THE PHONES: the requester hears the decision on their own handset; an approval also
     reaches the accountant, whose next move it is. "all imprest processes send browser /
     device notifications." */
  const who = row.full_name || row.staff_name || '';
  const travel = String(row.travel_date || '').slice(0, 10);
  const mine = await pushCode(db, row.staff_code, 'IMPREST_MINE', {
    title: approve ? 'Imprest yako imeidhinishwa / Your imprest: approved' : 'Imprest yako imekataliwa / Your imprest: rejected',
    body: (approve ? money0(granted) + ' TZS' : (comment || '').slice(0, 80)) + ' · ' + travel,
    url: impLink_(id), tag: 'imprest-' + id + '-decided',
  }, { nowMs });
  const fund = approve ? await pushTopic(db, 'IMPREST_FUND', {
    title: 'Imprest imeidhinishwa — inasubiri kutolewa / Approved, to be funded',
    body: who + ' · ' + money0(granted) + ' TZS · ' + travel,
    url: impLink_(id), tag: 'imprest-' + id + '-fund',
  }, { nowMs }) : null;
  return { ok: true, id, status: patch.status, granted,
    emailed: { requester: requester.sent }, emailNote: requester.sent ? '' : requester.reason,
    pushed: mine.sent + (fund ? fund.sent : 0), pushNote: pushNoteOf(mine, fund) };
}

/** THE RETIREMENT. Own request, approved, not yet retired; once, ever. Ported from hoop-pmo's
    imprest almost unchanged -- the claim-then-finish order below is already correct and the
    reasoning does not change for HOPE.

    ORDER OF WRITES -- THE REQUEST IS THE LOCK, AND IT IS TAKEN FIRST.
      1. CLAIM: stamp retired_at on the request, guarded on it being null. Of two overlapping
         presses exactly one matches the row; the other matches nothing and is told so.
         retire_total stays null, which is what "claimed, not finished" means everywhere.
      2. The retirement row, then the photos.
      3. FINISH: stamp retire_total and the balance, guarded on OUR claim stamp.
    A press that died between 1 and 3 leaves a claim with no summary. It is resumable ONLY once
    the claim is older than any serverless function can live (RETIRE_CLAIM_MS): the same
    requester re-claims -- guarded on the stale stamp, so two resumers cannot both win --
    clears the wreckage under it, and writes again. A young claim reads as "being filed, try
    again in a minute", never wreckage; a finished retirement is refused before any of this. */
const RETIRE_CLAIM_MS = 2 * 60 * 1000;
const IMP_PHOTO_MAX_BYTES = 200 * 1024;
const IMP_PHOTO_MAX = 3;
const IMP_PHOTO_MIN_BYTES = 1024;
function photoBytes(s) {
  const v = String(s || '');
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(v);
  if (!m || !m[2]) return null;
  const b64 = m[2];
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor(b64.length * 3 / 4) - pad;
}
export async function imprestRetire(db, user, args, nowMs) {
  const a = args || {};
  const id = String(a.id || '').trim();
  if (!isUuid(id)) bad('Ombi halijachaguliwa. / No request chosen.');
  let rows;
  try {
    rows = await fetchAll(() => db.from('imprest_requests').select(IMP_COLS).eq('id', id));
  } catch (e) {
    if (!tableMissing(e)) throw e;
    bad(IMP_NOT_READY);
  }
  const row = rows.find(r => String(r.id) === id);
  if (!row || String(row.staff_code || '') !== String(user.code || '')) bad('Ombi halipo. / That request no longer exists.');
  if (String(row.status) !== 'approved') bad('Retirement ni ya ombi lililoidhinishwa tu. / Only an approved request can be retired.');
  if (row.retire_total != null) bad('Ombi hili tayari lina retirement. / This request has already been retired.');
  /* FUNDED BEFORE RETIRED (unfundedOf_ above), ahead of the form so a person who cannot retire
     is told that and not sent back for a receipt. Decided on the row already in hand; the list
     behind the sentence is read only on the way to a refusal, so a retirement that goes through
     costs no read it did not cost before. Read fresh, on the requester's code: if Accounts
     recorded the money between the page and the tap, the row is no longer on the list and the
     retirement goes through. */
  if (isUnfunded_(row)) {
    const owed = await unfundedOf_(db, user.code);
    if (owed.some(r => String(r.id) === id)) bad(unfundedNote_(owed));
  }

  const fare = intNN(a.fareActual), accom = intNN(a.accomActual);
  const o1 = intNN(a.other1Actual), o2 = intNN(a.other2Actual), o3 = intNN(a.other3Actual);
  if ([fare, accom, o1, o2, o3].some(v => v === null)) {
    bad('Gharama halisi lazima ziwe namba nzima. / Actual costs must be whole numbers.');
  }
  const photos = Array.isArray(a.photos) ? a.photos.filter(p => String(p || '').trim()) : [];
  if (!photos.length) bad('Weka angalau picha moja ya risiti (bora 3). / Attach at least one receipt photo (ideally 3).');
  if (photos.length > IMP_PHOTO_MAX) bad('Picha ni 3 zaidi. / At most 3 photos.');
  const sized = photos.map(p => ({ data: String(p), bytes: photoBytes(p) }));
  if (sized.some(p => p.bytes === null)) bad('Picha moja si picha halali (JPEG/PNG). / One photo is not a valid image.');
  if (sized.some(p => p.bytes > IMP_PHOTO_MAX_BYTES)) {
    bad('Picha moja ni kubwa mno (zaidi ya ' + Math.round(IMP_PHOTO_MAX_BYTES / 1024) + 'KB). Ipunguze kisha jaribu tena. '
      + '/ One photo is too large; shrink it and try again.');
  }
  if (sized.some(p => p.bytes < IMP_PHOTO_MIN_BYTES)) bad('Picha moja ni ndogo mno kuwa risiti. / One photo is too small to be a receipt.');
  const total = fare + accom + o1 + o2 + o3;
  if (total > MONEY_MAX) bad('Kiasi ni kikubwa kupita kiasi -- angalia namba. / The amount is implausibly large; check the figures.');
  const approved = num(row.approved_amount);
  const balance = approved - total;
  const at = new Date(nowMs || Date.now()).toISOString();

  const busy = () => bad('Retirement ya ombi hili inaendelea kuwasilishwa -- jaribu tena baada ya dakika moja. '
    + '/ This retirement is being filed right now; try again in a minute.');
  let claim = await db.from('imprest_requests')
    .update({ retired_at: at, updated_at: at })
    .eq('id', id).eq('status', 'approved').is('retired_at', null).select('id');
  if (claim.error) throw new Error(claim.error.message);
  if (!claim.data || !claim.data.length) {
    const dead = row.retired_at && (Date.now() - Date.parse(row.retired_at)) > RETIRE_CLAIM_MS;
    if (!dead) busy();
    claim = await db.from('imprest_requests')
      .update({ retired_at: at, updated_at: at })
      .eq('id', id).eq('retired_at', row.retired_at).is('retire_total', null).select('id');
    if (claim.error) throw new Error(claim.error.message);
    if (!claim.data || !claim.data.length) busy();
    for (const t of ['imprest_photos', 'imprest_retirements']) {
      const { error } = await db.from(t).delete().eq('request_id', id);
      if (error) throw new Error(error.message);
    }
  }
  const dup = err => /duplicate|unique|23505/i.test(String((err && (err.message || err.code)) || ''));
  const { error: rErr } = await db.from('imprest_retirements').insert([{
    request_id: id, filed_at: at, filed_by_code: user.code || null, filed_by_name: user.name || '',
    fare_actual: fare, accom_actual: accom, other1_actual: o1, other2_actual: o2, other3_actual: o3,
    total_actual: total, notes: String(a.notes || '').trim().slice(0, 1000) || null, photo_count: sized.length }]);
  if (rErr) {
    if (tableMissing(rErr)) bad(IMP_NOT_READY);
    if (dup(rErr)) busy();
    throw new Error(rErr.message);
  }
  const { error: pErr } = await db.from('imprest_photos').insert(
    sized.map((p, i) => ({ request_id: id, seq: i + 1, data: p.data, bytes: p.bytes })));
  if (pErr) { if (dup(pErr)) busy(); throw new Error(pErr.message); }
  const { data: done, error: uErr } = await db.from('imprest_requests')
    .update({ retire_total: total, retire_balance: balance, updated_at: at })
    .eq('id', id).eq('retired_at', at).select('id');
  if (uErr) throw new Error(uErr.message);
  if (!done || !done.length) busy();
  /* THE PHONES: a retirement is the approver's to review and the accountant's to reconcile. */
  const note = {
    title: 'Retirement ya imprest imewasilishwa / Imprest retirement filed',
    body: (row.full_name || row.staff_name || user.name || '') + ' · ' + money0(total) + ' TZS'
      + ' · salio / balance ' + money0(balance) + ' TZS',
    url: impLink_(id), tag: 'imprest-' + id + '-retired',
  };
  const toAppr = await pushTopic(db, 'IMPREST', note, { nowMs });
  const toFund = await pushTopic(db, 'IMPREST_FUND', note, { nowMs });
  return { ok: true, id, total, approved, balance, photos: sized.length,
    pushed: toAppr.sent + toFund.sent, pushNote: pushNoteOf(toAppr, toFund) };
}

/** The receipts for ONE request, on demand -- a requester sees only their own; a holder of
    impappr or imprep sees any. The caller has already checked FN_TAB (impreq/impappr/imprep);
    this narrows further, exactly as hoop-pmo's impPhotos does. */
export async function imprestPhotos(db, user, args) {
  const id = String((args && args.id) || '').trim();
  if (!isUuid(id)) bad('Ombi halijachaguliwa. / No request chosen.');
  const reviewer = (user.tabs || []).includes('impappr') || (user.tabs || []).includes('imprep');
  if (!reviewer) {
    let own;
    try {
      own = await fetchAll(() => db.from('imprest_requests').select('id, staff_code').eq('id', id));
    } catch (e) {
      if (!tableMissing(e)) throw e;
      return { ok: true, photos: [], notReady: true };
    }
    const r = own.find(x => String(x.id) === id);
    if (!r || String(r.staff_code || '') !== String(user.code || '')) bad('Ombi halipo. / That request no longer exists.');
  }
  let rows;
  try {
    rows = await fetchAll(() => db.from('imprest_photos').select('seq, data, bytes').eq('request_id', id));
  } catch (e) {
    if (!tableMissing(e)) throw e;
    return { ok: true, photos: [] };
  }
  return { ok: true, photos: rows.map(p => ({ seq: num(p.seq), data: p.data, bytes: num(p.bytes) }))
    .sort((x, y) => x.seq - y.seq) };
}

/** THE REPORT: every request in a period, with its retirement beside it -- filtered on TRAVEL
    DATE, same as every other period filter in this system reads by the trip rather than by
    the click. Held by imprep: the GM's own review copy and the accountant's funding desk.

    THE RANGE GOES INTO THE QUERY, not into a filter run after the whole table has crossed the
    wire -- imprest_requests_travel_date_idx (db/RUN-ME-031-imprest.sql) exists for exactly
    this. imprest_retirements is then read AFTER imprest_requests, scoped to the narrowed set's
    own ids: a period never needs a retirement for a request outside it, and this table only
    ever grows. A genuine "whole book" request -- neither `from` nor `to` given -- still reads
    both tables whole, same as it always has; there is nothing to narrow by. */
export async function imprestReport(db, user, args) {
  const a = args || {};
  const from = isDay(a.from) ? String(a.from) : null;
  const to = isDay(a.to) ? String(a.to) : null;
  const want = String(a.status || '').trim();

  let rows, rets;
  try {
    if (from || to) {
      rows = await readRows_(db, cols => {
        let q = db.from('imprest_requests').select(cols);
        if (from) q = q.gte('travel_date', from);
        if (to) q = q.lte('travel_date', to);
        return q;
      });
      const ids = rows.map(r => String(r.id));
      rets = ids.length
        ? await fetchAll(() => db.from('imprest_retirements').select(IMP_RET_COLS).in('request_id', ids))
        : [];
    } else {
      [rows, rets] = await Promise.all([
        readRows_(db, cols => db.from('imprest_requests').select(cols)),
        fetchAll(() => db.from('imprest_retirements').select(IMP_RET_COLS)),
      ]);
    }
  } catch (e) {
    if (!tableMissing(e)) throw e;
    return { ok: true, rows: [], notReady: true, totals: {} };
  }
  const retBy = new Map(rets.map(r => [String(r.request_id), r]));
  const inPeriod = rows.map(r => impRow(r, user.code))
    .filter(r => !from || (r.travelDate && r.travelDate >= from))
    .filter(r => !to || (r.travelDate && r.travelDate <= to))
    .map(r => {
      const t = r.retiredAt ? retBy.get(r.id) : null;
      return Object.assign(r, { retirement: t ? {
        at: t.filed_at ? Date.parse(t.filed_at) : null, by: t.filed_by_name || '',
        fare: num(t.fare_actual), accom: num(t.accom_actual),
        other1: num(t.other1_actual), other2: num(t.other2_actual), other3: num(t.other3_actual),
        total: num(t.total_actual), notes: t.notes || '', photos: num(t.photo_count) } : null });
    });
  const shown = inPeriod.filter(r => {
    if (want === 'retired') return !!r.retiredAt;
    if (want === 'toRetire') return r.status === 'approved' && !r.retiredAt;
    if (want === 'toFund') return r.status === 'approved' && r.fundedAmount == null;
    return !['pending', 'approved', 'rejected'].includes(want) || r.status === want;
  }).sort((x, y) => (y.at || 0) - (x.at || 0));
  const approvedRows = inPeriod.filter(r => r.status === 'approved');
  return { ok: true, rows: shown,
    totals: {
      count: inPeriod.length,
      pending: inPeriod.filter(r => r.status === 'pending' && r.stage !== 'opm').length,
      waiting: inPeriod.filter(r => r.status === 'pending' && r.stage === 'opm').length,
      rejected: inPeriod.filter(r => r.status === 'rejected').length,
      approved: approvedRows.length,
      approvedAmount: approvedRows.reduce((s, r) => s + (r.approved || 0), 0),
      funded: approvedRows.filter(r => r.fundedAmount != null).length,
      fundedAmount: approvedRows.reduce((s, r) => s + (r.fundedAmount || 0), 0),
      toFund: approvedRows.filter(r => r.fundedAmount == null).length,
      retired: approvedRows.filter(r => r.retiredAt).length,
      toRetire: approvedRows.filter(r => !r.retiredAt).length,
      spent: approvedRows.reduce((s, r) => s + (r.retiredAt ? (r.retireTotal || 0) : 0), 0),
      toRefund: approvedRows.reduce((s, r) => s + (r.retireBalance != null && r.retireBalance > 0 ? r.retireBalance : 0), 0),
      toReimburse: approvedRows.reduce((s, r) => s + (r.retireBalance != null && r.retireBalance < 0 ? -r.retireBalance : 0), 0),
    } };
}

/** THE ACCOUNTANT'S ONLY WRITE. "they will just update funded amount in imprest report tab" --
    one number, on an approved row, as many times as it needs correcting (a part-payment
    followed by the rest is the ordinary case, not an edge case, so this is not a once-only
    lock the way a retirement claim is). Not gated on status beyond "approved" existing: an
    accountant funding ahead of the paperwork catching up is a timing question for them to
    answer, not one this function should refuse to record. */
export async function imprestFund(db, user, args, nowMs) {
  const a = args || {};
  const id = String(a.id || '').trim();
  if (!isUuid(id)) bad('Ombi halijachaguliwa. / No request chosen.');
  const amount = intNN(a.amount);
  if (amount === null) bad('Kiasi kilicholipwa lazima kiwe namba nzima (0 inaruhusiwa). / The funded amount must be a whole number (0 is allowed).');
  let rows;
  try {
    rows = await fetchAll(() => db.from('imprest_requests').select('id, status, staff_code, travel_date').eq('id', id));
  } catch (e) {
    if (!tableMissing(e)) throw e;
    bad(IMP_NOT_READY);
  }
  const row = rows.find(r => String(r.id) === id);
  if (!row) bad('Ombi halipo. / That request no longer exists.');
  if (String(row.status) !== 'approved') bad('Kiasi kilicholipwa kinawekwa kwa maombi yaliyoidhinishwa tu. / The funded amount can only be recorded against an approved request.');
  const at = new Date(nowMs || Date.now()).toISOString();
  const { error } = await db.from('imprest_requests')
    .update({ funded_amount: amount, funded_by: user.name || '', funded_at: at, updated_at: at })
    .eq('id', id);
  if (error) throw new Error(error.message);
  /* THE PHONE: the requester hears that the money left -- the one step they are waiting on. */
  const mine = await pushCode(db, row.staff_code, 'IMPREST_MINE', {
    title: 'Imprest yako imetolewa / Your imprest was funded',
    body: money0(amount) + ' TZS · ' + String(row.travel_date || '').slice(0, 10),
    url: impLink_(id), tag: 'imprest-' + id + '-funded',
  }, { nowMs });
  return { ok: true, id, amount, pushed: mine.sent, pushNote: pushNoteOf(mine) };
}

/* ==================================================================== THE EMAIL ACTION LINKS
   "gm gets email that has the details and two links (single tap approval and disapproval or
   read)" / "so gm can approve through email or system by the current implementation".

   ONE SIGNED TOKEN PER REQUEST, not per action: the GET link opens a small confirmation page
   that shows the request and offers Idhinisha and Kataa as two buttons -- each a deliberate
   second tap that POSTs -- rather than a bare GET that mutates the moment it is fetched. That
   second tap is the whole reason this is safe to call "single tap" at all: an email client's
   own link-preview fetch, a corporate scanner that "clicks" every link to check it for
   malware, or Gmail's image proxy would otherwise be able to approve or reject a real cash
   request by themselves, silently, the instant the message is delivered -- a GET that mutates
   is exactly the shape of bug the old spreadsheet-era system carried (its `?action=
   approveInstantly` link) and is not something to repeat with real money behind it. The
   confirmation page is the fix: reading it costs nothing and decides nothing; only the button
   press does.

   THE TOKEN NAMES THE REQUEST AND NOTHING ELSE, so the same link works for "read" and for
   either decision -- HMAC-SHA256 of the id, keyed on IMPREST_LINK_SECRET (an env var, a
   secret, so never a Settings row -- same rule as DEVICE_SHIFT_SECRET). Unset, imprestRequest
   simply does not print the Decide button and the email still carries a plain deep link into
   the portal ("Fungua kwenye portal"), because email staying useful without every knob turned
   on is the same "courtesy, never the dependency" rule the rest of this file follows. */
export function imprestActionToken(id) {
  const secret = String(process.env.IMPREST_LINK_SECRET || '').trim();
  if (!secret) return null;
  return createHmac('sha256', secret).update('imprest:' + String(id)).digest('hex');
}
export function imprestVerifyToken(id, token) {
  const want = imprestActionToken(id);
  const given = String(token || '');
  if (!want || given.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(want));
}
async function appBaseUrl_(db) {
  try {
    const { data } = await db.from('settings').select('value').eq('key', 'APP_BASE_URL').maybeSingle();
    return String((data && data.value) || '').trim().replace(/\/+$/, '');
  } catch (e) { return ''; }
}
/** The two links the new-request email carries, or null when either half (the base URL, or
    the link secret) is not configured -- see the note above. */
async function gmActionLinks_(db, id) {
  const base = await appBaseUrl_(db);
  const token = imprestActionToken(id);
  if (!base || !token) return null;
  return {
    decide: base + '/api/imprest-action?id=' + encodeURIComponent(id) + '&token=' + token,
    portal: base + '/?imp=' + encodeURIComponent(id),
  };
}
/** The confirmation page's own data -- exactly what a GET must never do more than read. Used
    by api/imprest-action.js, which has no `user` and reaches this table directly rather than
    through portalApi (a GM has proven nothing about who they are yet at a GET; the token
    proves only that the link is genuine, which is enough to READ, never enough by itself to
    decide -- deciding still goes through imprestDecide with a scoped synthetic user, see
    api/imprest-action.js). */
export async function imprestActionRow(db, id) {
  let rows;
  try {
    rows = await readRows_(db, cols => db.from('imprest_requests').select(cols).eq('id', id));
  } catch (e) {
    if (tableMissing(e)) return null;
    throw e;
  }
  const row = rows.find(r => String(r.id) === String(id));
  return row ? impRow(row, null) : null;
}
