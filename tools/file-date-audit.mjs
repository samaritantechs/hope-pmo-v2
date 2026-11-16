/* WHICH WAY ROUND DOES THIS FILE WRITE ITS DATES, AND DOES THE SYSTEM READ IT RIGHT?  (docs/HANDOFF.md Part 90)

     "They might be in different orders per file so check starting with the defaulters one I sent" -- the owner, 16 Nov 2026

   A file the owner sends is checked HERE, not by eye. For every date column of its data sheet this says how the
   cells are written (a text, a real date, an ISO text, "No due date"), and how many of the slash dates can only be
   month-first, can only be day-first, or could be either: the evidence the upload's own rule (inferDayFirst) reads.
   And it judges the READING by something that is not the order rule itself:

     --type defaulters   the loan system's own pattern (the one db/RUN-ME-060 repairs by): a loan expires 91 days
                         after it is disbursed, turns chronic 14 days after that, and DAYS ELAPSED is the days from
                         disbursement to the deck's day less 1 or 2. It says how many rows fit that pattern read by
                         the importer as it is now, and how many read with no order (the importer before Part 84).
     --type approved     the file's own Filters sheet: the report's dates must fall between its Start Date and End
                         Date. It counts them read month-first and read day-first.

   It prints counts and the one loan the owner names (--ref). Never a name, a phone, an account.

   The files are read with SheetJS, which is not a dependency of this repository. The same version the Upload page
   loads is enough (an empty folder of its own):

       npm pack xlsx@0.18.5 && tar -xzf xlsx-0.18.5.tgz
       XLSX_NODE=<that folder>/package/xlsx.js node tools/file-date-audit.mjs <file.xlsx> --type defaulters --day 2026-11-16 [--ref 2209966593]
       XLSX_NODE=... node tools/file-date-audit.mjs <file.xlsx> --type approved
       XLSX_NODE=... node tools/file-date-audit.mjs <file.csv|xlsx>                      (the column audit alone, any sheet)

   A file is data: it is read and never run. Exit code 0 = the file was read; the verdict is in the text. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { importDefaulters, defaultersDateOrder, loansDateOrder, importLoans } from '../api/_lib/importers.js';
import { inferDayFirst } from '../api/_lib/parse.js';

const DAY = 86400000;
const SLASH = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp][Mm])?)?$/;
const ISO = /^\d{4}-\d{2}-\d{2}/;

/** One cell as the sheet holds it: { t: 's' text | 'd' real date | 'n' number | blank, v }. */
export const kindOf = cell => {
  if (!cell || cell.v === '' || cell.v == null) return 'blank';
  if (cell.t === 'd' || cell.v instanceof Date) return 'real date cell';
  if (cell.t === 'n') return 'number';
  const s = String(cell.v).trim();
  if (SLASH.test(s)) return 'slash text';
  if (ISO.test(s)) return 'ISO text';
  if (/^no\s+due\s+date$/i.test(s)) return 'No due date';
  return 'other text';
};

/** The audit of one date column: how its cells are written, and the evidence its slash dates carry. */
export function auditColumn(cells) {
  const kinds = {}; let monthFirstOnly = 0, dayFirstOnly = 0, ambiguous = 0, maxFirst = 0, maxSecond = 0;
  const years = {};
  for (const cell of cells) {
    const k = kindOf(cell); kinds[k] = (kinds[k] || 0) + 1;
    if (k !== 'slash text') continue;
    const m = String(cell.v).trim().match(SLASH), a = Number(m[1]), b = Number(m[2]);
    maxFirst = Math.max(maxFirst, a); maxSecond = Math.max(maxSecond, b);
    if (b > 12 && a <= 12) monthFirstOnly++; else if (a > 12 && b <= 12) dayFirstOnly++; else if (a <= 12 && b <= 12) ambiguous++;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); years[y] = (years[y] || 0) + 1;
  }
  const order = inferDayFirst(cells.filter(c => kindOf(c) === 'slash text').map(c => c.v));
  return { kinds, monthFirstOnly, dayFirstOnly, ambiguous, maxFirst, maxSecond, years, order,
    verdict: order === false ? 'month-first' : order === true ? 'day-first' : (monthFirstOnly + dayFirstOnly + ambiguous === 0 ? 'no slash dates' : 'no evidence: nothing in it can only be read one way') };
}

