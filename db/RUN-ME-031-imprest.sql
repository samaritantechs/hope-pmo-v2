-- =============================================================================================
-- IMPREST: request, single-GM approval, retirement, report.
-- =============================================================================================
--   "our office and field staff always make imprest requests as implemented in Hoop, the hope
--    google drive sheet has gone down with the sheet i was using so implement requests: so
--    implement request, approval and report and i'll grant the navs to those responsible. refer
--    to hoop implementation and the old one, i'll set GM email in settings, so these people see
--    their history and everything but gm gets email that has the details and two links (single
--    tap approval and disapproval or read). so we use the new way but the accountant infos are
--    no longer there for requesting but they will just update funded amount in imprest report
--    tab."
--
-- SAME SHAPE AS HOOP'S OWN IMPREST TABLES (db/migrations/RUN-ME-2026-09-07-imprest-leave.sql in
-- hoop-pmo), deliberately: it is a proven design -- a costed trip kept as its parts, a stamped
-- accommodation rate so a later rate change never reprices an old trip, a retirement filed once
-- with its receipts in their own table so no list ever drags three photos across the wire.
--
-- WHAT IS DIFFERENT FROM HOOP, and why:
--   * funded_amount / funded_by / funded_at -- "the accountant infos are no longer there for
--     requesting but they will just update funded amount in imprest report tab". HOOP has no
--     accountant step at all; HOPE's does, but ONLY here: the accountant holds the report tab
--     and writes one number once the GM has approved, recording what was ACTUALLY disbursed
--     (which can differ from approved_amount when cash flow means a trip is part-funded).
--   * No leave tables here -- HOOP's migration carries leave_requests alongside imprest because
--     one conversation asked for both; nobody has asked HOPE for leave requests, so it stays out
--     of a migration named for imprest.
--
-- THE GM IS ONE PERSON, NOT A NAV OF THEIR OWN. Three panes -- impreq (ask), impappr (decide),
-- imprep (review, and now fund) -- granted the ordinary way, to nobody by default: "i'll grant
-- the navs to those responsible" is the owner's own words for exactly this. The GM's address
-- for the email courtesy lives in Settings (IMPREST_GM_EMAIL), set from the Settings screen,
-- not typed into this file.
--
-- Safe to run more than once, like every migration in this folder.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. WHO IS PAID WHAT PER NIGHT. Edited from the approval pane's rate table.
-- ---------------------------------------------------------------------------------------------
create table if not exists imprest_roles (
  role                   text primary key,          -- stored UPPER-CASED, matched the same way
  accommodation_per_day  integer not null default 0 check (accommodation_per_day >= 0),
  updated_at             timestamptz not null default now(),
  updated_by             text
);
comment on table imprest_roles is
  'Accommodation rate per day for each role a traveller may claim as. The requester picks one '
  'of these on the form; the server multiplies nights by THIS rate and ignores any figure the '
  'form sent. Managed from the imprest approval pane.';

-- ---------------------------------------------------------------------------------------------
-- 2. THE REQUEST, from the ask to the GM's decision to the accountant's funding to the
--    retirement summary.
-- ---------------------------------------------------------------------------------------------
create table if not exists imprest_requests (
  id                uuid primary key default gen_random_uuid(),
  requested_at      timestamptz not null default now(),

  -- WHO ASKED, as their access code said at the time. staff_code is the sign-in credential and
  -- never leaves the server; the two names beside it are what the report prints.
  staff_code        text,
  staff_name        text not null,
  staff_role        text,

  -- THE FORM, as the person filled it. full_name is what they typed and may differ from
  -- staff_name; recipient_name is the name on the bank account when that is somebody else.
  full_name         text not null,
  mobile            text,
  recipient_name    text,
  email             text,
  imprest_role      text not null,                  -- the role chosen on the form (rate lookup)
  pay_mode          text,
  account_no        text,
  travel_date       date not null,
  destination       text,

  -- THE COSTING, kept as its parts. Every *_amount is computed by the server from the two
  -- numbers beside it; the client's totals are not trusted.
  fare_trips        integer not null default 0 check (fare_trips >= 0),
  fare_per_trip     integer not null default 0 check (fare_per_trip >= 0),
  fare_amount       integer not null default 0,
  accom_days        integer not null default 0 check (accom_days >= 0),
  accom_rate        integer not null default 0,     -- the role's rate IN FORCE when asked
  accom_amount      integer not null default 0,
  other1_desc       text,  other1_amount integer not null default 0 check (other1_amount >= 0),
  other2_desc       text,  other2_amount integer not null default 0 check (other2_amount >= 0),
  other3_desc       text,  other3_amount integer not null default 0 check (other3_amount >= 0),
  total_amount      integer not null check (total_amount >= 0),
  purpose           text not null,

  -- THE GM'S DECISION. One approver, by design -- "i'll grant the navs to those responsible"
  -- names impappr as the pane, not a person, so more than one code may hold it; whichever one
  -- decides is stamped below. approved_amount may be LESS than total_amount.
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected')),
  approved_amount   integer,
  comment           text,
  decided_by        text,
  decided_at        timestamptz,
  -- SET ONLY when the GM's decision came through the emailed one-tap link rather than the
  -- portal, so a report can say so -- "decided by email" is worth knowing on a row nobody in
  -- the portal saw the GM open.
  decided_via_email boolean not null default false,

  -- THE ACCOUNTANT'S OWN FIELD -- "they will just update funded amount in imprest report tab".
  -- Independent of approved_amount: an approval says what may be paid, funded_amount says what
  -- WAS, and the two are allowed to differ because cash flow does not always keep up with a
  -- decision. Null until the accountant writes it.
  funded_amount     integer,
  funded_by         text,
  funded_at         timestamptz,

  -- THE RETIREMENT, summarised here so every list can show it without a join. The line-level
  -- actuals and the photos live in the two tables below.
  retired_at        timestamptz,
  retire_total      integer,
  retire_balance    integer,          -- approved_amount - retire_total; null until retired

  updated_at        timestamptz not null default now()
);
comment on table imprest_requests is
  'One imprest (travel/task cash) request from ask to GM decision to accountant funding to '
  'retirement. Requester is STAMPED from the access code; amounts are computed server-side from '
  'their parts; the accommodation rate in force is stamped so later rate changes never reprice '
  'old trips.';
