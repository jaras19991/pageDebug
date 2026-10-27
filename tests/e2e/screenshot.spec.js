// E2-TEST5 (part 1): screenshot at save, popup disclosure and layout, save time and the real package against the schema
// (AC-6.1, 6.2, 6.3, 6.6, 1.1, 1.3, 1.5, 7.1, 7.2). The live otherOrigin of the popup is in popup-live.spec.js.
// E3-TEST0: the package is a v4 zip; the image is the screenshot.jpg entry named by screenshots[].file.
// Dimensions are compared with innerWidth × innerHeight × devicePixelRatio of the real window, never with an emulated
// deviceScaleFactor: captureVisibleTab reads the real surface (spike E2-T0).
import { test, expect } from '@playwright/test';
import { MESSAGES } from '../../src/popup/messages.js';
import { assertValidSnapshot, REQUIRED_KEYS, SCREENSHOT_FILE, ZIP_ENTRIES } from '../helpers/snapshot-validator.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { decodeImage } from './helpers/image.js';
import { countDownloads } from './helpers/download.js';
import { launchWithExtension, openPopupFor } from './helpers/launch.js';
import { saveRecording, startRecording } from './helpers/recording.js';

const BACKGROUND = [0, 128, 255];
const JPEG_TOLERANCE = 12; // per channel; JPEG quality ~45–60 shifts flat colours by a few units
const SAVE_BUDGET_MS = 5000;

let server;
let ext;

test.beforeAll(async () => {
  server = await startFixtureServer({ port: 0 });
  ext = await launchWithExtension();
});

test.afterAll(async () => {
  await ext?.close();
  await server?.close();
});

async function withTab(fn) {
  const page = await ext.context.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

// Records a flat-colour page and saves; returns the validated package, the shot and the window size of the page.
async function saveScreenshotPage(page) {
  await page.goto(`${server.url}/screenshot.html`);
  await startRecording(page);
  const window = await page.evaluate(() => ({ width: globalThis.innerWidth, height: globalThis.innerHeight, dpr: globalThis.devicePixelRatio }));
  const saved = await saveRecording(page);
  assertValidSnapshot(saved.json);
  return { ...saved, window };
}

test('save → exactly one screenshot, reason save, jpeg; decoded size = innerWidth × innerHeight × dpr ±1 (AC-6.1, 6.6)', async () => {
  await withTab(async (page) => {
    const { json, files, entries, window } = await saveScreenshotPage(page);
    expect(window.dpr).toBe(1); // no emulated deviceScaleFactor in this harness

    expect(json.screenshots).toHaveLength(1);
    const [shot] = json.screenshots;
    expect(shot).toMatchObject({ reason: 'save', mime: 'image/jpeg', doc: 0, file: SCREENSHOT_FILE });
    expect('attachments' in json).toBe(false);
    expect(entries).toEqual([...ZIP_ENTRIES]);
    const bytes = files[shot.file];
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]); // JPEG magic
    expect(shot.bytes).toBe(bytes.length);
    expect(shot.bytes).toBeLessThanOrEqual(json.limits.screenshotBytes);
    expect(json.overview.screenshot).toBe(true);

    const decoded = await decodeImage(ext.context, bytes);
    expect(decoded.width).toBe(shot.width);
    expect(decoded.height).toBe(shot.height);
    expect(Math.abs(decoded.width - Math.round(window.width * window.dpr))).toBeLessThanOrEqual(1);
    expect(Math.abs(decoded.height - Math.round(window.height * window.dpr))).toBeLessThanOrEqual(1);
  });
});

test('the 4 corners have the fixture background colour: the popup is not in the image (AC-6.2)', async () => {
  await withTab(async (page) => {
    const { json, files } = await saveScreenshotPage(page);
    const decoded = await decodeImage(ext.context, files[json.screenshots[0].file]);
    for (const [corner, rgb] of Object.entries(decoded.corners)) {
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(rgb[c] - BACKGROUND[c]), `${corner} ${JSON.stringify(rgb)} vs ${JSON.stringify(BACKGROUND)}`).toBeLessThanOrEqual(JPEG_TOLERANCE);
      }
    }
  });
});

