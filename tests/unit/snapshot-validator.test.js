import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { assemblePackage } from '../../src/lib/package.js';
import { validateSnapshot, assertValidSnapshot, REQUIRED_KEYS } from '../helpers/snapshot-validator.js';

// tests/fixtures/snapshots/v3.json is the output of assemblePackage for v3Input() below (synthetic data, AC-7.4).
// After a deliberate change of the package shape: PDS_UPDATE_FIXTURES=1 npx vitest run tests/unit/snapshot-validator.test.js
const fixtureUrl = new URL('../fixtures/snapshots/v3.json', import.meta.url);

const STARTED = Date.UTC(2026, 0, 15, 10, 0, 0);
const ORIGIN_0 = STARTED + 120.5;
const ORIGIN_1 = STARTED + 4200.25;
const BASE = 'http://127.0.0.1:8080';
// Smallest valid JPEG, 1×1 px (136 bytes).
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxD/2Q==';

const metric = (value, rating, t, extra = {}) => ({ available: true, value, rating, t, finalized: true, ...extra });

function v3Input() {
  const resource = (t, type, url, status, extra = {}) => ({
    t, type, method: 'GET', url, status, statusText: null, ok: status === null ? null : status < 400, redirected: null,
    durationMs: 2.4, sizeBytes: status === null ? null : 9, requestHeaders: {}, responseHeaders: {}, requestBody: null, error: null,
    ...extra,
  });
  const prior = {
    docId: 1,
    url: `${BASE}/form.html`,
    timeOrigin: ORIGIN_0,
    navigationType: 'reload',
    documentStatus: { status: 200 },
    consoleLogs: [{ t: 30.1, level: 'info', args: ['"form ready"'] }],
    runtimeErrors: [],
    network: [
      resource(40.1, 'img', `${BASE}/img/missing.png`, 404, { initiatorType: 'img' }),
      resource(41, 'img', 'https://cdn.example/logo.png', null, { statusUnavailable: 'cross-origin', initiatorType: 'img' }),
    ],
    steps: [
      { t: 0, type: 'navigate', url: `${BASE}/form.html`, via: 'reload' },
      { t: 812.4, type: 'click', selector: '#start', text: 'Zacznij' },
      { t: 930, type: 'input', selector: 'form > input:nth-of-type(1)', inputType: 'email', valueLength: 15 },
      { t: 1201.7, type: 'input', selector: '#pass', inputType: 'password' },
      { t: 1300.2, type: 'change', selector: '[data-testid="terms"]', inputType: 'checkbox', checked: true },
      { t: 1400, type: 'key', selector: '#pass', key: 'Enter' },
      { t: 1401, type: 'submit', selector: '#loginForm' },
    ],
    // Firefox-like document: no layout shifts, no INP support, no long animation frames.
    vitals: {
      TTFB: metric(47, 'good', 47),
      FCP: metric(820, 'good', 820),
      LCP: metric(1712, 'good', 1712, { selector: '#hero', url: `${BASE}/img/hero.png` }),
      CLS: { available: false, reason: 'unsupported-browser' },
      INP: { available: false, reason: 'unsupported-browser' },
      longTasks: { available: false, reason: 'unsupported-browser' },
    },
    truncated: { consoleLogs: false, runtimeErrors: false, network: false, steps: false, responseBodies: false },
    counts: { consoleLogs: 1, runtimeErrors: 0, network: 2, steps: 7 },
  };
  const current = {
    protocol: 2,
    recorderVersion: '0.4.0',
    docId: 2,
    url: `${BASE}/result.html`,
    timeOrigin: ORIGIN_1,
    navigationType: 'navigate',
    stopReason: null,
    documentStatus: { status: 500 },
    environment: { location: { href: `${BASE}/result.html`, hostname: '127.0.0.1', pathname: '/result.html' } },
    performance: { timeOrigin: ORIGIN_1, navigation: { type: 'navigate' }, resources: [] },
    storage: { cookies: 'sid=EXAMPLE', localStorage: { theme: 'dark' }, sessionStorage: {} },
    dom: { counts: { totalElements: 12, forms: 0 }, html: { outerHTML: '<html><body><p>Wynik</p></body></html>' } },
    consoleLogs: [{
      t: 15.2, level: 'error',
      args: [{ name: 'TypeError', message: 'x is undefined', stack: 'TypeError: x is undefined\n    at onSave (http://127.0.0.1:8080/result.js:12:9)',
        cause: { name: 'Error', message: 'save failed', stack: 'Error: save failed\n    at save (http://127.0.0.1:8080/result.js:3:1)' } }],
      stack: 'at onSave (http://127.0.0.1:8080/result.js:12:9)',
    }],
    runtimeErrors: [
      { t: 8.7, type: 'error', message: 'Uncaught TypeError: x is undefined', filename: `${BASE}/result.html`, lineno: 3, colno: 9,
        stack: 'TypeError: x is undefined\n    at http://127.0.0.1:8080/result.html:3:9' },
      { t: 9.5, type: 'error', message: 'Uncaught Error: frame failed', filename: `${BASE}/inner.html`, lineno: 1, colno: 1,
        stack: 'Error: frame failed', frame: `${BASE}/inner.html` },
    ],
    network: [
      { t: 12.5, type: 'fetch', method: 'POST', url: `${BASE}/api/fail`, status: 500, statusText: 'Internal Server Error', ok: false,
        redirected: false, durationMs: 3.21, sizeBytes: 23, requestHeaders: { 'content-type': 'application/json' },
        responseHeaders: { 'content-type': 'application/json' }, requestBody: '{"name":"Example"}',
        responseBodyPreview: '{"error":"expired"}', responseBodyTruncated: false, error: null },
      resource(20, 'script', `${BASE}/missing.js`, 404, { initiatorType: 'script' }),
      resource(21, 'css', `${BASE}/style.css`, 200, { initiatorType: 'link' }),
    ],
    steps: [
      { t: 0, type: 'navigate', url: `${BASE}/result.html`, via: 'navigate' },
      { t: 2050, type: 'click', selector: '#slow', text: 'Zapisz' },
    ],
    vitals: {
      TTFB: metric(52, 'good', 52),
      FCP: metric(910, 'good', 910),
      LCP: { ...metric(4300, 'poor', 4300, { selector: '#hero', url: `${BASE}/img/hero.png` }), finalized: false },
      CLS: { ...metric(0.183, 'needs-improvement', 560, { sources: [{ selector: 'main > p:nth-of-type(1)', value: 0.183, t: 560 }] }), finalized: false },
      INP: { ...metric(336, 'needs-improvement', 2100, { selector: '#slow', eventType: 'click', inputDelay: 2, processing: 304, presentation: 30, interactions: 1 }), finalized: false },
      longTasks: { available: true, items: [{ t: 300.2, duration: 212, blockingDuration: 162,
        scripts: [{ url: `${BASE}/heavy.js`, function: 'heavyWork', invoker: 'BUTTON#slow.onclick', duration: 205 }] }] },
    },
    truncated: { consoleLogs: false, runtimeErrors: false, network: false, steps: false, responseBodies: false },
    counts: { consoleLogs: 1, runtimeErrors: 2, network: 3, steps: 2 },
  };
  return {
    meta: {
      extensionVersion: '0.4.0', source: 'extension', startedAt: STARTED, collectedAt: STARTED + 65_000, stopReason: null,
      screenshots: [{ epochMs: ORIGIN_1 + 5230.1, mime: 'image/jpeg', width: 1, height: 1, bytes: 136, dataUrl: JPEG_1PX, reason: 'save' }],
    },
    current,
    priorDocs: [prior],
    docs: [{ id: 1, url: prior.url, flushed: true }, { id: 2, url: current.url }],
  };
}

