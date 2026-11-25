/* THE HOPE AI TAB, SERVER SIDE (handbook Part 158) --

     "Have a new tab called Hope Ai in the system with rows of user chats that I could open and see what the user is chatting.. like reports of
      Claudian-PMO chats per user roles, teams and dates"                                                   -- the owner, 25 Nov 2026

   The two reads behind the tab, through the real portal dispatch: the list (a row for each chat, a chat being one person's day with the helper)
   and one chat in full. What is shown is what the helper logged (db/RUN-ME-090). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { fakeDb } = await import('./fake-db.mjs');
const { portalApi } = await import('../api/_lib/portal-core.js');
const M = await import('../api/_lib/claudian-chats.js');

const NOW = Date.UTC(2026, 10, 25, 9, 0, 0);               // Wednesday 25 Nov 2026, noon in East Africa
const ADMIN = { code: 'AD1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['dashboard', 'settings', 'hopeai'] };
const AUDITOR = { ...ADMIN, code: 'AU1', name: 'AN AUDITOR', role: 'AUDITOR', readOnly: true };
const HOLDER = { code: 'GM1', name: 'THE GM', role: 'GM', teams: null, tabs: ['dashboard', 'hopeai'] };
const CLERK = { code: 'CL1', name: 'A CLERK', role: 'CREDIT ANALYST', teams: ['KONGOWE'], tabs: ['dashboard'] };

let seq = 0;
const R = over => ({ id: 'r' + String(++seq).padStart(5, '0'), created_at: '2026-11-25T06:00:00Z', day: '2026-11-25', source: 'portal', user_key: 'k-juma', user_name: 'JUMA G', role: 'MANAGER',
  teams: 'KONGOWE, MBAGALA', zone: 'DAR CENTER', lang: 'sw', thread: 'k-juma:2026-11-25', mode: 'ai', faq_id: null, question: 'Nifanyeje?', answer: 'Piga simu.', tokens_in: 1500,
  tokens_out: 40, cache_read: 1200, ms: 900, behind: true, note: null, ...over });
const book = rows => ({ claudian_chats: rows, access_codes: [], settings: [], roles: [], teams: [] });
const chat = (db, args = {}, user = ADMIN) => portalApi(db, user, 'claudianChats', args, NOW);
const thread = (db, t, user = ADMIN) => portalApi(db, user, 'claudianThread', { thread: t }, NOW);

const SEED = () => [
  // JUMA, today: two typed questions answered by the model and one ready question
  R({ created_at: '2026-11-25T05:50:00Z', question: 'Je, nifanye nini leo?', mode: 'ai' }),
  R({ created_at: '2026-11-25T05:55:00Z', question: 'Reached % ni nini?', mode: 'ai', tokens_in: 1000, tokens_out: 60, cache_read: 800 }),
  R({ created_at: '2026-11-25T06:20:00Z', mode: 'faq', faq_id: 'improve', question: 'Nifanye nini ili kufikia malengo?', answer: null, tokens_in: null, tokens_out: null, cache_read: null, ms: null }),
  // ASHA on the phone app, today: ready questions only, her teams were on target
  R({ id: 'a1', created_at: '2026-11-25T07:00:00Z', source: 'call', user_key: 'k-asha', user_name: 'ASHA M', role: 'FIELD OFFICER', teams: 'TEMEKE', zone: 'DAR CENTER', thread: 'k-asha:2026-11-25',
      mode: 'faq', faq_id: 'portfolio-call', question: 'Simu ya portfolio ni nini?', answer: null, tokens_in: null, tokens_out: null, cache_read: null, ms: null, behind: false }),
  R({ id: 'a2', created_at: '2026-11-25T07:01:00Z', source: 'call', user_key: 'k-asha', user_name: 'ASHA M', role: 'FIELD OFFICER', teams: 'TEMEKE', zone: 'DAR CENTER', thread: 'k-asha:2026-11-25',
      mode: 'faq', faq_id: 'targets', question: 'Malengo ya kampuni ni yapi?', answer: null, tokens_in: null, tokens_out: null, cache_read: null, ms: null, behind: false }),
  // ASHA yesterday: one answer and one limit hit
  R({ id: 'a3', created_at: '2026-11-24T08:00:00Z', day: '2026-11-24', source: 'call', user_key: 'k-asha', user_name: 'ASHA M', role: 'FIELD OFFICER', teams: 'TEMEKE', zone: 'DAR CENTER',
      thread: 'k-asha:2026-11-24', mode: 'ai', question: 'Namtafutaje mteja?', behind: null }),
  R({ id: 'a4', created_at: '2026-11-24T08:05:00Z', day: '2026-11-24', source: 'call', user_key: 'k-asha', user_name: 'ASHA M', role: 'FIELD OFFICER', teams: 'TEMEKE', zone: 'DAR CENTER',
      thread: 'k-asha:2026-11-24', mode: 'limit', question: 'Swali jingine', answer: 'Claudian-PMO ana kazi nyingi.', tokens_in: null, tokens_out: null, behind: null }),
  // far outside the seven days
  R({ id: 'old', created_at: '2026-11-01T08:00:00Z', day: '2026-11-01', thread: 'k-juma:2026-11-01', question: 'Zamani' }),
];

test('THE WINDOW: today and the six days before it to begin with; a real day is taken, junk is not; a reversed window is turned; one longer than 31 days is cut and says so', () => {
  assert.deepEqual(M.chatWindow({}, NOW), { from: '2026-11-19', to: '2026-11-25', today: '2026-11-25', clamped: false });
  assert.deepEqual(M.chatWindow({ from: '2026-11-10', to: '2026-11-12' }, NOW), { from: '2026-11-10', to: '2026-11-12', today: '2026-11-25', clamped: false });
  assert.deepEqual(M.chatWindow({ from: '2026-11-12', to: '2026-11-10' }, NOW), { from: '2026-11-10', to: '2026-11-12', today: '2026-11-25', clamped: false }, 'turned the right way');
  for (const junk of ['2026-02-31', '25/11/2026', 'x', '', null, undefined, 20261125, '2026-13-01']) {
    assert.deepEqual(M.chatWindow({ from: junk, to: junk }, NOW), { from: '2026-11-19', to: '2026-11-25', today: '2026-11-25', clamped: false }, String(junk) + ' is not a day');
  }
  assert.deepEqual(M.chatWindow({ to: '2026-11-20' }, NOW), { from: '2026-11-14', to: '2026-11-20', today: '2026-11-25', clamped: false }, 'only the end given: six days before it');
  const long = M.chatWindow({ from: '2026-01-01', to: '2026-11-25' }, NOW);
  assert.equal(long.clamped, true); assert.equal(long.to, '2026-11-25'); assert.equal(long.from, '2026-10-26', 'the newest 31 days');
  assert.equal(M.chatWindow({ from: '2026-10-26', to: '2026-11-25' }, NOW).clamped, false, 'exactly 31 days is not cut');
  assert.deepEqual(M.chatWindow(null, NOW), M.chatWindow({}, NOW));
});

test('THE LIST: a row for each person and day, newest first, with the counts of each kind, the tokens, the behind flag and the first typed question', async () => {
  const db = fakeDb(book(SEED()));
  const d = await chat(db);
  assert.equal(d.on, true); assert.equal(d.note, null);
  assert.equal(d.from, '2026-11-19'); assert.equal(d.to, '2026-11-25');
  assert.equal(d.rowsRead, 7, 'the seven rows of the window; the one of 1 Nov is outside it');
  assert.deepEqual(d.threads.map(t => t.thread), ['k-asha:2026-11-25', 'k-juma:2026-11-25', 'k-asha:2026-11-24'], 'newest chat first');
  const juma = d.threads.find(t => t.thread === 'k-juma:2026-11-25');
  assert.equal(juma.n, 3); assert.equal(juma.ai, 2); assert.equal(juma.faq, 1); assert.equal(juma.canned, 0); assert.equal(juma.limit, 0);
  assert.equal(juma.tokensIn, 2500); assert.equal(juma.tokensOut, 100); assert.equal(juma.cacheRead, 2000);
  assert.equal(juma.behind, true); assert.equal(juma.first, 'Je, nifanye nini leo?', 'the first typed question, the oldest');
  assert.deepEqual(juma.faqIds, { improve: 1 });
  assert.equal(juma.name, 'JUMA G'); assert.equal(juma.role, 'MANAGER'); assert.equal(juma.zone, 'DAR CENTER'); assert.equal(juma.teams, 'KONGOWE, MBAGALA'); assert.equal(juma.source, 'portal');
  assert.equal(juma.firstAt, '2026-11-25T05:50:00Z'); assert.equal(juma.lastAt, '2026-11-25T06:20:00Z');
  const asha = d.threads.find(t => t.thread === 'k-asha:2026-11-25');
  assert.equal(asha.source, 'call'); assert.equal(asha.n, 2); assert.equal(asha.faq, 2); assert.equal(asha.ai, 0); assert.equal(asha.first, '', 'ready questions only: no typed question');
  assert.equal(asha.behind, false);
  const yday = d.threads.find(t => t.thread === 'k-asha:2026-11-24');
  assert.equal(yday.ai, 1); assert.equal(yday.limit, 1); assert.equal(yday.behind, null, 'no figure known: neither behind nor on target');
  assert.deepEqual(d.faqLabels, { improve: { sw: 'Nifanye nini ili kufikia malengo?', en: 'What should I do to reach the targets?' }, 'portfolio-call': { sw: 'Simu ya portfolio ni nini?', en: 'What is a portfolio call?' },
    targets: { sw: 'Malengo ya kampuni ni yapi?', en: 'What are the company targets?' } }, 'the catalogue\'s words for the ready questions that were tapped');
  assert.equal(d.truncated, false);
});

test('THE LIST HOLDS NO ANSWER TEXT AND NO ACCESS CODE: only counts, the person as the system knew them, and the one-way fingerprint inside the thread id', async () => {
  const rows = SEED(); rows[0].answer = 'SECRET-ANSWER-TEXT'; rows[0].note = 'SECRET-NOTE';
  const d = await chat(fakeDb(book(rows)));
  const s = JSON.stringify(d);
  assert.ok(!s.includes('SECRET-ANSWER-TEXT') && !s.includes('SECRET-NOTE'), 'the list says what was asked first and nothing of the answers');
  for (const t of d.threads) assert.deepEqual(Object.keys(t).sort(), ['ai', 'behind', 'busy', 'cacheRead', 'canned', 'day', 'faq', 'faqIds', 'first', 'firstAt', 'lang', 'lastAt', 'limit', 'match', 'n', 'name', 'nomatch', 'role', 'source', 'teams', 'thread', 'tokensIn', 'tokensOut', 'zone'].sort());
});

test('THE PERSON IS AS THE SYSTEM KNEW THEM LAST: a role, teams, zone or name that changed during the day shows as the latest, never the first', async () => {
  const rows = [
    R({ id: 'p1', created_at: '2026-11-25T05:00:00Z', user_key: 'k-m', thread: 'k-m:2026-11-25', user_name: 'ASHA MM', role: 'FIELD OFFICER', teams: 'TEMEKE', zone: 'DAR EAST', source: 'portal', behind: true }),
    R({ id: 'p2', created_at: '2026-11-25T08:00:00Z', user_key: 'k-m', thread: 'k-m:2026-11-25', user_name: 'ASHA M', role: 'MANAGER', teams: 'KONGOWE', zone: 'DAR CENTER', source: 'call', behind: false }),
  ];
  const db = fakeDb(book(rows));
  const t = (await chat(db)).threads[0];
  assert.deepEqual({ name: t.name, role: t.role, teams: t.teams, zone: t.zone, source: t.source }, { name: 'ASHA M', role: 'MANAGER', teams: 'KONGOWE', zone: 'DAR CENTER', source: 'call' });
  assert.equal(t.firstAt, '2026-11-25T05:00:00Z'); assert.equal(t.lastAt, '2026-11-25T08:00:00Z'); assert.equal(t.behind, true, 'one row of a team behind still makes the chat behind');
  const d = await thread(db, 'k-m:2026-11-25');
  assert.deepEqual(d.who, { name: 'ASHA M', role: 'MANAGER', zone: 'DAR CENTER', teams: 'KONGOWE', source: 'call', lang: 'sw' }, 'the opened chat says the same of them');
});

test('THE FIRST QUESTION IS A SNIPPET: runs of blanks and line breaks are one space, and it is cut at SNIPPET_CHARS', async () => {
  const long = 'Swali refu '.repeat(60);                         // 660 characters
  const d = await chat(fakeDb(book([R({ id: 'q1', question: '  Mstari wa kwanza\n\n   mstari wa pili  ' + long })])));
  const f = d.threads[0].first;
  assert.equal(f.length, M.SNIPPET_CHARS); assert.ok(f.startsWith('Mstari wa kwanza mstari wa pili Swali refu Swali refu'), f);
  assert.ok(!/\s{2}|\n/.test(f), 'one line, single blanks');
});

test('THE LIST ASKS THE DATABASE FOR NO ANSWER AND NO NOTE: they are not even read, only the columns the list is made of and the typed questions', async () => {
  const db = fakeDb(book(SEED())), from = db.from.bind(db), cols = [];
  db.from = name => { const q = from(name); const sel = q.select.bind(q); q.select = (c, o) => { cols.push(String(c)); return sel(c, o); }; return q; };
  await chat(db);
  assert.ok(cols.length >= 2, 'two reads: ' + cols.length);
  for (const c of cols) assert.ok(!/\banswer\b|\bnote\b|\bms\b/.test(c), 'the list must not read ' + c);
  assert.ok(cols.some(c => c.replace(/\s/g, '') === 'thread,created_at,question'), 'the typed questions are read on their own: ' + cols.join(' | '));
});

test('THE BEHIND FLAG OF A CHAT: any row of a team behind makes it behind; only on-target rows make it on target; no figure at all is neither', async () => {
  const mk = flags => flags.map((b, i) => R({ id: 'b' + i, created_at: '2026-11-25T0' + i + ':00:00Z', behind: b, thread: 'k-x:2026-11-25', user_key: 'k-x' }));
  for (const [flags, want] of [[[false, true], true], [[true, false], true], [[false, false], false], [[null, false], false], [[null, null], null], [[null, true], true]]) {
    const d = await chat(fakeDb(book(mk(flags))));
    assert.equal(d.threads.length, 1); assert.equal(d.threads[0].behind, want, JSON.stringify(flags));
  }
});

test('THE WINDOW IS ASKED OF THE DATABASE: rows of other days are never read, and the whole list is two reads of the one table (the light columns, and the typed questions only)', async () => {
  const db = fakeDb(book(SEED()));
  const seen = []; const from = db.from.bind(db); db.from = t => { seen.push(t); return from(t); };
  const d = await chat(db, { from: '2026-11-24', to: '2026-11-24' });
  assert.equal(d.rowsRead, 2); assert.deepEqual(d.threads.map(t => t.thread), ['k-asha:2026-11-24']);
  // the two reads of the chats table, and the one settings row that holds the note of the last clear (Part 162), read through the memo the whole portal reads
  assert.ok(seen.filter(t => t === 'claudian_chats').length >= 2 && seen.every(t => t === 'claudian_chats' || t === 'settings'), 'only the chats table and the one settings row: ' + seen.join(','));
  assert.ok(seen.filter(t => t === 'settings').length <= 1, 'the settings are read once: ' + seen.join(','));
  assert.ok(seen.length <= 5, 'two reads of the chats, a page each, and the settings: ' + seen.length);
  const none = await chat(db, { from: '2026-10-01', to: '2026-10-05' });
  assert.equal(none.on, true); assert.deepEqual(none.threads, []); assert.equal(none.rowsRead, 0);
});

test('A CHAT IS A PERSON AND A DAY: two people with the same name are two chats, and one person on two days is two', async () => {
  const rows = [R({ id: 'x1', user_key: 'k-1', thread: 'k-1:2026-11-25', user_name: 'SAME NAME' }), R({ id: 'x2', user_key: 'k-2', thread: 'k-2:2026-11-25', user_name: 'SAME NAME' }),
    R({ id: 'x3', user_key: 'k-1', thread: 'k-1:2026-11-24', day: '2026-11-24', created_at: '2026-11-24T06:00:00Z', user_name: 'SAME NAME' })];
  const d = await chat(fakeDb(book(rows)));
  assert.deepEqual(d.threads.map(t => t.thread).sort(), ['k-1:2026-11-24', 'k-1:2026-11-25', 'k-2:2026-11-25']);
});

test('MORE CHATS THAN CAN BE SHOWN: the newest are kept and the list says so', async () => {
  const rows = [];
  for (let i = 0; i < M.CHATS_MAX_THREADS + 7; i++) rows.push(R({ id: 'm' + i, user_key: 'k' + i, thread: 'k' + i + ':2026-11-25', created_at: '2026-11-25T05:' + String(Math.floor(i / 60) % 60).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') + 'Z' }));
  const d = await chat(fakeDb(book(rows)));
  assert.equal(d.truncated, true); assert.equal(d.threads.length, M.CHATS_MAX_THREADS); assert.equal(d.rowsRead, M.CHATS_MAX_THREADS + 7);
  const lastAts = d.threads.map(t => t.lastAt);
  assert.deepEqual(lastAts, lastAts.slice().sort().reverse(), 'newest first, and it is the oldest seven that were dropped');
});

test('ONE CHAT IN FULL: every question and tap of that person and day in order, who asked, the answers, and the catalogue\'s words for a ready question; nobody else\'s rows', async () => {
  const db = fakeDb(book(SEED()));
  const d = await thread(db, 'k-juma:2026-11-25');
  assert.equal(d.on, true); assert.equal(d.thread, 'k-juma:2026-11-25'); assert.equal(d.day, '2026-11-25');
  assert.deepEqual(d.who, { name: 'JUMA G', role: 'MANAGER', zone: 'DAR CENTER', teams: 'KONGOWE, MBAGALA', source: 'portal', lang: 'sw' });
  assert.deepEqual(d.items.map(x => x.mode), ['ai', 'ai', 'faq'], 'in the order they happened');
  assert.equal(d.items[0].q, 'Je, nifanye nini leo?'); assert.equal(d.items[0].a, 'Piga simu.'); assert.equal(d.items[0].tokensIn, 1500); assert.equal(d.items[0].cacheRead, 1200); assert.equal(d.items[0].ms, 900);
  assert.equal(d.items[2].faq, 'improve'); assert.deepEqual(d.items[2].faqLabel, { sw: 'Nifanye nini ili kufikia malengo?', en: 'What should I do to reach the targets?' }); assert.equal(d.items[2].a, '');
  assert.equal(d.items[0].behind, true);
  const lim = await thread(db, 'k-asha:2026-11-24');
  assert.deepEqual(lim.items.map(x => x.mode), ['ai', 'limit']); assert.equal(lim.items[1].a, 'Claudian-PMO ana kazi nyingi.'); assert.equal(lim.items[1].behind, null);
  assert.equal(lim.who.source, 'call');
  const none = await thread(db, 'k-nobody:2026-11-25');
  assert.equal(none.on, true); assert.deepEqual(none.items, []); assert.equal(none.who, null);
});

test('A THREAD THAT IS NOT A CHAT OF THE LIST IS REFUSED, whatever it holds', async () => {
  const db = fakeDb(book(SEED()));
  for (const bad of ['', 'k-juma', 'k-juma:2026-11-31', 'k-juma:25/11/2026', ':2026-11-25', 'k:2026-11-25', 'x'.repeat(200) + ':2026-11-25', undefined, null, 5, {}, ['k-juma:2026-11-25']]) {
    await assert.rejects(() => portalApi(db, ADMIN, 'claudianThread', { thread: bad }, NOW), e => e.status === 400, JSON.stringify(bad) + ' was not refused');
  }
  await assert.rejects(() => portalApi(db, ADMIN, 'claudianThread', {}, NOW), e => e.status === 400);
});

test('WHEN THE TABLE IS NOT THERE (RUN-ME-090 not run) THE TAB SAYS SO instead of an empty list; any other failure is a failure', async () => {
  const gone = fakeDb(book([]), { missingTables: ['claudian_chats'] });
  const d = await chat(gone);
  assert.equal(d.on, false); assert.ok(/RUN-ME-090/.test(d.note), d.note); assert.deepEqual(d.threads, []);
  const t = await thread(gone, 'k-juma:2026-11-25');
  assert.equal(t.on, false); assert.ok(/RUN-ME-090/.test(t.note)); assert.deepEqual(t.items, []);
  const db = fakeDb(book(SEED())), from = db.from.bind(db);
  db.from = name => { const q = from(name); if (name === 'claudian_chats') q.rejectWith = { code: '42501', message: 'permission denied for table claudian_chats' }; return q; };
  const refused = e => /permission denied/.test(String((e && e.message) || e));
  await assert.rejects(() => chat(db), refused, 'a refusal is not a missing table');
  await assert.rejects(() => thread(db, 'k-juma:2026-11-25'), refused);
});

test('WHO MAY READ THEM: the tab is granted like the audit log: the admin, a view-only supervisor and a role that was ticked; nobody else, on either function', async () => {
  const db = fakeDb(book(SEED()));
  for (const u of [ADMIN, AUDITOR, HOLDER]) {
    assert.equal((await chat(db, {}, u)).threads.length, 3, u.name);
    assert.equal((await thread(db, 'k-juma:2026-11-25', u)).items.length, 3, u.name);
  }
  for (const fn of ['claudianChats', 'claudianThread']) {
    await assert.rejects(() => portalApi(db, CLERK, fn, { thread: 'k-juma:2026-11-25' }, NOW), e => e.status === 403, fn + ' was not refused to a code without the tab');
  }
});

test('THE TAB IS NAMED ONCE AND REACHED THE WAY EVERY TAB IS: in EXTRA_TABS (so an admin and the role editor have it), gated by FN_TAB, and the reads are not writes', async () => {
  const { ADMIN_TABS, EXTRA_TABS, USER_TABS } = await import('../api/_lib/auth.js');
  assert.ok(EXTRA_TABS.includes('hopeai') && ADMIN_TABS.includes('hopeai') && !USER_TABS.includes('hopeai'), 'admin from the start, a role when ticked');
  const core = fs.readFileSync(path.join(ROOT, 'api/_lib/portal-core.js'), 'utf8');
  assert.match(core, /claudianChats: \['hopeai'\], claudianThread: \['hopeai'\]/, 'gated on its own tab');
  const { AUDITED } = await import('../api/_lib/audit.js');
  assert.ok(!AUDITED.has ? !AUDITED.includes('claudianChats') && !AUDITED.includes('claudianThread') : !AUDITED.has('claudianChats') && !AUDITED.has('claudianThread'), 'reading chats writes nothing: not an audited write');
});

test('THE UPLOAD AND THE CALL APP NEVER LOAD IT: portal-core reaches the reader only through an import made when the two functions are CALLED, and neither function of the two paths knows its name', () => {
  const core = fs.readFileSync(path.join(ROOT, 'api/_lib/portal-core.js'), 'utf8');
  assert.ok(!/^\s*import[^\n]*claudian-chats/m.test(core), 'portal-core.js (imported by api/upload.js) must not import the reader statically');
  assert.equal((core.match(/import\('\.\/claudian-chats\.js'\)/g) || []).length, 4, 'one lazy import in each of the four functions (the list, one chat, the report, the clear)');
  for (const f of ['api/upload.js', 'api/call.js', 'api/_lib/call-core.js']) assert.ok(!/claudian-chats|claudianChats|claudianThread/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f + ' knows the reader');
});

test('A TYPED QUESTION WITH THE AI OFF (Part 163): a MATCH (answered from a ready answer) and a NO ANSWER are counted on their own, are typed questions (the first one shows), and only a TAP is counted as a ready question tapped', async () => {
  const rows = [
    R({ id: 'm1', created_at: '2026-11-25T05:00:00Z', user_key: 'k-neema', user_name: 'NEEMA K', role: 'FIELD OFFICER', thread: 'k-neema:2026-11-25', mode: 'match', faq_id: 'improve', question: 'nifanyeje kufikia targt', answer: 'Anza na simu za portfolio.', tokens_in: 0, tokens_out: 0, cache_read: null, ms: null, behind: null, note: 'agent off \u00b7 score 1.8 \u00b7 near: targets' }),
    R({ id: 'm2', created_at: '2026-11-25T05:01:00Z', user_key: 'k-neema', user_name: 'NEEMA K', role: 'FIELD OFFICER', thread: 'k-neema:2026-11-25', mode: 'nomatch', faq_id: null, question: 'mshahara unaingia lini', answer: null, tokens_in: 0, tokens_out: 0, cache_read: null, ms: null, behind: null, note: 'agent off' }),
    R({ id: 'm3', created_at: '2026-11-25T05:02:00Z', user_key: 'k-neema', user_name: 'NEEMA K', role: 'FIELD OFFICER', thread: 'k-neema:2026-11-25', mode: 'faq', faq_id: 'targets', question: 'Malengo ya kampuni ni yapi?', answer: null, tokens_in: null, tokens_out: null, cache_read: null, ms: null, behind: null }),
  ];
  const d = await chat(fakeDb(book(rows)));
  assert.equal(d.threads.length, 1);
  const t = d.threads[0];
  assert.equal(t.n, 3); assert.equal(t.match, 1); assert.equal(t.nomatch, 1); assert.equal(t.faq, 1); assert.equal(t.ai, 0);
  assert.equal(t.first, 'nifanyeje kufikia targt', 'a typed question that found a ready answer is still the first question typed');
  assert.deepEqual(t.faqIds, { targets: 1 }, 'only a tap is a ready question tapped: the matched question is counted as a match, not as a tap');
  assert.equal(d.faqLabels.targets.en, 'What are the company targets?');
  assert.ok(!d.faqLabels.improve, 'a label is kept for the questions that were tapped');
  // the chat in full: the typed question, the answer it was given, the ready question it answered, and what the note says
  const th = await thread(fakeDb(book(rows)), t.thread);
  const m1 = th.items.find(x => x.mode === 'match'), m2 = th.items.find(x => x.mode === 'nomatch');
  assert.equal(m1.q, 'nifanyeje kufikia targt'); assert.equal(m1.a, 'Anza na simu za portfolio.'); assert.equal(m1.faq, 'improve'); assert.equal(m1.faqLabel.en, 'What should I do to reach the targets?'); assert.match(m1.note, /near: targets/);
  assert.equal(m2.q, 'mshahara unaingia lini'); assert.equal(m2.a, ''); assert.equal(m2.faq, '');
});
