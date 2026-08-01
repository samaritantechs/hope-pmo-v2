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

  // FIXED OPTIMIZATION: Removed 'payment_expected' (which caused the crash) 
  // and included the real columns needed for the defaulter cards:
  const data = snapDate
    ? await fetchAll(() => {
        let q = supabase
          .from('defaulter_snapshots')
          // amount_due and customer_id do not exist on this table -- asking for them makes
          // PostgREST reject the whole request, which is an endpoint that always fails rather
          // than a faster one. The real column is `arrears`.
          .select('id, ref, team, weekday, snapshot_type, snapshot_date, full_name, contact, guarantor_name, guarantor_contact, status, ds, dc, days_elapsed, arrears, other_inst, balance, disb_date, expire_date, chronic_date, upload_batch, created_at')
          .eq('snapshot_type', type)
          .eq('weekday', wd)
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
