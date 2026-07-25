-- =====================================================================================
-- First-run seed -- run ONCE after schema.sql (Supabase SQL Editor -> paste -> Run).
--
-- Creates the first access code so you can actually log in to the dashboard and the
-- upload page. CHANGE THE CODE VALUE BELOW before running -- it is effectively a
-- password. teams = null means ALL teams (the Code.gs convention, kept in auth.js).
--
-- Idempotent: safe to re-run; an existing code/role is left untouched.
-- =====================================================================================

insert into access_codes (code, name, role, teams, tabs)
values ('CHANGE-ME-1234', 'Administrator', 'admin', null, array['upload'])
on conflict (code) do nothing;

insert into roles (role, tabs)
values ('admin', array['upload', 'dashboard'])
on conflict (role) do nothing;
