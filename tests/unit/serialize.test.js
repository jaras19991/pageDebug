// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { deepMerge, safeSlice, safeJson, serializeCapped } from '../../src/page/serialize.js';

// Moved from the E0 characterization tests (page-debug-snapshot.test.js, D13):
// same assertions, except "same object twice", which E1 changes on purpose.

describe('deepMerge (AC-6.1, AC-6.5)', () => {
  it('deepMerge merges nested objects', () => {
    const target = { a: 1, nested: { x: 1, y: 2, deep: { k: 'old', keep: true } } };
    const source = { b: 2, nested: { y: 20, deep: { k: 'new' } } };
    expect(deepMerge(target, source)).toEqual({
      a: 1,
      b: 2,
      nested: { x: 1, y: 20, deep: { k: 'new', keep: true } },
    });
  });

  it('deepMerge replaces arrays', () => {
    const target = { list: [1, 2, 3], nested: { tags: ['a', 'b'] } };
    const source = { list: [9], nested: { tags: [] } };
    const out = deepMerge(target, source);
    expect(out.list).toEqual([9]);
    expect(out.nested.tags).toEqual([]);
  });

  it('deepMerge returns copy of target for null/non-object source', () => {
    const target = { a: 1, nested: { b: 2 } };
    for (const source of [null, undefined, 42, 'str', true]) {
      const out = deepMerge(target, source);
      expect(out).toEqual(target);
      expect(out).not.toBe(target);
    }
  });

  it('deepMerge does not mutate target', () => {
    const target = { a: 1, nested: { b: 2, deep: { c: 3 } }, list: [1] };
    const before = structuredClone(target);
    const nestedRef = target.nested;
    const out = deepMerge(target, { a: 9, nested: { b: 8, deep: { c: 7 } }, list: [2] });
    expect(target).toEqual(before);
    expect(target.nested).toBe(nestedRef);
    expect(out.nested).not.toBe(target.nested);
    expect(out.nested.deep).not.toBe(target.nested.deep);
  });

  it('deepMerge does not share references with source', () => {
    const source = {
      fresh: { deep: { v: 1 } },
      list: [{ x: 1 }, [2]],
      nested: { inner: { k: 'v' } },
    };
    const out = deepMerge({ nested: { keep: true } }, source);
    expect(out).toEqual({
      fresh: { deep: { v: 1 } },
      list: [{ x: 1 }, [2]],
      nested: { keep: true, inner: { k: 'v' } },
    });
    expect(out.fresh).not.toBe(source.fresh);
    expect(out.fresh.deep).not.toBe(source.fresh.deep);
    expect(out.list).not.toBe(source.list);
    expect(out.list[0]).not.toBe(source.list[0]);
    expect(out.list[1]).not.toBe(source.list[1]);
    expect(out.nested.inner).not.toBe(source.nested.inner);

    source.fresh.deep.v = 99;
    source.list[0].x = 99;
    source.list.push('later');
    source.nested.inner.k = 'changed';
    expect(out.fresh.deep.v).toBe(1);
    expect(out.list).toEqual([{ x: 1 }, [2]]);
    expect(out.nested.inner.k).toBe('v');
  });
});

describe('safeSlice (AC-6.2)', () => {
  it('safeSlice keeps short string', () => {
    expect(safeSlice('abc', 3)).toBe('abc');
    expect(safeSlice('', 3)).toBe('');
  });

  it('safeSlice truncates with exact N suffix', () => {
    expect(safeSlice('abcdefghij', 4)).toBe('abcd... [truncated 6 chars]');
  });

  it('safeSlice returns non-string unchanged', () => {
    const obj = { long: 'x'.repeat(100) };
    expect(safeSlice(obj, 1)).toBe(obj);
    expect(safeSlice(12345, 1)).toBe(12345);
    expect(safeSlice(null, 1)).toBeNull();
    expect(safeSlice(undefined, 1)).toBeUndefined();
  });
});

