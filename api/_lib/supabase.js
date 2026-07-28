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
const WAVE = 6;   // pages fetched at once

export async function fetchAll(buildQuery) {
  const first = await buildQuery().range(0, PAGE_SIZE - 1);
  if (first.error) throw first.error;
  let all = first.data || [];
  if (all.length < PAGE_SIZE) return all;    // the common case: one round trip, done

  /* Beyond the first page the old loop fetched page after page ONE AT A TIME, each waiting for
     the last. On a table with 40,000 rows that is forty round trips laid end to end -- and
     every one of them crosses the internet from the serverless function to the database, so the
     wait is dominated by latency rather than by the work. It is why officers were watching a
     spinner: the phone's defaulter list reads the whole follow-up book, and the whole book was
     arriving in single file.

     Pages are independent, so they are fetched in waves instead. Same rows, same order (the
     wave's results are concatenated in the order the pages were requested), a fraction of the
     wall clock. The wave stops at the first short page, which is still the signal that there is
     nothing left. */
  let from = PAGE_SIZE;
  for (;;) {
    const pages = await Promise.all(
      Array.from({ length: WAVE }, (_, i) =>
        buildQuery().range(from + i * PAGE_SIZE, from + (i + 1) * PAGE_SIZE - 1)));
    let done = false;
    for (const p of pages) {
      if (p.error) throw p.error;
      const rows = p.data || [];
      all = all.concat(rows);
      if (rows.length < PAGE_SIZE) done = true;   // this page ran out; later pages are empty
    }
    if (done) return all;
    from += WAVE * PAGE_SIZE;
  }
}
