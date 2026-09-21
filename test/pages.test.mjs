/* THE PAGES MUST PARSE.
 *
 * This file exists because of one afternoon: a comment was pasted over the closing brace of an
 * `if` block in public/app.html, `npm test` stayed green -- every test here exercises the API,
 * and nothing had ever read the front end -- and the portal went out with a page whose script
 * could not be parsed at all. Not a wrong figure on one tab: NOTHING ran. The sign-in box
 * spun forever, and from the outside that looks exactly like a database that has stopped
 * answering, which is where the search went first while the fault sat in a file that had just
 * been deployed.
 *
 * There is no build step in this system -- public/*.html is served exactly as written -- so
 * nothing between the edit and two hundred people stood in the way. This is that missing step,
 * and it is deliberately the cheapest possible one: every inline <script> in every page is
 * handed to the same parser the browser uses, and a page that will not parse fails the suite.
 *
 * It proves only that the page PARSES. It cannot tell you the screen is right. That is worth
 * saying plainly, because the failure it catches is the one that makes every other test's
 * greenness meaningless.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const PUBLIC = new URL('../public/', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'pages-'));

/** Inline scripts only. A <script src=...> is somebody else's file, and a JSON or template
    block is not JavaScript -- feeding either to the parser would fail for the wrong reason. */
function inlineScripts(html) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (type && !/^(text\/javascript|application\/javascript|module)$/i.test(type)) continue;
    out.push({ code: m[2], module: /^module$/i.test(type || '') });
  }
  return out;
}

const pages = readdirSync(PUBLIC).filter(f => f.endsWith('.html')).sort();
assert.ok(pages.length, 'there are pages to check');

for (const page of pages) {
  test(`public/${page}: every inline script parses`, () => {
    const html = readFileSync(join(PUBLIC, page), 'utf8');
    const blocks = inlineScripts(html);
    assert.ok(blocks.length, `${page} has at least one inline script`);
    blocks.forEach((b, i) => {
      const file = join(scratch, `${page}.${i}.${b.module ? 'mjs' : 'js'}`);
      writeFileSync(file, b.code);
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      } catch (e) {
        const why = String((e.stderr && e.stderr.toString()) || e.message)
          .split('\n').slice(0, 6).join('\n');
        assert.fail(`public/${page} script #${i} will not parse -- the whole page is dead in a `
          + `browser, not just this feature:\n${why}`);
      }
    });
  });
}

/* The service worker is served to every phone and decides what they see when offline. A syntax
   error there does not break the page outright, which is worse: it fails silently and the
   caching everybody depends on quietly stops happening. */
test('public/sw.js parses', () => {
  execFileSync(process.execPath, ['--check', join(PUBLIC, 'sw.js')], { stdio: 'pipe' });
});

/* =====================================================================================
   AND TWO RULES OF THE PAGE, RUN RATHER THAN GREPPED FOR.
   =====================================================================================
   Parsing is the cheapest possible guard and it says nothing about behaviour. These two rules
   are worth more than a regex because both are easy to break silently:

     the red line on a count column  -- "those below average in grand total row marked red".
                                       On a percentage column the total row IS the line; on a
                                       column of COUNTS it cannot be, because every team is
                                       below the sum of all teams and the whole table would go
                                       red. The line has to be the average team.
     a board's sortable headers      -- "column headers sortable". The main list has sorted on
                                       its headers since the beginning and the chipped boards
                                       never did.

   The functions are pure -- no DOM, no network -- so they are lifted out of the page and run
   as themselves, against the same stubs the page gives them. */
function liftFromApp(names) {
  const src = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const grab = re => {
    const m = src.match(re);
    assert.ok(m, 'app.html no longer contains ' + re + ' -- the extractor needs updating');
    return m[0];
  };
  const code = [
    'var BOARDS = {}; var S = { targets:{}, cols:[], rows:[] };',
    'function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){'
      + ' return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]; }); }',
    'function isNum(c){ return c.kind==="num"||c.kind==="money"||c.kind==="pct"||c.kind==="dur"; }',
    'function cellHtml(r,c){ var v = c.get?c.get(r):r[c.key]; return esc(v==null?"":v); }',
    'var NAME_KEYS = {}; var AVG_KEYS = ["avgPct"];',
    'function targetOf_(){ return null; }',
    grab(/function colourCtx_\(cols, tot, rows\)\{[\s\S]*?\n\}/),
    grab(/function pctClass_\(r, c, ctx\)\{[\s\S]*?\n\}/),
    grab(/function cellCls_\(r, c, ctx\)\{[\s\S]*?\n\}/),
    grab(/function tableSimple\(rows, cols, totalRow, boardId\)\{[\s\S]*?\n\}/),
    'return {' + names.map(n => n + ': ' + n).join(', ') + ', BOARDS: BOARDS };',
  ].join('\n');
  return new Function(code)();
}

test('a count column goes red below the AVERAGE TEAM, never below the grand total', () => {
  const M = liftFromApp(['colourCtx_', 'cellCls_']);
  // 6, 3 and 0 applications: the average team brought in three.
  const rows = [{ team: 'BUSY', total: 6 }, { team: 'MIDDLE', total: 3 }, { team: 'QUIET', total: 0 }];
  const cols = [{ key: 'team', label: 'Team' },
    { key: 'total', label: 'Total', kind: 'num', meanFloor: true }];
  const ctx = M.colourCtx_(cols, { team: '', total: 9 }, rows);
  assert.equal(ctx.floors.total, 3, 'the line is the mean across the rows, not the 9 in the total row');
  assert.equal(M.cellCls_(rows[0], cols[1], ctx), '', 'above the average team: not red');
  assert.equal(M.cellCls_(rows[1], cols[1], ctx), '', 'exactly on the line: "below" is strict');
  assert.equal(M.cellCls_(rows[2], cols[1], ctx), 'bad', 'below it: red');
});

test('a chipped board draws sortable headers, and the total row is never painted red', () => {
  const M = liftFromApp(['tableSimple']);
  const rows = [{ team: 'BUSY', total: 6 }, { team: 'QUIET', total: 0 }];
  const cols = [{ key: 'team', label: 'Team' },
    { key: 'total', label: 'Total', kind: 'num', meanFloor: true }];
  M.BOARDS.b1 = { rows, cols, sort: 'total', asc: false };
  const html = M.tableSimple(rows, cols, { team: '', total: 6 }, 'b1');
  assert.ok(/data-bsort="team"/.test(html) && /data-bsort="total"/.test(html),
    'every column header must be clickable to sort');
  assert.ok(/data-bid="b1"/.test(html), 'and must say which board it belongs to');
  assert.ok(/>Total ↓</.test(html), 'the sorted column shows its direction');
  // Without a board id nothing is sortable -- boards that never opted in are unchanged.
  assert.equal(/data-bsort/.test(M.tableSimple(rows, cols, null)), false);
  /* THE TOTAL ROW IS NOT A TEAM. Painting it against its own average would put a red figure
     under a column and mean nothing at all. */
  const totrow = html.slice(html.indexOf('totrow'));
  assert.equal(/ bad/.test(totrow), false, 'the JUMLA row carries no red');
});

/* =====================================================================================
   THE UPLOAD SLICES ITSELF DOWN WHEN THE DATABASE IS SLOW.
   =====================================================================================
     "Uploading is running out of time server error so were not obeying the rule"

   Two thousand rows a request was chosen when the database answered normally. It does not:
   the same instance now takes SIXTEEN SECONDS to add three million integers with no table
   behind it. The upload clock on the server can stand the housekeeping down; it cannot make
   the WRITE smaller, because the write is the upload. Only the page can send less.

   Run, not grepped for -- the three properties that matter are all silent when broken:
   every row arrives exactly once, a timed-out slice is re-sent rather than lost or doubled,
   and every slice keeps ONE batch id (twelve batches would be read as a twelfth of the file,
   with every figure quietly too low). */
