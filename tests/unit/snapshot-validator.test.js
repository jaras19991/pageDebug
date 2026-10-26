import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { exportPackage } from '../../src/lib/export.js';
import { validateSnapshot, assertValidSnapshot, validateZipEntries, REQUIRED_KEYS } from '../helpers/snapshot-validator.js';
import { JWT, TOKEN, EMAIL, PASSWORD, COOKIE_SID, leaks } from './helpers/redaction-traps.js';

// tests/fixtures/snapshots/v4.json is snapshot.json of the zip that exportPackage writes for v4Input() below (synthetic
// data, synthetic trap values that the redaction masks; E3-T7). v3.json stays for migration tests.
// After a deliberate change of the package shape: PDS_UPDATE_FIXTURES=1 npx vitest run tests/unit/snapshot-validator.test.js
const fixtureUrl = new URL('../fixtures/snapshots/v4.json', import.meta.url);
const v3Url = new URL('../fixtures/snapshots/v3.json', import.meta.url);

const STARTED = Date.UTC(2026, 0, 15, 10, 0, 0);
const ORIGIN_0 = STARTED + 120.5;
const ORIGIN_1 = STARTED + 4200.25;
const BASE = 'http://127.0.0.1:8080';
const DATE = new Date(2026, 0, 15, 11, 1, 5);
// Smallest valid JPEG, 1×1 px (136 bytes).
const JPEG_1PX = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxD/2Q==';
const STRUCTURE = '<html lang="pl"><head><meta charset="utf-8"><script></script></head><body class="page">'
  + '<main id="app" data-section="result"><h1></h1><button id="slow" class="btn" type="button"></button><img id="hero">'
  + '<form id="profile"><input type="email" id="mail"><input type="password" id="pass"><input type="file" id="avatar"></form>'
  + '<div data-user="EMAIL"></div></main></body></html>';

const metric = (value, rating, t, extra = {}) => ({ available: true, value, rating, t, finalized: true, ...extra });

