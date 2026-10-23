// Schema validator of the v3 snapshot package (design E2 D9, „Schema paczki”; AC-7.1, AC-7.2, AC-4.3).
// One module for unit tests (fixture, assemblePackage output) and e2e (a real saved package). No dependencies and
// deliberately no import of src/lib/package.js: the lists below are the contract from docs/snapshot-schema.md,
// so a drift in the implementation shows up as an error instead of being copied into the check.
//
// validateSnapshot(pkg) → { ok, errors } where every error is "<path>: <problem>" (e.g. "network[3].status: …").

export const SCHEMA_VERSION = 3;

// Top-level keys in the order of the saved JSON (AC-7.2 + PB-2 A). All are required (AC-7.1).
export const REQUIRED_KEYS = Object.freeze([
  'schemaVersion', 'extensionVersion', 'source', 'collectedAt', 'recordingStartedAt', 'recordingStoppedReason', 'timeOrigin',
  'overview', 'limits', 'truncated',
  'documents', 'notes', 'steps', 'runtimeErrors', 'network', 'vitals', 'screenshots', 'consoleLogs',
  'environment', 'performance', 'storage', 'dom',
  'attachments',
]);

export const RECORD_KEYS = Object.freeze(['consoleLogs', 'runtimeErrors', 'network', 'steps']);
export const LIMIT_KEYS = Object.freeze([
  'consoleLogs', 'runtimeErrors', 'network', 'steps', 'entryChars', 'stackChars',
  'responseBodyChars', 'responseBodyTotalChars', 'screenshotBytes', 'longTasks',
]);
export const TRUNCATED_KEYS = Object.freeze([...RECORD_KEYS, 'responseBodies']);
export const OVERVIEW_KEYS = Object.freeze(['runtimeErrors', 'consoleErrors', 'failedRequests', 'steps', 'poorVitals', 'screenshot']);
export const PAGE_SECTIONS = Object.freeze(['environment', 'performance', 'storage', 'dom']);

export const ENUMS = Object.freeze({
  source: ['extension', 'console'],
  stoppedReason: ['time-limit', null],
  stepType: ['click', 'input', 'change', 'submit', 'navigate', 'key'],
  stepKey: ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
  errorType: ['error', 'unhandledrejection'],
  level: ['log', 'info', 'warn', 'error', 'debug'],
  networkType: ['fetch', 'xhr', 'img', 'script', 'css', 'font', 'other'],
  statusUnavailable: ['cross-origin', 'unsupported-browser', 'network-error', 'unknown'],
  rating: ['good', 'needs-improvement', 'poor'],
  reason: ['unsupported-browser', 'no-interaction', 'hidden-at-start', 'no-data'],
  screenshotReason: ['save'],
});

export const METRICS = Object.freeze(['TTFB', 'FCP', 'LCP', 'CLS', 'INP', 'longTasks']);
const RATED_METRICS = ['TTFB', 'FCP', 'LCP', 'CLS', 'INP'];
const CLS_SOURCES_MAX = 5;
const STEP_TEXT_MAX = 80;
const JPEG_PREFIX = 'data:image/jpeg;base64,';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// Empty required arrays must be explained in `notes` (AC-7.1); matched loosely, notes are free English text.
const EMPTY_NOTES = { steps: /step/i, vitals: /metric/i, screenshots: /screenshot/i };
const MAX_ERRORS = 200;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isStr = (v) => typeof v === 'string';
const show = (v) => (v === undefined ? 'undefined' : JSON.stringify(v)?.slice(0, 80) ?? String(v));

