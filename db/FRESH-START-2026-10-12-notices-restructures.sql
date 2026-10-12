-- =====================================================================================
-- FRESH START, 2026-10-12 -- EVERY DEMAND NOTICE AND EVERY RESTRUCTURING GOES. ARCHIVED FIRST.
--
-- "I need to delete all existing demand notices and loan restructuring so that we start
--  seriously afresh in hopeloan app today, all the existing were trials to amend things right."
--
-- In every schema that holds the registers (public; hopeloan too if the sandbox was cloned):
--   1. each register is COPIED to trial_<table>_20261012 first -- a trial letter can still be
--      looked up there, and the three archive tables can be dropped whenever you like;
--   2. every row is deleted from demand_notices, notice_payment_ledger (the payments recorded
--      against those notices, RUN-ME-041a) and restructures.
-- Nothing else is touched: the defaulter decks, follow-ups, payments and call logs stay.
-- The Legal and Restructuring tabs open empty, and the first notice today gets a reference
-- with no "-2" suffix, exactly as if none had been issued before.
--
-- ONE PASTE, seconds. Running it twice is safe: the archive is made once, the delete finds
-- nothing. The proof table at the end shows rows left (all 0) and rows archived.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

do $$
declare
  s text; t text; n bigint; arch text;
begin
  foreach s in array array['public', 'hopeloan'] loop
    foreach t in array array['demand_notices', 'notice_payment_ledger', 'restructures'] loop
      if to_regclass(format('%I.%I', s, t)) is null then continue; end if;
      arch := format('trial_%s_20261012', t);
      execute format('select count(*) from %I.%I', s, t) into n;
      execute format('create table if not exists %I.%I as table %I.%I', s, arch, s, t);
      execute format('delete from %I.%I', s, t);
      raise notice '%.%: % rows archived into %.% and deleted', s, t, n, s, arch;
    end loop;
  end loop;
end $$;

-- Proof: what is left in the live registers (expect 0 on every line) and what the archives hold.
select 'public.demand_notices (left)'          as what, count(*) as rows from public.demand_notices
union all select 'public.restructures (left)',            count(*) from public.restructures
union all select 'public.notice_payment_ledger (left)',   count(*) from public.notice_payment_ledger
union all select 'archive: trial_demand_notices_20261012',        count(*) from public.trial_demand_notices_20261012
union all select 'archive: trial_restructures_20261012',          count(*) from public.trial_restructures_20261012
union all select 'archive: trial_notice_payment_ledger_20261012', count(*) from public.trial_notice_payment_ledger_20261012;

-- When the archives are no longer wanted (any day after today), paste these three lines:
--   drop table if exists public.trial_demand_notices_20261012, public.trial_restructures_20261012,
--                        public.trial_notice_payment_ledger_20261012;
