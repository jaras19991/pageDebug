// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { serializeCapped } from '../../src/page/serialize.js';
import { LIMITS } from '../../src/page/constants.js';

// AC-6.5 (E3-T0a, D9): the cost of a console entry depends on the entry budget, not on the logged object.

function bigObject() {
  const items = [];
  for (let i = 0; items.length * 110 < 5 * 1024 * 1024; i++) {
    items.push({ id: i, name: `item-${i}`, tags: ['alpha', 'beta'], payload: 'p'.repeat(60), nested: { ok: true, n: i * 2 } });
  }
  return { meta: { count: items.length, source: 'perf' }, items, blob: 'b'.repeat(1024 * 1024) };
}

describe('serializeCapped performance (AC-6.5)', () => {
  it('console.log(5 MB object) serialize p95 ≤ 5 ms over 50 runs', () => {
    const obj = bigObject();
    expect(JSON.stringify(obj).length).toBeGreaterThan(5 * 1024 * 1024);
    const maxChars = LIMITS.entryChars;
    for (let i = 0; i < 5; i++) serializeCapped(['state', obj], maxChars);

    const times = [];
    for (let i = 0; i < 50; i++) {
      const start = performance.now();
      const out = serializeCapped(['state', obj], maxChars);
      times.push(performance.now() - start);
      expect(out.truncated).toBe(true);
      expect(out.value.preview).toHaveLength(maxChars);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(0.95 * times.length) - 1];
    expect(p95).toBeLessThanOrEqual(5);
  });
});
