-- =====================================================================================
-- RUN-ME-051  LEAVE / HOLIDAY REQUESTS: the FOMU YA RUHUSA NA LIKIZO Google Form and its
--             sheet, moved into the portal the same way the salary-advance sheet was
--             (RUN-ME-044) -- "the tunnels and approvals must be the same to advances when
--             people request leaves / holidays".
--
-- Whole file: new query, paste, Ctrl+A, Run. Under 60 lines. SAFE TO RE-RUN.
--
--   leave_requests   one row per request. A staff picks their own name from their zone's or
--                    role's list on the Leave / Holiday tab, the same desk that decides their
--                    advance requests decides this one too (the advance-approver routing
--                    this file does not touch), and the Leave reports tab lists a window for
--                    HR / payroll. Unlike advance_requests this table is new, so req_role and
--                    req_code (RUN-ME-045's retrofit, there) are columns from the start.
--
-- UNTIL THIS IS RUN the Leave / Holiday tab and the Leave reports tab say the table is
-- missing and name this file; nothing else is touched. Needs staff_registry (RUN-ME-044) for
-- the name picker -- run that first if it has not been run.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

create table if not exists public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  submitted_at  timestamptz not null default now(),
  staff_id      text,
  staff_name    text not null,
  staff_role    text,
  start_date    date not null,                        -- TAREHE YA KUANZA
  end_date      date not null,                        -- TAREHE YA KURUDI
  days          integer not null,                      -- end_date - start_date + 1, computed at request time
  reason        text not null,                         -- SABABU YA KUTOKUWEPO KAZINI
  cover_name    text,                                  -- ATAKAE KAIMU MAJUKUMU YAKO MUDA HUO
  notes         text,                                  -- the form's own "Column 1"
  approval      text not null default 'Pending',       -- Pending / Approved / Disapproved
  comment       text,                                  -- the approver's comment
  zone          text,
  code          text,                                  -- the sign-in code used, as advance_requests.code
  req_role      text,                                  -- the requester's role, upper-cased (advance's routing reads this)
  req_code      text,                                  -- the requester's own code (advance's routing reads this)
  decided_by    text,
  decided_at    timestamptz,
  created_by    text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_leave_requests_at    on public.leave_requests (submitted_at desc);
create index if not exists idx_leave_requests_zone  on public.leave_requests (zone, approval, start_date desc);
create index if not exists idx_leave_requests_staff on public.leave_requests (staff_id, start_date desc);
create index if not exists idx_leave_requests_role  on public.leave_requests (req_role, approval);
create index if not exists idx_leave_requests_code  on public.leave_requests (req_code, approval);

-- Proof: the table answers, empty until the first request is filed.
select count(*) as leave_rows from public.leave_requests;
