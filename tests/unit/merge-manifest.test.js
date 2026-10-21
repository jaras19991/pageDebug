import { describe, it, expect } from 'vitest';
import { mergeManifest, TARGET_KEYS } from '../../scripts/lib/manifest.mjs';

const base = () => ({
  manifest_version: 3,
  name: 'Fixture',
  version: '1.0.0',
  permissions: ['activeTab', 'scripting'],
  action: { default_popup: 'popup/popup.html' },
});

describe('mergeManifest', () => {
  it('exports the closed list of target keys (D4)', () => {
    expect(TARGET_KEYS).toEqual(['browser_specific_settings', 'minimum_chrome_version', 'background']);
    expect(Object.isFrozen(TARGET_KEYS)).toBe(true);
  });

  it('mergeManifest appends overlay keys after base keys', () => {
    const overlay = {
      minimum_chrome_version: '121',
      browser_specific_settings: { gecko: { id: 'x@example.org', strict_min_version: '128.0' } },
    };
    const merged = mergeManifest(base(), overlay);
    expect(Object.keys(merged)).toEqual([
      'manifest_version', 'name', 'version', 'permissions', 'action',
      'minimum_chrome_version', 'browser_specific_settings',
    ]);
    expect(merged.browser_specific_settings.gecko.strict_min_version).toBe('128.0');
  });

  it('is deterministic and does not mutate or alias its inputs', () => {
    const b = base();
    const o = { background: { scripts: ['background.js'] } };
    const a1 = mergeManifest(b, o);
    const a2 = mergeManifest(base(), { background: { scripts: ['background.js'] } });
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
    expect(b).toEqual(base());
    a1.permissions.push('tabs');
    a1.background.scripts.push('other.js');
    expect(b.permissions).toEqual(['activeTab', 'scripting']);
    expect(o.background.scripts).toEqual(['background.js']);
  });

  it('accepts an empty overlay', () => {
    expect(mergeManifest(base(), {})).toEqual(base());
  });

  it('mergeManifest throws on overriding base key', () => {
    expect(() => mergeManifest(base(), { permissions: ['tabs'] })).toThrow(/permissions/);
    // A target key already present in base is a collision too.
    const withBg = { ...base(), background: { service_worker: 'bg.js' } };
    expect(() => mergeManifest(withBg, { background: { scripts: ['bg.js'] } })).toThrow(/background/);
  });

  it('mergeManifest throws on non-target key', () => {
    expect(() => mergeManifest(base(), { host_permissions: ['<all_urls>'] })).toThrow(/host_permissions/);
  });

  it('honours a custom allow-list', () => {
    expect(() => mergeManifest(base(), { minimum_chrome_version: '121' }, ['background'])).toThrow(/minimum_chrome_version/);
    expect(mergeManifest(base(), { homepage_url: 'https://x' }, ['homepage_url']).homepage_url).toBe('https://x');
  });

  it('rejects non-object inputs', () => {
    expect(() => mergeManifest(null, {})).toThrow();
    expect(() => mergeManifest(base(), [])).toThrow();
  });
});
