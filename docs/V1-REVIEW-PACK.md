# HOPE PMO v2 — review pack for the v1 team

**What this is.** A complete inventory of what the new system currently has: every screen,
every column on it, every figure it can produce, every report it accepts, every setting it
obeys. It is generated straight from the running code, so it cannot drift from reality the
way a hand-written summary does.

**What we are asking for.** You know the old system. Read this and tell us what is missing
or wrong. The questions are at the end.

*Generated 2026-08-01 from the live source.*

---

## 1. The portal — every tab, its cards and its columns

23 tabs, in the order they appear down the left-hand side.

### Dashboard  `dashboard`

**Cards at the top:** Current arrears · Recovered · Defaulters · Sales this week · Abnormal payments

**Columns in the table:** Officer · Uncollected · Paid+over · Coll % · Initial · Current · Rec % · Analyst · Apps · Amt · Sales % · Perf · Unassigned · Assigned · Total apps · Requested · Status · Customers · % of book · Arrears · Team · Recovery · GMO · Init arrears · Sales · Coll % today · Coll % early · Defaulters · Recovered · Debt crisis · Agent · Who · ABN

### Loan Applications  `apps`

**Cards at the top:** none

**Columns in the table:** Docket · Customer · Team · Product · Requested · Principal · Loan · Approved · Disbursed · Branch · Stage · Contact

### Complaint Register  `complaints`

**Cards at the top:** Complaints in range · Open · Resolved · Logged today

**Columns in the table:** Date · Complainant · REF# · Team · Category · Channel · Details · Logged by · Resolution · Phone · Status

### Expected Repayment  `expected`

**Cards at the top:** Expected  · Collected · Uncollected · Collection

**Columns in the table:** REF · Fullname · Team · Due summary · Installment · Expected · Paid · Arrears · Balance · Zone · Contact# · Status

### Defaulter Assignment  `assignments`

**Cards at the top:** In the deck · Not touched · Untouched arrears · No leader named

**Columns in the table:** Role · Customers · Touched · Arrears · Leader · REF · Customer · Team · Cycle · By · When · D.S · Days · Contact · Phase · Owner role · Recycling leader · Follow-up

### Exp.Def Recovery  `expdfrep`

**Cards at the top:** Wateja / Customers · Deni la awali / Initial · Deni sasa / Arrears now · Marejesho / Recovered · Rec %

**Columns in the table:** Teams · Customers · Initial · Rec % · Arrears now · Recovered

### Expected Defaulters  `defexp`

**Cards at the top:** In the weekly cycle · Expected  · Chronic · Expired · Their arrears

**Columns in the table:** Day · Customers · Team · REF# · Fullname · Disb date · Day 1 · Day 2 · Cycle · D.S · Contact# · Visit · Status · Owner role · Recycling leader · Arrears

### Defaulters Followup  `followup`

**Cards at the top:** Customers · Total arrears

**Columns in the table:** REF · Customer · Team · Contact · Arrears · Rejesho · Promise · D.S · By · When · Status · Follow-up

### My Commission  `commission`

**Cards at the top:** Recovery mode · Early collection

**Columns in the table:** none — this tab is boards and forms, not a list

### Promise to Pay  `promises`

**Cards at the top:** Promises · Overdue · Due today · Already cleared · Recovered since

**Columns in the table:** Promise date · REF# · Fullname · Team · Arrears before · Promise TZS · Promised to · Logged · Comment · When · Contact# · Arrears now · Recovered

### Followup Report  `fureport`

**Cards at the top:** Customers · Touched · Comments logged

**Columns in the table:** Officer · Total · Status · Customers · Arrears · Comments · Team · Touched · When · REF# · Fullname · Comment · Promise

### Call Reports  `calls`

**Cards at the top:** Calls · Talk time · Portfolio · Non-portfolio

**Columns in the table:** Category · Calls · Talk time · Connected · Outcome · Team · Non-portfolio · Date · Officer · Position · Expected · Defaulter · Customers · Days · Connected % · Portfolio · Portfolio %

### Abnormal Payments  `abnormal`

**Cards at the top:** Flagged payments · Flagged amount

**Columns in the table:** GMO · Team · PMO · REF No · Customer Name · Transaction ID · Sender Name · Payment · Customer No · Payment No · Paid

### Legal / Demand Notices  `legal`

**Cards at the top:** Notices issued · Total demanded · Fines charged · Marejesho / Paid · Wiki za faini / Weeks late · Faini / Fine · Deni la msingi · Jumla ya madai / Total demand

**Columns in the table:** Kumb.Na. / Ref · Notice date · REF# · Customer · Team · Days · Paid · Arrears · Principal left · Issued by · Contact · Fine · Total demand

