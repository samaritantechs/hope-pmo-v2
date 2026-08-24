import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase.js';
import { LOAN_TABS } from './auth.js';

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

     THE DATA NEVER MIXES     -- because HOPE Loan's tables live in their OWN NAMED SCHEMA,
                                `hopeloan`, and which schema a request talks to is decided ONCE,
                                here, from the signed-in role. A query cannot choose its own
                                schema. There is no filter to forget, no WHERE clause that could
                                be left off at two in the morning: the sandbox is not hidden
                                from an officer, it is unreachable -- an officer's client is
                                never even pointed at it.

   TWO WAYS TO HOST THE SCHEMA, BOTH USING THE SAME SQL AND THE SAME CODE HERE:

     SCHEMA MODE (free) -- `hopeloan` lives inside the SAME Supabase project as production, as
       a second schema next to `public`. One project, one bill, and Postgres itself keeps the
       two apart: a client scoped to `public` cannot see `hopeloan.customers` any more than it
       can see a table in a different database. This is the default once HOPELOAN_ENABLED is
       set, and it is what "the free path, start there" means in practice.

     PROJECT MODE (paid) -- `hopeloan` lives inside a SEPARATE Supabase project, reached with
       its own URL and service key. Strictly stronger isolation -- a different server, not just
       a different namespace on the same one -- for whenever that becomes worth the ten dollars
       a month. THE SCHEMA NAME IS STILL `hopeloan` EVEN THERE, so every file in db/hopeloan/
       runs unmodified in either mode; only which project's credentials get used changes.

   Excel terms, since that is how this was described: this is not a filtered VIEW of the same
   sheet, where a wrong pivot could show live rows. It is a SEPARATE SHEET in the same
   workbook -- its own tables, its own primary keys, its own space -- that a formula on the
   first sheet cannot reach by accident. Nothing here ever writes production data because
   nothing here ever HOLDS a production connection while working in the sandbox.

   WHY THIS FILE IS SO SMALL. Every function in portal-core takes `db` as its first argument --
   which is how the whole surface runs against a fake client under `npm test`. Routing to a
   second schema is therefore a decision at the door, not a change to five thousand lines.
   The injection was already there; this only chooses what to inject.

   IDENTITY IS ALWAYS PRODUCTION. An admin signs in with their real access code against the
   real access_codes table, in `public`, and the workspace changes only what data that identity
   then reads and writes. One set of credentials, one place to revoke them. A second copy of
   the access codes living in a sandbox is a second copy that can be forgotten when somebody
   leaves.

   FAILING SAFE. With nothing configured, hopeLoanConfigured() is false, the switch is never
   offered, and every request resolves to production. A half-set-up deployment does not get a
   half-working sandbox -- it gets HOPE PMO exactly as it is today. */

export const HOPEPMO = 'hopepmo';
export const HOPELOAN = 'hopeloan';
export const WORKSPACES = [HOPEPMO, HOPELOAN];

/** Which of the two hosting modes is configured, or null if neither is. Read from the
    environment on every call rather than captured at import: a serverless instance may be
    reused across a deployment that added the variables, and a stale answer would leave the
    switch missing with no way to tell why.

    PROJECT wins if both are set, because it is the strictly stronger isolation -- a deployment
    that has graduated to its own project should not keep quietly running on a schema in the
    shared one just because that variable was never removed. */
function hopeLoanMode() {
  if (process.env.HOPELOAN_SUPABASE_URL && process.env.HOPELOAN_SERVICE_ROLE_KEY) return 'project';
  /* SCHEMA MODE NEEDS NO VARIABLE. Running the SQL IS the configuration -- an environment flag
     on top of it was a second switch saying the same thing, and a second switch is a second
     thing to be missing when somebody cannot find why the door will not open ("i cant find
     HOPELOAN_ENABLED"). The client is buildable from the production credentials whenever they
     exist; whether the schema is actually THERE is answered by asking it, in hopeLoanReady().

     HOPELOAN_ENABLED still works if it is set -- it just short-circuits the probe rather than
     being required. Setting it to an explicit "no" turns the sandbox off outright, which is
     the one thing an environment variable is still genuinely useful for here. */
  if (process.env.HOPELOAN_ENABLED !== undefined && !readsAsEnabled(process.env.HOPELOAN_ENABLED)) return null;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return 'schema';
  return null;
}

/* HAS THE SQL BEEN RUN? Cached, because the answer changes once in the life of a deployment
   and this is asked on every sign-in. A failed probe is cached for a SHORTER time than a
   successful one: the failing case is the one somebody is actively fixing by running the
   migration, and making them wait a full minute to see it work is its own small cruelty. */
