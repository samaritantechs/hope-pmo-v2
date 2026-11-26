/* CLAUDIAN-PMO'S KEPT CONVERSATION (handbook Part 167): the module's own code RUN against a stand-in storage and a stand-in panel.

     "And could user always find their history without new chat whenever thry open Claudian-PMO" -- the owner, 26 Nov 2026

   What it holds: a person's conversation is kept in their own browser under a MARK of who they are (never the access code or the device id), drawn
   again when the module is mounted, shown to that person ALONE (anybody else's is deleted the moment it is met), gone after HIST_DAYS days, capped in
   lines and in size, made only of lines that say something about the conversation, and forgotten by a sign-out on either page. A storage that is blocked
   or full, and a record that is damaged, change nothing the person sees. What a real browser does with it (the reload, the scroll, the link, the
   sign-out) is tools/browser-checks/claudian-bubble.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/mod/claudian.js'), 'utf8');
const J = x => JSON.stringify(x);
const DAY = 86400000, MIN = 60000;

/** A stand-in panel node: just enough of a DOM for the module's own lines. */
function node(tag) {
  const n = {
    tag, className: '', children: [], textContent: '', parentNode: null, offsetTop: 0, scrollTop: 0,
    appendChild(c) { c.parentNode = n; n.children.push(c); return c; },
    insertBefore(c, ref) { c.parentNode = n; const i = ref ? n.children.indexOf(ref) : -1; if (i < 0) n.children.push(c); else n.children.splice(i, 0, c); return c; },
    removeChild(c) { const i = n.children.indexOf(c); if (i >= 0) n.children.splice(i, 1); c.parentNode = null; return c; },
    setAttribute(k, v) { n['attr:' + k] = v; },
  };
  return n;
}
const textOf = n => (n.nodeType === 3 ? n.text : n.children && n.children.length ? n.children.map(textOf).join('') : n.textContent);

/** One page: a module run in its own window over a storage that can be shared with the next page (a reload) and a clock the test moves. */
function page({ store = new Map(), host = 'portal', id = 'KON-SECRET-CODE-123', person = undefined, clock = { t: 1_800_000_000_000 }, ls: lsOver = {} } = {}) {
  const ls = {
    fail: false,
    getItem: k => { if (ls.failGet) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (ls.failSet) throw new Error('full'); store.set(k, String(v)); },
    removeItem: k => { if (ls.failRemove) throw new Error('blocked'); store.delete(k); },
    ...lsOver,
  };
  const doc = { createElement: tag => node(tag), createTextNode: t => ({ nodeType: 3, text: String(t) }) };
  const W = {};
  vm.runInNewContext(SRC, { window: W, document: doc, localStorage: ls, console, Date: { now: () => clock.t } });
  const M = W.ClaudianPMO, K = M._k, T = M._t;
  const who = { id, person };
  K.st.opts = host === 'call' ? { host, device: () => who.id } : { host, code: () => who.id };
  if (person !== undefined) K.st.opts.person = () => who.person;          // HOPE Calls names the signed-in officer as well as the handset
  const body = node('div'), welcome = node('div'), faq = node('details');
  welcome.className = 'm w'; welcome.textContent = 'WELCOME LINE';
  body.appendChild(welcome); body.appendChild(faq);
  K.st.e = { body, faq, welcome };
  return { K, T, ls, store, clock, who, body, welcome, faq, W,
    kinds: () => body.children.filter(c => /(^| )m( |$)/.test(c.className) && c !== welcome).map(c => c.className.replace('m ', '')),
    texts: () => body.children.filter(c => /(^| )m( |$)/.test(c.className) && c !== welcome).map(textOf),
    rec: () => JSON.parse(store.get('claudianChat.' + host)) };
}

test('the mark: the same asker always gets the same one, two askers never the same, and it never contains what it was made from', () => {
  const { T } = page();
  assert.equal(T.mark('KON-SECRET-CODE-123'), T.mark('KON-SECRET-CODE-123'));
  assert.notEqual(T.mark('KON-SECRET-CODE-123'), T.mark('KON-SECRET-CODE-124'));
  assert.notEqual(T.mark('a'), T.mark('A'), 'case counts: the codes are exact');
  assert.ok(/^[0-9a-z]+\.[0-9a-z]+$/.test(T.mark('x')), 'two short parts');
  const seen = new Set();
  for (let i = 0; i < 6000; i++) seen.add(T.mark('code-' + i + '-' + (i * 7919) % 1000));
  assert.equal(seen.size, 6000, 'two different askers got the same mark');
  for (const id of ['KON-SECRET-CODE-123', 'DEVICE-ID-9f8e7d6c5b4a', 'ADM 442211']) assert.ok(!T.mark(id).includes(id));
});

