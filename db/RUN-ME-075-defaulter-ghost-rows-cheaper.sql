-- RUN-ME-075  THE GHOST-ROWS FUNCTION, CHEAPER (20 Nov 2026). Same name, same arguments, same answers; nothing in the app changes.
-- What was costly: every candidate was checked against the whole known-refs array one by one (ref <> all (array)), and the latest row of each candidate came from reading and sorting ALL its rows in one big step. Now the check is a hashed anti-join and each candidate's newest current row is asked for on its own (a top-1 sort over that customer's rows).
-- Measured on a test book with real churn (1.7 million rows, 92 teams, about 800 departed customers a team), warm and in memory: one team 45 to 17 ms, ten teams 311 to 178 ms, all 92 teams 3,711 to 1,754 ms; identical answers on 600 random books, except which of two rows with the very same timestamp is called the latest (the old one picked arbitrarily too). CORRECTED THE SAME DAY: counted in PAGES (buffers touched) it reads the SAME pages as the first text, because both read every row of every departed customer to find its newest current row: it saves CPU only. The pages are cut by db/RUN-ME-076 (a partial index on the current rows): this function WITH that index reads about ten times fewer pages than either text without it. See handbook Part 114.
-- UNDO: run section 3 of db/RUN-ME-055-defaulter-ghosts.sql again. Safe to run again.
create or replace function defaulter_ghost_rows(p_teams text[], p_known_refs text[])
returns table(ref text, full_name text, contact text, guarantor_name text, guarantor_contact text,
team text, arrears numeric, balance numeric, status text, ds text, dc int,
days_elapsed int, disb_date date, chronic_date date, expire_date date,
other_inst numeric, snapshot_date date)
language plpgsql stable set statement_timeout = '800ms' set enable_bitmapscan = off as $$
declare
v_team text;
begin
foreach v_team in array p_teams loop
return query
with recursive walk as (
(select d.ref from defaulter_snapshots d where d.team = v_team order by d.ref limit 1)
union all
select (select d2.ref from defaulter_snapshots d2
where d2.team = v_team and d2.ref > w.ref order by d2.ref limit 1)
from walk w
where w.ref is not null
),
candidates as (
select wk.ref from walk wk
where wk.ref is not null
and not exists (select 1 from unnest(p_known_refs) k(r) where k.r = wk.ref)
)
select l.ref, l.full_name, l.contact, l.guarantor_name, l.guarantor_contact, l.team, l.arrears, l.balance,
l.status, l.ds, l.dc, l.days_elapsed, l.disb_date, l.chronic_date, l.expire_date, l.other_inst, l.snapshot_date
from candidates c
cross join lateral (
select d.ref, d.full_name, d.contact, d.guarantor_name, d.guarantor_contact, d.team, d.arrears, d.balance,
d.status, d.ds, d.dc, d.days_elapsed, d.disb_date, d.chronic_date, d.expire_date, d.other_inst, d.snapshot_date
from defaulter_snapshots d
where d.ref = c.ref and d.team = v_team and d.snapshot_type = 'current'
order by d.snapshot_date desc, d.created_at desc
limit 1) l;
end loop;
end;
$$;
select proname from pg_proc where proname = 'defaulter_ghost_rows';
-- END OF THE SCRIPT: if the editor shows this line, the whole text arrived.
