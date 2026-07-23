# HOPE PMO v2 — Supabase + Vercel foundation

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
