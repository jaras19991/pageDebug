// Schema validator of the v4 snapshot package (design E3 D10, „Schema paczki”; E2 AC-7.1, AC-7.2; E3 spec „Dane”, AC-4.3,
// AC-4.4, AC-5.2, AC-6.4). One module for unit tests (fixture, exportPackage output) and e2e (a real saved zip). No
// dependencies and deliberately no import of src/lib: the lists below are the contract from docs/snapshot-schema.md,
// so a drift in the implementation shows up as an error instead of being copied into the check.
//
// validateSnapshot(pkg) → { ok, errors } where every error is "<path>: <problem>" (e.g. "network[3].status: …").
// validateZipEntries(names, pkg?) → { ok, errors } for the entry names of the zip, in order.
// The package must be the REDACTED one (snapshot.json): `redaction.masked` has to match the markers in it.

export const SCHEMA_VERSION = 4;

// Top-level keys in the order of snapshot.json (AC-7.2, E3 D10). All are required (AC-7.1).
export const REQUIRED_KEYS = Object.freeze([
  'schemaVersion', 'extensionVersion', 'source', 'collectedAt', 'recordingStartedAt', 'recordingStoppedReason', 'timeOrigin',
  'overview', 'redaction', 'limits', 'truncated',
  'documents', 'notes', 'steps', 'runtimeErrors', 'network', 'vitals', 'screenshots', 'consoleLogs',
  'environment', 'performance', 'storage', 'dom',
]);

