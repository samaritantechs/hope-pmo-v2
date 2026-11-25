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
  const calls = [], painted = [], drawn = [], toasts = [];
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
  };
  vm.createContext(win);
  vm.runInContext(SRC, win);
  return { win, calls, painted, drawn, toasts };
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
  deq(win.S.cols.map(c => c.key), ['lastAt', 'source', 'name', 'role', 'zone', 'teams', 'n', 'ai', 'faq', 'held', 'tokens', 'behind', 'first']);
  const k = kpis(win.HEAD);
  deq(k.map(x => x[0]), ['Mazungumzo / Chats', 'Watu / People', 'Maswali / Questions asked', 'Majibu ya AI / AI answers', 'Ya kawaida / Ready answers', 'Kikomo au shughuli / Limit or busy', 'Timu ziko nyuma / Chats of teams behind']);
  deq(k.map(x => x[1]), ['4', '4', '9', '4', '4', '1', '1'], 'chats, people, asked 3+3+2+1, ai 0+2+1+1, ready 3+1+0+0, held, behind');
  assert.equal(k[3][2], 'tokens 3,640', 'tokens in and out of every chat');
  deq(win.S.rows[1], { thread: 'k-1:2026-11-25', day: '2026-11-25', lastAt: '2026-11-25T06:20:00Z', source: 'portal', name: 'JUMA G', role: 'MANAGER', zone: 'DAR CENTER',
    teams: 'KONGOWE, MBAGALA', n: 3, ai: 2, faq: 1, held: 0, tokens: 2600, behind: true, first: 'Je, nifanye nini leo?', _t: win.S.rows[1]._t });
  assert.equal(win.S.rows[0].first, 'Maswali ya kawaida / Ready: Simu ya portfolio ni nini?; Malengo ya kampuni ni yapi?', 'a chat of ready questions only names two of them in Swahili');
  assert.equal(win.S.rows[2].held, 1, 'a limit hit counts as held');
  assert.equal(win.S.fit, 'words', 'thirteen columns: the list wraps to the card on a laptop, at spaces only, so the first question is in sight and no short column is squeezed to a few letters');
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
    deq(B[id].cols, [id === 'haRole' ? 'role' : id === 'haTeam' ? 'team' : 'day', 'chats', 'people', 'asked', 'ai', 'faq', 'held', 'tokens', 'behind'], id);
  }
  // by role: every chat is under its one role, so the totals are the counters
  for (const f of ['chats', 'asked', 'ai', 'faq', 'held', 'tokens', 'behind']) assert.equal(B.haRole.total[f], sum(B.haRole, f), 'the total row of by-role adds its lines: ' + f);
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
  deq(b.cols.map(c => c.key), ['at', 'mode', 'q', 'a', 'tokensIn', 'tokensOut', 'ms', 'behind', 'note']);
  assert.equal(b.rows[0].a, 'Piga simu.\nAngalia malengo.'); assert.equal(b.rows[1].a, '(jibu la kawaida / ready answer)'); assert.equal(b.rows[0].mode, 'AI');
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
