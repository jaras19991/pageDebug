// Fake Performance Timeline for vitals unit tests (E2-T1b). jsdom has no PerformanceObserver, so tests build
// a window-like object with a PerformanceObserver whose entries they control:
//   buffer(type, entries)  entries recorded before observe(); handed over with `buffered: true` (via takeRecords),
//   emit(type, entries)    delivered to the observers' callbacks right away,
//   queue(type, entries)   pending in the observers, returned by the next takeRecords().

export const ALL_ENTRY_TYPES = Object.freeze([
  'navigation',
  'resource',
  'paint',
  'largest-contentful-paint',
  'layout-shift',
  'event',
  'first-input',
  'long-animation-frame',
]);

// Entry types of a browser without CLS/INP/LoAF (Firefox as of E2).
export const FIREFOX_ENTRY_TYPES = Object.freeze(['navigation', 'resource', 'paint', 'largest-contentful-paint', 'event', 'first-input']);

function entryList(entries) {
  return { getEntries: () => entries.slice() };
}

export function createFakePerformance({
  types = ALL_ENTRY_TYPES,
  interactionId = true,
  navigation = { responseStart: 47, activationStart: 0, type: 'navigate' },
  withObserver = true,
} = {}) {
  const buffered = new Map();
  const observers = [];

  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback;
      this.options = [];
      this.pending = [];
      this.disconnected = false;
      observers.push(this);
    }

    static get supportedEntryTypes() {
      return types.slice();
    }

    observe(options) {
      if (!types.includes(options.type)) return;
      this.options.push(options);
      if (options.buffered) this.pending.push(...(buffered.get(options.type) || []));
    }

    takeRecords() {
      const out = this.pending;
      this.pending = [];
      return out;
    }

    disconnect() {
      this.disconnected = true;
      this.pending = [];
    }

    watches(type) {
      return !this.disconnected && this.options.some((o) => o.type === type);
    }
  }

  function PerformanceEventTiming() {}
  if (interactionId) {
    Object.defineProperty(PerformanceEventTiming.prototype, 'interactionId', { get: () => 0, configurable: true });
  }

  const performance = {
    getEntriesByType: (type) => (type === 'navigation' && navigation ? [{ entryType: 'navigation', ...navigation }] : []),
  };

  const win = { performance, PerformanceEventTiming };
  if (withObserver) win.PerformanceObserver = FakePerformanceObserver;

  return {
    win,
    observers,
    buffer(type, entries) {
      buffered.set(type, [...(buffered.get(type) || []), ...entries.map((e) => ({ entryType: type, ...e }))]);
    },
    emit(type, entries) {
      const full = entries.map((e) => ({ entryType: type, ...e }));
      for (const o of observers) if (o.watches(type)) o.callback(entryList(full), o);
    },
    queue(type, entries) {
      const full = entries.map((e) => ({ entryType: type, ...e }));
      for (const o of observers) if (o.watches(type)) o.pending.push(...full);
    },
  };
}
