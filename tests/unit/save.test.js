import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSaveHandlers, COLLECT_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS, RESULT_PROTOCOL } from '../../src/lib/save.js';
import { createStore, KEYS } from '../../src/lib/session-store.js';
import { createFakeChrome, jpegDataUrl } from './helpers/fake-chrome.js';

const T0 = Date.UTC(2026, 9, 22, 10, 0, 0);
const TAB = 7;
const WINDOW = 3;
const ORIGIN = 'https://example.com';

const REC = {
  v: 1,
  requestId: 'r1',
  tabId: TAB,
  origin: ORIGIN,
  pattern: 'https://example.com/*',
  startedAt: T0,
  limitMs: 600_000,
  deadline: T0 + 600_000,
  status: 'recording',
  stopReason: null,
  docSeq: 2,
  docs: [
    { id: 1, url: 'https://example.com/a', flushed: true },
    { id: 2, url: 'https://example.com/b', flushed: false },
  ],
  save: null,
  lastError: null,
};

const PRIOR = {
  docId: 1,
  url: 'https://example.com/a',
  timeOrigin: T0 + 100,
  navigationType: 'reload',
  buffers: {
    consoleLogs: [{ t: 1, level: 'log', args: ['before navigation'] }],
    runtimeErrors: [],
    network: [],
    truncated: {},
  },
};

function resultOf(over = {}) {
  return JSON.stringify({
    protocol: RESULT_PROTOCOL,
    recorderVersion: '0.3.0',
    docId: 2,
    timeOrigin: T0 + 5000,
    navigationType: 'navigate',
    stopReason: null,
    environment: { location: { href: 'https://example.com/b' } },
    dom: { title: 'b' },
    performance: {},
    storage: {},
    consoleLogs: [{ t: 3, level: 'error', args: ['current'] }],
    runtimeErrors: [],
    network: [],
    truncated: {},
    ...over,
  });
}

let env;

async function setup({ rec = REC, prior = [PRIOR], url = 'https://example.com/b', active = true, answer } = {}) {
  const { chrome, calls, fake } = createFakeChrome({ tabs: [{ id: TAB, url, active, windowId: WINDOW }] });
  const store = createStore(chrome.storage.session);
  if (rec) await store.updateRec(() => structuredClone(rec));
  for (const doc of prior) await store.putDoc(doc.docId, doc);
  await chrome.scripting.registerContentScripts([
    { id: 'pds-isolated', js: ['content/isolated-world.js'], matches: [rec?.pattern ?? 'https://example.com/*'] },
    { id: 'pds-main', js: ['content/main-world.js'], matches: [rec?.pattern ?? 'https://example.com/*'], world: 'MAIN' },
  ]);
  await chrome.action.setBadgeText({ tabId: TAB, text: '●' });
  fake.sendMessage = answer ?? (async (_tabId, message) => (message.type === 'collect' ? resultOf() : undefined));
  const makeHandlers = () => createSaveHandlers({ store, ...chrome });
  const handlers = makeHandlers();
  // Listener as background.js registers it; collected promises let tests await the async work.
  const pending = [];
  chrome.downloads.onChanged.addListener((delta) => pending.push(env.handlers.onDownloadChanged(delta)));
  env = { chrome, calls, fake, store, handlers, makeHandlers, pending, settle: () => Promise.all(pending.splice(0)) };
  return env;
}

// What the popup does between `collect` and `saveStarted` (design D7).
async function popupDownload(fileName) {
  const id = await env.chrome.downloads.download({ url: 'blob:x', filename: fileName, saveAs: false, conflictAction: 'uniquify' });
  await env.handlers.saveStarted({ downloadId: id, fileName });
  return id;
}

const rec = () => env.store.getRec();

