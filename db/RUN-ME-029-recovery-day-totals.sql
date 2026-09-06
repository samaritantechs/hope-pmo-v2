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
  /* 1. THE WINNING BATCH of every current deck in the range: one per (date, weekday, TEAM). */
  cur_win as (
    select distinct on (d.snapshot_date, upper(btrim(d.weekday)), upper(btrim(d.team)))
           d.snapshot_date,
           upper(btrim(d.weekday)) as wd,
           upper(btrim(d.team))    as tk,
           d.upload_batch
    from defaulter_snapshots d
    where d.snapshot_type = 'current'
      and d.snapshot_date between p_from and p_to
      and (p_teams is null or upper(btrim(d.team)) = any (select upper(btrim(x)) from unnest(p_teams) x))
    order by d.snapshot_date, upper(btrim(d.weekday)), upper(btrim(d.team)),
             d.created_at desc nulls last, d.upload_batch desc nulls last
  ),
  /* The rows of those winning batches, and nothing else. This is the half of 118,494 that the
     JavaScript was keeping; the other half never leaves the database now. */
  cur as (
    select d.snapshot_date, w.wd, w.tk, d.team,
           upper(btrim(d.ref)) as rk, d.arrears
    from defaulter_snapshots d
    join cur_win w
      on w.snapshot_date = d.snapshot_date
     and w.wd = upper(btrim(d.weekday))
     and w.tk = upper(btrim(d.team))
     and w.upload_batch is not distinct from d.upload_batch
    where d.snapshot_type = 'current'
      and d.snapshot_date between p_from and p_to
      and d.ref is not null
  ),
  /* 2. THE DECKS ACTUALLY OBSERVED. A deck is a weekday AND a team, on a date. */
  decks as (select distinct snapshot_date, wd, tk from cur),

  /* 3. THE BASELINE: what each book owed before the range began.
        The last CURRENT deck for that weekday BEFORE p_from wins; where there has never been
        one, the latest INITIAL deck for that weekday not after p_to. Same precedence the
        JavaScript applies when it lays the initial book down and then overwrites it with the
        pre-range current. */
  pre_win as (
    select distinct on (upper(btrim(d.weekday)), upper(btrim(d.team)))
           upper(btrim(d.weekday)) as wd, upper(btrim(d.team)) as tk,
           d.snapshot_date, d.upload_batch
    from defaulter_snapshots d
    where d.snapshot_type = 'current'
      and d.snapshot_date < p_from
      and (p_teams is null or upper(btrim(d.team)) = any (select upper(btrim(x)) from unnest(p_teams) x))
    order by upper(btrim(d.weekday)), upper(btrim(d.team)),
             d.snapshot_date desc, d.created_at desc nulls last, d.upload_batch desc nulls last
  ),
  pre as (
    select w.wd, w.tk, d.team, upper(btrim(d.ref)) as rk, d.arrears
    from defaulter_snapshots d
    join pre_win w
      on w.wd = upper(btrim(d.weekday)) and w.tk = upper(btrim(d.team))
     and w.snapshot_date = d.snapshot_date
     and w.upload_batch is not distinct from d.upload_batch
    where d.snapshot_type = 'current' and d.ref is not null
  ),
  ini_win as (
    select distinct on (upper(btrim(d.weekday)), upper(btrim(d.team)))
           upper(btrim(d.weekday)) as wd, upper(btrim(d.team)) as tk,
           d.snapshot_date, d.upload_batch
    from defaulter_snapshots d
    where d.snapshot_type = 'initial'
      and d.snapshot_date <= p_to
      and (p_teams is null or upper(btrim(d.team)) = any (select upper(btrim(x)) from unnest(p_teams) x))
    order by upper(btrim(d.weekday)), upper(btrim(d.team)),
             d.snapshot_date desc, d.created_at desc nulls last, d.upload_batch desc nulls last
  ),
  ini as (
    select w.wd, w.tk, d.team, upper(btrim(d.ref)) as rk, d.arrears
    from defaulter_snapshots d
    join ini_win w
      on w.wd = upper(btrim(d.weekday)) and w.tk = upper(btrim(d.team))
     and w.snapshot_date = d.snapshot_date
     and w.upload_batch is not distinct from d.upload_batch
    where d.snapshot_type = 'initial' and d.ref is not null
  ),
  base as (
    select wd, tk, team, rk, arrears from pre
    union all
    select i.wd, i.tk, i.team, i.rk, i.arrears from ini i
    where not exists (select 1 from pre p where p.wd = i.wd and p.rk = i.rk)
  ),

  /* 4. EVERY BOOK AGAINST EVERY DAY ITS OWN DECK CAME ROUND, whether it appeared that day or
        not -- because a book that has VANISHED from the deck is the fully-recovered case and
        would otherwise be invisible. */
  grid as (
    select k.wd, k.rk, k.team, d.snapshot_date, d.tk,
           coalesce(c.arrears, 0) as cur
    from (select distinct wd, rk, tk, team from base) k
    join decks d on d.wd = k.wd and d.tk = k.tk
    left join cur c
      on c.snapshot_date = d.snapshot_date and c.wd = k.wd and c.tk = k.tk and c.rk = k.rk
  ),
  /* Books that were never in a baseline still enter here from the day they first appear, and
     their first day attributes nothing -- see the rules above. */
  newcomers as (
    select c.wd, c.rk, c.team, c.snapshot_date, c.tk, c.arrears as cur
    from cur c
    where not exists (select 1 from base b where b.wd = c.wd and b.rk = c.rk)
  ),
  seq as (
    select * from grid
    union all
    select * from newcomers
  ),
  /* 5. THE WALK. `before` is what this book owed at its previous observation; for a book with
        a baseline the seed is that baseline, and for a newcomer there is none, so its first
        day yields nothing. */
  walked as (
    select s.snapshot_date, s.team, s.cur,
           coalesce(
             lag(s.cur) over (partition by s.wd, s.rk order by s.snapshot_date),
             (select b.arrears from base b where b.wd = s.wd and b.rk = s.rk)
           ) as before
    from seq s
  )
  select w.snapshot_date, w.team, sum(greatest(w.before - w.cur, 0))::numeric as recovered
  from walked w
  where w.before is not null
  group by w.snapshot_date, w.team
  having sum(greatest(w.before - w.cur, 0)) <> 0;
$$;

grant execute on function recovery_day_totals(date, date, text[]) to anon, authenticated, service_role;


-- ================================== DID IT LAND? =====================================
-- 1. It should answer in well under a second, and return a few hundred rows at most.
explain (analyze, buffers, timing)
select * from recovery_day_totals(
  (date_trunc('week', current_date))::date, current_date, null);

-- 2. WHAT IT SAYS, so you can eyeball it against the Commission screen before anybody is paid
--    from it. One row per team per day, and the week's total per team.
select team, sum(recovered) as week_recovered, count(*) as days
from recovery_day_totals((date_trunc('week', current_date))::date, current_date, null)
group by team order by week_recovered desc limit 20;

-- 3. THE PROOF THAT MATTERS: this figure against the old path, for ONE team. Put a team name
--    in and compare it with what the Commission board showed for that team's recovery officer
--    before this was installed. They must agree. If they do not, TELL ME rather than paying
--    anybody: a recovery figure that moved without an upload behind it is the one thing on
--    this screen nobody can afford to guess about.
--
--   select sum(recovered) from recovery_day_totals(
--     (date_trunc('week', current_date))::date, current_date, array['PUT A TEAM HERE']);
