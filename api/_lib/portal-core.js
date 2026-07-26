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

/** Expected Defaulters: customers who are on today's Expected sheet AND in the current
    defaulter deck -- the ones an officer can collect from twice over. Matched by REF. */
async function expectedDefaulters(db, user, _args, nowMs) {
  const [exp, def] = await Promise.all([
    latestSnapshot(db, 'repayment_snapshots', { snapshot_type: 'today' }, { notAfter: todayKey(nowMs) }),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current', weekday: currentWeekday(nowMs) }, { notAfter: todayKey(nowMs) }),
  ]);
  const defBy = {};
  for (const d of def.rows) defBy[String(d.ref)] = d;
  const rows = scoped(user, exp.rows).filter(e => defBy[String(e.ref)]).map(e => {
    const d = defBy[String(e.ref)];
    return { ref: e.ref, full_name: e.full_name, contact: e.contact, team: e.team,
      payment_expected: num(e.payment_expected), todays_status: e.todays_status,
      def_arrears: num(d.arrears), status: d.status, ds: d.ds, dc: d.dc };
  });
  return { rows, count: rows.length,
    expected: rows.reduce((s, r) => s + r.payment_expected, 0),
    arrears: rows.reduce((s, r) => s + r.def_arrears, 0) };
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
async function promises(db, user, _args, nowMs) {
  const today = todayKey(nowMs);
  const all = scoped(user, await fetchAll(() => db.from('followup_status').select('*').eq('fu_status', 'AMETOA AHADI')));
  const rows = all.map(r => ({
    ...r,
    bucket: !r.promise_date ? 'no date' : String(r.promise_date) < today ? 'overdue' : String(r.promise_date) === today ? 'today' : 'upcoming',
  }));
  const order = { overdue: 0, today: 1, upcoming: 2, 'no date': 3 };
  rows.sort((a, b) => (order[a.bucket] - order[b.bucket]) || String(a.promise_date || '').localeCompare(String(b.promise_date || '')));
  const counts = { overdue: 0, today: 0, upcoming: 0, 'no date': 0 };
  for (const r of rows) counts[r.bucket]++;
  return { rows, count: rows.length, counts,
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
  return {
    from: fromKey, to: toKey,
    byStatus: Object.values(byStatus).sort((a, b) => b.customers - a.customers),
    byTeam: Object.values(byTeam).sort((a, b) => a.team.localeCompare(b.team)),
    byOfficer: Object.values(byOfficer).map(o => ({ officer: o.officer, comments: o.comments, customers: Object.keys(o.customers).length }))
      .sort((a, b) => b.comments - a.comments),
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
async function par(db, user, _args, nowMs) {
  const snap = await latestSnapshot(db, 'defaulter_snapshots',
    { snapshot_type: 'current', weekday: currentWeekday(nowMs) }, { notAfter: todayKey(nowMs) });
  const rows = scoped(user, snap.rows);
  const bands = PAR_BANDS.map(b => ({ band: b.key, customers: 0, arrears: 0 }));
  const byStatus = {}, byTeam = {};
  for (const r of rows) {
    const days = num(r.days_elapsed) || num(r.dc);
    const i = PAR_BANDS.findIndex(b => days >= b.lo && days <= b.hi);
    if (i >= 0) { bands[i].customers++; bands[i].arrears += num(r.arrears); }
    const st = r.status || '(none)';
    if (!byStatus[st]) byStatus[st] = { status: st, customers: 0, arrears: 0 };
    byStatus[st].customers++; byStatus[st].arrears += num(r.arrears);
    const t = r.team || '(no team)';
    if (!byTeam[t]) byTeam[t] = { team: t, customers: 0, arrears: 0 };
    byTeam[t].customers++; byTeam[t].arrears += num(r.arrears);
  }
  return { date: snap.date, weekday: currentWeekday(nowMs), bands,
    byStatus: Object.values(byStatus).sort((a, b) => b.arrears - a.arrears),
    byTeam: Object.values(byTeam).sort((a, b) => b.arrears - a.arrears),
    totals: { customers: rows.length, arrears: rows.reduce((s, r) => s + num(r.arrears), 0) } };
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
  return { weekOf: mon, weekEnd: fri, days,
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

/** My Commission: recovered per officer's team(s) times the configured rate. The rate lives
    in settings (COMMISSION_RATE, a percentage) so finance can change it without a deploy. */
async function commission(db, user, _args, nowMs) {
  const tp = await teamProgress(db, user, {}, nowMs);
  const { data: rateRow } = await db.from('settings').select('value').eq('key', 'COMMISSION_RATE').maybeSingle();
  const rate = num(rateRow && rateRow.value) || 0;
  const rows = tp.rows.map(r => ({ team: r.team, recovered: r.recovered, progress: r.progress,
    commission: Math.max(0, r.recovered) * (rate / 100) }));
  return { rate, weekday: tp.weekday, date: tp.date, paired: tp.paired, rows,
    totals: { recovered: rows.reduce((s, r) => s + r.recovered, 0), commission: rows.reduce((s, r) => s + r.commission, 0) },
    note: tp.note };
}

/** Defaulter Assignment: the current deck joined to who is following it up, so a leader can
    see which customers nobody has touched. */
async function assignments(db, user, _args, nowMs) {
  const [snap, fu] = await Promise.all([
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current', weekday: currentWeekday(nowMs) }, { notAfter: todayKey(nowMs) }),
    fetchAll(() => db.from('followup_status').select('ref, fu_status, comment_by, comment_at, promise_date')),
  ]);
  const byRef = {};
  for (const f of fu) byRef[String(f.ref)] = f;
  const rows = scoped(user, snap.rows).map(r => {
    const f = byRef[String(r.ref)] || {};
    return { ref: r.ref, full_name: r.full_name, contact: r.contact, team: r.team, arrears: num(r.arrears),
      status: r.status, ds: r.ds, dc: r.dc, days_elapsed: r.days_elapsed,
      fu_status: f.fu_status || '', officer: f.comment_by || '', touched_at: f.comment_at || '',
      promise_date: f.promise_date || '' };
  }).sort((a, b) => b.arrears - a.arrears);
  const untouched = rows.filter(r => !r.fu_status);
  return { date: snap.date, weekday: currentWeekday(nowMs), rows, count: rows.length,
    untouched: untouched.length, untouchedArrears: untouched.reduce((s, r) => s + r.arrears, 0) };
}

/** Credit Analysts: throughput per assessor across the assessment stages. */
async function credit(db, user) {
  const rows = scoped(user, await fetchAll(() => db.from('loans').select('*')
    .in('stage', ['assessed', 'pending_approval', 'approved', 'pending_disb', 'disbursed'])));
  const by = {};
  for (const r of rows) {
    const who = r.created_by || r.assigned_by || '(unassigned)';
    if (!by[who]) by[who] = { analyst: who, assessed: 0, approved: 0, disbursed: 0, amount: 0 };
    by[who].assessed++;
    if (r.stage === 'approved' || r.stage === 'pending_disb' || r.stage === 'disbursed') by[who].approved++;
    if (r.stage === 'disbursed') by[who].disbursed++;
    by[who].amount += num(r.principal_amt) || num(r.loan_amt);
  }
  return { rows: Object.values(by).sort((a, b) => b.assessed - a.assessed), count: rows.length };
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
  par, weekly, teamProgress, commission, assignments, credit,
  teams, settings: settingsList, settingSet,
  accessCodes, saveAccessCode, deleteAccessCode, callUsers, removeCallUser,
  callReport: (db, user, a, now) => reportCoreForPortal(db, user, a, now),
};

export async function portalApi(db, user, fn, args, nowMs = Date.now()) {
  const h = FN[fn];
  if (!h) throw badRequest('Unknown portal function: ' + fn);
  return h(db, user, args || {}, nowMs);
}

export const PORTAL_FUNCTIONS = Object.keys(FN);
