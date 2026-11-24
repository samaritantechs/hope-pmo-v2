import { fetchAll } from './supabase.js';
import { teamAllowed } from './auth.js';
import { todayKey, currentWeekday, weekMondayKey, isoWeekday, addDaysKey, weekdayOfKey } from './time.js';
import { latestSnapshot, latestSnapshotDate } from './snapshots.js';
import { num } from './recovery.js';
import { cachedAnswer } from './answer-cache.js';
import { isSettled } from './settled.js';

/* Shared by BOTH the portal and the calls app, so it lives in its own module: portal-core
   already imports call-core, and having call-core import portal-core back closed a cycle
   that broke every test on both sides. */
const K = s => String(s == null ? '' : s).trim().toUpperCase();
const scoped = (user, rows) => rows.filter(r => teamAllowed(user, r.team));
const pctOf = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
function bucket(map, key, init) { if (!map[key]) map[key] = Object.assign({ key }, init); return map[key]; }
const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

import { assignFor, assignStrategy, ROLE_COLS } from './assign.js';
import { leaderKey as LK, teamsOutsideScope, codeGapOf } from './leader-scope.js';

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

   A CUSTOMER WITH NO ROW ON THE DAY'S CURRENT DECK AT ALL -- "how comes tou said 'should
   disappear.' yet we are fighting allover to say cleared people shouldnt dissapear for
   verifications", the owner, 16 Nov 2026 (and 13 Nov: "they should stay there as of recovery
   so as to know recovery amount from difference of initial to current per each day by team or
   staff"; 15 Nov: "i expect that customer in initial never to get lost even if cleared its
   amounts and statuses that change"). This used to be the one case a row could not be built
   for, on the belief that the rotation's own role/phase needs fields (days_elapsed,
   chronic_date, expire_date) that exist only on a current-deck row. THEY DO NOT (handbook Part
   82 found it on the Expected Defaulters tab): the initial file is imported by the same importer
   as the current one, so the customer's own row on the DAY'S INITIAL DECK carries the status,
   the days elapsed, the dates, the name and the number the rotation and the caller read.

   So `morning` -- the day's own initial rows, handed in ONLY when the day's two decks are a
   whole pair (the same date; expdfCore and the week's loop decide that, below) -- gives every
   customer on that deck a row: one still on the current deck reads as before; one the current
   deck no longer names (paid up and gone from the file, or never on a current file at all) is
   built from their morning row by the same function, CLEARED, nothing owed, the WHOLE of the
   morning's arrears recovered -- "a team missing from it owes nothing on it, full stop"
   (defaulterBook; db/RUN-ME-032) and the dashboard card's own reading of the same customer
   (RUN-ME-058). Where the rotation places them is where it places them off the morning row,
   so the leader the day's list credits is the leader who held them. No read is added here:
   the baseline rows are the deck both callers already read.

   AND THE LIST IS THE MORNING DECK'S, NOT THE EVENING'S -- "Should the report and the phone also
   leave out customers who fall into default after the morning file, so the dashboard card, the
   report and the phone all count the same people?" -- "YES", the owner, 16 Nov 2026 (handbook
   Part 88). On a DAY (`only`), a customer on the later file whom the morning deck never named
   entered default AFTER it was filed: they are nobody's expected defaulter of THIS day -- they
   join tomorrow's list, on tomorrow's initial deck -- exactly as the dashboard card has read
   them since Part 74 ("the lists per day must come from initial files"). They are counted in
   `left` (customers and arrears) so a screen can say how many were left out, and are not rows.

   NOBODY FROM OUTSIDE THE PERIOD'S OWN FILES IS A ROW -- "How comes staff are seeing expected
   defaultes with cleared like 62561111341 who are not even in the initial file of today" ...
   "not just dropping but analyzing how that robust problem happens", the owner, 23 Nov 2026
   (handbook Part 136). From 13 Nov to 23 Nov an "all-time ghost" (Part 71) added, to every list,
   every customer a team had EVER had on a file whom the latest file did not name: CLEARED, with
   the last arrears anybody knew still shown as owed and nothing recovered, on their two cycle
   days, for ever, and counted in every total. It read "should reflect to alltime data past
   present and future" (13 Nov) as "a customer who left is on today's list for all time"; the
   owner's own rule, said three more times since, is the one above -- a customer of a day's
   initial file stays on THAT day's list -- and it holds for every day, past, present and future,
   because every day is read off its own two files. The ghost is gone: this function is handed
   only files of the period it is building, and that is all it reads.

   THE ARGUMENTS:
     book     the rows of the freshest file of the period: where things stand
     baseBy   ref -> arrears on the period's baseline file ({} when there is none)
     closing  the baseline file's rows, when `book` is a LATER file than it, so that a customer on
              the baseline whom the book does not name has cleared; null when nothing has been
              compared (the book IS the baseline file, or there is no baseline)
     only     a DAY's list: the baseline file's customers and nobody else (Part 88)
   Returns { rows, left }. */
