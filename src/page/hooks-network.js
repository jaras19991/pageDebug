// Network hooks of the recorder (E1 D5): `fetch` through Proxy `apply`, `XMLHttpRequest` through
// Proxy `construct` returning the native instance. `XMLHttpRequest.prototype` is never touched, so
// `instanceof`, static constants and later page patches on the prototype keep working.
// Every recorder failure is swallowed; the page call always runs exactly once and its result or
// exception reaches the page unchanged. Bodies of error responses (status >= 400, textual content-type) are
// previewed (E2 D3): fetch through `clone()` + a bounded stream reader (8192 chars or 2 s, then `cancel()`),
// XHR from `responseText`/`response` of text/json types only. The preview is masked (maskSecrets) before it is cut
// and reaches the recorder asynchronously through `ctx.attach(entry, fields, chars)`; without `attach` nothing is read.
// Redaction at the source (E3 D1, defence in depth; the background pass decides): values of request headers with a
// sensitive name become `[redacted:key-<token>]` and the URL goes through the Always rules for URL fields, both
// before anything reaches the buffer. The call of the page always gets its own, unchanged arguments.
// Index loops only, no for…of, array destructuring or spread (E4-IN2): the page may replace Array.prototype[Symbol.iterator].

import { maskSecrets, cutPreview, maskUrl, secretKeyRule, MASK_LIMITS, redactRegExp, redactReplace, redactSplit, redactSlice } from '../lib/mask-secrets.js';

export const NETWORK_LIMITS = Object.freeze({
  urlChars: 4000,
  methodChars: 32,
  headers: 100,
  headerChars: 2000,
  bodyChars: 5000,
  statusTextChars: 500,
  responseBodyChars: 4096,
  responseReadChars: 8192,
  bodyTimeoutMs: 2000,
});

// Trailing "word" left by a read stopped at the char limit: dropped so a half token never stays (D3).
const READ_TRAILING_WORD = redactRegExp(/[A-Za-z0-9._~+/=-]+$/);
// XHR response header lines (page-replaced split/replace must not change them, AC-3.6).
const LINE_BREAKS = redactRegExp(/[\r\n]+/);

/**
 * Content types whose error bodies are previewed (D3): `text/*`, `application/json`, `*+json`, `*xml`,
 * `application/x-www-form-urlencoded`.
 */
export function isTextual(contentType) {
  if (typeof contentType !== 'string') return false;
  const mime = contentType.slice(0, 256).split(';')[0].trim().toLowerCase();
  if (!mime) return false;
  return mime.startsWith('text/') || mime === 'application/json' || mime.endsWith('+json')
    || mime.endsWith('xml') || mime === 'application/x-www-form-urlencoded';
}

// Hooks created by this module, so a second install on the same window is a no-op.
const ownHooks = new WeakSet();

const noop = () => {};

function pickProto(ctor, name) {
  try {
    return typeof ctor === 'function' ? ctor.prototype[name] : null;
  } catch {
    return null;
  }
}

function defaultIntrinsics() {
  const G = globalThis;
  const reader = G.ReadableStream ? pickProto(G.ReadableStream, 'getReader') : null;
  return {
    Reflect,
    Proxy,
    URL: G.URL,
    promiseThen: Promise.prototype.then,
    addEventListener: G.EventTarget ? EventTarget.prototype.addEventListener : null,
    objectToString: Object.prototype.toString,
    jsonStringify: JSON.stringify,
    responseClone: pickProto(G.Response, 'clone'),
    getReader: reader,
    readerRead: pickProto(G.ReadableStreamDefaultReader, 'read'),
    readerCancel: pickProto(G.ReadableStreamDefaultReader, 'cancel'),
    TextDecoder: G.TextDecoder,
    decode: pickProto(G.TextDecoder, 'decode'),
    setTimeout: G.setTimeout,
    clearTimeout: G.clearTimeout,
  };
}

// String.prototype.slice captured at load (review E3 F9): URL fields and header values are cut with it.
function slice(value, max) {
  return value.length > max ? redactSlice(value, 0, max) + `... [truncated ${value.length - max} chars]` : value;
}

