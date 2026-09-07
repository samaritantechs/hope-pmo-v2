# Report payloads — what an integration can read from HOPE PMO

**Who this is for:** whoever is wiring another system to read HOPE PMO's reports. It answers
one question: *which calls return which report, and what is in the answer.*

Everything below was produced by calling each function against the test fixture and writing
down the top-level keys. It is a map of the answers, not a contract carved in stone: a row's
exact fields can grow as screens grow, and an integration should read the keys it needs and
ignore the rest.

---

## 1. How every report is asked for

There is **one door** for the whole portal:

```
POST https://<your-deployment>/api/portal
Content-Type: application/json

{ "code": "<an access code>", "fn": "<function name>", "args": { ... } }
```

- `code` is an ordinary access code from Settings → Access codes. **Make one for the
  integration**, with the tabs it needs and — this is the important part — the **teams it may
  see**. Team scoping is enforced on the server for every function: a code scoped to three
  teams gets three teams' figures back, whatever it asks for. A code with `teams` empty sees
  everything (that is what an admin's code is).
- `fn` is one of the names in section 3.
- `args` is optional. Every function accepts `{}` and answers for *today / this week*.
- The answer is JSON. `workspace` rides on every answer and is always `"pmo"` for these
  reports.
- The system has an **open/closed switch** (Settings). While closed, non-admin codes get a
  refusal — the integration's code should be told about this, or given admin rights.

Dates are `yyyy-mm-dd`, weeks are named by their **Monday**, months by `yyyy-mm`. Money is
in TZS as plain numbers. Percentages are numbers already rounded to one decimal (`63.2`), or
`null` when the question could not be asked (nothing expected, no deck paired) — **`null` is
never `0`** anywhere in these reports; treat it as "not measured".

The same rules of arithmetic apply everywhere and are written down once each:

| Figure | Rule | Where it lives |
|---|---|---|
| Recovery on a day | the day's INITIAL deck total minus the same day's CURRENT deck total, per team | `api/_lib/snapshot-totals.js` — `recoveryByTeam` |
| Recovery % (teams, company) | Monday ÷ Monday's uncollected · Tue–Fri ÷ **yesterday's** · Sat/Sun ÷ the week's | `api/_lib/recovery.js` — `recoveryDenominator` |
| Recovery % (a recovery officer) | the day's recovered ÷ **that day's** uncollected; the week ÷ Mon–Fri's | commission board, presentation |
| Collection % | collected ÷ expected, per day, ratio of sums over a range | everywhere |
| Which upload counts | the latest upload batch **per team** within a date | `api/_lib/snapshots.js` — `pickLatestBatch` |
| Customer-service registration | TRACK# reads 1 **and** CREATED BY is on the call-agents roster | `api/_lib/portal-core.js` — `csRule_` |

---

## 2. The reports directors usually want

If the integration is for management reporting, these five carry almost everything:

| Ask | `fn` | `args` |
|---|---|---|
| The dashboard (cards, four weekday trends, team table) | `dashboardFull` | `{ weekOf }` optional |
| The weekly report (Mon–Fri strip, per-team sections) | `weekly` | `{ weekOf }` optional |
| The month report (week-by-week rows, agents, leaders) | `monthReport` | `{ weekOf }` — any date in the month |
| Commission (three schemes, per officer) | `commission` | `{ scope: "week" \| "month", weekOf, month }` |
| The presentation boards (per-officer, per-analyst, calls) | `officerBoards` | `{ weekOf }` optional |

The rest of section 3 is the long list.

---

## 3. Every report function, its arguments, and the shape of its answer

`[…]` means a list of rows with those fields; `{…}` an object. Only top-level keys and the
first row's fields are shown.

### dashboard — the phone's summary (small)
args: none · answer: `totals{…}`, `teams[{team, expectedAmount, collected, uncollected, recovered, defaulterArrears, defaulterCustomers, salesAmount, receivedAmount}]`, `asOfWeekday`, `period`, `dates{…}`

### dashboardFull — the portal dashboard
args: `weekOf` (any date; snaps to that Monday) · answer: everything in `dashboard` plus
`weekOf, weekEnd, weekday, asOfDate, pastWeek, weekFuture, weekRequested, dailyTarget, weeklyTarget, teamCount`,
`perf{salesPct, colPct, recPct, avgPct, dSales, dCol, dRec …}`,
`cards{curArrears, initArrears, recovered, defaulters, defaultersInitial, cleared, salesWeek, salesLoans, abnormal, abnormalAmount, uncollectedToday}`,
`appsTrend[{weekday, date, unassigned, assigned, apps, amount}]` (Mon–Sun),
`salesTrend[{weekday, date, amount, loans, pct}]` (Mon–Sat),
`colTrend[{weekday, date, expected, collected, uncollected, uploaded, pct}]` (Mon–Fri),
`recTrend[{weekday, date, from, to, recovered, uncollected, basis, basisDates, dayUncollected, unrecovered, uploaded, pct, full}]` (Mon–Sun),
`recTrendTotal{recovered, uncollected, unrecovered, pct}`,
`funnel[{stage, count}]`,
`teamPerf[{sn, team, branch, recovery, gmo, manager, opm, bike, credit, expected, collection, initArrears, curArrears, recovered, tSalesPct, mSalesPct, tEColPct, mEColPct, tColPct, mColPct, tRecPct, mRecPct, tAvg, mAvg, recBasis, uncolMon, uncolYest, uncolWeek, …}]`,
`paired`, `monthReady`

### weekly — the weekly report
args: `weekOf` · answer: `weekOf, weekEnd, pastWeek, weekFuture, weekRequested, hasMonday, hasWeekEnd, weekEndDate, perTarget, teamCount`,
`days[{date, weekday, customers, expected, collected, uncollected, pct, recovered, received}]` (Mon–Fri),
`teams[{team, branch, lead, sales, salesPct, expected, collected, adjusted, uncollected, collPct, recovered, recPct, …}]`,
`teamTotals{…}`, `teamRows[{team, opm, recovery, gmo, manager, credit, expected, bike}]`, `leadCols[]`, `totals{…}`

### monthReport — the month, week by week
args: `weekOf` (any date inside the month) · answer: `month, monthStart, monthEnd, weekOf, weekEnd, asOfDate, pastWeek, ledgerReady`,
`cards{…}`, `rows[{week, from, to, started, sales, loans, salesPct, expected, collected, colPct, uncollected, recovered, recPct, perf, …}]` (one per week),
`totals{…}`,
`agents{rows[{id, names, unassigned, assigned, advanced, total, amount}], total, totals{…}, excluded{noTrack, repeat, notAgent[{id, n}]}}` (customer service, strict rule),
`leaders[{sn, role, roleKey, name, teams, sales, salesPct, ecolPct, colPct, recPct, avgPct, avgOn}]`, `leaderRoles[]`

### commission — the three pay schemes
args: `scope` = `"week"` (default) or `"month"`; `weekOf` for a week, `month` (`yyyy-mm`) for a month · answer:
`scope, from, to, weekOf, weekEnd, asOfDate, pastWeek, weekFuture, month, monthEnd, weekday, date, me, isAdmin`,
`weeks[{key, from, to}]` — `WK` for a week; `W1…Wn` for a month,
`recBoard[{officer, recovered, base, pct, band, commission, weekRecovered, weekBase, weekPct, weekCommission, records[…], pctJ3, recJ3, tzsJ3 … pctWK/recWK/tzsWK}]` (month: `pctW1/recW1/tzsW1 …`),
`colBoard[{officer, pct, paid, over, n, commission, weekPct, weekPaid, weekOver, weekN, weekCommission, days[…], pctJ3, nJ3, ctzsJ3 …}]` (month: `pctW1, nW1, ctzsW1 …`),
`pmo[{officer, teams, teamList, customers, expected, collected, uncollected, pct, band, commission, weekExpected, weekCollected, weekUncollected, weekPct, weekCommission, weekDays[…], pctJ3, tzsJ3 …, prevWeekPct, isLeader, bonus}]` (month: `pctW1, tzsW1 …`),
`recoveryBands[]`, `recoveryBelow{}`, `pmoBands[]`, `pmoRole`, `pmoBonus{…}`, `pmoDiag{…}`, `pmoTotals{…}`, `recDiag{…}`,
`paidTzs, overTzs, payText`,
`day[{officer, recovered, recComm, paid, over, colComm, pmoComm, total, pct}]`, `week[…same…]`,
`totals{day, week, recovered, split{recDay, colDay, pmoDay, recWeek, colWeek, pmoWeek}}`

Only an admin code sees every officer; any other code sees its own row.

### officerBoards — the presentation
args: `weekOf` · answer: `weekday, weekOf, today, deckWarning, initialCount, currentCount, weekUncollected`,
`earlyToday[]`, `earlyWeek[{sn, officer, uncollected, paidOver, teams, expected, collected, pct}]` (initial sheets), `earlySource, earlyDate`,
`recToday[{officer, initial, current, uncollected, debtCrisis, recovered, pct}]` (uncollected is the day's own, the figure pct divides by), `recWeek[…]`,
`creditToday[]`, `creditWeek[{analyst, apps, amount, salesPct, recPct, perf}]`,
`callToday[{agent, team, calls, duration, portfolio, customers, unit, connectPct, portfolioPct}]`, `callWeek[…]`, `callWeekWorst[…]`,
`csToday[]`, `csWeek[{agent, id, unassigned, assigned, brought, amount}]`, `csExcluded{today{…}, week{…}}`,
`pmo[]`, `pmoBasis, pmoBasisLabel`, `fuStatus[{status, customers, arrears, pct}]`, `fuTotal`

### leaderReports — per leader, per team
args: none · answer: `weekday, date, paired, note, rows[{team, initArrears, curArrears, initCust, curCust, recovery, gmo, manager, branch, recovered, cleared, progress}]`,
`sections[{role, label, rows, totals, unstaffed}]`, `segments[{id, metric, role, roleLabel, metricLabel, dflt, label, dayKeys, amtKeys, dayDates, basis, groups, …}]`, `segDays{…}`, `segRoles[]`, `segMetrics[]`, `totals{…}`

### teamProgress
args: none · answer: `weekday, date, paired, rows[{team, initArrears, curArrears, initCust, curCust, recovery, gmo, manager, branch, recovered, cleared, progress}]`, `note`

### callReport — HOPE Calls, the officers' phones
args: `from, to, team, leader, user` · answer: `from, to, keepFrom, ok, scope, leader, user`,
`byDay[{day, officer, team, calls, dur, pf, npf}]`,
`users[{name, team, branch, position, phone, calls, duration, portfolio, nonPortfolio, ratio, uniqCustomers, days, …}]`,
`teams[{team, branch, calls, duration, portfolio, nonPortfolio, ratio}]`,
`byCategory[{category, calls, duration, connected, connectRatio}]`, `byOutcome[{outcome, calls, duration}]`, `totals{…}`, `leaders[{name, position, teams}]`

### appsTab — loan applications
args: `stage, from, to, month, weekOf` · answer: `pipeline{month, from, to, stages[{stage, count, amount}], total, requested, allTime, undated}`, `list{from, to, rows[…], count, amount, windowed, undated, undatedRows, stages, stage}`, `weekly{weekOf, weekEnd, days[], rows[{team, total, amount, J3…J2, avg}], totals{…}, teams}`

### appsWeekly · loanPipeline
Subsets of the above: `appsWeekly{weekOf, weekEnd, days, rows, totals, teams}`; `loanPipeline{month, from, to, stages, total, requested, allTime, undated}`

### expectedDay · expected — the expected-repayment sheet
args: `weekday` / `type` (`today`, `initial`, `tomorrow`, `yesterday`), `date` · answer: `type, date, rows[{ref, full_name, contact, team, zone, due_summary, initial_inst, payment_expected, todays_payment, todays_status, arrears, balance, guarantor_name, guarantor_contact, collected}]`, `count, totals{expected, collected, uncollected, pct, adjusted, …}`, `byStatus[{status, count}]` — `expectedDay` adds `weekday, requestedDate, fellBack, weekdays, teams`

### defaulters — the defaulter deck
args: `type` (`current`/`initial`), `weekday` · answer: `type, weekday, date, rows[{ref, full_name, contact, team, arrears, status, guarantor_name, guarantor_contact, ds, dc, days_elapsed, disb_date, initial, recovered, …}]`, `count, arrears`

### expectedDefaulters · assignments · followupReport · promises · par · credit · abnormal · received · complaints · restructures · demandNotices · adjustments · perfHistory · recoveryByCredit · expdfReport · notifications
Each answers `rows[…]` plus its own totals; their first-row fields are listed in the generated
appendix below. They are working screens rather than management reports.

<details><summary>Appendix — generated key list for the working screens</summary>

```
expectedDefaulters: rows[{ref, full_name, contact, team, arrears, balance, ds, dc, status, disb_date, primary, secondary, …}], count, dist{…}, dayNames[], me, iAmLeader, unplaced, todayIndex, teams[], chronic, expired, arrears
assignments:        date, weekday, rows[{ref, full_name, contact, guarantor_contact, team, branch, arrears, status, ds, dc, days_elapsed, phase, …}], count, untouched, untouchedArrears, unassigned, strategy{…}, byRole[{role, customers, arrears, touched}], byLeader[{leader, role, customers, arrears, touched}]
followupReport:     from, to, byStatus[{status, customers, arrears, defaulters, expired, chronic}], byTeam[{team, branch, customers, touched, arrears}], byOfficer[{officer, comments, customers}], statuses[], byOfficerStatus[…], rows[{at, by, team, branch, ref, full_name, fu_status, promise_date, promise_amt, contact, new_no, comment}], officers[], teams[], totals{…}
promises:           rows[{ref, team, full_name, contact, arrears, rejesho, status, ds, fu_status, promise_date, promise_amt, comment_by, …}], count, counts{…}, from, to, cleared, recovered, teams[], promised
par:                date, weekday, bands[{band, customers, arrears}], byBand[{band, customers, arrears, balance, avgLoan, par, share}], byStatus[…], byTeam[{team, branch, customers, arrears, balance, avgLoan, par, share}], totals{…}
credit:             rows[{analyst, teams, teamList, cnt, cntCur, cleared, reduced, stat, bad, recovered, sales, salesCnt, …}], portfolio[…], count, totals{…}, avgOverall, perTarget, teamCount, threshold, baselineDate, usedMondayBaseline, hasInitial, hasCurrent, analystCount, analysts[]
abnormal:           rows[{id, team, customer_name, paid, created_at, source}], count, step, from, to, uploaded, derived, scanned, pmoFilled, keptFrom, prunedNote
received:           from, to, rows[{id, team, amount_paid, paid_at}], count, amount, keptFrom
complaints:         rows[{id, team, complainant, status, details, created_at, branch}], count, from, to, open, resolved, loggedToday, categories[], channels[], statuses[], teams[]
restructures:       rows[{id, ref, team, full_name, arrears, total, installments, inst_amt, status, requested_by, created_at, branch, …}], count, strategy{…}, canApprove, pending, approved, rejected
demandNotices:      rows[{id, ref, team, full_name, notice_date, total_demand, issued_by, created_at, branch, arrears_now, recovered_since, notice_state}], count, demanded, fines, atNotice, recoveredSince, cleared, asOf
adjustments:        rows[…], totals{…}, net, ready, targets[], superseded, deckChecked
perfHistory:        period, rows[…], count, available, note, periods[]
recoveryByCredit:   week{…}, metrics[{weekday, date, creditUser, team, assigned, recovered}]
expdfReport:        weekly, weekday, date, weekOf, dayName, hasBaseline, sections[{role, rows, totals, unassigned}], totals{…}
notifications:      items[{kind, id, ref, team, who, by, what, at, unseen}], unseen, seenAt
```
</details>

---

## 4. Practical notes for the integration

- **Ask once a minute at most.** Most report answers are cached on the server for sixty
  seconds per set of teams; asking more often returns the same answer and costs the database.
  The reports are built from uploaded snapshots that change a few times a day, not a live feed.
- **Never during the morning collection round** for anything heavy (`officerBoards`,
  `dashboardFull` for many weeks at once). Uploading and the call app take priority over every
  report in this system, by rule.
- **`weekOf` accepts any date** and snaps to that week's Monday; the answer says what it did
  (`weekRequested` vs `weekOf`, `pastWeek`, `weekFuture`).
- **Officers are named, not keyed.** Recovery and early-collection officers come from the
  teams table's role columns; PMO collection officers from access codes with the PMO role;
  customer-service agents from the call-agents roster. An integration matching people should
  match on the exact name string the report returns.
- **`recDiag`, `pmoDiag`, `deckWarning`, `excluded`** are the system saying what it could not
  do. Read them: an empty board with a `recDiag` saying "no initial deck" is not the same as a
  week in which nobody recovered anything.