function buildRows_(user, book, baseBy, teamBy, strat, ms, closing, only) {
  const dayIdx = isoWeekday(ms);
  const onBase = closing && closing.length ? new Set(closing.map(d => K(d.ref))) : null;
  const make = (d, over) => {
      const raw = d.disb_date ? isoWeekday(Date.parse(String(d.disb_date) + 'T00:00:00Z')) : 0;
      const primary = raw;
      const secondary = primary ? ((primary - 1 + 3) % 7) + 1 : 0;
      const a = assignFor(d, strat, ms);
      const team = teamBy[K(d.team)] || {};
      const arrears = num(d.arrears);
      // A customer the baseline file does not hold has no baseline: initial reads as their arrears now and recovered as 0 --
      // a figure that is not known is never invented.
      const initial = Object.prototype.hasOwnProperty.call(baseBy, K(d.ref)) ? baseBy[K(d.ref)] : arrears;
      const s = K(d.status);
      /* CLEARED is not "the status text didn't say Chronic/Expired/Defaulter" -- a blank or
         unrecognised status is NOT evidence of payment (settled.js's own rule, written after a
         real customer sat on an officer's phone as a defaulter owing one shilling while the
         expected book had her overpaid: a stale or missing status is unknown, never "paid").
         isSettled(arrears) is the one gate for a row that is on the book. Anything else keeps
         its own status text (or DEFAULTER if it has none), the same fallback statusWithPaid uses
         elsewhere, so it stays visible as still needing a call rather than being told it is
         clear when the arrears column says otherwise. */
      const status = s.includes('CHRON') ? 'CHRONIC' : (s.includes('EXPIR') ? 'EXPIRED' : (s.includes('DEFAULT') ? 'DEFAULTER'
        : (isSettled(arrears) ? 'CLEARED' : (d.status || 'DEFAULTER'))));
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
        opm: (team[ROLE_COLS.OPM] || '(unassigned)'), ...(over || {}) };
  };
  const seenRows = scoped(user, book);
  const left = { customers: 0, arrears: 0 };      // in default on the later file, never named by the day's morning file: entered default after it
  const rows = seenRows
    .filter(d => {
      const s = K(d.status), inDefault = s.includes('CHRON') || s.includes('EXPIR') || s.includes('DEFAULT');
      if (only && onBase) {
        if (onBase.has(K(d.ref))) return true;
        if (inDefault) { left.customers += 1; left.arrears += num(d.arrears); }
        return false;
      }
      return inDefault || Object.prototype.hasOwnProperty.call(baseBy, K(d.ref));
    })
    .map(d => make(d));
  if (onBase) {
    const live = new Set(seenRows.map(d => K(d.ref)));   // on the later file
    const seen = new Set();
    for (const r of scoped(user, closing)) {
      const ref = K(r.ref);
      if (live.has(ref) || seen.has(ref)) continue;
      seen.add(ref);
      const initial = Object.prototype.hasOwnProperty.call(baseBy, ref) ? baseBy[ref] : num(r.arrears);
      // The rotation reads the BASELINE row (make's own assignFor, before `over`): where it places the customer is where it placed them.
      rows.push(make(r, { arrears: 0, initial, recovered: initial, status: 'CLEARED' }));
    }
  }
  return { rows, left };
}

