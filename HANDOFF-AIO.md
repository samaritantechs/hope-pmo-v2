# HOPE PMO — the whole system in one file

Written for the person who owns it, not for a programmer. If you read one file, read this one.

Last rewritten: 11 August 2026, after the week that ended with every defaulter visible again.

---

## 1. What this is

Two applications over one database.

| | who uses it | what it is |
|---|---|---|
| **HOPE Calls** (`/call`) | 300+ field officers, on Android | Leo, Kesho, Defaulters, Exp.Def, follow-ups, promises, the Ripoti tab |
| **The portal** (`/portal`) | the office | dashboard, weekly report, PAR, commission, complaints, legal, teams & staff, presentations, uploads |

No build step. `public/*.html` is served exactly as written, so a change is live the moment it
deploys. Server logic lives in `api/_lib/`. **`npm test` is the gate — 553 tests.**

---

## 2. The one thing to understand about the data

Everything flows from **uploads**. Nothing is typed in by hand except an officer's own follow-up.

```
  the company's Excel export -- a CURRENT file is the WHOLE defaulter book, every team
        │
        ▼  upload page, a thousand rows per request
  defaulter_snapshots  ← history, append-only, never overwritten
        │
        ▼  writeFollowupFromDeck (every slice) + retireFollowupAfterDeck (last slice)
  followup_status      ← the WORKING REGISTER. This is what the phones read.
        │
        ▼
  every handset's Defaulters list
```

