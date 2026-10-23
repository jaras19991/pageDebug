// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { installFrameHooks, FRAME_LIMITS } from '../../src/page/hooks-frames.js';

const win = globalThis.window;
const doc = globalThis.document;

let records;
let restore;

function install(extra = {}) {
  records = [];
  let clock = 100;
  restore = installFrameHooks({
    win,
    doc,
    now: () => ++clock,
    record: (kind, entry) => records.push({ kind, entry }),
    json: (v) => ({ json: v }),
    ...extra,
  });
  return restore;
}

function addFrame(parent = doc.body) {
  const frame = parent.ownerDocument.createElement('iframe');
  parent.appendChild(frame);
  return frame;
}

// MutationObserver callbacks run as microtasks.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function frameError(frameWin, message = 'boom') {
  frameWin.dispatchEvent(new frameWin.ErrorEvent('error', { message, filename: 'inner.js', lineno: 1, colno: 2 }));
}

afterEach(() => {
  if (restore) restore();
  restore = null;
  doc.body.innerHTML = '';
});

describe('installFrameHooks (E2-D6)', () => {
  it('console.error in same-origin iframe recorded with frame url; console.log not recorded', () => {
    const frame = addFrame();
    install();
    frame.contentWindow.console.error('inner failure');
    frame.contentWindow.console.log('just info');
    expect(records).toHaveLength(1);
    const { kind, entry } = records[0];
    expect(kind).toBe('consoleLogs');
    expect(entry.level).toBe('error');
    expect(entry.args).toEqual({ json: ['inner failure'] });
    expect(entry.frame).toBe(frame.contentWindow.location.href);
  });

  it('error event in iframe recorded with frame', () => {
    const frame = addFrame();
    install();
    frameError(frame.contentWindow, 'inner boom');
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe('runtimeErrors');
    expect(records[0].entry).toMatchObject({ type: 'error', message: 'inner boom', frame: frame.contentWindow.location.href });
  });

  it('does not touch the top window itself', () => {
    install();
    win.console.error('top');
    win.dispatchEvent(new win.ErrorEvent('error', { message: 'top' }));
    expect(records).toHaveLength(0);
  });

  it('iframe added after install is hooked (MutationObserver), also when nested in an added subtree', async () => {
    install();
    const wrap = doc.createElement('div');
    const frame = doc.createElement('iframe');
    wrap.appendChild(frame);
    doc.body.appendChild(wrap);
    await flush();
    frame.contentWindow.console.error('late');
    expect(records.map((r) => r.entry.frame)).toEqual([frame.contentWindow.location.href]);
  });

  it('frame url is capped at 4000 chars', () => {
    const frame = addFrame();
    install();
    const long = `#${'a'.repeat(5000)}`;
    frame.contentWindow.location.hash = long;
    frame.contentWindow.console.error('x');
    expect(records[0].entry.frame.length).toBe(FRAME_LIMITS.urlChars);
    expect(FRAME_LIMITS.urlChars).toBe(4000);
  });

  it('cross-origin-like frame (access throws) ignored without exception', () => {
    // jsdom reads contentWindow itself on every frame insertion/removal, so the getters throw only while `blocked`.
    let blocked = false;
    const frame = addFrame();
    const frameWin = frame.contentWindow;
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      get() {
        if (blocked) throw new win.DOMException('Blocked a frame', 'SecurityError');
        return frameWin;
      },
    });
    const other = addFrame();
    const otherWin = other.contentWindow;
    const fakeOther = {
      get location() {
        if (blocked) throw new win.DOMException('Blocked a frame', 'SecurityError');
        return otherWin.location;
      },
      get console() {
        return otherWin.console;
      },
    };
    Object.defineProperty(other, 'contentWindow', { configurable: true, get: () => (blocked ? fakeOther : otherWin) });
    blocked = true;
    try {
      expect(() => install()).not.toThrow();
      expect(() => frame.dispatchEvent(new win.Event('load'))).not.toThrow();
      expect(() => other.dispatchEvent(new win.Event('load'))).not.toThrow();
      frameWin.console.error('not ours');
      otherWin.console.error('not ours');
      expect(records).toHaveLength(0);
    } finally {
      blocked = false;
    }
  });

  it('frame with a different origin is ignored', () => {
    const frame = addFrame();
    const real = frame.contentWindow;
    const fake = new Proxy(real, {
      get(target, key) {
        if (key === 'location') return { origin: 'https://other.example', href: 'https://other.example/' };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    Object.defineProperty(frame, 'contentWindow', { value: fake });
    install();
    real.console.error('foreign');
    expect(records).toHaveLength(0);
  });

  it('frame reload reinstalls hooks once (no duplicates)', () => {
    const frame = addFrame();
    install();
    frame.dispatchEvent(new win.Event('load'));
    frame.dispatchEvent(new win.Event('load'));
    frame.contentWindow.console.error('once');
    frameError(frame.contentWindow);
    expect(records.map((r) => r.kind)).toEqual(['consoleLogs', 'runtimeErrors']);
  });

  it('restore removes hooks from all frames', async () => {
    const first = addFrame();
    const firstError = first.contentWindow.console.error;
    install();
    const second = addFrame();
    await flush();
    expect(first.contentWindow.console.error).not.toBe(firstError);
    restore();
    restore = null;
    expect(first.contentWindow.console.error).toBe(firstError);
    first.contentWindow.console.error('after');
    second.contentWindow.console.error('after');
    frameError(first.contentWindow);
    frameError(second.contentWindow);
    // frames added after restore are not hooked either
    const third = addFrame();
    await flush();
    third.contentWindow.console.error('after');
    first.dispatchEvent(new win.Event('load'));
    first.contentWindow.console.error('after');
    expect(records).toHaveLength(0);
  });

  it('more than 20 frames: extra ignored', () => {
    const frames = [];
    for (let i = 0; i < 25; i += 1) frames.push(addFrame());
    install();
    for (const frame of frames) frame.contentWindow.console.error('x');
    expect(records).toHaveLength(FRAME_LIMITS.frames);
    expect(FRAME_LIMITS.frames).toBe(20);
  });

  it('a removed frame frees its slot', async () => {
    const frames = [];
    for (let i = 0; i < 20; i += 1) frames.push(addFrame());
    install();
    frames[0].remove();
    await flush();
    const late = addFrame();
    await flush();
    late.contentWindow.console.error('late');
    expect(records).toHaveLength(1);
  });

  it('nested same-origin frames are hooked to depth 2, deeper ones ignored', () => {
    const level1 = addFrame();
    const level2 = addFrame(level1.contentDocument.body);
    const level3 = addFrame(level2.contentDocument.body);
    install();
    level1.contentWindow.console.error('1');
    level2.contentWindow.console.error('2');
    level3.contentWindow.console.error('3');
    expect(records.map((r) => r.entry.args.json[0])).toEqual(['1', '2']);
    expect(records[1].entry.frame).toBe(level2.contentWindow.location.href);
  });

  it('a recorder failure never reaches the page', () => {
    const frame = addFrame();
    install({
      record: () => {
        throw new Error('recorder broke');
      },
    });
    expect(() => frame.contentWindow.console.error('x')).not.toThrow();
    expect(() => frameError(frame.contentWindow)).not.toThrow();
  });
});
