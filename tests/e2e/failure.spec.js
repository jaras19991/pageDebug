// E0-T7a failure: the snapshot throws inside the page (AC-1.2). The popup must show a Polish
// error, never success, and no file may be downloaded.
// Do not call page.title() here: the fixture's throwing title getter breaks it too.
import { test, expect } from '@playwright/test';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { launchWithExtension, openPopupFor } from './helpers/launch.js';
import { expectNoDownload, countDownloads } from './helpers/download.js';
import { MESSAGES } from '../../src/popup/messages.js';

// AC-1.4: words the reporter must never see.
const FORBIDDEN = ['executeScript', 'inject', 'undefined', 'Error:', 'stack', 'PageDebugSnapshot'];

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

test('failure: error status in Polish, no success text, no download', async () => {
  const page = await ext.context.newPage();
  await page.goto(`${server.url}/throw-on-snapshot.html`);
  const popup = await openPopupFor(page);
  try {
    const downloads = countDownloads(page);
    await popup.click('#runSnapshot');
    const status = await popup.waitForText('#status', (t) => t !== '' && t !== MESSAGES.working);

    expect(status).toBe(MESSAGES.failed);
    expect(status).not.toContain('Gotowe');
    for (const word of FORBIDDEN) expect(status).not.toContain(word);
    expect(await popup.evaluate(`document.getElementById('status').classList.contains('error')`)).toBe(true);

    await expectNoDownload(page, 1500);
    expect(downloads.count).toBe(0);
  } finally {
    await popup.close();
    await page.close();
  }
});
