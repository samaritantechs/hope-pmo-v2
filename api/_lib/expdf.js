import { fetchAll } from './supabase.js';
import { teamAllowed } from './auth.js';
import { todayKey, currentWeekday, weekMondayKey, isoWeekday, addDaysKey } from './time.js';
import { latestSnapshot } from './snapshots.js';
import { num } from './recovery.js';
import { cachedAnswer } from './answer-cache.js';

/* Shared by BOTH the portal and the calls app, so it lives in its own module: portal-core
   already imports call-core, and having call-core import portal-core back closed a cycle
   that broke every test on both sides. */
const K = s => String(s == null ? '' : s).trim().toUpperCase();
const scoped = (user, rows) => rows.filter(r => teamAllowed(user, r.team));
const pctOf = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
function bucket(map, key, init) { if (!map[key]) map[key] = Object.assign({ key }, init); return map[key]; }
const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
     weekly  the sum of the days (expdfWeekCore below) -- as the dashboard adds a week
   so a leader's number on this screen reconciles with the dashboard rather than being a
   second, differently-computed truth. (expdfCore's own `weekly` option, Monday's deck against
   the latest current one, is kept only for callers that still ask for it.) */
export const RECYCLE_ROLES = ['GMO', 'MANAGER', 'BIKE'];
/* The report's boards are the three recycling roles. A fourth, "By OPM" (the whole assigned
   book of each OPM's teams), was built and then dropped at the GM's word -- "Drop - Kwa OPM /
   By OPM"; the OPM instead stands as the first column of each role board. */

/* The month's FIRST initial deck -- the baseline a monthly figure is measured from. One tiny
   date query (ascending, one row), then that day's deck. Where the month has no deck yet the
   caller falls back, never fails. */
const NONE_ = { rows: [], date: null, batch: null };
async function monthFirstInitial_(db, user, from, to) {
  try {
    const { data, error } = await db.from('defaulter_snapshots').select('snapshot_date').eq('snapshot_type', 'initial')
      .gte('snapshot_date', from).lte('snapshot_date', to).order('snapshot_date', { ascending: true }).limit(1).maybeSingle();
    if (error || !data || !data.snapshot_date) return NONE_;
    return await latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'initial' }, { onDate: data.snapshot_date, teams: user.teams });
  } catch (e) { return NONE_; }
}

/* ONE DAY'S ROWS: the customers still in default, PLUS anyone this same day's initial deck
   placed as a defaulter who has since paid in full -- "they cant run from when their initial
   file had them": once a customer is on a day's own initial deck, that day's report carries
   them through to whatever the current deck now shows for them, recovered or not. Each row
   carries the arrears the same day's initial deck had for them (`baseBy`, by ref), who the
   rotation hands an ACTIVE one to AT `ms`, and whether it is their cycle day at `ms`. The one
   definition of a row -- the day's report reads it for the day, the week's for every day it
   adds up -- so a week can never be built on a rule the days are not.

   "When a customer of expected defaulter pays full amount and no longer a defaulter, they
   dessapear from the expected defaulters report, yet they should stay there as of recovery so
   as to know recovery amount from difference of initial to current per each day by team or
   staff" -- the owner, 13 Nov 2026. Before this, a customer's current-deck row was read only
   if its own status still read Chronic/Expired/Defaulter -- paid in full, their row (status
   PAID or similar) was simply never looked at, so their recovery never reached ANY sum on this
   report family, not only its display. A customer whose CURRENT status does not match one of
   the three is not dropped if they were on this SAME day's initial deck (`baseBy`): they are
   kept, status CLEARED, with whatever their current row now shows.

   "So even in call app if they clear they go down with status cleared.. same for the rest
   defaulters lists if possible" -- the owner, 13 Nov 2026. CLEARED is not a worklist exclusion:
   `expdfMine` (the phone's own list, and the portal's) and `expectedDefaulters` (the portal's
   separate Expected Defaulters tab) both read this same row unfiltered by status, so a cleared
   customer sinks to the bottom of either list on the arrears-descending sort they already had
   (0 arrears sorts last) rather than vanishing -- confirmation that they cleared, not a gap
   nobody can account for.

   A customer with no current row at all (genuinely absent from the file, not merely a
   different status) is the one case this cannot reach -- the rotation's own role/phase needs
   fields (days_elapsed, chronic_date, expire_date) that exist only on a current-deck row. */
