/** The Recovery % rule -- ONE home, the same three branches as api_callDailySummary in the
    live system's Code.gs, so the two systems can run side by side and agree on all seven days:

      Mon      -> today's uncollected      (no yesterday exists inside a HOPE week)
      Tue-Fri  -> yesterday's uncollected  (officers chase what yesterday left behind)
      Sat/Sun  -> the week's uncollected   (Mon-Fri -- the weekend reconciles the whole week)

    That is the DENOMINATOR basis. The numerator is always what the deck actually recovered:
    initial arrears minus current arrears, paired strictly (see dashboard-core.js). */

export function recoveryBasis(isoWd) {
  if (isoWd === 1) return { kind: 'today', label: "today's uncollected" };
  if (isoWd >= 6) return { kind: 'week', label: "this week's uncollected (Mon-Fri)" };
  return { kind: 'yesterday', label: "yesterday's uncollected" };
}

/** Exact port of collectedOf_(expected, arreas, status) from Code.gs -- not an approximation.
    PAID/OVERPAID counts only the expected amount, never the overpayment. UNDERPAID computes
    expected-minus-arrears, clamped to [0, expected]. Anything else (unpaid/blank) is 0. This
    guarantees every row's contribution to "uncollected" is already >= 0 before it's ever
    summed -- the aggregate literally cannot go negative, because no per-row term can. */
export function collectedOf(r) {
  const expected = num(r.payment_expected);
  const arrears = num(r.arrears);
  const status = String(r.todays_status || '').trim().toUpperCase();
  if (status === 'PAID' || status === 'OVERPAID') return expected;
  if (status === 'UNDERPAID') {
    let c = expected - arrears;
    if (c < 0) c = 0;
    if (c > expected) c = expected;
    return c;
  }
  return 0;
}

/** Sum of what an Expected snapshot left uncollected -- the recovery denominator on every
    basis, and the dashboard's Uncollected KPI. Per-row clamp keeps it >= 0 by construction. */
export function uncollectedOf(rows) {
  return rows.reduce((s, r) => s + Math.max(0, num(r.payment_expected) - collectedOf(r)), 0);
}

export function num(v) { return typeof v === 'number' ? v : Number(v) || 0; }
