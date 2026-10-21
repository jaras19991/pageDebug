import { describe, it, expect, vi } from 'vitest';
import {
  classifyUrl,
  mapInjectionError,
  isFirefoxRuntime,
  isFileAccessAllowed,
} from '../../src/popup/target.js';

describe('classifyUrl', () => {
  it.each([
    // Browser-internal and extension pages (AC-1.3).
    ['chrome://version', 'restricted'],
    ['chrome://extensions/', 'restricted'],
    ['chrome-extension://abcdef/popup.html', 'restricted'],
    ['chrome-search://local-ntp/local-ntp.html', 'restricted'],
    ['devtools://devtools/bundled/inspector.html', 'restricted'],
    ['edge://settings', 'restricted'],
    ['about:addons', 'restricted'],
    ['about:blank', 'restricted'],
    ['moz-extension://x/', 'restricted'],
    ['resource://gre/modules/x.js', 'restricted'],
    ['view-source:http://a', 'restricted'],
    ['data:text/html,<p>x</p>', 'restricted'],
    ['javascript:void(0)', 'restricted'],
    // Extension stores.
    ['https://chromewebstore.google.com/detail/x', 'restricted'],
    ['https://chrome.google.com/webstore/x', 'restricted'],
    ['https://chrome.google.com/webstore', 'restricted'],
    ['https://addons.mozilla.org/pl/firefox/', 'restricted'],
    ['https://microsoftedge.microsoft.com/addons/detail/x', 'restricted'],
    // Local files (AC-1.6).
    ['file:///C:/a.html', 'file'],
    ['file:///C:/x.html', 'file'],
    ['file:///home/u/a.html', 'file'],
    // Ordinary pages.
    ['http://127.0.0.1:1234/basic.html', 'web'],
    ['http://127.0.0.1:3000/', 'web'],
    ['https://example.com', 'web'],
    ['HTTPS://EXAMPLE.COM/a', 'web'],
    ['https://chrome.google.com/search', 'web'],
    ['https://google.com/webstore', 'web'],
    ['https://microsoftedge.microsoft.com/', 'web'],
    // No URL known (tab without activeTab grant).
    [undefined, 'unknown'],
    [null, 'unknown'],
    ['', 'unknown'],
  ])('%s → %s', (url, expected) => {
    expect(classifyUrl(url)).toBe(expected);
  });

  it('treats an unparseable non-empty URL as restricted, never as web', () => {
    expect(classifyUrl('not a url')).toBe('restricted');
  });
});

describe('mapInjectionError', () => {
  const web = 'https://example.com/';
  const file = 'file:///C:/a.html';

  it.each([
    ['Cannot access a chrome:// URL', web, false, 'restricted'],
    ['Cannot access a chrome-extension:// URL of different extension', web, false, 'restricted'],
    ['The extensions gallery cannot be scripted.', web, false, 'restricted'],
    ['Missing host permission for the tab', web, false, 'restricted'],
    ['Missing host permission for the tab or frames', web, true, 'restricted'],
    [
      'Cannot access contents of url "https://example.com/". Extension manifest must request permission to access this host.',
      web,
      false,
      'restricted',
    ],
    [
      'Cannot access contents of url "file:///C:/a.html". Extension manifest must request permission to access this host.',
      file,
      false,
      'fileAccess',
    ],
    [
      'Cannot access contents of url "file:///C:/a.html". Extension manifest must request permission to access this host.',
      file,
      true,
      'restricted',
    ],
    ['Missing host permission for the tab or frames', file, true, 'restricted'],
    ['Missing host permission for the tab', file, false, 'fileAccess'],
    ['boom', web, false, 'failed'],
    ['boom', file, false, 'failed'],
  ])('%s (url %s, firefox %s) → %s', (message, url, isFirefox, expected) => {
    expect(mapInjectionError(new Error(message), url, { isFirefox })).toBe(expected);
  });

  it('maps undefined error to failed', () => {
    expect(mapInjectionError(undefined, web)).toBe('failed');
  });

  it('accepts a plain string error', () => {
    expect(mapInjectionError('Cannot access a chrome:// URL')).toBe('restricted');
  });

  it('defaults to Chrome behaviour without options', () => {
    expect(mapInjectionError(new Error('Missing host permission for the tab'), file)).toBe('fileAccess');
  });
});

describe('isFirefoxRuntime', () => {
  it('detects Firefox by runtime.getBrowserInfo', () => {
    expect(isFirefoxRuntime({ runtime: { getBrowserInfo: async () => ({ name: 'Firefox' }) } })).toBe(true);
  });

  it('is false for Chrome-like API and missing API', () => {
    expect(isFirefoxRuntime({ runtime: { id: 'x' } })).toBe(false);
    expect(isFirefoxRuntime({})).toBe(false);
    expect(isFirefoxRuntime(undefined)).toBe(false);
  });
});

describe('isFileAccessAllowed', () => {
  it('returns the Chrome probe result', async () => {
    const probe = vi.fn(async () => false);
    await expect(isFileAccessAllowed({ extension: { isAllowedFileSchemeAccess: probe } })).resolves.toBe(false);
    expect(probe).toHaveBeenCalledOnce();
    await expect(
      isFileAccessAllowed({ extension: { isAllowedFileSchemeAccess: async () => true } }),
    ).resolves.toBe(true);
  });

  it('returns null when the probe does not exist (Firefox)', async () => {
    await expect(isFileAccessAllowed({ runtime: { getBrowserInfo: async () => ({}) } })).resolves.toBe(null);
    await expect(isFileAccessAllowed(undefined)).resolves.toBe(null);
  });

  it('returns null when the probe throws', async () => {
    const api = { extension: { isAllowedFileSchemeAccess: async () => { throw new Error('x'); } } };
    await expect(isFileAccessAllowed(api)).resolves.toBe(null);
  });
});