let probe = { at: 0, ok: false };
const PROBE_OK_TTL = 300000;    // 5 minutes -- a schema that exists does not stop existing
const PROBE_FAIL_TTL = 15000;   // 15 seconds -- somebody may be running the SQL right now

/** True once HOPE Loan is actually reachable: project mode trusts its own configuration, and
    schema mode ASKS the database whether `hopeloan` is there and exposed to PostgREST. That is
    the honest test -- the switch should appear exactly when it will work, and not before. */
export async function hopeLoanReady() {
  const mode = hopeLoanMode();
  if (!mode) return false;
  if (mode === 'project') return true;
  if (readsAsEnabled(process.env.HOPELOAN_ENABLED)) return true;   // explicitly on: skip the probe

  const now = Date.now();
  const ttl = probe.ok ? PROBE_OK_TTL : PROBE_FAIL_TTL;
  if (now - probe.at < ttl) return probe.ok;

  const db = hopeLoanDb();
  if (!db) { probe = { at: now, ok: false, why: 'no client could be built' }; return false; }
  try {
    /* The cheapest possible question: one row, one column, from the settings row
       RUN-ME-001-origination.sql writes. If the schema is missing, or exists but PostgREST was
       never told to expose it, this errors -- and BOTH of those mean "not ready", which is
       exactly the distinction the switch needs to make. */
    const { error } = await db.from('settings').select('key').eq('key', 'WORKSPACE').limit(1);
    /* THE REASON IS KEPT, NOT THROWN AWAY. Swallowing it made the failure unreadable: the
       schema was installed and correct, the switch still would not appear, and there was no way
       from outside to tell whether PostgREST had not been told about the schema, had not
       reloaded its config, or was refusing for some third reason. Hours went into guessing at
       what one error string would have said outright. */
    probe = { at: now, ok: !error, why: error ? (error.message || String(error)) : null };
  } catch (e) {
    probe = { at: now, ok: false, why: (e && e.message) || String(e) };
  }
  return probe.ok;
}

/** Why the last probe failed, for the message shown to whoever asked. Null when it succeeded
    or has not run. Never shown to a non-admin -- see the callers. */
export function hopeLoanNotReadyReason() { return probe.ok ? null : probe.why; }

/** Forget the probe -- for tests, and for anything that has just run a migration. */
export function clearHopeLoanProbe() { probe = { at: 0, ok: false, why: null }; }

/** True for a value that plainly says yes, same reading as the system-open switch: anything
    else -- unset, blank, 'no', junk -- is off, because a sandbox nobody turned on is a sandbox
    nobody meant to expose. */
function readsAsEnabled(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function hopeLoanConfigured() {
  return hopeLoanMode() !== null;
}

/** Which hosting mode is live, for a status screen -- never for a security decision. Returns
    'project', 'schema', or null. */
export function hopeLoanMode_forDisplay() {
  return hopeLoanMode();
}

/* Built once and kept, exactly like the production client -- a new client per request would
   open a new connection pool per request, which is the mistake that took the system down when
   paged reads were fired six at a time. Keyed on the values that decide its identity, so a
   changed environment variable produces a fresh client rather than silently reusing the old
   one's connection. */
let cached = null;
function hopeLoanDb() {
  const mode = hopeLoanMode();
  if (mode === 'project') {
    const url = process.env.HOPELOAN_SUPABASE_URL;
    const key = process.env.HOPELOAN_SERVICE_ROLE_KEY;
    if (!cached || cached.mode !== 'project' || cached.url !== url || cached.key !== key) {
      cached = { mode, url, key,
        client: createClient(url, key, { auth: { persistSession: false }, db: { schema: 'hopeloan' } }) };
    }
    return cached.client;
  }
  if (mode === 'schema') {
    // The SAME project, the SAME credentials as production -- only the schema differs, and it
    // is set on the CLIENT, not per query, so nothing built on this client can ever be pointed
    // at `public` by a query that forgot to say otherwise.
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!cached || cached.mode !== 'schema' || cached.url !== url || cached.key !== key) {
      cached = { mode, url, key,
        client: createClient(url, key, { auth: { persistSession: false }, db: { schema: 'hopeloan' } }) };
    }
    return cached.client;
  }
  return null;
}

