/* THE ILIYONASIA ENTRIES FILED TWICE, ONCE AGAINST EACH EXPECTED BOOK -- db/RUN-ME-086 (read-only), run for real on a PostgreSQL.

     "single input of Miamala should reflrct in both initial and current expected reports since miamala are always already
      collected so early collection officers are lalamenting why it doesnt count for them" -- the owner, 23 Nov 2026

   Since Part 132 one entry against either expected book counts in both, so a payment somebody typed twice (once as Initial,
   once as Current, to make both books move) now counts twice. RUN-ME-086 lists such pairs: same report date, same team (blank
   is blank), same customer ref (blank is blank), same amount, one entry of each expected book; then a COUNT row. It changes
   nothing. The register is the real table (the pmo_adjustments block of db/schema.sql, the same DDL as RUN-ME-015).

   It passes only when: every row the file prints equals a MODEL written again here (a pair; a triple, where every entry stands
   against the other book; the same payment typed twice against the SAME book, which is a correction, not a pair; a pair that
   differs by amount, by ref, by day, or by team; a team spelt in another case or with a blank (one team); the arrears books with
   matching rows (never listed); a register with no pair); the COUNT is the number of pairs; the table is byte-identical afterwards;
   a cut text either fails or prints nothing partial; and every deliberate break of the file makes a check fail.

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/expected-adjustments-twice.mjs

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the file did what it says. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(ROOT + '/db/RUN-ME-086-expected-adjustments-filed-twice-read-only.sql', 'utf8');
const DB = 'hope_adjtwice';
const admin = process.env.PGDATABASE || 'postgres';
const env = process.env;
const psqlTo = (sql, db) => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: sql, env, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['pipe', 'pipe', 'pipe'] });
const q = s => s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";

const schema = fs.readFileSync(ROOT + '/db/schema.sql', 'utf8');
const ddl = /create table if not exists pmo_adjustments \([\s\S]*?\);/.exec(schema);
if (!ddl) { console.log('FAIL: the pmo_adjustments block is not in db/schema.sql'); process.exit(2); }
try { psqlTo('drop database if exists ' + DB, admin); } catch {}
psqlTo('create database ' + DB + " template template0 encoding 'UTF8'", admin);
psqlTo('create extension if not exists pgcrypto;\n' + ddl[0], DB);

const D = '2026-11-20', D2 = '2026-11-19';
const ROWS = [
  // a pair: the same payment typed against both books
  { id: 'a1', d: D, target: 'expected-initial', team: 'KONGOWE', ref: '901', amount: 50000, reason: 'ilipwa', by: 'PMO DATA', at: '2026-11-20T06:00:00Z' },
  { id: 'a2', d: D, target: 'expected-current', team: 'KONGOWE', ref: '901', amount: 50000, reason: 'ilipwa tena', by: 'PMO DATA', at: '2026-11-20T06:01:00Z' },
  // a triple: initial, current, current -- every one stands against the other book
  { id: 'b1', d: D, target: 'expected-initial', team: 'MBAGALA', ref: '902', amount: 1000, reason: null, by: null, at: '2026-11-20T06:02:00Z' },
  { id: 'b2', d: D, target: 'expected-current', team: 'MBAGALA', ref: '902', amount: 1000, reason: null, by: null, at: '2026-11-20T06:03:00Z' },
  { id: 'b3', d: D, target: 'expected-current', team: 'MBAGALA', ref: '902', amount: 1000, reason: 'again', by: null, at: '2026-11-20T06:04:00Z' },
  // the same payment twice against the SAME book: a correction to the first, not a pair
  { id: 'c1', d: D, target: 'expected-current', team: 'TEMEKE', ref: '903', amount: 2000, reason: null, by: null, at: '2026-11-20T06:05:00Z' },
  { id: 'c2', d: D, target: 'expected-current', team: 'TEMEKE', ref: '903', amount: 2000, reason: null, by: null, at: '2026-11-20T06:06:00Z' },
  // nearly pairs: a different amount, a different ref, a different day, a different team
  { id: 'd1', d: D, target: 'expected-initial', team: 'KIGOMA', ref: '904', amount: 3000, reason: null, by: null, at: '2026-11-20T06:07:00Z' },
  { id: 'd2', d: D, target: 'expected-current', team: 'KIGOMA', ref: '904', amount: 3500, reason: null, by: null, at: '2026-11-20T06:08:00Z' },
  { id: 'e1', d: D, target: 'expected-initial', team: 'KIGOMA', ref: '905', amount: 4000, reason: null, by: null, at: '2026-11-20T06:09:00Z' },
  { id: 'e2', d: D, target: 'expected-current', team: 'KIGOMA', ref: '906', amount: 4000, reason: null, by: null, at: '2026-11-20T06:10:00Z' },
  { id: 'f1', d: D, target: 'expected-initial', team: 'KIGOMA', ref: '907', amount: 5000, reason: null, by: null, at: '2026-11-20T06:11:00Z' },
  { id: 'f2', d: D2, target: 'expected-current', team: 'KIGOMA', ref: '907', amount: 5000, reason: null, by: null, at: '2026-11-20T06:12:00Z' },
  { id: 'g1', d: D, target: 'expected-initial', team: 'KIGOMA', ref: '908', amount: 6000, reason: null, by: null, at: '2026-11-20T06:13:00Z' },
  { id: 'g2', d: D, target: 'expected-current', team: 'SINZA', ref: '908', amount: 6000, reason: null, by: null, at: '2026-11-20T06:14:00Z' },
  // a pair whose team is spelt in another case and with a blank: one team
  { id: 'h1', d: D2, target: 'expected-initial', team: 'Tunduru', ref: null, amount: 7000, reason: null, by: null, at: '2026-11-20T06:15:00Z' },
  { id: 'h2', d: D2, target: 'expected-current', team: 'TUNDURU ', ref: '', amount: 7000, reason: null, by: null, at: '2026-11-20T06:16:00Z' },
  // a pair on the whole book (no team), no ref
  { id: 'i1', d: D2, target: 'expected-current', team: null, ref: null, amount: 8000, reason: 'kitabu chote', by: 'X', at: '2026-11-20T06:17:00Z' },
  { id: 'i2', d: D2, target: 'expected-initial', team: null, ref: null, amount: 8000, reason: null, by: null, at: '2026-11-20T06:18:00Z' },
  // the arrears books: matching rows are never listed
  { id: 'j1', d: D, target: 'defaulter-initial', team: 'KONGOWE', ref: '909', amount: 9000, reason: null, by: null, at: '2026-11-20T06:19:00Z' },
  { id: 'j2', d: D, target: 'defaulter-current', team: 'KONGOWE', ref: '909', amount: 9000, reason: null, by: null, at: '2026-11-20T06:20:00Z' },
  // an expected entry whose twin is an arrears entry: not a pair
  { id: 'k1', d: D, target: 'expected-initial', team: 'KONGOWE', ref: '910', amount: 9500, reason: null, by: null, at: '2026-11-20T06:21:00Z' },
  { id: 'k2', d: D, target: 'defaulter-current', team: 'KONGOWE', ref: '910', amount: 9500, reason: null, by: null, at: '2026-11-20T06:22:00Z' },
];
const insertSql = rows => 'insert into pmo_adjustments (id, adj_date, target, team, amount, reason, ref, created_by, created_at) values\n'
  + rows.map(r => `(${q(uuidOf(r.id))}, ${q(r.d)}, ${q(r.target)}, ${q(r.team)}, ${r.amount}, ${q(r.reason)}, ${q(r.ref)}, ${q(r.by)}, ${q(r.at)})`).join(',\n') + ';';
// a uuid per fixture id, stable, so the answer can be read back by id
const uuidOf = id => '00000000-0000-4000-8000-' + id.padEnd(12, '0').split('').map(c => c.charCodeAt(0).toString(16).slice(-1)).join('').slice(0, 12);

/* THE MODEL, written again: a pair key is (day, team upper+trim or '', ref trim or '', amount); an expected entry is listed when
   another expected entry of the OTHER book shares its key. Then the file's own order. */
