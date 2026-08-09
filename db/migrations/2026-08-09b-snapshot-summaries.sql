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
