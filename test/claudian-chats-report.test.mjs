/* THE REPORT FOR CLAUDE AND THE CLEAR, SERVER SIDE (handbook Part 162) --

     "I need to always export a report you may need at that window of Hope Ai, then clear all existing history so that i may always deliver you with what
      went on (so that you tell me any concerns) and keep the db fresh."                                         -- the owner, 25 Nov 2026

   Through the real portal dispatch: the export (every row on file, a page at a time, drawn at the newest row's own time so that a chat written while the
   report is made is not in it and is not cleared with it) and the clear (admin only, audited, only what the report held, refusing when there is more than
   the report held, whole slices of days, pressed again when cut short), and the note it leaves for the tab. */
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

const pad = n => String(n).padStart(2, '0');
let seq = 0;
const R = over => ({ id: 'r' + String(++seq).padStart(6, '0'), created_at: '2026-11-25T06:00:00Z', day: '2026-11-25', source: 'portal', user_key: 'k-juma', user_name: 'JUMA G', role: 'MANAGER',
  teams: 'KONGOWE, MBAGALA', zone: 'DAR CENTER', lang: 'sw', thread: 'k-juma:2026-11-25', mode: 'ai', faq_id: null, question: 'Nifanyeje?', answer: 'Piga simu.', tokens_in: 1500,
  tokens_out: 40, cache_read: 1200, ms: 900, behind: true, note: 'cards: calls-count-and-reached', ...over });
/** n rows spread over days 1 to 20 of November, every one different (its question says which), oldest first by their own times. */
const MANY = n => Array.from({ length: n }, (_, i) => {
  const day = 1 + (i % 20), at = '2026-11-' + pad(day) + 'T' + pad(5 + (i % 12)) + ':' + pad(i % 60) + ':' + pad((i * 7) % 60) + 'Z';
  return R({ created_at: at, day: '2026-11-' + pad(day), question: 'q' + i, thread: 'k-juma:2026-11-' + pad(day) });
});
const book = (rows, extra = {}) => ({ claudian_chats: rows, access_codes: [], settings: [], roles: [], teams: [], audit_log: [], ...extra });
const exp = (db, args = {}, user = ADMIN) => portalApi(db, user, 'claudianChatsExport', args, NOW);
const clr = (db, args, user = ADMIN, now = NOW) => portalApi(db, user, 'claudianChatsClear', args, now);
const left = db => db._dump('claudian_chats').length;
/** The whole report as the page asks for it: every page, until none is announced. */
async function everything(db, user = ADMIN) {
  const rows = []; let upTo = '', total = null, offset = 0, pages = 0;
  for (;;) {
    const d = await exp(db, { upTo, offset }, user);
    if (offset === 0) { upTo = d.upTo; total = d.total; if (!upTo) return { rows, upTo: null, total: 0, pages: 1 }; }
    rows.push(...d.rows); pages++;
    if (d.next == null) break;
    offset = d.next;
  }
  return { rows, upTo, total, pages };
}

test('THE EXPORT GIVES EVERY ROW EXACTLY ONCE, OLDEST FIRST, IN PAGES OF 500: 1,203 rows are three pages, and the first one counts them', async () => {
  const db = fakeDb(book(MANY(1203)));
  const first = await exp(db);
  assert.equal(first.on, true); assert.equal(first.total, 1203); assert.equal(first.rows.length, M.EXPORT_PAGE_ROWS); assert.equal(first.next, 500); assert.equal(first.offset, 0);
  assert.ok(first.upTo, 'the line the report is drawn at');
  assert.ok(first.faqLabels && Object.keys(first.faqLabels).length > 5 && first.faqLabels.targets && first.faqLabels.targets.en, 'the labels of the ready questions come with the first page');
  const second = await exp(db, { upTo: first.upTo, offset: 500 });
  assert.equal(second.total, null, 'counted once, with the first page'); assert.equal(second.rows.length, 500); assert.equal(second.next, 1000);
  assert.deepEqual(second.faqLabels, {}, 'labels only on the first page');
  const third = await exp(db, { upTo: first.upTo, offset: 1000 });
  assert.equal(third.rows.length, 203); assert.equal(third.next, null);
  const all = [...first.rows, ...second.rows, ...third.rows];
  assert.equal(new Set(all.map(r => r.q)).size, 1203, 'every row once');
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].at <= all[i].at, 'oldest first');
  assert.deepEqual(Object.keys(all[0]).sort(), ['a', 'at', 'behind', 'cacheRead', 'day', 'faq', 'lang', 'ms', 'mode', 'name', 'note', 'q', 'role', 'source', 'teams', 'thread', 'tokensIn', 'tokensOut', 'zone'].sort());
  const exactly = await exp(fakeDb(book(MANY(500))));
  assert.equal(exactly.total, 500); assert.equal(exactly.rows.length, 500); assert.equal(exactly.next, null, 'exactly one page is one page');
});