function model(rows) {
  const key = r => [r.d, String(r.team == null ? '' : r.team).trim().toUpperCase(), String(r.ref == null ? '' : r.ref).trim(), String(r.amount)].join('|');
  const exp = rows.filter(r => r.target === 'expected-initial' || r.target === 'expected-current');
  const listed = exp.filter(a => exp.some(b => b.id !== a.id && b.target !== a.target && key(b) === key(a)));
  // the file's own order: newest report date first, then the team (blanks trimmed, upper-cased, '' for the whole book), the ref
  // (trimmed, '' for none), the amount, the book and the id -- every text key in plain code-point order (collate "C"), so the
  // live book's en_US collation and a scratch one agree
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const tk = r => String(r.team == null ? '' : r.team).trim().toUpperCase(), rk = r => String(r.ref == null ? '' : r.ref).trim();
  listed.sort((a, b) => cmp(b.d, a.d) || cmp(tk(a), tk(b)) || cmp(rk(a), rk(b)) || a.amount - b.amount || cmp(a.target, b.target) || cmp(uuidOf(a.id), uuidOf(b.id)));
  return { listed, count: listed.length };
}
const ok = [], fail = [];
const need = (c, m, extra) => (c ? ok : fail).push(m + (extra ? ' -- ' + extra : ''));
const run = (text) => psqlTo(text, DB).trim().split('\n').filter(Boolean).map(l => l.split('\t'));
const dump = () => psqlTo('select * from pmo_adjustments order by id', DB);

