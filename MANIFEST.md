# MANIFEST — every file, and what it is responsible for

The index. When you need to change something and do not know where it lives, look here.

Line counts are indicative, not exact — they move.

---

## The screens — `public/`

Plain HTML with inline JavaScript. **No build step**: what is written here is what is served,
so a change is live the moment it deploys.

| File | What it is |
|---|---|
| `home.html` | The launcher. HOPE Calls for officers; an access code opens the rest. |
| `call.html` | **HOPE Calls.** The officer's whole app: Leo, Kesho, defaulters, Exp.Def rotation, follow-ups, promises, comments, the Ripoti tab, the six-figure strip. Built to work on a bad connection — lists are cached on the device for an hour. |
| `app.html` | **The system portal.** Every office screen, one file: dashboard, weekly report, PAR, Exp.Def, Exp.Def report, assignments, follow-up, promises, follow-up report, reports by leader, commission, calls, complaints, restructure, legal, abnormal, credit, presentations, teams & staff, apps, audit, performance. ~4,000 lines. |
| `dashboard.html` | The standalone dashboard (predates `app.html`; still linked). |
| `upload.html` | The upload page. Excel/CSV in, straight to Supabase. Also summary-only uploads. |
| `live.html` | **HOPE Live** — the wall display. Six figures, no login, refreshes on a timer. |
| `mkopo.html` | The loan calculator. |
| `brand.js` | Shared branding (name, motto, logo) so every page agrees. |
| `live.webmanifest` | Makes HOPE Live installable as a kiosk display. |

---

## The server — `api/`

Each file at the top level is one Vercel route. **All the logic lives in `_lib/`** so it can be
tested without a browser or a network.

### Routes

| File | Route | Gated? |
|---|---|---|
| `portal.js` | `/api/portal` | **Yes** — every office screen goes through here |
| `dashboard.js` | `/api/dashboard` | Yes |
| `defaulters.js` | `/api/defaulters` | Yes |
| `expected.js` | `/api/expected` | Yes |
| `followup.js` | `/api/followup` | Yes |
| `comments.js` | `/api/comments` | Yes |
| `upload.js` | `/api/upload` | Yes (admin bypasses, so you can always upload) |
| `call.js` | `/api/call` | **No — deliberately.** HOPE Calls is never switched off. |
| `me.js` | `/api/me` | Identity only; reports whether the system is open |
| `app-version.js` | `/api/app-version` | No — just a version string |

### The logic — `api/_lib/`

