-- WHICH ANALYST IS "ID 4471"?
--
-- The sale-approvals report names the credit analyst by an ID, not by their name. The system
-- names them the way everything else here names people -- by the name in the teams table. So the
-- two never met: the Credit Analysts board and the Presentation slide showed IDs that nobody in
-- the room could put a face to, and the analysts actually doing the work did not appear at all.
--
-- Nothing can guess this mapping. It is a fact only the office knows, so it needs somewhere to
-- be written down: one column beside the analyst's name, on the team they work.
--
-- OPTIONAL, like every migration here. Without it the boards fall back to showing the raw ID,
-- exactly as they do today, and nothing breaks.

alter table teams add column if not exists credit_id text;

comment on column teams.credit_id is
  'The ID this team''s credit analyst appears under in the sale-approvals report. Set in the '
  'Teams panel. NULL means unmapped, and the boards then show the raw ID rather than guessing.';
