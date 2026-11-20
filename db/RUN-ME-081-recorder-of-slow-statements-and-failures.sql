-- RUN-ME-081: THE RECORDER -- the database writes down, by itself, what runs long and how many requests fail. 20 Nov 2026.
-- "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner.
-- WHY: a statement cancelled at the role's 8-second limit is in none of pg_stat_statements' figures, and the Logs Explorer is not where the
-- owner works. The statements that are running NOW are visible, though, to the database itself. So every 5 seconds this notes down any
-- statement the app sent that has been running for more than 3 seconds (what it is, how long, and what it is waiting for), and every minute
-- it notes the failed-request count and the temp spill. After a working day RUN-ME-082 and RUN-ME-083 read it back: failed requests hour by
-- hour, and the statements that ran longest, including the ones that were cancelled.
-- WHAT IT WRITES: only to two small tables in a schema of its own (ops), which the API does not expose: ops.db_health_samples (one row a
-- minute) and ops.db_slow_samples (one row for each statement that runs long, kept up to date while it runs). Rows older than 14 days are deleted every night.
-- WHAT IT RECORDS: only statements Postgrest built for the app (they start WITH pgrst_source): their text has $1, $2 where values go, so no
-- customer name, number or amount. Your own scripts in the SQL editor are never recorded.
-- WHAT IT COSTS: one tiny insert every 5 seconds and one a minute, run by Supabase's own scheduler (pg_cron); nothing in the app changes and
-- nothing is added to /api/upload or /api/call. It reads Postgres's own session list.
-- IF IT FAILS: it is one script, so it changes nothing. If it says it may not create the extension pg_cron, turn it on once in the dashboard
-- (Database, Extensions, search pg_cron, switch it on) and run this again. It is safe to run again.
-- UNDO, alone, in a new tab (the last lines of this file say the same):
--   select cron.unschedule('ops-health-sample'); select cron.unschedule('ops-slow-sample'); select cron.unschedule('ops-retention'); drop schema ops cascade;
create extension if not exists pg_cron with schema pg_catalog;
do $$ begin
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
exception when others then null;
end $$;
create schema if not exists ops;
create table if not exists ops.db_health_samples (
at timestamptz primary key,
xact_commit bigint not null, xact_rollback bigint not null,
temp_files bigint not null, temp_bytes bigint not null, deadlocks bigint not null,
blks_read bigint not null, blks_hit bigint not null,
connections integer not null, active_statements integer not null
);
create table if not exists ops.db_slow_samples (
pid integer not null, query_start timestamptz not null,
first_seen timestamptz not null, last_seen timestamptz not null, running_for interval not null,
state text, wait_event_type text, wait_event text, samples integer not null,
application_name text, target text, query text not null,
primary key (pid, query_start)
);
create index if not exists db_slow_samples_seen on ops.db_slow_samples (first_seen);
select cron.schedule('ops-health-sample', '* * * * *', $job$insert into ops.db_health_samples select now(), d.xact_commit, d.xact_rollback, d.temp_files, d.temp_bytes, d.deadlocks, d.blks_read, d.blks_hit, (select count(*) from pg_stat_activity where datname = current_database()), (select count(*) from pg_stat_activity where datname = current_database() and state = 'active' and pid <> pg_backend_pid()) from pg_stat_database d where d.datname = current_database() on conflict do nothing$job$);
select cron.schedule('ops-slow-sample', '5 seconds', $job$insert into ops.db_slow_samples as t (pid, query_start, first_seen, last_seen, running_for, state, wait_event_type, wait_event, samples, application_name, target, query) select a.pid, a.query_start, now(), now(), now() - a.query_start, a.state, a.wait_event_type, a.wait_event, 1, a.application_name, coalesce(substring(a.query from 'LATERAL "public"\."([a-z_0-9]+)"'), substring(a.query from 'INTO "public"\."([a-z_0-9]+)"'), substring(a.query from 'FROM "public"\."([a-z_0-9]+)"'), '?'), left(regexp_replace(a.query, '\s+', ' ', 'g'), 1500) from pg_stat_activity a where a.datname = current_database() and a.state = 'active' and a.pid <> pg_backend_pid() and a.query_start < now() - interval '3 seconds' and a.query ~* '^\s*with pgrst_source as' order by a.query_start limit 50 on conflict (pid, query_start) do update set last_seen = excluded.last_seen, running_for = excluded.running_for, state = excluded.state, wait_event_type = excluded.wait_event_type, wait_event = excluded.wait_event, samples = t.samples + 1$job$);
select cron.schedule('ops-retention', '17 3 * * *', $job$delete from ops.db_health_samples where at < now() - interval '14 days'; delete from ops.db_slow_samples where first_seen < now() - interval '14 days'; delete from cron.job_run_details where end_time < now() - interval '2 days'$job$);
-- UNDO, alone: select cron.unschedule('ops-health-sample'); select cron.unschedule('ops-slow-sample'); select cron.unschedule('ops-retention'); drop schema ops cascade;
-- END OF THE SCRIPT: the recorder is on; read it back with RUN-ME-082 and RUN-ME-083 after a working day
