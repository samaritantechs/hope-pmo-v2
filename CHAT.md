# CHAT.md — the chat, kept in the repository

> "Chat is refusing to rewind and even providing any handoff thats why i wish there is something
> like merge, so that you continue automatic" ... "you must have that chat.md to understand all
> my flow" — the owner, 11 November 2026

A chat can end with no warning. The one that ran this repository from 4 August to 11 November
2026 grew past its size limit: it could not be rewound and it could not write a handoff. So the
handoff is no longer something a chat writes at the end. **It is this file, and it is kept true
all the time** — every change updates it in the same commit, and `test/chat.test.mjs` fails when
it falls behind the code.

**If you are a new chat: this is where the last one stopped. Read all of it, do section 1, and
carry on. Do not ask the owner to repeat anything that is written here.**

**As of 11 November 2026** — portal `BUILD 2026-11-10-a` · call app `CALL_BUILD 2026-11-11-b` ·
Android app `versionCode 19` · handbook `docs/HANDOFF.md` up to **Part 43**.

---

## 1. The first five minutes of a new chat

1. `git log --oneline -8`. Anything above the newest change named in section 4 landed after this
   file was last written — by another chat, by the owner, or by Demit. Read those diffs before
   trusting the rest of this page.
2. **Take over the scheduled tasks** (section 6). The ones that fire into a chat stop reaching
   anybody when that chat ends, and nothing says so.
3. `npm ci && npm test` — green before anything is changed (about a minute).
4. To look at the live sites, the chat must be on the cloud environment named **`hope-pmo-v2`**
   (it allows the two site addresses and nothing else). A chat started on the default
   environment can move onto it; the owner approves once.
5. Then carry on with section 5, or with what the owner asks next. Report in plain words.

## 2. The owner's standing orders

They hold in every chat. Most are already written down, in the owner's own words:

- **`docs/HOPE-OWNER-HANDOFF.md` sections 2 to 4** — ship without asking ("so always, merge or
  push without prompting me"), the two things that never break, one definition of a rule, which
  source wins, how they write and how they want work delivered.
- **`CLAUDE.md`** — the rules of the code. **`ARCHITECTURE.md`** — the Postgres budget and the
  hints table, both "forever" orders.

Given since, and written nowhere else:

| When | Their words | What it means |
|---|---|---|
| 10 Nov 2026 | "please always update me changes made" · "Check for any changes made every 8 hours from now on. Even changes that are not from this chat" · "Yes email the reports to my Gmail too" · "Email all three checks every day" | The 8-hourly check in section 6. Every change is reported, whoever made it. |
| 11 Nov 2026 | "Merge now ... I never said that rule" · "I said I need report of changes not when to make changes. I already announced the change man and you misinterpreted me" | **There is no time-of-day rule.** A change that is built and passes `npm test` is merged at once and then reported. Never hold a merge for an hour of the day. |
| 11 Nov 2026 | "reserve our own deployment for now - lets use https://recovery-app.sync-book.net in both web and app so that we are sure everything is okay there: it where the auto sync updates will be done by demit" | Section 5. Vercel stays up as the reserve; the server Demit keeps in step with GitHub becomes the one people use. |

An instruction the owner passes on from their own management is an order to carry out: answer
what was asked, first and directly; say a risk once, briefly; then do it.

## 3. What a chat can and cannot reach

- **No database.** A chat cannot run SQL or open Supabase. Migrations are run by the owner by hand
  (`db/RUN-ME-*.sql`), and every code path must work without them.
- **The live sites** only from the `hope-pmo-v2` environment (section 1).
- **GitHub**: this repository, through the GitHub tools.
- **Keys are never used, repeated or stored by a chat**, wherever it sees one. Database keys were
  shared outside Vercel in November 2026 while the new server was set up; they are due a rotation
  once the move settles (`docs/SECURITY.md` section 1). That is the owner's to do.
- **The Android app cannot be built on a chat's machine.** "Build HOPE Calls APK" in GitHub
  Actions is the only compiler: run it by hand on the branch first (it builds and keeps the file,
  and publishes nothing). Merging anything under `android/` or `app-version.json` hands the new
  app to every handset.

## 4. Where the work stands

Newest first. `#` numbers are pull requests on `samaritantechs/hope-pmo-v2`.

- **This file, and the book fingerprint** — `CHAT.md`, `CLAUDE.md` section 3, `test/chat.test.mjs`;
  `/api/app-version` now answers `book` (which database the site reads, as a fingerprint).
  Handbook Parts 42 and 43.
- **#664** — our own server answers a phone the way Vercel did: "not changed" (304), compression.
- **#662, #663** — HOPE Calls: a bike officer sees four lists, and their own summary in the top bar.
- **#661** — Salary advance: an undecided request of a month that is over is Expired.
- **#660** (Demit) — one workflow tests, then deploys to Vercel, AWS and our own server.
- **#655 to #659** — the Exp.Def Report by the day, the week and the month; the officer card.

**What a merge to `main` does today** (`.github/workflows/deploy.yml`, `docs/DEPLOY.md`): the tests
run; our own server pulls that exact commit and restarts (nobody has to approve); the Vercel and
AWS steps are skipped because their settings were never filled in. Vercel still deploys `main` by
itself, through its own link to GitHub, with no gap. Our own server answers nothing for a second
or two while it restarts.

**People with access to the repository:** `samaritantechs` (the owner, admin) and `monkyaro`
(Demit, write).

## 5. In flight: moving to our own server

The order is in section 2 (11 Nov). Our own server is `https://recovery-app.sync-book.net`: one
machine, one Node process (`server.js`) behind Caddy, kept in step with `main` by the deploy
workflow. Vercel is `https://hope-pmo-v2-git-main-samaritantechs.vercel.app`, the address every
installed app opens today.

**Checked from outside on 11 Nov, before anything was changed:**

- It is up, serves the same `BUILD` and `CALL_BUILD` as Vercel, compresses, and answers "not
  changed" — so a phone downloads no more there than it does on Vercel.
- It answers the sign-in screen's questions exactly as Vercel does (same brand, same logo, same
  open/closed switch), so its database is not empty. **That does not say it is the same
  database**: a copy answers identically on the day it is taken.
