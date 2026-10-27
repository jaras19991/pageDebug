import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  METRIC_NAMES,
  RATING_PL,
  REASON_PL,
  vitalsByDoc,
  slowestResources,
  cookieInfo,
  lastVitals,
} from '../../src/lib/snapshot-metrics.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/snapshots/${name}.json`, import.meta.url), 'utf8'));
const v4 = () => fixture('v4');

function median(fn, runs = 5) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

describe('vitalsByDoc (AC-3.5)', () => {
  it('v4.json: doc 0 CLS/INP unavailable with reason, doc 1 LCP poor 4300', () => {
    const { docs, more } = vitalsByDoc(v4());
    expect(more).toBe(0);
    expect(docs.map((d) => [d.doc, d.url])).toEqual([[0, 'http://127.0.0.1:8080/form.html'], [1, 'http://127.0.0.1:8080/result.html']]);
    expect(Object.keys(docs[0].metrics)).toEqual(METRIC_NAMES);
    expect(METRIC_NAMES).toEqual(['TTFB', 'FCP', 'LCP', 'CLS', 'INP']);
    expect(docs[0].metrics.CLS).toEqual({ available: false, reason: 'unsupported-browser' });
    expect(docs[0].metrics.INP).toEqual({ available: false, reason: 'unsupported-browser' });
    expect(docs[0].metrics.TTFB).toMatchObject({ available: true, value: 47, rating: 'good' });
    expect(docs[1].metrics.LCP).toMatchObject({ available: true, value: 4300, rating: 'poor' });
    // Attribution stays reachable for the viewer.
    expect(docs[1].metrics.LCP.entry.selector).toBe('#hero');
    expect(docs[1].metrics.CLS).toMatchObject({ available: true, value: 0.183, rating: 'needs-improvement' });
    expect(docs[1].longTasks).toMatchObject({ available: true });
    expect(RATING_PL[docs[1].metrics.LCP.rating]).toBe('słabo');
    expect(REASON_PL[docs[0].metrics.CLS.reason]).toBe('przeglądarka tego nie mierzy');
  });

  it('missing value is unavailable, never 0', () => {
    const s = {
      documents: [{ id: 0, url: 'http://a/' }],
      vitals: [{ doc: 0, TTFB: { available: true, value: null, rating: 'good' }, FCP: { available: true, value: 'x' }, LCP: { available: true },
        CLS: { available: false }, INP: { available: false, reason: 'no-interaction', value: 0 } }],
    };
    const m = vitalsByDoc(s).docs[0].metrics;
    expect(m.TTFB).toEqual({ available: false, reason: 'unknown' });
    expect(m.FCP).toEqual({ available: false, reason: 'unknown' });
    expect(m.LCP).toEqual({ available: false, reason: 'unknown' });
    expect(m.CLS).toEqual({ available: false, reason: 'unknown' });
    expect(m.INP).toEqual({ available: false, reason: 'no-interaction' });
    for (const name of METRIC_NAMES) expect(m[name].value).toBeUndefined();
    // Metric absent entirely, NaN/Infinity values, unknown rating.
    const s2 = { vitals: [{ doc: 4, LCP: { available: true, value: Infinity }, CLS: { available: true, value: 0.05, rating: 'meh' } }] };
    const d = vitalsByDoc(JSON.parse(JSON.stringify(s2))).docs[0];
    expect(d).toMatchObject({ doc: 4, url: null });
    expect(d.metrics.TTFB).toEqual({ available: false, reason: 'unknown' });
    expect(d.metrics.LCP).toEqual({ available: false, reason: 'unknown' });
    expect(d.metrics.CLS).toMatchObject({ available: true, value: 0.05, rating: null });
    // A real 0 that the page measured stays a value (CLS 0 is "good"), only missing data never turns into 0.
    expect(vitalsByDoc({ vitals: [{ doc: 0, CLS: { available: true, value: 0, rating: 'good' } }] }).docs[0].metrics.CLS).toMatchObject({ available: true, value: 0 });
  });

  it('Polish texts for ratings and reasons', () => {
    expect(RATING_PL).toEqual({ good: 'dobrze', 'needs-improvement': 'do poprawy', poor: 'słabo' });
    expect(REASON_PL['unsupported-browser']).toBe('przeglądarka tego nie mierzy');
    expect(REASON_PL['no-interaction']).toBe('brak interakcji');
    expect(REASON_PL.unknown).toBe('nieznany powód');
    expect(typeof REASON_PL['cross-origin']).toBe('string');
    expect(typeof REASON_PL['hidden-at-start']).toBe('string');
    expect(typeof REASON_PL['no-data']).toBe('string');
    expect(Object.isFrozen(RATING_PL) && Object.isFrozen(REASON_PL)).toBe(true);
  });

  it('only last 5 documents + more', () => {
    const s = { documents: [], vitals: [] };
    for (let i = 0; i < 8; i++) {
      s.documents.push({ id: i, url: `http://h/${i}` });
      s.vitals.push({ doc: i, TTFB: { available: true, value: 10 + i, rating: 'good' } });
    }
    const res = vitalsByDoc(s);
    expect(res.docs.map((d) => d.doc)).toEqual([3, 4, 5, 6, 7]);
    expect(res.more).toBe(3);
    expect(vitalsByDoc(s, { last: Infinity }).docs).toHaveLength(8);
    expect(vitalsByDoc(s, { last: 2 })).toMatchObject({ more: 6 });
    expect(vitalsByDoc({})).toEqual({ docs: [], more: 0 });
    expect(vitalsByDoc(fixture('v2'))).toEqual({ docs: [], more: 0 });
    expect(vitalsByDoc({ vitals: [null, 3, { doc: 0 }] }).docs).toHaveLength(1);
  });
});

