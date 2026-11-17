-- =====================================================================================
-- RUN-ME-064: EVERY DATE IN THE BOOK. WHERE IS ONE LATER THAN TODAY, OR IMPOSSIBLY OLD? READ-ONLY: changes nothing.
--
--   "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026
--
-- WHAT IT DOES. It lists EVERY column of EVERY table of the book that holds a date or a timestamp (found from the database's own catalogue, so a table
-- made by a migration is in it too, and so is a column nobody has thought of), and for each one: how many rows, how many are filled, the earliest
-- and the latest value, how many are LATER THAN TODAY (East Africa date) and how many are BEFORE 2020. It reads each table once, whatever its
-- number of date columns. It is the way to find a wrong date nobody has noticed: a payment dated December, a comment dated 1970, a staff
-- registration in the future. A flagged line is a place to look, not a proof (a promise date, an expiry or a leave that starts next week is
-- LATER THAN TODAY and right), so the lines of columns where a later date is normal are not flagged, and say so.
--
--   FUTURE?  a column where a date later than today is NOT normal has some: the old importer's swap puts a date there, so do a typo and a wrong year.
--   OLD?     a column that is not a birth date has a date before 2020: a two-digit year read wrong, a blank turned into a date.
--   (blank)  nothing odd.   The pattern tests that see the wrong dates that are still in the past are db/RUN-ME-061, 062 and 063.
--
-- COST. One pass over each table (the decks table, about two million rows, is the biggest: a few seconds). One process (no parallel workers), a
-- 45-second ceiling, nothing written, no lock beyond a read. Run it when no upload is running.
-- =====================================================================================
set local jit = off;
set local statement_timeout = '45s';
set local max_parallel_workers_per_gather = 0;

with cols as (   -- every date / timestamp column of every table of the public schema, from the catalogue
  select c.table_name, c.column_name, c.data_type,
         row_number() over (partition by c.table_name order by c.ordinal_position) as k,
         (c.data_type = 'date') as is_date
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.data_type in ('date', 'timestamp with time zone', 'timestamp without time zone')
),
q as (    -- one query per table: all of its date columns in ONE pass
  select table_name,
         'select count(*) as n, ' || string_agg(format(
           'count(%1$I) as c%2$s_n, min(%1$I)::text as c%2$s_min, max(%1$I)::text as c%2$s_max, count(*) filter (where %1$I > %3$s) as c%2$s_fut, count(*) filter (where %1$I < date ''2020-01-01'') as c%2$s_old',
           column_name, k,
           case when is_date then '(now() at time zone ''Africa/Dar_es_Salaam'')::date' else '(now() + interval ''1 day'')' end), ', ' order by k)
         || format(' from public.%I', table_name) as sql
  from cols
  group by table_name
),
r as (select q.table_name, query_to_xml(q.sql, true, true, '') as x from q),
f as (    -- the answers, taken out of the XML
  select cols.table_name, cols.column_name, cols.data_type, cols.k,
         ((xpath('/row/n/text()', r.x))[1])::text::bigint                                as n,
         ((xpath('/row/c' || cols.k || '_n/text()', r.x))[1])::text::bigint              as n_filled,
         ((xpath('/row/c' || cols.k || '_min/text()', r.x))[1])::text                    as d_min,
         ((xpath('/row/c' || cols.k || '_max/text()', r.x))[1])::text                    as d_max,
         ((xpath('/row/c' || cols.k || '_fut/text()', r.x))[1])::text::bigint            as n_fut,
         ((xpath('/row/c' || cols.k || '_old/text()', r.x))[1])::text::bigint            as n_old,
         (cols.column_name ~* '(expire|chronic|due|promise|schedule|start|end|until|next|deadline|valid|retire|snapshot_date)') as future_ok,
         (cols.column_name ~* '(birth|dob)')                                             as birth
  from cols join r using (table_name)
),
g as (
  select f.*, case when n_fut > 0 and not future_ok then 'FUTURE?' when n_old > 0 and not birth then 'OLD?' else '' end as flag
  from f
)
select z.what, z.answer from (
  select 0 as ord, 'today (East Africa time)' as what, to_char((now() at time zone 'Africa/Dar_es_Salaam')::date, 'YYYY-MM-DD Dy') as answer
  union all
  select 1, 'ANSWER',
         (select count(*) from g) || ' date columns in ' || (select count(distinct table_name) from g) || ' tables; '
         || (select count(*) from g where flag = 'FUTURE?') || ' with a date later than today where that is not normal, '
         || (select count(*) from g where flag = 'OLD?') || ' with a date before 2020'
  union all
  select 10 + row_number() over (order by case g.flag when 'FUTURE?' then 0 when 'OLD?' then 1 else 2 end, g.table_name, g.k)::int,
         rpad(g.flag, 8) || g.table_name || '.' || g.column_name || ' (' || case g.data_type when 'date' then 'date' when 'timestamp with time zone' then 'time' else 'time, no zone' end || ')',
         'rows ' || to_char(g.n, 'FM999,999,999') || ', filled ' || to_char(g.n_filled, 'FM999,999,999')
         || coalesce(', earliest ' || left(g.d_min, 16) || ', latest ' || left(g.d_max, 16), '')
         || ', later than today ' || to_char(g.n_fut, 'FM999,999,999') || ', before 2020 ' || to_char(g.n_old, 'FM999,999,999')
         || case when g.n_fut > 0 and g.future_ok then '   (a later date is normal in this column)' else '' end
  from g
) z
order by z.ord;
