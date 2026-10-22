// E1-T19a: the reporter's flow end to end — disclosure, "Nagrywaj", recording state, "Zapisz paczkę"
// and the package recorded from tests/fixtures/pages/early-error.html (errors, requests and a
// console.error from <head>, before DOMContentLoaded). Texts come from src/popup/messages.js.
import { test, expect } from '@playwright/test';
import { readdir } from 'node:fs/promises';
import { MESSAGES } from '../../src/popup/messages.js';
import { countDownloads } from './helpers/download.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension, openPopupFor } from './helpers/launch.js';
import * as recording from './helpers/recording.js';

const REC_KEY = 'pds:rec';
const MARKER_KEY = 'pds.installed';
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RECORDING_RE = /^Nagrywam od \d{2}:\d{2}:\d{2}$/;
// No event says "no second reload is coming", so the absence is checked over this window.
const SETTLE_MS = 500;

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

// A fresh tab for each test; whatever it still records ends with the tab (AC-2.6).
async function withPage(fn) {
  const page = await ext.context.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close();
  }
}

// Runs in the page's MAIN world: is the recorder's install marker on window?
const hasMarker = (page) =>
  page.evaluate((key) => Object.getOwnPropertySymbols(globalThis).includes(Symbol.for(key)), MARKER_KEY);

async function openEarlyError(page) {
  await page.goto(`${server.url}/early-error.html`);
}

// Records early-error.html from its reload and saves once all its <head> requests are done.
async function recordEarlyError(page) {
  await openEarlyError(page);
  await startRecording(page);
  await page.evaluate(() => globalThis.__requestsDone);
  const marker = await page.evaluate(() => globalThis.__marker);
  const dcl = await page.evaluate(() => performance.getEntriesByType('navigation')[0].domContentLoadedEventStart);
  const saved = await saveRecording(page);
  return { ...saved, marker, dcl };
}

// Arguments are stored as JSON values (strings stay strings, objects stay objects).
// Adapter over helpers/recording.js: the helpers close the popup with Target.closeTarget and
// return at once. Opening the next popup while the old one is still closing sometimes leaves
// the new one unanswered or evaluated in the wrong document, so each step waits until it is gone.
async function popupGone(timeout = 5_000) {
  const popupUrl = `chrome-extension://${ext.extensionId}/popup/popup.html`;
  await expect
    .poll(async () => (await ext.browserCdp.send('Target.getTargets')).targetInfos.some((t) => t.url === popupUrl), { timeout, intervals: [50] })
    .toBe(false);
}
const settled = (step) => async (...args) => {
  try {
    return await step(...args);
  } finally {
    await popupGone();
  }
};
const startRecording = settled(recording.startRecording);
const saveRecording = settled(recording.saveRecording);
const popupState = settled(recording.popupState);

const argsText = (entry) => JSON.stringify(entry.args);

test('ready popup shows disclosure, no-upload sentence and reload notice', async () => {
  await withPage(async (page) => {
    await openEarlyError(page);
    const popup = await openPopupFor(page);
    try {
      await popup.waitFor(`!document.getElementById('ready').hidden`);
      const visible = await popup.evaluate(`(() => {
        const shown = (el) => !!el && el.getClientRects().length > 0;
        const byId = (id) => document.getElementById(id);
        return {
          title: shown(byId('disclosureTitle')) ? byId('disclosureTitle').textContent.trim() : null,
          items: [...document.querySelectorAll('#disclosure li')].filter(shown).map((li) => li.textContent.trim()),
          noUpload: shown(byId('noUpload')) ? byId('noUpload').textContent.trim() : null,
          reloadNotice: shown(byId('reloadNotice')) ? byId('reloadNotice').textContent.trim() : null,
          recordShown: shown(byId('record')),
          disclosureBeforeRecord: !!(byId('disclosure').compareDocumentPosition(byId('record')) & Node.DOCUMENT_POSITION_FOLLOWING),
        };
      })()`);
      expect(visible).toEqual({
        title: MESSAGES.disclosureTitle,
        items: [...MESSAGES.disclosureItems],
        noUpload: MESSAGES.noUpload,
        reloadNotice: MESSAGES.reloadNotice,
        recordShown: true,
        disclosureBeforeRecord: true,
      });
    } finally {
      await popup.close();
      await popupGone();
    }
  });
});

