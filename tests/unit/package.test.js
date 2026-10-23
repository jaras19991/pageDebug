import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { assemblePackage, packageFileName, DEFAULT_LIMITS, SCHEMA_VERSION } from '../../src/lib/package.js';
import { assertValidSnapshot } from '../helpers/snapshot-validator.js';

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
      network: [{ t: 4, type: 'fetch', method: 'POST', url: 'http://127.0.0.1:8080/api/fail', status: 500, statusText: 'Internal Server Error', ok: false, redirected: false, durationMs: 1.5, sizeBytes: 23, requestHeaders: {}, responseHeaders: {}, requestBody: '{"a":1}', error: null }],
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
  it('header has schemaVersion 3, extensionVersion, source, collectedAt and recordingStartedAt as ISO, numeric timeOrigin', () => {
    // AC-4.5
    const pkg = assemblePackage({ meta: meta(), current: current(), priorDocs: [] });
    expect(pkg.schemaVersion).toBe(3);
    expect(SCHEMA_VERSION).toBe(3);
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
      status: null,
      statusUnavailable: 'unknown',
      recorded: true,
      flushed: true,
      current: false,
      counts: { consoleLogs: 2, runtimeErrors: 0, network: 0, steps: 0 },
      kept: { consoleLogs: 2, runtimeErrors: 0, network: 0, steps: 0 },
    });
    expect(pkg.documents[2].url).toBe('http://127.0.0.1:8080/form.html');
    expect(pkg.documents[2].counts).toEqual({ consoleLogs: 2, runtimeErrors: 1, network: 1, steps: 0 });
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
    expect(pkg.documents[0].counts).toEqual({ consoleLogs: 120, runtimeErrors: 3, network: 7, steps: 0 });
    expect(pkg.documents[0].kept).toEqual({ consoleLogs: 0, runtimeErrors: 0, network: 0, steps: 0 });
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

  it('document tokens of the background (F-2) never reach the package', () => {
    const token = 'c0ffee00c0ffee00c0ffee00c0ffee00';
    const pkg = assemblePackage({
      meta: meta(),
      current: current(),
      priorDocs: [prior()],
      docs: [{ id: 0, url: 'http://127.0.0.1:8080/lost.html', flushed: false, token }, { id: 1, flushed: true, token }, { id: 2, flushed: false, token }],
    });
    expect(JSON.stringify(pkg)).not.toContain(token);
  });

  it('known document marked not recorded or with bridgeError → recorded false and a note, also for the current one', () => {
    const pkg = assemblePackage({
      meta: meta(),
      current: current(),
      priorDocs: [prior()],
      docs: [
        { id: 0, url: 'http://127.0.0.1:8080/unbound.html', flushed: false, recorded: false, bridgeError: 'unbound' },
        { id: 1, flushed: true, recorded: false },
        { id: 2, flushed: false, bridgeError: 'unbound' },
      ],
    });
    expect(pkg.documents.map((d) => [d.recorded, d.current])).toEqual([
      [false, false],
      [false, false],
      [false, true],
    ]);
    const bridgeNotes = pkg.notes.filter((n) => /was not recorded/.test(n) && /unbound/.test(n));
    expect(bridgeNotes).toHaveLength(2);
    expect(bridgeNotes[0]).toMatch(/Document 0 \(http:\/\/127\.0\.0\.1:8080\/unbound\.html\)/);
    expect(bridgeNotes[1]).toMatch(/Document 2/);
  });

  it('known documents without recorded:false or bridgeError stay recorded', () => {
    const pkg = assemblePackage({ meta: meta(), current: current(), priorDocs: [prior()], docs: [{ id: 1, flushed: true }, { id: 2 }] });
    expect(pkg.documents.map((d) => d.recorded)).toEqual([true, true]);
    expect(pkg.notes.some((n) => /was not recorded/.test(n))).toBe(false);
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
    expect(pkg.truncated).toEqual({ consoleLogs: true, runtimeErrors: false, network: false, steps: false, responseBodies: false });
    expect(pkg.documents[0].counts.consoleLogs).toBe(6);
    expect(pkg.documents[0].kept.consoleLogs).toBe(2);
    expect(pkg.notes.some((n) => /consoleLogs/.test(n) && /4/.test(n))).toBe(true);

    const small = assemblePackage({ meta: meta(), current: current(), priorDocs: [prior()] });
    expect(small.truncated).toEqual({ consoleLogs: false, runtimeErrors: false, network: false, steps: false, responseBodies: false });
    expect(small.limits).toEqual(DEFAULT_LIMITS);
  });

  it('truncated flag from a document buffer is carried to the package', () => {
    // AC-4.8: recorder buffer already dropped the oldest entries
    const cur = current(buffers({ logs: [log(1, 'x')], truncated: { network: true }, counts: { consoleLogs: 1, runtimeErrors: 0, network: 9000 } }));
    const pkg = assemblePackage({ meta: meta(), current: cur, priorDocs: [] });
    expect(pkg.truncated).toEqual({ consoleLogs: false, runtimeErrors: false, network: true, steps: false, responseBodies: false });
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

  it('current null after the time limit (page loaded after stop) → specific note instead of left/no answer', () => {
    const pkg = assemblePackage({ meta: meta({ stopReason: 'time-limit', currentMissingReason: 'loadedAfterStop' }), current: null, priorDocs: [prior()] });
    expect(pkg.notes).toContain(
      'The current page was not available: page was loaded after the recording stopped (time limit); package contains documents recorded before the limit. environment, dom, performance and storage are null.',
    );
    expect(pkg.notes.some((n) => /left the recorded origin/.test(n))).toBe(false);
    expect(pkg.consoleLogs).toHaveLength(2);
  });

  it('section errors from the collector become notes', () => {
    const pkg = assemblePackage({ meta: meta(), current: current({ dom: null, errors: [{ section: 'dom', name: 'TypeError' }] }), priorDocs: [] });
    expect(pkg.dom).toBeNull();
    expect(pkg.notes.some((n) => n.includes('dom') && n.includes('TypeError'))).toBe(true);
  });

  // E2-F1: a page section missing from the collect result (no key, no entry in `errors[]`) is null and explained in notes.
  // v3 records from the recorder always carry `sizeBytes` (the shared current() fixture keeps the v2 record shape).
  const v3Current = (over) => {
    const cur = current(over);
    cur.network = cur.network.map((r) => ({ ...r, sizeBytes: null }));
    return cur;
  };

  it('section key missing from collect with empty errors → null section with a note; package passes the validator', () => {
    const cur = v3Current({ errors: [] });
    delete cur.dom;
    const pkg = assemblePackage({ meta: meta(), current: cur, priorDocs: [] });
    expect(pkg.dom).toBeNull();
    expect(pkg.notes).toContain('Section dom was not received from the page.');
    expect(() => assertValidSnapshot(pkg)).not.toThrow();
  });

  it('section null without errors[] gets the same note; a section error is not noted twice', () => {
    const plain = assemblePackage({ meta: meta(), current: current({ storage: null }), priorDocs: [] });
    expect(plain.notes).toContain('Section storage was not received from the page.');
    const failed = assemblePackage({ meta: meta(), current: v3Current({ dom: null, errors: [{ section: 'dom', name: 'TypeError' }] }), priorDocs: [] });
    expect(failed.notes.filter((n) => /\bdom\b/.test(n))).toHaveLength(1);
    expect(() => assertValidSnapshot(failed)).not.toThrow();
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

// ---- schema v3 (E2-T10a) ----

const KEY_ORDER = [
  'schemaVersion', 'extensionVersion', 'source', 'collectedAt', 'recordingStartedAt', 'recordingStoppedReason', 'timeOrigin',
  'overview', 'limits', 'truncated',
  'documents', 'notes', 'steps', 'runtimeErrors', 'network', 'vitals', 'screenshots', 'consoleLogs',
  'environment', 'performance', 'storage', 'dom',
  'attachments',
];

const JPEG = `data:image/jpeg;base64,${'/9j/'.padEnd(400, 'A')}`;

function shot(over = {}) {
  return { epochMs: STARTED + 30_000.5 + 5230, mime: 'image/jpeg', width: 1280, height: 720, bytes: 300, dataUrl: JPEG, ...over };
}

function click(t, marker) {
  return { t, type: 'click', selector: `#${marker}` };
}

function vitalsOf(rating = 'good', finalized = true) {
  return {
    TTFB: { available: true, value: 47, rating: 'good', t: 47, finalized: true },
    FCP: { available: true, value: 820, rating: 'good', t: 820, finalized: true },
    LCP: { available: true, value: 1712, rating, t: 1712, finalized, selector: '#hero' },
    CLS: { available: false, reason: 'unsupported-browser' },
    INP: { available: false, reason: 'no-interaction' },
    longTasks: { available: false, reason: 'unsupported-browser' },
  };
}

function fetchEntry(t, over = {}) {
  return {
    t, type: 'fetch', method: 'GET', url: 'http://127.0.0.1:8080/api/x', status: 200, statusText: 'OK', ok: true, redirected: false,
    durationMs: 1, sizeBytes: null, requestHeaders: {}, responseHeaders: {}, requestBody: null, error: null, ...over,
  };
}

describe('assemblePackage v3 (E2-T10a)', () => {
  it('Object.keys order equals AC-7.2 (+attachments last)', () => {
    // AC-7.2 / PB-2 A
    const pkg = assemblePackage({ meta: meta({ screenshots: [shot()] }), current: current(), priorDocs: [prior()] });
    expect(Object.keys(JSON.parse(JSON.stringify(pkg)))).toEqual(KEY_ORDER);
    expect(Object.keys(pkg.overview)).toEqual(['runtimeErrors', 'consoleErrors', 'failedRequests', 'steps', 'poorVitals', 'screenshot']);
    expect(Object.keys(pkg.limits)).toEqual([
      'consoleLogs', 'runtimeErrors', 'network', 'steps', 'entryChars', 'stackChars', 'responseBodyChars', 'responseBodyTotalChars',
      'screenshotBytes', 'longTasks',
    ]);
    expect(Object.keys(pkg.truncated)).toEqual(['consoleLogs', 'runtimeErrors', 'network', 'steps', 'responseBodies']);
    expect(Object.keys(pkg.documents[0])).toEqual([
      'id', 'url', 'timeOrigin', 'navigationType', 'status', 'statusUnavailable', 'recorded', 'flushed', 'current', 'counts', 'kept',
    ]);
  });

  it('default limits follow the v3 schema', () => {
    expect(DEFAULT_LIMITS).toEqual({
      consoleLogs: 5000, runtimeErrors: 1000, network: 5000, steps: 2000, entryChars: 40000, stackChars: 16000,
      responseBodyChars: 4096, responseBodyTotalChars: 262144, screenshotBytes: 307200, longTasks: 20,
    });
  });

  it('all required keys present for empty input (null/[] + notes)', () => {
    // AC-7.1
    const pkg = assemblePackage({ meta: meta(), current: null, priorDocs: [], docs: [] });
    expect(Object.keys(pkg)).toEqual(KEY_ORDER);
    expect(pkg.documents).toEqual([]);
    for (const key of ['steps', 'runtimeErrors', 'network', 'vitals', 'screenshots', 'consoleLogs']) expect(pkg[key]).toEqual([]);
    for (const key of ['environment', 'performance', 'storage', 'dom']) expect(pkg[key]).toBeNull();
    expect(pkg.attachments).toEqual({});
    expect(pkg.overview).toEqual({ runtimeErrors: 0, consoleErrors: 0, failedRequests: 0, steps: 0, poorVitals: 0, screenshot: false });
    expect(pkg.notes.some((n) => /null/.test(n))).toBe(true);
    expect(pkg.notes.some((n) => /No screenshot/.test(n))).toBe(true);
    expect(pkg.notes.some((n) => /metrics/i.test(n))).toBe(true);
    expect(pkg.notes.some((n) => /steps/i.test(n))).toBe(true);
  });

  it('3000 steps across 2 documents → newest 2000, truncated.steps, kept per document', () => {
    // AC-3.6
    const priorSteps = Array.from({ length: 1500 }, (_, i) => click(i, `p${i}`));
    const curSteps = Array.from({ length: 1500 }, (_, i) => click(i, `c${i}`));
    const pkg = assemblePackage({
      meta: meta(),
      current: current({ steps: curSteps, counts: { consoleLogs: 2, runtimeErrors: 1, network: 1, steps: 1500 } }),
      priorDocs: [prior({ buffers: { ...buffers(), steps: priorSteps, counts: { consoleLogs: 0, runtimeErrors: 0, network: 0, steps: 1500 } } })],
    });
    expect(pkg.steps).toHaveLength(2000);
    expect(pkg.steps[0]).toMatchObject({ doc: 0, selector: '#p1000' });
    expect(pkg.steps.at(-1)).toMatchObject({ doc: 1, selector: '#c1499' });
    expect(pkg.truncated.steps).toBe(true);
    expect(pkg.limits.steps).toBe(2000);
    expect(pkg.documents.map((d) => d.counts.steps)).toEqual([1500, 1500]);
    expect(pkg.documents.map((d) => d.kept.steps)).toEqual([500, 1500]);
    expect(pkg.overview.steps).toBe(2000);
  });

  it('steps of prior documents included with doc index; never carry a value key', () => {
    // AC-3.6, AC-3.4 (defence in depth)
    const pkg = assemblePackage({
      meta: meta(),
      current: current({ steps: [click(3, 'now')] }),
      priorDocs: [prior({ buffers: { ...buffers(), steps: [{ t: 1, type: 'navigate', url: 'http://127.0.0.1:8080/index.html', via: 'reload' }, { t: 2, type: 'input', selector: '#e', inputType: 'email', valueLength: 3, value: 'a@b' }] } })],
    });
    expect(pkg.steps.map((s) => [s.doc, s.type])).toEqual([[0, 'navigate'], [0, 'input'], [1, 'click']]);
    expect(pkg.steps[1]).not.toHaveProperty('value');
    expect(JSON.stringify(pkg)).not.toContain('a@b');
    expect(pkg.truncated.steps).toBe(false);
  });

  it('documents[].status from documentStatus; missing → null + statusUnavailable', () => {
    // AC-4.2
    const pkg = assemblePackage({
      meta: meta(),
      current: current({ documentStatus: { status: 500 } }),
      priorDocs: [prior({ buffers: { ...buffers(), documentStatus: { status: null, statusUnavailable: 'unsupported-browser' } } }), prior({ docId: 0 })],
      docs: [{ id: 5, url: 'http://127.0.0.1:8080/lost.html', flushed: false }, { id: 0 }, { id: 1 }, { id: 2 }],
    });
    expect(pkg.documents.map((d) => [d.status, d.statusUnavailable])).toEqual([
      [null, 'unknown'],
      [null, 'unknown'],
      [null, 'unsupported-browser'],
      [500, undefined],
    ]);
    expect(pkg.documents[3]).not.toHaveProperty('statusUnavailable');
    expect(pkg.notes.some((n) => /not available in this browser/.test(n))).toBe(true);
  });

  it('vitals per document with doc index for both documents', () => {
    // AC-5.7
    const pkg = assemblePackage({
      meta: meta(),
      current: current({ vitals: vitalsOf('poor', false) }),
      priorDocs: [prior({ buffers: { ...buffers(), vitals: vitalsOf() } })],
    });
    expect(pkg.vitals.map((v) => v.doc)).toEqual([0, 1]);
    expect(pkg.vitals[0]).toEqual({ doc: 0, ...vitalsOf() });
    expect(pkg.vitals[1].LCP).toMatchObject({ value: 1712, rating: 'poor', finalized: false, selector: '#hero' });
    expect(pkg.notes).toContain('LCP, CLS and INP are values at the time of saving; they could still grow.');
    expect(pkg.overview.poorVitals).toBe(1);
  });

  it('vitals caps long tasks and CLS sources', () => {
    const v = vitalsOf();
    v.longTasks = { available: true, items: Array.from({ length: 30 }, (_, i) => ({ t: i, duration: 60, blockingDuration: 10 })) };
    v.CLS = { available: true, value: 0.3, rating: 'poor', t: 5, finalized: true, sources: Array.from({ length: 9 }, (_, i) => ({ selector: `#s${i}`, value: 0.01, t: i })) };
    const pkg = assemblePackage({ meta: meta(), current: current({ vitals: v }), priorDocs: [] });
    expect(pkg.vitals[0].longTasks.items).toHaveLength(20);
    expect(pkg.vitals[0].CLS.sources).toHaveLength(5);
  });

  it('screenshot metadata in screenshots[], data only in attachments', () => {
    // AC-6.1 / PB-2 A
    const pkg = assemblePackage({ meta: meta({ screenshots: [shot()] }), current: current(), priorDocs: [prior()] });
    expect(pkg.screenshots).toEqual([
      { t: 5230, doc: 1, reason: 'save', mime: 'image/jpeg', width: 1280, height: 720, bytes: 300, attachment: 'screenshot-0' },
    ]);
    expect(pkg.attachments).toEqual({ 'screenshot-0': JPEG });
    const json = JSON.stringify(pkg, null, 2);
    expect(json.indexOf('/9j/')).toBeGreaterThan(json.indexOf('"dom"'));
    expect(pkg.overview.screenshot).toBe(true);
    expect(pkg.notes.some((n) => /No screenshot/.test(n))).toBe(false);
  });

  it('no screenshot → [] and note with reason', () => {
    // AC-6.3 / AC-6.4
    const note = 'No screenshot: the tab showed a page outside the recorded site.';
    const pkg = assemblePackage({ meta: meta({ screenshotNote: note }), current: current(), priorDocs: [] });
    expect(pkg.screenshots).toEqual([]);
    expect(pkg.attachments).toEqual({});
    expect(pkg.notes).toContain(note);
    const con = assemblePackage({ meta: meta({ source: 'console' }), current: current(), priorDocs: [] });
    expect(con.notes).toContain('Screenshots are not available without the extension.');
  });

  it('screenshot that is not a JPEG data URL or over the limit is not included', () => {
    const big = `data:image/jpeg;base64,${'A'.repeat(4 * 1000)}`;
    const pkg = assemblePackage({
      meta: meta({ limits: { screenshotBytes: 1000 }, screenshots: [shot({ dataUrl: 'data:text/html;base64,PGI+', mime: 'text/html' }), shot({ dataUrl: big, bytes: 3000 })] }),
      current: current(),
      priorDocs: [],
    });
    expect(pkg.screenshots).toEqual([]);
    expect(pkg.attachments).toEqual({});
    expect(pkg.notes.some((n) => /No screenshot/.test(n))).toBe(true);
  });

  it('response previews over 262144 total: newest kept, truncated.responseBodies, note', () => {
    const body = 'x'.repeat(4000);
    const network = Array.from({ length: 70 }, (_, i) => fetchEntry(i, { status: 500, ok: false, responseBodyPreview: body, responseBodyTruncated: false }));
    const pkg = assemblePackage({ meta: meta(), current: current({ network }), priorDocs: [] });
    const withPreview = pkg.network.filter((r) => 'responseBodyPreview' in r);
    expect(withPreview).toHaveLength(Math.floor(262144 / 4000));
    expect(pkg.network.at(-1).responseBodyPreview).toBe(body);
    expect(pkg.network[0]).not.toHaveProperty('responseBodyPreview');
    expect(pkg.network[0]).not.toHaveProperty('responseBodyTruncated');
    expect(pkg.truncated.responseBodies).toBe(true);
    expect(pkg.notes.some((n) => /response/i.test(n) && /262144/.test(n))).toBe(true);
    expect(pkg.overview.failedRequests).toBe(70);
  });

  it('truncated.responseBodies from a document buffer is carried to the package', () => {
    const pkg = assemblePackage({ meta: meta(), current: current({ truncated: { responseBodies: true } }), priorDocs: [] });
    expect(pkg.truncated.responseBodies).toBe(true);
  });

  it('truncated.responseBodies from a document buffer only (no cut in the package) still gets the note; validator passes', () => {
    // E2-F2: the 256 KB budget was applied in the page, the package itself drops nothing.
    const network = [fetchEntry(1, { status: 500, ok: false, responseBodyPreview: 'x'.repeat(100), responseBodyTruncated: false })];
    const pkg = assemblePackage({ meta: meta(), current: current({ network, truncated: { responseBodies: true } }), priorDocs: [] });
    expect(pkg.truncated.responseBodies).toBe(true);
    expect(pkg.network[0].responseBodyPreview).toBe('x'.repeat(100));
    expect(pkg.notes.filter((n) => /response preview/i.test(n) && /262144/.test(n))).toHaveLength(1);
    assertValidSnapshot(pkg);
  });

  it('both page-side and package-side preview cuts → a single response preview note', () => {
    const body = 'x'.repeat(4000);
    const network = Array.from({ length: 70 }, (_, i) => fetchEntry(i, { status: 500, ok: false, responseBodyPreview: body, responseBodyTruncated: false }));
    const pkg = assemblePackage({ meta: meta(), current: current({ network, truncated: { responseBodies: true } }), priorDocs: [] });
    expect(pkg.truncated.responseBodies).toBe(true);
    expect(pkg.notes.filter((n) => /response preview/i.test(n))).toHaveLength(1);
  });

  it('no preview cut anywhere → no response preview note', () => {
    const pkg = assemblePackage({ meta: meta(), current: current(), priorDocs: [] });
    expect(pkg.truncated.responseBodies).toBe(false);
    expect(pkg.notes.some((n) => /response preview/i.test(n))).toBe(false);
  });

  it('unmasked token in preview is masked by second pass and capped at responseBodyChars', () => {
    // AC-4.7
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const network = [
      fetchEntry(1, { status: 401, ok: false, responseBodyPreview: `{"error":"expired","access_token":"${jwt}"}`, responseBodyTruncated: false }),
      fetchEntry(2, { status: 500, ok: false, responseBodyPreview: 'y'.repeat(5000), responseBodyTruncated: false }),
      fetchEntry(3, { status: 500, ok: false, responseBodyPreview: 42 }),
    ];
    const pkg = assemblePackage({ meta: meta(), current: current({ network }), priorDocs: [] });
    expect(pkg.network[0].responseBodyPreview).toBe('{"error":"expired","access_token":"[redacted:key-token]"}');
    expect(JSON.stringify(pkg)).not.toContain(jwt);
    expect(pkg.network[1].responseBodyPreview.length).toBeLessThanOrEqual(4096);
    expect(pkg.network[1].responseBodyTruncated).toBe(true);
    expect(pkg.network[2]).not.toHaveProperty('responseBodyPreview');
  });

  it('overview counts errors, failed requests (≥400 or error), steps, poor vitals, screenshot', () => {
    const network = [
      fetchEntry(1),
      fetchEntry(2, { status: 404, ok: false }),
      fetchEntry(3, { status: null, ok: null, error: 'TypeError: Failed to fetch' }),
      fetchEntry(4, { type: 'img', status: null, statusUnavailable: 'cross-origin', ok: null }),
    ];
    const logs = [{ t: 1, level: 'error', args: ['x'] }, { t: 2, level: 'warn', args: ['y'] }, { t: 3, level: 'error', args: ['z'] }];
    const pkg = assemblePackage({
      meta: meta({ screenshots: [shot()] }),
      current: current({ network, consoleLogs: logs, steps: [click(1, 'a'), click(2, 'b')], vitals: vitalsOf('poor') }),
      priorDocs: [],
    });
    expect(pkg.overview).toEqual({ runtimeErrors: 1, consoleErrors: 2, failedRequests: 2, steps: 2, poorVitals: 1, screenshot: true });
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

// Migration v2 → v3: a v2 package is a v3 package without the keys v3 added (the v3 shape itself is pinned by
// tests/fixtures/snapshots/v3.json in snapshot-validator.test.js).
describe('fixture v2.json (migration v2 → v3)', () => {
  const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8'));
  const subsetOf = (small, big) => {
    const bigShape = keysAndTypes(big);
    for (const [key, type] of Object.entries(keysAndTypes(small))) expect([key, bigShape[key]]).toEqual([key, type]);
  };

  it('v2 keys keep their types in v3; v3 adds only the documented keys', () => {
    const pkg = assemblePackage({ meta: meta(), current: current(), priorDocs: [prior()] });
    expect(fixture.schemaVersion).toBe(2);
    const added = Object.keys(pkg).filter((k) => !(k in fixture)).sort();
    expect(added).toEqual(['attachments', 'overview', 'screenshots', 'steps', 'vitals']);
    subsetOf({ ...fixture, schemaVersion: 3 }, pkg);
    subsetOf(fixture.documents[0], pkg.documents[0]);
    expect(Object.keys(pkg.documents[0]).filter((k) => !(k in fixture.documents[0])).sort()).toEqual(['status', 'statusUnavailable']);
    subsetOf(fixture.truncated, pkg.truncated);
    for (const key of Object.keys(fixture.limits)) expect(pkg.limits).toHaveProperty(key);
    for (const key of ['consoleLogs', 'runtimeErrors', 'network']) {
      expect(fixture[key].length).toBeGreaterThan(0);
      for (const r of fixture[key]) {
        expect(typeof r.t).toBe('number');
        expect(fixture.documents[r.doc]).toBeDefined();
      }
    }
    expect(keysAndTypes(fixture.consoleLogs[0])).toEqual(keysAndTypes(pkg.consoleLogs[0]));
    // v3 adds sizeBytes to every network record (docs/snapshot-schema.md); all v2 keys keep their types.
    expect({ ...keysAndTypes(fixture.network[0]), sizeBytes: 'number' }).toEqual(keysAndTypes(pkg.network[0]));
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
