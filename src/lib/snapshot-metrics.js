// Page metrics of a package (design E4 D1, E4-T1c): Core Web Vitals per document with rating or the reason they are
// unavailable (never a made-up 0), slowest network entries, cookies and `truncated` flags. Shared by summary.md, the
// viewer and the MCP server. Reads defensively; pure: no chrome.*, no DOM, no clock. Syntax follows the src/page
// generator rules.

export const METRIC_NAMES = Object.freeze(['TTFB', 'FCP', 'LCP', 'CLS', 'INP']);

export const RATING_PL = Object.freeze({
  good: 'dobrze',
  'needs-improvement': 'do poprawy',
  poor: 'słabo',
});

// Codes from src/page/vitals.js and docs/snapshot-schema.md; an unknown code is shown as the code itself by the caller.
export const REASON_PL = Object.freeze({
  'unsupported-browser': 'przeglądarka tego nie mierzy',
  'no-interaction': 'brak interakcji',
  'hidden-at-start': 'karta była w tle przy otwarciu strony',
  'no-data': 'brak danych',
  'cross-origin': 'zasób z innej domeny',
  unknown: 'nieznany powód',
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function list(s, key) {
  return isObject(s) && Array.isArray(s[key]) ? s[key] : [];
}

function urlOfDoc(s, docId) {
  for (const d of list(s, 'documents')) if (isObject(d) && d.id === docId) return typeof d.url === 'string' ? d.url : null;
  return null;
}

// One metric: available only with a finite numeric value; otherwise the recorded reason or `unknown`.
function metricOf(raw) {
  if (isObject(raw) && raw.available === true && typeof raw.value === 'number' && Number.isFinite(raw.value)) {
    return { available: true, value: raw.value, rating: Object.hasOwn(RATING_PL, raw.rating) ? raw.rating : null, entry: raw };
  }
  const reason = isObject(raw) && raw.available === false && typeof raw.reason === 'string' && raw.reason !== '' ? raw.reason : 'unknown';
  return { available: false, reason };
}

/**
 * CWV of the last `last` documents (package order):
 * `{ docs: [{ doc, url, metrics: { TTFB|FCP|LCP|CLS|INP: { available: true, value, rating, entry } | { available: false, reason } },
 * longTasks }], more }` (`more` = earlier documents not shown; `entry` = the raw metric with its attribution).
 */
export function vitalsByDoc(s, { last = 5 } = {}) {
  const all = list(s, 'vitals').filter(isObject);
  const shown = last >= all.length ? all : all.slice(all.length - Math.max(0, last));
  const docs = shown.map((v) => {
    const metrics = {};
    for (const name of METRIC_NAMES) metrics[name] = metricOf(v[name]);
    return { doc: v.doc ?? null, url: urlOfDoc(s, v.doc), metrics, longTasks: isObject(v.longTasks) ? v.longTasks : null };
  });
  return { docs, more: all.length - shown.length };
}

/**
 * The `n` network entries with the largest `durationMs` (ties: package order), without sorting the whole list:
 * `[{ durationMs, type, sizeBytes, url, index }]`.
 */
export function slowestResources(s, n = 5) {
  const top = [];
  if (!(n > 0)) return top;
  const network = list(s, 'network');
  for (let index = 0; index < network.length; index++) {
    const e = network[index];
    if (!isObject(e) || typeof e.durationMs !== 'number' || !Number.isFinite(e.durationMs)) continue;
    if (top.length >= n && e.durationMs <= top[top.length - 1].durationMs) continue;
    let at = top.length;
    while (at > 0 && top[at - 1].durationMs < e.durationMs) at--;
    top.splice(at, 0, {
      durationMs: e.durationMs,
      type: typeof e.type === 'string' ? e.type : null,
      sizeBytes: typeof e.sizeBytes === 'number' && Number.isFinite(e.sizeBytes) ? e.sizeBytes : null,
      url: typeof e.url === 'string' ? e.url : null,
      index,
    });
    if (top.length > n) top.pop();
  }
  return top;
}

/** `{ count, totalBytes, truncatedKeys }` — cookies in the package, `storage.cookiesTotalBytes`, keys of `truncated` that are `true`. */
export function cookieInfo(s) {
  const storage = isObject(s) && isObject(s.storage) ? s.storage : {};
  const cookies = Array.isArray(storage.cookies) ? storage.cookies : [];
  const total = storage.cookiesTotalBytes;
  const truncated = isObject(s) && isObject(s.truncated) ? s.truncated : {};
  return {
    count: cookies.length,
    totalBytes: typeof total === 'number' && Number.isFinite(total) ? total : null,
    truncatedKeys: Object.keys(truncated).filter((key) => truncated[key] === true),
  };
}

/** Per metric the last available value in the package: `{ TTFB: { value, rating, doc } | null, … }`. */
export function lastVitals(s) {
  const all = list(s, 'vitals').filter(isObject);
  const out = {};
  for (const name of METRIC_NAMES) {
    out[name] = null;
    for (let i = all.length - 1; i >= 0; i--) {
      const m = metricOf(all[i][name]);
      if (m.available) {
        out[name] = { value: m.value, rating: m.rating, doc: all[i].doc ?? null };
        break;
      }
    }
  }
  return out;
}
