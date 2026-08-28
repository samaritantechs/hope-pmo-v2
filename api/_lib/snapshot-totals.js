/** TEAM-DAY TOTALS -- the sums, worked out by the database instead of in this process.
 *
 *  THE PROBLEM THIS SOLVES. The Dashboard, the Weekly report and the Presentation are pure
 *  arithmetic: money and headcounts grouped by team and by day. Not one customer's name, phone
 *  or balance appears on any of them. Yet each of those screens fetched EVERY SNAPSHOT ROW of
 *  the week -- about 161,000 on this book -- parsed them all into JavaScript objects, held them
 *  in memory at once, added them up and threw them away. That is the HTTP 504s, and it is what
 *  was eating three-quarters of the hosting plan's memory allowance. At 100% the project is
 *  paused.
 *
 *  The database is 150 MB, indexed and analysed. It can add up a column without sending it
 *  anywhere. `db/migrations/2026-08-05-snapshot-totals.sql` gives it two functions that return
 *  ONE ROW PER (day, type, weekday, team, upload batch) with the figures already summed --
 *  roughly two hundred rows for a week instead of a hundred and sixty thousand.
 *
 *  THE SHAPE, which every caller in this system now reads instead of raw rows:
 *
 *    expected   { snapshot_date, snapshot_type, team, upload_batch, created_at,
 *                 customers, expected_amt, collected_amt, uncollected_amt, paid_n, over_n }
 *    defaulter  { snapshot_date, snapshot_type, weekday, team, upload_batch, created_at,
 *                 customers, arrears_amt }
 *
 *  WHY upload_batch AND created_at ARE STILL ON EVERY ROW. Resolving which upload wins -- the
 *  latest date, then the latest batch within it -- is the rule that stops a corrected re-upload
 *  being counted twice, and four screens apply it at four subtly different groupings. It stays
 *  in JavaScript, in ONE place (snapshots.js), and it now runs over these summed rows exactly
 *  as it used to run over the raw ones: same function, same comparison, a thousand times fewer
 *  rows to compare. A second copy of that rule inside SQL could drift, and a drift there
 *  silently doubles a figure.
 *
 *  AND IT FALLS BACK. The migration is run by hand in the Supabase SQL editor, so between a
 *  deploy and that happening the functions do not exist. When they are missing, the rows are
 *  read and folded here instead -- the same shape out, produced the old expensive way. Nothing
 *  breaks by the migration being late; it is only slow, exactly as it always was.
 *
 *  test/snapshot-totals.test.mjs computes every screen BOTH ways over the same book and fails
 *  if any figure differs by so much as a shilling.
 */

import { runQuery, fetchAll , rpcAll } from './supabase.js';
import { latestSnapshot, latestSnapshotDate, snapshotsInRange, upperTeams, pickLatestBatch } from './snapshots.js';
import { todayKey, addDaysKey } from './time.js';
import { collectedOf, num } from './recovery.js';

export const EXPECTED_TOTALS_FN = 'expected_snapshot_totals';
export const DEFAULTER_TOTALS_FN = 'defaulter_snapshot_totals';

/* THE COLUMNS THE FALLBACK READS -- exactly what the fold below looks at, and nothing else.
   These are not the shared snapshot column lists and must not be pointed at them: those serve
   the phone's customer lists too, which need names and numbers. Anything the fold starts
   reading has to be added here, and the tests' fake database returns only what is asked for,
   so an omission fails a test rather than quietly reporting zero. */
const EXP_FOLD_COLS = 'team, payment_expected, arrears, todays_status, snapshot_date, snapshot_type';
const DEF_FOLD_COLS = 'team, arrears, snapshot_date, snapshot_type, weekday';

/* ---------------------------------------------------------------- the fold (fallback path) */

/** One grouping key from several nullable parts. A character no team name can contain marks
    NULL, and another separates the parts -- so a team named "null", a team named nothing and a
    team genuinely absent stay three separate groups, and no pair of parts can run together into
    the same key. Postgres's GROUP BY treats NULL as one group; this matches it. */