beforeEach(() => {
  vi.useFakeTimers({ now: T0 + 60_000 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('collect', () => {
  it('happy path: collect → v2 package with two documents → download complete → saved, state cleared (AC-2.1, AC-2.5)', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    expect(res.fileName).toBe(`page-debug-snapshot-${T0 + 60_000}.json`);
    expect(env.calls.find((c) => c.name === 'tabs.sendMessage').args).toEqual([TAB, { type: 'collect' }, { frameId: 0 }]);

    const pkg = JSON.parse(res.json);
    expect(res.json).toContain('\n  "schemaVersion": 3');
    expect(pkg.schemaVersion).toBe(3);
    expect(pkg.extensionVersion).toBe('0.3.0');
    expect(pkg.source).toBe('extension');
    expect(pkg.recordingStartedAt).toBe(new Date(T0).toISOString());
    expect(pkg.collectedAt).toBe(new Date(T0 + 60_000).toISOString());
    expect(pkg.recordingStoppedReason).toBeNull();
    expect(pkg.documents.map((d) => d.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(pkg.consoleLogs.map((l) => [l.doc, l.args[0]])).toEqual([[0, 'before navigation'], [1, 'current']]);
    expect(pkg.dom).toEqual({ title: 'b' });
    expect((await rec()).save.phase).toBe('collecting');

    const id = await popupDownload(res.fileName);
    expect((await rec()).save).toMatchObject({ phase: 'downloading', downloadId: id, fileName: res.fileName });
    // Download started but not finished: no success yet.
    expect(await env.store.getLast(TAB)).toBeNull();

    env.fake.completeDownload(id, `C:\\Users\\u\\Downloads\\${res.fileName}`);
    const [outcome] = await env.settle();
    expect(outcome).toEqual({ saved: true, fileName: res.fileName });
    // downloadId lets the popup match the verdict to its own download (T12).
    expect(await env.store.getLast(TAB)).toEqual({ fileName: res.fileName, downloadId: id, at: T0 + 60_000 });
    expect(await rec()).toBeNull();
    expect(await env.store.listDocs()).toEqual([]);
    expect(env.fake.registered.size).toBe(0);
    expect(env.fake.badges.get(TAB).text).toBe('');
    expect(env.calls.some((c) => c.name === 'tabs.sendMessage' && c.args[1].type === 'destroy')).toBe(true);
  });

  it('success is reported only after onChanged complete; file name equals basename from downloads.search (uniquify) (AC-2.1)', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB });
    const id = await popupDownload(res.fileName);
    const unique = res.fileName.replace('.json', ' (1).json');
    env.fake.completeDownload(id, `/home/u/Downloads/${unique}`);
    const [outcome] = await env.settle();
    expect(outcome).toEqual({ saved: true, fileName: unique });
    expect((await env.store.getLast(TAB)).fileName).toBe(unique);
  });

  it('download already complete when saveStarted arrives (race with onChanged) → saved once', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB });
    const id = await env.chrome.downloads.download({ url: 'blob:x', filename: res.fileName });
    env.fake.downloadItems.get(id).state = 'complete';
    await env.handlers.saveStarted({ downloadId: id, fileName: res.fileName });
    env.chrome.downloads.onChanged.dispatch({ id, state: { previous: 'in_progress', current: 'complete' } });
    const outcomes = await env.settle();
    expect(outcomes).toEqual([null]);
    expect((await env.store.getLast(TAB)).fileName).toBe(res.fileName);
    expect(env.calls.filter((c) => c.name === 'scripting.unregisterContentScripts')).toHaveLength(1);
  });

  it('no collect answer within 15 s → pageBusy, never success (AC-2.4)', async () => {
    await setup({ answer: () => new Promise(() => {}) });
    const promise = env.handlers.collect({ tabId: TAB });
    await vi.advanceTimersByTimeAsync(COLLECT_TIMEOUT_MS + 1);
    expect(await promise).toEqual({ ok: false, reason: 'pageBusy' });
    expect((await rec()).save).toBeNull();
    expect((await rec()).status).toBe('recording');
    expect(await env.store.getLast(TAB)).toBeNull();
  });

  it('no receiver in the tab → failed', async () => {
    await setup({
      answer: async () => {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      },
    });
    expect(await env.handlers.collect({ tabId: TAB })).toEqual({ ok: false, reason: 'failed' });
    expect((await rec()).save).toBeNull();
  });

  it('recorderVersion mismatch → failed', async () => {
    await setup({ answer: async () => resultOf({ recorderVersion: '0.1.0' }) });
    expect(await env.handlers.collect({ tabId: TAB })).toEqual({ ok: false, reason: 'failed' });
  });

  it.each([
    ['not JSON', 'nope{'],
    ['an object instead of a string', { protocol: 1 }],
    ['wrong protocol', resultOf({ protocol: 99 })],
    ['missing docId', resultOf({ docId: undefined })],
    ['undefined', undefined],
  ])('invalid result (%s) → failed', async (_label, answer) => {
    await setup({ answer: async () => answer });
    expect(await env.handlers.collect({ tabId: TAB })).toEqual({ ok: false, reason: 'failed' });
  });

  it('content result cannot set file name or success (AC-5.6)', async () => {
    await setup({ answer: async () => resultOf({ ok: true, fileName: 'evil.json', json: '{"forged":true}', saved: true }) });
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.fileName).toBe(`page-debug-snapshot-${T0 + 60_000}.json`);
    const pkg = JSON.parse(res.json);
    expect(pkg.schemaVersion).toBe(3);
    expect(res.json).not.toContain('evil.json');
    expect(res.json).not.toContain('forged');
    // Popup-supplied name is ignored too: the saved name comes from downloads.search.
    const id = await env.chrome.downloads.download({ url: 'blob:x', filename: res.fileName });
    await env.handlers.saveStarted({ downloadId: id, fileName: 'evil.json' });
    env.fake.completeDownload(id);
    const [outcome] = await env.settle();
    expect(outcome.fileName).toBe(res.fileName);
  });

  it('tab on other origin → package from stored docs only with note, no message to the tab (AC-3.4)', async () => {
    await setup({ url: 'http://localhost:3000/' });
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    expect(env.calls.some((c) => c.name === 'tabs.sendMessage')).toBe(false);
    const pkg = JSON.parse(res.json);
    expect(pkg.environment).toBeNull();
    expect(pkg.consoleLogs.map((l) => l.args[0])).toEqual(['before navigation']);
    expect(pkg.notes.some((n) => /current page was not available/.test(n) && /left the recorded origin/.test(n))).toBe(true);
    expect(pkg.notes.some((n) => /loaded after the recording stopped/.test(n))).toBe(false);
  });

  it('tab closed after recording (tabs.get fails) → package without current document', async () => {
    await setup();
    env.fake.removeTab(TAB);
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.json).dom).toBeNull();
  });

  it('auto-stopped recording → recordingStoppedReason time-limit (AC-4.9)', async () => {
    await setup({ rec: { ...REC, status: 'stopped', stopReason: 'time-limit' } });
    const res = await env.handlers.collect({ tabId: TAB });
    const pkg = JSON.parse(res.json);
    expect(pkg.recordingStoppedReason).toBe('time-limit');
    expect(pkg.notes.some((n) => /time limit/.test(n))).toBe(true);
  });

  it('stopped by the limit and the tab reloaded since (no bridge) → package from stored docs, not failed (AC-1.9)', async () => {
    await setup({
      rec: { ...REC, status: 'stopped', stopReason: 'time-limit' },
      answer: async () => {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      },
    });
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    const pkg = JSON.parse(res.json);
    expect(pkg.recordingStoppedReason).toBe('time-limit');
    expect(pkg.consoleLogs.map((l) => l.args[0])).toEqual(['before navigation']);
    expect(pkg.notes.some((n) => /page was loaded after the recording stopped \(time limit\)/.test(n))).toBe(true);
    expect(pkg.notes.some((n) => /left the recorded origin/.test(n))).toBe(false);
  });

  it('deadline passed but state not yet marked stopped → still time-limit in the package (AC-4.9)', async () => {
    vi.setSystemTime(T0 + 700_000);
    await setup();
    const pkg = JSON.parse((await env.handlers.collect({ tabId: TAB })).json);
    expect(pkg.recordingStoppedReason).toBe('time-limit');
  });

  it('no recording, or recording in another tab → failed without touching the tab', async () => {
    await setup({ rec: null });
    expect(await env.handlers.collect({ tabId: TAB })).toEqual({ ok: false, reason: 'failed' });
    await setup({ rec: { ...REC, tabId: 99 } });
    expect(await env.handlers.collect({ tabId: TAB })).toEqual({ ok: false, reason: 'failed' });
    expect(env.calls.some((c) => c.name === 'tabs.sendMessage')).toBe(false);
  });
});

