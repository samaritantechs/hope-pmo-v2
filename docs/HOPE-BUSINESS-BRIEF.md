# HOPE Microcredit — the business, for reading cold

Paste this whole file into a new AI conversation before asking it anything about the company.
It describes **the business**: what it sells, to whom, how the money works, how the field is
organised, how staff are paid, and what goes wrong. It is not about the software. (There is a
separate brief for that: `docs/HOPE-BRIEF.md`.)

Everything stated as fact below is drawn from the company's own contract terms, operating
rules and team registry. §12 lists what this brief deliberately does **not** know, so nothing
gets invented.

---

## 1. The company

**HOPE Microcredit Company Limited** is a Tanzanian microfinance lender.

- Head office: Dar es Salaam — P.O. Box 31623, Kijitonyama, Kinondoni.
- +255 659 077 770 · info@hopemicrocredit.co.tz · hopemicrocredit.co.tz
- Currency: **Tanzanian shillings (TZS)** throughout.
- Working languages: **Swahili and English together**. Customer-facing documents — the loan
  contract, the demand notice — are in Swahili. Internal screens are labelled in both.

It lends small working-capital loans to traders and small business owners, and collects them
back **weekly, in the field**. It is a high-touch, high-frequency lender: the business is built
on going to the customer every week, not on waiting for the customer to come in.

**Footprint.** Around **77 field teams** across **22 regions** of Tanzania. Dar es Salaam is the
largest concentration (about 15 teams); the rest run through Tabora, Morogoro, Mbeya, Mara,
Arusha, Ruvuma, Pwani, Iringa, Geita, Songwe, Njombe, Mtwara, Manyara, Kahama, Dodoma,
Singida, Shinyanga, Rukwa, Mwanza, Kilimanjaro and Kigoma. Teams are grouped into **branches**,
branches into **regions**, and each team also carries a **zone**. Around **300 field officers**
work the customers day to day.

---

## 2. The product

One core product: a short-term working-capital loan.

| Term | Value |
|---|---|
| Repayment | **12 weekly instalments** |
| Interest | **36% flat** on the principal |
| Grace | **6 days** after disbursement before the first instalment |
| Application fee | **5% of principal**, deducted from what is disbursed |
| Effective term | ~13 weeks, i.e. about three months |

**The arithmetic of one loan.** On a principal of P:

- Total repayable = **1.36 × P**, in 12 equal weekly instalments of about **0.1133 × P**.
- What the customer actually receives = P − any **previous balance** rolled over − the **5% fee**.
- So a first-time customer taking 1,000,000 receives about **950,000** and repays **1,360,000**
  over twelve weeks, about **113,333 a week**.

For anyone doing arithmetic on the pricing: a 36% *flat* charge over twelve weekly instalments,
with 5% deducted up front, works out to roughly **6% per week on the declining balance**.
Converting that to an annual rate is arithmetically possible but is not how the product is
sold, priced against competitors, or understood by customers — the customer's frame is "I take
this much on Monday and pay this much every week for three months."

**Loan sizes** run from under 500,000 to over 5,000,000, and the portfolio is tracked in those
bands: `< 500K`, `500K–1M`, `1M–2M`, `2M–3M`, `3M–5M`, `≥ 5M`.

**Repeat lending is normal and material.** A customer is stamped with a **TRACK#**: `1` for a
first loan, `2` or more for a repeat. When a repeat customer takes a new loan, their remaining
**previous balance is netted off** the new disbursement. Growth therefore comes from two very
different places — new customers won, and existing customers rolled up — and the company tracks
them separately (see §8, where the call room is paid only on track-1 wins).

---

## 3. The customer

Small traders and business owners: market sellers, shopkeepers, transporters, small
manufacturers. The loan is for working capital, and repayment comes out of daily trading, which
is why the instalment is weekly rather than monthly.

Every customer file carries:

