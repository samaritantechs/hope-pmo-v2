import { gatedUser, withApi } from './_lib/auth.js';
import { portalApi } from './_lib/portal-core.js';
import { workspaceFor } from './_lib/workspace.js';

// POST /api/portal   { code, fn, args }
// Every read and write behind the portal (public/app.html) -- one route, one auth check, all
// team scoping enforced server-side inside _lib/portal-core.js (which is where the logic
// lives so the whole surface runs under npm test against a fake PostgREST client).
export default withApi(async (req, res) => {
  if (req.method !== 'POST') { const e = new Error('Method not allowed'); e.status = 405; throw e; }
  const { code, fn, args, workspace } = req.body || {};
  // Identity, the role's tabs merged in, and the admin's open/closed switch -- all three in
  // one place, so a new portal function cannot accidentally be reachable while the system is
  // closed. An admin passes the switch, which is how it ever gets turned back on.
  const user = await gatedUser(code);
  /* WHICH DATABASE, DECIDED ONCE, HERE. Identity is always production -- an admin signs in
     with their real code against the real access_codes table -- and the workspace changes only
     what that identity then reads and writes. Anyone who is not an admin, and every request
     that does not name HOPE Loan outright, resolves to production; see _lib/workspace.js.
     The resolved name is echoed back so the screen can say plainly which book is on it. */
  const ws = workspaceFor(user, workspace);
  const out = await portalApi(ws.db, user, fn, args);
  return { ...out, workspace: ws.workspace };
});
