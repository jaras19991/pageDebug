// Popup controller + background handlers (recording.js, save.js) on one fake chrome (E1-T12).
// No background.js: the router below is the minimal dispatch by `type` with the sender check
// from D2. This file is the contract for E1-T1c — background.js must route the same way:
//   popup (extension page, no sender.tab)  → getStatus armStart start disarm collect saveStarted saveFailed
//   bridge (sender.tab, frameId 0, our id) → hello flush stopped bridgeError
//   permissions.onAdded → recording.onPermissionAdded; downloads.onChanged → save.onDownloadChanged
//   one store for both handler sets; recording gets `expireSave: save.expireSave`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeChrome } from './helpers/fake-chrome.js';
import { createRecordingHandlers } from '../../src/lib/recording.js';
import { createSaveHandlers } from '../../src/lib/save.js';
import { createStore, KEYS } from '../../src/lib/session-store.js';
import { unregisterAll, setBadge } from '../../src/lib/content-scripts.js';
import { createController } from '../../src/popup/controller.js';
import { MESSAGES } from '../../src/popup/messages.js';

const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);
const TAB = 7;
const PAGE_URL = 'https://shop.example.com/cart';
const ORIGIN = 'https://shop.example.com';
const PATTERN = 'https://shop.example.com/*';
const EXTENSION_ID = 'pds-test-id';

const POPUP_TYPES = new Set(['getStatus', 'armStart', 'start', 'disarm', 'collect', 'saveStarted', 'saveFailed']);
const BRIDGE_TYPES = new Set(['hello', 'flush', 'stopped', 'bridgeError']);

/** Minimal router: dispatch by `type`, popup commands only from extension pages, bridge only from a top frame. */
function createRouter(chrome, handlers) {
  const fromExtensionPage = (s) => s?.id === chrome.runtime.id && !s.tab;
  const fromTopFrame = (s) => s?.id === chrome.runtime.id && typeof s.tab?.id === 'number' && s.frameId === 0;
  return async (message, sender) => {
    const type = message?.type;
    if (POPUP_TYPES.has(type) && fromExtensionPage(sender)) return handlers[type](message, sender);
    if (BRIDGE_TYPES.has(type) && fromTopFrame(sender)) return handlers[type](message, sender);
    return undefined;
  };
}

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
    consoleLogs: logs.map((text, i) => ({ t: 10 + i, level: 'error', args: [text] })),
    runtimeErrors: [],
    network: [],
    truncated: {},
  });
}

let env;

