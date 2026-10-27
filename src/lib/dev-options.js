// Developer options for the redaction (E4 D5): the configuration built into the extension, replaced as a whole
// by an enterprise policy (storage.managed). Pure apart from the injected storage; never throws and never waits
// longer than `timeoutMs`, so recording and saving are never blocked by a bad or missing configuration (AC-6.3).

import { BUILT_IN_DEV_CONFIG } from './dev-config.js';
import { DEFAULT_RULES } from './redact-rules.js';

const KNOWN_KEYS = Object.freeze(['disabledRules']);
// Bounds of the `ignored` report: it names developer mistakes, never needs to be long.
const MAX_IGNORED = 20;
const MAX_IGNORED_CHARS = 100;
const MAX_RULES_SCANNED = 100;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function pushIgnored(ignored, text) {
  if (ignored.length < MAX_IGNORED) ignored.push(String(text).slice(0, MAX_IGNORED_CHARS));
}

/**
 * Raw configuration → `{ disabledRules, ignored }`. Keeps only names from DEFAULT_RULES (in their order, no duplicates);
 * Always rules, unknown names, unknown keys and wrong types are dropped and listed in `ignored` (AC-6.3).
 * @param {unknown} raw
 * @returns {{ disabledRules: string[], ignored: string[] }}
 */
export function sanitizeDevConfig(raw) {
  const ignored = [];
  if (raw === null || raw === undefined) return { disabledRules: [], ignored };
  if (!isPlainObject(raw)) return { disabledRules: [], ignored: ['<config>'] };
  try {
    const wanted = new Set();
    const list = raw.disabledRules;
    if (list !== undefined && !Array.isArray(list)) {
      pushIgnored(ignored, 'disabledRules');
    } else if (list) {
      const count = Math.min(list.length, MAX_RULES_SCANNED);
      for (let i = 0; i < count; i++) {
        const rule = list[i];
        if (typeof rule === 'string' && DEFAULT_RULES.includes(rule)) wanted.add(rule);
        else pushIgnored(ignored, `disabledRules: ${typeof rule === 'string' || typeof rule === 'number' ? rule : typeof rule}`);
      }
    }
    for (const key of Object.keys(raw)) {
      if (!KNOWN_KEYS.includes(key)) pushIgnored(ignored, key);
    }
    return { disabledRules: DEFAULT_RULES.filter((rule) => wanted.has(rule)), ignored };
  } catch {
    return { disabledRules: [], ignored: ['<config>'] };
  }
}

// storage.managed.get('disabledRules') bounded by `timeoutMs`; any failure (Firefox without a policy rejects with
// "Managed storage manifest not found") or a hang resolves to `undefined`.
async function readPolicy(storage, timeoutMs) {
  let timer;
  try {
    const get = storage?.managed?.get;
    if (typeof get !== 'function') return undefined;
    const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs, undefined); });
    const read = Promise.resolve()
      .then(() => get.call(storage.managed, 'disabledRules'))
      .catch(() => undefined);
    const result = await Promise.race([read, timeout]);
    return isPlainObject(result) && Object.hasOwn(result, 'disabledRules') ? result.disabledRules : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Effective developer options: the policy's `disabledRules` array, when there is one, replaces the built-in
 * configuration as a whole (`[]` turns every rule back on); otherwise the built-in configuration applies.
 * @param {{ storage?: { managed?: { get: Function } }, builtIn?: object, timeoutMs?: number }} [options]
 * @returns {Promise<{ disabledRules: string[], source: 'built-in' | 'policy', ignored: string[] }>}
 */
export async function loadDevOptions({ storage, builtIn = BUILT_IN_DEV_CONFIG, timeoutMs = 1000 } = {}) {
  const policy = await readPolicy(storage, timeoutMs);
  if (Array.isArray(policy)) {
    return { ...sanitizeDevConfig({ disabledRules: policy }), source: 'policy' };
  }
  const own = sanitizeDevConfig(builtIn);
  const ignored = policy === undefined ? own.ignored : ['policy: disabledRules', ...own.ignored].slice(0, MAX_IGNORED);
  return { disabledRules: own.disabledRules, source: 'built-in', ignored };
}
