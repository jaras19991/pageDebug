// Local static server for e2e fixture pages. No internet needed (AC-3.2).
// Library: startFixtureServer() for Playwright. CLI: `npm run fixtures [-- --port N]`
// for manual QA in Firefox (default port 8080).
//
// Dynamic routes (E2-T13):
//   /status/<200-599>?body=json|text|token|png|page&type=<mime>&delay=<ms>   response with that status
//   /seq/<name>        200 → 500 → 404 → 200 … per name; /seq/<name>?reset → 204, starts over
//   /stream/500        500 text/plain that never ends (a chunk every 100 ms until the client goes away)
//   /echo/headers?id=  stores the request headers under id; GET /echo/last?id= returns them (AC-4.9)
//   /vendor/web-vitals*.js   web-vitals from node_modules, the metrics oracle for e2e only (D7)
//   any static file    ?delay=<ms> holds the response (e.g. /img/hero.png?delay=1500 for LCP)
// The same server answers on http://localhost:<port> as a second origin (`otherOrigin`).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const DEFAULT_ROOT = fileURLToPath(new URL('../../fixtures/pages/', import.meta.url));
const VENDOR_DIR = fileURLToPath(new URL('../../../node_modules/web-vitals/dist/', import.meta.url));
const MAX_DELAY_MS = 30_000;
const MAX_KEYS = 200; // /seq names and /echo ids kept per server
const MAX_KEY_LENGTH = 64;

// Fake credentials in /status/<code>?body=token; e2e greps the package for them (AC-4.7).
// The JWT is well-formed (base64url header.payload.signature) so redaction rules see a real shape.
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
export const FIXTURE_SECRETS = Object.freeze({
  jwt: `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'pds-fixture-user', exp: 1893456000 })}.c2lnbmF0dXJlLXBkcy1maXh0dXJlLW5vdC1yZWFs`,
  bearer: 'pdsFixtureBearer7f3a9c2e5b1d8046aa',
});

// 1×1 PNG for /status/<code>?body=png.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Per-path extra headers. CSP comes from the server, not <meta>, so AC-2.4 tests the real header.
const ROUTE_HEADERS = {
  '/csp-strict.html': { 'Content-Security-Policy': "script-src 'self'" },
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function notFound(res) {
  send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
}

function badRequest(res, message) {
  send(res, 400, message, { 'Content-Type': 'text/plain; charset=utf-8' });
}

function json(res, status, value, headers = {}) {
  send(res, status, JSON.stringify(value), { 'Content-Type': MIME['.json'], ...headers });
}

// Bounded Map for per-server state: drops the oldest key past MAX_KEYS.
function remember(map, key, value) {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_KEYS) map.delete(map.keys().next().value);
}

function validKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH;
}

// `?delay=<ms>`: integer 0..MAX_DELAY_MS, otherwise null (→ 400).
function parseDelay(params) {
  if (!params.has('delay')) return 0;
  const ms = Number(params.get('delay'));
  return Number.isInteger(ms) && ms >= 0 && ms <= MAX_DELAY_MS ? ms : null;
}

const STATUS_BODIES = {
  json: (code) => [MIME['.json'], JSON.stringify({ error: code >= 400 ? `status ${code}` : null, status: code })],
  text: (code) => ['text/plain; charset=utf-8', `Status ${code}`],
  // Two lines on purpose: a JSON token response plus a header-looking line (masked as text, AC-4.7).
  token: () => [
    MIME['.json'],
    `${JSON.stringify({ error: 'expired', access_token: FIXTURE_SECRETS.jwt })}\nAuthorization: Bearer ${FIXTURE_SECRETS.bearer}`,
  ],
  png: () => [MIME['.png'], TINY_PNG],
  page: (code) => [MIME['.html'], `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Status ${code}</title></head><body><h1>Status ${code}</h1></body></html>`],
};
const SEQ_STATUSES = [200, 500, 404];

