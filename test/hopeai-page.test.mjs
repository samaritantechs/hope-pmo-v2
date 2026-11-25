/* THE HOPE AI TAB, THE PAGE (handbook Part 158) -- the module public/mod/hopeai.js is RUN here in an empty window against stand-ins for the core page's
   helpers, with the answers the server gives (test/claudian-chats.test.mjs holds that side). What is held:

     "Have a new tab called Hope Ai in the system with rows of user chats that I could open and see what the user is chatting.. like reports of
      Claudian-PMO chats per user roles, teams and dates"                                                   -- the owner, 25 Nov 2026

   one read for the window and one for an opened chat; every pick a repaint; the boards under the list worked out from the chats the list shows, so
   the two cannot disagree; and everything a person typed drawn as TEXT. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/mod/hopeai.js'), 'utf8');
const REPORT_SRC = fs.readFileSync(path.join(ROOT, 'public/mod/hopeai-report.js'), 'utf8');
const require = createRequire(import.meta.url);

const T = (over) => ({ thread: 'k-1:2026-11-25', day: '2026-11-25', source: 'portal', name: 'JUMA G', role: 'MANAGER', zone: 'DAR CENTER', teams: 'KONGOWE, MBAGALA', lang: 'sw',
  firstAt: '2026-11-25T05:50:00Z', lastAt: '2026-11-25T06:20:00Z', n: 3, ai: 2, faq: 1, canned: 0, limit: 0, busy: 0, tokensIn: 2500, tokensOut: 100, cacheRead: 2000,
  behind: true, faqIds: { improve: 1 }, first: 'Je, nifanye nini leo?', ...over });
const ANSWER = () => ({ on: true, note: null, from: '2026-11-19', to: '2026-11-25', today: '2026-11-25', clamped: false, truncated: false, rowsRead: 9,
  faqLabels: { improve: { sw: 'Nifanye nini ili kufikia malengo?', en: 'What should I do to reach the targets?' }, targets: { sw: 'Malengo ya kampuni ni yapi?', en: 'What are the company targets?' },
    'portfolio-call': { sw: 'Simu ya portfolio ni nini?', en: 'What is a portfolio call?' } },
  threads: [
    T({ thread: 'k-2:2026-11-25', source: 'call', name: 'ASHA M', role: 'FIELD OFFICER', zone: 'DAR CENTER', teams: 'TEMEKE', n: 3, ai: 0, faq: 3, tokensIn: 0, tokensOut: 0, cacheRead: 0,
      behind: false, faqIds: { 'portfolio-call': 2, targets: 1 }, first: '', lastAt: '2026-11-25T07:01:00Z' }),
    T({}),
    T({ thread: 'k-3:2026-11-24', day: '2026-11-24', name: 'ZUBERI K', role: 'GM', teams: 'ALL', zone: 'ALL ZONES', n: 2, ai: 1, faq: 0, limit: 1, tokensIn: 900, tokensOut: 30, cacheRead: 0,
      behind: null, faqIds: {}, first: 'Dashibodi inasema nini?', lastAt: '2026-11-24T08:05:00Z' }),
    T({ thread: 'k-4:2026-11-23', day: '2026-11-23', name: '<b>EVIL</b>', role: 'A<B', teams: 'KONGOWE +3', n: 1, ai: 1, faq: 0, tokensIn: 100, tokensOut: 10, cacheRead: 0, behind: false, faqIds: {},
      first: '<img src=x onerror=alert(1)>', lastAt: '2026-11-23T08:00:00Z' }),
  ] });

/** The module run in an empty window with stand-ins for what the core page gives it. `srvAnswers` maps a function name to what the server answers. */
function load(srvAnswers = {}) {
  const calls = [], painted = [], drawn = [], toasts = [], downloads = [], confirms = [], renders = [], loaded = [];
  const els = { haExpBtn: { disabled: false, textContent: '' }, haClrBtn: { disabled: true }, haExpNote: { innerHTML: '' } };
  const win = {
    S: { args: {}, filters: {} }, VIEWS: {}, BOARDS: {}, HEAD: '', ONROW: null,
    esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    money: n => Math.round(Number(n) || 0).toLocaleString('en-US'),
    col: (key, label, kind) => ({ key, label, kind: kind || 'text' }),
    kpi: (l, v, s, cls) => '<K ' + l + '|' + v + '|' + (s || '') + '|' + (cls || '') + '>',
    bar: html => '<div class="bar">' + html + '</div>',
    sumRow: (rows, fields) => { const o = {}; fields.forEach(f => { o[f] = rows.reduce((s, r) => s + (Number(r[f]) || 0), 0); }); return o; },
    board: (id, title, sub, rows, cols, total) => { const b = { id, title, sub, rows, cols: cols.map(c => c.key), total }; win.__boards = win.__boards || {}; win.__boards[id] = b; return '[board ' + id + ']'; },
    today: () => '2026-11-25',
    addDays: (k, n) => { const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
    srv: (fn, args) => { calls.push([fn, args]); const a = srvAnswers[fn]; return Promise.resolve(typeof a === 'function' ? a(args) : a); },
    toast: (m, bad) => toasts.push([m, !!bad]),
    drawer: (html, opts) => drawn.push({ html, opts }),
    paint: keep => painted.push(!!keep),
    modLoad_: name => { loaded.push(name); if (name === 'hopeai-report' && !win.harBuild_) vm.runInContext(REPORT_SRC, win); return Promise.resolve(); },
    download: (blob, name) => downloads.push({ blob, name }),
    confirm: m => { confirms.push(m); return win.__confirm !== false; },
    render: () => renders.push(1),
    Blob: class { constructor(parts, o) { this.parts = parts; this.type = o && o.type; } },
    document: { getElementById: id => els[id] },
  };
  vm.createContext(win);
  vm.runInContext(SRC, win);
  return { win, calls, painted, drawn, toasts, downloads, confirms, renders, loaded, els };
}
/* The module runs in its own realm, so what it makes is another realm's Array and Object: compared by value, as JSON. */
const J = x => JSON.parse(JSON.stringify(x === undefined ? null : x));
const deq = (a, b, m) => assert.deepEqual(J(a), J(b), m);
const kpis = html => [...html.matchAll(/<K ([^|]*)\|([^|]*)\|([^|]*)\|([^>]*)>/g)].map(m => m.slice(1));

test('THE MODULE IS PLAIN ES5 (the Android app\'s older web views read it) and defines the one view', () => {
  require('acorn').parse(SRC, { ecmaVersion: 5 });
  const { win } = load();
  assert.equal(typeof win.VIEWS.hopeai, 'function');
});

test('OPENING THE TAB ASKS THE SERVER ONCE, for the last seven days, today included; the list has a row for each chat in the server\'s order and the counters add them up', async () => {
  const { win, calls } = load({ claudianChats: ANSWER() });
  await win.VIEWS.hopeai();
  deq(calls, [['claudianChats', { from: '2026-11-19', to: '2026-11-25' }]]);
  deq(win.S.args, { from: '2026-11-19', to: '2026-11-25' });
  deq(win.S.rows.map(r => r.name), ['ASHA M', 'JUMA G', 'ZUBERI K', '<b>EVIL</b>'], 'a row for each chat, in the order the server sent');
  deq(win.S.cols.map(c => c.key), ['lastAt', 'source', 'name', 'role', 'zone', 'teams', 'n', 'ai', 'faq', 'none', 'held', 'tokens', 'behind', 'first']);
  const k = kpis(win.HEAD);
  deq(k.map(x => x[0]), ['Mazungumzo / Chats', 'Watu / People', 'Maswali / Questions asked', 'Majibu ya AI / AI answers', 'Ya kawaida / Ready answers', 'Hakuna jibu la kawaida / No ready answer', 'Kikomo au shughuli / Limit or busy', 'Timu ziko nyuma / Chats of teams behind']);
  deq(k.map(x => x[1]), ['4', '4', '9', '4', '4', '0', '1', '1'], 'chats, people, asked 3+3+2+1, ai 0+2+1+1, ready 3+1+0+0, no ready answer, held, behind');
  assert.equal(k[3][2], 'tokens 3,640', 'tokens in and out of every chat');
  deq(win.S.rows[1], { thread: 'k-1:2026-11-25', day: '2026-11-25', lastAt: '2026-11-25T06:20:00Z', source: 'portal', name: 'JUMA G', role: 'MANAGER', zone: 'DAR CENTER',
    teams: 'KONGOWE, MBAGALA', n: 3, ai: 2, faq: 1, none: 0, held: 0, tokens: 2600, behind: true, first: 'Je, nifanye nini leo?', _t: win.S.rows[1]._t });
  assert.equal(win.S.rows[0].first, 'Maswali ya kawaida / Ready: Simu ya portfolio ni nini?; Malengo ya kampuni ni yapi?', 'a chat of ready questions only names two of them in Swahili');
  assert.equal(win.S.rows[2].held, 1, 'a limit hit counts as held');
  assert.equal(win.S.fit, 'words', 'fourteen columns: the list wraps to the card on a laptop, at spaces only, so the first question is in sight and no short column is squeezed to a few letters');
  const chip = key => win.S.cols.find(c => c.key === key);
  deq([true, false, null].map(v => chip('behind').get({ thread: 'k:2026-11-25', behind: v })), ['NYUMA / BEHIND', 'SAWA / OK', '—']);
  deq([true, false, null].map(v => chip('behind').chip({ behind: v })), ['bad', 'ok', 'mut']);
  deq(['call', 'portal'].map(v => chip('source').get({ thread: 'k:2026-11-25', source: v })), ['CALLS', 'PORTAL']);
  // the list's TOTAL row is an object with no chat in it: both chips print nothing there (a total row that said PORTAL was seen in the browser)
  deq([chip('source').get({}), chip('behind').get({})], ['', '']);
});

test('EVERY PICK IS A REPAINT, NOT A REQUEST: the filters narrow the list, the counters and the boards together, and Clear brings everything back', async () => {
  const { win, calls, painted } = load({ claudianChats: ANSWER() });
  await win.VIEWS.hopeai();
  const asked = () => kpis(win.HEAD)[2][1];
  win.haSet_('role', 'MANAGER');
  deq(win.S.rows.map(r => r.name), ['JUMA G']); assert.equal(asked(), '3'); assert.match(kpis(win.HEAD)[0][1], /^1 <span[^>]*>\/ 4<\/span>$/, 'x of N says how much of the window is on screen');
  deq(win.__boards.haRole.rows.map(r => r.role), ['MANAGER'], 'the boards follow the pick: they are the shown chats, summed');
  win.haReset_(); assert.equal(win.S.rows.length, 4);
  win.haSet_('team', 'TEMEKE'); deq(win.S.rows.map(r => r.name), ['ASHA M']);
  win.haSet_('team', 'MBAGALA'); deq(win.S.rows.map(r => r.name), ['JUMA G'], 'a person with two teams is under each');
  win.haSet_('team', 'KONGOWE'); deq(win.S.rows.map(r => r.name), ['JUMA G', '<b>EVIL</b>'], '"KONGOWE +3" is the team and a count, not a team called that');
  win.haReset_();
  win.haSet_('source', 'call'); deq(win.S.rows.map(r => r.name), ['ASHA M']); win.haReset_();
  win.haSet_('mode', 'ai'); deq(win.S.rows.map(r => r.name), ['JUMA G', 'ZUBERI K', '<b>EVIL</b>']);
  win.haSet_('mode', 'faq'); deq(win.S.rows.map(r => r.name), ['ASHA M', 'JUMA G']);
  win.haSet_('mode', 'held'); deq(win.S.rows.map(r => r.name), ['ZUBERI K']);
  win.haSet_('mode', 'typedOnly'); deq(win.S.rows.map(r => r.name), ['JUMA G', 'ZUBERI K', '<b>EVIL</b>'], 'a chat of ready questions only typed nothing'); win.haReset_();
  win.haSet_('behind', 'yes'); deq(win.S.rows.map(r => r.name), ['JUMA G']);
  win.haSet_('behind', 'no'); deq(win.S.rows.map(r => r.name), ['ASHA M', '<b>EVIL</b>'], 'on target is not the same as not known');
  win.haReset_(); assert.equal(win.S.rows.length, 4);
  assert.equal(calls.length, 1, 'one read, however many picks');
  assert.ok(painted.length >= 12 && painted.every(x => x === true), 'each pick repaints');
});

test('THE BOARDS UNDER THE LIST ARE THE LIST, SUMMED: by role, by team, by day and the ready questions tapped, each total equal to the counters', async () => {
  const { win } = load({ claudianChats: ANSWER() });
  await win.VIEWS.hopeai();
  assert.equal(win.S.tail, '[board haRole][board haTeam][board haDay][board haFaq]');
  const B = win.__boards, sum = (b, f) => b.rows.reduce((s, r) => s + r[f], 0);
  for (const id of ['haRole', 'haTeam', 'haDay']) {
    deq(B[id].cols, [id === 'haRole' ? 'role' : id === 'haTeam' ? 'team' : 'day', 'chats', 'people', 'asked', 'ai', 'faq', 'none', 'held', 'tokens', 'behind'], id);
  }
  // by role: every chat is under its one role, so the totals are the counters
  for (const f of ['chats', 'asked', 'ai', 'faq', 'none', 'held', 'tokens', 'behind']) assert.equal(B.haRole.total[f], sum(B.haRole, f), 'the total row of by-role adds its lines: ' + f);
  assert.equal(B.haRole.total.chats, 4); assert.equal(B.haRole.total.asked, 9); assert.equal(B.haRole.total.tokens, 3640);
  deq(B.haRole.rows.map(r => r.role).sort(), ['A<B', 'FIELD OFFICER', 'GM', 'MANAGER']);
  // by day: also one line for each chat's day
  deq(B.haDay.rows.map(r => [r.day, r.chats, r.asked]), [['2026-11-25', 2, 6], ['2026-11-24', 1, 2], ['2026-11-23', 1, 1]], 'newest day first');
  // by team: a person with several teams is under each, "ALL" is its own line, and a trailing "+3" is a count not a team
  const teams = Object.fromEntries(B.haTeam.rows.map(r => [r.team, r.chats]));
  deq(teams, { KONGOWE: 2, MBAGALA: 1, TEMEKE: 1, 'ALL (timu zote / every team)': 1 });
  // the ready questions: taps and chats, most tapped first, in both languages
  deq(B.haFaq.rows.map(r => [r.id, r.taps, r.chats]), [['portfolio-call', 2, 1], ['improve', 1, 1], ['targets', 1, 1]].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  assert.equal(B.haFaq.rows[0].question, 'Simu ya portfolio ni nini? / What is a portfolio call?');
  assert.equal(B.haFaq.total.taps, 4);
  assert.equal(B.haRole.sub, '2026-11-19 → 2026-11-25');
});

test('A NEW WINDOW FORGETS THE OLD PICKS (they may name nobody in it), the same window keeps them, and the date buttons carry real windows', async () => {
  const { win, calls } = load({ claudianChats: a => ({ ...ANSWER(), from: a.from, to: a.to }) });
  await win.VIEWS.hopeai();
  win.haSet_('role', 'MANAGER');
  await win.VIEWS.hopeai();                              // the same window again (a quiet refresh)
  assert.equal(win.HA.role, 'MANAGER'); assert.equal(win.S.rows.length, 1);
  win.S.args.from = '2026-11-10'; win.S.args.to = '2026-11-12';
  await win.VIEWS.hopeai();
  deq(calls[calls.length - 1], ['claudianChats', { from: '2026-11-10', to: '2026-11-12' }]);
  assert.equal(win.HA.role, ''); assert.equal(win.S.rows.length, 4);
  const buttons = [...win.HEAD.matchAll(/data-args='([^']*)'/g)].map(m => JSON.parse(m[1].replace(/&quot;/g, '"')));
  deq(buttons, [{ from: '2026-11-25', to: '2026-11-25' }, { from: '2026-11-19', to: '2026-11-25' }, { from: '2026-10-27', to: '2026-11-25' }], 'today, 7 days, 30 days');
  assert.ok(/data-arg="from" value="2026-11-10"/.test(win.HEAD) && /data-arg="to" value="2026-11-12"/.test(win.HEAD), 'the two date boxes carry the window');
  win.S.args = { from: '', to: '' };                     // cleared on purpose: the server reads its own default; the page does not invent a window
  await win.VIEWS.hopeai();
  deq(calls[calls.length - 1], ['claudianChats', { from: '', to: '' }]);
});

test('WHAT THE SERVER SAYS ABOUT THE WINDOW IS SAID: a table that was never made, a window that was cut, more chats than are shown; and an empty window is not "nobody asked"', async () => {
  const a = ANSWER(), gone = { ...a, on: false, note: 'Jedwali ... run db/RUN-ME-090-claudian-chats.sql', threads: [], faqLabels: {} };
  const { win } = load({ claudianChats: gone });
  await win.VIEWS.hopeai();
  assert.ok(win.HEAD.includes('<div class="note bad">Jedwali ... run db/RUN-ME-090-claudian-chats.sql</div>'), 'the file is named on the screen that expected it');
  deq(win.S.rows, []); assert.equal(win.S.tail, '', 'no boards of nothing');
  const w2 = load({ claudianChats: { ...a, clamped: true, truncated: true } }).win;
  await w2.VIEWS.hopeai();
  assert.ok(/newest 31 days/.test(w2.HEAD) && /There are more chats than are shown: the newest 4 are\./.test(w2.HEAD), 'cut and truncated are both said');
  const w3 = load({ claudianChats: { ...a, threads: [], faqLabels: {} } }).win;
  await w3.VIEWS.hopeai();
  deq(w3.S.rows, []); assert.ok(!/note bad/.test(w3.HEAD), 'an empty window with the table in place is an empty list, not an error');
});

test('EVERYTHING A PERSON TYPED IS DRAWN AS TEXT: a name, a role, a question with markup in it is escaped wherever this module writes HTML', async () => {
  const { win } = load({ claudianChats: ANSWER() });
  await win.VIEWS.hopeai();
  assert.ok(!/<img|<b>EVIL/.test(win.HEAD + win.S.tail + win.S.foot), 'no raw markup from a chat in the head, the boards or the foot');
  assert.ok(win.HEAD.includes('A&lt;B'), 'the role filter shows the role as text');
  assert.ok(!win.HEAD.includes('A<B') && !win.HEAD.includes('<b>EVIL'), 'and nowhere as markup: not in the option\'s value, and not in its text either');
});

test('THE CHAT\'S HEAD AND ITS ANSWERS ARE TEXT TOO: the person\'s name, role, zone and teams, and what the helper answered', async () => {
  const { win, drawn } = load({ claudianThread: { on: true, note: null, thread: 'k-9:2026-11-25', day: '2026-11-25',
    who: { name: '<img src=x onerror=1>', role: 'A<B', zone: '<i>Z</i>', teams: '<u>T</u>', source: 'call', lang: 'sw' },
    items: [{ at: '2026-11-25T05:50:00Z', mode: 'ai', faq: '', faqLabel: null, q: 'Swali', a: 'Jibu <script>window.x=1</script> la AI', tokensIn: 1, tokensOut: 1, cacheRead: 0, ms: 5, behind: null, note: '' }] } });
  win.haOpen_('k-9:2026-11-25'); await new Promise(r => setImmediate(r));
  const h = drawn[0].html;
  assert.ok(!/<img|<script|<i>|<u>|<\/i>|<\/u>/.test(h), 'no raw markup of a person or an answer: ' + h.slice(0, 300));
  for (const s of ['&lt;img src=x onerror=1&gt;', 'A&lt;B', '&lt;i&gt;Z&lt;/i&gt;', '&lt;u&gt;T&lt;/u&gt;', 'Jibu &lt;script&gt;window.x=1&lt;/script&gt; la AI']) assert.ok(h.includes(s), s);
  assert.ok(h.includes('HOPE Calls'), 'a chat from the phone app says so');
});

test('PEOPLE ARE COUNTED ONCE WHATEVER THE DAYS: one person on two days is two chats and one person; the key is the thread without its day', async () => {
  const { win } = load({});
  const o = win.haTally_([{ thread: 'k-1:2026-11-25', n: 2, ai: 1 }, { thread: 'k-1:2026-11-24', n: 1, ai: 1 }, { thread: 'k-2:2026-11-25', n: 1 }]);
  assert.equal(o.chats, 3); assert.equal(o.people, 2); assert.equal(o.asked, 4);
  assert.equal(win.haKey_({ thread: 'k-1:2026-11-25' }), 'k-1'); assert.equal(win.haKey_({ thread: 'k:with:colons:2026-11-25' }), 'k:with:colons');
});

test('ONE CHAT IN FULL: tapping a row asks for that thread; the drawer shows who, every question and answer in order as text, and its table is the Excel', async () => {
  const items = [
    { at: '2026-11-25T05:50:00Z', mode: 'ai', faq: '', faqLabel: null, q: 'Je, <script>alert(1)</script> nifanye nini?', a: 'Piga simu.\nAngalia malengo.', tokensIn: 1500, tokensOut: 40, cacheRead: 1200, ms: 900, behind: true, note: '' },
    { at: '2026-11-25T06:20:00Z', mode: 'faq', faq: 'improve', faqLabel: { sw: 'Nifanye nini ili kufikia malengo?', en: 'What should I do to reach the targets?' }, q: 'Nifanye nini ili kufikia malengo?', a: '', tokensIn: 0, tokensOut: 0, cacheRead: 0, ms: 0, behind: null, note: '' },
    { at: '2026-11-25T06:30:00Z', mode: 'busy', faq: '', faqLabel: null, q: 'Swali', a: 'Claudian-PMO ana kazi nyingi.', tokensIn: 0, tokensOut: 0, cacheRead: 0, ms: 25000, behind: null, note: 'timeout <b>x</b>' },
  ];
  const { win, calls, drawn } = load({ claudianChats: ANSWER(), claudianThread: { on: true, note: null, thread: 'k-1:2026-11-25', day: '2026-11-25',
    who: { name: 'JUMA G', role: 'MANAGER', zone: 'DAR CENTER', teams: 'KONGOWE, MBAGALA', source: 'portal', lang: 'sw' }, items } });
  await win.VIEWS.hopeai();
  win.S.rows.find(r => r.thread === 'k-1:2026-11-25') && win.ONROW(win.S.rows.find(r => r.thread === 'k-1:2026-11-25'));
  await new Promise(r => setImmediate(r));
  deq(calls[calls.length - 1], ['claudianThread', { thread: 'k-1:2026-11-25' }]);
  assert.equal(drawn.length, 1); deq(drawn[0].opts, { wide: true, xls: 'haThread' });
  const h = drawn[0].html;
  assert.ok(h.includes('JUMA G') && h.includes('MANAGER') && h.includes('2026-11-25') && h.includes('Portal') && h.includes('DAR CENTER') && h.includes('KONGOWE, MBAGALA'), 'who asked, where, when');
  assert.ok(h.includes('3 maswali / questions') && h.includes('tokens 1,500 → 40'), 'how many, and the tokens');
  assert.ok(h.includes('Je, &lt;script&gt;alert(1)&lt;/script&gt; nifanye nini?') && !h.includes('<script>'), 'a question is text');
  assert.ok(h.includes('timeout &lt;b&gt;x&lt;/b&gt;') && !h.includes('<b>x</b>'), 'a note is text');
  assert.ok(h.includes('08:50') && h.includes('09:20'), 'times in East Africa (UTC+3)');
  assert.ok(h.includes('Jibu la kawaida kutoka kwenye orodha'), 'a ready question says its answer is the catalogue\'s');
  assert.ok(h.indexOf('08:50') < h.indexOf('09:20') && h.indexOf('09:20') < h.indexOf('09:30'), 'in the order they happened');
  assert.ok(h.includes('NYUMA / BEHIND') && h.includes('SHUGHULI / BUSY') && h.includes('KAWAIDA / READY'));
  const b = win.BOARDS.haThread;
  assert.equal(b.title, 'Hope-Ai-JUMA G-2026-11-25'); assert.equal(b.rows.length, 3);
  // the ready answer a question was answered with has its own column in the chat's Excel (handbook Part 163, addendum 1): the question's words alone said nothing of which one it was
  deq(b.cols.map(c => c.key), ['at', 'mode', 'q', 'a', 'tokensIn', 'tokensOut', 'ms', 'behind', 'ready', 'note']);
  assert.equal(b.cols.find(c => c.key === 'ready').label, 'Jibu la kawaida kwa / Ready answer to');
  assert.equal(b.rows[0].a, 'Piga simu.\nAngalia malengo.'); assert.equal(b.rows[1].a, '(jibu la kawaida / ready answer)'); assert.equal(b.rows[0].mode, 'AI');
  assert.equal(b.rows[1].ready, 'Nifanye nini ili kufikia malengo? / What should I do to reach the targets?', 'the ready question, in both languages');
  assert.equal(b.rows[0].ready, '', 'a model answer names no ready question'); assert.equal(b.rows[2].ready, '');
});

/* WHAT THE TAB SAYS ABOUT NAMES IS TRUE (handbook Part 163, addendum 1): only numbers of seven digits or more are replaced before a question is kept, so the foot says that a
   customer's name or a short reference typed into a question stays as it was typed, in both languages, and still says the tab is readable by everybody it is ticked for. */
test('THE FOOT SAYS WHAT IS AND IS NOT TAKEN OUT OF A QUESTION: long numbers are replaced, a customer\'s name or a short reference is not', async () => {
  const { win } = load({ claudianChats: ANSWER() });
  await win.VIEWS.hopeai();
  const f = win.S.foot;
  assert.ok(f.includes('[namba]') && f.includes('tarakimu 7 au zaidi'), 'long numbers are replaced (Swahili)');
  assert.ok(/a customer's name or a short reference/i.test(f) && /jina la mteja/i.test(f), 'and the rest is kept as typed, said in both languages');
  assert.ok(f.includes('everybody\'s chats') || f.includes('kusoma mazungumzo ya kila mtu'), 'the reading of everybody\'s chats is still said');
});

test('THE CARDS AN ANSWER STOOD ON ARE SHOWN IN GREY, NOT IN THE RED OF A PROBLEM (handbook Part 159): "cards: a, b" beside a stop reason keeps its own colours, and both are text', async () => {
  const items = [
    { at: '2026-11-25T05:50:00Z', mode: 'ai', faq: '', faqLabel: null, q: 'Likizo?', a: 'Siku 26.', tokensIn: 1, tokensOut: 1, cacheRead: 0, ms: 5, behind: null, note: 'cards: hr-leave-balance, hr-leave-rules' },
    { at: '2026-11-25T05:51:00Z', mode: 'ai', faq: '', faqLabel: null, q: 'Notisi?', a: 'Kata', tokensIn: 1, tokensOut: 1, cacheRead: 0, ms: 5, behind: null, note: 'max_tokens · cards: legal-fine' },
    { at: '2026-11-25T05:52:00Z', mode: 'busy', faq: '', faqLabel: null, q: 'x', a: '', tokensIn: 0, tokensOut: 0, cacheRead: 0, ms: 5, behind: null, note: 'the provider did not answer <b>x</b>' },
    { at: '2026-11-25T05:53:00Z', mode: 'ai', faq: '', faqLabel: null, q: 'y', a: 'z', tokensIn: 1, tokensOut: 1, cacheRead: 0, ms: 5, behind: null, note: 'cards: <i>evil</i>' },
  ];
  const { win, drawn } = load({ claudianThread: { on: true, note: null, thread: 'k-1:2026-11-25', day: '2026-11-25', who: { name: 'JUMA G', role: 'MANAGER', zone: 'DAR CENTER', teams: 'KONGOWE', source: 'portal', lang: 'sw' }, items } });
  win.haOpen_('k-1:2026-11-25'); await new Promise(r => setImmediate(r));
  const h = drawn[0].html;
  assert.ok(/color:var\(--mut\)[^>]*>Kadi \/ Cards: hr-leave-balance, hr-leave-rules</.test(h), 'the cards are in grey, labelled in both languages');
  assert.ok(/color:var\(--bad\)[^>]*>max_tokens</.test(h) && /color:var\(--mut\)[^>]*>Kadi \/ Cards: legal-fine</.test(h), 'a stop reason stays red and the cards beside it grey');
  assert.ok(/color:var\(--bad\)[^>]*>the provider did not answer &lt;b&gt;x&lt;\/b&gt;</.test(h), 'a failure is red and text');
  assert.ok(h.includes('Kadi / Cards: &lt;i&gt;evil&lt;/i&gt;') && !h.includes('<i>evil</i>'), 'what is in a note is text');
  assert.ok(!/color:var\(--bad\)[^>]*>cards:/.test(h), 'a card list is never drawn as a problem');
});

test('THE REPORTS AN ANSWER READ ARE SHOWN TOO (handbook Part 160): "data: calls by team" in grey, and a report that was late or failed in red; both beside the cards, all as text', async () => {
  const items = [
    { at: '2026-11-25T05:50:00Z', mode: 'ai', faq: '', faqLabel: null, q: 'team gani leo hawapigi simu kabisa', a: 'ALPHA.', tokensIn: 1, tokensOut: 1, cacheRead: 0, ms: 5, behind: null, note: 'cards: legal-phone-grand · data: calls by team, last week by team' },
    { at: '2026-11-25T05:51:00Z', mode: 'ai', faq: '', faqLabel: null, q: 'x', a: 'y', tokensIn: 1, tokensOut: 1, cacheRead: 0, ms: 5, behind: null, note: 'data: calls by team (late)' },
    { at: '2026-11-25T05:52:00Z', mode: 'ai', faq: '', faqLabel: null, q: 'x', a: 'y', tokensIn: 1, tokensOut: 1, cacheRead: 0, ms: 5, behind: null, note: 'data: last week by team (failed)' },
    { at: '2026-11-25T05:53:00Z', mode: 'ai', faq: '', faqLabel: null, q: 'x', a: 'y', tokensIn: 1, tokensOut: 1, cacheRead: 0, ms: 5, behind: null, note: 'data: <b>x</b>' },
  ];
  const { win, drawn } = load({ claudianThread: { on: true, note: null, thread: 'k-1:2026-11-25', day: '2026-11-25', who: { name: 'JUMA G', role: 'MANAGER', zone: 'DAR CENTER', teams: 'KONGOWE', source: 'portal', lang: 'sw' }, items } });
  win.haOpen_('k-1:2026-11-25'); await new Promise(r => setImmediate(r));
  const h = drawn[0].html;
  assert.ok(/color:var\(--mut\)[^>]*>Kadi \/ Cards: legal-phone-grand</.test(h) && /color:var\(--mut\)[^>]*>Takwimu \/ Data: calls by team, last week by team</.test(h), 'the cards and the reports in grey, in both languages');
  assert.ok(/color:var\(--bad\)[^>]*>data: calls by team \(late\)</.test(h), 'a report that was late is red');
  assert.ok(/color:var\(--bad\)[^>]*>data: last week by team \(failed\)</.test(h), 'a report that failed is red');
  assert.ok(h.includes('Takwimu / Data: &lt;b&gt;x&lt;/b&gt;') && !h.includes('<b>x</b>'), 'text, never markup');
});

test('A CHAT THAT CANNOT BE OPENED SAYS WHY: the table not made, an empty chat, a failure of the read', async () => {
  const { win, drawn, toasts } = load({ claudianThread: { on: false, note: 'run db/RUN-ME-090', thread: 'k:2026-11-25', who: null, items: [] } });
  win.haOpen_('k:2026-11-25'); await new Promise(r => setImmediate(r));
  assert.ok(drawn[0].html.includes('<div class="note bad">run db/RUN-ME-090</div>'));
  const w2 = load({ claudianThread: { on: true, note: null, thread: 'k:2026-11-25', day: '2026-11-25', who: null, items: [] } });
  w2.win.haOpen_('k:2026-11-25'); await new Promise(r => setImmediate(r));
  assert.ok(w2.drawn[0].html.includes('Hakuna maswali kwenye mazungumzo haya. / No questions in this chat.'));
  const w3 = load({ claudianThread: () => { throw new Error('Seva imeshindwa'); } });
  w3.win.srv = () => Promise.reject(new Error('Seva imeshindwa'));
  w3.win.haOpen_('k:2026-11-25'); await new Promise(r => setImmediate(r));
  deq(w3.toasts, [['Seva imeshindwa', true]]); void win; void drawn; void toasts;
});

test('THE TAB IS REGISTERED THE WAY EVERY MODULE TAB IS: a nav entry after the audit log, its place in the management order, its module, a read the client cache survives', () => {
  const app = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'utf8');
  assert.match(app, /\{ id:'hopeai',\s+div:'mgmt', label:'Hope Ai'/, 'the nav entry, in the management division');
  assert.ok(app.indexOf("{ id:'audit',") < app.indexOf("{ id:'hopeai',"), 'directly after the audit log');
  assert.match(app.match(/var MGMT_ORDER = \[[\s\S]*?\];/)[0], /'audit', 'hopeai', 'settings'/, 'placed in the sidebar order');
  assert.match(app.match(/var MOD_OF = \{([\s\S]*?)\};/)[1], /hopeai:'hopeai'/, 'mapped to its module');
  assert.match(app, /claudianChats:1, claudianThread:1/, 'both are reads');
  assert.ok(fs.existsSync(path.join(ROOT, 'public/mod/hopeai.js')));
});


/* =====================================================================================
   THE REPORT FOR CLAUDE AND THE CLEAR, THE PAGE (handbook Part 162)

     "I need to always export a report you may need at that window of Hope Ai, then clear all existing history so that i may always deliver you with what
      went on (so that you tell me any concerns) and keep the db fresh."                                         -- the owner, 25 Nov 2026
   ===================================================================================== */
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
const rowOf = i => ({ at: '2026-11-' + String(1 + (i % 20)).padStart(2, '0') + 'T06:00:00Z', day: '2026-11-' + String(1 + (i % 20)).padStart(2, '0'), source: 'portal', name: 'JUMA G', role: 'MANAGER', teams: 'KONGOWE', zone: 'DAR CENTER', lang: 'sw',
  thread: 'k-juma:2026-11-' + String(1 + (i % 20)).padStart(2, '0'), mode: i % 5 === 4 ? 'faq' : 'ai', faq: i % 5 === 4 ? 'targets' : '', q: 'swali ' + i, a: i % 5 === 4 ? '' : 'jibu ' + i, tokensIn: 100, tokensOut: 10, cacheRead: 0, ms: 500, behind: null, note: '' });
/** The server's pages, as a stand-in: the first draws the line and counts, the rest give the line back. */
function exportServer(n, over = {}) {
  const rows = Array.from({ length: n }, (_, i) => rowOf(i)), upTo = '2026-11-25T06:00:00Z';
  return args => (n === 0 ? { on: true, upTo: null, total: 0, offset: 0, rows: [], next: null, faqLabels: {} }
    : { on: true, upTo, total: args.offset === 0 ? (over.total != null ? over.total : n) : null, offset: args.offset, rows: rows.slice(args.offset, args.offset + 500),
      next: args.offset + 500 < n ? args.offset + 500 : null, faqLabels: args.offset === 0 ? { targets: { sw: 'Malengo ya kampuni ni yapi?', en: 'What are the company targets?' } } : {} });
}
const adminAnswer = over => ({ ...ANSWER(), canClear: true, lastClear: null, ...over });
const opened = async (srvAnswers, over) => {
  const h = load({ claudianChats: adminAnswer(over), ...srvAnswers });
  h.win.S.me = { name: 'THE ADMIN', role: 'ADMIN' };
  await h.win.VIEWS.hopeai();
  return h;
};
const exportCalls = h => h.calls.filter(c => c[0] === 'claudianChatsExport');

test('THE REPORT CARD: the export button for everybody who holds the tab, the clear button for the admin alone and dead until an export, the last clear said in words, and no card when the table is not there', async () => {
  const h = await opened({}, { lastClear: { at: '2026-11-18T10:00:00.000Z', by: 'THE ADMIN', role: 'ADMIN', upTo: '2026-11-18T09:00:00Z', deleted: 412, partial: false } });
  assert.match(h.win.HEAD, /<b>Ripoti kwa Claude \/ Report for Claude<\/b>/);
  assert.match(h.win.HEAD, /<button class="btn sm" id="haExpBtn" onclick="haExport_\(\)">Pakua ripoti yote \/ Export the whole report<\/button>/);
  assert.match(h.win.HEAD, /<button class="btn sm ghost" id="haClrBtn" onclick="haClear_\(\)" disabled>Futa historia iliyopakuliwa \/ Clear what was exported<\/button>/, 'dead until an export of this visit');
  assert.match(h.win.HEAD, /Historia ilifutwa mara ya mwisho 2026-11-18 13:00 na THE ADMIN \(mazungumzo 412\) \/ History last cleared 2026-11-18 13:00 by THE ADMIN \(412 rows\)/);
  assert.match(h.win.HEAD, /ALL the history \(not only the days shown\)/);
  const holder = await opened({}, { canClear: false });
  assert.match(holder.win.HEAD, /id="haExpBtn"/); assert.ok(!/haClrBtn/.test(holder.win.HEAD), 'a role ticked for the tab has no clear button'); assert.match(holder.win.HEAD, /Clearing is for the admin only/);
  const gone = await opened({}, { on: false, note: 'RUN-ME-090 missing', threads: [] });
  assert.ok(!/haExpBtn|Ripoti kwa Claude/.test(gone.win.HEAD), 'no table, no report');
  // a repaint from a filter keeps the state of the card
  h.win.HAX.got = { upTo: '2026-11-25T06:00:00Z', count: 10, typed: 8 }; h.win.haSet_('role', 'MANAGER');
  assert.ok(!/id="haClrBtn"[^>]*disabled/.test(h.win.HEAD) && /Imepakuliwa: 10 hadi 2026-11-25 09:00/.test(h.win.HEAD), 'a pick repaints the card from its state, not from nothing');
});

test('EXPORT ASKS FOR EVERY PAGE UNTIL NONE IS ANNOUNCED, HANDS THE LINE BACK, BUILDS ONE TEXT AND SAVES IT: 1,203 rows are three asks, one file, and the clear button wakes up; the list is not repainted per page', async () => {
  const h = await opened({ claudianChatsExport: exportServer(1203) });
  const paintedBefore = h.painted.length;
  h.win.haExport_(); h.win.haExport_();                                           // a second press while it runs does nothing
  await settle();
  deq(exportCalls(h), [['claudianChatsExport', { upTo: '', offset: 0 }], ['claudianChatsExport', { upTo: '2026-11-25T06:00:00Z', offset: 500 }], ['claudianChatsExport', { upTo: '2026-11-25T06:00:00Z', offset: 1000 }]]);
  deq(h.loaded, ['hopeai-report']);
  assert.equal(h.downloads.length, 1); assert.equal(h.downloads[0].name, 'Hope-Ai-report-2026-11-25.txt'); assert.equal(h.downloads[0].blob.type, 'text/plain;charset=utf-8;');
  const text = h.downloads[0].blob.parts[0];
  assert.match(text, /^HOPE AI REPORT - /); assert.match(text, /Made: [^\n]* by THE ADMIN\n/); assert.match(text, /1,203 rows:/); assert.match(text, /END OF REPORT: .*1,203 rows/);
  assert.match(text, /ready: What are the company targets\?/, 'the labels of the ready questions came with the first page');
  deq(h.win.HAX.got, { upTo: '2026-11-25T06:00:00Z', count: 1203, typed: 963 }); assert.equal(h.win.HAX.busy, false);
  assert.equal(h.els.haClrBtn.disabled, false, 'the clear button wakes up'); assert.equal(h.els.haExpBtn.disabled, false); assert.equal(h.els.haExpBtn.textContent, 'Pakua ripoti yote / Export the whole report');
  assert.match(h.els.haExpNote.innerHTML, /Imepakuliwa: 1,203 hadi 2026-11-25 09:00\. Hifadhi faili, kisha unaweza kufuta\. \/ Exported: 1,203 rows up to 2026-11-25 09:00\. Save the file, then you may clear\./);
  assert.equal(h.painted.length, paintedBefore, 'the list was not repainted while pages arrived');
});

test('AN EXPORT THAT IS NOT WHOLE, EMPTY, REFUSED OR FAILED SAVES NOTHING AND LEAVES THE CLEAR DEAD, and says why in words', async () => {
  // fewer rows reached the page than the server counted
  const short = await opened({ claudianChatsExport: exportServer(700, { total: 705 }) });
  short.win.haExport_(); await settle();
  assert.equal(short.win.HAX.got, null); assert.equal(short.els.haClrBtn.disabled, true);
  assert.match(short.els.haExpNote.innerHTML, /Ripoti haijakamilika \(700 kati ya 705\): usifute\. Pakua tena\. \/ The report is not whole \(700 of 705\): do not clear\. Export again\./);
  assert.match(short.downloads[0].blob.parts[0], /WARNING: the server counted 705 rows when the report was drawn and 700 reached the page\./, 'the file says so too');
  // nothing on file
  const none = await opened({ claudianChatsExport: exportServer(0) });
  none.win.haExport_(); await settle();
  assert.equal(none.downloads.length, 0); assert.match(none.els.haExpNote.innerHTML, /Hakuna historia ya kupakua\. \/ There is no history to export\./); assert.equal(none.win.HAX.busy, false);
  // the table is not there
  const gone = await opened({ claudianChatsExport: () => ({ on: false, note: 'RUN-ME-090 missing' }) });
  gone.win.haExport_(); await settle();
  assert.equal(gone.downloads.length, 0); assert.match(gone.els.haExpNote.innerHTML, /RUN-ME-090 missing/);
  // a failing page, in the middle
  let n = 0; const bad = await opened({ claudianChatsExport: args => { if (++n === 2) throw new Error('database down'); return exportServer(1203)(args); } });
  bad.win.haExport_(); await settle();
  assert.equal(bad.downloads.length, 0); assert.equal(bad.win.HAX.got, null); assert.equal(bad.win.HAX.busy, false); assert.match(bad.els.haExpNote.innerHTML, /database down/); assert.equal(bad.els.haExpBtn.disabled, false, 'it can be pressed again');
});

test('CLEAR NEEDS AN EXPORT OF THIS VISIT, THE ADMIN, AND A YES: without any of them it asks the server nothing; the question names the count and the day in both languages', async () => {
  const none = await opened({ claudianChatsClear: () => ({ on: true, cleared: true, deleted: 1 }) });
  none.win.haClear_();
  assert.equal(none.confirms.length, 0); assert.equal(none.calls.filter(c => c[0] === 'claudianChatsClear').length, 0, 'no export: nothing to clear');
  const holder = await opened({ claudianChatsExport: exportServer(50), claudianChatsClear: () => ({ on: true, cleared: true, deleted: 50 }) }, { canClear: false });
  holder.win.haExport_(); await settle(); holder.win.haClear_();
  assert.equal(holder.calls.filter(c => c[0] === 'claudianChatsClear').length, 0, 'a role that may not clear cannot, whatever the page holds');
  const h = await opened({ claudianChatsExport: exportServer(50), claudianChatsClear: () => ({ on: true, cleared: true, deleted: 50, found: 50, remaining: 0, partial: false, changed: false }) });
  h.win.haExport_(); await settle();
  h.win.__confirm = false; h.win.haClear_();
  assert.equal(h.confirms.length, 1); assert.equal(h.calls.filter(c => c[0] === 'claudianChatsClear').length, 0, 'declined: nothing asked');
  assert.match(h.confirms[0], /Futa mazungumzo 50 \(maswali 40 yaliyoandikwa\) yaliyopakuliwa hadi 2026-11-25 09:00\?\n\nHaiwezi kurudishwa\./);
  assert.match(h.confirms[0], /Delete the 50 rows \(40 typed questions\) that were exported, up to 2026-11-25 09:00\?\n\nThis cannot be undone\. Make sure the report file is saved/);
});

test('CLEAR: THE LINE AND THE COUNT GO BACK TO THE SERVER; cleared shows a toast, forgets the export and reads the tab again; more on file than the report held, a part, and a failure each say so and delete nothing the page hides', async () => {
  const run = async answer => {
    const h = await opened({ claudianChatsExport: exportServer(50), claudianChatsClear: answer });
    h.win.haExport_(); await settle(); h.win.__confirm = true; h.win.haClear_(); await settle();
    return h;
  };
  const ok = await run(() => ({ on: true, cleared: true, changed: false, partial: false, found: 50, deleted: 50, remaining: 0, expected: 50 }));
  deq(ok.calls.filter(c => c[0] === 'claudianChatsClear'), [['claudianChatsClear', { upTo: '2026-11-25T06:00:00Z', expected: 50, date: '2026-11-25' }]]);
  deq(ok.toasts, [['Zimefutwa 50 / 50 rows cleared', false]]); assert.equal(ok.renders.length, 1, 'the tab reads the history again'); assert.equal(ok.win.HAX.got, null, 'the export is spent: the clear is dead again'); assert.equal(ok.win.HAX.busy, false);
  const changed = await run(() => ({ on: true, cleared: false, changed: true, found: 52, deleted: 0, expected: 50 }));
  assert.equal(changed.win.HAX.got, null); assert.equal(changed.renders.length, 0); assert.equal(changed.toasts.length, 0);
  assert.match(changed.els.haExpNote.innerHTML, /Kuna mazungumzo mengi kuliko yaliyomo kwenye ripoti \(52 dhidi ya 50\): hakuna kilichofutwa\. Pakua ripoti tena\. \/ There is more on file than the report held \(52 against 50\): nothing was deleted\. Export again\./);
  const part = await run(() => ({ on: true, cleared: false, changed: false, partial: true, found: 50, deleted: 20, remaining: 30, expected: 50 }));
  assert.ok(part.win.HAX.got, 'a part: the export still stands, so it can be pressed again'); assert.equal(part.renders.length, 0);
  assert.match(part.els.haExpNote.innerHTML, /Imefutwa 20, bado 30: bonyeza tena\. \/ 20 deleted, 30 left: press again\./);
  const missing = await run(() => ({ on: false, note: 'RUN-ME-090 missing' })); assert.match(missing.els.haExpNote.innerHTML, /RUN-ME-090 missing/);
  const fail = await run(() => Promise.reject(new Error('refused'))); assert.match(fail.els.haExpNote.innerHTML, /refused/); assert.equal(fail.win.HAX.busy, false); assert.ok(fail.win.HAX.got, 'a failed clear leaves the export as it was');
});

test('THE PAGE KNOWS WHAT IS A READ: the export is a read (it must not empty the screens\' memory), the clear is not; the build moved so every browser fetches the module; the report module is a helper, not a screen', () => {
  const app = fs.readFileSync(path.join(ROOT, 'public/app.html'), 'latin1');
  assert.match(app, /claudianChats:1, claudianThread:1, claudianChatsExport:1/); assert.ok(!/claudianChatsClear:1/.test(app), 'the clear changes things: it is not in READ_FNS');
  assert.ok(!/var BUILD = '2026-11-25-g'/.test(app), 'the build moved with the report (a later change may move it again)');
  assert.ok(/modLoad_\('hopeai-report'\)/.test(SRC) && /download\(new Blob\(\[text\], \{ type: 'text\/plain;charset=utf-8;' \}\)/.test(SRC));
  assert.ok(!/claudianChatsClear|haClear_/.test(fs.readFileSync(path.join(ROOT, 'public/mod/hopeai-report.js'), 'utf8')), 'the report module only builds a text');
});

test('A TYPED QUESTION WITH THE AI OFF (handbook Part 163): the ready answers found for typed questions count with the ready answers, the questions nothing fitted have a counter, a filter and a column of their own, and the chat opens with the ready question it answered', async () => {
  const a = ANSWER();
  a.threads.push(T({ thread: 'k-5:2026-11-25', name: 'NEEMA K', role: 'FIELD OFFICER', zone: 'DAR CENTER', teams: 'TEMEKE', source: 'call', n: 4, ai: 0, faq: 1, match: 2, nomatch: 1, tokensIn: 0, tokensOut: 0, cacheRead: 0,
    behind: null, faqIds: { targets: 1 }, first: 'nifanyeje kufikia targt', lastAt: '2026-11-25T08:00:00Z' }));
  const { win } = load({ claudianChats: a });
  await win.VIEWS.hopeai();
  const neema = win.S.rows.find(r => r.name === 'NEEMA K');
  assert.equal(neema.faq, 3, 'ready = the one tap and the two typed questions that found a ready answer'); assert.equal(neema.none, 1);
  assert.equal(neema.first, 'nifanyeje kufikia targt', 'the first question typed, though it was answered from the list');
  const k = kpis(win.HEAD), kn = Object.fromEntries(k.map(x => [x[0], x]));
  assert.equal(kn['Ya kawaida / Ready answers'][1], '7', '3+1+0+0 of the first four chats and 3 of the new one');
  assert.equal(kn['Hakuna jibu la kawaida / No ready answer'][1], '1'); assert.equal(kn['Hakuna jibu la kawaida / No ready answer'][3], 'warn', 'a question nothing fitted is the one to look at: amber');
  win.haSet_('mode', 'nomatch'); deq(win.S.rows.map(r => r.name), ['NEEMA K'], 'the filter finds the chats where a question had no ready answer');
  win.haSet_('mode', 'typedOnly'); assert.ok(win.S.rows.some(r => r.name === 'NEEMA K'), 'a chat whose typed questions were all answered from the list typed questions all the same');
  win.haSet_('mode', 'faq'); assert.ok(win.S.rows.some(r => r.name === 'NEEMA K'));
  win.haReset_();
  const B = win.__boards;
  assert.equal(B.haRole.total.none, 1); assert.equal(B.haRole.total.faq, 7);
  // the ready questions TAPPED board counts taps only
  assert.equal(B.haFaq.total.taps, 5, 'the matched questions are not taps: 4 earlier and the one tap of the new chat');
  // the chat in full
  const items = [
    { at: '2026-11-25T08:00:00Z', mode: 'match', faq: 'improve', faqLabel: { sw: 'Nifanye nini ili kufikia malengo?', en: 'What should I do to reach the targets?' }, q: 'nifanyeje kufikia targt', a: 'Anza na simu za portfolio.', tokensIn: 0, tokensOut: 0, cacheRead: 0, ms: 0, behind: null, note: 'agent off · score 1.8 · near: targets' },
    { at: '2026-11-25T08:01:00Z', mode: 'nomatch', faq: '', faqLabel: null, q: 'mshahara unaingia lini <b>x</b>', a: '', tokensIn: 0, tokensOut: 0, cacheRead: 0, ms: 0, behind: null, note: 'no key or sdk · tie' },
    { at: '2026-11-25T08:02:00Z', mode: 'busy', faq: '', faqLabel: null, q: 'z', a: '', tokensIn: 0, tokensOut: 0, cacheRead: 0, ms: 5, behind: null, note: 'the provider did not answer' },
    { at: '2026-11-25T08:03:00Z', mode: 'nomatch', faq: '', faqLabel: null, q: 'reached % yangu leo ni ngapi', a: '', tokensIn: 0, tokensOut: 0, cacheRead: 0, ms: 0, behind: null, note: 'agent off \u00b7 figure \u00b7 near: reached' },
  ];
  const w2 = load({ claudianThread: { on: true, note: null, thread: 'k-5:2026-11-25', day: '2026-11-25', who: { name: 'NEEMA K', role: 'FIELD OFFICER', zone: 'DAR CENTER', teams: 'TEMEKE', source: 'call', lang: 'sw' }, items } });
  w2.win.haOpen_('k-5:2026-11-25'); await new Promise(r => setImmediate(r));
  const h = w2.drawn[0].html;
  assert.ok(h.includes('JIBU LA KAWAIDA / READY ANSWER') && h.includes('HAKUNA JIBU / NO ANSWER'), 'both kinds are named');
  assert.ok(h.includes('Jibu la swali la kawaida / Ready answer to:') && h.includes('Nifanye nini ili kufikia malengo? / What should I do to reach the targets?'), 'the ready question a typed one found is named');
  assert.ok(h.includes('Anza na simu za portfolio.'), 'the answer the person was given');
  assert.ok(h.includes('Hakuna jibu la kawaida lililofaa. / No ready answer fitted.'), 'a question nothing fitted says so');
  assert.ok(h.includes('mshahara unaingia lini &lt;b&gt;x&lt;/b&gt;') && !h.includes('<b>x</b>'), 'what was typed is text');
  // the notes of the two kinds are information (grey), a failure is still red
  assert.ok(/color:var\(--mut\)[^>]*>AI ilikuwa imezimwa \/ The AI was off</.test(h) && /color:var\(--mut\)[^>]*>Alama ya kufanana \/ Match score: 1\.8</.test(h) && /color:var\(--mut\)[^>]*>Maswali ya karibu \/ Nearest ready questions: targets</.test(h), 'a ready answer\'s note is grey');
  assert.ok(/color:var\(--mut\)[^>]*>AI haikuwa na ufunguo \/ The AI had no key</.test(h) && /color:var\(--mut\)[^>]*>Majibu mawili yalilingana/.test(h));
  assert.ok(/color:var\(--bad\)[^>]*>the provider did not answer</.test(h), 'a failure is red');
  assert.ok(/color:var\(--mut\)[^>]*>Aliomba namba yake mwenyewe \/ Asked for a figure of their own</.test(h), 'a question that asked for the person\'s own figure says so, in grey');
  deq(w2.win.BOARDS.haThread.rows.map(r => [r.mode, r.a]), [['JIBU LA KAWAIDA / READY ANSWER', 'Anza na simu za portfolio.'], ['HAKUNA JIBU / NO ANSWER', '(hakuna jibu la kawaida / no ready answer)'], ['SHUGHULI / BUSY', ''], ['HAKUNA JIBU / NO ANSWER', '(hakuna jibu la kawaida / no ready answer)']], 'the Excel of the chat says it too');
});
