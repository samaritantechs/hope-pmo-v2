# HOPE PMO v2 — Full Handoff

**Who this is for:** the owner of the system, not a programmer. Everything here is written so
that you can read it without knowing any programming language, and so that a developer you
hire in two years can pick the system up from this document alone.

**What it covers:** what was built, how the data is stored, what every table and column means,
what every screen does, what every word in the loan vocabulary means, every file and what it is
responsible for, and how to keep your own offline copy.

**If you read nothing else, read Part 15.** It says what is waiting on you, and it opens with
the one thing that must be done immediately after this deploy: **the system ships closed** —
everybody sees HOPE Calls only until you open it from Settings.

**Then:** Part 8 (who can do what, starting with that switch), Part 11 (what can be deleted and
what cannot, and the one cleanup that takes comment history with it), and Parts 14 through 14g
— everything that changed recently, each item named after the complaint it answers. Part 13 is
the honest account of a week where the system got worse before it got better, and what was
changed so it does not happen again.

**Part 5** is the tour of every screen, if you want the whole picture rather than the changes.

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

### Three things that sit on top of every tab

**Find a customer** (the magnifying glass, top right). One reference number, name or phone
number, and all eight books answer at once — Expected, Defaulters, Follow-up, the loan
pipeline, received payments, restructuring, demand notices, complaints. It is not a tab because
it belongs to none of them: an officer opens it while a customer is on the phone, reads what
they need, and closes it. The search runs in the database, over its indexes, so it answers
while somebody is holding. Team scoping applies — a search box is not a way around it.

**The bell** (beside it). Complaints logged and follow-up comments written, merged, newest
first, your own teams only. This is how a supervisor learns a complaint was raised without
opening the complaints tab. Marking them read is per person — clearing your own bell does not
clear anybody else's.

**The noticeboard.** An admin posts a picture, a sentence or both from the Settings tab, and it
covers every screen in the company until each person closes it. Waving away Monday's notice
does not wave away Tuesday's, and Monday's does not come back on the next click.

> **It is not private.** It has to reach the sign-in screen, where nobody has logged in yet,
> so it is served without a code. Anyone who can reach the site can read it. It is a
> noticeboard, not a message. It will not accept a picture over about 600 KB — every phone in
> the field loads it, most of them on mobile data — and it will not accept a web address in
> place of a picture, which would point every screen in the company at somebody else's server.

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
| Comments Log | **The same comment is never stored twice.** Send the file again as often as you like | A comment is recognised by who it was about, when, what was said and by whom. Importing years of v1 history is never one clean go, so re-uploading corrects rather than doubles. Customers not on the follow-up list get a placeholder so their history has somewhere to live; placeholders are never counted as defaulters. |
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

### The master switch — is the system open at all?
| Key | Default | Meaning |
|---|---|---|
| `SYSTEM_OPEN` | **NO (closed)** | Whether anybody except an admin may open the portal or HOPE Live. |

Do not type this one by hand — there is a real toggle at the **top of Settings**
("Mfumo kwa watumiaji wote / The system, for everybody"). See Part 8.

### PMO Collection
| Key | Default | Meaning |
|---|---|---|
| `PMO_ROLE` | `PMO COLLECTION` | The access-code role that marks a collection officer. Case and punctuation ignored. |
| `PMO_WEEKLY_BONUS` | *(not set)* | The weekly bonus for whoever leads having beaten their own previous week. The rule is built; the amount is yours to choose. |

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

### Door 0 — the master switch, which decides whether Door 1 exists today

**Settings → Mfumo kwa watumiaji wote / The system, for everybody.** One button. Closed,
everybody in the company has HOPE Calls and nothing else: no portal, no HOPE Live, and no sign
of either on their screen — the switch button in the Calls header disappears, the launcher stops
drawing the System / Upload / HOPE Live tiles and says why, and a leader who already had the
portal open is sent back to the launcher on their next click rather than left collecting red
errors on every tab.

**The default is closed.** A deployment that has never had this decided is one nobody has
decided about, and the safe reading of that is "not yet". So after any fresh install you must
open it deliberately.

Hiding a button is a courtesy, not a lock, so the refusal is on the **server**: `/api/portal`,
`/api/upload`, `/api/dashboard`, `/api/expected`, `/api/defaulters`, `/api/followup`,
`/api/comments`, and HOPE Live's own feed. Typing an address directly gets the same answer.

**An admin is never gated**, and is checked *before* the setting is read — otherwise the one
person who can open the door would be locked out by the same failure that closed it. If the
settings table cannot be read at all, the system stays closed for everybody else: a database
having a bad minute must not throw the doors open.

**HOPE Calls is never closed.** That is the whole point. Field officers carry on working.

Use it when the portal is being repaired, while a day's figures are being re-uploaded, or when
you simply are not ready for two hundred people to open it on the same morning.

---

There are then **two separate doors** into the system, and this distinction matters:

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
| `db/migrations/2026-08-05-snapshot-totals.sql` | **Team-day totals** — the database adds the snapshots up instead of sending them (Part 16) |
| `db/migrations/2026-08-05b-snapshot-totals-indexes.sql` | Its indexes, kept apart because they take minutes and must be run a line at a time (Part 16) |
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
| `snapshot-totals.js` | Asking the database for team-day totals instead of rows — and folding the rows here when the migration has not been run yet |
| `importers.js` | Every spreadsheet's column mapping |
| `parse.js` | Reading numbers, dates and phone numbers safely — including the D.S text protection |
| `auth.js` | Access codes, team scoping, tab permissions |
| `passcode.js` | Generating and checking passcodes (alphabet excludes 0/O/1/I/L so codes read aloud correctly) |
| `time.js` | Every "what day is it" decision, on the EAT clock |
| `supabase.js` | The database connection, and reading a big table in as few journeys as possible |
| `system-gate.js` | The master switch: is the system open to anybody but an admin (Part 8, Door 0) |
| `answer-cache.js` | Keeping the dashboard and the officer boards for one minute each, per set of teams |

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
| `tools/load-bench.mjs` | Builds 30,000 customers in memory and counts the requests, rows and megabytes behind **every** screen. This is what turned "the system feels heavy" into the table in Part 14c |
| `tools/make-handoff.mjs` | Builds the handoff **parcel** — the explanation, the whole database as one SQL file, and every line of code, zipped. Refuses to finish if the Android signing key or a `.env` has crept in |
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

**Cleanable — eleven report types:** Expected Repayment · Defaulters (initial + current) ·
Received Payments · Abnormal Payments · Call Logs · Loan Pipeline · Comments Log · Complaints ·
Loan Restructuring · Demand Notices · Follow-up list.

### "Some reports are not in the list — why?"

Because they **overwrite** rather than accumulate, so there is nothing to clean up: re-uploading
corrects the rows that are already there. Those are access codes, user roles, teams, field
officer accounts, settings and hints. Five of the six have their own delete button on their own
screen (Settings → the relevant register), and settings gained one too. Hints are replaced
wholesale by the next upload, so a tip removed from the file disappears from the app.

Four of the cleanable ones — Comments Log, Complaints, Loan Restructuring, Demand Notices — are
registers your staff also type into directly. Cleaning those **only ever takes rows that arrived
in an upload**. The box says so, and the result says how many typed rows it left alone.

### The one that is different: Follow-up list

This is the register that only ever grew. It is one row per customer, updated in place, and a
customer who leaves the deck **keeps** their row on purpose — their history is still worth
reading. Nothing ever removed one, and importing a year of v1 comments adds a placeholder for
every customer mentioned as well.

It can be cleaned now, and **it is the only line here that takes something else with it**:
removing a customer removes every comment ever written about them. Nothing about that is hidden
— the checkbox says it, **Check first** tells you exactly how many comments would go *and* how
many of those customers are still live defaulters, and the confirmation says it again. Use
**Check first** on this one. Always.

---

## Part 12 — Keeping your own offline copy

### The one command

```
node tools/make-handoff.mjs
```

Builds `handoff-build/hope-pmo-v2-handoff-<date>.zip` — about 700 KB — containing:

| | |
|---|---|
| `00-START-HERE.md` | What to open first, and what is deliberately missing |
| `1-READ-ME-FIRST/` | This document, plus the architecture notes and the v1 review pack |
| `2-DATABASE/FULL-DATABASE.sql` | **The entire database in one paste** — schema, every migration in the right order, and the seed rows. Safe to run against a database that already exists |
| `2-DATABASE/BACKUP-YOUR-DATA.md` | How to take a copy of the data, which no parcel can contain |
| `2-DATABASE/RUN-ORDER.md` | The long way, file by file |
| `3-SOURCE-CODE/` | Every file that runs the system |
| `4-DATA-FILES/` | The tips sheet, ready to upload |
| `MANIFEST.txt` | Every file and its size, plus what was left out and why |

**It refuses to finish if the Android signing key or a `.env` file has crept in.** That check
reads the finished parcel rather than trusting the list of things to skip — a parcel gets
forwarded, and one carrying the signing key would let a stranger push an "update" onto every
officer's phone.

**It cannot contain your data.** That is the next section, and it matters more than the rest.

---

## Part 12b — The longer version

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

## Part 14b — Closing the gaps against the old system

Somebody who knows the old Google Sheets system compared it against this one, function by
function, and produced a list of nine things v2 had lost. Eight of those were worked through.

**Seven items on that list turned out to already exist**, under different names or built in a
way the comparison could not see. Each was checked against the code before anything was built,
and skipped with a note rather than rebuilt:

| Reported missing | Actually |
|---|---|
| `FU status` on Followup | There all along, headed **Follow-up** |
| Search including guarantors | The table already searches every column that exists |
| The demand notice document | Written since the legal tab was built — only the *printing* was broken |
| My Commission's seven columns | On screen since the tab was built |
| `At notice` on Legal | There, headed **Arrears** |
| Call-agent delete | There, as a flag on the save |
| The apps tab's KPI cards | Eight of them, one per pipeline stage |

**Three of those were my own fault.** The inventory I generated for the review had a broken
column reader: it missed shared column lists, missed cards whose labels are worked out as the
page runs, and — worse — over-reported three tabs by swallowing code that belonged to their
neighbours. Leader Reports, Presentation and Teams & Staff were declared complete on that bad
evidence. **They have not been re-checked, and should be.** The reader is fixed and the
corrected inventory is `docs/V1-REVIEW-PACK.md`.

### What was genuinely missing, and is now done

**Defaulters Followup** got eight columns back — the guarantor and their phone above all, which
is who an officer rings when the customer will not answer. Plus a month filter, a two-level
sort, and a custom order so a follow-up status can sit in the order the work happens rather
than the order of the alphabet.

**Printing works.** It used to open a new window — blocked by browsers, impossible in the
Android app, where the button did nothing and said nothing. Documents now print from inside the
page, and the browser's print dialog includes Save as PDF.

**The restructuring contract** — the one document a customer signs. Swahili, A4, company stamp
and signature, three signature lines. Only an approved offer gets one.

**Demand notices now say whether they worked**: what was owed when the notice was served, what
is owed now, and the difference. A customer who has left the deck entirely counts as cleared —
but only if a deck was uploaded, or every customer would look cleared and the tab would report
a triumph that never happened.

**The noticeboard.** Post a picture, a sentence or both, and it covers every screen in the
company until each person closes it. It reaches the sign-in screen, which means it is **not
private** — anyone who can reach the site can read it.

**The bell.** Complaints logged and follow-up comments written, newest first, your teams only.
A supervisor finds out a complaint was raised without opening the complaints tab.

**Find a customer** — the magnifying glass. One reference number, name or phone, and all eight
books answer at once: Expected, Defaulters, Follow-up, the pipeline, payments, restructuring,
notices, complaints. Built for an officer who has a customer on the phone.

**A complaint can be deleted**, admin only. Every other register could lose a row and this one
could not. The audit trail is written so that it survives the deletion — a delete whose own
record deletes itself is worse than no delete.

**Four settings became real**: seconds per slide, how long a screen stays before refreshing,
and the two that pace the tips. **Five were refused**, most importantly `ARCH_KEEP_DAYS` —
nothing in v2 enforces retention, and a setting saying "keep 90 days" that deletes nothing is
worse than no setting, because somebody trusts it and stops cleaning.

### Still open from that list

- **The weekly report's section structure.** v1 was a multi-section document — Recovery
  officers, Expected officers, Credit analysts, GMO, Managers, Ongezeko la deni. v2 is one
  table with the right columns. The Monday meeting works; this is improvement, not repair.
- The legal **payment report** and the **weekly** document (the print system they need now
  exists, so both are smaller than they were).
- An **Officer** column on demand notices — who is *working* a notice, as distinct from who
  issued it. Needs a new column and a way to assign, so it is a schema change.
- The **presentation scope picker** — present to these three teams rather than all of them.
- A handful of columns on Expected, Assignment, defexp, complaints and Teams. Given seven of
  seven flagged items turned out to be renames, each needs looking at on screen first.

---

## Part 14c — "The whole system is heavy"

*"the system side navigating through pannels is heavy the def followup is heavy the dashbord and
presentation aint even finishing loading the live app says 45 seconds no response… am a single
user and experiencing this"*

That is not a load problem. One person on an idle system waiting forty-five seconds means the
work being done for one screen was enormous, and it was.

### It was measured before anything was changed

`node tools/load-bench.mjs` builds a real-sized operation in memory — 30,000 customers, a
snapshot a day — and counts every request each screen would send to the database, and every row
and megabyte that would come back. It runs in seconds and needs no database.

| Screen | Before | After |
|---|---|---|
| Dashboard (all teams) | **567 requests**, 175 MB | **68 requests**, 136 MB |
| Dashboard (one team) | 567 requests | **45 requests** |
| Presentation (all teams) | 103 requests, **258 MB** | 103 requests, **182 MB** |
| Presentation (one team) | 80 requests, 189 MB | **54 requests, 106 MB** |
| Defaulters Followup | **76 requests** | **4** |
| Weekly report | **246 requests** | **33** |
| Expected Repayment | 31 requests | **4** |

Each request is a separate journey from the web server to the database and back — 100–300
thousandths of a second on a good day. **567 of them is eighty-five seconds of pure waiting**
before a single figure is worked out, and the hosting platform gives up at sixty. That is why it
never finished.

### Four causes

**1. A thousand rows at a time, one request after another.** Thirty thousand customers meant
thirty separate journeys for *one* snapshot. Pages are now ten thousand rows: the same journey
carrying ten times as much.

Not *parallel* requests — that was tried once and it took the whole system down (Part 13).
Bigger journeys, not more of them at once.

A database can be configured to cap how much it returns, and it does so **silently** — a
truncated answer with no error. Treating that as "the end" would drop every row past it while
the totals still looked plausible, which is the worst way for this to fail. So a short page
landing on a number somebody would actually configure (1000, 5000, 25000…) is treated as a cap
and reading continues under it.

**2. The dashboard fetched all forty teams and threw thirty-nine away.** An officer scoped to
one team was downloading the whole company — 555,000 rows to look at 15,000. Every snapshot read
on that path now narrows to the caller's teams **at the database**.

**3. Followup read every comment ever written** — sixty thousand rows, to find the few hundred
carrying a replacement phone number. That was a defect introduced with the "New no" column a day
earlier. 76 requests → 4.

**4. The Presentation asked for 825,000 rows to show sums.** Every slide is money and headcounts
grouped by officer — not one customer's name, phone or balance appears anywhere on the deck —
yet each row arrived with all eighteen columns. The dashboard and the officer boards now list
what they actually read. On a weekend, when those reads cover Monday to Friday, that saving is
paid five times over.

### And the same answer is no longer worked out twice

The dashboard and the officer boards are the two most expensive answers in the system, they are
the first things everybody opens, and the Presentation waits on **both**. Each is now kept for
**one minute**, per set of teams. The first person pays; everyone else on the same teams — and
the same person navigating away and back — gets it at once.

One minute is deliberately short: an upload made on another server cannot reach in and clear it,
so a minute is the longest anybody waits to see their own upload reflected.

### The safety net