export const RECORD_KEYS = Object.freeze(['consoleLogs', 'runtimeErrors', 'network', 'steps']);
export const LIMIT_KEYS = Object.freeze([
  'consoleLogs', 'runtimeErrors', 'network', 'steps', 'entryChars', 'stackChars',
  'responseBodyChars', 'responseBodyTotalChars', 'screenshotBytes', 'longTasks', 'html', 'packageBytes',
]);
// Records and previews (v3), then the size budget's sections (v4).
export const TRUNCATED_KEYS = Object.freeze([...RECORD_KEYS, 'responseBodies', 'html', 'resources', 'dom', 'storage', 'stacks']);
export const OVERVIEW_KEYS = Object.freeze(['runtimeErrors', 'consoleErrors', 'failedRequests', 'steps', 'poorVitals', 'screenshot']);
export const PAGE_SECTIONS = Object.freeze(['environment', 'performance', 'storage', 'dom']);
export const REDACTION_KEYS = Object.freeze(['rulesVersion', 'disabledRules', 'masked']);
export const RULES_VERSION = 1;
// Rules a developer option may turn off (`rulesVersion: 1`); Always rules never appear in `disabledRules` (AC-4.5).
export const DEFAULT_RULES = Object.freeze(['email', 'phone', 'html-structure']);
// Sections that may carry markers: keys of `redaction.masked`.
export const MASKED_SECTIONS = Object.freeze([
  'documents', 'notes', 'steps', 'runtimeErrors', 'network', 'vitals', 'consoleLogs', 'environment', 'performance', 'storage', 'dom',
]);
// Entries of the zip, in order; the image only with a screenshot (AC-6.4).
export const ZIP_ENTRIES = Object.freeze(['snapshot.json', 'summary.md', 'screenshot.jpg']);
export const SCREENSHOT_FILE = 'screenshot.jpg';
export const MARKER_PREFIX = '[redacted:';

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
const COOKIE_HASH = /^[0-9a-f]{8}$/;
const COOKIE_KEYS = ['name', 'sizeBytes', 'valueHash'];
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
  for (const key of keys) {
    if (key === 'attachments') err(key, `removed in v${SCHEMA_VERSION} (the image is ${SCREENSHOT_FILE} in the zip)`);
    else if (!REQUIRED_KEYS.includes(key)) err(key, 'unknown top-level key');
  }
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

  // screenshots[]: metadata only, the bytes are one zip entry (AC-6.4).
  expect(arrays.screenshots.length <= 1, 'screenshots', `${arrays.screenshots.length} entries, the zip holds one image`);
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
    expect(s.file === SCREENSHOT_FILE, `${path}.file`, `not ${JSON.stringify(SCREENSHOT_FILE)}: ${show(s.file)}`);
    expect(s.maskedFields === null || isCount(s.maskedFields), `${path}.maskedFields`, `not a non-negative integer or null: ${show(s.maskedFields)}`);
    if ('dataUrl' in s) err(`${path}.dataUrl`, `image bytes belong in ${SCREENSHOT_FILE}`);
    if ('attachment' in s) err(`${path}.attachment`, `v3 field, v4 names the zip entry in file`);
  });

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
  const redaction = validateRedaction(pkg, expect);
  if (isObject(pkg.storage)) validateStorage(pkg.storage, expect);
  if (isObject(pkg.dom)) validateDom(pkg.dom, limits, pkg.truncated, redaction, expect, err);

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
    if (r.inputType === 'checkbox' || r.inputType === 'radio') {
      expect(!('valueLength' in r), `${path}.valueLength`, 'present for a checkbox or radio');
    }
    optional(r, 'selector', (v) => v === null || isStr(v), path, expect, 'not a string');
    optional(r, 'text', (v) => isStr(v) && v.length <= STEP_TEXT_MAX, path, expect, `not a string ≤ ${STEP_TEXT_MAX}`);
    optional(r, 'inputType', isStr, path, expect, 'not a string');
    optional(r, 'valueLength', isCount, path, expect, 'not a non-negative integer');
    // File inputs (E3-IN4): only `change` with the number of files; never a length (of a path) and no `input` step.
    if (r.inputType === 'file') {
      expect(r.type === 'change', `${path}.type`, `${show(r.type)} step on a file input (only change is recorded)`);
      expect(!('valueLength' in r), `${path}.valueLength`, 'present for a file input (fileCount says how many files)');
      expect(isCount(r.fileCount), `${path}.fileCount`, `not a non-negative integer: ${show(r.fileCount)}`);
    } else {
      expect(!('fileCount' in r), `${path}.fileCount`, 'present for a field that is not a file input');
    }
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
    // An entry over limits.entryChars is capped as a whole to { truncated: true, preview } (v1, docs/snapshot-schema.md).
    if (isObject(r.args)) {
      expect(r.args.truncated === true && isStr(r.args.preview), `${path}.args`, 'object args must be { truncated: true, preview }');
      if (isCount(limits.entryChars) && isStr(r.args.preview)) {
        expect(r.args.preview.length <= limits.entryChars, `${path}.args.preview`, 'longer than limits.entryChars');
      }
    } else if (expect(Array.isArray(r.args), `${path}.args`, 'not an array or { truncated, preview }')) {
      // An Element is summarized as { tagName, id, className, structure } (structure without texts, E3-T0a/T3a).
      r.args.forEach((arg, j) => {
        expect(!(isObject(arg) && 'tagName' in arg && 'outerHTML' in arg), `${path}.args[${j}].outerHTML`, 'element summary carries outerHTML (v4: structure)');
      });
    }
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

