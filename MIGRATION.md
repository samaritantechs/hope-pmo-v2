# Migration guide

## 0. Set up Supabase (~10 minutes)

1. supabase.com → New project. Pick a region close to Tanzania if offered (Europe is
   usually the closest option); note the database password somewhere safe.
2. Project Settings → API → copy the **Project URL** and the **service_role** key (not
   `anon`) into a `.env` file in this project (copy `.env.example` → `.env` and fill in).
3. SQL Editor → paste the entire contents of `db/schema.sql` → Run. You should see
   "Success. No rows returned" and a full table list appear in the Table Editor.

## 1. Export your current sheets to CSV

For each tab you want to migrate: open it → File → Download → Comma Separated Values
(.csv). Google Sheets exports one tab at a time, so this is one download per sheet —
tedious but there's no way around it from the Sheets side.

## 2. Install and run the migration scripts

```bash
npm install
```

Then, **one sheet at a time** (see below for why one at a time on purpose):

```bash
# Defaulters (do this for each weekday x Initial/Current you have data for)
node migrate/run.js "Def Current Wednesday.csv" defaulters-current WED 2026-07-22
node migrate/run.js "Def Initial Wednesday.csv" defaulters-initial WED 2026-07-22

# Expected
node migrate/run.js "Expected Monday.csv" expected-today 2026-07-20
node migrate/run.js "Expected Initial Monday.csv" expected-initial 2026-07-20

# Followup + comment history
node migrate/run.js "Defaulters Followup.csv" followup
node migrate/run.js "Comments Log.csv" comments

# Loan pipeline (repeat per stage)
node migrate/run.js "Approved (Processed).csv" loans approved
node migrate/run.js "Disbursed Loans.csv" loans disbursed

# Reference data
node migrate/run.js "Leaders.csv" teams
node migrate/run.js "Received Payments.csv" received
```

Each command prints how many rows it parsed, inserts in batches of 500 with progress, and
finishes by telling you the new total row count in that table — check that number against
what you'd expect before moving to the next file.

## 3. Verify before trusting it

For every sheet you migrate:
1. Open the table in Supabase's Table Editor.
2. Compare the row count to what the sheet actually had (minus the header row).
3. Spot-check 3-5 specific customers by REF# — do the arrears/D.S/dates match what's in
   the sheet exactly?
4. **Specifically check a D.S value that looked corrupted in the old sheet** (a "3-6" or
   similar) — confirm it imported as whatever the export actually contained. If the
   Sheets export itself already had the corrupted value, this migration can't fix that
   retroactively; it'll carry the bad value over faithfully. Worth fixing at the source
   (re-pasting the correct "3/6" into Sheets, using the text-format columns from the
   D.S/D.C fix already in Code.gs) before exporting, not after.

## Why one file at a time, not "migrate everything" in one script

For a first migration of live financial data, being able to check row counts and spot-check
real numbers between every single sheet is worth far more than saving a few minutes of
typing. A bug in a "migrate everything" script found on sheet 40 of 45 means re-checking
everything before it. A bug found on sheet 1, one command in, means fixing it once and
moving on. Once you've verified the pattern holds for a few sheets of each type, running
the rest is quick — but earning that confidence first is the point, not the speed.

## Doing this again for the next weekday cycle

The Expected/Defaulters snapshots are meant to be re-run regularly (this is the ongoing
workflow, not just a one-time migration) — each `snapshot_date` is a NEW set of rows, not
an overwrite, so re-running for a new day just adds that day's data. Nothing needs to be
deleted first.
