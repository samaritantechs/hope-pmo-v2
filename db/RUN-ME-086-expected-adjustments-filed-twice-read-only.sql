-- RUN-ME-086 (READ-ONLY): the Iliyonasia entries filed TWICE, once against each expected book. 23 Nov 2026.
-- "single input of Miamala should reflrct in both initial and current expected reports since miamala are always already
-- collected so early collection officers are lalamenting why it doesnt count for them" -- the owner.
-- Since BUILD 2026-11-23-e one entry against EITHER expected book counts in BOTH (handbook Part 132). Before that, somebody
-- who wanted both books to move may have typed the same payment twice: once as Expected - Initial, once as Expected - Current.
-- Such a pair now counts twice. This lists every pair (same team, same report date, same customer ref, same amount, one of
-- each expected book), newest first, with the register's own words, so the owner can see them and say which of each pair to
-- delete (on the Iliyonasia tab, or by id). It changes nothing. The last row counts the entries listed (a payment filed twice
-- is two of them; a payment filed three times is three). The arrears books are not looked at.
-- ANSWER: one row per entry listed (newest report date first, then team, ref, amount, book) and a last row COUNT ... entries listed;
-- "COUNT 0 entries listed" means nothing was filed twice.
with pairs as (
select a.id, a.adj_date, a.team, a.ref, a.amount, a.target, a.reason, a.created_by, a.created_at
from public.pmo_adjustments a
where a.target in ('expected-initial', 'expected-current')
and exists (
select 1 from public.pmo_adjustments b
where b.id <> a.id
and b.target in ('expected-initial', 'expected-current') and b.target <> a.target
and b.adj_date = a.adj_date
and coalesce(upper(btrim(b.team)), '') = coalesce(upper(btrim(a.team)), '')
and coalesce(btrim(b.ref), '') = coalesce(btrim(a.ref), '')
and b.amount = a.amount
)
)
select p.kind, p.adj_date::text as report_date, coalesce(p.team, '(whole book)') as team, coalesce(p.ref, '') as ref, p.amount::text as amount,
p.target, left(coalesce(p.reason, ''), 60) as reason, coalesce(p.created_by, '') as typed_by, p.created_at::text as typed_at, p.id::text as id
from (
select 'PAIR' as kind, adj_date, team, ref, amount, target, reason, created_by, created_at, id from pairs
union all
select 'COUNT', null, null, null, count(*)::numeric, 'entries listed', null, null, null, null from pairs
) p
order by (p.kind = 'COUNT'), p.adj_date desc, coalesce(upper(btrim(p.team)), '') collate "C", coalesce(btrim(p.ref), '') collate "C", p.amount, p.target collate "C", p.id;
-- END OF RUN-ME-086
