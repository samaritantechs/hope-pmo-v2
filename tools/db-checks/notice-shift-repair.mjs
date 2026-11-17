/* THE REPAIR OF THE IMPORTED NOTICES WHOSE DATE IS THEIR NUMBER'S DAY EXCHANGED AND A DAY EARLY -- db/RUN-ME-070, run for real on a PostgreSQL.

     "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026

   db/RUN-ME-070-repair-notice-dates-shifted-by-the-import.sql CHANGES DATA on the owner's live book, so it is not believed on a reading. After RUN-ME-068 (which put right the notices dated after
   the day they were uploaded) 252 imported notices still differed from their number, 251 of them by the same shape (the number's day exchanged and a day early; or, where exchanging changes
   nothing, a day early). This file writes back the number's day to such a notice ONLY in an upload that RUN-ME-068 proved to carry the shift, only when the stored date is exactly the shape,
   moves the stamp when it carries the same wrong day, and moves the notice's recoveries in notice_payment_ledger with it unless another notice of the loan makes them ambiguous.

   THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database, the real migrations that add notice_id and upload_date to demand_notices, the real RUN-ME-041a (the ledger with its
   primary key (ref, since, payment_id)), and THE REAL RUN-ME-068 RUN FIRST on the fixture, as on the live book: its log is what proves an upload. The fixture knows the truth: notices of
   every kind the rule has to tell apart (the shape after the upload day, put right by 068; the shape in the past, exchanged and a day early; the day equal to the month, a day early; a day over
   twelve a day early, which the shift cannot make; a plain exchange; one day late; other relations; a number later than the upload day; no usable number; made in the app; already in either log;
   a second upload with TWO proofs and a third with none; stamps on the wrong day, on the real day, elsewhere, at 12:00, at 21:00 and at other times), ledger rows (a payment the day before the
   corrected date, two notices of one loan, a row meeting the same payment at the new date).

   It passes only when: EVERY ROW of demand_notices and notice_payment_ledger equals what a MODEL written again in JavaScript says after the run, from the state 068 left; the two logs hold exactly
   the rows changed and moved; EVERY LINE the file prints equals the model's (examples and their order included); a second run changes nothing and says so; the undo at the foot puts every table
   back byte for byte; a book without RUN-ME-068's log is refused and a book where no upload is proven answers so, with nothing changed; a book a hundred times the live one runs in seconds;
   and EVERY ONE of a list of deliberate breaks of the file changes the outcome (or, for the guards that stop a typed number from being a day that does not exist, or a ledger row meeting
   another, makes the file fail on that very row).

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/notice-shift-repair.mjs

   It makes, uses and drops its own scratch databases. NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-070-repair-notice-dates-shifted-by-the-import.sql'), 'utf8');
const F068 = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-068-repair-impossible-notice-and-deduction-dates.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
const MIG_ID = fs.readFileSync(path.join(ROOT, 'db/migrations/2026-07-26-demand-notice-id.sql'), 'utf8');
const MIG_STAMP = fs.readFileSync(path.join(ROOT, 'db/migrations/2026-07-28-upload-stamp.sql'), 'utf8');
const LEDGER = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-041a-notice-payment-ledger.sql'), 'utf8');
const SEP = '\x1f', DAY = 86400000, TPL = 'hope_ns_tpl', RUN = 'hope_ns_run';
const psql = (sql, db = RUN) => {
  try { return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', SEP, '-d', db, '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { const err = new Error('psql failed: ' + String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 3).join(' | ')); err.psql = String(e.stderr || ''); throw err; }
};
let seed = 20261117;                                               // mulberry32
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const iso = t => (t == null ? '' : new Date(t).toISOString().slice(0, 10));
const p2 = n => String(n).padStart(2, '0');
const uuid = (pre, n) => pre + n.toString(16).padStart(7, '0') + '-0000-4000-8000-000000000000';
const fmt = n => n.toLocaleString('en-US');
const U = (y, m, d) => Date.UTC(y, m - 1, d);
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const swap = t => { if (t == null) return null; const d = new Date(t), m = d.getUTCMonth() + 1, dd = d.getUTCDate(); return (dd <= 12 && m !== dd) ? Date.UTC(d.getUTCFullYear(), dd - 1, m) : null; };   // null where the day cannot be exchanged
const dayOf = t => new Date(t).getUTCDate(), monthOf = t => new Date(t).getUTCMonth() + 1;
const eat = t => { const x = new Date(t + 3 * 3600000); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()); };                                // the day in East Africa (UTC+3, no daylight saving)
const clockEat = t => (((t + 3 * 3600000) % DAY) + DAY) % DAY;                                                                                                 // the East Africa time of day, in ms
const H = h => h * 3600000;

const admin = process.env.PGDATABASE || 'postgres';
const drop = db => { try { psql('drop database if exists ' + db, admin); } catch { /* none */ } };
drop(TPL); drop(RUN);
const fails = [];
const check = (name, ok, extra) => { if (!ok) fails.push(name + (extra ? ' -- ' + extra : '')); console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok || !extra ? '' : ' -- ' + extra)); };
let exitCode = 1;
try {
  psql('create database ' + TPL, admin);
  psql(SCHEMA, TPL); psql(MIG_ID, TPL); psql(MIG_STAMP, TPL); psql(LEDGER, TPL);
  const ddl = (file, name) => { const m = file.match(new RegExp('create table if not exists public\\.' + name + ' \\([\\s\\S]*?\\n\\);')); if (!m) throw new Error('the file has no DDL for ' + name); return m[0] + '\n'; };
  // ---- the notices -----------------------------------------------------------------------------------------------------------------------
  const PAT = /^HMCL\/[^/]+\/(\d{2})\/(\d{2})\/(\d{4})(?:-\d+)?$/;
  const numDay = s => {
    const m = s == null ? null : PAT.exec(s); if (!m) return null;
    const d = +m[1], mo = +m[2], y = +m[3];
    return (mo >= 1 && mo <= 12 && y >= 2000 && y <= 2100 && d >= 1 && d <= daysIn(y, mo)) ? Date.UTC(y, mo - 1, d) : null;
  };
  const UD = U(2026, 10, 12), UD2 = U(2026, 11, 5), UD3 = U(2026, 10, 20);
  const PAT_NUM = /^HMCL\/[^/]+\/\d{2}\/\d{2}\/\d{4}(?:-\d+)?$/;
  const notices = []; let nid = 0;
  const used = new Set();
  const num = (d, suffix = '', init = pick(['AB', 'MJ', 'XY', 'KA'])) => { const x = new Date(d); return `HMCL/${init}/${p2(x.getUTCDate())}/${p2(x.getUTCMonth() + 1)}/${x.getUTCFullYear()}${suffix}`; };
  const add = n => {
    if (n.number != null && PAT_NUM.test(n.number)) { const base = n.number.replace(/-\d+$/, ''); let c = n.number, k = 2; while (used.has(c)) c = base + '-' + (k++); n.number = c; }
    if (n.number != null) used.add(n.number);
    const id = uuid('5', ++nid);
    notices.push({ id, ref: 'R' + id.slice(1, 8), ud: UD, in068: false, in070: false, ...n });
  };
  const stampDay = (d, h = 9, mi = 0) => d + (h - 3) * 3600000 + mi * 60000;       // a stamp on the East Africa day d at h:mi there
  // made in the app: right, no upload day. And the same shape as the repairable ones, made in the app: untouched
  for (let i = 0; i < 30; i++) { const d = U(2026, 1, 1) + Math.floor(rnd() * 300) * DAY; add({ kind: 'app', ud: null, nd: d, number: num(d), stampAt: stampDay(d) }); }
  for (let i = 0; i < 8; i++) { const real = U(2025, 12, 1 + i), nd = swap(real) - DAY; add({ kind: 'APP-A', ud: null, nd, number: num(real), stampAt: stampDay(nd, 9) }); }
  // imported and right (a day over twelve is never touched by the shift)
  for (let i = 0; i < 30; i++) { const d = U(2026, 1, 13) + Math.floor(rnd() * 250) * DAY; if (dayOf(d) <= 12) { i--; continue; } add({ kind: 'Cx', nd: d, number: num(d, pick(['', '', '-2'])), stampAt: stampDay(d, 6) }); }
  for (let i = 0; i < 20; i++) { const d = U(2026, 1, 1) + Math.floor(rnd() * 270) * DAY; add({ kind: 'impok', nd: d, number: num(d), stampAt: stampDay(d, 6) }); }
  // IMP: dated after the day they were uploaded (the live twelve's shape: a real 12th, exchanged and a day early): RUN-ME-068 puts them right, and its log proves THIS upload
  for (let i = 0; i < 9; i++) { const real = U(2026, 1 + i, 12), nd = swap(real) - DAY; add({ kind: 'IMP', nd, number: num(real), stampAt: stampDay(nd, 9) }); }
  for (let i = 0; i < 3; i++) { const real = U(2026, 4 + i, 12), nd = swap(real); add({ kind: 'E068', nd, number: num(real), stampAt: stampDay(nd, 9) }); }                       // a plain exchange after the upload day
  // A: the same shape in the PAST (the number's day exchanged and a day early, not after the upload day), stamps of six kinds; B: a day early where exchanging changes nothing
  const clocks = [[12, 0], [21, 0], [9, 15], [12, 0], [21, 0], [16, 40]];
  let ai = 0;
  for (const y of [2025, 2026]) for (let m = 1; m <= 12; m++) for (let d = 1; d <= 12; d++) {
    if (d === m) continue; const real = U(y, m, d), sw = swap(real);
    if (real > UD || sw - DAY > UD || (ai++ % 5) !== 0 && notices.filter(x => x.kind === 'A').length >= 40) continue;
    if (notices.filter(x => x.kind === 'A').length >= 60) continue;
    const nd = sw - DAY, k = notices.filter(x => x.kind === 'A').length % 6, [ch, cm] = clocks[k];
    const stampAt = k === 3 ? stampDay(real, ch, cm) : k === 4 ? stampDay(U(2026, 9, 9), ch, cm) : stampDay(nd, ch, cm);      // 3: the stamp is already the number's day; 4: some other day; the rest: the same wrong day as the date
    add({ kind: 'A', nd, number: num(real, k === 0 ? '-2' : ''), stampAt, ledger: notices.length % 4 === 0, collide: notices.length % 12 === 0 });
  }
  for (const [real, n] of [[U(2026, 10, 10), 20], [U(2026, 5, 5), 4], [U(2025, 11, 11), 3], [U(2025, 12, 12), 3], [U(2026, 9, 9), 2], [U(2026, 8, 8), 2]])
    for (let i = 0; i < n; i++) { const nd = real - DAY, k = i % 4; add({ kind: 'B', nd, number: num(real), stampAt: k === 3 ? stampDay(real, 21) : stampDay(nd, [12, 21, 9][k % 3], 0), ledger: i % 2 === 0, early: i % 5 === 0 }); }
  // Au: the same shape with the stamp at 00:30 East Africa (21:30 UTC the evening before): its East Africa day is the wrong date, its UTC day is not
  for (let i = 0; i < 3; i++) { const real = U(2025, 11, 2 + i), nd = swap(real) - DAY; add({ kind: 'Au', nd, number: num(real), stampAt: stampDay(nd, 0, 30) }); }
  // C: a day over twelve a day early: the shift cannot make it, left alone. Ex: exactly the exchange. P1: the exchange a day late. Nm1: a day early with a day that can be exchanged. Np1: a day late. Far: other
  for (let i = 0; i < 6; i++) { const real = U(2026, 9, 13 + i); add({ kind: 'C', nd: real - DAY, number: num(real), stampAt: stampDay(real - DAY, 9) }); }
  for (let i = 0; i < 5; i++) { const real = U(2025, 12, 1 + i); add({ kind: 'Ex', nd: swap(real), number: num(real), stampAt: stampDay(swap(real), 9) }); }
  for (let i = 0; i < 3; i++) { const real = U(2025, 12, 6 + i); add({ kind: 'P1', nd: swap(real) + DAY, number: num(real), stampAt: stampDay(swap(real) + DAY, 9) }); }
  for (let i = 0; i < 4; i++) { const real = U(2026, 7, 3 + i); add({ kind: 'Nm1', nd: real - DAY, number: num(real), stampAt: stampDay(real - DAY, 12) }); }
  for (let i = 0; i < 3; i++) { const real = U(2026, 6, 20 + i); add({ kind: 'Np1', nd: real + DAY, number: num(real), stampAt: stampDay(real + DAY, 9) }); }
  for (const dx of [40, 40, -3, -3, 400, 7, -7, 8, -8, 2, -2]) { const real = U(2026, 3, 15); add({ kind: 'Far', nd: real + dx * DAY, number: num(real), stampAt: stampDay(real, 9) }); }
  // H: the number's day is LATER than the upload day: left alone even where the stored date has the shape
  for (let i = 0; i < 3; i++) { const real = U(2026, 11, 10); add({ kind: 'Hx', nd: swap(real) - DAY, number: num(real), stampAt: stampDay(swap(real) - DAY, 9) }); }
  // I: no usable number, or one the pattern must refuse
  const bad = [null, null, '', 'ABC123', 'ABC124', 'hmcl/ab/12/09/2026', 'HMCL/AB/05/06/2026-', 'XHMCL/AB/12/09/2026', 'HMCL/AB/12/09/2026 ', 'HMCL/AB/5/6/2026', 'HMCL/AB/12/09/26'];
  for (const b of bad) add({ kind: 'I', nd: U(2025, 11, 20), number: b, stampAt: stampDay(U(2025, 11, 21), 9) });
  add({ kind: 'I31', nd: U(2025, 11, 20), number: 'HMCL/AB/31/04/2026', stampAt: stampDay(U(2025, 11, 21), 9) });          // a day that does not exist: a guard, the file must not fail on it
  add({ kind: 'I13', nd: U(2025, 11, 20), number: 'HMCL/AB/05/13/2026', stampAt: stampDay(U(2025, 11, 21), 9) });          // a month 13
  for (let i = 0; i < 3; i++) add({ kind: 'M', nd: null, number: num(U(2026, 8, 3 + i)), stampAt: stampDay(U(2026, 8, 3 + i), 9) });   // no notice date
  // L: in a log already: never changed again (068's log: an earlier run, undone; 070's log: the same)
  for (let i = 0; i < 3; i++) { const real = U(2026, 7, 12), nd = swap(real) - DAY; add({ kind: 'L068', nd, number: num(real), stampAt: stampDay(nd, 9), in068: true }); }
  for (let i = 0; i < 3; i++) { const real = U(2025, 12, 8 + i), nd = swap(real) - DAY; add({ kind: 'L070', nd, number: num(real), stampAt: stampDay(nd, 9), in070: true }); }
  // O: two notices of one loan. O1 has the shape and O2 carries O1's OLD date; O3 has the shape and O4 carries O3's NEW date: their recoveries cannot be told apart and stay where they are
  { const real = U(2025, 12, 4), nd = swap(real) - DAY;
    add({ kind: 'O1', ref: 'RSH1', nd, number: num(real), stampAt: stampDay(nd, 9), ledger: true });
    add({ kind: 'O2', ref: 'RSH1', nd, number: num(U(2025, 12, 17)), stampAt: stampDay(nd, 9), ledger: false }); }
  { const real = U(2025, 12, 5), nd = swap(real) - DAY;
    add({ kind: 'O3', ref: 'RSH2', nd, number: num(real), stampAt: stampDay(nd, 9), ledger: true });
    add({ kind: 'O4', ref: 'RSH2', nd: real, number: num(real, '-2'), stampAt: stampDay(real, 9), ledger: false }); }
  { const real = U(2025, 12, 6), nd = swap(real) - DAY;
    add({ kind: 'O5', ref: 'RSH3', nd, number: num(real), stampAt: stampDay(nd, 9), ledger: true });
    add({ kind: 'O6', ref: 'RSH3', nd: U(2026, 2, 20), number: num(U(2026, 2, 20)), stampAt: stampDay(U(2026, 2, 20), 9), ledger: true }); }
  // Sx / Sy / Sz: the notice date is RIGHT (the number's day) but the stamp carries another day: the shape of the exchange, the shape of a day early, any other day
  for (let i = 0; i < 4; i++) { const real = U(2025, 12, 1 + i); add({ kind: 'Sx', nd: real, number: num(real), stampAt: stampDay(swap(real) - DAY, 9) }); }
  for (let i = 0; i < 2; i++) { const real = U(2025, 11, 11); add({ kind: 'Sy', nd: real, number: num(real), stampAt: stampDay(real - DAY, 9) }); }
  for (let i = 0; i < 2; i++) { const real = U(2025, 12, 20 + i); add({ kind: 'Sz', nd: real, number: num(real), stampAt: stampDay(real + 5 * DAY, 9) }); }
  // UD4: a fourth upload with EXACTLY THREE proofs (the first of them dated the day after the upload day), so that a threshold of four, or a proof that must be two days after, is told from three
  const UD4 = U(2026, 5, 1);
  for (let i = 0; i < 3; i++) { const real = U(2026, 3, 5 + i), nd = swap(real) - DAY; add({ kind: 'IMP4', ud: UD4, nd, number: num(real), stampAt: stampDay(nd, 9) }); }       // 2 May, 2 Jun, 2 Jul: the first is the upload day + 1
  for (let i = 0; i < 6; i++) { const real = U(2025, 12, 1 + i), nd = swap(real) - DAY; add({ kind: 'A4', ud: UD4, nd, number: num(real), stampAt: stampDay(nd, 9) }); }
  add({ kind: 'A4eq', ud: UD4, nd: swap(UD4) - DAY, number: num(UD4), stampAt: stampDay(swap(UD4) - DAY, 9) });                  // the number's day IS the upload day: put back (not later than it)
  // UD2: a second upload with TWO notices 068 proves: not enough (three are needed), so its past-shaped notices are left alone
  for (let i = 0; i < 2; i++) { const real = U(2026, 2 + i, 12), nd = swap(real) - DAY; add({ kind: 'IMP2', ud: UD2, nd, number: num(real), stampAt: stampDay(nd, 9) }); }
  for (let i = 0; i < 12; i++) { const real = U(2025, 11 + i % 2, 1 + (i % 10)); if (dayOf(real) === monthOf(real)) { i--; continue; } add({ kind: 'A2', ud: UD2, nd: swap(real) - DAY, number: num(real), stampAt: stampDay(swap(real) - DAY, 21) }); }
  // UD3: a third upload with no proof at all, and three rows in 068's log whose OLD date is not after the upload day (an earlier run, undone)
  for (let i = 0; i < 10; i++) { const real = U(2025, 11 + i % 2, 1 + (i % 10)); if (dayOf(real) === monthOf(real)) { i--; continue; } add({ kind: 'A3', ud: UD3, nd: swap(real) - DAY, number: num(real), stampAt: stampDay(swap(real) - DAY, 9) }); }
  for (let i = 0; i < 3; i++) { const real = U(2025, 10, 6 + i), nd = real; add({ kind: 'L068c', ud: UD3, nd, number: num(real), stampAt: stampDay(nd, 9), in068: true, old068: swap(real) - DAY }); }
  const copyN = `copy public.demand_notices (id, ref, notice_id, notice_date, created_at, upload_date) from stdin with (format csv, null '');\n`
    + notices.map(n => [n.id, n.ref, n.number == null ? '' : '"' + String(n.number).replace(/"/g, '""') + '"', n.nd == null ? '' : iso(n.nd), new Date(n.stampAt).toISOString(), n.ud == null ? '' : iso(n.ud)].join(',')).join('\n') + '\n\\.\n';
  // ---- the ledger (RUN-ME-041a): rows kept by (ref, since, payment) ----------------------------------------------------------------------------
  const ledger = []; let pid = 0;
  const addL = (ref, since, paid, amount = 1000) => { const l = { ref, since, pay: uuid('7', ++pid), paid, amount, rid: 'f' + pid }; ledger.push(l); return l; };
  for (const n of notices) {
    if (n.ledger) { addL(n.ref, n.nd, n.nd + 2 * DAY); addL(n.ref, n.nd, n.nd + 5 * DAY, 2500); }
    if (n.early) addL(n.ref, n.nd, n.nd);                                                                        // a payment on the stored date: the day BEFORE the corrected date
    if (n.collide) { const first = ledger.find(l => l.ref === n.ref && l.since === n.nd); if (first) { const real = numDay(n.number); ledger.push({ ref: n.ref, since: real, pay: first.pay, paid: first.paid, amount: first.amount, rid: 'c' + (++pid) }); } }   // the same payment already at the number's day
  }
  for (const n of notices.filter(x => x.kind === 'impok' || x.kind === 'Cx').slice(0, 20)) addL(n.ref, n.nd, n.nd + 3 * DAY);                       // a right notice: nothing to move
  const copyL = `copy public.notice_payment_ledger (ref, since, payment_id, paid_at, amount, matched_by) from stdin with (format csv, null '');\n`
    + ledger.map(l => [l.ref, iso(l.since), l.pay, iso(l.paid), l.amount, l.rid].join(',')).join('\n') + '\n\\.\n';
  // ---- the logs of earlier runs ---------------------------------------------------------------------------------------------------------------------
  const pre = ddl(F068, 'notice_ledger_date_move_log') + ddl(F068, 'demand_notice_date_repair_log') + ddl(F068, 'pmo_deduction_date_repair_log') + ddl(FILE, 'demand_notice_shift_repair_log') + ddl(FILE, 'notice_ledger_shift_move_log')
    + `insert into public.demand_notice_date_repair_log (id, notice_old, notice_new, stamp_old, stamp_new) values ${notices.filter(n => n.in068).map(n => `('${n.id}', '${iso(n.old068 != null ? n.old068 : n.nd)}', '${iso(numDay(n.number))}', '${new Date(n.stampAt).toISOString()}', '${new Date(n.stampAt).toISOString()}')`).join(', ')};\n`
    + `insert into public.demand_notice_shift_repair_log (id, notice_old, notice_new, stamp_old, stamp_new) values ${notices.filter(n => n.in070).map(n => `('${n.id}', '${iso(n.nd)}', '${iso(numDay(n.number))}', '${new Date(n.stampAt).toISOString()}', '${new Date(n.stampAt).toISOString()}')`).join(', ')};\n`;
  psql(copyN + copyL + pre + 'analyze public.demand_notices; analyze public.notice_payment_ledger;', TPL);
  // ---- RUN-ME-068 RUN FIRST, as on the live book: its log is what proves an upload ------------------------------------------------------------------
  psql('begin;\n' + F068 + '\ncommit;\n', TPL);
  const parse = out => out.trim() === '' ? [] : out.trim().split('\n').map(l => l.split(SEP));
  // the state 068 left: what the model starts from
  const snap = () => ({
    notices: parse(psql(`select id, ref, coalesce(notice_id, ''), coalesce(notice_date::text, ''), to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), coalesce(upload_date::text, '') from public.demand_notices order by id`, TPL))
      .map(r => ({ id: r[0], ref: r[1], number: r[2] === '' ? null : r[2], nd: r[3] === '' ? null : Date.parse(r[3] + 'T00:00:00Z'), ca: Date.parse(r[4] + 'Z'), ud: r[5] === '' ? null : Date.parse(r[5] + 'T00:00:00Z') })),
    ledger: parse(psql(`select ref, since::text, payment_id, coalesce(paid_at::text, ''), matched_by from public.notice_payment_ledger order by ref, since, payment_id`, TPL))
      .map(r => ({ ref: r[0], since: Date.parse(r[1] + 'T00:00:00Z'), pay: r[2], paid: r[3] === '' ? null : Date.parse(r[3] + 'T00:00:00Z'), rid: r[4] })),
    log068: parse(psql(`select id, notice_old::text from public.demand_notice_date_repair_log`, TPL)).map(r => ({ id: r[0], old: Date.parse(r[1] + 'T00:00:00Z') })),
    log070: new Set(parse(psql(`select id from public.demand_notice_shift_repair_log`, TPL)).map(r => r[0])),
  });
  const S0 = snap();
  // ---- the MODEL: the rule written again ------------------------------------------------------------------------------------------------------------
  const cnt = (a, f) => a.filter(f).length;
  const dayDiff = (a, b) => Math.round((a - b) / DAY);
  const kindOf = new Map(notices.map(n => [n.id, n.kind]));
  const model = st => {
    for (const n of st.notices) n.kind = kindOf.get(n.id);
    const byId = new Map(st.notices.map(n => [n.id, n]));
    const proofN = new Map();
    for (const g of st.log068) { const n = byId.get(g.id); if (n && n.ud != null && g.old > n.ud) proofN.set(n.ud, (proofN.get(n.ud) || 0) + 1); }
    const fixed = new Set([...st.log068.map(g => g.id), ...st.log070]);
    for (const n of st.notices) {
      n.idd = numDay(n.number); n.isw = swap(n.idd); n.dm = n.idd != null && dayOf(n.idd) === monthOf(n.idd); n.cd = eat(n.ca); n.imp = n.ud != null;
      n.provedUp = n.imp && (proofN.get(n.ud) || 0) >= 3;
      n.cand = n.provedUp && n.nd != null && n.idd != null && n.nd !== n.idd && !fixed.has(n.id);
      n.kindA = n.cand && n.idd <= n.ud && n.isw != null && n.nd === n.isw - DAY;
      n.kindB = n.cand && n.idd <= n.ud && n.isw == null && n.dm && n.nd === n.idd - DAY;
      n.ok = n.kindA || n.kindB;
      n.stampMoves = n.ok && n.cd === n.nd;
      n.ndNew = n.ok ? n.idd : n.nd;
      n.caNew = n.stampMoves ? n.idd + clockEat(n.ca) - H(3) : n.ca;
    }
    const oks = st.notices.filter(n => n.ok);
    const led = st.ledger.map(l => ({ ...l, sinceNew: l.since }));
    const keys = new Set(st.ledger.map(l => l.ref + '|' + l.since + '|' + l.pay));
    for (const l of led) {
      const o = oks.find(x => x.ref === l.ref && x.nd === l.since);
      if (!o) continue;
      const clash = st.notices.some(z => z.ref === o.ref && z.id !== o.id && (z.nd === o.nd || z.nd === o.idd));
      if (clash || keys.has(l.ref + '|' + o.idd + '|' + l.pay)) continue;
      l.sinceNew = o.idd; l.moved = true;
    }
    const held = cnt(st.ledger, l => oks.some(o => o.ref === l.ref && o.nd === l.since));
    const fin = st.notices.filter(n => n.imp);
    const rest = fin.filter(n => n.nd != null && n.idd != null && n.ndNew !== n.idd);
    const lines = new Map();
    const provedCount = cnt(fin, n => n.provedUp);
    lines.set(0, provedCount === 0 ? 'no upload is proved to carry the shift (RUN-ME-068 put right fewer than three notices dated after the day they were uploaded, in every upload): nothing was changed'
      : `${fmt(oks.length)} notice date(s) put back to the day their number says (${fmt(cnt(oks, n => n.stampMoves))} stamp(s) with them, ${fmt(cnt(led, l => l.moved))} ledger row(s) moved with the date); ${fmt(rest.length)} imported notice(s) still differ from their number and were left alone (described below)`);
    const ups = (f) => new Set(fin.filter(f).map(n => n.ud)).size;
    lines.set(1, `${fmt(ups(n => n.provedUp))} / ${fmt(ups(n => !n.provedUp))}`);
    lines.set(2, `${fmt(fin.length)} / ${fmt(provedCount)} / ${fmt(cnt(st.notices, n => n.cand))}`);
    lines.set(3, `${fmt(cnt(oks, n => n.kindA))} / ${fmt(cnt(oks, n => n.kindB))}`);
    lines.set(4, `${fmt(cnt(oks, n => n.stampMoves))} / ${fmt(cnt(oks, n => !n.stampMoves))} / ${fmt(cnt(led, l => l.moved))} / ${fmt(held - cnt(led, l => l.moved))}`);
    lines.set(5, fmt(cnt(led, l => l.moved && l.paid != null && l.paid < l.sinceNew)));
    lines.set(6, `${fmt(cnt(oks, n => clockEat(n.ca) === H(12)))} / ${fmt(cnt(oks, n => clockEat(n.ca) === H(21)))} / ${fmt(cnt(oks, n => clockEat(n.ca) !== H(12) && clockEat(n.ca) !== H(21)))}`);
    const cdNew = n => eat(n.caNew), shape = n => (n.isw != null && cdNew(n) === n.isw - DAY) || (n.isw == null && n.dm && cdNew(n) === n.idd - DAY);
    lines.set(7, `${fmt(cnt(fin, n => cdNew(n) !== n.ndNew))} / ${fmt(cnt(fin, n => cdNew(n) !== n.ndNew && shape(n)))} / ${fmt(cnt(fin, n => cdNew(n) !== n.ndNew && !shape(n)))}`);
    lines.set(10, `${fmt(rest.length)} / ${fmt(cnt(rest, r => r.ndNew > r.ud))}`);
    const cls = (f) => { const a = fin.filter(f); return `${fmt(a.length)} / ${fmt(cnt(a, n => n.ndNew === n.idd))} / ${fmt(cnt(a, n => n.ndNew !== n.idd))}`; };
    lines.set(11, cls(n => n.isw != null));
    lines.set(12, cls(n => n.dm));
    lines.set(13, cls(n => n.idd != null && dayOf(n.idd) > 12));
    lines.set(14, fmt(cnt(fin, n => n.idd == null)));
    lines.set(15, `${fmt(cnt(rest, r => r.ndNew - r.idd === -DAY))} / ${fmt(cnt(rest, r => r.ndNew - r.idd === DAY))} / ${fmt(cnt(rest, r => { const a = Math.abs(dayDiff(r.ndNew, r.idd)); return a >= 2 && a <= 7; }))} / ${fmt(cnt(rest, r => Math.abs(dayDiff(r.ndNew, r.idd)) > 7))}`);
    lines.set(16, `${fmt(cnt(rest, r => r.ndNew - r.idd === -DAY && dayOf(r.idd) > 12))} / ${fmt(cnt(rest, r => r.ndNew - r.idd === -DAY && r.dm))} / ${fmt(cnt(rest, r => r.ndNew - r.idd === -DAY && r.isw != null))}`);
    lines.set(17, `${fmt(cnt(rest, r => r.isw != null && r.ndNew === r.isw))} / ${fmt(cnt(rest, r => r.isw != null && r.ndNew === r.isw - DAY))} / ${fmt(cnt(rest, r => r.isw != null && r.ndNew === r.isw + DAY))} / ${fmt(cnt(rest, r => r.isw != null && ![r.isw, r.isw - DAY, r.isw + DAY].includes(r.ndNew)))} / ${fmt(cnt(rest, r => r.isw == null))}`);
    const hist = new Map(); for (const r of rest) { const k = dayDiff(r.ndNew, r.idd); hist.set(k, (hist.get(k) || 0) + 1); }
    const top = [...hist.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] - b[0])).slice(0, 8);
    lines.set(18, top.length ? top.map(([k, n]) => `${k}: ${n}`).join(', ') : 'none');
    lines.set(19, `${fmt(cnt(rest, r => eat(r.ca) === r.ndNew))} / ${fmt(cnt(rest, r => eat(r.ca) === r.idd && eat(r.ca) !== r.ndNew))} / ${fmt(cnt(rest, r => eat(r.ca) !== r.ndNew && eat(r.ca) !== r.idd))}`);
    const exN = rest.slice().sort((a, b) => (b.ndNew - a.ndNew) || (a.id < b.id ? -1 : 1)).slice(0, 8);
    exN.forEach((e, i) => lines.set(21 + i, `stored ${iso(e.ndNew)}, number says ${iso(e.idd)} (stored minus number: ${dayDiff(e.ndNew, e.idd)} days)` + (e.isw != null ? `, exchanged ${iso(e.isw)} (stored minus exchanged: ${dayDiff(e.ndNew, e.isw)})` : ', cannot be exchanged') + `, stamp ${iso(eat(e.ca))}, uploaded ${iso(e.ud)}` + (e.provedUp ? '' : ' (upload not proved)')));
    return { notices: st.notices, led, lines, exN, oks, rest, held, fixed };
  };
  const M = model(S0);
  // ---- running a file on a fresh copy of the template --------------------------------------------------------------------------------------------------
  const fresh = () => { drop(RUN); psql('create database ' + RUN + ' template ' + TPL, admin); };
  const dumpAll = () => psql(`select 'N' || md5(coalesce(string_agg(t::text, '|' order by id), '')) from public.demand_notices t;
    select 'L' || md5(coalesce(string_agg(t::text, '|' order by ref, since, payment_id), '')) from public.notice_payment_ledger t;
    select 'a' || md5(coalesce(string_agg((t.id, t.notice_old, t.notice_new, t.stamp_old, t.stamp_new)::text, '|' order by t.id), '')) from public.demand_notice_date_repair_log t;
    select 'n' || md5(coalesce(string_agg((t.id, t.notice_old, t.notice_new, t.stamp_old, t.stamp_new)::text, '|' order by t.id), '')) from public.demand_notice_shift_repair_log t;
    select 'm' || md5(coalesce(string_agg((t.ref, t.payment_id, t.since_old, t.since_new)::text, '|' order by t.ref, t.payment_id, t.since_new), '')) from public.notice_ledger_shift_move_log t;`).trim().split('\n').join('|');
  const runFile = file => parse(psql('begin;\n' + file + '\ncommit;\n'));
  fresh();
  const BEFORE_FRESH = dumpAll();
  // run the file for real
  const t0 = Date.now(); const rows1 = runFile(FILE); const secs1 = (Date.now() - t0) / 1000;
  const after1 = dumpAll();
  // 1. every printed line equals the model's
  const printed = rows1.map(r => r[1]);
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, ...M.exN.map((_, i) => 21 + i)];
  const want = order.map(k => M.lines.get(k));
  check('every line the file prints equals the model\'s, line by line (' + M.notices.length + ' notices, ' + want.length + ' lines)', JSON.stringify(printed) === JSON.stringify(want),
    (() => { for (let i = 0; i < Math.max(printed.length, want.length); i++) if (printed[i] !== want[i]) return 'line ' + i + ' (' + order[i] + '): got ' + JSON.stringify(printed[i]) + ' want ' + JSON.stringify(want[i]); return ''; })());
  check('the examples name the rows the model picks, in the model\'s order (the first eight characters of the id only)', JSON.stringify(rows1.filter(r => /e\.g\. notice/.test(r[0])).map(r => r[0].replace(/^\s+e\.g\. notice /, ''))) === JSON.stringify(M.exN.map(e => e.id.slice(0, 8))));
  check('no printed line holds a notice number, a name or an amount', !rows1.some(r => /HMCL\//.test(r[0] + r[1])) && rows1.every(r => r[0].length < 260));
  // 2. every row of every table equals the model
  const got = psql(`select id, notice_date, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') from public.demand_notices order by id`);
  const gotN = new Map(parse(got).map(r => [r[0], r.slice(1)]));
  const badN = M.notices.filter(n => { const g = gotN.get(n.id); return !g || g[0] !== (n.ndNew == null ? '' : iso(n.ndNew)) || g[1] !== new Date(n.caNew).toISOString().slice(0, 19); });
  check('EVERY notice (date and stamp) is what the model says after the run (' + M.notices.length + ' rows; ' + M.oks.length + ' dates changed, ' + cnt(M.notices, n => n.stampMoves) + ' stamps moved)', badN.length === 0,
    badN.slice(0, 3).map(n => n.id.slice(0, 8) + ' got ' + JSON.stringify(gotN.get(n.id)) + ' want ' + iso(n.ndNew) + ' ' + new Date(n.caNew).toISOString().slice(0, 19)).join(' | '));
  const gotL = new Map(parse(psql(`select matched_by, since from public.notice_payment_ledger`)).map(r => [r[0], r[1]]));
  const badL = M.led.filter(l => gotL.get(l.rid) !== iso(l.sinceNew));
  check('EVERY ledger row follows its notice, and a row that would meet the same payment already at the new date, or whose loan has another notice on the old or new date, stays (' + M.led.length + ' rows; ' + cnt(M.led, l => l.moved) + ' moved)', badL.length === 0 && gotL.size === M.led.length,
    badL.slice(0, 3).map(l => l.rid + ' got ' + gotL.get(l.rid) + ' want ' + iso(l.sinceNew)).join(' | '));
  const gotM = parse(psql(`select ref, payment_id, since_old, since_new from public.notice_ledger_shift_move_log order by ref, payment_id, since_new`));
  const wantM = M.led.filter(l => l.moved).map(l => [l.ref, l.pay, iso(l.since), iso(l.sinceNew)]).sort((a, b) => (a[0] + a[1] + a[3] < b[0] + b[1] + b[3] ? -1 : 1));
  check('the move log holds exactly the ledger rows that were moved (' + gotM.length + '), with where each one was and is', JSON.stringify(gotM) === JSON.stringify(wantM));
  const gotLog = parse(psql(`select id, notice_old, notice_new, to_char(stamp_old at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), to_char(stamp_new at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') from public.demand_notice_shift_repair_log order by id`));
  const wantLog = M.oks.map(n => [n.id, iso(n.nd), iso(n.idd), new Date(n.ca).toISOString().slice(0, 19), new Date(n.caNew).toISOString().slice(0, 19)])
    .concat(M.notices.filter(n => S0.log070.has(n.id)).map(n => [n.id, iso(n.nd), iso(n.idd), new Date(n.ca).toISOString().slice(0, 19), new Date(n.ca).toISOString().slice(0, 19)])).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  check('the notice log holds exactly the rows changed (old and new date, old and new stamp) and the rows an earlier run left (' + gotLog.length + ')', JSON.stringify(gotLog) === JSON.stringify(wantLog));
  // 3. what the fixture holds: every kind of row a break needs, counted
  const kinds = k => cnt(M.notices, n => n.kind === k);
  const A_ = M.notices.filter(n => n.kind === 'A'), B_ = M.notices.filter(n => n.kind === 'B');
  const cdOf = n => eat(n.caNew);
  const need = [
    ['the shape in the past, put back (30 or more)', cnt(A_, n => n.ok) >= 30], ['day equal to month, put back (20 or more)', cnt(B_, n => n.ok) >= 20],
    ['a day over twelve a day early left alone (6)', kinds('C') >= 6 && cnt(M.notices, n => n.kind === 'C' && n.ok) === 0], ['the exact exchange left alone (5)', kinds('Ex') >= 5 && cnt(M.notices, n => n.kind === 'Ex' && n.ok) === 0],
    ['a day late left alone (3)', kinds('P1') >= 3], ['a plain day early on a day that can be exchanged left alone (4)', kinds('Nm1') >= 4 && cnt(M.notices, n => n.kind === 'Nm1' && n.ok) === 0],
    ['a day late left alone, Np1 (3)', kinds('Np1') >= 3], ['other relations (Far, with diffs of 7 and 8 days)', kinds('Far') >= 11 && cnt(M.rest, r => Math.abs(dayDiff(r.ndNew, r.idd)) === 7) >= 2 && cnt(M.rest, r => Math.abs(dayDiff(r.ndNew, r.idd)) === 8) >= 2],
    ['a number later than the upload day left alone (3)', kinds('Hx') >= 3 && cnt(M.notices, n => n.kind === 'Hx' && n.ok) === 0], ['rows in 068\'s log and in this file\'s log, left alone (3 and 3)', kinds('L068') >= 3 && kinds('L070') >= 3 && cnt(M.notices, n => (n.kind === 'L068' || n.kind === 'L070') && n.ok) === 0],
    ['a second and a third upload that are not proved, their past-shaped notices left alone', kinds('A2') >= 10 && kinds('A3') >= 10 && cnt(M.notices, n => (n.kind === 'A2' || n.kind === 'A3') && n.ok) === 0], ['the same shape made in the app, untouched', kinds('APP-A') >= 8 && cnt(M.notices, n => n.kind === 'APP-A' && n.ok) === 0],
    ['stamps at 00:30 East Africa that move (3)', kinds('Au') >= 3 && cnt(M.notices, n => n.kind === 'Au' && n.stampMoves) === 3], ['the upload with exactly three proofs, one dated the day after the upload day: its six past-shaped notices and the one whose number is the upload day are put back',
      cnt(M.notices, n => n.kind === 'IMP4' && !n.cand) === 3 && cnt(M.notices, n => n.kind === 'A4' && n.ok) === 6 && cnt(M.notices, n => n.kind === 'A4eq' && n.ok) === 1],
    ['068 proved two uploads (the twelve, and the three) and not two others', [...new Set(M.notices.filter(n => n.provedUp).map(n => n.ud))].length === 2 && [...new Set(M.notices.filter(n => n.imp && !n.provedUp).map(n => n.ud))].length === 2],
    ['two notices of one loan: the one put back takes its recoveries, the other keeps its own (RSH3), and the shared dates stay (RSH1, RSH2)', M.notices.find(n => n.kind === 'O5').ok && !M.notices.find(n => n.kind === 'O6').ok && cnt(M.led, l => l.ref === 'RSH3' && l.moved) >= 2 && cnt(M.led, l => l.ref === 'RSH3' && !l.moved) >= 2
      && ['O1', 'O3'].every(k => M.notices.find(n => n.kind === k).ok) && cnt(M.led, l => (l.ref === 'RSH1' || l.ref === 'RSH2') && l.moved) === 0 && cnt(M.led, l => (l.ref === 'RSH1' || l.ref === 'RSH2') && !l.moved) >= 2],
    ['stamps moved (40 or more) and kept (5 or more), clocks of 12:00 and 21:00 among the notices put back, and a 12:00 stamp on rows left alone', cnt(M.oks, n => n.stampMoves) >= 40 && cnt(M.oks, n => !n.stampMoves) >= 5 && cnt(M.oks, n => clockEat(n.ca) === H(12)) >= 5 && cnt(M.oks, n => clockEat(n.ca) === H(21)) >= 5 && cnt(M.rest, r => clockEat(r.ca) === H(12)) >= 4],
    ['ledger rows moved (20 or more), held (4 or more), and a payment before the corrected date (3 or more)', cnt(M.led, l => l.moved) >= 20 && M.held - cnt(M.led, l => l.moved) >= 4 && cnt(M.led, l => l.moved && l.paid != null && l.paid < l.sinceNew) >= 3],
    ['stamps on another day than a RIGHT notice date, of each shape (Sx 4, Sy 2, Sz 2)', ['Sx', 'Sy', 'Sz'].every(k => cnt(M.notices, n => n.kind === k && cdOf(n) !== n.ndNew) >= 2) && cnt(M.notices, n => n.kind === 'Sx') === 4],
    ['the answer lists eight examples', M.exN.length === 8], ['the rows 068 put right are not counted among the imported notices left', kinds('IMP') >= 9 && cnt(M.rest, r => r.kind === 'IMP') === 0],
  ];
  check('the fixture holds every kind of row a break needs: put back ' + M.oks.length + ' (the shape in the past ' + cnt(A_, n => n.ok) + ', day = month ' + cnt(B_, n => n.ok) + '); stamps moved ' + cnt(M.notices, n => n.stampMoves) + ', kept ' + cnt(M.oks, n => !n.stampMoves)
    + '; ledger moved ' + cnt(M.led, l => l.moved) + ', held ' + (M.held - cnt(M.led, l => l.moved)), need.every(x => x[1]), need.filter(x => !x[1]).map(x => x[0]).join(' | '));
  // 4. a second run changes nothing, and says so
  const rows2 = runFile(FILE);
  const after2 = dumpAll();
  check('a second run changes nothing (every table and every log byte-identical) and puts nothing right', after2 === after1 && /^0 notice date\(s\) put back/.test(rows2[0][1]), rows2[0] && rows2[0][1]);
  // 5. the undo at the foot: every table back byte for byte; and a run after the undo changes nothing (the logs keep their rows)
  const undo = FILE.split('\n').filter(l => /^-- (update|-- update)/.test(l)).map(l => l.replace(/^-- /, '')).join('\n');
  check('the undo at the foot is two statements (ledger, notices) that run', (undo.match(/\bupdate\b/g) || []).length === 2, undo.slice(0, 80));
  const beforeTables = BEFORE_FRESH.split('|').slice(0, 2).join('|');
  psql('begin;\n' + undo + '\ncommit;');
  const afterUndo = dumpAll();
  check('the undo puts every notice and ledger row back byte for byte', afterUndo.split('|').slice(0, 2).join('|') === beforeTables, 'before ' + beforeTables + ' after-undo ' + afterUndo.split('|').slice(0, 2).join('|'));
  const logsKept = afterUndo.split('|').slice(2).join('|') === after1.split('|').slice(2).join('|');
  const rows3 = runFile(FILE);
  check('the logs keep their rows through the undo, and a run after it changes no row (a row undone stays undone)', logsKept && dumpAll() === afterUndo && /^0 notice date\(s\) put back/.test(rows3[0][1]));
  // 6. a book without 068's log is refused; a book without the ledger is refused; a book where no upload is proven says so, with nothing changed; an empty book answers
  const tabs = () => psql(`select 'N' || md5(coalesce(string_agg(t::text, '|' order by id), '')) from public.demand_notices t;
    select 'L' || md5(coalesce(string_agg(t::text, '|' order by ref, since, payment_id), '')) from public.notice_payment_ledger t;`).trim().split('\n').join('|');
  fresh(); const beforeTabs = tabs();
  psql('drop table public.demand_notice_date_repair_log;');
  let refused = ''; try { runFile(FILE); } catch (err) { refused = err.psql || err.message; }
  check('a book without RUN-ME-068\'s log is refused with its own words, and nothing is changed', /Run db\/RUN-ME-068 first/.test(refused) && tabs() === beforeTabs, refused.slice(0, 160));
  fresh(); psql('drop table public.notice_payment_ledger cascade;');
  refused = ''; try { runFile(FILE); } catch (err) { refused = err.psql || err.message; }
  check('a book without the ledger is refused with its own words', /Run db\/RUN-ME-041a first/.test(refused), refused.slice(0, 160));
  fresh(); psql('delete from public.demand_notice_date_repair_log;');
  const noproof = runFile(FILE);
  check('a book where no upload is proved says so and changes nothing (the notices and the ledger are byte-identical)', /^no upload is proved to carry the shift/.test(noproof[0][1]) && tabs() === beforeTabs, noproof[0] && noproof[0][1]);
  fresh(); psql('begin;\ndelete from public.demand_notices;\ndelete from public.notice_payment_ledger;\ndelete from public.demand_notice_date_repair_log;\ndelete from public.demand_notice_shift_repair_log;\ncommit;');
  const empty = runFile(FILE);
  check('an empty book answers "nothing was changed" and counts zero everywhere', /^no upload is proved/.test(empty[0][1]) && empty.find(r => r[0].startsWith('imported notices (upload date set)'))[1] === '0 / 0 / 0' && empty.find(r => r[0].startsWith('imported notices whose date still'))[1] === '0 / 0');

  // ---- a book of live size and a hundred times that: the timing the owner will see ------------------------------------------------------------------
  fresh();
  psql(`begin; delete from public.demand_notices; delete from public.notice_payment_ledger; delete from public.demand_notice_date_repair_log; delete from public.demand_notice_shift_repair_log; commit;`);
  psql(`insert into public.demand_notices (ref, notice_id, notice_date, created_at, upload_date)
        select 'R' || g, 'HMCL/AB/' || lpad((1 + g % 28)::text, 2, '0') || '/' || lpad((1 + g % 12)::text, 2, '0') || '/2026-' || g,
               make_date(2026, 1 + (g * 7) % 9, 1 + g % 28), now() - (g % 300) * interval '1 day', case when g % 3 = 0 then date '2026-10-12' end
        from generate_series(1, 95000) g;
        insert into public.demand_notices (ref, notice_id, notice_date, created_at, upload_date)       -- 5,000 of the shape: the number's day exchanged and a day early, in the past, imported
        select 'S' || g, 'HMCL/AB/' || lpad((1 + g % 10)::text, 2, '0') || '/12/2025-' || g, make_date(2025, 1 + g % 10, 12) - 1, (make_date(2025, 1 + g % 10, 12) - 1)::timestamptz + interval '9 hours', date '2026-10-12'
        from generate_series(1, 5000) g;
        insert into public.demand_notices (ref, notice_id, notice_date, created_at, upload_date)       -- the proof: three notices put right by 068 (dated after the upload day)
        select 'T' || g, 'HMCL/AB/12/0' || g || '/2026', make_date(2026, 12, g) - 1, make_date(2026, 12, g)::timestamptz, date '2026-10-12' from generate_series(1, 3) g;
        insert into public.demand_notice_date_repair_log (id, notice_old, notice_new) select id, make_date(2026, 12, 5), make_date(2026, 1, 12) from public.demand_notices where ref like 'T%';
        insert into public.notice_payment_ledger (ref, since, payment_id, paid_at, amount)
        select 'S' || g, make_date(2025, 1 + g % 10, 12) - 1, gen_random_uuid(), date '2026-10-20', 1000 from generate_series(1, 5000) g, generate_series(1, 3) k;
        insert into public.notice_payment_ledger (ref, since, payment_id, paid_at, amount)
        select 'R' || g, make_date(2026, 1 + (g * 7) % 9, 1 + g % 28), gen_random_uuid(), date '2026-12-20', 1000 from generate_series(1, 25000) g;
        analyze public.demand_notices; analyze public.notice_payment_ledger;`);
  const t1 = Date.now(); const big = runFile(FILE); const secsBig = (Date.now() - t1) / 1000;
  check('a book of 100,000 notices (5,000 of them to repair), 3 proofs and a ledger of 40,000 rows (a hundred times the live one) is repaired in ' + secsBig.toFixed(2) + ' s, under the 30-second ceiling, and puts the 5,000 right',
    big.length > 8 && secsBig < 20 && /^5,000 notice date\(s\) put back/.test(big[0][1]), big[0] && big[0][1]);

  // ---- broken on purpose: each break must change the outcome (every table, every log and every printed line), or fail on the row its guard is for ----------------------------
  const sigOf = file => { fresh(); const rows = runFile(file); return JSON.stringify([rows, dumpAll()]); };
  const baseSig = sigOf(FILE);
  const sub = (src, re, to, what) => { const n = (src.match(new RegExp(re.source, 'g')) || []).length; if (n !== 1) throw new Error('the file has ' + n + ' of "' + what + '", the check needs exactly one'); return src.replace(re, () => to); };
  const rep = (re, to) => src => sub(src, re, to, String(re));
  const breaks = [
    // the proof of the upload
    ['an upload needs no proof',                                                              rep(/coalesce\(pr\.n_proved, 0\) >= 3/, 'true')],
    ['two proofs are enough',                                                                 rep(/coalesce\(pr\.n_proved, 0\) >= 3/, 'coalesce(pr.n_proved, 0) >= 2')],
    ['four proofs are needed',                                                                rep(/coalesce\(pr\.n_proved, 0\) >= 3/, 'coalesce(pr.n_proved, 0) >= 4')],
    ['a row of 068\'s log counts as a proof whatever its old date was',                      rep(/ and g\.notice_old > n\.upload_date\n/, '\n')],
    ['a log row counts as a proof only when its old date is two days after the upload',       rep(/g\.notice_old > n\.upload_date/, "g.notice_old > n.upload_date + 1")],
    ['the proofs are counted over all uploads, not the row\'s own',                          rep(/from w left join pr on pr\.ud = w\.ud/, 'from w left join (select null::date as ud, sum(n_proved) as n_proved from pr) pr on true')],
    // the row's own proof
    ['a notice need not be proved at all (the shape is not asked)',                           rep(/and \(\(c\.isw is not null and c\.nd = c\.isw - 1\)\n\s+or \(c\.isw is null and c\.dm and c\.nd = c\.idd - 1\)\)/, '')],
    ['the exchanged shape is not repaired',                                                   rep(/\(\(c\.isw is not null and c\.nd = c\.isw - 1\)\n/, '((c.isw is not null and false)\n')],
    ['the day-equal-to-month shape is not repaired',                                          rep(/or \(c\.isw is null and c\.dm and c\.nd = c\.idd - 1\)\)/, 'or (false))')],
    ['a day over twelve a day early is repaired too',                                         rep(/or \(c\.isw is null and c\.dm and c\.nd = c\.idd - 1\)\)/, 'or (c.isw is null and c.nd = c.idd - 1))')],
    ['the exact exchange (no day early) is repaired too',                                     rep(/\(\(c\.isw is not null and c\.nd = c\.isw - 1\)\n/, '((c.isw is not null and c.nd in (c.isw, c.isw - 1))\n')],
    ['the exchange a day late is repaired too',                                               rep(/\(\(c\.isw is not null and c\.nd = c\.isw - 1\)\n/, '((c.isw is not null and c.nd in (c.isw - 1, c.isw + 1))\n')],
    ['a plain day early is repaired where the day can be exchanged',                          rep(/or \(c\.isw is null and c\.dm and c\.nd = c\.idd - 1\)\)/, 'or (c.dm and c.nd = c.idd - 1) or (c.isw is not null and c.nd = c.idd - 1))')],
    ['the number\'s day may be later than the upload day',                                    rep(/  where c\.idd <= c\.ud\n/, '  where true\n')],
    ['the number\'s day must be before the upload day (the upload day itself is refused)',    rep(/  where c\.idd <= c\.ud\n/, '  where c.idd < c.ud\n')],
    ['a row an earlier run of this file changed (or undid) is changed again',                 rep(/\(l\.id is not null or l2\.id is not null\) as was_fixed/, '(l.id is not null) as was_fixed')],
    ['a row 068 changed (or undid) is changed again',                                         rep(/\(l\.id is not null or l2\.id is not null\) as was_fixed/, '(l2.id is not null) as was_fixed')],
    ['nothing is excluded as already changed',                                                rep(/and x\.nd <> x\.idd and not x\.was_fixed/, 'and x.nd <> x.idd')],
    ['the day equal to the month is not told from a day that can be exchanged',               rep(/\(v\.idd is not null and extract\(day from v\.idd\) = extract\(month from v\.idd\)\) as dm/, '(v.idd is not null) as dm')],
    ['a number in lower case is a number',                                                    rep(/\(\?:-\\d\+\)\?\$'\) as p/, "(?:-\\d+)?$', 'i') as p")],
    ['a repeat number (-2) is not a number',                                                  rep(/\(\\d\{4\}\)\(\?:-\\d\+\)\?\$/, '(\\d{4})$')],
    ['the number\'s pattern need not start at the start',                                     rep(/'\^HMCL\//, "'HMCL/")],
    ['the day of a number may be any of 1 to 31 (a number typed 31/04: the file fails on it)', rep(/between 1 and extract\(day from \(make_date\(\(m\.p\)\[3\]::int, \(m\.p\)\[2\]::int, 1\) \+ interval '1 month' - interval '1 day'\)\)::int/, 'between 1 and 31'), true],
    ['the month of a number may be any (a number typed with month 13: the file fails on it)', rep(/\(m\.p\)\[2\]::int between 1 and 12 and /, ''), true],
    ['the day and month are not exchanged',                                                   rep(/make_date\(extract\(year from v\.idd\)::int, extract\(day from v\.idd\)::int, extract\(month from v\.idd\)::int\)/, 'v.idd')],
    ['a day of twelve is not exchanged',                                                      rep(/extract\(day from v\.idd\) <= 12 and/, 'extract(day from v.idd) <= 11 and')],
    ['imported is read from the wrong side',                                                  rep(/select w\.\*, \(w\.ud is not null and coalesce/, 'select w.*, (w.ud is null and coalesce')],
    // the stamp
    ['the stamp\'s day is the UTC day, not the East Africa day',                              rep(/v\.cl::date as cd,/, "(v.ca at time zone 'UTC')::date as cd,")],
    ['the stamp moves whatever its day is',                                                   rep(/case when c\.cd = c\.nd then/, 'case when true then')],
    ['the stamp never moves',                                                                 rep(/case when c\.cd = c\.nd then/, 'case when false then')],
    ['the stamp moves only when it is the day AFTER the stored date',                         rep(/case when c\.cd = c\.nd then/, 'case when c.cd = c.nd + 1 then')],
    ['the stamp keeps no clock: it moves to noon',                                            rep(/\(\(c\.idd \+ c\.cl::time\) at time zone 'Africa\/Dar_es_Salaam'\)/, "((c.idd + time '12:00') at time zone 'Africa/Dar_es_Salaam')")],
    ['the new stamp is read as UTC, not East Africa time',                                    rep(/\(\(c\.idd \+ c\.cl::time\) at time zone 'Africa\/Dar_es_Salaam'\)/, "((c.idd + c.cl::time) at time zone 'UTC')")],
    ['the stamp\'s clock is read as UTC, not East Africa time',                               rep(/\(n\.created_at at time zone 'Africa\/Dar_es_Salaam'\) as cl/, "(n.created_at at time zone 'UTC') as cl")],
    // the ledger
    ['the ledger is not moved with the date',                                                 rep(/update public\.notice_payment_ledger l set since = o\.idd/, 'update public.notice_payment_ledger l set since = l.since')],
    ['every ledger row of the customer moves, not only the ones at the notice\'s old date',    rep(/where l\.ref = o\.ref and l\.since = o\.nd\n/, 'where l.ref = o.ref\n')],
    ['a ledger row that meets one already at the new date is moved anyway (the file fails on the collision)', rep(/\n     and not exists \(select 1 from public\.notice_payment_ledger y where y\.ref = l\.ref and y\.since = o\.idd and y\.payment_id = l\.payment_id\)/, ''), true],
    ['ledger rows move although another notice of the loan carries the old or new date',      rep(/\n     and not exists \(select 1 from x z where z\.ref = o\.ref and z\.id <> o\.id and z\.nd in \(o\.nd, o\.idd\)\)/, '')],
    ['ledger rows move unless another notice carries the OLD date (the new date is not asked)', rep(/z\.nd in \(o\.nd, o\.idd\)/, 'z.nd = o.nd')],
    ['ledger rows move unless another notice carries the NEW date (the old date is not asked)', rep(/z\.nd in \(o\.nd, o\.idd\)/, 'z.nd = o.idd')],
    ['the move log is not written',                                                           rep(/select e\.ref, e\.payment_id, e\.since_old, e\.since_new from led e/, 'select e.ref, e.payment_id, e.since_old, e.since_new from led e where false')],
    // the logs
    ['the notice log is not written',                                                         rep(/select o\.id, o\.nd, o\.idd, o\.ca, o\.ca_new from ok o\n/, 'select o.id, o.nd, o.idd, o.ca, o.ca_new from ok o where false\n')],
    ['the new stamp is not logged',                                                           rep(/select o\.id, o\.nd, o\.idd, o\.ca, o\.ca_new from ok o\n/, 'select o.id, o.nd, o.idd, o.ca, o.ca from ok o\n')],
    // the report
    ['the answer says nothing was changed whatever was found',                                rep(/when \(select count\(\*\) from fin where proved_up\) = 0\n/, 'when true\n')],
    ['the examples are the earliest dates first',                                             rep(/over \(order by r\.nd2 desc, r\.id\)/, 'over (order by r.nd2 asc, r.id)')],
    ['five examples, not eight',                                                              rep(/from ex e where e\.rn <= 8/, 'from ex e where e.rn <= 5')],
    ['one day early and one day late are counted alike',                                      rep(/to_char\(\(select count\(\*\) from rest where nd2 - idd = -1\), 'FM999,999,999'\) \|\| ' \/ ' \|\| to_char\(\(select count\(\*\) from rest where nd2 - idd = 1\)/, "to_char((select count(*) from rest where abs(nd2 - idd) = 1), 'FM999,999,999') || ' / ' || to_char((select count(*) from rest where nd2 - idd = 1)")],
    ['"within a week" stops at six days',                                                     rep(/abs\(nd2 - idd\) between 2 and 7/, 'abs(nd2 - idd) between 2 and 6')],
    ['"further" starts at seven days',                                                        rep(/abs\(nd2 - idd\) > 7\)/, 'abs(nd2 - idd) >= 7)')],
    ['the most common differences list three, not eight',                                     rep(/t\.rk <= 8/, 't.rk <= 3')],
    ['what is left over counts the rows this run changed too',                                rep(/select f\.\* from fin f where f\.nd is not null and f\.idd is not null and f\.nd2 <> f\.idd/, 'select f.* from fin f where f.nd is not null and f.idd is not null and f.nd <> f.idd')],
    ['the stamps left on another day are counted before this run moved any',                  rep(/from fin where cd2 is distinct from nd2\), 'FM999,999,999'\) \|\| ' \/ '\n/, "from fin where cd is distinct from nd2), 'FM999,999,999') || ' / '\n")],
    ['the stamp\'s shape is the number\'s day less one only (the exchange is not asked)',     rep(/\(isw is not null and cd2 = isw - 1\) or \(isw is null and dm and cd2 = idd - 1\)\)\), 'FM999,999,999'\) \|\| ' \/ '\n\s+\|\| to_char/, "(isw is not null and cd2 = idd - 1) or (isw is null and dm and cd2 = idd - 1))), 'FM999,999,999') || ' / '\n         || to_char")],
    ['the stamp clocks are counted over every imported notice, not the ones put back',        rep(/from ok where cl::time = time '12:00'/, "from fin where cl::time = time '12:00'")],
    ['ledger rows before their notice are counted on the old date',                           rep(/from led where paid_at < since_new/, 'from led where paid_at < since_old')],
    ['ledger rows left are not counted (the number is always zero)',                          rep(/\(select n from held\) - \(select count\(\*\) from led\)/, '0')],
    ['the day-over-twelve line counts day twelve too',                                        rep(/from fin where idd is not null and extract\(day from idd\) > 12\), 'FM999,999,999'\) \|\| ' \/ '\n/, "from fin where idd is not null and extract(day from idd) >= 12), 'FM999,999,999') || ' / '\n")],
  ];
  let notCaught = 0;
  for (const [name, fn, mustFail] of breaks) {
    let broken = null, why = '', ok = false;
    try { broken = fn(FILE); } catch (err) { why = err.message; }
    if (broken !== null) {
      try { const changed = sigOf(broken) !== baseSig; ok = !mustFail && changed; if (mustFail) why = 'the broken file ran, but it should have failed'; }
      catch (err) { if (mustFail) ok = /out of range|date field value|invalid|duplicate key/i.test(err.psql || err.message); else why = 'the broken file does not run: ' + err.message.slice(0, 200); }
    }
    if (!ok) notCaught++;
    check('BROKEN ON PURPOSE, ' + (mustFail ? 'the file fails on the row that guard is for: ' : 'the outcome changes: ') + name, ok, why || 'the outcome is the same as the file\'s');
  }
  console.log('\n' + (fails.length ? fails.length + ' FAILED' : 'all passed') + ' (' + breaks.length + ' breaks, ' + (breaks.length - notCaught) + ' caught; first run ' + secs1.toFixed(2) + ' s)');
  exitCode = fails.length ? 1 : 0;
} finally {
  if (!process.env.KEEP_TEMPLATE) { drop(TPL); drop(RUN); } else drop(RUN);   // KEEP_TEMPLATE=1 keeps the fixture database (after RUN-ME-068) for looking at the file's answer by hand
}
process.exit(exitCode);
