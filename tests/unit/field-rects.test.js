// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFieldRects, resolveOpenShadowRoot, FIELD_RECTS_MAX } from '../../src/page/field-rects.js';

// E3-IN1a (D6, AC-2.2, PB-1 = B): rectangles of editable fields for the screenshot mask, collected in ISOLATED.
// jsdom has no layout: every element gets its rectangle from an own `getBoundingClientRect` (zero size by default).

const { window, document, DOMParser } = globalThis;

const FIXTURE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../fixtures/pages/privacy.html'), 'utf8');

const VIEWPORT = { innerWidth: 800, innerHeight: 600, scrollX: 0, scrollY: 120, devicePixelRatio: 2 };
const win = { ...VIEWPORT };

function place(el, x, y, w, h) {
  el.getBoundingClientRect = () => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });
  return { x, y, w, h };
}

function loadFixture() {
  document.documentElement.innerHTML = new DOMParser().parseFromString(FIXTURE, 'text/html').documentElement.innerHTML;
}

const sortRects = (rects) => [...rects].sort((a, b) => a.y - b.y || a.x - b.x);

beforeEach(loadFixture);
afterEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('collectFieldRects', () => {
  it('limit constant is 2000 rectangles', () => {
    expect(FIELD_RECTS_MAX).toBe(2000);
  });

  it('every editable type from question 2 yields a rect; buttons/checkbox/radio/range/color/image/hidden do not (AC-2.2)', () => {
    const mask = [...document.querySelectorAll('.mask')];
    const keep = [...document.querySelectorAll('.keep')];
    expect(mask.map((el) => el.id)).toEqual([
      'f-email', 'f-tel', 'f-text', 'f-textarea', 'f-select', 'f-card', 'f-password', 'f-default', 'f-editable',
    ]);
    expect(keep).toHaveLength(10);
    const expected = mask.map((el, i) => place(el, 10, 10 + i * 30, 300, 20));
    keep.forEach((el, i) => place(el, 400, 10 + i * 30, 100, 20));
    const result = collectFieldRects({ win, doc: document });
    expect(result.ok).toBe(true);
    expect(result.viewport).toEqual({ innerWidth: 800, innerHeight: 600, scrollX: 0, scrollY: 120, dpr: 2, vvScale: 1 });
    expect(sortRects(result.rects)).toEqual(expected);
    expect(result.frames).toEqual({ sameOrigin: 1, crossOrigin: 0, crossOriginVisible: 0 });
  });

  it('fields outside viewport skipped; partially visible kept (clipped to the viewport)', () => {
    document.body.innerHTML = '<input id="a"><input id="b"><input id="c"><input id="d"><textarea id="e"></textarea><input id="z">';
    place(document.getElementById('a'), 10, -50, 100, 20); // above
    place(document.getElementById('b'), 10, 600, 100, 20); // just below
    place(document.getElementById('c'), 820, 10, 100, 20); // right of the viewport
    place(document.getElementById('d'), -40, 590, 100, 30); // partially visible: bottom-left corner
    place(document.getElementById('e'), 700, -10, 200, 30); // partially visible: top-right corner
    // #z keeps the zero-size rect (display: none).
    const { ok, rects } = collectFieldRects({ win, doc: document });
    expect(ok).toBe(true);
    expect(sortRects(rects)).toEqual([
      { x: 700, y: 0, w: 100, h: 20 },
      { x: 0, y: 590, w: 60, h: 10 },
    ]);
  });

  it('same-origin iframe fields offset by frame position (+ clientLeft/Top) and clipped to the frame', () => {
    document.body.innerHTML = '<iframe id="f"></iframe>';
    const frame = document.getElementById('f');
    place(frame, 100, 200, 300, 150);
    Object.defineProperty(frame, 'clientLeft', { value: 4 });
    Object.defineProperty(frame, 'clientTop', { value: 4 });
    const inner = frame.contentDocument;
    inner.body.innerHTML = '<input id="in-frame"><input id="tail"><input type="checkbox" id="box">';
    place(inner.getElementById('in-frame'), 10, 20, 50, 10);
    place(inner.getElementById('tail'), 250, 140, 100, 20); // sticks out of the frame
    place(inner.getElementById('box'), 10, 40, 10, 10);
    const { ok, rects, frames } = collectFieldRects({ win, doc: document });
    expect(ok).toBe(true);
    expect(sortRects(rects)).toEqual([
      { x: 114, y: 224, w: 50, h: 10 },
      { x: 354, y: 344, w: 46, h: 6 },
    ]);
    expect(frames).toEqual({ sameOrigin: 1, crossOrigin: 0, crossOriginVisible: 0 });
  });

  it('iframe with border and padding → offset by content box (S0)', () => {
    document.body.innerHTML = '<iframe id="f" style="padding: 6px 0 0 10px"></iframe>';
    const frame = document.getElementById('f');
    place(frame, 100, 200, 300, 150);
    Object.defineProperty(frame, 'clientLeft', { value: 4 });
    Object.defineProperty(frame, 'clientTop', { value: 3 });
    frame.contentDocument.body.innerHTML = '<input id="in-frame">';
    place(frame.contentDocument.getElementById('in-frame'), 10, 20, 50, 10);
    const { ok, rects } = collectFieldRects({ win: { ...VIEWPORT, getComputedStyle: window.getComputedStyle.bind(window) }, doc: document });
    expect(ok).toBe(true);
    expect(rects).toEqual([{ x: 124, y: 229, w: 50, h: 10 }]);
  });

  it('viewport.vvScale from visualViewport.scale (pinch zoom), 1 without visualViewport (S0)', () => {
    document.body.innerHTML = '<input id="i">';
    place(document.getElementById('i'), 0, 0, 10, 10);
    expect(collectFieldRects({ win: { ...VIEWPORT, visualViewport: { scale: 1.5 } }, doc: document }).viewport.vvScale).toBe(1.5);
    expect(collectFieldRects({ win: { ...VIEWPORT, visualViewport: null }, doc: document }).viewport.vvScale).toBe(1);
  });

  it('same-origin frames nested deeper than 2 levels are masked as a whole', () => {
    document.body.innerHTML = '<iframe id="f1"></iframe>';
    const f1 = document.getElementById('f1');
    place(f1, 0, 0, 500, 500);
    const d1 = f1.contentDocument;
    d1.body.innerHTML = '<iframe id="f2"></iframe>';
    const f2 = d1.getElementById('f2');
    place(f2, 10, 10, 400, 400);
    const d2 = f2.contentDocument;
    d2.body.innerHTML = '<input id="lvl2"><iframe id="f3"></iframe>';
    place(d2.getElementById('lvl2'), 5, 5, 50, 10);
    const f3 = d2.getElementById('f3');
    place(f3, 20, 100, 200, 100);
    f3.contentDocument.body.innerHTML = '<input id="lvl3">';
    place(f3.contentDocument.getElementById('lvl3'), 1, 1, 10, 10);
    const { ok, rects } = collectFieldRects({ win, doc: document });
    expect(ok).toBe(true);
    expect(sortRects(rects)).toEqual([
      { x: 15, y: 15, w: 50, h: 10 },
      { x: 30, y: 110, w: 200, h: 100 },
    ]);
  });

  it('closed shadow root reached through injected openShadowRoot; open shadow root without it', () => {
    document.body.innerHTML = '<div id="closed-host"></div><div id="open-host"></div>';
    const closedHost = document.getElementById('closed-host');
    const closed = closedHost.attachShadow({ mode: 'closed' });
    closed.innerHTML = '<input id="in-closed">';
    const openHost = document.getElementById('open-host');
    openHost.attachShadow({ mode: 'open' }).innerHTML = '<span><textarea id="in-open"></textarea></span>';
    place(closed.getElementById('in-closed'), 10, 10, 100, 20);
    place(openHost.shadowRoot.getElementById('in-open'), 10, 50, 100, 20);

    const without = collectFieldRects({ win, doc: document });
    expect(without.rects).toEqual([{ x: 10, y: 50, w: 100, h: 20 }]);

    const asked = [];
    const openShadowRoot = (el) => {
      asked.push(el);
      return el === closedHost ? closed : el.shadowRoot;
    };
    const withApi = collectFieldRects({ win, doc: document, openShadowRoot });
    expect(withApi.ok).toBe(true);
    expect(sortRects(withApi.rects)).toEqual([
      { x: 10, y: 10, w: 100, h: 20 },
      { x: 10, y: 50, w: 100, h: 20 },
    ]);
    expect(asked).toContain(closedHost);
  });

  it('openShadowRoot throwing for one element does not fail the whole collection', () => {
    document.body.innerHTML = '<div id="h"></div><input id="i">';
    place(document.getElementById('i'), 0, 0, 10, 10);
    const result = collectFieldRects({ win, doc: document, openShadowRoot: () => { throw new Error('no'); } });
    expect(result.ok).toBe(true);
    expect(result.rects).toEqual([{ x: 0, y: 0, w: 10, h: 10 }]);
  });

  it('cross-origin frame (access throws) → no rect, frames.crossOrigin 1, ok true (PB-1 B)', () => {
    document.body.innerHTML = '<iframe id="x"></iframe><iframe id="y"></iframe><input id="i">';
    const x = document.getElementById('x');
    place(x, 0, 0, 400, 300);
    Object.defineProperty(x, 'contentDocument', { get() { throw new Error('SecurityError'); } });
    const y = document.getElementById('y');
    place(y, 0, 300, 400, 200);
    Object.defineProperty(y, 'contentDocument', { value: null }); // Chrome: cross-origin contentDocument is null
    place(document.getElementById('i'), 500, 10, 100, 20);
    const result = collectFieldRects({ win, doc: document });
    expect(result.ok).toBe(true);
    expect(result.rects).toEqual([{ x: 500, y: 10, w: 100, h: 20 }]);
    expect(result.frames).toEqual({ sameOrigin: 0, crossOrigin: 2, crossOriginVisible: 2 });
  });

  it('crossOriginVisible counts only cross-origin frames seen in the viewport, ≥ 40×20, not hidden (store S1)', () => {
    const frames = [
      ['pay', 100, 100, 300, 200, ''], // payment form in view → counted
      ['edge', 780, 590, 300, 200, ''], // only a corner in view, full size ≥ 40×20 → counted
      ['below', 0, 700, 300, 250, ''], // ad below the fold
      ['pixel', 10, 10, 1, 1, ''], // tracking pixel
      ['thin', 10, 10, 300, 19, ''], // under 20 px high
      ['narrow', 10, 10, 39, 200, ''], // under 40 px wide
      ['hidden', 10, 10, 300, 200, 'visibility: hidden'],
      ['clear', 10, 10, 300, 200, 'opacity: 0'],
      ['none', 10, 10, 300, 200, 'display: none'],
    ];
    document.body.innerHTML = frames.map(([id, , , , , style]) => `<iframe id="${id}" style="${style}"></iframe>`).join('');
    for (const [id, x, y, w, h] of frames) {
      const el = document.getElementById(id);
      place(el, x, y, w, h);
      Object.defineProperty(el, 'contentDocument', { value: null });
    }
    const result = collectFieldRects({ win, doc: document });
    expect(result.ok).toBe(true);
    expect(result.frames).toEqual({ sameOrigin: 0, crossOrigin: frames.length, crossOriginVisible: 2 });
  });

  it('crossOriginVisible: a frame whose style cannot be read counts as visible (fail-closed); same-origin clip applies', () => {
    document.body.innerHTML = '<iframe id="x"></iframe><iframe id="outer"></iframe>';
    const x = document.getElementById('x');
    place(x, 0, 0, 300, 200);
    Object.defineProperty(x, 'contentDocument', { value: null });
    Object.defineProperty(x, 'ownerDocument', { value: { defaultView: { getComputedStyle() { throw new Error('nope'); } } } });
    // A cross-origin frame inside a same-origin frame, scrolled out of that frame's box → not visible.
    const outer = document.getElementById('outer');
    place(outer, 400, 0, 200, 100);
    const innerDoc = document.implementation.createHTMLDocument('inner');
    innerDoc.body.innerHTML = '<iframe id="deep"></iframe>';
    const deep = innerDoc.getElementById('deep');
    place(deep, 0, 150, 200, 100);
    Object.defineProperty(deep, 'contentDocument', { value: null });
    Object.defineProperty(outer, 'contentDocument', { value: innerDoc });
    const result = collectFieldRects({ win, doc: document });
    expect(result.frames).toEqual({ sameOrigin: 1, crossOrigin: 2, crossOriginVisible: 1 });

    // A frame whose rectangle throws still counts (and does not fail the field collection).
    document.body.innerHTML = '<iframe id="z"></iframe>';
    const z = document.getElementById('z');
    z.getBoundingClientRect = () => { throw new Error('detached'); };
    Object.defineProperty(z, 'contentDocument', { value: null });
    const thrown = collectFieldRects({ win, doc: document });
    expect(thrown.ok).toBe(true);
    expect(thrown.frames).toEqual({ sameOrigin: 0, crossOrigin: 1, crossOriginVisible: 1 });
  });

  it('throwing DOM → ok false with reason', () => {
    const doc = { querySelectorAll() { throw new TypeError('broken'); } };
    const result = collectFieldRects({ win, doc });
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('rects');

    const badWin = { get innerWidth() { throw new Error('gone'); } };
    expect(collectFieldRects({ win: badWin, doc: document }).ok).toBe(false);
    expect(collectFieldRects({}).ok).toBe(false);
  });

  it('a field whose getBoundingClientRect throws → ok false (never a partial mask)', () => {
    document.body.innerHTML = '<input id="i"><input id="j">';
    place(document.getElementById('i'), 0, 0, 10, 10);
    document.getElementById('j').getBoundingClientRect = () => { throw new Error('layout'); };
    expect(collectFieldRects({ win, doc: document }).ok).toBe(false);
  });

  it('> 2000 rects → single viewport rect', () => {
    document.body.innerHTML = '<input>'.repeat(FIELD_RECTS_MAX + 1);
    [...document.querySelectorAll('input')].forEach((el, i) => place(el, i % 700, (i * 7) % 580, 10, 10));
    const result = collectFieldRects({ win, doc: document });
    expect(result.ok).toBe(true);
    expect(result.rects).toEqual([{ x: 0, y: 0, w: 800, h: 600 }]);
    expect(result.overflow).toBe(true);
  });

  it('exactly 2000 rects are returned one by one', () => {
    document.body.innerHTML = '<input>'.repeat(FIELD_RECTS_MAX);
    [...document.querySelectorAll('input')].forEach((el, i) => place(el, i % 700, (i * 7) % 580, 10, 10));
    const result = collectFieldRects({ win, doc: document });
    expect(result.rects).toHaveLength(FIELD_RECTS_MAX);
    expect(result.overflow).toBe(false);
  });

  it('contenteditable host only (nested editable children are covered by the host)', () => {
    document.body.innerHTML = '<div id="host" contenteditable="true"><p id="inner" contenteditable="true">x</p></div>'
      + '<div id="off" contenteditable="false"></div>';
    place(document.getElementById('host'), 0, 0, 300, 100);
    place(document.getElementById('inner'), 0, 0, 300, 20);
    place(document.getElementById('off'), 0, 200, 300, 100);
    const { rects } = collectFieldRects({ win, doc: document });
    expect(rects).toEqual([{ x: 0, y: 0, w: 300, h: 100 }]);
  });
});

