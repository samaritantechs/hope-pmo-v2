import { fetchAll } from './supabase.js';
import { teamAllowed, ADMIN_TABS } from './auth.js';
import { generatePasscode, hashPasscode } from './passcode.js';
import { todayKey, currentWeekday, isoWeekday, weekMondayKey, addDaysKey } from './time.js';
import { latestSnapshot, snapshotsInRange } from './snapshots.js';
import { collectedOf, uncollectedOf, num } from './recovery.js';
import { buildDashboard } from './dashboard-core.js';
import { reportCoreForPortal, pnorm, h36 } from './call-core.js';
import { ROLE_COLS, assignFor, assignStrategy } from './assign.js';
import { expdfMine, expdfReport } from './expdf.js';

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

/** The pipeline, filterable by stage -- but ALL stages is a real choice and the default,
    because "where is every application right now" is the question this tab gets asked most,
    and forcing a stage first meant a docket could only be found if you already knew which
    stage it had reached. */
async function loans(db, user, { stage }) {
  const st = STAGES.includes(stage) ? stage : '';
  const q = db.from('loans').select('*');
  const rows = await fetchAll(() => (st ? q.eq('stage', st) : q).order('created_at', { ascending: false }));
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
/* THE TAB RECOVERY OFFICERS LIVE IN ALL DAY.

   It was rendering twelve of its columns and carrying the rest silently: the guarantor and
   their number, the disbursement and last-transaction dates, days-in-cycle, and the last
   comment were all being fetched and then thrown away by the screen. An officer whose customer
   will not answer rings the guarantor -- and had to open a second tab to find the number.

   Two fields are not in followup_status and are assembled here:

   NEW NUMBER -- when a customer's number is dead, the officer logs a replacement against the
   follow-up. It lives on the comment, so the newest one per customer is carried up to the row.

   RECOVERED -- what has actually come back off this customer since the baseline. The rule
   already exists in expdf.js (today's own INITIAL deck, and zero rather than a fabricated
   number when that customer is not in it), so the same baseline is used here rather than a
   second, differently-computed truth appearing on a second screen. */
async function followup(db, user, args = {}, nowMs = Date.now()) {
  const today = todayKey(nowMs);
  const [raw, comments, iniSnap] = await Promise.all([
    fetchAll(() => db.from('followup_status').select('*').order('arrears', { ascending: false })),
    fetchAll(() => db.from('followup_comments').select('ref, new_number, created_at')),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'initial', weekday: currentWeekday(nowMs) },
      { notAfter: today, teams: user.teams }),
  ]);
  const rows = scoped(user, raw);

  // Newest replacement number per customer.
  const newNo = {};
  for (const c of comments) {
    const n = String(c.new_number == null ? '' : c.new_number).trim();
    if (!n) continue;
    const k = String(c.ref);
    const at = String(c.created_at || '');
    if (!newNo[k] || at > newNo[k].at) newNo[k] = { at, n };
  }
  const baseBy = {};
  for (const d of iniSnap.rows) baseBy[String(d.ref).trim().toUpperCase()] = num(d.arrears);

  // Pure FK stubs (created so an Expected customer's comment can be stored) are not defaulters.
  const real = rows.filter(r => !(r.status == null && r.arrears == null)).map(r => {
    const arrears = num(r.arrears);
    const key = String(r.ref == null ? '' : r.ref).trim().toUpperCase();
    const initial = Object.prototype.hasOwnProperty.call(baseBy, key) ? baseBy[key] : arrears;
    return {
      ...r,
      new_no: (newNo[String(r.ref)] || {}).n || null,
      initial,
      recovered: Math.max(0, initial - arrears),
      // The month of the last transaction, so the screen can offer "any month" as a filter
      // without every browser having to work the same thing out from a date string.
      last_trans_month: String(r.last_trans || '').slice(0, 7) || null,
    };
  });
  return {
    rows: real, count: real.length,
    arrears: real.reduce((s, r) => s + num(r.arrears), 0),
    recovered: real.reduce((s, r) => s + num(r.recovered), 0),
    // Newest first, so the month someone actually wants is at the top of the list.
    months: [...new Set(real.map(r => r.last_trans_month).filter(Boolean))].sort().reverse(),
  };
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

/** The complaint register is an accountability record, so it is date-ranged like the rest of
    the registers and carries its own controlled vocabularies -- a free-text category column
    cannot be counted, and counting complaints by category is the entire point of keeping one. */
const CX_CATEGORIES = ['Malipo / Payment', 'Riba / Interest', 'Mtaji / Principal', 'Afisa / Officer conduct',
  'Muda / Turnaround', 'Simu / Phone or app', 'Nyingine / Other'];
const CX_CHANNELS = ['Simu / Call', 'Ujumbe / SMS', 'WhatsApp', 'Ana kwa ana / Walk-in', 'Kiongozi / Via leader'];
const CX_STATUSES = ['Open', 'In progress', 'Resolved'];
const cxOpen = s => K(s) !== 'CLOSED' && K(s) !== 'RESOLVED';

async function complaints(db, user, { from, to } = {}, nowMs) {
  const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? from : addDaysKey(todayKey(nowMs), -30);
  const toKey = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? to : todayKey(nowMs);
  const all = await fetchAll(() => db.from('complaints').select('*').order('created_at', { ascending: false }));
  const rows = scoped(user, all).filter(r => {
    const d = dayOf(r.created_at);
    return d >= fromKey && d <= toKey;
  });
  const today = todayKey(nowMs);
  const teamRows = await fetchAll(() => db.from('teams').select('team'));
  return { rows, count: rows.length, from: fromKey, to: toKey,
    open: rows.filter(r => cxOpen(r.status)).length,
    resolved: rows.filter(r => !cxOpen(r.status)).length,
    loggedToday: rows.filter(r => dayOf(r.created_at) === today).length,
    categories: CX_CATEGORIES, channels: CX_CHANNELS, statuses: CX_STATUSES,
    teams: teamRows.map(t => t.team).filter(t => teamAllowed(user, t)).sort() };
}

/** One saver for both new and existing complaints -- v1 let you correct any field afterwards,
    and a register you cannot correct gets worked around on paper instead. Every save writes a
    complaint_log row: the table existed from the start but nothing wrote to it, so the "who
    changed this, and when" question the register exists to answer had no data behind it. */
async function saveComplaint(db, user, p, nowMs) {
  if (!p || !String(p.complainant || '').trim()) throw badRequest('A complainant name is required.');
  if (p.team && !teamAllowed(user, p.team)) throw forbidden(`You do not have access to team ${p.team}.`);
  const at = new Date(nowMs).toISOString();
  const status = CX_STATUSES.includes(p.status) ? p.status : 'Open';
  const fields = {
    ref: p.ref || null, team: p.team || null, complainant: String(p.complainant).trim(),
    phone: p.phone || null, category: p.category || null, channel: p.channel || null,
    details: p.details || null, resolution: p.resolution || null, status,
  };
  let id = p.id || null, action;
  if (id) {
    const { data: prev } = await db.from('complaints').select('*').eq('id', id).maybeSingle();
    if (!prev) throw badRequest('That complaint no longer exists.');
    if (!teamAllowed(user, prev.team)) throw forbidden(`You do not have access to team ${prev.team}.`);
    // Resolving is a distinct event from editing, and stamps who closed it.
    if (!cxOpen(status) && cxOpen(prev.status)) { fields.resolved_by = user.name; fields.resolved_at = at; }
    const { error } = await db.from('complaints').update(fields).eq('id', id);
    if (error) throw new Error(error.message);
    action = cxOpen(prev.status) && !cxOpen(status) ? 'resolved' : 'edited';
  } else {
    // created_at carries both the date and the time it came in. Back-dating a complaint should
    // move the date; registering one today must NOT throw away the time of day, which stamping
    // midnight did -- it also silently reordered the register against same-day entries.
    const stamp = (p.date && p.date !== todayKey(nowMs)) ? p.date + 'T12:00:00Z' : at;
    const { data, error } = await db.from('complaints').insert({
      ...fields, logged_by: user.name, created_at: stamp,
    }).select('*');
    if (error) throw new Error(error.message);
    id = data && data[0] && data[0].id;
    action = 'registered';
  }
  const { error: lErr } = await db.from('complaint_log').insert({
    complaint_id: id, team: fields.team, action, status,
    note: fields.resolution || fields.details || null, created_by: user.name, created_at: at,
  });
  if (lErr) throw new Error(lErr.message);
  return { id, action };
}
async function complaintLog(db, user, { id }) {
  if (!id) throw badRequest('id is required');
  const { data: cx } = await db.from('complaints').select('team').eq('id', id).maybeSingle();
  if (cx && !teamAllowed(user, cx.team)) throw forbidden(`You do not have access to team ${cx.team}.`);
  const rows = await fetchAll(() => db.from('complaint_log').select('*')
    .eq('complaint_id', id).order('created_at', { ascending: false }));
  return { rows, count: rows.length };
}
// Kept so an older cached page still resolves a complaint instead of erroring.
async function resolveComplaint(db, user, p, nowMs) {
  if (!p || !p.id) throw badRequest('id is required');
  const { data: prev } = await db.from('complaints').select('*').eq('id', p.id).maybeSingle();
  if (!prev) throw badRequest('That complaint no longer exists.');
  return saveComplaint(db, user, { ...prev, id: p.id, status: p.status || 'Resolved',
    resolution: p.resolution || null }, nowMs);
}
const addComplaint = saveComplaint;

/** Loan restructuring. A restructure is a written offer: the customer pays something now, and
    whatever is left -- optionally with fresh interest -- is rescheduled into N weekly
    installments. Every number is derived, so NONE of it is taken from the client:

      remaining = arrears − first payment
      interest  = remaining × RESTRUCTURE_INTEREST_PCT (only if applied)
      total     = remaining + interest
      per       = total ÷ count, rounded to the nearest 500 (the note sizes people actually pay)

    The last installment absorbs the rounding so the schedule adds up to the total exactly.
    Only defaulters who have missed RESTRUCTURE_MIN_DC installments qualify -- restructuring
    someone who missed one payment just discounts the loan. */
const RX_ROUND = 500;
async function restructureStrategy(db) {
  const months = Math.max(1, await settingNum(db, 'RESTRUCTURE_MAX_MONTHS', 4));
  const interestPct = Math.max(0, await settingNum(db, 'RESTRUCTURE_INTEREST_PCT', 12));
  const minDc = Math.max(1, await settingNum(db, 'RESTRUCTURE_MIN_DC', 4));
  const { data: appr } = await db.from('settings').select('value').eq('key', 'RESTRUCTURE_APPROVERS').maybeSingle();
  const approvers = String((appr && appr.value) || '').split(',').map(x => K(x)).filter(Boolean);
  return { maxMonths: months, maxInstallments: months * 4, interestPct, minDc,
    approvers: approvers.length ? approvers : ['MANAGER', 'ADMIN'] };
}
function canApproveRestructure(user, strat) {
  if ((user.tabs || []).includes('settings')) return true;
  return strat.approvers.includes(K(user.role));
}
function restructureCompute(arrears, firstAmt, count, interestOn, interestPct) {
  arrears = Math.max(0, num(arrears));
  firstAmt = Math.min(Math.max(0, num(firstAmt)), arrears);
  const remaining = arrears - firstAmt;
  const interest = interestOn ? Math.round(remaining * (interestPct / 100)) : 0;
  const total = remaining + interest;
  count = Math.max(1, Math.floor(num(count)));
  // Rounding to the nearest 500 can land on ZERO when the count is large against a small
  // total, which would print a schedule of 0, 0, 0, <everything>. An installment is never
  // nothing: floor it at the rounding unit and let addRestructure reject a count that the
  // total cannot actually carry.
  const per = total > 0 ? Math.max(RX_ROUND, Math.round(total / count / RX_ROUND) * RX_ROUND) : 0;
  return { arrears, first: firstAmt, remaining, interest, total, count, per,
    last: total - per * (count - 1) };
}
/** Weekly dates from the first payment date, with the last one carrying the remainder. */
function restructureSchedule(total, count, per, startKey) {
  count = Math.max(1, Math.floor(num(count)));
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ n: i + 1, date: startKey ? addDaysKey(startKey, 7 * i) : null,
      amount: i === count - 1 ? total - per * (count - 1) : per });
  }
  return out;
}

