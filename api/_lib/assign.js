import { num } from './recovery.js';
import { fetchAll } from './supabase.js';

/** The rotation engine, in its own module because BOTH the portal and the calls app decide
    who owns a defaulter today, and routing that through portal-core closed an import cycle.

      ACTIVE  (still within term) -> rotate ASSIGN_ACTIVE  every ASSIGN_BUCKET_DAYS days
      EXPIRED (past expiry)       -> step   ASSIGN_EXPIRED  one role per week, then hold
      CHRONIC (past grace weeks)  -> rotate ASSIGN_CHRONIC  weekly, forever

    Recycling a customer between BIKE / MANAGER / GMO is the whole point: the same officer
    calling the same person every week stops working, so ownership moves on a clock. */
const K = s => String(s == null ? '' : s).trim().toUpperCase();

export const ROLE_COLS = { BIKE: 'bike', MANAGER: 'manager', GMO: 'gmo', RECOVERY: 'recovery',
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

/* FIVE SETTINGS, ONE JOURNEY.

   This asked for each key on its own -- five separate round trips to a table that holds a few
   dozen rows -- and did it on EVERY Exp.Def report, every Exp.Def list and every assignments
   screen. Measured on a forty-team book, `settings` was the most-read table on three screens,
   five times each, and every one of those five carried a single value.

   Parallel made it look free and it is not: five concurrent requests per screen, times the
   screens, times the people on them, is exactly the multiplied concurrency that exhausted the
   connection pool once before. One `in` query returns all five, and the codebase has had
   settingsMany for this since the phone's boot was cut from ten trips to four.

   ONE READ, and the same five defaults as before if the table has none of them. */
export async function assignStrategy(db) {
  const rows = await fetchAll(() => db.from('settings').select('key, value')
    .in('key', ['ASSIGN_ACTIVE', 'ASSIGN_CHRONIC', 'ASSIGN_EXPIRED', 'ASSIGN_GRACE_WEEKS', 'ASSIGN_BUCKET_DAYS']));
  const by = {};
  for (const r of (rows || [])) by[String(r.key)] = r.value;
  const a = by.ASSIGN_ACTIVE, c = by.ASSIGN_CHRONIC, e = by.ASSIGN_EXPIRED,
        g = by.ASSIGN_GRACE_WEEKS, b = by.ASSIGN_BUCKET_DAYS;
  return {
    active: parseRoles(a, ['BIKE', 'MANAGER', 'GMO']),
    chronic: parseRoles(c, ['BIKE', 'GMO', 'MANAGER']),
    expired: parseRoles(e, ['MANAGER', 'GMO']),
    graceWeeks: Math.max(1, Math.min(8, parseInt(g, 10) || 2)),
    bucketDays: Math.max(1, Math.min(14, parseInt(b, 10) || 2)),
  };
}
