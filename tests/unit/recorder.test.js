// @vitest-environment jsdom
/* global window -- jsdom global (vitest-environment jsdom) */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRecorder, isInstalled } from '../../src/page/recorder.js';
import { RECORDER_VERSION, PROTOCOL, LIMITS, MARKER_KEY, CONFIG_TIMEOUT_MS } from '../../src/page/constants.js';
import { createFakePerformance } from './helpers/fake-performance.js';

// Most tests use a fake window (an EventTarget with its own console/fetch/XHR/performance), so the test
// runner's console is never hooked and the clock is fully controlled by vitest fake timers.

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
const MARKER = Symbol.for(MARKER_KEY);
const TIME_ORIGIN = 1768471200000;

function makeWin({ Target = EventTarget } = {}) {
  const win = new Target();
  const startedAt = Date.now();
  win.EventTarget = Target;
  win.console = Object.fromEntries(LEVELS.map((l) => [l, vi.fn()]));
  win.fetch = vi.fn(async () => ({ status: 200, statusText: 'OK', ok: true, redirected: false, headers: new Headers() }));
  class FakeXhr extends EventTarget {
    static DONE = 4;
    open() {}
    setRequestHeader() {}
    send() {}
    getAllResponseHeaders() {
      return '';
    }
  }
  win.XMLHttpRequest = FakeXhr;
  win.performance = { timeOrigin: TIME_ORIGIN, now: () => Date.now() - startedAt };
  win.setTimeout = (fn, ms) => setTimeout(fn, ms);
  win.clearTimeout = (id) => clearTimeout(id);
  win.document = { baseURI: 'http://127.0.0.1:8080/page.html' };
  win.location = { href: 'http://127.0.0.1:8080/page.html' };
  return win;
}

// Stack text under test control (V8 Error.prepareStackTrace), independent of the checkout path (QA F-5).
const shortStack = () => ['Error', 'stackFromHere', 'wrapper', 'page'].map((fn, i) => (i ? `    at ${fn} (p.js:1:1)` : fn)).join('\n');

function withStack(prepare, fn) {
  const saved = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
  Error.prepareStackTrace = prepare;
  try {
    fn();
  } finally {
    if (saved) Object.defineProperty(Error, 'prepareStackTrace', saved);
    else delete Error.prepareStackTrace;
  }
}

function originalsOf(win) {
  return { fetch: win.fetch, XMLHttpRequest: win.XMLHttpRequest, console: { ...win.console } };
}

function dispatchError(win, props) {
  const event = new Event('error');
  Object.assign(event, props);
  win.dispatchEvent(event);
}

