// Record queries over a package (design E4 D1, E4-T1a): absolute and relative time, steps, error groups, failed and
// filtered network requests, one timeline. One source for summary.md, the viewer and the MCP server (AC-5.3).
// Reads defensively: a missing or wrongly typed field is "no data", never an exception (any schema version ≥ 2 shape;
// v1 is migrated before it gets here). Pure: no chrome.*, no DOM, no clock. Syntax follows the src/page generator rules.

export const QUERY_LIMITS = Object.freeze({
  // Characters kept of a message built from a console argument (also the error grouping key).
  messageChars: 1000,
  // Stack characters scanned for the first frame.
  stackScanChars: 4000,
  // Characters kept of a file name in a frame.
  frameFileChars: 200,
  // A JSON-string argument longer than this is not parsed, only unquoted.
  jsonParseChars: 8192,
});

const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx'];
// Timeline order of records at the same instant: a document boundary first.
const KIND_RANK = { document: 0, step: 1, request: 2, error: 3 };

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function list(s, key) {
  return isObject(s) && Array.isArray(s[key]) ? s[key] : [];
}

function cap(text, max) {
  return text.length > max ? text.slice(0, max) : text;
}

// The document a record belongs to: by index when ids follow indices (always in v2+), otherwise by id.
function documentOf(s, docId) {
  const docs = list(s, 'documents');
  const byIndex = Number.isInteger(docId) ? docs[docId] : undefined;
  if (isObject(byIndex) && byIndex.id === docId) return byIndex;
  for (const d of docs) if (isObject(d) && d.id === docId) return d;
  return null;
}

/** Recording start (epoch ms): `recordingStartedAt`, else the first document's `timeOrigin`, else null. */
export function recordingStartMs(s) {
  if (!isObject(s)) return null;
  if (typeof s.recordingStartedAt === 'string') {
    const ms = Date.parse(s.recordingStartedAt);
    if (Number.isFinite(ms)) return ms;
  }
  const first = list(s, 'documents')[0];
  return isObject(first) && Number.isFinite(first.timeOrigin) ? first.timeOrigin : null;
}

/** Epoch ms of a record: its own document's `timeOrigin` + `t`; null when either is unknown. */
export function absTime(s, rec) {
  if (!isObject(rec) || !Number.isFinite(rec.t)) return null;
  const doc = documentOf(s, rec.doc);
  return doc && Number.isFinite(doc.timeOrigin) ? doc.timeOrigin + rec.t : null;
}

function relFromAt(start, at) {
  return start === null || at === null ? null : (at - start) / 1000;
}

/** Seconds from the recording start to the record; null when unknown. */
export function relSeconds(s, rec) {
  return relFromAt(recordingStartMs(s), absTime(s, rec));
}

function errorLike(value) {
  return isObject(value) && typeof value.message === 'string';
}

function errorText(value) {
  return typeof value.name === 'string' && value.name !== '' ? `${value.name}: ${value.message}` : value.message;
}

// A console argument as text: strings were serialized as JSON strings (v2+), objects may be errors or cut previews.
function argText(arg) {
  if (typeof arg === 'string') {
    const first = arg[0];
    if ((first === '"' || first === '{') && arg.length <= QUERY_LIMITS.jsonParseChars) {
      try {
        const parsed = JSON.parse(arg);
        if (typeof parsed === 'string') return parsed;
        if (errorLike(parsed)) return errorText(parsed);
      } catch {
        // not JSON; the raw text
      }
    } else if (first === '"' && arg.length > QUERY_LIMITS.jsonParseChars) {
      return arg.slice(1, QUERY_LIMITS.messageChars + 1);
    }
    return arg;
  }
  if (errorLike(arg)) return errorText(arg);
  if (isObject(arg) && arg.truncated === true && typeof arg.preview === 'string') return arg.preview;
  if (arg === undefined) return '';
  try {
    return String(JSON.stringify(arg) ?? '');
  } catch {
    return '';
  }
}

/**
 * Text of a console entry: its first argument (string, unwrapped JSON string, error, cut preview), capped. A long entry
 * keeps `{ truncated, preview }` in place of the list (E4-FIX2): its preview is the text.
 */
export function consoleText(entry) {
  if (!isObject(entry)) return '';
  if (isObject(entry.args) && entry.args.truncated === true) return typeof entry.args.preview === 'string' ? cap(entry.args.preview, QUERY_LIMITS.messageChars) : '';
  if (!Array.isArray(entry.args) || !entry.args.length) return '';
  return cap(argText(entry.args[0]), QUERY_LIMITS.messageChars);
}

