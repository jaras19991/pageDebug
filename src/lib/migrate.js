// Read-side migration of a parsed snapshot.json to the v4 shape (design E4 D4, Q-9; tables "Zmiany między wersjami" in
// docs/snapshot-schema.md). v4 is returned as is (same object, never mutated: summary, viewer and MCP read it directly);
// v3 and v2 are rebuilt into new objects (inputs are never mutated, unchanged arrays are shared); v1 is best-effort;
// a newer schemaVersion is returned untouched with a warning (AC-4.7).
// Pure: no chrome.*, no DOM, no clock. Runs in the viewer and in the MCP server.

// Must equal SCHEMA_VERSION in package.js (pinned by a test; not imported, so the viewer does not pull the writer in).
export const CURRENT_SCHEMA_VERSION = 4;

/** Read error with `code` ∈ `not-package | corrupt | too-large | unsupported` (shared with package-reader.js). */
export class PackageError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'PackageError';
    this.code = code;
  }
}

const V4_ORDER = [
  'schemaVersion', 'extensionVersion', 'source', 'collectedAt', 'recordingStartedAt', 'recordingStoppedReason', 'timeOrigin',
  'overview', 'redaction', 'limits', 'truncated', 'documents', 'notes', 'steps', 'runtimeErrors', 'network', 'vitals',
  'screenshots', 'consoleLogs', 'environment', 'performance', 'storage', 'dom',
];
const DROPPED_V3 = new Set(['attachments']);
const V1_LIMIT = 5000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);

function detectVersion(raw) {
  if (!isObject(raw)) return null;
  if ('schemaVersion' in raw) {
    const v = raw.schemaVersion;
    return Number.isInteger(v) && v >= 1 ? v : null;
  }
  if (typeof raw.version === 'string' || typeof raw.initializedAt === 'string') return 1;
  return null;
}

// Keys in the v4 order, then keys this version does not know (kept, so nothing silently disappears).
function ordered(obj) {
  const out = {};
  for (const key of V4_ORDER) out[key] = key in obj ? obj[key] : null;
  for (const key of Object.keys(obj)) if (!(key in out) && !DROPPED_V3.has(key)) out[key] = obj[key];
  return out;
}

const utf8Length = (s) => new TextEncoder().encode(s).length;

// document.cookie string → v4 list: split on ";" and the first "="; the value itself is dropped (no hash available).
function cookieList(text) {
  const list = [];
  for (const part of text.split(';')) {
    const pair = part.trim();
    if (!pair) continue;
    const eq = pair.indexOf('=');
    list.push({ name: eq < 0 ? '' : pair.slice(0, eq), sizeBytes: utf8Length(pair), valueHash: null });
  }
  return list;
}

function overviewFrom(s) {
  return {
    runtimeErrors: arr(s.runtimeErrors).length,
    consoleErrors: arr(s.consoleLogs).filter((r) => r && r.level === 'error').length,
    failedRequests: arr(s.network).filter((r) => r && ((typeof r.status === 'number' && r.status >= 400) || (r.error != null && r.error !== ''))).length,
    steps: arr(s.steps).length,
    poorVitals: 0,
    screenshot: false,
  };
}

// --- v1 → v2 (best-effort) ---

function v1ToV2(raw) {
  const perfOrigin = isObject(raw.performance) ? raw.performance.timeOrigin : null;
  const startedAt = Date.parse(raw.initializedAt);
  const timeOrigin = Number.isFinite(perfOrigin) ? perfOrigin : Number.isFinite(startedAt) ? startedAt : null;
  const rel = (iso) => {
    const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
    return Number.isFinite(ms) && timeOrigin !== null ? ms - timeOrigin : null;
  };
  const location = isObject(raw.environment) && isObject(raw.environment.location) ? raw.environment.location : {};

  const consoleLogs = arr(raw.consoleLogs).map((r) => {
    const out = { t: rel(r && r.timestamp), doc: 0, level: r && r.level, args: arr(r && r.args) };
    if (r && typeof r.stack === 'string') out.stack = r.stack;
    return out;
  });
  const runtimeErrors = arr(raw.runtimeErrors).map((r) => {
    const src = isObject(r) ? r : {};
    const cause = isObject(src.error) ? src.error : isObject(src.reason) ? src.reason : {};
    const out = { t: rel(src.timestamp), doc: 0, type: src.type ?? 'error', message: src.message ?? cause.message ?? null };
    if (out.type !== 'unhandledrejection') {
      out.filename = src.filename ?? null;
      out.lineno = src.lineno ?? null;
      out.colno = src.colno ?? null;
    }
    out.stack = typeof cause.stack === 'string' ? cause.stack : null;
    if ('reason' in src && !isObject(src.reason)) out.reason = src.reason;
    return out;
  });
  const network = arr(raw.network).map((r) => {
    const src = isObject(r) ? r : {};
    const init = isObject(src.init) ? src.init : {};
    let t = rel(src.startedAtIso);
    if (t === null && typeof src.startedAt === 'string') t = rel(src.startedAt);
    // a number: epoch ms (v1 Date.now()) or already relative (performance.now())
    if (t === null && Number.isFinite(src.startedAt)) t = src.startedAt > 1e12 && timeOrigin !== null ? src.startedAt - timeOrigin : src.startedAt;
    return {
      t,
      doc: 0,
      type: src.type ?? 'fetch',
      method: src.method ?? init.method ?? 'GET',
      url: src.url ?? src.responseURL ?? (typeof src.input === 'string' ? src.input : null),
      status: src.status ?? null,
      statusText: src.statusText ?? null,
      ok: src.ok ?? null,
      redirected: src.redirected ?? null,
      durationMs: src.durationMs ?? null,
      requestHeaders: src.requestHeaders ?? (isObject(init.headers) ? init.headers : {}),
      responseHeaders: src.responseHeaders ?? (isObject(src.headers) ? src.headers : {}),
      requestBody: src.requestBody ?? src.body ?? null,
      error: src.error ?? null,
    };
  });
  const counts = { consoleLogs: consoleLogs.length, runtimeErrors: runtimeErrors.length, network: network.length };
  return {
    schemaVersion: 2,
    extensionVersion: null,
    source: 'extension',
    collectedAt: raw.collectedAt ?? null,
    recordingStartedAt: raw.initializedAt ?? null,
    recordingStoppedReason: null,
    timeOrigin,
    documents: [
      {
        id: 0,
        url: typeof location.href === 'string' ? location.href : null,
        timeOrigin,
        navigationType: isObject(raw.performance) && isObject(raw.performance.navigation) ? raw.performance.navigation.type ?? null : null,
        recorded: true,
        flushed: true,
        current: true,
        counts,
        kept: { ...counts },
      },
    ],
    limits: { consoleLogs: V1_LIMIT, runtimeErrors: V1_LIMIT, network: V1_LIMIT },
    truncated: {},
    notes: arr(raw.notes),
    environment: raw.environment ?? null,
    dom: raw.dom ?? null,
    performance: raw.performance ?? null,
    storage: raw.storage ?? null,
    consoleLogs,
    runtimeErrors,
    network,
  };
}

