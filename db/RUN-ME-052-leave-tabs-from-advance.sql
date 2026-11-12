-- =====================================================================================
-- RUN-ME-052  LEAVE'S TABS, GRANTED FROM ADVANCE'S OWN -- "Advance approver = Leave
--             approver. i dont have to start ressetting those. even pull the nav
--             grantings of advance tabs so that we use sql to grant leave tabs to the
--             same tunnels bro".
--
-- Whoever already holds advreq, advappr or advrep -- on their ROLE or on their own CODE --
-- gets the matching leavereq, leaveappr or leaverep added to that same tabs array. Nothing
-- is removed and nothing already there is touched twice: SAFE TO RE-RUN, and safe to run
-- again later after granting advreq/advappr/advrep to someone new, to carry leave's tabs
-- along with it.
--
-- This is ONLY the nav grant (who sees the screen at all). WHO DECIDES ONE REQUEST was
-- never a separate setting to begin with: leave reads advance's own routing
-- (roles.approver_role, roles.approver_code, access_codes.supervisor -- RUN-ME-045 /
-- RUN-ME-046) directly, so "Advance approver = Leave approver" already held before this
-- file changes a row. Run db/CHECK-leave-tabs-from-advance.sql before and after to see
-- the difference this makes, if you want to look before committing to it.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '2min';

update public.roles
  set tabs = array_append(tabs, 'leavereq')
  where 'advreq' = any(tabs) and not ('leavereq' = any(tabs));
update public.roles
  set tabs = array_append(tabs, 'leaveappr')
  where 'advappr' = any(tabs) and not ('leaveappr' = any(tabs));
update public.roles
  set tabs = array_append(tabs, 'leaverep')
  where 'advrep' = any(tabs) and not ('leaverep' = any(tabs));

update public.access_codes
  set tabs = array_append(tabs, 'leavereq')
  where 'advreq' = any(tabs) and not ('leavereq' = any(tabs));
update public.access_codes
  set tabs = array_append(tabs, 'leaveappr')
  where 'advappr' = any(tabs) and not ('leaveappr' = any(tabs));
update public.access_codes
  set tabs = array_append(tabs, 'leaverep')
  where 'advrep' = any(tabs) and not ('leaverep' = any(tabs));

-- Proof: every role and code that holds an advance tab now holds its matching leave one too.
select
  (select count(*) from public.roles where 'advreq' = any(tabs) and not ('leavereq' = any(tabs))) as roles_missing_leavereq,
  (select count(*) from public.roles where 'advappr' = any(tabs) and not ('leaveappr' = any(tabs))) as roles_missing_leaveappr,
  (select count(*) from public.roles where 'advrep' = any(tabs) and not ('leaverep' = any(tabs))) as roles_missing_leaverep,
  (select count(*) from public.access_codes where 'advreq' = any(tabs) and not ('leavereq' = any(tabs))) as codes_missing_leavereq,
  (select count(*) from public.access_codes where 'advappr' = any(tabs) and not ('leaveappr' = any(tabs))) as codes_missing_leaveappr,
  (select count(*) from public.access_codes where 'advrep' = any(tabs) and not ('leaverep' = any(tabs))) as codes_missing_leaverep;
-- every column above should read 0.
