-- =====================================================================================
-- RUN-ME-029 -- THE RECOVERY WALK MOVES INTO THE DATABASE.
--
--   "commissions - Imeshindikana / Could not load. Seva haijibu ndani ya sekunde 45"
--   "go postgress battle after solving that please"
--
-- WHAT THE COMMISSION SCREEN WAS DOING. To work out what each recovery officer recovered, it
-- read a WEEK of raw per-customer defaulter rows and paired them up in JavaScript. Measured on
-- this book, this week:
--
--     rows_read  118,494     rows_in_reuploaded_decks  109,375
--     decks      513         of which re-uploaded          440
--
-- Plus the two baselines (the initial deck per weekday, and the last current deck before the
-- range) at roughly nine thousand rows per weekday each -- about another 126,000. So a quarter
-- of a million rows crossed the wire to produce a table of about seventy numbers, and on a
-- t3a.small that is more than forty-five seconds. The screen did not answer.
--
-- AND 440 OF 513 DECKS HAD BEEN UPLOADED MORE THAN ONCE, so roughly half of those rows were
-- superseded copies: read in full, then thrown away by pickLatestBatch. Paid for twice, used
-- once.
--
-- WHAT THIS FUNCTION DOES INSTEAD. The same walk, in SQL, returning ONE ROW PER TEAM PER DAY:
-- how much arrears came off. About 525 rows for a week instead of 245,000. The screen keeps
-- the arithmetic it always had; it stops carrying the raw material for it across the network.
--
-- THE DENOMINATOR IS NOT HERE, AND THAT IS WHY THIS IS TRACTABLE. Recovery percentage is
-- recovered over UNCOLLECTED (see recovery-pay.js and the Orodha), and uncollected already
-- arrives aggregated on the expected totals. This function answers only the numerator -- the
-- one figure that genuinely needs per-customer pairing.
--
-- =====================================================================================
-- THE RULES IT HAS TO MATCH, EXACTLY. Two definitions of any of these is a pay figure nobody
-- can account for, so each one is written here beside the JavaScript it mirrors:
--
--   WHICH UPLOAD WINS  pickLatestBatch (api/_lib/snapshots.js): per snapshot_date, per weekday,
--                      per TEAM -- newest created_at, ties broken on the batch id, and a NULL
--                      batch (legacy rows) sorts BELOW any uuid so a real upload always beats
--                      the rows it replaced. `desc nulls last` is that order.
--   HOW A TEAM IS KEYED  teamKeyOf: trim, then UPPER CASE. `.eq()` and `.in()` are exact-case
--                      in PostgREST and this has caused a blackout here before (Tunduru), so
--                      the grouping is upper(btrim(team)) and nothing else.
--   A BOOK             weekday + ref, upper-cased and trimmed the same way -- bkey() in
--                      portal-core.js. A customer is a different book on a different weekday
--                      deck, because that is what a deck is.
--   GONE FROM THE DECK IS RECOVERED IN FULL. A customer the deck no longer names owes nothing:
--                      cur = 0, not "unchanged". That is the whole point of a recovery figure.
--   A BOOK WITH NO BASELINE ATTRIBUTES NOTHING ON ITS FIRST DAY. Somebody first seen mid-week
--                      has no "before", so there is no drop to credit -- they enter the book
--                      and start counting from their next observation. The JavaScript adds
--                      them to `running` after the day's attribution, which is the same thing.
--   ONLY OBSERVED DECKS COUNT. A book is only looked at on a day its own (weekday, team) deck
--                      was actually uploaded. A deck that did not come round that day is not a
--                      day of no recovery; it is not a day at all.
--
-- SAFE TO RE-RUN: create or replace. SAFE NOT TO RUN AT ALL: api/_lib/portal-core.js falls
-- back to the raw walk when the function is missing, exactly as it works today -- slowly.
-- =====================================================================================
-- =====================================================================================
-- WHY THE FIRST VERSION OF THIS TIMED OUT, because the mistake is worth keeping written down.
--
--   "Error: SQL query ran into an upstream timeout"
--
-- Two faults, and both are the same lesson the upload status panel taught in RUN-ME-027:
--
--   1. A CORRELATED SUBQUERY PER ROW. The walk seeded each book's first "before" with
--      `(select arrears from base where ...)` -- run once for every row of the sequence,
--      against a CTE that has no index. A hundred thousand rows times fifty thousand baselines
--      is not a query, it is a nested loop with a five-billion-row worst case. The seed is now
--      a ROW in the sequence, dated before everything else, so the ordinary lag() picks it up
--      and there is no subquery at all.
--
--   2. TWO SCANS OF THE WHOLE DEFAULTER HISTORY. `distinct on (weekday, team) ... order by
--      snapshot_date desc` over every current row ever written looks like it should stop at the
--      first row of each group. IT DOES NOT: POSTGRES HAS NO SKIP SCAN, so it walks the lot.
--      Exactly what made upload_status_summary take sixteen seconds.
--
--      The groups are KNOWN -- they are the decks observed in the range, about seventy-five of
--      them -- so each baseline is now looked up BY NAME with a lateral `order by ... limit 1`,
--      which is an index seek that stops at the first row. Seventy-five seeks instead of one
--      walk of a million rows.
--
-- THE LOOKUPS USE THE RAW weekday AND team, not upper(btrim(...)), so idx_def_snap_lookup can
-- actually be used -- an expression the index does not carry turns a seek back into a scan.
-- Grouping and joining still normalise, so a team stored in two spellings costs an extra deck
-- read rather than a dropped one: the failure bends towards reading too much, never too little.
-- =====================================================================================
set statement_timeout = '120s';

