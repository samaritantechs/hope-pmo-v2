import { fetchAll } from './supabase.js';
import { teamAllowed } from './auth.js';
import { todayKey, currentWeekday, isoWeekday, weekMondayKey, addDaysKey } from './time.js';
import { latestSnapshot, snapshotsInRange } from './snapshots.js';
import { collectedOf, uncollectedOf, num } from './recovery.js';
import { buildDashboard } from './dashboard-core.js';
import { reportCoreForPortal } from './call-core.js';

/** Every read and write behind the portal (public/app.html), one function per tab, all
    team-scoped through the same teamAllowed the rest of the system uses. Ported from the
    api_* family in the live Code.gs: the SHAPES the portal consumes are what matter, and
    each function below is the v2 query that produces the same answer the sheets did.

    Everything runs against an injected `db`, so the whole surface is testable against the
    fake PostgREST client without a network. */

const K = s => String(s == null ? '' : s).trim().toUpperCase();
const scoped = (user, rows) => rows.filter(r => teamAllowed(user, r.team));

/* ------------------------------------------------------------------ loans (applications) */
const STAGES = ['unassigned', 'assigned', 'unassessed', 'assessed', 'pending_approval', 'approved', 'pending_disb', 'disbursed'];

async function loans(db, user, { stage }) {
  const st = STAGES.includes(stage) ? stage : 'approved';
  const rows = await fetchAll(() => db.from('loans').select('*').eq('stage', st).order('created_at', { ascending: false }));
  const mine = scoped(user, rows);
  return { stage: st, stages: STAGES, rows: mine, count: mine.length,
    amount: mine.reduce((s, r) => s + (num(r.principal_amt) || num(r.requested_amt) || num(r.loan_amt)), 0) };
}

/** Counts for every stage in one pass -- the applications tab's pipeline strip. */
async function loanPipeline(db, user) {
  const rows = scoped(user, await fetchAll(() => db.from('loans').select('team, stage, principal_amt, requested_amt, loan_amt')));
  const by = {};
  for (const st of STAGES) by[st] = { stage: st, count: 0, amount: 0 };
  for (const r of rows) {
    const b = by[r.stage];
    if (!b) continue;
    b.count++;
    b.amount += num(r.principal_amt) || num(r.requested_amt) || num(r.loan_amt);
  }
  return { stages: STAGES.map(s => by[s]) };
}

/* ------------------------------------------------------------------ expected repayment */
async function expected(db, user, { type = 'today', date }, nowMs) {
  const snap = await latestSnapshot(db, 'repayment_snapshots', { snapshot_type: type },
    date ? { onDate: date } : { notAfter: todayKey(nowMs) });
  const rows = scoped(user, snap.rows).map(r => ({ ...r, collected: collectedOf(r) }));
  const expectedAmt = rows.reduce((s, r) => s + num(r.payment_expected), 0);
  const collected = rows.reduce((s, r) => s + r.collected, 0);
  const status = {};
  for (const r of rows) { const k = K(r.todays_status) || '(BLANK)'; status[k] = (status[k] || 0) + 1; }
  return {
    type, date: snap.date, rows, count: rows.length,
    totals: { expected: expectedAmt, collected, uncollected: uncollectedOf(rows),
      pct: expectedAmt > 0 ? Math.round((collected / expectedAmt) * 1000) / 10 : null },
    byStatus: Object.keys(status).sort().map(k => ({ status: k, count: status[k] })),
  };
}

/* ------------------------------------------------------------------ defaulters */
async function defaulters(db, user, { type = 'current', weekday, date }, nowMs) {
  const wd = weekday || currentWeekday(nowMs);
  const snap = await latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: type, weekday: wd },
    date ? { onDate: date } : { notAfter: todayKey(nowMs) });
  const rows = scoped(user, snap.rows);
  return { type, weekday: wd, date: snap.date, rows, count: rows.length,
    arrears: rows.reduce((s, r) => s + num(r.arrears), 0) };
}

/** Expected Defaulters -- the WEEKLY CYCLE, not a one-day list. Every defaulter is visited
    twice a week and the two days are derived from the loan itself: the weekday it was
    disbursed on (Day 1) and three days later (Day 2), with Sunday rolled onto Monday because
    nobody works Sunday. That is why the tab is a Mon-Sat set of day tabs with a distribution
    across them -- a customer appears under two of the six.

    Each row also carries the recycling leader who currently owns the customer, because the
    officer working this list needs to know who else is already on them. */
const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function rollSun(u) { return u === 7 ? 1 : u; }        // Sunday -> Monday
async function expectedDefaulters(db, user, _args, nowMs) {
  const [def, teamRows, strat] = await Promise.all([
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current', weekday: currentWeekday(nowMs) }, { notAfter: todayKey(nowMs) }),
    fetchAll(() => db.from('teams').select('*')),
    assignStrategy(db),
  ]);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  const rows = scoped(user, def.rows)
    .filter(d => { const s = K(d.status); return s.includes('CHRON') || s.includes('EXPIR') || s.includes('DEFAULT'); })
    .map(d => {
      const raw = d.disb_date ? isoWeekday(Date.parse(String(d.disb_date) + 'T00:00:00Z')) : 0;
      const primary = raw ? rollSun(raw) : 0;
      const secondary = primary ? rollSun(((primary - 1 + 3) % 7) + 1) : 0;
      const a = assignFor(d, strat, nowMs);
      const s = K(d.status);
      const team = teamBy[K(d.team)] || {};
      return { ref: d.ref, full_name: d.full_name, contact: d.contact, team: d.team,
        arrears: num(d.arrears), balance: num(d.balance), ds: d.ds, dc: d.dc,
        status: s.includes('CHRON') ? 'CHRONIC' : (s.includes('EXPIR') ? 'EXPIRED' : 'DEFAULTER'),
        disb_date: d.disb_date,
        primary, secondary,
        primaryName: DAY_NAMES[primary] || '—', secondaryName: DAY_NAMES[secondary] || '—',
        phase: a.phase, role: a.role, cycle: a.label,
        leader: team[ROLE_COLS[a.role]] || '(unassigned)' };
    });
  // Each customer counts on BOTH of their days, so the distribution sums to 2x the headcount.
  // Day 0 holds anyone whose loan carries no disbursement date: they cannot be placed on a
  // weekday, and the live system simply dropped them from the cycle. Silently losing a
  // defaulter is the one outcome this tab must never produce, so they get their own bucket
  // and their own tab instead of disappearing.
  const dist = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const r of rows) {
    if (!r.primary) { dist[0]++; continue; }
    dist[r.primary]++;
    if (dist[r.secondary] != null) dist[r.secondary]++;
  }
  return { rows, count: rows.length, dist, dayNames: DAY_NAMES,
    unplaced: dist[0],
    todayIndex: rollSun(isoWeekday(nowMs)),
    teams: [...new Set(rows.map(r => r.team).filter(Boolean))].sort(),
    chronic: rows.filter(r => r.status === 'CHRONIC').length,
    expired: rows.filter(r => r.status === 'EXPIRED').length,
    arrears: rows.reduce((s, r) => s + r.arrears, 0) };
}

/* ------------------------------------------------------------------ followup + comments */
async function followup(db, user) {
  const rows = scoped(user, await fetchAll(() => db.from('followup_status').select('*').order('arrears', { ascending: false })));
  // Pure FK stubs (created so an Expected customer's comment can be stored) are not defaulters.
  const real = rows.filter(r => !(r.status == null && r.arrears == null));
  return { rows: real, count: real.length, arrears: real.reduce((s, r) => s + num(r.arrears), 0) };
}

async function comments(db, user, { ref }) {
  if (!ref) throw badRequest('ref is required');
  const { data: st } = await db.from('followup_status').select('team').eq('ref', String(ref)).maybeSingle();
  if (st && !teamAllowed(user, st.team)) throw forbidden(`You do not have access to team ${st.team}.`);
  const { data, error } = await db.from('followup_comments').select('*').eq('ref', String(ref)).order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return { rows: data || [] };
}

const FU_NEED_DATE = ['AMETOA AHADI'];
const FU_NEED_COMMENT = ['AMETUMA KWA AFISA', 'REJESHO LIMELIWA', 'OTHERS'];
const FU_NEED_NUMBER = ['ANA NAMBA NYINGINE'];

async function addComment(db, user, p, nowMs) {
  const ref = String((p && p.ref) || '').trim();
  if (!ref) throw badRequest('ref is required');
  const { data: st } = await db.from('followup_status').select('team').eq('ref', ref).maybeSingle();
  if (st && !teamAllowed(user, st.team)) throw forbidden(`You do not have access to team ${st.team}.`);
  const fu = p.fuStatus || p.fu || '';
  // Same three rules as the calls app and Code.gs -- enforced server-side, not just in the UI.
  if (FU_NEED_DATE.includes(fu) && !p.promiseDate) throw badRequest('A promise date is required for "Ametoa Ahadi".');
  if (FU_NEED_COMMENT.includes(fu) && !p.comment) throw badRequest('A comment is required for that follow-up status.');
  if (FU_NEED_NUMBER.includes(fu) && !p.newNumber) throw badRequest('A new phone number is required for "Ana namba nyingine".');
  const now = new Date(nowMs).toISOString();
  await db.from('followup_status').upsert({ ref, team: p.team || null, full_name: p.fullName || null }, { onConflict: 'ref', ignoreDuplicates: true });
  const { error: cErr } = await db.from('followup_comments').insert({
    ref, docket_no: p.docketNo || null, team: p.team || null, full_name: p.fullName || null,
    comment: p.comment || null, fu_status: fu || null, promise_date: p.promiseDate || null,
    promise_amt: p.promiseAmt || null, new_number: p.newNumber || null, created_by: user.name, created_at: now,
  });
  if (cErr) throw new Error(cErr.message);
  const { error: uErr } = await db.from('followup_status').update({
    fu_status: fu || null, promise_date: p.promiseDate || null, promise_amt: p.promiseAmt || null,
    last_comment: p.comment || null, comment_by: user.name, comment_at: now, updated_at: now,
  }).eq('ref', ref);
  if (uErr) throw new Error(uErr.message);
  return { ref, savedAt: now };
}

/** Promise to Pay: everyone who said AMETOA AHADI, bucketed against today so overdue
    promises surface first -- the whole point of the tab. */
/** Promise to Pay. A promise is only worth anything if you can see whether it was KEPT, so
    each row carries the arrears the customer had when they promised beside what they owe now
    -- and a customer who has left the defaulter deck entirely reads CLEARED rather than 0. */