beforeEach(() => {
  vi.useFakeTimers();
  // Wall clock = page timeOrigin at window creation, so `deadline` (epoch from the background) and the fake
  // `performance.now()` share one base.
  vi.setSystemTime(TIME_ORIGIN);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createRecorder', () => {
  it('install defines non-enumerable frozen marker with version only', () => {
    const win = makeWin();
    expect(isInstalled(win)).toBe(false);
    const rec = createRecorder({ win });
    expect(rec.install()).toBe(true);
    expect(isInstalled(win)).toBe(true);
    const desc = Object.getOwnPropertyDescriptor(win, MARKER);
    expect(desc.enumerable).toBe(false);
    expect(desc.configurable).toBe(false);
    expect(desc.writable).toBe(false);
    expect(Object.isFrozen(desc.value)).toBe(true);
    expect(desc.value).toEqual({ version: RECORDER_VERSION });
    rec.destroy();
  });

  it('install hooks fetch, XMLHttpRequest, console and error listeners', async () => {
    const win = makeWin();
    const orig = originalsOf(win);
    const rec = createRecorder({ win });
    rec.install();
    rec.setConfig({ record: true, docId: 3 });
    expect(rec.isActive).toBe(true);
    expect(win.fetch).not.toBe(orig.fetch);
    expect(win.XMLHttpRequest).not.toBe(orig.XMLHttpRequest);
    for (const l of LEVELS) expect(win.console[l]).not.toBe(orig.console[l]);

    win.console.log('hello');
    await win.fetch('/api');
    const xhr = new win.XMLHttpRequest();
    expect(xhr).toBeInstanceOf(orig.XMLHttpRequest);
    xhr.open('GET', '/x');
    xhr.send();
    xhr.dispatchEvent(new Event('loadend'));
    dispatchError(win, { message: 'boom', filename: 'a.js', lineno: 1, colno: 2 });

    const out = rec.exportBuffers();
    expect(out.consoleLogs).toHaveLength(1);
    expect(out.network.map((n) => n.type)).toEqual(['fetch', 'xhr']);
    expect(out.runtimeErrors).toHaveLength(1);
    // steps: the navigate step recorded at install (E2-T9a).
    expect(out.counts).toEqual({ consoleLogs: 1, runtimeErrors: 1, network: 2, steps: 1 });
    expect(out.truncated).toEqual({ consoleLogs: false, runtimeErrors: false, network: false, steps: false, responseBodies: false });
    rec.destroy();
  });

  it('records carry t (ms since timeOrigin) and doc from config, also for entries before config', () => {
    const win = makeWin();
    const rec = createRecorder({ win });
    rec.install();
    vi.advanceTimersByTime(5);
    win.console.log('early');
    rec.setConfig({ record: true, docId: 7 });
    vi.advanceTimersByTime(10);
    win.console.warn('late', { a: 1 });
    const logs = rec.exportBuffers().consoleLogs;
    expect(logs.map((l) => [l.t, l.doc, l.level])).toEqual([
      [5, 7, 'log'],
      [15, 7, 'warn'],
    ]);
    expect(logs[1].args).toEqual(['late', { a: 1 }]);
    expect(rec.timeOrigin).toBe(TIME_ORIGIN);
    rec.destroy();
  });

  it('exportBuffers returns copies', () => {
    const win = makeWin();
    const rec = createRecorder({ win });
    rec.install();
    rec.setConfig({ record: true, docId: 1 });
    win.console.log('x');
    const a = rec.exportBuffers();
    a.consoleLogs[0].level = 'mutated';
    a.consoleLogs.push({});
    a.truncated.consoleLogs = true;
    const b = rec.exportBuffers();
    expect(b.consoleLogs).toHaveLength(1);
    expect(b.consoleLogs[0].level).toBe('log');
    expect(b.truncated.consoleLogs).toBe(false);
    rec.destroy();
  });

  it('second install in same window is a no-op and does not double entries', () => {
    const win = makeWin();
    const first = createRecorder({ win });
    first.install();
    first.setConfig({ record: true, docId: 0 });
    const hooked = originalsOf(win);
    const second = createRecorder({ win });
    expect(isInstalled(win)).toBe(true);
    expect(second.install()).toBe(false);
    expect(second.isActive).toBe(false);
    expect(first.install()).toBe(false);
    expect(win.fetch).toBe(hooked.fetch);
    expect(win.console.log).toBe(hooked.console.log);
    win.console.log('once');
    dispatchError(win, { message: 'once' });
    expect(first.exportBuffers().consoleLogs).toHaveLength(1);
    expect(first.exportBuffers().runtimeErrors).toHaveLength(1);
    expect(second.exportBuffers().consoleLogs).toHaveLength(0);
    first.destroy();
  });

  it('window own property names/symbols after install differ only by the marker; no __PAGE_DEBUG_SNAPSHOT__ / PageDebugSnapshot', () => {
    vi.useRealTimers();
    const before = Reflect.ownKeys(window);
    const rec = createRecorder({ win: window });
    try {
      expect(rec.install()).toBe(true);
      const after = Reflect.ownKeys(window);
      expect(after.filter((k) => !before.includes(k))).toEqual([MARKER]);
      expect(before.filter((k) => !after.includes(k))).toEqual([]);
      expect('__PAGE_DEBUG_SNAPSHOT__' in window).toBe(false);
      expect('PageDebugSnapshot' in window).toBe(false);
    } finally {
      rec.destroy();
    }
  });

  it('destroy restores fetch, XMLHttpRequest and console methods (===) and removes error listeners', () => {
    const win = makeWin();
    const orig = originalsOf(win);
    const rec = createRecorder({ win });
    rec.install();
    rec.setConfig({ record: true, docId: 0 });
    win.console.log('kept until destroy');
    rec.destroy();
    expect(win.fetch).toBe(orig.fetch);
    expect(win.XMLHttpRequest).toBe(orig.XMLHttpRequest);
    for (const l of LEVELS) expect(win.console[l]).toBe(orig.console[l]);
    dispatchError(win, { message: 'after destroy' });
    win.console.log('after destroy');
    const out = rec.exportBuffers();
    expect(out.consoleLogs).toEqual([]);
    expect(out.runtimeErrors).toEqual([]);
    expect(out.counts).toEqual({ consoleLogs: 0, runtimeErrors: 0, network: 0, steps: 0 });
    expect(rec.isActive).toBe(false);
  });

  it('recorder never writes to console', async () => {
    const win = makeWin();
    const orig = originalsOf(win);
    const rec = createRecorder({ win });
    rec.install();
    rec.setConfig({ record: true, docId: 0, deadline: TIME_ORIGIN + 1000 });
    win.console.info('page', 1n, { toJSON() { throw new Error('nope'); } });
    dispatchError(win, { message: 'x' });
    await win.fetch('/a');
    vi.advanceTimersByTime(2000);
    win.console.error('after stop');
    rec.destroy();
    const calls = LEVELS.flatMap((l) => orig.console[l].mock.calls.map((args) => [l, args[0]]));
    expect(calls).toEqual([
      ['info', 'page'],
      ['error', 'after stop'],
    ]);
  });

  it('6000 console.log keep 5000 newest, truncated.consoleLogs true; 10 logs → truncated false', () => {
    // Short fixed stacks: the count limit is measured, not the char budget (QA F-5: long checkout paths).
    withStack(shortStack, () => {
      const win = makeWin();
      const rec = createRecorder({ win });
      rec.install();
      rec.setConfig({ record: true, docId: 0 });
      for (let i = 0; i < 6000; i++) win.console.log(i);
      const out = rec.exportBuffers();
      expect(out.consoleLogs).toHaveLength(LIMITS.consoleLogs);
      expect(out.consoleLogs[0].args).toEqual([1000]);
      expect(out.consoleLogs.at(-1).args).toEqual([5999]);
      expect(out.truncated.consoleLogs).toBe(true);
      expect(out.counts.consoleLogs).toBe(6000);
      rec.destroy();

      const win2 = makeWin();
      const rec2 = createRecorder({ win: win2 });
      rec2.install();
      rec2.setConfig({ record: true, docId: 0 });
      for (let i = 0; i < 10; i++) win2.console.log(i);
      expect(rec2.exportBuffers().consoleLogs).toHaveLength(10);
      expect(rec2.exportBuffers().truncated.consoleLogs).toBe(false);
      rec2.destroy();
    });
  });

  it('documentChars evicts the oldest before maxItems is reached when entries are large', () => {
    withStack(shortStack, () => {
      const win = makeWin();
      const rec = createRecorder({ win, options: { limits: { documentChars: 50_000 } } });
      rec.install();
      rec.setConfig({ record: true, docId: 0 });
      for (let i = 0; i < 1000; i++) win.console.log(`${i}:${'x'.repeat(200)}`);
      const out = rec.exportBuffers();
      // Each entry costs > 200 chars, so at most 250 fit, far below maxItems (5000).
      expect(out.consoleLogs.length).toBeGreaterThan(100);
      expect(out.consoleLogs.length).toBeLessThan(250);
      expect(out.consoleLogs.at(-1).args[0].startsWith('999:')).toBe(true);
      expect(out.consoleLogs[0].args[0].startsWith(`${1000 - out.consoleLogs.length}:`)).toBe(true);
      expect(out.truncated.consoleLogs).toBe(true);
      expect(out.counts.consoleLogs).toBe(1000);
      rec.destroy();
    });
  });

  it('oversized values are capped at entryChars and the document char budget evicts oldest', () => {
    const win = makeWin();
    const rec = createRecorder({ win, options: { limits: { entryChars: 100, documentChars: 2000 } } });
    rec.install();
    rec.setConfig({ record: true, docId: 0 });
    win.console.log('y'.repeat(500));
    const first = rec.exportBuffers().consoleLogs[0];
    expect(first.args.truncated).toBe(true);
    expect(first.args.preview.length).toBe(100);
    for (let i = 0; i < 50; i++) win.console.log('z'.repeat(80));
    const out = rec.exportBuffers();
    expect(out.consoleLogs.length).toBeLessThan(51);
    expect(out.truncated.consoleLogs).toBe(true);
    rec.destroy();
  });

  it("stop('time-limit') removes hooks, keeps buffers, ignores later records", () => {
    const win = makeWin();
    const orig = originalsOf(win);
    const onStopped = vi.fn();
    const rec = createRecorder({ win, options: { onStopped } });
    rec.install();
    rec.setConfig({ record: true, docId: 2, deadline: TIME_ORIGIN + 5000 });
    vi.advanceTimersByTime(1000);
    win.console.log('before');
    vi.advanceTimersByTime(4000);
    expect(rec.isActive).toBe(false);
    expect(rec.stopReason).toBe('time-limit');
    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(onStopped).toHaveBeenCalledWith('time-limit');
    expect(win.fetch).toBe(orig.fetch);
    expect(win.XMLHttpRequest).toBe(orig.XMLHttpRequest);
    for (const l of LEVELS) expect(win.console[l]).toBe(orig.console[l]);
    win.console.log('after');
    dispatchError(win, { message: 'after' });
    const out = rec.exportBuffers();
    expect(out.consoleLogs.map((l) => l.args[0])).toEqual(['before']);
    expect(out.runtimeErrors).toEqual([]);
    expect(rec.snapshot().stopReason).toBe('time-limit');
  });

  it('records after deadline are dropped and stop the recording even if timer is late (E2 D8)', () => {
    const win = makeWin();
    const rec = createRecorder({ win });
    rec.install();
    rec.setConfig({ record: true, docId: 0, deadline: TIME_ORIGIN + 5000 });
    vi.advanceTimersByTime(4999);
    win.console.log('just before');
    // Move the clock past the deadline without running timers (throttled background tab).
    vi.setSystemTime(Date.now() + 1);
    win.console.log('at deadline');
    dispatchError(win, { message: 'late' });
    // E1 waited for the timer here; since E2 the first event past the deadline stops at once.
    expect(rec.isActive).toBe(false);
    const out = rec.exportBuffers();
    expect(out.consoleLogs.map((l) => [l.args[0], l.t])).toEqual([['just before', 4999]]);
    expect(out.runtimeErrors).toEqual([]);
    vi.runOnlyPendingTimers();
    expect(rec.isActive).toBe(false);
    expect(rec.stopReason).toBe('time-limit');
  });

  it('wall clock jumps 11 min while performance.now() stands (sleep) → later records dropped, stop(time-limit)', () => {
    const win = makeWin();
    const onStopped = vi.fn();
    let perfNow = 0;
    win.performance.now = () => perfNow;
    const rec = createRecorder({ win, options: { onStopped } });
    rec.install();
    rec.setConfig({ record: true, docId: 0, deadline: Date.now() + 600_000 });
    perfNow = 1000;
    win.console.log('before sleep');
    // Laptop asleep: wall clock moves 11 min, the monotonic clock does not.
    vi.setSystemTime(Date.now() + 11 * 60_000);
    win.console.log('after wake');
    expect(rec.exportBuffers().consoleLogs.map((l) => l.args[0])).toEqual(['before sleep']);
    vi.advanceTimersByTime(600_000);
    expect(rec.isActive).toBe(false);
    expect(rec.stopReason).toBe('time-limit');
    expect(onStopped).toHaveBeenCalledWith('time-limit');
  });

  it('deadline already passed at config → stops at once without recording', () => {
    const win = makeWin();
    const onStopped = vi.fn();
    const rec = createRecorder({ win, options: { onStopped } });
    rec.install();
    vi.advanceTimersByTime(100);
    rec.setConfig({ record: true, docId: 0, deadline: TIME_ORIGIN + 50 });
    expect(rec.isActive).toBe(false);
    expect(rec.stopReason).toBe('time-limit');
    expect(onStopped).toHaveBeenCalledWith('time-limit');
  });

  it("stop('user') keeps buffers; destroy afterwards clears them", () => {
    const win = makeWin();
    const rec = createRecorder({ win });
    rec.install();
    rec.setConfig({ record: true, docId: 0 });
    win.console.log('a');
    rec.stop('user');
    expect(rec.stopReason).toBe('user');
    expect(rec.exportBuffers().consoleLogs).toHaveLength(1);
    rec.stop('navigation');
    expect(rec.stopReason).toBe('user');
    rec.destroy();
    expect(rec.exportBuffers().consoleLogs).toHaveLength(0);
  });

  it('no config within 10 s → destroyed and buffers empty', () => {
    const win = makeWin();
    const orig = originalsOf(win);
    const rec = createRecorder({ win });
    rec.install();
    win.console.log('pending');
    vi.advanceTimersByTime(CONFIG_TIMEOUT_MS - 1);
    expect(rec.isActive).toBe(true);
    vi.advanceTimersByTime(1);
    expect(rec.isActive).toBe(false);
    expect(win.console.log).toBe(orig.console.log);
    expect(rec.exportBuffers().consoleLogs).toEqual([]);
  });

  it('config in time cancels the fail-safe', () => {
    const win = makeWin();
    const rec = createRecorder({ win });
    rec.install();
    rec.setConfig({ record: true, docId: 0 });
    vi.advanceTimersByTime(CONFIG_TIMEOUT_MS * 3);
    expect(rec.isActive).toBe(true);
    rec.destroy();
  });

  it('setConfig({record:false}) destroys and clears', () => {
    const win = makeWin();
    const orig = originalsOf(win);
    const rec = createRecorder({ win });
    rec.install();
    win.console.log('before config');
    rec.setConfig({ record: false, docId: 4 });
    expect(rec.isActive).toBe(false);
    expect(win.fetch).toBe(orig.fetch);
    expect(rec.exportBuffers().consoleLogs).toEqual([]);
  });

  it('snapshot returns the flat current-document shape consumed by assemblePackage', () => {
    const win = makeWin();
    const rec = createRecorder({ win });
    rec.install();
    rec.setConfig({ record: true, docId: 9 });
    win.console.log('x');
    const snap = rec.snapshot();
    expect(Object.keys(snap).sort()).toEqual(
      ['consoleLogs', 'counts', 'docId', 'documentStatus', 'navigationType', 'network', 'protocol', 'recorderVersion',
        'runtimeErrors', 'steps', 'stopReason', 'timeOrigin', 'truncated', 'url', 'vitals'].sort(),
    );
    expect(snap.docId).toBe(9);
    expect(snap.timeOrigin).toBe(TIME_ORIGIN);
    expect(snap.url).toBe('http://127.0.0.1:8080/page.html');
    expect(snap.stopReason).toBe(null);
    expect(snap.recorderVersion).toBe(RECORDER_VERSION);
    rec.destroy();
  });

  it('RECORDER_VERSION equals manifest.base.json version', () => {
    const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/manifest.base.json'), 'utf8'));
    expect(RECORDER_VERSION).toBe(manifest.version);
  });
});

