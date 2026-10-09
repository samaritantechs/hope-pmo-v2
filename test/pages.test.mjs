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

/* THE COLLECTION SLIDE'S CAPTION -- "add a caption below of unassigned teams, ill need to
   always notice them from there. so the only slide with unassigned teams caption is of
   collection". */
test('only the PMO collection slide carries the unassigned-teams caption, drawn under its total', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf('function presSlides'), app.indexOf('function presApply'));
  /* Two captions on the deck: the unassigned-teams one here, and the early slide's own note
     that Count 1 is not available until db/RUN-ME-038 is run (a step not done is said on the
     screen that expected it). The UNASSIGNED caption is still the collection slide's alone. */
  assert.equal((view.match(/caption:/g) || []).length, 2, 'two slides with a caption');
  assert.equal((view.match(/Unassigned:/g) || []).length, 1, 'the unassigned-teams caption is on one slide only');
  const pmo = view.slice(view.indexOf("id:'pmo'"), view.indexOf("id:'dayprog'"));
  assert.ok(/caption: '<div class="pcaph">Unassigned:<\/div>' \+ uaLine\('Early col', ua\.early\) \+ uaLine\('Col', ua\.col\) \+ uaLine\('Rec', ua\.rec\)/.test(pmo));
  assert.ok(/b\.unassignedTeams/.test(view), 'fed by officerBoards');
  const draw = app.slice(app.indexOf('function presDraw'), app.indexOf('function presProgGroup_'));
  assert.ok(/<\/tbody><\/table><\/div>';\s*\n\s*\/\/[^\n]*\n\s*if \(s\.caption\) body \+= '<div class="pcap">'/.test(draw),
    'drawn after the table and its total row');
});

/* THE JPG'S SCALE IS A SLOPE, NOT A CLIFF -- "The image quality has suddenly decreased into
   blurred.. I got a list of approximately 100 teams". saveJpg used to fall from 2x straight
   to 1x when the drawing would not fit at 2x; it now takes the largest scale the canvas budget
   allows, so a picture that cannot have 2x still gets 1.7x rather than 1x. */
test('the JPG export takes the largest scale the canvas budget allows, never a cliff to 1x', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const fn = app.slice(app.indexOf('function inkBox_'), app.indexOf("img.src = 'data:image/svg+xml"));
  assert.ok(/var sc = Math\.max\(1, Math\.min\(JPG_SCALE, 8000 \/ GW, 20000 \/ GH\)\);/.test(fn),
    'the scale is the budget divided by the drawing, capped at JPG_SCALE and floored at 1');
  assert.ok(!/\? JPG_SCALE : 1;/.test(fn), 'the two-value cliff is gone');
  // The arithmetic itself, as the browser will run it: a drawing that fits 2x gets 2x; one
  // that is 1.2x too wide for 2x gets ~1.66x, not 1x; one that is far too big gets exactly 1x.
  const scaleFor = (GW, GH) => { let sc = Math.max(1, Math.min(2, 8000 / GW, 20000 / GH)); return Math.floor(sc * 100) / 100; };
  assert.equal(scaleFor(3000, 6000), 2);
  assert.equal(scaleFor(4800, 6000), 1.66);
  assert.equal(scaleFor(3000, 30000), 1);
});

/* THE DASHBOARD ORODHA OPENS WITH THE OPM -- "add OPM column between S/N and team name". The
   S/N is the table engine's own first column, so OPM is the first declared one, then Team. */
test('the dashboard Orodha names the OPM before the team', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const dash = app.slice(app.indexOf('VIEWS.dashboard = function'), app.indexOf('THE MONTH REPORT --'));
  assert.ok(/S\.cols = \[[\s\S]*?ttl\(col\('opm','OPM'\)[^\n]*\),\s*\n\s*col\('team','Team'\),/.test(dash),
    'OPM is the first declared column, Team the second');
  assert.ok(/NAME_KEYS = \{[^}]*\bopm:1/.test(app), 'and OPM is a name cell, so it reddens with the team under the line');
});

/* THE THREE UNIT SLIDES SAY WHO IS LEFT, HOW MANY TEAMS, AND EVERY OFFICER'S CALLS.
   "put nos of remaining ... between teams and uncollected", "No of teams between officer and
   initial on recovery slide", "list all officers in the 3 units and format red the least actives". */
test('the early, recovery and calls slides carry the remaining count, the team count and every officer', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf('function presSlides'), app.indexOf('function presApply'));
  const early = view.slice(view.indexOf("id:'early'"), view.indexOf("id:'pmo'"));
  /* And Count 1 between the two -- "Btn remaining and customers columns in early collection pmo
     slide add Count1 (to show the remaining count DS 1 among the all left ones)". */
  assert.ok(/col\('teams','Teams','num'\),\s*\n?\s*col\('remaining','Wamebaki \/ Left','num'\), col\('count1','Count 1 \(DS 1\)','num'\), col\('customers','Wateja \/ Customers','num'\),\s*\n?\s*col\('uncollected','Uncollected \(kesho\)','money'\)/.test(early),
    'remaining, Count 1 and customers sit between Teams and Uncollected on the early slide');
  assert.ok(/x\.count1 == null/.test(early) && /RUN-ME-038/.test(early),
    'a slide with no Count 1 figure says which file to run, rather than printing nought');
  const rec = view.slice(view.indexOf("id:'recovery'"), view.indexOf("id:'early'"));
  assert.ok(/col\('officer','Officer'\), col\('teams','Teams','num'\),\s*\n?\s*col\('initial','Initial','money'\)/.test(rec),
    'the team count sits between Officer and Initial on the recovery slide');
  const calls = view.slice(view.indexOf('var callRows'), view.indexOf("id:'credit'"));
  assert.ok(/rows: callRows,/.test(calls), 'the calls slide lists every officer of the pool, not six at each end');
  assert.ok(!/callTop\.concat\(callLow\)/.test(view), 'the old twelve-row cut is gone');
  assert.ok(/i >= callPool\.length - 6 \|\| !\(Number\(x\.calls\) \|\| 0\)/.test(calls), 'least active = bottom six or nil calls');
  assert.ok(/r\.end==='Least active' \? 'bad'/.test(calls), 'and they are the ones in red');
});

