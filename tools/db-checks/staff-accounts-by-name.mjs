/* STAFF ACCOUNTS BY NAME: db/TEMPLATE-staff-accounts-by-name.sql, run for real on a PostgreSQL (docs/HANDOFF.md Part 110).

     "Customer service staff accounts" -- the owner, 17 Nov 2026, twelve people with their bank and account
     "some info should be filled into their columns if missing or replace if existing since the provided is latest" -- the owner, 17 Nov 2026

   The file writes the staff registry (HR's staff database, which payroll is paid from): the wrong person updated, a second person added for somebody the registry already holds, or a role rewritten is not
   undone by saying sorry. It is not believed on a reading.

   THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database (staff_registry has the live book's columns and types), plus the one column the schema file does not create and the live
   Teams & Staff has: teams.zone (the zones filed are read from it and from the registry). No real name, staff ID or account is in this file: every person here is made up.
   It passes only when: for each scenario the file's answer and the registry afterwards EQUAL a MODEL written again in JavaScript (a realistic list of twenty rows of every kind: a person added, updated by a typed
   ID in lower case with a blank, found by exact name with two blanks in the registry's, a mark in a name, an Inactive record alone, two Active records of one name, close records by the same account and by words
   one letter apart, a name listed twice, an ID in no record, an ID that carries another name, a rename; no zone filed; marks in a name; a registry of 5,000 staff); a second run adds and updates nobody; the undo,
   run from the file's own comment lines, puts every staff back byte for byte and removes the staff added; THE REGISTRY IT LEAVES IS THE ONE TEMPLATE-staff-update-by-id.sql LEAVES for the same rows with the same
   IDs (full forms, a refused row, a name replaced); and EVERY ONE of a list of deliberate breaks changes an answer, the registry, the copy kept or the undo.

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/staff-accounts-by-name.mjs

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the file does what it says, and fails when broken. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SCHEMA = rd('db/schema.sql');
const DB = 'hope_staff_accounts';
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
const same = (a, b, msg) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) { failures++; console.log('  FAIL: ' + msg + '\n    got      ' + x.slice(0, 1800) + '\n    expected ' + y.slice(0, 1800)); } };
const D0 = rd('db/TEMPLATE-staff-accounts-by-name.sql');
const T0 = rd('db/TEMPLATE-staff-update-by-id.sql');
const LABEL = 'STAFF ACCOUNTS (SQL)';

const lit = v => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const dlit = v => v == null ? 'null' : "date '" + v + "'";
const COLS = ['id', 'cur', 'nw', 'phone', 'phone2', 'bank', 'account', 'nida', 'tin', 'nssf', 'birth', 'residence', 'started', 'kin1', 'kin1p', 'kin2', 'kin2p'];
const rowSql = (r, first) => {
  const t = (v, ty) => v == null ? (first ? 'null::' + ty : 'null') : (ty === 'date' ? dlit(v) : lit(v));
  return `(${r.n}, ${t(r.id, 'text')}, ${lit(r.cur)}, ${t(r.nw, 'text')}, ${t(r.phone, 'text')}, ${t(r.phone2, 'text')}, ${t(r.bank, 'text')}, ${t(r.account, 'text')}, ${t(r.nida, 'text')}, ${t(r.tin, 'text')}, ${t(r.nssf, 'text')}, ${t(r.birth, 'date')}, ${t(r.residence, 'text')}, ${t(r.started, 'date')}, ${t(r.kin1, 'text')}, ${t(r.kin1p, 'text')}, ${t(r.kin2, 'text')}, ${t(r.kin2p, 'text')})`;
};
const ASK_RE = /(ask\(n, id, cur_name, new_name, phone, phone2, bank, account, nida, tin, nssf, birth, residence, started, kin1, kin1_phone, kin2, kin2_phone\) as \(values\n)[\s\S]*?(\n\),\nak0 as \()/;
const WANT_RE = /(want\(n, id, cur_name, new_name, phone, phone2, bank, account, nida, tin, nssf, birth, residence, started, kin1, kin1_phone, kin2, kin2_phone\) as \(values\n)[\s\S]*?(\n\),\na as \()/;
const withRows = (text, rows, re = ASK_RE) => { need(re.test(text), 'the VALUES block is where the check expects it'); return text.replace(re, (m, a, b) => a + rows.map((r, i) => '  ' + rowSql(r, i === 0)).join(',\n') + b); };

try {
psqlTo('drop database if exists ' + DB, admin); psqlTo('create database ' + DB + " template template0 encoding 'UTF8'", admin);
psqlIn(SCHEMA);
psqlIn('alter table public.teams add column if not exists zone text');   // the live Teams & Staff has it; schema.sql does not create it
// ---- the registry
const REGCOLS = ['id', 'name', 'role', 'zone', 'status', 'account', 'bank', 'phone', 'phone2', 'nida', 'tin', 'nssf', 'birth_date', 'residence', 'reg_date', 'guarantor1', 'guarantor1_phone', 'guarantor2', 'guarantor2_phone'];
const reset = () => psqlIn('truncate public.staff_registry; drop table if exists public.staff_registry_update_before; delete from public.teams;');
const insReg = reg => psqlIn('insert into public.staff_registry (' + REGCOLS.join(', ') + ') values ' + reg.map(r => '(' + REGCOLS.map(c => r[c] == null ? 'null' : (c === 'birth_date' || c === 'reg_date') ? dlit(r[c]) : lit(r[c])).join(', ') + ')').join(',\n'));
const snapshot = () => lines(psqlIn(`select ${REGCOLS.join(', ')}, created_by, updated_by from public.staff_registry order by id collate "C"`)).map(l => l.split('\t'));
const YEAR = psqlIn("select to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY')").trim();

// ---- the model
const K = s => String(s == null ? '' : s).toUpperCase().replace(/['`\u2019]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
const CU = s => String(s).toUpperCase().replace(/\s+/g, ' ').trim();
const live = st => String(st == null ? '' : st).trim().toUpperCase() !== 'INACTIVE';
const akeyOf = a => String(a == null ? '' : a).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
const accountW = a => { if (a == null) return null; if (/^[\d.\s-]+$/.test(a)) { const d = a.replace(/\D/g, ''); return d === '' ? null : d; } const t = String(a).trim(); return t === '' ? null : t; };
const lcp = (x, y) => { let g = 0; while (g < Math.min(x.length, y.length) && x[g] === y[g]) g++; return g; };
const lcs = (x, y) => { let g = 0; while (g < Math.min(x.length, y.length) && x[x.length - 1 - g] === y[y.length - 1 - g]) g++; return g; };
const near = (x, y) => x === y || (Math.abs(x.length - y.length) <= 1 && (x[0] === y[0] || x[x.length - 1] === y[y.length - 1]) && lcp(x, y) + lcs(x, y) >= Math.max(x.length, y.length) - 1);
const cmpC = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function model(reg, rows, { label = LABEL, newRole = 'CALL AGENT', newZone = 'HQ - CUSTOMER SERVICE' } = {}) {
  const R = reg.map(r => ({ ...r, k: K(r.name), live: live(r.status), akey: akeyOf(r.account) }));
  const byId = new Map(R.map(r => [r.id, r]));
  const zoneKey = z => String(z || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const filedZone = R.map(r => r.zone).find(z => zoneKey(z) === zoneKey(newZone) && zoneKey(z) !== '');
  const seen = new Map();
  const top = Math.max(R.length, ...R.map(r => { const m = String(r.id).split('/')[1]; return /^\d{1,6}$/.test(m || '') ? Number(m) : 0; }));
  const out = []; const newRegs = []; const updates = new Map();
  let added = 0;
  for (const r of rows) {
    const k = K(r.cur), idKey = r.id != null ? String(r.id).trim().toUpperCase() : null;
    const dupKey = idKey || k; const nth = (seen.get(dupKey) || 0) + 1; seen.set(dupKey, nth);
    const exact = R.filter(x => x.k === k), liveRecs = exact.filter(x => x.live);
    const res = { live_n: idKey ? 0 : liveRecs.length, all_n: idKey ? 0 : exact.length, ids: exact.map(x => x.id + ' [' + x.status + ']').sort(cmpC).join('; ') };
    let sid = null;
    if (nth === 1) sid = idKey || (res.live_n === 1 ? liveRecs[0].id : null);
    const rec = sid ? byId.get(sid) : null;
    const ok = !!rec && rec.k === K(r.cur) || (!!rec && r.nw != null && rec.k === K(r.nw));
    const o = { n: r.n, name: CU(r.cur), done: null, staff_id: '', name_in: '', filled: '', replaced: '', same: '', look: '' };
    if (nth > 1) o.done = 'LISTED TWICE: this row repeats an earlier one: nothing changed';
    else if (idKey && !rec) o.done = 'NO STAFF WITH THAT ID: nothing changed';
    else if (idKey && !ok) o.done = 'THAT ID CARRIES ANOTHER NAME (' + rec.name + '): nothing changed';
    else if (ok) {
      const kinds = {};
      const newKey = r.nw == null || CU(r.nw) === '' ? null : CU(r.nw);
      if (newKey != null) kinds.name = CU(rec.name) !== newKey ? 'replaced' : 'same';
      const nb = r.bank != null && String(r.bank).trim() !== '' ? String(r.bank).trim().toUpperCase() : null;
      if (nb != null) { const ob = rec.bank != null && String(rec.bank).trim() !== '' ? String(rec.bank).trim().toUpperCase() : null; kinds.bank = ob == null ? 'filled' : ob !== nb ? 'replaced' : 'same'; }
      const aw = accountW(r.account);
      if (aw != null) { const oa = rec.account != null && String(rec.account).trim() !== '' ? String(rec.account).trim().toUpperCase() : null; kinds.account = oa == null ? 'filled' : oa !== aw.toUpperCase() ? 'replaced' : 'same'; }
      const order = ['name', 'bank', 'account'];
      const list = k => order.filter(b => kinds[b] === k).join(', ');
      o.filled = list('filled'); o.replaced = list('replaced'); o.same = list('same');
      const changed = order.some(b => kinds[b] === 'filled' || kinds[b] === 'replaced');
      o.done = changed ? 'UPDATED' : 'NOTHING TO CHANGE: the registry already holds all of it';
      o.staff_id = rec.id; o.name_in = newKey != null ? newKey : rec.name;
      if (changed) updates.set(rec.id, { name: kinds.name === 'replaced' ? newKey : undefined, bank: kinds.bank === 'filled' || kinds.bank === 'replaced' ? String(r.bank).trim() : undefined, account: kinds.account === 'filled' || kinds.account === 'replaced' ? aw : undefined });
    } else if (res.live_n >= 2) o.done = 'NOT CHANGED: ' + res.live_n + ' ACTIVE RECORDS CARRY THIS NAME (' + res.ids + ')';
    else if (res.all_n >= 1) o.done = 'NOT CHANGED: THE ONLY RECORD WITH THIS NAME IS INACTIVE (' + res.ids + ')';
    else {
      // who could it be: the same account on another record, or two words of the name the same or one letter apart
      const words = k.split(' ').map((w, i) => [w, i]).filter(([w]) => w.length >= 3);
      const ak = akeyOf(r.account);
      const cands = [];
      for (const g of R) {
        const gw = g.k.split(' ').filter(w => w.length >= 3);
        const nearN = words.filter(([w]) => gw.some(v => near(w, v))).length;
        const sameAcct = ak.length >= 8 && g.akey === ak;
        if (sameAcct) cands.push({ g, rank: 1, nearN: 0, how: 'the same account' });
        else if (nearN >= 2) cands.push({ g, rank: 2, nearN, how: nearN + ' of its words the same or one letter apart' });
      }
      cands.sort((a, b) => a.rank - b.rank || b.nearN - a.nearN || cmpC(a.g.id, b.g.id));
      if (cands.length) {
        o.done = 'NOT CHANGED: NOT FOUND UNDER THIS NAME; THE CLOSE RECORDS ARE LISTED';
        o.look = cands.slice(0, 4).map(c => c.g.id + ' [' + (c.g.status == null ? '-' : c.g.status) + ', ' + (c.g.role == null ? '-' : c.g.role) + ', ' + (c.g.zone == null ? '-' : c.g.zone) + '] "' + CU(c.g.name) + '" (' + c.how + ')').join(' ; ');
      } else if (filedZone == null) o.done = 'NOT ADDED: no zone named ' + newZone + ' is filed';
      else {
        added++;
        const initials = CU(r.cur).split(' ').map(w => w.replace(/[^A-Z]/g, '')).filter(Boolean).slice(0, 3).map(w => w[0]).join('');
        const serial = top + added;
        const id = (initials || 'STF') + '/' + (serial < 1000 ? String(serial).padStart(3, '0') : String(serial)) + '/' + YEAR;
        const aw = accountW(r.account);
        newRegs.push({ id, name: CU(r.cur), role: newRole, zone: CU(filedZone), status: 'Active', account: aw, bank: r.bank != null && String(r.bank).trim() !== '' ? String(r.bank).trim() : null, created_by: label });
        o.done = 'ADDED'; o.staff_id = id; o.name_in = CU(r.cur);
        o.filled = 'a new staff: name, role, zone' + (aw != null ? ', account' : '') + (newRegs[newRegs.length - 1].bank != null ? ', bank' : '');
      }
    }
    out.push(o);
  }
  return { out, newRegs, updates };
}
const answerOf = rows => rows.map(r => ({ n: r[0], name: r[1], done: r[2], staff_id: r[3] || '', name_in: r[4] || '', filled: r[5] || '', replaced: r[6] || '', same: r[7] || '', look: r[9] || '' }));
const expectOf = m => m.out.map(o => ({ n: String(o.n), name: o.name, done: o.done, staff_id: o.staff_id, name_in: o.name_in, filled: o.filled, replaced: o.replaced, same: o.same, look: o.look }));
// the state the model says the registry is in afterwards
function stateAfter(reg, m) {
  const out = reg.map(r => ({ ...r }));
  for (const r of out) { const u = m.updates.get(r.id); if (u) { if (u.name !== undefined) r.name = u.name; if (u.bank !== undefined) r.bank = u.bank; if (u.account !== undefined) r.account = u.account; } }
  return out.concat(m.newRegs);
}
const projection = recs => recs.map(r => [r.id, r.name, r.role || '', r.zone || '', r.status || '', r.account || '', r.bank || '']).sort((a, b) => cmpC(a[0], b[0]));
const dbProjection = () => lines(psqlIn(`select id, name, coalesce(role,''), coalesce(zone,''), coalesce(status,''), coalesce(account,''), coalesce(bank,'') from public.staff_registry order by id collate "C"`)).map(l => l.split('\t'));
const undoOf = text => text.split('\n').filter(l => /^-- (update|  guarantor1|  from|delete)/.test(l)).map(l => l.replace(/^-- /, '')).join('\n');

// ---- fixtures
const S = (id, name, extra = {}) => ({ id, name, role: 'CALL AGENT', zone: 'HQ - CUSTOMER SERVICE', status: 'Active', account: null, bank: null, ...extra });
const baseReg = () => [
  S('NBM/2361/2026', "NURU BAHATI MWANG'ULA", { account: '10411111111', bank: 'CRDB' }),
  S('ZLK/2363/2026', 'Zawadi Lameck Kipute', { account: '999111222', bank: 'NMB' }),
  S('RKL/2019/2026', 'RAHMA K. LUGANO'),
  S('ADT/2029/2026', 'ASIA DAMIAN TARIMO', { account: 'N/A' }),
  S('BLN/2360/2026', 'BARAKA LUOGA NKYA', { account: '10444444444', bank: 'CRDB' }),
  S('JEM/4421/2026', 'JOYCE ELIA  MWITA', { account: '62511111111' }),                      // two blanks in the registry
  S('FOK/0100/2026', 'FADHILA SAIDY KIBWANA', { account: '777', bank: 'NMB' }),                 // spelt another way than the list's: close
  S('MKL/2020/2026', 'MUSSA KHAMIS LYIMO', { role: 'CALL AGENT - ASSISTANT SUPERVISOR', account: '1234567890' }),
  S('DUP/0001/2026', 'ELIZABETH JUMA MAGANGA'), S('DUP/0002/2026', 'Elizabeth Juma  Maganga', { status: 'Inactive' }),   // active + inactive duplicate: the Active one
  S('TWO/0001/2026', 'PASCAL SIMON KIYUNGI'), S('TWO/0002/2026', 'PASCAL SIMON KIYUNGI'),           // two Active records of one name
  S('OFF/0001/2026', 'HASSAN ABEID NDEKI', { status: 'Inactive' }),                                  // the only record is Inactive
  S('FO/0001/2026', 'SOPHIA ISMAILI CHACHA', { account: '23511111111', role: 'Field Officer - X', zone: 'NORTH' }),   // the same account as the list's, another spelling
  S('FO/0002/2026', 'YUSUPH ABASI', { role: 'Field Officer - Kiboroloni', zone: 'DAR NORTH' }),
  S('JSM/0307/2026', 'JUMANNE SELEMANI MOSHI', { role: 'Field Officer - Arusha', zone: 'SOUTH WEST' }),
  S('BIG/4458/2026', 'SOMEBODY ELSE', { role: 'Field Officer', zone: 'MARA' }),
  S('SHR/0001/2026', 'BARAKA LUOGA'),                                                               // a shorter name: a candidate for nobody, but it must not be mistaken for BARAKA LUOGA NKYA
];
const R = (n, cur, o = {}) => ({ n, id: null, cur, nw: null, phone: null, phone2: null, bank: null, account: null, nida: null, tin: null, nssf: null, birth: null, residence: null, started: null, kin1: null, kin1p: null, kin2: null, kin2p: null, ...o });
const scenarioRows = () => [
  R(1, 'DAUDI MARCO SANGA', { bank: 'CRDB', account: '0152000000001' }),                          // nobody: added
  R(2, 'SOPHIA ISMAIL CHACHA', { bank: 'NMB', account: '23511111111' }),                                 // the same account on another record: listed, not added
  R(3, "NURU BAHATI MWANG'ULA", { id: 'NBM/2361/2026', account: '10411111111' }),               // the same account: nothing to change
  R(4, 'ZAWADI LAMECK KIPUTE', { id: 'zlk/2363/2026 ', bank: 'CRDB', account: '10422222222' }),        // a typed ID in lower case with a blank: found; bank and account replaced
  R(5, 'HASSAN ABEID NDEKI', { account: '10311111111' }),                                           // the only record is Inactive
  R(6, 'PASCAL SIMON KIYUNGI', { bank: 'NMB', account: '24711111111' }),                           // two Active records
  R(7, 'ELIZABETH JUMA MAGANGA', { bank: 'ECOBANK', account: '7055000001' }),                       // the Active one of a pair: found by exact name
  R(8, 'ASIA DAMIAN TARIMO', { bank: 'CRDB', account: '10433333333' }),                              // junk account: filled
  R(9, 'BARAKA LUOGA NKYA', { bank: 'CRDB', account: '10444444444' }),                            // the same
  R(10, 'JOYCE ELIA MWITA', { bank: 'NMB', account: '62511111111' }),                            // the registry has two blanks in the name: found; account the same, bank filled
  R(11, 'FADHILA SAIDI KIBWANA', { account: '0152000000002' }),                                      // close to a record: listed, not added
  R(12, 'RAHMA K. LUGANO', { id: 'RKL/2019/2026', nw: 'RAHMA KASSIM LUGANO', account: '0152000000003' }),   // renamed
  R(13, 'MARIA ONE', { account: '12345678' }),                                                        // nobody: added (two added with the same initials)
  R(14, 'MARIA ONE', { account: '12345678' }),                                                        // listed twice
  R(15, 'KELVIN OTIENO MWAURA', { account: '4455667788' }),                                             // nobody: added
  R(16, 'ID MISTYPED', { id: 'NOPE/0000/2026', account: '1' }),                                       // no such ID
  R(17, 'SOMEONE ELSE', { id: 'BIG/4458/2026', account: '1' }),                                       // an ID that carries another name
  R(18, 'BARAKA LUOGA', { account: '5555555555' }),                                                  // exact name of the shorter record: found, filled
  R(19, 'MUSSA KHAMIS LYIMO', { account: '1234567890', bank: 'NMB' }),                               // account the same, bank filled; the role is not touched
  R(20, 'YUSUPH ABASI', { account: '8888888888' }),                                                  // found by exact name in a field officer zone: filled
];

console.log('D. the accounts template');
let scen = 0;
function scenario(label, reg, rows, text = D0, opts = {}) {
  reset(); insReg(reg);
  const m = model(reg, rows, opts);
  const got = run(withRows(text, rows));
  same(answerOf(got), expectOf(m), label + ': the answer');
  same(dbProjection(), projection(stateAfter(reg, m)), label + ': the registry afterwards');
  scen++;
  return { m, got };
}
const rows0 = scenarioRows();
const s1 = scenario('the realistic list', baseReg(), rows0);
{ const added = s1.m.newRegs.map(r => r.id); need(added.length === 3 && new Set(added).size === 3, 'three people added with three different IDs: ' + added.join(',')); }
// the kinds of row the fixture must hold, or the check proves nothing
{ const dones = new Set(s1.m.out.map(o => o.done.split(':')[0].replace(/ \(.*$/, '').trim())); for (const d of ['ADDED', 'UPDATED', 'NOTHING TO CHANGE', 'LISTED TWICE', 'NO STAFF WITH THAT ID', 'THAT ID CARRIES ANOTHER NAME', 'NOT CHANGED']) need([...dones].some(x => x.startsWith(d.split(':')[0])), 'the realistic list holds a row of the kind ' + d);
  need(s1.m.out.some(o => o.done.includes('ACTIVE RECORDS CARRY')) && s1.m.out.some(o => o.done.includes('INACTIVE')) && s1.m.out.some(o => o.look.includes('the same account')) && s1.m.out.some(o => o.look.includes('of its words')), 'ambiguous, inactive and both kinds of close record are in the list'); }
// a second run changes nothing and adds nobody
{ const before = snapshot(); const again = run(withRows(D0, rows0)); same(snapshot(), before, 'a second run changed the registry'); const a = answerOf(again);
  need(a.every(x => !['ADDED', 'UPDATED'].includes(x.done)), 'a second run says ADDED or UPDATED: ' + a.filter(x => ['ADDED', 'UPDATED'].includes(x.done)).map(x => x.n + ' ' + x.done).join(', '));
  need(a.filter(x => x.n === '1' || x.n === '13' || x.n === '15').every(x => x.done.startsWith('NOTHING TO CHANGE')), 'the people added the first time are found by their exact name the second'); }
// the undo: the updates put back, the added removed, byte for byte
{ reset(); insReg(baseReg()); const before = snapshot(); run(withRows(D0, rows0)); need(JSON.stringify(snapshot()) !== JSON.stringify(before), 'the run changed something');
  const undo = undoOf(D0);
  need(/delete from public\.staff_registry where created_by/.test(undo) && /update public\.staff_registry s set/.test(undo), 'the undo is at the foot of the file');
  psqlIn(undo); const after = snapshot();
  // updated_by / updated_at are put back from the copy: compare every column but the two the run stamps on a row that did not change
  same(after.map(r => r.slice(0, REGCOLS.length)), before.map(r => r.slice(0, REGCOLS.length)), 'the undo puts every staff back as it was'); }
// no zone filed: nobody can be added
scenario('no zone is filed', baseReg().filter(r => r.zone !== 'HQ - CUSTOMER SERVICE'), [R(1, 'DAUDI MARCO SANGA', { account: '0152000000001' }), R(2, 'MARIA ONE', { account: '1' })]);
// only the ones in the registry
scenario('an empty registry adds nobody without a zone', [S('ONE/0001/2026', 'ONE TWO', { zone: 'NORTH' })], [R(1, 'ALPHA BETA GAMMA', { account: '5' })]);
// apostrophes and marks
scenario('marks in a name', [S('MK/0001/2026', "ANN-MARIE O'NEIL"), S('MK/0002/2026', 'JOHN K. DOE')], [R(1, 'ANN MARIE ONEIL', { account: '12121212' }), R(2, 'JOHN K DOE', { account: '34343434', bank: 'NMB' }), R(3, "JOHN K. DOE", { account: '99', bank: 'NMB' })]);
// a book as large as the live one: the answer and the time
{ reset(); const big = []; for (let i = 0; i < 5000; i++) big.push(S('B' + String(i).padStart(4, '0') + '/' + (1000 + i) + '/2026', 'NAMEA' + (i % 700) + ' NAMEB' + (i % 331) + ' NAMEC' + (i % 97), { zone: i % 3 ? 'NORTH' : 'HQ - CUSTOMER SERVICE', account: i % 4 ? String(1000000000 + i * 7) : null }));
  insReg(big); const t0 = Date.now(); const rows = [R(1, 'NAMEA5 NAMEB5 NAMEC5', { account: '5555555555' }), R(2, 'ZZ YY XX', { account: '6666666666' }), R(3, 'NAMEA6 NAMEB6 NAMEC7', { account: '7777777777' })];
  const m = model(big, rows); const got = run(withRows(D0, rows)); const secs = (Date.now() - t0) / 1000; same(answerOf(got), expectOf(m), 'a registry of 5,000: the answer'); console.log('  5,000 staff, three rows: ' + secs.toFixed(2) + ' s'); need(secs < 8, 'a registry of 5,000 took ' + secs + ' s'); }

// ---- the update engine is the template's: the same rows with the same IDs make the same registry as TEMPLATE-staff-update-by-id.sql
{ const reg = baseReg(); const detail = [
    R(1, 'JUMANNE SELEMANI MOSHI', { id: 'JSM/0307/2026', phone: '0712000111', bank: 'CRDB', account: '10499999999', nida: '19900101123456789012', tin: '123456789', birth: '1990-01-01', residence: 'ARUSHA, ARUSHA', started: '2026-01-15', kin1: 'MAMA MWAJUMA (MAMA)', kin1p: '0713000222', kin2: 'BABA SELEMANI (MTU WA KARIBU)', kin2p: '0714000333' }),
    R(2, 'RAHMA K. LUGANO', { id: 'RKL/2019/2026', nw: 'RAHMA KASSIM LUGANO', phone: '0712345678', account: '0152000000003', nida: '123' }),
    R(3, 'ASIA DAMIAN TARIMO', { id: 'ADT/2029/2026', bank: 'CRDB', account: '10433333333', phone: '255755111222', nssf: '12-345', residence: 'dar es salaam' }),
    R(4, 'WRONG NAME', { id: 'BLN/2360/2026', account: '1' }), R(5, 'NOBODY', { id: 'NO/1/2026', account: '1' }),
    R(6, 'ZAWADI LAMECK KIPUTE', { id: 'ZLK/2363/2026', bank: 'nmb', account: '999111222' }),
  ];
  const withTemplate = (text, rows) => withRows(text, rows, WANT_RE);
  // the template's list has the same eighteen columns
  const tOut = (() => { reset(); insReg(reg); run(withTemplate(T0, detail)); return snapshot(); })();
  const dOut = (() => { reset(); insReg(reg); run(withRows(D0, detail)); return snapshot(); })();
  same(dOut.map(r => r.slice(0, REGCOLS.length)), tOut.map(r => r.slice(0, REGCOLS.length)), 'the update engine writes what the by-ID template writes (full boxes)'); }

// ---- deliberate breaks: each must change an answer or the registry in at least one of the scenarios
const scenariosForBreak = text => {
  const outs = [];
  const one = (reg, rows) => {
    reset(); insReg(reg); const got = run(withRows(text, rows));
    const afterRun = dbProjection(), copies = psqlIn('select count(*) from public.staff_registry_update_before').trim();
    psqlIn(undoOf(text));
    outs.push(JSON.stringify([got, afterRun, copies, dbProjection()]));
  };
  one(baseReg(), rows0);
  one(baseReg().filter(r => r.zone !== 'HQ - CUSTOMER SERVICE'), [R(1, 'DAUDI MARCO SANGA', { account: '0152000000001' })]);
  one([S('MK/0001/2026', "ANN-MARIE O'NEIL"), S('MK/0002/2026', 'JOHN K. DOE')], [R(1, 'ANN MARIE ONEIL', { account: '12121212' }), R(2, 'JOHN K DOE', { account: '34343434', bank: 'NMB' })]);
  one([...baseReg(), S('LNG/0001/2026', 'BARAKA LUOGA NKYA JUNIOR')], [R(1, 'BARAKA LUOGA', { account: '5555555555' }), R(2, 'RAHMA LUGANO', { account: '77777777' })]);
  // a registry whose largest staff number is small: the serial must still be past the count of rows
  one([S('AB/0001/2026', 'AB ONE'), S('AB/0002/2026', 'AB TWO'), S('AB/0003/2026', 'AB THREE'), S('ZZ/0001/2026', 'ZZ ONE'), S('ZZ/0002/2026', 'ZZ TWO')], [R(1, 'MARIA ONE', { account: '1' }), R(2, 'KELVIN OTIENO', { account: '2' })]);
  return outs.join('\n');
};
const wantBreaks = scenariosForBreak(D0);
const breaks = [
  ['a name with no ID is found by a part of a longer name', s => s.replace('from ak a left join rg r on a.id is null and r.k = a.k', "from ak a left join rg r on a.id is null and r.k like a.k || '%'")],
  ['an Inactive record counts as Active', s => s.replace("upper(btrim(coalesce(s.status, ''))) <> 'INACTIVE' as live,", 'true as live,')],
  ['two Active records of one name are not told', s => s.replace("when r.live_n >= 2 then 'NOT CHANGED: '", "when r.live_n >= 3 then 'NOT CHANGED: '")],
  ['the ID guard ignores the name', s => s.replace('(b.sid is not null and b.s_k in (b.cur_k, coalesce(b.new_k, b.cur_k))) as ok', '(b.sid is not null) as ok')],
  ['a typed ID is read as typed', s => s.replace('coalesce(upper(btrim(a.id)), case when r.live_n = 1 then r.live_id end)', 'coalesce(a.id, case when r.live_n = 1 then r.live_id end)')],
  ['an apostrophe or a dot is not dropped from the registry names', s => s.replace("btrim(regexp_replace(translate(upper(s.name), '''`' || chr(8217), ''), '[^A-Z0-9]+', ' ', 'g')) as k,", "btrim(upper(s.name)) as k,")],
  ['the same account on another record is not a candidate', s => s.replace("join rg r on length(ltrim(regexp_replace(upper(coalesce(a.account, '')), '[^A-Z0-9]', '', 'g'), '0')) >= 8", "join rg r on length(ltrim(regexp_replace(upper(coalesce(a.account, '')), '[^A-Z0-9]', '', 'g'), '0')) >= 80")],
  ['one word is enough for a candidate', s => s.replace('from nw where nw.near_n >= 2', 'from nw where nw.near_n >= 1')],
  ['a word one letter apart is not near', s => s.replace('aw.w = rw.w\n                  or (abs(length(aw.w) - length(rw.w)) <= 1', 'aw.w = rw.w\n                  or (false and abs(length(aw.w) - length(rw.w)) <= 1')],
  ['somebody close is added anyway', s => s.replace('and not exists (select 1 from cands cd where cd.n = a.n)', '')],
  ['somebody is added with no zone filed', s => s.replace('  where n.zone is not null\n)', ')')],
  ['an Inactive or doubled name is added again', s => s.replace('where k.id is null and k.nth = 1 and r.all_n = 0 and not exists', 'where k.id is null and k.nth = 1 and r.live_n = 0 and not exists')],
  ['the serial ignores the count of rows', s => s.replace('select greatest(count(*), coalesce(max(', 'select greatest(0, coalesce(max(')],
  ['the serial is not past the largest number', s => s.split("(select top from num) + row_number()").join("(select count(*) from staff_registry) + row_number()")],
  ['the role of an added staff is another', s => s.replace("(select new_role from cfg), n.residence", "'Field Officer', n.residence")],
  ['an added staff is Inactive', s => s.replace("'Active', (select label from cfg), (select label from cfg), now()", "'Inactive', (select label from cfg), (select label from cfg), now()")],
  ['a name listed twice is applied twice', s => s.replace('partition by coalesce(upper(btrim(s.id)), s.k) order by s.n', 'partition by s.n order by s.n')],
  ['a replaced account is not replaced', s => s.replace("(5,  'account',         c.o_account,", "(5,  'account',         upper(c.account_w),")],
  ['a bank is never replaced', s => s.replace("(4,  'bank',            c.o_bank,", "(4,  'bank',            upper(nullif(btrim(c.bank), '')),")],
  ['the copy before the change is not taken', s => s.replace('from staff_registry s join todo t on t.sid = s.id\n  where not exists', 'from staff_registry s join todo t on t.sid = s.id\n  where false and not exists')],
  ['the undo forgets the staff added', s => s.replace("-- delete from public.staff_registry where created_by = '" + LABEL + "';\n", '')],
  ['the name of a person found by ID is replaced when none is sent', s => s.replace("set name       = case when t.k->>'name' in ('filled', 'replaced') then t.new_key else s.name end,", "set name       = coalesce(t.new_key, upper(s.name)),")],
  ['the role is rewritten on an update', s => s.replace('     set name       = case', "     set role = 'X', name       = case")],
];
let caught = 0;
for (const [label, f] of breaks) {
  const t = f(D0);
  if (t === D0) { failures++; console.log('  FAIL: break "' + label + '" did not change the file'); continue; }
  let diff = false;
  try { diff = scenariosForBreak(t) !== wantBreaks; } catch (e) { failures++; console.log('  FAIL: break "' + label + '" does not run (a malformed break is a failure of the check, not a caught break): ' + String(e.message).slice(0, 160)); continue; }
  if (diff) caught++; else { failures++; console.log('  FAIL: break NOT CAUGHT: ' + label); }
}
console.log(`  ${scen} scenarios; ${caught} of ${breaks.length} deliberate breaks change an answer`);
} finally { try { psqlTo('drop database if exists ' + DB, admin); } catch { /* none */ } }
if (failures) { console.log('\n' + failures + ' FAILURE(S)'); process.exit(1); }
console.log('\nOK: the template finds, updates, adds and lists what it says, undoes exactly, leaves the registry the by-ID template leaves, and fails when broken.');
