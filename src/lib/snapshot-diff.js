// Comparison of two packages (design E4 D1, E4-T5, AC-5.6): errors that appeared or disappeared (by message, the
// errorGroups key), status changes of the same method + URL path, CWV changes with rating, cookie count, size and names
// with another valueHash. Input: snapshots already in the v4 shape (normalizeSnapshot). Reads defensively; pure: no
// chrome.*, no DOM, no clock. Used by the MCP server (diff_snapshots); not reachable from the extension.

import { errorGroups } from './snapshot-query.js';
import { METRIC_NAMES, cookieInfo, lastVitals } from './snapshot-metrics.js';

export const DIFF_LIMITS = Object.freeze({
  // Items kept per list (errors added/removed, statuses, cookie names); the rest is counted in `omitted`.
  maxItems: 200,
  // Characters kept of a URL path (also the comparison key).
  pathChars: 300,
  // Characters kept of a cookie name.
  cookieNameChars: 200,
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function list(s, key) {
  return isObject(s) && Array.isArray(s[key]) ? s[key] : [];
}

/** URL without scheme, host, query and fragment (`/api/x`); a URL without `//` keeps its text up to `?`/`#`; ≤ pathChars. */
export function requestPath(url) {
  if (typeof url !== 'string') return '';
  let path = url;
  const cut = path.search(/[?#]/);
  if (cut >= 0) path = path.slice(0, cut);
  const authority = path.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i);
  if (authority) path = path.slice(authority[0].length) || '/';
  return path.length > DIFF_LIMITS.pathChars ? path.slice(0, DIFF_LIMITS.pathChars) : path;
}

// Status of an entry: the HTTP status, else its error text (`net::ERR_FAILED`), else null (no answer recorded).
function statusOf(e) {
  if (typeof e.status === 'number' && Number.isFinite(e.status)) return e.status;
  return typeof e.error === 'string' && e.error !== '' ? e.error : null;
}

// method + path → the last entry with that key (Map keeps the first-seen order).
function statusMap(s) {
  const map = new Map();
  for (const e of list(s, 'network')) {
    if (!isObject(e)) continue;
    const method = typeof e.method === 'string' ? e.method.toUpperCase() : 'GET';
    const path = requestPath(e.url);
    map.set(`${method} ${path}`, { method, path, status: statusOf(e) });
  }
  return map;
}

function errorMap(s) {
  const map = new Map();
  for (const g of errorGroups(s, { limit: Infinity }).groups) map.set(g.message, { message: g.message, count: g.count, frame: g.frame });
  return map;
}

// Cookie name → valueHash (last cookie of a name wins; null = unknown).
function cookieMap(s) {
  const storage = isObject(s) && isObject(s.storage) ? s.storage : {};
  const map = new Map();
  for (const c of Array.isArray(storage.cookies) ? storage.cookies : []) {
    if (!isObject(c) || typeof c.name !== 'string') continue;
    map.set(c.name.slice(0, DIFF_LIMITS.cookieNameChars), typeof c.valueHash === 'string' ? c.valueHash : null);
  }
  return map;
}

const sameVital = (x, y) => (x === null || y === null ? x === y : x.value === y.value && x.rating === y.rating);

/**
 * @param {object} a  earlier package (v4 shape)
 * @param {object} b  later package (v4 shape)
 * @returns {{ errors: { added: { message, count, frame }[], removed: { message, count, frame }[] },
 *   statuses: { method, path, before, after }[],
 *   vitals: { metric, before: { value, rating }|null, after: { value, rating }|null }[],
 *   cookies: { count: { before, after }, totalBytes: { before, after }, added: string[], removed: string[], changedHash: string[] },
 *   omitted: number }}
 *   `before`/`after` of a status: HTTP status, error text or null. Only differing statuses of a method + path present in both.
 *   CWV: the last available value per metric (lastVitals); null = not available. Each list ≤ DIFF_LIMITS.maxItems,
 *   `omitted` = items left out of all lists together.
 */
export function diffSnapshots(a, b) {
  let omitted = 0;
  const capped = (items) => {
    if (items.length <= DIFF_LIMITS.maxItems) return items;
    omitted += items.length - DIFF_LIMITS.maxItems;
    return items.slice(0, DIFF_LIMITS.maxItems);
  };

  const errA = errorMap(a);
  const errB = errorMap(b);
  const errors = {
    added: capped([...errB.values()].filter((e) => !errA.has(e.message))),
    removed: capped([...errA.values()].filter((e) => !errB.has(e.message))),
  };

  const stA = statusMap(a);
  const statuses = [];
  for (const [key, after] of statusMap(b)) {
    const before = stA.get(key);
    if (before && before.status !== after.status) statuses.push({ method: after.method, path: after.path, before: before.status, after: after.status });
  }

  const vA = lastVitals(a);
  const vB = lastVitals(b);
  const vitals = [];
  for (const metric of METRIC_NAMES) {
    const before = vA[metric] && { value: vA[metric].value, rating: vA[metric].rating };
    const after = vB[metric] && { value: vB[metric].value, rating: vB[metric].rating };
    if (!sameVital(before, after)) vitals.push({ metric, before, after });
  }

  const infoA = cookieInfo(a);
  const infoB = cookieInfo(b);
  const ckA = cookieMap(a);
  const ckB = cookieMap(b);
  const namesB = [...ckB.keys()];
  const cookies = {
    count: { before: infoA.count, after: infoB.count },
    totalBytes: { before: infoA.totalBytes, after: infoB.totalBytes },
    added: capped(namesB.filter((n) => !ckA.has(n))),
    removed: capped([...ckA.keys()].filter((n) => !ckB.has(n))),
    changedHash: capped(namesB.filter((n) => ckA.get(n) != null && ckB.get(n) != null && ckA.get(n) !== ckB.get(n))),
  };

  return { errors, statuses: capped(statuses), vitals, cookies, omitted };
}
