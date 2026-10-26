// Redaction of a whole package (E3 D1, D2): the deciding pass, run in the background on the assembled package and
// in the console fallback. Pure and synchronous: no DOM, no chrome.*, no clock. Idempotent: values that already are
// a marker are skipped, so a second pass returns an equal object and `applied: 0`.
//
// A map of the schema says where keys are user data (headers, objects in console arguments, storage, attributes)
// and which strings are URLs; every other string goes through the text pass (fail-safe for fields added later).
// Page sections (storage, cookies, DOM, environment, performance) live in redact-page.js and share the `ctx` below.
//
// The input may come from another realm (the page, in the fallback): it is copied first with this realm's built-ins
// only (Array.isArray, Object.keys, index loops), and everything after that works on the copy.
import { RULES_VERSION, DEFAULT_RULES, MASK_LIMITS, secretKeyRule, maskText, maskUrl, redactRegExp, redactExec, redactTest, redactSlice } from './redact-rules.js';
import { redactPageSections } from './redact-page.js';

export const MARKER_PREFIX = '[redacted:';
const MARKER = /^\[redacted:[a-z0-9_*-]+\]$/;
// A URL field holding something else (no scheme and no leading `/`, `.`, `?`, `#`; or white space, quotes, braces)
// also gets the text pass: `sid=…` or `a.png token=…` are not addresses.
const URL_LIKE = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|[/.?#])[^\s"'<>{}]*$/;

// Top-level keys that are never scanned (D2, AC-5.4): schema metadata, counters, limits, screenshot metadata, and the
// v3 `attachments` (binary data URLs).
const UNTOUCHED = new Set(['schemaVersion', 'extensionVersion', 'source', 'collectedAt', 'recordingStartedAt',
  'recordingStoppedReason', 'timeOrigin', 'overview', 'redaction', 'limits', 'truncated', 'screenshots', 'attachments']);
const PAGE_SECTIONS = new Set(['environment', 'performance', 'storage', 'dom']);

const PHONE = Object.freeze({ phone: true });
// Console arguments (review E3 N14): arrays at any depth are read as key/value pairs, like the arguments themselves.
const CONSOLE = Object.freeze({ phone: true, pairs: true });
const SELECTOR = Object.freeze({ longSecret: false });
const NONE = Object.freeze({});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isScalar = (value) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

// Rule of a `{ name, value }` / `{ key, value }` pair (jQuery serializeArray, key/value lists) whose name is sensitive.
function namedPairRule(map) {
  if (!Object.prototype.hasOwnProperty.call(map, 'value')) return null;
  for (const field of ['name', 'key']) {
    const rule = typeof map[field] === 'string' ? secretKeyRule(map[field]) : null;
    if (rule !== null) return rule;
  }
  return null;
}

// A console argument that names the next one (review E3 N9, N10): one token without white space (`'password'`), or any
// text ending in `:`/`=` (`'password:'`, `'Enter token ='`); the separator is dropped before secretKeyRule. A marker is
// never a key (it was a value).
const ARG_KEY_SEPARATOR = redactRegExp(/\s*[:=]\s*$/);
const ARG_ONE_TOKEN = redactRegExp(/^\S+$/);
const ARG_MARKER = redactRegExp(/^\[redacted:[a-z0-9_*-]+\]$/);

function argKeyRule(value) {
  if (typeof value !== 'string' || value.length > MASK_LIMITS.keyChars + 8 || redactTest(ARG_MARKER, value)) return null;
  const separator = redactExec(ARG_KEY_SEPARATOR, value);
  if (separator !== null) return secretKeyRule(redactSlice(value, 0, separator.index));
  return redactTest(ARG_ONE_TOKEN, value) ? secretKeyRule(value) : null;
}

// Sets an own property, also for the key `__proto__` (a storage key or a JSON key from the page).
function put(target, key, value) {
  if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}

// JSON-like copy into this realm: own enumerable keys only, no getters of the source prototype chain, no toJSON.
function copy(value) {
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = copy(value[i]);
    return out;
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) put(out, keys[i], copy(value[keys[i]]));
    return out;
  }
  return typeof value === 'function' || typeof value === 'symbol' ? undefined : value;
}

/**
 * Developer option → rules actually turned off: only `DEFAULT_RULES`, in their order, without duplicates.
 * Always rules are ignored silently and never listed (AC-4.5).
 */
