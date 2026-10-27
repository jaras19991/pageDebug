// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { unzipSync } from 'fflate';
import { exportPackage, exportAssembled, EXPORT_LIMITS, EXPORT_NOTES } from '../../src/lib/export.js';
import { SCREENSHOT_NOTES } from '../../src/lib/package.js';
import { heavyPackage } from './helpers/heavy-package.js';
import { validateSnapshot } from '../helpers/snapshot-validator.js';
import { JWT, TOKEN, EMAIL, PASSWORD, COOKIE_SID, leaks, countOccurrences } from './helpers/redaction-traps.js';

const MB2 = 2097152;
const MB10 = 10485760;
const STARTED = Date.UTC(2026, 9, 26, 8, 0, 0);
const DATE = new Date(2026, 9, 26, 14, 5, 9); // local time, like the reporter's clock
const KEY_ORDER = [
  'schemaVersion', 'extensionVersion', 'source', 'collectedAt', 'recordingStartedAt', 'recordingStoppedReason', 'timeOrigin',
  'overview', 'redaction', 'limits', 'truncated',
  'documents', 'notes', 'steps', 'runtimeErrors', 'network', 'vitals', 'screenshots', 'consoleLogs',
  'environment', 'performance', 'storage', 'dom',
];
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const JPEG_URL = `data:image/jpeg;base64,${Buffer.from(JPEG_BYTES).toString('base64')}`;
const PW_PLAIN = 'Kowalski-Plain-Pw-77';

const dec = new TextDecoder();

function unzip(bytes) {
  const files = unzipSync(bytes);
  const names = Object.keys(files);
  const text = Object.fromEntries(names.map((n) => [n, dec.decode(files[n])]));
  return { files, names, text, json: JSON.parse(text['snapshot.json']) };
}

function shot(over = {}) {
  return { epochMs: STARTED + 30_000 + 5000, mime: 'image/jpeg', width: 1, height: 1, bytes: JPEG_BYTES.length, dataUrl: JPEG_URL, maskedFields: 2, ...over };
}

// A `collect` result (protocol 3 shape) with a trap in each place the reporter could leak a secret (AC-3.5 unit level).
function current(over = {}) {
  return {
    protocol: 3,
    docId: 1,
    url: 'https://app.example.test/login',
    timeOrigin: STARTED + 30_000,
    navigationType: 'navigate',
    stopReason: null,
    environment: {
      location: { href: `https://app.example.test/login?access_token=${TOKEN}`, hostname: 'app.example.test', pathname: '/login' },
      navigator: { userAgent: 'Mozilla/5.0 Test', language: 'pl-PL' },
      viewport: { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 },
    },
    performance: { timeOrigin: STARTED + 30_000, navigation: null, resources: [] },
    storage: {
      cookies: `sid=${COOKIE_SID}; consent=1`,
      localStorage: { token: TOKEN, contact: EMAIL, theme: 'dark' },
      sessionStorage: {},
    },
    dom: {
      counts: { totalElements: 5, forms: 1 },
      html: { doctype: null, lang: 'pl', charset: 'UTF-8', compatMode: 'CSS1Compat' },
      forms: [{
        id: 'login', name: null, method: 'post', action: 'https://app.example.test/login', enctype: null,
        elements: [
          { tagName: 'INPUT', type: 'email', name: 'email', id: 'e', valueLength: EMAIL.length },
          { tagName: 'INPUT', type: 'text', name: 'pw2', id: 'p2', value: PW_PLAIN },
          { tagName: 'INPUT', type: 'password', name: 'pw', id: 'p', value: PASSWORD },
        ],
      }],
      structure: '<html lang="pl"><body><form id="login"><input type="email"><input type="password"></form></body></html>',
      structureTruncated: false,
      omittedElements: 0,
      fullHtml: '<html><body><form><input type="password" value="x"></form></body></html>',
    },
    consoleLogs: [
      { t: 10, level: 'log', args: [`session ${JWT}`, { password: PASSWORD, user: EMAIL }] },
      { t: 11, level: 'error', args: ['login failed'], stack: 'Error: login failed\n    at https://app.example.test/app.js:1:1' },
    ],
    runtimeErrors: [{ t: 12, type: 'error', message: `token=${TOKEN}`, filename: 'https://app.example.test/app.js', lineno: 1, colno: 1, stack: 'Error' }],
    network: [{
      t: 5, type: 'fetch', method: 'POST', url: `https://app.example.test/api/login?access_token=${TOKEN}`, status: 401, statusText: 'Unauthorized',
      ok: false, redirected: false, durationMs: 3, sizeBytes: 20, requestHeaders: { authorization: `Bearer ${TOKEN}` }, responseHeaders: {},
      requestBody: JSON.stringify({ email: EMAIL, password: PASSWORD }), error: null,
    }],
    steps: [{ t: 2, type: 'click', selector: '#login button', text: 'Zaloguj' }],
    truncated: {},
    counts: { consoleLogs: 2, runtimeErrors: 1, network: 1, steps: 1 },
    ...over,
  };
}

