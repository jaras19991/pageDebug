// @vitest-environment jsdom
/* global window, XMLHttpRequest -- jsdom globals (vitest-environment jsdom) */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installFetchHook, installXhrHook, NETWORK_LIMITS } from '../../src/page/hooks-network.js';

// E1-T4: fetch through Proxy `apply`, XMLHttpRequest through Proxy `construct` (D5, AC-5.1–5.3).
// XHR tests use jsdom's own XMLHttpRequest with `data:` URLs (no network); fetch tests use a
// stand-in "native" fetch returning a Node `Response`.

const BASE = 'http://example.test/app/';

function makeCtx(win, overrides = {}) {
  const records = [];
  let clock = 0;
  const ctx = {
    win,
    now: () => (clock += 10),
    record: (kind, entry) => records.push({ kind, entry }),
    json: (value) => (value instanceof Error ? { name: value.name, message: value.message } : value),
    ...overrides,
  };
  return { ctx, records };
}

function waitLoadend(xhr) {
  return new Promise((resolve) => xhr.addEventListener('loadend', resolve));
}

describe('XMLHttpRequest hook', () => {
  const NativeXHR = window.XMLHttpRequest;
  let restore;
  let records;

  beforeEach(() => {
    const made = makeCtx(window);
    records = made.records;
    restore = installXhrHook(made.ctx);
  });
  afterEach(() => {
    restore();
    expect(window.XMLHttpRequest).toBe(NativeXHR);
  });

  it('new XMLHttpRequest() instanceof XMLHttpRequest after install', () => {
    expect(window.XMLHttpRequest).not.toBe(NativeXHR);
    const xhr = new XMLHttpRequest();
    expect(xhr instanceof XMLHttpRequest).toBe(true);
    expect(xhr instanceof NativeXHR).toBe(true);
    expect(Object.getPrototypeOf(xhr)).toBe(NativeXHR.prototype);
    expect(XMLHttpRequest.name).toBe('XMLHttpRequest');
  });

  it('XMLHttpRequest.DONE === 4 and UNSENT/OPENED/HEADERS_RECEIVED/LOADING', () => {
    expect(XMLHttpRequest.DONE).toBe(4);
    expect(XMLHttpRequest.UNSENT).toBe(0);
    expect(XMLHttpRequest.OPENED).toBe(1);
    expect(XMLHttpRequest.HEADERS_RECEIVED).toBe(2);
    expect(XMLHttpRequest.LOADING).toBe(3);
    expect(new XMLHttpRequest().DONE).toBe(4);
  });

  it('XMLHttpRequest.prototype is the original object and its methods are untouched', () => {
    restore();
    const before = Object.getOwnPropertyDescriptors(NativeXHR.prototype);
    restore = installXhrHook(makeCtx(window).ctx);
    new XMLHttpRequest().open('GET', 'data:text/plain,x');
    expect(XMLHttpRequest.prototype).toBe(NativeXHR.prototype);
    expect(Object.getOwnPropertyDescriptors(XMLHttpRequest.prototype)).toEqual(before);
  });

  it('withCredentials, responseType and onreadystatechange work', async () => {
    const xhr = new XMLHttpRequest();
    const states = [];
    xhr.onreadystatechange = () => states.push(xhr.readyState);
    xhr.open('GET', 'data:application/json,{"a":1}');
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.responseType).toBe('json');
    const done = waitLoadend(xhr);
    xhr.send();
    await done;
    expect(xhr.response).toEqual({ a: 1 });
    expect(states).toContain(XMLHttpRequest.DONE);
  });

  it('axios-like wrapper (open, setRequestHeader, send, onload) records method/url/status', async () => {
    const xhr = new XMLHttpRequest();
    const loaded = new Promise((resolve) => { xhr.onload = () => resolve(xhr.status); });
    xhr.open('post', 'data:text/plain,hello', true);
    xhr.setRequestHeader('Content-Type', 'text/plain');
    xhr.setRequestHeader('X-Req', 'abc');
    const done = waitLoadend(xhr);
    xhr.send('payload');
    expect(await loaded).toBe(200);
    await done;
    expect(records).toHaveLength(1);
    const { kind, entry } = records[0];
    expect(kind).toBe('network');
    expect(entry).toMatchObject({
      type: 'xhr',
      method: 'POST',
      url: 'data:text/plain,hello',
      status: 200,
      ok: true,
      requestHeaders: { 'Content-Type': 'text/plain', 'X-Req': 'abc' },
      requestBody: 'payload',
      error: null,
    });
    expect(typeof entry.t).toBe('number');
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.responseHeaders).toBeTypeOf('object');
  });

  it('t is counted from send(), or from open() when send() was not called', async () => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'data:text/plain,x'); // clock 10
    xhr.send(); // clock 20
    await waitLoadend(xhr);
    expect(records[0].entry.t).toBe(20);
  });

  it('error/abort are recorded in error field', async () => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'data:text/plain,x');
    const done = waitLoadend(xhr);
    xhr.send();
    xhr.abort();
    await done;
    expect(records).toHaveLength(1);
    expect(records[0].entry.error).toBe('abort');
  });

  it('instance methods are non-enumerable (Object.keys(xhr) unchanged)', () => {
    restore();
    const plainKeys = Object.keys(new NativeXHR());
    restore = installXhrHook(makeCtx(window).ctx);
    const xhr = new XMLHttpRequest();
    expect(Object.keys(xhr)).toEqual(plainKeys);
    for (const m of ['open', 'send', 'setRequestHeader']) {
      expect(Object.getOwnPropertyDescriptor(xhr, m).enumerable).toBe(false);
      expect(xhr[m].name).toBe(m);
      expect(xhr[m].length).toBe(NativeXHR.prototype[m].length);
    }
  });

  it('page patch on XMLHttpRequest.prototype.open after install is still called', () => {
    const original = XMLHttpRequest.prototype.open;
    const calls = [];
    XMLHttpRequest.prototype.open = function (...args) {
      calls.push(args[1]);
      return original.apply(this, args);
    };
    try {
      new XMLHttpRequest().open('GET', 'data:text/plain,patched');
      expect(calls).toEqual(['data:text/plain,patched']);
    } finally {
      XMLHttpRequest.prototype.open = original;
    }
  });

  it('subclass of the hooked constructor keeps its own prototype chain', () => {
    class MyXHR extends XMLHttpRequest {}
    const x = new MyXHR();
    expect(x instanceof MyXHR).toBe(true);
    expect(x instanceof XMLHttpRequest).toBe(true);
  });

  it('enabled() false means plain pass-through without records', async () => {
    restore();
    const made = makeCtx(window, { enabled: () => false });
    records = made.records;
    restore = installXhrHook(made.ctx);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'data:text/plain,x');
    const done = waitLoadend(xhr);
    xhr.send();
    await done;
    expect(records).toHaveLength(0);
  });

  it('recorder exception inside hook never breaks the page call', async () => {
    restore();
    const made = makeCtx(window, {
      record: () => { throw new Error('boom'); },
      now: () => { throw new Error('clock'); },
    });
    restore = installXhrHook(made.ctx);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'data:text/plain,ok');
    xhr.setRequestHeader('A', 'b');
    const done = waitLoadend(xhr);
    xhr.send();
    await done;
    expect(xhr.status).toBe(200);
    expect(xhr.responseText).toBe('ok');
  });

  it('native argument validation errors still surface to the page', () => {
    const xhr = new XMLHttpRequest();
    expect(() => xhr.setRequestHeader('A', 'b')).toThrow(); // not opened
    expect(() => XMLHttpRequest()).toThrow(TypeError);
  });

  it('double install does not wrap twice nor duplicate records', async () => {
    const hooked = window.XMLHttpRequest;
    const restore2 = installXhrHook(makeCtx(window).ctx);
    expect(window.XMLHttpRequest).toBe(hooked);
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'data:text/plain,x');
    const done = waitLoadend(xhr);
    xhr.send();
    await done;
    expect(records).toHaveLength(1);
    restore2();
    expect(window.XMLHttpRequest).toBe(hooked);
  });

  it('after restore() existing instances pass through without records', async () => {
    const xhr = new XMLHttpRequest();
    restore();
    expect(window.XMLHttpRequest).toBe(NativeXHR);
    xhr.open('GET', 'data:text/plain,x');
    const done = waitLoadend(xhr);
    xhr.send();
    await done;
    expect(xhr.status).toBe(200);
    expect(records).toHaveLength(0);
  });

  it('limits header count, header length, url and body preview', async () => {
    const xhr = new XMLHttpRequest();
    const longUrl = 'data:text/plain,' + 'u'.repeat(NETWORK_LIMITS.urlChars + 50);
    xhr.open('POST', longUrl);
    for (let i = 0; i < NETWORK_LIMITS.headers + 20; i++) xhr.setRequestHeader('X-H' + i, 'v');
    xhr.setRequestHeader('X-H0', 'v'.repeat(NETWORK_LIMITS.headerChars + 10));
    const done = waitLoadend(xhr);
    xhr.send('b'.repeat(NETWORK_LIMITS.bodyChars + 100));
    await done;
    const e = records[0].entry;
    expect(Object.keys(e.requestHeaders)).toHaveLength(NETWORK_LIMITS.headers);
    expect(e.requestHeaders['X-H0'].length).toBeLessThan(NETWORK_LIMITS.headerChars + 40);
    expect(e.url.length).toBeLessThan(NETWORK_LIMITS.urlChars + 40);
    expect(e.requestBody.startsWith('b'.repeat(NETWORK_LIMITS.bodyChars))).toBe(true);
    expect(e.requestBody).toContain('[truncated 100 chars]');
  });
});

