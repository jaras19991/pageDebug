import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TARGET_KEYS, mergeManifest } from '../../scripts/lib/manifest.mjs';
import { buildToTmp } from './helpers/build-to-tmp.js';

// AC-4.8 / AC-ST.4 on the built output. The plain "equal after stripping TARGET_KEYS"
// check lives in build.test.js; here: explicit key list, readable diffs, target-only
// keys in exactly one manifest, and proof that the comparison catches a difference.

const SHARED_KEYS = ['version', 'name', 'description', 'permissions', 'action', 'icons'];
const GECKO_ID = /^(?:[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+|\{[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\})$/;

const readManifest = async (dir) => JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));

// Lists every JSON path where a and b differ, e.g. "action.default_icon.16: "a" ≠ "b"".
function diffPaths(a, b, path = '') {
  const isObj = (v) => v !== null && typeof v === 'object';
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
    return Object.is(a, b) ? [] : [`${path || '<root>'}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`];
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.flatMap((k) => diffPaths(a[k], b[k], path ? `${path}.${k}` : k));
}

const stripTargetKeys = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => !TARGET_KEYS.includes(k)));
const parityDiff = (chrome, firefox) => diffPaths(stripTargetKeys(chrome), stripTargetKeys(firefox));

let built;
let chrome;
let firefox;
beforeAll(async () => {
  built = await buildToTmp();
  [chrome, firefox] = await Promise.all(['chrome', 'firefox'].map((t) => readManifest(join(built.outDir, t))));
});
afterAll(async () => { await built?.cleanup(); });

describe('manifest parity chrome vs firefox', () => {
  it('manifests identical except target keys (path-level diff)', () => {
    const diff = parityDiff(chrome, firefox);
    expect(diff, `chrome vs firefox:\n${diff.join('\n')}`).toEqual([]);
  });

  it('version, name, description, permissions, action, icons identical', () => {
    for (const key of SHARED_KEYS) {
      expect(chrome, `chrome.${key}`).toHaveProperty(key);
      const diff = diffPaths(chrome[key], firefox[key], key);
      expect(diff, `${key} differs:\n${diff.join('\n')}`).toEqual([]);
    }
  });

  it('fails on extra difference', () => {
    const cases = [
      (m) => { m.version = '9.9.9'; },
      (m) => { m.permissions = [...m.permissions, 'tabs']; },
      (m) => { m.action.default_icon['16'] = 'icons/other.png'; },
      (m) => { m.host_permissions = ['https://example.com/*']; },
      (m) => { delete m.description; },
    ];
    for (const mutate of cases) {
      const copy = structuredClone(firefox);
      mutate(copy);
      expect(parityDiff(chrome, copy).length, mutate.toString()).toBeGreaterThan(0);
    }
    // Differences confined to target keys are not reported.
    const targetOnly = structuredClone(firefox);
    targetOnly.browser_specific_settings.gecko.strict_min_version = '200.0';
    expect(parityDiff(chrome, targetOnly)).toEqual([]);
  });

  it('chrome has minimum_chrome_version 121 and no gecko settings', () => {
    expect(chrome.minimum_chrome_version).toBe('121');
    expect(chrome).not.toHaveProperty('browser_specific_settings');
  });

  it('firefox has gecko.strict_min_version 128.0 and valid id; no minimum_chrome_version', () => {
    const gecko = firefox.browser_specific_settings?.gecko;
    expect(gecko?.strict_min_version).toBe('128.0');
    expect(gecko?.id).toMatch(GECKO_ID);
    expect(firefox).not.toHaveProperty('minimum_chrome_version');
  });

  it('gecko id regex accepts e-mail-like and braced GUID, rejects others', () => {
    expect('page-debug-snapshot@example.com').toMatch(GECKO_ID);
    expect('{12345678-abcd-4ef0-9abc-0123456789ab}').toMatch(GECKO_ID);
    for (const bad of ['page-debug-snapshot', '12345678-abcd-4ef0-9abc-0123456789ab', 'a@b', '@example.com', '']) {
      expect(bad).not.toMatch(GECKO_ID);
    }
  });

  it('chrome manifest has background.service_worker, firefox has background.scripts, same file and type module', () => {
    // D2: one ES module; Chrome runs it as a service worker, Firefox as an event page.
    expect(chrome.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(firefox.background).toEqual({ scripts: ['background.js'], type: 'module' });
    expect(firefox.background.scripts[0]).toBe(chrome.background.service_worker);
    expect(firefox.background.type).toBe(chrome.background.type);
  });

  it('mergeManifest rejects an overlay overriding permissions', () => {
    const base = { name: 'x', permissions: ['activeTab'] };
    expect(() => mergeManifest(base, { permissions: ['tabs'] })).toThrow(/permissions/);
  });
});
