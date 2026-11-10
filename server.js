/* =====================================================================================
   THE SAME SITE, OFF VERCEL.
   =====================================================================================

   Vercel runs this repository with no server of our own: `public/` is served as files, each
   `api/<name>.js` becomes a function, and `vercel.json` decides the rewrites and the headers.
   Anywhere else (AWS App Runner, a container, a laptop) that has to be done by something, and
   this is that something -- nothing more.

   ONE DEFINITION OF THE ROUTES. The rewrites and headers are READ FROM vercel.json at start-up,
   not copied in here. A second list would be a second answer to "what does /call serve", and
   the day the two disagreed a phone would open a different page depending on which host it
   reached. Change vercel.json and both hosts change together.

   WHAT IT GIVES A HANDLER is exactly what the handlers in api/ use from Vercel and no more:
   req.query, req.body (parsed JSON), and res.status / res.json / res.send on top of Node's own
   req and res. It adds NO database reads to any route -- not to /api/upload, not to /api/call.

   NOTHING IS KILLED MID-REQUEST ON A DEPLOY. On SIGTERM the server stops accepting new
   connections and waits for the ones in flight, so an upload slice that is half way through
   its write finishes and answers, rather than becoming the "landed but reported as failed"
   upload that gets sent twice.

   Run it:  node server.js            (PORT defaults to 8080)
   Health:  GET /healthz              (no database, for the load balancer) */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** Vercel refuses a request body over 4.5 MB. A little headroom here, but still a ceiling:
    an unbounded body is memory anyone can fill. The upload page sends 2,000-row slices,
    which are well under this. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** How long a shutdown waits for in-flight requests. Longer than an upload slice is allowed
    to run (UPLOAD_BUDGET_MS is 45s, the Vercel ceiling 60s). */
const DRAIN_MS = 65000;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
  '.apk': 'application/vnd.android.package-archive', '.woff2': 'font/woff2',
};

/* ---------------------------------------------------------------------------------------
   vercel.json -> matchers
   --------------------------------------------------------------------------------------- */

/** A vercel.json `source` is a path-to-regexp pattern. This repository uses literal paths
    and regex groups -- "/(home|dashboard)", "/(.*).html", "/mod/(.*)" -- so: copy a group
    as written, escape everything outside one, and turn a `:name` segment into one path
    segment. Anchored at both ends, as Vercel matches the whole path. */
export function sourceToRegExp(source) {
  let out = '', depth = 0;
  const s = String(source);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') { depth++; out += c; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); out += c; continue; }
    if (depth > 0) { out += c; continue; }
    if (c === ':' && /[A-Za-z_]/.test(s[i + 1] || '')) {
      let j = i + 1;
      while (j < s.length && /\w/.test(s[j])) j++;
      out += '([^/]+)';
      i = j - 1;
      continue;
    }
    out += /[.*+?^${}|[\]\\]/.test(c) ? '\\' + c : c;
  }
  return new RegExp('^' + out + '$');
}

export function loadVercelConfig(file = path.join(ROOT, 'vercel.json')) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    rewrites: (cfg.rewrites || []).map(r => ({ re: sourceToRegExp(r.source), destination: r.destination })),
    headers: (cfg.headers || []).map(h => ({ re: sourceToRegExp(h.source), headers: h.headers || [] })),
  };
}

/* ---------------------------------------------------------------------------------------
   Vercel's request and response helpers
   --------------------------------------------------------------------------------------- */

/** Repeated keys become an array, as on Vercel (?t=A&t=B -> ['A','B']). */
export function parseQuery(searchParams) {
  const q = {};
  for (const [k, v] of searchParams) {
    if (k in q) q[k] = Array.isArray(q[k]) ? q[k].concat(v) : [q[k], v];
    else q[k] = v;
  }
  return q;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        const e = new Error('Request body too large'); e.status = 413;
        reject(e); req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** As Vercel parses it: JSON into an object, a form into an object, text into a string,
    anything else left as a Buffer, nothing at all as undefined. */
export function parseBody(buf, contentType) {
  if (!buf || !buf.length) return undefined;
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (ct === 'application/json' || ct.endsWith('+json')) {
    try { return JSON.parse(buf.toString('utf8')); }
    catch { const e = new Error('Invalid JSON'); e.status = 400; throw e; }
  }
  if (ct === 'application/x-www-form-urlencoded') return parseQuery(new URLSearchParams(buf.toString('utf8')));
  if (ct.startsWith('text/')) return buf.toString('utf8');
  return buf;
}

function decorate(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = body => {
    if (body === undefined || body === null) { res.end(); return res; }
    if (Buffer.isBuffer(body)) {
      if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/octet-stream');
      res.end(body);
    } else if (typeof body === 'object') {
      return res.json(body);
    } else {
      if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(String(body));
    }
    return res;
  };
  return res;
}

function sendError(res, status, message) {
  if (res.headersSent) { res.end(); return; }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: false, error: message }));
}