function buildRows_(user, curRows, baseBy, teamBy, strat, ms) {
  const dayIdx = isoWeekday(ms);
  return scoped(user, curRows)
    .filter(d => { const s = K(d.status); return s.includes('CHRON') || s.includes('EXPIR') || s.includes('DEFAULT')
      || Object.prototype.hasOwnProperty.call(baseBy, K(d.ref)); })
    .map(d => {
      const raw = d.disb_date ? isoWeekday(Date.parse(String(d.disb_date) + 'T00:00:00Z')) : 0;
      const primary = raw;
      const secondary = primary ? ((primary - 1 + 3) % 7) + 1 : 0;
      const a = assignFor(d, strat, ms);
      const team = teamBy[K(d.team)] || {};
      const arrears = num(d.arrears);
      const initial = Object.prototype.hasOwnProperty.call(baseBy, K(d.ref)) ? baseBy[K(d.ref)] : arrears;
      const s = K(d.status);
      const status = s.includes('CHRON') ? 'CHRONIC' : (s.includes('EXPIR') ? 'EXPIRED' : (s.includes('DEFAULT') ? 'DEFAULTER' : 'CLEARED'));
      return { ref: d.ref, full_name: d.full_name, contact: d.contact,
        guarantor_name: d.guarantor_name, guarantor_contact: d.guarantor_contact,
        team: d.team, arrears, initial, recovered: Math.max(0, initial - arrears),
        // The WEEKLY installment, which is what "rejesho" means to an officer at the door --
        // distinct from what has been recovered.
        rejesho: num(d.other_inst),
        ds: d.ds, dc: d.dc, disb_date: d.disb_date,
        status,
        // role/phase/cycle/leader are UNCHANGED for a CLEARED row -- still the rotation slot
        // this customer sits in, same as any other day. That is what lets periodRows_ and
        // expdfMine's own RECYCLE_ROLES.includes(r.role) filter keep the row at all, and what
        // credits the RIGHT officer for the recovery in byLeader/byCycle below -- the one the
        // owner actually asked for ("know recovery amount ... by team or staff"). Only the
        // STATUS says the account is settled, not whose book it sits in.
        phase: a.phase, role: a.role, cycle: a.label,
        primary, secondary, primaryName: DAY_NAMES[primary] || '—', secondaryName: DAY_NAMES[secondary] || '—',
        onToday: primary === dayIdx || secondary === dayIdx,
        leader: (team[ROLE_COLS[a.role]] || '(unassigned)'),
        // The leader's number as Teams & Staff carries it (gmo_no / manager_no / bike_no), the
        // surest link to their HOPE Calls account when the two spell the name differently.
        leaderPhone: team[ROLE_COLS[a.role] + '_no'] || null,
        opm: (team[ROLE_COLS.OPM] || '(unassigned)') };
    });
}

export async function expdfCore(db, user, nowMs, { weekly = false, monthly = false } = {}) {
  const today = todayKey(nowMs), wd = currentWeekday(nowMs), mon = weekMondayKey(nowMs);
  // Only the baseline the period needs is read: Monday's deck for a week, the month's first
  // deck for a month, nothing extra for a day.
  const [curSnap, dayIni, monIni, monthIni, teamRows, strat] = await Promise.all([
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current', weekday: wd }, { notAfter: today, teams: user.teams }),
    latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'initial', weekday: wd }, { notAfter: today, teams: user.teams }),
    weekly ? latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'initial', weekday: 'MON' }, { onDate: mon, teams: user.teams }) : Promise.resolve(NONE_),
    monthly ? monthFirstInitial_(db, user, today.slice(0, 7) + '-01', today) : Promise.resolve(NONE_),
    fetchAll(() => db.from('teams').select('*')),
    assignStrategy(db),
  ]);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  // A month compares against its first deck, a week against Monday's, a day against the same
  // day's own initial. Where the chosen baseline is missing the customer just shows 0 recovered
  // rather than a fabricated number computed off whatever deck happened to be lying around.
  const base = monthly ? (monthIni.rows.length ? monthIni : dayIni) : weekly ? (monIni.rows.length ? monIni : dayIni) : dayIni;
  const baseBy = {};
  for (const d of base.rows) baseBy[K(d.ref)] = num(d.arrears);

  const dayIdx = isoWeekday(nowMs);
  const rows = buildRows_(user, curSnap.rows, baseBy, teamBy, strat, nowMs);
  return { rows, dayIdx, weekday: wd, date: curSnap.date, hasBaseline: base.rows.length > 0, baseDate: base.date,
    baseline: monthly ? 'month' : (weekly ? 'week' : 'day') };
}

/* =======================================================================================
   THE WEEK IS THE SUM OF ITS DAYS -- "the weekly expected def report ain't summing right by
   officer for what they added up during the days in the week".

   It was not. The week was Monday's initial deck against the LATEST current deck, per customer,
   every customer handed whole to whoever the rotation holds him with TODAY. The rotation moves
   a defaulter on every two days of his arrears, so a customer worked by the bike officer on
   Monday and the manager on Wednesday was credited, for the whole week, to the manager; a
   customer who paid and then fell due again showed no recovery at all; one newly flagged on
   Thursday was blamed on a baseline that never carried him. An officer adding up their own
   daily reports could not reach the weekly figure, and was right.

   The owner's rule for every weekly figure in the portal is the one already written in the
   dashboard (sumRangeStand_ in portal-core.js): "a week total is just a sum from the sums of
   each day" -- each day's OWN initial deck against that day's OWN current deck, added -- "never
   a single boundary pair (Monday's deck less Friday's)". This is that rule for the leaders:
   each day of the week is the DAILY report's own list for that day (the customers whose cycle
   day it is, handed to the leader the rotation names that day, recovery by the one row rule in
   buildRows_), and the week is the days added, officer by officer. A leader's week is exactly
   what they added up.

   A day counts when BOTH its own decks were filed on it (onDate -- never an older deck that
   shares the weekday; a day nobody filed contributes nothing, and the answer says which days
   those were). Initial is the days' initials added, so Rec % is what came back on what was on
   their lists. A customer a leader held on two days is one row in the leader's book, with the
   recovery of both days; one held by two leaders in the week is a row in each book, so every
   column adds up to the grand total. The live week runs to today; a past or upcoming week is
   read as it stood on its Friday, like the dashboard.

   COST: two deck reads per day filed, so five days is ten where the old week read three. The
   initial deck is read for two columns and the current one for the fifteen it uses, never the
   whole row. Sequential, as the month ledger's note in portal-core.js insists -- a week-sized
   read answers on the live instance, concurrent ones are what exhausted the pool. Portal only:
   nothing on /api/upload or /api/call reads this. The month keeps its first-deck baseline (a
   month of decks is not a request's worth of reads); say if it should follow. */
