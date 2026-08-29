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

/* =====================================================================================
   THE TWO AGGREGATES FROM db/migrations/2026-08-10-upload-status.sql, as Postgres answers
   them -- transcribed for the same reason as the pair above, so both worlds can be exercised.

   These replaced four unbounded whole-table reads on the UPLOAD PAGE: every expected row,
   every defaulter row, every payment and every call ever recorded, to answer a question about
   one day. Every figure they return is a count or a maximum, and neither moves a customer row.
   ===================================================================================== */
const day10 = v => (v == null ? null : String(v).slice(0, 10));
// The fake's store wraps every table as { rows: [...] }, exactly as fake-db.mjs builds it.
const tbl = t => (t && t.rows) ? t.rows : [];

export const UPLOAD_STATUS_RPC = {
  upload_status_summary(store, args) {
    const day = day10(args && (args.p_day || args.day));
    const out = [];
    const group = (rows, source, keyOf, wdOf, dateOf) => {
      const all = {};
      for (const r of rows || []) {
        const k = keyOf(r) + '\u0000' + (wdOf ? wdOf(r) : '');
        const d = day10(dateOf(r));
        if (!all[k]) all[k] = { latest: null, total: 0, batches: {} };
        const b = all[k];
        b.total++;
        if (d && (!b.latest || d > b.latest)) b.latest = d;
        if (d === day) {
          const bt = r.upload_batch || 'legacy';
          b.batches[bt] = (b.batches[bt] || 0) + 1;
        }
      }
      for (const [k, b] of Object.entries(all)) {
        const [kind, wd] = k.split('\u0000');
        const counts = Object.values(b.batches);
        out.push({ source, kind, weekday: wd, latest: b.latest, total: b.total,
          today: counts.length ? Math.max(...counts) : 0, uploads: counts.length });
      }
    };
    group(tbl(store.repayment_snapshots), 'expected', r => r.snapshot_type || '', null, r => r.snapshot_date);
    group(tbl(store.defaulter_snapshots), 'defaulters', r => r.snapshot_type || '', r => r.weekday || '', r => r.snapshot_date);
    const plain = (rows, source, dateOf) => {
      let latest = null, total = 0, today = 0;
      for (const r of rows || []) {
        total++;
        const d = day10(dateOf(r));
        if (d && (!latest || d > latest)) latest = d;
        if (d === day) today++;
      }
      out.push({ source, kind: '', weekday: '', latest, total, today, uploads: 0 });
    };
    plain(tbl(store.received_payments), 'received', r => r.paid_at);
    plain(tbl(store.call_logs), 'calls', r => r.call_date);
    return out;
  },
  call_counts_by_user(store) {
    const by = {};
    for (const r of tbl(store.call_logs)) {
      if (r.user_id == null) continue;
      by[String(r.user_id)] = (by[String(r.user_id)] || 0) + 1;
    }
    return Object.entries(by).map(([user_id, calls]) => ({ user_id, calls }));
  },
};

/** storage_usage_by_date() -- the Settings tab's counting function, transcribed from
    db/RUN-ME-012-postgres-ww4.sql DOSE 11: one grouped count per source per day, for all
    eleven sources. Without it the app HEAD-counts each table (a number, no rows) -- it never
    again downloads a table to measure it, so both worlds must stay cheap and agree on totals. */
export const STORAGE_USAGE_RPC = {
  storage_usage_by_date(store) {
    const src = [
      ['expected', 'repayment_snapshots', 'snapshot_date'],
      ['defaulters', 'defaulter_snapshots', 'snapshot_date'],
      ['received', 'received_payments', 'paid_at'],
      ['abnormal', 'abnormal_payments', 'created_at'],
      ['calls', 'call_logs', 'call_date'],
      ['loans', 'loans', 'upload_date'],
      ['comments', 'followup_comments', 'created_at'],
      ['complaints', 'complaints', 'created_at'],
      ['restructures', 'restructures', 'created_at'],
      ['demand_notices', 'demand_notices', 'created_at'],
      ['followup', 'followup_status', 'updated_at'],
    ];
    const out = [];
    for (const [source, table, col] of src) {
      const n = new Map();
      for (const r of tbl(store[table])) {
        const d = day10(r[col]);
        n.set(d, (n.get(d) || 0) + 1);
      }
      for (const [day, count] of n.entries()) out.push({ source, day, n: count });
    }
    return out;
  },
};

/** loan_stage_counts(p_teams) -- the pipeline funnel's eight integers in one journey.
    Transcribed from db/migrations/2026-08-11-loan-stage-counts.sql, clause for clause, so the
    system can be exercised against a database that HAS the migration and one that has not. */
export const LOAN_STAGE_RPC = {
  loan_stage_counts(store, a = {}) {
    const rows = store.loans ? store.loans.rows : [];
    const teams = a.p_teams || null;
    const up = v => String(v == null ? '' : v).trim().toUpperCase();
    const want = teams ? teams.map(up) : null;
    const n = new Map();
    for (const r of rows) {
      if (want && !want.includes(up(r.team))) continue;
      const k = String(r.stage == null ? '' : r.stage);
      n.set(k, (n.get(k) || 0) + 1);
    }
    return [...n.entries()].map(([stage, count]) => ({ stage, n: count }));
  },
};
