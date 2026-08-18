/* =====================================================================================
   HOPE LOAN -- ORIGINATION. Run this on the HOPELOAN Supabase project ONLY.
   =====================================================================================

   HOW TO RUN IT
     1. Create the second Supabase project (name it hopeloan).
     2. Run db/schema.sql on it first -- HOPE Loan's database is the WHOLE HOPE PMO schema
        plus what is below, so that a sandbox loan can be originated here and then flow all
        the way through expected, defaulters, decks and recovery exactly as a real one does.
        That is what makes the end-to-end demonstration possible, and it is what makes the
        eventual merge into HOPE PMO a no-op rather than a migration.
     3. Run this file.
     4. Put HOPELOAN_SUPABASE_URL and HOPELOAN_SERVICE_ROLE_KEY into Vercel.

   Until step 4 the switch does not appear anywhere and every request goes to production.

   IF THE EDITOR COMPLAINS ABOUT A TRANSACTION BLOCK. Section 1 alters an enum type, which is
   the same family of statement as the CREATE INDEX CONCURRENTLY that failed once before. On
   Supabase's Postgres this is allowed and the file runs whole. If a future version refuses it,
   run section 1 on its own first, then the rest -- the two halves are independent, and nothing
   below section 1 uses the new values, which is the rule that makes splitting it safe.

   WHY IT EXTENDS RATHER THAN DUPLICATES. `loans` already carries the eight pipeline stages
   and the four amounts -- requested, team recommendation, principal, net disbursed. It was
   built to mirror this pipeline from uploaded reports. Origination writes to the SAME table
   and moves the SAME stage column; nothing is parallel, so when HOPE Loan lands in HOPE PMO
   there is no second model to reconcile.
   ===================================================================================== */


/* =====================================================================================
   1. THE STAGE THAT DOES NOT EXIST TODAY, AND WHAT IT COSTS TO BE MISSING.
   =====================================================================================
     "the unfunded always live in the expected and actually they start defaulting ...
      the disb action takes them into expected"

   A manager's DISBURSE is an AUTHORISATION. Finance moving the money is the PAYMENT. Today
   they are one word, so the loan enters the expected book the moment it is authorised -- and
   a customer who has received nothing is billed an installment, misses it, becomes a
   defaulter, joins a deck, and an officer telephones to chase money that was never sent.

   That single conflation inflates the expected total, depresses the collection percentage,
   invents defaulters, distorts recovery and charges a team for a phantom. The reversal
   workflow exists to clean up after it by hand.

   'funded' separates the two. Authorised-but-unfunded loans wait in a queue that no report
   counts; only funding starts the schedule and puts the loan into expected. */
alter type loan_stage add value if not exists 'funded'   after 'disbursed';
/* A rejection can happen at four different desks -- manager on assignment, team on
   recommendation, credit on approval, manager again on disbursement -- and every one of them
   must carry a reason (".//ALL TYPES OF REJECTIONS Must have comment"). Which desk it was is
   in loan_events; this is only the resting place. */
alter type loan_stage add value if not exists 'rejected'  after 'funded';
/* An authorised loan that was never funded and has been unwound by the CA -> Finance -> GM
   chain. It stays as a CLOSED CONTRACT rather than vanishing, because the customer's next
   application is a new loan on the next track and the history has to show what happened. */
alter type loan_stage add value if not exists 'reversed'  after 'rejected';
/* Fully repaid and closed. CreditInfo asks for a Real End Date, which needs a closing event
   to hang on rather than being inferred from a zero balance. */
alter type loan_stage add value if not exists 'closed'    after 'reversed';


