import { describe, it, expect } from 'vitest';
import {
  THRESHOLDS, rate, clsFromShifts, inpFromEvents, inpPhases, topLongTasks, unavailable, LONG_TASKS_MAX,
} from '../../src/page/vitals-math.js';

// E2-T1a (D1): pure metric math, checked with vectors from the web.dev definitions.

const shift = (startTime, value, hadRecentInput = false) => ({ entryType: 'layout-shift', startTime, value, hadRecentInput });
const event = (interactionId, duration, extra = {}) => ({
  entryType: 'event', name: 'click', interactionId, duration, startTime: 0, processingStart: 0, processingEnd: 0, ...extra,
});

describe('rate', () => {
  it('rating boundaries for each metric (value at threshold is good/needs-improvement as in web.dev)', () => {
    expect(THRESHOLDS).toEqual({
      LCP: [2500, 4000], CLS: [0.1, 0.25], INP: [200, 500], FCP: [1800, 3000], TTFB: [800, 1800],
    });
    for (const [name, [good, poor]] of Object.entries(THRESHOLDS)) {
      const step = name === 'CLS' ? 0.001 : 1;
      expect(rate(name, 0), name).toBe('good');
      expect(rate(name, good), name).toBe('good');
      expect(rate(name, good + step), name).toBe('needs-improvement');
      expect(rate(name, poor), name).toBe('needs-improvement');
      expect(rate(name, poor + step), name).toBe('poor');
    }
  });

  it('unknown metric or non-numeric value has no rating', () => {
    expect(rate('FID', 10)).toBeNull();
    expect(rate('LCP', null)).toBeNull();
    expect(rate('LCP', Number.NaN)).toBeNull();
  });
});

describe('clsFromShifts', () => {
  it('CLS takes the largest session window, not the sum', () => {
    const entries = [shift(100, 0.05), shift(300, 0.05), shift(3000, 0.08), shift(3500, 0.07)];
    const out = clsFromShifts(entries);
    expect(out.value).toBe(0.15);
    expect(out.windowEntries.map((e) => e.startTime)).toEqual([3000, 3500]);
    expect(out.t).toBe(3500);
  });

  it('CLS ignores hadRecentInput', () => {
    const out = clsFromShifts([shift(100, 0.5, true), shift(200, 0.02)]);
    expect(out.value).toBe(0.02);
    expect(out.windowEntries).toHaveLength(1);
  });

  it('CLS window closes after 1 s gap and at 5 s', () => {
    // gap of exactly 1000 ms starts a new window
    expect(clsFromShifts([shift(0, 0.1), shift(1000, 0.1)]).value).toBe(0.1);
    expect(clsFromShifts([shift(0, 0.1), shift(999, 0.1)]).value).toBe(0.2);
    // shifts every 900 ms: the window is cut once it would span 5 s
    const steady = Array.from({ length: 10 }, (_, i) => shift(i * 900, 0.01));
    const out = clsFromShifts(steady);
    expect(out.windowEntries.map((e) => e.startTime)).toEqual([0, 900, 1800, 2700, 3600, 4500]);
    expect(out.value).toBe(0.06);
  });

  it('CLS value rounded to 3 places; no shifts gives 0', () => {
    expect(clsFromShifts([shift(0, 0.12345), shift(10, 0.0001)]).value).toBe(0.124);
    expect(clsFromShifts([])).toEqual({ value: 0, t: null, windowEntries: [] });
  });

  it('CLS accepts unsorted entries', () => {
    expect(clsFromShifts([shift(3500, 0.07), shift(100, 0.05), shift(3000, 0.08)]).value).toBe(0.15);
  });
});

