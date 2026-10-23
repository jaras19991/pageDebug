// Resource records, kinds and size correlation for `network[]` (E2 D2). Pure functions, no imports,
// no DOM: the recorder feeds them Resource/Navigation Timing entries and its own hook records.
// Status of fetch/XHR always comes from the hook; Resource Timing only adds `sizeBytes` to it, so a wrong
// match can never swap statuses (AC-4.4). `status: null` always comes with `statusUnavailable` (AC-4.3).
// `URL`/`Set`/`Map` are captured when the module loads (document_start in the MAIN bundle), so a page that
// replaces them later does not change the result; callers may pass their own through `intrinsics`.

export const MERGE_LIMITS = Object.freeze({
  urlChars: 4000,
  initiatorChars: 32,
  // Hook `t` is taken just before the call; the RT `startTime` follows within this window.
  matchBeforeMs: 5,
  matchAfterMs: 1000,
});

// Initiators whose RT entries only feed `sizeBytes` of hook records and never become own records.
const HOOK_INITIATORS = Object.freeze({ fetch: 'fetch', xmlhttprequest: 'xhr' });

const EXTENSION_KINDS = [
  [/^(woff2?|ttf|otf|eot)$/, 'font'],
  [/^css$/, 'css'],
  [/^(png|jpe?g|gif|webp|avif|svg|ico)$/, 'img'],
  [/^m?js$/, 'script'],
];

const INITIATOR_KINDS = Object.freeze({ img: 'img', image: 'img', input: 'img', script: 'script', link: 'css' });

const MERGE_INTRINSICS = Object.freeze({
  URL: typeof URL === 'function' ? URL : undefined,
  Set,
  Map,
});

function intrinsicsOf(intrinsics) {
  return intrinsics && typeof intrinsics === 'object' ? { ...MERGE_INTRINSICS, ...intrinsics } : MERGE_INTRINSICS;
}

