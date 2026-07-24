import { supabase } from './lib/supabase.js';
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
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: expected }, { data: defaulters }, { data: sales }, { data: received }] = await Promise.all([
    latestSnapshot('repayment_snapshots', { snapshot_type: 'today' }),
    latestSnapshot('defaulter_snapshots', { snapshot_type: 'current', weekday: wd }),
    supabase.from('loans').select('team, principal_amt, loan_amt').eq('stage', 'approved'),
    supabase.from('received_payments').select('team, amount_paid').eq('paid_at', today),
  ]);

  const exp = (expected || []).filter(r => teamAllowed(user, r.team));
  const def = (defaulters || []).filter(r => teamAllowed(user, r.team));
  const sal = (sales.data || []).filter(r => teamAllowed(user, r.team));
  const rcv = (received.data || []).filter(r => teamAllowed(user, r.team));

  const totals = {
    expectedCustomers: exp.length,
    expectedAmount: sum(exp, 'payment_expected'),
    collected: sum(exp, 'todays_payment'),
    uncollected: sum(exp, 'payment_expected') - sum(exp, 'todays_payment'),
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
  for (const r of exp) { const t = team_(r.team); t.expectedAmount += num(r.payment_expected); t.collected += num(r.todays_payment); }
  for (const r of def) { const t = team_(r.team); t.defaulterArrears += num(r.arrears); t.defaulterCustomers += 1; }
  for (const r of sal) { team_(r.team).salesAmount += (num(r.principal_amt) || num(r.loan_amt)); }
  for (const r of rcv) { team_(r.team).receivedAmount += num(r.amount_paid); }

  return { totals, teams: Object.values(byTeam).sort((a, b) => a.team.localeCompare(b.team)), asOfWeekday: wd };
});

async function latestSnapshot(table, filters) {
  let q = supabase.from(table).select('snapshot_date').order('snapshot_date', { ascending: false }).limit(1);
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { data: latest } = await q.maybeSingle();
  if (!latest) return { data: [] };
  let q2 = supabase.from(table).select('*').eq('snapshot_date', latest.snapshot_date);
  for (const [k, v] of Object.entries(filters)) q2 = q2.eq(k, v);
  return q2;
}

function num(v) { return typeof v === 'number' ? v : Number(v) || 0; }
function sum(rows, field) { return rows.reduce((s, r) => s + num(r[field]), 0); }

function currentWeekday() {
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return days[new Date().getDay()];
}
