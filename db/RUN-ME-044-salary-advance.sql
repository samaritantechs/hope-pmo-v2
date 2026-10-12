-- =====================================================================================
-- RUN-ME-044  SALARY ADVANCE: the HOPE advance-request system (the STAFF_FUNDS Google Sheet),
--             moved into the portal -- the staff registry (HR), the request, the approval,
--             the report.
--
--   "I found the this file looks suspicious warning on the google sheet for Hope advance
--    requests. We need to shift that into the app too ... like how we moved the imprests and
--    legal demands.. even the pmo system at large"
--
-- Whole file: new query, paste, Ctrl+A, Run. Under 100 lines on purpose. SAFE TO RE-RUN.
--
--   staff_registry    the sheet's DATABASE tab -- one row per staff, keyed on the staff ID
--                     (JMM/001/2026: initials / running number / registration year). HR
--                     types new staff on the HR staff data tab; the old sheet is uploaded
--                     once (Upload → Staff registry) and keeps its own IDs.
--   advance_requests  the sheet's ADVANCE REQUESTS tab -- one row per request. An officer
--                     picks their own name from their zone's list on the request tab; the
--                     GMO of that zone approves or disapproves; the report lists what was
--                     approved in a window, with the bank accounts for payroll. The old
--                     register is uploaded once (Upload → Advance requests).
--
-- UNTIL THIS IS RUN the four advance tabs say the tables are missing and name this file;
-- nothing else is touched.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

create table if not exists public.staff_registry (
  id               text primary key,                   -- JMM/001/2026
  reg_date         date,                               -- REG-DATE
  name             text not null,                      -- STAFF NAME
  phone            text,
  phone2           text,
  role             text,                               -- ROLE (as the sheet spells it)
  residence        text,
  bank             text,                               -- BANK NAME
  account          text,                               -- ACCOUNTS (text: leading zeros kept)
  zone             text,                               -- ZONE (under a GMO), as Teams & Staff spells it
  nida             text,                               -- NIDA-No, digits as text
  birth_date       date,                               -- from the NIDA number's first 8 digits
  guarantor1       text,                               -- JINA LA MDHAMINI
  guarantor1_phone text,                               -- SIMU YA MDHAMINI
  guarantor2       text,                               -- JINA LA MDHAMINI2
  guarantor2_phone text,                               -- SIMU YA MDHAMINI2
  tin              text,                               -- TIN-No
  nssf             text,                               -- NSSF-No
  status           text not null default 'Active',     -- Active / Inactive
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_by       text,
  updated_at       timestamptz,
  upload_date      date,                               -- the upload stamp, for the sheet's DATABASE tab
  upload_batch     uuid
);
create index if not exists idx_staff_registry_zone   on public.staff_registry (zone, status);
create index if not exists idx_staff_registry_name   on public.staff_registry (name);

create table if not exists public.advance_requests (
  id            uuid primary key default gen_random_uuid(),
  submitted_at  timestamptz not null default now(),    -- the sheet's TIMESTAMP
  staff_id      text,                                  -- STAFF ID
  staff_name    text not null,                         -- STAFF NAME
  staff_role    text,                                  -- TEAM/ROLE
  app_date      date,                                  -- APPLICATION DATE
  amount        numeric(14,2) not null,                -- REQUESTED
  approval      text not null default 'Pending',       -- Pending / Approved / Disapproved
  comment       text,                                  -- the approver's comment
  zone          text,                                  -- ZONE
  code          text,                                  -- CODE: the sheet's zone ADV code, now the sign-in code used
  account       text,                                  -- ACCOUNTS, copied from the registry at request time
  decided_by    text,
  decided_at    timestamptz,
  created_by    text,
  created_at    timestamptz not null default now(),
  upload_date   date,                                  -- the upload stamp, for the sheet's register
  upload_batch  uuid
);
-- The approval pane reads pending by zone; the report reads a window; the one-per-month
-- rule reads a staff's own requests.
create index if not exists idx_advance_requests_at    on public.advance_requests (submitted_at desc);
create index if not exists idx_advance_requests_zone  on public.advance_requests (zone, approval, submitted_at desc);
create index if not exists idx_advance_requests_staff on public.advance_requests (staff_id, submitted_at desc);

-- Proof: both tables answer, empty until the sheets are uploaded or the first staff is typed.
select (select count(*) from public.staff_registry) as staff_rows,
       (select count(*) from public.advance_requests) as advance_rows;
