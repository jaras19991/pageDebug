import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createFakeChrome } from './helpers/fake-chrome.js';
import { createFakePerformance } from './helpers/fake-performance.js';
import { generateAll, BUNDLES, HEADER } from '../../scripts/gen-content.mjs';
import { collectReachable } from '../../scripts/lib/reachability.mjs';
import { RECORDER_VERSION, PROTOCOL, MARKER_KEY } from '../../src/page/constants.js';

// E1-T15: both generated content scripts evaluated in one jsdom document (the worlds share the
// DOM; the test window doubles as both), with a fake `chrome.runtime` standing in for the background.

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const read = (rel) => readFileSync(`${SRC}${rel}`, 'utf8');
const MAIN = read('content/main-world.js');
const ISOLATED = read('content/isolated-world.js');
const EXT_ID = 'pds-test-id';
const FROM_BACKGROUND = { id: EXT_ID };

const doms = [];
afterEach(() => {
  vi.useRealTimers();
  while (doms.length) doms.pop().window.close();
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle() {
  for (let i = 0; i < 5; i += 1) await tick();
}

function makePage() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><p id="x">hi</p></body></html>', {
    url: 'https://example.test/page',
    runScripts: 'outside-only',
    virtualConsole: new VirtualConsole(),
  });
  doms.push(dom);
  return dom.window;
}

/** reply(msg) answers the bridge's runtime.sendMessage; every message lands in `sent`. */
function attachChrome(win, reply = defaultReply) {
  const { chrome } = createFakeChrome({ extensionId: EXT_ID });
  const sent = [];
  chrome.runtime.sendMessage = async (msg) => {
    sent.push(JSON.parse(JSON.stringify(msg)));
    return reply(msg);
  };
  win.chrome = chrome;
  return { chrome, sent };
}

function defaultReply(msg) {
  if (msg.type === 'hello') return { record: true, docId: 1, token: 'f0e1d2c3b4a5968778695a4b3c2d1e0f', deadline: Date.now() + 600000, limitMs: 600000 };
  return { ok: true };
}

async function startPage({ reply, order = 'isolated-first', perf = false, visibility = null } = {}) {
  const win = makePage();
  if (visibility) {
    Object.defineProperty(win.Document.prototype, 'visibilityState', { configurable: true, get: () => visibility.state });
  }
  if (perf) {
    // jsdom has no PerformanceObserver; the fake one lets the vitals observers run (CLS with no shifts = 0).
    const fake = createFakePerformance();
    win.PerformanceObserver = fake.win.PerformanceObserver;
    win.PerformanceEventTiming = fake.win.PerformanceEventTiming;
  }
  const original = { log: win.console.log, xhr: win.XMLHttpRequest };
  const { chrome, sent } = attachChrome(win, reply);
  if (order === 'isolated-first') {
    win.eval(ISOLATED);
    win.eval(MAIN);
  } else {
    win.eval(MAIN);
    win.eval(ISOLATED);
  }
  await settle();
  return { win, chrome, sent, original };
}

function collect(chrome, extra = {}) {
  let response;
  const results = chrome.runtime.onMessage.dispatch({ type: 'collect', ...extra }, FROM_BACKGROUND, (r) => { response = r; });
  return { keepOpen: results.includes(true), response };
}

function fieldRects(chrome, sender = FROM_BACKGROUND) {
  let response;
  const results = chrome.runtime.onMessage.dispatch({ type: 'fieldRects' }, sender, (r) => { response = r; });
  return { results, response };
}

// jsdom has no layout: every element of `selector` gets the same box.
function stubRect(win, selector, box) {
  for (const el of win.document.querySelectorAll(selector)) {
    el.getBoundingClientRect = () => ({ left: box.x, top: box.y, width: box.w, height: box.h, right: box.x + box.w, bottom: box.y + box.h, x: box.x, y: box.y });
  }
}

