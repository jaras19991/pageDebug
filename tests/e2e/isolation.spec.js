// E1-T19c: isolation and robustness against the page (US-5). The recorder must not change how
// the page behaves (AC-5.1), must leave no trace after saving (AC-5.3), keep no data in page
// globals (AC-5.4), install once per document (AC-5.5) and keep its channel private from a
// hostile page (AC-5.6, design D3). Plus the E0 AC-2.4 regression: a strict-CSP page is recorded.
/* global window, document, XMLHttpRequest */
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { DIST_CHROME, launchWithExtension } from './helpers/launch.js';
import { saveRecording, startRecording } from './helpers/recording.js';

const FILE_NAME_RE = /^snapshot-[a-z0-9.-]+-\d{8}-\d{6}( \(\d+\))?\.zip$/;
// Bridge nonce format (src/page/isolated-entry.js: 16 random bytes as hex).
const NONCE_RE = /[0-9a-f]{32}/;
// Forged payload token of hostile.html (assembled at runtime there, so not in its source).
const FORGED = 'forged-payload-x7';

let server;
let ext;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  server = await startFixtureServer({ port: 0 });
  ext = await launchWithExtension();
});

test.afterAll(async () => {
  await ext?.close();
  await server?.close();
});

async function withPage(fn) {
  const page = await ext.context.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

const marker = (name) => `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Console entries of the package whose args mention `text`. */
function consoleEntriesWith(pkg, text) {
  return (pkg.consoleLogs ?? []).filter((e) => JSON.stringify(e.args ?? e).includes(text));
}

// Source text of the page's current globals, as the page sees them.
const NATIVE_TEXTS = () => {
  const src = (fn) => Function.prototype.toString.call(fn);
  return {
    fetch: src(window.fetch),
    xhr: src(window.XMLHttpRequest),
    console: Object.fromEntries(['log', 'info', 'warn', 'error', 'debug'].map((l) => [l, src(console[l])])),
  };
};

test('axios-like XHR client works and is recorded; instanceof and DONE intact', async () => {
  await withPage(async (page) => {
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);

    const result = await page.evaluate(async () => {
      const XHR = window.XMLHttpRequest;
      const probe = new XHR();
      const facts = {
        instanceOf: probe instanceof XMLHttpRequest,
        protoIsNative: Object.getPrototypeOf(probe) === XMLHttpRequest.prototype,
        constants: [XHR.UNSENT, XHR.OPENED, XHR.HEADERS_RECEIVED, XHR.LOADING, XHR.DONE],
        instanceDone: probe.DONE,
        name: XHR.name,
        protoOpen: Function.prototype.toString.call(XMLHttpRequest.prototype.open),
        protoSend: Function.prototype.toString.call(XMLHttpRequest.prototype.send),
        fetchText: Function.prototype.toString.call(window.fetch),
      };
      // Mini client in the style of axios' XHR adapter.
      const response = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const states = [];
        xhr.open('GET', '/api/fail?axios=1', true);
        xhr.withCredentials = true;
        xhr.responseType = 'json';
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.onreadystatechange = () => {
          states.push(xhr.readyState);
          if (xhr.readyState !== XMLHttpRequest.DONE) return;
          resolve({
            states,
            status: xhr.status,
            data: xhr.response,
            withCredentials: xhr.withCredentials,
            responseType: xhr.responseType,
            headers: xhr.getAllResponseHeaders(),
          });
        };
        xhr.onerror = () => reject(new Error('xhr error'));
        xhr.send();
      });
      return { facts, response };
    });

    expect(result.facts).toMatchObject({
      instanceOf: true,
      protoIsNative: true,
      constants: [0, 1, 2, 3, 4],
      instanceDone: 4,
      name: 'XMLHttpRequest',
    });
    expect(result.facts.protoOpen).toContain('[native code]');
    expect(result.facts.protoSend).toContain('[native code]');
    // Proxy over fetch (D5): only "[native code]" is promised, not the name.
    expect(result.facts.fetchText).toContain('[native code]');
    test.info().annotations.push({ type: 'fetch.toString() while recording', description: result.facts.fetchText });

    expect(result.response).toMatchObject({
      status: 500,
      data: { error: 'forced failure' },
      withCredentials: true,
      responseType: 'json',
    });
    expect(result.response.states.at(-1)).toBe(4);
    expect(result.response.headers).toContain('application/json');

    const { fileName, json } = await saveRecording(page);
    expect(fileName).toMatch(FILE_NAME_RE);
    const entry = json.network.find((n) => n.type === 'xhr' && String(n.url).includes('/api/fail?axios=1'));
    expect(entry).toMatchObject({ method: 'GET', status: 500, ok: false, error: null });
  });
});

test('after save fetch/XHR/console differ from recording-time wrappers and console.log is native', async () => {
  await withPage(async (page) => {
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);
    const during = await page.evaluate(NATIVE_TEXTS);
    // The console hook is a plain wrapper, so its source is visible while recording.
    expect(during.console.log).not.toContain('[native code]');

    await saveRecording(page);
    // destroy reaches the page after "Zapisano"; poll until the console is native again.
    await expect.poll(() => page.evaluate(() => Function.prototype.toString.call(console.log)), { timeout: 5_000 })
      .toBe('function log() { [native code] }');
    const after = await page.evaluate(NATIVE_TEXTS);

    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
      expect(after.console[level]).toBe(`function ${level}() { [native code] }`);
      expect(after.console[level]).not.toBe(during.console[level]);
    }
    expect(after.fetch).toBe('function fetch() { [native code] }');
    expect(after.xhr).toBe('function XMLHttpRequest() { [native code] }');
    // Proxies hide the name, so the recording-time globals were different objects.
    expect(during.fetch).not.toBe(after.fetch);
    expect(during.xhr).not.toBe(after.xhr);
    test.info().annotations.push({ type: 'during recording', description: JSON.stringify({ fetch: during.fetch, xhr: during.xhr }) });
  });
});

test('no own window property (strings and symbols) holds the console marker during and after; no __PAGE_DEBUG_SNAPSHOT__', async () => {
  // Every own window property whose value mentions `needle`, plus the key lists.
  const scanWindow = (needle) => {
    const holds = (value) => {
      try {
        if (typeof value === 'string') return value.includes(needle);
        if (value === null || typeof value !== 'object') return false;
        const text = JSON.stringify(value);
        return typeof text === 'string' && text.includes(needle);
      } catch {
        return false; // cyclic or throwing getters: not a data store
      }
    };
    const names = Object.getOwnPropertyNames(window);
    const symbols = Object.getOwnPropertySymbols(window);
    const hits = [];
    for (const key of names) {
      let value;
      try { value = window[key]; } catch { continue; }
      if (holds(value)) hits.push(key);
    }
    for (const sym of symbols) {
      if (holds(window[sym])) hits.push(String(sym));
    }
    return {
      names,
      symbols: symbols.map((s) => String(s)),
      markerIsGlobalSymbol: symbols.some((s) => s === Symbol.for('pds.installed')),
      hits,
      legacy: '__PAGE_DEBUG_SNAPSHOT__' in window,
      api: 'PageDebugSnapshot' in window,
      chromeRuntime: typeof globalThis.chrome?.runtime?.sendMessage,
      chromeStorage: typeof globalThis.chrome?.storage,
    };
  };

  // Baseline: the same page on another origin (localhost) that the extension cannot touch.
  const baseline = await withPage(async (page) => {
    await page.goto(`http://localhost:${server.port}/basic.html`);
    return page.evaluate(scanWindow, 'nothing-logged-here');
  });
  expect(baseline.symbols).toEqual([]);

  await withPage(async (page) => {
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);
    const text = marker('global-marker');
    await page.evaluate((m) => console.log(m, { nested: m }), text);

    const check = (scan) => {
      expect(scan.hits).toEqual([]);
      expect(scan.legacy).toBe(false);
      expect(scan.api).toBe(false);
      // MAIN world has no extension API: the page cannot reach runtime or storage.
      expect(scan.chromeRuntime).toBe('undefined');
      expect(scan.chromeStorage).toBe('undefined');
      // No new string keys; the only new symbol is the data-free install marker.
      expect(scan.names.filter((n) => !baseline.names.includes(n))).toEqual([]);
      expect(scan.symbols).toEqual(['Symbol(pds.installed)']);
      expect(scan.markerIsGlobalSymbol).toBe(true);
    };

    check(await page.evaluate(scanWindow, text));
    const marked = await page.evaluate(() => {
      const value = window[Symbol.for('pds.installed')];
      const desc = Object.getOwnPropertyDescriptor(window, Symbol.for('pds.installed'));
      return { keys: Object.keys(value), frozen: Object.isFrozen(value), enumerable: desc.enumerable };
    });
    expect(marked).toEqual({ keys: ['version'], frozen: true, enumerable: false });

    const { json } = await saveRecording(page);
    expect(consoleEntriesWith(json, text)).toHaveLength(1);
    check(await page.evaluate(scanWindow, text));
  });
});

