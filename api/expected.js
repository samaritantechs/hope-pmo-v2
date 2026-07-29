import { supabase, fetchAll } from './_lib/supabase.js';
import { authCode, teamAllowed, withApi } from './_lib/auth.js';

// GET /api/expected?code=XXX&type=today&date=2026-07-22
export default withApi(async (req, res) => {
  const { code, type = 'today', date } = req.query;
  const user = await authCode(code);

  let snapDate = date;
  if (!snapDate) {
    const { data: latest } = await supabase
      .from('repayment_snapshots')
      .select('snapshot_date')
      .eq('snapshot_type', type)
      .order('snapshot_date', { ascending: false }).limit(1).maybeSingle();
    snapDate = latest ? latest.snapshot_date : null;
  }

  // OPTIMIZATION: Filter by team and include ALL required phone dialing parameters
  const data = snapDate
    ? await fetchAll(() => {
        let q = supabase
          .from('repayment_snapshots')
          .select('id, ref, team, due_summary, payment_expected, balance, full_name, contact')
          .eq('snapshot_type', type)
          .eq('snapshot_date', snapDate);
        
        if (user && user.teams && user.teams.length) {
          q = q.in('team', user.teams);
        }
        return q;
      })
    : [];

  const rows = data.filter(r => teamAllowed(user, r.team));
  return { rows, count: rows.length };
});
