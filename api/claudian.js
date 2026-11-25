import { supabase } from './_lib/supabase.js';
import { withApi, gatedUser } from './_lib/auth.js';
import { userByDevice, pseudoUser } from './_lib/call-core.js';
import { claudianHandle, portalSubject, callSubject } from './_lib/claudian.js';

// POST /api/claudian   { code | device, op: 'status' | 'faq' | 'ask', q, id, lang, hist }
// Claudian-PMO, the helper in the corner of the portal (identified by the access code, through the same door as every portal call) and of
// HOPE Calls (identified by the registered handset, resolved by call-core's own userByDevice so a switched-off account stays switched off).
// A FUNCTION OF ITS OWN: nothing here is on /api/call or /api/upload (CLAUDE.md section 1), and a slow answer from the model holds only
// this request. Everything it does is in _lib/claudian.js; the model's name is a constant there, and nothing in this body can change it.
export default withApi(async (req) => {
  if (req.method !== 'POST') { const e = new Error('Method not allowed'); e.status = 405; throw e; }
  const body = req.body || {};
  let subject;
  if (body.device) {
    let cu;
    try { cu = await userByDevice(supabase, body.device); }
    catch (e) {
      if (e && e.accountOff) { const x = new Error('This account is switched off.'); x.status = 403; throw x; }
      throw e;
    }
    if (!cu) { const e = new Error('This device is not registered.'); e.status = 401; throw e; }
    subject = callSubject(cu, pseudoUser(cu), body.device);
  } else {
    subject = portalSubject(await gatedUser(body.code));
  }
  return claudianHandle(supabase, subject, body);
});
