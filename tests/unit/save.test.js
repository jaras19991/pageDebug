import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSaveHandlers,
  COLLECT_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  FIELD_RECTS_TIMEOUT_MS,
  RESULT_PROTOCOL,
} from '../../src/lib/save.js';
import { createStore, KEYS } from '../../src/lib/session-store.js';
import { SCREENSHOT_NOTES } from '../../src/lib/screenshot-notes.js';
import { createFakeChrome, createFakeCodec, fieldRectsAnswer, jpegDataUrl, readZip } from './helpers/fake-chrome.js';
import { JWT, TOKEN, EMAIL, PASSWORD, COOKIE_SID } from './helpers/redaction-traps.js';

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

// The local time of the fake clock in the file name (AC-1.1): snapshot-<host>-<YYYYMMDD-HHMMSS>.zip.
function localStamp(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
const FILE_NAME = () => `snapshot-example.com-${localStamp(T0 + 60_000)}.zip`;

// Package of a `collect` answer (E3 D7: zip as base64).
const pkgOf = (res) => readZip(res.zipBase64).pkg;

async function setup({ rec = REC, prior = [PRIOR], url = 'https://example.com/b', active = true, answer, codec = createFakeCodec(), getDevOptions } = {}) {
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
  fake.fieldRects = async () => fieldRectsAnswer();
  const makeHandlers = () => createSaveHandlers({ store, ...chrome, codec, getDevOptions });
  const handlers = makeHandlers();
  // Listener as background.js registers it; collected promises let tests await the async work.
  const pending = [];
  chrome.downloads.onChanged.addListener((delta) => pending.push(env.handlers.onDownloadChanged(delta)));
  env = { chrome, calls, fake, store, codec, handlers, makeHandlers, pending, settle: () => Promise.all(pending.splice(0)) };
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
  it('happy path: collect → v4 zip with two documents → download complete → saved, state cleared (AC-2.1, AC-2.5)', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    expect(res.fileName).toBe(FILE_NAME());
    expect(Object.keys(res).sort()).toEqual(['fileName', 'ok', 'packageBytes', 'screenshot', 'zipBase64']);
    const collects = env.calls.filter((c) => c.name === 'tabs.sendMessage' && c.args[1].type === 'collect');
    expect(collects.map((c) => c.args)).toEqual([[TAB, { type: 'collect' }, { frameId: 0 }]]);

    const { pkg, json } = readZip(res.zipBase64);
    expect(json).toContain('\n  "schemaVersion": 4');
    expect(pkg.schemaVersion).toBe(4);
    expect(pkg.extensionVersion).toBe('0.3.0');
    expect(pkg.source).toBe('extension');
    expect(pkg.recordingStartedAt).toBe(new Date(T0).toISOString());
    expect(pkg.collectedAt).toBe(new Date(T0 + 60_000).toISOString());
    expect(pkg.recordingStoppedReason).toBeNull();
    expect(pkg.documents.map((d) => d.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(pkg.consoleLogs.map((l) => [l.doc, l.args[0]])).toEqual([[0, 'before navigation'], [1, 'current']]);
    expect(pkg.dom).toMatchObject({ title: 'b' });
    expect((await rec()).save).toMatchObject({ phase: 'collecting', fileName: res.fileName });

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
    const unique = res.fileName.replace('.zip', ' (1).zip');
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
    await setup({ answer: async () => resultOf({ ok: true, fileName: 'evil.json', zipBase64: 'AAAA', json: '{"forged":true}', saved: true }) });
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.fileName).toBe(FILE_NAME());
    const { pkg, json } = readZip(res.zipBase64);
    expect(pkg.schemaVersion).toBe(4);
    expect(json).not.toContain('evil.json');
    expect(json).not.toContain('forged');
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
    const pkg = pkgOf(res);
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
    expect(pkgOf(res).dom).toBeNull();
  });

  it('auto-stopped recording → recordingStoppedReason time-limit (AC-4.9)', async () => {
    await setup({ rec: { ...REC, status: 'stopped', stopReason: 'time-limit' } });
    const res = await env.handlers.collect({ tabId: TAB });
    const pkg = pkgOf(res);
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
    const pkg = pkgOf(res);
    expect(pkg.recordingStoppedReason).toBe('time-limit');
    expect(pkg.consoleLogs.map((l) => l.args[0])).toEqual(['before navigation']);
    expect(pkg.notes.some((n) => /page was loaded after the recording stopped \(time limit\)/.test(n))).toBe(true);
    expect(pkg.notes.some((n) => /left the recorded origin/.test(n))).toBe(false);
  });

  it('deadline passed but state not yet marked stopped → still time-limit in the package (AC-4.9)', async () => {
    vi.setSystemTime(T0 + 700_000);
    await setup();
    const pkg = pkgOf(await env.handlers.collect({ tabId: TAB }));
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
  const sent = (type) => env.calls.filter((c) => c.name === 'tabs.sendMessage' && c.args[1].type === type);

  it('RESULT_PROTOCOL is 3 (PROTOCOL of the E3 recorder: dom.structure, forms valueLength)', () => {
    expect(RESULT_PROTOCOL).toBe(3);
  });

  it('save on recorded origin includes one masked screenshot as screenshot.jpg (AC-6.1, AC-6.4)', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    expect(captures().map((c) => c.args)).toEqual([[WINDOW, { format: 'jpeg', quality: 60 }]]);
    const { pkg, names, files, json } = readZip(res.zipBase64);
    expect(names).toEqual(['snapshot.json', 'summary.md', 'screenshot.jpg']);
    expect(pkg.screenshots).toHaveLength(1);
    const [shot] = pkg.screenshots;
    expect(shot).toMatchObject({ doc: 1, reason: 'save', mime: 'image/jpeg', width: 1280, height: 720, file: 'screenshot.jpg', maskedFields: 1 });
    expect(shot.bytes).toBe(files['screenshot.jpg'].length);
    // Taken at the click (fake clock frozen at T0 + 60 s), relative to the current document.
    expect(shot.t).toBe(60_000 - 5000);
    expect(json).not.toContain('data:image/jpeg');
    expect('attachments' in pkg).toBe(false);
    expect(shotNotes(pkg)).toEqual([]);
  });

  it('capture happens between two fieldRects and before page collect (state at the click, D6)', async () => {
    await setup();
    await env.handlers.collect({ tabId: TAB });
    const order = env.calls
      .filter((c) => c.name === 'tabs.captureVisibleTab' || c.name === 'tabs.sendMessage' || c.name === 'tabs.get')
      .map((c) => (c.name === 'tabs.sendMessage' ? c.args[1].type : c.name));
    expect(order.slice(0, 6)).toEqual(['tabs.get', 'fieldRects', 'tabs.captureVisibleTab', 'tabs.get', 'fieldRects', 'collect']);
    expect(sent('fieldRects').map((c) => c.args)).toEqual([
      [TAB, { type: 'fieldRects' }, { frameId: 0 }],
      [TAB, { type: 'fieldRects' }, { frameId: 0 }],
    ]);
  });

  it('mask = union of R1 and R2 scaled to the image; codec gets JPEG 60 (D6)', async () => {
    await setup();
    const answers = [fieldRectsAnswer({ rects: [{ x: 10, y: 20, w: 200, h: 30 }] }), fieldRectsAnswer({ rects: [{ x: 300, y: 400, w: 100, h: 50 }] })];
    env.fake.fieldRects = async () => answers.shift();
    const res = await env.handlers.collect({ tabId: TAB });
    expect(env.codec.masks).toHaveLength(1);
    const [mask] = env.codec.masks;
    expect(mask.quality).toBe(60);
    // Scale 1, margin 2 CSS px = 2 image px (E4 D10).
    expect(mask.rects).toEqual([
      { x: 8, y: 18, w: 204, h: 34 },
      { x: 298, y: 398, w: 104, h: 54 },
    ]);
    expect(pkgOf(res).screenshots[0].maskedFields).toBe(2);
  });

  it('includeScreenshot false → no fieldRects, no captureVisibleTab, screenshots [], reporter note (AC-2.1)', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB, includeScreenshot: false });
    expect(res.ok).toBe(true);
    expect(captures()).toEqual([]);
    expect(sent('fieldRects')).toEqual([]);
    const { pkg, names } = readZip(res.zipBase64);
    expect(names).toEqual(['snapshot.json', 'summary.md']);
    expect(pkg.screenshots).toEqual([]);
    expect(pkg.notes).toContain('Screenshot not included (turned off by the reporter).');
    expect(shotNotes(pkg)).toEqual([]);
    // The page itself is still collected.
    expect(sent('collect')).toHaveLength(1);
  });

  // E4 D8 (IN6, AC-3.9): the popup says why the screenshot was off; the background trusts only known values.
  const offNotes = (pkg) => pkg.notes.filter((n) => /^Screenshot not included/.test(n));

  it('includeScreenshot false + reason frames(3) → note offFrames(3), not "turned off by the reporter" (AC-3.9)', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB, includeScreenshot: false, screenshotOffReason: 'frames', crossOriginFrames: 3 });
    expect(res).toMatchObject({ ok: true, screenshot: 'off' });
    expect(captures()).toEqual([]);
    expect(offNotes(pkgOf(res))).toEqual([SCREENSHOT_NOTES.offFrames(3)]);
  });

  it('reason frameCheckFailed → offCheckFailed (AC-3.9)', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB, includeScreenshot: false, screenshotOffReason: 'frameCheckFailed' });
    expect(offNotes(pkgOf(res))).toEqual([SCREENSHOT_NOTES.offCheckFailed]);
  });

  it.each([
    ['missing', {}],
    ['unknown', { screenshotOffReason: 'admin' }],
    ['not a string', { screenshotOffReason: { toString: () => 'frames' } }],
    ['frames without count', { screenshotOffReason: 'frames' }],
  ])('%s reason → off note (AC-3.9)', async (_label, over) => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB, includeScreenshot: false, ...over });
    expect(offNotes(pkgOf(res))).toEqual([SCREENSHOT_NOTES.off]);
  });

  it.each([0, -1, 1000, 2.5, '3', NaN, Infinity])('crossOriginFrames %s outside 1..999 ignored', async (crossOriginFrames) => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB, includeScreenshot: false, screenshotOffReason: 'frames', crossOriginFrames });
    const notes = offNotes(pkgOf(res));
    expect(notes).toEqual([SCREENSHOT_NOTES.off]);
    expect(notes.join(' ')).not.toMatch(/frame/);
  });

  it('a reason with includeScreenshot true is ignored: the screenshot is taken', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB, includeScreenshot: true, screenshotOffReason: 'frames', crossOriginFrames: 2 });
    const pkg = pkgOf(res);
    expect(pkg.screenshots).toHaveLength(1);
    expect(offNotes(pkg)).toEqual([]);
  });

  it('includeScreenshot missing → treated as true (the checkbox default)', async () => {
    await setup();
    await env.handlers.collect({ tabId: TAB });
    expect(captures()).toHaveLength(1);
  });

  it.each([
    ['no receiver (page without bridge)', async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    }, 'the page did not answer'],
    ['ok: false from ISOLATED', async () => ({ ok: false, reason: 'exception: TypeError' }), 'exception: TypeError'],
    ['malformed answer', async () => ({ ok: true, rects: 'x' }), 'invalid answer'],
    ['undefined answer', async () => undefined, 'invalid answer'],
  ])('fieldRects fails (%s) → saved without screenshot, note with reason, no capture (AC-2.4)', async (_label, handler, reason) => {
    await setup();
    env.fake.fieldRects = handler;
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    expect(captures()).toEqual([]);
    const { pkg, names } = readZip(res.zipBase64);
    expect(names).not.toContain('screenshot.jpg');
    expect(pkg.screenshots).toEqual([]);
    expect(shotNotes(pkg)).toEqual([`No screenshot: form fields could not be hidden (${reason}).`]);
    expect(pkg.dom).toMatchObject({ title: 'b' });
  });

  it('fieldRects hangs → after 1 s no screenshot with note; save goes on (AC-2.4)', async () => {
    await setup();
    env.fake.fieldRects = () => new Promise(() => {});
    const promise = env.handlers.collect({ tabId: TAB });
    await vi.advanceTimersByTimeAsync(FIELD_RECTS_TIMEOUT_MS);
    const res = await promise;
    expect(res.ok).toBe(true);
    expect(captures()).toEqual([]);
    expect(shotNotes(pkgOf(res))).toEqual(['No screenshot: form fields could not be hidden (the page did not answer).']);
  });

  it('second fieldRects fails → the captured image is dropped, never saved unmasked (AC-2.4)', async () => {
    await setup();
    const answers = [fieldRectsAnswer(), { ok: false, reason: 'no-viewport' }];
    env.fake.fieldRects = async () => answers.shift();
    const res = await env.handlers.collect({ tabId: TAB });
    expect(captures()).toHaveLength(1);
    const { pkg, names } = readZip(res.zipBase64);
    expect(names).not.toContain('screenshot.jpg');
    expect(shotNotes(pkg)).toEqual(['No screenshot: form fields could not be hidden (no-viewport).']);
    expect(env.codec.masks).toEqual([]);
  });

  it.each([
    ['no codec', null],
    ['codec without mask (E2 codec)', createFakeCodec({ withMask: false })],
  ])('fields in view and %s → no image, note (AC-2.4)', async (_label, codec) => {
    await setup({ codec });
    const res = await env.handlers.collect({ tabId: TAB });
    const { pkg, names } = readZip(res.zipBase64);
    expect(names).not.toContain('screenshot.jpg');
    expect(shotNotes(pkg)).toEqual(['No screenshot: form fields could not be hidden (the image could not be masked).']);
  });

  it('codec.mask throws → no image, note; never the unmasked capture (AC-2.4)', async () => {
    const codec = createFakeCodec();
    codec.mask = async () => {
      throw new Error('boom');
    };
    await setup({ codec });
    const res = await env.handlers.collect({ tabId: TAB });
    expect(readZip(res.zipBase64).names).not.toContain('screenshot.jpg');
    expect(shotNotes(pkgOf(res))).toEqual(['No screenshot: form fields could not be hidden (the image could not be masked).']);
  });

  it('pinch-zoomed page (vvScale ≠ 1) → no capture, note "page is zoomed in" (spike S0)', async () => {
    await setup();
    env.fake.fieldRects = async () => fieldRectsAnswer({ viewport: { vvScale: 1.5 } });
    const res = await env.handlers.collect({ tabId: TAB });
    expect(captures()).toEqual([]);
    expect(shotNotes(pkgOf(res))).toEqual(['No screenshot: form fields could not be hidden (page is zoomed in).']);
  });

  it('scroll changed between R1 and R2 → one retry; stable on the retry → masked image', async () => {
    await setup();
    const answers = [
      fieldRectsAnswer({ viewport: { scrollY: 0 } }),
      fieldRectsAnswer({ viewport: { scrollY: 120 } }),
      fieldRectsAnswer({ viewport: { scrollY: 120 } }),
    ];
    env.fake.fieldRects = async () => answers.shift();
    const res = await env.handlers.collect({ tabId: TAB });
    expect(captures()).toHaveLength(2);
    expect(sent('fieldRects')).toHaveLength(3);
    expect(pkgOf(res).screenshots).toHaveLength(1);
  });

  it('scroll changed between R1 and R2 twice → note "page moved", no image', async () => {
    await setup();
    let y = 0;
    env.fake.fieldRects = async () => fieldRectsAnswer({ viewport: { scrollY: (y += 50) } });
    const res = await env.handlers.collect({ tabId: TAB });
    expect(captures()).toHaveLength(2);
    const { pkg, names } = readZip(res.zipBase64);
    expect(names).not.toContain('screenshot.jpg');
    expect(shotNotes(pkg)).toEqual(['No screenshot: the page moved while the screenshot was taken.']);
    expect(env.codec.masks).toEqual([]);
  });

  it('no fields in view → image without mask (nothing to hide), maskedFields 0', async () => {
    await setup();
    env.fake.fieldRects = async () => fieldRectsAnswer({ rects: [] });
    const res = await env.handlers.collect({ tabId: TAB });
    expect(env.codec.masks).toEqual([]);
    const { pkg, files } = readZip(res.zipBase64);
    expect(pkg.screenshots[0]).toMatchObject({ maskedFields: 0, width: 1280, height: 720 });
    expect(files['screenshot.jpg'].length).toBe(pkg.screenshots[0].bytes);
  });

  it('more than 2000 fields (overflow) → whole view masked, note', async () => {
    await setup();
    env.fake.fieldRects = async () => fieldRectsAnswer({ rects: [{ x: 0, y: 0, w: 1280, h: 720 }], overflow: true });
    const res = await env.handlers.collect({ tabId: TAB });
    expect(env.codec.masks[0].rects).toEqual([{ x: 0, y: 0, w: 1280, h: 720 }]);
    const pkg = pkgOf(res);
    expect(pkg.screenshots).toHaveLength(1);
    expect(pkg.notes).toContain('More than 2000 form fields: the whole screenshot is covered.');
  });

  it('cross-origin frames out of view give no note; frames are never masked (gate decision PB-1 = B)', async () => {
    await setup();
    env.fake.fieldRects = async () => fieldRectsAnswer({ frames: { sameOrigin: 0, crossOrigin: 3, crossOriginVisible: 0 } });
    const pkg = pkgOf(await env.handlers.collect({ tabId: TAB }));
    expect(pkg.screenshots).toHaveLength(1);
    expect(pkg.notes.some((n) => /frame/i.test(n))).toBe(false);
  });

  // E4 D8 (IN11, AC-3.10): the image is kept, the note says how many frames of other sites it shows.
  it('screenshot included and fieldRects crossOriginVisible 2 → note framesVisible(2); 0 → no note (AC-3.10)', async () => {
    await setup();
    env.fake.fieldRects = async () => fieldRectsAnswer({ frames: { sameOrigin: 0, crossOrigin: 2, crossOriginVisible: 2 } });
    const pkg = pkgOf(await env.handlers.collect({ tabId: TAB }));
    expect(pkg.screenshots).toHaveLength(1);
    expect(pkg.notes).toContain(SCREENSHOT_NOTES.framesVisible(2));
    expect(pkg.notes.filter((n) => /frame/i.test(n))).toHaveLength(1);
  });

  it('frames note uses max(R1, R2) crossOriginVisible, capped at 999', async () => {
    await setup();
    const answers = [
      fieldRectsAnswer({ frames: { sameOrigin: 0, crossOrigin: 1, crossOriginVisible: 1 } }),
      fieldRectsAnswer({ frames: { sameOrigin: 0, crossOrigin: 3, crossOriginVisible: 3 } }),
    ];
    env.fake.fieldRects = async () => answers.shift();
    expect(pkgOf(await env.handlers.collect({ tabId: TAB })).notes).toContain(SCREENSHOT_NOTES.framesVisible(3));

    await setup();
    env.fake.fieldRects = async () => fieldRectsAnswer({ frames: { sameOrigin: 0, crossOrigin: 5000, crossOriginVisible: 5000 } });
    expect(pkgOf(await env.handlers.collect({ tabId: TAB })).notes).toContain(SCREENSHOT_NOTES.framesVisible(999));
  });

  it('malformed frames in fieldRects → no frames note, screenshot kept', async () => {
    await setup();
    env.fake.fieldRects = async () => fieldRectsAnswer({ frames: { crossOriginVisible: 'many' } });
    const pkg = pkgOf(await env.handlers.collect({ tabId: TAB }));
    expect(pkg.screenshots).toHaveLength(1);
    expect(pkg.notes.some((n) => /frame/i.test(n))).toBe(false);
  });

  it.each([
    ['another site', 'http://localhost:3000/'],
    ['a special page', 'chrome://version/'],
  ])('tab on %s → no capture call, note (AC-6.3)', async (_label, url) => {
    await setup({ url });
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    expect(captures()).toEqual([]);
    expect(sent('fieldRects')).toEqual([]);
    const pkg = pkgOf(res);
    expect(pkg.screenshots).toEqual([]);
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
    const { pkg, json, names } = readZip(res.zipBase64);
    expect(pkg.screenshots).toEqual([]);
    expect(names).not.toContain('screenshot.jpg');
    expect(json).not.toContain('data:image/jpeg');
    expect(shotNotes(pkg)).toEqual(['No screenshot: the tab showed a page outside the recorded site.']);
    // The page is no longer ours: nothing is asked of it after the capture.
    expect(sent('fieldRects')).toHaveLength(1);
    expect(sent('collect')).toEqual([]);
  });

  it('captureVisibleTab throws → package saved, screenshots [], note; result ok (AC-6.4)', async () => {
    await setup();
    env.fake.captureVisibleTab = env.fake.captureThrows;
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    const pkg = pkgOf(res);
    expect(pkg.screenshots).toEqual([]);
    expect(shotNotes(pkg)).toEqual(['No screenshot: capture failed (capture-failed).']);
    // The page was still collected and the download can go on.
    expect(pkg.dom).toMatchObject({ title: 'b' });
    expect((await rec()).save.phase).toBe('collecting');
  });

  it('hanging capture → timeout after 3 s, save goes on within the collect limit (AC-6.4, AC-1.x)', async () => {
    await setup();
    env.fake.captureVisibleTab = () => new Promise(() => {});
    const promise = env.handlers.collect({ tabId: TAB });
    await vi.advanceTimersByTimeAsync(3000);
    const res = await promise;
    expect(res.ok).toBe(true);
    expect(shotNotes(pkgOf(res))).toEqual(['No screenshot: capture failed (timeout).']);
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

  it('fieldRects time counts towards the 15 s collect limit', async () => {
    await setup({ answer: () => new Promise(() => {}) });
    env.fake.fieldRects = () => new Promise(() => {});
    const promise = env.handlers.collect({ tabId: TAB });
    let settled = null;
    promise.then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(COLLECT_TIMEOUT_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(settled).toEqual({ ok: false, reason: 'pageBusy' });
  });

  it('image that cannot be made small enough → too-large note', async () => {
    await setup({ codec: null });
    env.fake.fieldRects = async () => fieldRectsAnswer({ rects: [] });
    // Over 300 KB, nothing to mask and no codec to shrink it.
    env.fake.captureVisibleTab = async () => jpegDataUrl(3840, 2160, 400_000);
    const pkg = pkgOf(await env.handlers.collect({ tabId: TAB }));
    expect(pkg.screenshots).toEqual([]);
    expect(shotNotes(pkg)).toEqual(['No screenshot: the image could not be made smaller than 300 KB.']);
  });

  it('injected codec is used to fit a large image', async () => {
    await setup();
    env.fake.fieldRects = async () => fieldRectsAnswer({ rects: [], viewport: { innerWidth: 1920, innerHeight: 1080 } });
    env.fake.captureVisibleTab = async () => jpegDataUrl(3840, 2160, 400_000);
    env.handlers = createSaveHandlers({ store: env.store, ...env.chrome, codec: createFakeCodec({ width: 3840, height: 2160, withMask: false }) });
    const res = await env.handlers.collect({ tabId: TAB });
    const pkg = pkgOf(res);
    expect(pkg.screenshots[0]).toMatchObject({ width: 3840, height: 2160 });
    expect(pkg.screenshots[0].bytes).toBeLessThan(300_000);
  });

  it('inactive tab → no screenshot, note', async () => {
    await setup({ active: false });
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    expect(captures()).toEqual([]);
    expect(sent('fieldRects')).toEqual([]);
    const pkg = pkgOf(res);
    expect(pkg.screenshots).toEqual([]);
    expect(shotNotes(pkg)).toEqual(['No screenshot: the tab was not visible.']);
    // The page itself is still collected.
    expect(pkg.dom).toMatchObject({ title: 'b' });
  });

  it('tab closed → no capture call, package saved', async () => {
    await setup();
    env.fake.removeTab(TAB);
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.ok).toBe(true);
    expect(captures()).toEqual([]);
    expect(pkgOf(res).screenshots).toEqual([]);
  });
});