test('THE LINE: the report is drawn at the newest row on file, so a chat written while it is made is NOT in it; two rows at the very same time are both in it', async () => {
  const db = fakeDb(book([R({ created_at: '2026-11-25T05:00:00Z', question: 'a' }), R({ created_at: '2026-11-25T06:00:00Z', question: 'b' }), R({ created_at: '2026-11-25T06:00:00Z', question: 'c' })]));
  const first = await exp(db);
  assert.equal(first.upTo, '2026-11-25T06:00:00Z'); assert.equal(first.total, 3);
  db._dump('claudian_chats').push(R({ created_at: '2026-11-25T06:30:00Z', question: 'written while the report was being made' }));
  const later = await exp(db, { upTo: first.upTo, offset: 0 });
  assert.equal(later.rows.length, 3); assert.ok(!later.rows.some(r => /written while/.test(r.q)), 'not in the report');
  assert.equal(later.total, 3);
});

test('NOTHING ON FILE, NO TABLE, A REFUSAL: an empty history says so with no line to draw; a missing table (RUN-ME-090) says so; a refusal is a failure, not "missing"', async () => {
  const none = await exp(fakeDb(book([])));
  assert.deepEqual({ on: none.on, upTo: none.upTo, total: none.total, rows: none.rows, next: none.next }, { on: true, upTo: null, total: 0, rows: [], next: null });
  const gone = await exp(fakeDb(book([]), { missingTables: ['claudian_chats'] }));
  assert.equal(gone.on, false); assert.ok(/RUN-ME-090/.test(gone.note)); assert.deepEqual(gone.rows, []);
  const db = fakeDb(book(MANY(5))), from = db.from.bind(db);
  db.from = name => { const q = from(name); if (name === 'claudian_chats') q.rejectWith = { code: '42501', message: 'permission denied for table claudian_chats' }; return q; };
  await assert.rejects(() => exp(db), e => /permission denied/.test(String((e && e.message) || e)));
  const clearGone = await clr(fakeDb(book([]), { missingTables: ['claudian_chats'] }), { upTo: '2026-11-25T06:00:00Z', expected: 0 });
  assert.equal(clearGone.on, false); assert.ok(/RUN-ME-090/.test(clearGone.note));
});

test('WHO MAY EXPORT AND WHO MAY CLEAR: the export is read like the list (the admin, a view-only supervisor, a role ticked for the tab); the clear is the admin\'s alone and is refused to a view-only code and to a ticked role', async () => {
  const rows = MANY(30);
  for (const u of [ADMIN, AUDITOR, HOLDER]) assert.equal((await exp(fakeDb(book(rows)), {}, u)).total, 30, u.name + ' reads the report');
  await assert.rejects(() => exp(fakeDb(book(rows)), {}, CLERK), e => e.status === 403, 'a code without the tab');
  const upTo = '2026-11-25T08:30:00Z', args = { upTo, expected: 30 };
  for (const [u, why] of [[HOLDER, 'a role ticked for the tab'], [AUDITOR, 'a view-only code'], [CLERK, 'a code without the tab']]) {
    const db = fakeDb(book(rows));
    await assert.rejects(() => clr(db, args, u), e => e.status === 403, why + ' may not clear');
    assert.equal(left(db), 30, 'and nothing was deleted');
  }
  const db = fakeDb(book(rows)); const out = await clr(db, args);
  assert.equal(out.deleted, 30); assert.equal(left(db), 0);
});