/* THE DAY'S LIST IS THE DAY'S OWN MORNING FILE, FOUND BY ITS DATE (handbook Part 136).

     "How comes staff are seeing expected defaultes with cleared like 62561111341 who are not even in
      the initial file of today 23rd nov 2026" ... "i gave that sample customer of expected defaulter
      so as to solve a big problem that people are complaining" ... "not just dropping but analyzing
      how that robust problem happens" -- the owner, 23 Nov 2026.

   HOW IT HAPPENED. This function used to ask for "the latest CURRENT deck filed under today's
   weekday" and "the latest INITIAL deck filed under today's weekday", and built the list from the
   current one. Decks were once thought of as per-weekday files; every file has long been the
   whole book ("one file, all weekdays together, every time"), so the only thing the weekday did
   was this: UNTIL TODAY'S OWN CURRENT FILE WAS UPLOADED, THE LIST WAS BUILT FROM THE SAME WEEKDAY'S
   FILE OF LAST WEEK. Replayed on the owner's own sample (ref 62561111341: on the files of 15 to
   18 Nov, on the initial file of 19 Nov, on none since) for Sunday 22 Nov:
     - before the day's later file was in, the phone listed that customer as a DEFAULTER owing
       18,000 (last Sunday's figure) and another who had cleared on Tuesday as owing 25,000;
     - a customer who entered default on Thursday was listed CLEARED (the all-time ghost took a
       customer last Sunday's file did not name for one who had left), and one who was new on that
       morning's file was not listed at all;
     - once both files were in, the two who had cleared days before were still there, CLEARED,
       "owing" 4,000 and 25,000 with nothing recovered, and the day's Rec % read 25.3 where the
       customers actually on the morning file made it 37.9.
   Parts 69 to 88 each put one case right for the hour when both of the day's files are in. The
   root was never touched: the list was not built from the day's own initial file.

   NOW, BY DATE, AND ONLY OFF THE DAY'S OWN FILES:
     both files of the day   the list is the MORNING file's customers; what each owes is the later
     ('pair')                file's figure, and one the later file does not name has CLEARED with
                             the whole morning's arrears recovered (Parts 87, 88).
     the morning file only   the list is the morning file's customers, each owing the morning's
     ('morning')             own arrears and nothing recovered yet: nothing has been compared.
     a later file only       the day's later file with no morning file: its defaulters, nothing
     ('current')             recovered (no baseline), as it always read.
     neither yet             the freshest file of any earlier day stands in -- "only latest
     ('earlier')             [current defaulter] file is legit for defaulters list no matter which
                             day it is" -- its defaulters, nothing recovered; `date` says which
                             day's file it is (the phone's strip then shows that date, not "Leo",
                             and says the initial list is not in). Never last week's.
   Nobody from outside those files is a row (buildRows_). A week (expdfWeekCompute_) was already
   built this way, one day at a time; a MONTH keeps its first deck as the baseline and now reads
   the same freshest file as where things stand, a customer on the month's first deck whom that
   file does not name having cleared in the month.

   COST (CLAUDE.md section 1; the phone's list is this function). Two one-row reads say which
   files the day has, then only the files needed are read: both of the day's (pair), one
   (morning, current, earlier). The all-time lookup (db.rpc('defaulter_ghost_rows'), up to 800 ms
   of budget on the phone and the statement that timed out most in the Postgres logs) is no longer
   asked. Counted against the old code on the same book (test/speed.test.mjs, test/call.test.mjs):
   one round trip fewer with both files in, two fewer with one. No read is added on any path. */
const T_ = 'defaulter_snapshots';
/** One file, by its date. The weekday is the date's own (the upload derives it the same way), which keeps the statement, and
    the index it rides, exactly what this function has always sent. */
const deckOn_ = (db, user, type, date, columns) => (date
  ? latestSnapshot(db, T_, { snapshot_type: type, weekday: weekdayOfKey(date) }, { onDate: date, teams: user.teams, ...(columns ? { columns } : {}) })
  : Promise.resolve(NONE_));