describe('zip and privacy (E3 D7, D8)', () => {
  // A page answer with traps in storage, cookies, network and console (AC-3.5 at unit level).
  const trapResult = () =>
    resultOf({
      storage: { localStorage: { authToken: JWT, note: `mail ${EMAIL}` }, sessionStorage: {}, cookies: `sid=${COOKIE_SID}; theme=dark` },
      consoleLogs: [{ t: 3, level: 'error', args: [`login failed password=${PASSWORD} access_token=${TOKEN}`] }],
      network: [
        {
          t: 4, type: 'fetch', method: 'POST', url: `https://example.com/api?access_token=${TOKEN}`, status: 500, ok: false,
          requestHeaders: { authorization: `Bearer ${JWT}` }, requestBody: JSON.stringify({ email: EMAIL, password: PASSWORD }), error: null,
        },
      ],
    });
  const TRAPS = [JWT, TOKEN, EMAIL, PASSWORD, COOKIE_SID];

  it('zipBase64 decodes to a zip with snapshot.json first; fileName snapshot-<host>-<local time>.zip (AC-1.1, 6.4)', async () => {
    await setup();
    const res = await env.handlers.collect({ tabId: TAB });
    expect(res.fileName).toMatch(/^snapshot-example\.com-\d{8}-\d{6}\.zip$/);
    expect(res.fileName).toBe(FILE_NAME());
    const bytes = Uint8Array.from(atob(res.zipBase64), (c) => c.charCodeAt(0));
    expect(res.packageBytes).toBe(bytes.length);
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(readZip(res.zipBase64).names[0]).toBe('snapshot.json');
  });

  it('trap values from the page are redacted in every zip entry', async () => {
    await setup({ answer: async (_t, m) => (m.type === 'collect' ? trapResult() : undefined) });
    const res = await env.handlers.collect({ tabId: TAB, includeScreenshot: false });
    const { files } = readZip(res.zipBase64);
    for (const [name, data] of Object.entries(files)) {
      const text = new TextDecoder().decode(data);
      for (const trap of TRAPS) expect(text.includes(trap), `${trap} in ${name}`).toBe(false);
    }
  });

  it('storage.session dump: nothing of the package after collect, 0 trap values after a successful save (NFR privacy)', async () => {
    await setup({ answer: async (_t, m) => (m.type === 'collect' ? trapResult() : undefined) });
    const res = await env.handlers.collect({ tabId: TAB });
    const dump = () => JSON.stringify([...env.fake.sessionData.entries()]);
    for (const trap of TRAPS) expect(dump().includes(trap), trap).toBe(false);
    expect(dump()).not.toContain(res.zipBase64.slice(0, 64));
    expect((await rec()).save).toEqual({ phase: 'collecting', startedAt: T0 + 60_000, downloadId: null, fileName: res.fileName });
    const id = await popupDownload(res.fileName);
    env.fake.completeDownload(id);
    await env.settle();
    for (const trap of TRAPS) expect(dump().includes(trap), trap).toBe(false);
    expect([...env.fake.sessionData.keys()].some((k) => k.startsWith(KEYS.docPrefix))).toBe(false);
  });

  it('getDevOptions with html-structure → collect asks MAIN for full HTML; default asks without options', async () => {
    await setup({ getDevOptions: async () => ({ disabledRules: ['html-structure'] }) });
    const res = await env.handlers.collect({ tabId: TAB, includeScreenshot: false });
    expect(env.calls.filter((c) => c.name === 'tabs.sendMessage' && c.args[1].type === 'collect').map((c) => c.args[1])).toEqual([
      { type: 'collect', options: { fullHtml: true } },
    ]);
    const pkg = pkgOf(res);
    expect(pkg.redaction.disabledRules).toEqual(['html-structure']);
    expect(pkg.limits.packageBytes).toBe(10485760);
  });

  it('getDevOptions is read once per collect: fullHtml and the redaction use the same answer (E4-D4d)', async () => {
    const answers = [{ disabledRules: ['html-structure', 'email'] }, { disabledRules: [] }];
    let reads = 0;
    await setup({ getDevOptions: async () => answers[reads++] });
    const res = await env.handlers.collect({ tabId: TAB, includeScreenshot: false });
    expect(reads).toBe(1);
    const sent = env.calls.filter((c) => c.name === 'tabs.sendMessage' && c.args[1].type === 'collect').map((c) => c.args[1]);
    expect(sent).toEqual([{ type: 'collect', options: { fullHtml: true } }]);
    expect(pkgOf(res).redaction.disabledRules).toEqual(['email', 'html-structure']);
  });

  it.each([
    ['rejects', async () => { throw new Error('Managed storage manifest not found'); }],
    ['returns garbage', async () => 'nope'],
  ])('getDevOptions %s → default rules, save succeeds (AC-6.3)', async (_name, getDevOptions) => {
    await setup({ getDevOptions });
    const res = await env.handlers.collect({ tabId: TAB, includeScreenshot: false });
    expect(res.ok).toBe(true);
    expect(pkgOf(res).redaction.disabledRules).toEqual([]);
    const sent = env.calls.filter((c) => c.name === 'tabs.sendMessage' && c.args[1].type === 'collect').map((c) => c.args[1]);
    expect(sent).toEqual([{ type: 'collect' }]);
  });

  it('export failure → failed, attempt cleared (never a half-written package)', async () => {
    await setup();
    const exportAssembled = async () => {
      throw new Error('out of memory');
    };
    env.handlers = createSaveHandlers({ store: env.store, ...env.chrome, codec: env.codec, exportAssembled });
    expect(await env.handlers.collect({ tabId: TAB })).toEqual({ ok: false, reason: 'failed' });
    expect((await rec()).save).toBeNull();
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
      expect(pkgOf(second).consoleLogs).toEqual(pkgOf(first).consoleLogs);
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

describe('frameCheck: cross-origin frames for the screenshot default (store review S1)', () => {
  const asked = () => env.calls.filter((c) => c.name === 'tabs.sendMessage' && c.args[1]?.type === 'fieldRects');

  it('answers the number of cross-origin frames from ISOLATED fieldRects (top frame only)', async () => {
    await setup();
    env.fake.fieldRects = async () => fieldRectsAnswer({ frames: { sameOrigin: 1, crossOrigin: 2 } });
    expect(await env.handlers.frameCheck({ tabId: TAB })).toEqual({ ok: true, crossOriginFrames: 2 });
    expect(asked()).toHaveLength(1);
    expect(asked()[0].args[2]).toEqual({ frameId: 0 });
    env.fake.fieldRects = async () => fieldRectsAnswer();
    expect(await env.handlers.frameCheck({ tabId: TAB })).toEqual({ ok: true, crossOriginFrames: 0 });
    // Nothing of the recording changes: no save attempt, no capture.
    expect((await rec()).save).toBeNull();
    expect(env.calls.filter((c) => c.name === 'tabs.captureVisibleTab')).toEqual([]);
  });

  it('counts only visible cross-origin frames when ISOLATED reports them; older answers fall back to all', async () => {
    await setup();
    env.fake.fieldRects = async () => fieldRectsAnswer({ frames: { sameOrigin: 0, crossOrigin: 4, crossOriginVisible: 0 } });
    expect(await env.handlers.frameCheck({ tabId: TAB })).toEqual({ ok: true, crossOriginFrames: 0 });
    env.fake.fieldRects = async () => fieldRectsAnswer({ frames: { sameOrigin: 0, crossOrigin: 4, crossOriginVisible: 1 } });
    expect(await env.handlers.frameCheck({ tabId: TAB })).toEqual({ ok: true, crossOriginFrames: 1 });
    env.fake.fieldRects = async () => fieldRectsAnswer({ frames: { sameOrigin: 0, crossOrigin: 4, crossOriginVisible: -1 } });
    expect(await env.handlers.frameCheck({ tabId: TAB })).toEqual({ ok: false });
  });

  it('works while stopped by the time limit too', async () => {
    await setup({ rec: { ...REC, status: 'stopped', stopReason: 'time-limit' } });
    env.fake.fieldRects = async () => fieldRectsAnswer({ frames: { sameOrigin: 0, crossOrigin: 1 } });
    expect(await env.handlers.frameCheck({ tabId: TAB })).toEqual({ ok: true, crossOriginFrames: 1 });
  });

  it('{ ok: false } without asking the page: other tab, no recording, tab on another site', async () => {
    await setup();
    expect(await env.handlers.frameCheck({ tabId: TAB + 1 })).toEqual({ ok: false });
    expect(await env.handlers.frameCheck({})).toEqual({ ok: false });
    await setup({ url: 'https://other.example.org/' });
    expect(await env.handlers.frameCheck({ tabId: TAB })).toEqual({ ok: false });
    await setup({ rec: null });
    expect(await env.handlers.frameCheck({ tabId: TAB })).toEqual({ ok: false });
    expect(asked()).toEqual([]);
  });

  it.each([
    ['throws (no bridge)', async () => { throw new Error('Receiving end does not exist.'); }],
    ['ok: false', async () => ({ ok: false, reason: 'no-viewport' })],
    ['no frames', async () => ({ ...fieldRectsAnswer(), frames: undefined })],
    ['negative count', async () => fieldRectsAnswer({ frames: { sameOrigin: 0, crossOrigin: -1 } })],
    ['string count', async () => fieldRectsAnswer({ frames: { sameOrigin: 0, crossOrigin: '3' } })],
    ['undefined', async () => undefined],
  ])('{ ok: false } when fieldRects %s', async (_name, handler) => {
    await setup();
    env.fake.fieldRects = handler;
    expect(await env.handlers.frameCheck({ tabId: TAB })).toEqual({ ok: false });
  });

  it('{ ok: false } after 1 s without an answer', async () => {
    await setup();
    env.fake.fieldRects = () => new Promise(() => {});
    const promise = env.handlers.frameCheck({ tabId: TAB });
    await vi.advanceTimersByTimeAsync(FIELD_RECTS_TIMEOUT_MS);
    expect(await promise).toEqual({ ok: false });
  });
});

describe('collect answer says whether the screenshot is in the file (QA F-5)', () => {
  it("screenshot: 'included' | 'off' | 'failed'", async () => {
    await setup();
    expect((await env.handlers.collect({ tabId: TAB })).screenshot).toBe('included');
    await setup();
    expect((await env.handlers.collect({ tabId: TAB, includeScreenshot: false })).screenshot).toBe('off');
    await setup();
    env.fake.fieldRects = async () => ({ ok: false, reason: 'no-viewport' });
    const failed = await env.handlers.collect({ tabId: TAB });
    expect(failed.ok).toBe(true);
    expect(failed.screenshot).toBe('failed');
    await setup({ active: false });
    expect((await env.handlers.collect({ tabId: TAB })).screenshot).toBe('failed');
  });
});