const WD_ = ['', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const INI_COLS_ = ['ref', 'arrears', 'team'];
const CUR_COLS_ = ['ref', 'full_name', 'contact', 'guarantor_name', 'guarantor_contact', 'team', 'arrears', 'other_inst', 'ds', 'dc',
  'disb_date', 'status', 'days_elapsed', 'chronic_date', 'expire_date'];
/** The week, kept for a minute per set of teams (answer-cache.js): the report pays for the days
    once, and every leader's card opened from it in the next minute reads them from memory instead
    of reading ten decks again. Rows are shared between callers and never changed by them. */
export async function expdfWeekCore(db, user, nowMs, { from, to } = {}) {
  const isKey = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const mon = isKey(from) ? String(from) : weekMondayKey(nowMs);
  const sun = isKey(to) ? String(to) : addDaysKey(mon, 6);
  const last = sun < todayKey(nowMs) ? sun : todayKey(nowMs);
  return cachedAnswer(db, 'expdfweek|' + mon + '|' + last, user, nowMs, () => expdfWeekCompute_(db, user, nowMs, mon, last));
}
async function expdfWeekCompute_(db, user, nowMs, mon, last) {
  const today = todayKey(nowMs);
  const [teamRows, strat] = await Promise.all([fetchAll(() => db.from('teams').select('*')), assignStrategy(db)]);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  const cells = new Map(), days = [];
  // A customer whose cycle day cannot be read is counted on NO day by the loop below (their
  // `primary` is 0, which equals no real weekday), so they are tracked here instead and added
  // to the week ONCE, after the loop -- the most recent day their book still carried them,
  // never summed day over day the way a dated customer's cycle days are. See periodRows_'s own
  // note for why `keepUndated: false` is passed into it below.
  //
  // KEYED BY REF ALONE, NOT role|leader|ref -- an undated customer's ROLE still rotates on the
  // ordinary clock (assignFor reads days_elapsed, nothing to do with whether disb_date can be
  // read), so across a five-day week they can easily cross a bucket boundary and change leader
  // while still undated the whole time. Keying this the way `cells` is keyed gave each leader
  // they passed through its own entry -- the SAME customer, rescued once per leader instead of
  // once for the week, each copy carrying one day's figure as if it were the whole week's.
  // (Found on review, before this shipped: proved with a customer whose days_elapsed crosses a
  // bucket boundary mid-week, counted on both the BIKE and the MANAGER board for one week.)
  const undatedSeen = new Map(), seenAsDated = new Set();
  for (let d = mon; d <= last; d = addDaysKey(d, 1)) {
    const at = d === today ? nowMs : Date.parse(d + 'T09:00:00Z');
    const wd = WD_[isoWeekday(at)];
    const ini = await latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'initial', weekday: wd }, { onDate: d, teams: user.teams, columns: INI_COLS_ });
    const cur = ini.rows.length
      ? await latestSnapshot(db, 'defaulter_snapshots', { snapshot_type: 'current', weekday: wd }, { onDate: d, teams: user.teams, columns: CUR_COLS_ })
      : NONE_;
    if (!ini.rows.length || !cur.rows.length) { days.push({ date: d, weekday: wd, measured: false, why: ini.rows.length ? 'no current deck' : 'no initial deck' }); continue; }
    const baseBy = {};
    for (const r of ini.rows) baseBy[K(r.ref)] = num(r.arrears);
    const built = buildRows_(user, cur.rows, baseBy, teamBy, strat, at);
    const list = periodRows_({ rows: built }, { daily: true, day: null, keepUndated: false });
    for (const r of list) {
      const k = r.role + '|' + K(r.leader) + '|' + K(r.ref), c = cells.get(k);
      /* byDay: what THIS day added to this leader's book on this customer -- the daily report's own figure for the day, kept so the
         week can show its days (the proof that an officer's week is their days added). */
      const dayCell = { initial: r.initial, arrears: r.arrears, recovered: r.recovered, status: r.status };   // arrears + status: the day's own, for the card's day tabs
      if (!c) cells.set(k, { ...r, days: 1, byDay: { [d]: dayCell } });
      else { c.byDay[d] = dayCell;
        Object.assign(c, r, { initial: c.initial + r.initial, recovered: c.recovered + r.recovered, days: c.days + 1, byDay: c.byDay }); }
      seenAsDated.add(K(r.ref));                  // this ref reached a real cycle day this week: the rescue below must leave it alone
    }
    for (const r of built) if (RECYCLE_ROLES.includes(r.role) && r.primary === 0) undatedSeen.set(K(r.ref), { r, date: d });
    days.push({ date: d, weekday: wd, measured: true, customers: list.length });
  }
  // The once-per-week rescue: a customer never added by the loop above (their cycle day could
  // never be read, on any day they were seen) goes in now, with the figures and the role/leader
  // of the LAST day they were still in the book -- one customer, one row, however many leaders
  // they drifted across while undated; a ref that DID reach a real cycle day this week (so it
  // is already a row in `cells`, perhaps under a different leader entirely) is left as it is.
  for (const [ref, { r, date }] of undatedSeen) {
    if (seenAsDated.has(ref)) continue;
    const k = r.role + '|' + K(r.leader) + '|' + ref;
    const dayCell = { initial: r.initial, arrears: r.arrears, recovered: r.recovered, status: r.status };
    cells.set(k, { ...r, days: 1, byDay: { [date]: dayCell } });
  }
  const measured = days.filter(x => x.measured), first = measured[0] || null, lastM = measured[measured.length - 1] || null;
  const lastAt = lastM ? Date.parse(lastM.date + 'T09:00:00Z') : (last === today ? nowMs : Date.parse(last + 'T09:00:00Z'));
  return { rows: [...cells.values()], dayIdx: isoWeekday(lastAt), weekday: WD_[isoWeekday(lastAt)], date: lastM ? lastM.date : null,
    hasBaseline: measured.length > 0, baseDate: first ? first.date : null, baseline: 'week', days };
}

