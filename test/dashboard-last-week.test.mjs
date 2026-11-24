/* LAST WEEK'S FIGURE BESIDE EVERY ARROW ON THE DASHBOARD (handbook Part 142) -- the page's side.

     "infront of the (arrow) put the low opacity last week % e.g (arrow) 34% so that i notice if its higher low or the same what
      exactly was of last week ... those (arrows) at dashboard" -- the owner, 24 Nov 2026

   The server sends, beside every difference (d...), the figure of last week it was taken against (lw...), null exactly when the
   difference is null; that side is proved in test/portal.test.mjs (lwHolds, and "last week's own dashboard reads the figure").
   This file RUNS the page's own builders, with the page's own formatters, and holds every arrow on the dashboard to passing
   the figure that belongs to its own difference. The real page in a real browser is tools/browser-checks/
   portal-dashboard-lastweek.mjs.

   The arrows are built from their character codes here, never typed: an invisible or look-alike character in a test is a test
   that passes for the wrong reason. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP = read('public/app.html');
const UP = String.fromCharCode(0x25b2), DN = String.fromCharCode(0x25bc), EQ = String.fromCharCode(0x25ac), TO = String.fromCharCode(0x2192);

/** The text of one function of the page, from its name to its closing brace. */
function fnOf(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' is in the page');
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error('no end of ' + name);
}
// The page's own builders over the page's own formatters: nothing here is a stand-in.
const page = new Function(['money', 'pct', 'pct1', 'trendArrow', 'lwPct_', 'lwCount_', 'headDelta_'].map(n => fnOf(APP, n)).join('\n')
  + '\nreturn { trendArrow, lwPct_, lwCount_, headDelta_ };')();
const text = html => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const faint = html => { const m = /<span class="lw"[^>]*>([^<]*)<\/span>/.exec(html); return m ? m[1] : null; };

test('the arrow, then last week\'s figure, faint: a rise, a fall and a level week', () => {
  const up = page.trendArrow(5, page.lwPct_(34));
  assert.equal(text(up), UP + ' 34%', 'the owner\'s own example');
  assert.equal(faint(up), '34%', 'the figure is the faint one');
  assert.ok(up.indexOf(UP) < up.indexOf('class="lw"'), 'and it comes after the arrow');
  assert.equal(text(page.trendArrow(-5, page.lwPct_(34.4))), DN + ' 34%', 'a fall: whole per cent, as the tile prints its own');
  assert.equal(text(page.trendArrow(0, page.lwPct_(34))), EQ + ' 34%', 'the same as last week: the level mark, and the figure it is level with');
  assert.equal(text(page.trendArrow(100, page.lwPct_(0))), UP + ' 0%', 'a nought last week is a figure, not nothing');
  assert.match(page.lwPct_(34), /title="Wiki iliyopita \/ last week"/, 'and it says what it is to a pointer that rests on it');
});

test('no arrow, no figure: neither is ever drawn alone', () => {
  assert.equal(page.trendArrow(null, page.lwPct_(34)), '', 'no difference: nothing at all, even handed a figure');
  assert.equal(page.trendArrow(undefined, page.lwPct_(34)), '');
  assert.equal(page.lwPct_(null), '', 'no figure of last week: nothing');
  assert.equal(page.lwPct_(undefined), '');
  assert.equal(page.lwCount_(null, 5), '');
  const bare = page.trendArrow(3);
  assert.equal(text(bare), UP, 'an arrow asked for with nothing after it is the arrow, as before');
  assert.doesNotMatch(bare, /class="lw"/);
});

test('one decimal on the Expected Defaulters card, whose rates sit under one per cent', () => {
  assert.equal(faint(page.lwPct_(0.44, true)), '0.4%');
  assert.equal(faint(page.lwPct_(15, true)), '15.0%');
  assert.equal(faint(page.lwPct_(0.44)), '0%', 'whole per cent everywhere else');
});

test('the applications card counts: last week\'s arrivals, then this week\'s', () => {
  assert.equal(faint(page.lwCount_(120, 130)), '120' + TO + '130', 'a day prints both sides: its tile shows the pile still unworked, not the arrivals');
  assert.equal(faint(page.lwCount_(1200, 1310)), '1,200' + TO + '1,310');
  assert.equal(faint(page.lwCount_(0, 3)), '0' + TO + '3', 'nothing arrived that day last week: a nought, not nothing');
  assert.equal(faint(page.lwCount_(741)), '741', 'the card\'s title prints last week\'s, and the difference follows in words');
  assert.equal(text(page.trendArrow(-2, page.lwCount_(5, 3))), DN + ' 5' + TO + '3');
});

test('a card\'s title names the faint figure and prints the difference in brackets', () => {
  assert.equal(text(page.headDelta_(12)), 'wiki iliyopita (+12%)');
  assert.equal(text(page.headDelta_(-5)), 'wiki iliyopita (-5%)');
  assert.equal(text(page.headDelta_(0)), 'wiki iliyopita (0%)');
  assert.equal(text(page.headDelta_(-255, ' maombi')), 'wiki iliyopita (-255 maombi)');
  assert.equal(text(page.headDelta_(0.14, null, true)), 'wiki iliyopita (+0.1%)', 'one decimal where the card\'s rates are that small');
  assert.equal(text(page.headDelta_(-5, null, true)), 'wiki iliyopita (-5.0%)');
  assert.equal(page.headDelta_(null), '', 'no difference: no words');
  assert.equal(text(page.trendArrow(12, page.lwPct_(34)) + page.headDelta_(12)), UP + ' 34% wiki iliyopita (+12%)', 'a title, whole: the arrow, last week\'s figure, its name, the difference');
});