comment on column imprest_requests.accom_rate is
  'The imprest_roles rate for imprest_role at the moment of asking. Stamped, not joined.';
comment on column imprest_requests.funded_amount is
  'What the accountant actually disbursed, written directly on the report tab -- independent of '
  'approved_amount, which is what the GM authorised. Null means not yet funded.';
comment on column imprest_requests.retire_balance is
  'approved_amount minus what was actually spent. Positive = traveller refunds; negative = '
  'company reimburses. Null until a retirement is filed.';

create index if not exists imprest_requests_requested_at_idx on imprest_requests (requested_at desc);
create index if not exists imprest_requests_status_idx on imprest_requests (status) where status = 'pending';
create index if not exists imprest_requests_staff_code_idx on imprest_requests (staff_code);
create index if not exists imprest_requests_travel_date_idx on imprest_requests (travel_date);

-- ---------------------------------------------------------------------------------------------
-- 3. THE RETIREMENT: what the trip actually cost, line by line. One per request, ever.
-- ---------------------------------------------------------------------------------------------
create table if not exists imprest_retirements (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null unique references imprest_requests (id) on delete cascade,
  filed_at        timestamptz not null default now(),
  filed_by_code   text,
  filed_by_name   text,
  fare_actual     integer not null default 0 check (fare_actual >= 0),
  accom_actual    integer not null default 0 check (accom_actual >= 0),
  other1_actual   integer not null default 0 check (other1_actual >= 0),
  other2_actual   integer not null default 0 check (other2_actual >= 0),
  other3_actual   integer not null default 0 check (other3_actual >= 0),
  total_actual    integer not null check (total_actual >= 0),
  notes           text,
  photo_count     integer not null default 0
);
comment on table imprest_retirements is
  'Actual spend against an approved imprest, filed once by the traveller on arrival. The photos '
  'that evidence it are in imprest_photos, deliberately not here -- see that table.';

-- ---------------------------------------------------------------------------------------------
-- 4. THE RECEIPTS. Small, separate, fetched only when somebody asks to see them.
-- ---------------------------------------------------------------------------------------------
create table if not exists imprest_photos (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references imprest_requests (id) on delete cascade,
  seq         integer not null check (seq between 1 and 3),
  -- A JPEG data URL, already shrunk on the phone and refused above 200KB by the server. Text
  -- rather than bytea so the one client this system has (a browser) can put it straight into
  -- an <img> with no decoding step.
  data        text not null,
  bytes       integer not null,
  unique (request_id, seq)
);
comment on table imprest_photos is
  'Up to three receipt photos per imprest retirement, compressed client-side (long side <= '
  '1024px, JPEG ~0.6) and capped at 200KB each server-side. Kept off the request and retirement '
  'rows so every list stays light; fetched per request on demand.';

-- ---------------------------------------------------------------------------------------------
-- 5. WHERE THE GM'S COPY GOES, AND WHERE ITS LINKS POINT. Settings, so both can be changed
--    without a deploy. IMPREST_GM_EMAIL blank means "do not email" -- the panes still work;
--    email is a courtesy on top of them, never the record. APP_BASE_URL is this deployment's
--    own address (e.g. https://hope-pmo-v2.vercel.app), needed to build a working link inside
--    an email at all; blank means the email is still sent, just without the one-tap Decide
--    button or the deep link into the portal -- see gmActionLinks_ in api/_lib/imprest.js.
--
--    Sending needs RESEND_API_KEY set on the deployment (a secret, so an env var, not a row) --
--    the same knob the weekly report already uses. The one-tap link itself needs a SECOND
--    secret, IMPREST_LINK_SECRET, also an env var: unset, the email is still sent, only without
--    the Idhinisha/Kataa button -- see api/imprest-action.js.
-- ---------------------------------------------------------------------------------------------
insert into settings (key, value) values
  ('IMPREST_GM_EMAIL', ''),
  ('APP_BASE_URL', '')
on conflict (key) do nothing;
