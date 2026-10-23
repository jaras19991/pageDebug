import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeChrome } from './helpers/fake-chrome.js';
import { createController, DOWNLOAD_TIMEOUT_MS, RESPONSE_TIMEOUT_MS } from '../../src/popup/controller.js';
import { applyModel } from '../../src/popup/view.js';
import { MESSAGES } from '../../src/popup/messages.js';

const HTML_PATH = fileURLToPath(new URL('../../src/popup/popup.html', import.meta.url));
const html = readFileSync(HTML_PATH, 'utf8');

const URL_WEB = 'https://shop.example.com:8443/cart?x=1';
const ORIGIN = 'https://shop.example.com:8443';
const PATTERN = 'https://shop.example.com/*';
const FILE_NAME = 'page-debug-snapshot-1700000000000.json';
const STARTED_AT = new Date(2026, 9, 22, 14, 3, 21).getTime();
const NEVER = () => new Promise(() => {});

const idle = (extra = {}) => ({
  state: 'idle',
  startedAt: null,
  stopReason: null,
  isRecordingTab: false,
  otherTabRecording: false,
  otherOrigin: false,
  lastSaved: null,
  lastError: null,
  ...extra,
});
const recording = (extra = {}) => idle({ state: 'recording', startedAt: STARTED_AT, isRecordingTab: true, ...extra });

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/**
 * fake-chrome plus the popup-only APIs (tabs.query, runtime.sendMessage, extension probe).
 * `bg` answers popup messages like the background would; `bg.status` is what getStatus returns.
 */
