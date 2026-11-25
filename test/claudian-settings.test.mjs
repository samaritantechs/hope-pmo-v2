/* CLAUDIAN-PMO'S SWITCH AND LIMITS (handbook Part 156): the two functions behind the card on Settings, through the real portal dispatch.

     "In settings- give a switch button to switch it on or off, when I switch the agen off, it shifts to FAQs only ..." -- the owner, 25 Nov 2026

   claudianStatus reads (admin screens only); claudianSet writes the three settings rows the helper reads, is audited, is refused to a
   view-only code at the one door, validates before it writes, and tells the helper to forget its memo of those rows at once. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
delete process.env.ANTHROPIC_API_KEY;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { fakeDb } = await import('./fake-db.mjs');
const { portalApi } = await import('../api/_lib/portal-core.js');
const C = await import('../api/_lib/claudian.js');

const NOW = Date.UTC(2026, 10, 25, 9, 0, 0);
const ADMIN = { code: 'AD1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['dashboard', 'settings'] };
const AUDITOR = { ...ADMIN, code: 'AU1', name: 'THE AUDITOR', role: 'AUDITOR', readOnly: true };
const CLERK = { code: 'CL1', name: 'A CLERK', role: 'CREDIT ANALYST', teams: ['KONGOWE'], tabs: ['dashboard'] };
const book = (settings = []) => ({
  teams: [{ team: 'KONGOWE', team_code: 'C-K', zone: 'DAR', gmo: null, manager: null, opm: null, credit: null, recovery: null, expected: null, bike: null, branch: null }],
  access_codes: [{ code: 'AD1', name: 'THE ADMIN', role: 'ADMIN', teams: null, tabs: ['settings'] }],
  settings, roles: [], audit_log: [],
});
const rowOf = (db, key) => (db._dump('settings').find(r => r.key === key) || {}).value;

test('the card reads the helper\'s state: off by default, the model, the limits, whether a key is there (never the key)', async () => {
  const db = fakeDb(book());
  const st = await portalApi(db, ADMIN, 'claudianStatus', {}, NOW);
  assert.equal(st.on, false);
  assert.equal(st.keyPresent, false);
  assert.equal(st.model, 'claude-haiku-5-5');
  assert.equal(st.name, 'Claudian-PMO');
  assert.equal(st.userDaily, 20);
  assert.equal(st.allDaily, 2000);
  assert.equal(st.today, 0);
  assert.deepEqual(st.targets, { salesPct: 100, salesCustomers: 7, salesAmount: 5000000, ecolPct: 90, colPct: 100, recPct: 120, recAmount: 700000, callsDay: 300 }, 'the owner\'s targets for each team, as the card shows them (Part 157)');
  process.env.ANTHROPIC_API_KEY = 'sk-test-must-never-appear-0123456789';
  try {
    C.resetClaudianForTests();
    const st2 = await portalApi(db, ADMIN, 'claudianStatus', {}, NOW);
    assert.equal(st2.keyPresent, true);
    assert.ok(!JSON.stringify(st2).includes('sk-test-must-never-appear'), 'the key itself is never sent');
  } finally { delete process.env.ANTHROPIC_API_KEY; }
});

test('only an admin screen reads or writes it: a code without Settings is refused, both ways', async () => {
  const db = fakeDb(book());
  for (const [fn, args] of [['claudianStatus', {}], ['claudianSet', { on: true }]]) {
    await assert.rejects(() => portalApi(db, CLERK, fn, args, NOW), e => e.status === 403, fn + ' was not refused');
  }
  assert.equal(rowOf(db, 'CLAUDIAN_AI'), undefined);
});

test('the switch writes ON or OFF, and the helper sees it at once (its own memo of the rows is dropped)', async () => {
  const db = fakeDb(book());
  assert.equal((await C.loadCfg(db, NOW)).on, false, 'the helper has read the switch as OFF and kept it');
  const r = await portalApi(db, ADMIN, 'claudianSet', { on: true }, NOW);
  assert.equal(rowOf(db, 'CLAUDIAN_AI'), 'ON');
  assert.deepEqual(r.saved, ['CLAUDIAN_AI']);
  assert.equal(r.state.on, true);
  assert.equal((await C.loadCfg(db, NOW + 1000)).on, true, 'a second later the helper must not still believe OFF');
  await portalApi(db, ADMIN, 'claudianSet', { on: 'OFF' }, NOW);
  assert.equal(rowOf(db, 'CLAUDIAN_AI'), 'OFF');
  assert.equal((await C.loadCfg(db, NOW + 2000)).on, false);
  for (const w of ['yes', 'ON', 'true', 1, '1']) { await portalApi(db, ADMIN, 'claudianSet', { on: w }, NOW); assert.equal(rowOf(db, 'CLAUDIAN_AI'), 'ON', String(w)); }
  for (const w of ['no', 'off', 'false', 0, '0', false]) { await portalApi(db, ADMIN, 'claudianSet', { on: w }, NOW); assert.equal(rowOf(db, 'CLAUDIAN_AI'), 'OFF', String(w)); }
});

test('the limits are whole numbers inside their range; a bad one refuses the WHOLE call and writes nothing', async () => {
  const db = fakeDb(book());
  const ok = await portalApi(db, ADMIN, 'claudianSet', { userDaily: '35', allDaily: 3000 }, NOW);
  assert.equal(rowOf(db, 'CLAUDIAN_USER_DAILY'), '35');
  assert.equal(rowOf(db, 'CLAUDIAN_ALL_DAILY'), '3000');
  assert.equal(ok.state.userDaily, 35);
  assert.equal(ok.state.allDaily, 3000);
  const before = JSON.stringify(db._dump('settings'));
  for (const bad of [
    { userDaily: 0 }, { userDaily: 201 }, { userDaily: 'abc' }, { userDaily: 1.5 }, { userDaily: true }, { userDaily: -3 }, { userDaily: '' }, { userDaily: [] }, { userDaily: null },
    { allDaily: 9 }, { allDaily: 50001 }, { allDaily: '12e3' }, { allDaily: {} },
    { on: 'maybe' }, { on: {} }, { on: true, userDaily: 0 },      // a good switch beside a bad limit: nothing at all is saved
    {}, { nothing: 1 },
  ]) {
    await assert.rejects(() => portalApi(db, ADMIN, 'claudianSet', bad, NOW), e => e.status === 400, JSON.stringify(bad) + ' was not refused');
    assert.equal(JSON.stringify(db._dump('settings')), before, JSON.stringify(bad) + ' wrote something');
  }
  for (const edge of [{ userDaily: 1 }, { userDaily: 200 }, { allDaily: 10 }, { allDaily: 50000 }]) await portalApi(db, ADMIN, 'claudianSet', edge, NOW);
});

test('a view-only code reads the card but cannot change anything: refused at the one door', async () => {
  const db = fakeDb(book());
  const st = await portalApi(db, AUDITOR, 'claudianStatus', {}, NOW);
  assert.equal(st.on, false);
  await assert.rejects(() => portalApi(db, AUDITOR, 'claudianSet', { on: true }, NOW), e => e.status === 403 && /view-only/.test(e.message));
  assert.equal(rowOf(db, 'CLAUDIAN_AI'), undefined);
});

test('a change to the switch or a limit is in the audit log, with who did it', async () => {
  const db = fakeDb(book());
  await portalApi(db, ADMIN, 'claudianSet', { on: true, userDaily: 40 }, NOW);
  const log = db._dump('audit_log');
  assert.equal(log.length, 1, JSON.stringify(log));
  assert.ok(JSON.stringify(log[0]).includes('claudianSet'), JSON.stringify(log[0]));
  assert.ok(JSON.stringify(log[0]).includes('THE ADMIN') || JSON.stringify(log[0]).includes('AD1'), 'who is named');
});

test('a person\'s next question follows the switch: ON with a key and a fake provider answers as the AI, OFF answers from the ready questions only', async () => {
  const db = fakeDb(book());
  const subject = C.portalSubject({ code: 'CL1', name: 'A CLERK', role: 'CREDIT ANALYST', teams: ['KONGOWE'], tabs: ['dashboard'] });
  let calls = 0;
  const client = { messages: { create: async () => { calls++; return { content: [{ type: 'text', text: 'Piga simu za portfolio leo.' }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' }; } } };
  C.resetClaudianForTests();
  const off = await C.claudianHandle(db, subject, { op: 'ask', q: 'What should I do today?', lang: 'en' }, { client, noGap: true, nowMs: NOW });
  assert.equal(off.mode, 'faq'); assert.equal(calls, 0);
  await portalApi(db, ADMIN, 'claudianSet', { on: true }, NOW);
  const on = await C.claudianHandle(db, subject, { op: 'ask', q: 'What should I do today?', lang: 'en' }, { client, noGap: true, nowMs: NOW + 1000 });
  assert.equal(on.mode, 'ai'); assert.equal(calls, 1);
  await portalApi(db, ADMIN, 'claudianSet', { on: false }, NOW);
  const off2 = await C.claudianHandle(db, subject, { op: 'ask', q: 'What should I do today?', lang: 'en' }, { client, noGap: true, nowMs: NOW + 2000 });
  assert.equal(off2.mode, 'faq'); assert.equal(calls, 1, 'switched off again: the provider is not called');
});

test('THE PERCENTAGE TARGETS ARE THE ROWS EVERY TABLE ALREADY COLOURS ITSELF BY: the helper reads the same three Settings rows as the portal (PCT_TARGET_KEYS), so one definition of which row is which', async () => {
  const { PCT_TARGET_KEYS } = await import('../api/_lib/portal-core.js');
  assert.deepEqual(C.TARGET_PCT_KEYS, PCT_TARGET_KEYS);
  assert.deepEqual(Object.values(C.TARGET_COUNT_KEYS).sort(), ['TARGET_CALLS_DAILY', 'TARGET_REC_AMOUNT', 'TARGET_SALES_AMOUNT_DAILY', 'TARGET_SALES_CUSTOMERS_DAILY'], 'the four rows of the owner\'s own, read by nothing else');
  const core = fs.readFileSync(path.join(ROOT, 'api/_lib/portal-core.js'), 'utf8');
  for (const k of Object.values(C.TARGET_COUNT_KEYS)) assert.ok(!core.includes("'" + k + "'"), k + ' is read by Claudian-PMO only: the portal\'s core does not know it');
});

test('the upload function never loads the helper: portal-core reaches it only by an import made when the two functions are CALLED', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/_lib/portal-core.js'), 'utf8');
  assert.ok(!/^\s*import[^\n]*claudian/m.test(src), 'portal-core.js (imported by api/upload.js) must not import the helper statically');
  assert.equal((src.match(/import\('\.\/claudian\.js'\)/g) || []).length, 2, 'one lazy import in each of the two functions');
  for (const f of ['api/upload.js', 'api/call.js', 'api/_lib/call-core.js']) assert.ok(!/claudian/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f + ' knows the helper');
});
