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

**As of 11 November 2026** — portal `BUILD 2026-11-11-b` · call app `CALL_BUILD 2026-11-11-b` ·
Android app `versionCode 19` · handbook `docs/HANDOFF.md` up to **Part 48**.

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
| 11 Nov 2026 | "remember the 8hrs/evening is only for reporting: not mergings, always ,merge what prompted" | The 8-hourly schedule is for reports only. Whatever the owner prompts is built, tested and merged at once. |
| 11 Nov 2026 | "We should now access our work from the new website url only so that people can report any irregularities" · "i expect https://hope-pmo-v2-ten.vercel.app/dashboard to redirect to the new one too" · "changes i make here must be through to the new one in both app and web, so that me and demit both deliver into app and web - so you must ammend apk url update too i think, am not sure though on how it receives datga" · "Then make a full analysis and give me any setbacks so that i tell demit" | Section 5: the old addresses are to lead to the new one, the app is to open it, and one pipeline delivers the owner's and Demit's changes to both. The analysis was delivered on 11 Nov. |
| 11 Nov 2026 | "am always afraid whenever i move into a new chat, any change made must not distruct efficiency of itself and other activities that depend on it or not" | Before a change ships, say what it costs the thing it changes and everything around it. Nothing that works is slowed or disturbed, in a new chat least of all. |

| 11 Nov 2026 | "Ill be comming with staff db updates simce GMOs comfirm of changes in my whatsapp group" · "dont correct names using the gmo data i bring unless its new staff" · "so provide sql to add staff as we always did" | Staff changes come as a GMO's list, team by team (remove, add). Answer with a filled copy of `db/TEMPLATE-staff-changes-from-gmo.sql`; a name already in the staff registry is never re-spelt; a GMO's spelling is taken for a new staff only; the ones that come back NOT FOUND are settled by staff ID (`db/TEMPLATE-staff-changes-by-id.sql`). No staff name is committed. Handbook Part 48. |

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

- **#669** — no zone is said, not left blank ("am not seeing my zone yet"): a code over every
  team that is named on none reads `ALL ZONES`; a person whose teams have an empty ZONE cell
  reads `NO ZONE SET`; the name is bare only when the zone could not be read. BUILD
  2026-11-11-b, handbook Part 47. The same change put the two staff scripts in `db/` as
  templates with no name in them, and the owner's order on staff names in section 2 (Part 48).
- **Staff registry, 11 Nov** — the first GMO list (one zone, eleven names) is in the live book:
  five switched to Inactive, six added. The owner ran two scripts; nothing of it is in the
  repository but the templates.
- **#668** — everyone sees their zone beside their name in the portal (`MARK II - "LAKE ZONE"`;
  a team code sees its team with the zone). The rule is in `api/_lib/zone.js`: among the teams
  the code may see, the teams that name the person on Teams & Staff, else the teams the code
  holds. One read of the teams table, at sign-in only (`/api/me?zone=1`), given a second and a
  half and no more; the version checks and `/api/upload` and `/api/call` read what they read
  before. Handbook Part 46; `test/zone.test.mjs`; `tools/browser-checks/portal-zone-name.mjs`.
  Not done: HOPE Calls, and the launcher's menu (`/?menu=1`), still show the bare name.
- **Outside the repository, 11 Nov** — an audit report for the owner (two pages, a Word file the
  owner holds), built from two exports of the loan system that the owner sent: Approved
  (Processed) and Defaulters, for one team and chosen dates. Nothing of it is in the repository,
  and the chat's own builder for it went with the chat's machine.
- **#667** — what the analysis of the move found, written into section 5, `docs/DEPLOY.md`
  section 7 and handbook Part 45. Words only. The full report, with the questions for Demit, is a
  private document the owner holds; it is not in the repository.
- **#666** — the two sites turned out to be two books, so the move was stopped (section 5).
  Handbook Part 44; `docs/DEPLOY.md` sections 6 and 7. Words only.
- **#665** — this file, and the book fingerprint: `CHAT.md`, `CLAUDE.md` section 3,
  `test/chat.test.mjs`; `/api/app-version` answers `book` (which database the site reads, as a
  fingerprint). Handbook Parts 42 and 43.
