# HOPE PMO v2 — Full Handoff

**Who this is for:** the owner of the system, not a programmer. Everything here is written so
that you can read it without knowing any programming language, and so that a developer you
hire in two years can pick the system up from this document alone.

**What it covers:** what was built, how the data is stored, what every table and column means,
what every screen does, what every word in the loan vocabulary means, every file and what it is
responsible for, and how to keep your own offline copy.

**If you only read three things:** Part 5 (the screens, including the two new ones — the
customer's own screen and the live wall display), Part 14 (everything that changed most
recently, each item named after the complaint it answers), and Part 15 (what is still waiting
on you). Part 13 is the honest account of a week where the system got worse before it got
better, and what was changed so it does not happen again.

---

## Part 0 — Words you will see, in plain English

You have been reading words in other chats that were never explained. Here they are.

| Word | What it actually means |
|---|---|
| **v1** | The old system: Google Sheets + Google Apps Script. |
| **GAS / Apps Script / Code.gs** | The programming language and file used inside Google Sheets. `Code.gs` was the single file holding all the old logic. |
| **v2** | The new system: Supabase + Vercel. What this document describes. |
| **Repository (repo)** | A folder holding every file of the system, with a full history of every change ever made. Yours is `samaritantechs/hope-pmo-v2` on GitHub. Think of it as a filing cabinet that never forgets. |
| **GitHub** | The website that stores the repository. |
| **Commit** | One saved change, with a note explaining why. |
| **Branch / Pull request (PR) / Merge** | A branch is a draft copy. A pull request proposes putting the draft into the real system. Merging accepts it. This is why you kept seeing "press merge". |
| **Deploy** | Publishing the current files so the live website runs them. |
| **Supabase** | The company hosting your **database** (see below). |
| **PostgreSQL / Postgres** | The database software Supabase runs. |
| **Database** | Where the data lives. Like a workbook, but with no cell limit, and it can answer questions instantly. |
| **Table** | Like one sheet/tab in Excel. `loans` is a table. |
| **Row** | One record — one customer, one loan, one call. |
| **Column / field** | One piece of information on a row — `arrears`, `team`. |
| **Vercel** | The company hosting your **website and the app's server side**. |
| **API** | The part of the system the screens talk to when they need data. Not something you look at. |
| **Endpoint / route** | One specific job the API can do, e.g. "give me the dashboard". |
| **APK** | The Android app installation file. |
| **Migration** | A one-time instruction to change the database's structure (add a column, etc.). You run these by pasting them into Supabase. |
| **Schema** | The full description of every table and column. |
| **Snapshot** | One day's uploaded picture of the portfolio, kept forever. |

---

## Part 1 — Why v2 exists, and what changed

### The problem with v1

Google Sheets has a hard ceiling of **10 million cells per spreadsheet**. Your workbook hit it.

That ceiling existed because of how Sheets forces you to work: Sheets has no way to *ask
questions* of data, so every view had to be its own physical tab. "Monday's Expected",
"Tuesday's Expected", "Wednesday Defaulters Initial", "Wednesday Defaulters Current" — about
56 tabs, all holding the same kind of information, separated only by which day and which type
they were.

### What v2 does instead

The database can answer questions. So:

- **All 8 loan pipeline sheets became ONE table** (`loans`). A loan doesn't move between
  sheets; it stays one row and its `stage` column changes from `unassigned` → `assigned` →
  … → `disbursed`.
- **Every Expected sheet became ONE table** (`repayment_snapshots`), separated by two columns:
  `snapshot_type` (today / tomorrow / yesterday / initial) and `snapshot_date`.
- **Every Defaulters sheet became ONE table** (`defaulter_snapshots`), separated by
  `snapshot_type` (initial / current), `weekday` and `snapshot_date`.

"Show me last Wednesday's numbers" is now a question the database answers, not a tab you hunt
for. **There is no cell limit.** This problem cannot come back.

### A whole class of bug is structurally gone

In v1, the D.S column ("3/6" = 3 paid of 6 target) was repeatedly eaten by Excel, which
decided it was the date 3 June. In v2 the `ds` column is declared as **text**. The database
will not convert it. It is not guarded against — it is impossible.

---

## Part 2 — The vocabulary of your business, as the system uses it

These are your words. The system uses them exactly as your operation does; this is the
dictionary that ties them to columns.

### Identity

| Term | Meaning | Column |
|---|---|---|
| **REF#** | The customer's repayment reference. The main key on every repayment and defaulter row. | `ref` |
| **DOCKET#** | The loan file number. | `docket_no` |
| **TRACK#** | Which loan this is for this customer: TRACK# 1 = first loan, 2 = repeat, etc. | `track_no` |
| **LOAN ID** | The lender's own loan identifier. | `loan_id` |
| **FULLNAME / CONTACT#** | Customer name and phone. | `full_name`, `contact` |
| **GUARANTOR** | The person who stands behind the loan; officers call them when the customer cannot be reached. | `guarantor_name`, `guarantor_contact` |
| **TEAM** | The branch team that owns this customer. The single most important column — nearly all permissions and reports are scoped by it. | `team` |
| **ZONE / BRANCH / REGION / NEAREST LANDMARK** | Where the customer is. | same names |

### Money

| Term | Meaning | Column |
|---|---|---|
| **PRINCIPAL AMT** | The loan amount before fees and interest. What "sales" is measured in. | `principal_amt` |
| **PROCESSING FEE / INTEREST AMT** | Charges added on top. | `processing_fee`, `interest_amt` |
| **NET DISBURSED** | What the customer actually received. | `net_disbursed` |
| **LOAN AMT** | Total repayable. | `loan_amt` |
| **INITIAL INST** | The first instalment, which is larger than the rest. | `initial_inst` |
| **OTHER INST** | The ordinary **weekly instalment** — this is what an officer at the door means by **REJESHO**. | `other_inst`, and `rejesho` in the follow-up table |
| **PAYMENT EXPECTED** | What this customer should pay on this particular day. | `payment_expected` |
| **TODAY'S PAYMENT / TODAYS STATUS** | What they paid and the resulting label: PAID, OVERPAID, UNDERPAID, UNPAID. | `todays_payment`, `todays_status` |
| **ARREARS** (often typed **ARREAS** in your exports — both are accepted) | Money overdue. | `arrears` |
| **BALANCE** | What is still owed on the whole loan. | `balance` |

### Time and progress

| Term | Meaning | Column |
|---|---|---|
| **D.S** | Paid-of-target as text, e.g. `3/6`. **Never a date.** | `ds`, and `due_summary` on Expected |
| **D.C** | Default count — how many instalments have been missed. Drives restructuring eligibility. | `dc` |
| **DAYS ELAPSED** | Days since the customer fell into default. Drives the 2-day recycling rotation label (D1, D2, …). | `days_elapsed` |
| **DISB DATE** | Disbursement date. Drives which two days of the week a defaulter is visited, and the legal fine rate. | `disb_date` |
| **EXPIRE DATE** | When the loan passed its term. Turns a Defaulter into **Expired**. | `expire_date` |
| **CHRONIC DATE** | When the customer became **Chronic**. | `chronic_date` |
| **LAST TRANS** | Date of their last transaction. | `last_trans_date` |

### Customer states

- **Defaulter** — behind on payments, still inside the loan term.
- **Expired** — past the loan's end date, still owing.
- **Chronic** — long past expiry; the hardest category.
- **Partial Defaulter** — partially behind.

The system decides which of the three a row is by looking for the text `CHRON` or `EXPIR`
inside the STATUS column, so variations in spelling do not break it.

### Operational terms