test('a conversation is kept after every line and drawn again, in order, as the same person finds it after a reload', () => {
  const p = page();
  p.K.addMsg('u', 'Naweza kuona wapi madeni ya leo?');
  p.K.addMsg('a', 'Fungua Dashboard.');
  p.K.addNear([{ id: 'dash-arrows', q: 'What do the arrows mean?', score: 3 }, { id: 'targets', q: 'What are the targets?' }]);
  p.K.addMsg('w', 'Ready answer to: What are the targets?');
  p.K.addMsg('h', 'No ready answer fits that question.');
  const rec = p.rec();
  assert.equal(rec.v, 1);
  assert.equal(rec.who, p.T.mark('KON-SECRET-CODE-123'), 'the record names its owner by the mark');
  assert.ok(!p.store.get('claudianChat.portal').includes('KON-SECRET-CODE-123'), 'the access code is nowhere in what is kept');
  assert.equal(J(rec.m), J([['u', 'Naweza kuona wapi madeni ya leo?'], ['a', 'Fungua Dashboard.'], ['n', [{ id: 'dash-arrows', q: 'What do the arrows mean?' }, { id: 'targets', q: 'What are the targets?' }]], ['w', 'Ready answer to: What are the targets?'], ['h', 'No ready answer fits that question.']]), 'what is kept: the lines, and only an id and a question for each choice');
  // a reload: a new page over the same storage
  const q = page({ store: p.store, clock: p.clock });
  assert.equal(q.K.restore(), true);
  assert.equal(J(q.kinds()), J(['u', 'a', 'w near', 'w', 'h']));
  assert.equal(q.texts()[0], 'Naweza kuona wapi madeni ya leo?'); assert.equal(q.texts()[1], 'Fungua Dashboard.'); assert.equal(q.texts()[4], 'No ready answer fits that question.');
  const near = q.body.children.find(c => /near/.test(c.className));
  const buttons = near.children[1].children;
  assert.equal(buttons.length, 2); assert.equal(buttons[0].textContent, 'What do the arrows mean?'); assert.equal(buttons[0]['attr:data-id'], 'dash-arrows');
  assert.equal(typeof buttons[0].onclick, 'function', 'a restored choice is a live button: a tap asks its ready question as before');
  assert.equal(q.body.children[0], q.welcome, 'the panel\'s own welcome line stays first');
  assert.equal(J(q.K.st.log.map(l => l.k)), J(['u', 'a', 'n', 'w', 'h']));
  // restoring writes nothing and asks for nothing
  assert.equal(q.store.get('claudianChat.portal'), p.store.get('claudianChat.portal'));
});

test('the same person on HOPE Calls: the handset\'s device id is the mark, the call app keeps its own conversation, and the two never mix', () => {
  const store = new Map();
  const a = page({ store, host: 'portal', id: 'ADM 442211' });
  const b = page({ store, host: 'call', id: 'DEVICE-ID-9f8e7d6c5b4a' });
  a.K.addMsg('u', 'portal question'); b.K.addMsg('u', 'call question');
  assert.deepEqual([...store.keys()].sort(), ['claudianChat.call', 'claudianChat.portal']);
  assert.equal(b.rec().who, b.T.mark('DEVICE-ID-9f8e7d6c5b4a'));
  assert.ok(![...store.values()].some(v => v.includes('DEVICE-ID-9f8e7d6c5b4a') || v.includes('ADM 442211')), 'neither the device id nor the code is kept');
  const a2 = page({ store, host: 'portal', id: 'ADM 442211' }), b2 = page({ store, host: 'call', id: 'DEVICE-ID-9f8e7d6c5b4a' });
  assert.equal(a2.K.restore(), true); assert.equal(b2.K.restore(), true);
  assert.equal(J(a2.texts()), J(['portal question'])); assert.equal(J(b2.texts()), J(['call question']));
});

