// E3 store review S1 / QA F-5: the screenshot switch and cross-origin frames (frameCheck → crossOriginVisible).
// Frames of other sites are never masked on the screenshot (PB-1 = B), so with a VISIBLE one on the page the switch starts
// OFF and #screenshotNote says why; frames that are 1×1, below the fold, display:none, visibility:hidden or opacity:0
// do not count. A manual switch-on keeps working.
import { test, expect } from '@playwright/test';
import { MESSAGES } from '../../src/popup/messages.js';
import { SCREENSHOT_FILE } from '../helpers/snapshot-validator.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { readZipPackage } from './helpers/download.js';
import { launchWithExtension, openPopupFor, waitForDownloadFile } from './helpers/launch.js';
import { startRecording } from './helpers/recording.js';

const SAVED_RE = /^Zapisano plik (.+?) — /;
const OFF_SAVED = MESSAGES.screenshotOffSaved; // "Plik nie zawiera zrzutu ekranu."

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

const switchState = (popup) =>
  popup.evaluate(`({ checked: document.getElementById('includeScreenshot').checked, note: document.getElementById('screenshotNote').textContent })`);

const waitReady = (popup) =>
  popup.waitFor(`!document.getElementById('recording').hidden && !document.getElementById('save').disabled`);

// The background's answer to the popup's own frameCheck, for the same tab.
const askFrameCheck = (popup) =>
  popup.evaluate(`(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return await chrome.runtime.sendMessage({ type: 'frameCheck', tabId: tab.id });
  })()`);

async function savedPackage(page, popup) {
  await popup.click('#save');
  const status = await popup.waitFor(
    `(() => { const s = document.getElementById('status'); return /^Zapisano plik /.test(s.textContent) || s.classList.contains('error') ? s.textContent : null; })()`,
    16_000,
  );
  const match = SAVED_RE.exec(status);
  if (!match) throw new Error(`Save failed: ${status}`);
  const { path } = await waitForDownloadFile(page, { fileName: match[1] });
  return { ...(await readZipPackage(path)), status };
}

test('visible cross-origin iframe → switch off + note; save without screenshot, status says so (S1, F-5)', async () => {
  await withTab(async (page) => {
    await page.goto(`${server.url}/screenshot-mask.html`);
    await startRecording(page);
    const popup = await openPopupFor(page);
    try {
      await waitReady(popup);
      await popup.waitFor(`document.getElementById('screenshotNote').textContent === ${JSON.stringify(MESSAGES.screenshotFramesNote)}`, 8000);
      expect(await switchState(popup)).toEqual({ checked: false, note: MESSAGES.screenshotFramesNote });
      expect(await askFrameCheck(popup)).toEqual({ ok: true, crossOriginFrames: 1 });
      const { json, entries, status } = await savedPackage(page, popup);
      expect(status).toContain(OFF_SAVED);
      expect(json.screenshots).toEqual([]);
      expect(json.overview.screenshot).toBe(false);
      expect(entries).not.toContain(SCREENSHOT_FILE);
      expect(entries.some((e) => /\.(jpe?g|png)$/i.test(e)), entries.join(', ')).toBe(false);
    } finally {
      await popup.close();
    }
  });
});

test('cross-origin iframes out of view, 1×1, display:none, visibility:hidden, opacity:0 → switch stays on, no note (S1)', async () => {
  await withTab(async (page) => {
    await page.goto(`${server.url}/frames-hidden.html`);
    await startRecording(page);
    const popup = await openPopupFor(page);
    try {
      await waitReady(popup);
      // Positive evidence that the check ran and found nothing visible, then give the popup's own check time to land.
      expect(await askFrameCheck(popup)).toEqual({ ok: true, crossOriginFrames: 0 });
      // Fail-closed (review N6): the switch turns on only after the popup's own frameCheck answers 0.
      await popup.waitFor(`document.getElementById('includeScreenshot').checked === true`, 8000);
      expect(await switchState(popup)).toEqual({ checked: true, note: '' });
      const { json, entries, status } = await savedPackage(page, popup);
      expect(status).not.toContain(OFF_SAVED);
      expect(json.screenshots).toHaveLength(1);
      expect(entries).toContain(SCREENSHOT_FILE);
    } finally {
      await popup.close();
    }
  });
});

test('manual switch-on with a visible cross-origin iframe → the screenshot is in the package (S1)', async () => {
  await withTab(async (page) => {
    await page.goto(`${server.url}/screenshot-mask.html`);
    await startRecording(page);
    const popup = await openPopupFor(page);
    try {
      await waitReady(popup);
      await popup.waitFor(`document.getElementById('screenshotNote').textContent === ${JSON.stringify(MESSAGES.screenshotFramesNote)}`, 8000);
      expect((await switchState(popup)).checked).toBe(false);
      await popup.click('#includeScreenshot');
      expect((await switchState(popup)).checked).toBe(true);
      const { json, entries, status } = await savedPackage(page, popup);
      expect(status).not.toContain(OFF_SAVED);
      expect(json.screenshots, JSON.stringify(json.notes)).toHaveLength(1);
      expect(json.screenshots[0].file).toBe(SCREENSHOT_FILE);
      expect(entries).toContain(SCREENSHOT_FILE);
    } finally {
      await popup.close();
    }
  });
});

// Review N6 (fail-closed): "Zapisz paczkę" clicked while the popup's frameCheck is unanswered → the switch is still OFF →
// no screenshot, though the page has no cross-origin frames at all. Made deterministic: the service worker holds back the
// `fieldRects` message that frameCheck relies on for 1.5 s (the popup's own timeout for the check is 3 s).
test('save clicked before frameCheck answers → package without screenshot, status says so (N6)', async () => {
  const sw = await ext.serviceWorker();
  await sw.evaluate(() => {
    const tabs = globalThis.chrome.tabs;
    globalThis.__pdsOrigSendMessage = tabs.sendMessage;
    tabs.sendMessage = async (...args) => {
      if (args[1] && args[1].type === 'fieldRects') await new Promise((r) => setTimeout(r, 1500));
      return globalThis.__pdsOrigSendMessage.apply(tabs, args);
    };
  });
  try {
    await withTab(async (page) => {
      await page.goto(`${server.url}/frames-hidden.html`);
      await startRecording(page);
      const popup = await openPopupFor(page);
      try {
        await popup.waitFor(`!document.getElementById('recording').hidden && !document.getElementById('save').disabled`);
        const early = await switchState(popup);
        expect(early, 'frameCheck still unanswered: switch off, no note yet').toEqual({ checked: false, note: '' });
        const { json, entries, status } = await savedPackage(page, popup);
        expect(status).toContain(OFF_SAVED);
        expect(json.screenshots).toEqual([]);
        expect(json.overview.screenshot).toBe(false);
        expect(entries).not.toContain(SCREENSHOT_FILE);
        // The answer lands later and turns the switch on (0 frames): the fail-closed state is only until the check ends.
      } finally {
        await popup.close();
      }
    });
  } finally {
    await sw.evaluate(() => { globalThis.chrome.tabs.sendMessage = globalThis.__pdsOrigSendMessage; });
  }
});
