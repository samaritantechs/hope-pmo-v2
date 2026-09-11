-- =====================================================================================
--  RUN ME.  THE COMPANY PHONE REGISTER -- enrol, lock, unlock, write off.
-- =====================================================================================
--
--    "GM wants us to enroll and lock all our hope company phones ... field officers,
--     managers, gmos, pmos etc are provided with company devices and some of uor unworth
--     employees quit with our phones"
--
--  Two tables and nothing else. Paste the WHOLE FILE into the Supabase SQL editor and run
--  it once. Safe to re-run: every statement is `if not exists` or `add column if not
--  exists`, so a second run over a register that already holds phones changes nothing and
--  deletes nothing.
--
--  UNTIL THIS RUNS, NOTHING BREAKS. The two nav panes open, say the register has not been
--  created yet, and name this file. That is the rule every migration in this repository is
--  held to -- see CLAUDE.md -- and it matters more here than usual: the panes are new, so
--  the first person to open them will be doing it before anybody has run this.
--
--  WHOSE PHONES THESE ARE, and why this register is not Hoop's.
--  -------------------------------------------------------------------------------------
--  Hoop's identical-looking register holds CUSTOMERS' phones, financed by Watu and locked
--  when an instalment is missed. This one holds the COMPANY'S OWN handsets, issued to
--  staff. The mechanism is the same and the deliberately different part is the holder: a
--  row here names an employee, their team and their role, because the question this
--  register answers is "who has this phone and are they still with us".
--
--  THE IMEI IS THE KEY, not the phone number and not the person. Staff change teams, swap
--  SIMs and hand handsets on; the IMEI is the one thing about a phone that does not move.
-- =====================================================================================

create table if not exists devices (
  imei text primary key,

  -- WHERE IT CAME FROM. Stamped at enrolment so a handset can always be traced back to the
  -- day the company took control of it, and to whoever was at the bench.
  enrolled_at   timestamptz not null default now(),
  enrolled_by   text,                    -- the signed-in code that provisioned it
  enrol_batch   uuid,                    -- one uuid per enrolment session at the bench
  enrol_batch_at timestamptz,            -- when that batch was minted; it expires in a day
  item          text,                    -- the model, typed at the bench

  -- WHO IS CARRYING IT. The whole reason this register exists for HOPE rather than for a
  -- lender's customers. `holder` is a staff name; the team and role are copied beside it so
  -- a phone can be found by the officer who has it without joining anything.
  holder        text,
  holder_team   text,
  holder_role   text,
  issued_at     timestamptz,             -- handed to that person; null = still in the store

  -- WHAT STATE IT IS MEANT TO BE IN. `state` is the INTENT held by the office; `reported`
  -- is what the phone last said about itself. They are two different facts on purpose -- a
  -- phone told to lock that has not checked in yet is neither "locked" nor a failure, it is
  -- PENDING, and a report that blurs those two cannot be trusted to chase anything.
  state         text not null default 'enrolled'
                  check (state in ('enrolled', 'locked', 'released', 'lost')),
  state_reason  text,
  state_by      text,
  state_at      timestamptz,

  reported      text,                    -- 'locked' | 'unlocked' -- the phone's own word
  last_seen     timestamptz,             -- last heartbeat; null = never spoke
  app_version   text,
  battery       integer,
  android       text,
  reported_imei text,                    -- what the handset thinks its own IMEI is

  released_at   timestamptz,             -- when it was handed back and set free for good

  updated_at    timestamptz not null default now()
);

-- THE HANDSET'S CREDENTIAL. A phone in a field officer's pocket has no access code and
-- never will: shipping a staff credential inside an APK we hand to the very people we may
-- need to lock out is the one thing this design must not do. So enrolment mints one random
-- token per device, it goes into that one phone at provisioning, and it authorises exactly
-- that one IMEI against /api/device. It is a SECRET: never selected onto a screen or into
-- an export, and only ever shown in the provisioning command at the bench.
alter table devices add column if not exists enrol_token text;
create unique index if not exists idx_devices_enrol_token on devices(enrol_token)
  where enrol_token is not null;

-- The register is read by state and by holder far more often than by IMEI.
create index if not exists idx_devices_state on devices(state);
create index if not exists idx_devices_holder on devices(holder);

-- EVERY STATE CHANGE, KEPT. Locking a phone is an act against a named person, and six
-- months later "why was this locked, and who ordered it" has to have an answer. The table
-- above holds only the CURRENT state; this holds the history. Append-only, never updated.
create table if not exists device_events (
  id         uuid primary key default gen_random_uuid(),
  imei       text not null,
  event      text not null,              -- enrolled | lock | unlock | release | lost | heartbeat
  from_state text,
  to_state   text,
  reason     text,
  actor      text,
  at         timestamptz not null default now()
);
create index if not exists idx_device_events_imei on device_events(imei, at desc);

-- =====================================================================================
--  DID IT LAND? Run these two after the file above.
-- =====================================================================================
-- select count(*) as phones from devices;
-- select event, count(*) from device_events group by event order by 2 desc;
