import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { FIXTURE_SECRETS, startFixtureServer } from '../e2e/helpers/fixtures-server.js';

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

  // E2-T13: routes for E2 e2e (statuses, delays, sequences, header echo, endless stream, vendor oracle).
  it('status route returns code, type and body', async () => {
    server = await startFixtureServer();
    const json = await fetch(`${server.url}/status/500?body=json`);
    expect(json.status).toBe(500);
    expect(json.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await json.json()).toEqual({ error: 'status 500', status: 500 });

    const text = await fetch(`${server.url}/status/404?body=text&type=text/x-custom`);
    expect(text.status).toBe(404);
    expect(text.headers.get('content-type')).toBe('text/x-custom');
    expect(await text.text()).toBe('Status 404');

    const token = await fetch(`${server.url}/status/401?body=token`);
    expect(token.status).toBe(401);
    const tokenText = await token.text();
    const [first, second] = tokenText.split('\n');
    expect(JSON.parse(first)).toEqual({ error: 'expired', access_token: FIXTURE_SECRETS.jwt });
    expect(second).toBe(`Authorization: Bearer ${FIXTURE_SECRETS.bearer}`);
    expect(FIXTURE_SECRETS.jwt).toMatch(/^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/);

    const png = await fetch(`${server.url}/status/500?body=png`);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await png.arrayBuffer()).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const page = await fetch(`${server.url}/status/404?body=page`);
    expect(page.status).toBe(404);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await page.text()).toContain('<title>');

    const ok = await fetch(`${server.url}/status/200`); // default body: json
    expect(await ok.json()).toEqual({ error: null, status: 200 });

    expect((await fetch(`${server.url}/status/99`)).status).toBe(400);
    expect((await fetch(`${server.url}/status/abc`)).status).toBe(400);
    expect((await fetch(`${server.url}/status/500?body=nope`)).status).toBe(400);
  });

  it('delay route waits ≥ ms', async () => {
    server = await startFixtureServer();
    for (const path of ['/status/200?delay=300', '/img/hero.png?delay=300']) {
      const t0 = Date.now();
      const res = await fetch(`${server.url}${path}`);
      await res.arrayBuffer();
      expect(Date.now() - t0, path).toBeGreaterThanOrEqual(295);
      expect(res.status, path).toBe(200);
    }
    const hero = await fetch(`${server.url}/img/hero.png`);
    expect(hero.headers.get('content-type')).toBe('image/png');
  });

  it('seq route cycles 200/500/404 and resets', async () => {
    server = await startFixtureServer();
    const statuses = async (name, n) => {
      const out = [];
      for (let i = 0; i < n; i++) out.push((await fetch(`${server.url}/seq/${name}`)).status);
      return out;
    };
    expect(await statuses('x', 4)).toEqual([200, 500, 404, 200]);
    expect(await statuses('y', 1)).toEqual([200]); // names are independent
    expect((await fetch(`${server.url}/seq/x?reset`)).status).toBe(204);
    expect(await statuses('x', 3)).toEqual([200, 500, 404]);
  });

  it('echo stores request headers by id', async () => {
    server = await startFixtureServer();
    await fetch(`${server.url}/echo/headers?id=a1`, { headers: { 'X-Probe': 'one' } });
    await fetch(`${server.url}/echo/headers?id=b2`, { method: 'POST', body: 'x', headers: { 'X-Probe': 'two' } });
    const a = await (await fetch(`${server.url}/echo/last?id=a1`)).json();
    expect(a.method).toBe('GET');
    expect(a.headers['x-probe']).toBe('one');
    expect(a.rawHeaders).toContain('X-Probe');
    const b = await (await fetch(`${server.url}/echo/last?id=b2`)).json();
    expect(b.method).toBe('POST');
    expect(b.headers['x-probe']).toBe('two');
    expect((await fetch(`${server.url}/echo/last?id=missing`)).status).toBe(404);
  });

  it('stream route never ends (first chunk arrives)', async () => {
    server = await startFixtureServer();
    const { status, type, chunk, ended } = await new Promise((resolveReq, rejectReq) => {
      const req = request(`${server.url}/stream/500`, (res) => {
        let done = false;
        res.on('end', () => { done = true; });
        res.once('data', (data) => {
          // Still open well after the first chunk.
          setTimeout(() => {
            resolveReq({ status: res.statusCode, type: res.headers['content-type'], chunk: String(data), ended: done });
            req.destroy();
          }, 400);
        });
      });
      req.on('error', (e) => { if (e.code !== 'ECONNRESET') rejectReq(e); });
      req.end();
    });
    expect(status).toBe(500);
    expect(type).toMatch(/^text\/plain/);
    expect(chunk.length).toBeGreaterThan(0);
    expect(ended).toBe(false);
  });

  it('vendor route serves web-vitals', async () => {
    server = await startFixtureServer();
    const res = await fetch(`${server.url}/vendor/web-vitals.attribution.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/javascript/);
    const code = await res.text();
    expect(code).toMatch(/onLCP/);
    expect(code).toMatch(/onINP/);
    expect((await fetch(`${server.url}/vendor/..%2fpackage.json`)).status).toBe(404);
    expect((await fetch(`${server.url}/vendor/other.js`)).status).toBe(404);
  });

  it('same server answers as a second origin on localhost', async () => {
    server = await startFixtureServer();
    expect(server.otherOrigin).toBe(`http://localhost:${server.port}`);
    expect((await fetch(`${server.otherOrigin}/basic.html`)).status).toBe(200);
  });
});
