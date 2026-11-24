/* THE PRESENTATION'S DEFAULT SECONDS PER SLIDE IS 45 (handbook Part 146).

     "change default slide seconds from 15 to 45 please" -- the owner, 24 Nov 2026

   The number was typed in ten places (the server's answer, four lines of the page, five of the Presentation module). It is named
   ONCE on the server (PRESENT_SECONDS_DEFAULT, api/me.js) and ONCE on the page (PRES_SECS_DEFAULT, public/app.html), and these tests
   hold the two together and RUN every road that reads it: the server's answer with and without a row in Settings, the page taking
   that answer, the note a deck writes before it reloads itself, and the three places the module starts its clock (Play, a slide
   changed by hand, coming back from the black screen). A row PRESENT_SECONDS in Settings still wins, a stored 15 included: a default
   never overrides a number somebody typed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
const { uiCadences, PRESENT_SECONDS_DEFAULT } = await import('../api/me.js');
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const APP = read('public/app.html'), MOD = read('public/mod/present.js');
const between = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, 'not in the source: ' + a); return src.slice(i, j); };

test('the server answers 45 when Settings holds no PRESENT_SECONDS, and the setting when it holds one', async () => {
  assert.equal(PRESENT_SECONDS_DEFAULT, 45);
  const ui = rows => uiCadences(fakeDb({ settings: rows }));
  assert.equal((await ui([])).presentSeconds, 45, 'no row: the default');
  assert.equal((await ui([{ key: 'SYSTEM_OPEN', value: 'YES' }])).presentSeconds, 45, 'other settings only: the default');
  assert.equal((await ui([{ key: 'PRESENT_SECONDS', value: '20' }])).presentSeconds, 20, 'a row wins');
  assert.equal((await ui([{ key: 'PRESENT_SECONDS', value: '15' }])).presentSeconds, 15, 'a stored 15 is somebody\'s own number: it still wins');
  assert.equal((await ui([{ key: 'PRESENT_SECONDS', value: '90 seconds' }])).presentSeconds, 90);
  assert.equal((await ui([{ key: 'PRESENT_SECONDS', value: '2' }])).presentSeconds, 5, 'never under five');
  assert.equal((await ui([{ key: 'PRESENT_SECONDS', value: '9999' }])).presentSeconds, 300, 'never over three hundred');
  for (const junk of ['', 'abc', '0', null]) assert.equal((await ui([{ key: 'PRESENT_SECONDS', value: junk }])).presentSeconds, 45, 'a row that is no number: the default (' + junk + ')');
  // a settings table that will not answer never stops a sign-in: the default
  const broken = { from: () => ({ select: () => ({ in: () => { throw new Error('the database is away'); } }) }) };
  assert.deepEqual(await uiCadences(broken), { presentSeconds: 45, refreshSeconds: 90, hintIntervalSeconds: 240, hintLifetimeSeconds: 7 });
  // the other three cadences are what they were
  assert.deepEqual(await ui([]), { presentSeconds: 45, refreshSeconds: 90, hintIntervalSeconds: 240, hintLifetimeSeconds: 7 });
});

test('the page names the default once, it is the server\'s, and no road types a number of its own', () => {
  const decl = APP.match(/^var PRES_SECS_DEFAULT = (\d+);$/gm) || [];
  assert.equal(decl.length, 1, 'declared once, at the top level of the page');
  assert.equal(Number(decl[0].match(/\d+/)[0]), PRESENT_SECONDS_DEFAULT, 'the page\'s default is the server\'s');
  assert.ok(APP.indexOf('var PRES_SECS_DEFAULT') < APP.indexOf('function start(me)'), 'declared before the code that boots the page');
  for (const [name, src, uses] of [['public/app.html', APP, 4], ['public/mod/present.js', MOD, 5]]) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const falls = code.match(/(?:presSecs|resume\.secs|presentSeconds|'presSecs'\)\.value)\)?\s*\|\|\s*[A-Za-z0-9_.]+/g) || [];
    assert.equal(falls.length, uses, name + ': every place the seconds fall back to something (' + falls.join(' ; ') + ')');
    for (const f of falls) assert.ok(/\|\|\s*PRES_SECS_DEFAULT$/.test(f), name + ' falls back to a number of its own: ' + f);
  }
  assert.ok(!/\bPRES_SECS_DEFAULT\s*=/.test(MOD), 'the module reads the page\'s default, it does not make one');
});

test('the page takes the server\'s number, and its own default when the answer has none', () => {
  const ctx = vm.createContext({ S: {}, VC_MS: 0 });
  vm.runInContext((APP.match(/^var PRES_SECS_DEFAULT = \d+;$/m) || [''])[0] + '\n' + between(APP, 'function applyCadences(ui){', 'var VC_SKIP')
    + '\n' + between(APP, 'function presResumeNote_(){', 'function presCheckBuild_'), ctx);
  const run = code => vm.runInContext(code, ctx);
  run('applyCadences({ presentSeconds: 45, refreshSeconds: 90, hintIntervalSeconds: 240, hintLifetimeSeconds: 7 })');
  assert.equal(ctx.S.presSecs, 45);
  run('applyCadences({ presentSeconds: 20 })'); assert.equal(ctx.S.presSecs, 20, 'the server\'s number');
  run('applyCadences({ refreshSeconds: 90 })'); assert.equal(ctx.S.presSecs, 45, 'an answer with no seconds: the default');
  run('applyCadences({ presentSeconds: 0 })'); assert.equal(ctx.S.presSecs, 45);
  run('S.presSecs = 0; S.presI = 3;');
  assert.deepEqual(JSON.parse(JSON.stringify(run('presResumeNote_()'))), { i: 3, secs: 45, weekOf: '' }, 'the note a reloading deck writes names the default, not 15');
  run('S.presSecs = 60;'); assert.equal(run('presResumeNote_().secs'), 60);
  // a deck coming back from its own reload: the note's seconds, clamped; a note with none is the default
  const line = (APP.match(/S\.presSecs = Math\.max\(5, Math\.min\(300, Number\(resume\.secs\) \|\| PRES_SECS_DEFAULT\)\);/) || [])[0];
  assert.ok(line, 'the resume line');
  // The note's own seconds win over the default: it is what the room was playing. So a TV that was already playing at the old 15 comes back at 15
  // ONCE, and keeps writing 15 into every later note until somebody presses Stop and Play, or the page is opened afresh (Part 146, said plainly).
  for (const [secs, want] of [[undefined, 45], [0, 45], [15, 15], [30, 30], [1, 5], [9999, 300]]) { run('var resume = ' + JSON.stringify({ secs }) + '; ' + line); assert.equal(ctx.S.presSecs, want, 'resume with ' + secs); }
});

test('the module\'s clock: Play, a slide changed by hand and the way back from the black screen all run on the default', () => {
  const made = [];
  const ctx = vm.createContext({ S: { slides: [{}, {}, {}] }, PRES_REFRESH_MS: 180000, presDraw() {}, presRefetch() {}, backLayerOpen_() {},
    document: { getElementById: () => ({ style: {} }) }, clearInterval() {}, setInterval: (f, ms) => { made.push(ms); return made.length; } });
  vm.runInContext((APP.match(/^var PRES_SECS_DEFAULT = \d+;$/m) || [''])[0] + '\n' + between(MOD, 'function presStart(from){', 'function presStop(){')
    + '\n' + MOD.slice(MOD.indexOf('function presBlank(on){')), ctx);          // presBlank and presGo are the module's last two functions
  const run = code => vm.runInContext(code, ctx);
  const slideClock = () => made.filter(ms => ms !== 180000);
  run('presStart(0)'); assert.deepEqual(slideClock(), [45000], 'Play with nothing chosen: 45 seconds');
  made.length = 0; run('presGo(1)'); assert.deepEqual(slideClock(), [45000], 'a slide changed by hand restarts the clock on the same seconds');
  made.length = 0; run('presBlank(true); presBlank(false)'); assert.deepEqual(slideClock(), [45000], 'back from the black screen');
  for (const [secs, want] of [[20, 20000], [60, 60000], [1, 5000], [9999, 300000], ['abc', 45000], [0, 45000]]) {
    made.length = 0; run('S.presSecs = ' + JSON.stringify(secs) + '; presStart(0)'); assert.deepEqual(slideClock(), [want], 'Play with ' + secs + ' chosen');
  }
});

test('the handbook and CHAT.md say it', () => {
  const part = read('docs/HANDOFF.md'), chat = read('CHAT.md');
  assert.ok(/## Part 146\b/.test(part) && /change default slide seconds from 15 to 45 please/.test(part), 'Part 146 carries the owner\'s words');
  assert.ok(/change default slide seconds from 15 to 45 please/.test(chat) && /PRESENT_SECONDS/.test(chat), 'CHAT.md records the order and names the setting');
});
