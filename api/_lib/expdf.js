import { fetchAll } from './supabase.js';
import { teamAllowed } from './auth.js';
import { todayKey, currentWeekday, weekMondayKey, isoWeekday, addDaysKey } from './time.js';
import { latestSnapshot } from './snapshots.js';
import { num } from './recovery.js';

/* Shared by BOTH the portal and the calls app, so it lives in its own module: portal-core
   already imports call-core, and having call-core import portal-core back closed a cycle
   that broke every test on both sides. */
const K = s => String(s == null ? '' : s).trim().toUpperCase();
const scoped = (user, rows) => rows.filter(r => teamAllowed(user, r.team));
const pctOf = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
function bucket(map, key, init) { if (!map[key]) map[key] = Object.assign({ key }, init); return map[key]; }
const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function rollSun(u) { return u === 7 ? 1 : u; }

import { assignFor, assignStrategy, ROLE_COLS } from './assign.js';

/* =======================================================================================
   EXPECTED DEFAULTERS BY RECYCLING LEADER

   The recycling rotation hands each defaulter to a GMO, a MANAGER or a BIKE officer, and
   moves them on a clock so the same person is not calling the same customer every week. Up
   to now that assignment was visible in the portal but NOWHERE on the phone -- the three
   leaders who actually do the work could not see their own list, so the rotation existed on
   paper and the follow-up did not happen.

   Each leader now gets their own expected-defaulter list for the day, carrying the cycle
   label the rotation put them in (D<days> while active, E-W<n> once expired, C-W<n> once
   chronic), what they are owed, and what has come back.

   Recovery here is measured against the SAME baseline the rest of the system uses:
     daily   that day's initial deck vs the current one
     weekly  Monday's initial deck vs the current one
   so a leader's number on this screen reconciles with the dashboard rather than being a
   second, differently-computed truth. */
export const RECYCLE_ROLES = ['GMO', 'MANAGER', 'BIKE'];
/* The report's boards: the three recycling roles, then the OPM -- who is assigned nothing by
   the rotation but answers for every team under them, so their board is the whole assigned
   book of their teams. "Have sort headers of By OPM". */
export const REPORT_ROLES = ['GMO', 'MANAGER', 'BIKE', 'OPM'];

export async function expdfCore(db, user, nowMs, { weekly = false } = {}) {
  const today = todayKey(nowMs), wd = currentWeekday(nowMs), mon = weekMondayKey(nowMs);
  const [curSnap, dayIni, monIni, teamRows, strat] = await Promise.all([
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current', weekday: wd }, { notAfter: today, teams: user.teams }),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'initial', weekday: wd }, { notAfter: today, teams: user.teams }),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'initial', weekday: 'MON' }, { onDate: mon, teams: user.teams }),
    fetchAll(() => db.from('teams').select('*')),
    assignStrategy(db),
  ]);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  // Weekly compares against Monday; daily against the same day's own initial. Where the
  // chosen baseline is missing the customer just shows 0 recovered rather than a fabricated
  // number computed off whatever deck happened to be lying around.
  const base = weekly ? (monIni.rows.length ? monIni : dayIni) : dayIni;
  const baseBy = {};
  for (const d of base.rows) baseBy[K(d.ref)] = num(d.arrears);

  const dayIdx = rollSun(isoWeekday(nowMs));
  const rows = scoped(user, curSnap.rows)
    .filter(d => { const s = K(d.status); return s.includes('CHRON') || s.includes('EXPIR') || s.includes('DEFAULT'); })
    .map(d => {
      const raw = d.disb_date ? isoWeekday(Date.parse(String(d.disb_date) + 'T00:00:00Z')) : 0;
      const primary = raw ? rollSun(raw) : 0;
      const secondary = primary ? rollSun(((primary - 1 + 3) % 7) + 1) : 0;
      const a = assignFor(d, strat, nowMs);
      const team = teamBy[K(d.team)] || {};
      const arrears = num(d.arrears);
      const initial = Object.prototype.hasOwnProperty.call(baseBy, K(d.ref)) ? baseBy[K(d.ref)] : arrears;
      return { ref: d.ref, full_name: d.full_name, contact: d.contact,
        guarantor_name: d.guarantor_name, guarantor_contact: d.guarantor_contact,
        team: d.team, arrears, initial, recovered: Math.max(0, initial - arrears),
        // The WEEKLY installment, which is what "rejesho" means to an officer at the door --
        // distinct from what has been recovered.
        rejesho: num(d.other_inst),
        ds: d.ds, dc: d.dc, disb_date: d.disb_date,
        status: K(d.status).includes('CHRON') ? 'CHRONIC' : (K(d.status).includes('EXPIR') ? 'EXPIRED' : 'DEFAULTER'),
        phase: a.phase, role: a.role, cycle: a.label,
        primary, secondary, primaryName: DAY_NAMES[primary] || '—', secondaryName: DAY_NAMES[secondary] || '—',
        onToday: primary === dayIdx || secondary === dayIdx,
        leader: (team[ROLE_COLS[a.role]] || '(unassigned)'),
        opm: (team[ROLE_COLS.OPM] || '(unassigned)') };
    });
  return { rows, dayIdx, weekday: wd, date: curSnap.date, hasBaseline: base.rows.length > 0 };
}

