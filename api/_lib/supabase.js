import { createClient } from '@supabase/supabase-js';

// Server-side client for API routes -- uses the service role key so it can enforce your
// OWN access-code permission logic (below) rather than relying on Postgres RLS policies.
// This matches how Code.gs works today (auth_() checks a code against the Access sheet,
// then the rest of the function trusts that check) -- same model, new engine.
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const PAGE_SIZE = 1000;

/** A hosted database is not always there. When Supabase is overloaded, restarting, or its
    edge cannot reach it, the answer is not data and not a normal error -- it is a gateway
    timeout, often a whole HTML error page. Every screen then failed at once and the system
    looked broken when it was only briefly unreachable.

    One immediate retry, then one more after a short pause, rides out exactly that. It is
    deliberately small: a hammering retry on a database that is already struggling makes it
    worse, which is the same mistake as fetching pages six at a time. */
const TRANSIENT = /timeout|timed out|fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|502|503|504|522|<!DOCTYPE/i;

export function isTransient(err) {
  if (!err) return false;
  const m = String(err.message || err);
  return TRANSIENT.test(m);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Runs a query, retrying only failures that look like the database being briefly unreachable.
    A real error -- bad column, permission, constraint -- is returned immediately, because
    retrying it would only delay the truth. */
export async function runQuery(build, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    let res;
    try { res = await build(); }
    catch (e) { res = { data: null, error: e }; }        // fetch itself threw
    if (!res.error) return res;
    last = res.error;
    if (!isTransient(last) || i === tries - 1) return res;
    await sleep(i === 0 ? 250 : 1200);
  }
  return { data: null, error: last };
}

/** The message a PERSON should see when the database is unreachable. Supabase's edge answers
    with an HTML error page, and printing that verbatim is how a 522 ended up on screen as a
    wall of markup. */
export function friendlyDbError(err) {
  const raw = String((err && err.message) || err || '');
  if (isTransient(err) || raw.length > 200 || raw.indexOf('<') === 0) {
    return 'Mfumo wa kumbukumbu haupatikani kwa dakika hii. Subiri sekunde chache ujaribu tena. '
         + '/ The database is briefly unreachable — wait a few seconds and try again.';
  }
  return raw;
}


/** Supabase/PostgREST caps any single query at 1000 rows by default -- silently, no error, just
    a truncated result. This is exactly what made two different tables both report precisely
    1000 on the dashboard regardless of their real row counts. Fetches ALL matching rows by
    paginating with .range() until a page comes back short of a full page (the sign nothing's
    left). Takes a function that BUILDS the query, not a query object -- .range() needs to apply
    to a fresh copy each page, not a query that's already been sent. */
/** Pages until a short page arrives -- ONE PAGE AT A TIME, deliberately.

    A wave of six concurrent page requests was tried and reverted the same day. It made each
    individual read finish sooner, but every screen fires several of these at once, and with
    200+ users on a live system the multiplied concurrency exhausted the database's connection
    pool: logins started failing with "failed to fetch", Settings would not open, and the
    data-heavy tabs errored. Latency per read is a smaller problem than the whole system
    falling over, so this stays sequential.

    The real fix for a slow read is to ask for FEWER ROWS AND FEWER COLUMNS, which is what the
    narrowed selects do -- not to ask for the same excess faster. */
export async function fetchAll(buildQuery) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await runQuery(() => buildQuery().range(from, from + PAGE_SIZE - 1));
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}
