// E0-T16b: the e2e harness itself. Loads dist/chrome (AC-3.3), opens the real popup with
// activeTab through CDP (design D10, spike T17 path (a)) and catches the package download.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { DIST_CHROME, launchWithExtension, openPopupFor, expectDownload } from './helpers/launch.js';

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

test('loads extension from dist/chrome', async () => {
  expect(ext.extensionId).toMatch(/^[a-p]{32}$/);
  expect(path.resolve(ext.extensionInfo.path)).toBe(path.resolve(DIST_CHROME));
  const manifest = JSON.parse(await readFile(path.join(DIST_CHROME, 'manifest.json'), 'utf8'));
  expect(ext.extensionInfo.version).toBe(manifest.version);
  expect(ext.extensionInfo.name).toBe(manifest.name);
});

test('popup opens for fixture tab and shows button', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${server.url}/basic.html`);
  const popup = await openPopupFor(page);
  try {
    expect(popup.url).toBe(`chrome-extension://${ext.extensionId}/popup/popup.html`);
    expect(await popup.textOf('#runSnapshot')).toBe('Debug snapshot');
  } finally {
    await popup.close();
    await page.close();
  }
});

test('click in popup downloads one JSON and status names the file', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${server.url}/basic.html`);
  const popup = await openPopupFor(page);
  try {
    const download = await expectDownload(page, () => popup.click('#runSnapshot'));
    expect(download.suggestedFilename).toMatch(/^page-debug-snapshot-\d+\.json$/);
    const status = await popup.waitForText('#status', download.suggestedFilename);
    expect(status).toContain(download.suggestedFilename);
    const json = JSON.parse(await readFile(download.path, 'utf8'));
    expect(json).toHaveProperty('version');
  } finally {
    await popup.close();
    await page.close();
  }
});