const sumExpdf = list => ({
  customers: list.length,
  arrears: list.reduce((s, r) => s + r.arrears, 0),
  initial: list.reduce((s, r) => s + r.initial, 0),
  recovered: list.reduce((s, r) => s + r.recovered, 0),
  pct: pctOf(list.reduce((s, r) => s + r.recovered, 0), list.reduce((s, r) => s + r.initial, 0)),
});

/** ONE leader's own list. Called by the phone (where the signed-in leader is the subject) and
    by the portal. Matching is on the NAME the teams table carries for that role, so moving a
    person between teams in Teams & Staff re-points their list with no other change. */
export async function expdfMine(db, user, { all = false, weekly = false, scope = 'auto' } = {}, nowMs) {
  const core = await expdfCore(db, user, nowMs, { weekly });
  const me = K(user.name);
  const assigned = core.rows.filter(r => RECYCLE_ROLES.includes(r.role));
  const own = assigned.filter(r => K(r.leader) === me);
  // Everyone follows up in this mode, so everyone can see the day's expected defaulters for
  // the teams they are allowed to see -- each row naming who is assigned. A recycling leader
  // defaults to their OWN list because that is the work in front of them; anyone else (an
  // officer, a supervisor, an admin) sees the whole scope, since a list of nobody's customers
  // would be no list at all.
  const isLeaderOfSome = own.length > 0;
  const useOwn = scope === 'mine' ? true : (scope === 'team' ? false : isLeaderOfSome);
  const mine = useOwn ? own : assigned;

  /* The 2-day cycle is read off DISB DATE. When the deck carries none -- a column renamed in
     the export, a sheet that never had it -- every row's cycle day is unknown, `onToday` is
     false for all of them, and the leader gets an empty screen with a full book behind it.
     A list nobody can see is worse than a list on the wrong day, so in that case the whole
     assigned book shows and the strip says why. */
  const dated = mine.filter(r => r.primary > 0);
  const noCycleDates = mine.length > 0 && dated.length === 0;
  const scopeRows = (all || noCycleDates) ? mine : mine.filter(r => r.onToday);
  scopeRows.sort((a, b) => b.arrears - a.arrears);
  return { rows: scopeRows, weekday: core.weekday, date: core.date,
    dayName: DAY_NAMES[core.dayIdx] || '', hasBaseline: core.hasBaseline,
    scope: useOwn ? 'mine' : 'team', canSwitch: isLeaderOfSome,
    /* Exactly where the list got to zero. An empty screen that cannot say WHY it is empty
       costs a phone call and a day; these five numbers answer it on the spot. */
    diag: { deck: core.rows.length, assigned: assigned.length, mine: mine.length,
      dated: dated.length, onToday: mine.filter(r => r.onToday).length,
      deckWeekday: core.weekday, deckDate: core.date, noCycleDates },
    totals: sumExpdf(scopeRows), allTotals: sumExpdf(mine),
    // Who is carrying what, so anyone looking at the list can see the split without leaving it.
    byLeader: Object.values(scopeRows.reduce((m, r) => {
      const b = bucket(m, r.leader + ' · ' + r.role, { customers: 0, arrears: 0, initial: 0, recovered: 0 });
      b.customers++; b.arrears += r.arrears; b.initial += r.initial; b.recovered += r.recovered;
      return m;
    }, {})).map(b => ({ leader: b.key, customers: b.customers, arrears: b.arrears,
      initial: b.initial, recovered: b.recovered, pct: pctOf(b.recovered, b.initial) }))
      .sort((a, b) => b.arrears - a.arrears),
    // The cycle breakdown is what makes the rotation legible on a small screen: D-buckets are
    // still inside term, E-W are expired, C-W are chronic.
    byCycle: Object.values(scopeRows.reduce((m, r) => {
      const b = bucket(m, r.cycle, { customers: 0, arrears: 0, initial: 0, recovered: 0 });
      b.customers++; b.arrears += r.arrears; b.initial += r.initial; b.recovered += r.recovered;
      return m;
    }, {})).map(b => ({ cycle: b.key, customers: b.customers, arrears: b.arrears,
      initial: b.initial, recovered: b.recovered, pct: pctOf(b.recovered, b.initial) }))
      .sort((a, b) => b.arrears - a.arrears) };
}

