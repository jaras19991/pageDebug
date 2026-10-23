// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installVitals, VITALS_CLS_SOURCES_MAX } from '../../src/page/vitals.js';
import { createSelectorOf, captureSelectorIntrinsics } from '../../src/page/selector.js';
import { createFakePerformance, FIREFOX_ENTRY_TYPES, ALL_ENTRY_TYPES } from './helpers/fake-performance.js';

// E2-T1b (D1, AC-5.1–5.6, AC-5.8): PerformanceObserver-based metrics with attribution.

const { window, document } = globalThis;

let fake;
let vitals;
let visibility;
let clock;

function install({ fakeOptions = {}, accept, options, hidden = false } = {}) {
  fake = createFakePerformance(fakeOptions);
  visibility = hidden ? 'hidden' : 'visible';
  clock = 5000;
  const intrinsics = { ...captureSelectorIntrinsics(window), getVisibilityState: () => visibility };
  vitals = installVitals({
    win: fake.win,
    doc: document,
    now: () => clock,
    selectorOf: createSelectorOf({ doc: document, intrinsics }),
    intrinsics,
    accept,
    options,
  });
  return vitals;
}

const click = (id, { interactionId = 1, startTime = 2000, duration = 336, delay = 2, processing = 304, name = 'click' } = {}) => ({
  name,
  interactionId,
  startTime,
  duration,
  processingStart: startTime + delay,
  processingEnd: startTime + delay + processing,
  target: id ? document.getElementById(id) : null,
});

beforeEach(() => {
  document.body.innerHTML = `
    <main><p>pierwszy</p><p>drugi</p></main>
    <img id="hero" src="/img/hero.png">
    <button id="slow">Wolny</button>
    <div data-testid="banner">baner</div>
  `;
});

afterEach(() => {
  if (vitals) vitals.restore();
  vitals = null;
  document.body.innerHTML = '';
});

