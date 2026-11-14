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
-- with no officer breakdown -- so neither expensive path is needed.
--
-- REVISED BEFORE THE OWNER EVER RAN THIS -- "i want the weekly cycle to be facts of the no of
-- defaulters we really had, not who remained so the lists per day must come from initial files
-- i think" -- the owner, 14 Nov 2026, the same day, having read this file but not yet run it.
-- The FIRST version of this function drove from the CURRENT deck (kept a row if its current
-- status read Chronic/Expired/(Partial) Defaulter, OR it matched that day's initial deck) --
-- which is exactly "who remained" rather than "who we really had": a customer on day D's own
-- INITIAL deck who is missing from day D's CURRENT deck ENTIRELY was never reached at all,
-- because nothing drove from initial. THIS VERSION DRIVES FROM THE INITIAL DECK, UNCONDITIONALLY
-- -- every ref on that day's own initial deck IS a defaulter that day, by definition (the
-- initial deck carries no status column to filter on at all; being on it is the only test).
-- A ref found on the SAME day's current deck too keeps its ordinary clamped recovery
-- (max(0, initial - current)); a ref NOT found there at all is read the way #697's own order
-- already reads an absence everywhere else on this system ("status column of such customers
-- automatic becomes cleared if no longer in default list") -- CURRENT taken as 0, RECOVERED
-- taken as the WHOLE initial amount: fully recovered, not invisible. The old current-only
-- branch (a status-defaulter-ish row with no matching initial row that day) is gone outright --
-- under "the lists must come from initial files," a ref day D's own initial file never named is
-- not day D's to count, whatever its current status says; it is some OTHER day's, or no day's,
-- the same as a day with no initial deck at all is already "not measured" everywhere else here.
--
-- RECOVERED IS STILL A SUM OF PER-CUSTOMER, CLAMPED DIFFERENCES, never the team-total
-- subtraction recovery_standing (RUN-ME-032) and the dashboard's own "Weekly recovery trend"
-- tile use -- the two are different questions and are ALLOWED TO DISAGREE on the same day, on
-- purpose: a customer whose arrears GREW between decks still contributes nothing here (never a
-- negative), while the deck-total figure nets the whole book against itself.
--
-- EXACT DATE-AND-WEEKDAY PAIRING, never "the latest upload on or before" -- the identical
-- day-pairing rule recoveryByTeam (api/_lib/snapshot-totals.js) and the dashboard's own
-- recTrend already use: pairing two different weekdays' decks reports the gap between two
-- different populations as recovery.
--
-- MEASURED on the identical 2,268,000-row fixture RUN-ME-054/055 used (42 teams, 150 days, two
-- snapshot_types, ~180 customers a team a day), after this revision: a full week, every team,
-- the worst case an unrestricted admin's own dashboard asks for, still reads 294 rows in
-- ~210ms; the common case -- one team's own week -- in ~50ms. Driving from initial instead of
-- current changes WHICH rows are kept, not how many decks are read, so the cost is unchanged.
-- `set enable_bitmapscan = off set enable_seqscan = off` is copied from RUN-ME-032's own
-- recovery_standing, which reads the same table the same way, as a defensive planner hint;
-- `set statement_timeout = '2000ms'` is a backstop, about four times the measured worst case.
--
-- STILL NOT REACHED HERE: a customer whose team's INITIAL deck itself never landed for a given
-- day at all -- a day with no initial deck is "not measured," the same as every other week-sized
-- read on this screen already treats a day nobody filed. That is a missing upload, not a
-- recovered customer, and this function does not guess otherwise.
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
-- THE DRIVING TABLE. Every ref on this exact day's own initial deck is a defaulter we really
-- had that day, full stop -- batch-resolved the same way recovery_standing already is (the
-- winning upload per team on this exact date, first_value() over created_at/upload_batch).
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
-- The day's own CURRENT deck, looked UP by the driving table above, never iterated on its own
-- -- a current-only row (no matching ref on that day's initial deck) is not this function's
-- population, whatever its status says.
cur as materialized (
  select p.snapshot_date, x.ref, x.arrears
  from p
  cross join lateral (
    select distinct on (y.ref) y.ref, y.arrears
    from (
      select s.ref, s.team, s.arrears, s.upload_batch, s.created_at,
             first_value(s.upload_batch) over (partition by s.team
               order by s.created_at desc nulls last, s.upload_batch desc nulls last) as win_batch
      from public.defaulter_snapshots s
      where s.snapshot_type = 'current' and s.snapshot_date = p.snapshot_date and s.weekday = p.weekday
        and (p_teams is null or s.team = any(p_teams))
    ) y
    where y.upload_batch is not distinct from y.win_batch
    order by y.ref, y.created_at desc nulls last
  ) x
)
-- A ref with no matching current row (coalesce to 0) is read as FULLY RECOVERED, never
-- invisible -- #697's own rule, applied per day instead of only to "today."
select i.snapshot_date, i.team,
       sum(i.arrears)::numeric as initial,
       sum(coalesce(c.arrears, 0))::numeric as current,
       -- PER-CUSTOMER CLAMP, THEN SUM -- not sum-then-subtract. See the header note: this is
       -- the one real arithmetic difference from recovery_standing/recoveryByTeam, kept on
       -- purpose because it is Exp.Def's own existing rule (buildRows_), not a new one.
       sum(greatest(i.arrears - coalesce(c.arrears, 0), 0))::numeric as recovered
from ini i
left join cur c on c.snapshot_date = i.snapshot_date and c.ref = i.ref
group by i.snapshot_date, i.team;
$$;

-- Confirms the function exists. Read-only.
select proname from pg_proc where proname = 'expdf_recovery_totals';
