# HOPE PMO v2 — Architecture

## What this is, right now

A working foundation: a complete database schema, a migration path from your current
Google Sheets exports, and a first slice of the API layer (defaulters, expected,
followup + comments, dashboard). This is real, runnable code, not a mockup — but it is
a **foundation**, not a finished replacement yet. Being straight about that split matters
more here than anywhere else in this whole project, because this is live money and real
customers.

## Why the schema looks different from your sheets

Google Sheets has no query language, so every "view" of the data had to be its own
physical tab: Monday's Expected, Wednesday's Defaulters, Initial vs Current, each a
separate sheet. A real database doesn't need that:

- **8 loan-pipeline sheets → 1 `loans` table.** A loan is one row that moves through a
  `stage` column instead of living in 8 different places. "Show me everything pending
  approval" becomes `WHERE stage = 'pending_approval'` instead of opening a specific tab.
- **~12 Expected sheets → 1 `repayment_snapshots` table**, filtered by `snapshot_type`
  and `snapshot_date`.
- **~17 Defaulters sheets → 1 `defaulter_snapshots` table**, filtered by `snapshot_type`,
  `weekday`, and `snapshot_date`.
- **Call Logs → 1 table, no weekly archive tab needed.** Postgres doesn't have a
  10-million-cell ceiling. The whole "archive to a dated tab every Monday" system that
  got built to survive Sheets' limits simply isn't a problem this design has — the table
  can hold years of history and still answer "this week's totals" instantly, because it's
  indexed by date instead of needing you to know which tab to open.

This also means several entire categories of bug from the Sheets version can't happen
here anymore, structurally, not just via a guard someone remembered to add:

- **D.S "3/6" becoming a date.** That happened because Sheets auto-detects date-shaped
  text. A Postgres `text` column has no such behavior — there's no implicit type coercion
  anywhere in this pipeline for that field.
- **The cell-limit crisis.** There's no per-table cell cap. A sheet accumulating months
  of unfiled rows just isn't a category of problem here.
- **The duplicate-call-log race condition.** Postgres has real transactions and unique
  constraints, not a single shared script-wide lock racing a read against a write.

## What's built vs. what's next

**Built (this round):**
- Full schema (`db/schema.sql`) — every core table, indexed, with the reasoning for each
  design choice commented inline.
- Migration scripts (`migrate/`) — takes a CSV export of any given sheet and imports it,
  one sheet at a time, with the same column-name-based mapping discipline the old
  `mapRows_` used (never by position).
- API layer, first slice (`api/`) — defaulters, expected, followup (read + save comment),
  comments history, dashboard totals. Each one is real, working code against the schema,
  not a stub.

**Not built yet — next rounds:**
- **Auth beyond the access-code check itself.** Right now `authCode()` looks up a code
  and returns permissions, same as `auth_()` in Code.gs — but there's no session/token
  layer yet, so every request re-sends the code. Fine to start with, worth hardening
  before this is the only way in.
- **The rest of the API surface.** Credit analyst, call reports, complaints,
  restructuring, demand notices, the presentation/chart endpoints, uploads. Code.gs has
  roughly 150 functions; this round covers the handful that carry the daily workflow.
- **Frontend.** app.html is ~5,700 lines of hand-built UI. Nothing here replaces it yet —
  the plan is to keep app.html/call.html talking to Apps Script exactly as they do today
  while this backend is being built and tested in parallel, so nothing your officers use
  today breaks while this comes together.
- **The Android APK.** Still points at the Apps Script `/exec` URL. Repointing it at a
  new backend is its own rebuild-and-resign step, done last, once everything it depends
  on is proven.

## Recommended sequencing from here

1. **Migrate data, verify it, in parallel — don't cut over yet.** Run the migration
   scripts against a copy of your data. Compare row counts and spot-check numbers
   against the live sheets. Nothing about your current Code.gs/app.html changes during
   this — Sheets stays the system of record until you're confident the new one is right.
2. **Finish the API surface** for the tabs your officers touch daily, in priority order
   you pick.
3. **Only then** start on frontend — and even then, incrementally: one tab at a time
   against the new API, still able to fall back to the current app.html if something's
   not ready.
4. **APK last**, once the API it'll depend on is solid.

Cutting over all at once, in one sitting, is exactly the kind of move that turns a small
mistake into a bad week for people relying on this system daily. Going in this order
means at every single point, there's a working system — either the current one, or the
new one once it's actually ready — never a gap in between.
