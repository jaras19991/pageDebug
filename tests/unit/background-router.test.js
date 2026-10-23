// background.js (E1-T1c): top-level wiring, the D2 sender check and the popup ↔ background
// flow from popup-background-integration.test.js, this time through the real router.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeChrome } from './helpers/fake-chrome.js';
import { createStore, KEYS } from '../../src/lib/session-store.js';
import { createController } from '../../src/popup/controller.js';
import { MESSAGES } from '../../src/popup/messages.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const TAB = 7;
const PAGE_URL = 'https://shop.example.com/cart';
const PATTERN = 'https://shop.example.com/*';
const EXTENSION_ID = 'pds-test-id';
const POPUP_SENDER = { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/popup/popup.html` };
const BRIDGE_SENDER = { id: EXTENSION_ID, tab: { id: TAB, url: PAGE_URL }, frameId: 0, url: PAGE_URL };

// background.js reads the global `chrome` at import time; each import gets a fresh fake.
async function importBackground(fakeChrome) {
  vi.resetModules();
  globalThis.chrome = fakeChrome;
  try {
    return await import('../../src/background.js');
  } finally {
    delete globalThis.chrome;
  }
}

let bg;
beforeAll(async () => {
  bg = await importBackground(createFakeChrome({ extensionId: EXTENSION_ID }).chrome);
});

describe('background.js entry point', () => {
  it('importing background.js registers all listeners synchronously', async () => {
    const { chrome } = createFakeChrome({ extensionId: EXTENSION_ID });
    const events = {
      'runtime.onMessage': chrome.runtime.onMessage,
      'permissions.onAdded': chrome.permissions.onAdded,
      'downloads.onChanged': chrome.downloads.onChanged,
      'tabs.onRemoved': chrome.tabs.onRemoved,
      'runtime.onStartup': chrome.runtime.onStartup,
      'runtime.onInstalled': chrome.runtime.onInstalled,
    };
    const added = [];
    for (const [name, event] of Object.entries(events)) {
      const original = event.addListener;
      event.addListener = (fn) => {
        added.push(name);
        return original(fn);
      };
    }
    await importBackground(chrome);
    expect(added.sort()).toEqual(Object.keys(events).sort());
  });

  it('background.js and src/lib use no importScripts, window, document, URL.createObjectURL, localStorage, indexedDB, storage.local', async () => {
    const files = ['background.js', ...(await readdir(join(ROOT, 'src/lib'))).map((f) => `lib/${f}`), 'popup/target.js'];
    const forbidden = [
      /\bimportScripts\b/,
      /\b(?:window|document)\s*[.[]/,
      /\bcreateObjectURL\b/,
      /\blocalStorage\b/,
      /\bindexedDB\b/,
      /\bstorage\s*\.\s*local\b/,
    ];
    for (const file of files.filter((f) => f.endsWith('.js'))) {
      const code = (await readFile(join(ROOT, 'src', file), 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const re of forbidden) expect(code, `${file}: ${re}`).not.toMatch(re);
    }
  });

  it('onMessage answers accepted messages through sendResponse (return true) and ignores others without an answer', async () => {
    const { chrome } = createFakeChrome({ tabs: [{ id: TAB, url: PAGE_URL }], extensionId: EXTENSION_ID });
    let listener;
    const original = chrome.runtime.onMessage.addListener;
    chrome.runtime.onMessage.addListener = (fn) => {
      listener = fn;
      return original(fn);
    };
    await importBackground(chrome);

    const sendResponse = vi.fn();
    expect(listener({ type: 'getStatus', tabId: TAB, url: PAGE_URL }, POPUP_SENDER, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
    expect(sendResponse.mock.calls[0][0]).toMatchObject({ state: 'idle', isRecordingTab: false });

    const ignored = vi.fn();
    expect(listener({ type: 'getStatus', tabId: TAB }, BRIDGE_SENDER, ignored)).toBe(false);
    expect(listener({ type: 'hello' }, POPUP_SENDER, ignored)).toBe(false);
    expect(listener({ type: 'nope' }, POPUP_SENDER, ignored)).toBe(false);
    expect(listener({ type: 'getStatus' }, { ...POPUP_SENDER, id: 'other-extension' }, ignored)).toBe(false);
    await new Promise((r) => setImmediate(r));
    expect(ignored).not.toHaveBeenCalled();
  });
});

describe('router sender check (D2)', () => {
  const chrome = createFakeChrome({ extensionId: EXTENSION_ID }).chrome;
  const accepts = (message, sender) => bg.acceptsMessage(chrome, message, sender);

  it('router rejects popup commands from content scripts and bridge commands from extension pages', () => {
    for (const type of ['getStatus', 'armStart', 'start', 'disarm', 'collect', 'saveStarted', 'saveFailed']) {
      expect(accepts({ type }, POPUP_SENDER), type).toBe(true);
      expect(accepts({ type }, BRIDGE_SENDER), type).toBe(false);
      // Another extension page (not the popup) and another extension.
      expect(accepts({ type }, { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/other.html` }), type).toBe(false);
      expect(accepts({ type }, { ...POPUP_SENDER, id: 'evil' }), type).toBe(false);
    }
    for (const type of ['hello', 'flush', 'stopped', 'bridgeError']) {
      expect(accepts({ type }, BRIDGE_SENDER), type).toBe(true);
      expect(accepts({ type }, POPUP_SENDER), type).toBe(false);
      // flush: a document left for another site sends it from a frame pending deletion (F-2); its token decides.
      expect(accepts({ type }, { ...BRIDGE_SENDER, frameId: 3 }), type).toBe(type === 'flush');
      expect(accepts({ type }, { ...BRIDGE_SENDER, id: 'evil' }), type).toBe(false);
    }
    expect(accepts({ type: 'flush' }, { ...BRIDGE_SENDER, tab: undefined })).toBe(false);
    expect(accepts({ type: 'toString' }, POPUP_SENDER)).toBe(false);
    expect(accepts(null, POPUP_SENDER)).toBe(false);
    expect(accepts({ type: 'getStatus' }, undefined)).toBe(false);
  });
});