- **A docket number** and, once approved, a loan ID.
- **National ID**, phone number, residence (district, ward, block), and type of residence.
- **A guarantor** — a full record: name, phone, relationship, occupation, national ID,
  residence, photo — plus up to **five alternate guarantors** (name, phone, relationship).
- **Mobile money and/or bank details** for disbursement, which may name a **recipient other
  than the customer**.

The guarantor is not a formality. Their number is on every follow-up list, and officers ring
them when the customer cannot be reached. A file without a second reachable number is a file
nobody can work.

---

## 4. How a loan is made

1. **Application.** The **call room** (customer service agents) takes applications, often by
   phone, and each application is stamped with the agent who brought it in.
2. **Assignment.** A branch manager assigns the application to a field team.
3. **Assessment — one visit, five parts.** A field officer visits and records: the customer's
   personal details, the residence, the business, the guarantor and their residence, and a
   recommendation. What the visit is *for* is explicit: **verify the business**, **check the
   amount against the business's capacity**, **verify both residences** (customer's and
   guarantor's), and **get the contract signed**. Each part is saved as it goes, because the
   whole form is filled in on a phone, in the field, on mobile data.
4. **Recommendation.** The team recommends an amount, which may be less than requested.
5. **Senior review, by size.** Both tiers are mandatory once crossed:
   - **1,000,000 and above** — the **Manager** must review.
   - **6,000,000 and above** — the **GMO** must also review.
   - Under 1,000,000 — neither; it goes straight to credit.
6. **Credit approval.** A **credit analyst** sets the granted amount, the application fee and
   the disbursement mode, and the system computes the interest, the total and the weekly
   instalment.
7. **Disbursement**, by mobile money or bank transfer, of principal minus previous balance minus
   fee.

The pipeline is watched stage by stage: `unassigned → assigned → unassessed → assessed →
pending approval → approved → pending disbursement → disbursed`. "Sales" in this company means
loans that reached **approved**, counted on their approval date.

---

## 5. How a loan is collected

This is the daily heartbeat of the business, and where most of the staff effort goes.

**The week.** Monday to Friday are collecting days. **There is no collection on Saturday or
Sunday.** Monday is the baseline the week is measured from. Saturday is the day the week's
recovery performance is settled for pay.

**Every working day:**

- A list is produced of the customers whose instalment falls **due today** — with the amount
  expected. This is the **Expected** book, and the morning version of it is what the **early
  collection** officers work from.
- Officers collect, and each customer ends the day **PAID**, **UNPAID** or **UNDERPAID**.
- **Collection % = collected ÷ expected.** This is the company's central number.
- What was due and not paid becomes **uncollected**, and passes to the recovery side.
- Separately, a **defaulter deck** is taken in the morning and again at the end of the day.
  What the arrears fell by between the two is what was **recovered** that day.

**Reaching the customer.** Around 300 officers work from a phone app all day, calling customers
and guarantors and recording the outcome of each contact — promised to pay, paying today,
unreachable, no cooperation, sent to the officer, has another number, and so on. A promise
opens a promise date and is followed up. Every defaulter is visited **twice a week**, on two
days derived from the loan itself: the weekday it was disbursed, and three days later.

**Payment channels.** Cash in the field, mobile money, and bank deposits. Payments that reach
the bank but not the day's report are entered by hand into an adjustment register
(*Iliyonasia* — "what got stuck") so the figures reconcile rather than silently disagree.

---

## 6. When a loan goes wrong

The escalation ladder, in order:

1. **Early collection** — chase before the customer defaults at all, working tomorrow's due list.
2. **Recovery** — chase customers already in arrears, daily, by phone and visit.
3. **Restructuring** — a written offer to a customer who has missed **4 or more** instalments:
   pay something now, spread the remainder over further weekly instalments up to a maximum of
   about **4 months**, with an optional interest charge (default 12%) on the remainder.
   Restructures are requested by an officer and approved by a senior.