export function validateSnapshot(pkg) {
  const errors = [];
  const err = (path, problem) => {
    if (errors.length < MAX_ERRORS) errors.push(`${path}: ${problem}`);
  };
  const expect = (ok, path, problem) => {
    if (!ok) err(path, problem);
    return ok;
  };

  if (!isObject(pkg)) return { ok: false, errors: ['(root): package is not an object'] };

  // Keys: every required key, nothing unknown, in the documented order.
  const keys = Object.keys(pkg);
  for (const key of REQUIRED_KEYS) if (!(key in pkg)) err(key, 'required key missing');
  for (const key of keys) if (!REQUIRED_KEYS.includes(key)) err(key, 'unknown top-level key');
  const known = keys.filter((k) => REQUIRED_KEYS.includes(k));
  const expected = REQUIRED_KEYS.filter((k) => k in pkg);
  if (known.join() !== expected.join()) err('(root)', `wrong key order: ${known.join(', ')}`);

  // Header.
  expect(pkg.schemaVersion === SCHEMA_VERSION, 'schemaVersion', `expected ${SCHEMA_VERSION}, got ${show(pkg.schemaVersion)}`);
  expect(isStr(pkg.extensionVersion), 'extensionVersion', 'not a string');
  expect(ENUMS.source.includes(pkg.source), 'source', `not in enum: ${show(pkg.source)}`);
  for (const key of ['collectedAt', 'recordingStartedAt']) {
    expect(pkg[key] === null || (isStr(pkg[key]) && ISO.test(pkg[key])), key, `not an ISO string or null: ${show(pkg[key])}`);
  }
  expect(ENUMS.stoppedReason.includes(pkg.recordingStoppedReason), 'recordingStoppedReason', `not in enum: ${show(pkg.recordingStoppedReason)}`);
  expect(pkg.timeOrigin === null || isNum(pkg.timeOrigin), 'timeOrigin', 'not a number or null');

  const limits = isObject(pkg.limits) ? pkg.limits : {};
  if (expect(isObject(pkg.limits), 'limits', 'not an object')) {
    for (const key of LIMIT_KEYS) expect(isCount(limits[key]), `limits.${key}`, `not a non-negative integer: ${show(limits[key])}`);
  }
  if (expect(isObject(pkg.truncated), 'truncated', 'not an object')) {
    for (const key of TRUNCATED_KEYS) expect(typeof pkg.truncated[key] === 'boolean', `truncated.${key}`, 'not a boolean');
  }

  const notes = Array.isArray(pkg.notes) ? pkg.notes : [];
  if (expect(Array.isArray(pkg.notes), 'notes', 'not an array')) {
    pkg.notes.forEach((n, i) => expect(isStr(n), `notes[${i}]`, 'not a string'));
  }
  const noteMatches = (re) => notes.some((n) => isStr(n) && re.test(n));

  // documents[]: `doc` of every record and metric points into this array.
  const documents = Array.isArray(pkg.documents) ? pkg.documents : [];
  expect(Array.isArray(pkg.documents), 'documents', 'not an array');
  documents.forEach((d, i) => validateDocument(d, i, documents.length, expect, err));

  const inDocs = (doc) => Number.isInteger(doc) && doc >= 0 && doc < documents.length;

  // Records.
  const arrays = {};
  for (const key of [...RECORD_KEYS, 'vitals', 'screenshots']) {
    arrays[key] = Array.isArray(pkg[key]) ? pkg[key] : [];
    expect(Array.isArray(pkg[key]), key, 'not an array');
  }
  for (const key of RECORD_KEYS) {
    const list = arrays[key];
    if (isCount(limits[key])) expect(list.length <= limits[key], key, `${list.length} entries over limits.${key} ${limits[key]}`);
    list.forEach((r, i) => {
      const path = `${key}[${i}]`;
      if (!expect(isObject(r), path, 'not an object')) return;
      expect(isNum(r.t), `${path}.t`, `not a number: ${show(r.t)}`);
      expect(inDocs(r.doc), `${path}.doc`, `not an index of documents: ${show(r.doc)}`);
      RECORD_CHECKS[key](r, path, expect, limits);
    });
    // `kept` per document = records of that document in the package.
    documents.forEach((d, i) => {
      if (!isObject(d?.kept)) return;
      const n = list.filter((r) => r?.doc === i).length;
      expect(d.kept[key] === n, `documents[${i}].kept.${key}`, `${show(d.kept[key])}, but the package has ${n}`);
    });
  }
  const previews = arrays.network.reduce((sum, r) => sum + (isStr(r?.responseBodyPreview) ? r.responseBodyPreview.length : 0), 0);
  if (isCount(limits.responseBodyTotalChars)) {
    expect(previews <= limits.responseBodyTotalChars, 'network', `response previews ${previews} chars over limits.responseBodyTotalChars`);
  }

  // vitals[]: one entry per document with data.
  const vitalDocs = new Set();
  arrays.vitals.forEach((v, i) => {
    const path = `vitals[${i}]`;
    if (!expect(isObject(v), path, 'not an object')) return;
    if (expect(inDocs(v.doc), `${path}.doc`, `not an index of documents: ${show(v.doc)}`)) {
      expect(!vitalDocs.has(v.doc), `${path}.doc`, `second vitals entry for document ${v.doc}`);
      vitalDocs.add(v.doc);
    }
    for (const name of METRICS) validateMetric(v[name], name, `${path}.${name}`, expect, limits);
  });

  // screenshots[] metadata, bytes in attachments (PB-2 A).
  const attachments = isObject(pkg.attachments) ? pkg.attachments : {};
  expect(isObject(pkg.attachments), 'attachments', 'not an object');
  const referenced = new Set();
  arrays.screenshots.forEach((s, i) => {
    const path = `screenshots[${i}]`;
    if (!expect(isObject(s), path, 'not an object')) return;
    expect(s.t === null || isNum(s.t), `${path}.t`, 'not a number or null');
    expect(inDocs(s.doc), `${path}.doc`, `not an index of documents: ${show(s.doc)}`);
    expect(ENUMS.screenshotReason.includes(s.reason), `${path}.reason`, `not in enum: ${show(s.reason)}`);
    expect(s.mime === 'image/jpeg', `${path}.mime`, `not image/jpeg: ${show(s.mime)}`);
    for (const dim of ['width', 'height']) expect(s[dim] === null || (Number.isInteger(s[dim]) && s[dim] > 0), `${path}.${dim}`, 'not a positive integer or null');
    expect(isCount(s.bytes), `${path}.bytes`, 'not a non-negative integer');
    if (isCount(limits.screenshotBytes) && isCount(s.bytes)) {
      expect(s.bytes <= limits.screenshotBytes, `${path}.bytes`, `${s.bytes} over limits.screenshotBytes`);
    }
    if ('dataUrl' in s) err(`${path}.dataUrl`, 'image bytes belong in attachments');
    if (s.attachment !== undefined) {
      if (expect(isStr(s.attachment) && s.attachment in attachments, `${path}.attachment`, `no such key in attachments: ${show(s.attachment)}`)) {
        referenced.add(s.attachment);
      }
    }
  });
  for (const [id, value] of Object.entries(attachments)) {
    expect(isStr(value) && value.startsWith(JPEG_PREFIX), `attachments.${id}`, 'not a JPEG data URL');
    expect(referenced.has(id), `attachments.${id}`, 'not referenced by any screenshot');
  }

  // consoleLogs, runtimeErrors and network may be empty without a note (nothing happened).
  for (const [key, re] of Object.entries(EMPTY_NOTES)) {
    if (Array.isArray(pkg[key]) && pkg[key].length === 0) expect(noteMatches(re), key, 'empty without a note explaining why');
  }

  // Page sections of the current document: object, or null explained in notes.
  for (const section of PAGE_SECTIONS) {
    if (!(section in pkg)) continue;
    if (pkg[section] === null) expect(noteMatches(new RegExp(`\\b${section}\\b`)), section, 'null without a note');
    else expect(isObject(pkg[section]), section, 'not an object or null');
  }

  // overview counts what is in the package (after limits).
  if (expect(isObject(pkg.overview), 'overview', 'not an object')) {
    const o = pkg.overview;
    const ovKeys = Object.keys(o);
    expect(ovKeys.join() === OVERVIEW_KEYS.join(), 'overview', `keys ${ovKeys.join(', ')}, expected ${OVERVIEW_KEYS.join(', ')}`);
    for (const key of OVERVIEW_KEYS.slice(0, -1)) expect(isCount(o[key]), `overview.${key}`, 'not a non-negative integer');
    expect(typeof o.screenshot === 'boolean', 'overview.screenshot', 'not a boolean');
    const failed = (r) => (isNum(r?.status) && r.status >= 400) || (r?.error !== null && r?.error !== undefined);
    const poor = arrays.vitals.reduce((sum, v) => sum + RATED_METRICS.filter((m) => v?.[m]?.rating === 'poor').length, 0);
    const actual = {
      runtimeErrors: arrays.runtimeErrors.length,
      consoleErrors: arrays.consoleLogs.filter((r) => r?.level === 'error').length,
      failedRequests: arrays.network.filter(failed).length,
      steps: arrays.steps.length,
      poorVitals: poor,
      screenshot: arrays.screenshots.length > 0,
    };
    for (const key of OVERVIEW_KEYS) {
      if (key in o) expect(o[key] === actual[key], `overview.${key}`, `${show(o[key])}, but the package has ${show(actual[key])}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// Throws with all errors listed; convenient in e2e (`assertValidSnapshot(JSON.parse(text))`).
export function assertValidSnapshot(pkg) {
  const { ok, errors } = validateSnapshot(pkg);
  if (!ok) throw new Error(`Snapshot package does not match schema v${SCHEMA_VERSION}:\n${errors.join('\n')}`);
}

// `status` is a positive HTTP status, or null/0 explained by `statusUnavailable` (or a request `error`); never a bare 0 (AC-4.3).
function validateStatus(r, path, expect, { allowError }) {
  const explained = r.statusUnavailable !== undefined || (allowError && r.error !== null && r.error !== undefined);
  if (r.statusUnavailable !== undefined) {
    expect(ENUMS.statusUnavailable.includes(r.statusUnavailable), `${path}.statusUnavailable`, `not in enum: ${show(r.statusUnavailable)}`);
    expect(r.status === null, `${path}.statusUnavailable`, `present next to status ${show(r.status)}`);
  }
  if (Number.isInteger(r.status) && r.status > 0) return;
  if (r.status === 0) expect(explained, `${path}.status`, '0 without statusUnavailable or error');
  else if (r.status === null) expect(explained, `${path}.status`, 'null without statusUnavailable');
  else expect(false, `${path}.status`, `not an HTTP status: ${show(r.status)}`);
}

function validateDocument(d, i, total, expect, err) {
  const path = `documents[${i}]`;
  if (!expect(isObject(d), path, 'not an object')) return;
  expect(d.id === i, `${path}.id`, `expected ${i}, got ${show(d.id)}`);
  expect(d.url === null || isStr(d.url), `${path}.url`, 'not a string or null');
  expect(d.timeOrigin === null || isNum(d.timeOrigin), `${path}.timeOrigin`, 'not a number or null');
  expect(d.navigationType === null || isStr(d.navigationType), `${path}.navigationType`, 'not a string or null');
  expect('status' in d, `${path}.status`, 'required key missing');
  validateStatus(d, path, expect, { allowError: false });
  for (const key of ['recorded', 'flushed', 'current']) expect(typeof d[key] === 'boolean', `${path}.${key}`, 'not a boolean');
  if (d.current === true) expect(i === total - 1, `${path}.current`, 'the current document is not the last one');
  for (const group of ['counts', 'kept']) {
    if (!expect(isObject(d[group]), `${path}.${group}`, 'not an object')) continue;
    for (const key of RECORD_KEYS) expect(isCount(d[group][key]), `${path}.${group}.${key}`, 'not a non-negative integer');
  }
  if (isObject(d.counts) && isObject(d.kept)) {
    for (const key of RECORD_KEYS) {
      if (isCount(d.kept[key]) && isCount(d.counts[key]) && d.kept[key] > d.counts[key]) err(`${path}.kept.${key}`, 'more than counts');
    }
  }
}

const optional = (r, key, test, path, expect, what) => {
  if (key in r) expect(test(r[key]), `${path}.${key}`, `${what}: ${show(r[key])}`);
};

const RECORD_CHECKS = {
  steps(r, path, expect) {
    expect(ENUMS.stepType.includes(r.type), `${path}.type`, `not in enum: ${show(r.type)}`);
    // Privacy at the source (AC-3.4): never a value, no length of a password, only whitelisted keys.
    expect(!('value' in r), `${path}.value`, 'steps never carry field values');
    if (r.inputType === 'password') expect(!('valueLength' in r), `${path}.valueLength`, 'present for a password field');
    optional(r, 'selector', (v) => v === null || isStr(v), path, expect, 'not a string');
    optional(r, 'text', (v) => isStr(v) && v.length <= STEP_TEXT_MAX, path, expect, `not a string ≤ ${STEP_TEXT_MAX}`);
    optional(r, 'inputType', isStr, path, expect, 'not a string');
    optional(r, 'valueLength', isCount, path, expect, 'not a non-negative integer');
    optional(r, 'checked', (v) => typeof v === 'boolean', path, expect, 'not a boolean');
    optional(r, 'key', (v) => ENUMS.stepKey.includes(v), path, expect, 'not a whitelisted key');
    optional(r, 'url', isStr, path, expect, 'not a string');
    optional(r, 'via', isStr, path, expect, 'not a string');
    if (r.type === 'navigate') expect(isStr(r.url), `${path}.url`, 'navigate step without url');
  },
  runtimeErrors(r, path, expect, limits) {
    expect(ENUMS.errorType.includes(r.type), `${path}.type`, `not in enum: ${show(r.type)}`);
    expect(isStr(r.message), `${path}.message`, 'not a string');
    stackCheck(r, path, expect, limits);
    optional(r, 'frame', isStr, path, expect, 'not a string');
  },
  consoleLogs(r, path, expect, limits) {
    expect(ENUMS.level.includes(r.level), `${path}.level`, `not in enum: ${show(r.level)}`);
    expect(Array.isArray(r.args), `${path}.args`, 'not an array');
    stackCheck(r, path, expect, limits);
    optional(r, 'frame', isStr, path, expect, 'not a string');
  },
  network(r, path, expect, limits) {
    expect(ENUMS.networkType.includes(r.type), `${path}.type`, `not in enum: ${show(r.type)}`);
    expect(isStr(r.method), `${path}.method`, 'not a string');
    expect(isStr(r.url), `${path}.url`, 'not a string');
    expect('status' in r, `${path}.status`, 'required key missing');
    validateStatus(r, path, expect, { allowError: true });
    expect('sizeBytes' in r && (r.sizeBytes === null || isCount(r.sizeBytes)), `${path}.sizeBytes`, `not a non-negative integer or null: ${show(r.sizeBytes)}`);
    expect('error' in r, `${path}.error`, 'required key missing');
    const hasPreview = 'responseBodyPreview' in r;
    expect(hasPreview === ('responseBodyTruncated' in r), `${path}.responseBodyTruncated`, 'comes only together with responseBodyPreview');
    if (hasPreview) {
      const max = isCount(limits.responseBodyChars) ? limits.responseBodyChars : Infinity;
      expect(isStr(r.responseBodyPreview) && r.responseBodyPreview.length <= max, `${path}.responseBodyPreview`, `not a string ≤ limits.responseBodyChars`);
      expect(typeof r.responseBodyTruncated === 'boolean', `${path}.responseBodyTruncated`, 'not a boolean');
    }
  },
};

function stackCheck(r, path, expect, limits) {
  if (!('stack' in r) || r.stack === null) return;
  const max = isCount(limits.stackChars) ? limits.stackChars : Infinity;
  expect(isStr(r.stack) && r.stack.length <= max, `${path}.stack`, 'not a string ≤ limits.stackChars');
}

function validateMetric(m, name, path, expect, limits) {
  if (!expect(isObject(m), path, 'metric missing (unavailable metrics are { available: false, reason })')) return;
  if (!expect(typeof m.available === 'boolean', `${path}.available`, 'not a boolean')) return;
  if (m.available === false) {
    expect(ENUMS.reason.includes(m.reason), `${path}.reason`, `not in enum: ${show(m.reason)}`);
    expect(!('value' in m) && !('items' in m), path, 'unavailable metric carries a value');
    return;
  }
  if (name === 'longTasks') {
    if (!expect(Array.isArray(m.items), `${path}.items`, 'not an array')) return;
    if (isCount(limits.longTasks)) expect(m.items.length <= limits.longTasks, `${path}.items`, `${m.items.length} over limits.longTasks`);
    m.items.forEach((item, i) => {
      expect(isObject(item) && isNum(item.t) && isNum(item.duration), `${path}.items[${i}]`, 'needs numeric t and duration');
    });
    return;
  }
  expect(isNum(m.value) && m.value >= 0, `${path}.value`, `not a non-negative number: ${show(m.value)}`);
  expect(ENUMS.rating.includes(m.rating), `${path}.rating`, `not in enum: ${show(m.rating)}`);
  // CLS without any shift: value 0 and no moment (t null) — the only metric allowed to have no `t`.
  const tOk = isNum(m.t) || (name === 'CLS' && m.value === 0 && m.t === null);
  expect(tOk, `${path}.t`, `not a number: ${show(m.t)}`);
  expect(typeof m.finalized === 'boolean', `${path}.finalized`, 'not a boolean');
  if (name === 'CLS' && 'sources' in m) {
    expect(Array.isArray(m.sources) && m.sources.length <= CLS_SOURCES_MAX, `${path}.sources`, `not an array ≤ ${CLS_SOURCES_MAX}`);
  }
}