function fileOf(location) {
  const noQuery = location.replace(/[?#].*$/, '');
  const parts = noQuery.split('/');
  let name = parts[parts.length - 1];
  if (name === '' && parts.length > 1) name = parts[parts.length - 2];
  return cap(name || noQuery, QUERY_LIMITS.frameFileChars);
}

// `location:line:col` → `file:line:col`; null when the text has no line and column.
function frameOf(location) {
  const m = /^(.*):(\d+):(\d+)$/.exec(location.trim());
  return m && m[1] !== '' ? `${fileOf(m[1])}:${m[2]}:${m[3]}` : null;
}

/**
 * First stack frame as `file:line:col` (V8 `at fn (loc)` / `at loc`, Firefox `fn@loc`); else the `fallback`
 * `{ filename, lineno, colno }`; else null.
 */
export function firstFrame(stack, fallback) {
  if (typeof stack === 'string') {
    const lines = stack.slice(0, QUERY_LIMITS.stackScanChars).split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      let frame = null;
      if (line.startsWith('at ')) {
        const paren = /\(([^()]*)\)$/.exec(line);
        frame = frameOf(paren ? paren[1] : line.slice(3));
      } else if (line.includes('@')) {
        frame = frameOf(line.slice(line.indexOf('@') + 1));
      }
      if (frame) return frame;
    }
  }
  if (isObject(fallback) && typeof fallback.filename === 'string' && fallback.filename !== '' && Number.isFinite(fallback.lineno)) {
    const col = Number.isFinite(fallback.colno) ? fallback.colno : 0;
    return `${fileOf(fallback.filename)}:${fallback.lineno}:${col}`;
  }
  return null;
}

function byAt(a, b) {
  if (a.at === b.at) return 0;
  if (a.at === null) return 1;
  if (b.at === null) return -1;
  return a.at - b.at;
}

/**
 * Runtime errors and console entries with `level: "error"`, chronological (unknown time last, stable):
 * `[{ kind: 'runtime'|'console', doc, t, at, rel, message, frame, stack }]`.
 */
export function errorEvents(s) {
  const start = recordingStartMs(s);
  const out = [];
  for (const e of list(s, 'runtimeErrors')) {
    if (!isObject(e)) continue;
    const at = absTime(s, e);
    out.push({
      kind: 'runtime', doc: e.doc, t: e.t, at, rel: relFromAt(start, at),
      message: typeof e.message === 'string' ? cap(e.message, QUERY_LIMITS.messageChars) : '',
      frame: firstFrame(e.stack, e),
      stack: typeof e.stack === 'string' ? e.stack : null,
    });
  }
  for (const e of list(s, 'consoleLogs')) {
    if (!isObject(e) || e.level !== 'error') continue;
    const at = absTime(s, e);
    const arg = Array.isArray(e.args) ? e.args[0] : undefined;
    // The error's own stack (where it was thrown) before the stack of the console call.
    const stack = errorLike(arg) && typeof arg.stack === 'string' ? arg.stack : typeof e.stack === 'string' ? e.stack : null;
    out.push({
      kind: 'console', doc: e.doc, t: e.t, at, rel: relFromAt(start, at),
      message: consoleText(e),
      frame: firstFrame(stack) ?? firstFrame(e.stack),
      stack,
    });
  }
  return out.sort(byAt);
}

/** Epoch ms of the first error (runtime or console); null when none has a known time. */
export function firstErrorAt(s) {
  let first = null;
  for (const e of errorEvents(s)) if (e.at !== null && (first === null || e.at < first)) first = e.at;
  return first;
}

function stepItem(step, at, rel) {
  const label = typeof step.text === 'string' && step.text !== '' ? step.text : typeof step.selector === 'string' ? step.selector : null;
  const item = { rel, at, type: typeof step.type === 'string' ? step.type : null, label, doc: step.doc, t: step.t };
  if (typeof step.url === 'string') item.url = step.url;
  return item;
}

// All steps as items, chronological (stable).
function allSteps(s) {
  const start = recordingStartMs(s);
  const items = [];
  for (const step of list(s, 'steps')) {
    if (!isObject(step)) continue;
    const at = absTime(s, step);
    items.push(stepItem(step, at, relFromAt(start, at)));
  }
  return items.sort(byAt);
}

// Last step with a known time strictly before `at`; null when none.
function lastStepBefore(steps, at) {
  if (at === null) return null;
  let found = null;
  for (const step of steps) {
    if (step.at === null || step.at >= at) continue;
    if (found === null || step.at >= found.at) found = step;
  }
  return found;
}

/**
 * Last `last` steps: `{ items: [{ rel, at, type, label, url?, doc, t, beforeFirstError }], total }`. Only the last step
 * before the first error has `beforeFirstError: true`.
 */
export function stepList(s, { last = 20 } = {}) {
  const steps = allSteps(s);
  const marked = lastStepBefore(steps, firstErrorAt(s));
  const shown = last >= steps.length ? steps : steps.slice(steps.length - Math.max(0, last));
  return { items: shown.map((step) => ({ ...step, beforeFirstError: step === marked })), total: steps.length };
}

/**
 * Errors grouped by message in order of first occurrence:
 * `{ groups: [{ message, count, firstRel, firstAt, frame, stack, stepBefore }], more }` (`more` = groups not shown).
 */
export function errorGroups(s, { limit = 10 } = {}) {
  const groups = new Map();
  for (const e of errorEvents(s)) {
    const group = groups.get(e.message);
    if (group) group.count++;
    else groups.set(e.message, { message: e.message, count: 1, firstRel: e.rel, firstAt: e.at, frame: e.frame, stack: e.stack, stepBefore: null });
  }
  const all = [...groups.values()];
  const shown = all.slice(0, Math.max(0, limit));
  if (shown.length) {
    const steps = allSteps(s);
    for (const g of shown) g.stepBefore = lastStepBefore(steps, g.firstAt);
  }
  return { groups: shown, more: all.length - shown.length };
}

/** Failed request: `status` ≥ 400 or any `error` (same rule as budget.js and package.js overview). */
export function isFailedRequest(e) {
  return (typeof e?.status === 'number' && e.status >= 400) || (e?.error !== null && e?.error !== undefined);
}

/** `2xx`|`3xx`|`4xx`|`5xx` by status, `error` without a status but with an error, else `unknown`. */
export function statusClass(e) {
  const status = e?.status;
  if (typeof status === 'number' && status >= 200 && status < 600) return STATUS_CLASSES[Math.floor(status / 100) - 2];
  if (e?.error !== null && e?.error !== undefined) return 'error';
  return 'unknown';
}

/** First `limit` failed requests in package order: `{ items: [{ index, entry, at, rel }], total, more }`. */
export function failedRequests(s, { limit = 20 } = {}) {
  const start = recordingStartMs(s);
  const items = [];
  let total = 0;
  list(s, 'network').forEach((entry, index) => {
    if (!isObject(entry) || !isFailedRequest(entry)) return;
    total++;
    if (items.length < limit) {
      const at = absTime(s, entry);
      items.push({ index, entry, at, rel: relFromAt(start, at) });
    }
  });
  return { items, total, more: total - items.length };
}

function rangeOf(range) {
  if (Array.isArray(range)) return { min: range[0], max: range[1] };
  return isObject(range) ? { min: range.min, max: range.max } : null;
}

/**
 * Network entries matching every given filter: `statusClass`, `statusRange` (`[min, max]` or `{ min, max }`, inclusive),
 * `failedOnly`, `type` (exact), `method` and `urlContains` (case-insensitive).
 * `{ items: [{ index, entry }], total }` — `total` = entries in `list` (for "N z M").
 */
export function filterNetwork(list, { statusClass: cls, statusRange, failedOnly, type, method, urlContains } = {}) {
  const entries = Array.isArray(list) ? list : [];
  const range = rangeOf(statusRange);
  const min = range && Number.isFinite(range.min) ? range.min : -Infinity;
  const max = range && Number.isFinite(range.max) ? range.max : Infinity;
  const wantMethod = typeof method === 'string' && method !== '' ? method.toUpperCase() : null;
  const fragment = typeof urlContains === 'string' && urlContains !== '' ? urlContains.toLowerCase() : null;
  const items = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!isObject(entry)) continue;
    if (cls && statusClass(entry) !== cls) continue;
    if (range && !(typeof entry.status === 'number' && entry.status >= min && entry.status <= max)) continue;
    if (failedOnly && !isFailedRequest(entry)) continue;
    if (typeof type === 'string' && type !== '' && entry.type !== type) continue;
    if (wantMethod && (typeof entry.method !== 'string' || entry.method.toUpperCase() !== wantMethod)) continue;
    if (fragment && (typeof entry.url !== 'string' || !entry.url.toLowerCase().includes(fragment))) continue;
    items.push({ index, entry });
  }
  return { items, total: entries.length };
}

/**
 * Steps, errors, failed requests and document boundaries (`{ kind: 'document', doc, url, at, rel }`) sorted by `at`
 * (unknown time last; at the same instant: document, step, request, error).
 */
export function timeline(s) {
  const start = recordingStartMs(s);
  const items = [];
  for (const d of list(s, 'documents')) {
    if (!isObject(d) || !Number.isFinite(d.timeOrigin)) continue;
    items.push({ kind: 'document', doc: d.id, url: typeof d.url === 'string' ? d.url : null, at: d.timeOrigin, rel: relFromAt(start, d.timeOrigin) });
  }
  for (const step of allSteps(s)) items.push({ kind: 'step', ...step });
  for (const e of errorEvents(s)) items.push({ ...e, kind: 'error', source: e.kind });
  for (const r of failedRequests(s, { limit: Infinity }).items) items.push({ kind: 'request', doc: r.entry.doc, ...r });
  return items.sort((a, b) => byAt(a, b) || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}
