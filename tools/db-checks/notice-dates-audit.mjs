/* THE DATES ON THE DEMAND NOTICES AND THE PMO DEDUCTIONS, AGAINST WHAT EACH ONE SAYS OF ITSELF -- db/RUN-ME-067, run for real on a PostgreSQL.

     "Repair everything that's wrong brother I can't be perfect to detect every where dates are wrong" -- the owner, 17 Nov 2026
     (the scan of RUN-ME-064 flagged demand_notices.notice_date / created_at and pmo_deductions.discovery_date: dates later than today)

   db/RUN-ME-067-notice-and-deduction-dates-read-only.sql changes nothing. It reads a notice's date against the day its own number carries (HMCL/<initials>/<dd>/<mm>/<yyyy>) and a
   deduction's discovery date against the order money received -> discovered -> case submitted. Its answer decides whether anything is repaired, and what, so it is not believed on a reading.

   THE BOOK IS THE REAL ONE: the whole of db/schema.sql in a scratch database, then the real migrations that add notice_id, upload_date and upload_batch to demand_notices (the live book has
   them; the schema file does not), so every column has the type the book's own migration gave it. The fixture knows the truth: notices made in the app and imported, right, swapped and
   neither, numbers of every shape (with a suffix, lower case, a day that does not exist, a month 13, a year of 1999, no number at all), stamps on the same day, near, exchanged and far,
   one written at 21:30 UTC (the next day in East Africa), dates later than today, today, and a day and month the same; deductions in order, discovered after the submission, received
   after the discovery, fixable by the exchange and not, a date equal to its neighbour, nothing filled in.

   It passes only when: EVERY line the file prints equals what a MODEL written again in JavaScript says, line by line, examples and their order included; the two tables are
   byte-identical afterwards (nothing was written); a book of a hundred thousand notices answers in seconds; and EVERY ONE of a list of deliberate breaks of the file (the
   East Africa day made UTC, the pattern loosened or tightened, a bound moved, the exchange not made, the examples reordered, the answer's test inverted) changes the answer -- or, for the
   two guards that stop a typed number from being a day that does not exist, makes the file fail on that very row, which is what the guard is there to prevent.

       PGHOST=/var/run/postgresql PGUSER=postgres PGDATABASE=postgres node tools/db-checks/notice-dates-audit.mjs

   It makes, uses and drops its own scratch database. NEVER point it at the live book. Exit code 0 = the file read what it says, and failed when broken. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = fs.readFileSync(path.join(ROOT, 'db/RUN-ME-067-notice-and-deduction-dates-read-only.sql'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8');
const MIG_ID = fs.readFileSync(path.join(ROOT, 'db/migrations/2026-07-26-demand-notice-id.sql'), 'utf8');
const MIG_STAMP = fs.readFileSync(path.join(ROOT, 'db/migrations/2026-07-28-upload-stamp.sql'), 'utf8');
const SEP = '\x1f', DAY = 86400000, DB = 'hope_nd_check';
const psql = (sql, db = DB) => {
  try { return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-F', SEP, '-d', db, '-f', '-'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { const err = new Error('psql failed: ' + String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 3).join(' | ')); err.psql = String(e.stderr || ''); throw err; }
};
let seed = 20261117;                                               // mulberry32
const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const iso = t => (t == null ? '' : new Date(t).toISOString().slice(0, 10));
const p2 = n => String(n).padStart(2, '0');
const uuid = n => '5' + n.toString(16).padStart(7, '0') + '-0000-4000-8000-000000000000';
const fmt = n => n.toLocaleString('en-US');
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const swap = t => { if (t == null) return null; const d = new Date(t), m = d.getUTCMonth() + 1, dd = d.getUTCDate(); return (dd <= 12 && m !== dd) ? Date.UTC(d.getUTCFullYear(), dd - 1, m) : null; };   // null when there is no other reading

const admin = process.env.PGDATABASE || 'postgres';
try { psql('drop database if exists ' + DB, admin); } catch { /* none */ }
psql('create database ' + DB, admin);
const fails = [];
const check = (name, ok, extra) => { if (!ok) fails.push(name + (extra ? ' -- ' + extra : '')); console.log((ok ? 'ok    ' : 'FAIL  ') + name + (ok || !extra ? '' : ' -- ' + extra)); };
let exitCode = 1;
try {
  psql(SCHEMA);
  psql(MIG_ID); psql(MIG_STAMP);
  const TODAY = (() => { const [y, m, d] = psql("select (now() at time zone 'Africa/Dar_es_Salaam')::date").trim().split('-').map(Number); return Date.UTC(y, m - 1, d); })();
  const rel = k => TODAY + k * DAY;                                 // a day relative to today (East Africa)
  // ---- the notices ----------------------------------------------------------------------------------------------------------------------
  const PAT_NUM = /^HMCL\/[^/]+\/\d{2}\/\d{2}\/\d{4}(?:-\d+)?$/;
  const notices = []; let nid = 0;
  const num = (d, suffix = '', init = pick(['AB', 'MJ', 'XY', 'KA'])) => { const x = new Date(d); return `HMCL/${init}/${p2(x.getUTCDate())}/${p2(x.getUTCMonth() + 1)}/${x.getUTCFullYear()}${suffix}`; };
  const used = new Set();                                            // the book keeps a number unique (idx_demand_notice_id): a repeat for the same person and day takes -2, -3 ...
  const add = (n) => {
    if (n.number != null && PAT_NUM.test(n.number)) { const base = n.number.replace(/-\d+$/, ''); let c = n.number, k = 2; while (used.has(c)) c = base + '-' + (k++); n.number = c; }
    if (n.number != null) used.add(n.number);
    notices.push({ id: uuid(++nid), imp: false, stamp: null, ...n });
  };
  const realDay = () => rel(-Math.floor(rnd() * 300));                 // an issue day in the last ten months
  for (let i = 0; i < 80; i++) { const d = realDay(); add({ imp: false, nd: d, number: num(d), stampAt: d + 9 * 3600000 - 3 * 3600000 }); }                       // made in the app: right
  for (let i = 0; i < 120; i++) { const d = realDay(); add({ imp: true, nd: d, number: num(d, pick(['', '', '-2', '-12'])), stampAt: d + 6 * 3600000 }); }           // imported, right (some with a suffix)
  for (let i = 0; i < 150; i++) {                                                                                                                                      // imported, swapped: the date the old reader stored
    const d = realDay(), sw = swap(d); if (sw == null || sw > TODAY) { i--; continue; }       // the ones that land later than today are made below, a few, on purpose
    add({ imp: true, nd: sw, number: num(d), stampAt: pick([d + 6 * 3600000, d + 3 * DAY, sw + 6 * 3600000, d + 20 * DAY]) });
  }
  for (let i = 0; i < 20; i++) { const d = realDay(); add({ imp: true, nd: d + pick([-40, -9, -15, -61]) * DAY, number: num(d), stampAt: d + 6 * 3600000 }); }                // neither
  for (let i = 0; i < 12; i++) { const d = Date.UTC(2026, 4, 5); add({ imp: i % 2 === 0, nd: d, number: num(d), stampAt: d + 6 * 3600000 }); }                          // day and month the same (05/05)
  // a swapped date that lands LATER THAN TODAY: the real day is a 12th of a month before today's, stored as the 12th month
  for (let i = 0; i < 5; i++) { const d = Date.UTC(new Date(TODAY).getUTCFullYear(), [0, 1, 2, 3, 4][i], 12); const sw = swap(d); add({ imp: true, nd: sw, number: num(d), stampAt: d + 6 * 3600000 }); }
  add({ imp: true, nd: rel(0), number: num(rel(0)), stampAt: rel(0) + 6 * 3600000 });                                                                                  // dated today
  add({ imp: true, nd: rel(1), number: num(rel(1)), stampAt: rel(1) + 6 * 3600000 });                                                                                  // dated tomorrow
  const odd = ['ABC123', '', null, 'HMCL/AB/xx/yy/zzzz', 'hmcl/ab/12/09/2026', 'HMCL/AB/31/04/2026', 'HMCL/AB/30/02/2026', 'HMCL/AB/29/02/2025', 'HMCL/AB/29/02/2024', 'HMCL/AB/00/05/2026', 'HMCL/AB/05/13/2026',
    'HMCL/AB/05/06/1999', 'HMCL/AB/05/06/2101', 'HMCL/AB/05/06/26', 'HMCL/AB/5/6/2026', 'HMCL//05/06/2026', 'HMCL/AB/05/06/2026-', 'HMCL/AB/05/06/2026-x', 'XHMCL/AB/05/06/2026', 'HMCL/AB/05/06/2026 ', 'HMCL/A/B/05/06/2026'];
  for (const o of odd) add({ imp: true, nd: rel(-30), number: o, stampAt: rel(-30) + 6 * 3600000 });
  for (let i = 0; i < 6; i++) add({ imp: i % 2 === 0, nd: null, number: num(rel(-20 - i)), stampAt: rel(-20 - i) + 6 * 3600000 });                                           // no notice date
  // the stamp's day is the day in EAST AFRICA: 21:30 UTC is already the next day there
  for (let i = 0; i < 6; i++) { const d = rel(-50 - i); add({ imp: true, nd: d, number: num(d), stampAt: d - 3 * 3600000 + 30 * 60000 }); }                                  // 21:30 UTC the day before = the number's day, EAT
  for (let i = 0; i < 6; i++) { const d = rel(-70 - i); add({ imp: true, nd: d, number: num(d), stampAt: d + 5 * DAY + 5 * 3600000 }); }                                      // five days later: near
  for (let i = 0; i < 6; i++) { const d = rel(-90 - i); add({ imp: true, nd: d, number: num(d), stampAt: d + 8 * DAY + 5 * 3600000 }); }                                      // eight days later: other
  const COPY_N = `copy public.demand_notices (id, ref, notice_id, notice_date, created_at, upload_date) from stdin with (format csv, null '');\n`
    + notices.map(n => [n.id, 'R' + n.id.slice(1, 8), n.number == null ? '' : '"' + String(n.number).replace(/"/g, '""') + '"', n.nd == null ? '' : iso(n.nd), new Date(n.stampAt).toISOString(), n.imp ? '2026-10-12' : ''].join(',')).join('\n') + '\n\\.\n';
  // ---- the deductions -------------------------------------------------------------------------------------------------------------------
  const deds = []; let did = 0;
  const addD = d => deds.push({ id: uuid(100000 + ++did), ...d });
  for (let i = 0; i < 40; i++) { const sd = rel(-Math.floor(rnd() * 200) - 1); addD({ sd, at: sd + 7 * 3600000, rd: sd - 9 * DAY, dc: sd - 3 * DAY }); }                          // in order
  for (let i = 0; i < 12; i++) { const sd = Date.UTC(2026, pick([4, 5, 6, 7]), 12 + (i % 2) * 0, 0), dc = swap(sd); const s2 = sd + 1 * DAY; addD({ sd: s2, at: s2 + 7 * 3600000, rd: sd - 20 * DAY, dc: dc == null ? sd : dc }); }  // discovered "after": a swapped date
  for (let i = 0; i < 8; i++) { const real = Date.UTC(2026, pick([5, 6, 7, 8]), 3 + i); const sw = swap(real); const sd = real + 2 * DAY; addD({ sd, at: sd + 7 * 3600000, rd: real - 10 * DAY, dc: sw }); }  // swapped: discovered in a later month
  for (let i = 0; i < 6; i++) { const sd = rel(-60 - i); addD({ sd, at: sd + 7 * 3600000, rd: sd - 2 * DAY, dc: sd + 40 * DAY }); }                                                  // after the submission, not fixable by the exchange
  for (let i = 0; i < 6; i++) { const sd = rel(-100 - i); addD({ sd, at: sd + 7 * 3600000, rd: sd - 1 * DAY, dc: sd - 6 * DAY }); }                                                // received after discovery (not swapped-looking)
  for (let i = 0; i < 4; i++) { const sd = rel(-120 - i); addD({ sd, at: sd + 7 * 3600000, rd: sd - 5 * DAY, dc: sd }); }                                                           // discovered the very day it was submitted: in order
  for (let i = 0; i < 4; i++) { const sd = rel(-130 - i); addD({ sd, at: sd + 7 * 3600000, rd: sd - 5 * DAY, dc: sd - 5 * DAY }); }                                                  // received and discovered the same day: in order
  for (let i = 0; i < 4; i++) { const sd = rel(-140 - i); addD({ sd, at: sd + 7 * 3600000, rd: null, dc: sd - 4 * DAY }); }                                                         // no received date
  for (let i = 0; i < 4; i++) { const sd = rel(-150 - i); addD({ sd, at: sd + 7 * 3600000, rd: sd - 4 * DAY, dc: null }); }                                                         // no discovery date
  for (let i = 0; i < 3; i++) { const sd = rel(-160 - i); addD({ sd, at: sd + 7 * 3600000, rd: null, dc: null }); }
  for (let i = 0; i < 4; i++) { const sd = Date.UTC(2026, 4, 5) + i * 0; addD({ sd, at: sd + 7 * 3600000, rd: sd - 9 * DAY, dc: sd + 1 * DAY }); }                                    // day and month the same: no other reading
  for (let i = 0; i < 4; i++) { const sd = rel(-170 - i); addD({ sd, at: sd - 3 * 3600000 + 30 * 60000, rd: sd - 9 * DAY, dc: sd + 0 }); }                                           // submitted 21:30 UTC the day before: today's day in EAT
  const COPY_D = `copy public.pmo_deductions (id, case_id, submitted_at, received_date, discovery_date) from stdin with (format csv, null '');\n`
    + deds.map(d => [d.id, 'c' + d.id.slice(1, 8), new Date(d.at).toISOString(), d.rd == null ? '' : iso(d.rd), d.dc == null ? '' : iso(d.dc)].join(',')).join('\n') + '\n\\.\n';
  psql(COPY_N + COPY_D + 'analyze public.demand_notices; analyze public.pmo_deductions;');
  const dump = () => psql(`select 'N' || md5(coalesce(string_agg(t::text, '|' order by id), '')) from public.demand_notices t; select 'D' || md5(coalesce(string_agg(t::text, '|' order by id), '')) from public.pmo_deductions t;`);

  // ---- the MODEL: the rule written again ---------------------------------------------------------------------------------------------------
  const eat = t => { const x = new Date(t + 3 * 3600000); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()); };       // the day in East Africa (UTC+3, no daylight saving)
  const PAT = /^HMCL\/[^/]+\/(\d{2})\/(\d{2})\/(\d{4})(?:-\d+)?$/;
  const numDay = s => {
    const m = s == null ? null : PAT.exec(s); if (!m) return null;
    const d = +m[1], mo = +m[2], y = +m[3];
    return (mo >= 1 && mo <= 12 && y >= 2000 && y <= 2100 && d >= 1 && d <= daysIn(y, mo)) ? Date.UTC(y, mo - 1, d) : null;
  };
  for (const n of notices) {
    n.idd = numDay(n.number); n.isw = swap(n.idd); n.cd = eat(n.stampAt);
    n.kn = n.nd == null ? 'nodate' : n.idd == null ? 'nonumber' : n.nd === n.idd ? 'same' : (n.isw != null && n.nd === n.isw) ? 'swapped' : 'neither';
    n.kc = n.idd == null ? 'nonumber' : n.cd === n.idd ? 'same' : Math.abs(n.cd - n.idd) / DAY <= 7 ? 'near' : (n.isw != null && n.cd === n.isw) ? 'swapped' : 'other';
  }
  for (const d of deds) {
    d.sdd = eat(d.at); d.dsw = swap(d.dc);
    d.late = d.dc != null && d.dc > d.sdd; d.early = d.dc != null && d.rd != null && d.rd > d.dc;
    d.fix = d.dsw != null && (d.dc > d.sdd || (d.rd != null && d.rd > d.dc)) && d.dsw <= d.sdd && (d.rd == null || d.rd <= d.dsw);
  }
  const cnt = (a, f) => a.filter(f).length;
  const tri = (f) => fmt(cnt(notices, f)) + ' / ' + fmt(cnt(notices, n => f(n) && n.imp)) + ' / ' + fmt(cnt(notices, n => f(n) && !n.imp));
  const bad = deds.filter(d => d.late || d.early);
  const exN = notices.filter(n => n.kn === 'swapped' || n.kn === 'neither' || (n.nd != null && n.nd > TODAY))
    .sort((a, b) => ((b.nd ?? -Infinity) - (a.nd ?? -Infinity)) || (a.id < b.id ? -1 : 1)).slice(0, 12);
  const exD = bad.slice().sort((a, b) => (b.sdd - a.sdd) || (a.id < b.id ? -1 : 1)).slice(0, 10);
  const expect = () => {
    const sw = cnt(notices, n => n.kn === 'swapped'), nei = cnt(notices, n => n.kn === 'neither');
    const lines = [];
    lines.push((nei + sw === 0 && bad.length === 0) ? 'every notice with a dated number agrees with its notice date, and no deduction was discovered out of order: nothing to repair here'
      : `${fmt(sw)} notice date(s) are their number's date with day and month EXCHANGED (${fmt(cnt(notices, n => n.kn === 'swapped' && n.imp))} imported, ${fmt(cnt(notices, n => n.kn === 'swapped' && !n.imp))} made in the app); ${fmt(nei)} match neither; ${fmt(bad.length)} deduction(s) have a discovery date out of order, ${fmt(cnt(deds, d => d.fix))} of them put in order by exchanging its day and month`);
    lines.push(`${fmt(notices.length)} / ${fmt(cnt(notices, n => n.imp))} / ${fmt(cnt(notices, n => !n.imp))}`);
    lines.push(tri(n => n.idd != null)); lines.push(tri(n => n.kn === 'same')); lines.push(tri(n => n.kn === 'swapped')); lines.push(tri(n => n.kn === 'neither'));
    lines.push(`${fmt(cnt(notices, n => n.kn === 'nodate'))} / ${fmt(cnt(notices, n => n.idd == null))}`);
    lines.push(`${fmt(cnt(notices, n => n.nd != null && n.nd > TODAY))} / ${fmt(cnt(notices, n => n.nd != null && n.nd > TODAY && n.idd != null && n.idd <= TODAY))}`);
    lines.push(`${fmt(cnt(notices, n => n.kc === 'same'))} / ${fmt(cnt(notices, n => n.kc === 'near'))} / ${fmt(cnt(notices, n => n.kc === 'swapped'))} / ${fmt(cnt(notices, n => n.kc === 'other'))}`);
    for (const e of exN) lines.push(`notice date ${e.nd == null ? 'none' : iso(e.nd)}, number says ${e.idd == null ? 'no day' : iso(e.idd)}, stamp ${iso(e.cd)}, ${e.imp ? 'imported' : 'made in the app'}: ${e.kn}`);
    lines.push(`${fmt(deds.length)} / ${fmt(cnt(deds, d => d.dc != null))}`);
    lines.push(`${fmt(cnt(deds, d => d.late))} / ${fmt(cnt(deds, d => d.early))}`);
    lines.push(`${fmt(cnt(deds, d => d.fix))} of ${fmt(bad.length)}`);
    for (const e of exD) lines.push(`money received ${e.rd == null ? 'none' : iso(e.rd)}, discovered ${e.dc == null ? 'none' : iso(e.dc)}, submitted ${iso(e.sdd)}${e.fix ? ', in order with the discovery exchanged (' + iso(e.dsw) + ')' : ', not put in order by exchanging it'}`);
    return { lines, exN, exD };
  };
  const ids = { n: exN.map(n => n.id.slice(0, 8)), d: exD.map(d => d.id.slice(0, 8)) };
  const run = file => psql('begin;\n' + file + '\nrollback;\n').trim().split('\n').map(l => l.split(SEP));
  const answers = rows => {                                                                                           // the printed lines: answers only, and the examples' labels checked apart
    const lab = rows.map(r => r[0]);
    const iP = lab.findIndex(l => l.startsWith('PMO deductions in the book'));
    return { ans: rows.map(r => r[1]), exLabelsN: lab.slice(9, iP).map(l => l.replace(/^\s+e\.g\. notice /, '')), exLabelsD: lab.slice(iP + 3).map(l => l.replace(/^\s+e\.g\. deduction /, '')) };
  };
  const E = expect();
  const before = dump();
  const rows = run(FILE);
  const got = answers(rows);
  // the answers in the order printed: ANSWER, 1..8, the notice examples, 30..32, the deduction examples
  const want = [...E.lines.slice(0, 9), ...E.lines.slice(9, 9 + E.exN.length), ...E.lines.slice(9 + E.exN.length, 9 + E.exN.length + 3), ...E.lines.slice(9 + E.exN.length + 3)];
  check('every line the file prints equals the model\'s, line by line (' + notices.length + ' notices, ' + deds.length + ' deductions, ' + want.length + ' lines)', JSON.stringify(got.ans) === JSON.stringify(want),
    (() => { for (let i = 0; i < Math.max(got.ans.length, want.length); i++) if (got.ans[i] !== want[i]) return 'line ' + i + ': got ' + JSON.stringify(got.ans[i]) + ' want ' + JSON.stringify(want[i]); return ''; })());
  check('the examples name the rows the model picks, in the model\'s order (the first eight characters of the id only)', JSON.stringify(got.exLabelsN) === JSON.stringify(ids.n) && JSON.stringify(got.exLabelsD) === JSON.stringify(ids.d), JSON.stringify([got.exLabelsN, ids.n]));
  check('the two tables are byte-identical afterwards: nothing was written', dump() === before);
  const sw = cnt(notices, n => n.kn === 'swapped'), nei = cnt(notices, n => n.kn === 'neither');
  check('the fixture holds every kind of row a break needs: swapped ' + sw + ', neither ' + nei + ', later than today ' + cnt(notices, n => n.nd != null && n.nd > TODAY) + ', number with no day ' + cnt(notices, n => n.idd == null) + ', deductions out of order ' + bad.length + ' (fixable ' + cnt(deds, d => d.fix) + ')',
    sw >= 100 && nei >= 15 && cnt(notices, n => n.nd != null && n.nd > TODAY) >= 5 && cnt(notices, n => n.idd == null) >= 20 && bad.length >= 20 && cnt(deds, d => d.fix) >= 8 && cnt(deds, d => d.late && !d.fix) >= 3 && cnt(deds, d => d.early) >= 5
      && cnt(notices, n => n.kc === 'near') >= 5 && cnt(notices, n => n.kc === 'other') >= 5 && cnt(notices, n => n.kc === 'swapped') >= 5);
  check('the file contains nothing that writes and names no table but the two it reads', !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|vacuum)\b/i.test(FILE.replace(/^\s*--.*$/gm, '')) && [...new Set([...FILE.replace(/^\s*--.*$/gm, '').matchAll(/\bpublic\.([a-z_]+)/g)].map(m => m[1]))].sort().join() === 'demand_notices,pmo_deductions');
  // a clean book answers "nothing to repair"
  psql("begin;\ndelete from public.demand_notices;\ndelete from public.pmo_deductions;\ninsert into public.demand_notices (ref, notice_id, notice_date, created_at) values ('R1', 'HMCL/AB/12/09/2026', date '2026-09-12', timestamptz '2026-09-12 09:00+03');\ncommit;");
  const clean = run(FILE);
  check('a clean book (one right notice, no deduction) says nothing is to be repaired and counts zero', /^every notice with a dated number agrees/.test(clean[0][1]) && clean.some(r => r[0].startsWith('PMO deductions in the book') && r[1] === '0 / 0'), clean[0][1]);
  psql('begin;\ndelete from public.demand_notices;\ncommit;');
  const empty = run(FILE);
  check('an empty book answers zero everywhere and does not fail', /^every notice/.test(empty[0][1]) && empty[1][1] === '0 / 0 / 0');
  // a book of live size and a hundred times that: the timing the owner will see
  psql(`insert into public.demand_notices (ref, notice_id, notice_date, created_at, upload_date)
        select 'R' || g, 'HMCL/AB/' || lpad((1 + g % 28)::text, 2, '0') || '/' || lpad((1 + g % 12)::text, 2, '0') || '/2026-' || g, make_date(2026, 1 + (g * 7) % 12, 1 + g % 28), now() - (g % 300) * interval '1 day', case when g % 3 = 0 then date '2026-10-12' end
        from generate_series(1, 100000) g;
        insert into public.pmo_deductions (case_id, submitted_at, received_date, discovery_date) select 'c' || g, now() - (g % 300) * interval '1 day', current_date - 20, current_date - (g % 25) from generate_series(1, 10000) g;
        analyze public.demand_notices; analyze public.pmo_deductions;`);
  const t0 = Date.now(); const big = run(FILE); const secs = (Date.now() - t0) / 1000;
  check('a book of 100,000 notices and 10,000 deductions (a hundred times the live one) is read in ' + secs.toFixed(2) + ' s, under the 30-second ceiling', big.length > 9 && secs < 10);
  // put the real fixture back for the breaks
  psql('begin;\ndelete from public.demand_notices;\ndelete from public.pmo_deductions;\ncommit;');
  psql(COPY_N + COPY_D);

  // ---- broken on purpose: each break must change the answer (or, for the two guards, fail on the row that guard is for) ----------------------------------------
  const onlyNotices = file => psql('begin;\ndelete from public.pmo_deductions;\n' + file + '\nrollback;\n').trim().split('\n').map(l => l.split(SEP));   // the deductions are all right (there are none)
  const onlyDeductions = file => psql('begin;\ndelete from public.demand_notices;\n' + file + '\nrollback;\n').trim().split('\n').map(l => l.split(SEP));  // the notices are all right (there are none)
  const sigOf = file => JSON.stringify([run(file), onlyNotices(file), onlyDeductions(file)]);
  const baseSig = sigOf(FILE);
  check('with only one register unclean the answer says so: notices alone, and deductions alone', !/nothing to repair/.test(onlyNotices(FILE)[0][1]) && !/nothing to repair/.test(onlyDeductions(FILE)[0][1]));
  const sub = (src, re, to, what) => { const n = (src.match(new RegExp(re.source, 'g')) || []).length; if (n !== 1) throw new Error('the file has ' + n + ' of "' + what + '", the check needs exactly one'); return src.replace(re, () => to); };
  const rep = (re, to) => src => sub(src, re, to, String(re));
  const breaks = [
    ['the notice stamp\'s day is the UTC day, not the East Africa day',              rep(/\(n\.created_at at time zone 'Africa\/Dar_es_Salaam'\)::date as cd/, "(n.created_at at time zone 'UTC')::date as cd")],
    ['the deduction\'s submission day is the UTC day',                               rep(/\(p\.submitted_at at time zone 'Africa\/Dar_es_Salaam'\)::date as sd/, "(p.submitted_at at time zone 'UTC')::date as sd")],
    ['"today" is a day late',                                                        rep(/\(now\(\) at time zone 'Africa\/Dar_es_Salaam'\)::date as d/, "(now() at time zone 'Africa/Dar_es_Salaam')::date - 1 as d")],
    ['"today" is a day early',                                                       rep(/\(now\(\) at time zone 'Africa\/Dar_es_Salaam'\)::date as d/, "(now() at time zone 'Africa/Dar_es_Salaam')::date + 1 as d")],
    ['a number in lower case is a number',                                           rep(/\(\?:-\\d\+\)\?\$'\) as p/, "(?:-\\d+)?$', 'i') as p")],
    ['a repeat number (-2) is not a number',                                         rep(/\(\\d\{4\}\)\(\?:-\\d\+\)\?\$/, '(\\d{4})$')],
    ['a year before 2000 is a year',                                                 rep(/between 2000 and 2100 then/, 'between 1900 and 2100 then')],
    ['a year after 2100 is a year',                                                  rep(/between 2000 and 2100 then/, 'between 2000 and 2200 then')],
    ['the day of a number may be any of 1 to 31 (a number typed 31/04: the file fails on it)', rep(/between 1 and extract\(day from \(make_date\(\(m\.p\)\[3\]::int, \(m\.p\)\[2\]::int, 1\) \+ interval '1 month' - interval '1 day'\)\)::int/, 'between 1 and 31'), true],
    ['the month of a number may be any (a number typed with month 13: the file fails on it)', rep(/\(m\.p\)\[2\]::int between 1 and 12 and /, ''), true],
    ['the day and month are not exchanged',                                          rep(/make_date\(extract\(year from v\.idd\)::int, extract\(day from v\.idd\)::int, extract\(month from v\.idd\)::int\)/, 'v.idd')],
    ['a day of twelve is not exchanged',                                             rep(/extract\(day from v\.idd\) <= 12 and/, 'extract(day from v.idd) <= 11 and')],
    ['an exchanged date is told from neither',                                       rep(/when w\.isw is not null and w\.nd = w\.isw then 'swapped'/, "when false then 'swapped'")],
    ['the stamp is "near" within three days only',                                   rep(/abs\(w\.cd - w\.idd\) <= 7/, 'abs(w.cd - w.idd) <= 3')],
    ['the stamp is "near" within thirty days',                                       rep(/abs\(w\.cd - w\.idd\) <= 7/, 'abs(w.cd - w.idd) <= 30')],
    ['imported is read from the wrong side',                                         rep(/\(n\.upload_date is not null\) as imp/, '(n.upload_date is null) as imp')],
    ['a notice dated today is later than today',                                     rep(/where k\.kn in \('swapped', 'neither'\) or k\.nd > \(select d from today\)/, "where k.kn in ('swapped', 'neither') or k.nd >= (select d from today)")],
    ['the examples are the earliest dates first',                                    rep(/order by k\.nd desc nulls last, k\.id/, 'order by k.nd asc nulls last, k.id')],
    ['five examples, not twelve',                                                    rep(/where e\.rn <= 12/, 'where e.rn <= 5')],
    ['four examples of deductions, not ten',                                         rep(/where d\.rn <= 10/, 'where d.rn <= 4')],
    ['discovered the day it was submitted counts as after',                          rep(/\(pd\.dc is not null and pd\.dc > pd\.sd\) as late_dc/, '(pd.dc is not null and pd.dc >= pd.sd) as late_dc')],
    ['received the day it was discovered counts as before',                          rep(/pd\.rd > pd\.dc\) as early_dc/, 'pd.rd >= pd.dc) as early_dc')],
    ['the exchange need not put the discovery before the submission',                rep(/ and pd\.dsw <= pd\.sd and /, ' and ')],
    ['the exchange need not keep the discovery after the money was received',        rep(/\(pd\.rd is null or pd\.rd <= pd\.dsw\)\) as fixable/, 'true) as fixable')],
    ['a clean answer is given when only one of the two is clean',                    rep(/\(select count\(\*\) from k where kn in \('swapped', 'neither'\)\) = 0 and \(select count\(\*\) from pk where late_dc or early_dc\) = 0/, "(select count(*) from k where kn in ('swapped', 'neither')) = 0 or (select count(*) from pk where late_dc or early_dc) = 0")],
    ['the notice count by group counts the wrong side',                              rep(/to_char\(\(select count\(\*\) from k where kn = 'swapped' and imp\), 'FM999,999,999'\) \|\| ' imported, '/, "to_char((select count(*) from k where kn = 'swapped' and not imp), 'FM999,999,999') || ' imported, '")],
  ];
  let notCaught = 0;
  for (const [name, fn, mustFail] of breaks) {
    let broken = null, why = '', ok = false;
    try { broken = fn(FILE); } catch (err) { why = err.message; }
    if (broken !== null) {
      try { const changed = sigOf(broken) !== baseSig; ok = !mustFail && changed; if (mustFail) why = 'the broken file ran, but it should have failed on a number that is no day'; }
      catch (err) { if (mustFail) ok = /out of range|date field value|invalid/i.test(err.psql || err.message); else why = 'the broken file does not run: ' + err.message.slice(0, 160); }
    }
    if (!ok) notCaught++;
    check('BROKEN ON PURPOSE, ' + (mustFail ? 'the file fails on the row that guard is for: ' : 'the answer changes: ') + name, ok, why || 'the answer is the same as the file\'s');
  }
  console.log('\n' + (fails.length ? fails.length + ' FAILED' : 'all passed') + ' (' + breaks.length + ' breaks, ' + (breaks.length - notCaught) + ' caught)');
  exitCode = fails.length ? 1 : 0;
} finally {
  try { psql('drop database if exists ' + DB, admin); } catch { /* leave it */ }
}
process.exit(exitCode);