test('BAD ARGUMENTS ARE REFUSED, NOT GUESSED AT: a line that is not a time an earlier page gave, an offset that is not a whole number, a clear with no line, a future line, a count that is not a count', async () => {
  const db = fakeDb(book(MANY(10)));
  for (const upTo of ['yesterday', '2026-11-25', '2026-11-25 06:00:00', 20261125, {}, ['2026-11-25T06:00:00Z'], 'x'.repeat(60)]) await assert.rejects(() => exp(db, { upTo }), e => e.status === 400, 'upTo ' + JSON.stringify(upTo));
  for (const offset of [-1, 1.5, '5', 'x', 1e12, NaN, {}]) await assert.rejects(() => exp(db, { upTo: '2026-11-25T06:00:00Z', offset }), e => e.status === 400, 'offset ' + String(offset));
  const ok = '2026-11-25T06:00:00Z';
  for (const bad of [{}, { upTo: ok }, { expected: 5 }, { upTo: 'soon', expected: 5 }, { upTo: ok, expected: -1 }, { upTo: ok, expected: 1.5 }, { upTo: ok, expected: '5' }, { upTo: ok, expected: 1e12 }, { upTo: '2026-11-25T09:10:00Z', expected: 5 }, { upTo: '2027-01-01T00:00:00Z', expected: 5 }]) {
    await assert.rejects(() => clr(db, bad), e => e.status === 400, JSON.stringify(bad));
  }
  assert.equal(left(db), 10, 'none of it deleted anything');
  const near = await clr(db, { upTo: '2026-11-25T09:04:00Z', expected: 10 });
  assert.equal(near.on, true, 'a line a few minutes ahead of the clock is a clock that is a little out, not a future');
});

test('THE CLEAR DELETES EXACTLY WHAT THE REPORT HELD AND NOTHING AFTER IT: the rows up to the line go, a chat written later stays, and it says what went and what is left', async () => {
  const rows = MANY(120);
  const db = fakeDb(book(rows));
  const rep = await everything(db);
  assert.equal(rep.rows.length, 120); assert.equal(rep.pages, 1);
  // written after the report, on the very last day it covers: only the line (the time of the newest row) keeps it, not the days
  db._dump('claudian_chats').push(R({ id: 'late', created_at: '2026-11-20T23:59:59Z', day: '2026-11-20', thread: 'k-juma:2026-11-20', question: 'written after the report' }));
  const out = await clr(db, { upTo: rep.upTo, expected: rep.rows.length });
  assert.deepEqual({ on: out.on, cleared: out.cleared, changed: out.changed, partial: out.partial, found: out.found, deleted: out.deleted, remaining: out.remaining, expected: out.expected },
    { on: true, cleared: true, changed: false, partial: false, found: 120, deleted: 120, remaining: 0, expected: 120 });
  assert.deepEqual(db._dump('claudian_chats').map(r => r.id), ['late'], 'only the chat written after the report is left');
});

test('THE CLEAR REFUSES WHEN THERE IS MORE ON FILE THAN THE REPORT HELD: a row that was being written as the report was read is not deleted unseen; nothing is deleted, and the owner is told to export again', async () => {
  const rows = MANY(40);
  const db = fakeDb(book(rows));
  const rep = await everything(db);
  db._dump('claudian_chats').push(R({ id: 'straggler', created_at: '2026-11-03T05:00:00Z', day: '2026-11-03', question: 'committed after the report read that day' }));   // up to the line, but not in the report
  const out = await clr(db, { upTo: rep.upTo, expected: rep.rows.length });
  assert.equal(out.changed, true); assert.equal(out.cleared, false); assert.equal(out.deleted, 0); assert.equal(out.found, 41); assert.equal(out.expected, 40);
  assert.equal(left(db), 41, 'nothing was deleted');
  // a report that held MORE than is on file now is fine: part of it was cleared already
  const fewer = await clr(fakeDb(book(MANY(10))), { upTo: '2026-11-25T08:30:00Z', expected: 40 });
  assert.equal(fewer.cleared, true); assert.equal(fewer.deleted, 10);
});

test('A CLEAR AGAIN CLEARS NOTHING AND SAYS SO: the same line twice, and a line on an empty history; no note is written for nothing', async () => {
  const db = fakeDb(book(MANY(20)));
  const rep = await everything(db);
  const first = await clr(db, { upTo: rep.upTo, expected: 20 });
  assert.equal(first.deleted, 20);
  const again = await clr(db, { upTo: rep.upTo, expected: 20 });
  assert.deepEqual({ cleared: again.cleared, deleted: again.deleted, found: again.found }, { cleared: true, deleted: 0, found: 0 });
  assert.equal(db._dump('settings').filter(r => r.key === M.SETTING_LAST_CLEAR).length, 1, 'the one note is the first clear\'s');
  const empty = fakeDb(book([]));
  const e = await clr(empty, { upTo: '2026-11-25T06:00:00Z', expected: 0 });
  assert.deepEqual({ cleared: e.cleared, deleted: e.deleted }, { cleared: true, deleted: 0 });
  assert.equal(empty._dump('settings').length, 0);
});

