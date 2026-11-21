-- RUN-ME-085: NEW ROWS OF THE DECK TABLE GET A TIME-ORDERED ID -- offered, NOT run. 21 Nov 2026.
-- "postgress war please; and that shouldnt distract efficiency of system operations" -- the owner. CLAUDE.md section 1: the upload never slows down.
-- WHY: the upload's insert into defaulter_snapshots took 1.3 s a statement over its last 88 runs (0.45 s over its life). The table's own id is a random
-- uuid (db/schema.sql: default gen_random_uuid()), so every row an upload writes lands in a random leaf page of the primary key's index: a chunk of 1,000
-- rows touches about a thousand pages of it, on a cold cache a page read each. MEASURED on a scratch copy (2.1 million rows, the nine indexes the live book
-- has, 400 MB of memory for 975 MB of table and indexes, one deck = ten chunks of 1,000 rows, pages read from outside memory): the primary key is about half
-- of every chunk's reads once the cache is warm. With a time-ordered id (UUID version 7: the millisecond clock first, then random bits) every new row lands
-- at the same moving edge of the index, so the pages stay in memory. Pages read for one day's two decks, as now and with this: initial deck 14,323 to 8,198,
-- current deck 8,665 to 6,273, together 22,988 to 14,471 (37% fewer), and 168 to 118 MB of write-ahead log.
-- WHAT IT DOES: creates public.hope_uuid_time_ordered() and makes it the default of defaulter_snapshots.id. An existing row keeps its id: nothing is rewritten.
-- The app sends no id (the deck importer builds none), so every new row asks the default. Nothing else about the table, its indexes or its constraints changes,
-- and ordering by id (the pager's tie-break) stays a total order.
-- WHAT IT COSTS: the ALTER takes the table's heaviest lock for an instant. lock_timeout is 500 ms: if somebody holds the table the script gives up and changes
-- NOTHING (the SQL editor runs a script as one transaction, so the function is not made either), and a query that arrives meanwhile waits at most that half
-- second. Run it in a quiet minute, not during an upload, and run it again if it says "lock timeout". The change also makes PostgREST read its schema again,
-- in the background (about 0.2 s of work for it).
-- ANSWER: one row, the new default, which must read hope_uuid_time_ordered().
-- UNDO, alone, in a new tab: alter table public.defaulter_snapshots alter column id set default gen_random_uuid();
set local lock_timeout = '500ms';
create or replace function public.hope_uuid_time_ordered() returns uuid language sql volatile as $$
select encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid
$$;
grant execute on function public.hope_uuid_time_ordered() to public;
alter table public.defaulter_snapshots alter column id set default public.hope_uuid_time_ordered();
select column_default as id_default_now from information_schema.columns where table_schema = 'public' and table_name = 'defaulter_snapshots' and column_name = 'id';
-- END OF RUN-ME-085