describe('slowestResources (AC-3.6)', () => {
  it('slowest 5 by durationMs with type and sizeBytes; ties stable; 5000 entries ≤ 20 ms', () => {
    const real = slowestResources(v4());
    expect(real.map((r) => r.durationMs)).toEqual([3.21, 2.4, 2.4, 2.4, 2.4]);
    expect(real[0]).toMatchObject({ durationMs: 3.21, type: 'fetch', sizeBytes: 23, url: 'http://127.0.0.1:8080/api/fail', index: 2 });
    // Ties keep array order.
    expect(real.slice(1).map((r) => r.index)).toEqual([0, 1, 3, 4]);
    expect(real[2].sizeBytes).toBeNull();

    const network = [];
    for (let i = 0; i < 5000; i++) network.push({ t: i, doc: 0, type: i % 2 ? 'img' : 'script', url: `http://h/${i}`, durationMs: (i * 7919) % 1000, sizeBytes: i });
    network.push({ durationMs: 'slow' }, { durationMs: NaN }, null, { durationMs: null });
    const s = { network };
    const top = slowestResources(s);
    const expected = network.filter((e) => Number.isFinite(e?.durationMs)).map((e, i) => ({ e, i }))
      .sort((a, b) => b.e.durationMs - a.e.durationMs || a.i - b.i).slice(0, 5).map(({ e }) => e.url);
    expect(top.map((r) => r.url)).toEqual(expected);
    expect(top).toHaveLength(5);
    expect(slowestResources(s, 2)).toHaveLength(2);
    expect(slowestResources(s, 0)).toEqual([]);
    expect(slowestResources({})).toEqual([]);
    slowestResources(s);
    expect(median(() => slowestResources(s))).toBeLessThanOrEqual(20);
  });
});

describe('cookieInfo (AC-3.6)', () => {
  it('cookieInfo count, cookiesTotalBytes, only true truncated flags', () => {
    const s = v4();
    expect(cookieInfo(s)).toEqual({ count: 3, totalBytes: 45, truncatedKeys: [] });
    s.truncated.consoleLogs = true;
    s.truncated.network = true;
    s.truncated.html = 'yes';
    s.truncated.steps = 1;
    expect(cookieInfo(s).truncatedKeys).toEqual(['consoleLogs', 'network']);
    expect(cookieInfo({})).toEqual({ count: 0, totalBytes: null, truncatedKeys: [] });
    expect(cookieInfo({ storage: { cookies: 'a=1', cookiesTotalBytes: 'x' }, truncated: [true] })).toEqual({ count: 0, totalBytes: null, truncatedKeys: [] });
    expect(() => cookieInfo(fixture('v2'))).not.toThrow();
  });
});

describe('lastVitals (for diff)', () => {
  it('per metric the last available value with rating', () => {
    const last = lastVitals(v4());
    expect(last.LCP).toEqual({ value: 4300, rating: 'poor', doc: 1 });
    expect(last.TTFB).toEqual({ value: 52, rating: 'good', doc: 1 });
    expect(last.CLS).toEqual({ value: 0.183, rating: 'needs-improvement', doc: 1 });
    const s = { vitals: [{ doc: 0, INP: { available: true, value: 100, rating: 'good' } }, { doc: 1, INP: { available: false, reason: 'no-interaction' } }] };
    expect(lastVitals(s).INP).toEqual({ value: 100, rating: 'good', doc: 0 });
    expect(lastVitals(s).LCP).toBeNull();
    expect(Object.keys(lastVitals({}))).toEqual(METRIC_NAMES);
  });
});
