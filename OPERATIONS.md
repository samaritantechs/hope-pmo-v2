# OPERATIONS — the daily runbook

For the person who runs this system, not the person who writes it. Keep it open on meeting
mornings.

- [The morning, in order](#the-morning-in-order)
- [The open/closed switch](#the-openclosed-switch)
- [Uploading](#uploading)
- [What "normal" looks like](#what-normal-looks-like)
- [When something breaks](#when-something-breaks)
- [Before a directors' meeting](#before-a-directors-meeting)
- [The settings that change behaviour](#the-settings-that-change-behaviour)

---

## The morning, in order

1. **Upload the day's reports** (`/upload`) — Defaulters Current, Defaulters Initial, Expected
   Today, Expected Tomorrow, plus whatever else the day needs.
   *Do this before opening the system to everybody, not after.*
2. **Check the dashboard** (`/app` → Dashboard). The snapshot line under the KPIs names the
   date and batch every figure came from. If it says yesterday, the upload did not land.
3. **Open the system** if it is closed (Settings → system open).
4. On a Monday, **press Stamp report** on the Weekly Report once the week's decks are in.

Housekeeping runs **automatically on every upload** — same-date earlier reports are retired and
duplicates swept, keeping **two** copies of each. There is nothing to press.

---

## The open/closed switch

**Settings → SYSTEM_OPEN.** This is the single most useful lever you have.

| | Closed | Open |
|---|---|---|
| HOPE Calls (`/call`) | **works, fully** | works |
| The portal (`/app`) — all of it | refused, with a message | works |
| HOPE Live (`/live`) | refused | works |
| **You, the admin** | **works, everything** | works |

Accepted as open: `YES`, `ON`, `TRUE`, `1`, `OPEN` (any case). **Anything else — including
blank, unset, or a typo — reads as closed**, because a switch nobody set is a switch nobody
meant to turn on.

**The admin is checked before the setting is even read**, so a settings table having a bad
minute can never lock out the one person who can fix it.

### Why you would close it

Closing the portal sheds load *immediately* and *without touching the officers*. A refused
request costs two or three tiny queries and stops — it never runs a dashboard. So if the
database is struggling and the officers must keep working, **close the system**. Calls carries
on; the office waits.

It takes up to **30 seconds** to take effect (the answer is remembered that long), and saving
the setting clears that immediately, so as the admin you see it at once.

---

## Uploading

- The upload page accepts **Excel and CSV**, exported straight from the source system.
- **Uploads never overwrite — they stack.** Re-uploading a corrected file for the same day is
  safe and expected: the newer batch wins, per team. See
  [START-HERE.md](START-HERE.md#the-one-idea-you-have-to-hold).
- **Summary uploads** (no customer list) are supported for Expected and Defaulters. The system
  keeps **both** the full customer list and the summary, and displays whichever is **latest**.
- If an upload fails, **the previous one still stands**. Nothing is destroyed by a bad file.
- Every upload stamps `DATA_VERSION`, which is what tells 300 handsets their figures are stale
  and refreshes the phone's matching index. This is why the phones pick up an upload within
  minutes without anybody telling them.

**You can always upload as admin, even with the system closed.**

---

## What "normal" looks like

Measured against a 40-team book, per request:

| Request | Round trips | Rows |
|---|---|---|
| Officer opens the app (`boot`) | 5 | ~40 |
| A list (Leo / Kesho / defaulters) | 6–7 | ~90 |
| Exp.Def list | 14 | ~70 |
| **Sync, first handset after an upload** | 11 | ~4,000 |
| **Sync, every handset after that** | **4** | **2** |
| The bell | 5 | ~75 |
| HOPE Live widget (cached 2 min) | 36 | ~2,500 |

**300 handsets, one sync cycle plus 100 list loads, against one warm instance:**
**1,711 round trips, 28,700 rows** — about **96 rows per handset**.

If you are watching Supabase and seeing numbers wildly above this shape, something has
regressed. `npm test` includes speed guards that measure the *second* handset, not just the
first, which is the only way this class of fault is visible at all.

### What each cache holds, and for how long

| What | How long | Cleared early by |
|---|---|---|
| Phone number → customer index | until the next upload (5 min ceiling) | any upload (`DATA_VERSION`) |
| "Amepigiwa leo" ticks | 30 seconds | the officer's own sync merges their calls in |
| System open/closed | 30 seconds | saving the setting |
| The six strip figures | 2 minutes per team scope | — |
| Officer's lists, on the handset | 1 hour per device | pulling to refresh |

---

## When something breaks

### "Postgres is red" / delay errors / uploads will not go through

This exact failure had one dominant cause, now fixed: the phone's matching index was rebuilt
from the **whole company book on every sync**, which at 300 handsets was roughly one full-book
scan per second, all day — and the uploads queued behind it.

If it happens again:

1. **Close the system** (Settings). Officers keep working; the office load stops instantly.
2. **Upload what you need to upload** — you are admin, the gate does not apply to you.
3. In Supabase → Reports, look at which **table** the reads are hitting. If it is
   `followup_status`, `repayment_snapshots` or `call_logs` in very large volumes, a cache has
   been broken by a code change — check the speed tests.
4. Re-open the system.

### A screen says "the database is briefly unreachable"

That is the honest message for a 502/503/504/522 from Supabase's edge. The code already retries
transient failures twice before showing it. **Wait a few seconds and try again.** If it
persists for minutes, check the Supabase dashboard for an incident.

### A report shows nothing

Almost always one of these three, in order of likelihood:

1. **The deck for that day was never uploaded.** Check the snapshot line under the KPIs — it
   names the date every figure came from.
2. **The week picked has not started.** The week bar now says so explicitly.
3. **A weekday mismatch.** Defaulter decks pair on date **and type and weekday** — a Monday
   initial deck against a Tuesday current deck compares two different populations.

### An officer sees the wrong customers

Check their **role**, on their access code. The three narrowed roles are:

| Role | Sees | Where |
|---|---|---|
| Credit analyst (role contains `CREDIT`) | count 1–6, i.e. paid 0–5 | all their lists |
| Expected / early collection (`EXPECTED`, `EARLY`) | behind ≤ 1 | Leo and Kesho only |
| Collection (`PMO COLLECTION`, or the `PMO_ROLE` setting) | behind ≤ 1 | Leo and Kesho only |

Everyone else sees their whole book. Matching forgives case and punctuation and matches on the
contained word, so `Credit Analyst`, `EARLY COLLECTION` and `pmo-collection` all work. If
somebody is *not* being narrowed, their role field is the first thing to look at.

### Something is wrong and you need to know who did it

**Audit log** tab. Every change is recorded with who, what and when.

---

## Before a directors' meeting

A checklist, in order:

- [ ] **Upload everything** — Monday's initial deck and the current one, expected, loans,
      received payments. The weekly report needs *both* ends of the week.
- [ ] **Open the Weekly Report.** Check Expected / Collected / Recovered / Sales all carry a
      figure and a percentage. If Recovery reads 0%, the baseline deck is missing.
- [ ] **Press Stamp report** on that week. This freezes the record so a later re-upload cannot
      quietly rewrite what was presented. Pressing it again on the same week overwrites — which
      is the point, if you corrected an upload.
- [ ] **Open Presentations**, tick the segments you want, set the seconds, and press Play once
      to check it runs. The week bar at the top must show the week you mean.
- [ ] **Check the leader boards** at the bottom of the Weekly Report — every named person in
      every role, including those whose teams produced nothing.
- [ ] **Decide about the switch.** If you want the room looking at one screen rather than forty
      people opening the portal at once, close the system for the hour. Calls keeps running.
- [ ] Have `/live` open on the wall display if there is one.

---

## The settings that change behaviour

All in **Settings**, all editable without a deploy.

| Setting | Default | What it does |
|---|---|---|
| `SYSTEM_OPEN` | *closed* | The portal open/closed switch. See above. |
| `PMO_ROLE` | `PMO COLLECTION` | The role name that marks a collection officer. Rename it here and every screen follows. |
| `CALL_EARLY_MAX_BEHIND` | `1` | How far behind a customer may be to stay on an early-collection officer's Leo/Kesho list. |
| `CALL_CREDIT_MAX_PAID` | `5` | The highest "paid" a credit analyst still supervises (0–5 = count 1–6). |
| `CALL_MIN_SECS` | `5` | Seconds of conversation before a call counts as "Amepigiwa leo". A dial attempt does not tick. |
| `CALL_SYNC_SECONDS` | `300` | How often a handset syncs. Clamped to 60–3600. **Raising this is the fastest way to cut load if you ever need to.** |
| `CALL_LOGOUT_ENABLED` | on | Whether officers can sign out of the app. |
| `COMMISSION_RATE` | `5` | Recovery commission percentage. |
| `FU_STATUSES` | built-ins | The follow-up status list, and which ones require a date, a comment or a number. |
| `DATA_VERSION` | *stamped* | Set by the system on every upload. **Do not edit by hand** — it is what tells the handsets their figures are stale. |

---

## Things that are true and worth remembering

- **Nothing an upload does is destructive.** The worst a bad file can do is add rows that a
  later, better file supersedes.
- **Two copies of each upload are kept**, deliberately, so a corrupted file never leaves you
  with nothing to fall back to.
- **The admin is never gated**, anywhere, by anything.
- **A zero is a real answer.** A leader with no sales appears on the weekly report with zeros
  rather than being dropped — dropping them would make the report quietly flattering.
- **Calls is never closed.** If you remember one thing from this file, remember that you can
  close the office half at any moment and the field keeps working.