export function resolveDisabledRules(list) {
  if (!Array.isArray(list)) return [];
  return DEFAULT_RULES.filter((rule) => list.includes(rule));
}

/**
 * Shared context of redact.js and redact-page.js. Every function returns a new value and adds the number of
 * replaced values to `ctx.applied`. `where` holds flags: `phone` (rule allowed here, spec US-3), `longSecret`
 * (false for selectors), `urlKeys` (keys whose values are URLs, for attribute maps), `keep` (keys left as they are).
 * @param {{ disabledRules?: string[] }} [options]
 */
export function createRedactionContext(options) {
  const disabledRules = resolveDisabledRules(options?.disabledRules);
  const email = !disabledRules.includes('email');
  const phone = !disabledRules.includes('phone');

  const ctx = {
    applied: 0,
    disabledRules,

    /** Text pass: key/value forms and value patterns; e-mail everywhere (PB-2), phone only where `where.phone`. */
    text(value, where = NONE) {
      if (typeof value !== 'string' || MARKER.test(value)) return value;
      const result = maskText(value, { email, phone: phone && where.phone === true, longSecret: where.longSecret !== false });
      ctx.applied += result.applied;
      return result.text;
    },

    /** URL field (AC-3.3): query/path parameters by key, the fragment as a whole, patterns; never phone. */
    urlValue(value) {
      if (typeof value !== 'string' || MARKER.test(value)) return value;
      const result = maskUrl(value, { email });
      ctx.applied += result.applied;
      return URL_LIKE.test(result.text) ? result.text : ctx.text(result.text);
    },

    /** Every scalar under a sensitive key becomes the marker of that key; containers keep their shape. */
    forced(value, rule) {
      if (Array.isArray(value)) {
        const out = new Array(value.length);
        for (let i = 0; i < value.length; i++) out[i] = ctx.forced(value[i], rule);
        return out;
      }
      if (isObject(value)) {
        const out = {};
        for (const key of Object.keys(value)) put(out, key, ctx.forced(value[key], rule));
        return out;
      }
      if (value === null || value === undefined || value === '' || (typeof value === 'string' && MARKER.test(value))) return value;
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return value;
      ctx.applied++;
      return `[redacted:${rule}]`;
    },

    /** Map whose keys are user data (headers, storage, attributes, objects in console arguments). */
    keyed(map, where = NONE) {
      if (!isObject(map)) return ctx.deep(map, where);
      const pairRule = namedPairRule(map);
      const out = {};
      for (const key of Object.keys(map)) {
        const value = map[key];
        // `{ name|key: 'password', value }` (review E3 N3): the value is masked, the name stays readable.
        if (pairRule !== null && !where.keep?.has(key) && (key === 'name' || key === 'key' || key === 'value')) {
          put(out, key, key === 'value' ? ctx.forced(value, pairRule) : ctx.deep(value, where));
          continue;
        }
        const rule = where.keep?.has(key) ? null : secretKeyRule(key);
        if (where.keep?.has(key)) put(out, key, value);
        else if (rule !== null) put(out, key, ctx.forced(value, rule));
        else if (typeof value === 'string' && where.urlKeys?.has(key.toLowerCase())) put(out, key, ctx.urlValue(value));
        else put(out, key, ctx.deep(value, where));
      }
      return out;
    },

    /** User data of any shape: keys of nested objects are user data too. */
    deep(value, where = NONE) {
      if (typeof value === 'string') return ctx.text(value, where);
      if (Array.isArray(value)) {
        if (where.pairs === true) return ctx.pairs(value, where);
        // `['password', 'x']`, an entry of `[...new FormData(form)]` (review E3 N3): the second item is masked.
        const rule = value.length === 2 && isScalar(value[1]) ? argKeyRule(value[0]) : null;
        if (rule !== null) return [ctx.deep(value[0], where), ctx.forced(value[1], rule)];
        return ctx.list(value, (item) => ctx.deep(item, where));
      }
      if (isObject(value)) return ctx.keyed(value, where);
      return value;
    },

    /**
     * A list read as key/value pairs (review E3 N9, N13): a scalar after a key (argKeyRule) is masked with the rule of
     * that key. A masked value that is a key itself names the next item (`'[Auth]', 'Token:', t`: fail-closed chain).
     */
    pairs(list, where = NONE) {
      const out = new Array(list.length);
      let rule = null;
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        out[i] = rule !== null && isScalar(item) ? ctx.forced(item, rule) : ctx.deep(item, where);
        rule = argKeyRule(item);
      }
      return out;
    },

    /** Catch-all: schema keys, text pass on every string, numbers and booleans unchanged. */
    plain(value, where = NONE) {
      if (typeof value === 'string') return ctx.text(value, where);
      if (Array.isArray(value)) return ctx.list(value, (item) => ctx.plain(item, where));
      if (isObject(value)) {
        const out = {};
        for (const key of Object.keys(value)) put(out, key, ctx.plain(value[key], where));
        return out;
      }
      return value;
    },

    list(value, fn) {
      if (!Array.isArray(value)) return ctx.plain(value);
      const out = new Array(value.length);
      for (let i = 0; i < value.length; i++) out[i] = fn(value[i]);
      return out;
    },

    /** Object of the schema: listed keys by their handler, the rest by the catch-all with `where`. */
    fields(value, handlers, where = NONE) {
      if (!isObject(value)) return ctx.plain(value, where);
      const out = {};
      for (const key of Object.keys(value)) {
        const handler = Object.prototype.hasOwnProperty.call(handlers, key) ? handlers[key] : null;
        put(out, key, handler ? handler(value[key]) : ctx.plain(value[key], where));
      }
      return out;
    },
  };
  return ctx;
}