/* =====================================================================================
   2. THE CUSTOMER -- the entity this system has never had.
   =====================================================================================
   Today a loan carries a name and a phone, and the same person taking a second loan is an
   unrelated row. Every problem that follows comes from that: no credit history, no way to
   answer "has this person borrowed from us before", and no possible submission to the credit
   bureau, whose entire structure is one permanent Customer Code with many contracts under it.

   THE DOCKET IS THE CUSTOMER CODE. Verified against live data: docket digits plus the track
   number are exactly the reference number, on every one of 2,921 loans, with no two customers
   ever sharing a docket. The serial inside it is a running counter that has passed 99,999,
   which is why long-standing customers carry shorter numbers than new ones.

   WRITE-ONCE VERSUS REVISABLE. Changing a date of birth or a national ID does not correct a
   record, it describes a different human being -- and the bureau matches on exactly those.
   The columns marked immutable below are enforced in code (customers.js), not by a trigger,
   so that the one person entitled to override a genuine typo can be given that power without
   a migration. Everything else is freely revisable and its history is kept in loan_events. */
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  docket text unique not null,                 -- 2-217-110984  -- IMMUTABLE
  serial_prefix text,                          -- 2217          the office block
  serial_no text,                              -- 110984        the running counter

  -- Name. The bureau wants the parts, not only the whole; "Full Name (3)" in the staff sheet.
  first_name text,                             -- IMMUTABLE
  middle_names text,
  present_surname text,                        -- IMMUTABLE
  birth_surname text,                          -- IMMUTABLE  (maiden name -- bureau field)
  full_name text not null,

  -- Person. Every one of these is a CreditInfo Individual column.
  gender text,                                 -- IMMUTABLE
  dob date,                                    -- IMMUTABLE
  country_of_birth text default 'TZ',          -- IMMUTABLE
  marital_status text,
  spouses integer,
  children integer,
  education text,
  nationality text default 'TZ',
  citizenship text default 'TZ',
  residency text default 'Yes',

  -- Identity documents. At least ONE is required by the bureau; NIDA is the one Tanzania uses.
  national_id text,                            -- IMMUTABLE  NIDA 19790809-15103-00003-19
  tin text,                                    -- IMMUTABLE
  passport_no text, passport_country text,
  driving_licence text,
  voters_id text,
  other_id_type text, other_id_no text,

  -- Where they are. Ward is ours; the bureau takes region and district only.
  region text, district text, ward text,
  street text, block_number text, nearest_landmark text,
  type_of_residence text, residency_capacity text, years_of_residence numeric(5,1),

  -- How to reach them. Stored the way normPhone leaves them: nine digits, no leading zero.
  mobile text, mobile_alt text, email text,

  -- What they do. Income and expenses are captured weekly by officers and converted for the
  -- bureau, which asks for them monthly -- the conversion belongs in code, not in the column.
  occupation text,
  employment text,                             -- SelfEmployed | Employed | …
  employer_name text,
  business_name text, business_type text,
  daily_sales numeric(14,2), daily_profit numeric(14,2),
  weekly_profit numeric(14,2), weekly_expenses numeric(14,2),
  net_income numeric(14,2),

  photo_url text,

  -- Where they belong now. A customer moves branch; the docket does not follow.
  region_current text, branch text, team text,

  created_by text, created_at timestamptz not null default now(),
  updated_by text, updated_at timestamptz not null default now()
);
create index if not exists idx_customers_docket on customers(docket);
create index if not exists idx_customers_team on customers(team);
/* "Keep track of multiple primary keys for customer and guarantor for future use as for credit
   history e.g. finding their historical appearance in the loan book by phone number, reference
   number or full names." All three are indexed, because all three get searched. */
create index if not exists idx_customers_mobile on customers(mobile);
create index if not exists idx_customers_name on customers(lower(full_name));


/* =====================================================================================
   3. WHAT A LOAN GAINS.
   ===================================================================================== */
alter table loans add column if not exists customer_id uuid references customers(id);
alter table loans add column if not exists docket_ref text;         -- the customer's docket

-- Funding: authorised is not paid. funded_at is what starts the repayment schedule.
alter table loans add column if not exists funded_at timestamptz;
alter table loans add column if not exists funded_by text;
alter table loans add column if not exists funding_batch text;      -- the bank report it went out on

-- The schedule, once there is one. 36% flat over 12 weekly installments after 6 days' grace.
alter table loans add column if not exists grace_days integer default 6;
alter table loans add column if not exists installments integer default 12;
alter table loans add column if not exists installment_amt numeric(14,2);
alter table loans add column if not exists first_schedule date;
alter table loans add column if not exists last_schedule date;
alter table loans add column if not exists real_end_date date;      -- bureau: Real End Date
alter table loans add column if not exists purpose text default 'Business';
alter table loans add column if not exists collateral_type text;
alter table loans add column if not exists collateral_value numeric(14,2);

-- The two senior recommendations the wireframes never drew: GMO must at 3M+, OPM may at 6M+.
alter table loans add column if not exists gmo_recommend numeric(14,2);
alter table loans add column if not exists gmo_remarks text;
alter table loans add column if not exists gmo_by text;
alter table loans add column if not exists gmo_at timestamptz;
alter table loans add column if not exists opm_recommend numeric(14,2);
alter table loans add column if not exists opm_remarks text;
alter table loans add column if not exists opm_by text;
alter table loans add column if not exists opm_at timestamptz;

-- Every rejection carries its reason, whichever of the four desks it came from.
alter table loans add column if not exists reject_reason text;
alter table loans add column if not exists rejected_by text;
alter table loans add column if not exists rejected_at timestamptz;