async function promises(db, user, { from, to } = {}, nowMs) {
  const today = todayKey(nowMs);
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? from : null;
  const toKey = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? to : null;
  const [all, cm, curSnap] = await Promise.all([
    fetchAll(() => db.from('followup_status').select('*').eq('fu_status', 'AMETOA AHADI')),
    fetchAll(() => db.from('followup_comments').select('*').eq('fu_status', 'AMETOA AHADI')),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current', weekday: currentWeekday(nowMs) }, { notAfter: today }),
  ]);
  const stillOwing = {};
  for (const d of curSnap.rows) stillOwing[K(d.ref)] = num(d.arrears);
  // The comment that CREATED the promise is where "arrears before" and "who took it" live.
  const firstCm = {};
  for (const c of cm.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (!firstCm[K(c.ref)]) firstCm[K(c.ref)] = c;
  }
  const rows = scoped(user, all).map(r => {
    const k = K(r.ref);
    const cleared = !Object.prototype.hasOwnProperty.call(stillOwing, k);
    const curArr = cleared ? 0 : stillOwing[k];
    const arrBefore = num(r.arrears);
    return { ...r,
      arrears_before: arrBefore, arrears_now: curArr, cleared,
      recovered: Math.max(0, arrBefore - curArr),
      taken_by: (firstCm[k] && firstCm[k].created_by) || r.comment_by || null,
      taken_at: (firstCm[k] && firstCm[k].created_at) || r.comment_at || null,
      bucket: !r.promise_date ? 'no date' : String(r.promise_date) < today ? 'overdue'
        : String(r.promise_date) === today ? 'today' : 'upcoming' };
  }).filter(r => {
    if (fromKey && !(r.promise_date && String(r.promise_date) >= fromKey)) return false;
    if (toKey && !(r.promise_date && String(r.promise_date) <= toKey)) return false;
    return true;
  });
  const order = { overdue: 0, today: 1, upcoming: 2, 'no date': 3 };
  rows.sort((a, b) => (order[a.bucket] - order[b.bucket]) || String(a.promise_date || '').localeCompare(String(b.promise_date || '')));
  const counts = { overdue: 0, today: 0, upcoming: 0, 'no date': 0 };
  for (const r of rows) counts[r.bucket]++;
  return { rows, count: rows.length, counts, from: fromKey, to: toKey,
    cleared: rows.filter(r => r.cleared).length,
    recovered: rows.reduce((s, r) => s + r.recovered, 0),
    teams: [...new Set(rows.map(r => r.team).filter(Boolean))].sort(),
    promised: rows.reduce((s, r) => s + num(r.promise_amt), 0) };
}

/** Followup Report: who logged what, and what is still untouched. Counts by follow-up
    status and by officer over the comment history in the window. */
async function followupReport(db, user, { from, to }, nowMs) {
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? from : addDaysKey(todayKey(nowMs), -7);
  const toKey = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? to : todayKey(nowMs);
  const [fu, cm] = await Promise.all([
    fetchAll(() => db.from('followup_status').select('*')),
    fetchAll(() => db.from('followup_comments').select('*')
      .gte('created_at', fromKey).lte('created_at', toKey + 'T23:59:59.999Z')),
  ]);
  const mineFu = scoped(user, fu).filter(r => !(r.status == null && r.arrears == null));
  const mineCm = scoped(user, cm);
  const byStatus = {}, byOfficer = {}, byTeam = {};
  for (const r of mineFu) {
    const k = K(r.fu_status) || '(NOT TOUCHED)';
    if (!byStatus[k]) byStatus[k] = { status: k, customers: 0, arrears: 0 };
    byStatus[k].customers++; byStatus[k].arrears += num(r.arrears);
    const t = r.team || '(no team)';
    if (!byTeam[t]) byTeam[t] = { team: t, customers: 0, touched: 0, arrears: 0 };
    byTeam[t].customers++; byTeam[t].arrears += num(r.arrears);
    if (r.fu_status) byTeam[t].touched++;
  }
  for (const c of mineCm) {
    const who = c.created_by || '(unknown)';
    if (!byOfficer[who]) byOfficer[who] = { officer: who, comments: 0, customers: {} };
    byOfficer[who].comments++; byOfficer[who].customers[String(c.ref)] = 1;
  }
  // The report the supervisor actually reads is a MATRIX: one row per officer, one column per
  // follow-up status, so "who is logging what" is answerable at a glance instead of by
  // cross-referencing two summary tables. And under it, every individual follow-up -- the log
  // is the evidence; the counts above are only the index into it.
  const statuses = [...new Set(mineCm.map(c => K(c.fu_status)).filter(Boolean))].sort();
  const matrix = {};
  for (const c of mineCm) {
    const who = c.created_by || '(unknown)';
    const b = bucket(matrix, who, { total: 0, by: {} });
    b.total++;
    const st = K(c.fu_status) || '—';
    b.by[st] = (b.by[st] || 0) + 1;
  }
  const byOfficerStatus = Object.values(matrix)
    .map(b => ({ officer: b.key, total: b.total, ...Object.fromEntries(statuses.map(s => [s, b.by[s] || 0])) }))
    .sort((a, b) => b.total - a.total);

  const log = mineCm.slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(c => ({ at: c.created_at, by: c.created_by || '(unknown)', team: c.team, ref: c.ref,
      full_name: c.full_name, fu_status: c.fu_status, promise_date: c.promise_date,
      promise_amt: num(c.promise_amt), comment: c.comment }));

  return {
    from: fromKey, to: toKey,
    byStatus: Object.values(byStatus).sort((a, b) => b.customers - a.customers),
    byTeam: Object.values(byTeam).sort((a, b) => a.team.localeCompare(b.team)),
    byOfficer: Object.values(byOfficer).map(o => ({ officer: o.officer, comments: o.comments, customers: Object.keys(o.customers).length }))
      .sort((a, b) => b.comments - a.comments),
    statuses, byOfficerStatus, rows: log,
    officers: [...new Set(log.map(r => r.by))].sort(),
    teams: [...new Set(log.map(r => r.team).filter(Boolean))].sort(),
    totals: { customers: mineFu.length, touched: mineFu.filter(r => r.fu_status).length, comments: mineCm.length },
  };
}

/* ------------------------------------------------------------------ operational registers */
async function listTable(db, user, table, order = 'created_at') {
  const rows = await fetchAll(() => db.from(table).select('*').order(order, { ascending: false }));
  const mine = scoped(user, rows);
  return { rows: mine, count: mine.length };
}

async function complaints(db, user) {
  const r = await listTable(db, user, 'complaints');
  const open = r.rows.filter(x => K(x.status) !== 'CLOSED' && K(x.status) !== 'RESOLVED').length;
  return { ...r, open };
}
async function addComplaint(db, user, p, nowMs) {
  if (!p || !p.complainant) throw badRequest('A complainant name is required.');
  const { data, error } = await db.from('complaints').insert({
    ref: p.ref || null, team: p.team || null, complainant: p.complainant, phone: p.phone || null,
    category: p.category || null, channel: p.channel || null, details: p.details || null,
    status: 'Open', logged_by: user.name, created_at: new Date(nowMs).toISOString(),
  }).select('*');
  if (error) throw new Error(error.message);
  return { row: (data && data[0]) || null };
}
async function resolveComplaint(db, user, p, nowMs) {
  if (!p || !p.id) throw badRequest('id is required');
  const { error } = await db.from('complaints').update({
    status: p.status || 'Resolved', resolution: p.resolution || null,
    resolved_by: user.name, resolved_at: new Date(nowMs).toISOString(),
  }).eq('id', p.id);
  if (error) throw new Error(error.message);
  return { id: p.id };
}

async function restructures(db, user) {
  const r = await listTable(db, user, 'restructures');
  return { ...r, pending: r.rows.filter(x => K(x.status) === 'PENDING').length };
}
async function addRestructure(db, user, p, nowMs) {
  if (!p || !p.ref) throw badRequest('ref is required');
  const { data, error } = await db.from('restructures').insert({
    ref: p.ref, team: p.team || null, full_name: p.fullName || null, contact: p.contact || null,
    guarantor: p.guarantor || null, guarantor_contact: p.guarantorContact || null,
    arrears: p.arrears || null, dc: p.dc || null, first_inst: p.firstInst || null,
    remaining: p.remaining || null, interest_on: p.interestOn || null, interest_amt: p.interestAmt || null,
    total: p.total || null, installments: p.installments || null, inst_amt: p.instAmt || null,
    start_date: p.startDate || null, status: 'Pending', requested_by: user.name,
    notes: p.notes || null, created_at: new Date(nowMs).toISOString(),
  }).select('*');
  if (error) throw new Error(error.message);
  return { row: (data && data[0]) || null };
}
async function decideRestructure(db, user, p, nowMs) {
  if (!p || !p.id) throw badRequest('id is required');
  const approve = String(p.decision || '').toLowerCase() === 'approve';
  const { error } = await db.from('restructures').update({
    status: approve ? 'Approved' : 'Rejected',
    approved_by: user.name, approved_at: new Date(nowMs).toISOString(),
    reject_reason: approve ? null : (p.reason || null),
  }).eq('id', p.id);
  if (error) throw new Error(error.message);
  return { id: p.id, status: approve ? 'Approved' : 'Rejected' };
}

async function demandNotices(db, user) { return listTable(db, user, 'demand_notices'); }
async function addDemandNotice(db, user, p, nowMs) {
  if (!p || !p.ref) throw badRequest('ref is required');
  const { data, error } = await db.from('demand_notices').insert({
    ref: p.ref, team: p.team || null, full_name: p.fullName || null, contact: p.contact || null,
    notice_date: p.noticeDate || todayKey(nowMs), notice_days: p.noticeDays || null,
    paid_count: p.paidCount || null, fine: p.fine || null,
    principal_remaining: p.principalRemaining || null, total_demand: p.totalDemand || null,
    arrears_at_notice: p.arrears || null, other_inst: p.otherInst || null,
    issued_by: user.name, created_at: new Date(nowMs).toISOString(),
  }).select('*');
  if (error) throw new Error(error.message);
  return { row: (data && data[0]) || null };
}

async function abnormal(db, user) { return listTable(db, user, 'abnormal_payments'); }

async function received(db, user, { from, to }, nowMs) {
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? from : weekMondayKey(nowMs);
  const toKey = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? to : todayKey(nowMs);
  const rows = scoped(user, await fetchAll(() => db.from('received_payments').select('*').gte('paid_at', fromKey).lte('paid_at', toKey)));
  return { from: fromKey, to: toKey, rows, count: rows.length,
    amount: rows.reduce((s, r) => s + num(r.amount_paid), 0) };
}

/* ------------------------------------------------------------------ analytics tabs */
/** Portfolio at Risk: the current deck bucketed by how long each customer has been in
    arrears (dc = days count), plus a status split. Buckets follow the classic PAR bands. */
const PAR_BANDS = [
  { key: '1-30', lo: 1, hi: 30 }, { key: '31-60', lo: 31, hi: 60 },
  { key: '61-90', lo: 61, hi: 90 }, { key: '91-180', lo: 91, hi: 180 },
  { key: '180+', lo: 181, hi: Infinity },
];
/** PAR is read two ways and the live system showed BOTH: by how long a customer has been in
    arrears (the ageing bands above) and by how big their loan is (the principal bands below).
    The second is the one the meeting acts on -- it says where the overdue money is
    concentrated -- and it was missing here entirely. */
const PRINCIPAL_BANDS = [
  { label: '< 500K', lo: 0, hi: 500000 },
  { label: '500K – 1M', lo: 500000, hi: 1000000 },
  { label: '1M – 2M', lo: 1000000, hi: 2000000 },
  { label: '2M – 3M', lo: 2000000, hi: 3000000 },
  { label: '3M – 5M', lo: 3000000, hi: 5000000 },
  { label: '≥ 5M', lo: 5000000, hi: Infinity },
];
/** Principal behind a defaulter row with the interest stripped: the schedule runs 12
    installments and carries 36% interest, so principal = (first + 11 × other) ÷ 1.36. Falls
    back to the outstanding balance when the schedule columns are blank. */
function principalOf(r) {
  const total = num(r.initial_inst) + 11 * num(r.other_inst);
  return total > 0 ? Math.round(total / 1.36) : num(r.balance);
}
/** Installments paid, read the way the sheet did: "3/6" in D.S, else derived from what has
    actually been paid against the schedule. */