// ---- record sections ----------------------------------------------------------------------------------------------

function redactNetwork(entry, ctx) {
  const headers = (map) => ctx.keyed(map);
  return ctx.fields(entry, {
    url: ctx.urlValue,
    frame: ctx.urlValue,
    requestHeaders: headers,
    responseHeaders: headers,
    requestBody: (body) => ctx.deep(body, PHONE),
    responseBodyPreview: (preview) => ctx.text(preview, PHONE),
  });
}

// Console arguments as key/value pairs (review E3 N9, N13, N14): `('login', 'jan', 'password:', pw)` — every argument
// that is a key (argKeyRule) masks the next one when it is a scalar; keys in a row form a chain; nested arrays alike.
function redactConsoleArgs(args, ctx) {
  if (isObject(args) && typeof args.preview === 'string') return ctx.deep({ ...args, preview: maskPreviewPairs(args.preview, ctx) }, CONSOLE);
  return ctx.deep(args, CONSOLE);
}

const isDigit = (ch) => ch >= '0' && ch <= '9';
const isScalarChar = (ch) => isDigit(ch) || (ch >= 'a' && ch <= 'z') || ch === '-' || ch === '+' || ch === '.' || ch === 'E';

// The same pairs (and chains) in the JSON text of a long entry `{ truncated, preview }` (`["password:","x",…`), in every array of it,
// also when the text ends inside the value. One linear scan: strings (with escapes), scalars and brackets; object
// members are left to the text pass (`"key": value`). A masked scalar becomes a quoted marker.
function maskPreviewPairs(text, ctx) {
  const n = text.length;
  const stack = [];
  let out = '';
  let last = 0;
  const replace = (start, end, marker) => {
    out += redactSlice(text, last, start) + marker;
    last = end;
    ctx.applied++;
  };
  for (let i = 0; i < n; i++) {
    const ch = text[i];
    const top = stack.length > 0 ? stack[stack.length - 1] : null;
    if (ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const end = Math.min(j, n);
      if (top !== null && top.array) {
        if (top.pending !== null) {
          const value = redactSlice(text, i + 1, end);
          if (value !== '' && !redactTest(ARG_MARKER, value)) replace(i + 1, end, `[redacted:${top.pending}]`);
          // A masked key names the next item (review E3 N13).
          top.pending = end - i - 1 <= MASK_LIMITS.keyChars + 8 ? argKeyRule(value) : null;
        } else {
          top.pending = end - i - 1 <= MASK_LIMITS.keyChars + 8 ? argKeyRule(redactSlice(text, i + 1, end)) : null;
        }
      }
      i = end;
    } else if (ch === '[' || ch === '{') {
      if (top !== null) top.pending = null;
      stack.push({ array: ch === '[', pending: null });
    } else if (ch === ']' || ch === '}') {
      stack.pop();
    } else if (top !== null && top.array && isScalarChar(ch)) {
      let j = i + 1;
      while (j < n && isScalarChar(text[j])) j++;
      const token = redactSlice(text, i, j);
      if (top.pending !== null && token !== 'null') replace(i, j, `"[redacted:${top.pending}]"`);
      top.pending = null;
      i = j - 1;
    }
  }
  return last === 0 ? text : out + redactSlice(text, last);
}