function setup({ url = URL_WEB, tab, fileAccess, firefox = false, permissionAnswer = true, handlers = {} } = {}) {
  const { chrome, calls, fake } = createFakeChrome();
  fake.permissionAnswer = permissionAnswer;
  const log = (name, args) => calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
  const bg = {
    status: idle(),
    getStatus: () => {
      const answer = bg.status;
      bg.status = { ...bg.status, lastError: null }; // one-shot, like the background
      return answer;
    },
    start: () => {
      bg.status = recording();
      return { ok: true };
    },
    collect: () => ({ ok: true, json: '{"schemaVersion":2}', fileName: FILE_NAME }),
    ...handlers,
  };
  chrome.runtime.sendMessage = (message) => {
    log('runtime.sendMessage', [message]);
    const handler = bg[message.type];
    return typeof handler === 'function' ? Promise.resolve().then(() => handler(message)) : Promise.resolve(undefined);
  };
  const activeTab = tab === undefined ? { id: 7, url } : tab;
  chrome.tabs.query = async (query) => {
    log('tabs.query', [query]);
    return activeTab ? [activeTab] : [];
  };
  if (fileAccess !== undefined) {
    chrome.extension = { isAllowedFileSchemeAccess: async () => fileAccess };
  }
  if (firefox) chrome.runtime.getBrowserInfo = async () => ({ name: 'Firefox' });

  const urlApi = {
    createObjectURL: vi.fn(() => 'blob:chrome-extension://pds/1'),
    revokeObjectURL: vi.fn(),
  };
  const models = [];
  let uuid = 0;
  const controller = createController({
    runtime: chrome.runtime,
    permissions: chrome.permissions,
    downloads: chrome.downloads,
    storage: chrome.storage,
    tabs: chrome.tabs,
    extension: chrome.extension,
    URL: urlApi,
    Blob,
    randomUUID: () => `req-${++uuid}`,
    render: (model) => models.push(model),
    logError: vi.fn(),
  });
  const sent = (type) =>
    calls.filter((c) => c.name === 'runtime.sendMessage' && (!type || c.args[0].type === type)).map((c) => c.args[0]);
  const named = (name) => calls.filter((c) => c.name === name);
  const changed = () => chrome.storage.session.onChanged.dispatch({ 'pds:rec': {} });
  return { controller, chrome, calls, fake, bg, models, last: () => models.at(-1), urlApi, sent, named, changed };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('popup controller: opening', () => {
  it('opening popup sends only getStatus; no permissions.request, no start', async () => {
    const t = setup();
    await t.controller.init();
    expect(t.named('tabs.query')[0].args[0]).toEqual({ active: true, currentWindow: true });
    expect(t.sent()).toEqual([{ type: 'getStatus', tabId: 7, url: URL_WEB }]);
    expect(t.named('permissions.request')).toHaveLength(0);
    expect(t.last()).toMatchObject({ section: 'ready', buttons: { record: true, save: false } });
  });

  it('reopened while recording shows the same start time and save button', async () => {
    const t = setup();
    t.bg.status = recording();
    await t.controller.init();
    expect(t.last()).toMatchObject({ section: 'recording', since: 'Nagrywam od 14:03:21', buttons: { save: true } });
  });

  it('opening popup while another tab records → ready with otherTabRecording', async () => {
    const t = setup();
    t.bg.status = recording({ isRecordingTab: false, otherTabRecording: true });
    await t.controller.init();
    expect(t.last()).toMatchObject({ section: 'ready', statusText: MESSAGES.otherTabRecording, isError: false });
    expect(t.last().buttons.record).toBe(true);
  });

  it('stopped by the time limit shows stoppedByLimit and save', async () => {
    const t = setup();
    t.bg.status = recording({ state: 'stopped', stopReason: 'time-limit' });
    await t.controller.init();
    expect(t.last()).toMatchObject({ section: 'recording', since: MESSAGES.stoppedByLimit, buttons: { save: true } });
  });

  it.each([
    ['restricted', { url: 'chrome://version/' }],
    ['restricted', { url: 'https://chromewebstore.google.com/detail/x' }],
    ['restricted', { url: 'about:blank' }],
    ['fileAccess', { url: 'file:///C:/bug.html', fileAccess: false }],
    ['fileAccess', { tab: { id: 7 }, fileAccess: false }],
    ['restricted', { tab: { id: 7 }, fileAccess: true }],
    ['noTab', { tab: null }],
    ['noTab', { tab: { url: URL_WEB } }],
  ])('%s shows its message without permissions.request or background calls (%j)', async (kind, options) => {
    const t = setup(options);
    await t.controller.init();
    expect(t.last()).toMatchObject({ section: null, statusText: MESSAGES[kind], isError: true });
    await t.controller.onRecord();
    await t.controller.onSave();
    expect(t.sent()).toEqual([]);
    expect(t.named('permissions.request')).toHaveLength(0);
  });

  it('file page with access in Chrome is recordable with file:///* pattern', async () => {
    const t = setup({ url: 'file:///C:/bug.html', fileAccess: true });
    await t.controller.init();
    expect(t.last().section).toBe('ready');
    t.controller.onRecord();
    expect(t.named('permissions.request')[0].args[0]).toEqual({ origins: ['file:///*'] });
  });

  it('Firefox file page → fileUnsupportedFirefox, no consent prompt, no armStart (QA F-4)', async () => {
    const t = setup({ url: 'file:///C:/bug.html', firefox: true });
    await t.controller.init();
    expect(t.last()).toMatchObject({
      section: null,
      statusText: MESSAGES.fileUnsupportedFirefox,
      isError: true,
      buttons: { record: false, save: false },
    });
    await t.controller.onRecord();
    await t.controller.onSave();
    expect(t.named('permissions.request')).toHaveLength(0);
    expect(t.sent()).toEqual([]);
  });

  it('Firefox web page is still recordable', async () => {
    const t = setup({ firefox: true });
    await t.controller.init();
    expect(t.last()).toMatchObject({ section: 'ready', buttons: { record: true } });
  });

  it('getStatus not answered in 15 s → failed', async () => {
    vi.useFakeTimers();
    const t = setup({ handlers: { getStatus: NEVER } });
    const done = t.controller.init();
    await vi.advanceTimersByTimeAsync(RESPONSE_TIMEOUT_MS);
    await done;
    expect(t.last()).toMatchObject({ section: null, statusText: MESSAGES.failed, isError: true });
  });

  it('storage.session change triggers a new getStatus; destroy unsubscribes', async () => {
    const t = setup();
    await t.controller.init();
    t.bg.status = recording();
    t.changed();
    await flush();
    expect(t.last().section).toBe('recording');
    t.controller.destroy();
    expect(t.chrome.storage.session.onChanged.hasListeners()).toBe(false);
  });
});

describe('popup controller: live tab (E2 AC-2.1)', () => {
  it('popup refreshes on tabs.onUpdated of its tab and shows otherOrigin; back on origin note disappears', async () => {
    const t = setup();
    t.bg.status = recording();
    await t.controller.init();
    expect(t.last()).toMatchObject({ section: 'recording', note: '' });

    t.bg.status = recording({ otherOrigin: true });
    t.fake.navigateTab(7, 'http://localhost:8080/');
    await flush();
    expect(t.last()).toMatchObject({ section: 'recording', note: MESSAGES.otherOrigin });

    t.bg.status = recording();
    t.fake.navigateTab(7, URL_WEB);
    await flush();
    expect(t.last()).toMatchObject({ section: 'recording', note: '' });
  });

  it('onUpdated of another tab is ignored', async () => {
    const t = setup();
    t.bg.status = recording();
    await t.controller.init();
    const before = t.sent('getStatus').length;
    t.bg.status = recording({ otherOrigin: true });
    t.fake.navigateTab(8, 'http://localhost:8080/');
    await flush();
    expect(t.sent('getStatus')).toHaveLength(before);
    expect(t.last().note).toBe('');
  });

  it('subscribes without a filter argument and only for a recordable page', async () => {
    const t = setup();
    const add = vi.spyOn(t.chrome.tabs.onUpdated, 'addListener');
    await t.controller.init();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]).toHaveLength(1);

    const r = setup({ url: 'chrome://version/' });
    await r.controller.init();
    expect(r.chrome.tabs.onUpdated.hasListeners()).toBe(false);
  });

  it('destroy removes onUpdated listener', async () => {
    const t = setup();
    await t.controller.init();
    expect(t.chrome.tabs.onUpdated.hasListeners()).toBe(true);
    t.controller.destroy();
    expect(t.chrome.tabs.onUpdated.hasListeners()).toBe(false);
    const before = t.sent('getStatus').length;
    t.fake.navigateTab(7, 'http://localhost:8080/');
    await flush();
    expect(t.sent('getStatus')).toHaveLength(before);
  });
});

