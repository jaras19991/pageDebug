// E4-TEST2: the standalone viewer (src/standalone/viewer.html) opened from file:// in Chromium without the extension.
// AC-4.1 (v4 zip, v3/v2 json, Polish UI, 0 requests), AC-4.2 (8 tabs ≤ 300 ms, screenshot), AC-4.4 (network filter on
// 5000 entries ≤ 500 ms), AC-4.5 (XSS traps: no flag, no dialog, no request, no javascript: anchor), AC-4.6 (heavy zip
// first tab ≤ 3 s, median of 3), AC-4.7 (corrupt / not a package / schema 5).
import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exportedZip, fixtureJson, heavyZip, networkSnapshot, zipOfSnapshot } from './helpers/packages.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VIEWER = pathToFileURL(resolve(ROOT, 'src/standalone/viewer.html')).href;
const TAB_IDS = ['summary', 'steps', 'errors', 'network', 'console', 'vitals', 'dom', 'storage'];
const TAB_LABELS = ['Podsumowanie', 'Kroki', 'Błędy', 'Sieć', 'Konsola', 'CWV', 'DOM', 'Storage'];

let browser;
let dir;

test.beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chromium', headless: process.env.PDS_E2E_HEADED !== '1' });
  dir = await mkdtemp(join(tmpdir(), 'pds-viewer-e2e-'));
});

