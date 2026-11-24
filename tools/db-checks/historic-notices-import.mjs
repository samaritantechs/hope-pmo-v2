/* THE HISTORIC DEMAND NOTICES IMPORT -- db/TEMPLATE-historic-demand-notices-import.sql, run for real on a PostgreSQL.

     "extract all those that don't exist in the system and add their respective columns that fit into the system by sql - so that we
      capture all the demands' recovery in current and past weeks data inclusive" ... "if we have a ref no never exist from our systems
      first upload of 2026, it was 'CLEARED' by default of one month after issued date" -- the owner, 23 Nov 2026 (handbook Part 138)

   The book is the real one: the whole of db/schema.sql in a scratch database, plus the real RUN-ME-041a (the payments ledger and its fold)
   and the two indexes the live book has that the import leans on. The people are made up. It passes only when:
     1. THE DATA BLOCK fills the list as written, can be run again, and a corrected line replaces the old one. IT CARRIES THE FINGERPRINT
        OF ITS OWN LINES: with one character changed, a line missing, a line added or a line that is not a line at all it writes NOTHING,
        answers in words (never an error) and leaves the list as it was; pasted with Windows line ends, every line indented, blanks at
        the line ends and empty lines between, it is still the same block and says OK; and it says when a block before it is missing.
     2. COUNT changes nothing: every table of the book is byte for byte what it was, and the answer's numbers equal a model written again
        in JavaScript.
     3. IMPORT writes exactly the model's notices (every column) and exactly the model's default clearances: a notice the system holds is
        not doubled (the system holds a notice of that loan number within seven days, earlier or later; eight days apart is another
        notice); a notice written twice is one;
        an unreadable date is left out; a customer on a deck (under any team, or under no team), in the follow-up register or on an
        expected sheet is NOT cleared by default; a customer the system never held is, one month after their LAST notice, once, under each
        of their notices; with no arrears figure nothing is recorded; the phone comes from the follow-up register and from nowhere else.
     4. A second IMPORT writes nothing. The undo removes what the import wrote and nothing else. A word that is neither COUNT nor IMPORT
        changes nothing. THE ENGINE WRITES ONLY WHEN THE LIST IS WHOLE: built for another number of rows than the list holds, IMPORT
        writes nothing and both words say so in the answer.
     5. The database's own fold (fold_notice_payments) run after the import adds nothing for these notices and removes nothing. (How the
        screens read what was written, a past week holding the default clearance among it, is test/historic-notices-import.test.mjs.)
     6. THE COST: on a deck table of two million rows the engine never reads the decks end to end (the plan names no Seq Scan on
        defaulter_snapshots) and answers inside a few seconds; with the expected sheets' index by loan number absent they are not asked.
     7. A LATER DELIVERY (the legal team gave REF NOs to rows that had none: the same sheet with more rows, "Legal team submitted more
        ref nos and teams in the table", 24 Nov): the first delivery is imported, the second one's blocks are added to the list, the engine
        is built for both; the book then ends byte for byte where ONE delivery of everything ends and equal to the model, the first
        delivery's notices are not written again and are not held against the new rows, a clearance line the first run wrote is CORRECTED
        when a later notice moves it (a line of another kind under the same key is never touched), COUNT says what it will write and what
        it will correct, a second IMPORT writes nothing, and the undo removes both deliveries.
     8. EVERY ONE of a list of deliberate breaks of the engine and of the data block makes a check fail.

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/historic-notices-import.mjs       (NOBIG=1 skips the two million rows, NOBREAKS=1)

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = it did what it says, and failed when broken. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(ROOT + '/db/TEMPLATE-historic-demand-notices-import.sql', 'utf8');
const F041 = fs.readFileSync(ROOT + '/db/RUN-ME-041a-notice-payment-ledger.sql', 'utf8');
const DB = 'hope_historic_notices';
const admin = process.env.PGDATABASE || 'postgres';
const psqlTo = (sql, db = DB) => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: sql, env: process.env, encoding: 'utf8', maxBuffer: 1 << 29, stdio: ['pipe', 'pipe', 'pipe'] });
const errLine = e => String(e.stderr || e.message).split('\n').find(l => /ERROR/.test(l)) || String(e.stderr || e.message).split('\n')[0];
const q = s => s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";
const json = sql => JSON.parse('[' + psqlTo(`select coalesce(string_agg(row_to_json(t)::text, ','), '') from (${sql}) t`) + ']');
const md5uuid = s => { const h = createHash('md5').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
const addMonth = d => psqlTo(`select (date '${d}' + interval '1 month')::date`).trim();

/* ---- the two blocks, cut out of the template ---- */
const cut = (from, to) => { const i = FILE.indexOf(from), j = FILE.indexOf(to, i); if (i < 0 || j < 0) throw new Error('the template has no ' + from); return FILE.slice(i, j + to.length) + '\n'; };
const DATA = cut('create table if not exists public.demand_import_2025', '-- END OF DATA BLOCK 1 OF 1');
const ENGINE = cut('-- HISTORIC DEMAND NOTICES: COUNT, THEN IMPORT.', '-- END OF THE ENGINE');
/* A data block for these lines, as the builder makes one: the lines, THEIR fingerprint (unless `fp` gives another: a block damaged on the
   way keeps the fingerprint it left with), and the rows the list should hold after it. `raw` puts the text between the markers as given. */
const fpOf = lines => createHash('md5').update(lines.join('\n')).digest('hex');
const FP0 = (() => { const a = DATA.indexOf('$d$\n') + 4, b = DATA.indexOf('\n$d$', a); return fpOf(DATA.slice(a, b).split('\n')); })();
const dataBlock = (lines, { shape = DATA, fp = fpOf(lines), total = lines.length, raw = null } = {}) => {
  const a = shape.indexOf('$d$\n') + 4, b = shape.indexOf('\n$d$', a);
  let t = shape.slice(0, a) + (raw === null ? lines.join('\n') : raw) + shape.slice(b);
  for (const [from, to] of [["= '" + FP0 + "' as ok", "= '" + fp + "' as ok"], ['when (select c from n) < 3 then', 'when (select c from n) < ' + total + ' then'],
    ['3 as rows_there_should_be_after_this_block', total + ' as rows_there_should_be_after_this_block']]) {
    if (t.split(from).length !== 2) throw new Error('the data block does not hold this once: ' + from); t = t.replace(from, () => to); }
  return t; };
/* The engine with this word, built for this many rows in the list (the builder writes the number of rows it put in the blocks). */
const engine = (word, text = ENGINE, rows = SHEET.length) => { if (text.split("upper(btrim('COUNT'))").length !== 2) throw new Error('the CHANGE line is not there once');
  if (!/from public\.demand_import_2025\) [<>]?= 3\b/.test(text)) throw new Error('the engine does not say how many rows the list must hold');
  return text.replace("upper(btrim('COUNT'))", () => "upper(btrim('" + word + "'))").replace(/(from public\.demand_import_2025\) [<>]?= )3\b/, (m, g) => g + rows); };