const NUL = '\u0000', SEP = '\u0001';
function groupKey(parts) {
  return parts.map(p => (p == null ? NUL : String(p))).join(SEP);
}

/** Raw repayment_snapshots rows -> the expected totals shape. The arithmetic is collectedOf()
    and the same per-row clamp the Uncollected KPI has always used, so the fallback cannot
    disagree with the definition it is a fallback for -- it calls it. */
export function foldExpected(rows) {
  const out = new Map();
  for (const r of (rows || [])) {
    const k = groupKey([r.snapshot_date, r.snapshot_type, r.team, r.upload_batch]);
    let b = out.get(k);
    if (!b) {
      b = { snapshot_date: r.snapshot_date == null ? null : r.snapshot_date,
        snapshot_type: r.snapshot_type == null ? null : r.snapshot_type,
        team: r.team == null ? null : r.team,
        upload_batch: r.upload_batch == null ? null : r.upload_batch,
        created_at: null,
        customers: 0, expected_amt: 0, collected_amt: 0, uncollected_amt: 0, paid_n: 0, over_n: 0 };
      out.set(k, b);
    }
    const e = num(r.payment_expected), c = collectedOf(r);
    b.customers += 1;
    b.expected_amt += e;
    b.collected_amt += c;
    b.uncollected_amt += Math.max(0, e - c);
    const st = String(r.todays_status == null ? '' : r.todays_status).trim().toUpperCase();
    if (st === 'PAID') b.paid_n += 1;
    else if (st === 'OVERPAID') b.over_n += 1;
    // The newest moment inside the group -- what pickLatestBatch compares to decide which
    // upload won. max(created_at) is what the SQL returns for the same group.
    if (String(r.created_at || '') > String(b.created_at || '')) b.created_at = r.created_at;
  }
  return [...out.values()];
}

/** Raw defaulter_snapshots rows -> the defaulter totals shape. */
export function foldDefaulter(rows) {
  const out = new Map();
  for (const r of (rows || [])) {
    const k = groupKey([r.snapshot_date, r.snapshot_type, r.weekday, r.team, r.upload_batch]);
    let b = out.get(k);
    if (!b) {
      b = { snapshot_date: r.snapshot_date == null ? null : r.snapshot_date,
        snapshot_type: r.snapshot_type == null ? null : r.snapshot_type,
        weekday: r.weekday == null ? null : r.weekday,
        team: r.team == null ? null : r.team,
        upload_batch: r.upload_batch == null ? null : r.upload_batch,
        created_at: null, customers: 0, arrears_amt: 0 };
      out.set(k, b);
    }
    b.customers += 1;
    b.arrears_amt += num(r.arrears);
    if (String(r.created_at || '') > String(b.created_at || '')) b.created_at = r.created_at;
  }
  return [...out.values()];
}

/* ------------------------------------------------------------------- calling the functions */

/* IS THE MIGRATION RUN YET? Asking the database and being told "no such function" costs a
   round trip, and the Presentation makes four of these reads -- so on a deployment where the
   SQL has not been pasted in yet, that is four wasted journeys on every single request.
   Remembered per database client, and only for a few minutes, so that running the migration is
   picked up by itself rather than needing a re-deploy. Weak, so a discarded client takes its
   note with it. */
const missingFns = new WeakMap();
const MISSING_TTL_MS = 5 * 60 * 1000;

function noteMissing(db, fn) {
  let m = missingFns.get(db);
  if (!m) { m = new Map(); missingFns.set(db, m); }
  m.set(fn, Date.now());
}
function knownMissing(db, fn) {
  const m = missingFns.get(db);
  const at = m && m.get(fn);
  return !!at && (Date.now() - at) < MISSING_TTL_MS;
}

/** Calls one of the totals functions. Returns the rows, or null when the function is not there
    -- which is the caller's signal to read the rows and fold them instead. A momentary database
    failure is retried by runQuery first and then falls back too: a slow answer beats none. */