const build = (input = v3Input()) => JSON.parse(JSON.stringify(assemblePackage(input)));
const errorsOf = (pkg) => validateSnapshot(pkg).errors;

describe('snapshot validator (AC-7.1, AC-7.2)', () => {
  it('assemblePackage output passes validator (AC-7.1)', () => {
    expect(errorsOf(build())).toEqual([]);
  });

  it('assemblePackage output for empty input passes validator (nulls and [] explained in notes)', () => {
    const pkg = build({ meta: { extensionVersion: '0.4.0', source: 'extension', startedAt: STARTED, collectedAt: STARTED + 1 }, current: null });
    expect(pkg.dom).toBeNull();
    expect(errorsOf(pkg)).toEqual([]);
  });

  it('console fallback package passes validator', () => {
    const input = v3Input();
    input.meta = { ...input.meta, source: 'console', screenshots: [] };
    expect(errorsOf(build(input))).toEqual([]);
  });

  it('CLS without shifts (value 0, t null) is accepted; other metrics need t', () => {
    const pkg = build();
    pkg.vitals[1].CLS = { available: true, value: 0, rating: 'good', t: null, finalized: false, sources: [] };
    expect(errorsOf(pkg)).toEqual([]);
    pkg.vitals[1].LCP.t = null;
    expect(errorsOf(pkg)).toEqual(['vitals[1].LCP.t: not a number: null']);
  });

  it.each(REQUIRED_KEYS)('validator rejects package missing required key %s (AC-7.1)', (key) => {
    const pkg = build();
    delete pkg[key];
    const { ok, errors } = validateSnapshot(pkg);
    expect(ok).toBe(false);
    expect(errors).toContain(`${key}: required key missing`);
  });

  it('validator rejects wrong key order (AC-7.2)', () => {
    const pkg = build();
    const { dom, ...rest } = pkg;
    const moved = { schemaVersion: pkg.schemaVersion, dom, ...rest };
    expect(errorsOf(moved).some((e) => e.startsWith('(root): wrong key order'))).toBe(true);
    // Bytes of the screenshot before a text section (PB-2 A).
    const { attachments, ...noAtt } = pkg;
    const early = {};
    for (const [k, v] of Object.entries(noAtt)) {
      early[k] = v;
      if (k === 'screenshots') early.attachments = attachments;
    }
    expect(errorsOf(early).some((e) => e.startsWith('(root): wrong key order'))).toBe(true);
  });

  it('validator rejects unknown top-level key and wrong schemaVersion', () => {
    const pkg = build();
    pkg.schemaVersion = 2;
    pkg.extra = 1;
    expect(errorsOf(pkg)).toEqual(expect.arrayContaining(['schemaVersion: expected 3, got 2', 'extra: unknown top-level key']));
  });

  it('validator rejects status 0 without statusUnavailable (AC-4.3)', () => {
    const pkg = build();
    const i = pkg.network.findIndex((r) => r.statusUnavailable === 'cross-origin');
    pkg.network[i].status = 0;
    delete pkg.network[i].statusUnavailable;
    expect(errorsOf(pkg)).toEqual([`network[${i}].status: 0 without statusUnavailable or error`]);
  });

  it('status null needs statusUnavailable from the enum; XHR error with status 0 is explained by error', () => {
    const pkg = build();
    const i = pkg.network.findIndex((r) => r.statusUnavailable === 'cross-origin');
    pkg.network[i].statusUnavailable = 'blocked';
    pkg.documents[0].status = null;
    expect(errorsOf(pkg)).toEqual(['documents[0].status: null without statusUnavailable', `network[${i}].statusUnavailable: not in enum: "blocked"`]);
    const ok = build();
    ok.network.push({ ...ok.network.find((r) => r.type === 'fetch'), type: 'xhr', status: 0, ok: false, error: 'error' });
    delete ok.network.at(-1).responseBodyPreview;
    delete ok.network.at(-1).responseBodyTruncated;
    ok.documents[1].kept.network += 1;
    ok.documents[1].counts.network += 1;
    ok.overview.failedRequests += 1;
    expect(errorsOf(ok)).toEqual([]);
  });

  it('enums: type, reason, rating, statusUnavailable', () => {
    const pkg = build();
    pkg.network[0].type = 'resource';
    pkg.steps[1].type = 'keydown';
    pkg.vitals[0].CLS.reason = 'not-supported';
    pkg.vitals[1].FCP.rating = 'bad';
    pkg.documents[1] = { ...pkg.documents[1], status: null, statusUnavailable: 'gone' };
    expect(errorsOf(pkg)).toEqual(expect.arrayContaining([
      'network[0].type: not in enum: "resource"',
      'steps[1].type: not in enum: "keydown"',
      'vitals[0].CLS.reason: not in enum: "not-supported"',
      'vitals[1].FCP.rating: not in enum: "bad"',
      'documents[1].statusUnavailable: not in enum: "gone"',
    ]));
  });

  it('unavailable metric needs reason and carries no value', () => {
    const pkg = build();
    pkg.vitals[0].INP = { available: false, value: 0 };
    expect(errorsOf(pkg)).toEqual(['vitals[0].INP.reason: not in enum: undefined', 'vitals[0].INP: unavailable metric carries a value']);
  });

  it('doc out of range of documents is rejected', () => {
    const pkg = build();
    pkg.consoleLogs[0].doc = 2;
    pkg.vitals[0].doc = -1;
    pkg.screenshots[0].doc = 7;
    expect(errorsOf(pkg)).toEqual(expect.arrayContaining([
      'consoleLogs[0].doc: not an index of documents: 2',
      'vitals[0].doc: not an index of documents: -1',
      'screenshots[0].doc: not an index of documents: 7',
    ]));
  });

  it('screenshots[].attachment must exist in attachments; no orphan or misplaced bytes', () => {
    const pkg = build();
    pkg.screenshots[0].attachment = 'screenshot-9';
    expect(errorsOf(pkg)).toEqual([
      'screenshots[0].attachment: no such key in attachments: "screenshot-9"',
      'attachments.screenshot-0: not referenced by any screenshot',
    ]);
    const inline = build();
    inline.screenshots[0].dataUrl = JPEG_1PX;
    expect(errorsOf(inline)).toEqual(['screenshots[0].dataUrl: image bytes belong in attachments']);
  });

  it('steps never carry value, password length or other keys (AC-3.4)', () => {
    const pkg = build();
    const pass = pkg.steps.findIndex((s) => s.inputType === 'password');
    pkg.steps[1].value = 'Sekret123!';
    pkg.steps[pass].valueLength = 10;
    pkg.steps[pass + 2].key = 'a';
    expect(errorsOf(pkg)).toEqual([
      'steps[1].value: steps never carry field values',
      `steps[${pass}].valueLength: present for a password field`,
      `steps[${pass + 2}].key: not a whitelisted key: "a"`,
    ]);
  });

  it('checkbox/radio steps carry checked, never valueLength (QA F-5)', () => {
    const pkg = build();
    const box = pkg.steps.findIndex((s) => s.inputType === 'checkbox');
    pkg.steps[box].valueLength = 2;
    expect(errorsOf(pkg)).toEqual([`steps[${box}].valueLength: present for a checkbox or radio`]);
  });

  it('documents kept and overview must match the records in the package', () => {
    const pkg = build();
    pkg.overview.failedRequests = 0;
    pkg.documents[0].kept.steps = 1;
    expect(errorsOf(pkg)).toEqual([
      'documents[0].kept.steps: 1, but the package has 7',
      'overview.failedRequests: 0, but the package has 3',
    ]);
  });

  it('empty steps without a note and null section without a note are rejected', () => {
    const pkg = build();
    pkg.steps = [];
    for (const d of pkg.documents) d.kept.steps = 0;
    pkg.overview.steps = 0;
    pkg.dom = null;
    pkg.notes = pkg.notes.filter((n) => !/step/i.test(n));
    expect(errorsOf(pkg)).toEqual(['steps: empty without a note explaining why', 'dom: null without a note']);
  });

  it('assertValidSnapshot throws with the list of errors', () => {
    const pkg = build();
    delete pkg.vitals;
    expect(() => assertValidSnapshot(pkg)).toThrow(/vitals: required key missing/);
    expect(() => assertValidSnapshot(build())).not.toThrow();
  });
});