test('THE DAYS ARE DELETED A WEEK AT A TIME, BY THE DAYS THE ROWS CARRY: a row whose East Africa day is after the UTC date of the line goes too, and a long history is several slices', async () => {
  // 22:30 UTC on the 25th is 01:30 on the 26th in East Africa: its `day` is the 26th, a day after the UTC date of the line
  const late = R({ id: 'eat', created_at: '2026-11-25T22:30:00Z', day: '2026-11-26', thread: 'k-juma:2026-11-26', question: 'after midnight in East Africa' });
  const db = fakeDb(book([...MANY(60), late]));
  const slices = []; const from = db.from.bind(db);
  db.from = name => { const q = from(name); if (name === 'claudian_chats') { const del = q.delete.bind(q); q.delete = () => { slices.push(1); return del(); }; } return q; };
  const rep = await everything(db);
  assert.equal(rep.upTo, '2026-11-25T22:30:00Z');
  const out = await clr(db, { upTo: rep.upTo, expected: 61 }, ADMIN, Date.UTC(2026, 10, 26, 0, 0, 0));
  assert.equal(out.deleted, 61); assert.equal(left(db), 0, 'the row of the 26th went too: the last day is read from the rows, not from the UTC date of the line');
  assert.equal(slices.length, 4, 'the 1st to the 26th of November in slices of seven days: 1-7, 8-14, 15-21, 22-26');
});

test('A CLEAR THAT IS CUT SHORT BY ITS TIME DELETES WHOLE SLICES ONLY AND CAN BE PRESSED AGAIN: the first press with no time left deletes nothing and says partial; the second finishes', async () => {
  const db = fakeDb(book(MANY(60)));
  const rep = await everything(db);
  const cut = await M.claudianChatsClear(db, { upTo: rep.upTo, expected: 60 }, NOW, -1);
  assert.equal(cut.partial, true); assert.equal(cut.cleared, false); assert.equal(cut.deleted, 0); assert.equal(cut.remaining, 60);
  const done = await clr(db, { upTo: rep.upTo, expected: 60 });
  assert.equal(done.partial, false); assert.equal(done.cleared, true); assert.equal(done.deleted, 60);
  // cut after the first slice: what went is a whole slice, and the second press (which finds fewer than the report held) finishes the rest
  const db2 = fakeDb(book(MANY(60)));
  const rep2 = await everything(db2);
  let presses = 0; const from = db2.from.bind(db2);
  db2.from = name => { const q = from(name); if (name === 'claudian_chats') { const del = q.delete.bind(q); q.delete = () => { presses++; return del(); }; } return q; };
  let tick = 0; const realNow = Date.now; Date.now = () => (tick += presses >= 1 ? 100000 : 0) + realNow.call(Date);
  try {
    const half = await M.claudianChatsClear(db2, { upTo: rep2.upTo, expected: 60 }, NOW, 50000);
    assert.equal(half.partial, true); assert.ok(half.deleted > 0 && half.deleted < 60 && half.remaining > 0, 'a part: ' + half.deleted + ' deleted, ' + half.remaining + ' left');
    assert.equal(half.deleted + half.remaining, 60);
    const days = new Set(db2._dump('claudian_chats').map(r => r.day));
    assert.ok(![...days].some(d => d >= '2026-11-01' && d <= '2026-11-07'), 'the first slice of days went whole');
  } finally { Date.now = realNow; }
  const rest = await clr(db2, { upTo: rep2.upTo, expected: 60 });
  assert.equal(rest.cleared, true); assert.equal(left(db2), 0);
});

