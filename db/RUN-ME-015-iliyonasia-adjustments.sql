-- =====================================================================================
-- RUN-ME-015 -- ILIYONASIA: the manual, signed, attributable adjustment, for HOPE PMO.
--
-- "on manual adjustment we have to select date and report type on expected ini/curr or
--  def in/cur and put positive or negative amount" -- so the reports can be made right in
-- the SYSTEM and Excel stops being the place where truth is patched.
--
-- Mirrors HOPE LOAN's manual_adjustments (db/hopeloan/RUN-ME-001, section 11) with the
-- four PMO report targets instead of two. Its own table name, because the HOPE LOAN one may
-- exist in this same database on schema-mode deployments and the two registers must never
-- mix: an adjustment to the loan book is not an adjustment to the PMO book.
--
-- A TABLE, NOT AN EDITABLE CELL. An adjustment that cannot say who made it, when, for which
-- date and why is indistinguishable from an error. The figure is adjustable; the fact that
-- it was adjusted is permanent.
--
-- One paste, seconds. Armored like every dose.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

create table if not exists pmo_adjustments (
  id uuid primary key default gen_random_uuid(),
  adj_date date not null,                        -- the report date the amount belongs to
  target text not null check (target in
    ('expected-initial', 'expected-current', 'defaulter-initial', 'defaulter-current')),
  team text,                                     -- blank = the whole book, not one team
  amount numeric(14,2) not null,                 -- SIGNED: positive adds, negative reduces
  reason text,
  ref text,                                      -- the customer it concerns, when it is one
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pmo_adj on pmo_adjustments(adj_date, target);

-- Proof.
select 'pmo_adjustments' as piece,
       case when to_regclass('public.pmo_adjustments') is null then 'MISSING' else 'ready' end as state;