async function callTotals(db, fn, args) {
  if (!db || typeof db.rpc !== 'function') return null;
  if (knownMissing(db, fn)) return null;
  /* PAGED. PostgREST caps a function that returns a set exactly as it caps a table read, and
     a week of defaulter decks is nearly four thousand summary rows -- of which a thousand used
     to come back, silently. */
  const { data, error } = await rpcAll(db, fn, args);
  if (error) {
    // PGRST202 is PostgREST's "could not find the function". Anything else -- a permission,
    // a bad argument -- is worth not hammering either, and the fallback still answers.
    noteMissing(db, fn);
    return null;
  }
  return Array.isArray(data) ? data : [];
}

/** `p_teams` is the whole point of doing this at the database. An officer scoped to one team
    must not be handed forty. null means "sees everything", matching the access-code convention
    everywhere else in the system. */
function teamsArg(teams) {
  const t = upperTeams(teams);
  return t.length ? t : null;
}

/* =====================================================================================
   SUMMARY UPLOADS: MORE ROWS OF THE SAME ANSWER.
   =====================================================================================
   A day can be uploaded as the company's summary sheet instead of the full customer export --
   money per team, no names. See db/migrations/2026-08-09b-snapshot-summaries.sql.

   The table is deliberately shaped like what these functions already return, so a summary is
   not a second kind of answer needing a merge rule. It is simply MORE ROWS, carrying their own
   upload_batch and created_at, handed to the batch rule that has always decided which upload
   wins. Upload a summary after a list and the summary is newer, so it wins; upload the list
   again and the list wins. "The latest list/summary uploaded is the one used for reports" is
   the rule this system already had, applied across one more source.

   `is_summary` rides along so a screen can say where a figure came from. Nothing depends on it
   for arithmetic.

   IF THE TABLE IS NOT THERE, this reads as no summaries at all -- every screen behaves exactly
   as it does today. The migration is run by hand like all of them, and a deployment between a
   deploy and somebody opening the SQL editor has to keep working. */
const SUMMARY_TABLE = 'snapshot_summaries';
const SUMMARY_COLS = 'snapshot_date, snapshot_type, weekday, team, upload_batch, created_at, '
  + 'customers, expected_amt, collected_amt, uncollected_amt, arrears_amt';

/* DOES THIS DATABASE USE SUMMARIES AT ALL?
   Most do not, and most never will -- the summary upload exists for the mornings the full
   export was missed. Asking for summary rows on every totals call would put a round trip on
   every screen of every deployment to be told "none", and the phone's performance strip alone
   makes several of those calls.

   So it is asked ONCE per database per minute, with a count that sends no rows at all -- the
   cheapest read there is -- and the answer is remembered. A deployment with no summaries pays
   one count a minute for the whole company; a deployment that uses them pays the reads it
   actually needs. The minute is short enough that a summary uploaded now is used almost at
   once, which is the same promise the answer cache makes about an upload. */
const usesSummaries = new WeakMap();
const SUMMARY_PROBE_TTL_MS = 60000;

function anySummaries(db, nowMs = Date.now()) {
  const hit = usesSummaries.get(db);
  /* THE IN-FLIGHT PROMISE IS WHAT IS REMEMBERED, not just the answer.
     Every screen asks several totals questions AT ONCE -- the phone's strip alone asks four --
     so caching only the resolved value meant all four probed before any of them had finished,
     and the "asked once" promise cost four round trips instead of one. Handing the same pending
     promise to everyone makes concurrent callers share the single request they are waiting on. */
  if (hit && hit.at <= nowMs && (nowMs - hit.at) < SUMMARY_PROBE_TTL_MS) return hit.p;
  const p = (async () => {
    try {
      const { count, error } = await runQuery(() =>
        db.from(SUMMARY_TABLE).select('id', { count: 'exact', head: true }));
      return !error && !!count;
    } catch (e) {
      return false;                             // table not created yet
    }
  })();
  usesSummaries.set(db, { at: nowMs, p });
  // A probe that FAILS must not be remembered as an answer for a minute.
  p.catch(() => usesSummaries.delete(db));
  return p;
}

/** Called after a summary is written, so the next read does not wait out the minute to notice
    the very upload somebody just made. */
