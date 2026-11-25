/* CLAUDIAN-PMO'S BUBBLE, the parts that need no browser (handbook Part 156): the module's pure helpers RUN, its words and its source held to the
   owner's orders, and the two pages' hooks pinned. What a real browser does with it (the drag, the sheet, the panel, Settings, HOPE Calls) is
   tools/browser-checks/claudian-bubble.mjs.

     "Please add an Ai floating bubble in both calls and system UI - that one could drag anywhere ..." / "CLAUDIAN-PMO should never behave like Ai ask
      if there is anything else someone needs to ask you know we protecting development tokens" -- the owner, 25 Nov 2026 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = read('public/mod/claudian.js');
const APP = read('public/app.html');
const CALL = read('public/call.html');
const ADMIN = read('public/mod/admin.js');
const CORE = read('api/_lib/portal-core.js');
const C = await import('../api/_lib/claudian.js');
const acorn = await import('acorn');

/** The code with its comments and its strings taken out, so a pin reads the code and not a sentence about it. */
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
const CODE = strip(SRC);

// the module, run once in an empty window: only its pure parts are touched
const W = {};
vm.runInNewContext(SRC, { window: W, console });
const T = W.ClaudianPMO._t;
const J = x => JSON.stringify(x);                // the module ran in another realm: its objects are compared by value

test('the module is ES5 (old WebViews): it parses as ES5, and says nothing of eval, a Function made from text or document.write', () => {
  assert.doesNotThrow(() => acorn.parse(SRC, { ecmaVersion: 5 }), 'a line of the module is newer than ES5');
  assert.ok(!/\beval\s*\(|\bnew Function\b|\bdocument\.write\b|\binsertAdjacentHTML\b|\.outerHTML\b/.test(CODE), 'something that turns text into code or markup');
  assert.ok(/if \(window\.ClaudianPMO\) return;/.test(CODE), 'loaded twice: the first one stands');
  assert.ok(/!document\.body\.attachShadow\) return false;/.test(CODE), 'a browser with no shadow roots gets no bubble');
});

