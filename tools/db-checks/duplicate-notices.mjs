/* THE REMOVAL OF DUPLICATE DEMAND NOTICES BY REF NO -- db/RUN-ME-074, run for real on a PostgreSQL.

     "SQL to delete duplicate demand notices by ref no" -- the owner, 20 Nov 2026

   db/RUN-ME-074-remove-duplicate-demand-notices.sql DELETES DATA on the owner's live book (a legal register), so it is not believed on a reading. It groups the notices by their customer's ref
   (blanks trimmed, any case), keeps ONE notice in each group, the one issued first, copies every other notice whole to demand_notices_removed and deletes it, in one statement. The word on its CHANGE line
   is DAY (the default: only a repeat served on the SAME DAY as an earlier notice of the ref goes) or REF (every later notice of the ref goes, whatever its day). Anything else is refused.

   THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database and the two real migrations that add notice_id and upload_date / upload_batch to demand_notices. The fixture knows the
   truth: three same-day repeats (the first issued stands), a ref served on two days (DAY keeps both days, REF keeps the first notice), the ref written three ways (blanks and case), blank and null refs
   (never touched), two notices at the same instant (the one carrying a Kumb.Na. stands), notices with no date, a removed notice carrying a stored letter and an upload stamp, singletons, two refs with repeats
   on one day, and a recoveries ledger that must come out exactly as it went in.

   It passes only when: the notices left are EXACTLY what a MODEL written again in JavaScript says, in both modes and when DAY is followed by REF; the answer's seven numbers equal the model's; every
   removed notice is in demand_notices_removed whole (the same jsonb text, its letter included) with the id of the notice that stands; a second run removes nothing and writes nothing; the undo at the foot puts
   the table back byte for byte, after one run and after two; a word that is neither DAY nor REF removes and copies nothing; a text CUT at 150 places either fails or finishes (never a notice removed without
   its copy); the same text with every line indented answers and removes the same; a book a hundred times the live one (112,000 notices; the live book held 1,127 with a ref) is run against the model and its time printed; and EVERY ONE of a list of deliberate breaks of the
   file makes a check fail (an SQL error alone does not count as caught).

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/duplicate-notices.mjs

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(ROOT + '/db/RUN-ME-074-remove-duplicate-demand-notices.sql', 'utf8');
const DB = 'hope_dupnotices';
const admin = process.env.PGDATABASE || 'postgres';
const env = process.env;
const PIPES = ['pipe', 'pipe', 'pipe'];
const psqlTo = (sql, db) => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: sql, env, encoding: 'utf8', maxBuffer: 1 << 28, stdio: PIPES });
const oneQuery = (sql, db) => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql], { env, encoding: 'utf8', maxBuffer: 1 << 28, stdio: PIPES });
const ORDER = 'order by s.notice_date, s.created_at, (s.notice_id is null), s.id';
const SAVED = "select 'DUPLICATE NOTICES 20 NOV (SQL)', x.keep_id, to_jsonb(d)";
const BREAKS = [
  ['the day is ignored in DAY (REF behaviour)', "case when c.mode = 'DAY' then s.notice_date::text end", 'null::text'],
  ['the day is always used (DAY behaviour in REF)', "case when c.mode = 'DAY' then s.notice_date::text end", 's.notice_date::text'],
  ['the last issued stands instead of the first', ORDER, 'order by s.notice_date desc, s.created_at desc, (s.notice_id is null), s.id'],
  ['every notice of a group is deleted', "where r.rn > 1 and r.mode in ('DAY', 'REF')", "where r.rn >= 1 and r.mode in ('DAY', 'REF')"],
  ['a blank ref is grouped (no guard at all)', "where nullif(btrim(d.ref), '') is not null", 'where true'],
  ['a blank ref is grouped (null only is guarded)', "where nullif(btrim(d.ref), '') is not null", 'where d.ref is not null'],
  ['the ref is compared in its own case', 'upper(btrim(d.ref)) as rk', 'btrim(d.ref) as rk'],
  ['the ref is compared with its blanks', 'upper(btrim(d.ref)) as rk', 'upper(d.ref) as rk'],
  ['the word is not validated', "where r.rn > 1 and r.mode in ('DAY', 'REF')", 'where r.rn > 1'],
  ['no copy is taken', 'from doomed x join public.demand_notices d on d.id = x.id', 'from doomed x join public.demand_notices d on d.id = x.id where false'],
  ['the copy holds only the id', 'to_jsonb(d)', "jsonb_build_object('id', d.id)"],
  ['every notice is deleted (no join)', 'delete from public.demand_notices d using doomed x where d.id = x.id returning d.id', 'delete from public.demand_notices d using doomed x where true returning d.id'],
  ['the copy carries another label', SAVED, "select 'OTHER LABEL', x.keep_id, to_jsonb(d)"],
  ['the copy names the wrong notice as the one that stands', SAVED, "select 'DUPLICATE NOTICES 20 NOV (SQL)', x.id, to_jsonb(d)"],
  ['the undo asks for another label', "where x.label = 'DUPLICATE NOTICES 20 NOV (SQL)'", "where x.label = 'NOPE'"],
  ['the partition forgets the ref', 'partition by s.rk, case when', 'partition by case when'],
  ['the tie-break on the Kumb.Na. is gone', ORDER, 'order by s.notice_date, s.created_at, s.id'],
  ['a notice with no date is read first', ORDER, 'order by s.notice_date nulls first, s.created_at, (s.notice_id is null), s.id'],
  ['the notice that stands is named wrongly (last_value)', 'first_value(s.id) over w as keep_id', 'last_value(s.id) over w as keep_id'],
  ['the answer counts rows, not refs, with repeats', '(select count(distinct rk) from ranked where rn > 1) as refs_with_repeats', '(select count(*) from ranked where rn > 1) as refs_with_repeats'],
  ['the answer counts every ref as served on more than one day', 'having count(distinct notice_date) > 1', 'having count(distinct notice_date) > 0'],
];
const MUT = process.env.MUT ? JSON.parse(process.env.MUT) : null;
const FAST = !!process.env.FAST;
if (MUT && FILE.split(MUT.from).length !== 2) { console.log('BAD BREAK: not found once: ' + MUT.from.slice(0, 80)); process.exit(3); }
const build = mode => { let t = FILE.replace("'DAY'::text as mode", "'" + mode + "'::text as mode"); if (MUT) t = t.replace(MUT.from, () => MUT.to); return t; };
const undoOf = t => t.split('\n').filter(l => /^-- insert into/.test(l)).map(l => l.replace(/^-- /, '')).join('\n');
const q = s => s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";

try { psqlTo('drop database if exists ' + DB, admin); } catch {}
psqlTo('create database ' + DB + " template template0 encoding 'UTF8'", admin);
psqlTo(fs.readFileSync(ROOT + '/db/schema.sql', 'utf8'), DB);
psqlTo(fs.readFileSync(ROOT + '/db/migrations/2026-07-26-demand-notice-id.sql', 'utf8'), DB);
psqlTo(fs.readFileSync(ROOT + '/db/migrations/2026-07-28-upload-stamp.sql', 'utf8'), DB);

let seq = 0;
const uid = () => { seq++; return '00000000-0000-4000-8000-' + seq.toString(16).padStart(12, '0'); };
const mkRow = (ref, date, created, kumb, extra = {}) => ({ id: uid(), ref, notice_date: date, created_at: created, notice_id: kumb, team: 'TEAM A',
  full_name: 'TEST CUSTOMER ' + String(ref == null ? 'BLANK' : ref).trim().toUpperCase(), contact: '0700000000', total_demand: 100000, arrears_at_notice: 80000, issued_by: 'TEST OFFICER', letter: null, upload_batch: null, ...extra });
const insertSql = rows => {
  const out = [];
  for (let i = 0; i < rows.length; i += 2000) {
    out.push('insert into public.demand_notices (id, ref, notice_date, created_at, notice_id, team, full_name, contact, total_demand, arrears_at_notice, issued_by, letter, upload_batch) values\n'
      + rows.slice(i, i + 2000).map(r => '(' + [q(r.id), q(r.ref), q(r.notice_date), q(r.created_at), q(r.notice_id), q(r.team), q(r.full_name), q(r.contact), r.total_demand, r.arrears_at_notice, q(r.issued_by), r.letter ? q(r.letter) + '::jsonb' : 'null', q(r.upload_batch) + (r.upload_batch ? '::uuid' : '')].join(', ') + ')').join(',\n') + ';');
  }
  return out.join('\n');
};
const T = (d, hm) => d + 'T' + hm + ':00Z';
const fixtureA = () => {
  seq = 0; const R = [];
  R.push(mkRow('R100', '2026-10-05', T('2026-10-05', '06:00'), 'HMCL/TC/05/10/2026'), mkRow('R100', '2026-10-05', T('2026-10-05', '06:05'), 'HMCL/TC/05/10/2026-2'), mkRow('R100', '2026-10-05', T('2026-10-05', '06:07'), 'HMCL/TC/05/10/2026-3'));
  R.push(mkRow('R200', '2026-10-05', T('2026-10-05', '06:10'), 'HMCL/T2/05/10/2026'), mkRow('R200', '2026-10-05', T('2026-10-05', '06:12'), 'HMCL/T2/05/10/2026-2'), mkRow('R200', '2026-10-20', T('2026-10-20', '07:00'), 'HMCL/T2/20/10/2026'));
  R.push(mkRow(' r300 ', '2026-10-06', T('2026-10-06', '06:00'), 'K300A'), mkRow('R300', '2026-10-06', T('2026-10-06', '06:01'), 'K300B'), mkRow('r300', '2026-10-06', T('2026-10-06', '06:02'), 'K300C'));
  R.push(mkRow(null, '2026-10-07', T('2026-10-07', '06:00'), null), mkRow('', '2026-10-07', T('2026-10-07', '06:00'), 'K400A'), mkRow('   ', '2026-10-07', T('2026-10-07', '06:00'), null), mkRow(null, '2026-10-07', T('2026-10-07', '06:00'), 'K400B'));
  R.push(mkRow('R500', '2026-10-08', T('2026-10-08', '06:00'), null), mkRow('R500', '2026-10-08', T('2026-10-08', '06:00'), null), mkRow('R500', '2026-10-08', T('2026-10-08', '06:00'), 'K500'));
  R.push(mkRow('R600', null, T('2026-10-09', '06:00'), null), mkRow('R600', null, T('2026-10-09', '06:01'), 'K600A'), mkRow('R600', '2026-10-09', T('2026-10-09', '06:30'), 'K600B'));
  R.push(mkRow('R700', '2026-10-09', T('2026-10-09', '08:00'), 'K700A'), mkRow('R700', '2026-10-09', T('2026-10-09', '08:03'), 'K700B', { letter: '{"noticeId":"K700B","name":"TEST CUSTOMER R700","fine":500}', upload_batch: '11111111-1111-4111-8111-111111111111' }));
  for (let i = 0; i < 11; i++) R.push(mkRow('R8' + String(i).padStart(2, '0'), '2026-10-' + String(10 + i).padStart(2, '0'), T('2026-10-' + String(10 + i).padStart(2, '0'), '06:00'), 'K8' + i));
  R.push(mkRow('R900', '2026-10-10', T('2026-10-10', '09:00'), 'K900A'), mkRow('R900', '2026-10-10', T('2026-10-10', '09:01'), 'K900B'), mkRow('R901', '2026-10-10', T('2026-10-10', '09:02'), 'K901A'), mkRow('R901', '2026-10-10', T('2026-10-10', '09:03'), 'K901B'));
  return R;
};
// the model, written again: which notices stand and which go, by the rule in the file's header
const rk = r => String(r.ref == null ? '' : r.ref).trim().toUpperCase();
const cmp = (a, b) => {
  const da = a.notice_date, db = b.notice_date;
  if (da !== db) { if (da == null) return 1; if (db == null) return -1; return da < db ? -1 : 1; }
  const ta = Date.parse(a.created_at), tb = Date.parse(b.created_at); if (ta !== tb) return ta < tb ? -1 : 1;
  const na = a.notice_id == null, nb = b.notice_id == null; if (na !== nb) return na ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};
const model = (rows, mode) => {
  const groups = new Map(); let withRef = 0;
  for (const r of rows) { const k = rk(r); if (!k) continue; withRef++; const g = k + '|' + (mode === 'DAY' ? (r.notice_date == null ? '\u0000null' : r.notice_date) : ''); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  const removed = new Map(), reps = new Set();
  for (const g of groups.values()) { g.sort(cmp); for (let i = 1; i < g.length; i++) { removed.set(g[i].id, g[0].id); reps.add(rk(g[i])); } }
  const dates = new Map(); for (const r of rows) { const k = rk(r); if (!k || r.notice_date == null) continue; if (!dates.has(k)) dates.set(k, new Set()); dates.get(k).add(r.notice_date); }
  return { removed, reps: reps.size, withRef, left: withRef - removed.size, multiDay: [...dates.values()].filter(s => s.size > 1).length };
};

const dump = () => oneQuery("select coalesce(md5(string_agg(to_jsonb(d)::text, '|' order by d.id)), 'empty') from public.demand_notices d", DB).trim();
const ids = () => oneQuery("select coalesce(string_agg(id::text, ',' order by id), '') from public.demand_notices", DB).trim().split(',').filter(Boolean);
const backups = () => { try { return JSON.parse(oneQuery("select coalesce(json_agg(json_build_object('id', (notice->>'id'), 'kept', kept_id, 'label', label, 'text', notice::text) order by notice->>'id'), '[]') from public.demand_notices_removed", DB).trim()); } catch { return []; } };
const ledgerSum = () => oneQuery("select coalesce(md5(string_agg(to_jsonb(l)::text, '|' order by l.ref, l.payment_id)), 'empty') from public.notice_payment_ledger l", DB).trim();
let fails = 0; const need = (ok, msg) => { if (!ok) { fails++; console.log('  FAIL: ' + msg); } else console.log('  ok: ' + msg); };
// a text that fails with an SQL error is a FAILED check, never a crash of the harness
const run = sql => { try { return oneQuery(sql, DB).replace(/\n$/, '').split('\n').filter(Boolean).map(l => l.split('\t')); } catch (e) { fails++; console.log('  FAIL: the script ran with an SQL error: ' + String(e.stderr || e.message).split('\n')[0].slice(0, 140)); return [['SQL ERROR', 'SQL ERROR', '0', '0', '0', '0', '0']]; } };
const errOf = sql => { try { oneQuery(sql, DB); return null; } catch (e) { return String(e.stderr || e.message); } };
const reset = rows => { psqlTo('truncate public.demand_notices; truncate public.notice_payment_ledger; drop table if exists public.demand_notices_removed;', DB); if (rows.length) psqlTo(insertSql(rows), DB); };
const ledgerRows = "insert into public.notice_payment_ledger (ref, since, payment_id, paid_at, amount, matched_by) values ('R100', date '2026-10-05', '00000000-0000-4000-8000-0000000000aa', date '2026-10-06', 5000, 'ref'), ('R200', date '2026-10-20', '00000000-0000-4000-8000-0000000000bb', date '2026-10-21', 7000, 'phone');";
const dayRef = (rows, mode) => model(rows, mode);

console.log('=== shape');
if (!FAST) {
  need(FILE.length < 10000, 'the script is ' + FILE.length + ' characters (under 10,000)');
  need(!/^[ \t]/m.test(FILE), 'no line starts with a blank');
  need(/^[\x09\x0a\x20-\x7e]*$/.test(FILE), 'plain ASCII');
  need(FILE.trimEnd().split('\n').pop().startsWith('-- END OF THE SCRIPT'), 'ends with its END line');
}

const A = fixtureA();
const answerOf = (o, m) => ({ mode: o[0][0], result: o[0][1], withRef: +o[0][2], reps: +o[0][3], removed: +o[0][4], left: +o[0][5], multiDay: +o[0][6], m });
console.log('=== DAY (as sent)');
{
  reset(A); psqlTo(ledgerRows, DB);
  const rowsBefore = Object.fromEntries(oneQuery("select id::text, to_jsonb(d)::text from public.demand_notices d", DB).trim().split('\n').map(l => l.split('\t')));
  const ledgerBefore = ledgerSum(); const before = dump();
  const m = model(A, 'DAY'); const o = run(build('DAY')); const a = answerOf(o);
  console.log('    ' + o[0].join(' | '));
  const left = new Set(ids());
  need(A.every(r => m.removed.has(r.id) ? !left.has(r.id) : left.has(r.id)), 'exactly the notices the model removes are gone, every other stays (' + m.removed.size + ' removed)');
  need(a.mode === 'DAY' && a.result === 'DONE' && a.withRef === m.withRef && a.reps === m.reps && a.removed === m.removed.size && a.left === m.left && a.multiDay === m.multiDay, 'the answer: mode, DONE, ' + m.withRef + ' with a ref, ' + m.reps + ' refs with repeats, ' + m.removed.size + ' removed, ' + m.left + ' left, ' + m.multiDay + ' ref on more than one day');
  const b = backups();
  need(b.length === m.removed.size && b.every(x => m.removed.get(x.id) === x.kept && x.text === rowsBefore[x.id]), 'every removed notice is copied whole (same text, with its letter) with the id of the notice that stands');
  need(b.every(x => x.label === 'DUPLICATE NOTICES 20 NOV (SQL)'), 'the copies carry the label the undo asks for');
  need(ledgerSum() === ledgerBefore, 'the recoveries ledger is untouched');
  need(A.filter(r => !rk(r)).every(r => left.has(r.id)), 'notices with no ref are never touched');
  const after1 = dump(); const o2 = run(build('DAY'));
  need(+o2[0][4] === 0 && dump() === after1 && backups().length === m.removed.size, 'a second run: nothing to remove, nothing written');
  psqlTo('begin;\n' + undoOf(build('DAY')) + '\ncommit;\n', DB); need(dump() === before, 'the undo puts every notice back, byte for byte');
}
console.log('=== REF');
{
  reset(A); const before = dump(); const m = model(A, 'REF'); const o = run(build('REF')); const a = answerOf(o);
  console.log('    ' + o[0].join(' | '));
  const left = new Set(ids());
  need(A.every(r => m.removed.has(r.id) ? !left.has(r.id) : left.has(r.id)), 'exactly the notices the model removes are gone (' + m.removed.size + ' removed: later days too, the first notice of each ref stands)');
  need(a.mode === 'REF' && a.result === 'DONE' && a.removed === m.removed.size && a.left === m.left && a.reps === m.reps, 'the answer says REF and the model\'s counts');
  psqlTo('begin;\n' + undoOf(build('REF')) + '\ncommit;\n', DB); need(dump() === before, 'the undo puts every notice back, byte for byte');
}
console.log('=== DAY then REF in one book, then the undo');
{
  reset(A); const before = dump(); run(build('DAY')); run(build('REF'));
  const mR = model(A, 'REF'); const left = new Set(ids());
  need(A.every(r => mR.removed.has(r.id) ? !left.has(r.id) : left.has(r.id)), 'after DAY and then REF the book is what REF alone leaves');
  need(backups().length === mR.removed.size, 'the copies are every notice either run removed, once');
  psqlTo('begin;\n' + undoOf(build('REF')) + '\ncommit;\n', DB); need(dump() === before, 'one undo puts back everything both runs removed');
}
console.log('=== a word that is neither DAY nor REF');
{
  reset(A); const before = dump(); const o = run(build('day')); const b = dump();
  need(/^NOTHING DONE/.test(o[0][1]) && b === before && backups().length === 0, 'refused: the answer says NOTHING DONE, nothing is removed, nothing copied');
  const o2 = run(build('')); need(/^NOTHING DONE/.test(o2[0][1]) && dump() === before, 'an empty word is refused too');
}
console.log('=== a book with nothing to remove, and an empty book');
{
  const clean = A.filter((r, i) => i >= 20 && i < 31); reset(clean); const before = dump(); const o = run(build('DAY'));
  need(+o[0][4] === 0 && dump() === before, 'no repeats: nothing removed');
  reset([]); const o2 = run(build('DAY')); need(o2[0][1] === 'DONE' && +o2[0][4] === 0 && +o2[0][2] === 0, 'an empty table: DONE, zero everywhere');
}
if (!FAST) {
  console.log('=== cut texts: a notice is either removed with its copy or untouched');
  reset(A); const b0 = dump(); run(build('DAY')); const full = dump(); const fullCopies = backups().length;
  const S = build('DAY'); let cuts = 0, errs = 0, same = 0, done = 0; const bad = [];
  const pos = new Set(); for (let p = 40; p < S.length; p += 53) pos.add(p); S.split('\n').reduce((acc, l) => { acc += l.length + 1; pos.add(acc); pos.add(acc - 1); return acc; }, 0);
  for (const p of [...pos].sort((a, b) => a - b)) {
    if (p >= S.length) continue; reset(A); cuts++;
    const e = errOf(S.slice(0, p)); const d = dump(); const nb = backups().length;
    if (e) { errs++; if (d !== b0 || nb !== 0) bad.push(p + ' (errored but changed)'); } else if (d === b0) { same++; if (nb !== 0) bad.push(p + ' (copies without a removal)'); } else if (d === full && nb === fullCopies) done++; else bad.push(p + ' (partial)');
  }
  need(bad.length === 0, cuts + ' cut points: ' + errs + ' refused with an error, ' + same + ' ran without touching a notice, ' + done + ' ran to the end; partial changes: ' + bad.length);
  console.log('=== every line indented a little more than the one above');
  let a = 0; const stair = S.split('\n').map(l => { a += 1; return ' '.repeat(a % 300) + l; }).join('\n');
  reset(A); const o1 = run(S); const k1 = dump(); reset(A); const o2 = run(stair); need(JSON.stringify(o1) === JSON.stringify(o2) && dump() === k1, 'the indented copy answers and removes the same');
  console.log('=== a book a hundred times the live one');
  const BIG = []; seq = 0;
  for (let i = 0; i < 60000; i++) { const ref = 'B' + String(i).padStart(5, '0'); const day = 1 + (i % 28); const d = '2026-09-' + String(day).padStart(2, '0'); const reps = i % 3 === 0 ? 3 : 1;
    for (let k = 0; k < reps; k++) BIG.push(mkRow(i % 7 === 0 ? ref.toLowerCase() + ' ' : ref, k === 2 && i % 2 ? '2026-10-01' : d, T(d, '0' + (6 + k) + ':00'), 'BK' + i + '-' + k, { letter: i % 5 === 0 ? '{"x":1}' : null })); }
  for (let i = 0; i < 12000; i++) BIG.push(mkRow(null, '2026-09-01', T('2026-09-01', '06:00'), null));
  reset(BIG); const mb = model(BIG, 'DAY'); const t0 = Date.now(); const ob = run(build('DAY')); const ms = Date.now() - t0;
  need(+ob[0][4] === mb.removed.size && +ob[0][5] === mb.left && backups().length === mb.removed.size, BIG.length + ' notices: ' + mb.removed.size + ' removed as the model says, in ' + ms + ' ms');
}
try { psqlTo('drop database if exists ' + DB, admin); } catch {}
if (!MUT && !FAST) {
  console.log('=== BROKEN ON PURPOSE: every deliberate break of the file must make a check fail');
  const SELF = fileURLToPath(import.meta.url);
  let caught = 0; const missed = [];
  for (const [name, from, to] of BREAKS) {
    const r = spawnSync(process.execPath, [SELF], { env: { ...process.env, FAST: '1', MUT: JSON.stringify({ from, to }) }, encoding: 'utf8', maxBuffer: 1 << 26 });
    const out = (r.stdout || '') + (r.stderr || '');
    const fl = [...out.matchAll(/^  FAIL: (.*)$/gm)].map(x => x[1]).filter(x => !x.startsWith('the script ran with an SQL error'));
    if (/BAD BREAK/.test(out)) missed.push(name + ' (text not found once)'); else if (fl.length) caught++; else missed.push(name);
  }
  need(missed.length === 0, caught + ' of ' + BREAKS.length + ' deliberate breaks of the file each fail a check' + (missed.length ? ' -- NOT CAUGHT: ' + missed.join('; ') : ''));
}
console.log(fails ? '\n' + fails + ' FAILURE(S)' : '\nOK');
process.exit(fails ? 1 : 0);
