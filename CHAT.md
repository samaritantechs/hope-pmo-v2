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

**As of 13 November 2026** — portal `BUILD 2026-11-13-f` · call app `CALL_BUILD 2026-11-11-b` ·
Android app `versionCode 19` · handbook `docs/HANDOFF.md` up to **Part 70**.

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

| 11 Nov 2026 | "Ill be comming with staff db updates simce GMOs comfirm of changes in my whatsapp group" · "dont correct names using the gmo data i bring unless its new staff" · "so provide sql to add staff as we always did" | Staff changes come pasted from the WhatsApp group: who left, who was transferred where and as what, who is new (with phone, account, NIDA, TIN, NSSF), who a GMO cannot see. Answer with a filled copy of `db/TEMPLATE-staff-changes-from-gmo.sql` (one row a person: OFF, MOVE, PLACE, NEW, ASK); a name already in the staff registry is never re-spelt; a GMO's spelling is taken for a new staff only; the ones that come back NOT FOUND are settled by staff ID (`db/TEMPLATE-staff-changes-by-id.sql`). No staff name is committed. Handbook Parts 48 and 49. |
| 11 Nov 2026 | "If an officer has team - zone is automatic of the GMO's" · "to the respective team's gmo" · "So even manager - must have gmo of one of his team and auto match gmo and zone" | **A team's zone is its GMO's.** A team whose ZONE cell on Teams & Staff is empty sits in the zone its GMO's other teams carry, when they all carry the same one; what is typed on the team stands. **The rule never chooses:** a GMO named on teams of several zones gives none. The name line, the advance desk and the staff scripts read that one rule (`teamsZoned` in `api/_lib/zone.js`; `tz` in the template). Never ask the owner to fill a ZONE cell so that a staff can be filed: read the team's GMO, and ask only when the team has neither a ZONE nor a GMO whose teams all carry one zone. Handbook Parts 50 and 52. |
| 13 Nov 2026 | "remove that reminder of key rotations - i dont wanty to keep hearing that from you bro" | **Never raise the Supabase key rotation again, unprompted.** It is still true and still the owner's to do whenever they choose, but a chat does not repeat it -- not on its own initiative, not folded into another answer. If the owner ever asks directly, answer it; otherwise it stays unsaid. |
| 12 Nov 2026 | "always Auto default grant all tabs to admin role. i dont have to go manually grant all new tabs i create" | Admin's own access to a screen was never actually gated on a hand-typed list in the first place — `allowed()` in `app.html` and `tabGate_` in `portal-core.js` both pass anyone whose role reads ADMIN before either one ever looks at a tabs list, and that stays true for every tab this system has or will have, with no step of any kind. What a new tab's id still has to be named in, once, is `EXTRA_TABS` (`api/_lib/auth.js`) — not for admin's sake, but because that is the one list the Roles & access screen reads to offer a checkbox for granting the tab to a *different* role; `ADMIN_TABS` is now computed from it rather than carrying a second, separately-typed copy, so the two can no longer drift apart the way they did the day this order was given (`leave`/`leaverep` named in one and not the other). |

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

