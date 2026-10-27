// E3 store review S1 / QA F-5: the screenshot switch and cross-origin frames (frameCheck → crossOriginVisible).
// Frames of other sites are never masked on the screenshot (PB-1 = B), so with a VISIBLE one on the page the switch starts
// OFF and #screenshotNote says why; frames that are 1×1, below the fold, display:none, visibility:hidden or opacity:0
// do not count. A manual switch-on keeps working.
import { test, expect } from '@playwright/test';
import { MESSAGES } from '../../src/popup/messages.js';
import { SCREENSHOT_NOTES } from '../../src/lib/screenshot-notes.js';
import { SCREENSHOT_FILE } from '../helpers/snapshot-validator.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { readZipPackage } from './helpers/download.js';
import { launchWithExtension, openPopupFor, waitForDownloadFile } from './helpers/launch.js';
import { readSaveOutcome, startRecording } from './helpers/recording.js';

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
  const outcome = await readSaveOutcome(popup);
  if ('error' in outcome) throw new Error(`Save failed: ${outcome.error}`);
  const { path } = await waitForDownloadFile(page, { fileName: outcome.fileName });
  return { ...(await readZipPackage(path)), status: outcome.savedShot };
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

// E4 AC-3.9: the popup turned the screenshot off (frames) and the reporter left it off → notes say why, not "turned off by the reporter".
test('frames page, switch untouched → notes offFrames(1), not "turned off by the reporter"; summary.md gives the reason in Polish (AC-3.9)', async () => {
  await withTab(async (page) => {
    await page.goto(`${server.url}/screenshot-mask.html`);
    await startRecording(page);
    const popup = await openPopupFor(page);
    try {
      await waitReady(popup);
      await popup.waitFor(`document.getElementById('screenshotNote').textContent === ${JSON.stringify(MESSAGES.screenshotFramesNote)}`, 8000);
      expect((await switchState(popup)).checked).toBe(false);
      const { json, entries, status, summary } = await savedPackage(page, popup);
      expect(status).toContain(OFF_SAVED);
      expect(json.screenshots).toEqual([]);
      expect(entries).not.toContain(SCREENSHOT_FILE);
      expect(json.notes, JSON.stringify(json.notes)).toContain(SCREENSHOT_NOTES.offFrames(1));
      expect(json.notes).not.toContain(SCREENSHOT_NOTES.off);
      expect(json.notes.some((n) => n.includes('turned off by the reporter'))).toBe(false);
      expect(summary).toContain('Zrzut ekranu: wyłączony automatycznie — na stronie były okienka innych serwisów (1)');
    } finally {
      await popup.close();
    }
  });
});

// The check itself fails (fieldRects errors in the background): the popup says so, the default stays off, the note says why.
test('frame check failing (fieldRects error) → offCheckFailed note; summary says the page could not be checked (AC-3.9)', async () => {
  test.setTimeout(60_000);
  const sw = await ext.serviceWorker();
  await sw.evaluate(() => {
    const tabs = globalThis.chrome.tabs;
    globalThis.__pdsOrigSendMessage = tabs.sendMessage;
    tabs.sendMessage = async (...args) => {
      if (args[1] && args[1].type === 'fieldRects') throw new Error('stub: no receiver');
      return globalThis.__pdsOrigSendMessage.apply(tabs, args);
    };
  });
  try {
    await withTab(async (page) => {
      await page.goto(`${server.url}/frames-hidden.html`);
      await startRecording(page);
      const popup = await openPopupFor(page);
      try {
        await waitReady(popup);
        await popup.waitFor(`document.getElementById('screenshotNote').textContent === ${JSON.stringify(MESSAGES.screenshotCheckFailedNote)}`, 20_000);
        expect((await switchState(popup)).checked).toBe(false);
        const { json, entries, summary } = await savedPackage(page, popup);
        expect(json.screenshots).toEqual([]);
        expect(entries).not.toContain(SCREENSHOT_FILE);
        expect(json.notes, JSON.stringify(json.notes)).toContain(SCREENSHOT_NOTES.offCheckFailed);
        expect(json.notes).not.toContain(SCREENSHOT_NOTES.off);
        expect(summary).toContain('Zrzut ekranu: wyłączony automatycznie — nie udało się sprawdzić strony');
      } finally {
        await popup.close();
      }
    });
  } finally {
    await sw.evaluate(() => { globalThis.chrome.tabs.sendMessage = globalThis.__pdsOrigSendMessage; });
  }
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
      const { json, entries, status, summary } = await savedPackage(page, popup);
      expect(status).not.toContain(OFF_SAVED);
      expect(json.screenshots, JSON.stringify(json.notes)).toHaveLength(1);
      expect(json.screenshots[0].file).toBe(SCREENSHOT_FILE);
      expect(entries).toContain(SCREENSHOT_FILE);
      // AC-3.10: the image shows a frame of another site that is not covered — said in notes (and in the summary), no new field.
      expect(json.notes, JSON.stringify(json.notes)).toContain(SCREENSHOT_NOTES.framesVisible(1));
      expect(json.notes.some((n) => /^Screenshot not included/i.test(n))).toBe(false);
      expect(summary).toContain('Zrzut ekranu: jest; widać na nim 1 okienko innego serwisu, nie jest zakryte');
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