export async function expdfCore(db, user, nowMs, { weekly = false, monthly = false } = {}) {
  const today = todayKey(nowMs), wd = currentWeekday(nowMs), mon = weekMondayKey(nowMs);
  // Which files are there: the newest initial and the newest current, on or before the day read.
  const [iniDate, curDate, teamRows, strat] = await Promise.all([
    latestSnapshotDate(db, T_, { snapshot_type: 'initial' }, { notAfter: today }),
    latestSnapshotDate(db, T_, { snapshot_type: 'current' }, { notAfter: today }),
    fetchAll(() => db.from('teams').select('*')),
    assignStrategy(db),
  ]);
  const hasIni = iniDate === today, hasCur = curDate === today;
  /* The file that says where things stand when the day has no file of its own yet: the freshest of any earlier day. A
     current file of a date is later than that date's initial one, so a tie goes to the current. */
  const earlier = (!hasIni && !hasCur) ? ((curDate && (!iniDate || curDate >= iniDate)) ? { type: 'current', date: curDate } : (iniDate ? { type: 'initial', date: iniDate } : null)) : null;
  // Only the baseline the period needs is read: Monday's deck for a week, the month's first deck for a month, nothing extra for a day.
  const [dayIni, dayCur, older, monIni, monthIni] = await Promise.all([
    hasIni ? deckOn_(db, user, 'initial', today) : NONE_,
    hasCur ? deckOn_(db, user, 'current', today) : NONE_,
    earlier ? deckOn_(db, user, earlier.type, earlier.date) : NONE_,
    weekly ? latestSnapshot(db, T_, { snapshot_type: 'initial', weekday: 'MON' }, { onDate: mon, teams: user.teams }) : NONE_,
    monthly ? monthFirstInitial_(db, user, today.slice(0, 7) + '-01', today) : NONE_,
  ]);
  const teamBy = {};
  for (const t of teamRows) teamBy[K(t.team)] = t;
  const paired = dayIni.rows.length > 0 && dayCur.rows.length > 0;
  const stage = dayStage(dayIni.rows.length > 0, dayCur.rows.length > 0, older.rows.length > 0);
  // WHERE THINGS STAND: the day's later file, else the day's morning file, else the freshest file of an earlier day.
  const book = dayCur.rows.length ? dayCur : dayIni.rows.length ? dayIni : older;
  // A month compares against its first deck, a week against Monday's, a day against the same
  // day's own initial. Where the chosen baseline is missing the customer just shows 0 recovered
  // rather than a fabricated number computed off whatever deck happened to be lying around.
  const period = monthly ? monthIni : weekly ? monIni : null;
  const base = period ? (period.rows.length ? period : dayIni) : dayIni;
  const baseBy = {};
  for (const d of base.rows) baseBy[K(d.ref)] = num(d.arrears);
  const dayIdx = isoWeekday(nowMs);
  /* WHO HAS CLEARED IS READ ONLY OFF A COMPARISON THAT WAS MADE: the baseline file against a LATER file. The day's morning
     file against the day's later one (the pair); a month's (or the legacy week's) first deck against any file after it.
     When the book IS the baseline file (the morning, before the later file; the first of a month) nothing has been
     compared, and nobody is marked paid. */
  const later = base.rows.length > 0 && book.rows.length > 0 && book !== base
    && (String(book.date) > String(base.date) || (String(book.date) === String(base.date) && book === dayCur));
  const day = !period;
  const built = buildRows_(user, book.rows, baseBy, teamBy, strat, nowMs, later ? base.rows : null, day && paired);
  return { rows: built.rows, dayIdx, weekday: wd, date: book.date, paired, stage,
    // How many customers the day's later file has in default that its morning file never named (Part 88): left out of the day, and said so. Null with no pair: nothing was left out.
    enteredAfter: day && paired ? built.left : null, hasBaseline: base.rows.length > 0, baseDate: base.date,
    baseline: monthly ? 'month' : (weekly ? 'week' : 'day'),
    // The teams sheet, as already read above: expdfMine names the teams that give its caller a book their own code cannot see.
    teams: teamRows };
}

/** WHICH OF THE DAY'S OWN TWO FILES ARE IN, NAMED ONCE (handbook Parts 136 and 140).
    'pair'     both: the morning file's customers, read against the later file.
    'morning'  the morning file only: its customers owe the morning's arrears and NOTHING HAS BEEN COMPARED, so nothing
               is recovered and nobody reads CLEARED. The owner's RUN-ME-087 answer (24 Nov 2026) showed the later file
               comes in at about 20:00, so this is how a day reads through the whole working day: every screen that
               shows the day must SAY the later file is not in, or its noughts read as "nobody recovered anything"
               (CLAUDE.md section 2: silence reads as success).
    'current'  a later file only (no morning file that day).
    'earlier'  neither yet: the freshest file of an earlier day stands in.
    'none'     no file at all.
    expdfCore names the day with it for the phone, the report and the leader's card; expectedDefaulters (portal-core.js)
    for the tab. The pages draw their line on 'morning' and on nothing else. */