export function noteSummaryWritten(db) { usesSummaries.delete(db); }

async function summaryRows(db, kind, { from, to, type = null, weekday = null, teams = null }) {
  if (!(await anySummaries(db))) return [];
  try {
    const rows = await fetchAll(() => {
      let q = db.from(SUMMARY_TABLE).select(SUMMARY_COLS).eq('kind', kind)
        .gte('snapshot_date', from).lte('snapshot_date', to);
      if (type) q = q.eq('snapshot_type', type);
      if (weekday) q = q.eq('weekday', weekday);
      const t = upperTeams(teams);
      if (t.length) q = q.in('team', t);        // team scoping at the database, like every read
      return q;
    });
    return rows.map(r => ({ ...r, is_summary: true }));
  } catch (e) {
    return [];                                  // table not created yet -- see the note above
  }
}

/** The newest date a summary exists for. Read alongside the snapshot table's own latest date,
    because a day uploaded ONLY as a summary is still the latest day -- and resolving the date
    off the customer lists alone would skip straight past it to an older, fuller one. */
/** THE SUMMARY SIDE OF "WHICH DAY IS THE LATEST", IN ONE TRIP RATHER THAN TWO.

    Asking for the newest summary date and then for that date's rows is two journeys to answer
    one question. Instead this asks for every summary from the list's own latest date onwards --
    anything older cannot win, because the list already beats it -- and JavaScript takes the
    newest date that came back. On a book with no summaries it returns nothing and the caller
    carries on exactly as before.

    `floor` is the date the customer lists resolved to, or null when there are none at all -- in
    which case any summary is a candidate, but only back to SUMMARY_LOOKBACK_DAYS.

    THAT BOUND IS NOT DECORATION. This read used to start at the year 0001 and end at 9999, and
    the identical mistake in the duplicate sweep is what made its button appear to do nothing on
    a real book: an unbounded range is instant on a fixture and does not come back on a live
    database. It is harmless here only while nobody uses summaries -- the probe short-circuits an
    empty table -- so it would have started biting at exactly the moment somebody came to rely
    on the feature, which is the worst time for a read to discover it is unbounded.

    Thirteen months, because a summary older than a year is not "the latest" by any reading, and
    because it leaves a full year of history reachable. */
const SUMMARY_LOOKBACK_DAYS = 400;

async function summariesFrom(db, kind, { floor, type = null, weekday = null, notAfter = null, teams = null }) {
  /* The ceiling is the caller's own cap where it has one. Callers pass today; Date.now() is the
     last resort rather than the normal path, and it only ever widens the window by hours. */
  const ceiling = notAfter || todayKey(Date.now());
  const earliest = addDaysKey(ceiling, -SUMMARY_LOOKBACK_DAYS);
  const rows = await summaryRows(db, kind, {
    // The later of the two: a floor from the customer lists already excludes anything older.
    from: (floor && String(floor) > earliest) ? floor : earliest,
    to: ceiling, type, weekday, teams,
  });
  if (!rows.length) return { date: null, rows: [] };
  let newest = null;
  for (const r of rows) if (!newest || String(r.snapshot_date) > String(newest)) newest = r.snapshot_date;
  return { date: newest, rows: rows.filter(r => String(r.snapshot_date) === String(newest)) };
}

/** The later of the two dates, either of which may be missing. */
const laterDate = (a, b) => (!a ? b : !b ? a : (String(a) > String(b) ? a : b));

/* ------------------------------------------------------------------------- expected totals */

/** Every day in [from, to] of one Expected type, summed per team and per upload batch. */
export async function expectedTotalsInRange(db, { type = null, from, to, teams = null } = {}) {
  const [lists, sums] = await Promise.all([
    (async () => {
      const agg = await callTotals(db, EXPECTED_TOTALS_FN,
        { p_from: from, p_to: to, p_type: type, p_teams: teamsArg(teams) });
      if (agg) return agg;
      const raw = await snapshotsInRange(db, 'repayment_snapshots',
        type ? { snapshot_type: type } : {}, from, to, teams, EXP_FOLD_COLS);
      return foldExpected(raw);
    })(),
    summaryRows(db, 'expected', { from, to, type, teams }),
  ]);
  return sums.length ? lists.concat(sums) : lists;
}

