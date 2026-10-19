-- =====================================================================================
--  THE DOCKET UNDER EVERY COMMENT AND EVERY PINNED POINT.
-- =====================================================================================
--
--    "comments and location should be docket based so that they travel all reference
--     numbers / loan tracks"
--
--  A customer keeps one docket for life and gets a new REF NO per loan (the docket's digits
--  plus the loan's track). Comments and pinned locations were keyed on the REF, so a note or
--  a point made on the last loan was invisible on this one. Both tables now carry the
--  customer's DOCKET KEY (the docket's digits), and the card reads by it.
--
--  The key is read off each row's own docket where the row carries one (the defaulter and
--  approved reports do), else decoded from the REF: the last digit is the track, two digits
--  when it ends in 0 (track 10). Exact for tracks 1-10; a customer on track 11-19 gets a key
--  one digit longer than their real docket, which can never be another customer's -- the
--  worst case is a history that does not merge with their earlier loans. This mirrors
--  docketKeyOf in api/_lib/docket.js; change one, change both.
--
--  RUN IT IN THE EVENING. Line 44 rewrites every comment ever written (hundreds of thousands
--  after the history import) and is the one slow statement here -- a minute or two. The SQL
--  editor runs the file as one statement, so a timeout there rolls everything back and the
--  file can simply be run again. Safe to re-run: every step is "if not exists" or "where null".
--
--  UNTIL THIS RUNS, NOTHING BREAKS: notes and points are read and written by REF exactly as
--  before; the card simply does not yet see the customer's earlier loans.
-- =====================================================================================
set lock_timeout = '5s';
set statement_timeout = '10min';

-- The one rule, in SQL, for the backfill. (The live rule is docketKeyOf in api/_lib/docket.js.)
create or replace function public.docket_key_of(p_ref text, p_docket text) returns text
language sql immutable as $$
  select case
    when length(regexp_replace(coalesce(p_docket, ''), '\D', '', 'g')) >= 3
      then regexp_replace(p_docket, '\D', '', 'g')
    when length(regexp_replace(coalesce(p_ref, ''), '\D', '', 'g')) < 3 then ''
    else left(regexp_replace(p_ref, '\D', '', 'g'),
              length(regexp_replace(p_ref, '\D', '', 'g'))
              - case when right(regexp_replace(p_ref, '\D', '', 'g'), 1) = '0' then 2 else 1 end)
  end
$$;

-- 1. COMMENTS: the key beside the ref, filled for every note ever written, and its own index.
alter table public.followup_comments add column if not exists docket_key text;
update public.followup_comments set docket_key = public.docket_key_of(ref, docket_no) where docket_key is null;   -- SLOW: the whole table, once
create index if not exists idx_fu_comments_docket on public.followup_comments (docket_key, created_at desc);

-- 2. PINNED POINTS: keyed on (docket, party) instead of (ref, party). The ref stays on the row
--    as "the loan it was last pinned under". Where two refs of one customer were both pinned,
--    the newer point stands and the older is kept in its history, not lost.
alter table public.customer_locations add column if not exists hist jsonb not null default '[]'::jsonb;
alter table public.customer_locations add column if not exists docket_key text;
update public.customer_locations
   set docket_key = coalesce(nullif(public.docket_key_of(ref, null), ''), regexp_replace(ref, '\D', '', 'g'), ref)
 where docket_key is null;
update public.customer_locations w
   set hist = w.hist || coalesce((select jsonb_agg(jsonb_build_object('lat', l.lat, 'lng', l.lng, 'acc', l.acc, 'by', l.saved_by, 'at', l.saved_at)
                                          order by l.saved_at)
                                   from public.customer_locations l
                                  where l.docket_key = w.docket_key and l.party = w.party and l.saved_at < w.saved_at), '[]'::jsonb)
 where exists (select 1 from public.customer_locations l
                where l.docket_key = w.docket_key and l.party = w.party and l.saved_at < w.saved_at);
delete from public.customer_locations a using public.customer_locations b
 where a.docket_key = b.docket_key and a.party = b.party and a.saved_at < b.saved_at;
alter table public.customer_locations alter column docket_key set not null;
do $$
begin
  if exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
              where i.indrelid = 'public.customer_locations'::regclass and i.indisprimary and a.attname = 'ref') then
    alter table public.customer_locations drop constraint customer_locations_pkey;
    alter table public.customer_locations add primary key (docket_key, party);
  end if;
end $$;

-- =====================================================================================
--  DID IT LAND?
--    select count(*) filter (where docket_key is null or docket_key = '') as comments_without_key,
--           count(*) as comments from public.followup_comments;
--    select ref, docket_key, party, saved_by, saved_at from public.customer_locations order by saved_at desc limit 20;
-- =====================================================================================
