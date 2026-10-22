import { describe, it, expect } from 'vitest';
import { SCRIPT_IDS, scriptsFor, registerFor, unregisterAll, setBadge } from '../../src/lib/content-scripts.js';
import { createFakeChrome } from './helpers/fake-chrome.js';

const PATTERN = 'http://127.0.0.1/*';

describe('scriptsFor', () => {
  it('scriptsFor: MAIN and ISOLATED, document_start, allFrames false, persistAcrossSessions false, js root-relative (AC-6.2)', () => {
    const scripts = scriptsFor(PATTERN);
    expect(scripts.map((s) => s.world).sort()).toEqual(['ISOLATED', 'MAIN']);
    const bridge = scripts.find((s) => s.world === 'ISOLATED');
    const recorder = scripts.find((s) => s.world === 'MAIN');
    expect(bridge.id).toBe(SCRIPT_IDS.bridge);
    expect(recorder.id).toBe(SCRIPT_IDS.recorder);
    expect(bridge.js).toEqual(['/content/isolated-world.js']);
    expect(recorder.js).toEqual(['/content/main-world.js']);
    for (const s of scripts) {
      expect(s.matches).toEqual([PATTERN]);
      expect(s.runAt).toBe('document_start');
      expect(s.allFrames).toBe(false);
      expect(s.persistAcrossSessions).toBe(false);
    }
  });
});

describe('registerFor / unregisterAll', () => {
  it('registers both scripts and replaces an earlier registration', async () => {
    const { chrome, fake } = createFakeChrome();
    await registerFor(chrome.scripting, PATTERN);
    await registerFor(chrome.scripting, 'https://example.com/*');
    expect([...fake.registered.keys()].sort()).toEqual([SCRIPT_IDS.bridge, SCRIPT_IDS.recorder].sort());
    expect(fake.registered.get(SCRIPT_IDS.recorder).matches).toEqual(['https://example.com/*']);
  });

  it('unregisterAll ignores missing scripts and leaves foreign ones', async () => {
    const { chrome, fake } = createFakeChrome();
    await unregisterAll(chrome.scripting);
    await chrome.scripting.registerContentScripts([{ id: 'other', matches: [PATTERN], js: ['/x.js'] }]);
    await registerFor(chrome.scripting, PATTERN);
    await unregisterAll(chrome.scripting);
    expect([...fake.registered.keys()]).toEqual(['other']);
  });
});

describe('setBadge', () => {
  it.each([
    ['recording', '●'],
    ['stopped', '■'],
    ['none', ''],
  ])('%s → %s', async (kind, text) => {
    const { chrome, fake } = createFakeChrome();
    await setBadge(chrome.action, 7, kind);
    expect(fake.badges.get(7).text).toBe(text);
  });

  it('does not throw when the tab is gone', async () => {
    const action = { setBadgeText: async () => Promise.reject(new Error('No tab')), setBadgeBackgroundColor: async () => {} };
    await expect(setBadge(action, 1, 'recording')).resolves.toBeUndefined();
  });
});