/* --------------------------------------------------- agg-only totals for the dashboard's month */
/* THE READ THAT TOOK THE DASHBOARD PAST 45 SECONDS, TWICE, AND WHAT IT TAUGHT.
   The month cards first widened the plain range reads -- and where the totals function is
   missing, the fallback read a MONTH of raw customer rows: the read that does not come back.
   The "fix" then offered the wide window only to the aggregating function -- and the dashboard
   STILL timed out, because a month-wide aggregate over a big enough book is slow on a small
   database instance even when the database does the summing.

   So the month is now a strictly AGG-ONLY question: no raw fallback exists on this path at
   all (null where the function is not installed), and the dashboard holds these reads to a
   time budget besides -- see MONTH_BUDGET_MS in dashboardFull. Whatever is slow about a given
   deployment's month, the dashboard answers on time and the month cards stand down. */
/* THE MONTH, ASKED IN WEEK-SIZED SLICES -- "these should auto average the monthly dates".
   The whole-month aggregate did not answer inside the budget on the live instance even with
   the database doing the summing. But week-sized questions demonstrably do: the weekly reads
   answer one on every single dashboard load. So the month walks itself in sequential <=7-day
   slices of the same aggregate (sequential on purpose -- a wave of concurrent requests is the
   shape that once took this system down; see the note in supabase.js), sums the answers in
   hand, and gives up cleanly the moment a slice finds the function missing or the deadline
   passed. Summaries ride in one whole-month read each: that table holds a handful of rows per
   upload, never the book. Returns { exp, def } in the same row shape the range totals speak,
   or null -- and null must always mean "the cards stand down", never an error. */
export async function totalsAggSlice(db, { from, to } = {}) {
  const [e, f] = await Promise.all([
    callTotals(db, EXPECTED_TOTALS_FN,
      { p_from: from, p_to: to, p_type: 'today', p_teams: null }),
    callTotals(db, DEFAULTER_TOTALS_FN,
      { p_from: from, p_to: to, p_type: null, p_teams: null, p_weekday: null }),
  ]);
  if (!e || !f) return null;                 // the totals functions are not installed here
  return { exp: e, def: f };
}
/** The summary uploads over a range, both kinds -- a handful of rows per upload, never the
    book, in the same row shape the totals speak. */
export function monthSummaryRows(db, kind, { from, to } = {}) {
  return summaryRows(db, kind, { from, to, type: kind === 'expected' ? 'today' : null });
}

/** The latest Expected snapshot of one type, batch-resolved -- the totals twin of
    latestSnapshot, and the same { rows, date, batch } answer so callers can still say exactly
    which snapshot a figure came from. */
export async function expectedTotalsLatest(db, { type = null, teams = null, onDate = null,
  notAfter = null, notBefore = null } = {}) {
  const filters = type ? { snapshot_type: type } : {};
  /* WHICH DAY IS THE LATEST, over BOTH sources. A day uploaded only as a summary is still the
     latest day; resolving off the customer lists alone would step straight past it to an older,
     fuller one and report last week's money as today's. */
  const listDate = onDate || await latestSnapshotDate(db, 'repayment_snapshots', filters, { notAfter, notBefore });
  const summ = onDate
    ? { date: onDate, rows: await summaryRows(db, 'expected', { from: onDate, to: onDate, type, teams }) }
    : await summariesFrom(db, 'expected', { floor: listDate, type, notAfter, teams });
  const date = onDate || laterDate(listDate, summ.date);
  if (!date) return { rows: [], date: null, batch: null };
  // A summary from an older day than the winning one cannot count -- the list beat it.
  const sums = summ.rows.filter(r => String(r.snapshot_date) === String(date));

  if (knownMissing(db, EXPECTED_TOTALS_FN)) {
    const snap = await latestSnapshot(db, 'repayment_snapshots', filters,
      { onDate: date, teams, columns: EXP_FOLD_COLS });
    return resolved(foldExpected(snap.rows).concat(sums), date);
  }
  const agg = await callTotals(db, EXPECTED_TOTALS_FN,
    { p_from: date, p_to: date, p_type: type, p_teams: teamsArg(teams) });
  if (!agg) {
    const snap = await latestSnapshot(db, 'repayment_snapshots', filters,
      { onDate: date, teams, columns: EXP_FOLD_COLS });
    return resolved(foldExpected(snap.rows).concat(sums), date);
  }
  return resolved(agg.concat(sums), date);
}

