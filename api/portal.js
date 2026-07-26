import { supabase } from './_lib/supabase.js';
import { authCode, withApi } from './_lib/auth.js';
import { portalApi } from './_lib/portal-core.js';

// POST /api/portal   { code, fn, args }
// Every read and write behind the portal (public/app.html) -- one route, one auth check, all
// team scoping enforced server-side inside _lib/portal-core.js (which is where the logic
// lives so the whole surface runs under npm test against a fake PostgREST client).
export default withApi(async (req, res) => {
  if (req.method !== 'POST') { const e = new Error('Method not allowed'); e.status = 405; throw e; }
  const { code, fn, args } = req.body || {};
  const user = await authCode(code);
  // Merge the role's tabs in, exactly as /api/me does, so permission checks inside the
  // portal functions (settings, access codes) see the same tab list the UI gated on.
  const { data: roleRow } = await supabase.from('roles').select('tabs').eq('role', user.role).maybeSingle();
  user.tabs = [...new Set([...(user.tabs || []), ...((roleRow && roleRow.tabs) || [])])];
  return portalApi(supabase, user, fn, args);
});
