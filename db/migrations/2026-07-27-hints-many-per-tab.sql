-- =====================================================================================
-- HINTS: MANY TIPS PER TAB.
--
-- hints.tab was the PRIMARY KEY, so the table could hold exactly one tip per tab -- while
-- the code reading it already built a LIST per tab and cycled through them, which is the
-- whole point of rotating tips. Uploading a real tip sheet therefore failed outright:
--
--   ON CONFLICT DO UPDATE command cannot affect row a second time
--
-- because a dozen rows all carried tab = 'all' and the upsert saw them as one key twelve
-- times over.
--
-- A tip is not identified by its tab, so the tab stops pretending to be the key.
-- =====================================================================================

-- Keep whatever is already loaded rather than dropping the table.
alter table hints add column if not exists id uuid default gen_random_uuid();
update hints set id = gen_random_uuid() where id is null;

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'hints' and constraint_type = 'PRIMARY KEY'
  ) then
    execute 'alter table hints drop constraint ' ||
      (select constraint_name from information_schema.table_constraints
       where table_name = 'hints' and constraint_type = 'PRIMARY KEY' limit 1);
  end if;
end $$;

alter table hints alter column id set not null;
alter table hints add primary key (id);

-- Every read groups by tab, so that is what wants the index.
create index if not exists idx_hints_tab on hints(tab);
