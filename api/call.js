import { supabase } from './_lib/supabase.js';
import { withApi } from './_lib/auth.js';
import { callApi } from './_lib/call-core.js';

// POST /api/call   { fn: 'api_callBoot' | 'api_callRegister' | ..., args: [...] }
// One route for the whole HOPE Calls app (public/call.html) -- fn names match the old
// google.script.run functions exactly, so the page's srv() wrapper only swapped transports.
// Auth model matches the live system's: possession of a registered device id (plus a portal
// access code at registration time for leaders). All logic lives in _lib/call-core.js so the
// entire pipeline runs under npm test against a fake PostgREST client.
export default withApi(async (req, res) => {
  if (req.method !== 'POST') { const e = new Error('Method not allowed'); e.status = 405; throw e; }
  const { fn, args } = req.body || {};
  return callApi(supabase, fn, args);
});