function str(value, max) {
  const s = typeof value === 'string' ? value : value == null ? '' : String(value);
  return s.length > max ? s.slice(0, max) + `... [truncated ${s.length - max} chars]` : s;
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round2(value) {
  const n = num(value);
  return n === null ? null : Math.round(n * 100) / 100;
}

function extensionOf(href) {
  if (typeof href !== 'string') return '';
  const path = href.slice(0, MERGE_LIMITS.urlChars).split(/[?#]/, 1)[0];
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function originOfHref(href, I) {
  try {
    return new I.URL(href).origin;
  } catch {
    return null;
  }
}

function isCrossOrigin(href, docOrigin, I) {
  if (typeof docOrigin !== 'string' || docOrigin === '') return true;
  return originOfHref(href, I) !== docOrigin;
}

function positiveStatus(entry) {
  const s = num(entry && entry.responseStatus);
  return s !== null && s > 0 ? s : null;
}

// `encodedBodySize` = body bytes from the network before decompression. A cross-origin response without
// `Timing-Allow-Origin` reports only zeros, which means "unknown", not "empty" (D2).
function sizeOf(entry, crossOrigin) {
  const encoded = num(entry.encodedBodySize);
  if (encoded === null || encoded < 0) return null;
  if (crossOrigin && encoded === 0 && !num(entry.decodedBodySize) && !num(entry.transferSize)) return null;
  return encoded;
}

function sameUrl(hookUrl, rtUrl) {
  if (typeof hookUrl !== 'string' || typeof rtUrl !== 'string') return false;
  if (hookUrl === rtUrl) return true;
  // Hook URLs longer than the limit carry a truncation marker; compare the kept prefix.
  return rtUrl.length > MERGE_LIMITS.urlChars && hookUrl.startsWith(rtUrl.slice(0, MERGE_LIMITS.urlChars));
}

// Copy of a record with `sizeBytes` placed right after `durationMs` (schema v3 key order).
function withSize(entry, sizeBytes) {
  const out = {};
  let placed = false;
  for (const key of Object.keys(entry)) {
    if (key === 'sizeBytes') continue;
    out[key] = entry[key];
    if (key === 'durationMs') {
      out.sizeBytes = sizeBytes;
      placed = true;
    }
  }
  if (!placed) out.sizeBytes = sizeBytes;
  return out;
}

/**
 * Kind of a Resource Timing entry for `network[].type`: the file extension wins, then the initiator.
 * @returns {'img'|'script'|'css'|'font'|'other'|null} `null` for fetch/XHR/navigation (not own records).
 */
export function resourceKind(initiatorType, href) {
  if (initiatorType === 'fetch' || initiatorType === 'xmlhttprequest' || initiatorType === 'navigation') return null;
  const ext = extensionOf(href);
  if (ext) {
    for (const [re, kind] of EXTENSION_KINDS) if (re.test(ext)) return kind;
  }
  return (typeof initiatorType === 'string' && INITIATOR_KINDS[initiatorType]) || 'other';
}

/**
 * Network record (schema v3 key order, without `doc`) for a Resource Timing entry.
 * @param {object} entry PerformanceResourceTiming-like
 * @param {{ docOrigin: string, supportsStatus: boolean, intrinsics?: { URL?: Function } }} options
 * @returns {object | null} `null` for entries that are not own records (fetch/XHR/navigation)
 */
export function resourceRecord(entry, { docOrigin, supportsStatus, intrinsics } = {}) {
  if (!entry) return null;
  const type = resourceKind(entry.initiatorType, entry.name);
  if (type === null) return null;
  const url = str(entry.name, MERGE_LIMITS.urlChars);
  const crossOrigin = isCrossOrigin(entry.name, docOrigin, intrinsicsOf(intrinsics));
  const status = supportsStatus ? positiveStatus(entry) : null;
  const rec = { t: round2(entry.startTime), type, method: 'GET', url, status };
  if (status === null) {
    rec.statusUnavailable = crossOrigin ? 'cross-origin' : supportsStatus ? 'network-error' : 'unsupported-browser';
  }
  rec.statusText = null;
  rec.ok = status === null ? null : status >= 200 && status < 300;
  rec.redirected = null;
  rec.durationMs = round2(entry.duration);
  rec.sizeBytes = sizeOf(entry, crossOrigin);
  rec.requestHeaders = {};
  rec.responseHeaders = {};
  rec.requestBody = null;
  rec.error = null;
  rec.initiatorType = str(entry.initiatorType, Infinity).slice(0, MERGE_LIMITS.initiatorChars);
  return rec;
}

/**
 * Adds `sizeBytes` to fetch/XHR hook records from RT entries of the same URL and initiator: in order of `t`,
 * each record takes the first unassigned RT entry with `startTime ∈ [t - 5, t + 1000]`. Statuses are never
 * touched. Returns new objects in the input order; other records are copied unchanged.
 * @param {object[]} hookEntries
 * @param {object[]} rtEntries PerformanceResourceTiming-like
 * @param {{ docOrigin?: string, intrinsics?: { URL?: Function, Set?: Function, Map?: Function } }} [options]
 *   without `docOrigin` all-zero sizes count as unknown (`null`)
 */
export function correlateSizes(hookEntries, rtEntries, { docOrigin, intrinsics } = {}) {
  const I = intrinsicsOf(intrinsics);
  const records = Array.isArray(hookEntries) ? hookEntries : [];
  const candidates = (Array.isArray(rtEntries) ? rtEntries : [])
    .filter((e) => e && HOOK_INITIATORS[e.initiatorType] && num(e.startTime) !== null)
    .sort((a, b) => a.startTime - b.startTime);
  const used = new I.Set();
  const sizes = new I.Map();
  const order = records
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry && (entry.type === 'fetch' || entry.type === 'xhr'))
    .sort((a, b) => (num(a.entry.t) ?? Infinity) - (num(b.entry.t) ?? Infinity));
  for (const { entry, index } of order) {
    const t = num(entry.t);
    if (t === null) continue;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (used.has(i)) continue;
      if (c.startTime > t + MERGE_LIMITS.matchAfterMs) break;
      if (c.startTime < t - MERGE_LIMITS.matchBeforeMs) continue;
      if (HOOK_INITIATORS[c.initiatorType] !== entry.type || !sameUrl(entry.url, c.name)) continue;
      used.add(i);
      sizes.set(index, sizeOf(c, docOrigin ? isCrossOrigin(c.name, docOrigin, I) : true));
      break;
    }
  }
  return records.map((entry, index) => {
    if (!entry || (entry.type !== 'fetch' && entry.type !== 'xhr')) return entry && { ...entry };
    return withSize(entry, sizes.has(index) ? sizes.get(index) : entry.sizeBytes ?? null);
  });
}

/**
 * Marks resource records whose element fired `error` with `error: 'load-failed'`; a load error without
 * a matching record (no RT entry) becomes its own record with `statusUnavailable: 'network-error'`.
 * A record matches when URL and kind agree and it started no later than the error; the latest such
 * unmarked record wins. Returns new objects ordered by `t` (stable).
 * @param {object[]} records network records
 * @param {{ t: number, url: string, kind: string }[]} loadErrors
 */
export function mergeLoadErrors(records, loadErrors) {
  const out = (Array.isArray(records) ? records : []).map((e) => e && { ...e });
  const errors = (Array.isArray(loadErrors) ? loadErrors : []).filter((e) => e && typeof e.url === 'string');
  const added = [];
  for (const err of errors) {
    const t = round2(err.t);
    const url = str(err.url, MERGE_LIMITS.urlChars);
    const kind = typeof err.kind === 'string' && err.kind ? err.kind : 'other';
    let best = null;
    for (const rec of out) {
      if (!rec || rec.type === 'fetch' || rec.type === 'xhr' || rec.error != null) continue;
      if (rec.type !== kind || rec.url !== url) continue;
      if (t !== null && rec.t !== null && rec.t > t + MERGE_LIMITS.matchBeforeMs) continue;
      if (!best || (rec.t ?? -Infinity) >= (best.t ?? -Infinity)) best = rec;
    }
    if (best) {
      best.error = 'load-failed';
      continue;
    }
    added.push({
      t, type: kind, method: 'GET', url, status: null, statusUnavailable: 'network-error', statusText: null, ok: null,
      redirected: null, durationMs: null, sizeBytes: null, requestHeaders: {}, responseHeaders: {}, requestBody: null,
      error: 'load-failed',
    });
  }
  if (added.length === 0) return out;
  return out
    .concat(added)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (num(a.entry && a.entry.t) ?? Infinity) - (num(b.entry && b.entry.t) ?? Infinity) || a.index - b.index)
    .map(({ entry }) => entry);
}

/**
 * Status of the document from its PerformanceNavigationTiming entry (AC-4.2).
 * @returns {{ status: number } | { status: null, statusUnavailable: string }}
 */
export function documentStatus(navEntry, supportsStatus) {
  if (!supportsStatus) return { status: null, statusUnavailable: 'unsupported-browser' };
  const status = positiveStatus(navEntry);
  return status === null ? { status: null, statusUnavailable: 'unknown' } : { status };
}
