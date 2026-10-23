// @vitest-environment jsdom
/* global window, document -- jsdom globals (vitest-environment jsdom) */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installResourceHooks, RESOURCE_LIMITS } from '../../src/page/hooks-resources.js';
import { installErrorHooks } from '../../src/page/hooks-errors.js';

// E2-T3b: Resource Timing observer + element load errors + document status (D2, AC-4.1–4.4).
// jsdom has no PerformanceObserver: a fake one delivers entries synchronously through `emit`.

const ORIGIN = window.location.origin; // jsdom default: http://localhost:3000 or about:blank origin

function makeFakePerf({ supportsStatus = true, nav = { responseStatus: 200 } } = {}) {
  const observers = [];
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
      this.pending = [];
      this.connected = false;
      this.options = null;
      observers.push(this);
    }
    observe(options) {
      this.options = options;
      this.connected = true;
    }
    disconnect() {
      this.connected = false;
    }
    takeRecords() {
      const out = this.pending;
      this.pending = [];
      return out;
    }
  }
  const timing = function PerformanceResourceTiming() {};
  if (supportsStatus) {
    Object.defineProperty(timing.prototype, 'responseStatus', { get() { return 0; }, configurable: true });
  }
  return {
    observers,
    PerformanceObserver: FakeObserver,
    PerformanceResourceTiming: timing,
    performance: {
      getEntriesByType: (type) => (type === 'navigation' && nav ? [nav] : []),
    },
    emit(entries) {
      for (const o of observers) if (o.connected) o.callback({ getEntries: () => entries });
    },
    queue(entries) {
      for (const o of observers) if (o.connected) o.pending.push(...entries);
    },
  };
}

function rt(name, initiatorType, extra = {}) {
  return {
    name, initiatorType, startTime: 10, duration: 5, responseStatus: 200,
    encodedBodySize: 100, decodedBodySize: 100, transferSize: 400, ...extra,
  };
}

function setup(perfOptions, ctxExtra = {}) {
  const fake = makeFakePerf(perfOptions);
  const records = [];
  let clock = 100;
  const ctx = {
    win: window,
    doc: document,
    now: () => (clock += 1),
    record: (section, entry) => records.push({ section, entry }),
    intrinsics: {
      PerformanceObserver: fake.PerformanceObserver,
      PerformanceResourceTiming: fake.PerformanceResourceTiming,
      performance: fake.performance,
    },
    ...ctxExtra,
  };
  const hooks = installResourceHooks(ctx);
  return { fake, records, hooks, ctx };
}