test('THE CLEAR LEAVES A NOTE OF ITSELF AND AN AUDIT LINE, AND THE TAB READS THEM: who, when, up to when, how many; the list answer says whether this person may clear', async () => {
  const db = fakeDb(book(MANY(25)));
  const rep = await everything(db);
  const before = await portalApi(db, ADMIN, 'claudianChats', { from: '2026-11-01', to: '2026-11-25' }, NOW);
  assert.equal(before.canClear, true); assert.equal(before.lastClear, null);
  assert.equal((await portalApi(db, HOLDER, 'claudianChats', {}, NOW)).canClear, false, 'a role ticked for the tab sees no clear button');
  assert.equal((await portalApi(db, AUDITOR, 'claudianChats', {}, NOW)).canClear, false, 'nor a view-only code, whatever tabs it holds');
  await clr(db, { upTo: rep.upTo, expected: 25, date: rep.upTo.slice(0, 10) });
  await new Promise(r => setTimeout(r, 20));
  const note = db._dump('settings').find(r => r.key === M.SETTING_LAST_CLEAR);
  assert.ok(note, 'the note is one setting row');
  const o = JSON.parse(note.value);
  assert.deepEqual({ by: o.by, role: o.role, upTo: o.upTo, deleted: o.deleted, partial: o.partial }, { by: 'THE ADMIN', role: 'ADMIN', upTo: rep.upTo, deleted: 25, partial: false });
  assert.equal(o.at, new Date(NOW).toISOString());
  const after = await portalApi(db, ADMIN, 'claudianChats', {}, NOW);
  assert.deepEqual(after.lastClear, { at: o.at, by: 'THE ADMIN', role: 'ADMIN', upTo: rep.upTo, deleted: 25, partial: false });
  const audit = db._dump('audit_log').filter(r => r.action === 'claudianChatsClear');
  assert.equal(audit.length, 1); assert.equal(audit[0].actor_name, 'THE ADMIN'); assert.equal(audit[0].ok, true); assert.equal(audit[0].subject, 'date=' + rep.upTo.slice(0, 10));
  assert.ok(!db._dump('audit_log').some(r => r.action === 'claudianChatsExport'), 'reading is not an audited write');
});

test('THE NOTE IS READ BACK ONLY AS THE CLEAR WROTE IT: anything else reads as "never cleared"; and a note that cannot be written never undoes a clear', async () => {
  const ok = { at: '2026-11-25T09:00:00.000Z', by: 'X', role: 'ADMIN', upTo: '2026-11-25T08:00:00Z', deleted: 3, partial: false };
  assert.deepEqual(M.lastClearOf(JSON.stringify(ok)), ok);
  for (const junk of [null, undefined, '', 'x', '{}', '[]', '5', JSON.stringify({ ...ok, at: 'yesterday' }), JSON.stringify({ ...ok, upTo: 5 }), JSON.stringify({ ...ok, deleted: -1 }), JSON.stringify({ ...ok, deleted: '3' }), JSON.stringify({ ...ok, deleted: 1.5 })]) assert.equal(M.lastClearOf(junk), null, String(junk));
  assert.deepEqual(M.lastClearOf(JSON.stringify({ ...ok, by: 'B'.repeat(300), role: 'R'.repeat(300), extra: 'ignored' })), { ...ok, by: 'B'.repeat(80), role: 'R'.repeat(60) }, 'bounded, and nothing else is passed on');
  const db = fakeDb(book(MANY(8))), from = db.from.bind(db);
  db.from = name => { const q = from(name); if (name === 'settings') q.rejectWith = { code: '42501', message: 'permission denied for table settings' }; return q; };
  const rep = await everything(db);
  const out = await clr(db, { upTo: rep.upTo, expected: 8 });
  assert.equal(out.cleared, true); assert.equal(left(db), 0, 'the rows are gone and the answer says so, whether or not the note could be written');
});

test('THE TAB IS REACHED THE WAY EVERY TAB IS, AND NOTHING ON THE UPLOAD OR THE CALL APP KNOWS IT: both functions gated on the tab, the clear audited (so refused to a view-only code at the door) and the export not, four lazy imports, and no mention in the two paths', () => {
  const core = fs.readFileSync(path.join(ROOT, 'api/_lib/portal-core.js'), 'utf8');
  assert.match(core, /claudianChatsExport: \['hopeai'\], claudianChatsClear: \['hopeai'\]/, 'gated on the tab');
  assert.equal((core.match(/import\('\.\/claudian-chats\.js'\)/g) || []).length, 4, 'a lazy import in each of the four functions, none at the top');
  assert.ok(!/^\s*import[^\n]*claudian-chats/m.test(core), 'portal-core.js (imported by api/upload.js) must not import the reader statically');
  const audit = fs.readFileSync(path.join(ROOT, 'api/_lib/audit.js'), 'utf8');
  assert.ok(/'claudianChatsClear'/.test(audit) && !/'claudianChatsExport'/.test(audit));
  for (const f of ['api/upload.js', 'api/call.js', 'api/_lib/call-core.js', 'api/_lib/notify.js']) assert.ok(!/claudianChatsExport|claudianChatsClear|SETTING_LAST_CLEAR|lastClearOf/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f + ' knows the report');
});