4. **Demand notice** — a formal Swahili letter stating what was lent, what came back, what is
   still owed, and the late-payment fine. The fine is **weeks late × rate × weekly instalment**:
   **2%** for loans written in 2024 and earlier, **5%** for later ones. It only starts **14 days**
   after the first missed due date, and only once the customer has missed **two or more**
   instalments or the loan has expired — one missed payment on a live loan is not yet a
   fineable default.
5. **Legal**, held by a legal officer per team.

**Portfolio at Risk** is read two ways at once: by how long a customer has been in arrears
(**1–30, 31–60, 61–90, 91–180, 180+ days**), and by **loan size band** — the second is the one
management acts on, because it says where the overdue money is concentrated rather than merely
how many files are late.

A separate **complaints register** records customer complaints against a team, with a status
trail through to resolution.

---

## 7. How the field is organised

Each of the ~77 teams carries a named person in each role. One person usually holds the same
role across many teams.

| Role | What they own |
|---|---|
| **OPM** | Operations manager, senior across several teams |
| **Branch manager** | Runs the branch; assigns applications; reviews loans from 1M |
| **GMO** | Group/marketing officer; works the customer groups; reviews loans from 6M |
| **Credit analyst** | Assesses and approves; judged on sales and on their arrears book |
| **Early collection officer** | Chases customers due today and tomorrow, before default |
| **Recovery officer** | Chases customers already in arrears |
| **Collection officer (PMO)** | A head-office officer holding a large spread of teams |
| **Bike officer** | Field visits and physical follow-up |
| **Legal officer** | Demand notices and legal escalation |

Above the field sits the **PMO** — the office that watches every team's numbers daily, runs the
weekly meeting, and pays commission on the results.

**The management rhythm:**

- **Daily** — the day's lists go out in the morning, results come back in the evening, and the
  numbers are on a dashboard the same day.
- **Weekly** — Monday baseline, Monday-to-Friday collection, Saturday settles the week's
  recovery pay, and the week's report is stamped and taken to a meeting that walks each team
  through sales, arrears progress, collection and recovery.
- **Monthly** — the month is read week by week, and every leader in the company is ranked on
  the average of their measured percentages, best first.

---

## 8. How staff are paid on performance

Commission is a real and central part of pay, computed daily and settled weekly. Three separate
schemes for three different jobs:

1. **Recovery officers** — paid a band on their **recovery percentage**:
   90%+ → 60,000 · 80–89% → 40,000 · 70–79% → 30,000 · 60–69% → 25,000 · 50–59% → 20,000 ·
   below 50% → nothing.
2. **Early collection officers** — a **flat amount per customer** who comes in PAID or OVERPAID
   that day.
3. **PMO collection officers** — a band on their weekly **collection percentage**:
   97–100% → 60,000 · 95–96% → 40,000 · 93–94% → 30,000 · 90–92% → 25,000 · 85–89% → 20,000 ·
   below 85% → nothing. Plus a weekly bonus for whoever leads while beating their own previous
   week.

The percentage thresholds are policy and do not move; the shilling amounts are the admin's to
set. Note what the two ladders say about the business: **collection is expected to run in the
90s** — 85% is already the failing band — while **recovery of money already lost is rewarded
from 50%**. They are different jobs with different odds and the pay reflects it.

**Credit analysts** are ranked on their arrears book: each customer who has not yet passed the
halfway mark (paid fewer than 6 of 12) is scored **Cleared / Reduced / Static / Bad** against
the week's baseline, and success is (cleared + reduced) ÷ the book, averaged with sales.

**Call room agents** are paid a bonus per **track-1 registration** — a genuinely new customer,
brought in by a named agent on the roster. Repeat customers do not count, and neither does an
application with a blank track number. The rule is deliberately strict because it pays money.

---

## 9. Where the money is made and lost

- **Revenue** is the 36% flat charge plus the 5% application fee, earned over about three
  months, plus late-payment fines on delinquent loans.