describe('installVitals', () => {
  it('observes every supported type with buffered: true (event with durationThreshold 16)', () => {
    install();
    const observed = fake.observers.flatMap((o) => o.options);
    const byType = Object.fromEntries(observed.map((o) => [o.type, o]));
    for (const type of ['paint', 'largest-contentful-paint', 'layout-shift', 'event', 'first-input', 'long-animation-frame']) {
      expect(byType[type], type).toMatchObject({ type, buffered: true });
    }
    expect(byType.event.durationThreshold).toBe(16);
  });

  it('TTFB, FCP, LCP, CLS present with value and rating', () => {
    install();
    fake.emit('paint', [{ name: 'first-paint', startTime: 700 }, { name: 'first-contentful-paint', startTime: 820 }]);
    fake.emit('largest-contentful-paint', [{ startTime: 1712, element: document.getElementById('hero'), url: 'http://x/img/hero.png' }]);
    fake.emit('layout-shift', [{ startTime: 560, value: 0.183, hadRecentInput: false, sources: [] }]);
    const snap = vitals.snapshot();
    expect(snap.TTFB).toEqual({ available: true, value: 47, rating: 'good', t: 47, finalized: true });
    expect(snap.FCP).toEqual({ available: true, value: 820, rating: 'good', t: 820, finalized: true });
    expect(snap.LCP).toMatchObject({ available: true, value: 1712, rating: 'good', t: 1712, finalized: false });
    expect(snap.CLS).toMatchObject({ available: true, value: 0.183, rating: 'needs-improvement', t: 560, finalized: false });
    for (const name of ['TTFB', 'FCP', 'LCP', 'CLS']) expect(['good', 'needs-improvement', 'poor']).toContain(snap[name].rating);
  });

  it('values are relative to activationStart (prerender) and t to timeOrigin', () => {
    install({ fakeOptions: { navigation: { responseStart: 300, activationStart: 200 } } });
    fake.emit('paint', [{ name: 'first-contentful-paint', startTime: 900 }]);
    const snap = vitals.snapshot();
    expect(snap.TTFB).toMatchObject({ value: 100, t: 300 });
    expect(snap.FCP).toMatchObject({ value: 700, t: 900 });
  });

  it('buffered entries are read through takeRecords at snapshot', () => {
    fake = null;
    const pre = createFakePerformance();
    pre.buffer('paint', [{ name: 'first-contentful-paint', startTime: 400 }]);
    const intrinsics = { ...captureSelectorIntrinsics(window), getVisibilityState: () => 'visible' };
    vitals = installVitals({
      win: pre.win,
      doc: document,
      now: () => 1,
      selectorOf: createSelectorOf({ doc: document, intrinsics }),
      intrinsics,
    });
    pre.queue('largest-contentful-paint', [{ startTime: 1500, element: null, url: '' }]);
    const snap = vitals.snapshot();
    expect(snap.FCP.value).toBe(400);
    expect(snap.LCP).toEqual({ available: true, value: 1500, rating: 'good', t: 1500, finalized: false });
  });

  it('LCP uses the last entry and reports selector and url', () => {
    install();
    fake.emit('largest-contentful-paint', [{ startTime: 600, element: document.querySelector('main > p'), url: '' }]);
    fake.emit('largest-contentful-paint', [{ startTime: 1712, element: document.getElementById('hero'), url: 'http://x/img/hero.png' }]);
    const { LCP } = vitals.snapshot();
    expect(LCP).toMatchObject({ value: 1712, selector: '#hero', url: 'http://x/img/hero.png' });
  });

  it('LCP url is capped', () => {
    install();
    fake.emit('largest-contentful-paint', [{ startTime: 100, element: null, url: 'http://x/' + 'a'.repeat(9000) }]);
    expect(vitals.snapshot().LCP.url).toHaveLength(4000);
  });

  it('CLS sources carry selector and shift value', () => {
    install();
    const banner = document.querySelector('[data-testid="banner"]');
    const p = document.querySelector('main > p');
    fake.emit('layout-shift', [
      { startTime: 560, value: 0.15, hadRecentInput: false, sources: [{ node: p }, { node: banner }] },
      { startTime: 700, value: 0.04, hadRecentInput: false, sources: [{ node: banner }] },
      { startTime: 800, value: 0.0004, hadRecentInput: false, sources: [{ node: p }] },
    ]);
    const { CLS } = vitals.snapshot();
    expect(CLS.value).toBe(0.19);
    expect(CLS.sources[0]).toEqual({ selector: 'html > body > main > p:nth-of-type(1)', value: 0.15, t: 560 });
    expect(CLS.sources).toContainEqual({ selector: 'div[data-testid="banner"]', value: 0.04, t: 700 });
    expect(CLS.sources.length).toBeLessThanOrEqual(VITALS_CLS_SOURCES_MAX);
    expect(CLS.sources.some((s) => s.t === 800)).toBe(false);
  });

  it('CLS sources are capped at 5 and ignore shifts with recent input', () => {
    install();
    const p = document.querySelector('main > p');
    const shifts = Array.from({ length: 12 }, (_, i) => ({ startTime: 100 + i * 10, value: 0.01, hadRecentInput: false, sources: [{ node: p }] }));
    shifts.push({ startTime: 300, value: 5, hadRecentInput: true, sources: [{ node: p }] });
    fake.emit('layout-shift', shifts);
    const { CLS } = vitals.snapshot();
    expect(CLS.value).toBe(0.12);
    expect(CLS.sources).toHaveLength(5);
  });

  it('many layout shifts stay bounded and keep the largest window', () => {
    install();
    // One big window early, then 2000 tiny shifts in separate windows.
    fake.emit('layout-shift', [
      { startTime: 100, value: 0.2, hadRecentInput: false, sources: [] },
      { startTime: 200, value: 0.1, hadRecentInput: false, sources: [] },
    ]);
    const tiny = Array.from({ length: 2000 }, (_, i) => ({ startTime: 10000 + i * 1500, value: 0.01, hadRecentInput: false, sources: [] }));
    fake.emit('layout-shift', tiny);
    expect(vitals.snapshot().CLS.value).toBe(0.3);
  });

  it('INP carries target selector, event type and three phases', () => {
    install();
    fake.emit('event', [click('slow'), { ...click('slow'), name: 'pointerdown', duration: 100 }, { ...click(null), interactionId: 0, duration: 900 }]);
    const { INP } = vitals.snapshot();
    expect(INP).toEqual({
      available: true,
      value: 336,
      rating: 'needs-improvement',
      t: 2000,
      finalized: false,
      selector: '#slow',
      eventType: 'click',
      inputDelay: 2,
      processing: 304,
      presentation: 30,
      interactions: 1,
    });
    expect(INP.inputDelay + INP.processing + INP.presentation).toBe(INP.value);
  });

  it('first-input entries count as interactions', () => {
    install();
    fake.emit('first-input', [click('slow', { interactionId: 7, duration: 40, name: 'pointerdown' })]);
    expect(vitals.snapshot().INP).toMatchObject({ value: 40, eventType: 'pointerdown', interactions: 1 });
  });

  it('INP over 120 interactions takes ~p98 and stays bounded', () => {
    install();
    const events = Array.from({ length: 1200 }, (_, i) => click('slow', { interactionId: i + 1, startTime: 100 + i, duration: 20 + i }));
    fake.emit('event', events);
    const { INP } = vitals.snapshot();
    // 1200 interactions → candidate index min(9, 24) = 9 → 10th longest.
    expect(INP.value).toBe(20 + 1199 - 9);
    expect(INP.interactions).toBe(1200);
  });

  it('browser without layout-shift/event/LoAF → available:false reason unsupported-browser, keys present', () => {
    install({ fakeOptions: { types: ['navigation', 'paint', 'largest-contentful-paint'] } });
    fake.emit('paint', [{ name: 'first-contentful-paint', startTime: 820 }]);
    const snap = vitals.snapshot({ final: true });
    expect(Object.keys(snap)).toEqual(['TTFB', 'FCP', 'LCP', 'CLS', 'INP', 'longTasks']);
    expect(snap.TTFB.available).toBe(true);
    expect(snap.FCP.available).toBe(true);
    for (const name of ['CLS', 'INP', 'longTasks']) expect(snap[name]).toEqual({ available: false, reason: 'unsupported-browser' });
  });

  it('Firefox-like: event without interactionId → INP unsupported-browser', () => {
    install({ fakeOptions: { types: FIREFOX_ENTRY_TYPES, interactionId: false } });
    fake.emit('event', [click('slow')]);
    const snap = vitals.snapshot();
    expect(snap.INP).toEqual({ available: false, reason: 'unsupported-browser' });
    expect(snap.CLS).toEqual({ available: false, reason: 'unsupported-browser' });
  });

  it('no PerformanceObserver at all → paint metrics unsupported, TTFB from navigation', () => {
    install({ fakeOptions: { withObserver: false } });
    const snap = vitals.snapshot();
    expect(snap.TTFB.value).toBe(47);
    for (const name of ['FCP', 'LCP', 'CLS', 'INP', 'longTasks']) expect(snap[name]).toEqual({ available: false, reason: 'unsupported-browser' });
  });

  it('no navigation entry → TTFB no-data', () => {
    install({ fakeOptions: { navigation: null } });
    expect(vitals.snapshot().TTFB).toEqual({ available: false, reason: 'no-data' });
  });

  it('no LoAF (Chrome 121–122) → longTasks unsupported-browser', () => {
    install({ fakeOptions: { types: ALL_ENTRY_TYPES.filter((t) => t !== 'long-animation-frame') } });
    const snap = vitals.snapshot();
    expect(snap.longTasks).toEqual({ available: false, reason: 'unsupported-browser' });
    expect(snap.CLS.available).toBe(true);
  });

  it('long tasks: top 20 by blockingDuration with script url and function', () => {
    install();
    const loafs = Array.from({ length: 50 }, (_, i) => ({
      startTime: 100 + i,
      duration: 60 + i,
      blockingDuration: 10 + i,
      scripts: [{ sourceURL: 'http://x/heavy.js', sourceFunctionName: 'heavyWork', invoker: 'TimerHandler:setTimeout', duration: 50 + i }],
    }));
    fake.emit('long-animation-frame', loafs.slice(0, 25));
    fake.emit('long-animation-frame', loafs.slice(25));
    const { longTasks } = vitals.snapshot();
    expect(longTasks.available).toBe(true);
    expect(longTasks.items).toHaveLength(20);
    expect(longTasks.items[0]).toEqual({
      t: 149,
      duration: 109,
      blockingDuration: 59,
      scripts: [{ url: 'http://x/heavy.js', function: 'heavyWork', invoker: 'TimerHandler:setTimeout', duration: 99 }],
    });
  });

  it('LoAF supported but none seen → longTasks available with no items', () => {
    install();
    expect(vitals.snapshot().longTasks).toEqual({ available: true, items: [] });
  });

  it('no interaction → INP no-interaction', () => {
    install();
    expect(vitals.snapshot().INP).toEqual({ available: false, reason: 'no-interaction' });
  });

  it('visible at snapshot → finalized:false; final → true', () => {
    install();
    fake.emit('largest-contentful-paint', [{ startTime: 1000, element: null, url: '' }]);
    fake.emit('layout-shift', [{ startTime: 500, value: 0.05, hadRecentInput: false, sources: [] }]);
    fake.emit('event', [click('slow')]);
    fake.emit('paint', [{ name: 'first-contentful-paint', startTime: 400 }]);
    const open = vitals.snapshot();
    for (const name of ['LCP', 'CLS', 'INP']) expect(open[name].finalized, name).toBe(false);
    expect(open.TTFB.finalized).toBe(true);
    expect(open.FCP.finalized).toBe(true);
    const final = vitals.snapshot({ final: true });
    for (const name of ['LCP', 'CLS', 'INP', 'TTFB', 'FCP']) expect(final[name].finalized, name).toBe(true);
  });

  it('hidden at start → LCP/FCP hidden-at-start', () => {
    install({ hidden: true });
    fake.emit('paint', [{ name: 'first-contentful-paint', startTime: 400 }]);
    fake.emit('largest-contentful-paint', [{ startTime: 1000, element: null, url: '' }]);
    const snap = vitals.snapshot();
    expect(snap.FCP).toEqual({ available: false, reason: 'hidden-at-start' });
    expect(snap.LCP).toEqual({ available: false, reason: 'hidden-at-start' });
    expect(snap.TTFB.available).toBe(true);
  });

  it('prerendered page (hidden while prerendering) is not hidden-at-start (web-vitals)', () => {
    fake = createFakePerformance({});
    visibility = 'hidden';
    const intrinsics = { ...captureSelectorIntrinsics(window), getVisibilityState: () => visibility, getPrerendering: () => true };
    vitals = installVitals({ win: fake.win, doc: document, now: () => 5000, selectorOf: () => null, intrinsics });
    fake.emit('paint', [{ name: 'first-contentful-paint', startTime: 400 }]);
    fake.emit('largest-contentful-paint', [{ startTime: 1000, element: null, url: '' }]);
    const snap = vitals.snapshot();
    expect(snap.FCP.available).toBe(true);
    expect(snap.LCP.available).toBe(true);
  });

  it('prerendering getter is captured from Document.prototype (feature detection; absent → not prerendering)', async () => {
    const { captureVitalsIntrinsics } = await import('../../src/page/vitals.js');
    const proto = window.Document.prototype;
    const had = Object.getOwnPropertyDescriptor(proto, 'prerendering');
    expect(captureVitalsIntrinsics(window).getPrerendering).toBe(had ? had.get : undefined);
    const get = () => true;
    Object.defineProperty(proto, 'prerendering', { get, configurable: true });
    try {
      expect(captureVitalsIntrinsics(window).getPrerendering).toBe(get);
    } finally {
      if (had) Object.defineProperty(proto, 'prerendering', had);
      else delete proto.prerendering;
    }
  });

  it('LCP/FCP entries after the page was hidden are ignored; none before → no-data', () => {
    install();
    clock = 300;
    visibility = 'hidden';
    document.dispatchEvent(new window.Event('visibilitychange'));
    fake.emit('paint', [{ name: 'first-contentful-paint', startTime: 400 }]);
    fake.emit('largest-contentful-paint', [{ startTime: 250, element: null, url: '' }, { startTime: 1000, element: null, url: '' }]);
    const snap = vitals.snapshot();
    expect(snap.FCP).toEqual({ available: false, reason: 'no-data' });
    expect(snap.LCP.value).toBe(250);
  });

  it('interactionsSince filters earlier interactions', () => {
    install({ options: { interactionsSince: 3000 } });
    fake.emit('event', [click('slow', { interactionId: 1, startTime: 2000, duration: 400 })]);
    expect(vitals.snapshot().INP).toEqual({ available: false, reason: 'no-interaction' });
    fake.emit('event', [click('slow', { interactionId: 2, startTime: 3500, duration: 120 })]);
    expect(vitals.snapshot().INP).toMatchObject({ value: 120, t: 3500, interactions: 1 });
  });

  it('entries past deadline rejected', () => {
    install({ accept: (t) => t < 1000 });
    fake.emit('paint', [{ name: 'first-contentful-paint', startTime: 400 }]);
    fake.emit('largest-contentful-paint', [{ startTime: 800, element: null, url: '' }, { startTime: 1200, element: null, url: '' }]);
    fake.emit('layout-shift', [
      { startTime: 900, value: 0.05, hadRecentInput: false, sources: [] },
      { startTime: 1100, value: 0.5, hadRecentInput: false, sources: [] },
    ]);
    fake.emit('event', [click('slow', { startTime: 1500 })]);
    fake.emit('long-animation-frame', [{ startTime: 1300, duration: 300, blockingDuration: 250, scripts: [] }]);
    const snap = vitals.snapshot();
    expect(snap.FCP.value).toBe(400);
    expect(snap.LCP.value).toBe(800);
    expect(snap.CLS.value).toBe(0.05);
    expect(snap.INP).toEqual({ available: false, reason: 'no-interaction' });
    expect(snap.longTasks.items).toEqual([]);
  });

  it('restore disconnects all observers', () => {
    install();
    fake.emit('paint', [{ name: 'first-contentful-paint', startTime: 400 }]);
    expect(fake.observers.length).toBeGreaterThanOrEqual(6);
    vitals.restore();
    for (const o of fake.observers) expect(o.disconnected).toBe(true);
    // Frozen after restore: snapshot still answers with what was collected.
    fake.emit('largest-contentful-paint', [{ startTime: 1000, element: null, url: '' }]);
    const snap = vitals.snapshot();
    expect(snap.FCP.value).toBe(400);
    expect(snap.LCP).toEqual({ available: false, reason: 'no-data' });
    vitals.restore();
  });

  it('restore removes the visibilitychange listener', () => {
    install();
    vitals.restore();
    visibility = 'hidden';
    clock = 100;
    document.dispatchEvent(new window.Event('visibilitychange'));
    expect(vitals.snapshot().FCP.reason).toBe('no-data');
  });

  it('observer failures and selector failures are swallowed', () => {
    fake = createFakePerformance();
    fake.win.PerformanceObserver.prototype.observe = () => {
      throw new Error('observe');
    };
    vitals = installVitals({
      win: fake.win,
      doc: document,
      now: () => 1,
      selectorOf: () => {
        throw new Error('sel');
      },
      intrinsics: { getVisibilityState: () => 'visible' },
    });
    expect(() => vitals.snapshot()).not.toThrow();
    expect(vitals.snapshot().TTFB.value).toBe(47);
  });

  it('page patching PerformanceObserver.prototype after install does not break snapshot', () => {
    install();
    fake.emit('paint', [{ name: 'first-contentful-paint', startTime: 400 }]);
    fake.win.PerformanceObserver.prototype.takeRecords = () => {
      throw new Error('patched');
    };
    expect(vitals.snapshot().FCP.value).toBe(400);
  });
});