test('ONE HANDSET, TWO OFFICERS (handbook Part 167, addendum 1): where the page names the officer, the mark is the handset AND the officer, so a handset that is de-registered or signed in again as somebody else never shows the last officer\'s conversation', () => {
  const store = new Map(), DEV = 'DEVICE-ID-9f8e7d6c5b4a';
  const a = page({ store, host: 'call', id: DEV, person: 'JUMA ISSA' });
  a.K.addMsg('u', 'Timu yangu inadaiwa kiasi gani?'); a.K.addMsg('a', 'Timu yako inadaiwa TZS 1,200,000.');
  assert.equal(a.rec().who, a.T.mark(DEV + '|JUMA ISSA'), 'the mark is made of the handset and the officer');
  assert.notEqual(a.rec().who, a.T.mark(DEV), 'not of the handset alone'); assert.notEqual(a.rec().who, a.T.mark('JUMA ISSA'), 'nor of the name alone');
  assert.ok(!store.get('claudianChat.call').includes(DEV) && !store.get('claudianChat.call').includes('JUMA ISSA'.replace(' ', '')) && !/"who":"[^"]*JUMA/.test(store.get('claudianChat.call')), 'neither the id nor the name is in the record\'s owner');
  // the same officer opens the app again: their conversation is there
  const again = page({ store, host: 'call', id: DEV, person: 'JUMA ISSA', clock: a.clock });
  assert.equal(again.K.restore(), true); assert.equal(J(again.texts()), J(['Timu yangu inadaiwa kiasi gani?', 'Timu yako inadaiwa TZS 1,200,000.']));
  // the SAME handset, another officer (re-registered: no log-out of ours was passed): not shown, and deleted
  const b = page({ store, host: 'call', id: DEV, person: 'ASHA KOMBO', clock: a.clock });
  assert.equal(b.K.restore(), false); assert.equal(b.texts().length, 0, 'the next officer meets an empty panel');
  assert.equal(store.has('claudianChat.call'), false, 'and what the last one asked is deleted');
  // an officer's name read with other letters, or another officer with a name that contains theirs, is somebody else
  for (const other of ['juma issa', 'JUMA ISSA ', 'JUMA ISSAH', 'MAJUMA ISSA']) {
    const k = page({ store: new Map(), host: 'call', id: DEV, person: 'JUMA ISSA' }); k.K.addMsg('u', 'q');
    const o = page({ store: k.store, host: 'call', id: DEV, person: other, clock: k.clock });
    assert.equal(o.K.restore(), false, 'shown to ' + J(other));
  }
  // the page does not yet know who is signed in (the officer\'s boot answer has not landed): nothing is written, shown or deleted
  const kept = page({ store: new Map(), host: 'call', id: DEV, person: 'JUMA ISSA' }); kept.K.addMsg('u', 'a kept question');
  const before = kept.store.get('claudianChat.call');
  const unknown = page({ store: kept.store, host: 'call', id: DEV, person: '', clock: kept.clock });
  unknown.K.addMsg('u', 'asked while nobody is known');
  assert.equal(kept.store.get('claudianChat.call'), before, 'nothing written for nobody');
  assert.equal(unknown.K.restore(), false); assert.equal(kept.store.get('claudianChat.call'), before, 'and what may be the officer\'s is not deleted by it');
  // a page that never names a person (the portal: the access code IS the person) is made exactly as before
  const portal = page({ id: 'ADM 442211' }); portal.K.addMsg('u', 'q');
  assert.equal(portal.rec().who, portal.T.mark('ADM 442211'));
});

test('NOBODY ELSE\'S: a conversation that is not this person\'s is not shown, and it is deleted the moment it is met', () => {
  const p = page();
  p.K.addMsg('u', 'a question of the first person'); p.K.addMsg('a', 'an answer for the first person');
  const q = page({ store: p.store, clock: p.clock, id: 'ANOTHER-PERSONS-CODE' });
  assert.equal(q.K.restore(), false);
  assert.equal(q.texts().length, 0, 'nothing is drawn');
  assert.equal(p.store.has('claudianChat.portal'), false, 'and it is gone');
  // the other person's own conversation is then kept under their own mark
  q.K.addMsg('u', 'the second person asks');
  assert.equal(q.rec().who, q.T.mark('ANOTHER-PERSONS-CODE'));
  // the first person is back: they do not find the second one's
  const r = page({ store: p.store, clock: p.clock });
  assert.equal(r.K.restore(), false); assert.equal(r.texts().length, 0);
});

