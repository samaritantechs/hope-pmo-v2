-- =====================================================================================
-- RUN-ME-043  PMO DEDUCTIONS: the Portfolio Monitoring form and its register, moved from
--             Google Sheets into the portal.
--
--   "i also want to build the pmo deduction pannel shift from google sheets into the pmo
--    portal"
--
-- Whole file: new query, paste, Ctrl+A, Run. Under 100 lines on purpose. SAFE TO RE-RUN.
--
--   One submission is ONE CASE (a customer, their reference, what was decided, what is to be
--   paid to them) with ONE ROW PER ACCUSED STAFF -- exactly the sheet's shape, where every
--   staff line repeats the case's columns. case_id ties the lines of a submission together.
--
--   The HR columns (hr_notes, deducted, remaining) are empty on submission, as the sheet's
--   N, O and P were; remaining = to_pay − deducted is written the moment HR records the
--   deduction (the sheet's onEdit), by the portal, never by hand.
--
-- UNTIL THIS IS RUN the PMO Deduction tab says the table is missing and names this file;
-- nothing else is touched.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

create table if not exists public.pmo_deductions (
  id             uuid primary key default gen_random_uuid(),
  case_id        text,                               -- one submission, many staff lines
  submitted_at   timestamptz not null default now(), -- the sheet's TIMESTAMP
  dept           text,                               -- PMO DEPT
  reporter       text,                               -- PMO NAME (who reported the case)
  team           text,
  customer       text,                               -- JINA LA MTEJA
  ref            text,                               -- REF NO YA MTEJA
  staff          text,                               -- JINA LA STAFF MTUHUMIWA
  amount_taken   numeric(14,2),                      -- KIASI ALICHOKULA
  received_date  date,                               -- TAREHE ALIYOPOKEA
  discovery_date date,                               -- TAREHE YA UGUNDUZI / KIKAO
  decision       text,                               -- MAAMUZI (MAELEZO)
  deduction      numeric(14,2),                      -- MAKATO (KIASI), proposed per staff
  to_pay         numeric(14,2),                      -- CHA KULIPIWA MTEJA, per case
  hr_notes       text,                               -- HR NOTES
  deducted       numeric(14,2),                      -- DEDUCTED AMOUNT (HR)
  remaining      numeric(14,2),                      -- REMAINING = to_pay − deducted
  hr_by          text,
  hr_at          timestamptz,
  created_by     text,
  created_at     timestamptz not null default now(),
  upload_date    date,                               -- the upload stamp, for a register file
  upload_batch   uuid
);

-- The tab reads a date window scoped by team; the report reads outstanding balances per
-- staff before the window.
create index if not exists idx_pmo_deductions_at    on public.pmo_deductions (submitted_at desc);
create index if not exists idx_pmo_deductions_team  on public.pmo_deductions (team, submitted_at desc);
create index if not exists idx_pmo_deductions_staff on public.pmo_deductions (staff);

-- Proof: the table answers, empty until the register is uploaded or the first case is typed.
select count(*) as rows_now, min(submitted_at) as earliest, max(submitted_at) as latest
from public.pmo_deductions;
