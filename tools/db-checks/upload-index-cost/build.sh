#!/bin/bash
#!/bin/bash
# THE SCRATCH BOOK FOR tools/db-checks/upload-index-cost/measure.mjs (handbook Part 127, addendum 4; 21 Nov 2026).
# Builds, on a disposable cluster of its own (port 5433, see the header of measure.mjs), the REAL defaulter_snapshots (db/schema.sql) with about 2.1 million rows laid
# out day after day as uploads write them (110 days, an initial and a current deck each, about 9,500 loans on a deck, a loan standing on the decks 30 to 90 days),
# then every index the live book has (the three of db/schema.sql, the date index, RUN-ME-055's (team, ref), RUN-ME-054's two trigram indexes, RUN-ME-076's partial index),
# then the next day's two decks in two staging tables (stage: random order, as a file comes; stage_sorted: sorted by team and ref). Takes about two minutes.
# NEVER point it at the live book: it drops and makes the database hope_upidx_base.
# Builds the scratch book: the real defaulter_snapshots (db/schema.sql), ~2.2 million rows laid out day after day, then every index the live book has.
set -e
export PGHOST=/var/run/postgresql PGPORT=5433 PGUSER=postgres
P="psql -X -q -At -v ON_ERROR_STOP=1"
$P -c "drop database if exists hope_upidx_base" postgres
$P -c "create database hope_upidx_base" postgres
$P -d hope_upidx_base -f /home/user/hope-pmo-v2/db/schema.sql > /dev/null
$P -d hope_upidx_base -c "create extension if not exists pg_trgm"
# drop the indexes the schema made on the deck table: they are rebuilt after the load, with every other index of the live book
$P -d hope_upidx_base -c "drop index if exists idx_def_snap_lookup, idx_def_snap_ref, idx_def_snap_batch"
START=$(date +%s)
$P -d hope_upidx_base <<'SQL'
insert into teams(team) select 'TEAM ' || lpad(g::text, 2, '0') from generate_series(1, 60) g on conflict do nothing;
create table loans_scratch as
with syl as (select array['MA','JO','SA','AN','RA','KI','LU','BE','TO','NE','HA','MU','FA','RI','DE','ZA','OM','SI','CH','WA','NG','PE','LI','GO','KA','MB','NY','TA','DA','SH'] a)
select g as n,
 (4000000000 + g::bigint * 37 + (g % 13))::text as ref,
 'TEAM ' || lpad(((g * 7) % 60 + 1)::text, 2, '0') as team,
 syl.a[1 + (g * 3) % 30] || syl.a[1 + (g * 5) % 30] || syl.a[1 + (g * 7) % 30] || ' ' || syl.a[1 + (g * 11) % 30] || syl.a[1 + (g * 13) % 30] || syl.a[1 + (g * 17) % 30] || syl.a[1 + (g * 19) % 30] || ' ' || syl.a[1 + (g * 23) % 30] || syl.a[1 + (g * 29) % 30] || syl.a[1 + (g * 31) % 30] as full_name,
 '07' || lpad(((g::bigint * 7919) % 100000000)::text, 8, '0') as contact,
 syl.a[1 + (g * 37) % 30] || syl.a[1 + (g * 41) % 30] || syl.a[1 + (g * 43) % 30] || ' ' || syl.a[1 + (g * 47) % 30] || syl.a[1 + (g * 53) % 30] || syl.a[1 + (g * 59) % 30] as guarantor_name,
 '07' || lpad(((g::bigint * 104729) % 100000000)::text, 8, '0') as guarantor_contact,
 (g::bigint * 7919) % 170 - 60 as start_day,
 30 + (g::bigint * 104729) % 60 as len
from generate_series(1, 28000) g, syl;
-- the decks: one initial and one current for each of 110 days, each with the loans active that day, written a deck at a time in a random order inside the deck
insert into defaulter_snapshots (ref, full_name, contact, guarantor_name, guarantor_contact, disb_date, expire_date, chronic_date, due_date, last_trans_date, status, ds, dc, days_elapsed,
  initial_inst, other_inst, payment_exp, t_payment, arrears, balance, branch, team, zone, nearest_landmark, snapshot_type, weekday, snapshot_date, upload_batch, created_at)
select l.ref, l.full_name, l.contact, l.guarantor_name, l.guarantor_contact,
 date '2026-08-03' + d.d - (l.n % 90), date '2026-08-03' + d.d + 91 - (l.n % 90), date '2026-08-03' + d.d + 105 - (l.n % 90), date '2026-08-03' + d.d + (l.n % 7), date '2026-08-03' + d.d - (l.n % 20),
 (array['Defaulter','Chronic','Expired','Partial Defaulter'])[1 + (l.n + d.d) % 4], ((l.n + d.d) % 12) || '/12', 1 + (l.n + d.d) % 5, 20 + (l.n + d.d) % 150,
 50000 + (l.n % 50) * 1000, (l.n % 30) * 1000, 12000 + (l.n % 40) * 500, (l.n % 20) * 3000, (l.n % 100) * 1500, 100000 + (l.n % 200) * 1000,
 'BRANCH ' || (l.n % 40), l.team, 'ZONE ' || (l.n % 8), 'NEAR LANDMARK ' || (l.n % 500),
 t.t, (array['MON','TUE','WED','THU','FRI','SAT','SUN'])[1 + ((d.d + 0) % 7)], date '2026-08-03' + d.d,
 md5('batch' || d.d || t.t)::uuid, timestamptz '2026-08-03 09:00+03' + (d.d || ' days')::interval + (case when t.t = 'initial' then interval '0' else interval '9 hours' end)
