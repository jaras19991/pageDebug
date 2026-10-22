import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assemblePackage, packageFileName, DEFAULT_LIMITS } from '../../src/lib/package.js';

const fixtureUrl = new URL('../fixtures/snapshots/v2.json', import.meta.url);

const STARTED = Date.UTC(2026, 0, 15, 10, 0, 0);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function meta(over = {}) {
  return {
    extensionVersion: '0.3.0',
    source: 'extension',
    startedAt: STARTED,
    collectedAt: STARTED + 60_000,
    stopReason: null,
    ...over,
  };
}

function log(t, marker) {
  return { t, level: 'log', args: [marker], stack: 'at marker (http://127.0.0.1:8080/a.js:1:1)' };
}

function buffers({ logs = [], errors = [], network = [], truncated = {}, counts } = {}) {
  return {
    consoleLogs: logs,
    runtimeErrors: errors,
    network,
    truncated: { consoleLogs: false, runtimeErrors: false, network: false, ...truncated },
    counts: counts ?? { consoleLogs: logs.length, runtimeErrors: errors.length, network: network.length },
  };
}

function current(over = {}) {
  return {
    protocol: 1,
    recorderVersion: '0.3.0',
    docId: 2,
    url: 'http://127.0.0.1:8080/form.html',
    timeOrigin: STARTED + 30_000.5,
    navigationType: 'navigate',
    stopReason: null,
    environment: { location: { href: 'http://127.0.0.1:8080/form.html' } },
    dom: { counts: { totalElements: 3 } },
    performance: { timeOrigin: STARTED + 30_000.5, navigation: null, resources: [] },
    storage: { cookies: '', localStorage: {}, sessionStorage: {} },
    ...buffers({
      logs: [log(5, 'cur-b'), log(2, 'cur-a')],
      errors: [{ t: 3, type: 'error', message: 'boom', filename: 'http://127.0.0.1:8080/form.html', lineno: 1, colno: 2, stack: 'Error: boom' }],
      network: [{ t: 4, type: 'fetch', method: 'POST', url: 'http://127.0.0.1:8080/api/fail', status: 500, statusText: 'Internal Server Error', ok: false, redirected: false, durationMs: 1.5, requestHeaders: {}, responseHeaders: {}, requestBody: '{"a":1}', error: null }],
    }),
    ...over,
  };
}

function prior(over = {}) {
  return {
    docId: 1,
    url: 'http://127.0.0.1:8080/index.html',
    timeOrigin: STARTED + 100.25,
    navigationType: 'reload',
    buffers: buffers({ logs: [log(7, 'prior-b'), log(1, 'prior-a')] }),
    ...over,
  };
}

