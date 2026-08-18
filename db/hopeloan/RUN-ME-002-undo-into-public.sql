/* =====================================================================================
   UNDO: HOPE LOAN'S TABLES LANDED IN `public` INSTEAD OF `hopeloan`.
   =====================================================================================

   WHAT HAPPENED. RUN-ME-000 created the schema, but the two files after it were run WITHOUT
   the `set search_path = hopeloan, public;` line pasted above them -- so every unqualified
   CREATE TABLE went to the default schema, `public`, which is the live book.

   WHAT IT COST: NOTHING. Worth being exact, because "it ran against production" deserves
   better than reassurance:

     db/schema.sql            19 x `create table if not exists`, and every one of those tables
                              already existed -> 19 no-ops. It contains no DROP, no TRUNCATE,
                              no DELETE and no ALTER that removes anything. Not one existing
                              row was read, changed or deleted.

     RUN-ME-001-origination   9 new EMPTY tables in public, 25 new EMPTY columns on public.loans,
                              4 new values on the loan_stage enum, and 3 rows in settings.
                              All additive. Existing queries do not select columns they have
                              never heard of, so HOPE PMO carried on exactly as before.

   So this file is TIDYING, not repair. The only part with any real effect on a screen is the
   three settings rows, which show up in the admin's Settings list and mean nothing there.

   IF YOU WOULD RATHER LEAVE IT: that is a defensible choice. Those nine tables are the ones
   HOPE Loan will eventually need in `public` anyway on the day the two systems merge -- they
   are simply arriving early and empty. Nothing breaks either way.

   ORDER OF WORK
     1. Run the VERIFY block below and read it. Do not skip this.
     2. Only if it says every table is empty, run the CLEANUP block.
     3. Then re-run the real installation, WITH the search_path line this time:
          set search_path = hopeloan, public;   <- paste FIRST, same query
          ...then the whole of db/schema.sql
        and again, in a separate query:
          set search_path = hopeloan, public;
          ...then the whole of db/hopeloan/RUN-ME-001-origination.sql
   ===================================================================================== */


/* -------------------------------------------------------------------------------------
   1. VERIFY -- proves these tables are the empty strays and not something with data in it.
   Every count MUST be 0. If any row shows a count above zero, STOP and do not run the
   cleanup: that table is holding something, and this file is not for it.
   ------------------------------------------------------------------------------------- */
select 'customers'            as table_name, count(*) as rows_must_be_zero from public.customers
union all select 'assessments',           count(*) from public.assessments
union all select 'guarantors',            count(*) from public.guarantors
union all select 'loan_events',           count(*) from public.loan_events
union all select 'reversals',             count(*) from public.reversals
union all select 'disbursement_windows',  count(*) from public.disbursement_windows
union all select 'carriers',              count(*) from public.carriers
union all select 'payment_imports',       count(*) from public.payment_imports
union all select 'manual_adjustments',    count(*) from public.manual_adjustments
order by 1;


/* -------------------------------------------------------------------------------------
   2. CLEANUP -- run ONLY after every count above came back 0.

   `restrict` rather than `cascade`, deliberately: if anything in this database has come to
   depend on one of these tables since, the drop FAILS instead of quietly taking that
   dependency with it. A cascade here would be exactly the kind of tidying that removes
   something nobody meant to lose.
   ------------------------------------------------------------------------------------- */
drop table if exists public.loan_events           restrict;
drop table if exists public.assessments           restrict;
drop table if exists public.guarantors            restrict;
drop table if exists public.reversals             restrict;
drop table if exists public.payment_imports       restrict;
drop table if exists public.manual_adjustments    restrict;
drop table if exists public.disbursement_windows  restrict;
drop table if exists public.carriers              restrict;

/* `customers` goes LAST: public.loans now carries a customer_id foreign key pointing at it,
   so that column has to let go first. The column is empty and unread -- nothing in HOPE PMO
   selects it -- so dropping it takes nothing with it. */
alter table public.loans drop column if exists customer_id;
drop table if exists public.customers restrict;

/* The three rows that actually reach a screen: they appear in the admin's Settings list and
   describe a workspace this database is not. */
delete from public.settings where key in ('WORKSPACE', 'WORKSPACE_LABEL', 'SANDBOX_REF_PREFIX');


/* -------------------------------------------------------------------------------------
   3. WHAT IS DELIBERATELY LEFT ALONE
   -------------------------------------------------------------------------------------
   THE OTHER 24 COLUMNS ON public.loans (docket_ref, funded_at, installment_amt, gmo_remarks
   and so on). They are empty, nothing reads them, and they are columns HOPE PMO will want on
   the day the two systems merge. Dropping a column is the one operation here that could lose
   data if it were ever filled in between now and then -- so they stay. An empty column costs
   nothing; a wrongly dropped one cannot be undone.

   THE FOUR NEW loan_stage VALUES (funded, rejected, reversed, closed). Postgres cannot remove
   a value from an enum without rebuilding the type, and rebuilding a type that a live column
   depends on is real risk for zero benefit. Nothing sets them in production. They stay.
   ------------------------------------------------------------------------------------- */