create index if not exists idx_loans_customer on loans(customer_id);
create index if not exists idx_loans_funded on loans(funded_at);


/* =====================================================================================
   4. THE ASSESSMENT -- five forms, one visit, saved as it goes.
   =====================================================================================
     "Add save option for the loan assessment stages to allow segments review per time without
      losing primary captured data before submitting the recommendation."

   Five forms in one sitting, on a phone, in the field, on mobile data, with no draft is how an
   afternoon's work is lost and how officers go back to paper. Each section carries its own
   completion mark; `submitted_at` is the only thing that makes the whole thing a
   recommendation. Until then it is a draft the officer owns. */
create table if not exists assessments (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid references loans(id),
  customer_id uuid references customers(id),
  team text, officer text,

  visited_at timestamptz,
  zone_visited text,                           -- .//walipomtembelea

  -- Section completion, so a half-finished form can be reopened where it was left.
  done_personal boolean default false,
  done_recommendation boolean default false,
  done_guarantor boolean default false,
  done_residence boolean default false,
  done_business boolean default false,

  -- What the assessment is FOR, per the operational scheme: verify the business, check the
  -- amount against its capacity, verify both residences, sign the agreement.
  business_verified boolean,
  residence_verified boolean,
  guarantor_residence_verified boolean,
  contract_signed boolean,
  contract_url text,

  recommend_amount numeric(14,2),
  remarks text,
  decision text,                               -- ACCEPTED | REJECTED
  reject_reason text,

  submitted_at timestamptz,
  submitted_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_assessments_loan on assessments(loan_id);
create index if not exists idx_assessments_open on assessments(team) where submitted_at is null;


/* =====================================================================================
   5. GUARANTORS -- the primary one, plus the five alternates.
   =====================================================================================
   ".//can add guarantors 2+ - sio lazima" and ".//Add 5 alt guarantors info -- Name, phone no
   & relation". The primary guarantor is a full record; an alternate is a name, a number and a
   relationship, which is all anyone captures for them. Both live here, told apart by `rank`:
   rank 0 is the guarantor, 1-5 are the alternates. This is also the bureau's Subject Relation
   sheet, which is why relationship is a first-class column and not a note. */
create table if not exists guarantors (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid references loans(id),
  customer_id uuid references customers(id),
  rank integer not null default 0,             -- 0 = the guarantor, 1..5 = alternates
  full_name text not null,
  phone text,
  relationship text,
  occupation text,
  national_id text,
  district text, ward text, block_number text,
  type_of_residence text, residency_capacity text,
  photo_url text,
  notes text,
  created_by text, created_at timestamptz not null default now()
);
create index if not exists idx_guarantors_loan on guarantors(loan_id);
create index if not exists idx_guarantors_customer on guarantors(customer_id);
create index if not exists idx_guarantors_phone on guarantors(phone);


/* =====================================================================================
   6. LOAN EVENTS -- who moved this loan, from where to where, and why.
   =====================================================================================
   Not an audit log bolted on afterwards but the spine of the pipeline. Every stage change
   writes one row, so "where is this loan and who has had it" is a read rather than a
   reconstruction -- and a rejection or a reversal is answerable months later by name. */
create table if not exists loan_events (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid references loans(id),
  at timestamptz not null default now(),
  from_stage text, to_stage text,
  actor text, actor_role text,
  amount numeric(14,2),                        -- the amount as it stood at this desk
  note text
);
create index if not exists idx_loan_events_loan on loan_events(loan_id, at desc);


/* =====================================================================================
   7. REVERSAL -- three desks, because the money never moved.
   =====================================================================================
   The credit analyst asks, finance reviews, the general manager authorises. Only then does the
   loan close as reversed. Modelled on the restructure request that already works in HOPE PMO,
   with one more signature on it. */
create table if not exists reversals (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid references loans(id),
  ref text, docket text, full_name text, team text,
  amount numeric(14,2),
  reason text not null,                        -- a reversal without a reason is not a reversal

  requested_by text, requested_at timestamptz not null default now(),
  finance_status text default 'Pending',       -- Pending | Approved | Rejected
  finance_by text, finance_at timestamptz, finance_note text,
  gm_status text default 'Pending',
  gm_by text, gm_at timestamptz, gm_note text,

  status text default 'Pending',               -- Pending | Reversed | Rejected
  closed_at timestamptz
);
create index if not exists idx_reversals_open on reversals(status) where status = 'Pending';


/* =====================================================================================
   8. THE DISBURSEMENT WINDOW -- global, opened and closed by finance.
   =====================================================================================
     "finance manager opens disburment window manually so as the disbursment process takes
      place per given time when managers are concentrated on disbursing loans - and closes it
      when done b/se the hope work is super pressure busy"

   One window for every manager at once. Kept as rows rather than a single flag so that "who
   opened it, when, and what went out during it" is answerable -- which is exactly the question
   the day's disbursement report answers. */
create table if not exists disbursement_windows (
  id uuid primary key default gen_random_uuid(),
  opened_by text not null, opened_at timestamptz not null default now(),
  closed_by text, closed_at timestamptz,
  note text
);
create index if not exists idx_disb_window_open on disbursement_windows(opened_at desc);


/* =====================================================================================
   9. CARRIERS -- because the general manager must be able to add one.
   =====================================================================================
   "Disbursement mode carriers can be added by general manager: e.g. Halotel, DCB Bank."
   A list in code is a list that needs a developer and a deployment to grow. */
create table if not exists carriers (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,                   -- Vodacom | Halotel | NMB | DCB Bank
  kind text not null default 'momo',           -- momo | bank
  active boolean not null default true,
  added_by text, created_at timestamptz not null default now()
);


/* =====================================================================================
   10. PAYMENTS FINANCE BRINGS IN BY HAND.
   =====================================================================================
     "finance manager has isp aceess for unlanded payments that he uses those excel columns to
      import payments into customer loans"

   This is the receiver for the live transaction feed that does not exist yet -- and it is not
   a placeholder, it is what finance already does today, written down. Every imported payment
   keeps its batch and its source, so when the ISP feed does arrive the same table takes it and
   only `source` changes. Nothing downstream has to be rebuilt.

   `shifted_from_ref` is the other half of finance's job: a payment that landed on the wrong
   reference and was moved. The original is never deleted -- it is marked and re-pointed, so
   the team that loses the payment can see why their recovery moved. */
create table if not exists payment_imports (
  id uuid primary key default gen_random_uuid(),
  batch text,
  ref text, docket text, full_name text, team text,
  amount numeric(14,2) not null,
  paid_at timestamptz,
  trans_no text,
  paid_by text,                                -- the number the money came from
  source text not null default 'manual',       -- manual | isp | feed
  shifted_from_ref text,                       -- set when finance moved this off another loan
  shifted_by text, shifted_at timestamptz, shift_reason text,
  imported_by text, imported_at timestamptz not null default now()
);
create index if not exists idx_payment_imports_ref on payment_imports(ref);
create index if not exists idx_payment_imports_batch on payment_imports(batch);


/* =====================================================================================
   11. ILIYONASA -- the manual adjustment, and why it is a table and not a cell.
   =====================================================================================
     "handling iliyonasia could add or reduce manual amount from current expected or current
      default total amounts of a team"

   A signed adjustment against one team's expected or default total for one date, always
   editable. It exists because transactions are sometimes made and verified and still do not
   succeed -- which no amount of correct arithmetic upstream will ever eliminate.

   It is a table rather than an editable cell on a report because an adjustment that cannot say
   who made it, when, and why is indistinguishable from an error. The figure stays adjustable;
   the fact that it was adjusted stops being invisible. */
create table if not exists manual_adjustments (
  id uuid primary key default gen_random_uuid(),
  team text not null,
  adj_date date not null,
  target text not null,                        -- expected | defaults
  amount numeric(14,2) not null,               -- SIGNED: may add or reduce
  reason text,
  ref text,                                    -- the customer it concerns, when it is one
  created_by text, created_at timestamptz not null default now(),
  updated_by text, updated_at timestamptz not null default now()
);
create index if not exists idx_manual_adj on manual_adjustments(adj_date, team);


/* =====================================================================================
   12. WHAT THIS DATABASE IS, WRITTEN INTO THE DATABASE ITSELF.
   =====================================================================================
   So that anybody who opens the SQL editor and wonders which project they are in can find out
   from the data rather than from the URL. The application also reads this: a workspace that
   says it is the sandbox is labelled as the sandbox on every screen, and a figure from here
   can never be quoted as the book by mistake. */
insert into settings (key, value)
values ('WORKSPACE', 'hopeloan')
on conflict (key) do update set value = 'hopeloan';

insert into settings (key, value)
values ('WORKSPACE_LABEL', 'HOPE LOAN — MAENDELEO / DEVELOPMENT SANDBOX')
on conflict (key) do update set value = excluded.value;

/* The sandbox mints its own reference numbers, and they start with a digit no live reference
   has ever used. Live data uses 2 through 7 only -- verified across the whole book -- so a 9
   is identifiable on sight and removable with one query if a row ever escapes. */
insert into settings (key, value)
values ('SANDBOX_REF_PREFIX', '9')
on conflict (key) do nothing;
