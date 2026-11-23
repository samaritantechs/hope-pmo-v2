import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

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

/* =====================================================================================
   WHICH BOOK THIS SITE READS -- in a form that is safe to say out loud.

     "reserve our own deployment for now - lets use https://recovery-app.sync-book.net in both
      web and app so that we are sure everything is okay there"

   The same code now runs on two hosts (Vercel, and a server of our own). Whether they are ONE
   system or TWO depends on a single line nobody can see from outside: the database address in
   each host's own settings. Same address, and the two sites are one book -- an officer can use
   either and nothing can diverge. Different addresses, and they are two books that look
   identical on the day one was copied from the other and drift apart from then on, with every
   screen on both of them individually correct and nothing anywhere to say so.

   So each site says which book it reads, as a fingerprint: the first twelve characters of a
   one-way hash of the database HOST. Two sites with the same fingerprint read the same
   database. It is not the address and cannot be turned back into it, it is not a key and opens
   nothing, and it costs no read: it is worked out once from a setting the process already holds.

   /api/app-version carries it (the installed app asks that on every launch already), which is
   what lets the app use its reserve site by itself ONLY while the reserve reads the same book.

   Only the host is hashed, so "https://x.supabase.co" and "https://x.supabase.co/" are one
   book, as they are. Empty when no address is set: a site with no book has no fingerprint. */
export function bookId(url = process.env.SUPABASE_URL) {
  let host = '';
  try { host = new URL(String(url == null ? '' : url).trim()).host.toLowerCase(); } catch { host = ''; }
  if (!host) return '';
  return createHash('sha256').update('hope-pmo book:' + host).digest('hex').slice(0, 12);
}

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
  try { return TRANSIENT.test(String(err.message || err)); }
  catch (_) { return false; }          // a throwable that cannot even be turned into words (a null-prototype object, a toString that throws) is not "briefly unreachable"; it must not turn a retry loop into a second error
}

/* IS THIS FAILURE THE DATABASE BEING BRIEFLY BUSY OR UNREACHABLE -- AND NOTHING ELSE? -- the stand-ins' test, 20 Nov 2026 (handbook Part 126).

   isTransient above answers "is a retry worth making?" and is deliberately loose: it matches words anywhere in a message, so
   `invalid input syntax for type integer: "15022"` (it contains 502), `column "network_id" does not exist` and `permission denied for
   schema "timeouts"` all pass for transient, and a retry costs nothing when it is wrong. The stand-ins of the call app and the call
   boards ask a different question: "may a list that is up to ten minutes old be handed out INSTEAD of reading the table?" Answered
   yes for a fault, it hides the fault for ten minutes under a log line that says the database was busy; the second reader of #767 found
   five such messages that passed, and two real ones (PGRST002, a refused connection) that did not.

   So when the database named the failure (a SQLSTATE or a PostgREST code) the NAME decides: busy are a cancelled statement or a lock
   timeout (57014, 55P03), a deadlock or a serialization failure (40P01, 40001), a server going away or starting (57P01, 57P02, 57P03),
   too few resources such as no connection left (class 53), a connection that failed (08000, 08001, 08003, 08004, 08006, 08007) and
   PostgREST's own "cannot reach the database / the schema cache / the pool" (PGRST000 to PGRST003); every other code is the database
   naming a fault (a bad value 22xxx, a broken constraint 23xxx, a missing column or table or no right 42xxx, a missing function
   PGRST202 ...). Only when there is no such code (the network, a gateway page, a thrown error) are the words read, and then only the
   network and gateway ones, never in a message that is a JavaScript fault of our own ("Cannot read properties of undefined (reading
   'timeout')" is a bug, not a bad moment). Never throws. */