| Term | Meaning |
|---|---|
| **Expected (Leo / Kesho)** | The list of customers due to pay today (Leo) / tomorrow (Kesho). |
| **Early collection** | Chasing tomorrow's list *before* it falls due. The Expected officer is judged on this. |
| **Initial vs Current deck** | The same defaulter list twice on the same day: **initial** = the morning baseline, **current** = the same list later. Initial minus current = **recovered**. |
| **Recovered** | Arrears that came back: initial arrears − current arrears, for the same day and same weekday. |
| **Uncollected** | Expected money that did not arrive. This is the *denominator* of Recovery %. |
| **Recovery %** | Recovered ÷ uncollected, on the basis rule in Part 4. |
| **PAR (Portfolio at Risk)** | How much of the book is at risk, banded by principal size. |
| **Recycling rotation** | Moving a defaulter between GMO / MANAGER / BIKE officers on a clock, so the same officer isn't calling the same customer forever. |
| **Exp.Def (Expected Defaulters)** | The defaulters whose visit day falls today under the rotation. |
| **Abnormal payment** | A payment that doesn't match a customer cleanly (wrong sender, wrong reference). |
| **Restructuring** | Rewriting a defaulter's remaining debt into new instalments. |
| **Demand notice** | The formal legal letter demanding payment, with a fine. |
| **Commission** | What officers earn on recovery, by rules you configure. |

### Swahili used in the phone app

| Swahili | English |
|---|---|
| Leo / Kesho / Wiki | Today / Tomorrow / Week |
| Rejesho | The weekly instalment |
| Deni | Debt / arrears |
| Marejesho | Recovery (money returned) |
| Wateja | Customers |
| Msimbo | Code |
| Timu | Team |
| Ripoti | Report |
| Hakuna wateja | No customers |
| Sasisha / Baadaye | Update / Later |
| Ametoa ahadi | Made a promise to pay |
| Analipa leo | Paying today |
| Hapatikani | Cannot be reached |
| Ana namba nyingine | Has another phone number |
| Rejesho limeliwa | The repayment was eaten (misappropriated) |

---

## Part 3 — The database, table by table

Every column is listed with its type and what it is for. Types in plain terms:
**text** = words, **numeric** = money/number, **date** = a day, **timestamptz** = a day and a
time, **boolean** = yes/no, **uuid** = a long unique code the database generates,
**text[]** = a list of words.

### Reference and configuration

#### `teams` — the master list of teams and who leads them
| Column | Type | Meaning |
|---|---|---|
| `team` | text (key) | Team name. Everything else points at this. |
| `opm` | text | OPM's name |
| `recovery` | text | Recovery officer's name |
| `gmo` | text | GMO's name |
| `manager` | text | Manager's name |
| `credit` | text | Credit analyst's name |
| `expected` | text | Expected/early-collection officer's name |
| `bike` | text | Bike recovery officer's name |
| `team_code` | text | **The code field officers sign in with.** Stored in readable text on purpose, so the PMO can read it over the phone and change it the instant it leaks. |
| `updated_at` | timestamptz | Last edit |

**This table is the wiring diagram of the whole system.** Every officer board, every leader
report and the recycling rotation resolve "who owns this customer" by looking up the customer's
team here and reading the relevant role column. Move a name between teams and every report
re-points itself — no other change needed.

#### `access_codes` — who can sign in to the portal
| Column | Type | Meaning |
|---|---|---|
| `code` | text (key) | The access code itself |
| `name` | text | The person's name |
| `role` | text | Their role (ADMIN, MANAGEMENT, GMO, …) |
| `teams` | text[] | Which teams they may see. **Empty/null means ALL teams.** |
| `tabs` | text[] | Extra screens granted to this person specifically |
| `created_at` | timestamptz | When issued |

#### `roles` — screens granted by role
| Column | Type | Meaning |
|---|---|---|
| `role` | text (key) | Role name |
| `tabs` | text[] | Screens everyone with that role may open |

#### `settings` — every configurable number in the system
| Column | Type | Meaning |
|---|---|---|
| `key` | text (key) | Setting name |
| `value` | text | Its value |

Full list of settings in Part 7.

#### `hints` — the rotating tips shown in the app
| Column | Type | Meaning |
|---|---|---|
| `id` | uuid (key) | Row id |
| `tab` | text | Which screen the tip belongs to (`all` = everywhere) |
| `message` | text | English tip |
| `sw_message` | text | Swahili tip |

> A tab can hold **many** tips and the app rotates through them. Originally `tab` was the key,
> which allowed only one tip per screen and made uploading a real tip sheet fail outright.
> Fixed by migration `2026-07-27-hints-many-per-tab.sql`.

#### `call_agents` — the customer-service agents named on loan applications
| Column | Type | Meaning |
|---|---|---|
| `user_id` | text (key) | The agent id in your reports (`Callagent1`, …) |
| `names` | text | The human(s) behind that id — one id can cover two people who share a desk |
| `updated_at` | timestamptz | Last edit |

> These are **not** the phone-app users. The dashboard's call-agent board counts applications
> brought in by each agent id (`loans.created_by`), which is a different question from how many
> phone calls a field officer made.

---

### The loan pipeline

#### `loans` — one row per loan, all 8 stages
Replaces: Unassigned, Assigned, Unassessed, Assessed, Pending Approval, Approved (Processed),
Pending Disbursement, Disbursed Loans.

| Column | Type | Meaning |
|---|---|---|
| `id` | uuid (key) | Row id |
| `docket_no`, `loan_id`, `track_no` | text | File / loan / repeat-loan numbers |
| `full_name`, `contact`, `momo` | text | Customer name, phone, mobile-money number |
| `recipient_full_name`, `recipient_momo` | text | If money goes to someone else |
| `guarantor_name`, `guarantor_contact` | text | Guarantor |
| `region`, `branch`, `team`, `zone`, `location`, `nearest_landmark` | text | Where |
| `product`, `disbursement_type` | text | What product, how paid out |
| `requested_amt`, `team_recomm`, `previous_balance` | numeric | Requested, team's recommendation, prior balance |
| `principal_amt`, `processing_fee`, `interest_amt`, `net_disbursed`, `loan_amt` | numeric | The money |
| `bank_name`, `account_no` | text | Bank details |
| `stage` | loan_stage | Where the loan is: one of the 8 stages |
| `disb_status`, `disb_date` | text/date | Disbursement status and date |
| `approved_date`, `approved_by`, `disbursed_by` | date/text | Approval and disbursement |
| `created_by` | text | **The call agent who took the application.** Feeds the call-agent board. |
| `assigned_by`, `assigned_at`, `recommended_by`, `recommended_at` | text/timestamptz | Workflow trail |
| `created_at`, `updated_at` | timestamptz | Row timestamps |

**Sales** = `principal_amt` of loans with `stage = approved`, counted by `approved_date`.

---

### Snapshots — the daily pictures

Both snapshot tables are **append-only history**. Nothing is overwritten. Every upload adds a
new day; the readers pick the right one. This is what makes "recovery since Monday" and every
trend possible.

#### `repayment_snapshots` — Expected (who should pay, and did they)
| Column | Type | Meaning |
|---|---|---|
| `id` | uuid | Row id |
| `ref` | text | Customer reference |
| `docket_no`, `full_name`, `contact`, `guarantor_name`, `guarantor_contact` | text | Identity |
| `disb_date`, `due_date`, `first_schedule_date`, `last_schedule_date`, `last_trans_date` | date | Dates |
| `due_summary` | **text** | "4/6" paid/target — text on purpose |
| `initial_inst`, `other_inst` | numeric | First and weekly instalments |
| `payment_expected` | numeric | Due today |
| `todays_payment`, `todays_status` | numeric/text | Paid and its label |
| `arrears`, `total_amount`, `balance` | numeric | Money |
| `branch`, `team`, `zone` | text | Where |
| `snapshot_type` | text | `today` / `tomorrow` / `yesterday` / `initial` |
| `snapshot_date` | date | Which day this file describes |
| `upload_batch` | uuid | **One code per upload** — see Part 4 |
| `created_at` | timestamptz | When uploaded |

