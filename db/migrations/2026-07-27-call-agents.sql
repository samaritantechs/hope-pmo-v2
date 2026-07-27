-- =====================================================================================
-- CALL AGENTS (customer service) -- the agents named on LOAN APPLICATIONS.
--
-- These are NOT the HOPE Calls app users. Every application in the Unassigned and Assigned
-- reports carries a CREATED BY agent id (Callagent1, Callagent2, ...), and the dashboard's
-- call-agent board is about how many applications each of those agents brought in -- which
-- is a completely different question from how many phone calls a field officer made.
--
-- The id is what the application report contains; the humans behind it are named here, and
-- an id can cover more than one person because they share a desk and a login.
-- =====================================================================================

create table if not exists call_agents (
  user_id text primary key,
  names text,
  updated_at timestamptz not null default now()
);

-- The roster as it stood in the live system. Safe to re-run: existing names are left alone,
-- so an edit made in the app is never undone by running this file again.
insert into call_agents (user_id, names) values
  ('Callagent1',  'Amina Mustafa, Nadhir Msangi'),
  ('Callagent2',  'Salehe Hamad, Mariam Miraji'),
  ('Callagent3',  'Veronica Mkemwa'),
  ('Callagent4',  'Martin Simtowe'),
  ('Callagent5',  'Dorcas Dominic'),
  ('Callagent6',  'Lightness Lucas'),
  ('Callagent7',  'Fatuma Jarufu'),
  ('Callagent8',  'Nadhra Hamadi'),
  ('Callagent9',  'Leah Masali, Monica Augustino'),
  ('Callagent10', 'Asma Jumbe'),
  ('Callagent11', 'Getrude Mang''ulisa')
on conflict (user_id) do nothing;

-- The board groups applications by this column, so it is worth an index once the pipeline
-- holds a season of history.
create index if not exists idx_loans_created_by on loans(created_by) where created_by is not null;
