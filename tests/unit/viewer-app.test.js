// @vitest-environment jsdom
// E4-T3b (AC-4.2, AC-4.5, AC-4.7, AC-5.3): viewer shell — loading a package (file input, drag and drop), Polish read errors,
// the newer-version banner, lazy tab switching with a node cache, the Podsumowanie tab (summary.md text 1:1) and the screenshot.
// The record and page tabs (T3c/T3e) are replaced by stubs, except in the trap test, which runs the real renderers.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, TABS, NEWER_BANNER, MAX_FILE_BYTES } from '../../src/viewer/app.js';
import { revokeAll } from '../../src/viewer/dom.js';
import { exportPackage } from '../../src/lib/export.js';
import { createZip } from '../../src/lib/zip.js';
import { READ_ERRORS_PL } from '../../src/lib/package-reader.js';
import { buildSummary } from '../../src/lib/summary.js';

// jsdom replaces the global URL, so build the path from the file name, not with new URL().
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = (name) => JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'snapshots', name), 'utf8'));
const TEMPLATE = readFileSync(join(root, 'src', 'viewer', 'viewer.html'), 'utf8');
const enc = new TextEncoder();
const dec = new TextDecoder();

const STARTED = Date.UTC(2026, 9, 26, 8, 0, 0);
const DATE = new Date(2026, 9, 26, 14, 5, 9);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const RECORD_TABS = ['steps', 'errors', 'network', 'console', 'vitals', 'dom', 'storage'];

// Smallest exportPackage input (shape as in package-reader.test.js); `screenshot: false` leaves the image out.
function exportInput({ screenshot = true } = {}) {
  return {
    meta: {
      extensionVersion: '0.6.0', source: 'extension', startedAt: STARTED, collectedAt: STARTED + 60_000, stopReason: null,
      screenshots: screenshot
        ? [{ epochMs: STARTED + 35_000, mime: 'image/jpeg', width: 1, height: 1, bytes: JPEG.length,
          dataUrl: `data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`, maskedFields: 0 }]
        : [],
    },
    current: {
      protocol: 3, docId: 1, url: 'https://app.example.test/page', timeOrigin: STARTED + 30_000, navigationType: 'navigate', stopReason: null,
      environment: { location: { href: 'https://app.example.test/page', hostname: 'app.example.test', pathname: '/page' } },
      performance: { timeOrigin: STARTED + 30_000, navigation: null, resources: [] },
      storage: { cookies: 'consent=1', localStorage: {}, sessionStorage: {} },
      dom: { counts: { totalElements: 3, forms: 0 }, html: { lang: 'pl' }, forms: [], structure: '<html></html>', structureTruncated: false, omittedElements: 0 },
      consoleLogs: [{ t: 11, level: 'error', args: ['save failed'] }],
      runtimeErrors: [{ t: 12, type: 'error', message: 'TypeError: x is undefined', filename: 'https://app.example.test/a.js', lineno: 1, colno: 2 }],
      network: [{ t: 5, type: 'fetch', method: 'POST', url: 'https://app.example.test/api', status: 500, ok: false, durationMs: 3, error: null }],
      steps: [{ t: 2, type: 'click', selector: '#save', text: 'Zapisz' }],
      truncated: {},
      counts: { consoleLogs: 1, runtimeErrors: 1, network: 1, steps: 1 },
    },
    priorDocs: [],
    docs: [{ id: 1, url: 'https://app.example.test/page' }],
  };
}

function stubRenderers() {
  const calls = Object.fromEntries(RECORD_TABS.map((id) => [id, 0]));
  const renderers = Object.fromEntries(RECORD_TABS.map((id) => [id, (s) => {
    calls[id] += 1;
    const el = document.createElement('section');
    el.dataset.tabPanel = id;
    el.textContent = `stub ${id} ${s.schemaVersion}`;
    return el;
  }]));
  return { renderers, calls };
}

// The body of the real template (header, loader slot, tab bar, main) — the app works on the DOM the generator ships.
function mountTemplate() {
  const body = TEMPLATE.slice(TEMPLATE.indexOf('<body>') + 6, TEMPLATE.indexOf('</body>')).replace(/<script>[\s\S]*?<\/script>/, '');
  document.body.innerHTML = body;
}

const panel = (id) => document.querySelector(`#app [data-tab-panel="${id}"]`);
const tabButton = (id) => document.querySelector(`nav[role="tablist"] button[data-tab="${id}"]`);
const errorText = () => document.getElementById('load-error');
const json = (obj) => enc.encode(JSON.stringify(obj));

let createObjectURL;
let revokeObjectURL;

beforeEach(() => {
  mountTemplate();
  createObjectURL = vi.fn(() => `blob:viewer/${createObjectURL.mock.calls.length}`);
  revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  revokeAll(); // blob: URLs left by an earlier test live in dom.js module state
  revokeObjectURL.mockClear();
});

