import { supabase } from './lib/supabase.js';
import { authCode, teamAllowed, withApi } from './lib/auth.js';

// GET /api/defaulters?code=XXX&type=current&weekday=WED&date=2026-07-22
//   type: 'current' | 'initial'
//   weekday: MON..SUN -- defaults to today's weekday in Africa/Dar_es_Salaam if omitted
//   date: yyyy-mm-dd -- defaults to the most recent snapshot for that weekday if omitted
export default withApi(async (req, res) => {
  const { code, type = 'current', weekday, date } = req.query;
  const user = await authCode(code);

  const wd = weekday || currentWeekday();

  let query = supabase
    .from('defaulter_snapshots')
    .select('*')
    .eq('snapshot_type', type)
    .eq('weekday', wd)
    .order('snapshot_date', { ascending: false });

  if (date) {
    query = query.eq('snapshot_date', date);
  } else {
    // No date given -- take the latest snapshot_date available for this weekday, matching
    // "always show me the current one" without the caller needing to know what today's
    // date-key is. One extra round trip, worth it for callers not having to compute this.
    const { data: latest } = await supabase
      .from('defaulter_snapshots')
      .select('snapshot_date')
      .eq('snapshot_type', type).eq('weekday', wd)
      .order('snapshot_date', { ascending: false }).limit(1).maybeSingle();
    if (latest) query = query.eq('snapshot_date', latest.snapshot_date);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data || []).filter(r => teamAllowed(user, r.team));
  return { rows, count: rows.length };
});

function currentWeekday() {
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return days[new Date().getDay()];
}
