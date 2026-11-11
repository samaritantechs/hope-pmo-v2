/* server.js -- the same site off Vercel. These check that it answers as Vercel does for the
   things this repository relies on: the vercel.json rewrites and headers, Vercel's req/res
   helpers, the API's CORS preflight, and that nothing outside public/ can be read. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const { createServer, sourceToRegExp, parseBody, parseQuery } = await import('../server.js');
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import http from 'node:http';

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

test('each site says which book it reads, without saying where the book is', async () => {
  const { bookId } = await import('../api/_lib/supabase.js');
  const b = await (await fetch(base + '/api/app-version')).json();
  assert.match(b.book, /^[0-9a-f]{12}$/, 'a fingerprint, on the question the app already asks at every launch');
  assert.equal(b.book, bookId(process.env.SUPABASE_URL), 'of the database address this process was started with');
  assert.ok(!JSON.stringify(b).includes(new URL(process.env.SUPABASE_URL).host), 'never the address itself');
  // One book is one fingerprint, however the address was typed into a host's settings.
  const one = bookId('https://abcdefghijklmnopqrst.supabase.co');
  for (const same of ['https://abcdefghijklmnopqrst.supabase.co/', '  https://ABCDEFGHIJKLMNOPQRST.supabase.co\n',
                      'https://abcdefghijklmnopqrst.supabase.co/rest/v1']) {
    assert.equal(bookId(same), one, JSON.stringify(same));
  }
  // Another database is another book -- a copy kept on our own machine included.
  for (const other of ['https://zzzzefghijklmnopqrst.supabase.co', 'http://localhost:8000', 'http://127.0.0.1:8000',
                       'https://abcdefghijklmnopqrst.supabase.co:6543']) {
    assert.notEqual(bookId(other), one, other);
    assert.match(bookId(other), /^[0-9a-f]{12}$/, other);
  }
  // No address, no fingerprint -- and an empty one must never be taken to match anything.
  for (const none of ['', '   ', null, 'not an address', 'localhost:8000']) assert.equal(bookId(none), '', JSON.stringify(none));
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

/* =====================================================================================
   WHAT VERCEL DID WITHOUT BEING ASKED: "not changed" answers and compression.

   The call app's page is thrown away and reloaded after almost every call, on mobile data. On
   Vercel that reload is a few hundred bytes of 304; off Vercel it was the whole 187 KB page,
   uncompressed, every time -- and every list after it several times its compressed size. These
   pin that the server now does both itself, whatever proxy stands in front of it.
   ===================================================================================== */