describe('fixture v3.json (AC-7.4)', () => {
  if (process.env.PDS_UPDATE_FIXTURES === '1') writeFileSync(fixtureUrl, `${JSON.stringify(build(), null, 2)}\n`);
  const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8'));

  it('v3.json passes validator', () => {
    expect(errorsOf(fixture)).toEqual([]);
  });

  it('v3.json is what assemblePackage builds from the synthetic input', () => {
    expect(fixture).toEqual(build());
  });

  it('v3.json covers 2 documents, steps, resources, available and unavailable metrics, a screenshot', () => {
    expect(fixture.schemaVersion).toBe(3);
    expect(fixture.documents).toHaveLength(2);
    expect(fixture.steps.length).toBeGreaterThan(5);
    expect(fixture.network.map((r) => r.type)).toEqual(expect.arrayContaining(['fetch', 'img', 'script', 'css']));
    expect(fixture.network.some((r) => r.status === null && r.statusUnavailable)).toBe(true);
    expect(fixture.vitals.some((v) => v.CLS.available === false)).toBe(true);
    expect(fixture.vitals.some((v) => v.CLS.available === true)).toBe(true);
    expect(fixture.screenshots).toHaveLength(1);
    expect(fixture.attachments[fixture.screenshots[0].attachment]).toBe(JPEG_1PX);
  });

  it('v3.json contains only synthetic domains', () => {
    const urls = JSON.stringify(fixture).match(/\b[a-z]+:\/\/[^\s"/]+/gi) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u).toMatch(/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|[\w.-]+\.(test|example|invalid))(:\d+)?$/);
    }
  });
});