| File | Lines | Responsible for |
|---|---|---|
| **`portal-core.js`** | ~4,400 | Every office screen's data. The biggest file in the system: dashboard, weekly report, PAR, follow-up, promises, commission, complaints, legal, teams & staff, presentations, audit, stamping a week, exports. |
| **`call-core.js`** | ~1,600 | Everything HOPE Calls does: registration, the lists, call sync and portfolio matching, the phone index, comments, follow-up statuses, the leader Ripoti, the six-figure strip, the HOPE Live widget. |
| `importers.js` | ~580 | Turning an uploaded workbook into rows. One importer per report type. |
| `snapshot-totals.js` | ~410 | Team-day totals — asking the **database** to do the summing instead of reading a week of customers. Falls back to reading rows where the migration has not been run. |
| `dashboard-core.js` | ~230 | The dashboard's own derivation, shared so the phone strip and the wall display cannot disagree with it. |
| `supabase.js` | ~230 | The database client, `fetchAll` (paginates past PostgREST's silent 1,000-row cap), transient-failure retries, and the human-readable error message. |
| `parse.js` | ~215 | Reading numbers, dates and names out of messy spreadsheet cells. |
| **`snapshots.js`** | ~195 | **The batch rule.** Latest date, then latest batch *per team*. Read this one first. |
| `pmo.js` | ~170 | PMO collection officers, their bands and bonus, and `isPmoRole` — the one definition of who is a collection officer. |
| `expdf.js` | ~170 | The Exp.Def recycling rotation, shared by the portal and the phone (its own module to break an import cycle). |
| `notify.js` | ~155 | The bell. Reads a page, never a table. |
| `performance.js` | ~145 | Weekly/monthly/yearly records of best team and leader, storing the name and position **as text** so history is not rewritten when somebody is reassigned. |
| `audit.js` | ~140 | Who changed what, and when. |
| `auth.js` | ~135 | Access codes, resolved tabs, `gatedUser` (identity + the open/closed switch), and the API wrapper that turns a thrown error into clean JSON. |
| `system-gate.js` | ~80 | The open/closed switch. Default closed; **admin checked before the setting is read**. |
| `assign.js` | ~60 | The rotation engine — which leader owns which defaulter this week. |
| `answer-cache.js` | ~60 | "The same question, asked once." |
| `passcode.js` | ~55 | Field officer passcodes. |
| `recovery.js` | ~42 | **The Recovery % rule, in one place.** PAID/OVERPAID, UNDERPAID and everything else. Every screen calls this rather than re-deriving it. |
| `time.js` | ~41 | Every "what day is it" decision, on the EAT clock (UTC+3). Weekday keys, week Mondays, date arithmetic. |

---

## The database — `db/`

| File | What |
|---|---|
| `schema.sql` | A complete, fresh database. Fresh installs run **this only**. |
| `seed.sql` | The first access code. Change `CHANGE-ME-1234` before running. |
| `migrations/` | One file per change since 2026-07-25, oldest first. Existing databases run these. **All are safe to re-run.** |
| `migrations/RUN-ME-*.sql` | Convenience files bundling several migrations for pasting into the SQL editor. |

> `migrations/2026-08-05b-snapshot-totals-indexes.sql` is **not** in the bundled RUN-ME file:
> it creates indexes `CONCURRENTLY`, which cannot run inside a transaction block. Run it on
> its own.

Every migration is **optional** in the sense that the system keeps working without it — the
feature it adds says which file to run rather than breaking.

---

## The tests — `test/`

`npm test`. **553 tests. This is the acceptance gate.**

| File | Covers |
|---|---|
| `portal.test.mjs` | Every office screen's data, permissions, team scoping, the week picker |
| `call.test.mjs` | Registration, lists, sync, portfolio matching, role narrowing, comments |
| `dashboard.test.mjs` | The dashboard derivation and the weekday rules |
| `importers.test.mjs` | Every upload format, including the awkward real-world ones |
| `parse.test.mjs` | Messy cells |
| `snapshot-totals.test.mjs` | The database-side totals, and the fallback when the migration is absent |
| `schema.test.mjs` | That `schema.sql` and the migrations agree |
| `supabase.test.mjs` | Pagination past the 1,000-row cap, retries, unstable row order |
| `system-gate.test.mjs` | Open, closed, unset, junk — and that the admin is never locked out |
| **`speed.test.mjs`** | **Round-trip and row budgets for every screen.** Also measures the *second* handset, which is the only way whole-book-per-request faults are visible. |
| `fake-db.mjs` | A mutation-capable fake PostgREST: real filter semantics, ordering, pagination, projections, `onConflict`. Not a stub — it is why the tests catch real faults. |

---

## The Android app — `android/`

A WebView wrapper, built by GitHub Actions, always downloadable at the fixed release tag
`hope-calls-apk`.

It carries **no business logic**, so page changes need no new APK. It exists for three things a
browser tab cannot do:

1. read the call log, for automatic sync,
2. hand the page a real file picker (`<input type=file>` is inert in a WebView without
   `onShowFileChooser`),
3. route downloads to the Downloads folder.

If the domain changes, re-run the workflow with the new URL, or type it into the app's
built-in fallback screen.

---

## Documentation

| File | For |
|---|---|
| `HANDOFF-AIO.md` | **Everything in one file** — what it is, the daily runbook, the rules that took longest to get right, the faults that hurt and what they taught, the measured load, and what is still open. Start here if you read only one. |
| `START-HERE.md` | The map. Begin here. |
| `OPERATIONS.md` | The daily runbook — mornings, uploads, the switch, what to do when it breaks. |
| `MANIFEST.md` | This file. |
| `README.md` | Quick reference: URLs, the APK, first-time setup. |
| `ARCHITECTURE.md` | How the code is arranged and why. |
| `MIGRATION.md` | Setting up Supabase and importing the old sheets. |
| `docs/HANDOFF.md` | **~2,800 lines.** Every table, every column, every screen, every word of the loan vocabulary, and a numbered account of every reported problem and its fix. Written for the owner, not for a programmer. |
| `docs/why-no-cache.md` | Why some things are deliberately not cached. |
| `docs/V1-REVIEW-PACK.md` | The v1 system this replaced. |
| `docs/hints-v2.tsv` | The in-app help text. |

---

## Not in this repository, and never should be

**Credentials.** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` live in Vercel's environment
variables, and in a git-ignored local `.env` if you run migrations from your own machine.

The `service_role` key bypasses Row Level Security — full read and write over everything. If it
is ever exposed, rotate it in Supabase, update Vercel, redeploy. See
[START-HERE.md § Credentials](START-HERE.md#credentials).
