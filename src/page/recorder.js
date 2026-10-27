// MAIN-world recorder (E1 D5, D10; E2 D2–D4, D6, D8): composes the console/error/network hooks, the user
// steps, the resource observer, same-origin frames and the Web Vitals observers over bounded buffers,
// guards the window with an install marker, stops on the time limit (also checked at every recorded event
// and on visibilitychange, so a sleeping device stops at the first event after waking) and removes itself
// without a config.
// Buffers live only in this closure; nothing is exposed on the page window except the frozen marker.
// Every recorder failure is swallowed and the recorder never writes to `console` (AC-4.7).
// Top-level helpers carry the `recorder` prefix (D6: all page modules end up in one IIFE).

import { serializeCapped } from './serialize.js';
import { captureDomIntrinsics, elementStructure } from './dom-structure.js';
import { createBuffer } from './buffer.js';
import { installFetchHook, installXhrHook } from './hooks-network.js';
import { installConsoleHook } from './hooks-console.js';
import { installErrorHooks } from './hooks-errors.js';
import { captureSelectorIntrinsics, createSelectorOf } from './selector.js';
import { installStepsHook } from './hooks-steps.js';
import { installResourceHooks } from './hooks-resources.js';
import { installFrameHooks } from './hooks-frames.js';
import { installVitals } from './vitals.js';
import { RECORDER_VERSION, PROTOCOL, LIMITS, MARKER_KEY, CONFIG_TIMEOUT_MS, CONSOLE_LEVELS } from './constants.js';

const RECORDER_SECTIONS = ['consoleLogs', 'runtimeErrors', 'network', 'steps'];
// Fields a hook may attach to its network entry later (response body preview, D3).
const RECORDER_ATTACH_FIELDS = ['responseBodyPreview', 'responseBodyTruncated'];
const RECORDER_URL_MAX = 4000;

