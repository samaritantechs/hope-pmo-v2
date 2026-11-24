// THE DEMAND NOTICES ISSUED BEFORE THE SYSTEM BEGAN (23 Nov 2026, handbook Part 138; db/TEMPLATE-historic-demand-notices-import.sql).
//   "extract all those that don't exist in the system and add their respective columns that fit into the system by sql - so that we
//    capture all the demands' recovery in current and past weeks data inclusive" ... "if we have a ref no never exist from our systems
//    first upload of 2026, it was 'CLEARED' by default of one month after issued date" -- the owner.
// The SQL itself is run on a real PostgreSQL by tools/db-checks/historic-notices-import.mjs. Held here, in npm test: that the SCREENS read
// what the import writes (a notice with no Kumb.Na., no phone and no upload stamp; a clearance marked 'default' in the payments ledger)
// the way the owner asked, and that the template, the builder and the kept check stay what the handbook says they are.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { portalApi } = await import('../api/_lib/portal-core.js');
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const NOW = Date.parse('2026-11-23T09:00:00Z');                    // Monday noon EAT
const TODAY = '2026-11-23';
const ADMIN = { code: 'A', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['legal', 'dashboard', 'settings'] };
/* What the engine writes, for three made-up customers:
     NEVER ONE   never on a file of the system; two notices of the sheet (15 Oct 2025, 19 Jan 2026): cleared by default on 19 Feb 2026,
                 one month after the LAST, for the arrears at the last (452,000), recorded under BOTH notices with one payment id;
     ON DECK     on today's deck owing 300,000 against 444,000 at the notice of 20 Oct 2025: read from the system's own files;
     and a notice the system made itself, to a customer who paid 50 today. */
const imported = (ref, name, team, date, arrears, by = 'OFFICER ONE', contact = null) => ({ id: 'imp-' + ref + '-' + date, ref, team, full_name: name, contact,
  notice_date: date, arrears_at_notice: arrears, issued_by: by, created_at: date + 'T09:00:00Z', notice_id: null, upload_batch: null, upload_date: null });
const tables = () => ({
  teams: [{ team: 'TEAM ONE' }, { team: 'TEAM TWO' }],
  access_codes: [{ code: 'ADM', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['legal'] },
    { code: 'LG1', name: 'WAKILI WA LEO', role: 'LEGAL', teams: ['TEAM ONE'], tabs: ['legal'] }],      // TODAY's holder of TEAM ONE
  settings: [], roles: [], call_users: [], audit_log: [],
  defaulter_snapshots: [
    { ref: '9900000004', team: 'TEAM ONE', full_name: 'ON DECK', contact: '0755000004', arrears: 300000, status: 'Chronic', snapshot_type: 'current', snapshot_date: TODAY, weekday: 'MON', upload_batch: 'b1', created_at: TODAY + 'T05:00:00Z' },
    { ref: '7700000001', team: 'TEAM TWO', full_name: 'SYSTEM CUSTOMER', contact: '0755000001', arrears: 900, status: 'Defaulter', snapshot_type: 'current', snapshot_date: TODAY, weekday: 'MON', upload_batch: 'b1', created_at: TODAY + 'T05:00:00Z' },
  ],
  demand_notices: [
    imported('9900000001', 'NEVER ONE', 'TEAM ONE', '2025-10-15', 365000),
    imported('9900000001', 'NEVER ONE', 'TEAM ONE', '2026-01-19', 452000),
    imported('9900000004', 'ON DECK', 'TEAM ONE', '2025-10-20', 444000, 'OFFICER TWO', '0755000004'),
    { id: 'sys1', ref: '7700000001', team: 'TEAM TWO', full_name: 'SYSTEM CUSTOMER', contact: '0755000001', notice_id: 'HMCL/SC/20/11/2026', notice_date: '2026-11-20', arrears_at_notice: 1000, issued_by: 'LAWYER', created_at: '2026-11-20T09:00:00Z' },
  ],
  notice_payment_ledger: [
    { ref: '9900000001', since: '2025-10-15', payment_id: 'clr-9900000001', paid_at: '2026-02-19', amount: 452000, matched_by: 'default' },
    { ref: '9900000001', since: '2026-01-19', payment_id: 'clr-9900000001', paid_at: '2026-02-19', amount: 452000, matched_by: 'default' },
    { ref: '7700000001', since: '2026-11-20', payment_id: 'p9', paid_at: TODAY, amount: 50, matched_by: 'phone' },
  ],
});
// db/RUN-ME-041b's notice_payments: the ledger added up for each (loan number, notice date) asked
const notice_payments = (store, args) => args.p_refs.map((ref, i) => {
  const rows = (store.notice_payment_ledger ? store.notice_payment_ledger.rows : []).filter(l => String(l.ref) === String(ref) && String(l.since).slice(0, 10) === String(args.p_dates[i]).slice(0, 10));
  return { ref, since: args.p_dates[i], paid: rows.reduce((s, l) => s + Number(l.amount), 0), n: rows.length,
    last_paid: rows.map(l => l.paid_at).sort().pop() || null, n_phone: rows.filter(l => l.matched_by === 'phone').length };
});
const db = () => fakeDb(tables(), { rpc: { notice_payments, fold_notice_payments: () => 0 } });

