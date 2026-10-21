// Local static server for e2e fixture pages. No internet needed (AC-3.2).
// Library: startFixtureServer() for Playwright. CLI: `npm run fixtures [-- --port N]`
// for manual QA in Firefox (default port 8080).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const DEFAULT_ROOT = fileURLToPath(new URL('../../fixtures/pages/', import.meta.url));

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

function createHandler(root) {
  const rootDir = resolve(root);
  return async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
    } catch {
      return notFound(res);
    }

    if (pathname === '/api/fail') {
      return send(res, 500, JSON.stringify({ error: 'forced failure' }), {
        'Content-Type': MIME['.json'],
      });
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
    send(res, 200, body, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      ...ROUTE_HEADERS[pathname],
    });
  };
}

/**
 * Starts the fixture server on 127.0.0.1.
 * @param {{ port?: number, root?: string }} [options] port 0 picks a free port.
 * @returns {Promise<{ url: string, address: string, port: number, close: () => Promise<void> }>}
 */
export function startFixtureServer({ port = 0, root = DEFAULT_ROOT } = {}) {
  const server = createServer(createHandler(root));
  return new Promise((resolveStart, rejectStart) => {
    server.once('error', rejectStart);
    server.listen(port, HOST, () => {
      server.off('error', rejectStart);
      const { address, port: actualPort } = server.address();
      resolveStart({
        url: `http://${HOST}:${actualPort}`,
        address,
        port: actualPort,
        close: () =>
          new Promise((resolveClose, rejectClose) => {
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
