import { supabase, fetchAll } from './lib/supabase.js';
import { authCode, teamAllowed, withApi } from './lib/auth.js';

// GET /api/defaulters?code=XXX&type=current&weekday=WED&date=2026-07-22
//   type: 'current' | 'initial'
//   weekday: MON..SUN -- defaults to today's weekday in Africa/Dar_es_Salaam if omitted
//   date: yyyy-mm-dd -- defaults to the most recent snapshot for that weekday if omitted
export default withApi(async (req, res) => {
  const { code, type = 'current', weekday, date } = req.query;
  const user = await authCode(code);

  const wd = weekday || currentWeekday();

  let snapDate = date;
  if (!snapDate) {
    // No date given -- take the latest snapshot_date available for this weekday, matching
    // "always show me the current one" without the caller needing to know what today's
    // date-key is. One extra round trip, worth it for callers not having to compute this.
    const { data: latest } = await supabase
      .from('defaulter_snapshots')
      .select('snapshot_date')
      .eq('snapshot_type', type).eq('weekday', wd)
      .order('snapshot_date', { ascending: false }).limit(1).maybeSingle();
    snapDate = latest ? latest.snapshot_date : null;
  }

  const data = snapDate
    ? await fetchAll(() => supabase.from('defaulter_snapshots').select('*').eq('snapshot_type', type).eq('weekday', wd).eq('snapshot_date', snapDate))
    : [];

  const rows = data.filter(r => teamAllowed(user, r.team));
  return { rows, count: rows.length };
});

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