#### `defaulter_snapshots` — the defaulter decks
| Column | Type | Meaning |
|---|---|---|
| `id` | uuid | Row id |
| `ref`, `docket_no`, `full_name`, `contact`, `guarantor_name`, `guarantor_contact` | text | Identity |
| `disb_date`, `expire_date`, `chronic_date`, `due_date`, `last_trans_date` | date | The dates that decide state and rotation |
| `status` | text | Defaulter / Expired / Chronic / Partial |
| `ds` | **text** | "3/6" — text on purpose |
| `dc` | integer | Default count |
| `days_elapsed` | integer | Days in default |
| `initial_inst`, `other_inst`, `payment_exp`, `t_payment`, `arrears`, `balance` | numeric | Money |
| `branch`, `team`, `zone`, `nearest_landmark` | text | Where |
| `snapshot_type` | text | `initial` (morning baseline) or `current` (later) |
| `weekday` | text | MON…SUN — which weekday's deck this is |
| `snapshot_date` | date | Which day it was uploaded for |
| `upload_batch` | uuid | One code per upload |
| `created_at` | timestamptz | When uploaded |

---

### Follow-up

#### `followup_status` — the current state of each defaulter (one row per customer)
| Column | Type | Meaning |
|---|---|---|
| `ref` | text (key) | Customer reference |
| `team`, `full_name`, `contact`, `guarantor_name`, `guarantor_contact` | text | Identity |
| `disb_date`, `last_trans` | date | Dates |
| `status`, `ds`, `dc`, `days_elapsed` | text/int | State |
| `rejesho` | numeric | Weekly instalment |
| `arrears` | numeric | Owing |
| `fu_status` | text | What the officer found (see list below) |
| `promise_date`, `promise_amt` | date/numeric | If they promised to pay |
| `last_comment`, `comment_by`, `comment_at` | text/timestamptz | The most recent note |
| `updated_at` | timestamptz | Last change |

**This is the officers' working list** — the Def/Exp/Chr tabs on the phone and the Followup tab
in the portal both read it. Uploading a **Defaulters — Current** deck automatically refreshes
this list, *merging* rather than replacing: the deck's figures are updated but `fu_status`,
promises and comments the officers typed are preserved.

**Follow-up statuses** (the fixed list officers choose from):
`AMENASIA / WRONG REF`, `HAJAPATA MKOPO`, `HAPATIKANI YEYE & MDHAMINI`,
`YEYE / MDHAMINI HANA USHIRIKIANO`, `AMETOA AHADI` (requires a promise date),
`ANALIPA LEO`, `AMETUMA KWA AFISA` (requires a comment), `REJESHO LIMELIWA` (requires a
comment), `ANA NAMBA NYINGINE` (requires the new number), `OTHERS` (requires a comment).

#### `followup_comments` — every note ever left, never edited
| Column | Type | Meaning |
|---|---|---|
| `id` | uuid | Row id |
| `ref` | text | Which customer (must exist in `followup_status`) |
| `docket_no`, `team`, `full_name` | text | Copy of identity at the time |
| `comment` | text | The note |
| `fu_status` | text | Status chosen |
| `promise_date`, `promise_amt` | date/numeric | Promise made |
| `new_number` | text | Alternate phone captured |
| `created_by` | text | Which officer |
| `created_at` | timestamptz | When |

---

### Operational registers

#### `received_payments`
`paid_at` (date), `team`, `customer_name`, `customer_no`, `transaction_id`, `ref_no`,
`amount_paid` (numeric), `payment_no`, `sender_name`, `created_at`.

#### `abnormal_payments`
`gmo`, `team`, `pmo`, `contact_no`, `phone_number`, `ref_no`, `ref_id`, `customer_name`,
`sender_name`, `transaction_id`, `paid` (numeric), `payment`, `created_at`.

#### `complaints` and `complaint_log`
`complaints`: `ref`, `team`, `complainant`, `phone`, `category`, `channel`, `details`,
`status` (default `Open`), `resolution`, `logged_by`, `resolved_by`, `resolved_at`,
`created_at`.
`complaint_log`: every action taken on a complaint — `complaint_id`, `team`, `action`, `note`,
`status`, `created_by`, `created_at`. Deleting a complaint deletes its log with it.

#### `restructures`
`ref`, `team`, `full_name`, `contact`, `guarantor`, `guarantor_contact`, `arrears`, `dc`,
`first_inst`, `remaining`, `interest_on`, `interest_amt`, `total`, `installments`, `inst_amt`,
`start_date`, `status` (default `Pending`), `requested_by`, `approved_by`, `approved_at`,
`reject_reason`, `notes`, `created_at`.

#### `demand_notices`
`ref`, `team`, `full_name`, `contact`, `notice_date`, `notice_days`, `paid_count`, `fine`,
`principal_remaining`, `total_demand`, `arrears_at_notice`, `other_inst`, `issued_by`,
`created_at`.

---

### The phone app's own tables

#### `call_users` — who is registered on a handset
| Column | Type | Meaning |
|---|---|---|
| `user_id` | text (key) | Internal id |
| `name`, `team`, `role` | text | Who they are |
| `is_leader`, `leader_teams` | boolean/text[] | Leaders see more than one team |
| `device_id` | text | Which handset holds the session. **Clearing this signs the phone out.** |
| `phone` | text (unique) | **Identity is the phone number** — a new handset or reinstall picks the same person back up |
| `passcode_hash`, `passcode_salt`, `passcode_set_at` | text/timestamptz | Per-officer passcode, stored scrambled (scrypt), never readable |
| `active` | boolean | Switch off to cut this one officer off immediately |
| `created_by` | text | Which admin issued the account |
| `registered_at`, `last_sync`, `last_ts` | timestamptz/bigint | Session bookkeeping |

#### `call_logs` — every call, synced from the phone's own call log
| Column | Type | Meaning |
|---|---|---|
| `id` | text (key) | A fingerprint of the call — **the same call can never be stored twice** |
| `user_id`, `officer`, `team` | text | Who made it |
| `phone` | text | The number called |
| `direction` | text | `IN` or `OUT` |
| `call_date`, `call_time`, `duration` | date/time/int | When and how long (seconds) |
| `portfolio` | boolean | Was this number one of ours? |
| `match_type` | text | `CUSTOMER` or `GUARANTOR` |
| `ref`, `customer` | text | Who it matched |
| `outcome` | text | `CONNECTED` / `MISSED` / `REJECTED` / `BLOCKED` |
| `category` | text | `EXPECTED` or `DEFAULTER` |
| `synced_at` | timestamptz | When it reached the server |

#### `announcement`
A single row (`is_on`, `text`, `image_url`) that can take over the app's screen with a notice.

---

## Part 4 — The rules that make the numbers right

These are the decisions that took the most work to get correct. If a future developer changes
any of them without understanding, the numbers break silently.

### 1. Re-uploading a report replaces it; it does not double it

Every upload is stamped with one `upload_batch` code. When reading, the system finds the
**latest date**, then the **latest batch within that date**, and uses only those rows. So
uploading the same day twice supersedes rather than double-counts — while the older upload
stays in history.

*This is why the upload page says "2 uploads today (newest wins)".*

### 2. Decks must be paired on date **AND type AND weekday**

Recovered = initial arrears − current arrears. If the two sides come from *different
populations*, the gap between the populations is reported as recovery.

Real failure this caused: initial read correctly, current read larger, recovery showed
**−194 million**. The dashboard was matching on date+type+weekday and the officer board only on
date+type, so each side picked a different deck. Both now match on all three.

### 3. If one side of the pair is missing, recovery is **zero**, not the whole book

An initial deck with no current would otherwise read as "everything recovered". A current with
no initial would read as the negative of it. Missing pairs contribute 0, and the screen says
which day is unpaired.

There is also a **deck warning**: if the two decks differ in customer count by more than 2%,
the screen says one upload looks incomplete and the recovery figures are overstated.

### 4. What counts as "collected"

- **PAID / OVERPAID** → counts the expected amount only, never the overpayment.
- **UNDERPAID** → expected minus arrears, never below 0 or above expected.
- Anything else → 0.

Because every row is clamped at 0 before summing, **uncollected can never go negative**.

### 5. Recovery % denominator depends on the day

| Day | Denominator |
|---|---|
| Monday | today's uncollected (no "yesterday" exists inside a HOPE week) |
| Tuesday–Friday | yesterday's uncollected (officers chase what yesterday left behind) |
| Saturday/Sunday | the whole week's uncollected (Mon–Fri) |

