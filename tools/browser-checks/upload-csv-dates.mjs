/* Drives the REAL public/upload.html in a real browser, with the SAME spreadsheet reader the page loads
   (SheetJS 0.18.5), to prove that a CSV reaches the server exactly as it was written -- its dates
   above all -- and that an Excel file is read as it always was (handbook Part 89).

     "just study the dates if the position of month starts then day or vice versa trim the same for the
      rest not to stay contradicted.. so pass through how you cumpute uploaded dates bro" -- the owner

   What it found: left to itself the reader turns a CSV cell that looks like a date into a real date by
   JavaScript's rule, month first, and a cell that looks like a number into a number. In a day-first CSV
   `9/7/2026` (the ninth of July) became the seventh of September while `16/11/2026`, which cannot be
   read that way, stayed text -- one file, two orders, decided in the browser before the server's own
   rule (inferDayFirst) ever saw it. `3/6` in D.S became the sixth of March 2001, an account lost its
   leading zero, a twenty-digit number lost its last digits. Reading a CSV with `raw: true` hands the
   server the text the file holds.

   The page loads the reader from cdnjs, which a cloud machine cannot reach, so this serves a local copy
   of the same version in its place:

       npm pack xlsx@0.18.5 && tar -xzf xlsx-0.18.5.tgz            (in an empty folder)
       XLSX_JS=<that folder>/package/dist/xlsx.full.min.js node tools/browser-checks/upload-csv-dates.mjs

   PAGE=<file> checks another copy of the page (the page as it was before Part 89 FAILS the CSV cases:
   that is how this check was shown to be able to fail). CHROME overrides the browser path. Lives outside
   test/ on purpose: `node --test` sweeps that directory, and a browser must not be needed for `npm test`.
   Exit code 0 = everything passed. */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PAGE = fs.readFileSync(process.env.PAGE || path.join(ROOT, 'public/upload.html'), 'utf8');
const XLSX_JS = process.env.XLSX_JS;
if (!XLSX_JS || !fs.existsSync(XLSX_JS)) {
  console.error('Set XLSX_JS to a copy of SheetJS 0.18.5 xlsx.full.min.js (see the top of this file).');
  process.exit(2);
}

const srv = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/upload')) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return; }
  if (req.url === '/brand.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(''); return; }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ok = [], fail = [];
const check = (n, c, x) => (c ? ok : fail).push(n + (x ? ' -- ' + x : ''));
const errs = [];

/** Upload one file through the page as a person would, and return the rows the page sent the server. */
async function sent(name, buffer, type, opts = {}) {
  const page = await browser.newPage();
  page.on('pageerror', e => errs.push(String(e)));
  let posted = null;
  await page.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: XLSX_JS, contentType: 'application/javascript' }));
  await page.route('**/api/**', async r => {
    if (r.request().url().endsWith('/api/upload') && r.request().method() === 'POST') {
      posted = r.request().postDataJSON();
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, inserted: (posted.rows || []).length - 1, table: 'test' }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => (r.request().url().includes('cdnjs.cloudflare.com') ? r.fallback() : r.abort()));
  await page.goto(base + '/upload');
  await page.waitForFunction(() => window.XLSX);
  const bytes = typeof buffer === 'function' ? Buffer.from(await page.evaluate(buffer), 'base64') : buffer;
  await page.evaluate(([t, d]) => {
    const s = document.getElementById('type'); s.value = t; s.dispatchEvent(new Event('change'));
    const sd = document.getElementById('snapDate'); if (sd) sd.value = d;
    const wd = document.getElementById('weekday'); if (wd) { wd.value = 'MON'; wd.dispatchEvent(new Event('change')); }
  }, [type, '2026-11-16']);
  await page.fill('#code', 'A');
  await page.setInputFiles('#file', { name, mimeType: name.endsWith('.csv') ? 'text/csv' : 'application/octet-stream', buffer: bytes });
  await page.waitForFunction(n => document.getElementById('drop').textContent.indexOf(n) >= 0, name);
  await page.click('#go');
  await page.waitForFunction(() => /Done|Failed|failed/i.test(document.getElementById('msg').textContent), null, { timeout: 15000 }).catch(() => {});
  await page.close();
  return posted;
}

const csv = s => Buffer.from(s, 'utf8');
const HEAD = 'REF#,FULLNAME,DISB DATE,EXPIRE DATE,D.S,ACCOUNT,AMOUNT';