/** A raw request, so nothing is added to or taken off the headers and the body is as sent. */
function raw(pathname, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(base + pathname, { method, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('a page the phone already holds is answered "not changed", not sent again', async () => {
  const first = await raw('/call.html');
  assert.equal(first.status, 200);
  assert.match(first.headers.etag, /^W\/"[0-9a-f]+-[0-9a-f]+"$/, 'every file carries a validator');
  assert.ok(Date.parse(first.headers['last-modified']) > 0, 'and when it was last written');
  // The phone asks with what it was given: the answer is 304 and has no body.
  const again = await raw('/call.html', { 'If-None-Match': first.headers.etag });
  assert.equal(again.status, 304); assert.equal(again.body.length, 0);
  assert.equal(again.headers.etag, first.headers.etag);
  assert.equal(again.headers['cache-control'], 'no-cache, must-revalidate', 'the same caching rule rides on the 304');
  // The rewritten address is the same file, so the same answer.
  const viaRewrite = await raw('/call', { 'If-None-Match': first.headers.etag });
  assert.equal(viaRewrite.status, 304);
  // By date, for a client that only keeps the date.
  assert.equal((await raw('/call.html', { 'If-Modified-Since': first.headers['last-modified'] })).status, 304);
  assert.equal((await raw('/call.html', { 'If-Modified-Since': 'Mon, 01 Jan 2001 00:00:00 GMT' })).status, 200);
  // A copy of another version is sent the page.
  const stale = await raw('/call.html', { 'If-None-Match': 'W/"1-1"' });
  assert.equal(stale.status, 200); assert.ok(stale.body.length > 1000);
  // A module and an image too: everything under public/ can be revalidated.
  for (const p of ['/mod/admin.js', '/lock-logo.png']) {
    const f = await raw(p);
    assert.equal((await raw(p, { 'If-None-Match': f.headers.etag })).status, 304, p);
  }
});

test('pages and scripts are sent compressed to a client that accepts it, and whole to one that does not', async () => {
  const onDisk = fs.readFileSync(new URL('../public/call.html', import.meta.url));
  const gz = await raw('/call.html', { 'Accept-Encoding': 'gzip, deflate, br' });
  assert.equal(gz.status, 200);
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(gz.headers.vary, 'Accept-Encoding');
  assert.equal(Number(gz.headers['content-length']), gz.body.length);
  assert.ok(gz.body.length < onDisk.length / 2, 'less than half the page crosses the network (' + gz.body.length + ' of ' + onDisk.length + ' bytes)');
  assert.ok(zlib.gunzipSync(gz.body).equals(onDisk), 'and it opens to exactly the file');
  // The second ask is served from the kept copy and is the same bytes.
  assert.ok((await raw('/call.html', { 'Accept-Encoding': 'gzip' })).body.equals(gz.body));
  // No Accept-Encoding: the file as it is.
  const plain = await raw('/call.html');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.ok(plain.body.equals(onDisk));
  // A module is compressed; an image is already compressed and is left alone.
  assert.equal((await raw('/mod/admin.js', { 'Accept-Encoding': 'gzip' })).headers['content-encoding'], 'gzip');
  const img = await raw('/lock-logo.png', { 'Accept-Encoding': 'gzip' });
  assert.equal(img.headers['content-encoding'], undefined); assert.equal(img.headers.vary, undefined);
  // HEAD says what GET would, without the body.
  const head = await raw('/call.html', { 'Accept-Encoding': 'gzip' }, 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers['content-length']), gz.body.length);
});

test('an API answer is compressed off the main thread when it is big enough to be worth it', async () => {
  // A site of its own: one route that answers with a list, as /api/call does.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hope-server-'));
  fs.mkdirSync(path.join(root, 'api')); fs.mkdirSync(path.join(root, 'public'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, 'vercel.json'), '{}');
  fs.writeFileSync(path.join(root, 'api', 'list.js'),
    "export default (req, res) => { const n = Number(req.query.n) || 0; res.status(200).json({ ok: true, rows: Array.from({ length: n }, (_, i) => ({ ref: 'R' + i, name: 'CUSTOMER NUMBER ' + i, amt: i * 100 })) }); };");
  fs.writeFileSync(path.join(root, 'api', 'none.js'), 'export default (req, res) => { res.status(204).end(); };');
  const srv = createServer({ root });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const at = 'http://127.0.0.1:' + srv.address().port;
  const ask = (p, headers = {}) => new Promise((resolve, reject) => {
    http.get(at + p, { headers }, res => { const c = []; res.on('data', x => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) })); }).on('error', reject);
  });
  try {
    const big = await ask('/api/list?n=3000', { 'Accept-Encoding': 'gzip' });
    assert.equal(big.status, 200);
    assert.equal(big.headers['content-encoding'], 'gzip');
    assert.match(big.headers['content-type'], /application\/json/);
    const rows = JSON.parse(zlib.gunzipSync(big.body).toString('utf8')).rows;
    assert.equal(rows.length, 3000); assert.equal(rows[2999].name, 'CUSTOMER NUMBER 2999');
    const whole = await ask('/api/list?n=3000');
    assert.equal(whole.headers['content-encoding'], undefined);
    assert.equal(JSON.parse(whole.body.toString('utf8')).rows.length, 3000);
    assert.ok(big.body.length < whole.body.length / 4, 'a list crosses the network at under a quarter of its size (' + big.body.length + ' of ' + whole.body.length + ')');
    assert.equal(big.headers.vary, 'Accept-Encoding'); assert.equal(whole.headers.vary, 'Accept-Encoding');
    // A small answer is not worth the header.
    const small = await ask('/api/list?n=2', { 'Accept-Encoding': 'gzip' });
    assert.equal(small.headers['content-encoding'], undefined);
    assert.equal(JSON.parse(small.body.toString('utf8')).rows.length, 2);
    // Many at once: each gets its own whole answer.
    const many = await Promise.all(Array.from({ length: 12 }, (_, i) => ask('/api/list?n=' + (1500 + i), { 'Accept-Encoding': 'gzip' })));
    many.forEach((r, i) => assert.equal(JSON.parse(zlib.gunzipSync(r.body).toString('utf8')).rows.length, 1500 + i));
    // A route that answers with no body still ends.
    assert.equal((await ask('/api/none', { 'Accept-Encoding': 'gzip' })).status, 204);
  } finally {
    await new Promise(r => srv.close(r));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the real API still answers through the compressing path', async () => {
  // fetch asks for gzip and opens it itself, as a browser does.
  const r = await fetch(base + '/api/app-version');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  const bad = await fetch(base + '/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(typeof (await bad.json()).ok, 'boolean', 'an error answer is still JSON');
});