### 6. The clock is East Africa Time, always

Servers run on UTC. Between midnight and 3am EAT, UTC is still on yesterday — which made
today's payments come back empty and the weekday resolve wrongly. Every date decision in the
system goes through one file that shifts to UTC+3 first.

### 7. The recycling rotation

- **ACTIVE** (still in term): rotates through `ASSIGN_ACTIVE` every `ASSIGN_BUCKET_DAYS` days.
  Label `D<days elapsed>`.
- **EXPIRED**: steps one role per week through `ASSIGN_EXPIRED`. Label `E-W<n>`.
- **CHRONIC**: rotates through `ASSIGN_CHRONIC` weekly, forever. Label `C-W<n>`.
- After `ASSIGN_GRACE_WEEKS`, an expired customer is treated as chronic.

**Which two days a customer is visited** comes from `DISB DATE`: the weekday it was disbursed,
and the day three days later. If the deck has no DISB DATE, the cycle cannot be computed — in
that case the app shows the whole assigned book rather than an empty screen, and says why.

### 8. "Amepigiwa leo" (called today) means a real conversation

A call ticks the customer off only if it lasted **more than `CALL_MIN_SECS` seconds**
(default 5). Android logs a call the moment it is placed, so rang-out, rejected and
two-second calls would otherwise mark customers as done who were never spoken to.
Direction doesn't matter and neither does who called.

### 9. Sales is measured monthly

Each team's target is 5m/day × 5 working days = 25m/week = **100m/month**. The phone bar shows
month-to-date progress on every day of the week, so the number never changes meaning on a
Saturday. Override with `SALES_TARGET_MONTHLY`.

### 10. Kesho is derived, never uploaded twice

Tomorrow's list is simply the Expected sheet **dated tomorrow**. On Friday and over the
weekend it rolls forward to Monday. Nobody uploads the same file twice under a second label.

### 11. Legal fines

Fine = weeks late × rate × weekly instalment.
Rate is **2%** for loans disbursed in 2024 or earlier, **5%** after.
There is a **14-day grace** past the first missed due date, and a customer who has missed only
one payment and has not expired owes no fine at all. Total demand = principal remaining + fine,
rounded up to the next 500.

---

## Part 5 — The screens

### The portal (`/dashboard`, the full system) — 23 tabs, in order

| Tab | What it does |
|---|---|
| **Dashboard** | Headline cards, weekday trends (applications Mon–Sun, sales Mon–Fri, collection Mon–Fri, recovery Mon–Sun), the pipeline funnel, team performance with leader names, and the officer boards (early collection, recovery, credit analysts, call agents, follow-up status) — each with a "today" and a "this week" view. |
| **Loan Applications** | The pipeline, all 8 stages. |
| **Complaint Register** | Log, track and resolve complaints, with a full action log. |
| **Expected Repayment** | Any weekday's Expected list with totals and status breakdown. Weekends land on Friday. |
| **Defaulter Assignment** | Who the rotation has given each defaulter to, with cycle labels. |
| **Exp.Def Recovery** | The management view of the rotation: GMO / MANAGER / BIKE, daily or weekly, with an email-to-admin button. |
| **Expected Defaulters** | Today's rotation list. |
| **Defaulters Followup** | The working list; add comments, statuses and promises. |
| **My Commission** | Each officer's commission by the configured rules, day and week. |
| **Promise to Pay** | Everyone who promised, and whether they kept it. |
| **Followup Report** | Follow-up outcomes across the book. |
| **Call Reports** | Calls by officer, talk time, portfolio hit rate. |
| **Abnormal Payments** | The register of payments that don't match cleanly. |
| **Legal / Demand Notices** | Computes the fine and produces the printable demand notice with its own notice number. |
| **Loan Restructuring** | Eligibility, the computed schedule, request and approval. |
| **Credit Analysts** | Applications processed, sales %, recovery share. |
| **Leader Reports** | Per-leader performance. |
| **Weekly Report** | Five sections per team. |
| **Portfolio at Risk** | PAR by principal band. |
| **Presentation** | Full-screen rotating slides for meetings; segments and team are selectable and remembered. |
| **Teams & Staff** | The wiring diagram: every team, its seven role columns, and its **team code**. |
| **Upload Reports** | Where the daily files go in. |
| **Settings** | Access codes, roles, field officer accounts, call agents, every setting, storage usage and the cleanup tool. |

### The phone app (`/call`, HOPE Calls) — 7 tabs

**Leo** (today's list) · **Kesho** (tomorrow's) · **Def** · **Exp** · **Chr** (defaulters split
by state) · **Exp.Def** (the rotation list, leaders only) · **Ripoti** (reports, leaders only).

Above them sits the **performance bar**:

> **Col leo · Kesho · Wiki · Sales · Exp.Def · Rec**

Col leo = today's collection %. Kesho = tomorrow's list %. Wiki = the week's collection %.
Sales = month-to-date against target. Exp.Def and Rec show the **percentage and the amount**
(e.g. `12% · 1.4m`), because a percentage is an abstraction at a customer's door and shillings
are not.

Each customer row carries name, phone, guarantor, arrears, rejesho, D.S, status, and a
✓ **Amepigiwa leo** tick when the number has genuinely been spoken to today.

### Mkopo Wangu (`/mkopo`) — the customer's own screen

**The third door.** Leaders sign in with an access code. Officers sign in with a team code.
Customers type a **reference number** and see their own loan — nothing else. No list, no
search, no other customer, no totals.

What a customer sees, in this order, because this is the order they care about:

1. **Their own name** — so they know they typed their own reference and not a neighbour's.
2. **The one number that matters** — what they owe today, or how far behind they are, as the
   biggest thing on the screen.
3. Balance, installment, paid today, arrears.
4. **A promise they already gave an officer**, shown back to them — so nobody is chased for
   something already agreed.
5. **Their payments**, newest first, with receipt numbers.

That last one is most of the point. *"Did my payment arrive?"* is the question this screen
exists to answer, and answering it without phoning an officer is the whole value.

**What it will never show, and why.** A reference number is the only thing being asked for, and
references are short. Someone who tries ten thousand of them gets ten thousand answers. That is
tolerable when each answer is *"your own balance"* — which the customer already knows. It is
**not** tolerable when each answer is a name attached to a working phone number.

So this screen never shows a phone number, a guarantor's name, or a guarantor's phone. Whoever
holds the reference already knows the customer's number; printing it back only helps somebody
who does not.

**If you want it tighter:** set `CUSTOMER_LOGIN_VERIFY` to `phone4` in Settings, and the
customer must also give the last four digits of the phone on their file. Guessing a reference
becomes guessing a reference *and* four digits. A customer with no number on file is still let
in on the reference alone — refusing would lock out exactly the people whose records are
thinnest.

### HOPE Live (`/live`) — the screen nobody is holding

A widget's whole point is that **nobody opens anything**. Put this on a monitor in the office,
or add it to a phone's home screen, and leave it. Six figures — Col leo, Kesho, Col wiki,
Sales, Exp.Def, Rec — refreshing themselves every two minutes.

- **It never asks for a login twice.** It takes the code the person already has: a leader's
  access code *or* an officer's team code. Bookmark `/live?code=YOURCODE` and a wall display
  comes straight back up after a power cut with nobody there to type anything.
- **It stops asking entirely when nobody is looking at it.** That is what makes it cheap enough
  to sit on every phone in the field — a pocketed phone costs nothing.
- **When the network dies, the last known figures stay up.** Blanking a wall display over one
  bad minute helps nobody.
- **But the light goes amber the moment they stop being fresh**, and says how long ago in
  words. A screen showing yesterday's collection as though it were today's is worse than a
  blank one, and that is the entire trust model of a display nobody is watching.
- **It carries no customer data at all** — six percentages and their totals, under 1200 bytes.
  This ends up on lock screens and monitors in corridors.
