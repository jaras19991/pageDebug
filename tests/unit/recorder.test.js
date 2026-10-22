// @vitest-environment jsdom
/* global window -- jsdom global (vitest-environment jsdom) */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRecorder, isInstalled } from '../../src/page/recorder.js';
import { RECORDER_VERSION, LIMITS, MARKER_KEY, CONFIG_TIMEOUT_MS } from '../../src/page/constants.js';

// Most tests use a fake window (an EventTarget with its own console/fetch/XHR/performance), so the test
// runner's console is never hooked and the clock is fully controlled by vitest fake timers.

const LEVELS = ['log', 'info', 'warn', 'error', 'debug'];
const MARKER = Symbol.for(MARKER_KEY);
const TIME_ORIGIN = 1768471200000;

function makeWin() {
  const win = new EventTarget();
  const startedAt = Date.now();
  win.EventTarget = EventTarget;
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
    expect(out.counts).toEqual({ consoleLogs: 1, runtimeErrors: 1, network: 2 });
    expect(out.truncated).toEqual({ consoleLogs: false, runtimeErrors: false, network: false });
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
    expect(out.counts).toEqual({ consoleLogs: 0, runtimeErrors: 0, network: 0 });
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

  it('records after deadline are dropped even if timer is late', () => {
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
    expect(rec.isActive).toBe(true);
    const out = rec.exportBuffers();
    expect(out.consoleLogs.map((l) => [l.args[0], l.t])).toEqual([['just before', 4999]]);
    expect(out.runtimeErrors).toEqual([]);
    vi.runOnlyPendingTimers();
    expect(rec.isActive).toBe(false);
    expect(rec.stopReason).toBe('time-limit');
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
      ['consoleLogs', 'counts', 'docId', 'navigationType', 'network', 'protocol', 'recorderVersion',
        'runtimeErrors', 'stopReason', 'timeOrigin', 'truncated', 'url'].sort(),
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