describe('safeJson (AC-6.4)', () => {
  it('named and anonymous functions', () => {
    function namedFn() {}
    const out = safeJson({ named: namedFn, anon: [() => {}][0] });
    expect(out).toEqual({ named: '[Function: namedFn]', anon: '[Function: anonymous]' });
  });

  it('Error to {name,message,stack}', () => {
    const err = new TypeError('boom');
    const out = safeJson({ err });
    expect(out.err).toEqual({ name: 'TypeError', message: 'boom', stack: err.stack });
    expect(out.err.stack).toContain('boom');
  });

  it('Element to summary with outerHTML ≤ 2000 + suffix', () => {
    const el = document.createElement('div');
    el.id = 'big';
    el.className = 'a b';
    el.textContent = 'x'.repeat(3000);
    const fullLength = el.outerHTML.length;

    const out = safeJson({ el });
    expect(Object.keys(out.el).sort()).toEqual(['className', 'id', 'outerHTML', 'tagName']);
    expect(out.el.tagName).toBe('DIV');
    expect(out.el.id).toBe('big');
    expect(out.el.className).toBe('a b');
    expect(out.el.outerHTML).toBe(
      el.outerHTML.slice(0, 2000) + `... [truncated ${fullLength - 2000} chars]`,
    );
  });

  it('Element outerHTML limit is a parameter', () => {
    const el = document.createElement('p');
    el.textContent = 'y'.repeat(50);
    const out = safeJson(el, { outerHtmlMax: 10 });
    expect(out.outerHTML).toBe(el.outerHTML.slice(0, 10) + `... [truncated ${el.outerHTML.length - 10} chars]`);
  });

  it('cycle to [Circular]', () => {
    const a = { name: 'a' };
    a.self = a;
    expect(safeJson(a)).toEqual({ name: 'a', self: '[Circular]' });
  });

  it('deep cycle through arrays to [Circular]', () => {
    const root = { list: [] };
    const child = { parent: root };
    root.list.push(child);
    expect(safeJson(root)).toEqual({ list: [{ parent: '[Circular]' }] });
  });

  it('BigInt to serializationError+fallback', () => {
    const out = safeJson(10n);
    expect(Object.keys(out).sort()).toEqual(['fallback', 'serializationError']);
    expect(out.serializationError).toBeTypeOf('string');
    expect(out.serializationError.length).toBeGreaterThan(0);
    expect(out.fallback).toBe('10');
  });

  it('same object twice without cycle is serialized twice', () => {
    // D13: E0 reported a shared (non-cyclic) reference as "[Circular]"; cycles are
    // now detected on the ancestor stack only.
    const shared = { v: 1 };
    expect(safeJson({ first: shared, second: shared })).toEqual({
      first: { v: 1 },
      second: { v: 1 },
    });
    expect(safeJson([shared, [shared], { s: shared }])).toEqual([{ v: 1 }, [{ v: 1 }], { s: { v: 1 } }]);
  });
});

describe('serializeCapped', () => {
  it('serializeCapped returns value and chars within limit', () => {
    const out = serializeCapped(['hello', { n: 1 }], 100);
    expect(out.truncated).toBe(false);
    expect(out.value).toEqual(['hello', { n: 1 }]);
    expect(out.chars).toBe(JSON.stringify(['hello', { n: 1 }]).length);
  });

  it('serializeCapped returns preview and truncated:true above limit', () => {
    const big = ['x'.repeat(500)];
    const out = serializeCapped(big, 100);
    expect(out.truncated).toBe(true);
    expect(out.value).toEqual({ truncated: true, preview: JSON.stringify(big).slice(0, 100) });
    expect(out.value.preview).toHaveLength(100);
    expect(out.chars).toBe(JSON.stringify(out.value).length);
    expect(out.chars).toBeLessThan(200);
  });

  it('serializeCapped uses safeJson rules (functions, cycles)', () => {
    const a = { f() {} };
    a.self = a;
    const out = serializeCapped(a, 1000);
    expect(out.value).toEqual({ f: '[Function: f]', self: '[Circular]' });
  });
});