describe('popup controller: Nagrywaj', () => {
  it('onRecord calls permissions.request in the same tick with exactly [pattern]; armStart sent before, not awaited', async () => {
    const t = setup();
    await t.controller.init();
    const before = t.calls.length;
    const pending = t.controller.onRecord();
    // Nothing awaited yet: both calls are already on the log.
    const sync = t.calls.slice(before).map((c) => [c.name, c.args[0]]);
    expect(sync).toEqual([
      ['runtime.sendMessage', { type: 'armStart', requestId: 'req-1', tabId: 7, origin: ORIGIN, pattern: PATTERN }],
      ['permissions.request', { origins: [PATTERN] }],
    ]);
    expect(t.last()).toMatchObject({ section: 'ready', statusText: MESSAGES.starting, buttons: { record: false } });
    await pending;
    expect(t.sent('start')).toEqual([{ type: 'start', requestId: 'req-1', tabId: 7 }]);
    expect(t.last()).toMatchObject({ section: 'recording', since: 'Nagrywam od 14:03:21' });
  });

  it('click on #record in popup.html reaches permissions.request synchronously', async () => {
    const t = setup();
    const { document } = new JSDOM(html).window;
    await t.controller.init();
    applyModel(document, t.last());
    // Same wiring as popup.js.
    document.getElementById('record').addEventListener('click', () => {
      t.controller.onRecord();
    });
    document.getElementById('record').click();
    expect(t.named('permissions.request')).toHaveLength(1);
    await flush();
    applyModel(document, t.last());
    expect(document.getElementById('recording').hidden).toBe(false);
    expect(document.getElementById('since').textContent).toMatch(/^Nagrywam od \d{2}:\d{2}:\d{2}$/);
  });

  it('denied permission → disarm, permissionDenied text, no start', async () => {
    const t = setup({ permissionAnswer: false });
    await t.controller.init();
    await t.controller.onRecord();
    expect(t.sent('disarm')).toEqual([{ type: 'disarm', requestId: 'req-1', tabId: 7 }]);
    expect(t.sent('start')).toEqual([]);
    expect(t.last()).toMatchObject({
      section: 'ready',
      statusText: MESSAGES.permissionDenied,
      isError: true,
      buttons: { record: true },
    });
  });

  it('permissionDenied stays when the background goes starting → idle without lastError (QA F-1)', async () => {
    const t = setup();
    const { document } = new JSDOM(html).window;
    let answer;
    const grant = t.chrome.permissions.request;
    t.chrome.permissions.request = () => new Promise((resolve) => (answer = resolve));
    await t.controller.init();
    const pending = t.controller.onRecord();
    // armStart wrote pds:pending: the background now reports this tab as starting.
    t.bg.status = idle({ state: 'starting' });
    t.changed();
    await flush();
    // "Zabroń": the popup disarms, the background drops the request and says idle, no lastError.
    t.bg.status = idle();
    answer(false);
    await pending;
    t.changed();
    await flush();
    expect(t.sent('getStatus').length).toBeGreaterThanOrEqual(3);
    expect(t.sent('armStart')).toHaveLength(1);
    expect(t.sent('disarm')).toHaveLength(1);
    applyModel(document, t.last());
    expect(document.getElementById('status').textContent).toBe(MESSAGES.permissionDenied);
    expect(document.getElementById('status').classList.contains('error')).toBe(true);
    // The next user action clears it.
    t.chrome.permissions.request = grant;
    const again = t.controller.onRecord();
    expect(t.last().statusText).toBe(MESSAGES.starting);
    await again;
  });

  it.each(['recordFailed', 'restricted', 'fileAccess'])(
    'start verdict %s survives a later state change without lastError',
    async (reason) => {
      const t = setup({ handlers: { start: () => ({ ok: false, reason }) } });
      await t.controller.init();
      t.bg.status = idle({ state: 'starting' });
      t.changed();
      await flush();
      await t.controller.onRecord();
      t.bg.status = idle();
      t.changed();
      await flush();
      expect(t.last()).toMatchObject({ section: 'ready', statusText: MESSAGES[reason], isError: true });
    },
  );

  it('start is idempotent: a repeated click in the same popup reuses the requestId', async () => {
    const t = setup({ permissionAnswer: false });
    await t.controller.init();
    await t.controller.onRecord();
    t.fake.permissionAnswer = true;
    await t.controller.onRecord();
    const ids = t.sent('armStart').map((m) => m.requestId);
    expect(ids).toEqual(['req-1', 'req-1']);
    expect(t.sent('start').map((m) => m.requestId)).toEqual(['req-1']);
  });

  it('a second click while starting is ignored', async () => {
    const t = setup();
    await t.controller.init();
    const first = t.controller.onRecord();
    t.controller.onRecord();
    await first;
    expect(t.named('permissions.request')).toHaveLength(1);
    expect(t.sent('start')).toHaveLength(1);
  });

  it('permissions.request throwing → disarm and recordFailed', async () => {
    const t = setup();
    await t.controller.init();
    t.chrome.permissions.request = () => {
      throw new Error('permissions.request may only be called from a user input handler');
    };
    await t.controller.onRecord();
    expect(t.sent('disarm')).toHaveLength(1);
    expect(t.last().statusText).toBe(MESSAGES.recordFailed);
  });

  it('start refused by the background shows its reason; raw errors never reach the UI', async () => {
    const t = setup({ handlers: { start: () => ({ ok: false, reason: 'restricted' }) } });
    await t.controller.init();
    await t.controller.onRecord();
    expect(t.last().statusText).toBe(MESSAGES.restricted);

    const u = setup({ handlers: { start: () => ({ ok: false, reason: 'TypeError: x is undefined' }) } });
    await u.controller.init();
    await u.controller.onRecord();
    expect(u.last().statusText).toBe(MESSAGES.recordFailed);
  });

  it('start not answered in 15 s → failed', async () => {
    vi.useFakeTimers();
    const t = setup({ handlers: { start: NEVER } });
    await t.controller.init();
    const done = t.controller.onRecord();
    await vi.advanceTimersByTimeAsync(RESPONSE_TIMEOUT_MS);
    await done;
    expect(t.last()).toMatchObject({ statusText: MESSAGES.failed, isError: true });
  });

  it('getStatus while the consent prompt is open carries ownRequestId; not before, not after', async () => {
    const t = setup();
    let release;
    t.chrome.permissions.request = () => new Promise((resolve) => (release = resolve));
    await t.controller.init();
    const pending = t.controller.onRecord();
    // armStart wrote pds:pending → storage.session.onChanged → refresh.
    t.changed();
    await flush();
    const during = t.sent('getStatus').at(-1);
    expect(during).toEqual({ type: 'getStatus', tabId: 7, url: URL_WEB, ownRequestId: 'req-1' });
    release(true);
    await pending;
    expect(t.sent('getStatus')[0]).not.toHaveProperty('ownRequestId');
    expect(t.sent('getStatus').at(-1)).not.toHaveProperty('ownRequestId');
  });

  it('background state starting (armed, e.g. reopened during Firefox consent) → starting text, no record button', async () => {
    const t = setup();
    t.bg.status = idle({ state: 'starting' });
    await t.controller.init();
    expect(t.last()).toMatchObject({ section: 'ready', statusText: MESSAGES.starting, buttons: { record: false } });
  });

  it('stale pending reported by getStatus as permissionDenied is shown once', async () => {
    const t = setup();
    t.bg.status = idle({ lastError: 'permissionDenied' });
    await t.controller.init();
    expect(t.last()).toMatchObject({ section: 'ready', statusText: MESSAGES.permissionDenied, isError: true });
  });
});