test('EVERY arrow on the dashboard passes the figure of last week that belongs to its own difference', () => {
  assert.equal(APP.split('trendArrow(').length - 1, 19, 'the builder and its eighteen uses');
  const calls = [...APP.matchAll(/trendArrow\(([^,\n]*)\.d(\w+), lw(Pct|Count)_\(\1\.(\w+)/g)];
  assert.equal(calls.length, 18, 'each of the eighteen passes a figure read off the SAME row or answer as its difference');
  for (const m of calls) {
    const [, from, what, kind, field] = m;
    if (what === 'Apps') {
      assert.equal(kind, 'Count', from + ': applications are a count');
      assert.ok(field === 'lwApps' || field === 'appsPrevCount', from + ': a day\'s own lwApps, or the week\'s appsPrevCount; got ' + field);
    } else {
      assert.equal(kind, 'Pct', from + '.d' + what + ' is a percentage');
      assert.equal(field, 'lw' + what, from + '.d' + what + ' is followed by ' + from + '.lw' + what + ', not by another figure');
    }
  }
  const of = what => calls.filter(m => m[2] === what).length;
  assert.deepEqual([of('Sales'), of('Ecol'), of('Col'), of('Rec'), of('Avg'), of('Edr'), of('Apps')], [3, 3, 3, 4, 1, 2, 2],
    'the strip\'s tile, each day\'s tile and the card\'s title (recovery\'s days are drawn in two shapes; the average has a tile only)');
  // a day of the applications card prints both sides; its title, last week's
  assert.ok(APP.includes("trendArrow(x.dApps, lwCount_(x.lwApps, x.arrived))"));
  assert.ok(APP.includes("trendArrow((d.perf||{}).dApps, lwCount_((d.perf||{}).appsPrevCount)) + headDelta_((d.perf||{}).dApps, ' maombi')"));
  // the Expected Defaulters card: one decimal, on its days, its title and its title's difference
  assert.ok(APP.includes("trendArrow(x.dEdr, lwPct_(x.lwEdr, true))"));
  assert.ok(APP.includes("trendArrow((d.edrTrendTotal||{}).dEdr, lwPct_((d.edrTrendTotal||{}).lwEdr, true)) + headDelta_((d.edrTrendTotal||{}).dEdr, null, true)"));
  // and nowhere else is a percentage of last week printed to one decimal
  assert.equal(APP.split(', true))').length - 1 >= 2, true);
});

test('faint, and only where the two builders put it', () => {
  assert.match(APP, /\n\.lw\{opacity:\.6;font-size:\.72em;font-weight:700;white-space:nowrap\}\n\.tcell \.th \.lw,\.card-h \.lw\{font-size:11px\}\n/, 'low opacity, and smaller than the figure it follows');
  assert.equal(APP.split('class="lw"').length - 1, 2, 'the class is written by lwPct_ and lwCount_ and by nothing else');
});

test('the server sends the figure with the difference, and a day that has not come yet has neither', () => {
  const core = read('api/_lib/portal-core.js');
  for (const s of [
    'const dApps = d > realToday ? null : arrived - lwWas;',
    'dApps, arrived, lwApps: dApps != null ? lwWas : null };',
    'const dSales = (d <= realToday && pct != null && prevPct != null) ? Math.round((pct - prevPct) * 10) / 10 : null;',
    'dSales, lwSales: dSales != null ? prevPct : null };',
    'uploaded, pct, dCol, lwCol: dCol != null ? ppct : null };',
    'if (dRec != null) lwRec = ppct;',
    'uploaded, pct, dEcol, lwEcol: dEcol != null ? ppct : null };',
    'const last_ = (a, b) => move_(a, b) == null ? null : b;',
    'lwSales: last_(wkNow.salesPct, wkPrev.salesPct),', 'lwCol: last_(wkNow.colPct, wkPrev.colPct),', 'lwRec: last_(wkNow.recPct, wkPrev.recPct),', 'lwAvg: last_(wkNow.avgPct, wkPrev.avgPct),',
    'perf.lwEcol = perf.dEcol != null ? ecolPctPrev : null;',
    'uploaded, pct, dEdr, lwEdr: dEdr != null ? ppct : null };',
    'return { initial, current, recovered, pct, dEdr, lwEdr: dEdr != null ? ppct : null };',
  ]) assert.equal(core.split(s).length - 1, 1, 'once in the dashboard: ' + s);
  // It is the dashboard's own arithmetic: the upload and the call app know nothing of it.
  for (const f of ['api/upload.js', 'api/call.js', 'api/_lib/call-core.js']) assert.doesNotMatch(read(f), /\blw(Sales|Col|Rec|Avg|Ecol|Edr|Apps)\b/, f + ' is not touched');
});

test('the handbook and CHAT.md record it, in the owner\'s words', () => {
  const h = read('docs/HANDOFF.md'), c = read('CHAT.md');
  assert.match(h, /## Part 142 /);
  assert.match(h, /put the low opacity last week %/);
  assert.match(c, /Part 142/);
  assert.match(c, /put the low opacity last week %/);
  assert.match(c, /lwPct_/);
});
