-- =====================================================================================
--  RUN ME.  Everything outstanding, in one paste.
-- =====================================================================================
--
--  WHAT THIS IS
--  Five migrations were written separately, each optional, each explaining itself on screen
--  until it is run. Pasting five files in the right order is five chances to skip one, so this
--  is all five in order, verbatim, with a check at the end that tells you what landed.
--
--  HOW TO RUN IT
--    1. Supabase dashboard -> SQL Editor -> New query
--    2. Paste this whole file
--    3. Run
--    4. Read the table it prints at the bottom. Every row should say YES.
--
--  IT IS SAFE TO RUN TWICE. Every statement is `if not exists` or `create or replace`. Running
--  it again on a database that already has everything changes nothing and takes no longer.
--
--  IT IS INSTANT. Nothing here builds an index over existing rows or rewrites a table:
--  defining a function reads nothing, and adding a nullable column with no default is a
--  catalogue change. This is the reason it can be one paste at all -- the ONE migration that
--  does take time is deliberately NOT in here (see the note at the bottom).
--
--  NOTHING BREAKS IF IT FAILS HALF WAY. Each piece is independent: the features whose
--  migrations ran start working, the rest go on saying which file they need. There is no state
--  in which a half-run leaves a wrong figure on a screen.
--
--  WHAT IT SWITCHES ON
--    1. Team-day totals          the sums move into the database -- the screens stop carrying
--                                161,000 rows to add them up here
--    2. Team contacts            region, zone, and a phone number beside every role -- the
--                                number the demand message prints
--    3. Summary uploads          a day can be uploaded as the company's summary sheet when the
--                                full export was missed
--    4. Audit log               who did what
--    5. Performance records      best team and leader, weekly/monthly/yearly, recorded as they
--                                were at the time
-- =====================================================================================



-- #####################################################################################
-- ##  1 of 5 -- TEAM-DAY TOTALS
-- ##  db/migrations/2026-08-05-snapshot-totals.sql
-- #####################################################################################

