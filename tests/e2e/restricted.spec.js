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

// Popup state as recording.js popupState() reads it, through the null-safe openPopup.
async function readPopupState(page) {
  const popup = await openPopup(page);
  try {
    await popup.waitFor(`!document.getElementById('ready').hidden || !document.getElementById('recording').hidden`);
    return await popup.evaluate(`({
      section: !document.getElementById('ready').hidden ? 'ready' : 'recording',
      status: document.getElementById('status').textContent,
      statusIsError: document.getElementById('status').classList.contains('error'),
      recordEnabled: !document.getElementById('record').disabled,
    })`);
  } finally {
    await popup.close();
  }
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

    const state = await readPopupState(page);
    expect(state.section).toBe('ready');
    expect(state.recordEnabled).toBe(true);
    expect(state.status).toBe(MESSAGES.permissionDenied);
    expect(state.statusIsError).toBe(true);

    expect(loads).toBe(0);
    expect(await ext.sessionStorage.get(PENDING_KEY)).toBeUndefined();
    expect(await ext.sessionStorage.get(REC_KEY)).toBeUndefined();
    expect(await grantedOrigins()).toEqual([]);
  } finally {
    await page.close();
  }
});