/** Production is left by an ADMIN, or by a code holding at least one of HOPE Loan's own tabs --
    "i mean they cant reach tabs i didnt tick for anyone to see yet". The gate used to be the
    ROLE STRING alone, on the reasoning that a tab is editable in Teams & Staff and a role
    someone ticked the wrong box on must never become a door into a second schema. That still
    holds -- what changed is which tabs count as "the wrong box": a code that has never been
    ticked for customer_service/manager/team/gmo/credit/finance/gm has no more access to
    `hopeloan` than before, exactly as a code with no `upload` tab still cannot reach Upload.
    The checkbox IS the permission now, same as everywhere else -- one mechanism for who may
    do what, not two, and "someone does something b/se they have access to the panel not that
    we match the role" applies here too. `user.tabs` is the RESOLVED list (see
    authCodeResolved/resolveTabs in auth.js) -- a role's own tabs already merged in, so a code
    reaches HOPE Loan by role OR by its own ticked tabs, same as every other tab check. */
function mayUseHopeLoan(user) {
  if (String((user && user.role) || '').trim().toUpperCase() === 'ADMIN') return true;
  const tabs = (user && user.tabs) || [];
  return LOAN_TABS.some(t => tabs.includes(t));
}

/** Which workspace this request runs in. The ONLY function that may answer this question.

    Anything other than a plain, configured, tab-authorised request for HOPE Loan resolves to
    production -- an unknown name, a blank, a field officer asking for the sandbox, an admin or
    tab-holder asking before the environment is configured. There is no error for asking
    wrongly, because an error would be a way to discover that the sandbox exists; the request
    simply runs where it always ran. */
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
    figure as if it were the book.

    IT ASKS THE PROBE, and that is the whole point of it being async.

    TWO GATES DISAGREEING IS WHAT PRODUCED "its in app but ends at trying". The switch shown at
    sign-in was gated on hopeLoanReady() -- a real question to the database -- while routing a
    request was gated on hopeLoanConfigured(), which only asks whether credentials exist. So a
    deployment whose schema was missing or not exposed to PostgREST hid the button in the
    portal (correct) and still ROUTED the call app into the sandbox (wrong), where every query
    failed against a schema that could not answer, leaving the phone sitting on "trying…"
    forever with a red SANDBOX banner it had painted optimistically.

    One question, asked in one place, and a request for a sandbox that is not ready now returns
    `ready: false` so the caller can say so in words instead of hanging. */
export async function workspaceFor(user, asked) {
  const workspace = resolveWorkspace(user, asked);
  if (workspace !== HOPELOAN) {
    return { workspace: HOPEPMO, db: supabase, sandbox: false, ready: true };
  }
  const ready = await hopeLoanReady();
  if (!ready) {
    /* NOT READY MEANS PRODUCTION, never a broken sandbox. The caller is told plainly rather
       than being handed a client whose every query will fail -- silence here is what made this
       look like a hang instead of a missing migration. */
    return { workspace: HOPEPMO, db: supabase, sandbox: false, ready: false };
  }
  return { workspace: HOPELOAN, db: dbFor(HOPELOAN), sandbox: true, ready: true };
}

/** The reason a sandbox request could not be honoured, in words a person can act on. Only ever
    shown to somebody who was entitled to ask -- an officer never gets here. */
export const HOPELOAN_NOT_READY =
  'HOPE Loan haipo bado / HOPE Loan is not ready on this deployment. '
  + 'Run db/hopeloan/RUN-ME-000-create-schema.sql and RUN-ME-001-origination.sql, and make sure '
  + '`hopeloan` is listed under Project Settings -> API -> Exposed schemas.';

/** The same message WITH the database's own words appended. The generic sentence lists three
    possible causes; this says which one actually happened, which is the difference between
    fixing it and guessing at it. Only ever reached by an admin who asked for the sandbox. */
export function hopeLoanNotReadyMessage() {
  const why = hopeLoanNotReadyReason();
  return why ? HOPELOAN_NOT_READY + ' -- the database said: ' + why : HOPELOAN_NOT_READY;
}

/** Whether HOPE Loan's own nav items belong in this code's sidebar at all, for /api/me. A code
    holding none of HOPE Loan's tabs (and not ADMIN) is never told the sandbox exists -- same
    name, same job it always had, now answering a tab question instead of a role question; see
    mayUseHopeLoan.

    ASYNC NOW, because "is it configured" became "is it actually there" -- see hopeLoanReady().
    The probe is cached, so this costs a round trip roughly once every five minutes across the
    whole deployment rather than once per sign-in. */
export async function canSwitchWorkspace(user) {
  if (!mayUseHopeLoan(user)) return false;
  return hopeLoanReady();
}