/* =======================================================================================
   THE WEEK'S WORK ON A BOOK, LEADER BY LEADER -- one definition, read by the report's columns
   and by the card behind a name, so the two can never disagree.

     "Add columns of No of calls + duration (calls among the assigned expected customer,
      guarantor & ana namba nyingine in them), and no of comments"

   A CALL is one number per day (the Calls report's own rule; the dials sit beside it),
   portfolio only, made from the HOPE Calls account(s) registered under the leader's name, to
   one of the book's customers: by the REF the sync stamped, or by the number dialled -- the
   customer's, the guarantor's, or a replacement number an officer recorded under ANA NAMBA
   NYINGINE (followup_comments.new_number). A COMMENT is one written under the leader's name
   in the week on one of those customers. A call to somebody else's customer counts nowhere.

   Four reads for the whole report, whatever its size: the HOPE Calls roster (two columns; a
   name is matched without regard to case, which .in() cannot do -- `Boss` and `BOSS` are one
   person), the leaders' portfolio calls of the week, the replacement numbers (only when there
   are calls to match), and the leaders' comments of the week. A single book -- the card --
   reads the roster by that one name. */
const nine_ = v => { const s = String(v == null ? '' : v).replace(/\D/g, ''); return s.length >= 9 ? s.slice(-9) : (s || null); };
const likeSafe_ = s => String(s).replace(/[%_\\]/g, m => '\\' + m);
// A name that would break PostgREST's or=(...) grammar is matched exactly instead.
const orSafe_ = s => !/[,()"\\]/.test(String(s));
function bad_(msg) { const e = new Error(msg); e.status = 400; throw e; }
const per_ = () => ({ calls: new Set(), dials: 0, talk: 0, lastCall: null, comments: 0, lastComment: null, lastStatus: null, lastAt: null });

export async function weekWork(db, books, weekOf, weekEnd) {
  const work = {};
  for (const b of books) work[b.key] = { dayNums: new Set(), dials: 0, talk: 0, connected: new Set(), called: new Set(),
    comments: 0, commented: new Set(), per: {}, recent: [] };
  const named = books.filter(b => b.leader && b.leader !== '(unassigned)' && b.rows.length);
  const byName = {};
  for (const b of named) (byName[K(b.leader)] = byName[K(b.leader)] || []).push(b);
  const names = Object.keys(byName);
  const inCalls = {};
  if (!names.length) return { work: finish_(work), inCalls };

  // 1. Whose calls: the HOPE Calls accounts under those names.
  let users = [];
  try {
    users = names.length === 1
      ? await fetchAll(() => db.from('call_users').select('user_id, name').ilike('name', likeSafe_(named[0].leader)))
      : await fetchAll(() => db.from('call_users').select('user_id, name'));
  } catch (e) { users = []; }
  const idBooks = {}, spellings = {};
  for (const u of users) {
    const k = K(u.name);
    if (!byName[k] || !u.user_id) continue;
    inCalls[k] = true;
    (idBooks[u.user_id] = idBooks[u.user_id] || []).push(...byName[k]);
    (spellings[k] = spellings[k] || new Set()).add(String(u.name));
  }
  const ids = Object.keys(idBooks);

  // 2. Their portfolio calls of the week.
  let calls = [];
  if (ids.length) {
    try {
      calls = await fetchAll(() => db.from('call_logs').select('user_id, phone, ref, call_date, duration, outcome')
        .in('user_id', ids).gte('call_date', weekOf).lte('call_date', weekEnd).eq('portfolio', true));
    } catch (e) { calls = []; }
  }
  // 3. The replacement numbers officers recorded (ANA NAMBA NYINGINE), so a call to one counts
  //    for the customer it was recorded under even where the sync did not stamp the REF.
  const altByRef = {};
  if (calls.length) {
    let alts = [];
    try { alts = await fetchAll(() => db.from('followup_comments').select('ref, new_number').not('new_number', 'is', null).neq('new_number', '')); } catch (e) { alts = []; }
    for (const a of alts) { const r = K(a.ref), d = nine_(a.new_number); if (r && d) (altByRef[r] = altByRef[r] || []).push(d); }
  }
  const index = b => {
    if (b._idx) return b._idx;
    const refSet = new Set(), byPhone = {};
    for (const r of b.rows) {
      const ref = K(r.ref); refSet.add(ref);
      for (const ph of [r.contact, r.guarantor_contact].concat(altByRef[ref] || [])) { const n = nine_(ph); if (n && !byPhone[n]) byPhone[n] = ref; }
    }
    return (b._idx = { refSet, byPhone });
  };
  for (const c of calls) {
    for (const b of (idBooks[c.user_id] || [])) {
      const { refSet, byPhone } = index(b);
      const ref = refSet.has(K(c.ref)) ? K(c.ref) : (byPhone[nine_(c.phone)] || null);
      if (!ref) continue;
      const w = work[b.key], key = String(c.call_date) + '|' + nine_(c.phone);
      const p = w.per[ref] || (w.per[ref] = per_());
      p.calls.add(key); p.dials++; p.talk += num(c.duration);
      if (!p.lastCall || String(c.call_date) > p.lastCall) p.lastCall = String(c.call_date);
      w.dayNums.add(key); w.dials++; w.talk += num(c.duration); w.called.add(ref);
      if (K(c.outcome) === 'CONNECTED') w.connected.add(key);
    }
  }

  // 4. Their comments of the week, under any spelling of the name the roster or the teams table carries.
  const clauses = [], exact = new Set();
  for (const b of named) {
    const all = new Set([String(b.leader), K(b.leader)].concat([...(spellings[K(b.leader)] || [])]));
    for (const s of all) { if (orSafe_(s)) clauses.push('created_by.ilike.' + likeSafe_(s)); else exact.add(s); }
  }
  let comments = [];
  try {
    let q = db.from('followup_comments').select('ref, full_name, comment, fu_status, promise_date, promise_amt, created_by, created_at')
      .gte('created_at', weekOf + 'T00:00:00+03:00').lte('created_at', weekEnd + 'T23:59:59+03:00');
    q = clauses.length ? q.or([...new Set(clauses)].join(',')) : q.in('created_by', [...exact]);
    comments = await fetchAll(() => q);
  } catch (e) { comments = []; }
  for (const c of comments) {
    for (const b of (byName[K(c.created_by)] || [])) {
      const { refSet } = index(b); const ref = K(c.ref);
      if (!refSet.has(ref)) continue;
      const w = work[b.key], p = w.per[ref] || (w.per[ref] = per_());
      p.comments++;
      if (!p.lastAt || String(c.created_at) > p.lastAt) { p.lastAt = String(c.created_at); p.lastComment = c.comment || null; p.lastStatus = c.fu_status || null; }
      w.comments++; w.commented.add(ref);
      w.recent.push({ ref: c.ref, full_name: c.full_name || null, comment: c.comment || '', fu_status: c.fu_status || null,
        promise_date: c.promise_date || null, promise_amt: c.promise_amt == null ? null : num(c.promise_amt), created_at: c.created_at });
    }
  }
  return { work: finish_(work), inCalls };
}
function finish_(work) {
  const out = {};
  for (const k of Object.keys(work)) {
    const w = work[k];
    w.recent.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    out[k] = { calls: w.dayNums.size, dials: w.dials, talk: w.talk, connected: w.connected.size, reached: w.called.size,
      comments: w.comments, commented: w.commented.size, per: w.per, recent: w.recent };
  }
  return out;
}
const bookWeek_ = (nowMs, weekOf, weekEnd) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(weekOf || '')) ? String(weekOf) : weekMondayKey(nowMs);
  return { weekOf: from, weekEnd: /^\d{4}-\d{2}-\d{2}$/.test(String(weekEnd || '')) ? String(weekEnd) : addDaysKey(from, 6) };
};

