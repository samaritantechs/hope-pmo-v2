# HOPE Microcredit — a briefing to paste into an AI before asking it anything

Copy this whole file into a new conversation. It is written to be read cold, by someone or
something that has never heard of the company. After it, a question like "why would a team's
recovery percentage read 19% on a Saturday" is answerable; before it, it is not.

---

## 1. The company

**HOPE Microcredit Company Limited** is a Tanzanian microfinance lender, based in Dar es
Salaam (P.O. Box 31623, Kijitonyama, Kinondoni; +255 659 077 770;
info@hopemicrocredit.co.tz; hopemicrocredit.co.tz). It lends small working-capital loans to
traders and small business owners, and collects them back in weekly instalments, in cash, in
the field.

Everything is in **Tanzanian shillings (TZS)**. The working language of the business is
**Swahili and English together** — most screens in the system are labelled in both, in that
order, separated by a slash: `Makusanyo / Collection`. Anyone writing for this company should
keep that habit.

The operation is run by a **PMO** — the project/portfolio management office — which is the
office that watches every team's numbers daily and pays commission on them. "PMO" in this
company means that office and the people in it, not a generic acronym.

---

## 2. The loan product

- A loan is disbursed to a customer, who repays it in **12 weekly instalments**.
- Interest is **36% flat** over the term.
- There is a **6-day grace period** after disbursement before the first instalment is due.
- A customer's progress is written as **paid / target**, e.g. `4/12` — four instalments paid of
  twelve. The system calls this the **D.S** (due summary) and derives a **paid count** from it.
- **Count 1–6** means a customer who has paid fewer than 6 of their 12 — not yet past halfway,
  and therefore still considered winnable. It is a category the company acts on constantly.
- Loans carry a **TRACK#**: `1` means a first-time customer, `2` or more means a repeat
  customer on a further loan.

A loan travels through eight **pipeline stages**, in this order:

`unassigned → assigned → unassessed → assessed → pending_approval → approved → pending_disb → disbursed`

"Sales" for reporting purposes means loans that reached **approved** or beyond, counted by
their **approved date**.

---

## 3. The people

The field is organised into **teams** — several dozen of them, each covering an area, each with
a name (KONGOWE, MBAGALA, TUNDURU, and so on). Teams are grouped by **branch** and **region**.
Around **300 field officers** work the customers.

Every team has a set of named role-holders, and one person usually holds the same role across
many teams. The roles, as the system stores them:

| Role | What they do |
|---|---|
| **OPM** | Operations manager, senior over several teams |
| **Branch manager** | Runs the branch |
| **GMO** | Group/marketing officer, works the customer groups |
| **Credit analyst** | Assesses and approves loans; judged on sales and on their Count 1–6 book |
| **Early collection officer** (stored as `expected`) | Chases customers due today/tomorrow, before they default |
| **Recovery officer** | Chases customers already in arrears |
| **Collection officer (PMO)** | A PMO officer holding a large distributed portfolio of teams |
| **Bike officer** | Field visits |
| **Legal officer** | Demand notices and legal escalation |

Two things about this that trip people up:

1. **A collection officer's teams are not on the team sheet.** One PMO collection officer may
   hold thirty-odd teams, so their team list lives on **their access code**, not repeated in
   thirty rows of the teams table. Every other role is a named column on the team's own row.
2. **The access codes are the authority on who holds which team.** Where the leaders sheet and
   the access code disagree, the code wins.

**Customer-service / call agents** are a separate group again: the people in the call room who
bring in loan applications. Each application carries a **CREATED BY** agent id. They are not
field officers and are measured on something different (see §7).

---

## 4. Access and identity

There is no username and password. A person signs in with an **access code**, which carries:

- their **name**,
- their **role**,
- the **teams** they may see (empty means every team),
- the **tabs** (screens) they are allowed to open.

Team scoping is enforced on the server for every single query: a code scoped to three teams
gets three teams' figures back, whatever screen it opens. Screens are granted by ticking, never
assumed — a role with nothing ticked sees nothing.

Field officers sign into the phone app with their **team's code** instead, and their own phone
number is their identity.

---

## 5. The customer's week, and the two books

This is the core of the whole operation. Two different books are uploaded daily, and almost
every misunderstanding about this company comes from confusing them.

### The Expected book — who is due to pay

- **Expected — Today**: the list of customers whose instalment falls due **today**, with the
  amount expected, what they actually paid, and the resulting status (`PAID`, `UNPAID`,
  `UNDERPAID`).
- **Expected — Initial**: the morning version of the same list, before the day's collecting —
  the list the **early collection** officers work from. Tomorrow's initial list is what an
  early collection officer looks at today.