- **Volume** comes from two engines: new customers won by the call room and the field, and
  repeat lending to existing customers with the previous balance netted off.
- **The cost side that management actually watches daily** is not interest margin, it is
  **collection**. A weekly-instalment lender with 300 officers in the field lives or dies on
  what percentage of the week's expected money actually arrives, and on how much of what was
  missed is recovered before it ages.
- **The three numbers the company runs on** are Sales %, Collection % and Recovery %, and the
  average of them is the single "performance" figure every team, leader and officer is ranked
  by, weekly and monthly.

---

## 10. The pressures this business actually faces

Stated plainly, because they shape every decision:

- **Collection discipline decays fast.** A weekly product gives twelve chances to slip and no
  monthly cushion. The whole operating scheme — daily lists, twice-weekly visits, a phone app
  in 300 hands, commission tied to percentages — exists to stop that.
- **Ageing arrears become unrecoverable.** Hence the escalation ladder and the emphasis on
  Count 1–6: a customer who has not passed halfway is still winnable, and one who has drifted
  past 180 days largely is not.
- **Field staff turnover and reassignment.** People hold roles across many teams and move
  between them; a reassignment that is only half recorded means work that stops being counted
  and an officer who stops being paid for it.
- **Data integrity is a business risk, not an IT one.** Commission and bonuses are paid off
  these percentages. A figure that cannot be defended line by line costs money and trust
  directly.
- **Cash handling in the field**, with the reconciliation problems that come with it — the
  manual adjustment register exists precisely because money arrives by routes the day's report
  does not always capture.
- **Geographic spread.** 77 teams across 22 regions on mobile data, from Dar es Salaam to
  Kigoma, is a supervision problem as much as a lending one.

---

## 11. Vocabulary you will meet

| Term | Meaning |
|---|---|
| Mkopo | Loan |
| Mteja / Wateja | Customer / customers |
| Mdhamini | Guarantor |
| Rejesho | Instalment |
| Deni / Madeni | Debt / arrears |
| Wadaiwa | Defaulters |
| Makusanyo | Collection |
| Timu | Team |
| Kiongozi / Viongozi | Leader / leaders |
| Mchambuzi | Credit analyst |
| Msimbo | Code (a staff access code or a team code) |
| Ada ya mkopo | Application fee |
| Notisi | Demand notice |
| Lengo | Target |
| Jumla / Wastani | Total / average |
| Leo · Jana · Kesho | Today · yesterday · tomorrow |
| Wiki / Mwezi | Week / month |
| Iliyonasia | The manual adjustment register — literally "what got stuck" |

---

## 12. What this brief does NOT know — ask before assuming

Do not let an assistant invent any of the following. They are genuinely unknown here, and the
owner should supply them if a question depends on them:

- **Portfolio size** — number of active customers, outstanding book value, disbursement volume.
  One figure is known: the **defaulter book is above TZS 3 billion**. The performing book, the
  customer count and monthly disbursement volume are not.
- **Financials** — revenue, cost of funds, opex, write-off rates, profitability.
- **Funding** — equity, debt, whose money is being lent.
- **Regulatory status** — licence category under the Bank of Tanzania's microfinance regime,
  reporting obligations, credit-bureau submission requirements (the system captures the fields
  a bureau would want, which suggests it matters, but the obligation itself is not documented
  here).
- **Headcount** beyond ~300 field officers, and the office structure above the PMO.
- **Competitors and market position.**
- **Actual current performance** — what collection and recovery percentages the company is
  really running at, and the trend.
- **The company's history** — when it was founded, by whom, how it has grown.
- **Deposit taking** — nothing here suggests the company takes deposits; treat it as a
  credit-only lender unless told otherwise.
- **Group vs individual lending** — a GMO works "customer groups", but the loan file, the
  guarantor structure and the repayment schedule are individual. Ask before describing it as
  group lending.

If a question turns on any of these, the right move is to ask rather than to fill the gap.