function toStr(value, max) {
  return slice(String(value), max);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function makeTools(ctx) {
  const I = { ...defaultIntrinsics(), ...(ctx.intrinsics || {}) };
  const { win } = ctx;

  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  const isOn = () => safe(() => (typeof ctx.enabled === 'function' ? !!ctx.enabled() : true), false);
  const now = () => safe(() => ctx.now(), null);
  const emit = (entry) => safe(() => ctx.record('network', entry));
  const json = (value) => safe(() => ctx.json(value), safe(() => toStr(value, 200), '[unserializable]'));

  // URL field of an entry: masked whole (Always rules, AC-3.3), then cut, so a cut never leaves half a token.
  // A masking failure keeps no address at all rather than an unmasked one.
  const urlField = (str) => {
    const capped = str.length > MASK_LIMITS.inputChars ? redactSlice(str, 0, MASK_LIMITS.inputChars) : str;
    return slice(safe(() => maskUrl(capped).text, '[redacted:url]'), NETWORK_LIMITS.urlChars);
  };

  const resolveUrl = (raw) => {
    const str = String(raw);
    const base = safe(() => win.document.baseURI, undefined) || safe(() => win.location.href, undefined);
    return urlField(safe(() => new I.URL(str, base).href, str));
  };

  // Request header value as stored: a sensitive name (`Authorization`, `Cookie`, `X-Api-Key`…) gives the marker.
  const requestHeaderValue = (name, value) => {
    const rule = secretKeyRule(name);
    return rule === null ? toStr(value, NETWORK_LIMITS.headerChars) : `[redacted:${rule}]`;
  };

  const headersToObject = (headers, mask) => {
    const out = {};
    let count = 0;
    const add = (key, value) => {
      if (count >= NETWORK_LIMITS.headers) return;
      const k = toStr(key, NETWORK_LIMITS.headerChars);
      if (!Object.prototype.hasOwnProperty.call(out, k)) count++;
      out[k] = mask ? requestHeaderValue(k, value) : toStr(value, NETWORK_LIMITS.headerChars);
    };
    if (headers == null || typeof headers !== 'object') return out;
    if (Array.isArray(headers)) {
      const n = Math.min(headers.length, NETWORK_LIMITS.headers);
      for (let i = 0; i < n; i++) if (headers[i]) add(headers[i][0], headers[i][1]);
    } else if (typeof headers.forEach === 'function') {
      headers.forEach((value, key) => add(key, value));
    } else {
      const keys = Object.keys(headers);
      const n = Math.min(keys.length, NETWORK_LIMITS.headers);
      for (let i = 0; i < n; i++) add(keys[i], headers[keys[i]]);
    }
    return out;
  };

  const bodyPreview = (body) => {
    if (body == null) return null;
    if (typeof body === 'string') return slice(body, NETWORK_LIMITS.bodyChars);
    const tag = safe(() => I.Reflect.apply(I.objectToString, body, []).slice(8, -1), 'Object');
    return `[${slice(tag, 64)}]`;
  };

  const contentTypeOf = (headers) => {
    const keys = Object.keys(headers || {});
    for (let i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === 'content-type') return headers[keys[i]];
    return null;
  };

  const later = (fn, ms) => safe(() => I.Reflect.apply(I.setTimeout, win, [fn, ms]), null);
  const cancelLater = (id) => {
    if (id !== null) safe(() => I.Reflect.apply(I.clearTimeout, win, [id]));
  };
  // `then` captured at install; both callbacks guarded so no rejection is ever left unhandled.
  const then = (promise, ok, fail) => {
    const guard = (fn) => (value) => {
      safe(() => fn(value));
    };
    safe(() => I.Reflect.apply(I.promiseThen, promise, [guard(ok), guard(fail)]));
  };

  // Preview fields from read text: mask first, then cut (D3). `readCut` = the read stopped at the char limit.
  const previewFields = (raw, readCut) => {
    const text = readCut ? redactReplace(raw, READ_TRAILING_WORD, '') : raw;
    const masked = maskSecrets(text).text;
    const { preview, truncated } = cutPreview(masked, NETWORK_LIMITS.responseBodyChars);
    return { responseBodyPreview: preview, responseBodyTruncated: truncated || readCut };
  };

  const attach = (entry, raw, readCut) => {
    if (!isOn() || typeof ctx.attach !== 'function') return;
    const fields = previewFields(raw, readCut);
    ctx.attach(entry, fields, fields.responseBodyPreview.length);
  };

  // `ctx.canAttach()` false (no budget left for previews, recorder not recording): no clone, no read.
  const canAttach = () => typeof ctx.canAttach !== 'function' || safe(() => ctx.canAttach() !== false, false);
  const wantsBody = (status, headers) => typeof ctx.attach === 'function' && typeof status === 'number'
    && status >= 400 && isTextual(contentTypeOf(headers)) && canAttach();

  return {
    I, win, safe, isOn, now, emit, json, urlField, resolveUrl, requestHeaderValue, headersToObject, bodyPreview, later, cancelLater, then,
    attach, wantsBody,
  };
}

// Reads at most `responseReadChars` chars of `stream` within `bodyTimeoutMs`; `done(text, readCut)` only when the
// stream ended or the char limit was hit. A timeout or any failure cancels the reader and reports nothing.
function readLimited(tools, stream, done) {
  const { I, safe, later, cancelLater, then } = tools;
  const reader = I.Reflect.apply(I.getReader, stream, []);
  const decoder = new I.TextDecoder();
  const decode = (value, more) => I.Reflect.apply(I.decode, decoder, more ? [value, { stream: true }] : []);
  let text = '';
  let settled = false;
  let timer = null;

  const settle = (result, cancel) => {
    if (settled) return;
    settled = true;
    cancelLater(timer);
    if (cancel) safe(() => then(I.Reflect.apply(I.readerCancel, reader, []), () => {}, () => {}));
    if (result) safe(() => done(result.text, result.cut));
  };

  const step = () => {
    let pending;
    try {
      pending = I.Reflect.apply(I.readerRead, reader, []);
    } catch {
      settle(null, true);
      return;
    }
    then(pending, (chunk) => {
      if (settled) return;
      try {
        if (chunk.done) {
          text += decode(undefined, false);
          settle({ text: text.slice(0, NETWORK_LIMITS.responseReadChars), cut: text.length > NETWORK_LIMITS.responseReadChars }, false);
          return;
        }
        text += decode(chunk.value, true);
        if (text.length >= NETWORK_LIMITS.responseReadChars) {
          settle({ text: text.slice(0, NETWORK_LIMITS.responseReadChars), cut: true }, true);
          return;
        }
      } catch {
        settle(null, true);
        return;
      }
      step();
    }, () => settle(null, true));
  };

  timer = later(() => settle(null, true), NETWORK_LIMITS.bodyTimeoutMs);
  step();
}

// A status of 0 is never recorded bare (AC-4.3): an opaque response (`mode: 'no-cors'`) is `cross-origin`, any other
// unexplained 0 is `unknown`. `statusUnavailable` is placed right after `status` (key order of the package schema).
function markStatusUnavailable(entry, reason) {
  const keys = Object.keys(entry);
  const values = [];
  const from = keys.indexOf('status') + 1;
  for (let i = from; i < keys.length; i++) {
    values[i] = entry[keys[i]];
    delete entry[keys[i]];
  }
  entry.status = null;
  entry.statusUnavailable = reason;
  for (let i = from; i < keys.length; i++) entry[keys[i]] = values[i];
  entry.ok = null;
}

// Duck typing instead of `instanceof Request`: works across realms and for polyfilled Requests.
function isRequestLike(input) {
  return input !== null && typeof input === 'object'
    && typeof input.url === 'string' && typeof input.method === 'string';
}

export function installFetchHook(ctx) {
  const tools = makeTools(ctx);
  const { I, win, safe, isOn, now, emit, json } = tools;
  const original = win.fetch;
  if (typeof original !== 'function' || ownHooks.has(original)) return noop;

  let active = true;

  const describe = (args) => {
    const input = args[0];
    const init = args[1];
    const req = isRequestLike(input) ? input : null;
    const hasInit = init !== null && typeof init === 'object';
    const rawMethod = (hasInit && init.method != null ? init.method : null) ?? (req ? req.method : 'GET');
    return {
      t: now(),
      type: 'fetch',
      method: toStr(rawMethod, NETWORK_LIMITS.methodChars).toUpperCase(),
      url: req ? tools.urlField(req.url) : tools.resolveUrl(input),
      status: null,
      statusText: null,
      ok: null,
      redirected: null,
      durationMs: null,
      sizeBytes: null,
      requestHeaders: safe(() => tools.headersToObject(hasInit && init.headers != null ? init.headers : req && req.headers, true), {}),
      responseHeaders: {},
      requestBody: hasInit && init.body !== undefined ? safe(() => tools.bodyPreview(init.body), null) : null,
      error: null,
    };
  };

  const finish = (entry, response, error) => {
    safe(() => {
      const end = now();
      entry.durationMs = end != null && entry.t != null ? round2(end - entry.t) : null;
      if (response) {
        entry.status = response.status;
        entry.statusText = toStr(response.statusText, NETWORK_LIMITS.statusTextChars);
        entry.ok = response.ok;
        entry.redirected = response.redirected;
        entry.responseHeaders = safe(() => tools.headersToObject(response.headers), {});
        if (response.type === 'opaque') markStatusUnavailable(entry, 'cross-origin');
        else if (!(entry.status > 0)) markStatusUnavailable(entry, 'unknown');
      } else {
        entry.error = json(error);
      }
      emit(entry);
    });
    if (response) safe(() => previewBody(entry, response));
  };

  // Clone synchronously, before the page gets the response, so `bodyUsed` of the original stays false (AC-4.6).
  const previewBody = (entry, response) => {
    if (!active || !isOn() || !tools.wantsBody(entry.status, entry.responseHeaders)) return;
    const type = response.type;
    if (type === 'opaque' || type === 'opaqueredirect' || response.body == null || response.bodyUsed) return;
    const clone = I.Reflect.apply(I.responseClone, response, []);
    readLimited(tools, clone.body, (text, cut) => {
      if (active) tools.attach(entry, text, cut);
    });
  };

  const hook = new I.Proxy(original, {
    apply(target, thisArg, args) {
      const entry = active && isOn() ? safe(() => describe(args), null) : null;
      if (!entry) return I.Reflect.apply(target, thisArg, args);
      let result;
      try {
        result = I.Reflect.apply(target, thisArg, args);
      } catch (error) {
        finish(entry, null, error);
        throw error;
      }
      try {
        return I.Reflect.apply(I.promiseThen, result, [
          (response) => {
            finish(entry, response, null);
            return response;
          },
          (error) => {
            finish(entry, null, error);
            throw error;
          },
        ]);
      } catch {
        // Not a native promise (polyfill): hand it back untouched.
        return result;
      }
    },
  });

  ownHooks.add(hook);
  win.fetch = hook;

  return function restore() {
    active = false;
    if (win.fetch === hook) win.fetch = original;
  };
}

function parseResponseHeaders(raw, toObject) {
  if (typeof raw !== 'string' || !raw) return {};
  const pairs = [];
  const lines = redactSplit(raw.trim(), LINE_BREAKS);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const i = line.indexOf(':');
    if (i > 0) pairs[pairs.length] = [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    if (pairs.length >= NETWORK_LIMITS.headers) break;
  }
  return toObject(pairs);
}

export function installXhrHook(ctx) {
  const tools = makeTools(ctx);
  const { I, win, safe, isOn, now, emit } = tools;
  const Original = win.XMLHttpRequest;
  if (typeof Original !== 'function' || ownHooks.has(Original)) return noop;

  const proto = Original.prototype;
  let active = true;

  const instrument = (xhr) => {
    const state = { opened: false, method: null, url: null, headers: {}, headerCount: 0, body: null, tOpen: null, tSend: null, error: null };
    const live = () => active && isOn();

    // Each method calls the prototype method current at call time, so later page patches still run.
    const methods = {
      open(method, url) {
        if (this === xhr && live()) {
          safe(() => {
            state.opened = true;
            state.method = toStr(method, NETWORK_LIMITS.methodChars).toUpperCase();
            state.url = tools.resolveUrl(url);
            state.headers = {};
            state.headerCount = 0;
            state.body = null;
            state.tOpen = now();
            state.tSend = null;
            state.error = null;
          });
        }
        return I.Reflect.apply(proto.open, this, arguments);
      },
      setRequestHeader(name, value) {
        const result = I.Reflect.apply(proto.setRequestHeader, this, arguments);
        if (this === xhr && live()) {
          safe(() => {
            const k = toStr(name, NETWORK_LIMITS.headerChars);
            const known = Object.prototype.hasOwnProperty.call(state.headers, k);
            if (!known && state.headerCount >= NETWORK_LIMITS.headers) return;
            if (!known) state.headerCount++;
            state.headers[k] = tools.requestHeaderValue(k, value);
          });
        }
        return result;
      },
      send() {
        if (this === xhr && live()) {
          safe(() => {
            state.tSend = now();
            state.body = tools.bodyPreview(arguments[0]);
          });
        }
        return I.Reflect.apply(proto.send, this, arguments);
      },
    };
    const names = Object.keys(methods);
    for (let i = 0; i < names.length; i++) {
      I.Reflect.defineProperty(xhr, names[i], { value: methods[names[i]], writable: true, enumerable: false, configurable: true });
    }

    const listen = (type, fn) => I.Reflect.apply(I.addEventListener, xhr, [type, fn]);
    const errorTypes = ['error', 'abort', 'timeout'];
    for (let i = 0; i < errorTypes.length; i++) {
      const type = errorTypes[i];
      listen(type, () => {
        state.error = type;
      });
    }
    // Only text and json response types are read; blob/arraybuffer/document are never touched (AC-4.6).
    const previewXhrBody = (entry) => {
      if (!tools.wantsBody(entry.status, entry.responseHeaders)) return;
      const type = xhr.responseType;
      let raw = null;
      if (type === '' || type === 'text') raw = xhr.responseText;
      else if (type === 'json') {
        const value = xhr.response;
        raw = value == null ? null : I.Reflect.apply(I.jsonStringify, JSON, [value]);
      }
      if (typeof raw !== 'string' || raw === '') return;
      const cut = raw.length > NETWORK_LIMITS.responseReadChars;
      tools.attach(entry, cut ? raw.slice(0, NETWORK_LIMITS.responseReadChars) : raw, cut);
    };
    listen('loadend', () => {
      if (!state.opened || !live()) return;
      safe(() => {
        const t = state.tSend ?? state.tOpen;
        const end = now();
        const status = xhr.status;
        const entry = {
          t,
          type: 'xhr',
          method: state.method,
          url: state.url,
          status,
          statusText: toStr(xhr.statusText, NETWORK_LIMITS.statusTextChars),
          ok: status >= 200 && status < 300,
          redirected: safe(() => !!xhr.responseURL && tools.urlField(xhr.responseURL) !== state.url, false),
          durationMs: end != null && t != null ? round2(end - t) : null,
          sizeBytes: null,
          requestHeaders: state.headers,
          responseHeaders: safe(() => parseResponseHeaders(xhr.getAllResponseHeaders(), tools.headersToObject), {}),
          requestBody: state.body,
          error: state.error,
        };
        if (!(status > 0) && state.error === null) markStatusUnavailable(entry, 'unknown');
        emit(entry);
        safe(() => previewXhrBody(entry));
      });
      state.opened = false;
    });
  };

  const hook = new I.Proxy(Original, {
    construct(target, args, newTarget) {
      const xhr = I.Reflect.construct(target, args, newTarget);
      if (active) safe(() => instrument(xhr));
      return xhr;
    },
  });

  ownHooks.add(hook);
  win.XMLHttpRequest = hook;

  return function restore() {
    active = false;
    if (win.XMLHttpRequest === hook) win.XMLHttpRequest = Original;
  };
}