function liftSlicer() {
  const src = readFileSync(join(PUBLIC, 'upload.html'), 'utf8');
  const grab = re => {
    const m = src.match(re);
    assert.ok(m, 'upload.html no longer contains ' + re + ' -- the extractor needs updating');
    return m[0];
  };
  const code = [
    grab(/var UPLOAD_SLICE_ROWS = \d+;/), grab(/var SLICE_MIN_ROWS = \d+;/),
    grab(/var SLICE_SLOW_MS = \d+;/), grab(/function sliceTimedOut_\(e\)\{[\s\S]*?\n\}/),
    grab(/function sendInSlices_\([\s\S]*?\n\}\n(?=\n)/),
    'return sendInSlices_;',
  ].join('\n');

  /** Drive the slicer against a fake network whose speed and failures we choose. */
  return (rowCount, behave) => {
    const calls = [];
    let now = 0;
    const clock = { now: () => now };
    const fetch = async (url, opt) => {
      const body = JSON.parse(opt.body);
      const n = body.rows.length - 1;                       // every slice carries the header
      const t = behave(n, calls.length);
      now += t.ms;
      calls.push({ n, part: body.part, ok: t.ok });
      return t.ok
        ? { r: { status: 200, body: { ok: true, inserted: n } } }
        : { r: { status: 500, body: { ok: false,
            error: t.error || 'Seva imechukua muda mrefu mno — HTTP 504' } } };
    };
    const send = new Function('fetch', 'readJson_', 'uuid_', 'Date', code)(
      fetch, x => Promise.resolve(x.r), () => 'one-batch-id', clock);
    const rows = [['A', 'B']].concat(Array.from({ length: rowCount }, (_, i) => ['r' + i, i]));
    return send('', 'CODE', 'defaulters-current', {}, rows, null)
      .then(res => ({ calls, body: res.r ? res.r.body : res.body }));
  };
}

test('a healthy database keeps the full slice, and the last part is flagged last', async () => {
  const drive = liftSlicer();
  const { calls, body } = await drive(9000, () => ({ ms: 5000, ok: true }));
  assert.deepEqual(calls.map(c => c.n), [2000, 2000, 2000, 2000, 1000]);
  assert.equal(body.inserted, 9000, 'every row, counted once');
  const last = calls[calls.length - 1].part;
  assert.ok(last.index >= last.total - 1,
    'the server decides isLast from index >= total - 1; a resized plan must still land on it, '
    + 'or the register is never rebuilt and the phones never get the new data stamp');
  assert.equal(new Set(calls.map(c => c.part.id)).size, 1, 'one batch, not five');
});

test('a slow database is answered with smaller slices, and still delivers every row', async () => {
  const drive = liftSlicer();
  const { calls, body } = await drive(9000, () => ({ ms: 32000, ok: true }));
  assert.deepEqual(calls.slice(0, 4).map(c => c.n), [2000, 1000, 500, 250],
    'halving as it goes, rather than after it has already failed');
  assert.equal(calls[calls.length - 1].n <= 250, true, 'and it does not grow back mid-file');
  assert.equal(body.inserted, 9000);
  assert.equal(new Set(calls.map(c => c.part.id)).size, 1);
});

test('a slice that ran out of time is re-sent smaller -- never lost, never doubled', async () => {
  /* A cancelled statement is rolled back whole and a killed function wrote nothing it had not
     already committed, so the rows that slice was carrying are not in the database. Re-sending
     them cannot double anything, and NOT re-sending them would leave a hole in the deck that
     nothing on any screen would ever say was there. */
  const drive = liftSlicer();
  let failures = 0;
  const { calls, body } = await drive(6000,
    (n, i) => (i === 1 && failures++ < 1 ? { ms: 60000, ok: false } : { ms: 5000, ok: true }));
  assert.equal(calls.filter(c => !c.ok).length, 1, 'one slice failed');
  assert.equal(body.inserted, 6000, 'and all six thousand rows still arrived, exactly once');
  assert.equal(new Set(calls.map(c => c.part.id)).size, 1);
});

test('a file small enough for one request is still sent whole, unsliced', async () => {
  const drive = liftSlicer();
  const { calls } = await drive(1500, () => ({ ms: 1000, ok: true }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].part, undefined, 'no part block at all -- the ordinary case is unchanged');
});

