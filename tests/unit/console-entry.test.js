import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';
import { unzipSync } from 'fflate';
import { bundle } from '../../scripts/gen-content.mjs';
import { RECORDER_VERSION } from '../../src/page/constants.js';
import { assertValidSnapshot, validateZipEntries, REQUIRED_KEYS } from '../helpers/snapshot-validator.js';
import { JWT, TOKEN, PASSWORD, COOKIE_SID, leaks } from './helpers/redaction-traps.js';
import { createFakePerformance } from './helpers/fake-performance.js';

// E1-T7 (AC-7.1–7.3), E3-T9 (AC-3.7, question 5): the console fallback is the generated bundle of src/page/console-entry.js.
// Each test evaluates the committed bundle in a fresh jsdom window, like pasting it into DevTools. jsdom has no
// CompressionStream: `compress: true` lends Node's one to the window (browsers have it), otherwise the zip is stored.

const root = fileURLToPath(new URL('../../', import.meta.url));
const BUNDLE_FILE = join(root, 'src', 'standalone', 'console-snapshot.js');
const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
// Not the shared EMAIL trap: its domain (example.com) shares 8-character fragments with the page host (shop.example.test).
const EMAIL = 'jan.trap@poczta-pulapka.pl';
const HINT = 'Zbieram od teraz. Odtwórz problem i wywołaj PageDebugSnapshot.download().';

let windows = [];

function makePage({ perf = null, compress = true } = {}) {
  const virtualConsole = new VirtualConsole();
  const logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    virtualConsole.on(level, (...args) => logs.push({ level, text: args.map(String).join(' ') }));
  }
  const dom = new JSDOM('<!doctype html><html><head><title>T</title></head><body><p id="x">x</p></body></html>', {
    url: 'https://shop.example.test/cart',
    runScripts: 'outside-only',
    virtualConsole,
  });
  windows.push(dom.window);
  if (compress) dom.window.CompressionStream = CompressionStream;
  if (perf) {
    // jsdom has no PerformanceObserver; the fake one feeds the vitals observers (fake-performance.js).
    dom.window.PerformanceObserver = perf.win.PerformanceObserver;
    dom.window.PerformanceEventTiming = perf.win.PerformanceEventTiming;
  }
  return { win: dom.window, logs, paste: () => dom.window.eval(read(BUNDLE_FILE)) };
}

// Replaces the browser download: returns what <a download> got (the blob and the click).
function captureDownload(win) {
  const got = { blob: null, clicked: [] };
  win.URL.createObjectURL = vi.fn((b) => {
    got.blob = b;
    return 'blob:https://shop.example.test/1';
  });
  win.URL.revokeObjectURL = vi.fn();
  win.HTMLAnchorElement.prototype.click = function click() {
    got.clicked.push({ href: this.href, download: this.download, attached: this.isConnected });
  };
  return got;
}

async function unzipBlob(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const files = unzipSync(bytes);
  const text = Object.fromEntries(Object.entries(files).map(([n, b]) => [n, new TextDecoder().decode(b)]));
  // Method of the first entry: bytes 8–9 of its local header (8 = deflate, 0 = stored).
  return { bytes, names: Object.keys(files), text, json: JSON.parse(text['snapshot.json']), method: bytes[8] | (bytes[9] << 8) };
}

afterEach(() => {
  for (const win of windows) win.close();
  windows = [];
  vi.useRealTimers();
});