/* ------------------------------------------------------------------------ defaulter totals */

/** Every deck in [from, to], summed per team, per weekday and per upload batch. */
export async function defaulterTotalsInRange(db, { type = null, weekday = null, from, to, teams = null } = {}) {
  const [lists, sums] = await Promise.all([
    (async () => {
      const agg = await callTotals(db, DEFAULTER_TOTALS_FN,
        { p_from: from, p_to: to, p_type: type, p_teams: teamsArg(teams), p_weekday: weekday });
      if (agg) return agg;
      const filters = {};
      if (type) filters.snapshot_type = type;
      if (weekday) filters.weekday = weekday;
      const raw = await snapshotsInRange(db, 'defaulter_snapshots', filters, from, to, teams, DEF_FOLD_COLS);
      return foldDefaulter(raw);
    })(),
    summaryRows(db, 'defaulter', { from, to, type, weekday, teams }),
  ]);
  return sums.length ? lists.concat(sums) : lists;
}

/** The latest deck matching type/weekday, batch-resolved. */
export async function defaulterTotalsLatest(db, { type = null, weekday = null, teams = null,
  onDate = null, notAfter = null, notBefore = null } = {}) {
  const filters = {};
  if (type) filters.snapshot_type = type;
  if (weekday) filters.weekday = weekday;
  // Both sources decide the latest date -- see the note in expectedTotalsLatest.
  const listDate = onDate || await latestSnapshotDate(db, 'defaulter_snapshots', filters, { notAfter, notBefore });
  const summ = onDate
    ? { date: onDate, rows: await summaryRows(db, 'defaulter', { from: onDate, to: onDate, type, weekday, teams }) }
    : await summariesFrom(db, 'defaulter', { floor: listDate, type, weekday, notAfter, teams });
  const date = onDate || laterDate(listDate, summ.date);
  if (!date) return { rows: [], date: null, batch: null };
  const sums = summ.rows.filter(r => String(r.snapshot_date) === String(date));

  if (knownMissing(db, DEFAULTER_TOTALS_FN)) {
    const snap = await latestSnapshot(db, 'defaulter_snapshots', filters,
      { onDate: date, teams, columns: DEF_FOLD_COLS });
    return resolved(foldDefaulter(snap.rows).concat(sums), date);
  }
  const agg = await callTotals(db, DEFAULTER_TOTALS_FN,
    { p_from: date, p_to: date, p_type: type, p_teams: teamsArg(teams), p_weekday: weekday });
  if (!agg) {
    const snap = await latestSnapshot(db, 'defaulter_snapshots', filters,
      { onDate: date, teams, columns: DEF_FOLD_COLS });
    return resolved(foldDefaulter(snap.rows).concat(sums), date);
  }
  return resolved(agg.concat(sums), date);
}

/** The latest upload of one day wins, whole-batch -- the same rule, run over summed rows.
    An empty answer reports date null, exactly as latestSnapshot does, so a screen can tell
    "no snapshot" from "a snapshot with nothing in it". */
function resolved(agg, date) {
  const rows = pickLatestBatch(agg);
  if (!rows.length) return { rows: [], date: null, batch: null };
  return { rows, date, batch: rows[0].upload_batch || 'legacy' };
}

/* ------------------------------------------------------------------------------ the adders

   Named so that a figure reads as what it is. Every screen's sums go through these, so
   "which field is the money" is answered once rather than in each of five places. */