-- =====================================================================================
-- THE SUMS ARE WORKED OUT IN THE DATABASE, NOT IN THE WEB SERVER.
--
-- WHY
-- The Dashboard, the Weekly report and the Presentation are pure arithmetic: money and
-- headcounts added up per team, per day. Not one customer's name, phone or balance appears
-- anywhere on any of them. Yet each of those screens was fetching EVERY SNAPSHOT ROW of the
-- week -- around 161,000 of them on this book -- across the internet into the web server's
-- memory, adding them up there, and throwing them away.
--
-- The database is 150 MB, fully indexed and analysed, and it can add up a column without
-- sending it anywhere. Sending it is the expensive part: 161,000 rows have to be serialised
-- by PostgREST, carried over HTTPS, parsed into JavaScript objects and held in memory all at
-- once. That is the HTTP 504s, and it is what was consuming three-quarters of the hosting
-- plan's memory allowance -- at 100% the whole project is paused.
--
-- These two functions return ONE ROW PER (day, type, weekday, team, upload batch) with the
-- figures already added up: roughly two hundred rows for a week instead of a hundred and
-- sixty thousand. Same numbers, three orders of magnitude less to carry.
--
-- WHAT THEY DELIBERATELY DO NOT DO: resolve which upload wins.
-- Every read in this system takes the latest snapshot_date and then the latest upload_batch
-- within it, so a corrected re-upload supersedes rather than doubles. That rule lives in
-- JavaScript (api/_lib/snapshots.js) and is applied at four subtly different groupings by
-- different screens. Re-implementing it here would be a second copy that could drift, and a
-- drift in THAT rule silently doubles a figure. So every group keeps its `upload_batch` and
-- the newest `created_at` inside it, and the existing JavaScript picks the winning batch from
-- these summed rows exactly as it did from the raw ones -- same function, same comparison,
-- fewer rows to compare.
--
-- WHAT "COLLECTED" MEANS, and why it is spelled out again here.
-- It is the rule in api/_lib/recovery.js, character for character:
--   PAID / OVERPAID  -> the expected amount only, never the overpayment
--   UNDERPAID        -> expected minus arrears, clamped into [0, expected]
--   anything else    -> 0
-- and uncollected is expected minus that, clamped at 0 per row before it is summed -- which
-- is what makes the total incapable of going negative. Two homes for one rule is a risk, so
-- test/snapshot-totals.test.mjs computes both ways over the same book and fails if they ever
-- disagree by so much as a shilling.
--
-- ON EXACTNESS: Postgres adds `numeric` in exact decimal, JavaScript adds in binary floating
-- point. Every amount in this system is whole shillings, where both are exact and agree to
-- the shilling. Fractions of a cent are the only place they could differ, and there are none.
--
-- OPTIONAL, LIKE EVERY MIGRATION HERE. Until it is run, the screens read the rows and add
-- them up themselves exactly as they always have -- slowly. Nothing breaks by this being
-- late, and nothing has to be re-deployed after it is run.
--
-- SAFE TO RE-RUN. Creates no tables and touches no data.
--
-- THIS FILE CREATES NOTHING BUT FUNCTIONS, AND THAT IS DELIBERATE.
-- It first shipped with two CREATE INDEX statements at the bottom, and pasting the whole
-- thing into the Supabase SQL editor answered:
--
--     Failed to run sql query: Connection terminated due to connection timeout
--
-- Building an index takes a lock on a table that is being written to and can run for minutes;
-- the editor's connection gives up long before Postgres does, and because the editor sends a
-- whole script as ONE statement, that timeout rolled back the functions too. Nothing was
-- created, and the message named neither the statement nor the table.
--
-- So the two halves are separated by how long they take, not by what they are about. This
-- half is instant -- defining a function reads no rows and locks nothing -- and it is the half
-- that actually makes the screens cheap. The indexes are in
-- `2026-08-05b-snapshot-totals-indexes.sql`, run a line at a time and built without blocking.
-- They are a refinement, not a requirement: see that file for what they buy and what already
-- covers it without them.
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- EXPECTED (repayment_snapshots): what was due, what came in, what did not.
--
-- p_type   'today' / 'initial' / 'tomorrow' / 'yesterday', or NULL for every type
-- p_teams  the teams the caller may see, or NULL for somebody who sees them all. Team
--          scoping happens HERE, at the database, the same as every other read -- a team
--          filter applied after the rows arrive is not a filter, it is a download.
-- ------------------------------------------------------------------------------------
create or replace function expected_snapshot_totals(
  p_from date,
  p_to date,
  p_type text default null,
  p_teams text[] default null
) returns table (
  snapshot_date date,
  snapshot_type text,
  team text,
  upload_batch uuid,
  created_at timestamptz,
  customers bigint,
  expected_amt numeric,
  collected_amt numeric,
  uncollected_amt numeric,
  paid_n bigint,
  over_n bigint
)
language sql
stable
-- A function with no search_path of its own resolves table names against whatever the caller
-- happens to have set, which is what Supabase's advisor flags as "Function Search Path
-- Mutable". Pinning it means this function always reads the tables it was written for.
set search_path = public, pg_catalog
as $$
  with rows_ as (
    select
      s.snapshot_date,
      s.snapshot_type,
      s.team,
      s.upload_batch,
      s.created_at,
      coalesce(s.payment_expected, 0)               as e,
      upper(btrim(coalesce(s.todays_status, '')))   as st,
      coalesce(s.arrears, 0)                        as a
    from public.repayment_snapshots s
    where s.snapshot_date >= p_from
      and s.snapshot_date <= p_to
      and (p_type  is null or s.snapshot_type = p_type)
      and (p_teams is null or s.team = any (p_teams))
  ), collected_ as (
    select
      r.*,
      case
        when r.st in ('PAID', 'OVERPAID') then r.e
        -- least(greatest(...)) in this order, not the other way round: it is the exact order
        -- collectedOf() clamps in, and the two orders differ when `expected` is negative.
        when r.st = 'UNDERPAID'           then least(greatest(r.e - r.a, 0), r.e)
        else 0
      end as col
    from rows_ r
  )
  select
    c.snapshot_date,
    c.snapshot_type,
    c.team,
    c.upload_batch,
    max(c.created_at)                                     as created_at,
    count(*)::bigint                                      as customers,
    sum(c.e)                                              as expected_amt,
    sum(c.col)                                            as collected_amt,
    sum(greatest(c.e - c.col, 0))                         as uncollected_amt,
    count(*) filter (where c.st = 'PAID')::bigint         as paid_n,
    count(*) filter (where c.st = 'OVERPAID')::bigint     as over_n
  from collected_ c
  group by c.snapshot_date, c.snapshot_type, c.team, c.upload_batch