// --- v2 → v3 ---

function v2ToV3(raw) {
  const out = { ...raw, schemaVersion: 3 };
  out.steps = arr(raw.steps);
  out.vitals = arr(raw.vitals);
  out.screenshots = arr(raw.screenshots);
  out.attachments = isObject(raw.attachments) ? raw.attachments : {};
  out.overview = overviewFrom(out);
  out.truncated = { steps: false, responseBodies: false, ...(isObject(raw.truncated) ? raw.truncated : {}) };
  out.documents = arr(raw.documents).map((d) => {
    if (!isObject(d)) return d;
    const doc = { ...d };
    if (!('status' in doc)) {
      doc.status = null;
      doc.statusUnavailable = 'unknown';
    }
    doc.counts = { steps: 0, ...(isObject(d.counts) ? d.counts : {}) };
    doc.kept = { steps: 0, ...(isObject(d.kept) ? d.kept : {}) };
    return doc;
  });
  return out;
}

// --- v3 → v4 ---

function v3ToV4(raw) {
  const attachments = isObject(raw.attachments) ? raw.attachments : {};
  let screenshotDataUrl = null;
  const screenshots = arr(raw.screenshots).map((meta) => {
    if (!isObject(meta)) return meta;
    const { attachment, ...rest } = meta;
    const data = typeof attachment === 'string' ? attachments[attachment] : undefined;
    if (screenshotDataUrl === null && typeof data === 'string' && data.startsWith('data:image/')) screenshotDataUrl = data;
    return { ...rest, file: attachment ?? null, maskedFields: null };
  });

  let storage = raw.storage;
  if (isObject(storage) && typeof storage.cookies === 'string') {
    storage = { ...storage, cookies: cookieList(storage.cookies), cookiesTotalBytes: utf8Length(storage.cookies) };
  }

  // dom.html.outerHTML stays (the viewer shows it as text); the v4 keys exist with null.
  let dom = raw.dom;
  if (isObject(dom)) dom = { ...dom, structure: dom.structure ?? null, fullHtml: dom.fullHtml ?? null };

  const truncated = { html: false, resources: false, dom: false, storage: false, stacks: false, ...(isObject(raw.truncated) ? raw.truncated : {}) };
  const snapshot = ordered({ ...raw, schemaVersion: 4, redaction: null, truncated, screenshots, storage, dom });
  return { snapshot, screenshotDataUrl };
}

/** Warning `unredacted` of a package older than schemaVersion 4 (viewer banner, MCP list_snapshots and get_summary). */
export const UNREDACTED_WARNING = 'Paczka sprzed automatycznej redakcji — może zawierać hasła i tokeny';

/**
 * @param {unknown} raw  parsed snapshot.json
 * @returns {{ snapshot: object, sourceVersion: number, newer: boolean,
 *             warnings: { code: string, message: string }[], extras: { screenshotDataUrl: string|null } }}
 *          `extras.screenshotDataUrl`: v3 image (data URL from `attachments`); null for v4+ (the image is screenshot.jpg in the zip)
 * @throws {PackageError} `not-package` for a non-object or an object without a recognisable version
 */
export function normalizeSnapshot(raw) {
  const version = detectVersion(raw);
  if (version === null) throw new PackageError('not-package', 'not a snapshot: no recognisable schemaVersion');
  if (version >= CURRENT_SCHEMA_VERSION) {
    const newer = version > CURRENT_SCHEMA_VERSION;
    const warnings = newer
      ? [{ code: 'newer', message: `Nowsza wersja paczki (schemaVersion ${version}). Część danych może się nie wyświetlić.` }]
      : [];
    return { snapshot: raw, sourceVersion: version, newer, warnings, extras: { screenshotDataUrl: null } };
  }
  // Automatic redaction came with schemaVersion 4 (E3): an older file may hold passwords and tokens in the clear.
  const warnings = [{ code: 'unredacted', message: UNREDACTED_WARNING }];
  let s = raw;
  if (version === 1) {
    warnings.push({ code: 'legacy-v1', message: 'Paczka w wersji 1: dane odczytane w przybliżeniu (czasy przeliczone z dat).' });
    s = v1ToV2(s);
  }
  if (version <= 2) s = v2ToV3(s);
  const { snapshot, screenshotDataUrl } = v3ToV4(s);
  return { snapshot, sourceVersion: version, newer: false, warnings, extras: { screenshotDataUrl } };
}
