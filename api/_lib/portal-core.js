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
  // The same rotation decides who owns these customers -- they are on BOTH lists, and the
  // officer working Expected needs to know which recycling leader already has the defaulter.
  const [teamRows, strat] = await Promise.all([fetchAll(() => db.from('teams').select('*')), assignStrategy(db)]);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  const rows = scoped(user, exp.rows).filter(e => defBy[String(e.ref)]).map(e => {
    const d = defBy[String(e.ref)];
    const a = assignFor(d, strat, nowMs);
    const team = teamBy[K(e.team)] || {};
    return { ref: e.ref, full_name: e.full_name, contact: e.contact, team: e.team,
      payment_expected: num(e.payment_expected), todays_status: e.todays_status,
      def_arrears: num(d.arrears), status: d.status, ds: d.ds, dc: d.dc,
      phase: a.phase, role: a.role, cycle: a.label,
      leader: team[ROLE_COLS[a.role]] || '(unassigned)' };
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
  dashboardFull, expectedDay, saveTeam, deleteTeam, hints,
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