describe('assemblePackage', () => {
  it('header has schemaVersion 2, extensionVersion, source, collectedAt and recordingStartedAt as ISO, numeric timeOrigin', () => {
    // AC-4.5
    const pkg = assemblePackage({ meta: meta(), current: current(), priorDocs: [] });
    expect(pkg.schemaVersion).toBe(2);
    expect(pkg.extensionVersion).toBe('0.3.0');
    expect(pkg.source).toBe('extension');
    expect(pkg.collectedAt).toMatch(ISO);
    expect(pkg.recordingStartedAt).toMatch(ISO);
    expect(pkg.recordingStartedAt).toBe(new Date(STARTED).toISOString());
    expect(typeof pkg.timeOrigin).toBe('number');
    expect(pkg.timeOrigin).toBe(STARTED + 30_000.5);
    expect(pkg).not.toHaveProperty('version');
    expect(pkg).not.toHaveProperty('initializedAt');
  });

  it('every record in consoleLogs/runtimeErrors/network has numeric t and doc index into documents', () => {
    // AC-4.5
    const pkg = assemblePackage({ meta: meta(), current: current(), priorDocs: [prior()] });
    for (const key of ['consoleLogs', 'runtimeErrors', 'network']) {
      expect(pkg[key].length).toBeGreaterThan(0);
      for (const r of pkg[key]) {
        expect(typeof r.t).toBe('number');
        expect(Number.isInteger(r.doc)).toBe(true);
        expect(pkg.documents[r.doc]).toBeDefined();
      }
    }
  });

  it('prior and current documents merged in order with documents[] metadata', () => {
    // AC-4.4
    const older = prior({ docId: 0, url: 'http://127.0.0.1:8080/start.html', buffers: buffers({ logs: [log(1, 'oldest')] }) });
    const pkg = assemblePackage({ meta: meta(), current: current(), priorDocs: [prior(), older] });
    expect(pkg.consoleLogs.map((r) => r.args[0])).toEqual(['oldest', 'prior-a', 'prior-b', 'cur-a', 'cur-b']);
    expect(pkg.consoleLogs.map((r) => r.doc)).toEqual([0, 1, 1, 2, 2]);
    expect(pkg.documents.map((d) => d.id)).toEqual([0, 1, 2]);
    expect(pkg.documents.map((d) => d.current)).toEqual([false, false, true]);
    expect(pkg.documents[1]).toEqual({
      id: 1,
      url: 'http://127.0.0.1:8080/index.html',
      timeOrigin: STARTED + 100.25,
      navigationType: 'reload',
      recorded: true,
      flushed: true,
      current: false,
      counts: { consoleLogs: 2, runtimeErrors: 0, network: 0 },
      kept: { consoleLogs: 2, runtimeErrors: 0, network: 0 },
    });
    expect(pkg.documents[2].url).toBe('http://127.0.0.1:8080/form.html');
    expect(pkg.documents[2].counts).toEqual({ consoleLogs: 2, runtimeErrors: 1, network: 1 });
  });

  it('accepts flat prior snapshots and string doc ids', () => {
    const flat = { id: 'd1', url: 'http://127.0.0.1:8080/x.html', timeOrigin: STARTED, ...buffers({ logs: [log(1, 'flat')] }) };
    const pkg = assemblePackage({ meta: meta(), current: current({ docId: 'd2' }), priorDocs: [flat] });
    expect(pkg.consoleLogs[0]).toMatchObject({ doc: 0, args: ['flat'] });
  });

  it('dropped prior document produces a note with its counts', () => {
    // AC-4.4
    const dropped = { docId: 1, dropped: true, counts: { consoleLogs: 120, runtimeErrors: 3, network: 7 } };
    const pkg = assemblePackage({ meta: meta(), current: current(), priorDocs: [dropped] });
    expect(pkg.documents[0].counts).toEqual({ consoleLogs: 120, runtimeErrors: 3, network: 7 });
    expect(pkg.documents[0].kept).toEqual({ consoleLogs: 0, runtimeErrors: 0, network: 0 });
    const note = pkg.notes.find((n) => /document 0/.test(n) && /dropped/.test(n));
    expect(note).toMatch(/120 console logs/);
    expect(note).toMatch(/3 runtime errors/);
    expect(note).toMatch(/7 network requests/);
    expect(pkg.truncated.consoleLogs).toBe(true);
  });

  it('known document without a snapshot is listed as not flushed with a note', () => {
    const pkg = assemblePackage({
      meta: meta(),
      current: current(),
      priorDocs: [prior()],
      docs: [{ id: 0, url: 'http://127.0.0.1:8080/lost.html', flushed: false }, { id: 1, flushed: true }, { id: 2, flushed: false }],
    });
    expect(pkg.documents.map((d) => [d.url, d.flushed, d.current])).toEqual([
      ['http://127.0.0.1:8080/lost.html', false, false],
      ['http://127.0.0.1:8080/index.html', true, false],
      ['http://127.0.0.1:8080/form.html', true, true],
    ]);
    expect(pkg.notes.some((n) => n.includes('data of document 0 was not received'))).toBe(true);
    expect(pkg.consoleLogs[0].doc).toBe(1);
  });

  it('global limit keeps newest and sets truncated; no limit hit → truncated false', () => {
    // AC-4.8
    const many = Array.from({ length: 6 }, (_, i) => log(i, `p${i}`));
    const pkg = assemblePackage({
      meta: meta({ limits: { consoleLogs: 4 } }),
      current: current(),
      priorDocs: [prior({ buffers: buffers({ logs: many }) })],
    });
    expect(pkg.limits.consoleLogs).toBe(4);
    expect(pkg.consoleLogs).toHaveLength(4);
    expect(pkg.consoleLogs.map((r) => r.args[0])).toEqual(['p4', 'p5', 'cur-a', 'cur-b']);
    expect(pkg.truncated).toEqual({ consoleLogs: true, runtimeErrors: false, network: false });
    expect(pkg.documents[0].counts.consoleLogs).toBe(6);
    expect(pkg.documents[0].kept.consoleLogs).toBe(2);
    expect(pkg.notes.some((n) => /consoleLogs/.test(n) && /4/.test(n))).toBe(true);

    const small = assemblePackage({ meta: meta(), current: current(), priorDocs: [prior()] });
    expect(small.truncated).toEqual({ consoleLogs: false, runtimeErrors: false, network: false });
    expect(small.limits).toEqual(DEFAULT_LIMITS);
  });

  it('truncated flag from a document buffer is carried to the package', () => {
    // AC-4.8: recorder buffer already dropped the oldest entries
    const cur = current(buffers({ logs: [log(1, 'x')], truncated: { network: true }, counts: { consoleLogs: 1, runtimeErrors: 0, network: 9000 } }));
    const pkg = assemblePackage({ meta: meta(), current: cur, priorDocs: [] });
    expect(pkg.truncated).toEqual({ consoleLogs: false, runtimeErrors: false, network: true });
    expect(pkg.documents[0].counts.network).toBe(9000);
  });

  it('recordingStoppedReason is time-limit or null', () => {
    // AC-4.9
    expect(assemblePackage({ meta: meta(), current: current(), priorDocs: [] }).recordingStoppedReason).toBeNull();
    const stopped = assemblePackage({ meta: meta({ stopReason: 'time-limit' }), current: current(), priorDocs: [] });
    expect(stopped.recordingStoppedReason).toBe('time-limit');
    expect(stopped.notes.some((n) => /time limit/.test(n))).toBe(true);
    const fromPage = assemblePackage({ meta: meta(), current: current({ stopReason: 'time-limit' }), priorDocs: [] });
    expect(fromPage.recordingStoppedReason).toBe('time-limit');
    const other = assemblePackage({ meta: meta({ stopReason: 'user' }), current: current(), priorDocs: [] });
    expect(other.recordingStoppedReason).toBeNull();
  });

  it('records at or after the deadline are dropped', () => {
    // AC-4.9 (defence in depth; the recorder already drops them)
    const cur = current({ timeOrigin: STARTED, ...buffers({ logs: [log(10, 'before'), log(20, 'at'), log(30, 'after')] }) });
    const pkg = assemblePackage({ meta: meta({ stopReason: 'time-limit', deadline: STARTED + 20 }), current: cur, priorDocs: [] });
    expect(pkg.consoleLogs.map((r) => r.args[0])).toEqual(['before']);
  });

  it('current null → environment/dom/performance/storage null and a note', () => {
    // AC-3.4
    const pkg = assemblePackage({ meta: meta(), current: null, priorDocs: [prior()] });
    expect(pkg.environment).toBeNull();
    expect(pkg.dom).toBeNull();
    expect(pkg.performance).toBeNull();
    expect(pkg.storage).toBeNull();
    expect(pkg.notes.some((n) => /current page/i.test(n) && /null/.test(n))).toBe(true);
    expect(pkg.timeOrigin).toBe(STARTED + 100.25);
    expect(pkg.documents.every((d) => d.current === false)).toBe(true);
    expect(pkg.consoleLogs).toHaveLength(2);
  });

  it('section errors from the collector become notes', () => {
    const pkg = assemblePackage({ meta: meta(), current: current({ dom: null, errors: [{ section: 'dom', name: 'TypeError' }] }), priorDocs: [] });
    expect(pkg.dom).toBeNull();
    expect(pkg.notes.some((n) => n.includes('dom') && n.includes('TypeError'))).toBe(true);
  });

  it('notes describe the recording range per source', () => {
    const ext = assemblePackage({ meta: meta(), current: current(), priorDocs: [] });
    expect(ext.notes[0]).toMatch(/^Recording started at 2026-01-15T10:00:00\.000Z \(page reloaded\); earlier data is not included\.$/);
    const con = assemblePackage({ meta: meta({ source: 'console' }), current: current(), priorDocs: [] });
    expect(con.source).toBe('console');
    expect(con.notes[0]).toMatch(/pasted/);
  });

  it('does not mutate inputs', () => {
    const cur = current();
    const before = JSON.stringify(cur);
    assemblePackage({ meta: meta(), current: cur, priorDocs: [] });
    expect(JSON.stringify(cur)).toBe(before);
  });

  it('long urls in notes are capped', () => {
    const url = `http://127.0.0.1:8080/${'a'.repeat(5000)}`;
    const pkg = assemblePackage({ meta: meta(), current: current(), priorDocs: [], docs: [{ id: 0, url, flushed: false }] });
    expect(Math.max(...pkg.notes.map((n) => n.length))).toBeLessThan(1000);
  });
});