describe('resolveOpenShadowRoot (S0: detection of the closed shadow root API)', () => {
  it('Chrome: chrome.dom.openOrClosedShadowRoot(el) is used when present', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    const calls = [];
    const api = { dom: { openOrClosedShadowRoot(el) { calls.push(el); return el === host ? root : null; } } };
    const open = resolveOpenShadowRoot({ api, win: window });
    expect(open(host)).toBe(root);
    expect(calls).toEqual([host]);
  });

  it('Firefox: getter on Element.prototype detected with `in` and read as a property, never called', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    class FakeElement {}
    // A getter that throws when read off the prototype itself (like Firefox: TypeError on a non-element `this`).
    Object.defineProperty(FakeElement.prototype, 'openOrClosedShadowRoot', {
      configurable: true,
      get() {
        if (this === FakeElement.prototype) throw new TypeError('illegal invocation');
        return this === host ? root : null;
      },
    });
    Object.setPrototypeOf(host, FakeElement.prototype);
    const open = resolveOpenShadowRoot({ api: {}, win: { Element: FakeElement } });
    expect(typeof open).toBe('function');
    expect(open(host)).toBe(root);
  });

  it('neither API → undefined (open shadow roots only)', () => {
    expect(resolveOpenShadowRoot({ api: undefined, win: { Element: class {} } })).toBeUndefined();
    expect(resolveOpenShadowRoot({})).toBeUndefined();
  });
});