// What MAIN answers to `collect` through the bridge (T15): a JSON string.
function pageResult(docId, logs) {
  return JSON.stringify({
    protocol: 1,
    recorderVersion: '0.3.0',
    docId,
    timeOrigin: T0 + 500,
    navigationType: 'reload',
    stopReason: null,
    environment: { location: { href: PAGE_URL } },
    dom: { title: 'Koszyk' },
    performance: {},
    storage: {},
    errors: [{ section: 'storage', error: 'SecurityError' }],
    consoleLogs: logs.map((text, i) => ({ t: 10 + i, level: 'error', args: [text] })),
    runtimeErrors: [],
    network: [],
    truncated: {},
  });
}

let env;

// Same wiring as background.js top level, with the fake chrome and the real router.
function setup({ granted = [] } = {}) {
  const { chrome, calls, fake } = createFakeChrome({ tabs: [{ id: TAB, url: PAGE_URL }], extensionId: EXTENSION_ID, granted });
  const inflight = new Set();
  const track = (promise) => {
    const p = Promise.resolve(promise);
    inflight.add(p);
    p.finally(() => inflight.delete(p)).catch(() => {});
    return p;
  };
  const store = createStore(chrome.storage.session);
  const handlers = bg.createHandlers({ chrome, store });
  const route = bg.createRouter({ chrome, store, handlers });
  chrome.permissions.onAdded.addListener((p) => track(handlers.recording.onPermissionAdded(p)));
  chrome.downloads.onChanged.addListener((d) => track(handlers.save.onDownloadChanged(d)));

  fake.runtimeSendMessage = (message) => track(Promise.resolve().then(() => route(JSON.parse(JSON.stringify(message)), POPUP_SENDER)));
  const fromPage = (message) => track(route(message, BRIDGE_SENDER));
  const page = { docId: null, logs: [] };
  fake.sendMessage = async (_tabId, message) => (message.type === 'collect' ? pageResult(page.docId, page.logs) : undefined);

  const blobs = [];
  const urlApi = {
    createObjectURL: vi.fn((blob) => {
      blobs.push(blob);
      return `blob:chrome-extension://${EXTENSION_ID}/${blobs.length}`;
    }),
    revokeObjectURL: vi.fn(),
  };
  const models = [];
  const openPopup = () =>
    createController({
      runtime: chrome.runtime,
      permissions: chrome.permissions,
      downloads: chrome.downloads,
      storage: chrome.storage,
      tabs: chrome.tabs,
      URL: urlApi,
      Blob,
      randomUUID: () => 'req-1',
      render: (model) => models.push(model),
      logError: vi.fn(),
    });
  async function settle() {
    for (let i = 0; i < 30; i++) {
      await Promise.allSettled([...inflight]);
      await new Promise((r) => setImmediate(r));
    }
  }
  env = { chrome, calls, fake, store, route, page, fromPage, blobs, models, openPopup, settle, last: () => models.at(-1) };
  return env;
}

const named = (name) => env.calls.filter((c) => c.name === name);

