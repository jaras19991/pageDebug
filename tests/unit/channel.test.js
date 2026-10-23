import { describe, it, expect, vi, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  connectMain,
  connectIsolated,
  CHANNEL_PROTOCOL,
  CHANNEL_EVENTS,
  I2M_TYPES,
  M2I_TYPES,
} from '../../src/page/channel.js';

// Two "worlds" = two independent channel instances on the same jsdom document.
// The page is simulated by listeners added after binding (page scripts run after
// document_start, D3).

const NONCE = 'nonce-0000-test';

function makeDom() {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  return { win: dom.window, doc: dom.window.document };
}

function startMain(doc, extra = {}) {
  const got = [];
  const ch = connectMain({ doc, onMessage: (m) => got.push(m), version: '9.9.9', ...extra });
  return { ch, got };
}

function startIsolated(doc, extra = {}) {
  const got = [];
  const ch = connectIsolated({ doc, onMessage: (m) => got.push(m), randomUUID: () => NONCE, ...extra });
  return { ch, got };
}

function bindBoth(order = 'main-first', extra = {}) {
  const { win, doc } = makeDom();
  let main, iso;
  if (order === 'main-first') {
    main = startMain(doc, extra);
    iso = startIsolated(doc, extra);
  } else {
    iso = startIsolated(doc, extra);
    main = startMain(doc, extra);
  }
  return { win, doc, main, iso };
}