describe('fetch hook', () => {
  let win;
  let nativeFetch;
  let calls;

  beforeEach(() => {
    calls = [];
    nativeFetch = function fetch(input, init = undefined) {
      calls.push({ input, init, self: this });
      return Promise.resolve(new Response('body', {
        status: 201, statusText: 'Created', headers: { 'x-a': '1' },
      }));
    };
    win = { fetch: nativeFetch, document: { baseURI: BASE } };
  });

  it('fetch(string) records GET and absolute url, response fields and passes args through', async () => {
    const { ctx, records } = makeCtx(win);
    const restore = installFetchHook(ctx);
    const init = { headers: { 'X-Y': 'z' } };
    await win.fetch('api/data?q=1', init);
    expect(calls[0].input).toBe('api/data?q=1');
    expect(calls[0].init).toBe(init);
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe('network');
    expect(records[0].entry).toMatchObject({
      t: 10, type: 'fetch', method: 'GET', url: BASE + 'api/data?q=1',
      status: 201, statusText: 'Created', ok: true, redirected: false,
      durationMs: 10, requestHeaders: { 'X-Y': 'z' }, responseHeaders: { 'x-a': '1' },
      requestBody: null, error: null,
    });
    restore();
  });

  it("fetch(new Request(url,{method:'POST'})) records POST and absolute url", async () => {
    const { ctx, records } = makeCtx(win);
    installFetchHook(ctx);
    const req = new Request('http://other.test/submit', { method: 'post', headers: [['X-R', '1']] });
    await win.fetch(req);
    expect(calls[0].input).toBe(req);
    expect(records[0].entry).toMatchObject({ method: 'POST', url: 'http://other.test/submit', requestHeaders: { 'x-r': '1' } });
  });

  it('fetch(new URL(...)) records url; init.method wins and is upper-cased', async () => {
    const { ctx, records } = makeCtx(win);
    installFetchHook(ctx);
    await win.fetch(new URL('https://x.test/a'), { method: 'put', body: 'hello' });
    expect(records[0].entry).toMatchObject({ method: 'PUT', url: 'https://x.test/a', requestBody: 'hello' });
  });

  it('non-string body is previewed as its type tag', async () => {
    const { ctx, records } = makeCtx(win);
    installFetchHook(ctx);
    await win.fetch('/x', { method: 'POST', body: new FormData() });
    await win.fetch('/x', { method: 'POST', body: new Blob(['a']) });
    expect(records.map((r) => r.entry.requestBody)).toEqual(['[FormData]', '[Blob]']);
  });

  it('fetch returns the same response object and does not consume body (bodyUsed false)', async () => {
    const response = new Response('payload');
    win.fetch = function fetch() { return Promise.resolve(response); };
    const { ctx } = makeCtx(win);
    installFetchHook(ctx);
    const got = await win.fetch('/x');
    expect(got).toBe(response);
    expect(got.bodyUsed).toBe(false);
    expect(await got.text()).toBe('payload');
  });

  it('fetch rejection is rethrown unchanged and recorded with error', async () => {
    const err = new TypeError('Failed to fetch');
    win.fetch = function fetch() { return Promise.reject(err); };
    const { ctx, records } = makeCtx(win);
    installFetchHook(ctx);
    await expect(win.fetch('/x')).rejects.toBe(err);
    expect(records[0].entry).toMatchObject({
      type: 'fetch', url: BASE.replace('/app/', '/x'), status: null,
      error: { name: 'TypeError', message: 'Failed to fetch' },
    });
  });

  it('fetch.name/length unchanged and this is forwarded', async () => {
    installFetchHook(makeCtx(win).ctx);
    expect(win.fetch).not.toBe(nativeFetch);
    expect(win.fetch.name).toBe('fetch');
    expect(win.fetch.length).toBe(nativeFetch.length);
    await win.fetch('/x');
    expect(calls[0].self).toBe(win);
  });

  it('restore() puts back identical window.fetch', () => {
    const restore = installFetchHook(makeCtx(win).ctx);
    restore();
    expect(win.fetch).toBe(nativeFetch);
  });

  it('double install does not wrap twice nor duplicate records', async () => {
    const { ctx, records } = makeCtx(win);
    installFetchHook(ctx);
    const hooked = win.fetch;
    const restore2 = installFetchHook(ctx);
    expect(win.fetch).toBe(hooked);
    await win.fetch('/x');
    expect(records).toHaveLength(1);
    restore2();
    expect(win.fetch).toBe(hooked);
  });

  it('a hook kept by the page after restore() passes through without records', async () => {
    const { ctx, records } = makeCtx(win);
    const restore = installFetchHook(ctx);
    const kept = win.fetch;
    restore();
    await kept('/x');
    expect(calls).toHaveLength(1);
    expect(records).toHaveLength(0);
  });

  it('enabled() false means plain pass-through without records', async () => {
    const { ctx, records } = makeCtx(win, { enabled: () => false });
    installFetchHook(ctx);
    await win.fetch('/x');
    expect(records).toHaveLength(0);
  });

  it('recorder exception inside hook never breaks the page call', async () => {
    const { ctx } = makeCtx(win, {
      record: () => { throw new Error('boom'); },
      now: () => { throw new Error('clock'); },
      json: () => { throw new Error('json'); },
    });
    installFetchHook(ctx);
    const res = await win.fetch({ toString() { throw new Error('page'); } });
    expect(res.status).toBe(201);
    win.fetch = nativeFetch;
    const err = new Error('net');
    nativeFetch = function fetch() { return Promise.reject(err); };
    win.fetch = nativeFetch;
    installFetchHook(ctx);
    await expect(win.fetch('/x')).rejects.toBe(err);
  });

  it('limits request headers and body preview', async () => {
    const { ctx, records } = makeCtx(win);
    installFetchHook(ctx);
    const headers = {};
    for (let i = 0; i < NETWORK_LIMITS.headers + 5; i++) headers['h' + i] = 'v';
    await win.fetch('/x', { method: 'POST', headers, body: 'x'.repeat(NETWORK_LIMITS.bodyChars + 1) });
    const e = records[0].entry;
    expect(Object.keys(e.requestHeaders)).toHaveLength(NETWORK_LIMITS.headers);
    expect(e.requestBody).toContain('[truncated 1 chars]');
  });

  it('missing fetch is a no-op', () => {
    const empty = { document: { baseURI: BASE } };
    const restore = installFetchHook(makeCtx(empty).ctx);
    expect('fetch' in empty).toBe(false);
    restore();
  });
});