- **#664** — our own server answers a phone the way Vercel did: "not changed" (304), compression.
- **#662, #663** — HOPE Calls: a bike officer sees four lists, and their own summary in the top bar.
- **#661** — Salary advance: an undecided request of a month that is over is Expired.
- **#660** (Demit) — one workflow tests, then deploys to Vercel, AWS and our own server.
- **#655 to #659** — the Exp.Def Report by the day, the week and the month; the officer card.

**What a merge to `main` does today** (`.github/workflows/deploy.yml`, `docs/DEPLOY.md`): the tests
run; our own server pulls that exact commit and restarts (nobody has to approve); the Vercel and
AWS steps are skipped because their settings were never filled in. Vercel still deploys `main` by
itself, through its own link to GitHub, with no gap. Our own server restarts; measured once
(section 5), nothing was refused.

**People with access to the repository:** `samaritantechs` (the owner, admin) and `monkyaro`
(Demit, write).

## 5. In flight: moving to our own server — STOPPED, the two sites are two books

The order is in section 2 (11 Nov). Our own server is `https://recovery-app.sync-book.net`: one
machine, one Node process (`server.js`) behind Caddy, kept in step with `main` by the deploy
workflow. Vercel is `https://hope-pmo-v2-git-main-samaritantechs.vercel.app`, the address every
installed app opens today.

**Nobody has been moved, and nobody may be until the two sites read one database.** Each site
says which book it reads (`book` in `/api/app-version`, handbook Part 43). On 11 Nov they
answered:

| Site | `book` | Which database |
|---|---|---|
| Vercel | `79e363955e75` | the Supabase project: the book every installed app has worked on since August |
| Our own server | `9372d032c6ca` | `127.0.0.1:8000`: a database on the server's own machine, holding a **copy** |

Work done on our own server stays in the copy: it is on no report, on no other phone and in no
commission, and neither site says so. **Do no real work at the new address** until this is settled.

**What has to be decided — by the owner, with Demit — is which database is the book:**