psqlTo('truncate pmo_adjustments;', DB); psqlTo(insertSql(ROWS), DB);
const before = dump();
const out = run(FILE);
const m = model(ROWS);
const pairRows = out.filter(r => r[0] === 'PAIR'), countRow = out.filter(r => r[0] === 'COUNT');
need(pairRows.length === m.listed.length, 'the file lists exactly the entries the model lists: ' + pairRows.length + ' of ' + m.listed.length);
need(countRow.length === 1 && countRow[0][4] === String(m.count) && countRow[0][5] === 'entries listed', 'the COUNT row is the number of entries listed: ' + JSON.stringify(countRow));
need(out[out.length - 1][0] === 'COUNT', 'the COUNT row is last');
const ids = pairRows.map(r => r[9]);
need(new Set(ids).size === ids.length, 'no entry is printed twice');
const idOf = u => ROWS.find(r => uuidOf(r.id) === u);
need(ids.every(u => idOf(u)), 'every id printed is one of the fixture\'s');
need(JSON.stringify(ids.map(u => idOf(u).id).sort()) === JSON.stringify(m.listed.map(r => r.id).sort()), 'and they are the model\'s entries: ' + ids.map(u => idOf(u).id).sort().join(','));
need(JSON.stringify(pairRows.map(r => idOf(r[9]).id)) === JSON.stringify(m.listed.map(r => r.id)), 'in the file\'s own order (newest day first, then team, ref, amount, book)');
for (const r of pairRows) {
  const f = idOf(r[9]);
  need(r[1] === f.d && r[2] === (f.team == null ? '(whole book)' : f.team) && r[3] === String(f.ref == null ? '' : f.ref) && Number(r[4]) === f.amount && r[5] === f.target
    && r[6] === String(f.reason == null ? '' : f.reason).slice(0, 60) && r[7] === String(f.by == null ? '' : f.by), 'the row prints the register\'s own words for ' + f.id + ': ' + JSON.stringify(r.slice(1, 8)));
}
need(!ids.some(u => ['c1', 'c2', 'd1', 'd2', 'e1', 'e2', 'f1', 'f2', 'g1', 'g2', 'j1', 'j2', 'k1', 'k2'].includes(idOf(u).id)), 'a same-book repeat, a near miss and an arrears twin are never listed');
need(['a1', 'a2', 'b1', 'b2', 'b3', 'h1', 'h2', 'i1', 'i2'].every(id => ids.includes(uuidOf(id))), 'the pair, the triple, the case-and-blank pair and the whole-book pair are');
need(dump() === before, 'the table is byte-identical afterwards');
// an empty register
psqlTo('truncate pmo_adjustments;', DB);
const none = run(FILE);
need(none.length === 1 && none[0][0] === 'COUNT' && none[0][4] === '0', 'a register with no pair prints COUNT 0 only: ' + JSON.stringify(none));
// a register with no table at all is refused with the table's name
try { psqlTo('drop table pmo_adjustments;', DB); psqlTo(FILE, DB); need(false, 'a book without the register is refused'); }
catch (e) { need(/pmo_adjustments/.test(String(e.stderr || e.message)), 'a book without the register is refused, naming the table'); }
psqlTo('create extension if not exists pgcrypto;\n' + ddl[0], DB); psqlTo(insertSql(ROWS), DB);
// cut at every line: it is one read-only statement, so a cut text is refused, or (a cut that drops only the ORDER BY or the END
// line) prints the whole answer with its COUNT row; never a partial answer, never a change
const lines = FILE.split('\n');
let cutOk = 0, cutRan = 0, cutPartial = 0;
for (let i = 1; i < lines.length - 1; i++) {
  const cut = lines.slice(0, i).join('\n');
  try {
    const r = run(cut);
    if (!r.length) continue;
    cutRan++;
    const c = r.filter(x => x[0] === 'COUNT');
    if (!(c.length === 1 && c[0][4] === String(m.count) && r.filter(x => x[0] === 'PAIR').length === m.listed.length)) cutPartial++;
  } catch { cutOk++; }
}
need(cutPartial === 0 && cutRan <= 2, 'a text cut at any line is refused or answers whole (' + cutOk + ' refused, ' + cutRan + ' answered whole, ' + cutPartial + ' partial)');
need(dump() === before, 'and changes nothing');
// deliberate breaks of the file: each must make a check above fail
const BREAKS = [
  ['the day is ignored', 'and b.adj_date = a.adj_date\n', ''],
  ['the amount is ignored', 'and b.amount = a.amount\n', ''],
  ['the ref is ignored', "and coalesce(btrim(b.ref), '') = coalesce(btrim(a.ref), '')\n", ''],
  ['the team is ignored', "and coalesce(upper(btrim(b.team)), '') = coalesce(upper(btrim(a.team)), '')\n", ''],
  ['the team is compared in its own case', "coalesce(upper(btrim(b.team)), '') = coalesce(upper(btrim(a.team)), '')", "coalesce(btrim(b.team), '') = coalesce(btrim(a.team), '')"],
  ['the same book counts as a pair', 'and b.target <> a.target\n', ''],
  ['the arrears books are listed too', "where a.target in ('expected-initial', 'expected-current')\nand exists (", 'where exists ('],
  ['the entry is paired with itself', 'where b.id <> a.id\n', ''],
  ['the count is halved', 'count(*)::numeric', '(count(*) / 2)::numeric'],
  ['the order forgets the day', "order by (p.kind = 'COUNT'), p.adj_date desc, coalesce", "order by (p.kind = 'COUNT'), coalesce"],
  ['the register\'s reason is not printed', "left(coalesce(p.reason, ''), 60) as reason", "'' as reason"],
];
let caught = 0;
for (const [name, from, to] of BREAKS) {
  if (FILE.split(from).length !== 2) { need(false, 'BAD BREAK (not found once): ' + name); continue; }
  const broken = FILE.replace(from, () => to);
  let bad = false;
  try {
    const o = run(broken); const p = o.filter(r => r[0] === 'PAIR'), c = o.filter(r => r[0] === 'COUNT');
    const got = JSON.stringify(p.map(r => idOf(r[9]) ? idOf(r[9]).id : r[9])), want = JSON.stringify(m.listed.map(r => r.id));
    const reasons = p.map(r => r[6]).join('|');
    bad = got !== want || !(c.length === 1 && c[0][4] === String(m.count)) || !/ilipwa/.test(reasons) || o[o.length - 1][0] !== 'COUNT';
  } catch { bad = true; }
  if (bad) caught++; else need(false, 'MISSED break: ' + name);
}
need(caught === BREAKS.length, caught + ' of ' + BREAKS.length + ' deliberate breaks caught');
try { psqlTo('drop database if exists ' + DB, admin); } catch {}
for (const f of fail) console.log('FAIL', f);
for (const o of ok) console.log('PASS', o);
console.log('\n' + ok.length + ' checks pass' + (fail.length ? ', ' + fail.length + ' FAIL' : ''));
process.exit(fail.length ? 1 : 0);