$$;

-- ------------------------------------------------------------------------------------
-- DEFAULTERS (defaulter_snapshots): the arrears on a deck, and how many customers carry them.
--
-- Grouped by weekday as well as date and type, because the decks are per weekday and the
-- recovered figure is only honest when an initial deck is compared against the current deck
-- OF THE SAME WEEKDAY. A Monday baseline against a Thursday deck reports the gap between two
-- different populations as recovery -- that is the mistake that once produced -194 million.
-- ------------------------------------------------------------------------------------
create or replace function defaulter_snapshot_totals(
  p_from date,
  p_to date,
  p_type text default null,
  p_teams text[] default null,
  p_weekday text default null
) returns table (
  snapshot_date date,
  snapshot_type text,
  weekday text,
  team text,
  upload_batch uuid,
  created_at timestamptz,
  customers bigint,
  arrears_amt numeric
)
language sql
stable
set search_path = public, pg_catalog
as $$
  select
    s.snapshot_date,
    s.snapshot_type,
    s.weekday,
    s.team,
    s.upload_batch,
    max(s.created_at)             as created_at,
    count(*)::bigint              as customers,
    sum(coalesce(s.arrears, 0))   as arrears_amt
  from public.defaulter_snapshots s
  where s.snapshot_date >= p_from
    and s.snapshot_date <= p_to
    and (p_type    is null or s.snapshot_type = p_type)
    and (p_weekday is null or s.weekday       = p_weekday)
    and (p_teams   is null or s.team = any (p_teams))
  group by s.snapshot_date, s.snapshot_type, s.weekday, s.team, s.upload_batch
$$;

-- ------------------------------------------------------------------------------------
-- BELT AND BRACES, AND USUALLY UNNECESSARY -- run these LAST, and one at a time.
--
-- Postgres already grants EXECUTE on a new function to PUBLIC, and anon / authenticated /
-- service_role are all covered by that. These two lines only matter on a database whose
-- default privileges have been changed. They are here because "usually" is not "always", and
-- a function the app may not call fails in a way nothing on screen explains.
--
-- If they time out -- and on a busy database they can -- CHECK BEFORE RETRYING. The query
-- below reads only the catalogue, takes no locks and answers instantly, and it will normally
-- tell you these grants were never needed:
--
--   select p.proname,
--          has_function_privilege('service_role', p.oid, 'execute') as service_role_may_call,
--          has_function_privilege('anon',         p.oid, 'execute') as anon_may_call
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('expected_snapshot_totals', 'defaulter_snapshot_totals');
--
-- Two rows with `true` means the work is done. Nothing else is needed and these two lines can
-- be skipped entirely.
--
-- AND IF THEY ARE NEVER RUN AT ALL, nothing breaks. A function the app is refused permission
-- to call reads to it exactly like a function that does not exist, and both fall back to
-- reading the rows and adding them up here -- slowly, as it always did. There is no state in
-- which a missing grant produces a wrong figure or an error on a screen.
-- ------------------------------------------------------------------------------------
grant execute on function expected_snapshot_totals(date, date, text, text[])
  to anon, authenticated, service_role;

grant execute on function defaulter_snapshot_totals(date, date, text, text[], text)
  to anon, authenticated, service_role;

-- THAT IS THE WHOLE FILE. Both functions exist now, and every screen that reads team-day
-- totals is using them from the next request -- nothing to re-deploy, nothing to switch on.
--
-- The indexes that make them faster still are in 2026-08-05b-snapshot-totals-indexes.sql,
-- which has to be run differently because it is the part that takes time.


-- #####################################################################################
-- ##  2 of 5 -- TEAM CONTACTS
-- ##  db/migrations/2026-08-09-team-contacts.sql
-- #####################################################################################

