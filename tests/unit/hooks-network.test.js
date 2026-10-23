// @vitest-environment jsdom
/* global window, XMLHttpRequest -- jsdom globals (vitest-environment jsdom) */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installFetchHook, installXhrHook, isTextual, NETWORK_LIMITS } from '../../src/page/hooks-network.js';

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

  // E2-F1: an opaque response (`mode: 'no-cors'`) reports status 0; the package never carries a bare 0 (AC-4.3).
  const withType = (type, status = 0) => () => {
    const r = new Response(null, { status: 200 });
    Object.defineProperty(r, 'type', { value: type });
    Object.defineProperty(r, 'status', { value: status });
    Object.defineProperty(r, 'ok', { value: false });
    return Promise.resolve(r);
  };

  it("opaque response (mode 'no-cors') → status null + statusUnavailable cross-origin, right after status", async () => {
    win.fetch = withType('opaque');
    const { ctx, records } = makeCtx(win);
    installFetchHook(ctx);
    await win.fetch('https://cdn.test/pixel', { mode: 'no-cors' });
    const e = records[0].entry;
    expect(e).toMatchObject({ status: null, statusUnavailable: 'cross-origin', ok: null, error: null });
    const keys = Object.keys(e);
    expect(keys[keys.indexOf('status') + 1]).toBe('statusUnavailable');
  });

  it('opaqueredirect or any other status 0 → status null + statusUnavailable unknown; never bare 0', async () => {
    const { ctx, records } = makeCtx(win);
    win.fetch = withType('opaqueredirect');
    installFetchHook(ctx);
    await win.fetch('/r', { redirect: 'manual' });
    win.fetch = withType('basic');
    installFetchHook(ctx);
    await win.fetch('/zero');
    expect(records.map((r) => [r.entry.status, r.entry.statusUnavailable])).toEqual([[null, 'unknown'], [null, 'unknown']]);
  });

  it('a normal response carries no statusUnavailable key', async () => {
    const { ctx, records } = makeCtx(win);
    installFetchHook(ctx);
    await win.fetch('/x');
    expect('statusUnavailable' in records[0].entry).toBe(false);
  });

  it('missing fetch is a no-op', () => {
    const empty = { document: { baseURI: BASE } };
    const restore = installFetchHook(makeCtx(empty).ctx);
    expect('fetch' in empty).toBe(false);
    restore();
  });
});

// E2-T4b: preview of error response bodies (D3, AC-4.5–4.7). The read is asynchronous and reported through
// `ctx.attach(entry, fields, chars)`; timers are injected through intrinsics so the 2 s limit is driven by hand.

const flush = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function manualTimers() {
  const pending = new Map();
  let id = 0;
  return {
    setTimeout: (fn, ms) => { pending.set(++id, { fn, ms }); return id; },
    clearTimeout: (key) => { pending.delete(key); },
    fire() {
      const all = [...pending.values()];
      pending.clear();
      for (const { fn } of all) fn();
    },
    get size() { return pending.size; },
  };
}

function bodyCtx(win, overrides = {}) {
  const attached = [];
  const timers = manualTimers();
  const made = makeCtx(win, {
    attach: (entry, fields, chars) => attached.push({ entry, fields, chars }),
    intrinsics: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout },
    ...overrides,
  });
  return { ...made, attached, timers };
}

describe('isTextual (D3)', () => {
  it.each([
    ['application/json', true], ['application/json; charset=utf-8', true], ['text/plain', true], ['text/html;charset=x', true],
    ['application/problem+json', true], ['application/xml', true], ['application/atom+xml', true], ['TEXT/XML', true],
    ['application/x-www-form-urlencoded', true], ['image/png', false], ['application/octet-stream', false],
    ['application/pdf', false], ['', false], [null, false], [undefined, false],
  ])('%s → %s', (ct, expected) => {
    expect(isTextual(ct)).toBe(expected);
  });
});

