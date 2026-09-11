import { supabase } from './_lib/supabase.js';
import { withApi } from './_lib/auth.js';
import { deviceApi } from './_lib/device-core.js';

// POST /api/device   { fn: 'dev_hello' | 'dev_beat' | 'dev_claim', args: [...] }
//
// The company phone register's HANDSET half. Deliberately the one route in this system that
// is NOT behind an access code: a locked handset has no code and must never carry one --
// shipping a staff credential inside an APK we hand to the very people we may need to lock
// out is the thing this design exists to avoid. Authentication is the per-device token minted
// at enrolment, checked inside device-core.js, and it authorises exactly one IMEI.
//
// NO WORKSPACE SWITCH HERE, unlike /api/call. The sandbox switch is reached with a portal
// access code, and a handset has none; a device token is authority over ONE phone's status
// row and could never be authority for leaving production. There is one book here, always.
export default withApi(async (req, res) => {
  if (req.method !== 'POST') { const e = new Error('Method not allowed'); e.status = 405; throw e; }
  const { fn, args } = req.body || {};
  return deviceApi(supabase, fn, args);
});
