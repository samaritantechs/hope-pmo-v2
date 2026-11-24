-- RUN-ME-089: LEGAL RECOVERY BY PHONE, STAMPED SO THAT IT LASTS. 24 Nov 2026 (handbook Part 139). ONE paste, a NEW tab. Safe to run again.
-- "Legal officers should be added another card of legal recovery by phone" ... "stamp all recovery by phone, remember capturing
-- phone calls is 2 weeks temporary" -- the owner, 23 Nov 2026.
-- WHAT IT KEEPS, one row a customer, a phone and a day (legal_phone_recovery): a customer on that day's INITIAL defaulters file
-- SPOKEN TO that day from a phone whose role reads legal (a call longer than the setting "Minimum seconds to count a call", on a number
-- the call app tied to them: their own, the guarantor's, or one under "Ana namba nyingine"), their D.C that morning and what they
-- recovered that day (initial arrears less the day's current file; off it = all of it; no current file yet = nothing yet). The
-- portal counts the rows of D.C 2 and above whose role is legal. Call logs are cleared after last week; these rows stay.
-- Today is stamped again every ten minutes, the three days before it every eight hours (a phone can sync late), older days never.
-- IT COSTS nothing to /api/upload or /api/call: a stamp reads the legal phones' calls of ONE day and that day's two files.
-- UNDO, alone: select cron.unschedule('legal-phone-tick'); drop function if exists public.legal_phone_week(date, date, text[]), public.legal_phone_tick(interval, integer), public.legal_phone_stamp(date); drop table if exists public.legal_phone_recovery, public.legal_phone_days;
create or replace function call_min_secs()
returns integer
language sql
stable
set search_path = public, pg_catalog
as $$
select least(coalesce(nullif(regexp_replace(coalesce((select s.value from public.settings s where s.key = 'CALL_MIN_SECS'), ''), '[^0-9]', '', 'g'), '')::numeric, 5), 2000000000)::integer;
$$;
create table if not exists public.legal_phone_recovery (
day date not null, ref text not null, team text not null default '', full_name text, contact text, guarantor_contact text,
dc integer, ds text, user_id text not null, officer text, role text, phone text, match_type text,
calls integer not null default 0, secs integer not null default 0,
initial_arrears numeric(14,2), current_arrears numeric(14,2), recovered numeric(14,2) not null default 0,
paired boolean not null default false, stamped_at timestamptz not null default now(), primary key (day, ref, user_id));
create table if not exists public.legal_phone_days (day date primary key, stamped_at timestamptz not null default now(), n integer not null default 0);
alter table public.legal_phone_recovery enable row level security;
alter table public.legal_phone_days enable row level security;
revoke all on public.legal_phone_recovery, public.legal_phone_days from anon, authenticated;
create or replace function public.legal_phone_stamp(p_day date)
returns integer
language sql
set search_path = public, pg_catalog
as $$
delete from public.legal_phone_recovery where day = p_day;
with m as materialized (select public.call_min_secs() as min,
btrim(regexp_replace(upper(coalesce((select s.value from public.settings s where s.key = 'LEGAL_ROLE'), '')), '[^A-Z0-9]+', ' ', 'g')) as want),
ph as materialized (
select u.user_id, u.name, r.role from public.call_users u
cross join lateral (select coalesce((select min(c.role) from public.access_codes c where upper(btrim(c.name)) = upper(btrim(u.name)) having count(*) = 1), u.role, '') as role) r
cross join m
where upper(r.role) like '%LEGAL%' or (m.want <> '' and btrim(regexp_replace(upper(r.role), '[^A-Z0-9]+', ' ', 'g')) = m.want)
),
talk as materialized (
select c.ref, c.user_id, ph.name as officer, ph.role, c.phone, c.match_type, coalesce(c.duration, 0) as dur, c.id
from ph join public.call_logs c on c.user_id = ph.user_id and c.call_date = p_day cross join m
where coalesce(c.ref, '') <> '' and upper(btrim(coalesce(c.outcome, ''))) not in ('MISSED', 'REJECTED', 'BLOCKED') and coalesce(c.duration, 0) > m.min
),
per as materialized (
select distinct on (t.ref, t.user_id) t.ref, t.user_id, t.officer, t.role, t.phone, t.match_type,
count(*) over (partition by t.ref, t.user_id) as calls, sum(t.dur) over (partition by t.ref, t.user_id) as secs
from talk t order by t.ref, t.user_id, t.dur desc, t.id
),
dk as materialized (
select y.* from (select s.snapshot_type as kind, s.ref, coalesce(s.team, '') as team, s.full_name, s.contact, s.guarantor_contact, s.dc, s.ds, s.arrears, s.upload_batch, s.created_at,
first_value(s.upload_batch) over (partition by s.snapshot_type, coalesce(s.team, '') order by s.created_at desc nulls last, s.upload_batch desc nulls last) as win
from public.defaulter_snapshots s where s.snapshot_date = p_day and exists (select 1 from per)) y
where y.upload_batch is not distinct from y.win
),
ini as materialized (select distinct on (ref) * from dk where kind = 'initial' order by ref, created_at desc nulls last),
cur as materialized (select distinct on (ref) ref, arrears from dk where kind = 'current' order by ref, created_at desc nulls last),
hc as materialized (select exists (select 1 from dk where kind = 'current') as ok)
insert into public.legal_phone_recovery (day, ref, team, full_name, contact, guarantor_contact, dc, ds, user_id, officer, role, phone, match_type,
calls, secs, initial_arrears, current_arrears, recovered, paired, stamped_at)
select p_day, p.ref, i.team, i.full_name, i.contact, i.guarantor_contact, i.dc, i.ds, p.user_id, p.officer, p.role, p.phone, p.match_type,
p.calls::integer, p.secs::integer, i.arrears, c.arrears,
case when not hc.ok then 0 when c.ref is null then greatest(coalesce(i.arrears, 0), 0) else greatest(coalesce(i.arrears, 0) - coalesce(c.arrears, 0), 0) end,
hc.ok, now()
from per p join ini i on i.ref = p.ref cross join hc left join cur c on c.ref = p.ref;
insert into public.legal_phone_days (day, stamped_at, n) values (p_day, now(), (select count(*) from public.legal_phone_recovery where day = p_day))
on conflict (day) do update set stamped_at = excluded.stamped_at, n = excluded.n returning n;
$$;
create or replace function public.legal_phone_tick(p_max_age interval default interval '10 minutes', p_extra integer default 4)
returns jsonb
language plpgsql
set search_path = public, pg_catalog
as $$
declare
today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
d date; seen timestamptz; did jsonb := '[]'::jsonb; more integer := greatest(coalesce(p_extra, 0), 0);
begin
if not pg_try_advisory_xact_lock(7302611) then return jsonb_build_object('busy', true); end if;
select stamped_at into seen from public.legal_phone_days where day = today;
if seen is null or seen <= now() - coalesce(p_max_age, interval '10 minutes') then perform public.legal_phone_stamp(today); did := did || to_jsonb(today); end if;
for d in select today - g from generate_series(1, 3) g loop
exit when more <= 0;
select stamped_at into seen from public.legal_phone_days where day = d;
if seen is null or seen <= now() - interval '8 hours' then perform public.legal_phone_stamp(d); did := did || to_jsonb(d); more := more - 1; end if;
end loop;
if more > 0 then
select g::date into d from generate_series((date_trunc('week', today::timestamp)::date - 7)::timestamp, (today - 4)::timestamp, interval '1 day') g
where not exists (select 1 from public.legal_phone_days x where x.day = g::date) order by g desc limit 1;
if d is not null then perform public.legal_phone_stamp(d); did := did || to_jsonb(d); end if;
end if;
return jsonb_build_object('stamped', did);
end $$;
create or replace function public.legal_phone_week(p_from date, p_to date, p_teams text[] default null)
returns jsonb
language plpgsql
set search_path = public, pg_catalog
as $$
declare t jsonb;
begin
begin t := public.legal_phone_tick(interval '25 minutes', 1); exception when others then t := jsonb_build_object('error', sqlerrm); end;
return jsonb_build_object('v', 1, 'tick', t, 'first', (select min(day) from public.legal_phone_recovery),
'days', (select coalesce(jsonb_agg(jsonb_build_object('day', x.day, 'at', x.stamped_at) order by x.day), '[]'::jsonb) from public.legal_phone_days x where x.day between p_from and p_to),
'rows', (select coalesce(jsonb_agg(to_jsonb(r) order by r.day, r.ref), '[]'::jsonb) from public.legal_phone_recovery r
where r.day between p_from and p_to and (p_teams is null or r.team = any (p_teams))));
end $$;
revoke execute on function public.legal_phone_stamp(date), public.legal_phone_tick(interval, integer), public.legal_phone_week(date, date, text[]) from public, anon, authenticated;
grant execute on function public.legal_phone_stamp(date), public.legal_phone_tick(interval, integer), public.legal_phone_week(date, date, text[]) to service_role;
do $$
begin
if exists (select 1 from pg_extension where extname = 'pg_cron') then
perform cron.schedule('legal-phone-tick', '*/10 * * * *', $job$set statement_timeout = '20s'; select public.legal_phone_tick(interval '9 minutes', 4);$job$);
end if;
end $$;
select x.what, x.answer from (
select 1 as k, 'the table that keeps each day' as what, to_regclass('public.legal_phone_recovery')::text as answer
union all select 2, 'minimum seconds of a conversation (the setting)', public.call_min_secs()::text
union all select 3, 'phones whose role reads legal', (select count(*)::text from public.call_users u where upper(coalesce((select min(c.role) from public.access_codes c where upper(btrim(c.name)) = upper(btrim(u.name)) having count(*) = 1), u.role, '')) like '%LEGAL%')
union all select 4, 'stamped by itself every ten minutes', case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'yes (pg_cron)' else 'NO pg_cron: stamped when the Legal tab or the Presentation is opened' end
) x order by x.k;
-- END OF RUN-ME-089
