-- =====================================================================================
-- HOPE PMO v2 -- PostgreSQL schema (Supabase)
-- =====================================================================================
-- Design principle: your ~56 Google Sheets tabs exist because Sheets has no query
-- language -- every "view" of the data (Monday's Expected, Wednesday's Defaulters,
-- Initial vs Current) had to be its own physical tab. A real database doesn't need that:
-- one loan is one row that moves through a `stage` column instead of living in 8
-- different sheets, and one customer's weekly snapshots are rows in ONE table filtered
-- by a `snapshot_date` column instead of 24 separate day-keyed tabs. This is what
-- permanently kills the cell-limit problem -- there is no cell limit, and "load last
-- Wednesday's numbers" becomes a WHERE clause instead of picking the right tab.
--
-- Run this once against a fresh Supabase project: Supabase Dashboard -> SQL Editor ->
-- paste this whole file -> Run. It's idempotent (safe to re-run) via IF NOT EXISTS.
-- =====================================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- =====================================================================================
-- REFERENCE / CONFIG
-- =====================================================================================

create table if not exists teams (
  team text primary key,
  opm text, recovery text, gmo text, manager text, credit text, expected text, bike text,
  updated_at timestamptz not null default now()
);

create table if not exists access_codes (
  code text primary key,
  name text not null,
  role text not null,
  teams text[],              -- null/empty = ALL teams
  tabs text[],
  created_at timestamptz not null default now()
);

create table if not exists roles (
  role text primary key,
  tabs text[]
);

create table if not exists settings (
  key text primary key,
  value text
);

create table if not exists hints (
  tab text primary key,
  message text,
  sw_message text
);

-- =====================================================================================
-- LOAN PIPELINE -- one row per loan, moved through `stage` instead of 8 separate sheets.
-- Every column that only applied at a later stage (approved_date, disb_date, etc.) is
-- just nullable until the loan gets there -- no data is lost by consolidating.
-- =====================================================================================

-- CREATE TYPE has no IF NOT EXISTS, which silently broke this file's safe-to-re-run promise:
-- the second run died right here. Wrapping it keeps the whole file idempotent for real.
do $$ begin
  create type loan_stage as enum (
    'unassigned','assigned','unassessed','assessed',
    'pending_approval','approved','pending_disb','disbursed'
  );
exception when duplicate_object then null;
end $$;