test('it expires thirty days after its last line, and a record from the future is not believed', () => {
  const t0 = 1_800_000_000_000;
  const mk = at => { const p = page({ clock: { t: at } }); p.K.addMsg('u', 'q'); p.K.addMsg('a', 'a'); return p; };
  const age = (days, mins = 0) => { const p = mk(t0); const q = page({ store: p.store, clock: { t: t0 + days * DAY + mins * MIN } }); return { ok: q.K.restore(), q, p }; };
  assert.equal(age(0).ok, true, 'a moment later');
  assert.equal(age(7).ok, true, 'a week later');
  assert.equal(age(29, 23 * 60).ok, true, 'a minute under thirty days');
  const late = age(30, 1);
  assert.equal(late.ok, false, 'thirty days and a minute');
  assert.equal(late.p.store.has('claudianChat.portal'), false, 'and it is deleted');
  assert.equal(late.q.T.HIST_DAYS, 30);
  const p = mk(t0 + 2 * DAY);                       // written "two days from now" by a clock that was wrong
  const q = page({ store: p.store, clock: { t: t0 } });
  assert.equal(q.K.restore(), false, 'a record dated in the future is dropped'); assert.equal(p.store.has('claudianChat.portal'), false);
  const r = mk(t0 + 20 * 3600000); const s = page({ store: r.store, clock: { t: t0 } });
  assert.equal(s.K.restore(), true, 'a clock a few hours out is allowed');
});

test('a damaged or hostile record is ignored without an error, and only well-formed lines are drawn, as text', () => {
  const make = value => { const store = new Map([['claudianChat.portal', typeof value === 'string' ? value : J(value)]]); const q = page({ store }); let ok; assert.doesNotThrow(() => { ok = q.K.restore(); }); return { q, ok, store }; };
  const who = page().T.mark('KON-SECRET-CODE-123'), at = 1_800_000_000_000;
  for (const bad of ['{not json', '', 'null', '[]', '5', J({ v: 2, who, at, m: [] }), J({ v: 1, who: 5, at, m: [] }), J({ v: 1, who, at: 'x', m: [] }), J({ v: 1, who, at, m: 'abc' }), J({ v: 1, who, at })]) {
    const r = make(bad);
    assert.equal(r.ok, false, 'restored from ' + bad); assert.equal(r.q.texts().length, 0);
  }
  const hostile = make({ v: 1, who, at, ha: 0, hist: { q: 1, a: 2 }, m: [
    ['u', '<img src=x onerror=alert(1)>'], ['e', 'a red line is never kept'], ['x', 'unknown kind'], ['a', 123], ['a', ''], null, 'abc', ['t', 'thinking'],
    ['n', [{ id: 'ok', q: 'a fine question' }, { id: 5, q: 'x' }, { q: 'no id' }, { id: 'noq' }, null, 'abc', ...Array.from({ length: 30 }, (_, i) => ({ id: 'id' + i, q: 'q' + i }))]],
    ['a', '<script>alert(1)</script>'],
  ] });
  assert.equal(hostile.ok, true);
  assert.equal(J(hostile.q.kinds()), J(['u', 'w near', 'a']), 'only the well-formed lines');
  assert.equal(hostile.q.texts()[0], '<img src=x onerror=alert(1)>', 'markup is text');
  assert.equal(hostile.q.texts()[2], '<script>alert(1)</script>');
  const near = hostile.q.body.children.find(c => /near/.test(c.className));
  assert.equal(near.children[1].children.length, 6, 'at most six choices, bad entries left out');
  assert.equal(hostile.q.K.st.hist, null, 'a damaged exchange is not carried');
});

test('at most forty lines, each cut at two thousand characters, the whole under sixty thousand: the oldest lines go first; the welcome line is never counted, cut or kept', () => {
  const p = page();
  for (let i = 1; i <= 55; i++) p.K.addMsg(i % 2 ? 'u' : 'a', 'line ' + i);
  assert.equal(p.rec().m.length, 40, 'forty kept');
  assert.equal(p.rec().m[0][1], 'line 16'); assert.equal(p.rec().m[39][1], 'line 55', 'the newest forty');
  assert.equal(p.kinds().length, 40, 'and forty drawn');
  assert.equal(p.body.children[0], p.welcome, 'the welcome line is still there: it is not one of the forty');
  assert.ok(!p.store.get('claudianChat.portal').includes('WELCOME LINE'), 'and it is not kept');
  const big = page();
  big.K.addMsg('u', 'x'.repeat(5000));
  assert.equal(big.rec().m[0][1].length, 2000, 'a line is cut at two thousand');
  const full = page();
  for (let i = 0; i < 40; i++) full.K.addMsg(i % 2 ? 'a' : 'u', String(i % 10).repeat(2000));
  const size = full.store.get('claudianChat.portal').length;
  assert.ok(size <= 60000, 'the record is ' + size + ' characters');
  assert.ok(full.rec().m.length >= 25 && full.rec().m.length < 40, 'the oldest lines went to make room: ' + full.rec().m.length);
  assert.equal(full.rec().m[full.rec().m.length - 1][1][0], '9', 'the newest line stayed');
});

