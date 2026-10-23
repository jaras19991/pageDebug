import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createFakeChrome } from './helpers/fake-chrome.js';
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

async function startPage({ reply, order = 'isolated-first' } = {}) {
  const win = makePage();
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

function collect(chrome) {
  let response;
  const results = chrome.runtime.onMessage.dispatch({ type: 'collect' }, FROM_BACKGROUND, (r) => { response = r; });
  return { keepOpen: results.includes(true), response };
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
