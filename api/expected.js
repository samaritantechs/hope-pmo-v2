import { supabase } from './lib/supabase.js';
import { authCode, teamAllowed, withApi } from './lib/auth.js';

// GET /api/expected?code=XXX&type=today&date=2026-07-22
//   type: 'today' | 'tomorrow' | 'yesterday' | 'initial'
export default withApi(async (req, res) => {
  const { code, type = 'today', date } = req.query;
  const user = await authCode(code);

  let query = supabase.from('repayment_snapshots').select('*').eq('snapshot_type', type).order('snapshot_date', { ascending: false });

  if (date) {
    query = query.eq('snapshot_date', date);
  } else {
    const { data: latest } = await supabase
      .from('repayment_snapshots')
      .select('snapshot_date')
      .eq('snapshot_type', type)
      .order('snapshot_date', { ascending: false }).limit(1).maybeSingle();
    if (latest) query = query.eq('snapshot_date', latest.snapshot_date);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data || []).filter(r => teamAllowed(user, r.team));
  return { rows, count: rows.length };
});
