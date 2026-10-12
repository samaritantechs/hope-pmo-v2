# HOPE PMO — the rules this repository is worked to

## 1. UPLOADING AND THE CALL APP NEVER GO DOWN, AND NEVER SLOW DOWN

> "Throughout our development even if we handle anything or run on limits: UPLOADING and CALL
> APP should NEVER GO DOWN neither SLOW DOWN"

This is not a preference and it does not get traded against anything. Three hundred officers
work the call app all day and the day's decks have to land. Everything else in this system —
the portal, the dashboard, every report, every board — is a screen somebody can come back to in
five minutes. Those two are not.

**What that means in practice, before any change ships:**

- **Count the reads a change adds to `/api/upload` and `/api/call`.** If a change adds one,
  it needs a reason written down beside it. If it adds one to a path that runs per handset or
  per upload slice, it is almost certainly wrong.
- **Nothing new goes in the upload request that is not the write itself.** Housekeeping after
  the write runs on the clock in `api/upload.js` (`UPLOAD_BUDGET_MS`), is skipped when there is
  not enough time to start, and is abandoned rather than allowed to run out the host's sixty
  seconds. An upload that completed and then reported HTTP 504 is the worst outcome there is:
  the data is in, the person at the keyboard does not know, and they upload it again.
- **A slow database is not an excuse to slow these two down; it is a reason to ask it for
  less.** Budgets and fallbacks come first, in the same change, never afterwards.
- **`test/speed.test.mjs` is the enforcement.** Every phone screen has a round-trip and a row
  budget, and they are a ceiling, not a target. Raising one is allowed only in the same commit
  as the change that needs it, with the reason in the diff. Ask "can the database do this
  instead of me?" before touching a number.
- **Deploy heavy work in the evening**, and never during the morning collection round.

## 2. Everything else, briefly

- **No build step.** `public/*.html` is served exactly as written. `var BUILD` in
  `public/app.html` is the version; bump it on every front-end change. `/api/me` reports it and
  a page older than the server reloads itself past the cache.
- **The portal opens light.** Screens that do not pivot results (imprest, advances, legal
  demands, deductions, devices, Teams & Staff, Settings, the bonus plan, the deck, HOPE Loan)
  and the report screens (month report, trend, PAR, audit report, commission, calls, credit,
  Best of, audit log, locations) live in `public/mod/*.js` and load the first time their tab
  opens (`modLoad_`, `MOD_OF` in `app.html`). The core keeps the working screens: dashboard,
  applications, expected, follow-up, promises, the weekly book, complaints, restructuring. A
  new screen goes in a module unless it is one of those; a module change needs the `BUILD`
  bump too, since the loader fetches `/mod/<name>.js?v=BUILD`.
- **Migrations are run by hand** in the Supabase SQL editor (`db/RUN-ME-*.sql`). Every code
  path that depends on one must work without it — fall back, never fail. The SQL editor sends
  a whole script as ONE statement, so a timeout anywhere in a file rolls back all of it: keep
  the slow parts on their own line and say so in the file.
- **One definition of a rule, in one place.** Two implementations of "which upload wins", or of
  "which day an application belongs to", are two answers that can disagree — and a drift there
  silently doubles or halves a figure nobody can account for.
- **Team scoping happens at the database.** A filter applied after the rows arrive is not a
  filter, it is a download.
- **`.in()` and `.eq()` are exact-case.** See `teamMatchList` in `api/_lib/snapshots.js` and
  `roleTabsOf` in `api/_lib/auth.js` for the two blackouts this has already caused.
- **Say what was not done.** A step that was skipped, deferred, or could not be reached is
  reported on the screen that expected it. Silence reads as success.
