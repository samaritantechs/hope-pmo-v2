/* Drives the REAL public/mkopo.html in a real browser: the customer's own door into the system.

   A customer types a reference number and sees their own loan. This checks the two things that
   matter most and cannot be checked by reading code: that a person with a bad connection or a
   wrong number is TOLD so in words they can act on, and that nothing which would help somebody
   else -- a phone number, a guarantor, another customer's payment -- is ever painted onto the
   screen, no matter what the server sends.

   Lives OUTSIDE test/ on purpose: `node --test` sweeps that whole directory, so a check that
   needs a browser installed would have made `npm test` fail on any machine without one -- and
   npm test guards the deploy. playwright-core is likewise not in package.json. To run it:

       npm i --no-save playwright-core
       node tools/browser-checks/customer-login.mjs

   CHROME overrides the browser path. Exit code 0 = everything passed. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PAGE = fs.readFileSync(path.join(ROOT, 'public/mkopo.html'), 'utf8');

let mode = 'ok';                    // ok | notfound | verify | dead
const LOAN = {
  ok: true, ref: '12345', name: 'AMINA HAMISI', team: 'KONGOWE', asOf: '2026-08-01',
  loan: { dueSummary: '2/6', installment: 50000, expectedToday: 50000, paidToday: 0,
          statusToday: 'UNPAID', balance: 250000, total: 300000, arrears: 75000,
          disbDate: '2026-06-01', lastPayment: '2026-07-24' },
  behind: true,
  promise: { date: '2026-08-03', amount: 50000 },
  payments: [ { date: '2026-07-24', amount: 50000, receipt: 'TX2' },
              { date: '2026-07-17', amount: 50000, receipt: 'TX1' } ],
};

const srv = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/mkopo')) {
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(PAGE); return;
  }
  if (req.url === '/brand.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(''); return; }
  if (req.url === '/api/call') {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => {
      const { fn, args } = JSON.parse(b || '{}');
      const send = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (fn === 'api_brand') return send({ brand: 'HOPE MICROCREDIT', logo: '' });
      if (fn === 'api_customerLookup') {
        if (mode === 'dead') return;                                  // never answers
        if (mode === 'notfound') return send({ ok: false, error: 'NOT_FOUND' });
        if (mode === 'verify' && String(args[1] || '') !== '0001') return send({ ok: false, error: 'VERIFY_FAILED' });
        return send({ ...LOAN, ref: String(args[0] || '') });
      }
      return send({ ok: true });
    });
    return;
  }
  res.writeHead(404); res.end('');
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 380, height: 720 } });   // a real phone
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !/favicon|404|ERR_/.test(m.text())) errs.push('console: ' + m.text()); });

const ok = [], fail = [];
const check = (n, c, x) => (c ? ok : fail).push(n + (x ? ' -- ' + x : ''));
const type = async (id, v) => page.fill('#' + id, v);
const submit = async () => { await page.click('#go'); await page.waitForTimeout(300); };
const text = () => page.evaluate(() => document.body.innerText);

await page.goto(base + '/mkopo');
await page.waitForTimeout(300);

// --- it opens asking for one thing, and one thing only
check('opens asking for a reference number and nothing else',
  await page.evaluate(() => !!document.getElementById('ref') && !document.getElementById('ver')));

// --- an empty box is refused in words, not ignored
await submit();
check('an empty box says what to do', /Weka namba yako|Enter your reference/.test(await text()));

// --- the loan itself
await type('ref', '12345');
await submit();
const t = await text();
check('the name is shown, so you know it is YOUR loan', t.includes('AMINA HAMISI'), t.slice(0, 60));
check('being behind is the biggest thing on the screen', /You are behind|Umebaki nyuma/.test(t) && t.includes('75,000'));
check('the balance is there', t.includes('250,000'));
check('the installment is there', t.includes('50,000'));
check('a promise already given is shown back', /2026-08-03/.test(t) && /promise|Ahadi/i.test(t));
check('their payments are listed, newest first',
  t.indexOf('2026-07-24') > 0 && t.indexOf('2026-07-24') < t.indexOf('2026-07-17'));
check('the figures say which day they are from', t.includes('2026-08-01'));

// --- THE SECURITY LINE. Even if the server were changed to send these, the page must not be
//     the thing that puts a phone number on screen.
const leaked = await page.evaluate(() => {
  // hand the renderer a reply stuffed with everything it must never show
  renderLoan({ ok: true, ref: '12345', name: 'AMINA HAMISI', team: 'KONGOWE', asOf: '2026-08-01',
    contact: '0712000001', guarantor_name: 'G ONE', guarantor_contact: '0713000001',
    loan: { balance: 1, installment: 1, expectedToday: 1, paidToday: 0, arrears: 0 },
    behind: false, payments: [] });
  return document.body.innerText;
});
check('a phone number is never painted, even if sent', !leaked.includes('0712000001'), leaked.slice(0, 80));
check('a guarantor is never painted, even if sent',
  !leaked.includes('0713000001') && !leaked.includes('G ONE'));

// --- a wrong reference is a sentence, not a stack trace
await page.goto(base + '/mkopo'); await page.waitForTimeout(250);
mode = 'notfound';
await type('ref', '99999'); await submit();
check('a reference nobody has is explained plainly',
  /Hatujapata|No loan found/.test(await text()) && !/\{|undefined|null/.test(await text()));

// --- hardening: the page grows a second box rather than calling the reference wrong
await page.goto(base + '/mkopo'); await page.waitForTimeout(250);
mode = 'verify';
await type('ref', '12345'); await submit();
const asked = await page.evaluate(() => !!document.getElementById('ver'));
check('when 4 digits are required, the page ASKS instead of saying the reference is wrong',
  asked && !/Hatujapata|No loan found/.test(await text()));
if (asked) {
  await type('ver', '9999'); await submit();
  check('wrong digits say so, and keep the reference typed in',
    /hazilingani|do not match/.test(await text())
    && (await page.evaluate(() => document.getElementById('ref').value)) === '12345');
  await type('ver', '0001'); await submit();
  check('the right digits open the loan', (await text()).includes('AMINA HAMISI'));
}

// --- a dead connection must not leave a customer on a spinner for ever
await page.goto(base + '/mkopo'); await page.waitForTimeout(250);
mode = 'dead';
await type('ref', '12345');
await page.click('#go');
await page.waitForTimeout(26000);                     // the page gives up at 25s
check('a dead connection is admitted, not spun on for ever',
  /Mtandao haujibu|network is not answering/.test(await text()));
check('and the button works again afterwards',
  await page.evaluate(() => { const b = document.getElementById('go'); return !!b && !b.disabled; }));
mode = 'ok';

// --- it has to fit a small phone without sideways scrolling
await page.goto(base + '/mkopo'); await page.waitForTimeout(250);
await type('ref', '12345'); await submit();
const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check('nothing hangs off the side of a 380px phone', !wide);

console.log('\nPASS');
ok.forEach(s => console.log('  ok   ' + s));
if (fail.length) { console.log('\nFAIL'); fail.forEach(s => console.log('  FAIL ' + s)); }
if (errs.length) { console.log('\nPAGE ERRORS'); errs.forEach(s => console.log('  ! ' + s)); }
console.log('\n' + ok.length + ' passed, ' + fail.length + ' failed, ' + errs.length + ' page errors');

await browser.close(); srv.close();
process.exit(fail.length || errs.length ? 1 : 0);