### Loan Restructuring  `restructure`

**Cards at the top:** Requests · Pending · Approved · Rejected

**Columns in the table:** Requested · REF# · Customer · Team · DC · Arrears · First · Remaining · Interest · Total · Inst · Inst amt · Start · Requested by · Decided by · Reason · Status

### Credit Analysts  `credit`

**Cards at the top:** Count 1–6 defaulters · Success (1–6) · Sales · Overall · Below average

**Columns in the table:** Analyst · Teams · Init 1–6 · Now 1–6 · Success % · Recovered · Sales · Sales % · REF# · Customer · Team · Init arrears · Current · Cleared · Reduced · Static · Bad · Overall % · Paid · State

### Leader Reports  `reports`

**Cards at the top:** Teams · Initial arrears · Current arrears · Recovered

**Columns in the table:** Teams · Which teams · Initial · Current · Progress % · Cleared · Team · Recovery officer · GMO · Manager · Recovered · Init cust · Cur cust · Officer · Recovery comm. · Paid · Overpaid · Collection comm. · Total

### Weekly Report  `weekly`

**Cards at the top:** Expected · Collected · Uncollected · Recovered · Received · Sales

**Columns in the table:** Team · Sales · % of target · Count 1–6 · Static · Success % · Expected · Collected · Collection % · Recovery % · Monday debt · Current debt · Day · Date · Customers · Uncollected · Recovered · Received · Cleared · Reduced · Bad · Change

### Portfolio at Risk  `par`

**Cards at the top:** At-risk arrears · Outstanding balance · Portfolio at risk · Defaulters · Average principal

**Columns in the table:** Band (principal) · Defaulters · Avg principal · Balance · PAR % · Share of arrears · Days · Customers · Arrears · Status · Team

### Presentation  `present`

**Cards at the top:** Slides · Seconds per slide · Weekday · Remaining · New interest · Total to repay · Per installment

**Columns in the table:** Team · Recovery · Current · Recovered · Coll % · Def · Officer · Initial · Rec % · Uncollected · Paid+over · Agent · Calls · Talk time · Portfolio · Connected % · Analyst · Apps · Amount · Sales % · Perf · Day · Expected · Collected · Status · Customers · % of book · Arrears · Slide · Type · Rows · Date · Installment

### Teams & Staff  `teams`

**Cards at the top:** Teams · Supervisors named · Roles · Bila msimbo / No code

**Columns in the table:** Team · OPM · Recovery · GMO · Manager · Credit · Expected · Bike · Msimbo / Code · Expected Repayment · Defaulters (initial + current) · Received Payments · Abnormal Payments · Call Logs · Loan Pipeline (all stages) · Comments Log · Complaints · Loan Restructuring · Demand Notices

### Upload Reports  `upload`

**Cards at the top:** none

**Columns in the table:** none — this tab is boards and forms, not a list

### Settings  `settings`

**Cards at the top:** Settings · Access codes · Phone users · Stored rows · Database used

**Columns in the table:** Date · Total · Key · Value

---

## 2. The phone app (HOPE Calls)

**Tabs:** Leo (today) · Kesho (tomorrow) · Def (def) · Exp (exp) · Chr (chr) · Exp.Def (expdf) · Ripoti (reports)

**The performance bar across the top:** Col leo (col) · Kesho (kesho) · Wiki (week) · Sales (sales) · Exp.Def (expdf) · Rec (rec)

Each customer row carries: name, phone, guarantor name and phone, arrears, rejesho, D.S,
status, and a tick once that number has genuinely been spoken to today (a call over 5
seconds, in or out).

---

## 3. The customer screen (Mkopo Wangu) and the wall display (HOPE Live)

**Mkopo Wangu** — a customer types a reference number and sees: their name, what they owe
today or how far behind they are, balance, installment, paid today, arrears, a promise they
already gave an officer, and every payment they have made with receipt numbers.
It deliberately never shows a phone number or guarantor details.

**HOPE Live** — a screen left on a monitor or a phone home screen, refreshing itself: the
same six figures as the phone bar, and nothing else. No customer data at all.

---

## 4. Everything the system can be asked for

**Portal (62):**

```
abnormal  accessCodes  addComment  addComplaint  addDemandNotice  addRestructure  assignments  callAgents  callReport  callUsers  comments  commission  commissionSave  complaintLog  complaints  credit  dashboard  dashboardFull  decideRestructure  defaulters  deleteAccessCode  deleteOfficerAccount  deleteRole  deleteTeam  demandNotices  emailWeeklyExpdf  expdfMine  expdfReport  expected  expectedDay  expectedDefaulters  followup  followupReport  hints  leaderReports  legalPreview  loanPipeline  loans  officerAccounts  officerBoards  par  promises  purgeSnapshots  received  removeCallUser  resolveComplaint  restructureEligible  restructures  saveAccessCode  saveCallAgent  saveComplaint  saveOfficerAccount  saveRole  saveTeam  settingSet  settings  settingsList  storageUsage  teamProgress  teams  uploadStatus  weekly
```