function paidCount(r) {
  const m = String(r.ds == null ? (r.due_summary == null ? '' : r.due_summary) : r.ds).trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return Math.min(12, Math.max(0, Number(m[1])));
  const initial = num(r.initial_inst), other = num(r.other_inst), paid = num(r.t_payment);
  let pc = 0;
  if (other > 0 && paid >= initial) pc = 1 + Math.floor((paid - initial) / other);
  return Math.min(12, Math.max(0, pc));
}

async function par(db, user, _args, nowMs) {
  const snap = await latestSnapshot(db, 'defaulter_snapshots',
    { snapshot_type: 'current', weekday: currentWeekday(nowMs) }, { notAfter: todayKey(nowMs) });
  const rows = scoped(user, snap.rows);
  const bands = PAR_BANDS.map(b => ({ band: b.key, customers: 0, arrears: 0 }));
  const pbands = PRINCIPAL_BANDS.map(b => ({ band: b.label, customers: 0, arrears: 0, balance: 0, loanSum: 0 }));
  const byStatus = {}, byTeam = {};
  let totArrears = 0, totBalance = 0, totLoan = 0;
  for (const r of rows) {
    const days = num(r.days_elapsed) || num(r.dc);
    const i = PAR_BANDS.findIndex(b => days >= b.lo && days <= b.hi);
    if (i >= 0) { bands[i].customers++; bands[i].arrears += num(r.arrears); }
    const arr = num(r.arrears), bal = num(r.balance), loan = principalOf(r);
    const j = PRINCIPAL_BANDS.findIndex(b => loan >= b.lo && loan < b.hi);
    if (j >= 0) { pbands[j].customers++; pbands[j].arrears += arr; pbands[j].balance += bal; pbands[j].loanSum += loan; }
    totArrears += arr; totBalance += bal; totLoan += loan;
    const st = r.status || '(none)';
    if (!byStatus[st]) byStatus[st] = { status: st, customers: 0, arrears: 0 };
    byStatus[st].customers++; byStatus[st].arrears += arr;
    const t = r.team || '(no team)';
    if (!byTeam[t]) byTeam[t] = { team: t, customers: 0, arrears: 0, balance: 0, loanSum: 0 };
    byTeam[t].customers++; byTeam[t].arrears += arr; byTeam[t].balance += bal; byTeam[t].loanSum += loan;
  }
  const finish = b => ({ customers: b.customers, arrears: b.arrears, balance: b.balance,
    avgLoan: b.customers ? Math.round(b.loanSum / b.customers) : 0,
    par: pctOf(b.arrears, b.balance), share: pctOf(b.arrears, totArrears) });
  return { date: snap.date, weekday: currentWeekday(nowMs), bands,
    byBand: pbands.map(b => ({ band: b.band, ...finish(b) })),
    byStatus: Object.values(byStatus).sort((a, b) => b.arrears - a.arrears),
    byTeam: Object.values(byTeam).map(t => ({ team: t.team, ...finish(t) })).sort((a, b) => b.arrears - a.arrears),
    totals: { customers: rows.length, arrears: totArrears, balance: totBalance,
      avgLoan: rows.length ? Math.round(totLoan / rows.length) : 0, par: pctOf(totArrears, totBalance) } };
}

/** Weekly report: Mon-Fri collection per day plus the week's recovery and sales, all
    scoped -- the same numbers the dashboard shows, laid out by day. */
async function weekly(db, user, { weekOf }, nowMs) {
  const mon = /^\d{4}-\d{2}-\d{2}$/.test(String(weekOf)) ? weekOf : weekMondayKey(nowMs);
  const fri = addDaysKey(mon, 4);
  const [expAll, defAll, loansAll, rcvAll] = await Promise.all([
    snapshotsInRange(db, 'repayment_snapshots', { snapshot_type: 'today' }, mon, fri),
    snapshotsInRange(db, 'defaulter_snapshots', {}, mon, fri),
    fetchAll(() => db.from('loans').select('team, principal_amt, loan_amt, approved_date').eq('stage', 'approved').gte('approved_date', mon).lte('approved_date', addDaysKey(mon, 6))),
    fetchAll(() => db.from('received_payments').select('team, amount_paid, paid_at').gte('paid_at', mon).lte('paid_at', addDaysKey(mon, 6))),
  ]);
  const days = [];
  for (let i = 0; i < 5; i++) {
    const date = addDaysKey(mon, i);
    const dayRows = scoped(user, expAll.filter(r => String(r.snapshot_date) === date));
    const ini = scoped(user, defAll.filter(r => String(r.snapshot_date) === date && r.snapshot_type === 'initial'));
    const cur = scoped(user, defAll.filter(r => String(r.snapshot_date) === date && r.snapshot_type === 'current'));
    const exp = dayRows.reduce((s, r) => s + num(r.payment_expected), 0);
    const col = dayRows.reduce((s, r) => s + collectedOf(r), 0);
    days.push({
      date, weekday: ['MON', 'TUE', 'WED', 'THU', 'FRI'][i],
      customers: dayRows.length, expected: exp, collected: col, uncollected: uncollectedOf(dayRows),
      pct: exp > 0 ? Math.round((col / exp) * 1000) / 10 : null,
      recovered: (ini.length && cur.length) ? ini.reduce((s, r) => s + num(r.arrears), 0) - cur.reduce((s, r) => s + num(r.arrears), 0) : 0,
      received: scoped(user, rcvAll.filter(r => String(r.paid_at) === date)).reduce((s, r) => s + num(r.amount_paid), 0),
    });
  }
  const sales = scoped(user, loansAll);

  /* The weekly report is read PER TEAM, in five sections -- Sales, Count 1-6, Collection,
     Recovery and Ongezeko la deni (debt movement). The day strip above answers "how did the
     week go"; these answer "which team". Ongezeko compares Monday's initial deck against the
     week-end current one, so a positive change means debt FELL. */
  const [teamRows, monIni, endCur] = await Promise.all([
    fetchAll(() => db.from('teams').select('*')),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'initial', weekday: 'MON' }, { onDate: mon }),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current' }, { notAfter: addDaysKey(mon, 6) }),
  ]);
  const perTarget = await settingNum(db, 'SALES_TARGET_WEEKLY', await settingNum(db, 'SALES_TARGET', 100000000));
  const T = {};
  const gt = team => bucket(T, String(team || '(no team)').trim() || '(no team)',
    { sales: 0, expected: 0, collected: 0, uncollected: 0, recovered: 0,
      mondayDebt: 0, curDebt: 0, c16: 0, cleared: 0, reduced: 0, bad: 0, stat: 0 });
  for (const r of sales) gt(r.team).sales += num(r.principal_amt) || num(r.loan_amt);
  for (const d of days) {
    const dayRows = scoped(user, expAll.filter(r => String(r.snapshot_date) === d.date));
    for (const r of pickLatestBatchRows(dayRows)) {
      const b = gt(r.team), c = collectedOf(r);
      b.expected += num(r.payment_expected); b.collected += c;
      b.uncollected += Math.max(0, num(r.payment_expected) - c);
    }
    const ini = pickLatestBatchRows(scoped(user, defAll.filter(r => String(r.snapshot_date) === d.date && r.snapshot_type === 'initial')));
    const cur = pickLatestBatchRows(scoped(user, defAll.filter(r => String(r.snapshot_date) === d.date && r.snapshot_type === 'current')));
    if (!ini.length || !cur.length) continue;
    for (const r of ini) gt(r.team).recovered += num(r.arrears);
    for (const r of cur) gt(r.team).recovered -= num(r.arrears);
  }
  const myMonIni = scoped(user, monIni.rows), myEndCur = scoped(user, endCur.rows);
  for (const r of myMonIni) gt(r.team).mondayDebt += num(r.arrears);
  for (const r of myEndCur) gt(r.team).curDebt += num(r.arrears);
  const endArrBy = {}, endHas = {};
  for (const r of myEndCur) { endArrBy[K(r.ref)] = num(r.arrears); endHas[K(r.ref)] = true; }
  for (const r of myMonIni) {
    if (paidCount(r) >= CREDIT_HALF) continue;
    const k = K(r.ref), initA = num(r.arrears);
    const cur = endHas[k] ? endArrBy[k] : 0;
    const b = gt(r.team);
    b.c16++;
    const st = creditState(initA, cur, !!endHas[k]);
    if (st === 'Cleared') b.cleared++; else if (st === 'Reduced') b.reduced++; else if (st === 'Bad') b.bad++; else b.stat++;
  }
  const leadBy = {};
  for (const t of teamRows) leadBy[K(t.team)] = t;
  const teamsOut = Object.values(T).map(b => ({
    team: b.key, lead: leadBy[K(b.key)] || {},
    sales: b.sales, salesPct: pctOf(b.sales, perTarget),
    expected: b.expected, collected: b.collected, uncollected: b.uncollected,
    collPct: pctOf(b.collected, b.expected),
    recovered: b.recovered, recPct: pctOf(b.recovered, b.uncollected),
    mondayDebt: b.mondayDebt, curDebt: b.curDebt, debtDelta: b.mondayDebt - b.curDebt,
    c16: b.c16, cleared: b.cleared, reduced: b.reduced, bad: b.bad, stat: b.stat,
    success: pctOf(b.cleared + b.reduced, b.c16),
  })).sort((a, b) => b.sales - a.sales);
  const sum = f => teamsOut.reduce((s, r) => s + (r[f] || 0), 0);
  const teamTotals = {
    sales: sum('sales'), expected: sum('expected'), collected: sum('collected'),
    uncollected: sum('uncollected'), recovered: sum('recovered'),
    mondayDebt: sum('mondayDebt'), curDebt: sum('curDebt'),
    c16: sum('c16'), cleared: sum('cleared'), reduced: sum('reduced'), bad: sum('bad'), stat: sum('stat'),
  };
  teamTotals.debtDelta = teamTotals.mondayDebt - teamTotals.curDebt;
  teamTotals.salesPct = pctOf(teamTotals.sales, perTarget * Math.max(teamsOut.length, 1));
  teamTotals.collPct = pctOf(teamTotals.collected, teamTotals.expected);
  teamTotals.recPct = pctOf(teamTotals.recovered, teamTotals.uncollected);
  teamTotals.success = pctOf(teamTotals.cleared + teamTotals.reduced, teamTotals.c16);
  teamTotals.companyTarget = perTarget * Math.max(teamsOut.length, 1);

  return { weekOf: mon, weekEnd: fri, days,
    teams: teamsOut, teamTotals, perTarget, teamCount: teamsOut.length,
    leadCols: TEAM_ROLE_COLS.slice(),
    hasMonday: myMonIni.length > 0, hasWeekEnd: myEndCur.length > 0, weekEndDate: endCur.date,
    totals: {
      expected: days.reduce((s, d) => s + d.expected, 0),
      collected: days.reduce((s, d) => s + d.collected, 0),
      uncollected: days.reduce((s, d) => s + d.uncollected, 0),
      recovered: days.reduce((s, d) => s + d.recovered, 0),
      received: days.reduce((s, d) => s + d.received, 0),
      salesCount: sales.length,
      salesAmount: sales.reduce((s, r) => s + (num(r.principal_amt) || num(r.loan_amt)), 0),
    } };
}
/** The supervisory roles a weekly report can be grouped by -- the teams table's own columns. */
const TEAM_ROLE_COLS = ['opm', 'recovery', 'gmo', 'manager', 'credit', 'expected', 'bike'];

