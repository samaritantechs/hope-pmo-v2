-- =====================================================================================
-- RUN-ME-069: STAFF WITHOUT A BANK ACCOUNT NUMBER -- zone, team, staff name (READ-ONLY: changes nothing)
--
--   "I also need a list of all staff without bank account numbers / 3 columns - by zone (1st and primary), team, staff name /
--    So that I send it and demand them in Whatsapp group / Include even those with no zone" -- the owner, 17 Nov 2026
--
-- WHAT COMES BACK. One row for each staff of HR's registry (staff_registry, the staff database) who has no bank account number, in three columns: ZONE, TEAM, STAFF NAME.
-- Sorted by zone (A to Z), then team, then name. A staff with NO ZONE is in the list too, as "NO ZONE", after the last zone.
--   * NO BANK ACCOUNT NUMBER: the ACCOUNTS cell of the registry is empty, or blank, or has no digit in it ("N/A", "NONE", "ON PROCESS", "-", "HAINA"), or its digits are all
--     zeros. An account with digits in it counts as given, however short it looks. Only the ACCOUNTS cell is read: not the bank's name, not a phone.
--   * THE TEAM is what the registry files after the role ("Field Officer - CHAMWINO" is team CHAMWINO), in capitals. Somebody filed with no team (head office) shows "-".
--   * ACTIVE STAFF ONLY: a staff switched to Inactive has left and is not demanded for anything. To list them too, change the word true on the line marked CHANGE to false.
-- PRINTS the three columns and nothing else: no account, no phone, no NIDA. It reads one table and changes nothing.
-- COST. One pass over the registry (a few thousand rows at most): a fraction of a second. A 30-second ceiling.
-- =====================================================================================
set local statement_timeout = '30s';
set local jit = off;

with cfg as (
  select true as active_only        -- CHANGE: false lists the staff switched to Inactive too
),
s as (
  select upper(btrim(regexp_replace(coalesce(r.zone, ''), '\s+', ' ', 'g'))) as zone0,
         upper(btrim(regexp_replace(coalesce(substring(r.role from '\s+-\s+(.*)$'), ''), '\s+', ' ', 'g'))) as team0,
         upper(btrim(regexp_replace(r.name, '\s+', ' ', 'g'))) as name0
  from public.staff_registry r
  cross join cfg
  where (not cfg.active_only or upper(btrim(coalesce(r.status, ''))) <> 'INACTIVE')
    and regexp_replace(coalesce(r.account, ''), '\D', '', 'g') ~ '^0*$'       -- no digit in the account, or only zeros
)
select coalesce(nullif(s.zone0, ''), 'NO ZONE') as "ZONE",
       coalesce(nullif(s.team0, ''), '-') as "TEAM",
       s.name0 as "STAFF NAME"
from s
order by (s.zone0 = ''), s.zone0 collate "C", (s.team0 = ''), s.team0 collate "C", s.name0 collate "C";
