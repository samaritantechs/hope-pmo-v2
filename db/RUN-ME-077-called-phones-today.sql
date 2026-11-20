-- RUN-ME-077  THE DAY'S CALLED NUMBERS, AS ONE SMALL ANSWER (20 Nov 2026). DB only: no screen changes, nothing is deployed with it.
-- "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner. pg_stat_statements put this read at the top of the whole book: select phone, duration from call_logs where call_date = today ran 272,573 times, 320 ms on average, 7,991 ms at worst, 87,148 seconds in all (a quarter of the twelve heaviest statements put together), under EVERY officer's list in the call app.
-- WHAT THE LIST NEEDS is one fact per number: was it rung today for longer than a dial attempt. This function collapses the day's calls to their distinct numbers inside the database and answers ONE value, {"phones": [...]}: no paging, no row cap. The old read asked for the day in pages of ten thousand, each page ran the whole query again and sorted the whole day by id again. The numbers come back as stored: the app's own pnorm still decides what a number is.
-- MEASURED by tools/db-checks/called-phones.mjs on a test book of 800,000 call-log rows (forty days of 20,000; the day asked for has 20,000), the old read's three statements against this one, in buffers touched (hits and reads together), warm, on the test machine:
--   rows of a day together on the table:   old 807 pages, 66-82 ms, 772 KB  ->  this 430 pages, 8-11 ms, 91 KB
--   every row in a random place (worst):   old 25,860 pages, 119-164 ms, 772 KB  ->  this 8,780 pages, 23-34 ms, 91 KB
--   That is 1.9 to 2.9 times fewer pages, 4 to 8 times less database time and 8.5 times fewer bytes. The live seconds are NOT known: the live table is bigger and on disk. The check compares the answer with the old read's on 200 random books (numbers written six ways, junk, null and empty phones, durations either side of every threshold) and breaks this file on purpose: every break is caught.
-- WHAT IT COSTS: nothing. It reads call_logs through the existing date index and changes no row; no index is added (call_logs is written by the phones' sync: the sacred path). On /api/call it REPLACES the read: one call where there were three or more. Nothing is added to /api/upload.
-- UNTIL IT IS RUN the app reads the day page by page exactly as it always did and asks for the function again every five minutes. If the function ever fails the same happens: never a failed list, never heavier than before. Safe to run again (create or replace). Only service_role may call it (the numbers are customers' phones).
-- HOW TO RUN: paste all of it into a NEW SQL editor tab and press Run. The last line before the END line answers one number.
create or replace function called_phones_today(p_day date, p_min integer)
returns jsonb
language sql
stable
as $$
select jsonb_build_object('phones', coalesce(jsonb_agg(distinct c.phone), '[]'::jsonb))
from call_logs c
where c.call_date = p_day
and c.duration > p_min
and c.phone <> '';
$$;
revoke execute on function called_phones_today(date, integer) from public, anon, authenticated;
grant execute on function called_phones_today(date, integer) to service_role;
-- DID IT LAND? One row: how many distinct numbers were called today (the database's own date: UTC) for longer than five seconds.
select jsonb_array_length(called_phones_today(current_date, 5)->'phones') as numbers_called_today;
-- UNDO, alone: drop function if exists called_phones_today(date, integer);
-- END OF THE SCRIPT: if the editor shows this line, the whole text arrived.
