import { describe, it, expect, vi } from 'vitest';
import { snapshotTab } from '../../src/popup/snapshot-tab.js';
import { runInPage } from '../../src/popup/run-in-page.js';

const WEB_TAB = { id: 7, url: 'https://example.com/page' };
const SUCCESS = { ok: true, fileName: 'page-debug-snapshot-1.json' };
const NOT_LOADED = { ok: false, reason: 'not-loaded' };

// Fake chrome.scripting: records calls; `func` calls take the next queued result,
// `files` calls resolve to [] unless told otherwise.
function fakeApi({ funcResults = [SUCCESS], reject, fileAccess = true, isFirefox = false } = {}) {
  const calls = [];
  const queue = [...funcResults];
  const executeScript = vi.fn(async (details) => {
    calls.push(details);
    if (reject) throw reject;
    if (details.files) return [{ result: undefined }];
    const next = queue.length ? queue.shift() : NOT_LOADED;
    return next === 'empty' ? [] : [{ result: next }];
  });
  return {
    calls,
    api: {
      scripting: { executeScript },
      isAllowedFileSchemeAccess: vi.fn(async () => fileAccess),
      isFirefox,
    },
  };
}

describe('snapshotTab', () => {
  it('returns noTab without tab id', async () => {
    const { api, calls } = fakeApi();
    expect(await snapshotTab(undefined, api)).toEqual({ kind: 'noTab' });
    expect(await snapshotTab({ url: 'https://a.pl' }, api)).toEqual({ kind: 'noTab' });
    expect(calls).toHaveLength(0);
  });

  it.each(['chrome://extensions/', 'https://chromewebstore.google.com/detail/x', 'about:blank'])(
    'returns restricted for %s without calling executeScript',
    async (url) => {
      const { api, calls } = fakeApi();
      expect(await snapshotTab({ id: 1, url }, api)).toEqual({ kind: 'restricted' });
      expect(calls).toHaveLength(0);
    },
  );

  it('returns fileAccess when file scheme access disallowed in Chrome, without executeScript', async () => {
    const { api, calls } = fakeApi({ fileAccess: false });
    expect(await snapshotTab({ id: 1, url: 'file:///C:/a.html' }, api)).toEqual({ kind: 'fileAccess' });
    expect(calls).toHaveLength(0);
  });

  it('tries injection on file:// when access is allowed or the probe is unavailable', async () => {
    for (const fileAccess of [true, null]) {
      const { api, calls } = fakeApi({ fileAccess });
      expect(await snapshotTab({ id: 1, url: 'file:///C:/a.html' }, api)).toEqual({
        kind: 'success',
        fileName: SUCCESS.fileName,
      });
      expect(calls).toHaveLength(1);
    }
  });

  it('skips file access probe in Firefox', async () => {
    const { api } = fakeApi({ isFirefox: true });
    await snapshotTab({ id: 1, url: 'file:///home/a.html' }, api);
    expect(api.isAllowedFileSchemeAccess).not.toHaveBeenCalled();
  });

  it('every executeScript call uses world MAIN and target.tabId', async () => {
    const { api, calls } = fakeApi({ funcResults: [NOT_LOADED, SUCCESS] });
    await snapshotTab(WEB_TAB, api);
    expect(calls).toHaveLength(3);
    for (const details of calls) {
      expect(details.world).toBe('MAIN');
      expect(details.target).toEqual({ tabId: 7 });
    }
  });

  it('injects page script only when runInPage reports not-loaded', async () => {
    const { api, calls } = fakeApi({ funcResults: [NOT_LOADED, SUCCESS] });
    const outcome = await snapshotTab(WEB_TAB, api);
    expect(calls.map((c) => (c.func ? 'func' : c.files))).toEqual(['func', ['/page/page-debug-snapshot.js'], 'func']);
    expect(calls[0].func).toBe(runInPage);
    expect(calls[2].func).toBe(runInPage);
    expect(outcome).toEqual({ kind: 'success', fileName: SUCCESS.fileName });
  });

  // Firefox resolves `files` against the calling document (popup/), Chrome against the
  // extension root; a leading '/' means the extension root in both (QA E0 F1).
  it('every files path is absolute from the extension root', async () => {
    const { api, calls } = fakeApi({ funcResults: [NOT_LOADED, SUCCESS] });
    await snapshotTab(WEB_TAB, api);
    const files = calls.flatMap((c) => c.files ?? []);
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) expect(path).toMatch(/^\/[^/]/);
  });

  it('second snapshot on same tab does not inject files again', async () => {
    const { api, calls } = fakeApi({ funcResults: [NOT_LOADED, SUCCESS, SUCCESS] });
    await snapshotTab(WEB_TAB, api);
    calls.length = 0;
    expect(await snapshotTab(WEB_TAB, api)).toEqual({ kind: 'success', fileName: SUCCESS.fileName });
    expect(calls).toHaveLength(1);
    expect(calls[0].files).toBeUndefined();
  });

  it('treats unknown URL as worth trying', async () => {
    const { api, calls } = fakeApi();
    expect((await snapshotTab({ id: 3 }, api)).kind).toBe('success');
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['Cannot access a chrome:// URL', 'https://example.com', false, 'restricted'],
    ['Missing host permission for the tab', 'https://example.com', true, 'restricted'],
    ['Cannot access contents of url "file:///a.html"', 'file:///a.html', false, 'fileAccess'],
    ['Cannot access contents of url "file:///a.html"', 'file:///a.html', true, 'restricted'],
    ['Frame with ID 0 was removed.', 'https://example.com', false, 'failed'],
  ])('maps rejection via mapInjectionError: %s (firefox=%s)', async (message, url, isFirefox, kind) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api } = fakeApi({ reject: new Error(message), isFirefox, fileAccess: null });
    expect(await snapshotTab({ id: 1, url }, api)).toEqual({ kind });
    spy.mockRestore();
  });

  // Chrome without "Allow access to file URLs" hides tab.url for file:// (QA E0 F2).
  it.each([
    'Cannot access contents of url "file:///C:/a.html". Extension manifest must request permission to access this host.',
    'Cannot access contents of the page. Extension manifest must request permission to access the respective host.',
  ])('returns fileAccess for a tab without url when Chrome denies file access: %s', async (message) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api } = fakeApi({ reject: new Error(message), fileAccess: false });
    expect(await snapshotTab({ id: 1 }, api)).toEqual({ kind: 'fileAccess' });
    expect(api.isAllowedFileSchemeAccess).toHaveBeenCalled();
    spy.mockRestore();
  });

  it.each([
    ['chrome:// page, file access off', 'Cannot access a chrome:// URL', false, false],
    [
      'generic denial, file access on',
      'Cannot access contents of the page. Extension manifest must request permission to access the respective host.',
      true,
      false,
    ],
    ['generic denial in Firefox', 'Missing host permission for the tab', false, true],
  ])('keeps restricted for a tab without url: %s', async (_label, message, fileAccess, isFirefox) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api } = fakeApi({ reject: new Error(message), fileAccess, isFirefox });
    expect(await snapshotTab({ id: 1 }, api)).toEqual({ kind: 'restricted' });
    if (isFirefox) expect(api.isAllowedFileSchemeAccess).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns failed when files injection rejects with an unknown error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api } = fakeApi({ funcResults: [NOT_LOADED] });
    api.scripting.executeScript.mockImplementationOnce(async () => [{ result: NOT_LOADED }]);
    api.scripting.executeScript.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    expect(await snapshotTab(WEB_TAB, api)).toEqual({ kind: 'failed' });
    spy.mockRestore();
  });

  it.each([
    ['snapshot-failed', [{ ok: false, reason: 'snapshot-failed', errorName: 'TypeError' }]],
    ['missing result', ['empty']],
    ['second not-loaded', [NOT_LOADED, NOT_LOADED]],
    ['success without fileName', [{ ok: true }]],
  ])('returns failed on %s', async (_label, funcResults) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api } = fakeApi({ funcResults });
    expect(await snapshotTab(WEB_TAB, api)).toEqual({ kind: 'failed' });
    spy.mockRestore();
  });

  it('returns success with fileName', async () => {
    const { api, calls } = fakeApi();
    expect(await snapshotTab(WEB_TAB, api)).toEqual({ kind: 'success', fileName: SUCCESS.fileName });
    expect(calls).toHaveLength(1);
    expect(calls[0].allFrames).toBeUndefined();
  });
});