test('only a TIMEOUT buys a smaller slice; a bad file fails at once and says why', async () => {
  /* A missing column or a rejected date fails identically at every size. Halving four times
     over would take four times as long to tell somebody what is actually wrong with the file. */
  const drive = liftSlicer();
  let calls = 0;
  await assert.rejects(
    () => drive(6000, () => {
      calls++;
      return { ms: 1000, ok: false, error: 'column "REF#" could not be read in this file' };
    }),
    e => /REF#/.test(String(e.message)));
  assert.equal(calls, 1, 'it did not sit there halving a file the database will never accept');
});

/* =====================================================================================
   TICKING ROWS -- "no bulk tick/selct checkboxes on the left".
   =====================================================================================
   The whole risk in this change is ALIGNMENT. Three separate places grew a cell -- the
   header, every body row, and the JUMLA row -- and if any one of them is missed the table
   skews by a column and every figure sits under the wrong heading. That is a bug somebody
   would act on, so it is pinned here rather than left to be noticed on screen.

   The picking itself is a set of row KEYS, not row positions, which is what lets a tick
   survive a sort or a search. */
function liftTable(names, state) {
  const src = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const grab = re => {
    const m = src.match(re);
    assert.ok(m, 'app.html no longer contains ' + re + ' -- the extractor needs updating');
    return m[0];
  };
  const code = [
    'var S = ' + JSON.stringify(state) + ';',
    'function esc(s){ return String(s==null?"":s).replace(/[&<>"]/g, function(c){'
      + ' return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]; }); }',
    'function isNum(c){ return c.kind==="num"||c.kind==="money"||c.kind==="pct"; }',
    'function cellHtml(r,c){ var v = c.get?c.get(r):r[c.key]; return esc(v==null?"":v); }',
    'function autoTotals(){ return null; }',
    'function colourCtx_(){ return { floors:{}, avgCol:null }; }',
    'function cellCls_(){ return ""; }',
    'function pickPaintCount_(){}',
    grab(/function pickOn_\(\)\{[\s\S]*?\n\}/),
    grab(/function pickKeyOf_\(r\)\{[\s\S]*?\n\}/),
    grab(/function pickHas_\(r\)\{[\s\S]*?\n\}/),
    grab(/function tableHtml\(rows, cols, onRow\)\{[\s\S]*?\n\}/),
    'return {' + names.map(n => n + ': ' + n).join(', ') + '};',
  ].join('\n');
  return new Function(code)();
}

const countTag = (html, tag) => (html.match(new RegExp('<' + tag + '[ >]', 'g')) || []).length;

test('a table without ticks is exactly the table it always was', () => {
  const M = liftTable(['tableHtml'], { pickKey: null, pick: {}, sort: '', asc: false });
  const html = M.tableHtml([{ imei: '1', v: 2 }], [{ key: 'imei', label: 'IMEI' }, { key: 'v', label: 'V' }], null);
  assert.equal(countTag(html, 'th'), 3, 'S/N and the two columns, and no tick column');
  assert.ok(!/data-pick/.test(html), 'nothing about picking reaches a tab that did not ask for it');
});

test('ticking adds ONE cell to the header and to every row, and keeps them level', () => {
  const M = liftTable(['tableHtml'], { pickKey: 'imei', pick: { '351388334583296': true }, sort: '', asc: false });
  const rows = [{ imei: '351388334583295', v: 1 }, { imei: '351388334583296', v: 2 }];
  const cols = [{ key: 'imei', label: 'IMEI' }, { key: 'v', label: 'V' }];
  const html = M.tableHtml(rows, cols, function () {});

  assert.equal(countTag(html, 'th'), 4, 'the tick column, S/N and the two columns');
  const bodyRows = html.split('<tr').filter(x => /data-i=/.test(x));
  assert.equal(bodyRows.length, 2);
  for (const tr of bodyRows) {
    assert.equal(countTag('<tr' + tr.split('</tr>')[0], 'td'), 4, 'every row matches the header, cell for cell');
  }
  // The tick is checked from S, so it survives a re-render after a sort or a search.
  assert.ok(/data-pick="351388334583296"[^>]*checked/.test(html), 'a ticked row comes back ticked');
  assert.ok(/data-pick="351388334583295"(?![^>]*checked)/.test(html), 'and an unticked one does not');
  assert.ok(/data-pickall/.test(html), 'with a master tick in the header');
});

/* ONE COMMAND PER COPY BOX, and the bench cost that says why.
   -------------------------------------------------------------------------------------
   The single-handset token drawer used to hand over two adb commands in one textarea with
   "run them in this order" written above it. A terminal does not read notes. Pasted into
   cmd, the first line runs and the second lands in the type-ahead buffer, where its echo
   interleaves with the first command's output and it never executes:

     ... -e token 1ea6d5bf...com.samaritantechs.hooploanlock/.LockAdmin was already an admin

   No "Broadcasting:", no "Broadcast completed:", no result code -- nothing enrolled, and
   nothing on screen saying so. The operator reads the first command's answer as the answer
   to both. So each command gets its own box and its own button. */
test('the bench is never handed two adb commands in one copy box', () => {
  const src = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  assert.ok(!/\\n'\s*\+\s*'adb /.test(src),
    'a copied block that starts a second adb command on a new line');
  assert.ok(!/adb [^'"\n]*\\n\s*adb /.test(src),
    'two adb commands inside one string literal');
});

/* AND EVERY ENROL BROADCAST CARRIES --include-stopped-packages.
   A freshly installed app sits in Android's STOPPED state and receives no broadcast at all
   without it. `am` then prints "Broadcast completed: result=0" -- no result code, no
   message, nothing in logcat -- which reads exactly like success while nothing happened. */
test('every enrol broadcast the portal writes carries --include-stopped-packages', () => {
  const src = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const casts = src.match(/adb shell am broadcast[^;]*/g) || [];
  assert.ok(casts.length >= 2, 'the batch command and the single-handset one');
  for (const c of casts) {
    assert.ok(c.includes('--include-stopped-packages'),
      'a broadcast without it answers result=0, which reads as success: ' + c.slice(0, 60));
  }
});

/* A SETTING NOBODY CAN FIND IS A SETTING NOBODY HAS.
   -------------------------------------------------------------------------------------
     "I cant see where to edit this 'Simu hii ni mali ya hope...' at locking"

   Every word on the locked screen came from `settings` and always had -- and not one of them
   could be reached. The Settings page lists the rows that EXIST, so a key never written has
   nothing to click, and the only way in was the key/value drawer, which needs the exact
   string typed from memory. The server read five keys the portal never offered.

   So: every key the beat reads for that screen must appear in SETTINGS_GROUPS. Hoop learned
   the same lesson on 27 Aug 2026 and pinned it the same way. */
test('every setting the locked screen reads can be found on the Settings page', () => {
  const core = readFileSync(new URL('../api/_lib/device-core.js', import.meta.url).pathname, 'utf8');
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');

  const block = core.match(/const LOCK_SETTINGS = \[([\s\S]*?)\];/);
  assert.ok(block, 'LOCK_SETTINGS should still be a literal array in device-core.js');
  const keys = [...block[1].matchAll(/'([A-Z0-9_]+)'/g)].map(m => m[1]);
  // 4, since DEVICE_LOCK_REASON was dropped: "DROP THE REASON FILLING AND ITS DATA SINCE
  // THE MESSAGE IS ENOUGH" -- a self-lock's reason line is blank now, on purpose.
  assert.ok(keys.length >= 4, 'expected the lock screen to read several settings, got ' + keys.length);

  const groups = app.slice(app.indexOf('var SETTINGS_GROUPS'), app.indexOf('function settingsGroupCard_'));
  for (const k of keys) {
    assert.ok(groups.includes("key:'" + k + "'"),
      k + ' is read on every beat but cannot be edited anywhere on the Settings page');
  }
});

/* SAME RULE, ONE MORE SETTING: DEVICE_SHIFT_PARTNER.
   Not a LOCK_SETTINGS key -- deviceList reads it, not the beat -- so the guard above never
   sees it. Written by hand rather than folding it into that scanner, because this is the
   only setting of its kind so far and a second scanner earns its keep once there are two. */
test('the shift partner address can be edited on the Settings page', () => {
  const core = readFileSync(new URL('../api/_lib/portal-core.js', import.meta.url).pathname, 'utf8');
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  assert.ok(core.includes("'DEVICE_SHIFT_PARTNER'"), 'deviceList should still read this setting');
  const groups = app.slice(app.indexOf('var SETTINGS_GROUPS'), app.indexOf('function settingsGroupCard_'));
  assert.ok(groups.includes("key:'DEVICE_SHIFT_PARTNER'"),
    'DEVICE_SHIFT_PARTNER is read by the server but cannot be edited anywhere on the Settings page');
});

/* THE ILIYONASIA PICKER MAY ONLY OFFER WHAT THE SERVER WILL ACCEPT.
   -----------------------------------------------------------------------------------
   Reported from the desk with a payment already typed in: report date, team, 500,000,
   a ref and a reason, Hifadhi -- and only then "Chagua aina ya ripoti. / target must be
   one of: expected-initial, expected-current". The two arrears books had retired and the
   server stopped accepting them, but both selects still drew every key of
   ADJ_TARGET_LABELS, so a retired book sat in the list looking live.

   All four books are accepted again, so today the two lists happen to agree -- which is
   exactly when a guard like this stops being checked and starts rotting. It stays because
   the DIRECTION of the dependency is the point: the picker reads the server's `targets`,
   and the list in the page is a fallback for an old server, not a second opinion. Whoever
   withdraws or adds a book next changes ADJ_TARGETS and this test tells them where the
   page's copy of it lives. */
test('the adjustments picker is built from the server\'s live targets, not from the labels', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf('VIEWS.adjust = function'), app.indexOf('VIEWS.abnormal = function'));

  assert.ok(view.includes('d.targets'),
    'the picker should take its options from the server\'s `targets`');
  assert.ok(!/<select id="adjTarget">'\s*\+\s*Object\.keys\(ADJ_TARGET_LABELS\)/.test(view),
    'the NEW adjustment picker must draw the server\'s targets, not every label');
  assert.ok(!/<select id="adjEditTarget">'\s*\+\s*Object\.keys\(ADJ_TARGET_LABELS\)/.test(view),
    'the EDIT picker must not draw every label either');

  /* Every book the server accepts has to be nameable on a row, whatever the picker offers. */
  const labels = app.slice(app.indexOf('var ADJ_TARGET_LABELS'), app.indexOf('var ADJ_COUNT_LABELS'));
  for (const k of ['expected-initial', 'expected-current', 'defaulter-initial', 'defaulter-current']) {
    assert.ok(labels.includes("'" + k + "'"), k + ' must be nameable on a row');
  }

  /* THE SERVER'S LIST AND THE PAGE'S FALLBACK, SIDE BY SIDE. Read ADJ_TARGETS out of
     portal-core.js and require the page to fall back to exactly those keys -- so a book
     added or withdrawn on the server can never leave an old-server fallback naming a
     different set. */
  const core = readFileSync(new URL('../api/_lib/portal-core.js', import.meta.url).pathname, 'utf8');
  const decl = core.match(/const ADJ_TARGETS = \[([^\]]*)\]/);
  assert.ok(decl, 'ADJ_TARGETS should still be a literal list in portal-core.js');
  const served = decl[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepStrictEqual(served,
    ['expected-initial', 'expected-current', 'defaulter-initial', 'defaulter-current'],
    'all four books are accepted -- update the page fallback in the same commit as this list');
  assert.ok(view.includes('[' + served.map(k => "'" + k + "'").join(', ') + ']'),
    'the page should fall back to the same books when an older server sends no targets');
});

/* THE REF FIELD MUST NEVER BE LABELLED OPTIONAL.
   -----------------------------------------------------------------------------------
     "REF no on iliyonasia is not optional. remove (hiari / optional)"
   A row with no ref cannot be attributed to a commission customer -- the register's own
   "no-ref" countState exists to flag exactly that outcome -- so a label reading "hiari /
   optional" told the person typing the opposite of what the register does the moment they
   save without one. This does not reach for the Team field beside it, which is genuinely
   optional (a blank team applies the row to the whole book) and stays labelled that way. */
test('the REF field on the new-adjustment form is never labelled optional', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf('VIEWS.adjust = function'), app.indexOf('VIEWS.abnormal = function'));
  assert.ok(!/id="adjRef"[^>]*>[\s\S]{0,2}<\/div>[\s\S]{0,400}hiari \/ optional/.test(view) &&
    !/REF[^<]*\(hiari \/ optional\)/.test(view),
    'the REF label must not read "hiari / optional" anywhere on the new-adjustment form');
  assert.ok(/id="adjRef"/.test(view), 'the ref input should still exist');
  // The Team field's own "optional" label is untouched by this -- it says a real thing.
  assert.ok(/Timu \/ Team \(hiari \/ optional\)/.test(view),
    'Team stays labelled optional -- a blank team applies the row to the whole book');
});

/* THE RECOVERY-BY-OFFICER SLIDE'S HEADER MUST NAME THE DAY THE FIGURE BESIDE IT ACTUALLY IS.
   -----------------------------------------------------------------------------------
     "am seeing the header saying yesterday on screen here so am confused b/se i know we using
      todays"
   b.recToday (officerBoards, portal-core.js) divides by TODAY's uncollected on every weekday
   and the WEEK's at the weekend -- "everywhere uses jana except only where there is recovery
   officers ... presentation by rec officer". This slide's own label logic was never moved when
   that rule was fixed, so Tuesday through Friday it kept captioning today's own figure
   "Uncollected (yesterday)". There is no "yesterday" case left in it at all now. */
