-- =====================================================================================
-- RUN-ME-038c  "COUNT 1" -- PART C OF THREE: rebuild the re-marked days, then check by eye.
--              Run A and B first.
--
-- TWO SEPARATE RUNS, because the editor shows only the LAST statement's result:
--
--   FIRST, this one line on its own -- paste it alone, Run, and run it AGAIN until days_left
--   reads 0 (about twenty seconds a go). It is on its own because the editor sends a script as
--   ONE statement, and a slow rebuild timing out would roll back whatever ran with it. If
--   RUN-ME-022 was never run the function does not exist: skip this and go to the check.
--
--     select * from public.build_deck_totals_recent();
--
--   THEN the check below (paste from "set lock_timeout" down, Run): the NC 1 rows of the next
--   initial sheets, by status, PER UPLOAD -- a day uploaded twice shows twice, the same as the
--   proof in part B, so the two line up row for row. Count 1 on the slide, added over an
--   officer's teams, must equal the UNDERPAID + UNPAID rows of the newest upload and nothing
--   else -- not PAID, not OVERPAID, not a blank.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

select s.snapshot_date, s.team, max(s.created_at) as uploaded,
       upper(btrim(coalesce(s.todays_status, ''))) as status, count(*) as nc1_rows
from public.repayment_snapshots s
where s.snapshot_type = 'initial'
  and s.snapshot_date between current_date and current_date + 3
  and btrim(coalesce(s.due_summary, '')) ~ '^1\s*[-/]\s*\d+$'
group by s.snapshot_date, s.team, s.upload_batch, 4
order by 1, 2, 3, 4;