test('tab on localhost at save → no screenshot, a note says why, the rest is saved (AC-6.3)', async () => {
  await withTab(async (page) => {
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);
    await page.goto(`${server.otherOrigin}/screenshot.html`);
    // Fail-closed (review N6): the tab left the recorded origin, frameCheck fails and the switch is off with a note; the
    // reporter turns it on so that the "outside the recorded origin" path of the save is what is tested.
    const { json, entries } = await saveRecording(page, { forceScreenshot: true });
    assertValidSnapshot(json);

    expect(json.screenshots).toEqual([]);
    expect(entries).toEqual(ZIP_ENTRIES.slice(0, 2));
    expect(json.overview.screenshot).toBe(false);
    expect(json.notes.some((n) => /screenshot/i.test(n) && /outside/i.test(n)), JSON.stringify(json.notes)).toBe(true);
    expect(JSON.stringify(json)).not.toContain('data:image');
    expect(json.documents[0].url.startsWith(server.url)).toBe(true);
  });
});

test('popup ready shows the new disclosure items in visible text (AC-1.1)', async () => {
  await withTab(async (page) => {
    await page.goto(`${server.url}/basic.html`);
    const popup = await openPopupFor(page);
    try {
      await popup.waitFor(`!document.getElementById('ready').hidden`);
      const items = await popup.evaluate(`[...document.querySelectorAll('#disclosure li:not(#disclosureDev)')].map((li) => {
        const r = li.getBoundingClientRect();
        return { text: li.innerText, visible: r.width > 0 && r.height > 0 && getComputedStyle(li).visibility === 'visible' };
      })`);
      expect(items.map((i) => i.text)).toEqual([...MESSAGES.disclosureItems]);
      for (const item of items) expect(item.visible, item.text).toBe(true);
      const texts = items.map((i) => i.text);
      for (const needle of [/kroki/, /fragmenty odpowiedzi serwera/, /zrzut/]) {
        expect(texts.some((t) => needle.test(t)), String(needle)).toBe(true);
      }
    } finally {
      await popup.close();
    }
  });
});

// The popup target of CDP cannot be resized (Emulation.setDeviceMetricsOverride: "Target does not support metrics
// override"), so popup.html is opened as a tab at the maximum popup size, 360×600 (the width comes from popup.html, the
// height is Chrome's popup limit). The ready section is shown by hand: only the layout of the real file is under test.
test('"Nagrywaj" is fully visible without scrolling in a 360×600 popup (AC-1.3)', async () => {
  const page = await ext.context.newPage();
  try {
    await page.setViewportSize({ width: 360, height: 600 });
    await page.goto(`chrome-extension://${ext.extensionId}/popup/popup.html`);
    const layout = await page.evaluate(() => {
      const w = globalThis;
      const doc = w.document;
      doc.getElementById('ready').hidden = false;
      doc.getElementById('recording').hidden = true;
      w.scrollTo(0, 0);
      const r = doc.getElementById('record').getBoundingClientRect();
      return {
        scrollY: w.scrollY, top: r.top, bottom: r.bottom, left: r.left, right: r.right, innerHeight: w.innerHeight, innerWidth: w.innerWidth,
        scrollWidth: doc.documentElement.scrollWidth, contentHeight: doc.documentElement.scrollHeight,
      };
    });
    expect(layout.innerWidth).toBe(360);
    expect(layout.innerHeight).toBe(600);
    expect(layout.scrollY).toBe(0);
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.bottom, JSON.stringify(layout)).toBeLessThanOrEqual(layout.innerHeight);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(layout.innerWidth);
    expect(layout.scrollWidth).toBeLessThanOrEqual(360); // no horizontal scroll either
  } finally {
    await page.close();
  }
});

