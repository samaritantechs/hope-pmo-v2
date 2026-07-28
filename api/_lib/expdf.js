import { fetchAll } from './supabase.js';
import { teamAllowed } from './auth.js';
import { todayKey, currentWeekday, weekMondayKey, isoWeekday } from './time.js';
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
        leader: (team[ROLE_COLS[a.role]] || '(unassigned)') };
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

/** The management view: every GMO / MANAGER / BIKE with their own book and their own recovery,
    daily or for the week. This is what says which of the three categories is actually working
    its rotation and which is not. */
export async function expdfReport(db, user, { weekly = false, day = null } = {}, nowMs) {
  const core = await expdfCore(db, user, nowMs, { weekly });
  const onScope = r => (weekly ? true : (day === 'all' ? true : r.onToday));
  const sections = RECYCLE_ROLES.map(role => {
    const mine = core.rows.filter(r => r.role === role && onScope(r));
    const by = {};
    for (const r of mine) {
      const b = bucket(by, r.leader, { customers: 0, arrears: 0, initial: 0, recovered: 0, teams: {} });
      b.customers++; b.arrears += r.arrears; b.initial += r.initial; b.recovered += r.recovered;
      if (r.team) b.teams[K(r.team)] = r.team;
    }
    const rows = Object.values(by).map(b => ({ leader: b.key,
      teams: Object.keys(b.teams).length, customers: b.customers,
      arrears: b.arrears, initial: b.initial, recovered: b.recovered,
      pct: pctOf(b.recovered, b.initial) })).sort((a, b) => b.recovered - a.recovered);
    return { role, rows, totals: sumExpdf(mine), unassigned: rows.filter(r => r.leader === '(unassigned)').length };
  });
  const all = core.rows.filter(r => RECYCLE_ROLES.includes(r.role) && onScope(r));
  return { weekly, weekday: core.weekday, date: core.date, weekOf: weekMondayKey(nowMs),
    dayName: DAY_NAMES[core.dayIdx] || '', hasBaseline: core.hasBaseline,
    sections, totals: sumExpdf(all) };
}