test('a past week holds the clearance by default: once for the customer, under their last notice, credited to TODAY\'s holder of the team', async () => {
  const wk = await portalApi(db(), ADMIN, 'legalRecoveries', { period: 'week', weekOf: '2026-02-19' }, NOW);
  assert.equal(wk.from, '2026-02-16'); assert.equal(wk.to, '2026-02-22');
  assert.deepEqual(wk.rows.map(r => [r.ref, r.full_name, r.paid, r.payments, r.owed, r.notice_date, r.officer]),
    [['9900000001', 'NEVER ONE', 452000, 1, 452000, '2026-01-19', 'WAKILI WA LEO']],
    'the whole arrears at the last notice, once (one payment id under both notices), a month after it; the lawyer is whoever holds TEAM ONE today, not who issued the letter');
  assert.equal(wk.rows[0].notice_id, '', 'no Kumb.Na.: the sheet carried none and none is made up');
  assert.equal(wk.totals.paid, 452000);
  assert.equal(wk.legal.recovered, 452000, 'the card of that week reads the same figure as its list');
  // the week before holds nothing of it, and neither does this week
  assert.equal((await portalApi(db(), ADMIN, 'legalRecoveries', { period: 'week', weekOf: '2026-02-12' }, NOW)).totals.paid, 0);
  const now = await portalApi(db(), ADMIN, 'legalRecoveries', { period: 'week' }, NOW);
  assert.deepEqual(now.rows.map(r => [r.ref, r.paid]), [['7700000001', 50]], 'this week is what was really paid this week');
});

test('the Legal tab reads the imported notices by its own rules: cleared when off the deck, the system\'s files where it holds the customer, and the arrows reach back to the first notice', async () => {
  const d = await portalApi(db(), ADMIN, 'demandNotices', {}, NOW);
  const row = (ref, date) => d.rows.find(r => r.ref === ref && String(r.notice_date).slice(0, 10) === date);
  const a = row('9900000001', '2025-10-15'), b = row('9900000001', '2026-01-19'), c = row('9900000004', '2025-10-20');
  assert.equal(a.notice_state, 'Amemaliza / Cleared'); assert.equal(b.notice_state, 'Amemaliza / Cleared');
  assert.deepEqual([a.arrears_now, a.arrears_down, a.rec_pct], [0, 365000, 100], 'off today\'s deck: the letter\'s arrears came down in full');
  assert.deepEqual([b.paid_since, b.paid_n, b.last_paid, b.paid_n_phone], [452000, 1, '2026-02-19', 0], 'recovered since the notice: the clearance, dated a month after it, not tied by a phone');
  assert.equal(a.paid_since, 452000, 'the same clearance stands under the earlier notice too, as one payment does under each notice of a customer');
  assert.deepEqual([c.notice_state, c.arrears_now, c.arrears_down, c.paid_since], ['Amepunguza / Reducing', 300000, 144000, 0], 'a customer the system holds is read from its files: 444,000 at the notice, 300,000 today');
  assert.equal(c.issued_by, 'OFFICER TWO', 'who issued it then stays on the notice');
  assert.equal(a.letter_kept, false, 'no letter is kept for a notice that was issued on paper: there is no reprint to offer');
  // each customer once on the tiles; the weekly card's owed is at each customer's LATEST notice
  assert.equal(d.customers, 3);
  assert.equal(d.cleared, 1, 'NEVER ONE, once, not twice');
  assert.equal(d.legal.owed, 452000 + 444000 + 1000, 'owed at the latest notice of each: the import raises it, and the week\'s Rec % is over it');
  assert.equal(d.legal.since, '2025-10-13', 'the backward arrow stops at the Monday of the first notice the register now holds');
  assert.equal(d.legal.recovered, 50, 'this week\'s figure is not moved by a clearance of last February');
});

