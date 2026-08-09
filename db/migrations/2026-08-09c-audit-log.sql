-- =====================================================================================
-- WHO DID WHAT.
--
--   "Add an audit log nav and start with access for admin only, I may tyick it to be seen on
--    others via settings as usual so that we know who did what"
--
-- Every change to this system already goes through ONE door -- portalApi dispatches every
-- function the portal can call -- so the log is written in one place and cannot be forgotten
-- at the hundredth call site. What it records is the ACT, not the data: who, what they called,
-- which customer or team or setting it concerned, and whether it worked.
--
-- WHAT IT DELIBERATELY DOES NOT STORE
--
--   Amounts, names, phone numbers, comment text. An audit log is read by whoever is allowed to
--   see the log, and a log that carries the arguments in full becomes a second, unguarded copy
--   of the customer book -- readable by anyone the switch is ever ticked for. So the arguments
--   are reduced to the few identifying fields (ref, team, key, code, role) and everything else
--   is dropped. "JUMA G saved a follow-up on customer 4471" is what a supervisor needs; the
--   comment itself is already in followup_comments where the team scoping applies.
--
--   READS ARE NOT LOGGED EITHER. Two hundred officers opening a dashboard every few minutes
--   would bury the twelve writes a day that matter, and the point of this table is to be
--   readable by a person. It records the calls that CHANGE something.
--
-- OPTIONAL, LIKE EVERY MIGRATION HERE. Until it is run, the write is skipped silently -- an
-- audit log that could break a save would be worse than no audit log, because it would turn
-- every write in the system into two things that must both succeed. The nav tab shows an empty
-- table naming this file.
--
-- SAFE TO RE-RUN. INSTANT -- one empty table and two indexes.
-- =====================================================================================

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),

  at timestamptz not null default now(),

  -- WHO. The code is kept as well as the name because a name can be edited and two people can
  -- share one; the code is what actually signed in.
  actor_code text,
  actor_name text,
  actor_role text,

  -- WHAT. The portal function name -- saveTeam, deleteAccessCode, commissionSave -- which is
  -- the vocabulary the rest of the system is written in, so a line in this table can always be
  -- traced to the code that produced it.
  action text not null,

  -- WHICH. The few identifying fields, never the payload. Any of them may be null.
  ref text,
  team text,
  subject text,                     -- a settings key, a role name, an access code, a team name

  ok boolean not null default true,
  error text,                       -- the message a failed attempt produced, trimmed

  -- A failed attempt is worth MORE than a successful one, not less: somebody trying to delete a
  -- team they may not touch is exactly what an audit log exists to show.
  ms integer                        -- how long it took, which is how a slow screen gets traced
);

-- The two ways anyone reads this: newest first, and everything one person did.
create index if not exists idx_audit_at on audit_log(at desc);
create index if not exists idx_audit_actor on audit_log(actor_code, at desc);

grant select, insert on table audit_log to anon, authenticated, service_role;

-- DID IT LAND?
-- select count(*) from audit_log;
