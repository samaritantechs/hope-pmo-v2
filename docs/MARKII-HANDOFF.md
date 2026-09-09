# Markii Jaffary Mohamed — a handoff

Paste this into a new AI conversation so it knows who it is working with before the first
question. It is about **the person**, not about any one project. Companions: `HOPE-BRIEF.md`
(the software), `HOPE-BUSINESS-BRIEF.md` (the client's business), `HOPE-OWNER-HANDOFF.md` (how
to work with them on that system day to day).

Everything here is drawn from their own CV and from work that can be verified in this repository.

> **Deliberately left out of this file:** national ID number, full date of birth, home street
> address, and the contact details of their referees. Those are on the CV itself, which they send
> when it is wanted; they have no business sitting in a git history. Names and institutions of
> the referees are named in §8 without their numbers.

---

## 1. Who they are

**Markii Jaffary Mohamed** — **Portfolio Operations & Systems Lead**.

- Based in **Dar es Salaam, Tanzania**. Born 1998 in **Kagera**.
- **Fluent in English and Swahili**, and build products labelled in both.
- markiisamaritan@gmail.com · +255 756 749 261
- Trades as **SamaritanTechs** (GitHub `samaritantechs`).
- Describes themselves as prayerful, with a strong work ethic, a fast adopter of new technology,
  an analytical problem-solver and a team player — active in organisational participation,
  charity and tourism.

**Their own summary of what they do:**

> "I build systems that make loan portfolios impossible to hide from."

And the practice's positioning, from its brand book:

> "A Samaritan is the one who stopped for the person everybody else walked past, and this
> company writes the software that lends to people the banking system walks past."

They are unusual in a specific way worth stating plainly: they are not a developer who was handed a
lending domain, nor an operations manager who commissioned a system. **They work the operation
and build the software for it, at the same time.** That is why their requirements arrive as
named field incidents and their arguments are about whether a percentage divides by the right
denominator.

---

## 2. Career

**Portfolio Monitoring General — Hope Microcredit Co. Limited** · April 2025 to date

- Designed, built and operate **HOPE PMO**, the company's portfolio monitoring and recovery
  platform: daily loan-book uploads, a bilingual field call app used by 300+ officers,
  dashboards, weekly reports, PAR, commissions and audit trails — over a **defaulter book above
  TZS 3 billion**.
- "Reduced portfolio invisibility to zero: every defaulter in the country is one tap from a
  phone call, with every follow-up, promise and payment status recorded and auditable."
- Supervises and coordinates field teams and officers across multiple regions, driving
  collection-rate targets and managing specialised bike recovery units for chronic and expired
  cases.
- Prepares weekly and monthly performance reporting for senior management; enforces standard
  operating procedures for follow-ups; trains staff on ethical collection and fraud prevention.
- Liaison between field operations, customer service, credit, finance, HR and general
  management; handles escalated client disputes.

**Systems Consultant (selected by sister company) — Hoop Limited** · August 2026 to date

- Selected to replicate the recovery-platform model for Hoop's **Watu Credit** phone-dealership
  operation: a credit-team call application, daily Watu report uploads, and recovery and
  reconciled sales reporting.

**Field Officer — Hope Microcredit Co. Limited** · January to April 2025

- Front-line loan follow-up and client management. **Promoted to Portfolio Monitoring General
  within three months.**

**Proprietor — Stationery Services Print Shop Enterprise, Mabibo–NIT** · Sept 2022 to Jan 2025

- Customer service, official document preparation, printing and design for a walk-in client base.

**Field Work Trainee, ICT — MedPack Tanzania Limited** · July to Sept 2022
Computer maintenance, report writing and graphics design.

**Field Work Trainee, ICT — Ministry of Lands, Housing & Human Settlements Development**
· July to Sept 2019 — computer networking, maintenance and network administration.

**Read the arc, not just the rows.** Front-line collections officer in January 2025; running
national portfolio monitoring by April; by 2026 the author of a production platform carrying a
three-billion-shilling defaulter book, and hired by a sister company to do it again in a
different industry. Eighteen months, from the field to the system that runs the field.

---

## 3. Education

- **2018–2022** — **Bachelor of Information Technology (BIT)**, National Institute of Transport
  (NIT), Dar es Salaam.
- **2016–2018** — Advanced Certificate of Secondary Education, Kigonigoni High School,
  Kilimanjaro.
- **2012–2015** — Certificate of Secondary Education, Mpwapwa Secondary School, Dodoma.
- **2004–2011** — Certificate of Primary Education, St. Achileus Kiwanuka English Medium
  Primary School, Kagera.

---

## 4. What they have actually built

**HOPE PMO v2** is not a prototype. It runs the company.

| | |
|---|---|
| Defaulter book under management | **above TZS 3 billion** |
| Field teams served | ~77, across 22 regions of Tanzania |
| Field officers on the phone app daily | 300+ |
| Application and front-end code | ~35,000 lines |
| Automated tests | 945, across 15 suites |
| Hand-run SQL migrations | 73 files |

**What it does**, end to end: daily ingestion of the lender's core reports from Excel; the
expected-repayment and defaulter books; collection and recovery measurement; a defaulter
follow-up and assignment rotation; an Android calling app in 300+ officers' hands with its own
sync; three separate commission schemes computed daily and settled weekly; credit-analyst
scorecards; portfolio at risk; a complaints register; loan restructuring; Swahili demand notices
with legally-shaped fine arithmetic; bulk SMS and contact exports; weekly and monthly reports; a
presentation mode for the management meeting; role-based access control with per-screen
granting; an audit log; and a full loan-origination pipeline from application through field
assessment and two tiers of senior review to disbursement.

