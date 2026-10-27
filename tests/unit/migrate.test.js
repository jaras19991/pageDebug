import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeSnapshot, PackageError, CURRENT_SCHEMA_VERSION } from '../../src/lib/migrate.js';
import { SCHEMA_VERSION } from '../../src/lib/package.js';

const fixture = (v) => JSON.parse(readFileSync(new URL(`../fixtures/snapshots/v${v}.json`, import.meta.url), 'utf8'));

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const V4_KEYS = [
  'schemaVersion', 'extensionVersion', 'source', 'collectedAt', 'recordingStartedAt', 'recordingStoppedReason', 'timeOrigin',
  'overview', 'redaction', 'limits', 'truncated', 'documents', 'notes', 'steps', 'runtimeErrors', 'network', 'vitals',
  'screenshots', 'consoleLogs', 'environment', 'performance', 'storage', 'dom',
];

describe('normalizeSnapshot — v4 and newer', () => {
  it('current version matches the writer', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(SCHEMA_VERSION);
  });

  it('v4 returned as the same object and not mutated (deep-freeze)', () => {
    const raw = deepFreeze(fixture(4));
    const copy = JSON.stringify(raw);
    const out = normalizeSnapshot(raw);
    expect(out.snapshot).toBe(raw);
    expect(out.sourceVersion).toBe(4);
    expect(out.newer).toBe(false);
    expect(out.warnings).toEqual([]);
    expect(out.extras).toEqual({ screenshotDataUrl: null });
    expect(JSON.stringify(raw)).toBe(copy);
  });

  it('schemaVersion 5 → newer true with warning, data untouched', () => {
    const raw = deepFreeze({ ...fixture(4), schemaVersion: 5, futureField: { a: 1 } });
    const out = normalizeSnapshot(raw);
    expect(out.snapshot).toBe(raw);
    expect(out.sourceVersion).toBe(5);
    expect(out.newer).toBe(true);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].code).toBe('newer');
    expect(out.warnings[0].message).toMatch(/nowsza wersja paczki/i);
  });

  it('array/string/null → not-package', () => {
    for (const raw of [[], 'snapshot', null, undefined, 42, true, [{ schemaVersion: 4 }]]) {
      let err = null;
      try {
        normalizeSnapshot(raw);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(PackageError);
      expect(err.code).toBe('not-package');
    }
  });

  it('object without a recognisable version → not-package', () => {
    for (const raw of [{}, { foo: 1 }, { schemaVersion: '4' }, { schemaVersion: 0 }, { schemaVersion: 2.5 }, { schemaVersion: -1 }]) {
      expect(() => normalizeSnapshot(raw)).toThrow(PackageError);
    }
  });

  it('PackageError carries a code', () => {
    const e = new PackageError('corrupt', 'x');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('PackageError');
    expect(e.code).toBe('corrupt');
  });
});

