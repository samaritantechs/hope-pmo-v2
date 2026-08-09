# START HERE

**HOPE PMO v2** — the collections and recovery system for the field teams, the office, and the
handsets in between.

This file is the map. Everything else is one click from here.

---

## If you have five minutes

| You want to | Read |
|---|---|
| Run the system on a normal day | **[OPERATIONS.md](OPERATIONS.md)** — the daily runbook |
| Understand what it does, screen by screen | [docs/HANDOFF.md](docs/HANDOFF.md) Part 5 |
| Know what a word means (deck, batch, D.S, count 1-6) | [docs/HANDOFF.md](docs/HANDOFF.md) Part 0 |
| Set it up from nothing | [MIGRATION.md](MIGRATION.md) |
| Find the file that does X | **[MANIFEST.md](MANIFEST.md)** |
| Change the code | [ARCHITECTURE.md](ARCHITECTURE.md), then `npm test` |

**If something is wrong right now**, go straight to
[OPERATIONS.md § When something breaks](OPERATIONS.md#when-something-breaks).

---

## What this system is, in one page

Three things share one deployment:

**1. HOPE Calls** (`/call`) — what a field officer carries. Their call lists for today (Leo),
tomorrow (Kesho), the defaulter book, and the recycling rotation (Exp.Def). It logs calls,
records follow-ups and promises, and works on a bad connection. **It is never switched off**:
an officer's day does not depend on the office.

**2. The system portal** (`/app`) — the whole book. Dashboard, weekly report, PAR, Exp.Def,
follow-up, promises, commission, complaints, legal, presentations, teams and staff, uploads,
audit log, performance history. **This is the half that can be closed** (Settings → system
open/closed) when figures are being re-uploaded or the company is not ready for everyone at
once. The admin is never locked out.

**3. HOPE Live** (`/live`) — a wall display. Six figures, refreshed on a timer, no login.

Underneath: **Supabase** (a PostgreSQL database) and **Vercel** (which runs the code). There is
no server to maintain.

---

## The one idea you have to hold

Everything downstream depends on this, so it is worth thirty seconds.

**Uploads never overwrite. They stack.**

Every upload stamps all of its rows with one `upload_batch` and a `snapshot_date`. Nothing is
ever edited in place, and nothing is deleted by an upload. Reading a figure therefore means
answering two questions in order:

1. **Which day?** — the latest `snapshot_date`, never later than today.
2. **Which upload of that day?** — the latest `upload_batch` **for each team**.

That second rule is per **team**, not per day, and the reason matters: a day can arrive as one
whole-company file *or* as seventeen files, a region at a time. Resolving per day would keep
whichever file was sent last and silently throw away sixteen. Per team, both shapes work.

The honest cost: a re-upload that *drops* a team no longer removes that team — its last file
stands until something replaces it. A team lingering is a far smaller wrong than sixteen teams
vanishing from a report that gives no sign they are missing.

*(Code: `api/_lib/snapshots.js`. It is short and heavily commented; read it if you read nothing
else in the codebase.)*

---

## The map

```
START-HERE.md      <- you are here
OPERATIONS.md      the daily runbook: mornings, uploads, the open/closed switch,
                   what to do when it goes wrong, and what "normal" looks like
MANIFEST.md        every file in the repository and what it is responsible for
README.md          quick reference: URLs, the APK, first-time setup
ARCHITECTURE.md    how the code is arranged and why
MIGRATION.md       setting up Supabase and importing the old sheets

docs/HANDOFF.md    THE BIG ONE (~2,800 lines). Every table, every column, every screen,
                   every word, and a numbered account of every problem that has been
                   reported and what was done about it. Written for the owner, not for a
                   programmer.
docs/why-no-cache.md   why some things are deliberately not cached
docs/V1-REVIEW-PACK.md the v1 system this replaced

db/schema.sql          a fresh database, complete
db/migrations/         one file per change, oldest first; all safe to re-run
db/seed.sql            the first access code

api/                   the server. api/_lib/ holds all the logic (see MANIFEST.md)
public/                the screens. Plain HTML and JavaScript, no build step
test/                  438 tests. `npm test` is the acceptance gate
android/               the APK wrapper (call-log sync, file picker, downloads)
```

---

## Working on it

```bash
npm install
npm test          # 438 tests, must be green before anything ships
```

There is **no build step**. `public/*.html` are served exactly as they are written, so a change
there is live the moment it deploys.

House rules, learned the hard way:

- **`npm test` is the gate.** Not "it looked fine".
- **Additive, whole files.** Do not remove a working column, tile or figure to make room.
- **Server logic lives in `api/_lib/`**, so it can be tested without a browser.
- **Team scoping happens at the database**, in the query — never by fetching everything and
  filtering afterwards. That mistake once turned 0.147 GB of data into 81 GB of transfer.
- **Round trips are the unit of speed.** `test/speed.test.mjs` gives every screen a budget in
  round trips *and* rows. Raising a budget is allowed; raising it silently is not — do it in
  the same commit so the cost is visible in the diff.

---

## Credentials

**None are in this repository, and none should ever be.**

They live in exactly two places:

- **Vercel → Project Settings → Environment Variables** — `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY`, ticked for Production *and* Preview.
- **A local `.env`** (copied from `.env.example`), only if you are running migrations from your
  own machine. `.env` is git-ignored and must stay that way.

The `service_role` key **bypasses Row Level Security** — it is full read and write over the
entire database. Treat it like the keys to the safe:

- Never paste it into a chat, an email, a ticket, a screenshot or a document.
- If it is ever exposed, **rotate it immediately**: Supabase → Settings → API Keys → roll the
  key, then update the Vercel variable and redeploy. Rotating costs one redeploy. Not rotating
  costs everything in the database.

---

## Where things stand

The current state, what is waiting on a decision, and every recent change with the complaint
that prompted it: **[docs/HANDOFF.md](docs/HANDOFF.md) Part 15** and the Part 14/18 series.
