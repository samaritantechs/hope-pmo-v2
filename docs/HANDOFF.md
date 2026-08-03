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
1. **The weekly report's sections** — the largest thing still outstanding from the comparison
   against the old system. See Part 14b.
2. **The native Android widget**, above.
3. **The Presentation for somebody who sees every team** is still the heaviest screen at about
   fifteen seconds of network waiting on first open (instant on the second, within the minute).
   Getting it lower means having the database add the figures up rather than sending rows to be
   added up here — a real change, worth doing deliberately rather than in a hurry.
4. Direct integration with the HOPE core system. It needs either a sample export of each report
   (headers plus ~20 rows), API documentation, or a read-only service account.

---

## How to check the system yourself

```
npm test                                    # 210 checks of the rules and the sums
node tools/settings-load-bench.mjs          # how much the Settings tab costs to open
node tools/load-bench.mjs                   # requests, rows and megabytes behind every screen

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

*This document describes the system as built. If a future change makes any statement here
untrue, the change should update this file in the same breath.*
