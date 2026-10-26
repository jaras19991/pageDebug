// E1-T19d: "Zapisz paczkę" that cannot finish. A page whose main thread is blocked never answers
// collect (AC-2.4), and a blocked download is reported without success (AC-2.2). In both cases
// no file appears, the popup never says "Zapisano" and the recording goes on: the next save works
// and still holds the entries from before the failure.
import { test, expect } from '@playwright/test';
import { MESSAGES } from '../../src/popup/messages.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension, listDownloads, openPopupFor } from './helpers/launch.js';
import { expectNoDownload } from './helpers/download.js';
import { saveRecording, startRecording } from './helpers/recording.js';

const SAVED_PREFIX = 'Zapisano plik';
const BUSY_MS = 17_000; // longer than the 15 s collect limit of popup and background

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

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Every #status text the popup shows from now on as [time, text], also ones replaced within milliseconds.
const WATCH_STATUS = `(() => {
  const status = document.getElementById('status');
  window.__pdsStatusLog = [[Date.now(), status.textContent]];
  new MutationObserver(() => window.__pdsStatusLog.push([Date.now(), status.textContent]))
    .observe(status, { childList: true, characterData: true, subtree: true });
})()`;

// Browser.setDownloadBehavior globally and for every browser context, as the harness does.
async function setDownloadBehavior(behavior) {
  const cdp = ext.browserCdp;
  await cdp.send('Browser.setDownloadBehavior', { behavior });
  const { targetInfos } = await cdp.send('Target.getTargets');
  for (const browserContextId of new Set(targetInfos.map((t) => t.browserContextId).filter(Boolean))) {
    await cdp.send('Browser.setDownloadBehavior', { behavior, browserContextId });
  }
}

// Files (also unfinished ones) in the download dir that were not there in `before`.
async function newFiles(page, before) {
  return (await listDownloads(page, { includePartial: true })).filter((n) => !before.includes(n));
}

async function openRecordingPopup(page) {
  const popup = await openPopupFor(page);
  // Null-safe: right after the popup target appears its document may not be popup.html yet.
  await popup.waitFor(`document.getElementById('recording')?.hidden === false && document.getElementById('save')?.disabled === false`);
  await popup.evaluate(WATCH_STATUS);
  return popup;
}

// Records on basic.html, blocks the page's main thread (and with it the content scripts) for
// BUSY_MS and clicks "Zapisz paczkę". Returns every status text shown, with the popup clock.
async function saveWhileBusy(page, marker) {
  await page.goto(`${server.url}/basic.html`);
  await startRecording(page);
  await page.evaluate((m) => console.log(m), marker);

  const popup = await openRecordingPopup(page);
  const filesBefore = await listDownloads(page, { includePartial: true });
  let busyUntil;
  let result;
  try {
    // setTimeout: the loop starts after evaluate has returned.
    await page.evaluate((ms) => {
      setTimeout(() => {
        const end = Date.now() + ms;
        while (Date.now() < end);
      }, 0);
    }, BUSY_MS);
    busyUntil = Date.now() + BUSY_MS;
    const clickedAt = await popup.evaluate('Date.now()');
    await popup.click('#save');
    await popup.waitForText('#status', (t) => t === MESSAGES.saving, 2_000);
    // Both sides give up 15 s after the click; wait until neither says "Zapisuję" any more.
    await popup.waitForText('#status', (t) => t !== MESSAGES.saving, 17_000);
    await delay(1_000);
    result = {
      clickedAt,
      log: await popup.evaluate('window.__pdsStatusLog'),
      finalText: await popup.textOf('#status'),
    };
  } finally {
    await popup.close();
  }
  await expectNoDownload(page, Math.max(0, busyUntil - Date.now()) + 500);
  result.newFiles = await newFiles(page, filesBefore);
  return result;
}

test('page main thread blocked during save: pageBusy/failed after 15 s, never Zapisano, recording continues', async () => {
  test.setTimeout(60_000);
  const page = await ext.context.newPage();
  try {
    const marker = `before-busy-${Date.now()}`;
    const { clickedAt, log, newFiles: files } = await saveWhileBusy(page, marker);

    const verdict = log.find(([, text]) => text === MESSAGES.pageBusy || text === MESSAGES.failed);
    expect(verdict, JSON.stringify(log)).toBeTruthy();
    expect(verdict[0] - clickedAt).toBeGreaterThanOrEqual(14_500);
    expect(log.some(([, text]) => text.startsWith(SAVED_PREFIX))).toBe(false);
    expect(files).toEqual([]);

    const { json } = await saveRecording(page);
    expect(json.schemaVersion).toBe(4);
    expect(JSON.stringify(json.consoleLogs)).toContain(marker);
  } finally {
    await page.close();
  }
});

// Regression (F-e1-1): ~10 ms after pageBusy the background's own collect timeout moves the
// state saving -> recording without lastError; the local verdict must survive that.
test('page main thread blocked during save: the pageBusy/failed verdict stays on screen', async () => {
  test.setTimeout(60_000);
  const page = await ext.context.newPage();
  try {
    const { finalText } = await saveWhileBusy(page, `stays-${Date.now()}`);
    expect([MESSAGES.pageBusy, MESSAGES.failed]).toContain(finalText);
  } finally {
    await page.close();
  }
});

// Measured: with Browser.setDownloadBehavior 'deny' Chrome interrupts the download with
// USER_CANCELED, so the popup shows saveCancelled (downloadFailed is for other interrupt reasons).
test('download blocked by the browser: saveCancelled, no file, recording continues and next save works', async () => {
  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);
    const marker = `before-deny-${Date.now()}`;
    await page.evaluate((m) => console.log(m), marker);

    const filesBefore = await listDownloads(page, { includePartial: true });
    await setDownloadBehavior('deny');
    try {
      const popup = await openRecordingPopup(page);
      try {
        await popup.click('#save');
        const expected = [MESSAGES.saveCancelled, MESSAGES.downloadFailed];
        const shown = await popup.waitForText('#status', (t) => expected.includes(t), 10_000);
        expect(shown).toBe(MESSAGES.saveCancelled);
        expect(await popup.evaluate(`document.getElementById('status').classList.contains('error')`)).toBe(true);
        // Still recording: "Zapisz paczkę" is there again.
        expect(await popup.evaluate(`!document.getElementById('recording').hidden && !document.getElementById('save').disabled`)).toBe(true);
        const log = await popup.evaluate('window.__pdsStatusLog');
        expect(log.some(([, text]) => text.startsWith(SAVED_PREFIX))).toBe(false);
      } finally {
        await popup.close();
      }
      await expectNoDownload(page, 500);
      expect(await newFiles(page, filesBefore)).toEqual([]);
    } finally {
      await setDownloadBehavior('default');
    }

    const { json } = await saveRecording(page);
    expect(json.schemaVersion).toBe(4);
    expect(JSON.stringify(json.consoleLogs)).toContain(marker);
  } finally {
    await page.close();
  }
});
