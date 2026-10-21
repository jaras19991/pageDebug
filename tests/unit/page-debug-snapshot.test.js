// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadPageScript } from './helpers/load-page-script.js';

// Characterization tests (US-6): they pin the current behaviour of the helper
// logic in src/page/page-debug-snapshot.js so the E1 refactor cannot change it
// silently. `init()` is never called — no console/network hooks in these tests.

let pds;

beforeEach(() => {
  pds = loadPageScript();
});

describe('loadPageScript', () => {
  it('loader exposes PageDebugSnapshot with version 1.0.0', () => {
    expect(window).toBe(globalThis);
    expect(pds).toBeTypeOf('object');
    expect(window.PageDebugSnapshot).toBe(pds);
    expect(pds.version).toBe('1.0.0');
    expect(pds.initialized).toBe(false);
  });

  it('loader returns a fresh instance on every call', () => {
    pds.state.consoleLogs.push('x');
    const again = loadPageScript();
    expect(again).not.toBe(pds);
    expect(again.state.consoleLogs).toEqual([]);
  });
});

describe('deepMerge (AC-6.1)', () => {
  it('deepMerge merges nested objects', () => {
    const target = { a: 1, nested: { x: 1, y: 2, deep: { k: 'old', keep: true } } };
    const source = { b: 2, nested: { y: 20, deep: { k: 'new' } } };
    expect(pds.deepMerge(target, source)).toEqual({
      a: 1,
      b: 2,
      nested: { x: 1, y: 20, deep: { k: 'new', keep: true } },
    });
  });

  it('deepMerge replaces arrays', () => {
    const target = { list: [1, 2, 3], nested: { tags: ['a', 'b'] } };
    const source = { list: [9], nested: { tags: [] } };
    const out = pds.deepMerge(target, source);
    expect(out.list).toEqual([9]);
    expect(out.nested.tags).toEqual([]);
  });

  it('deepMerge returns copy of target for null/non-object source', () => {
    const target = { a: 1, nested: { b: 2 } };
    for (const source of [null, undefined, 42, 'str', true]) {
      const out = pds.deepMerge(target, source);
      expect(out).toEqual(target);
      expect(out).not.toBe(target);
    }
  });

  it('deepMerge does not mutate target', () => {
    const target = { a: 1, nested: { b: 2, deep: { c: 3 } }, list: [1] };
    const before = structuredClone(target);
    const nestedRef = target.nested;
    const out = pds.deepMerge(target, { a: 9, nested: { b: 8, deep: { c: 7 } }, list: [2] });
    expect(target).toEqual(before);
    expect(target.nested).toBe(nestedRef);
    expect(out.nested).not.toBe(target.nested);
    expect(out.nested.deep).not.toBe(target.nested.deep);
  });
});

describe('safeSlice (AC-6.2)', () => {
  it('safeSlice keeps short string', () => {
    expect(pds.safeSlice('abc', 3)).toBe('abc');
    expect(pds.safeSlice('', 3)).toBe('');
  });

  it('safeSlice truncates with exact N suffix', () => {
    expect(pds.safeSlice('abcdefghij', 4)).toBe('abcd... [truncated 6 chars]');
  });

  it('safeSlice returns non-string unchanged', () => {
    const obj = { long: 'x'.repeat(100) };
    expect(pds.safeSlice(obj, 1)).toBe(obj);
    expect(pds.safeSlice(12345, 1)).toBe(12345);
    expect(pds.safeSlice(null, 1)).toBeNull();
    expect(pds.safeSlice(undefined, 1)).toBeUndefined();
  });
});

describe('pushLimited (AC-6.3)', () => {
  it('pushLimited drops oldest and keeps length max', () => {
    const arr = [];
    for (let i = 1; i <= 5; i++) pds.pushLimited(arr, i, 3);
    expect(arr).toEqual([3, 4, 5]);
    expect(arr).toHaveLength(3);
  });
});

describe('safeJson (AC-6.4)', () => {
  it('named and anonymous functions', () => {
    function namedFn() {}
    const out = pds.safeJson({ named: namedFn, anon: [() => {}][0] });
    expect(out).toEqual({ named: '[Function: namedFn]', anon: '[Function: anonymous]' });
  });

  it('Error to {name,message,stack}', () => {
    const err = new TypeError('boom');
    const out = pds.safeJson({ err });
    expect(out.err).toEqual({ name: 'TypeError', message: 'boom', stack: err.stack });
    expect(out.err.stack).toContain('boom');
  });

  it('Element to summary with outerHTML ≤ 2000 + suffix', () => {
    const el = document.createElement('div');
    el.id = 'big';
    el.className = 'a b';
    el.textContent = 'x'.repeat(3000);
    const fullLength = el.outerHTML.length;

    const out = pds.safeJson({ el });
    expect(Object.keys(out.el).sort()).toEqual(['className', 'id', 'outerHTML', 'tagName']);
    expect(out.el.tagName).toBe('DIV');
    expect(out.el.id).toBe('big');
    expect(out.el.className).toBe('a b');
    expect(out.el.outerHTML).toBe(
      el.outerHTML.slice(0, 2000) + `... [truncated ${fullLength - 2000} chars]`,
    );
  });

  it('cycle to [Circular]', () => {
    const a = { name: 'a' };
    a.self = a;
    expect(pds.safeJson(a)).toEqual({ name: 'a', self: '[Circular]' });
  });

  it('BigInt to serializationError+fallback', () => {
    const out = pds.safeJson(10n);
    expect(Object.keys(out).sort()).toEqual(['fallback', 'serializationError']);
    expect(out.serializationError).toBeTypeOf('string');
    expect(out.serializationError.length).toBeGreaterThan(0);
    expect(out.fallback).toBe('10');
  });

  it('same object twice without cycle → [Circular] (known quirk, kept in E0)', () => {
    // characterization: current behaviour, fixed in E1
    // A shared (non-cyclic) reference is reported as "[Circular]" on its second
    // occurrence because the replacer's WeakSet never forgets visited objects.
    const shared = { v: 1 };
    expect(pds.safeJson({ first: shared, second: shared })).toEqual({
      first: { v: 1 },
      second: '[Circular]',
    });
  });
});
