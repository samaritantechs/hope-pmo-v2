-- =====================================================================================
-- First-run seed -- run ONCE after schema.sql (Supabase SQL Editor -> paste -> Run).
--
-- Creates the first access code so you can actually log in to the dashboard and the
-- upload page. CHANGE THE CODE VALUE BELOW before running -- it is effectively a
-- password. teams = null means ALL teams (the Code.gs convention, kept in auth.js).
--
-- Idempotent: safe to re-run; an existing code/role is left untouched.
-- =====================================================================================

-- 'settings' is the admin permission (matching the live system's ADMIN/CUSTOM roles):
-- it is what allows uploading the Access Codes / User Roles sheets from the upload page.
insert into access_codes (code, name, role, teams, tabs)
values ('CHANGE-ME-1234', 'Administrator', 'ADMIN', null, array['upload', 'settings'])
on conflict (code) do nothing;

insert into roles (role, tabs)
values ('ADMIN', array['upload', 'settings', 'dashboard'])
on conflict (role) do nothing;