test('a failure of the module\'s own (no connection, a fault) is shown and not kept; the conversation\'s own lines are', () => {
  const p = page();
  p.K.addMsg('u', 'a question');
  p.K.addMsg('h', 'No connection. Try again later.', true);
  p.K.addMsg('e', 'The helper is not available for this account.', true);
  assert.equal(J(p.kinds()), J(['u', 'h', 'e']), 'shown');
  assert.equal(J(p.rec().m), J([['u', 'a question']]), 'not kept');
  assert.equal(J(p.K.st.log.map(l => l.k)), J(['u']));
});

test('the last exchange rides with the next question only while it is young: kept for thirty minutes, then forgotten', () => {
  const t0 = 1_800_000_000_000;
  const p = page({ clock: { t: t0 } });
  p.K.addMsg('u', 'Timu yangu?'); p.K.addMsg('a', 'Timu yako ni nzuri.');
  p.K.setHist({ q: 'Timu yangu?', a: 'Timu yako ni nzuri.' }); p.K.persist();
  const young = page({ store: p.store, clock: { t: t0 + 29 * MIN } });
  assert.equal(young.K.restore(), true);
  assert.equal(J(young.K.st.hist), J({ q: 'Timu yangu?', a: 'Timu yako ni nzuri.' }), 'twenty-nine minutes later it still rides');
  assert.equal(young.K.st.histAt, t0);
  const old = page({ store: p.store, clock: { t: t0 + 31 * MIN } });
  assert.equal(old.K.restore(), true, 'the lines are still found');
  assert.equal(old.K.st.hist, null, 'but the exchange is not handed to the model any more');
  const odd = page({ store: p.store, clock: { t: t0 - 5 * MIN } });
  odd.K.restore(); assert.equal(odd.K.st.hist, null, 'an exchange stamped in the future is not carried');
  assert.equal(young.T.HIST_FRESH_MS, 30 * MIN);
  // an answer is carried at its own length, never longer than the server takes
  const longHist = page({ clock: { t: t0 } }); longHist.K.addMsg('u', 'q');
  longHist.store.set('claudianChat.portal', J({ ...longHist.rec(), ha: t0, hist: { q: 'q'.repeat(900), a: 'a'.repeat(900) } }));
  const lh = page({ store: longHist.store, clock: { t: t0 } }); lh.K.restore();
  assert.equal(lh.K.st.hist.q.length, 400); assert.equal(lh.K.st.hist.a.length, 240);
});

test('signing out forgets it: both pages\' conversations are deleted, the lines and the exchange are cleared, and nothing is written again', () => {
  const store = new Map();
  const p = page({ store }), c = page({ store, host: 'call', id: 'DEVICE-ID-9f8e7d6c5b4a' });
  p.K.addMsg('u', 'portal'); c.K.addMsg('u', 'call'); p.K.setHist({ q: 'q', a: 'a' });
  assert.equal(store.size, 2);
  const sess = p.K.st.sess;
  p.K.forget();          // not mounted in this test: the lines of the panel are cleared by the browser check
  assert.equal(store.size, 0, 'both are gone: a sign-out anywhere is a sign-out of the whole system');
  assert.equal(p.K.st.log.length, 0); assert.equal(p.K.st.hist, null); assert.equal(p.K.st.histAt, 0);
  assert.ok(p.K.st.sess > sess, 'an answer still on its way sees another session and stays out');
  // a page loaded for the next person finds nothing
  const next = page({ store, id: 'THE-NEXT-PERSON' });
  assert.equal(next.K.restore(), false);
});