**Phone and public screens (12):**

```
api_brand  api_teamCode  api_customerLookup  api_widget  api_callBoot  api_callRegister  api_callList  api_callDailySummary  api_callSync  api_callComments  api_callAddComment  api_callReport
```

---

## 5. Reports it accepts

- **Defaulters — Current** `defaulters-current`
- **Defaulters — Initial** `defaulters-initial`
- **Expected — Today** `expected-today`
- **Expected — Tomorrow** `expected-tomorrow`
- **Expected — Yesterday** `expected-yesterday`
- **Expected — Initial** `expected-initial`
- **Loan pipeline (pick stage below)** `loans`
- **Defaulters Followup** `followup`
- **Comments Log** `comments`
- **Leaders / Teams** `teams`
- **Received Payments** `received`
- **Abnormal Payments** `abnormal`
- **Complaints** `complaints`
- **Loan Restructuring** `restructures`
- **Demand Notices** `demand-notices`
- **Access Codes** `access-codes`
- **User Roles** `user-roles`
- **Call App Users** `call-users`
- **Call Logs** `call-logs`
- **Settings** `settings`
- **Hints** `hints`
- **Logo ya kampuni / Company logo (PNG, JPG)** `logo`

**Loan pipeline stages:** Unassigned Applications (unassigned) · Assigned Applications (assigned) · Unassessed Applications (unassessed) · Assessed Applications (assessed) · Pending Approval (pending_approval) · Approved (Processed) (approved) · Pending Disbursement (pending_disb) · Disbursed Loans (disbursed)

---

## 6. Settings it obeys

```
ACCOUNT_OFF
ADMIN_EMAIL
ASSIGN_ACTIVE
ASSIGN_BUCKET_DAYS
ASSIGN_CHRONIC
ASSIGN_EXPIRED
ASSIGN_GRACE_WEEKS
BRAND_LOGO
BRAND_SIGN
BRAND_STAMP
CALL_BRAND
CALL_LOGOUT_ENABLED
CALL_LOGO_URL
CALL_MIN_SECS
CALL_SYNC_SECONDS
CMS_MODE
CMS_OVER_TZS
CMS_PAID_TZS
CMS_STATUS_RATES
CMS_YEAR_RATES
CUSTOMER_LOGIN_VERIFY
EMAIL_FROM
RESTRUCTURE_APPROVERS
RESTRUCTURE_INTEREST_PCT
RESTRUCTURE_MAX_MONTHS
RESTRUCTURE_MIN_DC
SALES_TARGET
SALES_TARGET_MONTHLY
SALES_TARGET_WEEKLY
```

---

## 7. Where everything is stored

19 tables:

```
abnormal_payments  access_codes  announcement  call_logs  call_users  complaint_log  complaints  defaulter_snapshots  demand_notices  followup_comments  followup_status  hints  loans  received_payments  repayment_snapshots  restructures  roles  settings  teams
```

---

## 8. What we would like you to tell us

Please go through these in order. Be specific — a tab name and a column name is worth more
than "the reports need work".

1. **Missing columns.** For each tab in section 1, is there a column the old sheet showed
   that is not listed? Name the tab and the column heading as it appeared in v1.

2. **Missing tabs or screens.** Is there a sheet, view or report in v1 that has no equivalent
   in section 1 at all?

3. **Figures that are computed differently.** Where v1 and v2 both show a number with the
   same name — collection %, recovery %, sales, commission, PAR, arrears — is the v2
   definition in the handoff the same as v1's? Where they differ, which is right, and why?

4. **Layout and order.** Where a tab exists but reads wrong: wrong column order, missing
   totals row, missing subtotal, a grouping that has been lost, a sort that has changed.

5. **Actions that are gone.** Buttons, exports, printouts, emails or approvals that v1 had
   and section 4 does not appear to cover.

6. **Uploads.** Does section 5 cover every file the operation actually loads? Any report
   still being kept in a spreadsheet because the system will not take it?

7. **Rules that live in people's heads.** Anything v1 did that nobody wrote down —
   a weekday that behaves differently, a rounding rule, a cut-off time, an exception for one
   team or one product.

The full handoff — what every word means, how every figure is derived, and every rule the
system follows — is in `docs/HANDOFF.md`, sent alongside this. Read section 1 of this pack
with Part 4 of that one open; between them they say exactly what v2 believes.
