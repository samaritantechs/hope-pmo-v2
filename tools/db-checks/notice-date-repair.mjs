/* THE REPAIR OF THE NOTICE DATES THAT CANNOT BE REAL AND OF THE DEDUCTION DISCOVERY DATES AFTER THE SUBMISSION -- db/RUN-ME-068, run for real on a PostgreSQL.

     "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026

   db/RUN-ME-068-repair-impossible-notice-and-deduction-dates.sql CHANGES DATA on the owner's live book, so it is not believed on a reading. It writes back to a notice the day its own number says,
   only when the notice is dated after the day it was uploaded and the stored date is that day exchanged (exactly, or a day early); it moves the stamp and the notice's recoveries in
   notice_payment_ledger with it; and it puts right a deduction's discovery date only when it is after the day the case was submitted and ONE reading puts the three dates in order.

   THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database, the real migrations that add notice_id and upload_date to demand_notices, and the real RUN-ME-041a (the ledger table
   with its primary key (ref, since, payment_id), and its function). The fixture knows the truth: notices of every kind the rule has to tell apart (made in the app; imported and right; the
   shape of all twelve on the live book, real 12ths exchanged and a day early; real 11ths that land in November; a plain exchange; shapes before the upload day that must be left alone;
   other relations; a number later than the upload day; no usable number; a day that cannot be exchanged; already in the log; a second upload day; stamps on the exchange, on the real day,
   earlier, later and written at 21:30 UTC), ledger rows (some meeting a row already at the new date), deductions of every kind (late and fixable, the submission day readable two ways,
   the received date readable two ways, no single reading, discovered before the money, in order, nothing filled in).

   It passes only when: EVERY ROW of demand_notices, notice_payment_ledger and pmo_deductions equals what a MODEL written again in JavaScript says after the run, the two logs hold exactly the rows
   changed, EVERY LINE the file prints equals the model's (examples and their order included), a second run changes nothing and says so, the undo at the foot puts every table back byte for
   byte, a book without the ledger is refused with nothing changed, an empty book answers, a book a hundred times the live one runs in seconds, and EVERY ONE of a list of deliberate breaks of
   the file changes the outcome (or, for the guards that stop a typed number from being a day that does not exist, or a ledger row meeting another, makes the file fail on that very row).

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/notice-date-repair.mjs

   It makes, uses and drops its own scratch databases. NEVER point it at the live book. Exit code 0 = the file did what it says, and failed when broken. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-068-repair-impossible-notice-and-deduction-dates.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
const MIG_ID = fs.readFileSync(path.join(ROOT, 'db/migrations/2026-07-26-demand-notice-id.sql'), 'utf8');
const MIG_STAMP = fs.readFileSync(path.join(ROOT, 'db/migrations/2026-07-28-upload-stamp.sql'), 'utf8');
const LEDGER = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-041a-notice-payment-ledger.sql'), 'utf8');
const SEP = '\x1f', DAY = 86400000, TPL = 'hope_nr_tpl', RUN = 'hope_nr_run';
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
const swap = t => { if (t == null) return null; const d = new Date(t), m = d.getUTCMonth() + 1, dd = d.getUTCDate(); return (dd <= 12 && m !== dd) ? Date.UTC(d.getUTCFullYear(), dd - 1, m) : null; };   // null when there is no other reading
const eat = t => { const x = new Date(t + 3 * 3600000); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()); };                                // the day in East Africa (UTC+3, no daylight saving)
const clockEat = t => (((t + 3 * 3600000) % DAY) + DAY) % DAY;                                                                                                 // the East Africa time of day, in ms

const admin = process.env.PGDATABASE || 'postgres';
const drop = db => { try { psql('drop database if exists ' + db, admin); } catch { /* none */ } };
drop(TPL); drop(RUN);
const fails = [];
const check = (name, ok, extra) => { if (!ok) fails.push(name + (extra ? ' -- ' + extra : '')); console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok || !extra ? '' : ' -- ' + extra)); };
let exitCode = 1;
try {
  psql('create database ' + TPL, admin);
  psql(SCHEMA, TPL); psql(MIG_ID, TPL); psql(MIG_STAMP, TPL); psql(LEDGER, TPL);
  // ---- the notices -----------------------------------------------------------------------------------------------------------------------
  const PAT = /^HMCL\/[^/]+\/(\d{2})\/(\d{2})\/(\d{4})(?:-\d+)?$/;
  const numDay = s => {
    const m = s == null ? null : PAT.exec(s); if (!m) return null;
    const d = +m[1], mo = +m[2], y = +m[3];
    return (mo >= 1 && mo <= 12 && y >= 2000 && y <= 2100 && d >= 1 && d <= daysIn(y, mo)) ? Date.UTC(y, mo - 1, d) : null;
  };
  const UD = U(2026, 10, 12), UD2 = U(2026, 11, 5);
  const PAT_NUM = /^HMCL\/[^/]+\/\d{2}\/\d{2}\/\d{4}(?:-\d+)?$/;
  const notices = []; let nid = 0;
  const used = new Set();
  const num = (d, suffix = '', init = pick(['AB', 'MJ', 'XY', 'KA'])) => { const x = new Date(d); return `HMCL/${init}/${p2(x.getUTCDate())}/${p2(x.getUTCMonth() + 1)}/${x.getUTCFullYear()}${suffix}`; };
  const add = n => {
    if (n.number != null && PAT_NUM.test(n.number)) { const base = n.number.replace(/-\d+$/, ''); let c = n.number, k = 2; while (used.has(c)) c = base + '-' + (k++); n.number = c; }
    if (n.number != null) used.add(n.number);
    const id = uuid('5', ++nid);
    notices.push({ id, ref: 'R' + id.slice(1, 8), ud: UD, inLog: false, ...n });
  };
  const stampDay = (d, h = 9, mi = 0) => d + (h - 3) * 3600000 + mi * 60000;       // a stamp on the East Africa day d at h:mi there
  // made in the app: right, no upload day
  for (let i = 0; i < 40; i++) { const d = U(2026, 1, 1) + Math.floor(rnd() * 300) * DAY; add({ kind: 'app', ud: null, nd: d, number: num(d), stampAt: stampDay(d) }); }
  // imported and right
  for (let i = 0; i < 50; i++) { const d = U(2026, 1, 1) + Math.floor(rnd() * 270) * DAY; add({ kind: 'impok', nd: d, number: num(d, pick(['', '', '-2'])), stampAt: stampDay(d, 6) }); }
  // near: the stored date is within days of the number's day, either way (a notice dated again after its number was made looks like this): left alone, described in the "within a week" and "further" counts
  for (const k of [-1, 1, 2, -2, 7, -7, 8, -8, 3, -3]) { const d = U(2026, 3, 10) + (k + 20) * DAY; add({ kind: 'near', nd: d + k * DAY, number: num(d), stampAt: stampDay(d, 9) }); }
  // C: the shape of all twelve on the live book: the real 12th of a month, stored exchanged and a day early. Stamps: six kinds
  for (let i = 0; i < 36; i++) {
    const m = 1 + i % 10, real = U(2026, m, 12), sw = swap(real), nd = sw - DAY, sk = i % 6;
    const stampAt = [stampDay(nd, 9), stampDay(sw, 10, 30), stampDay(real, 11), stampDay(U(2026, 9, 9), 8), stampDay(U(2026, 12, 20), 8), stampDay(sw - DAY, 0, 30)][sk];   // mirror / exchange exact / real day / earlier / later, no relation / EAT 00:30 (21:30 UTC the day before)
    add({ kind: 'C', nd, number: num(real, sk === 0 ? '-2' : ''), stampAt, ledger: i % 12 === 0 });
  }
  // D: the real 11th: stored exchanged and a day early lands in November, after the upload day but not later than today. Their recoveries are in the ledger
  for (let i = 0; i < 20; i++) { const m = 1 + i % 10, real = U(2026, m, 11), nd = swap(real) - DAY; add({ kind: 'D', nd, real, number: num(real), stampAt: stampDay(nd, 14), ledger: true, collide: i % 5 === 0 }); }
  // E: a plain exchange (no day lost), after the upload day
  for (let i = 0; i < 9; i++) { const real = U(2026, 1 + i, 12), nd = swap(real); add({ kind: 'E', nd, number: num(real), stampAt: stampDay(nd, 9) }); }
  // F: the same shape, but not after the upload day: left alone, described
  for (let i = 0; i < 12; i++) { const real = U(2026, 6 + i % 4, 5), nd = swap(real) - DAY; add({ kind: 'F', nd, number: num(real), stampAt: stampDay(real, 9) }); }
  // G: after the upload day with another relation to the number: left alone
  for (let i = 0; i < 4; i++) { const real = U(2026, 3 + i, 12); add({ kind: 'G+3', nd: swap(real) + 3 * DAY, number: num(real), stampAt: stampDay(real, 9) }); }
  for (let i = 0; i < 4; i++) { const real = U(2026, 3 + i, 12); add({ kind: 'G-2', nd: swap(real) - 2 * DAY, number: num(real), stampAt: stampDay(real, 9) }); }
  for (let i = 0; i < 4; i++) { const real = U(2026, 3 + i, 12); add({ kind: 'G+1', nd: swap(real) + 1 * DAY, number: num(real), stampAt: stampDay(real, 9) }); }
  for (let i = 0; i < 4; i++) { const real = U(2026, 9, 12 + i); add({ kind: 'G60', nd: real + 60 * DAY, number: num(real), stampAt: stampDay(real, 9) }); }
  // H: the number's own day is later than the upload day: left alone even where the stored date is its exchange
  for (let i = 0; i < 4; i++) { const real = U(2026, 11, 12); add({ kind: 'Hx', nd: swap(real), number: num(real), stampAt: stampDay(real, 9) }); }
  for (let i = 0; i < 3; i++) { const real = U(2026, 11, 12); add({ kind: 'Hy', nd: swap(real) - DAY, number: num(real), stampAt: stampDay(real, 9) }); }
  for (let i = 0; i < 3; i++) { const real = U(2026, 10, 20); add({ kind: 'Hz', nd: U(2026, 11, 3), number: num(real), stampAt: stampDay(real, 9) }); }
  // I: no usable number, or one the pattern must refuse
  const bad = [null, null, '', 'ABC123', 'ABC124', 'hmcl/ab/12/09/2026', 'hmcl/ab/12/08/2026', 'HMCL/AB/05/06/2026-', 'XHMCL/AB/12/09/2026', 'HMCL/AB/12/09/2026 ', 'HMCL/AB/5/6/2026', 'HMCL/AB/12/09/26'];   // the book keeps a number unique (idx_demand_notice_id), an empty one too
  for (const b of bad) add({ kind: 'I', nd: U(2026, 12, 8), number: b, stampAt: stampDay(U(2026, 9, 12), 9) });
  add({ kind: 'I31', nd: U(2026, 12, 8), number: 'HMCL/AB/31/04/2026', stampAt: stampDay(U(2026, 9, 12), 9) });          // a day that does not exist: a guard, the file must not fail on it
  add({ kind: 'I13', nd: U(2026, 12, 8), number: 'HMCL/AB/05/13/2026', stampAt: stampDay(U(2026, 9, 12), 9) });          // a month 13
  // J: a day that cannot be exchanged (a day over twelve, or the day equal to the month)
  for (let i = 0; i < 4; i++) { const real = U(2026, 9, 20 + i); add({ kind: 'J', nd: U(2026, 11, 20 + i), number: num(real), stampAt: stampDay(real, 9) }); }
  for (let i = 0; i < 3; i++) { const real = U(2026, 5, 5); add({ kind: 'J55', nd: U(2026, 12, 5), number: num(real), stampAt: stampDay(real, 9) }); }
  // K: made in the app, dated in the future, the same shape: not imported, untouched
  for (let i = 0; i < 4; i++) { const real = U(2026, 9, 12), nd = swap(real) - DAY; add({ kind: 'K', ud: null, nd, number: num(real), stampAt: stampDay(nd, 9) }); }
  // L: already in the log (an earlier run, undone): never changed again
  for (let i = 0; i < 3; i++) { const real = U(2026, 7, 12), nd = swap(real) - DAY; add({ kind: 'L', nd, number: num(real), stampAt: stampDay(nd, 9), inLog: true }); }
  // M: no notice date
  for (let i = 0; i < 3; i++) add({ kind: 'M', nd: null, number: num(U(2026, 8, 3 + i)), stampAt: stampDay(U(2026, 8, 3 + i), 9) });
  // N: a second upload day (5 Nov): the day of the row's own upload decides, not the first one
  for (let i = 0; i < 12; i++) { const m = [2, 3, 4, 5, 6, 7, 8, 9][i % 8], real = U(2026, m, 11), nd = swap(real) - DAY; add({ kind: 'N', ud: UD2, nd, number: num(real), stampAt: stampDay(nd, 9) }); }
  // the boundary of the stamp: the stamp's day is the upload day itself, and it is the exchanged day less one
  add({ kind: 'Nb', ud: UD2, nd: swap(U(2026, 6, 11)), number: num(U(2026, 6, 11)), stampAt: stampDay(UD2, 9) });
  // O: one customer with two notices: only the one dated after its upload day is changed, and only ITS recoveries move
  { const real = U(2026, 4, 12), nd = swap(real) - DAY;
    add({ kind: 'O1', ref: 'RSHARED', nd, number: num(real), stampAt: stampDay(nd, 9), ledger: true });
    add({ kind: 'O2', ref: 'RSHARED', nd: U(2026, 8, 3), number: num(U(2026, 8, 3)), stampAt: stampDay(U(2026, 8, 3), 9), ledger: true }); }
  const copyN = `copy public.demand_notices (id, ref, notice_id, notice_date, created_at, upload_date) from stdin with (format csv, null '');\n`
    + notices.map(n => [n.id, n.ref, n.number == null ? '' : '"' + String(n.number).replace(/"/g, '""') + '"', n.nd == null ? '' : iso(n.nd), new Date(n.stampAt).toISOString(), n.ud == null ? '' : iso(n.ud)].join(',')).join('\n') + '\n\\.\n';
  // ---- the ledger (RUN-ME-041a): rows kept by (ref, since, payment) ----------------------------------------------------------------------------
  const ledger = []; let pid = 0;
  const addL = (ref, since, paid, amount = 1000) => ledger.push({ ref, since, pay: uuid('7', ++pid), paid, amount, rid: 'f' + pid });
  for (const n of notices) {
    if (n.ledger) { addL(n.ref, n.nd, n.nd + 2 * DAY); if (n.kind !== 'C') addL(n.ref, n.nd, n.nd + 5 * DAY, 2500); }
    if (n.kind === 'D' && n.collide) { const first = ledger.find(l => l.ref === n.ref && l.since === n.nd); ledger.push({ ref: n.ref, since: n.real, pay: first.pay, paid: first.paid, amount: first.amount, rid: 'c' + (++pid) }); }   // the same payment already kept at the REAL date
  }
  for (const n of notices.filter(x => x.kind === 'impok').slice(0, 20)) addL(n.ref, n.nd, n.nd + 3 * DAY);                       // a right notice: nothing to move
  const copyL = `copy public.notice_payment_ledger (ref, since, payment_id, paid_at, amount, matched_by) from stdin with (format csv, null '');\n`
    + ledger.map(l => [l.ref, iso(l.since), l.pay, iso(l.paid), l.amount, l.rid].join(',')).join('\n') + '\n\\.\n';
  // ---- the logs: three notices were changed by an earlier run and undone ----------------------------------------------------------------------------
  const ddl = name => { const m = FILE.match(new RegExp('create table if not exists public\\.' + name + ' \\([\\s\\S]*?\\n\\);')); if (!m) throw new Error('the file has no DDL for ' + name); return m[0] + '\n'; };
  const pre = ddl('notice_ledger_date_move_log') + ddl('demand_notice_date_repair_log')
    + `insert into public.demand_notice_date_repair_log (id, notice_old, notice_new, stamp_old, stamp_new) values ${notices.filter(n => n.inLog).map(n => `('${n.id}', '${iso(n.nd)}', '${iso(numDay(n.number))}', '${new Date(n.stampAt).toISOString()}', '${new Date(n.stampAt).toISOString()}')`).join(', ')};\n`;
  // ---- the deductions -----------------------------------------------------------------------------------------------------------------------
  const deds = []; let did = 0, cno = 0;
  const addD = (d, rows = 1) => { const cid = d.cid === undefined ? 'c' + String(++cno).padStart(6, '0') : d.cid; for (let k = 0; k < rows; k++) deds.push({ id: uuid('6', ++did), ...d, cid, kind: d.kind, inLog: !!d.inLog }); return cid; };
  const at = (sd, h = 7) => stampDay(sd, h);
  for (let i = 0; i < 40; i++) { const sd = U(2026, 1, 1) + Math.floor(rnd() * 280) * DAY; addD({ kind: 'ok', sd, at: at(sd), rd: sd - 9 * DAY, dc: sd - 3 * DAY }); }                  // in order
  for (let i = 0; i < 6; i++) { const sd = U(2026, 2 + i, 20); addD({ kind: 'eq', sd, at: at(sd), rd: sd - 5 * DAY, dc: sd - 5 * DAY }); }                                     // received and discovered the same day: in order
  for (let i = 0; i < 3; i++) addD({ kind: 'P1', sd: U(2026, 7, 20), at: at(U(2026, 7, 20)), rd: pick([U(2025, 3, 5), U(2026, 1, 9), U(2026, 3, 2)]), dc: swap(U(2026, 6, 12)) }, 2);   // late and fixable: two rows each
  addD({ kind: 'P1', sd: U(2026, 8, 25), at: at(U(2026, 8, 25)), rd: U(2026, 4, 4) + 0, dc: swap(U(2026, 7, 11)) }, 3);                                                       // rd equal to its exchange: no other reading
  addD({ kind: 'P8', sd: U(2026, 9, 14), at: at(U(2026, 9, 14)), rd: null, dc: swap(U(2026, 5, 10)) }, 2);                                                                    // no received date: fixed
  addD({ kind: 'P2', sd: U(2026, 7, 6), at: at(U(2026, 7, 6)), rd: U(2025, 3, 5), dc: swap(U(2026, 6, 12)) }, 2);                                                            // the submission day reads two ways: left alone
  addD({ kind: 'P3', sd: U(2026, 7, 20), at: at(U(2026, 7, 20)), rd: U(2026, 3, 10), dc: swap(U(2026, 6, 12)) }, 2);                                                        // the received date's other reading (Oct 3) is after the fixed discovery: left alone
  addD({ kind: 'P4', sd: U(2026, 7, 20), at: at(U(2026, 7, 20)), rd: U(2026, 5, 1), dc: U(2026, 8, 25) }, 2);                                                                // discovered later, no other reading
  addD({ kind: 'P5', sd: U(2026, 7, 20), at: at(U(2026, 7, 20)), rd: U(2026, 5, 1), dc: U(2026, 12, 11) }, 2);                                                               // the other reading (Nov 12) is after the submission
  addD({ kind: 'P6', sd: U(2026, 7, 20), at: at(U(2026, 7, 20)), rd: U(2026, 6, 20), dc: swap(U(2026, 6, 12)) }, 2);                                                         // received (Jun 20) after the fixed discovery (Jun 12)
  addD({ kind: 'P7', sd: U(2026, 7, 20), at: at(U(2026, 7, 20)), rd: U(2026, 5, 1), dc: U(2026, 12, 12) }, 2);                                                               // day equal to the month: no other reading
  for (let i = 0; i < 3; i++) addD({ kind: 'PL', sd: U(2026, 7, 21), at: at(U(2026, 7, 21)), rd: U(2026, 4, 2), dc: swap(U(2026, 6, 12)), inLog: true });                      // in the log already: never changed again
  addD({ kind: 'Pu', sd: U(2026, 7, 23), at: stampDay(U(2026, 7, 23), 0, 30), rd: U(2026, 5, 2), dc: U(2026, 7, 23) }, 2);                                                 // submitted at 21:30 UTC the day before = the 23rd in East Africa, discovered the 23rd: not late there, late by the UTC day
  addD({ kind: 'Pn', cid: null, sd: U(2026, 7, 24), at: at(U(2026, 7, 24)), rd: U(2026, 5, 2), dc: swap(U(2026, 6, 10)) }, 2);                                               // no case id
  for (let i = 0; i < 4; i++) addD({ kind: 'nodc', sd: U(2026, 9, 1 + i), at: at(U(2026, 9, 1 + i)), rd: U(2026, 8, 20), dc: null });
  for (let i = 0; i < 4; i++) addD({ kind: 'norc', sd: U(2026, 9, 5 + i), at: at(U(2026, 9, 5 + i)), rd: null, dc: U(2026, 9, 1) });
  // E: discovered before the money was received: the cases
  const cidE1 = addD({ kind: 'E1', sd: U(2026, 7, 6), at: at(U(2026, 7, 6)), rd: U(2026, 6, 5), dc: U(2026, 5, 6) }, 5);                                                          // every reading fits
  addD({ kind: 'E2', sd: U(2026, 7, 25), at: at(U(2026, 7, 25)), rd: U(2026, 6, 20), dc: U(2026, 5, 7) }, 2);                                                                // only the discovery's exchange fits
  addD({ kind: 'E3', sd: U(2026, 8, 25), at: at(U(2026, 8, 25)), rd: U(2026, 7, 5), dc: U(2026, 6, 20) }, 3);                                                                // only the received date's exchange fits
  addD({ kind: 'E4', sd: U(2026, 9, 25), at: at(U(2026, 9, 25)), rd: U(2026, 8, 25), dc: U(2026, 6, 20) }, 1);                                                                // none fits
  for (let i = 0; i < 5; i++) addD({ kind: 'E5', sd: U(2026, 1 + i, 28), at: at(U(2026, 1 + i, 28)), rd: U(2026, 1 + i, 20), dc: U(2026, 1 + i, 13) }, 1 + (i % 2));        // more cases than the answer lists
  addD({ kind: 'E6', sd: U(2026, 7, 6), at: at(U(2026, 7, 6)), rd: U(2026, 6, 5), dc: U(2026, 5, 7), cid: cidE1 }, 1);                                                          // one case id, another date triple: its own line
  const copyD = `copy public.pmo_deductions (id, case_id, submitted_at, received_date, discovery_date) from stdin with (format csv, null '');\n`
    + deds.map(d => [d.id, d.cid == null ? '' : d.cid, new Date(d.at).toISOString(), d.rd == null ? '' : iso(d.rd), d.dc == null ? '' : iso(d.dc)].join(',')).join('\n') + '\n\\.\n';
  const preD = ddl('pmo_deduction_date_repair_log')
    + `insert into public.pmo_deduction_date_repair_log (id, discovery_old, discovery_new) values ${deds.filter(d => d.inLog).map(d => `('${d.id}', '${iso(d.dc)}', '${iso(swap(d.dc))}')`).join(', ')};\n`;
  psql(copyN + copyL + pre + copyD + preD + 'analyze public.demand_notices; analyze public.notice_payment_ledger; analyze public.pmo_deductions;', TPL);
  // the tables made by the repair file itself exist already in the template (the earlier-run rows), with the same definitions the file gives

  // ---- the MODEL: the rule written again -------------------------------------------------------------------------------------------------------
  const guardRows = notices.filter(n => n.kind === 'I31' || n.kind === 'I13');                // numbers that are no day (a pattern that matches them but a day that does not exist)
  for (const n of notices) {
    n.idd = numDay(n.number); n.isw = swap(n.idd); n.cd = eat(n.stampAt); n.imp = n.ud != null;
    n.cand = n.imp && n.nd != null && n.nd > n.ud && !n.inLog;
    n.proved = n.cand && n.idd != null && n.idd <= n.ud && n.isw != null && (n.nd === n.isw || n.nd === n.isw - DAY);
    n.stampMoves = n.proved && n.cd > n.ud && (n.cd === n.isw || n.cd === n.isw - DAY);
    n.ndNew = n.proved ? n.idd : n.nd;
    n.stampNew = n.stampMoves ? n.idd + clockEat(n.stampAt) - 3 * 3600000 : n.stampAt;
  }
  const byRefProved = new Map();                                                       // the ledger: rows at (ref, since = the old date) follow the notice
  for (const n of notices.filter(x => x.proved)) { const k = n.ref + '|' + n.nd; if (!byRefProved.has(k)) byRefProved.set(k, n.idd); }
  const ledgerKeyNow = new Set(ledger.map(l => l.ref + '|' + l.since + '|' + l.pay));
  for (const l of ledger) {
    const to = byRefProved.get(l.ref + '|' + l.since);
    l.sinceNew = (to != null && !ledgerKeyNow.has(l.ref + '|' + to + '|' + l.pay)) ? to : l.since;
  }
  for (const d of deds) {
    d.sdd = eat(d.at); d.dsw = swap(d.dc); d.rsw = swap(d.rd); d.ssw = swap(d.sdd); d.cidk = d.cid == null ? d.id : d.cid;
    d.pl = d.dc != null && d.dc > d.sdd && !d.inLog;
    d.ok = d.pl && d.ssw == null && d.dsw != null && d.dsw <= d.sdd && (d.rd == null || (d.rd <= d.dsw && (d.rsw == null || d.rsw <= d.dsw)));
    d.dcNew = d.ok ? d.dsw : d.dc;
    d.early = d.dc != null && d.rd != null && d.rd > d.dc && !d.inLog;
  }
  const cnt = (a, f) => a.filter(f).length;
  const rest = notices.filter(n => n.imp && n.nd != null && n.idd != null && n.nd !== n.idd && !n.proved);
  const dayDiff = (a, b) => Math.round((a - b) / DAY);
  const expectLines = () => {
    const lines = new Map();
    const cand = notices.filter(n => n.cand), ok = notices.filter(n => n.proved), pl = deds.filter(d => d.pl), pok = deds.filter(d => d.ok);
    const stamps = cnt(ok, n => n.stampMoves), ledMoved = cnt(ledger, l => l.sinceNew !== l.since);
    lines.set(0, (cand.length + pl.length === 0) ? 'no imported notice is dated after the day it was uploaded and no deduction was discovered after it was submitted: nothing was changed'
      : `${fmt(ok.length)} notice date(s) put back to the day their number says (${fmt(stamps)} stamp(s) with them, ${fmt(ledMoved)} ledger row(s) moved); ${fmt(cand.length - ok.length)} notice(s) dated after their upload day left alone; ${fmt(pok.length)} deduction discovery date(s) put right; ${fmt(pl.length - pok.length)} discovered after the submission and left alone`);
    lines.set(1, `${fmt(cnt(notices, n => n.imp))} / ${fmt(cand.length)}`);
    lines.set(2, fmt(ok.length));
    lines.set(3, `${fmt(ok.length)} / ${fmt(cnt(notices, n => n.inLog))}`);
    lines.set(4, `${fmt(stamps)} / ${fmt(ledMoved)}`);
    lines.set(5, `${fmt(cnt(cand, c => !(c.idd != null && c.idd <= c.ud)))} / ${fmt(cnt(cand, c => c.idd != null && c.idd <= c.ud && !(c.isw != null && (c.nd === c.isw || c.nd === c.isw - DAY))))}`);
    lines.set(10, `${fmt(rest.length)} / ${fmt(cnt(rest, r => r.nd > r.ud))}`);
    lines.set(11, `${fmt(cnt(rest, r => r.nd - r.idd === -DAY))} / ${fmt(cnt(rest, r => r.nd - r.idd === DAY))} / ${fmt(cnt(rest, r => { const a = Math.abs(dayDiff(r.nd, r.idd)); return a >= 2 && a <= 7; }))} / ${fmt(cnt(rest, r => Math.abs(dayDiff(r.nd, r.idd)) > 7))}`);
    lines.set(12, `${fmt(cnt(rest, r => r.isw != null && r.nd === r.isw))} / ${fmt(cnt(rest, r => r.isw != null && r.nd === r.isw - DAY))} / ${fmt(cnt(rest, r => r.isw != null && r.nd === r.isw + DAY))} / ${fmt(cnt(rest, r => r.isw != null && ![r.isw, r.isw - DAY, r.isw + DAY].includes(r.nd)))} / ${fmt(cnt(rest, r => r.isw == null))}`);
    const hist = new Map(); for (const r of rest) { const k = dayDiff(r.nd, r.idd); hist.set(k, (hist.get(k) || 0) + 1); }
    const top = [...hist.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] - b[0])).slice(0, 8);
    lines.set(13, top.length ? top.map(([k, n]) => `${k}: ${n}`).join(', ') : 'none');
    lines.set(14, `${fmt(cnt(rest, r => r.cd === r.nd))} / ${fmt(cnt(rest, r => r.cd === r.idd && r.cd !== r.nd))} / ${fmt(cnt(rest, r => r.cd !== r.nd && r.cd !== r.idd))}`);
    const exN = rest.slice().sort((a, b) => (b.nd - a.nd) || (a.id < b.id ? -1 : 1)).slice(0, 8);
    exN.forEach((e, i) => lines.set(21 + i, `stored ${iso(e.nd)}, number says ${iso(e.idd)} (stored minus number: ${dayDiff(e.nd, e.idd)} days)` + (e.isw != null ? `, exchanged ${iso(e.isw)} (stored minus exchanged: ${dayDiff(e.nd, e.isw)})` : ', cannot be exchanged') + `, stamp ${iso(e.cd)}, uploaded ${iso(e.ud)}`));
    lines.set(40, `${fmt(deds.length)} / ${fmt(pl.length)} / ${fmt(pok.length)} / ${fmt(cnt(deds, d => d.inLog))}`);
    lines.set(41, fmt(pl.length - pok.length));
    const groups = new Map();
    for (const d of deds.filter(x => x.early)) { const k = [d.cidk, d.rd, d.dc, d.sdd].join('|'); if (!groups.has(k)) groups.set(k, { cid: d.cidk, rd: d.rd, dc: d.dc, sd: d.sdd, n: 0, dsw: d.dsw, rsw: d.rsw }); groups.get(k).n++; }
    const gl = [...groups.values()].sort((a, b) => (b.sd - a.sd) || (a.rd - b.rd) || (a.dc - b.dc) || (a.cid < b.cid ? -1 : 1));
    lines.set(42, `${fmt(gl.reduce((s, g) => s + g.n, 0))} / ${fmt(gl.length)}`);
    gl.slice(0, 6).forEach((g, i) => {
      const okD = g.dsw != null && g.dsw >= g.rd && g.dsw <= g.sd, okR = g.rsw != null && g.rsw <= g.dc && g.dc <= g.sd, okB = g.rsw != null && g.dsw != null && g.rsw <= g.dsw && g.dsw <= g.sd;
      lines.set(51 + i, `money received ${iso(g.rd)}, discovered ${iso(g.dc)}, submitted ${iso(g.sd)}; in order if ONLY the discovery is exchanged: ${okD ? 'yes (' + iso(g.dsw) + ')' : 'no'}; ONLY the received date: ${okR ? 'yes (' + iso(g.rsw) + ')' : 'no'}; BOTH: ${okB ? 'yes (' + iso(g.rsw) + ' / ' + iso(g.dsw) + ')' : 'no'}`);
    });
    return { lines, exN, gl };
  };
  const E = expectLines();
  // ---- running a file on a fresh copy of the template ----------------------------------------------------------------------------------------------
  const fresh = () => { drop(RUN); psql('create database ' + RUN + ' template ' + TPL, admin); };
  const dumpAll = () => psql(`select 'N' || md5(coalesce(string_agg(t::text, '|' order by id), '')) from public.demand_notices t;
    select 'L' || md5(coalesce(string_agg(t::text, '|' order by ref, since, payment_id), '')) from public.notice_payment_ledger t;
    select 'D' || md5(coalesce(string_agg(t::text, '|' order by id), '')) from public.pmo_deductions t;
    select 'n' || md5(coalesce(string_agg((t.id, t.notice_old, t.notice_new, t.stamp_old, t.stamp_new)::text, '|' order by t.id), '')) from public.demand_notice_date_repair_log t;
    select 'd' || md5(coalesce(string_agg((t.id, t.discovery_old, t.discovery_new)::text, '|' order by t.id), '')) from public.pmo_deduction_date_repair_log t;
    select 'm' || md5(coalesce(string_agg((t.ref, t.payment_id, t.since_old, t.since_new)::text, '|' order by t.ref, t.payment_id, t.since_new), '')) from public.notice_ledger_date_move_log t;`).trim().split('\n').join('|');
  const parse = out => out.trim() === '' ? [] : out.trim().split('\n').map(l => l.split(SEP));
  const runFile = file => parse(psql('begin;\n' + file + '\ncommit;\n'));
  const BEFORE_FRESH = (() => { fresh(); return dumpAll(); })();
  // run the file for real
  fresh();
  const t0 = Date.now(); const rows1 = runFile(FILE); const secs1 = (Date.now() - t0) / 1000;
  const after1 = dumpAll();
  // 1. every printed line equals the model's
  const printed = rows1.map(r => r[1]);
  const order = [0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, ...E.exN.map((_, i) => 21 + i), 40, 41, 42, ...E.gl.slice(0, 6).map((_, i) => 51 + i)];
  const want = order.map(k => E.lines.get(k));
  check('every line the file prints equals the model\'s, line by line (' + notices.length + ' notices, ' + deds.length + ' deductions, ' + want.length + ' lines)', JSON.stringify(printed) === JSON.stringify(want),
    (() => { for (let i = 0; i < Math.max(printed.length, want.length); i++) if (printed[i] !== want[i]) return 'line ' + i + ' (' + order[i] + '): got ' + JSON.stringify(printed[i]) + ' want ' + JSON.stringify(want[i]); return ''; })());
  check('the examples name the rows the model picks, in the model\'s order (the first eight characters of the id only)', JSON.stringify(rows1.filter(r => /e\.g\. notice/.test(r[0])).map(r => r[0].replace(/^\s+e\.g\. notice /, ''))) === JSON.stringify(E.exN.map(n => n.id.slice(0, 8))));
  check('no printed line holds a notice number, a name or an amount', !rows1.some(r => /HMCL\//.test(r[0] + r[1])) && rows1.every(r => r[0].length < 200));
  // 2. every row of every table equals the model
  const got = psql(`select id, notice_date, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') from public.demand_notices order by id`);
  const gotN = new Map(parse(got).map(r => [r[0], r.slice(1)]));
  const badN = notices.filter(n => { const g = gotN.get(n.id); return !g || g[0] !== (n.ndNew == null ? '' : iso(n.ndNew)) || g[1] !== new Date(n.stampNew).toISOString().slice(0, 19); });
  check('EVERY notice (date and stamp) is what the model says after the run (' + notices.length + ' rows; ' + cnt(notices, n => n.proved) + ' dates changed, ' + cnt(notices, n => n.stampMoves) + ' stamps moved)', badN.length === 0,
    badN.slice(0, 3).map(n => n.kind + ' ' + n.id.slice(0, 8) + ' got ' + JSON.stringify(gotN.get(n.id)) + ' want ' + iso(n.ndNew) + ' ' + new Date(n.stampNew).toISOString().slice(0, 19)).join(' | '));
  const gotL = new Map(parse(psql(`select matched_by, since from public.notice_payment_ledger`)).map(r => [r[0], r[1]]));
  const badL = ledger.filter(l => gotL.get(l.rid) !== iso(l.sinceNew));
  check('EVERY ledger row follows its notice, and a row that would meet the same payment already at the new date stays (' + ledger.length + ' rows; ' + cnt(ledger, l => l.sinceNew !== l.since) + ' moved)', badL.length === 0 && gotL.size === ledger.length, badL.slice(0, 2).map(l => l.ref + ' want ' + iso(l.sinceNew) + ' got ' + gotL.get(l.rid)).join(' | '));
  const gotM = parse(psql(`select ref, payment_id, since_old, since_new from public.notice_ledger_date_move_log order by ref, payment_id, since_new`));
  const wantM = ledger.filter(l => l.sinceNew !== l.since).map(l => [l.ref, l.pay, iso(l.since), iso(l.sinceNew)]).sort((a, b) => (a[0] + a[1] + a[3] < b[0] + b[1] + b[3] ? -1 : 1));
  check('the move log holds exactly the ledger rows that were moved (' + gotM.length + '), with where each one was and is', JSON.stringify(gotM) === JSON.stringify(wantM));
  const gotD = new Map(parse(psql(`select id, discovery_date, received_date, submitted_at from public.pmo_deductions`)).map(r => [r[0], r[1]]));
  const badD = deds.filter(d => gotD.get(d.id) !== (d.dcNew == null ? '' : iso(d.dcNew)));
  check('EVERY deduction\'s discovery date is what the model says (' + deds.length + ' rows; ' + cnt(deds, d => d.ok) + ' put right)', badD.length === 0, badD.slice(0, 3).map(d => d.kind + ' got ' + gotD.get(d.id) + ' want ' + iso(d.dcNew)).join(' | '));
  const gotLogN = parse(psql('select id, notice_old, notice_new, to_char(stamp_old at time zone \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS\'), to_char(stamp_new at time zone \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS\') from public.demand_notice_date_repair_log order by id'));
  const wantLogN = notices.filter(n => n.proved).map(n => [n.id, iso(n.nd), iso(n.idd), new Date(n.stampAt).toISOString().slice(0, 19), new Date(n.stampNew).toISOString().slice(0, 19)]).concat(notices.filter(n => n.inLog).map(n => [n.id, iso(n.nd), iso(n.idd), new Date(n.stampAt).toISOString().slice(0, 19), new Date(n.stampAt).toISOString().slice(0, 19)])).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  check('the notice log holds exactly the rows changed (old and new date, old and new stamp) and the rows an earlier run left (' + gotLogN.length + ')', JSON.stringify(gotLogN) === JSON.stringify(wantLogN));
  const gotLogD = parse(psql('select id, discovery_old, discovery_new from public.pmo_deduction_date_repair_log order by id'));
  const wantLogD = deds.filter(d => d.ok).map(d => [d.id, iso(d.dc), iso(d.dsw)]).concat(deds.filter(d => d.inLog).map(d => [d.id, iso(d.dc), iso(d.dsw)])).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  check('the deduction log holds exactly the rows changed and the rows an earlier run left (' + gotLogD.length + ')', JSON.stringify(gotLogD) === JSON.stringify(wantLogD));
  // 3. what the fixture holds: every kind of row a break needs, counted
  const kinds = k => cnt(notices, n => n.kind === k);
  check('the fixture holds every kind of row a break needs: proved ' + cnt(notices, n => n.proved) + ' (real 12ths ' + kinds('C') + ', real 11ths ' + kinds('D') + ', plain exchange ' + kinds('E') + ', second upload day ' + cnt(notices, n => n.kind === 'N' && n.proved) + '), before the upload day ' + kinds('F') + ', other relations ' + (kinds('G+3') + kinds('G-2') + kinds('G+1') + kinds('G60')) + ', no usable number ' + kinds('I') + ', in the log ' + kinds('L')
    + '; stamps moved ' + cnt(notices, n => n.stampMoves) + ', stamps with a relation but not after the upload day ' + cnt(notices, n => n.proved && !n.stampMoves && (n.cd === n.isw || n.cd === n.isw - DAY)) + '; ledger rows moved ' + cnt(ledger, l => l.sinceNew !== l.since) + ' and stayed on a collision ' + cnt(ledger, l => l.sinceNew === l.since && byRefProved.has(l.ref + '|' + l.since)) + '; deductions put right ' + cnt(deds, d => d.ok) + ', not put right though late ' + cnt(deds, d => d.pl && !d.ok) + ', early cases ' + E.gl.length,
  kinds('near') >= 10 && kinds('C') >= 30 && kinds('D') >= 15 && kinds('E') >= 9 && cnt(notices, n => n.kind === 'N' && n.proved) >= 3 && cnt(notices, n => n.kind === 'N' && !n.proved) >= 3 && kinds('F') >= 10 && kinds('I') >= 10 && kinds('L') >= 3
    && cnt(notices, n => n.stampMoves) >= 20 && cnt(notices, n => n.proved && !n.stampMoves && (n.cd === n.isw || n.cd === n.isw - DAY)) >= 1 && cnt(ledger, l => l.sinceNew !== l.since) >= 20 && cnt(ledger, l => l.sinceNew === l.since && byRefProved.has(l.ref + '|' + l.since)) >= 3
    && cnt(deds, d => d.ok) >= 8 && ['P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'PL'].every(k => cnt(deds, d => d.kind === k && d.pl && !d.ok) + cnt(deds, d => d.kind === k && d.inLog) >= 2) && E.gl.length >= 8 && E.gl.slice(0, 6).length === 6
    && cnt(deds, d => d.kind === 'eq') >= 6 && deds.some(d => d.cid == null) && cnt(deds, d => d.kind === 'E6') >= 1
    && E.gl.some(g => g.dsw != null && g.dsw >= g.rd && g.dsw <= g.sd && g.rsw != null && g.rsw <= g.dc) && E.gl.some(g => g.dsw != null && g.dsw >= g.rd && g.rsw == null) && E.gl.some(g => g.rsw != null && g.rsw <= g.dc && g.dsw == null) && E.gl.some(g => g.dsw == null && g.rsw == null));
  // 4. a second run changes nothing, and says so; the answer after the first run is the same file's own
  const rows2 = runFile(FILE);
  const after2 = dumpAll();
  check('a second run changes nothing (every table and both logs byte-identical) and puts nothing right', after2 === after1 && /^0 notice date\(s\) put back/.test(rows2[0][1]) && / 0 deduction discovery date\(s\) put right;/.test(rows2[0][1]), rows2[0][1]);
  // 5. the undo at the foot: every table back byte for byte; and a run after the undo changes nothing (the logs keep their rows)
  const undo = FILE.split('\n').filter(l => /^-- (update|-- update)/.test(l)).map(l => l.replace(/^-- /, '')).join('\n');
  check('the undo at the foot is three statements (ledger, notices, deductions) that run', (undo.match(/\bupdate\b/g) || []).length === 3, undo.slice(0, 80));
  const beforeTables = BEFORE_FRESH.split('|').slice(0, 3).join('|');
  psql('begin;\n' + undo + '\ncommit;');
  const afterUndo = dumpAll();
  check('the undo puts every notice, ledger row and deduction back byte for byte', afterUndo.split('|').slice(0, 3).join('|') === beforeTables, 'before ' + beforeTables + ' after-undo ' + afterUndo.split('|').slice(0, 3).join('|'));
  const logsKept = afterUndo.split('|').slice(3).join('|') === after1.split('|').slice(3).join('|');
  const rows3 = runFile(FILE);
  check('the logs keep their rows through the undo, and a run after it changes no row (a row undone stays undone)', logsKept && dumpAll() === afterUndo && /^0 notice date\(s\) put back/.test(rows3[0][1]));
  // 6. a book without the ledger is refused with nothing changed; an empty book answers; a clean book says nothing was changed
  fresh(); psql('drop table public.notice_payment_ledger cascade; drop table public.demand_notice_date_repair_log; drop table public.pmo_deduction_date_repair_log;');
  let refused = ''; try { runFile(FILE); } catch (err) { refused = err.psql || err.message; }
  check('a book without the ledger is refused with its own words, and nothing is made or changed', /Run db\/RUN-ME-041a first/.test(refused) && psql(`select to_regclass('public.demand_notice_date_repair_log') is null`).trim() === 't');
  fresh(); psql('begin;\ndelete from public.demand_notices;\ndelete from public.notice_payment_ledger;\ndelete from public.pmo_deductions;\ndelete from public.demand_notice_date_repair_log;\ndelete from public.pmo_deduction_date_repair_log;\ncommit;');
  const empty = runFile(FILE);
  check('an empty book answers "nothing was changed" and counts zero everywhere', /^no imported notice is dated after/.test(empty[0][1]) && empty.find(r => r[0].startsWith('imported notices (upload date set)'))[1] === '0 / 0' && empty.find(r => r[0].startsWith('PMO deductions'))[1].startsWith('0 / 0 / 0'));
  fresh(); psql(`begin;\ndelete from public.demand_notices;\ndelete from public.pmo_deductions;\ninsert into public.demand_notices (ref, notice_id, notice_date, created_at, upload_date) values ('R1', 'HMCL/AB/12/09/2026', date '2026-09-12', timestamptz '2026-09-12 09:00+03', date '2026-10-12');\ncommit;`);
  const clean = runFile(FILE);
  check('a clean book (one right imported notice) says nothing was changed, and still describes nothing as left over', /^no imported notice is dated after/.test(clean[0][1]) && clean.find(r => r[0].startsWith('imported notices whose date still'))[1] === '0 / 0');

  // ---- a book of live size and a hundred times that: the timing the owner will see ------------------------------------------------------------------
  fresh();
  psql(`begin; delete from public.demand_notices; delete from public.notice_payment_ledger; delete from public.pmo_deductions; delete from public.demand_notice_date_repair_log; delete from public.pmo_deduction_date_repair_log; commit;`);
  psql(`insert into public.demand_notices (ref, notice_id, notice_date, created_at, upload_date)
        select 'R' || g, 'HMCL/AB/' || lpad((1 + g % 28)::text, 2, '0') || '/' || lpad((1 + g % 12)::text, 2, '0') || '/2026-' || g,
               make_date(2026, 1 + (g * 7) % 9, 1 + g % 28), now() - (g % 300) * interval '1 day', case when g % 3 = 0 then date '2026-10-12' end
        from generate_series(1, 95000) g;
        insert into public.demand_notices (ref, notice_id, notice_date, created_at, upload_date)       -- 5,000 of the shape of the live twelve: a real 12th, stored exchanged and a day early, imported
        select 'S' || g, 'HMCL/AB/12/' || lpad((2 + g % 9)::text, 2, '0') || '/2026-' || g, make_date(2026, 12, 1 + g % 9), make_date(2026, 12, 1 + g % 9)::timestamptz + interval '9 hours', date '2026-10-12'
        from generate_series(1, 5000) g;
        insert into public.notice_payment_ledger (ref, since, payment_id, paid_at, amount)
        select 'S' || g, make_date(2026, 12, 1 + g % 9), gen_random_uuid(), date '2026-12-20', 1000 from generate_series(1, 5000) g, generate_series(1, 3) k;
        insert into public.notice_payment_ledger (ref, since, payment_id, paid_at, amount)
        select 'R' || g, make_date(2026, 1 + (g * 7) % 9, 1 + g % 28), gen_random_uuid(), date '2026-12-20', 1000 from generate_series(1, 25000) g;
        insert into public.pmo_deductions (case_id, submitted_at, received_date, discovery_date)
        select 'c' || g, now() - (g % 300) * interval '1 day', current_date - 400, case when g % 10 = 0 then make_date(2027, 1 + g % 12, 7) else current_date - 1 - (g % 25) end from generate_series(1, 10000) g;
        analyze public.demand_notices; analyze public.notice_payment_ledger; analyze public.pmo_deductions;`);
  const t1 = Date.now(); const big = runFile(FILE); const secsBig = (Date.now() - t1) / 1000;
  check('a book of 100,000 notices (5,000 of them to repair), 10,000 deductions and a ledger of 40,000 rows (a hundred times the live one) is repaired in ' + secsBig.toFixed(2) + ' s, under the 30-second ceiling', big.length > 8 && secsBig < 20, big[0] && big[0][1].slice(0, 90));

  // ---- broken on purpose: each break must change the outcome (every table, both logs and every printed line), or fail on the row its guard is for ----------------------------
  const sigOf = file => { fresh(); const rows = runFile(file); return JSON.stringify([rows, dumpAll()]); };
  const baseSig = (() => { return sigOf(FILE); })();
  const sub = (src, re, to, what) => { const n = (src.match(new RegExp(re.source, 'g')) || []).length; if (n !== 1) throw new Error('the file has ' + n + ' of "' + what + '", the check needs exactly one'); return src.replace(re, () => to); };
  const rep = (re, to) => src => sub(src, re, to, String(re));
  const breaks = [
    // the notices' proof
    ['a notice need not be dated after its upload day',                                       rep(/where w\.ud is not null and w\.nd is not null and w\.nd > w\.ud and not w\.was_fixed/, 'where w.ud is not null and w.nd is not null and not w.was_fixed')],
    ['a notice dated after the day of the FIRST upload is enough (the row\'s own upload day is not read)', rep(/w\.nd > w\.ud and not w\.was_fixed/, "w.nd > date '2026-10-12' and not w.was_fixed")],
    ['the number\'s day may be later than the upload day',                                    rep(/where c\.idd is not null and c\.idd <= c\.ud and c\.isw is not null/, 'where c.idd is not null and c.isw is not null')],
    ['the number\'s day must be BEFORE the upload day (the upload day itself is refused)',     rep(/c\.idd <= c\.ud and c\.isw is not null/, 'c.idd < c.ud and c.isw is not null')],
    ['the stored date may be the exchange only (a day early is not enough)',                  rep(/c\.nd in \(c\.isw, c\.isw - 1\)\n/, 'c.nd = c.isw\n')],
    ['the stored date may be the exchange a day early only',                                  rep(/c\.nd in \(c\.isw, c\.isw - 1\)\n/, 'c.nd = c.isw - 1\n')],
    ['the stored date may also be the exchange a day LATE',                                   rep(/c\.nd in \(c\.isw, c\.isw - 1\)\n/, 'c.nd in (c.isw, c.isw - 1, c.isw + 1)\n')],
    ['imported is read from the wrong side',                                                  rep(/where w\.ud is not null and w\.nd is not null and w\.nd > w\.ud/, 'where w.ud is null and w.nd is not null and w.nd > w.ud')],
    ['a row an earlier run changed (or undid) is changed again',                              rep(/w\.nd > w\.ud and not w\.was_fixed/, 'w.nd > w.ud')],
    ['a number in lower case is a number',                                                    rep(/\(\?:-\\d\+\)\?\$'\) as p/, "(?:-\\d+)?$', 'i') as p")],
    ['a repeat number (-2) is not a number',                                                  rep(/\(\\d\{4\}\)\(\?:-\\d\+\)\?\$/, '(\\d{4})$')],
    ['the number\'s pattern need not start at the start',                                     rep(/'\^HMCL\//, "'HMCL/")],
    ['the day of a number may be any of 1 to 31 (a number typed 31/04: the file fails on it)', rep(/between 1 and extract\(day from \(make_date\(\(m\.p\)\[3\]::int, \(m\.p\)\[2\]::int, 1\) \+ interval '1 month' - interval '1 day'\)\)::int/, 'between 1 and 31'), true],
    ['the month of a number may be any (a number typed with month 13: the file fails on it)', rep(/\(m\.p\)\[2\]::int between 1 and 12 and /, ''), true],
    ['the day and month are not exchanged',                                                   rep(/make_date\(extract\(year from v\.idd\)::int, extract\(day from v\.idd\)::int, extract\(month from v\.idd\)::int\)/, 'v.idd')],
    ['a day of twelve is not exchanged',                                                      rep(/extract\(day from v\.idd\) <= 12 and/, 'extract(day from v.idd) <= 11 and')],
    // the stamp
    ['the stamp\'s day is the UTC day, not the East Africa day',                              rep(/v\.cl::date as cd,/, "(v.ca at time zone 'UTC')::date as cd,")],
    ['the stamp moves whatever its day is',                                                   rep(/case when c\.cd > c\.ud and c\.cd in \(c\.isw, c\.isw - 1\)/, 'case when true')],
    ['the stamp moves although it is not after the upload day',                               rep(/case when c\.cd > c\.ud and c\.cd in/, 'case when c.cd in')],
    ['the stamp moves only when it is the very day the notice date was (the mirror)',         rep(/case when c\.cd > c\.ud and c\.cd in \(c\.isw, c\.isw - 1\)/, 'case when c.cd > c.ud and c.cd = c.nd')],
    ['the stamp keeps no clock: it moves to noon',                                            rep(/\(\(c\.idd \+ c\.cl::time\) at time zone 'Africa\/Dar_es_Salaam'\)/, "((c.idd + time '12:00') at time zone 'Africa/Dar_es_Salaam')")],
    ['the new stamp is read as UTC, not East Africa time',                                    rep(/\(\(c\.idd \+ c\.cl::time\) at time zone 'Africa\/Dar_es_Salaam'\)/, "((c.idd + c.cl::time) at time zone 'UTC')")],
    // the ledger
    ['the ledger is not moved with the date',                                                 rep(/update public\.notice_payment_ledger l set since = o\.idd/, 'update public.notice_payment_ledger l set since = l.since')],
    ['every ledger row of the customer moves, not only the ones at the notice\'s old date',    rep(/where l\.ref = o\.ref and l\.since = o\.nd\n/, 'where l.ref = o.ref\n')],
    ['a ledger row that meets one already at the new date is moved anyway (the file fails on the collision)', rep(/\n     and not exists \(select 1 from public\.notice_payment_ledger x where x\.ref = l\.ref and x\.since = o\.idd and x\.payment_id = l\.payment_id\)/, ''), true],
    // the logs and the guards
    ['the notice log is not written',                                                         rep(/select o\.id, o\.nd, o\.idd, o\.ca, o\.ca_new from ok o/, 'select o.id, o.nd, o.idd, o.ca, o.ca_new from ok o where false')],
    ['the new stamp is not logged',                                                           rep(/select o\.id, o\.nd, o\.idd, o\.ca, o\.ca_new from ok o/, 'select o.id, o.nd, o.idd, o.ca, o.ca from ok o')],
    // the deductions
    ['a deduction submitted on a day that reads two ways is changed anyway',                  rep(/where pl\.ssw is null and pl\.dsw is not null/, 'where pl.dsw is not null')],
    ['the exchange of the discovery may be after the submission',                             rep(/ and pl\.dsw <= pl\.sd\n/, '\n')],
    ['the exchange may be before the money was received',                                     rep(/\(pl\.rd is null or \(pl\.rd <= pl\.dsw and \(pl\.rsw is null or pl\.rsw <= pl\.dsw\)\)\)/, 'true')],
    ['the received date\'s OTHER reading is not asked',                                       rep(/\(pl\.rsw is null or pl\.rsw <= pl\.dsw\)/, 'true')],
    ['a deduction with no received date is not changed',                                      rep(/\(pl\.rd is null or \(pl\.rd <= pl\.dsw/, '(pl.rd is not null and (pl.rd <= pl.dsw')],
    ['a deduction with no other reading of its discovery is changed (to nothing)',            rep(/where pl\.ssw is null and pl\.dsw is not null and pl\.dsw <= pl\.sd/, 'where pl.ssw is null and pl.dsw is null')],
    ['a deduction an earlier run changed is changed again',                                   rep(/where pe\.dc is not null and pe\.dc > pe\.sd and not pe\.was_fixed/, 'where pe.dc is not null and pe.dc > pe.sd')],
    ['the deduction log is not written',                                                      rep(/select o\.id, o\.dc, o\.dsw from pok o/, 'select o.id, o.dc, o.dsw from pok o where false')],
    ['the submission day is the UTC day',                                                     rep(/\(p\.submitted_at at time zone 'Africa\/Dar_es_Salaam'\)::date as sd/, "(p.submitted_at at time zone 'UTC')::date as sd")],
    ['a deduction received the day it was discovered counts as discovered before',            rep(/pe\.rd is not null and pe\.rd > pe\.dc and not pe\.was_fixed\n/, 'pe.rd is not null and pe.rd >= pe.dc and not pe.was_fixed\n')],
    // the report
    ['the examples are the earliest dates first',                                             rep(/over \(order by r\.nd desc, r\.id\)/, 'over (order by r.nd asc, r.id)')],
    ['five examples, not eight',                                                              rep(/from ex e where e\.rn <= 8/, 'from ex e where e.rn <= 5')],
    ['four cases of deductions, not six',                                                     rep(/from pbn b where b\.rn <= 6/, 'from pbn b where b.rn <= 4')],
    ['one day early and one day late are counted alike',                                      rep(/to_char\(\(select count\(\*\) from rest where nd - idd = -1\), 'FM999,999,999'\)/, "to_char((select count(*) from rest where abs(nd - idd) = 1), 'FM999,999,999')")],
    ['"within a week" stops at six days',                                                     rep(/abs\(nd - idd\) between 2 and 7/, 'abs(nd - idd) between 2 and 6')],
    ['"further" starts at seven days',                                                        rep(/abs\(nd - idd\) > 7\)/, 'abs(nd - idd) >= 7)')],
    ['the most common differences list three, not eight',                                     rep(/t\.rk <= 8/, 't.rk <= 3')],
    ['what is left over is only the dates BEFORE the number\'s day',                         rep(/and w\.nd <> w\.idd\n/, 'and w.nd < w.idd\n')],
    ['what is left over counts the rows this run changed too',                                rep(/    and not exists \(select 1 from ok where ok\.id = w\.id\)\n/, '\n')],
    ['the answer says "nothing was changed" whatever was found',                              rep(/when \(select count\(\*\) from cand\) \+ \(select count\(\*\) from pl\) = 0\n/, 'when true\n')],
  ];
  let notCaught = 0;
  const equivalent = [];
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
  drop(TPL); drop(RUN);
}
process.exit(exitCode);