function input({ metaOver = {}, cur = current() } = {}) {
  return {
    meta: { extensionVersion: '0.5.0', source: 'extension', startedAt: STARTED, collectedAt: STARTED + 60_000, stopReason: null, screenshots: [shot()], ...metaOver },
    current: cur,
    priorDocs: [],
    docs: [{ id: 1, url: 'https://app.example.test/login' }],
  };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('exportPackage (E3-T4b, design D8)', () => {
  it('contract: { bytes, fileName, packageBytes, snapshot }; snapshot.json is the returned snapshot', async () => {
    const out = await exportPackage({ input: input(), devOptions: {}, date: DATE, origin: 'https://app.example.test:8443' });
    expect(out.bytes).toBeInstanceOf(Uint8Array);
    expect(out.fileName).toBe('snapshot-app.example.test-20261026-140509.zip');
    expect(out.packageBytes).toBe(out.bytes.length);
    const { json } = unzip(out.bytes);
    expect(json).toEqual(JSON.parse(JSON.stringify(out.snapshot)));
  });

  it('file name falls back to the current document when no origin is given (AC-1.1)', async () => {
    const out = await exportPackage({ input: input(), date: DATE });
    expect(out.fileName).toBe('snapshot-app.example.test-20261026-140509.zip');
  });

  it('Object.keys order v4; no attachments; redaction after overview', async () => {
    const { json } = unzip((await exportPackage({ input: input(), date: DATE })).bytes);
    expect(Object.keys(json)).toEqual(KEY_ORDER);
    expect(json.schemaVersion).toBe(4);
    expect(json).not.toHaveProperty('attachments');
    expect(Object.keys(json.redaction)).toEqual(['rulesVersion', 'disabledRules', 'masked']);
  });

  it('zip entries: snapshot.json first, summary.md, screenshot.jpg only with shot; no base64 image in snapshot.json; screenshots[].file names the entry (AC-6.4)', async () => {
    const withShot = unzip((await exportPackage({ input: input(), date: DATE })).bytes);
    expect(withShot.names).toEqual(['snapshot.json', 'summary.md', 'screenshot.jpg']);
    expect(withShot.files['screenshot.jpg']).toEqual(JPEG_BYTES);
    expect(withShot.json.screenshots).toHaveLength(1);
    expect(withShot.json.screenshots[0]).toMatchObject({ file: 'screenshot.jpg', maskedFields: 2, bytes: JPEG_BYTES.length });
    expect(withShot.text['snapshot.json']).not.toContain('data:image');
    expect(withShot.text['snapshot.json']).not.toContain(JPEG_URL.slice(23, 40));
    expect(withShot.text['summary.md']).toContain('obraz: screenshot.jpg');

    const without = unzip((await exportPackage({ input: input({ metaOver: { screenshots: [] } }), date: DATE })).bytes);
    expect(without.names).toEqual(['snapshot.json', 'summary.md']);
  });

  it('screenshot off → screenshots [] + reporter note, no image entry (AC-2.1)', async () => {
    const out = await exportPackage({ input: input({ metaOver: { screenshotOff: true } }), date: DATE });
    const { names, json, text } = unzip(out.bytes);
    expect(names).toEqual(['snapshot.json', 'summary.md']);
    expect(json.screenshots).toEqual([]);
    expect(json.overview.screenshot).toBe(false);
    expect(json.notes).toContain(SCREENSHOT_NOTES.off);
    expect(text['summary.md']).toContain('- Zrzut ekranu: wyłączony przez zgłaszającego');
  });

  it('trap values (JWT, cookie, email, password, access_token) absent from every zip entry bytes (AC-3.5)', async () => {
    const { text, json } = unzip((await exportPackage({ input: input(), date: DATE })).bytes);
    for (const [name, content] of Object.entries(text)) {
      for (const secret of [JWT, TOKEN, PASSWORD, PW_PLAIN, COOKIE_SID]) expect([name, secret, leaks(secret, content)]).toEqual([name, secret, []]);
      // 8-character fragments of the e-mail would match the synthetic host name (example.test); check the address and its user.
      expect([name, content.includes(EMAIL) || content.includes('jan.trap')]).toEqual([name, false]);
    }
    expect(json.storage.cookies.map((c) => c.name)).toEqual(['sid', 'consent']);
    expect(json.storage.cookies[0].valueHash).toMatch(/^[0-9a-f]{8}$/);
    expect(json.dom.forms[0].elements[1]).toMatchObject({ valueLength: PW_PLAIN.length });
  });

  it('sum redaction.masked == count of "[redacted:" in snapshot.json after budget cuts (AC-4.3)', async () => {
    const pkg = heavyPackage({ logs: 1500, logChars: 4000, requests: 800, errors: 50, resources: 300 });
    pkg.consoleLogs.forEach((r, i) => { if (i % 3 === 0) r.args.push(`token=${TOKEN}${i} mail ${EMAIL}`); });
    const out = await exportAssembled(pkg, { date: DATE });
    const { text, json } = unzip(out.bytes);
    expect(json.truncated.consoleLogs).toBe(true);
    const sum = Object.values(json.redaction.masked).reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBe(countOccurrences(text['snapshot.json'], '[redacted:'));
  });

  it('summary.md built from redacted snapshot contains the line (AC-4.3)', async () => {
    const { text, json } = unzip((await exportPackage({ input: input(), date: DATE })).bytes);
    const values = Object.values(json.redaction.masked);
    const total = values.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(4);
    expect(text['summary.md']).toContain(`Zamaskowano ${total} wartości w ${values.length} sekcjach (reguły v2). Hasła, tokeny i dane logowania nie są w tym pliku.`);
    expect(text['summary.md']).toContain('# Paczka diagnostyczna — app.example.test');
  });

  it('fullHtml in disabledRules → limits.packageBytes 10 MB, dom.fullHtml kept and redacted (AC-6.3)', async () => {
    const full = await exportPackage({ input: input(), devOptions: { disabledRules: ['html-structure', 'jwt'] }, date: DATE });
    const { json } = unzip(full.bytes);
    expect(json.limits.packageBytes).toBe(MB10);
    expect(json.redaction.disabledRules).toEqual(['html-structure']);
    expect(json.dom.fullHtml).toContain('[redacted:form-value]');
    expect(JSON.stringify(json)).not.toContain(JWT.slice(0, 20));

    const plain = unzip((await exportPackage({ input: input(), date: DATE })).bytes).json;
    expect(plain.limits.packageBytes).toBe(MB2);
    expect(plain.dom.fullHtml).toBeNull();
    expect(plain.redaction.disabledRules).toEqual([]);
  });

  it('never throws on oversized input; save not blocked (AC-6.3)', async () => {
    // Protected entries (runtime errors) that alone do not fit: the package is written anyway, with a note.
    let x = 7;
    const letters = () => {
      let s = '';
      for (let i = 0; i < 8000; i++) {
        x = (Math.imul(x, 1103515245) + 12345) >>> 0;
        s += i % 7 === 6 ? ' ' : String.fromCharCode(97 + (x >>> 27) % 26);
      }
      return s;
    };
    const errors = Array.from({ length: 1000 }, (_, i) => ({ t: i, type: 'error', message: letters(), filename: null, lineno: 0, colno: 0, stack: null }));
    const out = await exportPackage({ input: input({ cur: current({ runtimeErrors: errors, counts: { runtimeErrors: 1000 } }) }), date: DATE });
    const { json } = unzip(out.bytes);
    expect(out.bytes.length).toBeGreaterThan(MB2);
    expect(json.runtimeErrors).toHaveLength(1000);
    expect(json.notes.some((n) => /^Package is larger than 2 MB \(\d+ bytes\) after all cuts\.$/.test(n))).toBe(true);

    const empty = await exportPackage({ input: { meta: { extensionVersion: '0.5.0', source: 'console', startedAt: STARTED, collectedAt: STARTED }, current: null } });
    expect(unzip(empty.bytes).names).toEqual(['snapshot.json', 'summary.md']);
    expect(empty.fileName).toMatch(/^snapshot-local-\d{8}-\d{6}\.zip$/);
  });

  it('structure just under limits.html that redaction makes longer → cut with closed tags, truncated.html and a note (T7 → T9)', async () => {
    const item = (i) => `<div data-user="u${i % 10}@ex.pl"><span class="c"></span></div>`;
    const items = [];
    let length = '<html><body></body></html>'.length;
    for (let i = 0; length + item(i).length < 299_990; i++) {
      items.push(item(i));
      length += item(i).length;
    }
    const structure = `<html><body>${items.join('')}</body></html>`;
    expect(structure.length).toBeLessThanOrEqual(300_000);
    expect(structure.length).toBeGreaterThan(299_900);
    const cur = current();
    cur.dom = { ...cur.dom, structure, fullHtml: null };
    const { json } = unzip((await exportPackage({ input: input({ cur }), date: DATE })).bytes);
    expect(json.limits.html).toBe(300_000);
    expect(json.dom.structure.length).toBeLessThanOrEqual(300_000);
    expect(json.dom.structure).toMatch(/<\/span><\/div><\/body><\/html>$/);
    expect(json.dom.structure).not.toContain('@ex.pl');
    expect(json.dom.structure).toContain('data-user="[redacted:email]"');
    expect(json.truncated.html).toBe(true);
    expect(json.notes).toContain('dom.structure was cut to 300000 characters after redaction.');
    expect(validateSnapshot(json).errors).toEqual([]);
  });

  it('E3-PD1: strings at their limit that redaction makes longer are cut back, never inside a marker; the package validates', async () => {
    // Each value ends 6 characters into a secret: the marker is longer than what it replaces.
    const preview = `${'a'.repeat(40_000 - '{"password":"Sekret'.length)}{"password":"Sekret`;
    const stack = `Error: x\n${'b'.repeat(16_000 - 'Error: x\n{"token":"Sekret'.length)}{"token":"Sekret`;
    const body = `${'c'.repeat(4096 - '{"session":"Sekret'.length)}{"session":"Sekret`;
    expect([preview.length, stack.length, body.length]).toEqual([40_000, 16_000, 4096]);
    const cur = current();
    cur.consoleLogs = [{ t: 10, level: 'log', args: { truncated: true, preview }, stack }];
    cur.runtimeErrors = [{ t: 12, type: 'error', message: 'x', filename: null, lineno: 1, colno: 1, stack }];
    cur.network = [{ ...cur.network[0], responseBodyPreview: body, responseBodyTruncated: false }];
    const { json } = unzip((await exportPackage({ input: input({ cur }), date: DATE })).bytes);
    const log = json.consoleLogs[0];
    expect(log.args.preview.length).toBeLessThanOrEqual(json.limits.entryChars);
    expect(log.stack.length).toBeLessThanOrEqual(json.limits.stackChars);
    expect(json.runtimeErrors[0].stack.length).toBeLessThanOrEqual(json.limits.stackChars);
    expect(json.network[0].responseBodyPreview.length).toBeLessThanOrEqual(json.limits.responseBodyChars);
    expect(json.network[0].responseBodyTruncated).toBe(true);
    for (const text of [log.args.preview, log.stack, json.runtimeErrors[0].stack, json.network[0].responseBodyPreview]) {
      expect(text).not.toContain('Sekret');
      expect(text).not.toMatch(/\[r?e?d?a?c?t?e?d?:?[a-z-]*$/); // no half of a marker at the end
    }
    expect(validateSnapshot(json).errors).toEqual([]);
  });

  it('N11: over responseBodyTotalChars after redaction the OLDEST previews give the excess back; the newest stays whole', async () => {
    // 69 previews of e-mails grow past responseBodyChars when masked; the last one (the error) has none.
    const emails = 'a@b.pl '.repeat(Math.ceil(3700 / 7)).slice(0, 3700);
    const last = `{"error":"validation failed","detail":"${'x'.repeat(3600)}"}`;
    const cur = current();
    cur.network = Array.from({ length: 70 }, (_, i) => ({
      ...cur.network[0], t: 5 + i, url: `https://app.example.test/api/item/${i}`, requestBody: null,
      responseBodyPreview: i === 69 ? last : emails, responseBodyTruncated: false,
    }));
    cur.counts = { ...cur.counts, network: 70 };
    const { json } = unzip((await exportPackage({ input: input({ cur }), date: DATE })).bytes);
    const previews = json.network.map((entry) => entry.responseBodyPreview);
    expect(previews).toHaveLength(70);
    expect(previews.at(-1)).toBe(last);
    expect(previews.reduce((sum, p) => sum + (p?.length ?? 0), 0)).toBeLessThanOrEqual(json.limits.responseBodyTotalChars);
    expect(previews[0].length).toBeLessThan(previews[68].length);
    expect(previews.join('')).not.toContain('@');
  });

  it('no CompressionStream → stored zip that still opens, with a note', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const out = await exportPackage({ input: input(), date: DATE });
    const { json, names } = unzip(out.bytes);
    expect(names[0]).toBe('snapshot.json');
    expect(json.notes).toContain(EXPORT_NOTES.notCompressed);
    expect(EXPORT_NOTES.notCompressed).toBe('The package is not compressed (this browser cannot compress).');
  });
});

describe('export: budget before and after redaction (design D8, state "Do domknięcia" T2a/b)', () => {
  it('heavy package (helpers/heavy-package.js) → zip ≤ 2 097 152 bytes with real compression; protected sections intact (AC-6.1, AC-6.2)', async () => {
    const pkg = heavyPackage();
    const started = performance.now();
    const out = await exportAssembled(pkg, { screenshot: new Uint8Array(200000), date: DATE });
    const ms = performance.now() - started;
    const { json, names, text } = unzip(out.bytes);
    expect(out.bytes.length).toBeLessThanOrEqual(MB2);
    expect(names).toEqual(['snapshot.json', 'summary.md', 'screenshot.jpg']);
    expect(text['snapshot.json'].length).toBeLessThanOrEqual(MB10);
    expect(json.runtimeErrors).toHaveLength(1000);
    expect(json.steps).toHaveLength(200);
    expect(json.network.filter((r) => r.status >= 400 || r.error !== null)).toHaveLength(pkg.network.filter((r) => r.status >= 400 || r.error !== null).length);
    expect(json.vitals).toEqual(pkg.vitals);
    expect(json.overview.consoleErrors).toBe(json.consoleLogs.filter((r) => r.level === 'error').length);
    // One note per cut step, even when both budget passes cut the same section.
    const cutNotes = json.notes.filter((n) => /to fit the package size limit/.test(n));
    const kinds = cutNotes.map((n) => n.replace(/^\d+ /, '').replace(/by \d+ characters/, ''));
    expect(new Set(kinds).size).toBe(kinds.length);
    // AC-1.5 is 5 s for the whole save; the spec's risk signal is 3 s.
    expect(ms).toBeLessThan(3000);
  }, 30000);

  it('QA F-2: a note gives the whole loss of a record section (recorded in documents[].counts vs kept)', async () => {
    const pkg = heavyPackage();
    pkg.documents[0].counts = { ...pkg.documents[0].counts, consoleLogs: 5000 };
    const { json } = unzip((await exportAssembled(pkg, { date: DATE })).bytes);
    const kept = json.consoleLogs.length;
    expect(kept).toBeLessThan(pkg.consoleLogs.length);
    expect(json.notes).toContain(EXPORT_NOTES.recordLoss('consoleLogs', 5000, kept));
    expect(EXPORT_NOTES.recordLoss('consoleLogs', 5000, 55)).toBe('consoleLogs: 5000 recorded, 55 in the package; 4945 were not included (recording limits, time limit or package size limit).');
    const small = heavyPackage({ logs: 10, requests: 10, errors: 1, resources: 0, structureChars: 1000 });
    const notes = unzip((await exportAssembled(small, { date: DATE })).bytes).json.notes;
    expect(notes.filter((n) => / recorded, \d+ in the package/.test(n))).toEqual([]);
  }, 30000);

  it('redaction + compression of 5 MB JSON ≤ 1.5 s (median of 5) (NFR)', async () => {
    const pkg = heavyPackage({ logs: 700, logChars: 3000, requests: 500, errors: 50, resources: 300, structureChars: 200000 });
    const chars = JSON.stringify(pkg, null, 2).length;
    expect(chars).toBeGreaterThan(4.5 * 1048576);
    expect(chars).toBeLessThan(6 * 1048576);
    const times = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      await exportAssembled(pkg, { date: DATE });
      times.push(performance.now() - started);
    }
    expect(median(times)).toBeLessThanOrEqual(1500);
  }, 60000);

  it('5000 console logs end to end (assemble → zip) ≤ 1.5 s (AC-1.5 helper)', async () => {
    const logs = Array.from({ length: 5000 }, (_, i) => ({ t: i, level: ['log', 'info', 'warn', 'error'][i % 4], args: [`flood entry ${i} user=${i % 97} state ok`, { i, ok: true }] }));
    const started = performance.now();
    const out = await exportPackage({ input: input({ cur: current({ consoleLogs: logs, counts: { consoleLogs: 5000 } }) }), date: DATE });
    const ms = performance.now() - started;
    expect(unzip(out.bytes).json.consoleLogs).toHaveLength(5000);
    expect(ms).toBeLessThanOrEqual(1500);
  }, 30000);

  it('the cut before redaction never leaves half of a secret: storage values (step 5)', async () => {
    // > 10 MB of storage → the first pass reaches the storage step and would cut each value at 1000 characters,
    // right inside the secret below (a JSON string value, an e-mail cut after `@`).
    const pkg = heavyPackage({ logs: 0, requests: 0, errors: 0, resources: 0, structureChars: 1000 });
    const filler = 'lorem '.repeat(200000);
    const local = {};
    for (let i = 0; i < 6; i++) local[`draft-${i}`] = `${'lorem '.repeat(163)}{"password":"correct horse battery staple"} ${filler}`;
    for (let i = 0; i < 6; i++) local[`contact-${i}`] = `${'lorem '.repeat(164)}jantrapkowalski@example.com ${filler}`;
    pkg.storage = { cookies: [], cookiesTotalBytes: 0, localStorage: local, sessionStorage: {} };
    expect(local['draft-0'].indexOf('correct')).toBeLessThan(1000);
    expect(local['contact-0'].indexOf('@')).toBe(999);
    expect(JSON.stringify(pkg).length).toBeGreaterThan(EXPORT_LIMITS.redactJsonChars);

    const { text, json } = unzip((await exportAssembled(pkg, { date: DATE })).bytes);
    expect(json.truncated.storage).toBe(true);
    for (const content of Object.values(text)) {
      expect(content).not.toContain('correct horse');
      expect(content).not.toMatch(/"correct\b/);
      expect(content).not.toContain('jantrapkowalski');
    }
    expect(json.notes.filter((n) => /storage values were cut/.test(n))).toHaveLength(1);
  }, 30000);

  it('the cut before redaction never leaves half of a secret: stacks (step 7)', async () => {
    const pkg = heavyPackage({ logs: 0, requests: 0, errors: 0, resources: 0, structureChars: 1000 });
    const head = `Error: boom\n${'    at run (app.js:1:1)\n'.repeat(170)}`.slice(0, 3977);
    const stack = `${head}{"password":"correct horse battery staple"}\n${'    at next (app.js:2:2)\n'.repeat(500)}`;
    // The cut at 4000 characters falls inside "horse": a cut before redaction would keep `{"password":"correct `.
    expect(stack.indexOf('correct ') + 'correct '.length).toBeLessThan(4000);
    expect(stack.indexOf('horse') + 'horse'.length).toBeGreaterThan(4000);
    pkg.runtimeErrors = Array.from({ length: 1000 }, (_, i) => ({ t: i, doc: 0, type: 'error', message: `boom ${i}`, filename: null, lineno: 1, colno: 1, stack }));
    expect(JSON.stringify(pkg).length).toBeGreaterThan(EXPORT_LIMITS.redactJsonChars);

    const { text, json } = unzip((await exportAssembled(pkg, { date: DATE })).bytes);
    expect(json.runtimeErrors).toHaveLength(1000);
    for (const content of Object.values(text)) {
      expect(content).not.toContain('correct horse');
      expect(content).not.toMatch(/"correct\b/);
    }
  }, 30000);
});
