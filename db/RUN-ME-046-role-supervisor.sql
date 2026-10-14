-- =====================================================================================
-- RUN-ME-046  ONE SUPERVISOR FOR A WHOLE ROLE -- the advance approver named once per department.
--
--   "At codes I choose role user as supervisor of the whole dept not assigning every user
--    to the same person loosing energy all the way"
--
--   RUN-ME-045 let a code name its own supervisor (access_codes.supervisor). Where a whole
--   department answers to one person (every CREDIT code to the one credit supervisor), that
--   person is now named ONCE, on the role: roles.approver_code. The routing rule reads the
--   code's own supervisor first, then the role's, then the approver role (advRouteOf_).
--
--   roles.approver_code   the access code of the one person who approves this role's
--                         advance requests, whatever the zone; null = none (fall back to
--                         the approver role). Set on Roles & access, or from a code's form
--                         ("make them the supervisor of every <ROLE> code").
--
-- Whole file: new query, paste, Ctrl+A, Run. Under 100 lines on purpose. SAFE TO RE-RUN.
-- UNTIL THIS IS RUN a role's supervisor cannot be saved and both forms say so; everything
-- RUN-ME-045 set up keeps working.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

alter table public.roles add column if not exists approver_code text;

-- Proof: the column answers.
select (select count(*) from public.roles where approver_code is not null) as roles_with_supervisor;
