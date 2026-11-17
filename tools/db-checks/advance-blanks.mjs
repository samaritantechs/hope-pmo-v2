/* THE ADVANCE REPORT'S BLANK ACCOUNTS (db/RUN-ME-072), THE CALL-AGENTS ROSTER AGAINST THE REGISTRY (db/RUN-ME-073) AND THE LINK OF REQUESTS TO A STAFF ID
   (db/TEMPLATE-link-advance-requests-to-staff.sql), run for real on a PostgreSQL (docs/HANDOFF.md Part 109).

     "the missing account numbers at advance salary tabs automatically fill themselves? ... finance manager is pulling that report and needs the column filled" -- the owner, 17 Nov 2026

   Two files are read-only lists the owner reads to chase accounts and fix names, and one writes the staff ID of a payroll request: a person missing from the first list is never asked for an account,
   one wrongly on it is wrongly demanded; a name the second calls "found" that the request tab does not find leaves a blank account unexplained; the third must change the staff ID of the right
   requests and nothing else. None of them is believed on a reading.

   THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database (staff_registry and advance_requests have the live book's columns and types) and a call_agents table declared by hand:
   no SQL file of the repository creates it (the portal reads and writes `user_id` and `names`, text, in api/_lib/portal-core.js: test/advance-blanks.test.mjs pins that).
   For each file it passes only when the answer equals EXACTLY what a MODEL written again in JavaScript says, row by row and in order: A over four windows and states on 260 random requests of 70 staff
   (the report's own rule for "blank": the request's copy is not an account and neither is the registry's; the boundary instants of the window; padded and lower-case staff IDs; IDs in no record;
   requests with no ID; Inactive staff); B over a roster of every kind (found by the tab, found twice, the same words with other blanks, a longer name, one word in common in the department and
   outside it, a name on two roster rows, empty cells, a tab); C in seven situations (normal; two Active records carry the words; the record is Inactive; the ID typed is another person's; no record;
   another person who shares one word; nothing to link) and, in the normal one, a second run (nothing changes), the log, the undo (every staff ID back as it was) and that NOTHING BUT THE STAFF ID
   of a request changed. Then EVERY ONE of a list of deliberate breaks of each file must change an answer.

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/advance-blanks.mjs

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the files do what they say, and fail when broken. No real name or staff ID is in this file. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SCHEMA = rd('db/schema.sql');
const DB = 'hope_adv_blank';
const admin = process.env.PGDATABASE || 'postgres';
const psqlIn = (sql, db) => {
  try { return execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error('psql failed: ' + String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 3).join(' | ')); }
};
const psql = sql => psqlIn(sql, DB);
const runScript = text => psqlIn('begin;\n' + text + '\ncommit;\n', DB).trim().split('\n').filter(Boolean).map(l => l.split('\t'));
let failures = 0;
const need = (ok, msg) => { if (!ok) { failures++; console.log('  FAIL: ' + msg); } };
const same = (a, b, msg) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) { failures++; console.log('  FAIL: ' + msg + '\n    got      ' + x.slice(0, 1500) + '\n    expected ' + y.slice(0, 1500)); } };

// ---- a deterministic random
let seed = 20261117;
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const q = v => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const has = v => /[1-9]/.test(String(v == null ? '' : v));
const collapse = s => String(s).replace(/\s+/g, ' ').replace(/^ +| +$/g, '');
const U = s => String(s).toUpperCase();
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // C collation for ASCII

const reset = () => psql('truncate public.advance_requests, public.staff_registry, public.call_agents; drop table if exists public.advance_requests_link_log;');
const insReg = reg => psql(reg.length ? 'insert into public.staff_registry (id, name, role, zone, status, account, bank) values ' + reg.map(r => `(${q(r.id)}, ${q(r.name)}, ${q(r.role)}, ${q(r.zone)}, ${q(r.status)}, ${q(r.account)}, ${q(r.bank)})`).join(',\n') : 'select 1');
const insReq = reqs => psql(reqs.length ? 'insert into public.advance_requests (id, submitted_at, staff_id, staff_name, amount, approval, account, zone) values ' + reqs.map(r => `(${q(r.id)}, ${q(r.at)}, ${q(r.staff_id)}, ${q(r.staff_name)}, ${r.amount}, ${q(r.approval)}, ${q(r.account)}, ${q(r.zone || null)})`).join(',\n') : 'select 1');
const uid = i => '00000000-0000-4000-8000-' + String(i).padStart(12, '0');

// =====================================================================================
// A. who the Advance report prints blank
// =====================================================================================
try {
psqlIn('drop database if exists ' + DB, admin); psqlIn('create database ' + DB + " template template0 encoding 'UTF8'", admin);
psql(SCHEMA);
psql('create table public.call_agents (user_id text primary key, names text, updated_at timestamptz)');   // not in any SQL file of the repository: the portal reads and writes user_id and names (text)
console.log('A. the report\'s blank accounts');
const NAMES = ['JUMA', 'ASHA', 'NEEMA', 'RAJABU', 'SIMON', 'HAWA', 'SALUM', 'MWAJUMA', 'EMMANUEL', 'GRACE', 'BAKARI', 'FATUMA', 'PETER', 'LUCY', 'OMARY', 'RASHID'];
const SURN = ['KALAMU', 'KIMARIO', 'NZIGE', 'LUGHA', 'MWANGAZA', 'CHUMBE', 'MASSAWE', 'NYAGAWA', 'TUMAINI', 'ZEBAKI'];
const ROLES = ['Field Officer - Kijenge', 'Field Officer', 'FIELD OFFICER - ILEMELA B', 'Manager - HIMO', 'Credit Analyst - ZONE X - Y', 'CALL AGENT', 'CALL AGENT - ASSISTANT SUPERVISOR', 'Legal', null, 'field officer  -  Team Tanga'];
const ZONES = ['NORTH', ' north ', 'MARA', 'HQ - CUSTOMER SERVICE', 'HQ - PMO', null, '', 'South  West', 'MWANZA'];
const ACCS = ['0152826626000', '10474106999', 'N/A', 'ON PROCESS', '-', '0', '000000', null, '', ' ', 'HAINA', '0000 0000', 'TZ99 1234', '00100'];
const STAT = ['Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Inactive', 'INACTIVE', ' inactive', null];
const reg = [];
for (let i = 0; i < 70; i++) {
  const nm = pick(NAMES) + (rnd() < 0.5 ? ' ' + pick(NAMES) : '') + (rnd() < 0.15 ? '  ' : ' ') + pick(SURN);
  reg.push({ id: 'S' + String(i).padStart(3, '0') + '/' + (2000 + i) + '/2026', name: rnd() < 0.2 ? nm.toLowerCase() : nm, role: pick(ROLES), zone: pick(ZONES), status: pick(STAT) || 'Active', account: pick(ACCS), bank: pick(['CRDB', 'NMB', null, '', '  ']) });
}
// status is not null in the schema: the 'null' draws became Active above
const reqs = [];
const AMT = [50000, 100000, 150000, 200000, 250000];
const WIN = ['2026-10-31T23:59:59.999Z', '2026-11-01T00:00:00.000Z', '2026-11-30T23:59:59.999Z', '2026-12-01T00:00:00.000Z'];
for (let i = 0; i < 260; i++) {
  const kind = rnd();
  let staff_id, staff_name;
  if (kind < 0.12) { staff_id = null; staff_name = pick(['Tatu Mwangaza', ' pili  Chumbe ', 'ZURI KALAMU', 'Hodari Lugha', 'Baraka Nzige']); }
  else if (kind < 0.16) { staff_id = 'ZZZ/9999/2026'; staff_name = 'GHOST ID'; }
  else if (kind < 0.20) { staff_id = '  ' + pick(reg).id.toLowerCase() + ' '; staff_name = 'PADDED'; }
  else { const r = pick(reg); staff_id = r.id; staff_name = r.name; }
  const at = i < 4 ? WIN[i] : new Date(Date.UTC(2026, 9, 20) + Math.floor(rnd() * 55 * 86400000)).toISOString();
  const edge = i < 4;   // the four boundary instants: approved, no staff ID, no account copy: they print blank whenever the window takes them in
  reqs.push({ id: uid(i + 1), at, staff_id: edge ? null : staff_id, staff_name: edge ? 'EDGE ' + i : staff_name, amount: pick(AMT), approval: edge ? 'Approved' : pick(['Approved', 'Approved', 'Approved', 'Pending', 'Disapproved', 'Expired', ' approved ']), account: edge ? null : pick([null, '', 'N/A', '12345678', '0', '0152826626000', ' ']) });
}
reset(); insReg(reg); insReq(reqs);
const modelA = ({ from, to, ap }) => {
  const t1 = Date.parse(from + 'T00:00:00Z'), t2 = Date.parse(to + 'T23:59:59.999Z'), AP = U(ap.trim());
  const regBy = new Map(reg.map(r => [U(r.id.trim()), r]));
  const people = new Map();
  for (const a of reqs) {
    const t = Date.parse(a.at);
    if (!(t >= t1 && t <= t2)) continue;
    if (!(AP === 'ALL' || U(a.approval.trim()) === AP)) continue;
    const r = a.staff_id == null ? null : regBy.get(U(a.staff_id.trim())) || null;
    if (has(a.account) || (r && has(r.account))) continue;
    const pkey = r ? 'R:' + r.id : a.staff_id != null ? 'I:' + U(a.staff_id.trim()) : 'N:' + U(collapse(a.staff_name));
    const p = people.get(pkey) || { pkey, rid: r ? r.id : null, name0: U(collapse(r ? r.name : a.staff_name)), zone0: r ? U(collapse(r.zone || '')) : '', team0: r ? U(collapse((/\s+-\s+(.*)$/s.exec(r.role || '') || [, ''])[1])) : '', inactive: r ? U((r.status || '').trim()) === 'INACTIVE' : false, requests: 0, cents: 0 };
    p.requests++; p.cents += a.amount * 100; people.set(pkey, p);
  }
  const rows = [...people.values()];
  rows.sort((a, b) => (a.rid == null) - (b.rid == null) || (a.zone0 === '') - (b.zone0 === '') || cmp(a.zone0, b.zone0) || a.pkey.startsWith('N:') - b.pkey.startsWith('N:') || (a.team0 === '') - (b.team0 === '') || cmp(a.team0, b.team0) || cmp(a.name0, b.name0) || cmp(a.pkey, b.pkey));
  return rows.map(p => [p.rid != null ? (p.zone0 || 'NO ZONE') : p.pkey.startsWith('N:') ? 'NO STAFF ID ON THE REQUEST' : 'STAFF ID NOT IN THE REGISTRY', p.team0 || '-', p.name0, String(p.requests), (p.cents / 100).toFixed(2),
    p.rid != null && p.inactive ? 'the registry has no account for this staff, and the registry says INACTIVE' : p.rid != null ? 'the registry has no account for this staff: ask them for it' : p.pkey.startsWith('N:') ? 'the request has no staff ID: its name is not in the registry spelled exactly so (RUN-ME-073)' : 'the staff ID on the request is in no registry record']);
};
const setA = (text, from, to, ap) => text.replace("'2026-11-01'", `'${from}'`).replace("'2026-11-30'", `'${to}'`).replace("'Approved'", `'${ap}'`);
const A0 = rd('db/RUN-ME-072-advance-report-blank-accounts-read-only.sql');
const runA = (text, from, to, ap) => runScript(setA(text, from, to, ap));
let sizeA = 0;
for (const cfg of [{ from: '2026-11-01', to: '2026-11-30', ap: 'Approved' }, { from: '2026-10-01', to: '2026-12-31', ap: 'ALL' }, { from: '2026-11-10', to: '2026-11-20', ap: 'Pending' }, { from: '2026-11-01', to: '2026-11-30', ap: ' expired ' }]) {
  const got = runA(A0, cfg.from, cfg.to, cfg.ap), want = modelA(cfg);
  same(got, want, 'A ' + JSON.stringify(cfg));
  sizeA += want.length;
  console.log(`  ${JSON.stringify(cfg)}: ${want.length} people, ${want.reduce((s, r) => s + Number(r[3]), 0)} requests`);
}
need(sizeA > 40, 'A: the fixture gave only ' + sizeA + ' rows over four windows');
{ const w = modelA({ from: '2026-10-01', to: '2026-12-31', ap: 'ALL' }); const kinds = new Set(w.map(r => r[0] === 'NO STAFF ID ON THE REQUEST' ? 'noid' : r[0] === 'STAFF ID NOT IN THE REGISTRY' ? 'ghost' : r[5].includes('INACTIVE') ? 'inactive' : r[0] === 'NO ZONE' ? 'nozone' : 'plain'));
  need(['noid', 'ghost', 'inactive', 'nozone', 'plain'].every(k => kinds.has(k)), 'A: the fixture lacks a kind of row: ' + [...kinds].join(',')); }
// the boundary instants are in the fixture and the window counts them as the report does
{ const edge = reqs.slice(0, 4).map(r => r.at); const inWin = edge.filter(t => Date.parse(t) >= Date.parse('2026-11-01T00:00:00Z') && Date.parse(t) <= Date.parse('2026-11-30T23:59:59.999Z')); need(inWin.length === 2, 'A: boundary instants'); }
// the SQL sentence for "not an account" is the one JavaScript function (a list of tricky cells)
{ const cells = ['0', '00', '0.0', '1', '0100', 'N/A', 'ON PROCESS', '-', '', ' ', 'TZ00', 'TZ01', '\u0663', '0152826626000', '000 000', 'x9']; const got = psql('select ' + cells.map(c => `(${q(c)} ~ '[1-9]')`).join(', ')).trim().split('\t'); same(got, cells.map(c => has(c) ? 't' : 'f'), 'A: "has an account" is parse.js hasAccount'); }
// deliberate breaks of A: each must change the answer
const breaksA = [
  ['only the request copy is read', s => s.replace("and coalesce(r.account, '') !~ '[1-9]'", '')],
  ['only the registry account is read', s => s.replace("where coalesce(q.copy_, '') !~ '[1-9]' and", 'where')],
  ['a copy of zeros counts as an account', s => s.replace("coalesce(q.copy_, '') !~ '[1-9]'", "coalesce(q.copy_, '') !~ '[0-9]'")],
  ['the window ends a day early', s => s.replace("'T23:59:59.999Z'", "'T00:00:00Z'")],
  ['the window starts after the first day', s => s.replace("'T00:00:00Z'", "'T23:59:59Z'")],
  ['the state filter is ignored', s => s.replace("(cfg.ap = 'ALL' or upper(btrim(a.approval)) = cfg.ap)", 'true')],
  ['the state is compared as typed', s => s.replace('upper(btrim(a.approval)) = cfg.ap', 'a.approval = cfg.ap')],
  ['the registry join is exact-case', s => s.replace('on upper(btrim(r.id)) = upper(btrim(q.staff_id))', 'on r.id = q.staff_id')],
  ['people with no staff ID are not listed', s => s.replace("where coalesce(q.copy_, '')", 'where q.staff_id is not null and coalesce(q.copy_, \'\')')],
  ['a staff ID in no record is not listed', s => s.replace("where coalesce(q.copy_, '')", 'where (q.staff_id is null or r.id is not null) and coalesce(q.copy_, \'\')')],
  ['the team is the whole role', s => s.replace("substring(b.rrole from '\\s+-\\s+(.*)$')", 'b.rrole')],
  ['the sort ignores the zone', s => s.replace('p.zone0 collate "C", ', '')],
  ['the amount counts the first request only', s => s.replace('sum(b.amount) as amount', 'min(b.amount) as amount')],
  ['an Inactive record is not flagged', s => s.replace("bool_or(upper(btrim(coalesce(b.rstatus, ''))) = 'INACTIVE') as inactive", 'false as inactive')],
  ['a registry person is one row for each request', s => s.replace('group by 1', 'group by 1, b.id').replace("case when b.rid is not null then 'R:' || b.rid", "case when b.rid is not null then 'R:' || b.rid || b.id")],
];
let caughtA = 0;
for (const [label, f] of breaksA) {
  const t = f(A0);
  if (t === A0) { failures++; console.log('  FAIL: break "' + label + '" did not change the file'); continue; }
  let diff = false;
  for (const cfg of [{ from: '2026-11-01', to: '2026-11-30', ap: 'Approved' }, { from: '2026-10-01', to: '2026-12-31', ap: 'ALL' }]) {
    let got; try { got = runA(t, cfg.from, cfg.to, cfg.ap); } catch (e) { diff = true; break; }
    if (JSON.stringify(got) !== JSON.stringify(modelA(cfg))) { diff = true; break; }
  }
  if (diff) caughtA++; else { failures++; console.log('  FAIL: break NOT CAUGHT: ' + label); }
}
console.log(`  A: ${caughtA} of ${breaksA.length} deliberate breaks change the answer`);

// =====================================================================================
// B. the roster against the registry
// =====================================================================================
console.log('B. the call-agents roster against the registry');
const regB = [
  { id: 'ZKA/0001/2026', name: 'Zuri Kalamu', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '0152826626000', bank: 'CRDB' },         // exact (capitals)
  { id: 'TBM/2027/2026', name: 'TATU B MWANGAZA', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '10474106999', bank: null },     // carries every word
  { id: 'PCC/2020/2026', name: 'PILI C CHUMBE', role: 'CALL AGENT - ASSISTANT SUPERVISOR', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: 'N/A', bank: 'NMB' },
  { id: 'HLU/0001/2026', name: 'HODARI LUGHA', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Inactive', account: '1234567', bank: 'NMB' },           // inactive: not a record for the tab
  { id: 'BNZ/0002/2026', name: 'BARAKA  NZIGE', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '5555', bank: '' },                  // the same words, two blanks
  { id: 'BNO/0003/2026', name: 'BARAKINA NZIGO', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '0', bank: null },                     // shares one word of a department record? no: MBEMBE
  { id: 'RJU/0004/2026', name: 'RIZIKI JUMA', role: 'Field Officer - X', zone: 'NORTH', status: 'Active', account: '9', bank: 'CRDB' },                                  // another zone: shares a word, not a department record
  { id: 'RSA/0005/2026', name: 'RIZIKI SALUM', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '', bank: null },                              // shares HAWA with the roster's RIZIKI JUMA
  { id: 'NTU/0006/2026', name: 'Neema Tumaini', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '777', bank: 'CRDB' },                       // exact
  { id: 'NTU/0007/2026', name: 'NEEMA TUMAINI', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '88', bank: null },                          // exact again: two Active records (a real account and no bank)
  { id: 'HKI/0010/2026', name: 'HODARI KIMARIO', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '0', bank: null },                         // carries ONE word of Hodari Lugha
  { id: 'ZKM/0008/2026', name: 'ZAWADI KIMARIO MASSAWE', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '12', bank: null },                  // carries LUCY KIMARIO
  { id: 'ZKM/0009/2026', name: 'KIMARIO ZAWADI', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '0', bank: null },                           // the same words reordered
];
const roster = [
  { user_id: 'u1', names: 'Tatu Mwangaza, Pili Chumbe; zuri kalamu' },
  { user_id: 'u2', names: ' Hodari Lugha ,, Baraka Nzige ; ' },
  { user_id: 'u3', names: 'Tatu Mwangaza' },                  // the same name on two rows: one line
  { user_id: 'u4', names: 'Riziki Juma\t; Neema Tumaini, Zawadi Kimario' },
  { user_id: 'u5', names: null },
  { user_id: 'u6', names: 'Nobody Atall;Mwajuma Emmanuel;Simon Riziki' },
];
const reqsB = [
  { id: uid(1), at: '2026-11-03T08:00:00Z', staff_id: null, staff_name: 'Tatu Mwangaza', amount: 50000, approval: 'Approved', account: null },
  { id: uid(2), at: '2026-10-03T08:00:00Z', staff_id: null, staff_name: ' tatu   MWANGAZA ', amount: 50000, approval: 'Disapproved', account: null },
  { id: uid(3), at: '2026-11-04T08:00:00Z', staff_id: 'TBM/2027/2026', staff_name: 'Tatu Mwangaza', amount: 50000, approval: 'Approved', account: null },   // has an ID: not counted
  { id: uid(4), at: '2026-11-05T08:00:00Z', staff_id: null, staff_name: 'Pili Chumbe', amount: 50000, approval: 'Pending', account: null },
  { id: uid(5), at: '2026-11-06T08:00:00Z', staff_id: null, staff_name: 'Someone Else', amount: 50000, approval: 'Approved', account: null },
];
reset(); insReg(regB); insReq(reqsB);
psql(roster.map(r => `insert into public.call_agents (user_id, names) values (${q(r.user_id)}, ${q(r.names)});`).join('\n'));
const modelB = () => {
  const raws = new Set();
  for (const c of roster) for (const part of String(c.names || '').split(/[,;]/)) { const t = part.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ''); if (t) raws.add(U(t)); }
  const act = regB.filter(r => U((r.status || '').trim()) !== 'INACTIVE').map(r => ({ ...r, k: U(r.name.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')), nm: U(collapse(r.name)), w: U(collapse(r.name)).split(' ') }));
  const out = [];
  for (const raw of raws) {
    const k = U(raw), nm = U(collapse(raw)), w = nm.split(' ');
    const hit = act.filter(g => g.k === k);
    const reqN = reqsB.filter(a => a.staff_id == null && U(collapse(a.staff_name)) === nm).length;
    let registry;
    if (hit.length) registry = hit.sort((a, b) => cmp(a.id, b.id)).map(h => h.id + ' [' + (has(h.account) ? 'a real account' : 'NO ACCOUNT') + ', ' + (String(h.bank || '').trim() !== '' ? 'a bank name' : 'no bank name') + ']').join(' ; ');
    else {
      const every = act.filter(g => w.every(y => g.nm.includes(y))).sort((a, b) => cmp(a.id, b.id));
      const dept = act.filter(g => U(g.zone || '').includes('CUSTOMER') && g.w.some(a => w.includes(a)) && !every.some(e => e.id === g.id)).sort((a, b) => cmp(a.id, b.id));
      registry = (every.length ? every.map(e => e.id + ' [' + (e.role == null ? '-' : e.role) + ', ' + (e.zone == null ? '-' : e.zone) + ', ' + (has(e.account) ? 'a real account' : 'NO ACCOUNT') + '] is "' + e.nm + '"' + (e.nm === nm ? ' (the same words: only the blanks differ)' : '')).join(' ; ') : 'no Active record carries every word of it')
        + (dept.length ? ' || SAME DEPARTMENT, ONE WORD IN COMMON: ' + dept.map(d => d.id + ' "' + d.nm + '"').join(' ; ') : '');
    }
    out.push({ raw, nm, found: hit.length > 0, row: [nm, hit.length ? 'YES: the tab finds it' : 'NO: the request is filed with no staff ID', String(reqN), registry] });
  }
  out.sort((a, b) => (a.found - b.found) || cmp(a.nm, b.nm) || cmp(a.raw, b.raw));
  return out.map(o => o.row);
};
const B0 = rd('db/RUN-ME-073-call-agents-roster-vs-registry-read-only.sql');
const gotB = runScript(B0), wantB = modelB();
same(gotB, wantB, 'B');
console.log('  ' + wantB.length + ' roster names, ' + wantB.filter(r => r[1].startsWith('YES')).length + ' found by the tab');
{ const kinds = { 'the same words, only the blanks differ': r => r[3].includes('only the blanks differ'), 'same department, one word': r => r[3].includes('SAME DEPARTMENT'), 'no Active record carries every word': r => r[3].includes('no Active record carries every word'), 'found by two records': r => r[1].startsWith('YES') && r[3].includes(' ; '), 'a record that carries every word': r => r[1].startsWith('NO') && r[3].includes('] is "') };
  for (const [k, f] of Object.entries(kinds)) need(wantB.some(f), 'B: the fixture lacks a row of the kind: ' + k); }
const breaksB = [
  ['the tab is read case-sensitively', s => s.replace('upper(btrim(r.name, E\' \\t\\r\\n\')) as k', 'btrim(r.name, E\' \\t\\r\\n\') as k')],
  ['the tab collapses blanks', s => s.replace("select ro.raw, upper(ro.raw) as k,", "select ro.raw, upper(btrim(regexp_replace(ro.raw, '\\s+', ' ', 'g'))) as k,").replace("upper(btrim(r.name, E' \\t\\r\\n')) as k", "upper(btrim(regexp_replace(r.name, '\\s+', ' ', 'g'))) as k")],
  ['an Inactive record counts', s => s.replace("where upper(btrim(coalesce(r.status, ''))) <> 'INACTIVE'", 'where true')],
  ['only one word of the name is asked', s => s.replace("not exists (select 1 from unnest(x.w) y where strpos(g.nm, y) = 0)", "exists (select 1 from unnest(x.w) y where strpos(g.nm, y) > 0)")],
  ['the department test is dropped', s => s.replace("on upper(coalesce(g.zone, '')) like '%CUSTOMER%'\n                   and exists", 'on exists')],
  ['requests with an ID are counted', s => s.replace('a.staff_id is null and upper(btrim(regexp_replace(a.staff_name', 'true and upper(btrim(regexp_replace(a.staff_name')],
  ['the roster is split on commas only', s => s.replace("'[,;]'", "','")],
  ['the not-found names are not first', s => s.replace('order by (h.raw is not null), x.nm', 'order by x.nm')],
  ['the same name on two rows is two lines', s => s.replace("select distinct upper(btrim(n, E' \\t\\r\\n')) as raw", "select upper(btrim(n, E' \\t\\r\\n')) as raw")],
  ['the same words are not told apart', s => s.replace("case when e.same_words then ' (the same words: only the blanks differ)' else '' end", "''")],
  ['a bank name is read from the account', s => s.replace("(btrim(coalesce(r.bank, '')) <> '') as has_bank", "(coalesce(r.account, '') ~ '[1-9]') as has_bank")],
];
let caughtB = 0;
for (const [label, f] of breaksB) {
  const t = f(B0);
  if (t === B0) { failures++; console.log('  FAIL: break "' + label + '" did not change the file'); continue; }
  let diff = false; try { diff = JSON.stringify(runScript(t)) !== JSON.stringify(wantB); } catch (e) { diff = true; }
  if (diff) caughtB++; else { failures++; console.log('  FAIL: break NOT CAUGHT: ' + label); }
}
console.log(`  B: ${caughtB} of ${breaksB.length} deliberate breaks change the answer`);

// =====================================================================================
// C. the link
// =====================================================================================
console.log('C. the link of two names');
const TEMPLATE = rd('db/TEMPLATE-link-advance-requests-to-staff.sql');
const WANT_RE = /with want\(n, roster_name, staff_id\) as \(values\n[\s\S]*?\n\),\nw as \(/;
need(WANT_RE.test(TEMPLATE), 'the template has its VALUES list in the form the check replaces');
const C0 = TEMPLATE.replace(WANT_RE, () => "with want(n, roster_name, staff_id) as (values\n  (1, 'Tatu Mwangaza', 'TBM/2027/2026'),\n  (2, 'Pili Chumbe', 'PCC/2020/2026')\n),\nw as (");
const base = () => [
  { id: 'TBM/2027/2026', name: 'TATU B MWANGAZA', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '10474106999', bank: 'CRDB' },
  { id: 'PCC/2020/2026', name: 'Pili C Chumbe', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '5551', bank: null },
  { id: 'ZKA/0001/2026', name: 'ZURI KALAMU', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '1', bank: null },
];
const reqC = () => [
  { id: uid(1), at: '2026-11-03T08:00:00Z', staff_id: null, staff_name: 'Tatu Mwangaza', amount: 50000, approval: 'Approved', account: null, zone: null },
  { id: uid(2), at: '2026-10-03T08:00:00Z', staff_id: '', staff_name: ' tatu   MWANGAZA ', amount: 100000, approval: 'Approved', account: 'N/A', zone: null },
  { id: uid(3), at: '2026-09-03T08:00:00Z', staff_id: ' ', staff_name: 'TATU MWANGAZA', amount: 150000, approval: 'Disapproved', account: null, zone: null },
  { id: uid(4), at: '2026-11-04T08:00:00Z', staff_id: 'OTH/0001/2026', staff_name: 'Tatu Mwangaza', amount: 50000, approval: 'Approved', account: null, zone: null },   // already has an ID: untouched
  { id: uid(5), at: '2026-11-05T08:00:00Z', staff_id: null, staff_name: 'Tatu Mwangaza Junior', amount: 50000, approval: 'Approved', account: null, zone: null },   // another name
  { id: uid(6), at: '2026-11-06T08:00:00Z', staff_id: null, staff_name: 'Pili Chumbe', amount: 200000, approval: 'Approved', account: null, zone: null },
  { id: uid(7), at: '2026-11-07T08:00:00Z', staff_id: null, staff_name: 'PILI CHUMBE', amount: 200000, approval: 'Pending', account: '0', zone: null },
  { id: uid(8), at: '2026-11-08T08:00:00Z', staff_id: null, staff_name: 'Zuri Kalamu', amount: 50000, approval: 'Approved', account: null, zone: null },   // not named in the script: untouched
];
const colsHash = () => psql(`select id, staff_id, staff_name, amount, approval, account, zone, submitted_at from public.advance_requests order by id`);
const stateC = () => psql('select id, coalesce(staff_id, \'<null>\') from public.advance_requests order by id').trim().split('\n').map(l => l.split('\t'));
const scenario = (label, regR, reqsR, expectDone, expectIds) => {
  reset(); insReg(regR); insReq(reqsR);
  const before = colsHash(), beforeState = stateC();
  const out = runScript(C0);
  same(out.map(r => r[3]), expectDone, `C ${label}: the answer`);
  const after = stateC();
  same(Object.fromEntries(after), { ...Object.fromEntries(beforeState), ...expectIds }, `C ${label}: staff IDs after`);
  // nothing but the staff ID changed
  const strip = s => s.trim().split('\n').filter(Boolean).map(l => { const p = l.split('\t'); p.splice(1, 1); return p.join('\t'); }).join('\n');
  need(strip(colsHash()) === strip(before), `C ${label}: another column of a request changed`);
  // a second run changes nothing
  const again = runScript(C0);
  need(JSON.stringify(stateC()) === JSON.stringify(after), `C ${label}: a second run changed something`);
  return { out, again, before: beforeState };
};
const N = 'NOTHING TO LINK: no request of this name is without a staff ID';
{ // the normal case
  const s = scenario('normal', base(), reqC(), ['LINKED 3 REQUEST(S)', 'LINKED 2 REQUEST(S)'], { [uid(1)]: 'TBM/2027/2026', [uid(2)]: 'TBM/2027/2026', [uid(3)]: 'TBM/2027/2026', [uid(6)]: 'PCC/2020/2026', [uid(7)]: 'PCC/2020/2026' });
  same(s.out.map(r => r[2]), ['TATU B MWANGAZA', 'PILI C CHUMBE'], 'C normal: the registry spelling is told');
  same(s.again.map(r => r[3]), [N, N], 'C normal: a second run says nothing to link');
  same(psql('select count(*) from public.advance_requests_link_log').trim(), '5', 'C normal: the log');
  same(psql("select count(*) from public.advance_requests_link_log where staff_id_before is not null and btrim(staff_id_before) <> ''").trim(), '0', 'C normal: the log keeps the old ids (null, empty, blank)');
  // the undo puts every request back, exactly
  const undo = C0.split('\n').filter(l => l.startsWith('-- update public.advance_requests')).map(l => l.replace(/^-- /, '')).join('\n');
  need(undo.includes('staff_id_before'), 'C: the undo is in the file');
  psql(undo);
  same(psql('select id, coalesce(staff_id, \'<null>\') from public.advance_requests order by id').trim().split('\n').map(l => l.split('\t')), s.before, 'C normal: the undo restores every staff ID');
}
{ // two Active records carry the words of Martin: the script never chooses
  const r = base().concat([{ id: 'TBM/9999/2026', name: 'TATU MWANGAZA', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '99', bank: null }]);
  scenario('ambiguous', r, reqC(), ['NOT LINKED: 2 Active records carry every word of this name; the script never chooses (nothing changed)', 'LINKED 2 REQUEST(S)'], { [uid(6)]: 'PCC/2020/2026', [uid(7)]: 'PCC/2020/2026' });
}
{ // the named record is Inactive: it is not an Active record carrying the words
  const r = base(); r[0].status = 'Inactive';
  scenario('inactive', r, reqC(), ['NOT LINKED: no Active record carries every word of this name (nothing changed)', 'LINKED 2 REQUEST(S)'], { [uid(6)]: 'PCC/2020/2026', [uid(7)]: 'PCC/2020/2026' });
}
{ // the ID written is another person's: the words are carried by somebody else
  const r = base(); r[1].name = 'PILI C CHUMBE'; r.push({ id: 'PCC/7777/2026', name: 'PILI CHUMBE JR', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Inactive', account: '1', bank: null });
  const r2 = r.map(x => x.id === 'PCC/2020/2026' ? { ...x, name: 'SOMEBODY ELSE' } : x).concat([{ id: 'PCC/8888/2026', name: 'PILI CHUMBE', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '1', bank: null }]);
  scenario('wrong id', r2, reqC(), ['LINKED 3 REQUEST(S)', 'NOT LINKED: that staff ID is not an Active record carrying every word of the name (nothing changed)'], { [uid(1)]: 'TBM/2027/2026', [uid(2)]: 'TBM/2027/2026', [uid(3)]: 'TBM/2027/2026' });
}
{ // the staff ID is in no record at all, and nobody carries the words
  const r = base().filter(x => x.id !== 'PCC/2020/2026');
  scenario('no record', r, reqC(), ['LINKED 3 REQUEST(S)', 'NOT LINKED: no Active record carries every word of this name (nothing changed)'], { [uid(1)]: 'TBM/2027/2026', [uid(2)]: 'TBM/2027/2026', [uid(3)]: 'TBM/2027/2026' });
}
{ // a registry name that is a substring of another word (the words must be carried, and one record only): a longer unrelated name does not matter when it does not carry both words
  const r = base().concat([{ id: 'XXX/1/2026', name: 'TATU OTHER', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '1', bank: null }]);
  scenario('another martin', r, reqC(), ['LINKED 3 REQUEST(S)', 'LINKED 2 REQUEST(S)'], { [uid(1)]: 'TBM/2027/2026', [uid(2)]: 'TBM/2027/2026', [uid(3)]: 'TBM/2027/2026', [uid(6)]: 'PCC/2020/2026', [uid(7)]: 'PCC/2020/2026' });
}
{ // nothing to link at all
  reset(); insReg(base()); insReq([{ ...reqC()[7] }]);
  same(runScript(C0).map(r => r[3]), [N, N], 'C nothing to link');
}
// the report's own join: a request with the staff ID printed from the registry (the account the report would print), by the report's own rule
const reportPrints = (r, s) => has(r.account) ? r.account : has(s.account) ? s.account : (r.account || s.account || null);
{ reset(); insReg(base()); insReq(reqC()); runScript(C0);
  const rows = psql('select a.id, coalesce(a.account, \'\'), coalesce(g.account, \'\') from public.advance_requests a left join public.staff_registry g on g.id = a.staff_id order by a.id').trim().split('\n').map(l => l.split('\t'));
  const printed = rows.map(([id, copy, regAcc]) => [id, reportPrints({ account: copy }, { account: regAcc })]);
  need(printed.find(r => r[0] === uid(1))[1] === '10474106999' && printed.find(r => r[0] === uid(6))[1] === '5551' && printed.find(r => r[0] === uid(8))[1] === null, 'C: the report prints the registry account for the linked requests and still blank for the one not linked: ' + JSON.stringify(printed)); }
// deliberate breaks of C: each must change a result of the scenarios
const scenariosC = () => {
  const outs = [];
  const run = (regR, reqsR, text = C0b) => {
    reset(); insReg(regR); insReq(reqsR); const o = runScript(text);
    const lg = psql("select coalesce(string_agg(coalesce(staff_id_before, '<null>') || '>' || staff_id_new, ',' order by id), '') from public.advance_requests_link_log").trim();
    outs.push(o.map(r => r[3]).join('|') + '#' + stateC().map(r => r.join('=')).join(',') + '#' + lg);
  };
  run(base(), reqC());
  run(base().concat([{ id: 'TBM/9999/2026', name: 'TATU MWANGAZA', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '99', bank: null }]), reqC());
  const r1 = base(); r1[0].status = 'Inactive'; run(r1, reqC());
  const r2 = base().map(x => x.id === 'PCC/2020/2026' ? { ...x, name: 'SOMEBODY ELSE' } : x).concat([{ id: 'PCC/8888/2026', name: 'PILI CHUMBE', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '1', bank: null }]); run(r2, reqC());
  run(base().concat([{ id: 'XXX/1/2026', name: 'TATU OTHER', role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: '1', bank: null }]), reqC());
  run(base(), reqC(), C0b.replace("'TBM/2027/2026'", "' tbm/2027/2026 '").replace("'PCC/2020/2026'", "'Pcc/2020/2026'"));
  return outs.join('\n');
};
let C0b = C0; const wantC = scenariosC();
const breaksC = [
  ['an ID already on a request is overwritten', s => s.replace("where a.staff_id is null or btrim(a.staff_id) = ''\n)", 'where true\n)')],
  ['the name is matched case-sensitively', s => s.replace("join w on upper(btrim(regexp_replace(a.staff_name, '\\s+', ' ', 'g'))) = w.key", "join w on a.staff_name = w.roster_name")],
  ['blanks inside the name are not collapsed', s => s.replace("join w on upper(btrim(regexp_replace(a.staff_name, '\\s+', ' ', 'g'))) = w.key", "join w on upper(btrim(a.staff_name)) = w.key")],
  ['a name that only starts like it is linked', s => s.replace("join w on upper(btrim(regexp_replace(a.staff_name, '\\s+', ' ', 'g'))) = w.key", "join w on upper(btrim(a.staff_name)) like w.key || '%'")],
  ['an Inactive record is linked', s => s.replace("on upper(btrim(coalesce(r.status, ''))) <> 'INACTIVE'\n                              and", 'on true\n                              and')],
  ['one word of the name is enough', s => s.replace("and not exists (select 1 from unnest(w.words) x where strpos(upper(r.name), x) = 0)", "and exists (select 1 from unnest(w.words) x where strpos(upper(r.name), x) > 0)")],
  ['two records may carry the words', s => s.replace('where n_carrying = 1 and is_it = 1', 'where is_it = 1')],
  ['the named ID need not carry the words', s => s.replace('where n_carrying = 1 and is_it = 1', 'where n_carrying = 1')],
  ['the old ID is not kept', s => s.replace('select t.id, t.staff_name, t.staff_id_was, t.staff_id from todo t', 'select t.id, t.staff_name, null, t.staff_id from todo t')],
  ['the staff ID is written in lower case', s => s.replace('set staff_id = t.staff_id', 'set staff_id = lower(t.staff_id)')],
  ['the ID the owner typed is not normalised', s => s.replace("select n, roster_name, upper(btrim(staff_id)) as staff_id,", 'select n, roster_name, staff_id,')],
];
let caughtC = 0;
for (const [label, f] of breaksC) {
  const t = f(C0);
  if (t === C0) { failures++; console.log('  FAIL: break "' + label + '" did not change the file'); continue; }
  C0b = t; let diff = false;
  try { diff = scenariosC() !== wantC; } catch (e) { diff = true; }
  if (diff) caughtC++; else { failures++; console.log('  FAIL: break NOT CAUGHT: ' + label); }
}
C0b = C0;
console.log(`  C: ${caughtC} of ${breaksC.length} deliberate breaks change a result`);
} finally { try { psqlIn('drop database if exists ' + DB, admin); } catch { /* none */ } }
if (failures) { console.log('\n' + failures + ' FAILURE(S)'); process.exit(1); }
console.log('\nOK: the files list who prints blank and why, find what the request tab finds, link only what they say and undo exactly, and they fail when broken.');
