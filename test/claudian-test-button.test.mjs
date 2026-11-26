/* THE TEMPORARY TEST BUTTON on the Claudian-PMO card (handbook Part 162, addendum 2).

     "i think i need a temporary test button" -- the owner, 26 Nov 2026, after the helper had said "AI had no key" and the Console showed the key never used.

   One real request through the helper's own path (buildRequest: the same model, system block, thinking off, effort low), asking for one word, and an answer that says
   what happened: the answer and its cost, or the stage it stopped at and the provider's own words, and ALWAYS which host answered. Admin only, audited, refused to a
   view-only code at the one door. Nothing is written to the chat log and no person's count moves. Through the real portal dispatch, with a fake provider that
   records what it is sent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
delete process.env.ANTHROPIC_API_KEY;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { fakeDb } = await import('./fake-db.mjs');
const { portalApi } = await import('../api/_lib/portal-core.js');
const C = await import('../api/_lib/claudian.js');

const NOW = Date.UTC(2026, 10, 26, 9, 0, 0);
const KEY = 'sk-test-must-never-appear-0123456789';
const ADMIN = { code: 'AD1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['dashboard', 'settings'] };
const AUDITOR = { ...ADMIN, code: 'AU1', name: 'THE AUDITOR', role: 'AUDITOR', readOnly: true };
const CLERK = { code: 'CL1', name: 'A CLERK', role: 'CREDIT ANALYST', teams: ['KONGOWE'], tabs: ['dashboard'] };
const book = () => ({
  teams: [{ team: 'KONGOWE', team_code: 'C-K', zone: 'DAR', gmo: null, manager: null, opm: null, credit: null, recovery: null, expected: null, bike: null, branch: null }],
  access_codes: [{ code: 'AD1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['settings'] }],
  settings: [], roles: [], audit_log: [],
});
const okAnswer = (over = {}) => ({ id: 'msg_1', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'OK' }], usage: { input_tokens: 2900, output_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 2800 }, stop_reason: 'end_turn', ...over });
/** A provider that records every request it is sent and answers as told (a value, or a function returning one, or a thrown error). */
function provider(answer) {
  const sent = [];
  const client = { messages: { create: async req => { sent.push(req); const a = typeof answer === 'function' ? answer(req) : answer; if (a instanceof Error) throw a; return a; } } };
  return { client, sent };
}
/** The error the SDK throws for an HTTP failure: a status, the parsed body, the request id and a message that carries the status and the body. */
const apiError = (status, type, message, requestID = 'req_011CTESTREQUEST') => Object.assign(new Error(status + ' ' + JSON.stringify({ type: 'error', error: { type, message } })), { status, error: { type: 'error', error: { type, message } }, requestID });
async function press(db, user, { env = {}, client = null, key = true } = {}) {
  C.resetClaudianForTests();
  if (client) C.setClaudianClientForTests(client);
  const keep = {};
  for (const k of Object.keys(env)) { keep[k] = process.env[k]; process.env[k] = env[k]; }
  if (key) process.env.ANTHROPIC_API_KEY = KEY;
  try { return await portalApi(db, user, 'claudianTest', {}, NOW); }
  finally { delete process.env.ANTHROPIC_API_KEY; for (const k of Object.keys(env)) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
}

test('one real request, through the helper\'s own request: what it sends is exactly what a question sends, with a one-word message, and the answer says what it cost', async () => {
  const db = fakeDb(book());
  const p = provider(okAnswer());
  const r = await press(db, ADMIN, { client: p.client, env: { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: '7c6c34c0a9204a38ba25306e6556d105f2237ff9', VERCEL_REGION: 'iad1' } });
  assert.equal(p.sent.length, 1, 'exactly one request');
  const req = p.sent[0];
  const real = C.buildRequest('x');
  assert.equal(req.model, 'claude-haiku-5-5');
  assert.deepEqual({ ...req, messages: null }, { ...real, messages: null }, 'the same model, tokens, system block, thinking and effort as a question\'s request');
  assert.equal(req.thinking.type, 'disabled'); assert.equal(req.output_config.effort, 'low'); assert.equal(req.system[0].cache_control.type, 'ephemeral');
  assert.equal(req.messages.length, 1); assert.equal(req.messages[0].role, 'user');
  assert.match(req.messages[0].content, /single word OK/, 'it asks for one word');
  for (const k of ['temperature', 'top_p', 'top_k', 'tools', 'tool_choice', 'budget_tokens']) assert.ok(!(k in req), k + ' is not sent');
  assert.equal(r.test.ok, true); assert.equal(r.test.stage, 'ok');
  assert.equal(r.test.model, 'claude-haiku-5-5'); assert.equal(r.test.served, 'claude-haiku-5-5');
  assert.equal(r.test.answer, 'OK'); assert.equal(r.test.stop, 'end_turn');
  assert.equal(r.test.tokensIn, 5700, 'what was read and what was written to the cache both count as input'); assert.equal(r.test.tokensOut, 4);
  assert.equal(typeof r.test.ms, 'number');
  assert.deepEqual(r.test.host, { host: 'vercel', env: 'production', commit: '7c6c34c', region: 'iad1' });
  assert.equal(r.state.name, 'Claudian-PMO', 'the card gets the helper\'s state back with the result, as the switch does');
  assert.ok(!JSON.stringify(r).includes(KEY), 'the key is never sent');
});

test('no key on this host: NOTHING is sent, and the answer names the host that was asked, so the owner knows which settings to look in', async () => {
  const db = fakeDb(book());
  const p = provider(okAnswer());
  const r = await press(db, ADMIN, { client: p.client, key: false, env: { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890' } });
  assert.equal(p.sent.length, 0, 'no key: no request');
  assert.equal(r.test.ok, false); assert.equal(r.test.stage, 'key');
  assert.deepEqual(r.test.host, { host: 'vercel', env: 'preview', commit: 'abcdef1', region: null });
  const r2 = await press(db, ADMIN, { client: p.client, key: false });
  assert.equal(r2.test.host.host, 'other', 'not on Vercel: our own server or another host');
  assert.equal(r2.test.host.commit, null);
  const key = ['', '   ', '\n'];
  for (const blank of key) { process.env.ANTHROPIC_API_KEY = blank; C.resetClaudianForTests(); C.setClaudianClientForTests(p.client); const r3 = await portalApi(db, ADMIN, 'claudianTest', {}, NOW); assert.equal(r3.test.stage, 'key', JSON.stringify(blank) + ' is not a key'); }
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(p.sent.length, 0);
});

test('hostOf never carries a secret: only whether this is Vercel, its environment, the first seven characters of the commit and the region', () => {
  const h = C.hostOf({ VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'ABCDEF1234567890abcdef', VERCEL_REGION: 'fra1', ANTHROPIC_API_KEY: KEY, SUPABASE_SERVICE_ROLE_KEY: 'sb-secret', VERCEL_URL: 'x.vercel.app' });
  assert.deepEqual(h, { host: 'vercel', env: 'production', commit: 'ABCDEF1', region: 'fra1' });
  assert.ok(!JSON.stringify(h).includes(KEY) && !JSON.stringify(h).includes('sb-secret'));
  assert.deepEqual(C.hostOf({ PORT: '8080' }), { host: 'other', env: null, commit: null, region: null });
  assert.deepEqual(C.hostOf({ VERCEL_URL: 'a.vercel.app' }).host, 'vercel');
  assert.equal(C.hostOf({ VERCEL: '1', VERCEL_ENV: 'prod<script>alert(1)</script>ction' }).env, 'prodscriptalert1scriptction'.slice(0, 20), 'a value is cut to plain characters and twenty of them');
});

test('the library not installed: the stage says so and nothing is sent', async () => {
  const db = fakeDb(book());
  const r = await press(db, ADMIN, { client: null });
  C.resetClaudianForTests(); C.setClaudianClientForTests(null);
  process.env.ANTHROPIC_API_KEY = KEY;
  try { const r2 = await portalApi(db, ADMIN, 'claudianTest', {}, NOW); assert.equal(r2.test.stage, 'sdk'); assert.equal(r2.test.ok, false); }
  finally { delete process.env.ANTHROPIC_API_KEY; }
  assert.ok(r.test, 'the first call, with the real SDK and a made-up key, got as far as the provider or its refusal');
});

test('what the provider says, by kind: the status, its error type, its request id and its own words are carried; the kind is key, limit, request or busy', async () => {
  const cases = [
    [apiError(401, 'authentication_error', 'invalid x-api-key'), 'key', 401, 'authentication_error'],
    [apiError(403, 'permission_error', 'not allowed'), 'key', 403, 'permission_error'],
    [apiError(429, 'rate_limit_error', 'rate limited'), 'limit', 429, 'rate_limit_error'],
    [apiError(402, 'billing_error', 'payment required'), 'limit', 402, 'billing_error'],
    [apiError(400, 'invalid_request_error', 'Your credit balance is too low to access the API'), 'limit', 400, 'invalid_request_error'],
    [apiError(400, 'invalid_request_error', 'thinking: disabled is not supported at this effort'), 'request', 400, 'invalid_request_error'],
    [apiError(404, 'not_found_error', 'model: claude-haiku-5-5'), 'request', 404, 'not_found_error'],
    [apiError(422, 'invalid_request_error', 'unprocessable'), 'request', 422, 'invalid_request_error'],
    [apiError(500, 'api_error', 'internal error'), 'busy', 500, 'api_error'],
    [apiError(529, 'overloaded_error', 'Overloaded'), 'busy', 529, 'overloaded_error'],
    [Object.assign(new Error('Connection error.'), {}), 'busy', null, null],
  ];
  for (const [err, kind, status, type] of cases) {
    const db = fakeDb(book());
    const p = provider(err);
    const r = await press(db, ADMIN, { client: p.client });
    assert.equal(p.sent.length, 1, err.message);
    assert.equal(r.test.ok, false); assert.equal(r.test.stage, 'provider');
    assert.equal(r.test.kind, kind, err.message); assert.equal(r.test.status, status, err.message); assert.equal(r.test.type, type, err.message);
    assert.ok(r.test.words.length > 0 && r.test.words.length <= 300, 'the provider\'s own words, short');
    assert.equal(r.test.requestId, err.requestID ? 'req_011CTESTREQUEST' : null);
    assert.equal(typeof r.test.ms, 'number');
  }
});

test('a provider message that carries a key is masked, the words are cut to 300 characters, the request id and error type to plain characters, and the key of the environment is never in an answer', async () => {
  const db = fakeDb(book());
  const madeUpKey = ['sk', 'ant', 'api03', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].join('-');     // built from parts: no key-shaped text sits in the repository
  const e = apiError(401, 'auth<b>x</b>', 'invalid x-api-key ' + madeUpKey + ' ' + 'long '.repeat(200), 'req_<img src=x>1');
  const r = await press(db, ADMIN, { client: provider(e).client });
  assert.ok(!/sk-ant-/.test(JSON.stringify(r)), 'no key-looking text: ' + r.test.words.slice(0, 80));
  assert.ok(r.test.words.includes('[key]'), 'the place where a key was is marked');
  assert.ok(r.test.words.length <= 300);
  assert.match(r.test.type, /^[A-Za-z0-9_.:-]+$/); assert.match(r.test.requestId, /^[A-Za-z0-9_.:-]+$/);
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test('a provider that never answers is given up on at the limit: the stage says it did not answer, and nothing is left running', async () => {
  const never = { messages: { create: () => new Promise(() => {}) } };
  C.resetClaudianForTests();
  process.env.ANTHROPIC_API_KEY = KEY;
  try {
    const t0 = Date.now();
    const r = await C.claudianTest({ client: never, timeoutMs: 40, noGap: true });
    assert.equal(r.ok, false); assert.equal(r.stage, 'provider'); assert.equal(r.kind, 'busy'); assert.equal(r.status, null); assert.equal(r.words, 'timeout');
    assert.ok(Date.now() - t0 < 2000, 'it did not wait for the provider');
  } finally { delete process.env.ANTHROPIC_API_KEY; }
  assert.equal(C.TEST_TIMEOUT_MS, 20000, 'the real limit is twenty seconds, inside the host\'s sixty');
});

test('an empty answer from the provider is a failure of the provider, not a success', async () => {
  const db = fakeDb(book());
  const r = await press(db, ADMIN, { client: provider(null).client });
  assert.equal(r.test.ok, false); assert.equal(r.test.stage, 'provider'); assert.equal(r.test.kind, 'busy');
});

test('pressed twice inside five seconds: the second is told to wait and sends nothing; after the gap it goes through', async () => {
  const db = fakeDb(book());
  const p = provider(okAnswer());
  C.resetClaudianForTests(); C.setClaudianClientForTests(p.client);
  process.env.ANTHROPIC_API_KEY = KEY;
  try {
    const a = await portalApi(db, ADMIN, 'claudianTest', {}, NOW);
    const b = await portalApi(db, ADMIN, 'claudianTest', {}, NOW);
    assert.equal(a.test.ok, true); assert.equal(b.test.stage, 'pace'); assert.equal(b.test.ok, false);
    assert.equal(p.sent.length, 1, 'the second press sent nothing');
    const t0 = Date.now();
    const c = await C.claudianTest({ client: p.client, nowMs: t0 + C.TEST_GAP_MS + 1 });
    assert.equal(c.ok, true); assert.equal(p.sent.length, 2);
  } finally { delete process.env.ANTHROPIC_API_KEY; }
  assert.equal(C.TEST_GAP_MS, 5000);
});

test('nothing is logged and nobody is counted: no chat row, the day\'s count stays at nought, and the helper\'s memory of people is untouched', async () => {
  const db = fakeDb(book());
  const before = C.lastNote.text;
  const r = await press(db, ADMIN, { client: provider(okAnswer()).client });
  assert.equal(r.test.ok, true);
  assert.equal((db._dump('claudian_chats') || []).length, 0, 'the chat log holds no row of a test');
  assert.equal(r.state.today, 0, 'the company\'s count of the day did not move');
  assert.equal(before, ''); assert.equal(C.lastNote.text, '');
});

test('the card\'s "last problem" follows the test: a refusal sets it, and a success clears it', async () => {
  const db = fakeDb(book());
  const bad = await press(db, ADMIN, { client: provider(apiError(401, 'authentication_error', 'invalid x-api-key')).client });
  assert.equal(bad.state.lastProblem.text, 'the provider refused the key');
  await new Promise(r => setTimeout(r, 5));
  const lim = await C.claudianTest({ client: provider(apiError(429, 'rate_limit_error', 'x')).client, noGap: true });
  assert.equal(lim.kind, 'limit'); assert.equal(C.lastNote.text, 'the provider said limit or credit');
  const req = await C.claudianTest({ client: provider(apiError(400, 'invalid_request_error', 'x')).client, noGap: true });
  assert.equal(req.kind, 'request'); assert.equal(C.lastNote.text, 'the provider rejected our request');
  const good = await C.claudianTest({ client: provider(okAnswer()).client, noGap: true });
  assert.equal(good.ok, true); assert.equal(C.lastNote.text, '', 'a success clears the last problem');
});

test('only an admin can press it, a view-only code is refused at the one door, the provider is not called for either, and a press is in the audit log with who made it', async () => {
  const db = fakeDb(book());
  const p = provider(okAnswer());
  C.resetClaudianForTests(); C.setClaudianClientForTests(p.client);
  process.env.ANTHROPIC_API_KEY = KEY;
  try {
    await assert.rejects(() => portalApi(db, CLERK, 'claudianTest', {}, NOW), e => e.status === 403, 'a code without Settings is refused');
    await assert.rejects(() => portalApi(db, AUDITOR, 'claudianTest', {}, NOW), e => e.status === 403 && /view-only/.test(e.message), 'a view-only code is refused at the one door');
    assert.equal(p.sent.length, 0, 'the provider was not called for either');
    const refused = db._dump('audit_log');
    assert.equal(refused.length, 1, 'the clerk\'s attempt is on the record, as a failure; the view-only code was stopped before the record: ' + JSON.stringify(refused));
    assert.equal(refused[0].actor_code, 'CL1'); assert.equal(refused[0].ok, false); assert.equal(refused[0].action, 'claudianTest');
    await portalApi(db, ADMIN, 'claudianTest', {}, NOW);
  } finally { delete process.env.ANTHROPIC_API_KEY; }
  const log = db._dump('audit_log');
  assert.equal(log.length, 2, JSON.stringify(log));
  const mine = log.find(r => r.actor_code === 'AD1');
  assert.ok(mine, 'the admin\'s press is named');
  assert.equal(mine.ok, true); assert.equal(mine.action, 'claudianTest'); assert.equal(mine.actor_name, 'THE ADMIN');
  assert.ok(!JSON.stringify(log).includes(KEY), 'the key is in no entry');
});

test('the upload and the call app never know it: neither file, nor the call core, names the test, and portal-core reaches the helper only by an import made when it is CALLED', () => {
  for (const f of ['api/upload.js', 'api/call.js', 'api/_lib/call-core.js']) assert.ok(!/claudianTest|claudian/i.test(read(f)), f + ' knows the helper');
  const core = read('api/_lib/portal-core.js');
  assert.ok(!/^\s*import[^\n]*claudian/m.test(core));
  const fn = core.slice(core.indexOf('async function claudianTest('), core.indexOf('/* THE HOPE AI TAB'));
  assert.ok(/requireAdmin\(user\);\s*const C = await import\('\.\/claudian\.js'\);/.test(fn), 'admin first, then the lazy import');
  assert.ok(!/db\.from\(/.test(fn) && !/\.rpc\(/.test(fn), 'the press reads nothing from the database itself');
  assert.ok(/'claudianTest'/.test(read('api/_lib/audit.js')), 'it is audited, which also makes it a write the view-only wall refuses');
});

/* ---------------------------------------------------------------- the page ---------------------------------------------------------------- */
const ADMIN_JS = read('public/mod/admin.js');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const money = n => String(n);
function cardFns(S) {
  const code = ADMIN_JS.slice(ADMIN_JS.indexOf('function cpNote_(c){'), ADMIN_JS.indexOf('/** Redraws the card'));
  return new Function('esc', 'money', 'S', code + '\nreturn { cpTestHtml_: cpTestHtml_, cpCard_: cpCard_ };')(esc, money, S);
}
const STATE = { on: true, keyPresent: false, model: 'claude-haiku-5-5', userDaily: 20, allDaily: 2000, today: 0, targets: { salesCustomers: 7, salesAmount: 5000000, ecolPct: 90, colPct: 100, recPct: 120, recAmount: 700000, callsDay: 300 }, lastProblem: null };

test('the card has the button, marked temporary, in both languages; it waits for the state, and says "testing" while a test runs', () => {
  const S = { cpTest: null };
  const { cpCard_ } = cardFns(S);
  const idle = cpCard_(STATE);
  assert.match(idle, /<button class="btn sm ghost" id="cpTest">Jaribu AI \(ya muda\) \/ Test the AI \(temporary\)<\/button>/);
  assert.match(idle, /<div id="cpTestOut"[^>]*><\/div>/, 'an empty result box until there is a result');
  assert.match(cpCard_(null), /id="cpTest" disabled/, 'before the state has arrived it is disabled');
  assert.match(cpCard_({ error: 'x' }), /id="cpTest" disabled/);
  S.cpTest = { busy: true };
  const busy = cpCard_(STATE);
  assert.match(busy, /id="cpTest" disabled>Inajaribu… \/ Testing…<\/button>/);
  assert.match(busy, /Inajaribu… \/ Testing…<\/div>/, 'and the result box says so');
});

test('the result in words, every state: answered (model, time, tokens, the answer, the host), no key (with where to put it), no library, wait, and each kind of provider refusal with its own words', () => {
  const S = { cpTest: null };
  const { cpTestHtml_ } = cardFns(S);
  const host = { host: 'vercel', env: 'production', commit: '7c6c34c', region: 'iad1' };
  const ok = cpTestHtml_({ ok: true, stage: 'ok', ms: 1234, model: 'claude-haiku-5-5', served: 'claude-haiku-5-5', answer: 'OK', stop: 'end_turn', tokensIn: 5700, tokensOut: 4, cacheRead: 2800, host });
  for (const s of ['chip ok', 'AI inajibu / The AI answers', 'claude-haiku-5-5', '1234 ms', '5700 ndani / in, 4 nje / out', 'cache 2800', '&ldquo;OK&rdquo;', '<b>Vercel</b> (production) &middot; commit 7c6c34c &middot; iad1']) assert.ok(ok.includes(s), 'answered: ' + s);
  assert.ok(!ok.includes('(claude-haiku-5-5)'), 'the model the provider reports is shown only when it differs from the one we asked for');
  assert.ok(cpTestHtml_({ ok: true, stage: 'ok', ms: 1, model: 'claude-haiku-5-5', served: 'claude-haiku-5-5-20261001', answer: 'OK', tokensIn: 1, tokensOut: 1, host }).includes('(claude-haiku-5-5-20261001)'), 'and then it is');
  const nokey = cpTestHtml_({ ok: false, stage: 'key', host });
  for (const s of ['chip bad', 'Seva hii haina ufunguo / This host has no ANTHROPIC_API_KEY', 'Nothing was sent', 'Vercel: Environment Variables, Production na Preview', 'then Redeploy', '<b>Vercel</b> (production)']) assert.ok(nokey.includes(s), 'no key: ' + s);
  const other = cpTestHtml_({ ok: false, stage: 'key', host: { host: 'other', env: null, commit: null, region: null } });
  assert.ok(other.includes('<b>si Vercel / not Vercel</b>'), 'not Vercel is said');
  assert.ok(cpTestHtml_({ ok: false, stage: 'sdk', host }).includes('The Anthropic library is not installed on this host'));
  assert.ok(cpTestHtml_({ ok: false, stage: 'pace', host }).includes('Wait 5 seconds and press again'));
  const kinds = { key: 'The provider refused the key', limit: 'Limit or credit', request: 'The provider rejects our request', busy: 'The provider did not answer' };
  for (const [kind, words] of Object.entries(kinds)) {
    const h = cpTestHtml_({ ok: false, stage: 'provider', kind, status: 401, type: 'authentication_error', requestId: 'req_011X', words: 'invalid x-api-key', ms: 310, host });
    for (const s of [words, 'Hali / Status: 401', 'authentication_error', 'req_011X', '310 ms', '&ldquo;invalid x-api-key&rdquo;']) assert.ok(h.includes(s), kind + ': ' + s);
  }
  assert.ok(cpTestHtml_({ ok: false, stage: 'provider', kind: 'busy', status: null, words: '', ms: 5, host }).includes('Hali / Status: —'), 'no status is a dash, never a nought');
  const err = cpTestHtml_({ error: 'Imeshindikana / failed' });
  assert.ok(err.includes('Jaribio halikuweza kuendeshwa / The test could not run') && err.includes('Imeshindikana / failed'));
  assert.equal(cpTestHtml_(null), ''); assert.equal(cpTestHtml_(undefined), '');
});

test('everything that came from the server or the provider is drawn as TEXT: a tag in the provider\'s words, the answer, the host, the error or the model is shown, never run', () => {
  const S = { cpTest: null };
  const { cpTestHtml_ } = cardFns(S);
  const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const host = { host: 'vercel', env: evil, commit: evil, region: evil };
  const outs = [
    cpTestHtml_({ ok: true, stage: 'ok', ms: evil, model: evil, served: evil, answer: evil, stop: evil, tokensIn: 1, tokensOut: 1, cacheRead: 0, host }),
    cpTestHtml_({ ok: false, stage: 'provider', kind: 'busy', status: evil, type: evil, requestId: evil, words: evil, ms: evil, host }),
    cpTestHtml_({ ok: false, stage: 'key', host }),
    cpTestHtml_({ error: evil }),
  ];
  for (const o of outs) assert.ok(!/<img|<script/i.test(o), 'a tag was drawn as a tag: ' + o.slice(0, 200));
});

test('pressing it: the busy state shows at once, one request goes out, a second press while it runs does nothing, the result and the helper\'s state come back to the card, and a failure of the call is shown as such', async () => {
  const code = ADMIN_JS.slice(ADMIN_JS.indexOf('function cpSave_(body, btn, said){'), ADMIN_JS.indexOf('function settingVal(rows, key, dflt){'));
  const calls = []; const paints = []; const toasts = [];
  const S = { claudian: { on: true, keyPresent: false, lastProblem: null }, cpTest: null, view: 'settings' };
  const els = { cpTest: {}, cpToggle: {}, cpSave: {}, cpUser: { value: '20' }, cpAll: { value: '2000' } };
  let resolve, reject;
  const srv = (fn) => { calls.push(fn); return new Promise((res, rej) => { resolve = res; reject = rej; }); };
  const cpPaint_ = () => { paints.push(JSON.stringify(S.cpTest)); };
  const document = { getElementById: id => els[id] || null };
  const wire = new Function('S', 'srv', 'cpPaint_', 'document', 'toast', code + '\nreturn wireClaudian_;')(S, srv, cpPaint_, document, (m, bad) => toasts.push([m, !!bad]));
  wire();
  assert.equal(typeof els.cpTest.onclick, 'function', 'the button is wired by the same function every paint calls');
  els.cpTest.onclick();
  assert.deepEqual(S.cpTest, { busy: true }); assert.deepEqual(calls, ['claudianTest']); assert.deepEqual(paints, ['{"busy":true}']);
  els.cpTest.onclick();
  assert.deepEqual(calls, ['claudianTest'], 'a second press while it runs sends nothing');
  resolve({ test: { ok: true, stage: 'ok' }, state: { on: true, keyPresent: true, lastProblem: { text: 'the provider refused the key' } } });
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(S.cpTest, { ok: true, stage: 'ok' }); assert.equal(paints.length, 2);
  assert.deepEqual(S.claudian, { on: true, keyPresent: true, lastProblem: { text: 'the provider refused the key' } }, 'the helper\'s state that came back with the result replaces the card\'s (the chip and the last problem follow the test)');
  els.cpTest.onclick();
  assert.equal(calls.length, 2, 'once it has finished it can be pressed again');
  reject(new Error('Network down'));
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(S.cpTest, { error: 'Network down' }); assert.equal(paints.length, 4);
  els.cpTest.onclick(); resolve({});
  await new Promise(r => setTimeout(r, 0));
  assert.ok(S.cpTest.error, 'an answer with no test in it is an error, never a success');
});

test('the Settings screen forgets an old result when it opens (a "no key" read before a redeploy must not outlive it), and the card is wired every paint like the others', () => {
  assert.ok(/S\.claudian = null; S\.cpTest = null;\s*srv\('claudianStatus'\)/.test(ADMIN_JS), 'S.cpTest is cleared with S.claudian');
  const wire = ADMIN_JS.slice(ADMIN_JS.indexOf('function wireClaudian_(){'), ADMIN_JS.indexOf('function settingVal(rows, key, dflt){'));
  assert.ok(/getElementById\('cpTest'\)/.test(wire) && /srv\('claudianTest'\)/.test(wire));
  assert.ok(!/addEventListener|setTimeout|setInterval|focus\(/.test(wire), 'wireClaudian_ stays safe to repeat (Part 129): it only assigns handlers');
});