// `redaction` (AC-4.3, AC-4.5): no values, rules v1, only Default rules turned off, `masked` = markers in snapshot.json.
function validateRedaction(pkg, expect) {
  const r = pkg.redaction;
  if (!expect(isObject(r), 'redaction', 'not an object')) return { disabledRules: [] };
  const keys = Object.keys(r);
  expect(keys.join() === REDACTION_KEYS.join(), 'redaction', `keys ${keys.join(', ')}, expected ${REDACTION_KEYS.join(', ')}`);
  expect(r.rulesVersion === RULES_VERSION, 'redaction.rulesVersion', `expected ${RULES_VERSION}, got ${show(r.rulesVersion)}`);
  const disabled = Array.isArray(r.disabledRules) ? r.disabledRules : [];
  if (expect(Array.isArray(r.disabledRules), 'redaction.disabledRules', 'not an array')) {
    disabled.forEach((rule, i) => {
      expect(DEFAULT_RULES.includes(rule), `redaction.disabledRules[${i}]`, `not a rule that can be turned off: ${show(rule)}`);
      expect(disabled.indexOf(rule) === i, `redaction.disabledRules[${i}]`, `listed twice: ${show(rule)}`);
    });
  }
  if (!expect(isObject(r.masked), 'redaction.masked', 'not an object')) return { disabledRules: disabled };
  let declared = 0;
  for (const [section, n] of Object.entries(r.masked)) {
    expect(MASKED_SECTIONS.includes(section), `redaction.masked.${section}`, 'not a section of the package');
    if (expect(Number.isInteger(n) && n > 0, `redaction.masked.${section}`, `not a positive integer: ${show(n)}`)) declared += n;
  }
  // Per section and in total: every marker is counted once, sections with 0 are absent.
  for (const section of MASKED_SECTIONS) {
    const found = countMarkers(JSON.stringify(pkg[section]));
    const listed = Number.isInteger(r.masked[section]) ? r.masked[section] : 0;
    expect(found === listed, `redaction.masked.${section}`, `${listed}, but the section has ${found} markers`);
  }
  const total = countMarkers(JSON.stringify(pkg, null, 2));
  expect(declared === total, 'redaction.masked', `sum ${declared}, but snapshot.json has ${total} markers`);
  return { disabledRules: disabled };
}

function countMarkers(text) {
  let n = 0;
  if (typeof text !== 'string') return n;
  for (let i = text.indexOf(MARKER_PREFIX); i !== -1; i = text.indexOf(MARKER_PREFIX, i + MARKER_PREFIX.length)) n++;
  return n;
}

// `storage.cookies` (AC-4.4): names, sizes and 8-hex hashes only; the raw `document.cookie` never stays.
function validateStorage(storage, expect) {
  if (!('cookies' in storage)) return;
  const cookies = storage.cookies;
  if (isStr(cookies)) {
    expect(false, 'storage.cookies', 'raw cookie string (v4: [{ name, sizeBytes, valueHash }])');
    return;
  }
  if (!expect(Array.isArray(cookies), 'storage.cookies', `not an array: ${show(cookies)}`)) return;
  let sum = 0;
  cookies.forEach((c, i) => {
    const path = `storage.cookies[${i}]`;
    if (!expect(isObject(c), path, 'not an object')) return;
    const keys = Object.keys(c);
    expect(keys.join() === COOKIE_KEYS.join(), path, `keys ${keys.join(', ')}, expected ${COOKIE_KEYS.join(', ')}`);
    expect(isStr(c.name), `${path}.name`, 'not a string');
    if (expect(isCount(c.sizeBytes), `${path}.sizeBytes`, 'not a non-negative integer')) sum += c.sizeBytes;
    expect(isStr(c.valueHash) && COOKIE_HASH.test(c.valueHash), `${path}.valueHash`, `not 8 hex characters: ${show(c.valueHash)}`);
  });
  if (expect(isCount(storage.cookiesTotalBytes), 'storage.cookiesTotalBytes', `not a non-negative integer: ${show(storage.cookiesTotalBytes)}`)) {
    expect(storage.cookiesTotalBytes >= sum, 'storage.cookiesTotalBytes', `${storage.cookiesTotalBytes} less than the cookies (${sum})`);
  }
}