-- =====================================================================================
-- THE TEAMS TABLE LEARNS PHONE NUMBERS, AND WHERE THE TEAM IS.
--
-- WHY
-- Two things asked for at once, and they turn out to be the same thing.
--
-- 1. The Teams & Staff screen is meant to match the offline sheet the PMO already keeps:
--       SN · region · zone · TEAM · OPM · OPM No · RECOVERY · GMO · GMO No · MANAGER ·
--       Manager No · CREDIT · C. ANALYST · EXPECTED · Expected no · bike · Bike No ·
--       legal · Legal No · Collection · Col No
--    Every second column on that sheet is a phone number, and this table had none of them --
--    so the sheet could not be typed in here, and it went on living in a spreadsheet where
--    nothing else in the system can read it.
--
-- 2. The demand-message button needs a number to print:
--       "Kwa maelezo Zaidi piga <number>"
--    A demand notice telling a customer to ring a number nobody answers is worse than no
--    notice at all, so the number has to be the one belonging to whoever is actually chasing
--    them -- which is exactly the column this sheet has always carried and the database
--    never did.
--
-- WHAT IT ADDS -- nothing but columns, all nullable, no defaults, no data touched.
--
--   region, zone          where the team is. The sheet's first two columns.
--   *_no                  one phone number per role that already has a name column here.
--   legal, legal_no       the legal officer, who had no column at all.
--   collection, collection_no
--                         the collection officer's NAME is normally on their access code --
--                         one person holds thirty teams, so it is a list on the person rather
--                         than their name repeated thirty times. These two are here so the
--                         offline sheet can be typed in whole, and so a team whose collection
--                         officer is not an app user still has a number to print.
--
-- OPTIONAL, LIKE EVERY MIGRATION HERE. Until it is run, saveTeam drops these fields rather
-- than sending them -- the same guard credit_id has had since 2026-08-04 -- so the screen
-- keeps saving everything else and nothing breaks by this being late. Run it and the fields
-- start saving on the next request. Nothing has to be re-deployed.
--
-- SAFE TO RE-RUN. `if not exists` on every line.
--
-- INSTANT. Adding a nullable column with no default rewrites nothing in Postgres -- it is a
-- catalogue change. Unlike the index migration, this one can go in as a single paste.
-- =====================================================================================

alter table teams add column if not exists region text;
alter table teams add column if not exists zone text;

alter table teams add column if not exists opm_no text;
alter table teams add column if not exists recovery_no text;
alter table teams add column if not exists gmo_no text;
alter table teams add column if not exists manager_no text;
alter table teams add column if not exists credit_no text;
alter table teams add column if not exists expected_no text;
alter table teams add column if not exists bike_no text;

alter table teams add column if not exists legal text;
alter table teams add column if not exists legal_no text;

alter table teams add column if not exists collection text;
alter table teams add column if not exists collection_no text;

-- DID IT LAND? Reads the catalogue only, takes no locks, answers instantly.
--
-- select column_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'teams'
-- order by ordinal_position;
--
-- Expect the seven columns that were always there (team, opm, recovery, gmo, manager, credit,
-- expected, bike, updated_at), plus team_code and credit_id from earlier migrations, plus the
-- thirteen above.


-- #####################################################################################
-- ##  3 of 5 -- SUMMARY UPLOADS
-- ##  db/migrations/2026-08-09b-snapshot-summaries.sql
-- #####################################################################################