**The DEFAULTERS LIST has no weekday.** A current file is the whole book, not one weekday's
slice of it, so the latest one uploaded IS the list: whoever it does not name has left it, full
stop -- see `retireFollowupAfterDeck` in `api/upload.js` ("LAST WEEK's deck is what this week's
is compared against"). The weekday still matters for **recovery arithmetic** -- an initial deck
is paired against a current deck of the SAME weekday, because that is the only honest comparison
-- and each day's reports are kept for exactly that. It never decided who is on an officer's
list; an earlier version of this code conflated the two, which is why a paid customer could sit
on the register for weeks with nothing to clear them.

**The register is not the deck.** The portal reads decks; the phones read the register. A customer
in one and not the other is on every office screen and no handset, with each half individually
correct and nothing to say so. That gap cost a week — see §5.

---

## 3. Every morning

1. Upload **Expected — Today** (and Tomorrow if it exists).
2. Upload **Defaulters — Current** for the weekday, and **Initial** on Monday.
3. Read the result line. It now tells you:
   - how many rows the file had and how many were used — **if any were skipped it names them**;
   - how many customers went onto the officers' working list;
   - which way round it read the dates;
   - anything retired, and why.
4. Open the app on one handset and check a customer you know.

If something looks wrong, **paste the upload's result text to whoever maintains this**. Every
serious fault in this system was found from that text, not from guessing.

---

## 4. The rules that took the longest to get right

**The batch rule.** Latest date, then latest upload *per team*. A day arriving as seventeen files
does not throw away sixteen teams.

**The date rule.** Per team **and per weekday** — see §2.

**Retirement.** A customer drops off the working list when their own weekday's deck comes round
without them, or after a fortnight unconfirmed. Both rules have a **brake**: if a sweep would
retire more than a third of the live list it retires nobody and reports the number instead. A
third of the register looking stale means a weekday's decks stopped arriving, not that the list
needs tidying.

**Date columns.** A file's date order is decided **once, over the whole column** — never per value.
Evidence first (a `22` can only be a day). Where a file offers no evidence at all — an approved
report for the first week of a month is `8/3 … 8/10`, every value ambiguous — the reading that puts
the file in the **tighter span** wins. Seven days beats seven months. The upload says which it chose.

**Team scoping happens in the database**, never by filtering after the fact. An officer's request
must not read the company's book. A handset is also widened to any teams its holder owns through a
role column, so a credit analyst sees all thirty of their teams and not just the one whose code
they typed.

---

## 5. The faults that hurt, and what they taught

Each of these was live, each was found from something the owner sent, and each has a test that
fails if it comes back.

| what was seen | what it actually was |
|---|---|
| "the app has no customers" | Every upload ran a retirement sweep with a **one-day** cutoff. Decks come round *weekly*, so that describes almost everybody: 60 of 100 customers blanked per upload. |
| `8888 rows … 888 now visible … 7977 taken off` | A file uploads a thousand rows at a time and the register sync ran on **the current slice**. It wrote the last 888 and retired the other 8,000 for "not being in the deck". |
| a customer in the file and on no screen | Database **functions** are capped at 1,000 rows exactly like table reads, and nothing was paging them. A week of team-day totals is several thousand summary rows. |
| a team in the file and nowhere | The newest deck date was resolved **per team** when a deck is per team *per weekday*, so only the most recently uploaded weekdays survived. |
| rebuild says success, nothing changes | The repair read the register for its **keys only**, so a customer present-but-blanked looked like nothing to do. |
| "0 sales" after uploading approved | `8/6/2026` read day-first as 8 June. A week of August landed across eight months. |
| reports downloading three times too wide | The card **header** is one unwrapped line; measured off-screen it took its full width and the table stretched to match. |

**The recurring shape, three times over:** *a header that matches nothing looks exactly like a
column of empty cells.* On a reference column it is worse — the row is dropped entirely. Ten
spellings of `REF` are accepted now, and any row the importer could not use is **named** in the
result rather than silently subtracted from the count.

---

## 6. The Postgres discipline

> **A standing instruction, given once so it never has to be given again:**
> *"from now on on whatever we implement, we go into postgress war… it's a forever instruction"*
> — the owner, 14 August 2026
>
> Every change from here on states what it costs the database before it ships. The full rule,
> with the five questions each change has to answer and the list of heavy reads that are
> **proportionate and must not be "optimised"**, is in
> [ARCHITECTURE.md § the Postgres budget](ARCHITECTURE.md#the-standing-rule-for-every-change-the-postgres-budget).

This system fell over under 300 handsets once. Everything below is why it does not now.

- **Every read pages** past PostgREST's silent 1,000-row cap — including database functions.
- **Reads are sequential.** A wave of concurrent requests was tried and took the system down; it is
  written in `api/_lib/supabase.js` so nobody tries it again.
- **Fewer, bigger pages** — 10,000 rows a request, and the server's real ceiling is *learned*
  rather than assumed.
- **A paged read has a tiebreaker**, or its pages do not fit together and totals move on refresh.
- **Ask the database, don't drag rows.** Team-day sums, upload status, calls per officer, and the
  pipeline funnel are all GROUP BYs. Each has a fallback for a deployment that has not run the
  migration by hand yet.
- **What repeats is remembered**: the phone index, the team role map, the settings table. Each
  keyed so a write or an upload drops it at once.
- **Budgets are tests.** `test/speed.test.mjs` gives every screen a ceiling in round trips *and*
  rows, and measures the **second** handset — the only way whole-book-per-request faults are ever
  visible.

Measured on a forty-team book, warm (second request in the same minute):

```
  phone boot            4 trips        phone list (Def)      3 trips
  phone sync            2 trips        phone strip           1 trip
  dashboard             9 trips        weekly report         9 trips
```

The dashboard was **19** before this pass: the pipeline funnel was counting one stage at a time
(eight journeys) and the settings table was read three times to build one screen.

---

## 7. Running it

- **Hosting:** Vercel. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are environment variables
  there. **They are never in this repository and must never be.**
- **Database:** Supabase. Fresh install runs `db/schema.sql` only. An existing one runs the files
  in `db/migrations/` in date order — **all are safe to re-run, and all are optional**: without one
  the feature it adds says so instead of breaking.
- **`db/migrations/2026-08-05b-snapshot-totals-indexes.sql`** creates indexes `CONCURRENTLY` and
  cannot run inside a transaction. Run it on its own.
- **The Android app** is a WebView wrapper with no business logic, built by GitHub Actions, always
  at the release tag `hope-calls-apk`. Page changes need no new APK.
- **The switch.** Settings → the system opens and closes. Default closed. **The admin is checked
  before the setting is read**, so you can never lock yourself out. HOPE Calls is never switched
  off — deliberately.

### If the service_role key is ever exposed
Rotate it in Supabase → Settings → API Keys, update it in Vercel, redeploy. It bypasses row-level
security entirely: full read and write over everything.

---

## 8. Where things live

| I want to change… | look in |
|---|---|
| what a screen shows | `public/app.html` (portal) or `public/call.html` (phone) |
| what a screen is given | `api/_lib/portal-core.js`, `api/_lib/call-core.js` |
| how a file is read | `api/_lib/importers.js`, `api/_lib/parse.js` |
| the batch / date rules | `api/_lib/snapshots.js`, `api/_lib/snapshot-totals.js` |
| what an upload does | `api/upload.js` |
| paging, retries, errors | `api/_lib/supabase.js` |
| who may see what | `api/_lib/auth.js`, `api/_lib/system-gate.js` |
| the Recovery % rule | `api/_lib/recovery.js` — one place, deliberately |

Every file explains itself. The comments carry **why**, including the mistakes — read them before
changing the rule they describe.

---

## 9. Still open

1. **Rotate the Supabase keys.** They were pasted into a chat transcript. Nothing of them is in the
   repository; they were still exposed.
2. **A phone-shaped JPG** — one block per team instead of a wide table. A fifteen-column board
   cannot be made readable on a phone by scaling; only by changing the layout. Offered, not built.
3. **Date order in the deck importers.** Only the loans importer decides its order from the whole
   column. The defaulter and expected decks still read day-first per value. Their dates
   self-resolve today, so nothing is at risk — but `8/6` in one of those files would land in June,
   exactly as the sales figure did. Changing it moves the Exp.Def rotation, so it waits for a
   deliberate decision rather than a quiet fix.