- **Collection %** = collected ÷ expected. This is the company's central daily number.
- What was due and not paid is **uncollected** — and that is the money the recovery side is
  measured against.

### The Defaulter book — who has fallen behind

- **Defaulters — Initial**: the morning deck, i.e. the arrears position at the start of the day.
- **Defaulters — Current**: the end-of-day deck.
- **Recovery** for a day = that day's **initial deck total minus the same day's current deck
  total**, per team. What the arrears fell by is what was recovered.
- Both decks are stamped with a **weekday** (MON…SUN) as well as a date. A day is only
  "measured" when both an initial and a current deck exist for it; otherwise recovery for that
  day is **not measured**, which is different from zero.

### The working week

- **Monday to Friday are collection days.** There is **no collection sheet on Saturday or
  Sunday** — so a weekend has no collection percentage and no "uncollected" figure. Any report
  showing weekend collection is wrong, and this has been a real and repeated source of alarm.
- Monday's initial deck is the **baseline** the week is measured against.
- The **6th day** (Saturday) is the commission day for the week's recovery.

### Two Swahili words that carry meaning here

- **leo** = today. **jana** = yesterday. **kesho** = tomorrow. **wiki** = week.
- The recovery percentage has two different denominators depending on the screen, and this
  matters enormously:
  - **Dashboards, the team list (Orodha), commission and the presentation** divide a day's
    recovery by **that day's own uncollected (leo)**. Saturday and Sunday have none, so they
    show no percentage at all.
  - **The phone's summary strip and the leader reports** use the older team rule: Monday by
    Monday's, Tuesday to Friday by **yesterday's (jana)**, the weekend by the whole week's.

### The recycling rotation

Every defaulter is visited **twice a week**, and the two days are derived from the loan itself:
the weekday it was disbursed on (Day 1) and three days later (Day 2), with Sunday rolled onto
Monday. Customers are handed to leaders (bike / manager / GMO by default) on a rotation.

### Follow-up statuses

When an officer reaches a customer they record a status. The ones the system behaves
differently for include **AMETOA AHADI** (they promised — opens a promise date), **ANALIPA
LEO** (paying today), **ANA NAMBA NYINGINE** (they have another number — opens a replacement
number box), **HAPATIKANI** (unreachable), **AMETUMA KWA AFISA**, **REJESHO LIMELIWA**. The list
is editable; anything added behaves as a plain comment.

---

## 6. The system

Three surfaces, one database (Supabase Postgres), deployed on Vercel. There is **no build
step** — the HTML pages are served exactly as written.

1. **The portal** (`public/app.html`) — the office system. Around thirty screens: dashboard,
   loan applications, expected repayment, defaulters, defaulter assignment, followup,
   promises, credit analysts, credit info, weekly report, month report, commission, portfolio
   at risk, complaints, restructuring, legal/demand notices, call reports, teams & staff,
   presentation, settings, audit log.
2. **The call app** (`public/call.html`) — an Android app the ~300 field officers use all day
   to work their lists and log calls. It syncs call logs back.
3. **The upload page** (`public/upload.html`) — where the daily reports are uploaded as Excel
   files, and where operational files are downloaded (bulk SMS list, company contacts, credit
   info report).

**Where the data comes from.** The company's core banking reports are exported to Excel and
uploaded here daily — expected, defaulters, the loan pipeline by stage, received payments,
followup, comments, teams, demand notices. The system does not originate the lending data; it
is the reporting, follow-up and performance layer over it. (A sandbox module, HOPE Loan, does
originate loans end to end, but it is separate.)

**Which upload counts.** A report re-uploaded for the same date **replaces** the earlier one:
readers keep the latest upload batch per team within a date. This matters because a file
uploaded twice used to double a denominator and halve everyone's percentage.

**Iliyonasia** ("what got stuck") is a manual, signed, attributable adjustment register: a
payment that reached the bank but not the report is typed in here and laid over the figures on
read, never baked into stored totals.

---

## 7. How people are measured

- **Sales** — approved principal against a target. The target is set per team per week
  (`SALES_TARGET_WEEKLY`); a month's target is that × 4 × teams held.
- **Collection %** — collected ÷ expected.
- **Early collection %** — the same, but against the morning **initial** sheet.
- **Recovery %** — recovered ÷ uncollected, on days a deck actually paired.
- **Performance** — the average of the percentages that were **actually measured**. A missing
  percentage leaves both the sum and the divisor. This is deliberate: counting an unmeasured
  recovery as 0% printed averages that contradicted the numbers beside them.