function v4Input() {
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
      { t: 1350, type: 'change', selector: '#avatar', inputType: 'file', fileCount: 2 },
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
    counts: { consoleLogs: 1, runtimeErrors: 0, network: 2, steps: 8 },
  };
  const current = {
    protocol: 3,
    recorderVersion: '0.5.0',
    docId: 2,
    url: `${BASE}/result.html`,
    timeOrigin: ORIGIN_1,
    navigationType: 'navigate',
    stopReason: null,
    documentStatus: { status: 500 },
    environment: {
      location: { href: `${BASE}/result.html?access_token=${TOKEN}`, hostname: '127.0.0.1', pathname: '/result.html', search: `?access_token=${TOKEN}`, hash: '' },
      navigator: { userAgent: 'Mozilla/5.0 (Synthetic) Test/1.0', language: 'pl-PL' },
      viewport: { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 },
    },
    performance: { timeOrigin: ORIGIN_1, navigation: { type: 'navigate', name: `${BASE}/result.html` }, resources: [] },
    storage: {
      cookies: `sid=${COOKIE_SID}; consent=yes; theme=dark`,
      localStorage: { theme: 'dark', authToken: TOKEN, profile: JSON.stringify({ email: EMAIL, plan: 'free' }) },
      sessionStorage: { cart: '3' },
    },
    dom: {
      counts: { totalElements: 14, scripts: 1, stylesheets: 0, images: 1, links: 0, iframes: 0, forms: 1 },
      html: { doctype: { name: 'html', publicId: '', systemId: '' }, lang: 'pl', charset: 'UTF-8', compatMode: 'CSS1Compat' },
      forms: [{
        id: 'profile', name: null, method: 'post', action: `${BASE}/profile`, enctype: 'multipart/form-data',
        elements: [
          { tagName: 'INPUT', type: 'email', name: 'email', id: 'mail', valueLength: EMAIL.length },
          { tagName: 'INPUT', type: 'password', name: 'password', id: 'pass' },
          { tagName: 'INPUT', type: 'file', name: 'avatar', id: 'avatar', fileCount: 0 },
        ],
      }],
      rootMarkers: { bodyClassName: 'page', htmlClassName: null, dataAttributesOnHtml: {}, dataAttributesOnBody: {} },
      structure: STRUCTURE.replace('EMAIL', EMAIL),
      structureTruncated: false,
      omittedElements: 0,
      fullHtml: null,
    },
    consoleLogs: [
      {
        t: 15.2, level: 'error',
        args: [{ name: 'TypeError', message: 'x is undefined', stack: 'TypeError: x is undefined\n    at onSave (http://127.0.0.1:8080/result.js:12:9)',
          cause: { name: 'Error', message: 'save failed', stack: 'Error: save failed\n    at save (http://127.0.0.1:8080/result.js:3:1)' } }],
        stack: 'at onSave (http://127.0.0.1:8080/result.js:12:9)',
      },
      { t: 16, level: 'log', args: ['clicked', { tagName: 'BUTTON', id: 'slow', className: 'btn', structure: '<button id="slow" class="btn" type="button"></button>' }] },
      { t: 17, level: 'warn', args: [`session ${JWT}`, { password: PASSWORD, user: EMAIL }] },
    ],
    runtimeErrors: [
      { t: 8.7, type: 'error', message: 'Uncaught TypeError: x is undefined', filename: `${BASE}/result.html`, lineno: 3, colno: 9,
        stack: 'TypeError: x is undefined\n    at http://127.0.0.1:8080/result.html:3:9' },
      { t: 9.5, type: 'error', message: 'Uncaught Error: frame failed', filename: `${BASE}/inner.html`, lineno: 1, colno: 1,
        stack: 'Error: frame failed', frame: `${BASE}/inner.html` },
    ],
    network: [
      { t: 12.5, type: 'fetch', method: 'POST', url: `${BASE}/api/fail`, status: 500, statusText: 'Internal Server Error', ok: false,
        redirected: false, durationMs: 3.21, sizeBytes: 23,
        requestHeaders: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        responseHeaders: { 'content-type': 'application/json' }, requestBody: JSON.stringify({ name: 'Example', password: PASSWORD }),
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
      CLS: { ...metric(0.183, 'needs-improvement', 560, { sources: [{ selector: 'main > h1', value: 0.183, t: 560 }] }), finalized: false },
      INP: { ...metric(336, 'needs-improvement', 2100, { selector: '#slow', eventType: 'click', inputDelay: 2, processing: 304, presentation: 30, interactions: 1 }), finalized: false },
      longTasks: { available: true, items: [{ t: 300.2, duration: 212, blockingDuration: 162,
        scripts: [{ url: `${BASE}/heavy.js`, function: 'heavyWork', invoker: 'BUTTON#slow.onclick', duration: 205 }] }] },
    },
    truncated: { consoleLogs: false, runtimeErrors: false, network: false, steps: false, responseBodies: false },
    counts: { consoleLogs: 3, runtimeErrors: 2, network: 3, steps: 2 },
  };
  return {
    meta: {
      extensionVersion: '0.5.0', source: 'extension', startedAt: STARTED, collectedAt: STARTED + 65_000, stopReason: null,
      screenshots: [{ epochMs: ORIGIN_1 + 5230.1, mime: 'image/jpeg', width: 1, height: 1, bytes: 136, dataUrl: JPEG_1PX, reason: 'save', maskedFields: 3 }],
    },
    current,
    priorDocs: [prior],
    docs: [{ id: 1, url: prior.url, flushed: true }, { id: 2, url: current.url }],
  };
}

const dec = new TextDecoder();

// The zip as the reporter gets it: entry names in order, snapshot.json text and the parsed package.
async function exportOf(input = v4Input(), devOptions = {}) {
  const { bytes } = await exportPackage({ input, devOptions, date: DATE, origin: BASE });
  const files = unzipSync(bytes);
  const text = dec.decode(files['snapshot.json']);
  return { names: Object.keys(files), text, pkg: JSON.parse(text) };
}

