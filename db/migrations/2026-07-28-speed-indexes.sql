-- =====================================================================================
-- INDEXES FOR THE LOOKUPS THE SCREENS ACTUALLY MAKE.
--
-- Postgres will happily scan a whole table to answer a question, and at a few thousand rows
-- nobody notices. These tables grow by a report a day, so the day it starts to hurt is not
-- announced -- it just gets slower until someone complains about loading.
--
-- Every index below matches a filter a screen makes on every load.
--
-- SAFE TO RE-RUN.
-- =====================================================================================

-- The dashboard asks for today's (or this week's) received payments on every load.
create index if not exists idx_received_paid_at on received_payments(paid_at);

-- The follow-up list, the officer boards and the phone all read followup_status scoped by team.
create index if not exists idx_followup_team on followup_status(team);

-- Comments are read newest-first per customer, and the report reads a date window.
create index if not exists idx_fu_comments_created on followup_comments(created_at desc);

-- The registers are listed by team and read by date.
create index if not exists idx_abnormal_team on abnormal_payments(team);
create index if not exists idx_complaints_team on complaints(team);
create index if not exists idx_complaints_created on complaints(created_at desc);
create index if not exists idx_restructures_team on restructures(team);
create index if not exists idx_demand_notices_team on demand_notices(team);

-- Applications per weekday on the dashboard filters loans by the day they were created.
create index if not exists idx_loans_created_at on loans(created_at);

-- The call-agent board groups the two application stages; the calls board reads a date window
-- per officer, which idx_call_logs_user_date already covers.
create index if not exists idx_loans_stage_team on loans(stage, team);
