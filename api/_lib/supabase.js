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
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}
