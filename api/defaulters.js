import { supabase, fetchAll } from './_lib/supabase.js';
import { authCode, teamAllowed, withApi } from './_lib/auth.js';
import { currentWeekday } from './_lib/time.js';

// GET /api/defaulters?code=XXX&type=current&weekday=WED&date=2026-07-22
export default withApi(async (req, res) => {
  const { code, type = 'current', weekday, date } = req.query;
  const user = await authCode(code);

  const wd = weekday || currentWeekday();

  let snapDate = date;
  if (!snapDate) {
    const { data: latest } = await supabase
      .from('defaulter_snapshots')
      .select('snapshot_date')
      .eq('snapshot_type', type).eq('weekday', wd)
      .order('snapshot_date', { ascending: false }).limit(1).maybeSingle();
    snapDate = latest ? latest.snapshot_date : null;
  }

  // OPTIMIZATION: Swapped select('*') with only the explicit columns your UI actually displays.
  // Add or remove fields below (e.g., id, customer_name, amount_due) to match your frontend needs.
  const data = snapDate
    ? await fetchAll(() => supabase
        .from('defaulter_snapshots')
        .select('id, team, customer_id, amount_due, phone_number') 
        .eq('snapshot_type', type)
        .eq('weekday', wd)
        .eq('snapshot_date', snapDate)
      )
    : [];

  const rows = data.filter(r => teamAllowed(user, r.team));
  return { rows, count: rows.length };
});