describe('MAIN + ISOLATED entries', () => {
  it('hello → config record:true → console.log recorded; collect returns result JSON with docId and protocol', async () => {
    for (const order of ['isolated-first', 'main-first']) {
      const { win, chrome, sent } = await startPage({ order });
      expect(sent[0]).toEqual({ type: 'hello', url: 'https://example.test/page' });
      win.console.log('zapisz mnie');

      const { keepOpen, response } = collect(chrome);
      expect(keepOpen).toBe(true);
      expect(typeof response).toBe('string');
      const result = JSON.parse(response);
      expect(result).toMatchObject({ protocol: PROTOCOL, recorderVersion: RECORDER_VERSION, docId: 1, stopReason: null });
      expect(result.consoleLogs.map((e) => e.args ?? e.message).flat().join(' ')).toContain('zapisz mnie');
      expect(result.consoleLogs[0].doc).toBe(1);
      expect(result.counts.consoleLogs).toBe(1);
      for (const key of ['environment', 'dom', 'performance', 'storage', 'errors', 'network', 'runtimeErrors', 'truncated', 'timeOrigin']) {
        expect(result).toHaveProperty(key);
      }
      expect(result.environment.location.href).toBe('https://example.test/page');
    }
  });

  it('config record:false → hooks removed and no data in collect buffers (AC-3.3)', async () => {
    const { win, chrome, original } = await startPage({ reply: (m) => (m.type === 'hello' ? { record: false, docId: 4 } : null) });
    expect(win.console.log).toBe(original.log);
    expect(win.XMLHttpRequest).toBe(original.xhr);
    win.console.log('nie nagrywaj');
    const result = JSON.parse(collect(chrome).response);
    expect(result.docId).toBe(4);
    expect(result.consoleLogs).toEqual([]);
    expect(result.counts.consoleLogs).toBe(0);
  });

  it('pagehide sends flush with buffers once per document (AC-4.4)', async () => {
    const { win, sent } = await startPage();
    win.console.warn('przed nawigacją');
    win.dispatchEvent(new win.Event('pagehide'));
    await settle();
    const flushes = sent.filter((m) => m.type === 'flush');
    expect(flushes).toHaveLength(1);
    expect(flushes[0].docId).toBe(1);
    expect(flushes[0].data).toMatchObject({ docId: 1, protocol: PROTOCOL });
    expect(flushes[0].data.consoleLogs).toHaveLength(1);
    expect(typeof flushes[0].data.timeOrigin).toBe('number');
  });

  it('flush carries the token from the hello answer; MAIN never sees it (F-2)', async () => {
    const token = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const { win, sent } = await startPage({ reply: (m) => (m.type === 'hello' ? { ...defaultReply(m), token } : { ok: true }) });
    win.console.log('z tokenem');
    win.dispatchEvent(new win.Event('pagehide'));
    await settle();
    const [flush] = sent.filter((m) => m.type === 'flush');
    expect(flush.token).toBe(token);
    expect(JSON.stringify(flush.data)).not.toContain(token);
  });

  // F-2: Firefox drops the pagehide copy of a document left for another site; the beforeunload one arrives.
  it('beforeunload hands the buffers over without cancelling the unload; pagehide adds only what is new', async () => {
    const { win, sent } = await startPage();
    const flushes = () => sent.filter((m) => m.type === 'flush');
    win.console.log('przed przekierowaniem');
    const event = new win.Event('beforeunload', { cancelable: true });
    win.dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(false);
    expect(flushes()).toHaveLength(1);
    expect(flushes()[0].data.consoleLogs).toHaveLength(1);
    win.dispatchEvent(new win.Event('pagehide'));
    await settle();
    expect(flushes()).toHaveLength(1);
    // bfcache: back on the page, a new entry, pagehide again → a fresh copy of the same document.
    win.console.log('po powrocie');
    win.dispatchEvent(new win.Event('pagehide'));
    await settle();
    expect(flushes()).toHaveLength(2);
    expect(flushes()[1]).toMatchObject({ docId: 1 });
    expect(flushes()[1].data.consoleLogs).toHaveLength(2);
  });

  it('no flush when the document is not recorded', async () => {
    const { win, sent } = await startPage({ reply: (m) => (m.type === 'hello' ? { record: false } : null) });
    win.dispatchEvent(new win.Event('pagehide'));
    await settle();
    expect(sent.filter((m) => m.type === 'flush')).toEqual([]);
  });

  it('destroy message restores originals (AC-5.3)', async () => {
    const { win, chrome, original } = await startPage();
    expect(win.console.log).not.toBe(original.log);
    chrome.runtime.onMessage.dispatch({ type: 'destroy' }, FROM_BACKGROUND, () => {});
    expect(win.console.log).toBe(original.log);
    expect(win.XMLHttpRequest).toBe(original.xhr);
    expect(chrome.runtime.onMessage.hasListeners()).toBe(false);
  });

  // E2-T9b: the background's `{ type: 'stop', reason: 'time-limit' }` (T11) reaches MAIN through the bridge.
  it('background stop message reaches MAIN and stops hooks (console native again), buffers kept (AC-2.2)', async () => {
    const { win, chrome, sent, original } = await startPage();
    win.console.log('przed limitem');
    expect(win.console.log).not.toBe(original.log);
    const results = chrome.runtime.onMessage.dispatch({ type: 'stop', reason: 'time-limit' }, FROM_BACKGROUND, () => {});
    expect(results).toEqual([false]);
    expect(win.console.log).toBe(original.log);
    expect(win.XMLHttpRequest).toBe(original.xhr);
    win.console.log('po limicie');
    await settle();
    expect(sent).toContainEqual({ type: 'stopped', reason: 'time-limit' });
    const result = JSON.parse(collect(chrome).response);
    expect(result.stopReason).toBe('time-limit');
    expect(result.consoleLogs).toHaveLength(1);
    expect(JSON.stringify(result.consoleLogs)).toContain('przed limitem');
    // Idempotent: a second stop changes nothing and sends no second `stopped`.
    chrome.runtime.onMessage.dispatch({ type: 'stop', reason: 'time-limit' }, FROM_BACKGROUND, () => {});
    await settle();
    expect(sent.filter((m) => m.type === 'stopped')).toHaveLength(1);
  });

  it('stop with another reason stops as user', async () => {
    const { chrome } = await startPage();
    chrome.runtime.onMessage.dispatch({ type: 'stop', reason: '<script>' }, FROM_BACKGROUND, () => {});
    expect(JSON.parse(collect(chrome).response).stopReason).toBe('user');
  });

  it('stop from page-forged event is ignored (nonce; AC-5.6 E1)', async () => {
    const { win, chrome, original } = await startPage();
    const forged = JSON.stringify({ n: null, v: 1, id: null, type: 'stop', payload: { reason: 'time-limit' } });
    for (const target of [win.document, win, win.document.documentElement]) {
      target.dispatchEvent(new win.CustomEvent('pds:i2m', { detail: forged, bubbles: true }));
    }
    // A forged isolated-ready with the page's own node cannot rebind MAIN either.
    const node = win.document.createElement('div');
    win.document.dispatchEvent(new win.MouseEvent('pds:isolated-ready', { relatedTarget: node }));
    node.dispatchEvent(new win.CustomEvent('pds:i2m', { detail: forged }));
    expect(win.console.log).not.toBe(original.log);
    win.console.log('dalej nagrywam');
    const result = JSON.parse(collect(chrome).response);
    expect(result.stopReason).toBeNull();
    expect(result.consoleLogs).toHaveLength(1);
  });

  it('isolated ignores stop from a tab sender', async () => {
    const { win, chrome, original } = await startPage();
    const results = chrome.runtime.onMessage.dispatch({ type: 'stop', reason: 'time-limit' }, { id: EXT_ID, tab: { id: 1 } }, () => {});
    expect(results).toEqual([false]);
    expect(win.console.log).not.toBe(original.log);
    expect(JSON.parse(collect(chrome).response).stopReason).toBeNull();
  });

  it('flush payload marks vitals finalized, collect while visible does not (AC-5.6)', async () => {
    const { win, chrome, sent } = await startPage({ perf: true });
    const visible = JSON.parse(collect(chrome).response);
    expect(visible.vitals.CLS).toMatchObject({ available: true, value: 0, finalized: false });
    win.console.log('przed wyjściem');
    win.dispatchEvent(new win.Event('pagehide'));
    await settle();
    const [flush] = sent.filter((m) => m.type === 'flush');
    expect(flush.data.vitals.CLS).toMatchObject({ available: true, finalized: true });
  });

  it('collect on a hidden page marks vitals finalized', async () => {
    // MAIN reads visibilityState through the getter captured at document_start, so the test controls it from before the boot.
    const visibility = { state: 'visible' };
    const { chrome } = await startPage({ perf: true, visibility });
    expect(JSON.parse(collect(chrome).response).vitals.CLS.finalized).toBe(false);
    visibility.state = 'hidden';
    expect(JSON.parse(collect(chrome).response).vitals.CLS.finalized).toBe(true);
  });

  it('collect result has protocol 3, steps, vitals, documentStatus', async () => {
    const { win, chrome } = await startPage({ perf: true });
    win.history.pushState({}, '', '/page/next');
    const result = JSON.parse(collect(chrome).response);
    expect(PROTOCOL).toBe(3);
    expect(result.protocol).toBe(3);
    // The document's own load is the first step, the pushState the second.
    expect(result.steps).toEqual([
      expect.objectContaining({ type: 'navigate', doc: 1, via: 'navigate' }),
      expect.objectContaining({ type: 'navigate', doc: 1, via: 'pushState', url: 'https://example.test/page/next' }),
    ]);
    expect(result.counts.steps).toBe(2);
    expect(result.vitals).toEqual(expect.objectContaining({ TTFB: expect.any(Object), CLS: expect.any(Object), INP: expect.any(Object) }));
    expect(result).toHaveProperty('documentStatus');
    expect(result.truncated).toHaveProperty('responseBodies', false);
  });

  // ---- E3-T8: fieldRects (D6), collect options, protocol 3 ----

  it('fieldRects from background answered by ISOLATED without MAIN; from a tab sender ignored (D6)', async () => {
    const win = makePage();
    win.document.body.insertAdjacentHTML('beforeend', '<input id="mail" type="email"><button id="b">OK</button>');
    stubRect(win, '#mail, #b', { x: 10, y: 20, w: 200, h: 30 });
    const { chrome } = attachChrome(win);
    win.eval(ISOLATED); // no MAIN world at all
    await settle();
    const fromTab = fieldRects(chrome, { id: EXT_ID, tab: { id: 1 } });
    expect(fromTab.results).toEqual([false]);
    expect(fromTab.response).toBeUndefined();
    const { response } = fieldRects(chrome);
    expect(response).toMatchObject({
      ok: true,
      viewport: { innerWidth: win.innerWidth, innerHeight: win.innerHeight, scrollX: 0, scrollY: 0, dpr: 1, vvScale: 1 },
      frames: { sameOrigin: 0, crossOrigin: 0 },
      overflow: false,
    });
    expect(response.rects).toEqual([{ x: 10, y: 20, w: 200, h: 30 }]);
  });

  it('fieldRects reaches a closed shadow root through chrome.dom.openOrClosedShadowRoot (S0)', async () => {
    const win = makePage();
    const host = win.document.createElement('div');
    win.document.body.append(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = '<textarea></textarea>';
    shadow.querySelector('textarea').getBoundingClientRect = () => ({ left: 5, top: 6, width: 50, height: 40, right: 55, bottom: 46, x: 5, y: 6 });
    const { chrome } = attachChrome(win);
    const seen = [];
    chrome.dom = { openOrClosedShadowRoot: (el) => { seen.push(el); return el === host ? shadow : null; } };
    win.eval(ISOLATED);
    await settle();
    const { response } = fieldRects(chrome);
    expect(seen).toContain(host);
    expect(response.ok).toBe(true);
    expect(response.rects).toEqual([{ x: 5, y: 6, w: 50, h: 40 }]);
  });

  it('collect with fullHtml option reaches collector; without → fullHtml null', async () => {
    const { chrome } = await startPage();
    expect(JSON.parse(collect(chrome).response).dom.fullHtml).toBeNull();
    expect(JSON.parse(collect(chrome, { options: { fullHtml: 'yes' } }).response).dom.fullHtml).toBeNull();
    const full = JSON.parse(collect(chrome, { options: { fullHtml: true } }).response).dom.fullHtml;
    expect(typeof full).toBe('string');
    expect(full).toContain('<p id="x">hi</p>');
  });

  it('collect result protocol 3 has dom.structure and no outerHTML; console element as structure (D5)', async () => {
    const { win, chrome } = await startPage();
    win.document.body.insertAdjacentHTML('beforeend', '<form id="f"><input name="mail" type="email"><input name="up" type="file"></form>');
    win.document.querySelector('[name="mail"]').value = 'jan.kowalski@example.com';
    win.console.log(win.document.getElementById('x'));
    const raw = collect(chrome).response;
    const result = JSON.parse(raw);
    expect(result.protocol).toBe(3);
    expect(result.dom.structure).toContain('<p id="x"></p>');
    expect(result.dom.html).not.toHaveProperty('outerHTML');
    expect(raw).not.toContain('outerHTML');
    expect(raw).not.toContain('jan.kowalski@example.com');
    const fields = Object.fromEntries(result.dom.forms[0].elements.map((e) => [e.name, e]));
    expect(fields.mail.valueLength).toBe('jan.kowalski@example.com'.length);
    expect(fields.up).toMatchObject({ fileCount: 0 });
    expect(fields.up).not.toHaveProperty('valueLength');
    expect(result.consoleLogs[0].args[0]).toEqual({ tagName: 'P', id: 'x', className: '', structure: '<p id="x"></p>' });
  });

  it('page-forged collect with wrong nonce ignored (E1 D3)', async () => {
    const { win, chrome } = await startPage();
    let reads = 0;
    Object.defineProperty(win.navigator, 'userAgent', { configurable: true, get: () => { reads++; return 'UA'; } });
    const m2i = [];
    win.document.addEventListener('pds:m2i', (e) => m2i.push(e.detail), true);
    for (const n of [null, 'zgadniety-nonce']) {
      const forged = JSON.stringify({ n, v: 1, id: 'c1', type: 'collect', payload: { options: { fullHtml: true } } });
      for (const target of [win.document, win, win.document.documentElement]) {
        target.dispatchEvent(new win.CustomEvent('pds:i2m', { detail: forged, bubbles: true }));
      }
    }
    await settle();
    expect(reads).toBe(0);
    expect(m2i).toEqual([]);
    // Control: the same read happens on a real collect from the background.
    collect(chrome);
    expect(reads).toBeGreaterThan(0);
  });

  it('second evaluation of main bundle in the same window is a no-op (AC-5.5)', async () => {
    const { win, chrome } = await startPage();
    const wrapped = win.console.log;
    win.eval(MAIN);
    await settle();
    expect(win.console.log).toBe(wrapped);
    win.console.log('raz');
    expect(JSON.parse(collect(chrome).response).consoleLogs).toHaveLength(1);
    expect(win[Symbol.for(MARKER_KEY)]).toEqual({ version: RECORDER_VERSION });
  });

  it('time limit already passed at config → stopped goes to the background', async () => {
    const { sent } = await startPage({
      reply: (m) => (m.type === 'hello' ? { record: true, docId: 2, deadline: Date.now() - 1, limitMs: 1000 } : null),
    });
    expect(sent).toContainEqual({ type: 'stopped', reason: 'time-limit' });
  });

  it('collect ignores messages that are not from the background', async () => {
    const { chrome } = await startPage();
    const results = chrome.runtime.onMessage.dispatch({ type: 'collect' }, { id: EXT_ID, tab: { id: 1 } }, () => {});
    expect(results).toEqual([false]);
  });

  it('no MAIN world in 2 s → bridgeError unbound after hello', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const win = makePage();
    const { sent } = attachChrome(win);
    win.eval(ISOLATED);
    await vi.advanceTimersByTimeAsync(2100);
    expect(sent).toEqual([
      { type: 'hello', url: 'https://example.test/page' },
      { type: 'bridgeError', reason: 'unbound', docId: 1 },
    ]);
  });

  it('missing or invalidated chrome.runtime → bridge stays silent', () => {
    const win = makePage();
    expect(() => win.eval(ISOLATED)).not.toThrow();
    const { chrome, sent } = attachChrome(makePage());
    delete chrome.runtime.id;
    const page = doms.at(-1).window;
    page.eval(ISOLATED);
    expect(sent).toEqual([]);
    expect(chrome.runtime.onMessage.hasListeners()).toBe(false);
  });
});