test('the Recovery-by-officer presentation slide never labels today\'s figure "yesterday"', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf('function presSlides'), app.indexOf('function presApply'));
  assert.ok(/recBasis = d\.weekday === 'SAT' \|\| d\.weekday === 'SUN' \? 'week' : 'today'/.test(view),
    'Mon-Fri all read "today", weekend reads "week" -- matching recToday\'s own basis exactly');
  assert.ok(!/recUncolLabel = recBasis === 'week' \? 'Uncollected \(week\)'\s*\n?\s*: recBasis === 'today'/.test(view),
    'no three-way label branch left -- there is no jana case for this slide to fall into');
  assert.equal((view.match(/'Uncollected \(yesterday\)'/g) || []).length, 0,
    'no weekday on this slide reads a jana denominator -- recToday is today\'s, every weekday');
});

/* AND AUTOSORT THAT SLIDE BY WEEKLY REC %, NOT THE AMOUNT.
   -----------------------------------------------------------------------------------
   recBoard (officerBoards, portal-core.js) orders b.recWeek by recovered TZS, right for a
   board someone is paid on -- but on a wall the sum favours whoever holds the biggest book,
   not whoever is doing best at shrinking it. The presentation slide re-sorts its OWN copy of
   the rows by `pct` (the week's Rec %) before slicing to twelve, so the officers a room
   actually wants to see -- the best percentages -- are the ones that survive the cut. */
test('the Recovery-by-officer presentation slide is ranked by weekly Rec %, not the amount', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf('function presSlides'), app.indexOf('function presApply'));
  const recBlock = view.slice(view.indexOf('var recRows ='), view.indexOf('slides.push({ id:\'recovery\''));
  assert.ok(/\.sort\(function\(a, b2\)\{ return \(b2\.pct == null \? -1 : b2\.pct\) - \(a\.pct == null \? -1 : a\.pct\)/.test(recBlock),
    'recRows is sorted descending on .pct (the week\'s Rec %) before the slide slices to 12');
  // recRows.slice(0,12) must run AFTER the sort, not before it -- a sort applied to the
  // already-cut twelve would still be amount-ranked underneath.
  assert.ok(/\.sort\([\s\S]*?\);\s*\n\s*slides\.push/.test(view.slice(view.indexOf('var recRows ='))),
    'the sort must land before the slide is pushed, so the cut to 12 happens on the sorted list');
});

/* A "dt" COLUMN WHOSE VALUE IS ALREADY A NUMBER MUST NOT BE RE-PARSED AS A STRING.
   -----------------------------------------------------------------------------------
     "time stamp is reading as 1789799553103"
   impRow (api/_lib/imprest.js) hands every Imprest timestamp across the wire as epoch-ms --
   already Date.parse()'d server-side, a NUMBER -- so the client can compare them (retiredAt,
   the retirement claim lock) without re-parsing a string on every read. cellText's 'dt' branch
   called Date.parse(v) unconditionally; handed a number, Date.parse stringifies it first and
   fails to read a 13-digit epoch as a date string, so isFinite(t) was false and the raw
   milliseconds printed as-is. Proven by actually running cellText, not just matching source. */
test('a "dt" column already holding a number is read as the timestamp it is, not re-parsed', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const start = app.indexOf('function cellText(r, c){');
  const end = app.indexOf('\nfunction telHref_');
  const src = app.slice(start, end);
  const cellText = new Function('r', 'c', src + '\nreturn cellText(r, c);');

  // A real Imprest requested_at, already converted server-side the way impRow does it.
  const ms = Date.parse('2026-09-19T05:52:33.103Z');
  const out = cellText({ at: ms }, { key: 'at', kind: 'dt' });
  assert.doesNotMatch(out, /^\d{10,}$/, 'never the raw epoch milliseconds on screen');
  assert.equal(out, '2026-09-19 08:52', 'shifted +3h into EAT, exactly like a parsed ISO string would be');

  // The existing string path (comments, complaints, ...) must still work unchanged.
  const strOut = cellText({ at: '2026-09-19T05:52:33Z' }, { key: 'at', kind: 'dt' });
  assert.equal(strOut, out, 'a string and the equivalent already-parsed number read identically');
});

/* THE GM'S DECIDE DRAWER MUST SAY WHETHER THE REQUESTER WAS ACTUALLY EMAILED.
   -----------------------------------------------------------------------------------
     "he's gonna request again now, i hope when gm approves he gets one"
   imprestDecide (api/_lib/imprest.js) already resolves { emailed: { requester }, emailNote }
   -- the same shape the request form's own confirmation already reads (imqSend, further down
   this file) to say "GM ameambiwa kwa email" or the reason it failed. The decide drawer threw
   that answer away and celebrated the DECISION only, so a send that silently failed (most
   often EMAIL_FROM unset in Settings -- see settingsGroupCard_) looked identical to one that
   worked, and the only way anybody found out was the requester asking why nothing arrived. */
test('the GM decide drawer reports whether the requester was actually emailed, not just the decision', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf('function imprestDecideDrawer_'), app.indexOf('/* ---------- RIPOTI YA IMPREST'));
  assert.ok(/srv\('imprestDecide',/.test(view), 'sanity: this is the right function');
  assert.ok(/\.then\(function\(d\)\{/.test(view),
    'the decide response must be captured (d), not discarded, to read d.emailed off it');
  assert.ok(/d\.emailed\s*&&\s*d\.emailed\.requester/.test(view),
    'the toast must actually branch on whether the requester was emailed');
  assert.ok(/d\.emailNote/.test(view), 'and show the reason when it was not');
});

/* AND THE FIELD MOST LIKELY TO BE THE ACTUAL CAUSE IS NOW SOMEWHERE TO SET IT.
   EMAIL_FROM (api/_lib/mail.js) had no Settings field at all -- only the generic "+ Badili
   thamani" raw key editor could touch it -- so the one setting that silently breaks delivery
   to anyone but the Resend account's own address was invisible on the screen that lists every
   other Imprest knob. */
test('EMAIL_FROM has a real Settings field now, explaining the Resend onboarding-sender trap', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf("id:'imprest',"), app.indexOf('function settingsGroupCard_'));
  assert.ok(/key:'EMAIL_FROM'/.test(view), 'EMAIL_FROM is a labelled field in the Imprest settings group');
  assert.ok(/Resend/.test(view), 'the note explains the Resend onboarding-sender restriction, not just the syntax');
});

/* THE ALL-IN-ONE BENCH COMMAND, CHAINED CORRECTLY ON ONE LINE.
   -----------------------------------------------------------------------------------
     "make sure singe cmd works everything"
   `&&` between install and ownership -- no point granting Device Owner to an app that never
   installed. Plain `&`, deliberately NOT `&&`, between ownership and enrol: set-device-owner
   answering "already set" is the SUCCESS case (see the note a few lines above each of these
   in app.html) and can exit non-zero for it, so `&&` there would stop the chain on exactly
   the run that needed nothing more done. Checked in both drawers -- the batch one and the
   single-phone token one build this the same way. */
test('the all-in-one bench command chains install/&&/ownership/&/enrol, in both drawers', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const batch = app.slice(app.indexOf('function devEnrolDrawer_'), app.indexOf('/** THE SHARED VIEW.'));
  const single = app.slice(app.indexOf("$('#devToken').onclick"), app.indexOf("$('#devLock').onclick"));
  for (const [name, view] of [['batch', batch], ['single-phone', single]]) {
    assert.ok(/var all = \([\w.]+ \? install \+ ' && ' : ''\) \+ '\(' \+ own \+ ' & ' \+ run \+ '\)'/.test(view),
      name + ' drawer: && before ownership, plain & before enrol');
    assert.ok(/devCmdBox_\('A', 'Amri moja \/ All-in-one', all,/.test(view),
      name + ' drawer: the all-in-one box is actually offered');
  }
});

/* WHICH CAMERA ANSWERED, CARRIED ALL THE WAY THROUGH.
   -----------------------------------------------------------------------------------
     "We now have a setback officers are using Ai photos so this comes as ronaldo"
   A genuine handset and a virtual-camera app (fed a still image instead of a live feed) both
   satisfy getUserMedia() the same way -- nothing in the page can tell them apart. The one
   thing the browser does hand back is the track's own label, so every capture logs it: the
   overlay reads it off the live stream, and it rides the same path every capture already
   takes (openCameraOverlay_ -> wirePhotoCapture_ -> kycUpload_ -> the server) rather than a
   second one bolted on beside it. */
