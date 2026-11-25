/* THE REMOVAL OF REPEATED PMO DEDUCTION CASES -- db/RUN-ME-091, run for real on a PostgreSQL.

     "[a reporter] pressed multiple times at submitting deduction case and deductions went so many (16) so we must delete all unique rows in the
      existing deductions bro and prevent such an issue in the future" -- the owner, 25 Nov 2026 (the name is the owner's word; no name is kept here)

   db/RUN-ME-091-remove-repeated-deduction-cases.sql DELETES DATA on the owner's live book, from a register HR deducts salaries by and the reporters are paid per case by, so it is
   not believed on a reading. It compares CASES (a case_id, or a lone line with none) by what every line says (reporter, team, customer, REF NO, staff, amounts, dates, decision; blanks at
   the ends aside), keeps ONE case of each group of repeats (the one HR has recorded on, else the one saved first), never removes a case HR has recorded on, copies every removed line whole
   to pmo_deductions_removed and deletes it, in one statement. The word on its CHANGE line is PRESS (the default: repeats saved within 30 minutes of the case that stays), ANY (every repeat)
   or COUNT (nothing is changed; the answer says what the two would remove). Anything else is refused.

   THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database. The fixture knows the truth: sixteen presses of one line (the 25 Nov export), a three-staff case saved
   twice with its lines in another order, the same case two days later, an HR-recorded copy saved AFTER the plain one (it stays, the plain one goes), an HR-recorded copy saved hours after
   the plain one (nothing goes: not a double press), two HR-recorded copies (nothing goes), HR recorded in each of its five columns on its own, a different amount, another reporter, blanks
   at the ends of the words, sheet lines with no case id, a case with the same staff twice, a case with only one of those lines, a book of singletons.

   It passes only when: COUNT changes nothing and its numbers equal a MODEL written again in JavaScript; PRESS and ANY leave EXACTLY the lines the model leaves and answer its numbers; every
   removed line is in pmo_deductions_removed whole (the same jsonb text) with the case that stays; a second run removes nothing and writes nothing; the undo at the foot puts every line back
   byte for byte; a word that is not PRESS, ANY or COUNT removes and copies nothing; a text CUT at many places either fails or finishes (never a line removed without its copy); the same text
   with every line indented answers and removes the same; a book of 90,000 lines is run against the model; and every deliberate break of the file makes a check fail (an SQL error alone does
   not count as caught).

       PGHOST=/var/run/postgresql PGUSER=postgres node tools/db-checks/deduction-repeats.mjs

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(ROOT + '/db/RUN-ME-091-remove-repeated-deduction-cases.sql', 'utf8');
const DB = 'hope_dedrepeats';
const admin = process.env.PGDATABASE || 'postgres';
const env = process.env;
const PIPES = ['pipe', 'pipe', 'pipe'];
const psqlTo = (sql, db) => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: sql, env, encoding: 'utf8', maxBuffer: 1 << 28, stdio: PIPES });
const oneQuery = (sql, db) => execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-c', sql], { env, encoding: 'utf8', maxBuffer: 1 << 28, stdio: PIPES });
const HR = "(d.hr_at is not null or d.hr_by is not null or coalesce(d.deducted, 0) <> 0 or coalesce(d.remaining, 0) <> 0 or nullif(btrim(coalesce(d.hr_notes, '')), '') is not null)";
const KEEP = 'order by c.hr desc, c.at, c.ck';
const SAVED = "select 'REPEATED DEDUCTION CASES 25 NOV (SQL)', x.keep_ck, to_jsonb(d)";
const BREAKS = [
  ['a case HR recorded on can be removed', 'where not f.hr and ((c.mode', 'where ((c.mode'],
  ['the case HR recorded on does not stay in preference to the earlier plain one', KEEP, 'order by c.at, c.ck'],
  ['the LAST saved case stays instead of the first', KEEP, 'order by c.hr desc, c.at desc, c.ck'],
  ['the double-press window is two days', '<= 1800 as press', '<= 172800 as press'],
  ['the window is not applied (every repeat is a double press)', '<= 1800 as press', '<= 1800 or true as press'],
  ['the window reads a negative gap as inside it (no abs)', 'abs(extract(epoch from (r.at - r.keep_at)))', 'extract(epoch from (r.at - r.keep_at))'],
  ['blanks at the ends of the customer are compared', "btrim(coalesce(d.customer, ''))", "coalesce(d.customer, '')"],
  ['blanks at the ends of the decision are compared', "btrim(coalesce(d.decision, ''))", "coalesce(d.decision, '')"],
  ['the reporter is not compared', "btrim(coalesce(d.reporter, '')), ", ''],
  ['the team is not compared', "btrim(coalesce(d.team, '')), ", ''],
  ['the customer is not compared', "btrim(coalesce(d.customer, '')), ", ''],
  ['the REF NO is not compared', "btrim(coalesce(d.ref, '')), ", ''],
  ['the accused staff is not compared', "btrim(coalesce(d.staff, '')), ", ''],
  ['the amount taken is not compared', "coalesce(d.amount_taken::text, ''), ", ''],
  ['the two dates are not compared', "coalesce(d.received_date::text, ''), coalesce(d.discovery_date::text, ''), ", ''],
  ['the decision is not compared', "btrim(coalesce(d.decision, '')), ", ''],
  ['the deduction is not compared', "coalesce(d.deduction::text, ''), ", ''],
  ['the amount to pay is not compared', ", coalesce(d.to_pay::text, ''))", ')'],
  ['the lines of a case are compared in the order they were stored', 'order by l.txt)', ')'],
  ['a line is its own case (the case id is ignored)', 'coalesce(d.case_id, d.id::text) as ck', 'd.id::text as ck'],
  ['HR is recognised by hr_at alone', HR, '(d.hr_at is not null)'],
  ['HR notes are not HR', "or nullif(btrim(coalesce(d.hr_notes, '')), '') is not null", ''],
  ['a deducted amount is not HR', 'or coalesce(d.deducted, 0) <> 0 ', ''],
  ['a remaining amount is not HR', 'or coalesce(d.remaining, 0) <> 0 ', ''],
  ['hr_by is not HR', 'or d.hr_by is not null ', ''],
  ['COUNT removes like ANY', "or c.mode = 'ANY')", "or c.mode in ('ANY', 'COUNT'))"],
  ['a word that is not PRESS, ANY or COUNT removes like ANY', "or c.mode = 'ANY')", "or c.mode <> 'PRESS')"],
  ['the word is not validated in the answer', "when c.mode in ('PRESS', 'ANY') then 'DONE'", "else 'DONE'"],
  ['no copy is taken', 'from doomed x join public.pmo_deductions d on coalesce(d.case_id, d.id::text) = x.ck\nreturning kept_case', 'from doomed x join public.pmo_deductions d on coalesce(d.case_id, d.id::text) = x.ck where false\nreturning kept_case'],
  ['the copy holds only the id', 'to_jsonb(d)', "jsonb_build_object('id', d.id)"],
  ['the copy carries another label', SAVED, "select 'OTHER LABEL', x.keep_ck, to_jsonb(d)"],
  ['the copy names the wrong case as the one that stays', SAVED, "select 'REPEATED DEDUCTION CASES 25 NOV (SQL)', x.ck, to_jsonb(d)"],
  ['the undo asks for another label', "where x.label = 'REPEATED DEDUCTION CASES 25 NOV (SQL)'", "where x.label = 'NOPE'"],
  ['every line of the book is deleted (no join)', 'delete from public.pmo_deductions d using doomed x where coalesce(d.case_id, d.id::text) = x.ck returning d.id', 'delete from public.pmo_deductions d using doomed x where true returning d.id'],
  ['the case that stays is named wrongly (last_value)', 'first_value(c.ck) over w as keep_ck', 'last_value(c.ck) over w as keep_ck'],
  ['the lines left are not worked out', '(select count(*) from lines) - (select count(*) from gone)', '(select count(*) from lines)'],
  ['the answer counts every repeat as kept for HR', '(select count(*) from repeats where hr) as kept_because_hr_recorded', '(select count(*) from repeats) as kept_because_hr_recorded'],
  ['the answer counts the double presses wrongly', '(select count(*) from repeats where not hr and press) as press_removes', '(select count(*) from repeats where press) as press_removes'],
  ['the singleton is compared too (rn > 1 becomes rn >= 1)', 'from ranked r where r.rn > 1', 'from ranked r where r.rn >= 1'],
];
const MUT = process.env.MUT ? JSON.parse(process.env.MUT) : null;
const FAST = !!process.env.FAST;
if (MUT && FILE.split(MUT.from).length !== 2) { console.log('BAD BREAK: not found once: ' + MUT.from.slice(0, 80)); process.exit(3); }
const build = mode => { let t = FILE.replace("'PRESS'::text as mode", "'" + mode + "'::text as mode"); if (MUT) t = t.replace(MUT.from, () => MUT.to); return t; };
const undoOf = t => t.split('\n').filter(l => /^-- insert into/.test(l)).map(l => l.replace(/^-- /, '')).join('\n');
const q = s => s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'";

try { psqlTo('drop database if exists ' + DB, admin); } catch {}
psqlTo('create database ' + DB + " template template0 encoding 'UTF8'", admin);
psqlTo(fs.readFileSync(ROOT + '/db/schema.sql', 'utf8'), DB);

// ---- the fixture: lines of the real table. Every name is made up.
let seq = 0;
const uid = () => { seq++; return '00000000-0000-4000-8000-' + seq.toString(16).padStart(12, '0'); };
const T = (d, hms) => d + 'T' + hms + 'Z';
const BASE = { dept: 'RECOVERY', reporter: 'REP A', team: 'TEAM A', customer: 'CUST ONE', ref: '4230000001', received_date: '2026-11-23', discovery_date: '2026-11-25', decision: 'Maamuzi ya kikao',
  deduction: 120000, to_pay: 0, hr_notes: null, deducted: null, remaining: null, hr_by: null, hr_at: null, created_by: 'REP A' };
const L = (ck, at, staff, taken, over = {}) => ({ id: uid(), case_id: ck, submitted_at: at, created_at: at, ...BASE, staff, amount_taken: taken, ...over });
const HRX = { hr_notes: 'Kata Novemba', deducted: 5000, remaining: 0, hr_by: 'HR ONE', hr_at: T('2026-11-26', '08:00:00') };
const fixture = () => {
  seq = 0; const R = [];
  // 1. the sixteen presses of 25 Nov: one line each, identical, three seconds apart
  for (let i = 0; i < 16; i++) R.push(L('p' + String(i).padStart(2, '0'), T('2026-11-25', '12:22:' + String(i * 3).padStart(2, '0')), 'STAFF X', 1500));
  // 2. a three-staff case saved twice, the second time with its lines in another order
  const M = (ck, at, order) => order.forEach(([s, t]) => R.push(L(ck, at, s, t, { customer: 'CUST TWO', ref: '4230000002', deduction: 50000 })));
  M('m1', T('2026-11-24', '16:35:00'), [['STAFF A', 111000], ['STAFF B', 0], ['STAFF C', 0]]);
  M('m2', T('2026-11-24', '16:35:40'), [['STAFF C', 0], ['STAFF A', 111000], ['STAFF B', 0]]);
  // 3. the sixteen-press case again, two days later (a repeat, but not a double press)
  R.push(L('later', T('2026-11-27', '09:00:00'), 'STAFF X', 1500));
  // 4. an HR-recorded copy saved AFTER the plain one (the HR one stays)
  R.push(L('h1', T('2026-11-20', '10:00:00'), 'STAFF H', 10, { customer: 'CUST H', ref: '4230000003' }));
  R.push(L('h2', T('2026-11-20', '10:00:10'), 'STAFF H', 10, { customer: 'CUST H', ref: '4230000003', ...HRX }));
  // 5. an HR-recorded copy saved HOURS after the plain one: the plain one is not a double press, so it stays
  R.push(L('hl1', T('2026-11-19', '10:00:00'), 'STAFF HL', 10, { customer: 'CUST HL', ref: '4230000004' }));
  R.push(L('hl2', T('2026-11-19', '13:00:00'), 'STAFF HL', 10, { customer: 'CUST HL', ref: '4230000004', ...HRX }));
  // 6. two copies, both HR-recorded: nothing goes
  R.push(L('hb1', T('2026-11-18', '10:00:00'), 'STAFF HB', 10, { customer: 'CUST HB', ref: '4230000005', ...HRX }));
  R.push(L('hb2', T('2026-11-18', '10:00:05'), 'STAFF HB', 10, { customer: 'CUST HB', ref: '4230000005', ...HRX }));
  // 7. HR recorded in ONE column only, on the later copy: each is still HR
  [['n', { hr_notes: 'tu maelezo' }], ['d', { deducted: 700 }], ['r', { remaining: 300 }], ['b', { hr_by: 'HR TWO' }], ['a', { hr_at: T('2026-11-26', '09:00:00') }], ['w', { hr_notes: '   ' }]].forEach(([k, x], i) => {
    R.push(L('o' + k + '1', T('2026-11-17', '10:00:0' + i), 'STAFF O' + k, 10, { customer: 'CUST O' + k, ref: '42300001' + k }));
    R.push(L('o' + k + '2', T('2026-11-17', '10:00:3' + i), 'STAFF O' + k, 10, { customer: 'CUST O' + k, ref: '42300001' + k, ...x }));
  });
  // 8. different in one thing: not repeats (amount; reporter; a staff; the decision; a date; the deduction; the amount to pay; the team; the customer; the REF NO)
  R.push(L('n1', T('2026-11-25', '12:25:00'), 'STAFF X', 1501));
  R.push(L('n2', T('2026-11-25', '12:25:05'), 'STAFF X', 1500, { reporter: 'REP B' }));
  R.push(L('n3', T('2026-11-25', '12:25:10'), 'STAFF Y', 1500));
  R.push(L('n4', T('2026-11-25', '12:25:15'), 'STAFF X', 1500, { decision: 'Maamuzi ya kikao.' }));
  R.push(L('n5', T('2026-11-25', '12:25:20'), 'STAFF X', 1500, { discovery_date: '2026-11-24' }));
  R.push(L('n6', T('2026-11-25', '12:25:25'), 'STAFF X', 1500, { deduction: 120001 }));
  R.push(L('n7', T('2026-11-25', '12:25:30'), 'STAFF X', 1500, { to_pay: 1 }));
  R.push(L('n8', T('2026-11-25', '12:25:35'), 'STAFF X', 1500, { team: 'TEAM B' }));
  R.push(L('n9', T('2026-11-25', '12:25:40'), 'STAFF X', 1500, { customer: 'CUST ONE X' }));
  R.push(L('n10', T('2026-11-25', '12:25:45'), 'STAFF X', 1500, { ref: '4230000099' }));
  // 9. blanks at the ends of the words: the same case
  R.push(L('t1', T('2026-11-25', '12:30:00'), ' STAFF X ', 1500, { customer: ' CUST ONE ', decision: 'Maamuzi ya kikao  ', reporter: ' REP A', team: 'TEAM A ', ref: ' 4230000001' }));
  // 10. lines with no case id (the register from the sheet): two the same at the same instant, two three days apart
  R.push(L(null, T('2026-11-10', '08:00:00'), 'STAFF S', 100, { customer: 'CUST S', ref: '4230000006' }), L(null, T('2026-11-10', '08:00:00'), 'STAFF S', 100, { customer: 'CUST S', ref: '4230000006' }));
  R.push(L(null, T('2026-11-10', '08:00:00'), 'STAFF S2', 100, { customer: 'CUST S2', ref: '4230000007' }), L(null, T('2026-11-13', '08:00:00'), 'STAFF S2', 100, { customer: 'CUST S2', ref: '4230000007' }));
  // 11. the same staff twice in one case; the same again as another case (a repeat); a case with only one of those lines (not a repeat)
  const W = (ck, at, n) => { for (let i = 0; i < n; i++) R.push(L(ck, at, 'STAFF W', 10, { customer: 'CUST W', ref: '4230000008' })); };
  W('w1', T('2026-11-16', '10:00:00'), 2); W('w2', T('2026-11-16', '10:00:20'), 2); W('w3', T('2026-11-16', '10:00:40'), 1);
  // 12. singletons
  for (let i = 0; i < 12; i++) R.push(L('s' + i, T('2026-11-' + String(1 + i).padStart(2, '0'), '07:00:00'), 'STAFF Z' + i, 10 + i, { customer: 'CUST Z' + i, ref: '42399' + i }));
  return R;
};
const COLS = ['id', 'case_id', 'submitted_at', 'dept', 'reporter', 'team', 'customer', 'ref', 'staff', 'amount_taken', 'received_date', 'discovery_date', 'decision', 'deduction', 'to_pay', 'hr_notes', 'deducted', 'remaining', 'hr_by', 'hr_at', 'created_by', 'created_at'];
const insertSql = rows => {
  const out = [];
  for (let i = 0; i < rows.length; i += 2000) out.push('insert into public.pmo_deductions (' + COLS.join(', ') + ') values\n' + rows.slice(i, i + 2000).map(r => '(' + COLS.map(c => { const v = r[c]; return typeof v === 'number' ? v : q(v); }).join(', ') + ')').join(',\n') + ';');
  return out.join('\n');
};
// ---- the model, written again: which lines go, by the rule in the file's header
const txt = r => [r.reporter, r.team, r.customer, r.ref, r.staff].map(v => String(v == null ? '' : v).trim()).concat([
  r.amount_taken == null ? '' : Number(r.amount_taken).toFixed(2), r.received_date || '', r.discovery_date || '', String(r.decision == null ? '' : r.decision).trim(),
  r.deduction == null ? '' : Number(r.deduction).toFixed(2), r.to_pay == null ? '' : Number(r.to_pay).toFixed(2)]).join('\u001f');
const isHr = r => !!(r.hr_at || r.hr_by || Number(r.deducted || 0) !== 0 || Number(r.remaining || 0) !== 0 || String(r.hr_notes == null ? '' : r.hr_notes).trim() !== '');
const model = (rows, mode) => {
  const cases = new Map();
  for (const r of rows) { const k = r.case_id == null ? r.id : r.case_id; if (!cases.has(k)) cases.set(k, []); cases.get(k).push(r); }
  const info = [...cases.entries()].map(([ck, ls]) => ({ ck, ls, at: Math.min(...ls.map(l => Date.parse(l.submitted_at))), hr: ls.some(isHr), sig: ls.map(txt).sort().join('\u001e') }));
  const bySig = new Map(); for (const c of info) { if (!bySig.has(c.sig)) bySig.set(c.sig, []); bySig.get(c.sig).push(c); }
  const repeats = [], tieGroups = [];
  for (const g of bySig.values()) {
    g.sort((a, b) => (b.hr - a.hr) || (a.at - b.at) || (a.ck < b.ck ? -1 : 1));
    const keep = g[0]; if (g.length > 1 && g.slice(1).some(c => c.at === keep.at && c.hr === keep.hr)) tieGroups.push(g.map(c => c.ck));
    for (const c of g.slice(1)) repeats.push({ ...c, keep: keep.ck, press: Math.abs(c.at - keep.at) / 1000 <= 1800 });
  }
  const doomed = repeats.filter(c => !c.hr && (mode === 'ANY' || (mode === 'PRESS' && c.press)));
  const lines = new Set(doomed.flatMap(c => c.ls.map(l => l.id)));
  return { doomed, lines, cases: info.length, repeats: repeats.length, pressRemoves: repeats.filter(c => !c.hr && c.press).length, anyRemoves: repeats.filter(c => !c.hr).length,
    hrKept: repeats.filter(c => c.hr).length, removedCases: doomed.length, left: rows.length - lines.size, tieGroups };
};
const dump = () => oneQuery("select coalesce(md5(string_agg(to_jsonb(d)::text, '|' order by d.id)), 'empty') from public.pmo_deductions d", DB).trim();
const ids = () => oneQuery("select coalesce(string_agg(id::text, ',' order by id), '') from public.pmo_deductions", DB).trim().split(',').filter(Boolean);
const backups = () => { try { return JSON.parse(oneQuery("select coalesce(json_agg(json_build_object('id', (line->>'id'), 'kept', kept_case, 'label', label, 'text', line::text) order by line->>'id'), '[]') from public.pmo_deductions_removed", DB)); } catch { return []; } };
let fails = 0; const need = (ok, msg) => { if (!ok) { fails++; console.log('  FAIL: ' + msg); } else console.log('  ok: ' + msg); };
const run = sql => { try { return oneQuery(sql, DB).replace(/\n$/, '').split('\n').filter(Boolean).map(l => l.split('\t')); } catch (e) { fails++; console.log('  FAIL: the script ran with an SQL error: ' + String(e.stderr || e.message).split('\n')[0]); return [['', 'ERROR', 0, 0, 0, 0, 0, 0, 0, 0]]; } };
const errOf = sql => { try { oneQuery(sql, DB); return null; } catch (e) { return String(e.stderr || e.message); } };
const reset = rows => { psqlTo('truncate public.pmo_deductions; drop table if exists public.pmo_deductions_removed;', DB); if (rows.length) psqlTo(insertSql(rows), DB); };
const ans = o => ({ mode: o[0][0], result: o[0][1], cases: +o[0][2], repeats: +o[0][3], press: +o[0][4], any: +o[0][5], hr: +o[0][6], removedCases: +o[0][7], lines: +o[0][8], left: +o[0][9] });
const answerIs = (a, m, mode) => a.mode === mode && a.cases === m.cases && a.repeats === m.repeats && a.press === m.pressRemoves && a.any === m.anyRemoves && a.hr === m.hrKept;

console.log('=== shape');
if (!FAST) {
  need(FILE.length < 10000, 'the script is ' + FILE.length + ' characters (under 10,000)');
  need(!/^[ \t]/m.test(FILE), 'no line starts with a blank');
  need(/^[\x09\x0a\x20-\x7e]*$/.test(FILE), 'plain ASCII');
  need(FILE.trimEnd().split('\n').pop().startsWith('-- END OF THE SCRIPT'), 'ends with its END line');
}
const A = fixture();
const survivors = (rows, m) => { const left = new Set(ids()); return rows.every(r => m.lines.has(r.id) ? !left.has(r.id) : left.has(r.id)); };
console.log('=== the model\'s own reading of the fixture');
{
  const mP = model(A, 'PRESS'), mA = model(A, 'ANY');
  console.log('    cases ' + mP.cases + ', repeat cases ' + mP.repeats + ', PRESS removes ' + mP.pressRemoves + ', ANY removes ' + mP.anyRemoves + ', kept for HR ' + mP.hrKept);
  need(mP.pressRemoves > 15 && mA.anyRemoves > mP.pressRemoves && mP.hrKept >= 1, 'the fixture has the kinds of row the checks need (sixteen presses, repeats at other times, HR-recorded repeats)');
}
console.log('=== COUNT: nothing changes, the answer says what PRESS and ANY would remove');
{
  reset(A); const before = dump(); const m = model(A, 'COUNT'); const o = run(build('COUNT')); const a = ans(o);
  console.log('    ' + o[0].join(' | '));
  need(dump() === before && backups().length === 0, 'not one line changed, nothing copied');
  need(a.result === 'COUNTED: nothing was changed' && answerIs(a, m, 'COUNT') && a.removedCases === 0 && a.lines === 0 && a.left === A.length, 'the answer: COUNTED, the model\'s numbers, nothing removed');
}
console.log('=== PRESS (as sent)');
{
  reset(A);
  const rowsBefore = Object.fromEntries(oneQuery("select id::text, to_jsonb(d)::text from public.pmo_deductions d", DB).trim().split('\n').map(l => l.split('\t')));
  const before = dump(); const m = model(A, 'PRESS'); const o = run(build('PRESS')); const a = ans(o);
  console.log('    ' + o[0].join(' | '));
  need(survivors(A, m), 'exactly the lines the model removes are gone, every other stays (' + m.lines.size + ' lines of ' + m.removedCases + ' cases)');
  need(a.result === 'DONE' && answerIs(a, m, 'PRESS') && a.removedCases === m.removedCases && a.lines === m.lines.size && a.left === m.left, 'the answer: DONE and the model\'s numbers');
  const b = backups();
  need(b.length === m.lines.size && b.every(x => x.text === rowsBefore[x.id]), 'every removed line is copied whole (the same jsonb text)');
  const keepOf = new Map(m.doomed.flatMap(c => c.ls.map(l => [l.id, c.keep]))), ties = new Set(m.tieGroups.flat());
  const ckOf = x => { const j = JSON.parse(x.text); return j.case_id == null ? j.id : j.case_id; };
  need(b.every(x => x.label === 'REPEATED DEDUCTION CASES 25 NOV (SQL)') && b.filter(x => !ties.has(ckOf(x))).every(x => keepOf.get(x.id) === x.kept), 'the copies carry the label the undo asks for and name the case that stays (groups that tie on time and HR keep one of them: the check asks only that one stays)');
  const left = new Set(ids());
  need(A.filter(r => isHr(r)).every(r => left.has(r.id)), 'every line HR recorded on is still there');
  need(A.filter(r => /^p\d\d$/.test(r.case_id || '')).filter(r => left.has(r.id)).length === 1 && left.has(A.find(r => r.case_id === 'p00').id), 'of the sixteen presses ONE stays: the first');
  need(left.has(A.find(r => r.case_id === 'later').id), 'the same case two days later stays (not a double press)');
  need(left.has(A.find(r => r.case_id === 'hl1').id) && left.has(A.find(r => r.case_id === 'hl2').id), 'a plain copy hours before an HR-recorded one stays (not a double press)');
  need(!left.has(A.find(r => r.case_id === 'h1').id) && left.has(A.find(r => r.case_id === 'h2').id), 'a plain copy seconds before an HR-recorded one goes, the HR one stays');
  need(A.filter(r => ['m1', 'm2'].includes(r.case_id)).filter(r => left.has(r.id)).length === 3, 'the three-staff case saved twice (lines in another order) is one case of three lines');
  need(A.filter(r => ['w1', 'w2', 'w3'].includes(r.case_id)).filter(r => left.has(r.id)).length === 3, 'the case with the same staff twice: its repeat goes, the case with one such line is another case (3 lines left of 5)');
  const after1 = dump(); const o2 = run(build('PRESS'));
  need(+o2[0][7] === 0 && dump() === after1 && backups().length === m.lines.size, 'a second run: nothing to remove, nothing written');
  psqlTo('begin;\n' + undoOf(build('PRESS')) + '\ncommit;\n', DB); need(dump() === before, 'the undo puts every line back, byte for byte');
}
console.log('=== ANY');
{
  reset(A); const before = dump(); const m = model(A, 'ANY'); const o = run(build('ANY')); const a = ans(o);
  console.log('    ' + o[0].join(' | '));
  need(survivors(A, m), 'exactly the lines the model removes are gone (' + m.lines.size + ' lines of ' + m.removedCases + ' cases: the repeats at other times too)');
  need(a.result === 'DONE' && answerIs(a, m, 'ANY') && a.removedCases === m.removedCases && a.left === m.left, 'the answer: DONE and the model\'s numbers');
  const left = new Set(ids());
  need(!left.has(A.find(r => r.case_id === 'later').id), 'the same case two days later goes');
  need(!left.has(A.find(r => r.case_id === 'hl1').id) && left.has(A.find(r => r.case_id === 'hl2').id), 'the plain copy hours before an HR-recorded one goes (ANY has no time limit), the HR-recorded one stays');
  need(A.filter(r => isHr(r)).every(r => left.has(r.id)), 'every line HR recorded on is still there');
  psqlTo('begin;\n' + undoOf(build('ANY')) + '\ncommit;\n', DB); need(dump() === before, 'the undo puts every line back, byte for byte');
}
console.log('=== PRESS then ANY in one book, then the undo');
{
  reset(A); const before = dump(); run(build('PRESS')); run(build('ANY'));
  const mA = model(A, 'ANY'); need(survivors(A, mA), 'after PRESS and then ANY the book is what ANY alone leaves');
  need(backups().length === mA.lines.size, 'the copies are every line either run removed, once');
  psqlTo('begin;\n' + undoOf(build('ANY')) + '\ncommit;\n', DB); need(dump() === before, 'one undo puts back everything both runs removed');
}
console.log('=== a word that is not PRESS, ANY or COUNT');
{
  reset(A); const before = dump(); const o = run(build('press')); const b = dump();
  need(/^NOTHING DONE/.test(o[0][1]) && b === before && backups().length === 0, 'refused: the answer says NOTHING DONE, nothing is removed, nothing copied');
  const o2 = run(build('')); need(/^NOTHING DONE/.test(o2[0][1]) && dump() === before, 'an empty word is refused too');
}
console.log('=== a book with nothing to remove, and an empty book');
{
  const clean = A.filter(r => /^s\d+$/.test(r.case_id || '')); reset(clean); const before = dump(); const o = run(build('ANY'));
  need(+o[0][7] === 0 && dump() === before, 'no repeats: nothing removed');
  reset([]); const o2 = run(build('PRESS')); need(o2[0][1] === 'DONE' && +o2[0][2] === 0 && +o2[0][7] === 0, 'an empty table: DONE, zero everywhere');
}
if (!FAST) {
  console.log('=== cut texts: a line is either removed with its copy or untouched');
  reset(A); const b0 = dump(); run(build('PRESS')); const full = dump(); const fullCopies = backups().length;
  const S = build('PRESS'); let cuts = 0, errs = 0, same = 0, done = 0; const bad = [];
  const pos = new Set(); for (let p = 40; p < S.length; p += 97) pos.add(p); S.split('\n').reduce((acc, l) => { acc += l.length + 1; pos.add(acc); pos.add(acc - 1); return acc; }, 0);
  for (const p of [...pos].sort((a, b) => a - b)) {
    if (p >= S.length) continue; reset(A); cuts++;
    const e = errOf(S.slice(0, p)); const d = dump(); const nb = backups().length;
    if (e) { errs++; if (d !== b0 || nb !== 0) bad.push(p + ' (errored but changed)'); } else if (d === b0) { same++; if (nb !== 0) bad.push(p + ' (copies without a removal)'); } else if (d === full && nb === fullCopies) done++; else bad.push(p + ' (a partial change)');
  }
  need(bad.length === 0, cuts + ' cut points: ' + errs + ' refused with an error, ' + same + ' ran without touching a line, ' + done + ' ran to the end; partial changes: ' + bad.length);
  console.log('=== every line indented a little more than the one above');
  let a = 0; const stair = S.split('\n').map(l => { a += 1; return ' '.repeat(a % 300) + l; }).join('\n');
  reset(A); const o1 = run(S); const k1 = dump(); reset(A); const o2 = run(stair); need(JSON.stringify(o1) === JSON.stringify(o2) && dump() === k1, 'the indented copy answers and removes the same');
  console.log('=== a book a hundred times the live one');
  const BIG = []; seq = 0;
  for (let i = 0; i < 30000; i++) {
    const ref = 'B' + String(i).padStart(5, '0'), day = '2026-10-' + String(1 + (i % 28)).padStart(2, '0'), reps = i % 4 === 0 ? 3 : 1;
    for (let k = 0; k < reps; k++) for (let s = 0; s < 1 + (i % 3); s++) BIG.push(L('b' + i + '-' + k, T(day, '10:0' + k + ':00'), 'STAFF ' + s, 100 * (s + 1), { customer: 'C ' + ref, ref, hr_notes: k === 1 && i % 8 === 0 ? 'HR' : null }));
  }
  reset(BIG); const mb = model(BIG, 'PRESS'); const t0 = Date.now(); const ob = run(build('PRESS')); const ms = Date.now() - t0; const ab = ans(ob);
  need(ab.removedCases === mb.removedCases && ab.lines === mb.lines.size && ab.left === mb.left && backups().length === mb.lines.size, BIG.length + ' lines: ' + mb.removedCases + ' cases (' + mb.lines.size + ' lines) removed as the model says, in ' + ms + ' ms');
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