// `dom` (AC-5.2, spec „Dane”): structure without texts and limited, full HTML only with the developer option,
// no outerHTML, form values and image alt / iframe title texts as lengths; `structure` and `fullHtml` are the last keys.
function validateDom(dom, limits, truncated, redaction, expect, err) {
  const keys = Object.keys(dom);
  expect(keys.slice(-2).join() === 'structure,fullHtml', 'dom', `structure and fullHtml are not the last keys: ${keys.join(', ')}`);
  if (isObject(dom.html) && 'outerHTML' in dom.html) err('dom.html.outerHTML', 'removed in v4 (dom.structure)');
  if (expect(dom.structure === null || isStr(dom.structure), 'dom.structure', 'not a string or null') && isStr(dom.structure)) {
    if (isCount(limits.html) && truncated?.html !== true) {
      expect(dom.structure.length <= limits.html, 'dom.structure', `${dom.structure.length} characters over limits.html without truncated.html`);
    }
  }
  if (expect(dom.fullHtml === null || isStr(dom.fullHtml), 'dom.fullHtml', 'not a string or null') && isStr(dom.fullHtml)) {
    expect(redaction.disabledRules.includes('html-structure'), 'dom.fullHtml', 'full HTML without html-structure in redaction.disabledRules');
  }
  // Review F7: alt and title texts may name a person; v4 keeps only their lengths.
  const textAsLength = (list, name, attr, lengthKey) => {
    if (!Array.isArray(list)) return;
    list.forEach((item, i) => {
      if (!isObject(item)) return;
      const path = `dom.${name}[${i}]`;
      const message = `text of ${attr} never goes to the package (v4: ${lengthKey})`;
      expect(!(attr in item), `${path}.${attr}`, message);
      if (lengthKey in item) expect(isCount(item[lengthKey]), `${path}.${lengthKey}`, `not a non-negative integer: ${show(item[lengthKey])}`);
      if (isObject(item.attributes)) expect(!(attr in item.attributes), `${path}.attributes.${attr}`, message);
    });
  };
  textAsLength(dom.images, 'images', 'alt', 'altLength');
  textAsLength(dom.iframes, 'iframes', 'title', 'titleLength');
  if (!('forms' in dom)) return;
  if (!expect(Array.isArray(dom.forms), 'dom.forms', 'not an array')) return;
  dom.forms.forEach((form, i) => {
    if (!isObject(form) || !Array.isArray(form.elements)) return;
    form.elements.forEach((el, j) => {
      const path = `dom.forms[${i}].elements[${j}]`;
      if (!isObject(el)) return;
      expect(!('value' in el), `${path}.value`, 'form fields never carry values (v4: valueLength)');
      if ('valueLength' in el) {
        expect(isCount(el.valueLength), `${path}.valueLength`, 'not a non-negative integer');
        expect(!(isStr(el.type) && el.type.toLowerCase() === 'password'), `${path}.valueLength`, 'present for a password field');
      }
      // File inputs (E3-T8): the number of files, never the length of the `C:\fakepath\…` value.
      if (isStr(el.type) && el.type.toLowerCase() === 'file') {
        expect(!('valueLength' in el), `${path}.valueLength`, 'present for a file input (fileCount says how many files)');
        if ('fileCount' in el) expect(isCount(el.fileCount), `${path}.fileCount`, `not a non-negative integer: ${show(el.fileCount)}`);
      } else {
        expect(!('fileCount' in el), `${path}.fileCount`, 'present for a field that is not a file input');
      }
    });
  });
}

/**
 * Entry names of the package zip, in order (AC-6.4): snapshot.json, summary.md, then screenshot.jpg only with a
 * screenshot. With `pkg` (the parsed snapshot.json) the image entry must match `screenshots[]`.
 * @param {string[]} names
 * @param {object} [pkg]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateZipEntries(names, pkg) {
  const errors = [];
  if (!Array.isArray(names)) return { ok: false, errors: ['(zip): entry list is not an array'] };
  const [json, summary, ...rest] = names;
  if (json !== ZIP_ENTRIES[0]) errors.push(`(zip)[0]: expected ${ZIP_ENTRIES[0]}, got ${show(json)}`);
  if (summary !== ZIP_ENTRIES[1]) errors.push(`(zip)[1]: expected ${ZIP_ENTRIES[1]}, got ${show(summary)}`);
  if (rest.length > 1 || (rest.length === 1 && rest[0] !== ZIP_ENTRIES[2])) {
    errors.push(`(zip): unexpected entries after ${ZIP_ENTRIES[1]}: ${rest.join(', ')}`);
  }
  if (pkg !== undefined) {
    const shot = Array.isArray(pkg?.screenshots) && pkg.screenshots.length > 0;
    const image = names.includes(SCREENSHOT_FILE);
    if (shot && !image) errors.push(`(zip): screenshots[] names ${SCREENSHOT_FILE}, but the zip has no such entry`);
    if (!shot && image) errors.push(`(zip): ${SCREENSHOT_FILE} present, but screenshots[] is empty`);
  }
  return { ok: errors.length === 0, errors };
}

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