describe('screenshot at save (E2 D5)', () => {
  const shotNotes = (pkg) => pkg.notes.filter((n) => /^No screenshot/.test(n));
  const captures = () => env.calls.filter((c) => c.name === 'tabs.captureVisibleTab');

  it('RESULT_PROTOCOL is 2 (PROTOCOL of the E2 recorder)', () => {
    expect(RESULT_PROTOCOL).toBe(2);
  });

  it('save on recorded origin includes one screenshot with reason save, jpeg, dims, bytes (AC-6.1)', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    expect(captures().map((c) => c.args)).toEqual([[WINDOW, { format: 'jpeg', quality: 60 }]]);
    const pkg = JSON.parse(res.json);
    expect(pkg.screenshots).toHaveLength(1);
    const [shot] = pkg.screenshots;
    expect(shot).toMatchObject({ doc: 1, reason: 'save', mime: 'image/jpeg', width: 1280, height: 720, attachment: 'screenshot-0' });
    expect(shot.bytes).toBeGreaterThan(0);
    // Taken at the click (fake clock frozen at T0 + 60 s), relative to the current document.
    expect(shot.t).toBe(60_000 - 5000);
    expect(pkg.attachments['screenshot-0']).toBe(jpegDataUrl());
    expect(shotNotes(pkg)).toEqual([]);
    expect(Object.keys(pkg).at(-1)).toBe('attachments');
  });

  it('capture happens before page collect (state at the click)', async () => {
    await setup();
    await env.handlers.collect({ tabId: TAB });
    const names = env.calls.map((c) => c.name);
    const capture = names.indexOf('tabs.captureVisibleTab');
    const collect = env.calls.findIndex((c) => c.name === 'tabs.sendMessage' && c.args[1].type === 'collect');
    expect(capture).toBeGreaterThanOrEqual(0);
    expect(collect).toBeGreaterThan(capture);
    // tabs.get before the capture and again after it (origin check, D5).
    expect(names.slice(0, collect).filter((n) => n === 'tabs.get')).toHaveLength(2);
  });

  it.each([
    ['another site', 'http://localhost:3000/'],
    ['a special page', 'chrome://version/'],
  ])('tab on %s → no capture call, note (AC-6.3)', async (_label, url) => {
    await setup({ url });
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    expect(captures()).toEqual([]);
    const pkg = JSON.parse(res.json);
    expect(pkg.screenshots).toEqual([]);
    expect(pkg.attachments).toEqual({});
    expect(shotNotes(pkg)).toEqual(['No screenshot: the tab showed a page outside the recorded site.']);
  });

  it('origin changed during capture → screenshot discarded, note (AC-6.3)', async () => {
    await setup();
    env.fake.captureVisibleTab = async () => {
      env.fake.setTab({ id: TAB, url: 'http://localhost:3000/', active: true, windowId: WINDOW });
      return jpegDataUrl();
    };
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    const pkg = JSON.parse(res.json);
    expect(pkg.screenshots).toEqual([]);
    expect(pkg.attachments).toEqual({});
    expect(res.json).not.toContain('data:image/jpeg');
    expect(shotNotes(pkg)).toEqual(['No screenshot: the tab showed a page outside the recorded site.']);
    // The page is no longer ours either: nothing is asked of it.
    expect(env.calls.some((c) => c.name === 'tabs.sendMessage')).toBe(false);
  });

  it('captureVisibleTab throws → package saved, screenshots [], note; result ok (AC-6.4)', async () => {
    await setup();
    env.fake.captureVisibleTab = env.fake.captureThrows;
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    const pkg = JSON.parse(res.json);
    expect(pkg.screenshots).toEqual([]);
    expect(shotNotes(pkg)).toEqual(['No screenshot: capture failed (capture-failed).']);
    // The page was still collected and the download can go on.
    expect(pkg.dom).toEqual({ title: 'b' });
    expect((await rec()).save.phase).toBe('collecting');
  });

  it('hanging capture → timeout after 3 s, save goes on within the collect limit (AC-6.4, AC-1.x)', async () => {
    await setup();
    env.fake.captureVisibleTab = () => new Promise(() => {});
    const promise = env.handlers.collect({ tabId: TAB });
    await vi.advanceTimersByTimeAsync(3000);
    const res = await promise;
    expect(res.ok).toBe(true);
    expect(shotNotes(JSON.parse(res.json))).toEqual(['No screenshot: capture failed (timeout).']);
  });

  it('capture time counts towards the 15 s collect limit', async () => {
    await setup({ answer: () => new Promise(() => {}) });
    env.fake.captureVisibleTab = () => new Promise(() => {});
    const promise = env.handlers.collect({ tabId: TAB });
    let settled = null;
    promise.then((r) => (settled = r));
    // 3 s of capture + 12 s of waiting for the page = the same 15 s as without a screenshot.
    await vi.advanceTimersByTimeAsync(COLLECT_TIMEOUT_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(settled).toEqual({ ok: false, reason: 'pageBusy' });
  });

  it('image that cannot be made small enough → too-large note', async () => {
    await setup();
    // Over 300 KB and no codec injected to shrink it.
    env.fake.captureVisibleTab = async () => jpegDataUrl(3840, 2160, 400_000);
    const pkg = JSON.parse((await env.handlers.collect({ tabId: TAB })).json);
    expect(pkg.screenshots).toEqual([]);
    expect(shotNotes(pkg)).toEqual(['No screenshot: the image could not be made smaller than 300 KB.']);
  });

  it('injected codec is used to fit a large image', async () => {
    await setup();
    env.fake.captureVisibleTab = async () => jpegDataUrl(3840, 2160, 400_000);
    const encoded = [];
    const codec = {
      decode: async () => ({ bitmap: { close() {} }, width: 3840, height: 2160 }),
      encode: async (_bitmap, w, h, quality) => {
        encoded.push([w, h, quality]);
        return new Blob([new Uint8Array(1000)], { type: 'image/jpeg' });
      },
    };
    env.handlers = createSaveHandlers({ store: env.store, ...env.chrome, codec });
    const pkg = JSON.parse((await env.handlers.collect({ tabId: TAB })).json);
    expect(encoded).toEqual([[3840, 2160, 45]]);
    expect(pkg.screenshots[0]).toMatchObject({ width: 3840, height: 2160, bytes: 1000 });
  });

  it('inactive tab → no screenshot, note', async () => {
    await setup({ active: false });
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    expect(captures()).toEqual([]);
    const pkg = JSON.parse(res.json);
    expect(pkg.screenshots).toEqual([]);
    expect(shotNotes(pkg)).toEqual(['No screenshot: the tab was not visible.']);
    // The page itself is still collected.
    expect(pkg.dom).toEqual({ title: 'b' });
  });

  it('tab closed → no capture call, package saved', async () => {
    await setup();
    env.fake.removeTab(TAB);
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    expect(captures()).toEqual([]);
    expect(JSON.parse(res.json).screenshots).toEqual([]);
  });
});