const undo = () => { const m = ENGINE.match(/^-- (with st as \(select upper\(btrim\(ref\)\) as kref[^\n]*;)$/m); if (!m) throw new Error('the undo line is not in the engine'); return m[1]; };

/* ---- the made-up sheet. line|officer|customer|loan number|team|principal|loan|paid|arrears|YYMMDD|how|cell ---- */
const SHEET = [
  // never on a file of the system: cleared by default a month after the LAST of their two notices, under both
  '2|A|NEVER ONE|9900000001|TEAM ONE|700000|952000|587000|365000|251015|T|',
  '3|A|NEVER ONE|9900000001|TEAM ONE|700000|952000|500000|452000|260119|T|',
  // never on a file, one notice, written TWICE in the sheet (the second line is dropped)
  '4|B|NEVER TWO|9900000002|TEAM TWO|500000|680000|292500|387500|251216|X|',
  '5|B|NEVER TWO|9900000002|TEAM TWO|500000|680000|292500|387500|251216|X|',
  // never on a file, no arrears figure: imported, nothing recorded
  '6|A|NEVER BLANK|9900000003|TEAM ONE|300000|408000|||260213|T|',
  // on a deck under ANOTHER team than the sheet's: held by the system, not cleared by default
  '7|A|ON A DECK|9900000004|TEAM ONE|400000|544000|100000|444000|251020|T|',
  // on a deck under NO team
  '8|B|DECK NO TEAM|9900000005|TEAM TWO|400000|544000|100000|200000|251020|x|',
  // in the follow-up register only (the phone is taken from it)
  '9|B|IN REGISTER|9900000006|TEAM TWO|400000|544000|100000|150000|260107|X|',
  // on an expected sheet only
  '10|A|ON EXPECTED|9900000007|TEAM ONE|400000|544000|100000|120000|260324|T|',
  // the system holds this very notice (same loan number, same date)
  '11|C|SAME NOTICE|9900000008|TEAM ONE|400000|544000|100000|300000|260515|S|',
  // the system holds a notice of this loan number three days EARLIER than the sheet's date: the same letter
  '12|C|NEAR NOTICE|9900000009|TEAM ONE|400000|544000|100000|310000|260526|S|',
  // the system holds one seven days LATER than the sheet's date: the same letter; and one EIGHT days later: another notice, imported
  '17|C|SEVEN DAYS|9900000014|TEAM ONE|400000|544000|100000|70000|260601|S|',
  '18|C|EIGHT DAYS|9900000015|TEAM ONE|400000|544000|100000|60000|260601|S|',
  // the system holds a LATER notice of this loan number: this earlier one is imported; the customer is NOT cleared by default (the system holds them: they are on a deck)
  '13|A|EARLIER NOTICE|9900000010|TEAM ONE|400000|544000|100000|250000|251015|T|',
  // a date nobody can read: left out
  '14|A|NO DATE|9900000011|TEAM ONE|400000|544000|100000|250000||U|31/04/2026',
  // a team that is not on Teams & Staff, no principal, a name with an apostrophe
  "15|B|N'GOMA O'NEIL|9900000012|TEAM NOWHERE||||90000|250826|T|",
  // the system holds nothing of this loan number: imported
  '16|C|JUST BEFORE|9900000013|TEAM TWO|400000|544000|100000|80000|260510|s|',
];
/* A SECOND DELIVERY: more rows of the same sheet (their lines are over those of the first), run after the first was imported. */
const EXTRA = [
  // a LATER notice of a customer the first delivery cleared by default: the clearance moves to a month after THIS one, under all three notices
  '30|A|NEVER ONE|9900000001|TEAM ONE|700000|952000|600000|352000|260301|T|',
  // the first delivery's line 4 written again: one notice, and not written again
  '31|B|NEVER TWO|9900000002|TEAM TWO|500000|680000|292500|387500|251216|X|',
  // an EARLIER notice of a customer already imported: imported; the clearance stays a month after their LAST notice
  '32|B|NEVER TWO|9900000002|TEAM TWO|500000|680000|292500|300000|251110|T|',
  // two days AFTER a notice the first delivery wrote: another notice (the list's own earlier rows are not "the system")
  '33|B|NEVER TWO|9900000002|TEAM TWO|500000|680000|292500|380000|251218|T|',
  // a second notice of a customer on a deck: imported, never cleared by default
  '34|A|ON A DECK|9900000004|TEAM ONE|400000|544000|100000|430000|251125|T|',
  // four days from a notice the system holds (23 May): the same letter, not imported
  '35|C|NEAR NOTICE|9900000009|TEAM ONE|400000|544000|100000|310000|260527|S|',
  // a new customer with two notices two days apart: both imported, cleared a month after the second
  '36|A|BRAND NEW|9900000020|TEAM ONE|300000|408000|50000|200000|251101|T|',
  '37|A|BRAND NEW|9900000020|TEAM ONE|300000|408000|50000|210000|251103|T|',
  // a date nobody can read: left out
  '38|A|NO DATE TWO|9900000021|TEAM ONE|400000|544000|100000|250000||U|9/9/2026',
];
const ALL = SHEET.concat(EXTRA);
const SYSTEM_FIRST = '2026-05-13';
function seed(extraSql = '') {
  psqlTo(`truncate demand_notices, notice_payment_ledger, defaulter_snapshots, followup_status, repayment_snapshots, received_payments, teams cascade;
drop table if exists public.demand_import_2025;
insert into teams (team) values ('TEAM ONE'), ('TEAM TWO'), ('TEAM THREE');
-- the system's own notices
insert into demand_notices (id, notice_id, ref, team, full_name, contact, notice_date, arrears_at_notice, issued_by, created_at) values
 ('11111111-1111-1111-1111-111111111111', 'HMCL/X/13/05/2026', '8800000001', 'TEAM THREE', 'SYSTEM FIRST', '0712000001', '${SYSTEM_FIRST}', 100000, 'LAWYER', '${SYSTEM_FIRST}T09:00:00Z'),
 ('22222222-2222-2222-2222-222222222222', 'HMCL/S/15/05/2026', '9900000008', 'TEAM ONE', 'SAME NOTICE', '0712000008', '2026-05-15', 300000, 'LAWYER', '2026-05-15T09:00:00Z'),
 ('33333333-3333-3333-3333-333333333333', 'HMCL/N/23/05/2026', '9900000009', 'TEAM ONE', 'NEAR NOTICE', '0712000009', '2026-05-23', 310000, 'LAWYER', '2026-05-23T09:00:00Z'),
 ('44444444-4444-4444-4444-444444444444', 'HMCL/E/20/08/2026', '9900000010', 'TEAM ONE', 'EARLIER NOTICE', '0712000010', '2026-08-20', 500000, 'LAWYER', '2026-08-20T09:00:00Z'),
 ('55555555-5555-5555-5555-555555555555', 'HMCL/V/08/06/2026', '9900000014', 'TEAM ONE', 'SEVEN DAYS', '0712000014', '2026-06-08', 70000, 'LAWYER', '2026-06-08T09:00:00Z'),
 ('66666666-6666-6666-6666-666666666666', 'HMCL/G/09/06/2026', '9900000015', 'TEAM ONE', 'EIGHT DAYS', '0712000015', '2026-06-09', 60000, 'LAWYER', '2026-06-09T09:00:00Z');
insert into defaulter_snapshots (ref, team, full_name, arrears, snapshot_type, snapshot_date, weekday) values ('9900000015', 'TEAM ONE', 'EIGHT DAYS', 60000, 'current', '2026-11-20', 'FRI');
insert into defaulter_snapshots (ref, team, full_name, arrears, snapshot_type, snapshot_date, weekday) values
 ('9900000004', 'TEAM THREE', 'ON A DECK', 444000, 'current', '2026-09-01', 'TUE'),
 ('9900000005', null, 'DECK NO TEAM', 200000, 'initial', '2026-09-02', 'WED'),
 ('9900000010', 'TEAM ONE', 'EARLIER NOTICE', 500000, 'current', '2026-11-20', 'FRI'),
 ('7700000001', 'TEAM ONE', 'SOMEBODY ELSE', 1000, 'current', '2026-11-20', 'FRI');
insert into followup_status (ref, team, full_name, contact, arrears) values ('9900000006', 'TEAM TWO', 'IN REGISTER', '0755000006', 150000), ('9900000010', 'TEAM ONE', 'EARLIER NOTICE', '0755000010', 500000);
insert into repayment_snapshots (ref, team, full_name, snapshot_type, snapshot_date) values ('9900000007', 'TEAM ONE', 'ON EXPECTED', 'today', '2026-10-05');
${extraSql}`);
}
/* ---- the model, written again: what an import must write ---- */
function model({ expectedAsked = true, sheet = SHEET } = {}) {
  const rows = sheet.map(l => { const f = l.split('|'); return { line: +f[0], by: { A: 'OFFICER ONE', B: 'OFFICER TWO' }[f[1]] || f[1], name: f[2], ref: f[3], team: f[4],
    arrears: f[8] === '' ? null : +f[8], date: f[9] ? '20' + f[9].slice(0, 2) + '-' + f[9].slice(2, 4) + '-' + f[9].slice(4, 6) : null }; });
  const seen = new Set(), uniq = [];
  for (const r of rows.filter(r => r.date).sort((a, b) => a.line - b.line)) { const k = r.ref + '|' + r.date; if (!seen.has(k)) { seen.add(k); uniq.push(r); } }
  const sys = { '9900000008': ['2026-05-15'], '9900000009': ['2026-05-23'], '9900000010': ['2026-08-20'], '8800000001': [SYSTEM_FIRST], '9900000014': ['2026-06-08'], '9900000015': ['2026-06-09'] };
  const days = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
  const inSystem = r => (sys[r.ref] || []).some(d => days(d, r.date) <= 7);
  const todo = uniq.filter(r => !inSystem(r));
  const known = new Set(['9900000004', '9900000005', '9900000006', '9900000010', '9900000015'].concat(expectedAsked ? ['9900000007'] : []));
  const phone = { '9900000006': '0755000006', '9900000010': '0755000010' };
  const notices = todo.map(r => ({ id: md5uuid('notice|import2025|' + r.ref + '|' + r.date), ref: r.ref, team: r.team || null, full_name: r.name, contact: phone[r.ref] || null,
    notice_date: r.date, arrears_at_notice: r.arrears, issued_by: r.by, created_at: r.date + 'T09:00:00+00:00', notice_id: null, upload_batch: null }));
  const last = new Map();
  for (const r of todo) if (!known.has(r.ref) && (!last.has(r.ref) || r.date > last.get(r.ref).date)) last.set(r.ref, r);
  const ledger = [];
  for (const [ref, l] of last) if (l.arrears > 0) for (const r of todo.filter(x => x.ref === ref))
    ledger.push({ ref, since: r.date, payment_id: md5uuid('cleared|import2025|' + ref), paid_at: addMonth(l.date), amount: l.arrears, matched_by: 'default' });
  return { rows, uniq, todo, notices, ledger, known, last, inSystemN: uniq.filter(inSystem).length };
}
const NOTICE_COLS = 'id, ref, team, full_name, contact, notice_date, arrears_at_notice::float8 as arrears_at_notice, issued_by, to_char(created_at at time zone \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS"+00:00"\') as created_at, notice_id, upload_batch';
const noticesNow = () => json(`select ${NOTICE_COLS} from demand_notices order by id`);
const ledgerNow = () => json(`select ref, since, payment_id, paid_at, amount::float8 as amount, matched_by from notice_payment_ledger order by ref, since, payment_id`);
const bookSum = () => psqlTo(`select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from demand_notices t;
select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from (select ref, since, payment_id, paid_at, amount, matched_by from notice_payment_ledger) t;
select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from defaulter_snapshots t;
select md5(coalesce(string_agg(t::text, '|' order by t::text), '')) from followup_status t;`).trim();
const answerOf = out => Object.fromEntries(out.trim().split('\n').map(l => l.split('\t')));
const sortBy = (a, k) => a.slice().sort((x, y) => (k(x) < k(y) ? -1 : k(x) > k(y) ? 1 : 0));

function run(fails, { text = ENGINE, data = DATA, expectedIndex = true, label = '' } = {}) {
  const note = m => { if (fails.length < 20) fails.push(label + m); };
  seed(expectedIndex ? 'create index if not exists idx_repay_snap_ref on repayment_snapshots(ref, snapshot_date);' : 'drop index if exists idx_repay_snap_ref;');
  const M = model({ expectedAsked: expectedIndex });
  // 1. the data block, twice, and a corrected line
  const block = (lines, o = {}) => psqlTo(dataBlock(lines, { shape: data, ...o })).trim().split('\n').pop();
  const listSum = () => psqlTo("select count(*) || ' ' || md5(coalesce(string_agg(concat_ws('|', line, issued_by, name, ref, team, principal, total_loan, total_paid, arrears, notice_date, how, cell), E'\\n' order by line), '')) from demand_import_2025").trim();
  const WHOLE = 'data block 1 of 1: OK\t' + SHEET.length + '\t' + SHEET.length, NOT = /^DATA BLOCK 1 OF 1 DID NOT ARRIVE WHOLE: NOTHING WAS WRITTEN\b/;
  try {
    /* a block damaged on the way keeps the fingerprint it left with: it writes nothing, into an empty list ... */
    const hurt = [
      ['one digit of an amount changed', SHEET.map((l, i) => (i === 0 ? l.replace('365000', '385000') : l))],
      ['one letter of a name changed', SHEET.map((l, i) => (i === 2 ? l.replace('NEVER TWO', 'NEVER TWQ') : l))],
      ['a line missing', SHEET.slice(0, 5).concat(SHEET.slice(6))],
      ['the last line missing', SHEET.slice(0, -1)],
      ['a line written twice', SHEET.concat([SHEET[3]])],
      ['two lines in the other order', [SHEET[1], SHEET[0]].concat(SHEET.slice(2))],
      ['a line that is not a line', SHEET.map((l, i) => (i === 4 ? 'x' + l : l))],
      ['a date that is no date', SHEET.map((l, i) => (i === 0 ? l.replace('|251015|', '|259915|') : l))],
    ];
    for (const [what, lines] of hurt) {
      let ans; try { ans = block(lines, { fp: fpOf(SHEET) }); } catch (e) { note('a damaged block (' + what + ') answered with an error, not in words: ' + errLine(e)); continue; }
      if (!NOT.test(ans)) note('a damaged block (' + what + ') did not say so: ' + ans);
      if (listSum().split(' ')[0] !== '0') note('a damaged block (' + what + ') wrote into the list');
    }
    const first = block(SHEET); if (first !== WHOLE) note('the data block does not answer OK and ' + SHEET.length + ' rows: ' + first);
    /* the list is private: on a book that hands every new table to the API's roles, as the live one does, they cannot read it */
    const priv = psqlTo("select has_table_privilege('anon', 'public.demand_import_2025', 'select')::int + has_table_privilege('authenticated', 'public.demand_import_2025', 'select')::int, (select relrowsecurity::int from pg_class where oid = 'public.demand_import_2025'::regclass)").trim();
    if (priv !== '0\t1') note('the list is not private (the API roles that can read it, row-level security on): ' + priv);
    const asWritten = listSum();
    const again = block(SHEET); if (again !== WHOLE || listSum() !== asWritten) note('the data block run twice does not answer OK and ' + SHEET.length + ' rows, or changed the list: ' + again);
    /* ... and into a filled one, which stays what it was */
    for (const [what, lines] of hurt) { let ans = ''; try { ans = block(lines, { fp: fpOf(SHEET) }); } catch (e) { ans = 'error: ' + errLine(e); }
      if (!NOT.test(ans) || listSum() !== asWritten) note('a damaged block (' + what + ') changed a filled list, or did not say so: ' + ans); }
    /* the same block as a clipboard or an editor may hand it over: Windows line ends, every line indented, blanks at the line ends, empty lines */
    for (const [what, raw] of [['Windows line ends', SHEET.join('\r\n') + '\r'], ['every line indented and blanks at the ends', SHEET.map(l => '    ' + l + '  ').join('\n')],
      ['empty lines between', SHEET.join('\n\n') + '\n\n'], ['indented more at each line, tabs aside', SHEET.map((l, i) => ' '.repeat(i) + l).join('\r\n')]]) {
      psqlTo('truncate demand_import_2025'); let ans = ''; try { ans = block(SHEET, { raw }); } catch (e) { ans = 'error: ' + errLine(e); }
      if (ans !== WHOLE || listSum() !== asWritten) note('the same block with ' + what + ' is not read as the same block: ' + ans); }
    /* a corrected line replaces the old one; a block run when one before it is missing says so and still writes its own rows */
    block([SHEET[0].replace('365000', '999')], { total: 1 });
    if (psqlTo('select arrears::int from demand_import_2025 where line = 2').trim() !== '999') note('a corrected line did not replace the old one');
    psqlTo('truncate demand_import_2025');
    const late = block(SHEET, { total: SHEET.length + 30 });
    if (late !== 'data block 1 of 1 is in, BUT A BLOCK BEFORE IT IS MISSING: run the blocks in order\t' + SHEET.length + '\t' + (SHEET.length + 30) || listSum() !== asWritten) note('a block run with one before it missing does not say so, or did not write its rows: ' + late);
    psqlTo('truncate demand_import_2025'); block(SHEET);
  } catch (e) { note('the data block failed: ' + errLine(e)); return; }
  const staged = json('select line, issued_by, name, ref, team, arrears::float8 as arrears, notice_date, how, cell from demand_import_2025 order by line');
  for (const r of M.rows) { const s = staged.find(x => x.line === r.line);
    if (!s || s.issued_by !== r.by || s.name !== r.name || s.ref !== r.ref || s.team !== r.team || s.arrears !== r.arrears || s.notice_date !== r.date) note('line ' + r.line + ' is not in the list as written: ' + JSON.stringify(s)); }
  if (staged.find(x => x.line === 14).cell !== '31/04/2026') note('the unreadable cell is not kept');
  // 2. COUNT changes nothing and counts right
  const before = bookSum();
  let a; try { a = answerOf(psqlTo(engine('COUNT', text))); } catch (e) { note('COUNT failed: ' + errLine(e)); return; }
  if (bookSum() !== before) note('COUNT changed the book');
  const expect = {
    'the word on the CHANGE line': 'COUNT: nothing was changed',
    'rows in the list (rows of the sheet with a loan number)': String(SHEET.length),
    'of them with a date nobody can read: left out (their rows of the sheet)': '1: 14',
    'a notice written twice in the sheet: counted once': '1',
    'not imported: held by the system (a notice within seven days) / written by an earlier run': M.inSystemN + ' / 0',
    'NOTICES TO IMPORT / customers / arrears at notice TZS': M.todo.length + ' / ' + new Set(M.todo.map(r => r.ref)).size + ' / ' + M.todo.reduce((s, r) => s + (r.arrears || 0), 0).toLocaleString('en-US'),
    'of them with no arrears figure (imported with it blank)': '1',
    'customers never on a file of the system: CLEARED BY DEFAULT one month after their last notice / TZS': [...M.last.values()].filter(l => l.arrears > 0).length + ' / ' + [...M.last.values()].reduce((s, l) => s + (l.arrears || 0), 0).toLocaleString('en-US'),
    'customers never on a file of the system with no arrears figure: nothing to record': '1',
    'customers the system holds or has held: read from its own files from here on': String(new Set(M.todo.filter(r => M.known.has(r.ref)).map(r => r.ref)).size),
    'teams of the sheet that are not on Teams & Staff': 'TEAM NOWHERE',
    'the expected sheets were asked too': expectedIndex ? 'yes' : 'no: no index by loan number (the decks and the register were asked)',
    'clearance lines to write / to correct': M.ledger.length + ' / 0',
    'WRITTEN BY THIS RUN: notices / default clearances': '0 / 0 (corrected: 0)',
  };
  for (const [k, v] of Object.entries(expect)) if (a[k] !== v) note('COUNT: "' + k + '" reads ' + JSON.stringify(a[k]) + ', the model says ' + JSON.stringify(v));
  const customersNow = Object.keys({ '9900000008': 1, '9900000009': 1, '9900000010': 1, '8800000001': 1, '9900000014': 1, '9900000015': 1 }).length;
  const customersAfter = customersNow + new Set(M.todo.map(r => r.ref).filter(r => !['9900000008', '9900000009', '9900000010', '8800000001', '9900000014', '9900000015'].includes(r))).size;
  if (a['noticed customers: now -> after'] !== customersNow + ' -> ' + customersAfter) note('COUNT: noticed customers reads ' + a['noticed customers: now -> after'] + ', the model says ' + customersNow + ' -> ' + customersAfter);
  // 3. a word that is neither changes nothing
  try { const w = answerOf(psqlTo(engine('YES', text))); if (bookSum() !== before || !/not COUNT or IMPORT, nothing was changed/.test(w['the word on the CHANGE line'])) note('another word than COUNT or IMPORT changed the book, or was not refused in words'); }
  catch (e) { note('another word failed instead of answering: ' + errLine(e)); }
  // 3b. an engine built for another number of rows than the list holds (a data block missing, or one too many) writes nothing, and says so
  for (const rows of [SHEET.length + 1, SHEET.length - 1]) {
    try { const w0 = answerOf(psqlTo(engine('IMPORT', text, rows)));
      if (bookSum() !== before) note('IMPORT wrote although the list holds ' + SHEET.length + ' rows and the engine was built for ' + rows);
      if (w0['the word on the CHANGE line'] !== 'IMPORT: NOT WRITTEN, the list is not whole (next line)') note('IMPORT on a list that is not whole does not say NOT WRITTEN: ' + w0['the word on the CHANGE line']);
      if (!/^\d+: NOT THE ROWS THIS ENGINE WAS BUILT FOR\. A data block is missing or damaged: NOTHING IS WRITTEN$/.test(w0['rows in the list (rows of the sheet with a loan number)'] || '')) note('the answer does not say the list is not whole: ' + w0['rows in the list (rows of the sheet with a loan number)']);
      if (w0['WRITTEN BY THIS RUN: notices / default clearances'] !== '0 / 0 (corrected: 0)') note('IMPORT on a list that is not whole says it wrote ' + w0['WRITTEN BY THIS RUN: notices / default clearances']);
      const c0 = answerOf(psqlTo(engine('COUNT', text, rows)));
      if (!/NOT THE ROWS THIS ENGINE WAS BUILT FOR/.test(c0['rows in the list (rows of the sheet with a loan number)'] || '') || c0['the word on the CHANGE line'] !== 'COUNT: nothing was changed') note('COUNT on a list that is not whole does not say so');
    } catch (e) { note('the engine failed on a list that is not whole: ' + errLine(e)); }
  }
  // 4. IMPORT writes the model, exactly
  let w; try { w = answerOf(psqlTo(engine('IMPORT', text))); } catch (e) { note('IMPORT failed: ' + errLine(e)); return; }
  if (w['WRITTEN BY THIS RUN: notices / default clearances'] !== M.notices.length + ' / ' + M.ledger.length + ' (corrected: 0)') note('IMPORT says it wrote ' + w['WRITTEN BY THIS RUN: notices / default clearances'] + ', the model ' + M.notices.length + ' / ' + M.ledger.length + ' (corrected: 0)');
  const sysIds = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666'];
  const got = noticesNow().filter(n => !sysIds.includes(n.id));
  const A = JSON.stringify(sortBy(got, x => x.id)), B = JSON.stringify(sortBy(M.notices, x => x.id).map(n => Object.fromEntries(Object.keys(got[0] || n).map(k => [k, n[k]]))));
  if (A !== B) { const gi = sortBy(got, x => x.id), mi = sortBy(M.notices, x => x.id); const i = gi.findIndex((x, j) => JSON.stringify(x) !== JSON.stringify(mi[j] && Object.fromEntries(Object.keys(x).map(k => [k, mi[j][k]]))));
    note('the notices written are not the model\'s (' + gi.length + ' against ' + mi.length + '; first difference: ' + JSON.stringify(gi[i]) + ' against ' + JSON.stringify(mi[i]) + ')'); }
  if (noticesNow().filter(n => sysIds.includes(n.id)).length !== sysIds.length) note('a notice of the system is gone');
  const L = JSON.stringify(ledgerNow()), LM = JSON.stringify(sortBy(M.ledger, x => x.ref + x.since + x.payment_id));
  if (L !== LM) note('the default clearances written are not the model\'s: ' + L + ' against ' + LM);
  // after the import, COUNT says there is nothing left to do (the imported notices are held now)
  try { const c2 = answerOf(psqlTo(engine('COUNT', text)));
    if (!/^0 \/ 0 \/ 0$/.test(c2['NOTICES TO IMPORT / customers / arrears at notice TZS'])) note('after the import COUNT still finds notices to import: ' + c2['NOTICES TO IMPORT / customers / arrears at notice TZS']);
    if (c2['clearance lines to write / to correct'] !== '0 / 0') note('after the import COUNT still finds clearance lines to write or correct: ' + c2['clearance lines to write / to correct']);
    if (c2['not imported: held by the system (a notice within seven days) / written by an earlier run'] !== M.inSystemN + ' / ' + M.notices.length) note('after the import COUNT does not count the notices an earlier run wrote: ' + c2['not imported: held by the system (a notice within seven days) / written by an earlier run']); }
  catch (e) { note('COUNT after the import failed: ' + errLine(e)); }
  // 5. a second IMPORT writes nothing; the fold adds and removes nothing for these notices
  const after = bookSum();
  try { const w2 = answerOf(psqlTo(engine('IMPORT', text))); if (w2['WRITTEN BY THIS RUN: notices / default clearances'] !== '0 / 0 (corrected: 0)' || bookSum() !== after) note('a second IMPORT wrote something: ' + w2['WRITTEN BY THIS RUN: notices / default clearances']); }
  catch (e) { note('a second IMPORT failed: ' + errLine(e)); }
  try { psqlTo('select public.fold_notice_payments(null);'); if (bookSum() !== after) note('the fold changed the ledger after the import'); } catch (e) { note('the fold failed after the import: ' + errLine(e)); }
  // 6. the undo removes what was written and nothing else
  try { const u = psqlTo(undo()).trim(); if (u !== M.ledger.length + '\t' + M.notices.length) note('the undo says it removed ' + u + ', the import wrote ' + M.ledger.length + ' and ' + M.notices.length);
    if (bookSum() !== before) note('after the undo the book is not what it was before the import'); } catch (e) { note('the undo failed: ' + errLine(e)); }
}

/* ---- 5b. A LATER DELIVERY: the first delivery imported, the second one's blocks added to the list, the engine built for both ---- */
function staged(fails, { text = ENGINE, data = DATA, expectedIndex = true, label = '' } = {}) {
  const note = m => { if (fails.length < 20) fails.push(label + m); };
  const idx = expectedIndex ? 'create index if not exists idx_repay_snap_ref on repayment_snapshots(ref, snapshot_date);' : 'drop index if exists idx_repay_snap_ref;';
  const block = (lines, total) => psqlTo(dataBlock(lines, { shape: data, total })).trim().split('\n').pop();
  const state = () => JSON.stringify([noticesNow(), ledgerNow()]);
  const key = l => l.ref + '|' + String(l.since).slice(0, 10) + '|' + l.payment_id;
  const KEY = 'WRITTEN BY THIS RUN: notices / default clearances';
  const COUNT_L = 'clearance lines to write / to correct', HELD = 'not imported: held by the system (a notice within seven days) / written by an earlier run';
  const M1 = model({ expectedAsked: expectedIndex }), MA = model({ expectedAsked: expectedIndex, sheet: ALL });
  const oldIds = new Set(M1.notices.map(n => n.id)), newN = MA.notices.filter(n => !oldIds.has(n.id));
  const oldL = new Map(M1.ledger.map(l => [key(l), l]));
  const toWrite = MA.ledger.filter(l => !oldL.has(key(l))), toFix = MA.ledger.filter(l => oldL.has(key(l)) && (oldL.get(key(l)).paid_at !== l.paid_at || oldL.get(key(l)).amount !== l.amount));
  if (!(toFix.length >= 3 && toWrite.length >= 3 && newN.length >= 5)) { note('the second delivery of the fixture does not exercise what it must: ' + newN.length + ' notices, ' + toWrite.length + ' lines to write, ' + toFix.length + ' to correct'); return; }
  const sysIds = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666'];
  const notices = () => noticesNow().filter(n => !sysIds.includes(n.id));
  const same = (got, M, what) => {
    const gi = sortBy(got, x => x.id), mi = sortBy(M.notices, x => x.id).map(n => Object.fromEntries(Object.keys(gi[0] || n).map(k => [k, n[k]])));
    if (JSON.stringify(gi) !== JSON.stringify(mi)) { const i = gi.findIndex((x, j) => JSON.stringify(x) !== JSON.stringify(mi[j])); note(what + ': the notices are not the model\'s (' + gi.length + ' against ' + mi.length + '; first difference: ' + JSON.stringify(gi[i]) + ' against ' + JSON.stringify(mi[i]) + ')'); }
    const L = JSON.stringify(ledgerNow().filter(l => l.matched_by === 'default')), LM = JSON.stringify(sortBy(M.ledger, x => x.ref + x.since + x.payment_id));
    if (L !== LM) note(what + ': the default clearances are not the model\'s: ' + L + ' against ' + LM);
  };
  try {
    seed(idx);
    // the first delivery: as the owner did it
    if (block(SHEET, SHEET.length) !== 'data block 1 of 1: OK\t' + SHEET.length + '\t' + SHEET.length) note('the first delivery\'s block does not say OK');
    const w1 = answerOf(psqlTo(engine('IMPORT', text, SHEET.length)));
    if (w1[KEY] !== M1.notices.length + ' / ' + M1.ledger.length + ' (corrected: 0)') note('the first delivery says it wrote ' + w1[KEY]);
    same(notices(), M1, 'after the first delivery');
    // the second delivery's block: the list grows; the block says so
    const b2 = block(EXTRA, ALL.length);
    if (b2 !== 'data block 1 of 1: OK\t' + ALL.length + '\t' + ALL.length) note('the second delivery\'s block does not say OK and ' + ALL.length + ' rows: ' + b2);
    // the engine still built for the first delivery's rows writes nothing now: the list is not what it was built for
    const stale = answerOf(psqlTo(engine('IMPORT', text, SHEET.length)));
    if (stale[KEY] !== '0 / 0 (corrected: 0)' || !/NOT THE ROWS THIS ENGINE WAS BUILT FOR/.test(stale['rows in the list (rows of the sheet with a loan number)'] || '')) note('the first delivery\'s engine wrote or did not refuse on the grown list: ' + stale[KEY]);
    // COUNT of the engine built for both: changes nothing, and says what will be written and what corrected
    const mid = bookSum(), stateMid = state();
    const c = answerOf(psqlTo(engine('COUNT', text, ALL.length)));
    if (bookSum() !== mid) note('COUNT changed the book after the first delivery');
    const arrears = newN.reduce((x, n) => x + (n.arrears_at_notice || 0), 0).toLocaleString('en-US');
    const want = {
      'rows in the list (rows of the sheet with a loan number)': String(ALL.length),
      'of them with a date nobody can read: left out (their rows of the sheet)': '2: 14, 38',
      'a notice written twice in the sheet: counted once': '2',
      [HELD]: MA.inSystemN + ' / ' + M1.notices.length,
      'NOTICES TO IMPORT / customers / arrears at notice TZS': newN.length + ' / ' + new Set(newN.map(n => n.ref)).size + ' / ' + arrears,
      [COUNT_L]: toWrite.length + ' / ' + toFix.length,
      [KEY]: '0 / 0 (corrected: 0)',
    };
    for (const [k, v] of Object.entries(want)) if (c[k] !== v) note('the second delivery\'s COUNT reads "' + k + '" as ' + JSON.stringify(c[k]) + ', the model says ' + JSON.stringify(v));
    // a clearance line of ANOTHER KIND under a key the second delivery would correct is never touched
    const corr = toFix[0];
    psqlTo(`create temp table _k as select payment_id from notice_payment_ledger where ref = '${corr.ref}' and since = '${corr.since}' and matched_by = 'default';
      delete from notice_payment_ledger where ref = '${corr.ref}' and since = '${corr.since}' and matched_by = 'default';
      insert into notice_payment_ledger (ref, since, payment_id, paid_at, amount, matched_by) select '${corr.ref}', '${corr.since}', payment_id, '2026-03-03', 777, 'phone' from _k;`);
    const cc = answerOf(psqlTo(engine('COUNT', text, ALL.length)));
    if (cc[COUNT_L] !== toWrite.length + ' / ' + (toFix.length - 1)) note('COUNT counts a ledger line of another kind as one to correct: ' + cc[COUNT_L]);
    // IMPORT the second delivery
    const w2 = answerOf(psqlTo(engine('IMPORT', text, ALL.length)));
    if (w2[KEY] !== newN.length + ' / ' + toWrite.length + ' (corrected: ' + (toFix.length - 1) + ')') note('the second delivery says it wrote ' + w2[KEY] + ', the model ' + newN.length + ' / ' + toWrite.length + ' (corrected: ' + (toFix.length - 1) + ')');
    const kept = json(`select paid_at, amount::float8 as amount, matched_by from notice_payment_ledger where ref = '${corr.ref}' and since = '${corr.since}' and matched_by = 'phone'`);
    if (kept.length !== 1 || kept[0].amount !== 777) note('a ledger line of another kind under the same key was changed: ' + JSON.stringify(kept));
    psqlTo(`delete from notice_payment_ledger where ref = '${corr.ref}' and since = '${corr.since}' and matched_by = 'phone';`);
    // put the corrected line back as the engine would have, to compare the rest: run it again (the line is written now, its key being free)
    const w2b = answerOf(psqlTo(engine('IMPORT', text, ALL.length)));
    if (w2b[KEY] !== '0 / 1 (corrected: 0)') note('the line the guard left alone is not written when its key is free: ' + w2b[KEY]);
    same(notices(), MA, 'after the second delivery');
    const staged2 = state();
    // a second IMPORT writes nothing
    const again = answerOf(psqlTo(engine('IMPORT', text, ALL.length)));
    if (again[KEY] !== '0 / 0 (corrected: 0)' || state() !== staged2) note('a second IMPORT after the second delivery wrote something: ' + again[KEY]);
    const after = answerOf(psqlTo(engine('COUNT', text, ALL.length)));
    if (after[COUNT_L] !== '0 / 0' || !/^0 \/ 0 \/ 0$/.test(after['NOTICES TO IMPORT / customers / arrears at notice TZS'])) note('after both deliveries COUNT still finds something to do: ' + after[COUNT_L] + ' | ' + after['NOTICES TO IMPORT / customers / arrears at notice TZS']);
    // ONE delivery of everything ends in the very same book
    seed(idx); const before2 = bookSum();
    if (block(ALL, ALL.length) !== 'data block 1 of 1: OK\t' + ALL.length + '\t' + ALL.length) note('the one-shot block does not say OK');
    psqlTo(engine('IMPORT', text, ALL.length));
    if (state() !== staged2) note('two deliveries do not end where one delivery of everything ends');
    same(notices(), MA, 'one delivery of everything');
    // the undo removes both deliveries and nothing else
    const u = psqlTo(undo()).trim();
    if (u !== MA.ledger.length + '\t' + MA.notices.length) note('the undo says it removed ' + u + ', the two deliveries wrote ' + MA.ledger.length + ' and ' + MA.notices.length);
    if (bookSum() !== before2) note('after the undo of both deliveries the book is not what it was before the first');
  } catch (e) { note('the later-delivery scenario failed: ' + errLine(e)); }
}

/* ---- 6. the cost, on two million deck rows ---- */
function big(fails, report) {
  const note = m => { if (fails.length < 20) fails.push(m); };
  seed('create index if not exists idx_repay_snap_ref on repayment_snapshots(ref, snapshot_date);');
  psqlTo(`drop index if exists idx_def_snap_ref;                       -- the live book has no index that starts with the loan number
insert into teams (team) select 'TEAM ' || i from generate_series(0, 83) i on conflict do nothing;
insert into defaulter_snapshots (ref, team, full_name, arrears, snapshot_type, snapshot_date, weekday)
select (5000000000 + (i % 40000))::text, 'TEAM ' || (i % 84), 'C ' || i, 1000 + i % 500, case when i % 2 = 0 then 'current' else 'initial' end, date '2026-08-03' + (i % 100), 'MON'
from generate_series(1, 2000000) i order by random();
vacuum analyze defaulter_snapshots;`);
  psqlTo(dataBlock(SHEET.concat(Array.from({ length: 440 }, (_, i) => `${100 + i}|A|BULK ${i}|${6600000000 + i}|TEAM ONE|1|2|1|${1000 + i}|2510${String(10 + (i % 18)).padStart(2, '0')}|T|`))));
  const t0 = Date.now(); let plan;
  try { plan = psqlTo(engine('COUNT', ENGINE, SHEET.length + 440).replace('with recursive mode as', 'explain (analyze, buffers, costs off, timing off) with recursive mode as')); } catch (e) { note('COUNT failed on the big book: ' + errLine(e)); return; }
  const secs = (Date.now() - t0) / 1000;
  /* How much of the deck TABLE the engine reads: the table's own pages asked for inside the transaction (a number the cache does not
     change). The index is descended once for each team and loan number, which is many visits to the same few pages and no read of the
     table; only a loan number that IS on a deck reaches the table, for one row. */
  const heap = +psqlTo("begin;\n" + engine('COUNT', ENGINE, SHEET.length + 440) + "\nselect 'HEAP', pg_stat_get_xact_blocks_fetched('public.defaulter_snapshots'::regclass);\ncommit;").split('\n').find(l => l.startsWith('HEAP')).split('\t')[1];
  const pages = +psqlTo("select pg_relation_size('defaulter_snapshots') / 8192").trim();
  report.push(`two million deck rows (${pages} pages), ${SHEET.length + 440} rows in the list: COUNT took ${secs.toFixed(1)} s and asked for ${heap} pages of the deck table`);
  if (/Seq Scan on defaulter_snapshots/.test(plan)) note('the decks are read end to end (the plan has a Seq Scan on defaulter_snapshots)');
  if (!(secs < 20)) note('COUNT took ' + secs.toFixed(1) + ' s on the big book');
  if (!(heap < pages / 20)) note('COUNT asked for ' + heap + ' pages of the deck table, which has ' + pages);
}

const once = (text, from, to) => { const n = text.split(from).length - 1; if (n !== 1) return null; return text.replace(from, () => to); };
const BREAKS = [
  ['a notice written twice in the sheet is imported twice', "md5('notice|import2025|' || u.kref || '|' || u.notice_date)::uuid as id, u.* from uniq u", "md5('notice|import2025|' || u.kref || '|' || u.notice_date || '|' || u.line)::uuid as id, u.* from st u where u.notice_date is not null"],
  ['only a notice of the very same day counts as held (a letter typed a few days apart is doubled)', 'and abs(x.notice_date - m.notice_date) <= 7)', 'and x.notice_date = m.notice_date)'],
  ['eight days apart still counts as held', 'and abs(x.notice_date - m.notice_date) <= 7)', 'and abs(x.notice_date - m.notice_date) <= 8)'],
  ['six days is the limit', 'and abs(x.notice_date - m.notice_date) <= 7)', 'and abs(x.notice_date - m.notice_date) <= 6)'],
  ['only a LATER notice of the system counts as held', 'and abs(x.notice_date - m.notice_date) <= 7)', 'and x.notice_date - m.notice_date between 0 and 7)'],
  ['any notice of the customer in the system stops the import', 'x.kref = m.kref and x.id not in (select id from mine) and abs(x.notice_date - m.notice_date) <= 7)', 'x.kref = m.kref and x.id not in (select id from mine))'],
  ['a notice of ANOTHER customer on a near day stops the import', 'x.kref = m.kref and x.id not in (select id from mine) and abs(x.notice_date - m.notice_date) <= 7)', 'x.id not in (select id from mine) and abs(x.notice_date - m.notice_date) <= 7)'],
  ['a customer on a deck is cleared by default', "union select r.kref from refs r where exists (select 1 from tm where exists (select 1 from public.defaulter_snapshots d where d.team = tm.team and d.ref = r.ref))\n", ''],
  ['a customer on a deck under no team is cleared by default', "union select r.kref from refs r where exists (select 1 from public.defaulter_snapshots d where d.team is null and d.ref = r.ref)\n", ''],
  ['a customer in the follow-up register is cleared by default', "select r.kref from refs r where exists (select 1 from public.followup_status f where f.ref = r.ref)\nunion ", ''],
  ['a customer on an expected sheet is cleared by default', "union select r.kref from refs r where (select ok from hasidx) and exists (select 1 from public.repayment_snapshots e where e.ref = r.ref)\n", ''],
  ['the expected sheets are asked with no index by loan number', "(select ok from hasidx) and exists (select 1 from public.repayment_snapshots e", "exists (select 1 from public.repayment_snapshots e"],
  ['the decks are asked only under the first team', 'from tm where tm.team is not null),', 'from tm where false),'],
  ['cleared a month after the FIRST notice, not the last', 'order by t.kref, t.notice_date desc),\nclr as', 'order by t.kref, t.notice_date asc),\nclr as'],
  ['cleared on the day of the notice', "(l.notice_date + interval '1 month')::date as paid_at", 'l.notice_date as paid_at'],
  ['cleared two months after', "interval '1 month')::date as paid_at", "interval '2 months')::date as paid_at"],
  ['the clearance is recorded under the last notice only', 'from lastn l join ours t on t.kref = l.kref where', 'from lastn l join ours t on t.kref = l.kref and t.notice_date = l.notice_date where'],
  ['a clearance for each notice with its own id (the customer is credited twice)', "md5('cleared|import2025|' || l.kref)::uuid as payment_id", "md5('cleared|import2025|' || l.kref || t.notice_date)::uuid as payment_id"],
  ['a clearance of nothing is recorded', 'where coalesce(l.arrears, 0) > 0),', '),'],
  ['the clearance is the arrears of each notice, not of the last', 'l.arrears as amount', 't.arrears as amount'],
  ['the clearance is not marked', "c.amount, 'default' from clr c", "c.amount, 'ref' from clr c"],
  ['the phone is not taken from the register', '(select f.contact from public.followup_status f where f.ref = t.ref limit 1)', 'null'],
  ['the notice is stamped at midnight', "interval '9 hours'", "interval '0 hours'"],
  ['the team is not written', "nullif(btrim(t.team), ''), t.name,", 'null, t.name,'],
  ['the arrears are written as nought when blank', 't.notice_date, t.arrears, t.issued_by,', 't.notice_date, coalesce(t.arrears, 0), t.issued_by,'],
  ['COUNT writes', "from todo t where (select m from mode) = 'IMPORT' and (select ok from whole) on conflict (id)", "from todo t where (select ok from whole) on conflict (id)"],
  ['COUNT writes the clearances', "from clr c where (select m from mode) = 'IMPORT' and (select ok from whole) on conflict", "from clr c where (select ok from whole) on conflict"],
  ['a list that is not whole is imported (the notices)', "from todo t where (select m from mode) = 'IMPORT' and (select ok from whole) on conflict (id)", "from todo t where (select m from mode) = 'IMPORT' on conflict (id)"],
  ['a list that is not whole is imported (the clearances)', "from clr c where (select m from mode) = 'IMPORT' and (select ok from whole) on conflict", "from clr c where (select m from mode) = 'IMPORT' on conflict"],
  ['the engine takes any number of rows for a whole list', '(select count(*) from public.demand_import_2025) = 3 as ok)', '(select count(*) from public.demand_import_2025) = 3 or true as ok)'],
  ['a list with rows missing passes for whole', '(select count(*) from public.demand_import_2025) = 3 as ok)', '(select count(*) from public.demand_import_2025) <= 3 as ok)'],
  ['a list with rows too many passes for whole', '(select count(*) from public.demand_import_2025) = 3 as ok)', '(select count(*) from public.demand_import_2025) >= 3 as ok)'],
  ['IMPORT on a list that is not whole says WRITTEN', "when m = 'IMPORT' and not (select ok from whole) then ': NOT WRITTEN, the list is not whole (next line)' ", ''],
  ['the answer does not say the list is not whole', "(select count(*) || case when (select ok from whole) then '' else ': NOT THE ROWS THIS ENGINE WAS BUILT FOR. A data block is missing or damaged: NOTHING IS WRITTEN' end from st)", '(select count(*)::text from st)'],
  ['any word imports', "upper(btrim('COUNT')) as m)", "'IMPORT'::text as m), unused as (select upper(btrim('COUNT')) as m)"],
  // ---- a later delivery ----
  ['the notices an earlier run wrote are held against its own rows', 'x.id not in (select id from mine) and ', ''],
  ['a notice an earlier run wrote is counted among the notices still to write', 'todo as (select * from ours where not have),', 'todo as (select * from ours),'],
  ['a clearance line of an earlier run is never corrected', "do update set paid_at = excluded.paid_at, amount = excluded.amount\nwhere notice_payment_ledger.matched_by = 'default' and (notice_payment_ledger.paid_at, notice_payment_ledger.amount) is distinct from (excluded.paid_at, excluded.amount) returning (xmax = 0) as added)", 'do nothing returning true as added)'],
  ['a clearance line of another kind is overwritten', "where notice_payment_ledger.matched_by = 'default' and (notice_payment_ledger", 'where (notice_payment_ledger'],
  ['a clearance line already right is written again', " and (notice_payment_ledger.paid_at, notice_payment_ledger.amount) is distinct from (excluded.paid_at, excluded.amount) returning", ' returning'],
  ['the last notice is taken among the notices still to write only', 'from ours t where t.kref not in (select kref from known)', 'from todo t where t.kref not in (select kref from known)'],
  ['a customer on a deck is judged only by the notices still to write', 'refs as (select distinct kref, ref from ours),', 'refs as (select distinct kref, ref from todo),'],
  ['the clearance is written under the notices still to write only', 'from lastn l join ours t on', 'from lastn l join todo t on'],
  ['the notices an earlier run wrote are not counted in the answer', 'count(*) filter (where have) from cand', '0 from cand'],
  ['COUNT does not count the clearance lines to write', 'count(*) filter (where l.ref is null) ||', '0 ||'],
  ['COUNT counts a line of another kind as one to correct', "count(*) filter (where l.matched_by = 'default' and (l.paid_at", 'count(*) filter (where l.ref is not null and (l.paid_at'],
  ['an unreadable date is imported as today', 'from st where notice_date is not null order by kref, notice_date, line', 'from (select line, issued_by, name, ref, team, principal, total_loan, total_paid, arrears, coalesce(notice_date, current_date) as notice_date, how, cell, staged_at, kref from st) z order by kref, notice_date, line'],
  // ---- the data block ----
  ['a damaged block writes', "from ln where l <> '' and (select ok from ok)\n", "from ln where l <> ''\n", 'data'],
  ['a damaged block says OK', "select case when not (select ok from ok) then 'DATA BLOCK 1 OF 1 DID NOT ARRIVE WHOLE", "select case when false then 'DATA BLOCK 1 OF 1 DID NOT ARRIVE WHOLE", 'data'],
  ['the fingerprint is compared with nothing', "ok as materialized (select coalesce(md5(", "ok as materialized (select true or coalesce(md5(", 'data'],
  ['the fingerprint is of the first line only', "md5(string_agg(l, E'\\n' order by n))", "md5((array_agg(l order by n))[1])", 'data'],
  ['the fingerprint does not see the order of the lines', "md5(string_agg(l, E'\\n' order by n))", "md5(string_agg(l, E'\\n' order by l))", 'data'],
  ['Windows line ends make another block of it', "btrim(replace(x.l, chr(13), '')) as l", 'btrim(x.l) as l', 'data'],
  ['an indented paste makes another block of it', "btrim(replace(x.l, chr(13), '')) as l", "replace(x.l, chr(13), '') as l", 'data'],
  ['empty lines make another block of it', "as ok from ln where l <> ''),", 'as ok from ln),', 'data'],
  ['a line run again is kept as it was', 'on conflict (line) do update set issued_by = excluded.issued_by, name = excluded.name, ref = excluded.ref, team = excluded.team,\nprincipal = excluded.principal, total_loan = excluded.total_loan, total_paid = excluded.total_paid, arrears = excluded.arrears,\nnotice_date = excluded.notice_date, how = excluded.how, cell = excluded.cell, staged_at = now() returning line),', 'on conflict (line) do nothing returning line),', 'data'],
  ['a block run again counts its rows twice', 'from public.demand_import_2025 s where s.line not in (select line from ins)) +', 'from public.demand_import_2025 s) +', 'data'],
  ['a block with one before it missing says OK', "then 'data block 1 of 1 is in, BUT A BLOCK BEFORE IT IS MISSING: run the blocks in order'\n", "then 'data block 1 of 1: OK'\n", 'data'],
  ['the list can be read through the public API', 'revoke all on public.demand_import_2025 from anon, authenticated;\n', '', 'data'],
  ['the list has no row-level security', 'alter table public.demand_import_2025 enable row level security;\n', '', 'data'],
];

const t0 = Date.now(); const report = [], fails = [];
try { psqlTo('drop database if exists ' + DB, admin); } catch {}
psqlTo('create database ' + DB + " template template0 encoding 'UTF8'", admin);
psqlTo(fs.readFileSync(ROOT + '/db/schema.sql', 'utf8'));
// the live table's shape: the two real migrations that gave a notice its Kumb.Na. and its upload stamp, then the letter column and the ledger
psqlTo(fs.readFileSync(ROOT + '/db/migrations/2026-07-26-demand-notice-id.sql', 'utf8'));
psqlTo(fs.readFileSync(ROOT + '/db/migrations/2026-07-28-upload-stamp.sql', 'utf8'));
psqlTo('alter table public.demand_notices add column if not exists letter jsonb;');
psqlTo(F041);
psqlTo(`drop index if exists idx_def_snap_ref;                          -- as the live book: no index that starts with the loan number
create index if not exists idx_def_snap_team_ref on defaulter_snapshots(team, ref);
alter default privileges in schema public grant all on tables to anon, authenticated;   -- as the live book: a new table is the API's unless it is taken back`);
run(fails);
run(fails, { expectedIndex: false, label: '(no index on the expected sheets) ' });
staged(fails);
staged(fails, { expectedIndex: false, label: '(no index on the expected sheets) ' });
if (!process.env.NOBIG) big(fails, report);
console.log(report.join('\n'));
console.log(fails.length ? 'FAIL on the template as it is:\n  ' + fails.join('\n  ') : 'the template does what it says: the list and its fingerprint, COUNT, IMPORT only on a whole list, a second run, the fold, the undo, the cost.');
let bad = fails.length ? 1 : 0;
if (!process.env.NOBREAKS && !fails.length) {
  const res = [];
  for (const [name, a, b, where] of BREAKS) {
    const text = once(where === 'data' ? DATA : ENGINE, a, b);
    if (text === null) { res.push([name, 'BAD BREAK: its text is not in the ' + (where === 'data' ? 'data block' : 'engine') + ' exactly once']); bad = 1; continue; }
    const f = []; const o = where === 'data' ? { data: text } : { text };
    try { run(f, o); if (!f.length) run(f, { ...o, expectedIndex: false }); if (!f.length && where !== 'data') staged(f, o); } catch (e) { f.push('the broken copy could not be run: ' + String(e.message).slice(0, 80)); }
    /* a break the check itself could not build is no catch: it is a fault of this file */
    const own = f.length && /the engine does not say how many rows|the CHANGE line is not there once|does not hold this once|could not be run/.test(f[0]);
    res.push([name, own ? 'BAD BREAK: the check could not build it (' + f[0].slice(0, 70) + ')' : f.length ? (/failed: /.test(f[0]) && !/reads|model|wrote|changed/.test(f[0]) ? 'caught (it does not run: ' + f[0].slice(0, 60) + ')' : 'caught') : 'NOT CAUGHT']); if (!f.length || own) bad = 1;
  }
  for (const [name, r] of res) console.log('  break: ' + name.padEnd(74) + ' ' + r);
  console.log(`${res.filter(r => /^caught/.test(r[1])).length} of ${res.length} deliberate breaks caught`);
}
try { psqlTo('drop database if exists ' + DB, admin); } catch {}
console.log('took ' + Math.round((Date.now() - t0) / 1000) + ' s');
process.exit(bad);
