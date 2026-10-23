// E1-T19d: pages the extension must not record, and a consent prompt closed without "Zezwól".
// The popup decides on its own for special pages (AC-1.7): restricted text, no Nagrywaj, no
// permissions.request, no reload. The Chrome Web Store cannot be opened here (Chrome swaps the
// tab into its own process and Playwright loses the page), so the store stays in manual QA.
import { test, expect } from '@playwright/test';
import { MESSAGES } from '../../src/popup/messages.js';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension, openPopupFor } from './helpers/launch.js';

const PENDING_KEY = 'pds:pending';
const REC_KEY = 'pds:rec';

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

async function grantedOrigins() {
  const sw = await ext.serviceWorker();
  return sw.evaluate(async () => (await globalThis.chrome.permissions.getAll()).origins);
}

// Counts permissions.request calls made by the popup from now on.
const SPY_PERMISSIONS = `(() => {
  window.__pdsRequests = 0;
  const original = chrome.permissions.request.bind(chrome.permissions);
  chrome.permissions.request = (...args) => { window.__pdsRequests++; return original(...args); };
})()`;

// openPopupFor may return while the popup still shows its initial empty document.
async function openPopup(page) {
  const popup = await openPopupFor(page);
  await popup.waitFor(`!!document.getElementById('status') && !!document.getElementById('record')`);
  return popup;
}

async function expectRestricted(url) {
  const page = await ext.context.newPage();
  try {
    if (url !== 'about:blank') await page.goto(url);
    let loads = 0;
    page.on('load', () => loads++);

    const openedAt = Date.now();
    const popup = await openPopup(page);
    try {
      await popup.waitForText('#status', (t) => t === MESSAGES.restricted, 2_000);
      expect(Date.now() - openedAt).toBeLessThanOrEqual(2_000);
      const view = await popup.evaluate(`({
        ready: !document.getElementById('ready').hidden,
        recording: !document.getElementById('recording').hidden,
        recordDisabled: document.getElementById('record').disabled,
        isError: document.getElementById('status').classList.contains('error'),
      })`);
      expect(view).toEqual({ ready: false, recording: false, recordDisabled: true, isError: true });

      // A click on the (disabled) button must not reach permissions.request.
      await popup.evaluate(SPY_PERMISSIONS);
      await popup.click('#record');
      await delay(300);
      expect(await popup.evaluate('window.__pdsRequests')).toBe(0);
      expect(await popup.textOf('#status')).toBe(MESSAGES.restricted);
    } finally {
      await popup.close();
    }

    expect(loads).toBe(0);
    expect(page.url()).toBe(url);
    expect(await ext.sessionStorage.get(PENDING_KEY)).toBeUndefined();
    expect(await ext.sessionStorage.get(REC_KEY)).toBeUndefined();
    expect(await grantedOrigins()).toEqual([]);
  } finally {
    await page.close();
  }
}

// Forces one more getStatus in an open popup (any storage.session change refreshes it) and
// reads #status after that answer was applied.
const COUNT_GET_STATUS = `(() => {
  window.__pdsGetStatus = 0;
  const original = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (message, ...rest) => {
    const answer = original(message, ...rest);
    if (message?.type === 'getStatus') Promise.resolve(answer).finally(() => setTimeout(() => window.__pdsGetStatus++, 0));
    return answer;
  };
})()`;

async function statusAfterNextGetStatus(popup) {
  try {
    await popup.evaluate(COUNT_GET_STATUS);
    await ext.sessionStorage.set('pds:e2e-poke', Date.now());
    await expect.poll(() => popup.evaluate('window.__pdsGetStatus'), { timeout: 5_000 }).toBeGreaterThan(0);
    return await popup.evaluate(`({
      status: document.getElementById('status').textContent,
      statusIsError: document.getElementById('status').classList.contains('error'),
    })`);
  } finally {
    await ext.sessionStorage.set('pds:e2e-poke', undefined);
  }
}

test('chrome://version: restricted message within 2 s, no reload, no permission request', async () => {
  await expectRestricted('chrome://version/');
});

test('about:blank: restricted message within 2 s, no reload, no permission request', async () => {
  await expectRestricted('about:blank');
});

// Without a prepared grant Chrome shows its consent bubble, which closes the popup (spike T0,
// S4) and is dismissed without "Zezwól". The deterministic part: the next popup says consent is
// missing, the tab was not reloaded and the state is back to ready. An explicit "Odrzuć" click
// in the bubble cannot be driven here (AC-1.4: unit + manual QA).
test('consent prompt closed without allowing: permissionDenied on reopen, no reload, back to ready', async () => {
  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}/basic.html`);
    let loads = 0;
    page.on('load', () => loads++);

    const popup = await openPopup(page);
    await popup.waitFor(`!document.getElementById('ready').hidden && !document.getElementById('record').disabled`);
    await popup.click('#record');
    // armStart is sent before permissions.request; wait until the background stored it.
    await expect.poll(() => ext.sessionStorage.get(PENDING_KEY), { timeout: 5_000 }).toBeTruthy();
    // The consent bubble takes the popup down with it.
    await expect
      .poll(() => popup.evaluate('1').then(() => 'open', () => 'closed'), { timeout: 5_000 })
      .toBe('closed');
    await popup.close();

    const reopened = await openPopup(page);
    try {
      await reopened.waitFor(`!document.getElementById('ready').hidden && document.getElementById('status').textContent !== ''`);
      // Let the popup's own refresh after the one-shot lastError was cleared land first.
      await delay(300);
      const state = await reopened.evaluate(`({
        status: document.getElementById('status').textContent,
        statusIsError: document.getElementById('status').classList.contains('error'),
        recordEnabled: !document.getElementById('record').disabled,
      })`);
      expect(state.recordEnabled).toBe(true);
      expect(state.status).toBe(MESSAGES.permissionDenied);
      expect(state.statusIsError).toBe(true);
      // QA F-1: lastError is one-shot; the text must survive the next getStatus (idle, no lastError).
      expect(await statusAfterNextGetStatus(reopened)).toEqual({ status: MESSAGES.permissionDenied, statusIsError: true });
    } finally {
      await reopened.close();
    }

    expect(loads).toBe(0);
    expect(await ext.sessionStorage.get(PENDING_KEY)).toBeUndefined();
    expect(await ext.sessionStorage.get(REC_KEY)).toBeUndefined();
    expect(await grantedOrigins()).toEqual([]);
  } finally {
    await page.close();
  }
});