// ---- E2-T9a: steps, resources, vitals, frames, deadline at the event, response-body budget ----

// EventTarget that remembers its listeners, so a test can hand them trusted-looking events (jsdom and node
// events are always untrusted) and check that the recorder removed every listener it added.
const targetListeners = new WeakMap();
class ListenedTarget extends EventTarget {
  addEventListener(type, fn, opts) {
    const list = targetListeners.get(this) || [];
    list.push([type, fn]);
    targetListeners.set(this, list);
    return super.addEventListener(type, fn, opts);
  }

  removeEventListener(type, fn, opts) {
    const list = targetListeners.get(this) || [];
    const i = list.findIndex(([t, f]) => t === type && f === fn);
    if (i >= 0) list.splice(i, 1);
    return super.removeEventListener(type, fn, opts);
  }
}

const listenersOf = (target) => (targetListeners.get(target) || []).map(([type]) => type);

function fireTrusted(target, type, props = {}) {
  const event = { type, isTrusted: true, ...props };
  for (const [t, fn] of [...(targetListeners.get(target) || [])]) if (t === type) fn.call(target, event);
}

class FakeElement {
  closest() {
    return null;
  }

  getAttribute() {
    return null;
  }
}

// makeWin() plus History, a Performance Timeline (fake-performance.js), Resource Timing with responseStatus,
// a listened document and a MutationObserver — everything the E2 hooks install on.
function makeRichWin({ navigation = { responseStart: 47, activationStart: 0, type: 'navigate', responseStatus: 200 } } = {}) {
  const win = makeWin({ Target: ListenedTarget });
  const fake = createFakePerformance({ navigation });
  Object.assign(win.performance, fake.win.performance);
  win.PerformanceObserver = fake.win.PerformanceObserver;
  win.PerformanceEventTiming = fake.win.PerformanceEventTiming;
  function PerformanceResourceTiming() {}
  Object.defineProperty(PerformanceResourceTiming.prototype, 'responseStatus', { get: () => 0 });
  win.PerformanceResourceTiming = PerformanceResourceTiming;
  class FakeHistory {}
  FakeHistory.prototype.pushState = function pushState() {};
  FakeHistory.prototype.replaceState = function replaceState() {};
  win.History = FakeHistory;
  win.Element = FakeElement;
  const mutationObservers = [];
  win.MutationObserver = class {
    constructor(cb) {
      this.cb = cb;
      this.disconnected = false;
      mutationObservers.push(this);
    }

    observe() {}

    disconnect() {
      this.disconnected = true;
    }
  };
  const doc = new ListenedTarget();
  doc.baseURI = 'http://127.0.0.1:8080/page.html';
  doc.visibilityState = 'visible';
  doc.querySelectorAll = () => [];
  win.document = doc;
  win.location = { href: 'http://127.0.0.1:8080/page.html', origin: 'http://127.0.0.1:8080' };
  const history = { pushState: FakeHistory.prototype.pushState, replaceState: FakeHistory.prototype.replaceState };
  return { win, doc, fake, history, mutationObservers };
}

