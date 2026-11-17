/* Drives the REAL public/upload.html in a real browser to prove what the person at the keyboard SEES when a file carries dates nobody could read
   (handbook Part 96, matter 4b of the owner's dates order).

     "... different excels might come with different fomarts am not sure." -- the owner, 17 Nov 2026

   A date the system cannot read used to be stored empty with not a word on the screen. The server now answers every slice of a file that has date
   columns with `unreadableDates: { count, examples }`; the page adds the slices up and says it ONCE, in both of its languages, from the file's total:

     1. a file of three slices that lost 3, 4 and 0 dates: the Done message says 7, with three distinct examples, in Swahili and in English;
     2. a file that lost none: no sentence (and no stray zero);
     3. a file small enough for one request carries its own count through;
     4. an upload type whose answer has no such field (the settings, the hints): nothing is added;
     5. an answer with a count and no examples: the upload is still Done and the sentence is still said.

   The page loads the spreadsheet reader from cdnjs, which a cloud machine cannot reach, so this serves a local copy of the same version:

       npm pack xlsx@0.18.5 && tar -xzf xlsx-0.18.5.tgz            (in an empty folder)
       XLSX_JS=<that folder>/package/dist/xlsx.full.min.js node tools/browser-checks/upload-unreadable-dates.mjs

   PAGE=<file> checks another copy of the page (the page as it was before Part 96 FAILS cases 1 and 3: that is how this check was shown to be able to
   fail). CHROME overrides the browser path. Lives outside test/ on purpose: `node --test` sweeps that directory, and a browser must not be needed for
   `npm test`. Exit code 0 = everything passed. */
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
const check = (n, c, x) => (c ? ok : fail).push(n + (!c && x ? ' -- ' + x : ''));
const errs = [];

/** Upload one CSV through the page as a person would. `answers` is what the server says to each slice, in order (the last repeats). Returns the
    text the person is shown and how many requests the page made. */
async function shown(rowCount, type, answers) {
  const page = await browser.newPage();
  page.on('pageerror', e => errs.push(String(e)));
  let calls = 0;
  await page.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: XLSX_JS, contentType: 'application/javascript' }));
  await page.route('**/api/**', async r => {
    if (r.request().url().endsWith('/api/upload') && r.request().method() === 'POST') {
      const posted = r.request().postDataJSON();
      const a = answers[Math.min(calls, answers.length - 1)];
      calls++;
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, inserted: (posted.rows || []).length - 1, table: 'test', ...a }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => (r.request().url().includes('cdnjs.cloudflare.com') ? r.fallback() : r.abort()));
  await page.goto(base + '/upload');
  await page.waitForFunction(() => window.XLSX);
  const lines = ['REF#,FULLNAME,DISB DATE'];
  for (let i = 0; i < rowCount; i++) lines.push('22' + String(i).padStart(8, '0') + ',C' + i + ',9/7/2026');
  await page.evaluate(([t, d]) => {
    const s = document.getElementById('type'); s.value = t; s.dispatchEvent(new Event('change'));
    const sd = document.getElementById('snapDate'); if (sd) sd.value = d;
    const wd = document.getElementById('weekday'); if (wd) { wd.value = 'MON'; wd.dispatchEvent(new Event('change')); }
  }, [type, '2026-11-16']);
  await page.fill('#code', 'A');
  await page.setInputFiles('#file', { name: 'deck.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n'), 'utf8') });
  await page.waitForFunction(() => document.getElementById('drop').textContent.indexOf('deck.csv') >= 0);
  await page.click('#go');
  await page.waitForFunction(() => /Done|Failed|failed/i.test(document.getElementById('msg').textContent), null, { timeout: 20000 }).catch(() => {});
  const text = await page.evaluate(() => document.getElementById('msg').textContent);
  await page.close();
  return { text, calls };
}

// 1. three slices (2000 + 2000 + 500 rows) that lost 3, 4 and 0 dates
{
  const r = await shown(4500, 'defaulters-current', [
    { unreadableDates: { count: 3, examples: ['sometime in July', 'soon'] } },
    { unreadableDates: { count: 4, examples: ['soon', 'later', 'never', 'x'] } },
    { unreadableDates: { count: 0, examples: [] } }]);
  check('three slices were sent', r.calls === 3, 'requests: ' + r.calls);
  check('the upload is Done', /^Done/.test(r.text), r.text.slice(0, 120));
  check('the Swahili sentence says 7, the file\'s total, not the last slice\'s 0 and not the middle one\'s 4', /ANGALIA: tarehe 7 kwenye faili hii hazikusomeka/.test(r.text), r.text);
  check('the English sentence says 7 too', /WARNING: 7 date\(s\) in this file could NOT be read/.test(r.text), r.text);
  check('the examples are three, distinct, in quotes', /\(mfano: “sometime in July”, “soon”, “later”\)/.test(r.text) && /for example “sometime in July”, “soon”, “later”\)/.test(r.text), r.text);
  check('it is said once in each language', (r.text.match(/ANGALIA: tarehe/g) || []).length === 1 && (r.text.match(/WARNING: 7 date/g) || []).length === 1, r.text);
  check('it says nothing was guessed', /hakuna tarehe iliyokisiwa/.test(r.text) && /no date was guessed/.test(r.text), r.text);
}
// 2. a file that read in full: no sentence at all
{
  const r = await shown(4500, 'defaulters-current', [{ unreadableDates: { count: 0, examples: [] } }]);
  check('a file that lost nothing is Done', /^Done/.test(r.text), r.text.slice(0, 120));
  check('...and says nothing about dates (no stray zero)', !/tarehe \d|date\(s\) in this file|ANGALIA: tarehe/.test(r.text), r.text);
}
// 3. one request
{
  const r = await shown(300, 'defaulters-current', [{ unreadableDates: { count: 2, examples: ['a', 'b'] } }]);
  check('a small file is one request', r.calls === 1, 'requests: ' + r.calls);
  check('...and carries its own count', /tarehe 2 kwenye faili/.test(r.text) && /2 date\(s\) in this file could NOT be read/.test(r.text), r.text);
}
// 4. an answer with no such field
{
  const r = await shown(300, 'defaulters-current', [{}]);
  check('an answer with no unreadableDates field adds nothing', /^Done/.test(r.text) && !/tarehe \d|date\(s\) in this file/.test(r.text), r.text);
}

// 5. an answer with a count and no examples (another server, an older one): the upload is still Done, and the sentence is still said
{
  const r = await shown(300, 'defaulters-current', [{ unreadableDates: { count: 5 } }]);
  check('a count with no examples does not turn a finished upload into an error', /^Done/.test(r.text) && /tarehe 5 kwenye faili/.test(r.text) && /5 date\(s\) in this file could NOT be read/.test(r.text), r.text);
}

await browser.close(); srv.close();
if (errs.length) fail.push('page errors: ' + errs.join(' | '));
console.log(ok.map(s => 'ok    ' + s).join('\n'));
console.log(fail.map(s => 'FAIL  ' + s).join('\n'));
console.log(`\n${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