test('what a person is shown is TEXT: innerHTML is used for the icon and nothing else, and every line is made by el() with textContent', () => {
  const uses = [...CODE.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map(m => m[1].trim());
  assert.equal(uses.length, 2, 'innerHTML is written in ' + uses.length + ' places: ' + uses.join(' | '));
  for (const u of uses) assert.ok(/^ICON\.replace\(\/HEADID\/g, '\w+'\)$/.test(u), 'innerHTML is given something other than the fixed icon: ' + u);
  assert.ok(/function el\(tag, cls, text\) \{[^}]*n\.textContent = text;/.test(CODE), 'el() no longer sets text with textContent');
  assert.ok(/addMsg\(kind, text\)[\s\S]{0,200}el\('div', 'm ' \+ kind, text\)/.test(CODE), 'a line of the panel is made with el()');
});

test('it asks the server for NOTHING when it is mounted: only a tap on the bubble does, and the only address is /api/claudian', () => {
  const mount = CODE.slice(CODE.indexOf('function mount(opts)'), CODE.indexOf('window.ClaudianPMO = {'));
  assert.ok(mount.length > 1500, 'mount() moved: update the slice');
  const asking = mount.split('\n').filter(l => /\bapi\(|\bloadStatus\(|\bask\(|askFaq\(|\bfetch\(/.test(l));
  assert.ok(asking.length >= 1 && asking.every(l => /onclick|addEventListener/.test(l)), 'a line of mount() asks the server outside a handler: ' + JSON.stringify(asking.filter(l => !/onclick|addEventListener/.test(l))));
  assert.equal((CODE.match(/\bfetch\(/g) || []).length, 1, 'one request in the whole module');
  assert.ok(/fetch\(\(o\.base \|\| ''\) \+ '\/api\/claudian'/.test(CODE), 'the one address is /api/claudian');
  assert.ok(/function openPanel\(\)[\s\S]{0,700}loadStatus\(false\)/.test(CODE), 'opening the panel is what asks for the ready questions');
});

test('nothing the person types or is shown is kept: the only thing written to storage is the bubble\'s place, inside a try', () => {
  const all = CODE.match(/localStorage\./g) || [];
  const mine = CODE.match(/localStorage\.(getItem|setItem|removeItem)\(posKey\(\)/g) || [];
  assert.equal(all.length, 3, 'localStorage is touched in ' + all.length + ' places');
  assert.deepEqual(mine.map(x => x.split('.')[1].split('(')[0]).sort(), ['getItem', 'removeItem', 'setItem'], 'and every one of them is the bubble\'s own place');
  assert.ok(/JSON\.stringify\(\{ fx: [^}]*fy: [^}]*\}\)/.test(CODE) && !/setItem\([^)]*(code|device|answer|question)/i.test(CODE), 'what is stored is the two fractions and nothing a person said');
  for (const fn of ['readFrac', 'writeFrac', 'dropFrac']) assert.ok(new RegExp('function ' + fn + '\\([^)]*\\) \\{[\\s\\S]{0,160}try \\{').test(CODE), fn + ' reads or writes storage outside a try');
  assert.ok(!/sessionStorage|indexedDB|document\.cookie/.test(CODE), 'another store');
  assert.ok(/'claudianPos\.' \+ \(\(st\.opts && st\.opts\.host\) \|\| 'portal'\)/.test(CODE), 'the portal and the call app each keep their own place');
});

test('the words: both languages have the same names, {n} is in both, none is empty, and none is an offer or a question back (the owner\'s order)', () => {
  assert.equal(J(Object.keys(T.T.sw).sort()), J(Object.keys(T.T.en).sort()), 'a word is in one language only');
  for (const l of ['sw', 'en']) for (const [k, v] of Object.entries(T.T[l])) {
    assert.ok(typeof v === 'string' && v.trim(), l + '.' + k + ' is empty');
    assert.ok(!/anything else|let me know|would you like|do you want|is there|kingine|nijulishe|ungependa|karibu tena|usisite/i.test(v), l + '.' + k + ' offers more: ' + v);
  }
  assert.ok(/\{n\}/.test(T.T.sw.left) && /\{n\}/.test(T.T.en.left));
  assert.equal(T.fillN(T.T.sw.left, 7), 'Maswali yaliyobaki leo: 7');
  assert.equal(T.fillN(T.T.en.left, 0), 'Questions left today: 0');
  assert.equal(T.T.sw.lang, 'EN'); assert.equal(T.T.en.lang, 'SW', 'the language button names the language it switches TO');
});

test('the bubble\'s place: a place is always inside the screen, whatever it is asked for, and a fraction of the screen gives the same place back', () => {
  assert.equal(T.SIZE, 56); assert.equal(T.EDGE, 8); assert.equal(T.TAP_PX, 6); assert.equal(T.WIDE, 560);
  assert.equal(J(T.clampPos(1000, 1000, 400, 800)), J({ x: 336, y: 736 }));
  assert.equal(J(T.clampPos(-50, -50, 400, 800)), J({ x: 8, y: 8 }));
  assert.equal(J(T.clampPos(NaN, undefined, 400, 800)), J({ x: 8, y: 8 }), 'nothing makes it leave the screen');
  assert.equal(J(T.clampPos(100.4, 200.6, 400, 800)), J({ x: 100, y: 201 }));
  assert.equal(J(T.clampPos(50, 50, 40, 40)), J({ x: 8, y: 8 }), 'a screen smaller than the bubble does not break it');
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 400; i++) {
    const vw = 320 + Math.floor(rnd() * 2240), vh = 480 + Math.floor(rnd() * 960);
    const p = T.clampPos(rnd() * vw * 1.4 - 100, rnd() * vh * 1.4 - 100, vw, vh);
    assert.ok(p.x >= 8 && p.y >= 8 && p.x + 56 <= Math.max(vw, 72) && p.y + 56 <= Math.max(vh, 72), JSON.stringify([p, vw, vh]));
    const f = T.toFrac(p.x, p.y, vw, vh);
    assert.ok(f.fx >= 0 && f.fx <= 1 && f.fy >= 0 && f.fy <= 1, JSON.stringify(f));
    const q = T.fromFrac(f, vw, vh);
    assert.ok(Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1, 'the fraction did not give the place back: ' + JSON.stringify([p, f, q]));
    // a turned phone or a resized window: the same fraction on another screen is inside that screen
    const wx = 280 + Math.floor(rnd() * 2400), wy = 400 + Math.floor(rnd() * 1000);
    const z = T.fromFrac(f, wx, wy);
    assert.ok(z.x >= 8 && z.y >= 8 && z.x + 56 <= Math.max(wx, 72) && z.y + 56 <= Math.max(wy, 72), 'outside the other screen: ' + JSON.stringify([z, wx, wy]));
  }
  assert.equal(J(T.fromFrac({ fx: 1, fy: 1 }, 400, 800)), J({ x: 336, y: 736 }));
  assert.equal(J(T.fromFrac({ fx: 0, fy: 0 }, 400, 800)), J({ x: 8, y: 8 }));
  const d = T.defaultPos(1280, 800, 'portal'), k = T.defaultPos(390, 800, 'call');
  assert.equal(J(d), J({ x: 1212, y: 652 })); assert.equal(J(k), J({ x: 322, y: 644 }), 'the call app\'s corner is above its tab bar');
});

test('a tap is a press that moved less than six pixels, as the crow flies', () => {
  assert.equal(T.isTap(0, 0), true); assert.equal(T.isTap(5, 0), true); assert.equal(T.isTap(4, 4), true);
  assert.equal(T.isTap(6, 0), false); assert.equal(T.isTap(0, -6), false); assert.equal(T.isTap(5, 5), false);
});

test('a question is cut at what the server accepts, and whitespace is squeezed', () => {
  assert.equal(T.trimQ('  What   is\n a   portfolio call?  '), 'What is a portfolio call?');
  assert.equal(T.trimQ(null), ''); assert.equal(T.trimQ(undefined), '');
  assert.equal(T.trimQ('x'.repeat(900)).length, 400);
  assert.equal(C.MAX_QUESTION_CHARS, 400, 'the module\'s 400 is the server\'s');
  assert.ok(/e\.ta\.maxLength = MAX_Q;/.test(CODE), 'the box itself stops at the same number');
});

test('the portal loads it late and only once, by BUILD, in a try, and nothing waits for it', () => {
  const fn = strip(APP.slice(APP.indexOf('function claudianLater_()'), APP.indexOf('/* WHERE TO LAND NEXT TIME')));
  assert.ok(/if \(!S\.code \|\| window\.ClaudianPMO\) return;/.test(fn), 'not signed in, or already there: nothing');
  assert.ok(/modLoad_\('claudian'\)\.then\(function\(\)\{[\s\S]*ClaudianPMO\.mount\(\{ host: 'portal', z: 38, code: function\(\)\{ return S\.code; \}, lang: function\(\)\{ return S\.lang; \} \}\)/.test(fn), 'the portal mounts it as itself');
  assert.ok(/\}, function\(\)\{\}\);/.test(fn) && /^function claudianLater_\(\)\{\s*try \{/.test(fn.trim()), 'a module that cannot be fetched is ignored, and the whole thing is inside a try');
  assert.equal((strip(APP).match(/claudianLater_/g) || []).length, 2, 'the function and ONE call');
  assert.ok(/setTimeout\(claudianLater_, 7000\);/.test(strip(APP)), 'the one call is a seven-second timer, after the first screen\'s own reads (2.5 s)');
  assert.ok(/setTimeout\(function\(\)\{ tipsStart\(\); annCheck\(\); bellRefresh\(\); pushAsk_\(\); \}, 2500\);\s*setTimeout\(claudianLater_, 7000\);/.test(strip(APP)), 'it follows the first screen\'s reads');
  assert.ok(!/ClaudianPMO|claudian/i.test(strip(APP).replace(/function claudianLater_[\s\S]*?\n\}\n/, '').replace(/setTimeout\(claudianLater_, 7000\);/, '').replace(/wireClaudian_[^;]*;/g, '').replace(/claudian(Status|Chats|Thread|ChatsExport):1,\s*/g, '')), 'the portal page knows the helper nowhere else (its four reads in READ_FNS: the status of the Settings card, since Part 158 the two reads of the Hope Ai tab and, since Part 162, its export)');
  assert.ok(!/var BUILD = '2026-11-25-a'/.test(APP), 'BUILD moved with the front-end change');
});

test('HOPE Calls loads it eight seconds after the officer is in, at the very end of enterApp, in a try, and signing out takes it away', () => {
  const code = strip(CALL);
  const fn = code.slice(code.indexOf('function claudianLater_()'), code.indexOf('function enterApp(d){'));
  assert.ok(/^function claudianLater_\(\)\{\s*try \{/.test(fn.trim()) || /var CLAUDIAN_ASKED_ = false;\s*function claudianLater_\(\)\{\s*try \{/.test(fn.trim()), 'inside a try');
  assert.ok(/\}, 8000\);/.test(fn), 'eight seconds');
  assert.ok(/if \(!S\.entered\) \{ CLAUDIAN_ASKED_ = false; return; \}/.test(fn), 'an officer who signed out meanwhile gets nothing');
  assert.ok(/sc\.src = \(window\.HC_API_BASE \|\| ''\) \+ '\/mod\/claudian\.js\?v=' \+ encodeURIComponent\(CALL_BUILD\);/.test(fn), 'fetched by the CALL build, from the site the app is configured for');
  assert.ok(/ClaudianPMO\.mount\(\{ host: 'call', z: 38, base: window\.HC_API_BASE \|\| '', device: function\(\)\{ return DEV; \}, lang: function\(\)\{ return 'sw'; \} \}\)/.test(fn), 'the handset speaks as itself, with no access code');
  assert.ok(/sc\.onerror = function\(\)\{ CLAUDIAN_ASKED_ = false; \};/.test(fn), 'a failed fetch is asked for again at the next entry');
  const from = code.indexOf('function enterApp(d){');
  const enter = code.slice(from, code.indexOf('\n}\n', from) + 3);
  assert.ok(/\n  claudianLater_\(\);[^\n]*\n\}\n$/.test(enter), 'the call is the last statement of enterApp: nothing the app does on entry waits for it');
  assert.equal((code.match(/claudianLater_\(\)/g) || []).length, 2, 'one definition and ONE call');
  assert.ok(/function doLogout\(\)\{\s*\n(?:[^\n]*\n){1,2}\s*try \{ if \(window\.ClaudianPMO\) ClaudianPMO\.hide\(\); \} catch\(e\)\{\}/.test(code), 'signing out hides the bubble');
  assert.ok(!/var CALL_BUILD = '2026-11-24-a'/.test(CALL), 'CALL_BUILD moved with the change to the call page');
  // the sacred paths: nothing of the helper in the request that sends a day's calls, and nothing before the entry
  assert.ok(!/claudian/i.test(code.replace(/function claudianLater_[\s\S]*?\n\}\n/, '').replace(/claudianLater_\(\);[^\n]*\n/, '').replace(/try \{ if \(window\.ClaudianPMO\) ClaudianPMO\.hide\(\); \} catch\(e\)\{\}/, '').replace(/CLAUDIAN_ASKED_[^;]*;/g, '')), 'the call page knows the helper nowhere else');
});

test('the Settings card: the limits it offers are the limits the server accepts, its buttons are wired on every paint, and its status is a read', () => {
  const lim = CORE.match(/const CLAUDIAN_LIMITS = \{ userDaily: \[(\d+), (\d+)\], allDaily: \[(\d+), (\d+)\] \};/);
  assert.ok(lim, 'CLAUDIAN_LIMITS moved');
  assert.ok(new RegExp('id="cpUser" min="' + lim[1] + '" max="' + lim[2] + '"').test(ADMIN), 'the per-person box offers another range than the server accepts');
  assert.ok(new RegExp('id="cpAll" min="' + lim[3] + '" max="' + lim[4] + '"').test(ADMIN), 'the everybody box offers another range than the server accepts');
  assert.ok(new RegExp('\\(' + lim[1] + '-' + lim[2] + '\\)').test(ADMIN) && new RegExp('\\(' + lim[3] + '-' + lim[4] + '\\)').test(ADMIN), 'the labels say the same range');
  assert.ok(/if \(window\.wireClaudian_\) wireClaudian_\(\);/.test(APP), 'the core wires the card at every paint (Part 129)');
  assert.ok(/claudianStatus:1,/.test(APP), 'the status is a READ: asking for it must not empty the page\'s caches');
  assert.ok(!/claudianSet:1/.test(APP), 'and the write is not');
  const card = ADMIN.slice(ADMIN.indexOf('function cpCard_(c)'), ADMIN.indexOf('/** Redraws the card'));
  assert.ok(card.startsWith('function cpCard_(c){') && /<!--cpc-->/.test(card) && /<!--\/cpc-->/.test(card), 'the card sits between markers so a repaint keeps it');
  const view = ADMIN.slice(ADMIN.indexOf("VIEWS.settings = function(){"), ADMIN.indexOf("VIEWS.settings = function(){") + 2600);
  assert.ok(/S\.claudian = null;\s*srv\('claudianStatus'\)\.then\(function\(d\)\{ S\.claudian = d; cpPaint_\(\); \}\)/.test(view), 'the status is asked for without waiting for it, once per opening');
  assert.ok(!/Promise\.all\(\[[^\]]*claudianStatus/.test(view), 'and is not part of the screen\'s own wave of reads');
  assert.ok(/cpCard_\(S\.claudian\)/.test(ADMIN), 'the card is drawn into the screen');
});

test('the HOPE Ai icon in the bubble is the brand file\'s drawing, and its text is bent along the round face (the owner, 25 Nov: "the face is cycle but the text ain\'t")', () => {
  const brand = fs.readFileSync(path.join(ROOT, 'docs/brand/HOPE-Ai-icon.svg'), 'utf8');
  const norm = s => s.replace(/<!--[\s\S]*?-->/g, '').replace(/<title>[\s\S]*?<\/title>/, '').replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '').replace(/HEADID/g, 'head').replace(/\s+/g, ' ').replace(/> </g, '><').trim();
  assert.equal(norm(T.ICON), norm(brand), 'the bubble\'s inline icon and docs/brand/HOPE-Ai-icon.svg are two drawings: keep them one');
  const gs = [...brand.matchAll(/<g transform="translate\(([\d.]+) ([\d.]+)\) rotate\((-?[\d.]+)\) scale\(\.95\) translate\(-(\d+) -15\)">/g)].map(m => ({ x: +m[1], y: +m[2], deg: +m[3] }));
  assert.equal(gs.length, 6, 'H O P E A i: six letters, each its own turned group');
  assert.ok(!/translate\(178 314\) scale\(\.95\)/.test(brand), 'the flat text is back');
  for (let i = 1; i < gs.length; i++) { assert.ok(gs[i].x > gs[i - 1].x, 'the letters run left to right'); assert.ok(gs[i].deg < gs[i - 1].deg, 'each letter is turned less than the one before it: the left ones lean one way, the right ones the other'); }
  assert.ok(gs[0].deg > 15 && gs[5].deg < -15, 'the ends lean by more than fifteen degrees');
  const mid = Math.max(gs[2].y, gs[3].y);
  assert.ok(mid - gs[0].y >= 12 && mid - gs[5].y >= 12, 'the ends rise at least twelve units above the middle: ' + JSON.stringify(gs.map(g => g.y)));
  // on one circle: every letter is the same distance from a common centre (the middle of the text, 150 above its lowest point)
  const cx = 256, bottom = 335, r = 150, cy = bottom - r;
  for (const g of gs) assert.ok(Math.abs(Math.hypot(g.x - cx, g.y - cy) - r) < 0.35, 'a letter is off the circle: ' + JSON.stringify(g));
  // and every letter stands upright toward the centre: its turn is minus the angle it sits at
  for (const g of gs) assert.ok(Math.abs(g.deg - -Math.atan2(g.x - cx, g.y - cy) * 180 / Math.PI) < 0.35, 'a letter is not upright toward the centre: ' + JSON.stringify(g));
  // all of it inside the navy mouth: below the white line (y 288 at its lowest) and above the chin (394)
  for (const g of gs) assert.ok(g.y > 300 && g.y < 345, 'a letter left the mouth: ' + JSON.stringify(g));
});


test('THE ICON IS THE HEAD ALONE (the owner, 25 Nov: "Modify the icon by only removing the boundary only leave the head"): no ring, no disc, no round button, no box-shadow around it; the drawing is cropped to the head, and the brand file\'s drawing is the same one', () => {
  const rule = name => { const m = SRC.match(new RegExp("'\\." + name + "\\{([^']*)\\}'")); return m ? m[1] : ''; };
  const bub = SRC.slice(SRC.indexOf("'.bub{"), SRC.indexOf("'.panel{"));
  assert.ok(bub.length > 300, 'the bubble\'s rules moved: update the slice');
  const first = bub.slice(0, bub.indexOf("'.bub:focus-visible"));
  assert.ok(!/border:\s*[1-9]|border-radius:\s*50%|background:\s*#|box-shadow/.test(first), 'the bubble itself has a ring, a disc, a round shape or a shadow of its own again: ' + first);
  assert.ok(/border:0/.test(first) && /background:none/.test(first) && /padding:0/.test(first), 'the bubble is a bare button: no border, no background, no padding');
  assert.ok(!/box-shadow/.test(bub.replace(/@keyframes[^}]*\}[^}]*\}/g, '')) || !/\.bub\{[^}]*box-shadow/.test(bub), 'no box-shadow on the button');
  assert.ok(/'\.bub svg\{[^']*filter:drop-shadow\(/.test(bub), 'the lift is a shadow that follows the head\'s own outline');
  assert.ok(/'\.root\.dark \.bub svg\{[^']*drop-shadow\(0 0 1\.5px rgba\(255,255,255/.test(bub), 'on a dark page the head has a light edge so that its navy parts stay seen');
  assert.ok(/\.bub\.pulse svg\{animation:cpulse/.test(bub) && !/box-shadow:0 0 0 0 rgba/.test(bub), 'the first-sight pulse is a glow that follows the head, not a ring around a button');
  assert.ok(/\.hd \.ico\{width:36px;height:36px;flex:none\}/.test(SRC) && !/\.hd \.ico\{[^}]*(background|border-radius|padding)/.test(SRC), 'the header\'s icon is the head alone as well');
  assert.ok(!rule('hd .ico').includes('background'), 'no disc behind the header\'s head');
  // the drawing: a square window around the head (its ears and neck), nothing of the old canvas' margins
  const vb = /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)"/.exec(T.ICON);
  assert.ok(vb, 'the icon has a viewBox'); const [x, y, w, h] = vb.slice(1).map(Number);
  assert.equal(w, h, 'a square window: the bubble stays a square the drag can keep inside the screen');
  assert.ok(x <= 88 && x + w >= 424 && y <= 64 && y + h >= 442, 'the whole head, with its ears and its neck, is inside the window: ' + vb[0]);
  assert.ok(x >= 40 && y >= 40 && x + w <= 472 && y + h <= 472, 'and the window is cropped to it: the margins of the old 512 canvas are gone (the head fills the bubble)');
  const brand = fs.readFileSync(path.join(ROOT, 'docs/brand/HOPE-Ai-icon.svg'), 'utf8');
  assert.ok(!/<circle[^>]*r="2[0-9][0-9]"|<circle[^>]*cx="256"[^>]*cy="256"/.test(brand), 'the brand file has no round frame around the head');
});

test('THE TYPING BOX IS THERE FOR EVERYBODY (the owner, 25 Nov: "People ain\'t seeing the keypad to ask agent.. there are only opts"): it is not hidden while the AI is off, it takes the focus, and a typed question that found a ready answer, or none, is drawn', () => {
  assert.ok(/'\.ft\{display:flex;flex:none;/.test(SRC) && !/\.ft\{display:none/.test(SRC) && !/\.ft\.on/.test(SRC), 'the box\'s row is shown by its own rule, not by a class that only the AI-on state adds');
  assert.ok(!/st\.e\.ft\.className/.test(CODE), 'nothing switches the box off');
  assert.ok(/function openPanel\(\)[\s\S]{0,900}st\.e\.ta\.focus\(\)/.test(CODE) && !/st\.status && st\.status\.ai\) st\.e\.ta\.focus/.test(CODE), 'the box takes the focus whatever the switch says (a touch screen keeps the keyboard down)');
  // what is drawn for each answer to a typed question
  const ask = CODE.slice(CODE.indexOf('function ask()'), CODE.indexOf('function followSwitch'));
  assert.ok(/r\.mode === 'ai' \|\| r\.mode === 'canned' \|\| r\.mode === 'match'/.test(ask), 'a ready answer found for the question is drawn as an answer, a failure as a hint');
  assert.ok(/r\.mode === 'match' && r\.q \? addMsg\('w', tr\('matched'\) \+ ' ' \+ String\(r\.q\)\)/.test(ask), 'a ready answer says which ready question it answers, so a wrong guess is seen for what it is');
  assert.ok(/r\.near && r\.near\.length\) addNear\(r\.near\)/.test(ask), 'the nearest ready questions are offered as choices');
  const near = CODE.slice(CODE.indexOf('function addNear('), CODE.indexOf('function drawChips('));
  assert.ok(/el\('button', 'chip', c\.q\)/.test(near) && /b\.onclick = function \(\) \{ askFaq\(c\); \}/.test(near) && !/innerHTML/.test(near), 'a nearest question is a button with text, and a tap asks it exactly as the list does');
  assert.ok(/querySelectorAll\('\.chip'\)/.test(CODE.slice(CODE.indexOf('function setBusy'), CODE.indexOf('function addNear'))), 'every chip, the nearest ones too, is held while a question is on its way');
  // the words
  assert.equal(T.T.sw.matched, 'Jibu la swali la kawaida:'); assert.equal(T.T.en.matched, 'Ready answer to:'); assert.equal(T.T.sw.near, 'Karibu na:'); assert.equal(T.T.en.near, 'Closest:');
  for (const l of ['sw', 'en']) assert.ok(/standard questions only|maswali ya kawaida tu/.test(T.T[l].welcomeFaq), l + ': with the AI off the welcome says what the box finds');
  assert.ok(/Type your question|Andika swali lako/.test(T.T.en.welcomeFaq + T.T.sw.welcomeFaq), 'and invites typing, not only a pick');
  // the look follows the page from the start (the bubble's edge needs it), not only when the panel opens
  assert.ok(/function paintTheme\(\)/.test(CODE) && /st\.mounted = true;\s*paintTheme\(\);/.test(CODE), 'the dark look is known from the first draw');
  assert.ok(/new MutationObserver\(paintTheme\)\.observe\(document\.body, \{ attributes: true, attributeFilter: \['class'\] \}\)/.test(CODE), 'and follows the page when its own theme is switched');
});