test('a storage that is blocked or full changes nothing the person sees, and an unknown asker is never stored or deleted', () => {
  const p = page();
  p.ls.failSet = true;
  assert.doesNotThrow(() => p.K.addMsg('u', 'asked with a full storage'));
  assert.equal(J(p.texts()), J(['asked with a full storage']), 'the line is drawn');
  p.ls.failSet = false; p.ls.failGet = true;
  assert.equal(p.K.restore(), false, 'a storage that will not be read restores nothing');
  assert.doesNotThrow(() => p.K.readChat());
  p.ls.failGet = false; p.ls.failRemove = true;
  assert.doesNotThrow(() => p.K.forget());
  assert.doesNotThrow(() => p.K.dropChat(true));
  // nobody is known yet (no code, no device): nothing is written, and a record already there is left for whoever it belongs to
  const q = page(); q.K.addMsg('u', 'kept'); const before = q.store.get('claudianChat.portal');
  const r = page({ store: q.store, clock: q.clock, id: '' });
  r.K.addMsg('u', 'an unknown asker');
  assert.equal(q.store.get('claudianChat.portal'), before, 'nothing written for nobody');
  assert.equal(r.K.restore(), false); assert.equal(q.store.get('claudianChat.portal'), before, 'and a record that may be someone\'s is not deleted by it');
});

test('the panel opens on the latest question, with its answer under it', () => {
  const p = page();
  for (const [k, t] of [['u', 'first'], ['a', 'first answer'], ['u', 'second'], ['a', 'second answer, long']]) p.K.addMsg(k, t);
  const lines = p.body.children.filter(c => /(^| )m( |$)/.test(c.className) && c !== p.welcome);
  lines.forEach((n, i) => { n.offsetTop = 100 + i * 80; });
  p.K.showLatest();
  assert.equal(p.body.scrollTop, 100 + 2 * 80 - 12, 'the top of the last question');
  const empty = page(); empty.body.scrollTop = 7; empty.K.showLatest();
  assert.equal(empty.body.scrollTop, 7, 'with no conversation nothing moves');
  const noQuestion = page(); noQuestion.K.addMsg('a', 'only an answer'); noQuestion.body.children[1].offsetTop = 300; noQuestion.K.showLatest();
  assert.equal(noQuestion.body.scrollTop, 288, 'a conversation with no question of the person\'s shows its last line');
});

test('the release address is a link in a line, made by fillText: the anchor\'s address is the constant, and every other word is text', () => {
  const p = page();
  const m = p.K.addMsg('a', 'Close the app and open it again.\n\nIf it still does not appear, install it again from here: ' + p.T.APK_URL);
  assert.equal(m.children.length, 2, 'text, then the link');
  const a = m.children[1];
  assert.equal(a.tag, 'a'); assert.equal(a.href, p.T.APK_URL); assert.equal(a.target, '_blank'); assert.ok(/noopener/.test(a.rel)); assert.equal(a.textContent, p.T.APK_URL);
  assert.equal(textOf(m), 'Close the app and open it again.\n\nIf it still does not appear, install it again from here: ' + p.T.APK_URL, 'the words are all there');
  // an answer that names another address gets no anchor at all
  const e = p.K.addMsg('a', 'Download https://evil.example/HOPE-Calls.apk now');
  assert.equal(e.children.length, 0); assert.equal(e.textContent, 'Download https://evil.example/HOPE-Calls.apk now');
  // and a kept line with the link comes back as a link
  const q = page({ store: p.store, clock: p.clock }); q.K.restore();
  const back = q.body.children.filter(c => /(^| )m( |$)/.test(c.className) && c !== q.welcome)[0];
  assert.equal(back.children.length, 2); assert.equal(back.children[1].href, p.T.APK_URL);
});