/* THE RESTRUCTURING CONTRACT -- the one document here a customer actually signs.

   The figures were already being worked out and stored; there was simply nothing to put in
   front of the customer. Built the same way as the demand notice, from ONE set of numbers, so
   what is on the paper and what is in the books cannot drift: the schedule comes from
   restructureSchedule() rather than being re-derived for printing.

   Swahili, because the person signing it reads Swahili. Laid out for A4 with the company's
   stamp and signature, and with two signature lines -- the customer's and the guarantor's --
   because a restructuring that the guarantor has not agreed to is not worth the paper. */
function restructureContractHtml(t) {
  const img = (src, style, alt) => src ? `<img src="${esc_(src)}" style="${style}" alt="${alt}">` : '';
  const rows = t.schedule.map(s => `<tr><td style="text-align:center">${s.n}</td>`
    + `<td>${esc_(s.date || '—')}</td>`
    + `<td style="text-align:right">${fmtM(s.amount)}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="sw"><head><meta charset="UTF-8">
<title>Mkataba wa Marekebisho ya Mkopo — ${esc_(t.ref)}</title>
<style>
  @page{size:A4;margin:16mm}
  body{font-family:Georgia,'Times New Roman',serif;font-size:12pt;line-height:1.55;color:#000;margin:0}
  .hd{display:flex;align-items:center;gap:14px;border-bottom:2px solid #000;padding-bottom:10px}
  .hd .co{font-size:15pt;font-weight:bold;letter-spacing:.5px}
  .hd .sub{font-size:9.5pt}
  h1{font-size:13.5pt;text-align:center;margin:18px 0 4px;text-transform:uppercase;letter-spacing:.5px}
  .ref{text-align:center;font-size:10pt;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;margin:10px 0}
  th,td{border:1px solid #000;padding:5px 7px;font-size:11pt}
  th{background:#eee;text-align:left}
  .kv td{border:0;padding:2px 0;font-size:11.5pt}
  .kv td:first-child{width:42%;color:#333}
  .tot{font-weight:bold;background:#f4f4f4}
  .sig{display:flex;gap:26px;margin-top:26px}
  .sig div{flex:1}
  .line{border-bottom:1px solid #000;height:44px;margin-bottom:4px}
  .fine{font-size:9.5pt;color:#333;margin-top:14px;border-top:1px solid #999;padding-top:8px}
</style></head><body>
<div class="hd">${img(t.logo, 'height:52px', 'logo')}
  <div><div class="co">${esc_(t.brand)}</div><div class="sub">${esc_(t.motto || '')}</div></div></div>

<h1>Mkataba wa Marekebisho ya Marejesho</h1>
<div class="ref">Kumb. Na. ${esc_(t.ref)} &nbsp;·&nbsp; Tarehe: ${esc_(t.date)} &nbsp;·&nbsp; Timu: ${esc_(t.team)}</div>

<table class="kv">
  <tr><td>Jina la mteja / Customer</td><td><b>${esc_(t.name)}</b></td></tr>
  <tr><td>Namba ya simu / Contact</td><td>${esc_(t.contact || '—')}</td></tr>
  <tr><td>Mdhamini / Guarantor</td><td>${esc_(t.guarantor || '—')} ${esc_(t.guarantorContact || '')}</td></tr>
  <tr><td>Deni lililokuwepo / Arrears at agreement</td><td><b>TZS ${fmtM(t.arrears)}</b></td></tr>
  <tr><td>Malipo ya kwanza / First payment</td><td>TZS ${fmtM(t.first)}</td></tr>
  <tr><td>Salio / Remaining</td><td>TZS ${fmtM(t.remaining)}</td></tr>
  ${t.interest ? `<tr><td>Riba / Interest (${esc_(t.interestPct)}%)</td><td>TZS ${fmtM(t.interest)}</td></tr>` : ''}
  <tr><td>Jumla ya kulipa / Total payable</td><td><b>TZS ${fmtM(t.total)}</b></td></tr>
  <tr><td>Idadi ya awamu / Installments</td><td>${esc_(t.count)} (kila wiki / weekly)</td></tr>
</table>

<table>
  <thead><tr><th style="width:12%;text-align:center">Awamu</th><th>Tarehe / Date</th>
    <th style="text-align:right;width:32%">Kiasi / Amount (TZS)</th></tr></thead>
  <tbody>${rows}
    <tr class="tot"><td colspan="2">JUMLA / TOTAL</td>
      <td style="text-align:right">${fmtM(t.total)}</td></tr></tbody>
</table>

<p>Mimi, <b>${esc_(t.name)}</b>, ninakubali kulipa deni langu kwa mpangilio ulioonyeshwa hapo juu.
Nakubali kwamba nikishindwa kulipa awamu yoyote kwa tarehe yake, mkataba huu unaweza kusitishwa
na ${esc_(t.brand)} kuendelea na hatua za awali za urejeshaji wa deni, ikiwemo notisi ya madai.</p>
<p style="font-size:10.5pt;color:#333">I agree to repay the balance shown above on the dates shown.
If any installment is missed, this agreement may be cancelled and normal recovery action,
including a demand notice, may continue.</p>

<div class="sig">
  <div><div class="line"></div>Sahihi ya mteja / Customer<br><b>${esc_(t.name)}</b></div>
  <div><div class="line"></div>Sahihi ya mdhamini / Guarantor<br><b>${esc_(t.guarantor || '')}</b></div>
  <div><div class="line">${img(t.sign, 'max-height:40px', 'signature')}</div>
    Kwa niaba ya / For ${esc_(t.brand)}<br><b>${esc_(t.officer || '')}</b>
    ${img(t.stamp, 'max-height:64px;margin-top:6px', 'stamp')}</div>
</div>

<div class="fine">Mkataba huu umetolewa na ${esc_(t.brand)} tarehe ${esc_(t.date)}.
Hali ya ombi / Status: ${esc_(t.status || 'Pending')}.</div>
</body></html>`;
}

/** The contract for one restructuring, ready to print. Reads the stored row rather than
    recomputing, so a contract printed a week after approval says exactly what was approved. */
async function restructureContract(db, user, { id, ref } = {}) {
  const all = await fetchAll(() => db.from('restructures').select('*'));
  const row = id ? all.find(r => String(r.id) === String(id))
    : all.filter(r => K(r.ref) === K(ref)).sort((a, b) =>
        String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
  if (!row) throw badRequest('That restructuring request could not be found.');
  if (!teamAllowed(user, row.team)) throw forbidden(`You do not have access to team ${row.team}.`);

  // Read the same way the demand notice reads them, so both documents carry the same brand,
  // the same stamp and the same signature -- one company, one letterhead.
  const setRows = await fetchAll(() => db.from('settings').select('*'));
  const get = k => { const r = setRows.find(x => x.key === k); return (r && r.value) || ''; };
  const schedule = restructureSchedule(num(row.total), num(row.installments), num(row.inst_amt), row.start_date);
  return {
    row, schedule,
    html: restructureContractHtml({
      ref: row.ref, name: row.full_name, team: row.team, contact: row.contact,
      guarantor: row.guarantor, guarantorContact: row.guarantor_contact,
      arrears: num(row.arrears), first: num(row.first_inst), remaining: num(row.remaining),
      interest: num(row.interest_amt), interestPct: get('RESTRUCTURE_INTEREST_PCT') || '',
      total: num(row.total), count: num(row.installments), schedule,
      date: String(row.created_at || '').slice(0, 10), status: row.status,
      officer: row.approved_by || row.requested_by || user.name,
      brand: get('CALL_BRAND') || 'HOPE MICROCREDIT CO. LTD',
      motto: 'MKOPO CHAP CHAP',
      logo: get('BRAND_LOGO'), stamp: get('BRAND_STAMP'), sign: get('BRAND_SIGN'),
    }),
  };
}

async function restructures(db, user, _args, nowMs) {
  const [r, strat] = await Promise.all([listTable(db, user, 'restructures'), restructureStrategy(db)]);
  const rows = r.rows.map(x => ({ ...x,
    schedule: restructureSchedule(num(x.total), num(x.installments), num(x.inst_amt), x.start_date) }));
  return { rows, count: rows.length, strategy: strat,
    canApprove: canApproveRestructure(user, strat),
    pending: rows.filter(x => K(x.status) === 'PENDING').length,
    approved: rows.filter(x => K(x.status) === 'APPROVED').length,
    rejected: rows.filter(x => K(x.status) === 'REJECTED').length };
}

/** Look a customer up by REF and say whether they can be restructured at all. */
async function restructureEligible(db, user, { ref }, nowMs) {
  if (!ref) throw badRequest('A customer REF# is required.');
  const snap = await latestSnapshot(db, 'defaulter_snapshots',
    { snapshot_type: 'current', weekday: currentWeekday(nowMs) }, { notAfter: todayKey(nowMs) });
  const found = snap.rows.find(d => K(d.ref) === K(ref));
  if (!found) return { found: false };
  if (!teamAllowed(user, found.team)) throw forbidden(`You do not have access to team ${found.team}.`);
  const strat = await restructureStrategy(db);
  const dc = num(found.dc) || paidCount(found);
  return { found: true, ref: found.ref, full_name: found.full_name, team: found.team,
    contact: found.contact, guarantor: found.guarantor_name, guarantor_contact: found.guarantor_contact,
    arrears: num(found.arrears), dc, minDc: strat.minDc, eligible: dc >= strat.minDc, strategy: strat };
}

async function addRestructure(db, user, p, nowMs) {
  if (!p || !p.ref) throw badRequest('Pick a customer (REF#).');
  const elig = await restructureEligible(db, user, { ref: p.ref }, nowMs);
  if (!elig.found) throw badRequest('That REF# is not in the current Defaulters list.');
  const strat = elig.strategy;
  if (!elig.eligible) {
    throw badRequest(`Only defaulters with ${strat.minDc}+ missed installments can be restructured — this one has ${elig.dc}.`);
  }
  const count = Math.floor(num(p.installments ?? p.count));
  if (count < 1) throw badRequest('Enter how many weekly installments.');
  if (count > strat.maxInstallments) {
    throw badRequest(`Maximum ${strat.maxInstallments} weekly installments (${strat.maxMonths} months). Reduce the count.`);
  }
  if (num(p.firstInst ?? p.first) > elig.arrears) throw badRequest('The first installment cannot exceed the arrears.');
  // Recomputed from the CUSTOMER's own arrears, never from what the browser sent.
  const c = restructureCompute(elig.arrears, p.firstInst ?? p.first, count, !!p.interestOn, strat.interestPct);
  if (c.total <= 0) throw badRequest('Nothing left to reschedule after the first installment.');
  // Spread too thin, the final installment would come out zero or negative -- the schedule
  // would not add up to the total, which is the one thing the customer signs.
  if (c.last <= 0) {
    throw badRequest(`TZS ${Math.round(c.total).toLocaleString('en-US')} cannot be split into ${c.count} installments of at least TZS ${RX_ROUND}. Reduce the count.`);
  }
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(p.startDate || p.start))
    ? (p.startDate || p.start) : addDaysKey(todayKey(nowMs), 7);
  const { data, error } = await db.from('restructures').insert({
    ref: elig.ref, team: elig.team, full_name: elig.full_name, contact: elig.contact,
    guarantor: elig.guarantor, guarantor_contact: elig.guarantor_contact,
    arrears: c.arrears, dc: elig.dc, first_inst: c.first, remaining: c.remaining,
    interest_on: p.interestOn ? 'YES' : 'NO', interest_amt: c.interest,
    total: c.total, installments: c.count, inst_amt: c.per, start_date: startDate,
    status: 'Pending', requested_by: user.name, notes: p.notes || null,
    created_at: new Date(nowMs).toISOString(),
  }).select('*');
  if (error) throw new Error(error.message);
  const row = (data && data[0]) || null;
  return { row, computed: c, schedule: restructureSchedule(c.total, c.count, c.per, startDate) };
}

async function decideRestructure(db, user, p, nowMs) {
  if (!p || !p.id) throw badRequest('id is required');
  const strat = await restructureStrategy(db);
  // Approving a restructure writes off interest and rewrites a customer's obligations. Anyone
  // could do it here before, which made the Pending state decorative.
  if (!canApproveRestructure(user, strat)) {
    throw forbidden(`Only ${strat.approvers.join(' / ')} (or an admin) can approve or reject a restructuring offer.`);
  }
  const { data: row } = await db.from('restructures').select('team, status').eq('id', p.id).maybeSingle();
  if (!row) throw badRequest('That offer no longer exists.');
  if (!teamAllowed(user, row.team)) throw forbidden(`You do not have access to team ${row.team}.`);
  if (K(row.status) !== 'PENDING') throw badRequest(`This offer is already ${row.status}.`);
  const approve = String(p.decision || '').toLowerCase() === 'approve';
  if (!approve && !String(p.reason || '').trim()) throw badRequest('Give a reason when rejecting.');
  const { error } = await db.from('restructures').update({
    status: approve ? 'Approved' : 'Rejected',
    approved_by: user.name, approved_at: new Date(nowMs).toISOString(),
    reject_reason: approve ? null : String(p.reason).trim(),
  }).eq('id', p.id);
  if (error) throw new Error(error.message);
  return { id: p.id, status: approve ? 'Approved' : 'Rejected' };
}

/* ------------------------------------------------------------------ legal / demand notices

   A demand notice is the last step before the auctioneers, and it is a legal document: it
   states what was lent, what came back, what is still owed, the late-payment fine, and the
   number of days the customer has left. Getting the arithmetic wrong here is not a reporting
   error -- it is a demand for the wrong amount, in writing, with the company's stamp on it.
   So every figure is derived here, on the server, from the customer's own row:

     total loan          first installment + 11 x other        (the 12-week schedule)
     principal           total loan / 1.36                     (36% interest stripped)
     principal remaining total loan - what has actually been paid
     fine                weeks late x rate x weekly installment
     total demand        principal remaining + fine, rounded up to the next 500

   The fine RATE depends on the disbursement year -- loans written in 2024 and earlier carry
   2%, later ones 5% -- and it only starts after a two-week grace period past the first missed
   due date. A customer who has missed one payment and is not yet past expiry owes no fine at
   all; charging them one would be indefensible. */
const LEGAL_GRACE_DAYS = 14;
function roundUp500(v) { const n = num(v); return n % 500 === 0 ? n : Math.ceil(n / 500) * 500; }

function legalFine(d, noticeMs) {
  const disb = d.disb_date ? Date.parse(String(d.disb_date) + 'T00:00:00Z') : NaN;
  const other = num(d.other_inst);
  const paidCount = paidCount0(d);
  const disbYear = isNaN(disb) ? new Date(noticeMs).getUTCFullYear() : new Date(disb).getUTCFullYear();
  const rate = disbYear <= 2024 ? 0.02 : 0.05;
  const none = { fine: 0, weeks: 0, paidCount, rate };
  const missed = 12 - paidCount;
  if (missed <= 0 || isNaN(disb)) return none;
  const firstMissedDue = disb + 7 * (paidCount + 1) * 86400000;
  const expiry = d.expire_date ? Date.parse(String(d.expire_date) + 'T00:00:00Z') : NaN;
  const expired = !isNaN(expiry) && noticeMs > expiry;
  // One missed payment on a loan that has not expired yet is not yet a fineable default.
  if (missed < 2 && !expired) return none;
  const graceEnd = firstMissedDue + LEGAL_GRACE_DAYS * 86400000;
  if (noticeMs < graceEnd) return none;
  const weeks = Math.ceil(Math.floor((noticeMs - graceEnd) / 86400000) / 7);
  return { fine: weeks * rate * other, weeks, paidCount, rate };
}
/** paidCount reads D.S first; this is the same rule, kept separate so legal never silently
    inherits a change made for the credit-analyst book. */
function paidCount0(d) { return paidCount(d); }

function legalAmounts(d, fine) {
  const initial = num(d.initial_inst), other = num(d.other_inst), paid = num(d.t_payment);
  const totalLoan = initial + 11 * other;
  const principalRemaining = totalLoan - paid;
  return { totalLoan, principal: roundUp500(totalLoan / 1.36), principalRemaining,
    totalPaid: paid, weeklyInst: roundUp500(other),
    totalDemand: roundUp500(principalRemaining + fine) };
}

async function findDefaulter(db, user, ref, nowMs) {
  const snap = await latestSnapshot(db, 'defaulter_snapshots',
    { snapshot_type: 'current', weekday: currentWeekday(nowMs) }, { notAfter: todayKey(nowMs) });
  const found = snap.rows.find(d => K(d.ref) === K(ref));
  if (!found) return null;
  if (!teamAllowed(user, found.team)) throw forbidden(`You do not have access to team ${found.team}.`);
  return found;
}

async function legalPreview(db, user, { ref, noticeDate }, nowMs) {
  if (!ref) throw badRequest('A customer REF# is required.');
  const d = await findDefaulter(db, user, ref, nowMs);
  if (!d) return { found: false };
  const noticeMs = /^\d{4}-\d{2}-\d{2}$/.test(String(noticeDate))
    ? Date.parse(noticeDate + 'T00:00:00Z') : nowMs;
  const f = legalFine(d, noticeMs);
  const fine = roundUp500(f.fine);
  const a = legalAmounts(d, fine);
  return { found: true, ref: d.ref, full_name: d.full_name, team: d.team, contact: d.contact,
    guarantor: d.guarantor_name, guarantor_contact: d.guarantor_contact,
    arrears: num(d.arrears), paidCount: f.paidCount, weeks: f.weeks, rate: f.rate,
    ratePct: Math.round(f.rate * 1000) / 10, fine,
    disb_date: d.disb_date, expire_date: d.expire_date, landmark: d.nearest_landmark,
    ...a, noticeDate: new Date(noticeMs).toISOString().slice(0, 10) };
}

/** HMCL/<initials>/<dd>/<mm>/<yyyy>, with -2, -3 ... when the same person is served again on
    the same day. Stored, never recomputed: regenerating it later against a corrected name
    would produce a different reference for a letter already in the customer's hands. */
async function nextNoticeId(db, fullName, noticeKey) {
  const initials = String(fullName || '').trim().split(/\s+/)
    .map(p => p.charAt(0).toUpperCase()).join('') || 'XX';
  const [y, m, dd] = String(noticeKey).split('-');
  const base = `HMCL/${initials}/${dd}/${m}/${y}`;
  const rows = await fetchAll(() => db.from('demand_notices').select('notice_id'));
  const used = [];
  for (const r of rows) {
    const id = String(r.notice_id || '').trim();
    if (id === base) used.push(1);
    else if (id.startsWith(base + '-')) {
      const n = parseInt(id.slice(base.length + 1), 10);
      if (!isNaN(n)) used.push(n);
    }
  }
  return used.length ? `${base}-${Math.max(...used) + 1}` : base;
}

async function addDemandNotice(db, user, p, nowMs) {
  if (!p || !p.ref) throw badRequest('Pick a customer (REF#).');
  const d = await findDefaulter(db, user, p.ref, nowMs);
  if (!d) throw badRequest('That REF# is not in the current Defaulters list.');
  const noticeKey = /^\d{4}-\d{2}-\d{2}$/.test(String(p.noticeDate)) ? p.noticeDate : todayKey(nowMs);
  const days = Math.max(1, Math.floor(num(p.noticeDays) || 7));
  const f = legalFine(d, Date.parse(noticeKey + 'T00:00:00Z'));
  const fine = roundUp500(f.fine);
  const a = legalAmounts(d, fine);
  const noticeId = await nextNoticeId(db, d.full_name, noticeKey);
  const { error } = await db.from('demand_notices').insert({
    notice_id: noticeId, ref: d.ref, team: d.team, full_name: d.full_name, contact: d.contact,
    notice_date: noticeKey, notice_days: days, paid_count: f.paidCount, fine,
    principal_remaining: a.principalRemaining, total_demand: a.totalDemand,
    arrears_at_notice: num(d.arrears), other_inst: num(d.other_inst),
    issued_by: user.name, created_at: new Date(nowMs).toISOString(),
  });
  if (error) throw new Error(error.message);
  const brand = await fetchAll(() => db.from('settings').select('*'));
  const get = k => { const r = brand.find(x => x.key === k); return (r && r.value) || ''; };
  return { noticeId, ref: d.ref, fine, ...a, paidCount: f.paidCount, ratePct: Math.round(f.rate * 1000) / 10,
    html: demandNoticeHtml({
      noticeId, noticeDate: noticeKey, days,
      name: d.full_name, contact: d.contact, team: d.team,
      location: d.nearest_landmark || 'Dar es Salaam',
      disb: d.disb_date, expiry: d.expire_date,
      guarantorName: String(p.guarantorName || '').trim() || d.guarantor_name || '',
      guarantorContact: String(p.guarantorContact || '').trim() || d.guarantor_contact || '',
      officer: user.name, fine, ratePct: Math.round(f.rate * 1000) / 10, paidCount: f.paidCount, ...a,
      logo: get('BRAND_LOGO'), stamp: get('BRAND_STAMP'), sign: get('BRAND_SIGN'),
    }) };
}

const esc_ = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtM = n => Math.round(num(n)).toLocaleString('en-US');
/** The letter itself, in Swahili, laid out for A4. Kept as one template so what is stored and
    what is printed come from a single set of numbers. */
function demandNoticeHtml(t) {
  const daysWord = String(t.days) === '7' ? 'SABA' : String(t.days);
  const commission = Math.round(t.totalDemand * 0.1);
  const grand = t.totalDemand + 50000 + commission;
  const img = (src, style, alt) => src ? `<img src="${esc_(src)}" style="${style}" alt="${alt}">` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc_(t.noticeId)}</title><style>
@page{margin:14mm 16mm}body{font-family:Verdana,Arial,sans-serif;font-size:9.3pt;color:#000;line-height:1.35;text-align:justify}
.blue{border-top:3px solid #0B3BA7;margin-bottom:12px}.bbot{border-bottom:3px solid #0B3BA7;margin-top:16px}
.head{text-align:right;margin-bottom:14px}
.subj{font-weight:bold;text-decoration:underline;text-align:center;margin:10px 0}
table{width:100%;border-collapse:collapse;margin:12px 0}td,th{border:1px solid #000;padding:5px 7px;font-size:9.3pt;vertical-align:top}th{background:#f0f0f0}
ol{padding-left:18px}.sig{margin-top:22px}
</style></head><body><div class="blue"></div>
<div class="head">${img(t.logo, 'height:52px;float:left', 'logo')}<b>HOPE MICROCREDIT COMPANY LIMITED</b><br>+255 659 077 770<br>info@hopemicrocredit.co.tz<br>www.hopemicrocredit.co.tz<br>P.O.Box 31623, Kijitonyama<br>Kinondoni, Dar es Salaam<br><br><b>${esc_(t.noticeDate)}</b></div>
<p><b>Kumb.Na. ${esc_(t.noticeId)}</b></p><br>
<p><b>${esc_(t.name)},</b><br>${esc_(t.contact)},<br>${esc_(t.location)} - ${esc_(t.team)}.</p>
<p class="subj">YAH: NOTISI YA KUKUTAKA ULIPE DENI LA MKOPO, SHILINGI ${fmtM(t.totalDemand)}/= NDANI YA SIKU ${daysWord} TU.</p>
<p>Tafadhali, rejea kichwa cha habari tajwa hapo juu. Kampuni ya Hope Microcredit inakuandikia notisi hii ya kukutaka ulipe deni lako ndani ya Siku ${esc_(t.days)} tangu ulipopewa notisi hii.</p>
<ol>
<li>Kwamba tarehe ${esc_(t.disb)} ulipatiwa mkopo wa Tsh. ${fmtM(t.principal)}/= uliopaswa kurejesha kila wiki Tsh ${fmtM(t.weeklyInst)}/= kwa wiki 12 (miezi 3), kumalizika tarehe ${esc_(t.expiry)}.</li>
<li>Kwamba jumla ya mkopo na riba ilikuwa Tsh ${fmtM(t.totalLoan)}/=.</li>
<li>Kwamba mpaka sasa umerejesha Tsh ${fmtM(t.totalPaid)}/= sawa na marejesho ${t.paidCount} kati ya 12.</li>
<li>Hivyo unadaiwa Tsh. ${fmtM(t.principalRemaining)}/= deni la msingi, pamoja na faini ya ${t.ratePct}% kwa kila rejesho lililochelewa; jumla ya faini ni Tsh. ${fmtM(t.fine)}/=, na jumla kuu ya deni ni Tsh. ${fmtM(t.totalDemand)}/=.</li>
<li>Notisi hii ni kukutaka ufanye malipo ya deni hilo lote ndani ya SIKU ${esc_(t.days)} TU.</li>
<li>Kushindwa kulipa kunaweza kupelekea kufikishwa mahakamani au kukabidhi deni kwa kampuni ya udalali na ufilisi, na utalipa gharama zote zifuatazo:</li>
</ol>
<table><tr><th>SN</th><th>MAELEZO</th><th>KIASI</th></tr>
<tr><td>i.</td><td>Deni lote la mkopo wako</td><td>Tsh. ${fmtM(t.totalDemand)}/=</td></tr>
<tr><td>ii.</td><td>Gharama ya dalali kukufikia</td><td>50,000/=</td></tr>
<tr><td>iii.</td><td>Kamisheni ya dalali 10% ya deni</td><td>${fmtM(commission)}/=</td></tr>
<tr><td>iv.</td><td>Faini ya kuchelewesha (${t.ratePct}%)</td><td>${fmtM(t.fine)}/=</td></tr>
<tr><th colspan="2">JUMLA</th><th>${fmtM(grand)}/=</th></tr></table>
<p><b>NB:</b> Malipo yafanyike kupitia MIXX BY YAS piga *150*01# &gt; 4 (Lipa Bili) &gt; 3 (Namba ya Kampuni 373337) &gt; Ingiza Kumbukumbu No <b>${esc_(t.ref || t.noticeRef || '')}</b> &gt; hakikisha jina <b>${esc_(t.name)}</b> kabla ya kuthibitisha.</p>
<p>Baada ya SIKU ${esc_(t.days)} hakutakuwa na notisi nyingine. Kupokea notisi hii hakumzuii mdai kuendelea kufuatilia deni kwa njia nyingine ikiwemo simu au kutembelewa na maafisa.</p>
<p><b>Kwa maelezo zaidi piga simu: +255 659 077 770</b></p>
<div class="sig"><p><b>Wako Katika Ujenzi wa Taifa</b><br>${img(t.sign, 'height:42px;display:block;margin:2px 0', 'sahihi')}<b>${esc_(t.officer)}</b><br>MWANASHERIA<br>HOPE MICROCREDIT COMPANY LIMITED</p>${img(t.stamp, 'height:88px;margin-top:2px', 'muhuri')}</div>
<p><b>NAKALA KWA MDHAMINI WA MKOPAJI</b><br>JINA: ${esc_(t.guarantorName)}<br>SIMU: ${esc_(t.guarantorContact)}</p>
<p><b>NAKALA KWA SERIKALI YA MTAA</b></p>
<div class="bbot"></div></body></html>`;
}

/* DID THE NOTICE WORK?

   The tab listed notices as issued and stopped there: what was owed when it was served, and
   nothing after. So the one question the register exists to answer -- does serving a demand
   notice actually bring money back -- had no figures behind it.

   arrears_at_notice was already stored on every notice. What was missing was the other end of
   the comparison: what that customer owes NOW. Put the two side by side and the difference is
   what the notice achieved.

   The "now" figure is today's current defaulter deck, the same book every other screen reads,
   so a recovery claimed here is the same recovery the dashboard counts. A customer who has
   left the deck entirely owes nothing on it, which is the strongest outcome a notice can have
   and must not be read as "no data". */
/* ------------------------------------------------------------------ where is this customer?

   An officer on the phone with a customer needs one thing: everything the company currently
   knows about them. Until now that meant opening tabs one at a time and searching each --
   Expected, then Defaulters, then Follow-up, then the pipeline -- while the customer waited.

   One reference number, one answer, across every book at once.

   THE SEARCH RUNS IN THE DATABASE, not here. Each book is asked "any row whose ref, name or
   phone looks like this", over its indexes, and sends back the handful that match. The
   alternative -- fetch every book and filter in JavaScript -- is the same mistake that made
   the Settings tab take a minute to open, and this is a screen somebody uses while a customer
   is holding.

   Team scoping still applies to every book. A search box is not a way around it. */
const SEARCH_BOOKS = [
  { key: 'expected',   table: 'repayment_snapshots', label: 'Expected Repayment',
    cols: 'ref, full_name, contact, team, arrears, payment_expected, todays_status, snapshot_date, snapshot_type' },
  { key: 'defaulters', table: 'defaulter_snapshots',  label: 'Defaulters',
    cols: 'ref, full_name, contact, team, arrears, status, ds, snapshot_date, snapshot_type' },
  { key: 'followup',   table: 'followup_status',      label: 'Follow-up',
    cols: 'ref, full_name, contact, team, arrears, fu_status, promise_date, last_comment' },
  { key: 'loans',      table: 'loans',                label: 'Loan pipeline',
    cols: 'docket_no, full_name, contact, team, stage, principal_amt, approved_date, disb_date',
    refCol: 'docket_no' },
  { key: 'payments',   table: 'received_payments',    label: 'Received payments',
    cols: 'ref_no, customer_name, customer_no, team, amount_paid, paid_at, transaction_id',
    refCol: 'ref_no', nameCol: 'customer_name', phoneCol: 'customer_no' },
  { key: 'restructures', table: 'restructures',       label: 'Restructuring',
    cols: 'ref, full_name, contact, team, arrears, total, installments, status, created_at' },
  { key: 'notices',    table: 'demand_notices',       label: 'Demand notices',
    cols: 'ref, full_name, contact, team, notice_id, notice_date, total_demand, arrears_at_notice' },
  { key: 'complaints', table: 'complaints',           label: 'Complaints',
    cols: 'ref, complainant, phone, team, category, status, created_at',
    nameCol: 'complainant', phoneCol: 'phone' },
];
const SEARCH_PER_BOOK = 25;

async function customerSearch(db, user, { q } = {}) {
  const term = String(q == null ? '' : q).trim();
  // The wildcards a LIKE understands are stripped, because a person typing % means the
  // character, not "everything". Doing that FIRST matters: "%%%" strips to nothing, and a
  // search for nothing wrapped in wildcards matches every customer in the company.
  const clean = term.replace(/[%_]/g, '');

  // Two characters matches half the book and answers nothing. Say so rather than returning a
  // thousand rows and letting the officer scroll while somebody waits on the phone.
  if (clean.length < 3) return { q: term, tooShort: true, books: [], total: 0 };

  // A phone number is written a dozen ways. Searching for the digits finds all of them.
  const digits = clean.replace(/\D/g, '');
  const like = '%' + clean + '%';

  const books = await Promise.all(SEARCH_BOOKS.map(async b => {
    const refCol = b.refCol || 'ref', nameCol = b.nameCol || 'full_name', phoneCol = b.phoneCol || 'contact';
    const clauses = [`${refCol}.ilike.${like}`, `${nameCol}.ilike.${like}`, `${phoneCol}.ilike.${like}`];
    // Nine digits of a Tanzanian number, however it was typed in.
    if (digits.length >= 6) clauses.push(`${phoneCol}.ilike.%${digits.slice(-9)}%`);
    let rows = [];
    try {
      const { data, error } = await db.from(b.table).select(b.cols).or(clauses.join(',')).limit(SEARCH_PER_BOOK);
      if (error) throw error;
      rows = data || [];
    } catch (e) {
      // One book that will not answer must not take the whole search down. The officer gets
      // everything else, and the book that failed says so instead of silently reading empty.
      return { key: b.key, label: b.label, rows: [], failed: true };
    }
    return { key: b.key, label: b.label, rows: scoped(user, rows), failed: false };
  }));

  const found = books.filter(b => b.rows.length || b.failed);
  return { q: term, tooShort: false, books: found,
    total: found.reduce((s, b) => s + b.rows.length, 0),
    capped: found.some(b => b.rows.length >= SEARCH_PER_BOOK) };
}

/* ------------------------------------------------------------------ the noticeboard

   Management puts something on every screen in the company at once -- a picture, a sentence,
   or both -- and it stays there until each person waves it away.

   IT IS PUBLIC. It has to reach the sign-in screen, where nobody has identified themselves
   yet, so it is served without an access code (api_announcement, beside api_brand). Anything
   posted here is readable by anyone who can reach the site. That is a noticeboard, not a
   message, and the guards below are what stop it becoming something worse.

   The announcement table has been in the schema since the start and nothing ever wrote to it. */
const ANNOUNCE_MAX_TEXT = 500;
const ANNOUNCE_MAX_IMAGE = 600 * 1024;
async function announceSave(db, user, p = {}, nowMs = Date.now()) {
  // Whoever loads the company's reports is who posts to the company's noticeboard.
  if (!(user.tabs || []).includes('upload')) throw forbidden('Upload permission is required to post an announcement.');

  const text = String(p.text == null ? '' : p.text).trim().slice(0, ANNOUNCE_MAX_TEXT);
  let image = String(p.image == null ? '' : p.image).trim();
  if (image) {
    // Only a picture, and only one carried in the request itself. A URL would let a
    // noticeboard point every screen in the company at somebody else's server.
    if (!/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(image)) {
      throw badRequest('The announcement image must be a picture file (PNG, JPG, GIF or WEBP).');
    }
    if (image.length > ANNOUNCE_MAX_IMAGE) {
      throw badRequest('That image is too large. Keep it under about 600 KB — it is loaded by every '
        + 'phone in the field, most of them on mobile data.');
    }
  }
  // Taking the picture off does not end the announcement if words remain. Two separate things
  // were posted; removing one is not removing both.
  const on = p.on === false ? false : !!(text || image);
  const { error } = await db.from('announcement').upsert({
    id: true, text: text || null, image_url: image || null, is_on: on,
    updated_at: new Date(nowMs).toISOString(),
  }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  return { on, text, hasImage: !!image, ts: nowMs };
}

/* ------------------------------------------------------------------ the bell

   How a supervisor finds out a complaint was logged without opening the complaints tab.

   Two streams, one list: complaints raised and follow-up comments written. Team-scoped like
   everything else, newest first. "Unseen" is a per-CODE stamp, so marking them read on one
   person's screen does not mark them read on everybody's. */
const NOTIF_LIMIT = 60;
async function notifications(db, user) {
  const [comp, cmts, seenRows] = await Promise.all([
    fetchAll(() => db.from('complaints').select('id, ref, team, complainant, details, category, created_at, created_by')),
    fetchAll(() => db.from('followup_comments').select('id, ref, team, full_name, comment, fu_status, created_at, created_by')),
    fetchAll(() => db.from('settings').select('key, value').eq('key', notifKey_(user))),
  ]);
  const seenAt = (seenRows[0] && seenRows[0].value) || '';

  const items = [
    ...scoped(user, comp).map(c => ({
      kind: 'complaint', id: 'c' + c.id, ref: c.ref, team: c.team,
      who: c.complainant || '', by: c.created_by || '',
      what: String(c.details || c.category || 'Complaint').slice(0, 160),
      at: String(c.created_at || ''),
    })),
    ...scoped(user, cmts).map(c => ({
      kind: 'comment', id: 'f' + c.id, ref: c.ref, team: c.team,
      who: c.full_name || '', by: c.created_by || '',
      what: String(c.comment || c.fu_status || 'Follow-up').slice(0, 160),
      at: String(c.created_at || ''),
    })),
  ].filter(x => x.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, NOTIF_LIMIT)
    .map(x => ({ ...x, unseen: !seenAt || x.at > seenAt }));

  return { items, unseen: items.filter(x => x.unseen).length, seenAt };
}
const notifKey_ = user => 'NOTIF_SEEN_' + String(user.code || user.name || '').toUpperCase();
/** Marks everything currently visible as read, for THIS code only. */
async function notifSeen(db, user, _p, nowMs = Date.now()) {
  const at = new Date(nowMs).toISOString();
  const { error } = await db.from('settings').upsert({ key: notifKey_(user), value: at }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  return { seenAt: at };
}

async function demandNotices(db, user, _args, nowMs = Date.now()) {
  const [r, cur] = await Promise.all([
    listTable(db, user, 'demand_notices'),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current', weekday: currentWeekday(nowMs) },
      { notAfter: todayKey(nowMs), teams: user.teams }),
  ]);
  const nowBy = {};
  for (const d of cur.rows) nowBy[K(d.ref)] = num(d.arrears);
  const seen = cur.rows.length > 0;

  const rows = r.rows.map(x => {
    const at = num(x.arrears_at_notice);
    const key = K(x.ref);
    const known = Object.prototype.hasOwnProperty.call(nowBy, key);
    // Off the deck = cleared. But only if there IS a deck today: with nothing uploaded, every
    // customer would look cleared and the tab would report a triumph that never happened.
    const current = known ? nowBy[key] : (seen ? 0 : null);
    return { ...x,
      arrears_now: current,
      recovered_since: current == null ? null : Math.max(0, at - current),
      // What a person working the notice needs to see at a glance.
      notice_state: current == null ? 'Hakuna deki / No deck'
        : current <= 0 ? 'Amemaliza / Cleared'
        : current < at ? 'Amepunguza / Reducing'
        : 'Hajalipa / No movement',
    };
  });
  return { ...r, rows,
    demanded: rows.reduce((s, x) => s + num(x.total_demand), 0),
    fines: rows.reduce((s, x) => s + num(x.fine), 0),
    atNotice: rows.reduce((s, x) => s + num(x.arrears_at_notice), 0),
    recoveredSince: rows.reduce((s, x) => s + num(x.recovered_since), 0),
    cleared: rows.filter(x => x.notice_state.indexOf('Cleared') >= 0).length,
    asOf: cur.date || null };
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

/** Leader Reports. Per-team numbers answer "how is this team doing"; a leader report answers
    "how is this PERSON doing" -- and most supervisors carry several teams, so their real
    performance is the roll-up across all of them. The same teams therefore appear under a
    different name in each section: one OPM's three teams, one GMO's five, and so on.

    Teams with no one named in a role collect under "(unassigned)" rather than vanishing --
    an unstaffed role is exactly the thing a leader report should make visible. */
async function leaderReports(db, user, _args, nowMs) {
  const tp = await teamProgress(db, user, {}, nowMs);
  const teamRows = await fetchAll(() => db.from('teams').select('*'));
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;

  const sections = TEAM_ROLE_COLS.map(roleCol => {
    const by = {};
    for (const r of tp.rows) {
      const who = officerOf(teamBy, r.team, roleCol);
      const b = bucket(by, who, { teams: 0, teamList: [], initArrears: 0, curArrears: 0,
        recovered: 0, initCust: 0, curCust: 0, cleared: 0 });
      b.teams++; b.teamList.push(r.team);
      b.initArrears += r.initArrears; b.curArrears += r.curArrears;
      b.recovered += r.recovered; b.initCust += r.initCust; b.curCust += r.curCust;
      b.cleared += r.cleared;
    }
    const rows = Object.values(by).map(b => ({
      leader: b.key, teams: b.teams, teamList: b.teamList.sort().join(', '),
      initArrears: b.initArrears, curArrears: b.curArrears, recovered: b.recovered,
      initCust: b.initCust, curCust: b.curCust, cleared: b.cleared,
      progress: pctOf(b.recovered, b.initArrears),
    })).sort((a, b) => b.recovered - a.recovered);
    const sum = f => rows.reduce((s, r) => s + (r[f] || 0), 0);
    return { role: roleCol, label: roleCol.toUpperCase(), rows,
      totals: { teams: sum('teams'), initArrears: sum('initArrears'), curArrears: sum('curArrears'),
        recovered: sum('recovered'), initCust: sum('initCust'), curCust: sum('curCust'),
        cleared: sum('cleared'), progress: pctOf(sum('recovered'), sum('initArrears')) },
      unstaffed: rows.filter(r => r.leader === '(unassigned)').reduce((s, r) => s + r.teams, 0) };
  }).filter(s => s.rows.length);

  return { weekday: tp.weekday, date: tp.date, paired: tp.paired, note: tp.note,
    rows: tp.rows, sections,
    totals: { teams: tp.rows.length,
      initArrears: tp.rows.reduce((s, r) => s + r.initArrears, 0),
      curArrears: tp.rows.reduce((s, r) => s + r.curArrears, 0),
      recovered: tp.rows.reduce((s, r) => s + r.recovered, 0) } };
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
    paidTzs: num(get('CMS_PAID_TZS')) || 0, overTzs: num(get('CMS_OVER_TZS')) || 0,
    // What an officer is told about WHEN and HOW the money reaches them. A commission figure
    // with no word about payday is the question every officer asks next, and they ask it of
    // somebody rather than of the screen.
    payText: String(get('COMM_PAY_TEXT') || '') };
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
    paidTzs: cfg.paidTzs, overTzs: cfg.overTzs, payText: cfg.payText, isAdmin, me: user.name,
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
  // The payout note officers read under their own figure. Capped so a settings box cannot
  // become a place to paste a page of text onto everybody's commission screen.
  if (p.payText != null) { out.payText = String(p.payText).slice(0, 300); await set('COMM_PAY_TEXT', out.payText); }
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
    fetchAll(() => db.from('loans').select('team, approved_date, approved_by, created_by, principal_amt, loan_amt').eq('stage', 'approved')),
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

/** Call agents -- the CUSTOMER SERVICE agents named on loan applications, not the HOPE Calls
    app users. Each application in the Unassigned and Assigned reports carries a CREATED BY
    agent id, and this counts what each of them brought in. The per-agent PHONE statistics are
    a different question entirely and live on the Call Reports tab.

    Only TRACK# 1 customers count. A track of 2 or more is a repeat customer, and an agent did
    not win that application -- crediting it would reward the same relationship twice. A blank
    track counts, because the earliest reports had no such column. */
const CS_STAGES = ['unassigned', 'assigned'];
function isTrack1(r) {
  const v = r.track_no;
  if (v == null || String(v).trim() === '') return true;
  return (num(v) || 0) < 2;
}
async function callAgents(db, user) {
  const [loanRows, agentRows] = await Promise.all([
    fetchAll(() => db.from('loans').select('team, stage, track_no, created_by, principal_amt, loan_amt, requested_amt').in('stage', CS_STAGES)),
    fetchAll(() => db.from('call_agents').select('*').order('user_id', { ascending: true })),
  ]);
  const names = {};
  for (const a of agentRows) names[K(a.user_id)] = a.names || '';
  const by = {};
  for (const l of scoped(user, loanRows)) {
    if (!isTrack1(l)) continue;
    const id = String(l.created_by || '').trim() || '—';
    const b = bucket(by, K(id), { id, unassigned: 0, assigned: 0, amount: 0 });
    if (l.stage === 'assigned') b.assigned++; else b.unassigned++;
    b.amount += num(l.requested_amt) || num(l.principal_amt);
  }
  const rows = Object.values(by).map(b => ({ id: b.id, names: names[b.key] || '',
    unassigned: b.unassigned, assigned: b.assigned, total: b.unassigned + b.assigned,
    amount: b.amount })).sort((a, b) => b.total - a.total);
  const sum = f => rows.reduce((s, r) => s + r[f], 0);
  return { rows, count: rows.length, agents: agentRows,
    totals: { unassigned: sum('unassigned'), assigned: sum('assigned'),
      total: sum('total'), amount: sum('amount') },
    // An id that appears on applications but is not in the roster shows as bare id, which is
    // the signal to add them rather than a reason to hide the row.
    unnamed: rows.filter(r => !r.names && r.id !== '—').map(r => r.id) };
}
async function saveCallAgent(db, user, p) {
  requireAdmin(user);
  const id = String((p && p.userId) || '').trim();
  if (!id) throw badRequest('An agent id is required — it must match CREATED BY on the application report.');
  if (p.remove) {
    const { error } = await db.from('call_agents').delete().eq('user_id', id);
    if (error) throw new Error(error.message);
    return { userId: id, removed: true };
  }
  const { error } = await db.from('call_agents').upsert(
    { user_id: id, names: String((p && p.names) || '').trim() || null, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  return { userId: id };
}

/* ------------------------------------------------------------------ reference / admin */
async function teams(db, user) {
  const [rows, roleRows] = await Promise.all([
    fetchAll(() => db.from('teams').select('*').order('team', { ascending: true })),
    fetchAll(() => db.from('roles').select('*').order('role', { ascending: true })),
  ]);
  // Roles live beside the teams because they answer the same question -- who does what -- and
  // a role's tab list was previously readable but not editable from anywhere in the UI, so
  // onboarding a new kind of officer meant a trip to the SQL editor.
  return { rows: rows.filter(r => teamAllowed(user, r.team)), count: rows.length,
    roles: roleRows, allTabs: ADMIN_TABS.slice() };
}
async function saveRole(db, user, p) {
  requireAdmin(user);
  const role = String((p && p.role) || '').trim().toUpperCase();
  if (!role) throw badRequest('A role name is required.');
  const tabs = String((p && p.tabs) || '').split(/[;,]/).map(x => x.trim().toLowerCase())
    .filter(x => ADMIN_TABS.includes(x));
  const { error } = await db.from('roles').upsert({ role, tabs }, { onConflict: 'role' });
  if (error) throw new Error(error.message);
  return { role, tabs };
}
async function deleteRole(db, user, p) {
  requireAdmin(user);
  const role = String((p && p.role) || '').trim().toUpperCase();
  if (!role) throw badRequest('A role name is required.');
  if (role === 'ADMIN') throw badRequest('The ADMIN role cannot be deleted.');
  // Codes inherit their tabs from the role when their own list is blank, so deleting a role
  // still in use would silently strip those people back to the default tab set.
  const codes = await fetchAll(() => db.from('access_codes').select('code, role'));
  const inUse = codes.filter(c => K(c.role) === role);
  if (inUse.length) {
    throw badRequest(`${inUse.length} access code(s) still use the ${role} role. Move them to another role first.`);
  }
  const { error } = await db.from('roles').delete().eq('role', role);
  if (error) throw new Error(error.message);
  return { role };
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
  // The code IS the password, so changing it has to be possible -- that is the only way to
  // rotate one that has been shared around. It is the primary key, and nothing references
  // access_codes, so a rename is an insert under the new code followed by dropping the old.
  const oldCode = String((p && p.oldCode) || '').trim();
  if (oldCode && oldCode !== code) {
    if (oldCode === user.code) throw badRequest('You cannot change the code you are signed in with — sign in with another admin code first.');
    const { data: clash } = await db.from('access_codes').select('code').eq('code', code).maybeSingle();
    if (clash) throw badRequest(`The code "${code}" is already in use.`);
  }
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
  if (oldCode && oldCode !== code) {
    // Only after the new row exists -- a failure here leaves a duplicate, which an admin can
    // see and delete, rather than deleting the old one first and locking someone out entirely.
    const { error: dErr } = await db.from('access_codes').delete().eq('code', oldCode);
    if (dErr) throw new Error(dErr.message);
  }
  return { code, renamedFrom: (oldCode && oldCode !== code) ? oldCode : null };
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
/** Field officer accounts. An officer cannot create their own -- an admin creates it here,
    against the officer's phone number, and issues a passcode. That passcode is shown ONCE, at
    the moment it is generated, and is stored only as a scrypt hash: an admin can replace it,
    never read it back. A passcode an admin can look up is one that leaks with their screen.

    The two things this exists to make possible, both of which used to require a database
    console:

      someone leaves          -> switch the account off; the device is released immediately and
                                 their next request fails, rather than their session running
                                 until they choose to sign out (which they never do)
      a passcode gets shared  -> issue a new one; the old device is released the same way

    user_id is derived from the phone number, so creating the account in advance and the
    officer registering later resolve to the SAME identity -- their call history stays theirs
    across a lost phone, a reinstall or a new handset. */
async function officerAccounts(db, user) {
  requireAdmin(user);
  const [rows, logs, teamRows] = await Promise.all([
    fetchAll(() => db.from('call_users').select('*').order('name', { ascending: true })),
    fetchAll(() => db.from('call_logs').select('user_id')),
    fetchAll(() => db.from('teams').select('team')),
  ]);
  const counts = {};
  for (const l of logs) counts[l.user_id] = (counts[l.user_id] || 0) + 1;
  const out = rows.map(u => ({
    user_id: u.user_id, name: u.name, team: u.team, role: u.role, phone: u.phone,
    is_leader: !!u.is_leader, leader_teams: u.leader_teams,
    active: u.active !== false,
    // Never send the hash or the salt to a browser, not even an admin's.
    hasPasscode: !!u.passcode_hash,
    passcode_set_at: u.passcode_set_at, registered_at: u.registered_at,
    signedIn: !!u.device_id, calls: counts[u.user_id] || 0, created_by: u.created_by,
  }));
  return { rows: out, count: out.length,
    teams: teamRows.map(t => t.team).filter(Boolean).sort(),
    // Accounts left over from before passcodes existed can still sign in on the device they
    // already hold. Naming them is the whole point -- they are the open doors.
    withoutPasscode: out.filter(u => !u.hasPasscode && u.signedIn).length };
}

/** Identity MUST be derived exactly as the calls app derives it. When the admin path and the
    register path disagreed, creating an account here and signing in there produced two rows
    for one phone -- and phone is UNIQUE in Postgres, so the officer's sign-in failed outright.
    Both now go through the same pnorm/h36 pair. */
function normPhone9(v) { return pnorm(v); }
function officerId(phone9) { return 'U' + h36(phone9); }
/** Create or update an account. Passing `issuePasscode` returns a fresh one exactly once. */
async function saveOfficerAccount(db, user, p, nowMs) {
  requireAdmin(user);
  const phone = normPhone9(p && p.phone);
  if (!phone) throw badRequest('A 9-digit phone number is required — it is how the officer signs in.');
  const name = String((p && p.name) || '').trim();
  if (!name) throw badRequest('A name is required.');
  const leader = !!(p && p.isLeader);
  let team = String((p && p.team) || '').trim() || null;
  if (team) {
    const teamRows = await fetchAll(() => db.from('teams').select('team'));
    const match = teamRows.find(t => K(t.team) === K(team));
    if (!match) throw badRequest(`Unknown team "${team}".`);
    team = match.team;                       // canonical spelling the FK expects
  }
  if (!team && !leader) throw badRequest('Pick a team for a field officer.');
  const { data: existing } = await db.from('call_users').select('*').eq('phone', phone).maybeSingle();
  const uid = existing ? existing.user_id : officerId(phone);
  const active = p.active === undefined ? (existing ? existing.active !== false : true) : !!p.active;

  const vals = { user_id: uid, name, team, phone,
    role: String((p && p.role) || (leader ? 'LEADER' : 'OFFICER')).trim(),
    is_leader: leader,
    leader_teams: leader && p.leaderTeams
      ? String(p.leaderTeams).split(/[;,]/).map(x => x.trim()).filter(Boolean) : null,
    active,
    created_by: existing ? existing.created_by : user.name,
    registered_at: existing ? existing.registered_at : new Date(nowMs).toISOString() };

  let issued = null;
  if (p && p.issuePasscode) {
    issued = generatePasscode();
    const { hash, salt } = hashPasscode(issued);
    vals.passcode_hash = hash; vals.passcode_salt = salt;
    vals.passcode_set_at = new Date(nowMs).toISOString();
    // A new passcode invalidates the old sign-in, or re-issuing after a leak would change
    // nothing for the person who already has the phone in their hand.
    vals.device_id = null;
  }
  // Switching an account off must cut the live session, not just block the next sign-in.
  if (!active) vals.device_id = null;

  const { error } = await db.from('call_users').upsert(vals, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  return { userId: uid, name, team, active, passcode: issued };
}

/** Delete an account outright. Switching one off keeps the person's call history attached
    and is the right move for someone who has left; deleting is for the ones that should never
    have existed -- a test registration, a typo'd phone number, a duplicate. Their call logs
    go first because call_logs references call_users, and a delete that leaves orphaned logs
    would just fail. */
async function deleteOfficerAccount(db, user, p) {
  requireAdmin(user);
  const id = String((p && p.userId) || '').trim();
  if (!id) throw badRequest('userId is required');
  const { data: acct } = await db.from('call_users').select('user_id, name').eq('user_id', id).maybeSingle();
  if (!acct) throw badRequest('That account no longer exists.');
  const { error: lErr } = await db.from('call_logs').delete().eq('user_id', id);
  if (lErr) throw new Error(lErr.message);
  const { error } = await db.from('call_users').delete().eq('user_id', id);
  if (error) throw new Error(error.message);
  return { userId: id, name: acct.name, deleted: true };
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
/* EVERY report that grows, not just the big five.

   This list started as the tables that were obviously eating disk, which left the owner able
   to clean five things and stuck with the rest. If a report accumulates, it belongs here.

   `uploadedOnly` marks the four registers people ALSO type into from inside the app -- a
   complaint logged at the desk, an officer's follow-up comment, a restructure request, a
   demand notice issued from the Legal screen. Cleaning a date there takes only what arrived in
   an upload. Somebody's typed work is not a report and must not vanish in a tidy-up. It is the
   same rule Replace already follows.

   followup_status is deliberately absent. It is not a report and has no date dimension: one
   row per customer, rebuilt from each Current deck, holding the officers' live working list
   with their promises and comments on it. "Delete a date" has no meaning there, and the
   nearest thing it could mean would wipe the book everyone is working from. */
const SNAPSHOT_SOURCES = {
  expected: { table: 'repayment_snapshots', label: 'Expected Repayment', dateCol: 'snapshot_date', bytes: 456 },
  defaulters: { table: 'defaulter_snapshots', label: 'Defaulters', dateCol: 'snapshot_date', bytes: 498 },
  received: { table: 'received_payments', label: 'Received Payments', dateCol: 'paid_at', bytes: 246 },
  abnormal: { table: 'abnormal_payments', label: 'Abnormal Payments', dateCol: 'created_at', bytes: 246 },
  calls: { table: 'call_logs', label: 'Call Logs', dateCol: 'call_date', bytes: 258 },
  // The loan pipeline is dated by the report it came in on, not by the dates inside it -- an
  // applications report pulled on the 27th is full of June applications.
  loans: { table: 'loans', label: 'Loan Pipeline', dateCol: 'upload_date', bytes: 512 },
  comments: { table: 'followup_comments', label: 'Comments Log', dateCol: 'created_at', bytes: 268, uploadedOnly: true },
  complaints: { table: 'complaints', label: 'Complaints', dateCol: 'created_at', bytes: 288, uploadedOnly: true },
  restructures: { table: 'restructures', label: 'Loan Restructuring', dateCol: 'created_at', bytes: 312, uploadedOnly: true },
  demand_notices: { table: 'demand_notices', label: 'Demand Notices', dateCol: 'created_at', bytes: 296, uploadedOnly: true },
};
const dayOf = v => String(v == null ? '' : v).slice(0, 10);

/** What is stored, by date and report type, so a cleanup is an informed choice rather than a
    guess. Also reports the total row count per source for the storage note in the UI. */
/* COUNTING IS THE DATABASE'S JOB.

   This used to download every row of five tables -- every repayment snapshot, every defaulter
   snapshot, every received payment, every abnormal payment, every call log -- one table after
   another, and count them here. With thirty thousand customers and a snapshot every day, that
   is millions of rows pulled across the internet to work out a number Postgres already knew.
   It is why the Settings tab took so long to open, and it was quietly a large part of the
   data-transfer bill.

   storage_usage_by_date() does the same counting in one query, over indexes, and sends back a
   few hundred rows. See db/migrations/2026-08-01-storage-counts.sql.

   The old way is kept as a fallback, and this is not tidiness: the migration is run by hand,
   so between a deploy and that being done, the function does not exist. Falling back means
   the Settings tab keeps working -- slowly, as it always did -- instead of breaking. */
async function countsByDate(db) {
  let rows = [];
  try {
    const { data, error } = await db.rpc('storage_usage_by_date');
    if (error) throw error;
    if (Array.isArray(data)) rows = data;
  } catch (e) { /* function not created yet -- everything falls back below */ }

  /* Whatever the database function did not answer for is counted the old way, source by
     source. This matters because the list of reports grows: a database still running an
     earlier version of the function knows nothing about, say, the loan pipeline, and the
     alternative to filling that gap here would be a Settings tab that quietly under-reports
     until somebody remembers to run some SQL. A source that is genuinely empty costs one
     query returning nothing. */
  const answered = new Set(rows.map(r => r.source));
  for (const [key, src] of Object.entries(SNAPSHOT_SOURCES)) {
    if (answered.has(key)) continue;
    const all = await fetchAll(() => db.from(src.table).select(src.dateCol));
    const n = {};
    for (const r of all) { const d = dayOf(r[src.dateCol]); n[d] = (n[d] || 0) + 1; }
    for (const [day, count] of Object.entries(n)) rows.push({ source: key, day, n: count });
  }
  return rows;
}

async function storageUsage(db, user) {
  requireAdmin(user);
  const out = {};
  const byDate = {};
  for (const [key, src] of Object.entries(SNAPSHOT_SOURCES)) {
    out[key] = { key, label: src.label, table: src.table, rows: 0 };
  }
  for (const row of await countsByDate(db)) {
    const key = row.source;
    if (!out[key]) continue;                      // a source the app no longer knows about
    const n = Number(row.n) || 0;
    out[key].rows += n;                           // rows with no date still count towards size
    const d = dayOf(row.day);
    if (!d) continue;
    if (!byDate[d]) byDate[d] = { date: d, total: 0 };
    byDate[d][key] = (byDate[d][key] || 0) + n;
    byDate[d].total += n;
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

/** What has already been uploaded for a given day. Someone loading five Expected files and
    fourteen defaulter decks every morning cannot hold in their head which ones are already in,
    and the failure is silent in the worst way: a MISSING upload does not error, it just makes
    the dashboard quietly wrong -- yesterday's numbers presented as today's. This answers
    "what still needs loading?" before the work starts rather than after someone notices a
    figure looks off.

    Gated on UPLOAD, not settings: the person doing the uploading is exactly who needs it. */
const UPLOAD_EXPECTED_TYPES = ['today', 'tomorrow', 'yesterday', 'initial'];
async function uploadStatus(db, user, { date } = {}, nowMs) {
  if (!(user.tabs || []).includes('upload')) throw forbidden('Upload permission is required.');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? date : todayKey(nowMs);
  const [rep, def, rcv, calls] = await Promise.all([
    fetchAll(() => db.from('repayment_snapshots').select('snapshot_type, snapshot_date')),
    fetchAll(() => db.from('defaulter_snapshots').select('snapshot_type, weekday, snapshot_date')),
    fetchAll(() => db.from('received_payments').select('paid_at')),
    fetchAll(() => db.from('call_logs').select('call_date')),
  ]);
  // Snapshots are append-only, so a corrected re-upload leaves BOTH copies on disk while
  // every read resolves to the latest batch. Counting raw rows therefore showed double after
  // a re-upload and made it look like the data had doubled. Count what a read would actually
  // see, and say separately how many uploads are stacked underneath.
  const tally = (rows, keyOf, dateOf, batchOf) => {
    const m = {};
    for (const r of rows) {
      const k = keyOf(r), d = dayOf(dateOf(r));
      if (!k || !d) continue;
      if (!m[k]) m[k] = { key: k, latest: null, today: 0, total: 0, _day: {} };
      m[k].total++;
      if (!m[k].latest || d > m[k].latest) m[k].latest = d;
      if (d === day) {
        m[k].today++;
        if (batchOf) {
          const b = batchOf(r) || 'legacy';
          m[k]._day[b] = (m[k]._day[b] || 0) + 1;
        }
      }
    }
    // today = the live count (newest batch), uploads = how many times it was loaded today.
    for (const b of Object.values(m)) {
      const keys = Object.keys(b._day);
      if (keys.length) {
        b.uploads = keys.length;
        b.today = Math.max(...keys.map(k => b._day[k]));
      } else { b.uploads = b.today ? 1 : 0; }
      delete b._day;
    }
    return m;
  };
  const repBy = tally(rep, r => r.snapshot_type, r => r.snapshot_date, r => r.upload_batch);
  const defBy = tally(def, r => `${r.snapshot_type}:${r.weekday}`, r => r.snapshot_date, r => r.upload_batch);

  const items = [];
  for (const t of UPLOAD_EXPECTED_TYPES) {
    const b = repBy[t] || { latest: null, today: 0, total: 0, uploads: 0 };
    items.push({ group: 'Expected repayment', label: `Expected — ${t}`, key: `expected-${t}`,
      latest: b.latest, today: b.today, total: b.total, uploads: b.uploads, loadedToday: b.today > 0 });
  }
  for (const type of ['current', 'initial']) {
    for (const wd of WD7) {
      const b = defBy[`${type}:${wd}`] || { latest: null, today: 0, total: 0, uploads: 0 };
      items.push({ group: `Defaulters — ${type}`, label: `Defaulters ${type} — ${wd}`,
        key: `defaulters-${type}-${wd}`, weekday: wd,
        latest: b.latest, today: b.today, total: b.total, uploads: b.uploads, loadedToday: b.today > 0 });
    }
  }
  const simple = (label, key, rows, dateOf) => {
    let latest = null, today = 0;
    for (const r of rows) {
      const d = dayOf(dateOf(r));
      if (!d) continue;
      if (!latest || d > latest) latest = d;
      if (d === day) today++;
    }
    items.push({ group: 'Other', label, key, latest, today, total: rows.length, loadedToday: today > 0 });
  };
  simple('Received Payments', 'received', rcv, r => r.paid_at);
  simple('Call Logs', 'calls', calls, r => r.call_date);

  // Today's OWN weekday is the one that actually has to be in for the dashboard to be right;
  // the other six weekday decks are history and their absence is not a problem.
  const wdToday = currentWeekday(nowMs);
  const required = items.filter(i =>
    i.key === 'expected-today' || i.key === `defaulters-current-${wdToday}`);
  return { date: day, weekday: wdToday, items,
    missing: required.filter(i => !i.loadedToday).map(i => i.label),
    ready: required.every(i => i.loadedToday) };
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
  let protectedRows = 0;
  for (const key of wanted) {
    const src = SNAPSHOT_SOURCES[key];
    // Count first: the caller is told exactly what went, and a dry run can ask without acting.
    const cols = src.uploadedOnly ? `${src.dateCol}, upload_batch` : src.dateCol;
    const before = await fetchAll(() => db.from(src.table).select(cols));
    const inRange = before.filter(r => {
      const d = dayOf(r[src.dateCol]);
      return d && (through ? d <= date : d === date);
    });
    // On the registers people also type into, only uploaded rows are ever taken. The rest are
    // counted so the answer can say plainly what was left alone rather than silently sparing it.
    const hit = src.uploadedOnly ? inRange.filter(r => r.upload_batch != null).length : inRange.length;
    if (src.uploadedOnly) protectedRows += inRange.length - hit;

    if (!p.dryRun && hit) {
      let q = db.from(src.table).delete();
      q = through
        ? q.lte(src.dateCol, date + (src.dateCol === 'created_at' ? 'T23:59:59.999Z' : ''))
        : (src.dateCol === 'created_at'
            ? q.gte(src.dateCol, date).lte(src.dateCol, date + 'T23:59:59.999Z')
            : q.eq(src.dateCol, date));
      if (src.uploadedOnly) q = q.not('upload_batch', 'is', null);
      const { error } = await q;
      if (error) throw new Error(error.message);
    }
    deleted[key] = hit; total += hit;
  }
  return { date, through, dryRun: !!p.dryRun, deleted, total, protectedRows };
}

/** Email the week's expected-defaulter report to the admin address. Sent ONLY when someone
    presses the button -- there is no schedule behind this on purpose. A report that arrives
    every morning whether or not anyone wanted it stops being read within a fortnight, and
    then the one that mattered gets deleted with the rest.

    Needs two things set, and says which is missing rather than failing silently:
      RESEND_API_KEY   environment variable on the deployment (not a setting -- it is a secret)
      ADMIN_EMAIL      Settings, so finance can change the recipient without a deploy */
function expdfEmailHtml(d, sentBy) {
  const money0 = n => Math.round(num(n)).toLocaleString('en-US');
  const pctTxt = v => (v == null ? '—' : v + '%');
  const t = d.totals;
  const section = s => `
    <h3 style="margin:22px 0 6px;font:600 14px system-ui;color:#0B2A6B">${esc_(s.role)}</h3>
    <table style="width:100%;border-collapse:collapse;font:13px system-ui">
      <thead><tr style="background:#0B2A6B;color:#fff">
        <th align="left" style="padding:6px 8px">Leader</th>
        <th align="right" style="padding:6px 8px">Customers</th>
        <th align="right" style="padding:6px 8px">Initial</th>
        <th align="right" style="padding:6px 8px">Arrears now</th>
        <th align="right" style="padding:6px 8px">Recovered</th>
        <th align="right" style="padding:6px 8px">Rec %</th>
      </tr></thead><tbody>
      ${s.rows.length ? s.rows.map(r => `<tr style="border-bottom:1px solid #e5e7eb">
        <td style="padding:6px 8px">${esc_(r.leader)}</td>
        <td align="right" style="padding:6px 8px">${money0(r.customers)}</td>
        <td align="right" style="padding:6px 8px">${money0(r.initial)}</td>
        <td align="right" style="padding:6px 8px">${money0(r.arrears)}</td>
        <td align="right" style="padding:6px 8px;color:#067647;font-weight:700">${money0(r.recovered)}</td>
        <td align="right" style="padding:6px 8px">${pctTxt(r.pct)}</td></tr>`).join('')
        : '<tr><td colspan="6" style="padding:10px;color:#6b7280">No customers in this category.</td></tr>'}
      </tbody>
      <tfoot><tr style="background:#f1f5f9;font-weight:700">
        <td style="padding:6px 8px">TOTAL</td>
        <td align="right" style="padding:6px 8px">${money0(s.totals.customers)}</td>
        <td align="right" style="padding:6px 8px">${money0(s.totals.initial)}</td>
        <td align="right" style="padding:6px 8px">${money0(s.totals.arrears)}</td>
        <td align="right" style="padding:6px 8px">${money0(s.totals.recovered)}</td>
        <td align="right" style="padding:6px 8px">${pctTxt(s.totals.pct)}</td>
      </tr></tfoot></table>`;
  return `<div style="font:14px system-ui;color:#111;max-width:860px">
    <h2 style="margin:0 0 2px;color:#0B2A6B">HOPE PMO — Expected Defaulters, weekly recovery</h2>
    <div style="color:#6b7280;font-size:13px">Week of ${esc_(d.weekOf)} · as of ${esc_(d.date || '—')} (${esc_(d.weekday)}) · sent by ${esc_(sentBy)}</div>
    ${d.hasBaseline ? '' : '<p style="color:#B42318"><b>Monday’s initial deck is not uploaded</b>, so recovery below reads 0. Upload it and resend.</p>'}
    <p style="margin:14px 0 0"><b>Whole book:</b> ${money0(t.customers)} customers ·
      initial ${money0(t.initial)} · now ${money0(t.arrears)} ·
      recovered <b style="color:#067647">${money0(t.recovered)}</b> (${pctTxt(t.pct)})</p>
    ${d.sections.map(section).join('')}
  </div>`;
}
async function emailWeeklyExpdf(db, user, _args, nowMs) {
  requireAdmin(user);
  const key = process.env.RESEND_API_KEY;
  if (!key) throw badRequest('Email is not configured yet: set RESEND_API_KEY on the deployment (Vercel → Settings → Environment Variables).');
  const { data: toRow } = await db.from('settings').select('value').eq('key', 'ADMIN_EMAIL').maybeSingle();
  const to = String((toRow && toRow.value) || '').trim();
  if (!to) throw badRequest('Set ADMIN_EMAIL in Settings to say where the report should go.');
  const { data: fromRow } = await db.from('settings').select('value').eq('key', 'EMAIL_FROM').maybeSingle();
  const from = String((fromRow && fromRow.value) || '').trim() || 'HOPE PMO <onboarding@resend.dev>';

  const d = await expdfReport(db, user, { weekly: true }, nowMs);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: to.split(/[;,]/).map(x => x.trim()).filter(Boolean),
      subject: `HOPE PMO — Expected Defaulters weekly recovery (week of ${d.weekOf})`,
      html: expdfEmailHtml(d, user.name) }),
  });
  const body = await res.json().catch(() => ({}));
  // Surface the provider's own words: "domain not verified" is the usual first failure and
  // guessing at it would send someone hunting in the wrong place.
  if (!res.ok) throw badRequest(`Email provider refused it: ${body.message || res.status}`);
  return { sent: true, to, weekOf: d.weekOf, id: body.id || null,
    customers: d.totals.customers, recovered: d.totals.recovered };
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
  complaints, addComplaint, saveComplaint, complaintLog, resolveComplaint,
  restructures, addRestructure, decideRestructure, restructureEligible, restructureContract,
  demandNotices, addDemandNotice, legalPreview, abnormal, received,
  par, weekly, teamProgress, leaderReports, commission, commissionSave, assignments, credit,
  dashboardFull, expectedDay, saveTeam, deleteTeam, hints, officerBoards,
  teams, saveRole, deleteRole, callAgents, saveCallAgent, settings: settingsList, settingSet,
  accessCodes, saveAccessCode, deleteAccessCode, callUsers, removeCallUser,
  storageUsage, purgeSnapshots, uploadStatus,
  announceSave, notifications, notifSeen, customerSearch,
  expdfMine, expdfReport, emailWeeklyExpdf,
  officerAccounts, saveOfficerAccount, deleteOfficerAccount,
  callReport: (db, user, a, now) => reportCoreForPortal(db, user, a, now),
};

export async function portalApi(db, user, fn, args, nowMs = Date.now()) {
  const h = FN[fn];
  if (!h) throw badRequest('Unknown portal function: ' + fn);
  return h(db, user, args || {}, nowMs);
}

export { assignFor };
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
    fetchAll(() => db.from('loans').select('id, stage, team, created_at, approved_date, approved_by, created_by, requested_amt, principal_amt, loan_amt')),
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
/** The team code is what field officers sign in with. It is editable in plain text on
    purpose: the PMO has to read it out over the phone, and change it the moment it leaks. */
const codeKeyOf = v => K(v).replace(/[^0-9A-Z]/g, '');
async function saveTeam(db, user, p) {
  requireAdmin(user);
  const team = normTeamName(p && p.team);
  if (!team) throw badRequest('team is required');
  const row = { team };
  for (const c of ['opm', 'recovery', 'gmo', 'manager', 'credit', 'expected', 'bike']) {
    if (p[c] !== undefined) row[c] = String(p[c] || '').trim() || null;
  }
  const existing = (await fetchAll(() => db.from('teams').select('*'))) || [];
  const mine = existing.find(t => K(t.team) === K(team));
  if (p.generateCode) {
    row.team_code = generatePasscode(6).replace('-', '');
  } else if (p.teamCode !== undefined) {
    const code = String(p.teamCode || '').trim();
    if (code && codeKeyOf(code).length < 4) {
      throw badRequest('A team code needs at least 4 characters — a short one gets guessed.');
    }
    row.team_code = code || null;
  }
  // Two teams sharing a code would silently put officers on the wrong book.
  if (row.team_code) {
    const clash = existing.find(t => K(t.team) !== K(team) && codeKeyOf(t.team_code) === codeKeyOf(row.team_code));
    if (clash) throw badRequest(`That code is already used by team ${clash.team}.`);
  }
  // Changing a code is how "someone left, lock them out" is done, so it has to cut the
  // handsets that were signed in on the old one -- otherwise nothing actually changes.
  const rotated = row.team_code !== undefined && mine && codeKeyOf(mine.team_code) !== codeKeyOf(row.team_code);
  row.updated_at = new Date().toISOString();
  const { error } = await db.from('teams').upsert(row, { onConflict: 'team' });
  if (error) throw new Error(error.message);
  let released = 0;
  if (rotated) {
    const users = await fetchAll(() => db.from('call_users').select('user_id, team, device_id, is_leader'));
    // Leaders sign in with a portal access code, not the team code, so rotating must not
    // knock them out along with the field officers.
    const hit = users.filter(u => K(u.team) === K(team) && u.device_id && !u.is_leader);
    for (const u of hit) {
      const { error: e } = await db.from('call_users').update({ device_id: null }).eq('user_id', u.user_id);
      if (e) throw new Error(e.message);
    }
    released = hit.length;
  }
  return { team, teamCode: row.team_code, rotated: !!rotated, released };
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
    fetchAll(() => db.from('followup_status').select('ref, team, status, fu_status, arrears')),
    fetchAll(() => db.from('loans').select('id, stage, team, created_at, approved_date, approved_by, created_by, requested_amt, principal_amt, loan_amt')),
    fetchAll(() => db.from('call_logs').select('*').gte('call_date', mon).lte('call_date', sun)),
  ]);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  const myExp = scoped(user, expWeek), myDef = scoped(user, defWeek);
  const myTmrw = scoped(user, tomorrow.rows), myFu = scoped(user, fu);
  const myLoans = scoped(user, loansAll), myCalls = scoped(user, callLogs);
  /* Resolve a deck the SAME way the dashboard card does: by date, type AND WEEKDAY.
     Ignoring weekday here was the bug behind "initial right, current bigger, recovery
     negative". A day can carry decks stamped with more than one weekday -- Monday's baseline
     re-uploaded today, say -- and pickLatestBatch then chose a DIFFERENT deck for initial than
     for current. Comparing two different populations reports the gap between them as
     recovery, which is how a matching pair of files produced -194m. */
  const onDate = (rows, d, type, weekday) => pickLatestBatchRows(rows.filter(r =>
    String(r.snapshot_date) === d && (!type || r.snapshot_type === type)
    && (!weekday || r.weekday === weekday)));

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
        // Debt crisis only means something across a WEEK: a customer cannot fall into default
        // between breakfast and lunch, so on the daily board this is noise dressed as news.
        debtCrisis: dailyRecovered ? Math.min(0, b.initial - b.current) : null,
        recovered: rec, pct: pctOf(rec, b.uncollected) };
    }).sort((a, b) => b.recovered - a.recovered);
  }
  const iniToday = onDate(myDef, today, 'initial', wd), curToday = onDate(myDef, today, 'current', wd);
  const recToday = recBoard(iniToday, curToday, null).map(r => ({ ...r, uncollected: weekUncol && r.uncollected ? r.uncollected : r.uncollected, pct: pctOf(r.recovered, r.uncollected) }));
  // Week: each day's own (initial - current) summed per officer, exactly like the trend row.
  const dailyRec = {};
  for (let i = 0; i < 7; i++) {
    const d = addDaysKey(mon, i);
    // Each day pairs its own initial against its own current, matched on weekday so the two
    // sides are always the same population.
    const dwd = WD7[i];
    const ini = onDate(myDef, d, 'initial', dwd), cur = onDate(myDef, d, 'current', dwd);
    if (!ini.length || !cur.length) continue;
    const per = {};
    for (const r of ini) per[officerOf(teamBy, r.team, 'recovery')] = (per[officerOf(teamBy, r.team, 'recovery')] || 0) + num(r.arrears);
    for (const r of cur) per[officerOf(teamBy, r.team, 'recovery')] = (per[officerOf(teamBy, r.team, 'recovery')] || 0) - num(r.arrears);
    for (const k of Object.keys(per)) dailyRec[k] = (dailyRec[k] || 0) + per[k];
  }
  const iniMon = onDate(myDef, mon, 'initial', 'MON');
  const recWeek = recBoard(iniMon, curToday, dailyRec);

  /* Recovery is initial MINUS current, so if one of the two decks is short the difference is
     reported as money recovered. Uploading the same file as both should read as zero
     recovery; a partial or wrong second upload instead shows a large, entirely fictional
     recovery, and nothing on the screen says why. Compare the headcounts and say so. */
  const deckWarning = (() => {
    if (!iniToday.length || !curToday.length) return null;
    const gap = Math.abs(iniToday.length - curToday.length);
    if (gap / Math.max(iniToday.length, curToday.length) < 0.02) return null;
    const short = curToday.length < iniToday.length ? 'current' : 'initial';
    return `Today's initial deck has ${iniToday.length.toLocaleString('en-US')} customers but the current deck has `
      + `${curToday.length.toLocaleString('en-US')} — the ${short} upload looks incomplete, so the recovery figures `
      + `below are overstated by the difference. Re-upload it before reading these numbers.`;
  })();

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

  return { weekday: wd, weekOf: mon, today, deckWarning,
    initialCount: iniToday.length, currentCount: curToday.length,
    earlyToday, earlyWeek, recToday, recWeek, creditToday, creditWeek, callToday, callWeek,
    fuStatus, fuTotal: real.length,
    weekUncollected: weekUncol };
}