test('nothing is collected before Nagrywaj: no marker symbol, pre-log absent from package', async () => {
  await withPage(async (page) => {
    await openEarlyError(page);
    const pre = `pre-${Date.now()}`;
    await page.evaluate((m) => console.log(m), pre);
    expect(await hasMarker(page)).toBe(false);
    // The popup only asks for the status: still no recorder after opening it.
    expect((await popupState(page)).section).toBe('ready');
    expect(await hasMarker(page)).toBe(false);

    await startRecording(page);
    expect(await hasMarker(page)).toBe(true);
    const { json } = await saveRecording(page);
    expect(JSON.stringify(json)).not.toContain(pre);
  });
});

test('Nagrywaj reloads the tab exactly once, start→reload ≤ 2 s, popup shows Nagrywam od HH:MM:SS', async () => {
  await withPage(async (page) => {
    await openEarlyError(page);
    let loads = 0;
    page.on('load', () => loads++);
    const { since, clickedAt, reloadedAt } = await startRecording(page);
    await page.waitForTimeout(SETTLE_MS);
    expect(loads).toBe(1);
    expect(reloadedAt - clickedAt).toBeLessThanOrEqual(2000);
    expect(since).toMatch(RECORDING_RE);
    const navigationType = await page.evaluate(() => performance.getEntriesByType('navigation')[0].type);
    expect(navigationType).toBe('reload');
    await saveRecording(page);
  });
});

test('status survives popup reopen and service worker stop', async () => {
  await withPage(async (page) => {
    await openEarlyError(page);
    const { since } = await startRecording(page);
    const reopened = await popupState(page);
    expect(reopened).toMatchObject({ section: 'recording', since, saveEnabled: true });

    await ext.stopServiceWorker();
    const afterStop = await popupState(page);
    expect(afterStop).toMatchObject({ section: 'recording', since, saveEnabled: true });
    await saveRecording(page);
  });
});

test('badge is set on recording tab only', async () => {
  await withPage(async (page) => {
    const other = await ext.context.newPage();
    try {
      await other.goto(`${server.url}/basic.html`);
      await openEarlyError(page);
      await startRecording(page);
      const rec = await ext.sessionStorage.get(REC_KEY);
      const sw = await ext.serviceWorker();
      const badges = await sw.evaluate(async () => {
        const tabs = await globalThis.chrome.tabs.query({});
        return Promise.all(tabs.map(async (t) => [t.id, await globalThis.chrome.action.getBadgeText({ tabId: t.id })]));
      });
      expect(badges.length).toBeGreaterThanOrEqual(2);
      for (const [tabId, text] of badges) expect(text, `tab ${tabId}`).toBe(tabId === rec.tabId ? '●' : '');
      await saveRecording(page);
    } finally {
      await other.close();
    }
  });
});

test('save: Zapisano names the file that exists in download dir; file is JSON schemaVersion 2 with header fields', async () => {
  await withPage(async (page) => {
    const downloads = await countDownloads(ext);
    const { fileName, json, statusText } = await recordEarlyError(page);

    expect(statusText).toBe(MESSAGES.saved(fileName));
    expect(await downloads.names()).toEqual([fileName]);
    expect(await readdir(ext.downloadDir)).toContain(fileName);

    expect(json.schemaVersion).toBe(2);
    expect(json.source).toBe('extension');
    expect(json.documents).toHaveLength(1);
    expect(json.recordingStoppedReason).toBeNull();
    expect(json.collectedAt).toMatch(ISO_RE);
    expect(json.recordingStartedAt).toMatch(ISO_RE);
    expect(Date.parse(json.recordingStartedAt)).toBeLessThanOrEqual(Date.parse(json.collectedAt));
    expect(typeof json.timeOrigin).toBe('number');
    expect(json.documents[0].timeOrigin).toBe(json.timeOrigin);
    expect(json.truncated).toEqual({ consoleLogs: false, runtimeErrors: false, network: false });

    for (const key of ['consoleLogs', 'runtimeErrors', 'network']) {
      const ts = json[key].map((r) => r.t);
      for (const r of json[key]) {
        expect(typeof r.t, `${key}.t`).toBe('number');
        expect(r.t, `${key}.t`).toBeGreaterThanOrEqual(0);
        expect(r.doc, `${key}.doc`).toBe(0);
      }
      expect(ts, `${key} ordered by t`).toEqual([...ts].sort((a, b) => a - b));
    }
  });
});