create or replace function recovery_day_totals(
  p_from date,
  p_to date,
  p_teams text[] default null
)
returns table (snapshot_date date, team text, recovered numeric)
language sql
stable
as $$
  with
  /* THE RANGE, read once. */
  cur_all as (
    select d.snapshot_date, d.weekday, d.team, d.ref, d.arrears, d.upload_batch, d.created_at
    from defaulter_snapshots d
    where d.snapshot_type = 'current'
      and d.snapshot_date between p_from and p_to
      and d.ref is not null
      and (p_teams is null or d.team = any (p_teams))
  ),
  /* The winning batch of each deck: per date, per weekday, per TEAM -- pickLatestBatch's rule,
     with a NULL batch sorting below any uuid. */
  cur_win as (
    select distinct on (snapshot_date, upper(btrim(weekday)), upper(btrim(team)))
           snapshot_date, weekday, team,
           upper(btrim(weekday)) as wd, upper(btrim(team)) as tk, upload_batch
    from cur_all
    order by snapshot_date, upper(btrim(weekday)), upper(btrim(team)),
             created_at desc nulls last, upload_batch desc nulls last
  ),
  cur as (
    select w.snapshot_date, w.wd, w.tk, w.team, upper(btrim(c.ref)) as rk, c.arrears
    from cur_all c
    join cur_win w
      on w.snapshot_date = c.snapshot_date
     and w.wd = upper(btrim(c.weekday))
     and w.tk = upper(btrim(c.team))
     and w.upload_batch is not distinct from c.upload_batch
  ),
  decks as (select distinct snapshot_date, wd, tk from cur),
  /* The decks observed, by NAME, with a raw spelling to seek the index with. */
  pairs as (
    select wd, tk, min(weekday) as weekday, min(team) as team
    from cur_win group by wd, tk
  ),

  /* THE BASELINE, ONE INDEX SEEK PER DECK. The newest row before the range carries both the
     date and the winning batch of that date, so one `limit 1` answers both questions. */
  pre_pick as (
    select p.wd, p.tk, x.snapshot_date, x.upload_batch
    from pairs p
    cross join lateral (
      select d.snapshot_date, d.upload_batch
      from defaulter_snapshots d
      where d.snapshot_type = 'current'
        and d.weekday = p.weekday and d.team = p.team
        and d.snapshot_date < p_from
      order by d.snapshot_date desc, d.created_at desc nulls last, d.upload_batch desc nulls last
      limit 1
    ) x
  ),
  pre as (
    select k.wd, k.tk, d.team, upper(btrim(d.ref)) as rk, d.arrears
    from pre_pick k
    join defaulter_snapshots d
      on d.snapshot_type = 'current'
     and d.snapshot_date = k.snapshot_date
     and upper(btrim(d.weekday)) = k.wd
     and upper(btrim(d.team)) = k.tk
     and d.upload_batch is not distinct from k.upload_batch
    where d.ref is not null
  ),
  ini_pick as (
    select p.wd, p.tk, x.snapshot_date, x.upload_batch
    from pairs p
    cross join lateral (
      select d.snapshot_date, d.upload_batch
      from defaulter_snapshots d
      where d.snapshot_type = 'initial'
        and d.weekday = p.weekday and d.team = p.team
        and d.snapshot_date <= p_to
      order by d.snapshot_date desc, d.created_at desc nulls last, d.upload_batch desc nulls last
      limit 1
    ) x
  ),
  ini as (
    select k.wd, k.tk, d.team, upper(btrim(d.ref)) as rk, d.arrears
    from ini_pick k
    join defaulter_snapshots d
      on d.snapshot_type = 'initial'
     and d.snapshot_date = k.snapshot_date
     and upper(btrim(d.weekday)) = k.wd
     and upper(btrim(d.team)) = k.tk
     and d.upload_batch is not distinct from k.upload_batch
    where d.ref is not null
  ),
  /* The pre-range CURRENT wins over the INITIAL, and one book is one baseline: `distinct on`
     does the precedence and the de-duplication in the same pass. */
  base_all as (
    select wd, tk, team, rk, arrears, 0 as pri from pre
    union all
    select wd, tk, team, rk, arrears, 1 as pri from ini
  ),
  base as (
    select distinct on (wd, rk) wd, tk, team, rk, arrears
    from base_all order by wd, rk, pri
  ),

  /* THE SEQUENCE. The baseline is a ROW, dated before everything, so lag() seeds itself and
     there is no per-row subquery. Then every book against every day its own deck came round --
     a book the deck no longer names owes nothing, which is the fully-recovered case -- and
     finally the newcomers, who have no baseline and so attribute nothing on their first day. */
  seq as (
    select b.wd, b.rk, b.team, date '0001-01-01' as sd, b.arrears as cur, true as seed
    from base b
    union all
    select b.wd, b.rk, b.team, d.snapshot_date, coalesce(c.arrears, 0), false
    from base b
    join decks d on d.wd = b.wd and d.tk = b.tk
    left join cur c
      on c.snapshot_date = d.snapshot_date and c.wd = b.wd and c.rk = b.rk
    union all
    select c.wd, c.rk, c.team, c.snapshot_date, c.arrears, false
    from cur c
    left join base b on b.wd = c.wd and b.rk = c.rk
    where b.rk is null
  ),
  walked as (
    select sd, team, cur, seed,
           lag(cur) over (partition by wd, rk order by sd) as before
    from seq
  )
  select w.sd as snapshot_date, w.team, sum(greatest(w.before - w.cur, 0))::numeric as recovered
  from walked w
  where not w.seed and w.before is not null
  group by w.sd, w.team
  having sum(greatest(w.before - w.cur, 0)) <> 0;
$$;

grant execute on function recovery_day_totals(date, date, text[]) to anon, authenticated, service_role;


-- ================================== DID IT LAND? =====================================
-- 1. It should answer in WELL under a second now, and return a few hundred rows at most.
--    If this still times out, send me the plan and do not install anything else: a payroll
--    figure is not worth guessing at twice.
explain (analyze, buffers, timing)
select * from recovery_day_totals(
  (date_trunc('week', current_date))::date, current_date, null);

-- 2. WHAT IT SAYS, to eyeball against the Commission screen before anybody is paid from it.
select team, sum(recovered) as week_recovered, count(*) as days
from recovery_day_totals((date_trunc('week', current_date))::date, current_date, null)
group by team order by week_recovered desc limit 20;

-- 3. THE PROOF THAT MATTERS. Put ONE real team in and compare the figure with what the
--    Commission board showed for that team's recovery officer BEFORE this was installed.
--    They must agree. If they do not, TELL ME rather than paying anybody: a recovery figure
--    that moved with no upload behind it is the one thing on this screen nobody can guess at.
--
--   select sum(recovered) from recovery_day_totals(
--     (date_trunc('week', current_date))::date, current_date, array['PUT A TEAM HERE']);