/* ---------------- THE SECOND READER'S FINDINGS ON THE KEPT CONVERSATION (handbook Part 167, addendum 2) ---------------- */
test('WHOSE LINES THE PANEL HOLDS (F2): when the page comes to name another person after the lines were written, they are forgotten before anything is written under the new mark, and the new person starts empty', () => {
  const store = new Map(), DEV = 'DEVICE-ID-9f8e7d6c5b4a';
  const p = page({ store, host: 'call', id: DEV, person: 'JUMA ISSA' });
  assert.equal(p.K.restore(), false); p.K.st.owner = p.K.who();             // what mount() does
  p.K.addMsg('u', 'question of JUMA'); p.K.addMsg('a', 'answer for JUMA');
  assert.equal(p.rec().who, p.T.mark(DEV + '|JUMA ISSA'));
  assert.equal(p.K.keepOwner(), true, 'the same person: nothing happens');
  assert.equal(p.K.st.log.length, 2);
  p.who.person = 'ASHA KOMBO';                                               // the fresh boot answer lands: the page names ASHA now
  assert.equal(p.K.keepOwner(), false, 'another person: the last one\'s lines are forgotten');
  assert.equal(store.has('claudianChat.call'), false, 'and the copy kept for the next visit with them');
  assert.equal(p.K.st.log.length, 0); assert.equal(p.K.st.hist, null);
  assert.equal(p.K.st.owner, p.T.mark(DEV + '|ASHA KOMBO'), 'the panel is ASHA\'s from here');
  p.K.addMsg('u', 'question of ASHA');
  assert.equal(J(p.rec().m), J([['u', 'question of ASHA']]), 'only her own line is kept, and it is kept under her own mark');
  assert.equal(p.rec().who, p.T.mark(DEV + '|ASHA KOMBO'));
  // the last net: a write that reaches persist() while the lines are another person's is never written under the new mark
  const q = page({ store: new Map(), host: 'call', id: DEV, person: 'JUMA ISSA' }); q.K.addMsg('u', 'JUMA asks');
  q.who.person = 'ASHA KOMBO'; q.K.persist();
  assert.equal(q.store.has('claudianChat.call'), false, 'nothing is written for ASHA out of JUMA\'s lines, and JUMA\'s copy is gone'); assert.equal(q.K.st.log.length, 0);
  // the box: a question the new person has typed is theirs and survives the forgetting when they are the one asking; the last person's unsent draft does not
  const r = page({ store: new Map(), host: 'call', id: DEV, person: 'JUMA ISSA' }); r.K.st.e.ta = { value: 'a draft of JUMA' }; r.K.st.e.ta.style = {}; r.K.addMsg('u', 'q');
  r.who.person = 'ASHA KOMBO'; r.K.keepOwner(true);
  assert.equal(r.K.st.e.ta.value, 'a draft of JUMA', 'the person who is asking keeps what is in the box (it is their own when they are the one who presses Send)');
  r.who.person = 'THIRD OFFICER'; r.K.keepOwner(false);
  assert.equal(r.K.st.owner, r.T.mark(DEV + '|THIRD OFFICER'));
  // a page that names the portal's code: another code in the same page is another person (a rotated code)
  const s = page({ store: new Map(), host: 'portal', id: 'FIRST CODE' }); s.K.addMsg('u', 'q'); s.who.id = 'SECOND CODE';
  assert.equal(s.K.keepOwner(), false); assert.equal(s.store.has('claudianChat.portal'), false);
});

test('AN ANSWER ON ITS WAY FOR SOMEBODY WHO IS NO LONGER HERE IS DROPPED (F2): stale() is true when the session ended or the page names another person, and then everything of the last person is forgotten', () => {
  const p = page({ host: 'call', id: 'DEV', person: 'JUMA ISSA' });
  p.K.addMsg('u', 'q'); const sess = p.K.st.sess;
  assert.equal(p.K.stale(sess), false, 'the same session, the same person');
  assert.equal(p.K.stale(sess - 1), true, 'a session that is over');
  p.who.person = 'ASHA KOMBO';
  assert.equal(p.K.stale(sess), true, 'another person now: the answer is dropped');
  assert.equal(p.K.st.log.length, 0); assert.equal(p.store.has('claudianChat.call'), false);
  assert.ok(p.K.st.sess > sess, 'and an answer of the old session that arrives later is dropped too');
  assert.equal(p.K.stale(p.K.st.sess), false, 'the new person\'s own session is live');
});