describe('normalizeSnapshot — v3', () => {
  it('v3.json → steps/vitals kept, cookies list with valueHash null, screenshot from attachments in extras, redaction null', () => {
    const raw = deepFreeze(fixture(3));
    const out = normalizeSnapshot(raw);
    const s = out.snapshot;
    expect(out.sourceVersion).toBe(3);
    expect(out.newer).toBe(false);
    expect(s).not.toBe(raw);
    expect(Object.keys(s)).toEqual(V4_KEYS);
    expect(s.schemaVersion).toBe(4);
    expect(s.steps).toBe(raw.steps);
    expect(s.vitals).toBe(raw.vitals);
    expect(s.steps.length).toBe(9);
    expect(s.overview).toEqual(raw.overview);
    expect(s.redaction).toBeNull();
    expect(s.storage.cookies).toEqual([{ name: 'sid', sizeBytes: 11, valueHash: null }]);
    expect(s.storage.cookiesTotalBytes).toBe(11);
    expect(s.storage.localStorage).toEqual({ theme: 'dark' });
    expect(out.extras.screenshotDataUrl).toBe(raw.attachments['screenshot-0']);
    expect(out.extras.screenshotDataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(s.screenshots).toEqual([
      { t: 5230.1, doc: 1, reason: 'save', mime: 'image/jpeg', width: 1, height: 1, bytes: 136, file: 'screenshot-0', maskedFields: null },
    ]);
    expect('attachments' in s).toBe(false);
    expect(s.dom.html.outerHTML).toBe(raw.dom.html.outerHTML);
    expect(s.dom.structure).toBeNull();
    expect(s.dom.fullHtml).toBeNull();
    expect(s.truncated).toMatchObject({ steps: false, responseBodies: false, html: false, resources: false, dom: false, storage: false, stacks: false });
    expect(s.limits).toEqual(raw.limits);
  });

  it('cookies: several pairs, a pair without "=", UTF-8 sizes, empty string', () => {
    const base = fixture(3);
    const raw = { ...base, storage: { ...base.storage, cookies: 'a=1; flag; b=x=y; ł=ż' } };
    const s = normalizeSnapshot(raw).snapshot;
    expect(s.storage.cookies).toEqual([
      { name: 'a', sizeBytes: 3, valueHash: null },
      { name: '', sizeBytes: 4, valueHash: null },
      { name: 'b', sizeBytes: 5, valueHash: null },
      { name: 'ł', sizeBytes: 5, valueHash: null },
    ]);
    expect(s.storage.cookiesTotalBytes).toBe(new TextEncoder().encode('a=1; flag; b=x=y; ł=ż').length);
    expect(raw.storage.cookies).toBe('a=1; flag; b=x=y; ł=ż');

    const empty = normalizeSnapshot({ ...base, storage: { ...base.storage, cookies: '' } }).snapshot;
    expect(empty.storage.cookies).toEqual([]);
    expect(empty.storage.cookiesTotalBytes).toBe(0);
  });

  it('null sections and no screenshot stay safe', () => {
    const base = fixture(3);
    const raw = { ...base, storage: null, dom: null, screenshots: [], attachments: {} };
    const out = normalizeSnapshot(raw);
    expect(out.snapshot.storage).toBeNull();
    expect(out.snapshot.dom).toBeNull();
    expect(out.snapshot.screenshots).toEqual([]);
    expect(out.extras.screenshotDataUrl).toBeNull();
  });
});

describe('normalizeSnapshot — v2', () => {
  it('v2.json → steps/vitals/screenshots empty arrays; overview from records; documents extended', () => {
    const raw = deepFreeze(fixture(2));
    const out = normalizeSnapshot(raw);
    const s = out.snapshot;
    expect(out.sourceVersion).toBe(2);
    expect(Object.keys(s)).toEqual(V4_KEYS);
    expect(s.steps).toEqual([]);
    expect(s.vitals).toEqual([]);
    expect(s.screenshots).toEqual([]);
    expect(s.redaction).toBeNull();
    expect(s.overview).toEqual({ runtimeErrors: 2, consoleErrors: 1, failedRequests: 1, steps: 0, poorVitals: 0, screenshot: false });
    expect(s.consoleLogs).toBe(raw.consoleLogs);
    expect(s.network).toBe(raw.network);
    for (const d of s.documents) {
      expect(d.status).toBeNull();
      expect(d.statusUnavailable).toBe('unknown');
      expect(d.counts.steps).toBe(0);
      expect(d.kept.steps).toBe(0);
    }
    expect(s.documents[1].url).toBe(raw.documents[1].url);
    expect(s.truncated).toMatchObject({ consoleLogs: false, steps: false, responseBodies: false, html: false });
    expect(s.storage.cookies).toEqual([{ name: 'theme', sizeBytes: 10, valueHash: null }]);
  });

  it('records stay queryable: absolute times from documents[doc].timeOrigin + t', () => {
    const s = normalizeSnapshot(fixture(2)).snapshot;
    for (const r of [...s.consoleLogs, ...s.runtimeErrors, ...s.network]) {
      expect(Number.isFinite(s.documents[r.doc].timeOrigin + r.t)).toBe(true);
    }
  });
});

describe('normalizeSnapshot — v1 (best-effort)', () => {
  it('v1.json → one document, t from ISO timestamps', () => {
    const raw = deepFreeze(fixture(1));
    const out = normalizeSnapshot(raw);
    const s = out.snapshot;
    expect(out.sourceVersion).toBe(1);
    expect(out.newer).toBe(false);
    expect(out.warnings.map((w) => w.code)).toEqual(['unredacted', 'legacy-v1']);
    expect(Object.keys(s)).toEqual(V4_KEYS);
    expect(s.schemaVersion).toBe(4);
    expect(s.extensionVersion).toBeNull();
    expect(s.source).toBe('extension');
    expect(s.recordingStartedAt).toBe('2026-01-15T10:00:04.990Z');
    expect(s.recordingStoppedReason).toBeNull();
    expect(s.timeOrigin).toBe(1768471200000);
    expect(s.documents).toHaveLength(1);
    expect(s.documents[0]).toMatchObject({
      id: 0, url: 'http://127.0.0.1:8080/basic.html', timeOrigin: 1768471200000, current: true, recorded: true, status: null,
    });
    expect(s.consoleLogs).toEqual([
      { t: 4995, doc: 0, level: 'info', args: ['PageDebugSnapshot initialized.'] },
      { t: 5000, doc: 0, level: 'error', args: ['save failed'] },
    ]);
    expect(s.runtimeErrors).toHaveLength(1);
    expect(s.runtimeErrors[0]).toMatchObject({
      t: 4998, doc: 0, type: 'error', message: 'Uncaught TypeError: x is undefined', lineno: 3, colno: 9,
      stack: 'TypeError: x is undefined\n    at basic.html:3:9',
    });
    expect('error' in s.runtimeErrors[0]).toBe(false);
    expect(s.network[0]).toMatchObject({
      t: 4996, doc: 0, type: 'fetch', method: 'POST', url: 'http://127.0.0.1:8080/api/fail', status: 500, ok: false,
      requestHeaders: { 'content-type': 'application/json' }, responseHeaders: { 'content-type': 'text/plain' },
      requestBody: '{"name":"Example"}', error: null,
    });
    expect(s.overview).toEqual({ runtimeErrors: 1, consoleErrors: 1, failedRequests: 1, steps: 0, poorVitals: 0, screenshot: false });
    expect(s.storage.cookies).toEqual([{ name: 'sid', sizeBytes: 11, valueHash: null }]);
    expect(s.notes).toEqual(raw.notes);
  });

  it('v1 without performance.timeOrigin uses initializedAt; unparseable timestamps give t null', () => {
    const base = fixture(1);
    const raw = {
      ...base,
      performance: null,
      consoleLogs: [{ timestamp: 'nonsense', level: 'log', args: [] }],
      network: [{ type: 'xhr', startedAt: 12.5, responseURL: 'http://x/a', status: 200, ok: true }],
    };
    const s = normalizeSnapshot(raw).snapshot;
    expect(s.timeOrigin).toBe(Date.parse('2026-01-15T10:00:04.990Z'));
    expect(s.consoleLogs[0].t).toBeNull();
    expect(s.network[0]).toMatchObject({ t: 12.5, url: 'http://x/a', method: 'GET', requestHeaders: {}, responseHeaders: {} });
  });

  it('v1 recognised by initializedAt without version; missing arrays become empty', () => {
    const out = normalizeSnapshot({ initializedAt: '2026-01-15T10:00:00.000Z', collectedAt: '2026-01-15T10:00:01.000Z' });
    expect(out.sourceVersion).toBe(1);
    expect(out.snapshot.consoleLogs).toEqual([]);
    expect(out.snapshot.runtimeErrors).toEqual([]);
    expect(out.snapshot.network).toEqual([]);
    expect(out.snapshot.notes).toEqual([]);
  });
});

describe('normalizeSnapshot — consumers (T1a/T1c queries)', () => {
  it('queries from T1a and metrics from T1c do not throw on migrated v1, v2, v3', async () => {
    const q = await import('../../src/lib/snapshot-query.js');
    const m = await import('../../src/lib/snapshot-metrics.js');
    for (const v of [1, 2, 3]) {
      const s = normalizeSnapshot(fixture(v)).snapshot;
      expect(() => {
        q.stepList(s);
        q.errorGroups(s);
        q.failedRequests(s);
        q.timeline(s);
        m.vitalsByDoc(s);
        m.slowestResources(s);
        m.cookieInfo(s);
      }).not.toThrow();
    }
  });
});