/* =======================================================================================
   THE PERIOD A FIGURE IS READ FOR -- "Exp.Def Report should be daily . . put a weekly and
   monthly on buttons in front of calendar date picker there".

   One resolver for the report and the card behind a name, so the row and the card are always
   the same period. `period` is day (the default), week or month; `date` (or the older
   `weekOf`) is any day, and the period says what to make of it: the day itself, the Monday
   week that holds it, the month that holds it. A past period is read as it stood at its close
   (a past day on that day, a past week on its Sunday, a past month on its last day); the
   current one as of now; a future one at its close too, since a future deck is one somebody
   has already uploaded in advance. `weekly: true` without a period means a week, for the
   weekly e-mail and older callers.

   THE WEEK IS MONDAY TO SUNDAY, NOT MONDAY TO FRIDAY -- "Expected defaulters goes mon to
   sunday not mon to fri". `ms` used to pin a past or future week's clock to its FRIDAY
   (mirroring the dashboard's own asOfWeek, portal-core.js) -- and that same clock is what
   expdfWeekCore reads back out, as `todayKey(nowMs)`, to decide where its own day-loop stops.
   So for any week that was not the live one, Saturday and Sunday were never walked at all --
   not measured, not in a day tab, not in anybody's week total -- even though `to` on this same
   answer already said Sunday. Pinned to the week's own Sunday instead, so the clock this
   resolver hands back can never fall short of the range it also hands back. asOfWeek is left
   alone on purpose: it is the dashboard's own helper, shared by screens that have nothing to
   do with Exp.Def, and nobody asked for those to change. */
export function expdfPeriod(nowMs, args = {}) {
  const today = todayKey(nowMs);
  let period = String(args.period || '').toLowerCase();
  if (!['day', 'week', 'month'].includes(period)) period = args.weekly === true ? 'week' : 'day';
  const pick = [args.date, args.weekOf].map(v => String(v == null ? '' : v)).find(v => /^\d{4}-\d{2}-\d{2}$/.test(v)) || today;
  const at = k => Date.parse(k + 'T09:00:00Z');       // midday, so no timezone arithmetic rolls the date
  if (period === 'day') {
    return { period, from: pick, to: pick, ms: pick === today ? nowMs : at(pick), requested: pick, past: pick < today, future: pick > today };
  }
  if (period === 'week') {
    const thisMon = weekMondayKey(nowMs), mon = weekMondayKey(at(pick));
    return { period, from: mon, to: addDaysKey(mon, 6), ms: mon === thisMon ? nowMs : at(addDaysKey(mon, 6)),
      requested: mon, past: mon < thisMon, future: mon > thisMon };
  }
  const ym = pick.slice(0, 7), thisYm = today.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const end = todayKey(Date.UTC(y, m, 0, 12));        // day 0 of the next month is this month's last day
  return { period, from: ym + '-01', to: ym === thisYm ? today : end, ms: ym === thisYm ? nowMs : at(end),
    requested: ym + '-01', past: ym < thisYm, future: ym > thisYm };
}

