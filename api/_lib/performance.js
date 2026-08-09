import { fetchAll, runQuery } from './supabase.js';
import { weekMondayKey, todayKey } from './time.js';

/* =======================================================================================
   WHO WAS BEST, AND WHEN -- WRITTEN DOWN AT THE TIME.

     "By using Sales, Collection and Recovery, the system needs to always keep record of best
      team and leaders weekly, monthly and yearly progress regardless of future leader table
      alterations."

   THE LAST FIVE WORDS ARE THE WHOLE DESIGN.

   Every report here resolves a leader by looking them up in the teams table NOW. That is right
   for today's work -- move a GMO onto ten new teams and every board re-points with them, which
   is what makes a reassignment a one-field edit. But it means the PAST is rewritten every time
   somebody is moved: last March's best recovery officer silently becomes whoever holds those
   teams today, and the person who actually earned it disappears from their own record.

   So a record copies the name and the position AS TEXT at the moment it is written. It is a
   photograph, not a pointer.

   WRITTEN AS A SIDE EFFECT OF READING THE WEEKLY REPORT, and deliberately so. A record that
   depends on somebody remembering to press a button is a record with holes in it, and the holes
   are always the weeks nobody was paying attention -- which are the weeks worth having. The
   weekly report is opened constantly; every time it is, the week, the month and the year it
   falls in are stamped with what they look like right now.

   IT CAN NEVER BREAK A REPORT. Fire and forget, every failure swallowed, including the table
   not existing. A report that failed because its history could not be written would be a worse
   report than one with no history.
   ======================================================================================= */

const K = s => String(s == null ? '' : s).trim().toUpperCase();
const num = v => (typeof v === 'number' ? v : Number(v) || 0);

/** The three periods a date belongs to. */
export function periodsOf(dateKey) {
  const d = String(dateKey).slice(0, 10);
  return [
    { period: 'week', period_start: weekMondayKey(Date.parse(d + 'T09:00:00Z')) },
    { period: 'month', period_start: d.slice(0, 7) + '-01' },
    { period: 'year', period_start: d.slice(0, 4) + '-01-01' },
  ];
}

/* The metrics, and where each one's two numbers live on a weekly team row. Named here rather
   than inline so "what is collection measured as" has one answer -- the same one the Weekly
   report prints, since these ARE its rows. */
const METRICS = [
  { metric: 'sales', value: r => num(r.sales), basis: () => null },
  { metric: 'collection', value: r => num(r.collected), basis: r => num(r.expected) },
  { metric: 'recovery', value: r => num(r.recovered), basis: r => num(r.uncollected) },
];

/* Which leader column owns which metric. Sales and collection are the team's own; recovery is
   the recovery officer's, which is the only one of the three that is a single person's job. */
const LEADER_COL = { sales: 'gmo', collection: 'manager', recovery: 'recovery' };

/** Build the rows a period should hold, from the weekly report's own team rows. Pure, so the
    shape of a record can be checked without a database. */
export function recordsFor(teams, leadBy, dateKey) {
  const out = [];
  for (const p of periodsOf(dateKey)) {
    for (const m of METRICS) {
      // Teams.
      for (const t of teams) {
        const v = m.value(t);
        if (!v) continue;                       // a zero is not an achievement worth a row
        const b = m.basis(t);
        out.push({ ...p, metric: m.metric, scope: 'team', name: t.team, position: null,
          value: v, basis: b, pct: b > 0 ? Math.round((v / b) * 10000) / 100 : null });
      }
      // Leaders, added up across every team they hold.
      const by = {};
      for (const t of teams) {
        const lead = (leadBy[K(t.team)] || {})[LEADER_COL[m.metric]];
        if (!lead) continue;
        const k = K(lead);
        if (!by[k]) by[k] = { name: String(lead).trim(), value: 0, basis: 0 };
        by[k].value += m.value(t);
        by[k].basis += num(m.basis(t) || 0);
      }
      for (const b of Object.values(by)) {
        if (!b.value) continue;
        out.push({ ...p, metric: m.metric, scope: 'leader', name: b.name,
          // The position AS IT WAS. This is the field the whole feature exists for.
          position: LEADER_COL[m.metric].toUpperCase(),
          value: b.value, basis: b.basis || null,
          pct: b.basis > 0 ? Math.round((b.value / b.basis) * 10000) / 100 : null });
      }
    }
  }
  return out;
}

/** Stamp the week, month and year that `dateKey` falls in. Fire and forget. */
export function recordPerformance(db, teams, teamRows, dateKey, nowMs = Date.now()) {
  try {
    const leadBy = {};
    for (const t of teamRows || []) leadBy[K(t.team)] = t;
    const rows = recordsFor(teams || [], leadBy, dateKey || todayKey(nowMs));
    if (!rows.length) return;
    const stamped = rows.map(r => ({ ...r, recorded_at: new Date(nowMs).toISOString() }));
    /* onConflict on the natural key, so a period in progress is UPDATED as it runs rather than
       written again every time somebody opens the report. A week settles on its final figures
       when it ends, which is exactly how a record of "this week" should behave. */
    const p = db.from('performance_records')
      .upsert(stamped, { onConflict: 'period,period_start,metric,scope,name' });
    if (p && typeof p.then === 'function') p.then(() => {}, () => {});
  } catch (e) { /* no table, no permission -- the report it accompanied still stands */ }
}

/** The tab: one period at a time, best first. */
export async function performanceHistory(db, { period = 'week', metric = null, scope = null, limit = 400 } = {}) {
  const per = ['week', 'month', 'year'].includes(String(period)) ? String(period) : 'week';
  let rows = [];
  let available = true;
  try {
    rows = await fetchAll(() => {
      let q = db.from('performance_records')
        .select('period, period_start, metric, scope, name, position, value, basis, pct, recorded_at')
        .eq('period', per)
        .order('period_start', { ascending: false })
        .limit(Math.max(1, Math.min(2000, parseInt(limit, 10) || 400)));
      if (metric) q = q.eq('metric', metric);
      if (scope) q = q.eq('scope', scope);
      return q;
    });
  } catch (e) {
    available = false;
  }
  // Best first within each period, which is the only order this table is ever read in.
  rows = rows.slice().sort((a, b) =>
    String(b.period_start).localeCompare(String(a.period_start))
    || String(a.metric).localeCompare(String(b.metric))
    || num(b.value) - num(a.value));
  return {
    period: per, rows, count: rows.length, available,
    note: available ? null
      : 'Kumbukumbu ya ufanisi bado haijaanzishwa — endesha db/migrations/2026-08-09d-performance-records.sql. '
        + '/ The performance history table does not exist yet — run db/migrations/2026-08-09d-performance-records.sql.',
    periods: [...new Set(rows.map(r => r.period_start))].sort().reverse(),
  };
}