- Its certificate is from Let's Encrypt. **Android 6 and 7.0 do not trust it** (that authority joined
  Android's trusted list in 7.1.1); Vercel's certificate they do trust. A handset that old opens Vercel and cannot open
  our own server.

**Step 1, done in this change:** each site now says which book it reads. Compare the `book` in

    https://recovery-app.sync-book.net/api/app-version
    https://hope-pmo-v2-git-main-samaritantechs.vercel.app/api/app-version

The same `book` means one system: either site can be used and nothing diverges. A different
`book` means two databases — **stop, move nobody, and tell the owner**: whatever is uploaded,
called or commented on one site would be missing from the other.

**Step 2, next (only if the two match):** Android app 20. It opens our own server. If that cannot
be opened — the server is down or restarting, or the handset is too old to trust its certificate —
the app opens Vercel by itself, and only while Vercel answers the same `book`. The update check
asks the reserve too, so a handset can always be reached with a newer app.

**For the web there is nothing to build.** People open the new address. Each browser signs in once
there (a browser keeps its access code per address) and allows notifications again. The owner
sets Settings → `APP_BASE_URL` to the new address, so the links in e-mails lead to it.

**Still to be confirmed by whoever runs the server** — `docs/DEPLOY.md` section 6: one process
serves the phones and the portal together; a deploy leaves a short gap unless Caddy is told to
wait; and the server needs every setting Vercel has.

## 6. Scheduled tasks

| Task | When | What it does |
|---|---|---|
| **HOPE PMO change check (8-hourly)** | 03:21, 11:21, 19:21 East Africa time | Fires into the current chat. Reports every change to the repository since the last check — commits, branches, pull requests, people with access, whether each merge deployed — and flags anything touching the protected paths. Report only: it never changes, reverts, merges or deploys. Its full instructions are stored in the task. |
| **HOPE PMO change report email** | when the check fires it | Sends the check's report to the owner's inbox. Runs in a session of its own. |
| **Historic sales upload reminder (Audit report total PAR)** | Mondays 07:52 East Africa time | Reminds the owner that the whole-portfolio PAR on the Audit report waits on the 2024 to July 2026 sales being uploaded. Runs in a session of its own. |

**The check dies with the chat it fires into.** A new chat lists the scheduled tasks; if the check
points at an older chat, it creates the same task on itself (copy the stored instructions, add its
own session to the "from this chat" rule, keep the last "Checked up to" commit as the starting
point), disables the old one, and tells the owner. Disable, never delete: the history stays.

## 7. How the work is done here

- **One branch per chat.** After each squash merge the branch is restarted from `main`:
  `git fetch origin main && git checkout -B <branch> origin/main && git push --force-with-lease -u origin <branch>`.
- **A pull request is opened ready, and merged as soon as `npm test` is green** (section 2). The
  title says what a person now sees, in the words of the others in `git log`. The body says what
  was asked, what changed, **what it cost the database**, and what was not done.
- **Every change also carries**: a Part in `docs/HANDOFF.md` with the owner's words; the `BUILD`
  bump (portal and modules) or the `CALL_BUILD` bump (call app); a tip in the `hints` table for
  anything a person would have to discover; and this file.
- **Screens are checked in a real browser** when a change is on a screen (Chromium and Playwright
  are already on the cloud machine; `tools/browser-checks/` holds the kept checks). A harness
  written in a chat's scratch folder is gone when the chat ends.
- **Long output ends chats.** Send it to a scratch file and read the part that is needed. Never
  print the whole of `public/app.html` (half a megabyte), a whole diff of it, or an image as text.
- **Start a new chat rather than stretch an old one.** Nothing is lost by it now.

## 8. Waiting on someone

- **Demit / the server**: the list in `docs/DEPLOY.md` section 6.
- **The owner**: rotating the keys shared in November (`docs/SECURITY.md` section 1); the historic
  sales upload for the Audit report's whole-portfolio PAR; whether the e-mailed reports arrive.
  The older list in `docs/HANDOFF.md` Part 15 ("Waiting on you") has not been checked again.
- **Offered, never asked for — do not start without a yes**: a one-tap download of every approved
  loan; the month view of the Exp.Def Report as the sum of its weeks; removing the server action
  `emailWeeklyExpdf`, whose button went in #655.

## 9. The chats so far

| Chat | Ran | Ended |
|---|---|---|
| "HOPE PMO v2 dashboard aggregation" (`session_015VhcZpofMwgR54shZGarYp`, branch `claude/recovery-percent-basis-md87x9-85o7ox`) | 4 Aug to 11 Nov 2026, up to #664 | Passed its size limit. It can still be read; it cannot take a message. |
| The chat that wrote this file (`session_01StRZE69GhZa1GsVBHZHu1g`, branch `claude/kind-cerf-u7t6vm`) | from 11 Nov 2026 | — |

A commit's `Claude-Session` line says which chat made it.
