import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { diffSnapshots, requestPath, DIFF_LIMITS } from '../../src/lib/snapshot-diff.js';
import { normalizeSnapshot } from '../../src/lib/migrate.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/snapshots/${name}.json`, import.meta.url), 'utf8'));

// diff-a.json = v4.json + an earlier `POST /api/fail?try=1#x` → 502 (the last entry of a method + path wins) + cookie `cart`.
// diff-b.json = v4.json with known differences:
//   errors   "Uncaught Error: frame failed" → "Uncaught RangeError: too much recursion"
//   statuses POST /api/fail 500 → 200 (other query string), GET /missing.js 404 → net::ERR_FAILED,
//            /img/missing.png unchanged, /only-in-b.css only in b (not a pair, not reported)
//   CWV      LCP 4300 poor → 2100 needs-improvement; INP 336 needs-improvement → none available
//   cookies  consent removed, lang added, sid with another valueHash, cart valueHash null (unknown: not "changed");
//            4 → 4 cookies, 55 → 47 bytes
describe('diffSnapshots (E4-T5, AC-5.6)', () => {
  it('known differences of diff-a/diff-b found exactly (errors, statuses, CWV with rating, cookie count/size/hash names)', () => {
    const d = diffSnapshots(fixture('diff-a'), fixture('diff-b'));
    expect(d.errors.added.map((e) => e.message)).toEqual(['Uncaught RangeError: too much recursion']);
    expect(d.errors.removed.map((e) => e.message)).toEqual(['Uncaught Error: frame failed']);
    expect(d.errors.added[0]).toMatchObject({ count: 1 });
    expect(d.statuses).toEqual([
      { method: 'POST', path: '/api/fail', before: 500, after: 200 },
      { method: 'GET', path: '/missing.js', before: 404, after: 'net::ERR_FAILED' },
    ]);
    expect(d.vitals).toEqual([
      { metric: 'LCP', before: { value: 4300, rating: 'poor' }, after: { value: 2100, rating: 'needs-improvement' } },
      { metric: 'INP', before: { value: 336, rating: 'needs-improvement' }, after: null },
    ]);
    expect(d.cookies).toEqual({
      count: { before: 4, after: 4 },
      totalBytes: { before: 55, after: 47 },
      added: ['lang'],
      removed: ['consent'],
      changedHash: ['sid'],
    });
    expect(d.omitted).toBe(0);
  });

  it('identical packages → all lists empty', () => {
    const d = diffSnapshots(fixture('v4'), fixture('v4'));
    expect(d.errors).toEqual({ added: [], removed: [] });
    expect(d.statuses).toEqual([]);
    expect(d.vitals).toEqual([]);
    expect(d.cookies).toEqual({ count: { before: 3, after: 3 }, totalBytes: { before: 45, after: 45 }, added: [], removed: [], changedHash: [] });
  });

  it('v2 vs v4 (normalized) does not throw', () => {
    const v2 = normalizeSnapshot(fixture('v2')).snapshot;
    const v4 = fixture('v4');
    expect(() => diffSnapshots(v2, v4)).not.toThrow();
    expect(() => diffSnapshots(v4, v2)).not.toThrow();
    const d = diffSnapshots(v2, v4);
    expect(Array.isArray(d.statuses)).toBe(true);
    expect(d.cookies.count.after).toBe(3);
  });

  it('missing fields never throw (empty objects, null, wrong types)', () => {
    for (const [a, b] of [[{}, {}], [null, undefined], [{ network: 'x', storage: { cookies: 'a=1' }, vitals: [null] }, { runtimeErrors: [null, 5] }]]) {
      const d = diffSnapshots(a, b);
      expect(d.errors).toEqual({ added: [], removed: [] });
      expect(d.statuses).toEqual([]);
      expect(d.vitals).toEqual([]);
      expect(d.cookies.added).toEqual([]);
    }
  });

  it('requestPath drops scheme, host, query and fragment; keeps relative and odd URLs bounded', () => {
    expect(requestPath('https://a.example.test:8443/api/x?token=[REDACTED]#frag')).toBe('/api/x');
    expect(requestPath('http://h.test')).toBe('/');
    expect(requestPath('/rel/path?q=1')).toBe('/rel/path');
    expect(requestPath('data:text/plain,abc')).toBe('data:text/plain,abc');
    expect(requestPath(null)).toBe('');
    expect(requestPath(`https://h.test/${'p'.repeat(5000)}`).length).toBe(DIFF_LIMITS.pathChars);
  });

  it('every list is capped; the rest is counted in omitted', () => {
    const net = (n, status) => Array.from({ length: n }, (_, i) => ({ method: 'GET', url: `https://h.test/r${i}`, status }));
    const errors = (prefix, n) => Array.from({ length: n }, (_, i) => ({ t: i, doc: 0, message: `${prefix} ${i}` }));
    const a = { network: net(DIFF_LIMITS.maxItems + 5, 200), runtimeErrors: errors('a', DIFF_LIMITS.maxItems + 1) };
    const b = { network: net(DIFF_LIMITS.maxItems + 5, 500), runtimeErrors: errors('b', 2) };
    const d = diffSnapshots(a, b);
    expect(d.statuses).toHaveLength(DIFF_LIMITS.maxItems);
    expect(d.errors.removed).toHaveLength(DIFF_LIMITS.maxItems);
    expect(d.errors.added).toHaveLength(2);
    expect(d.omitted).toBe(5 + 1);
  });
});