describe('inpFromEvents', () => {
  it('INP with 1 interaction equals its duration', () => {
    const e = event(7, 336);
    expect(inpFromEvents([e])).toEqual({ value: 336, entry: e, count: 1 });
  });

  it('interaction duration is the longest entry of the group', () => {
    const down = event(3, 120, { name: 'pointerdown' });
    const click = event(3, 180);
    const out = inpFromEvents([down, click, event(4, 40)]);
    expect(out).toEqual({ value: 180, entry: click, count: 2 });
  });

  it('INP with 120 interactions takes ~p98', () => {
    const entries = Array.from({ length: 120 }, (_, i) => event(i + 1, (i + 1) * 10));
    const out = inpFromEvents(entries);
    expect(out.count).toBe(120);
    // floor(120 / 50) = 2 → third longest
    expect(out.value).toBe(1180);
    const fewer = inpFromEvents(entries.slice(0, 49));
    expect(fewer.value).toBe(490);
  });

  it('events without interactionId ignored', () => {
    expect(inpFromEvents([event(0, 500), event(undefined, 600)])).toBeNull();
    expect(inpFromEvents([event(0, 500), event(9, 30)])).toMatchObject({ value: 30, count: 1 });
    expect(inpFromEvents([])).toBeNull();
  });
});

describe('inpPhases', () => {
  it('INP phases sum to duration', () => {
    const e = event(1, 336, { startTime: 1000, processingStart: 1002, processingEnd: 1306 });
    const phases = inpPhases(e);
    expect(phases).toEqual({ inputDelay: 2, processing: 304, presentation: 30 });
    expect(phases.inputDelay + phases.processing + phases.presentation).toBe(e.duration);
  });

  it('negative phases are clamped to 0', () => {
    const e = event(1, 8, { startTime: 1000, processingStart: 999, processingEnd: 1010 });
    expect(inpPhases(e)).toEqual({ inputDelay: 0, processing: 11, presentation: 0 });
  });
});

describe('topLongTasks', () => {
  const loaf = (startTime, blockingDuration, scripts = []) => ({
    entryType: 'long-animation-frame', startTime, duration: blockingDuration + 50, blockingDuration, scripts,
  });

  it('top 20 long tasks by blockingDuration with script url and function', () => {
    const loafs = Array.from({ length: 30 }, (_, i) =>
      loaf(i * 100, i * 10, [{ sourceURL: `http://x/s${i}.js`, sourceFunctionName: `fn${i}`, invoker: `TimerHandler:setTimeout`, duration: i * 9 }]));
    const out = topLongTasks(loafs, LONG_TASKS_MAX);
    expect(LONG_TASKS_MAX).toBe(20);
    expect(out).toHaveLength(20);
    expect(out.map((t) => t.blockingDuration)).toEqual(Array.from({ length: 20 }, (_, i) => (29 - i) * 10));
    expect(out[0]).toEqual({
      t: 2900, duration: 340, blockingDuration: 290,
      scripts: [{ url: 'http://x/s29.js', function: 'fn29', invoker: 'TimerHandler:setTimeout', duration: 261 }],
    });
  });

  it('defaults to 20, caps scripts per task and long strings', () => {
    const scripts = Array.from({ length: 30 }, () => ({ sourceURL: 'u'.repeat(9000), sourceFunctionName: 'f'.repeat(9000), invoker: 'i'.repeat(9000), duration: 1 }));
    const out = topLongTasks([loaf(0, 100, scripts), loaf(1, 50)]);
    expect(out).toHaveLength(2);
    expect(out[0].scripts.length).toBeLessThanOrEqual(10);
    expect(out[0].scripts[0].url.length).toBeLessThanOrEqual(4000);
    expect(out[0].scripts[0].function.length).toBeLessThanOrEqual(500);
    expect(out[0].scripts[0].invoker.length).toBeLessThanOrEqual(500);
    expect(out[1].scripts).toEqual([]);
    expect(topLongTasks([])).toEqual([]);
  });
});

describe('unavailable', () => {
  it('unavailable(reason) has available false and the reason', () => {
    expect(unavailable('unsupported-browser')).toEqual({ available: false, reason: 'unsupported-browser' });
  });
});
