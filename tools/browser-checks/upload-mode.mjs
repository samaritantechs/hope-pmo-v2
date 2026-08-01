/* Drives the REAL public/upload.html in a real browser to prove that choosing a report type
   actually reveals the Append / Replace-for-this-date choice.

   The choice shipped in #48, was confirmed merged and deployed, and still was not on the
   handsets that needed it -- because nothing told the browser to stop using the copy it
   already had. So the code was right and the screen was wrong, which is precisely the gap a
   browser check closes and reading the code does not.

   Lives OUTSIDE test/ on purpose: `node --test` sweeps that whole directory, so a check that
   needs a browser installed would have made `npm test` fail on any machine without one -- and
   npm test guards the deploy. playwright-core is likewise not in package.json. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/upload-mode.mjs

   CHROME overrides the browser path. Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PAGE = fs.readFileSync(path.join(ROOT, 'public/upload.html'), 'utf8');

const srv = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/upload')) {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Last-Modified': new Date().toUTCString() });
    res.end(PAGE); return;
  }
  if (req.url === '/brand.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(''); return; }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === "error" && !/favicon|404|ERR_TUNNEL|ERR_FAILED/.test(m.text())) errs.push('console: ' + m.text()); });
await page.goto(base + '/upload');

const ok = [], fail = [];
const check = (n, c, x) => (c ? ok : fail).push(n + (x ? ' -- ' + x : ''));
const pick = async (v, stage) => {
  await page.evaluate(([t, st]) => {
    const s = document.getElementById('type'); s.value = t; s.dispatchEvent(new Event('change'));
    if (st) { const g = document.getElementById('stage'); g.value = st; g.dispatchEvent(new Event('change')); }
  }, [v, stage || null]);
  return page.evaluate(() => ({
    stamp: !document.getElementById('stampWrap').classList.contains('hide'),
    askDate: !document.getElementById('stampDateWrap').classList.contains('hide'),
    date: document.getElementById('uploadDate').value,
    append: document.getElementById('modeAppend').classList.contains('on'),
    replace: document.getElementById('modeReplace').classList.contains('on'),
    note: document.getElementById('behaviour').textContent,
  }));
};

// THE TWO REPORTS THAT CARRY THEIR OWN DATES. These still offer Append / Replace, but they no
// longer ask for a report date -- the file already answered that question, and asking twice is
// how someone ends up redoing the wrong day.
for (const [type, stage, label, col] of [
  ['loans', 'approved', 'Loan pipeline / Approved', 'APPROVED DATE'],
  ['loans', 'disbursed', 'Loan pipeline / Disbursed', 'DISB DATE'],
  ['received', null, 'Received Payments', 'PAID AT'],
]) {
  const s = await pick(type, stage);
  check('"' + label + '" still offers Append / Replace', s.stamp, JSON.stringify(s));
  check('  ...but does NOT ask for a report date -- the file has one', !s.askDate, 'asks=' + s.askDate);
  check('  ...defaulting to Append, not Replace', s.append && !s.replace, JSON.stringify(s));
  check('  ...and names the column the days come from', s.note.indexOf(col) >= 0, s.note.slice(0, 110));
}

// The other six pipeline stages have no date of their own worth trusting, so they keep the
// stamp -- an applications report pulled on the 27th is full of June dates.
for (const stage of ['unassigned', 'assigned', 'unassessed', 'assessed', 'pending_approval', 'pending_disb']) {
  const s = await pick('loans', stage);
  check('loans/' + stage + ' still asks for a report date', s.stamp && s.askDate, JSON.stringify(s));
  check('  ...and is dated ready to go', /^\d{4}-\d{2}-\d{2}$/.test(s.date), 'date=' + s.date);
}

// Every other register that accumulates gets it too.
for (const type of ['abnormal', 'complaints', 'restructures', 'demand-notices', 'comments']) {
  const s = await pick(type);
  check('"' + type + '" offers it as well', s.stamp, JSON.stringify(s));
}

// Snapshots must NOT offer it: their snapshot date already supersedes, and a second way to say
// the same thing is how people end up wiping a day they meant to correct.
for (const type of ['expected-today', 'defaulters-current', 'hints', 'logo', 'teams']) {
  const s = await pick(type);
  check('"' + type + '" correctly does NOT offer it', !s.stamp, JSON.stringify(s));
}

// Picking Replace has to say plainly that it deletes first, and mark itself as the dangerous one.
await pick('loans', 'unassigned');
const danger = await page.evaluate(() => {
  document.getElementById('modeReplace').click();
  const b = document.getElementById('modeReplace');
  return { on: b.classList.contains('on'), danger: b.classList.contains('danger'),
           note: document.getElementById('behaviour').textContent,
           appendOff: !document.getElementById('modeAppend').classList.contains('on') };
});
check('Replace selects, turns red, and turns Append off',
  danger.on && danger.danger && danger.appendOff, JSON.stringify(danger));
check('Replace spells out that it deletes that date first, and only that date',
  /removed first/.test(danger.note) && /No other date is touched/.test(danger.note), danger.note.slice(0, 80));

// Switching to a type with no stamp and back must not leave a stale Replace armed on screen.
await pick('expected-today');
const backAgain = await pick('loans', 'unassigned');
check('coming back re-shows the choice, still on Replace as you left it',
  backAgain.stamp && backAgain.replace, JSON.stringify(backAgain));

// And on a data-dated report, Replace must say the days come from the FILE -- not from a date
// the uploader picked. This is the sentence that stops someone redoing the wrong day.
const dataDanger = await pick('received');
check('Replace on Received Payments says the days come from inside the file',
  dataDanger.replace && /days found INSIDE the file/.test(dataDanger.note)
  && /Only the days actually in the file are touched/.test(dataDanger.note),
  dataDanger.note.slice(0, 140));

// And the page must say how old it is, so "am I on the new version" is answerable.
const ver = await page.evaluate(() => document.getElementById('pagever').textContent);
check('the page says how old it is', /Page version: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(ver), ver);

console.log('\nPASS');
ok.forEach(s => console.log('  ok   ' + s));
if (fail.length) { console.log('\nFAIL'); fail.forEach(s => console.log('  FAIL ' + s)); }
if (errs.length) { console.log('\nPAGE ERRORS'); errs.forEach(s => console.log('  ! ' + s)); }
console.log('\n' + ok.length + ' passed, ' + fail.length + ' failed, ' + errs.length + ' page errors');

await browser.close(); srv.close();
process.exit(fail.length || errs.length ? 1 : 0);