afterEach(() => {
  document.body.textContent = '';
  delete globalThis.__pwned;
});

describe('viewer app — start screen', () => {
  it('Polish start screen with a file input for .zip/.json, tab bar hidden until a package is loaded', () => {
    createApp({ doc: document, renderers: stubRenderers().renderers });
    expect(document.body.textContent).toContain('Przeciągnij plik paczki tutaj albo wybierz go z dysku.');
    const input = document.getElementById('file');
    expect(input.type).toBe('file');
    expect(input.accept).toBe('.zip,.json');
    expect(document.querySelector('nav[role="tablist"]').hidden).toBe(true);
    expect(TABS.map((t) => t.id)).toEqual(['summary', ...RECORD_TABS]);
    expect(TABS.map((t) => t.label)).toEqual(['Podsumowanie', 'Kroki', 'Błędy', 'Sieć', 'Konsola', 'CWV', 'DOM', 'Storage']);
  });
});

describe('viewer app — Podsumowanie (AC-4.2, AC-5.3)', () => {
  it('zip from exportPackage: Podsumowanie textContent === summary.md entry', async () => {
    const { bytes } = await exportPackage({ input: exportInput(), date: DATE });
    const app = createApp({ doc: document, renderers: stubRenderers().renderers });
    expect(await app.loadBytes(bytes)).toBe(true);
    const { unzipSync } = await import('fflate');
    const summaryMd = dec.decode(unzipSync(bytes)['summary.md']);
    expect(document.getElementById('summary-text').textContent).toBe(summaryMd);
    expect(panel('summary').hidden).toBe(false);
    expect(document.querySelector('nav[role="tablist"]').hidden).toBe(false);
    expect(tabButton('summary').ariaSelected).toBe('true');
    expect(errorText().hidden).toBe(true);
    // header: host, collectedAt, versions, overview counts
    const info = document.getElementById('package-info').textContent;
    expect(info).toContain('app.example.test');
    expect(info).toContain('0.6.0');
    expect(info).toMatch(/Błędy JS: 1/);
  });

  it('bare v3.json: summary is rebuilt from the migrated snapshot', async () => {
    const app = createApp({ doc: document, renderers: stubRenderers().renderers });
    expect(await app.loadBytes(json(fixture('v3.json')))).toBe(true);
    expect(document.getElementById('summary-text').textContent).toBe(buildSummary(app.current().snapshot));
    expect(app.current().snapshot.schemaVersion).toBe(4);
  });

  it('package from before redaction (v3) → banner "Paczka sprzed automatycznej redakcji — może zawierać hasła i tokeny"; gone for v4 (E4-FIX2)', async () => {
    const app = createApp({ doc: document, renderers: stubRenderers().renderers });
    await app.loadBytes(json(fixture('v3.json')));
    const banner = document.getElementById('banner-unredacted');
    expect(banner).not.toBeNull();
    expect(banner.className).toBe('banner');
    expect(banner.textContent).toBe('Paczka sprzed automatycznej redakcji — może zawierać hasła i tokeny');
    // shown once, as the banner, not repeated in the warnings list
    expect(document.body.textContent.split('Paczka sprzed automatycznej redakcji — może zawierać hasła i tokeny')).toHaveLength(2);
    await app.loadBytes(json(fixture('v4.json')));
    expect(document.getElementById('banner-unredacted')).toBeNull();
  });
});

describe('viewer app — screenshot (AC-4.2)', () => {
  it('screenshot shown via blob: when present', async () => {
    const { bytes } = await exportPackage({ input: exportInput(), date: DATE });
    const app = createApp({ doc: document, renderers: stubRenderers().renderers });
    await app.loadBytes(bytes);
    const img = panel('summary').querySelector('img#screenshot');
    expect(img).not.toBeNull();
    expect(img.src).toMatch(/^blob:/);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBe(JPEG.length);
  });

  it('absent → no img; a new package revokes the previous blob: URL', async () => {
    const app = createApp({ doc: document, renderers: stubRenderers().renderers });
    await app.loadBytes((await exportPackage({ input: exportInput(), date: DATE })).bytes);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await app.loadBytes((await exportPackage({ input: exportInput({ screenshot: false }), date: DATE })).bytes);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:viewer/1');
    expect(document.querySelector('#app img')).toBeNull();
    expect(panel('summary').textContent).not.toContain('Zrzut ekranu z paczki');
  });
});