test('head error, early fetch 500, console.error and rejection are in the package with t < domContentLoadedEventStart', async () => {
  await withPage(async (page) => {
    const { json, dcl } = await recordEarlyError(page);
    expect(json.performance.navigation.domContentLoadedEventStart).toBeCloseTo(dcl, 0);

    const boom = json.runtimeErrors.find((e) => e.type === 'error' && e.message.includes('head-boom'));
    expect(boom).toBeDefined();
    expect(boom.lineno).toBeGreaterThan(0);
    expect(boom.filename).toContain('/early-error.html');
    expect(boom.t).toBeLessThan(dcl);

    const rejection = json.runtimeErrors.find((e) => e.type === 'unhandledrejection');
    expect(rejection?.message).toContain('head-rejection');

    const consoleError = json.consoleLogs.find((e) => argsText(e).includes('head-console'));
    expect(consoleError).toMatchObject({ level: 'error' });
    expect(argsText(consoleError)).toContain('"a":1');
    expect(typeof consoleError.stack).toBe('string');
    expect(consoleError.stack).toContain('early-error.html');
    expect(consoleError.t).toBeLessThan(dcl);

    const request = (type, path) => json.network.filter((r) => r.type === type && new URL(r.url).pathname === path);
    const [fail] = request('fetch', '/api/fail');
    expect(fail).toMatchObject({ method: 'GET', status: 500, ok: false });
    expect(fail.t).toBeLessThan(dcl);
    expect(request('fetch', '/api/ok')).toEqual([expect.objectContaining({ status: 200, ok: true })]);
    expect(request('xhr', '/api/ok')).toEqual([expect.objectContaining({ status: 200 })]);
  });
});

test('package has no extension-generated console entries', async () => {
  await withPage(async (page) => {
    const { json, marker } = await recordEarlyError(page);
    const texts = json.consoleLogs.map(argsText);
    expect(texts).toHaveLength(2);
    expect(texts.some((t) => t.includes('head-console'))).toBe(true);
    expect(texts.some((t) => t.includes(marker))).toBe(true);
    expect(JSON.stringify(json.consoleLogs)).not.toMatch(/initialized|PageDebugSnapshot|chrome-extension:/);
  });
});

test('after save: reload has no recorder and after-log not in next package', async () => {
  await withPage(async (page) => {
    await recordEarlyError(page);
    expect(await ext.sessionStorage.get(REC_KEY)).toBeUndefined();
    expect((await popupState(page)).section).toBe('ready');

    await page.reload();
    expect(await hasMarker(page)).toBe(false);
    const after = `after-${Date.now()}`;
    await page.evaluate((m) => console.log(m), after);

    await startRecording(page);
    const { json } = await saveRecording(page);
    expect(JSON.stringify(json)).not.toContain(after);
  });
});

test('closing the recording tab drops it; reopening the origin runs no recorder', async () => {
  const page = await ext.context.newPage();
  await openEarlyError(page);
  await startRecording(page);
  expect(await ext.sessionStorage.get(REC_KEY)).toBeDefined();
  await page.close();

  await expect.poll(() => ext.sessionStorage.get(REC_KEY)).toBeUndefined();
  const sw = await ext.serviceWorker();
  await expect.poll(() => sw.evaluate(() => globalThis.chrome.scripting.getRegisteredContentScripts())).toEqual([]);

  await withPage(async (again) => {
    await openEarlyError(again);
    expect(await hasMarker(again)).toBe(false);
    expect((await popupState(again)).section).toBe('ready');
  });
});