function setup() {
  const { chrome, calls, fake } = createFakeChrome({ tabs: [{ id: TAB, url: PAGE_URL }], extensionId: EXTENSION_ID });
  const inflight = new Set();
  const track = (promise) => {
    const p = Promise.resolve(promise);
    inflight.add(p);
    p.finally(() => inflight.delete(p)).catch(() => {});
    return p;
  };

  // Background instance (what background.js wires at top level).
  const store = createStore(chrome.storage.session);
  const save = createSaveHandlers({ store, ...chrome, unregisterAll, setBadge });
  const recording = createRecordingHandlers({ chrome, store, expireSave: save.expireSave });
  const route = createRouter(chrome, { ...recording, ...save });
  chrome.permissions.onAdded.addListener((p) => track(recording.onPermissionAdded(p)));
  chrome.downloads.onChanged.addListener((d) => track(save.onDownloadChanged(d)));

  // runtime.sendMessage is asynchronous in the browser and clones the message.
  const popupSender = { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/popup/popup.html` };
  fake.runtimeSendMessage = (message) =>
    track(Promise.resolve().then(() => route(JSON.parse(JSON.stringify(message)), popupSender)));
  const bridgeSender = { id: EXTENSION_ID, tab: { id: TAB, url: PAGE_URL }, frameId: 0, url: PAGE_URL };
  const fromPage = (message) => track(route(message, bridgeSender));

  // The page side of collect/destroy (ISOLATED relaying MAIN).
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
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  env = { chrome, calls, fake, store, page, fromPage, blobs, urlApi, models, openPopup, settle, last: () => models.at(-1) };
  return env;
}

const named = (name) => env.calls.filter((c) => c.name === name);
const sentTypes = () => named('runtime.sendMessage').map((c) => c.args[0].type);

// Nagrywaj → consent → start → the reloaded page says hello.
async function recordFromPopup(popup) {
  await popup.init();
  await popup.onRecord();
  await env.settle();
  const hello = await env.fromPage({ type: 'hello' });
  env.page.docId = hello.docId;
  await env.settle();
  return hello;
}

// Zapisz → collect → Blob → downloads.download → saveStarted → onChanged complete.
async function saveFromPopup(popup, savedAs) {
  await popup.onSave();
  await env.settle();
  const [download] = named('downloads.download');
  const id = 1;
  env.fake.completeDownload(id, `C:\\Users\\u\\Downloads\\${savedAs ?? download.args[0].filename}`);
  await env.settle();
  return { id, requested: download.args[0].filename, pkg: JSON.parse(await env.blobs.at(-1).text()) };
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  setup();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('popup ↔ background (contract for E1-T1c)', () => {
  it('Nagrywaj → zgoda → start → hello → Zapisz → collect → download → complete → popup shows saved(fileName)', async () => {
    const popup = env.openPopup();
    const hello = await recordFromPopup(popup);

    expect(hello).toEqual({ record: true, docId: 1, deadline: T0 + 600_000, limitMs: 600_000 });
    expect(named('permissions.request').map((c) => c.args[0])).toEqual([{ origins: [PATTERN] }]);
    expect(named('tabs.reload')).toHaveLength(1);
    expect(env.models.some((m) => m.statusText === MESSAGES.starting)).toBe(true);
    expect(env.last()).toMatchObject({ section: 'recording', buttons: { save: true } });
    expect(env.last().since).toMatch(/^Nagrywam od \d{2}:\d{2}:\d{2}$/);
    expect(env.fake.badges.get(TAB).text).toBe('●');
    // Popup messages reached their handlers with the agreed shapes.
    const firstOf = (type) => named('runtime.sendMessage').find((c) => c.args[0].type === type).args[0];
    expect(firstOf('armStart')).toEqual({ type: 'armStart', requestId: 'req-1', tabId: TAB, origin: ORIGIN, pattern: PATTERN });
    expect(firstOf('start')).toEqual({ type: 'start', requestId: 'req-1', tabId: TAB });

    env.page.logs = ['Nie działa koszyk'];
    const savedAs = 'page-debug-snapshot-1792929600000 (1).json';
    const { pkg, requested } = await saveFromPopup(popup, savedAs);

    expect(requested).toBe(`page-debug-snapshot-${T0}.json`);
    expect(named('downloads.download')[0].args[0]).toMatchObject({ saveAs: false, conflictAction: 'uniquify' });
    expect(sentTypes()).toEqual(expect.arrayContaining(['collect', 'saveStarted']));
    expect(named('runtime.sendMessage').find((c) => c.args[0].type === 'saveStarted').args[0]).toEqual({
      type: 'saveStarted',
      tabId: TAB,
      downloadId: 1,
      fileName: requested,
    });
    expect(pkg).toMatchObject({ schemaVersion: 2, source: 'extension', recordingStoppedReason: null });
    expect(pkg.consoleLogs.map((l) => l.args[0])).toEqual(['Nie działa koszyk']);

    // Success comes from the background (pds:last with downloadId), with the real file name.
    expect(env.last()).toMatchObject({ section: 'ready', statusText: MESSAGES.saved(savedAs), isError: false });
    expect(env.urlApi.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(await env.store.getLast(TAB)).toEqual({ fileName: savedAs, downloadId: 1, at: T0 });
    expect(await env.store.getRec()).toBeNull();
    expect(env.fake.registered.size).toBe(0);
    expect(env.fake.badges.get(TAB).text).toBe('');
    popup.destroy();

    // A popup opened later still shows the last saved file.
    const reopened = env.openPopup();
    await reopened.init();
    expect(env.last()).toMatchObject({ section: 'ready', statusText: MESSAGES.saved(savedAs) });
    reopened.destroy();
  });

  it('interrupted by the reporter → saveCancelled; failed in the browser → downloadFailed; recording goes on', async () => {
    const popup = env.openPopup();
    await recordFromPopup(popup);

    await popup.onSave();
    await env.settle();
    env.fake.interruptDownload(1, 'USER_CANCELED');
    await env.settle();
    expect(env.last()).toMatchObject({ section: 'recording', statusText: MESSAGES.saveCancelled, isError: true });

    await popup.onSave();
    await env.settle();
    env.fake.interruptDownload(2, 'FILE_NO_SPACE');
    await env.settle();
    expect(env.last()).toMatchObject({ section: 'recording', statusText: MESSAGES.downloadFailed, buttons: { save: true } });
    expect((await env.store.getRec()).status).toBe('recording');
    popup.destroy();
  });

  it('consent refused → disarm, permissionDenied, nothing registered', async () => {
    env.fake.permissionAnswer = false;
    const popup = env.openPopup();
    await popup.init();
    await popup.onRecord();
    await env.settle();
    expect(sentTypes()).toContain('disarm');
    expect(env.last()).toMatchObject({ section: 'ready', statusText: MESSAGES.permissionDenied, isError: true });
    expect(env.fake.sessionData.has(KEYS.pending)).toBe(false);
    expect(named('scripting.registerContentScripts')).toHaveLength(0);
    popup.destroy();
  });

  it('limit 3 s (test limit): after the deadline a newly opened popup shows stoppedByLimit; saved package has time-limit', async () => {
    // What the e2e harness does through the service worker (T18/T19b); pages cannot reach storage.session.
    await env.chrome.storage.session.set({ [KEYS.testLimit]: 3000 });
    const popup = env.openPopup();
    const hello = await recordFromPopup(popup);
    expect(hello).toEqual({ record: true, docId: 1, deadline: T0 + 3000, limitMs: 3000 });
    popup.destroy();
    env.page.logs = ['przed limitem'];

    vi.advanceTimersByTime(3000);
    const later = env.openPopup();
    await later.init();
    await env.settle();
    expect(env.last()).toMatchObject({ section: 'recording', since: MESSAGES.stoppedByLimit, hint: false, buttons: { save: true } });
    expect(await env.store.getRec()).toMatchObject({ status: 'stopped', stopReason: 'time-limit' });
    expect(env.fake.registered.size).toBe(0);
    expect(env.fake.badges.get(TAB).text).toBe('■');
    // A page loaded after the limit is not recorded.
    expect((await env.fromPage({ type: 'hello' })).record).toBe(false);

    const { pkg } = await saveFromPopup(later);
    expect(pkg.recordingStoppedReason).toBe('time-limit');
    expect(pkg.consoleLogs.map((l) => l.args[0])).toEqual(['przed limitem']);
    expect(env.last().statusText).toMatch(/^Zapisano plik page-debug-snapshot-\d+\.json/);
    later.destroy();
  });

  it('limit 3 s: MAIN stops itself and sends stopped → the open popup switches to stoppedByLimit', async () => {
    await env.chrome.storage.session.set({ [KEYS.testLimit]: 3000 });
    const popup = env.openPopup();
    await recordFromPopup(popup);
    expect(env.last().since).toMatch(/^Nagrywam od/);

    vi.advanceTimersByTime(3000);
    await env.fromPage({ type: 'stopped', reason: 'time-limit' });
    await env.settle();
    expect(env.last()).toMatchObject({ section: 'recording', since: MESSAGES.stoppedByLimit, buttons: { save: true } });
    expect(env.fake.badges.get(TAB).text).toBe('■');
    popup.destroy();
  });

  it('router: popup commands from a content script and bridge messages from the popup are dropped (D2)', async () => {
    const popup = env.openPopup();
    await recordFromPopup(popup);
    expect(await env.fromPage({ type: 'collect', tabId: TAB })).toBeUndefined();
    expect(await env.chrome.runtime.sendMessage({ type: 'hello' })).toBeUndefined();
    expect(await env.chrome.runtime.sendMessage({ type: 'stopped', reason: 'time-limit' })).toBeUndefined();
    expect((await env.store.getRec()).status).toBe('recording');
    popup.destroy();
  });
});
