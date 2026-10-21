// Manifest composition for the per-target build (design D4).
// A target overlay may only ADD keys from a closed allow-list; anything else is
// a build error, so Chrome and Firefox manifests cannot drift apart silently (AC-4.8).

export const TARGET_KEYS = Object.freeze(['browser_specific_settings', 'minimum_chrome_version', 'background']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Returns a new manifest: all base keys in base order, then overlay keys in overlay order.
 * Inputs are not mutated and the result shares no nested objects with them.
 * @param {object} base
 * @param {object} overlay
 * @param {readonly string[]} [allowedKeys=TARGET_KEYS]
 */
export function mergeManifest(base, overlay, allowedKeys = TARGET_KEYS) {
  if (!isPlainObject(base)) throw new TypeError('mergeManifest: base must be an object');
  if (!isPlainObject(overlay)) throw new TypeError('mergeManifest: overlay must be an object');

  for (const key of Object.keys(overlay)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`Manifest overlay key not allowed: ${key} (allowed: ${allowedKeys.join(', ')})`);
    }
    if (Object.hasOwn(base, key)) {
      throw new Error(`Manifest overlay overrides base key: ${key}`);
    }
  }
  return structuredClone({ ...base, ...overlay });
}