/* ---- the template, the builder and the kept check ---- */
const TPL = read('db/TEMPLATE-historic-demand-notices-import.sql');
const ENGINE = TPL.slice(TPL.indexOf('-- HISTORIC DEMAND NOTICES: COUNT, THEN IMPORT.'));
const DATA = TPL.slice(TPL.indexOf('create table if not exists public.demand_import_2025'), TPL.indexOf('-- END OF DATA BLOCK 1 OF 1'));
// the SQL without its comments: whole comment lines, and the three comments that follow code on a line
const code = t => t.split('\n').filter(l => !/^\s*--/.test(l)).map(l => l.replace(/ -- (CHANGE: |ROWS THE LIST MUST HOLD: |the lines' own fingerprint).*$/, '')).join('\n');

test('the template holds no real person, and each of its two blocks is one the owner can paste', () => {
  const lines = DATA.slice(DATA.indexOf('$d$\n') + 4, DATA.indexOf('\n$d$', DATA.indexOf('$d$\n') + 4)).split('\n');
  assert.deepEqual(lines.map(l => l.split('|')[2]), ['CUSTOMER ONE', 'CUSTOMER TWO', 'CUSTOMER THREE'], 'made-up lines only');
  assert.ok(/when 'A' then 'OFFICER ONE' when 'B' then 'OFFICER TWO'/.test(DATA), 'and made-up officers');
  assert.ok(lines.every(l => l.split('|').length === 12), 'twelve fields a line');
  for (const [name, t] of [['the data block', DATA], ['the engine', ENGINE]]) {
    assert.ok(t.length < 10000, name + ' is under 10,000 characters: ' + t.length);
    assert.ok(!t.split('\n').some(l => /^[ \t]/.test(l)), name + ': no line starts with a blank');
    assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(t), name + ': plain ASCII');
  }
  assert.equal(TPL.split('\n').filter(Boolean).pop(), '-- END OF THE ENGINE');
  assert.match(TPL, /^-- END OF DATA BLOCK 1 OF 1$/m);
  assert.match(TPL, /A FILLED COPY CARRIES CUSTOMERS' NAMES: IT IS PASTED IN THE CHAT AND NEVER COMMITTED\./);
  assert.match(DATA, /alter table public\.demand_import_2025 enable row level security;\nrevoke all on public\.demand_import_2025 from anon, authenticated;/, 'the list is private');
  assert.match(DATA, /on conflict \(line\) do update set /, 'a line run again is replaced, never doubled');
});

test('a data block carries the fingerprint of its own lines and writes nothing when it did not arrive whole', () => {
  const lines = DATA.slice(DATA.indexOf('$d$\n') + 4, DATA.indexOf('\n$d$', DATA.indexOf('$d$\n') + 4)).split('\n');
  const fp = createHash('md5').update(lines.join('\n')).digest('hex');
  const c = code(DATA);
  assert.ok(c.includes("ok as materialized (select coalesce(md5(string_agg(l, E'\\n' order by n)), '') = '" + fp + "' as ok from ln where l <> ''),"),
    'the fingerprint in the template is the fingerprint of the template\'s own lines (' + fp + '), over the lines in their order, empty lines aside');
  assert.ok(c.includes("ln as materialized (select btrim(replace(x.l, chr(13), '')) as l, x.n from b, regexp_split_to_table(b.t, E'\\n') with ordinality as x(l, n)),"),
    'a line is read with the blanks at its ends and a Windows line end taken off: an indented paste is the same block');
  assert.ok(c.includes("from ln where l <> '' and (select ok from ok)\non conflict (line) do update set"), 'the write asks the fingerprint: a block that differs writes nothing');
  assert.equal((c.match(/\binsert into\b/g) || []).length, 1, 'one write');
  assert.ok(!/\b(delete|truncate|drop)\b/i.test(c), 'and nothing is removed');
  assert.ok(c.includes("select case when not (select ok from ok) then 'DATA BLOCK 1 OF 1 DID NOT ARRIVE WHOLE: NOTHING WAS WRITTEN. Paste it again, all of it, in a NEW tab'\n" +
    "when (select c from n) < 3 then 'data block 1 of 1 is in, BUT A BLOCK BEFORE IT IS MISSING: run the blocks in order'\nelse 'data block 1 of 1: OK' end as block, (select c from n) as rows_in_the_list_now, 3 as rows_there_should_be_after_this_block;"),
    'the answer says in words whether the block arrived whole, and whether one before it is missing');
  assert.ok(c.includes('(select count(*) from public.demand_import_2025 s where s.line not in (select line from ins)) + (select count(*) from ins) as c'), 'the rows in the list are counted once on a second run');
  assert.match(TPL, /A BLOCK CARRIES THE FINGERPRINT OF ITS OWN LINES/);
});

test('the engine changes nothing unless the word is IMPORT, is one statement, and never reads the decks end to end', () => {
  assert.equal(ENGINE.split("upper(btrim('COUNT')) as m), -- CHANGE: COUNT changes nothing; IMPORT writes").length, 2, 'the CHANGE line, once, and it says COUNT');
  const c = code(ENGINE);
  assert.equal((c.match(/\(select m from mode\) = 'IMPORT'/g) || []).length, 2, 'both writes ask for the word');
  assert.equal((c.match(/where \(select m from mode\) = 'IMPORT' and \(select ok from whole\) on conflict/g) || []).length, 2, 'and both write only when the list is whole');
  assert.ok(ENGINE.includes("whole as (select (select count(*) from public.demand_import_2025) = 3 as ok), -- ROWS THE LIST MUST HOLD: on any other count nothing is written\n"),
    'the list is whole when it holds the rows the engine was built for (the template\'s made-up block has three)');
  assert.ok(c.includes("when m = 'IMPORT' and not (select ok from whole) then ': NOT WRITTEN, the list is not whole (next line)'"), 'IMPORT on a list that is not whole says NOT WRITTEN');
  assert.ok(c.includes("else ': NOT THE ROWS THIS ENGINE WAS BUILT FOR. A data block is missing or damaged: NOTHING IS WRITTEN' end from st)"), 'and the answer says why');
  assert.equal((c.match(/\binsert into\b/g) || []).length, 2, 'two writes: the notices and the clearances');
  assert.ok(!/\b(update|delete|truncate|drop|alter)\b/i.test(c), 'and nothing else that changes a row or a table');
  assert.equal(c.trim().split(';').filter(x => x.trim()).length, 6, 'five settings and ONE statement');
  for (const s of ["set local statement_timeout = '45s';", "set local lock_timeout = '3s';", 'set local enable_seqscan = off;', 'set local enable_hashjoin = off;', 'set local enable_mergejoin = off;'])
    assert.ok(c.includes(s), s);
  assert.match(c, /tm\(team\) as \(\(select d\.team from public\.defaulter_snapshots d order by d\.team limit 1\)\nunion all select \(select d\.team from public\.defaulter_snapshots d where d\.team > tm\.team order by d\.team limit 1\) from tm where tm\.team is not null\),/,
    'the teams the decks carry are walked through the index, one probe a team');
  assert.match(c, /exists \(select 1 from tm where exists \(select 1 from public\.defaulter_snapshots d where d\.team = tm\.team and d\.ref = r\.ref\)\)/, 'and a loan number is asked under each team: the (team, loan number) index');
  assert.match(c, /where \(select ok from hasidx\) and exists \(select 1 from public\.repayment_snapshots e where e\.ref = r\.ref\)/, 'the expected sheets are asked only when they have an index by loan number');
  assert.match(c, /exists \(select 1 from alln x where x\.kref = m\.kref and abs\(x\.notice_date - m\.notice_date\) <= 7\) as in_system/, 'held = a notice of that loan number within seven days');
  assert.match(c, /lastn as \(select distinct on \(t\.kref\) t\.kref, t\.notice_date, t\.arrears from todo t where t\.kref not in \(select kref from known\) order by t\.kref, t\.notice_date desc\),/, 'cleared by default at the LAST notice of a customer the system never held');
  assert.match(c, /\(l\.notice_date \+ interval '1 month'\)::date as paid_at, l\.arrears as amount\nfrom lastn l join todo t on t\.kref = l\.kref where coalesce\(l\.arrears, 0\) > 0\),/, 'one month after it, for its arrears, under each of their notices, and only with a figure');
  assert.match(c, /c\.amount, 'default' from clr c/, 'marked, so it is never taken for a payment the book recorded');
  assert.match(ENGINE, /^-- with st as \(select upper\(btrim\(ref\)\) as kref, notice_date from public\.demand_import_2025 where notice_date is not null\), a as \(delete from public\.notice_payment_ledger where matched_by = 'default' and payment_id in /m, 'the undo is written, and removes only what the import marked');
  assert.match(ENGINE, /WITH THE WORD COUNT \(as it is\) IT CHANGES NOTHING/);
  assert.match(ENGINE, /WHAT IT COSTS: nothing to \/api\/upload or \/api\/call\./);
});

test('the builder writes outside the repository, reads a date by the rules the handbook gives, and refuses a block the owner cannot paste', () => {
  const b = read('tools/historic-notices/build_blocks.py');
  assert.match(b, /assert not os\.path\.abspath\(outdir\)\.startswith\(root \+ os\.sep\), 'the blocks carry customers\\' names: write them outside the repository'/);
  assert.match(b, /PERIOD = \(datetime\.date\(2025, 7, 20\), datetime\.date\(2026, 5, 31\)\)/);
  assert.match(b, /if st in held\.get\(ref, \(\)\) or st\.day > 12 or st\.day == st\.month: rec\.update\(date=st, how='S'\)/, 'as stored: the system holds it, a day over twelve, or day = month');
  assert.match(b, /elif a and not b: rec\.update\(date=st, how='S'\)\n\s+elif b and not a: rec\.update\(date=sw, how='X'\)/, 'one reading inside the period decides');
  assert.match(b, /elif a and b: rec\.update\(date=sw, how='x'\) if texts\[who\] else rec\.update\(date=st, how='s'\)/, 'both inside: the officer\'s own rows decide');
  assert.match(b, /if not ref: noref \+= 1; continue/, 'a row with no REF NO is not written');
  assert.match(b, /assert len\(text\) < 10000 and not any\(l\[:1\] in \(' ', '\\t'\) for l in text\.split\('\\n'\)\) and all\(ord\(c\) < 127 for c in text\)/);
  assert.match(b, /return hashlib\.md5\('\\n'\.join\(lines\)\.encode\('ascii'\)\)\.hexdigest\(\)/, 'a block\'s fingerprint is the md5 of its lines joined by a newline: what the block\'s own SQL computes');
  assert.match(b, /t = once\(tail, "= '%s' as ok" % fingerprint\(made_up\), "= '%s' as ok" % fingerprint\(g\)\)/, 'each block carries the fingerprint of its own lines');
  assert.match(b, /once\(template\[a:\], '\(select count\(\*\) from public\.demand_import_2025\) = 3 as ok\)', '\(select count\(\*\) from public\.demand_import_2025\) = %d as ok\)' % rows\)/, 'the engine is built for the rows the blocks hold');
  assert.match(b, /eng = engine\(template, len\(recs\)\)/);
  assert.ok(!/[^\x09\x0A\x20-\x7E]/.test(b), 'the tool is plain ASCII');
});

test('the kept check runs the template on the real schema, against a model, and breaks it on purpose', () => {
  const k = read('tools/db-checks/historic-notices-import.mjs');
  for (const f of ['/db/schema.sql', '/db/migrations/2026-07-26-demand-notice-id.sql', '/db/migrations/2026-07-28-upload-stamp.sql', '/db/RUN-ME-041a-notice-payment-ledger.sql', '/db/TEMPLATE-historic-demand-notices-import.sql'])
    assert.ok(k.includes("ROOT + '" + f + "'"), 'it loads ' + f);
  assert.match(k, /drop index if exists idx_def_snap_ref;/, 'as the live book: no index that starts with the loan number');
  assert.match(k, /pg_stat_get_xact_blocks_fetched\('public\.defaulter_snapshots'::regclass\)/, 'the deck table\'s own pages are counted');
  assert.match(k, /Seq Scan on defaulter_snapshots/);
  assert.match(k, /if \(bookSum\(\) !== before\) note\('COUNT changed the book'\);/);
  assert.match(k, /after the undo the book is not what it was before the import/);
  const m = k.match(/const BREAKS = \[([\s\S]*?)\n\];/);
  assert.ok(m && (m[1].match(/^  \[/gm) || []).length >= 49, 'deliberate breaks: ' + (m ? (m[1].match(/^  \[/gm) || []).length : 0));
  assert.ok((m[1].match(/, 'data'\],$/gm) || []).length >= 13, 'of the data block among them');
  assert.match(k, /if \(!NOT\.test\(ans\)\) note\('a damaged block \(' \+ what \+ '\) did not say so: ' \+ ans\);/, 'a damaged block must say so in words');
  assert.match(k, /note\('IMPORT wrote although the list holds ' \+ SHEET\.length \+ ' rows and the engine was built for ' \+ rows\);/, 'and an engine built for another list must write nothing');
  assert.match(k, /alter default privileges in schema public grant all on tables to anon, authenticated;/, 'the list\'s privacy is checked on a book that hands new tables to the API roles');
});

test('the handbook and CHAT.md record the import, its rules and what is not done', () => {
  const h = read('docs/HANDOFF.md'), c = read('CHAT.md');
  assert.match(h, /Part 138/); assert.match(h, /TEMPLATE-historic-demand-notices-import/);
  assert.match(c, /Part 138/); assert.match(c, /TEMPLATE-historic-demand-notices-import/);
});
