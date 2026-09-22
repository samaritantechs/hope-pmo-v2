-- =====================================================================================
-- RUN-ME-033 -- THE DEFAULTER BOOK'S INITIAL BASELINE, PER CUSTOMER -- THE SAME FIX AS RUN-ME-032
-- =====================================================================================
--
-- RUN-ME-032 found and fixed this for recovery_standing (the dashboard's "recovered" figure):
-- weekday on defaulter_snapshots is not a stable fact about a customer, the real book re-uploads
-- most defaulters daily, and grouping decks by (team, weekday) to pick one shared "winning" date
-- for the whole group silently strands a customer whose own latest file sits on a different,
-- still-recent date. 73 million TZS of real arrears were falling through that gap.
--
-- defaulterBook (portal-core.js) -- the customer-list exports, the Credit Info Report, the
-- "present" reading, and every screen's own initial baseline -- has the SAME grouping, for the
-- SAME reason (deckDatesPerTeam learns one winning date per team-and-weekday, cheaply, from the
-- aggregate totals function, then fetches full rows only for those winning dates). It is not a
-- second bug: it is the same one, read from JavaScript instead of SQL, and it needed the same
-- fix -- resolved PER CUSTOMER, not per team-and-weekday group.
--
-- WHY A SEPARATE FUNCTION RATHER THAN REUSING recovery_standing: that function returns SUMS, one
-- row per (period, team). This has to return the CUSTOMER -- name, contact, guarantor, arrears,
-- every column the exports and the Credit Info Report read -- one row per person, not one row
-- per team. Same question, same rule, different shape of answer.
--
-- THE RULE, restated (identical to RUN-ME-032's ini_candidates, so the two can never disagree
-- about who a defaulter's baseline is): for each customer, within the lookback ending on the
-- date asked for, their own latest INITIAL row -- ranked by date, then by the batch rule (newest
-- upload wins) as the tiebreaker on their own latest date. A customer moved between teams counts
-- once, under whichever team their own single latest row actually names.
--
-- WHY IN THE DATABASE, same reasoning as RUN-ME-032 and RUN-ME-022: a per-customer question over
-- up to 45 days of decks is not a whole month of rows to carry to the web server and resolve
-- there -- it is one call, answered where the rows already live. The result is already the
-- resolved book (about 9,300 rows on the real book, not a multiple of it), so every column comes
-- back exactly as defaulter_snapshots stores it; there is no aggregate to narrow.
--
-- WITHOUT THIS MIGRATION, defaulterBook falls back to deckDatesPerTeam's team-and-weekday
-- grouping exactly as it always has -- the old behaviour, not a failure. Nothing breaks by this
-- being late; the initial baseline is only undercounted the way RUN-ME-032 found, until it is
-- run.
--
-- Paste the whole file into the SQL editor and run it once. Safe to re-run.
-- =====================================================================================

drop function if exists public.defaulter_initial_rows(date, text[], int);

create or replace function public.defaulter_initial_rows(p_to date, p_teams text[] default null, p_lookback int default 45)
returns setof public.defaulter_snapshots
language sql stable set jit = off as $$
  select distinct on (s.ref) s.*
  from public.defaulter_snapshots s
  where s.snapshot_type = 'initial'
    and s.snapshot_date <= p_to
    and s.snapshot_date >= p_to - p_lookback
    and (p_teams is null or s.team = any(p_teams))
  order by s.ref, s.snapshot_date desc, s.created_at desc nulls last, s.upload_batch desc nulls last;
$$;

grant execute on function public.defaulter_initial_rows(date, text[], int) to anon, authenticated, service_role;
notify pgrst, 'reload schema';