1. **Supabase stays the book** (the small step, and the one recommended). In `/etc/hope-pmo.env`
   on the server, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` take the values Vercel has, and
   the service is restarted. The two sites are then one system and the move can go ahead at once.
2. **The database on our own machine becomes the book.** That moves the database, not an
   address: `docs/DEPLOY.md` section 7 lists what it takes.

**How a chat knows it is settled:** open the two addresses below. The same `book` on both is one
system. Check it first, every time, before touching the app's address.

    https://recovery-app.sync-book.net/api/app-version
    https://hope-pmo-v2-git-main-samaritantechs.vercel.app/api/app-version

**Then, and only then — Android app 20.** It opens our own server. If that cannot be opened (the
server is down, or the handset is too old to trust its certificate) the app opens Vercel by
itself, and only while Vercel answers the same `book`. The update check asks the reserve too, so
a handset can always be reached with a newer app. Nothing of this is built yet: which way the
reserve points depends on the decision above.

**What the analysis of 11 Nov added (handbook Part 45).** Three readings of the code finished
(the Android app; browsers and the systems that hold the old address; uploads and feeders). Five
did not: the account's usage limit cut the run. What they changed in the plan:

- **Never a redirect at Vercel or Caddy.** The installed app refuses any host but its own and
  hands the new address to the phone's browser: no call-log sync, an unregistered device. The
  forwarding is done inside the page: a browser is sent on (path, query and hash kept); a handset
  is never redirected.
- **App 20 goes out before any handset is moved.** A version-19 handset that has saved the new
  address has no way back if that server cannot be opened; its update check asks only the saved
  address. Handsets then move a team at a time, never all on one deploy.
- **Company phones with the lock app keep the Vercel address for life** (it is written once, at
  enrolment). Vercel must go on answering `/api/device` from the book the office uses, or issued
  phones lock themselves after 14 days. This is why "Supabase stays the book" is the way
  recommended: the other way needs Vercel pointed at the server's database in the same minute.
- **Anything that feeds data in automatically goes through `POST /api/upload`**, never straight
  into the tables: the upload also stamps the batch, rebuilds the officers' list, builds the
  totals and tells the handsets. `docs/DEPLOY.md` section 7 has the request.
- **Ours to build next, in this order:** the in-page forwarding (armed only when both sites read
  one book); app 20; the upload page naming the address and book it writes to and resending a
  slice after a 502 or 503; `server.js` refusing to forward a request to itself; the deploy check
  asking the running process for its version.
- **To confirm, then fix:** the sweep after an upload keeps the two newest uploads of a day across
  all teams, so a day sent as three files may lose the first.

**Also found on 11 Nov:**

- Our own server is up, serves the same `BUILD` and `CALL_BUILD` as Vercel, compresses, and
  answers "not changed". A deploy restarted it while it was asked for its health 484 times in five
  minutes: every one answered, none slower than a second. That was with no traffic. Under load
  the service takes no new connection until the requests in flight finish, which during an upload
  slice can be most of a minute.
- Its certificate is from Let's Encrypt. **Android 6 and 7.0 do not trust it** (that authority
  joined Android's trusted list in 7.1.1); Vercel's they do trust. A handset that old cannot open
  our own server at all. Not tried on such a phone: it is read off the certificate.

**For the web there is nothing to build**, once the books are one. People open the new address.
Each browser signs in once there (a browser keeps its access code per address) and allows
notifications again. The owner sets Settings → `APP_BASE_URL` to the new address, so the links in
e-mails lead to it.

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
- **A team of analysts can spend the account's five-hour allowance in ten minutes.** On 11 Nov
  eight of them did, and the chat could not answer the owner for over two hours. Keep a team
  small, give each member a narrow question, and deliver what is ready first.
- **`grep` calls `public/app.html` a binary file** and prints nothing useful: use `grep -a`.
- **A document for the owner's management goes out whole.** On 11 Nov a report was sent with two
  lines still waiting on figures, and the answer was: "You cant provide report before including
  negligances bro". Say what is missing and what it waits on; send the document when nothing is.
- **A zone has the name Teams & Staff files it under.** A GMO's word for a zone and the filed
  one can differ. Scripts and screens read the teams table; never type a zone from a message.
- **Ask for the exports before writing a dig.** The loan system exports Approved (Processed) and
  Defaulters for one team and any dates, with balances. On 11 Nov an SQL dig that took 70 ms on a
  test book of the live book's size ended in "upstream timeout" in the SQL editor; the owner's
  two exports answered the same question in minutes ("Check from here no need of sql"). A dig is
  not proven until it has run on the live book, and a chat cannot run it there.

## 8. Waiting on someone

- **The owner, with Demit — first of all**: which database is the book (section 5). The move
  waits on it. The owner has the questions for Demit, in order, in the report of 11 Nov.
- **Demit / the server**: the list in `docs/DEPLOY.md` section 6.
- **The owner**: rotating the keys shared in November (`docs/SECURITY.md` section 1); the historic
  sales upload for the Audit report's whole-portfolio PAR; whether the e-mailed reports arrive.
  The older list in `docs/HANDOFF.md` Part 15 ("Waiting on you") has not been checked again.
  Optional, once: `db/RUN-ME-2026-11-11-hint-zone-beside-name.sql` (the tip that says where a
  zone beside a name comes from; the zone shows without it).
- **Offered, never asked for — do not start without a yes**: a Zone box on an access code, to set
  a person's zone directly whatever Teams & Staff says; a one-tap download of every approved
  loan; the month view of the Exp.Def Report as the sum of its weeks; removing the server action
  `emailWeeklyExpdf`, whose button went in #655.

## 9. The chats so far

| Chat | Ran | Ended |
|---|---|---|
| "HOPE PMO v2 dashboard aggregation" (`session_015VhcZpofMwgR54shZGarYp`, branch `claude/recovery-percent-basis-md87x9-85o7ox`) | 4 Aug to 11 Nov 2026, up to #664 | Passed its size limit. It can still be read; it cannot take a message. |
| The chat that wrote this file (`session_01StRZE69GhZa1GsVBHZHu1g`, branch `claude/kind-cerf-u7t6vm`) | from 11 Nov 2026 | — |

A commit's `Claude-Session` line says which chat made it.