function startRich(opts = {}, setup = {}) {
  const env = makeRichWin(setup);
  const onStopped = vi.fn();
  const rec = createRecorder({ win: env.win, options: { onStopped, ...opts } });
  rec.install();
  return { ...env, rec, onStopped };
}

describe('createRecorder — E2 hooks (E2-T9a)', () => {
  it('constants: protocol 2 and the v3 limits', () => {
    expect(PROTOCOL).toBe(2);
    expect(LIMITS).toMatchObject({
      steps: 2000, responseBodyChars: 4096, responseBodyTotalChars: 262144, longTasks: 20, stackChars: 16000,
    });
  });

  it('install adds steps/resources/vitals/frames; destroy restores History methods, disconnects observers, removes listeners', () => {
    const { win, doc, fake, history, mutationObservers, rec } = startRich();
    rec.setConfig({ record: true, docId: 0 });
    expect(win.History.prototype.pushState).not.toBe(history.pushState);
    expect(win.History.prototype.replaceState).not.toBe(history.replaceState);
    const watched = fake.observers.flatMap((o) => o.options.map((opt) => opt.type));
    expect(watched).toEqual(expect.arrayContaining(['resource', 'paint', 'largest-contentful-paint', 'layout-shift', 'event', 'long-animation-frame']));
    expect(mutationObservers).toHaveLength(1);
    expect(listenersOf(win)).toEqual(expect.arrayContaining(['click', 'input', 'change', 'submit', 'keydown', 'popstate', 'hashchange']));
    expect(listenersOf(doc)).toContain('visibilitychange');
    // Navigate step at install (D4).
    expect(rec.exportBuffers().steps.map((s) => [s.type, s.via, s.doc])).toEqual([['navigate', 'navigate', 0]]);

    rec.destroy();
    expect(win.History.prototype.pushState).toBe(history.pushState);
    expect(win.History.prototype.replaceState).toBe(history.replaceState);
    expect(fake.observers.every((o) => o.disconnected)).toBe(true);
    expect(mutationObservers.every((o) => o.disconnected)).toBe(true);
    expect(listenersOf(win)).toEqual([]);
    expect(listenersOf(doc)).toEqual([]);
    expect(rec.exportBuffers().steps).toEqual([]);
  });

  it('3000 clicks keep newest 2000 and truncated.steps (AC-3.6)', () => {
    const { win, rec } = startRich();
    rec.setConfig({ record: true, docId: 1 });
    for (let i = 0; i < 3000; i++) {
      vi.advanceTimersByTime(1);
      fireTrusted(win, 'click', { target: new FakeElement() });
    }
    const out = rec.exportBuffers();
    expect(out.steps).toHaveLength(LIMITS.steps);
    expect(out.steps.every((s) => s.type === 'click' && s.doc === 1)).toBe(true);
    expect(out.steps[0].t).toBe(1001);
    expect(out.steps.at(-1).t).toBe(3000);
    expect(out.truncated.steps).toBe(true);
    expect(out.counts.steps).toBe(3001);
    rec.destroy();
  });

  it('Date.now() 11 min past deadline, timer not fired: next console.log stops recording with time-limit and calls onStopped; entry dropped (AC-2.2)', () => {
    const { win, rec, onStopped } = startRich();
    rec.setConfig({ record: true, docId: 0, deadline: Date.now() + 600_000 });
    win.console.log('before sleep');
    // Laptop asleep: only the wall clock moves (setSystemTime does not advance the monotonic clock here).
    vi.setSystemTime(Date.now() + 11 * 60_000);
    win.console.log('after wake');
    expect(rec.isActive).toBe(false);
    expect(rec.stopReason).toBe('time-limit');
    expect(onStopped).toHaveBeenCalledTimes(1);
    expect(onStopped).toHaveBeenCalledWith('time-limit');
    expect(rec.exportBuffers().consoleLogs.map((l) => l.args[0])).toEqual(['before sleep']);
    expect(rec.snapshot().stopReason).toBe('time-limit');
  });

  it('visibilitychange after deadline stops', () => {
    const { doc, rec, onStopped } = startRich();
    rec.setConfig({ record: true, docId: 0, deadline: Date.now() + 600_000 });
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(rec.isActive).toBe(true);
    vi.setSystemTime(Date.now() + 11 * 60_000);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(rec.isActive).toBe(false);
    expect(onStopped).toHaveBeenCalledWith('time-limit');
  });

  it('attach over the response-body budget drops the field and sets truncated.responseBodies', async () => {
    vi.useRealTimers();
    const { win, rec } = startRich({ limits: { responseBodyTotalChars: 10_000 } });
    rec.setConfig({ record: true, docId: 0 });
    const body = JSON.stringify({ error: 'boom', detail: 'a b '.repeat(1500) });
    win.fetch.mockImplementation(async () => new Response(body, { status: 500, headers: { 'content-type': 'application/json' } }));
    for (let i = 0; i < 3; i++) await win.fetch(`/api/${i}`);
    for (let i = 0; i < 50 && rec.snapshot().truncated.responseBodies !== true; i++) await new Promise((r) => setTimeout(r, 10));
    const snap = rec.snapshot();
    const previews = snap.network.map((n) => n.responseBodyPreview);
    expect(previews[0].length).toBeLessThanOrEqual(LIMITS.responseBodyChars);
    expect(previews[0].length).toBeGreaterThan(4000);
    expect(previews.filter((p) => typeof p === 'string')).toHaveLength(2);
    expect(snap.network[2]).not.toHaveProperty('responseBodyPreview');
    expect(snap.network[2]).not.toHaveProperty('responseBodyTruncated');
    expect(snap.truncated.responseBodies).toBe(true);
    rec.destroy();
  });

  it('snapshot contains steps, vitals, documentStatus, resource records with doc and fetch sizes; protocol 2', async () => {
    const { win, fake, rec } = startRich();
    rec.setConfig({ record: true, docId: 4 });
    vi.advanceTimersByTime(10);
    await win.fetch('/api/data');
    fake.queue('resource', [
      { name: 'http://127.0.0.1:8080/api/data', initiatorType: 'fetch', startTime: 10.5, duration: 2, responseStatus: 200, encodedBodySize: 23 },
      { name: 'http://127.0.0.1:8080/img/missing.png', initiatorType: 'img', startTime: 12, duration: 1, responseStatus: 404, encodedBodySize: 9 },
    ]);
    fake.queue('largest-contentful-paint', [{ startTime: 300, element: null, url: '' }]);
    const snap = rec.snapshot();
    expect(snap.protocol).toBe(2);
    expect(snap.steps.map((s) => s.type)).toEqual(['navigate']);
    expect(snap.documentStatus).toEqual({ status: 200 });
    expect(snap.vitals.LCP).toMatchObject({ available: true, value: 300, finalized: false });
    expect(snap.vitals.TTFB).toMatchObject({ available: true, value: 47 });
    expect(rec.snapshot({ final: true }).vitals.LCP.finalized).toBe(true);
    expect(snap.network.map((n) => [n.type, n.status, n.sizeBytes, n.doc])).toEqual([
      ['fetch', 200, 23, 4],
      ['img', 404, 9, 4],
    ]);
    expect(snap.truncated).toMatchObject({ steps: false, network: false, responseBodies: false });
    expect(snap.counts.network).toBe(2);
    rec.destroy();
  });

  it('stop(time-limit) freezes vitals and steps (no entries after); queued entries from before the deadline are kept', async () => {
    const { win, fake, rec } = startRich();
    rec.setConfig({ record: true, docId: 0, deadline: Date.now() + 600_000 });
    vi.advanceTimersByTime(1000);
    await win.fetch('/api/data');
    fake.queue('largest-contentful-paint', [{ startTime: 400, element: null, url: '' }]);
    fake.queue('resource', [
      { name: 'http://127.0.0.1:8080/api/data', initiatorType: 'fetch', startTime: 1000.5, duration: 2, responseStatus: 200, encodedBodySize: 23 },
      { name: 'http://127.0.0.1:8080/a.css', initiatorType: 'link', startTime: 900, duration: 1, responseStatus: 200, encodedBodySize: 5 },
    ]);
    vi.setSystemTime(Date.now() + 11 * 60_000);
    fireTrusted(win, 'click', { target: new FakeElement() });
    expect(rec.isActive).toBe(false);
    // Hooks are off: no listener left, observers disconnected.
    fireTrusted(win, 'click', { target: new FakeElement() });
    fake.emit('largest-contentful-paint', [{ startTime: 900, element: null, url: '' }]);
    const snap = rec.snapshot({ final: true });
    expect(snap.steps.map((s) => s.type)).toEqual(['navigate']);
    expect(snap.vitals.LCP).toMatchObject({ available: true, value: 400 });
    expect(snap.network.map((n) => [n.type, n.sizeBytes])).toEqual([
      ['fetch', 23],
      ['css', 5],
    ]);
    expect(snap.stopReason).toBe('time-limit');
  });

  it('interactionsSince reaches vitals; entries with startTime past the deadline are rejected', () => {
    const { fake, rec } = startRich({ interactionsSince: 500 });
    rec.setConfig({ record: true, docId: 0, deadline: TIME_ORIGIN + 2000 });
    fake.queue('event', [
      { name: 'click', interactionId: 1, startTime: 100, duration: 300, processingStart: 110, processingEnd: 380, target: null },
      { name: 'click', interactionId: 2, startTime: 600, duration: 120, processingStart: 610, processingEnd: 700, target: null },
    ]);
    fake.queue('largest-contentful-paint', [{ startTime: 2500, element: null, url: '' }]);
    const snap = rec.snapshot();
    expect(snap.vitals.INP).toMatchObject({ available: true, value: 120 });
    expect(snap.vitals.LCP).toMatchObject({ available: false, reason: 'no-data' });
    rec.destroy();
  });
});