test('THE EXPIRY IS A DELETION, not only a filter (F4): the first mount of either page removes the records of BOTH pages that have outlived thirty days, are dated in the future or are not records, and leaves the young ones', () => {
  const t0 = 1_800_000_000_000, rec = (at, who = 'someone') => JSON.stringify({ v: 1, who, at, ha: 0, hist: null, m: [['u', 'q']] });
  const run = (portalRec, callRec) => {
    const store = new Map(); if (portalRec != null) store.set('claudianChat.portal', portalRec); if (callRec != null) store.set('claudianChat.call', callRec);
    const p = page({ store, host: 'call', id: 'DEV', person: 'X', clock: { t: t0 } });
    p.K.sweepExpired();
    return { portal: store.has('claudianChat.portal'), call: store.has('claudianChat.call') };
  };
  assert.deepEqual(run(rec(t0 - 31 * DAY), rec(t0 - 31 * DAY)), { portal: false, call: false }, 'both expired: both go');
  assert.deepEqual(run(rec(t0 - 31 * DAY), rec(t0 - DAY)), { portal: false, call: true }, 'the other page\'s expired record goes, this page\'s young one stays');
  assert.deepEqual(run(rec(t0 - DAY), rec(t0 - 31 * DAY)), { portal: true, call: false });
  assert.deepEqual(run(rec(t0 + 2 * DAY), rec(t0 + 2 * 3600000)), { portal: false, call: true }, 'a record from the future goes, a clock a few hours out does not');
  assert.deepEqual(run('{not json', '"a string"'), { portal: false, call: false }, 'what is not a record at all goes');
  assert.deepEqual(run(JSON.stringify({ v: 2, who: 'x', at: t0, m: [] }), JSON.stringify({ v: 1, who: 7, at: t0, m: [] })), { portal: false, call: false }, 'a record of another shape goes');
  assert.deepEqual(run(null, null), { portal: false, call: false }, 'nothing there, nothing made');
  assert.deepEqual(run(rec(t0 - 30 * DAY), rec(t0 - 30 * DAY - MIN)), { portal: true, call: false }, 'exactly thirty days stays, a minute more goes');
  const blocked = page({ host: 'call', id: 'DEV', person: 'X', ls: { getItem() { throw new Error('blocked'); } } });
  assert.doesNotThrow(() => blocked.K.sweepExpired(), 'blocked storage: nothing thrown');
  // and the module runs it when it is mounted, before it restores anything
  assert.ok(/st\.mounted = true;\s*paintTheme\(\);\s*sweepExpired\(\);[^\n]*\s*restore\(\);/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')), 'mount() sweeps first');
});

test('A FOREIGN CALL RECORD TAKES THE PORTAL\'S COPY WITH IT (F1): a handset that changed hands must not keep the last officer\'s portal conversation; a foreign portal record, or an expired one, takes only its own page\'s', () => {
  const store = new Map(), DEV = 'DEVICE-ID-9f8e7d6c5b4a';
  const juma = page({ store, host: 'call', id: DEV, person: 'JUMA ISSA' }); juma.K.addMsg('u', 'JUMA call question');
  const portal = page({ store, host: 'portal', id: 'ADM 442211', clock: juma.clock }); portal.K.addMsg('u', 'JUMA portal question');
  assert.deepEqual([...store.keys()].sort(), ['claudianChat.call', 'claudianChat.portal']);
  const asha = page({ store, host: 'call', id: DEV, person: 'ASHA KOMBO', clock: juma.clock });
  assert.equal(asha.K.restore(), false);
  assert.deepEqual([...store.keys()], [], 'the last officer\'s call record and the portal copy are both gone');
  // the portal side: another code\'s record goes, and the call app\'s record stays (nobody changed hands on the handset)
  const store2 = new Map();
  const c = page({ store: store2, host: 'call', id: DEV, person: 'JUMA ISSA' }); c.K.addMsg('u', 'q');
  const o = page({ store: store2, host: 'portal', id: 'FIRST CODE', clock: c.clock }); o.K.addMsg('u', 'q');
  const n = page({ store: store2, host: 'portal', id: 'SECOND CODE', clock: c.clock });
  assert.equal(n.K.restore(), false);
  assert.deepEqual([...store2.keys()], ['claudianChat.call'], 'only the portal\'s own copy went');
  // an EXPIRED record of the right person on the call page: only its own key (nobody else is implied)
  const store3 = new Map();
  const d = page({ store: store3, host: 'call', id: DEV, person: 'JUMA ISSA' }); d.K.addMsg('u', 'q');
  const e = page({ store: store3, host: 'portal', id: 'FIRST CODE', clock: d.clock }); e.K.addMsg('u', 'q');
  const later = page({ store: store3, host: 'call', id: DEV, person: 'JUMA ISSA', clock: { t: d.clock.t + 40 * DAY } });
  assert.equal(later.K.restore(), false);
  assert.deepEqual([...store3.keys()], ['claudianChat.portal'], 'an expired record of the same officer takes only itself (the sweep takes the other page\'s expired record at mount)');
});