describe('popup ↔ background through the real router', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: T0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Nagrywaj → zgoda → start → hello → Zapisz → download complete → saved; collector errors named in notes', async () => {
    setup();
    const popup = env.openPopup();
    await popup.init();
    await popup.onRecord();
    await env.settle();
    const hello = await env.fromPage({ type: 'hello' });
    expect(hello).toEqual({ record: true, docId: 1, token: expect.stringMatching(/^[0-9a-f]{32}$/), deadline: T0 + 600_000, limitMs: 600_000 });
    env.page.docId = hello.docId;
    env.page.logs = ['Nie działa koszyk'];
    await env.settle();
    expect(env.last()).toMatchObject({ section: 'recording', buttons: { save: true } });
    expect(named('tabs.reload')).toHaveLength(1);

    await popup.onSave();
    await env.settle();
    const [download] = named('downloads.download');
    env.fake.completeDownload(1, `C:\\Users\\u\\Downloads\\${download.args[0].filename}`);
    await env.settle();
    const pkg = JSON.parse(await env.blobs.at(-1).text());
    expect(pkg.consoleLogs.map((l) => l.args[0])).toEqual(['Nie działa koszyk']);
    expect(pkg.notes).toContain('Section storage could not be collected (SecurityError).');
    expect(env.last()).toMatchObject({ section: 'ready', statusText: MESSAGES.saved(download.args[0].filename) });
    expect(await env.store.getRec()).toBeNull();
    expect(env.fake.registered.size).toBe(0);
    popup.destroy();
  });

  it('popup commands from a content script and bridge messages from the popup are dropped', async () => {
    setup();
    const popup = env.openPopup();
    await popup.init();
    await popup.onRecord();
    await env.settle();
    await env.fromPage({ type: 'hello' });
    expect(await env.fromPage({ type: 'collect', tabId: TAB })).toBeUndefined();
    expect(await env.fromPage({ type: 'disarm', requestId: 'req-1' })).toBeUndefined();
    expect(await env.chrome.runtime.sendMessage({ type: 'hello' })).toBeUndefined();
    expect(await env.chrome.runtime.sendMessage({ type: 'stopped', reason: 'time-limit' })).toBeUndefined();
    expect((await env.store.getRec()).status).toBe('recording');
    popup.destroy();
  });

  it('popup closed between armStart and start with the origin already granted → next getStatus starts the recording', async () => {
    setup({ granted: [PATTERN] });
    const armed = { type: 'armStart', requestId: 'req-x', tabId: TAB, origin: 'https://shop.example.com', pattern: PATTERN };
    await env.route(armed, POPUP_SENDER);
    // No start ever arrives; onAdded does not fire for an origin that is already granted.
    const status = await env.route({ type: 'getStatus', tabId: TAB, url: PAGE_URL }, POPUP_SENDER);
    expect(status).toMatchObject({ state: 'recording', isRecordingTab: true });
    expect(await env.store.getPending()).toBeNull();
    expect(named('tabs.reload')).toHaveLength(1);
    // A repeated status does not start again.
    await env.route({ type: 'getStatus', tabId: TAB, url: PAGE_URL }, POPUP_SENDER);
    expect(named('scripting.registerContentScripts')).toHaveLength(1);
  });

  it('own pending request, other tab, stale or not granted request: getStatus does not start', async () => {
    setup({ granted: [PATTERN] });
    const arm = (requestId) =>
      env.route({ type: 'armStart', requestId, tabId: TAB, origin: 'https://shop.example.com', pattern: PATTERN }, POPUP_SENDER);
    await arm('own');
    expect(await env.route({ type: 'getStatus', tabId: TAB, url: PAGE_URL, ownRequestId: 'own' }, POPUP_SENDER)).toMatchObject({ state: 'starting' });
    expect(await env.route({ type: 'getStatus', tabId: TAB + 1, url: PAGE_URL }, POPUP_SENDER)).toMatchObject({ state: 'idle' });
    vi.advanceTimersByTime(120_001);
    expect(await env.route({ type: 'getStatus', tabId: TAB, url: PAGE_URL }, POPUP_SENDER)).toMatchObject({ state: 'idle' });
    expect(named('scripting.registerContentScripts')).toHaveLength(0);

    env.fake.grantedOrigins.clear();
    await arm('refused');
    expect(await env.route({ type: 'getStatus', tabId: TAB, url: PAGE_URL }, POPUP_SENDER)).toMatchObject({
      state: 'idle',
      lastError: 'permissionDenied',
    });
    expect(named('scripting.registerContentScripts')).toHaveLength(0);
    expect(env.fake.sessionData.has(KEYS.pending)).toBe(false);
  });
});