describe('download tracking', () => {
  it.each([
    ['USER_CANCELED', 'saveCancelled'],
    ['FILE_FAILED', 'downloadFailed'],
    ['NETWORK_FAILED', 'downloadFailed'],
  ])(
    'interrupted (%s) keeps recording and sets %s; second collect returns the same earlier entries (AC-2.2)',
    async (error, lastError) => {
      await setup();
      const first = await env.handlers.collect({ tabId: TAB });
      const id = await popupDownload(first.fileName);
      env.fake.interruptDownload(id, error);
      const [outcome] = await env.settle();
      expect(outcome).toEqual({ downloadFailed: true });
      const state = await rec();
      expect(state.status).toBe('recording');
      expect(state.save).toBeNull();
      expect(state.lastError).toBe(lastError);
      expect(await env.store.getLast(TAB)).toBeNull();
      expect(env.fake.registered.size).toBe(2);

      const second = await env.handlers.collect({ tabId: TAB });
      expect(JSON.parse(second.json).consoleLogs).toEqual(JSON.parse(first.json).consoleLogs);
    },
  );

  it('download not complete within 60 s → cancel + failed, never success (AC-2.4)', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB });
    const id = await popupDownload(res.fileName);
    await vi.advanceTimersByTimeAsync(DOWNLOAD_TIMEOUT_MS + 1000);
    await env.settle();
    expect(env.calls.some((c) => c.name === 'downloads.cancel' && c.args[0] === id)).toBe(true);
    const state = await rec();
    expect(state.save).toBeNull();
    expect(state.lastError).toBe('failed');
    expect(state.status).toBe('recording');
    expect(await env.store.getLast(TAB)).toBeNull();
  });

  it('expireSave: collecting older than 15 s (popup closed before download) → pageBusy', async () => {
    await setup();
    await env.handlers.collect({ tabId: TAB });
    expect(await env.handlers.expireSave(Date.now() + 5000)).toBeNull();
    expect((await rec()).save.phase).toBe('collecting');
    expect(await env.handlers.expireSave(Date.now() + COLLECT_TIMEOUT_MS + 1)).toEqual({ downloadFailed: true });
    const state = await rec();
    expect(state.save).toBeNull();
    expect(state.lastError).toBe('pageBusy');
  });

  it('SW restart between saveStarted and complete: fresh handlers read pending save from the store', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB });
    const id = await popupDownload(res.fileName);
    env.handlers = env.makeHandlers(); // new instance, no memory of the first one
    env.fake.completeDownload(id);
    const [outcome] = await env.settle();
    expect(outcome).toEqual({ saved: true, fileName: res.fileName });
    expect(await rec()).toBeNull();
    expect(await env.store.getLast(TAB)).toEqual({ fileName: res.fileName, downloadId: id, at: T0 + 60_000 });
  });

  it('SW restart: fresh handlers expire a stale download through expireSave', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB });
    await popupDownload(res.fileName);
    const fresh = env.makeHandlers();
    expect(await fresh.expireSave(Date.now() + DOWNLOAD_TIMEOUT_MS + 1)).toEqual({ downloadFailed: true });
    expect((await rec()).lastError).toBe('failed');
  });

  it('download events for other ids are ignored', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB });
    const id = await popupDownload(res.fileName);
    const other = await env.chrome.downloads.download({ url: 'https://example.com/x.zip', filename: 'x.zip' });
    env.fake.completeDownload(other);
    env.fake.interruptDownload(other);
    expect(await env.settle()).toEqual([null, null]);
    expect((await rec()).save).toMatchObject({ phase: 'downloading', downloadId: id });
    expect(await env.store.getLast(TAB)).toBeNull();
  });

  it('saveFailed (downloads.download rejected in the popup) → downloadFailed, recording continues (AC-2.2)', async () => {
    await setup();
    await env.handlers.collect({ tabId: TAB });
    expect(await env.handlers.saveFailed({ tabId: TAB, reason: 'downloadFailed' })).toEqual({ ok: true });
    const state = await rec();
    expect(state.save).toBeNull();
    expect(state.lastError).toBe('downloadFailed');
    expect(state.status).toBe('recording');
  });

  it('saveStarted without a collect in progress is rejected', async () => {
    await setup();
    expect(await env.handlers.saveStarted({ downloadId: 5, fileName: 'x.json' })).toEqual({ ok: false });
    expect((await rec()).save).toBeNull();
  });

  it('state lives only in storage.session (no storage.local)', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB });
    await popupDownload(res.fileName);
    expect(env.calls.some((c) => c.name === 'storage.local')).toBe(false);
    expect(env.fake.sessionData.get(KEYS.rec).save.phase).toBe('downloading');
  });
});
