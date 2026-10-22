import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { startFixtureServer } from '../e2e/helpers/fixtures-server.js';

let server;
let tmp;

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe('fixtures server', () => {
  it('serves basic.html with 200', async () => {
    server = await startFixtureServer();
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(`${server.url}/basic.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await res.text()).toContain('<title>');
  });

  it('returns 404 for unknown path', async () => {
    server = await startFixtureServer();
    expect((await fetch(`${server.url}/nope.html`)).status).toBe(404);
    expect((await fetch(`${server.url}/img/404.png`)).status).toBe(404);
  });

  it('does not serve files outside root', async () => {
    server = await startFixtureServer();
    const res = await fetch(`${server.url}/..%2f..%2f..%2fpackage.json`);
    expect(res.status).toBe(404);
  });

  it('returns 500 JSON for /api/fail', async () => {
    server = await startFixtureServer();
    const res = await fetch(`${server.url}/api/fail`);
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.json()).toHaveProperty('error');
  });

  it('returns 200 JSON for /api/ok', async () => {
    server = await startFixtureServer();
    const res = await fetch(`${server.url}/api/ok`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('adds CSP header for csp-strict.html', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'pds-fixtures-'));
    writeFileSync(join(tmp, 'csp-strict.html'), '<!doctype html><title>t</title>');
    writeFileSync(join(tmp, 'basic.html'), '<!doctype html><title>t</title>');
    server = await startFixtureServer({ root: tmp });
    const strict = await fetch(`${server.url}/csp-strict.html`);
    expect(strict.status).toBe(200);
    expect(strict.headers.get('content-security-policy')).toBe("script-src 'self'");
    const basic = await fetch(`${server.url}/basic.html`);
    expect(basic.headers.get('content-security-policy')).toBeNull();
  });

  it('binds to 127.0.0.1 only', async () => {
    server = await startFixtureServer();
    expect(new URL(server.url).hostname).toBe('127.0.0.1');
    expect(server.address).toBe('127.0.0.1');
  });

  it('close() releases the port', async () => {
    server = await startFixtureServer();
    const port = Number(new URL(server.url).port);
    await server.close();
    server = undefined;
    // Binding the same port again succeeds only if the server let it go.
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
  });
});
