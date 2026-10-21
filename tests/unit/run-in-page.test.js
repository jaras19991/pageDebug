import { afterEach, describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { runInPage } from '../../src/popup/run-in-page.js';

const FILE_NAME_RE = /^page-debug-snapshot-\d+\.json$/;

// Minimal stand-in for window.PageDebugSnapshot with the members runInPage touches.
function fakePds({ initialized = false, downloadThrows = false } = {}) {
  return {
    initialized,
    config: { fileNamePrefix: 'page-debug-snapshot' },
    initCalls: [],
    downloadCalls: [],
    init(cfg) {
      this.initCalls.push(cfg);
      this.initialized = true;
    },
    download(name) {
      this.downloadCalls.push(name);
      if (downloadThrows) throw new TypeError('boom');
      return {};
    },
  };
}

function withWindow(win) {
  vi.stubGlobal('window', win);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runInPage', () => {
  it('runInPage returns not-loaded when PageDebugSnapshot missing', () => {
    withWindow({});
    expect(runInPage()).toEqual({ ok: false, reason: 'not-loaded' });
  });

  it('runInPage inits once without floating button and returns fileName', () => {
    const pds = fakePds();
    withWindow({ PageDebugSnapshot: pds });

    const result = runInPage();

    expect(result.ok).toBe(true);
    expect(result.fileName).toMatch(FILE_NAME_RE);
    expect(pds.initCalls).toHaveLength(1);
    expect(pds.initCalls[0]).toMatchObject({ createFloatingButton: false });
    expect(pds.downloadCalls).toEqual([result.fileName]);
    expect(Object.keys(result).sort()).toEqual(['fileName', 'ok']);
  });

  it('runInPage does not re-init when initialized', () => {
    const pds = fakePds({ initialized: true });
    withWindow({ PageDebugSnapshot: pds });

    const result = runInPage();

    expect(result.ok).toBe(true);
    expect(pds.initCalls).toHaveLength(0);
    expect(pds.downloadCalls).toHaveLength(1);
  });

  it('runInPage returns snapshot-failed when download throws', () => {
    const pds = fakePds({ downloadThrows: true });
    withWindow({ PageDebugSnapshot: pds });

    let result;
    expect(() => {
      result = runInPage();
    }).not.toThrow();
    expect(result).toEqual({ ok: false, reason: 'snapshot-failed', errorName: 'TypeError' });
  });

  it('runInPage returns snapshot-failed when init throws', () => {
    const pds = fakePds();
    pds.init = () => {
      throw new RangeError('nope');
    };
    withWindow({ PageDebugSnapshot: pds });

    expect(runInPage()).toEqual({ ok: false, reason: 'snapshot-failed', errorName: 'RangeError' });
  });

  it('runInPage result is plain JSON', () => {
    withWindow({ PageDebugSnapshot: fakePds() });
    const result = runInPage();
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('runInPage is self-contained', () => {
    // Simulates executeScript({ func }) serialisation: only the source text crosses over,
    // evaluated in a fresh context with nothing but `window`.
    const source = runInPage.toString();
    const run = (win) => vm.runInNewContext(`(${source})()`, { window: win });

    expect(run({})).toEqual({ ok: false, reason: 'not-loaded' });

    const pds = fakePds();
    const result = run({ PageDebugSnapshot: pds });
    expect(result.ok).toBe(true);
    expect(result.fileName).toMatch(FILE_NAME_RE);
    expect(pds.downloadCalls).toEqual([result.fileName]);

    const failing = run({ PageDebugSnapshot: fakePds({ downloadThrows: true }) });
    expect(failing).toMatchObject({ ok: false, reason: 'snapshot-failed' });
  });

  it('runInPage does not touch chrome.*', () => {
    expect(runInPage.toString()).not.toMatch(/\bchrome\b|\bbrowser\b/);
  });
});
