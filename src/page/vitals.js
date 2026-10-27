// Core Web Vitals observers for the MAIN-world recorder (design D1, E2-T1b, AC-5.1–5.6, AC-5.8).
// PerformanceObserver with `buffered: true` on paint, largest-contentful-paint, layout-shift, event (+first-input) and
// long-animation-frame; TTFB from Navigation Timing. Attribution (DOM nodes) is turned into selectors in the
// callbacks, because nodes cannot leave MAIN. The math lives in vitals-math.js. Availability comes only from
// feature detection (supportedEntryTypes, interactionId), never from the user agent.
// Every buffer is bounded; every failure is swallowed. Top-level helpers carry the `vitalsObs` prefix (D6).

import { rate, unavailable, clsFromShifts, inpFromEvents, inpPhases, topLongTasks, vitalsList, vitalsMap, LONG_TASKS_MAX } from './vitals-math.js';

export const VITALS_CLS_SOURCES_MAX = 5;

// Layout shifts kept for the session windows; above it only the largest and the trailing window survive.
const VITALS_OBS_SHIFTS_MAX = 50;
// Shifts below this value get no selectors (too small to be the reason).
const VITALS_OBS_SHIFT_MIN = 0.001;
// Sources (nodes) attributed per shift.
const VITALS_OBS_SOURCES_PER_SHIFT = 5;
// Interactions kept for INP. With >= 500 interactions the ~p98 pick is the 10th longest, so dropping the
// shortest above this cap does not change the result.
const VITALS_OBS_INTERACTIONS_MAX = 500;
const VITALS_OBS_URL_MAX = 4000;
const VITALS_OBS_EVENT_NAME_MAX = 100;

