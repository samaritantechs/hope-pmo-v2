/* =====================================================================================
   WHERE AM I? -- one query, the whole truth, before touching anything.
   =====================================================================================

   Safe to run at any time. It reads catalogue metadata only: no table is created, altered,
   dropped or even selected from. Run it whenever the install is not behaving and paste the
   result back rather than describing it.

   IT EXISTS BECAUSE GUESSING COST AN HOUR. `hopeloan.customers does not exist` was read as
   "the tables went to public", when in fact they existed in NEITHER schema and the origination
   file had simply never completed. One error message is half a diagnosis; this is the other
   half, and it asks about both sides at once so the same mistake cannot be made twice.
   ===================================================================================== */

select 'does the hopeloan schema exist?' as question,
       coalesce((select 'yes' from information_schema.schemata where schema_name = 'hopeloan'),
                'NO -- run RUN-ME-000-create-schema.sql') as answer
union all
select 'is hopeloan exposed to the API?',
       case when exists (
              select 1 from pg_roles
              where rolname = 'authenticator'
                and array_to_string(rolconfig, ',') like '%hopeloan%')
            then 'yes'
            else 'NO -- Project Settings -> API -> Exposed schemas -> add hopeloan' end
union all
select 'tables in public (the live book)',
       (select count(*)::text from pg_tables where schemaname = 'public')
union all
select 'tables in hopeloan (the sandbox)',
       (select count(*)::text from pg_tables where schemaname = 'hopeloan')
union all
select 'hopeloan.teams  (from RUN-ME-000b)',
       case when to_regclass('hopeloan.teams') is null
            then 'MISSING -- run RUN-ME-000b-clone-schema.sql' else 'present' end
union all
select 'hopeloan.customers  (from RUN-ME-001)',
       case when to_regclass('hopeloan.customers') is null
            then 'MISSING -- run RUN-ME-001-origination.sql' else 'present' end
union all
select 'hopeloan.settings WORKSPACE row',
       case when to_regclass('hopeloan.settings') is null then 'settings table not there yet'
            else coalesce((select value from hopeloan.settings where key = 'WORKSPACE'),
                          'MISSING -- RUN-ME-001 did not finish') end
union all
/* The stray-tables check, so "did it land in public by mistake?" is answered here too rather
   than by a second round trip. Expected answer on a healthy database: none. */
select 'origination tables wrongly in public',
       coalesce((select string_agg(tablename, ', ' order by tablename)
                 from pg_tables
                 where schemaname = 'public'
                   and tablename in ('customers','assessments','guarantors','loan_events',
                                     'reversals','disbursement_windows','carriers',
                                     'payment_imports','manual_adjustments')),
                'none -- good, nothing to undo');

/* READING IT
     every row healthy                      -> sign out and back in; the switch appears
     "hopeloan schema exists = NO"          -> RUN-ME-000
     "exposed to the API = NO"              -> the dashboard step; the switch stays hidden
                                               until this is yes, however complete the rest is
     "hopeloan.teams MISSING"               -> RUN-ME-000b
     "hopeloan.customers MISSING"           -> RUN-ME-001, and READ THE ERROR IT PRINTS
     "origination tables wrongly in public" -> RUN-ME-002-undo-into-public.sql            */