test('the camera device label is captured and carried through to the upload call', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const overlay = app.slice(app.indexOf('function openCameraOverlay_'), app.indexOf('function wirePhotoCapture_'));
  assert.ok(/stream(?:\s*&&\s*stream\.getVideoTracks)?.*getVideoTracks\(\)\[0\]/.test(overlay),
    'the overlay reads the label off its own live stream, not a fresh getUserMedia call');
  assert.ok(/onCapture\(dataUrl,\s*cameraLabel\)/.test(overlay), 'the label travels out with the capture');

  const wire = app.slice(app.indexOf('function wirePhotoCapture_'), app.indexOf('function wireGpsCapture_'));
  assert.ok(/function\(dataUrl,\s*cameraLabel\)/.test(wire), 'wirePhotoCapture_ receives the label openCameraOverlay_ hands back');
  assert.ok(/kycUpload_\(loanId,\s*kind,\s*dataUrl,\s*cameraLabel\)/.test(wire), 'and passes it on to the upload call');

  const upload = app.slice(app.indexOf('function kycUpload_'), app.indexOf('/* THE SAME CAPTURE FOR BOTH SIGNATURE AND THUMBPRINT'));
  assert.ok(/camera_label:\s*cameraLabel/.test(upload), 'kycUpload_ sends the label to the server');
});

/* THE ANDROID BACK BUTTON MUST CLOSE THE OVERLAY, NOT THE WHOLE APP.
   -----------------------------------------------------------------------------------
     "clicking back from camera goes to hopecalls instead of recovering current customer card"
   The camera overlay is a <div>, not a real page -- MainActivity.onBackPressed only ever asks
   the WebView "is there a previous PAGE" (web.canGoBack()), which knows nothing about a div
   sitting on top of one. Without a history entry of its own, the hardware back button skips
   the overlay entirely and unwinds the WebView's real navigation history instead, dropping
   the customer card underneath. Pushing one entry when the overlay opens, and popping it again
   however the overlay closes, is what gives the back button something of its own to consume
   first. */
test('the camera overlay pushes a history entry so the Android back button closes it, not the app', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const overlay = app.slice(app.indexOf('function openCameraOverlay_'), app.indexOf('function wirePhotoCapture_'));
  assert.ok(/history\.pushState\(/.test(overlay), 'a history entry is pushed when the overlay opens');
  assert.ok(/addEventListener\('popstate',\s*onPop\)/.test(overlay), 'a popstate handler is wired to close the overlay');
  assert.ok(/function onPop\(\)\{[^}]*stop\(\)/.test(overlay), 'popstate actually calls stop(), not just flags something');
  assert.ok(/if \(!poppedBack\)[^]*history\.back\(\)/.test(overlay),
    'closing any other way (Cancel/Capture/error) consumes the pushed entry itself, exactly once');
});

/* FINGERPRINT CAPTURE IS GONE; THE OFFICER'S OWN NAME AND SIGNATURE REPLACE IT AT
   RECOMMENDATION. "Remove the fingerprint capture, only remain with signature and at field
   officer name filling and signature at recommendation." */
test('thumbprint/fingerprint capture no longer exists anywhere in the KYC flow', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  assert.ok(!/lnThumbPad|lnGThumbPad|lnThumbClear|lnGThumbClear/.test(app), 'no thumbprint pad IDs remain');
  assert.ok(!/mode === 'stamp'/.test(app), 'the stamp (thumbprint) drawing mode is gone, not just unused');
  assert.ok(!/Alama ya kidole gumba/.test(app), 'the Swahili thumbprint label is gone');
});

test('the recommendation section captures the officer\'s own name and signature', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf('card-h">5. Team recommendation'), app.indexOf("$('#lnSaveRec').onclick"));
  assert.ok(/id="lnOfficerName"/.test(view), 'an officer name field is offered');
  assert.ok(/captureRowPad_\('Sahihi ya afisa/.test(view), 'an officer signature pad is offered');
  const wire = app.slice(app.indexOf("$('#lnSaveRec').onclick"), app.indexOf("$('#lnSaveGuar').onclick"));
  assert.ok(/officerSigPad/.test(wire), 'the officer signature pad is actually saved');
  assert.ok(/officer_name:\s*\$\('#lnOfficerName'\)\.value\.trim\(\)/.test(wire), 'the officer name field is sent to the server');
  assert.ok(/officer_signature_url:/.test(wire), 'the officer signature path is sent to the server');
});

/* THE CONSENT FORM, WHEN THE MONEY GOES TO SOMEONE ELSE'S NUMBER.
   "The assessments always have a nida form filled for customers who receive money with nos
   that ain't under their registration so there our camera has to take 2 photos, of the doc
   and the 2nd the customer holding it." */
test('personal details offers the two-photo consent form capture for a receiving number that is not the customer\'s own', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const card = app.slice(app.indexOf('card-h">1. Personal details'), app.indexOf('lnSavePersonal'));
  assert.ok(/captureRowPhoto_\('Fomu ya idhini/.test(card), 'the consent-form-document capture is offered');
  assert.ok(/captureRowPhoto_\('Mteja akishikilia fomu/.test(card), 'the customer-holding-the-form capture is offered');
  const wire = app.slice(app.indexOf('var PATHS = {'), app.indexOf("$('#lnSaveRec').onclick"));
  assert.ok(/'other-number-form'/.test(wire), 'the document photo is uploaded as its own kind');
  assert.ok(/'other-number-form-holder'/.test(wire), 'the holder photo is uploaded as its own kind');
  assert.ok(/other_number_form_url:/.test(wire) && /other_number_form_holder_url:/.test(wire),
    'both paths are sent to the server on save');
});

/* "our system photos should have timestamp too" / "our timestamp could capture location and
   user who took it too" -- burned into the picture itself, not left as metadata that does not
   survive the picture leaving this system. GPS is requested the moment the overlay opens (the
   whole time the officer spends framing the shot to resolve in), and must never hold up the
   shutter if it doesn't land in time. */
test('every KYC photo is stamped with the date/time, the officer, and a GPS fix when one lands in time', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const stamp = app.slice(app.indexOf('function stampPhoto_'), app.indexOf('function openCameraOverlay_'));
  assert.ok(/S\.me\s*&&\s*S\.me\.name/.test(stamp), 'the signed-in officer is read into the stamp');
  assert.ok(/geoCoords\s*\?/.test(stamp), 'a GPS fix is included when one is available');
  assert.ok(/fillRect|fillText/.test(stamp), 'the stamp is actually drawn onto the canvas');

  const overlay = app.slice(app.indexOf('function openCameraOverlay_'), app.indexOf('function wirePhotoCapture_'));
  assert.ok(/navigator\.geolocation\.getCurrentPosition\(/.test(overlay), 'a GPS reading is requested when the overlay opens');
  assert.ok(/stampPhoto_\(ctx,\s*c\.width,\s*c\.height,\s*geoCoords\)/.test(overlay),
    'the capture handler actually stamps the frame before it is encoded');
  const shot = overlay.slice(overlay.indexOf('shotBtn.onclick'));
  assert.ok(shot.indexOf('stampPhoto_(') < shot.indexOf('toDataURL('),
    'stamping happens before the image is turned into the data URL that gets uploaded');
});

/* THE NEIGHBOUR'S NUMBER -- WHO TO ASK IF WE CAN'T REACH THE CUSTOMER.
   "add neighbor no at customer service, they ask them who is near when we can't reach you,
   and not the guarantor, so we have alt no and neighbor no" */
test('customer service registration asks for a neighbour\'s phone, distinct from the guarantor', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const form = app.slice(app.indexOf('function lnCsRegisterForm_'), app.indexOf('/* ---------- Manager: assignment'));
  assert.ok(/id="lnNeighborNo"/.test(form), 'a neighbour-phone field is offered at customer service');
  assert.ok(/neighbor_no:\s*\$\('#lnNeighborNo'\)\.value\.trim\(\)/.test(form), 'it is sent to csRegister on submit');
});

/* "the 5 extra guarantors, 3 are (*) compulsory to fill" */
test('the first 3 of the 5 extra guarantor contacts are required before the guarantor section saves', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const card = app.slice(app.indexOf('Wadhamini wa ziada'), app.indexOf("$('#lnSaveGuar').onclick"));
  assert.ok(/req\s*=\s*i\s*<\s*3/.test(card), 'the first 3 of the 5 are marked as the required ones');
  const guarStart = app.indexOf("$('#lnSaveGuar').onclick");
  const wire = app.slice(guarStart, app.indexOf('Promise.all([', guarStart));
  assert.ok(/reqI\s*<\s*3/.test(wire), 'the save handler checks exactly the first 3');
  assert.ok(/return;/.test(wire), 'the save is actually blocked when one of the 3 is missing, not just warned about');
});

/* "For the officers with no hopelock app but allowed location, gm asked, can we track were
   they are by the devices without lockapp ... put their live location link on their rows in
   settings nav system view not call view" */
test('Settings offers a button to the officer-locations screen, with a real maps link per row', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  assert.ok(/id:'officerloc'/.test(app), 'a nav entry exists for the screen (hidden, reached from a button)');
  const settingsView = app.slice(app.indexOf('VIEWS.settings = function'), app.indexOf('VIEWS.officerloc = function'));
  assert.ok(/id="sgOfficerLoc"/.test(settingsView), 'Settings offers a button into it');
  const wire = app.slice(app.indexOf("var sgOfficerLoc = document.getElementById"), app.indexOf("var so = document.getElementById('soToggle')"));
  assert.ok(/go\('officerloc'\)/.test(wire), 'the button actually navigates to the new screen');

  const view = app.slice(app.indexOf('VIEWS.officerloc = function'), app.indexOf('VIEWS.present = function'));
  assert.ok(/srv\('officerLocationsList'\)/.test(view), 'the screen reads the new server function');
  assert.ok(/https:\/\/www\.google\.com\/maps\?q=/.test(view), 'each row gets a real Google Maps link');
  assert.ok(/target="_blank"/.test(view), 'opened as a real link (now safe -- see onCreateWindow in MainActivity.java)');
});

