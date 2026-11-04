-- RUN-ME-049f -- THE ANNUAL REPORT, part 6 of 6: the index the sales function reads by. SLOW, ON ITS OWN.
-- Creating it walks the whole loans table once, so it is the only script here that can time out.
-- Optional: the tab works without it (the function is just slower). Safe to re-run.
create index if not exists loans_approved_date_team_idx on loans (approved_date, team);

select 'loans_approved_date_team_idx' as piece, count(*) as present
from pg_indexes where indexname = 'loans_approved_date_team_idx';