function redactConsole(entry, ctx) {
  return ctx.fields(entry, {
    args: (args) => redactConsoleArgs(args, ctx),
    frame: ctx.urlValue,
  }, PHONE);
}

function redactError(entry, ctx) {
  return ctx.fields(entry, {
    filename: ctx.urlValue,
    frame: ctx.urlValue,
    reason: (reason) => ctx.deep(reason, PHONE),
  }, PHONE);
}

function redactStep(entry, ctx) {
  return ctx.fields(entry, {
    url: ctx.urlValue,
    selector: (selector) => ctx.text(selector, SELECTOR),
  });
}

// Vitals at any depth: `url` is a URL (LCP, long task scripts), `selector` a selector; the rest by the catch-all.
function redactVitals(value, ctx) {
  if (Array.isArray(value)) return ctx.list(value, (item) => redactVitals(item, ctx));
  if (!isObject(value)) return ctx.plain(value);
  const out = {};
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (key === 'url' && typeof item === 'string') put(out, key, ctx.urlValue(item));
    else if (key === 'selector' && typeof item === 'string') put(out, key, ctx.text(item, SELECTOR));
    else put(out, key, redactVitals(item, ctx));
  }
  return out;
}

const RECORDS = {
  documents: (list, ctx) => ctx.list(list, (doc) => ctx.fields(doc, { url: ctx.urlValue })),
  notes: (list, ctx) => ctx.list(list, (note) => ctx.plain(note)),
  steps: (list, ctx) => ctx.list(list, (step) => redactStep(step, ctx)),
  runtimeErrors: (list, ctx) => ctx.list(list, (entry) => redactError(entry, ctx)),
  network: (list, ctx) => ctx.list(list, (entry) => redactNetwork(entry, ctx)),
  vitals: (list, ctx) => redactVitals(list, ctx),
  consoleLogs: (list, ctx) => ctx.list(list, (entry) => redactConsole(entry, ctx)),
};

// ---- package ------------------------------------------------------------------------------------------------------

/**
 * Markers present in a (redacted) package, per top-level section: `masked` has only sections with n > 0,
 * `total` = number of `[redacted:` occurrences in its JSON (AC-4.3; JSON indentation does not change it).
 * @returns {{ masked: Record<string, number>, total: number }}
 */
export function countMarkers(pkg) {
  const masked = {};
  let total = 0;
  if (!isObject(pkg)) return { masked, total };
  for (const key of Object.keys(pkg)) {
    const text = JSON.stringify(pkg[key]);
    if (typeof text !== 'string') continue;
    let n = 0;
    for (let i = text.indexOf(MARKER_PREFIX); i !== -1; i = text.indexOf(MARKER_PREFIX, i + MARKER_PREFIX.length)) n++;
    if (n > 0) {
      put(masked, key, n);
      total += n;
    }
  }
  return { masked, total };
}

/**
 * Redacts a package (D2). Returns a copy; the input is not changed. An existing `redaction` block is filled with
 * `rulesVersion`, `disabledRules` and `masked` of the result (the export recounts `masked` after the size budget).
 * @param {object} pkg  assembled package (v3 or v4 shape)
 * @param {{ disabledRules?: string[] }} [options]  developer option (D12); only Default rules can be turned off
 * @returns {{ snapshot: object, applied: number }} `applied` = values replaced in this pass (0 on a second pass)
 */
export function redact(pkg, options) {
  const work = copy(pkg);
  const ctx = createRedactionContext(options);
  if (!isObject(work)) return { snapshot: work, applied: 0 };
  for (const key of Object.keys(work)) {
    if (UNTOUCHED.has(key) || PAGE_SECTIONS.has(key)) continue;
    const handler = Object.prototype.hasOwnProperty.call(RECORDS, key) ? RECORDS[key] : null;
    put(work, key, handler ? handler(work[key], ctx) : ctx.plain(work[key]));
  }
  redactPageSections(work, ctx);
  if (Object.prototype.hasOwnProperty.call(work, 'redaction')) {
    work.redaction = { rulesVersion: RULES_VERSION, disabledRules: [...ctx.disabledRules], masked: countMarkers(work).masked };
  }
  return { snapshot: work, applied: ctx.applied };
}