describe('console-snapshot.js (generated from src/page/console-entry.js)', () => {
  it('pasting sets one global with the API and prints the exact Polish hint (AC-7.2)', () => {
    const { win, logs, paste } = makePage();
    const before = new Set(Object.getOwnPropertyNames(win));
    paste();
    const added = Object.getOwnPropertyNames(win).filter((n) => !before.has(n));
    expect(added).toEqual(['PageDebugSnapshot']);
    const api = win.PageDebugSnapshot;
    expect(api.version).toBe(RECORDER_VERSION);
    for (const name of ['start', 'stop', 'download', 'snapshot']) expect(typeof api[name], name).toBe('function');
    expect(logs).toEqual([{ level: 'info', text: HINT }]);
  });

  it('snapshot has schemaVersion 4, source console, recordingStartedAt = paste time and a note about earlier data (AC-7.3)', async () => {
    const { win, paste } = makePage();
    const pastedAt = Date.now();
    paste();
    win.console.log('after paste', { a: 1 });
    const pkg = await win.PageDebugSnapshot.snapshot();
    expect(pkg.schemaVersion).toBe(4);
    expect(pkg.source).toBe('console');
    expect(pkg.extensionVersion).toBe(RECORDER_VERSION);
    const started = Date.parse(pkg.recordingStartedAt);
    expect(started).toBeGreaterThanOrEqual(pastedAt - 1000);
    expect(started).toBeLessThanOrEqual(Date.now());
    expect(pkg.recordingStoppedReason).toBeNull();
    expect(pkg.documents).toHaveLength(1);
    expect(pkg.documents[0]).toMatchObject({ current: true, url: 'https://shop.example.test/cart' });
    expect(pkg.notes[0]).toMatch(/pasted.*earlier data is not included/);
    expect(pkg.consoleLogs.map((r) => r.level)).toEqual(['log']); // the hint itself is not recorded
    expect(pkg.consoleLogs[0]).toMatchObject({ doc: 0 });
    expect(pkg.environment).not.toBeNull();
    expect(pkg.dom).not.toBeNull();
  });

  it('stop() ends recording but keeps the data; start() while recording is a no-op', async () => {
    const { win, paste } = makePage();
    paste();
    expect(win.PageDebugSnapshot.start()).toBe(true);
    win.console.warn('one');
    win.PageDebugSnapshot.stop();
    win.console.warn('two');
    expect((await win.PageDebugSnapshot.snapshot()).consoleLogs.map((r) => r.level)).toEqual(['warn']);
  });

  it('keeps recording past the config timeout (no background, no deadline)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { win, paste } = makePage();
    paste();
    vi.advanceTimersByTime(60 * 60 * 1000);
    win.console.error('late');
    expect((await win.PageDebugSnapshot.snapshot()).consoleLogs).toHaveLength(1);
  });

  it('pasting again does not install a second set of hooks (marker)', async () => {
    const { win, logs, paste } = makePage();
    paste();
    const api = win.PageDebugSnapshot;
    const hookedLog = win.console.log;
    paste();
    expect(win.PageDebugSnapshot).toBe(api);
    expect(win.console.log).toBe(hookedLog);
    expect(logs[1].level).toBe('info');
    expect(logs[1].text).toMatch(/już działa/);
    win.console.log('once');
    expect((await api.snapshot()).consoleLogs.filter((r) => r.level === 'log')).toHaveLength(1); // one hook, one entry
  });

  it('defers to the extension when its recorder is already on the page', () => {
    const { win, logs } = makePage();
    Object.defineProperty(win, Symbol.for('pds.installed'), { value: Object.freeze({ version: RECORDER_VERSION }) });
    win.eval(read(BUNDLE_FILE));
    expect(win.PageDebugSnapshot).toBeUndefined();
    expect(logs).toEqual([{ level: 'info', text: 'Rozszerzenie już nagrywa tę stronę — użyj przycisku „Zapisz paczkę”.' }]);
  });
});