/* ---------------------------------------------------------------------------------------
   The server
   --------------------------------------------------------------------------------------- */

export function createServer({ root = ROOT, config = loadVercelConfig(path.join(root, 'vercel.json')) } = {}) {
  const publicDir = path.join(root, 'public');
  const apiDir = path.join(root, 'api');
  const handlers = new Map();               // one import per route, kept, as Vercel keeps a warm function

  async function handlerFor(name) {
    if (handlers.has(name)) return handlers.get(name);
    const file = path.join(apiDir, name + '.js');
    if (!fs.existsSync(file)) return null;
    const mod = await import(pathToFileURL(file).href);
    const fn = typeof mod.default === 'function' ? mod.default : null;
    handlers.set(name, fn);
    return fn;
  }

  async function proxy(req, res, destination, search) {
    const body = (req.method === 'GET' || req.method === 'HEAD') ? undefined : await readBody(req);
    const headers = {};
    for (const h of ['content-type', 'accept', 'user-agent']) if (req.headers[h]) headers[h] = req.headers[h];
    const r = await fetch(destination + (search || ''), { method: req.method, headers, body });
    res.statusCode = r.status;
    const ct = r.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.end(Buffer.from(await r.arrayBuffer()));
  }

  function serveFile(req, res, urlPath) {
    let rel;
    try { rel = decodeURIComponent(urlPath); } catch { return false; }
    if (rel.includes('\0')) return false;
    const file = path.join(publicDir, path.normalize(rel));
    // Never outside public/, whatever the path says.
    if (file !== publicDir && !file.startsWith(publicDir + path.sep)) return false;
    let st;
    try { st = fs.statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    res.statusCode = 200;
    res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Content-Length', st.size);
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(file).pipe(res);
    return true;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;

      if (p === '/healthz') { res.statusCode = 200; res.setHeader('Content-Type', 'text/plain'); res.end('ok'); return; }

      // Headers apply to the path as REQUESTED, before any rewrite -- as on Vercel.
      for (const h of config.headers) if (h.re.test(p)) for (const { key, value } of h.headers) res.setHeader(key, value);

      // A real file wins over a rewrite, as on Vercel.
      if (!p.startsWith('/api/') && (req.method === 'GET' || req.method === 'HEAD')) {
        if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
        if (p !== '/' && serveFile(req, res, p)) return;
      }

      let target = p;
      for (const r of config.rewrites) {
        if (!r.re.test(p)) continue;
        if (/^https?:\/\//i.test(r.destination)) { await proxy(req, res, r.destination, url.search); return; }
        target = r.destination;
        break;
      }

      const m = /^\/api\/([a-z0-9-]+)$/i.exec(target);
      if (m) {
        const fn = await handlerFor(m[1]);
        if (!fn) { sendError(res, 404, 'Not found'); return; }
        req.query = parseQuery(url.searchParams);
        req.body = (req.method === 'GET' || req.method === 'HEAD') ? undefined
          : parseBody(await readBody(req), req.headers['content-type']);
        await fn(req, decorate(res));
        if (!res.writableEnded) res.end();
        return;
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && serveFile(req, res, target)) return;
      sendError(res, 404, 'Not found');
    } catch (e) {
      const status = (e && e.status) || 500;
      if (status >= 500) console.error(e);
      sendError(res, status, (e && e.message) || 'Server error');
    }
  });

  // A load balancer keeps connections open for 60s; outlast it, or it reuses a closed socket.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  return server;
}

/* Started directly (node server.js), not imported by a test. */
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set: pages and /healthz will work, /api/* will not.');
  }
  const port = Number(process.env.PORT) || 8080;
  const server = createServer();
  server.listen(port, () => console.log(`HOPE PMO listening on :${port}`));
  const stop = () => {
    console.log('Shutting down: no new connections, waiting for requests in flight.');
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), DRAIN_MS).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
