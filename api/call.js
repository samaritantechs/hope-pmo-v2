import { supabase } from './_lib/supabase.js';
import { withApi, authCodeResolved } from './_lib/auth.js';
import { callApi } from './_lib/call-core.js';
import { workspaceFor, HOPELOAN, hopeLoanNotReadyMessage } from './_lib/workspace.js';

// POST /api/call   { fn: 'api_callBoot' | 'api_callRegister' | ..., args: [...] }
// One route for the whole HOPE Calls app (public/call.html) -- fn names match the old
// google.script.run functions exactly, so the page's srv() wrapper only swapped transports.
// Auth model matches the live system's: possession of a registered device id (plus a portal
// access code at registration time for leaders). All logic lives in _lib/call-core.js so the
// entire pipeline runs under npm test against a fake PostgREST client.
export default withApi(async (req, res) => {
  if (req.method !== 'POST') { const e = new Error('Method not allowed'); e.status = 405; throw e; }
  const { fn, args, workspace, code } = req.body || {};

  /* THE HOPE LOAN SWITCH, ON THE PHONE.
     Calls signs in with a DEVICE ID, not an access code -- a device resolves to a call_users
     row whose `role` is an officer role, and a device id alone can never be the authority for
     leaving production. This deliberately does NOT invent a second, weaker rule for the phone:
     reaching the sandbox here costs the same PORTAL ACCESS CODE the portal itself asks for,
     resolved the same way /api/me resolves it and authorised by the same rule (ADMIN, or a
     code holding one of HOPE Loan's own tabs -- see mayUseHopeLoan in workspace.js). Whatever a
     code cannot open in the portal it cannot open here either; there is one door, checked once.

     Anything short of that -- no code, a wrong code, an officer's code, a code that is valid
     but not an admin -- falls through to production untouched, and silently: an error would
     itself be a way to discover that a sandbox exists. An officer's handset never carries the
     switch and could not use it if it did. */
  let db = supabase;
  if (String(workspace || '').trim().toLowerCase() === HOPELOAN && code) {
    let user = null;
    try { user = await authCodeResolved(code); }
    catch { /* an unreadable code is simply not an admin -- stay on the real book, silently */ }
    if (user) {
      const ws = await workspaceFor(user, HOPELOAN);
      /* SAY IT, DO NOT HANG. This used to hand back a client pointed at a schema that could not
         answer, so the phone sat on "trying…" under a red SANDBOX banner while every request
         failed -- looking like a broken app rather than an un-run migration. An admin who asked
         for the sandbox and cannot have it is told why, in words naming the fix. */
      if (ws.ready === false) { const e = new Error(hopeLoanNotReadyMessage()); e.status = 503; throw e; }
      db = ws.db;
    }
  }
  return callApi(db, fn, args);
});
