import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILT_IN_DEV_CONFIG } from '../../src/lib/dev-config.js';
import { loadDevOptions, sanitizeDevConfig } from '../../src/lib/dev-options.js';
import { resolveDisabledRules } from '../../src/lib/redact.js';
import { DEFAULT_RULES } from '../../src/lib/redact-rules.js';

// Fake storage.managed: `value` is what the policy holds; `get` may reject or hang instead.
function fakeStorage({ value, get } = {}) {
  const calls = [];
  return {
    calls,
    managed: {
      get: get ?? (async (keys) => {
        calls.push(keys);
        return value === undefined ? {} : { disabledRules: value };
      }),
    },
  };
}

afterEach(() => vi.useRealTimers());

describe('dev-config.js', () => {
  it('built-in config is frozen and turns nothing off by default', () => {
    expect(BUILT_IN_DEV_CONFIG).toEqual({ disabledRules: [] });
    expect(Object.isFrozen(BUILT_IN_DEV_CONFIG)).toBe(true);
  });

  it('has no chrome.* and no imports (build replaces it whole)', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/lib/dev-config.js', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/\bchrome\.|\bbrowser\./);
    expect(src).not.toMatch(/^\s*import\b/m);
  });
});

describe('sanitizeDevConfig', () => {
  it('keeps DEFAULT_RULES only, in their order, without duplicates', () => {
    expect(sanitizeDevConfig({ disabledRules: ['html-structure', 'email', 'email'] })).toEqual({
      disabledRules: ['email', 'html-structure'],
      ignored: [],
    });
  });

  it('jwt / unknown rule / unknown key / string instead of array ignored, valid rest kept, listed in ignored (AC-6.3)', () => {
    expect(sanitizeDevConfig({ disabledRules: ['jwt', 'phone', 'nope', 42], sendTo: 'x@example.com' })).toEqual({
      disabledRules: ['phone'],
      ignored: ['disabledRules: jwt', 'disabledRules: nope', 'disabledRules: 42', 'sendTo'],
    });
    expect(sanitizeDevConfig({ disabledRules: 'email' })).toEqual({ disabledRules: [], ignored: ['disabledRules'] });
    for (const raw of [null, undefined, 'x', 3, ['email']]) {
      expect(sanitizeDevConfig(raw), String(raw)).toEqual({ disabledRules: [], ignored: raw == null ? [] : ['<config>'] });
    }
  });

  it('never throws on hostile input (getter that throws, proxy)', () => {
    const hostile = { get disabledRules() { throw new Error('boom'); } };
    expect(() => sanitizeDevConfig(hostile)).not.toThrow();
    expect(sanitizeDevConfig(hostile).disabledRules).toEqual([]);
    const proxy = new Proxy({}, { ownKeys() { throw new Error('boom'); } });
    expect(() => sanitizeDevConfig(proxy)).not.toThrow();
  });

  it('caps the ignored list and the length of each entry', () => {
    const many = Array.from({ length: 500 }, (_, i) => `rule-${i}-${'x'.repeat(500)}`);
    const { ignored } = sanitizeDevConfig({ disabledRules: many });
    expect(ignored.length).toBeLessThanOrEqual(20);
    for (const entry of ignored) expect(entry.length).toBeLessThanOrEqual(100);
  });
});

describe('loadDevOptions', () => {
  it('no managed value → built-in (AC-6.1)', async () => {
    const storage = fakeStorage();
    const result = await loadDevOptions({ storage, builtIn: { disabledRules: ['email'] } });
    expect(result).toEqual({ disabledRules: ['email'], source: 'built-in', ignored: [] });
    expect(storage.calls).toEqual(['disabledRules']);
  });

  it('defaults to BUILT_IN_DEV_CONFIG', async () => {
    expect(await loadDevOptions({ storage: fakeStorage() })).toEqual({ disabledRules: [], source: 'built-in', ignored: [] });
  });

  it('managed disabledRules replaces built-in (also [] re-enables) (AC-6.1)', async () => {
    const builtIn = { disabledRules: ['email', 'phone'] };
    expect(await loadDevOptions({ storage: fakeStorage({ value: ['html-structure'] }), builtIn })).toEqual({
      disabledRules: ['html-structure'],
      source: 'policy',
      ignored: [],
    });
    expect(await loadDevOptions({ storage: fakeStorage({ value: [] }), builtIn })).toEqual({
      disabledRules: [],
      source: 'policy',
      ignored: [],
    });
  });

  it('managed value of a wrong type → built-in, listed in ignored (AC-6.3)', async () => {
    const result = await loadDevOptions({ storage: fakeStorage({ value: 'email' }), builtIn: { disabledRules: ['phone'] } });
    expect(result).toEqual({ disabledRules: ['phone'], source: 'built-in', ignored: ['policy: disabledRules'] });
  });

  it('policy with jwt keeps the valid rest (AC-6.3)', async () => {
    const result = await loadDevOptions({ storage: fakeStorage({ value: ['jwt', 'email'] }) });
    expect(result).toEqual({ disabledRules: ['email'], source: 'policy', ignored: ['disabledRules: jwt'] });
  });

  it('Firefox: managed.get rejects "Managed storage manifest not found" → built-in, no throw (AC-6.1, AC-6.3)', async () => {
    const storage = fakeStorage({ get: () => Promise.reject(new Error('Managed storage manifest not found')) });
    await expect(loadDevOptions({ storage, builtIn: { disabledRules: ['email'] } })).resolves.toEqual({
      disabledRules: ['email'],
      source: 'built-in',
      ignored: [],
    });
  });

  it('managed.get throws synchronously, storage or managed missing → built-in', async () => {
    const throwing = fakeStorage({ get: () => { throw new Error('sync'); } });
    for (const storage of [throwing, {}, undefined, null, { managed: {} }]) {
      await expect(loadDevOptions({ storage })).resolves.toEqual({ disabledRules: [], source: 'built-in', ignored: [] });
    }
    await expect(loadDevOptions()).resolves.toEqual({ disabledRules: [], source: 'built-in', ignored: [] });
  });

  it('managed.get hangs → built-in after 1 s (AC-6.1, AC-6.3)', async () => {
    vi.useFakeTimers();
    const storage = fakeStorage({ get: () => new Promise(() => {}) });
    let settled;
    const pending = loadDevOptions({ storage, builtIn: { disabledRules: ['phone'] } }).then((r) => { settled = r; });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toEqual({ disabledRules: ['phone'], source: 'built-in', ignored: [] });
  });

  it('invalid built-in config is sanitized too', async () => {
    const result = await loadDevOptions({ storage: fakeStorage(), builtIn: { disabledRules: ['jwt', 'email'] } });
    expect(result).toEqual({ disabledRules: ['email'], source: 'built-in', ignored: ['disabledRules: jwt'] });
  });

  it('result passes resolveDisabledRules unchanged (order of DEFAULT_RULES) (AC-6.4)', async () => {
    const { disabledRules } = await loadDevOptions({ storage: fakeStorage({ value: ['html-structure', 'phone', 'email'] }) });
    expect(disabledRules).toEqual([...DEFAULT_RULES]);
    expect(resolveDisabledRules(disabledRules)).toEqual(disabledRules);
  });

  it('has no chrome.* (storage is injected)', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/lib/dev-options.js', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/\bchrome\.|\bbrowser\./);
  });
});