-- =====================================================================================
-- A DAY CAN BE UPLOADED AS A SUMMARY INSTEAD OF A CUSTOMER LIST.
--
-- WHY
--   "Sometimes I fall asleep and miss the latest defaulters and expected report files from the
--    company system and that costs me report accuracy since teams already collected and
--    recovered too. So I need at uploading I choose to upload summary or customers ... if I
--    upload summary the latest defaulters lists stay but the latest list/summary uploaded is
--    the one used for reports"
--
-- The customer lists are the working documents -- the phone's call lists, the follow-up tab,
-- the recycling rotation all need names and numbers. But the REPORTS are pure arithmetic:
-- money per team per day. When the full export is missed, the company's own summary sheet
-- carries those figures and nothing else, and it is enough to make every report right.
--
-- THE SHAPE IS DELIBERATE. These columns are exactly what expected_snapshot_totals and
-- defaulter_snapshot_totals return, and exactly what foldExpected/foldDefaulter produce -- one
-- row per (day, type, weekday, team, upload batch), figures already added up.
--
-- That is what makes this small. A summary is not a second kind of answer that has to be
-- merged with the first: it is MORE ROWS OF THE SAME ANSWER, carrying their own upload_batch
-- and created_at, handed to the batch rule that already decides which upload wins. Upload a
-- summary after a list and the summary is newer, so it wins. Upload the list again afterwards
-- and the list wins. "The latest list/summary uploaded is the one used" is not a new rule --
-- it is the rule this system has always had, applied across one more source.
--
-- The customer lists are untouched by any of this, exactly as asked: the phone, the follow-up
-- tab and the rotation go on reading them whatever the reports are using.
--
-- WHAT A SUMMARY CANNOT SAY: how many people. `customers` is null because the sheet has no
-- headcount in it -- an upload of money is not an upload of a list. Screens reading a summary
-- day show its money and no customer count, which is the truth, rather than a zero that would
-- read as "everybody cleared".
--
-- OPTIONAL, LIKE EVERY MIGRATION HERE. Until it is run, the Summary options on the upload
-- screen fail with a plain message naming this file, and everything else works exactly as it
-- does today.
--
-- SAFE TO RE-RUN. INSTANT -- creates one empty table and two indexes on it.
-- =====================================================================================

create table if not exists snapshot_summaries (
  id uuid primary key default gen_random_uuid(),

  -- 'expected' reads against repayment_snapshots; 'defaulter' against defaulter_snapshots.
  kind text not null check (kind in ('expected', 'defaulter')),

  -- The same vocabulary the snapshot tables use, so a summary and a list of the same day are
  -- directly comparable: 'today' / 'tomorrow' / 'yesterday' / 'initial' for expected,
  -- 'initial' / 'current' for defaulters.
  snapshot_type text not null,
  snapshot_date date not null,

  -- Defaulters only. The decks are per weekday and recovery is only honest when an initial
  -- deck is compared against the current deck OF THE SAME WEEKDAY -- so a summary has to carry
  -- it too, or it could not be paired at all.
  weekday text,

  team text references teams(team),

  /* NULL, ALWAYS, ON A SUMMARY. Kept as a column so these rows are the same shape as the
     totals functions' output and need no special case anywhere that reads them. */
  customers bigint,

  -- Expected: what was due, what came in, what did not.
  expected_amt numeric(16,2),
  collected_amt numeric(16,2),
  uncollected_amt numeric(16,2),

  -- Defaulters: what the deck owed.
  arrears_amt numeric(16,2),

  upload_batch uuid,
  created_at timestamptz not null default now()
);

-- The two reads: a range for the week-long screens, and one day for the rest. Both lead on the
-- date because both filter on a range of it, which is the shape the snapshot indexes learned
-- the hard way in 2026-08-05b.
create index if not exists idx_snap_summ_range on snapshot_summaries(kind, snapshot_date, snapshot_type);
create index if not exists idx_snap_summ_team on snapshot_summaries(team, snapshot_date);

-- Usually unnecessary -- Postgres grants EXECUTE and SELECT through the default privileges
-- Supabase ships with. Here for the same reason as the grants in 2026-08-05: "usually" is not
-- "always", and a table the app may not read fails in a way nothing on screen explains.
grant select, insert, update, delete on table snapshot_summaries to anon, authenticated, service_role;

-- DID IT LAND?
-- select count(*) from snapshot_summaries;


-- #####################################################################################
-- ##  4 of 5 -- AUDIT LOG
-- ##  db/migrations/2026-08-09c-audit-log.sql
-- #####################################################################################