test.afterAll(async () => {
  await browser?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function file(name, bytes) {
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

// A page on the viewer with every request, dialog and page error recorded.
async function openViewer() {
  const context = await browser.newContext({ acceptDownloads: false });
  const page = await context.newPage();
  const seen = { requests: [], dialogs: [], pageErrors: [] };
  page.on('request', (r) => seen.requests.push(r.url()));
  page.on('dialog', (d) => {
    seen.dialogs.push(d.message());
    d.dismiss().catch(() => {});
  });
  page.on('pageerror', (e) => seen.pageErrors.push(String(e)));
  await page.goto(VIEWER);
  return { page, context, seen };
}

// Requests other than the viewer file itself (blob:/data: are local, not network).
const foreign = (seen) => seen.requests.filter((u) => u !== VIEWER && !u.startsWith('blob:') && !u.startsWith('data:'));

const tabButton = (page, id) => page.locator(`nav[role="tablist"] button[data-tab="${id}"]`);

async function loadFile(page, path) {
  await page.setInputFiles('#file', path);
}

async function waitSummary(page, timeout = 10_000) {
  await expect(page.locator('#summary-text')).toBeVisible({ timeout });
}

async function jpegDataUrl(context) {
  const page = await context.newPage();
  try {
    return await page.evaluate(() => {
      const c = globalThis.document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      const g = c.getContext('2d');
      g.fillStyle = '#c33';
      g.fillRect(0, 0, 8, 8);
      return c.toDataURL('image/jpeg', 0.9);
    });
  } finally {
    await page.close();
  }
}

test('loads zip v4, v3.json, v2.json; Polish UI; 0 network requests (AC-4.1)', async () => {
  const { page, context, seen } = await openViewer();
  try {
    await expect(page.locator('#drop')).toContainText('Przeciągnij plik paczki tutaj albo wybierz go z dysku.');
    await expect(page.locator('h1')).toHaveText('Podgląd paczki diagnostycznej');
    await expect(page.locator('nav[role="tablist"]')).toHaveAttribute('hidden', '');

    const v4 = await file('v4.zip', await exportedZip());
    await loadFile(page, v4);
    await waitSummary(page);
    await expect(page.locator('nav[role="tablist"]')).toBeVisible();
    expect(await page.locator('nav[role="tablist"] button').allTextContents()).toEqual(TAB_LABELS);
    await expect(page.locator('#package-info')).toContainText('schemat 4');
    await expect(page.locator('#package-info')).not.toContainText('plik w wersji');
    await expect(page.locator('#banner-unredacted')).toHaveCount(0);
    expect(await page.locator('#summary-text').textContent()).toContain('app.example.test');

    for (const [name, version] of [['v3.json', 3], ['v2.json', 2]]) {
      await loadFile(page, await file(name, JSON.stringify(await fixtureJson(name))));
      await expect(page.locator('#package-info')).toContainText(`plik w wersji ${version}`, { timeout: 10_000 });
      await waitSummary(page);
      await expect(page.locator('#load-error')).toBeHidden();
      await expect(page.locator('#banner-unredacted')).toHaveText('Paczka sprzed automatycznej redakcji — może zawierać hasła i tokeny');
    }

    // Drag and drop: a DataTransfer with the file dropped on the document.
    const base64 = Buffer.from(await exportedZip()).toString('base64');
    await page.evaluate(async (b64) => {
      const w = globalThis;
      const bytes = Uint8Array.from(w.atob(b64), (c) => c.charCodeAt(0));
      const dt = new w.DataTransfer();
      dt.items.add(new w.File([bytes], 'dropped.zip', { type: 'application/zip' }));
      w.document.body.dispatchEvent(new w.DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, base64);
    await expect(page.locator('#package-info')).toContainText('schemat 4', { timeout: 10_000 });
    await expect(page.locator('#package-info')).not.toContainText('plik w wersji');

    expect(foreign(seen), 'requests besides the viewer file').toEqual([]);
    expect(seen.pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

// Found by TEST2: viewer.html styles `nav[role="tablist"] { display: flex }`, which overrides the `hidden` attribute, so the
// (empty) tab bar is visible on the start screen before any package is loaded.
test('tab bar is not visible before a package is loaded (AC-4.2)', async () => {
  const { page, context } = await openViewer();
  try {
    await expect(page.locator('nav[role="tablist"]')).toBeHidden();
  } finally {
    await context.close();
  }
});

test('all 8 tabs switch ≤ 300 ms; screenshot visible for a zip with an image (AC-4.2)', async () => {
  const { page, context, seen } = await openViewer();
  try {
    const shot = await jpegDataUrl(context);
    await loadFile(page, await file('shot.zip', await exportedZip({ jpegDataUrl: shot })));
    await waitSummary(page);
    await expect(page.locator('#screenshot')).toBeVisible();
    expect(await page.$eval('#screenshot', (img) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await page.$eval('#screenshot', (img) => img.src.startsWith('blob:'))).toBe(true);

    for (const id of TAB_IDS) {
      // The first visit renders the tab; the time is click → panel visible, measured in the page.
      const ms = await page.evaluate((tab) => {
        const w = globalThis;
        const t0 = w.performance.now();
        w.document.querySelector(`nav[role="tablist"] button[data-tab="${tab}"]`).click();
        const panel = w.document.querySelector(`#app [data-tab-panel="${tab}"]`);
        const visible = !!panel && !panel.hidden;
        return { ms: w.performance.now() - t0, visible };
      }, id);
      expect(ms.visible, id).toBe(true);
      expect(ms.ms, `${id} switch`).toBeLessThanOrEqual(300);
      await expect(tabButton(page, id)).toHaveAttribute('aria-selected', 'true');
    }
    expect(foreign(seen)).toEqual([]);
  } finally {
    await context.close();
  }
});

test('network filter by status class, type and URL fragment on 5000 entries ≤ 500 ms, with the count (AC-4.4)', async () => {
  const { page, context } = await openViewer();
  try {
    const snapshot = networkSnapshot(5000);
    const net = snapshot.network;
    expect(net).toHaveLength(5000);
    await loadFile(page, await file('net5000.zip', await zipOfSnapshot(snapshot)));
    await waitSummary(page);
    await tabButton(page, 'network').click();
    const count = page.locator('#app [data-tab-panel="network"] [data-count]');
    await expect(count).toHaveText('Wyniki: 5000 z 5000');

    const timed = (action) =>
      page.evaluate((a) => {
        const w = globalThis;
        const root = w.document.querySelector('#app [data-tab-panel="network"]');
        const t0 = w.performance.now();
        if (a.kind === 'select') {
          const el = root.querySelector(`select[data-filter="${a.name}"]`);
          el.value = a.value;
          el.dispatchEvent(new w.Event('change', { bubbles: true }));
        } else {
          const el = root.querySelector('input[data-filter="url"]');
          el.value = a.value;
          el.dispatchEvent(new w.Event('input', { bubbles: true }));
        }
        return { ms: w.performance.now() - t0, text: root.querySelector('[data-count]').textContent };
      }, action);
    const reset = () => timed({ kind: 'select', name: 'status', value: '' });
    const statusClass = (e) => (typeof e.status !== 'number' ? (e.error ? 'error' : 'unknown') : `${Math.floor(e.status / 100)}xx`);

    const s5 = await timed({ kind: 'select', name: 'status', value: '5xx' });
    expect(s5.text).toBe(`Wyniki: ${net.filter((e) => statusClass(e) === '5xx').length} z 5000`);
    expect(s5.ms).toBeLessThanOrEqual(500);
    const s2 = await timed({ kind: 'select', name: 'status', value: '2xx' });
    expect(s2.text).toBe(`Wyniki: ${net.filter((e) => statusClass(e) === '2xx').length} z 5000`);
    expect(s2.ms).toBeLessThanOrEqual(500);
    const se = await timed({ kind: 'select', name: 'status', value: 'error' });
    expect(se.text).toBe(`Wyniki: ${net.filter((e) => statusClass(e) === 'error').length} z 5000`);
    await reset();

    const ty = await timed({ kind: 'select', name: 'type', value: 'xhr' });
    expect(ty.text).toBe(`Wyniki: ${net.filter((e) => e.type === 'xhr').length} z 5000`);
    expect(ty.ms).toBeLessThanOrEqual(500);
    await timed({ kind: 'select', name: 'type', value: '' });

    const fragment = '/api/items/10';
    const url = await timed({ kind: 'input', value: fragment });
    expect(url.text).toBe(`Wyniki: ${net.filter((e) => e.url.toLowerCase().includes(fragment)).length} z 5000`);
    expect(url.ms).toBeLessThanOrEqual(500);
    // Filters combine, and the DOM shows at most a page of rows while the count is the full number.
    const both = await timed({ kind: 'select', name: 'status', value: '2xx' });
    const expectBoth = net.filter((e) => statusClass(e) === '2xx' && e.url.toLowerCase().includes(fragment)).length;
    expect(both.text).toBe(`Wyniki: ${expectBoth} z 5000`);
    expect(await page.locator('#app [data-tab-panel="network"] .net-rows > *').count()).toBeLessThanOrEqual(200);
  } finally {
    await context.close();
  }
});

test('xss-traps: flag unset, no dialog, 0 requests, no anchor or script from the package (AC-4.5)', async () => {
  const { page, context, seen } = await openViewer();
  try {
    await loadFile(page, await file('xss.json', JSON.stringify(await fixtureJson('xss-traps.json'))));
    await waitSummary(page);
    for (const id of TAB_IDS) {
      await tabButton(page, id).click();
      await expect(tabButton(page, id)).toHaveAttribute('aria-selected', 'true');
    }
    // Let a would-be onerror / network attempt happen.
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => globalThis.__pwned)).toBeUndefined();
    expect(seen.dialogs).toEqual([]);
    expect(foreign(seen), 'requests besides the viewer file').toEqual([]);
    const dom = await page.evaluate(() => {
      const d = globalThis.document;
      return {
        javascriptLinks: d.querySelectorAll('a[href^="javascript:" i], [src^="javascript:" i]').length,
        anchors: d.querySelectorAll('a').length,
        scripts: d.querySelectorAll('script').length, // the viewer's own
        extraElements: d.querySelectorAll('img, iframe, svg, object, embed, link').length,
        handlers: [...d.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length,
        text: d.body.textContent,
      };
    });
    expect(dom.javascriptLinks).toBe(0);
    expect(dom.anchors).toBe(0);
    expect(dom.handlers).toBe(0);
    expect(dom.scripts).toBe(1);
    expect(dom.extraElements).toBe(0); // the fixture has no screenshot, so no <img> either
    // The traps are shown as plain text, not dropped.
    expect(dom.text).toContain('<img src="http://127.0.0.1:9/trap-img.png" onerror=');
    expect(seen.pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('heavy zip (~1.7 MB): first tab visible ≤ 3 s, median of 3 (AC-4.6)', async () => {
  const heavy = await heavyZip();
  console.log(`[E4-TEST2] heavy zip ${(heavy.bytes.length / 1e6).toFixed(2)} MB, JSON ${(heavy.jsonBytes / 1e6).toFixed(1)} MB`);
  expect(heavy.jsonBytes).toBeGreaterThan(8_000_000);
  const path = await file('heavy.zip', heavy.bytes);
  const times = [];
  for (let i = 0; i < 3; i++) {
    const { page, context } = await openViewer();
    try {
      const t0 = Date.now();
      await loadFile(page, path);
      await waitSummary(page, 20_000);
      times.push(Date.now() - t0);
    } finally {
      await context.close();
    }
  }
  const median = [...times].sort((a, b) => a - b)[1];
  console.log(`[E4-TEST2] heavy first tab ms: ${times.join(', ')} (median ${median})`);
  expect(median).toBeLessThanOrEqual(3000);
});

test('corrupt file / not a package / schemaVersion 5 → Polish message or warning banner, no blank screen (AC-4.7)', async () => {
  const { page, context, seen } = await openViewer();
  try {
    const visibleText = async () => (await page.evaluate(() => globalThis.document.body.innerText)).trim();

    await loadFile(page, await file('broken.zip', Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6])));
    const err = page.locator('#load-error');
    await expect(err).toBeVisible({ timeout: 10_000 });
    const brokenMsg = (await err.textContent()).trim();
    expect(brokenMsg).toMatch(/[ąćęłńóśźż]|plik|paczk/i);
    expect(await visibleText()).toContain('Przeciągnij plik paczki');
    await expect(page.locator('nav[role="tablist"]')).toHaveAttribute('hidden', '');

    await loadFile(page, await file('notes.txt', 'to nie jest paczka, tylko zwykły tekst'));
    await expect(err).toBeVisible();
    expect((await err.textContent()).trim()).not.toBe('');

    await loadFile(page, await file('other.json', JSON.stringify({ hello: 'world' })));
    await expect(err).toBeVisible();
    expect((await err.textContent()).trim()).not.toBe('');
    await expect(page.locator('nav[role="tablist"]')).toHaveAttribute('hidden', '');

    // A newer schema: data shown with the banner.
    const newer = { ...(await fixtureJson('v4.json')), schemaVersion: 5 };
    await loadFile(page, await file('v5.json', JSON.stringify(newer)));
    await expect(page.locator('#banner-newer')).toHaveText('Nowsza wersja paczki — część danych może być niewidoczna.', { timeout: 10_000 });
    await waitSummary(page);
    await expect(err).toBeHidden();
    await expect(page.locator('nav[role="tablist"]')).toBeVisible();

    // And after an error the viewer still takes a good file.
    await loadFile(page, await file('again.zip', await exportedZip()));
    await expect(page.locator('#banner-newer')).toHaveCount(0, { timeout: 10_000 });
    expect(foreign(seen)).toEqual([]);
    expect(seen.pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