/** Leader Reports / Team Progress: per-team initial vs current arrears, recovered and
    progress %, mirroring the live Team Progress sheet. */
async function teamProgress(db, user, _args, nowMs) {
  const wd = currentWeekday(nowMs);
  const [ini, cur] = await Promise.all([
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'initial', weekday: wd }, { notAfter: todayKey(nowMs) }),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current', weekday: wd }, { notAfter: todayKey(nowMs) }),
  ]);
  const teamsRows = await fetchAll(() => db.from('teams').select('*'));
  const paired = ini.rows.length && cur.rows.length && String(ini.date) === String(cur.date);
  const by = {};
  const bump = (team, field, v) => {
    const t = team || '(no team)';
    if (!by[t]) by[t] = { team: t, initArrears: 0, curArrears: 0, initCust: 0, curCust: 0, recovery: null, gmo: null, manager: null };
    by[t][field] += v;
  };
  for (const r of scoped(user, ini.rows)) { bump(r.team, 'initArrears', num(r.arrears)); bump(r.team, 'initCust', 1); }
  for (const r of scoped(user, cur.rows)) { bump(r.team, 'curArrears', num(r.arrears)); bump(r.team, 'curCust', 1); }
  for (const t of teamsRows) {
    if (!by[t.team]) continue;
    by[t.team].recovery = t.recovery || null; by[t.team].gmo = t.gmo || null; by[t.team].manager = t.manager || null;
  }
  const rows = Object.values(by).map(r => ({
    ...r,
    recovered: paired ? r.initArrears - r.curArrears : 0,
    cleared: Math.max(0, r.initCust - r.curCust),
    progress: paired && r.initArrears > 0 ? Math.round(((r.initArrears - r.curArrears) / r.initArrears) * 1000) / 10 : null,
  })).sort((a, b) => b.recovered - a.recovered);
  return { weekday: wd, date: cur.date, paired, rows,
    note: paired ? null : `No matching initial ${wd} deck -- Recovered shows 0 rather than a whole-book figure.` };
}

/** My Commission. Commission is earned by PEOPLE, not teams, and it comes from two separate
    jobs that pay on different rules:

      RECOVERY   the Recovery officer of the customer's team earns a PERCENTAGE of whatever
                 that customer's arrears fell by that day. The percentage can be set by
                 disbursement YEAR (older loans pay more so nobody ignores them) or by STATUS
                 (defaulter / expired / chronic) -- CMS_MODE picks which.
      COLLECTION the Expected officer earns a FLAT TZS amount per client who came in PAID or
                 OVERPAID that day (CMS_PAID_TZS / CMS_OVER_TZS).

    Both are computed day by day and summed, never from a week-level total: a customer who
    recovered on Tuesday and slipped back on Thursday earned Tuesday's commission, and a
    week-level subtraction would erase it.

    Officers see only their own row; anyone with settings/upload sees the whole company. */
function cmsPairs(txt) {
  const out = {};
  for (let p of String(txt == null ? '' : txt).split(',')) {
    p = p.trim(); if (!p) continue;
    const m = p.match(/^([A-Za-z0-9*]+)[\s:=-]*([0-9]+(?:\.[0-9]+)?)\s*%?$/);
    if (!m) throw badRequest('Rates must look like "2024:5, 2025:2.5" — could not read "' + p + '".');
    let k = String(m[1]).toUpperCase();
    if (k.startsWith('CHRON')) k = 'CHRONIC';
    else if (k.startsWith('EXPIR')) k = 'EXPIRED';
    else if (k.startsWith('DEFAULT')) k = 'DEFAULTER';
    out[k] = parseFloat(m[2]);
  }
  return out;
}
async function cmsCfg(db) {
  const rows = await fetchAll(() => db.from('settings').select('*'));
  const get = k => { const r = rows.find(x => x.key === k); return r ? r.value : ''; };
  let mode = String(get('CMS_MODE') || 'year');
  if (mode !== 'status') mode = 'year';
  let yearRates = {}, statusRates = {};
  try { yearRates = cmsPairs(get('CMS_YEAR_RATES')); } catch { /* a malformed rate must not break the page */ }
  try { statusRates = cmsPairs(get('CMS_STATUS_RATES')); } catch { /* same */ }
  return { mode, yearRaw: String(get('CMS_YEAR_RATES') || ''), statusRaw: String(get('CMS_STATUS_RATES') || ''),
    yearRates, statusRates,
    paidTzs: num(get('CMS_PAID_TZS')) || 0, overTzs: num(get('CMS_OVER_TZS')) || 0 };
}
function cmsRateFor(cfg, row) {
  if (cfg.mode === 'status') {
    const s = K(row.status);
    if (s.includes('CHRON')) return cfg.statusRates.CHRONIC || 0;
    if (s.includes('EXPIR')) return cfg.statusRates.EXPIRED || 0;
    return cfg.statusRates.DEFAULTER || 0;
  }
  const y = String(row.disb_date || '').slice(0, 4);
  if (cfg.yearRates[y] != null) return cfg.yearRates[y];
  return cfg.yearRates['*'] || 0;
}
async function commission(db, user, _args, nowMs) {
  const today = todayKey(nowMs), mon = weekMondayKey(nowMs), sun = addDaysKey(mon, 6), fri = addDaysKey(mon, 4);
  const [cfg, teamRows, defWeek, expWeek] = await Promise.all([
    cmsCfg(db),
    fetchAll(() => db.from('teams').select('*')),
    snapshotsInRange(db, 'defaulter_snapshots', {}, mon, sun),
    snapshotsInRange(db, 'repayment_snapshots', { snapshot_type: 'today' }, mon, fri),
  ]);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  const myDef = scoped(user, defWeek), myExp = scoped(user, expWeek);
  const onDate = (rows, d, type) => pickLatestBatchRows(rows.filter(r =>
    String(r.snapshot_date) === d && (!type || r.snapshot_type === type)));

  const blank = { recovered: 0, recComm: 0, paid: 0, over: 0, colComm: 0 };
  function recDay(dateKey, acc) {
    const ini = onDate(myDef, dateKey, 'initial'), cur = onDate(myDef, dateKey, 'current');
    if (!ini.length) return;
    const left = {};
    for (const r of cur) left[K(r.ref)] = (left[K(r.ref)] || 0) + num(r.arrears);
    for (const r of ini) {
      const k = K(r.ref);
      // Gone from the current deck entirely = fully recovered, not "missing data".
      const recA = num(r.arrears) - (left[k] == null ? 0 : left[k]);
      if (recA <= 0) continue;
      const b = bucket(acc, officerOf(teamBy, r.team, 'recovery'), blank);
      b.recovered += recA;
      b.recComm += recA * cmsRateFor(cfg, r) / 100;
    }
  }
  function colDay(dateKey, acc) {
    for (const r of onDate(myExp, dateKey)) {
      const s = K(r.todays_status);
      if (s !== 'PAID' && s !== 'OVERPAID') continue;
      const b = bucket(acc, officerOf(teamBy, r.team, 'expected'), blank);
      if (s === 'OVERPAID') { b.over++; b.colComm += cfg.overTzs; }
      else { b.paid++; b.colComm += cfg.paidTzs; }
    }
  }
  const dayAcc = {}, weekAcc = {};
  recDay(today, dayAcc); colDay(today, dayAcc);
  for (let i = 0; i < 7; i++) recDay(addDaysKey(mon, i), weekAcc);
  for (let i = 0; i < 5; i++) colDay(addDaysKey(mon, i), weekAcc);

  const isAdmin = (user.tabs || []).includes('upload') || (user.tabs || []).includes('settings');
  const pack = acc => Object.values(acc)
    .filter(b => isAdmin || K(b.key) === K(user.name))
    .map(b => ({ officer: b.key, recovered: b.recovered, recComm: Math.round(b.recComm),
      paid: b.paid, over: b.over, colComm: Math.round(b.colComm),
      total: Math.round(b.recComm + b.colComm) }))
    .sort((a, b) => b.total - a.total);

  const day = pack(dayAcc), week = pack(weekAcc);
  return { mode: cfg.mode, yearRates: cfg.yearRaw, statusRates: cfg.statusRaw,
    paidTzs: cfg.paidTzs, overTzs: cfg.overTzs, isAdmin, me: user.name,
    weekday: currentWeekday(nowMs), date: today, weekOf: mon,
    day, week,
    totals: { day: day.reduce((s, r) => s + r.total, 0), week: week.reduce((s, r) => s + r.total, 0),
      recovered: day.reduce((s, r) => s + r.recovered, 0) } };
}
/** The rate editor lives on the commission page itself, so cause and effect are one click
    apart -- typing a rate and seeing the numbers move is the whole point. */
