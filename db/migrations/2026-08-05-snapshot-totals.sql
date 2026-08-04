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

-- The app reads through PostgREST as the service role; make sure it may call these.
grant execute on function expected_snapshot_totals(date, date, text, text[])
  to anon, authenticated, service_role;
grant execute on function defaulter_snapshot_totals(date, date, text, text[], text)
  to anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------
-- The date range is now the leading filter on both tables, and the existing indexes lead on
-- snapshot_type (and weekday) instead -- which is the right shape for "one deck" and the
-- wrong shape for "a week of them". These two cover the range scan the functions make.
-- ------------------------------------------------------------------------------------
create index if not exists idx_repay_snap_date_type
  on public.repayment_snapshots(snapshot_date, snapshot_type);
create index if not exists idx_def_snap_date_type
  on public.defaulter_snapshots(snapshot_date, snapshot_type);