// Captures every event a page listener could see on window and document.
function pageSpy(win, doc) {
  const seen = [];
  const names = ['message', ...Object.values(CHANNEL_EVENTS)];
  for (const target of [win, doc]) {
    for (const name of names) {
      for (const capture of [true, false]) {
        target.addEventListener(name, (e) => {
          seen.push({ name, detail: e.detail, data: e.data, relatedTarget: e.relatedTarget });
        }, capture);
      }
    }
  }
  return seen;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('channel handshake (D3)', () => {
  it('handshake binds when MAIN starts first', async () => {
    const { main, iso } = bindBoth('main-first');
    expect(main.ch.isBound()).toBe(true);
    expect(iso.ch.isBound()).toBe(true);
    await expect(main.ch.whenBound).resolves.toBe(true);
    await expect(iso.ch.whenBound).resolves.toBe(true);
    expect(iso.ch.peerVersion()).toBe('9.9.9');
  });

  it('handshake binds when ISOLATED starts first', async () => {
    const { main, iso } = bindBoth('isolated-first');
    expect(main.ch.isBound()).toBe(true);
    expect(iso.ch.isBound()).toBe(true);
    await expect(main.ch.whenBound).resolves.toBe(true);
    await expect(iso.ch.whenBound).resolves.toBe(true);
  });

  it('both sides end up on the same detached node', () => {
    const { doc } = makeDom();
    const nodes = { main: null, iso: null };
    const origAdd = doc.defaultView.EventTarget.prototype.addEventListener;
    const spy = vi.spyOn(doc.defaultView.EventTarget.prototype, 'addEventListener')
      .mockImplementation(function (type, ...rest) {
        if (type === CHANNEL_EVENTS.toMain) nodes.main = this;
        if (type === CHANNEL_EVENTS.toIsolated) nodes.iso = this;
        return origAdd.call(this, type, ...rest);
      });
    startIsolated(doc);
    startMain(doc);
    spy.mockRestore();
    expect(nodes.main).toBeTruthy();
    expect(nodes.main).toBe(nodes.iso);
    expect(nodes.main.isConnected).toBe(false);
  });

  it('after binding no listener remains on document', () => {
    const { doc } = makeDom();
    const added = [];
    const removed = [];
    const proto = doc.defaultView.EventTarget.prototype;
    const origAdd = proto.addEventListener;
    const origRem = proto.removeEventListener;
    const addSpy = vi.spyOn(proto, 'addEventListener').mockImplementation(function (type, fn, opt) {
      if (this === doc) added.push({ type, fn });
      return origAdd.call(this, type, fn, opt);
    });
    const remSpy = vi.spyOn(proto, 'removeEventListener').mockImplementation(function (type, fn, opt) {
      if (this === doc) removed.push({ type, fn });
      return origRem.call(this, type, fn, opt);
    });
    startMain(doc);
    startIsolated(doc);
    addSpy.mockRestore();
    remSpy.mockRestore();
    expect(added.length).toBeGreaterThan(0);
    for (const a of added) {
      expect(removed.some((r) => r.type === a.type && r.fn === a.fn)).toBe(true);
    }
  });
});

describe('channel messages', () => {
  it('messages round-trip both directions synchronously', () => {
    const { main, iso } = bindBoth();
    expect(iso.ch.send('config', { record: true, docId: 'd1' }, 7)).toBe(true);
    expect(main.got).toEqual([{ type: 'config', payload: { record: true, docId: 'd1' }, id: 7 }]);
    expect(main.ch.send('result', { ok: 1 }, 7)).toBe(true);
    expect(iso.got).toEqual([{ type: 'result', payload: { ok: 1 }, id: 7 }]);
  });

  it('send before binding returns false and delivers nothing', () => {
    const { doc } = makeDom();
    const iso = startIsolated(doc);
    expect(iso.ch.isBound()).toBe(false);
    expect(iso.ch.send('config', {})).toBe(false);
  });

  it('unknown type is not sent', () => {
    const { main, iso } = bindBoth();
    expect(iso.ch.send('result', {})).toBe(false);
    expect(main.ch.send('config', {})).toBe(false);
    expect(main.got).toEqual([]);
    expect(iso.got).toEqual([]);
  });

  // E2-T9b: the background's time-limit stop goes ISOLATED → MAIN; MAIN cannot send it.
  it('stop travels only from ISOLATED to MAIN', () => {
    expect(I2M_TYPES).toContain('stop');
    expect(M2I_TYPES).not.toContain('stop');
    const { main, iso } = bindBoth();
    expect(iso.ch.send('stop', { reason: 'time-limit' })).toBe(true);
    expect(main.got).toEqual([{ type: 'stop', payload: { reason: 'time-limit' }, id: null }]);
    expect(main.ch.send('stop', { reason: 'user' })).toBe(false);
    expect(iso.got).toEqual([]);
  });

  it('detail crossing the world boundary is always a JSON string with nonce and protocol', () => {
    const { doc } = makeDom();
    const details = [];
    const proto = doc.defaultView.EventTarget.prototype;
    const orig = proto.dispatchEvent;
    const spy = vi.spyOn(proto, 'dispatchEvent').mockImplementation(function (e) {
      if (e.type === CHANNEL_EVENTS.toMain || e.type === CHANNEL_EVENTS.toIsolated) details.push(e.detail);
      return orig.call(this, e);
    });
    const main = startMain(doc);
    const iso = startIsolated(doc);
    iso.ch.send('collect', { a: [1, 'x'] }, 'r1');
    main.ch.send('flush', { b: null });
    spy.mockRestore();
    expect(details.length).toBeGreaterThanOrEqual(4); // hello, bind, collect, flush
    for (const d of details) expect(typeof d).toBe('string');
    const parsed = details.map((d) => JSON.parse(d));
    for (const p of parsed.filter((m) => m.type !== 'hello')) {
      expect(p.n).toBe(NONCE);
      expect(p.v).toBe(CHANNEL_PROTOCOL);
    }
    expect(parsed.find((m) => m.type === 'collect')).toEqual({
      n: NONCE, v: CHANNEL_PROTOCOL, id: 'r1', type: 'collect', payload: { a: [1, 'x'] },
    });
  });
});

describe('channel privacy (AC-5.6)', () => {
  it('page listener on document and window sees no message after binding', () => {
    const { win, doc, main, iso } = bindBoth();
    const seen = pageSpy(win, doc);
    iso.ch.send('config', { record: true }, 1);
    iso.ch.send('collect', {}, 2);
    main.ch.send('result', { secret: 'buffer-content' }, 2);
    main.ch.send('flush', { secret: 'buffer-content' });
    expect(main.got).toHaveLength(2);
    expect(iso.got).toHaveLength(2);
    expect(seen).toEqual([]);
  });

  it('page patching dispatchEvent, JSON and detail after binding sees neither nonce nor payload', () => {
    const { win, main, iso } = bindBoth();
    const leaked = [];
    const proto = win.EventTarget.prototype;
    const origDispatch = proto.dispatchEvent;
    proto.dispatchEvent = function (e) { leaked.push(String(e.detail)); return origDispatch.call(this, e); };
    const origStringify = win.JSON.stringify;
    win.JSON.stringify = function (...a) { const s = origStringify.apply(this, a); leaked.push(s); return s; };
    const origParse = win.JSON.parse;
    win.JSON.parse = function (...a) { leaked.push(a[0]); return origParse.apply(this, a); };
    const descr = Object.getOwnPropertyDescriptor(win.CustomEvent.prototype, 'detail');
    Object.defineProperty(win.CustomEvent.prototype, 'detail', {
      configurable: true,
      get() { const v = descr.get.call(this); leaked.push(v); return v; },
    });
    try {
      main.ch.send('result', { secret: 'buffer-content' }, 3);
      expect(iso.got).toHaveLength(1);
    } finally {
      proto.dispatchEvent = origDispatch;
      win.JSON.stringify = origStringify;
      win.JSON.parse = origParse;
      Object.defineProperty(win.CustomEvent.prototype, 'detail', descr);
    }
    // Both channel ends captured their intrinsics at connect time (before page scripts run).
    expect(leaked).toEqual([]);
  });

  it('forged pds:isolated-ready after binding is ignored by MAIN', () => {
    const { win, doc, main, iso } = bindBoth();
    const evil = doc.createElement('div');
    const evilGot = [];
    evil.addEventListener(CHANNEL_EVENTS.toIsolated, (e) => evilGot.push(e.detail));
    doc.dispatchEvent(new win.MouseEvent(CHANNEL_EVENTS.isolatedReady, { relatedTarget: evil }));
    doc.dispatchEvent(new win.Event(CHANNEL_EVENTS.mainReady));
    main.ch.send('flush', { secret: 'x' });
    expect(evilGot).toEqual([]);
    expect(iso.got).toHaveLength(1);
  });

  it('message with wrong nonce, wrong version or non-string detail is dropped', () => {
    const { doc } = makeDom();
    let node = null;
    const proto = doc.defaultView.EventTarget.prototype;
    const origAdd = proto.addEventListener;
    const spy = vi.spyOn(proto, 'addEventListener').mockImplementation(function (type, ...rest) {
      if (type === CHANNEL_EVENTS.toMain) node = this;
      return origAdd.call(this, type, ...rest);
    });
    const main = startMain(doc);
    const iso = startIsolated(doc);
    spy.mockRestore();
    const win = doc.defaultView;
    const fire = (type, detail) => node.dispatchEvent(new win.CustomEvent(type, { detail }));
    const good = { n: NONCE, v: CHANNEL_PROTOCOL, id: null, type: 'collect', payload: {} };
    fire(CHANNEL_EVENTS.toMain, JSON.stringify({ ...good, n: 'other' }));
    fire(CHANNEL_EVENTS.toMain, JSON.stringify({ ...good, v: CHANNEL_PROTOCOL + 1 }));
    fire(CHANNEL_EVENTS.toMain, JSON.stringify({ ...good, type: 'nope' }));
    fire(CHANNEL_EVENTS.toMain, JSON.stringify({ ...good, type: 'bind' }));
    fire(CHANNEL_EVENTS.toMain, good); // object, not string
    fire(CHANNEL_EVENTS.toMain, '{not json');
    fire(CHANNEL_EVENTS.toMain, 'null');
    fire(CHANNEL_EVENTS.toIsolated, JSON.stringify({ ...good, type: 'result', n: 'other' }));
    fire(CHANNEL_EVENTS.toIsolated, JSON.stringify({ ...good, type: 'hello', n: null }));
    fire(CHANNEL_EVENTS.toIsolated, { ...good, type: 'result' });
    expect(main.got).toEqual([]);
    expect(iso.got).toEqual([]);
    fire(CHANNEL_EVENTS.toMain, JSON.stringify(good));
    expect(main.got).toHaveLength(1);
  });
});

describe('channel lifecycle', () => {
  it('no handshake within 10 s → channel closes itself and reports unbound', async () => {
    vi.useFakeTimers();
    const { doc } = makeDom();
    const onUnbound = vi.fn();
    const timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (t) => clearTimeout(t) };
    const main = startMain(doc, { onUnbound, ...timers });
    vi.advanceTimersByTime(9999);
    expect(onUnbound).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onUnbound).toHaveBeenCalledTimes(1);
    await expect(main.ch.whenBound).resolves.toBe(false);
    // A late ISOLATED can no longer bind the closed MAIN.
    const iso = startIsolated(doc);
    expect(main.ch.isBound()).toBe(false);
    expect(iso.ch.isBound()).toBe(false);
    expect(main.ch.send('flush', {})).toBe(false);
  });

  it('bound channel does not fire the unbound timeout', () => {
    vi.useFakeTimers();
    const onUnbound = vi.fn();
    const timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (t) => clearTimeout(t) };
    bindBoth('main-first', { onUnbound, ...timers });
    vi.advanceTimersByTime(20000);
    expect(onUnbound).not.toHaveBeenCalled();
  });

  it('close() stops delivery in both directions', () => {
    const { main, iso } = bindBoth();
    main.ch.close();
    expect(main.ch.isBound()).toBe(false);
    expect(main.ch.send('flush', {})).toBe(false);
    iso.ch.send('config', {});
    expect(main.got).toEqual([]);
  });

  it('exception in onMessage does not escape into the dispatcher', () => {
    const { doc } = makeDom();
    connectMain({ doc, onMessage: () => { throw new Error('boom'); } });
    const iso = startIsolated(doc);
    expect(() => iso.ch.send('config', {})).not.toThrow();
  });
});

