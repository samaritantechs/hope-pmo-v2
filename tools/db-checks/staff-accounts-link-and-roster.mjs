/* THE LINK OF REQUESTS TO A REGISTRY NAME AND THE ROSTER ALIGNMENT: db/TEMPLATE-link-advance-requests-by-registry-name.sql and db/TEMPLATE-call-agents-roster-to-registry.sql, run for real on a PostgreSQL
   (docs/HANDOFF.md Part 110).

     "the missing account numbers at advance salary tabs automatically fill themselves? ... finance manager is pulling that report and needs the column filled" -- the owner, 17 Nov 2026

   The first writes the staff ID of a payroll request, the second the names of the call-agents roster the loans are counted by: a request linked to the wrong person pays the wrong account, a roster row
   rewritten wrongly puts an agent's loans on nobody. Neither is believed on a reading.

   THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database (staff_registry and advance_requests have the live book's columns and types) and a call_agents table declared by hand: no SQL
   file of the repository creates it (the portal reads and writes user_id and names, text, and updated_at; test/advance-blanks.test.mjs pins that). No real name or staff ID is in this file.
   For each file it passes only when the answer and the tables afterwards EQUAL a MODEL written again in JavaScript (the link in six situations: normal, two Active records of the name, an Inactive record,
   no word in common, a word one letter apart, nothing to link; the roster over names on one or several rows, separated by commas and semicolons, a tab, a name twice in a row, blanks inside a name, an
   empty roster, an Inactive record, two records), a second run changes nothing, the undo (run from the file's own comment lines) restores every row, and the log or the copies are kept; and EVERY ONE of a list
   of deliberate breaks of each file changes an answer.

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/staff-accounts-link-and-roster.mjs

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the files do what they say, and fail when broken. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SCHEMA = rd('db/schema.sql');
const DB = 'hope_staff_link_roster';
const admin = process.env.PGDATABASE || 'postgres';
const env = { ...process.env, PGHOST: process.env.PGHOST || '/var/run/postgresql', PGUSER: process.env.PGUSER || 'postgres' };
const psqlTo = (sql, db) => {
  try { return execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: sql, env, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error('psql failed: ' + String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 3).join(' | ')); }
};
const psqlIn = sql => psqlTo(sql, DB);
const lines = out => out.replace(/\n$/, '').split('\n').filter(l => l !== '');
const run = text => lines(psqlIn('begin;\n' + text + '\ncommit;\n')).map(l => l.split('\t'));
let failures = 0;
const need = (ok, msg) => { if (!ok) { failures++; console.log('  FAIL: ' + msg); } };
const same = (a, b, msg) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) { failures++; console.log('  FAIL: ' + msg + '\n    got      ' + x.slice(0, 1600) + '\n    expected ' + y.slice(0, 1600)); } };
const C2 = rd('db/TEMPLATE-link-advance-requests-by-registry-name.sql'), E0 = rd('db/TEMPLATE-call-agents-roster-to-registry.sql');

const lit = v => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const uid = i => '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
const K = s => String(s == null ? '' : s).toUpperCase().replace(/['`\u2019]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
const lcp = (x, y) => { let g = 0; while (g < Math.min(x.length, y.length) && x[g] === y[g]) g++; return g; };
const lcs = (x, y) => { let g = 0; while (g < Math.min(x.length, y.length) && x[x.length - 1 - g] === y[y.length - 1 - g]) g++; return g; };
const nearW = (x, y) => x.length >= 3 && y.length >= 3 && Math.abs(x.length - y.length) <= 1 && lcp(x, y) + lcs(x, y) >= Math.max(x.length, y.length) - 1;
const live = st => String(st == null ? '' : st).trim().toUpperCase() !== 'INACTIVE';
const S = (id, name, extra = {}) => ({ id, name, role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', ...extra });
const reset = () => psqlIn('truncate public.staff_registry, public.advance_requests, public.call_agents; drop table if exists public.advance_requests_link_log; drop table if exists public.call_agents_names_before;');
const insReg = reg => psqlIn('insert into public.staff_registry (id, name, role, zone, status) values ' + reg.map(r => `(${lit(r.id)}, ${lit(r.name)}, ${lit(r.role)}, ${lit(r.zone)}, ${lit(r.status)})`).join(','));
const insReq = reqs => reqs.length ? psqlIn('insert into public.advance_requests (id, submitted_at, staff_id, staff_name, amount, approval, account) values ' + reqs.map(r => `(${lit(r.id)}, ${lit(r.at || '2026-11-05T08:00:00Z')}, ${lit(r.staff_id)}, ${lit(r.staff_name)}, ${r.amount || 50000}, ${lit(r.approval || 'Approved')}, ${lit(r.account)})`).join(',')) : 0;
const reqState = () => lines(psqlIn("select id, coalesce(staff_id, '<null>'), staff_name, amount, approval, coalesce(account, '') from public.advance_requests order by id")).map(l => l.split('\t'));
const WANT_RE2 = /with want\(n, request_name, registry_name\) as \(values\n[\s\S]*?\n\),\nw as \(/;
const withPairs2 = (text, pairs) => text.replace(WANT_RE2, () => 'with want(n, request_name, registry_name) as (values\n' + pairs.map((p, i) => `  (${i + 1}, ${lit(p[0])}, ${lit(p[1])})`).join(',\n') + '\n),\nw as (');
const WANT_REE = /want\(n, old_name, new_name\) as \(values\n[\s\S]*?\n\),\nw as \(/;
const withPairsE = (text, pairs) => text.replace(WANT_REE, () => 'want(n, old_name, new_name) as (values\n' + pairs.map((p, i) => `  (${i + 1}, ${lit(p[0])}, ${lit(p[1])})`).join(',\n') + '\n),\nw as (');
const undoOf = text => text.split('\n').filter(l => /^-- (update|  from|  where)/.test(l)).map(l => l.replace(/^-- /, '')).join('\n');

// =================================================================== C2
try {
psqlTo('drop database if exists ' + DB, admin); psqlTo('create database ' + DB + " template template0 encoding 'UTF8'", admin);
psqlIn(SCHEMA);
psqlIn('create table public.call_agents (user_id text primary key, names text, updated_at timestamptz)');   // not in any SQL file of the repository: the portal reads and writes user_id, names and updated_at
console.log('C2. the link by registry name');
const modelC2 = (reg, reqs, pairs) => {
  const R = reg.map(r => ({ ...r, k: K(r.name), live: live(r.status) }));
  const done = [], after = new Map(reqs.map(r => [r.id, r.staff_id == null ? '<null>' : r.staff_id]));
  pairs.forEach(([req, regName], i) => {
    const rkey = String(req).toUpperCase().replace(/\s+/g, ' ').trim(), gk = K(regName), rw = K(req).split(' ');
    const recs = R.filter(r => r.k === gk && r.live);
    const wordOk = recs.some(r => rw.some(x => r.k.split(' ').some(y => nearW(x, y))));
    const todo = reqs.filter(r => String(r.staff_name).toUpperCase().replace(/\s+/g, ' ').trim() === rkey && (r.staff_id == null || String(r.staff_id).trim() === ''));
    let d;
    if (recs.length === 1 && wordOk) { if (todo.length) { d = 'LINKED ' + todo.length + ' REQUEST(S)'; todo.forEach(t => after.set(t.id, recs[0].id)); } else d = 'NOTHING TO LINK: no request of this name is without a staff ID'; }
    else if (recs.length === 0) d = 'NOT LINKED: no Active record is named exactly so (add the person first, or write the name as the registry spells it)';
    else if (recs.length >= 2) d = 'NOT LINKED: ' + recs.length + ' Active records are named exactly so; the script never chooses';
    else d = "NOT LINKED: no word of the request's name is in the registry name (nothing changed)";
    done.push([req, regName, recs.length === 1 ? recs[0].id : '', recs.length === 1 ? recs[0].name : '', d]);
  });
  return { done, after };
};
const scenC2 = (label, reg, reqs, pairs) => {
  reset(); insReg(reg); insReq(reqs);
  const m = modelC2(reg, reqs, pairs);
  const before = reqState();
  const got = run(withPairs2(C2, pairs));
  same(got.map(r => [r[0], r[1], r[2] || '', r[3] || '', r[4]]), m.done, label + ': the answer');
  const after = reqState();
  same(Object.fromEntries(after.map(r => [r[0], r[1]])), Object.fromEntries(m.after), label + ': staff IDs after');
  const strip = rows => rows.map(r => [r[0], r[2], r[3], r[4], r[5]]);
  same(strip(after), strip(before), label + ': nothing but the staff ID of a request changed');
  return { got, before, after };
};
const regC = () => [S('RKL/2019/2026', 'RAHMA KASSIM LUGANO'), S('HAN/4461/2026', 'HASSAN ABEID NDEKI'), S('DMS/4459/2026', 'DAUDI MARCO SANGA'), S('OTH/0001/2026', 'SOMEBODY ELSE')];
const reqsC = () => [
  { id: uid(1), staff_id: null, staff_name: 'Rahma Kasim' }, { id: uid(2), staff_id: '', staff_name: ' rahma   KASIM ' }, { id: uid(3), staff_id: ' ', staff_name: 'RAHMA KASIM', approval: 'Disapproved' },
  { id: uid(4), staff_id: null, staff_name: 'Hassan Ndeki' },
  { id: uid(5), staff_id: 'XXX/0001/2026', staff_name: 'Daudi Sanga' },                  // already has an ID: untouched
  { id: uid(6), staff_id: null, staff_name: 'Daudi Sanga Junior' },                       // another name: untouched
  { id: uid(7), staff_id: null, staff_name: 'Someone Else' },
];
const pairsC = [['Rahma Kasim', 'RAHMA KASSIM LUGANO'], ['Hassan Ndeki', 'HASSAN ABEID NDEKI'], ['Daudi Sanga', 'DAUDI MARCO SANGA']];
const kindsC = [];
const c1 = scenC2('normal', regC(), reqsC(), pairsC);
// a second run changes nothing, then the undo
{ const s0 = reqState(); const again = run(withPairs2(C2, pairsC)); same(reqState(), s0, 'C2: a second run changed something'); need(again.every(r => r[4].startsWith('NOTHING TO LINK')), 'C2: a second run says nothing to link: ' + JSON.stringify(again.map(r => r[4])));
  const undo = undoOf(C2); need(/staff_id_before/.test(undo), 'C2: the undo is at the foot'); psqlIn(undo); same(reqState(), c1.before, 'C2: the undo puts every staff ID back'); }
scenC2('two Active records of the name', regC().concat([S('DUP/0001/2026', 'Hassan  Abeid Ndeki')]), reqsC(), pairsC);
scenC2('the record is Inactive', regC().map(r => r.id === 'DMS/4459/2026' ? { ...r, status: 'Inactive' } : r), reqsC(), pairsC);
scenC2('no word in common', regC().concat([S('ZZZ/0001/2026', 'XXXX YYYY')]), reqsC(), [['Rahma Kasim', 'XXXX YYYY'], ['Hassan Ndeki', 'HASSAN ABEID NDEKI']]);
scenC2('a word one letter apart is enough', regC().concat([S('ZZZ/0002/2026', 'RAHMAH LUGANO')]), reqsC(), [['Rahma Kasim', 'RAHMAH LUGANO']]);
scenC2('nothing to link', regC(), [{ id: uid(1), staff_id: null, staff_name: 'Other Person' }], pairsC);
const scenariosForBreakC2 = text => {
  const outs = [];
  const one = (reg, reqs, pairs) => { reset(); insReg(reg); insReq(reqs); const got = run(withPairs2(text, pairs)); const st = reqState(); const logn = psqlIn('select count(*) from public.advance_requests_link_log').trim(); psqlIn(undoOf(text)); outs.push(JSON.stringify([got, st, logn, reqState()])); };
  one(regC(), reqsC(), pairsC);
  one(regC().concat([S('DUP/0001/2026', 'Hassan  Abeid Ndeki')]), reqsC(), pairsC);
  one(regC().map(r => r.id === 'DMS/4459/2026' ? { ...r, status: 'Inactive' } : r), reqsC(), pairsC);
  one(regC().concat([S('ZZZ/0001/2026', 'XXXX YYYY')]), reqsC(), [['Rahma Kasim', 'XXXX YYYY']]);
  one(regC(), reqsC().map((r, i) => i === 0 ? { ...r, staff_id: '   ' } : r), [['Rahma Kasim', 'RAHMA KASSIM LUGANO']]);
  one(regC().concat([S('ZZZ/0002/2026', 'RAHMAH LUGANO')]), reqsC(), [['Rahma Kasim', 'RAHMAH LUGANO']]);
  return outs.join('\n');
};
const wantC2 = scenariosForBreakC2(C2);
const breaksC2 = [
  ['an ID already on a request is overwritten', s => s.replace("  where a.staff_id is null or btrim(a.staff_id) = ''\n),", '  where true\n),')],
  ['the name is a prefix', s => s.replace("= w.rkey\n  join ok", "like w.rkey || '%'\n  join ok")],
  ['an Inactive record is the person', s => s.replace("upper(btrim(coalesce(s.status, ''))) <> 'INACTIVE' as live", 'true as live')],
  ['two records may carry the name', s => s.replace('where live_n = 1 and word_ok', 'where live_n >= 1 and word_ok')],
  ['no word of the name need be in the registry name', s => s.replace('where live_n = 1 and word_ok', 'where live_n = 1')],
  ['a word must be the same, never one letter apart', s => s.replace('>= greatest(length(x), length(y)) - 1)) as word_ok', '>= greatest(length(x), length(y)) + 1)) as word_ok')],
  ['the old ID is not kept', s => s.replace('select t.id, t.staff_name, t.staff_id_was, t.rid from todo t', 'select t.id, t.staff_name, null, t.rid from todo t')],
  ['the undo sets null', s => s.replace('set staff_id = l.staff_id_before from', 'set staff_id = null from')],
  ['another column is written', s => s.replace('update public.advance_requests a set staff_id = t.rid', "update public.advance_requests a set staff_id = t.rid, approval = 'Approved'")],
];
let caughtC2 = 0;
for (const [label, f] of breaksC2) {
  const t = f(C2);
  if (t === C2) { failures++; console.log('  FAIL: break "' + label + '" did not change the file'); continue; }
  let diff; try { diff = scenariosForBreakC2(t) !== wantC2; } catch (e) { failures++; console.log('  FAIL: break "' + label + '" does not run: ' + String(e.message).slice(0, 150)); continue; }
  if (diff) caughtC2++; else { failures++; console.log('  FAIL: break NOT CAUGHT: ' + label); }
}
console.log(`  C2: ${caughtC2} of ${breaksC2.length} deliberate breaks change an answer`);

// =================================================================== E
console.log('E. the roster alignment');
const rosterRows = () => [
  ['u1', 'FADHILA SAIDY, Rahma Kasim; SOPHIA ISMAILI'], ['u2', ' hasSAN  ndeki '], ['u3', 'BENARD KAGOMA'], ['u4', 'ZAWADI LAMECK KIPUTE'], ['u5', null],
  ['u6', "NURU MWANG'ULA"], ['u7', 'Asia Tarimo, Asia Damian Tarimo'], ['u8', 'PENDO MBWANA;;  DAUDI SANGA ,'], ['u9', 'LUCIA PETER'], ['u10', 'PASCAL KIYUNGI, PASCAL KIYUNGI'],
];
const insRoster = rows => psqlIn('insert into public.call_agents (user_id, names, updated_at) values ' + rows.map(r => `(${lit(r[0])}, ${lit(r[1])}, '2026-10-01T00:00:00Z')`).join(','));
const rosterState = () => lines(psqlIn("select user_id, coalesce(names, '<null>') from public.call_agents order by user_id collate \"C\"")).map(l => l.split('\t'));
const regE = () => [S('SIC/0001/2026', 'SOPHIA ISMAIL CHACHA'), S('RKL/2019/2026', 'RAHMA KASSIM LUGANO'), S('FSK/0001/2026', 'FADHILA SAIDI KIBWANA'), S('HAN/4461/2026', 'HASSAN  ABEID NDEKI'), S('BAK/2027/2026', 'BENARD AMOS KAGOMA'),
  S('NBM/2361/2026', "NURU BAHATI MWANG'ULA"), S('ADT/2029/2026', 'Asia Damian Tarimo'), S('DMS/4459/2026', 'DAUDI MARCO SANGA'), S('LPM/2028/2026', 'LUCIA PETER MWAKYUSA', { status: 'Inactive' }),
  S('DL1/0001/2026', 'PASCAL SIMON KIYUNGI'), S('DL2/0002/2026', 'PASCAL SIMON KIYUNGI')];
const pairsE = [['SOPHIA ISMAILI', 'SOPHIA ISMAIL CHACHA'], ['RAHMA KASIM', 'RAHMA KASSIM LUGANO'], ['PASCAL KIYUNGI', 'PASCAL SIMON KIYUNGI'], ['HASSAN NDEKI', 'HASSAN ABEID NDEKI'], ['NURU MWANG\'ULA', 'NURU BAHATI MWANG\'ULA'],
  ['ASIA TARIMO', 'ASIA DAMIAN TARIMO'], ['BENARD KAGOMA', 'BENARD AMOS KAGOMA'], ['LUCIA PETER', 'LUCIA PETER MWAKYUSA'], ['DAUDI SANGA', 'DAUDI MARCO SANGA'], ['FADHILA SAIDY', 'FADHILA SAIDI KIBWANA'], ['BARAKA LUOGA', 'BARAKA LUOGA NKYA']];
const collapseU = s => String(s).toUpperCase().replace(/\s+/g, ' ').trim();
const modelE = (reg, roster, pairs) => {
  const act = reg.filter(r => live(r.status)).map(r => ({ ...r, k: K(r.name) }));
  const tg = pairs.map(([o, nw]) => { const recs = act.filter(r => r.k === K(nw)); return { o: collapseU(o), nw, cnt: recs.length, spelled: recs.length ? recs.map(r => r.name.trim()).sort()[0] : '' }; });
  const rows = roster.map(([u, names]) => {
    const parts = String(names == null ? '' : names).split(/[,;]/).map(p => p.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')).filter(p => p !== '');
    let changes = false;
    const np = parts.map(p => { const t = tg.find(x => collapseU(p) === x.o && x.cnt === 1); if (t) { if (t.spelled !== p) changes = true; return t.spelled; } return p; });
    return [u, names == null ? '<null>' : names, changes ? np.join(', ') : (names == null ? '<null>' : names), changes, parts];
  });
  const done = tg.map((t, i) => { const rowsWith = rows.filter(r => r[4].some(p => collapseU(p) === t.o)); return [String(i + 1), pairs[i][0], pairs[i][1], t.cnt === 1 ? t.spelled : '', t.cnt === 0 ? 'NOT CHANGED: no Active record is named exactly so' : t.cnt >= 2 ? 'NOT CHANGED: ' + t.cnt + ' Active records are named exactly so' : rowsWith.length ? 'REPLACED on ' + rowsWith.length + ' roster row(s)' : 'NOT ON THE ROSTER (or already written as the registry spells it)']; });
  return { rows, done };
};
const scenE = (label, reg, roster, pairs, text = E0) => {
  reset(); insReg(reg); insRoster(roster);
  const m = modelE(reg, roster, pairs);
  const got = run(withPairsE(text, pairs));
  same(got.map(r => [r[0], r[1], r[2], r[3] || '', r[4]]), m.done, label + ': the answer');
  same(rosterState(), m.rows.map(r => [r[0], r[2]]).sort((a, b) => (a[0] < b[0] ? -1 : 1)), label + ': the roster afterwards');
  return m;
};
const eNormal = scenE('normal', regE(), rosterRows(), pairsE);
{ const before = rosterRows().map(r => [r[0], r[1] == null ? '<null>' : r[1]]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const s1 = rosterState(); const again = run(withPairsE(E0, pairsE)); same(rosterState(), s1, 'E: a second run changed something'); need(again.every(r => !r[4].startsWith('REPLACED')), 'E: a second run replaces nothing');
  const undo = undoOf(E0); need(/call_agents_names_before/.test(undo), 'E: the undo is at the foot'); psqlIn(undo);
  same(rosterState(), before, 'E: the undo puts every roster row back');
  need(Number(psqlIn("select count(*) from public.call_agents_names_before").trim()) === eNormal.rows.filter(r => r[3]).length, 'E: one copy for each row changed'); }
need(eNormal.rows.some(r => r[3]) && eNormal.rows.some(r => !r[3]), 'E: the roster has rows that change and rows that do not');
scenE('an empty roster', regE(), [['u1', null]], pairsE);
const scenariosForBreakE = text => {
  const outs = [];
  const one = (reg, roster, pairs) => { reset(); insReg(reg); insRoster(roster); const got = run(withPairsE(text, pairs)); const st = rosterState(); const copies = psqlIn('select count(*) from public.call_agents_names_before').trim(); psqlIn(undoOf(text)); outs.push(JSON.stringify([got, st, copies, rosterState()])); };
  one(regE(), rosterRows(), pairsE);
  one(regE().concat([S('DUP/0009/2026', 'Asia   Damian Tarimo')]), rosterRows(), pairsE);
  one(regE().filter(r => r.id !== 'RKL/2019/2026'), rosterRows(), pairsE);
  return outs.join('\n');
};
const wantE = scenariosForBreakE(E0);
const breaksE = [
  ['an Inactive record is the registry name', s => s.replace("from public.staff_registry s where upper(btrim(coalesce(s.status, ''))) <> 'INACTIVE'", 'from public.staff_registry s where true')],
  ['two records may carry the name', s => s.replace('and t.cnt = 1 limit 1), pa.part) as new_part', 'and t.cnt >= 1 limit 1), pa.part) as new_part')],
  ['the roster is split on commas only', s => s.replace("'[,;]'", "','")],
  ['the old name is matched case-sensitively', s => s.replace("where regexp_replace(upper(pa.part), '\\s+', ' ', 'g') = w.ok_ and t.cnt = 1", "where pa.part = w.old_name and t.cnt = 1")],
  ['blanks inside the old name are not collapsed', s => s.replace("where regexp_replace(upper(pa.part), '\\s+', ' ', 'g') = w.ok_ and t.cnt = 1", "where upper(pa.part) = w.ok_ and t.cnt = 1")],
  ['the registry name is typed, not the registry spelling', s => s.replace('min(btrim(r.name)) as spelled', 'min(w.new_name) as spelled')],
  ['an unchanged row is rewritten', s => s.replace('todo as (select r.* from rows_ r where r.changes)', 'todo as (select r.* from rows_ r)')],
  ['the copy before the change is not taken', s => s.replace('from public.call_agents c join todo t on t.user_id = c.user_id\n  where not exists', 'from public.call_agents c join todo t on t.user_id = c.user_id\n  where false and not exists')],
  ['the user_id is touched', s => s.replace('update public.call_agents c set names = t.new_names, updated_at = now()', "update public.call_agents c set names = t.new_names, user_id = upper(c.user_id), updated_at = now()")],
  ['a second name of a row is dropped', s => s.replace("string_agg(m.new_part, ', ' order by m.ord)", "min(m.new_part)")],
  ['the roster is rebuilt in another order', s => s.replace("string_agg(m.new_part, ', ' order by m.ord)", "string_agg(m.new_part, ', ' order by m.new_part)")],
];
let caughtE = 0;
for (const [label, f] of breaksE) {
  const t = f(E0);
  if (t === E0) { failures++; console.log('  FAIL: break "' + label + '" did not change the file'); continue; }
  let diff; try { diff = scenariosForBreakE(t) !== wantE; } catch (e) { failures++; console.log('  FAIL: break "' + label + '" does not run: ' + String(e.message).slice(0, 150)); continue; }
  if (diff) caughtE++; else { failures++; console.log('  FAIL: break NOT CAUGHT: ' + label); }
}
console.log(`  E: ${caughtE} of ${breaksE.length} deliberate breaks change an answer`);
} finally { try { psqlTo('drop database if exists ' + DB, admin); } catch { /* none */ } }
if (failures) { console.log('\n' + failures + ' FAILURE(S)'); process.exit(1); }
console.log('\nOK: the link writes the staff ID of the right requests and nothing else, the roster is typed as the registry spells it, both undo exactly, and both fail when broken.');
