// MAIN-world recorder (E1 D5, D10): composes the console/error/network hooks over bounded buffers,
// guards the window with an install marker, stops on the time limit and removes itself without a config.
// Buffers live only in this closure; nothing is exposed on the page window except the frozen marker.
// Every recorder failure is swallowed and the recorder never writes to `console` (AC-4.7).
// Top-level helpers carry the `recorder` prefix (D6: all page modules end up in one IIFE).

import { serializeCapped } from './serialize.js';
import { createBuffer } from './buffer.js';
import { installFetchHook, installXhrHook } from './hooks-network.js';
import { installConsoleHook } from './hooks-console.js';
import { installErrorHooks } from './hooks-errors.js';
import { RECORDER_VERSION, PROTOCOL, LIMITS, MARKER_KEY, CONFIG_TIMEOUT_MS, CONSOLE_LEVELS } from './constants.js';

const RECORDER_SECTIONS = ['consoleLogs', 'runtimeErrors', 'network'];
const RECORDER_URL_MAX = 4000;

function recorderTry(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function recorderFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Rough char size of the fields a hook did not pass through `json` (strings, header maps).
function recorderShallowChars(entry) {
  let chars = 0;
  for (const key of Object.keys(entry)) {
    const value = entry[key];
    if (typeof value === 'string') chars += value.length;
    else if (value && typeof value === 'object' && (key === 'requestHeaders' || key === 'responseHeaders')) {
      for (const k of Object.keys(value)) chars += k.length + String(value[k]).length;
    }
  }
  return chars + 64;
}

export function isInstalled(win) {
  return recorderTry(() => Object.prototype.hasOwnProperty.call(win, Symbol.for(MARKER_KEY)), false);
}

/**
 * @param {object} input
 * @param {Window} input.win
 * @param {{ limits?: object, configTimeoutMs?: number, onStopped?: (reason: string) => void }} [input.options]
 */
export function createRecorder({ win, options = {} }) {
  const limits = { ...LIMITS, ...(options.limits || {}) };
  const onStopped = typeof options.onStopped === 'function' ? options.onStopped : null;
  const configTimeoutMs = recorderFinite(options.configTimeoutMs) ?? CONFIG_TIMEOUT_MS;

  // Intrinsics captured before page scripts run (document_start).
  const perf = recorderTry(() => win.performance, null);
  const perfNow = recorderTry(() => perf.now, null);
  const dateNow = Date.now;
  const setTimer = recorderTry(() => win.setTimeout, null);
  const clearTimer = recorderTry(() => win.clearTimeout, null);
  const proto = recorderTry(() => win.EventTarget.prototype, null);
  const intrinsics = {
    Reflect,
    Proxy,
    Error,
    addEventListener: recorderTry(() => proto.addEventListener, undefined),
    removeEventListener: recorderTry(() => proto.removeEventListener, undefined),
  };
  const defineProperty = Object.defineProperty;
  const freeze = Object.freeze;
  const markerSymbol = Symbol.for(MARKER_KEY);

  const startDate = dateNow();
  const now = () => (perfNow ? Reflect.apply(perfNow, perf, []) : dateNow() - startDate);
  const timeOrigin = recorderTry(() => recorderFinite(perf.timeOrigin), null) ?? startDate - recorderTry(now, 0);

  const buffers = {};
  const counts = {};
  for (const section of RECORDER_SECTIONS) {
    buffers[section] = createBuffer({ maxItems: limits[section], maxChars: limits.documentChars });
    counts[section] = 0;
  }

  let state = 'idle'; // idle | recording | stopped | destroyed
  let restores = [];
  let docId = null;
  let deadline = null;
  let stopReason = null;
  let configTimer = null;
  let limitTimer = null;
  let pendingChars = 0;

  const later = (fn, ms) => recorderTry(() => Reflect.apply(setTimer, win, [fn, ms]), null);
  const cancel = (id) => {
    if (id !== null) recorderTry(() => Reflect.apply(clearTimer, win, [id]));
  };

  // `json` for the hooks: capped serialization; the size goes into the next recorded entry.
  const json = (value) => {
    const res = serializeCapped(value, limits.entryChars);
    pendingChars += res.chars;
    return res.value;
  };

  const pastDeadline = (t) => deadline !== null && (timeOrigin + t >= deadline || timeOrigin + now() >= deadline);

  function record(section, entry) {
    const chars = pendingChars;
    pendingChars = 0;
    try {
      if (state !== 'recording' || !buffers[section] || !entry || typeof entry !== 'object') return;
      if (recorderFinite(entry.t) === null) entry.t = now();
      if (pastDeadline(entry.t)) return;
      counts[section] += 1;
      buffers[section].push(entry, chars + recorderShallowChars(entry));
    } catch {
      // never let a recorder failure reach the page
    }
  }

  function removeHooks() {
    cancel(configTimer);
    cancel(limitTimer);
    configTimer = null;
    limitTimer = null;
    const pending = restores;
    restores = [];
    for (const restore of pending) recorderTry(restore);
  }

  function clearBuffers() {
    for (const section of RECORDER_SECTIONS) {
      buffers[section].clear();
      counts[section] = 0;
    }
  }

  function stop(reason) {
    if (state !== 'recording') return;
    state = 'stopped';
    stopReason = typeof reason === 'string' ? reason.slice(0, 64) : 'user';
    removeHooks();
    if (onStopped) recorderTry(() => onStopped(stopReason));
  }

  function destroy() {
    if (state === 'recording') state = 'stopped';
    removeHooks();
    clearBuffers();
    state = 'destroyed';
  }

  function onLimit() {
    limitTimer = null;
    if (state !== 'recording') return;
    const left = deadline - (timeOrigin + now());
    // Timers may fire a little early; re-arm instead of stopping before the deadline.
    if (left > 0) limitTimer = later(onLimit, left);
    else stop('time-limit');
  }

  function install() {
    if (state !== 'idle' || isInstalled(win)) return false;
    try {
      defineProperty(win, markerSymbol, {
        value: freeze({ version: RECORDER_VERSION }),
        enumerable: false,
        configurable: false,
        writable: false,
      });
    } catch {
      return false;
    }
    state = 'recording';
    const ctx = { win, now, record, json, intrinsics };
    const installers = [
      () => installConsoleHook({ ...ctx, levels: CONSOLE_LEVELS }),
      () => installErrorHooks(ctx),
      () => installFetchHook({ ...ctx, enabled: () => state === 'recording' }),
      () => installXhrHook({ ...ctx, enabled: () => state === 'recording' }),
    ];
    for (const installer of installers) {
      const restore = recorderTry(installer, null);
      if (typeof restore === 'function') restores.push(restore);
    }
    configTimer = later(() => {
      configTimer = null;
      destroy();
    }, configTimeoutMs);
    return true;
  }

  function setConfig(config) {
    if (state !== 'recording') return;
    cancel(configTimer);
    configTimer = null;
    const cfg = config && typeof config === 'object' ? config : {};
    if (cfg.record === false) {
      destroy();
      return;
    }
    if (cfg.docId !== undefined) docId = cfg.docId;
    deadline = recorderFinite(cfg.deadline);
    cancel(limitTimer);
    limitTimer = null;
    if (deadline !== null) onLimit();
  }

  function exportBuffers() {
    const out = { truncated: {}, counts: {} };
    for (const section of RECORDER_SECTIONS) {
      out[section] = buffers[section].items().map((entry) => ({ ...entry, doc: docId }));
      out.truncated[section] = buffers[section].truncated;
      out.counts[section] = counts[section];
    }
    return out;
  }

  // Current-document part of the `collect` result (flat, as assemblePackage reads it); the entry point adds
  // the collector sections.
  function snapshot() {
    const url = recorderTry(() => String(win.location.href).slice(0, RECORDER_URL_MAX), null);
    const navigationType = recorderTry(() => {
      const nav = perf.getEntriesByType('navigation')[0];
      return nav && typeof nav.type === 'string' ? nav.type : null;
    }, null);
    return {
      protocol: PROTOCOL,
      recorderVersion: RECORDER_VERSION,
      docId,
      url,
      timeOrigin,
      navigationType,
      stopReason,
      ...exportBuffers(),
    };
  }

  return {
    install,
    setConfig,
    stop,
    destroy,
    exportBuffers,
    snapshot,
    timeOrigin,
    get isActive() {
      return state === 'recording';
    },
    get stopReason() {
      return stopReason;
    },
    get docId() {
      return docId;
    },
  };
}
