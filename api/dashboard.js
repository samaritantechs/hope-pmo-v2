import { supabase, fetchAll } from './lib/supabase.js';
import { authCode, teamAllowed, withApi } from './lib/auth.js';

// GET /api/dashboard?code=XXX
// Returns today's Expected totals and current Defaulters totals, team-scoped, plus a
// per-team breakdown. This is computed from whatever the LATEST snapshot_date is for
// today's weekday -- same live-data behavior as the old defCur_(false)/defToday, just as
// a query instead of a function that has to know which of 12 sheets to open.
export default withApi(async (req, res) => {
  const { code } = req.query;
  const user = await authCode(code);
  const wd = currentWeekday();
  const today = todayKey();

  const [exp0, def0, sal0, rcv0] = await Promise.all([
    latestSnapshot('repayment_snapshots', { snapshot_type: 'today' }),
    latestSnapshot('defaulter_snapshots', { snapshot_type: 'current', weekday: wd }),
    fetchAll(() => supabase.from('loans').select('team, principal_amt, loan_amt').eq('stage', 'approved')),
    fetchAll(() => supabase.from('received_payments').select('team, amount_paid').eq('paid_at', today)),
  ]);

  const exp = exp0.filter(r => teamAllowed(user, r.team));
  const def = def0.filter(r => teamAllowed(user, r.team));
  const sal = sal0.filter(r => teamAllowed(user, r.team));
  const rcv = rcv0.filter(r => teamAllowed(user, r.team));

  const totals = {
    expectedCustomers: exp.length,
    expectedAmount: sum(exp, 'payment_expected'),
    collected: exp.reduce((s, r) => s + collectedOf(r), 0),
    uncollected: exp.reduce((s, r) => s + Math.max(0, num(r.payment_expected) - collectedOf(r)), 0),
    defaulterCustomers: def.length,
    defaulterArrears: sum(def, 'arrears'),
    salesCount: sal.length,
    salesAmount: sal.reduce((s, r) => s + (num(r.principal_amt) || num(r.loan_amt)), 0),
    receivedCount: rcv.length,
    receivedAmount: sum(rcv, 'amount_paid'),
  };

  const byTeam = {};
  function team_(t) {
    const k = t || '(no team)';
    byTeam[k] = byTeam[k] || { team: k, expectedAmount: 0, collected: 0, defaulterArrears: 0, defaulterCustomers: 0, salesAmount: 0, receivedAmount: 0 };
    return byTeam[k];
  }
  for (const r of exp) {
    const t = team_(r.team);
    const c = collectedOf(r);
    t.expectedAmount += num(r.payment_expected);
    t.collected += c;
  }
  for (const r of def) { const t = team_(r.team); t.defaulterArrears += num(r.arrears); t.defaulterCustomers += 1; }
  for (const r of sal) { team_(r.team).salesAmount += (num(r.principal_amt) || num(r.loan_amt)); }
  for (const r of rcv) { team_(r.team).receivedAmount += num(r.amount_paid); }

  return { totals, teams: Object.values(byTeam).sort((a, b) => a.team.localeCompare(b.team)), asOfWeekday: wd };
});

/** Exact port of collectedOf_(expected, arreas, status) from Code.gs -- not an approximation.
    PAID/OVERPAID counts only the expected amount, never the overpayment. UNDERPAID computes
    expected-minus-arrears, clamped to [0, expected]. Anything else (unpaid/blank) is 0. This
    guarantees every row's contribution to "uncollected" is already >= 0 before it's ever
    summed -- the aggregate literally cannot go negative, because no per-row term can. */
function collectedOf(r) {
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

async function latestSnapshot(table, filters) {
  let q = supabase.from(table).select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1);
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { data: latest } = await q.maybeSingle();
  if (!latest) return [];
  return fetchAll(() => {
    let q2 = supabase.from(table).select('*').eq('snapshot_date', latest.snapshot_date);
    for (const [k, v] of Object.entries(filters)) q2 = q2.eq(k, v);
    return q2;
  });
}

function num(v) { return typeof v === 'number' ? v : Number(v) || 0; }
function sum(rows, field) { return rows.reduce((s, r) => s + num(r[field]), 0); }

/** Vercel's serverless runtime runs in UTC; HOPE runs in Africa/Dar_es_Salaam (UTC+3, no DST
    anywhere in East Africa, so a fixed offset is correct here and does not drift). Reading the
    date or the weekday straight off `new Date()` therefore returns the WRONG DAY for the first
    three hours of every Tanzanian day: at 01:00 EAT on a Monday the server is still on Sunday,
    so today's Received Payments came back empty and the defaulter weekday resolved to SUN. Every
    "what day is it" decision in this file goes through these two helpers instead. */
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;               // Africa/Dar_es_Salaam
function localNow() { return new Date(Date.now() + TZ_OFFSET_MS); }
function todayKey() { return localNow().toISOString().slice(0, 10); }

function currentWeekday() {
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return days[localNow().getUTCDay()];                 // getUTCDay on the shifted clock = the local weekday
}