// E3-T9 (question 5, AC-3.7): the same .zip and the same redaction as the extension, without a screenshot.
describe('console-snapshot.js zip and redaction (E3-T9)', () => {
  it('console download produces snapshot-<host>-<time>.zip with snapshot.json + summary.md, no screenshot (question 5)', async () => {
    const { win, paste } = makePage();
    paste();
    win.console.error('boom');
    const got = captureDownload(win);
    const pending = win.PageDebugSnapshot.download();
    expect(typeof pending.then).toBe('function');
    const name = await pending;
    expect(name).toMatch(/^snapshot-shop\.example\.test-\d{8}-\d{6}\.zip$/);
    expect(got.clicked).toEqual([{ href: 'blob:https://shop.example.test/1', download: name, attached: true }]);
    expect(win.document.querySelectorAll('a[download]')).toHaveLength(0);
    expect(got.blob.type).toBe('application/zip');
    const { names, json, text, method } = await unzipBlob(got.blob);
    expect(names).toEqual(['snapshot.json', 'summary.md']);
    expect(validateZipEntries(names, json).errors).toEqual([]);
    expect(method).toBe(8); // deflate: the page realm has CompressionStream
    expect(json).toMatchObject({ schemaVersion: 4, source: 'console', screenshots: [] });
    expect(json.notes).not.toContain('The package is not compressed (this browser cannot compress).');
    expect(text['summary.md']).toMatch(/\S/);
    assertValidSnapshot(json);
  });

  it('no CompressionStream in the page → stored zip that opens, with a note', async () => {
    const { win, paste } = makePage({ compress: false });
    paste();
    const got = captureDownload(win);
    await win.PageDebugSnapshot.download();
    const { names, json, method } = await unzipBlob(got.blob);
    expect(names).toEqual(['snapshot.json', 'summary.md']);
    expect(method).toBe(0);
    expect(json.notes).toContain('The package is not compressed (this browser cannot compress).');
    assertValidSnapshot(json);
  });

  it('console package redacted: trap values absent, validator v4 passes (AC-3.7 unit)', async () => {
    const { win, paste } = makePage();
    win.localStorage.setItem('authToken', TOKEN);
    win.localStorage.setItem('contact', EMAIL);
    win.document.cookie = `sid=${COOKIE_SID}`;
    win.document.body.insertAdjacentHTML('beforeend', `<div id="who" data-user="${EMAIL}" data-session="${JWT}"></div>`);
    paste();
    win.console.log(`session ${JWT}`, { password: PASSWORD, user: EMAIL, token: TOKEN });
    win.console.error(new Error(`login failed for ${EMAIL} token=${TOKEN}`));
    const got = captureDownload(win);
    await win.PageDebugSnapshot.download();
    const { text, json } = await unzipBlob(got.blob);
    assertValidSnapshot(json);
    for (const [entry, content] of Object.entries(text)) {
      for (const secret of [JWT, TOKEN, EMAIL, PASSWORD, COOKIE_SID]) expect(leaks(secret, content), `${entry}: ${secret}`).toEqual([]);
    }
    expect(json.storage.localStorage.authToken).toMatch(/^\[redacted:/);
    const masked = Object.values(json.redaction.masked).reduce((a, b) => a + b, 0);
    expect(masked).toBeGreaterThan(0);
    expect(masked).toBe(text['snapshot.json'].split('[redacted:').length - 1);
  });

  it('snapshot() returns the redacted object that download() writes', async () => {
    const { win, paste } = makePage();
    paste();
    win.console.log({ password: PASSWORD, user: EMAIL });
    const pkg = await win.PageDebugSnapshot.snapshot();
    const json = JSON.stringify(pkg);
    for (const secret of [PASSWORD, EMAIL]) expect(leaks(secret, json)).toEqual([]);
    expect(pkg.redaction).toMatchObject({ rulesVersion: 1, disabledRules: [] });
    expect(json).toContain('[redacted:');
    assertValidSnapshot(JSON.parse(json));
  });
});

// E2-T7b (AC-7.5, AC-7.1, AC-5.8): the console package is a full v4 package; what needs the extension is empty with a note.
describe('console-snapshot.js package v4 (E2-T7b, E3-T9)', () => {
  const INP_NOTE = 'INP covers only interactions after the script was pasted.';
  const SHOT_NOTE = 'Screenshots are not available without the extension.';

  it('console package has every required v4 key and passes validator (AC-7.5, AC-7.1)', async () => {
    const { win, paste } = makePage();
    paste();
    win.console.error('boom');
    const pkg = JSON.parse(JSON.stringify(await win.PageDebugSnapshot.snapshot()));
    expect(Object.keys(pkg)).toEqual([...REQUIRED_KEYS]);
    assertValidSnapshot(pkg);
    expect(pkg.overview).toMatchObject({ consoleErrors: 1, screenshot: false });
    expect(pkg.documents[0]).toMatchObject({ current: true, recorded: true, flushed: true });
  });

  it('screenshots [] with note, no attachments (AC-7.5, question 5)', async () => {
    const { win, paste } = makePage();
    paste();
    const pkg = await win.PageDebugSnapshot.snapshot();
    expect(pkg.screenshots).toEqual([]);
    expect('attachments' in pkg).toBe(false);
    expect(pkg.notes).toContain(SHOT_NOTE);
    expect(pkg.notes.filter((n) => /screenshot/i.test(n))).toEqual([SHOT_NOTE]);
  });

  it('vitals present from buffered entries; INP only after paste with note (AC-5.8)', async () => {
    const fake = createFakePerformance();
    // Before the paste: FCP/LCP in the buffer and an interaction the console fallback must not count.
    fake.buffer('paint', [{ name: 'first-contentful-paint', startTime: 0.5 }]);
    fake.buffer('largest-contentful-paint', [{ startTime: 0.7, url: '', element: null }]);
    fake.buffer('event', [{ name: 'click', interactionId: 7, startTime: 0.1, duration: 900, processingStart: 0.2, processingEnd: 0.3 }]);
    const { win, paste } = makePage({ perf: fake });
    paste();
    let pkg = await win.PageDebugSnapshot.snapshot();
    assertValidSnapshot(pkg);
    expect(pkg.vitals).toHaveLength(1);
    expect(pkg.vitals[0]).toMatchObject({ doc: 0, FCP: { available: true, value: 0.5 }, LCP: { available: true, value: 0.7 } });
    expect(pkg.vitals[0].INP).toMatchObject({ available: false, reason: 'no-interaction' });
    expect(pkg.notes).toContain(INP_NOTE);

    const at = win.performance.now() + 5;
    fake.emit('event', [{ name: 'keydown', interactionId: 8, startTime: at, duration: 120, processingStart: at + 1, processingEnd: at + 2 }]);
    pkg = await win.PageDebugSnapshot.snapshot();
    assertValidSnapshot(pkg);
    expect(pkg.vitals[0].INP).toMatchObject({ available: true, value: 120 });
    expect(pkg.notes.filter((n) => n === INP_NOTE)).toHaveLength(1);
  });

  it('steps recorded after paste', async () => {
    const { win, paste } = makePage();
    win.document.body.insertAdjacentHTML('beforeend', '<form id="f"><button>OK</button></form>');
    const form = win.document.getElementById('f');
    form.addEventListener('submit', (e) => e.preventDefault());
    form.requestSubmit(); // before the paste: not recorded
    paste();
    form.requestSubmit(); // jsdom marks a requestSubmit() submit event trusted
    const pkg = await win.PageDebugSnapshot.snapshot();
    assertValidSnapshot(pkg);
    const submits = pkg.steps.filter((s) => s.type === 'submit');
    expect(submits).toHaveLength(1); // the one before the paste is not in the package
    expect(submits[0]).toMatchObject({ doc: 0, selector: '#f' });
    expect(pkg.overview.steps).toBe(pkg.steps.length);
    expect(pkg.notes).not.toContain('No user steps were recorded.');
  });
});

describe('console-snapshot.js bundle (AC-7.1)', () => {
  it('equals the generator output', () => {
    const fresh = bundle({ entry: 'page/console-entry.js', srcDir: join(root, 'src') });
    expect(read(BUNDLE_FILE)).toBe(fresh);
  });

  it('is a classic script without chrome.* and without a hand-copied hook', () => {
    const code = read(BUNDLE_FILE);
    expect(() => new vm.Script(code)).not.toThrow();
    expect(code.startsWith('// GENERATED by scripts/gen-content.mjs')).toBe(true);
    expect(code).not.toMatch(/\bchrome\s*\.\s*[A-Za-z_$]/);
    expect(code.match(/function installConsoleHook\b/g)).toHaveLength(1);
    expect(code).toContain('// module: page/hooks-console.js');
    expect(code).toContain('// module: lib/package.js');
    for (const lib of ['export', 'redact', 'budget', 'summary', 'zip', 'file-name']) expect(code).toContain(`// module: lib/${lib}.js`);
    const entry = read(join(root, 'src', 'page', 'console-entry.js'));
    expect(entry).not.toMatch(/new Proxy\(|installConsoleHook|chrome\s*\./);
  });
});