- Red below 50%, amber below 80% — the same thresholds the officers are held to, so the wall
  and the phone tell the same story. A screen that flatters is worse than no screen.

Six across on a wide monitor, two across on a phone, and the numbers are large enough on a wall
screen to read from the door.

### The other pages

- `/` — the launcher. Sign in with an access code for the system, or press HOPE Calls, Mkopo
  Wangu, or HOPE Live. **If a field officer types their team code here, it takes them straight
  into HOPE Calls with the code carried across** — they should not have to know which button
  was meant for them.
- `/upload` — the upload page (also reachable inside the app). It prints its own age at the
  bottom, so "am I looking at the new version?" is answerable.
- `/dashboard` — the portal.

---

## Part 6 — Uploading: every report and the columns it needs

Columns are matched **by header name, not position**, so column order never matters and extra
columns are ignored. Where two names are listed, either works.

| Upload type | Goes to | Extra info needed | Key columns it reads |
|---|---|---|---|
| **Defaulters — Current** | `defaulter_snapshots` | weekday + date | REF#, DOCKET#, FULLNAME, CONTACT#, GUARANTOR NAME, GUARANTOR CONTACT, DISB DATE, EXPIRE DATE, CHRONIC DATE, DUE DATE, LAST TRANS DATE, STATUS, D.S, D.C, DAYS ELAPSED, INITIAL INST, OTHER INST, PAYMENT EXP., T.PAYMENT, ARREAS/ARREARS, BALANCE, BRANCH, TEAM, ZONE, NEAREST LANDMARK |
| **Defaulters — Initial** | same | weekday + date | same |
| **Expected — Today / Tomorrow / Yesterday / Initial** | `repayment_snapshots` | date | REF/REF#, DOCKET#, FULLNAME, CONTACT#, GUARANTOR NAME, GUARANTOR CONTACT, DISB DATE, DUE DATE, FIRST/LAST SCHEDULE DATE, LAST TRANS DATE, DUE SUMMARY, INITIAL INST, OTHER INST, PAYMENT EXPECTED, TODAY'S PAYMENT, TODAYS STATUS, ARREAS/ARREARS, TOTAL AMOUNT, BALANCE, BRANCH, TEAM, ZONE |
| **Loan pipeline** | `loans` | which stage | FULLNAME, CONTACT#, MOMO, RECIPIENT…, GUARANTOR…, REGION, BRANCH, TEAM, ZONE, LOCATION, NEAREST LANDMARK, PRODUCT, DISB MODE, REQUESTED AMT, TEAM RECOMM, PREVIOUS BALANCE, PRINCIPAL AMT, PROCESSING FEE, INTEREST AMT, NET DISBURSED, LOAN AMT, BANK, ACCOUNT NO, DOCKET#, LOAN ID, TRACK#, **CREATED BY**, DISB STATUS, DISB DATE, APPROVED DATE, APPROVED BY, DISBURSED BY, ASSIGNED BY |
| **Defaulters Followup** | `followup_status` | — | REF#, TEAM, FULLNAME, CONTACT#, GUARANTOR NAME, G. CONTACT, DISB DATE, LAST TRANS, STATUS, D.S, D.C, DS, REJESHO, ARREAS, FU STATUS, PROMISE DATE, PROMISE AMT, LAST COMMENT, COMMENT BY, COMMENT AT |
| **Comments Log** | `followup_comments` | — | REF#, DOCKET#, TEAM, FULLNAME, COMMENT, FU STATUS, PROMISE DATE, PROMISE AMT, NEW NUMBER, BY, TIMESTAMP |
| **Leaders / Teams** | `teams` | — | TEAM, OPM, RECOVERY, GMO, MANAGER, CREDIT, EXPECTED, BIKE |
| **Received Payments** | `received_payments` | — | DATE, TEAM, CUSTOMER NAME, CUSTOMER NO, TRANSACTION ID, REF NO, AMOUNT PAID, PAYMENT NO, SENDER NAME |
| **Abnormal Payments** | `abnormal_payments` | — | GMO, TEAM, PMO, CONTACT NO, PHONE NUMBER, REF NO, REF ID, CUSTOMER NAME, SENDER NAME, TRANSACTION ID, PAID, PAYMENT |
| **Complaints** | `complaints` | — | REF, TEAM, COMPLAINANT, PHONE, CATEGORY, CHANNEL, DETAILS, STATUS, RESOLUTION |
| **Loan Restructuring** | `restructures` | — | the restructure columns |
| **Demand Notices** | `demand_notices` | — | the notice columns |
| **Access Codes** (admin) | `access_codes` | — | CODE, NAME, ROLE, TEAMS, TABS (`ALL` or blank = all teams) |
| **User Roles** (admin) | `roles` | — | ROLE, TABS |
| **Call App Users** (admin) | `call_users` | — | the user columns |
| **Call Logs** (admin) | `call_logs` | — | the call columns |
| **Settings** (admin) | `settings` | — | KEY, VALUE |
| **Hints** (admin) | `hints` | — | TAB, MESSAGE, SW-MESSAGE. **Replaces the whole tip sheet**, so deleting a tip from the sheet removes it. |
| **Company logo** (admin) | `settings.CALL_LOGO_URL` | — | an image file, not a spreadsheet — shrunk to 512px in the browser and stored inline |

### What a SECOND upload of the same report does

This is fixed per report. There is no append-or-replace option to choose, because the right
answer is a property of the report, not of the moment — a daily snapshot must supersede, a
register must accumulate. Getting it wrong silently doubles a figure or silently loses history,
so the system decides and **tells you, both before you upload and in the result message**.

| Report | Second upload does | Why |
|---|---|---|
| Defaulters — Current / Initial | **Supersedes** that date | Each upload carries one batch stamp; readers take the latest date, then the latest batch. The old copy stays in history but stops counting. Nothing doubles. |
| Expected — Today / Tomorrow / Yesterday / Initial | **Supersedes** that date | Same batch rule. |
| **Loan pipeline (all 8 stages)** | **Your choice: Append or Replace all for that report date** | A loan is one row whose `stage` moves, matched on the loan's own number (LOAN ID, else DOCKET#, else TRACK# + name + phone) — so Append never duplicates a loan. Replace removes everything uploaded under that report date **for that stage** and writes this file instead. |
| Defaulters Followup | **Updates** each customer (`ref`) | |
| Leaders / Teams | **Updates** each team | |
| Access Codes / User Roles / Settings | **Updates** each code / role / key | |
| Call App Users / Call Logs | **Updates** each user / call | Calls are keyed on a fingerprint, so the same call cannot be stored twice. |
| Hints | **Replaces the whole sheet** | A tip you delete from the file disappears from the app. |
| Company logo | **Replaces the logo everywhere** | |
| Comments Log | **Your choice: Append or Replace all for that report date** | A comment is an event, so the default adds — but a report pulled twice can be redone. |
| Received Payments | **Your choice: Append or Replace all for that report date** | |
| Abnormal Payments, Complaints, Loan Restructuring, Demand Notices | **Your choice: Append or Replace all for that report date** | |

### The report date is the upload stamp, not the dates inside the file

This is the important distinction. A **loan applications report pulled on 27 July legitimately
contains applications dated in June** — so the dates in the file cannot say which report a row
came from. The person uploading says it.

On the upload page, every accumulating report shows:

> **Tarehe ya ripoti / Report date** — defaults to today, but you can name any date, so
> yesterday's report can be redone today without pretending it is today's.
>
> **Ongeza / Append** — adds to that date's report.
> **Badilisha yote / Replace all** — removes everything already uploaded under **that date**
> (and, for the pipeline, that **stage**) and writes this file instead. **No other date is
> touched.**

**Replace never touches work your staff typed in the app.** Complaints logged at the desk,
restructure requests, demand notices issued from the Legal screen and officers' follow-up
comments all live in the same tables as their uploaded counterparts. A row that arrived in an
upload carries a batch code; a row somebody typed does not — and replace only ever removes the
first kind. The three upload-only reports (loan pipeline, received payments, abnormal payments)
have no such work to protect, so a replace there clears the whole stamp.

