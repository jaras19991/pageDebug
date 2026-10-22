import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';
import { bundle } from '../../scripts/gen-content.mjs';
import { RECORDER_VERSION } from '../../src/page/constants.js';

// E1-T7 (AC-7.1–7.3): the console fallback is the generated bundle of src/page/console-entry.js.
// Each test evaluates the committed bundle in a fresh jsdom window, like pasting it into DevTools.

const root = fileURLToPath(new URL('../../', import.meta.url));
const BUNDLE_FILE = join(root, 'src', 'standalone', 'console-snapshot.js');
const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const HINT = 'Zbieram od teraz. Odtwórz problem i wywołaj PageDebugSnapshot.download().';

let windows = [];

function makePage() {
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
  return { win: dom.window, logs, paste: () => dom.window.eval(read(BUNDLE_FILE)) };
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

  it('snapshot has schemaVersion 2, source console, recordingStartedAt = paste time and a note about earlier data (AC-7.3)', () => {
    const { win, paste } = makePage();
    const pastedAt = Date.now();
    paste();
    win.console.log('after paste', { a: 1 });
    const pkg = win.PageDebugSnapshot.snapshot();
    expect(pkg.schemaVersion).toBe(2);
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

  it('stop() ends recording but keeps the data; start() while recording is a no-op', () => {
    const { win, paste } = makePage();
    paste();
    expect(win.PageDebugSnapshot.start()).toBe(true);
    win.console.warn('one');
    win.PageDebugSnapshot.stop();
    win.console.warn('two');
    expect(win.PageDebugSnapshot.snapshot().consoleLogs.map((r) => r.level)).toEqual(['warn']);
  });

  it('keeps recording past the config timeout (no background, no deadline)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { win, paste } = makePage();
    paste();
    vi.advanceTimersByTime(60 * 60 * 1000);
    win.console.error('late');
    expect(win.PageDebugSnapshot.snapshot().consoleLogs).toHaveLength(1);
  });

  it('pasting again does not install a second set of hooks (marker)', () => {
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
    expect(api.snapshot().consoleLogs.filter((r) => r.level === 'log')).toHaveLength(1); // one hook, one entry
  });

  it('defers to the extension when its recorder is already on the page', () => {
    const { win, logs } = makePage();
    Object.defineProperty(win, Symbol.for('pds.installed'), { value: Object.freeze({ version: RECORDER_VERSION }) });
    win.eval(read(BUNDLE_FILE));
    expect(win.PageDebugSnapshot).toBeUndefined();
    expect(logs).toEqual([{ level: 'info', text: 'Rozszerzenie już nagrywa tę stronę — użyj przycisku „Zapisz paczkę”.' }]);
  });

  it('download() saves the package through <a download> named page-debug-snapshot-<ts>.json', async () => {
    const { win, paste } = makePage();
    paste();
    let blob = null;
    win.URL.createObjectURL = vi.fn((b) => {
      blob = b;
      return 'blob:https://shop.example.test/1';
    });
    win.URL.revokeObjectURL = vi.fn();
    const clicked = [];
    win.HTMLAnchorElement.prototype.click = function click() {
      clicked.push({ href: this.href, download: this.download, attached: this.isConnected });
    };
    const name = win.PageDebugSnapshot.download();
    expect(name).toMatch(/^page-debug-snapshot-\d+\.json$/);
    expect(clicked).toEqual([{ href: 'blob:https://shop.example.test/1', download: name, attached: true }]);
    expect(win.document.querySelectorAll('a[download]')).toHaveLength(0);
    expect(blob.type).toBe('application/json');
    const pkg = JSON.parse(await blob.text());
    expect(pkg).toMatchObject({ schemaVersion: 2, source: 'console' });
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
    const entry = read(join(root, 'src', 'page', 'console-entry.js'));
    expect(entry).not.toMatch(/new Proxy\(|installConsoleHook|chrome\s*\./);
  });
});
