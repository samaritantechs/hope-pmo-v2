# HOPE PMO v2 — All-in-one handoff

**Everything about this system, in one file.** Written so the owner can read it without knowing
any programming language, and so a developer hired in two years can pick it up from here alone.

Last updated: **10 August 2026** · **451 tests passing** · Live on Vercel + Supabase

| If you want | Go to |
|---|---|
| To run it today | [§2 The daily runbook](#2--the-daily-runbook) |
| To know it will survive 300 phones | [§4 Load, measured](#4--load-measured) |
| Something is broken right now | [§5 When something breaks](#5--when-something-breaks) |
| Tomorrow's meeting | [§3 Before a directors' meeting](#3--before-a-directors-meeting) |
| The database | [§6 The data](#6--the-data) |
| Every file | [MANIFEST.md](MANIFEST.md) |
| The long history of every fix | [docs/HANDOFF.md](docs/HANDOFF.md) |

---

## 1 · What this is

Three products, one deployment.

| | Where | Who | Can it be switched off? |
|---|---|---|---|
| **HOPE Calls** | `/call` | ~300 field officers | **Never.** An officer's day does not depend on the office. |
| **The system portal** | `/app` | office, leaders, admin | **Yes** — the open/closed switch |
| **HOPE Live** | `/live` | a wall display, no login | Yes, with the portal |

Underneath: **Supabase** (PostgreSQL) and **Vercel** (runs the code). No server to maintain.

### The one idea everything rests on

**Uploads never overwrite. They stack.**

Every upload stamps its rows with one `upload_batch` and a `snapshot_date`. Nothing is edited
in place; nothing is deleted by an upload. So reading a figure means answering two questions:

1. **Which day?** — the latest `snapshot_date`, never later than today.
2. **Which upload of that day?** — the latest `upload_batch` **per team**.

That second rule is per **team**, not per day, because a day can arrive as one company-wide
file *or* as seventeen files, a region at a time. Resolving per day kept whichever file came
last and silently discarded sixteen.

*The honest cost:* a re-upload that **drops** a team no longer removes that team — its last
file stands until something replaces it. A team lingering is a far smaller wrong than sixteen
teams vanishing from a report that gives no sign they are missing.

---

## 2 · The daily runbook

1. **Upload the day's reports** (`/upload`) — Defaulters Current, Defaulters Initial, Expected
   Today, Expected Tomorrow. Do this **before** opening the system, not after.
2. **Check the dashboard.** The snapshot line under the KPIs names the date and batch every
   figure came from. If it says yesterday, the upload did not land.
3. **Open the system** if closed.
4. **On a Monday**, press **Stamp report** on the Weekly Report once both ends of the week are in.

Housekeeping runs **automatically on every upload** — same-date earlier reports retired,
duplicates swept, **two copies kept**. Nothing to press.

### The open/closed switch — your most useful lever

**Settings → SYSTEM_OPEN.**

| | Closed | Open |
|---|---|---|
| HOPE Calls | **works, fully** | works |
| The whole portal | refused, with a message | works |
| **You, as admin** | **works, including upload** | works |

Accepted as open: `YES` `ON` `TRUE` `1` `OPEN` (any case). **Anything else — blank, unset, a
typo — reads as closed**, because a switch nobody set is a switch nobody meant to turn on.
**The admin is checked before the setting is even read**, so a bad settings row can never lock
out the one person who can fix it.

**Closing sheds load instantly.** A refused request costs two or three tiny queries and stops —
it never runs a dashboard. Takes up to 30 seconds; saving the setting clears that immediately.

### Uploading

- Excel and CSV, exported straight from the source system.
- **Re-uploading a corrected file for the same day is safe and expected.**
- **Summary uploads** (no customer list) are supported; the system keeps both the full list and
  the summary and displays whichever is **latest**.
- A failed upload leaves the previous one standing. Nothing is destroyed by a bad file.
- Every upload stamps `DATA_VERSION`, which is how 300 handsets learn their figures are stale.

---

## 3 · Before a directors' meeting

- [ ] Upload **both ends of the week** — Monday's initial deck and the current one.
- [ ] Weekly Report: Expected / Collected / **Recovered %** / **Sales %** all carry a figure.
      Recovery reading 0% means the baseline deck is missing.
- [ ] **Press Stamp report** — freezes the record so a later re-upload cannot rewrite what was
      presented. Pressing again on the same week overwrites, which is the point if you corrected
      an upload.
- [ ] Scroll to the **leader boards** at the bottom — every named person in every role,
      including those whose teams produced nothing.
- [ ] Presentations: check the **week bar** shows the week you mean, then Play once.
- [ ] Decide about the switch. Want the room on one screen rather than forty people opening the
      portal? Close the system for the hour. Calls keeps running.

---

## 4 · Load, measured

Not estimated. Measured against a **288,000-row book**, 40 teams.

### One ordinary officer, per screen

**Every officer-reachable screen reads under 1,200 rows.** Heaviest is the weekly report at
1,125. This is guarded by a test that sweeps *every* endpoint, so a screen added next month is
covered without anybody remembering.

### The phone

| Request | Trips | Rows |
|---|---|---|
| Open the app | 5 | ~40 |
| A list (Leo / Kesho / defaulters) | 6–7 | ~90 |
| Exp.Def | 14 | ~70 |
| **Sync — first handset after an upload** | 11 | ~4,000 |
| **Sync — every handset after that** | **4** | **2** |
| The bell | 5 | ~75 |

**300 handsets, one sync cycle + 100 list loads, one warm instance:**
**1,711 round trips · 28,700 rows · ~96 rows per handset.**

### What each cache holds

| What | For how long | Cleared early by |
|---|---|---|
| Phone number → customer index | until the next upload (5 min ceiling) | any upload (`DATA_VERSION`) |
| "Amepigiwa leo" ticks | 30 seconds | the officer's own sync merges its calls in |
| System open/closed | 30 seconds | saving the setting |
| The six strip figures | 2 minutes per team scope | — |
| Officer's lists, on the handset | 1 hour per device | pull to refresh |

### The four faults that caused "postgres gets full red"

| | What it did | Now |
|---|---|---|
| **Phone index** | whole company book, **per sync, per handset** — ~1 full scan/second all day | cached against `DATA_VERSION`; 1,513,700 rows → 28,700 |
| **Upload panel** | four whole tables, no date filter, **on the upload page** | 1 trip, 5 rows |
| **"Amepigiwa leo"** | every call log today, per list, **worse every hour** | one read per 30s, own calls merged |
| **Five screens unscoped** | an officer read all forty teams | narrowed in the query |

The common shape: **fetch everything, filter in JavaScript**. It is invisible in testing because
a fortieth and a whole are the same number when the fixture has one team. That is why the guard
now compares an officer against an admin — if they read the same, the filter is not in the query.

---

## 5 · When something breaks

### Postgres red / delay errors / uploads will not go through

1. **Close the system.** Officers keep working; office load stops instantly.
2. **Upload what you need** — you are admin, the gate does not apply to you.
3. In Supabase → Reports, see which **table** the reads hit. Very large volumes on
   `followup_status`, `repayment_snapshots` or `call_logs` means a cache was broken by a code
   change — run `npm test`, the speed guards will name it.
4. Re-open.

### "The database is briefly unreachable"

The honest message for a 502/503/504/522 from Supabase's edge. The code already retries
transient failures twice. Wait a few seconds. If it lasts minutes, check Supabase for an incident.

### A report shows nothing

1. **The deck was never uploaded** — check the snapshot line under the KPIs.
2. **The week picked has not started** — the week bar says so explicitly.
3. **Weekday mismatch** — defaulter decks pair on date **and type and weekday**.

### An officer sees the wrong customers

Check their **role**, on their access code:

| Role contains | Sees | Where |
|---|---|---|
| `CREDIT` | count 1–6 (paid 0–5) | all their lists |
| `EXPECTED` or `EARLY` | behind ≤ 1 | Leo and Kesho only |
| `COLLECTION` (or the `PMO_ROLE` setting) | behind ≤ 1 | Leo and Kesho only |

Everyone else sees their whole book. Matching forgives case and punctuation. If somebody is
**not** being narrowed, their role field is the first thing to look at.

### Who changed what

**Audit log** tab.

---

## 6 · The data

Full column-by-column detail: [docs/HANDOFF.md](docs/HANDOFF.md) Parts 2–4.

### The tables that matter

| Table | Shape | Grows |
|---|---|---|
| `repayment_snapshots` | append-only, one row per customer per day per type | fastest |
| `defaulter_snapshots` | append-only, per day **per weekday** per type | fastest |
| `followup_status` | **current state** — one row per customer | slowly |
| `followup_comments` | append-only | steadily |
| `call_logs` | append-only, ~15,000/day at 300 officers | fastest of all |
| `teams` | ~40 rows, the leaders table | never |
| `access_codes`, `roles`, `settings` | tiny | never |
| `loans`, `received_payments`, `abnormal_payments`, `complaints`, `restructures`, `demand_notices` | append-only | steadily |
| `audit_log`, `performance_records` | append-only | slowly |

### Migrations

`db/schema.sql` is a **complete fresh database** — new installs run only that.
Existing databases run each file in `db/migrations/`, oldest first. **All safe to re-run.**

Every migration is optional in the sense that the system keeps working without it — the feature
says which file to run rather than breaking.

**Currently outstanding:** `2026-08-10-upload-status.sql` — makes the upload panel one query
instead of reading a day, and calls-per-officer a database count. **The system works without
it**; the screen says so.

> `2026-08-05b-snapshot-totals-indexes.sql` is **not** in the bundled RUN-ME file: it creates
> indexes `CONCURRENTLY`, which cannot run inside a transaction block. Run it on its own.

### Settings that change behaviour without a deploy

| Setting | Default | Does |
|---|---|---|
| `SYSTEM_OPEN` | *closed* | The portal switch |
| `PMO_ROLE` | `PMO COLLECTION` | The role name marking a collection officer |
| `CALL_EARLY_MAX_BEHIND` | `1` | How far behind a customer may be on an early-collection Leo/Kesho list |
| `CALL_CREDIT_MAX_PAID` | `5` | Highest "paid" a credit analyst supervises (0–5 = count 1–6) |
| `CALL_MIN_SECS` | `5` | Seconds before a call counts as "Amepigiwa leo" |
| `CALL_SYNC_SECONDS` | `300` | How often a handset syncs (60–3600). **The fastest way to cut load if you ever need to.** |
| `COMMISSION_RATE` | `5` | Recovery commission % |
| `FU_STATUSES` | built-ins | Follow-up statuses, and which need a date/comment/number |
| `DATA_VERSION` | *stamped* | Set by the system on every upload. **Never edit by hand.** |

---

## 7 · Credentials

**None are in this repository, and none should ever be.** They live in:

- **Vercel → Project Settings → Environment Variables** — `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, ticked for Production *and* Preview.
- **A git-ignored local `.env`**, only if you run migrations from your own machine.

The `service_role` key **bypasses Row Level Security** — full read and write over everything.
Never paste it into a chat, an email, a ticket, a screenshot or a document.

**If it is ever exposed, rotate it immediately:** Supabase → Settings → API Keys → roll the key
→ update the Vercel variable → redeploy. Rotating costs one redeploy. Not rotating costs
everything in the database.

---

## 8 · Working on it

```bash
npm install
npm test          # 451 tests. This is the acceptance gate.
```

**No build step.** `public/*.html` is served exactly as written.

House rules, learned the hard way:

1. **`npm test` is the gate.** Not "it looked fine".
2. **Additive, whole files.** Do not remove a working column, tile or figure to make room.
3. **Server logic in `api/_lib/`**, so it can be tested without a browser.
4. **Team scoping happens in the query**, never by fetching everything and filtering after.
5. **Counting and ordering belong in the database**, not in JavaScript.
6. **Round trips are the unit of speed.** Raising a budget in `test/speed.test.mjs` is allowed;
   raising it silently is not — do it in the same commit so the cost is visible in the diff.

### The tests that protect the thing you fear

| Test | Catches |
|---|---|
| *no screen lets one officer read the whole company book* | any unscoped read, on **every** endpoint, automatically |
| *an officer and an admin must not read the same amount* | the same fault, at **any** fixture size |
| *the phone index is built once and shared* | the fault that redlined Postgres |
| *"amepigiwa leo" is read once per half-minute* | the read that got worse as the day went on |
| *the upload panel asks the database to count* | the read that blocked uploads |
| *opening the app is one wait, not ten* | serial round trips on the busiest path |

---

## 9 · Where things stand

**Everything reported has been fixed and deployed.** The numbered account of every complaint and
what was done about it is [docs/HANDOFF.md](docs/HANDOFF.md), Parts 14–19 — each named after the
words that reported it.

**Waiting on you:**

- Run `db/migrations/2026-08-10-upload-status.sql` (optional; the system works without it).
- **Re-upload the abnormal payments sheet.** `CUSTOMER NO` and `PAYMENT NO` never imported
  before — the fix corrects the import, but it cannot recover values that were never stored.
  Use **Replace** for the date, not Append.
- **Rotate the Supabase keys** if they have ever left your machine.
- Press **Ondoa nakala** if the duplicate sweep still reports stacked uploads.

---

*This document describes the system as built. If a future change makes any statement here
untrue, the change should update this file in the same breath.*