/* THE DAY'S LIST IS THE ROTATION'S OWN: on a daily reading, the customers whose cycle day it is
   (as on the phone), PLUS every assigned customer whose cycle day could not be read at all --
   "some staff ... somedays not getting expected defaulters, something not reality". A missing
   or unreadable disbursement date (an exported column renamed, a date spelt a way Date.parse
   cannot read) left that customer's `primary` at 0, which no real weekday ever equals, so they
   were onToday on NO day: real arrears, on nobody's screen, on any day, for as long as the
   date stayed unreadable -- unless EVERY customer in the read shared the same fault, when the
   old rule rescued the whole book. A customer sharing a book with dated colleagues got no such
   rescue: expectedDefaulters (portal-core.js) already promises to bucket such a one into day 0
   and never drop them; this is that same promise, kept here too. A week or a month still takes
   the whole book, undated customers included either way.

   `keepUndated` is for expdfWeekCompute_'s own per-day pass below ONLY: a week counts a
   customer on the days their cycle actually names (`buildRows_`'s primary/secondary), and an
   undated customer has no such day to be counted on twice, so the week picks them up ONCE,
   itself, after its own loop -- never through this per-day filter, or their arrears would be
   added once for every day of the week instead of once for the week. */
function periodRows_(core, { daily, day, keepUndated = true }) {
  const assigned = core.rows.filter(r => RECYCLE_ROLES.includes(r.role));
  if (!daily || day === 'all') return assigned;
  return assigned.filter(r => r.onToday || (keepUndated && r.primary === 0));
}