/* RUN-ME-011: business grows from 1 photo to 3 named ones, residence from 1 to 4 each. */
test('business verification offers all three named photos and saves all three', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const card = app.slice(app.indexOf('card-h">2. Business verification'), app.indexOf("$('#lnSaveGuar').onclick"));
  assert.ok(/lnBizPhotoBtn/.test(card) && /lnBizPhoto2Btn/.test(card) && /lnBizPhoto3Btn/.test(card),
    'three distinct capture buttons are offered');
  const wire = app.slice(app.indexOf("$('#lnSaveBusiness').onclick"), app.indexOf("$('#lnSubmitRec').onclick"));
  assert.ok(/business_verify_photo_url:\s*PATHS\.bizPhoto,/.test(wire), 'the first photo is sent');
  assert.ok(/business_verify_photo2_url:\s*PATHS\.bizPhoto2/.test(wire), 'the second photo is sent');
  assert.ok(/business_verify_photo3_url:\s*PATHS\.bizPhoto3/.test(wire), 'the third photo is sent');
});

test('customer and guarantor residence verification each offer and save four photos', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const custCard = app.slice(app.indexOf('card-h">3. Customer residence verification'), app.indexOf('card-h">4. Guarantor'));
  for (const id of ['lnCustResPhotoBtn', 'lnCustResPhoto2Btn', 'lnCustResPhoto3Btn', 'lnCustResPhoto4Btn']) {
    assert.ok(custCard.includes(id), 'customer residence offers ' + id);
  }
  const guarCard = app.slice(app.indexOf('card-h">4. Guarantor'), app.indexOf('Wadhamini wa ziada'));
  for (const id of ['lnGResPhotoBtn', 'lnGResPhoto2Btn', 'lnGResPhoto3Btn', 'lnGResPhoto4Btn']) {
    assert.ok(guarCard.includes(id), 'guarantor residence offers ' + id);
  }
  const resWire = app.slice(app.indexOf("$('#lnSaveResidence').onclick"), app.indexOf("$('#lnSaveBusiness').onclick"));
  for (const key of ['residence_verify_photo_url', 'residence_verify_photo2_url', 'residence_verify_photo3_url', 'residence_verify_photo4_url']) {
    assert.ok(resWire.includes(key + ':'), 'residence save sends ' + key);
  }
  const guarWire = app.slice(app.indexOf("$('#lnSaveGuar').onclick"), app.indexOf("$('#lnSaveResidence').onclick"));
  for (const key of ['residence_verify_photo_url', 'residence_verify_photo2_url', 'residence_verify_photo3_url', 'residence_verify_photo4_url']) {
    assert.ok(guarWire.includes(key + ':'), 'guarantor save sends ' + key);
  }
});

/* "10-photo contract capture + WhatsApp share with autogenerated caption" (RUN-ME-011) */
test('the recommendation stage offers a 10-page contract capture and a WhatsApp share button', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const panel = app.slice(app.indexOf('card-h">5. Team recommendation'), app.indexOf('/* ---------- ID type'));
  assert.ok(/id="lnContractAddBtn"/.test(panel), 'a page-add button is offered');
  assert.ok(/id="lnContractWaBtn"/.test(panel), 'a WhatsApp share button is offered');
  assert.ok(/id="lnContractCount"/.test(panel), 'a running count out of 10 is shown');

  assert.ok(/kycUpload_\(loan\.id,\s*'contract'/.test(app.slice(app.indexOf("$('#lnContractAddBtn').onclick"), app.indexOf("$('#lnContractWaBtn').onclick"))),
    'each captured page uploads with kind contract');
  const waStart = app.indexOf("$('#lnContractWaBtn').onclick");
  const waWire = app.slice(waStart, app.indexOf("$('#lnSavePersonal').onclick", waStart));
  assert.ok(/wa\.me\/\?text=/.test(waWire), 'the share button opens a wa.me link');
  assert.ok(/window\.open\(/.test(waWire), 'it actually opens the link (window.open, now safe -- see onCreateWindow)');
});

/* "horizontal (not vertical) assessment stage switcher with business as 2nd stage" and
   "sticky customer card header while scrolling" */
test('the assessment drawer has a sticky horizontal stage switcher, business as the 2nd stage', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const drawerCall = app.slice(app.indexOf('function lnTeamAssessForm_'), app.indexOf('// ---- ID type'));
  assert.ok(/class="ln-sticky"/.test(drawerCall), 'the header + switcher are in the sticky box');
  assert.ok(/class="ln-stagebar"/.test(drawerCall), 'a horizontal stage bar is rendered');
  const order = ['personal', 'business', 'residence', 'guarantor', 'recommendation']
    .map(s => drawerCall.indexOf("data-stage=\"" + s + "\""));
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], 'stages render personal, business, residence, guarantor, recommendation in order');
  assert.equal(order.indexOf(order[1]), 1, 'business is the 2nd stage');

  const css = app.slice(app.indexOf('/* THE ASSESSMENT DRAWER'), app.indexOf('.ln-dots{'));
  assert.ok(/position:sticky/.test(css), 'the header is actually pinned with position:sticky, not just styled to look like it');

  const wire = app.slice(app.indexOf("querySelectorAll('.ln-stage-btn')"), app.indexOf('// ---- NIDA/phone'));
  assert.ok(/classList\.toggle\('on'/.test(wire), 'clicking a stage tab actually shows its panel');
});

