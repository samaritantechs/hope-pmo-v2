import { weekdayOfKey, addDaysKey } from './time.js';

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

/* =====================================================================================
   THE DENOMINATOR FOR ONE DAY, ON THAT RULE -- worked out from a per-day lookup.
   =====================================================================================
     "everywhere uses jana except only where there is recovery officers like in their
      commissions, their personal reports and presentation by rec officer"

   `uncolOn(dateKey)` answers what that day's Expected sheet left uncollected. The answer is
   { den, kind, dates }: the figure, which branch chose it, and the day or days it came from,
   so a tile can print "÷ jana" beside the percentage rather than leave the reader to guess.

   THIS IS THE TEAM AND COMPANY RULE: the dashboard's trend tiles, the Orodha, the leader
   reports and the phone strip. A recovery OFFICER is judged on the day itself -- the
   commission board and the presentation's per-officer boards divide a day's recovery by that
   day's own uncollected, and the week's by the week's -- and that is deliberately NOT this
   function. Two different questions: "how did the book do against what yesterday left" and
   "what did this person earn today". */
const ISO_OF = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };
export function recoveryDenominator(dateKey, uncolOn) {
  const iso = ISO_OF[weekdayOfKey(dateKey)] || null;
  const basis = recoveryBasis(iso);
  if (basis.kind === 'today') return { den: num(uncolOn(dateKey)), kind: 'today', dates: [dateKey] };
  if (basis.kind === 'week') {
    const mon = addDaysKey(dateKey, 1 - iso);
    const dates = [0, 1, 2, 3, 4].map(i => addDaysKey(mon, i));
    return { den: dates.reduce((s, d) => s + num(uncolOn(d)), 0), kind: 'week', dates };
  }
  const y = addDaysKey(dateKey, -1);
  return { den: num(uncolOn(y)), kind: 'yesterday', dates: [y] };
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