/** The management view: every GMO / MANAGER / BIKE with their own book and their own recovery,
    and every OPM with the whole assigned book of their teams, daily or for the week -- each
    with the week's calls, talk time and comments beside the customers they hold. This is what
    says which category, and which person, is actually working the rotation and which is not. */
export async function expdfReport(db, user, { weekly = false, day = null, weekOf = null, weekEnd = null } = {}, nowMs) {
  const core = await expdfCore(db, user, nowMs, { weekly });
  const onScope = r => (weekly ? true : (day === 'all' ? true : r.onToday));
  const all = core.rows.filter(r => RECYCLE_ROLES.includes(r.role) && onScope(r));
  const books = [];
  const built = REPORT_ROLES.map(role => {
    const mine = role === 'OPM' ? all : all.filter(r => r.role === role);
    const by = {};
    for (const r of mine) {
      const b = bucket(by, role === 'OPM' ? r.opm : r.leader, { customers: 0, arrears: 0, initial: 0, recovered: 0, teams: {}, opms: {}, rows: [] });
      b.customers++; b.arrears += r.arrears; b.initial += r.initial; b.recovered += r.recovered; b.rows.push(r);
      if (r.team) b.teams[K(r.team)] = r.team;
      // "Add an OPM column on the three role boards too": the OPM(s) of the teams this leader holds.
      if (r.opm && r.opm !== '(unassigned)') b.opms[K(r.opm)] = r.opm;
    }
    for (const b of Object.values(by)) books.push({ key: role + '|' + K(b.key), leader: b.key, rows: b.rows });
    return { role, by, mine };
  });
  const win = bookWeek_(nowMs, weekOf, weekEnd);
  const { work, inCalls } = await weekWork(db, books, win.weekOf, win.weekEnd);
  const sections = built.map(({ role, by, mine }) => {
    const rows = Object.values(by).map(b => { const w = work[role + '|' + K(b.key)] || {}; return { leader: b.key,
      opm: role === 'OPM' ? undefined : (Object.values(b.opms).sort().join(', ') || '(unassigned)'),
      teams: Object.keys(b.teams).length, customers: b.customers,
      calls: w.calls || 0, dials: w.dials || 0, talk: w.talk || 0, comments: w.comments || 0,
      inCalls: !!inCalls[K(b.key)],
      arrears: b.arrears, initial: b.initial, recovered: b.recovered,
      pct: pctOf(b.recovered, b.initial) }; }).sort((a, b) => b.recovered - a.recovered);
    const sum = f => rows.reduce((s, r) => s + r[f], 0);
    return { role, rows, totals: { ...sumExpdf(mine), calls: sum('calls'), dials: sum('dials'), talk: sum('talk'), comments: sum('comments') },
      unassigned: rows.filter(r => r.leader === '(unassigned)').length };
  });
  return { weekly, weekday: core.weekday, date: core.date, weekOf: win.weekOf,
    dayName: DAY_NAMES[core.dayIdx] || '', hasBaseline: core.hasBaseline,
    sections, totals: sumExpdf(all) };
}


