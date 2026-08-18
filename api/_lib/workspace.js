import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase.js';

/* =====================================================================================
   TWO DATABASES, ONE CODEBASE.
   =====================================================================================

   HOPE Loan is the origination half of this system being built while HOPE PMO carries three
   hundred officers and a three-billion-shilling book on the same deployment. The requirement
   that shaped everything here:

     "you must guarantee me all systems will get updated and you wont mixup the data until the
      day we discuss merges"

   Those are two promises pulling opposite ways, and they are kept by splitting them apart:

     ALL SYSTEMS GET UPDATED  -- because there is ONE codebase. A fix to HOPE PMO is in HOPE
                                Loan the moment it merges; there is no second copy to port it
                                to and nothing that can be missing from one and present in the
                                other. That is why this is not a separate repository.

     THE DATA NEVER MIXES     -- because there are TWO DATABASES, and which one a request talks
                                to is decided ONCE, here, from the signed-in role. A query
                                cannot choose its own database. There is no filter to forget,
                                no WHERE clause that could be left off at two in the morning:
                                the sandbox is not hidden from an officer, it is unreachable.

   WHY THIS FILE IS SO SMALL. Every function in portal-core takes `db` as its first argument --
   which is how the whole surface runs against a fake client under `npm test`. Routing to a
   second database is therefore a decision at the door, not a change to five thousand lines.
   The injection was already there; this only chooses what to inject.

   IDENTITY IS ALWAYS PRODUCTION. An admin signs in with their real access code against the
   real access_codes table, and the workspace changes only what data that identity then reads
   and writes. One set of credentials, one place to revoke them. A second copy of the access
   codes living in a sandbox is a second copy that can be forgotten when somebody leaves.

   FAILING SAFE. With no HOPELOAN_* environment variables configured, hopeLoanConfigured() is
   false, the switch is never offered, and every request resolves to production. A half-set-up
   deployment does not get a half-working sandbox -- it gets HOPE PMO exactly as it is today. */

export const HOPEPMO = 'hopepmo';
export const HOPELOAN = 'hopeloan';
export const WORKSPACES = [HOPEPMO, HOPELOAN];

/** True once the second Supabase project's URL and service key are both set. Read from the
    environment on every call rather than captured at import: a serverless instance may be
    reused across a deployment that added them, and a stale `false` would leave the switch
    missing with no way to tell why. */
export function hopeLoanConfigured() {
  return !!(process.env.HOPELOAN_SUPABASE_URL && process.env.HOPELOAN_SERVICE_ROLE_KEY);
}

/* Built once and kept, exactly like the production client -- a new client per request would
   open a new connection pool per request, which is the mistake that took the system down when
   paged reads were fired six at a time. Keyed by URL so that a changed environment variable
   produces a new client rather than silently reusing the old project's connection. */
let cached = null;
function hopeLoanDb() {
  const url = process.env.HOPELOAN_SUPABASE_URL;
  const key = process.env.HOPELOAN_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!cached || cached.url !== url) {
    cached = { url, client: createClient(url, key, { auth: { persistSession: false } }) };
  }
  return cached.client;
}

/** Only an ADMIN may leave production. Deliberately checked on the ROLE STRING rather than on
    a tab or a permission: tabs are editable in Teams & Staff, and a role that someone ticked
    the wrong box on must never become a door into a second database. */
function mayUseHopeLoan(user) {
  return String((user && user.role) || '').trim().toUpperCase() === 'ADMIN';
}

/** Which workspace this request runs in. The ONLY function that may answer this question.

    Anything other than a plain, configured, admin-authorised request for HOPE Loan resolves to
    production -- an unknown name, a blank, a field officer asking for the sandbox, an admin
    asking before the environment is configured. There is no error for asking wrongly, because
    an error would be a way to discover that the sandbox exists; the request simply runs where
    it always ran. */
export function resolveWorkspace(user, asked) {
  const want = String(asked == null ? '' : asked).trim().toLowerCase();
  if (want !== HOPELOAN) return HOPEPMO;
  if (!mayUseHopeLoan(user)) return HOPEPMO;
  if (!hopeLoanConfigured()) return HOPEPMO;
  return HOPELOAN;
}

/** The database client for a resolved workspace name. Falls back to production for any name it
    does not recognise, so a caller that skipped resolveWorkspace cannot reach the sandbox by
    passing a string through. */
export function dbFor(workspace) {
  if (workspace !== HOPELOAN) return supabase;
  return hopeLoanDb() || supabase;
}

/** Resolve and connect in one step -- what a route actually wants. Returns the name alongside
    the client so the answer can be echoed back to the screen: a person working in a sandbox
    must be able to see at a glance that they are, or they will eventually report a sandbox
    figure as if it were the book. */
export function workspaceFor(user, asked) {
  const workspace = resolveWorkspace(user, asked);
  return { workspace, db: dbFor(workspace), sandbox: workspace === HOPELOAN };
}

/** Whether to offer the switch at all, for /api/me. An officer is never told it exists. */
export function canSwitchWorkspace(user) {
  return mayUseHopeLoan(user) && hopeLoanConfigured();
}
