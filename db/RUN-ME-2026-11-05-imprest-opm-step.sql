-- =====================================================================================
--  THE OPM STEP IN FRONT OF THE GM'S IMPREST APPROVALS.
-- =====================================================================================
--
--    "GMOs and Managers imprests shouldn't go to GM directly ... I select which roles pass
--     through which to get to GM at the imprest approvals tab ... their respective OPM finds
--     their requests in the request tab, OPM confirms the request {may adjust amount with
--     comment} - then it proceeds to the approval tab / GM"
--
--  Which roles go through which is a setting (IMPREST_ROUTES, edited on the Approvals tab).
--  A request from a routed role is born WAITING (stage = 'opm'): it is not in the GM's
--  pending count, queue, email or push until the respective OPM confirms it (stage = 'gm').
--  The OPM may confirm LESS than asked, never more, and says why in a comment.
--
--  WHAT THIS ADDS, all on imprest_requests:
--    stage         'gm' (default -- every existing request, and every request that is not
--                  routed) or 'opm' (waiting for the OPM's confirmation).
--    routed_via    the role that must confirm (e.g. OPM), stamped when the request was made so
--                  a later change of the rule never re-routes a request already waiting.
--    routed_names  the OPM(s) who may confirm it (their names, as Teams & Staff holds them).
--    routed_teams  the requester's teams the OPM was found through.
--    routed_note   why a routed role's request went straight to the GM (no OPM on the team) --
--                  the GM sees it, because silence would read as "an OPM looked at this".
--    opm_by / opm_at / opm_amount / opm_comment   the OPM's confirmation.
--
--  RUN IT ANY TIME. Every step is an "add column if not exists" (instant, no table rewrite --
--  a constant default) or a small index; nothing here touches the upload or the call app.
--  Safe to re-run.
--
--  UNTIL THIS RUNS, NOTHING BREAKS: the imprest code reads and writes the table exactly as
--  before. Saving a route on the Approvals tab still works (it lives in settings), but a
--  routed request cannot wait for an OPM when the table has no column to record the wait, so
--  it goes straight to the GM -- and the screens say so: the routing card on the Approvals tab
--  shows "not switched on yet", and the person who asked is told their request went to the GM.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

alter table public.imprest_requests
  add column if not exists stage        text not null default 'gm',
  add column if not exists routed_via   text,
  add column if not exists routed_names text,
  add column if not exists routed_teams text,
  add column if not exists routed_note  text,
  add column if not exists opm_by       text,
  add column if not exists opm_at       timestamptz,
  add column if not exists opm_amount   integer check (opm_amount is null or opm_amount >= 0),
  add column if not exists opm_comment  text;

-- Only two stages exist. Guarded by a lookup so a second run does not fail on the name.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'imprest_requests_stage_check'
      and conrelid = 'public.imprest_requests'::regclass
  ) then
    alter table public.imprest_requests
      add constraint imprest_requests_stage_check check (stage in ('opm', 'gm'));
  end if;
end $$;

-- The OPM's own list ("waiting for me") reads only the waiting rows -- a handful at a time.
create index if not exists imprest_requests_waiting_idx
  on public.imprest_requests (requested_at desc)
  where status = 'pending' and stage = 'opm';

comment on column public.imprest_requests.stage is
  '''opm'' = waiting for the respective OPM''s confirmation, not yet in the GM''s queue; '
  '''gm'' = with the GM (every request that is not routed starts here).';
comment on column public.imprest_requests.opm_amount is
  'What the OPM confirmed -- never more than total_amount. The GM''s default approval.';

-- No route is set until the GM picks one on the Approvals tab: nothing changes by running this.
insert into public.settings (key, value) values ('IMPREST_ROUTES', '[]')
on conflict (key) do nothing;

select count(*) as requests, count(*) filter (where stage = 'opm') as waiting_for_opm
from public.imprest_requests;