describe('packageFileName', () => {
  it('uses the timestamp', () => {
    expect(packageFileName(1768471200000)).toBe('page-debug-snapshot-1768471200000.json');
  });
});

function shape(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function keysAndTypes(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, shape(obj[k])]));
}

describe('fixture v2.json', () => {
  const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8'));

  it('matches assemblePackage output shape', () => {
    const pkg = assemblePackage({ meta: meta(), current: current(), priorDocs: [prior()] });
    expect(keysAndTypes(fixture)).toEqual(keysAndTypes(pkg));
    expect(fixture.schemaVersion).toBe(2);
    expect(keysAndTypes(fixture.documents[0])).toEqual(keysAndTypes(pkg.documents[0]));
    expect(Object.keys(fixture.limits).sort()).toEqual(Object.keys(pkg.limits).sort());
    expect(keysAndTypes(fixture.truncated)).toEqual(keysAndTypes(pkg.truncated));
    for (const key of ['consoleLogs', 'runtimeErrors', 'network']) {
      expect(fixture[key].length).toBeGreaterThan(0);
      for (const r of fixture[key]) {
        expect(typeof r.t).toBe('number');
        expect(fixture.documents[r.doc]).toBeDefined();
      }
    }
    expect(keysAndTypes(fixture.consoleLogs[0])).toEqual(keysAndTypes(pkg.consoleLogs[0]));
    expect(keysAndTypes(fixture.network[0])).toEqual(keysAndTypes(pkg.network[0]));
    const fixtureError = fixture.runtimeErrors.find((r) => r.type === 'error');
    expect(keysAndTypes(fixtureError)).toEqual(keysAndTypes(pkg.runtimeErrors[0]));
  });

  it('contains only synthetic data', () => {
    const urls = JSON.stringify(fixture).match(/\b[a-z]+:\/\/[^\s"/]+/gi) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u).toMatch(/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|[\w.-]+\.(test|example|invalid))(:\d+)?$/);
    }
  });
});
