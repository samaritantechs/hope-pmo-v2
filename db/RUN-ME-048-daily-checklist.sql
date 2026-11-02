-- =====================================================================================
-- RUN-ME-048 -- THE DAILY CHECKLIST: what a leader ticked today, when the SERVER saw it,
--               and the photo they took in the app to prove it.
--
--   "Thats how implementation of the window they work on should be for leaders at a tab
--    'Daily Checklist' ... I should be able to manage tasks per role at my bonasi tab"
--
-- The TASKS (which activity, on which weekday, by what cut-off, for which role) are not in
-- this table: they are one settings row (key DAILY_CHECKLIST) that the Daily Bonus Plan tab
-- writes, so they need no migration and can change any day. This table is the ENTRIES: one
-- row per person, per day, per task -- the tick with the server's own time stamp, whether it
-- came after the cut-off, and the photo (shrunk on the phone, at most 200KB) with its own
-- server stamp. A list never reads the photo column; it is fetched one at a time on View.
--
-- Nothing here touches the upload or the call app.
--
-- UNTIL THIS RUNS, NOTHING BREAKS: the tab opens, shows the day's tasks, and says plainly that
-- ticks and photos are refused until this file has been run. Safe to re-run.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

create table if not exists public.checklist_entries (
  id          uuid primary key default gen_random_uuid(),
  day         date not null,                       -- the EAT day the tick belongs to
  weekday     text,                                -- MON..SUN, the day's own
  code        text not null,                       -- the access code that ticked
  name        text,
  role        text,                                -- the role whose task list this came from
  item_id     text not null,                       -- the task's id in the DAILY_CHECKLIST setting
  activity    text,                                -- the task's wording at the time, kept
  cutoff      text,                                -- its cut-off (HH:MM) at the time, kept
  ticked_at   timestamptz,                         -- SERVER time of the tick; null = photo only
  late        boolean not null default false,      -- ticked after the cut-off
  photo       text,                                -- data:image/jpeg;base64,... (<= 200KB)
  photo_bytes integer,
  photo_at    timestamptz,                         -- SERVER time of the photo
  created_at  timestamptz not null default now(),
  unique (code, day, item_id)
);
create index if not exists checklist_entries_day_idx on public.checklist_entries (day);

-- =====================================================================================
--  DID IT LAND?
--    select day, name, role, activity, ticked_at, late, photo_at
--      from public.checklist_entries order by day desc, ticked_at desc limit 20;
-- =====================================================================================