/** How many rows of a deck, as stored (the importer's own output), fit the loan system's pattern. */
export function deckFit(rows, snapDate) {
  const t = s => (s ? Date.parse(s + 'T00:00:00Z') : null), snap = t(snapDate);
  let n = 0, e91 = 0, c14 = 0, de = 0, all3 = 0;
  for (const x of rows) {
    n++;
    const d = t(x.disb_date), e = t(x.expire_date), c = t(x.chronic_date);
    const ok1 = d != null && e != null && Math.round((e - d) / DAY) === 91;
    const ok2 = e != null && c != null && Math.round((c - e) / DAY) === 14;
    const ok3 = d != null && x.days_elapsed != null && (() => { const a = Math.round((snap - d) / DAY) - x.days_elapsed; return a >= 0 && a <= 3; })();
    if (ok1) e91++; if (ok2) c14++; if (ok3) de++; if (ok1 && ok2 && ok3) all3++;
  }
  return { rows: n, expire91: e91, chronic14: c14, daysElapsed: de, all: all3 };
}

/** How many of a report's dates fall inside the window the file's own Filters sheet names, read each way round. */
export function windowFit(values, lo, hi) {
  const parse = (v, monthFirst) => {
    const s = String(v).trim(), m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (ISO.test(s)) return s.slice(0, 10);
    if (!m) return null;
    const [mo, d] = monthFirst ? [m[1], m[2]] : [m[2], m[1]], iso = `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const x = new Date(iso + 'T00:00:00Z');
    return !isNaN(x) && x.toISOString().slice(0, 10) === iso ? iso : null;
  };
  let n = 0, monthFirst = 0, dayFirst = 0;
  for (const v of values) { if (v === '' || v == null) continue; n++; const a = parse(v, true), b = parse(v, false); if (a && a >= lo && a <= hi) monthFirst++; if (b && b >= lo && b <= hi) dayFirst++; }
  return { n, monthFirst, dayFirst };
}

// ------------------------------------------------------------------------------------------------ the command line
async function main() {
  const args = process.argv.slice(2), file = args[0];
  const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
  if (!file || file.startsWith('--')) { console.error('usage: XLSX_NODE=<package/xlsx.js> node tools/file-date-audit.mjs <file> [--type defaulters|approved] [--day YYYY-MM-DD] [--sheet NAME] [--ref LOAN]'); process.exit(2); }
  const lib = process.env.XLSX_NODE;
  if (!lib || !fs.existsSync(lib)) { console.error('Set XLSX_NODE to a copy of SheetJS 0.18.5 xlsx.js (see the top of this file).'); process.exit(2); }
  const XLSX = createRequire(import.meta.url)(path.resolve(lib));
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true });
  const sn = opt('sheet') || (wb.SheetNames.includes('Data') ? 'Data' : wb.SheetNames[0]), ws = wb.Sheets[sn], rg = XLSX.utils.decode_range(ws['!ref']);
  const header = []; for (let c = rg.s.c; c <= rg.e.c; c++) { const cell = ws[XLSX.utils.encode_cell({ r: rg.s.r, c })]; header.push(cell ? String(cell.v).trim() : ''); }
  console.log(`FILE ${path.basename(file)} | sheet ${sn} | ${rg.e.r - rg.s.r} data rows | ${header.length} columns`);
  const dateCols = header.filter(h => /DATE|TRANS|TIMESTAMP|\bAT$|TAREHE/i.test(h));
  const colCells = name => { const c = header.indexOf(name), out = []; for (let r = rg.s.r + 1; r <= rg.e.r; r++) { const cell = ws[XLSX.utils.encode_cell({ r, c: c + rg.s.c })]; out.push(cell ? { t: cell.t, v: cell.v } : { t: 'z', v: '' }); } return out; };
  for (const name of dateCols) {
    const a = auditColumn(colCells(name));
    console.log(`\n[${name}] ${JSON.stringify(a.kinds)}\n  slash dates: only month-first ${a.monthFirstOnly} | only day-first ${a.dayFirstOnly} | could be either ${a.ambiguous} | largest first part ${a.maxFirst}, largest second part ${a.maxSecond}\n  -> ${a.verdict}`);
  }
  // the page's own conversion: a real date cell goes as ISO, everything else as it is
  const p2 = n => (n < 10 ? '0' : '') + n;
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }).filter(r => r.some(v => String(v).trim() !== ''))
    .map(r => r.map(v => (v instanceof Date ? v.getFullYear() + '-' + p2(v.getMonth() + 1) + '-' + p2(v.getDate()) : (v == null ? '' : v))));
  const type = opt('type');
  if (type === 'defaulters') {
    const day = opt('day') || (path.basename(file).match(/\d{4}-\d{2}-\d{2}/) || [])[0];
    if (!day) { console.error('--day YYYY-MM-DD is needed for the DAYS ELAPSED check'); process.exit(2); }
    const meta = { snapshotType: 'initial', weekday: 'MON', snapshotDate: day };
    const order = defaultersDateOrder(aoa), now = importDefaulters(aoa, meta), before = importDefaulters(aoa, { ...meta, dateOrder: { dayFirst: true } });
    const f1 = deckFit(now, day), f0 = deckFit(before, day);
    console.log(`\nDECK read by the importer as it is now (order decided by the file: ${order.dayFirst === false ? 'month-first' : order.dayFirst === true ? 'day-first' : 'none: read day-first'}):`);
    console.log(`  ${f1.all} of ${f1.rows} rows fit all three of the loan system's own facts (expiry = disbursement + 91 days ${f1.expire91}, chronic = expiry + 14 days ${f1.chronic14}, DAYS ELAPSED ${f1.daysElapsed})`);
    console.log(`  read with no order, as before Part 84: ${f0.all} of ${f0.rows} fit; ${before.filter((x, i) => x.disb_date !== now[i].disb_date).length} disbursement dates differ`);
    const ref = opt('ref'); if (ref) { const a = now.find(x => String(x.ref) === ref), b = before.find(x => String(x.ref) === ref);
      console.log(`  loan ${ref}: now disbursed ${a && a.disb_date}, expires ${a && a.expire_date}, chronic ${a && a.chronic_date} | before: ${b && b.disb_date}, ${b && b.expire_date}, ${b && b.chronic_date}`); }
  } else if (type === 'approved') {
    const filt = wb.Sheets.Filters ? Object.fromEntries(XLSX.utils.sheet_to_json(wb.Sheets.Filters, { header: 1, raw: false, defval: '' }).map(r => [String(r[0]).trim(), String(r[1]).trim()])) : {};
    const lo = filt['Start Date'], hi = filt['End Date'], i = aoa[0].map(h => String(h).trim().toUpperCase()).indexOf('APPROVED DATE');
    if (!lo || !hi || i < 0) { console.log('\nno Filters window or no APPROVED DATE column in this file'); return; }
    const w = windowFit(aoa.slice(1).map(r => r[i]), lo, hi);
    console.log(`\nAPPROVED report, window from its own Filters sheet: ${lo} to ${hi}`);
    console.log(`  inside the window read month-first: ${w.monthFirst} of ${w.n} | read day-first: ${w.dayFirst} of ${w.n}`);
    console.log(`  the importer decides: ${JSON.stringify(loansDateOrder(aoa))} (false = month-first); it stores ${[...new Set(importLoans(aoa, 'approved').map(o => o.approved_date))].sort().join(', ')}`);
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