async function commissionSave(db, user, p) {
  requireAdmin(user);
  const set = async (key, value) => {
    const { error } = await db.from('settings').upsert({ key, value: String(value == null ? '' : value) }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
  };
  const out = {};
  if (p.mode != null) { out.mode = String(p.mode) === 'status' ? 'status' : 'year'; await set('CMS_MODE', out.mode); }
  // Validate BEFORE writing anything: a malformed year list must not half-save.
  if (p.yearRates != null) { cmsPairs(p.yearRates); out.yearRates = String(p.yearRates); }
  if (p.statusRates != null) { cmsPairs(p.statusRates); out.statusRates = String(p.statusRates); }
  if (out.yearRates != null) await set('CMS_YEAR_RATES', out.yearRates);
  if (out.statusRates != null) await set('CMS_STATUS_RATES', out.statusRates);
  if (p.paidTzs != null) { out.paidTzs = Math.max(0, num(p.paidTzs) || 0); await set('CMS_PAID_TZS', out.paidTzs); }
  if (p.overTzs != null) { out.overTzs = Math.max(0, num(p.overTzs) || 0); await set('CMS_OVER_TZS', out.overTzs); }
  return out;
}

/** The rotation engine: which supervisory ROLE owns a defaulter right now, and therefore
    which named person on their team. Ported from assignFor_/assignStrategy_ in Code.gs --
    the escalation policy is a business decision, so every parameter lives in settings:

      ACTIVE  (still within term)  -> rotate ASSIGN_ACTIVE  every ASSIGN_BUCKET_DAYS days
      EXPIRED (past expiry)        -> step   ASSIGN_EXPIRED  one role per week, then hold
      CHRONIC (past grace weeks)   -> rotate ASSIGN_CHRONIC  weekly, forever

    Recycling a customer between BIKE / MANAGER / GMO is the whole point: the same officer
    calling the same person every week stops working, so ownership moves on a clock. */
const ROLE_COLS = { BIKE: 'bike', MANAGER: 'manager', GMO: 'gmo', RECOVERY: 'recovery',
  OPM: 'opm', CREDIT: 'credit', EXPECTED: 'expected' };

function parseRoles(v, dflt) {
  const list = String(v == null ? '' : v).split(',').map(x => K(x)).filter(x => ROLE_COLS[x]);
  return list.length ? list : dflt;
}
function weeksSince(v, nowMs) {
  const t = Date.parse(String(v || ''));
  if (isNaN(t)) return 0;
  const days = Math.max(0, Math.floor((nowMs - t) / 86400000));
  return Math.floor(days / 7) + 1;
}
export function assignFor(rec, strat, nowMs) {
  const status = K(rec.status);
  if (status.indexOf('CHRON') >= 0) {
    const n = weeksSince(rec.chronic_date, nowMs) || 1;
    return { phase: 'CHRONIC', role: strat.chronic[(n - 1) % strat.chronic.length], label: 'C-W' + n };
  }
  if (status.indexOf('EXPIR') >= 0) {
    let n = weeksSince(rec.expire_date, nowMs) || 1;
    if (n > strat.graceWeeks) {                       // past grace -> it is chronic in practice
      const c = n - strat.graceWeeks;
      return { phase: 'CHRONIC', role: strat.chronic[(c - 1) % strat.chronic.length], label: 'C-W' + c };
    }
    if (n > strat.expired.length) n = strat.expired.length;
    return { phase: 'EXPIRED', role: strat.expired[n - 1], label: 'E-W' + n };
  }
  const d = num(rec.days_elapsed) || 1;
  const b = Math.ceil(Math.max(1, d) / strat.bucketDays);
  return { phase: 'ACTIVE', role: strat.active[(b - 1) % strat.active.length], label: 'D' + d };
}
async function assignStrategy(db) {
  const get = async k => { const { data } = await db.from('settings').select('value').eq('key', k).maybeSingle(); return data && data.value; };
  const [a, c, e, g, b] = await Promise.all([get('ASSIGN_ACTIVE'), get('ASSIGN_CHRONIC'),
    get('ASSIGN_EXPIRED'), get('ASSIGN_GRACE_WEEKS'), get('ASSIGN_BUCKET_DAYS')]);
  return {
    active: parseRoles(a, ['BIKE', 'MANAGER', 'GMO']),
    chronic: parseRoles(c, ['BIKE', 'GMO', 'MANAGER']),
    expired: parseRoles(e, ['MANAGER', 'GMO']),
    graceWeeks: Math.max(1, Math.min(8, parseInt(g, 10) || 2)),
    bucketDays: Math.max(1, Math.min(14, parseInt(b, 10) || 2)),
  };
}

/** Defaulter Assignment: the current deck, each customer routed to the role that owns them
    this week and named against that team's actual person, joined to whoever last followed
    up -- so a leader sees both who SHOULD be calling and whether anyone HAS. */
async function assignments(db, user, _args, nowMs) {
  const [snap, fu, teamRows, strat] = await Promise.all([
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current', weekday: currentWeekday(nowMs) }, { notAfter: todayKey(nowMs) }),
    fetchAll(() => db.from('followup_status').select('ref, fu_status, comment_by, comment_at, promise_date')),
    fetchAll(() => db.from('teams').select('*')),
    assignStrategy(db),
  ]);
  const byRef = {};
  for (const f of fu) byRef[String(f.ref)] = f;
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;

  const rows = scoped(user, snap.rows).map(r => {
    const f = byRef[String(r.ref)] || {};
    const a = assignFor(r, strat, nowMs);
    const team = teamBy[K(r.team)] || {};
    const leader = team[ROLE_COLS[a.role]] || '';
    return { ref: r.ref, full_name: r.full_name, contact: r.contact, guarantor_contact: r.guarantor_contact,
      team: r.team, arrears: num(r.arrears), status: r.status, ds: r.ds, dc: r.dc,
      days_elapsed: r.days_elapsed, phase: a.phase, role: a.role, cycle: a.label,
      leader: leader || '(unassigned)', assigned: !!leader,
      fu_status: f.fu_status || '', officer: f.comment_by || '', touched_at: f.comment_at || '',
      promise_date: f.promise_date || '' };
  }).sort((a, b) => b.arrears - a.arrears);

  const untouched = rows.filter(r => !r.fu_status);
  const byRole = {}, byLeader = {};
  for (const r of rows) {
    if (!byRole[r.role]) byRole[r.role] = { role: r.role, customers: 0, arrears: 0, touched: 0 };
    byRole[r.role].customers++; byRole[r.role].arrears += r.arrears; if (r.fu_status) byRole[r.role].touched++;
    const k = r.leader;
    if (!byLeader[k]) byLeader[k] = { leader: k, role: r.role, customers: 0, arrears: 0, touched: 0 };
    byLeader[k].customers++; byLeader[k].arrears += r.arrears; if (r.fu_status) byLeader[k].touched++;
  }
  return { date: snap.date, weekday: currentWeekday(nowMs), rows, count: rows.length,
    untouched: untouched.length, untouchedArrears: untouched.reduce((s, r) => s + r.arrears, 0),
    unassigned: rows.filter(r => !r.assigned).length,
    strategy: strat,
    byRole: Object.values(byRole).sort((a, b) => b.arrears - a.arrears),
    byLeader: Object.values(byLeader).sort((a, b) => b.arrears - a.arrears) };
}

/** Credit Analysts. An analyst is judged on their COUNT 1-6 book -- defaulters who have paid
    fewer than 6 of 12 installments, i.e. have not yet passed the halfway mark and are still
    winnable -- and on sales. Each customer in that book lands in one of four states measured
    Monday-initial vs current:

      Cleared  gone from the current deck, or nothing left owing
      Reduced  arrears fell
      Bad      arrears rose
      Static   arrears unchanged

    Success % = (cleared + reduced) ÷ count 1-6, and Overall % averages success with sales %,
    which is the single number the analyst is ranked on. The analyst for a customer is the
    CREDIT column of their team, so a reassignment in Teams & Staff re-points this too.

    The weekly SCORECARD is anchored to Monday's initial deck on purpose -- "progress since
    Monday" only means something against a fixed weekly baseline. The PORTFOLIO list below is
    built from TODAY's current deck instead, because that is who the analyst has to call
    today: someone who started defaulting on Wednesday must appear, and someone who cleared on
    Tuesday must not. */
const CREDIT_HALF = 6;
function creditState(initArr, curArr, inCurrent) {
  if (!inCurrent || curArr <= 0) return 'Cleared';
  if (curArr < initArr) return 'Reduced';
  if (curArr > initArr) return 'Bad';
  return 'Static';
}
async function credit(db, user, _args, nowMs) {
  const today = todayKey(nowMs), mon = weekMondayKey(nowMs);
  const wd = currentWeekday(nowMs);
  const [teamRows, curSnap, monSnap, todaySnap, loansAll] = await Promise.all([
    fetchAll(() => db.from('teams').select('*')),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current', weekday: wd }, { notAfter: today }),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'initial', weekday: 'MON' }, { onDate: mon }),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'initial', weekday: wd }, { notAfter: today }),
    fetchAll(() => db.from('loans').select('*').eq('stage', 'approved')),
  ]);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  const analystOf = team => officerOf(teamBy, team, 'credit');

  const defCur = scoped(user, curSnap.rows);
  // Until Monday's baseline is uploaded, fall back to today's initial rather than showing nothing.
  const defIni = monSnap.rows.length ? scoped(user, monSnap.rows) : scoped(user, todaySnap.rows);

  const curArrBy = {}, curPaidBy = {}, inCur = {};
  for (const d of defCur) { const k = K(d.ref); curArrBy[k] = num(d.arrears); curPaidBy[k] = paidCount(d); inCur[k] = true; }
  const iniArrBy = {};
  for (const d of defIni) iniArrBy[K(d.ref)] = num(d.arrears);

  const A = {};
  const ga = name => bucket(A, name, { teams: {}, cnt: 0, cntCur: 0, cleared: 0, reduced: 0, bad: 0, stat: 0,
    recovered: 0, sales: 0, salesCnt: 0 });
  for (const d of defIni) {
    if (paidCount(d) >= CREDIT_HALF) continue;
    const k = K(d.ref), initA = num(d.arrears);
    const cur = inCur[k] ? curArrBy[k] : 0;
    const st = creditState(initA, cur, !!inCur[k]);
    const a = ga(analystOf(d.team));
    if (d.team) a.teams[K(d.team)] = String(d.team).trim();
    a.cnt++;
    if (inCur[k]) a.cntCur++;
    if (st === 'Cleared') a.cleared++; else if (st === 'Reduced') a.reduced++; else if (st === 'Bad') a.bad++; else a.stat++;
    a.recovered += Math.max(0, initA - cur);
  }
  for (const l of scoped(user, loansAll)) {
    const a = ga(analystOf(l.team));
    a.sales += num(l.principal_amt) || num(l.loan_amt); a.salesCnt++;
  }

  const perTarget = await settingNum(db, 'SALES_TARGET_WEEKLY', await settingNum(db, 'SALES_TARGET', 100000000));
  const rows = Object.values(A).map(a => {
    const teamList = Object.values(a.teams).filter(Boolean);
    const success = pctOf(a.cleared + a.reduced, a.cnt);
    const salesPct = pctOf(a.sales, perTarget * Math.max(teamList.length, 1));
    return { analyst: a.key, teams: teamList.length, teamList: teamList.join(', '),
      cnt: a.cnt, cntCur: a.cntCur, cleared: a.cleared, reduced: a.reduced, stat: a.stat, bad: a.bad,
      recovered: a.recovered, sales: a.sales, salesCnt: a.salesCnt, success, salesPct,
      overall: Math.round(((success || 0) + (salesPct || 0)) / 2 * 10) / 10 };
  }).filter(r => r.cnt > 0 || r.sales > 0).sort((a, b) => b.overall - a.overall);

  const avgOverall = rows.length ? Math.round(rows.reduce((s, r) => s + r.overall, 0) / rows.length * 10) / 10 : 0;
  for (const r of rows) r.below = r.overall < avgOverall;

  const portfolio = defCur.filter(d => paidCount(d) < CREDIT_HALF).map(d => {
    const k = K(d.ref), cur = num(d.arrears);
    // No Monday record means new this week -- 0 recovered rather than silently dropped.
    const initA = Object.prototype.hasOwnProperty.call(iniArrBy, k) ? iniArrBy[k] : cur;
    return { ref: d.ref, full_name: d.full_name, team: d.team, contact: d.contact,
      analyst: analystOf(d.team), paid: curPaidBy[k], initArr: initA, curArr: cur,
      recovered: Math.max(0, initA - cur), state: creditState(initA, cur, true) };
  }).sort((a, b) => b.recovered - a.recovered);

  const tot = { cnt: 0, cntCur: 0, cleared: 0, reduced: 0, bad: 0, stat: 0, recovered: 0, sales: 0 };
  for (const r of rows) for (const f of Object.keys(tot)) tot[f] += r[f] || 0;
  const teamCount = Math.max(Object.keys(teamBy).length, 1);
  tot.success = pctOf(tot.cleared + tot.reduced, tot.cnt);
  tot.salesPct = pctOf(tot.sales, perTarget * teamCount);
  tot.overall = Math.round(((tot.success || 0) + (tot.salesPct || 0)) / 2 * 10) / 10;

  return { rows, portfolio, count: rows.length, totals: tot, avgOverall, perTarget, teamCount,
    threshold: CREDIT_HALF - 1, baselineDate: monSnap.rows.length ? monSnap.date : todaySnap.date,
    usedMondayBaseline: monSnap.rows.length > 0,
    hasInitial: defIni.length > 0, hasCurrent: defCur.length > 0,
    analystCount: rows.filter(r => r.cnt > 0).length,
    analysts: [...new Set(portfolio.map(p => p.analyst))].sort() };
}

/* ------------------------------------------------------------------ reference / admin */
async function teams(db, user) {
  const rows = await fetchAll(() => db.from('teams').select('*').order('team', { ascending: true }));
  return { rows: rows.filter(r => teamAllowed(user, r.team)), count: rows.length };
}
async function settingsList(db, user) {
  requireAdmin(user);
  const rows = await fetchAll(() => db.from('settings').select('*').order('key', { ascending: true }));
  return { rows };
}
async function settingSet(db, user, p) {
  requireAdmin(user);
  if (!p || !p.key) throw badRequest('key is required');
  const { error } = await db.from('settings').upsert({ key: p.key, value: String(p.value == null ? '' : p.value) }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  return { key: p.key };
}
async function accessCodes(db, user) {
  requireAdmin(user);
  const [rows, roleRows] = await Promise.all([
    fetchAll(() => db.from('access_codes').select('code, name, role, teams, tabs').order('name', { ascending: true })),
    fetchAll(() => db.from('roles').select('*').order('role', { ascending: true })),
  ]);
  return { rows, count: rows.length, roles: roleRows };
}
/** Add or edit one code from the UI, so a new officer does not require an upload or SQL.
    'ALL' / blank teams means every team -- the same convention auth.js reads. */
async function saveAccessCode(db, user, p) {
  requireAdmin(user);
  const code = String((p && p.code) || '').trim();
  if (!code) throw badRequest('code is required');
  if (!p.name || !p.role) throw badRequest('name and role are required');
  const list = v => {
    const s = String(v == null ? '' : v).trim();
    if (!s || s.toUpperCase() === 'ALL') return null;
    const items = s.split(/[;,]/).map(x => x.trim()).filter(Boolean);
    return items.length ? items : null;
  };
  const { error } = await db.from('access_codes').upsert({
    code, name: String(p.name).trim(), role: String(p.role).trim(),
    teams: list(p.teams), tabs: list(p.tabs) || [],
  }, { onConflict: 'code' });
  if (error) throw new Error(error.message);
  return { code };
}
async function deleteAccessCode(db, user, p) {
  requireAdmin(user);
  const code = String((p && p.code) || '').trim();
  if (!code) throw badRequest('code is required');
  // Locking yourself out mid-migration would mean another trip to the SQL editor.
  if (code === user.code) throw badRequest('You cannot delete the code you are signed in with.');
  const { error } = await db.from('access_codes').delete().eq('code', code);
  if (error) throw new Error(error.message);
  return { code };
}

/** Phone (calls app) registrations. Test devices and mistyped names accumulate fast during a
    rollout, and every one of them shows up in call reports -- this is how they get cleaned up
    without a database console. */
async function callUsers(db, user) {
  requireAdmin(user);
  const [users, logs] = await Promise.all([
    fetchAll(() => db.from('call_users').select('*').order('registered_at', { ascending: false })),
    fetchAll(() => db.from('call_logs').select('user_id')),
  ]);
  const counts = {};
  for (const l of logs) counts[l.user_id] = (counts[l.user_id] || 0) + 1;
  return { rows: users.map(u => ({ ...u, calls: counts[u.user_id] || 0 })), count: users.length };
}
/** Two ways to remove someone, because they mean different things:
      unregister -> keep the row and its call history, just release the device so the phone
                    has to register again (the fix for "wrong name/team on the right phone");
      delete     -> remove the registration entirely, and only then also drop its call logs,
                    which is what a test account deserves. */
async function removeCallUser(db, user, p) {
  requireAdmin(user);
  const id = String((p && p.userId) || '').trim();
  if (!id) throw badRequest('userId is required');
  if (String(p.mode || 'unregister') === 'unregister') {
    const { error } = await db.from('call_users').update({ device_id: null }).eq('user_id', id);
    if (error) throw new Error(error.message);
    return { userId: id, mode: 'unregister' };
  }
  // call_logs.user_id references call_users -- the logs must go first or the delete is refused.
  const { error: lErr } = await db.from('call_logs').delete().eq('user_id', id);
  if (lErr) throw new Error(lErr.message);
  const { error } = await db.from('call_users').delete().eq('user_id', id);
  if (error) throw new Error(error.message);
  return { userId: id, mode: 'delete' };
}

/* ------------------------------------------------------------------ storage housekeeping

   Every upload appends a dated snapshot rather than overwriting, which is what makes history,
   trends and "recovery since Monday" possible at all -- but it also means the tables only ever
   grow. Postgres has no cell ceiling the way the old workbook did, so nothing breaks; what
   runs out eventually is the plan's disk quota. So: show what each date is actually costing,
   and let an admin drop the dates they no longer need, per report type.

   Deleting a snapshot date deletes a DAY OF HISTORY -- the trends and weekly comparisons that
   read it will show gaps -- so this is admin-only and names the row count before it acts.

   Bytes-per-row below are MEASURED, not guessed: this schema was loaded into Postgres 16 and
   filled with rows carrying real-shaped Tanzanian names, phone numbers, refs and branches,
   then pg_total_relation_size (heap + indexes + toast) was divided by the row count. They are
   what makes the size projection on the Settings page trustworthy. */
const SNAPSHOT_SOURCES = {
  expected: { table: 'repayment_snapshots', label: 'Expected Repayment', dateCol: 'snapshot_date', bytes: 456 },
  defaulters: { table: 'defaulter_snapshots', label: 'Defaulters', dateCol: 'snapshot_date', bytes: 498 },
  received: { table: 'received_payments', label: 'Received Payments', dateCol: 'paid_at', bytes: 246 },
  abnormal: { table: 'abnormal_payments', label: 'Abnormal Payments', dateCol: 'created_at', bytes: 246 },
  calls: { table: 'call_logs', label: 'Call Logs', dateCol: 'call_date', bytes: 258 },
};
const dayOf = v => String(v == null ? '' : v).slice(0, 10);

/** What is stored, by date and report type, so a cleanup is an informed choice rather than a
    guess. Also reports the total row count per source for the storage note in the UI. */
async function storageUsage(db, user) {
  requireAdmin(user);
  const out = {};
  const byDate = {};
  for (const [key, src] of Object.entries(SNAPSHOT_SOURCES)) {
    const rows = await fetchAll(() => db.from(src.table).select(src.dateCol));
    out[key] = { key, label: src.label, table: src.table, rows: rows.length };
    for (const r of rows) {
      const d = dayOf(r[src.dateCol]);
      if (!d) continue;
      if (!byDate[d]) byDate[d] = { date: d, total: 0 };
      byDate[d][key] = (byDate[d][key] || 0) + 1;
      byDate[d].total++;
    }
  }
  const dates = Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
  for (const s of Object.values(out)) s.bytes = s.rows * SNAPSHOT_SOURCES[s.key].bytes;
  for (const d of dates) {
    d.bytes = Object.keys(SNAPSHOT_SOURCES).reduce((s, k) => s + (d[k] || 0) * SNAPSHOT_SOURCES[k].bytes, 0);
  }
  const bytes = Object.values(out).reduce((s, x) => s + x.bytes, 0);
  // Growth per day, measured over the dates actually present -- so the projection describes
  // THIS operation's upload habits rather than an assumed one.
  const span = dates.length > 1
    ? Math.max(1, Math.round((Date.parse(dates[0].date) - Date.parse(dates[dates.length - 1].date)) / 86400000) + 1)
    : 1;
  const perDay = Math.round(bytes / span);
  return { sources: Object.values(out), dates,
    totalRows: Object.values(out).reduce((s, x) => s + x.rows, 0),
    bytes, perDay, perMonth: perDay * 30, days: span,
    oldest: dates.length ? dates[dates.length - 1].date : null,
    newest: dates.length ? dates[0].date : null };
}

/** Delete the chosen report types for one date, or for everything on/before a date when
    `through` is set -- which is how you reclaim a year of history in one action. */
async function purgeSnapshots(db, user, p) {
  requireAdmin(user);
  const date = String((p && p.date) || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('A date (yyyy-mm-dd) is required.');
  const wanted = Array.isArray(p.types) ? p.types.filter(t => SNAPSHOT_SOURCES[t]) : [];
  if (!wanted.length) throw badRequest('Choose at least one report type to clean.');
  const through = !!p.through;
  const deleted = {};
  let total = 0;
  for (const key of wanted) {
    const src = SNAPSHOT_SOURCES[key];
    // Count first: the caller is told exactly what went, and a dry run can ask without acting.
    const before = await fetchAll(() => db.from(src.table).select(src.dateCol));
    const hit = before.filter(r => {
      const d = dayOf(r[src.dateCol]);
      return d && (through ? d <= date : d === date);
    }).length;
    if (!p.dryRun && hit) {
      const q = db.from(src.table).delete();
      const { error } = await (through
        ? q.lte(src.dateCol, date + (src.dateCol === 'created_at' ? 'T23:59:59.999Z' : ''))
        : (src.dateCol === 'created_at'
            ? q.gte(src.dateCol, date).lte(src.dateCol, date + 'T23:59:59.999Z')
            : q.eq(src.dateCol, date)));
      if (error) throw new Error(error.message);
    }
    deleted[key] = hit; total += hit;
  }
  return { date, through, dryRun: !!p.dryRun, deleted, total };
}

/* ------------------------------------------------------------------ dispatch */
function badRequest(m) { const e = new Error(m); e.status = 400; return e; }
function forbidden(m) { const e = new Error(m); e.status = 403; return e; }
/** Managing who can sign in is the one thing gated harder than team scope. */
function requireAdmin(user) {
  if (!(user.tabs || []).includes('settings')) throw forbidden('Settings (admin) permission required.');
}

const FN = {
  dashboard: (db, user, a, now) => buildDashboard(db, user, now),
  loans, loanPipeline, expected, defaulters, expectedDefaulters,
  followup, comments, addComment, promises, followupReport,
  complaints, addComplaint, resolveComplaint,
  restructures, addRestructure, decideRestructure,
  demandNotices, addDemandNotice, abnormal, received,
  par, weekly, teamProgress, commission, commissionSave, assignments, credit,
  dashboardFull, expectedDay, saveTeam, deleteTeam, hints, officerBoards,
  teams, settings: settingsList, settingSet,
  accessCodes, saveAccessCode, deleteAccessCode, callUsers, removeCallUser,
  storageUsage, purgeSnapshots,
  callReport: (db, user, a, now) => reportCoreForPortal(db, user, a, now),
};

export async function portalApi(db, user, fn, args, nowMs = Date.now()) {
  const h = FN[fn];
  if (!h) throw badRequest('Unknown portal function: ' + fn);
  return h(db, user, args || {}, nowMs);
}

export const PORTAL_FUNCTIONS = Object.keys(FN);

/* =======================================================================================
   THE v1 DASHBOARD, rebuilt on v2 data.

   The generic KPI+table dashboard was not what the operation actually reads. The real one
   is: five headline cards, four weekday trend grids (loan applications Mon-Sun, sales
   Mon-Fri, collection Mon-Fri, recovery Mon-Sun), the loan pipeline funnel, and a team
   performance table carrying the leader names beside the numbers -- because the meeting
   asks "whose team is this?" before it asks "how much?".
   ======================================================================================= */

const WD5 = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
const WD7 = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** Snapshot date of a given weekday inside the week containing nowMs. */
function dateOfWeekday(nowMs, wd) { return addDaysKey(weekMondayKey(nowMs), WD7.indexOf(wd)); }

async function settingNum(db, key, dflt) {
  const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle();
  const n = parseInt(String((data && data.value) || '').replace(/[^0-9]/g, ''), 10);
  return (!n || isNaN(n)) ? dflt : n;
}

async function dashboardFull(db, user, _args, nowMs) {
  const today = todayKey(nowMs), mon = weekMondayKey(nowMs), sun = addDaysKey(mon, 6);
  const wdToday = currentWeekday(nowMs);
  const base = await buildDashboard(db, user, nowMs);

  const [expWeek, defWeek, loansAll, abn, teamRows] = await Promise.all([
    snapshotsInRange(db, 'repayment_snapshots', { snapshot_type: 'today' }, mon, sun),
    snapshotsInRange(db, 'defaulter_snapshots', {}, mon, sun),
    fetchAll(() => db.from('loans').select('*')),
    fetchAll(() => db.from('abnormal_payments').select('team, paid')),
    fetchAll(() => db.from('teams').select('*')),
  ]);
  const weeklyTarget = await settingNum(db, 'SALES_TARGET_WEEKLY', await settingNum(db, 'SALES_TARGET', 100000000));

  const myExpWeek = scoped(user, expWeek), myDefWeek = scoped(user, defWeek);
  const myLoans = scoped(user, loansAll), myAbn = scoped(user, abn);
  const myTeams = teamRows.filter(t => teamAllowed(user, t.team));
  const dayRows = (rows, d) => rows.filter(r => String(r.snapshot_date) === d);

  /* ---- loan applications per weekday: unassigned + assigned, by their own DATE column ---- */
  const appsTrend = WD7.map((wd, i) => {
    const d = addDaysKey(mon, i);
    const on = myLoans.filter(l => String(l.created_at || '').slice(0, 10) === d);
    const u = on.filter(l => l.stage === 'unassigned').length;
    const a = on.filter(l => l.stage === 'assigned').length;
    return { weekday: wd, date: d, unassigned: u, assigned: a, apps: u + a,
      amount: on.filter(l => l.stage === 'unassigned' || l.stage === 'assigned')
        .reduce((s, l) => s + (num(l.requested_amt) || num(l.principal_amt)), 0) };
  });

  /* ---- sales trend Mon-Fri: approved principal per day against the daily target ---- */
  const dailyTarget = Math.round(weeklyTarget * Math.max(myTeams.length, 1) / 5);
  const salesTrend = WD5.map((wd, i) => {
    const d = addDaysKey(mon, i);
    const on = myLoans.filter(l => l.stage === 'approved' && String(l.approved_date || '').slice(0, 10) === d);
    const amt = on.reduce((s, l) => s + (num(l.principal_amt) || num(l.loan_amt)), 0);
    return { weekday: wd, date: d, amount: amt, loans: on.length,
      pct: dailyTarget > 0 ? Math.round((amt / dailyTarget) * 1000) / 10 : null };
  });

  /* ---- collection trend Mon-Fri: collected + uncollected per weekday ---- */
  const colTrend = WD5.map((wd, i) => {
    const d = addDaysKey(mon, i);
    const rows = pickLatestBatchRows(dayRows(myExpWeek, d));
    const exp = rows.reduce((s, r) => s + num(r.payment_expected), 0);
    const col = rows.reduce((s, r) => s + collectedOf(r), 0);
    return { weekday: wd, date: d, expected: exp, collected: col, uncollected: uncollectedOf(rows),
      pct: exp > 0 ? Math.round((col / exp) * 1000) / 10 : null };
  });

  /* ---- recovery trend Mon-Sun: each day's own initial - current, over that day's uncollected.
          Sat/Sun have no collection baseline, so they read "full recovery" like v1. ---- */
  const recTrend = WD7.map((wd, i) => {
    const d = addDaysKey(mon, i);
    const ini = pickLatestBatchRows(myDefWeek.filter(r => String(r.snapshot_date) === d && r.snapshot_type === 'initial'));
    const cur = pickLatestBatchRows(myDefWeek.filter(r => String(r.snapshot_date) === d && r.snapshot_type === 'current'));
    const from = ini.reduce((s, r) => s + num(r.arrears), 0);
    const to = cur.reduce((s, r) => s + num(r.arrears), 0);
    const rec = (ini.length && cur.length) ? from - to : 0;
    const unc = uncollectedOf(pickLatestBatchRows(dayRows(myExpWeek, d)));
    return { weekday: wd, date: d, from, to, recovered: rec, uncollected: unc,
      pct: unc > 0 ? Math.round((rec / unc) * 1000) / 10 : null,
      full: i >= 5 && rec > 0 };
  });

  /* ---- pipeline funnel ---- */
  const funnel = STAGES.map(st => ({ stage: st, count: myLoans.filter(l => l.stage === st).length }));

  /* ---- team performance: numbers WITH the leader names beside them ---- */
  const todayExp = pickLatestBatchRows(dayRows(myExpWeek, today));
  const tomorrowSnap = await latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'tomorrow' }, { notAfter: today });
  const earlyExp = scoped(user, tomorrowSnap.rows);
  const iniToday = pickLatestBatchRows(myDefWeek.filter(r => String(r.snapshot_date) === today && r.snapshot_type === 'initial'));
  const curToday = pickLatestBatchRows(myDefWeek.filter(r => String(r.snapshot_date) === today && r.snapshot_type === 'current'));
  const pairedToday = !!(iniToday.length && curToday.length);

  const T = {};
  const slot = t => {
    const k = t || '(no team)';
    if (!T[k]) T[k] = { team: k, recovery: null, gmo: null, manager: null, opm: null, bike: null,
      initArrears: 0, curArrears: 0, recovered: 0, sales: 0, salesPct: null,
      expToday: 0, colToday: 0, collPctToday: null, expEarly: 0, colEarly: 0, collPctEarly: null,
      defaulters: 0, abnormal: 0 };
    return T[k];
  };
  for (const t of myTeams) {
    const s = slot(t.team);
    s.recovery = t.recovery || null; s.gmo = t.gmo || null; s.manager = t.manager || null;
    s.opm = t.opm || null; s.bike = t.bike || null;
  }
  for (const r of iniToday) slot(r.team).initArrears += num(r.arrears);
  for (const r of curToday) { const s = slot(r.team); s.curArrears += num(r.arrears); s.defaulters += 1; }
  for (const r of todayExp) { const s = slot(r.team); s.expToday += num(r.payment_expected); s.colToday += collectedOf(r); }
  for (const r of earlyExp) { const s = slot(r.team); s.expEarly += num(r.payment_expected); s.colEarly += collectedOf(r); }
  for (const l of myLoans) {
    if (l.stage !== 'approved') continue;
    const d = String(l.approved_date || '').slice(0, 10);
    if (d < mon || d > sun) continue;
    slot(l.team).sales += num(l.principal_amt) || num(l.loan_amt);
  }
  for (const a of myAbn) slot(a.team).abnormal += 1;

  const teams = Object.values(T).map(s => ({
    ...s,
    recovered: pairedToday ? s.initArrears - s.curArrears : 0,
    salesPct: weeklyTarget > 0 ? Math.round((s.sales / weeklyTarget) * 1000) / 10 : null,
    collPctToday: s.expToday > 0 ? Math.round((s.colToday / s.expToday) * 1000) / 10 : null,
    collPctEarly: s.expEarly > 0 ? Math.round((s.colEarly / s.expEarly) * 1000) / 10 : null,
  })).sort((a, b) => b.curArrears - a.curArrears);

  return {
    ...base,
    weekOf: mon, weekEnd: sun, weekday: wdToday, dailyTarget,
    weeklyTarget: weeklyTarget * Math.max(myTeams.length, 1), teamCount: myTeams.length,
    cards: {
      curArrears: teams.reduce((s, t) => s + t.curArrears, 0),
      initArrears: teams.reduce((s, t) => s + t.initArrears, 0),
      recovered: teams.reduce((s, t) => s + t.recovered, 0),
      defaulters: curToday.length,
      defaultersInitial: iniToday.length,
      cleared: Math.max(0, iniToday.length - curToday.length),
      salesWeek: teams.reduce((s, t) => s + t.sales, 0),
      salesLoans: myLoans.filter(l => l.stage === 'approved' && String(l.approved_date || '').slice(0, 10) >= mon && String(l.approved_date || '').slice(0, 10) <= sun).length,
      abnormal: myAbn.length,
      abnormalAmount: myAbn.reduce((s, a) => s + num(a.paid), 0),
      uncollectedToday: uncollectedOf(todayExp),
    },
    appsTrend, salesTrend, colTrend, recTrend, funnel,
    teamPerf: teams,
    paired: pairedToday,
  };
}
/** Local copy of the batch rule for rows already fetched in bulk (one date at a time). */
function pickLatestBatchRows(rows) {
  if (!rows.length) return [];
  let newest = rows[0];
  for (const r of rows) if (String(r.created_at || '') > String(newest.created_at || '')) newest = r;
  const win = newest.upload_batch || null;
  return rows.filter(r => (r.upload_batch || null) === win);
}

/** Expected for ONE weekday of this week -- the Mon..Fri pills the officers actually use,
    instead of only ever "the latest". Falls back to the latest snapshot when that weekday
    has not been uploaded yet. */
async function expectedDay(db, user, { weekday, type = 'today' }, nowMs) {
  // There are no weekend Expected sheets, so a Sat/Sun visit lands on FRIDAY -- the last
  // working day that actually has a list -- instead of an empty day nobody uploads.
  const asked = String(weekday || '').toUpperCase();
  const wd = WD5.includes(asked) ? asked : (WD5.includes(currentWeekday(nowMs)) ? currentWeekday(nowMs) : 'FRI');
  const date = dateOfWeekday(nowMs, wd);
  let snap = await latestSnapshot(db, 'repayment_snapshots', { snapshot_type: type }, { onDate: date });
  let fellBack = false;
  if (!snap.rows.length) {
    snap = await latestSnapshot(db, 'repayment_snapshots', { snapshot_type: type }, { notAfter: todayKey(nowMs) });
    fellBack = true;
  }
  const rows = scoped(user, snap.rows).map(r => ({ ...r, collected: collectedOf(r) }));
  const exp = rows.reduce((s, r) => s + num(r.payment_expected), 0);
  const col = rows.reduce((s, r) => s + r.collected, 0);
  const st = {};
  for (const r of rows) { const k = K(r.todays_status) || '(BLANK)'; st[k] = (st[k] || 0) + 1; }
  const teamsSeen = [...new Set(rows.map(r => r.team).filter(Boolean))].sort();
  return {
    weekday: wd, date: snap.date, requestedDate: date, fellBack, type,
    weekdays: WD5, todayWeekday: currentWeekday(nowMs),
    rows, count: rows.length, teams: teamsSeen,
    totals: { expected: exp, collected: col, uncollected: uncollectedOf(rows),
      pct: exp > 0 ? Math.round((col / exp) * 1000) / 10 : null,
      installments: rows.length,
      paid: rows.filter(r => ['PAID', 'OVERPAID'].includes(K(r.todays_status))).length,
      unpaid: rows.filter(r => K(r.todays_status) === 'UNPAID').length,
      underpaid: rows.filter(r => K(r.todays_status) === 'UNDERPAID').length },
    byStatus: Object.keys(st).sort().map(k => ({ status: k, count: st[k] })),
  };
}

/* ---------------------------------------------------------------------------- teams & staff */
/** The supervisory distribution is edited here, not re-uploaded: a team's Recovery/GMO/
    Manager/OPM/Credit/Expected/Bike columns are exactly what the assignment rotation and
    every leader report read, so a reassignment has to be a one-field edit. */
async function saveTeam(db, user, p) {
  requireAdmin(user);
  const team = normTeamName(p && p.team);
  if (!team) throw badRequest('team is required');
  const row = { team };
  for (const c of ['opm', 'recovery', 'gmo', 'manager', 'credit', 'expected', 'bike']) {
    if (p[c] !== undefined) row[c] = String(p[c] || '').trim() || null;
  }
  row.updated_at = new Date().toISOString();
  const { error } = await db.from('teams').upsert(row, { onConflict: 'team' });
  if (error) throw new Error(error.message);
  return { team };
}
async function deleteTeam(db, user, p) {
  requireAdmin(user);
  const team = normTeamName(p && p.team);
  if (!team) throw badRequest('team is required');
  // Every snapshot, loan and call user references teams(team); deleting one with data would
  // be refused by the database anyway, so say so in words the admin can act on.
  const { data: used } = await db.from('loans').select('id').eq('team', team).limit(1);
  if (used && used.length) throw badRequest(`Team ${team} still has loans attached -- reassign them first.`);
  const { error } = await db.from('teams').delete().eq('team', team);
  if (error) throw new Error(error.message);
  return { team };
}
function normTeamName(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

/** Tips, from the Hints sheet: tab-scoped, bilingual, admin-editable without a deploy. */
async function hints(db, user) {
  const rows = await fetchAll(() => db.from('hints').select('*'));
  const en = {}, sw = {};
  for (const r of rows) {
    const t = String(r.tab || '').trim().toLowerCase();
    const m = String(r.message || '').trim(), s = String(r.sw_message || '').trim();
    if (!t || (!m && !s)) continue;
    (en[t] = en[t] || []).push(m || s);
    (sw[t] = sw[t] || []).push(s || m);
  }
  return { tips: { en, sw } };
}

/* =======================================================================================
   THE OFFICER BOARDS -- the bottom half of the dashboard.

   The headline cards say WHERE things stand; these say WHO. Every board pairs a "today"
   view with a "this week" view, because a bad day is noise and a bad week is a problem.
   Officers are resolved from the teams table's role columns, so the same reassignment that
   re-points the recycling rotation also re-points these boards.
   ======================================================================================= */

function officerOf(teamBy, team, roleCol) {
  const t = teamBy[K(team)];
  return (t && t[roleCol]) ? String(t[roleCol]).trim() : '(unassigned)';
}
function bucket(map, key, init) { if (!map[key]) map[key] = Object.assign({ key }, init); return map[key]; }
function pctOf(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : null; }

async function officerBoards(db, user, _args, nowMs) {
  const today = todayKey(nowMs), mon = weekMondayKey(nowMs), fri = addDaysKey(mon, 4), sun = addDaysKey(mon, 6);
  const wd = currentWeekday(nowMs);

  const [teamRows, expWeek, tomorrow, defWeek, fu, loansAll, callLogs] = await Promise.all([
    fetchAll(() => db.from('teams').select('*')),
    snapshotsInRange(db, 'repayment_snapshots', { snapshot_type: 'today' }, mon, fri),
    latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'tomorrow' }, { notAfter: today }),
    snapshotsInRange(db, 'defaulter_snapshots', {}, mon, sun),
    fetchAll(() => db.from('followup_status').select('*')),
    fetchAll(() => db.from('loans').select('*')),
    fetchAll(() => db.from('call_logs').select('*').gte('call_date', mon).lte('call_date', sun)),
  ]);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  const myExp = scoped(user, expWeek), myDef = scoped(user, defWeek);
  const myTmrw = scoped(user, tomorrow.rows), myFu = scoped(user, fu);
  const myLoans = scoped(user, loansAll), myCalls = scoped(user, callLogs);
  const onDate = (rows, d, type) => pickLatestBatchRows(rows.filter(r =>
    String(r.snapshot_date) === d && (!type || r.snapshot_type === type)));

  /* ---- EARLY COLLECTION: judged on tomorrow's (kesho) list, per Expected officer ---- */
  function earlyBoard(rows) {
    const m = {};
    for (const r of rows) {
      const b = bucket(m, officerOf(teamBy, r.team, 'expected'), { uncollected: 0, paidOver: 0, expected: 0, collected: 0 });
      const c = collectedOf(r);
      b.expected += num(r.payment_expected); b.collected += c;
      b.uncollected += Math.max(0, num(r.payment_expected) - c);
      if (['PAID', 'OVERPAID'].includes(K(r.todays_status))) b.paidOver += 1;
    }
    return Object.values(m).map(b => ({ officer: b.key, uncollected: b.uncollected, paidOver: b.paidOver,
      expected: b.expected, collected: b.collected, pct: pctOf(b.collected, b.expected) }))
      .sort((a, b) => b.uncollected - a.uncollected);
  }
  const earlyToday = earlyBoard(myTmrw);
  const earlyWeek = earlyBoard(myExp);

  /* ---- RECOVERY: per Recovery officer. Today = that day's initial vs current over the
         WEEK's uncollected (the live system's own denominator for this card). Week = Monday's
         initial vs today's current, with DEBT CRISIS showing new debt that landed mid-week
         (current above initial) and RECOVERED summed from each day's own movement. ---- */
  const weekUncol = WD5.reduce((s, w, i) => s + uncollectedOf(onDate(myExp, addDaysKey(mon, i))), 0);
  function recBoard(iniRows, curRows, dailyRecovered) {
    const m = {};
    for (const r of iniRows) bucket(m, officerOf(teamBy, r.team, 'recovery'), { initial: 0, current: 0, recovered: 0, uncollected: 0 }).initial += num(r.arrears);
    for (const r of curRows) bucket(m, officerOf(teamBy, r.team, 'recovery'), { initial: 0, current: 0, recovered: 0, uncollected: 0 }).current += num(r.arrears);
    for (const r of myExp) bucket(m, officerOf(teamBy, r.team, 'recovery'), { initial: 0, current: 0, recovered: 0, uncollected: 0 })
      .uncollected += Math.max(0, num(r.payment_expected) - collectedOf(r));
    if (dailyRecovered) for (const k of Object.keys(dailyRecovered)) bucket(m, k, { initial: 0, current: 0, recovered: 0, uncollected: 0 }).recovered += dailyRecovered[k];
    return Object.values(m).map(b => {
      const rec = dailyRecovered ? b.recovered : (b.initial - b.current);
      return { officer: b.key, initial: b.initial, current: b.current, uncollected: b.uncollected,
        debtCrisis: Math.min(0, b.initial - b.current), recovered: rec, pct: pctOf(rec, b.uncollected) };
    }).sort((a, b) => b.recovered - a.recovered);
  }
  const iniToday = onDate(myDef, today, 'initial'), curToday = onDate(myDef, today, 'current');
  const recToday = recBoard(iniToday, curToday, null).map(r => ({ ...r, uncollected: weekUncol && r.uncollected ? r.uncollected : r.uncollected, pct: pctOf(r.recovered, r.uncollected) }));
  // Week: each day's own (initial - current) summed per officer, exactly like the trend row.
  const dailyRec = {};
  for (let i = 0; i < 7; i++) {
    const d = addDaysKey(mon, i);
    const ini = onDate(myDef, d, 'initial'), cur = onDate(myDef, d, 'current');
    if (!ini.length || !cur.length) continue;
    const per = {};
    for (const r of ini) per[officerOf(teamBy, r.team, 'recovery')] = (per[officerOf(teamBy, r.team, 'recovery')] || 0) + num(r.arrears);
    for (const r of cur) per[officerOf(teamBy, r.team, 'recovery')] = (per[officerOf(teamBy, r.team, 'recovery')] || 0) - num(r.arrears);
    for (const k of Object.keys(per)) dailyRec[k] = (dailyRec[k] || 0) + per[k];
  }
  const iniMon = onDate(myDef, mon, 'initial');
  const recWeek = recBoard(iniMon, curToday, dailyRec);

  /* ---- CREDIT ANALYSTS: applications they processed, against the sales target ---- */
  const weeklyTarget = await settingNum(db, 'SALES_TARGET_WEEKLY', await settingNum(db, 'SALES_TARGET', 100000000));
  function creditBoard(from, to) {
    const m = {};
    for (const l of myLoans) {
      const d = String(l.approved_date || '').slice(0, 10);
      if (!d || d < from || d > to) continue;
      const b = bucket(m, String(l.created_by || l.approved_by || '(unassigned)').trim() || '(unassigned)',
        { apps: 0, amount: 0, teams: {} });
      b.apps++; b.amount += num(l.principal_amt) || num(l.loan_amt);
      if (l.team) b.teams[K(l.team)] = 1;
    }
    const span = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1);
    const target = weeklyTarget * (span / 7);
    return Object.values(m).map(b => {
      // Their recovery share: the movement on the teams whose files they actually processed.
      let ini = 0, cur = 0, unc = 0;
      for (const r of iniToday) if (b.teams[K(r.team)]) ini += num(r.arrears);
      for (const r of curToday) if (b.teams[K(r.team)]) cur += num(r.arrears);
      for (const r of myExp) if (b.teams[K(r.team)]) unc += Math.max(0, num(r.payment_expected) - collectedOf(r));
      const salesPct = pctOf(b.amount, target), recPct = pctOf(ini - cur, unc);
      return { analyst: b.key, apps: b.apps, amount: b.amount, salesPct, recPct,
        perf: (salesPct == null && recPct == null) ? null : Math.round(((salesPct || 0) + (recPct || 0)) / 2 * 10) / 10 };
    }).sort((a, b) => b.apps - a.apps);
  }
  const creditToday = creditBoard(today, today);
  const creditWeek = creditBoard(mon, sun);

  /* ---- CALL AGENTS ---- */
  function callBoard(from, to) {
    const m = {};
    for (const c of myCalls) {
      const d = String(c.call_date || '').slice(0, 10);
      if (!d || d < from || d > to) continue;
      const b = bucket(m, String(c.officer || '(unknown)').trim() || '(unknown)',
        { calls: 0, duration: 0, portfolio: 0, connected: 0, customers: {} });
      b.calls++; b.duration += num(c.duration);
      if (c.portfolio) { b.portfolio++; b.customers[String(c.ref || c.phone)] = 1; }
      if (K(c.outcome) === 'CONNECTED' || !c.outcome) b.connected++;
    }
    return Object.values(m).map(b => ({ agent: b.key, calls: b.calls, duration: b.duration,
      portfolio: b.portfolio, customers: Object.keys(b.customers).length,
      connectPct: pctOf(b.connected, b.calls), portfolioPct: pctOf(b.portfolio, b.calls) }))
      .sort((a, b) => b.calls - a.calls);
  }
  const callToday = callBoard(today, today);
  const callWeek = callBoard(mon, sun);

  /* ---- FOLLOW-UP STATUS across ALL defaulters (what the whole book looks like) ---- */
  const real = myFu.filter(r => !(r.status == null && r.arrears == null));
  const fsm = {};
  for (const r of real) {
    const b = bucket(fsm, K(r.fu_status) || 'HAIJAFUATILIWA / NOT TOUCHED', { customers: 0, arrears: 0 });
    b.customers++; b.arrears += num(r.arrears);
  }
  const fuStatus = Object.values(fsm).map(b => ({ status: b.key, customers: b.customers, arrears: b.arrears,
    pct: pctOf(b.customers, real.length) })).sort((a, b) => b.customers - a.customers);

  return { weekday: wd, weekOf: mon, today,
    earlyToday, earlyWeek, recToday, recWeek, creditToday, creditWeek, callToday, callWeek,
    fuStatus, fuTotal: real.length,
    weekUncollected: weekUncol };
}
