-- =====================================================================================
-- RUN-ME-056 -- THE DASHBOARD'S OWN "EXPECTED DEFAULTERS RECOVERY" CARDS, TEAM-WIDE, BY DAY
-- =====================================================================================
--
--   "Remove the Loan pipeline widget at dashboard replace with expected defaulters recovery
--    cards Monday to Sunday with rising and falling arrows as usual" ... "Am talking of the
--    days performance Monday to Sunday like the cards showing summary of sales and collection
--    per day" -- the owner, 14 Nov 2026.
--
-- Costed and asked before this was built, not guessed: the dashboard holds no per-customer
-- rows at all (every figure on it already comes from team-day TOTALS, defaulterTotalsInRange/
-- expectedTotalsInRange), so a true per-officer Exp.Def figure would mean either reading the
-- whole week's raw decks on every dashboard load the way expdfWeekCore does for the dedicated
-- Exp.Def Report (measured there at two full deck reads PER DAY -- about 13 extra round trips
-- for a five-day week, nearly doubling this screen's own budget), or writing the rotation that
-- decides WHO owns which customer (assign.js's assignFor, configurable live from the settings
-- table) a second time, in SQL -- exactly the "two implementations that can disagree" CLAUDE.md
-- section 2 already names two real blackouts for. The owner confirmed, once asked, that these
-- cards are team-wide day tiles, the same shape as the sales and collection cards beside them,
-- with no officer breakdown -- so neither expensive path is needed: this reads only the ONE
-- existing rule that decides who COUNTS as an Expected Defaulter (buildRows_, api/_lib/expdf.js)
-- and stops there, in SQL, never the assignment on top of it.
--
-- A CUSTOMER COUNTS FOR A DAY when that day's own CURRENT-deck row is Chronic, Expired or
-- (Partial) Defaulter by status text, OR was on that SAME day's own INITIAL deck at all --
-- buildRows_'s exact filter (a row on both decks always satisfies the second half). A
-- current-only row that is neither is not this population and is excluded, the same as
-- buildRows_ excludes it. RECOVERED is a SUM OF PER-CUSTOMER, CLAMPED DIFFERENCES --
-- buildRows_'s own `Math.max(0, initial - arrears)` -- NOT the deck-total subtraction
-- recovery_standing (RUN-ME-032) and the dashboard's own "Weekly recovery trend" tile use. The
-- two are different questions and are ALLOWED TO DISAGREE on the same day, on purpose: a
-- customer whose arrears GREW between decks contributes nothing here (never a negative --
-- Exp.Def's own rule, since #693's "they cant run from when their initial file had them" was
-- never about netting one customer's loss against a stranger's gain), while the deck-total
-- figure nets the whole book against itself. Kept exactly as buildRows_ already has it, not a
-- stricter cousin invented new for this card.
--
-- A customer who drops off the current deck ENTIRELY (a "ghost", RUN-ME-055/#697) is NOT
-- reached here -- ghosts are a live-day, portal-report-only feature; nobody has asked a
-- company-wide dashboard tile to carry them, so this is flagged, not built, rather than
-- silently widening what the owner asked for.
--
-- EXACT DATE-AND-WEEKDAY PAIRING, never "the latest upload on or before" -- the identical
-- day-pairing rule recoveryByTeam (api/_lib/snapshot-totals.js) and the dashboard's own
-- recTrend already use: pairing two different weekdays' decks reports the gap between two
-- different populations as recovery.
--
-- MEASURED on a 2,268,000-row fixture sized like RUN-ME-054/055's own (42 teams, 150 days,
-- two snapshot_types, ~180 customers a team a day): a full week, every team, the worst case an
-- unrestricted admin's own dashboard asks for, reads 294 rows in ~210ms; the common case -- one
-- team's own week, a GMO or manager's sign-in -- in ~43ms. One round trip either way, however
-- many teams, the same discipline RUN-ME-055's own review insisted on. `set enable_bitmapscan
-- = off set enable_seqscan = off` is copied from RUN-ME-032's own recovery_standing, which reads
-- the same table the same way, as a defensive planner hint, not a guess invented fresh here;
-- `set statement_timeout = '2000ms'` is a backstop, about four times the measured worst case,
-- matching the live table RUN-ME-054 found several times bigger than this same fixture size.
--
-- SAFE TO RE-RUN. Until this is run, api/_lib/snapshot-totals.js's expdfRecoveryTotals returns
-- null and the two new dashboard cards read "not yet filed" -- the same behaviour every other
-- unmeasured day on this screen already has, never a failed request and never the expensive
-- raw-row read above that this was written specifically to avoid.
-- =====================================================================================

drop function if exists public.expdf_recovery_totals(date[], text[], text[]);

create or replace function public.expdf_recovery_totals(p_dates date[], p_weekdays text[], p_teams text[] default null)
returns table (snapshot_date date, team text, initial numeric, current numeric, recovered numeric)
language sql stable set jit = off set enable_bitmapscan = off set enable_seqscan = off
  set statement_timeout = '2000ms' as $$
with p as materialized (
  -- One row per distinct (date, weekday) asked for -- the SAME pair recoveryByTeam already
  -- takes from its own caller, never the date alone (see its note on why: a deck stamped a
  -- different weekday on the same date is a different population, not a data-entry slip to
  -- paper over). upper() on the INPUT only, defensively: the column itself is CHECK-constrained
  -- to the three-letter uppercase set already, so this never costs the index below anything.
  select distinct u.d as snapshot_date, upper(u.wd) as weekday
  from unnest(p_dates, p_weekdays) as u(d, wd)
  where u.d is not null and u.wd is not null
),
-- The day's own INITIAL deck, batch-resolved: the winning upload per team on this exact date
-- (first_value() over created_at/upload_batch, the identical idiom recovery_standing already
-- uses and already proved on the live book -- not reinvented here).
ini as materialized (
  select p.snapshot_date, x.ref, x.team, x.arrears
  from p
  cross join lateral (
    select distinct on (y.ref) y.ref, y.team, y.arrears
    from (
      select s.ref, s.team, s.arrears, s.upload_batch, s.created_at,
             first_value(s.upload_batch) over (partition by s.team
               order by s.created_at desc nulls last, s.upload_batch desc nulls last) as win_batch
      from public.defaulter_snapshots s
      where s.snapshot_type = 'initial' and s.snapshot_date = p.snapshot_date and s.weekday = p.weekday
        and (p_teams is null or s.team = any(p_teams))
    ) y
    where y.upload_batch is not distinct from y.win_batch
    order by y.ref, y.created_at desc nulls last
  ) x
),
-- The day's own CURRENT deck, the same way, carrying status (the membership test below).
cur as materialized (
  select p.snapshot_date, x.ref, x.team, x.arrears, x.status
  from p
  cross join lateral (
    select distinct on (y.ref) y.ref, y.team, y.arrears, y.status
    from (
      select s.ref, s.team, s.arrears, s.status, s.upload_batch, s.created_at,
             first_value(s.upload_batch) over (partition by s.team
               order by s.created_at desc nulls last, s.upload_batch desc nulls last) as win_batch
      from public.defaulter_snapshots s
      where s.snapshot_type = 'current' and s.snapshot_date = p.snapshot_date and s.weekday = p.weekday
        and (p_teams is null or s.team = any(p_teams))
    ) y
    where y.upload_batch is not distinct from y.win_batch
    order by y.ref, y.created_at desc nulls last
  ) x
),
-- buildRows_'s own membership test, ported: kept if matched to the day's own initial deck at
-- all (ref_initial is that day's real baseline), OR the current status reads Chronic/Expired/
-- (Partial) Defaulter (ref_initial falls back to the CURRENT row's own arrears -- a wash,
-- exactly as buildRows_'s `const initial = hasOwnProperty(baseBy, ref) ? baseBy[ref] : arrears`
-- reads for a current-only row: it costs nothing to either side and contributes no recovery).
kept as materialized (
  select c.snapshot_date, c.team,
         coalesce(i.arrears, c.arrears) as ref_initial,
         c.arrears as ref_current
  from cur c
  left join ini i on i.snapshot_date = c.snapshot_date and i.ref = c.ref
  where i.ref is not null
     or upper(coalesce(c.status, '')) like '%CHRON%'
     or upper(coalesce(c.status, '')) like '%EXPIR%'
     or upper(coalesce(c.status, '')) like '%DEFAULT%'
)
select snapshot_date, team,
       sum(ref_initial)::numeric as initial,
       sum(ref_current)::numeric as current,
       -- PER-CUSTOMER CLAMP, THEN SUM -- not sum-then-subtract. See the header note: this is
       -- the one real arithmetic difference from recovery_standing/recoveryByTeam, kept on
       -- purpose because it is Exp.Def's own existing rule (buildRows_), not a new one.
       sum(greatest(ref_initial - ref_current, 0))::numeric as recovered
from kept
group by snapshot_date, team;
$$;

-- Confirms the function exists. Read-only.
select proname from pg_proc where proname = 'expdf_recovery_totals';