export const tCustomers   = rows => rows.reduce((s, r) => s + num(r.customers), 0);
export const tExpected    = rows => rows.reduce((s, r) => s + num(r.expected_amt), 0);
export const tCollected   = rows => rows.reduce((s, r) => s + num(r.collected_amt), 0);
export const tUncollected = rows => rows.reduce((s, r) => s + num(r.uncollected_amt), 0);
export const tArrears     = rows => rows.reduce((s, r) => s + num(r.arrears_amt), 0);
export const tPaidOver    = rows => rows.reduce((s, r) => s + num(r.paid_n) + num(r.over_n), 0);


/* =====================================================================================
   EVERY TEAM'S OWN LATEST DECK -- and why the date had to stop being one number.

     "i rebuilt and also reuploaded still ester aint there .. means we missing customers to
      make followups to"

   The batch rule was fixed once already: it used to keep the newest upload of a DAY, which
   threw away sixteen teams when a day arrived as seventeen files, and it now resolves per team.
   THE DATE WAS NEVER GIVEN THE SAME TREATMENT. `latestSnapshotDate` asks the whole table for
   its newest snapshot_date and every read then pins to that one day -- so the moment ANY team
   is uploaded with a newer date, every team whose deck is older disappears completely.

   Not a few rows. The entire team. Reproduced exactly: two teams, GOBA dated two days back and
   MBEYA dated today, and GOBA is simply not in the answer.

   That is why re-uploading did not help. Her team's deck was landing perfectly and being
   filtered out by somebody else's more recent upload.

   THE ANSWER IS A GROUP BY, SO IT BELONGS IN THE DATABASE. The team-day totals function already
   returns one summary row per team per day per batch, which is exactly the map needed, and it
   costs ONE round trip and sends no customer rows at all. Without the migration this returns
   null and the caller keeps the old single-date behaviour -- deliberately, because the honest
   fallback here would be reading a month of decks, and that is precisely the kind of read this
   whole system has spent days removing. */
/* =====================================================================================
   AND THE DATE IS PER TEAM *PER WEEKDAY*, WHICH IS THE UNIT A DECK ACTUALLY IS.

     "Wamerudishwa 8086 ... (deki 8,783 · rejista 12,391 · 2026-08-10 · MON, TUE)"

   Eight thousand restored and the phones still short, and that line says why: the rebuild had
   read a deck of 8,783 against a register of 12,391, and it found only TWO WEEKDAYS in it.

   Resolving one date per team looks right and is not. A team does not have "a deck" -- it has
   one deck PER WEEKDAY, and each of those is uploaded on its own day. Monday's and Tuesday's
   went up on the 10th; Wednesday's, Thursday's and Friday's went up earlier in the week. Taking
   the team's newest date and reading only that day therefore keeps whichever weekdays happened
   to be uploaded most recently and silently drops the rest of the week -- every customer on
   them, on every screen and every handset.

   It is the same fault as the two before it, one level further down, and it hid behind them:
   fixing WHICH BATCH exposed WHICH DATE, and fixing WHICH DATE per team exposed that a team is
   not the unit either. The key is team AND weekday, which is what a deck is.

   The grouping is free -- the totals function already returns weekday on every summary row, so
   this is the same single round trip reading one more column of what it was already sending. */
export const deckKey = (team, weekday) =>
  String(team == null ? '' : team).trim().toUpperCase() + '|'
  + String(weekday == null ? '' : weekday).trim().toUpperCase();

export async function deckDatesPerTeam(db, { type = null, weekday = null, from, to, teams = null } = {}) {
  const agg = await callTotals(db, DEFAULTER_TOTALS_FN,
    { p_from: from, p_to: to, p_type: type, p_teams: teamsArg(teams), p_weekday: weekday });
  if (!agg) return null;                       // migration not run -- caller falls back
  const by = new Map();                        // TEAM|WEEKDAY -> that deck's own newest date
  for (const r of agg) {
    const d = String(r.snapshot_date || '').slice(0, 10);
    if (!d) continue;
    const k = deckKey(r.team, r.weekday);
    if (!by.has(k) || d > by.get(k)) by.set(k, d);
  }
  return by;
}
