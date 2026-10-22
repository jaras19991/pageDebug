// E0-T7b / AC-2.4: a page served with `Content-Security-Policy: script-src 'self'` still
// gets a package and a success status (executeScript and hooks need no 'unsafe-inline').
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

test('csp strict page: download and success', async () => {
  const page = await ext.context.newPage();
  try {
    const response = await page.goto(`${server.url}/csp-strict.html`);
    expect(response.headers()['content-security-policy']).toBe("script-src 'self'");
    // The page itself works under the policy: its external script ran.
    expect(await page.evaluate(() => globalThis.__cspScriptRan)).toBe(true);

    const popup = await openPopupFor(page);
    try {
      const download = await expectDownload(page, () => popup.click('#runSnapshot'));
      expect(download.suggestedFilename).toMatch(/^page-debug-snapshot-\d+\.json$/);
      const status = await popup.waitForText('#status', download.suggestedFilename);
      expect(status).toBe(MESSAGES.success(download.suggestedFilename));
      const json = JSON.parse(await readFile(download.path, 'utf8'));
      expect(json.environment.location.href).toBe(`${server.url}/csp-strict.html`);
    } finally {
      await popup.close();
    }
  } finally {
    await page.close();
  }
});