from generate_series(0, 109) as d(d)
cross join (values ('initial'), ('current')) as t(t)
join loans_scratch l on d.d >= l.start_day and d.d < l.start_day + l.len
order by d.d, t.t, md5(l.n::text || d.d::text || t.t);
SQL
echo "rows loaded in $(( $(date +%s) - START )) s"
$P -d hope_upidx_base -c "select count(*), count(distinct snapshot_date), min(snapshot_date), max(snapshot_date), pg_size_pretty(pg_table_size('defaulter_snapshots')) from defaulter_snapshots"
START=$(date +%s)
for ddl in \
 "create index idx_def_snap_lookup on defaulter_snapshots(snapshot_type, weekday, snapshot_date, team)" \
 "create index idx_def_snap_ref on defaulter_snapshots(ref, snapshot_date)" \
 "create index idx_def_snap_batch on defaulter_snapshots(snapshot_type, weekday, snapshot_date, upload_batch)" \
 "create index idx_def_snap_date on defaulter_snapshots(snapshot_date)" \
 "create index idx_def_snap_team_ref on defaulter_snapshots(team, ref)" \
 "create index idx_def_snap_fullname_trgm on defaulter_snapshots using gin (full_name gin_trgm_ops)" \
 "create index idx_def_snap_ref_trgm on defaulter_snapshots using gin (ref gin_trgm_ops)" \
 "create index idx_def_snap_current_last on defaulter_snapshots (team, ref, snapshot_date desc, created_at desc) where snapshot_type = 'current'" ; do
  $P -d hope_upidx_base -c "$ddl"; echo "$(( $(date +%s) - START )) s: ${ddl:0:60}"
done
$P -d hope_upidx_base <<'SQL'
drop table if exists stage;
create table stage as
select row_number() over (partition by t.t order by md5(l.n::text || 'next' || t.t)) as n, t.t as snapshot_type,
 l.ref, l.full_name, l.contact, l.guarantor_name, l.guarantor_contact,
 date '2026-08-03' + 110 - (l.n % 90) as disb_date, date '2026-08-03' + 110 + 91 - (l.n % 90) as expire_date, date '2026-08-03' + 110 + 105 - (l.n % 90) as chronic_date, date '2026-08-03' + 110 + (l.n % 7) as due_date, date '2026-08-03' + 110 - (l.n % 20) as last_trans_date,
 (array['Defaulter','Chronic','Expired','Partial Defaulter'])[1 + (l.n + 110) % 4] as status, ((l.n + 110) % 12) || '/12' as ds, 1 + (l.n + 110) % 5 as dc, 20 + (l.n + 110) % 150 as days_elapsed,
 (50000 + (l.n % 50) * 1000)::numeric(14,2) as initial_inst, ((l.n % 30) * 1000)::numeric(14,2) as other_inst, (12000 + (l.n % 40) * 500)::numeric(14,2) as payment_exp, ((l.n % 20) * 3000)::numeric(14,2) as t_payment, ((l.n % 100) * 1500)::numeric(14,2) as arrears, (100000 + (l.n % 200) * 1000)::numeric(14,2) as balance,
 'BRANCH ' || (l.n % 40) as branch, l.team, 'ZONE ' || (l.n % 8) as zone, 'NEAR LANDMARK ' || (l.n % 500) as nearest_landmark,
 'FRI' as weekday, date '2026-08-03' + 110 as snapshot_date, md5('batch-next' || t.t)::uuid as upload_batch, timestamptz '2026-11-21 06:00+00' as created_at
from (values ('initial'), ('current')) as t(t)
join loans_scratch l on 110 >= l.start_day and 110 < l.start_day + l.len;
create index on stage (snapshot_type, n);
drop table if exists stage_sorted;
create table stage_sorted as
select row_number() over (partition by snapshot_type order by team, ref) as n, snapshot_type, ref, full_name, contact, guarantor_name, guarantor_contact, disb_date, expire_date, chronic_date, due_date, last_trans_date, status, ds, dc, days_elapsed, initial_inst, other_inst, payment_exp, t_payment, arrears, balance, branch, team, zone, nearest_landmark, weekday, snapshot_date, upload_batch, created_at from stage;
create index on stage_sorted (snapshot_type, n);
analyze stage; analyze stage_sorted;
SQL
$P -d hope_upidx_base -c "vacuum analyze defaulter_snapshots" 
$P -d hope_upidx_base -c "checkpoint"
$P -d hope_upidx_base -c "select c.relname, pg_size_pretty(pg_relation_size(c.oid)) from pg_class c join pg_index i on i.indexrelid = c.oid where i.indrelid = 'defaulter_snapshots'::regclass order by pg_relation_size(c.oid) desc"
$P -d hope_upidx_base -c "select 'table', pg_size_pretty(pg_relation_size('defaulter_snapshots')), 'total', pg_size_pretty(pg_total_relation_size('defaulter_snapshots'))"
echo BUILD_DONE
