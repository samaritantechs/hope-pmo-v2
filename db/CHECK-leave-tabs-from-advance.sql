-- READ-ONLY. Changes nothing. Shows every role and every access code that currently holds
-- advreq, advappr or advrep, what its full tabs array is, and whether the matching leave tab
-- (leavereq / leaveappr / leaverep) is already there or would be ADDED by
-- db/RUN-ME-052-leave-tabs-from-advance.sql.
--
-- Run this first; then run that file; then run this again to see the same rows with every
-- leavereq_already / leaveappr_already / leaverep_already column now matching its advance one.

select x.kind, x.who, x.role_word, x.tabs,
  'advreq' = any(x.tabs)    as has_advreq,
  'advappr' = any(x.tabs)   as has_advappr,
  'advrep' = any(x.tabs)    as has_advrep,
  'leavereq' = any(x.tabs)  as leavereq_already,
  'leaveappr' = any(x.tabs) as leaveappr_already,
  'leaverep' = any(x.tabs)  as leaverep_already
from (
  select 'role' as kind, role as who, role as role_word, tabs from public.roles
  union all
  select 'code' as kind, code as who, role as role_word, tabs from public.access_codes
) x
where 'advreq' = any(x.tabs) or 'advappr' = any(x.tabs) or 'advrep' = any(x.tabs)
order by x.kind, x.who;