const BUSY_SQLSTATE = /^(57014|57P0[123]|55P03|40001|40P01|53[0-9A-Z]{3}|08(000|001|003|004|006|007))$/;
const BUSY_POSTGREST = /^PGRST00[0-3]$/;
const NAMED_BY_DB = /^([0-9A-Z]{5}|PGRST\d+)$/;
const BUSY_WORDS = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network (error|request failed)|time(d)?[ -]?out|canceling statement|^\s*<!DOCTYPE|\b(502|503|504|522)\b/i;
const JS_FAULT = /^(Cannot (read|set|convert|destructure)\b|.{0,80} is not (a function|defined|iterable|a constructor)|Unexpected (token|end|identifier)|Invalid or unexpected token|Maximum call stack)/i;
export function isBusyFailure(err) {
  try {
    if (!err) return false;
    const code = typeof err === 'object' && typeof err.code === 'string' ? err.code.trim() : '';
    if (NAMED_BY_DB.test(code)) return BUSY_SQLSTATE.test(code) || BUSY_POSTGREST.test(code);
    const message = typeof err === 'string' ? err : (typeof err === 'object' && typeof err.message === 'string' ? err.message : '');
    if (!message && !code) return false;
    return !JS_FAULT.test(message) && BUSY_WORDS.test(code + ' ' + message);
  } catch (_) { return false; }
}

/* HOW OLD A LAST GOOD ANSWER MAY BE when a fresh one cannot be had because the database is briefly
   unreachable (isTransient above) -- ten minutes, 20 Nov 2026 (the Postgres war, handbook Part 123).

   Two small database answers (the call app's called-today numbers, the call boards' week) each
   fall back to the heavy read they replaced when they fail, and the owner's pg_stat_statements
   showed those fall-backs running about as often as the answers: 47% of the listed database time
   in a window of three and a half hours, made exactly when the database was already struggling.
   A failure that is the database being busy or unreachable does not make the last good answer
   wrong, only older; so for up to this long it stands in, and the heavy read is made only when
   there is no good answer at all, when the failure is not of that kind (a function that is not
   installed, one that is refused, one that answers a shape it does not make: those are faults, and
   are answered by the old read as they always were), or when the failure has lasted this long. */
export const STALE_OK_MS = 10 * 60 * 1000;

/** A failure's own words for a log line: its code and its message on one line, cut at 160 characters. A fall-back that swallows
    the reason leaves nobody able to say WHY a small answer failed (handbook Part 123): the pg_stat_statements table cannot,
    because a cancelled statement is not in it. No customer data can be in it: these are the database's own words about a
    function call whose arguments are dates, a number and a list of team names. */