describe('viewer app — tabs (AC-4.2)', () => {
  it('tab switch renders once and reuses the node', async () => {
    const { renderers, calls } = stubRenderers();
    const app = createApp({ doc: document, renderers });
    await app.loadBytes(json(fixture('v4.json')));
    expect(calls.network).toBe(0); // lazy: only Podsumowanie at load
    tabButton('network').click();
    const first = panel('network');
    expect(first.hidden).toBe(false);
    expect(panel('summary').hidden).toBe(true);
    expect(tabButton('network').ariaSelected).toBe('true');
    expect(tabButton('summary').ariaSelected).toBe('false');
    tabButton('summary').click();
    expect(first.hidden).toBe(true);
    tabButton('network').click();
    expect(calls.network).toBe(1);
    expect(panel('network')).toBe(first);
    expect(document.querySelectorAll('#app [data-tab-panel="network"]')).toHaveLength(1);
    for (const id of RECORD_TABS) tabButton(id).click();
    expect(Object.values(calls)).toEqual(RECORD_TABS.map(() => 1));
  });

  it('a new package drops the cache and starts again on Podsumowanie', async () => {
    const { renderers, calls } = stubRenderers();
    const app = createApp({ doc: document, renderers });
    await app.loadBytes(json(fixture('v4.json')));
    tabButton('dom').click();
    await app.loadBytes(json(fixture('v3.json')));
    expect(panel('dom')).toBeNull();
    expect(panel('summary').hidden).toBe(false);
    expect(tabButton('summary').ariaSelected).toBe('true');
    tabButton('dom').click();
    expect(calls.dom).toBe(2);
  });

  it('arrow keys move between tabs', async () => {
    const app = createApp({ doc: document, renderers: stubRenderers().renderers });
    await app.loadBytes(json(fixture('v4.json')));
    tabButton('summary').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tabButton('steps').ariaSelected).toBe('true');
    tabButton('steps').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    tabButton('summary').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(tabButton('storage').ariaSelected).toBe('true');
  });

  it('a renderer that throws or returns nothing → Polish message in the panel, other tabs still work', async () => {
    const { renderers } = stubRenderers();
    renderers.errors = () => {
      throw new Error('boom');
    };
    renderers.console = () => null;
    const app = createApp({ doc: document, renderers });
    await app.loadBytes(json(fixture('v4.json')));
    tabButton('errors').click();
    expect(panel('errors').textContent).toBe('Nie udało się pokazać tej zakładki.');
    tabButton('console').click();
    expect(panel('console').textContent).toBe('Nie udało się pokazać tej zakładki.');
    tabButton('steps').click();
    expect(panel('steps').textContent).toBe('stub steps 4');
  });
});

describe('viewer app — read errors (AC-4.7)', () => {
  it('corrupt zip / non-package / empty → Polish message, start screen stays usable', async () => {
    const app = createApp({ doc: document, renderers: stubRenderers().renderers });
    const { bytes: zip } = await createZip([{ name: 'snapshot.json', data: json(fixture('v4.json')), compress: true }], { date: DATE });
    const corrupt = zip.slice(0, zip.length - 30);
    expect(await app.loadBytes(corrupt)).toBe(false);
    expect(errorText().hidden).toBe(false);
    expect(Object.values(READ_ERRORS_PL)).toContain(errorText().textContent);
    expect(errorText().getAttribute('role')).toBe('alert');
    expect(document.querySelector('nav[role="tablist"]').hidden).toBe(true);

    expect(await app.loadBytes(enc.encode('hello, not a package'))).toBe(false);
    expect(errorText().textContent).toBe(READ_ERRORS_PL['not-package']);
    expect(await app.loadBytes(new Uint8Array(0))).toBe(false);
    expect(errorText().textContent).toBe(READ_ERRORS_PL['not-package']);
    expect(await app.loadBytes(enc.encode('{"schemaVersion": 4, '))).toBe(false);
    expect(errorText().textContent).toBe(READ_ERRORS_PL.corrupt);

    // still usable: a good file afterwards loads and clears the message
    expect(await app.loadBytes(json(fixture('v4.json')))).toBe(true);
    expect(errorText().hidden).toBe(true);
    expect(panel('summary')).not.toBeNull();
  });

  it('error after a loaded package keeps that package on screen', async () => {
    const app = createApp({ doc: document, renderers: stubRenderers().renderers });
    await app.loadBytes(json(fixture('v4.json')));
    const shown = panel('summary');
    expect(await app.loadBytes(enc.encode('nope'))).toBe(false);
    expect(errorText().textContent).toBe(READ_ERRORS_PL['not-package']);
    expect(panel('summary')).toBe(shown);
    expect(document.querySelector('nav[role="tablist"]').hidden).toBe(false);
  });

  it('schemaVersion 5 → data shown with the warning banner', async () => {
    const v5 = { ...fixture('v4.json'), schemaVersion: 5 };
    const app = createApp({ doc: document, renderers: stubRenderers().renderers });
    expect(await app.loadBytes(json(v5))).toBe(true);
    const banner = document.getElementById('banner-newer');
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toBe(NEWER_BANNER);
    expect(NEWER_BANNER).toBe('Nowsza wersja paczki — część danych może być niewidoczna.');
    expect(document.getElementById('summary-text').textContent).toBe(buildSummary(v5));
    // a v4 package afterwards: banner gone
    await app.loadBytes(json(fixture('v4.json')));
    expect(document.getElementById('banner-newer')).toBeNull();
  });

  it('file larger than MAX_FILE_BYTES is refused before reading', async () => {
    const app = createApp({ doc: document, renderers: stubRenderers().renderers });
    const arrayBuffer = vi.fn();
    expect(await app.loadFile({ name: 'big.zip', size: MAX_FILE_BYTES + 1, arrayBuffer })).toBe(false);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(errorText().textContent).toBe(READ_ERRORS_PL['too-large']);
  });
});

