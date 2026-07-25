import { supabase } from './_lib/supabase.js';
import { authCode, withApi } from './_lib/auth.js';
import { buildDashboard } from './_lib/dashboard-core.js';

// GET /api/dashboard?code=XXX
// Today's Expected totals, current Defaulters, week-bounded Sales, Received, and Recovery %
// (Mon -> today's uncollected, Tue-Fri -> yesterday's, Sat/Sun -> the week's), team-scoped,
// plus a per-team breakdown and a `dates` block saying which snapshot each figure came from.
//
// All computation lives in _lib/dashboard-core.js so the entire pipeline -- snapshot/batch
// resolution, the EAT clock, the recovery rule -- runs under `npm test` against a fake
// PostgREST client. This file is only auth + wiring.
export default withApi(async (req, res) => {
  const user = await authCode(req.query.code);
  return buildDashboard(supabase, user);
});