-- =====================================================================================
-- WHO DID WHAT.
--
--   "Add an audit log nav and start with access for admin only, I may tyick it to be seen on
--    others via settings as usual so that we know who did what"
--
-- Every change to this system already goes through ONE door -- portalApi dispatches every
-- function the portal can call -- so the log is written in one place and cannot be forgotten
-- at the hundredth call site. What it records is the ACT, not the data: who, what they called,
-- which customer or team or setting it concerned, and whether it worked.
--
-- WHAT IT DELIBERATELY DOES NOT STORE
--
--   Amounts, names, phone numbers, comment text. An audit log is read by whoever is allowed to
--   see the log, and a log that carries the arguments in full becomes a second, unguarded copy
--   of the customer book -- readable by anyone the switch is ever ticked for. So the arguments
--   are reduced to the few identifying fields (ref, team, key, code, role) and everything else
--   is dropped. "JUMA G saved a follow-up on customer 4471" is what a supervisor needs; the
--   comment itself is already in followup_comments where the team scoping applies.
--
--   READS ARE NOT LOGGED EITHER. Two hundred officers opening a dashboard every few minutes
--   would bury the twelve writes a day that matter, and the point of this table is to be
--   readable by a person. It records the calls that CHANGE something.
--
-- OPTIONAL, LIKE EVERY MIGRATION HERE. Until it is run, the write is skipped silently -- an
-- audit log that could break a save would be worse than no audit log, because it would turn
-- every write in the system into two things that must both succeed. The nav tab shows an empty
-- table naming this file.
--
-- SAFE TO RE-RUN. INSTANT -- one empty table and two indexes.
-- =====================================================================================

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),

  at timestamptz not null default now(),

  -- WHO. The code is kept as well as the name because a name can be edited and two people can
  -- share one; the code is what actually signed in.
  actor_code text,
  actor_name text,
  actor_role text,

  -- WHAT. The portal function name -- saveTeam, deleteAccessCode, commissionSave -- which is
  -- the vocabulary the rest of the system is written in, so a line in this table can always be
  -- traced to the code that produced it.
  action text not null,

  -- WHICH. The few identifying fields, never the payload. Any of them may be null.
  ref text,
  team text,
  subject text,                     -- a settings key, a role name, an access code, a team name

  ok boolean not null default true,
  error text,                       -- the message a failed attempt produced, trimmed

  -- A failed attempt is worth MORE than a successful one, not less: somebody trying to delete a
  -- team they may not touch is exactly what an audit log exists to show.
  ms integer                        -- how long it took, which is how a slow screen gets traced
);

-- The two ways anyone reads this: newest first, and everything one person did.
create index if not exists idx_audit_at on audit_log(at desc);
create index if not exists idx_audit_actor on audit_log(actor_code, at desc);

grant select, insert on table audit_log to anon, authenticated, service_role;

-- DID IT LAND?
-- select count(*) from audit_log;


-- #####################################################################################
-- ##  5 of 5 -- PERFORMANCE RECORDS
-- ##  db/migrations/2026-08-09d-performance-records.sql
-- #####################################################################################

-- =====================================================================================
-- WHO WAS BEST, AND WHEN -- WRITTEN DOWN AT THE TIME.
--
--   "By using Sales, Collection and Recovery, the system needs to always keep record of best
--    team and leaders weekly, monthly and yearly progress regardless of future leader table
--    alterations."
--
-- THE LAST FIVE WORDS ARE THE WHOLE DESIGN.
--
-- Every report in this system resolves a leader by looking them up in the teams table NOW.
-- That is right for today's work -- move a GMO onto ten new teams and every board re-points
-- with them, which is what makes a reassignment a one-field edit. But it means the past is
-- rewritten every time somebody is moved: last March's best recovery officer becomes whoever
-- holds those teams today, and the person who actually earned it disappears from their own
-- record.
--
-- So this table stores the leader's NAME AND POSITION AS TEXT, copied at the moment the period
-- was recorded. It is a photograph, not a pointer. Move them tomorrow, rename a team, delete a
-- role -- last March still says what last March said, which is the only thing that makes a
-- year's records worth keeping.
--
-- WHAT IT RECORDS
--   period   'week' | 'month' | 'year', with the date it starts on
--   metric   'sales' | 'collection' | 'recovery' -- the three the question named
--   scope    'team' | 'leader'
--   name     the team, or the person, as they were called then
--   position the role they held then ('RECOVERY', 'GMO'...) -- blank for a team row
--   value    the money, and `basis` the denominator where the metric is a percentage
--
-- ONE ROW PER (period, period_start, metric, scope, name), so re-recording a period in progress
-- updates rather than accumulating. A week is written many times while it is running and
-- settles on its final figures when it ends -- which is exactly how a record of "this week"
-- should behave.
--
-- OPTIONAL, LIKE EVERY MIGRATION HERE. Until it is run nothing is recorded and nothing breaks;
-- the tab says which file to run.
--
-- SAFE TO RE-RUN. INSTANT.
-- =====================================================================================