describe('viewer app — file input and drag and drop (AC-4.1)', () => {
  const fileOf = (bytes, name = 'paczka.json') => ({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) });

  it('choosing a file in the input loads it', async () => {
    const app = createApp({ doc: document, renderers: stubRenderers().renderers });
    const input = document.getElementById('file');
    Object.defineProperty(input, 'files', { value: [fileOf(json(fixture('v4.json')))], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await app.idle();
    expect(panel('summary')).not.toBeNull();
  });

  it('dropping a file anywhere on the page loads it; dragover is accepted (no navigation to the file)', async () => {
    const app = createApp({ doc: document, renderers: stubRenderers().renderers });
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: { types: ['Files'], dropEffect: 'none' } });
    document.body.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [fileOf(json(fixture('v4.json')))] } });
    document.querySelector('main').dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    await app.idle();
    expect(panel('summary')).not.toBeNull();
  });

  it('drop without a file → Polish hint', async () => {
    const app = createApp({ doc: document, renderers: stubRenderers().renderers });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });
    document.body.dispatchEvent(drop);
    await app.idle();
    expect(errorText().textContent).toBe('Upuść plik paczki (.zip albo .json).');
  });

  it('only the last of two overlapping loads is shown', async () => {
    const app = createApp({ doc: document, renderers: stubRenderers().renderers });
    let release;
    const slow = { name: 'a.json', size: 10, arrayBuffer: () => new Promise((r) => { release = r; }) };
    const first = app.loadFile(slow);
    await app.loadBytes(json({ ...fixture('v4.json'), extensionVersion: '9.9.9' }));
    const v3 = json(fixture('v3.json'));
    release(v3.buffer.slice(v3.byteOffset, v3.byteOffset + v3.length));
    expect(await first).toBe(false);
    expect(app.current().snapshot.extensionVersion).toBe('9.9.9');
  });
});

describe('viewer app — nothing from the package becomes markup (AC-4.5)', () => {
  const TRAPS = [
    '<script>globalThis.__pwned = 1</script>',
    '<img src=x onerror="globalThis.__pwned = 1">',
    'javascript:globalThis.__pwned = 1',
    '<a href="javascript:globalThis.__pwned = 1">klik</a>',
  ];

  function trapSnapshot() {
    const s = fixture('v4.json');
    const trap = TRAPS.join(' ');
    s.extensionVersion = trap;
    s.collectedAt = trap;
    s.environment.location.hostname = trap;
    s.environment.location.href = `javascript:globalThis.__pwned = 1//${trap}`;
    s.notes = [...s.notes, trap];
    s.consoleLogs.push({ t: 50, doc: 0, level: 'error', args: TRAPS });
    s.runtimeErrors.push({ ...s.runtimeErrors[0], message: trap, stack: trap });
    s.network.push({ ...s.network[0], url: 'javascript:globalThis.__pwned = 1', statusText: trap, responseHeaders: { [trap]: trap } });
    s.steps.push({ ...s.steps[0], selector: trap, text: trap });
    s.storage.localStorage[trap] = trap;
    s.storage.cookies.push({ name: trap, sizeBytes: 1, valueHash: trap });
    s.dom.structure = trap;
    return s;
  }

  it('trap fixture leaves no <script>/<img onerror>/<a> in DOM on any tab (real renderers)', async () => {
    const app = createApp({ doc: document });
    expect(await app.loadBytes(json(trapSnapshot()))).toBe(true);
    for (const { id } of TABS) tabButton(id).click();
    expect(document.querySelectorAll('script, a, iframe, svg, object, embed, link, style')).toHaveLength(0);
    expect(document.querySelectorAll('img')).toHaveLength(0); // no screenshot in the package, so no image at all
    for (const el of document.body.querySelectorAll('*')) {
      for (const attr of el.attributes) expect(attr.name).not.toMatch(/^(on|href|src|style)/);
    }
    expect(document.body.textContent).toContain('<img src=x onerror=');
    expect(globalThis.__pwned).toBeUndefined();
  });
});