const built = await exportOf();
const build = () => structuredClone(built.pkg);
const errorsOf = (pkg) => validateSnapshot(pkg).errors;
const anyError = (pkg, prefix) => errorsOf(pkg).some((e) => e.startsWith(prefix));

describe('snapshot validator v4 (E3-T7, spec „Dane”)', () => {
  it('exportPackage output passes validator; zip entries in order', async () => {
    expect(errorsOf(build())).toEqual([]);
    expect(built.names).toEqual(['snapshot.json', 'summary.md', 'screenshot.jpg']);
    expect(validateZipEntries(built.names, built.pkg)).toEqual({ ok: true, errors: [] });
  });

  it('exportPackage output passes: screenshot off, console source, empty input, full HTML by developer', async () => {
    const off = v4Input();
    off.meta = { ...off.meta, screenshotOff: true };
    const console = v4Input();
    console.meta = { ...console.meta, source: 'console', screenshots: [] };
    const full = v4Input();
    full.current.dom.fullHtml = '<html><body><form><input type="password" value="x"></form><p>Witaj</p></body></html>';
    const empty = { meta: { extensionVersion: '0.5.0', source: 'extension', startedAt: STARTED, collectedAt: STARTED + 1 }, current: null };
    for (const [input, dev, image] of [[off, {}, false], [console, {}, false], [full, { disabledRules: ['html-structure'] }, true], [empty, {}, false]]) {
      const out = await exportOf(input, dev);
      expect(errorsOf(out.pkg)).toEqual([]);
      expect(validateZipEntries(out.names, out.pkg).errors).toEqual([]);
      expect(out.names.includes('screenshot.jpg')).toBe(image);
    }
    const withFull = await exportOf(full, { disabledRules: ['html-structure'] });
    expect(withFull.pkg.dom.fullHtml).toEqual(expect.any(String));
    expect(withFull.pkg.redaction.disabledRules).toEqual(['html-structure']);
  });

  it.each(REQUIRED_KEYS)('validator rejects package missing required key %s (AC-7.1)', (key) => {
    const pkg = build();
    delete pkg[key];
    const { ok, errors } = validateSnapshot(pkg);
    expect(ok).toBe(false);
    expect(errors).toContain(`${key}: required key missing`);
  });

  it('validator rejects wrong order: redaction after limits, dom before records (AC-7.2, D10)', () => {
    const { redaction, ...rest } = build();
    const late = {};
    for (const [k, v] of Object.entries(rest)) {
      late[k] = v;
      if (k === 'limits') late.redaction = redaction;
    }
    expect(errorsOf(late).some((e) => e.startsWith('(root): wrong key order'))).toBe(true);
    const pkg = build();
    const { dom, ...noDom } = pkg;
    expect(anyError({ schemaVersion: pkg.schemaVersion, dom, ...noDom }, '(root): wrong key order')).toBe(true);
  });

  it('validator rejects attachments present, unknown key and wrong schemaVersion', () => {
    const pkg = build();
    pkg.attachments = { 'screenshot-0': JPEG_1PX };
    pkg.extra = 1;
    pkg.schemaVersion = 3;
    expect(errorsOf(pkg)).toEqual(expect.arrayContaining([
      'schemaVersion: expected 4, got 3',
      'attachments: removed in v4 (the image is screenshot.jpg in the zip)',
      'extra: unknown top-level key',
    ]));
  });

  it('v3.json is not a valid v4 package', () => {
    const v3 = JSON.parse(readFileSync(v3Url, 'utf8'));
    expect(errorsOf(v3)).toEqual(expect.arrayContaining(['schemaVersion: expected 4, got 3', 'redaction: required key missing']));
  });

  it('validator rejects raw cookie string, bad hash, extra cookie keys, missing total (AC-4.4)', () => {
    const raw = build();
    raw.storage.cookies = `sid=${COOKIE_SID}`;
    expect(errorsOf(raw)).toEqual(['storage.cookies: raw cookie string (v4: [{ name, sizeBytes, valueHash }])']);
    const bad = build();
    bad.storage.cookies[0].valueHash = 'A1B2C3D4E5';
    bad.storage.cookies[1].value = 'yes';
    delete bad.storage.cookiesTotalBytes;
    expect(errorsOf(bad)).toEqual([
      'storage.cookies[0].valueHash: not 8 hex characters: "A1B2C3D4E5"',
      'storage.cookies[1]: keys name, sizeBytes, valueHash, value, expected name, sizeBytes, valueHash',
      'storage.cookiesTotalBytes: not a non-negative integer: undefined',
    ]);
  });

  it('consoleLogs args capped to { truncated: true, preview } is valid; other object shapes are not (E3-TEST0)', () => {
    const pkg = build();
    pkg.consoleLogs[0].args = { truncated: true, preview: '["big-log' };
    expect(anyError(pkg, 'consoleLogs[0].args')).toBe(false);
    pkg.consoleLogs[0].args = { preview: 'x' };
    expect(errorsOf(pkg)).toContain('consoleLogs[0].args: object args must be { truncated: true, preview }');
    pkg.consoleLogs[0].args = { truncated: true, preview: 'x'.repeat(pkg.limits.entryChars + 1) };
    expect(errorsOf(pkg)).toContain('consoleLogs[0].args.preview: longer than limits.entryChars');
  });

  it('validator rejects outerHTML present (dom.html and element summary in console args)', () => {
    const pkg = build();
    pkg.dom.html.outerHTML = '<html></html>';
    const i = pkg.consoleLogs.findIndex((r) => r.args.some((a) => a?.tagName === 'BUTTON'));
    pkg.consoleLogs[i].args[1].outerHTML = '<button></button>';
    expect(errorsOf(pkg)).toEqual([
      `consoleLogs[${i}].args[1].outerHTML: element summary carries outerHTML (v4: structure)`,
      'dom.html.outerHTML: removed in v4 (dom.structure)',
    ]);
  });

  it('validator rejects form value present and password length', () => {
    const pkg = build();
    const els = pkg.dom.forms[0].elements;
    els[0].value = 'x@example.test';
    els[1].valueLength = 8;
    expect(errorsOf(pkg)).toEqual([
      'dom.forms[0].elements[0].value: form fields never carry values (v4: valueLength)',
      'dom.forms[0].elements[1].valueLength: present for a password field',
    ]);
  });

  it('validator: images[].alt and iframes[].title only as lengths, iframe attributes without title (review F7)', () => {
    const ok = build();
    // images and iframes go before the structure tail, as in the collector.
    const entries = Object.entries(ok.dom);
    entries.splice(entries.findIndex(([key]) => key === 'forms'), 0,
      ['images', [{ src: `${BASE}/a.png`, naturalWidth: 1, naturalHeight: 1, width: 1, height: 1, loading: null, altLength: 6 }]],
      ['iframes', [{ src: 'https://pay.example.test/', id: null, name: null, titleLength: 0, attributes: { src: 'https://pay.example.test/' } }]]);
    ok.dom = Object.fromEntries(entries);
    expect(errorsOf(ok)).toEqual([]);
    const pkg = structuredClone(ok);
    pkg.dom.images[0].alt = 'Avatar Zenobii';
    pkg.dom.images[0].altLength = -1;
    pkg.dom.iframes[0].title = 'Konto Zenobii';
    pkg.dom.iframes[0].titleLength = '3';
    pkg.dom.iframes[0].attributes.title = 'Konto Zenobii';
    expect(errorsOf(pkg)).toEqual([
      'dom.images[0].alt: text of alt never goes to the package (v4: altLength)',
      'dom.images[0].altLength: not a non-negative integer: -1',
      'dom.iframes[0].title: text of title never goes to the package (v4: titleLength)',
      'dom.iframes[0].titleLength: not a non-negative integer: "3"',
      'dom.iframes[0].attributes.title: text of title never goes to the package (v4: titleLength)',
    ]);
  });

  it('validator rejects valueLength on a file input and accepts fileCount only there (E3-T8/T9)', () => {
    const ok = build();
    expect(ok.dom.forms[0].elements[2]).toEqual(expect.objectContaining({ type: 'file', fileCount: 0 }));
    expect(errorsOf(ok)).toEqual([]);
    const pkg = build();
    const els = pkg.dom.forms[0].elements;
    els[2].valueLength = 21;
    els[2].fileCount = 1.5;
    els[0].fileCount = 1;
    expect(errorsOf(pkg)).toEqual([
      'dom.forms[0].elements[0].fileCount: present for a field that is not a file input',
      'dom.forms[0].elements[2].valueLength: present for a file input (fileCount says how many files)',
      'dom.forms[0].elements[2].fileCount: not a non-negative integer: 1.5',
    ]);
  });

  it('dom.structure ≤ limits.html unless truncated.html; structure and fullHtml last; fullHtml only with html-structure off', () => {
    const long = build();
    long.limits.html = 50;
    expect(errorsOf(long)).toEqual([`dom.structure: ${long.dom.structure.length} characters over limits.html without truncated.html`]);
    long.truncated.html = true;
    expect(errorsOf(long)).toEqual([]);
    const order = build();
    const { structure, ...dom } = order.dom;
    order.dom = { structure, ...dom };
    expect(anyError(order, 'dom: structure and fullHtml are not the last keys')).toBe(true);
    const full = build();
    full.dom.fullHtml = '<html></html>';
    expect(errorsOf(full)).toEqual(['dom.fullHtml: full HTML without html-structure in redaction.disabledRules']);
  });

  it('validator rejects masked sum mismatch (AC-4.3)', () => {
    const more = build();
    const section = Object.keys(more.redaction.masked)[0];
    more.redaction.masked[section] += 1;
    expect(errorsOf(more)).toEqual(expect.arrayContaining([expect.stringMatching(/^redaction\.masked: sum \d+, but snapshot\.json has \d+ markers$/)]));
    const extra = build();
    extra.notes.push('Value [redacted:jwt] added after counting.');
    expect(errorsOf(extra)).toEqual(expect.arrayContaining([
      'redaction.masked.notes: 0, but the section has 1 markers',
      expect.stringMatching(/^redaction\.masked: sum/),
    ]));
    const zero = build();
    zero.redaction.masked.steps = 0;
    expect(errorsOf(zero)).toContain('redaction.masked.steps: not a positive integer: 0');
  });

  it('redaction: keys, rulesVersion 1, disabledRules ⊆ Default rules without duplicates, masked sections known (AC-4.5)', () => {
    const pkg = build();
    pkg.redaction.rulesVersion = 2;
    pkg.redaction.disabledRules = ['jwt', 'email', 'email'];
    pkg.redaction.masked.overview = 1;
    expect(errorsOf(pkg)).toEqual(expect.arrayContaining([
      'redaction.rulesVersion: expected 1, got 2',
      'redaction.disabledRules[0]: not a rule that can be turned off: "jwt"',
      'redaction.disabledRules[2]: listed twice: "email"',
      'redaction.masked.overview: not a section of the package',
    ]));
    const keys = build();
    keys.redaction.values = ['x'];
    expect(errorsOf(keys)).toEqual(['redaction: keys rulesVersion, disabledRules, masked, values, expected rulesVersion, disabledRules, masked']);
  });

  it('screenshots[]: file is screenshot.jpg, maskedFields integer or null, no attachment or dataUrl, at most one (AC-6.4)', () => {
    const pkg = build();
    expect(pkg.screenshots[0]).toMatchObject({ file: 'screenshot.jpg', maskedFields: 3 });
    pkg.screenshots[0].file = 'shot.png';
    pkg.screenshots[0].maskedFields = -1;
    pkg.screenshots[0].attachment = 'screenshot-0';
    pkg.screenshots[0].dataUrl = JPEG_1PX;
    expect(errorsOf(pkg)).toEqual([
      'screenshots[0].file: not "screenshot.jpg": "shot.png"',
      'screenshots[0].maskedFields: not a non-negative integer or null: -1',
      'screenshots[0].dataUrl: image bytes belong in screenshot.jpg',
      'screenshots[0].attachment: v3 field, v4 names the zip entry in file',
    ]);
    const two = build();
    two.screenshots.push({ ...two.screenshots[0] });
    expect(errorsOf(two)).toContain('screenshots: 2 entries, the zip holds one image');
  });

  it('steps: no value; file input only as change with fileCount, never valueLength (E3-IN4, AC-3.4)', () => {
    const pkg = build();
    const file = pkg.steps.findIndex((s) => s.inputType === 'file');
    expect(pkg.steps[file]).toMatchObject({ type: 'change', fileCount: 2 });
    pkg.steps[file].valueLength = 2;
    pkg.steps[1].value = 'Sekret123!';
    pkg.steps[1].fileCount = 1;
    expect(errorsOf(pkg)).toEqual([
      'steps[1].value: steps never carry field values',
      'steps[1].fileCount: present for a field that is not a file input',
      `steps[${file}].valueLength: present for a file input (fileCount says how many files)`,
    ]);
    const input = build();
    input.steps[file] = { ...input.steps[file], type: 'input' };
    delete input.steps[file].fileCount;
    expect(errorsOf(input)).toEqual([
      `steps[${file}].type: "input" step on a file input (only change is recorded)`,
      `steps[${file}].fileCount: not a non-negative integer: undefined`,
    ]);
  });

  it('validateZipEntries: order and set of entries; image matches screenshots[]', () => {
    const pkg = build();
    expect(validateZipEntries(['summary.md', 'snapshot.json', 'screenshot.jpg']).errors).toEqual([
      '(zip)[0]: expected snapshot.json, got "summary.md"',
      '(zip)[1]: expected summary.md, got "snapshot.json"',
    ]);
    expect(validateZipEntries(['snapshot.json', 'summary.md', 'screenshot.jpg', 'notes.txt']).errors)
      .toEqual(['(zip): unexpected entries after summary.md: screenshot.jpg, notes.txt']);
    expect(validateZipEntries(['snapshot.json', 'summary.md'], pkg).errors)
      .toEqual(['(zip): screenshots[] names screenshot.jpg, but the zip has no such entry']);
    pkg.screenshots = [];
    expect(validateZipEntries(['snapshot.json', 'summary.md', 'screenshot.jpg'], pkg).errors)
      .toEqual(['(zip): screenshot.jpg present, but screenshots[] is empty']);
    expect(validateZipEntries('snapshot.json').ok).toBe(false);
  });

  // Checks carried over from v3.
  it('CLS without shifts (value 0, t null) is accepted; other metrics need t', () => {
    const pkg = build();
    pkg.vitals[1].CLS = { available: true, value: 0, rating: 'good', t: null, finalized: false, sources: [] };
    expect(errorsOf(pkg)).toEqual([]);
    pkg.vitals[1].LCP.t = null;
    expect(errorsOf(pkg)).toEqual(['vitals[1].LCP.t: not a number: null']);
  });

  it('validator rejects status 0 without statusUnavailable (AC-4.3 E2)', () => {
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
    ok.network.push({
      t: 30, doc: 1, type: 'xhr', method: 'GET', url: `${BASE}/api/x`, status: 0, statusText: null, ok: false, redirected: false,
      durationMs: 1, sizeBytes: null, requestHeaders: {}, responseHeaders: {}, requestBody: null, error: 'error',
    });
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

  it('steps never carry password length or other keys; checkbox/radio no valueLength (AC-3.4, QA F-5)', () => {
    const pkg = build();
    const pass = pkg.steps.findIndex((s) => s.inputType === 'password');
    const box = pkg.steps.findIndex((s) => s.inputType === 'checkbox');
    const key = pkg.steps.findIndex((s) => s.type === 'key');
    pkg.steps[pass].valueLength = 10;
    pkg.steps[box].valueLength = 2;
    pkg.steps[key].key = 'a';
    expect(errorsOf(pkg)).toEqual([
      `steps[${pass}].valueLength: present for a password field`,
      `steps[${box}].valueLength: present for a checkbox or radio`,
      `steps[${key}].key: not a whitelisted key: "a"`,
    ]);
  });

  it('documents kept and overview must match the records in the package', () => {
    const pkg = build();
    const steps0 = pkg.steps.filter((s) => s.doc === 0).length;
    const failed = pkg.overview.failedRequests;
    pkg.overview.failedRequests = 0;
    pkg.documents[0].kept.steps = 1;
    expect(errorsOf(pkg)).toEqual([
      `documents[0].kept.steps: 1, but the package has ${steps0}`,
      `overview.failedRequests: 0, but the package has ${failed}`,
    ]);
  });

  it('empty steps without a note and null section without a note are rejected', () => {
    const pkg = build();
    pkg.steps = [];
    for (const d of pkg.documents) d.kept.steps = 0;
    pkg.overview.steps = 0;
    pkg.dom = null;
    delete pkg.redaction.masked.dom;
    delete pkg.redaction.masked.steps;
    pkg.notes = pkg.notes.filter((n) => !/step/i.test(n));
    // Markers of the removed sections leave the package with them.
    expect(errorsOf(pkg)).toEqual(['steps: empty without a note explaining why', 'dom: null without a note']);
  });

  it('assertValidSnapshot throws with the list of errors', () => {
    const pkg = build();
    delete pkg.vitals;
    expect(() => assertValidSnapshot(pkg)).toThrow(/vitals: required key missing/);
    expect(() => assertValidSnapshot(build())).not.toThrow();
  });
});

describe('fixture v4.json (E3-T7)', () => {
  if (process.env.PDS_UPDATE_FIXTURES === '1') writeFileSync(fixtureUrl, `${built.text}\n`);
  const text = readFileSync(fixtureUrl, 'utf8');
  const fixture = JSON.parse(text);

  it('v4.json passes validator', () => {
    expect(errorsOf(fixture)).toEqual([]);
  });

  it('v4.json is snapshot.json that exportPackage writes for the synthetic input', () => {
    expect(text).toBe(`${built.text}\n`);
  });

  it('v4.json covers 2 documents, cookies, masked storage, structure, file step, element summary, a screenshot', () => {
    expect(fixture.schemaVersion).toBe(4);
    expect(fixture.documents).toHaveLength(2);
    expect(fixture.storage.cookies.map((c) => c.name)).toEqual(['sid', 'consent', 'theme']);
    expect(fixture.storage.cookiesTotalBytes).toEqual(expect.any(Number));
    expect(fixture.storage.localStorage.authToken).toBe('[redacted:key-token]');
    expect(fixture.dom.structure).toMatch(/^<html/);
    expect(fixture.dom.fullHtml).toBeNull();
    expect(fixture.steps.some((s) => s.inputType === 'file' && s.fileCount === 2)).toBe(true);
    expect(fixture.consoleLogs.some((r) => r.args.some((a) => a?.tagName === 'BUTTON' && typeof a.structure === 'string'))).toBe(true);
    expect(fixture.screenshots).toEqual([expect.objectContaining({ file: 'screenshot.jpg', maskedFields: 3 })]);
    expect(Object.keys(fixture.redaction.masked).length).toBeGreaterThan(2);
  });

  it('v4.json holds no trap value (redaction applied) and no image bytes', () => {
    for (const secret of [JWT, TOKEN, EMAIL, PASSWORD, COOKIE_SID]) expect(leaks(secret, text)).toEqual([]);
    expect(text).not.toContain('data:image');
  });

  it('v4.json contains only synthetic domains', () => {
    const urls = text.match(/\b[a-z]+:\/\/[^\s"/]+/gi) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u).toMatch(/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|[\w.-]+\.(test|example|invalid))(:\d+)?$/);
    }
  });
});