Narrowing which columns are fetched is exactly the kind of change that goes quietly wrong — ask
for too few and a screen silently loses a field. So **the fake database used by the tests now
returns only the columns asked for**. It used to hand back whole rows regardless, which meant a
narrowed request that forgot a column passed every test and failed in the field. (That is
precisely how customer rows once reached officers' phones with no name and nothing to tap.)
Running the existing tests under the stricter fake found no column already being dropped.

---

## Part 14d — "I can't let app users into the system when I announce the app is back"

The switch described in **Part 8, Door 0**. Built because the request was exact: let everybody
use HOPE Calls, and let nobody see the system side — not the switch button, not its sign-in —
until the admin turns it on from Settings.

It ships **closed**, and it covers HOPE Live too, because that was asked for in the same breath.

---

## Part 14e — "I want to upload the v1 follow-up comments"

The export with `TIMESTAMP · REF# · TEAM · FULLNAME · COMMENT · FU STATUS · PROMISE DATE ·
PROMISE AMT · BY · NEW NUMBER · DOCKET#`. Upload it as **Comments Log**. Every column was
already mapped. It was throwing away the one that matters.

**Every row was being stamped with the moment of upload.** A v1 export writes `6/22/2026 11:29`,
and the date reader could not cope with a date that has a clock attached — so it gave up and
used "now". Years of follow-up history would have collapsed into one instant, in file order,
with every date wrong, and nothing on screen would have said so.

Three things were needed to make this import trustworthy:

- **The clock is kept, and read as East Africa Time.** Both halves matter: the clock keeps an
  afternoon's comments in the order they were made, and reading 11:29 as EAT rather than
  Greenwich stops an evening comment landing on the previous day.

- **Day/month order is read off the file, not assumed.** `23/07` can only be day-first, `07/23`
  can only be month-first, and `06/07` is genuinely both — guessing wrong moves a comment by up
  to eleven months while looking entirely reasonable. The whole column is examined: one
  unambiguous value anywhere in the file decides every value in it. The same decision is applied
  to PROMISE DATE, so one file is never read two ways. **If the file offers no clue either way,
  the upload result tells you which way it was read** — check a few rows if it says that.

- **Customers who are no longer on the follow-up list.** A comment must belong to somebody, and
  over a year of history most of those customers have moved on. The whole upload used to be
  refused because of it. Missing customers now get a **placeholder** — the same one the phone
  app already creates when an officer comments on an Expected customer. Placeholders are never
  counted as defaulters anywhere. The result says how many were made.

**You can upload the file twice.** A comment is recognised by who it was about, when, what was
said and by whom, so a history file that went in half-way can simply be sent again. Importing
years of comments is never one clean go.

---

## Part 14f — "The call agents on the Presentation are the customer care ones"

*"we dont record talk time nor team as the call app users… our customer care agents are the ones
we call agents (applications brought in, CREATED BY on the application reports, TRACK# 1 only)"*

Correct, and the deck was wrong. Its "Call agents" slide was built from the phone call log —
talk time, connected percentages, portfolio counts — which is the **HOPE Calls app officers**.
Two different rooms doing two different jobs, one being projected under the other's name.

They are separate boards now:

| Slide | Who | Measured on |
|---|---|---|
| **Call agents — applications brought in** | Customer care | `CREATED BY` on the application reports, **TRACK# 1 only** — a track of 2 or more is a repeat customer and nobody won it. A blank track counts, because the earliest reports had no such column. |
| **HOPE Calls — busiest officers this week** | Field officers | Calls, talk time, portfolio, connected % |
| **HOPE Calls — least active this week** | Field officers | The same list the other way up |

An application report carries no date of its own — one pulled on the 27th is full of June
applications — so the week is measured on the **upload stamp**, which is you saying "this is the
report for this date". Names come from the Call Agents roster; an id with no roster entry shows
as the bare id, which is the signal to add them rather than a reason to hide the row.

**An officer who made no calls is the point of the third slide.** Built only from the call log,
somebody who never opened the app all week simply did not appear — and that is the name a
meeting about underperformance most needs to see. Every registered officer is now on the board,
at zero if that is what they did. Switched-off accounts are left out: they are not expected to
be calling, and listing them would bury the officers who are.

The same gap was in the **Call Reports** tab's officer table, and is fixed there too. That tab is
the fuller version of the same question — per officer, per team, per day, per category, per
outcome, over any date range you pick.

---

## Part 14g — "I don't see some reports at cleaning/deleting"

*"are they the ones that always overwrite? if its so okay but if they append then i need a
delete option"*

**Yes — with one exception, which has now been fixed.** The full answer is in Part 11.

Two things were found while doing it, both worth knowing:

- **A cleanup that reported success and deleted nothing.** Reports whose date column carries a
  clock were being compared against a bare date, and `2020-01-01T00:00:00Z` is not equal to
  `2020-01-01`. The comparison matched nothing, and the screen said it had worked.

- **A setting could never be deleted.** Every other register here can lose a row, so a key typed
  wrongly once stayed forever and an old build's switch kept quietly applying. Settings → tap
  the row → Delete.

---

## Part 14h — PMO Collection, and the recovery denominator

### The collection officers

A PMO collection officer holds a distributed set of teams and is judged on **one** thing: the
percentage of what was expected that actually came in. Not team count, not customer count, not
amount — the teams are distributed so those even out, and the whole point of the plan is that
two officers with very different portfolios are paid the same for the same percentage.

**How the system knows who they are:** an access code whose **role** is `PMO COLLECTION`, with
their teams listed on the code itself. That is where you put them, and it is the right place —
one officer holds thirty-odd teams, which is a list on the person rather than their name
repeated in thirty-odd rows of the Teams table.

The role name is the setting `PMO_ROLE`, so a different spelling is fixable without a deploy.
Case and punctuation are ignored: `PMO-COLLECTION` and `Pmo Collection` both match. An access
code with **no** teams (meaning *all* teams) is left off the board — their percentage would be
the company's percentage and would silently outrank everybody.

### The bands

| Collection % | Per day | Week | Month | |
|---|---|---|---|---|
| 85–89 | 20,000 | 100,000 | 400,000 | KUFELI |
| 90–92 | 25,000 | 125,000 | 500,000 | most days |
| 93–94 | 30,000 | 150,000 | 600,000 | one day in two or three weeks |
| 95–96 | 40,000 | 200,000 | 800,000 | the target |
| 97–100 | 60,000 | 300,000 | 1,200,000 | MAFANIKIO |

Below 85% pays nothing, which is intended. The written plan leaves gaps between the bands —
89 to 90, 92 to 93 — so 89.4% belongs to no band as written; it pays the band **below**, because
the alternative is a percentage that pays nothing while a lower one pays 20,000.

**The week is each day banded on its own percentage, added up.** A steady 90–92% week therefore
pays 5 × 25,000 = 125,000, exactly as the plan's table says — but a good Friday still earns
after a poor Tuesday, which is what rewarding *jitihada binafsi* means. The week's own overall
percentage is shown beside it, so both readings are visible.

> **This was a judgement call.** The plan's table can also be read as "score the week once and
> pay the WEEK column". The two agree when performance is steady and differ when it varies. If
> you want the other reading, say so — it is a small change.

### The weekly bonus

The rule is built: **whoever leads the week, and only if they beat their own previous week.**
Both halves are checked — leading a week worse than your own last one is not what the plan
rewards — and when it is not won the screen says *which* half failed.

**The amount is not set**, because the plan names the condition and not the figure, and there is
no honest default except none. Type it into Settings as `PMO_WEEKLY_BONUS` and it starts paying.
Until then the panel says so plainly rather than showing a number nobody chose.

### Where the money appears, and where it does not

**Commission panel:** the full board — expected, uncollected, percentage, band, today's rate,
the week's total, last week's percentage, and the bonus. An officer sees their own row; an admin
sees everybody.

**Presentation:** five columns only — **S/N, PMO, Teams, Uncollected, Collection %** — for today
and for the week. No shillings. That is not "not displayed": the presentation is handed a
different, smaller object built in `pmo.js`, so a future slide cannot include the money by
reaching for a field that happened to be sitting there. A projector in a meeting room is the
wrong place for anybody's pay, and it changes what the room talks about.

Early collection (PAID + OVERPAID counts) stays on the dashboard, as asked.

### The recovery denominator was wrong

Adding the uncollected column to the Recovery slide uncovered a real defect.

Recovery % is *recovered ÷ the uncollected the officer is actually chasing*, and which day's
uncollected that is depends on the day — the rule the dashboard has always used:

| Day | Divided by |
|---|---|
| Monday | today's uncollected (no yesterday exists inside a HOPE week) |
| Tue–Fri | **yesterday's** uncollected |
| Sat/Sun | the whole week's (the weekend reconciles Mon–Fri) |

**The officer boards were not following it.** They added up every Expected row of the whole week
— every day, and every *re-upload* of every day — and used that on both the daily and the weekly
board. So a team whose Tuesday file went in twice had its recovery percentage quietly **halved**,
and Monday was divided by a week that had barely started.

Fixed, and the denominator is now **on the slide**, immediately before the figure it produced,
labelled with which day it came from. A recovery percentage with no visible denominator is a
number the room has to take on trust. On Saturday and Sunday the day's own recovery gets a slide
beside the week's, both divided by the week's uncollected.

---

## Part 14i — Early collection was reading a report nobody uploads

*"i wonder at upload there is expected tommorow, i never used it b/se the essential reports are
initial and current where initial is the early col"*

That sentence explains an empty board. Early collection is judged on the list of who is due
**next** — collect before the day arrives — and the code read the **Expected Tomorrow** report
to find that list. This operation does not upload Expected Tomorrow. The essential Expected
reports here are **Initial** and the day's own, and it is **Initial** that early collection is
worked from.

So the board was silently empty. No error, no note, just an officer board with nobody on it.

**Now: Initial is read first, Tomorrow is the fallback.** Whichever of the two a company
actually uploads is the one used, and neither convention has to be explained to anybody. If
neither has been uploaded, the answer says so rather than showing a team that appears to have
collected nothing.

Both the dashboard and the officer boards read it through the same function, so the two screens
can never disagree about what "early collection" means.

**You can ignore Expected Tomorrow at upload.** It still works if you ever want it, but nothing
depends on it any more.

---

## Part 14j — One slide per role, and a grand total on everything

**Today and the week share a slide.** Split across two, the room read today's figure, discussed
it, and had lost the week by the time it came round — and *"is this better or worse than the
week?"* is the question every one of these boards exists to answer. PMO Collection, early
collection and recovery each now carry both periods on one page, joined on the officer.

**Every table has a grand total** — on the wall and on the tab. It is the number the meeting
reads out, and a projected table without one sends somebody to a calculator while the slide is
still up.

The rule lives in the column definition rather than in each board, so a new board cannot be
built without one by forgetting:

| Column kind | In the total |
|---|---|
| `num`, `money`, `dur` | Added up. Counts, shillings and talk time all sum honestly. |
| `pct` | **Never added up.** Worked out again from the two totals that made it, where both are on the board. Otherwise left blank. |
| anything else | Blank. |

A column of percentages summed is nonsense, and averaging them is nearly as bad: it weights a
team of four the same as a team of four hundred. Ninety per cent of a hundred and ten per cent
of a hundred is **fifty** per cent of two hundred, not a hundred.

---

## Part 14k — Totals that were missing, a blue that was too hard, and a bell for the field

### The totals were missing from the biggest table of all

Card boards got grand totals and so did every slide, but the **main list** — the largest table
on every tab, and the one the commission week is read from — did not. That is what "the
commission totals aren't adding" meant.

It has one now, worked out by the same rule as everywhere else, so the figure at the bottom of
a card and the figure at the bottom of the list can never disagree.

It totals **what is on screen**. Filter to one team and the total is that team's — the only
reading that makes sense under a filter, and a total that ignored the filter would be read as
the filtered one by everybody anyway.

### The blue

The system's blue and the app's logo blue were two different colours: the logo is an indigo
(`#3B30E6`), the system was a near-black navy laid down a 225-pixel sidebar, which is what made
it read as hard. **The whole ramp now sits on the logo's colour** — `--b700` *is* the logo — and
every screen shares it: the portal, the app, the launcher, the customer screen, the upload page,
the printed exports and the emailed report.

### The presentation follows the theme

It was a fixed dark navy whatever the rest of the system was set to, so somebody working in
light mode got a black screen thrown at the projector — and a bright meeting room is exactly
where a light deck reads better. Every colour on the deck is now a variable that flips with the
theme toggle.

### Team performance

Ranked on the **average of sales and collection**, best first, because a team that sells well
and collects badly is not a good team and neither is the reverse. Numbered after ranking.

| Column | Meaning |
|---|---|
| Monthly sales | Approved this calendar month. The month is the period a sales target is set over. |
| Total def · No. of def | Current arrears and the headcount behind them |
| Uncollected · Collection % | **Today** Monday to Friday, **the whole week** at the weekend |
| Rec % vs Mon · vs yesterday · vs week | All three at once |

Recovery % is recovered ÷ the uncollected being chased, and which day's that is changes with
the day. Rather than showing only the one today's rule picks, the slide shows all three so the
room can see the comparison instead of being told which to look at. Each day is batch-resolved
before being summed, so a report uploaded twice cannot double a denominator.

### The bell now reaches the field

Complaints logged at the desk and follow-up comments were visible only in the portal. A field
officer could not learn that a complaint had been raised against a customer on their round
except by being telephoned about it.

HOPE Calls has the same bell in its header, showing the same updates scoped to that handset's
teams — **through the same implementation**, in `api/_lib/notify.js`, so the office and the
field can never see different lists. "Read up to here" is remembered per handset, so one
officer clearing theirs does not clear anybody else's. The count refreshes on entry and
whenever the app returns to the foreground — the same moment the list already syncs, so it adds
no new habit of waking the network.

---

## Part 14l — The bell cost forty megabytes, and a Monday deck was clearing Thursday

### The bell was the most expensive thing on the screen

It shows sixty items. It was reading **every** complaint and **every** follow-up comment ever
written to find them — measured against a real book after the v1 history import at **204,000
rows and 40 MB per tap**, and then showing none of them, because none were on that officer's
team.

That was mine, and putting it on every field officer's phone made it far worse than it had been
in the portal. The database now does the ordering, the limiting and the team narrowing:
**3 requests, 120 rows, 0.05 MB.**

The unseen count is therefore "unseen among the newest sixty" rather than in all of history.
That is the honest thing for a badge to mean — nobody is going to read the four hundred and
first — and the badge already caps at 9+.

### A Monday deck was clearing Thursday's defaulters

The defaulter decks are **per weekday**. When a current deck was uploaded, the system blanked
the status and arrears of every customer who was not in that one file — so loading Monday's deck
cleared every defaulter whose follow-up day is Tuesday to Sunday, and Tuesday's upload cleared
Monday's back again.

**The Defaulters list on every phone was showing roughly a seventh of the book**, and which
seventh depended on whichever deck had been loaded last.

A Monday deck says something about Monday's defaulters and nothing about anybody else's, so only
Monday's are now compared against it. The very first deck for a weekday blanks nobody — "no
previous deck" must mean "blank nobody", never "blank everybody".

### Why a customer can be on Kesho *and* on Defaulters

This is correct, and worth knowing. They are two different questions:

- **Kesho** — who has money due next
- **Defaulters** — who is behind

Somebody in arrears still has a repayment schedule running, so the same person is usually on
both. Being on Kesho does not mean they have cleared.

What *was* missing is how fresh the defaulter list is. A customer stays on it until **their
weekday's** deck is uploaded again without them, so a deck nobody has re-sent for a fortnight
leaves people on the list who may already have paid. The Def / Exp / Chr tabs now say when the
figures were last refreshed, and why that matters.

### HOPE Live said nothing when the system was closed

HOPE Live opens and closes with the system — that was asked for. But when it was closed, the
code box came back **with nothing written on it**: type your code, press Start, get the same
empty box. It now names the switch and where to find it.

---

## Part 14m — The speed guard

*"Moving forward everything we do should take speed precaution."*

A promise to be careful is worth nothing six weeks later, so it is written down as something
that **fails**. `test/speed.test.mjs` gives every screen a budget in **round trips** and turns
`npm test` red when a change blows it — before it can be deployed.

Round trips are the unit because each one is a separate journey to the database and back, 100
to 300 thousandths of a second. Rows scale with the book; the number of journeys is a property
of the **code**, and it is what turned the dashboard into eighty-five seconds of waiting for one
idle user.

The phone budgets are the tightest, because a field officer on mobile data has the worst
connection in the company.

**If a change needs more, the question to answer first is "can the database do this instead of
me?"** — ordering, limiting, filtering and counting all belong there. If the answer is genuinely
no, the number is raised **in the same commit**, so the cost appears in the diff rather than
being discovered by somebody in the field. The guard caught HOPE Live at 31 against a budget of
30 on its very first run; that budget was raised to 35 with the reason written beside it.

---

## Part 14n — Why the comments were slow when the defaulters were fast

That is exactly the right question, and the answer is that they were **different shapes of
read**, not different amounts of data.

The Defaulters list is one query, narrowed to the officer's team, returning the columns the
screen draws. Four reads of the comment log were the opposite: no filter, no limit, every
column, every row ever written — and then the work done here afterwards.

| Read | Was | Now |
|---|---|---|
| **The phone's search index** — which comments carry a replacement phone number | every comment ever: **28 trips, 202,002 rows** | **8 trips, 2,402 rows** |
| **One customer's thread** | every column, no ceiling | four columns, newest 100 |
| **Promise to Pay** | every promise ever made | the caller's teams, the window asked for |
| **Follow-up report** | every follow-up row, all columns | six columns, team-narrowed |

The phone's search index is the one that was hurting. The portal's copy of that read was fixed
weeks ago and **the phone's was not**, which is why the app felt slower than the portal on the
same data.

### The speed guard only counted journeys — now it counts rows

This is the lesson worth keeping. `test/speed.test.mjs` was passing on all four of those reads,
because **a filtered `fetchAll` is one round trip and can still drag two hundred thousand rows
across the wire.** Every screen now declares both budgets, and the row budget is the one that
catches "select everything and sort it here". It caught the follow-up report immediately.

---

## Part 14o — The sheet that would not close

Tapping the **X** or the dark area did nothing; the only escape was Back, which left HOPE Calls
altogether and landed the officer on the launcher.

The close handlers were bound inside the **customer** sheet's form wiring. The bell uses the
same panel and never ran that wiring, so it opened a sheet with no way out at all. They are
bound once now, when the page loads, because the sheet is part of the page from the first byte.

**Back closes the sheet and stays in the app.** Opening it pushes a history entry for the
phone's Back gesture to consume; closing it by hand takes that entry away again, so Back never
has to be pressed twice to leave a screen. Escape does the same on a keyboard.

---

## Part 14p — The bell that spun, and the customer who would not leave

### Taarifa / Updates stuck on loading

Two different faults produced the same stuck screen, which is why it looked so stubborn.

The refresh updated the count and the little red dot and **stopped there** — it never redrew an
open sheet. So tapping the bell before the first count had landed drew a spinner that nothing
ever replaced. And the failure path was swallowed in silence, so a bell that could not reach the
server spun in exactly the same way, with no means of telling the two apart.

Now the sheet is redrawn the moment the answer arrives, opening the bell always asks again, and
a failure says so in words with an invitation to retry.

### The customer on Kesho with D.S 9-10 and on Def with D.S 8-9

Being on both lists is correct — they answer different questions. **Two different D.S values is
not**: it means the Def row came from an older deck than the Kesho row.

A customer stays on the officers' working list until **their weekday's** current deck is
uploaded again without them. That is the right rule, and it has a hole: if that weekday's deck
simply stops being uploaded — the customer left the book, the file was renamed, whoever sends it
went on leave — they sit there for ever, being telephoned about a debt that may be settled.

Every current deck now stamps its own date on the customers it confirms, and any row **nobody
has re-confirmed for a fortnight** is retired on the next upload. A weekday's deck should come
round every seven days, so a fortnight is forgiving.

Three things are deliberately never retired:

- somebody **in the file being uploaded** — that settles it, however old their stamp;
- a row with **no stamp at all** — it predates the column, or is a placeholder holding
  somebody's comment history, and retiring those would empty the list on the first upload;
- **anybody's comments.** Retiring a customer clears their deck figures only. The history stays
  attached to the reference for ever.

`db/migrations/2026-08-04-followup-deck-date.sql` adds the column. **Optional, as always** — the
code reads it defensively and simply does not stamp on a database that has not had it yet, so
nothing fails between the deploy and somebody opening the SQL editor. Until it is run, the
per-weekday rule is all that applies and this particular customer will keep reappearing.

---

## Part 14q — One wrong column name, one missing word, and a two-digit year

Three faults, reported together, all three mine.

### "Column complaints.created_by does not exist"

The bell reads the two things worth being told about: new complaints and new follow-up comments.
The comment log records who wrote a comment as `created_by`. The complaint log records who
logged a complaint as `logged_by`. Two tables, the same idea, different names — and I asked
complaints for `created_by`.

What makes this worse than a blank field is how PostgREST answers it. **One unknown column fails
the WHOLE read.** Not the column — the read. So the bell got nothing back at all and said it
could not load, and nothing about the bell explained why.

Fixed, and then guarded, because guessing a column name is the kind of mistake that will happen
again. `test/schema.test.mjs` reads `db/schema.sql` and every migration, works out every column
the database actually has, then reads every `.select(...)` in `api/` and compares the two. 245
column references checked on every `npm test`. A name that does not exist is now a red test on
this machine instead of a message on a phone in the field.

It only checks what it can see: a table with no `CREATE TABLE` in this repository is skipped
rather than guessed at, and `select('*')` is nothing to check. A second test asserts that the
scan still finds the ten tables the system is built on, so a scan that quietly stopped working
cannot leave the first test passing while checking nothing.

### "Failed: commentsDateOrder is not defined"

The v1 comment importer works out whether a file writes dates day-first or month-first by
looking at the whole file before reading any single row. That function lives in
`api/_lib/importers.js`; the upload route calls it; the upload route never imported it.

The edit that should have added it to the import list did not match the text it was replacing,
and I did not check that it had landed. Uploading a comment log therefore failed on the first
row, every time. It is in the list now.

### The promise date `23-06-26`

Your newest export writes years with two digits. Every date pattern in the parser demanded four,
so `23-06-26` was not a date it recognised — and a promise date that will not parse is a promise
nobody is reminded about.

Two-digit years are now read, with the ordinary convention: **under 50 is 2000s, 50 and over is
1900s**. So `26` is 2026 and `98` is 1998. Four-digit years are untouched, and a file that mixes
the two reads correctly either way.

Checked against the exact rows you sent:

```
2202508974 | 2026-06-22 08:45 | promise: 2026-06-23 | amt: 500,000 | AMETOA AHADI
```

### One thing that is fixed but will not look fixed yet

You ran `2026-08-04-followup-deck-date.sql`, and the retirement it enables happens **on the next
current-defaulter upload** — that is when the system compares who is on the deck against who is
on the list. `MATESO STEPHAN FELISI` will keep showing the stale Def row until a
defaulters-current file is uploaded. Nothing more to do; it clears itself.

---

## Part 14r — "ON CONFLICT DO UPDATE command cannot affect row a second time"

That is Postgres refusing to update the same row twice in one statement. Not skipping the second
row — **refusing the whole upload**, with a message that names no file, no column and no
customer. Somebody holding a year of history has nothing to act on.

The duplicate was real and entirely expected. A v1 comment sheet exported twice, or a row copied
down, gives you the same sentence about the same customer at the same minute. The system
identifies a comment by exactly those things — who it is about, when, what was said, by whom —
and that is **deliberate**: it is what makes re-uploading a half-loaded history collapse instead
of doubling every comment already in. The identity that protects the second upload was breaking
the first.

Now a repeated row is written once, and the upload says so: *"3 row(s) in the file were the same
record twice and were written once."* The **last** version wins, matching what a re-upload does —
later in the file is later in time, so a sheet corrected in place keeps the correction.

Rows with no key at all are deliberately left alone rather than quietly dropped. An upload that
reported success having written less than it was given would be worse than the error.

This applies to every report that updates in place rather than appending — comments, loans,
teams, access codes, roles, settings, officer accounts, call logs — not only the comment log.

---

## Part 14s — The performance strip now stays, and follows your uploads

> *"It gets lost so much that I am even not sure if it'll get back."*

Two separate things were wrong, and together they made the strip feel like something that might
not come back at all.

### It disappeared

The strip was hidden until a request succeeded, and hidden again on every restart. On the cheap
handsets Android throws the page away after each call — which is most of them — an officer saw
it for a few seconds after opening the app and then not again. One failed request took it away
with nothing to say why.

**A figure that comes and goes is worse than no figure**, because nobody can tell whether the
number is bad or the app is.

Now the last figures are kept on the handset and drawn **before anything is asked of the
network**, so the strip is on screen the instant the app is. A failed request changes nothing —
what is showing stays showing until better figures arrive. The only thing that removes it is
signing out.

Figures kept from an earlier day are still shown, because they are the last true thing that
officer was told — but the tag reads **Jana** and the strip dims, so yesterday's morning is
never passed off as this one.

The saved copy is stamped with **whose** figures they are. Handsets get handed on and officers
get moved; without that, one team's numbers would greet the next person to sign in looking
exactly as authoritative as their own. Signing out and being de-registered both clear it.

### It didn't follow uploads

The six figures are worked out from the whole book. Recomputing them on a timer for two hundred
officers is not affordable, so the strip refreshed on entry, on a manual sync tap, or on a
throttled return to the app — **a quarter of an hour after an upload at best**. Long enough to
be standing in front of a manager holding a phone that still shows the morning.

Now every upload stamps a version, and the sync each phone already runs every few minutes
carries that stamp back. The phone asks for new figures **only when the stamp has changed** —
that is, only when somebody has actually uploaded something.

The cost when nothing has been uploaded is one row read by its key, on a request that was
happening anyway. Officers with no calls to send, officers who never granted the call-log
permission, and anyone on a plain browser all still ask the question, because for the strip that
question *is* the sync.

Nothing to switch on. Upload a report and the strip on every phone updates within one sync
cycle — five minutes by default, and immediately on a manual sync tap.

---

## Part 14t — "Ruhusu comment kusave automatic"

Android stops an app that is not on screen, and on the handsets actually in the field it does so
aggressively. For HOPE Calls that means **a comment typed at a customer's door may never reach
the server** — the officer did the work and the system does not know it. The same for the call
that went with it.

There has always been a way to fix that: the phone can exempt the app. But it was a **button on
a banner** — something an officer had to notice on a list of customers and decide to press. Almost
nobody did, so almost nobody was exempt.

The call-log permission and the update check were never optional in that way: the app asks the
moment it opens. This now does the same. Every officer who has not already allowed it is asked
by the app itself, on their next open.

**The wording is the point.** Android calls this "allow background activity", which means nothing
to somebody standing at a door. The prompt says:

> 🔋 **Ruhusu comment kusave automatic**
> Simu yako inazima HOPE Calls ikiwa nyuma. Ukiruhusu, maoni na simu zako zinahifadhika zenyewe
> bila kusubiri. Bonyeza **Ruhusu**, kisha kwenye dirisha la simu chagua **Allow**.

Two taps: **Ruhusu**, then **Allow** on the phone's own dialog.

**Asked at most once a day**, until it is allowed. Android's dialog is the second step, so a
refusal costs two taps, and re-asking on every restart is exactly how people are trained to
refuse on sight. The check is the *granted state itself*, not a flag — so an officer who allows
it and later has it stripped by a battery-saver sweep is asked again.

**Nothing to reinstall.** This lives in the page, not the APK, and the bridge it calls has been
in the installed app since the beginning — so it reaches every handset in the field on the next
open.

### What is left on the banner

Only the part Android has no API for. Xiaomi, Oppo, Vivo, Huawei and Samsung each add their own
kill switch on top of Android's, on their own settings screen, that no dialog can open. Those are
still described by name for the handsets they apply to. The generic battery line and its button
are gone.

---

## Part 14u — MATESO STEPHAN FELISI, properly this time

I told you the stale Def row would clear itself on your next current-defaulter upload. **It could
not.** Two faults, both in the fix I shipped.

### The rule could never reach that row

The retirement asked: *when did a deck last confirm this customer?* — and read `deck_date`. Rows
with no `deck_date` were deliberately skipped, on the reasoning that they predate the column and
retiring them on a stamp they never had would empty the list.

Which is exactly backwards for the row being complained about. **It predates the column.** It has
no stamp, and it will never get one, because nothing is uploading its weekday's deck — that is
the whole reason it is stuck. The rule was written to skip precisely the rows it was written to
clear.

`updated_at` is the honest fallback. It is never null, and it moves whenever a deck confirms the
row or an officer comments on it. A row nothing has touched for a fortnight has not been
confirmed for a fortnight, whatever the reason. `deck_date` still wins where it exists.

### And it was reading a column it never asked for

`updated_at` was not in the list of columns the upload reads. Not a blank field — the column
simply is not there, so **every row looked freshly confirmed** and nothing was ever going to be
retired. (The schema test guards columns that do not *exist*; a column that exists and is not
asked for is a different mistake, and this is the one that catches it: a test built from your
actual case.)

### A brake, because this is the working list

Retiring is not deleting. It blanks the deck figures, keeps every comment, and the next deck that
names the customer brings them straight back. It is still the list two hundred people work from.

So one upload may retire at most **35%** of the list on age alone. Above that it retires nobody
and the upload tells you the number, because a large stale set means some weekdays' decks have
stopped being uploaded — a real problem to read about, not one to action quietly.

Every upload that retires anybody now says so in words, with the count.

### If you want it gone today

Upload any current-defaulter deck and the rule runs. Or clear the old rows directly:
**Settings → storage → Follow-up list, by date**, which is what
`2026-08-03-followup-cleanup.sql` enabled.

---

## Part 14v — "The performance bar is taking years to update, I don't know if it even does"

The mechanism was working. Two things stopped you being able to tell, and one made it slow.

**Coming back to the app did nothing for fifteen minutes.** Returning to the foreground called
the *throttled* refresh, which does nothing if the figures are less than a quarter of an hour
old. So the natural test — put the phone down, upload a report, pick the phone up — was the one
case that would not update. It now asks the cheap version question instead: two lookups by key,
and new figures only if something was really uploaded.

**Nothing on screen said when.** Most uploads move none of the six percentages by a whole point,
so a refresh that worked looked exactly like one that never happened. The tag now carries the
clock — **Leo 15:42** — and the strip flashes briefly when new figures land. A refresh that moves
no figure is still visibly a refresh.

**And you can now ask.** Tapping the strip fetches the figures again. That is the obvious thing
to do when a number looks wrong, and there was no way to do it.

Together: upload a report, pick up any phone, and the figures are current — or tap the strip and
watch the clock move.

---

## Part 14w — JOSEPH ANDREA KAHITWA, and a button instead of a wait

Same shape as MATESO: on **Leo** underpaid with D.S 9-10, and on **Def** with D.S 8-9, at the same
moment. Being on both lists is right — they answer different questions. **Two different D.S
values is not.**

Here is the honest description of why it is widespread. The working list only refreshes for
customers named in an uploaded **current-defaulter deck for their own weekday**. That rule is
right — a Monday file says nothing about Tuesday's people — and it has a hole: if a weekday's
deck stops arriving, everybody on it keeps figures that get older every week, and nothing on any
screen says how old.

The upload retires those rows now. But **it only runs when something is uploaded**, and the
person looking at the wrong number cannot make that happen.

### So it is a button

**Settings → Orodha ya wadaiwa iliyopitwa na wakati / Stale defaulters.**

- **Angalia / Check first** counts them and *names the first twenty*, with their team, their D.S
  and the date anything last confirmed them. "412 customers" is not a thing to act on without
  recognising at least one of them.
- **Safisha / Clean** clears the deck figures — status and arrears — so they stop showing as live
  defaulters.

**It deletes nothing.** The row stays, every comment stays, and the next deck that names the
customer puts them straight back with fresh figures. That is what makes it safe to offer as an
ordinary button, unlike the storage cleanup below it, which really does delete and really does
take the comment history with it.

Default is 14 days unconfirmed; the box takes any number.

## Part 14x — The Kesho figure that could never fill in

You do not upload "Expected — Tomorrow", and you never should have to: tomorrow's list is the
ordinary Expected sheet filed under tomorrow's date. The **Kesho tab** has always read it that
way, with the old explicit type behind it as a fallback.

**The Kesho figure on the performance strip only had the first half of that.** So on your
deployment — where nothing is ever filed ahead — Kesho on the strip was a permanent dash while
the Kesho tab immediately below it listed customers.

A number that is always blank looks exactly like a bar that is not working. It now falls back
exactly as the tab does, and a test asserts the two agree rather than being two derivations that
happen to match today.

## Part 14y — How old is the app you are holding?

Three rounds of "it still isn't fixed" could each have been a phone running yesterday's page, and
nobody — in the field or here — could tell.

The bottom of the customer list now says **Toleo la app / App version: 2026-08-03 15:40**. It
comes from the browser's own record of when it fetched the file, so a stale page cannot lie about
it the way a number printed into the page would.

**If that timestamp is older than a fix I have just deployed, the phone has not picked it up
yet** — close the app fully and reopen. That is the first thing to check before anything else.

---

## Part 14z — Two questions, answered from the code

### "Upload stamp" means the date you chose, not the moment you clicked

**Yes, that is how it works.** The date on the upload form is what gets written. The clock is
only used if that box is left empty, and then it is the EAT day, not the server's UTC one.

So a report re-done today for the 27th, uploaded with 27 July in the box, belongs to 27 July —
and **Replace all** for that report clears 27 July, not today.

Unassigned and Assigned applications work exactly this way: they carry the date you chose. Only
**Approved** and **Disbursed** read dates out of the file instead (`APPROVED DATE`, `DISB DATE`),
deliberately — a loan applications report pulled on the 27th is legitimately full of June
applications, so the dates inside cannot say which report a row belongs to. The person uploading
has to, and does.

### Cleaning stale defaulters does not touch the weekly summary

**It cannot.** The weekly summary counts defaulters from `defaulter_snapshots` — the uploaded
decks themselves, which are history and are never written by that button. The working list
(`followup_status`) is a different table with a different job: what officers are calling
*today*.

A test now holds those two apart. It builds the weekly summary, cleans two stale customers,
builds it again, and asserts **every team row and every total is identical**. A future change
that started counting a weekly figure from the working list would be silent, plausible and
wrong, so it fails instead.

What the button does **not** change:

| Untouched | Why |
|---|---|
| Weekly summary | counts from the uploaded decks |
| Promise to Pay | built on `fu_status` and `promise_date` — the officer's work |
| Assignments | built on comments and promises |
| Every comment ever written | never touched by anything here |

What it **does** change — which is the point:

- the live **Def / Exp / Chr** lists on the phones,
- the **follow-up report** arrears figures,
- the **officer boards** defaulter counts.

All three should change: they are meant to show live defaulters, and a customer no deck has
confirmed for a fortnight is not one.

Both answers are now printed on the button itself, so nobody has to ask again before pressing it.

---

## Part 15a — Why YOUR strip showed dashes

Found it, and it was not the figures.

An **all-teams admin registers on the phone with no home team** — `call_users.team` is NULL,
deliberately, because that column is a foreign key into the teams table and writing the literal
`ALL` used to break registration outright.

Working out which teams that person may see wrapped the NULL in a list, producing a scope of one
team **named `""`**. Nothing matches a team called nothing. So every denominator came out zero,
every percentage came out null, and the strip printed dashes all the way across — **for the one
person in the company most likely to be looking at it.**

The customer lists escaped it because they take their own path to the same question. The strip
did not. A NULL home team now means what it always meant everywhere else: every team.

### And the strip no longer hides why

It swallowed its failures in silence — *"never show an error in the header"* — which sounded
considerate and meant that "the figures are zero" and "the app cannot reach the server" looked
exactly the same on screen. Three rounds of work went into figures that were never the problem.

Now a failed refresh:

- leaves **every figure where it is** (an old number beats no number),
- puts **⚠ Bonyeza** where the clock goes,
- and **tapping it says why, in the server's own words**, then tries again.

## Part 15b — "Expected — Tomorrow" is gone from the dropdown

You have said several times that you do not use it and that your way of working has no place for
it. You were right, and it should never have been asking.

**There is no such report.** Tomorrow's list is the ordinary **Expected — Today** sheet filed
under **tomorrow's date**. That is how the old system worked and how the Kesho tab has always
read it. A separate report type asked somebody to upload the same file twice under a second
label, and looked like a required step nobody could explain.

It is no longer offered. The server still accepts the old type so historic uploads keep reading
correctly — nothing already stored is affected.

The date box now says this where the question actually arises:

> **Kesho / tomorrow:** there is no separate "tomorrow" report. If you have the sheet for
> tomorrow, upload it as **Expected — Today** with **tomorrow's date** here, and the Kesho tab
> reads it. If you never file ahead, leave it — Kesho simply stays empty.

So: **do nothing with it.** If Kesho is blank on the phone, that is correct for how you work, not
a fault.

---

## Part 16 — 161,000 rows for a page of sums, and the upload that could not finish

Two things reported together on the same morning, and they turned out to be the same problem
wearing two hats: **too much being carried through the web server at once.**

> *"uploaded expecteds successfully but defaulters — Failed: SyntaxError: Unexpected token 'A',
> "An error o"... is not valid JSON"*
>
> *"in web: Hakuna mtandao / No connection. (Unexpected token 'A', "An error o"...)"*

### First, what that message actually was

**It was not bad data, and it was not a bug in the page.** `An error o…` is the first ten
characters of *"An error occurred with this application"* — the **hosting platform's own error
page**, in HTML. The page asked for JSON, got a web page, and reported the only thing it could
see: that the first character was an `A`.

The platform sends that page when it **kills a function** — out of time, or out of memory. So
the message meant *"the server gave up"*, and said so in a language that sends somebody to check
their internet connection instead.

That is fixed on its own account. The portal and the calls app already turned a non-JSON answer
into words; **the upload page, the launcher and the customer screen did not.** All three now say

> **Seva imechukua muda mrefu mno / the server took too long — HTTP 504**
> **Seva imeshindwa kujibu / the server could not answer — HTTP 500**

with the status attached. The wrong number is still a problem, but now it is a problem you can
read.

### Why the defaulters upload in particular

Expected files went in. Defaulter files did not. The difference is that a **current** defaulter
deck does three heavy things at once, and it did all of them in single gulps:

- it wrote **the whole file in ONE request** — tens of thousands of customers, twenty-five
  columns each, built into one JSON body of tens of megabytes inside the function's memory
  before any of it was sent;
- it then **rebuilt the officers' working list**, which means writing a second body the same
  size;
- and to merge that list without losing what officers typed, it held **the entire follow-up
  list in memory** as well — the one register that only ever grows, with a placeholder for
  every customer a year of imported v1 comments ever mentioned.

Three copies of the book, in a container with a fixed memory allowance. Expected files are
narrower and rebuild nothing, which is exactly why they survived.

**Now:** writes go **a thousand rows at a request**, and the working list is **read a page at a
time**. It costs a few more journeys and a fraction of the memory. This is the same trade the
reading side already made for the same reason — fewer, bigger journeys rather than one
impossible one, and never several at once, which was tried and took the whole system down
(Part 13).

One thing changed with it, and it is worth knowing: **an upload is no longer all-or-nothing.**
If the fifth chunk fails, the first four are already in. That is harmless here — every row of a
snapshot upload carries one batch stamp and a re-upload supersedes the whole batch, and the
keyed tables correct in place — and both were already true of a *second* upload. The error now
says how many rows were in when it stopped, so *"upload it again"* is an instruction rather
than a hope.

**And one real bug was found while doing it.** The upload reads the *previous* deck for that
weekday to work out who has left it. That read was unpaged — and a truncated answer would make
every customer past the cut look as though they had left, so the upload would have **blanked
live defaulters off two hundred phones and said nothing.** It reads through the paging path
now, which is the one read in this system that treats a suspiciously round short page as a
ceiling rather than as the end.

---

### Second, the 504s on the system side

*The database is 150 MB, fully indexed and analysed.* Nothing about it is slow. What was slow —
and what was eating the memory — is that **the Dashboard, the Weekly report and the Presentation
were fetching every snapshot row of the week to add them up here.** About **161,000 rows** on
your book, per request, serialised by the database, carried over the internet, parsed into
objects and held in memory all at once, so that a page of sums could be worked out.

**Not one of those screens shows a customer.** Every figure on all three is money or a headcount
grouped by team and by day. No name, no phone number, no balance appears anywhere on them.

So the adding up moved to where the data already is.

**`db/migrations/2026-08-05-snapshot-totals.sql`** adds two functions that return **one row per
team, per day, per deck, per upload** with the figures already summed — about **two hundred rows
instead of a hundred and sixty thousand**.

Measured on a real-sized book (`node tools/load-bench.mjs`, 30,000 customers over 20 days):

| Screen | Before | After |
|---|---|---|
| Dashboard (all teams) | 72 requests, 555,040 rows, **94.1 MB** | 19 requests, 52,480 rows, **7.1 MB** |
| **Presentation (all teams)** | 112 requests, 825,080 rows, **141.4 MB** | 34 requests, 89,280 rows, **14.5 MB** |
| Officer boards | 40 requests, 270,040 rows, 47.3 MB | 15 requests, 36,800 rows, **7.3 MB** |
| Weekly report | 35 requests, 237,040 rows, 38.4 MB | 12 requests, 27,640 rows, **2.2 MB** |

The Presentation — the heaviest screen in the system, and the one Part 15 said was still fifteen
seconds of waiting — now carries **a tenth** of what it did. `node tools/load-bench.mjs --before`
prints the old figures beside them, so the claim is checkable rather than quoted.

The phone's performance strip was changed the same way, and for a sharper reason: **two hundred
handsets ask for it every few minutes**, and an admin who sees every team was downloading the
whole book to work out two percentages on a strip an inch tall.

### "No figure may change" — and how that is proved rather than promised

This is the frightening kind of change to make to a system whose entire value is that its numbers
are right. A silently wrong total is worse than a screen that does not load, because nobody
argues with it.

So **`test/snapshot-totals.test.mjs` computes every one of those screens BOTH WAYS over the same
book** — once with the database grouping and summing, once with the rows read and added up here —
and asserts the two answers are **identical, field for field**. Not "close", not "the totals
agree": every team row, every trend day, every percentage, every note, on a weekday **and** at
the weekend, for an admin **and** for an officer scoped to two teams.

The two sides are deliberately **separate pieces of arithmetic**. A comparison where both halves
called the same function would prove nothing at all. Changing the database's sum by one shilling
per customer turns **16 of the 23 checks red**, which is the only way to know a test is doing its
job.

The book those tests run on is built to be awkward on purpose: every collection status including
blanks and odd spacing, customers whose arrears exceed what was expected (so the per-row clamp
matters), a customer with no team, a day **uploaded twice**, and a weekday whose initial deck is
missing.

### What deliberately did NOT move into the database

**Which upload wins.** Every read resolves the latest date, then the latest batch within it, so
a corrected re-upload supersedes instead of doubling. Four screens apply that rule at four
subtly different groupings. A second copy of it written in SQL could drift from the first — and
a drift *there* silently doubles a figure, which is the exact failure the batch stamp exists to
prevent. So every summed row still carries its `upload_batch` and the newest moment inside it,
and the existing rule runs unchanged over a thousand times fewer rows.

**Anything that is about a person rather than a team.** Three things genuinely cannot be answered
by a team total, and they still read customer rows:

| Still reads customers | Why |
|---|---|
| The weekly report's **Count 1-6 / Ongezeko la deni** | It compares each *customer's* Monday arrears against their arrears at the end of the week. No team total can say whether one person cleared. |
| **Commission's recovery side** | Paid per customer recovered, not per team. |
| Every **list** — Expected, Followup, the phone's Leo/Kesho/Def | They show customers. That is the point of them. |

Those reads were narrowed to the columns they use — the weekly report's two deck reads were
asking for every column of every row.

### Running it: the functions first, the indexes separately

The first version of this migration ended with two `create index` lines, and pasting the whole
thing into the Supabase SQL editor answered:

> **Failed to run sql query: Connection terminated due to connection timeout**

Building an index on a live table takes minutes. The editor's connection gives up long before
Postgres does — and because the editor sends a whole script as **one statement**, that timeout
rolled back the *functions* along with it. Nothing was created, and the message named neither
the statement nor the table.

So the migration is split by **how long each half takes**, not by what it is about:

| File | What it does | How to run it |
|---|---|---|
| `2026-08-05-snapshot-totals.sql` | The two functions. **This is the half that makes the screens cheap.** | Paste the whole file, press Run. Instant — defining a function reads no rows and locks nothing. |
| `2026-08-05b-snapshot-totals-indexes.sql` | Two indexes that make them faster still | **One line at a time.** Both use `create index concurrently`, which Postgres refuses to run inside a transaction — and the editor puts everything you paste into one. |

`concurrently` is what makes the second file safe to run during the working day: it builds
without blocking, so a defaulter deck can still go in while two hundred officers work from it.

**The two `grant execute` lines at the end of the first file are belt and braces, and usually
unnecessary.** Postgres already grants EXECUTE on a new function to everybody. They matter only
on a database whose default privileges have been changed — and if they time out, or are never
run at all, **nothing breaks**: a function the app may not call reads to it exactly like one
that does not exist, and both fall back to adding the rows up here. There is no state in which a
missing grant produces a wrong figure or an error on a screen. The file carries a catalogue-only
query that answers "was it ever needed?" instantly, without taking a lock.

**The indexes are a refinement, not a requirement.** `idx_repay_snap_lookup` already leads on
`(snapshot_type, snapshot_date, team)`, which serves the Expected reads well — they always name
a type, and equality on the first column with a range on the second is exactly what a composite
index is for. The reads that gain are the defaulter ones, which ask for both types at once and
so cannot use an index leading on type.

### It is optional, like every migration here

Until `2026-08-05-snapshot-totals.sql` is pasted into Supabase, **the same code reads the rows
and adds them up itself, exactly as it always has.** Nothing breaks by the migration being late;
it is only slow. Nothing needs re-deploying after it is run either — the system notices within
five minutes.

The speed guard now carries **two budgets for every screen**, one for each world, so the slower
path cannot quietly rot on a deployment that has not run the migration yet.

### And then the loans table, which was the next largest

Done in the same round, once the snapshots were out of the way and it became the biggest thing
left. Three separate reads were carrying every loan the company has ever written:

| Read | Was | Now |
|---|---|---|
| The dashboard's trends and team board | every loan, ten columns | **this week and this month only** — the furthest either one looks |
| The pipeline funnel | every loan, counted here | **eight counts**, answered by the database with no rows at all |
| The officer boards' analyst and agent boards | every loan | **this week only** — both are weekly boards |
| The call boards | `select('*')` over a week of calls | the eight columns a board of counts and talk time actually draws |

The funnel is the interesting one. It is an all-time question by definition — how many
applications sit at each of the eight stages *right now* — so it cannot be given a window. But
it is eight numbers, and asking the database for eight numbers costs eight requests that carry
no rows between them. That is the first question the speed guard tells you to ask, and the
answer here was yes.

Everything is team-scoped at the database now, which is why the one-team figures fall furthest.

### Where the whole round landed

Measured the same way (`node tools/load-bench.mjs`, 30,000 customers over 20 days):

| Screen | Before any of this | After |
|---|---|---|
| **Presentation (all teams)** | 112 requests, 825,080 rows, **141.4 MB** | 38, 50,280, **6.5 MB** |
| Presentation (one team) | 34 requests, 50,930 rows, 9.1 MB | 34, 3,285, **0.4 MB** |
| Dashboard (all teams) | 72 requests, 555,040 rows, 94.1 MB | 25, 32,980, **3.5 MB** |
| Dashboard (one team) | 20 requests, 44,140 rows, 7.9 MB | 22, 2,326, **0.2 MB** |
| Officer boards | 40 requests, 270,040 rows, 47.3 MB | 13, 17,300, **3.0 MB** |
| Weekly report | 35 requests, 237,040 rows, 38.4 MB | 12, 27,640, **2.2 MB** |

The Presentation carries **a twenty-second** of what it did. A field officer's dashboard carries
**a fortieth**.

### What is still heavy, and honestly

The Expected Repayment tab and Loan Applications still read 30,000 rows, and they should: they
are **lists of customers**. That is the screen, not a sum. The follow-up status board reads the
whole book because it reports on the whole book. None of those is the same kind of waste.

---

## Part 17 — The day the database broke, and what it was NOT

This part exists because I spent most of a day confidently diagnosing the wrong thing, and the
next person deserves the real answer rather than my reasoning.

### What actually happened

**A Postgres upgrade failed roughly halfway through**, on an instance running Supabase's
smallest compute tier — **Nano**. Supabase support's words:

> The Postgres upgrade appears to have failed due to resource constraints. The project is
> currently running on Nano, which has limited CPU and memory. Since Nano and Micro are billed
> at the same rate in paid organizations, upgrading this project to Micro will not incur any
> additional compute cost. Please upgrade to Micro and retry the Postgres upgrade.

**Nano and Micro cost the same on a paid plan.** The instance was one size below what it could
have had for free, and an upgrade could not complete on it.

After that, the database was **intermittent** rather than slow: `select 1` instant, `CREATE
FUNCTION` two minutes, `GRANT` on one catalogue row timing out, `notify` — which touches nothing
at all — timing out, a `select` on a four-row table failing while two `update`s on the same table
succeeded moments later. Supabase's own dashboard showed **4,697 Postgres requests with 3,935
errors** in twenty-four hours, against 227,000 API gateway requests. The advisor reported no
issues, because there was nothing wrong with the schema.

### What I said it was, and why I was wrong

I diagnosed **disk I/O throttling** — a spent burst-credit budget — and I was wrong. The evidence
genuinely fit: instant when served from memory, minutes when it touched disk, no load to explain
it. But that pattern also fits a half-upgraded instance too small to finish the job, and I never
considered the second reading.

**The tell I missed:** `notify pgrst, 'reload schema'` timed out. That statement reads nothing,
writes nothing and takes no lock. No amount of I/O throttling can make it slow. When it failed I
should have stopped blaming resources being *consumed* and started asking what was *broken* — and
told the owner to open a support ticket hours before they did.

The lesson, plainly: **when a statement that touches nothing cannot complete, the instance is
broken, not busy.** Stop tuning and get the platform to look at it.

### What this cost, and what it did not

The performance work in Part 16 was real and it is measured — the Presentation went from 141 MB
to 6.5 MB per open, the officer boards from 47 MB to 3 MB. **None of it caused this, and none of
it fixed it.** Two entirely separate problems arriving on the same morning, which is exactly why
each of them was so hard to see past the other.

The two team-day-total functions were confirmed present in the database throughout, callable by
every role. They survived the whole episode, as anything that is only two functions and no data
will.

### Two things worth checking before anything else, next time

**Which deployment are you actually looking at?** The owner found the system working at
`hope-pmo-v2-ten.vercel.app` while it was failing elsewhere. A Vercel project has several
addresses — the production domain, a per-branch preview, and a default `*-ten.vercel.app` style
alias — and they do not all serve the same build. Testing a fix on the wrong one wastes a round
of "it still is not fixed" for reasons that have nothing to do with the fix. **Check the
production domain is the one being used, and check its build is the current commit.**

**And what does the Postgres panel say?** Supabase Home shows API Gateway, Postgres, Storage,
Auth and Realtime side by side, each with its own error count. Postgres failing 84% of its
requests while the gateway fails 2% is not a slow query — it is the database itself, and it is
visible in one glance without running any SQL at all.

### The upload, and the thing still worth building

Uploading is the one thing that cannot be made to work on a database in that state, and it is
also the thing the business cannot do without. It fails in two different ways depending on how
the writes are sized -- `canceling statement due to statement timeout` when the chunk is too
large, HTTP 504 when so many small chunks are used that the whole function outruns sixty seconds.
The adaptive chunk in Part 16 finds a size between those two, and on a healthy database that is
enough.

**It is not enough on a weak one, and that is a design limit rather than a bug.** A thirty
thousand row deck should never depend on a single sixty-second window. The durable answer is for
the upload page to send the file in slices — one HTTP request per few thousand rows, all sharing
one upload batch, with the follow-up list rebuilt only on the last one. Then no single request
can be too big to finish, whatever the database is doing that morning.

### Built, and here is exactly how it is safe

The upload page now sends a big file in slices — **2,000 rows per request**, one after another,
never several at once. A file small enough for one request is still sent whole, unchanged.

Three things have to hold for that to be safe, and **each of them fails silently rather than
loudly** if it does not. So each is a test.

| Must hold | What happens if it doesn't |
|---|---|
| **Every slice shares ONE upload batch** | The readers keep the latest batch and discard the rest — a file arriving as twelve batches is read as **a twelfth of itself**, every figure quietly too low |
| **Replace-that-date runs on the FIRST slice only** | Slice two deletes slice one, and a replaced file keeps only its last slice |
| **The working list is rebuilt on the LAST slice only** | "The deck no longer names them" is true of eleven twelfths of the book |

The decision is one small pure function — `partPlan()` in `api/upload.js` — so it is testable
without a database, and the route only carries it out. Six checks in
`test/importers.test.mjs` pin it: one batch across twelve slices, exactly one slice allowed to
replace, exactly one allowed to rebuild, a single slice being both, a malformed id refused
rather than written into a uuid column, and a garbled count still finishing the upload rather
than stranding it with the working list never rebuilt.

**If it stops half way**, the slices already in share one batch with each other and the upload is
simply incomplete. Sending the file again writes a *new* batch, and the batch rule supersedes the
incomplete one whole — the same protection a re-upload has always had, now covering a case it was
never designed for. The page says where it stopped and how many rows went in, and that
re-uploading is safe, because "Failed" on its own leaves somebody wondering whether half the file
is in and whether sending it again would double it.

---

## Part 15 — Where things stand

### Done and live
The whole v1 → v2 port: all 23 portal tabs, the phone app, uploads, the officer boards, the
recycling rotation on the phone, storage cleanup, team codes, officer accounts, the logo
everywhere including the app icon, and the self-updating APK. Plus everything in Part 14:
instant tab switching, no blue screen after calls, deploys that reach the phones, data-dated
replace, a Settings tab that opens at once, the customer screen and the live widget — and in
Parts 14c–14g: the speed work, the master switch, the v1 comment import, the two agent boards,
and delete coverage for every report that grows.

### Silent defects found and fixed along the way
Vanishing defaulters after upload; an unwritten complaint log; restructures approvable by
anyone; hand-typed legal fines; missing uploads that failed silently; discarded call
breakdowns; roles that could not be edited; complaints stamped at midnight losing their
time-of-day; hidden dockets; a day-0 value treated as missing; loans appending instead of
updating and doubling the sales figure; a Replace that would have taken staff-typed records;
Leo showing yesterday's list; Leo and Kesho showing the same people; the four found by the
browser checks; a year of imported comment history all stamped with the moment of upload; a
cleanup that reported success and deleted nothing; and a follow-up register that only ever grew.

### FIRST THING TO DO AFTER THIS DEPLOY
**The system ships closed.** Sign in as admin → Settings → the first card → **Fungua mfumo /
Open the system**. Until you do, everybody except you sees HOPE Calls only. That is deliberate
— it is what you asked for — but nothing will tell you it happened except this line.

### Waiting on you
Migrations are run by hand in the Supabase SQL editor, and **none of them break anything by
being late** — the system falls back to the slower path until they are run.

| File | What it buys you |
|---|---|
| `2026-08-01-storage-counts.sql` | Settings opens instantly; closes a security warning |
| `2026-08-02-storage-counts-all-reports.sql` | Fast counting for the newer report types |
| `2026-08-03-followup-cleanup.sql` | Fast counting and cleanup of the follow-up list. **Run this one after `2026-08-02-storage-counts-all-reports.sql`** — both define the same counting function, and the last one to run wins. Filename order is correct order. |
| `2026-08-04-followup-deck-date.sql` | Retires defaulters no deck has confirmed for a fortnight (Part 14p). Without it they stay on the list for ever. |
| **`2026-08-05-snapshot-totals.sql`** | **The dashboard, the weekly report and the Presentation stop carrying 161,000 rows to add up a page of sums — the Presentation drops from 141 MB to 14.5 MB. This is the one behind the 504s and the memory bill (Part 16). Until it is run everything works exactly as before, slowly.** |
| `2026-08-05b-snapshot-totals-indexes.sql` | The indexes for the above. **Run it ONE LINE AT A TIME** — see Part 16. A refinement, not a requirement; the functions work without it. |
| `2026-07-27-hints-many-per-tab.sql` | Then upload `docs/hints-v2.tsv` as Hints |
| `2026-07-27-call-agents.sql` | Then re-upload Unassigned/Assigned so CREATED BY lands |
| `2026-07-28-loan-identity.sql` | One row per loan instead of one per stage |
| `2026-07-28-upload-stamp.sql` | Replace-one-day on the accumulating reports |
| `2026-07-28-speed-indexes.sql` | General speed |

Other things only you can do:

- **The app's signing key is committed to a public repository**, and its password sits beside it
  in `android/app/build.gradle`. Anyone who downloads both can build an app that Android will
  install as an *update* over HOPE Calls on any officer's phone. Three options, none free: make
  the repository private (stops it getting worse, does not undo it); rotate the key (the real
  fix — but every officer must uninstall and reinstall once, because Android will not update
  across a different signature); or decide the risk is acceptable, deliberately rather than by
  not knowing. **This is still undecided, and it is the most serious item on this page.**
- **Send the corrected `docs/V1-REVIEW-PACK.md`** to the people who know the old system and ask
  them to look again at **Leader Reports, Presentation and Teams & Staff**. Those three were
  called complete on a column list that was wrong (Part 14b).
- **Tell the field to close and reopen the app once**, so they pick up the new pages. After that
  it is automatic.
- Reactivate phone `0677115897` in Settings so that officer can sign in.
- Set `RESEND_API_KEY` in Vercel and `ADMIN_EMAIL` in Settings for the weekly Exp.Def email.
- Rotate the third-party credentials for `sync-book.net:8443` that appeared in an earlier chat.

### The Android home-screen widget — a straight answer

You expected to long-press the home screen, open **Widgets**, and find HOPE there. **You will
not, and no amount of testing will change that.**

`/live` is a web page. It has a manifest, so Chrome → menu → **Add to Home screen** gives you an
icon that opens full-screen with no browser chrome — but that is a *shortcut*, not a live tile.
Android's widget picker only ever lists widgets that are built into an installed app, in Java.

A real widget — arrears and recovery updating on the home screen without opening anything —
needs an `AppWidgetProvider` class added to `android/`, a layout, a manifest entry, an APK
rebuild, and every officer taking the update. Roughly a day's work plus a redistribution round.
It would read the same feed `/live` already uses, so the server side is done. **It has not been
built.** Say the word and it will be.

### Worth doing next
0. **Run `2026-08-05-snapshot-totals.sql`** (then `…-05b-…-indexes.sql`, a line at a time). It
   is the one on this page that changes what the system costs to run rather than what it does.
   Everything works without it, slowly.
1. **The whole loans table on every dashboard open** — the largest read left, and the reason the
   dashboard is not cheaper still. See the end of Part 16.
2. **The weekly report's sections** — the largest thing still outstanding from the comparison
   against the old system. See Part 14b.
3. **The native Android widget**, above.
4. ~~**The Presentation for somebody who sees every team** is still the heaviest screen at about
   fifteen seconds of network waiting on first open. Getting it lower means having the database
   add the figures up rather than sending rows to be added up here.~~ **Done — Part 16.** It was
   825,000 rows and 141 MB; it is now 89,000 rows and 14.5 MB.
5. Direct integration with the HOPE core system. It needs either a sample export of each report
   (headers plus ~20 rows), API documentation, or a read-only service account.

---

## How to check the system yourself

```
npm test                                    # 268 checks of the rules and the sums
node tools/settings-load-bench.mjs          # how much the Settings tab costs to open
node tools/load-bench.mjs                   # requests, rows and megabytes behind every screen
node tools/load-bench.mjs --before          # the same, as it was before the team-day totals

npm i --no-save playwright-core             # once, for the browser checks
node tools/browser-checks/portal-nav.mjs        # navigation, and the cleanup screen
node tools/browser-checks/call-warmstart.mjs    # no blue screen after a phone call
node tools/browser-checks/upload-mode.mjs       # Append / Replace on every report
node tools/browser-checks/customer-login.mjs    # the customer screen, and what it never shows
node tools/browser-checks/live-widget.mjs       # the wall display, including the network dying

node tools/make-review-pack.mjs             # regenerate the inventory for the v1 team
```

The browser checks are kept out of `npm test` on purpose: `npm test` guards the deploy, and it
must not depend on having a browser installed.

---

## Part 18 — The day 300 phones were told to use the app

> "Whenever we insist our field officers to use the app, postgres gets full red, i can't even
> upload report updates, we get delay errors and so on."

This is the most important entry in this document, because it is the one that decides whether
the system works when the whole company is on it rather than when six people are.

### What was actually happening

Nobody could point at a slow query, because there wasn't one. Every individual request looked
reasonable. The fault was only visible if you asked a different question: **what does the
SECOND handset cost, and the three hundredth?**

Measured against a 40-team book, one sync carrying one call cost **11 round trips and 4,002
rows** — every row of `followup_status`, every row of today's *and* tomorrow's repayment
snapshot, and the numbered comments. The whole company book, to answer one question: *whose
number is this?*

And nothing cached it. It was rebuilt from scratch on every sync.

Three hundred handsets sync every five minutes. Through a working day that is roughly **one
full-book scan per second, sustained, for eight hours** — from the same tables that have to
accept the day's upload. The uploads then queue behind the officers, which is the "I can't even
upload" half of the complaint. The database was not broken and it was not too small. It was
being asked to read its largest tables a thousand times an hour for an answer that had not
changed between any two of them.

### The fix was already in the code, two lines above

`DATA_VERSION` is stamped by the upload page the moment anything is uploaded, and the sync
already read it on every request to tell the phone its figures were stale. The index is now
remembered against exactly that, so **it can never outlive an upload**:

| | |
|---|---|
| first officer after an upload | pays the read, once |
| the other 299 | free |
| somebody uploads | `DATA_VERSION` moves, the next sync rebuilds |

**The cost, stated plainly.** A replacement number recorded in a comment is not in the index
until it rebuilds — at most five minutes, sooner if anything is uploaded. The call is still
logged, still named, still theirs; it can only be marked non-portfolio for those few minutes.
Against a database too busy to accept the day's upload, that is not a close call.

### The second one, which got worse as the day went on

"Amepigiwa leo" — the grey tick that stops two officers ringing the same customer within the
hour — read **every call log made anywhere in the company today**, on every list load. Small at
eight in the morning. At four in the afternoon, three hundred officers making fifty calls each
is fifteen thousand rows, dragged again for every list every handset opens.

That shape is the worst one a fault can have: **the system feels fine when it is tested and
fails when it is used.**

**And the obvious fix was wrong.** Dropping the cache whenever a sync writes a call looks
right, and destroys the entire saving — with three hundred officers syncing, something is
always writing, so the cache is invalidated faster than it can ever be used. Measured that way
`call_logs` still cost 1,513,700 rows: the exact number the cache was added to remove. A sync
now *merges* its own numbers into the warm set instead of throwing it away, so the officer's
own call is ticked the instant they look and the set stays warm for everybody else.

### Opening the app was ten waits in single file

`boot` took ten round trips **one after another**: the teams list, the device, `CALL_BRAND`,
`CALL_LOGO_URL`, the open/closed switch, today's calls, `CALL_SYNC_SECONDS`,
`CALL_LOGOUT_ENABLED`, **the teams table a second time** for the rotation check, and the
follow-up status list. Nine of those ten waits bought one small answer each, and none of them
depended on the one before it. On mobile data that is the difference between the app opening
and the app appearing to hang.

Five settings are now one query, the teams table is read once, and the rest are issued
together. **10 round trips → 5.**

### The numbers

Per request, 40-team book:

| | before | after |
|---|---|---|
| Opening the app | 10 trips, 81 rows | **5 trips, 41 rows** |
| Sync — first handset after an upload | 11 trips, 4,002 rows | 11 trips, 4,002 rows |
| Sync — every handset after that | 11 trips, 4,002 rows | **4 trips, 2 rows** |

300 handsets, one sync cycle plus 100 list loads, against one warm instance:

| | round trips | rows | per handset |
|---|---|---|---|
| before | 2,107 | 1,513,700 | 5,046 rows |
| **after** | **1,711** | **28,700** | **96 rows** |

**A 98% reduction in read volume.**

### Why the speed guard did not catch any of this

`test/speed.test.mjs` gives every screen a budget in round trips and rows — and it has been
doing its job. But it measures **one** request, and one request always looked reasonable. A
whole-book read that is *shared* and a whole-book read that is *repeated three hundred times*
are identical when you measure one of them.

There are now guards that measure **the second handset and the twelfth**, and that assert an
upload still forces a rebuild. That is the shape of test this class of fault requires, and it
is worth remembering the next time something is fast in testing and slow in the field.

### What to do if it ever happens again

See **[OPERATIONS.md](../OPERATIONS.md#when-something-breaks)**. The short version: **close the
system** (Settings). The officers keep working — HOPE Calls is never gated — and the office
load stops instantly, because a refused request costs two or three tiny queries and never runs
a dashboard. Then upload what you need to (admin is never gated), and re-open.

---

## Part 19 — Four smaller things, from the same week

### "Catherine at leo just the first customer is 6-10, at kesho 4-12"

6-10 is four instalments behind; 4-12 is eight. Neither belongs in front of a collection
officer, so the narrowing was not running for her — and the cause was one string.

The rule matched a role by **exact equality** against the literal word `COLLECTION`. No access
code in this system says that. A collection officer's role is **`PMO COLLECTION`** — `pmo.js`
names it, the staff roster resolves it through `isPmoRole`, and registration copies whatever
the access code says straight onto the handset. So her role read `PMO COLLECTION`, matched
nothing, and the code concluded "no special case" — which means the whole book.

The name fallback underneath could not save her either: it looks a person up in the **teams
table's** own columns, and a PMO collection officer is deliberately not there — one person
holds thirty-odd teams, so their teams live on their *access code*.

The collection role is now resolved the way the rest of the system resolves it: through the
`PMO_ROLE` setting, compared with `isPmoRole`, which forgives case and punctuation. **Rename
the role in Settings and this follows, with no deploy.** Credit and Expected now match on a
contained *word* rather than the exact spelling. No role that was untouched before is narrowed
now — `RECOVERY`, `GMO`, `MANAGER`, `BIKE`, `OPM`, `LEGAL`, `ADMIN`, `OFFICER` carry none of
those words, and that is asserted by a test rather than assumed.

### The Exp.Def role pills that lit up but changed nothing

On the phone's Muhtasari strip, pressing **Bike**, **GMO** or **Manager** set the value and
redrew — but the redraw painted the same rows, because the row list was only ever rebuilt on a
tab switch or a fetch. **The pill lit up, the summary moved, and the list underneath stayed
exactly as it was.** Pressing *Bike* showed the GMO's customers with the word *Bike*
highlighted.

The list now rebuilds, and the summary above it describes the list below it — otherwise you get
the GMO's money sitting over the bike officer's customers, the wrong number in bigger type.

### The week picker that looked dead

> "I tried pressing the date picker to 10th august ... but didn't work and the pressable day
> should be Monday only"

Two faults, neither visible.

**A future week was ignored in silence.** Picked on Sunday the 9th, the 10th is next week. The
code accepted only a Monday strictly *earlier* than the current one and otherwise returned the
current week with nothing to say so — the screen redrew with identical figures. A control that
overrules you without saying so is indistinguishable from a broken one.

The clamp itself is right and stays: a week that has not happened has no snapshots, so reading
it would paint a screen of zeroes that looks like a collapse rather than a calendar. **What was
missing was the saying so**, and the bar now prints which week is on screen and why.

**Any day could be picked**, and a Thursday was quietly snapped to its Monday — correct, and
invisible. The field now snaps *visibly*, and gained ◀ ▶ buttons that step a whole week.
(An HTML date box has no attribute that greys out non-Mondays; an instant, visible snap is the
honest version of "Mondays only".) All three screens — dashboard, weekly report, presentations
— now share one bar.

### Every leader on the weekly report

The weekly report answered *"how is each **team** doing"*. A director asks the other question,
and most supervisors carry several teams, so their real week is the roll-up across all of them.
That roll-up existed nowhere on the screen: the leader columns were carried on every row and
never added up.

There is now one board per role column — OPM, RECOVERY, GMO, MANAGER, CREDIT, EXPECTED, BIKE —
naming **all** of them, **including anyone whose teams produced nothing**. "This GMO sold
nothing this week" is precisely what a Monday meeting needs to see, and dropping them would
make the report quietly flattering. A team whose column is blank groups under *(hakuna / nobody
named)*, which is the prompt to go and fill it in.

Also on that report: **Recovered and Sales now carry a percentage**, like Expected and
Collected always did. Recovery is measured against the week's uncollected; Sales against the
company target the note under the bar already states. Both are divided from the figures shown
on the same bar rather than from the server's own percentages — the weekly answer carries two
sums of the same week (one adding up the days, one adding up the teams), and printing one's
percentage over the other's money would let the screen contradict itself.

---

## Part 20 — Opening the door, and the four faults that would have met it

> "i expect to - fungua mfumo, did that ... and its my most fear"

Opening the system means every officer in the company can reach every screen they are entitled
to, at the same time, on a Monday morning. That fear was correct, and this is what was behind
it. Four faults, all the same shape, none of them a slow query anybody could have pointed at.

**THE SHAPE, STATED ONCE: fetch everything, filter in JavaScript.**

It is invisible in ordinary testing, and the reason is worth understanding, because it is why
these survived for months. A fortieth of the book and the whole book are THE SAME NUMBER when
the test fixture contains one team. Every individual request looked reasonable. Only two
questions expose it — *what does the SECOND handset cost?* and *does an officer read the same
as an admin?* — and neither had ever been asked.

### The four

| | What it did | Now |
|---|---|---|
| **The phone index** | the whole company book, per sync, per handset — roughly one full scan a second, all day, from the tables that also have to accept uploads | cached against `DATA_VERSION`, so it can never outlive an upload |
| **The upload panel** | four whole tables with no date filter, to answer a question about one day, **on the page whose only job is to accept an upload** | one query, five rows |
| **"Amepigiwa leo"** | every call log made today, on every list load — and it got worse every hour as the officers worked | read once per half-minute; a sync merges its own calls in |
| **Five office screens** | an officer holding one team read all forty | narrowed in the query |

### The numbers, measured not estimated

Sync, 20 handsets against one warm instance: **80,040 rows → 4,040**.
Three hundred handsets, a full cycle plus a hundred list loads:
**1,513,700 rows → 28,700** — about **96 rows per handset**.
The upload panel, against a 312,600-row book: **the whole book → 5 rows**.
One officer, every screen, against a 288,000-row book: **all now under 1,200 rows**.

### What was learned, and what now guards it

The five unscoped office screens were found by laying the measurements out side by side and
noticing that **the officer's row count equalled the admin's**. A one-team officer reading
exactly what an all-teams admin reads can only mean one thing.

So that is now a test — and it is the better of the two guards, because it holds however small
the fixture is. A second test sweeps EVERY read-only function and bounds what one officer may
read, so a screen added next month is covered without anybody remembering to add it.

If either ever trips, the fix is essentially never a bigger number in the test. It is
`onTeams(q, user.teams)` in the query.

### And if it ever happens again

**Close the system.** Settings, one switch. The officers keep working, because HOPE Calls is
never gated, and the office load stops instantly — a refused request costs two or three tiny
queries and never runs a dashboard. Upload what you need to (the admin is never gated), then
re-open. See [OPERATIONS.md](../OPERATIONS.md#when-something-breaks).

---

## Part 21 — Imprest alerts: asked for at every opening, not only in the bell

> "Web browser visitation and app should all ask to allow notifications so that we sure to
> push imprest notifications"

The phone notification for an imprest (Part 14 onward: Web Push, `api/_lib/push.js`,
`public/push-sw.js`) had one switch, inside the bell. Most people never opened the bell, so
their phones were never subscribed and every imprest went to email alone.

**Now the portal asks on its own.** Every opening by a code that holds an imprest pane (Omba,
Idhini or Ripoti) draws a bar under the title — *Ruhusu arifa za imprest kwenye simu hii* —
until that phone is on (`pushAsk_` in `app.html`, run with the bell a breath after the first
screen):

| The phone is | What happens |
|---|---|
| permission given, but this browser not subscribed (new phone, cleared site data, rotated key) | subscribed quietly, no bar |
| never asked | the bar, with **Ruhusu / Allow**; the browser's own question comes from that tap |
| refused | the bar says where in the browser's site settings to allow it, with **Jaribu tena** |
| inside the HOPE Calls app | the bar hands the portal to Chrome on the same phone (**Fungua kwenye Chrome**), because an Android WebView has no push service at all |
| an iPhone not on the Home Screen | Safari's rule: add it to the Home Screen first |

**Baadaye / Later lasts one sitting.** It is kept in session storage, so the next opening asks
again — the same rule the app keeps for its own permission dialog. `?push=1` on the address,
which is how the Chrome hand-off arrives, asks at once.

**The app's side was already there.** `MainActivity.requestMissingPermissions` asks the OS
notification permission at every launch on Android 13 and later. That permission is for the
app's own tray (the standing "auto updating data" line); it does not give the WebView a push
service, which is why the hand-off to Chrome exists. No APK change, no version bump.

The bell's switch stays, and both it and the bar go through one enabling flow (`pushEnable_`),
so there is one place that asks the browser and one that files the subscription.

### The app's own channel

> "I thought we allow notification even from app too"

A WebView has no push service, so Web Push can never reach the HOPE Calls app. The app is
therefore a subscription of its own kind: when the portal runs inside it for a code holding an
imprest pane, the page registers the handset in the same register as a browser would, under
`apk:<device id>` (`pushApkRegister_` in `app.html`; the id is the one the device register
already knows). A send to such a row goes into a queue, `PUSH_Q_<CODE>` in `settings`, instead
of to a push service (`enqueue_` in `api/_lib/push.js`; a day deep, thirty items at most).

The app asks for that queue natively (`AlertPoller.java`, one POST to `/api/portal` with
`fn: 'pushPending'`, answered from one small settings row) and draws each item on the phone's
tray on a high-importance channel, a tap opening the request in the portal. How often is the
server's call: it answers with `interval`, two minutes for an approver's code, ten for a
requester's, zero for a code that hears nothing. `MainActivity` polls on that clock while the
app is on screen; `AlertJobService`, a persisted JobScheduler job, every fifteen minutes in the
background. Both are scheduled when a portal code signs in on the handset and cancelled when it
signs out, so a handset that is only ever HOPE Calls never polls. A poll is a read; the phone
remembers the newest `at` it drew (`alertSince`). APK 1.10.0 (versionCode 19) carries it.

**The role box on the request form** always carries the signed-in code's own role, first and
selected, whether or not the approver has priced it ("It must be of existing and of user logged
in"), followed by the approver's priced roles. Priced, the core's preview computes the nightly
rate from that option at draw time. Unpriced, the option says so, the hint under the box lets a
viewer who holds the Rates table (admin, approver) type the nightly rate and set it right there
(the approval pane's own `imprestRoleSave`; the form redraws priced), and the server accepts the requester's own
role for a trip without nights (`imprestRequest`): nights are still never priced at zero, and
any other unpriced role is still refused. The button says why it is closed before the tap, in
the server's words, as the figures change: no role, nights on a role with no rate, no costs on
the request ("I fill the days for Accommodation, jumla doesn't count and submit button doesn't
work" was a total of 0 under an unpriced role, explained only after the tap).

**Who hears the broadcast alerts** ("Imprest push notifications to roles I choose only. There
is a privacy concern"): the approval pane carries a card, *Arifa za simu za imprest: nani
anapokea*, with the two broadcast topics (a new request and a retirement, to the approval pane;
approved and awaiting payment, to the report pane). Each is open to every holder of its pane, as
before, or narrowed to the roles ticked. The list lives in `settings` under `IMPREST_PUSH_ROLES`
(`pushPolicy`, `pushPolicySave` in `api/_lib/push.js`, the save audited) and is honoured where a
phone subscribes, where the app polls, and at send time by the role each code holds at that
moment, so it applies to phones registered long ago. ADMIN is left out of a narrowed topic unless
ticked; an empty list silences the topic; a requester's own steps are never narrowed. A role left
out of every topic is not asked to allow alerts at opening, in a browser or in the app.

---

## Part 22 — The Fraud Detector

> "For what we've gone through, brother I need a new nav 'Fraud Detector' where every approved
> loan with a number or name among customer, guarantor or receiver that still exists in an
> another approved of the three columns or in the current defaults sheet, auto list the case
> list that will open card details containing previous involved loan details vs current.
> Autosorted newest to oldest"

What Vwawa and Tunduma looked like in the book was never visible loan by loan: one receiver
number collecting several customers' disbursements, a guarantor who was somebody else's
customer, a customer approved again while their earlier loan sat in default. The Fraud
Detector (`public/mod/fraud.js`, the nav under Legal) lays the parties of every approved loan
side by side and lists the ones that touch.

**The rule, in one place** (`detect` in `api/_lib/fraud.js`): the parties of a loan are its
customer (name, contact, momo), its receiver (name, momo) and its guarantor (name, contact). A
number is compared as `normPhone` writes it, the last nine digits; a name as its letters,
uppercased, and only when it has two words and six letters, because a lone JOHN matches half
the book. A **case** is an approved loan (the sales stages) with at least one **link**: a party
of *another customer's* approved loan, any of the three columns against any of the three (the
customer's own earlier loans are not a link; a repeat customer is the ordinary business); or a
row of the **current defaults sheet** (the latest current deck, every weekday) that is not the
loan's own row: another customer's name or number, or the customer's own earlier loan still
owing when this one was approved. A link by number is strong, by name alone weak; both are
kept, labelled. Cases are sorted newest first by approved date.

**The screen**: the counters, then the controls ("have the sorts on top by team by type etc"):
team, the officer who prepared the loan, strength, the kind of link (another loan, the defaults
sheet, the customer's own earlier loan) and the order (newest, oldest, team, officer, largest,
most links). Every pick is a repaint of the cases already on the page, not a second read, and
the counters follow it with "x / N". Then the list (approved date, REF, customer, team, created
by, receiver, guarantor, principal, the first two links in words, strength), a tap opening the
card: this loan's parties beside each linked loan's and each defaults row's, the matching
fields marked, the own-earlier-loan case badged. Links are capped at thirty per case and the
rest counted. Every loan the card shows, the case and each loan it is linked to, carries its
*own* row of the current defaults sheet as `def` (arrears, DC, status, balance; null when it is
not on the sheet), so the card's **Default** row lays the two defaulted amounts side by side
("add default so we see defaulted amount of each of the two in case in defaulters"); a case
that is itself on the sheet is badged at the top of its card. The own row is never a link; it
is the loan's present state.

**The look-up before approval** ("the search in here will help credit analysts to search a
number among the list before approval - but return active customer even if not in the list -
for search character only"): a box in the control bar asks the whole book, not the cases
(`fraudFind`): the typed characters against every approved loan's six party fields and the
defaults sheet's four. Digits find a number containing them, a local 0712… or a 255712… read
as the same nine digits; letters find a name containing them; three characters at least. The
answer opens in the drawer, led by the **latest appearance** in the approved loans ("search
return latest appearance of the searched no in previous approved info - whether holding
previous fraud already or not"): the newest loan the characters sit on, said whole, badged
"already holds a case" with a link to the card, or "no case yet". Then every loan, newest
first, each with the fields it was found in, its stage and a KESI chip when it is on the case
list (a tap opens the card); then the sheet rows with status, DC, arrears and balance; or a
green "not in the book". The same book as the case list, so a number that is clean here is
clean in the detector too.

**Reads**: two, both team-scoped at the database (a scoped code compares its own teams' loans
against its own teams' loans and defaults, and the screen says so), kept a minute per scope by
the answer cache and shared by the list and the look-up. Nothing on `/api/upload` or
`/api/call`. Granted like `audit`: admins from the start, a role when ticked under Roles &
access.

## Part 23 — Imprest: funded before retired

> "Am having a hard time to check in on the accountant (she ain't filling the funded amounts
> on imprests), so someone shouldn't be able to make retirement unless the imprest was funded
> — hit them with 'you have 3 unfunded imprests, check the account to record them funded
> before you make the retirement!'"

The accountant's one write (`imprestFund`: `funded_amount`, from the Ripoti tab) was nobody's
problem but hers, so it went unwritten. The retirement is the one step every traveller must
take — the next request waits on it (`imprestRequest`'s one-imprest-at-a-time gate) — so it is
now the door that a missing funded amount closes, in front of the person who can walk over to
Accounts.

**The rule, in one place** (`unfundedOf_` / `isUnfunded_`, `api/_lib/imprest.js`): an
approved request, not yet retired, whose `funded_amount` is still null. The same null the
report's *Bado kulipwa / Not funded* counts and the drawer's *bado / not yet* shows. **0 is a
recorded figure** and opens the door. A retirement filed before this rule on money never
recorded is not counted: nothing of theirs waits on it.

| Where | What it does |
|---|---|
| `imprestRetire` | refuses, ahead of the form, with the requester's whole debt: *Una imprest 2 zilizoidhinishwa ambazo hazijarekodiwa kuwa zimelipwa (date place · TZS …; …). Wasiliana na uhasibu zirekodiwe kuwa zimelipwa, kisha jaza retirement. / You have 2 unfunded imprests: check with Accounts to record them as funded before you file the retirement.* The list is read only on the way to a refusal; a retirement that goes through costs no read it did not cost before, and one whose money was recorded between the page and the tap goes through. |
| `imprestMine` | returns `unfunded` (ids) and `unfundedNote` (that sentence) beside `unretired` / `unretiredNote`, from the rows it already holds. |
| Omba imprest (`public/mod/imprest.js`) | a red *Retirement imefungwa / Retirement is closed* note up front with the sentence; the row's drawer draws the note where the *Jaza retirement* button would be. When every unretired imprest is also unfunded, the "new requests are closed" note no longer says "tap → Retire" but "closed until Accounts records the funding". |

Nothing on `/api/upload` or `/api/call`; no migration; the Ripoti tab is unchanged — it is
where the door is opened.

## Part 24 — A docket is the customer's, not the loan's

Found while writing the 2024–2026 sales history in by SQL (35,672 disbursed loans, one row
per LOAN ID): **5,705 dockets carry more than one loan.** The LOAN ID is the docket's digits
with the track number on the end — docket `5-221-81653` is loans `5221816532` and
`5221816534` — so a repeat borrower's second, third and fourth loans all share the one docket.

`reconcileLoanIds` (`api/upload.js`) matched an incoming loan to an existing row by LOAN ID
*or by docket*, took the first match as the keeper, and the upsert then wrote the incoming
loan onto that row. For a repeat borrower whose previous loan was already in the table, the
approvals file carrying their new loan found the old one by its docket and **wrote the new
loan over it**: the earlier sale gone from its week, from the audit's cohorts, from the fraud
look-up — with "1 relinked" in the receipt, which read as success. The daily approvals export
carries `DOCKET #`, so this ran on every upload.

**The rule now**: the docket identifies a loan only on rows that have **no LOAN ID yet** (an
application filed before approval — the case the reconciliation exists for), and only on the
**same track** (a blank track on either side still matches, as before). A row that already
carries a LOAN ID is matched on that LOAN ID alone. Two tests pin it: a fourth loan arriving
over the customer's second is a new loan, nothing relinked, nothing deleted; a docket-keyed
application is taken only by the approval of its own track.

No reads added to `/api/upload`; the same three look-ups, read differently.

**The history itself** went in through the SQL editor (`SALES-HISTORY-2024-04-to-2026-07-part-NN-of-14.sql`,
in the session's scratchpad, not in the repo): the same identity (`md5(LOAN ID)`), the same
columns `importLoans` maps, the same team filing and stub-creation the upload does, the same
`upload_date` / `upload_batch` stamp; existing rows updated in place by the digits of their
LOAN ID, docket-keyed application rows relinked on docket + track, everything else inserted.
Two things the Supabase editor does that a file for it has to respect: it **cuts a query at
1,000,000 characters** (the first cut, 1.32 MB a part, died at character 999,999 with
"unterminated quoted string"), and it **appends `ALTER TABLE … ENABLE ROW LEVEL SECURITY`**
after anything that creates a table — `create temp table` and `select … into temp` alike,
the latter mis-read as a table called `temp`, which rolled the whole script back. Hence
parts under 900,000 characters, and each part **one statement** of data-modifying CTEs
(teams created and loans referencing them in the same statement; the foreign key is checked
at the statement's end and sees them), whose result row is the receipt.

**What the history showed at its join** (CHECK-1 / CHECK-2, read-only, in the scratchpad):
the table is continuous from 17 April 2024 to 1 July 2026 (the export's end), empty from
2 July to 1 August 2026, and continuous again from 3 August 2026 on the daily Approved uploads
(stage `approved`, no disbursement date). Tuesday 25 August 2026 holds nothing; 24 September
reads low. April 2026 is about 1,600 loans short (the 30,000-row export cap). Two more exports
close it: 1 April–31 July 2026 and 1 August–30 October 2026, each under the cap; the second
also stamps the disbursement date onto the rows the daily uploads filed, which is what the
Audit report's "PAR > 30 for loans disbursed in the month" reads.

## Part 25 — All-time PAR on the Portfolio at Risk tab

> "the todays defaulter is already the alltime defaulter so comparing it to total loan
> (principle+interest) by all team and grand total is alltime par per team and company"
> "i said P+I since we use total loan in getting par not principle, so if there is a total
> loan column, we live with it"

The deck's PAR (arrears over the defaulters' own balance) says how bad the defaults are, not
how much of what a team was ever lent is overdue. Today's deck is every defaulter there is,
whenever they borrowed; with the sales history in the loans table (Part 24) the other
denominator exists: the **total loan (P+I, the `loan_amt` column) of every sale the team ever
made**. Arrears over that is the team's **all-time PAR**; the grand total is the company's.

**One rule for "a sale"**: a row at any `SALES_STAGES` stage (`approved` onward), the same
list the dashboard's sales figure uses, handed to the database so it is not spelled twice.

| Where | What |
|---|---|
| `db/RUN-ME-047-loan-totals-by-team.sql` | `loan_totals_by_team(p_teams, p_stages)`: one row per team — loans, total loan, first day — team-scoped at the database (upper-cased, trimmed, like `loan_stage_counts`). Optional: without it the tab reads every sale's team and amount and adds them here, and says so on the screen. |
| `loanTotalsByTeam` (`api/_lib/portal-core.js`) | the RPC, else the fallback; kept a minute per scope by the answer cache. |
| `par` | each team row carries `loans`, `totalLoan`, `parAll`; a team lent to with nobody in default today is listed at 0% (the best row, not a missing one); `totals.parAll` is the company's; `allTime` says how much was lent, since when, and whether the database summed it. |
| PAR tab (`public/mod/reports.js`) | a *PAR all-time* card, three Orodha columns (Loans all-time, Total loan all-time (P+I), PAR all-time %), the foot line, and the note while RUN-ME-047 is not pasted. `BUILD 2026-10-30-a`. |

Budget: `par` 5 → 6 trips in `test/speed.test.mjs`, reason in the diff. Nothing on
`/api/upload` or `/api/call`. The whole-book figure the Audit report was waiting for (task 7)
is this same denominator; the Audit panel still reads cohorts and the month-end deck as before.

---

## Part 26 — The week's legal report, and the credit analysts' target per team held

> "At Legal recovery — this week … Add a button [Report] before the 3 Excel JPG CSV which
> exports the whole week report with Legal, Team, Customer etc columns so that we could export
> the whole report that generated that summary from officer boards at dashboard."

The week board is sums per lawyer. **[Report]** on that board downloads the rows the sums are
made of: one row per noticed customer in scope under the lawyer whose code holds the team
(or "(unassigned)"), with team, customer, REF#, contact, Kumb.Na., notice date, owed at
notice, paid today, paid this week, Rec %, number of payments, first and last payment, and
the payments day by day. Filter the Excel on *Legal officer* and the column totals are the
board's row.

| Where | What |
|---|---|
| `legalLines_` (`api/_lib/portal-core.js`) | the one listing both the board and the report are built from: `legalBoard_` sums it per lawyer (`slot` keeps two lawyers of one name apart). One rule, so the two cannot disagree. |
| `legalWeekReport` | the rows for the chosen week (`weekOf`, like the boards), team-scoped at the database and by `scoped()`; `on: false` with the RUN-ME-041 note when the ledger is not there (the register still lists, payments at 0). Permission: `dashboard` only. Read on the tap, never with the dashboard. |
| `board(…, opts)` (`public/app.html`) | `opts.buttons` draws a board's own button(s) before Excel / JPG / CSV; `legalWeekReport_` fetches and writes the rows through the same `.xls` writer every board uses (`exportBoard`). `BUILD 2026-10-31-a`. |

> "Credit analysts — this week · sales% · recovery% · performance at sales - they are judged by
> no of teams they have so if its 25,000,000 week target and has 5 teams then its 125m for the
> generated sales% performance"

The dashboard's credit boards measured every analyst against ONE team's weekly target. Now
an analyst's target is **the weekly target × the teams Teams & Staff lists under them on the
credit column** (within the viewer's scope); today's board takes a seventh of it. Teams naming
no analyst count under "(unassigned)"; an analyst the approvals file names who is on no team's
credit column is measured against one team's target. Both boards and the deck's credit slide
now carry *Teams* and *Target* so the percentage can be checked by eye. The Credit tab's own
per-analyst sales % (`credit`) already multiplied by the analyst's teams; it counts the teams
whose count 1–6 book the analyst carries, which is the same set whenever every held team has
defaulters.

## Part 27 — The Daily Checklist: a leader's day, task by task, stamped by the server

> "MONDAY | ACTIVITY | CHECKBOX CutOff 00:00 HRS | CAMERA (icon) & View Button — Thats how
> implementation of the window they work on should be for leaders at a tab 'Daily Checklist'
> … I should be able to manage tasks per role at my bonasi tab"

Two screens, one rule.

**The window — `Daily Checklist / Orodha ya Kazi za Siku`** (HOPE Management, grantable like
`audit`: admins hold it, a role gets it when ticked under Roles & access). The weekday is the
heading. One row per task the GM set for the person's **role** on that weekday: the activity;
a **checkbox** with its cut-off beside it (`CutOff 07:30 HRS`, or *all day* when the cut-off is
00:00); a **camera** that opens the phone's camera inside the app, and a **» View** that opens
the photo. The day's date box looks back: an earlier day is read, never worked. Four counters
on top (tasks, ticked, late, photos). Somebody holding the Daily Bonus Plan tab (the GM) also
sees **Everybody's day**: one line per person — ticked, not ticked, late, photos, last tick.

**The editor** — at the top of `Bonasi ya Kila Siku / Daily Bonus Plan`. Pick a role (the roles
the system knows), pick a weekday, list the activities with their cut-offs, *Save this role's
week*. The whole week of that role is saved together. A task keeps its id when its wording is
corrected, so ticks already made against it still point at it.

**The stamps are the server's.** A tick is recorded with the server's clock on the EAT day; a
tick after the cut-off is kept and marked **late**; a photo gets its own server stamp. The
phone never writes a time of its own (a page test pins this). A photo is shrunk on the phone
to the same 200KB ceiling as an imprest receipt, kept as the image itself, never carried with a
list, and opened one at a time by its owner or by the GM. An untick removes the claim and keeps
the photo. Nothing can be ticked for yesterday.

| Where | What |
|---|---|
| `api/_lib/checklist.js` | `checklistPlan` / `checklistPlanSave` (the plan, permission `bonusplan`); `checklist` (the day, permission `checklist`; the board only for a `bonusplan` holder); `checklistTick`, `checklistPhoto` (today only, own row, server-stamped); `checklistPhotoGet` (own, or the GM's). The three writes are audited. |
| setting `DAILY_CHECKLIST` | the plan: `{ roles: { GMO: { MON: [{ id, activity, cutoff }], … } } }`. A setting, so no migration; a hand-typed value that is not JSON leaves the tab working with no tasks. |
| `db/RUN-ME-048-daily-checklist.sql` | `checklist_entries`: one row per person, day and task — `ticked_at`, `late`, `photo` (data URL), `photo_at`; unique on (code, day, item_id). **Until it is run** the tab opens, shows the tasks, says so, and refuses ticks and photos naming this file. |
| `public/mod/checklist.js` | the window (`VIEWS.checklist`) and the editor card (`ckPlanLoad_`, drawn by `VIEWS.bonusplan`). `BUILD 2026-11-02-b`. |
| `test/speed.test.mjs` | the day costs a leader 3 trips (the plan, their entries, and the teams-scope read); the GM one more for the board. |

**What the GM does first:** run RUN-ME-048; on the Daily Bonus Plan tab set each role's week;
on Roles & access tick *checklist* for the roles that work it (GMO, Manager, OPM …).

## Part 28 — The card behind a leader's name on the Exp.Def Report

> "At expected defaulter report .. as per an individual - tapping a name of gmo, manager or
> bike should open card to show how many portfolio calls they made among the expected
> defaulters and added comments and recovery earned."

The report says what each leader's book is worth and what came back. Tapping the leader's
name on any of the three boards (GMO, MANAGER, BIKE) now opens a card that says what they
**did** about it in the week the report is showing:

- **Customers** — the rows of the rotation under that name and role, read exactly as the
  report reads them (weekly, as of the chosen week's Friday).
- **Portfolio calls** — the leader's own calls from HOPE Calls, portfolio only, matched to
  those customers by the REF the sync stamped or by the number dialled (the customer's or the
  guarantor's). Counted the way the Calls report counts: one number per day is one call, with
  the dials beside it, the customers reached, and the talk time. A call to somebody else's
  customer does not count here.
- **Comments** — the follow-up comments written under that name in the week on those
  customers, with the newest status and comment on each row and the latest ten listed.
- **Recovered** — the week's recovery on that book, with Rec % and how many customers paid.

One row per customer under it (calls, dials, last call, comments, last status and comment,
initial, arrears now, recovered), sortable like any board. The card says when nobody is
registered in HOPE Calls under that name (calls then read 0) and when the Monday deck is
missing (recovery then reads 0). An "(unassigned)" row opens nothing.

| Where | What |
|---|---|
| `expdfLeader` (`api/_lib/expdf.js`) | the card's one read: the same deck reads as the report, then the leader's HOPE Calls ids by name, their week's portfolio calls, their week's comments — keyed reads, on the tap only, never with the report. Permission: `expdfrep`. The portal wrapper `expdfLeaderWeek` applies the same week rule (`asOfWeek`) as the report. |
| `xdLeader_` (`public/app.html`) | the drawer; the leader column on the three boards is a `kind:'tap'` cell (a new cell kind in `cellHtml`: a name that opens a card, exports as text). Its values ride as `data-tap-<key>`, never bare `data-<key>`: `wireForms()` wires every `[data-role]` element to the role editor after each paint, and the first build's `data-role="MANAGER"` had its tap silently replaced — blue and dead. `BUILD 2026-11-02-d`. |
| `test/speed.test.mjs` | the card's budget stated beside the report's. |

## Part 29 — The tip and the toast close on a tap or a swipe

> "System SW/EN popups can be swiped away please! because they hinder operation, one has to
> wait until it disappears."

The tip (Vidokezo / Tips, shown in the chosen language every few minutes and on the bulb
button) sat over the bottom-right corner for its hold time (Settings → hints: `holdSec`) and
ignored the pointer (`pointer-events:none`), so a leader working that corner waited it out.
Now a shown tip takes the pointer: a tap closes it, and so does a swipe of 24px in any
direction; `touch-action:none` on it keeps the flick from scrolling the page underneath. The
toast (the three-second "saved" / error strip) closes the same way. Hidden, the tip still lets
the pointer through. One wiring, `flickAway` beside the `#tipBtn` handler in `public/app.html`;
the tip's own timer is cleared on a manual close so a stale timer cannot cut the next tip
short. The call app has no tips; its toast is unchanged.

## Part 30 — The Exp.Def Report: calls, talk and comments on every row, and a By OPM board

> "At Exp.Def Report: Have sort headers of By OPM, Add columns of No of calls + duration
> (calls among the assigned expected customer, guarantor & ana namba nyingine in them), and
> no of comments : Between customers and initial columns"

The report's boards now say what each leader **did** in the week beside what their book is
worth: between *Customers* and *Initial* sit **Calls**, **Talk** and **Comments**. Every board
is drawn by `board()`, so its headers sort. (A fourth board, *Kwa OPM / By OPM*, holding the
whole assigned book of each OPM's teams, was built and then dropped at the GM's word — "Drop
- Kwa OPM / By OPM"; the OPM stands as the first column of each role board instead.)

**One rule, in one place.** `weekWork` in `api/_lib/expdf.js` is the single definition of the
week's work on a book, read by the report's columns and by the card behind a name, so the
two can never disagree. A *call* is one number per day (the Calls report's rule), portfolio
only, made from the HOPE Calls account(s) registered under the leader's name, to one of the
book's customers: by the REF the sync stamped, or by the number dialled — the customer's, the
guarantor's, or a replacement number recorded under ANA NAMBA NYINGINE
(`followup_comments.new_number`). A *comment* is one written under the leader's name in the
week on one of those customers. A call to somebody else's customer counts nowhere.

**Four reads for the whole report, whatever its size:** the HOPE Calls roster (two columns —
the teams table says `BOSS`, the roster `Boss`, and `.in()` is exact-case, so the match is
made here), the leaders' portfolio calls of the week (`.in(user_id)` over the matched
accounts), the replacement numbers (only when there are calls to match), and the leaders'
comments of the week (`.or(created_by.ilike…)` over every spelling the teams table and the
roster carry; a name that would break the or-grammar is matched exactly). Never one read per
leader. A name not registered in HOPE Calls reads 0 in grey (`inCalls:false`). The weekly
email is unchanged.

**And an OPM column on the three role boards** ("Add an OPM column on the three role boards
too: all columns sortable as usual"; then "all the three tables should start with opm name
column before gmo/manager/bike"): the FIRST column of each board, the OPM of the teams that
leader holds — more than one, comma-separated; none, `(unassigned)` in red. Text, so it sorts
like any header. The leader's name, which opens the card, comes second.

**The (x) on every drawer** ("The expdef user card has close down but should also have (x) on
top right for close"): `drawer()` in `public/app.html` now opens with a zero-height sticky bar
holding a round × that stays at the top-right however far the card is scrolled; the bottom
*Funga / Close* stays for the thumb. Every drawer gets it, since all of them go through
`drawer()`. A card whose table is registered in `BOARDS` passes `xls: '<id>'` and gets an
**Excel** button before the × ("add excel button before it"), exporting through `exportBoard`
like any board; the leader card registers its customers as `BOARDS.xd_leader`.

**A tappable name keeps the row's colour** ("All the names became blue yet underperforming
rows should turn red"): the leader column is a name column under the colour rule
(`NAME_KEYS` / `cellCls_`), so a leader below the board's Rec % line gets a `bad` cell — but
the name inside is an `a.tel` link, whose blue beat the cell's red. `td.bad a.tel` and
`td.good a.tel` in `public/app.html` let the verdict win on every board with a tap column.

| Where | What |
|---|---|
| `weekWork`, `expdfReport`, `expdfLeader` (`api/_lib/expdf.js`) | the rule, the three boards, the rows' `opm` / `calls` / `dials` / `talk` / `comments` / `inCalls`, section totals; `expdfCore` rows carry `opm`. |
| `VIEWS.expdfrep` (`public/app.html`) | the OPM column, the three work columns with their headers' tooltips, the note under the boards. |
| `test/speed.test.mjs` | the report's ceiling raised to the four-read shape, with the reason. |

## Part 31 — The Exp.Def Report by the day, the week or the month

> "Exp.Def Report should be daily . . put a weekly and monly on buttons infront of callender
> date picker there"

The report opens on **today**. Three pills in front of the date picker — *Leo / Daily*,
*Wiki / Weekly*, *Mwezi / Monthly* — choose the period; the arrows step by a day, a week or a
month; the chip says which day, week or month is on screen and whether it is past, current or
upcoming; *Rudi leo / Back to today* returns. The date picker shows what is read (a week's
Monday, a month's first).

**One resolver, `expdfPeriod` in `api/_lib/expdf.js`**, for the report and the card behind a
name, so a row and its card never read different periods. A past period is read as it stood
at its close (a past day on that day, a past week on its Friday, a past month on its last
day); the current one as of now; a future one at its close too. `weekly: true` without a
period still means a week, for the weekly e-mail and older callers.

| Period | The book | The baseline recovery is measured from | Calls and comments |
|---|---|---|---|
| day | the rotation's own list for that day (the customers whose cycle day it is; the whole assigned book where the deck carries no disbursement dates, as on the phone) | the day's own initial deck | that day |
| week | **each filed day's own rotation list, added** (see "The week is the sum of its days" below) | each day's own initial deck, against that day's own current deck | Monday to Sunday |
| month | the whole assigned book | the month's **first** initial deck (`monthFirstInitial_`: one ascending date query, then that deck; the day's where the month has none) | the 1st to the last day, or to today in the live month |

`expdfCore` reads only the baseline its period needs — Monday's deck for a week, the first
deck for a month, nothing extra for a day — so the day costs one read less than the old
weekly screen; the speed table carries a row for each period. The three recovered cards and
the KPI subtitles name the period; the leader card asks for the same `period` and `weekOf`
as the report on screen.

**Who is who** ("Hakuna afisa wa HOPE Calls aliyesajiliwa kwa jina SULEIMAN MPOKI MWASUNGA"
— he was, under another spelling; "Always match anyone who signed in with that code"). A
leader registers in HOPE Calls with their portal access code and the account takes the
code's name, so `weekWork` reads the access codes (names) beside the roster (`user_id, name,
phone`) and owns an account when it carries the leader's number from Teams & Staff
(`gmo_no` / `manager_no` / `bike_no`, now on every `expdfCore` row as `leaderPhone`), the
name of one of the leader's codes, or a spelling of the leader's name — `sameName`: a shorter
spelling whose words all appear in the longer one, in any order, two words at least; a lone
first name matches nobody. Comments are read under every spelling found (the code's
included, which is how portal comments are signed). The card's note now says the match is
by the role's number on Teams & Staff or by name, and what to do.

**The week is the sum of its days** ("the weekly expected def report ain't summing right by officer for what they added up during the
days in the week"; BUILD 2026-11-09-b). The week used to be Monday's initial deck against the latest current deck, per customer,
every customer handed whole to whoever the rotation holds him with *today*. The rotation moves a defaulter on every two days of his
arrears, so a customer the bike officer worked on Monday and the manager on Wednesday was credited, all week, to the manager; one who
paid and fell due again showed nothing; one newly flagged on Thursday was blamed on a baseline that never carried him. An officer adding
up their own daily reports could not reach the weekly figure, and was right. It also broke the rule the dashboard already states
(`sumRangeStand_` in `portal-core.js`: "a week total is just a sum from the sums of each day ... never a single boundary pair
(Monday's deck less Friday's)").

`expdfWeekCore` (`api/_lib/expdf.js`) now builds the week as the DAILY report's own list for each day, added officer by officer:
for each day Monday to today (a past or upcoming week to its Friday), the day's initial deck against the day's current deck, the
customers whose cycle day it is, handed to the leader the rotation names *that day* -- one row rule (`buildRows_`) for the day and
for the week, so they cannot drift apart. A day counts only when **both** its decks were filed **on that date** (`onDate`: an older deck
sharing the weekday never stands in); an unfiled day adds nothing and the answer lists it (`days: [{date, weekday, measured, why}]`),
and the screen says "Days added / Not filed" under the cards. Initial is the days' initials added, so Rec % is what came back on what
was on their lists; a customer held by two leaders in the week is a row in each book, so every column adds up to the grand total, and
`customers` counts distinct customers. The leader's card is the same book (its recovered column adds up to the row it was opened from).

**Cost.** Two deck reads per filed day (ten for five days, where the old week read three): the initial deck read for two columns, the
current one for the fifteen it uses, sequential, and the whole week kept for a minute per set of teams (`cachedAnswer`), so the report
pays once and every leader's card opened from it reads no deck. Portal only; nothing on `/api/upload` or `/api/call`. Measured on the
speed fixture (every day filed): 12 trips, 5,040 rows, then 0 more deck reads on the next open (`test/speed.test.mjs`). **The month keeps
its first-deck baseline** -- a month of decks is not a request's worth of reads; if the month should be its weeks added, it needs the
month ledger the dashboard keeps, so say so. `expdfCore`'s own `weekly` option (Monday's deck) stays only for callers that still ask for it.

**Recovery by day, in the weekly tab** ("Find how to show recovery by day in the weekly tab. We need proof"; BUILD 2026-11-09-c). The
week is the sum of its days, so the tab now shows the days. On the three boards (GMO / MANAGER / BIKE) and on a leader's card, one column per
day of the week sits just before **Recovered** (`Mon 20 ... Fri 24`): that day's recovery by the *daily* report's own figure for that officer
(`byDay` on the officer row, built from the day rows `expdfWeekCompute_` already holds -- no extra read, nothing on `/api/upload` or
`/api/call`). A board's total row carries the day sums, and a day nobody filed reads blank (header tooltip says so) and adds nothing.
Under the cards a line reads "Marejesho kwa siku / Recovered by day: MON 0 + TUE 300 + ... = 1,400" with a green chip *sawa na wiki / equals
the week* -- or a red *tofauti na wiki / differs from the week* if the days ever stop adding to the figure (they cannot today; the line is
the proof an officer can hold their own daily numbers against). The columns are custom `get` columns, so sort, totals, Excel, CSV and JPG
use the same values. The total row hands the same getter `byDay` (`xdDayTotals_`); a first cut keyed the total row `d_<date>` and every
total cell read 0 -- `test/pages.test.mjs` now pins it. Server side `test/portal.test.mjs` asserts `byDay` equals the daily reports cell
by cell. Day and month views carry no `byDay` and no day columns; phone figures are unchanged.

**Day tabs inside the weekly officer card** ("For the weekly tab only, so that they can refer what was achieved each day by officer -- maybe
after opening officer card have day tabs within, as the expected days tabs"; BUILD 2026-11-09-d). Open an officer's name on the weekly
report and the card has pills under its heading: **Wiki / Week | Mon 20 | Tue 21 | ...** (each day's recovery in brackets). The Week
tab is the card as before; a day tab is the *daily card* for that day -- the customers on the officer's list that day (the rotation's own
list), that day's initial deck against that day's current one (Initial, Arrears, Recovered, Status), and that day's calls and comments
on those customers, with the comments of the day listed. Day and month cards have no tabs; a day nobody filed has its tab, greyed and
empty, saying why. `expdfLeader` (week only) returns `dayTabs: [{date, weekday, measured, rows, totals, recent}]`; the week's day cells
now also keep the day's own `arrears` and `status`, and `weekWork(..., {perDay: true})` buckets the SAME call and comment rows the week
already read by day -- **no extra read, nothing on `/api/upload` or `/api/call`, and the report does not ask for per-day work.** One rule
for what belongs to a day: a call or comment counts on a day only for a customer on the officer's list that day (matched by ref or number
exactly as the week matches), and a comment's day is its EAT day. So a tab equals the daily card for that day
(`test/portal.test.mjs` compares them tab by tab); work done on a customer on another day is in the Week figures, not on that day's tab,
and the tab says so. Switching tabs is client-side: the card's body swaps and the Excel button exports whichever tab is open (`XD_CARD_`).

**Stepping the weekly card a week back or forward** ("We can swap the forward and backward weeks in the cards"; BUILD 2026-11-09-e). The weekly
officer card has **◀ week ▶** arrows beside the week it shows, a chip saying whether it is this week, a past one ("as it stood" its Friday) or an upcoming
one, and *Rudi wiki hii / Back to this week* when it is not the current one. A step is the same single `expdfLeader` read as opening the card, asked
for the week by its Monday, so each week is the card for that week with its own day tabs; the weekday tab you were on is kept (Tuesday this week
-> Tuesday last week) where that week has it. The report behind the card stays on its own week. A newer tap wins over a slower older answer
(`XD_SEQ_`). Day and month cards have no arrows. An unfiled Sunday gets no day column or tab (the rotation rolls Sunday into Monday; a Sunday
that WAS filed still shows). Nothing here touches `/api/upload` or `/api/call`; no migration.

**The "Tuma wiki kwa admin / Email weekly report" button is gone** from the report's bar ("Remove the tuma weekly
report kwa admin button at expected defaulters"; BUILD 2026-11-09-a): the bar is the three pills, the date and the arrows.
The server action `emailWeeklyExpdf` (admin only, uses `RESEND_API_KEY`, `ADMIN_EMAIL`, `EMAIL_FROM`) is left in place and
tested; nothing in the app calls it now, and `api/_lib/mail.js` still shares its provider settings. `test/pages.test.mjs` fails
if the button or its handler comes back.

## Part 32 — PAR: the OPM where the Branch was

> "In orodha/list at par, drop branch column replace with opm name"

The PAR tab's Orodha / List (one row per team) opens with the team's **OPM** from Teams &
Staff, `(unassigned)` where none is named, then the team and the figures as before. The
server's `par` reads the teams table once for both the OPM and the branch; the branch stays
on the row (and so in the Excel/CSV export) but is no longer a column on the screen.

## Part 33 — The Annual Report: the GM's workbook, read off the system

> "we also build a new tab 'Annual' — this will always update the annual statistics, GM wants
> to always have the report autoupdating … The task is to stamp monthly collection and
> recovery data jan 2025 – july 2026. Customer retention comes from sales which we already
> have … in the tab I could go months, years, report types, export excels, jpgs etc."

The annual report used to be a workbook kept by hand: a sheet per month, a sheet per summary
(ANNUAL, SALES, COLN, REC, COUNT, one per GMO), and a deck built from it in January. The
**Annual Rep** tab (`public/mod/annual.js`, `api/_lib/annual.js`,
granted like the audit report: admins from the start, a role when ticked) is that workbook
read off the system, for any year, as it stands today.

**Where each figure comes from — one rule each, nothing stamped twice.**

| Figure | Source | Every month |
|---|---|---|
| Sales, count, TRK1 (first-time), retained, total loan (P+I) | the loans table, `SALES_STAGES` by `approved_date` — the one rule every sales figure uses. Summed by the database (`loan_month_totals_by_team`, RUN-ME-049) or, until that is pasted, from the rows on the server (and the screen says so) | 2024 onward |
| Collection, early collection, recovery | the **month ledger** the month report fills (`monthLedgerDays_` → `ledgerByTeam_`, the same cells, with Iliyonasia laid over) | the months the app has run (August 2026 →) |
| Collection, early collection, recovery before the app | `team_months`, stamped from the workbooks by **`db/RUN-ME-049a` to `049f`** (six short scripts, none over 13 KB, run in order: a the table and the sales function, b 2025, c January–March 2026, d April–May, e June–July, f the loans index, slow and on its own; each safe to re-run). They are short on purpose: the one 60 KB script was cut at about 20,000 characters when pasted into the SQL editor | January–July 2026 per team per month; 2025 as one **year row** per team (the 2025 workbook kept no monthly collection or recovery — only the year's collection %, PAR and total def, and the year's leaders) |

A month that has stamped rows is read from them and nowhere else; a month without is the
ledger's. Sales are never stamped and never frozen, which is why "customer retention comes
from sales" needed nothing new. An early-collection % of 0 in the sheets is stamped as NULL
("not recorded"): February–April carry 0 for every team.

**The arithmetic, as the workbook does it, written once in `annual.js`:** a month's three
percentages are the month report's own (sales ÷ weekly×4, collected ÷ expected, recovered ÷
uncollected; nothing left to recover is "not measured", never 100%); a year's percentage is
**the average of its measured months** (the workbook averages twelve cells; a running year
averages the months that have happened); GENERAL is the average of the measured three; a
leader's figure is the average of their teams' for the same period, and "everyone, in any
role" is judged on the union of every team a person holds under any heading. The company's
month is sums (collected over expected, as the month report's totals); its year is the
average of its months, like every other row; 2025, closed per team only, averages the teams.

**Who holds a team** is Teams & Staff as it stands today (`readTeamsAll`, the codes laid
over the sheet — PMO is the `collection` column, early collection `expected`), except where a
year row names the holders: 2025's names are 2025's. The 2026 month rows carry no names on
purpose; how a leader who moved should carry the months they actually held is a decision the
GM wants to take after seeing the reports themselves, and `team_months` has the columns for
it when that day comes.

**On the screen:** three report types — **Timu / Teams** (the ANNUAL sheet: every team's
year in the workbook's columns, or one month's own sheet when a month is picked), **Kwa mwezi
/ By month** (the company month by month, then any one metric across the months for every
team — the SALES / COLN / REC / COUNT sheets), **Viongozi / Leaders** (a board per role, the
GMO sheets, then everyone in any role; a name opens the card with their teams and a General %
by month, Excel beside the ×). The year steps ◀ ▶, a month narrows Teams and Leaders. Every
board exports Excel / JPG / CSV; the list behind the chip is the same table with the search.
Under the bar: which months came from the sheet, the system, or are still pending, and the
rule in one line. Not on the upload or call paths: one answer per year per scope, the usual
minute.

**Cost.** The ledger months are filled under one 20-second budget, oldest first; a month the
budget does not reach says "ledger pending" and is picked up on the next open, because the
ledger stores its progress. `monthLedgerDays_` now takes the two summary reads in
(`summaries`), made once for the whole stretch, and **stops a finished month's slices at the
month's end** — a January read in November used to ask for forty slices, thirty-eight of them
outside January. The speed table carries the cold year (12 / 83 trips: seven months of slices
and their stores) and a warm-open test (9 trips: a finished month never costs a slice again).

**What is not there:** 2025's months show sales only (no monthly collection or recovery
exists for them anywhere); a month before the stamps are pasted shows sales and whatever
the ledger holds; the hand-made 2026 deck is not generated — the tab's exports are the
report, and a deck can be cut from them when the year closes.

---

## Part 34 — Who held each team, when: the leader history

> "backfill the leaders, then from the current ones whenever I change a name of code holder,
> trigger to save the previous one only if the new saved name is different. Because I might go
> there to edit something else from names."

Teams & Staff says who is responsible **now**; every move overwrites it, so the past was
rewritten each time and the Annual Rep tab could not say whose year a team's year was. The
other half is `team_holders` (`db/RUN-ME-050-team-holders.sql`, small, nothing to paste but the
table): one row per team, per role (the Teams & Staff column: gmo, manager, opm, collection =
the PMO, credit, expected = early collection, recovery, bike, legal), per stretch of days one
person held it. `name = ''` means nobody held it. A running stretch ends on `9999-12-31`, so a
read is one range query. The table is **optional**: without it the tab judges every month on
whoever holds the team today, as before, and a note says to run RUN-ME-050.

**The backfill is not pasted.** The workbooks' leaders live in `api/_lib/annual-holders-data.js`
(generated from the 2025 FINAL sheet and the ten 2026 monthly sheets; 2025 is the FINAL
sheet's holder for the whole year, 2026 is each month's own names; a sheet's "NO-PMO / NO GMO /
NO-BIKE ..." is a stretch of nobody, a blank cell is unknown and writes nothing; an unknown
month is bridged only between two months naming the same person). The first admin to open
Annual Rep after the table exists loads it (`loadWorkbookHolders`: chunks of 500,
`ignoreDuplicates`, so a correction made by hand is never overwritten) and the setting
`ANNUAL_HOLDERS_LOADED` stops it ever running again. Readers, read-only users and team-scoped
users never trigger it. Every workbook stretch is closed at a month's end, so the app's own
rows (which open on the day they are recorded) never overlap one.

**The trigger lives at the one door.** `portalApi` wraps `HOLDER_FNS` (saveTeam, deleteTeam,
saveStaffTeams, saveAccessCode, deleteAccessCode) with `syncHolders` before and after, for an
admin only, swallowing every failure (including the table not existing) so it can never break a
save. `syncHolders` compares who holds each role NOW (`readTeamsAll`: the sheet with the access
codes laid over it, exactly what every board reads) with the open stretches and writes **only
what differs**: the open stretch closes the day before and a new one opens today; an emptied
role closes and opens an empty one; a role seen for the first time opens from today. Editing a
phone number or anything else writes nothing; retyping the same name writes nothing. A stretch
that began today and is already over has no days in it and is dropped, not kept.

**The same person under two spellings is not a change.** The sheets say "SULEIMAN"; Teams &
Staff may say "SULEIMAN MPOKI MWASUNGA". `looseSame` (every word of the shorter name is in the
longer) means spelling a name out in full never records a transfer, and `canonNames` folds the
two into one leader on the boards, only when the longer name is the ONLY one it could be.

**What Annual Rep does with it.** A month belongs to whoever held the role then: the month
being lived to whoever holds it now, a finished month to whoever the history says held it on
its last day, and where the history is silent to whoever holds it now (what every month was
judged on before). A leader's month is the average of the teams they held THAT month; the year
is the average of those months; "Everyone, any role" counts a team once a month however many
roles the person held it under and shows their General % in each role beside the overall one.
The card behind a name lists each team with the months it was held (JAN–MAR, JUN) and a
General %-by-month table that is blank, not zero, for months they did not hold it. The
response carries `holders: { ok, stretches, loaded }` and notes for a missing table, the count
loaded, or a failed load.

**What to know.** The March 2026 sheet shows one-month holder blips (28 in the GMO column); the
backfill stores what the sheet states and they can be corrected in the table (the load never
overwrites). Recovery officers have no workbook history, so their history starts the day the
trigger first sees them. Cost: ~1,840 stretches for 2026, two pages, once per cold open of the
tab (never upload or call); the speed table says why, and a separate test pins the one-time load
at a handful of chunked writes. `team_months` and `team_holders` are named in `PAGE_KEY`
(api/_lib/supabase.js) so their reads page on the real primary key instead of sending the
`order=id` Postgres can only reject.

---

## Part 35 — Export deck (PPT): the annual report as the GM's deck, from the year on screen

> "Having the ppt design in place -- I wish to have an export annual ppt button that will always
> ppt export with updated data of selected year"
> "PAR data, Active portfolio, and legal performance must be presented in the ppt with no excuse"
> "Where giving zones in ppt there should be (key) listing teams in the zone or ... name the GMO"

**The button** sits on the Annual Rep bar (`Export deck (PPT)`). Pressing it makes a .pptx for the
selected year, in the browser, named `HOPE_Annual_Report_<year>.pptx` (`_to_date` while the year runs).
Nothing is fetched at page load: the tab (`public/mod/annual.js`, `anPptExport_`) asks for
`/deck/annual-ppt.js?v=BUILD` on the first press, and that file fetches the PowerPoint library and the
two images. Files, all in `public/deck/`: `annual-ppt.js` (the model and the slides), `pptxgen.bundle.js`
(PptxGenJS 3.12.0, MIT, vendored so the export needs no third-party host; its source-map comment is
removed), `hope-title.jpg` (21 KB), `hope-logo.png`. Colours are hex (a browser-made deck has no theme
step); fonts Calibri; charts are native, so the GM can edit them in PowerPoint.

**What it asks the server, on the press only:** `annual` for the year before (only if that year exists;
the one-minute cache usually has it), and `annualBook` (below). The year itself is `S.anData`, already on
screen. The arithmetic is the server's; `annual-ppt.js` only chooses, sorts and words. Two additions to
the annual answer so the deck needs no rule of its own: `regions` (each region month by month and for the
year, built by `monthRow_`, the same helper that builds the company's months) and a leader's `retained` /
`retentionPct`.

**`annualBook(year)`** (`api/_lib/annual.js`, FN_TAB `annual`) is the three books the system holds, each
read by its own tab's reader with the caller's own scope and grouped by region: `par` (the PAR tab's
`par()`: days-overdue bands, status, per team with all-time PAR, and by region), `portfolio` (the latest
Expected deck: customers, outstanding balance, how many are behind, due and collected that day, by status,
team and region) and `legal` (the demand notices dated in the year, by month, state and team; the tiles
come from `noticeTiles_` in portal-core, extracted so the register and the deck share one definition).
Each section is `{ ok, ... }`; one the code may not open (it needs the PAR, Expected or Legal tab) or that
fails returns `{ ok: false, reason }` and the deck draws a slide that says why. PAR and the portfolio are
the book as at the latest deck (the date is on the slides and in the notes), not rebuilt for a past
year-end. (A closed year's stamped PAR by team is NOT in the deck -- "out of the PPT deck, can stay in reports but not in PPT" -- it stays in the Annual Rep tab.)

**What the deck holds** (a slide is left out when its data is not there, and the contents slide lists only
what is in): at a glance, teams and regions, sales by month / against last year / top ten / against
target, first-time and returning, retention by team, region and credit analyst, collection and recovery
by month and team, regions (sales, GMO, general) **and a key of every region with its GMO and its teams**,
credit analysts, general by team and leader, a month-by-month table, **portfolio at risk (overview, region,
team, status), the active portfolio (overview, region, team), legal (overview, month and state, team)**,
observations, what to focus on, what is not here, notes. Not in it, said on its own slide: staff
headcount, loan-application pipeline (the portal keeps no history of stages), court cases and lawyer cost
(the portal holds notices), fleet.

**Fitting a real book (two dozen regions).** Lists that can be long are PAGED, ten regions to a slide (bars and
table carry the same ten, titles read "(1 of 3)"), never squeezed; names are shortened, the region key flows
into columns across slides, and a test fails any shape that runs off a slide or into the footer. Teams with
no region set in Teams & Staff are counted nowhere and said, on the regional slides, the coverage slide and
the notes (`unplaced` on the PAR and portfolio sections says how much arrears or balance that leaves out).

**Not every chart is a bar.** A trend is a line (teams, sales against last year, collection, recovery, notices,
"How the year moved" with the three measures and General), a share is a doughnut (network by region,
first-time against returning, arrears by days overdue and by status, the portfolio by status, notices by
state), a spread of teams is a scatter ("Where each team sits": sales against collection), and bars are kept
for rankings. All native charts. **Who led each month:** before General by leader, a table of each month's
top three GMOs, a matrix of the best GMOs month by month with each month's leader marked and a count of
months led, and a line chart of the five best ("the monthly race"); the OPMs get the table. **Legal
officers:** the register's issuer is the officer, so `annualBook.legal.byOfficer` carries notices,
customers, demanded, paid since, recovery % and cleared per officer (each customer once, by `noticeTiles_`),
and the legal officer recorded on each team in Teams & Staff is shown beside it with the teams they hold.

**The map of Tanzania.** The coverage doughnut stays and the same coverage is drawn on a map beside it ("Where HOPE works:
N of 31 regions"), with the same machinery for General performance, PAR and the active portfolio ("... on the map"), so
every region is on one slide however many there are. Each region is a native freeform shape (recolourable in PowerPoint),
four colour steps with a key, a label chip on the region and a call-out in the sea for the small coastal and island ones
(Dar es Salaam, the three Zanzibar and two Pemba regions), and a side panel of the biggest few. **All 31 regions**: 26 on the
Mainland and 5 in Zanzibar, **Songwe included**. The open region-level boundary sets (geoBoundaries ADM1, Natural Earth) are the
2015 map with 30 regions and no Songwe, so `public/deck/tz-regions.js` is built by `tools/build-tz-regions.py` from the
district-level set of the Tanzania National Bureau of Statistics / UN OCHA ROSA (2021, CC BY 3.0 IGO, via geoBoundaries ADM2):
districts merged per region, Songwe's five (Ileje, Mbozi, Momba, Songwe, Tunduma) taken out of Mbeya; 27 KB, credited on every map
slide. The file is fetched on the press beside the library; if it does not load the deck is still made without the maps and the
notes say so. **Matching Teams & Staff names**: by letters only (`Dar-es-salaam` = `DAR ES SALAAM`), with three that are not
regions put where they belong and said on the slide (Kahama into Shinyanga, Coast into Pwani, Zanzibar into Mjini Magharibi); a name
that is none of them, such as a zone (`LAKE ZONE`), is not guessed: it is listed under "Not on the map". Two registry names that
land on one region are added together (teams, arrears, balance; PAR is recomputed from the sums, never averaged).

**The current-year all-time PAR leads the PAR slide.** "The par all-time current year widget should come first before the real all-time." The first card of
*Portfolio at risk* is **All-time PAR, <year>**: the arrears on the loans *disbursed in the year* over the *total loan (P+I) lent in the year* (the year's
`totals.totalLoan` from the annual answer), one decimal, then the all-time PAR over everything ever lent. The arrears by disbursement year come from the same
defaulter rows the PAR tab already reads (`par().byYear`, no extra read; `annualBook.par.byYear`). It is the loans of the year that are in arrears *today*, over what
that year lent -- not the year's sales cut by when the arrears arose. A year with no arrears row or no lending says "no <year> lending or arrears to measure" instead
of a zero. Two bullets beside the doughnut say what each figure is, with the arrears and lent amounts.

**One PAR in the deck: the all-time PAR.** "We drop the arrears over balance concept in all slides ... doesn't want to present it to the directors ... live with all time
PAR only." The books slides no longer show the balance-based PAR (arrears over the balance of customers in arrears) anywhere. *Portfolio at risk* leads with the
**all-time PAR** — the arrears over the total loan (principal and interest) of everything ever lent, since the first sale — beside the arrears, what was ever lent and the
average loan; the regions are ranked by it (with each region's arrears and what it has lent), the map is coloured by it (a region's arrears over what its teams have lent,
an alias such as Kahama added to its region), and the team slide shows it beside the arrears. The *Active portfolio* slides carry the arrears as an amount (TZS million)
where they used to carry "Arrears %" (arrears over the balance). A closed year's stamped **year-close PAR** (the workbook's own figure, its collection being 100 − PAR) is **not in the deck at all** -- no slide, no contents line, no note: it
stays in the Annual Rep tab and the reports. The deck names no PAR but the all-time one (the empty-state messages say "portfolio at risk" and "defaulter deck", not "PAR"). The PAR *tab* in the portal is unchanged (it still reads both, the all-time one
to one decimal, Part 38). A test fails any slide that says "over the balance", "Arrears %" or names a PAR once the all-time PAR is taken out.

**The gaps: the regions we are not in yet.** "Even the regions we aint in yet -- mention them / show, so that we are well aware of the
gaps." A region is *in* when a team in it sold in the period (`presence`, from the same regions the coverage map uses); the rest of the
31 are `gaps`. They are drawn on **every** map as a white region with a dashed edge (`Gap <name>` in the file), apart from a grey region
that has a team but no figure ("no data"): the key says "Not in yet · N regions", and on the coverage map each is also labelled "not yet"
on the map itself. After the coverage map comes **"Regions we are not in yet: N of 31"**: the count, the mainland ones and the Zanzibar ones
by name, and the regions held by only one or two teams (one closure from being a gap). No gaps, no slide; the contents line says "and the
gaps" only when there are some.

**The GMO zones.** "I wish a map of gmo zones too." After General on the map comes **"GMO zones on the map"**: each zone (the `zone` set on the
team in Teams & Staff) a colour, a region taking the colour of the zone with most of its teams (a region shared by two zones is counted and said
in the footnote), and a key with **every** GMO of each zone named in full ("GMOs: A, B, C", the one who holds most of its teams first -- the first
version named the top one and "+n", and the others were missing), with its teams, regions and General %. Also named, because a name missing from a
zone map reads as a GMO who holds nothing: the GMOs of teams with **no zone set** (a "No zone set" row), the GMO who holds only a team that **sold
nothing this year** (Teams & Staff teams with no sales are in no figure; `annual` now carries them as `idle`, from the registry it already reads -- no new
read -- and the deck adds their GMO to the zone; a zone where nothing sold is a row of its own, uncoloured, "none sold in 2026"). A key too long for the
slide goes on to a **continuation slide** ("GMO zones, continued", two columns), whole rows only; the "Not in yet" row stays on the map slide. Row heights
are estimated from the names (capitals count wider); the test checks nothing runs off the slide. Zone colours run out at ten; the rest share the grey.
With fewer than two zones set there is no slide. The gaps are dashed here too.

**The region labels on the zone map carry their GMOs.** "Also add the GMO names to the region labels on the map." On *GMO zones on the map* each region's label
(and the call-out in the sea for the small coastal and island regions) has a third, small line naming the GMOs who hold teams in that region (`gmosOfRegion`: the
official region as the map draws it, so Kahama's teams count in Shinyanga, plus a GMO who holds only a team that sold nothing). `drawMap` takes an optional `subFor`; only
the zone map passes one, so the value maps (General, PAR, portfolio, coverage) keep their plain labels. A label that lists them in full over two short lines does; one that would
cover the region it names (about three or more GMOs, long names) gives **first name and the initial of the last** ("DITRICK M."), and two different people who would shorten alike keep
their full names (`mapGmoText`). The key beside the map always has every name in full. The label grows to hold its names (never past 1.25 inches); the sea call-outs are
stacked by their own heights.

**The region slides name every GMO too.** "List the GMOs on the region slides too." The regions table (column "GMOs") and the "Regions: who is in them" cards
used to say "GMO: X +n" (the one holding most of the region's teams and a count of the rest); both now list every GMO of the region in full, the one holding most
teams first ("GMOs: A, B, C", "GMO: A" for one), and include a GMO who holds only a team that sold nothing this year (`gmosOf`, from `M.idle`). A name is one person
however it is cased (`gmoAdd`). A region with several GMOs makes a taller table row and card, so the table pages by **height** (`packPages`, `rowH`; at most ten rows,
3.2 inches of them) and the card columns use the wrapped height (`wrapLines`, the same letter-by-letter width estimate the zone key uses). Checked by rendering the slides
through LibreOffice with real-length names; `test/annualppt.test.mjs` pins every GMO of every region on its card and in the table, none behind a "+n". (A latent bug found on the way: the label-overlap loop reused `ox`, the map's own x-offset, and moved the
island call-outs into the middle of the country; it only showed once every gap carried a label.)

**Saving the file, in a browser and in the Android app.** The deck is saved through the page's own `download(blob, name)`
(`app.html`), like the Excel and JPG exports, never by PptxGenJS's `writeFile`: `writeFile` makes a `blob:` link, which works in a
browser and nowhere in the app's web view (the app answered "open the system in Chrome", or closed). Inside the app `download`
hands the bytes to the app's `HopeCalls.saveBase64` bridge, which writes them to the phone's Downloads folder and says so; in a
browser it is an ordinary download. No new app release is needed (the bridge already exists in the installed app); an older
page without `download` still falls back to `writeFile`. Two traps, both pinned by `test/annualppt.test.mjs`: the file is typed
as a PowerPoint file (`application/vnd.openxmlformats-officedocument.presentationml.presentation`; the library types it as a zip
and Android would name the saved file `...pptx.zip`), and it is made with `pres.exportPresentation({ compression: true })`, not
`write({ outputType: 'blob' })` — the library compresses only when no output type is named, so the latter came out 3.3 MB instead
of 0.45 MB (a slow save, and a 4.4 MB string across the bridge).

**Cost.** `annualBook` is the PAR tab, the register and the Expected tab added together (the defaulter deck
is read twice, as when both tabs are open); the speed table carries it (18 / 5,300 un-migrated, 16 / 3,300
migrated) with the reason. Never on `/api/upload` or `/api/call`. `test/annualppt.test.mjs` runs the real
server, the real deck code and the real vendored library in a VM and reads the slides back out of the file.

## Part 36 — Imprest: some roles go through their OPM before the GM

> "GMOs and Managers imprests shouldn't go to GM directly ... I have to select which roles pass through which
> to get to GM at the imprest approvals tab, so I select those two and choose the OPM role. When their
> respective OPM finds their requests in the request tab, the OPM confirms the request (may adjust the amount
> with a comment) — then it proceeds to the approval tab / GM."

**The rule is a setting, chosen on the Approvals tab.** `IMPREST_ROUTES` in `settings` is a JSON list,
`[{"from":["GMO","MANAGER"],"via":"OPM"}]`. The "Who requests pass through before the GM" card on Idhini ya imprest
edits it (`imprestRoutes` / `imprestRoutesSave`, pane `impappr`): tick the roles, pick the role they go through.
The save refuses a role that routes to itself, a role in two routes, and a "via" role that is itself routed. It
returns `stranded`, the number of requests still waiting for an OPM whose route was just removed (see below).

**What a routed request does.** A code whose role is in `from` asks as always, but the row is born
`stage = 'opm'`: waiting. It is **not** in the GM's pending count, queue, email or phone, and the GM cannot decide
it (`imprestDecide` refuses while it waits). The OPM sign-ins that may confirm it hear on their own handset
(`IMPREST_MINE`), find it in a "Waiting for your confirmation" card at the top of **their Requests tab**
(`imprestMine.confirm`), and press Confirm: `imprestConfirm` takes `amount` (default what was asked) and `comment`.
**The OPM may confirm less than was asked, never more, and a comment is required when the amount is changed.** The
row moves to `stage = 'gm'` in one guarded update (`where stage = 'opm' and status = 'pending'`, so two OPMs cannot both
win), the GM is emailed and buzzed then with the OPM's line on the notice, and the requester is told it is with the GM.
The GM's approve box starts at the OPM's figure and may still go up to what was asked, never above it. Nothing about the
decision, funding or retirement changed.

**Which OPM.** "Respective" is read off Teams & Staff: the teams the requester holds (the `gmo` column for a GMO,
`manager` for a Manager, `credit` for Credit; matched by name — exact or `sameName` — and, for a role with no column, the
teams on the access code) and the name in each team's `opm` column; the OPM-role sign-ins that match are those with that
name or a team in common. Stamped on the row (`routed_via`, `routed_names`, `routed_teams`), so changing the rule later does not
move a request already waiting. A confirmer is also never the requester.

**Never a dead end, and never silent.** If no team is found for the requester, or no OPM sign-in matches, the request goes
**straight to the GM** with `routed_note` saying why (shown on the GM's drawer, the details drawer, and the requester's
confirmation). The GM can **release** any waiting request (`imprestRelease`, the OPM is away): it goes to the GM, with a note
naming who released it. On the Approvals tab, "With the OPM" is its own KPI and filter, and "All" shows those rows flagged
"Waiting for OPM".

**Until the migration is run.** `db/RUN-ME-2026-11-05-imprest-opm-step.sql` adds nine columns to `imprest_requests`
(`stage` default `'gm'`, `routed_via`, `routed_names`, `routed_teams`, `routed_note`, `opm_by`, `opm_at`, `opm_amount`,
`opm_comment`), a check on `stage`, a partial index on the waiting rows and an empty `IMPREST_ROUTES`; instant and safe to
re-run, mirrored in `db/schema.sql`. Without it nothing breaks: reads try the wide column list and fall back to the narrow one
(memoised for 60 s per process, `rtState` / `readRows_`); a routed request is inserted without the routing fields and **goes to the
GM**, the requester's confirmation says "OPM routing is not switched on yet (run ...)" on every such request, and the routing card
on the Approvals tab shows a red "not switched on in the database" banner. A missing routing column is told from a missing table by
`rtMissing_` (`tableMissing` matches any "does not exist" and must not be used for these columns).

**A missing column is learned from a read that returns rows, never from a head count.** A head request has no body, so
when the database lacks a column the refusal arrives as `{ message: '' }` — no code, no "does not exist" — and cannot be
recognised; rethrown, it was printed on the Approvals tab as "[object Object]" the first time the tab was opened before the
migration was run. `imprestQueue` therefore probes with a one-row get (`select('id', { count: 'exact' }).limit(1)`), whose
error carries PostgREST's words, and a probe that fails for any reason draws the pane the old way instead of failing it.
`test/fake-db.mjs` now refuses a head request on a missing column with an empty message, as the real client does, so a test can
see this; and `withApi` (`api/_lib/auth.js`) says "the database refused the request and gave no reason" for an error object
with no message instead of `String(e)`. Rule for any future migration: **probe with a get, not a head count.**

**Requests already pending when the route was set.** Routing applies to a request at the moment it is made, so what was pending with the GM stayed there.
`db/RUN-ME-2026-11-05b-imprest-move-pending-to-opm.sql` moves those once, by the same rule (the saved `IMPREST_ROUTES`, the requester's teams in Teams &
Staff by name, falling back to the teams on their access code, the OPM named on each, and an OPM-role sign-in that matches by name or by team). It is in
`'preview'` mode until the word is changed to `'move'`, lists every pending request of a routed role with where it would go or why it would stay, stops
with a plain message if the migration is not run or no route is saved, moves only requests that are pending and still with the GM (so a second run moves
nothing), leaves alone what it cannot place (the table says why), and sends no email or phone alert: the OPMs find them in their Requests tab. Checked on
a real Postgres engine and against the app's own `resolveRoute_` for the same people; if `resolveRoute_` changes, change the SQL with it (it is a one-off
copy of the rule, which is why it is a RUN-ME file and not a function). Where it cannot place a request, `db/RUN-ME-2026-11-05c-imprest-move-by-hand.sql` moves
named requesters to a named OPM with no matching at all. The usual cause is a name that is not the sheet's (an access code "DITRICK" against a GMO cell "DITRICK
MUFURUKI": `sameName` needs two words in the shorter name, so a one-word name matches only exactly); the fix at the source is to give the access code the
sheet's full name, and until then the route falls back to the teams on the code.

**A route removed.** The OPM's own list follows the rule in force (`imprestMine` reads the waiting rows only for a role that some
rule routes to, so no other officer's Requests tab gains a read). A request waiting under a route the GM then removes keeps its stamped
OPM but the OPM no longer sees it; the save tells the GM how many ("still wait for an OPM whose route you removed"), and they sit under
"With the OPM" for the GM to release.

**Not built, on purpose:** the OPM cannot reject (only lower and comment, or leave it for the GM, who can reject); only a role's
first matching route applies (a role is in at most one route); there is no second approval level after the OPM.

**Cost.** `imprestRequest` adds one cached settings read (15 s) per ask and, for a routed role only, one `teams` and one
`access_codes` read; `imprestQueue` adds one head count (and drops waiting rows from the GM's pending list at the database);
`imprestMine` adds one read of the waiting rows for an OPM-type role only. None of it touches `/api/upload` or `/api/call`.
Tests: `test/imprest.test.mjs` ("OPM step", 12 scenarios including a database without the columns), `test/pages.test.mjs` (the
screens' contracts), `test/schema.test.mjs` (the columns exist in `db/schema.sql`).

## Part 37 — Expected defaulters: the person box follows the role

> "At Expected defaulters, after choosing a role I expect choosing the person to list the people of the chosen role too, not stuck on all."

The four boxes above the table are team, status, role (GMO / MANAGER / BIKE) and person. The person box used to be built once, from every leader due that
day, and the other three only narrowed the table, so the box still offered everybody. It is now `xdLeaderList_` in `public/app.html`: the leaders of the
customers the team, status and role boxes leave on screen (never the person box itself). `xdSyncLeaders_` rebuilds it when one of those three changes
(the `data-filter` handler) and on every draw of the screen (`wireBar`), so a screen brought back from the remembered-screen cache, whose HEAD was drawn with
the boxes it had then, comes back consistent. A person who is no longer on the list (Ali chosen, then the role set to MANAGER) is cleared, and the table is
redrawn, instead of being left over an empty table. The rows are `S.rows`, which on this screen are the day's customers before any box narrows them.
Client-side only; the server's rows are unchanged. Tests: `test/pages.test.mjs` (the real functions run in a sandbox). Checked in the real page in Chromium
with the API stubbed.

## Part 38 — PAR all-time to one decimal

> "PAR all time should include one decimal place."

Every percentage on the screens is a whole number (`pct()`, "96.7 = 97 everywhere"); the all-time PAR is the one exception, because a small share of a very
large book (6.2% of TZS 60 billion) hides a move of tens of millions in a whole number. `pct1()` in `public/app.html` writes one decimal (6 reads 6.0%, so a column
lines up); a column opts in with `dec:1` (`cellText` honours it, and `pctRound_` makes the main table's and a board's Excel export write the figure the screen
shows). The PAR tab uses it for the "PAR all-time" KPI, the team table's "PAR all-time %" column (its "~" average row too) and the footer; the ordinary PAR stays a
whole number. The server already sent one decimal (`pctOf`), so nothing changed there; the Annual deck already shows it to one decimal.

## Part 39 — Salary advance: an undecided request of a month that is over has expired

> "All salary advances that were not approved and past current month must be expired so that they no longer read pending and
> those users can request current month"

A request nobody decided before its month ended used to stay **Pending** in the book for ever and was only *shown* as "closed" on the
desk. It is now **Expired** (BUILD 2026-11-10-a; `ADV_EXPIRED`, `advStale_` in `api/_lib/portal-core.js`):

- **One definition.** Pending, and filed in a month that is over, by the East Africa month (`advMonthEat_`). Approved and Disapproved
  are decisions and are left alone. THIS month's undecided requests stay Pending, finalized or not, because Finance can still reopen
  the month; they expire when the month is over.
- **It is written, with no migration and no schedule.** The first advance screen that *meets* such a request (the approvals desk, the
  report, the history on the request tab) marks every one of them Expired in ONE statement (`advExpireOld_`:
  `approval = 'Expired' where approval = 'Pending' and submitted_at < the first instant of this month, EAT`). A book with nothing to
  expire is never written to, so the screens cost what they cost before; the write is one extra trip on the one open that finds them,
  once a month. Nothing on `/api/upload` or `/api/call`.
- **It is read that way meanwhile** (`advExpireView_`): a row still Pending in the database whose month is over is shown as Expired,
  so the desk, the history and the report are right even where the write failed (it is logged, and the next reader that meets one
  tries again). The report's **Expired** filter asks for both spellings and applies the rule; **Pending** no longer brings them.
- **Expired is not a decision**: `decided_by` and `decided_at` stay empty, and `advDecide` refuses it ("expired -- its month ended
  undecided; they can ask again this month"), for the desk and an admin alike.
- **On the screen** (`public/mod/advance.js`): the desk's third pill and card are *Zimeisha muda / Expired*; each read-only row says
  *Expired* or, for this month's once Finance finalized it, *Closed by Finance*; the drawer says the staff can ask again; the history
  and the report show Expired, and the report can be filtered to it.

**Asking again.** One request per person per month was already this month's requests alone, so an earlier month's request -- expired,
disapproved or paid -- never stood in the way; that is now pinned by a test. What changed is WHICH month a request belongs to on the
ask: it was read off the UTC date (`advMonth_`) while the desk and the report went by East Africa time, so a request filed between
midnight and 03:00 on the 1st was the new month's on the desk and the old month's on the ask, and a second one that month went through.
Both go by the East Africa month now (`advMonthStartUtc_`), on the request tab, the ask and Finalize's count.

**Uploading the register again** keeps a cell that says Expired as Expired (`advApproval` in `importers.js`); a cell that says Pending
for a month that is over is expired again by the next screen that meets it.

## Part 40 — HOPE Calls: a bike officer's four lists

> "Our bike users are the most illiterate sorry to say that, for that only specific role - they should find only 4 default lists in
> call app view. 1 - the bike expected defaulters list of today (gmo and manager excluded) 2 - the second is from defaulters to expired
> but let them find their customers at visit"

Asked which four, the owner chose **Exp.Def, Def, Exp, Chr**, with the status lists holding **all customers of their teams**.
CALL_BUILD 2026-11-11-a.

- **Who is a bike officer** (`bikeView` on `api_callBoot`, `api/_lib/call-core.js`): named in a team's **Bike** column on Teams & Staff
  and in no GMO or Manager column, or registered under a role that says BIKE. Somebody who is also a GMO or a manager somewhere keeps
  the full app. It comes off the teams rows the boot already reads: **no new read on `/api/call`**, pinned by a test that a bike
  officer's boot reads exactly what anybody's does.
- **What their phone shows** (`public/call.html`, `bikeMode_`): four tabs, **Exp.Def first and opened by default**, then Def, Exp, Chr.
  Leo and Kesho are hidden and never fetched, so a bike handset asks the server for two lists where it asked for four. Exp.Def is
  locked to the BIKE customers of today (`xdRole_`), always their own list (`xdScope_`), with no GMO / Manager pills and no "Timu
  yote" switch to press by mistake. Ripoti still follows its own rule (leaders only).
- **Finding a customer on a visit**: Def, Exp and Chr are the whole defaulter book of their teams, and the search box looks through it
  (`searchSources_`) and, as for everyone, asks the server for the whole book after a pause (`api_callFind`).
- **A simpler view, not a narrower permission**: `api_callList` answers a bike officer exactly as before; only the screen changed. To
  give a bike officer the full app again, take their name out of the Bike column or change the role on their registration.
- **Also fixed here**: the Exp.Def summary is a white card inside the navy header and had no text colour of its own, so Wateja, Deni
  and Rec % were white on white for everybody; `.expdfstrip` now sets its colour.

One helper decides each thing (`homeView_`, `xdRole_`, `xdScope_`, `searchSources_`), and `test/pages.test.mjs` fails if any path walks
the three sources or assumes Leo on its own again.

**The top bar is their own summary** ("for bike on the top bar report just show them their summary, they have how many customers,
amount, recovered amt and recovery%"; CALL_BUILD 2026-11-11-b). For a bike officer the bar under the tabs reads
**Wateja · Deni · Marejesho · Rec %** of their own list of today, on every tab, in place of the team's Col leo / Kesho / Wiki / Sales /
Exp.Def / Rec / T.Def. The figures are added up on the phone from the very rows the Exp.Def tab shows (`drawBikeStrip_`: `xdSum_` over
`filterForView_`), so the bar and the list cannot disagree, and **a bike handset no longer makes the daily-summary request at all** --
the bar needs only the Exp.Def list, which it asks for once (`bikeStripLoad_`, never while one is already on the wire). The tag says
when the list was fetched, or the deck's date in red when the deck is not today's. The Muhtasari card would print the same four
figures right above the bar, so for a bike officer it shows only a warning the bar cannot carry (no initial deck, no DISB DATE) and is
otherwise gone.

**When a change goes out.** The owner decides, and says when: "Merge now ... I never said that rule". The line "Deploy heavy work in
the evening, and never during the morning collection round" was not the owner's and has been taken out of `CLAUDE.md`,
`docs/HOPE-BRIEF.md` and `docs/HOPE-OWNER-HANDOFF.md`. `docs/DEPLOY.md` and the deploy workflow still describe an optional Approve
step on the `production` environment for anyone who wants one.

## Part 41 — Our own server answers a phone the way Vercel did

> "Demit did his auto sync work at https://recovery-app.sync-book.net/dashboard so we should make sure if it does not conflict
> anything before we merge and move into it"

`server.js` runs this site off Vercel. Read against what Vercel does unasked, it was missing two things that land on the phones:
it never said "not changed" (no `ETag`, so a page sent `no-cache` was downloaded whole on every reopen -- `/call` is 187 KB and a
handset reloads it after almost every call), and it compressed nothing. It now does both itself (`etagOf`, `notModified`, a gzip
copy of each page kept per version, JSON answers gzipped on the thread pool), and a stray rejected promise is logged instead of
ending the one process that serves everybody. `/call` is 63 KB compressed and 0 bytes on a reopen; `test/server.test.mjs` pins it.

What could not be checked from the code -- which database the server points at, one process serving phones and portal together,
the gap while a deploy restarts it, and what a change of address means for browser users -- is written as a list for whoever runs
the server in `docs/DEPLOY.md` section 6.

## Part 42 — A new chat starts where the last one stopped

> "Chat is refusing to rewind and even providing any handoff thats why i wish there is something like merge, so that you continue
> automatic" ... "you must have that chat.md to understand all my flow"

The chat that built Parts 16 to 41 ran from 4 August to 11 November 2026 and then stopped taking messages: it had grown past its
size limit, and the summary it would have written of itself failed for the same reason. Nothing it had shipped was lost -- every
change was already merged -- but everything it knew that was not in this handbook went with it: what the owner had ordered that
week, what was half way, which scheduled tasks it was running, and how the work is done here.

A handoff written at the end is a handoff that is not written on the day it is needed. So it is no longer written at the end:

- **`CHAT.md`, at the top of the repository, is the chat.** The owner's standing orders in their own words (it points at
  `docs/HOPE-OWNER-HANDOFF.md` for the ones already on record and lists the ones given since), what a chat can and cannot reach,
  where the work stands, what is in flight, the scheduled tasks, how the work is done here, and what is waiting on whom.
- **Every new chat is handed it with the rules.** `CLAUDE.md` section 3 imports it, so it arrives in the same breath as rule 1,
  and says to read it first if it did not.
- **It is kept true by a test, not by a promise.** `test/chat.test.mjs` fails when `CHAT.md` names an older `BUILD`,
  `CALL_BUILD`, app version or handbook Part than the repository is at -- so a change cannot be merged without bringing it up to
  date. It also fails if a key, a connection string or an e-mail address is ever written into it: the repository is public.
- **The scheduled tasks follow the chat.** The 8-hourly change check fired into the chat that had ended, so its reports would
  have stopped with nothing to say so. It now fires into the chat that took over, and `CHAT.md` section 6 says how the next one
  takes it over in turn.

Nothing in the product changed, and nothing reads the database: three documents and a test.

**What could not be carried over.** The earlier chat's own transcript could not be opened from outside it -- it is too large to
read back. What was recovered is its last summary of itself and this handbook. Anything the owner said there that reached neither
is not in `CHAT.md`, and the owner has been told so.

## Part 43 — Two sites, and which book each one reads

> "reserve our own deployment for now - lets use https://recovery-app.sync-book.net in both web and app so that we are sure
> everything is okay there: it where the auto sync updates will be done by demit"

The same code now runs in two places: on Vercel, where every installed app points today, and on a server of our own that the
deploy workflow keeps in step with GitHub (Part 41). The order is to use our own server for both the web and the app, and to keep
Vercel as the reserve.

Whether two sites are ONE system or TWO depends on a single line that cannot be seen from outside: the database address in each
host's own settings. The same address, and an officer can use either site and nothing can diverge. Different addresses, and they
are two books -- identical on the day one was copied from the other, drifting apart from then on, every screen on both of them
individually correct. That is the failure this system fears most: nothing crashes, and a number is quietly wrong.

**Checked from outside on 11 November, before anything was changed:** our own server is up; it serves the same `BUILD` and
`CALL_BUILD` as Vercel; it compresses and answers "not changed" (Part 41 is live there); and it answers the sign-in screen's
questions exactly as Vercel does -- the same brand, logo and open/closed switch -- so its database is not empty. None of that
tells a shared database from a copy of it.

**So each site now says which book it reads** (`bookId` in `api/_lib/supabase.js`). `/api/app-version` -- the question the
installed app already asks at every launch, with no sign-in -- carries a `book`: the first twelve characters of a one-way hash of
the database host. It is not the address, cannot be turned back into it, is not a key and opens nothing. Two sites that answer the
same `book` read the same database. **No read was added anywhere**: it is worked out from a setting the process already holds,
and neither `/api/upload` nor `/api/call` is touched.

It is there for two readers. A person can compare the two addresses in a browser and know in ten seconds whether the sites are one
book. And the app can know it by itself -- which is what will let it fall back to the reserve only while the reserve is the same
book (the next change).

**Found on the way, and it matters for the move.** Our own server's certificate comes from Let's Encrypt; Vercel's comes from
Google. Let's Encrypt's authority joined Android's list of trusted ones in 7.1.1, so Android 6 and 7.0 do not trust it: a handset that old opens
Vercel today and **cannot open our own server at all** -- it would see a certificate error, not the app. That is the first job of
the reserve.

## Part 44 — The two sites are two books, so nobody was moved

> "lets use https://recovery-app.sync-book.net in both web and app so that we are sure everything is okay there"

It is not okay there yet, and Part 43 is what found it. Minutes after the fingerprint deployed, the two sites answered:

| Site | `book` | Which database |
|---|---|---|
| Vercel | `79e363955e75` | the Supabase project -- the book every installed app has worked on since August |
| Our own server | `9372d032c6ca` | `127.0.0.1:8000` -- a database on the server's own machine |

The second was named by fingerprinting the usual address of a Supabase installed on one's own machine: it matches exactly. So our
own server runs the right code against **a copy of the book**. The copy is good enough to carry the same brand, logo and
open/closed switch, which is why every check from outside looked right and why nobody signing in there would see anything wrong.

**The app and the web were not moved.** Had they been:

- an officer would work a list as old as the copy -- whatever was uploaded through Vercel after it was taken is not in it;
- every follow-up, promise, call and upload made there would stay there: on no report, on no other phone, in no commission;
- and nothing on either site would say so. Each would be individually correct.

That is the fault this system is built against -- nothing crashes, a number is quietly wrong, and somebody acts on it -- arriving
through the address instead of through the arithmetic.

**What has to be decided is which database is the book** (`docs/DEPLOY.md` section 7). Either Supabase stays the book: two lines
in the server's own settings, after which the two sites are one system and the move goes ahead at once. Or the database on our
own machine becomes the book, which moves the database and not an address: both sites must read it, in one moment, and the
backups, the migrations and the capacity become ours to keep. The first is recommended, because it tests the one new thing (the
server) without changing a second (the database) under it on the same day. The proof is the same either way: both addresses
answer one `book`.

**Until then, no real work belongs at the new address.**

Two more things from the same morning. The deploy that carried Part 43 restarted our own server while it was being asked for its
health about every 0.6 seconds: 484 answers in five minutes, none refused, none slower than a second -- the restart gap is
smaller than feared. And the certificate (Part 43) is written up for whoever runs the server in `docs/DEPLOY.md` section 6.

No code changed in this Part: `CHAT.md`, `docs/DEPLOY.md` and this page.

## Part 45 — What has to be true before anyone is moved

> "We should now access our work from the new website url only so that people can report any irregularities" ... "i expect
> https://hope-pmo-v2-ten.vercel.app/dashboard to redirect to the new one too" ... "changes i make here must be through to the new
> one in both app and web, so that me and demit both deliver into app and web - so you must ammend apk url update too i think, am not
> sure though on how it receives datga" ... "Then make a full analysis and give me any setbacks so that i tell demit"

The owner asked for the old addresses to lead to the new one, for the app to open it, and for an analysis to pass to Demit. The
analysis was made and handed over the same day as a private report (its questions for Demit are in order, each with a check he can
run). Nothing was redirected: the two sites still read two databases (Part 44), and the reading below changed how the move has to
be done.

**How it was read.** Eight readings of the code were started side by side. Three finished: the Android app, browsers and the
systems that hold the old address, uploads and feeders. Five did not (the single process and its capacity, database parity, data
continuity table by table, deploy failures, security): the account's usage limit cut the run, and the chat could not answer for
over two hours. The second reviewer who should have tried to refute each finding did not run either; the lock-app finding and the
upload-sweep finding were re-read by hand.

**What it found that changes the plan:**

- **A redirect is the wrong tool for the app.** A handset on app 19 loads only the host it has saved. Sent anywhere else, by the
  server or by the page, it opens the phone's browser: no call-log sync, no background alerts, and a device the server does not
  know. So the old addresses will forward from inside the page, and only when the page is in a browser.
- **A moved handset has no way back.** `setStartUrl` saves the new address before it loads it, the saved address outlives app
  updates, and the update check asks only that address. If the new server cannot be opened, the officer is left typing the old
  address by hand. So app 20 (which falls back by itself and asks both addresses for updates) goes out before any handset is
  moved, and handsets then move a team at a time.
- **Company phones with the lock app never change address.** The enrol command writes `-e server` once, from the page it was
  copied on, which has always been Vercel. If Vercel stops answering `/api/device`, or reads another database than the office,
  lock and unlock orders never arrive, and an issued phone that hears nothing for fourteen days locks itself. This is the
  strongest reason for the first way of Part 44: Supabase stays the book, and both sites read it.
- **A feeder that writes the tables directly breaks what an upload does besides inserting rows**: the batch stamp (which upload
  wins), the rebuilt officers' list, the totals, the data stamp that tells the handsets. Today's dashboard would read zero and the
  phones would keep yesterday's list, with every upload "done". Anything automatic goes through `POST /api/upload`; the request
  is written out in `docs/DEPLOY.md` section 7.
- **The restart gap was measured with no traffic** (Part 44). Under load the service takes no new connection until the requests in
  flight finish, up to 65 seconds during an upload slice, and only then does the new process start.
- **A database on the server needs what the hand-run scripts made** (eight functions, the totals tables), the hosted project's
  statement timeout, and every name in Vercel's settings.

**Ours to build next, in this order:** the in-page forwarding, armed only when both sites answer one `book`; app 20; the upload
page naming the address and book it writes to and resending a slice after a 502 or 503; `server.js` refusing to forward a request
to itself; the deploy check asking the running process, not a file, for its version. **To confirm, then fix:** the sweep after an
upload ranks a day's uploads across all teams and keeps two, so a day sent as three files may lose the first.

No code changed in this Part.

## Part 46 — Everyone sees their zone beside their name

> "GMOs must see ther zone names infront of their name in login e.g
> MARK II - "LAKE ZONE"
> GMO · All teams · 2026-11-10-a"
>
> "in short after switching in system everyone must see their zone"
>
> "so team name with zone infront of it, manager gmo opm etc as such too"

The name at the foot of the portal's sidebar now carries the person's zone: `MARK II - "LAKE ZONE"`, and for a team code
`VWAWA · F.O - "SOUTHERN HIGHLANDS"`. The line under it (role · teams · version) is as it was. BUILD 2026-11-11-a.

**Whose zone it is** (`api/_lib/zone.js`, one definition):

0. **Only the teams the code may see are looked at.** A code with a team list is looked for among its own teams and nowhere else:
   every screen it opens is scoped to them, and a namesake on another team must not lend it a stranger's zone. A code that holds
   every team is looked for on every team.
1. **The teams that name the person on Teams & Staff.** A zone is a column of Teams & Staff; nothing stores a zone against a
   person. The owner's own example is why the code's team list cannot answer alone: that GMO holds ALL teams and still has one
   zone. So the zones are those of the teams that carry the person's name in a role column (OPM, Recovery, GMO, Manager, Credit,
   Expected, Bike, Legal, Collection), matched the way the portal already matches a leader to the teams table: trimmed, in
   capitals.
2. **Else the teams the code holds.** A code with a team list shows the zones of those teams. This is the advance desk's rule,
   and `advZones_` now reads the same helper (`zonesOfTeams`): the name line never shows a zone the advance desk would not give
   the same code. A team code holds its one team and is never matched as a name.
3. **Else nothing.** A code that holds every team and is named nowhere (an admin, the head office) has no zone, and none is
   invented.

Two zones are written out, in alphabetical order; past two the rest are counted (`LAKE ZONE, WEST +2`).

**What it costs.** One read of the teams table (one row a team, eleven columns), started beside the sign-in's other reads so the
sign-in is not a round trip slower, and **only when the sign-in asks** (`/api/me?zone=1`: the typed sign-in and the stored code).
The version checks that call `/api/me` every fifteen minutes, and every three on a playing deck, ask for the build alone and read
what they read before. Nothing on `/api/upload` or `/api/call`. A database without the zone column, a read that fails, or one that
has not answered in a second and a half (`ZONE_BUDGET_MS`) answers "no zone" and the name is drawn as it always was; so does a
server older than the page. The sign-in is never kept waiting on the zone.

**Checked** in a real browser (`tools/browser-checks/portal-zone-name.mjs`): both sign-ins ask for the zone, the version check
does not, a zone typed on Teams & Staff is drawn as text, and a long name with several zones wraps inside the sidebar on a desk
and on a phone without widening the page. `test/zone.test.mjs` holds the rule, the one read, and the fall-backs.

**Not done.** HOPE Calls (the phone) is unchanged: the words were "after switching in system". The launcher's menu (`/?menu=1`,
the office television and an admin's door to the upload) also prints the signed-in name, and still prints it bare. A person whose
name on their access code is spelt differently from Teams & Staff, and whose code holds every team, sees no zone until the two
spellings agree. A zone that could not be read at one sign-in (a slow or failing read) is read again at the next sign-in or
reload; nothing on the screen says it was skipped. The tip for the Teams & Staff tab is in
`db/RUN-ME-2026-11-11-hint-zone-beside-name.sql`, to be run once by hand.

## Part 47 — No zone is said, not left blank

> "am not seeing my zone yet"

Said by the owner an hour after Part 46 went out, looking at their own name: an ADMIN code over all teams, named on no team of
Teams & Staff. By the rule there was no zone to show, so the name stood alone -- and a name with nothing beside it could not be
told from a feature that had not arrived, or from a fault. Silence read as failure.

So the third step of the rule is now said (BUILD 2026-11-11-b; `zoneAnswer` in `api/_lib/zone.js`, the words are the page's):

- **`ALL ZONES`** -- a code that holds every team and is named on none. It is how the advance desk has always read such a code:
  all teams, every zone.
- **`NO ZONE SET`** -- the person's teams are known and none of them carries a zone on Teams & Staff (a team code on such a team,
  a code whose team list has empty ZONE cells, somebody named only on such teams). It is the admin's cue to fill the ZONE column.
- **The bare name** only when the zone could not be read: a read that failed or ran out of its second and a half, a database
  without the zone column, a server older than the page. Never "ALL ZONES" of a book that did not answer.

A zone that is known is shown exactly as in Part 46. It costs nothing more: the same one read, at sign-in only.

**To see one zone beside a name that holds every team**, that name has to stand on that zone's teams on Teams & Staff, in any
role column, spelt as the access code spells it. The live book files its zones under their own names (the staff changes of Part 48
came from a GMO as "LAKE ZONE" and the teams turned out to be filed under another name), so what is written beside a name is
Teams & Staff's word for the zone, not the one used in conversation.

**Offered, not built:** a Zone box on an access code, to set a person's zone directly whatever Teams & Staff says.

## Part 48 — Staff changes confirmed by a GMO are answered with SQL

> "Ill be comming with staff db updates simce GMOs comfirm of changes in my whatsapp group"
>
> "dont correct names using the gmo data i bring unless its new staff"
>
> "so provide sql to add staff as we always did"

GMOs confirm their team changes in the owner's WhatsApp group: team by team, who is to be removed and who is to be added. The owner
brings each list to the chat and gets back a script for the SQL editor. Two templates hold it, with no name in them (the repository
is public; the filled copy goes to the owner and nowhere else):

- **`db/TEMPLATE-staff-changes-from-gmo.sql`** -- the list. One row comes back for each name, saying what was done.
  - A name is matched **exactly** (capitals, single spaces) and is **never re-spelt**. That is the owner's order: a GMO's spelling
    is taken for a new staff only.
  - **REMOVE** switches the staff to Inactive, as the HR staff data tab does: off every request list, history kept, nothing
    deleted. Only when exactly one staff who is not already Inactive carries that name; none, or two, and nothing is changed and
    the row shows the nearest names.
  - **ADD**, nobody of that name: a new row as the GMO wrote it, Active, the next staff ID in the usual form (initials / number /
    year, past every number in use), role `FIELD OFFICER - <team>`, and the zone **of that team on Teams & Staff**. If the zone
    already holds a name like it, the row says "look".
  - **ADD**, exactly one of that name already: a move between teams or a return. Switched on; the team part of their
    `ROLE - TEAM` and their zone follow the new team; the role word is kept. A role with no team part is left alone.
  - A name listed to remove and to add is a move: only the ADD acts. A name listed twice acts once. Running it again changes
    nothing.
- **`db/TEMPLATE-staff-changes-by-id.sql`** -- the ones that came back NOT FOUND, once the right person is clear: switched to
  Inactive by staff ID, and only if the ID still carries the name written beside it. The registry's spelling stays.

**The first list (11 November 2026, eleven names, one zone):** eight were done at the first run. Three removals came back NOT
FOUND, each one letter away from the registry's spelling, and were settled by ID in a second script. The zone the new staff got
was the one their teams are filed under on Teams & Staff, which was not the name the GMO used. One of the people removed was a
team's manager, not a field officer: the script says the role of whoever it switches off, and that is where it showed.

**What it costs:** the staff registry (read and written) and the teams table (read). Two small tables. Nothing on `/api/upload`,
nothing on `/api/call`, nothing a screen waits on.

**Not done by the scripts.** The role columns of Teams & Staff: a manager who left is still named there until it is changed on
that tab. A new staff who is not a field officer: the role is set on the HR staff data tab. HOPE Calls accounts are not touched.
The form of the list script in the repository (moves, returns, names listed twice) was run on a test database with the
repository's schema; the simpler form of it is the one that ran on the live book. `test/staff-template.test.mjs` fails if a filled
copy is ever committed.

## Part 49 — The second round of staff changes: transfers, new staff with their details, and a name spelt differently

The same evening the lists came from eight directions at once, pasted from the owner's WhatsApp group: forty people. They were not
"remove" and "add" any more. A GMO wrote who was *transferred, and to which team as what*; managers sent *new officers with their
phone, account, NIDA, TIN and NSSF*; one GMO listed officers he *could not see* on his list; one wrote of a man "I do not know him".
And the first round (Part 48) had already shown the other thing: three of five names differed from the registry by one letter.

`db/TEMPLATE-staff-changes-from-gmo.sql` is now the script that answered that round. One row of its list for each person:

- **OFF** -- left, terminated, deactivated: Inactive, nothing deleted.
- **MOVE** -- transferred: the role word (kept if the message gives none) and the team follow the transfer; the zone becomes the
  zone of the new team on Teams & Staff, and is left as it was when that team has none.
- **PLACE** -- "I cannot see them": if the registry holds them they are moved to the team and only their *empty* details are filled
  in; if it does not, they are added.
- **NEW** -- added with the details sent, with the next staff ID. Not added when the registry already holds the name or the
  account, or when no zone can be found: a staff with no zone is on nobody's list.
- **ASK** -- nothing changed; the row says what is missing (the man nobody knows; a new employee sent with no team, role or zone).

**Who is meant** is decided in this order, and only when exactly ONE staff fits (the only live one, else the only one): the same
name; the same bank account; the same phone, together with a word of the name that is the same or one letter apart (a line can
pass to somebody else); the same name but for one letter of one word; the same words where the registry has one name more; the
same name but for one letter in more than one word. The answer says how the person was found and shows the registry's own
spelling, **which is never changed** -- that is the owner's order, and it is why a looser match is safe to act on: it only ever
finds, it never rewrites. For a NEW staff only the name, the account and the phone are compared.

**The zone** is the zone of the person's team on Teams & Staff; else the sender's own word for it, used only when a zone of that
name is already filed (a typed zone is never invented); else the zone of the staff already on that team; else the zone their
colleagues on the same list carry. A moved staff whose new team has no zone anywhere keeps the old zone and the row says so.
*(Part 52 took out "the staff already on that team": a staff who kept an old zone was handing it on.)*

**What the live book answered.** Of the forty, thirty-six were done at the first run: sixteen switched off (one already was),
nine moved, eleven added. Five were found although the sender had spelt them differently, each one letter apart. Two were not
found at all, and two were questions for the owner. Three of the nine moved went to teams that have no zone on Teams & Staff, so
they stayed filed under the zone they had left: a second script of five rows was handed over for those and for the two not found,
to be run again once the zones of those teams are filled in. That is the cue the round left behind: **a team with an empty ZONE
on Teams & Staff cannot receive anybody.**

**What it costs.** The staff registry and the teams table. The first form of the matching took five seconds on a registry of five
thousand; a script that slow is not handed to the owner (Part 47's neighbour, the dig that timed out, was the lesson of the same
day). It now compares whole words before it compares letters: a list of forty takes about a second on such a registry.

**Not done.** The role columns of Teams & Staff are not touched: a manager who moved is still named on the old team there. The
second round's script was run on a test database with the repository's schema and a made-up registry before it was handed over;
its answer from the live book is in no file of the repository.

## Part 50 — A team's zone is its GMO's

> "If an officer has team - zone is automatic of the GMO's"
> "to the respective team's gmo"
> "So even manager - must have gmo of one of his team and auto match gmo and zone" — the owner, 11 November 2026

Part 49 ended on a cue: *a team with an empty ZONE on Teams & Staff cannot receive anybody*, and the owner was asked to fill the
ZONE of three teams so that three people who had been moved to them could be filed there. The owner's answer was not three cells.
It was the rule those cells were standing in for. A zone is the teams under one GMO; the staff form has always labelled the box
"ZONE (under GMO)". So a team with a GMO is in a zone whether or not anybody typed it.

**The rule, in one place** (`teamsZoned` in `api/_lib/zone.js`). A team's zone is what is typed in its own ZONE cell. Where that
cell is empty, it is the zone **most of its GMO's other teams carry**; a tie goes to the first in A-to-Z order, so the answer never
depends on the order of the rows. *(Part 52 changed this the next day: the GMO's zone is read only when all of that GMO's teams
carry the same one. A GMO over several zones gives none.)* The GMO is matched from one team to the next trimmed, in capitals, with runs of blanks as one.
What is typed in a team's own cell always stands, even against its GMO's other teams. A team with no GMO named, or whose GMO has
no team that carries a zone, still has none, and is still said to have none. Nothing is written back: the ZONE cell stays empty
for whoever edits Teams & Staff, and the rule is read every time.

**A dash is not a person, and not a zone.** The two cells are read through the repository's one definition of "nobody named"
(`nameOrNull` in `parse.js`: blank, dashes, N/A, NONE, NIL, HAKUNA, a bare 0), with the two ways a sheet says it in words ("NO
GMO", "(unassigned)"). Without that, every team whose GMO cell holds a dash is "one GMO's teams", and a team with no zone takes
a stranger's: its code would then list that zone's staff on the advance desk. A ZONE cell that holds only a dash is an empty
cell: the team takes its GMO's zone, or reads NO ZONE SET, and never sits in a zone called "-". A blank is whatever JavaScript
calls one, so a no-break space or a tab pasted in from Excel or WhatsApp does not make two GMOs of one.

**Everything that reads a team's zone reads it through that rule.**

- *The name line* (Part 46). An officer on such a team, signed in with the team's code, reads the team with its GMO's zone beside
  it and no longer NO ZONE SET (Part 47). A manager named on several teams is in the zone of the GMO of each; one is enough.
- *The advance desk* (`advZones_`). The team's code lists the staff of its GMO's zone on the request tab, so its officers find
  their own names; its requests reach the desk of that zone; and the team is no longer named on every advance screen as a team
  without a zone. A team with neither a ZONE nor a GMO's zone is named as before.
- *The staff-change scripts* (`db/TEMPLATE-staff-changes-from-gmo.sql`, steps `tm`, `gz`, `tz`). A moved or new staff takes the
  zone of their team by the same rule, read off Teams & Staff and nowhere else. The script then has last resorts of its own, used
  only where Teams & Staff cannot say and each one said on the row: the one zone of the teams whose names begin with the team's
  name; the sender's word, if a zone of that name is already filed; the zone of the staff already on that team; for a new staff,
  their colleagues'. A manager over several teams takes the first of them that has a zone; of two teams whose names differ only
  by a mark or by capitals, the one written as the list wrote it. *(Part 52 took out "the staff already on that team".)*

**The answer says where a zone came from.** A row whose zone is not the team's own cell names the GMO it was read from. When that
GMO's teams carry more than one zone the row lists them with their counts, because "most of them" is then a judgement somebody
may want to overrule by typing the ZONE on the team. When no zone could be found the row says which thing is missing: no team of
that name, no GMO named on the team, or a GMO none of whose teams has a zone.

**Somebody who is not found is answered name by name.** For each of the person's names, the row says who in the whole registry
carries it (the same word, or one letter apart): the names nobody carries first, and among the carriers the sender's own zone
first, three shown and the rest counted. A surname on nobody says the person was never registered, whatever a first name that
hundreds carry may show. Before, the eight nearest names came in A-to-Z order from the whole registry, and for one officer all
eight shared nothing with him but a first name. When the answer does show the person (two names the same, the third spelt
another way) the next script asks for them in the registry's own spelling, which is how a transfer was settled without
re-spelling anybody.

**One rule, written twice, checked against itself.** The portal's rule is JavaScript and the script's is SQL, and node cannot run
SQL in `npm test`. `tools/db-checks/gmo-zone-parity.mjs` is the check that can: it draws random Teams & Staff tables (GMO names
in mixed case and with stray spaces, empty cells, GMOs over two zones, ties, cells that name nobody, blanks pasted from Excel),
reads each one both ways on a PostgreSQL and fails on the first difference. It was itself checked by breaking the rule six ways
(the tie, the spaces, the dash, the words, the own cell, "most"): each was caught. Its first form caught only one, because its
random numbers were nearly always even and half of its cases were never drawn: it now refuses to pass when too few of the hard
cases come up. `test/staff-template.test.mjs` holds the text of the rule in the template; `test/zone.test.mjs` and
`test/portal.test.mjs` hold the portal's side.

**What the review found, and what was done about it.** Three reviewers read the change before it was merged, each finding then
put to a second reader whose job was to refute it. Nine findings, none refuted, eight fixed in the same change:

- *A dash in the GMO cell was a GMO called "-"* (above). The check that the two writings agree had passed, because both were
  wrong alike: agreement between two copies is not correctness.
- *The script read a GMO's zone off the GMO's own row in the registry when none of their teams had one.* A GMO moved by the same
  list, or by an earlier one, took with him every officer later sent to the teams that still named him, and a second run did not
  agree with the first. The step is gone: Teams & Staff is the only place a GMO's zone is read from, and when it has none the
  row says whose teams need a ZONE typed on one of them.
- *The script's blank was a space; the portal's is also a no-break space, a tab, a line break.* The same table gave a team one
  zone in the portal and another in the script. The script now spells the blanks out.
- *Two teams whose names differ only by a mark* were settled by whichever row the database met first. Now by the name as
  written, then the typed ZONE, then A to Z.
- *A zone cell holding only a dash or a tab answered for every row of a list that gave no word for its zone* (found while
  testing the above, older than this change). A cell with no letter or digit in it is not a zone's name.
- *The test that the rows given are not changed could not fail*: it took its picture of a shared fixture after an earlier test
  had already passed it through the rule. The fixture is frozen now, so a write into a row throws whichever test runs first.
- *This Part described the name-by-name answer before the template had it.* The template has it.
- *The reworded tip did not reach a book where the first tip script had been run.* The second tip script rewords it there.

The ninth is under "Not done": the annual deck.

**What the live book answered.** The five rows left by Part 49 were run with the rule. One of the three was filed under his team's
GMO's zone with nothing typed anywhere. One had already been filed by the one zone of the teams whose names begin with his
team's. The transfer nobody could find had been found one letter apart in more than one word. Two stayed open: a manager whose
new team has neither a ZONE nor a GMO whose teams carry one (the owner names the GMO on that team, or types its ZONE, and the
same row files him), and an officer who left and is in the registry under no name, account or phone the list gave. The next
list (one zone, five people) was answered by the same script the same evening: three were done at the first run, one was
under a first name the list spelt differently, and one is under no name like his. The name-by-name answer then settled both
kinds at its first run on the live book. The transfer was moved once he was asked for in the registry's own spelling. And the
two who had left turned out not to be in the registry at all: for each, the row read *surname: nobody*, across every zone,
while their first names were on a dozen people. There was nothing to switch off, which no list of nearest names had been able
to say.

**What it costs.** No read was added anywhere. The sign-in's one read of the teams table already carried the GMO column, and the
advance desk already had the teams (the memoised read every screen shares; the rule copies the rows it changes and never writes
into that read). Nothing on `/api/upload`, nothing on `/api/call`. For the script: it is one long statement, and a PostgreSQL
that compiles long queries (JIT) spent **eight seconds compiling it and a fifth of a second running it** on the test machine. The
script now starts with `set local jit = off`, which ends with the script like its two time limits. Whether the live database
compiles is not known, since a chat cannot see it; the line makes it not matter.

**Not done.** *The annual deck's zone map* still colours a team by the ZONE typed on it, counts a team with an empty cell under
"no zone set in Teams & Staff", and names its GMO on the "No zone set" row, although the name line and the advance desk now put
that team in its GMO's zone. Following the rule there moves teams between the zones of a slide and changes each zone's General
%: figures on a deck are the owner's to change, so it is offered, not done. The staff form in the portal still asks for the zone
to be picked from its list; it does not fill it from the team in the role. A staff already filed under a zone is not re-filed by
the portal when Teams & Staff changes: a person moves when a list asks and a script is run. HOPE Calls shows no zone. No page
changed, so `BUILD` stays where it was. The scripts were run on a test PostgreSQL holding a made-up registry of live size; their
answers from the live book are in no file of the repository.

## Part 51 — The copy answered instead of the book

> "changes am making in https://recovery-app.sync-book.net/dashboard ... aint reflecting into
> https://hope-pmo-v2-ten.vercel.app/dashboard" — the owner, 11 November 2026

Part 44 said it would happen: *work done on our own server stays in the copy; it is on no report, on no other phone and in no
commission, and neither site says so.* The same evening it did. The owner had been asked to name a GMO on a team in Teams &
Staff, did it at the new address, and pasted the two lists side by side when the old address showed nothing.

**What the two lists showed.** Ninety-two teams on each, and twenty-six cells that differed. They did not all point the same
way. Eleven were the owner's edits of that evening and existed only on the new server: an OPM and a GMO named on teams that had
none, a name beside a number, a phone number corrected. Fifteen were the other way round: places where the real book had moved
on since the copy was taken, among them a GMO now written in full on seven teams, a manager who had changed, and the code of
one team. A copy is not behind the book or ahead of it; after a day of use it is simply a different book.

**What was done.** No code changed. Two scripts were handed over, for the owner to run in the SQL editor of the real book
(both were run the next morning: the six teams were filled, and the manager whose team had no GMO was filed under that GMO's
zone with no ZONE typed anywhere; the officer of Part 52 still waits on his team's ZONE):

- one that fills the eleven cells, **only where the real book's cell is empty**, each name **copied from a team of the real book
  that already carries it**. The copying matters more than it looks: the GMO of the southern teams is written in full on the
  real book and by one name on the copy, and a team given the short spelling would have had a GMO nobody else has, and so no
  zone (Part 50);
- one of two rows for the two staff whose team had no zone.

And the owner was told three things. Work only at the old address until the server reads the real database (the two lines for
whoever runs the server are in `CHAT.md` section 5). Anything else done at the new address that day, an upload, an approval, is
in the copy too. And a team code changed on the copy locks nobody out: the handsets sign in against the real book.

**What it leaves for the move.** The page at the new address gives no sign that it is not the book. The first thing to build,
when both sites read one book, was already the in-page forwarding; until then the plainest protection is the one this Part
records: the owner knows, and the next chat is told (`CHAT.md` section 5). One more measurement came with the deploys of that
evening: asked for its version eighty-four times while it restarted, the own server left one request unanswered. Part 44 had
measured none in four hundred and eighty-four; the restart gap is real, and small.

## Part 52 — The rule does not guess: a GMO over several zones gives no zone

> "If an officer has team - zone is automatic of the GMO's" — the owner, 11 November 2026

Part 50 took a team with no ZONE of its own into *the zone most of its GMO's other teams carry, a tie going to the first in
A-to-Z order*. That was written for the GMO the owner had in mind: one person, one zone. The lists of Part 51 showed the other
kind. One GMO is named on teams of **four** zones, two teams in each of two of them and one in each of the others: somebody
standing in wherever a zone's own GMO does not hold a team. For the one team of his with no ZONE, "most" was a tie, the tie
went to the alphabet, and an officer moved to that team was filed under a zone nobody had chosen. The row said the zone was
its GMO's, which was true, and the name line would have said the same to every officer of that team.

**The rule now.** A GMO's zone is read only when **all** of that GMO's teams that carry a zone carry the **same** one. A GMO
named on teams of more than one zone has no one zone to give, and the rule does not choose among them. The team then has no
zone, exactly as a team with no GMO has none: its people read NO ZONE SET (Part 47), the advance desk names it as a team
without a zone, and the staff script leaves a moved staff under the zone they had and lists what it found: *its GMO is named
on teams of more than one zone (two here, two there, one, one), so none is taken*. One ZONE typed on the team settles it, as it
always did. Both writings of the rule changed together, `teamsZoned` in `api/_lib/zone.js` and the `gz` step of the template,
and `tools/db-checks/gmo-zone-parity.mjs` read six hundred random tables both ways without a difference, and failed, as it
must, when the portal's side was made to take one of a GMO's two zones.

**Why not "most", without the tie.** Because five teams against one is still a choice somebody else made for the sixth. The
cost of not choosing is one cell typed once; the cost of choosing wrongly is an officer on the wrong list, with a row that says
the zone was read off Teams & Staff. The first form of this rule was read by three reviewers and nine skeptics, and none of
them objected to "most": it took the owner's own list to show the GMO it could not serve.

**The staff already on a team are no longer asked for its zone.** Where Teams & Staff could not say, the script used to take
the zone of the staff already filed on that team. Read before the merge, that turned out to undo the rule in the one place it
was written for. A staff moved to a team with no zone keeps the zone they came from; the next person sent there was then filed
under that left-over zone, and for the team whose GMO is over four zones the "staff already there" was the officer the tie had
filed. The same request was refused on one list and granted on the next. The step is gone. When Teams & Staff cannot say, the
script takes only what the **row itself** says: the sender's word for a zone that is already filed, or, for a new staff, the
one zone of the colleagues the row names (one zone: colleagues who carry different zones decide nothing). Otherwise a moved
staff keeps the zone they had, a new staff is not added, and nothing in the script takes "the most common" of anything.

**The row says why, and what settles it.** A new officer for whom no zone can be found is not added (a staff with no zone is
on nobody's list). The row used to say only that. It now says which thing is missing, and the remedy that fits it: give the
team on the row; write the team as Teams & Staff names it; name the GMO on the team; or type the ZONE on the team.

**One zone, however its cells were spaced.** A GMO's name was compared with runs of blanks as one; a zone only trimmed. Under
a rule that wants all of a GMO's teams in the same zone that difference bites: a zone typed with two spaces on one team made
its GMO "a GMO over two zones". A zone is now compared exactly as a GMO's name is, in both writings.

**Read before the merge.** Two reviewers, each finding put to a second reader: eight findings, none refuted, all fixed here.
Besides the three above: a PLACE that found its person and took no zone from anybody said the zone was "taken from colleagues
on the same list" (the note now tests where the zone came from); the advice on a row not added was the same for every reason;
`CHAT.md` said in one section that the owner's scripts had carried the edits into the real book and in two others that their
answers were not back; and it described the tip script as it was before this change.

**What it costs.** No read was added and no page changed, so `BUILD` stays where it was. On the live list one team is touched:
the one whose GMO is over four zones reads NO ZONE SET again, as it did until Part 50, until its ZONE is typed. Every team
whose GMO has one zone reads exactly what it read before.

**Not done.** The officer who was filed by the tie is not re-filed by this change: a row of a staff script does that once the
team's ZONE is typed, and that script was handed over (Part 51). The two scripts handed over on 11 November carry the engine
as it was that evening; both do what their headings say on the rows they hold, and a later list is answered with the template
as it is now. The annual deck's zone map still reads the typed cell alone (Part 50).

## Part 53 — A whole staff form, and head-office people

> "Zone pmo hq" — the owner, 12 November 2026, above three staff forms

Three forms came with two words above them. Each was the form a person fills in when they start: NIDA, bank and account, NSSF,
TIN, name, birth date, marital status, a parent with a number, a next of kin with a number, the day they started, where they
live, their phone, their e-mail address. The staff script (Parts 48 to 52) stored six of those. The registry has had a box for
most of the rest since it was the DATABASE tab of the advance sheet (`db/RUN-ME-044-salary-advance.sql`): PHONE 2, Residence,
REG-DATE, and two guarantors, each with a number. The staff form in the portal fills them (`advStaffSave`); the script did not.

**The rest of a form travels in a second list.** `more(n, phone2, residence, started, birth, kin1, kin1_phone, kin2,
kin2_phone)`: one row for each person who came with a form, under that person's number in the first list. A list with no forms
is written exactly as before, and the second list stays as its one row of nulls. A NEW staff is added with all of it, and the
day they started is their REG-DATE (empty: the day the script is run, as it always was). A PLACE, a staff the registry already
holds, has only their EMPTY boxes filled, the rule it always had for the first six. MOVE, OFF and ASK never read it.

**The two people a form names** go into the registry's two guarantor boxes (JINA LA MDHAMINI, JINA LA MDHAMINI 2) with their
numbers, written with who they are: `NAME (MAMA)`. The registry has no other place for a parent or a next of kin, and the form
asks for exactly two people. On a staff already there, a box that names somebody is left alone, and so is the number beside
it: one person's number is never written beside another person's name.

**The birth date is the NIDA's**, as the staff form reads it (`nidaBirth(nida) || the date typed`). The date written on a form
counts only when the NIDA gives none; when the two differ the row says so and keeps the NIDA's. On a staff already there a
date is written only where the registry has none and the NIDA beside it will be the row's own. A NIDA whose first digits are
no day of the calendar (the 31st of a month of thirty days) used to stop the whole script with an error, and the owner would
have seen the error and none of the list. It now gives no date.

**An account is stored as the staff form stores one** (`accountCell`): its digits, leading zeros kept, when it is digits,
blanks, dots and dashes; else the text as it is. A form wrote an account in three groups, and it would have gone into the
column payroll reads with its blanks in it.

**Head-office people have no team.** The registry files them by department, the way the sheet did: the zone is `HQ - PMO`,
`HQ - CREDIT`, `HQ - CUSTOMER SERVICE` or `MANAGEMENT` (`ADV_DEPT_PREFIXES` in `portal-core.js`, under "A department is not a
zone"), and the request tab offers such a name to the holders of its ROLE, whatever their teams (`advRoleSame_`: two roles are
the same when the words of one open the other). So a head-office row gives no team; its zone is the department **as the
registry already files it** (the owner's "pmo hq" is the registry's `HQ - PMO`); and its role is written **as Roles & access
spells it**, never left to the script's default, which is Field Officer and would put the person on nobody's list. The forms
gave no role. Each of the three was written with the desk Teams & Staff names them on, and the owner was told which word was
written for whom and where to change it.

**What a row now says, and does not act on.**

1. *The sender's word for the zone is no filed zone.* Nobody is added, as before; the row now says that the word is not filed
   and lists the filed zones that share a word with it. Nothing is chosen: the word still counts only as the name of a zone
   already filed (Part 52: a rule that has to choose is a guess).
2. *A NIDA that is not twenty digits* is kept as it was sent, and the row says how many it has.
3. *A form's birth date that is not its NIDA's*: both are shown, the NIDA's is kept.
4. *A number written twice in the details list*: the first is read, and the row says so.
5. *Somebody with no team who was added or changed*: the roles the others filed in that zone carry, with how many carry each.
   A role written another way is then seen on the first answer, not on the day the person cannot find their name.

**What it costs.** Nothing in the portal or the call app: no code that runs for a user changed and no page did, so `BUILD` and
`CALL_BUILD` stay where they were. The script is run by hand; it reads the same two tables as before, the staff registry and
the teams, and on a registry of 5,000 it still answers in under a second.

**Checked** on a PostgreSQL holding the real team list and a made-up registry of 5,000. Nineteen rows written to go wrong in
every way the list above names: a staff half filled in, one filled in whole, a NIDA of 31 February with and without a typed
date, a number twice in the details list, a zone word spelt three ways, an account with letters, a MOVE and an OFF that carry
details they must not read. The second run changed nothing in any of them. The filled copy for the three was run three ways:
the zone filed and nobody there; one of the three already there under a shorter name and the same phone; no head-office zone
filed at all. `test/staff-template.test.mjs` holds the promises by their text, in two new tests.

**Not stored, and said to the owner:** a marital status and an e-mail address. The registry has no box for either.

**Not done.** The role of a head-office person is not checked against Roles & access: the row shows what their colleagues
carry, and a second writing of `advRoleSame_` in SQL would be one rule in two places. The portal's staff form is as it was.

**The lists of the same day** (no code). A list of twenty-seven: the staff of three teams of one zone as their GMO has them,
the staff of two southern teams that had waited for a GMO, and corrections for four more. The people of the three teams were
asked as MOVE, never added from a list that carries names only (a name the registry spells another way would have become a
second person). Ten were found, **every one of them filed under a zone their team does not carry on Teams & Staff**, which is
why none of them could find their name on their team's code; each now sits in their team's zone. Nine were added, two were
switched off. Five were left: one was in the registry one transposed letter away and was asked for again in the registry's
own spelling; three were in it under no spelling (their surnames on nobody, in any zone) and were added with name, team and
zone only; and one, sent as new, was already there as a manager under another zone, and was asked again as PLACE, which moved
him and wrote the phone and account the list gave only where the registry had none. One line of the list was cut off in the
paste and is still owed.

## Part 54 — A real defaulter is never silently absent from a leader's list

> "some staff like managers have somedays not getting expected defaulters, something not
> reality, please re-crosscheck expected defaulters being efficiently produced to everyone
> from teams to leaders" — the owner, 12 November 2026

Not only managers. The three recycling roles — GMO, MANAGER, BIKE — read a customer's turn to
call them off the customer's own disbursement date: two days a week, on a clock, so the same
officer is not phoning the same person every week forever (Parts naming the rotation: the
Exp.Def Report, #622 to #662). A customer whose disbursement date is missing, or in a shape
`Date.parse` cannot read, has no such clock: their day-of-week came back as a number no real
weekday ever equals, so the filter that shows "who is due today" showed them on **no** day, to
**any** leader — not an empty screen (the one case already guarded against, since the whole
book stands in when every customer in a read shares the fault), but one real customer quietly
missing from an otherwise normal, populated list, every day, for as long as their date stayed
unreadable. A manager checking a full board would never notice one customer short; a GMO
checking their own phone would.

**The fix is the same promise `expectedDefaulters` already keeps** (portal-core.js, an older
screen): a customer with no cycle day is never dropped, never made to wait for a day that will
never come. On a single day's reading — the leader's own phone list, and the management
report's daily board — an undated customer is now shown alongside their dated colleagues,
every day, not only when they are the only one. The report's phone screen also says, in the
same diagnostic line that already answers "why is this empty", how many of today's rows carry
no date at all.

**The week needed care the day's reading did not.** "The week is the sum of its days" (Part …,
#656: each day's own figures, added) depends on each customer appearing only on the day(s)
their own cycle names — an undated customer has none, so simply keeping them on every daily
reading would have counted their arrears once for every day of the week instead of once for
the week. The week's own per-day loop now keeps the old, exact, onToday-only filtering it
always had (so a dated customer's weekly figures are unchanged, proved by a direct before/after
diff on the real function), and separately tracks every undated customer it sees across the
week, adding each one ONCE, after the loop, with the figures of the most recent day their book
still carried them.

**Read before it shipped, and worth saying how.** One reviewer, run against a real PostgreSQL
and the real functions, found that the week's once-per-customer rescue above was keyed the same
way `cells` itself is keyed — role, leader and customer together — on the assumption that an
undated customer's role stays put for the week. It does not: `assignFor` reads `days_elapsed`,
nothing to do with whether a disbursement date can be read, so an undated customer crosses the
same two-day rotation boundary as everyone else and can go from BIKE to MANAGER (or any pair)
while remaining undated the whole time. Each leader they passed through got its own rescue
entry, so one real customer could be counted on two leaders' boards for one week — the report's
own grand total (which counts a customer once, by reference) disagreeing with its own section
rows (which did not). Proved with a customer whose `days_elapsed` crosses that boundary midweek,
counted on both boards for the same five days. Fixed by keying the rescue on the customer's
reference alone, carrying whichever role and leader applied on the last day they were seen —
one row, however many leaders they drifted across while undated — and leaving alone anyone who
reached a real cycle day this week under any role, so they are never rescued a second time once
dated.

**Checked.** A fixture of three customers in one leader's book — two disbursed on a Tuesday (the
usual Tue/Fri cycle), one with no disbursement date at all — proves: the daily board and the
leader's own phone screen both now carry all three; the week counts the undated one exactly
once, on its last measured day, while the two dated ones keep exactly the figures the existing
"sum of its days" test already proves for everyone else; summing five separate daily reads for
that leader (the naive way to check a week) gives a different, inflated number for the undated
customer specifically — proof that the week's own one-time rescue, not daily summation, is what
has to carry them. A second fixture reproduces the reviewer's own finding directly (one real
customer, two leaders inside one week) and shows it gone: counted once, under the leader of its
last day. Two more checks, run directly against the real functions rather than committed as
tests: a customer who disappears from the deck for two days and reappears is still rescued from
whichever day it was last actually seen; a customer who starts undated and becomes dated partway
through the week, landing on a real cycle day, is counted through that day alone, never also
rescued for an earlier undated one. The existing "all customers in this leader's book are
undated" rescue (`noCycleDates`) still stands once there are no dated colleagues to be dropped
behind. `npm test`: 1,491 pass.

**What it costs.** Nothing on `/api/upload` or `/api/call`; the two reads this touches
(`teams`, `defaulter_snapshots`) are the same reads the report already made. No page changed —
only what a leader's existing screens already show — so `BUILD` and `CALL_BUILD` stay as they
were.

**Not done.** Nothing says HOW a defaulter came to have no readable disbursement date in the
first place (a column renamed in an export, a date spelt a way the importer does not expect):
that is an upload-quality question, not this report's to answer, and the owner was told to say
if a particular team's uploads are the ones missing it.

## Part 55 — The disbursement sheet, and the dates it left empty

> "I do not upload disbursment sheet, remove it in uploads. I only upload approved/processed,
> use it everywhere necessary for loan approvals and disb dates" — the owner, 12 November 2026

Two of the Upload page's eight loan-pipeline stages — Pending Disbursement, Disbursed Loans —
are no longer offered, and the server refuses them if asked for directly: nobody here ever ran
either, confirmed with the owner (the in-app Disburse button that would otherwise reach the
same stage is also never used — every loan this company works simply sits at Approved). Two
things on the Upload page were reading nothing because of it; one, read before this shipped,
was a bigger gap than the sheet itself.

**The small one first.** `disb_date` on a loan is set only by the Disbursed Loans upload or the
Disburse button, both unused, so it is empty on every row, forever. Nothing elsewhere in the
portal needed fixing for this — `SALES_STAGES` (the one definition of "this is a sale", read
everywhere a sale is counted) already starts at `approved`, so sales figures were never missing
it. The one place still gated on `disb_date` alone was the Audit Report panel's PAR > 30
denominator (the cohort of loans disbursed in a chosen month, against the loans table): a book
with no `disb_date` anywhere gave it nothing to total, so `disbursedLoans` and `disbursedTotal`
came back zero and null every month, and `par30` — the auditor's own headline ratio — read
blank beside a real number of defaulters. **This is the whole-portfolio PAR that has stood on
the waiting list since the 11th,** not only waiting on a historic upload: the figure the owner
was told to wait for would have stayed blank even once uploaded, because the column it was
read from is one this book never fills.

**The fix.** A loan counts here the same way it counts everywhere else — `SALES_STAGES`, not
`disbursed` alone — and its own date is `disb_date` where a row genuinely carries one, else
`approved_date`, the same fallback `loanTotalsByTeam` already uses a few lines above in this
same file.

**Read before it shipped.** The first cut fetched by stage with no date floor at all — "a range
filter on one column can only drop rows", taken past the point that held. A floor on either
column alone is not the same as none: a reviewer, running the real code on a synthetic book of
years of sales history, showed the floorless fetch pulled every sale this book had ever made,
in full, and did it again on every distinct month viewed, since the report's own cache is keyed
by month while that read was not — the Audit Report's prev/next-month arrows alone would have
re-read the whole history four times over in one minute. Fixed by a floor on EITHER date, at
`prevStart`: nothing that can belong to either cohort month is older than that on at least one
of its two dates, so nothing is lost, and a two-month-old book now costs what the function's own
long-standing comment already promised — one read of two months' loans, not the whole of it.

**Checked** against the exact fixture the existing audit-report test already proves correct
(disb_date set on every row, nothing changed there — isolated from `tables()`'s own stray
loans, which would otherwise have joined the count once SALES_STAGES started reading them too),
and a second fixture built the other way: three approved-only loans across two months, one
rejected loan that must not count, one loan with a real `disb_date` a month after its
`approved_date` (dated by the real one, never picked up twice), and one loan a year and a half
outside the floor, proving it stays outside. Separately, against a synthetic book of 6,000
loans across 2.5 years: the bounded fetch returns well under a tenth of the book for one
month's audit, not the floorless whole of it. `npm test`: 1,494 pass.

**What it costs.** Nothing on `/api/upload` or `/api/call`. The audit report's own read of the
loans table is no larger than `par`'s all-time total already makes of it; no page changed for
an ordinary user, so `BUILD` moved only for the Upload page's own change below, not for this.

**Not done.** The defaulter deck's own `disb_date` column — the rotation's cycle day (Part 54)
and the PAR-by-year breakdown on this same `par` tab — is a different column on a different
upload, fed by the daily current-book file rather than the loans-stage pipeline, and this
change does not touch it: a defaulter row with no readable disbursement date there is still
read exactly as Part 54 left it.

## Part 56 — Two loan-pipeline stages dropped from Upload; defence in depth

The Upload page's loan-stage picker no longer offers Pending Disbursement or Disbursed Loans
(`public/upload.html`); `api/upload.js` refuses the same two stage values outright, named in
one small exported set (`LOAN_UPLOAD_STAGES_REMOVED`) so an old saved link cannot slip one past
the page having changed. The in-app Disburse button (`managerDisburse`, a wholly different code
path) still writes a loan to `disbursed` the one time somebody uses it; this is only about the
upload sheet, and the pipeline's own stage machinery is otherwise untouched. `BUILD
2026-11-12-a`.

## Part 57 — The Exp.Def week was never walked past Friday

> "Expected defaulters goes mon to sunday not mon to fri bro" — the owner, 12 November 2026

A FINISHED past week on the Exp.Def Report, or the card behind a leader's name, counted only
Monday through Friday — never Saturday or Sunday — even though the very same answer's own `to`
field already said Sunday. The cause: `expdfPeriod` (`api/_lib/expdf.js`) pins a past or future
week's "read as of" clock to that week's Friday, mirroring the dashboard's own `asOfWeek`
(`api/_lib/portal-core.js`, untouched here — it is shared by about seventeen other screens
nobody asked to change). That same clock is reused by `expdfWeekCore`, in the same file, as
`todayKey(nowMs)` — the boundary that decides where its own Monday-to-Sunday day-loop stops.
Because the real Sunday is never earlier than that fake Friday, the loop stopped at Friday for
every week that was not the live one: Saturday and Sunday were never measured, never on a day
tab, never in anybody's week total.

**The fix.** `expdfPeriod`'s week branch now pins a non-current week's clock to its own Sunday,
not its Friday. Nothing else changed: the dashboard's `asOfWeek` and the roughly seventeen
screens that read it (applications, recovery-by-credit, call agents and the rest) are
untouched on purpose — a different helper, for a different set of screens, and nobody asked for
those to move. The weekly e-mail is unaffected either way: it always calls `expdfReport` on the
live current week directly, never through a chosen past week.

**Checked**, with a book built so two customers' own secondary cycle days land on a Saturday
and a Sunday with real recovery filed on both: a finished past week now correctly measures and
counts both days, by the right leader, in the week's own total and in the day tabs behind a
leader's card; the live current week (read before Saturday has happened yet) still has no tab
past Friday, exactly as before. `npm test`: 1,495 pass.

**Reviewed** by two independent readers, each re-deriving the cycle-day arithmetic by hand
against the real code rather than trusting the comments, and each re-running the full suite
themselves: neither found anything wrong or left to flag. One confirmed the change cannot
reach `/api/upload` or `/api/call` (upload.js's only portal call is `purgeSuperseded`; call.js
does not import this file at all); the other searched for the same shape of bug — a clock
meant for "read as of" reused as a loop's stopping point — elsewhere in the file and found none
live (two other places, `monthReportCompute_` and `dashboardFullCompute_`, keep their own real
clock aside for exactly this reason already, predating this fix).

**What it costs.** Nothing on `/api/upload` or `/api/call`. No front-end file changed, so
`BUILD` stays `2026-11-12-a`.

**Not done.** Whether the dashboard's own past-week screens (which still read `asOfWeek`,
Friday-anchored) should move to Sunday too is a separate question nobody has asked yet.

## Part 58 — Leave / Holiday requests: the FOMU YA RUHUSA NA LIKIZO sheet, moved in

> "We need to add 2 tabs: Leave / holiday where staff request leaves & holidays, the Leave
> reports – for leaves and holiday reports management ... now as already people can request
> advances – the tunnels and approvals must be the same to advances when people request leaves
> / holidays" — the owner, 12 November 2026

The Google Form staff filled in to ask for leave (`FOMU YA RUHUSA NA LIKIZO`) and the sheet it
fed are in the portal now, the way the salary-advance sheet was moved in before it: two tabs
(**Likizo / Leave & Holiday**, the ask and, for whoever the routing makes an approver, the desk
together, switched by a pill in the one screen; **Leave reports**, for management), one new
table (`leave_requests`, `db/RUN-ME-051-leave-requests.sql`), and **none of the approval tunnel
written a second time**: a leave request carries the same `req_role` / `req_code` / `zone` a
salary-advance request would, so `advRouting_`, `advRouteOf_`, `advDeskOf_`, `advSees_` and
`advHolds_` — the one rule for "who approves whose request", built for advances — decide a
leave request exactly the way they decide an advance, with no second copy of that rule anywhere.
The `adv` names in that engine are kept rather than renamed: two features now depend on it, and
renaming it to fit one of them is the bigger risk.

**What did not carry over, on purpose, and why:**
- **The calendar-month unit and the finance manager's Finalize / Reopen.** That exists so
  payroll can close a month's advances; leave has no payroll month to close, and nobody asked
  for one. A leave request stays open until it is decided or it **expires** — not by month, but
  by its own start date: a request nobody decided before the day it was meant to start arrives
  and passes reads `Expired`, the same promise advance's own month-expiry makes (not a decision;
  `decided_by`/`decided_at` stay empty; the owner may ask again), just keyed on the one date that
  actually matters for a leave request instead of a calendar page.
- **The one-request-per-month limit.** In its place, a new request is refused only if it
  **overlaps** this same person's own other open (Pending or Approved) request — the Google Form
  had no such check at all, so two overlapping asks could both be sent and nobody would notice
  until the day both showed up. This stops that; it is not a rule the form had that went missing.
- **SIKU ZILIZOBAKI (days remaining) exactly as the sheet computed it.** The sheet's own column J
  was `=26-SUMIF($C:$C,$C2,$E:$E)` — every row under that ID, decided or not, so a Disapproved or
  still-Pending request already cost the balance. Here only **Approved** days are deducted; a
  Pending request's days are shown separately (awaiting a decision), never subtracted twice and
  never silently dropped either.
- **A third, separately-typed day count.** The sheet's own rows show exactly why not to: one
  request's dates span ten months (`2026-02-03` to `2026-12-03`) while its typed day count says
  14 — two numbers that can disagree, with no way to tell which one is right. Here `days` is
  always `end_date − start_date + 1`; there is no second number to disagree with it.
- **A reset of the balance on a new year.** Nothing here resets it, exactly as the sheet's own
  formula never did — one running ledger against `LEAVE_ANNUAL_DAYS` (a Setting, 26 unless
  changed, never hard-coded). **Whether leave should reset each calendar year is the owner's to
  decide, not guessed here** — flagged in the pull request this shipped in.

**What is the same, deliberately:** the name picker (zone and role-scoped, or the customer-
service roster by name, exactly as `advRequestPage` already works it out — no second staff
database); the "only approvers and report-holders see history" rule; the route said before the
ask is sent, naming who will decide it or saying plainly that nobody is set up to; a stray tick
outside a desk's own reach skipped rather than failing the whole batch; the report windowed by
date, by zone, Approved by default, with Excel/CSV like every other board.

**Checked** with a dedicated fixture (`test/leave.test.mjs`): the ask scoped to one zone and
role; the day count from two dates; the overlap guard; the balance (Approved deducted, Pending
shown and not deducted, a Disapproved request costing nothing); the desk routing an officer's
request to their GMO by role, deciding it once, a stray id skipped without failing the rest;
expiry by the request's own start date, written to the row and no longer decidable once expired;
the report's per-row balance and its zone summary; that no calendar-month lock exists for leave
even a month after filing; the missing-table fallback, both for `leave_requests` alone and for
neither migration having been run at all; and the customer-service special case. `npm test`:
1,508 pass.

**What it costs.** Nothing on `/api/upload` or `/api/call` — neither file was touched. A fresh
front-end change: `BUILD 2026-11-12-b`. `advDeskLine_`, previously defined inside
`public/mod/advance.js` alone, moved to the core page (`app.html`): it is now read by two
independently lazy-loaded modules, and a tab opened before the other module has ever loaded
must not come up short a helper.

**Not done.** HR's own advance staff-registry tab (`advstaff`) is reused as-is for the name
picker; no third staff database was added, and none of its fields (bank, account, NIDA,
guarantors) are read or shown here, since leave needs none of them. The report has no Excel
export of its own beyond the standard board/table buttons every screen already carries.

**Found before this shipped, by the owner: "am not seeing the new tabs."** Everything else was
wired -- `NAV`, `MGMT_ORDER`, `MOD_OF`, and `portal-core.js`'s own `FN` / `FN_TAB` -- but
`api/_lib/auth.js`'s `ADMIN_TABS` and `EXTRA_TABS` were not. Those two are the one list that
actually puts a tab on a signed-in person's own `user.tabs`; without them nobody would have
seen either tab, admin included, even after this merged. Fixed in the same change, and a
dedicated test now pins it (`test/pages.test.mjs`, "leave / leaverep: granted like advance's
own tabs"), since neither advance's own four tabs nor the general sidebar test check this --
only `fraud`, `bonusplan` and `checklist` happened to have one already. Worth a general
invariant test one day (every `div:'mgmt'` nav entry present in `ADMIN_TABS`/`EXTRA_TABS`),
but that is a broader change than this one and was not made here.

**Reviewed** by three independent readers before this merged. One real finding, confirmed and
fixed: without RUN-ME-045 (the routing columns), `leaveRequestPage`'s history pane and desk
pill fell back to "holds the `leave` tab" -- copied from advance's own legacy fallback
(`tabs.includes('advappr')`), which works there because `advappr` is a separate tab only
approvers ever hold. Leave's one tab carries the ask and the desk together, so that same
fallback showed every ordinary requester every other requester's pending dates, cover name and
reason (medical, bereavement) on a database that had not yet run RUN-ME-045 -- reproduced with
an ordinary field officer reading a same-zone colleague's sick-leave request. Fixed: without
the routing columns, only admin sees the history pane or the desk pill here; a dedicated test
pins it. Also found and fixed: this file's own migration collided with an existing
`RUN-ME-047` (`#621`, well before this change) -- renumbered to `RUN-ME-051`, the real
next-free number; and the file's own claim of "under 40 lines" was wrong (53) and is now
honest. Two minor, non-blocking UI wordings were also tightened: the live day-count preview's
"remaining after" read as an immediate deduction on submit, when only an Approved request
actually reduces the balance (now "remaining if approved"); and asking for the desk pill by a
hand-edited link while holding none now falls back to the ask screen with its own pill lit, not
a pill bar stuck on "desk". Schema-to-code column names, the migration's idempotency, every
NAV/MGMT_ORDER/MOD_OF/FN/FN_TAB wiring, `advDeskLine_`'s single definition, and the day-count
math client- and server-side were each checked and confirmed correct -- nothing else was
changed. `npm test`: 1,511 pass.

**"always Auto default grant all tabs to admin role. i dont have to go manually grant all new
tabs i create" — the owner, 12 November 2026.** Worth saying plainly: admin's own access to a
screen was never gated on `ADMIN_TABS` to begin with -- `allowed()` in `app.html` and
`tabGate_` in `portal-core.js` both pass anyone whose role reads ADMIN before either ever
consults a tabs list, for every tab there is or ever will be, no step needed. What `ADMIN_TABS`
and `EXTRA_TABS` actually fed, as two separately-typed copies of the same list, was the Roles &
access screen's own checkbox for granting a tab to a *different* role -- and that pair drifting
apart (`leave`/`leaverep` named in one, missed in the other) is exactly what the owner had just
found. `ADMIN_TABS` is now computed as `USER_TABS.concat(EXTRA_TABS)` rather than its own
literal array, so the two cannot drift apart again: a new tab is named once, in `EXTRA_TABS`,
and admin carries it automatically, the one manual step that remains being the one no shared
runtime between `app.html` and `auth.js` can remove.

## Part 59 — Leave becomes three tabs, like advance's own; its tunnel is advance's approvers; its annual allowance moves onto the report

> "so it needs to be 3 tabs to fit perfection like advances so that there is request tab,
> approval tab and reports tab for leaves. sorry" · "Advance approver = Leave approver. i dont
> have to start ressetting those. even pull the nav grantings of advance tabs so that we use
> sql to grant leave tabs to the same tunnels bro" · "so provide sql to read the adv nav tabs
> grantings.. then give one to write grantings for leaves" · "remember we had holiday max days
> pert staff - i think we have this settung at report tab" — the owner, 12 November 2026

Part 58's two tabs (ask and desk together behind a pill) are three now: **`leavereq`** (the
ask), **`leaveappr`** (the desk), **`leaverep`** (the report) -- no fourth, HR-registry tab,
advance's own staff registry (`advstaff`) is still reused as it is. `leaveappr` is hidden from
a holder the routing does not make an approver exactly the way advance's own `advappr` is:
`withoutIdleApprovalTab` (`api/_lib/adv-approver.js`, called from `api/me.js`) took a tab-name
parameter instead of staying hard-coded to `advappr`, so the one rule is read twice, not copied.
With the desk its own tab, `leaveRequestPage`'s history fallback is now exactly
`advRequestPage`'s own (`tabs.includes('leaverep') || (routing.on ? routing.isApprover(user) :
tabs.includes('leaveappr'))`) -- the narrower, combined-tab-only fallback Part 58 added stops
applying, because the condition that made it necessary (one tab serving both an asker and an
approver) no longer holds.

**"Advance approver = Leave approver"** was already true at the ROUTING level the moment Part 58
reused `advRouting_`/`advRouteOf_`/`advDeskOf_` wholesale -- the same `roles.approver_role` /
`access_codes.supervisor` columns decide both. What was still separate was the NAV GRANT: who
even holds `leavereq`/`leaveappr`/`leaverep` at all is its own tabs-array entry, so a role ticked
for `advreq` was not automatically ticked for `leavereq`. `db/RUN-ME-052-leave-tabs-from-advance.sql`
copies the grant: every role or code that holds `advreq`, `advappr` or `advrep` gets the matching
`leavereq`, `leaveappr` or `leaverep` added to the same tabs array, safe to re-run any time after
granting more advance tabs. `db/RUN-ME-053-leave-tabs-from-advance-read-only.sql` is the
read-only preview the owner asked for first -- every role and code with an advance tab, its full
tabs array, and whether each leave tab is already there or would be added; changes nothing,
runnable before and after the write to see the difference. (Renamed from the one-off
`CHECK-leave-tabs-from-advance.sql` it shipped as, to the numbered `RUN-ME-NNN-...-read-only`
form `db/RUN-ME-019-postgres-war-5-read-only.sql` already uses -- caught in review, below -- so
`db/` keeps one naming rule for a script that only reads, not two.)

**The annual allowance (26 days, `LEAVE_ANNUAL_DAYS`)** was a Setting with no screen of its own
since Part 58 -- the owner expected to find it, and change it, on the Leave report. It is there
now: a KPI card states it, and admin alone (`leaveSetAnnualDays`, a whole number, zero or more,
no upper cap -- a company policy above 26 is this company's to set) gets the input and Save
button beside it, wired the same way advance's own `advFinalizeBtn`/`advReopenBtn` are -- one
"wire" function for a module's buttons on any of its tabs, not one per screen.

**Checked**: `test/leave.test.mjs` updated for the three-tab fixtures (an ordinary requester
trusted for nothing, a GMO's own `leaveappr` trusted even without RUN-ME-045, exactly as
advance's `advappr` already is); a new test for the annual-allowance edit, admin-only, read
back the same way everywhere (the report, the ask's own balance) off the one Setting, never two.
`test/pages.test.mjs` gained a dedicated check that `leaveappr`'s idle-approver gate reads
`withoutIdleApprovalTab` rather than a second copy of the rule.

**Reviewed** by two independent readers before this merged, one real finding, confirmed and
fixed: `leaveSetAnnualDays`'s own admin check was `isAdminUser(user)`, which answers "does this
code see the admin screens" -- `resolveTabs` (`api/_lib/auth.js`) gives every AUDITOR/read-only
code the `settings` tab on purpose, precisely so it can -- not "may this code write." The ONE
door's own read-only wall (`WRITE_FNS` in `api/_lib/portal-core.js`, derived from `AUDITED` in
`api/_lib/audit.js`) is what actually stops a view-only code from writing anything, and
`leaveSetAnnualDays` had never been added to `AUDITED`, unlike every one of its direct siblings
(`settingSet`, `settingDelete`, `systemOpenSet`) that already were. So a view-only
code -- exactly the credential this system is built to let "try every screen and change
nothing" (`_lib/portal-core.js`'s own words, at the wall itself) -- could in fact change the
company-wide annual leave allowance. The reviewer reproduced it directly against the real test
harness (an AUDITOR fixture holding none of the leave tabs, calling `leaveSetAnnualDays`
straight through `portalApi`) before reporting it, not from reading the code alone. Fixed by
adding `leaveSetAnnualDays` to `AUDITED`, and by adding it to `test/portal.test.mjs`'s own
"every write is refused at the one door, loudly" test -- the one test that exists to prove this
exact wall holds, for a representative sample of what `AUDITED` carries. The second reviewer
found nothing on the two SQL files or the UI wiring; the rename above (the one cosmetic note
either reviewer raised) is applied. `npm test`: 1,512 pass -- the same count, since the new case
joined an existing test's list rather than adding a new one.

**What it costs.** Nothing on `/api/upload` or `/api/call`. A front-end change: `BUILD
2026-11-12-c`.

**Not done.** `db/RUN-ME-052-leave-tabs-from-advance.sql` and `db/CHECK-leave-tabs-from-advance.sql`
are handed to the owner, not run by this chat (no database access) -- running the write, and
re-running the check after, is the owner's own next step.

---

*This document describes the system as built. If a future change makes any statement here
untrue, the change should update this file in the same breath.*
