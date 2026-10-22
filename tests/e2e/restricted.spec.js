// E0-T7a restricted: a chrome:// tab cannot be snapshotted (AC-1.3). The popup says so in
// Polish within 2 s and nothing is downloaded.
import { test, expect } from '@playwright/test';
import { launchWithExtension, openPopupFor } from './helpers/launch.js';
import { expectNoDownload, countDownloads } from './helpers/download.js';
import { MESSAGES } from '../../src/popup/messages.js';

const LIMIT_MS = 2000;

let ext;

test.beforeAll(async () => {
  ext = await launchWithExtension();
});

test.afterAll(async () => {
  await ext?.close();
});

test('restricted: chrome://version shows restricted message within 2 s', async () => {
  const page = await ext.context.newPage();
  await page.goto('chrome://version');
  const popup = await openPopupFor(page);
  try {
    const downloads = countDownloads(page);
    const start = performance.now();
    await popup.click('#runSnapshot');
    const status = await popup.waitForText('#status', (t) => t === MESSAGES.restricted, LIMIT_MS);
    const elapsed = performance.now() - start;

    expect(status).toBe(MESSAGES.restricted);
    expect(elapsed).toBeLessThanOrEqual(LIMIT_MS);
    expect(await popup.evaluate(`document.getElementById('status').classList.contains('error')`)).toBe(true);
    await expectNoDownload(page, 500);
    expect(downloads.count).toBe(0);
  } finally {
    await popup.close();
    await page.close();
  }
});
