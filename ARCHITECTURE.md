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

---

## The standing rule for every change: the Postgres budget

> *"I wish you record this permanently that from now on on whatever we implement, we go into
> postgress war, so I wont say this again having in mind it's a forever instruction"*
> — the owner, 14 August 2026

**This is not advice. It is a condition of every change from here on.** Nothing ships without
having answered what it costs the database. The instruction was given once and is written down
here so it never has to be given again.

### Why it is a rule and not a preference

The failure this exists to prevent has already happened, more than once, and it does not look
like a bug. Three hundred officers open their handsets within the same twenty minutes each
morning. A screen that costs eleven round trips instead of seven is not "a bit slower" — it is
thirty-three thousand queries against a connection pool that Supabase sizes for a fraction of
that, and what the owner sees is not a slow page. It is **the Postgres dashboard going solid
red**, and every officer in the country locked out at once, on the one morning of the month
when the collections matter most.

The cost is paid by people who cannot see what caused it and cannot do anything about it.

### What "answering it" means

Before a change is written, and stated in the PR:

1. **How many round trips does this add, warm?** Not cold, not worst case — the second handset
   of the morning, when the caches are warm. That is the number that gets multiplied by 300.
2. **How many rows does it read, and is that number bounded?** A read with no ceiling is a read
   that works in testing and falls over on the real table. If it is genuinely unbounded, it
   pages (`fetchAll` / `rpcAll`) — PostgREST silently caps every read at 1000 rows, and a cap
   you did not notice is data quietly missing from a screen.
3. **Can two questions share one journey?** The commonest win in this codebase is not a cleverer
   query — it is noticing that a read already being made can answer the second question too.
   The teams upload's column probe and its existing-spelling map are one read, not two.
4. **Does it write more rows than actually changed?** Upserting forty teams to change two is
   thirty-eight pointless writes and thirty-eight extra chances to fail.
5. **If it is a write, does it bust the right memo?** A stale read after a write is a fault that
   only appears under load, which is the hardest kind to be told about.

### What is already known and must not be "optimised"

Some of the heavier reads in this system are **proportionate**, and were measured and left
deliberately. Changing them makes the system wrong, not fast:

| read | rows | why it is right |
|---|---|---|
| `storageUsage` | ~50k | the un-migrated fallback path; the RPC replaces it where the migration has been run |
| `followupReport` | ~22k | a week of comments is genuinely that many comments |
| `abnormal` | ~7.5k | already date-windowed, team-scoped and down to 10 columns |
| `expdfReport` | 5 deck reads | there are five weekdays; a deck is a team **and** a weekday |

### The measurement discipline

Speed guards live in `test/speed.test.mjs` with **explicit trip and row budgets**, and they
measure the *second* handset, not the first. A change that moves a budget must move the number
in the test deliberately and say why in the commit. A budget that quietly grows is the whole
failure mode this section exists to stop.

**Every PR says what it cost.** "No extra trips" is an acceptable answer. Silence is not.

---

## The standing rule for every feature: keep the hint table current

> *"You can always update the hint table in background: this is also a forever rule b/se am
> making a lot updates."*
> — the owner, 19 August 2026

Same shape as the Postgres rule above: given once, applies from here on, never asked again.
**A feature nobody can find is a feature that does not exist to the person who needed it** --
this session's own sales-target mismatch and the tips-timer nobody could locate were both
exactly that failure. So: when a change adds something a person would otherwise have to
discover on their own -- a new field, a new screen, a changed workflow, a renamed column --
add a tip for it to the `hints` table (tab, message, sw_message; bilingual, matching the tab
name the feature lives on) in the same change, without being asked.

Small and additive, like a migration: a plain `insert into hints (...) values (...)`, safe to
run, never destructive. Uploading a Hints sheet through the app replaces the whole table (see
`TYPE_BEHAVIOUR` in `upload.js`), so these survive until the next such upload -- exactly as a
tip typed in by hand would.