- **Credit analysts** are ranked on their Count 1–6 book. Each customer lands in one of four
  states measured baseline vs current: **Cleared** (gone from the current deck or nothing
  owing), **Reduced** (arrears fell), **Bad** (arrears rose), **Static** (unchanged). Success %
  = (cleared + reduced) ÷ the book.
- **Call agents** (customer service) are measured on **track-1 registrations**: an application
  counts only if TRACK# reads exactly 1 **and** the CREATED BY id is on the call-agents roster.
  A blank track does not count. This pays a bonus, so the rule is strict and what it excludes is
  shown on screen.
- **Portfolio at Risk (PAR)** is read two ways: by ageing bands (1–30, 31–60, 61–90, 91–180,
  180+ days in arrears) and by loan size band.

---

## 8. Commission — three separate schemes

Paid to different people for different work, computed daily and summed:

1. **Recovery officers** earn a **band on their recovery percentage**. Default ladder:
   90%+ = 60,000; 80–89% = 40,000; 70–79% = 30,000; 60–69% = 25,000; 50–59% = 20,000;
   below 50% = 0. Five weekday records plus the week's own figure as a sixth.
2. **Early collection officers** earn a **flat amount per customer** who came in PAID or
   OVERPAID that day.
3. **PMO collection officers** earn a band on their weekly collection percentage. Default
   ladder: 97–100% = 60,000; 95–96% = 40,000; 93–94% = 30,000; 90–92% = 25,000; 85–89% =
   20,000; below 85% = 0. A weekly bonus exists for whoever leads while beating their own
   previous week.

The **band percentages are fixed; the shilling amounts are the admin's to edit** in the system.
Officers see only their own row; admins see everyone.

---

## 9. The rules this system is built to

These are the owner's own standing instructions, and they explain why the code looks the way it
does. An AI advising on this system should treat them as constraints, not preferences.

1. **Uploading and the call app must never go down and never slow down.** Three hundred
   officers work the call app all day and the day's decks have to land. Every other screen is
   something somebody can come back to in five minutes; these two are not. Every change is
   counted in database round trips, and there are enforced speed budgets per screen.
2. **A slow database is not an excuse to slow those two down; it is a reason to ask it for
   less.** Budgets and fallbacks ship in the same change, never afterwards.
3. **One definition of a rule, in one place.** Two implementations of "which upload wins", or
   of "which day an application belongs to", are two answers that can disagree — and a drift
   there silently doubles or halves a figure nobody can account for.
4. **Team scoping happens at the database.** A filter applied after the rows arrive is not a
   filter, it is a download.
5. **Migrations are run by hand** in the SQL editor. Every code path that depends on one must
   work without it — fall back, never fail.
6. **Say what was not done.** A step skipped, deferred or unreachable is reported on the screen
   that expected it. Silence reads as success.
7. **Null is never zero.** A percentage that could not be computed shows a dash and says why.
   "We did not measure recovery" and "recovery was nil" are different facts.
8. **Team names are exact.** Postgres compares them exactly, so `Tunduru` and `TUNDURU` are two
   different strings; a name may also carry a trailing space. Every scope is resolved to the
   spelling the team registry stores before any query is built. This has caused real blackouts
   where officers signed in and saw nothing at all.
9. **Deploy heavy work in the evening**, never during the morning collection round.

---

## 10. Vocabulary you will meet

| Term | Meaning |
|---|---|
| Orodha | List (usually the per-team table) |
| Ripoti | Report |
| Wiki / Mwezi | Week / Month |
| Leo / Jana / Kesho | Today / Yesterday / Tomorrow |
| Makusanyo | Collection |
| Wadaiwa | Defaulters |
| Madeni / Deni | Arrears / debt |
| Rejesho | Instalment |
| Mdhamini | Guarantor |
| Msimbo | Code (access code / team code) |
| Timu | Team |
| Kiongozi / Viongozi | Leader / leaders |
| Mchambuzi | Credit analyst |
| Iliyonasia | The manual adjustment register |
| Jumla | Total |
| Wastani | Average |
| Bado | Not yet |
| Hakuna | None / there is no |
| Lengo | Target |
| Deck / kitabu | A day's uploaded defaulter list |

---

## 11. If you are being asked to help

Useful things to hold onto:

- Ask **which screen** a number came from before explaining it. The same word ("recovery %")
  has two legitimate denominators depending on where it is read, and both are correct.
- Ask **whether the day was measured**. Most "wrong number" reports are an unpaired deck, a
  missing upload, or a weekend.
- Assume **money and people are real**. Commission is paid off these figures and bonuses are
  paid off the call-agent counts. A plausible-looking number that cannot be defended line by
  line is worse than a dash.
- Any suggestion that adds work to the upload path or the phone app needs a reason written down
  beside it, and usually should not be made at all.
