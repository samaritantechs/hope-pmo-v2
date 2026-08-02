import { supabase } from './_lib/supabase.js';
import { gatedUser, withApi } from './_lib/auth.js';
import { portalApi } from './_lib/portal-core.js';

// POST /api/portal   { code, fn, args }
// Every read and write behind the portal (public/app.html) -- one route, one auth check, all
// team scoping enforced server-side inside _lib/portal-core.js (which is where the logic
// lives so the whole surface runs under npm test against a fake PostgREST client).
export default withApi(async (req, res) => {
  if (req.method !== 'POST') { const e = new Error('Method not allowed'); e.status = 405; throw e; }
  const { code, fn, args } = req.body || {};
  // Identity, the role's tabs merged in, and the admin's open/closed switch -- all three in
  // one place, so a new portal function cannot accidentally be reachable while the system is
  // closed. An admin passes the switch, which is how it ever gets turned back on.
  const user = await gatedUser(code);
  return portalApi(supabase, user, fn, args);
});