- **#696** — the worklists keep a cleared customer too, sunk to the bottom, not off the list
  (handbook Part 70). "So even in call app if they clear they go down with status cleared..
  same for the rest defaulters lists if possible" -- the owner, right after confirming the
  TABORA TOWN case (below) was the loan system's own gap, not this one's. #693's own worklist
  exclusion ("nobody should be shown a call to make on an account that is already settled") is
  reversed: `expdfMine` no longer excludes a cleared row, which now sinks to the bottom of the
  phone's own list and the portal's on the arrears-descending sort it already had (0 sorts
  last) -- no new sort, no new field. The status label is renamed `RECOVERED` -> `CLEARED`
  everywhere (`buildRows_`), matching the owner's own word -- and, checked rather than assumed,
  both `call.html`'s and `app.html`'s own shared status-chip classifiers already render
  `CLEARED` green, and the phone's own Exp.Def list filters by role or day, never by status, so
  the call app needed NO change at all; `CALL_BUILD` is untouched. `expectedDefaulters`
  (portal-core.js, the "Expected Defaulters" tab -- the other worklist #693 named and
  deliberately left alone) gets the identical relaxation `buildRows_` already has, word for
  word the same condition -- one rule, read twice, which is not the same promise as "the two
  can never disagree": `expectedDefaulters` resolves "today" through the latest deck of ANY
  weekday, `buildRows_` through `expdfCore`'s own weekday-PINNED resolution (falls back to last
  week's same weekday when today's has not landed), a deliberate pre-existing split this change
  does not close -- on a morning the day's deck is late, the same customer can read CLEARED on
  one tab and be entirely absent from the other three. The one front-end touch is `app.html`'s
  own `defexp` screen: its screen-local status chip (CHRONIC/EXPIRED only, everything else flat
  grey) gained a CLEARED branch, its status filter gained the option, and its "In the weekly
  cycle" KPI's own words were corrected, since it now counts anyone cleared too.
  `BUILD 2026-11-13-f`.
  **Reviewed by two independent readers before this merged**, given it reverses a decision on
  the sacred call path: one real bug. CLEARED was decided by status-TEXT elimination alone, no
  check of `arrears` -- a blank or unrecognised status (the suite's own long-standing `'555'`
  fixture: no status, partially paid, 350 still owed) came back CLEARED, rendered green, and
  SORTED FIRST on an officer's list (plain arrears-descending sort; a mislabelled CLEARED row
  with real arrears is promoted, not sunk) -- while genuinely owing money. This codebase already
  has the one rule for "is this actually paid" (`api/_lib/settled.js`'s `isSettled`, written
  after a real customer sat on a phone as a defaulter owing one shilling while the expected book
  had her overpaid); this change had reinvented a wrong one instead of reading the right one.
  Fixed: `isSettled(arrears)` gates CLEARED in both functions; anything else keeps its own
  status text, or DEFAULTER with none, the same fallback `statusWithPaid` already uses. Two new
  regression tests reproduce the review's own scenario directly. Checked with four tests in all
  (two rewritten for #696's own claim flipping from exclusion to inclusion, two new for the
  review's finding) across `test/portal.test.mjs` and `test/call.test.mjs` -- the latter also
  proving SORT ORDER, a cleared customer sinking below a real defaulter sharing their bucket,
  through the real call dispatch. One real fixture bug caught before any of them passed: two
  customers of the same team/day given different `upload_batch` ids made one lose to the other
  under `pickLatestBatch`'s own per-team rule (a real upload never does this); fixed by sharing
  one batch id, the way an upload actually arrives. No new read anywhere. `npm test`: 1,525
  pass. **Not done:** the weekday-pinned-vs-any-weekday split above, a separate and larger
  question than this one status label; and the harder case #693 named, still not reached -- a
  customer missing from a day's current deck entirely, which the TABORA TOWN case (below) turned
  out to be the loan system's own gap, not a reason to build a backward-looking diff on a guess
  about what it would cost the sacred call path.
- **TABORA TOWN check, 13 Nov — closed, not this codebase.** Ref 4231948032 (Chronic, 15,500
  arrears, days_elapsed 149) sat on no Exp.Def list anywhere -- portal or call app -- for
  Thursday 12 Nov: the real-world instance of the one gap #693 named and left open, a customer
  absent from the day's own current deck entirely rather than present with a changed status.
  The owner checked the loan system itself, not only this database, and confirmed: the customer
  was already missing from the loan system's own 12 Nov deck. Nothing was lost between the loan
  system and this one -- the upload wrote down exactly what it was sent, and `buildRows_` /
  `expdfMine` / `expectedDefaulters` had nothing to find because there was nothing to find.
  Whatever took the customer off that one day's export happened upstream, in the loan system,
  for a reason outside what a chat can see or guess at from here. Not investigated further.
- **Staff registry, 13 Nov (second)** — "Hajioni kwenye kuomba salary advance" ("From baiki
  recovery to Fo Chamwino"), for FRANK MICHAEL MWELUE, with his phone, CRDB account, 20-digit
  NIDA and TIN — the same flag as the four officers already filed that morning ("Staff
  registry, 13 Nov" below), sent as its own message. PLACE, run by the owner: MOVED
  (`FMM/4044/2026`). The result shows his zone was never wrong (MORO-DOM, both before and
  after) and he was already on Team Chamwino — what actually changed is the ROLE WORD,
  `Bike Recovery - Team Chamwino` to `Field Officer - CHAMWINO`, confirmed against the code
  rather than assumed (`advRoleWords_` / `advRoleSame_`, `api/_lib/portal-core.js`): the
  request tab lists a name only under the viewer's own role, first words compared after
  `ADV_ROLE_ALIAS` ('TEAM'/'TEAMS'/'FO'/'OFFICER' alias to FIELD OFFICER) — 'BIKE' and
  'RECOVERY' alias to nothing, so a Field-Officer-signed-in code could never see a staff filed
  under that exact wording, whatever zone or team the row carried. NSSF, sent as "On Process",
  is left out of the script as always — one more number waiting on section 8, beside Kassim
  Shabani Muhidini's and Sylvester Erick Maundi's. Tested twice against a synthetic registry
  before it was handed over. The name is in no file of the repository.
- **#693** — a customer who pays in full stays on the Exp.Def Report, not just on the worklist
  (handbook Part 69). "When a customer of expected defaulter pays full amount and no longer a
  defaulter, they dessapear from the expected defaulters report, yet they should stay there as
  of recovery so as to know recovery amount from difference of initial to current per each day
  by team or staff" — and, asked whether the row still exists with a changed status or vanishes
  from the upload entirely: "of today are of today by cycle ... they cant run from when their
  initial file had them and their initial cycle placed them when and the initial and final
  amounts." The dashboard's own team-level recovery figures were never affected (a customer's
  absence already reads as zero arrears there, by construction); the real gap was `buildRows_`
  (`api/_lib/expdf.js`), the one shared definition of "a day's Exp.Def row" behind both the
  portal's Exp.Def Report / leader cards and the phone's own worklist (`expdfMine`) — it kept a
  row only while its status read Chronic/Expired/Defaulter, so a customer who paid in full
  dropped out of the day's own record entirely, report and worklist alike. Now it also keeps
  anyone on TODAY'S OWN INITIAL deck regardless of current status, labelled `RECOVERED`, with
  `role`/`leader`/`cycle` left exactly as `assignFor` computes them — unconditionally, the same
  as any other day, which is both what credits the right officer and what keeps the two
  rotation-gated filters (`periodRows_`, `expdfMine`) from silently dropping the row the way a
  first, reverted draft of this did by nulling them out. `expdfMine` alone then excludes a
  `RECOVERED` row with its own one-line filter: a worklist read by the phone — `/api/call`'s own
  `call-core.js` calls nothing but `expdfMine`, confirmed by its two call sites — should never
  show a call to make on a settled account. Checked, not assumed, against a second, separately
  written function with the same old filter (`expectedDefaulters`, the portal's own "Expected
  Defaulters" tab): its own doc comments, its KPI ("needing follow-up") and its status dropdown
  (DEFAULTER/EXPIRED/CHRONIC only, no team or leader totals) all say it is a worklist like
  `expdfMine`, not the "by team or staff" report the owner described — so it is untouched, and
  its own net effect on who it lists is confirmed unchanged against the broadened-then-narrowed
  `expdfMine`. Checked with two tests: a new one in `test/portal.test.mjs` (the right section
  and the right leader's own card both credit the recovery; `expdfMine`'s own worklist drops the
  row) and a new one in `test/call.test.mjs`, through the real call dispatch rather than the
  call graph alone (`api_callList('expdf')`, both leader-scoped and team-scoped, and
  `api_callDailySummary`'s own Exp.Def %, against a fixture where the row would otherwise have
  been sitting right on the list). No new read (the data was already fetched for the `initial`
  figure every row has always carried); no front-end file touched, so `BUILD` stays
  `2026-11-13-e`. `npm test`: 1,522 pass. **Not done:** the harder case the owner's own answer
  ruled out of scope — a customer missing from the upload's current deck entirely, not merely
  present under a different status — still cannot be credited to a specific leader, since
  `assignFor` needs fields that live only on a current-deck row; flagged for if it is ever asked
  about, not built on a guess.
- **#692** — the annual leave allowance resets each calendar year (handbook Part 68). "26-day
  annual leave allowance should reset each calendar year" -- answering the question Parts 58
  and 59 flagged rather than guessed. `leaveBalance_` now sums only the current calendar
  year's own requests (by `nowMs`, never whatever dates a report happens to be filtered to) --
  a past year's Approved days are kept in the table and the report exactly as before, they
  simply stop costing the new year's allowance. One more `gte`/`lte` on a query that already
  ran; the returned shape is unchanged so no caller needed touching. Checked with a new test
  alongside the fifteen existing ones: a past-year request leaves this year's balance full,
  this year's own request still counts as before, and the past request still shows when a
  report is asked for that year specifically. No new read, no front-end file touched: `BUILD`
  stays `2026-11-13-e`. `npm test`: 1,520 pass.
- **#691** — a name beside the percentage, Early Collection on the strip, Inactive staff
  sorted last (handbook Part 67). "Sales % [credit analyst] ... Performance · wastani
  [leading leader ... e.g Robert. Manager 80%] ... so add [name of the leading leader
  infornt of percentage like Amina 76%]" ... "add ealy col widget... add ealy col cards" ...
  "auto default deactivated staff to be below on the staff list". Two scope questions were
  costed and asked before building anything (company-wide vs the viewer's own teams for the
  leader ranking; week-over-week vs month-to-date for Early Collection) — the owner chose the
  cheaper of each. Each of the four strip tiles now names the best this week among the teams
  the viewer sees (Sales → Credit Analyst, Collection → PMO collection officer, Recovery →
  PMO Recovery officer, Performance · wastani → any of the nine roles a team carries, so a
  Manager can lead it on his own average). No new read and no `weekPcts_` call per leader: one
  pass buckets the same sources `weekPcts_` already reads by team, so ranking costs summing a
  few Map lookups, not re-walking the dataset once per name; `weekPcts_` itself is untouched.
  Early Collection (`perf.ecolPct`) reads the same month ledger the Orodha's own M. columns
  already fetch — zero new reads — labelled "· MTD" since it is the one month-scoped tile on
  an otherwise week-over-week strip; its own card (between Sales trend and Weekly expected
  trend) says plainly it carries no day-by-day map, since the ledger keeps none. **Caught by
  the estate-wide parity test** (`test/snapshot-totals.test.mjs`, runs every dashboard-shaped
  screen twice — database sums vs. rows added up in memory — and asserts they agree): the three
  new `perf.ecol*` fields are exactly as ledger-dependent as the Orodha's own `mEColPct` (one
  already-sanctioned divergence without the migration), but sit under `perf`, a sibling of
  `teamPerf` the existing `withoutLedger()` helper's strip-list did not reach — fixed by
  extending that helper the documented way, not by weakening the check. Inactive staff now
  sort below Active ones on the HR staff list (`advStaff`'s one query, ordered by status then
  name — 'Active' sorts before 'Inactive' in plain alphabetical order, so this needed no
  second column and no CASE PostgREST's own `.order()` cannot take). No read on `/api/upload`
  or `/api/call`. `npm test`: 1,519 pass. `BUILD 2026-11-13-e`. **Not done:** whether a leader
  who wins more than one tile should be called out as such is undecided — nobody asked either
  way.
- **Staff registry, 13 Nov** — a WhatsApp thread mixing several teams' changes in one paste:
  Team Masasi (two OFF), Team Njombe (one PLACE with a bank account, three OFF), a Zone
  South East correction (Iringa Area Bike Recovery, one PLACE with a bank account), and four
  officers the P.M.O Supervisor flagged as missing from the Advance Salary request list in
  the Call app (Team Chamwino, Bike Recovery Moro Center x2, the Kihonda Area manager — each
  PLACE: moved to their team and their empty details filled in, exactly what that flag
  means). The Chamwino/Moro Center/Kihonda block was sent to the group twice (tagged once
  to the P.M.O Supervisor, once to the owner): read as one message, not eight more people.
  Left as ASK, not guessed: a transfer named by one name only, with no surname and no
  destination team ("Nyenje kahamia kutoka bunda"). Not filed at all, for lack of a surname
  or team: a confirmation that somebody already has a month of work and has been paid. Two
  of the PLACE rows carry a TIN and an NSSF number still "on process" — left out of the
  script rather than written as that literal text; worth a follow-up once issued. The filled
  copy went to the owner directly (never committed); it changes nothing by itself. Team-name
  spelling for two rows (Kihonda Area, and the Zone South East wording) is a best guess with
  more than one candidate given — the script says so itself if none match.
- **#690** — each day's own arrow, against the same weekday last week (handbook Part 66). "i
  now need comparison of this Friday to that of last week" ... "arrows inside each day's card"
  -- #689 put one arrow on each card comparing the WEEK's total; every one of the 28 weekday
  tiles across the four cards now carries its own, each day against the same weekday the week
  before. No new read: every figure needed was already in memory for the week-level arrow
  (`myLoans` for apps/sales, `myExpPrev`/`myDefPrev` for collection, `stand` already spanning
  both weeks for recovery); apps reuses #688's own steadier, stage-agnostic rule for the same
  reason the week-level arrow needs it (a day a week old has drained, a fresh day has not);
  recovery's two weekend tiles, which already carry no percentage, carry no arrow either. `tcell`
  (`public/app.html`) takes a new optional fifth argument, mirroring `trendGrid`'s own sixth.
  **Caught before it shipped:** the first draft defined the apps helper AFTER the loop that now
  needs it inside itself -- a `const` used before its own line throws, and 61 tests failed with
  it; moved the definition earlier, `npm test` back to one real failure (a source-pattern test
  pinned to the old four-argument shape of the recovery card's `tcell` calls, updated to match
  the five-argument one, since the shape it pins genuinely changed). `npm test`: 1,517 pass. No
  read on `/api/upload` or `/api/call`. `BUILD 2026-11-13-d`. **Not done:** whether the
  week-level arrow still earns its place on each card's own title now that every day beneath it
  has one too is not decided -- nobody asked for it to be removed.
- **#689** — the arrows moved onto the four cards themselves (handbook Part 65). "i meant
  arrows on cards of: Loan applications (Mon-Sun) ... Sales trend (Mon-Sat) ... Weekly expected
  trend (Mon-Fri) ... Weekly recovery trend (Mon-Sun)" -- #687/#688 had put the arrow on a
  separate performance-strip tile instead of on the named cards. Moved, not rebuilt: every
  delta (`dSales`/`dCol`/`dRec`/`dApps`) was already computed by #687/#688, so this is a
  client-only change -- `trendGrid` (`public/app.html`) now takes an optional sixth argument,
  the arrow's own HTML, rendered beside the card's title; the "Loan apps" strip tile is
  removed (its number now lives on the Loan Applications card itself); Sales %, Collection %,
  Recovery % and the average stay on the strip exactly as they were before any of this started
  -- nothing asked for their removal. No server change, no new read: `BUILD 2026-11-13-c`.
  **Not done:** whether the strip should shrink now that three of its four deltas also sit on
  their own cards is not decided -- nothing was asked to be removed beyond the one tile that
  was this change's own recent addition.
- **#688** — the loan-apps arrow's false fall, fixed (handbook Part 64). "not yet", with a
  screenshot: Loan apps 486, down from 741 -- a steep drop that was an artifact, not a trend.
  #685's own "unassigned/assigned, read right now" rule is a CURRENT snapshot: by the time a
  week is a week old, a real share of what it brought in has already been assigned, approved
  or rejected and so no longer counted -- 741 was whatever was LEFT of last week's intake, not
  what actually arrived. Fixed with a second, steadier rule, `appsArrivedInRange_`: every
  application that arrived that week counts, whatever stage it sits at now -- the trend card
  right below the strip is untouched, keeps answering "how much of this week is still
  unworked," and the two numbers on this one screen are now allowed to disagree, on purpose,
  with both the server and client code saying so. **Also checked first, per section 5:** the
  screenshot was from `recovery-app.sync-book.net`; the two sites are still reading different
  databases (checked fresh, unchanged since the morning's 8-hourly report), so those exact
  figures may not be live company data -- but the arrow's logic is the same wherever it runs,
  and the distortion is real on its own terms either way. Checked by rewriting the direct test
  from #687 with the exact case: an application that arrived last week and has since been
  rejected still counts toward last week's total; one that arrived this week and has since
  been approved still counts toward the strip's arrival total but correctly drops out of the
  trend card's own backlog total. `npm test`: 1,516 pass (same count: one test rewritten, not
  added). No read on `/api/upload` or `/api/call`; no new read at all. `BUILD 2026-11-13-b`.
  **Not done:** whether the screen needs its own on-screen word explaining why the strip's
  count and the trend card's count can now differ, beyond what the code comments and this
  handbook say, is not decided.
- **#687** — a fourth arrow on the dashboard: loan apps joins sales, collection and recovery
  (handbook Part 63). "Also Show the single rising and droping arrow in each of loan apps,
  sales, collection and recovery cards at dashbord against last weeks perfomancve." The
  performance strip already carried this for three of the four (Sales %, Collection %,
  Recovery %, and their average, each with `trendArrow`); **Loan apps** now joins them, first
  in the row, with the week's count and the same ▲/▼/▬ arrow against last week's count. It
  reads the exact rule the "Loan applications" trend card right below the strip already uses
  (unassigned/assigned stage, by upload day -- `appsInRange_`, factored out of `appsTrend` in
  `dashboardFull` so the two totals can never disagree), rather than a second definition of
  "an application." **The one honest caveat:** that rule is a CURRENT snapshot, not a frozen
  one -- an application unassigned last Monday that has since been approved no longer counts
  in last week's own total read today, so the arrow can move for a reason that has nothing to
  do with how many applications actually arrived. This is not new: the trend card beside it
  has always read the same way, and reusing its exact rule is what keeps the two numbers on
  one screen from disagreeing. Checked with a new, direct test proving the arrow is a plain
  count difference (never a fake "%"), is never null (myLoans is read for the whole span
  unconditionally, no budget risk the other three arrows carry), and agrees with
  `appsTrend`'s own weekly total to the row. `npm test`: 1,516 pass. No read on `/api/upload`
  or `/api/call` -- this function serves neither; no new read at all, `appsInRange_` only
  reshapes data `dashboardFull` already held for the sales-percentage arrow. `BUILD
  2026-11-13-a`. **Not done:** no `hints` table tip (the tile sits beside three others already
  labelled the same way); no real-browser check (no database access to sign in and load a
  live dashboard -- every inline script in `app.html` is still parsed by `test/pages.test.mjs`,
  part of `npm test`); whether a steadier, current-stage-independent apps definition would
  serve this arrow better is a separate, open question.
- **#685** — a trigram index for the Legal tab's name/ref search (handbook Part 62). "postgress
  is unsettled", with the dashboard's own error graph and the exact query the New-notice drawer's
  search box sends (`ref`/`full_name ILIKE '%term%'`, scoped by snapshot_type, snapshot_date and
  team). That query is `legalFind` (`api/_lib/portal-core.js`), gated to the `legal` tab only —
  confirmed absent from `api/upload.js` and `api/call.js`/`call-core.js`, so neither sacred path
  reads it, whatever the cause of the spike. Its leading-wildcard `ILIKE` cannot use any of
  `defaulter_snapshots`' six existing indexes for the text match itself; only `pg_trgm` can.
  `db/RUN-ME-054-legal-find-trigram-index.sql` adds two GIN trigram indexes, on `full_name` and
  on `ref`, built `CONCURRENTLY` so `/api/upload`'s own writes to that table are never blocked
  while they build. Verified on a 2.27-million-row fixture sized like the live book (42 teams,
  150 days, two snapshot_types), with `EXPLAIN (ANALYZE, BUFFERS)` before and after: a real name
  or ref search drops from 151 ms to 23-79 ms, a ref search to under 3 ms — and, reported rather
  than hidden, the one honest cost: a bare 3-character fragment common across many names (the
  search box's own floor) can come back a little SLOWER with the index (19.6 ms → 41.8 ms) than
  without it, since the old plan could stop early walking a date index backward and the new one
  first gathers every trigram match. No code changed, no `BUILD` bump — a database-only change.
  **Run and confirmed by the owner on 12 Nov:** both indexes are valid on the live table —
  `idx_def_snap_fullname_trgm` 165MB, `idx_def_snap_ref_trgm` 73MB (three to four times this
  change's own 2.27-million-row test fixture, so the live table is itself several times bigger
  than what this was tested against — the fix was warranted at real scale, not only on a
  synthetic one). The first attempt at the full_name index died silently mid-build: the SQL
  editor's own tab kept reading "Running..." long after the server-side build had actually
  stopped, leaving an invalid index behind under the same name — `pg_stat_progress_create_index`
  returning zero rows is what showed nothing was building any more; `drop index concurrently if
  exists ...` followed by a clean re-run in a fresh tab fixed it. **Not done:** whether this
  exact query caused the dashboard's own spike is still open; a chat has no access to Supabase's
  Postgres logs to confirm it either way.
- **#684** — Clicking a name on Omba Likizo: the ask form's fields wired before they existed
  (handbook Part 61). "clicking name on omba likizo - Imeshindikana / Could not load. Cannot set
  properties of null (setting 'onchange')." `VIEWS.leavereq` wired `#lvReason`/`#lvStart`/
  `#lvEnd`/`#lvSubmit` inside its own promise, which resolves BEFORE `drawView_()` paints `HEAD`
  into the page -- so the first time a name was ever picked (the moment those elements are
  first drawn at all), the wiring reached a DOM that did not have them yet, threw on
  `null.onchange`, and the whole render aborted before painting: exactly "Imeshindikana / Could
  not load." The same bug class HOPE Loan's own HEAD buttons had on first write (the note
  beside `wireLnCs_` in `app.html`); advance's own ask screen never had it, because its one
  button is wired from the core's `wireForms()` and reads its chosen staff from `S.advReq`
  itself, no argument to capture. Fixed the same way: all four now wired from
  `wireLeaveDesk()`, called from the core's `wireBar()` after the paint -- the function's own
  comment already said it was meant to cover "any of its three tabs," it just never had these
  four added to it. `leaveSubmit_` takes no argument any more, reading `S.leaveReq.chosen`
  itself like `advSubmit()` does. Checked two ways: a new real-browser check,
  `tools/browser-checks/portal-leave-ask.mjs` (picks a name, confirms no script error, confirms
  all four are genuinely wired and do something, submits one request with what was typed --
  times out waiting for the form to ever appear against the original code), and a fast
  source-level test in `test/pages.test.mjs` pinning the same shape, part of `npm test`. `npm
  test`: 1,515 pass. No read on `/api/upload` or `/api/call`; `BUILD 2026-11-12-e`. **Not
  done:** the desk and report tabs needed no change, already wired the right way since they
  were built.
- **#682** — Expected Defaulters, full week: Sunday is a day of its own, not folded into Monday
  (handbook Part 60). "i said lets give all the expected defaulters to sunday for full week
  recoveries. am sure assignments fall there too bro." Both copies of `rollSun` (one in
  `portal-core.js`, one in `expdf.js`) are gone: a loan's two cycle days, and the live "which day
  is today" clock, now read the real weekday (1-7) everywhere, so Sunday is a day in its own
  right -- a loan disbursed Thursday keeps its own Day 2 on Sunday instead of Monday, a loan
  disbursed on a Sunday can now be anybody's Day 1, and the Exp.Def Report's leader cards show a
  Sunday column and tab the same as every other day, filed or not (`xdShowDay_`'s own
  Sunday-only-if-measured suppression is gone too). "Assignments" turned out to be the Exp.Def
  list's own distribution board under another name -- the dedicated Defaulter Assignment screen
  carries no weekday logic of its own at all, so nothing there needed to change. A real
  behaviour change, not only cosmetic: a customer whose true two days never touched Sunday
  (disbursed Friday: Friday and Monday) is no longer credited for money that happened to move on
  a Sunday, the same as it never was for an off-cycle Wednesday either -- the old credit only
  ever existed because a real Sunday's clock was forced to equal Monday's slot number. Checked
  with a new, direct test against the live list (Thursday- and Sunday-disbursed loans keep
  Sunday as their own slot) and corrected the two existing weekly-report tests whose figures
  depended on the old fold: one was given a new, locally-added customer whose cycle genuinely
  reaches Sunday, proving Sunday's own recovery is counted; the other needed none -- it proves
  the ghost credit's removal on the pre-existing customer, Sunday's tab still there and
  correctly empty. **Reviewed** by two independent readers before this merged, both finding the
  same real gap: the first draft of this entry (and of handbook Part 60) said neither
  `/api/upload` nor `/api/call` imports `expdf.js` -- true for `upload.js`, **false for
  `call.js`**, whose `call-core.js` calls `expdfMine` (the same shared function) from the phone's
  own Exp.Def list and its EXP.DEF% strip figure. The right design -- one shared definition, not
  a third copy -- and no new read or latency either way (both call sites predate this commit),
  but untested beforehand. Fixed with a new test in `test/call.test.mjs` proving the phone's own
  two entry points see a Thursday-disbursed customer's Sunday correctly. `npm test`: 1,514 pass.
  No new read or query on `/api/upload` or `/api/call`; `BUILD 2026-11-12-d`. **Not done:**
  whether off-cycle-day recovery (any day, not only Sunday) should count at all is a separate
  question, untouched either way.
- **#681** — Leave becomes three tabs, its tunnel is advance's own approvers, its annual
  allowance moves onto the report (handbook Part 59). "it needs to be 3 tabs to fit perfection
  like advances ... request tab, approval tab and reports tab" · "Advance approver = Leave
  approver. i dont have to start ressetting those. even pull the nav grantings of advance tabs
  so that we use sql to grant leave tabs to the same tunnels" · "remember we had holiday max
  days pert staff - i think we have this settung at report tab." `leave` split into `leavereq`
  (the ask) and `leaveappr` (the desk, hidden from an idle holder by `withoutIdleApprovalTab`,
  generalised to take a tab name instead of staying hard-coded to advance's own `advappr`); no
  fourth HR-registry tab, advance's own `advstaff` is still reused. The routing-level
  "advance approver = leave approver" was already true (Part 58 reused advance's routing
  wholesale); what still needed a hand was the NAV GRANT, so `db/RUN-ME-052-leave-tabs-from-
  advance.sql` copies it: every role or code holding `advreq`/`advappr`/`advrep` gets the
  matching leave tab added, safe to re-run; `db/RUN-ME-053-leave-tabs-from-advance-read-only.sql`
  is the read-only preview, run before and after to see the difference. `LEAVE_ANNUAL_DAYS` now
  has the edit on the report the owner expected (admin-only, `leaveSetAnnualDays`). **Reviewed**
  by two independent readers before this merged: one real finding, confirmed and fixed —
  `leaveSetAnnualDays` checked `isAdminUser(user)`, which means "sees the admin screens" (every
  AUDITOR/read-only code is given the `settings` tab on purpose, so an auditor passes it too),
  not "may write" — and it had not been added to `AUDITED`, so the one door's own read-only wall
  (`WRITE_FNS`, `_lib/portal-core.js`) never saw it either. A view-only code — exactly the
  credential this system is built to let "try every screen and change nothing" — could change
  the company-wide annual leave allowance. Reproduced against the real test harness, then fixed
  the way its siblings (`settingSet`, `settingDelete`, `systemOpenSet`) already were: added to
  `AUDITED` (`api/_lib/audit.js`), with a case for it in `test/portal.test.mjs`'s own "every
  write is refused at the one door" test. Also, cosmetically: the read-only preview file is
  renamed from `CHECK-leave-tabs-from-advance.sql` to the numbered `RUN-ME-NNN-...-read-only`
  form the one other read-only script in `db/` already uses, so `db/` keeps one naming rule, not
  two. `npm test`: 1,512 pass (same count: the new case joined an existing test's list). No read
  on `/api/upload` or `/api/call`; `BUILD 2026-11-12-c`. `RUN-ME-051`, `RUN-ME-052` and
  `RUN-ME-053` were run by the owner on 12 Nov; `RUN-ME-053`'s own after-the-fact check came
  back clean -- every role and code holding an advance tab holds the matching leave tab, no
  row left out, no row with one it should not have.
- **Staff registry, 12 Nov** — a CS Supervisor's WhatsApp message naming two staff with bank
  details missing, one with a full intake-style form (birth date, start date, residence, bank
  account, five guarantors) and one with only a name and a number. Neither role, team nor zone
  came with either, so neither can be matched or filed safely: asked (`ASK`), not moved, placed
  or added — a script never guesses whether a name is a new hire or an existing staff with a
  gap, the same as it never merges two staff records on a name alone. The filled script went to
  the owner directly (never committed); it changes nothing by itself and says, for each person,
  exactly what is needed to act — role and team (or, for a head-office role, the zone directly)
  if new, or a staff ID / their filed team if existing. Flagged on the row and separately: the
  registry has no box for a marital status or an e-mail address (neither is stored either way);
  of five named guarantors on the fuller form, only one fits the registry's two guarantor/kin
  slots (the other four are named for the owner's own record, not silently dropped) — which one
  is kept is the owner's to say once the first question is answered. Tested twice against a
  synthetic registry (ASK matches and changes nothing, and running it twice gives the same
  answer both times). The names are in no file of the repository.
- **#680** — Leave / Holiday requests: the FOMU YA RUHUSA NA LIKIZO sheet, moved in (handbook
  Part 58). "We need to add 2 tabs: Leave / holiday where staff request leaves & holidays, the
  Leave reports – for leaves and holiday reports management ... the tunnels and approvals must
  be the same to advances when people request leaves / holidays." Two tabs (`leave`, the ask
  and, for an approver, the desk together; `leaverep`, the report), one new table
  (`leave_requests`, `db/RUN-ME-051-leave-requests.sql`), and the approval tunnel written once:
  a leave request carries the same `req_role` / `req_code` / `zone` an advance request would, so
  advance's own routing (`advRouting_`, `advRouteOf_`, `advDeskOf_`, `advSees_`, `advHolds_`)
  decides a leave request exactly the way it decides an advance, with no second copy. Not
  carried over, on purpose: advance's calendar-month unit and Finalize/Reopen (leave has no
  payroll month to close; it expires instead by its own start date, not decided before it
  arrives); the one-per-month limit (replaced by an overlap check on this person's own other
  open request, which the Google Form never had at all); the balance exactly as the sheet's own
  unconditional `SUMIF` read it (a Disapproved or Pending request no longer costs the balance;
  only Approved days do; Pending is shown, not subtracted); a third, separately-typed day count
  (the sheet's own rows show two disagreeing with each other; here `days` is always the two
  dates, inclusive); a reset of the balance on a new year (nothing resets it, exactly as the
  sheet's own formula never did — **whether it should is the owner's to decide, flagged, not
  guessed**). `advDeskLine_` moved from `advance.js` into the core page, since two
  independently-loaded modules now read it. Checked with a dedicated fixture
  (`test/leave.test.mjs`): the ask, the day count, the overlap guard, the balance, the desk's
  routing and bulk decide, expiry by start date (written to the row, not just read that way),
  the report's per-row balance, no month-lock, the missing-table fallback (alone and with
  neither migration run), and the customer-service special case. `npm test`: 1,508 pass. No
  read on `/api/upload` or `/api/call`; a front-end change, `BUILD 2026-11-12-b`. **Not done:**
  no third staff database (HR's existing advance registry is reused as-is); no Excel export
  beyond the standard board buttons every screen already has. **Waiting on the owner:** whether
  the 26-day annual allowance should reset each calendar year. **Found by the owner before this
  merged** ("am not seeing the new tabs"): `api/_lib/auth.js`'s `ADMIN_TABS`/`EXTRA_TABS` -- the
  one list that puts a tab on a signed-in person's own tabs, admin included -- had not been
  given the two new tab ids, though everything else (`NAV`, `MGMT_ORDER`, `MOD_OF`, `FN`/`FN_TAB`)
  had. Fixed in the same change, with a dedicated test (neither advance's own four tabs nor the
  general sidebar test check this today). **Reviewed** by three independent readers before this
  merged: one real finding, confirmed and fixed -- without RUN-ME-045, the ask screen's history
  pane and desk pill fell back to "holds the one `leave` tab", copied from advance's own legacy
  fallback where that tab is held by approvers alone; here it is held by every ordinary
  requester too, so it showed a colleague's pending dates, cover name and reason (medical,
  bereavement) on a database without the routing columns -- reproduced, then fixed to show
  nobody but admin in that state. Also fixed: the migration collided with an existing
  `RUN-ME-047` (`#621`) and is now `RUN-ME-051`; its own "under 40 lines" claim was wrong (53)
  and is now honest; two UI wordings were tightened (a live preview that read as an immediate
  balance drop on submit, and a hand-edited link landing on a pill bar stuck on "desk" with
  nothing to show). Everything else -- schema-to-code columns, every nav/dispatch/gate wiring,
  `advDeskLine_`'s one definition, the day-count math -- was checked and confirmed correct.
  `npm test`: 1,511 pass.
- **#679** — the Exp.Def week was never walked past Friday (handbook Part 57). "Expected
  defaulters goes mon to sunday not mon to fri bro." A finished past week's report, and the
  card behind a leader's name, silently stopped at Friday -- Saturday and Sunday were never
  measured, never a day tab, never in anybody's total -- because the clock a non-current week
  is "read as of" (pinned to that week's Friday, mirroring the dashboard's own `asOfWeek`) was
  also reused, in the same file, as the boundary that decides where the week's own day-loop
  stops. Fixed by pinning that clock to the week's own Sunday instead; `asOfWeek` and the
  roughly seventeen other screens that read it are untouched -- nobody asked for those to
  move. Checked against a book built so two customers' own secondary cycle days land on a
  Saturday and a Sunday with real recovery filed on both; the live current week still has no
  tab past today. Two independent reviewers re-derived the cycle-day arithmetic by hand and
  re-ran the suite themselves; neither found anything to flag. `npm test`: 1,495 pass. No read
  on `/api/upload` or `/api/call`; no front-end file changed, so `BUILD` stays `2026-11-12-a`.
  **Not done:** whether the dashboard's own `asOfWeek`-read past-week screens should move to
  Sunday too is a separate question, not asked yet.
- **#678** — the disbursement sheet, and the dates it left empty (handbook Parts 55-56).
  "I do not upload disbursment sheet, remove it in uploads. I only upload approved/processed,
  use it everywhere necessary for loan approvals and disb dates." Pending Disbursement and
  Disbursed Loans are gone from the Upload page's stage picker, and the server refuses the two
  stage values outright (one named set, `LOAN_UPLOAD_STAGES_REMOVED`), in case an old saved
  link still names one — the in-app Disburse button, confirmed never used either, still writes
  the same stages the one time somebody uses it; only the upload sheet changed. **The bigger
  half:** `disb_date` on a loan is set only by that sheet and the Disburse button, so it was
  empty on every row, forever, and the Audit Report's PAR > 30 figure — the auditor's own
  headline ratio — read it alone: `disbursedLoans` and `disbursedTotal` came back zero and
  null every month, whatever was uploaded. **This is the whole-portfolio PAR that has been on
  the waiting list since 11 Nov**, and it was not only waiting on a historic upload: the figure
  would have stayed blank even once uploaded, reading a column this book never fills. Fixed: a
  loan counts the same way it counts everywhere else (`SALES_STAGES`), dated by `disb_date`
  where a row really has one, else `approved_date` — the same fallback `loanTotalsByTeam`
  already used a few lines above in the same file. **Read before it shipped:** the first cut
  fetched by stage with NO date floor at all — a reviewer, on a synthetic book of years of
  sales history, showed it pulled every sale the book had ever made, in full, again on every
  distinct month viewed, since the report's own cache is keyed by month and that read was not.
  Fixed with a floor on EITHER date, at the start of the two months being audited: nothing that
  belongs to either cohort is older than that on at least one of its two dates, so nothing is
  lost, and the read is back to what the function's own comment always promised — two months,
  not the whole history. Checked against the existing audit-report test (unchanged, isolated
  from a shared fixture's stray loans that would otherwise have joined the count) and a new
  one: three approved-only loans across two months, a rejected one that must not count, one
  with a real `disb_date` a month later dated by it and not by its approval, and one a year and
  a half outside the floor that must stay outside it; and, directly, a 6,000-loan synthetic
  book where the bounded read returns well under a tenth of it for one month. No code on
  `/api/upload` or `/api/call`. `npm test`: 1,494 pass.
- **#677** — a real defaulter is never silently absent from a leader's list (handbook Part 54).
  "some staff like managers have somedays not getting expected defaulters, something not
  reality... re-crosscheck expected defaulters being efficiently produced to everyone from
  teams to leaders." Confirmed against the real code, for all three recycling roles, not only
  MANAGER: a customer whose disbursement date is missing or unreadable got no cycle day, and
  the filter that shows "who is due today" put them on no leader's list, any day — unless
  every other customer in the same read shared the fault. Real arrears, on nobody's screen,
  for as long as the date stayed unreadable. The daily board and the leader's own phone screen
  now keep such a customer alongside their dated colleagues; the week (which sums each day
  separately) counts them once, after its own loop, with the last day's figures — never once
  per day, which would have inflated them. **Read before it shipped:** one reviewer, run
  against a real PostgreSQL, found that the week's one-time rescue was keyed by role and
  leader as well as the customer, on the wrong assumption that an undated customer's role
  holds still for the week — it does not, since the rotation reads `days_elapsed` regardless
  of whether a date can be read, so an undated customer can cross a role boundary mid-week and
  be rescued twice, once per leader. Proved with a real case (one customer, two boards, one
  week) and fixed by keying the rescue on the customer alone. No code that runs for a user
  changed, no page: `BUILD` and `CALL_BUILD` stay `2026-11-11-b`. `npm test`: 1,491 pass.
- **#675** — the staff script takes a whole staff form, and head-office people (handbook Part
  53; the owner's words above three forms: "Zone pmo hq"). Each form carried a parent, a next of
  kin, a start date, an address and a second phone, and the script stored six of a form's
  fields. The rest now travels in a second list (`more`, under the row's number): a NEW staff is
  added with it (the day they started is the REG-DATE); a PLACE fills only what is EMPTY, and
  never writes a number beside a name it did not come with; MOVE, OFF and ASK never read it.
  The birth date is the NIDA's, as the staff form reads it, and a NIDA of an impossible date no
  longer stops the script. An account is stored as the staff form stores one. The row now says,
  and does not act on: a zone word that is not filed (with the filed zones that share a word
  with it), a NIDA that is not twenty digits, a form's date that is not its NIDA's, and, for
  somebody with no team, the roles the others of that zone carry. **Head-office people** are
  filed by department (`HQ - PMO`, as the registry already names it) and offered by ROLE
  (section 7). No code that runs for a user changed, no page: `BUILD` stays `2026-11-11-b`.
  **Reviewed alone**: a three-reader panel was started and failed twice in a row on the
  account's usage-credit limit; checked instead by hand against a real PostgreSQL (section 7).
  **The answer is back.** Of the three, one was added as new (LEGAL, HQ - PMO); the other two
  were already in the registry, filed generically as PMO, so the first script's NEW left them
  untouched. A second script asked for those two by PLACE, to fill whatever was still empty on
  their rows; it changed neither of them, because every box their form would have filled was
  already filled in the registry — nothing was missing after all. **Flagged, not acted on:**
  the one added as new shares two of its three names with somebody already filed in the same
  zone, under a shorter form of the name — the row said so on its own ("look: a name like it is
  already in this zone"), and whether the two are one person is the owner's to say (section 8):
  a script never merges two staff records on a name alone. The owner was also told which role
  word was written for the one added (the forms give none: the desk Teams & Staff names each
  on), that one form's birth date is not its NIDA's, that one NIDA has nineteen digits, and that
  a marital status and an e-mail address are not stored (the registry has no box for them).
- **Staff registry, 12 Nov** — a list of twenty-seven and its follow-up of five; **every answer
  is back, and all that was asked is done but one line that was cut off in the paste.** The
  staff of three teams of one zone came as their GMO has them (fourteen people, names only)
  and were asked as MOVE (section 7). Ten were found, **every one filed under a zone their team
  does not carry on Teams & Staff**, which is why none of them was on their team's list; each
  now sits in their team's zone. One was in the registry a transposed letter away and was asked
  again in the registry's own spelling. Three were in it under no spelling (their surnames on
  nobody, in any zone) and were added with name, team and zone only. The southern teams: nine
  added, two switched off, and one sent as new who was already there as a manager under another
  zone, asked again as PLACE (moved; the phone and account written only where the registry had
  none). Each script was run twice on a made-up registry of 5,000 on the real team list before
  it was handed over. The names are in no file of the repository.
- **#673** — the rule does not guess (handbook Part 52). #671 took a team with no ZONE into the
  zone MOST of its GMO's teams carried, a tie going A to Z. The owner's own Teams & Staff list
  showed one GMO named on teams of four zones (two, two, one, one): the tie had filed an officer
  by alphabet. Now a GMO's zone is read only when ALL their teams that carry a zone carry the
  SAME one; a GMO over several zones gives none, the team reads NO ZONE SET and the staff script
  lists the zones and leaves the zone as it was. Both writings changed together (`teamsZoned`,
  the `gz` step of the template); the parity check read 600 random tables alike and failed on
  deliberate breaks. **The staff already on a team are no longer asked for its zone:** a staff
  who kept an old zone was handing it to the next person sent there. When Teams & Staff cannot
  say, only the row itself can (the sender's word for a filed zone; for a new staff, the one zone
  of the colleagues it names); otherwise the zone is left as it was, or the staff is not added,
  and the row says what settles it. A zone is compared with runs of blanks as one, as a GMO's
  name is. The two tips are reworded (the one optional tip script brings any book up to date).
  Two reviewers read it before the merge, each finding put to a second reader: eight findings,
  none refuted, all fixed (Part 52). On the live list one team is touched: it reads NO ZONE SET
  until its ZONE is typed. No read added; no page changed, so `BUILD` stays `2026-11-11-b`.
- **The two books, met in practice, 11 Nov night** (handbook Part 51) — the owner edited Teams &
  Staff at the NEW address and saw nothing at the old one: the edits went into the copy (section
  5). The two lists the owner pasted differ in 26 cells: 11 are that evening's edits and exist
  only on the new server; 15 are places where the real book has moved on since the copy was
  taken, a team code among them. Handed over, to be run in the SQL editor of the real book:
  (1) a script that fills the 11 cells, only where the real book's cell is empty, each name
  copied from a team of the real book that already carries it; (2) a staff script of two rows,
  to run after it. **Both were run on 12 Nov and their answers are back:** six teams were filled
  (on two more the number was already right in the real book), and the manager whose team had
  no GMO was filed under that GMO's zone, with nothing typed in a ZONE cell. **Still open:** the
  officer filed by the tie. His team's ZONE has not been typed, so he is still under the zone
  the tie picked, and since #673 that team reads NO ZONE SET (its code lists nobody on the
  advance desk) until it is. The owner was told: work only at the old
  address until the server reads the real database; anything else done at the new address is in
  the copy too; a team code changed on the copy locks nobody out. And asked: whether any of the
  15 was a change made that evening at the new address (not answered yet).
- **#671** — a team's zone is its GMO's (the owner's order in section 2, handbook Part 50). A team
  whose ZONE cell is empty sits in the zone most of its GMO's other teams carry (changed by #673:
  only when they all carry the same one); what is typed on
  the team stands. One rule, `teamsZoned` in `api/_lib/zone.js`: the name line and the advance
  desk read the teams through it (an officer of such a team reads the zone beside the name and
  finds their own name on the advance request list), and the staff template files a moved or new
  staff by the same rule in SQL, saying on the row where a zone came from.
  `tools/db-checks/gmo-zone-parity.mjs` reads random team tables both ways on a PostgreSQL. No
  read added anywhere; no page changed, so `BUILD` stays `2026-11-11-b`. The template starts with
  `set local jit = off`, and answers a person it cannot find name by name: who in the whole
  registry carries each of their names. A cell that holds a dash, N/A or "NO GMO" names nobody.
  Three reviewers read it before the merge, each finding put to a second reader: nine findings,
  none refuted, eight fixed in the change (the list is in Part 50). **Not done:** the annual
  deck's zone map still counts a team with an empty ZONE cell under "no zone set" (following
  the rule there changes each zone's teams and General % on a slide: offered, section 8); the
  staff form in the portal still asks for the zone to be picked. Optional tips:
  `db/RUN-ME-2026-11-11b-hint-team-zone-is-its-gmos.sql`.
- **Staff registry, 11 Nov night** (#672) — the owner ran four more scripts, and every answer is back.
  The five left by the second round: the transfer nobody could find was found (one letter apart
  in more than one word); of the three filed under the zone they had left, one was filed by his
  team's GMO's zone and one by the one zone of the teams whose names begin with his team's. A
  ninth list (one zone, five people): one switched off (found by the shorter form of his name),
  one already where the list wanted him, one added, and a transfer whose first name the list and
  the registry spell differently was moved once he was asked for in the registry's own spelling.
  **Two officers who left are not in the registry at all:** the name-by-name answer showed that
  nobody, in any zone, carries either surname, and no account or phone fits. There is nothing to
  switch off, and the owner was told; if a GMO says otherwise, the name as at the bank or a staff
  ID settles it. The manager moved to a team that had neither a ZONE nor a GMO is filed (12 Nov:
  the GMO was carried into the real book and the rule gave the zone). **Still open:** (1) an
  officer filed by a tie (#673): his team's GMO is named on teams of four zones, so the owner
  types the ZONE on that team at the old address; if it is the zone he is already under,
  nothing more is needed, and if it is another the two-row script is run again and files him
  under it; (2) the two questions for the owner from the second round (a man a GMO does not
  know; a new employee sent with no team, role or zone); (3) the staff of five southern teams
  the GMOs are to send (those teams now carry a GMO, so their staff are filed by the rule): two
  of the teams came on 12 Nov (the entry at the top), the others have not.
  The names are in no file of the repository.
- **#670** — the staff template is now the script that answered the second round (handbook Part
  49): transfers, new staff with their details, people a GMO cannot see, and somebody whose name
  the GMO spelt differently (found by account, by one letter, by a shorter form; never re-spelt).
- **Staff registry, 11 Nov evening** — the second round, forty people from eight lists: thirty-six
  done at the first run (sixteen off, nine moved, eleven added). Two were not found, two were
  questions for the owner, and three of the moved went to teams with no ZONE on Teams & Staff.
  What that left open is in "Staff registry, 11 Nov night" above. The names are in no file of the
  repository.
- **Outside the repository, 11 Nov evening** — two letters in Swahili asking a police station for
  bail for officers, one Word file of two pages on the company's letterhead, drafted for the
  company's lawyer to sign. Nothing of it is in the repository.
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
itself, through its own link to GitHub, with no gap. Our own server restarts; measured twice
(section 5): once nothing was refused, once one request of eighty-four was not answered.

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

**It happened on the night of 11 Nov** (handbook Part 51). The owner edited Teams & Staff at the
new address and nothing showed at the old one. A script was handed over that carries the edits
into the real book, and a staff script of two rows to run after it; **both were run on 12 Nov**
(section 4), so those edits are in the real book now. Anything else done at the new address is
still only in the copy. A chat that sees an address in the owner's message reads WHICH site it
is before anything else, and says so in its first line if it is the new one.

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
  slice can be most of a minute. Measured again at the #672 deploy (11 Nov, 20:37 EAT): asked for
  its version 84 times across the restart, it left ONE unanswered (the status was not captured;
  the restart step itself took three seconds). The gap is real, and small.
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
- **A chat that has worked all day is at the limit.** The second team of 11 Nov (three reviewers,
  #669) lost two of its three to the same five-hour allowance within two minutes. Late in a long
  day, review alone: tests, a real browser, a real PostgreSQL.
- **A script for the SQL editor is timed on a book of the live book's size first.** One that takes
  seconds on the test machine is made lighter before it is handed over.
- **A document for the owner's management goes out whole.** On 11 Nov a report was sent with two
  lines still waiting on figures, and the answer was: "You cant provide report before including
  negligances bro". Say what is missing and what it waits on; send the document when nothing is.
- **A team's zone is its GMO's** (section 2, handbook Parts 50 and 52). A staff moved to a team
  with an empty ZONE cell is filed under the zone of that team's GMO, and its people read that
  zone. Only a team with no GMO, or whose GMO has no team with a zone, or whose GMO is named on
  teams of more than one zone, cannot receive anybody: ask the owner to name the GMO on it, or to
  type its ZONE.
- **A rule that has to choose is a guess.** "The zone most of the GMO's teams carry" was read by
  three reviewers and nine skeptics and none objected; the owner's own list had a GMO over four
  zones and the tie went to the alphabet. Where a rule would pick among answers, give none, say
  what was found, and let one typed cell settle it. And look for the OTHER places that pick: the
  review of #673 found the script still taking "the zone of the staff already on that team",
  which handed the tie's own answer to the next person sent there.
- **Read which site an address is before anything else.** On 11 Nov the owner was asked to name
  a GMO on a team, did it at the new address, and an evening of edits went into the copy. When a
  message carries `recovery-app.sync-book.net`, the first line of the answer says that it is the
  copy (while section 5 stands).
- **A chat can stop in the middle of a change without a word.** On the night of 11 Nov it did,
  for six hours, until the next scheduled check woke it; the change sat unpushed on the chat's
  machine. Push work in progress to the chat's own branch before a long step. On 12 Nov the
  machine itself restarted twice under three reviewers, each time losing the local test
  database (not the repository or the scratch folder): the second restart also emptied the
  account's usage credits, so the review that had failed once on a restart failed again on
  that, and #675 went in checked by hand instead (section 7). On 12 Nov the
  machine itself restarted under three reviewers: the pushed commit and the scratch folder were
  still there, the test database had to be started again, and the review was resumed from its
  run. Hand over what is ready before a review, when it is safe to run and to run again.
- **A long script for the SQL editor starts with `set local jit = off`.** The staff script took
  eight seconds on the test machine, all of it the database compiling the query; it ran in a
  fifth of a second. Time a script with the compiler on and off before believing either number.
- **A check is checked by breaking what it guards.** The first check that the portal and the
  script read a team alike passed, and went on passing with the rule broken: its random numbers
  were nearly always even, so half its cases were never drawn. Break the rule, see the check fail.
- **A list with names only is asked as MOVE.** A GMO who sends the whole staff of a team sends
  no phone and no account. Asked as PLACE or NEW, a name the registry spells another way (two
  letters in one word is enough) becomes a second person, and a second person cannot be taken
  back; asked as MOVE it comes back NOT FOUND with who carries each of the names, and the next
  script settles it. New staff are added from rows that carry a phone or an account.
- **Head-office people are filed by department and offered by role** (handbook Part 53). They
  have no team. The zone is the department as the registry already files it (`HQ - PMO`, `HQ -
  CREDIT`, `MANAGEMENT`: the owner's "pmo hq" is `HQ - PMO`), never the words of a message. The
  role is written as Roles & access spells it, never left to the script's default: the request
  tab offers a name only to the holders of its role. When a form gives no role, write the desk
  Teams & Staff names the person on, tell the owner which word was written for whom, and read
  the roles the answer lists for that zone.
- **A NEW that comes back ALREADY IN THE REGISTRY is asked again as PLACE.** The person is
  there, somewhere else: PLACE moves them to the team and fills only what is empty.
- **A staff found under a zone their team does not carry was on nobody's list.** When a GMO
  sends the whole staff of a team, expect the registry to hold them under an older zone. The
  MOVE that files them under their team's zone is what puts them on their team's code: say so
  to the owner, it is the reason the list was sent.
- **A NEW that comes back ALREADY IN THE REGISTRY is asked again as PLACE** — the person is
  there, and PLACE fills only what is empty. The same holds with no team at all: two
  head-office staff came back ALREADY IN THE REGISTRY under a bare department role, and a PLACE
  with no role or zone on the row touched neither, because every box was already filled.
- **A script never merges two staff records on a name alone.** "Look: a name like it is already
  in this zone" is the script noticing, not deciding; a staff script can switch one record to
  Inactive and move a form onto the other once the owner says they are the same person, and not
  before.
- **A name a list spells differently is asked for in the registry's own spelling.** When an
  answer shows the person (two names the same, the third a variant), the next script asks for
  them as the registry has them; nothing is re-spelt. Tell the owner which name was taken for
  which.
- **"Only find more rows, never fewer" is not the same promise as "cost nothing more."** A
  date-range filter dropped for fear of losing a row (Part 55) was dropped with no floor at
  all, not a wider one — fetching a whole book's history, in full, on every month a cached
  report is asked to look at, since the cache was keyed by month and the query no longer was.
  Widen a filter to stop it from losing something; dropping it outright is a different, much
  more expensive promise, and a cache keyed by a value a query no longer depends on buys
  nothing on the second ask.
- **A rescue keyed on the wrong thing can double what it was built to save from going
  missing.** The week's one-time catch for an undated customer (Part 54) was keyed by role and
  leader as well as the customer, assuming those stay put for the week; `days_elapsed` moves a
  customer's role on its own clock regardless of whether a date can be read, so the same
  customer crossed that boundary mid-week and was rescued once per leader instead of once for
  the week. Key a once-only rule on the one thing that is actually constant — here, the
  customer's own reference — never on a value that can legitimately change under it.
- **A `\uXXXX` typed into a command reaches the file as the character itself.** A no-break
  space, a line separator and a byte-order mark went into a script's pattern that way, invisible
  and waiting to be mangled by a paste. Write such a character with a doubled backslash, or build
  it in the script (`chr(92) + 'u00A0'`), and scan every file for characters outside plain text
  before it is committed or handed over.
- **Two copies that agree can both be wrong.** The portal's rule and the script's read a dash in
  the GMO cell as a GMO, alike, so the check that compares them passed. A review by readers who
  had not written the change found it. Have a change read before it is merged, findings put to
  a second reader, when the allowance is there (three reviewers and nine skeptics on #671 cost
  about a quarter of an hour); when it is not, say that it was not read.
- **A zone has the name Teams & Staff files it under.** A GMO's word for a zone and the filed
  one can differ. Scripts and screens read the teams table; never type a zone from a message.
- **Ask for the exports before writing a dig.** The loan system exports Approved (Processed) and
  Defaulters for one team and any dates, with balances. On 11 Nov an SQL dig that took 70 ms on a
  test book of the live book's size ended in "upstream timeout" in the SQL editor; the owner's
  two exports answered the same question in minutes ("Check from here no need of sql"). A dig is
  not proven until it has run on the live book, and a chat cannot run it there.
- **A tab still reading "Running..." may already be dead.** `RUN-ME-054`'s first
  `CREATE INDEX CONCURRENTLY` (12 Nov) sat in the SQL editor reading "Running..." long after the
  server-side build had actually stopped -- the editor's own connection had dropped, Postgres had
  already rolled the build back, and the tab was just waiting on a reply that was never coming.
  It left an invalid index behind under the exact name the next attempt's `IF NOT EXISTS` would
  then silently protect. Check `pg_stat_progress_create_index` from a SECOND tab before trusting
  a first tab's spinner on any long `CONCURRENTLY` statement; zero rows there means nothing is
  really running, whatever the first tab says. `select indexrelid::regclass::text, indisvalid
  from pg_index where indexrelid::regclass::text = '<name>'` catches the leftover; `drop index
  concurrently if exists <name>` (alone, the same rule as `CREATE`) clears it before retrying.

## 8. Waiting on someone

- **The owner, with Demit — first of all**: which database is the book (section 5). The move
  waits on it. The owner has the questions for Demit, in order, in the report of 11 Nov.
- **The owner**: the staff-registry batch of 13 Nov (section 4) — Nyenje's full name and
  destination team (only a first name and "moved from Bunda" was given); once the script is
  run, whether the Kihonda Area team and the "South East" zone wording resolved or need their
  exact Teams & Staff spelling; the TIN/NSSF numbers for Kassim Shabani Muhidini and
  Sylvester Erick Maundi, both "on process" and left out of the script, once issued; and the
  NSSF number for Frank Michael Mwelue (also "on process"), from the same day's second batch.
- **Demit / the server**: the list in `docs/DEPLOY.md` section 6.
- **The owner**: the CS Supervisor's two staff of 12 Nov (section 4) — for the one with the full
  form, new hire or existing staff with a gap (and if new, the role and team, or the zone
  directly for a head-office role; if existing, a staff ID or their filed team), and which one
  of the five named guarantors to keep in the registry's second slot; for the other, who they
  are (a staff ID, or their team/zone) and which bank the account is at. Nothing is filed until
  the answer comes back — the script sent changes nothing by itself.
- **The owner**: whether the e-mailed reports arrive. **The Audit Report's whole-portfolio PAR
  (handbook Part 55):** the
  blank `par30` was never only the historic upload — the figure was read off `disb_date` alone,
  a column this book never fills, so it would have stayed blank even once uploaded. Fixed
  (`approved_date` now counts, the same as everywhere else). Whether the 2024-to-July-2026
  historic sales still need uploading at all is now the open question: check the Audit Report
  for a month in that range and say whether `par30` already shows a real number (the loans
  table's own SALES-HISTORY import may already cover it) or still reads blank (then the upload
  is still needed, and will now be read correctly once it is done).
  The older list in `docs/HANDOFF.md` Part 15 ("Waiting on you") has not been checked again.
  At the OLD address: the ZONE typed on the one team whose GMO is named on teams of four zones.
  Until then that team reads NO ZONE SET, its code lists nobody on the advance desk, and its
  officer stays under the zone the tie picked; if another zone is typed, the staff script of two
  rows of 11 Nov is run again. (The teams script and that staff script were both run on 12 Nov.)
  Also: whether any of the fifteen cells where the real book is ahead was a change made on 11
  Nov at the new address (a team code is among them: changed on the copy, it locked nobody
  out); and the two questions of the second round.
  Of the staff lists of 12 Nov: the rest of the message that was cut off (the third name of
  one southern team); the phone, account and NIDA of the three officers added by name only; and
  whether the list of the three teams is their whole staff (if it is, the people the registry
  files on those teams who are not on it are to be asked about).
  Of the three head-office forms: **whether the one added as new and the shorter-named record
  already filed in the same zone are one person** — if so, say which staff ID to keep; a script
  then switches the other to Inactive and moves its form across. If not, say so and this is
  closed. And, to confirm with the staff: the NIDA that has nineteen digits and the birth date
  that is not the one in its NIDA.
  Optional: `db/RUN-ME-2026-11-11b-hint-team-zone-is-its-gmos.sql` (the two tips that say where
  a zone beside a name comes from; it adds both and rewords either one a book holds in an
  earlier wording, so a book where it was run after #671 needs it run once more; the zone shows
  without them).
- **Offered, never asked for — do not start without a yes**: the annual deck's zone map following
  the rule that a team's zone is its GMO's (it moves teams between the zones of that slide and
  changes each zone's General %); the staff form filling the zone from the team in the role; a
  Zone box on an access code, to set a person's zone directly whatever Teams & Staff says; a one-tap download of every approved
  loan; the month view of the Exp.Def Report as the sum of its weeks; removing the server action
  `emailWeeklyExpdf`, whose button went in #655.

## 9. The chats so far

| Chat | Ran | Ended |
|---|---|---|
| "HOPE PMO v2 dashboard aggregation" (`session_015VhcZpofMwgR54shZGarYp`, branch `claude/recovery-percent-basis-md87x9-85o7ox`) | 4 Aug to 11 Nov 2026, up to #664 | Passed its size limit. It can still be read; it cannot take a message. |
| The chat that wrote this file (`session_01StRZE69GhZa1GsVBHZHu1g`, branch `claude/kind-cerf-u7t6vm`) | from 11 Nov 2026 | — |

A commit's `Claude-Session` line says which chat made it.