// QA F-1 (Firefox): after a save the ready section is back with the long disclosure; "Zapisano…" and "Nagrywaj" must
// both be fully visible without scrolling. Same layout-only approach as above: the status text is set by hand.
test('"Zapisano…" and "Nagrywaj" are fully visible without scrolling in a 360×600 popup after a save (QA F-1, AC-1.3)', async () => {
  const page = await ext.context.newPage();
  try {
    await page.setViewportSize({ width: 360, height: 600 });
    await page.goto(`chrome-extension://${ext.extensionId}/popup/popup.html`);
    const saved = MESSAGES.saved('snapshot-example.com-20261023-123456.zip');
    const layout = await page.evaluate((text) => {
      const w = globalThis;
      const doc = w.document;
      doc.getElementById('ready').hidden = false;
      doc.getElementById('recording').hidden = true;
      doc.getElementById('status').textContent = text;
      w.scrollTo(0, 0);
      const box = (id) => {
        const r = doc.getElementById(id).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      };
      return { scrollY: w.scrollY, innerHeight: w.innerHeight, status: box('status'), record: box('record') };
    }, saved);
    const info = JSON.stringify(layout);
    expect(layout.scrollY).toBe(0);
    expect(layout.status.height, info).toBeGreaterThan(0);
    expect(layout.status.top, info).toBeGreaterThanOrEqual(0);
    expect(layout.status.bottom, info).toBeLessThanOrEqual(layout.innerHeight);
    expect(layout.record.top, info).toBeGreaterThanOrEqual(layout.status.bottom); // the sticky button does not cover it
    expect(layout.record.bottom, info).toBeLessThanOrEqual(layout.innerHeight);
    expect(await page.locator('#status').innerText()).toBe(saved);
  } finally {
    await page.close();
  }
});

test('save to "Zapisano" on basic.html takes ≤ 5 s (median of 5), with a screenshot (AC-1.5)', async () => {
  test.setTimeout(90_000);
  const times = [];
  for (let i = 0; i < 5; i++) {
    await withTab(async (page) => {
      await page.goto(`${server.url}/basic.html`);
      await startRecording(page);
      const { json, savedAfterMs } = await saveRecording(page);
      expect(json.screenshots, `run ${i}`).toHaveLength(1);
      times.push(savedAfterMs);
    });
  }
  const median = [...times].sort((a, b) => a - b)[2];
  console.log(`[E2-TEST5] save times ms: ${JSON.stringify(times)} median ${median}`);
  expect(median).toBeLessThanOrEqual(SAVE_BUDGET_MS);
});

test('a real package passes the validator and its keys come in the documented order (AC-7.1, 7.2)', async () => {
  await withTab(async (page) => {
    const { json } = await saveScreenshotPage(page);
    assertValidSnapshot(json);
    expect(json.schemaVersion).toBe(4);
    expect(json.source).toBe('extension');
    expect(Object.keys(json)).toEqual([...REQUIRED_KEYS]);
    // no binary in snapshot.json from v4: the image is a zip entry
    expect(JSON.stringify(json)).not.toContain('data:image');
    expect(Object.keys(json.overview)).toEqual(['runtimeErrors', 'consoleErrors', 'failedRequests', 'steps', 'poorVitals', 'screenshot']);
  });
});

// E3-TEST0 (AC-1.1): one save = one file, named after the recorded host and the local time of the save.
test('saved file name matches snapshot-<host>-<YYYYMMDD-HHMMSS>.zip; exactly one download (downloads.search)', async () => {
  await withTab(async (page) => {
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);
    const counter = await countDownloads(page);
    const sw = await ext.serviceWorker();
    const startedAt = new Date().toISOString();
    const { fileName, statusText } = await saveRecording(page);

    const host = new URL(server.url).hostname;
    const match = /^snapshot-(.+)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?: \(\d+\))?\.zip$/.exec(fileName);
    expect(match, fileName).not.toBeNull(); // ` (1)`: Chrome's suffix when an earlier save got the same second
    expect(match[1]).toBe(host);
    const [, , y, mo, d, h, mi, sec] = match.map(Number);
    const stamp = new Date(y, mo - 1, d, h, mi, sec).getTime();
    expect(Math.abs(stamp - Date.now()), fileName).toBeLessThan(60_000);
    expect(statusText).toBe('');

    expect(await counter.names()).toEqual([fileName]);
    const items = await sw.evaluate(
      async (since) => (await globalThis.chrome.downloads.search({ startedAfter: since })).map((i) => ({ name: i.filename, state: i.state })),
      startedAt,
    );
    expect(items, JSON.stringify(items)).toHaveLength(1);
    expect(items[0].name.endsWith(fileName)).toBe(true);
  });
});