function createHandler(root) {
  const rootDir = resolve(root);
  const seq = new Map(); // name → number of answered requests
  const echoes = new Map(); // id → { method, url, headers, rawHeaders }
  const streams = new Set(); // open /stream/500 intervals, cleared on close
  const timers = new Set(); // pending ?delay timers

  // Resolves after ms, or never when the client went away first (the response is then not sent).
  const wait = (ms, res) =>
    new Promise((resolveWait) => {
      if (!ms) return resolveWait(true);
      const timer = setTimeout(() => {
        timers.delete(timer);
        resolveWait(!res.destroyed);
      }, ms);
      timers.add(timer);
      res.once('close', () => {
        clearTimeout(timer);
        timers.delete(timer);
      });
    });

  const handler = async (req, res) => {
    let pathname;
    let params;
    try {
      const url = new URL(req.url, `http://${HOST}`);
      pathname = decodeURIComponent(url.pathname);
      params = url.searchParams;
    } catch {
      return notFound(res);
    }
    const delay = parseDelay(params);
    if (delay === null) return badRequest(res, `delay must be an integer 0..${MAX_DELAY_MS}`);

    let m = /^\/status\/(\d{1,3})$/.exec(pathname);
    if (m || pathname.startsWith('/status/')) {
      const code = m ? Number(m[1]) : NaN;
      if (!(code >= 200 && code <= 599)) return badRequest(res, 'status must be 200..599');
      const kind = params.get('body') ?? 'json';
      if (!Object.hasOwn(STATUS_BODIES, kind)) return badRequest(res, `unknown body '${kind}'`);
      const [type, body] = STATUS_BODIES[kind](code);
      if (!(await wait(delay, res))) return;
      return send(res, code, body, { 'Content-Type': params.get('type')?.slice(0, 200) || type });
    }

    m = /^\/seq\/([^/]+)$/.exec(pathname);
    if (m) {
      const name = m[1];
      if (!validKey(name)) return badRequest(res, 'bad sequence name');
      if (params.has('reset')) {
        seq.delete(name);
        return send(res, 204, '');
      }
      const n = seq.get(name) ?? 0;
      remember(seq, name, n + 1);
      const status = SEQ_STATUSES[n % SEQ_STATUSES.length];
      if (!(await wait(delay, res))) return;
      return json(res, status, { seq: name, n, status });
    }

    if (pathname === '/stream/500') {
      res.writeHead(500, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' });
      let i = 0;
      const tick = () => res.write(`chunk ${i++}\n`);
      tick();
      const interval = setInterval(tick, 100);
      streams.add(interval);
      res.once('close', () => {
        clearInterval(interval);
        streams.delete(interval);
      });
      return;
    }

    if (pathname === '/echo/headers') {
      const id = params.get('id');
      if (!validKey(id)) return badRequest(res, 'id required (1..64 chars)');
      req.resume(); // drain a request body, if any
      remember(echoes, id, { method: req.method, url: req.url.slice(0, 2000), headers: req.headers, rawHeaders: req.rawHeaders });
      return json(res, 200, { ok: true, id });
    }
    if (pathname === '/echo/last') {
      const id = params.get('id');
      if (!validKey(id) || !echoes.has(id)) return notFound(res);
      return json(res, 200, echoes.get(id));
    }

    if (pathname.startsWith('/vendor/')) {
      const name = pathname.slice('/vendor/'.length);
      if (!/^web-vitals[\w.-]*\.js$/.test(name)) return notFound(res);
      let body;
      try {
        body = await readFile(join(VENDOR_DIR, name));
      } catch {
        return notFound(res);
      }
      return send(res, 200, body, { 'Content-Type': MIME['.js'] });
    }

    if (pathname === '/api/fail') {
      return send(res, 500, JSON.stringify({ error: 'forced failure' }), {
        'Content-Type': MIME['.json'],
      });
    }
    if (pathname === '/api/ok') {
      return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': MIME['.json'] });
    }
    if (pathname === '/img/404.png') return notFound(res);
    if (pathname === '/') pathname = '/basic.html';

    const file = resolve(rootDir, '.' + pathname);
    // Reject traversal outside root (e.g. encoded "../").
    if (!file.startsWith(rootDir + sep)) return notFound(res);

    let body;
    try {
      body = await readFile(file);
    } catch {
      return notFound(res);
    }
    if (!(await wait(delay, res))) return;
    send(res, 200, body, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      ...ROUTE_HEADERS[pathname],
    });
  };
  handler.dispose = () => {
    for (const t of [...timers, ...streams]) clearTimeout(t); // clearTimeout also clears intervals
    timers.clear();
    streams.clear();
  };
  return handler;
}

/**
 * Starts the fixture server on 127.0.0.1.
 * @param {{ port?: number, root?: string }} [options] port 0 picks a free port.
 * @returns {Promise<{ url: string, otherOrigin: string, address: string, port: number, close: () => Promise<void> }>}
 *   `otherOrigin` is the same server as http://localhost:<port> (a different origin for the browser).
 */
export function startFixtureServer({ port = 0, root = DEFAULT_ROOT } = {}) {
  const handler = createHandler(root);
  const server = createServer(handler);
  return new Promise((resolveStart, rejectStart) => {
    server.once('error', rejectStart);
    server.listen(port, HOST, () => {
      server.off('error', rejectStart);
      const { address, port: actualPort } = server.address();
      resolveStart({
        url: `http://${HOST}:${actualPort}`,
        otherOrigin: `http://localhost:${actualPort}`,
        address,
        port: actualPort,
        close: () =>
          new Promise((resolveClose, rejectClose) => {
            handler.dispose();
            server.closeAllConnections();
            server.close((err) => (err ? rejectClose(err) : resolveClose()));
          }),
      });
    });
  });
}

function parsePort(argv) {
  const i = argv.indexOf('--port');
  if (i === -1) return 8080;
  const port = Number(argv[i + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid --port value: ${argv[i + 1]}`);
  }
  return port;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url, close } = await startFixtureServer({ port: parsePort(process.argv.slice(2)) });
  console.log(`Fixture pages: ${url}/basic.html (Ctrl+C to stop)`);
  process.on('SIGINT', () => close().then(() => process.exit(0)));
}