The result message then says exactly what happened — e.g. *"Replaced the 2026-07-27 report:
412 earlier row(s) removed, 398 written. No other date was touched."*

Snapshots (Expected and Defaulters) do not show this choice, because their snapshot date
already supersedes automatically — offering a second way to say the same thing would only
create a way to get it wrong.

**Underneath, in database terms:**
- **Batch-superseded**: `repayment_snapshots`, `defaulter_snapshots`
- **Updated in place** (one row per key): `followup_status` (`ref`), `teams`, `access_codes`,
  `roles`, `settings`, `call_users`, `call_logs`
- **Replaced wholesale**: `hints`
- **Stamped with `upload_date` + `upload_batch`, append or replace-by-date**: `loans`
  (also keyed on loan identity), `followup_comments`, `received_payments`,
  `abnormal_payments`, `complaints`, `restructures`, `demand_notices`

---

## Part 7 — Every setting

Set these in **Settings → the settings list** (or by uploading a Settings sheet).

### Targets
| Key | Default | Meaning |
|---|---|---|
| `SALES_TARGET_MONTHLY` | 100,000,000 | Monthly sales target **per team**. Drives Sales % on the phone. |
| `SALES_TARGET_WEEKLY` / `SALES_TARGET` | 100,000,000 | Weekly target used by the portal dashboard's sales trend and team table. |

### The recycling rotation
| Key | Default | Meaning |
|---|---|---|
| `ASSIGN_ACTIVE` | `BIKE,MANAGER,GMO` | Rotation order for in-term defaulters |
| `ASSIGN_EXPIRED` | `MANAGER,GMO` | Weekly step order once expired |
| `ASSIGN_CHRONIC` | `BIKE,GMO,MANAGER` | Weekly rotation for chronic |
| `ASSIGN_BUCKET_DAYS` | 2 | How many days each active-phase officer holds a customer |
| `ASSIGN_GRACE_WEEKS` | 2 | Weeks after expiry before a customer is treated as chronic |

### The phone app
| Key | Default | Meaning |
|---|---|---|
| `CALL_BRAND` | HOPE MICROCREDIT CO. LTD | Company name shown in the app |
| `CALL_LOGO_URL` | — | **The logo, everywhere.** Set it by uploading an image on the upload page. |

### The customer's screen (`/mkopo`)
| Key | Default | Meaning |
|---|---|---|
| `CUSTOMER_LOGIN_VERIFY` | *(off)* | Leave unset and a **reference number alone** opens a customer's own loan, as asked. Set it to `phone4` and they must also give the **last four digits of the phone on their file** — guessing a reference becomes guessing a reference *and* four digits, at the cost of four more characters typed. A customer with no number on file is still let in on the reference alone, because refusing would lock out exactly the people whose records are thinnest. |
| `CALL_SYNC_SECONDS` | 300 | How often the phone syncs (60–3600) |
| `CALL_LOGOUT_ENABLED` | on | Set `NO` to hide the logout button |
| `CALL_MIN_SECS` | 5 | A call must last longer than this to count as "called today" |

### Restructuring
| Key | Default | Meaning |
|---|---|---|
| `RESTRUCTURE_MAX_MONTHS` | 4 | Longest new schedule |
| `RESTRUCTURE_INTEREST_PCT` | 12 | Interest applied if chosen |
| `RESTRUCTURE_MIN_DC` | 4 | Minimum missed instalments to qualify |
| `RESTRUCTURE_APPROVERS` | — | Who may approve |

### Commission
| Key | Meaning |
|---|---|
| `CMS_MODE` | `year` or `status` — which rate table applies |
| `CMS_YEAR_RATES` | Rates by disbursement year |
| `CMS_STATUS_RATES` | Rates by customer state (defaulter / expired / chronic) |
| `CMS_PAID_TZS` | Flat amount per customer who paid |
| `CMS_OVER_TZS` | Flat amount per customer who overpaid |

### Email and branding
| Key | Meaning |
|---|---|
| `ADMIN_EMAIL` | Where the weekly Exp.Def email goes |
| `EMAIL_FROM` | The from-address |
| `BRAND_LOGO`, `BRAND_SIGN`, `BRAND_STAMP` | Images on printed demand notices |

`RESEND_API_KEY` is **not** a setting — it is an environment variable set in Vercel
(Project Settings → Environment Variables), because it is a secret.

---

## Part 8 — Who can do what

There are **two separate doors** into the system, and this distinction matters:

### Door 1 — the portal, for leaders and admin
Sign in with an **access code**. The code carries the person's name, role, which **teams** they
may see (blank = all), and which **tabs** they may open. Team scoping is enforced on the server,
so a code that covers one team cannot read another team's customers no matter what is typed.

**ADMIN always holds every tab**, even if its tab list is blank.

### Door 2 — the phone app, for field officers
Sign in with **name + phone number + the team code**.

- The **team code** decides *which team* the officer sees. Typing a different team name cannot
  override it.
- The **phone number** decides *who they are*, so a shared code does not mean a shared identity
  — call attribution and per-officer reports keep working.
- **Changing a team's code signs out every handset on that team.** That is what "someone left,
  change the code" has to mean. Leaders are not affected, because they sign in with an access
  code.
- To cut off **one** person without disturbing colleagues: Settings → Field officer accounts →
  switch that account off, or delete it. Either takes effect on their next request.

Officer passcodes (per-person, scrambled with scrypt and a per-row salt) also exist and are
shown to the admin exactly once, at the moment they are generated.

**Why this was built:** before it, anyone holding the APK could register by typing a name,
picking a team off a public list and entering a phone number. No password, no approval. That
handed over a team's whole portfolio, and nothing revoked it when an officer walked out.

---

## Part 9 — Every file and what it is responsible for

### The database
| File | What it is |
|---|---|
| `db/schema.sql` | **The whole database structure.** Paste into Supabase → SQL Editor → Run. Safe to run twice. |
| `db/seed.sql` | Starter data |
| `db/migrations/2026-07-25-upload-batch.sql` | Added the `upload_batch` stamp |
| `db/migrations/2026-07-26-demand-notice-id.sql` | Notice numbering |
| `db/migrations/2026-07-26-officer-accounts.sql` | Officer passcodes, active flag |
| `db/migrations/2026-07-26-team-codes.sql` | The `team_code` column |
| `db/migrations/2026-07-27-call-agents.sql` | The `call_agents` table and roster |
| `db/migrations/2026-07-27-hints-many-per-tab.sql` | Many tips per tab |
| `db/migrations/2026-07-28-loan-identity.sql` | One row per loan; removes duplicates that had been inflating sales |
| `db/migrations/2026-07-28-upload-stamp.sql` | The report-date stamp that makes Append / Replace-by-date possible |
| `db/migrations/2026-07-28-speed-indexes.sql` | Indexes for the lookups every screen makes on load |
| `db/migrations/2026-08-01-storage-counts.sql` | **Makes the Settings tab open at once** — lets the database count rows instead of sending a million of them over the internet. Also pins `search_path` on both database functions, closing the security warning Supabase reports. |

> Migrations are run **in date order**, once each, by pasting into Supabase's SQL Editor.

### The server (the "API")
| File | Responsibility |
|---|---|
| `api/portal.js` | The single door for the whole portal — one route, one permission check |
| `api/call.js` | The single door for the phone app — and, because it was already open to people with no login, the door for the customer screen and the live widget too |
| `api/upload.js` | Receives every uploaded file, decides which table it belongs to, stamps the batch, and rebuilds the officers' working list from a Current deck |
| `api/me.js` | Who am I / what may I open |
| `api/dashboard.js`, `api/expected.js`, `api/defaulters.js`, `api/followup.js`, `api/comments.js` | Older single-purpose routes, still live |
| `api/app-version.js` | Tells the phone which build is current |

> Vercel's free plan allows **12 of these route files**. There are still 10, even after the
> customer screen and the live widget. New features ride on `api/portal.js` or `api/call.js`
> rather than adding routes — that is why almost everything is one door.