describe('popup controller: Zapisz paczkę', () => {
  async function recordingPopup(options) {
    const t = setup(options);
    t.bg.status = recording();
    await t.controller.init();
    return t;
  }

  it('save → collect, Blob URL, downloads.download with filename and saveAs:false, then saveStarted', async () => {
    const t = await recordingPopup();
    await t.controller.onSave();
    expect(t.sent('collect')).toEqual([{ type: 'collect', tabId: 7 }]);
    expect(t.urlApi.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = t.urlApi.createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe('{"schemaVersion":2}');
    expect(t.named('downloads.download')[0].args[0]).toEqual({
      url: 'blob:chrome-extension://pds/1',
      filename: FILE_NAME,
      saveAs: false,
      conflictAction: 'uniquify',
    });
    expect(t.sent('saveStarted')).toEqual([{ type: 'saveStarted', tabId: 7, downloadId: 1, fileName: FILE_NAME }]);
  });

  it('Zapisano shown only after status saved from background, never from download() resolve; blob URL revoked', async () => {
    const t = await recordingPopup();
    t.bg.status = recording({ state: 'saving' });
    await t.controller.onSave();
    expect(t.last()).toMatchObject({ section: 'recording', statusText: MESSAGES.saving });
    expect(t.models.some((m) => m.statusText.startsWith('Zapisano'))).toBe(false);
    expect(t.urlApi.revokeObjectURL).not.toHaveBeenCalled();

    // Background saw downloads.onChanged complete; the real name may differ (uniquify).
    const realName = 'page-debug-snapshot-1700000000000 (1).json';
    t.bg.status = idle({ lastSaved: { fileName: realName, downloadId: 1 } });
    t.changed();
    await flush();
    expect(t.last()).toMatchObject({ section: 'ready', statusText: MESSAGES.saved(realName), isError: false });
    expect(t.urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:chrome-extension://pds/1');
  });

  it('lastSaved of another download is not taken as this save', async () => {
    const t = await recordingPopup();
    t.bg.status = recording({ state: 'saving', lastSaved: { fileName: 'old.json', downloadId: 99 } });
    await t.controller.onSave();
    t.changed();
    await flush();
    expect(t.last().statusText).toBe(MESSAGES.saving);
  });

  it('download failed in the browser (background lastError downloadFailed) → its own text, not saveCancelled', async () => {
    const t = await recordingPopup();
    t.bg.status = recording({ state: 'saving' });
    await t.controller.onSave();
    t.bg.status = recording({ lastError: 'downloadFailed' });
    t.changed();
    await flush();
    expect(t.last()).toMatchObject({ section: 'recording', statusText: MESSAGES.downloadFailed, isError: true });
    expect(t.urlApi.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('one-shot lastError in an answer overtaken by a newer getStatus is not lost', async () => {
    const t = await recordingPopup();
    t.bg.status = recording({ state: 'saving' });
    await t.controller.onSave();
    t.bg.status = recording({ lastError: 'saveCancelled' });
    // Two changes before any answer: the first answer carries the error and is already stale.
    t.changed();
    t.changed();
    await flush();
    expect(t.sent('getStatus').length).toBeGreaterThanOrEqual(2);
    expect(t.last()).toMatchObject({ statusText: MESSAGES.saveCancelled, isError: true });
  });

  it('interrupted download (background lastError saveCancelled) → error text, recording goes on', async () => {
    const t = await recordingPopup();
    t.bg.status = recording({ state: 'saving' });
    await t.controller.onSave();
    t.bg.status = recording({ lastError: 'saveCancelled' });
    t.changed();
    await flush();
    expect(t.last()).toMatchObject({
      section: 'recording',
      statusText: MESSAGES.saveCancelled,
      isError: true,
      buttons: { save: true },
    });
    expect(t.urlApi.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('onSave: collect not answered in 15 s → pageBusy, never success; late answer starts no download', async () => {
    vi.useFakeTimers();
    let answer;
    const t = await recordingPopup({
      handlers: { collect: () => new Promise((resolve) => (answer = resolve)) },
    });
    const done = t.controller.onSave();
    await vi.advanceTimersByTimeAsync(RESPONSE_TIMEOUT_MS);
    await done;
    expect(t.last()).toMatchObject({ statusText: MESSAGES.pageBusy, isError: true, buttons: { save: true } });
    answer({ ok: true, json: '{}', fileName: FILE_NAME });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.named('downloads.download')).toHaveLength(0);
    expect(t.models.some((m) => m.statusText.startsWith('Zapisano'))).toBe(false);
  });

  it('pageBusy stays after the background closes its own attempt (saving → recording, no lastError) until a new lastError', async () => {
    vi.useFakeTimers();
    const t = await recordingPopup({ handlers: { collect: NEVER } });
    t.bg.status = recording({ state: 'saving' });
    const done = t.controller.onSave();
    await vi.advanceTimersByTimeAsync(RESPONSE_TIMEOUT_MS);
    await done;
    expect(t.last()).toMatchObject({ statusText: MESSAGES.pageBusy, isError: true });
    // ~13 ms later the background's collect timeout runs failSave without lastError.
    t.bg.status = recording();
    t.changed();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.last()).toMatchObject({ section: 'recording', statusText: MESSAGES.pageBusy, isError: true, buttons: { save: true } });
    // A later state change keeps it too; only a new lastError replaces it.
    t.bg.status = recording({ state: 'stopped', stopReason: 'time-limit' });
    t.changed();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.last().statusText).toBe(MESSAGES.pageBusy);
    t.bg.status = recording({ lastError: 'saveCancelled' });
    t.changed();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.last().statusText).toBe(MESSAGES.saveCancelled);
  });

  it.each(['failed', 'downloadFailed', 'saveCancelled'])('%s verdict survives saving → recording without lastError; next save clears it', async (kind) => {
    const t = await recordingPopup();
    t.bg.status = recording({ state: 'saving' });
    await t.controller.onSave();
    t.bg.status = recording({ state: 'saving', lastError: kind });
    t.changed();
    await flush();
    expect(t.last().statusText).toBe(MESSAGES[kind]);
    t.bg.status = recording();
    t.changed();
    await flush();
    expect(t.last()).toMatchObject({ statusText: MESSAGES[kind], isError: true });
    t.bg.status = recording({ state: 'saving' });
    const again = t.controller.onSave();
    expect(t.last().statusText).toBe(MESSAGES.saving);
    await again;
  });

  it.each([
    [{ ok: false, reason: 'pageBusy' }, 'pageBusy'],
    [{ ok: false, reason: 'failed' }, 'failed'],
    [{ ok: true, fileName: FILE_NAME }, 'failed'],
    [undefined, 'failed'],
  ])('collect answer %j → %s without download', async (res, kind) => {
    const t = await recordingPopup({ handlers: { collect: () => res } });
    await t.controller.onSave();
    expect(t.last().statusText).toBe(MESSAGES[kind]);
    expect(t.named('downloads.download')).toHaveLength(0);
  });

  it('onSave: downloads.download rejection → saveFailed reported and error text', async () => {
    const t = await recordingPopup();
    t.chrome.downloads.download = async () => {
      throw new Error('Invalid filename');
    };
    await t.controller.onSave();
    expect(t.sent('saveFailed')).toEqual([{ type: 'saveFailed', tabId: 7, reason: 'downloadFailed' }]);
    expect(t.sent('saveStarted')).toEqual([]);
    expect(t.last()).toMatchObject({ statusText: MESSAGES.downloadFailed, isError: true, buttons: { save: true } });
    expect(t.last().statusText).not.toContain('Invalid filename');
    expect(t.urlApi.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('download not confirmed in 60 s → failed and blob URL revoked', async () => {
    vi.useFakeTimers();
    const t = await recordingPopup();
    t.bg.status = recording({ state: 'saving' });
    await t.controller.onSave();
    await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS);
    expect(t.last()).toMatchObject({ statusText: MESSAGES.failed, isError: true });
    expect(t.urlApi.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(t.models.some((m) => m.statusText.startsWith('Zapisano'))).toBe(false);
  });

  it('a second click while saving is ignored', async () => {
    const t = await recordingPopup();
    const first = t.controller.onSave();
    t.controller.onSave();
    await first;
    expect(t.sent('collect')).toHaveLength(1);
  });

  it('blob URL revoked when the popup closes mid-save', async () => {
    const t = await recordingPopup();
    t.bg.status = recording({ state: 'saving' });
    await t.controller.onSave();
    t.controller.destroy();
    expect(t.urlApi.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
