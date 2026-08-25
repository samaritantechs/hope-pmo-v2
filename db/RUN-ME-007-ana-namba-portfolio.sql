-- =====================================================================================
-- RUN-ME-007 -- calls to "Ana namba nyingine" replacement numbers are portfolio calls.
-- Paste into the Supabase SQL editor and run. Safe to re-run: both statements only touch
-- rows that are still wrong, so a second run finds nothing to do.
--
-- WHY THIS EXISTS. The phone index that classifies a synced call was cached for up to five
-- minutes, and a synced call is never reclassified. Officers record a replacement number and
-- dial it within the minute -- so exactly those calls were stamped "nje ya portfolio",
-- permanently. The app now rebuilds its index the moment a replacement number is recorded
-- (NEW_NUMBER_VERSION); this file repairs the calls that were stamped before that fix.
-- =====================================================================================

-- 1) Calls to a recorded replacement number, made by someone whose book the customer is in:
--    flip them to portfolio, wearing the customer's name and ref exactly as a live match would.
with nn as (
  -- One row per normalised replacement number (same normalisation the app applies to both
  -- sides: digits only, drop a leading 255, drop leading zeros, keep the last nine). The
  -- newest comment wins, and the follow-up register's name/team stand in where it has them.
  select distinct on (n.norm)
         n.norm,
         fc.ref,
         coalesce(nullif(btrim(fs.team), ''), nullif(btrim(fc.team), '')) as team,
         coalesce(nullif(btrim(fs.full_name), ''), nullif(btrim(fc.full_name), '')) as full_name
  from followup_comments fc
  left join followup_status fs on fs.ref = fc.ref
  cross join lateral (
    select right(ltrim(case when d.d like '255%' then substr(d.d, 4) else d.d end, '0'), 9) as norm
    from (select regexp_replace(coalesce(fc.new_number, ''), '\D', '', 'g') as d) d
  ) n
  where coalesce(fc.new_number, '') <> '' and n.norm <> ''
  order by n.norm, fc.created_at desc
)
update call_logs cl
set portfolio  = true,
    match_type = 'CUSTOMER',
    ref        = nn.ref,
    customer   = coalesce(nn.full_name, cl.customer),
    category   = coalesce(cl.category, 'DEFAULTER')
from nn, call_users cu
where cl.phone = nn.norm
  and cl.portfolio is not true
  and cu.user_id = cl.user_id
  -- Portfolio means THEIR book -- the same team-scope rule sync applies live. A customer
  -- with no team recorded still counts (a gap in the upload, not an out-of-book call); a
  -- non-leader with no home team and a leader with no team list (or ALL) see every team.
  and (
        coalesce(nn.team, '') = ''
        or (not cu.is_leader and (coalesce(btrim(cu.team), '') = ''
                                  or upper(btrim(cu.team)) = upper(nn.team)))
        or (cu.is_leader and (cu.leader_teams is null
                              or cardinality(cu.leader_teams) = 0
                              or exists (select 1 from unnest(cu.leader_teams) lt
                                         where upper(btrim(lt)) in ('ALL', upper(nn.team)))))
      );

-- 2) The remaining matches -- another team's customer -- are still NAMED, as sync names them:
--    "this call was to another team's customer" is more useful than "unmatched". Runs after
--    (1), which has already claimed its rows by setting ref.
with nn as (
  select distinct on (n.norm)
         n.norm,
         fc.ref,
         coalesce(nullif(btrim(fs.full_name), ''), nullif(btrim(fc.full_name), '')) as full_name
  from followup_comments fc
  left join followup_status fs on fs.ref = fc.ref
  cross join lateral (
    select right(ltrim(case when d.d like '255%' then substr(d.d, 4) else d.d end, '0'), 9) as norm
    from (select regexp_replace(coalesce(fc.new_number, ''), '\D', '', 'g') as d) d
  ) n
  where coalesce(fc.new_number, '') <> '' and n.norm <> ''
  order by n.norm, fc.created_at desc
)
update call_logs cl
set match_type = 'CUSTOMER',
    ref        = nn.ref,
    customer   = coalesce(nn.full_name, cl.customer)
from nn
where cl.phone = nn.norm
  and cl.ref is null
  and cl.portfolio is not true;