create table if not exists loans (
  id uuid primary key default gen_random_uuid(),
  docket_no text,
  loan_id text,
  track_no text,
  full_name text not null,
  contact text,
  momo text,
  recipient_full_name text,
  recipient_momo text,
  guarantor_name text,
  guarantor_contact text,
  region text,
  branch text,
  team text references teams(team),
  zone text,
  location text,
  nearest_landmark text,
  product text,
  disbursement_type text,
  requested_amt numeric(14,2),
  team_recomm numeric(14,2),
  previous_balance numeric(14,2),
  principal_amt numeric(14,2),
  processing_fee numeric(14,2),
  interest_amt numeric(14,2),
  net_disbursed numeric(14,2),
  loan_amt numeric(14,2),
  bank_name text,
  account_no text,
  stage loan_stage not null default 'unassigned',
  disb_status text,
  disb_date date,
  approved_date date,
  approved_by text,
  disbursed_by text,
  created_by text,
  assigned_by text,
  assigned_at timestamptz,
  recommended_by text,
  recommended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_loans_stage on loans(stage);
create index if not exists idx_loans_team on loans(team);
create index if not exists idx_loans_docket on loans(docket_no);

-- =====================================================================================
-- REPAYMENT SNAPSHOTS -- replaces Expected/Expected Tomorrow/Expected Initial x7 weekdays.
-- One table, filtered by snapshot_type + snapshot_date instead of picking a tab.
-- =====================================================================================

create table if not exists repayment_snapshots (
  id uuid primary key default gen_random_uuid(),
  ref text not null,
  docket_no text,
  full_name text,
  contact text,
  guarantor_name text,
  guarantor_contact text,
  disb_date date,
  due_date date,
  first_schedule_date date,
  last_schedule_date date,
  last_trans_date date,
  due_summary text,                 -- "4/6" paid/target -- TEXT on purpose, never let this become a date
  initial_inst numeric(14,2),
  other_inst numeric(14,2),
  payment_expected numeric(14,2),
  todays_payment numeric(14,2),
  todays_status text,
  arrears numeric(14,2),
  total_amount numeric(14,2),
  balance numeric(14,2),
  branch text,
  team text references teams(team),
  zone text,
  snapshot_type text not null check (snapshot_type in ('today','tomorrow','yesterday','initial')),
  snapshot_date date not null,
  upload_batch uuid,                -- one uuid per upload; readers take the latest batch of the latest date, so a same-date re-upload supersedes instead of doubling. NULL = pre-batch legacy rows, resolved the same way.
  created_at timestamptz not null default now()
);
create index if not exists idx_repay_snap_lookup on repayment_snapshots(snapshot_type, snapshot_date, team);
create index if not exists idx_repay_snap_ref on repayment_snapshots(ref, snapshot_date);
create index if not exists idx_repay_snap_batch on repayment_snapshots(snapshot_type, snapshot_date, upload_batch);

-- =====================================================================================
-- DEFAULTER SNAPSHOTS -- replaces Defaulters/Defaulters Initial x7 weekdays x Initial/Current.
-- =====================================================================================

create table if not exists defaulter_snapshots (
  id uuid primary key default gen_random_uuid(),
  ref text not null,
  docket_no text,
  full_name text,
  contact text,
  guarantor_name text,
  guarantor_contact text,
  disb_date date,
  expire_date date,
  chronic_date date,
  due_date date,
  last_trans_date date,
  status text,                      -- Defaulter / Chronic / Expired / Partial Defaulter
  ds text,                          -- "3/6" paid/target -- TEXT, never a date (see note below)
  dc integer,
  days_elapsed integer,
  initial_inst numeric(14,2),
  other_inst numeric(14,2),
  payment_exp numeric(14,2),
  t_payment numeric(14,2),
  arrears numeric(14,2),
  balance numeric(14,2),
  branch text,
  team text references teams(team),
  zone text,
  nearest_landmark text,
  snapshot_type text not null check (snapshot_type in ('initial','current')),
  weekday text check (weekday in ('MON','TUE','WED','THU','FRI','SAT','SUN')),
  snapshot_date date not null,
  upload_batch uuid,                -- same scheme as repayment_snapshots: latest batch of the latest date wins on read
  created_at timestamptz not null default now()
);
create index if not exists idx_def_snap_lookup on defaulter_snapshots(snapshot_type, weekday, snapshot_date, team);
create index if not exists idx_def_snap_ref on defaulter_snapshots(ref, snapshot_date);
create index if not exists idx_def_snap_batch on defaulter_snapshots(snapshot_type, weekday, snapshot_date, upload_batch);
-- NOTE: the D.S "Excel turns 3/6 into a date" bug that ate several rounds of the old
-- system simply can't happen here -- `ds` is a real TEXT column with no implicit type
-- coercion. This entire bug class is structurally gone, not just guarded against.

-- =====================================================================================
-- FOLLOWUP -- current state per customer (mirrors your live "Defaulters Followup" tab)
-- plus the append-only comment history behind it.
-- =====================================================================================

create table if not exists followup_status (
  ref text primary key,
  team text references teams(team),
  full_name text,
  contact text,
  guarantor_name text,
  guarantor_contact text,
  disb_date date,
  last_trans date,
  status text,
  ds text,
  dc integer,
  days_elapsed integer,
  rejesho numeric(14,2),
  arrears numeric(14,2),
  fu_status text,
  promise_date date,
  promise_amt numeric(14,2),
  last_comment text,
  comment_by text,
  comment_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists followup_comments (
  id uuid primary key default gen_random_uuid(),
  ref text not null references followup_status(ref) on delete cascade,
  docket_no text,
  team text,
  full_name text,
  comment text,
  fu_status text,
  promise_date date,
  promise_amt numeric(14,2),
  new_number text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_fu_comments_ref on followup_comments(ref, created_at desc);
-- The phones' number index rebuild asks for the few hundred comments carrying a replacement
-- number out of the whole history; the partial index holds only those rows. The predicate
-- matches the query's own filters exactly, which is what lets the planner use it.
create index if not exists idx_fu_comments_new_number on followup_comments(new_number)
  where new_number is not null and new_number <> '';

-- =====================================================================================
-- OPERATIONAL TABLES -- payments, complaints, restructuring, demand notices
-- =====================================================================================

create table if not exists received_payments (
  id uuid primary key default gen_random_uuid(),
  paid_at date,
  team text,
  customer_name text,
  customer_no text,
  transaction_id text,
  ref_no text,
  amount_paid numeric(14,2),
  payment_no text,
  sender_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_received_ref on received_payments(ref_no);
-- The money table is read by paid_at RANGE on every dashboard weekly strip, the Received
-- export, abnormal payments and the upload dup-check -- without this, each was a full scan.
create index if not exists idx_received_paid_at on received_payments(paid_at);

create table if not exists abnormal_payments (
  id uuid primary key default gen_random_uuid(),
  gmo text, team text, pmo text,
  contact_no text, phone_number text,
  ref_no text, ref_id text,
  customer_name text, sender_name text,
  transaction_id text,
  paid numeric(14,2),
  payment text,
  created_at timestamptz not null default now()
);

create table if not exists complaints (
  id uuid primary key default gen_random_uuid(),
  ref text, team text,
  complainant text, phone text,
  category text, channel text, details text,
  status text default 'Open',
  resolution text,
  logged_by text,
  resolved_by text, resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- The calls app reads a customer's complaints on EVERY card open (an officer must see an
-- open complaint before dialling), and the portal reads them by ref too.
create index if not exists idx_complaints_ref on complaints(ref, created_at desc);

create table if not exists complaint_log (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid references complaints(id) on delete cascade,
  team text, action text, note text, status text,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists restructures (
  id uuid primary key default gen_random_uuid(),
  ref text, team text, full_name text, contact text,
  guarantor text, guarantor_contact text,
  arrears numeric(14,2), dc integer,
  first_inst numeric(14,2), remaining numeric(14,2),
  interest_on text, interest_amt numeric(14,2), total numeric(14,2),
  installments integer, inst_amt numeric(14,2),
  start_date date,
  status text default 'Pending',
  requested_by text,
  approved_by text, approved_at timestamptz,
  reject_reason text, notes text,
  created_at timestamptz not null default now()
);

create table if not exists demand_notices (
  id uuid primary key default gen_random_uuid(),
  ref text, team text, full_name text, contact text,
  notice_date date, notice_days integer,
  paid_count integer, fine numeric(14,2),
  principal_remaining numeric(14,2), total_demand numeric(14,2),
  arrears_at_notice numeric(14,2), other_inst numeric(14,2),
  issued_by text,
  created_at timestamptz not null default now()
);

-- =====================================================================================
-- HOPE CALLS -- one table for logs, no weekly archive gymnastics needed. Postgres
-- doesn't have a 10-million-cell ceiling; this can hold years of call history and
-- still answer "this week's totals" instantly off the index below.
-- =====================================================================================

create table if not exists call_users (
  user_id text primary key,
  name text,
  team text references teams(team),
  role text,
  is_leader boolean not null default false,
  leader_teams text[],
  device_id text,
  phone text unique,
  registered_at timestamptz not null default now(),
  last_sync timestamptz,
  last_ts bigint
);

create table if not exists call_logs (
  id text primary key,             -- deterministic hash id, same scheme as before: dedup by construction, not by a lock racing a read
  user_id text references call_users(user_id),
  officer text,
  team text,
  phone text,
  direction text check (direction in ('IN','OUT')),
  call_date date not null,
  call_time time,
  duration integer default 0,
  portfolio boolean default false,
  match_type text,
  ref text,
  customer text,
  synced_at timestamptz not null default now(),
  outcome text check (outcome in ('CONNECTED','MISSED','REJECTED','BLOCKED')),
  category text check (category in ('EXPECTED','DEFAULTER'))
);
create index if not exists idx_call_logs_date_team on call_logs(call_date, team);
create index if not exists idx_call_logs_user_date on call_logs(user_id, call_date);

-- =====================================================================================
-- ANNOUNCEMENTS (image and/or text takeover)
-- =====================================================================================

create table if not exists announcement (
  id boolean primary key default true check (id),   -- singleton row pattern -- there's only ever one active announcement
  image_url text,
  text text,
  is_on boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into announcement (id) values (true) on conflict do nothing;

-- =====================================================================================
-- Row Level Security -- OFF by default here since access control currently lives in
-- your access-code layer at the API level (see api/lib/auth.ts), matching how Code.gs
-- does it today. Turn RLS on per-table once the API layer is trusted end-to-end; see
-- ARCHITECTURE.md "Auth" section for the two supported paths.
-- =====================================================================================