/* "NIDA/phone number progress-dot input" -- digits shown as a count, never masked. */
test('NIDA and phone fields in the assessment drawer show a digit-progress-dot row', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const dotsFn = app.slice(app.indexOf('function wireDigitDots_'), app.indexOf('function lnReasonPrompt_'));
  assert.ok(/\.match\(\/\\d\/g\)/.test(dotsFn), 'only digits are counted, not every character typed');
  assert.ok(!/type\s*=\s*.password/.test(dotsFn), 'the input itself is never masked -- it only reports a count');

  const wire = app.slice(app.indexOf('function lnTeamAssessForm_'), app.indexOf('function lnSeniorView_'));
  assert.ok(/wireDigitDots_\('lnIdNo'/.test(wire), 'the NIDA field is wired');
  assert.ok(/wireDigitDots_\('lnGPhone'/.test(wire), 'the guarantor phone field is wired');
  assert.ok(/wireDigitDots_\('lnMobileAlt'/.test(wire), 'the alternate phone field is wired');
});

/* "call verification tick at approval tied to min-seconds threshold from the approver's own
   call-sync login" */
test('the credit approval drawer shows a call-verification tick read from the server, not a checkbox', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const fn = app.slice(app.indexOf('function lnCreditForm_'), app.indexOf('function lnDisburseForm_'));
  assert.ok(/id="lnCallVerify"/.test(fn), 'a place to show the result is offered');
  assert.ok(/srv\('creditCallCheck'/.test(fn), 'it reads the server-side check');
  assert.ok(/r\.verified/.test(fn), 'the result actually drives what is shown');
  assert.ok(!/type="checkbox"[^>]*lnCallVerify|id="lnCallVerify"[^>]*type="checkbox"/.test(fn),
    'it is not a box anyone could just tick');
});

/* "a new Assessment Plan nav, team-pivoted, only future dates editable, autodelete after 30
   days, autodelete once a matching approved loan appears, dropdown stale-reason comments, an
   ED/elapsed-days column" */
test('the Assessment Plan screen is a real nav entry that reads and writes the new server functions', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  assert.ok(/id:'ln_assess_plan'/.test(app), 'a NAV_LOAN entry exists');

  const view = app.slice(app.indexOf('VIEWS.ln_assess_plan = function'), app.indexOf('function todayKey_'));
  assert.ok(/srv\('assessmentPlanList'/.test(view), 'the list reads the new server function');
  assert.ok(/elapsedDays/.test(view), 'the ED column is shown');
  assert.ok(/min="'\s*\+\s*esc\(todayKey_\(\)\)/.test(view), 'the add form\'s own date input refuses a past date');

  const addWire = app.slice(app.indexOf('function wireLnAssessPlan_'), app.indexOf('function lnAssessPlanForm_'));
  assert.ok(/assessmentPlanSave/.test(addWire), 'adding a plan calls assessmentPlanSave');

  const form = app.slice(app.indexOf('function lnAssessPlanForm_'), app.indexOf('function busy_'));
  assert.ok(/locked\s*=\s*row\.planned_date\s*<\s*todayKey_\(\)/.test(form), 'past-dated rows are locked client-side too');
  assert.ok(/lnPlanEditReason/.test(form), 'the stale-reason dropdown is offered');
  assert.ok(/assessmentPlanDelete/.test(form), 'a plan can be deleted from the drawer');
});

/* "Users with multiple teams should also be able to create assessment plan ... they get their
   granted teams at access codes as we always pivot" */
test('the Assessment Plan screen pivots by granted team and lets a multi-team code pick one on add and edit', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf('VIEWS.ln_assess_plan = function'), app.indexOf('function todayKey_'));
  assert.ok(/srv\('assessmentPlanList',\s*\{\s*team:\s*S\.args\.team/.test(view), 'the list is asked for the pivoted team');
  assert.ok(/<select data-arg="team">/.test(view), 'the bar carries the team pivot (auto-wired like every other data-arg)');
  assert.ok(/id="lnPlanTeam"/.test(view), 'the add form offers a team picker');
  assert.ok(/LN_PLAN_TEAMS_\.length\s*>\s*1/.test(view), 'both appear only when there is more than one team to choose from');
  const addWire = app.slice(app.indexOf('function wireLnAssessPlan_'), app.indexOf('function lnAssessPlanForm_'));
  assert.ok(/team:\s*teamSel\s*\?\s*teamSel\.value/.test(addWire), 'the picked team is sent on add');
  const form = app.slice(app.indexOf('function lnAssessPlanForm_'), app.indexOf('function busy_'));
  assert.ok(/id="lnPlanEditTeam"/.test(form), 'the edit drawer offers the team picker on a future-dated plan');
  assert.ok(/fields\.team\s*=\s*editTeam\s*\?\s*editTeam\.value\s*:\s*row\.team/.test(form), 'and sends it, falling back to the row\'s own team');
});

/* "Importing payment at finance always require transaction ID too" */
test('the finance payment import asks for TRANS_NO and stops on a line without one before sending', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const form = app.slice(app.indexOf('function lnImportPaymentsForm_'), app.indexOf("lnAct('financeImportPayments'"));
  assert.ok(/REF, AMOUNT, TRANS_NO, PAID_BY/.test(form), 'the paste format names the transaction column');
  assert.ok(/trans_no:\s*p\[2\]/.test(form), 'the third column is sent as trans_no');
  assert.ok(/if \(p\[0\] && !p\[2\]\) missing\.push/.test(form), 'a line with a ref but no transaction ID is collected');
  assert.ok(/if \(missing\.length\)[\s\S]*return;/.test(form), 'and the import is stopped, not sent with the gap');
});

/* A BUTTON THAT DOES NOTHING IS WORSE THAN NO BUTTON.

   "+ New team" on Teams & Staff was drawn for every admin and wired to nothing -- the drawer
   knew how to make a team, no click ever opened it that way, and nobody could tell from the
   screen. Nothing here read the front end for that shape, so it sat there through many
   releases. This is the check: every <button id="x"> the page can draw has to be looked up by
   that id somewhere in the same file. A handler that is never attached is the exact failure
   mode "the button does nothing" describes, and it is the cheapest thing in the world to test.
   (Buttons without an id are wired by class or data-attribute and are not this test's job.) */
test('every button app.html draws with an id is looked up by that id somewhere in the file', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const drawn = new Set([...app.matchAll(/<button[^>]*\bid="([A-Za-z0-9_-]+)"/g)].map(m => m[1]));
  assert.ok(drawn.size > 100, 'the page draws its buttons with ids (' + drawn.size + ' found)');
  const unwired = [...drawn].filter(id => {
    const looked = new RegExp("getElementById\\(\\s*'" + id + "'\\s*\\)|\\$\\(\\s*'#" + id + "'\\s*\\)|querySelector\\(\\s*'#" + id + "\\b");
    return !looked.test(app);
  });
  assert.deepEqual(unwired, [], 'buttons drawn with an id nothing ever wires: ' + unwired.join(', '));
});

/* And the mirror: wiring left behind after its card was removed. The follow-up clean, rebuild
   register and duplicate-sweep cards were taken out of Settings on purpose (see api/upload.js)
   and their click handlers stayed for months, looking up ids no screen draws. Harmless to the
   user, but every dead lookup is one more place a reader has to check before trusting that a
   feature exists. Dynamic ids (built with + at render time) are excused by prefix. */
test('every id app.html looks up with getElementById is one some screen can draw', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const rendered = new Set([...app.matchAll(/\bid=(?:"|'|\\")?([A-Za-z0-9_-]+)/g)].map(m => m[1]));
  const dynPrefix = [...app.matchAll(/id="([A-Za-z0-9_-]+)'\s*\+/g)].map(m => m[1]);
  const looked = new Set([...app.matchAll(/getElementById\(\s*'([A-Za-z0-9_-]+)'\s*\)/g)].map(m => m[1]));
  /* An id handed to a helper (kpi(..., 'presCount') draws id="presCount" and id="presCountS")
     or assigned in code (f.id = 'printFrame') is drawable too: it appears as a quoted string
     somewhere OTHER than the lookup itself. */
  const quotedElsewhere = id => {
    const all = app.split("'" + id + "'").length - 1;
    const asLookup = (app.match(new RegExp("getElementById\\(\\s*'" + id + "'\\s*\\)", 'g')) || []).length;
    return all > asLookup;
  };
  const orphan = [...looked].filter(id => !rendered.has(id)
    && !dynPrefix.some(p => id.startsWith(p))
    && !quotedElsewhere(id) && !(id.endsWith('S') && quotedElsewhere(id.slice(0, -1))));
  assert.deepEqual(orphan, [], 'ids looked up that no screen draws: ' + orphan.join(', '));
});

/* Reversals is three parties, and the screen only offers each of them their own half.
   Credit files the request (the server gates reversalRequest on `credit`); finance and the GM
   sign. Drawn for finance and gm only, a credit analyst could not reach the screen at all, and
   a finance user who chose "request one" was refused by the server after typing the reason. */
test('the Reversals nav admits credit, and the screen offers each tab only its own half', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  assert.ok(/id:'ln_reversals',[^\n]*tab:\['finance','gm','loan_credit'\]/.test(app), 'loan_credit is on the nav gate');
  const view = app.slice(app.indexOf('VIEWS.ln_reversals'), app.indexOf('/* ---------- GM: carriers'));
  assert.ok(/var canAsk = lnHolds_\('loan_credit'\)/.test(view), 'the request scope hinges on holding loan_credit');
  assert.ok(/\(canAsk \? '<option value="eligible"/.test(view), 'and the "request one" option is only drawn for them');
  assert.ok(/var financePending = finTurn && lnHolds_\('finance'\)/.test(view), 'finance buttons need the finance tab');
  assert.ok(/var gmTurn = gmChain && lnHolds_\('gm'\)/.test(view), 'GM buttons need the gm tab');
  assert.ok(/Waiting for finance to sign|Waiting for the GM to sign/.test(view), 'everyone else is told whose signature it waits for');
});

/* "Hope loan tabs are misbehaving, appearing to roles i havent ticked for."
   Two leaks, both closed here. (1) `credit` was one word for HOPE PMO's Credit Analysts and
   HOPE Loan's Credit · Approval, so a PMO credit role was handed the HOPE Loan section. No
   HOPE Loan tab word may equal a HOPE PMO nav id or tab. (2) The role editor listed the
   HOPE Loan words in one flat run with the PMO ones, so `gmo` or `manager` got ticked for a
   role by that name. The editor now draws HOPE Loan's under their own heading. */
test('no HOPE Loan tab word is also a HOPE PMO tab, and the role editor keeps the two apart', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const navBlock = app.slice(app.indexOf('var NAV = ['), app.indexOf('var NAV_LOAN = ['));
  const loanBlock = app.slice(app.indexOf('var NAV_LOAN = ['), app.indexOf('];', app.indexOf('var NAV_LOAN = [')));
  const pmoWords = new Set([...navBlock.matchAll(/\bid:'([a-z_]+)'/g)].map(m => m[1])
    .concat([...navBlock.matchAll(/\btab:'([a-z_]+)'/g)].map(m => m[1])));
  const loanWords = new Set([...loanBlock.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).filter(w => !w.startsWith('ln_')));
  const shared = [...loanWords].filter(w => pmoWords.has(w));
  assert.deepEqual(shared, [], 'a word that opens both systems: ' + shared.join(', '));
  assert.ok(loanWords.has('loan_credit') && !loanWords.has('credit'), 'HOPE Loan credit is loan_credit');
  const form = app.slice(app.indexOf('function roleForm('), app.indexOf('function teamForm('));
  assert.ok(/Tabs — HOPE PMO/.test(form) && /Tabs — HOPE Loan/.test(form), 'two headed lists');
  assert.ok(/all\.filter\(function\(t\)\{ return !isLoanTab_\(t\); \}\)/.test(form), 'PMO words in the first');
  assert.ok(/all\.filter\(isLoanTab_\)/.test(form), 'HOPE Loan words in the second');
});

/* "allow the pre-fillable info of loan recommendation at assessment plan and saving only -
   submitting will only happen at recommendation ... if assigned no = assessment plan number,
   merge both for the single customer into recommendation" -- the ONE recommendation form
   serves both owners; a plan drafts on itself, photos land under the plan, and Assign says
   what became of a matching plan. */
test('the recommendation form drafts on an Assessment Plan, and the plan drawer opens it', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const form = app.slice(app.indexOf('function lnTeamAssessForm_(loanRow, planRow)'), app.indexOf('/* ---------- GMO / OPM senior review'));
  assert.ok(form.length > 1000, 'the form takes a plan row as its second owner');
  assert.ok(/lnActKeep_\('assessmentPlanDraftSave', \{ id: planRow\.id, section: section, fields: fields \}/.test(form), 'plan mode saves the draft on the plan');
  assert.ok(/lnActKeep_\('teamAssessmentSave', \{ loan_id: loan\.id, section: section, fields: fields \}/.test(form), 'loan mode saves the recommendation as before');
  assert.equal((form.match(/saveSection_\('(personal|business|residence|guarantor|recommendation)'/g) || []).length, 5, 'all five sections go through the one router');
  assert.ok(!/lnActKeep_\('teamAssessmentSave', \{ loan_id: loan\.id, section: '/.test(form), 'no section save bypasses it');
  assert.ok(/if \(planMode\) return;\s*\n\s*\$\('#lnSubmitRec'\)/.test(form), 'submit and reject are never wired on a plan');
  assert.ok(/planMode\s*\?\s*'<div class="note"[^]*?Submit live at Team/.test(form), 'and the contract/copy/submit block is replaced by a note on a plan');
  const up = app.slice(app.indexOf('function kycUpload_('), app.indexOf('function wireCanvasPad_('));
  assert.ok(/\^plan:\(\.\+\)\$/.test(up) && /plan_id: pm\[1\]/.test(up), 'a plan: id in the loan slot uploads under the plan');
  const planForm = app.slice(app.indexOf('function lnAssessPlanForm_('), app.indexOf('function busy_('));
  assert.ok(/id="lnPlanFillBtn"/.test(planForm) && /lnTeamAssessForm_\(null, row\)/.test(planForm), 'the plan drawer opens the form in plan mode');
  assert.ok(/row\.assignedRef/.test(planForm) && /Team &middot; Recommendation/.test(planForm), 'an already-assigned customer is pointed at the recommendation instead');
  const view = app.slice(app.indexOf('VIEWS.ln_assess_plan'), app.indexOf('function todayKey_'));
  assert.ok(/draftSections/.test(view) && /assignedRef/.test(view), 'the list shows draft progress and assignment');
  const assign = app.slice(app.indexOf("lnAct('managerAssign'"), app.indexOf("lnAct('managerAssign'") + 900);
  assert.ok(/r\.planMerged/.test(assign) && /bad: true/.test(assign), 'Assign reports the merge, and a failed merge in red');
});

/* "When a picture is captured show captured label to know it's temporary there.. if in a saved
   section show saved ✓" -- a capture uploads at once but only lands on the record when its
   section is saved, so the label says which of the two it is. */
test('a fresh capture reads "not saved yet" and turns to "Saved ✓" only when its section save succeeds', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const photo = app.slice(app.indexOf('function wirePhotoCapture_('), app.indexOf('function wireGpsCapture_('));
  assert.ok(/CAPTURE_PENDING_ = '[^']*bado haijahifadhiwa[^']*not saved yet'/.test(app), 'the pending wording says it is temporary');
  assert.ok(/CAPTURE_SAVED_ = '✓ Imehifadhiwa \/ Saved'/.test(app), 'the saved wording carries the tick');
  assert.ok(/onPath\(r\.path\); markCapturePending_\(status\)/.test(photo), 'a successful upload marks the capture pending, not saved');
  assert.ok(/setStatus\(!!existingPath\)/.test(photo) && /has \? CAPTURE_SAVED_ : ''/.test(photo), 'a capture already on the record opens as Saved');
  const gps = app.slice(app.indexOf('function wireGpsCapture_('), app.indexOf('function captureRowPhoto_('));
  assert.ok(/markCapturePending_\(status\)/.test(gps), 'a fresh pinpoint is pending the same way');
  const form = app.slice(app.indexOf('function lnTeamAssessForm_(loanRow, planRow)'), app.indexOf('/* ---------- GMO / OPM senior review'));
  assert.ok(/return p\.then\(function\(r\)\{ markSectionSaved_\(section\); return r; \}\)/.test(form), 'the section router flips them to Saved only after the server said yes');
  assert.ok(/function markSectionSaved_\(section\)\{\s*document\.querySelectorAll\('\.ln-stage-panel\[data-stage="' \+ section \+ '"\] \[data-capture-pending\]'\)/.test(app), 'and only the captures inside that section\'s panel');
});

/* "Clicking back at customer card in loan recommendation goes to hope calls instead of returning
   to tab as close does., treat that and any card that behaves so too in the system interface"
   The WebView's Back only knows pages; every layer drawn on top of one has to give it an entry
   to pop. One helper, used by the drawer, the presentation and the phone menu (the camera
   overlay had its own already). */
test('the drawer, the presentation and the phone menu each give the Back button an entry to pop, and close on it', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const helper = app.slice(app.indexOf('var BACK_LAYERS_ = []'), app.indexOf('function drawer(html)'));
  assert.ok(/history\.pushState\(\{ hopeLayer: name \}/.test(helper), 'opening a layer pushes one tagged entry');
  assert.ok(/if \(BACK_LAYERS_\.indexOf\(name\) >= 0\) return;/.test(helper), 'once, however often the layer redraws while open');
  assert.ok(/if \(!BACK_POPPING_\) \{ try \{ history\.back\(\); \}/.test(helper), 'closing by button consumes the entry it pushed');
  assert.ok(/addEventListener\('popstate'/.test(helper) && /BACK_CLOSERS_\[top\]\(\)/.test(helper), 'Back closes the top layer');
  assert.ok(/e\.state\.hopeLayer === top \|\| e\.state\.hopeCam/.test(helper), 'a pop that lands on our own entry (the camera above us closing) is left alone');
  const drawer = app.slice(app.indexOf('function drawer(html)'), app.indexOf("$('#drawerBg').onclick"));
  assert.ok(/backLayerOpen_\('drawer'\)/.test(drawer) && /backLayerClose_\('drawer'\)/.test(drawer), 'the drawer is a layer');
  const pres = app.slice(app.indexOf('function presStart('), app.indexOf('function presDraw('));
  assert.ok(/backLayerOpen_\('pres'\)/.test(pres) && /backLayerClose_\('pres'\)/.test(pres), 'the presentation is a layer');
  assert.ok(/function navOpen_\(\)\{[^}]*backLayerOpen_\('nav'\)/.test(app) && /function navClose_\(\)\{[^}]*backLayerClose_\('nav'\)/.test(app), 'the phone menu is a layer');
  const direct = (app.match(/classList\.(remove|toggle|add)\('navopen'\)/g) || []).length;
  assert.equal(direct, 2, 'the navopen class is touched only inside navOpen_/navClose_ -- nowhere else, or an entry is left behind');
});
