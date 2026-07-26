-- =====================================================================================
-- FIELD OFFICER ACCOUNTS -- close self-registration on the calls app.
--
-- Until now anyone holding the APK could register by typing a name, picking a team from
-- the public list and entering a phone number. No password, no approval, no admin
-- involvement. That granted a working device session against real customer data:
-- names, phone numbers, arrears, guarantors -- the whole portfolio for that team.
--
-- Worse, nothing revoked it. An officer who walked out on Friday still held a live
-- session on Monday, and the only way to cut them off was for someone to notice and
-- delete the row by hand.
--
-- From here an account must be CREATED BY AN ADMIN before anyone can sign in with it,
-- and it carries a passcode the admin can change or switch off at any moment. Changing
-- or deactivating a passcode releases the device immediately, so revocation takes effect
-- on the officer's next request rather than whenever they happen to sign out.
--
-- Passcodes are stored as scrypt hashes with a per-row salt, never in clear text. The
-- admin sees a passcode exactly once -- at the moment it is generated -- and can only
-- replace it afterwards, not read it back.
-- =====================================================================================

alter table call_users add column if not exists passcode_hash text;
alter table call_users add column if not exists passcode_salt text;
alter table call_users add column if not exists passcode_set_at timestamptz;
alter table call_users add column if not exists created_by text;

-- Existing registrations predate passcodes. They stay ACTIVE so nobody is locked out by
-- the deploy itself, but every one of them has a NULL passcode_hash, which the admin
-- screen flags as "no passcode set" -- issue one and the old self-registered access dies.
alter table call_users add column if not exists active boolean not null default true;

-- Revocation has to be answerable in one indexed lookup on every request.
create index if not exists idx_call_users_active on call_users(device_id) where active;
