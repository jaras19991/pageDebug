// E1-T18: smoke of the e2e harness for the background flow. dist/chrome (AC-3.3), the real popup
// through CDP, "Nagrywaj" with a granted origin, "Zapisz paczkę" into the temp download dir.
import { test, expect } from '@playwright/test';
import { startFixtureServer } from './helpers/fixtures-server.js';
import { resolve } from 'node:path';
import { DIST_CHROME, launchWithExtension } from './helpers/launch.js';
import { saveRecording, startRecording } from './helpers/recording.js';

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

test('harness: record basic fixture, log a marker and save a v3 package', async () => {
  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);
    const marker = `harness-marker-${Date.now()}`;
    await page.evaluate((m) => console.log(m), marker);

    const { fileName, json } = await saveRecording(page);
    expect(fileName).toMatch(/^snapshot-[a-z0-9.-]+-\d{8}-\d{6}( \(\d+\))?\.zip$/);
    expect(json.schemaVersion).toBe(4);
    expect(json.documents.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(json.consoleLogs)).toContain(marker);
  } finally {
    await page.close();
  }
});

// E0 AC-3.3 (kept in E1): e2e runs the output of `npm run build`, never the sources.
test('e2e loads the extension from dist/chrome (E0 AC-3.3)', async () => {
  expect(resolve(ext.extensionInfo.path)).toBe(DIST_CHROME);
  expect(ext.extensionInfo.path).not.toMatch(/src$/);
});

// E0 AC-2.3 (kept in E1): recording and saving add no <script src=chrome-extension://…> and no
// elements to the page (basic.html records every added node with a MutationObserver, parser nodes included).
test('recording and saving leave no extension nodes in the page (E0 AC-2.3)', async () => {
  const page = await ext.context.newPage();
  try {
    await page.goto(`${server.url}/basic.html`);
    await startRecording(page);
    await saveRecording(page);
    const added = await page.evaluate(() => globalThis.__added);
    expect(added.filter((n) => n.nodeName === 'SCRIPT' && /^chrome-extension:/.test(n.src ?? ''))).toEqual([]);
    // Only what basic.html's own markup parses into after its head script (the observer sees the parser too).
    expect([...new Set(added.map((n) => n.nodeName))].sort()).toEqual(['#text', 'BODY', 'BUTTON', 'H1', 'P']);
    expect(await page.evaluate(() => globalThis.document.querySelectorAll('[src^="chrome-extension:"]').length)).toBe(0);
  } finally {
    await page.close();
  }
});
