// E0-T7b / AC-1.5: two clicks on the same tab give two files, both with a success status,
// and hooks are not installed twice (a console.log between clicks is recorded exactly once).
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension, openPopupFor, expectDownload } from './helpers/launch.js';
import { MESSAGES } from '../../src/popup/messages.js';

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

// One "click": a fresh popup for the tab, the button, the download and the final status.
async function snapshotOnce(page) {
  const popup = await openPopupFor(page);
  try {
    const download = await expectDownload(page, () => popup.click('#runSnapshot'));
    const status = await popup.waitForText('#status', download.suggestedFilename);
    return { download, status };
  } finally {
    await popup.close();
  }
}

test('double click: two files, both success, marker logged between appears exactly once in second file consoleLogs', async () => {
  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}/basic.html`);

    const first = await snapshotOnce(page);
    expect(first.status).toBe(MESSAGES.success(first.download.suggestedFilename));

    // consoleLogs start at init(), i.e. the first snapshot, so the marker goes in after it.
    await page.evaluate(() => console.log('marker'));

    const second = await snapshotOnce(page);
    expect(second.status).toBe(MESSAGES.success(second.download.suggestedFilename));
    expect(second.download.path).not.toBe(first.download.path);

    const json = JSON.parse(await readFile(second.download.path, 'utf8'));
    const markers = json.consoleLogs.filter(
      (entry) => Array.isArray(entry.args) && entry.args.length === 1 && entry.args[0] === 'marker',
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].level).toBe('log');
  } finally {
    await page.close();
  }
});