export function dayStage(hasInitial, hasCurrent, hasEarlier) {
  return hasInitial && hasCurrent ? 'pair' : hasInitial ? 'morning' : hasCurrent ? 'current' : hasEarlier ? 'earlier' : 'none';
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
/* The day's initial deck is read for what a customer who left the current deck needs to stand as a row of the day
   (Part 87): the name and number, and the status, days elapsed and dates the rotation places them by. The same
   rows as before, ten columns of each instead of four -- no read is added. */
const INI_COLS_ = ['ref', 'full_name', 'contact', 'team', 'arrears', 'disb_date', 'status', 'days_elapsed', 'chronic_date', 'expire_date'];
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
  /* A CUSTOMER THE DAY'S CURRENT DECK NO LONGER NAMES STAYS ON THAT DAY'S LIST (handbook Part
     87, which closes Part 78). "i expect that customer in initial never to get lost even if
     cleared its amounts and statuses that change," 14 Nov 2026, after Thursday 12 Nov's own
     initial deck was shown (by direct SQL) to carry ref 4231948032 (15,500, Chronic) with no
     matching row on Thursday's own current deck; and, 16 Nov, "how comes tou said 'should
     disappear.' yet we are fighting allover to say cleared people shouldnt dissapear for
     verifications".

     Part 78 kept such a day-ghost VISIBLE on a board of its own ("Cleared, no leader on record
     for the day", `unassignedCleared`) and OUT of every leader's book and every total, because
     it believed the rotation's own role needs fields only a CURRENT-type row has. It does not
     (see buildRows_): the customer's row on that same day's initial deck, already read below for
     the baseline, carries them. So each day hands buildRows_ the day's own initial rows
     (`morning`), and a customer the day's current deck does not name stands as a row of the day
     like any other -- CLEARED, nothing owed, the morning's arrears recovered -- on the cycle
     days the rotation names for them, credited to the leader it names, counted in the totals.
     The old board is therefore empty by construction (still answered, as `[]`, so a page that
     asks for it finds nothing rather than an error).

     This reads ONLY that one day's own two files -- nothing about today, nothing about any other
     day -- and it costs no new read (ini.rows and cur.rows for day d are the two decks already
     fetched). The all-time ghost that used to be added to the LIVE day of the live week (Part 71)
     is gone with the rest of it (Part 136): a customer who left the files before a day began is
     not on that day's list, today's included. */
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
    // ini.rows IS the day's own initial deck and cur.rows the day's own current one (both read onDate d, both here): a whole pair.
    const built = buildRows_(user, cur.rows, baseBy, teamBy, strat, at, ini.rows, true).rows;
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
    hasBaseline: measured.length > 0, baseDate: first ? first.date : null, baseline: 'week', days,
    unassignedCleared: [] };       // Part 78's board: empty by construction since Part 87 (see the comment above the loop)
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
  // The sacred /api/call path: the day's own files and nothing else (expdfCore). The all-time lookup this used to wait on,
  // under a budget, is no longer asked (Part 136).
  const core = await expdfCore(db, user, nowMs, { weekly });
  /* The person's own name is compared the way every register of names is (leaderKey: runs of
     blanks as one), so 'MARY  M' on a team and 'MARY M' on a code are one leader. */
  const me = LK(user.name);
  /* "So even in call app if they clear they go down with status cleared" -- the owner, 13 Nov
     2026. This is read by the phone (the sacred /api/call path) as much as the portal, and a
     CLEARED row is kept here deliberately: an officer sees the customer sink to the bottom of
     their own list (0 arrears already sorts last, below) with a status saying why, rather than
     a customer silently missing with no way to tell a settled account from a data gap. */
  const assigned = core.rows.filter(r => RECYCLE_ROLES.includes(r.role));
  const own = assigned.filter(r => LK(r.leader) === me);
  /* THE TEAMS THAT GIVE THIS PERSON A BOOK THEIR OWN CODE CANNOT SEE -- "that manager in their
     code ain't seeing them, they getting just a little like two yet a Manager's gmo sees the
     manager has many". The teams sheet names them as GMO / MANAGER / BIKE on teams their access
     code does not hold, so the rotation hands them customers there (and the report counts
     them) that this list will never show: the code decides what is seen, never the sheet
     (call-core.js scopeFor). The rule is not changed; the screen says so (leader-scope.js).
     Over the teams sheet expdfCore has already read: no read, an empty list for anybody whose
     code holds every team they lead -- and for a team-code handset, which scopeFor widens. */
  const outside = teamsOutsideScope(user, core.teams);
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
  /* CLEARED sinks below every still-owing row first, arrears descending within each group: a customer who has cleared is
     kept for verification ("So even in call app if they clear they go down with status cleared"), under the ones still to call. */
  scopeRows.sort((a, b) => (a.status === 'CLEARED') - (b.status === 'CLEARED') || b.arrears - a.arrears);
  return { rows: scopeRows, weekday: core.weekday, date: core.date,
    dayName: DAY_NAMES[core.dayIdx] || '', hasBaseline: core.hasBaseline,
    scope: useOwn ? 'mine' : 'team', canSwitch: isLeaderOfSome,
    outside,
    /* Exactly where the list got to zero. An empty screen that cannot say WHY it is empty
       costs a phone call and a day; these numbers answer it on the spot -- `undated` says how
       many of today's rows carry no cycle day and are shown on every day until one is read. */
    diag: { deck: core.rows.length, assigned: assigned.length, mine: mine.length,
      dated: dated.length, onToday: mine.filter(r => r.onToday).length, undated: undated.length,
      deckWeekday: core.weekday, deckDate: core.date, noCycleDates,
      // Whether the day's initial and current decks are the same date: only then does a customer the current deck no longer names read as recovered (Part 87).
      paired: !!core.paired, enteredAfter: core.enteredAfter || null,
      // Which of the day's two files are in (dayStage): on 'morning' the page says the later file is not in yet (Part 140).
      stage: core.stage || null },
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
  // Which access code, where exactly ONE carries the leader's name, and the teams it holds
  // (null: every team) -- read off the codes this step already fetches, for the report's off-code mark.
  const codeOf = {};
  if (!named.length) return { work: finish_(work), inCalls, codeOf };

  /* 1. Whose calls. "Always match anyone who signed in with that code": a leader registers in
     HOPE Calls with their portal access code, and the account takes the CODE's name -- so the
     leader's codes are found first (by name, by the name's words), and every account carrying a
     code's name, the leader's number from Teams & Staff, or a spelling of the leader's name is
     theirs. A comment is then read under every one of those spellings, the code's included. */
  let users = [], codes = [];
  [users, codes] = await Promise.all([
    fetchAll(() => db.from('call_users').select('user_id, name, phone')).catch(() => []),
    // `teams` rides along: the same read, one more column (codeOf, below).
    fetchAll(() => db.from('access_codes').select('name, teams')).catch(() => []),
  ]);
  for (const b of named) {
    const hits = codes.filter(c => LK(c.name) === LK(b.leader));
    if (hits.length === 1) codeOf[K(b.leader)] = Array.isArray(hits[0].teams) ? hits[0].teams : null;
  }
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
  return { work: finish_(work), inCalls, codeOf };
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
      /* ONE PERSON IS ONE ROW. The row is keyed by the name as every register compares one
         (leaderKey: capitals, runs of blanks as one) and shown as the first spelling met, so
         'MARY  M' on two teams and 'MARY M' on four are one leader with six teams, as the card
         behind the name (expdfLeader) and the leader's own list already read them -- the report
         used to key on the raw cell and show the same person as two rows that looked alike. */
      const b = bucket(by, LK(r.leader), { leader: r.leader, customers: 0, arrears: 0, initial: 0, recovered: 0, teams: {}, opms: {}, rows: [] });
      b.customers++; b.arrears += r.arrears; b.initial += r.initial; b.recovered += r.recovered; b.rows.push(r);
      if (r.team) b.teams[K(r.team)] = r.team;
      // "Add an OPM column on the three role boards too": the OPM(s) of the teams this leader holds.
      if (r.opm && r.opm !== '(unassigned)') b.opms[K(r.opm)] = r.opm;
    }
    for (const b of Object.values(by)) books.push({ key: role + '|' + LK(b.leader), leader: b.leader, rows: b.rows });
    return { role, by, mine };
  });
  const { work, inCalls, codeOf } = await weekWork(db, books, win.weekOf, win.weekEnd);
  const sections = built.map(({ role, by, mine }) => {
    const rows = Object.values(by).map(b => { const w = work[role + '|' + LK(b.leader)] || {};
      /* "that manager in their code ain't seeing them": the teams of this leader's book that their
         OWN access code does not hold -- the customers credited to them here that their own screen
         cannot show. Said only where exactly one code carries their name (weekWork's codeOf). */
      const offCode = codeGapOf(codeOf && codeOf[K(b.leader)], Object.values(b.teams));
      return { leader: b.leader,
      opm: Object.values(b.opms).sort().join(', ') || '(unassigned)',
      teams: Object.keys(b.teams).length, customers: b.customers,
      calls: w.calls || 0, dials: w.dials || 0, talk: w.talk || 0, comments: w.comments || 0,
      inCalls: !!inCalls[K(b.leader)],
      arrears: b.arrears, initial: b.initial, recovered: b.recovered, ...(b.rows.some(r => r.byDay) ? { byDay: dayTotals_(b.rows) } : {}),
      ...(offCode.length ? { offCode } : {}),
      pct: pctOf(b.recovered, b.initial) }; }).sort((a, b) => b.recovered - a.recovered);
    const sum = f => rows.reduce((s, r) => s + r[f], 0);
    return { role, rows, totals: { ...sumExpdf(mine), calls: sum('calls'), dials: sum('dials'), talk: sum('talk'), comments: sum('comments') },
      unassigned: rows.filter(r => r.leader === '(unassigned)').length,
      offCode: rows.filter(r => r.offCode).length };
  });
  // Part 78's board, "Cleared, no leader on record for the day": a customer on some day's own initial deck and
  // not on that same day's current one used to stand here, outside every book and every total, for want of a role.
  // Since Part 87 the morning's own row gives them one, so they stand in their leader's book and the totals above
  // and this is always empty (answered as null, which the page does not draw). Kept so an older page finds nothing, not an error.
  const unassignedCleared = core.unassignedCleared || [];
  return { weekly, monthly, period: core.baseline, weekday: core.weekday, date: core.date, baseDate: core.baseDate, weekOf: win.weekOf,
    ...(core.paired === undefined ? {} : { paired: core.paired, enteredAfter: core.enteredAfter }),
    ...(core.baseline === 'day' && core.stage ? { stage: core.stage } : {}),          // a day reading only: on 'morning' the page says the day's later file is not in yet (Part 140)     // a day reading: were the day's two decks the same date (Part 87), and how many customers entered default after the morning deck and so are not on the day (Part 88)
    dayName: DAY_NAMES[core.dayIdx] || '', hasBaseline: core.hasBaseline,
    days: core.days || null,                                   // a week: which days were added, and which were not filed
    sections, totals: sumExpdf(all),
    unassignedCleared: unassignedCleared.length ? { customers: unassignedCleared.length,
      initial: unassignedCleared.reduce((s, r) => s + r.initial, 0),
      recovered: unassignedCleared.reduce((s, r) => s + r.recovered, 0),
      rows: unassignedCleared } : null };
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
  const rows = periodRows_(core, { daily: !weekly && !monthly, day }).filter(r => r.role === R && LK(r.leader) === LK(L));
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
    ...(core.baseline === 'day' && core.stage ? { stage: core.stage } : {}),          // a day reading only (Part 140)
    days: core.days || null, ...(dayTabs ? { dayTabs } : {}),
    totals: { ...t, recoveredCustomers: rows.filter(r => r.recovered > 0).length,
      calls: w.calls, dials: w.dials, talk: w.talk, connected: w.connected,
      reached: w.reached, comments: w.comments, commented: w.commented },
    rows: out, recent: w.recent.slice(0, 10) };
}
