// Origin of a tab URL and the host pattern used for the permission and the content
// script registration (design D1, PB-1 A). Pure functions, no browser API.

// URLs longer than this are not parsed; no real tab URL we record comes close.
const MAX_URL_LENGTH = 8192;

const FILE_ORIGIN = Object.freeze({ origin: 'file://', pattern: 'file:///*' });

/**
 * `origin` is exact (with port) and is what the per-document gate compares.
 * `pattern` is `<scheme>://<hostname>/*` without port: Firefox rejects ports in
 * match patterns and Chrome matches every port without one (AC-3.2).
 * @returns {{ origin: string, pattern: string } | null}
 */
export function originPatternFor(url) {
  if (typeof url !== 'string' || url === '' || url.length > MAX_URL_LENGTH) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === 'file:') return { ...FILE_ORIGIN };
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  // WHATWG `hostname` is already punycoded and keeps IPv6 brackets.
  return { origin: parsed.origin, pattern: `${parsed.protocol}//${parsed.hostname}/*` };
}

/** @returns {string | null} exact origin (with non-default port), `file://` for files. */
export function originOf(url) {
  return originPatternFor(url)?.origin ?? null;
}

/** Exact origin comparison: scheme, host and port must all match. */
export function isSameOrigin(url, origin) {
  const own = originOf(url);
  return own !== null && own === origin;
}
