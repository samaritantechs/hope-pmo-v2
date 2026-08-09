# HOPE PMO v2 — Supabase + Vercel foundation

> **New here? Read [START-HERE.md](START-HERE.md) first** — it is the map to everything else.
> Running the system day to day: **[OPERATIONS.md](OPERATIONS.md)**.
> Looking for the file that does something: **[MANIFEST.md](MANIFEST.md)**.
> The full account, for the owner: **[docs/HANDOFF.md](docs/HANDOFF.md)**.

## Using the deployed system

Once deployed, the whole thing lives at your Vercel domain:

- **`/`** — the launcher. Field officers tap **HOPE Calls** (no access code — they register
  in the calls app with name + team). Signing in with a portal access code opens the rest,
  showing only what that code may use.
- **`/dashboard`** — KPIs, Recovery % with its basis, per-team table, snapshot audit line.
- **`/upload`** — Excel/CSV exports straight into Supabase (Defaulters, Expected, loan
  pipeline, Received Payments, and — with the `settings` permission — Access Codes/User Roles).

- **`/call`** — HOPE Calls: the field officers' call lists (Leo/Kesho/Def/Exp/Chr), follow-up
  logging, the leader Ripoti tab, and the Col/Sales/Recovery strip. Works in any browser;
  the Android app (below) adds automatic call-log sync.

**Android app (APK):** built by GitHub Actions from `android/` and always downloadable at the
fixed link `…/releases/tag/hope-calls-apk`. It opens the launcher, so one install reaches
Calls, the dashboard and uploads. Beyond wrapping the site it does three things a browser tab
cannot: reads the call log for automatic sync, hands the page a real file picker (`<input
type=file>` is inert in a WebView without `onShowFileChooser`) so workbooks can be uploaded
from the phone, and routes downloads to the Downloads folder. It carries no business logic,
so page changes need no new APK. If the domain changes, re-run the workflow with the new URL
(Actions tab) or type it into the app's built-in fallback screen.

Three one-time setup steps before first use:

1. **Supabase → SQL Editor:** run `db/schema.sql` (fresh install) — or, on a database
   created before 2026-07-25, run each file in `db/migrations/` once instead.
2. **Supabase → SQL Editor:** open `db/seed.sql`, change `CHANGE-ME-1234` to your own
   secret code, run it. That code is what you type into the dashboard/upload pages.
3. **Vercel → your project → Settings → Environment Variables:** add `SUPABASE_URL`
   and `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API), tick
   Production *and* Preview, then redeploy.

## For developers

Start here, in this order:

1. **[ARCHITECTURE.md](./ARCHITECTURE.md)** — what's built, what's deliberately not built
   yet, and why the schema is shaped differently from your current sheets. Read this
   first, especially the "recommended sequencing" section at the bottom.
2. **[MIGRATION.md](./MIGRATION.md)** — step-by-step: set up Supabase, export your
   sheets to CSV, run the import scripts, verify the numbers.
3. **`db/schema.sql`** — the full database schema, commented throughout.
4. **`api/`** — the first slice of the new backend (defaulters, expected, followup,
   comments, dashboard) as real Vercel serverless functions.

## Quick start

```bash
npm install
cp .env.example .env       # fill in your Supabase URL + service role key
# then paste db/schema.sql into the Supabase SQL Editor and run it
node migrate/run.js "Defaulters Followup.csv" followup
```

## What this round covers, honestly

This is a real, working foundation — not a mockup. But it is not a finished replacement
for Code.gs/app.html yet, and it shouldn't be treated as one. Your current system stays
live and unchanged while this gets built out and verified alongside it. See
ARCHITECTURE.md for exactly what's covered and what's next.

## Deploying the API layer

```bash
npm i -g vercel
vercel               # first time: links this folder to a new Vercel project
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel --prod
```

Your API is then live at `https://<your-project>.vercel.app/api/defaulters` etc. — test
with a browser or curl before pointing anything real at it:

```bash
curl "https://<your-project>.vercel.app/api/dashboard?code=YOUR_ACCESS_CODE"
```