// 1. A day-first CSV: every cell must reach the server as the text the file holds.
{
  const lines = [HEAD,
    '2200000001,A MADE UP,9/7/2026,21/12/2026,3/6,0152826626000,"92,000.00"',
    '2200000002,B MADE UP,16/11/2026,2/3/2027,8-9,12345678901234567890,500'];
  const p = await sent('deck-dayfirst.csv', csv(lines.join('\n')), 'defaulters-current');
  const want = [HEAD.split(','),
    ['2200000001', 'A MADE UP', '9/7/2026', '21/12/2026', '3/6', '0152826626000', '92,000.00'],      // the quoted comma figure is one cell
    ['2200000002', 'B MADE UP', '16/11/2026', '2/3/2027', '8-9', '12345678901234567890', '500']];
  check('a day-first CSV is posted (a request was made)', !!p && Array.isArray(p.rows));
  const rows = (p && p.rows) || [];
  check('  ...its header row is untouched', JSON.stringify(rows[0]) === JSON.stringify(want[0]), JSON.stringify(rows[0]));
  check('  ...9/7/2026 (the ninth of July) is still text, not the seventh of September', rows[1] && rows[1][2] === '9/7/2026', JSON.stringify(rows[1]));
  check('  ...16/11/2026 and 21/12/2026 are still text (they always were)', rows[2] && rows[2][2] === '16/11/2026' && rows[1][3] === '21/12/2026', JSON.stringify(rows[2]));
  check('  ...2/3/2027 is still text, not the third of February', rows[2] && rows[2][3] === '2/3/2027', JSON.stringify(rows[2]));
  check('  ...D.S "3/6" is still 3/6, not the sixth of March 2001', rows[1] && rows[1][4] === '3/6' && rows[2][4] === '8-9', JSON.stringify([rows[1] && rows[1][4], rows[2] && rows[2][4]]));
  check('  ...an account keeps its leading zero and a twenty-digit number its last digits', rows[1] && rows[1][5] === '0152826626000' && rows[2][5] === '12345678901234567890', JSON.stringify([rows[1] && rows[1][5], rows[2] && rows[2][5]]));
  check('  ...every cell of the file went as the very text the file holds', JSON.stringify(rows) === JSON.stringify(want), JSON.stringify(rows));
}

// 2. A month-first CSV (the loan system's order) arrives as text too: the server's evidence rule decides, in one place.
{
  const lines = [HEAD,
    '2209966593,A MADE UP,9/7/2026,12/21/2026,8-9,0152826626000,500',
    '2200000002,B MADE UP,11/16/2026,3/2/2027,3-6,0152826626001,500'];
  const p = await sent('deck-monthfirst.csv', csv(lines.join('\n')), 'defaulters-initial');
  const rows = (p && p.rows) || [];
  check('a month-first CSV arrives as the text it holds', JSON.stringify(rows) === JSON.stringify(lines.map(l => l.split(','))), JSON.stringify(rows));
}

// 3. An Excel file is read exactly as it always was: a real date cell goes as ISO, a text cell as text.
{
  const build = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['REF#', 'FULLNAME', 'DISB DATE', 'EXPIRE DATE', 'D.S'],
      ['2200000001', 'A MADE UP', new Date(Date.UTC(2026, 8, 7, 12)), '12/21/2026', '8-9']], { cellDates: true });
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    return XLSX.write(wb, { type: 'base64', bookType: 'xlsx', cellDates: true });
  };
  const p = await sent('deck.xlsx', build, 'defaulters-current');
  const rows = (p && p.rows) || [];
  check('an Excel file is posted', rows.length === 2, JSON.stringify(rows));
  check('  ...its real date cell goes as an ISO date (with the clock only if the cell has one; not touched by this change)', rows[1] && /^2026-09-0[67]( \d\d:\d\d)?$/.test(rows[1][2]), JSON.stringify(rows[1]));
  check('  ...its text cells go as text', rows[1] && rows[1][3] === '12/21/2026' && rows[1][4] === '8-9', JSON.stringify(rows[1]));
}

await browser.close(); srv.close();
if (errs.length) fail.push('page errors: ' + errs.join(' | '));
console.log(ok.map(s => 'ok    ' + s).join('\n'));
console.log(fail.map(s => 'FAIL  ' + s).join('\n'));
console.log(`\n${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