create table if not exists performance_records (
  id uuid primary key default gen_random_uuid(),

  period text not null check (period in ('week', 'month', 'year')),
  period_start date not null,

  metric text not null check (metric in ('sales', 'collection', 'recovery')),
  scope text not null check (scope in ('team', 'leader')),

  -- AS TEXT, ON PURPOSE. Not a reference to teams(team) either: a team that is renamed or
  -- deleted next year must not take its own history with it.
  name text not null,
  position text,

  value numeric(18,2) not null default 0,
  basis numeric(18,2),                 -- the denominator, where the metric is a percentage
  pct numeric(6,2),

  recorded_at timestamptz not null default now()
);

-- One row per period per metric per name -- so a period in progress is UPDATED as it runs
-- rather than written again every time somebody opens the report.
create unique index if not exists uq_perf_record
  on performance_records(period, period_start, metric, scope, name);

-- How it is read: a period at a time, best first.
create index if not exists idx_perf_period on performance_records(period, period_start, metric, value desc);

grant select, insert, update on table performance_records to anon, authenticated, service_role;

-- DID IT LAND?
-- select period, period_start, metric, scope, name, value from performance_records
-- order by period_start desc, metric limit 20;


-- =====================================================================================
--  DID IT ALL LAND?
--
--  Reads the catalogue only -- no rows, no locks, answers instantly. Every row should say YES.
--  A NO means that piece did not run; scroll up to its section, run that section alone, and
--  read the error. The other four are unaffected either way.
-- =====================================================================================
select 'Team-day totals (2 functions)' as piece,
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public'
                    and p.proname in ('expected_snapshot_totals', 'defaulter_snapshot_totals')) = 2
            then 'YES' else 'NO' end as installed
union all
select 'Team contacts (phone columns)',
       case when (select count(*) from information_schema.columns
                  where table_schema = 'public' and table_name = 'teams'
                    and column_name in ('region', 'zone', 'recovery_no', 'gmo_no', 'manager_no',
                                        'opm_no', 'credit_no', 'expected_no', 'bike_no',
                                        'legal', 'legal_no', 'collection', 'collection_no')) = 13
            then 'YES' else 'NO' end
union all
select 'Summary uploads (snapshot_summaries)',
       case when to_regclass('public.snapshot_summaries') is not null then 'YES' else 'NO' end
union all
select 'Audit log (audit_log)',
       case when to_regclass('public.audit_log') is not null then 'YES' else 'NO' end
union all
select 'Performance records (performance_records)',
       case when to_regclass('public.performance_records') is not null then 'YES' else 'NO' end
order by piece;


-- =====================================================================================
--  ONE MIGRATION IS DELIBERATELY NOT IN HERE.
--
--  db/migrations/2026-08-05b-snapshot-totals-indexes.sql builds two indexes on the snapshot
--  tables. Index builds are the one thing here that takes MINUTES rather than milliseconds, and
--  they have to be run ONE LINE AT A TIME:
--
--    * Postgres refuses CREATE INDEX CONCURRENTLY inside a transaction, and this editor wraps
--      whatever you paste into one.
--    * The editor's connection gives up before Postgres does. That is what once rolled back the
--      FUNCTIONS along with the indexes, so nothing at all was created and the message named
--      neither the statement nor the table.
--
--  It is also the only optional-optional one: a refinement, not a requirement. The functions
--  above are what make the screens cheap; the indexes make them faster still. Run that file
--  separately, a line at a time, when the system is quiet -- or not at all.
-- =====================================================================================