### The shared brain (`api/_lib/`)
| File | Responsibility |
|---|---|
| `portal-core.js` | Every portal screen's logic — the largest file in the system |
| `call-core.js` | Everything the phone app does: registration, lists, sync, comments, reports, the performance bar |
| `dashboard-core.js` | The dashboard computation, shared by the portal *and* the phone bar so the two can never disagree |
| `expdf.js` | The Exp.Def rotation logic, shared by portal and phone |
| `assign.js` | The rotation engine itself (who owns a defaulter today) |
| `recovery.js` | What "collected" and "uncollected" mean, and the Recovery % basis rule |
| `snapshots.js` | Finding the right snapshot: latest date, latest batch |
| `importers.js` | Every spreadsheet's column mapping |
| `parse.js` | Reading numbers, dates and phone numbers safely — including the D.S text protection |
| `auth.js` | Access codes, team scoping, tab permissions |
| `passcode.js` | Generating and checking passcodes (alphabet excludes 0/O/1/I/L so codes read aloud correctly) |
| `time.js` | Every "what day is it" decision, on the EAT clock |
| `supabase.js` | The database connection |

### The screens
| File | What it is |
|---|---|
| `public/app.html` | The whole portal — all 23 tabs |
| `public/call.html` | The whole phone app |
| `public/home.html` | The launcher |
| `public/upload.html` | The upload page. Prints its own age at the bottom, so "am I on the new version?" is answerable |
| `public/mkopo.html` | **The customer's own screen.** A reference number in, one loan out |
| `public/live.html` | **HOPE Live** — the six figures, refreshing themselves on a screen nobody is holding |
| `public/live.webmanifest` | Lets HOPE Live be added to a phone's home screen with a real icon, opening without browser chrome |
| `public/dashboard.html` | A simple read-only dashboard |
| `public/brand.js` | Puts the logo and company name on every page, and sets the browser-tab icon |

### Checking the system
| File | What it is |
|---|---|
| `test/*.test.mjs` | 124 checks of the rules and the sums. `npm test`. This is what guards a deploy |
| `test/fake-db.mjs` | A pretend database that lives in memory, so every rule can be checked with no Supabase and no network |
| `tools/browser-checks/*.mjs` | The screens, driven in a **real browser** against a stub server. Kept out of `npm test` on purpose so a deploy never depends on having a browser installed. See the last section of this document for how to run them |
| `tools/settings-load-bench.mjs` | Measures what opening the Settings tab actually costs, in rows and round trips |
| `docs/why-no-cache.md` | Why every page says `no-cache`, and why that explanation is not inside `vercel.json` |

### The Android app
| File | What it is |
|---|---|
| `android/app/src/main/java/…/MainActivity.java` | The app shell that opens the website |
| `…/HopeCallsBridge.java` | Reads the phone's call log and hands it to the page |
| `…/Updater.java` | Checks for a new version on launch and offers to install it |
| `android/app/src/main/res/mipmap-*/` | The app icons, at five screen densities |
| `android/app/src/main/res/mipmap-anydpi-v26/` | The adaptive icon for Android 8+ |
| `android/sideload.keystore` | The signing key. **Without this file, no future build can update installed apps.** Back it up. |
| `scripts/make-launcher-icons.py` | Regenerates all the icons from `brand/hope-logo.png` |
| `brand/hope-logo.png` | The master logo |
| `app-version.json` | The current version number the phones check against |

### Tests and docs
| File | What it is |
|---|---|
| `test/*.test.mjs` | 109 automated checks that run before every change |
| `test/fake-db.mjs` | A pretend database so tests never touch real data |
| `docs/hints-v2.tsv` | 99 ready-made tips to upload |
| `ARCHITECTURE.md`, `MIGRATION.md`, `README.md` | Technical notes |
| `.github/workflows/android-apk.yml` | Builds the APK automatically and publishes it |

---

## Part 10 — The Android app

- It is a **shell around the website**, plus one thing a website cannot do: read the phone's
  call log. That is why calls sync automatically on Android and not on iPhone (Apple forbids
  call-log access to every app, so iPhone users open the same site in Safari).
- **Calls are deduplicated by construction**: each call's id is a fingerprint of device +
  number + time + duration + outcome, so the same call cannot be stored twice no matter how
  many times it syncs.
- **Self-update**: on each launch it asks the site what the current version is and offers to
  install it. It never installs silently.
- **"Later" holds for one day**, not forever — a declined update is never a permanent dead end.
- Android 8+ requires **"Install unknown apps"** to be allowed for HOPE PMO before any update
  can install. The app checks this and offers to open that exact settings screen.
- **The fixed download link never changes:**
  `https://github.com/samaritantechs/hope-pmo-v2/releases/download/hope-calls-apk/HOPE-Calls.apk`

### To release a new version
1. Change `app-version.json` — raise `versionCode` by 1 and set a `versionName` and notes.
2. Merge to the main branch. The build runs automatically and replaces the APK at that link.
3. Phones offer the update on their next launch.

---

## Part 11 — Storage, and cleaning up

Supabase's free tier holds **500 MB**; the paid tier holds **8 GB**.

Settings shows exactly how much is stored, by date and report type, and how fast it is growing.
Because snapshots are append-only, they only grow — which is what makes trends possible, but it
also means old dates eventually need clearing.

**Settings → Kusafisha ripoti za zamani / Clean old reports**: pick a date, tick which report
types, optionally include everything before that date, press **Check first** to see exactly what
would go, then **Clean**.

Cleanable: Expected Repayment, Defaulters, Received Payments, Abnormal Payments, Call Logs.

---

## Part 12 — Keeping your own offline copy

Everything that *is* the system lives in the repository. Two things live outside it: your data
(in Supabase) and your secrets (in Vercel).

### 1. The code — download the whole repository as one file
Open **https://github.com/samaritantechs/hope-pmo-v2** → the green **Code** button → **Download
ZIP**. Keep that file somewhere safe. It contains every file listed in Part 9, including this
document.

Do this again after any round of changes.

### 2. The data — back up the database
In Supabase: **Project Settings → Database → Backups**, or **SQL Editor** to export tables to
CSV. At minimum, keep periodic copies of `teams`, `access_codes`, `settings`, `followup_status`
and `followup_comments` — those hold decisions people made, which cannot be regenerated from
uploads.

### 3. Two files that cannot be replaced if lost
- **`android/sideload.keystore`** — the app's signing key. Lose it and no future build can
  update apps already installed; every officer would have to uninstall and reinstall.
- **`brand/hope-logo.png`** — the master logo the app icons are generated from.

Both are inside the ZIP, but keep a separate copy anyway.

### 4. Your secrets — written down, not in the repository
- Supabase project URL and service key (Vercel → Project Settings → Environment Variables)
- `RESEND_API_KEY` if email is enabled
- Your admin access code
- The 100 access codes (kept out of the repository on purpose, since the repository is public)

---

## Part 13 — The slow week, and what it taught

This part exists because the system got worse before it got better, and anyone picking this up
later deserves to know why rather than guessing from the commit log.

### What went wrong

**I took the system down.** To make the pages load faster, I changed the way data is fetched
from the database — reading many pages at once instead of one after another. It was faster in
theory. In practice it overwhelmed the database under real load: logins failed across the
company, Settings would not open, and raw data appeared on screens where sentences should have
been. It was reverted the same day.

**The lesson, stated plainly:** never ship a performance change to a live system without
testing it under something like real load. Reasoning about speed is not the same as measuring
it. Everything in Part 14 was measured or driven in a real browser before it shipped.

**Then the data-transfer bill exploded.** 0.147 GB of data was generating 81 GB of transfer —
1,637% of the free allowance. The cause: every officer's phone was downloading **every team's**
customers and then hiding the ones that were not theirs. The filtering now happens in the
database, so a phone downloads only its own team.

**Then some well-meant edits broke the app.** A shortened list of columns was applied to a
function shared by three different screens, and customer rows arrived on officers' phones with
no names and nothing to tap. Another edit asked the database for a column that does not exist,
which makes the database reject the *whole* request rather than just leaving that field out —
so the Defaulters tab failed every single time. Both are described in Part 14.

