-- RUN-ME-080: WHICH STATEMENTS WRITE TO DISK AND WHICH READ THE DISK -- read-only, from pg_stat_statements. 20 Nov 2026.
-- "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner.
-- WHY: RUN-ME-079 (the owner ran it at 18:23 East Africa time) counted 143,120 temp files and 1,640 GB written to disk since the counters began: about
-- 570 times the size of the whole database. A statement that sorts or hashes more than its small working memory writes temp files and runs several
-- times slower. This names the statements that did it (and the ones that read the disk most), so the next matter is chosen from them.
-- WHAT IT PRINTS (twenty rows at most): the ten statements that wrote most to temp files and the ten that read most from disk: how many times each
-- ran, the time in all, on average and at worst, what it wrote to temp, what it read from disk, and the first 150 characters of its text as Postgres
-- normalises it (the values are $1, $2: no customer name, number or amount). ONLY statements that begin SELECT, WITH, INSERT, UPDATE, DELETE or MERGE are listed:
-- Postgres puts $1, $2 in place of the values of those, but keeps the WHOLE text of every other kind (the arguments of a CALL, the body of a DO block, a SET),
-- and that is where a name or a number somebody typed in the SQL editor would be. A statement that begins with a comment is not listed either.
-- LIMIT, said once: pg_stat_statements counts only statements that FINISHED; one cancelled at the role's limit is in none of its figures.
-- WHAT IT COSTS: it reads one view of Postgres's own counters; it changes nothing and touches no table of the book.
(select 'writes to disk most' as ranking, calls, round(total_exec_time) as total_ms, round(mean_exec_time) as avg_ms, round(max_exec_time) as worst_ms,
pg_size_pretty(temp_blks_written * 8192) as written_to_temp, pg_size_pretty(shared_blks_read * 8192) as read_from_disk,
left(regexp_replace(query, '\s+', ' ', 'g'), 150) as query
from pg_stat_statements
where temp_blks_written > 0 and query ~* '^\s*(select|with|insert|update|delete|merge)\y'
order by temp_blks_written desc
limit 10)
union all
(select 'reads the disk most' as ranking, calls, round(total_exec_time) as total_ms, round(mean_exec_time) as avg_ms, round(max_exec_time) as worst_ms,
pg_size_pretty(temp_blks_written * 8192) as written_to_temp, pg_size_pretty(shared_blks_read * 8192) as read_from_disk,
left(regexp_replace(query, '\s+', ' ', 'g'), 150) as query
from pg_stat_statements
where shared_blks_read > 0 and query ~* '^\s*(select|with|insert|update|delete|merge)\y'
order by shared_blks_read desc
limit 10);
-- END OF THE READ