Also in the repository: a **generated brand package** — logo, favicons, letterhead and invoice
templates — where every asset is rebuilt from arithmetic in a script rather than hand-drawn, so
the identity can be regenerated identically if every file were lost. And an **operator's
manual**, a **payload specification** for outside integrators, and these briefs.

---

## 5. Skills

**From the CV:**

- Systems building and **AI-augmented software delivery** — full product ownership from
  requirement to deployed production system (web, database, mobile-web).
- Portfolio monitoring and risk management — recovery strategy, delinquency tracking, real-time
  dashboards, data integrity, automated reporting.
- Team leadership and field operations — multi-region supervision, target management, training
  and mentoring of team leaders.
- Advanced MS Office, including Excel dashboarding.
- Operating systems, networking and web development; website design, development and hosting.
- Cisco switching and routing; systems and network administration.
- Computer maintenance and troubleshooting, hardware and software.
- Graphics design (logos, posters, brochures, flyers); photography and photo editing.
- Typing mastery; social media management; time management; communication with active
  listening; creative problem-solving.

**What the production code additionally evidences:**

- **Backend:** Node.js serverless on Vercel; Supabase / PostgreSQL; PostgREST query
  construction; database-side aggregates for the heavy reads; chunked, resumable batch writes
  sized against a 60-second function limit.
- **Performance engineering as a discipline.** Every screen carries an enforced budget in
  database round trips *and* rows returned, asserted by tests that fail the build when a change
  exceeds them. Caching, in-flight request de-duplication, per-client memoisation, answer caches
  keyed by team scope.
- **Frontend:** deliberately no build step — vanilla HTML/CSS/JS served exactly as written, with
  a version stamp that makes a stale page reload itself past the cache. Sortable data tables,
  charting, JPG/Excel/CSV export from the browser.
- **Mobile:** an Android application (`com.samaritantechs.hopecalls`) with a JavaScript bridge
  for file saving, built for five-year-old handsets on mobile data.
- **Data engineering:** Excel ingestion with header-shape detection; batch-stamped uploads where
  a re-upload replaces rather than doubles; deduplication by customer identity across changing
  document numbers; a manual adjustment register laid over stored figures on read.
- **Security and governance:** access codes with per-screen granting, server-side team scoping
  on every query, a read-only supervisor role, and an audit trail written at one door.

---

## 6. How they work

- **Shipping.** They do not want to be asked for permission to commit, push or merge. Do the work,
  then report what changed.
- **Batching.** A single message may carry nine separate requests. All nine are real.
- **Working from the field.** Requirements arrive as real incidents with real names: an officer
  whose phone shows a different figure from the wall, a team whose customers vanished, a bonus
  count customer service says is unfair. They trace them to the root rather than patching the
  symptom.
- **One definition per rule.** If the dashboard already decides what "recovery"
  means, the commission board reads that same function. Two implementations are two answers that
  can disagree, and in a system that pays people, a drift is money.
- **Speed as a constraint.** Two paths may never slow down — the daily upload and the
  officers' phone app — and everything else is designed around that.
- **The product must admit what it does not know.** A percentage that could not be
  computed shows a dash and says why; a step that was skipped is reported on the screen that
  expected it. Silence reads as success, and they do not accept it.
- **Documentation for whoever comes next.**

**On stakes:** they funded much of this development personally rather than out of company money.
It explains the standard they hold work to, and why a quietly wrong number is treated as a
serious failure rather than a cosmetic one.

**Working with them well.** Do: fix the case they named, in the place they named it; ship it; report
in plain operational language — what was wrong, what changed, what they will see on screen, what
it cost in database reads; say what you could not do; push back once, briefly, if their
instruction would cost something they may not have priced in, then do what they decided. Don't: ask
permission for ordinary delivery; widen the change beyond the ask; invent a second version of a
rule that already exists; return a message for clarification when the intent is readable; hand
them code when they asked for an outcome.

---

## 7. If you are helping them apply for something

Lead with the arc and the scale, not the tool list. The three facts that do the work:

1. **Field officer to national portfolio monitoring in three months**, and to the author of the
   platform within a year.
2. **A production system carrying a defaulter book above TZS 3 billion**, used daily by 300+
   officers across 22 regions — built and operated by them.
3. **Hired by a sister company to replicate it** in a different industry, which is the market's
   own verdict on the first two.

They are a **builder-operator**: rarer, and more valuable, than either half alone.

---

## 8. Referees

Named on the CV, with contact details there rather than here:

1. **Bernad Hayuma** — Lecturer, ICT Department, National Institute of Transport (NIT).
2. **Shabani Juma Bakari** — Lecturer, ICT Department, National Institute of Transport (NIT).
3. **Venance Mkilila** — Network Administrator, ILMIS Department, Ministry of Lands, Housing &
   Human Settlements Development.
4. **Alphonce Aloyce Alphonce** — Applications Administrator, ICT Department, Tanzania Railways
   Corporation (TRC).

---

## 9. What this handoff still does not know

Ask rather than assume:

- The legal form and size of SamaritanTechs, and whether anyone else works in it.
- Clients beyond Hope Microcredit and Hoop Limited.
- Formal certifications beyond the degree.
- What they are looking for next — clients, employment, partners, investment.
- Their availability, rates, or notice period.