### The rule that came out of it

Anything that changes what people see is now driven in a **real browser against a real page**
before it ships (`tools/browser-checks/`). Reading code is not enough for questions like *does
the page stay put*, *does the dropdown say what the table is showing*, or *can you read this
from across a room*. Those checks caught four genuine bugs during this round that reading had
missed — including one that would have put phone-sized numbers on a wall display.

---

## Part 14 — What changed most recently

Nine changes, in the order they shipped. Each one names the complaint it answers.

### 1. Customer bars with no names, that could not be tapped

`latestSnapshot` is used by three different screens with three different needs: the phone's
Leo/Kesho lists need names and phone numbers, the Exp.Def rotation needs dates and statuses,
the dashboard needs amounts. It had been changed to fetch a short fixed list of columns, which
starved two of the three. Restored, with a note in the file saying why it must not be narrowed
again.

### 2. The Defaulters tab failing every time

It asked for `amount_due`, a column that does not exist. When a requested column is missing the
database rejects the **entire** request — it does not simply leave that field out. The real
column is `arrears`.

### 3. Ripoti: choose a team

Three controls in one row — from, to, and **Team**. The list offered is what that leader is
*allowed* to see, not who happened to make calls that week, so a quiet team is still pickable.
Naming a team you do not lead is ignored, not obeyed. While one team is selected, a leader's
own calls stay out unless it is their own team — otherwise a manager filtering to Team B would
see their own Team A calls counted as Team B's.

### 4. The whole system reloading on every click

> *"Its not okay for the whole system to reload whenever something is clicked (it bores)"*

Every tab click wiped the page to a spinner and went back to the server — even flicking between
two tabs you had just read. Now a tab you have already opened comes back instantly, and the
server is asked quietly behind it; a hairline slides across the top while that happens.

Anything that **writes** — saving a setting, a team, a user, a comment — throws away everything
remembered, because a save on one tab can move the numbers on any other. The reload button
(the arrow, top right) still always goes to the server.

### 5. The blue screen after every phone call

> *"there is complains that after every call it loads again"*

Tapping a customer's number hands the phone to the dialler, and Android is free to throw the
page away while the officer talks — on cheap handsets it usually does. Every call ended on the
blue screen and a wait on the network.

The customer lists were already saved on the handset. The only thing missing was **who the
officer is** — a question the server had already answered that morning. The phone now remembers
that too, and goes straight to work. If the server later says the handset is no longer signed
in, everything remembered is cleared and it starts over.

### 6. A deploy that actually reaches the phones

> *"am not seeing the replace / append in the uploading after choosing report type"*

**It was never missing.** It had shipped weeks earlier. The phones were showing an old copy of
the page.

Every screen here is one file — when the page is old, the app is old. Nothing told a browser how
long to keep it, so each browser decided for itself, and the Android app's browser decided
"for ever". The pages now say **`no-cache`**, which does not mean *do not store* — it means
*keep the copy, but ask before using it*. The answer is normally a few hundred bytes saying
"unchanged".

**This is the most important change in the list**, because every future fix depends on it. Ask
people to close and reopen the app once. After that, a fix lands when it is deployed.

### 7. Approvals and received payments go by the dates in the file

> *"only loan approvals and received payments should use dates in data - not upload stamp but i
> still choose to replace or append"*

Every figure already read the dates in the data and always had. What did not was **Replace**:
re-pull the approvals report for 27 July, upload it today, press Replace, and it removed what
was uploaded under *today's* stamp while leaving the 27 July approvals sitting there. Backwards.

Now, for loan approvals, disbursed loans and received payments, the days come from the file, and
the page no longer asks for a report date for those three — the file already answered.

Because this is the only code in the system that deletes anybody's figures, it clears the
**exact set** of days found in the file, never the span between the earliest and latest — one
mistyped year would otherwise turn "redo 27 July" into "delete everything since 1970". A file
with no readable dates, or one claiming more than 62 different days, is **refused** rather than
guessed at. A refused Replace deletes nothing.

Every other report keeps the upload stamp, because it has to: an applications report pulled on
27 July legitimately contains applications dated in June.

### 8. Settings taking for ever

> *"Saving / updating settings takes so long"*

It was downloading **every row of five tables** — every snapshot, every payment, every call log
— to count them. Measured over a year of an operation this size:

```
before   1,248,000 rows over the wire, 1254 round trips
after        1,040 rows over the wire,    1 round trip
```

1254 separate requests, every time somebody opened Settings. That was the wait, and a large
slice of the transfer bill. Counting is the database's job.

*Reproduce it yourself:* `node tools/settings-load-bench.mjs`

**This needs `db/migrations/2026-08-01-storage-counts.sql` run.** Until it is, Settings keeps
working exactly as before — slowly. It never breaks. That migration also closes the security
warning about `loan_identity_text`.

### 9. and 10. The customer door and the live widget

Both described in Part 5 above.

---

## Part 15 — Where things stand

### Done and live
The whole v1 → v2 port: all 23 portal tabs, the phone app, uploads, the officer boards, the
recycling rotation on the phone, storage cleanup, team codes, officer accounts, the logo
everywhere including the app icon, and the self-updating APK. Plus everything in Part 14:
instant tab switching, no blue screen after calls, deploys that reach the phones, data-dated
replace, a Settings tab that opens at once, the customer screen and the live widget.

### Silent defects found and fixed along the way
Vanishing defaulters after upload; an unwritten complaint log; restructures approvable by
anyone; hand-typed legal fines; missing uploads that failed silently; discarded call
breakdowns; roles that could not be edited; complaints stamped at midnight losing their
time-of-day; hidden dockets; a day-0 value treated as missing; loans appending instead of
updating and doubling the sales figure; a Replace that would have taken staff-typed records;
Leo showing yesterday's list; Leo and Kesho showing the same people; and the four found by the
browser checks in this round.

### Waiting on you
- Run `db/migrations/2026-08-01-storage-counts.sql` — makes Settings instant and closes the
  `loan_identity_text` security warning.
- Run `db/migrations/2026-07-27-hints-many-per-tab.sql`, then upload `docs/hints-v2.tsv` as
  Hints.
- Run `db/migrations/2026-07-27-call-agents.sql`, then re-upload Unassigned/Assigned so the
  CREATED BY agent lands.
- Run `db/migrations/2026-07-28-loan-identity.sql`, `2026-07-28-upload-stamp.sql` and
  `2026-07-28-speed-indexes.sql` if they have not been run.
- **Tell the field to close and reopen the app once**, so they pick up the new pages. After
  that it is automatic.
- Reactivate phone `0677115897` in Settings so that officer can sign in.
- Set `RESEND_API_KEY` in Vercel and `ADMIN_EMAIL` in Settings for the weekly Exp.Def email.

### Worth doing next
- **A true Android home-screen widget** — the tile that draws outside any app, the way FotMob
  does. `/live` covers the computer and the phone home screen; the native tile needs Java in the
  APK and a rebuild, and it would read the same feed that already exists.
- Direct integration with the HOPE core system. It needs either a sample export of each report
  (headers plus ~20 rows), API documentation, or a read-only service account.

---

## How to check the system yourself

```
npm test                                    # 124 checks of the rules and the sums
node tools/settings-load-bench.mjs          # how much the Settings tab costs to open

npm i --no-save playwright-core             # once, for the browser checks
node tools/browser-checks/portal-nav.mjs        # the system does not blank on every click
node tools/browser-checks/call-warmstart.mjs    # no blue screen after a phone call
node tools/browser-checks/upload-mode.mjs       # Append / Replace on every report
node tools/browser-checks/customer-login.mjs    # the customer screen, and what it never shows
node tools/browser-checks/live-widget.mjs       # the wall display, including the network dying
```

The browser checks are kept out of `npm test` on purpose: `npm test` guards the deploy, and it
must not depend on having a browser installed.

---

*This document describes the system as built. If a future change makes any statement here
untrue, the change should update this file in the same breath.*
