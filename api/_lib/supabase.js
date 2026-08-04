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

export const PAGE_SIZE = 1000;   // kept for the callers that still name it

/** A hosted database is not always there. When Supabase is overloaded, restarting, or its
    edge cannot reach it, the answer is not data and not a normal error -- it is a gateway
    timeout, often a whole HTML error page. Every screen then failed at once and the system
    looked broken when it was only briefly unreachable.

    One immediate retry, then one more after a short pause, rides out exactly that. It is
    deliberately small: a hammering retry on a database that is already struggling makes it
    worse, which is the same mistake as fetching pages six at a time. */
/* `canceling statement` is Postgres itself giving up on ONE statement that outran its timeout.
   It is named explicitly rather than left to match on the word "timeout", because it is the
   failure a slow database produces most often and it is worth being able to see it in this
   list. Retrying it is safe: a cancelled statement is rolled back whole, so it wrote nothing. */
const TRANSIENT = /timeout|timed out|canceling statement|fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|502|503|504|522|<!DOCTYPE/i;

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
/* FEWER, BIGGER PAGES -- not more of them at once.

   Asking for a thousand rows at a time meant thirty separate journeys to the database for one
   snapshot of thirty thousand customers, each one a full HTTPS round trip from Vercel. The
   dashboard needed 567 of them. At 150ms apiece that is eighty-five seconds of waiting before
   a single figure is worked out, and the platform gives up at sixty.

   The fix is NOT to fire them in parallel -- that was tried and it took the whole system down
   (see above). It is to make each journey carry more. Ten thousand rows in one request costs
   barely more than one thousand: the same round trip, a bigger body.

   PostgREST may be configured with a lower ceiling than we ask for, and it enforces it
   SILENTLY -- a truncated page with no error, which is what once made two different tables
   both report exactly 1000. So the ceiling is LEARNED rather than assumed: if the first page
   comes back at a round number below what was asked for, that number becomes the page size for
   the rest of this read, and paging continues correctly from there. Asking for more than the
   server allows is therefore safe, and asking for less than it allows is just slow. */
export const MAX_PAGE = 10000;
/* The numbers a person actually types into a server's row limit. Matching any multiple of 500
   was too eager -- a table holding exactly 4,500 rows is a normal table, not a truncated one,
   and paying an extra round trip for it on every read is a tax on being ordinary. */
const LIKELY_CAPS = new Set([1000, 2000, 5000, 10000, 20000, 25000, 50000, 100000]);

export async function fetchAll(buildQuery) {
  const all = [];
  let from = 0;
  // Deliberately NOT remembered between reads. A filtered query that legitimately returns
  // exactly a round number would otherwise pin every later read to that size for the life of
  // the process -- a wrong guess that quietly slows everything and is invisible. One optimistic
  // request per read is a cheap price for not carrying a mistake around.
  let size = MAX_PAGE;
  while (true) {
    const { data, error } = await runQuery(() => buildQuery().range(from, from + size - 1));
    if (error) throw error;
    const got = data ? data.length : 0;
    for (const r of (data || [])) all.push(r);

    if (got < size) {
      /* A short page normally means the end. But a page that stops on a round number, when we
         asked for more, is more likely a server ceiling -- and treating a ceiling as the end
         drops every row past it while the totals still look plausible, which is the worst way
         for this to fail. So: shrink to what arrived and keep going. If it really was the end,
         the next request comes back empty and costs one round trip. */
      if (!LIKELY_CAPS.has(got)) break;
      size = got;
    }
    from += size;
  }
  return all;
}