describe('fetch hook: error response body preview', () => {
  let win;
  let next;
  beforeEach(() => {
    next = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    win = { fetch: function fetch() { return Promise.resolve(next()); }, document: { baseURI: BASE } };
  });

  it('new fetch records carry sizeBytes: null right after durationMs', async () => {
    const { ctx, records } = bodyCtx(win);
    installFetchHook(ctx);
    await win.fetch('/x');
    const keys = Object.keys(records[0].entry);
    expect(records[0].entry.sizeBytes).toBeNull();
    expect(keys[keys.indexOf('durationMs') + 1]).toBe('sizeBytes');
  });

  it('fetch 500 application/json → preview ≤ 4096 with truncated flag (AC-4.5)', async () => {
    const { ctx, records, attached } = bodyCtx(win);
    installFetchHook(ctx);
    next = () => new Response('{"error":"boom"}', { status: 500, headers: { 'content-type': 'application/json' } });
    await win.fetch('/api/fail');
    await flush();
    expect(attached).toHaveLength(1);
    expect(attached[0].entry).toBe(records[0].entry);
    expect(attached[0].fields).toEqual({ responseBodyPreview: '{"error":"boom"}', responseBodyTruncated: false });
    expect(attached[0].chars).toBe(16);

    const long = 'a '.repeat(3000); // 6000 chars, cut at 4096 on a word boundary
    next = () => new Response(long, { status: 503, headers: { 'content-type': 'text/plain' } });
    await win.fetch('/api/long');
    await flush();
    expect(attached).toHaveLength(2);
    const { fields } = attached[1];
    expect(fields.responseBodyTruncated).toBe(true);
    expect(fields.responseBodyPreview.length).toBeLessThanOrEqual(NETWORK_LIMITS.responseBodyChars);
    expect(fields.responseBodyPreview.length).toBeGreaterThan(4000);
  });

  it('200 JSON → no field; 500 image/png → no field; opaque → no field; no body → no field (AC-4.5)', async () => {
    const { ctx, attached } = bodyCtx(win);
    installFetchHook(ctx);
    await win.fetch('/ok');
    next = () => new Response('PNG', { status: 500, headers: { 'content-type': 'image/png' } });
    await win.fetch('/img');
    next = () => {
      const r = new Response('{"a":1}', { status: 500, headers: { 'content-type': 'application/json' } });
      Object.defineProperty(r, 'type', { value: 'opaque' });
      return r;
    };
    await win.fetch('/opaque');
    next = () => new Response(null, { status: 404, headers: { 'content-type': 'text/plain' } });
    await win.fetch('/empty');
    next = () => new Response(new Uint8Array([120]), { status: 500 }); // no content-type at all
    await win.fetch('/untyped');
    await flush();
    expect(attached).toHaveLength(0);
  });

  it('after fetch 500 page can await r.json(); bodyUsed false before page read (AC-4.6)', async () => {
    const { ctx, attached } = bodyCtx(win);
    installFetchHook(ctx);
    next = () => new Response('{"error":"expired"}', { status: 500, headers: { 'content-type': 'application/json' } });
    const r = await win.fetch('/api/fail');
    expect(r.bodyUsed).toBe(false);
    expect(await r.json()).toEqual({ error: 'expired' });
    await flush();
    expect(attached).toHaveLength(1);
  });

  it('page reading immediately and our read run side by side without errors', async () => {
    const { ctx, attached } = bodyCtx(win);
    installFetchHook(ctx);
    next = () => new Response('plain error text', { status: 400, headers: { 'content-type': 'text/plain' } });
    const text = await win.fetch('/x').then((r) => r.text());
    expect(text).toBe('plain error text');
    await flush();
    expect(attached[0].fields.responseBodyPreview).toBe('plain error text');
  });

  it('endless 500 stream → reader cancelled after 2 s, no field, page branch still readable (AC-4.5)', async () => {
    const { ctx, attached, timers } = bodyCtx(win);
    installFetchHook(ctx);
    let cancelled = false;
    const enc = new TextEncoder();
    let pulls = 0;
    next = () => new Response(new ReadableStream({
      pull(controller) {
        if (pulls++ < 3) controller.enqueue(enc.encode('chunk '));
        // then never enqueue again and never close: endless stream
        return new Promise(() => {});
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }), { status: 500, headers: { 'content-type': 'text/plain' } });
    const r = await win.fetch('/stream');
    await flush();
    expect(timers.size).toBe(1);
    timers.fire();
    await flush();
    expect(attached).toHaveLength(0);
    // our branch is cancelled; the page branch still delivers data
    const reader = r.body.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('chunk');
    await reader.cancel();
    await flush();
    expect(cancelled).toBe(true);
  });

  it('reads at most 8192 chars, then cancels and reports truncated', async () => {
    const { ctx, attached } = bodyCtx(win);
    installFetchHook(ctx);
    let cancelled = false;
    let pulls = 0;
    const enc = new TextEncoder();
    next = () => new Response(new ReadableStream({
      pull(controller) {
        pulls++;
        controller.enqueue(enc.encode('word '.repeat(500))); // 2500 chars per chunk, never closes
      },
      cancel() { cancelled = true; },
    }), { status: 500, headers: { 'content-type': 'text/plain' } });
    const r = await win.fetch('/big');
    await flush();
    expect(attached).toHaveLength(1);
    expect(attached[0].fields.responseBodyTruncated).toBe(true);
    expect(attached[0].fields.responseBodyPreview.length).toBeLessThanOrEqual(NETWORK_LIMITS.responseBodyChars);
    expect(pulls).toBeLessThan(10);
    // the page branch is independent of our cancel
    const reader = r.body.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    await flush();
    expect(cancelled).toBe(true);
  });

  it('token in body masked before cut; no partial token at cut (AC-4.7)', async () => {
    const { ctx, attached } = bodyCtx(win);
    installFetchHook(ctx);
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    next = () => new Response(JSON.stringify({ error: 'expired', access_token: jwt, note: 'Bearer abcdefghijklmnopqrstuvwxyz012345' }),
      { status: 401, headers: { 'content-type': 'application/json' } });
    await win.fetch('/api/auth');
    // a token that straddles the 4096 cut must not leave a fragment
    const secret = 'Z'.repeat(200);
    next = () => new Response('x'.repeat(4000) + ' ' + secret, { status: 500, headers: { 'content-type': 'text/plain' } });
    await win.fetch('/api/cut');
    await flush();
    const [auth, cut] = attached.map((a) => a.fields);
    expect(auth.responseBodyPreview).not.toContain(jwt);
    expect(auth.responseBodyPreview).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
    expect(JSON.parse(auth.responseBodyPreview)).toMatchObject({ error: 'expired', access_token: '[redacted:key-token]' });
    expect(auth.responseBodyPreview).toContain('[redacted:bearer]');
    expect(cut.responseBodyTruncated).toBe(true);
    expect(cut.responseBodyPreview).not.toContain('Z');
  });

  it('no attach in ctx → body never cloned', async () => {
    const { ctx } = makeCtx(win);
    installFetchHook(ctx);
    let cloned = 0;
    next = () => {
      const r = new Response('{"e":1}', { status: 500, headers: { 'content-type': 'application/json' } });
      const clone = r.clone.bind(r);
      r.clone = () => { cloned++; return clone(); };
      return r;
    };
    await win.fetch('/x');
    await flush();
    expect(cloned).toBe(0);
  });

  it('ctx.canAttach() false → error body never cloned nor read (L2)', async () => {
    const { ctx, attached } = bodyCtx(win, { canAttach: () => false });
    installFetchHook(ctx);
    let cloned = 0;
    next = () => {
      const r = new Response('{"e":1}', { status: 500, headers: { 'content-type': 'application/json' } });
      const clone = r.clone.bind(r);
      r.clone = () => { cloned++; return clone(); };
      return r;
    };
    await win.fetch('/x');
    await flush();
    expect(cloned).toBe(0);
    expect(attached).toHaveLength(0);
  });

  it('after restore() a pending read does not attach', async () => {
    const { ctx, attached } = bodyCtx(win);
    const restore = installFetchHook(ctx);
    next = () => new Response('{"e":1}', { status: 500, headers: { 'content-type': 'application/json' } });
    const p = win.fetch('/x');
    restore();
    await p;
    await flush();
    expect(attached).toHaveLength(0);
  });

  it('attach/read failures are swallowed and never surface as unhandled rejections', async () => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const { ctx } = bodyCtx(win, { attach: () => { throw new Error('attach boom'); } });
      installFetchHook(ctx);
      next = () => new Response('{"e":1}', { status: 500, headers: { 'content-type': 'application/json' } });
      const r = await win.fetch('/x');
      expect(r.status).toBe(500);
      next = () => new Response(new ReadableStream({ pull() { throw new Error('stream boom'); } }),
        { status: 500, headers: { 'content-type': 'text/plain' } });
      await win.fetch('/y');
      await flush();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('fetch hook synchronous path unchanged (same promise result, same exceptions) (regression AC-5.2 E1)', async () => {
    const { ctx } = bodyCtx(win);
    installFetchHook(ctx);
    const response = new Response('{"e":1}', { status: 500, headers: { 'content-type': 'application/json' } });
    next = () => response;
    expect(await win.fetch('/x')).toBe(response);
    const err = new TypeError('bad');
    win.fetch = new Proxy(win.fetch, {}); // keep hooked
    const sync = { fetch() { throw err; }, document: { baseURI: BASE } };
    installFetchHook(bodyCtx(sync).ctx);
    expect(() => sync.fetch('/x')).toThrow(err);
  });
});

describe('XMLHttpRequest hook: error response body preview', () => {
  // Minimal native-like XHR: async loadend with a configurable response.
  function makeFakeXhr(respond) {
    const access = { responseText: 0 };
    class FakeXHR extends EventTarget {
      constructor() {
        super();
        this.readyState = 0;
        this.status = 0;
        this.statusText = '';
        this.responseType = '';
        this.responseURL = '';
        this._headers = '';
        this._text = '';
        this._response = null;
      }
      open(method, url) { this._url = url; this.readyState = 1; }
      setRequestHeader() {}
      send() {
        setTimeout(() => {
          const r = respond(this);
          this.status = r.status;
          this.statusText = r.statusText || '';
          this._headers = r.headers || '';
          this._text = r.text ?? '';
          this._response = r.response;
          this.readyState = 4;
          this.dispatchEvent(new Event('loadend'));
        }, 0);
      }
      get responseText() {
        access.responseText++;
        if (this.responseType !== '' && this.responseType !== 'text') throw new Error('InvalidStateError');
        return this._text;
      }
      get response() {
        if (this.responseType === '' || this.responseType === 'text') return this._text;
        return this._response;
      }
      getAllResponseHeaders() { return this._headers; }
    }
    FakeXHR.DONE = 4;
    return { FakeXHR, access };
  }

  function run(win, setup) {
    const xhr = new win.XMLHttpRequest();
    setup(xhr);
    const done = new Promise((resolve) => xhr.addEventListener('loadend', resolve));
    xhr.open('GET', '/api/x');
    xhr.send();
    return done.then(() => xhr);
  }

  it('XHR 401 text → preview; new records carry sizeBytes: null (AC-4.5)', async () => {
    const { FakeXHR } = makeFakeXhr(() => ({ status: 401, headers: 'Content-Type: text/plain\r\n', text: 'unauthorized' }));
    const win = { XMLHttpRequest: FakeXHR, document: { baseURI: BASE } };
    const { ctx, records, attached } = bodyCtx(win);
    installXhrHook(ctx);
    await run(win, () => {});
    expect(records[0].entry).toMatchObject({ type: 'xhr', status: 401, sizeBytes: null });
    expect(attached).toHaveLength(1);
    expect(attached[0].entry).toBe(records[0].entry);
    expect(attached[0].fields).toEqual({ responseBodyPreview: 'unauthorized', responseBodyTruncated: false });
  });

  it("XHR responseType 'json' 500 → JSON text preview, masked", async () => {
    const { FakeXHR } = makeFakeXhr(() => ({
      status: 500, headers: 'content-type: application/json\r\n', response: { error: 'x', password: 'hunter2hunter2' },
    }));
    const win = { XMLHttpRequest: FakeXHR, document: { baseURI: BASE } };
    const { ctx, attached } = bodyCtx(win);
    installXhrHook(ctx);
    await run(win, (xhr) => { xhr.responseType = 'json'; });
    expect(JSON.parse(attached[0].fields.responseBodyPreview)).toEqual({ error: 'x', password: '[redacted:key-password]' });
  });

  it('XHR responseType blob/arraybuffer untouched (response identical) (AC-4.6)', async () => {
    const blob = new Blob(['{"a":1}']);
    const buf = new ArrayBuffer(4);
    let next = blob;
    const { FakeXHR, access } = makeFakeXhr(() => ({ status: 500, headers: 'content-type: application/json\r\n', response: next }));
    const win = { XMLHttpRequest: FakeXHR, document: { baseURI: BASE } };
    const { ctx, attached } = bodyCtx(win);
    installXhrHook(ctx);
    const a = await run(win, (xhr) => { xhr.responseType = 'blob'; });
    expect(a.response).toBe(blob);
    next = buf;
    const b = await run(win, (xhr) => { xhr.responseType = 'arraybuffer'; });
    expect(b.response).toBe(buf);
    expect(attached).toHaveLength(0);
    expect(access.responseText).toBe(0);
  });

  it('XHR 200 or binary content-type → no field', async () => {
    let next = { status: 200, headers: 'content-type: text/plain\r\n', text: 'ok' };
    const { FakeXHR } = makeFakeXhr(() => next);
    const win = { XMLHttpRequest: FakeXHR, document: { baseURI: BASE } };
    const { ctx, attached } = bodyCtx(win);
    installXhrHook(ctx);
    await run(win, () => {});
    next = { status: 500, headers: 'content-type: image/png\r\n', text: 'PNG' };
    await run(win, () => {});
    expect(attached).toHaveLength(0);
  });

  it('XHR long text: read limit 8192, preview ≤ 4096, truncated', async () => {
    const { FakeXHR } = makeFakeXhr(() => ({ status: 500, headers: 'content-type: text/html\r\n', text: 'ab '.repeat(10000) }));
    const win = { XMLHttpRequest: FakeXHR, document: { baseURI: BASE } };
    const { ctx, attached } = bodyCtx(win);
    installXhrHook(ctx);
    await run(win, () => {});
    expect(attached[0].fields.responseBodyTruncated).toBe(true);
    expect(attached[0].fields.responseBodyPreview.length).toBeLessThanOrEqual(NETWORK_LIMITS.responseBodyChars);
    expect(attached[0].chars).toBe(attached[0].fields.responseBodyPreview.length);
  });

  // E2-F1: status 0 without an error/abort/timeout event has no explanation → null + unknown (AC-4.3).
  it('XHR status 0 without error event → status null + statusUnavailable unknown, right after status', async () => {
    const { FakeXHR } = makeFakeXhr(() => ({ status: 0 }));
    const win = { XMLHttpRequest: FakeXHR, document: { baseURI: BASE } };
    const { ctx, records } = bodyCtx(win);
    installXhrHook(ctx);
    await run(win, () => {});
    const e = records[0].entry;
    expect(e).toMatchObject({ type: 'xhr', status: null, statusUnavailable: 'unknown', ok: null, error: null });
    const keys = Object.keys(e);
    expect(keys[keys.indexOf('status') + 1]).toBe('statusUnavailable');
  });

  it('XHR status 0 with an error event keeps the error as the explanation; 200 has no statusUnavailable', async () => {
    let next = { status: 0 };
    const { FakeXHR } = makeFakeXhr(() => next);
    const win = { XMLHttpRequest: FakeXHR, document: { baseURI: BASE } };
    const { ctx, records } = bodyCtx(win);
    installXhrHook(ctx);
    await run(win, (xhr) => { setTimeout(() => xhr.dispatchEvent(new Event('error')), 0); });
    next = { status: 200, headers: 'content-type: text/plain\r\n', text: 'ok' };
    await run(win, () => {});
    expect(records[0].entry).toMatchObject({ status: 0, error: 'error' });
    expect('statusUnavailable' in records[0].entry).toBe(false);
    expect('statusUnavailable' in records[1].entry).toBe(false);
  });
});
