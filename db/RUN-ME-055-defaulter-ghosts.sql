-- =====================================================================================
-- RUN-ME-055 -- A CUSTOMER WHO DROPS OFF THE DECK ENTIRELY STILL SHOWS, STATUS CLEARED
-- =====================================================================================
--
--   "Checked loan system -- customer not there on thurrsday deck 12th nov 2026" ... "tell me
--   latest date that customer was a defaulter of any status" ... "should reflect to alltime
--   data past present and future" ... "so status column of such customers automatic becomes
--   cleared if no longer in default list" -- the owner, 13 Nov 2026.
--
-- #693/#696 (handbook Parts 69-70) answered the case where a customer is STILL on today's
-- current deck, just with a changed status -- buildRows_ keeps the row, labels it CLEARED.
-- Ref 4231948032 is the harder case both PRs named and left open: gone from BOTH today's
-- initial AND current deck entirely, for as long as the loan system's own export keeps
-- dropping them -- which could be one day or months, with no bound ("all-time, past present
-- and future"). There is nothing in today's own data to even notice they are missing; the
-- only way to find them is to ask "who has this team EVER had as a defaulter, that today's
-- deck does not answer for".
--
-- WHY THIS IS A FUNCTION AND NOT A QUERY BUILT IN JAVASCRIPT. "Distinct ref for this team,
-- across however many months of history" has no cheap shape through PostgREST's ordinary
-- query builder -- a plain SELECT DISTINCT still has to visit every one of a team's rows to
-- de-duplicate them (measured: 67-134ms on a 2.28-million-row fixture sized like the live
-- book, even with an index on (team, ref), because Postgres has no built-in "skip scan" for
-- DISTINCT). A recursive CTE that walks the (team, ref) index one distinct value at a time --
-- the loose-index-scan idiom -- answers the identical question as an Index Only Scan, no heap
-- fetches at all: 1.6ms on the same fixture. That idiom cannot be expressed through
-- PostgREST's REST surface, so it lives here, called the way this codebase already calls
-- snapshot-totals.js's own SQL-side aggregates: db.rpc(...), with a graceful fallback (below)
-- for a database where this has not been run yet.
--
-- VERIFIED ON THE SAME 2.27-MILLION-ROW, 42-TEAM, 150-DAY FIXTURE RUN-ME-054 USED (180
-- customers a team, both snapshot_types, ~2% of current rows randomly missing to model real
-- gaps), with EXPLAIN (ANALYZE, BUFFERS):
--
--   The realistic case -- most of a team's refs already resolved from today's own deck, a
--   handful of genuine gaps (the TABORA TOWN book itself: 86 of ~89 refs resolved, 1-3 real
--   gaps): 177 known of 180, 3 candidates -- 13.8ms total, no disk spill.
--
--   THE ONE HONEST COST: if NOTHING in a team's deck resolved today at all -- not a few
--   customers, the WHOLE team's upload missing, a much bigger and more visible failure this
--   is not built to paper over -- every one of that team's refs becomes a candidate, and the
--   "latest row per ref" half of the function has to sort that team's entire current-row
--   history: 86-115ms on this fixture, including a disk spill (temp read/written). The
--   statement_timeout below and the caller's own time budget (api/_lib/expdf.js) exist for
--   exactly this case: abandoned rather than allowed to hold up a phone's own request, the
--   same rule api/upload.js's own housekeeping already follows.
--
-- NO CODE CHANGE IS "DONE" BY THIS FILE ALONE. api/_lib/expdf.js and api/_lib/portal-core.js
-- call this function; until it exists, they ask for it, get an error, and show no ghost rows
-- at all -- the exact behaviour before this PR, never a failed request.
--
-- CONCURRENTLY, BECAUSE defaulter_snapshots IS WRITTEN BY /api/upload (RUN-ME-054's own
-- reasoning, unchanged: an ordinary CREATE INDEX would lock out every upload until it finished
-- building on the live table).
--
-- >>> SECTION 2 MUST BE RUN ALONE -- select only that one line and press Run. <<< CREATE INDEX
-- CONCURRENTLY is refused inside a transaction block, and the SQL editor sends everything
-- selected together as one; running the whole file at once simply errors on that and changes
-- nothing (a safe failure), rather than silently skip the safety CONCURRENTLY exists for.
-- Sections 1, 3 and 4 may be run with anything else.
--
-- SAFE TO RUN AGAIN: IF NOT EXISTS / CREATE OR REPLACE on every statement.
-- =====================================================================================

-- SECTION 1 -- read-only, before and after: confirms the index does not exist yet / does.
select indexname from pg_indexes where tablename = 'defaulter_snapshots' and indexname = 'idx_def_snap_team_ref';

-- SECTION 2 -- RUN ALONE.
create index concurrently if not exists idx_def_snap_team_ref on defaulter_snapshots(team, ref);

-- SECTION 3 -- the function itself. One team at a time inside the loop (each one its own
-- loose-index-scan over that team's own slice of the (team, ref) index), UNION'd by the
-- caller's PL/pgSQL RETURN QUERY rather than asked to skip-scan several teams' ranges at once,
-- which the technique does not extend to cleanly. p_known_refs is whatever the caller already
-- resolved from today's own deck -- computed there, not re-derived here, because the caller
-- already has it in hand from the same request.
create or replace function defaulter_ghost_rows(p_teams text[], p_known_refs text[])
returns table(ref text, full_name text, contact text, guarantor_name text, guarantor_contact text,
              team text, arrears numeric, status text, ds text, dc int, days_elapsed int,
              disb_date date, chronic_date date, expire_date date, other_inst numeric, snapshot_date date)
language plpgsql as $$   -- not STABLE: it sets statement_timeout, which Postgres refuses inside a STABLE function
declare
  v_team text;
begin
  -- Belt and suspenders beside api/_lib/expdf.js's own time-boxed call: a whole team's
  -- upload genuinely missing (the one costly case measured above) is abandoned here too,
  -- never left to run to completion on the sacred call path.
  set local statement_timeout = '800ms';
  foreach v_team in array p_teams loop
    return query
      with recursive walk as (
        (select d.ref from defaulter_snapshots d where d.team = v_team order by d.ref limit 1)
        union all
        select (select d2.ref from defaulter_snapshots d2
                 where d2.team = v_team and d2.ref > w.ref order by d2.ref limit 1)
        from walk w
        where w.ref is not null
      ),
      candidates as (
        select wk.ref from walk wk where wk.ref is not null and wk.ref <> all (p_known_refs)
      )
      select distinct on (d.ref) d.ref, d.full_name, d.contact, d.guarantor_name, d.guarantor_contact,
             d.team, d.arrears, d.status, d.ds, d.dc, d.days_elapsed, d.disb_date, d.chronic_date,
             d.expire_date, d.other_inst, d.snapshot_date
      from candidates c
      join defaulter_snapshots d on d.ref = c.ref and d.team = v_team and d.snapshot_type = 'current'
      order by d.ref, d.snapshot_date desc, d.created_at desc;
  end loop;
end;
$$;

-- SECTION 4 -- read-only. Confirms the function exists.
select proname from pg_proc where proname = 'defaulter_ghost_rows';
