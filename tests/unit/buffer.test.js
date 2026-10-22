import { describe, it, expect } from 'vitest';
import { createBuffer } from '../../src/page/buffer.js';

describe('createBuffer (AC-4.8)', () => {
  it('buffer drops oldest and keeps length max', () => {
    // Same semantics as E0 pushLimited (D13).
    const buf = createBuffer({ maxItems: 3 });
    for (let i = 1; i <= 5; i++) buf.push(i);
    expect(buf.items()).toEqual([3, 4, 5]);
    expect(buf.size).toBe(3);
    expect(buf.truncated).toBe(true);
  });

  it('buffer truncated is false below limits', () => {
    const buf = createBuffer({ maxItems: 3, maxChars: 100 });
    buf.push('a', 10);
    buf.push('b', 20);
    buf.push('c', 70);
    expect(buf.items()).toEqual(['a', 'b', 'c']);
    expect(buf.size).toBe(3);
    expect(buf.chars).toBe(100);
    expect(buf.truncated).toBe(false);
  });

  it('buffer evicts by total chars', () => {
    const buf = createBuffer({ maxItems: 100, maxChars: 100 });
    buf.push('a', 40);
    buf.push('b', 40);
    buf.push('c', 40);
    expect(buf.items()).toEqual(['b', 'c']);
    expect(buf.chars).toBe(80);
    expect(buf.truncated).toBe(true);
  });

  it('entry larger than maxChars alone is dropped too', () => {
    const buf = createBuffer({ maxItems: 10, maxChars: 50 });
    buf.push('a', 10);
    buf.push('huge', 60);
    expect(buf.items()).toEqual([]);
    expect(buf.chars).toBe(0);
    expect(buf.truncated).toBe(true);
  });

  it('6000 pushes with max 5000 keep newest 5000 and truncated', () => {
    const buf = createBuffer({ maxItems: 5000, maxChars: 4_000_000 });
    for (let i = 0; i < 6000; i++) buf.push({ i }, 10);
    const items = buf.items();
    expect(items).toHaveLength(5000);
    expect(items[0]).toEqual({ i: 1000 });
    expect(items[4999]).toEqual({ i: 5999 });
    expect(buf.chars).toBe(50_000);
    expect(buf.truncated).toBe(true);
  });

  it('items() returns a copy', () => {
    const buf = createBuffer({ maxItems: 5 });
    buf.push(1);
    buf.items().push(2);
    expect(buf.items()).toEqual([1]);
  });

  it('clear() empties the buffer and resets counters', () => {
    const buf = createBuffer({ maxItems: 1, maxChars: 10 });
    buf.push('a', 5);
    buf.push('b', 5);
    expect(buf.truncated).toBe(true);
    buf.clear();
    expect(buf.items()).toEqual([]);
    expect(buf.size).toBe(0);
    expect(buf.chars).toBe(0);
    expect(buf.truncated).toBe(false);
  });

  it('invalid chars count as 0', () => {
    const buf = createBuffer({ maxItems: 5, maxChars: 10 });
    buf.push('a', -5);
    buf.push('b', NaN);
    buf.push('c');
    expect(buf.chars).toBe(0);
    expect(buf.size).toBe(3);
  });
});
