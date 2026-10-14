-- =====================================================================================
-- RUN-ME-045  WHO APPROVES WHOSE ADVANCE -- routing by role and by named supervisor.
--
--   "choose role credit choose supervisor from role credit and select their approver ...
--    choose role pmo collection choose their approver as role pmo manager ... remember gmo
--    sees only advances of teams, managers, bikes, and themselves ... this also sounds neat
--    for me to setup not you in bg"
--
--   The Google Sheet routed by DEPARTMENT ZONE CODES (a credit zone, a PMO zone, each with
--   its approver codes). The portal replaced zone codes with the sign-in, so the routing is
--   rebuilt on what the sign-in knows: the ROLE of the code that asks, and the code itself.
--
--   roles.approver_role        set on Roles & access: the role that approves THIS role's
--                              requests (FIELD OFFICER → GMO, PMO COLLECTION → PMO MANAGER,
--                              CREDIT → CREDIT). Every holder of the approver role sees the
--                              request, within their zones.
--   access_codes.supervisor    set on the code: ONE named approver (another code). When set,
--                              only that person sees this code's requests -- required where
--                              the approver role is the same department (credit → credit),
--                              optional where it is a different one.
--   advance_requests.req_role  the role and code that FILED the request, written at request
--   advance_requests.req_code  time, which is what the desk routes on. Rows from before this
--                              file (and the sheet's uploaded register) carry neither and
--                              keep reaching the zone's desk as before.
--
-- Whole file: new query, paste, Ctrl+A, Run. Under 100 lines on purpose. SAFE TO RE-RUN.
-- UNTIL THIS IS RUN the approval desk keeps its old rule (every holder of the tab sees
-- their zones), and Roles & access and the code form say the routing is not saved.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

alter table public.roles            add column if not exists approver_role text;
alter table public.access_codes     add column if not exists supervisor    text;
alter table public.advance_requests add column if not exists req_role      text;
alter table public.advance_requests add column if not exists req_code      text;

-- A named supervisor's desk reads their people's requests by code.
create index if not exists idx_advance_requests_req on public.advance_requests (req_code, approval, submitted_at desc);

-- Proof: the four columns answer.
select
  (select count(*) from public.roles where approver_role is not null)       as roles_with_approver,
  (select count(*) from public.access_codes where supervisor is not null)   as codes_with_supervisor,
  (select count(*) from public.advance_requests where req_role is not null) as routed_requests;
