-- =====================================================================================
-- RUN-ME-039c  "COUNT 1" ON N.C -- PART C OF THREE: rebuild the re-marked days, then check.
--              Run A and B first, and upload today's Expected sheet again (it carries N.C).
--
-- TWO SEPARATE RUNS:
--
--   FIRST, this one line on its own -- paste it alone, Run, and run it AGAIN until days_left
--   reads 0 (about twenty seconds a go). It is on its own because the editor sends a script as
--   ONE statement, and a slow rebuild timing out would roll back whatever ran with it. If
--   RUN-ME-022 was never run the function does not exist: skip this and go to the check.
--
--     select * from public.build_deck_totals_recent();
--
--   THEN the check below (paste from "set lock_timeout" down, Run): the NEWEST upload of
--   today's sheet, per team, with the whole-sheet total on the last row. `nc1` is every row at
--   N.C 1; `count1` is those of them UNDERPAID or UNPAID -- the figure the slide adds up over
--   each officer's teams. On the file that raised this, both read 171.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

with latest as (
  select s.upload_batch
  from public.repayment_snapshots s
  where s.snapshot_type = 'today' and s.snapshot_date = current_date
  order by s.created_at desc
  limit 1
)
select coalesce(s.team, '*** WHOLE SHEET ***') as team,
       count(*)                                                        as customers,
       count(*) filter (where s.nc = 1)                                as nc1,
       count(*) filter (where s.nc = 1
                          and upper(btrim(coalesce(s.todays_status, ''))) in ('UNDERPAID', 'UNPAID')) as count1
from public.repayment_snapshots s
where s.snapshot_type = 'today' and s.snapshot_date = current_date
  and s.upload_batch = (select upload_batch from latest)
group by rollup (s.team)
order by s.team nulls last;
