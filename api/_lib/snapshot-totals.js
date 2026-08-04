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

import { runQuery } from './supabase.js';
import { latestSnapshot, latestSnapshotDate, snapshotsInRange, upperTeams, pickLatestBatch } from './snapshots.js';
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
  const { data, error } = await runQuery(() => db.rpc(fn, args));
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

/* ------------------------------------------------------------------------- expected totals */

/** Every day in [from, to] of one Expected type, summed per team and per upload batch. */
export async function expectedTotalsInRange(db, { type = null, from, to, teams = null } = {}) {
  const agg = await callTotals(db, EXPECTED_TOTALS_FN,
    { p_from: from, p_to: to, p_type: type, p_teams: teamsArg(teams) });
  if (agg) return agg;
  const raw = await snapshotsInRange(db, 'repayment_snapshots',
    type ? { snapshot_type: type } : {}, from, to, teams, EXP_FOLD_COLS);
  return foldExpected(raw);
}

/** The latest Expected snapshot of one type, batch-resolved -- the totals twin of
    latestSnapshot, and the same { rows, date, batch } answer so callers can still say exactly
    which snapshot a figure came from. */
export async function expectedTotalsLatest(db, { type = null, teams = null, onDate = null,
  notAfter = null, notBefore = null } = {}) {
  const filters = type ? { snapshot_type: type } : {};
  if (knownMissing(db, EXPECTED_TOTALS_FN)) {
    const snap = await latestSnapshot(db, 'repayment_snapshots', filters,
      { onDate, notAfter, notBefore, teams, columns: EXP_FOLD_COLS });
    return { rows: foldExpected(snap.rows), date: snap.date, batch: snap.batch };
  }
  const date = onDate || await latestSnapshotDate(db, 'repayment_snapshots', filters, { notAfter, notBefore });
  if (!date) return { rows: [], date: null, batch: null };
  const agg = await callTotals(db, EXPECTED_TOTALS_FN,
    { p_from: date, p_to: date, p_type: type, p_teams: teamsArg(teams) });
  if (!agg) {
    const snap = await latestSnapshot(db, 'repayment_snapshots', filters,
      { onDate: date, teams, columns: EXP_FOLD_COLS });
    return { rows: foldExpected(snap.rows), date: snap.date, batch: snap.batch };
  }
  return resolved(agg, date);
}

/* ------------------------------------------------------------------------ defaulter totals */

/** Every deck in [from, to], summed per team, per weekday and per upload batch. */
export async function defaulterTotalsInRange(db, { type = null, weekday = null, from, to, teams = null } = {}) {
  const agg = await callTotals(db, DEFAULTER_TOTALS_FN,
    { p_from: from, p_to: to, p_type: type, p_teams: teamsArg(teams), p_weekday: weekday });
  if (agg) return agg;
  const filters = {};
  if (type) filters.snapshot_type = type;
  if (weekday) filters.weekday = weekday;
  const raw = await snapshotsInRange(db, 'defaulter_snapshots', filters, from, to, teams, DEF_FOLD_COLS);
  return foldDefaulter(raw);
}

/** The latest deck matching type/weekday, batch-resolved. */
export async function defaulterTotalsLatest(db, { type = null, weekday = null, teams = null,
  onDate = null, notAfter = null, notBefore = null } = {}) {
  const filters = {};
  if (type) filters.snapshot_type = type;
  if (weekday) filters.weekday = weekday;
  if (knownMissing(db, DEFAULTER_TOTALS_FN)) {
    const snap = await latestSnapshot(db, 'defaulter_snapshots', filters,
      { onDate, notAfter, notBefore, teams, columns: DEF_FOLD_COLS });
    return { rows: foldDefaulter(snap.rows), date: snap.date, batch: snap.batch };
  }
  const date = onDate || await latestSnapshotDate(db, 'defaulter_snapshots', filters, { notAfter, notBefore });
  if (!date) return { rows: [], date: null, batch: null };
  const agg = await callTotals(db, DEFAULTER_TOTALS_FN,
    { p_from: date, p_to: date, p_type: type, p_teams: teamsArg(teams), p_weekday: weekday });
  if (!agg) {
    const snap = await latestSnapshot(db, 'defaulter_snapshots', filters,
      { onDate: date, teams, columns: DEF_FOLD_COLS });
    return { rows: foldDefaulter(snap.rows), date: snap.date, batch: snap.batch };
  }
  return resolved(agg, date);
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