function vitalsObsTry(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function vitalsObsMs(value) {
  return Math.round(value * 10) / 10;
}

function vitalsObsGetter(ctor, name) {
  return vitalsObsTry(() => {
    const desc = Object.getOwnPropertyDescriptor(ctor.prototype, name);
    return desc && typeof desc.get === 'function' ? desc.get : undefined;
  }, undefined);
}

// Shifts of the session window that is still open (the last one); only it can still grow.
function vitalsObsTrailingWindow(shifts) {
  let current = [];
  for (let i = 0; i < shifts.length; i++) {
    const shift = shifts[i];
    const first = current[0];
    const last = current[current.length - 1];
    if (current.length && shift.startTime - last.startTime < 1000 && shift.startTime - first.startTime < 5000) current.push(shift);
    else current = [shift];
  }
  return current;
}

// Captured at document_start, before page scripts can patch the Performance API.
export function captureVitalsIntrinsics(win) {
  const PO = vitalsObsTry(() => win.PerformanceObserver, undefined);
  const poProto = vitalsObsTry(() => PO.prototype, {});
  const perf = vitalsObsTry(() => win.performance, null);
  const supported = vitalsObsTry(() => PO.supportedEntryTypes, null);
  return {
    apply: Reflect.apply,
    PerformanceObserver: typeof PO === 'function' ? PO : undefined,
    observe: poProto.observe,
    disconnect: poProto.disconnect,
    takeRecords: poProto.takeRecords,
    getEntries: vitalsObsTry(() => win.PerformanceObserverEntryList.prototype.getEntries, undefined),
    supportedEntryTypes: Array.isArray(supported) ? supported.slice() : [],
    hasInteractionId: vitalsObsTry(() => 'interactionId' in win.PerformanceEventTiming.prototype, false),
    performance: perf,
    getEntriesByType: vitalsObsTry(() => perf.getEntriesByType, undefined),
    getVisibilityState: vitalsObsGetter(win.Document, 'visibilityState'),
    // Speculation Rules prerender: the document is 'hidden' until activation (absent where unsupported).
    getPrerendering: vitalsObsGetter(win.Document, 'prerendering'),
  };
}

/**
 * @returns {{ snapshot: (opts?: { final?: boolean }) => object, restore: () => void }}
 */
export function installVitals({ win, doc, now, selectorOf, intrinsics = {}, accept, options = {} }) {
  const I = { ...captureVitalsIntrinsics(win), ...intrinsics };
  const call = (fn, self, ...args) => I.apply(fn, self, args);
  // Filled by index, not new Set(iterable): the page may replace the array iterator (E4-IN2b).
  const types = new Set();
  const supported = I.PerformanceObserver ? vitalsList(I.supportedEntryTypes) : [];
  for (let i = 0; i < supported.length; i++) types.add(supported[i]);
  const since = typeof options.interactionsSince === 'number' && Number.isFinite(options.interactionsSince)
    ? options.interactionsSince
    : -Infinity;
  const ok = (t) => typeof t === 'number' && Number.isFinite(t) && (typeof accept !== 'function' || vitalsObsTry(() => accept(t) !== false, false));
  const select = (node) => {
    const sel = node ? vitalsObsTry(() => selectorOf(node), null) : null;
    return typeof sel === 'string' ? sel : null;
  };
  const visibility = () => vitalsObsTry(() => (I.getVisibilityState ? call(I.getVisibilityState, doc) : doc.visibilityState), 'visible');
  const prerendering = () => vitalsObsTry(() => (I.getPrerendering ? call(I.getPrerendering, doc) : doc.prerendering) === true, false);

  let active = true;
  // As web-vitals: a prerendered page is hidden until activation, which is not "hidden at start".
  let firstHidden = visibility() === 'hidden' && !prerendering() ? 0 : Infinity;
  let fcp = null;
  let lcp = null;
  let shifts = [];
  const interactions = new Map();
  let interactionsSeen = 0;
  let loafs = [];

  function onPaint(entry) {
    if (entry.name !== 'first-contentful-paint' || fcp || !(entry.startTime < firstHidden) || !ok(entry.startTime)) return;
    fcp = { startTime: entry.startTime };
  }

  function onLcp(entry) {
    if (!(entry.startTime < firstHidden) || !ok(entry.startTime)) return;
    const url = typeof entry.url === 'string' && entry.url !== '' ? entry.url.slice(0, VITALS_OBS_URL_MAX) : null;
    lcp = { startTime: entry.startTime, selector: select(entry.element), url };
  }

  function onShift(entry) {
    if (entry.hadRecentInput || typeof entry.value !== 'number' || !ok(entry.startTime)) return;
    const selectors = [];
    if (entry.value >= VITALS_OBS_SHIFT_MIN) {
      const sources = vitalsList(entry.sources).slice(0, VITALS_OBS_SOURCES_PER_SHIFT);
      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        const sel = select(source && source.node);
        if (sel) selectors.push(sel);
      }
    }
    shifts.push({ startTime: entry.startTime, value: entry.value, hadRecentInput: false, selectors });
    if (shifts.length > VITALS_OBS_SHIFTS_MAX) {
      const keep = new Set();
      const windowEntries = clsFromShifts(shifts).windowEntries;
      const trailing = vitalsObsTrailingWindow(shifts);
      for (let i = 0; i < windowEntries.length; i++) keep.add(windowEntries[i]);
      for (let i = 0; i < trailing.length; i++) keep.add(trailing[i]);
      shifts = shifts.filter((shift) => keep.has(shift)).slice(-VITALS_OBS_SHIFTS_MAX);
    }
  }

  function onEvent(entry) {
    const id = entry.interactionId;
    if (!(id > 0) || !(entry.startTime >= since) || !ok(entry.startTime)) return;
    const seen = interactions.get(id);
    if (seen && seen.duration >= entry.duration) return;
    if (!seen) interactionsSeen += 1;
    interactions.set(id, {
      interactionId: id,
      name: String(entry.name).slice(0, VITALS_OBS_EVENT_NAME_MAX),
      startTime: entry.startTime,
      duration: entry.duration,
      processingStart: entry.processingStart,
      processingEnd: entry.processingEnd,
      selector: select(entry.target),
    });
    if (interactions.size > VITALS_OBS_INTERACTIONS_MAX) {
      let shortest = null;
      interactions.forEach((item) => {
        if (!shortest || item.duration < shortest.duration) shortest = item;
      });
      interactions.delete(shortest.interactionId);
    }
  }

  function onLoaf(entry) {
    if (!ok(entry.startTime)) return;
    loafs.push({
      startTime: entry.startTime,
      duration: entry.duration,
      blockingDuration: entry.blockingDuration,
      scripts: vitalsMap(vitalsList(entry.scripts).slice(0, 10), (s) => ({
        sourceURL: s.sourceURL,
        sourceFunctionName: s.sourceFunctionName,
        invoker: s.invoker,
        duration: s.duration,
      })),
    });
    if (loafs.length > 2 * LONG_TASKS_MAX) {
      loafs = loafs.sort((a, b) => b.blockingDuration - a.blockingDuration).slice(0, LONG_TASKS_MAX);
    }
  }

  const observed = [
    ['paint', onPaint],
    ['largest-contentful-paint', onLcp],
    ['layout-shift', onShift],
    ['event', onEvent, { durationThreshold: 16 }],
    ['first-input', onEvent],
    ['long-animation-frame', onLoaf],
  ];

  function feed(handler, entries) {
    const list = vitalsObsTry(() => vitalsList(entries), []);
    for (let i = 0; i < list.length; i++) vitalsObsTry(() => list[i] && handler(list[i]));
  }

  const observers = [];
  for (let i = 0; i < observed.length; i++) {
    const type = observed[i][0];
    const handler = observed[i][1];
    const extra = observed[i][2];
    if (!types.has(type)) continue;
    vitalsObsTry(() => {
      const observer = new I.PerformanceObserver((list) => {
        if (!active) return;
        feed(handler, vitalsObsTry(() => (I.getEntries ? call(I.getEntries, list) : list.getEntries()), []));
      });
      call(I.observe, observer, { type, buffered: true, ...(extra || {}) });
      observers.push({ observer, handler });
    });
  }

  const onVisibility = () => {
    vitalsObsTry(() => {
      if (visibility() === 'hidden') firstHidden = Math.min(firstHidden, now());
    });
  };
  const add = I.addEventListener || vitalsObsTry(() => doc.addEventListener, null);
  const remove = I.removeEventListener || vitalsObsTry(() => doc.removeEventListener, null);
  vitalsObsTry(() => call(add, doc, 'visibilitychange', onVisibility, true));

  function navigationEntry() {
    return vitalsObsTry(() => call(I.getEntriesByType, I.performance, 'navigation')[0], undefined);
  }

  function activationStart() {
    const start = vitalsObsTry(() => navigationEntry().activationStart, 0);
    return typeof start === 'number' && start > 0 ? start : 0;
  }

  const metric = (name, value, t, finalized, extra = {}) => ({
    available: true,
    value,
    rating: rate(name, value),
    t,
    finalized,
    ...extra,
  });

  function ttfb() {
    if (typeof I.getEntriesByType !== 'function') return unavailable('unsupported-browser');
    const nav = navigationEntry();
    const start = nav && nav.responseStart;
    if (typeof start !== 'number' || !(start > 0) || !ok(start)) return unavailable('no-data');
    return metric('TTFB', vitalsObsMs(Math.max(start - activationStart(), 0)), vitalsObsMs(start), true);
  }

  function paintLike(name, type, seen, finalized, extra) {
    if (!types.has(type)) return unavailable('unsupported-browser');
    if (!seen) return unavailable(firstHidden === 0 ? 'hidden-at-start' : 'no-data');
    return metric(name, vitalsObsMs(Math.max(seen.startTime - activationStart(), 0)), vitalsObsMs(seen.startTime), finalized, extra);
  }

  function cls(final) {
    if (!types.has('layout-shift')) return unavailable('unsupported-browser');
    const result = clsFromShifts(shifts);
    const sources = [];
    const ranked = result.windowEntries.slice().sort((a, b) => b.value - a.value);
    for (let i = 0; i < ranked.length; i++) {
      const shift = ranked[i];
      for (let j = 0; j < shift.selectors.length; j++) {
        const selector = shift.selectors[j];
        if (sources.length < VITALS_CLS_SOURCES_MAX) {
          sources.push({ selector, value: Math.round(shift.value * 1000) / 1000, t: vitalsObsMs(shift.startTime) });
        }
      }
    }
    return metric('CLS', result.value, result.t === null ? null : vitalsObsMs(result.t), final, { sources });
  }

  function inp(final) {
    if (!types.has('event') || !I.hasInteractionId) return unavailable('unsupported-browser');
    const values = [];
    interactions.forEach((item) => { values.push(item); });
    const result = inpFromEvents(values);
    if (!result) return unavailable('no-interaction');
    const { entry } = result;
    const phases = inpPhases(entry);
    const extra = {};
    if (entry.selector) extra.selector = entry.selector;
    extra.eventType = entry.name;
    extra.inputDelay = vitalsObsMs(phases.inputDelay);
    extra.processing = vitalsObsMs(phases.processing);
    extra.presentation = vitalsObsMs(phases.presentation);
    extra.interactions = Math.max(result.count, interactionsSeen);
    return metric('INP', vitalsObsMs(result.value), vitalsObsMs(entry.startTime), final, extra);
  }

  function longTasks() {
    if (!types.has('long-animation-frame')) return unavailable('unsupported-browser');
    return { available: true, items: topLongTasks(loafs, LONG_TASKS_MAX) };
  }

  function snapshot({ final = false } = {}) {
    if (active) {
      for (let i = 0; i < observers.length; i++) {
        const { observer, handler } = observers[i];
        feed(handler, vitalsObsTry(() => call(I.takeRecords, observer), []));
      }
    }
    const finalized = final === true;
    const lcpExtra = {};
    if (lcp && lcp.selector) lcpExtra.selector = lcp.selector;
    if (lcp && lcp.url) lcpExtra.url = lcp.url;
    return {
      TTFB: vitalsObsTry(ttfb, unavailable('no-data')),
      FCP: vitalsObsTry(() => paintLike('FCP', 'paint', fcp, true), unavailable('no-data')),
      LCP: vitalsObsTry(() => paintLike('LCP', 'largest-contentful-paint', lcp, finalized, lcpExtra), unavailable('no-data')),
      CLS: vitalsObsTry(() => cls(finalized), unavailable('no-data')),
      INP: vitalsObsTry(() => inp(finalized), unavailable('no-data')),
      longTasks: vitalsObsTry(longTasks, unavailable('no-data')),
    };
  }

  function restore() {
    if (!active) return;
    // Pending records are taken first, so a stopped recorder keeps what was observed until now.
    for (let i = 0; i < observers.length; i++) {
      const { observer, handler } = observers[i];
      feed(handler, vitalsObsTry(() => call(I.takeRecords, observer), []));
      vitalsObsTry(() => call(I.disconnect, observer));
    }
    active = false;
    vitalsObsTry(() => call(remove, doc, 'visibilitychange', onVisibility, true));
  }

  return { snapshot, restore };
}