/* THE DAY-PROGRESS SLIDE: the three office units from the day's first upload to its latest,
   on ONE slide, ranked on points gained -- "who pushed more percentages and who is the most
   stuck guy behind". Its own kind, because a table cannot fit sixteen officers with a bar each. */
test('the presentation carries a day-progress slide for the three office units', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf('function presSlides'), app.indexOf('function presApply'));
  assert.ok(/slides\.push\(\{ id:'dayprog', kind:'progress'/.test(view), 'the slide exists, with its own kind');
  assert.ok(/b\.dayProgress/.test(view), 'and it reads officerBoards\' dayProgress');
  for (const unit of ['early', 'col', 'rec']) assert.ok(new RegExp("key:'" + unit + "'").test(view), unit + ' is on it');
  const draw = app.slice(app.indexOf('function presDraw'), app.indexOf('function presBlank'));
  assert.ok(/s\.kind === 'progress'/.test(draw), 'presDraw has a branch for it');
  assert.ok(/function presProgGroup_\(/.test(app), 'drawn by its own helper');
  for (const k of ['earlyTotal', 'colTotal', 'recTotal', 'earlyAvg', 'colAvg', 'recAvg']) {
    assert.ok(new RegExp('dp\\.' + k + '\\b').test(view), k + ' reaches the slide');
  }
  assert.ok(/u\.total \? \[\{ \.\.\.u\.total, isTotal: true \}\]/.test(app) && /u\.avg \? \[\{ \.\.\.u\.avg, isTotal: true, isAvg: true \}\]/.test(app),
    'the total and the average are drawn as rows of the same column');
  // The deck list's row count must not assume every non-KPI slide is a table.
  assert.ok(/rows: sl\.rows \? sl\.rows\.length : sl\.items\.length/.test(app));
});

/* THE PRESENTATION LOADS IN TWO STEPS AND SURVIVES EITHER ONE FAILING.
     "server not responding in time - presentation page aint loading"
   It used to Promise.all the dashboard and the officer boards -- the two heaviest reads, side by
   side, and one failure took the page. The dashboard tab already loads its boards after its
   core and fails them in their own place; this is the same rule brought to the deck. */
test('the presentation asks for the dashboard first, the boards after, and plays without the boards', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf('VIEWS.present = function'), app.indexOf('var PRES_REFRESH_MS'));
  assert.ok(!/Promise\.all\(\[srv/.test(view), 'the two heaviest reads are never fired side by side');
  assert.ok(/srv\('dashboardFull', wk\)\.then\(function\(d\)\{/.test(view), 'the dashboard comes first');
  assert.ok(/presRender\(\);\s*presBoards_\(wk\);/.test(view), 'the page is drawn from it, then the boards are asked for');
  assert.ok(/srv\('officerBoards', wk\)\.then\(function\(b\)\{ mine\.b = b; mine\.bWhy = ''; \},\s*function\(e\)\{ mine\.bWhy = String/.test(view),
    'a boards failure is kept with its reason instead of thrown');
  assert.ok(/if \(S\.presData !== mine \|\| S\.view !== 'present'\) return;/.test(view), 'nothing is drawn over a tab the person has left');
  const slides = app.slice(app.indexOf('function presSlides'), app.indexOf('function presApply'));
  assert.ok(/if \(!b\)\{\s*slides\.push\(\{ id:'boards', kind:'note'/.test(slides), 'without the boards the deck carries a note slide in their place');
  assert.ok(/S\.presData\.bWhy/.test(slides), 'and the note says why');
  assert.ok((slides.match(/slides\.push\(coltrend\)/g) || []).length === 2, 'the collection trend plays either way');
  const refetch = app.slice(app.indexOf('function presRefetch'), app.indexOf('function presSlides'));
  assert.ok(!/Promise\.all\(\[srv/.test(refetch), 'the three-minute refresh follows the same order');
  assert.ok(/return srv\('officerBoards', wk\)\.then\(function\(b\)\{ mine\.b = b; mine\.bWhy = ''; \}, function\(\)\{\}\);/.test(refetch),
    'a missed boards refresh keeps the last boards');
  const draw = app.slice(app.indexOf('function presDraw'), app.indexOf('function presProgGroup_'));
  assert.ok(/s\.kind === 'note'/.test(draw), 'presDraw draws the note');
  assert.ok(/id="presBoardsRetry"/.test(app) && /getElementById\('presBoardsRetry'\)/.test(app), 'the page offers a retry, and it is wired');
  assert.ok(/\(S\.view === 'dashboard' \|\| S\.view === 'present'\) && \/45\|sekunde/.test(app),
    'a dashboard timeout on the presentation runs the same self-diagnosis as the dashboard tab');
});

/* THE IMPREST GATE ON THE PAGE -- the server refuses a request while an approved imprest is
   unretired (imprestRequest); the page says so up front, in the server's words, and closes the
   button so the form is not filled for nothing. */
test('the imprest request page closes the form while an approved imprest is unretired', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf('VIEWS.impreq = function'), app.indexOf('VIEWS.impappr = function'));
  assert.ok(/var blocked = !!\(d\.unretired && d\.unretired\.length\);/.test(view), 'the gate is the server\'s list, not a client guess');
  assert.ok(/esc\(d\.unretiredNote \|\| ''\)/.test(view), 'and the sentence is the server\'s own');
  assert.ok(/\(roles\.length && !blocked\)\?'':' disabled'/.test(view) && /data-blocked="1"/.test(view), 'the button is closed and marked');
  assert.ok(/send\.getAttribute\('data-blocked'\) === '1'/.test(app), 'the live-preview recalculation cannot reopen it');
});

/* THE RECOVERY CUSTOMERS DRAWER IS A TABLE, SO IT TAKES THE SCREEN'S WIDTH -- "widen the
   recovery card that opens when i click the day recovery widget, its so thick for the content".
   Opt-in per drawer; a form drawer that opens next drops the class. */
test('the recovery customers drawer opens wide, and a normal drawer takes the width back', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  assert.ok(/\.drawer\.wide\{max-width:100%;border-radius:0\}/.test(app), "the wide rule fills the device, whatever its width");
  assert.ok(/function drawer\(html, opts\)\{\s*\$\('#drawer'\)\.classList\.toggle\('wide', !!\(opts && opts\.wide\)\);/.test(app),
    'drawer() toggles the class from the option -- on for wide, off for everything else');
  const fn = app.slice(app.indexOf('function recoveryCustomersDrawer_'), app.indexOf('function weekdayOf_'));
  const calls = fn.match(/drawer\([\s\S]*?\{ wide: true \}\)/g) || [];
  assert.equal(calls.length, 3, 'loading, loaded and failed: all three states of this drawer are wide');
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
  // "Share on WhatsApp button must go with the existing images in their order, the 1st
  // picture with the whole KYC text automatic" -- the button hands the captured pages, in
  // capture order, and the KYC caption to the browser's own share sheet, through the one
  // shareOnWhatsApp_ helper both this button and the plan's own share button call.
  assert.ok(/shareOnWhatsApp_\(\$\('#lnContractWaBtn'\), function\(\)\{ return srv\('contractPhotosForShare', \{ loan_id: loan\.id \}\)/.test(waWire),
    'it asks the server for the captured pages, in order');
  const helper = app.slice(app.indexOf('function openWaTextOnly_('), app.indexOf('function mapLink_('));
  assert.ok(/navigator\.share\(/.test(helper), 'and shares them (with the images) through the share sheet');
  assert.ok(/buildKycText_\(\)/.test(helper), 'the whole KYC text rides as the share\'s caption');
  assert.ok(/wa\.me\/\?text=/.test(helper), 'a browser that cannot share files at all still gets the text-only fallback');
  assert.ok(/window\.open\(/.test(helper), 'the fallback actually opens the link (window.open, now safe -- see onCreateWindow)');
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
  assert.ok(/if \(!planMode\) \{\s*\n\s*\$\('#lnSubmitRec'\)/.test(form), 'submit and reject are never wired on a plan');
  // "my system will be used for assessment pictures ... they get the kyc and Whatsapp share
  // buttons at assessment plan" -- everything but the signed contract itself is now offered
  // on a plan too (there is no loan yet to sign one for).
  assert.ok(/planMode[^]*?\?\s*'<div class="card">[^]*?id="lnPlanWaBtn"/.test(form), 'a plan gets its own WhatsApp share button');
  assert.ok(/planMode[^]*?id="lnCopyKyc" disabled/.test(form.slice(0, form.indexOf('lnContractCount'))), 'and the Copy KYC button, before the contract-only branch');
  assert.ok(/Mkataba na kuwasilisha vinapatikana kwenye Team/.test(form), 'only the contract and Submit are said to live at Team &middot; Recommendation');
  assert.ok(/if \(planMode\) \{\s*\n\s*\$\('#lnPlanWaBtn'\)\.onclick = function\(\)\{\s*\n\s*shareOnWhatsApp_\(\$\('#lnPlanWaBtn'\), function\(\)\{ return srv\('planPhotosForShare', \{ plan_id: planRow\.id \}\)/.test(form),
    'the plan share button asks for the plan\'s own photos, not a loan\'s');
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
  const helper = app.slice(app.indexOf('var BACK_LAYERS_ = []'), app.indexOf('function drawer(html'));
  assert.ok(/history\.pushState\(\{ hopeLayer: name \}/.test(helper), 'opening a layer pushes one tagged entry');
  assert.ok(/if \(BACK_LAYERS_\.indexOf\(name\) >= 0\) return;/.test(helper), 'once, however often the layer redraws while open');
  assert.ok(/if \(!BACK_POPPING_\) \{ try \{ history\.back\(\); \}/.test(helper), 'closing by button consumes the entry it pushed');
  assert.ok(/addEventListener\('popstate'/.test(helper) && /BACK_CLOSERS_\[top\]\(\)/.test(helper), 'Back closes the top layer');
  assert.ok(/e\.state\.hopeLayer === top \|\| e\.state\.hopeCam/.test(helper), 'a pop that lands on our own entry (the camera above us closing) is left alone');
  const drawer = app.slice(app.indexOf('function drawer(html'), app.indexOf("$('#drawerBg').onclick"));
  assert.ok(/backLayerOpen_\('drawer'\)/.test(drawer) && /backLayerClose_\('drawer'\)/.test(drawer), 'the drawer is a layer');
  const pres = app.slice(app.indexOf('function presStart('), app.indexOf('function presDraw('));
  assert.ok(/backLayerOpen_\('pres'\)/.test(pres) && /backLayerClose_\('pres'\)/.test(pres), 'the presentation is a layer');
  assert.ok(/function navOpen_\(\)\{[^}]*backLayerOpen_\('nav'\)/.test(app) && /function navClose_\(\)\{[^}]*backLayerClose_\('nav'\)/.test(app), 'the phone menu is a layer');
  const direct = (app.match(/classList\.(remove|toggle|add)\('navopen'\)/g) || []).length;
  assert.equal(direct, 2, 'the navopen class is touched only inside navOpen_/navClose_ -- nowhere else, or an entry is left behind');
});

/* "I need a team selector after the blue blinker on dashboard that filters the current dashboard
   data into chosen/selected team(s) among those owned by the current user." */
/* "I requested it as a drop down where multiple teams can be ticked and press okay to load the
   new dashboard not just every team selection initiating load." */
test('the dashboard draws a team pick after the dot, sends it, remembers it, and carries it to the month report', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const dash = app.slice(app.indexOf('function teamPick_('), app.indexOf("kpi('Current arrears'"));
  assert.ok(/srv\('dashboardFull', \{ weekOf: S\.args\.weekOf \|\| '', teams: teamPickLoad_\(\) \}\)/.test(dash), 'the pick is sent');
  assert.ok(/data-carry="weekOf,teams"><\/button>' \+ teamPick_\(d\)/.test(dash), 'drawn right after the dot, and carried by it');
  assert.ok(/if \(opts\.length <= 1\) return '';/.test(dash), 'nothing to choose for a one-team code');
  assert.ok(/id="teamPickBtn"/.test(dash) && /id="teamPickMenu" hidden/.test(dash), 'one button, a menu closed under it');
  assert.ok(/type="checkbox" data-teamopt=""/.test(dash) && /type="checkbox" data-teamopt="' \+ esc\(t\)/.test(dash), 'an All tick box and one per team');
  assert.ok(/id="teamPickOk"/.test(dash) && /id="teamPickCancel"/.test(dash), 'OK and Cancel');
  const wire = app.slice(app.indexOf("var tpBtn = document.getElementById('teamPickBtn')"), app.indexOf('var fcGo = document.getElementById'));
  assert.ok(/getElementById\('teamPickOk'\)\.onclick[\s\S]*store\(teamPickKey_\(\), cur\.length \? JSON\.stringify\(cur\) : null\);\s*render\(\{ force: true \}\)/.test(wire), 'applied, remembered per code and loaded on OK');
  assert.equal((wire.match(/render\(/g) || []).length, 1, 'OK is the ONLY thing that loads -- a tick never does');
  assert.ok(/b\.onchange = function\(\)\{ tpAll\.checked = /.test(wire), 'a tick only moves the All box');
  assert.ok(/getElementById\('teamPickCancel'\)\.onclick[\s\S]{0,60}tpOpen\(false\)/.test(wire) && /e\.key === 'Escape'/.test(wire), 'Cancel and Escape close without loading');
  const mStart = app.indexOf('VIEWS.monthreport = function');
  const month = app.slice(mStart, app.indexOf('VIEWS.', mStart + 10));
  assert.ok(/teams: teamPickLoad_\(\)/.test(month) && /teamPick_\(d\)/.test(month), 'the month report takes and shows the same pick');
});

/* "weekly Recovery cards at dashboard / widgets should be clickable to open list of those
   respective customers showing their initial arrears, current arrears and recovered, with grand
   totals." */
test('every measured recovery tile is pressable and opens the customers behind it with a grand total', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const grid = app.slice(app.indexOf("trendGrid('Weekly recovery trend (Mon–Sun)'"), app.indexOf("Loan pipeline</div>"));
  assert.equal((grid.match(/, '', press\)/g) || []).length, 2, 'weekday tiles (weekend and Mon-Fri shapes) carry the press');
  assert.ok(/'tot', recTileAttrs_\('week'\)\)/.test(grid), 'the TOTAL tile opens the week');
  assert.ok(/var press = recTileAttrs_\(x\.date\)/.test(grid), 'each tile carries its own date');
  assert.ok(/data-reccust="' \+ esc\(date \|\| ''\)/.test(app), 'the attribute names the date');
  const drawerFn = app.slice(app.indexOf('function recoveryCustomersDrawer_('), app.indexOf('function weekdayOf_('));
  /* "i want recovery to be real, choosing nothing" -- the drawer used to open on 'present' (the
     export's reading, whatever today's decks happen to be) with a toggle to the card's own
     reading, so a figure tapped off the dashboard could disagree with the very list meant to
     explain it until somebody found and pressed that toggle. There is now exactly one reading:
     the card's own, always. */
  assert.ok(/srv\('recoveryCustomers', \{ weekOf: S\.args\.weekOf \|\| '', teams: teamPickLoad_\(\), date: week \? '' : date, mode: 'day' \}\)/.test(drawerFn), 'asks for the card\'s own reading, always');
  assert.ok(!/data-recmode/.test(drawerFn), 'no toggle -- there is nothing to choose between');
  for (const k of ['initial', 'current', 'recovered']) assert.ok(new RegExp("key:'" + k + "'").test(drawerFn), k + ' column');
  assert.ok(/sumRow\(rows, \['initial', 'current', 'recovered'\]\)/.test(drawerFn), 'a grand total row, over the rows on screen');
  assert.ok(/root\.querySelectorAll\('\[data-xls\]'\)/.test(drawerFn), 'exports are wired inside the drawer');
  // "grind more": search, a status filter, and the decks the system paired.
  assert.ok(/id="recCustQ"/.test(drawerFn) && /id="recCustStatus"/.test(drawerFn), 'a search box and a status filter');
  assert.ok(/key:'status'/.test(drawerFn), 'a status column');
  assert.ok(/fold_\('recDecks'/.test(drawerFn) && /Imepakiwa \/ Uploaded at/.test(drawerFn), 'the decks read, with their dates and upload times');
  assert.ok(!/Superseded/.test(drawerFn), 'one reading, so nothing is "superseded" -- the decks named are the ones read');
  assert.ok(/querySelectorAll\('\[data-reccust\]'\)[\s\S]{0,200}recoveryCustomersDrawer_\(el\.getAttribute\('data-reccust'\)\)/.test(app), 'pressing a tile opens the drawer');
});

/* "dashboard speed is falling (Imeshindikana / Could not load. Failed to fetch) we could load
   that data after click" -- the officer boards (thirty-odd reads) no longer fire with the
   dashboard; they wait behind a button. And a read whose connection dropped is asked once more. */
test('the dashboard paints its core alone; the officer boards load on a tap; a dropped read is retried once', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const start = app.indexOf('VIEWS.dashboard = function');
  const view = app.slice(start, app.indexOf('/* =====', start));
  assert.ok(/DASH_LOAD_BOARDS_ = function\(\)\{[\s\S]*srv\('officerBoards'\)/.test(view), 'the boards wave lives inside the loader');
  const beforeLoader = view.slice(0, view.indexOf('DASH_LOAD_BOARDS_ = function'));
  assert.ok(!/srv\('officerBoards'\)|srv\('callAgents'|srv\('recoveryByCredit'/.test(beforeLoader), 'and nowhere else in the view');
  assert.ok(/id="dashBoardsLoad"/.test(view), 'a button offers them');
  assert.ok(/getElementById\('dashBoardsLoad'\)[\s\S]{0,120}DASH_LOAD_BOARDS_\(\)/.test(app), 'pressing it runs the wave');
  const srv = app.slice(app.indexOf('function srv(fn, args)'), app.indexOf('function srv(fn, args)') + 3000);
  assert.ok(/n < 1 && READ_FNS\[fn\] && \(!e \|\| !e\.status\)/.test(srv), 'a read with no HTTP answer at all is retried once; a write never');
  assert.ok(/setTimeout\(res, 1500\)/.test(srv), 'after a short pause');
});

/* THE ABNORMAL TAB OPENS ON ONE DAY -- "Pmos make daily followup .. they can't be always
   finding huge list" -- with a day strip: a day either side, a typed day, the latest, or all. */
test('the abnormal payments tab asks for a day and carries a day strip', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf('VIEWS.abnormal = function'), app.indexOf('VIEWS.credit = function'));
  assert.ok(/srv\('abnormal', \{ date: S\.args\.date \|\| '' \}\)/.test(view), 'the day asked for travels; blank is the latest');
  for (const h of ['data-abn-step="-1"', 'data-abn-step="1"', 'id="abnDate"', 'data-abn-set=""', 'data-abn-set="all"']) {
    assert.ok(view.includes(h), h + ' is on the strip');
  }
  assert.ok(/getAttribute\('data-abn-step'\)/.test(app) && /getAttribute\('data-abn-set'\)/.test(app), 'and the strip is wired');
  assert.ok(/abnDate\.onchange/.test(app), 'a typed day is wired too');
});

/* A GRAND PERCENTAGE IS A RATIO OF THE TOTALS, NEVER THE MEAN OF THE ROWS.
     "I need each cell on grand total of recovery to be the percentage of recovered vs
      uncollected not average of the above percentages ... Do the same to any other grand
      total averages on col/rec that behaves so"
   A column may name its own two parts (`from`) for the keys made up as a board is drawn; the
   rows carry the parts; the bottom line divides their sums. Run for real, not just matched. */
test('a percentage column with `from` totals as a ratio of the parts, and the boards declare them', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const src = app.slice(app.indexOf('var PCT_FROM = {'), app.indexOf('function autoTotals(rows, cols)'));
  const fillPctTotals = new Function(src + '\nreturn fillPctTotals;')();
  const rows = [
    { officer: 'A', recW1: 100, baseW1: 100, pctW1: 100 },     // a tiny book at 100%
    { officer: 'B', recW1: 1000, baseW1: 10000, pctW1: 10 },   // a big book at 10%
  ];
  const cols = [{ key: 'officer' }, { key: 'pctW1', kind: 'pct', from: ['recW1', 'baseW1'] }, { key: 'recW1', kind: 'money' }];
  const t = {};
  fillPctTotals(t, rows, cols);
  assert.equal(t.pctW1, 10.9, '1,100 of 10,100 -- not the ~55% mean of 100% and 10%');
  const t2 = {};
  fillPctTotals(t2, rows, [{ key: 'pctW1', kind: 'pct' }]);
  assert.equal(t2.pctW1, '~55%', 'without the parts named it can only average, and says so with ~');
  // The boards that were averaging: every recovery and collection grand cell now names its parts.
  const wk = app.slice(app.indexOf("board('cmRecWeek'"), app.indexOf("board('cmColWeek'"));
  assert.ok(/from:\['rec'\+k, 'base'\+k\]/.test(wk), 'recovery week: each record over its base');
  const mo = app.slice(app.indexOf("board('cmMRec'"), app.indexOf("S.rows = d.week || [];"));
  assert.ok(/from:\['rec'\+w\.key, 'base'\+w\.key\]/.test(mo) && /from:\['weekRecovered', 'weekBase'\]/.test(mo), 'recovery month: each week and the month');
  assert.ok((mo.match(/from:\['col'\+w\.key, 'exp'\+w\.key\]/g) || []).length === 2, 'early col and PMO months: each week collected over expected');
  const dash = app.slice(app.indexOf("board('bRecT'"), app.indexOf("creditRecoveryBoard(creditRec"));
  assert.ok((dash.match(/from:\['recovered','uncollected'\]/g) || []).length === 2, 'the dashboard\'s two recovery boards');
  const pres = app.slice(app.indexOf("slides.push({ id:'recovery'"), app.indexOf("slides.push({ id:'early'"));
  assert.ok(/from:\['recovered','uncollected'\]/.test(pres), 'and the recovery slide\'s week column');
  assert.ok(/wCollected: w\.collected, wExpected: w\.expected/.test(app), 'the early slide carries the week\'s parts for PCT_FROM.wPct');
});

/* THE MONTH'S FOUR WIDGETS -- "for rec, early col and col widgets remove the total since its
   on the first company widget, leave the officers and add the percentage performance ... on the
   company widget add pmo performance avrg (erly col, col, rec)". */
test('the commission month widgets read each unit\'s ratio, and the company widget their average', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const view = app.slice(app.indexOf('VIEWS.cmmonth = function'), app.indexOf("board('cmMRec'"));
  assert.ok(/rPct = ratio\(rRec, rUncol\)/.test(view), 'recovery: recovered over uncollected');
  assert.ok(/ePct = ratio\(eCol, eExp\)/.test(view) && /pPct = ratio\(pCol, pExp\)/.test(view), 'early col and PMO: collected over expected');
  assert.ok(/kpi\('Recovery — mwezi', pc\(rPct\)/.test(view), 'the recovery widget shows the percentage, not the money');
  assert.ok(/kpi\('Early Collection — mwezi', pc\(ePct\)/.test(view) && /money\(eN\) \+ '\/' \+ money\(eCust\)/.test(view), 'early col: the percentage and a/b of all expected');
  assert.ok(/kpi\('PMO Collection — mwezi', pc\(pPct\)/.test(view), 'PMO: the percentage');
  assert.ok(!/kpi\('Recovery — mwezi', money\(sp\.recWeek/.test(view), 'the unit money totals are gone from the unit widgets');
  assert.ok(/var units = \[ePct, pPct, rPct\]/.test(view) && /PMO performance ' \+ pc\(perf\)/.test(view), 'the company widget carries the average of the three');
  assert.ok(/money\(\(d\.recBoard\|\|\[\]\)\.length\) \+ ' officer\(s\)'/.test(view), 'and the officer counts stay');
});

/* THE EARLY COLLECTION SWITCH ON THE RATES CARD -- "i need a switch at viwango/rates where i
   can change early collection commission mode to performance or back to counts". */
test('the Rates card carries the early collection mode switch, its ladder and its bonus, all wired to Save', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const card = app.slice(app.indexOf('Viwango / Rates</div><div class="cmsrates">'), app.indexOf("board('cmRecWeek'"));
  assert.ok(/id="cmEarlyMode"/.test(card) && /value="counts"/.test(card) && /value="performance"/.test(card), 'the switch, two positions');
  assert.ok(/class="cmEarlyBand" data-floor="/.test(card), 'the plan\'s ladder, one box per band');
  assert.ok(/id="cmEarlyBonus"/.test(card) && /id="cmEarlyBonusOn"/.test(card), 'the bonus amount and its switch');
  assert.ok(/d\.earlyBands\|\|\[\]/.test(card), 'the bands are drawn from the server\'s ladder, never retyped here');
  const save = app.slice(app.indexOf("srv('commissionSave', { paidTzs"), app.indexOf('var cmEarlyBandsReset'));
  for (const k of ['earlyMode:', 'earlyBands:', 'earlyWeeklyBonus:', 'earlyBonusEnabled:']) {
    assert.ok(save.includes(k), k + ' travels on Save');
  }
  assert.ok(/resetEarlyBands: true/.test(app) && /clearEarlyWeeklyBonus: true/.test(app), 'reset and delete are wired');
  const week = app.slice(app.indexOf("board('cmColWeek'"), app.indexOf("PMO COLLECTION. Paid on the percentage"));
  assert.ok(/d\.earlyMode === 'performance'/.test(week) && /col\('bonus','Bonus','money'\)/.test(week), 'the week board shows the bonus column in performance mode');
});

/* THE DAILY BONUS PLAN IS A PREVIEW: IT READS NOTHING, SAVES NOTHING, AND ITS MATHS IS REAL.
     "GM needs an idea to breakdown - Bonuses by day ... create a new tab and fill your buildup
      idea so that I get a picture"
   Two promises are pinned. First, the tab never asks the server for anything (CLAUDE.md rule
   one: nothing is added to the upload or call paths, and a preview must not add a read to
   anything else either). Second, the functions that turn a month of percentages into shillings
   are executed here, so the plan the GM is looking at is the plan that would be built. */
test('the daily bonus plan tab is wired, admin-grantable, and makes no server call', async () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  assert.ok(/\{ id:'bonusplan',\s+label:'Bonasi ya Kila Siku \/ Daily Bonus Plan'/.test(app), 'the nav entry');
  assert.ok(/VIEWS\.bonusplan = function/.test(app), 'the screen exists');
  assert.ok(/VC_SKIP = \{[^}]*bonusplan:1/.test(app), 'its boxes are never replayed from the view cache');
  assert.ok(/wireForms\(\);\s*\n\s*bpWire_\(\);/.test(app), 'drawView_ wires the preview after every paint');
  const code = app.slice(app.indexOf('BONASI YA KILA SIKU / DAILY BONUS PLAN'), app.indexOf('VIEWS.perf = function'));
  assert.ok(code.length > 5000, 'the extractor found the preview');
  assert.ok(!/\bsrv\(|\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(code),
    'the preview reads nothing and saves nothing');
  assert.ok(/RASIMU \/ DRAFT/.test(code) && /EXAMPLE FIGURES ONLY/.test(code), 'and it says plainly that the figures are examples');
  // Grantable like `audit`: admins hold it, nobody else until it is ticked on their role.
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
  const { USER_TABS, ADMIN_TABS, EXTRA_TABS, ALL_TABS } = await import('../api/_lib/auth.js');
  assert.ok(ADMIN_TABS.includes('bonusplan') && EXTRA_TABS.includes('bonusplan') && ALL_TABS.includes('bonusplan'));
  assert.ok(!USER_TABS.includes('bonusplan'), 'not handed to every code');
});

test('the daily bonus maths: a day is worth its gates, a perfect month is exactly the pot, and the rules hold', async () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const src = app.slice(app.indexOf('var BP = null;'), app.indexOf('function bpState_()'));
  const m = new Function(src + '\nreturn { bpWhole_, bpDay_, bpMonth_, bpChecklist_, bpLeaderDay_, BP_PICK, BP_LEADERS };')();
  const cfg = () => ({ pot: 100000, w: { col: 40, sales: 30, rec: 30 }, g: { col: 96, sales: 80, rec: 120 },
    streak: false, sFrom: 3, sPct: 25, cap: 125, lw: 40, latePct: 50, lose: true, results: 3, lpot: 100000 });

  // ONE ROUNDING RULE with the commission ladders: the page's reading equals the server's.
  const { wholePct } = await import('../api/_lib/recovery.js');
  for (const v of [89.5, 89.4, 95.6, 79.6, 119.5, 49.49999999999999, 0, 100, 137.4, null, '', 'x'])
    assert.equal(m.bpWhole_(v), wholePct(v === '' || v === 'x' ? null : v), 'same answer for ' + v);
  assert.equal(m.bpWhole_(''), null);

  // A day's gates, read at the whole percentage the board shows.
  const d1 = m.bpDay_([95.6, 79.6, 119.4], cfg());
  assert.deepEqual([d1.col, d1.sales, d1.rec], [true, true, false], '95.6 reads as 96 and 79.6 as 80; 119.4 is 119');
  assert.equal(d1.share, 0.7, 'collection 40 + sales 30 of 100');
  assert.equal(m.bpDay_([96, 80, 120], cfg()).perfect, true);
  assert.equal(m.bpDay_([0, 0, 0], cfg()).share, 0);

  // A PERFECT MONTH PAYS EXACTLY THE POT -- rounding is done on the running total, so 22 slices of
  // 4,545.45 do not come to 99,990.
  const perfect = Array.from({ length: 22 }, () => [96, 80, 120]);
  const pm = m.bpMonth_(perfect, 22, cfg());
  assert.equal(pm.earned, 100000);
  assert.equal(pm.perfectDays, 22);
  assert.equal(pm.maxSoFar, 100000);
  assert.equal(pm.days.reduce((s, d) => s + d.earn, 0), 100000, 'and the days add up to the running total');

  // Days that have not happened earn nothing and are not misses.
  const part = m.bpMonth_(perfect, 10, cfg());
  assert.equal(part.days[10].ahead, true);
  assert.equal(part.earned, Math.round(100000 * 10 / 22));
  assert.equal(part.pace, 100000, 'ten perfect days of twenty-two paces to the whole pot');

  // THE EXAMPLE MONTH: stricter than today's rule on the same averages -- the finding the page tells the GM.
  const ex = m.bpMonth_(m.BP_PICK, 22, cfg());
  assert.equal(ex.oldRule, 100000, "today's rule pays on the month's averages");
  assert.ok(ex.earned < 100000 && ex.earned > 70000, 'the daily meter pays less to an inconsistent month: ' + ex.earned);

  // STREAK BOOST: off by default; on, perfect days after the third in a row earn extra, never past the cap.
  const on = Object.assign(cfg(), { streak: true });
  const boosted = m.bpMonth_(perfect, 22, on);
  assert.equal(boosted.earned, 122727, 'twenty boosted days add 20 x 25% of a slice: 100,000 + 22,727, under the 125% cap');
  assert.equal(m.bpMonth_(perfect, 22, Object.assign(cfg(), { streak: true, cap: 110 })).earned, 110000, 'and a 110% cap holds it there');
  assert.equal(m.bpMonth_(perfect, 3, on).days[2].boost, true, 'the third perfect day in a row is boosted');
  assert.equal(m.bpMonth_(perfect, 2, on).days[1].boost, false, 'the second is not');
  const broken = perfect.map(r => r.slice()); broken[2] = [80, 50, 50];
  assert.equal(m.bpMonth_(broken, 5, on).days[3].boost, false, 'a miss resets the streak');

  // THE LEADER'S CHECKLIST.
  const AM = m.BP_LEADERS[0];
  assert.equal(AM.items.length, 10);
  assert.ok(AM.items.every(i => /^\d\d:\d\d$/.test(i.due) && ['photo', 'screen', 'auto', 'tick'].includes(i.ev)), 'every item has a time and a proof');
  assert.ok(m.BP_LEADERS.every(L => L.items.some(i => i.must) && L.gates.length === 3), 'every role has mandatory items and three result gates');
  const ids = m.BP_LEADERS.flatMap(L => L.items.map(i => i.id));
  assert.equal(new Set(ids).size, ids.length, 'item ids are unique across roles, so one status map serves all');
  const full = m.bpLeaderDay_(AM.items, {}, cfg(), 22);
  assert.equal(full.c.score, 1);
  assert.equal(full.earn, Math.round(100000 / 22), 'everything on time and 3 of 3 gates = the whole slice');
  // Late is half points; missed is nothing.
  const t = m.bpChecklist_([{ id: 'a', pts: 2 }, { id: 'b', pts: 2 }], { a: 'late', b: 'ok' }, cfg());
  assert.equal(t.score, 0.75);
  // A mandatory item missed loses the checklist; nothing filled loses the day.
  const must = m.bpLeaderDay_(AM.items, { am2: 'miss' }, cfg(), 22);
  assert.equal(must.c.mustMissed, true); assert.equal(must.c.score, 0);
  assert.equal(must.share, 0.6, 'only the results share is left: (100 - 40)% of 3 gates out of 3');
  const none = Object.fromEntries(AM.items.map(i => [i.id, 'miss']));
  assert.equal(m.bpLeaderDay_(AM.items, none, cfg(), 22).earn, 0, 'an unfilled day is lost even with 3 of 3 gates');
  assert.ok(m.bpLeaderDay_(AM.items, none, Object.assign(cfg(), { lose: false }), 22).earn > 0, 'unless that rule is switched off');
});

/* A TABLE SLIDE FITS THE SCREEN TOP TO BOTTOM.
     "Hope calls slide height should autofit since we cant keep scrolling to see the last
      pmo's data"
   The HOPE Calls slide is the one table with no row cap -- every officer of the three units --
   so it is the one that ran off the bottom. presFit_ measures the drawn table against the
   space under the heading and shrinks the type to the ratio, floor 8px, after every draw and
   on resize. The clamp() width rule is untouched: a table that fits is left as it was. */
test('the presentation fits every slide to the screen after every draw and on resize', () => {
  const app = readFileSync(join(PUBLIC, 'app.html'), 'utf8');
  const draw = app.slice(app.indexOf('function presDraw'), app.indexOf('function presProgGroup_'));
  assert.ok(/presSetHtml_\(/.test(draw), 'presDraw hands its HTML to the setter that fits it');
  const fit = app.slice(app.indexOf('function presFit_'), app.indexOf('function presProgGroup_'));
  assert.ok(/classList\.remove\('pfit'\)/.test(fit) && /style\.fontSize = ''/.test(fit), 'every fit starts from the clamp() size, so a slide that fits is never shrunk');
  assert.ok(/need <= tAvail\) return;/.test(fit), 'and only a table taller than the space is touched');
  assert.ok(/Math\.max\(8,/.test(fit), 'with an 8px floor, below which the box scrolls as before');
  assert.ok(/window\.addEventListener\('resize'[^]*presFit_\(\)/.test(app), 'a projector plugged in mid-meeting re-fits the slide that is up');
  // "all the slides": a body that is not a table is zoomed as a whole, floor 0.5, with a transform fallback.
  assert.ok(/body\.style\.zoom = r;/.test(fit) && /Math\.max\(0\.5,/.test(fit), 'KPI, progress and note slides are zoomed to fit, floor 0.5');
  assert.ok(/CSS\.supports\('zoom', '0\.5'\)/.test(fit) && /transform = 'scale\(' \+ r \+ '\)'/.test(fit), 'with a transform fallback where zoom is unsupported');
  assert.ok(/if \(h <= avail\) return;/.test(fit), 'and a body that fits is never zoomed');
  assert.ok(/#pres \.ptable\.pfit td\{padding:\.3em \.5em\}/.test(app), 'a fitted table pads in em so the rows shrink with the type');
  // The HOPE Calls slide is still uncapped: the fix is to fit it, not to cut officers off it.
  const slides = app.slice(app.indexOf("slides.push({ id:'calls'"), app.indexOf("slides.push({ id:'credit'"));
  assert.ok(/rows: callRows,/.test(slides) && !/callRows\.slice/.test(slides), 'every officer of the three units stays on the slide');
});
