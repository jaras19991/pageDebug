// Network hooks of the recorder (E1 D5): `fetch` through Proxy `apply`, `XMLHttpRequest` through
// Proxy `construct` returning the native instance. `XMLHttpRequest.prototype` is never touched, so
// `instanceof`, static constants and later page patches on the prototype keep working.
// Every recorder failure is swallowed; the page call always runs exactly once and its result or
// exception reaches the page unchanged. Response bodies are never read (no `clone()`).

export const NETWORK_LIMITS = Object.freeze({
  urlChars: 4000,
  methodChars: 32,
  headers: 100,
  headerChars: 2000,
  bodyChars: 5000,
  statusTextChars: 500,
});

// Hooks created by this module, so a second install on the same window is a no-op.
const ownHooks = new WeakSet();

const noop = () => {};

function defaultIntrinsics() {
  return {
    Reflect,
    Proxy,
    URL: globalThis.URL,
    promiseThen: Promise.prototype.then,
    addEventListener: globalThis.EventTarget ? EventTarget.prototype.addEventListener : null,
    objectToString: Object.prototype.toString,
  };
}

function slice(value, max) {
  return value.length > max ? value.slice(0, max) + `... [truncated ${value.length - max} chars]` : value;
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

  const resolveUrl = (raw) => {
    const str = String(raw);
    const base = safe(() => win.document.baseURI, undefined) || safe(() => win.location.href, undefined);
    return slice(safe(() => new I.URL(str, base).href, str), NETWORK_LIMITS.urlChars);
  };

  const headersToObject = (headers) => {
    const out = {};
    let count = 0;
    const add = (key, value) => {
      if (count >= NETWORK_LIMITS.headers) return;
      const k = toStr(key, NETWORK_LIMITS.headerChars);
      if (!Object.prototype.hasOwnProperty.call(out, k)) count++;
      out[k] = toStr(value, NETWORK_LIMITS.headerChars);
    };
    if (headers == null || typeof headers !== 'object') return out;
    if (Array.isArray(headers)) {
      for (const pair of headers.slice(0, NETWORK_LIMITS.headers)) if (pair) add(pair[0], pair[1]);
    } else if (typeof headers.forEach === 'function') {
      headers.forEach((value, key) => add(key, value));
    } else {
      for (const key of Object.keys(headers).slice(0, NETWORK_LIMITS.headers)) add(key, headers[key]);
    }
    return out;
  };

  const bodyPreview = (body) => {
    if (body == null) return null;
    if (typeof body === 'string') return slice(body, NETWORK_LIMITS.bodyChars);
    const tag = safe(() => I.Reflect.apply(I.objectToString, body, []).slice(8, -1), 'Object');
    return `[${slice(tag, 64)}]`;
  };

  return { I, win, safe, isOn, now, emit, json, resolveUrl, headersToObject, bodyPreview };
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
    const [input, init] = args;
    const req = isRequestLike(input) ? input : null;
    const hasInit = init !== null && typeof init === 'object';
    const rawMethod = (hasInit && init.method != null ? init.method : null) ?? (req ? req.method : 'GET');
    return {
      t: now(),
      type: 'fetch',
      method: toStr(rawMethod, NETWORK_LIMITS.methodChars).toUpperCase(),
      url: req ? slice(req.url, NETWORK_LIMITS.urlChars) : tools.resolveUrl(input),
      status: null,
      statusText: null,
      ok: null,
      redirected: null,
      durationMs: null,
      requestHeaders: safe(() => tools.headersToObject(hasInit && init.headers != null ? init.headers : req && req.headers), {}),
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
      } else {
        entry.error = json(error);
      }
      emit(entry);
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
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const i = line.indexOf(':');
    if (i > 0) pairs.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
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
            state.headers[k] = toStr(value, NETWORK_LIMITS.headerChars);
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
    for (const name of Object.keys(methods)) {
      I.Reflect.defineProperty(xhr, name, { value: methods[name], writable: true, enumerable: false, configurable: true });
    }

    const listen = (type, fn) => I.Reflect.apply(I.addEventListener, xhr, [type, fn]);
    for (const type of ['error', 'abort', 'timeout']) {
      listen(type, () => {
        state.error = type;
      });
    }
    listen('loadend', () => {
      if (!state.opened || !live()) return;
      safe(() => {
        const t = state.tSend ?? state.tOpen;
        const end = now();
        const status = xhr.status;
        emit({
          t,
          type: 'xhr',
          method: state.method,
          url: state.url,
          status,
          statusText: toStr(xhr.statusText, NETWORK_LIMITS.statusTextChars),
          ok: status >= 200 && status < 300,
          redirected: safe(() => !!xhr.responseURL && xhr.responseURL !== state.url, false),
          durationMs: end != null && t != null ? round2(end - t) : null,
          requestHeaders: state.headers,
          responseHeaders: safe(() => parseResponseHeaders(xhr.getAllResponseHeaders(), tools.headersToObject), {}),
          requestBody: state.body,
          error: state.error,
        });
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
