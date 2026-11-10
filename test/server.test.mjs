/* server.js -- the same site off Vercel. These check that it answers as Vercel does for the
   things this repository relies on: the vercel.json rewrites and headers, Vercel's req/res
   helpers, the API's CORS preflight, and that nothing outside public/ can be read. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createServer, sourceToRegExp, parseBody, parseQuery } = await import('../server.js');

let server, base;
before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => new Promise(r => server.close(r)));

test('vercel.json sources become anchored patterns', () => {
  assert.ok(sourceToRegExp('/').test('/'));
  assert.ok(!sourceToRegExp('/').test('/x'));
  assert.ok(sourceToRegExp('/(home|dashboard)').test('/dashboard'));
  assert.ok(!sourceToRegExp('/(home|dashboard)').test('/dashboards'));
  assert.ok(sourceToRegExp('/(.*).html').test('/app.html'));
  assert.ok(!sourceToRegExp('/(.*).html').test('/apphtml'), 'the dot outside a group is literal');
  assert.ok(sourceToRegExp('/mod/(.*)').test('/mod/admin.js'));
  assert.ok(sourceToRegExp('/brand.js').test('/brand.js'));
  assert.ok(!sourceToRegExp('/brand.js').test('/brandxjs'));
  assert.ok(sourceToRegExp('/u/:id').test('/u/42'));
});

test('the launcher, and every rewrite in vercel.json, serves its page', async () => {
  for (const [p, marker] of [['/', 'home.html'], ['/call', 'call.html'], ['/dashboard', 'app.html'],
                             ['/portal', 'app.html'], ['/upload', 'upload.html']]) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), /text\/html/, p);
    assert.equal(r.headers.get('cache-control'), 'no-cache, must-revalidate', p + ' is never cached');
    assert.ok((await r.text()).length > 100, p + ' (' + marker + ') has a body');
  }
});

test('the BUILD stamp the deploy checks is readable from /app.html', async () => {
  const html = await (await fetch(base + '/app.html')).text();
  assert.match(html, /^var BUILD = '[^']+'/m);
});

test('modules are served uncached, other files with Vercel\'s default', async () => {
  const mod = await fetch(base + '/mod/admin.js');
  assert.equal(mod.status, 200);
  assert.equal(mod.headers.get('cache-control'), 'no-cache, must-revalidate');
  assert.match(mod.headers.get('content-type'), /javascript/);
  const img = await fetch(base + '/lock-logo.png');
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
});

test('nothing outside public/ can be read', async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/api/_lib/auth', '/server.js']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 404, p);
  }
});

test('an API route answers through withApi, with CORS', async () => {
  const r = await fetch(base + '/api/app-version');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(typeof b.versionCode, 'number');
  const pre = await fetch(base + '/api/portal', { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
});

test('a broken JSON body is a 400, not a crash', async () => {
  const r = await fetch(base + '/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).ok, false);
});

test('an unknown route is a 404', async () => {
  assert.equal((await fetch(base + '/api/no-such-route')).status, 404);
  assert.equal((await fetch(base + '/no-such-page')).status, 404);
});

test('health check needs no database', async () => {
  const r = await fetch(base + '/healthz');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'ok');
});

test('body and query parse as on Vercel', () => {
  assert.deepEqual(parseBody(Buffer.from('{"a":1}'), 'application/json; charset=utf-8'), { a: 1 });
  assert.equal(parseBody(Buffer.from('hi'), 'text/plain'), 'hi');
  assert.equal(parseBody(Buffer.alloc(0), 'application/json'), undefined);
  assert.deepEqual(parseQuery(new URLSearchParams('t=A&t=B&c=1')), { t: ['A', 'B'], c: '1' });
});