describe('channel fallback attachNode', () => {
  it('fallback attachNode binds without relatedTarget and leaves documentElement unchanged after handshake', () => {
    const { win, doc } = makeDom();
    const before = doc.documentElement.innerHTML;
    // Simulate relatedTarget not crossing worlds: MAIN sees relatedTarget as null.
    const descr = Object.getOwnPropertyDescriptor(win.MouseEvent.prototype, 'relatedTarget');
    Object.defineProperty(win.MouseEvent.prototype, 'relatedTarget', { configurable: true, get: () => null });
    let main, iso;
    try {
      main = startMain(doc, { attachNode: true });
      iso = startIsolated(doc, { attachNode: true });
    } finally {
      Object.defineProperty(win.MouseEvent.prototype, 'relatedTarget', descr);
    }
    expect(main.ch.isBound()).toBe(true);
    expect(iso.ch.isBound()).toBe(true);
    expect(doc.documentElement.innerHTML).toBe(before);
    iso.ch.send('config', { x: 1 });
    expect(main.got).toHaveLength(1);
  });

  it('fallback attachNode with ISOLATED alone leaves documentElement unchanged', () => {
    const { doc } = makeDom();
    const before = doc.documentElement.innerHTML;
    startIsolated(doc, { attachNode: true });
    expect(doc.documentElement.innerHTML).toBe(before);
  });
});

describe('channel source', () => {
  it('has no chrome.* and no postMessage', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../src/page/channel.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\bchrome\./);
    expect(src).not.toMatch(/postMessage/);
  });
});