export function errWords(err) {
  if (!err) return 'no error, but an answer of a shape the app does not take';
  try { return ((err.code ? String(err.code) + ' ' : '') + String(err.message || err)).replace(/\s+/g, ' ').slice(0, 160); }
  catch (_) { return 'an error that cannot be read as words'; }          // a log line must never be what fails a list
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


/* =====================================================================================
   A DATABASE FUNCTION IS CAPPED EXACTLY LIKE A TABLE READ, AND NOTHING WAS PAGING IT.

     "i wonder why use sampling in a list that needs them all .. i fear many defaulters havent
      been reached in app followup by now"

   That fear was right, and this is where it came from. fetchAll has always paged past
   PostgREST's silent 1000-row cap for ordinary reads -- it is the first thing this file
   explains. Every `db.rpc(...)` call in the system was a bare single request, and PostgREST
   applies THE SAME CAP to a function that returns a set. No error, no warning: row 1001 onward
   simply is not there.

   The team-day totals function is the one that hurts. A week of defaulter decks is seven days
   times forty teams times seven weekdays times two types -- getting on for four thousand
   summary rows, of which a thousand came back. The weekly report and the dashboard have been
   adding up a truncated set, and the per-team date map built on it silently lost every team
   whose row fell past the cap, which is precisely "a team is in the file but nowhere on the
   screen".

   So RPC gets what table reads have always had. Same page size, same stop condition -- a short
   page means the end -- and the same one-at-a-time discipline, because a wave of concurrent
   pages is what exhausted the connection pool the last time somebody tried it.

   A CLIENT THAT CANNOT PAGE IS STILL ANSWERED. `.range()` exists on the real PostgREST builder;
   anything else gets one plain call rather than an exception.

   THAT CHECK COSTS NOTHING, and it took a failing test to make it so. The first version built a
   throwaway `db.rpc(...)` purely to look for `.range` on it. On the real client that is free --
   nothing is sent until the builder is awaited -- but it is still one more call than the work
   needs, and the speed guards count calls, not awaits. They were right to. So the capability is
   read off the SAME builder the page is about to be sent on: if it cannot range, that builder is
   returned as it stands and its one answer is the whole answer. */
export async function rpcAll(db, fn, args) {
  if (!db || typeof db.rpc !== 'function') return { data: null, error: new Error('no rpc') };

  const out = [];
  /* THE SAME PAGE SIZE fetchAll USES, AND FOR A SHARPER REASON THAN SAVING ROUND TRIPS.

     This paged at a THOUSAND while fetchAll paged at ten, and on a function that is cheap per
     row that is merely slow. On a function whose cost is in an AGGREGATE it is quadratic waste,
     because PostgREST applies the range as LIMIT/OFFSET AROUND the call: page two does not
     resume anything, it RE-EXECUTES THE WHOLE FUNCTION and throws away the first thousand rows.

     Measured on the live book with pg_stat_statements. expected_phone_window -- one `select
     distinct` over a fortnight of expected sheets, which the phone rebuilds its number index
     from -- ran 162,762 times against 30,295 rebuilds. FIVE AND A HALF EXECUTIONS PER REBUILD,
     of a query averaging 1,646 ms, to fetch about 5,400 distinct customers a thousand at a
     time. 267,860 seconds of database time: seventy-four hours, more than every other query
     shape in the book put together, and it sits on the path three hundred handsets sync.

     At ten thousand it is ONE execution. Nothing else about it changes.

     THE CEILING IS LEARNED, NOT ASSUMED, exactly as readPages learns it -- because asking for
     more than the server allows returns a silently truncated page, and reading that truncation
     as "the end" drops every row past it while the totals still look plausible. That is a worse
     failure than a slow read, and it is the one this file already carries scars from. */
  let size = MAX_PAGE;
  for (let from = 0; ; from += size) {
    let paged = true;
    const { data, error } = await runQuery(() => {
      const q = db.rpc(fn, args);
      if (q && typeof q.range === 'function') return q.range(from, from + size - 1);
      paged = false;                       // a client that cannot page: this one call is it
      return q;
    });
    if (!paged) return { data, error };
    if (error) return { data: null, error };
    const page = Array.isArray(data) ? data : [];
    out.push(...page);
    if (page.length < size) {
      /* A short page is normally the end. One that stops on a ROUND number when we asked for
         more is more likely a server ceiling: shrink to what arrived and keep going. If it
         really was the end, the next request comes back empty and costs one round trip. */
      if (!LIKELY_CAPS.has(page.length)) break;
      size = page.length;
    }
    /* The same guard fetchAll has. A function that never returns a short page would otherwise
       spin forever; stopping loudly beats a request that never ends. */
    if (out.length > 500000) throw new Error(`${fn} returned more than 500,000 rows -- refusing to keep paging`);
  }
  return { data: out, error: null };
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

/* =====================================================================================
   A PAGED READ NEEDS A TOTAL ORDER, OR THE PAGES DO NOT FIT TOGETHER.
   =====================================================================================
   Reported from the field, and it is the most corrosive kind of bug there is:

     "The dashboard reads different stats after every visit or refresh without even any
      update being uploaded."

   Nothing was being uploaded and nothing was random in our arithmetic. The randomness was in
   the DATABASE, and it is documented behaviour rather than a fault.

   `offset`/`limit` slice a result set by POSITION. Postgres only promises a position when the
   query says ORDER BY -- without one it is free to hand rows back in whatever order the plan
   happens to produce, and that order is not stable between two separate statements. It is
   least stable on exactly the tables this matters for: `synchronize_seqscans` is on by default,
   so a sequential scan over a big table starts wherever another scan already in flight has got
   to, and finishes by wrapping round. Two users refreshing at once therefore get two DIFFERENT
   orderings of the same unchanged rows.

   Page 1 is then rows 0-9,999 of one ordering and page 2 is rows 10,000-19,999 of a different
   one. Some customers arrive twice and others not at all -- so the total moves every refresh,
   by a plausible-looking amount, with no error anywhere and nothing in the data to blame. It
   also explains the shape of the complaint that came with it: figures that look "abnormal"
   rather than obviously broken.

   The fix is to give every paged read a tiebreaker on a column that is UNIQUE, which pins the
   ordering down completely. It is added AFTER whatever the caller already ordered by, so the
   caller's own sort still decides and this only settles the ties -- which is the only place
   the ambiguity ever was.

   COST. Sorting is not free, but it is small next to what these reads already do: a sort of ten
   thousand rows costs a few milliseconds, against the tens of milliseconds it takes merely to
   serialise them and put them on the wire. Where the tiebreaker is the primary key, Postgres can
   often walk the index and not sort at all.

   IF THE SERVER WILL NOT ACCEPT THE ORDER -- an un-migrated table that has no `id` yet, a view,
   a column renamed -- the read falls back to exactly what it did before: unordered, one page at
   a time. A tiebreaker that cannot be applied must never turn a working screen into an error. */

/* Tables whose primary key is not called `id`. Everything else that is big enough to page has
   one that is, so `id` is the default rather than a guess.

   A VALUE MAY BE SEVERAL COLUMNS, because two tables here have no single unique column at all
   -- and the "no `id`, so fall back" path below turned out to be a good deal more expensive
   than "falls back". Every read of those two sent Postgres an `order=id.asc` it can only
   REJECT: PostgREST answers 400, Postgres LOGS AN ERROR, and only then does the plain read go
   out. Two round trips instead of one, and a line in the error log, on the deck-totals cache
   -- which is asked on every totals question in the system, the phone's summary strip
   included. On a Supabase report that reads as twelve thousand Postgres errors a day against
   thirteen thousand Postgres requests, and it is the single loudest thing in this book.

   So the fallback stays for a table nobody predicted, and the two we KNOW have no `id` name
   their real keys instead of discovering it the expensive way, once per read, for ever.

     deck_totals_days   its declared primary key (kind, snapshot_date) -- RUN-ME-022.
     deck_totals        no primary key at all, but the build writes exactly one row per this
                        tuple: it is what expected_snapshot_totals / defaulter_snapshot_totals
                        GROUP BY, so two rows can never share it.

   Unique is the whole point -- see the note above on what an ambiguous order does to a paged
   read -- so a partial key here would be worse than none. */
export const PAGE_KEY = {
  teams: 'team',
  access_codes: 'code',
  roles: 'role',
  settings: 'key',
  followup_status: 'ref',
  call_users: 'user_id',
  call_agents: 'user_id',
  deck_totals_days: ['kind', 'snapshot_date'],
  deck_totals: ['kind', 'snapshot_date', 'snapshot_type', 'weekday', 'team', 'upload_batch'],
  // Two more that fell into the same hole after this map was written: each was added by its
  // own later migration (device register, imprest) and nobody carried it in here, so every
  // fetchAll of them has been paying the SAME error-storm cost this map exists to stop --
  // devices most of all, since byToken() reads it on every handset's heartbeat.
  devices: 'imei',
  imprest_roles: 'role',
  // The notice payment ledger (RUN-ME-041a) keys on (notice, payment): the same payment sits
  // under every notice a customer was served, so no single column is unique.
  notice_payment_ledger: ['ref', 'since', 'payment_id'],
  // Where each customer and guarantor is (RUN-ME-2026-10-19): one row per customer (docket key) and party.
  customer_locations: ['docket_key', 'party'],
  // The Annual Rep tab's two tables (RUN-ME-049a, RUN-ME-050). Neither has an `id`; each is unique
  // on its declared primary key, so each read pages on that and never sends the order=id Postgres
  // can only reject. team_months: one row per team and month. team_holders: one row per team, role
  // and start day.
  team_months: ['team', 'ym'],
  team_holders: ['team', 'role', 'from_date'],
  // hints is NOT here on purpose. Its table once read `tab text primary key` (still schema.sql's
  // own text, which is stale for this one) -- but db/migrations/2026-07-27-hints-many-per-tab.sql
  // dropped that and gave it `id` instead, because tab was never really unique: many tips
  // rotate under one tab, and the upsert that loads a tip sheet needs a key that isn't shared
  // by a dozen rows. The default already answers 'id' correctly; naming tab here would be
  // WORSE than the gap this map exists to close, ordering by a column real rows repeat.
};

/** The table a built query points at, read off the URL PostgREST is about to be asked for.
    Taken from the query rather than passed in by a hundred call sites: a parameter that has to
    be remembered at every read is a parameter that will be forgotten at one of them, and a
    forgotten one here is silent. */
function tableOf(q) {
  try {
    const path = q && q.url && q.url.pathname;
    if (!path) return null;
    const name = String(path).split('/').filter(Boolean).pop();
    return name || null;
  } catch { return null; }
}

/** The unique column -- or columns -- that settle the order for this query, or null if we
    cannot tell which table it reads, in which case nothing is added and the read behaves as it
    always did. A string for the ordinary single-column case; an array where it takes more than
    one column to be unique. */
export function pageKeyFor(q) {
  const t = tableOf(q);
  if (!t) return null;
  return Object.prototype.hasOwnProperty.call(PAGE_KEY, t) ? PAGE_KEY[t] : 'id';
}
/** The key as a list, whichever shape it was written in. One place, so the two callers below
    cannot disagree about what a multi-column key means. */
const keyCols = k => (k == null ? [] : Array.isArray(k) ? k : [k]);

/** `state.key` is decided from the FIRST query this builds and remembered for the rest of the
    read -- deliberately not by building a throwaway query to look at, because a caller counting
    how many times it is asked for a table would then see one extra per read, and one of them
    does exactly that to prove the widget is riding on the cache rather than the book.
    Pass state.key = null to force the plain, unordered read this always used to do. */
async function readPages(buildQuery, state) {
  const all = [];
  let from = 0;
  // Deliberately NOT remembered between reads. A filtered query that legitimately returns
  // exactly a round number would otherwise pin every later read to that size for the life of
  // the process -- a wrong guess that quietly slows everything and is invisible. One optimistic
  // request per read is a cheap price for not carrying a mistake around.
  let size = MAX_PAGE;
  while (true) {
    const { data, error } = await runQuery(() => {
      const q = buildQuery();
      if (state.key === undefined) state.key = pageKeyFor(q);
      // Added in order, after whatever the caller already sorted by, so the caller's own sort
      // still decides and these only settle the ties.
      let out = q;
      for (const c of keyCols(state.key)) out = out.order(c, { ascending: true });
      return out.range(from, from + size - 1);
    });
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

export async function fetchAll(buildQuery) {
  const state = { key: undefined };
  try {
    return await readPages(buildQuery, state);
  } catch (e) {
    /* A database that is unreachable is not a bad column name, and pretending otherwise would
       hide an outage behind a second doomed attempt. Nor is there anything to retry if no
       tiebreaker was applied in the first place -- that read already failed on its own terms.
       Only a refusal of the ORDER is worth a second, plainer attempt. */
    if (isTransient(e) || !keyCols(state.key).length) throw e;
    return readPages(buildQuery, { key: null });
  }
}