describe('installResourceHooks', () => {
  let current;
  afterEach(() => {
    if (current) current.hooks.restore();
    current = null;
    document.body.innerHTML = '';
  });

  it('observes resource entries with buffered: true', () => {
    current = setup();
    expect(current.fake.observers).toHaveLength(1);
    expect(current.fake.observers[0].options).toEqual({ type: 'resource', buffered: true });
  });

  it('img 404 and script 404 same-origin produce records with status 404 and kind (AC-4.1)', () => {
    current = setup();
    current.fake.emit([
      rt(`${ORIGIN}/img/missing.png`, 'img', { responseStatus: 404 }),
      rt(`${ORIGIN}/js/missing.js`, 'script', { responseStatus: 404 }),
    ]);
    expect(current.records.map((r) => r.section)).toEqual(['network', 'network']);
    expect(current.records[0].entry).toMatchObject({ type: 'img', status: 404, ok: false, url: `${ORIGIN}/img/missing.png` });
    expect(current.records[1].entry).toMatchObject({ type: 'script', status: 404, ok: false });
    expect(current.records[0].entry).not.toHaveProperty('statusUnavailable');
  });

  it('css 200 → type css', () => {
    current = setup();
    current.fake.emit([rt(`${ORIGIN}/style.css`, 'link')]);
    expect(current.records[0].entry).toMatchObject({ type: 'css', status: 200, ok: true, sizeBytes: 100 });
  });

  it('font kind comes from the file extension (Chrome initiatorType css, Firefox other; spike T0)', () => {
    current = setup();
    current.fake.emit([rt(`${ORIGIN}/f/a.woff2`, 'css'), rt(`${ORIGIN}/f/b.ttf?v=1`, 'other')]);
    expect(current.records.map((r) => r.entry.type)).toEqual(['font', 'font']);
  });

  it('same-origin closed port: RT entry with 0 plus element error → one network-error record, load-failed', () => {
    current = setup();
    const img = document.createElement('img');
    img.src = `${ORIGIN}/down.png`;
    document.body.appendChild(img);
    current.fake.emit([rt(`${ORIGIN}/down.png`, 'img', { responseStatus: 0, startTime: 5, encodedBodySize: 0 })]);
    img.dispatchEvent(new Event('error'));
    const out = current.hooks.adjust(current.records.map((r) => r.entry));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: null, statusUnavailable: 'network-error', error: 'load-failed' });
  });

  it('cross-origin resource → status null + cross-origin (AC-4.3)', () => {
    current = setup();
    current.fake.emit([rt('http://cdn.other.test/x.png', 'img', {
      responseStatus: 0, encodedBodySize: 0, decodedBodySize: 0, transferSize: 0,
    })]);
    const { entry } = current.records[0];
    expect(entry.status).toBeNull();
    expect(entry.statusUnavailable).toBe('cross-origin');
    expect(entry.sizeBytes).toBeNull();
  });

  it('browser without responseStatus → statusUnavailable unsupported-browser (PB-1 A, feature detection)', () => {
    current = setup({ supportsStatus: false, nav: { name: 'x' } });
    current.fake.emit([rt(`${ORIGIN}/a.png`, 'img', { responseStatus: undefined })]);
    expect(current.records[0].entry).toMatchObject({ status: null, statusUnavailable: 'unsupported-browser' });
    expect(current.hooks.documentStatus()).toEqual({ status: null, statusUnavailable: 'unsupported-browser' });
  });

  it('fetch RT entry not recorded but fills sizeBytes via adjust (AC-4.4)', () => {
    current = setup();
    current.fake.emit([
      rt(`${ORIGIN}/api/x`, 'fetch', { startTime: 50, encodedBodySize: 23 }),
      rt(`${ORIGIN}/api/y`, 'xmlhttprequest', { startTime: 60, encodedBodySize: 7 }),
    ]);
    expect(current.records).toHaveLength(0);
    const items = [
      { t: 49, type: 'fetch', url: `${ORIGIN}/api/x`, status: 500, durationMs: 3, sizeBytes: null, error: null },
      { t: 59, type: 'xhr', url: `${ORIGIN}/api/y`, status: 401, durationMs: 3, sizeBytes: null, error: null },
    ];
    const out = current.hooks.adjust(items);
    expect(out.map((e) => [e.status, e.sizeBytes])).toEqual([[500, 23], [401, 7]]);
    // input untouched (adjust works on copies)
    expect(items[0].sizeBytes).toBeNull();
    // a second snapshot correlates again (the ring keeps the entries)
    expect(current.hooks.adjust(items).map((e) => e.sizeBytes)).toEqual([23, 7]);
  });

  it('adjust takes pending observer records: resources are recorded, RT fetch feeds correlation', () => {
    current = setup();
    current.fake.queue([rt(`${ORIGIN}/late.png`, 'img'), rt(`${ORIGIN}/api/z`, 'fetch', { startTime: 70, encodedBodySize: 9 })]);
    const out = current.hooks.adjust([{ t: 69, type: 'fetch', url: `${ORIGIN}/api/z`, status: 200, durationMs: 1, sizeBytes: null }]);
    expect(current.records.map((r) => r.entry.url)).toEqual([`${ORIGIN}/late.png`]);
    expect(out.find((e) => e.type === 'fetch').sizeBytes).toBe(9);
    expect(out.find((e) => e.type === 'img')).toMatchObject({ url: `${ORIGIN}/late.png`, status: 200 });
    // already recorded: not appended again by the next adjust
    expect(current.hooks.adjust([]).filter((e) => e.type === 'img')).toHaveLength(0);
  });

  it('element error without RT entry → network-error record', () => {
    current = setup();
    const img = document.createElement('img');
    img.src = `${ORIGIN}/broken.png`;
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));
    const out = current.hooks.adjust([]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'img', url: `${ORIGIN}/broken.png`, status: null, statusUnavailable: 'network-error', error: 'load-failed',
    });
  });

  it('element error with RT entry marks the existing record load-failed', () => {
    current = setup();
    const script = document.createElement('script');
    script.src = `${ORIGIN}/js/missing.js`;
    document.body.appendChild(script);
    current.fake.emit([rt(`${ORIGIN}/js/missing.js`, 'script', { responseStatus: 404, startTime: 5 })]);
    script.dispatchEvent(new Event('error'));
    const out = current.hooks.adjust(current.records.map((r) => r.entry));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'script', status: 404, error: 'load-failed' });
  });

  it('stylesheet link error is a css load error; other link rels and plain elements are ignored', () => {
    current = setup();
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${ORIGIN}/missing.css`;
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.href = `${ORIGIN}/favicon.ico`;
    const div = document.createElement('div');
    document.body.append(css, icon, div);
    for (const el of [css, icon, div]) el.dispatchEvent(new Event('error'));
    const out = current.hooks.adjust([]);
    expect(out.map((e) => [e.type, e.url])).toEqual([['css', `${ORIGIN}/missing.css`]]);
  });

  it('load error ring is bounded', () => {
    current = setup();
    const img = document.createElement('img');
    document.body.appendChild(img);
    for (let i = 0; i < RESOURCE_LIMITS.loadErrors + 20; i++) {
      img.src = `${ORIGIN}/b${i}.png`;
      img.dispatchEvent(new Event('error'));
    }
    const out = current.hooks.adjust([]);
    expect(out).toHaveLength(RESOURCE_LIMITS.loadErrors);
    expect(out[out.length - 1].url).toBe(`${ORIGIN}/b${RESOURCE_LIMITS.loadErrors + 19}.png`);
  });

  it('RT correlation ring is bounded', () => {
    current = setup();
    const entries = [];
    for (let i = 0; i < RESOURCE_LIMITS.rtEntries + 10; i++) entries.push(rt(`${ORIGIN}/api/${i}`, 'fetch', { startTime: i }));
    current.fake.emit(entries);
    const out = current.hooks.adjust([
      { t: 0, type: 'fetch', url: `${ORIGIN}/api/0`, durationMs: 1, sizeBytes: null },
      { t: RESOURCE_LIMITS.rtEntries + 9, type: 'fetch', url: `${ORIGIN}/api/${RESOURCE_LIMITS.rtEntries + 9}`, durationMs: 1, sizeBytes: null },
    ]);
    expect(out.map((e) => e.sizeBytes)).toEqual([null, 100]);
  });

  it('documentStatus 500 (AC-4.2)', () => {
    current = setup({ nav: { responseStatus: 500 } });
    expect(current.hooks.documentStatus()).toEqual({ status: 500 });
  });

  it('documentStatus without navigation entry → null + unknown', () => {
    current = setup({ nav: null });
    expect(current.hooks.documentStatus()).toEqual({ status: null, statusUnavailable: 'unknown' });
  });

  it('enabled() false: no records, no load errors', () => {
    let on = false;
    current = setup(undefined, { enabled: () => on });
    current.fake.emit([rt(`${ORIGIN}/a.png`, 'img')]);
    const img = document.createElement('img');
    img.src = `${ORIGIN}/x.png`;
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));
    expect(current.records).toHaveLength(0);
    expect(current.hooks.adjust([])).toEqual([]);
    on = true;
    current.fake.emit([rt(`${ORIGIN}/a.png`, 'img')]);
    expect(current.records).toHaveLength(1);
  });

  it('recorder exception in record() never escapes the observer or the error listener', () => {
    current = setup(undefined, { record: () => { throw new Error('boom'); } });
    expect(() => current.fake.emit([rt(`${ORIGIN}/a.png`, 'img')])).not.toThrow();
    const img = document.createElement('img');
    document.body.appendChild(img);
    expect(() => img.dispatchEvent(new Event('error'))).not.toThrow();
  });

  it('page replacing URL after install does not change statuses nor break correlation', () => {
    current = setup();
    const savedUrl = globalThis.URL;
    try {
      globalThis.URL = function Evil() { throw new Error('evil'); };
      current.fake.emit([
        rt(`${ORIGIN}/api/x`, 'fetch', { startTime: 5, encodedBodySize: 3 }),
        rt(`${ORIGIN}/img/missing.png`, 'img', { responseStatus: 404 }),
      ]);
      const out = current.hooks.adjust([{ t: 5, type: 'fetch', url: `${ORIGIN}/api/x`, status: 500, durationMs: 1, sizeBytes: null }]);
      expect(out.find((e) => e.type === 'fetch')).toMatchObject({ status: 500, sizeBytes: 3 });
      expect(current.records[0].entry).toMatchObject({ type: 'img', status: 404 });
    } finally {
      globalThis.URL = savedUrl;
    }
  });

  it('missing PerformanceObserver: install still works, adjust passes items through', () => {
    const records = [];
    const hooks = installResourceHooks({
      win: window, doc: document, now: () => 1, record: (s, e) => records.push(e),
      intrinsics: { PerformanceObserver: null, PerformanceResourceTiming: null, performance: null },
    });
    try {
      const items = [{ t: 1, type: 'fetch', url: 'x', durationMs: 1, sizeBytes: null }];
      expect(hooks.adjust(items)).toEqual(items);
      expect(hooks.documentStatus()).toEqual({ status: null, statusUnavailable: 'unsupported-browser' });
    } finally {
      hooks.restore();
    }
  });

  it('double install on the same window is a no-op', () => {
    current = setup();
    const second = installResourceHooks(current.ctx);
    expect(current.fake.observers).toHaveLength(1);
    current.fake.emit([rt(`${ORIGIN}/a.png`, 'img')]);
    expect(current.records).toHaveLength(1);
    second.restore();
    current.fake.emit([rt(`${ORIGIN}/b.png`, 'img')]);
    expect(current.records).toHaveLength(2);
  });

  it('restore disconnects observer and removes listener', () => {
    current = setup();
    const { hooks, fake } = current;
    hooks.restore();
    expect(fake.observers[0].connected).toBe(false);
    const img = document.createElement('img');
    img.src = `${ORIGIN}/x.png`;
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));
    expect(hooks.adjust([])).toEqual([]);
    // a new install after restore works
    current = setup();
    current.fake.emit([rt(`${ORIGIN}/a.png`, 'img')]);
    expect(current.records).toHaveLength(1);
  });
});

describe('runtime error listener (hooks-errors) does not see resource errors (regression)', () => {
  let restoreErrors;
  let current;
  beforeEach(() => {
    current = null;
  });
  afterEach(() => {
    if (restoreErrors) restoreErrors();
    if (current) current.hooks.restore();
    document.body.innerHTML = '';
  });

  it('img error is a load error only, not a runtimeErrors entry', () => {
    const runtime = [];
    restoreErrors = installErrorHooks({ win: window, now: () => 1, record: (s, e) => runtime.push({ s, e }), json: (v) => v });
    current = setup();
    const img = document.createElement('img');
    img.src = `${ORIGIN}/broken.png`;
    document.body.appendChild(img);
    img.dispatchEvent(new Event('error'));
    expect(runtime).toHaveLength(0);
    expect(current.hooks.adjust([])).toHaveLength(1);
  });
});