describe('generated content bundles', () => {
  const ours = BUNDLES.filter((b) => b.out.startsWith('content/'));

  it('generated bundles are up to date and carry the GENERATED header', async () => {
    expect(ours.map((b) => b.out)).toEqual(['content/main-world.js', 'content/isolated-world.js']);
    for (const { out } of ours) expect(read(out).startsWith(`${HEADER}\n`)).toBe(true);
    const { stale } = await generateAll({ check: true });
    expect(stale.filter((f) => f.startsWith('content/'))).toEqual([]);
  });

  it('main bundle source contains no chrome. (E1-R1)', () => {
    expect(MAIN).not.toMatch(/\bchrome\s*\.\s*[A-Za-z_$]/);
    expect(MAIN).not.toMatch(/\bbrowser\s*\.\s*runtime/);
  });

  it('bundles contain nothing the build walker refuses (also in comments)', async () => {
    for (const code of [MAIN, ISOLATED]) {
      expect(code).not.toMatch(/(?<![\w$.])url\(|getURL\s*\(|importScripts\s*\(|\bimport\s*\(/);
    }
    const manifest = { content_scripts: [{ matches: ['https://x/*'], js: ['content/main-world.js', 'content/isolated-world.js'] }] };
    expect(await collectReachable(SRC, { manifest })).toEqual(['content/isolated-world.js', 'content/main-world.js']);
  });

  it('both bundles are classic scripts that leave no globals except the marker', () => {
    for (const code of [MAIN, ISOLATED]) expect(() => new vm.Script(code)).not.toThrow();
    const win = makePage();
    const own = () => [...Object.getOwnPropertyNames(win), ...Object.getOwnPropertySymbols(win)];
    const before = new Set(own());
    win.eval(MAIN);
    win.eval(ISOLATED);
    expect(own().filter((k) => !before.has(k))).toEqual([Symbol.for(MARKER_KEY)]);
  });
});