/* =======================================================================================
   ONE LEADER'S WEEK, OPENED FROM THEIR NAME ON THE REPORT.

     "At expected defaulter report .. as per an individual - tapping a name of gmo, manager
      or bike should open card to show how many portfolio calls they made among the expected
      defaulters and added comments and recovery earned."

   The report says what each leader's book is worth and what came back. This says what they
   DID about it, customer by customer, so a leader with a good recovery and no calls, or many
   calls and no recovery, is visible as such. THE SAME BOOK AS THE ROW THEY TAPPED: the
   rotation's rows for that role and that name -- for an OPM, every assigned row of their
   teams -- read as the report reads them, and the week's work by the one definition above.
   Read on the tap only, never with the report. */
export async function expdfLeader(db, user, { role, leader, weekOf, weekEnd } = {}, nowMs) {
  const R = K(role), L = String(leader == null ? '' : leader).trim();
  if (!REPORT_ROLES.includes(R)) bad_('Chagua GMO, MANAGER, BIKE au OPM. / Pick GMO, MANAGER, BIKE or OPM.');
  if (!L || L === '(unassigned)') bad_('Chagua kiongozi aliyetajwa. / Pick a named leader.');
  const core = await expdfCore(db, user, nowMs, { weekly: true });
  const rows = core.rows.filter(r => RECYCLE_ROLES.includes(r.role) && (R === 'OPM' ? K(r.opm) === K(L) : (r.role === R && K(r.leader) === K(L))));
  const win = bookWeek_(nowMs, weekOf, weekEnd);
  const { work, inCalls } = await weekWork(db, [{ key: 'one', leader: L, rows }], win.weekOf, win.weekEnd);
  const w = work.one;
  const out = rows.map(r => { const p = w.per[K(r.ref)] || per_(); return {
    ref: r.ref, full_name: r.full_name, contact: r.contact, team: r.team, cycle: r.cycle, status: r.status,
    initial: r.initial, arrears: r.arrears, recovered: r.recovered,
    calls: p.calls.size, dials: p.dials, talk: p.talk, lastCall: p.lastCall,
    comments: p.comments, lastComment: p.lastComment, lastStatus: p.lastStatus }; })
    .sort((a, b) => (b.recovered - a.recovered) || (b.calls - a.calls) || (b.arrears - a.arrears));
  const t = sumExpdf(rows);
  return { role: R, leader: L, weekOf: win.weekOf, weekEnd: win.weekEnd, inCalls: !!inCalls[K(L)], hasBaseline: core.hasBaseline,
    totals: { ...t, recoveredCustomers: rows.filter(r => r.recovered > 0).length,
      calls: w.calls, dials: w.dials, talk: w.talk, connected: w.connected,
      reached: w.reached, comments: w.comments, commented: w.commented },
    rows: out, recent: w.recent.slice(0, 10) };
}
