// The GM's one-tap email link: the GET confirmation page and the POST decision it submits to.
// handleGet/handlePost take `db` as a parameter (see the note above them in
// api/imprest-action.js) precisely so this file can test them against a fake database instead
// of the real Supabase singleton the route wires in for production.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from './fake-db.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.IMPREST_LINK_SECRET = 'test-link-secret';
process.env.RESEND_API_KEY = 'test-resend-key';

const { portalApi } = await import('../api/_lib/portal-core.js');
const { imprestActionToken } = await import('../api/_lib/imprest.js');
const { handleGet, handlePost, default: handler } = await import('../api/imprest-action.js');
const { _setFetch } = await import('../api/_lib/mail.js');
_setFetch(async () => ({ ok: true, json: async () => ({ id: 'mail-1' }) }));

const NOW = Date.parse('2026-07-24T09:00:00Z');
const TODAY = '2026-07-24';
const STAFF = { code: 'S1', name: 'JOHN', role: 'FIELD', teams: null, tabs: ['impreq'] };

function tables() {
  return {
    settings: [{ key: 'IMPREST_GM_EMAIL', value: 'gm@x.com' }, { key: 'EMAIL_FROM', value: 'X <a@b.com>' }],
    imprest_roles: [{ role: 'FIELD OFFICER', accommodation_per_day: 10000 }],
    imprest_requests: [], imprest_retirements: [], imprest_photos: [],
  };
}
async function askOne(db) {
  return portalApi(db, STAFF, 'imprestRequest', { fullName: 'John', email: 'j@x.com',
    imprestRole: 'field officer', travelDate: TODAY, purpose: 'trip', accomDays: 1 }, NOW);
}
function fakeRes() {
  const r = { statusCode: null, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = c => { r.statusCode = c; return r; };
  r.send = b => { r.body = b; return r; };
  return r;
}

test('GET with a valid token shows the request and both decision buttons', async () => {
  const db = fakeDb(tables());
  const r = await askOne(db);
  const token = imprestActionToken(r.id);
  const res = fakeRes();
  await handleGet(db, { query: { id: r.id, token } }, res, r.id, token);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Idhinisha \/ Approve/);
  assert.match(res.body, /Kataa \/ Reject/);
  assert.match(res.body, new RegExp('action="/api/imprest-action\\?id=' + r.id));
});

test('GET with a tampered token is refused, and never leaks the request', async () => {
  const db = fakeDb(tables());
  const r = await askOne(db);
  const res = fakeRes();
  await handleGet(db, {}, res, r.id, 'not-the-real-token');
  assert.equal(res.statusCode, 403);
  assert.doesNotMatch(res.body, /John/);
});

test('GET for an unknown id says so, not-found rather than a crash', async () => {
  const db = fakeDb(tables());
  const token = imprestActionToken('00000000-0000-0000-0000-000000000000');
  const res = fakeRes();
  await handleGet(db, {}, res, '00000000-0000-0000-0000-000000000000', token);
  assert.equal(res.statusCode, 404);
});

test('GET on an already-decided request shows the decision instead of the buttons', async () => {
  const db = fakeDb(tables());
  const r = await askOne(db);
  await portalApi(db, { code: 'GM1', name: 'GM', role: 'GM', teams: null, tabs: ['impappr'] },
    'imprestDecide', { id: r.id, approve: true }, NOW);
  const token = imprestActionToken(r.id);
  const res = fakeRes();
  await handleGet(db, {}, res, r.id, token);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Tayari limeamuliwa|Already decided/);
  assert.doesNotMatch(res.body, /Idhinisha \/ Approve/);
});

test('POST with the right token approves the request and reports whether the requester was emailed', async () => {
  const db = fakeDb(tables());
  const r = await askOne(db);
  const token = imprestActionToken(r.id);
  const res = fakeRes();
  await handlePost(db, {}, res, r.id, token, { approve: '1' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Imeidhinishwa \/ Approved/);
  assert.match(res.body, /notified by email/, 'the notified-or-not line must actually render, not print as code');
  assert.doesNotMatch(res.body, /r\.emailed|emailNote \+/, 'no stray JS source text ever reaches the page');
  const [row] = db._dump('imprest_requests');
  assert.equal(row.status, 'approved');
  assert.equal(row.decided_via_email, true);
});

test('POST with a tampered token decides nothing', async () => {
  const db = fakeDb(tables());
  const r = await askOne(db);
  const res = fakeRes();
  await handlePost(db, {}, res, r.id, 'wrong', { approve: '1' });
  assert.equal(res.statusCode, 403);
  const [row] = db._dump('imprest_requests');
  assert.equal(row.status, 'pending');
});

test('POST rejecting without a comment reports the same validation error the portal would', async () => {
  const db = fakeDb(tables());
  const r = await askOne(db);
  const token = imprestActionToken(r.id);
  const res = fakeRes();
  await handlePost(db, {}, res, r.id, token, { approve: '0', comment: '' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /sababu ya kukataa|comment is required/);
});

test('a request already decided cannot be decided again through the link', async () => {
  const db = fakeDb(tables());
  const r = await askOne(db);
  const token = imprestActionToken(r.id);
  await handlePost(db, {}, fakeRes(), r.id, token, { approve: '1' });
  const res2 = fakeRes();
  await handlePost(db, {}, res2, r.id, token, { approve: '0', comment: 'too late' });
  assert.equal(res2.statusCode, 400);
  assert.match(res2.body, /tayari limeamuliwa|already been decided/);
});

test('the raw handler refuses a request missing id or token before touching any database', async () => {
  const res = fakeRes();
  await handler({ method: 'GET', query: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('the raw handler refuses any method other than GET or POST', async () => {
  const res = fakeRes();
  await handler({ method: 'DELETE', query: { id: 'x', token: 'y' } }, res);
  assert.equal(res.statusCode, 405);
});