function recorderTry(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// Copies of entries with `doc`; a loop, not Array.prototype.map, which the page may replace (AC-3.6).
function recorderWithDoc(items, docId) {
  const out = [];
  for (let i = 0; i < items.length; i++) out.push({ ...items[i], doc: docId });
  return out;
}

function recorderFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Rough char size of the fields a hook did not pass through `json` (strings, header maps). Index loops: on the
// record path of masked entries, so a page-replaced Array.prototype[Symbol.iterator] must not drop them (E4-IN2).
function recorderShallowChars(entry) {
  let chars = 0;
  const keys = Object.keys(entry);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = entry[key];
    if (typeof value === 'string') chars += value.length;
    else if (value && typeof value === 'object' && (key === 'requestHeaders' || key === 'responseHeaders')) {
      const names = Object.keys(value);
      for (let j = 0; j < names.length; j++) chars += names[j].length + String(value[names[j]]).length;
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
 * @param {{ limits?: object, configTimeoutMs?: number, onStopped?: (reason: string) => void,
 *   interactionsSince?: number }} [input.options] `interactionsSince` (performance.now() ms): INP counts only
 *   later interactions (console fallback, AC-5.8).
 */
export function createRecorder({ win, options = {} }) {
  const limits = { ...LIMITS, ...(options.limits || {}) };
  const onStopped = typeof options.onStopped === 'function' ? options.onStopped : null;
  const configTimeoutMs = recorderFinite(options.configTimeoutMs) ?? CONFIG_TIMEOUT_MS;
  const interactionsSince = recorderFinite(options.interactionsSince);

  // Intrinsics captured before page scripts run (document_start).
  const perf = recorderTry(() => win.performance, null);
  const perfNow = recorderTry(() => perf.now, null);
  const dateNow = Date.now;
  const setTimer = recorderTry(() => win.setTimeout, null);
  const clearTimer = recorderTry(() => win.clearTimeout, null);
  const proto = recorderTry(() => win.EventTarget.prototype, null);
  const doc = recorderTry(() => win.document, null);
  const intrinsics = {
    Reflect,
    Proxy,
    Error,
    addEventListener: recorderTry(() => proto.addEventListener, undefined),
    removeEventListener: recorderTry(() => proto.removeEventListener, undefined),
    // Frames: new iframes are found by a MutationObserver the page cannot replace later (E2-D6).
    MutationObserver: recorderTry(() => win.MutationObserver, undefined),
  };
  const selectorIntrinsics = recorderTry(() => captureSelectorIntrinsics(win), null);
  // DOM getters for elements in console arguments (D5): `structure` instead of outerHTML, read through getters
  // the page cannot patch later; without them (no DOM realm) elements get `structure: null`.
  const domIntrinsics = recorderTry(() => captureDomIntrinsics(win), null);
  const structureOf = domIntrinsics ? (el, maxChars) => elementStructure(el, maxChars, domIntrinsics) : null;
  const defineProperty = Object.defineProperty;
  const freeze = Object.freeze;
  const markerSymbol = Symbol.for(MARKER_KEY);

  const startDate = dateNow();
  const now = () => (perfNow ? Reflect.apply(perfNow, perf, []) : dateNow() - startDate);
  const timeOrigin = recorderTry(() => recorderFinite(perf.timeOrigin), null) ?? startDate - recorderTry(now, 0);

  // Response previews are attached to network entries after they were pushed (the buffer cannot grow an
  // entry), so their budget is reserved inside the network buffer's char limit when it fits (D3).
  const networkChars = limits.documentChars > 2 * limits.responseBodyTotalChars
    ? limits.documentChars - limits.responseBodyTotalChars
    : limits.documentChars;
  const buffers = {};
  const counts = {};
  for (let i = 0; i < RECORDER_SECTIONS.length; i++) {
    const section = RECORDER_SECTIONS[i];
    const maxChars = section === 'network' ? networkChars : limits.documentChars;
    buffers[section] = createBuffer({ maxItems: limits[section], maxChars });
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
  // Set while stop() drains the observers: records are then checked only by their own `t` (decision 4).
  let stopping = false;
  let bodyChars = 0;
  let bodiesTruncated = false;
  // Entries holding a preview, oldest first ({ entry, size }); over the budget the oldest lose it (D3).
  let bodyEntries = [];
  let resources = null;
  let vitals = null;
  // Network items with sizes and load errors merged, fixed at stop (the resource rings go with the hooks).
  let frozenNetwork = null;

  const later = (fn, ms) => recorderTry(() => Reflect.apply(setTimer, win, [fn, ms]), null);
  const cancel = (id) => {
    if (id !== null) recorderTry(() => Reflect.apply(clearTimer, win, [id]));
  };

  // `json` for the hooks: capped serialization; the size goes into the next recorded entry.
  const json = (value) => {
    const res = serializeCapped(value, limits.entryChars, { elementStructure: structureOf });
    pendingChars += res.chars;
    return res.value;
  };

  // `deadline` is wall-clock epoch (background Date.now()); the monotonic clock stands still while the device
  // sleeps, so the time limit is checked against Date.now() too.
  const pastByTime = (t) => deadline !== null && timeOrigin + t >= deadline;
  const pastDeadline = (t) => pastByTime(t) || (!stopping && deadline !== null && dateNow() >= deadline);

  // Any event past the deadline stops the recording at once (E2 D8, AC-2.2); the entry itself is dropped.
  function record(section, entry) {
    const chars = pendingChars;
    pendingChars = 0;
    try {
      if (state !== 'recording' || !buffers[section] || !entry || typeof entry !== 'object') return;
      if (recorderFinite(entry.t) === null) entry.t = now();
      if (pastDeadline(entry.t)) {
        if (!stopping) stop('time-limit');
        return;
      }
      counts[section] += 1;
      buffers[section].push(entry, chars + recorderShallowChars(entry));
    } catch {
      // never let a recorder failure reach the page
    }
  }

  // hooks-network `ctx.canAttach`: false → the body is neither cloned nor read.
  const canAttach = () => state === 'recording' && limits.responseBodyTotalChars > 0;

  // Response body preview of a recorded network entry (hooks-network `ctx.attach`). The per-document budget
  // keeps the newest previews: the oldest entries lose the fields and `truncated.responseBodies` is set (D3).
  function attach(entry, fields, chars) {
    try {
      if (state !== 'recording' || !entry || typeof entry !== 'object' || !fields || typeof fields !== 'object') return;
      const preview = fields.responseBodyPreview;
      if (typeof preview !== 'string') return;
      const capped = preview.length > limits.responseBodyChars ? preview.slice(0, limits.responseBodyChars) : preview;
      const size = Math.max(capped.length, Math.min(recorderFinite(chars) ?? 0, limits.responseBodyChars));
      if (size > limits.responseBodyTotalChars) {
        bodiesTruncated = true;
        return;
      }
      // With `limits.network` newer entries the oldest has left the network ring anyway: forget it silently.
      while (bodyEntries.length >= limits.network) bodyChars -= bodyEntries.shift().size;
      while (bodyEntries.length && bodyChars + size > limits.responseBodyTotalChars) {
        const oldest = bodyEntries.shift();
        bodyChars -= oldest.size;
        for (let i = 0; i < RECORDER_ATTACH_FIELDS.length; i++) delete oldest.entry[RECORDER_ATTACH_FIELDS[i]];
        bodiesTruncated = true;
      }
      bodyChars += size;
      bodyEntries.push({ entry, size });
      for (let i = 0; i < RECORDER_ATTACH_FIELDS.length; i++) {
        const key = RECORDER_ATTACH_FIELDS[i];
        if (key === 'responseBodyPreview') entry[key] = capped;
        else if (typeof fields[key] === 'boolean') entry[key] = fields[key] || capped !== preview;
      }
    } catch {
      // never let a recorder failure reach the page
    }
  }

  function onVisibility() {
    if (state === 'recording' && deadline !== null && dateNow() >= deadline) stop('time-limit');
  }

  function removeHooks() {
    cancel(configTimer);
    cancel(limitTimer);
    configTimer = null;
    limitTimer = null;
    const pending = restores;
    restores = [];
    for (let i = 0; i < pending.length; i++) recorderTry(pending[i]);
  }

  function clearBuffers() {
    for (let i = 0; i < RECORDER_SECTIONS.length; i++) {
      const section = RECORDER_SECTIONS[i];
      buffers[section].clear();
      counts[section] = 0;
    }
    bodyChars = 0;
    bodiesTruncated = false;
    bodyEntries = [];
    frozenNetwork = null;
  }

  // Stops every hook and observer (History, frames, PerformanceObservers, listeners); buffers stay for collect.
  // Entries still queued in the observers are drained first and kept when they started before the deadline.
  function stop(reason) {
    if (state !== 'recording' || stopping) return;
    stopping = true;
    try {
      stopReason = typeof reason === 'string' ? reason.slice(0, 64) : 'user';
      if (resources) {
        const current = resources;
        frozenNetwork = recorderTry(() => current.adjust(buffers.network.items()), null);
      }
      state = 'stopped';
      removeHooks();
    } finally {
      stopping = false;
    }
    if (onStopped) recorderTry(() => onStopped(stopReason));
  }

  function destroy() {
    if (state === 'recording') state = 'stopped';
    removeHooks();
    clearBuffers();
    resources = null;
    vitals = null;
    state = 'destroyed';
  }

  function onLimit() {
    limitTimer = null;
    if (state !== 'recording') return;
    const left = deadline - dateNow();
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
    const enabled = () => state === 'recording';
    const selectorOf = (selectorIntrinsics && doc && recorderTry(() => createSelectorOf({ doc, intrinsics: selectorIntrinsics }), null))
      || (() => null);
    // Vitals entries are judged by their own start time: a record drained after the deadline still counts
    // when it happened before it (decision 4).
    const accept = (t) => !pastByTime(t);
    const installers = [
      () => installConsoleHook({ ...ctx, levels: CONSOLE_LEVELS }),
      () => installErrorHooks(ctx),
      () => installFetchHook({ ...ctx, enabled, attach, canAttach }),
      () => installXhrHook({ ...ctx, enabled, attach, canAttach }),
      () => installStepsHook({ ...ctx, doc, selectorOf }),
      () => {
        resources = installResourceHooks({ ...ctx, doc, enabled });
        return resources.restore;
      },
      () => installFrameHooks({ ...ctx, doc }),
      () => {
        vitals = installVitals({ win, doc, now, selectorOf, intrinsics, accept, options: { interactionsSince } });
        return vitals.restore;
      },
      () => {
        Reflect.apply(intrinsics.addEventListener, doc, ['visibilitychange', onVisibility, true]);
        return () => Reflect.apply(intrinsics.removeEventListener, doc, ['visibilitychange', onVisibility, true]);
      },
    ];
    for (let i = 0; i < installers.length; i++) {
      const restore = recorderTry(installers[i], null);
      if (typeof restore === 'function') restores.push(restore);
    }
    configTimer = later(() => {
      configTimer = null;
      destroy();
    }, configTimeoutMs);
    return true;
  }

  function setConfig(config) {
    const cfg = config && typeof config === 'object' ? config : {};
    // Stopped before the config came (popup stop, time limit): a "not recorded" config still clears everything.
    if (cfg.record === false && (state === 'recording' || state === 'stopped')) {
      destroy();
      return;
    }
    if (state !== 'recording') return;
    cancel(configTimer);
    configTimer = null;
    if (cfg.docId !== undefined) docId = cfg.docId;
    deadline = recorderFinite(cfg.deadline);
    cancel(limitTimer);
    limitTimer = null;
    if (deadline !== null) onLimit();
  }

  // Raw buffer copies with `doc`; `network` without the Resource Timing adjustments (see snapshot()).
  function exportBuffers() {
    const out = { truncated: {}, counts: {} };
    for (let i = 0; i < RECORDER_SECTIONS.length; i++) {
      const section = RECORDER_SECTIONS[i];
      out[section] = recorderWithDoc(buffers[section].items(), docId);
      out.truncated[section] = buffers[section].truncated;
      out.counts[section] = counts[section];
    }
    out.truncated.responseBodies = bodiesTruncated;
    return out;
  }

  // Network items with `sizeBytes` from Resource Timing and element load errors merged (copies, D2).
  function adjustedNetwork() {
    if (frozenNetwork) return recorderWithDoc(frozenNetwork, docId);
    const items = buffers.network.items();
    const current = resources;
    const adjusted = state === 'recording' && current ? recorderTry(() => current.adjust(items), null) : null;
    return recorderWithDoc(Array.isArray(adjusted) ? adjusted : items, docId);
  }

  // Current-document part of the `collect`/`flush` result (flat, as assemblePackage reads it); the entry point
  // adds the collector sections. `final`: the page is going away or hidden, so LCP/CLS/INP cannot grow (AC-5.6).
  function snapshot({ final = false } = {}) {
    // Resource entries still queued in the observer become records (and count) before the export.
    const current = resources;
    if (state === 'recording' && current) recorderTry(() => current.sync());
    const buffered = exportBuffers();
    buffered.network = adjustedNetwork();
    const currentVitals = vitals;
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
      ...buffered,
      vitals: currentVitals ? recorderTry(() => currentVitals.snapshot({ final: final === true }), null) : null,
      documentStatus: current ? recorderTry(() => current.documentStatus(), null) : null,
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
