/* THE STAFF UPDATE FROM A FORM, BY STAFF ID -- db/TEMPLATE-staff-update-by-id.sql, run for real on a PostgreSQL.

     "some info should be filled into their columns if missing or replace if existing since the provided is latest" -- the owner, 17 Nov 2026

   The template CHANGES THE OWNER'S STAFF REGISTRY and, unlike every other staff script, REPLACES what is there (a name, a phone, an account, a NIDA, relatives). So it is not believed on a reading.

   THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database (staff_registry has the columns and types the live table has), and the file RUN AS IT IS WRITTEN: the example row of the template
   is replaced by a generated list, nothing else of the file is touched. The fixture knows the truth: 96 staff with every box in every state a form meets (empty, the same number written another way
   -- a phone with or without 0 or 255, a NIDA with dashes, an account with a lost leading zero, capitals or not -- another value, a junk word), a row that gives the box and a row that leaves it null,
   a NIDA of twenty digits whose date is a day of the calendar, one that is not a day, one of 22 digits, a birth date that agrees with the NIDA and one that does not, relatives who are the same person,
   another person with and without a number, a new name the registry already carries on somebody else, a wrong ID, a right ID with another name, a name already replaced by an earlier run.

   It passes only when: EVERY COLUMN of EVERY STAFF equals what a MODEL written again in JavaScript says after the run (the staff nobody named byte for byte); EVERY LINE the file prints equals the model's
   (done, name before and after, the boxes filled / replaced / cleared / already the same, the notes); the before-images hold exactly the rows changed, with what they held; a second run changes nothing and
   says so; the undo at the foot puts the whole registry back byte for byte; no printed line holds a phone, an account, a NIDA or any value; the file works on a registry ten times the live one in seconds;
   and EVERY ONE of a list of deliberate breaks of the file changes the outcome.

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/staff-update.mjs

   It makes, uses and drops its own scratch databases. NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(path.join(ROOT, 'db/TEMPLATE-staff-update-by-id.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
const SEP = '\x1f', TPL = 'hope_su_tpl', RUN = 'hope_su_run', LABEL = 'GMO ZONE NAME UPDATE (SQL)';
const psql = (sql, db = RUN) => {
  try { return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', SEP, '-d', db, '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { const err = new Error('psql failed: ' + String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 3).join(' | ')); err.psql = String(e.stderr || ''); throw err; }
};
let seed = 20261117;                                               // mulberry32
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const p2 = n => String(n).padStart(2, '0');
const q = v => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const qd = v => v == null ? 'null::date' : "date '" + v + "'";

const admin = process.env.PGDATABASE || 'postgres';
const drop = db => { try { psql('drop database if exists ' + db, admin); } catch { /* none */ } };
drop(TPL); drop(RUN);
const fails = [];
const check = (name, ok, extra) => { if (!ok) fails.push(name + (extra ? ' -- ' + extra : '')); console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok || !extra ? '' : ' -- ' + extra)); };
let exitCode = 1;
try {
  psql('create database ' + TPL, admin);
  psql(SCHEMA, TPL);
  // ---- the rules, written again ----------------------------------------------------------------------------------------------------------------------
  const norm = s => (s == null ? null : (s.replace(/ +/g, ' ').trim().toUpperCase() || null));
  const digitsOf = s => (s == null ? null : (s.replace(/\D/g, '') || null));
  const nine = s => { if (s == null) return null; let d = s.replace(/\D/g, '').replace(/^255/, '').replace(/^0+/, ''); d = d.slice(-9); return d.length === 9 ? d : null; };
  const accountW = a => (a == null ? null : (/^[\d.\s-]+$/.test(a) ? digitsOf(a) : (a.trim() || null)));
  const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const nidaDate = d => {                                                          // the date in the first eight digits of a NIDA of twenty digits, when it is a day of the calendar
    if (d == null || d.length !== 20 || !/^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/.test(d)) return null;
    const y = +d.slice(0, 4), m = +d.slice(4, 6), dd = +d.slice(6, 8);
    return dd <= dim(y, m) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
  };
  const dmy = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  // ---- the registry: 96 staff, every box in every state; and 300 others the list never names ------------------------------------------------------------
  const FIRST = ['AMINA', 'JUMA', 'NEEMA', 'HASSAN', 'ZAINAB', 'OMARI', 'FATUMA', 'BAKARI', 'SALMA', 'RAJABU'], LAST = ['MKWAWA', 'KIMARO', 'MSUYA', 'SWAI', 'MREMA', 'KOMBA', 'LEMA', 'MOSHI'];
  const rnum = n => String(int(1, 9)) + Array.from({ length: n - 1 }, () => int(0, 9)).join('');
  const rphone = () => pick(['6', '7']) + Array.from({ length: 8 }, () => int(0, 9)).join('');      // a real mobile number: nine digits, the first 6 or 7
  const people = [];
  const phoneForms = d9 => [d9, '0' + d9, '255' + d9, '+255' + d9, '0' + d9.slice(0, 3) + ' ' + d9.slice(3, 6) + ' ' + d9.slice(6)];
  for (let i = 0; i < 96; i++) {
    const p = { i, id: `T${String(i).padStart(2, '0')}/${3000 + i}/2026`, role: pick(['PMO', 'RECOVERY', 'Field Officer - MABIBO', 'GMO', 'MANAGER']), zone: pick(['HQ - PMO', 'DAR EAST', 'MARA']), status: i % 11 === 5 ? 'Inactive' : 'Active' };
    p.name0 = `${FIRST[i % 10]} ${LAST[(i * 3 + 1) % 8]} T${i}`;                                   // the name the registry carries
    const nm = i % 6;                                                                              // the name the row gives: none, the same, fuller, another spelling, one somebody else carries, a case/space variant of the same
    p.newName = [null, p.name0, p.name0 + ' EXTRA', `${FIRST[(i + 3) % 10]} ${LAST[i % 8]} N${i}`, 'DECOY ONE', p.name0.toLowerCase().replace(' ', '  ')][nm];
    p.curName = i % 17 === 3 ? 'SOMEBODY ELSE ENTIRELY' : p.name0;                                // a right ID with the wrong name
    p.noId = i % 23 === 7;                                                                         // an ID the registry does not hold
    // the number boxes: the registry's state (e = empty, s = the same number written another way, d = another value, j = junk) and the row's (g = given, n = null)
    const st = () => pick(['e', 's', 'd', 'j', 's', 'd']); const gv = () => pick(['g', 'g', 'n']);
    const ph = rphone(), ph2 = rphone();
    p.phoneW = gv() === 'g' ? pick(phoneForms(ph)) : null; p.phoneS = ((s) => s === 'e' ? null : s === 's' ? pick(phoneForms(ph)) : s === 'd' ? rphone() : 'N/A')(st());
    if (i % 29 === 4) p.phoneW = '12345';                                                         // not a nine-digit number: never written
    p.phone2W = gv() === 'g' && i % 3 === 0 ? pick(phoneForms(ph2)) : null; p.phone2S = ((s) => s === 'e' ? null : s === 's' && p.phone2W ? pick(phoneForms(ph2)) : s === 'd' ? rphone() : null)(st());
    const acc = pick(['0152' + rnum(9), rnum(11), '0152000' + pick(['UVJM', 'R3XU', 'Q9ZA']) + '00', rnum(12)]);
    p.accW = gv() === 'g' ? (i % 7 === 0 && /^\d+$/.test(acc) ? acc.replace(/^(\d{3})(\d+)/, '$1 $2') : acc) : null;
    p.accS = ((s) => s === 'e' ? null : s === 's' ? acc : s === 'd' ? rnum(11) : s === 'j' ? 'N/A' : null)(st());
    if (p.accS === acc && /^0\d+$/.test(acc) && i % 5 === 0) p.accS = acc.replace(/^0+/, '');       // a spreadsheet lost the leading zero: the row puts it back
    p.bankW = gv() === 'g' ? pick(['NMB', 'CRDB', 'Nmb', ' CRDB ']) : null; p.bankS = pick([null, 'NMB', 'nmb', 'CRDB', 'NBC', null]);
    // the NIDA: a good one, one that is not a day, one of 22 digits, none; the registry's: empty, the same with dashes, another, junk
    const nidaKinds = ['good', 'good', 'badday', 'long', 'none', 'good'];
    const by = int(1975, 2003), bm = int(1, 12), bd = int(1, dim(by, bm));
    const goodNida = `${by}${p2(bm)}${p2(bd)}` + rnum(12);
    p.nidaKind = pick(nidaKinds);
    p.nidaW = p.nidaKind === 'good' ? (i % 4 === 0 ? goodNida.replace(/^(\d{8})(\d{5})(\d{5})(\d+)/, '$1-$2-$3-$4') : goodNida) : p.nidaKind === 'badday' ? `${by}0231` + rnum(12) : p.nidaKind === 'long' ? goodNida + '00' : null;
    const ns = st(); p.nidaS = ns === 'e' ? null : ns === 's' && p.nidaKind === 'good' ? goodNida.replace(/^(\d{4})(\d{4})(\d+)/, '$1-$2-$3') : ns === 'd' ? `${int(1975, 2003)}${p2(int(1, 12))}${p2(int(1, 28))}` + rnum(12) : ns === 'j' ? 'IN PROCESS' : null;
    const tin = rnum(9), nssf = rnum(8);
    p.tinW = gv() === 'g' ? (i % 2 ? tin.replace(/^(\d{3})(\d{3})(\d{3})/, '$1-$2-$3') : tin) : null; p.tinS = ((s) => s === 'e' ? null : s === 's' ? tin.replace(/^(\d{3})(\d{3})(\d{3})/, '$1-$2-$3') : s === 'd' ? rnum(9) : 'NIL')(st());
    p.nssfW = gv() === 'g' ? nssf : null; p.nssfS = ((s) => s === 'e' ? null : s === 's' ? nssf : s === 'd' ? rnum(8) : 'ON PROCESS')(st());
    // the birth date: the form's date agrees with the NIDA, differs from it, or stands alone
    const typed = p.nidaKind === 'good' ? (i % 3 === 0 ? `${by + (i % 2 ? 1 : 0)}-${p2(bm)}-${p2(Math.min(bd, 28))}` : `${by}-${p2(bm)}-${p2(bd)}`) : (i % 2 ? `${int(1975, 2003)}-${p2(int(1, 12))}-${p2(int(1, 28))}` : null);
    p.birthW = gv() === 'g' ? typed : null; p.birthS = pick([null, '1990-05-05', typed, '2000-01-01']);
    const res = `DAR ES SALAAM, KINONDONI, WARD ${i}`;
    p.resW = gv() === 'g' ? (i % 4 === 1 ? '  ' + res.toLowerCase() : res) : null; p.resS = pick([null, res, res.toLowerCase(), 'OLD HOUSE']);
    const sd = `2026-0${int(1, 9)}-${p2(int(1, 28))}`; p.startW = gv() === 'g' ? sd : null; p.startS = pick([null, sd, '2025-03-03']);
    // the relatives: no row; the same person (a number or none on the row, and one or none in the registry); another person with a number; another without one
    const k1 = `NEEMA TOM T${i} (MAMA)`, k2 = `ANTHONY T${i} (MTU WA KARIBU)`, kp1 = rphone(), kp2 = rphone();
    const rel = (which) => pick(['none', 'same-num', 'same-nonum', 'other-num', 'other-nonum']);
    const r1 = rel(), r2 = rel();
    p.kin1 = r1 === 'none' ? null : k1; p.kin1p = r1 === 'same-num' || r1 === 'other-num' ? pick(phoneForms(kp1)) : null;
    p.g1S = pick([null, r1.startsWith('same') ? k1.toLowerCase() : 'SOMEONE ELSE (BABA)', 'SOMEONE ELSE (BABA)', r1.startsWith('same') ? k1 : null]);
    p.g1pS = p.g1S == null ? null : pick([kp1, rphone(), null, '0' + kp1, '255' + kp1]);
    p.kin2 = r2 === 'none' ? null : k2; p.kin2p = r2 === 'same-num' || r2 === 'other-num' ? pick(phoneForms(kp2)) : null;
    p.g2S = pick([null, r2.startsWith('same') ? k2 : 'ANOTHER ONE (DADA)', 'ANOTHER ONE (DADA)']); p.g2pS = p.g2S == null ? null : pick([kp2, rphone(), null, '255' + kp2, '0' + kp2]);
    if (i % 16 === 9) {                                                                            // the registry already holds everything the row gives (the same numbers, written as the registry writes them)
      p.newName = i % 32 === 9 ? null : p.name0;
      p.phoneS = p.phoneW; p.phone2S = p.phone2W; p.bankS = p.bankW; p.accS = accountW(p.accW); p.tinS = digitsOf(p.tinW); p.nssfS = digitsOf(p.nssfW); p.resS = p.resW == null ? null : p.resW.trim(); p.startS = p.startW;
      p.nidaS = p.nidaKind === 'good' || p.nidaKind === 'badday' ? digitsOf(p.nidaW) : null; p.birthS = p.birthW == null && nidaDate(digitsOf(p.nidaW)) == null ? null : (nidaDate(digitsOf(p.nidaW)) || p.birthW);
      p.g1S = p.kin1; p.g1pS = p.kin1p; p.g2S = p.kin2; p.g2pS = p.kin2p;
    }
    if (i % 20 === 13) {                                                                           // the row has no usable NIDA and a birth date; the registry's own NIDA gives ANOTHER date: the form's date is not written
      p.nidaKind = 'none'; p.nidaW = null; p.nidaS = goodNida; p.birthW = `${by === 1990 ? 1991 : 1990}-0${int(1, 9)}-1${int(0, 9)}`;
    }
    people.push(p);
  }
  // keep the names unique among the staff the list names, except the one name the decoy carries
  const reg = people.map(p => ({ id: p.id, name: p.name0, role: p.role, zone: p.zone, status: p.status, phone: p.phoneS, phone2: p.phone2S, bank: p.bankS, account: p.accS, nida: p.nidaS, tin: p.tinS, nssf: p.nssfS,
    birth_date: p.birthS, residence: p.resS, reg_date: p.startS, guarantor1: p.g1S, guarantor1_phone: p.g1pS, guarantor2: p.g2S, guarantor2_phone: p.g2pS, updated_by: 'EARLIER SCRIPT', updated_at: '2026-11-10T08:00:00Z' }));
  reg.push({ id: 'DEC/9001/2026', name: 'DECOY ONE', role: 'MANAGER', zone: 'DAR EAST', status: 'Inactive' });                // already carries a name some rows send
  reg.push({ id: 'DEC/9002/2026', name: 'DECOY ONE', role: 'MANAGER', zone: 'DAR EAST', status: 'Active' });                  // and a second one: the look-out lists both, in ID order
  const COLS = ['id', 'name', 'role', 'zone', 'status', 'phone', 'phone2', 'bank', 'account', 'nida', 'tin', 'nssf', 'birth_date', 'residence', 'reg_date', 'guarantor1', 'guarantor1_phone', 'guarantor2', 'guarantor2_phone', 'updated_by', 'updated_at'];
  const copyReg = `copy public.staff_registry (${COLS.join(', ')}) from stdin with (format csv, null '\\N');\n`
    + reg.map(r => COLS.map(c => r[c] == null ? '\\N' : '"' + String(r[c]).replace(/"/g, '""') + '"').join(',')).join('\n') + '\n\\.\n'
    + `insert into public.staff_registry (id, name, role, zone, status, account, phone) select 'X/' || lpad(g::text, 4, '0') || '/2025', 'STAFF ' || g || ' SAMPLE', 'Field Officer - KONGOWE', 'DAR NORTH', 'Active', '0100' || g, '7' || lpad(g::text, 8, '0') from generate_series(100, 400) g;\n`
    + 'analyze public.staff_registry;';
  psql(copyReg, TPL);
  // ---- the list the file is run with: its example row replaced, nothing else of the file touched --------------------------------------------------------------
  const rows = people.map(p => `(${p.i + 1}, ${q(p.noId ? 'NOPE/0000/2026' : p.id)}, ${q(p.curName)}, ${q(p.newName)}, ${q(p.phoneW)}, ${q(p.phone2W)}, ${q(p.bankW)}, ${q(p.accW)}, ${q(p.nidaW)}, ${q(p.tinW)}, ${q(p.nssfW)}, ${qd(p.birthW)}, ${q(p.resW)}, ${qd(p.startW)}, ${q(p.kin1)}, ${q(p.kin1p)}, ${q(p.kin2)}, ${q(p.kin2p)})`);
  const wantAt = FILE.indexOf('want(n, id, cur_name'), valuesAt = FILE.indexOf('(values\n', wantAt) + '(values\n'.length, endAt = FILE.indexOf('\n),\na as (');
  const listSql = rows.map(r => '  ' + r).join(',\n');
  // a column whose values are all null has no type: a leading row of typed nulls (an ID the registry does not hold, and so one line of the answer the check sets aside) gives every column its type
  const typedRow = `  (0, 'TYPES/0000/0000', 'X', null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::text, null::date, null::text, null::date, null::text, null::text, null::text, null::text),\n`;
  const BUILD = (listBody) => FILE.slice(0, valuesAt) + typedRow + listBody + FILE.slice(endAt);
  const RUNFILE = BUILD(listSql);
  // ---- the MODEL --------------------------------------------------------------------------------------------------------------------------------------
  const model = (state, list) => {                                                                // state: Map id -> registry row; list: the people (with the ids the file will be given)
    const out = { rows: new Map([...state].map(([k, v]) => [k, { ...v }])), lines: [], before: [] };
    for (const p of list) {
      const id = p.noId ? 'NOPE/0000/2026' : p.id, s = state.get(id);
      const curKey = norm(p.curName), newKey = norm(p.newName);
      const sKey = s ? norm(s.name) : null;
      const ok = !!s && [curKey, newKey || curKey].includes(sKey);
      const nidaRaw = digitsOf(p.nidaW), nidaD = nidaRaw && nidaRaw.length === 20 ? nidaRaw : null, birthNida = nidaDate(nidaRaw);
      const birthW = birthNida || p.birthW || null;
      const oNida = s ? digitsOf(s.nida) : null, oBirthNida = nidaDate(oNida);
      const phone9 = nine(p.phoneW), phone2_9 = nine(p.phone2W), k1p9 = nine(p.kin1p), k2p9 = nine(p.kin2p);
      const kin1Key = norm(p.kin1), kin2Key = norm(p.kin2), oG1 = s ? norm(s.guarantor1) : null, oG2 = s ? norm(s.guarantor2) : null;
      const g1p = kin1Key == null ? null : (k1p9 != null ? k1p9 : (kin1Key === oG1 ? nine(s && s.guarantor1_phone) : null));
      const g2p = kin2Key == null ? null : (k2p9 != null ? k2p9 : (kin2Key === oG2 ? nine(s && s.guarantor2_phone) : null));
      const accw = accountW(p.accW), bankT = p.bankW == null ? null : (p.bankW.trim() || null);
      const resT = p.resW == null ? null : (p.resW.trim() || null);
      const boxes = s ? [
        ['name', sKey, newKey, newKey != null], ['phone', nine(s.phone), phone9, phone9 != null], ['second phone', nine(s.phone2), phone2_9, phone2_9 != null],
        ['bank', s.bank == null || !s.bank.trim() ? null : s.bank.trim().toUpperCase(), bankT && bankT.toUpperCase(), bankT != null],
        ['account', s.account == null || !s.account.trim() ? null : s.account.trim().toUpperCase(), accw && accw.toUpperCase(), accw != null],
        ['NIDA', oNida, nidaD, nidaD != null], ['TIN', digitsOf(s.tin), digitsOf(p.tinW), digitsOf(p.tinW) != null], ['NSSF', digitsOf(s.nssf), digitsOf(p.nssfW), digitsOf(p.nssfW) != null],
        ['birth date', s.birth_date, birthW, birthW != null && (nidaD != null || oBirthNida == null || oBirthNida === birthW)],
        ['residence', norm(s.residence), norm(p.resW), resT != null], ['start date', s.reg_date, p.startW, p.startW != null],
        ['guarantor 1', oG1, kin1Key, kin1Key != null], ['guarantor 1 phone', nine(s.guarantor1_phone), g1p, kin1Key != null],
        ['guarantor 2', oG2, kin2Key, kin2Key != null], ['guarantor 2 phone', nine(s.guarantor2_phone), g2p, kin2Key != null],
      ].map(([label, old, nw, given]) => ({ label, old, nw, given, kind: !ok ? 'skip' : !given ? 'none' : (old == null && nw != null) ? 'filled' : (old != null && nw == null) ? 'cleared' : old !== nw ? 'replaced' : 'same' })) : [];
      const kinds = Object.fromEntries(boxes.map(b => [b.label, b.kind]));
      const changed = boxes.filter(b => ['filled', 'replaced', 'cleared'].includes(b.kind)).length;
      const list_ = k => { const a = boxes.filter(b => b.kind === k).map(b => b.label); return a.length ? a.join(', ') : ''; };
      if (ok && changed > 0) {
        const r = out.rows.get(id), w = (label, ...kk) => (kk.length ? kk : ['filled', 'replaced']).includes(kinds[label]);
        out.before.push({ ...s });
        if (w('name')) r.name = newKey; if (w('phone')) r.phone = phone9; if (w('second phone')) r.phone2 = phone2_9; if (w('bank')) r.bank = bankT; if (w('account')) r.account = accw;
        if (w('NIDA')) r.nida = nidaD; if (w('TIN')) r.tin = digitsOf(p.tinW); if (w('NSSF')) r.nssf = digitsOf(p.nssfW); if (w('birth date')) r.birth_date = birthW; if (w('residence')) r.residence = resT;
        if (w('start date')) r.reg_date = p.startW; if (w('guarantor 1')) r.guarantor1 = p.kin1.trim(); if (w('guarantor 1 phone', 'filled', 'replaced', 'cleared')) r.guarantor1_phone = g1p;
        if (w('guarantor 2')) r.guarantor2 = p.kin2.trim(); if (w('guarantor 2 phone', 'filled', 'replaced', 'cleared')) r.guarantor2_phone = g2p;
        r.updated_by = LABEL; r.updated_at = 'NOW';
      }
      const dupes = ok && newKey && newKey !== sKey ? [...state.values()].filter(x => x.id !== s.id && norm(x.name) === newKey).sort((a, b) => (a.id < b.id ? -1 : 1)) : [];
      const notes = [];
      if (ok && nidaRaw != null && nidaD == null) notes.push(`NIDA NOT written: it has ${nidaRaw.length} digits and a NIDA has 20`);
      if (ok && nidaD == null && birthW != null && oBirthNida != null && oBirthNida !== birthW) notes.push(`the birth date on the form (${dmy(birthW)}) is not the one in the NIDA number the registry holds (${dmy(oBirthNida)}): NOT written`);
      if (ok && birthNida != null && p.birthW != null && birthNida !== p.birthW) notes.push(`the birth date on the form (${dmy(p.birthW)}) is not the one in the NIDA number (${dmy(birthNida)}): the NIDA's is written`);
      if (dupes.length) notes.push('LOOK: another staff already carries the name sent: ' + dupes.map(x => `${x.id} [${x.status}]`).join('; '));
      if (ok && list_('cleared')) notes.push("a guarantor's old number was cleared: another person is named there now and no number came with them");
      if (ok && p.bankW == null && accw != null && (s.bank == null || !s.bank.trim())) notes.push('the account has no bank name on the row or in the registry');
      if (ok && ((p.phoneW != null && phone9 == null) || (p.phone2W != null && phone2_9 == null) || (p.kin1p != null && k1p9 == null) || (p.kin2p != null && k2p9 == null))) notes.push('a phone sent is not a nine-digit number (with or without 0 or 255): that phone was NOT written');
      out.lines.push([String(p.i + 1), id,
        !s ? 'NO STAFF WITH THAT ID: nothing changed' : !ok ? `THAT ID CARRIES ANOTHER NAME (${s.name}): nothing changed` : changed > 0 ? 'UPDATED' : 'NOTHING TO CHANGE: the registry already holds all of it',
        ok && newKey && newKey !== sKey ? s.name : '', ok ? (newKey || s.name) : '', ok ? list_('filled') : '', ok ? list_('replaced') : '', ok ? list_('cleared') : '', ok ? list_('same') : '', notes.join(' | ')]);
    }
    return out;
  };
  const stateOf = () => new Map(reg.map(r => [r.id, { ...r }]));
  const S0 = stateOf();
  // the account note of the model: the row's bank is null (not blank) and the registry has none: written the way the file asks, restated to be exact
  const M = model(S0, people);
  // ---- running the file on a fresh copy of the template -------------------------------------------------------------------------------------------------
  const fresh = () => { drop(RUN); psql('create database ' + RUN + ' template ' + TPL, admin); };
  const parse = out => out.trim() === '' ? [] : out.trim().split('\n').map(l => l.split(SEP));
  const runFile = file => parse(psql('begin;\n' + file + '\ncommit;\n')).filter(r => r[0] !== '0');
  const dumpReg = () => parse(psql(`select ${COLS.map(c => c === 'updated_at' ? `case when updated_at is null then '' when updated_at > now() - interval '1 hour' then 'NOW' else to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end` : `coalesce(${c}::text, '')`).join(', ')} from public.staff_registry order by id`));
  const md5All = () => psql(`select md5(string_agg(s::text, '|' order by id)) from public.staff_registry s`).trim();
  fresh();
  const beforeMd5 = md5All(), beforeOthers = psql(`select md5(string_agg(s::text, '|' order by id)) from public.staff_registry s where id like 'X/%'`).trim();
  const t0 = Date.now(); const rows1 = runFile(RUNFILE); const secs1 = (Date.now() - t0) / 1000;
  const after1 = md5All();
  // 1. every printed line equals the model's
  const printed = rows1.map(r => r.map(x => x == null ? '' : x));
  const wantLines = M.lines.map(l => l);
  const lineDiff = (() => { for (let i = 0; i < Math.max(printed.length, wantLines.length); i++) if (JSON.stringify(printed[i]) !== JSON.stringify(wantLines[i])) return 'line ' + i + ': got ' + JSON.stringify(printed[i]) + ' want ' + JSON.stringify(wantLines[i]); return ''; })();
  check('every line the file prints equals the model\'s, field by field (' + people.length + ' people)', lineDiff === '', lineDiff.slice(0, 600));
  check('no printed line holds a phone, an account, a NIDA, a TIN, an NSSF or an address', !rows1.some(r => people.some(p => [p.phoneW, p.accW, p.nidaW, p.tinW, p.nssfW].some(v => v && v.replace(/\D/g, '').length >= 8 && r.join('|').replace(/\D/g, '').includes(v.replace(/\D/g, ''))))));
  // 2. every column of every staff equals the model's
  const got = new Map(dumpReg().map(r => [r[0], r]));
  const norm_ = v => v == null ? '' : String(v);
  const badRows = [];
  for (const [id, r] of M.rows) {
    const g = got.get(id); if (!g) { badRows.push(id + ' missing'); continue; }
    COLS.forEach((c, k) => { let want = c === 'updated_at' ? (r.updated_at === 'NOW' ? 'NOW' : (r.updated_at ? r.updated_at.replace(/\.\d+/, '').replace(/Z?$/, 'Z') : '')) : norm_(r[c]); if (c === 'birth_date' || c === 'reg_date') want = want.slice(0, 10); if (g[k] !== want) badRows.push(`${id} ${c}: got ${JSON.stringify(g[k])} want ${JSON.stringify(want)}`); });
  }
  check('EVERY column of EVERY staff is what the model says after the run (' + M.rows.size + ' staff; ' + M.before.length + ' changed)', badRows.length === 0, badRows.slice(0, 4).join(' | '));
  check('the staff nobody named are byte-identical', psql(`select md5(string_agg(s::text, '|' order by id)) from public.staff_registry s where id like 'X/%'`).trim() === beforeOthers);
  // 3. the before-images hold exactly the rows changed, with what they held
  const bi = new Map(parse(psql(`select id, label, coalesce(name, ''), coalesce(phone, ''), coalesce(account, ''), coalesce(nida, ''), coalesce(guarantor1_phone, ''), coalesce(birth_date::text, '') from public.staff_registry_update_before order by id`)).map(r => [r[0], r]));
  check('the before-images hold exactly the staff changed (' + bi.size + '), under the label, with what each held', bi.size === M.before.length && M.before.every(b => { const r = bi.get(b.id); return r && r[1] === LABEL && r[2] === norm_(b.name) && r[3] === norm_(b.phone) && r[4] === norm_(b.account) && r[5] === norm_(b.nida) && r[6] === norm_(b.guarantor1_phone) && r[7] === norm_(b.birth_date).slice(0, 10); }));
  // 4. what the fixture holds: every kind of thing a break needs, counted
  const cnt = (a, f) => a.filter(f).length;
  const kindCount = k => M.lines.reduce((n, l) => n + [l[5], l[6], l[7]].join(', ').split(', ').filter(x => x === k).length, 0);
  const sameBoxes = ['phone', 'NIDA', 'TIN', 'account', 'bank', 'residence', 'guarantor 1'].every(b => M.lines.some(l => l[8].split(', ').includes(b)));
  const has = f => cnt(M.lines, f);
  const need = [
    ['updated (40 or more)', has(l => l[2] === 'UPDATED') >= 40], ['nothing to change (3 or more)', has(l => l[2].startsWith('NOTHING')) >= 3], ['wrong name (4 or more)', has(l => l[2].startsWith('THAT ID')) >= 4], ['no such ID (3 or more)', has(l => l[2].startsWith('NO STAFF')) >= 3],
    ['names replaced (20 or more)', has(l => l[3] !== '') >= 20], ['boxes already the same, of every kind', sameBoxes],
    ['boxes filled, replaced, cleared (10 or more lines each)', ['filled', 'replaced', 'cleared'].every((c, k) => has(l => l[5 + k] !== '') >= 10)],
    ['a NIDA of 22 digits (3)', has(l => /NIDA NOT written: it has 22/.test(l[9])) >= 3], ['a form date that is not the NIDA the registry holds (2)', has(l => /is not the one in the NIDA number the registry holds/.test(l[9])) >= 2],
    ['a form date that is not the row\'s NIDA (2)', has(l => /the NIDA's is written/.test(l[9])) >= 2], ['a name two decoys carry (2)', has(l => /LOOK: another staff already carries the name sent: DEC\/9001\/2026 \[Inactive\]; DEC\/9002\/2026 \[Active\]/.test(l[9])) >= 2],
    ['a guarantor number cleared (3)', has(l => /old number was cleared/.test(l[9])) >= 3], ['a phone that is not nine digits (2)', has(l => /not a nine-digit number/.test(l[9])) >= 2], ['an account with no bank (2)', has(l => /no bank name/.test(l[9])) >= 2],
    ['a name sent that is the same as the registry\'s but written another way', people.some(p => p.newName && p.newName !== p.name0 && norm(p.newName) === norm(p.name0))],
  ];
  check('the fixture holds every kind of thing a break needs: updated ' + has(l => l[2] === 'UPDATED') + ', nothing to change ' + has(l => l[2].startsWith('NOTHING')) + ', wrong name ' + has(l => l[2].startsWith('THAT ID')) + ', no such ID ' + has(l => l[2].startsWith('NO STAFF')) + '; names replaced ' + has(l => l[3] !== '') + '; notes ' + has(l => l[9] !== ''),
    need.every(x => x[1]), need.filter(x => !x[1]).map(x => x[0]).join(' | '));
  // 5. a second run changes nothing, and says so
  const rows2 = runFile(RUNFILE); const after2 = md5All();
  const biCount2 = Number(psql('select count(*) from public.staff_registry_update_before').trim());
  if (process.env.DEBUG_SU) { const k = rows2.findIndex((r, k) => (M.lines[k][2] === 'UPDATED') && !r[2].startsWith('NOTHING')); if (k >= 0) { console.log('DEBUG person', k, JSON.stringify(people[k]), '\nS0', JSON.stringify(S0.get(people[k].id)), '\nM line', JSON.stringify(M.lines[k]), '\nrun2', JSON.stringify(rows2[k]), '\nafter1 row', JSON.stringify(got.get(people[k].id))); } }
  check('a second run changes nothing (the registry byte-identical, no new before-image) and every person that was UPDATED now says NOTHING TO CHANGE', after2 === after1 && biCount2 === M.before.length
    && rows2.every((r, k) => (M.lines[k][2] === 'UPDATED' || M.lines[k][2].startsWith('NOTHING')) ? r[2].startsWith('NOTHING') : r[2] === M.lines[k][2]), rows2.find((r, k) => (M.lines[k][2] === 'UPDATED') && !r[2].startsWith('NOTHING')));
  // 6. the undo at the foot: the whole registry back byte for byte, and the copies stay
  const fl = FILE.split('\n'), undo = fl.slice(fl.findIndex(l => l.startsWith('-- UNDO')) + 1).filter(l => l.startsWith('-- ')).map(l => l.replace(/^-- /, '')).join('\n');
  psql('begin;\n' + undo + '\ncommit;');
  check('the undo at the foot puts the whole registry back byte for byte, and the copies stay', md5All() === beforeMd5 && Number(psql('select count(*) from public.staff_registry_update_before').trim()) === M.before.length, undo.slice(0, 100));
  // 7. a registry ten times the live one: the timing the owner will see
  fresh();
  psql(`insert into public.staff_registry (id, name, role, zone, status, account, phone, nida, residence) select 'Y/' || lpad(g::text, 6, '0') || '/2025', 'BIG STAFF ' || g || ' SAMPLE', 'Field Officer - KONGOWE', 'DAR NORTH', 'Active', '0100' || g, '7' || lpad(g::text, 8, '0'), '1990010100000000' || lpad((g % 10000)::text, 4, '0'), 'WARD ' || g from generate_series(1, 50000) g; analyze public.staff_registry;`);
  const t1 = Date.now(); const big = runFile(RUNFILE); const secsBig = (Date.now() - t1) / 1000;
  check('a registry of about 50,000 staff (ten times the live one) is answered in ' + secsBig.toFixed(2) + ' s, under the 60-second ceiling, with the same answers', secsBig < 30 && JSON.stringify(big.map(r => r.slice(0, 3))) === JSON.stringify(M.lines.map(l => l.slice(0, 3))));

  // ---- broken on purpose: each break must change the outcome ---------------------------------------------------------------------------------------------------
  const sig = file => { fresh(); const r = runFile(file); return JSON.stringify([r, md5All(), parse(psql('select id, label, coalesce(name, \'\') from public.staff_registry_update_before order by id'))]); };
  const baseSig = sig(RUNFILE);
  const sub = (src, re, to, what) => { const n = (src.match(new RegExp(re.source, 'g')) || []).length; if (n !== 1) throw new Error('the file has ' + n + ' of "' + what + '", the check needs exactly one'); return src.replace(re, () => to); };
  const rep = (re, to) => src => sub(src, re, to, String(re));
  const breaks = [
    // finding the person
    ['the ID alone finds the person (the name is not asked)',                                       rep(/\(b\.sid is not null and b\.s_key in \(b\.cur_key, coalesce\(b\.new_key, b\.cur_key\)\)\) as ok/, '(b.sid is not null) as ok')],
    ['only the name written before the rename finds the person (a second run is refused)',          rep(/b\.s_key in \(b\.cur_key, coalesce\(b\.new_key, b\.cur_key\)\)/, 'b.s_key = b.cur_key')],
    ['only the new name finds the person',                                                          rep(/b\.s_key in \(b\.cur_key, coalesce\(b\.new_key, b\.cur_key\)\)/, 'b.s_key = coalesce(b.new_key, b.cur_key)')],
    // fill, replace, same
    ['a box that holds something is never replaced (the old PLACE rule)',                           rep(/when v\.old is distinct from v\.new then 'replaced' else 'same' end as kind/, "when v.old is distinct from v.new then 'same' else 'same' end as kind")],
    ['a box that is empty is never filled',                                                         rep(/when v\.old is null and v\.new is not null then 'filled'/, "when v.old is null and v\.new is not null then 'none'")],
    ['a box the row leaves null is emptied',                                                        rep(/when v\.given is false then 'none'/, "when v.given is false and v.old is null then 'none' when v.given is false then 'cleared'")],
    ['the name is not replaced',                                                                    rep(/\(1,  'name',            c\.s_key,                       c\.new_key,                  c\.new_key is not null\)/, "(1,  'name',            c.s_key,                       c.new_key,                  false)")],
    ['a name is compared as typed, not as the registry reads it (capitals, single spaces)',         rep(/\(1,  'name',            c\.s_key, /, "(1,  'name',            c.s_name, ")],
    ['a phone is compared as typed (the same number with a 0 is another)',                          rep(/\(2,  'phone',           c\.o_phone,                     c\.phone9,                   c\.phone9 is not null\)/, "(2,  'phone',           c.o_phone,                     c.phone,                   c.phone9 is not null)")],
    ['a phone written another way is another number (the 255 prefix is not dropped)',               rep(/regexp_replace\(regexp_replace\(regexp_replace\(coalesce\(w\.phone, ''\), '\\D', '', 'g'\), '\^255', ''\), '\^0\+', ''\)/, "regexp_replace(regexp_replace(coalesce(w.phone, ''), '\\D', '', 'g'), '^0+', '')")],
    ['a NIDA is compared with its dashes',                                                          rep(/\(6,  'NIDA',            c\.o_nida, /, "(6,  'NIDA',            c.o_nida || '', ")],
    ['a NIDA of 22 digits is written',                                                              rep(/case when length\(a\.nida_raw\) = 20 then a\.nida_raw end as nida_d/, 'a.nida_raw as nida_d')],
    ['a NIDA of 19 digits is written',                                                              rep(/case when length\(a\.nida_raw\) = 20 then a\.nida_raw end as nida_d/, 'case when length(a.nida_raw) >= 19 then a.nida_raw end as nida_d')],
    ['the account loses its leading zeros',                                                         rep(/then nullif\(regexp_replace\(w\.account, '\\D', '', 'g'\), ''\) else/, "then ltrim(nullif(regexp_replace(w.account, '\\D', '', 'g'), ''), '0') else")],
    ['the account is compared without its case (letters)',                                          rep(/\(5,  'account',         c\.o_account,                   upper\(c\.account_w\)/, "(5,  'account',         c.o_account,                   c.account_w")],
    ['the bank is compared with its case',                                                          rep(/\(4,  'bank',            c\.o_bank,                      upper\(nullif\(btrim\(c\.bank\), ''\)\)/, "(4,  'bank',            c.o_bank,                      nullif(btrim(c.bank), '')")],
    ['TIN and NSSF keep their dashes',                                                              rep(/nullif\(regexp_replace\(coalesce\(w\.tin, ''\), '\\D', '', 'g'\), ''\) as tin_d/, "nullif(btrim(w.tin), '') as tin_d")],
    // the birth date
    ['the birth date is the form\'s, not the NIDA\'s',                                              rep(/coalesce\(a\.birth_nida, a\.birth\) as birth_w/, 'coalesce(a.birth, a.birth_nida) as birth_w')],
    ['the birth date is written beside a NIDA it was not read from',                                rep(/c\.birth_w is not null and \(c\.nida_d is not null or c\.o_birth_nida is null or c\.o_birth_nida = c\.birth_w\)/, 'c.birth_w is not null')],
    ['a NIDA whose date is no day of the calendar still gives a date (the file fails on that very row)', rep(/then case when substr\(a\.nida_raw, 7, 2\)::int <= extract\(day from make_date\(substr\(a\.nida_raw, 1, 4\)::int, substr\(a\.nida_raw, 5, 2\)::int, 1\) \+ interval '1 month' - interval '1 day'\)::int/, 'then case when true'), true],
    // the relatives
    ['a guarantor\'s old number stays beside another person',                                       rep(/when b\.kin1_key is not distinct from b\.o_g1 then b\.o_g1p end as g1p_new/, 'else b.o_g1p end as g1p_new')],
    ['a guarantor\'s number is cleared even beside the same person',                                rep(/when b\.kin2_key is not distinct from b\.o_g2 then b\.o_g2p end as g2p_new/, 'end as g2p_new')],
    ['a guarantor\'s number is never cleared (the old one stays)',                                  rep(/'guarantor 1 phone' in \('filled', 'replaced', 'cleared'\)/, "'guarantor 1 phone' in ('filled', 'replaced')")],
    ['a guarantor is compared as typed',                                                            rep(/\(12, 'guarantor 1',     c\.o_g1, /, "(12, 'guarantor 1',     c.o_g1 || '', ")],
    // the registry's own boxes, and the row's names, are read the way the form's boxes are before they are compared
    ['the registry\'s NIDA is compared with its dashes',                                            rep(/nullif\(regexp_replace\(coalesce\(s\.nida, ''\), '\\D', '', 'g'\), ''\) as o_nida/, "nullif(btrim(s.nida), '') as o_nida")],
    ['the registry\'s TIN is compared with its dashes',                                             rep(/nullif\(regexp_replace\(coalesce\(s\.tin, ''\), '\\D', '', 'g'\), ''\) as o_tin/, "nullif(btrim(s.tin), '') as o_tin")],
    ['the registry\'s NSSF is compared with its dashes',                                            rep(/nullif\(regexp_replace\(coalesce\(s\.nssf, ''\), '\\D', '', 'g'\), ''\) as o_nssf/, "nullif(btrim(s.nssf), '') as o_nssf")],
    ['the registry\'s residence is compared as typed (capitals, single spaces)',                    rep(/nullif\(regexp_replace\(upper\(btrim\(s\.residence\)\), '\\s\+', ' ', 'g'\), ''\) as o_res/, "nullif(btrim(s.residence), '') as o_res")],
    ['the registry\'s first guarantor is compared as typed',                                        rep(/nullif\(regexp_replace\(upper\(btrim\(s\.guarantor1\)\), '\\s\+', ' ', 'g'\), ''\) as o_g1/, "nullif(btrim(s.guarantor1), '') as o_g1")],
    ['the registry\'s second guarantor is compared as typed',                                       rep(/nullif\(regexp_replace\(upper\(btrim\(s\.guarantor2\)\), '\\s\+', ' ', 'g'\), ''\) as o_g2/, "nullif(btrim(s.guarantor2), '') as o_g2")],
    ['the registry\'s name is compared as typed (capitals, single spaces)',                         rep(/regexp_replace\(upper\(btrim\(s\.name\)\), '\\s\+', ' ', 'g'\) as s_key/, "btrim(s.name) as s_key")],
    ['the name the row says the registry carries is compared as typed',                             rep(/regexp_replace\(upper\(btrim\(w\.cur_name\)\), '\\s\+', ' ', 'g'\) as cur_key/, "btrim(w.cur_name) as cur_key")],
    // a phone is read the same way in every one of the eight places
    ['the row\'s second phone is read without dropping the 255 prefix',                             rep(/coalesce\(w\.phone2, ''\), '\\D', '', 'g'\), '\^255'/, "coalesce(w.phone2, ''), '\\D', '', 'g'), '^254'")],
    ['the row\'s first guarantor\'s number is read without dropping the 255 prefix',                rep(/coalesce\(w\.kin1_phone, ''\), '\\D', '', 'g'\), '\^255'/, "coalesce(w.kin1_phone, ''), '\\D', '', 'g'), '^254'")],
    ['the row\'s second guarantor\'s number is read without dropping the 255 prefix',               rep(/coalesce\(w\.kin2_phone, ''\), '\\D', '', 'g'\), '\^255'/, "coalesce(w.kin2_phone, ''), '\\D', '', 'g'), '^254'")],
    ['the registry\'s phone is read without dropping the 255 prefix',                               rep(/coalesce\(s\.phone, ''\), '\\D', '', 'g'\), '\^255'/, "coalesce(s.phone, ''), '\\D', '', 'g'), '^254'")],
    ['the registry\'s second phone is read without dropping the 255 prefix',                        rep(/coalesce\(s\.phone2, ''\), '\\D', '', 'g'\), '\^255'/, "coalesce(s.phone2, ''), '\\D', '', 'g'), '^254'")],
    ['the registry\'s first guarantor\'s number is read without dropping the 255 prefix',           rep(/coalesce\(s\.guarantor1_phone, ''\), '\\D', '', 'g'\), '\^255'/, "coalesce(s.guarantor1_phone, ''), '\\D', '', 'g'), '^254'")],
    ['the registry\'s second guarantor\'s number is read without dropping the 255 prefix',          rep(/coalesce\(s\.guarantor2_phone, ''\), '\\D', '', 'g'\), '\^255'/, "coalesce(s.guarantor2_phone, ''), '\\D', '', 'g'), '^254'")],
    ['the row\'s leading zero is kept on a phone (the other number written another way)',           rep(/'\^255', ''\), '\^0\+', ''\), 9\) as x\) d\) as phone9/, "'^255', ''), '^0', ''), 9) as x) d) as phone9")],
    // what is written
    ['a box that is already the same is rewritten too (a phone normalised)',                        rep(/phone      = case when t\.k->>'phone' in \('filled', 'replaced'\) then t\.phone9 else s\.phone end/, "phone      = coalesce(t.phone9, s.phone)")],
    ['the name is written as typed, not in capitals',                                               rep(/then t\.new_key else s\.name end/, 'then t.new_name else s.name end')],
    ['the role is written (a form\'s department over the registry\'s desk)',                        rep(/updated_by = \(select label from cfg\), updated_at = now\(\)\n    from todo t/, "updated_by = (select label from cfg), updated_at = now(), role = 'PMO HQ'\n    from todo t")],
    ['the status is written',                                                                       rep(/updated_by = \(select label from cfg\), updated_at = now\(\)\n    from todo t/, "updated_by = (select label from cfg), updated_at = now(), status = 'Active'\n    from todo t")],
    ['the label is not written beside the row',                                                     rep(/updated_by = \(select label from cfg\), updated_at = now\(\)\n    from todo t/, "updated_at = now()\n    from todo t")],
    ['a row with nothing to change is written anyway',                                              rep(/where c\.ok and p\.changed > 0\),/, 'where c.ok),')],
    // the before-images and the undo
    ['the before-image is not taken',                                                               rep(/from staff_registry s join todo t on t\.sid = s\.id\n  where not exists/, 'from staff_registry s join todo t on t.sid = s.id\n  where false and not exists')],
    ['the before-image is taken again on every run',                                                rep(/  where not exists \(select 1 from public\.staff_registry_update_before z where z\.id = s\.id and z\.label = \(select label from cfg\)\)\n/, '\n')],
    ['the before-image loses a column (the second guarantor\'s number)', src => sub(sub(src, /guarantor2, guarantor2_phone, updated_by, updated_at\)\n  select s\.id/, 'guarantor2, updated_by, updated_at)\n  select s.id', 'before-image columns'), /s\.guarantor2, s\.guarantor2_phone, s\.updated_by, s\.updated_at/, 's.guarantor2, s.updated_by, s.updated_at', 'before-image select')],
    ['the before-images are not private (no row level security)',                                   rep(/alter table public\.staff_registry_update_before enable row level security;/, '')],
    // the report
    ['the answer says something is wrong with an ID that is right',                                 rep(/when p\.changed > 0  then 'UPDATED'/, "when p.changed > 1  then 'UPDATED'")],
    ['the answer does not list the boxes already the same',                                         rep(/case when c\.ok then p\.same end as same_already/, 'null::text as same_already')],
    ['the old name is not shown',                                                                   rep(/case when c\.ok and c\.new_key is not null and c\.new_key <> c\.s_key then c\.s_name end as name_was/, 'null::text as name_was')],
    ['the answer prints the account',                                                               rep(/case when c\.ok then p\.same end as same_already/, 'c.account_w as same_already')],
    ['the look-out for a name somebody else carries is gone',                                       rep(/and exists \(select 1 from staff_registry x where x\.id <> c\.sid and regexp_replace\(upper\(btrim\(x\.name\)\), '\\s\+', ' ', 'g'\) = c\.new_key\)/, 'and false')],
    ['the look-out lists one staff, not all',                                                       rep(/string_agg\(x\.id \|\| ' \[' \|\| x\.status \|\| '\]', '; ' order by x\.id\)/, "min(x.id || ' [' || x.status || ']')")],
    ['the 22-digit NIDA is not said',                                                               rep(/case when c\.ok and c\.nida_raw is not null and c\.nida_d is null then/, 'case when false then')],
    ['a phone that is not nine digits is not said',                                                 rep(/then 'a phone sent is not a nine-digit number/, "then NULL || 'a phone sent is not a nine-digit number")],
  ];
  let notCaught = 0;
  for (const [name, fn, mustFail] of breaks) {
    let broken = null, why = '', ok = false;
    try { broken = fn(RUNFILE); } catch (err) { why = err.message; }
    if (broken !== null) {
      try { const changed = sig(broken) !== baseSig; ok = !mustFail && changed; why = mustFail ? 'the broken file ran, but it should have failed on that row' : 'the outcome is the same as the file\'s'; }
      catch (err) { if (mustFail) ok = /out of range|date field value|invalid/i.test(err.psql || err.message); else why = 'the broken file does not run: ' + err.message.slice(0, 220); }
    }
    if (!ok) notCaught++;
    check('BROKEN ON PURPOSE, ' + (mustFail ? 'the file fails on the row that guard is for: ' : 'the outcome changes: ') + name, ok, why);
  }
  console.log('\n' + (fails.length ? fails.length + ' FAILED' : 'all passed') + ' (' + breaks.length + ' breaks, ' + (breaks.length - notCaught) + ' caught; first run ' + secs1.toFixed(2) + ' s)');
  exitCode = fails.length ? 1 : 0;
} finally {
  drop(TPL); drop(RUN);
}
process.exit(exitCode);
