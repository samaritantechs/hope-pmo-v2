/* THE TWO TEAM-DAY TOTALS FUNCTIONS, AS POSTGRES WILL ANSWER THEM.
 *
 * db/migrations/2026-08-05-snapshot-totals.sql adds two SQL functions that add the snapshots up
 * inside the database instead of sending 161,000 rows to the web server to be added up there.
 * This is that SQL transcribed, clause for clause, so the whole system can be exercised against
 * a database that HAS the migration as well as one that has not.
 *
 * IT IS DELIBERATELY WRITTEN OUT IN FULL rather than calling foldExpected / foldDefaulter from
 * api/_lib/snapshot-totals.js. Those are the fallback -- the very thing this is compared
 * against. A comparison where both sides call the same function proves nothing at all.
 * test/snapshot-totals.test.mjs runs every screen against both and asserts that every figure
 * matches, and that is only worth having because these are two separate pieces of arithmetic.
 *
 * Use it:   fakeDb(tables, { rpc: SNAPSHOT_TOTALS_RPC })
 * Leave it out and the fake behaves like a database where the migration has not been run yet --
 * which is what every deployment looks like between a deploy and somebody opening the SQL
 * editor, and is therefore a state the system has to keep working in.
 */

const inRange = (d, from, to) => d != null && String(d) >= String(from) && String(d) <= String(to);
const matches = (v, want) => want == null || String(v) === String(want);
const n0 = v => (v == null ? 0 : Number(v) || 0);

/* Postgres GROUP BY puts every NULL into one group and never confuses it with a value, so the
   marker for "no value" has to be something no team name or date can contain. */
const NULMARK = String.fromCharCode(0);
const SEPMARK = String.fromCharCode(1);
const gk = parts => parts.map(p => (p == null ? NULMARK : String(p))).join(SEPMARK);

export const SNAPSHOT_TOTALS_RPC = {
  /** expected_snapshot_totals(p_from, p_to, p_type, p_teams) */
  expected_snapshot_totals(store, a = {}) {
    const src = store.repayment_snapshots ? store.repayment_snapshots.rows : [];
    const teams = a.p_teams || null;
    const out = new Map();
    for (const s of src) {
      if (!inRange(s.snapshot_date, a.p_from, a.p_to)) continue;
      if (!matches(s.snapshot_type, a.p_type)) continue;
      if (teams && !teams.map(String).includes(String(s.team))) continue;

      const e = n0(s.payment_expected);
      const arr = n0(s.arrears);
      const st = String(s.todays_status == null ? '' : s.todays_status).trim().toUpperCase();
      /* The CASE in the migration: PAID / OVERPAID counts the expected amount only and never
         the overpayment; UNDERPAID is expected minus arrears clamped into [0, expected];
         anything else collected nothing. */
      const col = (st === 'PAID' || st === 'OVERPAID') ? e
        : st === 'UNDERPAID' ? Math.min(Math.max(e - arr, 0), e)
        : 0;

      const k = gk([s.snapshot_date, s.snapshot_type, s.team, s.upload_batch]);
      let g = out.get(k);
      if (!g) {
        g = {
          snapshot_date: s.snapshot_date == null ? null : s.snapshot_date,
          snapshot_type: s.snapshot_type == null ? null : s.snapshot_type,
          team: s.team == null ? null : s.team,
          upload_batch: s.upload_batch == null ? null : s.upload_batch,
          created_at: null,
          customers: 0, expected_amt: 0, collected_amt: 0, uncollected_amt: 0, paid_n: 0, over_n: 0,
        };
        out.set(k, g);
      }
      g.customers += 1;
      g.expected_amt += e;
      g.collected_amt += col;
      // greatest(e - col, 0): clamped per customer BEFORE it is summed, which is what makes the
      // total incapable of going negative however the day went.
      g.uncollected_amt += Math.max(e - col, 0);
      if (st === 'PAID') g.paid_n += 1;
      if (st === 'OVERPAID') g.over_n += 1;
      // max(created_at) -- what the batch rule compares to decide which upload won.
      if (String(s.created_at || '') > String(g.created_at || '')) {
        g.created_at = s.created_at == null ? null : s.created_at;
      }
    }
    return [...out.values()];
  },

  /** defaulter_snapshot_totals(p_from, p_to, p_type, p_teams, p_weekday) */
  defaulter_snapshot_totals(store, a = {}) {
    const src = store.defaulter_snapshots ? store.defaulter_snapshots.rows : [];
    const teams = a.p_teams || null;
    const out = new Map();
    for (const s of src) {
      if (!inRange(s.snapshot_date, a.p_from, a.p_to)) continue;
      if (!matches(s.snapshot_type, a.p_type)) continue;
      if (!matches(s.weekday, a.p_weekday)) continue;
      if (teams && !teams.map(String).includes(String(s.team))) continue;

      const k = gk([s.snapshot_date, s.snapshot_type, s.weekday, s.team, s.upload_batch]);
      let g = out.get(k);
      if (!g) {
        g = {
          snapshot_date: s.snapshot_date == null ? null : s.snapshot_date,
          snapshot_type: s.snapshot_type == null ? null : s.snapshot_type,
          weekday: s.weekday == null ? null : s.weekday,
          team: s.team == null ? null : s.team,
          upload_batch: s.upload_batch == null ? null : s.upload_batch,
          created_at: null, customers: 0, arrears_amt: 0,
        };
        out.set(k, g);
      }
      g.customers += 1;
      g.arrears_amt += n0(s.arrears);
      if (String(s.created_at || '') > String(g.created_at || '')) {
        g.created_at = s.created_at == null ? null : s.created_at;
      }
    }
    return [...out.values()];
  },
};