/** What each day of a week recovered over a list of week rows: { 'YYYY-MM-DD': recovered }. Empty for a day or a month. */
function dayTotals_(list) {
  const out = {};
  for (const r of list) for (const [d, v] of Object.entries(r.byDay || {})) out[d] = (out[d] || 0) + v.recovered;
  return out;
}
const sumExpdf = list => ({
  ...(list.some(r => r.byDay) ? { byDay: dayTotals_(list) } : {}),     // only a week carries its days: the phone's totals stay as they were
  customers: new Set(list.map(r => K(r.ref))).size,
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
  /* "So even in call app if they clear they go down with status cleared" -- the owner, 13 Nov
     2026. This is read by the phone (the sacred /api/call path) as much as the portal, and a
     CLEARED row is kept here deliberately: an officer sees the customer sink to the bottom of
     their own list (0 arrears already sorts last, below) with a status saying why, rather than
     a customer silently missing with no way to tell a settled account from a data gap. */
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
     assigned book shows and the strip says why.

     SOME of a leader's book undated is the ordinary case, not the rare one -- one customer
     whose date a sheet never carried, the rest of the team dated as usual. Filtering to
     onToday alone then drops exactly that customer, every day, with no "why" to point at: real
     arrears, on no leader's screen, on any day, for as long as their date stays unreadable. An
     undated customer is kept on every daily reading regardless (never rotated -- there is no
     day to rotate them to), so a real defaulter is never simply absent. */
  const dated = mine.filter(r => r.primary > 0), undated = mine.filter(r => r.primary === 0);
  const noCycleDates = mine.length > 0 && dated.length === 0;
  const scopeRows = (all || noCycleDates) ? mine : mine.filter(r => r.onToday).concat(undated);
  scopeRows.sort((a, b) => b.arrears - a.arrears);
  return { rows: scopeRows, weekday: core.weekday, date: core.date,
    dayName: DAY_NAMES[core.dayIdx] || '', hasBaseline: core.hasBaseline,
    scope: useOwn ? 'mine' : 'team', canSwitch: isLeaderOfSome,
    /* Exactly where the list got to zero. An empty screen that cannot say WHY it is empty
       costs a phone call and a day; these numbers answer it on the spot -- `undated` says how
       many of today's rows carry no cycle day and are shown on every day until one is read. */
    diag: { deck: core.rows.length, assigned: assigned.length, mine: mine.length,
      dated: dated.length, onToday: mine.filter(r => r.onToday).length, undated: undated.length,
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

   Four reads for the whole report, whatever its size: the HOPE Calls roster (three columns),
   the leaders' portfolio calls of the week, the replacement numbers (only when there are
   calls to match), and the leaders' comments of the week.

   WHO IS WHO. "Hakuna afisa wa HOPE Calls aliyesajiliwa kwa jina SULEIMAN MPOKI MWASUNGA" --
   he was registered, under another spelling of the same name. Teams & Staff and the HOPE
   Calls roster are typed by different hands, so a leader is matched to their account first
   by the NUMBER Teams & Staff carries for the role (gmo_no / manager_no / bike_no), then by
   the name regardless of case (`Boss` and `BOSS` are one person), then by the name's words:
   a shorter spelling whose words all appear in the longer one (SULEIMAN MWASUNGA in SULEIMAN
   MPOKI MWASUNGA, in any order) is the same person, provided it has at least two words -- a
   lone JUMA matches nobody. The comments are then read under every spelling found. */
const nine_ = v => { const s = String(v == null ? '' : v).replace(/\D/g, ''); return s.length >= 9 ? s.slice(-9) : (s || null); };
const likeSafe_ = s => String(s).replace(/[%_\\]/g, m => '\\' + m);
// A name that would break PostgREST's or=(...) grammar is matched exactly instead.
const orSafe_ = s => !/[,()"\\]/.test(String(s));
const words_ = s => K(s).replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
export function sameName(a, b) {
  const x = words_(a), y = words_(b);
  if (!x.length || !y.length) return false;
  if (x.join(' ') === y.join(' ')) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 2 && s.every(w => l.includes(w));
}
function bad_(msg) { const e = new Error(msg); e.status = 400; throw e; }
const per_ = () => ({ calls: new Set(), dials: 0, talk: 0, lastCall: null, comments: 0, lastComment: null, lastStatus: null, lastAt: null });

export async function weekWork(db, books, weekOf, weekEnd, { perDay = false } = {}) {
  const work = {};
  for (const b of books) work[b.key] = { dayNums: new Set(), dials: 0, talk: 0, connected: new Set(), called: new Set(),
    comments: 0, commented: new Set(), per: {}, recent: [], days: {} };
  const named = books.filter(b => b.leader && b.leader !== '(unassigned)' && b.rows.length);
  for (const b of named) b.phones = new Set((b.phones ? [...b.phones] : []).concat(b.rows.map(r => nine_(r.leaderPhone))).filter(Boolean));
  const inCalls = {};
  if (!named.length) return { work: finish_(work), inCalls };

  /* 1. Whose calls. "Always match anyone who signed in with that code": a leader registers in
     HOPE Calls with their portal access code, and the account takes the CODE's name -- so the
     leader's codes are found first (by name, by the name's words), and every account carrying a
     code's name, the leader's number from Teams & Staff, or a spelling of the leader's name is
     theirs. A comment is then read under every one of those spellings, the code's included. */
  let users = [], codes = [];
  [users, codes] = await Promise.all([
    fetchAll(() => db.from('call_users').select('user_id, name, phone')).catch(() => []),
    fetchAll(() => db.from('access_codes').select('name')).catch(() => []),
  ]);
  const idBooks = {}, spellings = {}, nameBooks = {};
  const own = (b, s) => { const k = K(s); if (!k) return; b.names.add(k); (spellings[K(b.leader)] = spellings[K(b.leader)] || new Set()).add(String(s));
    if (!(nameBooks[k] || []).includes(b)) (nameBooks[k] = nameBooks[k] || []).push(b); };
  for (const b of named) { b.names = new Set(); own(b, b.leader); }
  for (const c of codes) for (const b of named) { if (K(c.name) === K(b.leader) || sameName(c.name, b.leader)) own(b, c.name); }
  for (const u of users) {
    if (!u.user_id) continue;
    const ph = nine_(u.phone), nk = K(u.name);
    for (const b of named) {
      if (!((ph && b.phones.has(ph)) || b.names.has(nk) || sameName(u.name, b.leader))) continue;
      inCalls[K(b.leader)] = true;
      (idBooks[u.user_id] = idBooks[u.user_id] || []).push(b);
      own(b, u.name);
    }
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
  const indexOf = rows => {
    const refSet = new Set(), byPhone = {};
    for (const r of rows) {
      const ref = K(r.ref); refSet.add(ref);
      for (const ph of [r.contact, r.guarantor_contact].concat(altByRef[ref] || [])) { const n = nine_(ph); if (n && !byPhone[n]) byPhone[n] = ref; }
    }
    return { refSet, byPhone };
  };
  const index = b => b._idx || (b._idx = indexOf(b.rows));
  /* PER DAY (the weekly card's day tabs). The day's book is the customers on this leader's list THAT day -- the daily report's own list --
     and a call or a comment counts on a day only for them, by the same matching, so a day tab reads what the daily card for that day reads.
     Same rows, same two reads as the week: nothing here asks the database for more. */
  const dayIndex = (b, day) => { b._didx = b._didx || {}; return b._didx[day] || (b._didx[day] = indexOf(b.rows.filter(r => r.byDay && r.byDay[day]))); };
  const dayWork = (w, day) => w.days[day] || (w.days[day] = { dayNums: new Set(), dials: 0, talk: 0, connected: new Set(), called: new Set(),
    comments: 0, commented: new Set(), per: {}, recent: [] });
  for (const c of calls) {
    for (const b of (idBooks[c.user_id] || [])) {
      const { refSet, byPhone } = index(b);
      const ref = refSet.has(K(c.ref)) ? K(c.ref) : (byPhone[nine_(c.phone)] || null);
      if (perDay) {
        const day = String(c.call_date).slice(0, 10), di = dayIndex(b, day);
        const dref = di.refSet.has(K(c.ref)) ? K(c.ref) : (di.byPhone[nine_(c.phone)] || null);
        if (dref) {
          const dw = dayWork(work[b.key], day), dk = day + '|' + nine_(c.phone), dp = dw.per[dref] || (dw.per[dref] = per_());
          dp.calls.add(dk); dp.dials++; dp.talk += num(c.duration);
          if (!dp.lastCall || String(c.call_date) > dp.lastCall) dp.lastCall = String(c.call_date);
          dw.dayNums.add(dk); dw.dials++; dw.talk += num(c.duration); dw.called.add(dref);
          if (K(c.outcome) === 'CONNECTED') dw.connected.add(dk);
        }
      }
      if (!ref) continue;
      const w = work[b.key], key = String(c.call_date) + '|' + nine_(c.phone);
      const p = w.per[ref] || (w.per[ref] = per_());
      p.calls.add(key); p.dials++; p.talk += num(c.duration);
      if (!p.lastCall || String(c.call_date) > p.lastCall) p.lastCall = String(c.call_date);
      w.dayNums.add(key); w.dials++; w.talk += num(c.duration); w.called.add(ref);
      if (K(c.outcome) === 'CONNECTED') w.connected.add(key);
    }
  }

  // 4. Their comments of the week, under any spelling the teams table, their access codes or the roster carry.
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
    for (const b of (nameBooks[K(c.created_by)] || [])) {
      const { refSet } = index(b); const ref = K(c.ref);
      if (perDay) {
        const day = todayKey(Date.parse(c.created_at));        // the EAT day it was written, the clock the daily report keeps
        if (dayIndex(b, day).refSet.has(ref)) {
          const dw = dayWork(work[b.key], day), dp = dw.per[ref] || (dw.per[ref] = per_());
          dp.comments++;
          if (!dp.lastAt || String(c.created_at) > dp.lastAt) { dp.lastAt = String(c.created_at); dp.lastComment = c.comment || null; dp.lastStatus = c.fu_status || null; }
          dw.comments++; dw.commented.add(ref);
          dw.recent.push({ ref: c.ref, full_name: c.full_name || null, comment: c.comment || '', fu_status: c.fu_status || null,
            promise_date: c.promise_date || null, promise_amt: c.promise_amt == null ? null : num(c.promise_amt), created_at: c.created_at });
        }
      }
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
    const days = {};
    for (const [d, x] of Object.entries(w.days)) {
      x.recent.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      days[d] = { calls: x.dayNums.size, dials: x.dials, talk: x.talk, connected: x.connected.size, reached: x.called.size,
        comments: x.comments, commented: x.commented.size, per: x.per, recent: x.recent };
    }
    out[k] = { calls: w.dayNums.size, dials: w.dials, talk: w.talk, connected: w.connected.size, reached: w.called.size,
      comments: w.comments, commented: w.commented.size, per: w.per, recent: w.recent, days };
  }
  return out;
}
const bookWeek_ = (nowMs, weekOf, weekEnd) => {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(weekOf || '')) ? String(weekOf) : weekMondayKey(nowMs);
  return { weekOf: from, weekEnd: /^\d{4}-\d{2}-\d{2}$/.test(String(weekEnd || '')) ? String(weekEnd) : addDaysKey(from, 6) };
};

/** The management view: every GMO / MANAGER / BIKE with their own book and their own recovery,
    daily or for the week -- each with the OPM of the teams they hold, and the week's calls,
    talk time and comments beside the customers they hold. This is what says which category,
    and which person, is actually working the rotation and which is not. */
export async function expdfReport(db, user, { weekly = false, monthly = false, day = null, weekOf = null, weekEnd = null } = {}, nowMs) {
  const win = bookWeek_(nowMs, weekOf, weekEnd);
  const core = weekly ? await expdfWeekCore(db, user, nowMs, { from: win.weekOf, to: win.weekEnd }) : await expdfCore(db, user, nowMs, { weekly, monthly });
  const all = periodRows_(core, { daily: !weekly && !monthly, day });
  const books = [];
  const built = RECYCLE_ROLES.map(role => {
    const mine = all.filter(r => r.role === role);
    const by = {};
    for (const r of mine) {
      const b = bucket(by, r.leader, { customers: 0, arrears: 0, initial: 0, recovered: 0, teams: {}, opms: {}, rows: [] });
      b.customers++; b.arrears += r.arrears; b.initial += r.initial; b.recovered += r.recovered; b.rows.push(r);
      if (r.team) b.teams[K(r.team)] = r.team;
      // "Add an OPM column on the three role boards too": the OPM(s) of the teams this leader holds.
      if (r.opm && r.opm !== '(unassigned)') b.opms[K(r.opm)] = r.opm;
    }
    for (const b of Object.values(by)) books.push({ key: role + '|' + K(b.key), leader: b.key, rows: b.rows });
    return { role, by, mine };
  });
  const { work, inCalls } = await weekWork(db, books, win.weekOf, win.weekEnd);
  const sections = built.map(({ role, by, mine }) => {
    const rows = Object.values(by).map(b => { const w = work[role + '|' + K(b.key)] || {}; return { leader: b.key,
      opm: Object.values(b.opms).sort().join(', ') || '(unassigned)',
      teams: Object.keys(b.teams).length, customers: b.customers,
      calls: w.calls || 0, dials: w.dials || 0, talk: w.talk || 0, comments: w.comments || 0,
      inCalls: !!inCalls[K(b.key)],
      arrears: b.arrears, initial: b.initial, recovered: b.recovered, ...(b.rows.some(r => r.byDay) ? { byDay: dayTotals_(b.rows) } : {}),
      pct: pctOf(b.recovered, b.initial) }; }).sort((a, b) => b.recovered - a.recovered);
    const sum = f => rows.reduce((s, r) => s + r[f], 0);
    return { role, rows, totals: { ...sumExpdf(mine), calls: sum('calls'), dials: sum('dials'), talk: sum('talk'), comments: sum('comments') },
      unassigned: rows.filter(r => r.leader === '(unassigned)').length };
  });
  return { weekly, monthly, period: core.baseline, weekday: core.weekday, date: core.date, baseDate: core.baseDate, weekOf: win.weekOf,
    dayName: DAY_NAMES[core.dayIdx] || '', hasBaseline: core.hasBaseline,
    days: core.days || null,                                   // a week: which days were added, and which were not filed
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
   rotation's rows for that role and that name, read as the report reads them for the same
   period (day, week or month), and the period's work by the one definition above. Read on
   the tap only, never with the report. */
export async function expdfLeader(db, user, { role, leader, weekOf, weekEnd, period = 'day', day = null } = {}, nowMs) {
  const R = K(role), L = String(leader == null ? '' : leader).trim();
  if (!RECYCLE_ROLES.includes(R)) bad_('Chagua GMO, MANAGER au BIKE. / Pick GMO, MANAGER or BIKE.');
  if (!L || L === '(unassigned)') bad_('Chagua kiongozi aliyetajwa. / Pick a named leader.');
  const weekly = period === 'week', monthly = period === 'month';
  const win = bookWeek_(nowMs, weekOf, weekEnd);
  const core = weekly ? await expdfWeekCore(db, user, nowMs, { from: win.weekOf, to: win.weekEnd }) : await expdfCore(db, user, nowMs, { weekly, monthly });
  const rows = periodRows_(core, { daily: !weekly && !monthly, day }).filter(r => r.role === R && K(r.leader) === K(L));
  const { work, inCalls } = await weekWork(db, [{ key: 'one', leader: L, rows }], win.weekOf, win.weekEnd, { perDay: weekly });
  const w = work.one;
  const out = rows.map(r => { const p = w.per[K(r.ref)] || per_(); return {
    ref: r.ref, full_name: r.full_name, contact: r.contact, team: r.team, cycle: r.cycle, status: r.status,
    initial: r.initial, arrears: r.arrears, recovered: r.recovered,
    byDay: Object.fromEntries(Object.entries(r.byDay || {}).map(([d, v]) => [d, v.recovered])),
    calls: p.calls.size, dials: p.dials, talk: p.talk, lastCall: p.lastCall,
    comments: p.comments, lastComment: p.lastComment, lastStatus: p.lastStatus }; })
    .sort((a, b) => (b.recovered - a.recovered) || (b.calls - a.calls) || (b.arrears - a.arrears));
  const t = sumExpdf(rows);
  /* THE DAY TABS (a week only): "after opening officer card have day tabs within, as the expected days tabs" -- what this leader's list was
     on each day of the week and what came of it, so an officer can refer to any day. Each tab is the daily card for that day: the day's own
     initial deck against the day's own current one for the customers whose cycle day it was, and the calls and comments of that day on them.
     Built from the rows and the two reads the week already made. A day nobody filed has its tab and no rows. */
  const dayTabs = weekly ? (core.days || []).map(x => {
    if (!x.measured) return { date: x.date, weekday: x.weekday, measured: false, why: x.why || null, rows: [], totals: null, recent: [] };
    const dw = (w.days || {})[x.date] || {}, per = dw.per || {};
    const list = rows.filter(r => r.byDay && r.byDay[x.date]).map(r => { const v = r.byDay[x.date], p = per[K(r.ref)] || per_(); return {
      ref: r.ref, full_name: r.full_name, contact: r.contact, team: r.team, cycle: r.cycle, status: v.status || r.status,
      initial: v.initial, arrears: v.arrears, recovered: v.recovered,
      calls: p.calls.size, dials: p.dials, talk: p.talk, lastCall: p.lastCall,
      comments: p.comments, lastComment: p.lastComment, lastStatus: p.lastStatus }; })
      .sort((a, b) => (b.recovered - a.recovered) || (b.calls - a.calls) || (b.arrears - a.arrears));
    const sum = f => list.reduce((s, r) => s + r[f], 0);
    return { date: x.date, weekday: x.weekday, measured: true, rows: list,
      totals: { customers: list.length, initial: sum('initial'), arrears: sum('arrears'), recovered: sum('recovered'), pct: pctOf(sum('recovered'), sum('initial')),
        recoveredCustomers: list.filter(r => r.recovered > 0).length,
        calls: dw.calls || 0, dials: dw.dials || 0, talk: dw.talk || 0, connected: dw.connected || 0, reached: dw.reached || 0,
        comments: dw.comments || 0, commented: dw.commented || 0 },
      recent: (dw.recent || []).slice(0, 10) };
  }) : null;
  return { role: R, leader: L, period: core.baseline, weekOf: win.weekOf, weekEnd: win.weekEnd, inCalls: !!inCalls[K(L)], hasBaseline: core.hasBaseline,
    days: core.days || null, ...(dayTabs ? { dayTabs } : {}),
    totals: { ...t, recoveredCustomers: rows.filter(r => r.recovered > 0).length,
      calls: w.calls, dials: w.dials, talk: w.talk, connected: w.connected,
      reached: w.reached, comments: w.comments, commented: w.commented },
    rows: out, recent: w.recent.slice(0, 10) };
}
