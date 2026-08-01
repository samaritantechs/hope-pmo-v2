/* Drives the REAL public/live.html in a real browser: the screen nobody is holding.

   This one is different from every other page in the system, because nobody is standing in
   front of it. It goes on a monitor in the office or a phone's home screen and is then left
   for days. So the things worth checking are the things that only go wrong when unattended:
   does it come back by itself after the network drops, does it stop asking when nobody is
   looking, and does it ADMIT to being out of date rather than showing yesterday's collection
   as though it were today's.

   Lives OUTSIDE test/ on purpose: `node --test` sweeps that whole directory, so a check that
   needs a browser installed would have made `npm test` fail on any machine without one -- and
   npm test guards the deploy. playwright-core is likewise not in package.json. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/live-widget.mjs

   CHROME overrides the browser path. Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PAGE = fs.readFileSync(path.join(ROOT, 'public/live.html'), 'utf8');

let up = true, asked = 0, col = 0.92;
// 'gateway' reproduces the real failure the field hit: the platform kills a slow function and
// answers with its OWN error page, which is not JSON. The page used to call that "mtandao
// haujibu" -- no signal -- and send everyone looking at the wrong thing entirely.
let mode = 'ok';                                   // ok | gateway | garbage
const feed = () => ({
  ok: true, who: 'ASHA JUMA', scope: 'KONGOWE', brand: 'HOPE MICROCREDIT', logo: '',
  day: '2026-08-01', at: new Date().toISOString(),
  col:      { pct: col,  num: 920000, den: 1000000 },
  kesho:    { pct: 0.44, num: 220000, den: 500000 },
  weekCol:  { pct: 0.71, num: 3550000, den: 5000000 },
  sales:    { pct: 0.35, num: 35000000, den: 100000000 },
  expdf:    { pct: 0.62, num: 620000, den: 1000000 },
  recovery: { pct: 0.88, num: 880000, den: 1000000 },
});

const srv = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/live')) {
    if (req.url.startsWith('/live.webmanifest')) {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
      res.end(fs.readFileSync(path.join(ROOT, 'public/live.webmanifest'))); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return;
  }
  if (req.url === '/api/call') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => {
      const { fn, args } = JSON.parse(b || '{}');
      if (fn !== 'api_widget') { res.writeHead(200, {'Content-Type':'application/json'}); res.end('{"ok":true}'); return; }
      asked++;
      if (!up) { req.socket.destroy(); return; }                       // the network is gone
      if (mode === 'gateway') {
        res.writeHead(504, { 'Content-Type': 'text/html' });
        res.end('<html><body>An error occurred with your deployment</body></html>'); return;
      }
      if (mode === 'garbage') {
        res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('FUNCTION_INVOCATION_FAILED'); return;
      }
      const code = String(args[0] || '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(code === 'BADCODE' ? { ok: false, error: 'BAD_CODE' } : feed()));
    });
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { // 504 and 500 are produced ON PURPOSE below, to reproduce the failure the field hit.
  if (m.type() === 'error' && !/favicon|404|ERR_|Failed to fetch|status of 50[024]/.test(m.text())) errs.push('console: ' + m.text()); });

const ok = [], fail = [];
const check = (n, c, x) => (c ? ok : fail).push(n + (x ? ' -- ' + x : ''));
const text = () => page.evaluate(() => document.body.innerText);
const shown = () => page.evaluate(() => ({
  tiles: document.querySelectorAll('#grid .m').length,
  values: Array.from(document.querySelectorAll('#grid .m .v')).map(e => e.textContent),
  dot: (document.getElementById('dot') || {}).className || '',
  when: (document.getElementById('when') || {}).textContent || '',
}));

// --- 1. it asks for a code once, and explains that it then looks after itself
await page.goto(base + '/live');
await page.waitForTimeout(300);
const first = await text();
check('asks for a code and says it then runs itself',
  /msimbo|code/i.test(first) && /every 2 minutes|Nothing to press/.test(first), first.slice(0, 70));

// --- 2. a code baked into the URL comes straight up, so a wall display survives a power cut
//        with nobody there to type anything
await page.goto(base + '/live?code=LEAD1');
await page.waitForTimeout(500);
let s = await shown();
check('a code in the link starts it with nobody present', s.tiles === 6, JSON.stringify(s));
check('all six numbers are on screen', s.values.join(',') === '92%,44%,71%,35%,62%,88%', s.values.join(','));
check('it says it is live', /live|sasa hivi/.test(s.when) && s.dot.includes('on'), JSON.stringify(s));
check('the scope is named, so nobody misreads whose numbers these are',
  (await text()).includes('KONGOWE'));

// --- 3. NO CUSTOMER DATA on a screen that sits in a corridor
check('no customer names or numbers anywhere on the screen',
  !/AMINA|PILI|07\d{8}/.test(await text()));

// --- 4. it refreshes itself with nobody touching it
const before = asked;
await page.evaluate(() => { EVERY_MS = 700; start(); });     // same loop, faster clock
col = 0.41;
await page.waitForTimeout(1800);
check('it refreshes on its own', asked > before, 'asks went ' + before + ' -> ' + asked);
s = await shown();
check('and the new figure lands without anyone touching it', s.values[0] === '41%', s.values[0]);
check('a bad number turns red so it reads across a room',
  await page.evaluate(() => document.querySelector('#grid .m').classList.contains('low')));

// --- 5. THE ONE THAT MATTERS MOST: the network dies. The numbers must stay, and the screen
//        must stop claiming to be live.
up = false;
await page.evaluate(() => { lastOk = Date.now() - 20 * 60000; markFresh(); });
await page.waitForTimeout(1500);
s = await shown();
check('the last known figures stay on screen when the network dies', s.tiles === 6 && s.values[0] === '41%', JSON.stringify(s));
check('but it stops claiming to be live', !/live|sasa hivi/.test(s.when) && s.dot.includes('stale'), JSON.stringify(s));
check('it never puts a dialog on an unattended screen', !/Imeshindikana|error|Error/.test(await text()));

// --- 6. and it comes back by itself, with nobody there
up = true; col = 0.77;
await page.waitForTimeout(1800);
s = await shown();
check('it recovers on its own when the network returns', s.values[0] === '77%' && s.dot.includes('on'), JSON.stringify(s));

// --- 7. it goes quiet when nobody is looking -- this is what makes it cheap to run all day
//        on every phone in the field
await page.evaluate(() => { EVERY_MS = 300; start(); });
await page.waitForTimeout(700);
// Hide the page and read the counter in the SAME step. Done as two steps, a tick firing in
// the gap between them counts against the hidden period and fails a page that is behaving.
await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
await page.waitForTimeout(120);            // let any request already in flight land
const hiddenFrom = asked;
await page.waitForTimeout(1500);
check('it stops asking while the screen is not being looked at', asked === hiddenFrom,
  'asks while hidden: ' + (asked - hiddenFrom));

// --- 8. a withdrawn code sends somebody back to the box, but only from a cold start
await page.goto(base + '/live?code=BADCODE');
await page.waitForTimeout(600);
check('an unrecognised code says so and asks again',
  /haufahamiki|not recognised/.test(await text()) && (await shown()).tiles === 0);

// --- 8b. THE FAILURE THE FIELD ACTUALLY HIT. The server is cut off part-way and answers with
//          a page that is not JSON. That is not "no signal", and must not say so.
mode = 'gateway';
await page.goto(base + '/live?code=LEAD1');
await page.waitForTimeout(700);
let msg = await text();
check('a server cut off mid-answer says so, and does NOT blame the network',
  /took too long|muda mrefu/.test(msg) && /504/.test(msg) && !/Mtandao haujibu/.test(msg), msg.slice(0, 130));

mode = 'garbage';
await page.goto(base + '/live?code=LEAD1');
await page.waitForTimeout(700);
msg = await text();
check('any other unreadable answer is named as that, with its number',
  /could not read|halieleweki/.test(msg) && /500/.test(msg), msg.slice(0, 130));

// A real loss of signal still says exactly that -- the three causes stay told apart.
mode = 'ok'; up = false;
await page.goto(base + '/live?code=LEAD1');
await page.waitForTimeout(700);
msg = await text();
check('and a genuine loss of signal still says the network is not answering',
  /Mtandao haujibu|network is not answering/.test(msg), msg.slice(0, 130));
up = true;

// --- 9. it must read from across a room on a wide screen, and fit a phone with no sideways scroll
await page.goto(base + '/live?code=LEAD1');
await page.waitForTimeout(500);
check('nothing hangs off the side of a 390px phone',
  !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(300);
const big = await page.evaluate(() => {
  const v = document.querySelector('#grid .m .v');
  return { font: parseFloat(getComputedStyle(v).fontSize),
           cols: getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').length,
           overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
});
check('on a wall screen all six sit in one row', big.cols === 6, 'columns=' + big.cols);
check('and the numbers are big enough to read from the door', big.font >= 60, 'font=' + big.font + 'px');
check('with no sideways scroll there either', !big.overflow);

console.log('\nPASS');
ok.forEach(s => console.log('  ok   ' + s));
if (fail.length) { console.log('\nFAIL'); fail.forEach(s => console.log('  FAIL ' + s)); }
if (errs.length) { console.log('\nPAGE ERRORS'); errs.forEach(s => console.log('  ! ' + s)); }
console.log('\n' + ok.length + ' passed, ' + fail.length + ' failed, ' + errs.length + ' page errors');

await browser.close(); srv.close();
process.exit(fail.length || errs.length ? 1 : 0);