test('second injection of main-world.js (addScriptTag) does not duplicate entries', async () => {
  await withPage(async (page) => {
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);
    await page.addScriptTag({ path: join(DIST_CHROME, 'content', 'main-world.js') });
    const text = marker('double-install');
    await page.evaluate((m) => console.log(m), text);

    const { json } = await saveRecording(page);
    expect(consoleEntriesWith(json, text)).toHaveLength(1);
  });
});

test('hostile page: __heard is empty, success file name matches our pattern, package contains real marker and not forged data', async () => {
  await withPage(async (page) => {
    await page.goto(`${server.url}/hostile.html`);
    await startRecording(page);

    // Content scripts at document_start ran before the page's first inline script.
    expect(await page.evaluate(() => window.__markerBeforePage)).toBe(true);

    const before = marker('hostile-before');
    const after = marker('hostile-after');
    await page.evaluate((m) => console.log(m), before);
    // Forge again while recording: fake handshake, fake result/destroy, window messages.
    await page.evaluate(() => window.__forge());
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
    // A forged destroy must not have stopped the recorder.
    await page.evaluate((m) => console.log(m), after);

    const { fileName, json, statusText } = await saveRecording(page);
    expect(fileName).toMatch(FILE_NAME_RE);
    expect(statusText).not.toContain(FORGED);
    expect(consoleEntriesWith(json, before)).toHaveLength(1);
    expect(consoleEntriesWith(json, after)).toHaveLength(1);
    expect(JSON.stringify(json)).not.toContain(FORGED);
    expect(json.source).toBe('extension');

    // destroy travels over the channel too; give it a moment before reading what the page saw.
    await expect.poll(() => page.evaluate(() => Function.prototype.toString.call(console.log)), { timeout: 5_000 })
      .toBe('function log() { [native code] }');
    const heard = await page.evaluate(() => ({
      seen: window.__seen,
      intercepted: window.__intercepted,
      fakeDownloadCalls: window.__fakeDownloadCalls ?? 0,
      api: window.PageDebugSnapshot,
      jsonCalls: window.__jsonCalls,
    }));
    expect(heard.seen).toEqual([]);
    expect(heard.intercepted).toEqual([]);
    expect(heard.fakeDownloadCalls).toBe(0);
    expect(heard.api).toEqual({ fake: true });
    expect(JSON.stringify(heard.seen) + JSON.stringify(heard.intercepted)).not.toMatch(NONCE_RE);
    test.info().annotations.push({ type: 'page JSON calls (not channel)', description: String(heard.jsonCalls) });

    // Control: the wiretap does hear channel-shaped traffic that does not come from the page itself.
    const control = await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('pds:m2i', { detail: 'probe' }));
      return { seen: window.__seen.length, apis: window.__intercepted.map((e) => e.api) };
    });
    // Heard twice: window and document capture listeners.
    expect(control).toEqual({ seen: 2, apis: ['dispatchEvent'] });
  });
});

test('csp-strict page is recorded', async () => {
  await withPage(async (page) => {
    await page.goto(`${server.url}/csp-strict.html`);
    await startRecording(page);
    expect(await page.evaluate(() => window.__cspScriptRan)).toBe(true);
    const text = marker('csp-marker');
    await page.evaluate((m) => console.log(m), text);

    const { fileName, json } = await saveRecording(page);
    expect(fileName).toMatch(FILE_NAME_RE);
    expect(json.schemaVersion).toBe(4);
    expect(consoleEntriesWith(json, 'csp-strict fixture loaded')).toHaveLength(1);
    expect(consoleEntriesWith(json, text)).toHaveLength(1);
  });
});
